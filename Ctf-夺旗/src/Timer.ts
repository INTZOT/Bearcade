export class Timer {
  public readonly id: string;
  public plannedTime: number;       // 计划时间（游戏刻）
  public elapsedTime: number;       // 经过时间（游戏刻）
  public onReach: (() => void) | null;
  public onUpdate: ((elapsed: number) => void) | null;
  public isRunning: boolean;
  public isFinished: boolean;

  private static allTimers: Timer[] = [];

  constructor(plannedTime: number, onReach: () => void, onUpdate?: (elapsed: number) => void) {
    this.id = generateUUID();
    this.plannedTime = plannedTime;
    this.elapsedTime = 0;
    this.onReach = onReach;
    this.onUpdate = onUpdate || null;
    this.isRunning = true;
    this.isFinished = false;
    Timer.allTimers.push(this);
  }

  /** 静态更新：每游戏刻调用（由主循环驱动） */
  static update(deltaTicks: number): void {
    for (const timer of Timer.allTimers) {
      if (!timer.isRunning || timer.isFinished) continue;
      timer.elapsedTime += deltaTicks;
      if (timer.onUpdate) {
        timer.onUpdate(timer.elapsedTime);
      }
      if (timer.elapsedTime >= timer.plannedTime) {
        timer.isFinished = true;
        if (timer.onReach) {
          timer.onReach();
        }
      }
    }
    // 清理已完成的定时器
    Timer.allTimers = Timer.allTimers.filter(t => !t.isFinished);
  }

  stop(): void {
    this.isRunning = false;
  }

  resume(): void {
    this.isRunning = true;
  }

  reset(): void {
    this.elapsedTime = 0;
    this.isFinished = false;
    this.isRunning = true;
  }
}

// 避免循环依赖问题，此处内联或从 utils 导入
function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
