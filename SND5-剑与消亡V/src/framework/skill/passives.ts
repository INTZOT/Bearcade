// ============================================================
// PassiveManager —— 被动 = 事件订阅者(架构设计 §4.4.11)
// 7 个固有Ⅲ的触发源分散在 7 个系统里:被动是事件订阅者,
// 不是「if 判断」。PassiveManager 只负责挂载/卸载与被动冷却。
// ============================================================
import { system } from "@minecraft/server";
import type { MatchSession } from "../session";
import type { PassiveContext, SkillDefinition } from "./types";
import { extractInvolvedIds } from "../events";

export class PassiveManager {
  /** Map<playerId, 注销函数列表> */
  private readonly subscriptions = new Map<string, Array<() => void>>();

  constructor(private readonly session: MatchSession) {}

  /** 挂载被动(职业初始化/重生时调用;重复挂载先卸载) */
  attach(playerId: string, defs: readonly SkillDefinition[]): void {
    this.detach(playerId);
    const offs: Array<() => void> = [];
    for (const def of defs) {
      for (const eventName of def.listen ?? []) {
        offs.push(
          this.session.bus.onAny((name, payload) => {
            if (name !== eventName) return;
            const involved = extractInvolvedIds(payload);
            if (!involved.has(playerId)) return;
            if (!this.session.skills.isPassiveReady(playerId, def.id)) return;

            const ctx: PassiveContext = {
              session: this.session,
              playerId,
              def,
              primitives: this.session.primitives,
            };
            let result: { startCooldownTicks?: number } | void;
            try {
              result = def.onEvent?.({ name, payload }, ctx);
            } catch (error) {
              console.warn(`[SND5] 被动执行异常 ${def.id}`, error);
              return;
            }
            if (result?.startCooldownTicks) {
              this.session.skills.startPassiveCooldown(
                playerId,
                def.id,
                result.startCooldownTicks,
              );
            }
          }),
        );
      }
    }
    this.subscriptions.set(playerId, offs);
  }

  /** 卸载:防止切换职业/离场后旧被动残留 */
  detach(playerId: string): void {
    const offs = this.subscriptions.get(playerId);
    if (!offs) return;
    for (const off of offs) off();
    this.subscriptions.delete(playerId);
  }

  dispose(): void {
    for (const playerId of [...this.subscriptions.keys()]) this.detach(playerId);
  }
}

/** 被动上下文时间戳工具(导出给内容层判断时长用) */
export function passiveNowTick(): number {
  return system.currentTick;
}
