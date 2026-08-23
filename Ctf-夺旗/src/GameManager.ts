import { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { FlagManager } from "./FlagManager";
import { GlobalDataCache } from "./GlobalDataCache";
import { PlayerManager } from "./PlayerManager";
import { ScoreboardManager } from "./ScoreboardManager";
import { TeamManager } from "./TeamManager";
import { Timer } from "./Timer";
import { GameState } from "./types";


export class GameManager {
  private static instance: GameManager;
  private timeStamp: number; // 游戏刻时间戳
  private gamestate: GameState;
  private roomId: number | null;
  private runtime: MinigameRuntime | null;
  private flagManager: FlagManager | null;
  private teamManager: TeamManager | null;
  private playerManager: PlayerManager | null;
  private scoreboardManager: ScoreboardManager | null;
  
  private constructor() {
    this.gamestate = GameState.ENDING;
    this.timeStamp = 0;
    this.roomId = null;
    this.runtime = null;
    this.flagManager = new FlagManager();
    this.teamManager = new TeamManager();
    this.playerManager = new PlayerManager();
    this.scoreboardManager = new ScoreboardManager();
  }

  static getInstance(): GameManager {
    if (!GameManager.instance) {
      GameManager.instance = new GameManager();
    }
    return GameManager.instance;
  }

  initialize(runtime: MinigameRuntime, roomId: number): void {
    this.gamestate = GameState.INITIALIZING;
    this.runtime = runtime;
    this.roomId = roomId;
    
    const mainScoreboard = this.scoreboardManager?.createTemplate("ctf_main");
    mainScoreboard?.addColumn("team_name", "队伍: {team}", "team");
    mainScoreboard?.addColumn("player_money", "经济: {money}", "money");
    mainScoreboard?.addColumn("time_left", "剩余时间: {time}", "time");
  }

  start(): void {
    if (this.runtime === null ) return;

    const players = this.runtime.roomPlayers(this.roomId!);
    players.forEach((player) => {
      const ctfPlayer = this.playerManager?.getOrCreatePlayer(player);
      ctfPlayer?.addScoreboard("ctf");
    });


    this.gamestate = GameState.RUNNING;
  }

  end(): void {
    this.flagManager?.resetAll();
    this.teamManager?.clearAllTeams();
    this.playerManager?.clear();
    this.gamestate = GameState.ENDING;
    this.runtime?.endGame(this.roomId!, "游戏结束");
  } 

  /** 主循环 tick（每 100ms / 2 ticks 调用） */
  tick(): void {
    if(this.gamestate !== GameState.RUNNING) return;
    this.timeStamp += 2;
    Timer.update(2);
  }

  getGameState(): GameState {
    return this.gamestate;
  }

  getTimeStamp(): number {
    return this.timeStamp;
  }

  getRoomId(): number | null {
    return this.roomId;
  }

  getRuntime(): MinigameRuntime | null {
    return this.runtime;
  }

  getFlagManager(): FlagManager | null {
    return this.flagManager;
  }

  getTeamManager(): TeamManager | null {
    return this.teamManager;
  }

  getPlayerManager(): PlayerManager | null {
    return this.playerManager;
  }

  
}
