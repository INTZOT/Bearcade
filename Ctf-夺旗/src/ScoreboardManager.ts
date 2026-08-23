import { Player } from "@minecraft/server";
import { ensureObjective, setHudTitle, clearHudTitle } from "../../shared/minigame-core/scoreboardHud";
import { GlobalDataCache } from "./GlobalDataCache";
import { ScoreboardTemplate } from "./ScoreboardTemplate";

export class ScoreboardManager {
    // 属性1：计分板模板对象 Map<模板名, ScoreboardTemplate>
    private templates: Map<string, ScoreboardTemplate> = new Map();
    // 属性2：各玩家正在展示的计分板 Map<UUID, 模板名>
    private playerDisplay: Map<string, string> = new Map();

    /**
     * 创建计分板模板
     */
    public createTemplate(templateName: string): ScoreboardTemplate {
        const template = new ScoreboardTemplate(templateName);
        this.templates.set(templateName, template);
        return template;
    }

    /**
     * 设置玩家显示的计分板
     */
    public setPlayerDisplay(playerUuid: string, templateName: string): void {
        this.playerDisplay.set(playerUuid, templateName);
        // 立即更新该玩家的计分板
        this.updatePlayerScoreboard(playerUuid);
    }

    /**
     * 更新所有玩家的计分板
     */
    public updateAll(): void {
        for (const [uuid] of this.playerDisplay) {
            this.updatePlayerScoreboard(uuid);
        }
    }

    /**
     * 更新单个玩家的计分板
     */
    private updatePlayerScoreboard(playerUuid: string): void {
        const templateName = this.playerDisplay.get(playerUuid);
        if (!templateName) return;
        const template = this.templates.get(templateName);
        if (!template) return;

        // 获取玩家对象（需从全局缓存获取）
        const player = this.getPlayerByUuid(playerUuid);
        if (!player) return;

        const objectiveId = `ctf_${templateName}`;
        const objective = ensureObjective(objectiveId, templateName);
        if (!objective) return;

        // 渲染并设置 HUD
        const message = template.render(objectiveId, player.name);
        setHudTitle(player, message);
    }

    /**
     * 设置计分板显示状态（显示/隐藏）
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

    /**
     * 获取玩家对象（需结合全局数据缓存实现）
     */
    private getPlayerByUuid(uuid: string): Player | undefined {
        return GlobalDataCache.getInstance().getPlayerFromUUID(uuid);
    }
}