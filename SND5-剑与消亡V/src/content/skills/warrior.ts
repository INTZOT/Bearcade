// ============================================================
// 战士技能(内容设计 PDF 第 7-8 页)
// - 固有Ⅰ 突进: 13s CD / 魔力 0~5 / 突进 3 格 + 半径 5 格劈砍
//   20 点电伤,吸取总伤害 10% 回血;未命中退还 5 魔力;
//   潜行施放不突进(castSneaking 变体,技能内不写 if)。
// - 固有Ⅱ 球状闪电: 18s CD / 魔力 20 / 堆叠 2;爆炸半径 5 格
//   5~30 点电伤(随距离衰减)+ 零火。
//   占位:雪球实体承载,3 秒后爆炸;提前命中方块/玩家就地爆炸
//   (原版雪球撞墙即消失,按落地爆炸处理)。
// - 固有Ⅲ 雷魂(被动): 击杀缓慢回 10 血 + 电流涌动
//   (已有迸发则刷新迸发,不降阶)。
// ============================================================
import { skillRegistry } from "../../framework";
import type { MatchSession, PlayerState } from "../../framework";
import type { Vec3 } from "../../../../shared/minigame-core/types";
import {
  STATUS_CURRENT_BURST,
  STATUS_CURRENT_SURGE,
  STATUS_ZERO_FIRE,
} from "../statuses/warrior";

// ── 固有Ⅰ 突进 ─────────────────────────────────────────────────
const LEAP_MANA = 5;
const LEAP_COOLDOWN_TICKS = 260; // 13 秒
const LEAP_DASH_RANGE = 3;
const LEAP_DAMAGE = 20;
const LEAP_RADIUS = 5;
const LIFESTEAL_RATIO = 0.1;

function enemyOf(session: MatchSession, casterId: string) {
  const casterTeam = session.teams.getTeam(casterId);
  return (state: PlayerState): boolean =>
    state.id !== casterId && session.teams.getTeam(state.id) !== casterTeam;
}

/** 突进终点劈砍:半径 5 格 20 点电伤 + 吸血 10%(未命中退 5 魔力) */
function leapCleave(session: MatchSession, casterId: string, direction: { x: number; y: number; z: number }) {
  const caster = session.players.get(casterId);
  if (!caster?.player.isValid) return false;
  const location = caster.player.location;
  const outcome = session.primitives.dealSectorDamage(
    casterId,
    { x: location.x, y: location.y, z: location.z },
    direction,
    LEAP_RADIUS,
    180,
    { hp: LEAP_DAMAGE, element: "electric", tags: ["skill", "sweep"] },
    enemyOf(session, casterId),
  );
  // 落点指示(纯表现):劈砍扇形闪现约 0.3 秒,仅施法者可见
  session.primitives.showIndicator(
    casterId,
    {
      kind: "sector",
      origin: { x: location.x, y: location.y, z: location.z },
      direction: { x: direction.x, z: direction.z },
      radius: LEAP_RADIUS,
      angleDegrees: 180,
    },
    { durationTicks: 6 },
  );
  if (outcome.hits === 0) {
    return { ok: true, refundMana: LEAP_MANA };
  }
  // 消耗 5 魔力吸取本次总伤害的 10%(预扣已在校验阶段完成)
  session.combat.heal(casterId, casterId, {
    amount: Math.max(1, Math.round(outcome.damage * LIFESTEAL_RATIO)),
  });
  return true;
}

skillRegistry.register({
  id: "snd5:warrior_leap_slash",
  displayName: "突进",
  slot: "innate_1",
  manaCost: LEAP_MANA,
  cooldown: LEAP_COOLDOWN_TICKS,
  maxStacks: 1,
  castMode: "instant",
  failureHint: { no_mana: "魔力不足(突进吸血需 5 魔力)" },

  cast(ctx) {
    // 向前突进 3 格(水平方向,不受俯仰影响)
    ctx.primitives.dash(
      ctx.casterId,
      { x: ctx.direction.x, y: 0, z: ctx.direction.z },
      LEAP_DASH_RANGE,
    );
    // 抵达突进终点后劈砍(以实时视角为准)
    return leapCleave(ctx.session, ctx.casterId, ctx.player.getViewDirection());
  },

  // 潜行施放:不突进,原地劈砍
  castSneaking(ctx) {
    return leapCleave(ctx.session, ctx.casterId, ctx.direction);
  },
});

// ── 固有Ⅱ 球状闪电 ─────────────────────────────────────────────
const ORB_MANA = 20;
const ORB_COOLDOWN_TICKS = 360; // 18 秒
const ORB_MAX_STACKS = 2;
const ORB_FUSE_TICKS = 60; // 扔出 3 秒后爆炸
const ORB_RADIUS = 5;
const ORB_DAMAGE_CENTER = 30;
const ORB_DAMAGE_EDGE = 5;
/** 雪球占位投射物的飞行速度(格/tick) */
const ORB_SPEED_BLOCKS_PER_TICK = 0.9;

