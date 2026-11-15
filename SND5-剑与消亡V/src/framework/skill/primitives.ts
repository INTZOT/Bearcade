// ============================================================
// 效果原语 Primitives(架构设计 §4.4.6)
// 31 个技能的动作类型高度收敛,技能定义 = 原语的组合。
// 三重价值:
// 1. 可测:mock session 即可断言技能调用了哪些原语;
// 2. 数值集中:范围/角度/筛选统一收口;
// 3. 防越权:技能摸不到 @minecraft/server,不可能绕过 CombatPipeline。
// ============================================================
import { world, type Entity, type Player, type Vector3, type VectorXZ } from "@minecraft/server";
import type { Vec3 } from "../../../../shared/minigame-core/types";
import type { MatchSession, PlayerState } from "../session";
import type { IndicatorHandle, IndicatorOptions, IndicatorSpec } from "../indicator";
import type { DamagePayload } from "../combat/types";
import type { HealPayload } from "../combat/types";
import type { AttributeSnapshot } from "../attribute";
import type { CooldownBranchName, SkillSlot } from "./types";
import { normalizeVector } from "../types";

/** 区域/扇形伤害的目标过滤器(基于会话玩家状态) */
export type AreaDamageFilter = (state: PlayerState) => boolean;

/** 范围伤害结果:命中数/实际造成生命伤害合计/受击目标(供附加状态) */
export interface AreaDamageOutcome {
  hits: number;
  damage: number;
  targets: string[];
}

export class Primitives {
  constructor(private readonly session: MatchSession) {}

  // ── 伤害 ─────────────────────────────────────────────────────

  dealDamage(sourceId: string | undefined, targetId: string, payload: DamagePayload) {
    return this.session.combat.dealDamage(sourceId, targetId, payload);
  }

  /** 圆形范围伤害(默认只对存活玩家;filter 进一步筛选敌方/友方) */
  dealAreaDamage(
    sourceId: string | undefined,
    center: Vec3,
    radius: number,
    payload: DamagePayload,
    filter?: AreaDamageFilter,
  ): AreaDamageOutcome {
    const outcome: AreaDamageOutcome = { hits: 0, damage: 0, targets: [] };
    for (const state of this.playersInRadius(center, radius)) {
      if (filter && !filter(state)) continue;
      const result = this.session.combat.dealDamage(sourceId, state.id, payload);
      if (result) {
        outcome.hits += 1;
        outcome.damage += result.hp;
        outcome.targets.push(state.id);
      }
    }
    return outcome;
  }

  /** 扇形范围伤害(角度以 direction 为中线,angleDegrees 为全角,水平面判定) */
  dealSectorDamage(
    sourceId: string | undefined,
    center: Vec3,
    direction: Vector3,
    radius: number,
    angleDegrees: number,
    payload: DamagePayload,
    filter?: AreaDamageFilter,
  ): AreaDamageOutcome {
    const outcome: AreaDamageOutcome = { hits: 0, damage: 0, targets: [] };
    const dirXZ = normalizeVector({ x: direction.x, y: 0, z: direction.z });
    for (const state of this.playersInRadius(center, radius)) {
      if (filter && !filter(state)) continue;
      const toTarget = normalizeVector({
        x: state.player.location.x - center.x,
        y: 0,
        z: state.player.location.z - center.z,
      });
      const dot = dirXZ.x * toTarget.x + dirXZ.z * toTarget.z;
      const halfAngle = (angleDegrees / 2) * (Math.PI / 180);
      if (Math.acos(Math.max(-1, Math.min(1, dot))) <= halfAngle) {
        const result = this.session.combat.dealDamage(sourceId, state.id, payload);
        if (result) {
          outcome.hits += 1;
          outcome.damage += result.hp;
          outcome.targets.push(state.id);
        }
      }
    }
    return outcome;
  }

  // ── 状态 ─────────────────────────────────────────────────────

  applyStatus(
    targetId: string,
    statusId: string,
    sourceId?: string,
    options?: { stacks?: number; durationTicks?: number },
  ) {
    return this.session.status.apply(targetId, statusId, sourceId, options);
  }

  applyStatusToArea(
    sourceId: string | undefined,
    center: Vec3,
    radius: number,
    statusId: string,
    options?: { stacks?: number; durationTicks?: number },
    filter?: AreaDamageFilter,
  ): void {
    for (const state of this.playersInRadius(center, radius)) {
      if (filter && !filter(state)) continue;
      this.session.status.apply(state.id, statusId, sourceId, options);
    }
  }

  clearStatus(targetId: string, statusId: string): void {
    this.session.status.remove(targetId, statusId, "skill");
  }

  hasStatus(targetId: string, statusId: string): boolean {
    return this.session.status.has(targetId, statusId);
  }

  getStacks(targetId: string, statusId: string): number {
    return this.session.status.getStacks(targetId, statusId);
  }

