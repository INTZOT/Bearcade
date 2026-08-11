import { system, world, type Block, type Player } from "@minecraft/server";
import {
  BOARD_Y,
  GAME_ID,
  GRID_MAX,
  GRID_MIN,
  LOBBY_DIMENSION_ID,
  ROOM_COPY_ORIGIN,
  ROOM_COUNT,
  STONE_BLACK,
  STONE_WHITE,
  START_POS_BLACK,
  START_POS_WHITE,
  STRUCTURE_ID,
  roomDimensionId,
} from "./config";
import { isRoomReady } from "./rooms";
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
  state.players = { black: players[0].id, white: players[1].id };
  players[0].teleport(START_POS_BLACK, { dimension: roomDim(roomId) });
  players[1].teleport(START_POS_WHITE, { dimension: roomDim(roomId) });
  announce(roomId, "§a对局开始!黑方先手,右键棋盘格落子");
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

function handleInteract(player: Player, block: Block): void {
  const roomId = roomIdFromDimension(block.dimension.id);
  if (!roomId) return;
  const state = getState(roomId);
  if (state.phase !== "running") return;

  const { x, y, z } = block.location;
  if (y !== BOARD_Y || !inGrid(x, z)) return;
  const cx = x - GRID_MIN;
  const cz = z - GRID_MIN;
  if (state.board[cx][cz]) return;
  if (state.players[state.turn] !== player.id) {
    player.sendMessage("§c还没轮到你落子");
    return;
  }

  const color = state.turn;
  block.setType(color === "black" ? STONE_BLACK : STONE_WHITE);
  state.board[cx][cz] = color;
  player.sendMessage(
    `§7落子:${color === "black" ? "黑" : "白"} (${x}, ${z})`,
  );

  if (checkWin(state.board, cx, cz, color)) {
    const winnerText = color === "black" ? "黑方" : "白方";
    announce(roomId, `§e${winnerText}五连,对局结束`);
    endGame(roomId, color);
    return;
  }
  if (isBoardFull(state.board)) {
    announce(roomId, "§e棋盘已满,平局");
    endGame(roomId, "draw");
    return;
  }

  state.turn = state.turn === "black" ? "white" : "black";
  announce(
    roomId,
    `轮到${state.turn === "black" ? "黑方" : "白方"}落子`,
  );
}

function endGame(roomId: number, result: Color | "draw"): void {
  const state = getState(roomId);
  if (state.phase === "resetting") return;
  cancelPending(state);
  state.phase = "resetting";

  const resultText =
    result === "draw"
      ? "平局"
      : result === "black"
        ? "黑方获胜"
        : "白方获胜";
  announce(roomId, `§e${resultText},即将返回大厅…`);

  system.runTimeout(() => finishReset(roomId), END_DELAY_TICKS);
}

function finishReset(roomId: number): void {
  const dim = roomDim(roomId);
  const lobbyDim = world.getDimension(LOBBY_DIMENSION_ID);
  const spawn = world.getDefaultSpawnLocation();

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
    world.structureManager.place(STRUCTURE_ID, dim, ROOM_COPY_ORIGIN);
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

export function initGame(): void {
  world.afterEvents.playerInteractWithBlock.subscribe((event) => {
    handleInteract(event.player, event.block);
  });

  // 房间维度内禁止破坏/放置方块,只允许通过落子交互
  world.beforeEvents.playerBreakBlock.subscribe((event) => {
    if (roomIdFromDimension(event.block.dimension.id)) {
      event.cancel = true;
    }
  });
  world.beforeEvents.playerPlaceBlock.subscribe((event) => {
    if (roomIdFromDimension(event.block.dimension.id)) {
      event.cancel = true;
    }
  });
}
