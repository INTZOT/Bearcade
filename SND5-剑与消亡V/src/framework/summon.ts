// ============================================================
// SummonSystem —— 投掷物与创生物(架构设计 §4.5,Bearcade 适配版)
// 修正决策:除凝固熔岩(3×3×3 不可破坏体积,用方块)外,
// 全部创生物用自定义实体承载 —— minecraft:health 组件免费获得
// 血量/受击/死亡,魔瘴之泉「可被破坏、固有生命值 60」因此成立。
//
// 飞行与命中由实体 JSON 的 minecraft:projectile 负责,脚本只负责
// 发射/标记/回调;所有脚本实体打 snd5:summon tag,会话销毁统一
// tag 扫除(对局残留零容忍,对齐 CTF entity_need_remove 先例)。
// ============================================================
import { system, type Dimension, type Entity, type Vector3 } from "@minecraft/server";
import type { Vec3 } from "../../../shared/minigame-core/types";
import type { MatchSession } from "./session";
import { normalizeVector } from "./types";

export const SUMMON_TAG = "snd5:summon";
export const OWNER_PROP = "snd5:owner";
export const TYPE_PROP = "snd5:type";

export interface SummonInstance {
  entity: Entity;
  id: string;
  typeId: string;
  ownerId?: string;
  spawnTick: number;
  /** undefined = 永驻(寻光信标) */
  expireTick?: number;
  tickIntervalTicks?: number;
  lastTickAtTick: number;
  onTick?: (entity: Entity, instance: SummonInstance) => void;
  onExpire?: (instance: SummonInstance) => void;
  projectileCallbacks?: {
    onHitEntity?(targetEntityId: string, instance: SummonInstance): void;
    onHitBlock?(location: Vec3, instance: SummonInstance): void;
  };
}

export interface SummonOptions {
  ownerId?: string;
  /** 存活时长 tick;不传 = 永驻 */
  lifetimeTicks?: number;
  /** onTick 调用间隔(默认 5) */
  tickIntervalTicks?: number;
  onTick?(entity: Entity, instance: SummonInstance): void;
  onExpire?(instance: SummonInstance): void;
}

export interface ProjectileOptions extends SummonOptions {
  /** 发射速度(格/tick) */
  speedBlocksPerTick?: number;
  onHitEntity?(targetEntityId: string, instance: SummonInstance): void;
  onHitBlock?(location: Vec3, instance: SummonInstance): void;
}

export class SummonSystem {
  private readonly active = new Map<string, SummonInstance>();

  constructor(private readonly session: MatchSession) {}

  /**
   * 生成固定/半固定创生物(魔瘴之泉、固体灵魂、寻光信标、部署点)。
   * 可破坏性与血量由实体 JSON(minecraft:health / damage_sensor)决定。
   */
  spawnSummon(typeId: string, origin: Vec3, options: SummonOptions = {}): Entity | undefined {
    return this.spawnInternal(typeId, origin, options, undefined);
  }

  /** 生成投掷物(抓钩/定锚/球状闪电/时光种子):方向冲量发射 */
  spawnProjectile(
    typeId: string,
    origin: Vec3,
    direction: Vector3,
    options: ProjectileOptions = {},
  ): Entity | undefined {
    return this.spawnInternal(typeId, origin, options, {
      direction,
      speedBlocksPerTick: options.speedBlocksPerTick ?? 1,
    });
  }

  /** 投掷物命中实体(listeners 从 projectileHitEntity 转发) */
  handleProjectileHitEntity(entityId: string, targetEntityId: string): void {
    const instance = this.active.get(entityId);
    if (!instance?.projectileCallbacks) return;
    try {
      instance.projectileCallbacks.onHitEntity?.(targetEntityId, instance);
    } catch (error) {
      console.warn(`[SND5] 投掷物命中回调异常 ${instance.typeId}`, error);
    }
    this.session.bus.emit("summon.hitEntity", {
      summonId: instance.id,
      typeId: instance.typeId,
      ownerId: instance.ownerId,
      targetId: targetEntityId,
    });
  }

  /** 投掷物命中方块(listeners 从 projectileHitBlock 转发) */
  handleProjectileHitBlock(entityId: string, location: Vec3): void {
    const instance = this.active.get(entityId);
    if (!instance?.projectileCallbacks) return;
    try {
      instance.projectileCallbacks.onHitBlock?.(location, instance);
    } catch (error) {
      console.warn(`[SND5] 投掷物落地回调异常 ${instance.typeId}`, error);
    }
    this.session.bus.emit("summon.hitBlock", {
      summonId: instance.id,
      typeId: instance.typeId,
      ownerId: instance.ownerId,
      location,
    });
  }

  /** 引爆范围内创生物(坦克引爆凝固熔岩);返回销毁数量 */
  explode(center: Vec3, radius: number, typeId?: string): number {
    let destroyed = 0;
    for (const instance of [...this.active.values()]) {
      if (typeId && instance.typeId !== typeId) continue;
      if (!instance.entity.isValid) {
        this.active.delete(instance.id);
        continue;
      }
      const loc = instance.entity.location;
      const dx = loc.x - center.x;
      const dy = loc.y - center.y;
      const dz = loc.z - center.z;
      if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
      this.destroy(instance, "exploded");
      destroyed += 1;
    }
    return destroyed;
  }

