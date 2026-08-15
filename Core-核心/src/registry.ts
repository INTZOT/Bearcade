import { world } from "@minecraft/server";
import {
  REGISTRY_KEY,
  type GameEntry,
  type RegisterPayload,
  type RoomInfo,
  type RoomReport,
} from "./types";

const STALE_MS = 15_000;

function roomKey(game: string, roomId: number): string {
  return `${game}:${roomId}`;
}

function dimensionId(game: string, roomId: number): string {
  return `bearcade:${game}_${roomId}`;
}

export class GameRegistry {
  private games = new Map<string, GameEntry>();
  private playerRooms = new Map<string, string>();

  constructor() {
    this.load();
  }

  load(): void {
    try {
      const raw = world.getDynamicProperty(REGISTRY_KEY);
      if (typeof raw !== "string" || raw.length === 0) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        const entry = item as Partial<
          RegisterPayload & { packId: string; minPlayers?: number }
        >;
        if (
          typeof entry.game !== "string" ||
          typeof entry.displayName !== "string" ||
          typeof entry.packId !== "string" ||
          typeof entry.roomCount !== "number" ||
          typeof entry.maxPlayers !== "number" ||
          typeof entry.prepSpawn !== "object"
        ) {
          continue;
        }
        this.createEntry(
          entry.game,
          entry.displayName,
          entry.packId,
          entry.roomCount,
          entry.maxPlayers,
          entry.minPlayers,
          entry.partyAvailable === true,
          entry.prepSpawn as GameEntry["prepSpawn"],
        );
      }
      console.warn("[Bearcade Core] 已从动态属性恢复游戏注册表");
    } catch (error) {
      console.warn("[Bearcade Core] 注册表加载失败", error);
    }
  }

  private persist(): void {
    const snapshot = [...this.games.values()].map((entry) => ({
      game: entry.game,
      displayName: entry.displayName,
      packId: entry.packId,
      roomCount: entry.roomCount,
      maxPlayers: entry.maxPlayers,
      minPlayers: entry.minPlayers,
      partyAvailable: entry.partyAvailable,
      prepSpawn: entry.prepSpawn,
    }));
    world.setDynamicProperty(REGISTRY_KEY, JSON.stringify(snapshot));
  }

  private createEntry(
    game: string,
    displayName: string,
    packId: string,
    roomCount: number,
    maxPlayers: number,
    minPlayers: number | undefined,
    partyAvailable: boolean,
    prepSpawn: GameEntry["prepSpawn"],
  ): GameEntry {
    const rooms = new Map<number, RoomInfo>();
    for (let id = 1; id <= roomCount; id++) {
      rooms.set(id, {
        id,
        players: 0,
        status: "initializing",
        lastSeen: 0,
        reserved: 0,
        stale: true,
      });
    }
    const entry: GameEntry = {
      game,
      displayName,
      packId,
      roomCount,
      maxPlayers,
      minPlayers: minPlayers ?? 2,
      partyAvailable,
      prepSpawn,
      rooms,
    };
    this.games.set(game, entry);
    return entry;
  }

  upsertGame(payload: RegisterPayload, packId: string): boolean {
    if (
      typeof payload.game !== "string" ||
      !/^[a-z0-9_]+$/.test(payload.game) ||
      typeof payload.displayName !== "string" ||
      typeof payload.roomCount !== "number" ||
      !Number.isInteger(payload.roomCount) ||
      payload.roomCount < 1 ||
      typeof payload.maxPlayers !== "number" ||
      !Number.isInteger(payload.maxPlayers) ||
      payload.maxPlayers < 1 ||
      (payload.minPlayers !== undefined &&
        (!Number.isInteger(payload.minPlayers) || payload.minPlayers < 1)) ||
      (payload.partyAvailable !== undefined &&
        typeof payload.partyAvailable !== "boolean") ||
      !payload.prepSpawn ||
      typeof payload.prepSpawn.x !== "number" ||
      typeof payload.prepSpawn.y !== "number" ||
      typeof payload.prepSpawn.z !== "number"
    ) {
      return false;
    }
    this.createEntry(
      payload.game,
      payload.displayName,
      packId,
      payload.roomCount,
      payload.maxPlayers,
      payload.minPlayers,
      payload.partyAvailable === true,
      payload.prepSpawn,
    );
    this.persist();
    console.warn(
      `[Bearcade Core] 游戏注册:${payload.displayName}(${payload.game}),${payload.roomCount} 个房间`,
    );
    return true;
  }

  updateRooms(game: string, packId: string, rooms: RoomReport[]): boolean {
    const entry = this.games.get(game);
    if (!entry || entry.packId !== packId) return false;
    if (!Array.isArray(rooms)) return false;

    for (const report of rooms) {
      if (
        !report ||
        typeof report.id !== "number" ||
        !Number.isInteger(report.id) ||
        report.id < 1 ||
        report.id > entry.roomCount ||
        typeof report.players !== "number" ||
        !Number.isInteger(report.players) ||
        report.players < 0 ||
        (report.status !== "initializing" &&
          report.status !== "idle" &&
          report.status !== "running")
      ) {
        return false;
      }
    }

    const now = Date.now();
    for (const report of rooms) {
      const room = entry.rooms.get(report.id);
      if (!room) continue;
      room.players = report.players;
      room.status = report.status;
      room.reserved = 0;
      room.lastSeen = now;
      room.stale = false;
    }
    return true;
  }

  tick(now: number): void {
    for (const entry of this.games.values()) {
      for (const room of entry.rooms.values()) {
        if (now - room.lastSeen > STALE_MS) {
          room.stale = true;
        }
      }
    }
  }

  getGame(game: string): GameEntry | undefined {
    return this.games.get(game);
  }

  listGames(): GameEntry[] {
    return [...this.games.values()].sort((a, b) =>
      a.displayName.localeCompare(b.displayName, "zh-CN"),
    );
  }

  getRoom(game: string, roomId: number): RoomInfo | undefined {
    return this.games.get(game)?.rooms.get(roomId);
  }

  effectivePlayers(room: RoomInfo): number {
    return Math.max(room.players, room.reserved);
  }

  canJoin(entry: GameEntry, room: RoomInfo): boolean {
    return (
      !room.stale &&
      room.status === "idle" &&
      this.effectivePlayers(room) < entry.maxPlayers
    );
  }

  roomDimensionId(game: string, roomId: number): string {
    return dimensionId(game, roomId);
  }

  bindPlayer(playerId: string, game: string, roomId: number): void {
    this.playerRooms.set(playerId, roomKey(game, roomId));
  }

  unbindPlayer(playerId: string): void {
    this.playerRooms.delete(playerId);
  }

  getPlayerRoom(playerId: string): string | undefined {
    return this.playerRooms.get(playerId);
  }
}
