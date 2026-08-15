export const IPC_CHANNEL = "bearcade:ipc";
export const REGISTRY_KEY = "bearcade:registry";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";
/** Core 包的 manifest header UUID,IPC 来源校验用(与 config/packs.json 的 core.headerUuid 保持一致) */
export const CORE_PACK_ID = "9ce781fb-ff67-4e21-904d-6a5b8b457703";

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