  getByOwner(ownerId: string): SummonInstance[] {
    return [...this.active.values()].filter((inst) => inst.ownerId === ownerId);
  }

  countByOwner(ownerId: string, typeId?: string): number {
    return [...this.active.values()].filter(
      (inst) => inst.ownerId === ownerId && (!typeId || inst.typeId === typeId),
    ).length;
  }

  // ── 周期与清理 ────────────────────────────────────────────────

  tick(nowTick: number): void {
    for (const instance of [...this.active.values()]) {
      // 实体被外部移除(玩家击杀创生物等):视为被破坏
      if (!instance.entity.isValid) {
        this.active.delete(instance.id);
        this.session.bus.emit("summon.destroyed", {
          summonId: instance.id,
          typeId: instance.typeId,
          ownerId: instance.ownerId,
          reason: "killed",
        });
        continue;
      }
      // 到期(定锚 6 秒消失 → summon.expired 事件驱动技能进 9s CD)
      if (instance.expireTick !== undefined && nowTick >= instance.expireTick) {
        this.active.delete(instance.id);
        try {
          instance.onExpire?.(instance);
        } catch (error) {
          console.warn(`[SND5] 创生物到期回调异常 ${instance.typeId}`, error);
        }
        this.removeEntity(instance.entity);
        this.session.bus.emit("summon.expired", {
          summonId: instance.id,
          typeId: instance.typeId,
          ownerId: instance.ownerId,
        });
        continue;
      }
      // onTick
      const interval = instance.tickIntervalTicks ?? 5;
      if (instance.onTick && nowTick - instance.lastTickAtTick >= interval) {
        instance.lastTickAtTick = nowTick;
        try {
          instance.onTick(instance.entity, instance);
        } catch (error) {
          console.warn(`[SND5] 创生物 tick 回调异常 ${instance.typeId}`, error);
        }
      }
    }
  }

  /** 清扫本会话全部创生物(dispose 时调用;tag 扫除兜底漏网实体) */
  clearAll(): void {
    for (const instance of [...this.active.values()]) {
      if (instance.entity.isValid) this.removeEntity(instance.entity);
      this.active.delete(instance.id);
    }
    try {
      for (const entity of this.session.dimension.getEntities({ tags: [SUMMON_TAG] })) {
        this.removeEntity(entity);
      }
    } catch {
      // 维度可能已卸载
    }
  }

  dispose(): void {
    this.clearAll();
  }

  // ── 内部 ─────────────────────────────────────────────────────

  private spawnInternal(
    typeId: string,
    origin: Vec3,
    options: SummonOptions,
    projectile: { direction: Vector3; speedBlocksPerTick: number } | undefined,
  ): Entity | undefined {
    try {
      // spawnEntity 的 typings 只接受原版实体标识,自定义实体 id 需显式转换
      const entity = this.session.dimension.spawnEntity(
        typeId as Parameters<Dimension["spawnEntity"]>[0],
        {
          x: origin.x,
          y: origin.y,
          z: origin.z,
        },
      );
      entity.addTag(SUMMON_TAG);
      if (options.ownerId) entity.setDynamicProperty(OWNER_PROP, options.ownerId);
      entity.setDynamicProperty(TYPE_PROP, typeId);

      if (projectile) {
        const dir = normalizeVector(projectile.direction);
        entity.applyImpulse({
          x: dir.x * projectile.speedBlocksPerTick,
          y: dir.y * projectile.speedBlocksPerTick,
          z: dir.z * projectile.speedBlocksPerTick,
        });
      }

      const now = system.currentTick;
      const instance: SummonInstance = {
        entity,
        id: entity.id,
        typeId,
        ownerId: options.ownerId,
        spawnTick: now,
        expireTick: options.lifetimeTicks !== undefined ? now + options.lifetimeTicks : undefined,
        tickIntervalTicks: options.tickIntervalTicks,
        lastTickAtTick: now,
        onTick: options.onTick,
        onExpire: options.onExpire,
        projectileCallbacks: projectile
          ? {
              onHitEntity: (options as ProjectileOptions).onHitEntity,
              onHitBlock: (options as ProjectileOptions).onHitBlock,
            }
          : undefined,
      };
      this.active.set(entity.id, instance);
      return entity;
    } catch (error) {
      console.warn(`[SND5] 生成创生物失败 ${typeId}`, error);
      return undefined;
    }
  }

  private destroy(instance: SummonInstance, reason: string): void {
    this.active.delete(instance.id);
    if (instance.entity.isValid) this.removeEntity(instance.entity);
    this.session.bus.emit("summon.destroyed", {
      summonId: instance.id,
      typeId: instance.typeId,
      ownerId: instance.ownerId,
      reason,
    });
  }

  private removeEntity(entity: Entity): void {
    try {
      entity.remove();
    } catch {
      // 已被移除
    }
  }
}
