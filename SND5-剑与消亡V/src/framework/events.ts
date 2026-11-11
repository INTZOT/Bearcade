// ============================================================
// SND5 类型化事件总线(SkillEventBus)
// 框架层唯一的反向通道:事件由框架定义,内容层订阅。
// - 事件只携带数据,不携带行为;
// - 需要拦截的事件(damage.lethal 等)提供 cancel();
// - 订阅返回注销函数,会话销毁时统一清理(防旧被动残留)。
// ============================================================
import type { Vec3 } from "../../../shared/minigame-core/types";
import type { DamageElement, DamageTag, TeamId } from "./types";
import type { DamagePayload, DamageResult, HealPayload, HealResult } from "./combat/types";
import type { CastOutcome } from "./skill/types";

// ── 战斗 ──────────────────────────────────────────────────────
/** 伤害计算前(完全免疫类状态在此取消,早于 onDamageTaken) */
export interface DamageBeforeEvent {
  sourceId?: string;
  targetId: string;
  payload: DamagePayload;
  cancel(): void;
}
export interface DamageAfterEvent {
  sourceId?: string;
  targetId: string;
  result: DamageResult;
}
/** 写入后(带元素与标签;被动/计分订阅) */
export interface EntityDamagedEvent {
  sourceId?: string;
  targetId: string;
  hp: number;
  armor: number;
  tempArmor: number;
  trueDamage: number;
  element: DamageElement;
  tags: DamageTag[];
  lethal: boolean;
}
/** 致死判定(可取消:控制被动拦截、水仙伴生等) */
export interface LethalDamageEvent {
  targetId: string;
  sourceId?: string;
  tags: DamageTag[];
  cancel(): void;
}
export interface EntityKilledEvent {
  killerId?: string;
  victimId: string;
  cause: string;
}

// ── 治疗 ──────────────────────────────────────────────────────
export interface HealBeforeEvent {
  sourceId?: string;
  targetId: string;
  payload: HealPayload;
  cancel(): void;
}
export interface HealAfterEvent {
  sourceId?: string;
  targetId: string;
  actual: HealResult;
}
export interface HealOverflowEvent {
  targetId: string;
  overflow: number;
}

// ── 状态 ──────────────────────────────────────────────────────
export interface StatusAppliedEvent {
  targetId: string;
  statusId: string;
  sourceId?: string;
  stacks: number;
}
export interface StatusExpiredEvent {
  targetId: string;
  statusId: string;
}
export interface StatusRemovedEvent {
  targetId: string;
  statusId: string;
  reason: string;
}
export interface StatusStacksChangedEvent {
  targetId: string;
  statusId: string;
  stacks: number;
}

// ── 技能 ──────────────────────────────────────────────────────
export interface SkillCastEvent {
  casterId: string;
  skillId: string;
  slot: string;
  outcome: CastOutcome;
}
export interface SkillCastFailedEvent {
  casterId: string;
  skillId: string;
  reason: string;
  hint?: string;
}
export interface SkillHitEvent {
  casterId: string;
  skillId: string;
  targetId: string;
}
export interface CooldownEndEvent {
  playerId: string;
  skillId: string;
}

// ── 玩家 ──────────────────────────────────────────────────────
export interface MatchStartEvent {
  playerIds: string[];
}
export interface PlayerDeathEvent {
  playerId: string;
  killerId?: string;
  cause: string;
}
export interface PlayerRespawnEvent {
  playerId: string;
}
export interface PlayerLeftEvent {
  playerId: string;
}

// ── 创生物 ─────────────────────────────────────────────────────
export interface SummonBaseEvent {
  summonId: string;
  typeId: string;
  ownerId?: string;
}
export interface SummonExpiredEvent extends SummonBaseEvent {}
export interface SummonDestroyedEvent extends SummonBaseEvent {
  reason: string;
}
export interface SummonHitEntityEvent extends SummonBaseEvent {
  targetId: string;
}
export interface SummonHitBlockEvent extends SummonBaseEvent {
  location: Vec3;
}

