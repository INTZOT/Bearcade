// ============================================================
// 冷却与堆叠存储(架构设计 §4.4.7 / §4.4.8)
// - 冷却用绝对 tick 而非剩余时间,避免 interval 漂移;
// - 技能堆叠与状态层数是两个完全独立的维度;
// - 堆叠与冷却是串联:每次成功施法 -1,归零进 CD,CD 结束回满
//   (stackRecoveryTicks 定义时按间隔逐层恢复);
// - 纯内存:断线即退出,无热重连,不落 DynamicProperties。
// ============================================================

export function skillKey(playerId: string, skillId: string): string {
  return `${playerId}::${skillId}`;
}

export interface CooldownEntry {
  readyAtTick: number;
  /** 到期事件是否已发出(防止重复 emit cooldown.end) */
  fired: boolean;
}

export class CooldownStore {
  private readonly entries = new Map<string, CooldownEntry>();

  isReady(key: string, nowTick: number): boolean {
    const entry = this.entries.get(key);
    return !entry || nowTick >= entry.readyAtTick;
  }

  getRemaining(key: string, nowTick: number): number {
    const entry = this.entries.get(key);
    if (!entry) return 0;
    return Math.max(0, entry.readyAtTick - nowTick);
  }

  start(key: string, ticks: number, nowTick: number): void {
    this.entries.set(key, { readyAtTick: nowTick + Math.max(0, ticks), fired: false });
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  resetForPlayer(playerId: string): void {
    const prefix = `${playerId}::`;
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  /** 到期扫描:每个到期项只发一次 cooldown.end */
  sweep(nowTick: number, onEnd: (key: string) => void): void {
    for (const [key, entry] of this.entries) {
      if (!entry.fired && nowTick >= entry.readyAtTick) {
        entry.fired = true;
        try {
          onEnd(key);
        } catch (error) {
          console.warn("[SND5] 冷却结束回调异常", error);
        }
      }
    }
  }

  dispose(): void {
    this.entries.clear();
  }
}

export interface StackEntry {
  current: number;
  max: number;
  /** 逐层恢复间隔;undefined = CD 结束一次性回满 */
  recoveryTicks?: number;
  lastRecoveryTick: number;
}

export class StackStore {
  private readonly entries = new Map<string, StackEntry>();

  /** 初始化(幂等):current = max */
  initIfAbsent(key: string, max: number, recoveryTicks?: number, nowTick = 0): StackEntry {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { current: max, max, recoveryTicks, lastRecoveryTick: nowTick };
      this.entries.set(key, entry);
    }
    return entry;
  }

  get(key: string): StackEntry | undefined {
    return this.entries.get(key);
  }

  current(key: string): number {
    return this.entries.get(key)?.current ?? 0;
  }

  /** 消耗 1 层;无余量返回 false */
  consume(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry || entry.current <= 0) return false;
    entry.current -= 1;
    return true;
  }

  /** 失败/打断退还 1 层 */
  refund(key: string): void {
    const entry = this.entries.get(key);
    if (entry) entry.current = Math.min(entry.max, entry.current + 1);
  }

  /** CD 结束一次性回满 */
  refill(key: string): void {
    const entry = this.entries.get(key);
    if (entry) entry.current = entry.max;
  }

  /** 按 stackRecoveryTicks 逐层恢复 */
  tick(key: string, nowTick: number, maxPerTick = 1): void {
    const entry = this.entries.get(key);
    if (!entry?.recoveryTicks || entry.current >= entry.max) return;
    if (nowTick - entry.lastRecoveryTick >= entry.recoveryTicks) {
      entry.lastRecoveryTick = nowTick;
      entry.current = Math.min(entry.max, entry.current + maxPerTick);
    }
  }

  /** 全表逐层恢复扫描(会话 tick 调用) */
  tickRecoveryAll(nowTick: number): void {
    for (const key of this.entries.keys()) {
      this.tick(key, nowTick);
    }
  }

  clearForPlayer(playerId: string): void {
    const prefix = `${playerId}::`;
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  dispose(): void {
    this.entries.clear();
  }
}
