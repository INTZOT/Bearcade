// ============================================================
// StatusEffectSystem —— 规则表(架构设计 §4.2)
// 管理 30 余种状态的实例、层数、持续时间、互斥与转移,
// 并向 CombatPipeline 提供修饰器聚合。不认识伤害数值。
//
// 会话化改造:实例存储随 MatchSession 创建/销毁;全局单 tick 批量
// 调度(严禁每个状态实例一个 interval)。
// ============================================================
import { system } from "@minecraft/server";
import type { Registry } from "../registry";
import type { MatchSession } from "../session";
import {
  NEUTRAL_MODS,
  type AggregatedMods,
  type StatusContext,
  type StatusDamageContext,
  type StatusDefinition,
  type StatusInstance,
  type StatusModifiers,
} from "./types";

/** 全局状态 tick 粒度:文档最短持续 1 秒,5 tick 足够准确 */
export const STATUS_TICK_INTERVAL = 5;

export class StatusEffectSystem {
  /** Map<entityId, Map<statusId, StatusInstance>> */
  private readonly store = new Map<string, Map<string, StatusInstance>>();
  private lastStatusTick = 0;

  constructor(
    private readonly session: MatchSession,
    private readonly defs: Registry<StatusDefinition>,
  ) {}

  // ── 施加 / 移除 ───────────────────────────────────────────────

  apply(
    targetId: string,
    statusId: string,
    sourceId?: string,
    options?: { stacks?: number; durationTicks?: number; payload?: Record<string, number | boolean | string> },
  ): StatusInstance | undefined {
    const def = this.defs.get(statusId);
    if (!def) {
      console.warn(`[SND5] 未注册的状态: ${statusId}`);
      return undefined;
    }
    let map = this.store.get(targetId);
    if (!map) {
      map = new Map();
      this.store.set(targetId, map);
    }

    const existing = map.get(statusId);
    if (existing) {
      if (def.freezeAtMax && existing.stacks >= def.maxStacks) return existing;
      if (def.reapplyable === false) return existing;
      if (def.stackMode !== "stack") {
        existing.remainingTicks = options?.durationTicks ?? def.durationTicks;
        def.onRefresh?.(this.context(targetId, existing));
      }
      if (def.stackMode !== "refresh") {
        const before = existing.stacks;
        existing.stacks = Math.min(def.maxStacks, existing.stacks + (options?.stacks ?? 1));
        if (existing.stacks !== before) {
          def.onStacksChanged?.(this.context(targetId, existing));
          this.session.bus.emit("status.stacksChanged", {
            targetId,
            statusId,
            stacks: existing.stacks,
          });
        }
      }
      return existing;
    }

    // 1. 互斥:先清空互斥状态
    for (const excluded of def.excludes ?? []) {
      this.remove(targetId, excluded, "excluded");
    }

    // 2. 新建实例
    const instance: StatusInstance = {
      id: statusId,
      stacks: Math.max(1, Math.min(def.maxStacks, options?.stacks ?? 1)),
      remainingTicks: options?.durationTicks ?? def.durationTicks,
      sourceId,
      appliedAtTick: system.currentTick,
      lastTickAtTick: system.currentTick,
      payload: { ...(options?.payload ?? {}) },
    };
    map.set(statusId, instance);
    def.onApply?.(this.context(targetId, instance));
    this.session.bus.emit("status.applied", {
      targetId,
      statusId,
      sourceId,
      stacks: instance.stacks,
    });
    return instance;
  }

  remove(targetId: string, statusId: string, reason = "removed"): void {
    const map = this.store.get(targetId);
    const instance = map?.get(statusId);
    if (!map || !instance) return;
    const def = this.defs.get(statusId);
    map.delete(statusId);
    def?.onRemoved?.(this.context(targetId, instance));
    this.session.bus.emit("status.removed", { targetId, statusId, reason });
  }

  /**
   * 清空目标全部状态。死亡时传 onlyClearable=false(死亡清一切,
   * 含不可清除状态);净化类技能传 true(默认)跳过不可清除状态。
   */
  clearAll(targetId: string, onlyClearable = true): void {
    const map = this.store.get(targetId);
    if (!map) return;
    for (const statusId of [...map.keys()]) {
      if (onlyClearable && this.defs.get(statusId)?.clearable === false) continue;
      this.remove(targetId, statusId, "cleared");
    }
  }

  // ── 查询门面( CombatPipeline / 技能经此读取,不直接摸 Map) ────

  has(targetId: string, statusId: string): boolean {
    return this.store.get(targetId)?.has(statusId) ?? false;
  }

  getStacks(targetId: string, statusId: string): number {
    return this.store.get(targetId)?.get(statusId)?.stacks ?? 0;
  }

  getInstance(targetId: string, statusId: string): StatusInstance | undefined {
    return this.store.get(targetId)?.get(statusId);
  }

  /** 只读快照(数组拷贝),防止遍历中被修改/意外写状态 */
  getAll(targetId: string): readonly StatusInstance[] {
    const map = this.store.get(targetId);
    return map ? [...map.values()] : [];
  }

  getPayload(targetId: string, statusId: string): Record<string, number | boolean | string> {
    return this.getInstance(targetId, statusId)?.payload ?? {};
  }

