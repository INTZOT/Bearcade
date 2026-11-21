// ============================================================
// 坦克技能(内容设计 PDF 第 9-10 页)
// - 武器「阔剑·征服」(自定义物品):
//   轻击 8 点近战(professions/tank.ts handleAttack);
//   重击 = weapon_heavy 伪技能(长按右键蓄力,每 0.1 秒 1%,上限 100%,
//   蓄力值 10% 之前强制继续蓄力):直线矩形(宽 3 格)劈砍,距离 1~10 格、
//   伤害 10~30 随蓄力值线性,击飞命中者;携带磐石时转化为火元素伤害;
//   蓄力结束后清空全部磐石。熔火积攒的蓄力值(状态层写入)加到本次
//   释放,释放后清零(2026-11-18 确认:加算)。
//   潜行蓄力:每 0.5 秒消耗 1 魔力 +1 层磐石。
// - 固有Ⅰ 固态火焰(投掷):原版投掷物承载(雪球占位,与战士球状闪电/
//   群法固体雷云同款),发射速度 6 格/秒;落地或命中爆炸:半径 3 格内
//   敌方 10 点火元素伤害 + 炸飞,并在落点生成一块凝固熔岩(岩浆块
//   3×3×3 场景物,15 秒后消失;被引爆时对 6 格内敌方 10 点火元素伤害
//   并施加熔火)。
// - 固有Ⅱ 焚天斩:长按右键蓄力 2 秒,蓄满才能释放(自动施放);
//   中途松手蓄力清零(取消、退还魔力、不进冷却)。以自身为中心
//   三段圆形斩击(半径 5/7/9、伤害 10/15/20,每 0.5 秒一斩,
//   2026-11-18 确认),击飞 + 焚烬,并引爆范围内的所有凝固熔岩。
// - 固有Ⅲ 磐石壁垒(被动):重击命中携带熔火的敌方角色 → 清空其熔火,
//   自身获得 15 秒 20 点临时护甲(5 魔力 / 35 秒冷却)。
// ============================================================
import { customItemBindings, skillRegistry } from "../../framework";
import type { MatchSession } from "../../framework";
import type { Vec3 } from "../../../../shared/minigame-core/types";
import {
  STATUS_BEDROCK,
  STATUS_EMBER,
  STATUS_MOLTEN,
  TANK_HEAVY_BONUS_KEY,
  TANK_HEAVY_SKILL_ID,
  getHeavyChargeBonus,
} from "../statuses/tank";

// ── 自定义物品 ──────────────────────────────────────────────────

export const TANK_WEAPON_ITEM = "snd5:tank_weapon";
export const TANK_SKILL_ITEMS: Record<"innate_1" | "innate_2", string> = {
  innate_1: "snd5:tank_skill_1",
  innate_2: "snd5:tank_skill_2",
};

// ── 公共工具 ─────────────────────────────────────────────────────

/** 存活敌方玩家(内容层通用过滤) */
function aliveEnemiesInRadius(
  session: MatchSession,
  ownerId: string,
  center: { x: number; y: number; z: number },
  radius: number,
) {
  return session.primitives.enemyPlayersInRadius(ownerId, center, radius);
}

// ── 凝固熔岩(岩浆块 3×3×3 场景物 + 盔甲架占位标记) ──────────────

/** 创生物语义类型(引爆按 kind 查询) */
export const LAVA_SUMMON_KIND = "snd5:solidified_lava";
/** 岩浆块立方体基准点(底部中心;Vector3 动态属性,引爆清理用) */
const LAVA_BASE_PROP = "snd5:lava_base";
const LAVA_LIFETIME_TICKS = 300; // 15 秒后消失
const LAVA_DETONATION_RADIUS = 6; // 引爆:以熔岩为中心 6 格
const LAVA_DETONATION_DAMAGE = 10; // 与落地爆炸一致

