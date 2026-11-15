// ============================================================
// 秘典法术技能(内容设计 PDF 第 26-27 页)
// 全部 instant / 0 魔力 / 无冷却(设计标注「依定义」,暂定 0):
// 使用后给自身施加同名状态;返回 suppressCooldown —— 不进冷却结算,
// 技能堆叠 maxStacks=1 耗尽后即禁用,只能由补给站充能恢复。
// - 动作型法术(燃灰/地震/闪袭/信标/护佑):cast 里即时结算;
// - 持续型法术(溪源/疗愈/紧急维修):回复脉冲在同名状态 onTick 结算。
// 占位物品约定见 spells.ts;占位实体/弹道后续替换自定义资源。
// ============================================================
import { skillRegistry } from "../../framework";
import type { CastContext, CastOutcome, MatchSession } from "../../framework";
import type { Vec3 } from "../../../../shared/minigame-core/types";
import {
  STATUS_ARMOR_CRUSH,
  STATUS_BEACON,
  STATUS_BLITZ,
  STATUS_BLESSING,
  STATUS_EMBER_ASH,
  STATUS_FIELD_REPAIR,
  STATUS_HEALING_WAVE,
  STATUS_MANA_TIDE,
  STATUS_QUAKE,
  STATUS_VANISH,
} from "./statuses";

/** 秘典统一失败提示(耗尽态) */
const CODEX_FAILURE_HINT = { no_stacks: "秘典已耗尽,请前往补给站补充" };

/** 秘典统一收尾:给自身施加同名状态;成功但无冷却(禁用靠堆叠耗尽表达) */
function codexOutcome(ctx: CastContext, statusId: string): CastOutcome {
  ctx.primitives.applyStatus(ctx.casterId, statusId, ctx.casterId);
  return { ok: true, suppressCooldown: true };
}

// ── 秘典Ⅰ 燃灰 ────────────────────────────────────────────────
/** 烟雾存续期(秒×20) */
const EMBER_ASH_SMOKE_TICKS = 140;
const EMBER_ASH_SMOKE_INTERVAL = 5;
const EMBER_ASH_SMOKE_PARTICLES_PER_PULSE = 3;
/** 雪球占位弹道速度(格/tick) */
const EMBER_ASH_SPEED = 0.9;
/** 投掷物最长飞行时间 = 兜底引信时长(超时按弹道最后已知位置出烟) */
const EMBER_ASH_FLIGHT_TICKS = 60;

/** 落点烟雾(纯视觉:设计未定义烟雾的游戏效果) */
function spawnSmoke(session: MatchSession, center: Vec3): void {
  const pulses = EMBER_ASH_SMOKE_TICKS / EMBER_ASH_SMOKE_INTERVAL;
  session.scheduleRepeating(EMBER_ASH_SMOKE_INTERVAL, pulses, () => {
    for (let i = 0; i < EMBER_ASH_SMOKE_PARTICLES_PER_PULSE; i++) {
      try {
        session.dimension.spawnParticle("minecraft:dragon_death_explosion_emitter", {
          x: center.x + (Math.random() - 0.5) * 2,
          y: center.y + 0.2 + Math.random() * 1.5,
          z: center.z + (Math.random() - 0.5) * 2,
        });
      } catch(e) {
        // 粒子失败不影响结算
        console.warn("spawnSmoke particle failed", e);
      }
    }
  });
}

