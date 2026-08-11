import {
  system,
  world,
  ItemStack,
  EntityComponentTypes,
  type EntityInventoryComponent,
  type Player,
  type PlayerPlaceBlockBeforeEvent,
} from "@minecraft/server";
import {
  BOARD_Y,
  GAME_ID,
  GRID_MAX,
  GRID_MIN,
  LOBBY_DIMENSION_ID,
  ROOM_COUNT,
  STONE_BLACK,
  STONE_WHITE,
  START_POS_BLACK,
  START_POS_WHITE,
  roomDimensionId,
} from "./config";
import { isRoomReady, resetRoomsFromTemplate } from "./rooms";
import { sendRoomStatus } from "./ipc";

type Cell = "black" | "white" | null;
type Phase = "idle" | "pending" | "running" | "resetting";
type Color = "black" | "white";

interface RoomState {
  phase: Phase;
  board: Cell[][];
  turn: Color;
  players: { black?: string; white?: string };
  pendingRunId?: number;
}

const GRID_SIZE = GRID_MAX - GRID_MIN + 1;
const ROOM_DIM_PATTERN = new RegExp(`^bearcade:${GAME_ID}_(\\d+)$`);
const START_DELAY_TICKS = 40; // 2 秒
const END_DELAY_TICKS = 60; // 3 秒
const states = new Map<number, RoomState>();

function emptyBoard(): Cell[][] {
  return Array.from({ length: GRID_SIZE }, () =>
    Array<Cell>(GRID_SIZE).fill(null),
  );
}

function getState(roomId: number): RoomState {
  let state = states.get(roomId);
  if (!state) {
    state = {
      phase: "idle",
      board: emptyBoard(),
      turn: "black",
      players: {},
    };
    states.set(roomId, state);
  }
  return state;
}

function roomDim(roomId: number) {
  return world.getDimension(roomDimensionId(roomId));
}

function roomPlayers(roomId: number): Player[] {
  return roomDim(roomId).getPlayers();
}

function roomIdFromDimension(dimensionId: string): number | undefined {
  const match = ROOM_DIM_PATTERN.exec(dimensionId);
  return match ? Number(match[1]) : undefined;
}

function inGrid(x: number, z: number): boolean {
  return x >= GRID_MIN && x <= GRID_MAX && z >= GRID_MIN && z <= GRID_MAX;
}

function announce(roomId: number, message: string): void {
  for (const player of roomPlayers(roomId)) {
    player.sendMessage(message);
  }
}

function inventoryOf(player: Player): EntityInventoryComponent | undefined {
  return player.getComponent(
    EntityComponentTypes.Inventory,
  ) as EntityInventoryComponent | undefined;
}

