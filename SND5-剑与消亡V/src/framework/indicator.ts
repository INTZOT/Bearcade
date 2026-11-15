// ============================================================
// IndicatorSystem —— 攻击指示器(内容设计 PDF 的「指示器」:
// 圆形 / ¼圆 / 半圆 / 直线劈砍 / 光束等 AoE 预告)
// 两条通道:
// 1. 声明式:SkillDefinition.indicator(ctx) —— charge/windup/channel
//    期间自动显示,每会话 tick 用最新 ctx 重算(跟随位置/视角/蓄力值),
//    施法结算/打断/死亡即回收(轮询 activeCasts,无需手动清理);
// 2. 命令式:primitives.showIndicator(...) —— 落点闪烁等即时表现,
//    durationTicks 到期自毁,或拿句柄 update/stop。
// 渲染 = 沿形状轮廓周期性撒 vanilla 粒子点(captureVisual 圆环同款);
// 可见性 self/team/all:self/team 用 Player.spawnParticle(仅目标玩家
// 可见,2.10.0-beta),不可用时一次性回退 dimension.spawnParticle。
// 粒子属纯表现:任何失败只降级,绝不影响战斗结算。
// ============================================================
import { system, type Player, type VectorXZ } from "@minecraft/server";
import type { Vec3 } from "../../../shared/minigame-core/types";
import type { MatchSession } from "./session";

/** 指示器形状(单个 spec 或数组;数组用于光束 + 溅射圈等多形状组合) */
export type IndicatorSpec =
  | {
      /** 圆形:辅助重击(圆心最远 5 格)/坦克固有Ⅱ三段扩张环 */
      kind: "circle";
      center: Vec3;
      radius: number;
    }
  | {
      /** 扇形:angleDegrees 90 = ¼圆(群法),180 = 半圆(战士/刺客重击) */
      kind: "sector";
      origin: Vec3;
      /** 水平中线方向(自动归一化) */
      direction: VectorXZ;
      radius: number;
      angleDegrees: number;
    }
  | {
      /** 直线:坦克 1~10 格劈砍、单法宽 1 格光束(direction 为 3D) */
      kind: "line";
      origin: Vec3;
      direction: { x: number; y: number; z: number };
      length: number;
      /** ≥0.5 时画两侧平行线与端帽,否则只画中轴 */
      width: number;
    };

export interface IndicatorOptions {
  /** 默认 "self"(仅施法者;Player.spawnParticle 逐玩家渲染) */
  visibility?: "self" | "team" | "all";
  /** 轮廓粒子效果,默认 endrod 白点(全版本可用,可换自定义粒子) */
  effect?: string;
  /** 命令式:到期自动回收;缺省 = 手动 stop(声明式随施法生命周期) */
  durationTicks?: number;
  /** 离地高度(格),默认 0.3 */
  yOffset?: number;
}

export interface IndicatorHandle {
  /** 更新形状(不改变可见性/粒子/到期时间) */
  update(spec: IndicatorSpec | IndicatorSpec[]): void;
  /** 立即回收 */
  stop(): void;
}

/** 默认粒子(endrod 白点,captureVisual 同款) */
const DEFAULT_EFFECT = "minecraft:endrod";
/** 轮廓采样点间距(格) */
const POINT_GAP = 1.2;
/** 单个 spec 单次重绘的点数上限(超限均匀抽稀) */
const MAX_POINTS_PER_SPEC = 64;
/** 默认离地高度(格) */
const DEFAULT_Y_OFFSET = 0.3;
/** 全系统指示器句柄上限(防内容层失控;超限回收最早的命令式句柄) */
const MAX_HANDLES = 64;

interface ResolvedOptions {
  visibility: "self" | "team" | "all";
  effect: string;
  yOffset: number;
}

interface ActiveIndicator {
  ownerId: string;
  specs: IndicatorSpec[];
  options: ResolvedOptions;
  /** 命令式 durationTicks 到期时刻;声明式由施法生命周期回收,无此项 */
  expiresAtTick?: number;
}

