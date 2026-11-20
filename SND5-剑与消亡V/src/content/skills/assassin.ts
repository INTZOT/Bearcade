// ============================================================
// 刺客技能(内容设计 PDF 第 5-6 页)
// - 武器「横刀·离心」(自定义物品):
//   轻击 10 点近战(professions/assassin.ts handleAttack);
//   重击 = weapon_heavy 伪技能(长按右键弓式蓄力 0.5s):半径 3 格
//   半圆 18 点伤害,额外击碎目标 20% 护甲上限。
// - 固有Ⅰ 抓钩:方案迁移为 Grappling Hooks Add-On 普通钩爪(2026-11-19):
//   右键发射(脚本速度 60 格/秒)→ 命中方块锁定 → 钟摆摆荡
//   (自定义重力/阻尼/绳张力,速度经 setVelocity→applyKnockback 施加);
//   潜行按住收绳拉自己,潜行+右键松开,飞行中右键移除重射;
//   命中玩家保留 PDF 效果(7 点 + 牵拉 2 秒 + 撕裂);物理跑全局 1t 循环。
// - 固有Ⅱ 定锚:雪球投掷(原版雪球承载抛物线与碰撞,命中/落地后转
//   盔甲架驻场),命中敌方停在原地并造成 5 点伤害 + 撕裂(不进冷却);
//   定锚驻场 6 秒后消失 → 9 秒冷却;再次点击 → 瞬移到定锚位置,以自身
//   为中心半径 3 格半圆 30 点伤害,额外击碎 40% 护甲上限,销毁定锚
//   → 18 秒冷却。
// - 固有Ⅲ 影遁(被动):使用技能后获得迅捷Ⅰ与隐身 1 秒,8 秒冷却。
// ============================================================
import { customItemBindings, normalizeVector, skillRegistry } from "../../framework";
import type { CastContext, MatchSession, PlayerState } from "../../framework";
import type { Vec3 } from "../../../../shared/minigame-core/types";
import { STATUS_INERTIA, STATUS_LACERATION } from "../statuses/assassin";

// ── 自定义物品 ──────────────────────────────────────────────────

export const ASSASSIN_WEAPON_ITEM = "snd5:assassin_weapon";
export const ASSASSIN_SKILL_ITEMS: Record<"innate_1" | "innate_2", string> = {
  innate_1: "snd5:assassin_skill_1",
  innate_2: "snd5:assassin_skill_2",
};

// ── 公共工具 ─────────────────────────────────────────────────────

/** 半圆(180°)敌方扇形过滤器 */
function enemyOf(session: MatchSession, casterId: string) {
  const casterTeam = session.teams.getTeam(casterId);
  return (state: PlayerState): boolean =>
    state.id !== casterId && session.teams.getTeam(state.id) !== casterTeam;
}

/**
 * 步进路径命中:敌方身体中心(脚部 +0.9)与「from → from+dir*length」
 * 线段的距离小于 radius 即命中,返回最近者(盔甲架占位投射物的
 * 敌方判定 —— 原版 projectileHitEntity 事件不覆盖盔甲架)。
 */
