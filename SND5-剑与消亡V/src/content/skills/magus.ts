// ============================================================
// 群法技能(内容设计 PDF 第 18-22 页)
// - 固有Ⅰ/Ⅱ 共享同一定律状态;潜行+右键切换定律(自定义物品绑定
//   的效用动作,不进施法流程 → 不预扣魔力/堆叠/冷却,修复旧实现的
//   「切换定律与技能释放冲突」);定律类型由物品名实时显示。
//   定律Ⅰ 电:固体雷云(雪球投掷,落地驻场 8s/0.5s 跳 4 格 5 电 + 电离)
//   定律Ⅱ 火:球状烈焰(每秒 1 格前移,4s 后爆:7 格 15 火 + 聚拢 + 焙烧)
//   定律Ⅲ 水:倒置积云(2s 后每秒 1 格跟随施放者,6s/0.5s 跳 10 格
//   1~5 水 + 浸润,最低伤每秒 +1)
//   固有Ⅱ:Ⅰ ¼圆 8 格 8~12 电;Ⅱ ¼圆 8 格 7~15 火;Ⅲ 半圆 3×4 水
// - 武器「周期」:重击 = weapon_heavy 伪技能绑定在自定义武器上
//   (长按右键弓式蓄力 1.4s,潜行释放 → 魔力凝聚不攻击)。
// - 固有Ⅲ 法力血契(被动):hpSubstitute 标志分布于各技能,
//   魔力不足部分用生命值代替(框架 prededuct 已实现)。
// ============================================================
import { customItemBindings, skillRegistry } from "../../framework";
import type { MatchSession } from "../../framework";
import type { ProfessionSkillEntry } from "../professions/registry";
import {
  STATUS_IONIZE,
  STATUS_ROAST,
  STATUS_SOAK,
  STATUS_MANA_CONDENSE,
  STATUS_MANA_RESIDUE,
  STATUS_ARMOR_BRITTLE,
  STATUS_ELECTRIC_FRAGILE,
} from "../statuses/magus";

// ── 定律存储(固有Ⅰ/Ⅱ 共享,会话内存,重生保留) ────────────────

export type MagusLaw = 1 | 2 | 3;

const LAW_STORE_SKILL = "snd5:magus_law";
const LAW_KEY = "law";

function getLaw(session: MatchSession, playerId: string): MagusLaw {
  const law = session.skills.privateStore(playerId, LAW_STORE_SKILL).get(LAW_KEY);
  return law === 2 || law === 3 ? law : 1;
}

const LAW_ELEMENT = { 1: "电", 2: "火", 3: "水" } as const;
const LAW_COLOR = { 1: "§b", 2: "§c", 3: "§9" } as const;

const LAW_MANA_1: Record<MagusLaw, number> = { 1: 17, 2: 23, 3: 15 };
const LAW_COOLDOWN_1: Record<MagusLaw, number> = { 1: 100, 2: 160, 3: 120 }; // 5/8/6 秒
const LAW_MANA_2: Record<MagusLaw, number> = { 1: 22, 2: 35, 3: 30 };
const LAW_COOLDOWN_2: Record<MagusLaw, number> = { 1: 320, 2: 400, 3: 360 }; // 16/20/18 秒

// ── 自定义物品外观(定律类型由物品名显示) ────────────────────────

export const MAGUS_WEAPON_ITEM = "snd5:magus_weapon";
export const MAGUS_SKILL_ITEMS: Record<"innate_1" | "innate_2", string> = {
  innate_1: "snd5:magus_skill_1",
  innate_2: "snd5:magus_skill_2",
};

const SKILL_LORE: Record<"innate_1" | "innate_2", string[]> = {
  innate_1: [
    "§7定律Ⅰ 电·固体雷云: 17 魔力 / 5 秒",
    "§7定律Ⅱ 火·球状烈焰: 23 魔力 / 8 秒",
    "§7定律Ⅲ 水·倒置积云: 15 魔力 / 6 秒",
    "§8潜行+右键: 切换定律(与冷却无关)",
  ],
  innate_2: [
    "§7定律Ⅰ 电: 22 魔力 / 16 秒",
    "§7定律Ⅱ 火: 35 魔力 / 20 秒",
    "§7定律Ⅲ 水: 30 魔力 / 18 秒",
    "§8潜行+右键: 切换定律(与冷却无关)",
  ],
};

