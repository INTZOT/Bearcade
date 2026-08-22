import {
  EntityComponentTypes,
  GameMode,
  ItemComponentTypes,
  ItemStack,
  system,
  world,
  type Dimension,
  type EntityInventoryComponent,
  type ItemDurabilityComponent,
  Player,
  type PlayerBreakBlockBeforeEvent,
  type PlayerPlaceBlockBeforeEvent,
} from "@minecraft/server";
import type { MinigameHooks } from "../../shared/minigame-core/types";
import { stripSectionCodes } from "../../shared/minigame-core/text";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import {
  clearHudTitle,
  hudMessage,
  setHudTitle,
} from "../../shared/minigame-core/scoreboardHud";
import { clearAllPlayerItems } from "../../shared/minigame-core/playerItems";
import { getLabEscapeConfig, openLabEscapeConfig } from "./labescape-config";
import { columnPosition, getMapColumnCount } from "./map";
import {
  COLUMN_MATERIALS,
  HUD_REFRESH_TICKS,
  type LabEscapeConfig,
} from "./config";

interface LabEscapeRoomState {
  columnCount: number;
  playerColumns: Map<string, number>;
  playerNames: Map<string, string>;
  finishOrder: string[];
  finished: Set<string>;
  firstFinished: boolean;
  timeLeft: number;
  intervalId?: number;
  ended: boolean;
}

const roomStates = new Map<number, LabEscapeRoomState>();

let runtimeGetter: () => MinigameRuntime = () => {
  throw new Error("LabEscape runtime not initialized");
};

function getState(roomId: number): LabEscapeRoomState {
  let state = roomStates.get(roomId);
  if (!state) {
    state = {
      columnCount: 0,
      playerColumns: new Map(),
      playerNames: new Map(),
      finishOrder: [],
      finished: new Set(),
      firstFinished: false,
      timeLeft: 0,
      ended: false,
    };
    roomStates.set(roomId, state);
  }
  return state;
}

function isColumnMaterial(typeId: string): boolean {
  return (COLUMN_MATERIALS as readonly string[]).includes(typeId);
}

