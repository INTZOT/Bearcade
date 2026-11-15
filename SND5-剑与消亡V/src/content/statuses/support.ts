// ============================================================
// 增益相关状态(内容设计 PDF 第 11-14 页)
// - 清流: 1s 减伤 10% + 缓慢回 5 血;每 3 秒最多被施加 1 次
// - 洁雨: 5s 减伤 50%→0% 递减,3 秒回 15 血,自然到期溅射 3 点水伤
// - 水仙初临: 12s 持续回复/净化;累计受 70 点伤害转魔力;
//   治疗量溢出(含自身回血)即进阶水仙伴生
// - 水仙伴生: 20s 不可清除,1 次 100% 减免 + 每秒回血 + 定时净化
// 持续回复统一走 combat.heal(受重伤/收束修正;溢出发 heal.overflow)。
// ============================================================
import { statusRegistry } from "../../framework";
import type { PlayerState } from "../../framework";

export const STATUS_CLEAR_STREAM = "snd5:clear_stream";
export const STATUS_PURE_RAIN = "snd5:pure_rain";
export const STATUS_NARCISSUS_ARRIVAL = "snd5:narcissus_arrival";
export const STATUS_NARCISSUS_SYMBIOSIS = "snd5:narcissus_symbiosis";

/** 洁雨持续时间(tick),减伤递减与回血节奏都以此为基准 */
const PURE_RAIN_DURATION = 100; // 5 秒
/** 水仙初临累计伤害转魔力阈值(实际写入量:生命+护甲+真实) */
const NARCISSUS_DAMAGE_THRESHOLD = 70;

/** 状态回复的来源:有施加者记施加者(治疗队友计分),否则记自身 */
function healSource(instanceSourceId: string | undefined, targetId: string): string {
  return instanceSourceId ?? targetId;
}

// ── 清流(重击友方命中 / 水仙庇护低血尝试) ──────────────────────
statusRegistry.register({
  id: STATUS_CLEAR_STREAM,
  displayName: "清流",
  kind: "buff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 25, // 1 秒窗口(尾部 0.25s 容纳第二笔回血)
  clearable: true,
  // 每 3 秒最多可被施加 1 次(重击连发/低血重试都受此约束)
  reapplyCooldownTicks: 60,
  modifiers: { damageReductionMul: 0.9 }, // 10% 伤害减免
  // 持续时间内缓慢回复 5 点:0.5 秒一跳,3+2 两脉冲
  tickIntervalTicks: 10,
  onTick(ctx) {
    const pulses = (ctx.instance.payload.pulses as number | undefined) ?? 0;
    ctx.session.combat.heal(healSource(ctx.instance.sourceId, ctx.targetId), ctx.targetId, {
      amount: pulses === 0 ? 3 : 2,
    });
    ctx.instance.payload.pulses = pulses + 1;
  },
});

// ── 洁雨(涤雨施放时对自身) ────────────────────────────────────
statusRegistry.register({
  id: STATUS_PURE_RAIN,
  displayName: "洁雨",
  kind: "buff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: PURE_RAIN_DURATION,
  clearable: true,
  // 受到的伤害降低 50%~0%,随持续时间线性递减
  modifiers: (instance) => ({
    damageReductionMul: 1 - 0.5 * (Math.max(0, instance.remainingTicks) / PURE_RAIN_DURATION),
  }),
  // 3 秒内回复 15 点:每秒 5 点,共 3 跳
  tickIntervalTicks: 20,
  onTick(ctx) {
    const pulses = (ctx.instance.payload.healPulses as number | undefined) ?? 0;
    if (pulses >= 3) return;
    ctx.session.combat.heal(healSource(ctx.instance.sourceId, ctx.targetId), ctx.targetId, {
      amount: 5,
    });
    ctx.instance.payload.healPulses = pulses + 1;
  },
  // 自然到期才溅射(被清除/死亡走 onRemoved,不触发)
  onExpire(ctx) {
    const carrier = ctx.session.players.get(ctx.targetId);
    if (!carrier?.player.isValid) return;
    const loc = carrier.player.location;
    const myTeam = ctx.session.teams.getTeam(ctx.targetId);
    const enemyFilter = (state: PlayerState): boolean =>
      state.id !== ctx.targetId && ctx.session.teams.getTeam(state.id) !== myTeam;
    ctx.session.primitives.dealAreaDamage(
      ctx.targetId,
      { x: loc.x, y: loc.y, z: loc.z },
      2,
      { hp: 3, element: "water", tags: ["skill"] },
      enemyFilter,
    );
  },
});