/** 填充岩浆块 3×3×3(底部贴地,基准点为立方体底部中心格) */
function fillLavaBlocks(session: MatchSession, base: Vec3): void {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = 0; dy <= 2; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        try {
          session.dimension
            .getBlock({ x: base.x + dx, y: base.y + dy, z: base.z + dz })
            ?.setType("minecraft:magma");
        } catch {
          // 未加载区块等:跳过该格
        }
      }
    }
  }
}

/** 清除凝固熔岩方块(消失/被引爆;对局结束另有整房模板重建兜底复原) */
function clearLavaBlocks(session: MatchSession, base: Vec3): void {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = 0; dy <= 2; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        try {
          session.dimension
            .getBlock({ x: base.x + dx, y: base.y + dy, z: base.z + dz })
            ?.setType("minecraft:air");
        } catch {
          // 未加载区块等:跳过该格
        }
      }
    }
  }
}

/** 爆点贴地整平:向下找支撑(最多 5 格),返回立方体底部中心格 */
function settleToGround(session: MatchSession, blast: Vec3): Vec3 {
  const x = Math.floor(blast.x);
  const z = Math.floor(blast.z);
  let y = Math.floor(blast.y);
  for (let i = 0; i < 5; i++) {
    try {
      const below = session.dimension.getBlock({ x, y: y - 1, z });
      if (below && !below.isAir && !below.isLiquid) break;
    } catch {
      break; // 未加载区块:就地落定
    }
    y -= 1;
  }
  return { x, y, z };
}

/** 生成凝固熔岩:岩浆块 3×3×3 + 盔甲架占位标记(不可破坏,15 秒后消失) */
function spawnSolidifiedLava(session: MatchSession, ownerId: string, blast: Vec3): void {
  const base = settleToGround(session, blast);
  fillLavaBlocks(session, base);
  const marker = session.primitives.spawnSummon(
    "minecraft:armor_stand",
    { x: base.x + 0.5, y: base.y + 1.5, z: base.z + 0.5 }, // 立方体几何中心
    {
      ownerId,
      kind: LAVA_SUMMON_KIND,
      invulnerable: true, // 不可破坏的场景物
      lifetimeTicks: LAVA_LIFETIME_TICKS,
      onExpire: () => clearLavaBlocks(session, base),
    },
  );
  if (!marker) return;
  try {
    // 引爆清理按 kind 查询后需要基准点;标记本体隐藏(岩浆块即视觉)
    marker.setDynamicProperty(LAVA_BASE_PROP, { x: base.x, y: base.y, z: base.z });
    marker.addEffect("minecraft:invisibility", LAVA_LIFETIME_TICKS + 20, { amplifier: 0 });
  } catch {
    // 表现失败不影响结算
  }
}

/** 引爆一块凝固熔岩:以熔岩为中心 6 格内敌方 10 点火伤 + 熔火 */
function detonateLava(session: MatchSession, ownerId: string, lavaCenter: Vec3): void {
  for (const state of aliveEnemiesInRadius(session, ownerId, lavaCenter, LAVA_DETONATION_RADIUS)) {
    session.combat.dealDamage(ownerId, state.id, {
      hp: LAVA_DETONATION_DAMAGE,
      element: "fire",
      tags: ["skill"],
    });
    session.status.apply(state.id, STATUS_MOLTEN, ownerId);
  }
  try {
    session.dimension.playSound("random.explode", lavaCenter);
  } catch {
    // 音效失败不影响结算
  }
}

/** 引爆斩击半径内的全部凝固熔岩:先清方块/结算,再销毁标记实体 */
function detonateLavaInRange(session: MatchSession, ownerId: string, center: Vec3, radius: number): void {
  for (const instance of session.summons.getByKind(LAVA_SUMMON_KIND)) {
    if (!instance.entity.isValid) continue;
    const loc = instance.entity.location;
    const dx = loc.x - center.x;
    const dy = loc.y - center.y;
    const dz = loc.z - center.z;
    if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
    const base = instance.entity.getDynamicProperty(LAVA_BASE_PROP);
    if (base && typeof base === "object") {
      clearLavaBlocks(session, base as Vec3);
    }
    detonateLava(session, instance.ownerId ?? ownerId, { x: loc.x, y: loc.y, z: loc.z });
  }
  session.primitives.explodeSummons(center, radius, { kind: LAVA_SUMMON_KIND });
}

