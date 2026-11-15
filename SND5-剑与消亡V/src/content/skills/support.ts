// ============================================================
// 增益技能(内容设计 PDF 第 11-14 页)
// - weapon_heavy 重击(伪技能,spyglass 蓄力 0.8s):视准心圈内敌方
//   12 点水伤 + 圈内友方清流;潜行蓄力 → 晨露对光的独白(半径+3、
//   正面层数加伤均摊、负面层数回魔 12s 一次、无法施加清流);
//   两个变体都统计友方命中数驱动固有Ⅲ。
// - 固有Ⅰ 涤雨:扣 25% 当前生命 + 自身洁雨;视准心半径 8 内友方
//   (除自己)刷新主动技 CD + 按人数档位 30/23/15 临时护甲。
// - 固有Ⅱ 水仙庇护:前摇 1.2s;自身+圈内敌方 6 点水伤,圈内友方
//   (含自己)水仙初临,低血(<30% 最大生命)额外尝试清流。
// - 固有Ⅲ 水仙之约(被动):触发点在重击结算内,此处仅注册供装载。
// ============================================================
import { skillRegistry } from "../../framework";
import type { CastContext, CastResult, MatchSession, PlayerState } from "../../framework";
import type { Vec3 } from "../../../../shared/minigame-core/types";
import {
  STATUS_CLEAR_STREAM,
  STATUS_NARCISSUS_ARRIVAL,
  STATUS_PURE_RAIN,
} from "../statuses/support";

// ── 公共工具 ─────────────────────────────────────────────────

/**
 * 视准心地面点:射线命中方块取顶面中心,未命中按水平投影 max 格。
 * 指示器与 AoE 判定共用同一点,保证「指示器即判定区」。
 */
function viewGroundCenter(ctx: CastContext, maxDistance: number): Vec3 {
  const player = ctx.player;
  const head = player.getHeadLocation();
  const view = player.getViewDirection();
  const hit = ctx.primitives.raycastBlock(
    { x: head.x, y: head.y, z: head.z },
    view,
    maxDistance,
  );
  if (hit) {
    return { x: hit.x + 0.5, y: hit.y + 1, z: hit.z + 0.5 };
  }
  const horizontal = Math.hypot(view.x, view.z);
  const dx = horizontal > 1e-4 ? view.x / horizontal : 0;
  const dz = horizontal > 1e-4 ? view.z / horizontal : 1;
  return {
    x: player.location.x + dx * maxDistance,
    y: player.location.y,
    z: player.location.z + dz * maxDistance,
  };
}

/** 正面/负面效果的总层数(晨露加伤与回魔依据) */
function sumStacksByKind(
  session: MatchSession,
  playerId: string,
  kind: "buff" | "debuff",
): number {
  let total = 0;
  for (const instance of session.status.getAll(playerId)) {
    if (session.content.statuses.get(instance.id)?.kind === kind) {
      total += instance.stacks;
    }
  }
  return total;
}

// ── weapon_heavy 重击(spyglass 蓄力伪技能) ────────────────────

const HEAVY_CENTER_MAX = 5; // 指示器圆心最远 5 格
const HEAVY_CHARGE_TICKS = 15; // 蓄满 0.75~1.0s(会话 5t 网格量化)
const HEAVY_CHARGE_INTERVAL = 5; // 蓄力按真实时间累积(见 SkillSystem.tickCharge)
const HEAVY_RADIUS = 2;
const HEAVY_DEW_RADIUS = 5; // 晨露:圆形指示器半径提高 3 格
const HEAVY_DAMAGE = 12;
const HEAVY_DEW_DAMAGE_PER_LAYER = 5;
/** 晨露回魔 12 秒限频(借被动冷却表存合成键) */
const HEAVY_DEW_MANA_KEY = "snd5:support:heavy_dew_mana";
const HEAVY_DEW_MANA_CD_TICKS = 240;

/** 固有Ⅲ 触发:重击同时命中 ≥3 名友方 → 自身水仙初临(5 秒内置冷却) */
const PASSIVE_ID = "snd5:gain_narcissus_passive";
const PASSIVE_COOLDOWN_TICKS = 100;
const PASSIVE_ALLY_THRESHOLD = 3;

function triggerNarcissusPassive(session: MatchSession, casterId: string, alliesHit: number): void {
  if (alliesHit < PASSIVE_ALLY_THRESHOLD) return;
  if (!session.skills.isPassiveReady(casterId, PASSIVE_ID)) return;
  session.skills.startPassiveCooldown(casterId, PASSIVE_ID, PASSIVE_COOLDOWN_TICKS);
  session.status.apply(casterId, STATUS_NARCISSUS_ARRIVAL, casterId);
}

