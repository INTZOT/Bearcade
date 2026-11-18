// ============================================================
// 控制相关状态(内容设计 PDF 第 15-17 页)
// - 浊露: 24s 叠层刷新;每 5 秒 2 点水伤;4/8/16/32 层梯度惩罚
//   (移速 -8% / 受伤 +2 / 造成伤害 -5 / 每 5 秒主动技 CD +3 秒);
//   32 层上限后不可继续叠加与刷新(freezeAtMax)。
// - 魔魇降临: 30s 不可重新施加;每受 1 点伤害 +1 层;2 秒不增长
//   每秒 -4 层;50 层清空并掉落固体灵魂。
// - 固体灵魂: 盔甲架占位创生物;2 秒保护期后仅原主可拾取(走近);
//   朝 10 格内最近魔瘴之泉每秒 3 格移动;8 秒未拾回 → 原主 20 点
//   真实伤害 + 魔魇噬魂。
// - 魔魇噬魂: 12s 不可清除;所有技能进入冷却(与效果等长);
//   每秒 2 点真实伤害;移速 -20%;受伤 +5。
// ============================================================
import { statusRegistry } from "../../framework";
import type {
  MatchSession,
  StatusModifiers,
  StatusContext,
  StatusAfterDamageContext,
} from "../../framework";

export const STATUS_TURBID_DEW = "snd5:turbid_dew";
export const STATUS_NIGHTMARE_DESCENT = "snd5:nightmare_descent";
export const STATUS_NIGHTMARE_DEVOUR = "snd5:nightmare_devour";

/** 创生物语义类型(skills/controller.ts 与本文件共用) */
export const SPRING_SUMMON_KIND = "snd5:miasma_spring";
export const SOUL_SUMMON_KIND = "snd5:solid_soul";

/** 浊露梯度惩罚层数阈值 */
const DEW_SLOW_STACKS = 4;
const DEW_VULN_STACKS = 8;
const DEW_WEAK_STACKS = 16;
const DEW_CD_STACKS = 32;
/** 浊露每 5 秒 2 点水元素伤害 */
const DEW_DOT_DAMAGE = 2;
const DEW_DOT_INTERVAL_TICKS = 100;
/** 32 层:每 5 秒所有主动技能 CD +3 秒 */
const DEW_CD_EXTEND_TICKS = 60;

/** 魔魇降临衰减:2 秒不增长 → 每秒 -4 层 */
const DESCENT_DECAY_DELAY_TICKS = 40;
const DESCENT_DECAY_PER_SECOND = 4;
const DESCENT_MAX_STACKS = 50;

/** 魔魇噬魂:每秒 2 点真实伤害 */
const DEVOUR_DOT_DAMAGE = 2;
/** 魔魇噬魂持续 12 秒;所有技能进入冷却取同时长(设计未给具体数值) */
const DEVOUR_DURATION_TICKS = 240;

// ── 冷却操作(主动技 = innate_1/2 + 秘典;重击无 CD 不参与延长) ────

/** 延长当前在冷却中的主动技能 CD(浊露 32 层) */
function extendActiveSkillCooldowns(session: MatchSession, playerId: string, extendTicks: number): void {
  for (const [slot, skillId] of Object.entries(session.skills.getLoadout(playerId))) {
    if (slot === "passive" || slot === "weapon_heavy") continue;
    const remaining = session.skills.getCooldownRemaining(playerId, skillId);
    if (remaining <= 0) continue;
    session.skills.applyCooldown(playerId, skillId, remaining + extendTicks);
  }
}

/** 强制全部技能进入冷却(魔魇噬魂获得时;含重击) */
function forceAllSkillCooldowns(session: MatchSession, playerId: string, ticks: number): void {
  for (const [slot, skillId] of Object.entries(session.skills.getLoadout(playerId))) {
    if (slot === "passive") continue;
    session.skills.applyCooldown(playerId, skillId, ticks);
  }
}

// ── 固体灵魂(盔甲架占位创生物) ─────────────────────────────────

/** 拾取半径(格)与保护期 */
const SOUL_PICKUP_RADIUS_SQ = 1.5 * 1.5;
const SOUL_PROTECT_TICKS = 40; // 2 秒后才仅能被原主拾取
const SOUL_LIFETIME_TICKS = 160; // 8 秒未拾回 → 摧毁 + 惩罚
/** 朝魔瘴之泉的移动:每秒 3 格 = 每 5 tick 0.75 格 */
const SOUL_SEEK_RADIUS = 10;
const SOUL_SEEK_STEP = 0.75;
/** 未拾回惩罚:20 点真实伤害 + 魔魇噬魂 */
const SOUL_MISS_TRUE_DAMAGE = 20;

