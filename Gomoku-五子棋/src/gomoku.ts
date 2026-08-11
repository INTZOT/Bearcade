import {
  system,
  ItemStack,
  EntityComponentTypes,
  type EntityInventoryComponent,
  type Player,
  type PlayerPlaceBlockBeforeEvent,
} from "@minecraft/server";
import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import {
  BOARD_Y,
  GRID_MAX,
  GRID_MIN,
  STONE_BLACK,
  STONE_WHITE,
  START_POS_BLACK,
  START_POS_WHITE,
} from "./config";

type Cell = "black" | "white" | null;
type Color = "black" | "white";

interface GomokuState {
  board: Cell[][];
  turn: Color;
  players: { black?: string; white?: string };
}

const GRID_SIZE = GRID_MAX - GRID_MIN + 1;
const games = new Map<number, GomokuState>();

function emptyBoard(): Cell[][] {
  return Array.from({ length: GRID_SIZE }, () =>
    Array<Cell>(GRID_SIZE).fill(null),
  );
}

function inGrid(x: number, z: number): boolean {
  return x >= GRID_MIN && x <= GRID_MAX && z >= GRID_MIN && z <= GRID_MAX;
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

function giveTurn(
  runtime: MinigameRuntime,
  roomId: number,
  player: Player,
  color: Color,
): void {
  clearTokens(runtime, roomId);
  const container = inventoryOf(player)?.container;
  if (container) {
    container.addItem(
      new ItemStack(color === "black" ? STONE_BLACK : STONE_WHITE, 1),
    );
  }
  const name = color === "black" ? "黑" : "白";
  player.sendMessage(`§a轮到你落子(${name}方)`);
  player.onScreenDisplay.setActionBar(`§a轮到你落子 · ${name}方`);
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
  for (const [dx, dz] of directions) {
    let count = 1;
    for (const sign of [-1, 1]) {
      let nx = cx + dx * sign;
      let nz = cz + dz * sign;
      while (
        nx >= 0 &&
        nx < GRID_SIZE &&
        nz >= 0 &&
        nz < GRID_SIZE &&
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

  const { x, y, z } = event.block.location;
  if (y !== BOARD_Y + 1 || !inGrid(x, z)) {
    system.run(() => player.sendMessage("§c棋子只能放在棋盘格上"));
    return false;
  }
  const cx = x - GRID_MIN;
  const cz = z - GRID_MIN;
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
      // 随机决定黑/白方
      const blackIsFirst = Math.random() < 0.5;
      const black = blackIsFirst ? players[0] : players[1];
      const white = blackIsFirst ? players[1] : players[0];
      games.set(roomId, {
        board: emptyBoard(),
        turn: "black",
        players: { black: black.id, white: white.id },
      });
      runtime.teleportPlayer(roomId, black, START_POS_BLACK);
      runtime.teleportPlayer(roomId, white, START_POS_WHITE);
      runtime.announce(
        roomId,
        `§a对局开始!黑方:${black.name} / 白方:${white.name},放置压力板落子`,
      );
      giveTurn(runtime, roomId, black, "black");
    },
    onBeforeReset(roomId) {
      clearTokens(getRuntime(), roomId);
      games.delete(roomId);
    },
    canPlace(event, roomId) {
      return handlePlace(getRuntime(), event, roomId);
    },
  };
}
