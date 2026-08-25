import { Vector3 } from './types';

/**
 * 队伍配置接口
 */
export interface TeamMetadata {
  id: string;
  name: string;
  color: string;
  hex: string;
  spawnPoint?: Vector3;
  flagHomePosition?: Vector3;
  maxPlayers?: number;
}

/**
 * Team - 纯数据实体
 * 
 * 职责：仅存储队伍元数据和状态，不管理玩家，不引用 Flag
 * 玩家归属关系由 TeamManager 统一管理，避免双向依赖
 */
export class Team {
  public readonly id: string;
  public readonly name: string;
  public readonly color: string;
  public readonly hex: string;
  public score: number;
  public spawnPoint: Vector3;
  public flagHomePosition: Vector3;

  /** 队伍容量上限（默认无限制） */
  public readonly maxPlayers: number;

  constructor(config: TeamMetadata) {
    this.id = config.id;
    this.name = config.name;
    this.color = config.color;
    this.hex = config.hex;
    this.score = 0;
    this.spawnPoint = config.spawnPoint ?? { x: 0, y: 80, z: 0 };
    this.flagHomePosition = config.flagHomePosition ?? { x: 0, y: 80, z: 0 };
    this.maxPlayers = config.maxPlayers ?? Number.MAX_SAFE_INTEGER;
  }

  /** 增加得分 */
  addScore(amount: number = 1): void {
    this.score += amount;
  }

  /** 重置得分 */
  reset(): void {
    this.score = 0;
  }

  /** 格式化显示名称（带颜色代码） */
  getDisplayName(): string {
    return `${this.color}${this.name}§r`;
  }
}