// ── 固有Ⅰ 固态火焰(snd5:tank_skill_1,右键即放) ────────────────

const FLAME_MANA = 15;
const FLAME_COOLDOWN_TICKS = 360; // 18 秒
const FLAME_MAX_STACKS = 3;
const FLAME_BLAST_RADIUS = 3;
const FLAME_DAMAGE = 10;
/** 发射速度 */
const FLAME_SPEED_BLOCKS_PER_TICK = 1;
const FLAME_FUSE_TICKS = 60; // 3 秒未命中则原地爆炸

/** 固态火焰落地爆炸:3 格内敌方 10 点火伤 + 炸飞,落点生成凝固熔岩 */
function explodeSolidFlame(session: MatchSession, ownerId: string, blast: Vec3): void {
  for (const state of aliveEnemiesInRadius(session, ownerId, blast, FLAME_BLAST_RADIUS)) {
    session.combat.dealDamage(ownerId, state.id, {
      hp: FLAME_DAMAGE,
      element: "fire",
      tags: ["skill"],
    });
    const dx = state.player.location.x - blast.x;
    const dz = state.player.location.z - blast.z;
    session.primitives.knockback(state.id, { x: dx, z: dz }, 0.9, 0.5);
  }
  spawnSolidifiedLava(session, ownerId, blast);
  try {
    session.dimension.playSound("random.explode", blast);
  } catch {
    // 音效失败不影响结算
  }
}

skillRegistry.register({
  id: "snd5:tank_solid_flame",
  displayName: "固态火焰",
  slot: "innate_1",
  manaCost: FLAME_MANA,
  cooldown: FLAME_COOLDOWN_TICKS,
  maxStacks: FLAME_MAX_STACKS,
  castMode: "instant",
  failureHint: { no_mana: `魔力不足(${FLAME_MANA})` },

  cast(ctx) {
    const head = ctx.player.getHeadLocation();
    // 原版投掷物承载(雪球占位):飞行/重力/碰撞由引擎负责,
    // 落地或命中即爆炸并生成凝固熔岩
    const spawned = ctx.primitives.spawnProjectile(
      "minecraft:snowball",
      { x: head.x + ctx.direction.x, y: head.y + ctx.direction.y, z: head.z + ctx.direction.z },
      ctx.direction,
      {
        ownerId: ctx.casterId,
        speedBlocksPerTick: FLAME_SPEED_BLOCKS_PER_TICK,
        lifetimeTicks: FLAME_FUSE_TICKS,
        onHitBlock: (location) => explodeSolidFlame(ctx.session, ctx.casterId, location),
        onHitEntity: (targetId, instance) => {
          // 命中角色:在目标位置爆炸(投掷物命中后可能已失效)
          const target = ctx.primitives.getEntity(targetId);
          if (target?.isValid) explodeSolidFlame(ctx.session, ctx.casterId, target.location);
          else if (instance.entity.isValid) {
            explodeSolidFlame(ctx.session, ctx.casterId, instance.entity.location);
          }
        },
        onExpire: (instance) => {
          if (instance.entity.isValid) {
            explodeSolidFlame(ctx.session, ctx.casterId, instance.entity.location);
          }
        },
      },
    );
    return spawned ? true : false;
  },
});

// ── 固有Ⅱ 焚天斩(snd5:tank_skill_2,长按右键蓄力 2 秒,蓄满才能释放) ─

