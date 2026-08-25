/**
 * 队伍系统事件定义
 * 所有队伍变更均通过事件通知，解耦各模块
 */

 export interface TeamEventMap {
    /** 玩家加入队伍 */
    playerJoined: {
      playerId: string;
      teamId: string;
      previousTeamId: string | null;
    };
    /** 玩家离开队伍 */
    playerLeft: {
      playerId: string;
      teamId: string;
      newTeamId: string | null;
    };
    /** 队伍得分变化 */
    teamScoreChanged: {
      teamId: string;
      oldScore: number;
      newScore: number;
    };
    /** 队伍创建 */
    teamCreated: { teamId: string };
    /** 队伍移除 */
    teamRemoved: { teamId: string };
    /** 所有队伍重置 */
    teamsReset: Record<string, never>;
  }
  
  export type TeamEventType = keyof TeamEventMap;
  export type TeamEventHandler<T extends TeamEventType> = (data: TeamEventMap[T]) => void;
  
  /**
   * 简易事件发射器（内联实现，避免额外依赖）
   */
  export class TeamEventBus {
    private listeners = new Map<TeamEventType, Set<TeamEventHandler<any>>>();
  
    on<T extends TeamEventType>(
      event: T,
      handler: TeamEventHandler<T>
    ): () => void {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, new Set());
      }
      this.listeners.get(event)!.add(handler);
  
      // 返回取消订阅函数
      return () => {
        this.listeners.get(event)?.delete(handler);
      };
    }
  
    once<T extends TeamEventType>(
      event: T,
      handler: TeamEventHandler<T>
    ): void {
      const wrapper = (data: TeamEventMap[T]) => {
        this.off(event, wrapper as TeamEventHandler<T>);
        handler(data);
      };
      this.on(event, wrapper as TeamEventHandler<T>);
    }
  
    off<T extends TeamEventType>(
      event: T,
      handler: TeamEventHandler<T>
    ): void {
      this.listeners.get(event)?.delete(handler);
    }
  
    emit<T extends TeamEventType>(event: T, data: TeamEventMap[T]): void {
      const handlers = this.listeners.get(event);
      if (!handlers) return;
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (err) {
          console.error(`[TeamEvent] ${event} handler error:`, err);
        }
      }
    }
  
    clear(): void {
      this.listeners.clear();
    }
  }