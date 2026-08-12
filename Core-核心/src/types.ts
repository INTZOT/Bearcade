export const IPC_CHANNEL = "bearcade:ipc";
export const REGISTRY_KEY = "bearcade:registry";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";

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
  partyAvailable: boolean;
  prepSpawn: Vec3;
  rooms: Map<number, RoomInfo>;
}

export interface RegisterPayload {
  game: string;
  displayName: string;
  roomCount: number;
  maxPlayers: number;
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
