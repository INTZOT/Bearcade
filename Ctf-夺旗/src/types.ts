export enum GameState {
  INITIALIZING = "initializing",
  WAITING = "idle",
  RUNNING = "running",
  ENDING = "ending"
}

export enum PlayerState {
  ALIVE = "alive",
  DEAD = "dead",
  SPECTATING = "spectating",
  DISCONNECTED = "disconnected"
}

export enum FlagState {
  HOME = "home",
  CARRIED = "carried",
  DROPPED = "dropped"
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface TeamConfig {
  id: string;
  name: string;
  color: string;
  hex: string;
}

export interface RoomInfo {
  id: number;
  dimensionId: string;
  status: GameState;
  playerIds: string[];
  templateOrigin?: Vector3;
}
