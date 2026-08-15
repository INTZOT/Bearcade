// ============================================================
// Collapse(豆腐渣地板)玩法实现
// - 塌陷状态机:玩家脚下的白色混凝土被踩后进入塌陷
//   (黄 1s → 橙 1s → 红 1s → 消失),离开后继续塌;
// - PVP:开局 PVP_DELAY_TICKS 后开启,玩家可互相攻击;
// - 淘汰:掉到 VOID_Y 以下 → 淘汰 → 观战:follow_orbit 预设 + /camera attach
//   引擎绑定到存活玩家(鼠标可环绕视角,切换目标带 0.5s 平滑运镜),
//   手持望远镜(SPECTATE_ITEM)切换观战对象;
// - 胜负:最后 1 名存活者获胜;全部淘汰则平局。
// ============================================================
import {
  system,
  world,
  EasingType,
  GameMode,
  ItemLockMode,
  ItemStack,
  EntityComponentTypes,
  type EntityInventoryComponent,
  type Player,
} from "@minecraft/server";
import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { getCollapseConfig, openCollapseConfig } from "./collapse-config";
import {
  FLOOR_BLOCK,
  SPECTATE_ITEM,
  STAGE_BLOCKS,
} from "./config";

interface CollapseBlock {
  /** 已应用的阶段(0=白色初始,1=黄,2=橙,3=红,4=消失) */
  stage: number;
  /** 激活(被踩)时的 tick */
  sinceTick: number;
}

interface Session {
  alive: Set<string>;
  pvpTick: number;
  /** 塌陷中的方块:key=`x,y,z` -> 状态 */
  floorBlocks: Map<string, CollapseBlock>;
  /** 观战玩家 id -> 观战目标玩家 id */
  spectators: Map<string, string>;
  pvpAnnounced: boolean;
}

const sessions = new Map<number, Session>();

function blockKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/** 场地范围(含多层:只限 x/z,不限 y) */
function inArena(x: number, z: number): boolean {
  const cfg = getCollapseConfig();
  const half = Math.floor(cfg.arenaSize / 2);
  return (
    x >= cfg.arenaCenter.x - half &&
    x <= cfg.arenaCenter.x + half &&
    z >= cfg.arenaCenter.z - half &&
    z <= cfg.arenaCenter.z + half
  );
}

/** 玩家脚下方块(整数坐标) */
function blockBelow(player: Player): { x: number; y: number; z: number } {
  const loc = player.location;
  return {
    x: Math.floor(loc.x),
    y: Math.floor(loc.y) - 1,
    z: Math.floor(loc.z),
  };
}

/** 开局环形散开落点(场地中心,顶层上方) */
function ringSpawn(
  index: number,
  count: number,
): { x: number; y: number; z: number } {
  const cfg = getCollapseConfig();
  const angle = (index / Math.max(1, count)) * Math.PI * 2;
  const radius = Math.min(4, Math.floor(cfg.arenaSize / 4));
  return {
    x: cfg.arenaCenter.x + Math.round(radius * Math.cos(angle)),
    y: cfg.topY + 1,
    z: cfg.arenaCenter.z + Math.round(radius * Math.sin(angle)),
  };
}

/** 存活玩家对象列表 */
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

// ===== 观战相机:follow_orbit 预设 + attach 引擎绑定 =====
// 依赖:世界实验开关 "Creator Cameras: New Third Person Presets"
// + 世界作弊(/camera 命令需要 cheats);自定义预设见
// cameras/presets/spectate.json(继承 follow_orbit,半径 6)

/** 附加命令用临时 tag(观战者 / 目标,命令执行后移除) */
const SPEC_OWNER_TAG = "bearcade:spec_owner";
const SPEC_TARGET_TAG = "bearcade:spec_target";
/** 环绕半径(与 spectate.json 的 radius 一致) */
const ORBIT_RADIUS = 6;
/** 预设起始俯仰角(度,正=向下)与起始环绕角(0=南/+z,与 JSON starting_rot 一致) */
const ORBIT_PITCH_DEG = 15;
const ORBIT_YAW_DEG = 0;
/** 切换观战目标时的运镜时长(tick):free 相机缓动飞向新目标的环绕起点 */
const GLIDE_TICKS = 10;

