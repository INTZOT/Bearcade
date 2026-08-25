// ============================================================
// 冰冻地板(FrozenFloor)玩法实现
// - 环形蓝冰场,每 30 秒内外圈向中间“融化”收缩;
// - 玩家拥有无限雪球,用雪球把其他人击落到虚空;
// - 禁止玩家间近战伤害/击退;
// - 淘汰玩家进入 follow_orbit 观战(参考豆腐渣地板);
// - 最后 1 名存活者获胜,同时淘汰则平局。
// ============================================================
import {
  system,
  world,
  EasingType,
  EntityComponentTypes,
  GameMode,
  ItemLockMode,
  ItemStack,
  type EntityInventoryComponent,
  type Player,
} from "@minecraft/server";
import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import {
  clearHudTitle,
  hudMessage,
  setHudTitle,
} from "../../shared/minigame-core/scoreboardHud";
import { clearAllPlayerItems } from "../../shared/minigame-core/playerItems";
import { getFrozenFloorConfig, openFrozenFloorConfig } from "./frozenfloor-config";
import type { FrozenFloorConfig } from "./config";

const SNOWBALL_ITEM = "minecraft:snowball";
const SPECTATE_ITEM = "minecraft:spyglass";
const BLUE_ICE = "minecraft:blue_ice";
const AIR = "minecraft:air";

const SPEC_OWNER_TAG = "bearcade:ff_spec_owner";
const SPEC_TARGET_TAG = "bearcade:ff_spec_target";
const ORBIT_RADIUS = 6;
const ORBIT_PITCH_DEG = 15;
const ORBIT_YAW_DEG = 0;
const GLIDE_TICKS = 10;

interface Session {
  alive: Set<string>;
  spectators: Map<string, string>;
  /** 已淘汰玩家的名次: id -> { name, rank }(未被淘汰就退出的玩家不会写入) */
  ranks: Map<string, { name: string; rank: number }>;
  /** 是否已公布过前三名 */
  top3Announced: boolean;
  meltStage: number;
  nextMeltTick: number;
  melting: boolean;
  meltQueue: { x: number; z: number }[];
  meltIndex: number;
}

const sessions = new Map<number, Session>();

// ===== 半径计算 =====

function radiiAt(cfg: FrozenFloorConfig, stage: number): {
  inner: number;
  outer: number;
} {
  return {
    inner: cfg.innerRadius + stage * cfg.innerExpandPerMelt,
    outer: cfg.outerRadius - stage * cfg.outerShrinkPerMelt,
  };
}

function ringSpawn(
  cfg: FrozenFloorConfig,
  index: number,
  count: number,
): { x: number; y: number; z: number } {
  const { inner, outer } = radiiAt(cfg, 0);
  const radius = (inner + outer) / 2;
  const angle = (index / Math.max(1, count)) * Math.PI * 2;
  return {
    x: Math.floor(cfg.arenaCenter.x) + Math.round(radius * Math.cos(angle)),
    y: Math.floor(cfg.ringY) + 1,
    z: Math.floor(cfg.arenaCenter.z) + Math.round(radius * Math.sin(angle)),
  };
}

// ===== 对局内玩家/存活工具 =====

function alivePlayers(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): Player[] {
  return runtime
    .roomPlayers(roomId)
    .filter((p) => p !== undefined && session.alive.has(p.id));
}

function aliveIds(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): string[] {
  return alivePlayers(runtime, roomId, session).map((p) => p.id);
}

// ===== 观战相机(参考豆腐渣地板,预设标识改为 frozenfloor) =====

function orbitStartPos(target: Player): { x: number; y: number; z: number } {
  const rad = (ORBIT_PITCH_DEG * Math.PI) / 180;
  const yaw = (ORBIT_YAW_DEG * Math.PI) / 180;
  const h = ORBIT_RADIUS * Math.cos(rad);
  return {
    x: target.location.x + Math.sin(yaw) * h,
    y: target.location.y + ORBIT_RADIUS * Math.sin(rad),
    z: target.location.z + Math.cos(yaw) * h,
  };
}