/** 技能物品名:定律类型实时显示(重生于当前定律一致) */
export function magusSkillItemName(slot: "innate_1" | "innate_2", law: MagusLaw): string {
  return `§d固有${slot === "innate_1" ? "Ⅰ" : "Ⅱ"}§7·${LAW_COLOR[law]}定律${["Ⅰ", "Ⅱ", "Ⅲ"][law - 1]}(${LAW_ELEMENT[law]})§r`;
}

/** 套装发放钩子(profession.buildSkillItem):按当前定律命名 */
export function magusSkillItemBuild(
  entry: ProfessionSkillEntry,
  session: MatchSession,
  playerId: string,
): { name: string; lore: string[] } | undefined {
  const slot = entry.slot === "innate_1" || entry.slot === "innate_2" ? entry.slot : undefined;
  if (!slot) return undefined;
  return { name: magusSkillItemName(slot, getLaw(session, playerId)), lore: SKILL_LORE[slot] };
}

/** 在背包中重写群法两个技能物品的名称(切换定律/重生后同步) */
function renameLawItems(session: MatchSession, playerId: string, law: MagusLaw): void {
  const player = session.players.get(playerId)?.player;
  if (!player?.isValid) return;
  const container = player.getComponent("minecraft:inventory")?.container;
  if (!container) return;
  try {
    for (const slot of ["innate_1", "innate_2"] as const) {
      for (let i = 0; i < container.size; i++) {
        const item = container.getItem(i);
        if (item?.typeId !== MAGUS_SKILL_ITEMS[slot]) continue;
        item.nameTag = magusSkillItemName(slot, law);
        item.setLore(SKILL_LORE[slot]);
        container.setItem(i, item);
        break;
      }
    }
  } catch (error) {
    console.warn("[SND5] 群法定律物品改名失败", error);
  }
}

/** 潜行+右键的效用动作:切换定律(轮流,与冷却无关),物品名同步 */
function cycleLaw(session: MatchSession, playerId: string): void {
  const player = session.players.get(playerId);
  if (!player?.alive || !player.player.isValid) return;
  const next = ((getLaw(session, playerId) % 3) + 1) as MagusLaw;
  session.skills.privateStore(playerId, LAW_STORE_SKILL).set(LAW_KEY, next);
  renameLawItems(session, playerId, next);
  session.hud.toast(player.player, `§d定律切换 → ${LAW_COLOR[next]}定律${["Ⅰ", "Ⅱ", "Ⅲ"][next - 1]}·${LAW_ELEMENT[next]}§r`);
}

// ── 创生物(盔甲架占位 + 脚本驱动移动) ──────────────────────────

/** 玩家存活且实体有效才结算召唤物伤害 */
function aliveEnemiesInRadius(
  session: MatchSession,
  ownerId: string,
  center: { x: number; y: number; z: number },
  radius: number,
) {
  return session.primitives.enemyPlayersInRadius(ownerId, center, radius);
}

/** 定律Ⅰ 固体雷云:驻场 8 秒,每 0.5 秒 4 格 5 点电伤 + 电离 */
function spawnThunderCloud(
  session: MatchSession,
  ownerId: string,
  center: { x: number; y: number; z: number },
): void {
  session.primitives.spawnSummon("minecraft:armor_stand", center, {
    ownerId,
    lifetimeTicks: 160, // 8 秒
    tickIntervalTicks: 10, // 0.5 秒
    onTick: (cloud) => {
      for (const state of aliveEnemiesInRadius(session, ownerId, cloud.location, 4)) {
        session.combat.dealDamage(ownerId, state.id, {
          hp: 5,
          element: "electric",
          tags: ["skill"],
        });
        session.status.apply(state.id, STATUS_IONIZE, ownerId);
      }
    },
  });
}