function resolveOptions(options?: IndicatorOptions): ResolvedOptions {
  return {
    visibility: options?.visibility ?? "self",
    effect: options?.effect ?? DEFAULT_EFFECT,
    yOffset: options?.yOffset ?? DEFAULT_Y_OFFSET,
  };
}

// ── 轮廓采样(纯几何,不触 API) ─────────────────────────────────

function thinToCap(points: Vec3[]): Vec3[] {
  if (points.length <= MAX_POINTS_PER_SPEC) return points;
  const stride = Math.ceil(points.length / MAX_POINTS_PER_SPEC);
  return points.filter((_, index) => index % stride === 0);
}

function sampleCircle(center: Vec3, radius: number, yOffset: number): Vec3[] {
  const r = Math.max(0.5, radius);
  const steps = Math.min(48, Math.max(12, Math.ceil((2 * Math.PI * r) / POINT_GAP)));
  const y = center.y + yOffset;
  const points: Vec3[] = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    points.push({ x: center.x + Math.cos(angle) * r, y, z: center.z + Math.sin(angle) * r });
  }
  return thinToCap(points);
}

function sampleSector(
  origin: Vec3,
  direction: VectorXZ,
  radius: number,
  angleDegrees: number,
  yOffset: number,
): Vec3[] {
  const r = Math.max(0.5, radius);
  const dirLength = Math.hypot(direction.x, direction.z);
  if (dirLength < 1e-4) return [];
  const dx = direction.x / dirLength;
  const dz = direction.z / dirLength;
  const angle = Math.min(360, Math.max(1, angleDegrees)) * (Math.PI / 180);
  const y = origin.y + yOffset;
  const points: Vec3[] = [];
  // 弧线(单位朝向绕 angle 旋转)
  const arcSteps = Math.min(40, Math.max(6, Math.ceil((r * angle) / POINT_GAP)));
  for (let i = 0; i <= arcSteps; i++) {
    const a = -angle / 2 + (i / arcSteps) * angle;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    points.push({
      x: origin.x + (dx * cos - dz * sin) * r,
      y,
      z: origin.z + (dx * sin + dz * cos) * r,
    });
  }
  // 两条半径边(原点 → 弧线两端),让 ¼圆/半圆读作"扇面"
  const edgeSteps = Math.min(16, Math.max(2, Math.ceil(r / POINT_GAP)));
  for (const a of [-angle / 2, angle / 2]) {
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const ex = (dx * cos - dz * sin) * r;
    const ez = (dx * sin + dz * cos) * r;
    for (let i = 1; i < edgeSteps; i++) {
      const t = i / edgeSteps;
      points.push({ x: origin.x + ex * t, y, z: origin.z + ez * t });
    }
  }
  return thinToCap(points);
}

function sampleLine(
  origin: Vec3,
  direction: { x: number; y: number; z: number },
  length: number,
  width: number,
  yOffset: number,
): Vec3[] {
  const dirLength = Math.hypot(direction.x, direction.y, direction.z);
  if (dirLength < 1e-4 || length <= 0) return [];
  const dx = direction.x / dirLength;
  const dy = direction.y / dirLength;
  const dz = direction.z / dirLength;
  const points: Vec3[] = [];
  const steps = Math.min(40, Math.max(2, Math.ceil(length / POINT_GAP)));
  // 中轴线(光束按真实 3D 弹道走,地面劈砍 direction 水平即贴地)
  for (let i = 0; i <= steps; i++) {
    const d = (i / steps) * length;
    points.push({ x: origin.x + dx * d, y: origin.y + dy * d + yOffset, z: origin.z + dz * d });
  }
  // 宽体:两侧平行线(水平横向偏移;方向接近竖直时省略)
  if (width >= 0.5) {
    const horizontal = Math.hypot(dx, dz);
    if (horizontal > 1e-4) {
      const half = width / 2;
      const px = (-dz / horizontal) * half;
      const pz = (dx / horizontal) * half;
      for (const side of [-1, 1]) {
        const ox = px * side;
        const oz = pz * side;
        for (let i = 0; i <= steps; i++) {
          const d = (i / steps) * length;
          points.push({
            x: origin.x + dx * d + ox,
            y: origin.y + dy * d + yOffset,
            z: origin.z + dz * d + oz,
          });
        }
      }
    }
  }
  return thinToCap(points);
}