/** 环绕起点位置:目标 + 半径 × 起始角(与预设 starting_rot 几何一致) */
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

/** 从相机位置看向目标眼睛的旋转角(/tp 约定:rot_y 0=南+顺时针,rot_x 正=向下) */
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

/**
 * 引擎级附加:follow_orbit 预设 + /camera attach_to_entity。
 * 用维度服务器上下文执行命令(免玩家权限,仅需世界作弊),
 * 临时 tag 定位观战者与目标。
 */
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
    console.warn("[Bearcade collapse] 观战相机附加失败", error);
  }
}

/**
 * 观战相机切换(平滑运镜):free 相机以缓动飞向新目标的环绕起点(引擎从
 * 当前相机状态开始插值,无需知道当前位置),到达后切回 orbit 预设并 attach。
 */
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
        // 自定义预设(半径 6)未加载时回退内置 follow_orbit(半径 10,起点几何不同,
        // 会有一个小 snap,但保证功能可用)
        try {
          spectator.camera.setCamera("bearcade:spectate_orbit");
        } catch {
          spectator.camera.setCamera("minecraft:follow_orbit");
        }
        attachSpectateCamera(spectator, target);
      } catch (error) {
        console.warn("[Bearcade collapse] 观战相机附加失败", error);
      }
    }, GLIDE_TICKS + 2);
  } catch (error) {
    console.warn("[Bearcade collapse] 观战相机运镜失败", error);
  }
}

/** 让淘汰玩家观战指定目标(follow_orbit 引擎绑定,切换带平滑运镜) */
function setSpectateTarget(
  runtime: MinigameRuntime,
  roomId: number,
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

/** 观战台位置(淘汰玩家本体传送至此,可经 /bearcade:config 配置) */
function spectateSpot(): { x: number; y: number; z: number } {
  return getCollapseConfig().spectateSpot;
}

/** 淘汰玩家:进入观战(冒险模式 + 观战台 + 第三人称跟随,望远镜可切换) */
function eliminatePlayer(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
  player: Player,
): void {
  session.alive.delete(player.id);
  // 不用旁观者模式:旁观者无法手持物品,望远镜切换观战不可用;
  // 用冒险模式 + 观战台 + Camera 锁定,PVP 与淘汰判定已排除淘汰者
  player.setGameMode(GameMode.Adventure);
  try {
    runtime.teleportPlayer(roomId, player, spectateSpot());
  } catch {
    // 忽略
  }
  try {
    const inventory = player.getComponent(
      EntityComponentTypes.Inventory,
    ) as EntityInventoryComponent | undefined;
    // 锁定槽位:防止观战者丢弃/移动望远镜导致无法切换观战对象
    const spyglass = new ItemStack(SPECTATE_ITEM, 1);
    spyglass.lockMode = ItemLockMode.slot;
    inventory?.container?.addItem(spyglass);
  } catch {
    // 忽略
  }
  const targets = alivePlayers(runtime, roomId, session);
  setSpectateTarget(runtime, roomId, session, player, targets[0]);
  runtime.announce(roomId, `§c${player.name} 掉出场地,被淘汰!`);
}

function checkEnd(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  // 以"实际在场的存活玩家"为准判定,而非 session.alive.size:
  // 掉线/回大厅的玩家可能残留在 alive 集合中(不占判定),否则会出现
  // "仅 1 人存活但 alive.size > 1"导致游戏不结束
  const present = alivePlayers(runtime, roomId, session);
  if (present.length === 1) {
    runtime.endGame(
      roomId,
      "游戏结束",
      `§e${present[0].name} 存活到最后,获得最终胜利!`,
    );
  } else if (present.length === 0) {
    runtime.endGame(
      roomId,
      "全员淘汰",
      session.alive.size === 0 ? "§e全部玩家掉出场地,平局!" : "§e对局结束",
    );
  }
}

/** 塌陷状态机推进(interval 回调) */
function tickFloor(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  const dim = runtime.roomDim(roomId);
  const now = system.currentTick;
  const stageTicks = getCollapseConfig().stageSeconds * 20;

  // 1. 玩家脚下 3×3 白色混凝土 → 激活塌陷
  for (const player of alivePlayers(runtime, roomId, session)) {
    const below = blockBelow(player);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const x = below.x + dx;
        const z = below.z + dz;
        if (!inArena(x, z)) continue;
        const key = blockKey(x, below.y, z);
        if (session.floorBlocks.has(key)) continue;
        try {
          const block = dim.getBlock({ x, y: below.y, z });
          if (block?.typeId === FLOOR_BLOCK) {
            session.floorBlocks.set(key, { stage: 0, sinceTick: now });
          }
        } catch {
          // 忽略
        }
      }
    }
  }

  // 2. 推进塌陷阶段(黄→橙→红→消失)
  for (const [key, state] of [...session.floorBlocks.entries()]) {
    const [x, y, z] = key.split(",").map(Number);
    const elapsed = now - state.sinceTick;
    const expected = Math.min(4, Math.floor(elapsed / stageTicks));
    if (expected <= state.stage) continue;
    state.stage = expected;
    try {
      if (expected === 4) {
        dim.setBlockType({ x, y, z }, "minecraft:air");
        session.floorBlocks.delete(key);
      } else {
        dim.setBlockType({ x, y, z }, STAGE_BLOCKS[expected - 1]);
      }
    } catch (error) {
      console.warn("[Bearcade collapse] 塌陷方块更新失败", error);
    }
  }
}

