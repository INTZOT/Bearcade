import { system, world, type Player } from "@minecraft/server";

const PARTY_MODE_KEY = "bearcade:party_mode";

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
  system.run(() => {
    try {
      world.setDynamicProperty(PARTY_MODE_KEY, partyMode);
    } catch (error) {
      console.warn("[Bearcade Core] 派对模式状态持久化失败", error);
    }
  });
  return partyMode;
}

/** 管理员判定:拥有 op tag 的玩家 */
export function isAdmin(player: Player): boolean {
  return player.hasTag("op");
}
