// ============================================================
// 命中表现(M1 占位版)
//
// M1 只做"能看出打中了"的最小表现:
//   - 受击方动画已经由 Fighter.receiveHit 播了(hit_stand / hit_crouch / guard_hit_*);
//   - 这里补粒子(伤害指示)+ 调用方传入的震屏回调。
//
// M2-a 追加(全部走"逻辑层 + 相机层",不用 /tick freeze、不改世界 tick 速度):
//   - 大招释放时停的白闪;
//   - KO 白闪 + 败者特写机位(内置 minecraft:free 预设,自定义预设本版本不加载)。
// ============================================================

import {
  MolangVariableMap,
  type Player,
  type Vector3,
} from "@minecraft/server";
import {
  ARENA_AXIS,
  ARENA_FLOOR_Y,
  HEAVY_HIT_SHAKE_INTENSITY,
  HIT_SHAKE_INTENSITY,
  KO_CAMERA_DISTANCE,
  KO_FADE_SECONDS,
  SUPER_FREEZE_FADE_SECONDS,
  VFX_ENABLED,
  VFX_KO_POP_RADIUS,
  VFX_KO_POP_STEPS,
  VFX_KO_RISE_FADE_DELAY,
  VFX_KO_RISE_LIFE,
  VFX_KO_RISE_SPEED,
  VFX_KO_RISE_STREAM_SPREAD,
  VFX_KO_RISE_TRIGGER_STEPS,
  VFX_LEGACY_HIT_PARTICLE_CHANCE,
  VFX_MAX_PER_BURST,
  VFX_MIN_INTERVAL_TICKS,
  VFX_POP_HEIGHT_OFFSET,
  VFX_PROJECTILE_FLIGHT_COUNT,
  VFX_PROJECTILE_GATHER_COUNT,
  VFX_PROJECTILE_RANGE,
  VFX_PROJECTILE_SPEED,
  VFX_SUPER_GATHER_STEPS,
  VFX_SUPER_HIT_LIFE,
  VFX_SUPER_HIT_SPEED,
  VFX_SUPER_HIT_STEPS,
  VFX_SUPER_LIFE,
  VFX_SUPER_SPEED,
} from "./combat-config";
import { currentTick } from "./tick";
import type { Fighter, HitInfo } from "./fighter";
import { currentClip } from "./anim";
import { bodyPoint, type HandOwner } from "./props";

/** 命中粒子模板:共享一个实例,避免每 tick 构造 */
const HIT_PARTICLE = "minecraft:critical_hit_emitter";
const GUARD_PARTICLE = "minecraft:basic_crit_particle";

/** 叶流粒子 identifier —— 与资源包内定义**必须逐字一致** */
const LEAF_END = "green_beret:leaf_end";
const LEAF_FLIGHT = "green_beret:leaf_flight";
const LEAF_GATHER = "green_beret:leaf_gather";
const LEAF_MOBILITY = "green_beret:leaf_mobility";
const LEAF_RISE_STREAM = "green_beret:leaf_rise_stream";
const PEARL_POP = "green_beret:pearl_pop";

/** Small paired departure/arrival clouds; no translucent duplicate model. */
export function applyTeleportBurst(fighter: Fighter, at: Vector3, edge: "leave" | "arrive"): void {
  emit(fighter.dimension, [{id:"minecraft:mob_portal",at:{...at,y:at.y+1.1},variables:{}}],
    `${fighter.dimension.id}:${fighter.side}:blink:${edge}:`);
  emit(fighter.dimension, [{id:PEARL_POP,at:{...at,y:at.y+0.25},variables:{}}],
    `${fighter.dimension.id}:${fighter.side}:pearl:${edge}:`);
}

export type ShakeFn = (playerId: string, intensity: number) => void;