/** 爆炸:半径 5 格敌方 5~30 点电伤(随距离衰减)+ 零火 */
function explodeOrb(session: MatchSession, ownerId: string, center: Vec3): void {
  for (const state of session.primitives.playersInRadius(center, ORB_RADIUS)) {
    if (session.teams.getTeam(state.id) === session.teams.getTeam(ownerId)) continue;
    const dx = state.player.location.x - center.x;
    const dy = state.player.location.y - center.y;
    const dz = state.player.location.z - center.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const falloff = Math.max(0, 1 - distance / ORB_RADIUS);
    const damage = Math.round(ORB_DAMAGE_EDGE + (ORB_DAMAGE_CENTER - ORB_DAMAGE_EDGE) * falloff);
    session.combat.dealDamage(ownerId, state.id, {
      hp: damage,
      element: "electric",
      tags: ["skill", "projectile"],
    });
    session.status.apply(state.id, STATUS_ZERO_FIRE, ownerId);
  }
  try {
    session.dimension.playSound("random.explode", center);
  } catch {
    // 音效失败不影响结算
  }
}

skillRegistry.register({
  id: "snd5:warrior_ball_lightning",
  displayName: "球状闪电",
  slot: "innate_2",
  manaCost: ORB_MANA,
  cooldown: ORB_COOLDOWN_TICKS,
  maxStacks: ORB_MAX_STACKS,
  castMode: "instant",
  failureHint: { no_mana: `魔力不足(${ORB_MANA})` },

  cast(ctx) {
    const head = ctx.player.getHeadLocation();
    const entity = ctx.primitives.spawnProjectile(
      "minecraft:wind_charge_projectile", // 占位:原版雪球承载,后续替换自定义实体
      { x: head.x + ctx.direction.x, y: head.y + ctx.direction.y, z: head.z + ctx.direction.z },
      ctx.direction,
      {
        ownerId: ctx.casterId,
        speedBlocksPerTick: ORB_SPEED_BLOCKS_PER_TICK,
        lifetimeTicks: ORB_FUSE_TICKS,
        onHitEntity: (targetId, instance) => {
          const target = ctx.primitives.getEntity(targetId);
          if (target?.isValid) explodeOrb(ctx.session, ctx.casterId, target.location);
          else if (instance.entity.isValid) explodeOrb(ctx.session, ctx.casterId, instance.entity.location);
        },
        onHitBlock: (location) => explodeOrb(ctx.session, ctx.casterId, location),
        onExpire: (instance) => {
          if (instance.entity.isValid) {
            explodeOrb(ctx.session, ctx.casterId, instance.entity.location);
          }
        },
      },
    );
    return entity ? true : false;
  },
});

// ── 固有Ⅲ 雷魂(被动) ───────────────────────────────────────────
const PASSIVE_MANA_COST = 10;
/** 缓慢回复:每 4 tick(0.2 秒)回 1 点 × 10 次 = 2 秒共 10 点 */
const PASSIVE_HEAL_TICKS = 10;
const PASSIVE_HEAL_INTERVAL = 4;
const PASSIVE_HEAL_AMOUNT = 1;

skillRegistry.register({
  id: "snd5:warrior_storm_passive",
  displayName: "雷魂(被动)",
  slot: "passive",
  manaCost: PASSIVE_MANA_COST,
  cooldown: 0,
  listen: ["entity.killed"],

  onEvent(event, ctx) {
    const payload = event.payload as { killerId?: string; victimId?: string };
    if (payload.killerId !== ctx.playerId || !payload.victimId) return;
    // 击杀同队不触发(事件层面通常不会发生,防御性判断)
    if (ctx.session.teams.getTeam(payload.victimId) === ctx.session.teams.getTeam(ctx.playerId)) {
      return;
    }
    // 魔力消耗 10(不足也触发 —— 占位宽容,便于测试;正式数值可收紧)
    ctx.session.attributes.spendMana(
      ctx.playerId,
      Math.min(PASSIVE_MANA_COST, ctx.session.attributes.getMana(ctx.playerId)),
    );
    // 缓慢回复 10 点(走治疗管线,受重伤等修正影响)
    ctx.primitives.scheduleRepeating(PASSIVE_HEAL_INTERVAL, PASSIVE_HEAL_TICKS, () => {
      ctx.primitives.heal(ctx.playerId, PASSIVE_HEAL_AMOUNT);
    });
    // 电流涌动;已有迸发则刷新迸发(不降阶)
    if (ctx.session.status.has(ctx.playerId, STATUS_CURRENT_BURST)) {
      ctx.session.status.apply(ctx.playerId, STATUS_CURRENT_BURST, ctx.playerId);
    } else {
      ctx.session.status.apply(ctx.playerId, STATUS_CURRENT_SURGE, ctx.playerId);
    }
  },
});
