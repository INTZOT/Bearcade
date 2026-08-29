import { Player } from "@minecraft/server";

export interface CachedPlayerData {
  uuid: string;
  name: string;
  joinTime: number;
  playerObjct: Player;
}

export class GlobalDataCache {
  private cache: Map<string, CachedPlayerData>;
  private static instance: GlobalDataCache;

  private constructor() {
    this.cache = new Map();
  }

  static getInstance(): GlobalDataCache {
    if (!GlobalDataCache.instance) {
      GlobalDataCache.instance = new GlobalDataCache();
    }
    return GlobalDataCache.instance;
  }

  onPlayerJoin(player: Player): void {
    this.cache.set(player.id, {
      uuid: player.id,
      name: player.name,
      joinTime: Date.now(),
      playerObjct: player
    });
  }

  // onPlayerLeave(playerId: string): void {
  //   // 生命周期跟随服务器，保留数据不删除，减少后续 UUID->Name 查询
  // }

  get(uuid: string): CachedPlayerData | undefined {
    return this.cache.get(uuid);
  }

  getPlayerFromUUID(uuid: string): Player | undefined {
    const data = this.get(uuid);
    return data ? data.playerObjct : undefined;
  }

  getByName(name: string): CachedPlayerData | undefined {
    for (const data of this.cache.values()) {
      if (data.name === name) return data;
    }
    return undefined;
  }
}
