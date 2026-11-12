// ============================================================
// 元素反应规则表(架构设计 §4.3.3 阶段 2)
// SND5 的反应是「元素 × 状态」,不是「元素 × 元素」:
// 携带某状态的单位受到特定元素伤害时触发反应。
// - 反应伤害作为追加 payload 走完整管线(受受伤修正影响),
//   带 reaction 标签不再递归解析;
// - 本源(origin)与所有需要特定元素的效果反应,
//   优先级 水 > 电 > 火(内容设计 PDF 第 1 页)。
// 规则表是内容层数据,执行在 CombatPipeline(规则在管线收口)。
// ============================================================
import type { MatchSession } from "../session";
import type { StatusInstance } from "../status/types";
import type { DamageElement } from "../types";
import type { DamagePayload } from "./types";

export interface ReactionBuildContext {
  session: MatchSession;
  /** 本次伤害的来源(链式反应/连锁伤害沿用同一来源计分与归属) */
  sourceId?: string;
  targetId: string;
  /** 携带的、触发反应的状态实例 */
  instance: StatusInstance;
  basePayload: DamagePayload;
}

export interface ReactionOutcome {
  /** 追加伤害 payload(管线自动补 reaction 标签) */
  payloads?: DamagePayload[];
  /** 追加状态施加(targetId 缺省为受击者) */
  applyStatus?: {
    targetId?: string;
    statusId: string;
    stacks?: number;
    durationTicks?: number;
  }[];
  /** 击飞(焙烧→火反应) */
  launch?: { targetIds: string[]; strength: number };
  /** 消耗掉触发反应的状态实例(电离受电伤) */
  consume?: boolean;
}

export interface ReactionDefinition {
  statusId: string;
  trigger: DamageElement;
  build(ctx: ReactionBuildContext): ReactionOutcome | undefined;
}

/** 本源反应的展开优先级:水 > 电 > 火 */
const ORIGIN_PRIORITY: readonly DamageElement[] = ["water", "electric", "fire"];

class ReactionTable {
  private readonly byStatus = new Map<string, ReactionDefinition[]>();

  add(def: ReactionDefinition): void {
    const list = this.byStatus.get(def.statusId);
    if (!list) {
      this.byStatus.set(def.statusId, [def]);
      return;
    }
    if (list.some((item) => item.trigger === def.trigger)) {
      throw new Error(`[SND5] 重复注册反应: ${def.statusId} × ${def.trigger}`);
    }
    list.push(def);
  }

  lookup(statusId: string, element: DamageElement): ReactionDefinition | undefined {
    const list = this.byStatus.get(statusId);
    if (!list) return undefined;
    if (element === "origin") {
      // 本源:按 水>电>火 展开命中第一个可用反应
      // (互斥状态实际至多携带一个,优先级兜底多状态并存)
      for (const originElement of ORIGIN_PRIORITY) {
        const hit = list.find((item) => item.trigger === originElement);
        if (hit) return hit;
      }
      return undefined;
    }
    return list.find((item) => item.trigger === element);
  }

  /** 仅测试用 */
  clear(): void {
    this.byStatus.clear();
  }
}

/** 全局反应表单例(内容层在状态定义文件旁注册) */
export const reactionTable = new ReactionTable();