const SLASH_MANA = 25;
const SLASH_COOLDOWN_TICKS = 440; // 22 秒
const SLASH_CHARGE_TICKS = 40; // 长按蓄力 2 秒(会话 5t 网格量化)
const SLASH_WAVE_INTERVAL_TICKS = 10; // 每 0.5 秒一斩
const SLASH_WAVES = [
  { radius: 5, damage: 10 },
  { radius: 7, damage: 15 },
  { radius: 9, damage: 20 },
] as const;
const SLASH_LAUNCH_HORIZONTAL = 0.7;
const SLASH_LAUNCH_VERTICAL = 0.45;

/** 一段圆形斩击:击飞范围内敌方 + 伤害 + 焚烬,并引爆范围内凝固熔岩 */
function slashWave(
  session: MatchSession,
  casterId: string,
  center: Vec3,
  radius: number,
  damage: number,
): void {
  for (const state of aliveEnemiesInRadius(session, casterId, center, radius)) {
    const result = session.combat.dealDamage(casterId, state.id, {
      hp: damage,
      element: "physical", // 设计未标元素:普通伤害;焚烬由施加状态驱动
      tags: ["skill", "sweep"],
    });
    if (!result) continue;
    // 击飞:远离施放者方向 + 向上
    const dx = state.player.location.x - center.x;
    const dz = state.player.location.z - center.z;
    session.primitives.knockback(state.id, { x: dx, z: dz }, SLASH_LAUNCH_HORIZONTAL, SLASH_LAUNCH_VERTICAL);
    session.status.apply(state.id, STATUS_EMBER, casterId);
  }
  // 引爆范围内的所有凝固熔岩
  detonateLavaInRange(session, casterId, center, radius);
  // 范围反馈
  session.primitives.showIndicator(casterId, { kind: "circle", center, radius }, { durationTicks: 6 });
  try {
    session.dimension.playSound("mob.blaze.shoot", center);
  } catch {
    // 音效失败不影响结算
  }
}

skillRegistry.register({
  id: "snd5:tank_ember_slash",
  displayName: "焚天斩",
  slot: "innate_2",
  manaCost: SLASH_MANA,
  cooldown: SLASH_COOLDOWN_TICKS,
  maxStacks: 1,
  castMode: "charge",
  // 长按蓄力:蓄满 2 秒才能释放(蓄满自动施放);
  // 中途松手蓄力清零(cancelOnRelease:取消、退还魔力、不进冷却)
  chargeConfig: {
    maxTicks: SLASH_CHARGE_TICKS,
    tickIntervalTicks: 5,
    cancelOnRelease: true,
  },
  failureHint: { no_mana: `魔力不足(${SLASH_MANA})` },
  // 蓄力期间三段扩张环跟随自身(team 可见,提示队友范围)
  indicator(ctx) {
    const loc = ctx.player.location;
    return SLASH_WAVES.map((wave) => ({
      kind: "circle" as const,
      center: { x: loc.x, y: loc.y, z: loc.z },
      radius: wave.radius,
    }));
  },
  indicatorOptions: { visibility: "team" },

  cast(ctx) {
    const session = ctx.session;
    for (let wave = 0; wave < SLASH_WAVES.length; wave++) {
      ctx.primitives.schedule(wave * SLASH_WAVE_INTERVAL_TICKS, () => {
        const caster = session.players.get(ctx.casterId);
        if (!caster?.alive || !caster.player.isValid) return;
        const center = { x: caster.player.location.x, y: caster.player.location.y, z: caster.player.location.z };
        slashWave(session, ctx.casterId, center, SLASH_WAVES[wave].radius, SLASH_WAVES[wave].damage);
      });
    }
    return true;
  },
});

// ── 武器「征服」重击(weapon_heavy 伪技能,绑定在自定义武器上) ────

