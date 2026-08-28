import { Entity } from '@minecraft/server';
import { MinecraftEntityTypes } from '@minecraft/vanilla-data';
import { config } from './config';
import { CTFPlayer } from './CTFPlayer';
import { GameManager } from './GameManager';
import { Vector3, FlagState } from './types';
import { generateUUID } from './utils';

/**
 * Flag - 旗帜实体
 */
export class Flag {
  public flagEntity: Entity | null;
  public readonly uuid: string;
  public readonly teamId: string;
  public state: FlagState;
  public position: Vector3;
  public homePosition: Vector3;
  public carrier: CTFPlayer | null;
  /** 掉落回城倒计时（刻） */
  public dropTimer: number;

  constructor(teamId: string, homePosition: Vector3) {
    this.uuid = generateUUID();
    this.teamId = teamId;
    this.homePosition = { ...homePosition };
    this.position = { ...homePosition };
    this.state = FlagState.HOME;
    this.carrier = null;
    this.dropTimer = 0;
    this.flagEntity = null;

    this.spawnFlagEntity();
  }

  /** 回城（被夺回或回合重置） */
  returnHome(): boolean {
    this.state = FlagState.HOME;
    this.position = { ...this.homePosition };
    this.carrier = null;
    this.dropTimer = 0;

    this.flagEntity?.remove();
    this.spawnFlagEntity();

    return true;
  }

  /** 掉落（携带者死亡或断开连接） */
  drop(position: Vector3): boolean {
    if (this.state !== FlagState.CARRIED) return false;
    this.state = FlagState.DROPPED;
    this.position = { ...position };
    this.carrier = null;
    this.dropTimer = config.flagReturnTime * 20; // 30秒回城

    this.spawnFlagEntity();

    return true;
  }

  /**
   * 捡起
   * @param carrier 携带者
   * @param canPickup 外部传入的判断函数
   */
  pickup(carrier: CTFPlayer, canPickup: boolean = true): boolean {
    if (!canPickup) return false;
    this.state = FlagState.CARRIED;
    this.carrier = carrier;
    this.dropTimer = 0;

    this.flagEntity?.remove();
    this.flagEntity = null;

    return true;
  }

  /** 每 tick 更新（掉落回城逻辑等） */
  update(): void {
    if (this.state === FlagState.DROPPED) {
      this.dropTimer -= 2;
      if (this.dropTimer <= 0) {
        this.returnHome();
      }
    }
    if (this.state === FlagState.CARRIED && this.carrier) {
      this.position = this.carrier.getPlayer()?.location ?? this.position;
    }
    if (this.flagEntity?.isValid) {
      this.position = this.flagEntity.location;
    }
  }

  /** 是否被敌方携带 */
  isCarriedByEnemy(carrierTeamId: string | null): boolean {
    return this.state === FlagState.CARRIED && carrierTeamId !== null && carrierTeamId !== this.teamId;
  }

  /**
   * 生成旗帜实体
   */
  private spawnFlagEntity(): void {
    if (this.flagEntity?.isValid) return;
    this.flagEntity = GameManager.getInstance().spawnEntity(MinecraftEntityTypes.ArmorStand, this.position);
    this.flagEntity.nameTag = `${this.teamId}的旗帜`;
  }
}