function lookAt(
  cam: { x: number; y: number; z: number },
  eye: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const dx = eye.x - cam.x;
  const dy = eye.y - cam.y;
  const dz = eye.z - cam.z;
  const dist = Math.hypot(dx, dz);
  return {
    x: (Math.atan2(-dy, dist) * 180) / Math.PI,
    y: (Math.atan2(-dx, dz) * 180) / Math.PI,
    z: 0,
  };
}

function attachSpectateCamera(spectator: Player, target: Player): void {
  try {
    spectator.addTag(SPEC_OWNER_TAG);
    target.addTag(SPEC_TARGET_TAG);
    try {
      spectator.dimension.runCommand(
        `camera @a[tag=${SPEC_OWNER_TAG}] attach_to_entity @e[tag=${SPEC_TARGET_TAG}]`,
      );
    } finally {
      spectator.removeTag(SPEC_OWNER_TAG);
      target.removeTag(SPEC_TARGET_TAG);
    }
  } catch (error) {
    console.warn("[Bearcade frozenfloor] 观战相机附加失败", error);
  }
}

function transitionSpectateCamera(spectator: Player, target: Player): void {
  try {
    const eye = {
      x: target.location.x,
      y: target.location.y + 1.6,
      z: target.location.z,
    };
    const dest = orbitStartPos(target);
    spectator.camera.setCamera("minecraft:free", {
      location: dest,
      rotation: lookAt(dest, eye),
      easeOptions: {
        easeTime: GLIDE_TICKS * 0.05,
        easeType: EasingType.Linear,
      },
    });
    system.runTimeout(() => {
      try {
        try {
          spectator.camera.setCamera("bearcade:frozenfloor_spectate");
        } catch {
          spectator.camera.setCamera("minecraft:follow_orbit");
        }
        attachSpectateCamera(spectator, target);
      } catch (error) {
        console.warn("[Bearcade frozenfloor] 观战相机附加失败", error);
      }
    }, GLIDE_TICKS + 2);
  } catch (error) {
    console.warn("[Bearcade frozenfloor] 观战相机运镜失败", error);
  }
}

function setSpectateTarget(
  session: Session,
  spectator: Player,
  target: Player | undefined,
): void {
  if (!target) {
    spectator.camera.clear();
    return;
  }
  session.spectators.set(spectator.id, target.id);
  transitionSpectateCamera(spectator, target);
  spectator.sendMessage(`§7正在观战 §e${target.name}§7(手持望远镜切换)`);
}

function spectateSpot(): { x: number; y: number; z: number } {
  return getFrozenFloorConfig().spectateSpot;
}

// ===== 淘汰 =====

function eliminatePlayer(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
  player: Player,
): void {
  session.alive.delete(player.id);
  // 记录名次:淘汰时的存活人数 + 1;如果这次淘汰后无人存活(同时淘汰),不设第 1 名
  if (session.alive.size > 0) {
    session.ranks.set(player.id, {
      name: player.name,
      rank: session.alive.size + 1,
    });
  }
  player.setGameMode(GameMode.Adventure);
  try {
    runtime.teleportPlayer(roomId, player, spectateSpot());
  } catch {
    // 忽略
  }
  // 清空雪球,只保留观战望远镜
  clearAllPlayerItems(player);
  try {
    const inventory = player.getComponent(
      EntityComponentTypes.Inventory,
    ) as EntityInventoryComponent | undefined;
    const spyglass = new ItemStack(SPECTATE_ITEM, 1);
    spyglass.lockMode = ItemLockMode.slot;
    inventory?.container?.addItem(spyglass);
  } catch {
    // 忽略
  }
  const targets = alivePlayers(runtime, roomId, session);
  setSpectateTarget(session, player, targets[0]);
  runtime.announce(roomId, `§c${player.name} 掉出场地,被淘汰!`);
}

// ===== HUD =====

