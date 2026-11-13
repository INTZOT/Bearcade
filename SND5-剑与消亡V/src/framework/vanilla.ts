// ============================================================
// vanilla.ts —— 原版表现层桥接(引擎层薄适配)
// SND5 数值全部经 health.setCurrentValue 直写,不经过原版伤害
// 结算,因此没有受击反馈(红闪/受击音效/受击动画),近战也没有
// 方向击退。本模块用「临时抬满 → 原版小伤害 → 回写最终值」的
// 同 tick 三步借原版伤害事件拿到这些表现:
// 1. 抬满载体血量:反馈伤害(1 点)绝不致死(客户端只看同 tick
//    最终值,中间过程不可见);
// 2. 旁路标志放行 entityHurt 拦截器(listeners 检查 isFeedbackBypass),
//    伤害落 地 → 原版触发红闪/音效/动画;攻击者在场时用
//    entityAttack 原因,由原版按攻击者位置计算方向击退;
// 3. 调用方(AttributeSystem)随后写最终血量。
// ============================================================
import {
  EntityDamageCause,
  type EntityHealthComponent,
  type Player,
} from "@minecraft/server";

/** 反馈伤害量(半颗心);载体已临时抬满,永不致死 */
const FEEDBACK_DAMAGE = 1;

let feedbackBypassActive = false;

/** entityHurt 拦截器检查:旁路激活时放行本次伤害(受击表现用) */
export function isFeedbackBypass(): boolean {
  return feedbackBypassActive;
}

/**
 * 对玩家施加受击反馈。
 * @param player 受击者
 * @param attacker 攻击者(可选;提供时按 entityAttack 结算,含方向击退)
 */
export function applyHurtFeedback(player: Player, attacker?: Player): void {
  if (feedbackBypassActive) return; // 防重入(同步调用下理论上不可达)
  const health = player.getComponent("minecraft:health") as
    | EntityHealthComponent
    | undefined;
  if (!health) return;
  feedbackBypassActive = true;
  try {
    health.setCurrentValue(health.effectiveMax);
    player.applyDamage(FEEDBACK_DAMAGE, attacker?.isValid
      ? { cause: EntityDamageCause.entityAttack, damagingEntity: attacker }
      : { cause: EntityDamageCause.override });
  } catch {
    // 玩家可能已失效(旁观/离场),反馈失败不影响数值结算
  } finally {
    feedbackBypassActive = false;
  }
}