/** 场上是否存在原主的固体灵魂(每角色同时最多 1 个) */
function hasSolidSoul(session: MatchSession, victimId: string): boolean {
  return session.summons
    .getByKind(SOUL_SUMMON_KIND)
    .some((instance) => instance.ownerId === victimId);
}

/** 10 格内最近的魔瘴之泉位置(无则 undefined) */
function nearestSpringLocation(session: MatchSession, from: { x: number; y: number; z: number }) {
  let best: { x: number; y: number; z: number } | undefined;
  let bestDist = SOUL_SEEK_RADIUS;
  for (const instance of session.summons.getByKind(SPRING_SUMMON_KIND)) {
    if (!instance.entity.isValid) continue;
    const loc = instance.entity.location;
    const dist = Math.hypot(loc.x - from.x, loc.y - from.y, loc.z - from.z);
    if (dist < bestDist) {
      bestDist = dist;
      best = { x: loc.x, y: loc.y, z: loc.z };
    }
  }
  return best;
}

/** 掉落固体灵魂(魔魇降临 50 层;原地 = 携带者当前位置) */
function dropSolidSoul(session: MatchSession, victimId: string): void {
  const owner = session.players.get(victimId);
  if (!owner?.alive || !owner.player.isValid) return;
  if (hasSolidSoul(session, victimId)) return;
  const location = owner.player.location;
  const soul = session.primitives.spawnSummon("minecraft:armor_stand", location, {
    ownerId: victimId,
    kind: SOUL_SUMMON_KIND,
    lifetimeTicks: SOUL_LIFETIME_TICKS,
    tickIntervalTicks: 5,
    invulnerable: true,
    onTick: (entity, instance) => {
      if (!owner.player.isValid) return;
      // 2 秒保护期后:原主走近即拾取(移除实体,到期惩罚随之取消)
      const age = session.nowTick() - instance.spawnTick;
      const dx = owner.player.location.x - entity.location.x;
      const dy = owner.player.location.y - entity.location.y;
      const dz = owner.player.location.z - entity.location.z;
      if (age >= SOUL_PROTECT_TICKS && dx * dx + dy * dy + dz * dz <= SOUL_PICKUP_RADIUS_SQ) {
        session.hud.toast(owner.player, "§b你拾回了固体灵魂");
        try {
          entity.remove();
        } catch {
          // 已被移除
        }
        return;
      }
      // 场上存在魔瘴之泉:朝 10 格内最近者每秒 3 格移动
      const spring = nearestSpringLocation(session, entity.location);
      if (!spring) return;
      const sx = spring.x - entity.location.x;
      const sy = spring.y - entity.location.y;
      const sz = spring.z - entity.location.z;
      const len = Math.max(0.001, Math.hypot(sx, sy, sz));
      const step = Math.min(SOUL_SEEK_STEP, len);
      entity.teleport({
        x: entity.location.x + (sx / len) * step,
        y: entity.location.y + (sy / len) * step,
        z: entity.location.z + (sz / len) * step,
      });
    },
    onExpire: () => {
      // 8 秒未被原主拾回:摧毁,原主受 20 点真实伤害 + 魔魇噬魂
      if (!owner.alive) return;
      session.combat.dealDamage(undefined, victimId, {
        trueDamage: SOUL_MISS_TRUE_DAMAGE,
        element: "physical",
        tags: ["skill"],
      });
      session.status.apply(victimId, STATUS_NIGHTMARE_DEVOUR, undefined);
    },
  });
  if (soul) {
    try {
      soul.nameTag = "§5固体灵魂";
    } catch {
      // 占位表现失败不影响结算
    }
  }
}

// ── 浊露(负面;叠层刷新,32 层冻结) ─────────────────────────────

statusRegistry.register({
  id: STATUS_TURBID_DEW,
  displayName: "浊露",
  kind: "debuff",
  maxStacks: 32,
  stackMode: "both",
  durationTicks: 480, // 24 秒
  clearable: true,
  freezeAtMax: true,
  tickIntervalTicks: DEW_DOT_INTERVAL_TICKS, // 每 5 秒一拍
  modifiers: (instance): StatusModifiers | undefined => {
    const mods: StatusModifiers = {};
    if (instance.stacks >= DEW_SLOW_STACKS) mods.moveSpeedMul = 0.92;
    if (instance.stacks >= DEW_VULN_STACKS) mods.damageTakenFlat = 2;
    if (instance.stacks >= DEW_WEAK_STACKS) mods.damageDealtFlat = -5;
    return Object.keys(mods).length > 0 ? mods : undefined;
  },
  onTick(ctx: StatusContext) {
    // 每 5 秒 2 点水元素伤害(带 dot 标签:不触发吸血,DOT 致死不可被拦截)
    ctx.session.combat.dealDamage(ctx.instance.sourceId, ctx.targetId, {
      hp: DEW_DOT_DAMAGE,
      element: "water",
      tags: ["dot"],
    });
    // 4 层及以上:移速降低 8%(原版缓慢无 8% 档位,以缓慢 I 近似表现)
    if (ctx.instance.stacks >= DEW_SLOW_STACKS) {
      ctx.session.primitives.applyEffect(ctx.targetId, "minecraft:slowness", DEW_DOT_INTERVAL_TICKS, {
        amplifier: 0,
      });
    }
    // 32 层及以上:每 5 秒所有主动技能 CD +3 秒
    if (ctx.instance.stacks >= DEW_CD_STACKS) {
      extendActiveSkillCooldowns(ctx.session, ctx.targetId, DEW_CD_EXTEND_TICKS);
    }
  },
});

