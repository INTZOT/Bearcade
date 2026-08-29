import {
  EntityComponentTypes,
  GameMode,
  ItemComponentTypes,
  ItemStack,
  Player,
  system,
  world,
  type BlockInventoryComponent,
  type Dimension,
  type EntityInventoryComponent,
  type ItemDurabilityComponent,
  type PlayerBreakBlockBeforeEvent,
  type PlayerPlaceBlockBeforeEvent,
} from "@minecraft/server";
import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import {
  clearHudTitle,
  hudMessage,
  setHudTitle,
} from "../../shared/minigame-core/scoreboardHud";
import { clearAllPlayerItems } from "../../shared/minigame-core/playerItems";
import { getStudioConfig, openStudioConfig } from "./studio-config";
import type { StudioConfig } from "./config";
import {
  getBuildSize,
  materialPositions,
  refillMaterials,
} from "./map";
import {
  START_POSITIONS,
  TARGET_ITEM_NAMES,
} from "./config";

/** 秒烧配方:输入物品 ID -> 输出物品 ID */
const SMELT_RESULTS: Record<string, string> = {
  "minecraft:iron_ore": "minecraft:iron_ingot",
  "minecraft:deepslate_iron_ore": "minecraft:iron_ingot",
  "minecraft:raw_iron": "minecraft:iron_ingot",
  "minecraft:gold_ore": "minecraft:gold_ingot",
  "minecraft:deepslate_gold_ore": "minecraft:gold_ingot",
  "minecraft:raw_gold": "minecraft:gold_ingot",
  "minecraft:sand": "minecraft:glass",
  "minecraft:cobblestone": "minecraft:stone",
  "minecraft:stone": "minecraft:smooth_stone",
  "minecraft:oak_log": "minecraft:charcoal",
  "minecraft:spruce_log": "minecraft:charcoal",
  "minecraft:birch_log": "minecraft:charcoal",
  "minecraft:jungle_log": "minecraft:charcoal",
  "minecraft:acacia_log": "minecraft:charcoal",
  "minecraft:dark_oak_log": "minecraft:charcoal",
  "minecraft:mangrove_log": "minecraft:charcoal",
  "minecraft:cherry_log": "minecraft:charcoal",
};

/** 目标物品 ID 别名:旧配置可能写 redstone_comparator,实际物品 ID 是 comparator */
const TARGET_ITEM_ALIASES: Record<string, string> = {
  "minecraft:redstone_comparator": "minecraft:comparator",
};

function normalizeTargetId(itemId: string): string {
  return TARGET_ITEM_ALIASES[itemId] ?? itemId;
}

interface StudioRoomState {
  round: number;
  targetItem: string;
  targetName: string;
  roundStartedTick: number;
  firstSuccessTick?: number;
  successOrder: string[];
  successSet: Set<string>;
  usedTargets: Set<string>;
  scores: Map<string, number>;
  playerNames: Map<string, string>;
  roundAwards: { id: string; points: number }[];
  intervalId?: number;
  ended: boolean;
  materialKeys: Set<string>;
  originalMinPlayers: number;
}

const roomStates = new Map<number, StudioRoomState>();

let runtimeGetter: () => MinigameRuntime = () => {
  throw new Error("Studio runtime not initialized");
};

function getState(roomId: number): StudioRoomState {
  let state = roomStates.get(roomId);
  if (!state) {
    state = {
      round: 1,
      targetItem: "minecraft:furnace",
      targetName: "熔炉",
      roundStartedTick: 0,
      successOrder: [],
      successSet: new Set(),
      usedTargets: new Set(),
      scores: new Map(),
      playerNames: new Map(),
      roundAwards: [],
      ended: false,
      materialKeys: new Set(),
      originalMinPlayers: 2,
    };
    roomStates.set(roomId, state);
  }
  return state;
}

function targetDisplayName(itemId: string): string {
  return TARGET_ITEM_NAMES[itemId] ?? itemId;
}

