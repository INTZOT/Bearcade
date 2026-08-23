import { Team } from "./Team";
import { CTFPlayer } from "./CTFPlayer";
import { config } from "./config";

export class TeamManager {
  private teams: Map<string, Team>;
  private teamArray: Team[];

  constructor() {
    this.teams = new Map();
    this.teamArray = [];
  }

  initialize(): void {
    for (const teamConfig of config.teams) {
      const team = new Team(teamConfig.id, teamConfig.name, teamConfig.color);
      this.teams.set(teamConfig.id, team);
      this.teamArray.push(team);
    }
  }

  /** CRUD 队伍 */
  createTeam(id: string, name: string, color: string): Team {
    const team = new Team(id, name, color);
    this.teams.set(id, team);
    this.teamArray.push(team);
    return team;
  }

  getTeam(id: string): Team | undefined {
    return this.teams.get(id);
  }

  removeTeam(id: string): boolean {
    const team = this.teams.get(id);
    if (!team) return false;
    this.teams.delete(id);
    this.teamArray = this.teamArray.filter(t => t.id !== id);
    return true;
  }

  getAllTeams(): Team[] {
    return [...this.teamArray];
  }

  /** 自动平衡分配玩家到队伍 */
  assignPlayer(player: CTFPlayer): Team {
    let target = this.teamArray[0];
    for (const team of this.teamArray) {
      if (team.players.length < target.players.length) {
        target = team;
      }
    }
    target.addPlayer(player);
    return target;
  }

  clearAllTeams(): void {
    for (const team of this.teamArray) {
      team.players = [];
      team.score = 0;
      team.flag = null;
    }
  }

  /** 检查是否有队伍达到获胜分数 */
  checkWinCondition(): Team | null {
    for (const team of this.teamArray) {
      if (team.score >= config.maxScore) {
        return team;
      }
    }
    return null;
  }
}