/** 球状烈焰爆炸:半径 7 格 15 点火伤 + 焙烧 + 向中心聚拢 2 格 */
function explodeFlameOrb(session: MatchSession, ownerId: string, blast: { x: number; y: number; z: number }): void {
  for (const state of aliveEnemiesInRadius(session, ownerId, blast, 7)) {
    session.combat.dealDamage(ownerId, state.id, {
      hp: 15,
      element: "fire",
      tags: ["skill"],
    });
    session.status.apply(state.id, STATUS_ROAST, ownerId);
    // 向爆炸中心聚拢 2 格(2 格/秒 × 1 秒)
    session.primitives.pull(state.id, blast, { speedBlocksPerSecond: 2, durationTicks: 20 });
  }
  try {
    session.dimension.playSound("mob.blaze.shoot", blast);
  } catch {
    // 音效失败不影响结算
  }
}

/** 定律Ⅱ 球状烈焰:每秒 1 格沿发射方向前移,4 秒后爆炸;撞墙提前引爆 */
function spawnFlameOrb(
  session: MatchSession,
  ownerId: string,
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
): void {
  session.primitives.spawnSummon("minecraft:armor_stand", origin, {
    ownerId,
    lifetimeTicks: 80, // 4 秒
    tickIntervalTicks: 5, // 会话网格:每 5 tick 前移 0.25 格 = 每秒 1 格
    onTick: (orb, instance) => {
      // 撞墙:缩短寿命,下一拍由 onExpire 引爆
      if (session.primitives.raycastBlock(orb.location, direction, 0.4)) {
        instance.expireTick = Math.min(instance.expireTick ?? Infinity, session.nowTick());
        return;
      }
      const step = 0.25;
      orb.teleport({
        x: orb.location.x + direction.x * step,
        y: orb.location.y + direction.y * step,
        z: orb.location.z + direction.z * step,
      });
    },
    onExpire: (instance) => {
      const blast = instance.entity.isValid ? instance.entity.location : origin;
      explodeFlameOrb(session, ownerId, blast);
    },
  });
}

/** 定律Ⅲ 倒置积云:2 秒后每秒 1 格朝施放者移动,6 秒消失;每 0.5 秒跳伤 */
function spawnInvertedCumulus(
  session: MatchSession,
  ownerId: string,
  origin: { x: number; y: number; z: number },
): void {
  session.primitives.spawnSummon("minecraft:armor_stand", origin, {
    ownerId,
    lifetimeTicks: 120, // 6 秒
    tickIntervalTicks: 5,
    onTick: (cloud, instance) => {
      const age = session.nowTick() - instance.spawnTick;
      // 2 秒后开始跟随施放者(每秒 1 格 = 每 5 tick 0.25 格)
      if (age >= 40) {
        const owner = session.players.get(ownerId)?.player;
        if (owner?.isValid) {
          const dx = owner.location.x - cloud.location.x;
          const dy = owner.location.y + 1 - cloud.location.y;
          const dz = owner.location.z - cloud.location.z;
          const len = Math.max(0.001, Math.sqrt(dx * dx + dy * dy + dz * dz));
          const step = Math.min(0.25, len);
          cloud.teleport({
            x: cloud.location.x + (dx / len) * step,
            y: cloud.location.y + (dy / len) * step,
            z: cloud.location.z + (dz / len) * step,
          });
        }
      }
      // 每 0.5 秒:半径 10 格随机 1~5 点水伤 + 浸润;最低伤每秒 +1
      if (age % 10 !== 0) return;
      const minDamage = 1 + Math.floor(age / 20);
      const damage = minDamage + Math.floor(Math.random() * 5);
      for (const state of aliveEnemiesInRadius(session, ownerId, cloud.location, 10)) {
        session.combat.dealDamage(ownerId, state.id, {
          hp: damage,
          element: "water",
          tags: ["skill"],
        });
        session.status.apply(state.id, STATUS_SOAK, ownerId);
      }
    },
  });
}

// ── 固有Ⅰ 定律投掷(snd5:magus_skill_1) ────────────────────────