function updateHud(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  const cfg = getFrozenFloorConfig();
  const alive = alivePlayers(runtime, roomId, session);
  const remainSeconds = Math.max(
    0,
    Math.ceil((session.nextMeltTick - system.currentTick) / 20),
  );
  const stageText =
    session.meltStage >= cfg.meltTimes
      ? "§c不再融化"
      : session.melting
        ? `§e第 ${session.meltStage + 1}/${cfg.meltTimes} 轮融化中`
        : `§7下次融化 ${remainSeconds} 秒`;
  for (const player of runtime.roomPlayers(roomId)) {
    const isAlive = session.alive.has(player.id);
    if (isAlive) {
      setHudTitle(
        player,
        hudMessage([
          { text: "§b冰冻地板§r" },
          { text: "\n" },
          { text: `存活 ${alive.length} 人` },
          { text: "\n" },
          { text: stageText },
        ]),
      );
      continue;
    }
    const targetId = session.spectators.get(player.id);
    const target = runtime
      .roomPlayers(roomId)
      .find((p) => p !== undefined && p.id === targetId);
    const rankEntry = session.ranks.get(player.id);
    setHudTitle(
      player,
      hudMessage([
        { text: "§7你已淘汰" },
        { text: "\n" },
        { text: target ? `观战 §e${target.name}` : "§7等待对局结束" },
        { text: "\n" },
        {
          text: rankEntry
            ? `§7名次 第${rankEntry.rank}名`
            : "§7未上榜(退出/未淘汰)",
        },
        { text: "\n" },
        { text: `存活 ${alive.length} 人` },
      ]),
    );
  }
}

// ===== 融化逻辑 =====

function collectMeltPositions(
  cfg: FrozenFloorConfig,
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): { x: number; z: number }[] {
  const dim = runtime.roomDim(roomId);
  const centerX = Math.floor(cfg.arenaCenter.x);
  const centerZ = Math.floor(cfg.arenaCenter.z);
  const ringY = Math.floor(cfg.ringY);
  const current = radiiAt(cfg, session.meltStage);
  const next = radiiAt(cfg, session.meltStage + 1);
  const minX = Math.floor(centerX - current.outer - 1);
  const maxX = Math.ceil(centerX + current.outer + 1);
  const minZ = Math.floor(centerZ - current.outer - 1);
  const maxZ = Math.ceil(centerZ + current.outer + 1);
  const positions: { x: number; z: number }[] = [];
  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      const dx = x - centerX;
      const dz = z - centerZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < next.inner || dist > next.outer) {
        try {
          const block = dim.getBlock({ x, y: ringY, z });
          if (block?.typeId === BLUE_ICE) {
            positions.push({ x, z });
          }
        } catch {
          // 忽略
        }
      }
    }
  }
  return positions;
}

function startMelt(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  const cfg = getFrozenFloorConfig();
  session.melting = true;
  session.meltIndex = 0;
  session.meltQueue = collectMeltPositions(cfg, runtime, roomId, session);
  runtime.announce(
    roomId,
    `§e第 ${session.meltStage + 1}/${cfg.meltTimes} 轮融化开始!场地正在收缩…`,
  );
}

function processMelt(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  const cfg = getFrozenFloorConfig();
  const dim = runtime.roomDim(roomId);
  const ringY = Math.floor(cfg.ringY);
  const totalTicks = Math.max(1, Math.round(cfg.meltAnimationSeconds * 20));
  const total = session.meltQueue.length;
  const batchSize = Math.max(1, Math.ceil(total / totalTicks));
  const end = Math.min(total, session.meltIndex + batchSize);
  for (let i = session.meltIndex; i < end; i++) {
    const pos = session.meltQueue[i];
    try {
      dim.setBlockType({ x: pos.x, y: ringY, z: pos.z }, AIR);
      dim.setBlockType({ x: pos.x, y: ringY - 1, z: pos.z }, AIR);
    } catch {
      // 忽略
    }
  }
  session.meltIndex = end;
  if (session.meltIndex >= total) {
    session.melting = false;
    session.meltStage++;
    session.nextMeltTick = system.currentTick + cfg.meltIntervalSeconds * 20;
    runtime.announce(
      roomId,
      `§a第 ${session.meltStage}/${cfg.meltTimes} 轮融化结束,场地已缩小!`,
    );
  }
}

// ===== 观战维护 =====

