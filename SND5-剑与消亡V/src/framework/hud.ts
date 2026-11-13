// ============================================================
// HudBridge —— 表现层落地(Bearcade 适配版,架构设计 §3.7 修订)
// 原文档「JSON UI + actionbar 兜底 / HTML Overlay」两路线讨论作废:
// 共享 hud/ 资源包已把 title 通道重排版为右侧面板(hud_screen.json),
// 本类只负责组装内容:
// - 比分行 / 三资源行 / 技能冷却行 / 占点行 / 状态效果行 → setHudTitle 周期渲染;
// - 战斗瞬时反馈(施法失败/补给冷却/击杀提示)→ actionbar toast;
// - 约束:check-packs 禁止游戏包自带 ui/hud_screen.json,状态效果
//   图标第一版文字化;真要图标需改共享主包(另行走评审)。
// ============================================================
import type { Player, RawMessage } from "@minecraft/server";
import { hudMessage, setHudTitle } from "../../../shared/minigame-core/scoreboardHud";
import type { MatchSession } from "./session";
import type { StatusKind } from "./status/types";

const HUD_REFRESH_INTERVAL_TICKS = 10;
const HUD_STAY_TICKS = 80;

/** 状态行排序:正面 → 中性 → 负面 */
const STATUS_KIND_ORDER: Record<StatusKind, number> = { buff: 0, neutral: 1, debuff: 2 };

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

  /** 组装单玩家 HUD:比分 / 三资源 / 技能冷却 / 占点 / 状态效果 */
  private compose(player: Player): RawMessage {
    const parts: RawMessage[] = [];

    // 比分行(含每秒产分,体现占点数→产分的翻倍曲线)
    const myTeam = this.session.teams.getTeam(player.id);
    const scoreParts: string[] = [];
    for (const teamId of this.session.teams.teamIds) {
      const score = this.session.score.getTeamScore(teamId);
      const selfMark = teamId === myTeam ? "§7(你)§r" : "";
      const income = this.session.score.getIncomeRate(teamId);
      const incomeText = income > 0 ? `§a+${income}/s` : "";
      scoreParts.push(
        `${this.session.teams.teamDisplayName(teamId)}${selfMark} §f${score}${incomeText}`,
      );
    }
    const target = this.session.config.scoreTarget;
    parts.push({ text: `§6${scoreParts.join(" §7:§f ")}§7 / 目标 ${target}§r` });

    // 三资源行(职业名前缀;临时护甲以 (+N) 追加)
    const state = this.session.attributes.get(player.id);
    if (state) {
      const tempArmor = this.session.attributes.getTempArmor(player.id);
      const tempText = tempArmor > 0 ? `§d(+${tempArmor})` : "";
      const hp = Math.max(0, Math.floor(state.current.hp));
      const armor = Math.max(0, Math.floor(state.current.armor));
      const mana = Math.floor(state.current.mana);
      const profName = this.session.injects.professionNameOf?.(
        this.session.players.get(player.id)?.professionId ?? "",
      );
      const profText = profName ? `§6[${profName}]§r ` : "";
      parts.push({ text: "\n" });
      parts.push({
        text: `${profText}§c❤ ${hp}/${state.base.hp}§r §9甲 ${armor}/${state.base.armor}${tempText}§r §b魔 ${mana}/${state.base.mana}§r`,
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

    // 状态效果行(正面绿 / 负面红 / 中性灰;后面是剩余时间,永久状态显示「永久」)
    const statusLine = this.composeStatusLine(player.id);
    if (statusLine) {
      parts.push({ text: "\n" });
      parts.push({ text: statusLine });
    }

    return hudMessage(parts);
  }

  /**
   * 状态效果行,形如:§a电流涌动§7[5s] §7| §c零火§7[8s]
   * - 颜色按状态定义 kind:正面 §a / 负面 §c / 中性 §7;
   * - 剩余时间按 tick 换算为向上取整的秒数(状态每 5 tick 结算一次);
   * - 叠层状态(浊露 32 层等)在名字后追加 ×N,避免只显示层数而看不到名称。
   */
  private composeStatusLine(playerId: string): string | undefined {
    const entries = this.session.status.getAll(playerId);
    if (entries.length === 0) return undefined;

    return entries
      .map((instance) => ({
        instance,
        def: this.session.content.statuses.get(instance.id),
      }))
      .sort((a, b) => {
        const kindA = STATUS_KIND_ORDER[a.def?.kind ?? "neutral"];
        const kindB = STATUS_KIND_ORDER[b.def?.kind ?? "neutral"];
        if (kindA !== kindB) return kindA - kindB;
        return b.instance.remainingTicks - a.instance.remainingTicks;
      })
      .map(({ instance, def }) => {
        const color =
          def?.kind === "buff" ? "§a" : def?.kind === "debuff" ? "§c" : "§7";
        const name = def?.displayName ?? instance.id;
        const stackText = instance.stacks > 1 ? `×${instance.stacks}` : "";
        const timeText =
          def && def.durationTicks < 0
            ? "永久"
            : `${Math.ceil(Math.max(0, instance.remainingTicks) / 20)}s`;
        return `${color}${name}${stackText}§7[${timeText}]`;
      })
      .join("§7 | ");
  }
}
