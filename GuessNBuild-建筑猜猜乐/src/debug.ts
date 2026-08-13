import type { MinigameRuntime } from "../../shared/minigame-core/runtime";

let getRuntimeFn: (() => MinigameRuntime) | null = null;

export function bindDebugRuntime(fn: () => MinigameRuntime): void {
  getRuntimeFn = fn;
}

export function isDebug(): boolean {
  return getRuntimeFn?.().isDebug() ?? false;
}

export function toggleDebug(): boolean {
  return getRuntimeFn?.().toggleDebug() ?? false;
}

export function loadDebugState(): void {
  // 调试状态由共享运行时在 initWorld 时加载
}

export function dbg(...args: unknown[]): void {
  if (isDebug()) {
    console.warn("[Bearcade GNBDebug]", ...args);
  }
}