const HEAVY_MAX_TICKS = 200; // 蓄力 100% = 10 秒(每 0.1 秒 +1%)
const HEAVY_MIN_TICKS = 20; // 蓄力值 10% 之前强制继续蓄力(1 秒)
const HEAVY_TICK_INTERVAL = 5; // 会话网格:每 0.25 秒 +2.5%(量化)
const HEAVY_WIDTH = 3; // 直线矩形宽(格)
const HEAVY_LAUNCH_HORIZONTAL = 0.8;
const HEAVY_LAUNCH_VERTICAL = 0.45;

/** 蓄力值(%;10~100)→ 进度 0~1(10% → 1 格/10 点,100% → 10 格/30 点) */
function chargeProgress(chargePercentValue: number): number {
  return Math.min(1, Math.max(0, (chargePercentValue - 10) / 90));
}

/** 当前有效蓄力值(%):长按蓄力 + 熔火积攒值,上限 100% */
function effectiveCharge(ctx: { session: MatchSession; casterId: string; chargePercent: number }): number {
  return Math.min(100, ctx.chargePercent * 100 + getHeavyChargeBonus(ctx.session, ctx.casterId));
}

// ── 固有Ⅲ 磐石壁垒(被动;触发点在重击结算) ──────────────────────

const BULWARK_PASSIVE_ID = "snd5:tank_bulwark_passive";
const BULWARK_MANA = 5;
const BULWARK_COOLDOWN_TICKS = 700; // 35 秒
const BULWARK_TEMP_ARMOR = 20;
const BULWARK_TEMP_ARMOR_TICKS = 300; // 15 秒

/** 固有Ⅲ 触发:重击命中携带熔火的敌方 → 清空其熔火 + 自身临时护甲 */
function triggerBulwarkPassive(session: MatchSession, tankId: string, moltenTargetId: string): void {
  if (!session.skills.isPassiveReady(tankId, BULWARK_PASSIVE_ID)) return;
  if (session.attributes.getMana(tankId) < BULWARK_MANA) return;
  session.attributes.spendMana(tankId, BULWARK_MANA);
  session.skills.startPassiveCooldown(tankId, BULWARK_PASSIVE_ID, BULWARK_COOLDOWN_TICKS);
  session.status.remove(moltenTargetId, STATUS_MOLTEN, "consumed");
  session.primitives.addTempArmor(tankId, BULWARK_TEMP_ARMOR, BULWARK_TEMP_ARMOR_TICKS);
  const player = session.players.get(tankId)?.player;
  if (player?.isValid) {
    session.hud.toast(player, "§c磐石壁垒: 清空熔火,获得 20 点临时护甲");
  }
}

