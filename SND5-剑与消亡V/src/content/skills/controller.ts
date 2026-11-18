// ============================================================
// 控制技能(内容设计 PDF 第 14-17 页)
// - 武器「筒型魔杖·不等式」(自定义物品):
//   轻击 5 点近战(professions/controller.ts handleAttack);
//   重击 = weapon_heavy 伪技能(长按右键蓄力 1.7s):¼圆 6 格 10 点
//   水伤,随距离线性衰减(近端全额 → 边缘 50%);
//   潜行释放 → 回收半径 6 圆内敌方全部浊露层数,进阶「水的两面性」
//   (¼圆 8 格,伤害 = (10+回收层数) 同曲线衰减,命中魔魇噬魂目标
//   附加 5 秒失明;未回收任何层数则按普通重击结算)。
// - 固有Ⅰ 魔瘴之泉:原地放置泉水创生物(盔甲架占位,托管血量 60,
//   18s,每 3s 对 5 格内敌方 4 点水伤 + 1 层浊露),自身前移 3 格。
// - 固有Ⅱ 魔魇降临(吟唱):圆心从自身出发以每秒 2 格朝准星移动
//   (最远 8 格),每秒对圆心 6 格内敌方 2 点水伤 + 尝试施加魔魇降临。
// - 固有Ⅲ 魔魂代偿(被动):damage.lethal 拦截(DOT 致死不拦),
//   下一拍消耗全部魔力等量回血;100 秒冷却。
// ============================================================
import { customItemBindings, skillRegistry } from "../../framework";
import type { CastContext, MatchSession, PlayerState } from "../../framework";
import type { Vec3 } from "../../../../shared/minigame-core/types";
import {
  SPRING_SUMMON_KIND,
  STATUS_NIGHTMARE_DESCENT,
  STATUS_NIGHTMARE_DEVOUR,
  STATUS_TURBID_DEW,
} from "../statuses/controller";

// ── 自定义物品 ──────────────────────────────────────────────────

export const CONTROLLER_WEAPON_ITEM = "snd5:controller_weapon";
export const CONTROLLER_SKILL_ITEMS: Record<"innate_1" | "innate_2", string> = {
  innate_1: "snd5:controller_skill_1",
  innate_2: "snd5:controller_skill_2",
};

// ── 公共工具 ─────────────────────────────────────────────────────

/** 存活敌方玩家(内容层通用过滤) */
function aliveEnemiesInRadius(
  session: MatchSession,
  ownerId: string,
  center: { x: number; y: number; z: number },
  radius: number,
): PlayerState[] {
  return session.primitives.enemyPlayersInRadius(ownerId, center, radius);
}

/** 水平扇形判定(与 primitives.dealSectorDamage 同算法):angleDegrees 为全角 */
function inSector(
  center: { x: number; z: number },
  direction: { x: number; y: number; z: number },
  location: { x: number; z: number },
  angleDegrees: number,
): boolean {
  const dx = location.x - center.x;
  const dz = location.z - center.z;
  const len = Math.max(0.001, Math.hypot(dx, dz));
  const dirLen = Math.max(0.001, Math.hypot(direction.x, direction.z));
  const dot = (dx / len) * (direction.x / dirLen) + (dz / len) * (direction.z / dirLen);
  const halfAngle = (angleDegrees / 2) * (Math.PI / 180);
  return Math.acos(Math.max(-1, Math.min(1, dot))) <= halfAngle;
}

/** 距离系数:0(近)~1(远) */
function distanceFactor(
  center: { x: number; z: number },
  location: { x: number; z: number },
  radius: number,
): number {
  const dist = Math.hypot(location.x - center.x, location.z - center.z);
  return Math.min(1, Math.max(0, dist / radius));
}

/**
 * 重击伤害随距离线性衰减(PDF 未给曲线):近端全额 → 半径边缘 50%。
 */
function decayedDamage(base: number, center: { x: number; z: number }, location: { x: number; z: number }, radius: number): number {
  return Math.max(1, Math.round(base * (1 - 0.5 * distanceFactor(center, location, radius))));
}

/** 视准心地面点:射线命中方块取顶面中心,未命中按水平投影 max 格 */
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

// ── 武器重击(weapon_heavy 伪技能,绑定在自定义武器上) ────────────

const HEAVY_CHARGE_TICKS = 34; // 1.7 秒(会话 5t 网格量化)
const HEAVY_RADIUS = 6;
const DUAL_RADIUS = 8; // 水的两面性:¼圆半径提高 2 格
const HEAVY_DAMAGE = 10;
const HEAVY_ANGLE = 90; // ¼ 圆
/** 水的两面性:每回收 1 层浊露伤害 +1 */
const DUAL_DAMAGE_PER_STACK = 1;
/** 水的两面性:命中魔魇噬魂目标附加 5 秒失明 */
const DUAL_BLINDNESS_TICKS = 100;

