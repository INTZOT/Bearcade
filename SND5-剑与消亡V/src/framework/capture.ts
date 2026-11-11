// ============================================================
// CaptureSystem —— 占点(修改意见⑤)
// 不复用 TerritoryWar 的格子所有权(那是「圈地」专用)。
// 采用区域 AABB + 每 tick 计数模式(对齐 PigCatcher/BridgeWar 先例):
// - 独占据点持续读秒 → 易主,发 point.captured;
// - 双方在场 = contested,读秒暂停;
// - 持有方驻留按间隔发 point.hold(驻守得分由计分规则消费);
// - 可视化(光柱/浮空文字)由内容层订阅事件实现,框架保持纯逻辑。
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
  /** 独占读秒 tick;undefined 走运行时配置 captureDelaySeconds */
  captureDelayTicks?: number;
  /** 驻守得分间隔 tick;undefined 走运行时配置(0 = 关闭) */
  holdScoreIntervalTicks?: number;
}

export interface CapturePointState {
  def: CapturePointDef;
  owner: TeamId | null;
  capturingTeam: TeamId | null;
  progressTicks: number;
  lastHoldTick: number;
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
        lastHoldTick: 0,
      });
    }
  }

  getOwner(pointId: string): TeamId | null {
    return this.points.get(pointId)?.owner ?? null;
  }

  states(): readonly CapturePointState[] {
    return [...this.points.values()];
  }

  /**
   * 占点推进;deltaTicks 由会话传入(对齐会话 tick 粒度)。
   */
  tick(nowTick: number, deltaTicks: number): void {
    for (const point of this.points.values()) {
      const occupancy = this.countOccupants(point.def);
      const presentTeams = [...occupancy.keys()];

      // 无人驻留:读秒缓慢衰减(半速),不重置
      if (presentTeams.length === 0) {
        point.progressTicks = Math.max(0, point.progressTicks - Math.floor(deltaTicks / 2));
        continue;
      }
      // 多方拉锯:contested,读秒暂停
      if (presentTeams.length > 1) {
        continue;
      }

      const teamId = presentTeams[0];
      const members = occupancy.get(teamId) ?? [];

      if (point.owner === teamId) {
        // 驻守得分:按间隔发 point.hold(计分规则表消费)
        const interval =
          point.def.holdScoreIntervalTicks ??
          this.session.config.holdScoreIntervalSeconds * 20;
        if (interval > 0 && nowTick - point.lastHoldTick >= interval) {
          point.lastHoldTick = nowTick;
          this.session.bus.emit("point.hold", { pointId: point.def.id, teamId });
        }
        continue;
      }

      // 独占读秒 → 易主
      point.capturingTeam = teamId;
      point.progressTicks += deltaTicks;
      const delay =
        point.def.captureDelayTicks ?? this.session.config.captureDelaySeconds * 20;
      if (point.progressTicks >= delay) {
        point.owner = teamId;
        point.capturingTeam = null;
        point.progressTicks = 0;
        point.lastHoldTick = nowTick;
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

  /** 统计占点 AABB 内各队存活玩家 */
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
