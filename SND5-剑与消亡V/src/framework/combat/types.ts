// ============================================================
// CombatPipeline 类型定义(架构设计 §4.3)
// 伤害 = 类型 × 元素 的二维模型;一维模型无法表达
// 「15 点护甲伤害 + 8 点生命伤害」这类规则。
// ============================================================
import type { DamageElement, DamageTag } from "../types";

export type { DamageElement, DamageTag } from "../types";

export interface DamagePayload {
  /** 生命值伤害 */
  hp?: number;
  /** 护甲值伤害(独立数值,扣不完不转生命伤害) */
  armor?: number;
  /** 护甲上限百分比伤害(与 armor 叠加,按目标 base.armor 换算) */
  armorPercent?: number;
  /** 真实伤害:穿透护甲与临时护甲,且不受任何修饰 */
  trueDamage?: number;
  element: DamageElement;
  tags?: DamageTag[];
  skillId?: string;
}

export interface DamageResult {
  lethal: boolean;
  /** 实际写入量(含反应前主伤害) */
  hp: number;
  armor: number;
  tempArmor: number;
  trueDamage: number;
}

export interface HealPayload {
  /** 生命值回复 */
  amount?: number;
  /** 魔力回复 */
  mana?: number;
  /** 护甲回复(甲修) */
  armor?: number;
  skillId?: string;
}

export interface HealResult {
  hp: number;
  mana: number;
  armor: number;
  overflow: number;
  /** true = 被收束类状态记录,未实际回复 */
  recorded: boolean;
}
