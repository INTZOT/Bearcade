import { Flag } from "./Flag";
import { Team } from "./Team";
import { Vector3 } from "./types";

export class FlagManager {
  private flags: Map<string, Flag>; // teamId -> Flag

  constructor() {
    this.flags = new Map();
  }

  createFlag(team: Team, homePosition: Vector3): Flag {
    const flag = new Flag(team, homePosition);
    team.flag = flag;
    this.flags.set(team.id, flag);
    return flag;
  }

  getFlag(teamId: string): Flag | undefined {
    return this.flags.get(teamId);
  }

  updateAll(): void {
    for (const flag of this.flags.values()) {
      flag.update();
    }
  }

  resetAll(): void {
    for (const flag of this.flags.values()) {
      flag.returnHome();
    }
  }

  /** 检查夺旗条件（携带者进入敌方基地） */
  checkCaptures(): void {
    for (const flag of this.flags.values()) {
      if (flag.state !== "carried" || !flag.carrier) continue;
      const carrierTeam = flag.carrier.team;
      if (!carrierTeam) continue;

      // 检查是否进入敌方基地（简化逻辑，实际需遍历所有非己方队伍基地）
      for (const [teamId, targetFlag] of this.flags) {
        if (teamId === carrierTeam.id) continue; // 跳过己方
        // TODO: 使用 distance() 检查 carrier 与 targetFlag.homePosition 距离 < captureRadius
        // 若满足：carrierTeam.addWin(); flag.returnHome();
      }
    }
  }
}