/** ¼ 圆(90°)范围伤害:随距离衰减的 (基础+加成) 点水伤;dual = 水的两面性 */
function heavySectorDamage(
  session: MatchSession,
  ctx: CastContext,
  center: Vec3,
  radius: number,
  baseDamage: number,
  dual: boolean,
): void {
  for (const state of aliveEnemiesInRadius(session, ctx.casterId, center, radius)) {
    if (!inSector(center, ctx.direction, state.player.location, HEAVY_ANGLE)) continue;
    session.combat.dealDamage(ctx.casterId, state.id, {
      hp: decayedDamage(baseDamage, center, state.player.location, radius),
      element: "water",
      tags: ["weapon", "melee", "sweep"],
    });
    // 水的两面性:击中携带魔魇噬魂的目标 → 额外 5 秒失明
    if (dual && session.status.has(state.id, STATUS_NIGHTMARE_DEVOUR)) {
      ctx.primitives.applyEffect(state.id, "minecraft:blindness", DUAL_BLINDNESS_TICKS);
    }
  }
}

skillRegistry.register({
  id: "snd5:controller_heavy",
  displayName: "不等式·重击",
  slot: "weapon_heavy",
  cooldown: 0, // 无冷却,由蓄力时长自然限频
  castMode: "charge",
  // 蓄满才施放:提前松手继续蓄(minTicks = maxTicks)
  chargeConfig: {
    minTicks: HEAVY_CHARGE_TICKS,
    maxTicks: HEAVY_CHARGE_TICKS,
    tickIntervalTicks: 5,
  },
  // 蓄力期间 ¼ 圆指示器跟随视角;潜行释放显示进阶半径(实际以回收层数为准)
  indicator(ctx) {
    return {
      kind: "sector",
      origin: ctx.player.location,
      direction: { x: ctx.direction.x, z: ctx.direction.z },
      radius: ctx.isSneaking ? DUAL_RADIUS : HEAVY_RADIUS,
      angleDegrees: HEAVY_ANGLE,
    };
  },

  // 普通释放:¼ 圆 6 格 10 点水伤,随距离衰减
  cast(ctx) {
    const center = ctx.player.location;
    heavySectorDamage(ctx.session, ctx, center, HEAVY_RADIUS, HEAVY_DAMAGE, false);
    ctx.primitives.showIndicator(
      ctx.casterId,
      {
        kind: "sector",
        origin: center,
        direction: { x: ctx.direction.x, z: ctx.direction.z },
        radius: HEAVY_RADIUS,
        angleDegrees: HEAVY_ANGLE,
      },
      { durationTicks: 6 },
    );
    return true;
  },

  // 潜行释放:回收半径 6 圆内敌方全部浊露 → 水的两面性(¼圆 8 格)
  castSneaking(ctx) {
    const session = ctx.session;
    const center = ctx.player.location;
    let recycled = 0;
    for (const state of aliveEnemiesInRadius(session, ctx.casterId, center, HEAVY_RADIUS)) {
      if (!session.status.has(state.id, STATUS_TURBID_DEW)) continue;
      recycled += session.status.getStacks(state.id, STATUS_TURBID_DEW);
      session.status.remove(state.id, STATUS_TURBID_DEW, "recycled");
    }
    if (recycled > 0) {
      // 水的两面性:伤害 = (10 + 回收层数),同曲线随距离衰减
      heavySectorDamage(
        session,
        ctx,
        center,
        DUAL_RADIUS,
        HEAVY_DAMAGE + recycled * DUAL_DAMAGE_PER_STACK,
        true,
      );
      session.hud.toast(ctx.player, `§b水的两面性: 回收 ${recycled} 层浊露`);
    } else {
      // 未回收任何浊露:按普通重击结算
      heavySectorDamage(session, ctx, center, HEAVY_RADIUS, HEAVY_DAMAGE, false);
    }
    ctx.primitives.showIndicator(
      ctx.casterId,
      {
        kind: "sector",
        origin: center,
        direction: { x: ctx.direction.x, z: ctx.direction.z },
        radius: recycled > 0 ? DUAL_RADIUS : HEAVY_RADIUS,
        angleDegrees: HEAVY_ANGLE,
      },
      { durationTicks: 6 },
    );
    return true;
  },
});

// ── 固有Ⅰ 魔瘴之泉(snd5:controller_skill_1) ────────────────────

const SPRING_MANA = 15;
const SPRING_COOLDOWN_TICKS = 160; // 8 秒
const SPRING_MAX_STACKS = 3;
const SPRING_LIFETIME_TICKS = 360; // 18 秒
const SPRING_TICK_INTERVAL = 60; // 每 3 秒一拍
const SPRING_MAX_HP = 60;
const SPRING_RADIUS = 5;
const SPRING_DAMAGE = 4;
const SPRING_DASH_BLOCKS = 3;

