import { Player } from '@minecraft/server';
import { CTFPlayer } from './CTFPlayer';

/**
 * 玩家对象生命周期管理
 */
export class PlayerManager {
  private players = new Map<string, CTFPlayer>();

  /** 创建或获取 CTF 玩家对象 */
  getOrCreatePlayer(player: Player): CTFPlayer {
    let ctfPlayer = this.players.get(player.id);
    if (!ctfPlayer) {
      ctfPlayer = new CTFPlayer(player);
      this.players.set(player.id, ctfPlayer);
    }
    return ctfPlayer;
  }

  getPlayer(uuid: string): CTFPlayer | undefined {
    return this.players.get(uuid);
  }

  /** 删除玩家 */
  removePlayer(uuid: string): boolean {
    return this.players.delete(uuid);
  }

  getAllPlayers(): CTFPlayer[] {
    return Array.from(this.players.values());
  }

  /** 给所有玩家增加经济 */
  addEconomyToAll(amount: number): void {
    if (amount <= 0) return;
    for (const player of this.players.values()) {
      player.addEconomy(amount);
    }
  }

  /** 清空所有玩家 */
  clear(): void {
    this.players.clear();
  }
}