// ── 系统 ─────────────────────────────────────────────────────

export class IndicatorSystem {
  private readonly handles = new Map<number, ActiveIndicator>();
  /** 声明式施法指示器:`${playerId}::${skillId}` → handleId */
  private readonly castHandles = new Map<string, number>();
  /** 指示器计算异常按技能只告警一次 */
  private readonly warnedIndicatorErrors = new Set<string>();
  /** 粒子效果不可用(名字错误等)按效果名禁用,每个名字只告警一次 */
  private readonly disabledEffects = new Set<string>();
  /** Player.spawnParticle 不可用时一次性回退全员渲染 */
  private perPlayerDisabled = false;
  private nextId = 1;
  private disposed = false;

  constructor(private readonly session: MatchSession) {}

  /** 命令式入口(primitives.showIndicator 落点) */
  show(
    ownerId: string,
    spec: IndicatorSpec | IndicatorSpec[],
    options?: IndicatorOptions,
  ): IndicatorHandle {
    if (this.disposed) return { update: () => {}, stop: () => {} };
    const resolved = resolveOptions(options);
    const id = this.createHandle(
      ownerId,
      Array.isArray(spec) ? spec : [spec],
      resolved,
      options?.durationTicks !== undefined ? system.currentTick + options.durationTicks : undefined,
    );
    return {
      update: (next) => {
        const handle = this.handles.get(id);
        if (handle) handle.specs = Array.isArray(next) ? next : [next];
      },
      stop: () => {
        this.handles.delete(id);
      },
    };
  }

  /** 停掉该玩家的全部指示器;进行中的施法指示器下一拍会重建(轮询语义) */
  stopForPlayer(playerId: string): void {
    for (const [id, handle] of this.handles) {
      if (handle.ownerId === playerId) this.handles.delete(id);
    }
    for (const [key] of this.castHandles) {
      if (key.startsWith(`${playerId}::`)) this.castHandles.delete(key);
    }
  }

