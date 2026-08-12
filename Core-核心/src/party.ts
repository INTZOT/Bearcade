import { system, world, type Player } from "@minecraft/server";
import { IPC_CHANNEL } from "./types";

const PARTY_MODE_KEY = "bearcade:party_mode";
const CORE_PACK_ID = "9ce781fb-ff67-4e21-904d-6a5b8b457703";

let partyMode = false;

export function loadPartyMode(): void {
  try {
    partyMode = world.getDynamicProperty(PARTY_MODE_KEY) === true;
  } catch {
    partyMode = false;
  }
}

export function isPartyMode(): boolean {
  return partyMode;
}

/** 切换派对模式(受限上下文安全:先改内存,再延迟持久化) */
export function togglePartyMode(): boolean {
  partyMode = !partyMode;
  persistPartyMode();
  broadcastPartyMode();
  return partyMode;
}

function persistPartyMode(): void {
  system.run(() => {
    try {
      world.setDynamicProperty(PARTY_MODE_KEY, partyMode);
    } catch (error) {
      console.warn("[Bearcade Core] 派对模式状态持久化失败", error);
    }
  });
}

/** 向所有小游戏包广播当前派对模式 */
export function broadcastPartyMode(): void {
  system.run(() => {
    try {
      system.sendScriptEvent(
        IPC_CHANNEL,
        JSON.stringify({
          op: "party.mode",
          packId: CORE_PACK_ID,
          payload: { enabled: partyMode },
        }),
      );
    } catch (error) {
      console.warn("[Bearcade Core] 派对模式广播失败", error);
    }
  });
}

/** 管理员判定:拥有 op tag 的玩家 */
export function isAdmin(player: Player): boolean {
  return player.hasTag("op");
}