// ── 魔魇降临(负面;受伤叠层,50 层掉固体灵魂) ────────────────────

statusRegistry.register({
  id: STATUS_NIGHTMARE_DESCENT,
  displayName: "魔魇降临",
  kind: "debuff",
  maxStacks: DESCENT_MAX_STACKS,
  stackMode: "stack",
  durationTicks: 600, // 30 秒
  clearable: true,
  reapplyable: false, // 持续期间不可重新施加(吟唱「尝试施加」即跳过已携带者)
  tickIntervalTicks: 20, // 每秒检查衰减
  onApply(ctx: StatusContext) {
    ctx.instance.payload.lastGrowthTick = ctx.session.nowTick();
  },
  onAfterDamaged(ctx: StatusAfterDamageContext) {
    // 每受到 1 点伤害(含护甲/真实伤害分量)提高 1 层
    const total =
      ctx.damage.hp + ctx.damage.armor + ctx.damage.tempArmor + ctx.damage.trueDamage;
    if (total <= 0) return;
    const next = Math.min(DESCENT_MAX_STACKS, ctx.instance.stacks + total);
    ctx.instance.payload.lastGrowthTick = ctx.session.nowTick();
    if (next === ctx.instance.stacks) return;
    ctx.instance.stacks = next;
    ctx.session.bus.emit("status.stacksChanged", {
      targetId: ctx.targetId,
      statusId: ctx.statusId,
      stacks: next,
    });
    if (next >= DESCENT_MAX_STACKS) {
      // 达到 50 层:清空所有层数并掉落一颗自己的固体灵魂在原地
      ctx.removeSelf();
      dropSolidSoul(ctx.session, ctx.targetId);
    }
  },
  onTick(ctx: StatusContext) {
    // 2 秒内没再增长:以每秒 4 层的速度快速消除
    const lastGrowth =
      (ctx.instance.payload.lastGrowthTick as number | undefined) ?? ctx.session.nowTick();
    if (ctx.session.nowTick() - lastGrowth < DESCENT_DECAY_DELAY_TICKS) return;
    const next = ctx.instance.stacks - DESCENT_DECAY_PER_SECOND;
    if (next <= 0) {
      ctx.removeSelf();
      return;
    }
    ctx.instance.stacks = next;
    ctx.session.bus.emit("status.stacksChanged", {
      targetId: ctx.targetId,
      statusId: ctx.statusId,
      stacks: next,
    });
  },
});

// ── 魔魇噬魂(负面;不可清除) ────────────────────────────────────

statusRegistry.register({
  id: STATUS_NIGHTMARE_DEVOUR,
  displayName: "魔魇噬魂",
  kind: "debuff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: DEVOUR_DURATION_TICKS, // 12 秒
  clearable: false,
  tickIntervalTicks: 20, // 每秒一拍
  modifiers: {
    damageTakenFlat: 5, // 受到的伤害增加 5 点
    moveSpeedMul: 0.8, // 移动速度减少 20%
  },
  onApply(ctx: StatusContext) {
    // 获得本效果时:使携带者的所有技能进入冷却时间(取与效果等长 12 秒)
    forceAllSkillCooldowns(ctx.session, ctx.targetId, DEVOUR_DURATION_TICKS);
    ctx.session.primitives.applyEffect(ctx.targetId, "minecraft:slowness", DEVOUR_DURATION_TICKS, {
      amplifier: 1,
    });
  },
  onTick(ctx: StatusContext) {
    // 每秒 2 点真实伤害(DOT 致死不走拦截,与架构约定一致)
    ctx.session.combat.dealDamage(undefined, ctx.targetId, {
      trueDamage: DEVOUR_DOT_DAMAGE,
      element: "physical",
      tags: ["dot"],
    });
  },
});