  /** 会话 tick(5t 网格)驱动:施法指示器同步 → 到期回收 → 重绘 */
  tick(nowTick: number): void {
    if (this.disposed) return;
    this.syncCastIndicators();
    for (const [id, handle] of this.handles) {
      if (handle.expiresAtTick !== undefined && nowTick >= handle.expiresAtTick) {
        this.handles.delete(id);
      }
    }
    for (const handle of this.handles.values()) {
      if (handle.specs.length === 0) continue;
      this.redraw(handle);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.handles.clear();
    this.castHandles.clear();
  }

  // ── 内部 ─────────────────────────────────────────────────────

  /**
   * 声明式同步:对每个进行中的施法,保证 cast 指示器存在并重算 spec;
   * 施法消失(结算/打断/死亡/离场)即回收 —— 轮询 activeCasts,
   * 因此打断/死亡等任何清理路径都天然覆盖,无泄漏。
   */
  private syncCastIndicators(): void {
    const seen = new Set<string>();
    for (const cast of this.session.skills.getActiveCasts()) {
      const factory = cast.def.indicator;
      if (!factory) continue;
      const key = `${cast.ctx.casterId}::${cast.def.id}`;
      seen.add(key);
      let specs: IndicatorSpec[] | undefined;
      try {
        const result = factory(cast.ctx);
        specs = result === undefined ? undefined : Array.isArray(result) ? result : [result];
      } catch (error) {
        if (!this.warnedIndicatorErrors.has(cast.def.id)) {
          this.warnedIndicatorErrors.add(cast.def.id);
          console.warn(`[SND5] 指示器计算异常 ${cast.def.id}`, error);
        }
      }
      const existingId = this.castHandles.get(key);
      if (existingId !== undefined) {
        const handle = this.handles.get(existingId);
        if (handle) handle.specs = specs ?? []; // undefined = 本拍隐藏
        continue;
      }
      if (!specs || specs.length === 0) continue;
      const id = this.createHandle(
        cast.ctx.casterId,
        specs,
        resolveOptions(cast.def.indicatorOptions),
      );
      this.castHandles.set(key, id);
    }
    for (const [key, id] of this.castHandles) {
      if (!seen.has(key)) {
        this.handles.delete(id);
        this.castHandles.delete(key);
      }
    }
  }

  private createHandle(
    ownerId: string,
    specs: IndicatorSpec[],
    options: ResolvedOptions,
    expiresAtTick?: number,
  ): number {
    if (this.handles.size >= MAX_HANDLES) {
      // 兜底:回收最早的命令式句柄(声明式句柄随施法走,优先保留)
      for (const [id] of this.handles) {
        if (![...this.castHandles.values()].includes(id)) {
          this.handles.delete(id);
          break;
        }
      }
    }
    const id = this.nextId++;
    this.handles.set(id, { ownerId, specs, options, expiresAtTick });
    return id;
  }

  private redraw(handle: ActiveIndicator): void {
    for (const spec of handle.specs) {
      const points = this.sampleSpec(spec, handle.options.yOffset);
      if (points.length === 0) continue;
      this.spawnPoints(points, handle);
    }
  }

  private sampleSpec(spec: IndicatorSpec, yOffset: number): Vec3[] {
    switch (spec.kind) {
      case "circle":
        return sampleCircle(spec.center, spec.radius, yOffset);
      case "sector":
        return sampleSector(spec.origin, spec.direction, spec.radius, spec.angleDegrees, yOffset);
      case "line":
        return sampleLine(spec.origin, spec.direction, spec.length, spec.width, yOffset);
    }
  }

  private spawnPoints(points: Vec3[], handle: ActiveIndicator): void {
    const { visibility, effect } = handle.options;
    if (this.disabledEffects.has(effect)) return;
    if (visibility === "all" || this.perPlayerDisabled) {
      this.spawnDimension(points, effect);
      return;
    }
    if (visibility === "self") {
      const player = this.session.players.get(handle.ownerId)?.player;
      if (!player?.isValid) return;
      this.spawnPerPlayer(points, effect, player);
      return;
    }
    // team:自己 + 同队存活玩家
    const team = this.session.teams.getTeam(handle.ownerId);
    for (const state of this.session.players.values()) {
      if (!state.alive || !state.player.isValid) continue;
      if (state.id !== handle.ownerId && this.session.teams.getTeam(state.id) !== team) continue;
      this.spawnPerPlayer(points, effect, state.player);
    }
  }

  /** 逐玩家渲染;API 不可用时回退全员渲染(一次性) */
  private spawnPerPlayer(points: Vec3[], effect: string, player: Player): void {
    if (this.perPlayerDisabled) {
      this.spawnDimension(points, effect);
      return;
    }
    try {
      for (const point of points) player.spawnParticle(effect, point);
    } catch (error) {
      this.perPlayerDisabled = true;
      console.warn("[SND5] Player.spawnParticle 不可用,指示器回退为全员可见", error);
      this.spawnDimension(points, effect);
    }
  }

  private spawnDimension(points: Vec3[], effect: string): void {
    if (this.disabledEffects.has(effect)) return;
    try {
      for (const point of points) this.session.dimension.spawnParticle(effect, point);
    } catch (error) {
      // 效果名不可用/区块未加载:禁用该效果,避免每拍刷告警(captureVisual 先例)
      this.disabledEffects.add(effect);
      console.warn(`[SND5] 指示器粒子不可用(${effect}),已禁用该效果`, error);
    }
  }
}
