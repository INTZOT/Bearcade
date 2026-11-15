// ============================================================
// CombatPipeline —— 会计(架构设计 §4.3)
// 所有伤害与治疗的唯一入口:聚合修饰器 → 解析反应 → 拆分伤害 →
// 写入账本 → 发事件 → 致死判定与拦截。
// 技能/武器/DOT/状态跳伤全部走 dealDamage / heal,禁止绕行。
// ============================================================
import type { MatchSession } from "../session";
import { NEUTRAL_MODS, type AggregatedMods } from "../status/types";
import type { DamageTag } from "../types";
import type {
  DamageElement,
  DamagePayload,
  DamageResult,
  HealPayload,
  HealResult,
} from "./types";
import { reactionTable, type ReactionOutcome } from "./reactions";

/** 反应递归上限:反应伤害带 reaction 标签,正常不会超过 1 层 */
const MAX_REACTION_DEPTH = 3;
/** 击杀归属记录窗口(助攻/补刀判定用) */
const KILL_CREDIT_WINDOW_TICKS = 100;

export class CombatPipeline {
  /** Map<targetId, {sourceId, tick}[]>,近窗口伤害来源(击杀归属) */
  private readonly recentDamage = new Map<string, Array<{ sourceId: string; tick: number }>>();

  constructor(private readonly session: MatchSession) {}

  // ── 伤害(六阶段) ─────────────────────────────────────────────

  dealDamage(
    sourceId: string | undefined,
    targetId: string,
    payload: DamagePayload,
    depth = 0,
  ): DamageResult | undefined {
    const attributes = this.session.attributes;
    const state = attributes.get(targetId);
    if (!state || this.session.isDead(targetId)) return undefined;
    const tags = payload.tags ?? [];

    // 真实伤害:不经过任何修饰与反应,直接写入账本
    const trueDamage = Math.max(0, payload.trueDamage ?? 0);
    if (trueDamage > 0 && (payload.hp ?? 0) === 0 && (payload.armor ?? 0) === 0) {
      const applied = attributes.applyDamage(targetId, { trueDamage, sourceId });
      this.recordDamage(targetId, sourceId);
      this.emitDamaged(sourceId, targetId, applied, payload, tags, applied.lethal);
      this.finishLethal(sourceId, targetId, applied.lethal, tags, payload.element);
      return {
        lethal: applied.lethal,
        hp: applied.actual.hp,
        armor: 0,
        tempArmor: 0,
        trueDamage: applied.actual.hp,
      };
    }

    // [2] 管线前置事件:完全免疫类状态(水仙伴生)在此取消,早于状态钩子
    let cancelled = false;
    this.session.bus.emit("combat.beforeDamage", {
      sourceId,
      targetId,
      payload,
      cancel: () => {
        cancelled = true;
      },
    });
    if (cancelled) return undefined;

    // [3] 修饰器聚合:目标侧 taken/reduction + 来源侧 dealt
    const targetMods = this.session.status.aggregate(targetId);
    const sourceMods = sourceId ? this.session.status.aggregate(sourceId) : NEUTRAL_MODS;

    // [4] 拆分与计算:先百分比后固定值,中间浮点最后取整
    const baseHp = Math.max(0, payload.hp ?? 0);
    let baseArmor = Math.max(0, payload.armor ?? 0);
    if (payload.armorPercent && payload.armorPercent > 0) {
      baseArmor += state.base.armor * payload.armorPercent;
    }
    const hpFinal = this.computeFinal(baseHp, targetMods, sourceMods);
    // 护甲分量额外乘来源侧 armorDealtMul(碎甲秘典:对甲伤害提升 50%;仅放大护甲)
    const armorFinal = this.computeFinal(baseArmor, targetMods, {
      ...sourceMods,
      dealtMul: sourceMods.dealtMul * sourceMods.armorDealtMul,
    });

    // [5] 写入 AttributeSystem(真实伤害部分在账本内独立穿透,不走修饰)
    const applied = attributes.applyDamage(targetId, {
      hp: hpFinal,
      armor: armorFinal,
      trueDamage: Math.max(0, payload.trueDamage ?? 0),
      sourceId,
    });

    // 反应解析:主伤害结算后进行;reaction 标签不再递归
    if (!tags.includes("reaction") && depth < MAX_REACTION_DEPTH) {
      this.resolveReactions(sourceId, targetId, payload, depth);
    }

    // [6] 后置:事件、致死判定与拦截
    this.recordDamage(targetId, sourceId);
    const result: DamageResult = {
      lethal: applied.lethal,
      hp: applied.actual.hp,
      armor: applied.actual.armor,
      tempArmor: applied.actual.tempArmor,
      trueDamage: Math.max(0, payload.trueDamage ?? 0),
    };
    this.emitDamaged(sourceId, targetId, applied, payload, tags, applied.lethal);
    this.session.bus.emit("combat.afterDamage", { sourceId, targetId, result });
    this.finishLethal(sourceId, targetId, applied.lethal, tags, payload.element);
    return result;
  }

