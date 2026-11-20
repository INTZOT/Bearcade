// ============================================================
// 坦克相关状态(内容设计 PDF 第 9-10 页)
// - 磐石: 永久正面叠层;每层提供 1 点固定伤害抵消;
//   重击蓄力结束后清空(skills/tank.ts 的重击结算内触发)。
// - 熔火: 8s 负面;坦克被携带者攻击时,每 1 点伤害为坦克积攒 1%
//   重击蓄力值 —— 蓄力值存于坦克 weapon_heavy 技能私有存储,
//   加到下一次重击,释放后清零(2026-11-18 确认:加算)。
//   实现为 onApply 订阅会话 entity.damaged,到期/移除时注销。
// - 焚烬: 10s 负面;受到火元素伤害时,3 秒内额外受到 3 次 2 点
//   火元素伤害;每 1 秒最多触发 1 次(级联自保护防自反馈)。
// ============================================================
import { statusRegistry } from "../../framework";
import type { MatchSession, StatusContext, StatusAfterDamageContext } from "../../framework";

export const STATUS_MOLTEN = "snd5:molten";
export const STATUS_EMBER = "snd5:ember";
export const STATUS_BEDROCK = "snd5:bedrock";

/**
 * 坦克重击蓄力的私有存储键(skills/tank.ts 的 weapon_heavy 技能):
 * 熔火积攒值写入 tankId::snd5:tank_heavy 的 bonus 字段(0~100)。
 * 与 skills/tank.ts 共用,常量放本文件避免 skills ↔ statuses 循环引用。
 */
export const TANK_HEAVY_SKILL_ID = "snd5:tank_heavy";
export const TANK_HEAVY_BONUS_KEY = "bonus";

/** 熔火积攒蓄力值上限(%;与重击蓄力值同上限) */
const MOLTEN_BONUS_CAP = 100;

/** 焚烬级联窗口(3 秒)与节奏:每 1 秒 1 次 2 点火伤,共 3 次 */
const EMBER_CASCADE_TICKS = 60;
const EMBER_HIT_INTERVAL_TICKS = 20;
const EMBER_HITS = 3;
const EMBER_HIT_DAMAGE = 2;
/** 焚烬触发限频:每 1 秒最多 1 次 */
const EMBER_TRIGGER_INTERVAL_TICKS = 20;

/** 熔火 onApply 注册的 entity.damaged 订阅注销函数(实例 → 注销) */
const moltenSubscriptions = new WeakMap<object, () => void>();

/** 玩家是否为坦克(professionId 由会话 applyLoadout 写入) */
function isTank(session: MatchSession, playerId: string): boolean {
  return session.players.get(playerId)?.professionId === "snd5:tank";
}

/** 读取坦克重击的熔火积攒值(%) */
export function getHeavyChargeBonus(session: MatchSession, tankId: string): number {
  const value = session.skills.privateStore(tankId, TANK_HEAVY_SKILL_ID).get(TANK_HEAVY_BONUS_KEY);
  return typeof value === "number" ? value : 0;
}

/** 熔火积攒:坦克每受到携带者 1 点伤害,重击蓄力值 +1%(上限 100%) */
function addHeavyChargeBonus(session: MatchSession, tankId: string, percent: number): void {
  const store = session.skills.privateStore(tankId, TANK_HEAVY_SKILL_ID);
  const next = Math.min(MOLTEN_BONUS_CAP, getHeavyChargeBonus(session, tankId) + percent);
  store.set(TANK_HEAVY_BONUS_KEY, next);
}

// ── 磐石(正面;永久叠层,重击蓄力结束清空) ──────────────────────

statusRegistry.register({
  id: STATUS_BEDROCK,
  displayName: "磐石",
  kind: "buff",
  // 设计未给上限;实际受蓄力期「每 0.5 秒 1 魔力」的经济约束
  maxStacks: 99,
  stackMode: "stack",
  durationTicks: -1, // 永久,直到重击蓄力结束被清空
  clearable: true,
  // 每层提供 1 点固定伤害抵消(管线先百分比后固定值)
  modifiers: (instance) => ({ damageReductionFlat: instance.stacks }),
});

// ── 熔火(负面;携带者攻击坦克时为坦克积攒蓄力值) ────────────────

statusRegistry.register({
  id: STATUS_MOLTEN,
  displayName: "熔火",
  kind: "debuff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 160, // 8 秒
  clearable: true,
  onApply(ctx: StatusContext) {
    // 状态挂在攻击者(携带者)身上;订阅伤害落地事件:
    // 携带者作为伤害来源命中坦克时,坦克按实际伤害点数积攒蓄力值。
    // (含技能/投射物等一切以携带者为 sourceId 的伤害;DOT 亦算,占位从简)
    const carrierId = ctx.targetId;
    const session = ctx.session;
    const off = session.bus.on("entity.damaged", ({ sourceId, targetId, hp, armor, tempArmor, trueDamage }) => {
      if (sourceId !== carrierId) return;
      if (!isTank(session, targetId)) return;
      const total = hp + armor + tempArmor + trueDamage;
      if (total <= 0) return;
      addHeavyChargeBonus(session, targetId, total);
    });
    moltenSubscriptions.set(ctx.instance, off);
  },
  // 到期与移除都要注销(onRemoved 走 clearStatus/clearAll,onExpire 走自然到期)
  onExpire(ctx: StatusContext) {
    moltenSubscriptions.get(ctx.instance)?.();
    moltenSubscriptions.delete(ctx.instance);
  },
  onRemoved(ctx: StatusContext) {
    moltenSubscriptions.get(ctx.instance)?.();
    moltenSubscriptions.delete(ctx.instance);
  },
});

// ── 焚烬(负面;受火伤级联掉血,每秒限 1 次) ──────────────────────

statusRegistry.register({
  id: STATUS_EMBER,
  displayName: "焚烬",
  kind: "debuff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 200, // 10 秒
  clearable: true,
  onAfterDamaged(ctx: StatusAfterDamageContext) {
    // 只对火元素伤害触发;0 伤害(全额被抵消)不触发
    if (ctx.damage.element !== "fire") return;
    const total = ctx.damage.hp + ctx.damage.armor + ctx.damage.tempArmor + ctx.damage.trueDamage;
    if (total <= 0) return;
    const now = ctx.session.nowTick();
    // 级联自保护:本效果自己排出的 3 次火伤不再触发
    // (窗口 3 秒覆盖全部级联伤害,含会话 5t 网格的最后一拍)
    const cascadeEnd = (ctx.instance.payload.cascadeEndTick as number | undefined) ?? -1;
    if (now <= cascadeEnd) return;
    // 每 1 秒最多触发 1 次
    const lastTrigger = (ctx.instance.payload.lastTriggerTick as number | undefined) ?? Number.NEGATIVE_INFINITY;
    if (now - lastTrigger < EMBER_TRIGGER_INTERVAL_TICKS) return;
    ctx.instance.payload.lastTriggerTick = now;
    ctx.instance.payload.cascadeEndTick = now + EMBER_CASCADE_TICKS;
    const sourceId = ctx.instance.sourceId;
    ctx.session.primitives.scheduleRepeating(EMBER_HIT_INTERVAL_TICKS, EMBER_HITS, () => {
      if (ctx.session.isDead(ctx.targetId)) return;
      ctx.session.combat.dealDamage(sourceId, ctx.targetId, {
        hp: EMBER_HIT_DAMAGE,
        element: "fire",
        tags: ["dot"],
      });
    });
  },
});