function clearTokens(roomId: number): void {
  for (const player of roomPlayers(roomId)) {
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

function giveTurn(roomId: number, player: Player, color: Color): void {
  clearTokens(roomId);
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

function cancelPending(state: RoomState): void {
  if (state.pendingRunId !== undefined) {
    system.clearRun(state.pendingRunId);
    state.pendingRunId = undefined;
  }
}

function startPending(roomId: number): void {
  const state = getState(roomId);
  if (state.phase !== "idle") return;
  state.phase = "pending";
  state.pendingRunId = system.runTimeout(() => startGame(roomId), START_DELAY_TICKS);
  announce(roomId, "§e两名玩家已就位,对局即将开始…");
}

function startGame(roomId: number): void {
  const state = getState(roomId);
  if (state.phase !== "pending") return;
  const players = roomPlayers(roomId);
  if (players.length < 2) {
    state.phase = "idle";
    return;
  }

  state.phase = "running";
  state.board = emptyBoard();
  state.turn = "black";
  // 随机决定黑/白方
  const blackIsFirst = Math.random() < 0.5;
  const black = blackIsFirst ? players[0] : players[1];
  const white = blackIsFirst ? players[1] : players[0];
  state.players = { black: black.id, white: white.id };
  black.teleport(START_POS_BLACK, { dimension: roomDim(roomId) });
  white.teleport(START_POS_WHITE, { dimension: roomDim(roomId) });
  announce(
    roomId,
    `§a对局开始!黑方:${black.name} / 白方:${white.name},右键棋盘格落子`,
  );
  giveTurn(roomId, black, "black");
  sendRoomStatus();
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

function handlePlace(event: PlayerPlaceBlockBeforeEvent): void {
  const player = event.player;
  const roomId = roomIdFromDimension(event.block.dimension.id);
  if (!roomId) return;
  const state = getState(roomId);
  if (state.phase !== "running") {
    event.cancel = true;
    return;
  }

  const { x, y, z } = event.block.location;
  if (y !== BOARD_Y + 1 || !inGrid(x, z)) {
    event.cancel = true;
    system.run(() => {
      player.sendMessage("§c棋子只能放在棋盘格上");
    });
    return;
  }
  const cx = x - GRID_MIN;
  const cz = z - GRID_MIN;
  if (state.board[cx][cz]) {
    event.cancel = true;
    system.run(() => {
      player.sendMessage("§c该位置已有棋子");
    });
    return;
  }
  if (state.players[state.turn] !== player.id) {
    event.cancel = true;
    system.run(() => {
      player.sendMessage("§c还没轮到你落子");
    });
    return;
  }

  const color = state.turn;
  const expectedType = color === "black" ? STONE_BLACK : STONE_WHITE;
  if (event.permutationToPlace.type.id !== expectedType) {
    event.cancel = true;
    system.run(() => {
      player.sendMessage("§c请放置你手中的对应颜色棋子");
    });
    return;
  }

  // 校验通过:放行放置,同步更新棋盘(内存状态),提示/结算延迟到正常上下文
  state.board[cx][cz] = color;
  const won = checkWin(state.board, cx, cz, color);
  const full = !won && isBoardFull(state.board);
  system.run(() => {
    player.sendMessage(
      `§7落子:${color === "black" ? "黑" : "白"} (${x}, ${z})`,
    );
  });

  if (won || full) {
    const winnerText = color === "black" ? "黑方" : "白方";
    system.run(() => {
      if (won) {
        announce(roomId, `§e${winnerText}五连,对局结束`);
        endGame(roomId, color);
      } else {
        announce(roomId, "§e棋盘已满,平局");
        endGame(roomId, "draw");
      }
    });
    return;
  }

  state.turn = state.turn === "black" ? "white" : "black";
  const nextColor = state.turn;
  system.run(() => {
    const nextPlayer = roomPlayers(roomId).find(
      (p) => p.id === state.players[nextColor],
    );
    if (nextPlayer) giveTurn(roomId, nextPlayer, nextColor);
    announce(
      roomId,
      `轮到${nextColor === "black" ? "黑方" : "白方"}落子`,
    );
  });
}

function endGame(roomId: number, result: Color | "draw" | "force"): void {
  const state = getState(roomId);
  if (state.phase === "resetting") return;
  cancelPending(state);
  state.phase = "resetting";

  const resultText =
    result === "force"
      ? "对局已被强制中断"
      : result === "draw"
      ? "平局"
      : result === "black"
        ? "黑方获胜"
        : "白方获胜";
  announce(roomId, `§e${resultText},即将返回大厅…`);

  system.runTimeout(() => {
    void finishReset(roomId);
  }, END_DELAY_TICKS);
}

async function finishReset(roomId: number): Promise<void> {
  const dim = roomDim(roomId);
  const lobbyDim = world.getDimension(LOBBY_DIMENSION_ID);
  const spawn = world.getDefaultSpawnLocation();

  clearTokens(roomId);
  // 先送玩家回大厅,再重置场地
  for (const player of roomPlayers(roomId)) {
    try {
      player.teleport(spawn, { dimension: lobbyDim });
    } catch (error) {
      console.warn(
        `[Bearcade Gomoku] 房间 ${roomId} 玩家回大厅失败`,
        error,
      );
    }
  }
  try {
    await resetRoomsFromTemplate([roomId]);
  } catch (error) {
    console.warn(`[Bearcade Gomoku] 房间 ${roomId} 场地重置失败`, error);
  }

  states.set(roomId, {
    phase: "idle",
    board: emptyBoard(),
    turn: "black",
    players: {},
  });
  console.warn(`[Bearcade Gomoku] 房间 ${roomId} 已重置`);
  sendRoomStatus();
}

export function tickGames(): void {
  for (let roomId = 1; roomId <= ROOM_COUNT; roomId++) {
    if (!isRoomReady(roomId)) continue;
    const state = getState(roomId);
    const players = roomPlayers(roomId);

    if (state.phase === "idle" && players.length >= 2) {
      startPending(roomId);
    } else if (state.phase === "pending" && players.length < 2) {
      cancelPending(state);
      state.phase = "idle";
      announce(roomId, "§7等待玩家就位…");
    } else if (state.phase === "running" && players.length < 2) {
      if (players.length === 1) {
        const winner: Color =
          state.players.black === players[0].id ? "black" : "white";
        announce(
          roomId,
          `§e对方离开,${winner === "black" ? "黑方" : "白方"}获胜`,
        );
        endGame(roomId, winner);
      } else {
        endGame(roomId, "draw");
      }
    }
  }
}

export function getReportStatus(
  roomId: number,
): "idle" | "running" | "initializing" {
  if (!isRoomReady(roomId)) return "initializing";
  const phase = getState(roomId).phase;
  if (phase === "running" || phase === "pending") return "running";
  if (phase === "resetting") return "initializing";
  return "idle";
}

export function forceStopInDimension(dimensionId: string): boolean {
  const roomId = roomIdFromDimension(dimensionId);
  if (!roomId) return false;
  const state = getState(roomId);
  if (state.phase !== "running" && state.phase !== "pending") return false;
  system.run(() => endGame(roomId, "force"));
  return true;
}

export function initGame(): void {
  // 房间维度内禁止破坏方块
  world.beforeEvents.playerBreakBlock.subscribe((event) => {
    if (roomIdFromDimension(event.block.dimension.id)) {
      event.cancel = true;
    }
  });
  // 放置方块即落子:合法棋步放行,其余一律取消
  world.beforeEvents.playerPlaceBlock.subscribe(handlePlace);
}