  // ── 治疗 ─────────────────────────────────────────────────────

  heal(sourceId: string | undefined, targetId: string, payload: HealPayload): HealResult | undefined {
    if (!this.session.attributes.get(targetId)) return undefined;

    let cancelled = false;
    this.session.bus.emit("combat.beforeHeal", {
      sourceId,
      targetId,
      payload,
      cancel: () => {
        cancelled = true;
      },
    });
    if (cancelled) return undefined;

    // 收束类状态:治疗被记录,效果结束时全量返还(不走治疗修正)
    const interceptor = this.session.status.findHealInterceptor(targetId);
    if (interceptor) {
      this.session.status.updatePayload(targetId, interceptor.id, (record) => {
        record.hpRecorded = ((record.hpRecorded as number | undefined) ?? 0) + (payload.amount ?? 0);
        record.manaRecorded =
          ((record.manaRecorded as number | undefined) ?? 0) + (payload.mana ?? 0);
        record.armorRecorded =
          ((record.armorRecorded as number | undefined) ?? 0) + (payload.armor ?? 0);
      });
      return { hp: 0, mana: 0, armor: 0, overflow: 0, recorded: true };
    }

    const healingMul = this.session.status.aggregate(targetId).healingMul;
    const healResult = this.session.attributes.applyHeal(
      targetId,
      Math.round((payload.amount ?? 0) * healingMul),
    );
    const manaActual = this.session.attributes.restoreMana(
      targetId,
      Math.round((payload.mana ?? 0) * healingMul),
    );
    const armorActual = this.session.attributes.restoreArmor(
      targetId,
      Math.round((payload.armor ?? 0) * healingMul),
    );

    const result: HealResult = {
      hp: healResult.actual,
      mana: manaActual,
      armor: armorActual,
      overflow: healResult.overflow,
      recorded: false,
    };
    if (result.overflow > 0) {
      // 治疗溢出(水仙初临→伴生转化等由内容层订阅)
      this.session.bus.emit("heal.overflow", { targetId, overflow: result.overflow });
    }
    this.session.bus.emit("combat.afterHeal", { sourceId, targetId, actual: result });
    return result;
  }

  // ── 击杀归属 ─────────────────────────────────────────────────

  /** 近窗口内最后一位伤害来源(致死时 sourceId 缺失的兜底) */
  getRecentAttacker(targetId: string, nowTick: number): string | undefined {
    const records = this.recentDamage.get(targetId);
    if (!records?.length) return undefined;
    for (let i = records.length - 1; i >= 0; i--) {
      if (nowTick - records[i].tick <= KILL_CREDIT_WINDOW_TICKS) return records[i].sourceId;
    }
    return undefined;
  }

  dispose(): void {
    this.recentDamage.clear();
  }

  // ── 内部 ─────────────────────────────────────────────────────

  /**
   * 计算顺序(关键决策,架构设计 §4.3.3 阶段 4):
   *   最终值 = max(0, 基础 × 受伤% × 减伤% − 固定抵消 − 固定减伤 + 固定增伤)
   * - 先百分比后固定值:磐石「每层 1 点抵消」对高伤技能依然有效;
   * - 受伤增加与减伤乘算(1.1 × 0.9 = 0.99),避免叠满减伤后免疫;
   * - 真实伤害不参与任何修饰(在 dealDamage 入口分流)。
   */
  private computeFinal(base: number, target: AggregatedMods, source: AggregatedMods): number {
    const mul = source.dealtMul * target.takenMul * target.reductionMul;
    const add = Math.max(0, target.takenFlat) + Math.max(0, source.dealtFlat);
    const sub =
      Math.max(0, -target.takenFlat) + Math.max(0, -source.dealtFlat) + target.reductionFlat;
    return Math.max(0, Math.round(base * mul + add - sub));
  }