/** 魔瘴之泉:盔甲架占位,托管血量 60,18 秒,每 3 秒 5 格内 4 点水伤 + 1 层浊露 */
function spawnMiasmaSpring(session: MatchSession, ownerId: string, location: Vec3): void {
  const spring = session.primitives.spawnSummon("minecraft:armor_stand", location, {
    ownerId,
    kind: SPRING_SUMMON_KIND,
    maxHp: SPRING_MAX_HP,
    lifetimeTicks: SPRING_LIFETIME_TICKS,
    tickIntervalTicks: SPRING_TICK_INTERVAL,
    onTick: (entity) => {
      for (const state of aliveEnemiesInRadius(session, ownerId, entity.location, SPRING_RADIUS)) {
        session.combat.dealDamage(ownerId, state.id, {
          hp: SPRING_DAMAGE,
          element: "water",
          tags: ["skill"],
        });
        session.status.apply(state.id, STATUS_TURBID_DEW, ownerId);
      }
    },
  });
  if (spring) {
    try {
      spring.nameTag = "§b魔瘴之泉";
    } catch {
      // 占位表现失败不影响结算
    }
  }
}

skillRegistry.register({
  id: "snd5:controller_spring",
  displayName: "魔瘴之泉",
  slot: "innate_1",
  manaCost: SPRING_MANA,
  cooldown: SPRING_COOLDOWN_TICKS,
  maxStacks: SPRING_MAX_STACKS,
  castMode: "instant",
  failureHint: { no_mana: `魔力不足(${SPRING_MANA})` },

  cast(ctx) {
    const caster = ctx.session.players.get(ctx.casterId);
    if (!caster?.player.isValid) return false;
    const location = caster.player.location;
    // 先原地放置魔瘴之泉
    spawnMiasmaSpring(ctx.session, ctx.casterId, {
      x: location.x,
      y: location.y,
      z: location.z,
    });
    // 随后自身向前位移 3 格(水平方向)
    ctx.primitives.dash(ctx.casterId, { x: ctx.direction.x, y: 0, z: ctx.direction.z }, SPRING_DASH_BLOCKS);
    return true;
  },
});

// ── 固有Ⅱ 魔魇降临(snd5:controller_skill_2,长按吟唱) ────────────

const NIGHTMARE_MANA_PER_SECOND = 2;
const NIGHTMARE_COOLDOWN_TICKS = 100; // 5 秒
const NIGHTMARE_CENTER_MAX = 8; // 指示器圆心最远距离自身 8 格
const NIGHTMARE_CENTER_SPEED_PER_TICK = 2 / 20; // 圆心每秒 2 格朝准星移动
const NIGHTMARE_RADIUS = 6;
const NIGHTMARE_PULSE_DAMAGE = 2;
const NIGHTMARE_PULSE_INTERVAL_TICKS = 20; // 每秒一拍

/**
 * 吟唱圆心(存于技能私有存储;每轮吟唱从施法者当前位置重新开始)。
 * ctx.store 跨施法持久(群法定律等依赖该语义),圆心与节拍游标却是
 * 单轮状态:castElapsedTicks 在新一轮施法必然回退,以此检测并重置。
 * 不用 onChannelEnd 清理的原因:玩家失效时框架静默清理施法,不经过
 * 该钩子;此处是 indicator()/onChannelTick 的公共入口,必然覆盖。
 */
function channelCenter(ctx: CastContext): Vec3 {
  const lastElapsed = ctx.store.get("elapsedTicks");
  if (typeof lastElapsed === "number" && ctx.castElapsedTicks < lastElapsed) {
    ctx.store.clear();
  }
  ctx.store.set("elapsedTicks", ctx.castElapsedTicks);
  const stored = ctx.store.get("center") as Vec3 | undefined;
  if (stored) return stored;
  const location = ctx.player.location;
  const center: Vec3 = { x: location.x, y: location.y, z: location.z };
  ctx.store.set("center", center);
  ctx.store.set("movedAtTicks", 0);
  ctx.store.set("lastPulseAtTicks", 0);
  return center;
}

