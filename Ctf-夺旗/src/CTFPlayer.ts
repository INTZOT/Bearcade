import { Player, world } from "@minecraft/server";
import { Team } from "./Team";
import { PlayerState } from "./types";

export class CTFPlayer {
  public readonly uuid: string;
  public readonly name: string;
  public state: PlayerState;
  public team: Team | null;
  public economy: number;
  private currentScoreboardName: string | null;

  constructor(player: Player) {
    this.uuid = player.id;
    this.name = player.name;
    this.state = PlayerState.ALIVE;
    this.team = null;
    this.economy = 0;
    this.currentScoreboardName = null;
  }

  /** 获取原版玩家对象（可能离线） */
  getPlayer(): Player | undefined {
    // TODO: 优先使用 GlobalDataCache 减少 API 调用
    return world.getAllPlayers().find(p => p.id === this.uuid);
  }

  /** 获取所在队伍对象 */
  getTeam(): Team | null {
    return this.team;
  }

  /** 判断是否与指定玩家同队 */
  isSameTeam(other: CTFPlayer): boolean {
    return this.team !== null && this.team === other.team;
  }

  // ===== 计分板操作（对接 ScoreboardManager） =====
  addScoreboard(name: string): void {
    this.currentScoreboardName = name;
    // TODO
  }

  removeScoreboard(name: string): void {
    if (this.currentScoreboardName === name) {
      this.currentScoreboardName = null;
    }
    // TODO
  }

  switchScoreboard(name: string): void {
    this.currentScoreboardName = name;
    // TODO
  }

  // ===== 经济系统 =====
  addEconomy(amount: number): void {
    this.economy += amount;
    // TODO: 触发计分板更新、播放音效
  }

  reduceEconomy(amount: number): boolean {
    if (this.economy < amount) return false;
    this.economy -= amount;
    return true;
  }

  // ===== 生命状态 =====
  onDeath(): void {
    this.state = PlayerState.DEAD;
    // TODO: 若携带旗帜则触发 Flag.drop()；切换旁观模式
  }

  onRespawn(): void {
    this.state = PlayerState.ALIVE;
    // TODO: 传送回队伍出生点、重置装备、恢复状态
  }

  // ===== 商店 =====
  openShop(shopName: string): void {
    // TODO: 调用 ShopManager.showShop()
  }
}