  /** 反应伤害作为追加 payload 走完整管线(也受受伤修正影响) */
  private resolveReactions(
    sourceId: string | undefined,
    targetId: string,
    basePayload: DamagePayload,
    depth: number,
  ): void {
    for (const instance of [...this.session.status.getAll(targetId)]) {
      // 主伤害致死时停止结算该目标的后续反应:
      // 递归反应伤害可能在 alive 标志翻转前先触发 handleDeath(清状态),
      // 之后继续施加反应状态会把状态挂到尸体上(clearAll 后复活,重生残留)。
      if (this.session.isDead(targetId)) return;

      const reaction = reactionTable.lookup(instance.id, basePayload.element);
      if (!reaction) continue;
      let outcome: ReactionOutcome | undefined;
      try {
        outcome = reaction.build({
          session: this.session,
          sourceId,
          targetId,
          instance,
          basePayload,
        });
      } catch (error) {
        console.warn(`[SND5] 反应构建异常 ${instance.id}`, error);
        continue;
      }
      if (!outcome) continue;

      for (const payload of outcome.payloads ?? []) {
        this.dealDamage(sourceId, targetId, {
          ...payload,
          tags: [...(payload.tags ?? []), "reaction"],
        }, depth + 1);
      }
      for (const status of outcome.applyStatus ?? []) {
        this.session.status.apply(status.targetId ?? targetId, status.statusId, sourceId, {
          stacks: status.stacks,
          durationTicks: status.durationTicks,
        });
      }
      const launch = outcome.launch;
      if (launch) {
        for (const launchTargetId of launch.targetIds) {
          this.session.primitives.launch(launchTargetId, launch.strength);
        }
      }
      if (outcome.consume) {
        this.session.status.remove(targetId, instance.id, "reaction_consumed");
      }
    }
  }

  private emitDamaged(
    sourceId: string | undefined,
    targetId: string,
    applied: { lethal: boolean; actual: { hp: number; armor: number; tempArmor: number } },
    payload: DamagePayload,
    tags: DamageTag[],
    lethal: boolean,
  ): void {
    this.session.bus.emit("entity.damaged", {
      sourceId,
      targetId,
      hp: payload.trueDamage ? 0 : applied.actual.hp,
      armor: applied.actual.armor,
      tempArmor: applied.actual.tempArmor,
      trueDamage: payload.trueDamage ?? 0,
      element: payload.element,
      tags,
      lethal,
    });
  }

  private finishLethal(
    sourceId: string | undefined,
    targetId: string,
    lethal: boolean,
    tags: DamageTag[],
    element: DamageElement,
  ): void {
    if (!lethal) return;
    // 幂等保护:反应递归可能在 alive 标志翻转前对本已 hp=0 的目标再判致死,
    // 已进入死亡流程时直接跳过,防止 entity.killed / damage.lethal 双发
    // 双发会导致击杀类被动重复触发,如战士雷魂回血翻倍。
    if (this.session.isDead(targetId)) return;

    let intercepted = false;
    this.session.bus.emit("damage.lethal", {
      targetId,
      sourceId,
      tags,
      cancel: () => {
        intercepted = true;
      },
    });
    if (intercepted) {
      // 拦截成功:直写通道补回 1 点(绕过管线,唯一例外之一)
      this.session.attributes.setHp(targetId, 1);
      return;
    }
    const killerId = sourceId ?? this.getRecentAttacker(targetId, this.session.nowTick());
    this.session.bus.emit("entity.killed", {
      killerId,
      victimId: targetId,
      cause: tags.includes("dot") ? `dot_${element}` : element,
    });
    this.session.handleDeath(targetId, killerId, "damage");
  }

  private recordDamage(targetId: string, sourceId: string | undefined): void {
    if (!sourceId) return;
    const records = this.recentDamage.get(targetId) ?? [];
    records.push({ sourceId, tick: this.session.nowTick() });
    if (records.length > 16) records.shift();
    this.recentDamage.set(targetId, records);
  }
}
