// ============================================================
// 原生事件适配层(架构文档 engine/event_bridge 的收缩形态)
// 引擎层职责由 shared/minigame-core + Core 承担(意见②),本文件只做
// 三件事:原版伤害拦截、输入事件路由(SkillSystem/SupplySystem)、
// 会话 tick 循环驱动。
//
// restricted-execution 规则:before 事件里只同步取消/改内存,
// 一切原生调用(传送/表单/生成实体)经 system.run 延后。
// ============================================================
import { GameMode, Player, system, world, type ItemStack } from "@minecraft/server";
import { sessions, type MatchSession } from "./framework/session";
import { skillItemBindings } from "./framework/skill/system";
import { customItemSkillId, isCustomSkillItem } from "./framework/skill/customItems";
import { skillRegistry } from "./framework/registry";
import { STATION_ID_PROP, STATION_TAG } from "./framework/supply";
import { SUMMON_TAG } from "./framework/summon";
import { isFeedbackBypass } from "./framework/vanilla";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { tickSnd5Sessions } from "./game";
import {
  codexItemNameTags,
  consumableItemBindings,
  handleConsumableComplete,
  handleSelectorUse,
  initProfessionSelection,
  SELECTOR_ITEM_TYPE,
  tickGrapple,
} from "./content";

let initialized = false;

/** 会话 tick 循环节奏(5 tick):状态/技能/占点/HUD 的最大公约粒度 */
const SESSION_TICK_INTERVAL = 5;

/**
 * 初始化 SND5 事件监听与 tick 循环(main.ts worldLoad 时调用一次)。
 * @param getRuntime 供 tick 循环校验房间对局状态
 */
export function initSnd5Gameplay(getRuntime: () => MinigameRuntime): void {
  if (initialized) return;
  initialized = true;

  registerDamageInterception();
  registerInputRouting();
  registerSummonHitRouting();
  registerSupplyInteraction();
  registerLifecycleGuards();
  // 准备阶段职业选择(入房发放选择道具)
  initProfessionSelection(getRuntime);

  // 会话 tick 循环:单一 interval 迭代全部会话(禁每会话一个 interval)
  system.runInterval(() => {
    tickSnd5Sessions(getRuntime);
  }, SESSION_TICK_INTERVAL);

  // 抓钩摆荡物理:全局 1 tick 循环(与 Grappling Hooks Add-On 同粒度;
  // 仍是全局单一循环 —— 非每会话一个 interval;无活跃钩爪的会话 O(1) 跳过)
  system.runInterval(() => {
    for (const session of sessions.values()) {
      try {
        tickGrapple(session);
      } catch (error) {
        console.warn("[SND5] 抓钩物理 tick 异常", error);
      }
    }
  }, 1);
}

// ── 会话定位 ──────────────────────────────────────────────────

function sessionOfPlayer(playerId: string): MatchSession | undefined {
  for (const session of sessions.values()) {
    if (session.players.has(playerId)) return session;
  }
  return undefined;
}

function sessionOfDimension(dimensionId: string): MatchSession | undefined {
  for (const session of sessions.values()) {
    if (session.dimension.id === dimensionId) return session;
  }
  return undefined;
}

/**
 * 物品 → skillId:自定义技能物品按 typeId 绑定表直查(组件回调的
 * 双保险路径用);先按 nameTag 匹配秘典物品(可用态/耗尽态两种名称
 * 都已注册),未命中回退 typeId 绑定(固有技能)。
 * 秘典占位物品与战士技能复用同一原版 typeId,名称匹配必须先行。
 */
function resolveSkillIdFromItem(itemStack: ItemStack): string | undefined {
  const custom = customItemSkillId(itemStack.typeId);
  if (custom) return custom;
  const nameTag = itemStack.nameTag;
  if (nameTag) {
    const byName = codexItemNameTags.get(nameTag);
    if (byName) return byName;
  }
  return skillItemBindings.get(itemStack.typeId);
}

// ── 1. 原版伤害拦截(CombatPipeline 收口的前置条件) ─────────────

