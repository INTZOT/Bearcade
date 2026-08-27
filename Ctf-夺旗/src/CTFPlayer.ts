import { Player, world } from '@minecraft/server';
import { PlayerState } from './types';

/**
 * CTFPlayer - 玩家数据对象
 */
export class CTFPlayer {
  public readonly uuid: string;
  public readonly name: string;
  public state: PlayerState;
  public teamId: string | null;
  public economy: number;
  public deathCount: number;
  public killCount: number;

  constructor(player: Player) {
    this.uuid = player.id;
    this.name = player.name;
    this.state = PlayerState.ALIVE;
    this.teamId = null;
    this.economy = 0;
    this.deathCount = 0;
    this.killCount = 0;
  }

  getPlayer(): Player | undefined {
    return world.getAllPlayers().find(p => p.id === this.uuid);
  }

  /** 判断是否与指定玩家同队（比较 teamId 缓存） */
  isSameTeam(other: CTFPlayer): boolean {
    return this.teamId !== null && this.teamId === other.teamId;
  }

  hasTeam(): boolean {
    return this.teamId !== null;
  }

  // ===== 经济系统 =====
  addEconomy(amount: number): void {
    if (amount <= 0) return;
    this.economy += amount;
  }

  getEconomy(): number {
    return this.economy;
  }

  setEconomy(amount: number): boolean {
    if (amount < 0) return false;
    this.economy = amount;
    return true;
  }

  reduceEconomy(amount: number): boolean {
    if (amount <= 0) return true;
    if (this.economy < amount) return false;
    this.economy -= amount;
    return true;
  }

  onKill(): void {
    this.killCount++;
  }

  // ===== 生命状态 =====
  onDeath(): void {
    this.state = PlayerState.DEAD;
    this.deathCount++;
  }

  onRespawn(): void {
    this.state = PlayerState.ALIVE;
  }
}