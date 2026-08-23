import { CTFPlayer } from "./CTFPlayer";
import { Team } from "./Team";
import { Vector3, FlagState } from "./types";
import { generateUUID } from "./utils";

export class Flag {
  public readonly uuid: string;
  public team: Team;
  public state: FlagState;
  public position: Vector3;
  public homePosition: Vector3;
  public carrier: CTFPlayer | null;
  public dropTimer: number; // 掉落回城倒计时（刻）

  constructor(team: Team, homePosition: Vector3) {
    this.uuid = generateUUID();
    this.team = team;
    this.homePosition = { ...homePosition };
    this.position = { ...homePosition };
    this.state = FlagState.HOME;
    this.carrier = null;
    this.dropTimer = 0;
  }

  /** 回城（被夺回或回合重置） */
  returnHome(): boolean {
    this.state = FlagState.HOME;
    this.position = { ...this.homePosition };
    this.carrier = null;
    this.dropTimer = 0;
    // TODO: 实体传送、粒子特效、清除旧实体
    return true;
  }

  /** 掉落（携带者死亡或断开连接） */
  drop(position: Vector3): boolean {
    if (this.state !== FlagState.CARRIED) return false;
    this.state = FlagState.DROPPED;
    this.position = { ...position };
    this.carrier = null;
    this.dropTimer = 30 * 20; // 30秒回城（单位：刻）
    // TODO: 生成旗帜掉落实体、启动回城计时器
    return true;
  }

  /** 捡起（敌方/己方规则需根据玩法调整） */
  pickup(carrier: CTFPlayer): boolean {
    // 常规规则：不能捡自家旗帜；特殊规则可在此扩展
    if (this.state === FlagState.HOME && carrier.team === this.team) return false;
    this.state = FlagState.CARRIED;
    this.carrier = carrier;
    this.dropTimer = 0;
    // TODO: 绑定到玩家、更新 HUD、播放音效
    return true;
  }

  /** 每 tick 更新（掉落回城逻辑等） */
  update(): void {
    if (this.state === FlagState.DROPPED) {
      this.dropTimer -= 2; // 假设每 100ms 调用（2刻）
      if (this.dropTimer <= 0) {
        this.returnHome();
      }
    }
    // TODO: 同步携带者位置、检查是否进入敌方基地
  }
}