function tickSpectators(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  if (session.spectators.size === 0) return;
  const alive = aliveIds(runtime, roomId, session);
  const spot = spectateSpot();
  for (const [specId, targetId] of [...session.spectators.entries()]) {
    const spectator = runtime
      .roomPlayers(roomId)
      .find((p) => p !== undefined && p.id === specId);
    if (!spectator) {
      const gone = world.getAllPlayers().find((p) => p.id === specId);
      try {
        gone?.camera.clear();
      } catch {
        // 忽略
      }
      session.spectators.delete(specId);
      continue;
    }
    if (spectator.location.y < spot.y - 3) {
      try {
        runtime.teleportPlayer(roomId, spectator, spot);
      } catch {
        // 忽略
      }
    }
    if (!alive.includes(targetId)) {
      const next = alivePlayers(runtime, roomId, session)[0];
      if (!next) {
        spectator.camera.clear();
        continue;
      }
      setSpectateTarget(session, spectator, next);
    }
  }
}

// ===== 排名与结束判定 =====

/** 当场上只剩 3 人时,公布前三名 */
function announceTop3(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  if (session.top3Announced) return;
  const alive = alivePlayers(runtime, roomId, session);
  if (alive.length !== 3) return;
  session.top3Announced = true;
  runtime.announce(
    roomId,
    `§6=== 前三名已产生 ===§r\n§e${alive.map((p) => p.name).join("、")}`,
  );
}

/** 对局结束时公布最终前三名(包含已淘汰后退出的玩家) */
function announceFinalRanking(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  const alive = alivePlayers(runtime, roomId, session);
  if (alive.length === 1) {
    session.ranks.set(alive[0].id, { name: alive[0].name, rank: 1 });
  }
  const ranked = [...session.ranks.values()]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3);
  if (ranked.length === 0) {
    runtime.announce(roomId, "§7本局无人上榜");
    return;
  }
  const lines = ranked.map((entry) => `§e第${entry.rank}名 §f${entry.name}`);
  runtime.announce(roomId, `§6=== 最终排名(前三) ===§r\n${lines.join("\n")}`);
}

function checkEnd(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  const present = alivePlayers(runtime, roomId, session);
  if (present.length === 1) {
    session.ranks.set(present[0].id, { name: present[0].name, rank: 1 });
    announceFinalRanking(runtime, roomId, session);
    runtime.endGame(
      roomId,
      "游戏结束",
      `§e${present[0].name} 存活到最后,获得最终胜利!`,
    );
  } else if (present.length === 0) {
    announceFinalRanking(runtime, roomId, session);
    runtime.endGame(
      roomId,
      "全员淘汰",
      session.alive.size === 0 ? "§e全部玩家掉出场地,平局!" : "§e对局结束",
    );
  }
}

// ===== 雪球补给 =====

function refillSnowballs(player: Player): void {
  try {
    const inventory = player.getComponent(
      EntityComponentTypes.Inventory,
    ) as EntityInventoryComponent | undefined;
    const container = inventory?.container;
    if (!container) return;
    for (let slot = 0; slot < 9; slot++) {
      const existing = container.getItem(slot);
      if (existing && existing.typeId !== SNOWBALL_ITEM) continue;
      const snowball = new ItemStack(
        SNOWBALL_ITEM,
        getFrozenFloorConfig().snowballStackSize,
      );
      snowball.lockMode = ItemLockMode.slot;
      container.setItem(slot, snowball);
    }
  } catch {
    // 忽略
  }
}

/** 用“虚弱 255(无粒子)”持续压制近战伤害,保留原版攻击反馈但不造成伤害 */
function applyNoMeleeWeakness(player: Player): void {
  try {
    player.addEffect("weakness", 200, {
      amplifier: 255,
      showParticles: false,
    });
  } catch {
    // 忽略
  }
}

// ===== 钩子与初始化 =====

