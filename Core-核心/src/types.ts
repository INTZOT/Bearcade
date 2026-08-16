export const IPC_CHANNEL = "bearcade:ipc";
export const REGISTRY_KEY = "bearcade:registry";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";
/** Core 包的 manifest header UUID,唯一常量定义在 shared/minigame-core/types.ts,这里只转发 */
export { CORE_PACK_ID } from "../../shared/minigame-core/types";

export type RoomStatus = "initializing" | "idle" | "running";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface RoomInfo {
  id: number;
  players: number;
  status: RoomStatus;
  lastSeen: number;
  reserved: number;
  stale: boolean;
}

export interface GameEntry {
  game: string;
  displayName: string;
  packId: string;
  roomCount: number;
  maxPlayers: number;
  /** 开局所需最少玩家数(派对模式带队前校验在线人数用,默认 2) */
  minPlayers: number;
  partyAvailable: boolean;
  prepSpawn: Vec3;
  rooms: Map<number, RoomInfo>;
  /** 本会话是否收到过该游戏包的注册/状态上报;未激活的历史注册不进入菜单 */
  active: boolean;
  /** 最近一次注册或房间状态上报时间戳,用于剔除停止上报的游戏包 */
  lastActivity: number;
}

export interface RegisterPayload {
  game: string;
  displayName: string;
  roomCount: number;
  maxPlayers: number;
  /** 开局所需最少玩家数(默认 2) */
  minPlayers?: number;
  partyAvailable?: boolean;
  prepSpawn: Vec3;
}

export interface RoomReport {
  id: number;
  players: number;
  status: RoomStatus;
}

export interface RoomStatusPayload {
  game: string;
  rooms: RoomReport[];
}

export interface IpcEnvelope {
  op: string;
  packId: string;
  payload?: unknown;
}
