/** 全角色共用的伤害补正；连招何时结束由 Fighter 的受击状态决定。 */
export type ComboStarter = "normal" | "light" | "heavy";

const NORMAL_PERCENT = [100, 100, 80, 70, 60, 50, 40, 30, 20, 10] as const;
export const SUPER_MIN_DAMAGE_PERCENT = { 1: 30, 2: 40, 3: 50 } as const;

export class DamageCombo {
  private attackerId?: string;
  private starter: ComboStarter = "normal";
  private hits = 0;

  reset(): void {
    this.attackerId = undefined;
    this.starter = "normal";
    this.hits = 0;
  }

  /**
   * 确认招式时锁定整招补正，多段共用该比例，避免裸放大招自我衰减。
   * 每个接触占一个后续连招档位；拆投会撤销该次捕获并由 Fighter 清零。
   * 最后一击承担整数舍入余数，整招总伤害始终等于补正后的总额。
   */
  confirm(attackerId: string, starter: ComboStarter, baseHits: readonly number[], minimumPercent = 0): number[] {
    if (this.attackerId !== attackerId) this.reset();
    if (this.hits === 0) {
      this.attackerId = attackerId;
      this.starter = starter;
    }
    const index = this.hits + (this.starter === "light" && this.hits > 0 ? 1 : 0);
    let percent: number = NORMAL_PERCENT[Math.min(index, NORMAL_PERCENT.length - 1)]!;
    if (this.starter === "heavy" && this.hits > 0) percent *= 0.8;
    percent = Math.max(percent, minimumPercent);
    const total = Math.floor(baseHits.reduce((sum, damage) => sum + damage, 0) * percent / 100);
    let allocated = 0;
    const result = baseHits.map((damage, i) => {
      const scaled = i === baseHits.length - 1 ? total - allocated : Math.floor(damage * percent / 100);
      allocated += scaled;
      return scaled;
    });
    this.hits += baseHits.length;
    return result;
  }
}