export function makeFrozenFloorHooks(
  getRuntime: () => MinigameRuntime,
): MinigameHooks {
  return {
    onGameStart(roomId, players) {
      const runtime = getRuntime();
      const cfg = getFrozenFloorConfig();
      const session: Session = {
        alive: new Set(players.map((p) => p.id)),
        spectators: new Map(),
        ranks: new Map(),
        top3Announced: false,
        meltStage: 0,
        nextMeltTick: system.currentTick + cfg.meltIntervalSeconds * 20,
        melting: false,
        meltQueue: [],
        meltIndex: 0,
      };
      sessions.set(roomId, session);

      players.forEach((player, index) => {
        player.setGameMode(GameMode.Survival);
        clearAllPlayerItems(player);
        // 防止饥饿:长时间饱和
        try {
          player.addEffect("saturation", 999999, {
            amplifier: 0,
            showParticles: false,
          });
        } catch {
          // 忽略
        }
        // 用虚弱 255 取消近战伤害,同时保留原版攻击反馈
        applyNoMeleeWeakness(player);
        refillSnowballs(player);
        const spawn = ringSpawn(cfg, index, players.length);
        runtime.teleportPlayer(roomId, player, spawn);
        // 传送后再次补满,确保开局快捷栏直接就有雪球
        system.runTimeout(() => {
          if (player.isValid) refillSnowballs(player);
        }, 2);
        player.sendMessage(
          "§a冰冻地板开始!用雪球把别人打下去,小心地板每 30 秒融化!",
        );
      });

      runtime.announce(
        roomId,
        `§a冰冻地板开始!${players.length} 名玩家,每 ${cfg.meltIntervalSeconds} 秒融化一次,最后存活者获胜!`,
      );
    },
    onBeforeReset(roomId) {
      const runtime = getRuntime();
      const session = sessions.get(roomId);
      for (const player of runtime.roomPlayers(roomId)) {
        if (player === undefined) continue;
        clearHudTitle(player);
        try {
          player.camera.clear();
        } catch {
          // 忽略
        }
        player.setGameMode(GameMode.Adventure);
        clearAllPlayerItems(player);
      }
      if (session) {
        for (const [specId] of session.spectators) {
          const spectator = runtime
            .roomPlayers(roomId)
            .find((p) => p !== undefined && p.id === specId);
          try {
            spectator?.camera.clear();
          } catch {
            // 忽略
          }
        }
      }
      sessions.delete(roomId);
    },
    openConfig(player) {
      openFrozenFloorConfig(player, getRuntime());
    },
  };
}