function hasItem(player: Player, itemId: string): boolean {
  const targetId = normalizeTargetId(itemId);
  const inventory = player.getComponent(
    EntityComponentTypes.Inventory,
  ) as EntityInventoryComponent | undefined;
  if (!inventory?.container) return false;
  for (let slot = 0; slot < inventory.container.size; slot++) {
    const item = inventory.container.getItem(slot);
    if (item?.typeId === targetId) return true;
  }
  return false;
}

function giveTools(player: Player): void {
  const inventory = player.getComponent(
    EntityComponentTypes.Inventory,
  ) as EntityInventoryComponent | undefined;
  if (!inventory?.container) return;
  const toolIds = [
    "minecraft:diamond_pickaxe",
    "minecraft:diamond_axe",
    "minecraft:shears",
  ];
  toolIds.forEach((id, slot) => {
    const item = new ItemStack(id, 1);
    const durability = item.getComponent(
      ItemComponentTypes.Durability,
    ) as ItemDurabilityComponent | undefined;
    if (durability) {
      durability.unbreakable = true;
    }
    inventory.container.setItem(slot, item);
  });
}

/** 清空场地内所有掉落物实体 */
function clearDroppedItems(dimension: Dimension): void {
  for (const entity of dimension.getEntities({ type: "minecraft:item" })) {
    try {
      entity.remove();
    } catch {
      // 忽略已失效实体
    }
  }
}

/** 清空场地内所有熔炉/燃烧熔炉的内部物品,防止上一回合遗留 */
function resetFurnaces(dimension: Dimension, cfg: StudioConfig): void {
  const size = getBuildSize();
  const half = Math.floor(size / 2);
  for (let x = -half; x <= half; x++) {
    for (let z = -half; z <= half; z++) {
      const block = dimension.getBlock({ x, y: cfg.groundY, z });
      if (!block) continue;
      const typeId = block.typeId;
      if (typeId !== "minecraft:furnace" && typeId !== "minecraft:lit_furnace") {
        continue;
      }
      const inv = block.getComponent(
        "minecraft:inventory",
      ) as BlockInventoryComponent | undefined;
      try {
        inv?.container?.clearAll();
      } catch {
        // 个别容器访问失败时跳过,不阻断回合
      }
    }
  }
}

/** 场地内的熔炉“秒烧”:熔炉已点燃(或已有燃料)时,直接把输入槽原材料变为输出槽产物,不再额外消耗燃料 */
function processInstantFurnaces(dimension: Dimension, cfg: StudioConfig): void {
  const size = getBuildSize();
  const half = Math.floor(size / 2);
  for (let x = -half; x <= half; x++) {
    for (let z = -half; z <= half; z++) {
      const block = dimension.getBlock({ x, y: cfg.groundY, z });
      if (!block) continue;
      const typeId = block.typeId;
      if (typeId !== "minecraft:furnace" && typeId !== "minecraft:lit_furnace") {
        continue;
      }
      const inv = block.getComponent(
        "minecraft:inventory",
      ) as BlockInventoryComponent | undefined;
      const container = inv?.container;
      if (!container) continue;
      try {
        const input = container.getItem(0);
        if (!input) continue;
        const resultId = SMELT_RESULTS[input.typeId];
        if (!resultId) continue;

        // 只有“已点燃”或“燃料槽仍有燃料”时才触发秒烧
        const isLit = typeId === "minecraft:lit_furnace";
        const fuel = container.getItem(1);
        if (!isLit && !fuel) continue;

        const output = container.getItem(2);
        const resultStack = new ItemStack(resultId, 1);
        const maxOut = resultStack.maxAmount;
        const outputSpace = output
          ? output.typeId === resultId
            ? maxOut - output.amount
            : 0
          : maxOut;
        const transfer = Math.min(input.amount, outputSpace);
        if (transfer <= 0) continue;

        // 只扣输入,不扣燃料(燃料仅作为“点燃条件”)
        if (input.amount - transfer <= 0) {
          container.setItem(0, undefined);
        } else {
          input.amount -= transfer;
          container.setItem(0, input);
        }

        // 放产物
        if (!output) {
          container.setItem(2, new ItemStack(resultId, transfer));
        } else {
          output.amount += transfer;
          container.setItem(2, output);
        }
      } catch {
        // 单个熔炉处理失败不影响其他熔炉
      }
    }
  }
}