  updatePayload(
    targetId: string,
    statusId: string,
    updater: (payload: Record<string, number | boolean | string>) => void,
  ): void {
    const instance = this.getInstance(targetId, statusId);
    if (!instance) return;
    updater(instance.payload);
  }

  // ── 框架级特殊机制(按 flags 声明,收束类状态用) ────────────────

  findHealInterceptor(targetId: string): StatusInstance | undefined {
    return this.getAll(targetId).find(
      (inst) => this.defs.get(inst.id)?.flags?.healIntercept === true,
    );
  }

  findRegenInterceptor(targetId: string): StatusInstance | undefined {
    return this.getAll(targetId).find(
      (inst) => this.defs.get(inst.id)?.flags?.regenIntercept === true,
    );
  }

  // ── 修饰器聚合( CombatPipeline 阶段 3) ────────────────────────

  aggregate(targetId: string): AggregatedMods {
    const result: AggregatedMods = { ...NEUTRAL_MODS };
    for (const instance of this.getAll(targetId)) {
      const def = this.defs.get(instance.id);
      if (!def?.modifiers) continue;
      const mods: StatusModifiers | undefined =
        typeof def.modifiers === "function" ? def.modifiers(instance) : def.modifiers;
      if (!mods) continue;
      if (mods.damageTakenMul) result.takenMul *= mods.damageTakenMul;
      if (mods.damageTakenFlat) result.takenFlat += mods.damageTakenFlat;
      if (mods.damageDealtMul) result.dealtMul *= mods.damageDealtMul;
      if (mods.damageDealtFlat) result.dealtFlat += mods.damageDealtFlat;
      if (mods.damageReductionMul) result.reductionMul *= mods.damageReductionMul;
      if (mods.damageReductionFlat) result.reductionFlat += mods.damageReductionFlat;
      if (mods.healingTakenMul) result.healingMul *= mods.healingTakenMul;
      if (mods.moveSpeedMul) result.moveSpeedMul *= mods.moveSpeedMul;
    }
    return result;
  }

  /** 移速聚合倍率(内容层据此应用原版速度效果) */
  getMoveSpeedMul(targetId: string): number {
    return this.aggregate(targetId).moveSpeedMul;
  }

  // ── 批量 tick ─────────────────────────────────────────────────

  tick(nowTick: number): void {
    if (nowTick - this.lastStatusTick < STATUS_TICK_INTERVAL) return;
    this.lastStatusTick = nowTick;

    for (const [entityId, map] of this.store) {
      for (const statusId of [...map.keys()]) {
        const instance = map.get(statusId);
        if (!instance) continue;
        const def = this.defs.get(statusId);
        if (!def) {
          map.delete(statusId);
          continue;
        }

        // 到期检查(-1 为永久状态)
        if (def.durationTicks >= 0) {
          instance.remainingTicks -= STATUS_TICK_INTERVAL;
          if (instance.remainingTicks <= 0) {
            map.delete(statusId);
            def.onExpire?.(this.context(entityId, instance));
            this.session.bus.emit("status.expired", { targetId: entityId, statusId });
            continue;
          }
        }

        // onTick 按各自 tickInterval 独立控制
        const interval = def.tickIntervalTicks ?? STATUS_TICK_INTERVAL;
        if (def.onTick && nowTick - instance.lastTickAtTick >= interval) {
          instance.lastTickAtTick = nowTick;
          def.onTick?.(this.context(entityId, instance));
        }
      }
      if (map.size === 0) this.store.delete(entityId);
    }
  }

  // ── 状态进化(事件驱动,由会话总线转发) ─────────────────────────

  /**
   * 电流涌动→电流进发、水仙初临→水仙伴生等转化:
   * triggerEvent 命中且事件涉及携带者时统一检查,技能不写转化逻辑。
   */
  handleEventForEvolve(eventName: string, involvedIds: ReadonlySet<string>): void {
    for (const [entityId, map] of this.store) {
      if (!involvedIds.has(entityId)) continue;
      for (const statusId of [...map.keys()]) {
        const evolve = this.defs.get(statusId)?.evolve;
        if (!evolve || evolve.triggerEvent !== eventName) continue;
        const instance = map.get(statusId);
        if (!instance) continue;
        const keepStacks = evolve.keepStacks === true ? instance.stacks : undefined;
        map.delete(statusId);
        this.session.bus.emit("status.removed", {
          targetId: entityId,
          statusId,
          reason: "evolved",
        });
        this.apply(entityId, evolve.to, instance.sourceId, {
          stacks: keepStacks,
        });
      }
    }
  }

  dispose(): void {
    this.store.clear();
  }

  // ── 内部 ─────────────────────────────────────────────────────

  private context(targetId: string, instance: StatusInstance): StatusContext {
    const session = this.session;
    return {
      session,
      targetId,
      statusId: instance.id,
      instance,
      removeSelf: () => this.remove(targetId, instance.id, "self_removed"),
    };
  }
}

/** 供 CombatPipeline 构造 StatusDamageContext */
export function makeStatusDamageContext(
  session: MatchSession,
  targetId: string,
  instance: StatusInstance,
  cancel: () => void,
): StatusDamageContext {
  return {
    session,
    targetId,
    statusId: instance.id,
    instance,
    removeSelf: () => session.status.remove(targetId, instance.id, "self_removed"),
    cancel,
  };
}