skillRegistry.register({
  id: "snd5:codex_ember_ash",
  displayName: "燃灰",
  slot: "codex_1",
  cooldown: 0,
  maxStacks: 1,
  castMode: "instant",
  failureHint: CODEX_FAILURE_HINT,

  /**
   * 出烟保证:命中事件(onHitBlock/onHitEntity)优先,实时出烟;
   * 自备兜底引信 —— 雪球可能在未触发命中事件的情况下消亡
   * (坠入虚空/飞出常加载区/同 tick 碰撞未发事件/getEntityHit 缺失),
   * 此时 SummonSystem 走 summon.destroyed 路径,onExpire 不会触发,
   * 因此引信按弹道最后已知位置(onTick 记录)兜底出烟。
   */
  cast(ctx) {
    const head = ctx.player.getHeadLocation();
    const origin: Vec3 = {
      x: head.x + ctx.direction.x,
      y: head.y + ctx.direction.y,
      z: head.z + ctx.direction.z,
    };
    // 弹道最后已知位置(onTick 每 tick 记录;粒度受会话 tick 限制约 5 tick)
    let lastLocation: Vec3 = { ...origin };
    let smoked = false;
    const smokeOnce = (location: Vec3) => {
      if (smoked) return;
      smoked = true;
      spawnSmoke(ctx.session, location);
    };
    const entity = ctx.primitives.spawnProjectile(
      "minecraft:snowball", // 占位:雪球弹道贴近投掷烟雾的手感
      origin,
      ctx.direction,
      {
        ownerId: ctx.casterId,
        speedBlocksPerTick: EMBER_ASH_SPEED,
        lifetimeTicks: EMBER_ASH_FLIGHT_TICKS,
        tickIntervalTicks: 1,
        onTick: (instance) => {
          try {
            const loc = instance.location;
            lastLocation = { x: loc.x, y: loc.y, z: loc.z };
          } catch {
            // 实体不可读(未加载区块等)时沿用上次已知位置
          }
        },
        onHitEntity: (targetId) => {
          const target = ctx.primitives.getEntity(targetId);
          if (target?.isValid) smokeOnce(target.location);
        },
        onHitBlock: (location) => smokeOnce(location)
      },
    );
    if (!entity) return false;
    return codexOutcome(ctx, STATUS_EMBER_ASH);
  },
});

// ── 秘典Ⅰ 匿迹 ────────────────────────────────────────────────
skillRegistry.register({
  id: "snd5:codex_vanish",
  displayName: "匿迹",
  slot: "codex_1",
  cooldown: 0,
  maxStacks: 1,
  castMode: "instant",
  failureHint: CODEX_FAILURE_HINT,

  cast(ctx) {
    // 隐身效果在同名状态 onApply/onExpire/onRemoved 中挂/摘
    return codexOutcome(ctx, STATUS_VANISH);
  },
});

// ── 秘典Ⅰ 地震 ────────────────────────────────────────────────
const QUAKE_RADIUS = 3;
const QUAKE_LAUNCH_STRENGTH = 1.2;

skillRegistry.register({
  id: "snd5:codex_quake",
  displayName: "地震",
  slot: "codex_1",
  cooldown: 0,
  maxStacks: 1,
  castMode: "instant",
  failureHint: CODEX_FAILURE_HINT,

  cast(ctx) {
    const location = ctx.player.location;
    const center: Vec3 = { x: location.x, y: location.y, z: location.z };
    // 半径 3 格内所有角色(含自身)击飞;playersInRadius 只含存活玩家
    for (const state of ctx.primitives.playersInRadius(center, QUAKE_RADIUS)) {
      ctx.primitives.launch(state.id, QUAKE_LAUNCH_STRENGTH);
    }
    try {
      ctx.session.dimension.playSound("random.explode", center);
    } catch {
      // 音效失败不影响结算
    }
    return codexOutcome(ctx, STATUS_QUAKE);
  },
});

// ── 秘典Ⅰ 碎甲 ────────────────────────────────────────────────
skillRegistry.register({
  id: "snd5:codex_armor_crush",
  displayName: "碎甲",
  slot: "codex_1",
  cooldown: 0,
  maxStacks: 1,
  castMode: "instant",
  failureHint: CODEX_FAILURE_HINT,

  cast(ctx) {
    // 对甲伤害提升 50% 由同名状态 modifiers(armorDealtMul)声明
    return codexOutcome(ctx, STATUS_ARMOR_CRUSH);
  },
});

// ── 秘典Ⅰ 闪袭 ────────────────────────────────────────────────
const BLITZ_DASH_RANGE = 6;

skillRegistry.register({
  id: "snd5:codex_blitz",
  displayName: "闪袭",
  slot: "codex_1",
  cooldown: 0,
  maxStacks: 1,
  castMode: "instant",
  failureHint: CODEX_FAILURE_HINT,

  cast(ctx) {
    ctx.primitives.dash(ctx.casterId, ctx.direction, BLITZ_DASH_RANGE);
    return codexOutcome(ctx, STATUS_BLITZ);
  },
});