// ── 占点 / 分数 / 对局 ──────────────────────────────────────────
export interface PointCapturedEvent {
  pointId: string;
  teamId: TeamId;
  byPlayerIds: string[];
}
export interface PointHoldEvent {
  pointId: string;
  teamId: TeamId;
}
export interface ScoreChangedEvent {
  teamId: TeamId;
  score: number;
  delta: number;
  reason?: string;
}
export interface MatchEndEvent {
  winnerTeamId?: TeamId;
  reason: string;
}

/** 事件名 → 载荷 映射:总线的类型安全来源 */
export interface Snd5EventMap {
  "combat.beforeDamage": DamageBeforeEvent;
  "combat.afterDamage": DamageAfterEvent;
  "entity.damaged": EntityDamagedEvent;
  "damage.lethal": LethalDamageEvent;
  "entity.killed": EntityKilledEvent;
  "combat.beforeHeal": HealBeforeEvent;
  "combat.afterHeal": HealAfterEvent;
  "heal.overflow": HealOverflowEvent;
  "status.applied": StatusAppliedEvent;
  "status.expired": StatusExpiredEvent;
  "status.removed": StatusRemovedEvent;
  "status.stacksChanged": StatusStacksChangedEvent;
  "skill.cast": SkillCastEvent;
  "skill.castFailed": SkillCastFailedEvent;
  "skill.hit": SkillHitEvent;
  "cooldown.end": CooldownEndEvent;
  "match.start": MatchStartEvent;
  "player.death": PlayerDeathEvent;
  "player.respawn": PlayerRespawnEvent;
  "player.left": PlayerLeftEvent;
  "summon.expired": SummonExpiredEvent;
  "summon.destroyed": SummonDestroyedEvent;
  "summon.hitEntity": SummonHitEntityEvent;
  "summon.hitBlock": SummonHitBlockEvent;
  "point.captured": PointCapturedEvent;
  "point.hold": PointHoldEvent;
  "score.changed": ScoreChangedEvent;
  "match.end": MatchEndEvent;
}

export type Snd5EventName = keyof Snd5EventMap & string;

type AnyHandler = (payload: unknown) => void;

/**
 * 事件总线实例随 MatchSession 创建/销毁,多房间天然隔离。
 * emit 为同步调用;单个处理器异常被捕获,不污染其它处理器。
 */
export class EventBus {
  private readonly handlers = new Map<Snd5EventName, Set<AnyHandler>>();
  private readonly anyHandlers = new Set<(name: string, payload: unknown) => void>();

  on<K extends Snd5EventName>(
    event: K,
    handler: (payload: Snd5EventMap[K]) => void,
  ): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    const wrapped = handler as AnyHandler;
    set.add(wrapped);
    return () => set.delete(wrapped);
  }

  once<K extends Snd5EventName>(
    event: K,
    handler: (payload: Snd5EventMap[K]) => void,
  ): () => void {
    let off: () => void = () => {};
    off = this.on(event, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  /** 通配订阅(状态进化检查、被动事件路由使用) */
  onAny(handler: (name: string, payload: unknown) => void): () => void {
    this.anyHandlers.add(handler);
    return () => this.anyHandlers.delete(handler);
  }

  off(event: Snd5EventName, handler: AnyHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit<K extends Snd5EventName>(event: K, payload: Snd5EventMap[K]): void {
    const set = this.handlers.get(event);
    if (set) {
      for (const handler of set) {
        try {
          handler(payload);
        } catch (error) {
          console.warn(`[SND5] 事件处理器异常 ${event}`, error);
        }
      }
    }
    for (const handler of this.anyHandlers) {
      try {
        handler(event, payload);
      } catch (error) {
        console.warn(`[SND5] 通配处理器异常 ${event}`, error);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
    this.anyHandlers.clear();
  }
}

/**
 * 从事件载荷提取涉及的实体 id(状态进化/被动的"是否与我相关"判断)。
 * 约定:载荷中名为 *Id 的字符串字段视为参与者。
 */
export function extractInvolvedIds(payload: unknown): Set<string> {
  const ids = new Set<string>();
  if (typeof payload !== "object" || payload === null) return ids;
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (key.endsWith("Id") && (typeof value === "string" || Array.isArray(value))) {
      if (typeof value === "string") ids.add(value);
      else for (const item of value) if (typeof item === "string") ids.add(item);
    }
  }
  return ids;
}
