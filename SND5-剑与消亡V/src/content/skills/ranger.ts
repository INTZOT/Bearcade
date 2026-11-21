// ============================================================
// 单法技能(内容设计 PDF 第 22-25 页)
// - 武器「环型魔杖·日月」(自定义物品):
//   轻击 3 点近战(professions/ranger.ts handleAttack);
//   重击 = weapon_heavy 伪技能(长按右键蓄力 1s):宽 1 格光束,
//   最远 24 格,命中第一个敌方角色造成 24 点本源伤害,随后光束向
//   穿透方向溅射,分裂位置 ¼ 圆 2 格内其他敌人 4 点本源伤害
//   (2026-11-18 确认:主目标不重复吃溅射;落空消耗魔力不退);
//   携带境界面强化 → 进阶「境界面上的#%¥&$#」(30 格 / 30 点+收束 /
//   ¼ 圆 4 格 2 点,并按持有日蚀/月冕叠 1 层)。
// - 固有Ⅰ 时光种子:盔甲架占位直线飞行(每秒 8 格 × 2 秒),命中
//   敌方记录双方三资源与变量α/β(盔甲架占位),施加变动率;3 秒后
//   按远点概率判定回溯(见 statuses/ranger.ts resolveRewind);
//   未命中不进冷却(命中 16s / 落空 0s,requestCooldown 显式申请)。
// - 固有Ⅱ 加强攻击:下次重击进阶 + 1 层日蚀;潜行施加 1 层月冕。
// - 固有Ⅲ 寻光信标(被动):死亡前快照(combat.beforeDamage 拦截)→
//   死亡时原地放置信标(盔甲架,永驻)并弹表单选择部署方式;
//   在信标处部署 = 保留死亡前三资源 + 2s 全额减伤,固有Ⅲ进 90s CD;
//   未使用(回默认点/未作答)则信标消失、不进 CD。
// ============================================================
import { ActionFormData } from "@minecraft/server-ui";
import { customItemBindings, skillRegistry } from "../../framework";
import type {
  AttributeSnapshot,
  CastContext,
  MatchSession,
  PlayerState,
  RespawnDecision,
} from "../../framework";
import type { Vec3 } from "../../../../shared/minigame-core/types";
import {
  STATUS_INTERFACE_SURGE,
  STATUS_LUNAR_CROWN,
  STATUS_MUTATION_RATE,
  STATUS_RESTRAINT,
  STATUS_SOLAR_ECLIPSE,
  STATUS_BEACON_AEGIS,
  recordRewind,
} from "../statuses/ranger";

// ── 自定义物品 ──────────────────────────────────────────────────

export const RANGER_WEAPON_ITEM = "snd5:ranger_weapon";
export const RANGER_SKILL_ITEMS: Record<"innate_1" | "innate_2", string> = {
  innate_1: "snd5:ranger_skill_1",
  innate_2: "snd5:ranger_skill_2",
};

/** 语义类型标记(盔甲架占位实体的区分键) */
const TIME_SEED_KIND = "snd5:time_seed";
const REWIND_VARIABLE_KIND = "snd5:rewind_variable";
const LIGHT_BEACON_KIND = "snd5:light_beacon";

// ── 公共工具 ─────────────────────────────────────────────────────

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

