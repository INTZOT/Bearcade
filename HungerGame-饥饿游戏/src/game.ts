// ============================================================
// HungerGame(饥饿游戏)玩法实现
// FFA 大逃杀:等分圆出生 → 冻结 → 保护期 → PVP → 死斗 → 扣血保底
// 阶段:1冻结 2保护 3PVP一 4PVP二(中心箱升4级) 5死斗 6扣血
// 地图死场景(canPlace 全拦截),死亡掉包 + 观战(follow_orbit attach)
// ============================================================
import {
  system,
  world,
  GameMode,
  InputPermissionCategory,
  EntityComponentTypes,
  type EntityInventoryComponent,
  Player,
  type PlayerPlaceBlockBeforeEvent,
} from "@minecraft/server";
import type { MinigameHooks } from "../../shared/minigame-core/types";
import { stripSectionCodes } from "../../shared/minigame-core/text";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { hudMessage, setHudTitle, clearHudTitle } from "../../shared/minigame-core/scoreboardHud";
import { getHungerGameConfig, openHungerGameConfig } from "./game-config";
import {
  fillChest,
  resetCenterChests,
  getCenterChestLevel,
  resetChestState,
  isChestBlock,
} from "./chests";
import { attachSpectateCamera, startSpectating, clearSpectate } from "./spectate";
import { SPECTATE_ITEM, MAX_PLAYERS } from "./config";

type Phase = 1 | 2 | 3 | 4 | 5 | 6;

interface HungerGameState {
  phase: Phase;
  phaseEndTick: number;
  /** 阶段6 下次扣血 tick */
  nextBleedTick: number;
  /** 存活玩家 id */
  alive: Set<string>;
  /** 击杀数 playerId -> count */
  kills: Map<string, number>;
  /** 观战者 id -> 观战目标 id */
  spectators: Map<string, string>;
}

const games = new Map<number, HungerGameState>();

const PHASE_NAMES: Record<Phase, string> = {
  1: "冻结",
  2: "保护期",
  3: "PVP 一阶段",
  4: "PVP 二阶段",
  5: "死斗",
  6: "扣血保底",
};

function phaseSeconds(cfg: ReturnType<typeof getHungerGameConfig>, phase: Phase): number {
  switch (phase) {
    case 1: return cfg.freezeSeconds;
    case 2: return cfg.protectSeconds;
    case 3: return cfg.pvp1Seconds;
    case 4: return cfg.pvp2Seconds;
    case 5: return cfg.duelSeconds;
    default: return 0;
  }
}

// ================= 出生与冻结 =================

function clearInventory(player: Player): void {
  try {
    const inventory = player.getComponent(
      EntityComponentTypes.Inventory,
    ) as EntityInventoryComponent | undefined;
    inventory?.container?.clearAll();
  } catch {
    // 忽略
  }
}

function freezePlayer(player: Player, frozen: boolean): void {
  try {
    player.inputPermissions.setPermissionCategory(
      InputPermissionCategory.Movement,
      !frozen,
    );
  } catch (error) {
    console.warn("[Bearcade hungergame] 输入权限设置失败", error);
  }
}

/** 等分圆出生(派对超员第二圈) */
function spawnCircle(
  runtime: MinigameRuntime,
  roomId: number,
  state: HungerGameState,
  cfg: ReturnType<typeof getHungerGameConfig>,
): void {
  const players = alivePlayers(runtime, roomId, state);
  const n = players.length;
  const radius = n > MAX_PLAYERS ? cfg.spawnRadiusParty : cfg.spawnRadius;
  players.forEach((player, i) => {
    const angle = (2 * Math.PI * i) / n;
    runtime.teleportPlayer(roomId, player, {
      x: cfg.spawnCenter.x + radius * Math.cos(angle),
      y: cfg.spawnCenter.y,
      z: cfg.spawnCenter.z + radius * Math.sin(angle),
    });
    freezePlayer(player, true);
  });
}

function alivePlayers(
  runtime: MinigameRuntime,
  roomId: number,
  state: HungerGameState,
): Player[] {
  return runtime
    .roomPlayers(roomId)
    .filter((p) => p !== undefined && state.alive.has(p.id)) as Player[];
}

// ================= 阶段机 =================