  /** 随机清空目标可清除的负面状态(limit 缺省 = 全部;水仙系列净化) */
  clearDebuffs(targetId: string, limit?: number): number {
    return this.session.status.clearDebuffs(targetId, limit);
  }

  // ── 资源(治疗走管线,受治疗修正/收束影响) ─────────────────────

  heal(targetId: string, amount: number) {
    return this.session.combat.heal(undefined, targetId, { amount });
  }

  healFull(sourceId: string | undefined, targetId: string, payload: HealPayload) {
    return this.session.combat.heal(sourceId, targetId, payload);
  }

  restoreMana(targetId: string, amount: number): number {
    return this.session.attributes.restoreMana(targetId, amount);
  }

  restoreArmor(targetId: string, amount: number): number {
    return this.session.attributes.restoreArmor(targetId, amount);
  }

  addTempArmor(targetId: string, amount: number, durationTicks: number): void {
    this.session.attributes.addTempArmor(targetId, amount, durationTicks);
  }

  /** 消耗生命值(辅助固有Ⅰ 扣 25% 当前生命):走真实伤害,可致死 */
  consumeHp(targetId: string, amount: number): void {
    this.session.combat.dealDamage(targetId, targetId, {
      trueDamage: amount,
      element: "physical",
      tags: ["skill"],
    });
  }

  // ── 位移 ─────────────────────────────────────────────────────

  dash(playerId: string, direction: Vector3, distanceBlocks: number): void {
    const player = this.getPlayer(playerId);
    if (!player?.isValid) return;
    const dir = normalizeVector(direction);
    if (dir.x === 0 && dir.y === 0 && dir.z === 0) return;
    try {
      player.teleport({
        x: player.location.x + dir.x * distanceBlocks,
        y: player.location.y + dir.y * distanceBlocks,
        z: player.location.z + dir.z * distanceBlocks,
      });
    } catch {
      // 目标区块未加载等,忽略
    }
  }

  teleport(playerId: string, location: Vec3): void {
    const player = this.getPlayer(playerId);
    if (!player?.isValid) return;
    try {
      player.teleport({ x: location.x, y: location.y, z: location.z });
    } catch {
      // 忽略
    }
  }

  /** 牵拉:每 tick 朝目标点施加冲量(抓钩命中玩家:每秒 3 格牵拉 2 秒) */
  pull(
    targetId: string,
    toward: Vec3,
    options: { speedBlocksPerSecond: number; durationTicks: number },
  ): void {
    this.scheduleRepeating(1, options.durationTicks, () => {
      const player = this.getPlayer(targetId);
      if (!player?.isValid) return;
      const dir = normalizeVector({
        x: toward.x - player.location.x,
        y: toward.y - player.location.y,
        z: toward.z - player.location.z,
      });
      const strength = options.speedBlocksPerSecond / 20;
      player.applyImpulse({ x: dir.x * strength, y: dir.y * strength, z: dir.z * strength });
    });
  }

  knockback(targetId: string, direction: VectorXZ, horizontalStrength: number, verticalStrength: number): void {
    const player = this.getPlayer(targetId);
    if (!player?.isValid) return;
    const dir = normalizeVector({ x: direction.x, y: 0, z: direction.z });
    try {
      player.applyKnockback({ x: dir.x * horizontalStrength, z: dir.z * horizontalStrength }, verticalStrength);
    } catch {
      // 忽略
    }
  }

  /** 击飞(焙烧反应/地震秘典) */
  launch(targetId: string, verticalStrength: number): void {
    this.knockback(targetId, { x: 0, z: 0 }, 0, verticalStrength);
  }

  // ── 投射物 / 创生物 ───────────────────────────────────────────

  spawnProjectile(
    typeId: string,
    origin: Vec3,
    direction: Vector3,
    options: Parameters<MatchSession["summons"]["spawnProjectile"]>[3],
  ): Entity | undefined {
    return this.session.summons.spawnProjectile(typeId, origin, direction, options);
  }

  spawnSummon(
    typeId: string,
    origin: Vec3,
    options: Parameters<MatchSession["summons"]["spawnSummon"]>[2],
  ): Entity | undefined {
    return this.session.summons.spawnSummon(typeId, origin, options);
  }

  /** 引爆范围内创生物(坦克凝固熔岩) */
  explodeSummons(center: Vec3, radius: number, typeId?: string): number {
    return this.session.summons.explode(center, radius, typeId);
  }

  getEntity(entityId: string): Entity | undefined {
    try {
      return world.getEntity(entityId);
    } catch {
      return undefined;
    }
  }

  // ── 指示器(纯表现;详见 framework/indicator.ts) ───────────────