function pickTarget(state: StudioRoomState, cfg: StudioConfig): string {
  const pool = cfg.targetItems.filter((id) => !state.usedTargets.has(id));
  if (pool.length === 0) {
    state.usedTargets.clear();
    return cfg.targetItems[Math.floor(Math.random() * cfg.targetItems.length)] ??
      "minecraft:furnace";
  }
  const id = pool[Math.floor(Math.random() * pool.length)]!;
  state.usedTargets.add(id);
  return id;
}

function updateHud(
  player: Player,
  state: StudioRoomState,
  cfg: StudioConfig,
): void {
  const score = state.scores.get(player.id) ?? 0;
  const now = system.currentTick;
  const remainingSeconds =
    state.firstSuccessTick !== undefined
      ? cfg.afterFirstSuccessSeconds - (now - state.firstSuccessTick) / 20
      : cfg.roundTimeoutSeconds - (now - state.roundStartedTick) / 20;
  const remainText = `§e剩余 ${Math.max(0, Math.ceil(remainingSeconds))} 秒§r`;
  player.onScreenDisplay.setActionBar(
    `§e第 ${state.round}/${cfg.roundCount} 回合§r | 目标:§b${state.targetName}§r | 得分:§a${score}`,
  );

  const sorted = [...state.scores.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 3);
  const msgs: { text: string }[] = [
    { text: "§6工作室§r" },
    { text: "\n" },
    { text: remainText },
    { text: "\n" },
    { text: "§e当前前三:§r" },
  ];
  if (top.length === 0) {
    msgs.push({ text: "\n" }, { text: "§7暂无得分" });
  } else {
    const colors = ["§a", "§e", "§c"];
    top.forEach(([id, s], index) => {
      msgs.push(
        { text: "\n" },
        {
          text: `${colors[index] ?? "§f"}${index + 1}. ${state.playerNames.get(id) ?? id}: ${s}分`,
        },
      );
    });
  }
  setHudTitle(player, hudMessage(msgs), 20);
}

function updateAllHud(
  roomId: number,
  state: StudioRoomState,
  cfg: StudioConfig,
): void {
  for (const player of runtimeGetter().roomPlayers(roomId)) {
    updateHud(player, state, cfg);
  }
}

function startRound(
  roomId: number,
  state: StudioRoomState,
  cfg: StudioConfig,
  runtime: MinigameRuntime,
): void {
  const players = runtime.roomPlayers(roomId);
  const dim = runtime.roomDim(roomId);
  // 回合重置:清掉落物、清熔炉残留、复原货架
  clearDroppedItems(dim);
  resetFurnaces(dim, cfg);

  players.forEach((player, index) => {
    clearAllPlayerItems(player);
    giveTools(player);
    player.setGameMode(GameMode.Survival);
    runtime.teleportPlayer(
      roomId,
      player,
      START_POSITIONS[index % START_POSITIONS.length] ?? START_POSITIONS[0]!,
    );
  });

  refillMaterials(dim);
  state.roundStartedTick = system.currentTick;
  state.firstSuccessTick = undefined;
  state.successOrder = [];
  state.successSet.clear();
  state.roundAwards = [];
  state.targetItem = pickTarget(state, cfg);
  state.targetName = targetDisplayName(state.targetItem);

  const size = getBuildSize();
  state.materialKeys = new Set(
    materialPositions(size, cfg).map((p) => `${p.x},${p.y},${p.z}`),
  );

  runtime.announce(
    roomId,
    `§e第 ${state.round}/${cfg.roundCount} 回合:请在工作室中制作 §b${state.targetName}§r`,
  );
  updateAllHud(roomId, state, cfg);
}