function startDuel(
  runtime: MinigameRuntime,
  roomId: number,
  state: HungerGameState,
  cfg: ReturnType<typeof getHungerGameConfig>,
): void {
  const players = alivePlayers(runtime, roomId, state);
  const n = players.length;
  if (n === 0) return;
  players.forEach((player, i) => {
    const angle = (2 * Math.PI * i) / n;
    runtime.teleportPlayer(roomId, player, {
      x: cfg.duelCenter.x + cfg.duelRadius * Math.cos(angle),
      y: cfg.duelCenter.y,
      z: cfg.duelCenter.z + cfg.duelRadius * Math.sin(angle),
    });
    player.setGameMode(GameMode.Survival);
  });
}

function advancePhase(
  runtime: MinigameRuntime,
  roomId: number,
  state: HungerGameState,
  cfg: ReturnType<typeof getHungerGameConfig>,
): void {
  const next = (state.phase + 1) as Phase;
  state.phase = next;
  state.phaseEndTick = system.currentTick + phaseSeconds(cfg, next) * 20;
  switch (next) {
    case 2:
      runtime.announce(roomId, "§e阶段2 保护期:可自由移动与搜刮,暂不可战斗");
      for (const p of alivePlayers(runtime, roomId, state)) {
        freezePlayer(p, false);
      }
      break;
    case 3:
      runtime.announce(roomId, "§c阶段3 战斗开始!玩家间伤害已开放");
      break;
    case 4:
      resetCenterChests(runtime.roomDim(roomId).id);
      runtime.announce(
        roomId,
        `§e阶段4 中心区物资升级为 ${getCenterChestLevel(runtime.roomDim(roomId).id)} 级,可再次搜刮!`,
      );
      break;
    case 5:
      startDuel(runtime, roomId, state, cfg);
      runtime.announce(roomId, "§d阶段5 死斗!剩余玩家已传送至最终决战场所");
      break;
    case 6:
      state.nextBleedTick = system.currentTick + cfg.bleedInterval * 20;
      runtime.announce(
        roomId,
        `§c阶段6 扣血保底:每 ${cfg.bleedInterval} 秒全员 -${cfg.bleedDamage} 生命`,
      );
      break;
  }
}

function bleedAll(
  runtime: MinigameRuntime,
  roomId: number,
  state: HungerGameState,
  cfg: ReturnType<typeof getHungerGameConfig>,
): void {
  for (const p of alivePlayers(runtime, roomId, state)) {
    try {
      p.applyDamage(cfg.bleedDamage);
    } catch {
      // 忽略
    }
  }
}

/** 胜负判定:返回 true 表示对局已结束 */
function checkEnd(runtime: MinigameRuntime, roomId: number, state: HungerGameState): boolean {
  const alive = [...state.alive];
  if (alive.length === 0) {
    runtime.endGame(roomId, "全员淘汰", "§e全员同归于尽,并列第一");
    return true;
  }
  if (alive.length === 1) {
    const winner = runtime
      .roomPlayers(roomId)
      .find((p) => p !== undefined && p.id === alive[0]);
    runtime.endGame(
      roomId,
      "胜利",
      winner
        ? `§b${stripSectionCodes(winner.name)} 最后存活,获胜!`
        : "§b最后存活者已离场,对局结束",
    );
    return true;
  }
  return false;
}

function tickPhase(
  runtime: MinigameRuntime,
  roomId: number,
  state: HungerGameState,
): void {
  const cfg = getHungerGameConfig();
  if (checkEnd(runtime, roomId, state)) return;
  if (state.phase <= 5 && system.currentTick >= state.phaseEndTick) {
    advancePhase(runtime, roomId, state, cfg);
  }
  if (state.phase === 6 && system.currentTick >= state.nextBleedTick) {
    state.nextBleedTick = system.currentTick + cfg.bleedInterval * 20;
    bleedAll(runtime, roomId, state, cfg);
  }
}

// ================= HUD =================

function updateHud(
  runtime: MinigameRuntime,
  roomId: number,
  state: HungerGameState,
): void {
  const phaseName = PHASE_NAMES[state.phase];
  for (const player of runtime.roomPlayers(roomId)) {
    if (player === undefined) continue;
    const spectating = state.spectators.has(player.id);
    const kills = state.kills.get(player.id) ?? 0;
    setHudTitle(
      player,
      hudMessage([
        { text: `§e存活 ${state.alive.size} 人 | 阶段:${phaseName}` },
        {
          text: spectating
            ? ` | §7观战中 §f| 击杀 ${kills}`
            : ` | §f击杀 ${kills}`,
        },
      ]),
      40,
    );
  }
}