/** PVP 开启公告 */
function tickPvp(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  if (session.pvpAnnounced) return;
  if (system.currentTick < session.pvpTick) return;
  session.pvpAnnounced = true;
  runtime.announce(
    roomId,
    "§c§lPVP 已开启!§r§c 现在可以互相攻击,把对手打下地板!",
  );
}

/** 观战目标失效时重选;淘汰玩家掉下观战台则拉回 */
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
      session.spectators.delete(specId);
      continue;
    }
    // 掉下观战台(高度异常)则拉回
    if (spectator.location.y < spot.y - 3) {
      try {
        runtime.teleportPlayer(roomId, spectator, spot);
      } catch {
        // 忽略
      }
    }
    // 目标已淘汰/离场 → 重选下一个存活玩家
    if (!alive.includes(targetId)) {
      const next = alivePlayers(runtime, roomId, session)[0];
      if (!next) {
        spectator.camera.clear();
        continue;
      }
      setSpectateTarget(runtime, roomId, session, spectator, next);
    }
  }
}

export function makeCollapseHooks(
  getRuntime: () => MinigameRuntime,
): MinigameHooks {
  return {
    onGameStart(roomId, players) {
      const runtime = getRuntime();
      const cfg = getCollapseConfig();
      const pvpDelayTicks = cfg.pvpDelaySeconds * 20;
      const session: Session = {
        alive: new Set(players.map((p) => p.id)),
        pvpTick: system.currentTick + pvpDelayTicks,
        floorBlocks: new Map(),
        spectators: new Map(),
        pvpAnnounced: false,
      };
      sessions.set(roomId, session);

      players.forEach((player, index) => {
        player.setGameMode(GameMode.Survival);
        const spawn = ringSpawn(index, players.length);
        runtime.teleportPlayer(roomId, player, spawn);
        player.sendMessage(
          "§a豆腐渣地板开始!踩过的地板会塌陷,别停下!掉出场地即淘汰,PVP 稍后开启。",
        );
      });

      runtime.announce(
        roomId,
        `§a豆腐渣地板开始!${players.length} 名玩家,${Math.round(pvpDelayTicks / 20)} 秒后开启 PVP,最后存活者获胜!`,
      );
    },
    onBeforeReset(roomId) {
      const runtime = getRuntime();
      const session = sessions.get(roomId);
      for (const player of runtime.roomPlayers(roomId)) {
        if (player === undefined) continue;
        // 清除淘汰玩家的观战相机与物品,恢复默认视角
        try {
          player.camera.clear();
        } catch {
          // 忽略
        }
        player.setGameMode(GameMode.Adventure);
        try {
          const inventory = player.getComponent(
            EntityComponentTypes.Inventory,
          ) as EntityInventoryComponent | undefined;
          const container = inventory?.container;
          if (container) {
            for (let slot = 0; slot < container.size; slot++) {
              const item = container.getItem(slot);
              if (item?.typeId === SPECTATE_ITEM) {
                container.setItem(slot, undefined);
              }
            }
          }
        } catch {
          // 忽略
        }
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
      openCollapseConfig(player, getRuntime());
    },
  };
}

export function initCollapse(getRuntime: () => MinigameRuntime): void {
  const runtime = getRuntime();

  // 对局主循环:塌陷推进 / PVP 开启 / 淘汰判定 / 观战维护 / 胜负
  // 间隔 2 tick(0.1 秒):快速奔跑时玩家脚下的地板也能及时检测,
  // 塌陷阶段按 sinceTick 计算,与间隔无关
  system.runInterval(() => {
    for (const [roomId, session] of [...sessions.entries()]) {
      try {
        if (runtime.getPhase(roomId) !== "running") {
          sessions.delete(roomId);
          continue;
        }
        tickFloor(runtime, roomId, session);
        tickPvp(runtime, roomId, session);

        // 离场清理:掉线/回大厅的存活玩家视为淘汰(避免残留在 alive 集合占名额)
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

        // 淘汰判定:掉到虚空以下的存活玩家
        for (const player of alivePlayers(runtime, roomId, session)) {
          if (player.location.y < getCollapseConfig().voidY) {
            eliminatePlayer(runtime, roomId, session, player);
          }
        }
        tickSpectators(runtime, roomId, session);
        checkEnd(runtime, roomId, session);
      } catch (error) {
        console.warn(
          `[Bearcade collapse] 对局 tick 异常 room=${roomId}`,
          error,
        );
      }
    }
  }, 2);

  // 观战切换:淘汰玩家手持望远镜使用 → 切换观战对象
  world.afterEvents.itemUse.subscribe((event) => {
    const player = event.source;
    if (event.itemStack.typeId !== SPECTATE_ITEM) return;
    const roomId = runtime.roomIdFromDimension(player.dimension.id);
    if (roomId === undefined) return;
    const session = sessions.get(roomId);
    if (!session) return;
    if (!session.spectators.has(player.id)) return;
    const current = session.spectators.get(player.id);
    const alive = aliveIds(runtime, roomId, session);
    if (alive.length === 0) return;
    const idx = alive.indexOf(current ?? "");
    const nextId = alive[(idx + 1) % alive.length];
    const target = runtime
      .roomPlayers(roomId)
      .find((p) => p !== undefined && p.id === nextId);
    setSpectateTarget(runtime, roomId, session, player, target);
  });

  // PVP 伤害控制:未开启时取消玩家间伤害;淘汰者不参与伤害
  world.beforeEvents.entityHurt.subscribe((event) => {
    const victim = event.hurtEntity;
    if (!victim || victim.typeId !== "minecraft:player") return;
    const attacker = event.damageSource?.damagingEntity;
    if (!attacker || attacker.typeId !== "minecraft:player") return;
    const roomId = runtime.roomIdFromDimension(victim.dimension.id);
    if (roomId === undefined) return;
    const session = sessions.get(roomId);
    if (!session) return;
    if (!session.alive.has(victim.id) || !session.alive.has(attacker.id)) {
      event.cancel = true;
      return;
    }
    if (system.currentTick < session.pvpTick) {
      event.cancel = true;
    }
  });
}
