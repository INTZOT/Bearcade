import { system, ScriptEventSource } from "@minecraft/server";
import {
  CORE_PACK_ID,
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

    // 来源过滤:仅接受脚本模块(system.sendScriptEvent)发来的消息。
    // 玩家 /scriptevent(Entity+player)、命令方块(Block)、NPC 对话(NPCDialogue)
    // 一律丢弃;packId 与注册表匹配作为第二道兜底校验。
    if (
      event.sourceType === ScriptEventSource.Block ||
      event.sourceType === ScriptEventSource.NPCDialogue ||
      (event.sourceType === ScriptEventSource.Entity &&
        event.sourceEntity?.typeId === "minecraft:player")
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
      case "game.register_request":
      case "party.mode":
        break;
      default:
        console.warn(`[Bearcade Core] 未知操作码:${envelope.op}`);
        break;
    }
  });
}

/**
 * worldLoad 后主动广播一次"重注册请求":兜底游戏包的 game.register 早于 Core 订阅
 * 而丢失的极端情况(此时该游戏本次会话不会出现在菜单,直到世界重载)。
 * 共享运行时收到该请求会重发 game.register;Core 侧 upsertGame 幂等,
 * 重复注册不会重置已有房间状态。
 */
export function requestGameRegistration(): void {
  try {
    system.sendScriptEvent(
      IPC_CHANNEL,
      JSON.stringify({
        op: "game.register_request",
        packId: CORE_PACK_ID,
        payload: {},
      }),
    );
  } catch (error) {
    console.warn("[Bearcade Core] 请求游戏重注册失败", error);
  }
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
