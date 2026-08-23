import { CTFPlayer } from "./CTFPlayer";
import { Flag } from "./Flag";
import { Vector3 } from "./types";
import { generateUUID } from "./utils";

export class Team {
  public readonly uuid: string;
  public readonly id: string;
  public readonly name: string;
  public readonly color: string;
  public players: CTFPlayer[];
  public score: number;
  public flag: Flag | null;
  public spawnPoint: Vector3;

  constructor(id: string, name: string, color: string) {
    this.uuid = generateUUID();
    this.id = id;
    this.name = name;
    this.color = color;
    this.players = [];
    this.score = 0;
    this.flag = null;
    this.spawnPoint = { x: 0, y: 80, z: 0 };
  }

  addPlayer(player: CTFPlayer): void {
    if (!this.players.includes(player)) {
      this.players.push(player);
      player.team = this;
    }
  }

  removePlayer(player: CTFPlayer): void {
    const index = this.players.indexOf(player);
    if (index !== -1) {
      this.players.splice(index, 1);
      player.team = null;
    }
  }

  addWin(): void {
    this.score++;
    // TODO: 广播得分、检查是否达到 maxScore
  }

  isEmpty(): boolean {
    return this.players.length === 0;
  }
}