/** 一组命中的表现总入口;由 Match.onHit 调用 */
export function applyHitPresentation(hit: HitInfo, shake: ShakeFn): void {
  spawnHitParticles(hit);
  spawnHitBurst(hit);
  const heavy = hit.skill === 3 || hit.skill === 4 || hit.skill === 6;
  const base = hit.blocked
    ? HIT_SHAKE_INTENSITY * 0.4
    : heavy
      ? HEAVY_HIT_SHAKE_INTENSITY
      : HIT_SHAKE_INTENSITY;
  // 击倒(投技摔倒 / 连击打满)再加一档:这是本作最重的命中反馈
  const intensity = hit.knockdown ? Math.min(4, base * 1.6) : base;
  try {
    // 攻守双方视角都给反馈(双方都在看同一个侧视画面)
    shake(hit.attacker.player.id, intensity);
    shake(hit.victim.player.id, intensity * 0.7);
  } catch {
    // 震屏失败不影响伤害结算
  }
}

function spawnHitParticles(hit: HitInfo): void {
  try {
    // 原版 critical 粒子退成"偶尔出现"的小点缀:叶流命中已经接管主要反馈,
    // 两套同时出现会很花。概率由 VFX_LEGACY_HIT_PARTICLE_CHANCE 控制(0 = 不再出现)。
    if (Math.random() > VFX_LEGACY_HIT_PARTICLE_CHANCE) return;
    const entity = hit.victim.entity;
    if (!entity || !entity.isValid) return;
    const location = {
      x: entity.location.x,
      y: entity.location.y + 1.3,
      z: entity.location.z,
    };
    const dimension = entity.dimension;
    const variables=new MolangVariableMap();
    variables.setVector3("variable.direction",{x:0,y:0.1,z:0});
    dimension.spawnParticle(
      hit.blocked ? GUARD_PARTICLE : HIT_PARTICLE,
      location,
      variables,
    );
  } catch {
    // 粒子是纯表现:失败就静默
  }
}

/** M1 占位:hitstop 尚未启用;保留接口让 M2 填 */
export function hitStopUntil(ticks: number): number {
  return currentTick() + Math.max(0, ticks);
}

// ============================================================
// 叶流粒子表现(VFX)
//
// 素材:角色源资产 Leaf_RP 的 7 个粒子定义(identifier 保持原样,不改):
//   leaf_end / leaf_flight / leaf_gather / leaf_mobility / leaf_pearl /
//   leaf_rise_stream / pearl_pop,贴图 textures/particle/{leaf,ender_pearl}.png。
//
// 设计约束(见 combat-config 的四之五):
//   1) 全部发射走 emit():**唯一**一处调 dimension.spawnParticle,
//      便于整体开关(VFX_ENABLED)、限流与排查;
//   2) 按 identifier 记录"上一次触发 tick",两次触发间隔 < VFX_MIN_INTERVAL_TICKS
//      直接丢弃 → 防止逐 tick 刷屏;
//   3) 单次触发总微粒数不超过 VFX_MAX_PER_BURST(每次 emit 消耗该粒子定义的
//      num_particles;预算用尽就停,不是"少撒几个");
//   4) 整段 try/catch:粒子失败绝不影响伤害与回合结算。
//
// ⚠️ 所有调用点都必须落在 system.runInterval / system.run 回调链内
//    (Match.tick 与 Match.cleanup 都由 game.ts 的 runInterval 驱动)。
// ============================================================

/** identifier → 该粒子定义单次触发的微粒数(与资源包 JSON 的 emitter_rate_instant 一致) */
const VFX_PARTICLE_COSTS: Readonly<Record<string, number>> = {
  [LEAF_END]: 28,
  [LEAF_FLIGHT]: 56,
  [LEAF_GATHER]: 6,
  [LEAF_MOBILITY]: 18,
  [LEAF_RISE_STREAM]: 18,
  [PEARL_POP]: 8,
};

/** 粒子预算上限的保守回退值(未登记的 identifier 用) */
const VFX_DEFAULT_COST = 8;

/** identifier → 上一次触发 tick(VFX_MIN_INTERVAL_TICKS 节流用) */
const vfxLastTick = new Map<string, number>();
/** 当前 tick 已撒出的微粒总数 + 所属 tick(VFX_MAX_PER_BURST 限量用) */
const vfxBudget = { tick: -1, used: 0 };

