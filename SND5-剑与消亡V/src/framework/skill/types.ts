// ============================================================
// SkillSystem 类型定义(架构设计 §4.4)
// 技能定义只描述「这个技能是什么」;SkillSystem 负责「什么时候能放、
// 冷却怎么走」;Primitives 负责「具体效果怎么落地」。
// 内容层技能文件禁止 import @minecraft/server,只能用 ctx.primitives。
// ============================================================
import type { Player, Vector3 } from "@minecraft/server";
import type { IndicatorOptions, IndicatorSpec } from "../indicator";
import type { MatchSession } from "../session";
import type { Primitives } from "./primitives";

/**
 * passive 槽位:固有Ⅲ类被动,不走施法流程,由 PassiveManager 挂载。
 * weapon_heavy 伪槽位:重击蓄力占位(use_duration 物品缺失前的统一方案,
 * 走完整 charge 施法流程,但不在 HUD 冷却摘要中展示)。
 */
export type SkillSlot = "innate_1" | "innate_2" | "codex_1" | "codex_2" | "passive" | "weapon_heavy";

export type CastMode = "instant" | "charge" | "windup" | "channel";

export type CastFailReason =
  | "dead"
  | "not_equipped"
  | "cooldown"
  | "no_stacks"
  | "no_mana"
  | "sneak_required"
  | "sneak_forbidden"
  | "status_required"
  | "status_forbidden"
  | "failed";

export type CooldownBranchName = "ready" | "onHit" | "onMiss" | "expire";

/** 四段式冷却:命中不进 CD / 消失后进 CD / 二段进 CD 等分支 */
export interface CooldownBranches {
  /** 默认冷却(tick) */
  ready: number;
  /** 命中分支(定锚命中:0 = 不进冷却) */
  onHit?: number;
  /** 落空分支 */
  onMiss?: number;
  /** 消失分支(定锚 6 秒后消失 → 9 秒) */
  expire?: number;
}

export type CooldownSpec = number | CooldownBranches;

export interface ChargeConfig {
  /** 强制继续蓄力的最小 tick(坦克重击 10% 前松手无效) */
  minTicks?: number;
  /** 蓄满 tick(100%) */
  maxTicks: number;
  /** onChargeTick 调用间隔(默认每 tick) */
  tickIntervalTicks?: number;
  /**
   * 松手取消型蓄力:蓄满前松手则整个蓄力作废(进度清零、退还预扣、
   * 不进冷却,打断同款处理),而非强制继续蓄力;蓄满自动施放不受影响。
   * 与 minTicks 可组合:未到 minTicks 前松手仍强制继续(焚天斩不设
   * minTicks,任意松手即取消)。
   */
  cancelOnRelease?: boolean;
  onChargeTick?(ctx: CastContext): void;
}

export interface SkillDefinition {
  id: string;
  displayName: string;
  /** 槽位仅作 UI/装备映射;秘典技能与固有技能完全同构 */
  slot: SkillSlot;

  // ── 资源与冷却 ──────────────────────────────────────────────
  /** 魔力消耗;函数用于「当前全部魔力」等动态消耗 */
  manaCost?: number | ((ctx: CastContext) => number);
  /** 魔力不足也允许施放(控制被动:消耗全部魔力) */
  allowInsufficientMana?: boolean;
  /** 魔力不足部分用生命值代替(群法被动) */
  hpSubstitute?: boolean;
  /** 数字 = 固定 CD;对象 = 四段式;函数 = 定律等动态 CD(返回 tick) */
  cooldown: CooldownSpec | ((ctx: CastContext) => number | null);
  /** 技能使用堆叠(不是状态层数):可连放次数 */
  maxStacks?: number;
  /** 堆叠恢复间隔;null/undefined = 冷却结束时一次性回满 */
  stackRecoveryTicks?: number | null;
  /**
   * 堆叠为 0 时允许再次校验通过(定锚二段:锚在场时堆叠已扣,
   * 二段施法需要绕过堆叠检查)。
   */
  canIgnoreStackCheck?(session: MatchSession, playerId: string): boolean;

