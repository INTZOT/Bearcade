// ============================================================
// HudBridge —— 表现层落地(Bearcade 适配版,架构设计 §3.7 修订)
// 原文档「JSON UI + actionbar 兜底 / HTML Overlay」两路线讨论作废:
// 共享 hud/ 资源包已把 title 通道重排版为右侧面板(hud_screen.json),
// 本类只负责组装内容:
// - 比分行 / 三资源行 / 技能冷却行 / 占点行 → setHudTitle 周期渲染;
// - 战斗瞬时反馈(施法失败/补给冷却/击杀提示)→ actionbar toast;
// - 约束:check-packs 禁止游戏包自带 ui/hud_screen.json,状态效果
//   图标第一版文字化;真要图标需改共享主包(另行走评审)。
// ============================================================
import type { Player, RawMessage } from "@minecraft/server";
import { hudMessage, setHudTitle } from "../../../shared/minigame-core/scoreboardHud";
import type { MatchSession } from "./session";

const HUD_REFRESH_INTERVAL_TICKS = 10;
const HUD_STAY_TICKS = 80;

export class HudBridge {
  private lastRenderTick = 0;

  constructor(private readonly session: MatchSession) {}

  tick(nowTick: number): void {
    if (nowTick - this.lastRenderTick < HUD_REFRESH_INTERVAL_TICKS) return;
    this.lastRenderTick = nowTick;
    this.renderAll();
  }

  renderAll(): void {
    for (const state of this.session.players.values()) {
      if (!state.player.isValid) continue;
      setHudTitle(state.player, this.compose(state.player), HUD_STAY_TICKS);
    }
  }

  /** 战斗瞬时反馈(actionbar) */
  toast(player: Player, message: string): void {
    try {
      player.onScreenDisplay.setActionBar(message);
    } catch {
      // 忽略
    }
  }

  dispose(): void {
    // 标题清理由 Core 回大厅契约 + onBeforeReset 双保险,这里无需处理
  }

  // ── 内部 ─────────────────────────────────────────────────────

  /** 组装单玩家 HUD:比分 / 三资源 / 技能冷却 / 占点 */
  private compose(player: Player): RawMessage {
    const parts: RawMessage[] = [];

    // 比分行
    const scoreParts: string[] = [];
    for (const teamId of this.session.teams.teamIds) {
      const score = this.session.score.getTeamScore(teamId);
      scoreParts.push(
        `${this.session.teams.teamDisplayName(teamId)} §f${score}`,
      );
    }
    const target = this.session.config.scoreTarget;
    parts.push({ text: `§6${scoreParts.join(" §7:§f ")}§7 / 目标 ${target}§r` });

    // 三资源行(临时护甲以 (+N) 追加)
    const state = this.session.attributes.get(player.id);
    if (state) {
      const tempArmor = this.session.attributes.getTempArmor(player.id);
      const tempText = tempArmor > 0 ? `§d(+${tempArmor})` : "";
      const hp = Math.max(0, Math.floor(state.current.hp));
      const armor = Math.max(0, Math.floor(state.current.armor));
      const mana = Math.floor(state.current.mana);
      parts.push({ text: "\n" });
      parts.push({
        text: `§c❤ ${hp}/${state.base.hp}§r §9甲 ${armor}/${state.base.armor}${tempText}§r §b魔 ${mana}/${state.base.mana}§r`,
      });
    }

    // 技能冷却行
    const cooldownLines = this.session.skills.getCooldownSummary(player.id);
    if (cooldownLines.length > 0) {
      parts.push({ text: "\n" });
      parts.push({ text: cooldownLines.join("§7 | ") });
    }

    // 占点行
    const captureStates = this.session.capture.states();
    if (captureStates.length > 0) {
      const pointParts = captureStates.map((point) => {
        const ownerColor = point.owner
          ? this.session.teams.teamDisplayName(point.owner)
          : "§7中立";
        const capturing = point.capturingTeam
          ? `§e(${Math.ceil(point.progressTicks / 20)}s)`
          : "";
        return `§f${point.def.displayName} ${ownerColor}${capturing}`;
      });
      parts.push({ text: "\n" });
      parts.push({ text: pointParts.join("§7 | ") });
    }

    return hudMessage(parts);
  }
}
