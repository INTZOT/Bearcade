import { Player } from "@minecraft/server";
import { CTFPlayer } from "./CTFPlayer";

export class PlayerManager {
  private players: Map<string, CTFPlayer>;
  

  constructor() {
    this.players = new Map();
  }

  /** 创建或获取 CTF 玩家对象 */
  getOrCreatePlayer(player: Player): CTFPlayer {
    let ctfPlayer = this.players.get(player.id);
    if (!ctfPlayer) {
      ctfPlayer = new CTFPlayer(player);
      ctfPlayer.economy = 100; // initial economy from config
      this.players.set(player.id, ctfPlayer);
    }
    return ctfPlayer;
  }

  getPlayer(uuid: string): CTFPlayer | undefined {
    return this.players.get(uuid);
  }

  removePlayer(uuid: string): boolean {
    return this.players.delete(uuid);
  }

  getAllPlayers(): CTFPlayer[] {
    return Array.from(this.players.values());
  }

  /** 给所有玩家增加经济 */
  addEconomyToAll(amount: number): void {
    for (const player of this.players.values()) {
      player.addEconomy(amount);
    }
  }

  getPlayersByTeam(teamId: string): CTFPlayer[] {
    return this.getAllPlayers().filter(p => p.team?.id === teamId);
  }

  clear(): void {
    this.players.clear();
  }
}
