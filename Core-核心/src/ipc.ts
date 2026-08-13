import { system, ScriptEventSource } from "@minecraft/server";
import {
  IPC_CHANNEL,
  type IpcEnvelope,
  type RegisterPayload,
  type RoomStatusPayload,
} from "./types";
import type { GameRegistry } from "./registry";
import { broadcastPartyMode } from "./party";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function initIpc(registry: GameRegistry): void {
  system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== IPC_CHANNEL) return;

    // 直接由玩家执行 /scriptevent 的消息一律丢弃,packId 校验兜底
    if (
      event.sourceType === ScriptEventSource.Entity &&
      event.sourceEntity?.typeId === "minecraft:player"
    ) {
      return;
    }

    let envelope: IpcEnvelope;
    try {
      envelope = JSON.parse(event.message) as IpcEnvelope;
    } catch {
      console.warn("[Bearcade Core] 收到无法解析的 IPC 消息");
      return;
    }

    if (
      !isObject(envelope) ||
      typeof envelope.op !== "string" ||
      typeof envelope.packId !== "string"
    ) {
      return;
    }

    switch (envelope.op) {
      case "game.register":
        handleRegister(registry, envelope.packId, envelope.payload);
        break;
      case "room.status":
        handleRoomStatus(registry, envelope.packId, envelope.payload);
        break;
      // Core 自己下发给游戏包的指令,Core 侧直接忽略
      case "game.tp":
      case "game.apply":
      case "game.sz":
      case "game.quit":
      case "game.config":
      case "game.debug":
      case "party.mode":
        break;
      default:
        console.warn(`[Bearcade Core] 未知操作码:${envelope.op}`);
        break;
    }
  });
}

function handleRegister(
  registry: GameRegistry,
  packId: string,
  payload: unknown,
): void {
  if (!isObject(payload)) return;
  const ok = registry.upsertGame(
    payload as unknown as RegisterPayload,
    packId,
  );
  if (!ok) {
    console.warn(`[Bearcade Core] 非法 game.register(packId=${packId})`);
  } else {
    // 新注册的游戏包同步一次当前派对状态
    system.runTimeout(() => broadcastPartyMode(), 2);
  }
}

function handleRoomStatus(
  registry: GameRegistry,
  packId: string,
  payload: unknown,
): void {
  if (!isObject(payload) || typeof payload.game !== "string") return;
  const ok = registry.updateRooms(
    payload.game,
    packId,
    (payload as unknown as RoomStatusPayload).rooms,
  );
  if (!ok) {
    console.warn(
      `[Bearcade Core] 非法 room.status(game=${payload.game},packId=${packId})`,
    );
  }
}
