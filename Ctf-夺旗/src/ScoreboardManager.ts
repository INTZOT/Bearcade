import { Player, world } from "@minecraft/server";
import { ensureObjective, setHudTitle, clearHudTitle } from "../../shared/minigame-core/scoreboardHud";
import { ScoreboardTemplate } from "./ScoreboardTemplate";

export class ScoreboardManager {
  private templates: Map<string, ScoreboardTemplate>;
  private playerDisplay: Map<string, string>;

  constructor() {
    this.templates = new Map();
    this.playerDisplay = new Map();
  }

  public createTemplate(templateName: string): ScoreboardTemplate {
    const template = new ScoreboardTemplate();
    this.templates.set(templateName, template);
    return template;
  }

  /**
   * 设置玩家显示的计分板
   * @param playerUuid 玩家id
   * @param templateName 模板名
   */
  public setPlayerDisplay(playerUuid: string, templateName: string): void {
    this.playerDisplay.set(playerUuid, templateName);
    this.updatePlayerScoreboard(playerUuid);
  }

  /**
   * 更新所有在线玩家的计分板
   */
  public updateAll(): void {
    for (const player of world.getAllPlayers()) {
      if (this.playerDisplay.has(player.id)) {
        this.updatePlayerScoreboard(player.id);
      }
    }
  }

  private updatePlayerScoreboard(playerUuid: string): void {
    const templateName = this.playerDisplay.get(playerUuid);
    if (!templateName) return;
    const template = this.templates.get(templateName);
    if (!template) return;

    const player = this.getPlayerByUuid(playerUuid);
    if (!player) return;

    const objectiveId = `ctf_${templateName}`;
    const objective = ensureObjective(objectiveId, templateName);
    if (!objective) return;

    const message = template.render(player);
    setHudTitle(player, message);
  }

  /**
   * 设置玩家计分板显示状态
   * @param player 玩家
   * @param visible 是否显示
   */
  public setDisplayState(player: Player, visible: boolean): void {
    const uuid = player.id;
    if (visible) {
      this.updatePlayerScoreboard(uuid);
    } else {
      clearHudTitle(player);
    }
    const templateName = this.playerDisplay.get(uuid);
    if (templateName) {
      const template = this.templates.get(templateName);
      if (template) template.visible = visible;
    }
  }

  private getPlayerByUuid(uuid: string): Player | undefined {
    return world.getAllPlayers().find(p => p.id === uuid);
  }
}