skillRegistry.register({
  id: "snd5:tank_heavy",
  displayName: "征服·重击",
  slot: "weapon_heavy",
  cooldown: 0, // 无冷却,由蓄力时长自然限频
  castMode: "charge",
  chargeConfig: {
    minTicks: HEAVY_MIN_TICKS, // 10% 之前松手无效(强制继续蓄力)
    maxTicks: HEAVY_MAX_TICKS,
    tickIntervalTicks: HEAVY_TICK_INTERVAL,
    onChargeTick(ctx) {
      // 潜行蓄力:每 0.5 秒(chargeTicks 每 10)消耗 1 魔力 +1 层磐石
      if (!ctx.isSneaking) return;
      if (ctx.chargeTicks % (HEAVY_TICK_INTERVAL * 2) !== 0) return;
      if (!ctx.session.attributes.spendMana(ctx.casterId, 1)) return;
      ctx.session.status.apply(ctx.casterId, STATUS_BEDROCK, ctx.casterId);
    },
  },
  // 蓄力期间直线矩形指示器跟随视角;长度 = 有效蓄力距离(含熔火积攒值)
  indicator(ctx) {
    const effective = effectiveCharge(ctx);
    const range = 1 + 9 * chargeProgress(effective);
    return {
      kind: "line",
      origin: ctx.player.location,
      direction: { x: ctx.direction.x, y: 0, z: ctx.direction.z },
      length: Math.max(1, range),
      width: HEAVY_WIDTH,
    };
  },

  cast(ctx) {
    const session = ctx.session;
    const player = ctx.player;
    if (!player.isValid) return false;

    // 熔火积攒值加到本次蓄力,释放后清零
    const effective = effectiveCharge(ctx);
    session.skills.privateStore(ctx.casterId, TANK_HEAVY_SKILL_ID).set(TANK_HEAVY_BONUS_KEY, 0);
    const progress = chargeProgress(effective);
    const range = 1 + 9 * progress;
    const damage = Math.round(10 + 20 * progress);

    // 携带磐石 → 火元素伤害(先判定,后清空)
    const bedrockStacks = session.status.getStacks(ctx.casterId, STATUS_BEDROCK);
    const element = bedrockStacks > 0 ? "fire" : "physical";

    // 直线矩形(宽 3 格):前向分量 ∈ [-1, range],横向分量 ≤ 1.5
    const center = player.location;
    const dir = ctx.direction;
    const hLen = Math.max(0.001, Math.hypot(dir.x, dir.z));
    const fwdX = dir.x / hLen;
    const fwdZ = dir.z / hLen;
    const myTeam = session.teams.getTeam(ctx.casterId);
    let moltenTargetId: string | undefined;
    for (const state of session.primitives.playersInRadius(center, range + 2)) {
      if (state.id === ctx.casterId) continue;
      if (session.teams.getTeam(state.id) === myTeam) continue;
      const dx = state.player.location.x - center.x;
      const dz = state.player.location.z - center.z;
      const forward = dx * fwdX + dz * fwdZ;
      if (forward < -1 || forward > range) continue; // -1:贴身也计入劈砍起点
      const lateral = Math.abs(dx * -fwdZ + dz * fwdX);
      if (lateral > HEAVY_WIDTH / 2) continue;
      const result = session.combat.dealDamage(ctx.casterId, state.id, {
        hp: damage,
        element,
        tags: ["weapon", "melee", "sweep"],
      });
      if (!result) continue;
      // 击飞:远离坦克方向 + 向上
      session.primitives.knockback(state.id, { x: dx, z: dz }, HEAVY_LAUNCH_HORIZONTAL, HEAVY_LAUNCH_VERTICAL);
      if (!moltenTargetId && session.status.has(state.id, STATUS_MOLTEN)) {
        moltenTargetId = state.id;
      }
    }

    // 蓄力结束:清空全部磐石
    session.status.remove(ctx.casterId, STATUS_BEDROCK, "consumed");

    // 命中反馈(矩形走廊闪烁)
    session.primitives.showIndicator(
      ctx.casterId,
      {
        kind: "line",
        origin: center,
        direction: { x: dir.x, y: 0, z: dir.z },
        length: Math.max(1, range),
        width: HEAVY_WIDTH,
      },
      { durationTicks: 6 },
    );

    // 固有Ⅲ:命中携带熔火的敌方角色
    if (moltenTargetId) triggerBulwarkPassive(session, ctx.casterId, moltenTargetId);
    return true;
  },
});

// ── 固有Ⅲ 磐石壁垒(被动;注册供职业装载与 HUD 展示) ─────────────

skillRegistry.register({
  id: BULWARK_PASSIVE_ID,
  displayName: "磐石壁垒(被动)",
  slot: "passive",
  cooldown: 0,
  // 触发点在 weapon_heavy 重击结算(triggerBulwarkPassive)
});

// ── 自定义物品绑定(组件回调路由) ────────────────────────────────

customItemBindings.set(TANK_SKILL_ITEMS.innate_1, { skillId: "snd5:tank_solid_flame" });
customItemBindings.set(TANK_SKILL_ITEMS.innate_2, { skillId: "snd5:tank_ember_slash" });
// 武器:长按右键弓式蓄力(重击),潜行蓄力叠磐石走 onChargeTick
customItemBindings.set(TANK_WEAPON_ITEM, { skillId: "snd5:tank_heavy" });