/** 一次发射的数据。vectors 里的键名必须是完整的 "variable.xxx" */
export interface VfxEmission {
  /** identifier,如 green_beret:leaf_end */
  id: string;
  /** 世界坐标(方块角) */
  at: Vector3;
  /** Molang 变量表 */
  variables: Record<string, number | Vector3>;
}

/**
 * 粒子发射的唯一出口。
 *
 * @param dimension 目标维度(通常取施法者/受击者实体的 dimension)
 * @param emissions 本次触发要撒的粒子;**按 VFX_MAX_PER_BURST 限量**,超预算的条目直接跳过
 *
 * 同 tick 内多次调用是"先到先得":前一次把预算用光,后面的条目就整条跳过
 * (不是少撒几个 —— 半截的粒子爆发比没有更难看)。
 */
export function emit(
  dimension: { spawnParticle: (id: string, at: Vector3, molang: MolangVariableMap) => void } | undefined,
  emissions: VfxEmission[],
  scope = "",
): void {
  if (!VFX_ENABLED || !dimension || emissions.length === 0) return;
  try {
    const now = currentTick();
    // 跨 tick 自动重置预算(不依赖清理钩子,所以没有"忘记 reset"的漏法)
    if (vfxBudget.tick !== now) {
      vfxBudget.tick = now;
      vfxBudget.used = 0;
    }
    for (const item of emissions) {
      const cost = VFX_PARTICLE_COSTS[item.id] ?? VFX_DEFAULT_COST;
      const throttleKey = scope + item.id;
      const last = vfxLastTick.get(throttleKey);
      if (last !== undefined && now - last < VFX_MIN_INTERVAL_TICKS) continue;
      if (vfxBudget.used + cost > VFX_MAX_PER_BURST) continue;
      const molang = new MolangVariableMap();
      for (const [name, value] of Object.entries(item.variables)) {
        if (typeof value === "number") molang.setFloat(name, value);
        else molang.setVector3(name, value);
      }
      dimension.spawnParticle(item.id, item.at, molang);
      vfxLastTick.set(throttleKey, now);
      vfxBudget.used += cost;
    }
  } catch {
    // 粒子是纯表现:任何失败都静默(内容日志里能看到引擎侧的 identifier/贴图报错)
  }
}

/** 调试/验收用:清空节流与预算记录(可重复调用,失效也安全) */
export function resetVfxThrottle(): void {
  try {
    vfxLastTick.clear();
    vfxBudget.tick = -1;
    vfxBudget.used = 0;
  } catch {
    // 忽略
  }
}

// ---- 向量工具(叶流粒子全部以"竞技场水平面"为参考系) ----

/** 水平单位向量(退化时回退 +x) */
function normalizeHorizontal(x: number, z: number): Vector3 {
  const len = Math.hypot(x, z);
  if (!Number.isFinite(len) || len < 1e-4) return { x: 1, y: 0, z: 0 };
  return { x: x / len, y: 0, z: z / len };
}

/**
 * 水平右手向量:把 dir 绕 y 轴逆时针转 90°。
 *
 * 必须与 dir **正交且等长**,因为 leaf_end / leaf_flight / leaf_gather 的
 * 环形散射半径是 `variable.right * cos(θ) + variable.dir * sin(θ)` ——
 * dir 与 right 不正交会让圆环退化成椭圆(方向偏的那一侧明显更密)。
 * 传入单位向量即可。
 */
function rightUnit(dir: Vector3): Vector3 {
  return { x: -dir.z, y: 0, z: dir.x };
}