/** 重击结算;dew = 晨露对光的独白(潜行蓄力) */
function heavyAttack(ctx: CastContext, dew: boolean): CastResult {
  const caster = ctx.session.players.get(ctx.casterId);
  if (!caster?.player.isValid) return false;
  const center = viewGroundCenter(ctx, HEAVY_CENTER_MAX);
  const radius = dew ? HEAVY_DEW_RADIUS : HEAVY_RADIUS;

  // 圈内友方(普通重击施加清流;两变体都计入固有Ⅲ命中数)
  const myTeam = ctx.session.teams.getTeam(ctx.casterId);
  const allies = ctx.session.primitives
    .playersInRadius(center, radius)
    .filter(
      (state: PlayerState): boolean =>
        state.id !== ctx.casterId && ctx.session.teams.getTeam(state.id) === myTeam,
    );

  // 敌方伤害:晨露按正面总层数加伤后被命中者均摊
  let total = HEAVY_DAMAGE;
  if (dew) {
    total += sumStacksByKind(ctx.session, ctx.casterId, "buff") * HEAVY_DEW_DAMAGE_PER_LAYER;
  }
  const enemies = ctx.session.primitives.enemyPlayersInRadius(ctx.casterId, center, radius);
  if (enemies.length > 0) {
    const perEnemy = Math.max(1, Math.round(total / enemies.length));
    for (const enemy of enemies) {
      ctx.primitives.dealDamage(ctx.casterId, enemy.id, {
        hp: perEnemy,
        element: "water",
        tags: ["weapon", "melee", "sweep"],
      });
    }
  }
  if (!dew) {
    for (const ally of allies) {
      ctx.primitives.applyStatus(ally.id, STATUS_CLEAR_STREAM, ctx.casterId);
    }
  } else {
    // 晨露:负面总层数 × 1 回魔,12 秒内仅一次
    if (ctx.session.skills.isPassiveReady(ctx.casterId, HEAVY_DEW_MANA_KEY)) {
      ctx.session.skills.startPassiveCooldown(ctx.casterId, HEAVY_DEW_MANA_KEY, HEAVY_DEW_MANA_CD_TICKS);
      const layers = sumStacksByKind(ctx.session, ctx.casterId, "debuff");
      if (layers > 0) ctx.primitives.restoreMana(ctx.casterId, layers);
    }
  }

  // 落点闪烁(蓄力指示器已随施法回收,此处为命中反馈)
  ctx.primitives.showIndicator(
    ctx.casterId,
    { kind: "circle", center, radius },
    { durationTicks: 6 },
  );
  triggerNarcissusPassive(ctx.session, ctx.casterId, allies.length);
  return true;
}

skillRegistry.register({
  id: "snd5:gain_heavy_attack",
  displayName: "水仙之梦·重击",
  slot: "weapon_heavy",
  cooldown: 0,
  castMode: "charge",
  // 蓄满才施放:提前松手继续蓄(minTicks = maxTicks)
  chargeConfig: {
    minTicks: HEAVY_CHARGE_TICKS,
    maxTicks: HEAVY_CHARGE_TICKS,
    tickIntervalTicks: HEAVY_CHARGE_INTERVAL,
  },
  // 蓄力期间指示器跟随准星;潜行(晨露)半径 +3
  indicator(ctx) {
    return {
      kind: "circle",
      center: viewGroundCenter(ctx, HEAVY_CENTER_MAX),
      radius: ctx.isSneaking ? HEAVY_DEW_RADIUS : HEAVY_RADIUS,
    };
  },
  cast(ctx) {
    return heavyAttack(ctx, false);
  },
  castSneaking(ctx) {
    return heavyAttack(ctx, true);
  },
});

// ── 固有Ⅰ 涤雨(fishing_rod,右键即放) ─────────────────────────

const REFRESH_MANA = 25;
const REFRESH_COOLDOWN_TICKS = 380; // 19 秒
const REFRESH_CENTER_MAX = 8; // 指示器中心最远 8 格
const REFRESH_RADIUS = 8;
const REFRESH_HP_COST_RATIO = 0.25;
const REFRESH_ARMOR_TICKS = 200; // 10 秒
/** 临时护甲档位:友方 1-2 名 → 30;3-4 名 → 23;5+ 名 → 15 */
function refreshArmorByAllies(allies: number): number {
  if (allies >= 5) return 15;
  if (allies >= 3) return 23;
  return 30;
}

