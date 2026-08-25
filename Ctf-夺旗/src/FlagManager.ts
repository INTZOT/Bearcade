import { Flag } from './Flag';
import { Vector3 } from './types';

export class FlagManager {
  private flags = new Map<string, Flag>(); // teamId -> Flag

  constructor() {}

  /**
   * 创建旗帜
   */
  createFlag(teamId: string, homePosition: Vector3): Flag {
    if (this.flags.has(teamId)) {
      console.warn(`[FlagManager] Flag for team '${teamId}' already exists, overwriting`);
    }
    const flag = new Flag(teamId, homePosition);
    this.flags.set(teamId, flag);
    return flag;
  }

  /**
   * 获取旗帜
   */
  getFlag(teamId: string): Flag | undefined {
    return this.flags.get(teamId);
  }

  /**
   * 获取所有旗帜
   */
  getAllFlags(): Flag[] {
    return Array.from(this.flags.values());
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

  clear(): void {
    for (const flag of this.flags.values()) {
      flag.flagEntity?.remove();
    }
    this.flags.clear();
  }
}