function giveTools(player: Player): void {
  clearAllPlayerItems(player);
  const inventory = player.getComponent(
    EntityComponentTypes.Inventory,
  ) as EntityInventoryComponent | undefined;
  if (!inventory?.container) return;
  const toolIds = [
    "minecraft:diamond_pickaxe",
    "minecraft:diamond_shovel",
    "minecraft:diamond_axe",
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

/** 返回柱子当前最高非空气方块 Y;全空时返回地面方块 Y(groundY-1) */
function getColumnTopY(
  dimension: Dimension,
  index: number,
  count: number,
  cfg: LabEscapeConfig,
): number {
  const { x, z } = columnPosition(index, count, cfg);
  for (let y = cfg.groundY + cfg.columnHeight - 1; y >= cfg.groundY; y--) {
    const block = dimension.getBlock({ x, y, z });
    if (block && !block.isAir) return y;
  }
  return cfg.groundY - 1;
}

function isPlayerFinished(player: Player, cfg: LabEscapeConfig): boolean {
  const { x, z, y } = player.location;
  const dist = Math.hypot(x, z);
  return dist <= cfg.centerPitRadius && y < cfg.groundY - cfg.centerEnterDepth;
}

function updateHud(
  player: Player,
  state: LabEscapeRoomState,
): void {
  const phaseText = state.firstFinished ? "§e最后冲刺" : "§e挖掘阶段";
  const timeText = `剩余 ${Math.max(0, Math.ceil(state.timeLeft))} 秒`;
  if (!state.playerColumns.has(player.id)) {
    setHudTitle(
      player,
      hudMessage([
        { text: "§a实验室逃脱§r" },
        { text: "\n" },
        { text: "§7观众§r" },
        { text: "\n" },
        { text: timeText },
      ]),
      20,
    );
    return;
  }
  if (state.finished.has(player.id)) {
    const rank = state.finishOrder.indexOf(player.id) + 1;
    setHudTitle(
      player,
      hudMessage([
        { text: "§a实验室逃脱§r" },
        { text: "\n" },
        { text: `§e你已完赛:第 ${rank} 名§r` },
        { text: "\n" },
        { text: timeText },
      ]),
      20,
    );
    return;
  }
  setHudTitle(
    player,
    hudMessage([
      { text: "§a实验室逃脱§r" },
      { text: "\n" },
      { text: phaseText },
      { text: "\n" },
      { text: timeText },
      { text: "\n" },
      { text: "挖到底部 → 跑向中央 → 跳下" },
    ]),
    20,
  );
}

function announceRankings(roomId: number, state: LabEscapeRoomState): void {
  const runtime = runtimeGetter();
  const players = runtime.roomPlayers(roomId);
  const nameById = new Map(players.map((p) => [p.id, stripSectionCodes(p.name)]));
  const lines = ["§6=== 实验室逃脱 结算 ==="];
  if (state.finishOrder.length === 0) {
    lines.push("§c本局没有玩家完赛");
  } else {
    const top = state.finishOrder.slice(0, 3);
    top.forEach((id, index) => {
      lines.push(
        `§e第 ${index + 1} 名:${state.playerNames.get(id) ?? nameById.get(id) ?? id}`,
      );
    });
  }
  runtime.announce(roomId, lines.join("\n"));
  for (const player of players) {
    if (!state.playerColumns.has(player.id)) {
      player.sendMessage("§7你本局为观众,未参赛");
      continue;
    }
    if (state.finished.has(player.id)) {
      const rank = state.finishOrder.indexOf(player.id) + 1;
      player.sendMessage(`§a你的名次:第 ${rank} 名`);
    } else {
      player.sendMessage("§c你未完赛");
    }
  }
}

function endRoom(roomId: number, state: LabEscapeRoomState): void {
  if (state.ended) return;
  state.ended = true;
  if (state.intervalId !== undefined) {
    system.clearRun(state.intervalId);
    state.intervalId = undefined;
  }
  announceRankings(roomId, state);
  runtimeGetter().endGame(roomId, "时间结束", "§e实验室逃脱结束,即将返回大厅…");
}

function tickRoom(roomId: number): void {
  const runtime = runtimeGetter();
  const state = getState(roomId);
  if (!runtime.isRunning(roomId) || state.ended) return;
  const cfg = getLabEscapeConfig();

  // 检测新完赛玩家(仅参赛玩家)
  for (const player of runtime.roomPlayers(roomId)) {
    if (!state.playerColumns.has(player.id)) continue;
    if (state.finished.has(player.id)) continue;
    if (!isPlayerFinished(player, cfg)) continue;
    state.finished.add(player.id);
    state.finishOrder.push(player.id);
    if (!state.firstFinished) {
      state.firstFinished = true;
      state.timeLeft = cfg.finalDurationSeconds;
      // 已有玩家完赛后,允许已完赛玩家 /lobby 离开,剩余玩家仍可继续完成 15 秒冲刺;
      // 运行时已设 endGameWhenBelowMin:false,这里不得改写全局 minPlayers(多房间共用)
      runtime.announce(
        roomId,
        `§e${stripSectionCodes(player.name)} 第一个抵达中央塌陷区!剩余 ${cfg.finalDurationSeconds} 秒供其他玩家完赛`,
      );
      player.setGameMode(GameMode.Spectator);
      player.sendMessage("§a你已完赛!当前第 1 名,可旁观。");
    } else {
      const rank = state.finishOrder.length;
      player.setGameMode(GameMode.Spectator);
      player.sendMessage(`§a你已完赛!当前第 ${rank} 名,可旁观。`);
    }
  }

  // 如果所有参赛玩家都已完赛,立即公布结果,不用等 15 秒倒计时结束
  if (
    state.playerColumns.size > 0 &&
    state.finished.size >= state.playerColumns.size
  ) {
    endRoom(roomId, state);
    return;
  }

  // 倒计时(每 10 tick = 0.5 秒)
  state.timeLeft -= HUD_REFRESH_TICKS / 20;
  if (state.timeLeft <= 0) {
    endRoom(roomId, state);
    return;
  }

  for (const player of runtime.roomPlayers(roomId)) {
    updateHud(player, state);
  }
}

export function initLabEscapeEvents(getRuntime: () => MinigameRuntime): void {
  runtimeGetter = getRuntime;
  world.afterEvents.entityDie.subscribe((event) => {
    const dead = event.deadEntity;
    if (!(dead instanceof Player)) return;
    const player = dead as Player;
    const runtime = getRuntime();
    const roomId = runtime.roomIdFromDimension(player.dimension.id);
    if (roomId === undefined) return;
    const state = roomStates.get(roomId);
    if (!state || !state.playerColumns.has(player.id)) return;
    if (state.finished.has(player.id)) return;
    const cfg = getLabEscapeConfig();
    const index = state.playerColumns.get(player.id)!;
    const pos = columnPosition(index, state.columnCount, cfg);
    system.runTimeout(() => {
      if (!player.isValid) return;
      try {
        const dim = runtime.roomDim(roomId);
        const topY = getColumnTopY(dim, index, state.columnCount, cfg);
        player.teleport(
          { x: pos.x + 0.5, y: topY + 1.5, z: pos.z + 0.5 },
          { dimension: dim },
        );
        player.setGameMode(GameMode.Survival);
        giveTools(player);
        player.sendMessage("§e你已恢复到当前柱子顶部,继续挖掘!");
      } catch (error) {
        console.warn("[LabEscape] 玩家死亡恢复失败", error);
      }
    }, 10);
  });
}

export function makeLabEscapeHooks(
  getRuntime: () => MinigameRuntime,
): MinigameHooks {
  runtimeGetter = getRuntime;
  return {
    onGameStart(roomId, players) {
      const runtime = getRuntime();
      const cfg = getLabEscapeConfig();
      const state = getState(roomId);
      // 使用模板中实际生成的柱子数(由 /labescape:build 写入),保证坐标与地图一致;
      // 派对人数超过柱子数时按模分配,避免传送到地图外
      const mapColumnCount = getMapColumnCount();
      const columnCount = Math.max(
        2,
        Math.min(mapColumnCount, cfg.maxPartyColumns),
      );
      state.columnCount = columnCount;
      state.playerColumns.clear();
      state.finishOrder = [];
      state.finished.clear();
      state.firstFinished = false;
      state.timeLeft = cfg.gameDurationSeconds;
      state.ended = false;
      if (state.intervalId !== undefined) {
        system.clearRun(state.intervalId);
        state.intervalId = undefined;
      }

      // 派对模式人数上限:超过的玩家转为观众,不参与比赛
      const activePlayers = players.slice(0, cfg.partyMaxPlayers);
      const extraPlayers = players.slice(cfg.partyMaxPlayers);
      for (const extra of extraPlayers) {
        extra.setGameMode(GameMode.Spectator);
        extra.sendMessage(
          `§c本局人数超过派对上限 ${cfg.partyMaxPlayers},你已作为观众`,
        );
      }

      if (activePlayers.length > columnCount) {
        runtime.announce(
          roomId,
          `§c警告:当前 ${activePlayers.length} 人超过最大柱子数 ${columnCount},部分玩家将共用柱子`,
        );
      }

      // 柱位与地图实测校验:改几何配置/重建地图失败后旧柱位可能缺失,拒绝开局并提示重建
      try {
        const dim = runtime.roomDim(roomId);
        const sampleY = cfg.groundY + cfg.columnHeight - 1;
        let missing = 0;
        for (let i = 0; i < columnCount; i++) {
          const pos = columnPosition(i, columnCount, cfg);
          const block = dim.getBlock({ x: pos.x, y: sampleY, z: pos.z });
          if (!block || block.isAir) missing++;
        }
        if (missing > 0) {
          runtime.announce(
            roomId,
            `§c柱位校验失败(${missing}/${columnCount} 根缺失):请重新生成模板地图(/labescape:build <数量>)并应用(/bearcade:tmp ap labescape)后再开局`,
          );
          runtime.endGame(roomId, "柱位校验失败", "§c柱位与地图不一致,对局已结束");
          return;
        }
      } catch (error) {
        console.warn("[LabEscape] 柱位校验异常", error);
      }

      activePlayers.forEach((player, index) => {
        const columnIndex = index % columnCount;
        state.playerColumns.set(player.id, columnIndex);
        state.playerNames.set(player.id, player.name);
        const pos = columnPosition(columnIndex, columnCount, cfg);
        runtime.teleportPlayer(roomId, player, {
          x: pos.x,
          y: cfg.groundY + cfg.columnHeight,
          z: pos.z,
        });
        player.setGameMode(GameMode.Survival);
        giveTools(player);
      });

      runtime.announce(
        roomId,
        `§a实验室逃脱开始!每人一根柱子,挖到底部后跑向中央塌陷区跳下。倒计时 ${cfg.gameDurationSeconds} 秒。`,
      );

      state.intervalId = system.runInterval(() => {
        try {
          tickRoom(roomId);
        } catch (error) {
          console.warn(`[LabEscape] 房间 ${roomId} 主循环异常`, error);
        }
      }, HUD_REFRESH_TICKS);
    },
    onBeforeReset(roomId) {
      const runtime = getRuntime();
      const state = roomStates.get(roomId);
      if (state?.intervalId !== undefined) {
        system.clearRun(state.intervalId);
      }
      roomStates.delete(roomId);
      for (const player of runtime.roomPlayers(roomId)) {
        clearHudTitle(player);
        clearAllPlayerItems(player);
        player.setGameMode(GameMode.Adventure);
      }
    },
    canBreak(event: PlayerBreakBlockBeforeEvent, roomId: number): boolean {
      const state = roomStates.get(roomId);
      if (!state) return false;
      const cfg = getLabEscapeConfig();
      const block = event.block;
      if (block.y < cfg.groundY || block.y >= cfg.groundY + cfg.columnHeight) {
        return false;
      }
      if (!isColumnMaterial(block.typeId)) return false;
      // 只能挖掘玩家自己那根柱子的沙子/原木/石头(与 README 规则一致,
      // 防止跨柱破坏他人进度);未分配柱子的玩家(观众)一律禁止
      const myColumn = state.playerColumns.get(event.player.id);
      if (myColumn === undefined) return false;
      const pos = columnPosition(myColumn, state.columnCount, cfg);
      return block.x === pos.x && block.z === pos.z;
    },
    canPlace(_event: PlayerPlaceBlockBeforeEvent): boolean {
      return false;
    },
    openConfig(player: Player): void {
      openLabEscapeConfig(player, getRuntime());
    },
  };
}
