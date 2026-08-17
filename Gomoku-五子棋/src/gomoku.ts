import {
  system,
  world,
  ItemStack,
  GameMode,
  ItemLockMode,
  EntityComponentTypes,
  type EntityInventoryComponent,
  type Player,
  type PlayerPlaceBlockBeforeEvent,
} from "@minecraft/server";
import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import {
  clearHudTitle,
  hudMessage,
  setHudTitle,
} from "../../shared/minigame-core/scoreboardHud";
import { getGomokuConfig, openGomokuConfig } from "./gomoku-config";
import {
  STONE_BLACK,
  STONE_WHITE,
  type GomokuConfig,
} from "./config";

type Cell = "black" | "white" | null;
type Color = "black" | "white";

interface GomokuState {
  board: Cell[][];
  turn: Color;
  players: { black?: string; white?: string };
  /** 处于俯瞰视角(望远镜切换)中的玩家 */
  overview: Set<string>;
}

const games = new Map<number, GomokuState>();

function gridSize(): number {
  const cfg = getGomokuConfig();
  return cfg.gridMax - cfg.gridMin + 1;
}

function emptyBoard(): Cell[][] {
  const size = gridSize();
  return Array.from({ length: size }, () =>
    Array<Cell>(size).fill(null),
  );
}

function inGrid(x: number, z: number): boolean {
  const cfg = getGomokuConfig();
  return (
    x >= cfg.gridMin &&
    x <= cfg.gridMax &&
    z >= cfg.gridMin &&
    z <= cfg.gridMax
  );
}

function inventoryOf(player: Player): EntityInventoryComponent | undefined {
  return player.getComponent(
    EntityComponentTypes.Inventory,
  ) as EntityInventoryComponent | undefined;
}

function clearTokens(runtime: MinigameRuntime, roomId: number): void {
  for (const player of runtime.roomPlayers(roomId)) {
    const container = inventoryOf(player)?.container;
    if (!container) continue;
    for (let slot = 0; slot < container.size; slot++) {
      const item = container.getItem(slot);
      if (
        item &&
        (item.typeId === STONE_BLACK || item.typeId === STONE_WHITE)
      ) {
        container.setItem(slot, undefined);
      }
    }
  }
}

function refreshHud(
  runtime: MinigameRuntime,
  roomId: number,
  state: GomokuState,
): void {
  for (const roomPlayer of runtime.roomPlayers(roomId)) {
    const turnColor = state.turn;
    const myTurn = state.players[turnColor] === roomPlayer.id;
    setHudTitle(
      roomPlayer,
      hudMessage([
        { text: "§e五子棋§r" },
        { text: "\n" },
        {
          text: myTurn
            ? `§a轮到你落子 · ${turnColor === "black" ? "黑方" : "白方"}`
            : `§7等待对方落子 · ${turnColor === "black" ? "黑方" : "白方"}`,
        },
      ]),
      6000,
    );
  }
}

function giveTurn(
  runtime: MinigameRuntime,
  roomId: number,
  player: Player,
  color: Color,
): void {
  clearTokens(runtime, roomId);
  const container = inventoryOf(player)?.container;
  if (container) {
    // 背包满时先移除一个非棋子杂物腾出空格,保证棋子能放入(对局中其他物品无意义)
    if (container.emptySlotsCount === 0) {
      for (let slot = 0; slot < container.size; slot++) {
        const item = container.getItem(slot);
        if (item && item.typeId !== STONE_BLACK && item.typeId !== STONE_WHITE) {
          container.setItem(slot, undefined);
          break;
        }
      }
    }
    container.addItem(
      new ItemStack(color === "black" ? STONE_BLACK : STONE_WHITE, 1),
    );
  }
  const name = color === "black" ? "黑" : "白";
  player.sendMessage(`§a轮到你落子(${name}方)`);
  const state = games.get(roomId);
  if (state) refreshHud(runtime, roomId, state);
}

