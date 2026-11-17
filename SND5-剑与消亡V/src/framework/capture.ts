// ============================================================
// CaptureSystem —— 占点(占点模式专用)
// 采用区域 AABB + 每 tick 计数模式(对齐 PigCatcher/BridgeWar 先例):
//
// 占领规则(拉锯式进度,进度条绑定当前进攻方 capturingTeam):
// - 中立点:单队独占累计 neutralCaptureSeconds(默认 20s)完成占领;
// - 敌方已占点:单队独占累计 takeoverCaptureSeconds(默认 40s)完成接管;
// - 换队进攻:不立即清零,先按同等速率回退前一进攻方的累计进度,
//   回退至 0 后新进攻方才从 0 开始累计自己的进度(拉锯战);
// - 持有方驻守:按同等速率回退敌方累计(归 0 后无进度可建,不可自占);
// - 无人驻留:当前累计按同等速率回退(离开即失势,防攒进度),归 0 清进攻方标记;
// - 双方同时有人 → 僵持,进度保持;
// - 占领后产分与驻守无关(产分逻辑在 ScoreSystem,只看归属)。
//
// 可视化(光柱/浮空文字)由内容层订阅 point.captured 实现,
// 框架保持纯逻辑。
// ============================================================
import type { Vec3 } from "../../../shared/minigame-core/types";
import type { MatchSession } from "./session";
import type { TeamId } from "./types";

export interface CapturePointDef {
  id: string;
  displayName: string;
  /** AABB 两角(自动归一化 min/max) */
  from: Vec3;
  to: Vec3;
  /** 中立点占领读秒 tick;undefined 走运行时配置 neutralCaptureSeconds */
  neutralCaptureTicks?: number;
  /** 敌方点接管读秒 tick;undefined 走运行时配置 takeoverCaptureSeconds */
  takeoverCaptureTicks?: number;
}

export interface CapturePointState {
  def: CapturePointDef;
  owner: TeamId | null;
  /** 当前持有进度条的进攻方(拉锯中被回推至 0 时易主) */
  capturingTeam: TeamId | null;
  progressTicks: number;
}

export class CaptureSystem {
  private readonly points = new Map<string, CapturePointState>();

  constructor(
    private readonly session: MatchSession,
    defs: readonly CapturePointDef[],
  ) {
    for (const def of defs) {
      this.points.set(def.id, {
        def,
        owner: null,
        capturingTeam: null,
        progressTicks: 0,
      });
    }
  }

  getOwner(pointId: string): TeamId | null {
    return this.points.get(pointId)?.owner ?? null;
  }

  states(): readonly CapturePointState[] {
    return [...this.points.values()];
  }

  /** 该点当前目标的读秒上限 tick(中立点=占领秒数;敌方点=接管秒数) */
  captureDelayTicks(point: CapturePointState): number {
    return point.owner === null
      ? point.def.neutralCaptureTicks ?? this.session.config.neutralCaptureSeconds * 20
      : point.def.takeoverCaptureTicks ?? this.session.config.takeoverCaptureSeconds * 20;
  }

  /**
   * 占点推进;deltaTicks 由会话传入(对齐会话 tick 粒度)。
   */
  tick(_nowTick: number, deltaTicks: number): void {
    for (const point of this.points.values()) {
      const occupancy = this.countOccupants(point.def);

      // 无人驻留:当前累计按同等速率回退(离开即失势),归 0 清进攻方标记
      if (occupancy.size === 0) {
        this.drainProgress(point, deltaTicks);
        continue;
      }

      // 双方同时在场:僵持,进度保持
      if (occupancy.size !== 1) continue;

      const [teamId, members] = [...occupancy.entries()][0];

      // 持有方驻守(拉锯回推):按同等速率回退敌方累计(不可自占)
      if (point.owner === teamId) {
        this.drainProgress(point, deltaTicks);
        continue;
      }

      // 换队进攻(拉锯):不立即清零,先按同等速率回退前一进攻方的累计;
      // 回退至 0 后本队从 0 开始累计自己的进度
      if (point.capturingTeam !== teamId) {
        point.progressTicks -= deltaTicks;
        if (point.progressTicks > 0) continue; // 仍在回退阶段
        point.progressTicks = 0;
        point.capturingTeam = teamId;
      }

      // 双段读秒:中立点快,敌方点慢
      const delay = this.captureDelayTicks(point);
      point.progressTicks += deltaTicks;
      if (point.progressTicks >= delay) {
        point.owner = teamId;
        point.capturingTeam = null;
        point.progressTicks = 0;
        this.session.bus.emit("point.captured", {
          pointId: point.def.id,
          teamId,
          byPlayerIds: members,
        });
        this.session.announce(
          `§6据点 ${point.def.displayName} §r被 ${this.session.teams.teamDisplayName(teamId)}§r 占领`,
        );
      }
    }
  }

  dispose(): void {
    this.points.clear();
  }

  // ── 内部 ─────────────────────────────────────────────────────

  /** 按同等速率回退当前进攻方的累计;归 0 后清除进攻方标记(需从 0 重来) */
  private drainProgress(point: CapturePointState, deltaTicks: number): void {
    if (point.capturingTeam === null || point.progressTicks <= 0) return;
    point.progressTicks = Math.max(0, point.progressTicks - deltaTicks);
    if (point.progressTicks === 0) point.capturingTeam = null;
  }

  /** 统计占点 AABB 内各队存活玩家(键为队伍,值为该队成员 playerId) */
  private countOccupants(def: CapturePointDef): Map<TeamId, string[]> {
    const result = new Map<TeamId, string[]>();
    const minX = Math.min(def.from.x, def.to.x);
    const maxX = Math.max(def.from.x, def.to.x);
    const minY = Math.min(def.from.y, def.to.y) - 1;
    const maxY = Math.max(def.from.y, def.to.y) + 2;
    const minZ = Math.min(def.from.z, def.to.z);
    const maxZ = Math.max(def.from.z, def.to.z);

    for (const state of this.session.players.values()) {
      if (!state.alive || !state.player.isValid) continue;
      const loc = state.player.location;
      if (
        loc.x < minX ||
        loc.x > maxX ||
        loc.y < minY ||
        loc.y > maxY ||
        loc.z < minZ ||
        loc.z > maxZ
      ) {
        continue;
      }
      const teamId = this.session.teams.getTeam(state.id);
      if (!teamId) continue;
      const members = result.get(teamId) ?? [];
      members.push(state.id);
      result.set(teamId, members);
    }
    return result;
  }
}