/** 以 angleDeg 角度采样一个水平方向单位向量(dir 为 0°,right 为 90°) */
function directionAt(dir: Vector3, right: Vector3, angleDeg: number): Vector3 {
  const rad = (angleDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return {
    x: dir.x * c + right.x * s,
    y: 0,
    z: dir.z * c + right.z * s,
  };
}

/** 沿 dir/right 展开的方位角(pearl_pop 的均匀环) */
function angleDegFor(index: number, total: number): number {
  return (360 * index) / Math.max(1, total);
}

/**
 * 两点的水平单位向量(**由施法者指向受击者**,而不是施法者的朝向)。
 * 粒子要"朝着对手飞",用朝向在侧视下会飞向画外。
 */
function horizontalDirBetween(from: Vector3, to: Vector3): Vector3 {
  return normalizeHorizontal(to.x - from.x, to.z - from.z);
}

/** 角色身上的发射高度 */
const HIT_PARTICLE_HEIGHT = 1.3;
const CAST_PARTICLE_HEIGHT = 1.0;
const GROUND_PARTICLE_OFFSET = 0.15;

/** 判定"这招算不算重":重攻击 / 投技 / 大招 —— 决定命中粒子的份量 */
function heavySkill(slot: HitInfo["skill"]): boolean {
  return slot === 3 || slot === 4 || slot === 6;
}

// ---- 各时机的最小发射量构造 ----

/**
 * 命中瞬间的粒子构造。
 *
 * 份量按"招式轻重"分级(不改任何数值,只是视觉区分):
 *   轻/中(slot 1/2)   → leaf_end ×1(+ 概率性 pearl_pop)
 *   重/投/大(3/4/6)   → leaf_end ×2 + pearl_pop(必定)
 *   被防御(blocked)    → 不出 leaf_end,只出小颗 pearl_pop(与"没打进去"一致)
 */
function buildHitEmissions(hit: HitInfo, at: Vector3): VfxEmission[] {
  const victim = hit.victim.entity;
  const attacker = hit.attacker.entity;
  const dir =
    victim && attacker
      ? horizontalDirBetween(attacker.location, victim.location)
      : { x: 1, y: 0, z: 0 };
  const right = rightUnit(dir);
  const heavy = heavySkill(hit.skill);
  const emissions: VfxEmission[] = [];
  if (!hit.blocked) {
    const leafCount = heavy ? 2 : 1;
    for (let i = 0; i < leafCount; i += 1) {
      emissions.push({
        id: LEAF_END,
        at,
        variables: {
          "variable.dir": directionAt(dir, right, angleDegFor(i, leafCount)),
          "variable.right": right,
        },
      });
    }
  }
  // 相消弹珠:重击必定出,轻击只是概率出的点缀。
  // 高度比叶流爆点略低(VFX_POP_HEIGHT_OFFSET),两层粒子才不会糊成一团。
  if (heavy || hit.blocked || Math.random() < 0.5) {
    emissions.push({
      id: PEARL_POP,
      at: { x: at.x, y: at.y - VFX_POP_HEIGHT_OFFSET, z: at.z },
      variables: {},
    });
  }
  return emissions;
}

/** 命中:轻/中 → leaf_end;重/投/大 → leaf_end ×2 + pearl_pop;防御 → 小的 pearl_pop */
function spawnHitBurst(hit: HitInfo): void {
  try {
    const entity = hit.victim.entity;
    if (!entity || !entity.isValid) return;
    const at = {
      x: entity.location.x,
      y: entity.location.y + HIT_PARTICLE_HEIGHT,
      z: entity.location.z,
    };
    emit(entity.dimension, buildHitEmissions(hit, at));
  } catch {
    // 忽略
  }
}

/**
 * 发波(slot 5)释放:朝**对手方向**撒 leaf_flight(飞行叶流)+ 脚下 leaf_gather(聚气)。
 * 飞行粒子的初速度由 variable.speed 给出,寿命 = variable.range / variable.speed
 * —— 两者都不设时寿命为 0,粒子会瞬间消失(见交付说明的"依赖 variable"表)。
 */
export function applyProjectileBurst(
  caster: Fighter,
  opponent: Fighter | undefined,
  rangeOverride?: number,
): void {
  try {
    const entity = caster.entity;
    if (!entity || !entity.isValid) return;
    if (currentClip(entity) !== "special_leaf_burst") return;
    const from = entity.location;
    const dir=ARENA_AXIS==="x" ? {x:caster.facing,y:0,z:0} : {x:0,y:0,z:caster.facing};
    const right = rightUnit(dir);
    // 站立波是一次性粒子，Script API 没有按实例销毁粒子的接口；把寿命
    // 绑定到释放时目标的水平距离，使它在目标处自然结束。目标跳起时也会
    // 在其当前位置附近消散，命中防御时不会继续穿过角色。
    const targetRange = Number.isFinite(rangeOverride)
      ? Math.max(0.8, Math.min(VFX_PROJECTILE_RANGE, rangeOverride as number))
      : opponent?.isValid
        ? Math.max(0.8, Math.min(VFX_PROJECTILE_RANGE, caster.distanceTo(opponent)))
        : VFX_PROJECTILE_RANGE;
    const emissions: VfxEmission[] = [];
    const steps = Math.max(1, VFX_PROJECTILE_FLIGHT_COUNT);
    for (let i = 0; i < steps; i += 1) {
      emissions.push({
        id: LEAF_FLIGHT,
        at: {
          x: from.x,
          y: from.y + CAST_PARTICLE_HEIGHT,
          z: from.z,
        },
        variables: {
          // 方向:环上采样,但整体指向对手,形成"扇形叶流"而不是一根棍
          "variable.dir": directionAt(dir, right, -10 + 20*i/Math.max(1,steps-1)),
          "variable.right": right,
          "variable.speed": VFX_PROJECTILE_SPEED,
          "variable.range": targetRange,
        },
      });
    }
    const gatherSteps = Math.max(1, VFX_PROJECTILE_GATHER_COUNT);
    for (let i = 0; i < gatherSteps; i += 1) {
      emissions.push({
        id: LEAF_GATHER,
        at: {
          x: from.x,
          y: from.y + GROUND_PARTICLE_OFFSET,
          z: from.z,
        },
        variables: {
          "variable.dir": { x: 0, y: 1, z: 0 },
          "variable.right": right,
        },
      });
    }
    // 用施法侧隔离同 tick 的两枚对向波，否则全局节流会让第二侧的
    // leaf_flight 被第一侧吞掉，视觉上像只有一方发波。
    emit(entity.dimension, emissions, `${entity.dimension.id}:wave:${caster.side}:`);
  } catch {
    // 忽略
  }
}

/** 位移叶流使用本 tick 实际位移，包含朝向、重力和场边截断。 */
export function applyLeafMobilityTrail(caster: Fighter, from: Vector3): void {
  try {
    const clip = currentClip(caster.entity);
    const rise = clip === "leaf_rise_loop";
    if (!rise && clip !== "leaf_dive_loop") return;
    const to = caster.location;
    const motion = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    const length = Math.hypot(motion.x, motion.y, motion.z);
    if (length < 0.0001 || (rise ? motion.y <= 0 : motion.y >= 0)) return;
    const dir = { x: motion.x / length, y: motion.y / length, z: motion.z / length };
    const forward = ARENA_AXIS === "x" ? { x: caster.facing, y: 0, z: 0 } : { x: 0, y: 0, z: caster.facing };
    const at = { ...from, y: from.y + 0.7 };
    let speed = length * 20;
    let life = 0.22;
    if (rise) {
      // 沿运动轨迹反投到地面，持续从地面补叶流，覆盖脚下到上升前沿。
      const reach = Math.max(0, to.y + 0.7 - ARENA_FLOOR_Y - GROUND_PARTICLE_OFFSET) / dir.y;
      at.x = to.x - dir.x * reach;
      at.y = ARENA_FLOOR_Y + GROUND_PARTICLE_OFFSET;
      at.z = to.z - dir.z * reach;
      speed = Math.max(speed, reach / 0.3);
      life = (reach + 0.35) / speed;
    } else {
      // 俯冲叶片到地面即退场，不穿地继续飞。
      life = Math.min(life, (at.y - ARENA_FLOOR_Y) / (-dir.y * speed));
    }
    emit(caster.dimension, [{
      id: rise ? LEAF_RISE_STREAM : LEAF_MOBILITY,
      at,
      variables: {
        "variable.dir": dir,
        "variable.right": rightUnit(forward),
        "variable.speed": speed,
        "variable.life": life,
        "variable.fade_delay": Math.max(0, life - 0.12),
      },
    }], `${caster.dimension.id}:${caster.side}:leaf:`);
  } catch {
    // 粒子失败不影响位移与命中。
  }
}

/** 两枚站立叶波在空中相遇时的相消反馈。逻辑层会同时销毁双方波状态，
 * 这里补一个小型叶片/珍珠爆点，让玩家能看出是相互抵消而不是漏判。 */
export function applyWaveClash(
  caster: Fighter,
  opponent: Fighter,
  at: Vector3,
): void {
  try {
    const dir = horizontalDirBetween(caster.entity!.location, opponent.entity!.location);
    const reverse = { x: -dir.x, y: 0, z: -dir.z };
    const right = rightUnit(dir);
    const reverseRight = rightUnit(reverse);
    const clashAt = { ...at, y: at.y + CAST_PARTICLE_HEIGHT };
    // Script API 无法回收已生成的粒子，所以对向波的飞行寿命会在
    // 相遇点自然结束；这里再补两道相反方向的 leaf_end，明确表现为
    // 双方同时撞击，并用一个 pearl_pop 收束碰撞点。
    emit(caster.dimension, [{ id: LEAF_END, at: clashAt, variables: {
      "variable.dir": dir,
      "variable.right": right,
    } }], `${caster.dimension.id}:wave-clash:${caster.side}:`);
    emit(caster.dimension, [{ id: LEAF_END, at: clashAt, variables: {
      "variable.dir": reverse,
      "variable.right": reverseRight,
    } }], `${caster.dimension.id}:wave-clash:${opponent.side}:`);
    emit(caster.dimension, [{ id: PEARL_POP, at: clashAt, variables: {} }], `${caster.dimension.id}:wave-clash:pop:`);
  } catch {
    // 纯表现失败不影响相消逻辑。
  }
}

/** 一/二气时停期间重复补一小圈聚气叶流，保证“双方停住、施法者蓄气”的
 * 观感在 0.4 秒窗口内持续可见，而不是只在按键瞬间闪一下。 */
export function applySuperFreezeAura(caster: Fighter, opponent: Fighter | undefined): void {
  try {
    const entity = caster.entity;
    if (!entity || !entity.isValid) return;
    const at = entity.location;
    const dir = opponent?.entity?.isValid
      ? horizontalDirBetween(at, opponent.entity.location)
      : { x: 1, y: 0, z: 0 };
    const right = rightUnit(dir);
    emit(entity.dimension, [
      { id: LEAF_GATHER, at: { x: at.x, y: at.y + GROUND_PARTICLE_OFFSET, z: at.z }, variables: {
        "variable.dir": { x: 0, y: 1, z: 0 },
        "variable.right": right,
      } },
      { id: LEAF_RISE_STREAM, at: { x: at.x, y: at.y + GROUND_PARTICLE_OFFSET, z: at.z }, variables: {
        "variable.dir": { x: dir.x * 0.25, y: 0.97, z: dir.z * 0.25 },
        "variable.right": right,
        "variable.speed": VFX_SUPER_SPEED,
        "variable.life": VFX_SUPER_LIFE,
        "variable.fade_delay": 0,
      } },
    ], `${entity.dimension.id}:super-freeze:${caster.side}:`);
  } catch {
    // 纯表现失败不影响时停与命中。
  }
}

/**
 * 大招(slot 6)释放 / 三气每一段起播:施法者脚下聚气(leaf_gather)
 * + 沿竞技场轴向上卷起的叶流(leaf_rise_stream)。
 */
export function applySuperCastBurst(caster: Fighter, opponent: Fighter | undefined): void {
  try {
    const entity = caster.entity;
    if (!entity || !entity.isValid) return;
    const at = entity.location;
    const dir = opponent?.entity?.isValid
      ? horizontalDirBetween(at, opponent.entity.location)
      : { x: 1, y: 0, z: 0 };
    const right = rightUnit(dir);
    const emissions: VfxEmission[] = [];
    const gatherSteps = Math.max(1, VFX_SUPER_GATHER_STEPS);
    for (let i = 0; i < gatherSteps; i += 1) {
      emissions.push({
        id: LEAF_GATHER,
        at: {
          x: at.x,
          y: at.y + GROUND_PARTICLE_OFFSET,
          z: at.z,
        },
        variables: {
          "variable.dir": { x: 0, y: 1, z: 0 },
          "variable.right": right,
        },
      });
    }
    for (let i = 0; i < 2; i += 1) {
      emissions.push({
        id: LEAF_RISE_STREAM,
        at: {
          x: at.x,
          y: at.y + GROUND_PARTICLE_OFFSET,
          z: at.z,
        },
        variables: {
          "variable.dir": directionAt(dir, right, angleDegFor(i, 2) * 0.25),
          "variable.right": right,
          "variable.speed": VFX_SUPER_SPEED,
          "variable.life": VFX_SUPER_LIFE,
          "variable.fade_delay": 0,
        },
      });
    }
    emit(entity.dimension, emissions);
  } catch {
    // 忽略
  }
}

/**
 * 大招命中(含三气每一段的配对受击段):受击者身上的叶流爆发
 * + 归位的叶流上冲(leaf_mobility)。
 */
export function applySuperHitBurst(victim: Fighter, attacker: Fighter | undefined): void {
  try {
    const entity = victim.entity;
    if (!entity || !entity.isValid) return;
    const at = entity.location;
    const dir = attacker?.entity?.isValid
      ? horizontalDirBetween(attacker.entity.location, at)
      : { x: 1, y: 0, z: 0 };
    const right = rightUnit(dir);
    const emissions: VfxEmission[] = [];
    const endSteps = Math.max(1, VFX_SUPER_HIT_STEPS);
    for (let i = 0; i < endSteps; i += 1) {
      emissions.push({
        id: LEAF_END,
        at: {
          x: at.x,
          y: at.y + HIT_PARTICLE_HEIGHT,
          z: at.z,
        },
        variables: {
          "variable.dir": dir,
          "variable.right": right,
        },
      });
    }
    emissions.push({ id: PEARL_POP, at: { x: at.x, y: at.y + HIT_PARTICLE_HEIGHT, z: at.z }, variables: {} });
    for (let i = 0; i < 2; i += 1) {
      emissions.push({
        id: LEAF_MOBILITY,
        at: { x: at.x, y: at.y + GROUND_PARTICLE_OFFSET, z: at.z },
        variables: {
          "variable.dir": directionAt(dir, right, angleDegFor(i, 2) * 0.5),
          "variable.right": right,
          "variable.speed": VFX_SUPER_HIT_SPEED,
          "variable.life": VFX_SUPER_HIT_LIFE,
        },
      });
    }
    emit(entity.dimension, emissions);
  } catch {
    // 忽略
  }
}

/**
 * KO 特写那一刻:败者身上的 pearl_pop 环 + 叶流上冲。
 * 只补视觉冲击,不参与任何结算。
 */
export function applyKoBurst(loser: Fighter, winner: Fighter | undefined): void {
  try {
    const entity = loser.entity;
    if (!entity || !entity.isValid) return;
    const at = entity.location;
    const dir = winner?.entity?.isValid
      ? horizontalDirBetween(winner.entity.location, at)
      : { x: 1, y: 0, z: 0 };
    const right = rightUnit(dir);
    const emissions: VfxEmission[] = [];
    const popSteps = Math.max(1, VFX_KO_POP_STEPS);
    for (let i = 0; i < popSteps; i += 1) {
      const angle = angleDegFor(i, popSteps);
      const rad = (angle * Math.PI) / 180;
      emissions.push({
        id: PEARL_POP,
        at: {
          x: at.x + Math.cos(rad) * VFX_KO_POP_RADIUS,
          y: at.y + HIT_PARTICLE_HEIGHT + Math.sin(rad) * VFX_KO_POP_RADIUS,
          z: at.z,
        },
        variables: {},
      });
    }
    const riseSteps = Math.max(1, VFX_KO_RISE_TRIGGER_STEPS);
    for (let i = 0; i < riseSteps; i += 1) {
      const angle = angleDegFor(i, riseSteps);
      const rad = (angle * Math.PI) / 180;
      emissions.push({
        id: LEAF_RISE_STREAM,
        at: {
          x: at.x + Math.cos(rad) * VFX_KO_RISE_STREAM_SPREAD,
          y: at.y + GROUND_PARTICLE_OFFSET,
          z: at.z + Math.sin(rad) * VFX_KO_RISE_STREAM_SPREAD,
        },
        variables: {
          "variable.dir": { x: 0, y: 1, z: 0 },
          "variable.right": right,
          "variable.speed": VFX_KO_RISE_SPEED,
          "variable.life": VFX_KO_RISE_LIFE,
          "variable.fade_delay": VFX_KO_RISE_FADE_DELAY,
        },
      });
    }
    emit(entity.dimension, emissions);
  } catch {
    // 忽略
  }
}

// ============================================================
// M2-a 表现:白闪 / 大招释放时停 / KO 特写运镜
// 全部是纯表现:任何一步失败都静默,绝不影响伤害与回合结算。
// ============================================================

/** 全屏白闪(淡入很快、hold 极短、淡出由调用方给) */
function whiteFlash(player: Player, fadeOutSeconds: number): void {
  try {
    if (!player.isValid) return;
    player.camera.fade({
      fadeColor: { red: 255, green: 255, blue: 255 },
      fadeTime: {
        fadeInTime: 0.02,
        holdTime: 0.03,
        fadeOutTime: Math.max(0.01, fadeOutSeconds),
      },
    });
  } catch {
    // 表现失败:静默
  }
}

/** 大招(一/二气)释放瞬间的白闪 */
export function applySuperFreezeFlash(player: Player): void {
  whiteFlash(player, SUPER_FREEZE_FADE_SECONDS);
}

/** KO 瞬间的白闪 */
export function applyKoFlash(player: Player): void {
  whiteFlash(player, KO_FADE_SECONDS);
}

/** 沿竞技场轴向的单位分量 */
function axisUnit(axis: "x" | "z"): Vector3 {
  return axis === "x" ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
}

/** 垂直于竞技场轴的单位分量(相机侧视方向) */
function perpUnit(axis: "x" | "z"): Vector3 {
  return axis === "x" ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
}

export interface KoCameraOptions {
  /** 竞技场轴 */
  axis: "x" | "z";
  /** 相机在中垂线的哪一侧(与 SideCamera 共用 CAMERA_SIDE 常量) */
  side: 1 | -1;
  /** 败者:机位围绕他摆 */
  victim: HandOwner;
  /** 胜者(可选):用来把镜头略微拉向两人之间,构图更全 */
  winner?: HandOwner;
}

/** Frame the animated head/torso rather than the entity foot anchor. */
export function koCameraFrame(options: KoCameraOptions): {pos:Vector3; focus:Vector3; fov:number} {
  const owners = options.winner ? [options.victim,options.winner] : [options.victim];
  const points = owners.flatMap(owner => [bodyPoint(owner,"head"),bodyPoint(owner,"torso")]);
  const focus = {x:0,y:0,z:0};
  for(const p of points) { focus.x+=p.x/points.length; focus.y+=p.y/points.length; focus.z+=p.z/points.length; }
  const extent = Math.max(...points.map(p=>Math.hypot(p.x-focus.x,p.y-focus.y,p.z-focus.z)));
  const fov = 48;
  const distance = Math.max(KO_CAMERA_DISTANCE, (extent+0.7)/Math.sin(fov*Math.PI/360));
  const a=axisUnit(options.axis), p=perpUnit(options.axis);
  return {focus,fov,pos:{x:focus.x+distance*(p.x*options.side+a.x*0.22),y:Math.max(ARENA_FLOOR_Y+1.1,focus.y+0.45),z:focus.z+distance*(p.z*options.side+a.z*0.22)}};
}