skillRegistry.register({
  id: "snd5:magus_innate_1",
  displayName: "定律投掷",
  slot: "innate_1",
  // 魔力/冷却随定律变化;hpSubstitute:魔力不足部分用生命值代替(固有Ⅲ)
  manaCost: (ctx) => LAW_MANA_1[getLaw(ctx.session, ctx.casterId)],
  hpSubstitute: true,
  cooldown: (ctx) => LAW_COOLDOWN_1[getLaw(ctx.session, ctx.casterId)],
  maxStacks: 1,
  castMode: "instant",
  failureHint: { no_mana: "魔力/生命不足" },

  cast(ctx) {
    const head = ctx.player.getHeadLocation();
    switch (getLaw(ctx.session, ctx.casterId)) {
      case 1: {
        // 固体雷云:雪球承载投掷(与战士球状闪电同款占位),落地驻场
        const spawned = ctx.primitives.spawnProjectile(
          "minecraft:snowball",
          { x: head.x + ctx.direction.x, y: head.y + ctx.direction.y, z: head.z + ctx.direction.z },
          ctx.direction,
          {
            ownerId: ctx.casterId,
            speedBlocksPerTick: 1.5,
            lifetimeTicks: 100,
            onHitBlock: (location) => spawnThunderCloud(ctx.session, ctx.casterId, location),
            onHitEntity: (targetId) => {
              // 命中实体:雷云落在目标位置(雪球命中后可能已失效)
              const target = ctx.primitives.getEntity(targetId);
              if (target?.isValid) spawnThunderCloud(ctx.session, ctx.casterId, target.location);
            },
          },
        );
        return spawned ? true : false;
      }
      case 2:
        spawnFlameOrb(
          ctx.session,
          ctx.casterId,
          { x: head.x + ctx.direction.x * 1.5, y: head.y + ctx.direction.y * 1.5, z: head.z + ctx.direction.z * 1.5 },
          ctx.direction,
        );
        return true;
      case 3:
        spawnInvertedCumulus(
          ctx.session,
          ctx.casterId,
          { x: head.x + ctx.direction.x * 4, y: head.y + ctx.direction.y * 4, z: head.z + ctx.direction.z * 4 },
        );
        return true;
    }
  },
});

// ── 固有Ⅱ 定律范围(snd5:magus_skill_2) ────────────────────────

/** 距离系数:0(近)~1(远) */
function distanceFactor(center: { x: number; z: number }, location: { x: number; z: number }, radius: number): number {
  const dist = Math.hypot(location.x - center.x, location.z - center.z);
  return Math.min(1, Math.max(0, dist / radius));
}

