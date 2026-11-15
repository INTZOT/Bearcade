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
  type AppliedDamageSnapshot,
  type IncomingDamageSnapshot,
  type StatusContext,
  type StatusDamageContext,
  type StatusAfterDamageContext,
  type StatusDefinition,
  type StatusInstance,
  type StatusModifiers,
} from "./types";

/** 全局状态 tick 粒度:文档最短持续 1 秒,5 tick 足够准确 */
export const STATUS_TICK_INTERVAL = 5;

export class StatusEffectSystem {
  /** Map<entityId, Map<statusId, StatusInstance>> */
  private readonly store = new Map<string, Map<string, StatusInstance>>();
  /** 限频施加:`${targetId}::${statusId}` → 可再次施加的 tick */
  private readonly reapplyAt = new Map<string, number>();
  private readonly busOffs: Array<() => void> = [];
  private lastStatusTick = 0;

  constructor(
    private readonly session: MatchSession,
    private readonly defs: Registry<StatusDefinition>,
  ) {
    // 接通条件性取消:onDamageTaken(水仙伴生 1 次 100% 减免)。
    // combat.beforeDamage 在修饰器聚合之前发出,取消即整个伤害不结算
    // (真实伤害按设计穿透一切,不走此路)。
    this.busOffs.push(
      this.session.bus.on("combat.beforeDamage", ({ targetId, payload, cancel }) => {
        const map = this.store.get(targetId);
        if (!map || map.size === 0) return;
        const damage = {
          hp: payload.hp ?? 0,
          armor: payload.armor ?? 0,
          trueDamage: payload.trueDamage ?? 0,
          element: payload.element,
        };
        for (const instance of [...map.values()]) {
          this.defs.get(instance.id)?.onDamageTaken?.(
            makeStatusDamageContext(this.session, targetId, instance, damage, cancel),
          );
        }
      }),
    );
    // 伤害落地回调:onAfterDamaged(水仙初临累计 70 点)。
    // entity.damaged 携带账本实际写入量(含被临时护甲吸收的分量)。
    this.busOffs.push(
      this.session.bus.on("entity.damaged", ({ targetId, hp, armor, tempArmor, trueDamage, element, lethal }) => {
        const map = this.store.get(targetId);
        if (!map || map.size === 0) return;
        const damage = { hp, armor, tempArmor, trueDamage, element, lethal };
        for (const instance of [...map.values()]) {
          this.defs.get(instance.id)?.onAfterDamaged?.(
            makeStatusAfterDamageContext(this.session, targetId, instance, damage),
          );
        }
      }),
    );
  }

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

    // 限频施加(清流每 3 秒最多 1 次):冷却窗口内新施加与刷新都忽略
    const reapplyKey = `${targetId}::${statusId}`;
    const readyAt = def.reapplyCooldownTicks
      ? this.reapplyAt.get(reapplyKey)
      : undefined;
    if (readyAt !== undefined && system.currentTick < readyAt) {
      const existing = this.store.get(targetId)?.get(statusId);
      return existing;
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
      this.markReapplied(reapplyKey, def);
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
    this.markReapplied(reapplyKey, def);
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

  /**
   * 随机清空目标可清除的负面状态(净化类效果)。
   * @param limit 最多清除个数;缺省 = 全部(水仙伴生每 5 秒)
   * @returns 实际清除数
   */
  clearDebuffs(targetId: string, limit?: number): number {
    const map = this.store.get(targetId);
    if (!map || map.size === 0) return 0;
    const debuffIds = [...map.keys()].filter((statusId) => {
      const def = this.defs.get(statusId);
      return def?.kind === "debuff" && def.clearable !== false;
    });
    // Fisher-Yates 洗牌后取前 limit 个
    for (let i = debuffIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [debuffIds[i], debuffIds[j]] = [debuffIds[j], debuffIds[i]];
    }
    const selected =
      limit === undefined ? debuffIds : debuffIds.slice(0, Math.max(0, limit));
    for (const statusId of selected) {
      this.remove(targetId, statusId, "cleansed");
    }
    return selected.length;
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
      if (mods.armorDealtMul) result.armorDealtMul *= mods.armorDealtMul;
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
    for (const off of this.busOffs) off();
    this.busOffs.length = 0;
    this.reapplyAt.clear();
    this.store.clear();
  }

  // ── 内部 ─────────────────────────────────────────────────────

  /** 记录限频施加窗口(仅声明了 reapplyCooldownTicks 的状态) */
  private markReapplied(key: string, def: StatusDefinition): void {
    if (def.reapplyCooldownTicks && def.reapplyCooldownTicks > 0) {
      this.reapplyAt.set(key, system.currentTick + def.reapplyCooldownTicks);
    }
  }

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

/** 供 CombatPipeline / 钩子接线构造 StatusDamageContext */
export function makeStatusDamageContext(
  session: MatchSession,
  targetId: string,
  instance: StatusInstance,
  damage: IncomingDamageSnapshot,
  cancel: () => void,
): StatusDamageContext {
  return {
    session,
    targetId,
    statusId: instance.id,
    instance,
    removeSelf: () => session.status.remove(targetId, instance.id, "self_removed"),
    damage,
    cancel,
  };
}

/** 供 entity.damaged 接线构造 StatusAfterDamageContext */
export function makeStatusAfterDamageContext(
  session: MatchSession,
  targetId: string,
  instance: StatusInstance,
  damage: AppliedDamageSnapshot,
): StatusAfterDamageContext {
  return {
    session,
    targetId,
    statusId: instance.id,
    instance,
    removeSelf: () => session.status.remove(targetId, instance.id, "self_removed"),
    damage,
  };
}