function registerDamageInterception(): void {
  world.beforeEvents.entityHurt.subscribe((event) => {
    const hurt = event.hurtEntity;
    // 补给站载体(盔甲架占位)免伤:防被击杀破坏
    if (hurt.hasTag(STATION_TAG)) {
      event.cancel = true;
      return;
    }
    // 创生物:托管血量(maxHp)/免伤(invulnerable)的原版伤害取消并转发累计
    // (魔瘴之泉「固有生命值 60、可被破坏」);未托管的召唤物走原版耐久
    if (hurt.hasTag(SUMMON_TAG)) {
      const summonSession = sessionOfDimension(hurt.dimension.id);
      if (summonSession?.summons.isDamageShielded(hurt.id)) {
        event.cancel = true;
        const entityId = hurt.id;
        const amount = event.damage;
        if (amount > 0) {
          system.run(() => {
            try {
              summonSession.summons.handleSummonHurt(entityId, amount);
            } catch (error) {
              console.warn("[SND5] 创生物托管血量结算异常", error);
            }
          });
        }
        return;
      }
      return;
    }
    // 只拦玩家:其余非玩家实体(未托管的临时载体)走原版实体血量
    if (!(hurt instanceof Player)) return;
    // 受击反馈伤害(vanilla.ts 三步法):放行以触发原版红闪/音效/
    // 动画/击退;载体已临时抬满,该伤害绝不致死
    if (isFeedbackBypass()) return;
    // 按会话成员或房间维度匹配:倒计时/结算期玩家已在房间维度,
    // 但会话尚未创建(onGameStart 才建),这段窗口同样要免伤,
    // 否则会被原版伤害打死。
    const session = sessionOfPlayer(hurt.id) ?? sessionOfDimension(hurt.dimension.id);
    if (!session) return;
    // SND5 数值全部由 CombatPipeline 写入;原版伤害一律取消。
    // restricted-execution 下此处只允许同步取消。
    event.cancel = true;
  });
}

// ── 2. 输入事件路由 ───────────────────────────────────────────

function registerInputRouting(): void {
  // 近战攻击:原版伤害已被取消,近战数值由内容层武器结算翻译
  world.afterEvents.entityHitEntity.subscribe((event) => {
    const attacker = event.damagingEntity;
    if (!(attacker instanceof Player)) return;
    const session = sessionOfPlayer(attacker.id);
    if (!session || session.isDead(attacker.id)) return;
    const victim = event.hitEntity;
    if (!(victim instanceof Player)) return; // 攻击创生物走原版实体血量
    if (sessionOfPlayer(victim.id) !== session) return;
    system.run(() => {
      try {
        session.injects.weaponAttack?.(session, attacker.id, victim.id, attacker.isSneaking);
      } catch (error) {
        console.warn("[SND5] 武器结算异常", error);
      }
    });
  });

  // 右键使用 → 职业选择道具 / 技能入口(nameTag/typeId → skillId 由内容层绑定)
  // 自定义技能物品不在此路由:组件 onUse 已处理(即时施放/潜行效用动作),
  // 这里放行会与组件回调双触发
  world.afterEvents.itemUse.subscribe((event) => {
    if (event.itemStack.typeId === SELECTOR_ITEM_TYPE) {
      system.run(() => handleSelectorUse(event.source));
      return;
    }
    if (isCustomSkillItem(event.itemStack.typeId)) return;
    const skillId = resolveSkillIdFromItem(event.itemStack);
    if (!skillId) return;
    const player = event.source;
    const session = sessionOfPlayer(player.id);
    if (!session) return;
    system.run(() => session.skills.requestCast(player, skillId));
  });

  // 开始使用(itemStartUse)→ 蓄力/吟唱开始。
  // 自定义物品的即时技能跳过(组件 onUse 已路由,避免双触发);
  // 蓄力/前摇/吟唱类没有对应组件回调,仍由本事件进入(武器弓式蓄力)。
  world.afterEvents.itemStartUse.subscribe((event) => {
    if (isCustomSkillItem(event.itemStack.typeId)) {
      const skillId = customItemSkillId(event.itemStack.typeId);
      const def = skillId ? skillRegistry.get(skillId) : undefined;
      if ((def?.castMode ?? "instant") === "instant") return;
    }
    const skillId = resolveSkillIdFromItem(event.itemStack);
    if (!skillId) return;
    const player = event.source;
    const session = sessionOfPlayer(player.id);
    if (!session) return;
    system.run(() => session.skills.beginUse(player, skillId));
  });

  // 松手(itemReleaseUse)→ 蓄力释放 / 吟唱停止
  world.afterEvents.itemReleaseUse.subscribe((event) => {
    const player = event.source;
    const session = sessionOfPlayer(player.id);
    if (!session) return;
    system.run(() => session.skills.releaseUse(player));
  });

  // 使用完成(itemCompleteUse)→ 回复类消耗品结算 / 蓄满自动释放
  world.afterEvents.itemCompleteUse.subscribe((event) => {
    const player = event.source;
    const session = sessionOfPlayer(player.id);
    if (!session) return;
    // 回复类消耗品:物品使用完毕触发回复(原版自然消耗,中断不生效)
    const consumable = consumableItemBindings.get(event.itemStack.typeId);
    if (consumable) {
      system.run(() => handleConsumableComplete(session, player.id, consumable));
      return;
    }
    const skillId = resolveSkillIdFromItem(event.itemStack);
    if (!skillId) return;
    system.run(() => session.skills.completeUse(player, skillId));
  });
}

