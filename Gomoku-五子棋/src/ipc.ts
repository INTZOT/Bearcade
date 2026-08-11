import { system, world } from "@minecraft/server";
import {
  DISPLAY_NAME,
  GAME_ID,
  IPC_CHANNEL,
  MAX_PLAYERS,
  PACK_ID,
  PREP_SPAWN,
  ROOM_COUNT,
  roomDimensionId,
} from "./config";
import { getReportStatus } from "./game";

function send(op: string, payload: unknown): void {
  system.sendScriptEvent(
    IPC_CHANNEL,
    JSON.stringify({ op, packId: PACK_ID, payload }),
  );
}

export function sendGameRegister(): void {
  send("game.register", {
    game: GAME_ID,
    displayName: DISPLAY_NAME,
    roomCount: ROOM_COUNT,
    maxPlayers: MAX_PLAYERS,
    prepSpawn: PREP_SPAWN,
  });
  console.warn("[Bearcade Gomoku] 已向 Core 注册游戏信息");
}

export function sendRoomStatus(): void {
  const rooms: { id: number; players: number; status: string }[] = [];
  for (let roomId = 1; roomId <= ROOM_COUNT; roomId++) {
    const dim = world.getDimension(roomDimensionId(roomId));
    rooms.push({
      id: roomId,
      players: dim.getPlayers().length,
      status: getReportStatus(roomId),
    });
  }
  send("room.status", { game: GAME_ID, rooms });
}