skillRegistry.register({
  id: "snd5:magus_innate_2",
  displayName: "定律范围",
  slot: "innate_2",
  manaCost: (ctx) => LAW_MANA_2[getLaw(ctx.session, ctx.casterId)],
  hpSubstitute: true,
  cooldown: (ctx) => LAW_COOLDOWN_2[getLaw(ctx.session, ctx.casterId)],
  maxStacks: 1,
  castMode: "instant",
  failureHint: { no_mana: "魔力/生命不足" },

  cast(ctx) {
    const session = ctx.session;
    const location = ctx.player.location;
    const center = { x: location.x, y: location.y, z: location.z };
    const law = getLaw(session, ctx.casterId);

    if (law === 1) {
      // 定律Ⅰ:¼ 圆 8 格,随距离增加的 8~12 点电伤
      for (const state of aliveEnemiesInRadius(session, ctx.casterId, center, 8)) {
        if (horizontalDot(center, ctx.direction, state.player.location) < 0) continue;
        const factor = distanceFactor(center, state.player.location, 8);
        const damage = Math.round(12 - 4 * factor); // 近 12 → 远 8
        session.combat.dealDamage(ctx.casterId, state.id, { hp: damage, element: "electric", tags: ["skill"] });
        if (session.status.has(state.id, STATUS_SOAK)) {
          // 浸润:2 秒内额外 4 次 3 点电伤
          session.primitives.scheduleRepeating(10, 4, () => {
            if (!session.isDead(state.id)) {
              session.combat.dealDamage(ctx.casterId, state.id, {
                hp: 3,
                element: "electric",
                tags: ["skill"],
              });
            }
          });
        }
        if (session.status.has(state.id, STATUS_ROAST)) {
          // 焙烧:额外受到 30% 最大护甲值的护甲伤害
          session.combat.dealDamage(ctx.casterId, state.id, {
            armorPercent: 0.3,
            element: "physical",
            tags: ["skill"],
          });
        }
      }
      return true;
    }

    if (law === 2) {
      // 定律Ⅱ:¼ 圆 8 格,随距离衰减的 7~15 点火伤
      for (const state of aliveEnemiesInRadius(session, ctx.casterId, center, 8)) {
        if (horizontalDot(center, ctx.direction, state.player.location) < 0) continue;
        const factor = distanceFactor(center, state.player.location, 8);
        const damage = Math.round(15 - 8 * factor); // 近 15 → 远 7
        session.combat.dealDamage(ctx.casterId, state.id, { hp: damage, element: "fire", tags: ["skill"] });
        if (session.status.has(state.id, STATUS_IONIZE)) {
          // 电离:额外 12 点伤害并炸飞
          session.combat.dealDamage(ctx.casterId, state.id, { hp: 12, element: "physical", tags: ["skill"] });
          session.primitives.launch(state.id, 0.8);
        }
        if (session.status.has(state.id, STATUS_SOAK)) {
          // 浸润:额外 6 点伤害,2 秒内移速 -20%(缓慢 I 近似)
          session.combat.dealDamage(ctx.casterId, state.id, { hp: 6, element: "physical", tags: ["skill"] });
          session.primitives.applyEffect(state.id, "minecraft:slowness", 40, { amplifier: 1 });
        }
      }
      return true;
    }

    // 定律Ⅲ:半圆 6 格,3 次 4 点水伤(间隔 0.5 秒)
    for (let wave = 0; wave < 3; wave++) {
      session.primitives.schedule(wave * 10, () => {
        const caster = session.players.get(ctx.casterId);
        if (!caster?.alive || !caster.player.isValid) return;
        const waveCenter = caster.player.location;
        for (const state of aliveEnemiesInRadius(session, ctx.casterId, waveCenter, 6)) {
          if (horizontalDot(waveCenter, ctx.direction, state.player.location) < 0) continue;
          session.combat.dealDamage(ctx.casterId, state.id, { hp: 4, element: "water", tags: ["skill"] });
          if (session.status.has(state.id, STATUS_ROAST)) {
            // 焙烧:每次额外 2 点护甲伤害,2 秒内护甲伤害 +50%
            session.combat.dealDamage(ctx.casterId, state.id, {
              armor: 2,
              element: "physical",
              tags: ["skill"],
            });
            session.status.apply(state.id, STATUS_ARMOR_BRITTLE, ctx.casterId);
          }
          if (session.status.has(state.id, STATUS_IONIZE)) {
            // 电离:每次额外 1 点电伤,2 秒内电伤 +10%
            session.combat.dealDamage(ctx.casterId, state.id, {
              hp: 1,
              element: "electric",
              tags: ["skill"],
            });
            session.status.apply(state.id, STATUS_ELECTRIC_FRAGILE, ctx.casterId);
          }
        }
      });
    }
    return true;
  },
});

/** 水平扇形判定:目标方向与施法方向的水平点积(>0 在前方) */
function horizontalDot(
  center: { x: number; z: number },
  direction: { x: number; y: number; z: number },
  location: { x: number; z: number },
): number {
  const dx = location.x - center.x;
  const dz = location.z - center.z;
  const len = Math.max(0.001, Math.hypot(dx, dz));
  const dirLen = Math.max(0.001, Math.hypot(direction.x, direction.z));
  return (dx / len) * (direction.x / dirLen) + (dz / len) * (direction.z / dirLen);
}

// ── 武器「周期」重击(weapon_heavy 伪技能,绑定在自定义武器上) ──

