import type { MinigameRuntime } from "../../shared/minigame-core/runtime";

let getRuntimeFn: (() => MinigameRuntime) | null = null;

export function bindDebugRuntime(fn: () => MinigameRuntime): void {
  getRuntimeFn = fn;
}

export function isDebug(): boolean {
  return getRuntimeFn?.().isDebug() ?? false;
}

export function dbg(...args: unknown[]): void {
  if (isDebug()) {
    console.warn("[Bearcade GNBDebug]", ...args);
  }
}