function finalizeRound(
  roomId: number,
  state: StudioRoomState,
  cfg: StudioConfig,
  runtime: MinigameRuntime,
): void {
  if (state.ended) return;
  const lines = [`§6=== 第 ${state.round}/${cfg.roundCount} 回合结束 ===`];
  if (state.roundAwards.length === 0) {
    lines.push("§c无人完成,本回合无人得分");
  } else {
    state.roundAwards.slice(0, 3).forEach((award, index) => {
      lines.push(
        `§e第${index + 1}名:${state.playerNames.get(award.id) ?? award.id} +${award.points}分`,
      );
    });
  }
  runtime.announce(roomId, lines.join("\n"));

  if (state.round >= cfg.roundCount) {
    const sorted = [...state.scores.entries()].sort((a, b) => b[1] - a[1]);
    const finalTop = sorted.slice(0, 3);
    const finalLines = ["§6=== 《工作室》最终排名 ==="];
    if (finalTop.length === 0) {
      finalLines.push("§c无得分记录");
    } else {
      const colors = ["§a", "§e", "§c"];
      finalTop.forEach(([id, score], index) => {
        finalLines.push(
          `${colors[index] ?? "§f"}第${index + 1}名:${state.playerNames.get(id) ?? id} ${score}分`,
        );
      });
    }
    runtime.announce(roomId, finalLines.join("\n"));
    runtime.endGame(roomId, "全部回合结束", "§e《工作室》全部回合结束,即将返回大厅…");
    return;
  }

  state.round++;
  startRound(roomId, state, cfg, runtime);
}

function tickRoom(roomId: number): void {
  const runtime = runtimeGetter();
  const state = getState(roomId);
  if (!runtime.isRunning(roomId) || state.ended) return;
  const cfg = getStudioConfig();
  const now = system.currentTick;
  const dim = runtime.roomDim(roomId);

  // 回合结束判定:第一名后等待窗口 / 无人的超时
  if (state.firstSuccessTick !== undefined) {
    if (
      now - state.firstSuccessTick >=
      cfg.afterFirstSuccessSeconds * 20
    ) {
      finalizeRound(roomId, state, cfg, runtime);
      return;
    }
  } else if (now - state.roundStartedTick >= cfg.roundTimeoutSeconds * 20) {
    finalizeRound(roomId, state, cfg, runtime);
    return;
  }

  // 注意:不能持续清理场地掉落物,否则玩家挖掘货架掉落物会被误清;
  // 掉落物只在回合更换时统一清理(startRound / onBeforeReset)。

  // 持续饱和,防止玩家在制作/等待过程中饿死;已提交玩家持续保持空背包
  for (const player of runtime.roomPlayers(roomId)) {
    try {
      player.addEffect("minecraft:saturation", 100, { showParticles: false });
    } catch {
      // 效果施加失败不影响主循环
    }
    if (state.successSet.has(player.id)) {
      try {
        clearAllPlayerItems(player);
      } catch {
        // 忽略清理失败
      }
    }
  }

  // 秒烧熔炉:输入+燃料存在时立即产出
  processInstantFurnaces(dim, cfg);

  // 检测背包中的目标物品
  for (const player of runtime.roomPlayers(roomId)) {
    if (state.successSet.has(player.id)) continue;
    if (!hasItem(player, state.targetItem)) continue;

    state.successSet.add(player.id);
    state.successOrder.push(player.id);
    state.playerNames.set(player.id, player.name);
    clearAllPlayerItems(player);

    const rank = state.successOrder.length;
    const points =
      rank === 1
        ? cfg.scoreFirst
        : rank === 2
          ? cfg.scoreSecond
          : rank === 3
            ? cfg.scoreThird
            : 0;
    if (points > 0) {
      const current = state.scores.get(player.id) ?? 0;
      state.scores.set(player.id, current + points);
      state.roundAwards.push({ id: player.id, points });
    }
    player.sendMessage(
      `§a制作成功!你是本回合第 ${rank} 名${points > 0 ? `,获得 +${points} 分` : ""}`,
    );
    // 传送到出生点,强制关闭可能打开的合成台/容器界面,避免合成格残留
    const playerIndex = runtime.roomPlayers(roomId).indexOf(player);
    const startPos =
      START_POSITIONS[playerIndex % START_POSITIONS.length] ??
      START_POSITIONS[0]!;
    runtime.teleportPlayer(roomId, player, startPos);
    if (rank === 1) {
      state.firstSuccessTick = now;
      runtime.announce(
        roomId,
        `§e${player.name} 第一个完成!${cfg.afterFirstSuccessSeconds} 秒后进入下一回合`,
      );
    }
  }

  updateAllHud(roomId, state, cfg);
}