const HEAVY_MANA = 35;
const HEAVY_CHARGE_TICKS = 28; // 1.4 秒(会话 5t 网格量化,见 SkillSystem.tickCharge)
const HEAVY_RADIUS = 6;
const HEAVY_TOTAL_DAMAGE = 40;

skillRegistry.register({
  id: "snd5:magus_heavy",
  displayName: "周期·重击",
  slot: "weapon_heavy",
  manaCost: HEAVY_MANA,
  cooldown: 0, // 无冷却,由蓄力时长自然限频
  castMode: "charge",
  // 蓄满才施放:提前松手继续蓄(minTicks = maxTicks)
  chargeConfig: {
    minTicks: HEAVY_CHARGE_TICKS,
    maxTicks: HEAVY_CHARGE_TICKS,
    tickIntervalTicks: 5,
  },
  // 蓄力期间 ¼ 圆指示器跟随视角
  indicator(ctx) {
    return {
      kind: "sector",
      origin: ctx.player.location,
      direction: { x: ctx.direction.x, z: ctx.direction.z },
      radius: HEAVY_RADIUS,
      angleDegrees: 90,
    };
  },

  // 正常释放:¼ 圆 6 格总量 40 点平均分摊 + 魔力残留
  cast(ctx) {
    const session = ctx.session;
    const center = ctx.player.location;
    const targets = aliveEnemiesInRadius(session, ctx.casterId, center, HEAVY_RADIUS).filter((state) =>
      horizontalDot(center, ctx.direction, state.player.location) > 0,
    );
    if (targets.length === 0) {
      // 未命中:退还魔力,不进冷却
      return { ok: true, refundMana: HEAVY_MANA };
    }
    const perTarget = Math.max(1, Math.round(HEAVY_TOTAL_DAMAGE / targets.length));
    for (const state of targets) {
      session.combat.dealDamage(ctx.casterId, state.id, {
        hp: perTarget,
        element: "physical",
        tags: ["weapon", "melee", "sweep"],
      });
      session.status.apply(state.id, STATUS_MANA_RESIDUE, ctx.casterId);
    }
    session.primitives.showIndicator(
      ctx.casterId,
      { kind: "sector", origin: center, direction: { x: ctx.direction.x, z: ctx.direction.z }, radius: HEAVY_RADIUS, angleDegrees: 90 },
      { durationTicks: 6 },
    );
    return true;
  },

  // 潜行释放:蓄力完成不攻击,获得魔力凝聚(不消耗魔力 → 全额退还)
  castSneaking(ctx) {
    if (!ctx.session.status.has(ctx.casterId, STATUS_MANA_CONDENSE)) {
      ctx.session.status.apply(ctx.casterId, STATUS_MANA_CONDENSE, ctx.casterId);
    }
    ctx.session.hud.toast(ctx.player, "§5魔力凝聚: 下次轻击将进阶");
    return { ok: true, refundMana: HEAVY_MANA };
  },
});

// ── 固有Ⅲ 法力血契(被动;hpSubstitute 标志分布于各技能) ────────

skillRegistry.register({
  id: "snd5:magus_mana_flesh",
  displayName: "法力血契(被动)",
  slot: "passive",
  cooldown: 0,
  // 无独立逻辑:固有Ⅰ/Ⅱ 的 hpSubstitute 已启用生命值代替魔力
});

// ── 自定义物品绑定(组件回调路由) ────────────────────────────────

// 固有Ⅰ/Ⅱ:潜行右键 = 切换定律(效用动作,不进施法流程);
// 普通右键 = 按当前定律施放(组件 onUse → requestCast)
customItemBindings.set(MAGUS_SKILL_ITEMS.innate_1, {
  skillId: "snd5:magus_innate_1",
  onSneakUse: (session, playerId) => cycleLaw(session, playerId),
});
customItemBindings.set(MAGUS_SKILL_ITEMS.innate_2, {
  skillId: "snd5:magus_innate_2",
  onSneakUse: (session, playerId) => cycleLaw(session, playerId),
});
// 武器:长按右键弓式蓄力(重击),潜行释放走 castSneaking
customItemBindings.set(MAGUS_WEAPON_ITEM, { skillId: "snd5:magus_heavy" });
