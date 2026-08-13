import type {
  Player,
  PlayerBreakBlockBeforeEvent,
  PlayerPlaceBlockBeforeEvent,
} from "@minecraft/server";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface MinigameConfig {
  gameId: string;
  displayName: string;
  packId: string;
  roomCount: number;
  maxPlayers: number;
  /** 派对模式可用性:去除最大人数上限后仍可正常运行则为 true(默认 false) */
  partyAvailable?: boolean;
  /** 开局所需最少玩家数(默认 2) */
  minPlayers?: number;
  /** 派对模式下的开局倒计时 tick 数(默认 60 秒) */
  partyStartDelayTicks?: number;
  /** 调试模式下的开局倒计时 tick 数(默认 5 秒) */
  debugStartDelayTicks?: number;
  prepSpawn: Vec3;
  templateFrom: Vec3;
  templateTo: Vec3;
  roomCopyOrigin: Vec3;
  tickingFrom: Vec3;
  tickingTo: Vec3;
  structureId: string;
  templateSpawn: Vec3;
  startPositions: Vec3[];
  /** 结构分块尺寸(默认 64):模板横向超过该值会自动切成多块捕获/放置 */
  tileSize?: number;
  lobbyDimensionId?: string;
  ipcChannel?: string;
  startDelayTicks?: number;
  endDelayTicks?: number;
  gameTickInterval?: number;
  heartbeatInterval?: number;
  /** 满员后缩短倒计时:剩余时间大于该 tick 数时压到该值(默认 100 tick = 5 秒) */
  startFullShortenTicks?: number;
}

export interface MinigameHooks {
  /** 对局开始(运行时已完成倒计时与状态切换),在此初始化玩法 */
  onGameStart?(roomId: number, players: Player[]): void;
  /** 结算重置前(玩家尚未传送离场),用于清理道具等 */
  onBeforeReset?(roomId: number): void;
  /** 场地从模板重新复制完成后 */
  onRoomReset?(roomId: number): void;
  /** 打开该游戏的运行时配置界面(供 /bearcade:config 调用) */
  openConfig?(player: Player): void;
  /**
   * 房间维度内的方块放置校验:返回 true 放行(合法棋步等),返回 false 一律取消。
   * 注意:该回调运行在 restricted execution 模式,只能同步改内存状态,
   * 原生调用(消息/传送/表单)须延迟到 system.run。
   */
  canPlace?(event: PlayerPlaceBlockBeforeEvent, roomId: number): boolean;
  /** 房间维度内的方块破坏校验:返回 true 放行,默认 false 取消 */
  canBreak?(event: PlayerBreakBlockBeforeEvent, roomId: number): boolean;
}
