// ============================================================
// 单法相关状态(内容设计 PDF 第 22-25 页)
// - 收束: 8s;healIntercept + regenIntercept(框架按标志位拦截治疗与
//   自然回复,记录进 payload),结束时记录值全量返还(绕治疗管线的
//   既定例外,架构设计 §5.3「收束结束时的返还走原子接口直写」)
// - 日蚀/月冕: 8s 上限 2 层,叠加刷新时长;互斥对(获得时清空对方,
//   PDF 月冕原文「清除自身月冕」为笔误,2026-11-18 确认为清除日蚀)
// - 境界面强化: 持续至下次重击;武器重击消费后进阶「境界面上的#%¥&$#」
// - 变动率: 3s;到期做时间回溯判定(远点/负荷),期间一方被击杀无效
// - 信标庇护: 隐藏 2s 全额减伤(寻光信标部署奖励)
// ============================================================
import { statusRegistry } from "../../framework";
import type { AttributeSnapshot, MatchSession, StatusContext } from "../../framework";
import type { Vec3 } from "../../../../shared/minigame-core/types";

export const STATUS_RESTRAINT = "snd5:restraint";
export const STATUS_SOLAR_ECLIPSE = "snd5:solar_eclipse";
export const STATUS_LUNAR_CROWN = "snd5:lunar_crown";
export const STATUS_INTERFACE_SURGE = "snd5:interface_surge";
export const STATUS_MUTATION_RATE = "snd5:mutation_rate";
export const STATUS_BEACON_AEGIS = "snd5:beacon_aegis";

// ── 时间回溯:待判定上下文(时光种子命中时记录,变动率到期结算) ──

export interface RewindContext {
  casterId: string;
  victimId: string;
  /** 命中时刻双方的三资源记录(「互换/覆盖到当前状态栏,溢出数值作废」) */
  casterSnapshot: AttributeSnapshot;
  victimSnapshot: AttributeSnapshot;
  /** 变量α(发射者脚下)/ 变量β(被击中者脚下) */
  casterPoint: Vec3;
  victimPoint: Vec3;
}

/** 会话作用域键(模块级 Map 跨对局存续,拼 roomId 防跨房间串扰) */
function rewindKey(session: MatchSession, casterId: string): string {
  return `${session.roomId}:${casterId}`;
}

const pendingRewinds = new Map<string, RewindContext>();

/** 时光种子命中敌人时记录回溯上下文(skills/ranger.ts 调用) */
export function recordRewind(session: MatchSession, context: RewindContext): void {
  pendingRewinds.set(rewindKey(session, context.casterId), context);
}

function takeRewind(session: MatchSession, casterId: string): RewindContext | undefined {
  const key = rewindKey(session, casterId);
  const context = pendingRewinds.get(key);
  pendingRewinds.delete(key);
  return context;
}

/** 远点概率:50% 基础,每层日蚀 +25%,每层月冕 −25%(截断到 0~1) */
function farPointProbability(session: MatchSession, casterId: string): number {
  const eclipse = session.status.getStacks(casterId, STATUS_SOLAR_ECLIPSE);
  const crown = session.status.getStacks(casterId, STATUS_LUNAR_CROWN);
  return Math.min(1, Math.max(0, 0.5 + 0.25 * eclipse - 0.25 * crown));
}

/**
 * 变动率到期:时间回溯判定。
 * - 远点:双方互换位置(α/β 交叉传送)并互换记录的三资源;
 * - 负荷:双方回到各自的变量点并恢复自己命中时刻的记录;
 * - 判定期间一方被击杀/离场 → 本次技能无效。
 * restore 按各自面板截断(溢出作废),是架构既定的管线例外通道。
 */
function resolveRewind(session: MatchSession, casterId: string): void {
  const context = takeRewind(session, casterId);
  if (!context) return;
  const caster = session.players.get(context.casterId);
  const victim = session.players.get(context.victimId);
  if (!caster?.alive || !victim?.alive || !caster.player.isValid || !victim.player.isValid) {
    const casterPlayer = session.players.get(context.casterId)?.player;
    if (casterPlayer?.isValid) {
      session.hud.toast(casterPlayer, "§c变动率判定失败: 一方已被击杀,时间回溯无效");
    }
    return;
  }
  const far = Math.random() < farPointProbability(session, context.casterId);
  if (far) {
    session.primitives.teleport(context.casterId, context.victimPoint);
    session.primitives.teleport(context.victimId, context.casterPoint);
    session.attributes.restore(context.casterId, context.victimSnapshot);
    session.attributes.restore(context.victimId, context.casterSnapshot);
    session.hud.toast(caster.player, `§d判定:§u远点§r §7与目标互换位置与状态`);
    session.hud.toast(victim.player, `§d时间回溯:§u远点§r §7与发射者互换位置与状态`);
  } else {
    session.primitives.teleport(context.casterId, context.casterPoint);
    session.primitives.teleport(context.victimId, context.victimPoint);
    session.attributes.restore(context.casterId, context.casterSnapshot);
    session.attributes.restore(context.victimId, context.victimSnapshot);
    session.hud.toast(caster.player, `§d判定:§c负荷§r §7双方回溯到命中时刻的状态`);
    session.hud.toast(victim.player, `§d时间回溯:§c负荷§r §7状态回溯到命中时刻`);
  }
}

