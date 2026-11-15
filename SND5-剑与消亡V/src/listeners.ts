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
import { isFeedbackBypass } from "./framework/vanilla";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { tickSnd5Sessions } from "./game";
import {
  codexItemNameTags,
  handleSelectorUse,
  initProfessionSelection,
  SELECTOR_ITEM_TYPE,
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
 * 物品 → skillId:先按 nameTag 匹配秘典物品(可用态/耗尽态两种名称
 * 都已注册),未命中回退 typeId 绑定(固有技能)。
 * 秘典占位物品与战士技能复用同一原版 typeId,名称匹配必须先行。
 */
function resolveSkillIdFromItem(itemStack: ItemStack): string | undefined {
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
    // 只拦玩家:创生物(魔瘴之泉 60HP 等)走原版实体血量
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
  world.afterEvents.itemUse.subscribe((event) => {
    if (event.itemStack.typeId === SELECTOR_ITEM_TYPE) {
      system.run(() => handleSelectorUse(event.source));
      return;
    }
    const skillId = resolveSkillIdFromItem(event.itemStack);
    if (!skillId) return;
    const player = event.source;
    const session = sessionOfPlayer(player.id);
    if (!session) return;
    system.run(() => session.skills.requestCast(player, skillId));
  });

  // 开始使用(itemStartUse)→ 蓄力/吟唱开始
  world.afterEvents.itemStartUse.subscribe((event) => {
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

  // 使用完成(itemCompleteUse)→ 蓄满自动释放
  world.afterEvents.itemCompleteUse.subscribe((event) => {
    const skillId = resolveSkillIdFromItem(event.itemStack);
    if (!skillId) return;
    const player = event.source;
    const session = sessionOfPlayer(player.id);
    if (!session) return;
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

// ── 4. 补给站交互 ─────────────────────────────────────────────

function registerSupplyInteraction(): void {
  world.afterEvents.playerInteractWithBlock.subscribe((event) => {
    const player = event.player;
    const session = sessionOfPlayer(player.id);
    if (!session) return;
    const block = event.block;
    const station = session.supply.findStation(block.dimension.id, {
      x: block.location.x,
      y: block.location.y,
      z: block.location.z,
    });
    if (!station) return;
    system.run(() => {
      void session.supply.tryUse(player, station.id);
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
