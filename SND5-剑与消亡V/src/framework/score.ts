// ============================================================
// ScoreSystem —— 分数制胜负(占点模式专用)
// 分数存储在会话内存(不进记分板 objective,Bearcade 契约:
// Core 只收对局状态不收比分);判胜达标后收敛到
// runtime.endGame() → 结算回大厅 → 整房模板重建。
//
// 两条内置计分规则(重构自通用规则表——当前玩法只有这两条,
// 具体化比泛化表格更直白):
// 1. 占点持续得分(主要来源):每秒按各队当前占有点数给分,
//    产分曲线 [0,1,2,4,8,16]/s(占下后离人也持续产分,直到被接管);
// 2. 阵亡计分:任意玩家死亡(击杀/环境/自伤一律),对方队伍 +5。
//
// 胜负:先到 scoreTarget(默认 2000)立即获胜;
// matchSeconds(默认 20 分钟)到点比总分,高者胜,完全相同平局。
// ============================================================
import type { MatchSession } from "./session";
import type { TeamId } from "./types";

export class ScoreSystem {
  private readonly teamScores = new Map<TeamId, number>();
  private readonly personalScores = new Map<string, number>();
  private readonly unsubscribes: Array<() => void> = [];
  private lastIncomeTick = 0;

  constructor(private readonly session: MatchSession) {
    // 规则 2:阵亡计分 —— 载荷的 playerId 是死者,给对方队伍加分
    this.unsubscribes.push(
      this.session.bus.on("player.death", ({ playerId }) => {
        const victimTeam = this.session.teams.getTeam(playerId);
        if (!victimTeam) return;
        const enemyTeam = this.session.teams.teamIds.find((id) => id !== victimTeam);
        if (enemyTeam) {
          this.addTeamScore(enemyTeam, this.session.config.deathScore, "death");
        }
      }),
    );
  }

  /**
   * 规则 1:占点持续得分 —— 会话每 tick 调用,内部按秒结算。
   * 产分只看「当前占有点数」,与是否有人驻守无关(占下即产分)。
   */
  tick(nowTick: number): void {
    if (nowTick - this.lastIncomeTick < 20) return;
    this.lastIncomeTick = nowTick;
    const rates = this.session.config.holdScoreRates;
    const points = this.session.capture.states();
    for (const teamId of this.session.teams.teamIds) {
      const owned = points.filter((point) => point.owner === teamId).length;
      const rate = rates[Math.min(owned, rates.length - 1)] ?? 0;
      if (rate > 0) this.addTeamScore(teamId, rate, "domination");
    }
  }

  /** 某队当前每秒产分(HUD 显示用) */
  getIncomeRate(teamId: TeamId): number {
    const rates = this.session.config.holdScoreRates;
    const owned = this.session.capture
      .states()
      .filter((point) => point.owner === teamId).length;
    return rates[Math.min(owned, rates.length - 1)] ?? 0;
  }

  /** 团队加分;达标触发 endMatch(reason = score_target) */
  addTeamScore(teamId: TeamId, delta: number, reason?: string): number {
    if (!teamId) return 0;
    const current = Math.max(0, (this.teamScores.get(teamId) ?? 0) + delta);
    this.teamScores.set(teamId, current);
    this.session.bus.emit("score.changed", { teamId, score: current, delta, reason });
    if (this.session.config.scoreTarget > 0 && current >= this.session.config.scoreTarget) {
      this.session.endMatch(teamId, "score_target");
    }
    return current;
  }

  addPersonalScore(playerId: string, delta: number, reason?: string): number {
    const current = Math.max(0, (this.personalScores.get(playerId) ?? 0) + delta);
    this.personalScores.set(playerId, current);
    if (reason) {
      // 个人分仅作战绩展示,经 actionbar 即时反馈
      const player = this.session.players.get(playerId)?.player;
      if (player?.isValid) {
        this.session.hud.toast(player, `§6+${delta} 分 §7(${reason})`);
      }
    }
    return current;
  }

  getTeamScore(teamId: TeamId): number {
    return this.teamScores.get(teamId) ?? 0;
  }

  getPersonalScore(playerId: string): number {
    return this.personalScores.get(playerId) ?? 0;
  }

  getAllTeamScores(): ReadonlyMap<TeamId, number> {
    return new Map(this.teamScores);
  }

  /**
   * 计时到点判定:返回最高分队伍与是否并列。
   * 完全相同 → tie = true,leader 无意义(平局)。
   */
  standings(): { leader?: TeamId; tie: boolean } {
    let bestScore = -1;
    let leaders: TeamId[] = [];
    for (const [teamId, score] of this.teamScores) {
      if (score > bestScore) {
        bestScore = score;
        leaders = [teamId];
      } else if (score === bestScore) {
        leaders.push(teamId);
      }
    }
    return { leader: leaders[0], tie: leaders.length !== 1 };
  }

  dispose(): void {
    for (const off of this.unsubscribes) off();
    this.unsubscribes.length = 0;
    this.teamScores.clear();
    this.personalScores.clear();
  }
}