// ── 收束(固有Ⅱ强化光束命中施加) ────────────────────────────────

/** 返还收束期间记录的三资源(到期/被清除两条路径互斥,不会重复) */
function returnRestraintRecords(ctx: StatusContext): void {
  const hp = (ctx.instance.payload.hpRecorded as number | undefined) ?? 0;
  const mana = (ctx.instance.payload.manaRecorded as number | undefined) ?? 0;
  const armor = (ctx.instance.payload.armorRecorded as number | undefined) ?? 0;
  if (hp <= 0 && mana <= 0 && armor <= 0) return;
  // 架构既定例外:返还走 AttributeSystem 原子接口直写,不走治疗管线
  // (否则会被刚结束的收束再次拦截/吃治疗修正,语义变成无限递归)
  if (hp > 0) ctx.session.attributes.applyHeal(ctx.targetId, hp);
  if (mana > 0) ctx.session.attributes.restoreMana(ctx.targetId, mana);
  if (armor > 0) ctx.session.attributes.restoreArmor(ctx.targetId, armor);
  const player = ctx.session.players.get(ctx.targetId)?.player;
  if (player?.isValid) {
    ctx.session.hud.toast(player, `§b收束结束: 返还 ${Math.round(hp)} 生命 / ${Math.round(mana)} 魔力 / ${Math.round(armor)} 护甲`);
  }
}

statusRegistry.register({
  id: STATUS_RESTRAINT,
  displayName: "收束",
  kind: "debuff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 160, // 8 秒
  clearable: true,
  flags: { healIntercept: true, regenIntercept: true },
  onExpire: returnRestraintRecords,
  // 被净化/死亡清状态时同样返还(效果提前结束;死亡场景随后重生覆盖,无副作用)
  onRemoved: returnRestraintRecords,
});

// ── 日蚀 / 月冕(固有Ⅱ施加;强化光束按持有项叠层) ──────────────────

statusRegistry.register({
  id: STATUS_SOLAR_ECLIPSE,
  displayName: "日蚀",
  kind: "buff",
  maxStacks: 2,
  stackMode: "both", // 叠层并刷新持续时间
  durationTicks: 160, // 8 秒
  clearable: true,
  excludes: [STATUS_LUNAR_CROWN],
});

statusRegistry.register({
  id: STATUS_LUNAR_CROWN,
  displayName: "月冕",
  kind: "buff",
  maxStacks: 2,
  stackMode: "both",
  durationTicks: 160, // 8 秒
  clearable: true,
  excludes: [STATUS_SOLAR_ECLIPSE],
});

// ── 境界面强化(固有Ⅱ:下次重击进阶,武器侧消费) ──────────────────

statusRegistry.register({
  id: STATUS_INTERFACE_SURGE,
  displayName: "境界面强化",
  kind: "buff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: -1, // 持续至下次重击(武器重击消费后移除)
  clearable: true,
});

// ── 变动率(时光种子命中施加;到期做回溯判定) ──────────────────────

statusRegistry.register({
  id: STATUS_MUTATION_RATE,
  displayName: "变动率",
  kind: "buff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 60, // 3 秒
  clearable: true,
  onExpire(ctx) {
    resolveRewind(ctx.session, ctx.targetId);
  },
  // 被清除/死亡:判定作废,清掉待判定上下文(不触发传送与恢复)
  onRemoved(ctx) {
    const key = rewindKey(ctx.session, ctx.targetId);
    pendingRewinds.delete(key);
  },
});

// ── 信标庇护(寻光信标部署奖励:2 秒 100% 减伤,隐藏状态) ────────────

statusRegistry.register({
  id: STATUS_BEACON_AEGIS,
  displayName: "§7信标庇护",
  kind: "buff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 40, // 2 秒
  clearable: true,
  modifiers: { damageReductionMul: 0 },
});