// ── 3. 投掷物命中转发 ─────────────────────────────────────────

/**
 * 注册投掷物命中事件,将原生事件转发给会话内的 SummonSystem 处理。
 */
function registerSummonHitRouting(): void {
  world.afterEvents.projectileHitEntity.subscribe((event) => {
    const session = sessionOfDimension(event.dimension.id);
    if (!session) return;
    const projectileId = event.projectile.id;
    if (!projectileId || !session.summons.has(projectileId)) return;
    let hitEntityId: string | undefined;
    hitEntityId = event.getEntityHit().entity?.id;
    if (!hitEntityId) return;
    session.summons.handleProjectileHitEntity(projectileId, hitEntityId);
  });

  world.afterEvents.projectileHitBlock.subscribe((event) => {
    const session = sessionOfDimension(event.dimension.id);
    if (!session) return;
    const projectileId = event.projectile.id;
    if (!projectileId || !session.summons.has(projectileId)) return;
    const { x, y, z } = event.location;
    session.summons.handleProjectileHitBlock(projectileId, { x, y, z });
  });
}

// ── 4. 补给站交互(载体实体:盔甲架占位) ────────────────────────

function registerSupplyInteraction(): void {
  // 右键载体实体:before 事件取消盔甲架原版装备界面,
  // 按 snd5:station 动态属性路由到对应站点打开补给表单。
  world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    if (!event.target.hasTag(STATION_TAG)) return;
    event.cancel = true;
    const player = event.player;
    const target = event.target;
    system.run(() => {
      const session = sessionOfPlayer(player.id);
      if (!session || !target.isValid) return;
      const stationId = target.getDynamicProperty(STATION_ID_PROP);
      if (typeof stationId !== "string") return;
      void session.supply.tryUse(player, stationId);
    });
  });
}

// ── 5. 生命周期兜底 ───────────────────────────────────────────

function registerLifecycleGuards(): void {
  // 离线即清(断线 = 退出,无热重连;syncPlayers 兜底,此处即时清理)
  world.afterEvents.playerLeave.subscribe((event) => {
    for (const session of sessions.values()) {
      if (session.players.has(event.playerId)) session.removePlayer(event.playerId);
    }
  });

  // 防御:SND5 死亡应全部为脚本死亡(原版伤害已拦截,载体血量有
  // 0.5 保底);原版死亡出现时(/kill、不可取消的伤害源)立即拉起
  // 脚本死亡流程,兜底按房间维度匹配以覆盖倒计时窗口。
  world.afterEvents.entityDie.subscribe((event) => {
    const dead = event.deadEntity;
    if (!(dead instanceof Player)) return;
    const session = sessionOfPlayer(dead.id) ?? sessionOfDimension(dead.dimension.id);
    if (!session) return;
    system.run(() => {
      try {
        dead.setGameMode(GameMode.Spectator);
      } catch {
        // 死亡等待重生界面中可能无法切换,忽略
      }
      session.handleDeath(dead.id, undefined, "vanilla");
    });
  });
}