// ── 水仙初临(水仙庇护施加 / 固有Ⅲ触发) ────────────────────────
statusRegistry.register({
  id: STATUS_NARCISSUS_ARRIVAL,
  displayName: "水仙初临",
  kind: "buff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 240, // 12 秒
  clearable: true,
  tickIntervalTicks: 24, // 1.2 秒
  // 获得该效果时,随机清空 1 个负面效果
  onApply(ctx) {
    ctx.session.status.clearDebuffs(ctx.targetId, 1);
    ctx.instance.payload.cleanseAtTick = ctx.session.nowTick() + 60;
  },
  // 每 1.2 秒回复 10 点;每隔 3 秒随机清空 1 个负面效果
  onTick(ctx) {
    ctx.session.combat.heal(healSource(ctx.instance.sourceId, ctx.targetId), ctx.targetId, {
      amount: 10,
    });
    if (ctx.session.nowTick() >= ((ctx.instance.payload.cleanseAtTick as number | undefined) ?? 0)) {
      ctx.session.status.clearDebuffs(ctx.targetId, 1);
      ctx.instance.payload.cleanseAtTick = ctx.session.nowTick() + 60;
    }
  },
  // 累计受到超过 70 点伤害(实际写入量) → 清空初临,2 秒内回复 10 点魔力
  onAfterDamaged(ctx) {
    const accumulated =
      ((ctx.instance.payload.damageTaken as number | undefined) ?? 0) +
      ctx.damage.hp +
      ctx.damage.armor +
      ctx.damage.trueDamage;
    ctx.instance.payload.damageTaken = accumulated;
    if (accumulated > NARCISSUS_DAMAGE_THRESHOLD) {
      ctx.removeSelf();
      ctx.session.primitives.scheduleRepeating(20, 2, () => {
        ctx.session.attributes.restoreMana(ctx.targetId, 5);
      });
    }
  },
  // 治疗量溢出即进阶(字面:含水仙初临自身的持续回血)
  evolve: { triggerEvent: "heal.overflow", to: STATUS_NARCISSUS_SYMBIOSIS },
});

// ── 水仙伴生(水仙初临进阶;不可清除,死亡才清) ──────────────────
statusRegistry.register({
  id: STATUS_NARCISSUS_SYMBIOSIS,
  displayName: "水仙伴生",
  kind: "buff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 400, // 20 秒
  clearable: false,
  tickIntervalTicks: 20, // 1 秒
  // 1 次 100% 伤害减免(真实伤害按设计穿透,不经 beforeDamage)
  onDamageTaken(ctx) {
    if (ctx.instance.payload.shieldUsed) return;
    ctx.instance.payload.shieldUsed = true;
    ctx.cancel();
  },
  onApply(ctx) {
    ctx.instance.payload.cleanseAtTick = ctx.session.nowTick() + 100; // 5 秒
  },
  // 每 1 秒回复 10 点;每隔 5 秒清空一次所有负面效果
  onTick(ctx) {
    ctx.session.combat.heal(healSource(ctx.instance.sourceId, ctx.targetId), ctx.targetId, {
      amount: 10,
    });
    if (ctx.session.nowTick() >= ((ctx.instance.payload.cleanseAtTick as number | undefined) ?? 0)) {
      ctx.session.status.clearDebuffs(ctx.targetId);
      ctx.instance.payload.cleanseAtTick = ctx.session.nowTick() + 100;
    }
  },
});