  /**
   * 显示攻击指示器(圆形/扇形/直线,可传数组组合):
   * 蓄力/前摇/吟唱类技能优先用 SkillDefinition.indicator 声明式字段
   * (自动跟随与回收);本接口用于即时落点闪烁等命令式场景。
   */
  showIndicator(
    ownerId: string,
    spec: IndicatorSpec | IndicatorSpec[],
    options?: IndicatorOptions,
  ): IndicatorHandle {
    return this.session.indicators.show(ownerId, spec, options);
  }

  /** 停掉该玩家的全部指示器(进行中的施法指示器下一拍会重建) */
  stopIndicators(ownerId: string): void {
    this.session.indicators.stopForPlayer(ownerId);
  }

  // ── 时间与调度(会话销毁自动取消,施法者死亡由内容层自行判断) ──

  schedule(delayTicks: number, callback: () => void): void {
    this.session.schedule(delayTicks, callback);
  }

  scheduleRepeating(intervalTicks: number, times: number, callback: (run: number) => void): void {
    this.session.scheduleRepeating(intervalTicks, times, callback);
  }

  // ── 快照(时间回溯/寻光信标) ─────────────────────────────────

  snapshot(targetId: string): AttributeSnapshot | undefined {
    if (!this.session.attributes.get(targetId)) return undefined;
    return this.session.attributes.snapshot(targetId);
  }

  restore(targetId: string, snap: AttributeSnapshot): void {
    this.session.attributes.restore(targetId, snap);
  }

  /** 双方互换生命/护甲/魔力快照(单法时光种子) */
  swapSnapshot(aId: string, bId: string): void {
    const snapA = this.session.attributes.snapshot(aId);
    const snapB = this.session.attributes.snapshot(bId);
    this.session.attributes.restore(aId, snapB);
    this.session.attributes.restore(bId, snapA);
  }

  // ── 冷却与堆叠(只读 + 请求,技能不直写 CooldownStore) ─────────

  /** 显式请求冷却分支(定锚命中不进 CD / 消失后进 9s) */
  requestCooldown(playerId: string, skillId: string, branch: CooldownBranchName | number): void {
    this.session.skills.applyCooldown(playerId, skillId, branch);
  }

  /** 刷新主动技能冷却(辅助固有Ⅰ) */
  refreshCooldowns(playerId: string, slots: SkillSlot[]): void {
    this.session.skills.refreshCooldowns(playerId, slots);
  }

  getCooldownRemaining(playerId: string, skillId: string): number {
    return this.session.skills.getCooldownRemaining(playerId, skillId);
  }

  // ── 查询 ─────────────────────────────────────────────────────

  /** 范围内本会话存活玩家 */
  playersInRadius(center: Vec3, radius: number): PlayerState[] {
    const states: PlayerState[] = [];
    for (const state of this.session.players.values()) {
      if (!state.alive) continue;
      if (!state.player.isValid) continue;
      const dx = state.player.location.x - center.x;
      const dy = state.player.location.y - center.y;
      const dz = state.player.location.z - center.z;
      if (dx * dx + dy * dy + dz * dz <= radius * radius) states.push(state);
    }
    return states;
  }

  /** 敌方玩家(按队伍判定;无队伍视为敌方) */
  enemyPlayersInRadius(sourceId: string, center: Vec3, radius: number): PlayerState[] {
    const sourceTeam = this.session.teams.getTeam(sourceId);
    return this.playersInRadius(center, radius).filter((state) => {
      if (state.id === sourceId) return false;
      const team = this.session.teams.getTeam(state.id);
      return team !== sourceTeam;
    });
  }

  /** 友方玩家(不含自己) */
  allyPlayersInRadius(sourceId: string, center: Vec3, radius: number): PlayerState[] {
    const sourceTeam = this.session.teams.getTeam(sourceId);
    return this.playersInRadius(center, radius).filter((state) => {
      if (state.id === sourceId) return false;
      return this.session.teams.getTeam(state.id) === sourceTeam;
    });
  }

  /**
   * 方块射线(定锚/抓钩的场景方块命中)。
   * 简单步进实现:0.25 格步长,命中非空气方块即返回其所在格。
   */
  raycastBlock(origin: Vec3, direction: Vector3, maxDistance: number): Vec3 | undefined {
    const dir = normalizeVector(direction);
    if (dir.x === 0 && dir.y === 0 && dir.z === 0) return undefined;
    const step = 0.25;
    for (let distance = step; distance <= maxDistance; distance += step) {
      const point: Vec3 = {
        x: Math.floor(origin.x + dir.x * distance),
        y: Math.floor(origin.y + dir.y * distance),
        z: Math.floor(origin.z + dir.z * distance),
      };
      try {
        const block = this.session.dimension.getBlock(point);
        if (block && !block.isAir && !block.isLiquid) return point;
      } catch {
        // 未加载区块:视为无命中
        return undefined;
      }
    }
    return undefined;
  }

  // ── 内部 ─────────────────────────────────────────────────────

  private getPlayer(playerId: string): Player | undefined {
    return this.session.players.get(playerId)?.player;
  }
}