// ================= 死亡 / 淘汰 =================

function nearestAlive(
  runtime: MinigameRuntime,
  roomId: number,
  state: HungerGameState,
  from: Player,
): Player | undefined {
  const alive = alivePlayers(runtime, roomId, state);
  if (alive.length === 0) return undefined;
  let best: Player | undefined;
  let bestDist = Infinity;
  for (const p of alive) {
    const d = Math.hypot(
      p.location.x - from.location.x,
      p.location.z - from.location.z,
    );
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

function eliminatePlayer(
  runtime: MinigameRuntime,
  roomId: number,
  state: HungerGameState,
  dead: Player,
  killerName: string,
): void {
  if (!state.alive.delete(dead.id)) return;
  runtime.announce(
    roomId,
    `§c${stripSectionCodes(dead.name)} 被淘汰(${killerName}),剩余 ${state.alive.size} 人`,
  );
  const target = nearestAlive(runtime, roomId, state, dead);
  state.spectators.set(dead.id, target?.id ?? "");
  startSpectating(
    runtime,
    roomId,
    dead,
    target,
    getHungerGameConfig().spectateSpot,
  );
}

// ================= 钩子 =================

export function makeHungerGameHooks(
  getRuntime: () => MinigameRuntime,
): MinigameHooks {
  return {
    onGameStart(roomId, players) {
      const runtime = getRuntime();
      const cfg = getHungerGameConfig();
      const state: HungerGameState = {
        phase: 1,
        phaseEndTick: system.currentTick + cfg.freezeSeconds * 20,
        nextBleedTick: 0,
        alive: new Set(players.map((p) => p.id)),
        kills: new Map(),
        spectators: new Map(),
      };
      games.set(roomId, state);
      // 清除上一局的物资箱填充状态(按维度隔离),避免第二局箱子不填充/中心箱等级漂移
      resetChestState(runtime.roomDim(roomId).id);
      for (const player of players) {
        player.setGameMode(GameMode.Survival);
        clearInventory(player);
      }
      spawnCircle(runtime, roomId, state, cfg);
      runtime.announce(
        roomId,
        `§e饥饿游戏开始!${players.length} 名玩家,阶段1:冻结 ${cfg.freezeSeconds} 秒`,
      );
    },
    onBeforeReset(roomId) {
      const runtime = getRuntime();
      for (const player of runtime.roomPlayers(roomId)) {
        if (player === undefined) continue;
        clearHudTitle(player);
        try {
          player.setGameMode(GameMode.Adventure);
        } catch {
          // 忽略
        }
        freezePlayer(player, false);
        clearSpectate(player);
      }
      // 清理死场景上的遗留掉落物(地图不重建,掉包需每局清空)
      try {
        const items = runtime
          .roomDim(roomId)
          .getEntities({ type: "minecraft:item" });
        for (const item of items) {
          item.remove();
        }
      } catch {
        // 忽略
      }
      games.delete(roomId);
    },
    canPlace(event: PlayerPlaceBlockBeforeEvent, roomId: number) {
      // 地图死场景:禁止一切放置
      void event;
      void roomId;
      return false;
    },
    openConfig(player) {
      openHungerGameConfig(player, getRuntime());
    },
  };
}

// ================= 初始化 =================

export function initHungerGame(getRuntime: () => MinigameRuntime): void {
  const runtime = getRuntime();

  // 阶段推进 + HUD(1s 主循环)
  system.runInterval(() => {
    for (const [roomId, state] of [...games.entries()]) {
      try {
        if (runtime.getPhase(roomId) !== "running") continue;
        tickPhase(runtime, roomId, state);
        updateHud(runtime, roomId, state);
      } catch (error) {
        console.warn(`[Bearcade hungergame] 主循环异常 room=${roomId}`, error);
      }
    }
  }, 20);

  // 玩家间伤害过滤:阶段 1/2 禁 PVP
  world.beforeEvents.entityHurt.subscribe((event) => {
    const hurt = event.hurtEntity;
    if (!(hurt instanceof Player)) return;
    const roomId = runtime.roomIdFromDimension(hurt.dimension.id);
    if (roomId === undefined) return;
    const state = games.get(roomId);
    if (!state) return;
    const attacker = event.damageSource?.damagingEntity;
    if (
      attacker instanceof Player &&
      state.alive.has(attacker.id) &&
      state.phase < 3
    ) {
      event.cancel = true;
    }
  });

  // 死亡淘汰
  world.afterEvents.entityDie.subscribe((event) => {
    const dead = event.deadEntity;
    if (!(dead instanceof Player)) return;
    const roomId = runtime.roomIdFromDimension(dead.dimension.id);
    if (roomId === undefined) return;
    const state = games.get(roomId);
    if (!state || !state.alive.has(dead.id)) return;
    const killer = event.damageSource?.damagingEntity;
    let killerName = "环境";
    if (killer instanceof Player && state.alive.has(killer.id)) {
      state.kills.set(killer.id, (state.kills.get(killer.id) ?? 0) + 1);
      killerName = stripSectionCodes(killer.name);
    }
    eliminatePlayer(runtime, roomId, state, dead, killerName);
    checkEnd(runtime, roomId, state);
  });

  // 物资箱热刷新(打开瞬间填充;阶段1禁止开箱)
  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (!isChestBlock(event.block.typeId)) return;
    const roomId = runtime.roomIdFromDimension(event.block.dimension.id);
    if (roomId === undefined) return;
    const state = games.get(roomId);
    if (!state || runtime.getPhase(roomId) !== "running") return;
    if (state.phase === 1) {
      event.cancel = true;
      return;
    }
    // restricted execution:Container.setItem 等原生调用禁止在 before 事件中执行,
    // 延迟到正常上下文再填充(箱子 UI 会自动同步填充后的内容)
    const dimId = event.block.dimension.id;
    const location = event.block.location;
    system.run(() => {
      try {
        const block = world.getDimension(dimId).getBlock(location);
        if (block) fillChest(getRuntime, roomId, block);
      } catch (error) {
        console.warn("[Bearcade hungergame] 物资箱填充失败", error);
      }
    });
  });

  // 观战切换:望远镜轮换目标
  world.afterEvents.itemUse.subscribe((event) => {
    if (event.itemStack.typeId !== SPECTATE_ITEM) return;
    const roomId = runtime.roomIdFromDimension(event.source.dimension.id);
    if (roomId === undefined) return;
    const state = games.get(roomId);
    if (!state || !state.spectators.has(event.source.id)) return;
    const alive = alivePlayers(runtime, roomId, state);
    if (alive.length === 0) return;
    const current = state.spectators.get(event.source.id);
    const idx = alive.findIndex((p) => p.id === current);
    const next = alive[(idx + 1) % alive.length];
    state.spectators.set(event.source.id, next.id);
    attachSpectateCamera(event.source, next);
    event.source.sendMessage(`§7正在观战 §e${stripSectionCodes(next.name)}`);
  });

  // 离房处理:存活者视为淘汰,观战者清理
  world.afterEvents.playerDimensionChange.subscribe((event) => {
    const roomId = runtime.roomIdFromDimension(event.fromDimension.id);
    if (roomId === undefined) return;
    const state = games.get(roomId);
    if (!state) return;
    if (state.alive.has(event.player.id)) {
      state.alive.delete(event.player.id);
      runtime.announce(
        roomId,
        `§c${stripSectionCodes(event.player.name)} 离开,视为淘汰,剩余 ${state.alive.size} 人`,
      );
      checkEnd(runtime, roomId, state);
    }
    if (state.spectators.has(event.player.id)) {
      state.spectators.delete(event.player.id);
      clearSpectate(event.player);
    }
  });

  // 断线处理:playerLeave 不触发维度变化,必须显式把断线玩家视作淘汰,
  // 否则断线者残留在 alive 集合中,checkEnd 永不成立,对局无法结束
  world.afterEvents.playerLeave.subscribe((event) => {
    for (const [roomId, state] of games) {
      try {
        if (state.alive.delete(event.playerId)) {
          runtime.announce(
            roomId,
            `§c有玩家断线,视为淘汰,剩余 ${state.alive.size} 人`,
          );
          checkEnd(runtime, roomId, state);
        }
        state.spectators.delete(event.playerId);
      } catch (error) {
        console.warn(
          `[Bearcade hungergame] 断线清理异常 room=${roomId}`,
          error,
        );
      }
    }
  });
}
