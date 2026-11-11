// ============================================================
// ScoreSystem —— 分数制胜负(修改意见⑥⑦)
// 分数存储在会话内存(不进记分板 objective,Bearcade 契约:
// Core 只收对局状态不收比分);判胜达标后收敛到
// runtime.endGame() → 结算回大厅 → 整房模板重建。
//
// 加分规则 = 事件驱动的计分源表(战地/战争领主风格):
// 击杀/助攻/占点/驻守/治疗都是内容层数据(ScoreRuleDef),
// 本系统只负责订阅事件 → 换算队伍 → 累加 → 判胜。
// ============================================================
import type { MatchSession } from "./session";
import type { Snd5EventMap, Snd5EventName } from "./events";
import type { TeamId } from "./types";

/**
 * 计分规则(内容层数据):
 * - event:订阅的事件名(Snd5EventMap key);
 * - actorField:事件载荷中取哪个 id 换算队伍(击杀用 "killerId");
 * - scope:team = 团队分;personal = 个人分;
 * - once:只计一次(首杀)。
 */
export interface ScoreRuleDef {
  id: string;
  event: Snd5EventName;
  amount: number;
  actorField?: string;
  scope?: "team" | "personal";
  once?: boolean;
}

export class ScoreSystem {
  private readonly teamScores = new Map<TeamId, number>();
  private readonly personalScores = new Map<string, number>();
  private readonly firedOnce = new Set<string>();
  private readonly unsubscribes: Array<() => void> = [];

  constructor(
    private readonly session: MatchSession,
    rules: readonly ScoreRuleDef[],
  ) {
    for (const rule of rules) {
      this.unsubscribes.push(
        this.session.bus.on(rule.event as Snd5EventName, (payload) => {
          this.applyRule(rule, payload as Snd5EventMap[Snd5EventName]);
        }),
      );
    }
    // 占点/驻守等事件驱动计分天然生效;对局结束时停表
    this.unsubscribes.push(
      this.session.bus.on("match.end", () => this.unsubscribes.forEach((off) => off())),
    );
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

  /** 当前领先队伍(计时到点判胜用) */
  leader(): { teamId: TeamId; score: number } | undefined {
    let best: { teamId: TeamId; score: number } | undefined;
    for (const [teamId, score] of this.teamScores) {
      if (!best || score > best.score) best = { teamId, score };
    }
    return best;
  }

  dispose(): void {
    for (const off of this.unsubscribes) off();
    this.unsubscribes.length = 0;
    this.teamScores.clear();
    this.personalScores.clear();
    this.firedOnce.clear();
  }

  // ── 内部 ─────────────────────────────────────────────────────

  private applyRule(rule: ScoreRuleDef, payload: unknown): void {
    if (rule.once) {
      const firedKey = `${rule.id}:${this.session.roomId}`;
      if (this.firedOnce.has(firedKey)) return;
      this.firedOnce.add(firedKey);
    }
    const actorField = rule.actorField ?? "playerId";
    const actorId = (payload as Record<string, unknown>)[actorField];
    if (typeof actorId !== "string") return;

    if ((rule.scope ?? "team") === "personal") {
      this.addPersonalScore(actorId, rule.amount, rule.id);
      return;
    }
    const teamId = this.session.teams.getTeam(actorId);
    if (!teamId) return;
    this.addTeamScore(teamId, rule.amount, rule.id);
  }
}