function distanceSq(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function normalize(v: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const len = Math.max(1e-6, Math.hypot(v.x, v.y, v.z));
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

// ── 武器重击(weapon_heavy 伪技能,绑定在自定义武器上) ────────────

const HEAVY_CHARGE_TICKS = 20; // 1 秒(会话 5t 网格量化,见 SkillSystem.tickCharge)
const HEAVY_RANGE = 24;
const HEAVY_DAMAGE = 24;
const HEAVY_SPLASH_RADIUS = 2;
const HEAVY_SPLASH_DAMAGE = 4;
const HEAVY_MANA = 14;
/** 强化形态「境界面上的#%¥&$#」 */
const SURGE_RANGE = 30;
const SURGE_DAMAGE = 30;
const SURGE_SPLASH_RADIUS = 4;
const SURGE_SPLASH_DAMAGE = 2;
const SURGE_MANA = 23;
/** 光束宽度 1 格 + 玩家碰撞半径 0.3 → 轴线垂直距离阈值 */
const BEAM_HIT_DISTANCE = 0.8;
const SPLASH_ANGLE = 90; // ¼ 圆

interface BeamHit {
  state: PlayerState;
  /** 沿光束轴的距离(分裂点位置) */
  t: number;
}

/** 光束命中检测:轴线垂直距离 ≤ BEAM_HIT_DISTANCE 且未被方块遮挡的第一个敌人 */
function findBeamTarget(
  session: MatchSession,
  ctx: CastContext,
  head: Vec3,
  dir: { x: number; y: number; z: number },
  maxDist: number,
): BeamHit | undefined {
  let best: BeamHit | undefined;
  // 半径 +3 兜底:玩家碰撞盒可能使 3D 距离略超光程
  for (const state of session.primitives.enemyPlayersInRadius(ctx.casterId, head, maxDist + 3)) {
    const center = {
      x: state.player.location.x,
      y: state.player.location.y + 0.9,
      z: state.player.location.z,
    };
    const rel = { x: center.x - head.x, y: center.y - head.y, z: center.z - head.z };
    const t = rel.x * dir.x + rel.y * dir.y + rel.z * dir.z;
    if (t <= 0.5 || t > maxDist) continue;
    const perpSq = distanceSq(rel, { x: dir.x * t, y: dir.y * t, z: dir.z * t });
    if (perpSq > BEAM_HIT_DISTANCE * BEAM_HIT_DISTANCE) continue;
    if (!best || t < best.t) best = { state, t };
  }
  return best;
}

skillRegistry.register({
  id: "snd5:ranger_heavy",
  displayName: "日月·重击",
  slot: "weapon_heavy",
  // 携带境界面强化时消耗 23 点(预扣与结算都以「扣费时点」的强化状态为准)
  manaCost: (ctx) =>
    ctx.session.status.has(ctx.casterId, STATUS_INTERFACE_SURGE) ? SURGE_MANA : HEAVY_MANA,
  cooldown: 0, // 无冷却,由蓄力时长自然限频
  castMode: "charge",
  // 蓄满才施放:提前松手继续蓄(minTicks = maxTicks)
  chargeConfig: {
    minTicks: HEAVY_CHARGE_TICKS,
    maxTicks: HEAVY_CHARGE_TICKS,
    tickIntervalTicks: 5,
  },
  // 蓄力期间光束指示器跟随视角(强化形态 30 格)
  indicator(ctx) {
    const surged = ctx.session.status.has(ctx.casterId, STATUS_INTERFACE_SURGE);
    return {
      kind: "line",
      origin: ctx.player.getHeadLocation(),
      direction: ctx.direction,
      length: surged ? SURGE_RANGE : HEAVY_RANGE,
      width: 1,
    };
  },

  cast(ctx) {
    const session = ctx.session;
    const surged = session.status.has(ctx.casterId, STATUS_INTERFACE_SURGE);
    const range = surged ? SURGE_RANGE : HEAVY_RANGE;
    const mainDamage = surged ? SURGE_DAMAGE : HEAVY_DAMAGE;
    const splashRadius = surged ? SURGE_SPLASH_RADIUS : HEAVY_SPLASH_RADIUS;
    const splashDamage = surged ? SURGE_SPLASH_DAMAGE : HEAVY_SPLASH_DAMAGE;

    // 消费境界面强化(本次攻击进阶;「额外叠加 1 层日蚀/月冕」对齐持有项)
    if (surged) {
      session.status.remove(ctx.casterId, STATUS_INTERFACE_SURGE, "consumed");
      if (session.status.has(ctx.casterId, STATUS_SOLAR_ECLIPSE)) {
        session.status.apply(ctx.casterId, STATUS_SOLAR_ECLIPSE, ctx.casterId);
      } else if (session.status.has(ctx.casterId, STATUS_LUNAR_CROWN)) {
        session.status.apply(ctx.casterId, STATUS_LUNAR_CROWN, ctx.casterId);
      }
    }

    // 光束结算:先算方块遮挡,再找轴上第一个敌人
    const head = ctx.player.getHeadLocation();
    const dir = normalize(ctx.direction);
    let maxDist = range;
    const blockHit = ctx.primitives.raycastBlock(head, ctx.direction, range);
    if (blockHit) {
      maxDist = Math.min(
        maxDist,
        Math.sqrt(distanceSq(head, { x: blockHit.x + 0.5, y: blockHit.y + 0.5, z: blockHit.z + 0.5 })),
      );
    }
    const hit = findBeamTarget(session, ctx, head, dir, maxDist);

    // 强化扣费与实际形态的差价退还(强化在蓄力期间到期的边角)
    const refund = ctx.predeductedMana - (surged ? SURGE_MANA : HEAVY_MANA);

    if (hit) {
      // 主光束:第一个被击中的敌方角色,本源伤害
      session.combat.dealDamage(ctx.casterId, hit.state.id, {
        hp: mainDamage,
        element: "origin",
        tags: ["weapon", "melee", "sweep"],
      });
      if (surged) {
        // 收束:无法正常回复并记录,8 秒后全量返还
        session.status.apply(hit.state.id, STATUS_RESTRAINT, ctx.casterId);
      }
      // 溅射:分裂位置(光束轴命中点)¼ 圆内的其他敌人(主目标不重复结算)
      const split = {
        x: head.x + dir.x * hit.t,
        y: head.y + dir.y * hit.t,
        z: head.z + dir.z * hit.t,
      };
      for (const state of session.primitives.enemyPlayersInRadius(ctx.casterId, split, splashRadius)) {
        if (state.id === hit.state.id) continue;
        if (!inSector(split, ctx.direction, state.player.location, SPLASH_ANGLE)) continue;
        session.combat.dealDamage(ctx.casterId, state.id, {
          hp: splashDamage,
          element: "origin",
          tags: ["weapon", "melee", "sweep"],
        });
      }
    }

    // 表现:光束轨迹 + 溅射圈闪烁(纯表现,失败不影响结算)
    try {
      const length = hit ? hit.t : maxDist;
      ctx.primitives.showIndicator(
        ctx.casterId,
        [
          { kind: "line", origin: head, direction: ctx.direction, length, width: 1 },
          ...(hit
            ? [
                {
                  kind: "sector" as const,
                  origin: { x: head.x + dir.x * hit.t, y: ctx.player.location.y, z: head.z + dir.z * hit.t },
                  direction: { x: ctx.direction.x, z: ctx.direction.z },
                  radius: splashRadius,
                  angleDegrees: SPLASH_ANGLE,
                },
              ]
            : []),
        ],
        { durationTicks: 6 },
      );
      session.dimension.playSound("mob.guardian.attack", head);
    } catch {
      // 音效/指示器失败不影响结算
    }

    // 落空不退款(2026-11-18 确认):光束已射出;武器重击本就无冷却
    return refund > 0 ? { ok: true, refundMana: refund } : true;
  },
});

// ── 固有Ⅰ 时光种子(snd5:ranger_skill_1) ────────────────────────

const SEED_MANA = 30;
const SEED_COOLDOWN_ON_HIT = 320; // 16 秒(命中分支)
const SEED_COOLDOWN_ON_MISS = 0; // 未命中不进冷却(requestCooldown 0 触发堆叠回满)
const SEED_SPEED_BLOCKS_PER_SECOND = 8;
const SEED_FLIGHT_SECONDS = 2;
const SEED_LIFETIME_TICKS = SEED_FLIGHT_SECONDS * 20; // 40 game ticks
const SEED_HIT_RADIUS = 1;

/**
 * 时光种子命中敌人:记录双方三资源与变量α/β → 变动率(3s 后判定)。
 * 判定逻辑在 statuses/ranger.ts 的变动率 onExpire(resolveRewind)。
 */
function onSeedHitEnemy(session: MatchSession, ctx: CastContext, victim: PlayerState): void {
  const caster = session.players.get(ctx.casterId);
  if (!caster?.player.isValid) return;
  const casterSnapshot = session.attributes.snapshot(ctx.casterId);
  const victimSnapshot = session.attributes.snapshot(victim.id);
  const casterPoint = { ...caster.player.location };
  const victimPoint = { ...victim.player.location };
  recordRewind(session, {
    casterId: ctx.casterId,
    victimId: victim.id,
    casterSnapshot,
    victimSnapshot,
    casterPoint,
    victimPoint,
  });
  // 变量α/β:盔甲架占位,3 秒后与判定同步消失(纯标记,判定用存储坐标)
  const alpha = session.primitives.spawnSummon("minecraft:armor_stand", casterPoint, {
    ownerId: ctx.casterId,
    kind: REWIND_VARIABLE_KIND,
    invulnerable: true,
    lifetimeTicks: 60,
  });
  const beta = session.primitives.spawnSummon("minecraft:armor_stand", victimPoint, {
    ownerId: victim.id,
    kind: REWIND_VARIABLE_KIND,
    invulnerable: true,
    lifetimeTicks: 60,
  });
  try {
    if (alpha?.isValid) alpha.nameTag = "§u变量α";
    if (beta?.isValid) beta.nameTag = "§u变量β";
  } catch {
    // 占位表现失败不影响结算
  }
  session.status.apply(ctx.casterId, STATUS_MUTATION_RATE, ctx.casterId);
  // 命中分支:16 秒冷却(冷却结束 → cooldown.end → 堆叠回满)
  ctx.primitives.requestCooldown(ctx.casterId, "snd5:ranger_time_seed", SEED_COOLDOWN_ON_HIT);
  session.hud.toast(caster.player, "§d时光种子命中: 3 秒后判定时间回溯");
  session.hud.toast(victim.player, "§d你被时光种子命中: 发射者将与你回溯/互换状态");
  try {
    session.dimension.playSound("beacon.activate", victimPoint);
  } catch {
    // 音效失败不影响结算
  }
}

skillRegistry.register({
  id: "snd5:ranger_time_seed",
  displayName: "时光种子",
  slot: "innate_1",
  manaCost: SEED_MANA,
  cooldown: SEED_COOLDOWN_ON_HIT, // 实际冷却由命中/落空分支经 requestCooldown 申请
  maxStacks: 1,
  castMode: "instant",
  failureHint: { no_mana: `魔力不足(${SEED_MANA})` },

  cast(ctx) {
    const session = ctx.session;
    const head = ctx.player.getHeadLocation();
    const dir = normalize(ctx.direction);
    // 每会话拍(5 game ticks = 0.25s)推进 2 格,细分 4 步各 0.5 格防穿越
    const stepPerTick = (SEED_SPEED_BLOCKS_PER_SECOND * 5) / 20; // 2 格/拍
    const substeps = 4;
    const stepLength = stepPerTick / substeps;
    let resolved = false; // 命中/落空二选一,防止 onExpire 重复申请落空冷却

    const spawned = ctx.primitives.spawnSummon("minecraft:armor_stand", {
      x: head.x + dir.x * 0.5,
      y: head.y + dir.y * 0.5,
      z: head.z + dir.z * 0.5,
    }, {
      ownerId: ctx.casterId,
      kind: TIME_SEED_KIND,
      invulnerable: true,
      lifetimeTicks: SEED_LIFETIME_TICKS,
      tickIntervalTicks: 5,
      onTick: (entity) => {
        if (!entity.isValid) return;
        let pos = entity.location;
        for (let i = 0; i < substeps; i++) {
          pos = { x: pos.x + dir.x * stepLength, y: pos.y + dir.y * stepLength, z: pos.z + dir.z * stepLength };
          // 场景方块:落空(不进冷却)
          if (session.primitives.raycastBlock(pos, dir, 0.3)) {
            resolved = true;
            ctx.primitives.requestCooldown(ctx.casterId, "snd5:ranger_time_seed", SEED_COOLDOWN_ON_MISS);
            try {
              entity.remove();
            } catch {
              // 已被移除
            }
            return;
          }
          // 敌方角色:命中
          const enemies = session.primitives.enemyPlayersInRadius(ctx.casterId, pos, SEED_HIT_RADIUS);
          if (enemies.length > 0) {
            resolved = true;
            const victim = enemies.reduce((a, b) =>
              distanceSq(pos, b.player.location) < distanceSq(pos, a.player.location) ? b : a,
            );
            onSeedHitEnemy(session, ctx, victim);
            try {
              entity.remove();
            } catch {
              // 已被移除
            }
            return;
          }
        }
        try {
          entity.teleport(pos);
        } catch {
          // 实体失效,下一拍由召唤系统清理
        }
      },
      onExpire: () => {
        // 飞行 2 秒未命中任何目标:不进冷却(堆叠由 requestCooldown 0 回满)
        if (!resolved) {
          ctx.primitives.requestCooldown(ctx.casterId, "snd5:ranger_time_seed", SEED_COOLDOWN_ON_MISS);
        }
      },
    });
    if (spawned) {
      try {
        spawned.nameTag = "§d时光种子";
      } catch {
        // 占位表现失败不影响结算
      }
    }
    // 冷却由命中/落空分支显式申请(suppressCooldown:堆叠已扣,等待分支结算)
    return spawned ? { ok: true, suppressCooldown: true } : false;
  },
});

// ── 固有Ⅱ 加强攻击(snd5:ranger_skill_2) ────────────────────────

const EMPOWER_MANA = 18;
const EMPOWER_COOLDOWN_TICKS = 100; // 5 秒

skillRegistry.register({
  id: "snd5:ranger_empower",
  displayName: "加强攻击",
  slot: "innate_2",
  manaCost: EMPOWER_MANA,
  cooldown: EMPOWER_COOLDOWN_TICKS,
  maxStacks: 1,
  castMode: "instant",
  failureHint: { no_mana: `魔力不足(${EMPOWER_MANA})` },

  // 下次重击进阶「境界面上的#%¥&$#」+ 1 层日蚀(远点概率 +25%)
  cast(ctx) {
    const session = ctx.session;
    session.status.apply(ctx.casterId, STATUS_INTERFACE_SURGE, ctx.casterId);
    session.status.apply(ctx.casterId, STATUS_SOLAR_ECLIPSE, ctx.casterId);
    session.hud.toast(ctx.player, "§e下次重击将进阶 · §4日蚀+1§e(远点概率提升)");
    return true;
  },

  // 潜行变体:进阶 + 1 层月冕(远点概率 −25%)
  castSneaking(ctx) {
    const session = ctx.session;
    session.status.apply(ctx.casterId, STATUS_INTERFACE_SURGE, ctx.casterId);
    session.status.apply(ctx.casterId, STATUS_LUNAR_CROWN, ctx.casterId);
    session.hud.toast(ctx.player, "§e下次重击将进阶 · §9月冕+1§e(远点概率降低)");
    return true;
  },
});

// ── 固有Ⅲ 寻光信标(被动;死亡放置可部署点,部署奖励回溯状态) ──────

const BEACON_PASSIVE_COOLDOWN_TICKS = 1800; // 90 秒(仅在信标被使用后进入)

interface BeaconRecord {
  summonId: string;
  /** 死亡前一刻的三资源(combat.beforeDamage 拦截) */
  snapshot: AttributeSnapshot;
  choice?: "beacon" | "default";
}

/** 模块级 Map 跨对局存续,拼 roomId 防跨房间串扰(与 statuses 同约定) */
function beaconKey(session: MatchSession, playerId: string): string {
  return `${session.roomId}:${playerId}`;
}

const preDeathSnapshots = new Map<string, AttributeSnapshot>();
const beaconRecords = new Map<string, BeaconRecord>();

/** 死亡期间的选择表单(超时/取消 = 未使用信标) */
function showBeaconDeployForm(session: MatchSession, playerId: string, record: BeaconRecord): void {
  const state = session.players.get(playerId);
  if (!state?.player.isValid || state.alive) return;
  const key = beaconKey(session, playerId);
  const form = new ActionFormData()
    .title("§l寻光信标")
    .body(
      "§7你的寻光信标留在了阵亡之地。\n\n" +
        "§f在信标处部署§7: 保留死亡前的生命/护甲/魔力,§f2 秒内受到的伤害减少 100%§7。\n" +
        "§7回默认重生点: 信标消失,寻光信标不进入冷却。",
    )
    .button("§a在信标处部署\n§7保留死亡前状态 + 2 秒免伤")
    .button("§7回默认重生点\n§8信标消失");
  void form.show(state.player).then((response) => {
    // 响应校验:仍未重生、记录未被新一轮死亡/重生消费
    const current = session.players.get(playerId);
    if (!current?.player.isValid || current.alive) return;
    if (beaconRecords.get(key) !== record) return;
    if (response.canceled || response.selection === undefined) return;
    record.choice = response.selection === 0 ? "beacon" : "default";
  });
}

skillRegistry.register({
  id: "snd5:ranger_light_beacon",
  displayName: "寻光信标(被动)",
  slot: "passive",
  cooldown: 0,
  listen: ["combat.beforeDamage", "player.death", "player.left"],

  onEvent(event, ctx) {
    const session = ctx.session;
    const key = beaconKey(session, ctx.playerId);

    // 致命一击写入前:快照「死亡前」的三资源(命中时点即写入前时点)
    if (event.name === "combat.beforeDamage") {
      const payload = event.payload as { targetId?: string };
      if (payload.targetId !== ctx.playerId) return;
      preDeathSnapshots.set(key, session.attributes.snapshot(ctx.playerId));
      return;
    }

    // 死亡:原地放置信标(永驻,不可破坏)并弹部署选择表单
    if (event.name === "player.death") {
      const state = session.players.get(ctx.playerId);
      if (!state?.player.isValid) return;
      // 兜底:原版路径死亡(/kill)与纯真实伤害击杀(管线捷径分支)都
      // 不会发出 combat.beforeDamage,取当前账本值(hp 至少 1,防复活即死)
      const fallback = session.attributes.get(ctx.playerId);
      const snapshot =
        preDeathSnapshots.get(key) ??
        ({
          hp: Math.max(1, fallback?.current.hp ?? 1),
          armor: fallback?.current.armor ?? 0,
          mana: fallback?.current.mana ?? 0,
          timestamp: session.nowTick(),
        } satisfies AttributeSnapshot);
      preDeathSnapshots.delete(key);

      const beacon = session.primitives.spawnSummon("minecraft:armor_stand", state.player.location, {
        ownerId: ctx.playerId,
        kind: LIGHT_BEACON_KIND,
        invulnerable: true, // 不可破坏的创生物
        // 无 lifetimeTicks = 永驻,「持续至下次在任意点位重新部署」由重生流程消费
      });
      if (!beacon) return;
      try {
        beacon.nameTag = "§e寻光信标";
      } catch {
        // 占位表现失败不影响结算
      }
      const record: BeaconRecord = { summonId: beacon.id, snapshot };
      beaconRecords.set(key, record);
      session.hud.toast(state.player, "§e寻光信标已部署在阵亡之地,重生前可选择部署方式");
      // 旁观界面稳定后再弹表单;超时未作答 = 未使用信标
      session.schedule(10, () => showBeaconDeployForm(session, ctx.playerId, record));
      return;
    }

    // 离场:清理快照/记录与信标实体(会话 dispose 会兜底清扫,这里即时清理)
    if (event.name === "player.left") {
      preDeathSnapshots.delete(key);
      const record = beaconRecords.get(key);
      beaconRecords.delete(key);
      if (record) {
        const entity = ctx.primitives.getEntity(record.summonId);
        try {
          entity?.remove();
        } catch {
          // 已被移除
        }
      }
      return;
    }
  },
});

/**
 * 重生决策钩子(game.ts injects.resolveRespawn):
 * 存在信标记录时消费它 —— 选择部署则落在信标处并恢复死亡前状态;
 * 未选择/选默认/信标已失效则回默认重生点,信标一律消失。
 * 「使用了信标」才让固有Ⅲ进入 90 秒冷却(未使用不进冷却,可再次触发)。
 */
export function resolveBeaconRespawn(
  session: MatchSession,
  playerId: string,
): RespawnDecision | undefined {
  const key = beaconKey(session, playerId);
  const record = beaconRecords.get(key);
  if (!record) return undefined;
  beaconRecords.delete(key); // 重新部署即消费(无论选哪边)
  const entity = session.primitives.getEntity(record.summonId);
  const beaconLocation = entity?.isValid ? entity.location : undefined;
  // 信标实体完成使命即移除(两种分支都移除,仅位置归属不同)
  try {
    entity?.remove();
  } catch {
    // 已被移除
  }

  if (record.choice !== "beacon" || !beaconLocation) {
    // 未使用寻光信标:固有Ⅲ不进入冷却时间(内容设计 PDF 第 25 页)
    return undefined;
  }
  return {
    location: { x: beaconLocation.x, y: beaconLocation.y, z: beaconLocation.z },
    onDeployed: (deployedId) => {
      // 快照恢复:架构既定的 CombatPipeline 例外通道(溢出按面板截断)
      session.attributes.restore(deployedId, record.snapshot);
      session.status.apply(deployedId, STATUS_BEACON_AEGIS, deployedId);
      // 使用了信标 → 固有Ⅲ进入 90 秒冷却(被动就绪检查由 PassiveManager 消费)
      session.skills.startPassiveCooldown(
        deployedId,
        "snd5:ranger_light_beacon",
        BEACON_PASSIVE_COOLDOWN_TICKS,
      );
      const player = session.players.get(deployedId)?.player;
      if (player?.isValid) {
        session.hud.toast(player, "§e寻光信标部署: 保留死亡前状态,§f2 秒内伤害免疫");
      }
    },
  };
}

// ── 自定义物品绑定(组件回调路由) ────────────────────────────────

// 固有Ⅰ/Ⅱ:右键即时施放(潜行变体由 castSneaking 分发)
customItemBindings.set(RANGER_SKILL_ITEMS.innate_1, {
  skillId: "snd5:ranger_time_seed",
});
customItemBindings.set(RANGER_SKILL_ITEMS.innate_2, {
  skillId: "snd5:ranger_empower",
});
// 武器:长按右键弓式蓄力(重击)
customItemBindings.set(RANGER_WEAPON_ITEM, { skillId: "snd5:ranger_heavy" });
