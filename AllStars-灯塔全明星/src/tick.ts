// ============================================================
// 帧时钟:集中一个地方读 system.currentTick
//
// 为什么单独成文件:
//   Fighter / Match / HUD 都需要"当前 tick",但它们跑在 system.runInterval
//   回调里。集中在这里便于以后换成显式传参(单测友好),也避免各处 import
//   @minecraft/server 造成循环依赖。
// ============================================================

import { system } from "@minecraft/server";

export function currentTick(): number {
  try {
    return system.currentTick;
  } catch {
    return 0;
  }
}
