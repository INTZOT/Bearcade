// ============================================================
// StatusEffectSystem 类型定义(架构设计 §4.2)
// 状态是"规则表":只声明"我存在时伤害/治疗如何变化"(modifiers),
// 不认识伤害数值;条件性取消才用 onDamageTaken 钩子。
// ============================================================
import type { MatchSession } from "../session";

export type StatusKind = "buff" | "debuff" | "neutral";

/** 修饰器集合:CombatPipeline 聚合的唯一来源 */
export interface StatusModifiers {
  /** 受到伤害倍率(撕裂 1.10) */
  damageTakenMul?: number;
  /** 受到伤害固定增减(泄露 8 层 +2;负值 = 固定减伤) */
  damageTakenFlat?: number;
  /** 造成伤害倍率 */
  damageDealtMul?: number;
  /** 造成伤害固定增减(浊露 16 层 -5) */
  damageDealtFlat?: number;
  /** 造成护甲伤害倍率(碎甲秘典 1.5;只放大护甲分量,生命分量不变) */
  armorDealtMul?: number;
  /** 减伤倍率(清流 0.9;洁雨随时间递减用函数) */
  damageReductionMul?: number;
  /** 固定减伤(磐石:每层 1 点,先百分比后固定值) */
  damageReductionFlat?: number;
  /** 治疗量倍率(重伤写 0.8) */
  healingTakenMul?: number;
  /** 移速倍率(框架只聚合数值,原版效果应用由内容层决定) */
  moveSpeedMul?: number;
}

/** 修饰器可以是对象,也可以是按实例计算的函数(泄露/魔魇降临/洁雨) */
export type StatusModifiersProvider =
  | StatusModifiers
  | ((instance: StatusInstance) => StatusModifiers | undefined);

/** 特殊机制开关:框架按标志位实现通用行为,具体状态只声明 */
export interface StatusFlags {
  /** 治疗拦截(收束):治疗不再直接回复,记录进 payload 待结束返还 */
  healIntercept?: boolean;
  /** 自然回复拦截(收束):魔力自然回复被记录进 payload.manaRecorded */
  regenIntercept?: boolean;
}

export interface StatusDefinition {
  id: string;
  kind: StatusKind;
  displayName: string;
  /** 叠加上限;1 表示不叠层(与技能堆叠 maxStacks 完全无关) */
  maxStacks: number;
  /** refresh=刷新时长;stack=叠层;both=叠层并刷新(泄露) */
  stackMode: "refresh" | "stack" | "both";
  /** 持续 tick 数;-1 表示永久(磐石) */
  durationTicks: number;
  /** 是否可被净化;false 时 clearStatus 直接忽略(魔魇噬魂) */
  clearable: boolean;
  /** 达到上限后不可继续叠加与刷新(泄露 32 层) */
  freezeAtMax?: boolean;
  /** 持续期间能否重新施加(魔魇降临 false) */
  reapplyable?: boolean;
  /** 施加本状态时清空这些互斥状态(电离/焙烧/浸润) */
  excludes?: string[];
  /**
   * 进化为另一状态(电流涌动→进发、水仙初临→伴生)。
   * triggerEvent 命中且事件涉及携带者时,由系统统一检查,技能不写转化逻辑。
   */
  evolve?: { triggerEvent: string; to: string; keepStacks?: boolean };
  modifiers?: StatusModifiersProvider;
  flags?: StatusFlags;
  /** onTick 调用间隔(默认跟随全局状态 tick 粒度 5) */
  tickIntervalTicks?: number;
  onApply?(ctx: StatusContext): void;
  onRefresh?(ctx: StatusContext): void;
  onStacksChanged?(ctx: StatusContext): void;
  onTick?(ctx: StatusContext): void;
  onExpire?(ctx: StatusContext): void;
  onRemoved?(ctx: StatusContext): void;
  /** 条件性取消本次伤害(水仙伴生 1 次 100% 减免);ctx.cancel() 取消 */
  onDamageTaken?(ctx: StatusDamageContext): void;
}

/** 状态运行时实例;payload 承载收束记录、护盾已用等私有数据 */
export interface StatusInstance {
  id: string;
  stacks: number;
  remainingTicks: number;
  sourceId?: string;
  appliedAtTick: number;
  lastTickAtTick: number;
  payload: Record<string, number | boolean | string>;
}

export interface StatusContext {
  session: MatchSession;
  targetId: string;
  statusId: string;
  instance: StatusInstance;
  /** 移除自身(等价 session.status.remove(targetId, statusId)) */
  removeSelf(): void;
}

export interface StatusDamageContext extends StatusContext {
  cancel(): void;
}

/** 修饰器聚合结果(CombatPipeline 消费) */
export interface AggregatedMods {
  takenMul: number;
  takenFlat: number;
  dealtMul: number;
  dealtFlat: number;
  armorDealtMul: number;
  reductionMul: number;
  reductionFlat: number;
  healingMul: number;
  moveSpeedMul: number;
}

export const NEUTRAL_MODS: AggregatedMods = {
  takenMul: 1,
  takenFlat: 0,
  dealtMul: 1,
  dealtFlat: 0,
  armorDealtMul: 1,
  reductionMul: 1,
  reductionFlat: 0,
  healingMul: 1,
  moveSpeedMul: 1,
};