  // ── 施法模式 ────────────────────────────────────────────────
  castMode?: CastMode;
  chargeConfig?: ChargeConfig;
  /** 前摇 tick(windup 模式) */
  windupTicks?: number;
  /** 蓄力/前摇期间受伤是否打断(默认 true;打断退还预扣) */
  interruptible?: boolean;
  /**
   * 施法指示器(内容设计「指示器」):charge/windup/channel 期间由
   * IndicatorSystem 自动显示并每会话 tick 重算 —— 跟随位置/视角/蓄力值,
   * 结算/打断/死亡即回收;返回 undefined 表示本拍隐藏。
   * instant 技能无施法过程,落点闪烁用 primitives.showIndicator。
   * 潜行变体差异直接读 ctx.isSneaking(晨露 +3 格、水的两面性 6→8 格)。
   */
  indicator?(ctx: CastContext): IndicatorSpec | IndicatorSpec[] | undefined;
  /** 施法指示器的可见性/粒子覆写(默认仅施法者可见 + endrod) */
  indicatorOptions?: IndicatorOptions;

  // ── 前置条件 ────────────────────────────────────────────────
  requiresSneak?: boolean;
  forbidSneak?: boolean;
  requiresStatus?: string[];
  forbidsStatus?: string[];
  /** 校验失败提示覆写(默认提示见 SkillSystem.FAILURE_HINTS) */
  failureHint?: Partial<Record<CastFailReason, string>>;

  // ── 施法体 ──────────────────────────────────────────────────
  /** 施法体;被动(slot="passive")不施放,可省略 */
  cast?(ctx: CastContext): CastResult;
  /** 潜行变体(不突进/换效果/切定律);未定义时回退 cast */
  castSneaking?(ctx: CastContext): CastResult;

  // ── 吟唱 ────────────────────────────────────────────────────
  onChannelTick?(ctx: CastContext): void;
  onChannelEnd?(ctx: CastContext): void;

  // ── 被动(固有Ⅲ)= 事件订阅者 ────────────────────────────────
  /** 订阅的事件名(见 events.ts Snd5EventMap) */
  listen?: string[];
  onEvent?(
    event: { name: string; payload: unknown },
    ctx: PassiveContext,
  ): { startCooldownTicks?: number } | void;
}

/**
 * 施法结果(TS 化:tagged union 替代文档中松散的 true/false/{...}):
 * - normalizeCastResult(true) → { ok: true } 走 ready 冷却;
 * - suppressCooldown:成功但不进冷却(定锚投出、群法切定律);
 * - cooldown:走指定分支;cooldownTicks:直接指定 tick(优先)。
 */
export type CastResult = boolean | CastOutcome;

export interface CastOutcome {
  ok: boolean;
  cooldown?: CooldownBranchName;
  /** 直接指定冷却 tick,优先于 cooldown 分支 */
  cooldownTicks?: number;
  suppressCooldown?: boolean;
  /** 退还部分魔力(战士突进未命中等) */
  refundMana?: number;
}

export function normalizeCastResult(result: CastResult): CastOutcome {
  if (result === true) return { ok: true };
  if (result === false) return { ok: false };
  return result;
}

/** 施法上下文:技能与框架之间的唯一接口 */
export interface CastContext {
  session: MatchSession;
  /** 玩家实体(注意生命周期,长周期回调里先判 isValid) */
  player: Player;
  casterId: string;
  skillId: string;
  def: SkillDefinition;
  slot: string;
  /**
   * 潜行状态(潜行变体分发依据)。instant 在施法瞬间捕获;
   * charge/windup/channel 由 SkillSystem 每 tick 刷新 —— 按"结算时点"
   * 判定(蓄力松手/前摇完成时是否潜行,如增益晨露)。
   */
  isSneaking: boolean;
  /** 施法瞬间视角方向 */
  direction: Vector3;
  // 蓄力(windup/charge 模式由控制器填充)
  chargeTicks: number;
  chargePercent: number;
  channelTicks: number;
  /**
   * 本次施法已进行的真实 tick(charge/windup/channel 由 SkillSystem
   * 每拍刷新;蓄力时长/前摇进度/圆心移动速率都以此为准 ——
   * chargeTicks 是回调计数,受会话 5t 网格影响,勿混用)
   */
  castElapsedTicks: number;
  // 预扣记录(失败/打断退还)
  predeductedMana: number;
  predeductedStacks: boolean;
  /** 技能私有存储(二段施法状态等),键为 playerId::skillId */
  store: Map<string, unknown>;
  /** 效果原语:技能执行动作的唯一通道 */
  primitives: Primitives;
}

/** 被动上下文 */
export interface PassiveContext {
  session: MatchSession;
  playerId: string;
  def: SkillDefinition;
  primitives: Primitives;
}