function enemyAlongStep(
  session: MatchSession,
  ownerId: string,
  from: Vec3,
  direction: { x: number; y: number; z: number },
  length: number,
  radius: number,
): PlayerState | undefined {
  const dir = normalizeVector(direction);
  let best: PlayerState | undefined;
  let bestDist = radius;
  for (const state of session.primitives.enemyPlayersInRadius(ownerId, from, length + radius)) {
    const loc = state.player.location;
    const px = loc.x - from.x;
    const py = loc.y + 0.9 - from.y;
    const pz = loc.z - from.z;
    const t = Math.max(0, Math.min(length, px * dir.x + py * dir.y + pz * dir.z));
    const dx = px - dir.x * t;
    const dy = py - dir.y * t;
    const dz = pz - dir.z * t;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist <= bestDist) {
      best = state;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * 惯性消耗:下一次武器攻击(轻击/重击)结算时调用。
 * 1/2/3 层 → 伤害 ×1.10/1.15/1.20;4 层 → 伤害 ×1.20(取 3 层档,
 * PDF 未给 4 层加成数值)并附加撕裂;消耗后清空全部层数。
 * 仅武器攻击消耗,技能伤害不触发(PDF「下一次攻击」的约定)。
 */
export interface InertiaConsume {
  damageMul: number;
  applyLaceration: boolean;
}

export function consumeInertia(session: MatchSession, attackerId: string): InertiaConsume {
  const stacks = session.status.getStacks(attackerId, STATUS_INERTIA);
  if (stacks <= 0) return { damageMul: 1, applyLaceration: false };
  const mul = stacks >= 3 ? 1.2 : stacks === 2 ? 1.15 : 1.1;
  const applyLaceration = stacks >= 4;
  session.status.remove(attackerId, STATUS_INERTIA, "consumed");
  return { damageMul: mul, applyLaceration };
}

/** 惯性消耗反馈(actionbar);轻击/重击两处结算共用 */
export function toastInertia(session: MatchSession, playerId: string, inertia: InertiaConsume): void {
  if (inertia.damageMul === 1) return;
  const player = session.players.get(playerId)?.player;
  if (!player?.isValid) return;
  const percent = Math.round((inertia.damageMul - 1) * 100);
  const extra = inertia.applyLaceration ? " + 撕裂" : "";
  session.hud.toast(player, `§7惯性: 伤害 +${percent}%${extra}`);
}

// ── 武器重击(weapon_heavy 伪技能,绑定在自定义武器上) ────────────

const HEAVY_CHARGE_TICKS = 10; // 0.5 秒(会话 5t 网格量化)
const HEAVY_RADIUS = 3;
const HEAVY_ANGLE = 180; // 半圆
const HEAVY_DAMAGE = 18;
/** 额外击碎护甲上限 20% */
const HEAVY_ARMOR_BREAK_PERCENT = 0.2;

skillRegistry.register({
  id: "snd5:assassin_heavy",
  displayName: "离心·重击",
  slot: "weapon_heavy",
  cooldown: 0, // 无冷却,由蓄力时长自然限频
  castMode: "charge",
  // 蓄满才施放:提前松手继续蓄(minTicks = maxTicks)
  chargeConfig: {
    minTicks: HEAVY_CHARGE_TICKS,
    maxTicks: HEAVY_CHARGE_TICKS,
    tickIntervalTicks: 5,
  },
  // 蓄力期间半圆指示器跟随视角
  indicator(ctx) {
    return {
      kind: "sector",
      origin: ctx.player.location,
      direction: { x: ctx.direction.x, z: ctx.direction.z },
      radius: HEAVY_RADIUS,
      angleDegrees: HEAVY_ANGLE,
    };
  },

  cast(ctx) {
    const session = ctx.session;
    const center = { x: ctx.player.location.x, y: ctx.player.location.y, z: ctx.player.location.z };
    // 惯性:重击同样消耗「下一次攻击」加成(护甲击碎百分比不随惯性放大)
    const inertia = consumeInertia(session, ctx.casterId);
    toastInertia(session, ctx.casterId, inertia);
    const damage = Math.max(1, Math.round(HEAVY_DAMAGE * inertia.damageMul));
    const outcome = session.primitives.dealSectorDamage(
      ctx.casterId,
      center,
      ctx.direction,
      HEAVY_RADIUS,
      HEAVY_ANGLE,
      {
        hp: damage,
        armorPercent: HEAVY_ARMOR_BREAK_PERCENT,
        element: "physical",
        tags: ["weapon", "melee", "sweep"],
      },
      enemyOf(session, ctx.casterId),
    );
    // 4 层惯性:本次攻击附加重伤·撕裂
    if (inertia.applyLaceration) {
      for (const targetId of outcome.targets) {
        session.status.apply(targetId, STATUS_LACERATION, ctx.casterId);
      }
    }
    session.primitives.showIndicator(
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
});

// ── 固有Ⅰ 抓钩(snd5:assassin_skill_1) ──────────────────────────
//
// 实现方案迁移(2026-11-19):按 Grappling Hooks Add-On(Yeggs)普通钩爪
// (grappling_hook,type 1)重写,替代原「命中即传送牵引」:
//   右键 → 发射钩(脚本速度 60 格/秒,raycast 分步碰撞,最远 35 格)
//   命中方块 → 锁定:钟摆摆荡(自定义重力/阻尼/绳张力,每拍把合成
//     速度经 primitives.setVelocity → applyKnockback 施加,保留原版
//     碰撞与移动手感;玩家是真实摆荡而非传送)
//   潜行按住 → 收绳拉自己(25 格/秒 + 朝钩 80/秒²,重力减半),
//     抵达钩点 1.4 格内弹起并回收
//   潜行 + 右键 → 松开(onSneakUse 效用动作,不进施法流程,任意状态可用)
//   飞行/锁定中右键(不潜行) → 移除重射(消耗 1 堆叠)
//   命中玩家 → 保留 PDF 效果(7 点 + 3 格/秒牵拉 2 秒 + 撕裂)后回收
//   锚点方块被破坏 → 自动脱落(附加包 checkRopeAnchor)
// 与 PDF 的差异映射:
//   「牵引至抓钩位置」→ 锁定 + 潜行收绳(操作模型整体替换,用户确认);
//   「牵引飞行时间内每 0.5s 叠 1 层惯性」→ 锁定后(摆荡/收绳阶段)每
//     0.5s 叠 1 层(钩飞行阶段玩家未位移,不叠);
//   冷却/堆叠沿用 PDF 数值:发射消耗 1 堆叠(魔瘴之泉模式 —— 堆叠>0
//     不进 CD,耗尽后进 8s CD,CD 结束回满)。
// 实体:钩 = 盔甲架占位;绳体 = 自定义实体 snd5:rope( entities/snd5_rope.json
// + resource-pack 客户端 molang 渲染,附加包 rope_display 的简化版:
// 实体跟随玩家腰部连接点(脚部 +0.9,视觉 A 端与摆荡/收绳物理锚点共用),
// A 端即实体自身位置,钩点坐标走 client_sync 属性,
// 客户端按 a→b 向量旋转/拉伸一根细杆;单段直连不复刻分段绳链绕角);
// 防摔不需要(SND5 原版伤害已全拦截)。

const GRAPPLE_COOLDOWN_TICKS = 160; // 8 秒(堆叠耗尽后)
const GRAPPLE_MAX_STACKS = 3;
const GRAPPLE_MAX_RANGE = 35; // PDF 射程(附加包为 12 段×2.5=30,保留 PDF 数值)
/** 钩初速:60 格/秒(附加包 launch.js multiplyVector3(direction, 60)) */
const GRAPPLE_HOOK_SPEED = 60;
/** 飞行途中命中玩家的判定半径(线段扫描) */
const GRAPPLE_HIT_RADIUS = 1.4;

// 摆荡物理常数(附加包 simulation.js,tps = 20)
const GRAPPLE_DT = 1 / 20;
/** 自定义重力(格/秒²;附加包 wielderGravity -40;收绳时减半) */
const GRAPPLE_GRAVITY = -40;
/** 速度阻尼(附加包 wielderDampen 0.2) */
const GRAPPLE_DAMPEN = 0.2;
/** 绳张力:超出绳长的位移每秒以 20 倍修正加速度拉回(附加包 playerTensionFactor) */
const GRAPPLE_TENSION = 20;
/** 收绳速度(格/秒)与朝钩加速度(格/秒²)(附加包 retract.js:25 / 80) */
const GRAPPLE_RETRACT_SPEED = 25;
const GRAPPLE_RETRACT_ACCEL = 80;
/** 收绳抵达钩点的判定距离(附加包 1.4) */
const GRAPPLE_ARRIVE_DIST = 1.4;
/** 抵达弹起(附加包 retract.js:velocity += (-10*v + horiz*120 + up*250) × dt) */
const FLING_DAMP = -10;
const FLING_HORIZ = 120;
const FLING_UP = 250;
/** 锁定后惯性叠层间隔(0.5 秒) */
const GRAPPLE_INERTIA_INTERVAL_TICKS = 10;
/** 抓钩技能私有存储键与状态键 */
const GRAPPLE_SKILL_ID = "snd5:assassin_grapple";
const GRAPPLE_STORE_KEY = "hookEntityId";
/** 绳体可视化自定义实体(BP entities/snd5_rope.json + resource-pack 客户端 molang 渲染) */
const ROPE_ENTITY = "snd5:rope";
/** 绳体连接点高度:玩家腰部(脚部 +0.9)——视觉 A 端与摆荡/收绳物理锚点共用,保证绷直时绳杆不显得松弛 */
const ROPE_ATTACH_OFFSET_Y = 0.9;

interface GrappleState {
  hookId: string;
  /** 绳体可视化实体(snd5:rope;被外力移除时物理循环下一拍自动重生) */
  ropeId: string;
  phase: "flying" | "locked";
  /** 玩家合成速度(格/秒;每拍积分后经 setVelocity 施加) */
  velocity: Vec3;
  /** 绳长(锁定瞬间的玩家头-钩距离;收绳递减) */
  ropeLength: number;
  /** 锁定方块格(每拍校验被破坏) */
  anchor?: Vec3;
  /** 已飞行距离(射程判定) */
  flown: number;
  /** 发射方向水平单位向量(收绳抵达的弹起方向,附加包 ropeMotion 水平分量) */
  launchHoriz: Vec3;
  /** 上次惯性叠层 tick */
  lastInertiaTick: number;
}

/** 每会话的活跃抓钩状态(会话销毁随 WeakMap 释放;玩家死亡/离线由物理循环清理) */
const grappleStates = new WeakMap<MatchSession, Map<string, GrappleState>>();

function grappleStateMap(session: MatchSession): Map<string, GrappleState> {
  let map = grappleStates.get(session);
  if (!map) {
    map = new Map();
    grappleStates.set(session, map);
  }
  return map;
}

/** 绳体连接点:玩家腰部(脚部 +0.9);结构化参数避免内容层依赖 Player 类型 */
function waistAttach(player: { location: { x: number; y: number; z: number } }): Vec3 {
  return {
    x: player.location.x,
    y: player.location.y + ROPE_ATTACH_OFFSET_Y,
    z: player.location.z,
  };
}

/** 移除钩与绳体实体并清状态(松开/重射/回收/脱落共用) */
function removeGrapple(session: MatchSession, playerId: string): void {
  const map = grappleStates.get(session);
  const state = map?.get(playerId);
  if (map && state) {
    const hook = session.primitives.getEntity(state.hookId);
    if (hook?.isValid) {
      try {
        hook.remove();
      } catch {
        // 已被移除
      }
    }
    const rope = session.primitives.getEntity(state.ropeId);
    if (rope?.isValid) {
      try {
        rope.remove();
      } catch {
        // 已被移除
      }
    }
    map.delete(playerId);
  }
  session.skills.privateStore(playerId, GRAPPLE_SKILL_ID).delete(GRAPPLE_STORE_KEY);
}

/** 发射抓钩:生成钩实体(盔甲架占位)+ 绳体可视化实体 + 记录脚本速度 */
function launchGrapple(session: MatchSession, ctx: CastContext): boolean {
  const head = ctx.player.getHeadLocation();
  const dir = normalizeVector(ctx.direction);
  const origin = { x: head.x + dir.x, y: head.y + dir.y, z: head.z + dir.z };
  const hook = session.primitives.spawnSummon("minecraft:armor_stand", origin, {
    ownerId: ctx.casterId,
    kind: "snd5:grapple_hook",
    // 永驻:飞行/锁定生命周期由 1t 物理循环管理(会话销毁由 clearAll 兜底)
  });
  if (!hook) return false;
  try {
    hook.nameTag = "§7抓钩";
  } catch {
    // 占位表现失败不影响结算
  }
  const rope = session.primitives.spawnSummon(ROPE_ENTITY, origin, {
    ownerId: ctx.casterId,
    kind: "snd5:grapple_rope",
  });
  const horizontal = Math.hypot(dir.x, dir.z);
  grappleStateMap(session).set(ctx.casterId, {
    hookId: hook.id,
    ropeId: rope?.id ?? "",
    phase: "flying",
    velocity: { x: dir.x * GRAPPLE_HOOK_SPEED, y: dir.y * GRAPPLE_HOOK_SPEED, z: dir.z * GRAPPLE_HOOK_SPEED },
    ropeLength: 0,
    flown: 0,
    launchHoriz:
      horizontal > 1e-4
        ? { x: dir.x / horizontal, y: 0, z: dir.z / horizontal }
        : { x: 0, y: 0, z: 0 },
    lastInertiaTick: 0,
  });
  session.skills.privateStore(ctx.casterId, GRAPPLE_SKILL_ID).set(GRAPPLE_STORE_KEY, hook.id);
  try {
    session.dimension.playSound("crossbow.shoot", ctx.player.location);
  } catch {
    // 音效失败不影响结算
  }
  return true;
}

/** 抓钩命中玩家:7 点伤害 + 向施放者方向牵拉 2 秒 + 撕裂(PDF 数值) */
function onHookHitPlayer(
  session: MatchSession,
  ownerId: string,
  victim: PlayerState,
): void {
  const caster = session.players.get(ownerId);
  const casterLoc = caster?.player.isValid ? caster.player.location : undefined;
  session.combat.dealDamage(ownerId, victim.id, {
    hp: 7,
    element: "physical",
    tags: ["skill", "projectile"],
  });
  if (casterLoc) {
    session.primitives.pull(victim.id, casterLoc, {
      speedBlocksPerSecond: 3,
      durationTicks: 40,
    });
  }
  session.status.apply(victim.id, STATUS_LACERATION, ownerId);
}

/**
 * 抓钩 1t 物理(由 listeners.ts 全局 1t 循环驱动;无活跃钩爪时会话零开销)。
 * 数据流照搬附加包:内存 velocity 积分(格/秒),每拍经 setVelocity 施加
 * (目标速度 = velocity × dt,即每拍位移),玩家真实位置由原版物理移动。
 */
export function tickGrapple(session: MatchSession): void {
  const map = grappleStates.get(session);
  if (!map?.size) return;
  const now = session.nowTick();
  const dt = GRAPPLE_DT;
  for (const [playerId, state] of [...map]) {
    const playerState = session.players.get(playerId);
    const hook = session.primitives.getEntity(state.hookId);
    // 失效清理:玩家死亡/离线/钩被外力移除(附加包 entityDie → removeRopeFromWielder)
    if (!playerState?.alive || !playerState.player.isValid || !hook?.isValid) {
      if (hook?.isValid) {
        try {
          hook.remove();
        } catch {
          // 已被移除
        }
      }
      map.delete(playerId);
      session.skills.privateStore(playerId, GRAPPLE_SKILL_ID).delete(GRAPPLE_STORE_KEY);
      continue;
    }
    const player = playerState.player;

    // ── 绳体可视化(方案来源:附加包 rope_display 的简化版) ──
    // 实体跟随玩家腰部连接点(A 端 = 实体自身位置),钩点世界坐标经
    // client_sync 属性交给客户端 molang 计算朝向与拉伸;飞行/锁定两阶段
    // 统一更新,位置滞后一拍对视觉无感。被外力移除时下一拍自动重生。
    let rope = session.primitives.getEntity(state.ropeId);
    if (!rope?.isValid) {
      rope = session.primitives.spawnSummon(ROPE_ENTITY, waistAttach(player), {
        ownerId: playerId,
        kind: "snd5:grapple_rope",
      });
      if (rope) state.ropeId = rope.id;
    }
    if (rope?.isValid) {
      const attach = waistAttach(player);
      try {
        rope.teleport({ x: attach.x, y: attach.y, z: attach.z });
      } catch {
        // 目标区块未加载:跳过本拍可视化
      }
      const hookLoc = hook.location;
      try {
        rope.setProperty("snd5:hook_x", hookLoc.x);
        rope.setProperty("snd5:hook_y", hookLoc.y);
        rope.setProperty("snd5:hook_z", hookLoc.z);
      } catch {
        // 属性写入失败不影响结算
      }
    }

    if (state.phase === "flying") {
      // ── 飞行:脚本速度步进 + raycast 分步碰撞(附加包 tickRope) ──
      const speed = Math.sqrt(
        state.velocity.x * state.velocity.x +
          state.velocity.y * state.velocity.y +
          state.velocity.z * state.velocity.z,
      );
      const dir = {
        x: state.velocity.x / speed,
        y: state.velocity.y / speed,
        z: state.velocity.z / speed,
      };
      const step = speed * dt; // 3 格/拍
      const from: Vec3 = { ...hook.location };
      // 命中玩家(先于方块):保留 PDF 命中玩家效果,命中后回收
      const victim = enemyAlongStep(session, playerId, from, dir, step, GRAPPLE_HIT_RADIUS);
      if (victim) {
        onHookHitPlayer(session, playerId, victim);
        removeGrapple(session, playerId);
        continue;
      }
      // 命中方块 → 锁定(停在方块表面前 0.3 格,附加包 hookCollisionOffset 0.2 同理)
      const block = session.primitives.raycastBlock(from, dir, step + 0.5);
      if (block) {
        const cell = { x: block.x + 0.5, y: block.y + 0.5, z: block.z + 0.5 };
        const t = Math.max(
          0,
          (cell.x - from.x) * dir.x + (cell.y - from.y) * dir.y + (cell.z - from.z) * dir.z - 0.3,
        );
        const stop: Vec3 = { x: from.x + dir.x * t, y: from.y + dir.y * t, z: from.z + dir.z * t };
        try {
          hook.teleport(stop);
        } catch {
          // 目标区块未加载:按飞满处理
        }
        const attach = waistAttach(player);
        const hx = stop.x - attach.x;
        const hy = stop.y - attach.y;
        const hz = stop.z - attach.z;
        state.phase = "locked";
        state.anchor = block;
        state.ropeLength = Math.max(1, Math.sqrt(hx * hx + hy * hy + hz * hz));
        // 摆荡速度以玩家真实速度初始化(附加包 getEntity:velocity = getVelocity × tps);
        // 钩的飞行速度不复用 —— 附加包中钩 motion 与玩家 velocity 是两套状态
        const current = player.getVelocity();
        state.velocity = { x: current.x * 20, y: current.y * 20, z: current.z * 20 };
        state.lastInertiaTick = now;
        session.hud.toast(player, "§7抓钩已锁定 §8(潜行收绳 · 潜行+右键松开)");
        continue;
      }
      // 前移一步
      try {
        hook.teleport({
          x: from.x + dir.x * step,
          y: from.y + dir.y * step,
          z: from.z + dir.z * step,
        });
      } catch {
        // 目标区块未加载:按脱落处理
        removeGrapple(session, playerId);
        continue;
      }
      state.flown += step;
      // 飞满射程未命中:脱落回收(附加包 maxRopeLength 超限 loosen,这里直接回收)
      if (state.flown >= GRAPPLE_MAX_RANGE) {
        removeGrapple(session, playerId);
      }
      continue;
    }

    // ── 锁定:钟摆摆荡 + 收绳(附加包 tickWielder / retractRope) ──
    const attach = waistAttach(player);
    const hookLoc = hook.location;
    const retracting = player.isSneaking;
    // 自定义重力(收绳时减半)+ 阻尼
    const velocity = state.velocity;
    velocity.x += velocity.x * -GRAPPLE_DAMPEN * dt;
    velocity.y += (GRAPPLE_GRAVITY * (retracting ? 0.5 : 1) + velocity.y * -GRAPPLE_DAMPEN) * dt;
    velocity.z += velocity.z * -GRAPPLE_DAMPEN * dt;
    // 绳张力:距离超出绳长 → 以 TENSION 倍修正加速度拉回(钟摆来源)
    const dx = hookLoc.x - attach.x;
    const dy = hookLoc.y - attach.y;
    const dz = hookLoc.z - attach.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > state.ropeLength && dist > 0.001) {
      const overshoot = dist - state.ropeLength;
      velocity.x += (dx / dist) * overshoot * GRAPPLE_TENSION * dt;
      velocity.y += (dy / dist) * overshoot * GRAPPLE_TENSION * dt;
      velocity.z += (dz / dist) * overshoot * GRAPPLE_TENSION * dt;
    }
    if (retracting) {
      // 收绳:朝钩加速度 + 绳长收缩
      if (dist > 0.001) {
        velocity.x += (dx / dist) * GRAPPLE_RETRACT_ACCEL * dt;
        velocity.y += (dy / dist) * GRAPPLE_RETRACT_ACCEL * dt;
        velocity.z += (dz / dist) * GRAPPLE_RETRACT_ACCEL * dt;
      }
      state.ropeLength = Math.max(0.5, state.ropeLength - GRAPPLE_RETRACT_SPEED * dt);
    }
    // 锁定后(摆荡/收绳 = PDF「自身飞行时间」的映射)每 0.5s 叠 1 层惯性
    if (now - state.lastInertiaTick >= GRAPPLE_INERTIA_INTERVAL_TICKS) {
      state.lastInertiaTick = now;
      if (!session.isDead(playerId)) {
        session.status.apply(playerId, STATUS_INERTIA, playerId);
      }
    }
    // 施加速度(目标速度 = velocity × dt;经 applyKnockback 逼近)
    session.primitives.setVelocity(playerId, {
      x: velocity.x * dt,
      y: velocity.y * dt,
      z: velocity.z * dt,
    });
    // 锚点方块校验(附加包 checkRopeAnchor):被破坏 → 脱落
    if (state.anchor) {
      try {
        const anchorBlock = session.dimension.getBlock(state.anchor);
        if (!anchorBlock || anchorBlock.isAir) {
          removeGrapple(session, playerId);
          continue;
        }
      } catch {
        // 区块未加载:保留锚点,下拍再校验
      }
    }
    // 收绳抵达钩点 → 弹起并回收(附加包 retract.js 到达分支;立即施加,
    // 因为下一拍钩已回收、摆荡积分不会再跑)
    if (retracting && dist < GRAPPLE_ARRIVE_DIST) {
      const horizLen = Math.max(0.001, Math.hypot(state.launchHoriz.x, state.launchHoriz.z));
      velocity.x += (velocity.x * FLING_DAMP + (state.launchHoriz.x / horizLen) * FLING_HORIZ) * dt;
      velocity.y += (velocity.y * FLING_DAMP + FLING_UP) * dt;
      velocity.z += (velocity.z * FLING_DAMP + (state.launchHoriz.z / horizLen) * FLING_HORIZ) * dt;
      session.primitives.setVelocity(playerId, {
        x: velocity.x * dt,
        y: velocity.y * dt,
        z: velocity.z * dt,
      });
      removeGrapple(session, playerId);
    }
  }
}

skillRegistry.register({
  id: GRAPPLE_SKILL_ID,
  displayName: "抓钩",
  slot: "innate_1",
  manaCost: 0,
  cooldown: GRAPPLE_COOLDOWN_TICKS,
  maxStacks: GRAPPLE_MAX_STACKS,
  castMode: "instant",

  cast(ctx) {
    const session = ctx.session;
    const map = grappleStateMap(session);
    const existing = map.get(ctx.casterId);
    if (existing) {
      const hook = ctx.primitives.getEntity(existing.hookId);
      if (hook?.isValid) {
        // 飞行/锁定中右键(不潜行):移除重射(附加包 removeRopeFromWielder + launchRope;
        // 锁定中的松开已迁移到潜行+右键效用动作,不占施法校验)
        removeGrapple(session, ctx.casterId);
      }
      // 钩已失效:清残留状态,按新发射处理
      removeGrapple(session, ctx.casterId);
    }
    return launchGrapple(session, ctx) ? true : false;
  },
});

// ── 固有Ⅱ 定锚(snd5:assassin_skill_2,二段施法) ──────────────────
//
// 投掷阶段改用原版雪球承载(与战士球状闪电/群法固体雷云同款占位):
// 抛物线与碰撞由引擎接管,飞行不再脚本积分;命中/落地后转为盔甲架
// 驻场定锚(「投射物 → 驻场」两级结构,同群法固体雷云)。
// - 右键投出雪球(初速 0.8 格/tick,含原版重力约 6 格落点 —— PDF
//   「5 格/秒约 6 格」的实机近似;投掷统一 suppressCooldown 不进 CD)
// - 命中敌方玩家 → 停驻 + 5 点伤害 + 撕裂;命中其他实体/方块 → 同样
//   停驻(无伤害,避免雪球撞毁后定锚丢失);到期兜底亦停驻
// - 驻场定锚 = 盔甲架(6 秒),自然消失 → expire 9s 冷却
// - 驻场后再次点击 = 二段瞬移劈砍(30 点 + 击碎 40% 护甲上限)→ 18s
// - 飞行中点击:堆叠校验不放行,提示「定锚未就绪」;驻场定锚被外力
//   破坏:canIgnoreStackCheck 惰性恢复(清 store + 9s expire CD)

const ANCHOR_COOLDOWN = {
  ready: 360, // 二段劈砍后 18 秒
  expire: 180, // 定锚 6 秒后自然消失:9 秒
  // 投掷本身不进冷却(cast 返回 suppressCooldown):定锚落地驻场后即可
  // 二段;二段与自然消失是仅有的两个进冷却收口。
};
/** 雪球初速(格/tick):含原版重力下落点约 6 格(PDF「飞行距离 6 格左右」) */
const ANCHOR_THROW_SPEED = 0.8;
/** 雪球兜底寿命(未命中任何东西时也在最后位置停驻) */
const ANCHOR_FLIGHT_LIFETIME_TICKS = 100;
const ANCHOR_LIFETIME_TICKS = 120; // 驻场 6 秒
const ANCHOR_HIT_DAMAGE = 5;
const ANCHOR_CLEAVE_RADIUS = 3;
const ANCHOR_CLEAVE_ANGLE = 180; // 半圆
const ANCHOR_CLEAVE_DAMAGE = 30;
/** 二段劈砍额外击碎护甲上限 40% */
const ANCHOR_CLEAVE_ARMOR_PERCENT = 0.4;
const ANCHOR_SKILL_ID = "snd5:assassin_anchor";
/** 私有存储键:flight = 飞行中雪球实体 id;anchor = 驻场定锚实体 id */
const ANCHOR_FLIGHT_KEY = "flyingEntityId";
const ANCHOR_STORE_KEY = "anchorEntityId";

/**
 * 雪球命中/到期后的驻场:生成定锚盔甲架(6 秒),并把私有存储从
 * 「飞行中」切换为「驻场定锚 id」。victim 非空时先结算命中效果
 * (5 点伤害 + 重伤·撕裂,PDF「对定锚位置的敌方角色」)。
 * 幂等:驻场定锚已存在时跳过(同拍方块/实体双回调防重)。
 */
function landAnchor(
  session: MatchSession,
  ownerId: string,
  location: Vec3,
  victim?: PlayerState,
): void {
  const store = session.skills.privateStore(ownerId, ANCHOR_SKILL_ID);
  const existingId = store.get(ANCHOR_STORE_KEY);
  if (typeof existingId === "string" && session.primitives.getEntity(existingId)?.isValid) {
    return;
  }
  const anchor = session.primitives.spawnSummon("minecraft:armor_stand", location, {
    ownerId,
    kind: "snd5:anchor_marker",
    lifetimeTicks: ANCHOR_LIFETIME_TICKS,
    onExpire: () => {
      // 定锚自然消失 → 技能进入 9 秒冷却(expire 分支),堆叠随之回满
      session.primitives.requestCooldown(ownerId, ANCHOR_SKILL_ID, "expire");
    },
  });
  store.delete(ANCHOR_FLIGHT_KEY);
  if (!anchor) {
    // 驻场失败(生成异常):直接申请 expire 冷却,技能不卡死
    session.primitives.requestCooldown(ownerId, ANCHOR_SKILL_ID, "expire");
    return;
  }
  try {
    anchor.nameTag = "§7定锚";
  } catch {
    // 占位表现失败不影响结算
  }
  store.set(ANCHOR_STORE_KEY, anchor.id);
  if (victim) {
    session.combat.dealDamage(ownerId, victim.id, {
      hp: ANCHOR_HIT_DAMAGE,
      element: "physical",
      tags: ["skill", "projectile"],
    });
    session.status.apply(victim.id, STATUS_LACERATION, ownerId);
  }
}

/** 二段施法:瞬移到定锚位置 → 半径 3 半圆 30 点 + 击碎 40% 护甲 → 销毁 */
function anchorCleave(session: MatchSession, ctx: CastContext, anchorId: string): boolean {
  const caster = session.players.get(ctx.casterId);
  if (!caster?.player.isValid) return false;
  const anchor = ctx.primitives.getEntity(anchorId);
  if (!anchor?.isValid) return false;
  const anchorLoc = anchor.location;
  ctx.primitives.teleport(ctx.casterId, { x: anchorLoc.x, y: anchorLoc.y, z: anchorLoc.z });
  // 销毁定锚(直接移除;下一拍 summon.tick 广播 destroyed,expire 冷却不触发)
  try {
    anchor.remove();
  } catch {
    // 已被移除
  }
  session.skills.privateStore(ctx.casterId, ANCHOR_SKILL_ID).delete(ANCHOR_STORE_KEY);

  const view = caster.player.getViewDirection();
  const center = { x: caster.player.location.x, y: caster.player.location.y, z: caster.player.location.z };
  session.primitives.dealSectorDamage(
    ctx.casterId,
    center,
    view,
    ANCHOR_CLEAVE_RADIUS,
    ANCHOR_CLEAVE_ANGLE,
    {
      hp: ANCHOR_CLEAVE_DAMAGE,
      armorPercent: ANCHOR_CLEAVE_ARMOR_PERCENT,
      element: "physical",
      tags: ["skill", "sweep"],
    },
    enemyOf(session, ctx.casterId),
  );
  session.primitives.showIndicator(
    ctx.casterId,
    {
      kind: "sector",
      origin: center,
      direction: { x: view.x, z: view.z },
      radius: ANCHOR_CLEAVE_RADIUS,
      angleDegrees: ANCHOR_CLEAVE_ANGLE,
    },
    { durationTicks: 6 },
  );
  return true;
}

skillRegistry.register({
  id: ANCHOR_SKILL_ID,
  displayName: "定锚",
  slot: "innate_2",
  manaCost: 0,
  cooldown: ANCHOR_COOLDOWN,
  maxStacks: 1,
  castMode: "instant",
  failureHint: { no_stacks: "定锚未就绪(飞行中或已被破坏)" },

  /**
   * 二段施法的堆叠放行:驻场定锚在场时堆叠已扣(一段投掷 suppressCooldown),
   * 校验需绕过堆叠检查。雪球飞行中不放行(定锚未落地);驻场定锚被外部
   * 破坏(非自然到期,expire 冷却未触发)时惰性恢复 —— 清 store 并申请
   * 9 秒冷却,本次按失败提示。
   */
  canIgnoreStackCheck(session, playerId) {
    const store = session.skills.privateStore(playerId, ANCHOR_SKILL_ID);
    const anchorId = store.get(ANCHOR_STORE_KEY);
    if (typeof anchorId === "string") {
      const anchor = session.primitives.getEntity(anchorId);
      if (anchor?.isValid) return true;
      // 驻场定锚被外部破坏:惰性恢复(清 store + 9s expire 冷却)
      store.delete(ANCHOR_STORE_KEY);
      store.delete(ANCHOR_FLIGHT_KEY);
      session.skills.applyCooldown(playerId, ANCHOR_SKILL_ID, "expire");
      return false;
    }
    // 雪球飞行中(FLIGHT key 在场)或无状态:不放行二段
    return false;
  },

  cast(ctx) {
    const session = ctx.session;
    const store = session.skills.privateStore(ctx.casterId, ANCHOR_SKILL_ID);
    // 二段:驻场定锚在场 → 瞬移劈砍(进入 18 秒冷却)
    const anchorId = store.get(ANCHOR_STORE_KEY);
    if (typeof anchorId === "string") {
      const anchor = ctx.primitives.getEntity(anchorId);
      if (anchor?.isValid) {
        const ok = anchorCleave(session, ctx, anchorId);
        if (ok) return { ok: true, cooldown: "ready" };
        return false;
      }
      // 双保险:锚已失效(正常由 canIgnoreStackCheck 兜底),清 store 转投掷
      store.delete(ANCHOR_STORE_KEY);
    }
    // 一段:投掷雪球定锚(不进冷却,落地驻场后可二段)
    const head = ctx.player.getHeadLocation();
    const origin = {
      x: head.x + ctx.direction.x,
      y: head.y + ctx.direction.y,
      z: head.z + ctx.direction.z,
    };
    const snowball = ctx.primitives.spawnProjectile("minecraft:snowball", origin, ctx.direction, {
      ownerId: ctx.casterId,
      speedBlocksPerTick: ANCHOR_THROW_SPEED,
      lifetimeTicks: ANCHOR_FLIGHT_LIFETIME_TICKS,
      onHitBlock: (location) => landAnchor(session, ctx.casterId, location),
      onHitEntity: (targetId, instance) => {
        // 敌方玩家:停驻在目标位置 + 5 点伤害 + 撕裂;其他实体(队友/
        // 创生物/生物):原版雪球命中任意实体即消失,同样停驻避免定锚丢失
        const target = session.players.get(targetId);
        if (
          target?.alive &&
          target.id !== ctx.casterId &&
          session.teams.getTeam(targetId) !== session.teams.getTeam(ctx.casterId)
        ) {
          const loc = target.player.isValid
            ? { x: target.player.location.x, y: target.player.location.y, z: target.player.location.z }
            : instance.entity.location;
          landAnchor(session, ctx.casterId, loc, target);
          return;
        }
        const hit = ctx.primitives.getEntity(targetId);
        const loc = hit?.isValid
          ? { x: hit.location.x, y: hit.location.y, z: hit.location.z }
          : instance.entity.isValid
            ? instance.entity.location
            : origin;
        landAnchor(session, ctx.casterId, loc);
      },
      onExpire: (instance) => {
        const loc = instance.entity.isValid
          ? { x: instance.entity.location.x, y: instance.entity.location.y, z: instance.entity.location.z }
          : origin;
        landAnchor(session, ctx.casterId, loc);
      },
    });
    if (!snowball) return false;
    store.set(ANCHOR_FLIGHT_KEY, snowball.id);
    return { ok: true, suppressCooldown: true };
  },
});

// ── 固有Ⅲ 影遁(被动) ────────────────────────────────────────────

const PASSIVE_EFFECT_TICKS = 20; // 迅捷Ⅰ + 隐身,持续 1 秒
const PASSIVE_COOLDOWN_TICKS = 160; // 8 秒

skillRegistry.register({
  id: "snd5:assassin_shadow_step",
  displayName: "影遁(被动)",
  slot: "passive",
  cooldown: 0,
  listen: ["skill.cast"],

  onEvent(event, ctx) {
    const payload = event.payload as { casterId?: string; outcome?: { ok?: boolean } };
    if (payload.casterId !== ctx.playerId) return;
    // 使用技能后(固有/重击/秘典,施放成功才触发)
    if (!payload.outcome?.ok) return;
    ctx.primitives.applyEffect(ctx.playerId, "minecraft:speed", PASSIVE_EFFECT_TICKS);
    ctx.primitives.applyEffect(ctx.playerId, "minecraft:invisibility", PASSIVE_EFFECT_TICKS);
    return { startCooldownTicks: PASSIVE_COOLDOWN_TICKS };
  },
});

// ── 自定义物品绑定(组件回调路由) ────────────────────────────────

// 固有Ⅰ:右键发射/重射;潜行+右键松开(onSneakUse 效用动作,不进施法
// 流程 → 不受冷却/堆叠限制,飞行/锁定/任意状态都可松 —— 附加包
// 「已锁定右键松开」的操作在本项目的技能框架下的迁移位)
customItemBindings.set(ASSASSIN_SKILL_ITEMS.innate_1, {
  skillId: GRAPPLE_SKILL_ID,
  onSneakUse: (session, playerId) => {
    const player = session.players.get(playerId);
    if (!player?.alive || !player.player.isValid) return;
    if (!grappleStateMap(session).has(playerId)) return;
    removeGrapple(session, playerId);
    session.hud.toast(player.player, "§7抓钩已松开");
  },
});
// 固有Ⅱ:右键投掷/二段瞬移
customItemBindings.set(ASSASSIN_SKILL_ITEMS.innate_2, {
  skillId: ANCHOR_SKILL_ID,
});
// 武器:长按右键弓式蓄力(重击)
customItemBindings.set(ASSASSIN_WEAPON_ITEM, { skillId: "snd5:assassin_heavy" });
