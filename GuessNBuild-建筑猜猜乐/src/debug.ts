import { system, world } from "@minecraft/server";

const DEBUG_KEY = "bearcade:debug_guessnbuild";

let enabled = false;

export function loadDebugState(): void {
  try {
    enabled = world.getDynamicProperty(DEBUG_KEY) === true;
  } catch {
    enabled = false;
  }
}

export function isDebug(): boolean {
  return enabled;
}

/** 切换调试开关(受限上下文安全:先改内存,再延迟持久化) */
export function toggleDebug(): boolean {
  enabled = !enabled;
  system.run(() => {
    try {
      world.setDynamicProperty(DEBUG_KEY, enabled);
    } catch (error) {
      console.warn("[Bearcade guessnbuild] 调试状态持久化失败", error);
    }
  });
  return enabled;
}

export function dbg(...args: unknown[]): void {
  if (enabled) {
    console.warn("[Bearcade GNBDebug]", ...args);
  }
}