export function initFrozenFloor(getRuntime: () => MinigameRuntime): void {
  let hudTick = 0;

  // 对局主循环:融化推进 / 淘汰判定 / 观战维护 / 胜负
  system.runInterval(() => {
    for (const [roomId, session] of [...sessions.entries()]) {
      try {
        const runtime = getRuntime();
        if (runtime.getPhase(roomId) !== "running") {
          sessions.delete(roomId);
          continue;
        }
        const cfg = getFrozenFloorConfig();

        // 持续给房间内所有玩家虚弱 255(无粒子),压制近战伤害但保留原版攻击反馈
        if (hudTick % 20 === 0) {
          for (const p of runtime.roomPlayers(roomId)) {
            if (p !== undefined) applyNoMeleeWeakness(p);
          }
        }

        if (!session.melting && session.meltStage < cfg.meltTimes) {
          if (system.currentTick >= session.nextMeltTick) {
            startMelt(runtime, roomId, session);
          }
        }
        if (session.melting) {
          processMelt(runtime, roomId, session);
        }

        if (hudTick % 5 === 0) {
          updateHud(runtime, roomId, session);
        }

        // 离场清理:掉线/回大厅的存活玩家视为淘汰
        const inRoomIds = new Set(
          runtime
            .roomPlayers(roomId)
            .filter((p) => p !== undefined)
            .map((p) => p.id),
        );
        for (const id of [...session.alive]) {
          if (!inRoomIds.has(id)) {
            session.alive.delete(id);
            runtime.announce(roomId, `§7有玩家离开场地,视为淘汰`);
          }
        }

        // 淘汰判定
        for (const player of alivePlayers(runtime, roomId, session)) {
          if (player.location.y < getFrozenFloorConfig().voidY) {
            eliminatePlayer(runtime, roomId, session, player);
          }
        }
        announceTop3(runtime, roomId, session);
        tickSpectators(runtime, roomId, session);
        checkEnd(runtime, roomId, session);
      } catch (error) {
        console.warn(
          `[Bearcade frozenfloor] 对局 tick 异常 room=${roomId}`,
          error,
        );
      }
    }
    hudTick++;
  }, 2);

  // 雪球命中击退
  world.afterEvents.projectileHitEntity.subscribe((event) => {
    try {
      if (event.projectile.typeId !== SNOWBALL_ITEM) return;
      const source = event.source;
      if (!source || source.typeId !== "minecraft:player") return;
      const info = event.getEntityHit();
      const victim = info.entity;
      if (!victim || victim.typeId !== "minecraft:player") return;
      const roomId = getRuntime().roomIdFromDimension(event.dimension.id);
      if (roomId === undefined) return;
      const session = sessions.get(roomId);
      if (!session) return;
      if (!session.alive.has(source.id) || !session.alive.has(victim.id)) return;
      const cfg = getFrozenFloorConfig();
      const dir = event.hitVector;
      const len = Math.hypot(dir.x, dir.z) || 1;
      victim.applyKnockback(
        {
          x: (dir.x / len) * cfg.snowballKnockback,
          z: (dir.z / len) * cfg.snowballKnockback,
        },
        cfg.snowballVerticalKnockback,
      );
      // 补回原版“受击反馈”:受击音效 + 暴击粒子,但不造成伤害
      try {
        victim.dimension.playSound("game.player.hurt", victim.location);
      } catch {
        // 忽略
      }
      try {
        victim.dimension.spawnParticle("minecraft:critical_hit_emitter", {
          x: victim.location.x,
          y: victim.location.y + 1,
          z: victim.location.z,
        });
      } catch {
        // 忽略
      }
    } catch (error) {
      console.warn("[Bearcade frozenfloor] 雪球击退处理失败", error);
    }
  });

  // 无限雪球:使用后补满快捷栏
  world.afterEvents.itemUse.subscribe((event) => {
    if (event.itemStack.typeId !== SNOWBALL_ITEM) return;
    const player = event.source;
    const roomId = getRuntime().roomIdFromDimension(player.dimension.id);
    if (roomId === undefined) return;
    const session = sessions.get(roomId);
    if (!session || !session.alive.has(player.id)) return;
    system.runTimeout(() => {
      try {
        if (!player.isValid) return;
        const current = getRuntime().roomIdFromDimension(player.dimension.id);
        if (current !== roomId) return;
        const sessionNow = sessions.get(roomId);
        if (!sessionNow || !sessionNow.alive.has(player.id)) return;
        refillSnowballs(player);
      } catch {
        // 忽略
      }
    }, 1);
  });

  // 观战切换:淘汰玩家手持望远镜右键/长按 → 切换观战对象
  world.afterEvents.itemUse.subscribe((event) => {
    if (event.itemStack.typeId !== SPECTATE_ITEM) return;
    const player = event.source;
    const roomId = getRuntime().roomIdFromDimension(player.dimension.id);
    if (roomId === undefined) return;
    const session = sessions.get(roomId);
    if (!session) return;
    if (!session.spectators.has(player.id)) return;
    const current = session.spectators.get(player.id);
    const alive = aliveIds(getRuntime(), roomId, session);
    if (alive.length === 0) return;
    const idx = alive.indexOf(current ?? "");
    const nextId = alive[(idx + 1) % alive.length];
    const target = getRuntime()
      .roomPlayers(roomId)
      .find((p) => p !== undefined && p.id === nextId);
    setSpectateTarget(session, player, target);
  });

  // 观战玩家离开房间维度时清除相机
  world.afterEvents.playerDimensionChange.subscribe((event) => {
    const roomId = getRuntime().roomIdFromDimension(event.fromDimension.id);
    if (roomId === undefined) return;
    const session = sessions.get(roomId);
    if (!session?.spectators.has(event.player.id)) return;
    session.spectators.delete(event.player.id);
    try {
      event.player.camera.clear();
    } catch {
      // 忽略
    }
  });
}