function checkWin(
  board: Cell[][],
  cx: number,
  cz: number,
  color: Color,
): boolean {
  const directions = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  const size = gridSize();
  for (const [dx, dz] of directions) {
    let count = 1;
    for (const sign of [-1, 1]) {
      let nx = cx + dx * sign;
      let nz = cz + dz * sign;
      while (
        nx >= 0 &&
        nx < size &&
        nz >= 0 &&
        nz < size &&
        board[nx][nz] === color
      ) {
        count++;
        nx += dx * sign;
        nz += dz * sign;
      }
    }
    if (count >= 5) return true;
  }
  return false;
}

function isBoardFull(board: Cell[][]): boolean {
  return board.every((row) => row.every((cell) => cell !== null));
}

function handlePlace(
  runtime: MinigameRuntime,
  event: PlayerPlaceBlockBeforeEvent,
  roomId: number,
): boolean {
  const player = event.player;
  if (!runtime.isRunning(roomId)) return false;
  const state = games.get(roomId);
  if (!state) return false;
  const cfg = getGomokuConfig();

  const { x, y, z } = event.block.location;
  if (y !== cfg.boardY + 1 || !inGrid(x, z)) {
    system.run(() => player.sendMessage("§c棋子只能放在棋盘格上"));
    return false;
  }
  const cx = x - cfg.gridMin;
  const cz = z - cfg.gridMin;
  if (state.board[cx][cz]) {
    system.run(() => player.sendMessage("§c该位置已有棋子"));
    return false;
  }
  if (state.players[state.turn] !== player.id) {
    system.run(() => player.sendMessage("§c还没轮到你落子"));
    return false;
  }

  const color = state.turn;
  const expected = color === "black" ? STONE_BLACK : STONE_WHITE;
  if (event.permutationToPlace.type.id !== expected) {
    system.run(() => player.sendMessage("§c请放置你手中的对应颜色棋子"));
    return false;
  }

  // 校验通过:同步更新棋盘(受限上下文内只改内存),提示/结算延迟到 system.run
  state.board[cx][cz] = color;
  const won = checkWin(state.board, cx, cz, color);
  const full = !won && isBoardFull(state.board);
  state.turn = state.turn === "black" ? "white" : "black";
  const next = state.turn;

  system.run(() => {
    player.sendMessage(
      `§7落子:${color === "black" ? "黑" : "白"} (${x}, ${z})`,
    );
    if (won) {
      runtime.announce(
        roomId,
        `§e${color === "black" ? "黑方" : "白方"}五连,对局结束`,
      );
      runtime.endGame(
        roomId,
        color === "black" ? "黑方获胜" : "白方获胜",
        "§e即将返回大厅…",
      );
      return;
    }
    if (full) {
      runtime.announce(roomId, "§e棋盘已满,平局");
      runtime.endGame(roomId, "平局", "§e即将返回大厅…");
      return;
    }
    const nextPlayer = runtime
      .roomPlayers(roomId)
      .find((p) => p.id === state.players[next]);
    if (nextPlayer) giveTurn(runtime, roomId, nextPlayer, next);
    runtime.announce(
      roomId,
      `轮到${next === "black" ? "黑方" : "白方"}落子`,
    );
  });
  return true;
}

