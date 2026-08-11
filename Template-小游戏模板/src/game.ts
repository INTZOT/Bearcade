import { system, world, type Player } from "@minecraft/server";
import {
  GAME_ID,
  LOBBY_DIMENSION_ID,
  ROOM_COUNT,
  START_POSITIONS,
  roomDimensionId,
} from "./config";
import { isRoomReady, resetRoomsFromTemplate } from "./rooms";
import { sendRoomStatus } from "./ipc";

type Phase = "idle" | "pending" | "running" | "resetting";

interface RoomState {
  phase: Phase;
  players: string[];
  pendingRunId?: number;
}

const ROOM_DIM_PATTERN = new RegExp(`^bearcade:${GAME_ID}_(\\d+)$`);
const START_DELAY_TICKS = 40; // 2 秒
const END_DELAY_TICKS = 60; // 3 秒
const states = new Map<number, RoomState>();

function getState(roomId: number): RoomState {
  let state = states.get(roomId);
  if (!state) {
    state = { phase: "idle", players: [] };
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
  state.pendingRunId = system.runTimeout(
    () => startGame(roomId),
    START_DELAY_TICKS,
  );
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
  state.players = players.map((p) => p.id);
  players.forEach((player, index) => {
    const pos = START_POSITIONS[index] ?? START_POSITIONS[0];
    player.teleport(pos, { dimension: roomDim(roomId) });
  });
  announce(roomId, "§a对局开始!在这里实现你的玩法");
  sendRoomStatus();
  // TODO: 玩法初始化钩子(发道具、初始化棋盘/计分等)
}

function endGame(roomId: number, reason: string): void {
  const state = getState(roomId);
  if (state.phase === "resetting") return;
  cancelPending(state);
  state.phase = "resetting";
  announce(roomId, `§e对局结束(${reason}),即将返回大厅…`);
  system.runTimeout(() => {
    void finishReset(roomId);
  }, END_DELAY_TICKS);
}

async function finishReset(roomId: number): Promise<void> {
  const lobbyDim = world.getDimension(LOBBY_DIMENSION_ID);
  const spawn = world.getDefaultSpawnLocation();

  for (const player of roomPlayers(roomId)) {
    try {
      player.teleport(spawn, { dimension: lobbyDim });
    } catch (error) {
      console.warn(`[Bearcade Template] 房间 ${roomId} 玩家回大厅失败`, error);
    }
  }
  try {
    await resetRoomsFromTemplate([roomId]);
  } catch (error) {
    console.warn(`[Bearcade Template] 房间 ${roomId} 场地重置失败`, error);
  }

  states.set(roomId, { phase: "idle", players: [] });
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
      endGame(roomId, "玩家离开");
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
  system.run(() => endGame(roomId, "强制中断"));
  return true;
}

export function initGame(): void {
  // 房间维度默认禁止破坏/放置方块;玩法需要放行时在 TODO 处按你的规则处理
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

  // TODO: 在这里订阅你的玩法事件(如 playerInteractWithBlock / itemUse / 实体交互),
  //       满足结束条件时调用 endGame(roomId, "获胜/平局/超时")。
}
