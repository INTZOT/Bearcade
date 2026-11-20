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
import { normalizeVector, type TeamId } from "./types";

export const SUMMON_TAG = "snd5:summon";
export const OWNER_PROP = "snd5:owner";
export const TYPE_PROP = "snd5:type";
/** 部署点剩余部署次数(秘典信标;重生时消耗) */
export const DEPLOY_USES_PROP = "snd5:uses";
/** 语义类型标记(魔瘴之泉/固体灵魂等盔甲架占位实体的区分键) */
export const KIND_PROP = "snd5:kind";
/** 脚本托管血量(魔瘴之泉 60:原版伤害取消,累计到此值即被破坏) */
export const HP_PROP = "snd5:hp";

export interface SummonInstance {
  entity: Entity;
  id: string;
  typeId: string;
  ownerId?: string;
  /** 语义类型(内容层区分同类占位实体;如 snd5:miasma_spring) */
  kind?: string;
  /** 脚本托管血量上限(设置后原版伤害取消,由 handleSummonHurt 累计) */
  maxHp?: number;
  /** 免伤(固体灵魂:不应被击杀绕过拾取惩罚) */
  invulnerable?: boolean;
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
  /** 语义类型标记(getByKind 查询/跨创生物联动用) */
  kind?: string;
  /**
   * 脚本托管血量:设置后 listeners 取消该实体的原版伤害并转发累计,
   * 满 maxHp 即被破坏(summon.destroyed reason "broken")。
   * 盔甲架占位实体的「固有生命值 N」由此表达;自定义实体(minecraft:health)
   * 落地后可弃用本机制。
   */
  maxHp?: number;
  /** 免伤:原版伤害一律取消(不累计) */
  invulnerable?: boolean;
  /** 存活时长 tick;不传 = 永驻 */
  lifetimeTicks?: number;
  /** onTick 调用间隔(默认 5) */
  tickIntervalTicks?: number;
  /** 部署点可用次数(秘典信标);写入实体动态属性,重生流程经 consumeDeployPoint 消耗 */
  deployUses?: number;
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

  /**
   * 引爆范围内创生物(坦克引爆凝固熔岩);返回销毁数量。
   * filter:字符串 = 按 typeId 过滤;对象 = 按语义类型(kind)过滤 ——
   * 盔甲架占位下全部创生物 typeId 相同,跨类型筛选必须走 kind。
   */
  explode(center: Vec3, radius: number, filter?: string | { kind?: string }): number {
    const typeId = typeof filter === "string" ? filter : undefined;
    const kind = typeof filter === "object" ? filter?.kind : undefined;
    let destroyed = 0;
    for (const instance of [...this.active.values()]) {
      if (typeId && instance.typeId !== typeId) continue;
      if (kind && instance.kind !== kind) continue;
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

  /**
   * 消耗本队一个可用部署点(秘典信标):找到即扣 1 次数并返回其位置。
   * 无可用部署点返回 undefined,由调用方回退到默认重生点。
   */
  consumeDeployPoint(teamId: TeamId): Vec3 | undefined {
    for (const instance of this.active.values()) {
      if (!instance.entity.isValid) continue;
      const ownerTeam = this.session.teams.getTeam(instance.ownerId ?? "");
      if (ownerTeam !== teamId) continue;
      const uses = instance.entity.getDynamicProperty(DEPLOY_USES_PROP);
      if (typeof uses !== "number" || uses <= 0) continue;
      instance.entity.setDynamicProperty(DEPLOY_USES_PROP, uses - 1);
      const loc = instance.entity.location;
      return { x: loc.x, y: loc.y, z: loc.z };
    }
    return undefined;
  }

  /**
   * 是否为本会话的投掷物/创生物
   */
  has(entityId: string): boolean {
    return this.active.has(entityId);
  }

  getByOwner(ownerId: string): SummonInstance[] {
    return [...this.active.values()].filter((inst) => inst.ownerId === ownerId);
  }

  countByOwner(ownerId: string, typeId?: string): number {
    return [...this.active.values()].filter(
      (inst) => inst.ownerId === ownerId && (!typeId || inst.typeId === typeId),
    ).length;
  }

  /** 按语义类型查询(固体灵魂寻找最近的魔瘴之泉等跨创生物联动) */
  getByKind(kind: string): SummonInstance[] {
    return [...this.active.values()].filter((inst) => inst.kind === kind);
  }

  countByKind(kind: string): number {
    return this.getByKind(kind).length;
  }

  /**
   * 该创生物是否托管伤害(listeners entityHurt 据此取消原版结算):
   * 脚本托管血量(maxHp)或声明免伤(invulnerable)的占位实体。
   */
  isDamageShielded(entityId: string): boolean {
    const instance = this.active.get(entityId);
    return !!instance && (instance.invulnerable === true || instance.maxHp !== undefined);
  }

  /**
   * 托管血量结算(listeners 从 entityHurt 转发,原版伤害已被取消):
   * 累计到 maxHp 即破坏(魔瘴之泉「固有生命值 60、可被破坏」)。
   */
  handleSummonHurt(entityId: string, amount: number): void {
    const instance = this.active.get(entityId);
    if (!instance || instance.maxHp === undefined || amount <= 0) return;
    if (!instance.entity.isValid) return;
    const current = instance.entity.getDynamicProperty(HP_PROP);
    const hp = (typeof current === "number" ? current : instance.maxHp) - amount;
    if (hp <= 0) {
      this.destroy(instance, "broken");
    } else {
      instance.entity.setDynamicProperty(HP_PROP, hp);
    }
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
    } catch (e) {
      console.warn("[SND5] 清扫创生物实体失败", e);
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
      if (options.kind) entity.setDynamicProperty(KIND_PROP, options.kind);
      if (options.maxHp !== undefined) entity.setDynamicProperty(HP_PROP, options.maxHp);
      if (options.deployUses !== undefined) {
        entity.setDynamicProperty(DEPLOY_USES_PROP, options.deployUses);
      }

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
        kind: options.kind,
        maxHp: options.maxHp,
        invulnerable: options.invulnerable,
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
    } catch (e) {
      console.warn(`[SND5] 移除创生物实体失败 ${entity.id}`, e);
      // 已被移除
    }
  }
}