export function makeGomokuHooks(
  getRuntime: () => MinigameRuntime,
): MinigameHooks {
  return {
    onGameStart(roomId, players) {
      const runtime = getRuntime();
      const cfg = getGomokuConfig();
      // 随机决定黑/白方
      const blackIsFirst = Math.random() < 0.5;
      const black = blackIsFirst ? players[0] : players[1];
      const white = blackIsFirst ? players[1] : players[0];
      games.set(roomId, {
        board: emptyBoard(),
        turn: "black",
        players: { black: black.id, white: white.id },
        overview: new Set(),
      });
      // 生存模式才能放置压力板落子(放置合法性由 canPlace 钩子控制);
      // 玩家从大厅(冒险)进入,必须显式切换
      black.setGameMode(GameMode.Survival);
      white.setGameMode(GameMode.Survival);
      // 发放望远镜(槽位锁定,用于切换俯瞰视角)
      giveSpyglass(black);
      giveSpyglass(white);
      runtime.teleportPlayer(roomId, black, cfg.blackStart);
      runtime.teleportPlayer(roomId, white, cfg.whiteStart);
      runtime.announce(
        roomId,
        `§a对局开始!黑方:${black.name} / 白方:${white.name},放置压力板落子`,
      );
      refreshHud(runtime, roomId, games.get(roomId)!);
      giveTurn(runtime, roomId, black, "black");
    },
    onBeforeReset(roomId) {
      const runtime = getRuntime();
      for (const player of runtime.roomPlayers(roomId)) {
        clearHudTitle(player);
      }
      // 恢复冒险模式(回大厅后 Core 也会兜底初始化)
      for (const player of runtime.roomPlayers(roomId)) {
        if (player !== undefined) {
          try {
            player.setGameMode(GameMode.Adventure);
            player.camera.clear();
          } catch {
            // 忽略
          }
          removeSpyglass(player);
        }
      }
      clearTokens(runtime, roomId);
      games.delete(roomId);
    },
    canPlace(event, roomId) {
      return handlePlace(getRuntime(), event, roomId);
    },
    openConfig(player) {
      openGomokuConfig(player, getRuntime());
    },
  };
}

// ================= 俯瞰视角(望远镜切换) =================

const SPYGLASS_ID = "minecraft:spyglass";
const OVERHEAD_PRESET = "bearcade:gomoku_overhead";

/** 开局发放锁定在物品栏的望远镜(槽位锁定,可用不可丢) */
function giveSpyglass(player: Player): void {
  try {
    const spyglass = new ItemStack(SPYGLASS_ID, 1);
    spyglass.lockMode = ItemLockMode.slot;
    player
      .getComponent(EntityComponentTypes.Inventory)
      ?.container?.addItem(spyglass);
  } catch (error) {
    console.warn("[Bearcade Gomoku] 发放望远镜失败", error);
  }
}

/** 回收玩家身上的望远镜(对局重置时清理) */
function removeSpyglass(player: Player): void {
  try {
    const container = player.getComponent(EntityComponentTypes.Inventory)
      ?.container;
    if (!container) return;
    for (let slot = 0; slot < container.size; slot++) {
      const item = container.getItem(slot);
      if (item?.typeId === SPYGLASS_ID) container.setItem(slot, undefined);
    }
  } catch {
    // 忽略
  }
}

/** 切换俯瞰视角:开启时摄像机置于棋盘正上方,再次使用望远镜恢复 */
function toggleOverview(
  player: Player,
  state: GomokuState,
  cfg: GomokuConfig,
): void {
  if (state.overview.has(player.id)) {
    state.overview.delete(player.id);
    try {
      player.camera.clear();
    } catch (error) {
      console.warn("[Bearcade Gomoku] 恢复视角失败", error);
    }
    player.sendMessage("§7已恢复普通视角");
    return;
  }
  const center = (cfg.gridMin + cfg.gridMax) / 2;
  try {
    player.camera.setCamera(OVERHEAD_PRESET, {
      location: {
        x: center,
        y: cfg.boardY + 1 + cfg.overviewHeight,
        z: center,
      },
      rotation: { x: 90, y: 0 },
    });
    state.overview.add(player.id);
    player.sendMessage(
      `§a俯瞰视角(高度 ${cfg.overviewHeight} 格),再次使用望远镜恢复`,
    );
  } catch (error) {
    player.sendMessage("§c俯瞰视角切换失败");
    console.warn("[Bearcade Gomoku] 俯瞰视角设置失败", error);
  }
}

/** 初始化俯瞰视角:监听望远镜使用事件(仅对局运行中响应) */
export function initGomoku(getRuntime: () => MinigameRuntime): void {
  const runtime = getRuntime();
  world.afterEvents.itemUse.subscribe((event) => {
    if (event.itemStack.typeId !== SPYGLASS_ID) return;
    const roomId = runtime.roomIdFromDimension(event.source.dimension.id);
    if (roomId === undefined) return;
    const state = games.get(roomId);
    if (!state || runtime.getPhase(roomId) !== "running") return;
    toggleOverview(event.source, state, getGomokuConfig());
  });
}
