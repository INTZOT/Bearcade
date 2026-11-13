// ============================================================
// CaptureVisualizer —— 占点可视化
// 每个占点两样东西:
// 1. 粒子环:按区域 Y 轴中心(XZ 包围圆)环绕一周,标示区域范围;
//    endrod 白点每 0.5 秒刷一轮(单发粒子不可持续,周期补画)。
// 2. 中心浮空字(TextPrimitive,§ 色号在原语文本中可直接渲染,
//    对齐 CTF FloatingTextManager 先例):所属队伍 + 占领状态 +
//    接管读秒,状态变化才 setText。
// 坐标/名称来自 CapturePointDef;状态来自 CaptureSystem 实例。
// ============================================================
import { TextPrimitive, world } from "@minecraft/server";
import type { MatchSession } from "./session";
import type { CapturePointState } from "./capture";

/** 粒子环刷新间隔(0.5 秒一轮) */
const RING_INTERVAL_TICKS = 10;
/** 中心文字刷新间隔(0.25 秒,含读秒,状态未变时不 setText) */
const TEXT_UPDATE_INTERVAL_TICKS = 5;
/** 环粒子效果(endrod 白点,全版本 vanilla molang 粒子) */
const RING_EFFECT = "minecraft:endrod";
/** 环上粒子目标间距(格);粒数随半径自适应,12~40 封顶 */
const RING_POINT_GAP = 1.2;

interface PointVisual {
  primitive: TextPrimitive;
  lastText: string;
}

export class CaptureVisualizer {
  private readonly visuals = new Map<string, PointVisual>();
  private readonly ringCache = new Map<
    string,
    { cx: number; cy: number; cz: number; points: { x: number; z: number }[] }
  >();
  private started = false;
  private lastParticleTick = 0;
  private lastTextTick = 0;
  /** 粒子效果不可用(名字错误/版本不支持)时永久禁用,只告警一次 */
  private particleDisabled = false;

  constructor(private readonly session: MatchSession) {}

  /** 会话开始时创建全部浮空字(点位由 buildContentBundle 注入) */
  start(): void {
    if (this.started || this.session.capture.states().length === 0) return;
    this.started = true;
    for (const point of this.session.capture.states()) {
      const primitive = new TextPrimitive(this.centerOf(point.def), " ");
      primitive.depthTest = false;
      try {
        world.primitiveShapesManager.addText(primitive, this.session.dimension);
        this.visuals.set(point.def.id, { primitive, lastText: "" });
      } catch (error) {
        console.warn(`[SND5] 占点浮空字创建失败 ${point.def.id}`, error);
      }
    }
  }

  tick(nowTick: number): void {
    if (!this.started || this.visuals.size === 0) return;

    if (nowTick - this.lastParticleTick >= RING_INTERVAL_TICKS) {
      this.lastParticleTick = nowTick;
      this.spawnRings();
    }
    if (nowTick - this.lastTextTick >= TEXT_UPDATE_INTERVAL_TICKS) {
      this.lastTextTick = nowTick;
      this.updateTexts();
    }
  }

  dispose(): void {
    for (const visual of this.visuals.values()) {
      try {
        world.primitiveShapesManager.removeText(visual.primitive);
      } catch {
        // 维度可能已卸载
      }
    }
    this.visuals.clear();
    this.ringCache.clear();
    this.started = false;
  }

  // ── 粒子环 ───────────────────────────────────────────────────

  private spawnRings(): void {
    if (this.particleDisabled) return;
    const states = this.session.capture.states();
    for (const point of states) {
      const ring = this.ringOf(point);
      if (!ring) continue;
      for (const offset of ring.points) {
        try {
          this.session.dimension.spawnParticle(RING_EFFECT, {
            x: ring.cx + offset.x,
            y: ring.cy,
            z: ring.cz + offset.z,
          });
        } catch (error) {
          // 效果名不可用:一次性禁用,避免每轮刷告警
          this.particleDisabled = true;
          console.warn(`[SND5] 占点环粒子不可用(${RING_EFFECT}),已禁用`, error);
          return;
        }
      }
    }
  }

  /** 区域包围圆参数(XZ 中心/Y 轴中心/环上粒子点),按 def 缓存 */
  private ringOf(point: CapturePointState) {
    const cached = this.ringCache.get(point.def.id);
    if (cached) return cached;
    const def = point.def;
    const cx = (def.from.x + def.to.x) / 2;
    const cy = (def.from.y + def.to.y) / 2;
    const cz = (def.from.z + def.to.z) / 2;
    const radius = Math.max(Math.abs(def.to.x - def.from.x), Math.abs(def.to.z - def.from.z)) / 2;
    if (radius <= 0) return undefined;
    const steps = Math.min(40, Math.max(12, Math.ceil((2 * Math.PI * radius) / RING_POINT_GAP)));
    const points: { x: number; z: number }[] = [];
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * 2 * Math.PI;
      points.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
    }
    const ring = { cx, cy, cz, points };
    this.ringCache.set(def.id, ring);
    return ring;
  }

  private centerOf(def: CapturePointState["def"]): { x: number; y: number; z: number } {
    return {
      x: (def.from.x + def.to.x) / 2,
      y: (def.from.y + def.to.y) / 2,
      z: (def.from.z + def.to.z) / 2,
    };
  }

  // ── 中心浮空字 ───────────────────────────────────────────────

  private updateTexts(): void {
    for (const point of this.session.capture.states()) {
      const visual = this.visuals.get(point.def.id);
      if (!visual) continue;
      const text = this.composeText(point);
      if (text === visual.lastText) continue;
      try {
        visual.primitive.setText(text);
        visual.lastText = text;
      } catch (error) {
        console.warn(`[SND5] 占点浮空字更新失败 ${point.def.id}`, error);
      }
    }
  }

  /**
   * 中心文字:
   * - 中立无人:  §7[据点A] 中立
   * - 占领中:    §6[据点A] {队名}占领中 {n}s
   * - 已占领:    §7[据点A] {队名色}{队名}
   * - 接管中:    §7[据点A] {队名色}{队名} §c← {队名}接管中 {n}s
   */
  private composeText(point: CapturePointState): string {
    const name = `§7[据点${point.def.displayName}]`;
    const remainingSeconds = Math.ceil(
      Math.max(0, this.session.capture.captureDelayTicks(point) - point.progressTicks) / 20,
    );

    // 无主:占领中显示进度
    if (point.owner === null) {
      if (!point.capturingTeam) return `${name} §7中立`;
      return `${name} §f${this.teamName(point.capturingTeam)}§e占领中 ${remainingSeconds}s`;
    }

    // 已有归属:接管中显示双队与读秒
    if (point.capturingTeam && point.capturingTeam !== point.owner) {
      return `${name} ${this.teamName(point.owner)} §c← §f${this.teamName(point.capturingTeam)}§e接管中 ${remainingSeconds}s`;
    }
    return `${name} ${this.teamName(point.owner)}`;
  }

  private teamName(teamId: string): string {
    return this.session.teams.teamDisplayName(teamId);
  }
}