skillRegistry.register({
  id: "snd5:gain_refresh",
  displayName: "涤雨",
  slot: "innate_1",
  manaCost: REFRESH_MANA,
  cooldown: REFRESH_COOLDOWN_TICKS,
  maxStacks: 1,
  castMode: "instant",
  failureHint: { no_mana: `魔力不足(${REFRESH_MANA})` },

  cast(ctx) {
    const caster = ctx.session.players.get(ctx.casterId);
    if (!caster?.player.isValid) return false;
    // 扣除自身 25% 当前生命(真实伤害,可致死)
    const hp = ctx.session.attributes.getHp(ctx.casterId);
    ctx.primitives.consumeHp(ctx.casterId, Math.max(1, Math.ceil(hp * REFRESH_HP_COST_RATIO)));
    if (ctx.session.isDead(ctx.casterId)) return true;

    // 自身施加洁雨
    ctx.primitives.applyStatus(ctx.casterId, STATUS_PURE_RAIN, ctx.casterId);

    // 视准心地面中心半径 8:友方(除自己)刷新主动技 CD + 档位临时护甲
    const center = viewGroundCenter(ctx, REFRESH_CENTER_MAX);
    const allies = ctx.session.primitives.allyPlayersInRadius(ctx.casterId, center, REFRESH_RADIUS);
    const armor = refreshArmorByAllies(allies.length);
    for (const ally of allies) {
      ctx.primitives.refreshCooldowns(ally.id, ["innate_1", "innate_2"]);
      ctx.primitives.addTempArmor(ally.id, armor, REFRESH_ARMOR_TICKS);
    }

    // 落点指示(team 可见,队友可以看到刷新/护甲范围)
    ctx.primitives.showIndicator(
      ctx.casterId,
      { kind: "circle", center, radius: REFRESH_RADIUS },
      { visibility: "team", durationTicks: 6 },
    );
    return true;
  },
});

// ── 固有Ⅱ 水仙庇护(shield,按住 1.2s 前摇) ────────────────────

const BLESSING_MANA = 35;
const BLESSING_COOLDOWN_TICKS = 500; // 25 秒
const BLESSING_WINDUP_TICKS = 24; // 1.2 秒
const BLESSING_RADIUS = 7;
const BLESSING_DAMAGE = 6;
const LOW_HP_RATIO = 0.3;

skillRegistry.register({
  id: "snd5:gain_blessing",
  displayName: "水仙庇护",
  slot: "innate_2",
  manaCost: BLESSING_MANA,
  cooldown: BLESSING_COOLDOWN_TICKS,
  maxStacks: 1,
  castMode: "windup",
  windupTicks: BLESSING_WINDUP_TICKS,
  // 前摇期间指示器:以自身为中心半径 7(team 可见,跟随移动)
  indicator(ctx) {
    const loc = ctx.player.location;
    return {
      kind: "circle",
      center: { x: loc.x, y: loc.y, z: loc.z },
      radius: BLESSING_RADIUS,
    };
  },
  indicatorOptions: { visibility: "team" },

  cast(ctx) {
    const caster = ctx.session.players.get(ctx.casterId);
    if (!caster?.player.isValid) return false;
    const loc = caster.player.location;
    const center: Vec3 = { x: loc.x, y: loc.y, z: loc.z };
    const myTeam = ctx.session.teams.getTeam(ctx.casterId);
    const enemyFilter = (state: PlayerState): boolean =>
      state.id !== ctx.casterId && ctx.session.teams.getTeam(state.id) !== myTeam;

    // 自身及半径 7 格内的所有敌方角色受到 6 点水元素伤害
    ctx.primitives.dealDamage(ctx.casterId, ctx.casterId, {
      hp: BLESSING_DAMAGE,
      element: "water",
      tags: ["skill"],
    });
    ctx.primitives.dealAreaDamage(ctx.casterId, center, BLESSING_RADIUS, {
      hp: BLESSING_DAMAGE,
      element: "water",
      tags: ["skill"],
    }, enemyFilter);

    // 半径 7 内友方(含自己)施加水仙初临;低血(<30% 最大生命)额外尝试清流
    const self = ctx.session.players.get(ctx.casterId);
    const candidates = self
      ? [self, ...ctx.session.primitives.allyPlayersInRadius(ctx.casterId, center, BLESSING_RADIUS)]
      : ctx.session.primitives.allyPlayersInRadius(ctx.casterId, center, BLESSING_RADIUS);
    for (const ally of candidates) {
      ctx.primitives.applyStatus(ally.id, STATUS_NARCISSUS_ARRIVAL, ctx.casterId);
      const attribute = ctx.session.attributes.get(ally.id);
      if (attribute && attribute.current.hp / attribute.base.hp < LOW_HP_RATIO) {
        ctx.primitives.applyStatus(ally.id, STATUS_CLEAR_STREAM, ctx.casterId);
      }
    }
    return true;
  },
});

// ── 固有Ⅲ 水仙之约(被动) ─────────────────────────────────────
// 触发点在重击结算(triggerNarcissusPassive):无 listen 事件,
// 注册仅为职业装载与 HUD 展示。
skillRegistry.register({
  id: PASSIVE_ID,
  displayName: "水仙之约(被动)",
  slot: "passive",
  cooldown: 0,
});