skillRegistry.register({
  id: "snd5:controller_nightmare",
  displayName: "魔魇降临",
  slot: "innate_2",
  // 每秒消耗 2 点魔力(框架按真实经过 tick 折算扣费;校验按 2 点起步)
  manaCost: NIGHTMARE_MANA_PER_SECOND,
  cooldown: NIGHTMARE_COOLDOWN_TICKS,
  maxStacks: 1,
  castMode: "channel",
  failureHint: { no_mana: `魔力不足(${NIGHTMARE_MANA_PER_SECOND})` },

  // 吟唱指示器:圆心半径 6 的圆,跟随移动中的判定圆心
  indicator(ctx) {
    return {
      kind: "circle",
      center: channelCenter(ctx),
      radius: NIGHTMARE_RADIUS,
    };
  },

  onChannelTick(ctx) {
    const center = channelCenter(ctx);
    // 圆心以每秒 2 格朝准星地面点(最远 8 格)缓慢移动
    const movedAt = (ctx.store.get("movedAtTicks") as number | undefined) ?? 0;
    const stepTicks = Math.max(0, ctx.channelTicks - movedAt);
    if (stepTicks > 0) {
      const target = viewGroundCenter(ctx, NIGHTMARE_CENTER_MAX);
      const dx = target.x - center.x;
      const dy = target.y - center.y;
      const dz = target.z - center.z;
      const len = Math.max(0.001, Math.hypot(dx, dy, dz));
      const step = Math.min(NIGHTMARE_CENTER_SPEED_PER_TICK * stepTicks, len);
      const next: Vec3 = {
        x: center.x + (dx / len) * step,
        y: center.y + (dy / len) * step,
        z: center.z + (dz / len) * step,
      };
      ctx.store.set("center", next);
      ctx.store.set("movedAtTicks", ctx.channelTicks);
    }
    // 每秒一拍:圆心半径 6 圆内敌方 2 点水伤 + 尝试施加魔魇降临
    const lastPulseAt = (ctx.store.get("lastPulseAtTicks") as number | undefined) ?? 0;
    if (ctx.channelTicks - lastPulseAt < NIGHTMARE_PULSE_INTERVAL_TICKS) return;
    ctx.store.set("lastPulseAtTicks", ctx.channelTicks);
    const current = (ctx.store.get("center") as Vec3) ?? center;
    for (const state of aliveEnemiesInRadius(ctx.session, ctx.casterId, current, NIGHTMARE_RADIUS)) {
      ctx.session.combat.dealDamage(ctx.casterId, state.id, {
        hp: NIGHTMARE_PULSE_DAMAGE,
        element: "water",
        tags: ["skill"],
      });
      // 「尝试施加」:已携带者(reapplyable: false)自动跳过
      ctx.session.status.apply(state.id, STATUS_NIGHTMARE_DESCENT, ctx.casterId);
    }
  },

  // 吟唱结束(松手/魔力枯竭/死亡)由框架按 ready 分支结算 → 5 秒冷却
});

// ── 固有Ⅲ 魔魂代偿(被动) ────────────────────────────────────────

const PASSIVE_COOLDOWN_TICKS = 2000; // 100 秒

skillRegistry.register({
  id: "snd5:controller_mana_shield",
  displayName: "魔魂代偿(被动)",
  slot: "passive",
  cooldown: 0,
  listen: ["damage.lethal"],

  onEvent(event, ctx) {
    const payload = event.payload as { targetId?: string; tags?: string[]; cancel?: () => void };
    if (payload.targetId !== ctx.playerId || typeof payload.cancel !== "function") return;
    // DOT 致死不拦(架构设计 §5.4 约定,防止浊露/魔魇噬魂跳伤无限续命)
    if (payload.tags?.includes("dot")) return;
    // 拦截致命伤害;框架随后补回 1 点生命,下一拍消耗全部魔力等量回血
    payload.cancel();
    ctx.session.schedule(1, () => {
      const mana = ctx.session.attributes.getMana(ctx.playerId);
      if (mana <= 0 || ctx.session.isDead(ctx.playerId)) return;
      ctx.session.attributes.spendMana(ctx.playerId, mana);
      // 回复走治疗管线(受重伤/收束等治疗修正影响)
      ctx.session.combat.heal(ctx.playerId, ctx.playerId, { amount: mana });
      const player = ctx.session.players.get(ctx.playerId)?.player;
      if (player?.isValid) {
        ctx.session.hud.toast(player, `§b魔魂代偿: 消耗 ${Math.floor(mana)} 魔力抵消致命伤害`);
      }
    });
    return { startCooldownTicks: PASSIVE_COOLDOWN_TICKS };
  },
});

// ── 自定义物品绑定(组件回调路由) ────────────────────────────────

// 固有Ⅰ:右键即时施放;固有Ⅱ:长按吟唱(itemStartUse/itemReleaseUse 路由)
customItemBindings.set(CONTROLLER_SKILL_ITEMS.innate_1, {
  skillId: "snd5:controller_spring",
});
customItemBindings.set(CONTROLLER_SKILL_ITEMS.innate_2, {
  skillId: "snd5:controller_nightmare",
});
// 武器:长按右键弓式蓄力(重击),潜行释放走 castSneaking
customItemBindings.set(CONTROLLER_WEAPON_ITEM, { skillId: "snd5:controller_heavy" });