/** 禁止房间内玩家互相攻击 */
export function initStudioEvents(getRuntime: () => MinigameRuntime): void {
  runtimeGetter = getRuntime;
  world.beforeEvents.entityHurt.subscribe((event) => {
    const hurt = event.hurtEntity;
    if (!(hurt instanceof Player)) return;
    const source = event.damageSource?.damagingEntity;
    if (!(source instanceof Player)) return;
    const runtime = getRuntime();
    const roomId = runtime.roomIdFromDimension(hurt.dimension.id);
    if (roomId === undefined) return;
    event.cancel = true;
  });
}

export function makeStudioHooks(
  getRuntime: () => MinigameRuntime,
): MinigameHooks {
  runtimeGetter = getRuntime;
  return {
    onGameStart(roomId, _players) {
      const runtime = getRuntime();
      const cfg = getStudioConfig();
      const state = getState(roomId);
      state.round = 1;
      state.usedTargets.clear();
      state.scores.clear();
      state.playerNames.clear();
      state.ended = false;
      state.originalMinPlayers = runtime.config.minPlayers ?? 2;
      if (state.intervalId !== undefined) {
        system.clearRun(state.intervalId);
        state.intervalId = undefined;
      }

      runtime.announce(
        roomId,
        `§a《工作室》开始!共 ${cfg.roundCount} 回合,每回合制作指定物品。`,
      );
      startRound(roomId, state, cfg, runtime);

      state.intervalId = system.runInterval(() => {
        try {
          tickRoom(roomId);
        } catch (error) {
          console.warn(`[Studio] 房间 ${roomId} 主循环异常`, error);
        }
      }, 5);
    },
    onBeforeReset(roomId) {
      const runtime = getRuntime();
      const state = roomStates.get(roomId);
      if (state?.intervalId !== undefined) {
        system.clearRun(state.intervalId);
      }
      roomStates.delete(roomId);
      const dim = runtime.roomDim(roomId);
      clearDroppedItems(dim);
      resetFurnaces(dim, getStudioConfig());
      for (const player of runtime.roomPlayers(roomId)) {
        clearHudTitle(player);
        player.onScreenDisplay.setActionBar("");
        clearAllPlayerItems(player);
        player.setGameMode(GameMode.Adventure);
      }
    },
    canBreak(event: PlayerBreakBlockBeforeEvent, roomId: number): boolean {
      const state = roomStates.get(roomId);
      if (!state) return false;
      const cfg = getStudioConfig();
      const typeId = event.block.typeId;
      const isMaterial =
        cfg.materialBlocks.includes(typeId) ||
        // 红石矿石被触碰后会变成 lit_redstone_ore,仍应视为可挖掘原材料
        (typeId === "minecraft:lit_redstone_ore" &&
          cfg.materialBlocks.includes("minecraft:redstone_ore"));
      if (!isMaterial) return false;
      const key = `${event.block.x},${event.block.y},${event.block.z}`;
      return state.materialKeys.has(key);
    },
    canPlace(_event: PlayerPlaceBlockBeforeEvent): boolean {
      return false;
    },
    openConfig(player: Player): void {
      openStudioConfig(player, getRuntime());
    },
  };
}