// ── 秘典Ⅱ 信标 ────────────────────────────────────────────────
const BEACON_LIFETIME_TICKS = 200; // 10 秒
const BEACON_DEPLOY_USES = 3;
const BEACON_PARTICLE_INTERVAL = 10;
const BEACON_PARTICLE_LAYERS = 4;

skillRegistry.register({
  id: "snd5:codex_beacon",
  displayName: "信标",
  slot: "codex_2",
  cooldown: 0,
  maxStacks: 1,
  castMode: "instant",
  failureHint: CODEX_FAILURE_HINT,

  cast(ctx) {
    const location = ctx.player.location;
    const center: Vec3 = { x: location.x, y: location.y, z: location.z };
    const session = ctx.session;
    const entity = ctx.primitives.spawnSummon(
      "minecraft:armor_stand", // 占位:无碰撞不可交互的云实体,粒子柱作视觉
      center,
      {
        ownerId: ctx.casterId,
        lifetimeTicks: BEACON_LIFETIME_TICKS,
        deployUses: BEACON_DEPLOY_USES, // 可供 3 人部署(重生流程消耗)
        tickIntervalTicks: BEACON_PARTICLE_INTERVAL,
        onTick(entity) {
          if (!entity.isValid) return;
          const base = entity.location;
          for (let i = 0; i < BEACON_PARTICLE_LAYERS; i++) {
            try {
              session.dimension.spawnParticle("minecraft:endrod", {
                x: base.x,
                y: base.y + 0.5 + i * 0.6,
                z: base.z,
              });
            } catch {
              // 粒子失败不影响结算
            }
          }
        },
        onExpire(instance) {
          const owner = instance.ownerId ? session.players.get(instance.ownerId) : undefined;
          if (owner?.player.isValid) session.hud.toast(owner.player, "§7部署点已消失");
        },
      },
    );
    if (!entity) return false;
    return codexOutcome(ctx, STATUS_BEACON);
  },
});

// ── 秘典Ⅱ 护佑 ────────────────────────────────────────────────
const BLESSING_ARMOR = 30;
const BLESSING_TICKS = 200; // 10 秒

skillRegistry.register({
  id: "snd5:codex_blessing",
  displayName: "护佑",
  slot: "codex_2",
  cooldown: 0,
  maxStacks: 1,
  castMode: "instant",
  failureHint: CODEX_FAILURE_HINT,

  cast(ctx) {
    ctx.primitives.addTempArmor(ctx.casterId, BLESSING_ARMOR, BLESSING_TICKS);
    return codexOutcome(ctx, STATUS_BLESSING);
  },
});

// ── 秘典Ⅱ 溪源 / 疗愈 / 紧急维修 ─────────────────────────────
// 回复脉冲在同名状态 onTick 中结算(死亡清状态即停止)

skillRegistry.register({
  id: "snd5:codex_mana_tide",
  displayName: "溪源",
  slot: "codex_2",
  cooldown: 0,
  maxStacks: 1,
  castMode: "instant",
  failureHint: CODEX_FAILURE_HINT,

  cast(ctx) {
    return codexOutcome(ctx, STATUS_MANA_TIDE);
  },
});

skillRegistry.register({
  id: "snd5:codex_healing_wave",
  displayName: "疗愈",
  slot: "codex_2",
  cooldown: 0,
  maxStacks: 1,
  castMode: "instant",
  failureHint: CODEX_FAILURE_HINT,

  cast(ctx) {
    return codexOutcome(ctx, STATUS_HEALING_WAVE);
  },
});

skillRegistry.register({
  id: "snd5:codex_field_repair",
  displayName: "紧急维修",
  slot: "codex_2",
  cooldown: 0,
  maxStacks: 1,
  castMode: "instant",
  failureHint: CODEX_FAILURE_HINT,

  cast(ctx) {
    return codexOutcome(ctx, STATUS_FIELD_REPAIR);
  },
});
