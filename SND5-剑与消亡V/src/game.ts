// ============================================================
// SND5 游戏装配层
// MinigameHooks 接线(引擎层契约,见 development.md §3/§4)+
// 会话注入实现:队伍/职业装载/套装发放/武器结算路由。
// 内容层经 src/content 统一入口 import 即注册。
// ============================================================
import { ItemStack, system, type Player } from "@minecraft/server";
import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { clearHudTitle } from "../../shared/minigame-core/scoreboardHud";
import { clearAllPlayerItems } from "../../shared/minigame-core/playerItems";
import {
  MatchSession,
  sessions,
  skillRegistry,
  statusRegistry,
  type CapturePointDef,
  type ScoreRuleDef,
  type SessionInjects,
  type Snd5ContentBundle,
  type Snd5RuntimeConfig,
  type SupplyStationDef,
  type TeamId,
  type TeamProvider,
} from "./framework";
import {
  getSelectedProfessionId,
  professionRegistry,
  type ProfessionDefinition,
} from "./content";
import { loadSnd5Config } from "./runtime-config";
import { START_POSITIONS } from "./config";

// ── 默认队伍提供器 ────

const TEAM_IDS: readonly TeamId[] = ["red", "blue"];

class DefaultTeamProvider implements TeamProvider {
  private readonly assignment = new Map<string, TeamId>();

  readonly teamIds = TEAM_IDS;

  assignAll(players: Player[]): void {
    this.assignment.clear();
    const shuffled = [...players];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    shuffled.forEach((player, index) => {
      this.assignment.set(player.id, index % 2 === 0 ? "red" : "blue");
    });
  }

  getTeam(playerId: string): TeamId | undefined {
    return this.assignment.get(playerId);
  }

  teamDisplayName(teamId: TeamId): string {
    return teamId === "red" ? "§c红队" : teamId === "blue" ? "§9蓝队" : "§7中立";
  }
}

// ── 职业解析(准备阶段选择 → 开局装载) ─────────────────────────

/** 已选职业;未选/失效兜底默认战士 */
function resolveProfession(playerId: string): ProfessionDefinition {
  const selectedId = getSelectedProfessionId(playerId);
  const selected = selectedId ? professionRegistry.get(selectedId) : undefined;
  if (selected?.available) return selected;
  return professionRegistry.require("snd5:warrior");
}

/** 开局发放职业套装(占位物品):清背包 → 武器/技能物品 → 命名牌前缀 */
function grantProfessionKit(player: Player, prof: ProfessionDefinition): void {
  const container = player.getComponent("minecraft:inventory")?.container;
  if (!container) return;
  try {
    const weapon = new ItemStack(prof.weapon.itemTypeId, 1);
    weapon.nameTag = prof.weapon.name;
    if (prof.weapon.lore.length > 0) weapon.setLore(prof.weapon.lore);
    container.setItem(0, weapon);
    prof.skills.forEach((entry, index) => {
      const skillDef = skillRegistry.get(entry.skillId);
      const item = new ItemStack(entry.itemTypeId, 1);
      item.nameTag = `§e${skillDef?.displayName ?? entry.slot}§r`;
      const slotLabel = entry.slot === "innate_1" ? "固有Ⅰ" : "固有Ⅱ";
      item.setLore([`§7${slotLabel} · 右键施放`]);
      container.setItem(index + 1, item);
    });
    player.nameTag = `§6[${prof.displayName}]§r ${player.name}`;
    player.onScreenDisplay.setActionBar(`§a你已化身 ${prof.displayName}!`);
  } catch (error) {
    console.warn("[SND5] 职业套装发放失败", error);
  }
}

// ── 内容注册束(占点/补给/计分规则待场地建好后填入) ──────────────

function buildContentBundle(): Snd5ContentBundle {
  return {
    skills: skillRegistry,
    statuses: statusRegistry,
    // TODO(内容层): 计分规则表(意见⑦,战地/战争领主风格),示例:
    // scoreRules: [
    //   { id: "snd5:kill", event: "entity.killed", amount: 100, actorField: "killerId" },
    //   { id: "snd5:capture", event: "point.captured", amount: 200, actorField: "teamId" },
    // ],
    scoreRules: [] as ScoreRuleDef[],
    // TODO(内容层): 占点区域(场地建好后填坐标),示例:
    // capturePoints: [{ id: "snd5:point_a", displayName: "A", from: {...}, to: {...} }],
    capturePoints: [] as CapturePointDef[],
    // TODO(内容层): 补给站(模板场地内 7 个:5 内圈 + 2 外围)
    supplyStations: [] as SupplyStationDef[],
  };
}

// ── 会话注入

interface Snd5Injects extends SessionInjects {
  assignTeams(players: Player[]): void;
}

function buildInjects(_runtime: MinigameRuntime, roomId: number): Snd5Injects {
  const teamProvider = new DefaultTeamProvider();
  return {
    teams: teamProvider,
    assignTeams: (players) => teamProvider.assignAll(players),
    // 重生点:暂用开局站位(场地建好后改为队伍出生点/部署点)
    getRespawnLocation: (playerId) => {
      const teamId = teamProvider.getTeam(playerId) ?? "red";
      const index = teamId === "blue" ? 1 : 0;
      return START_POSITIONS[index] ?? START_POSITIONS[0];
    },

    // 职业装载:面板 + 技能装备 + 被动挂载(会话 applyLoadout 消费)
    loadoutFor: (playerId) => {
      const prof = resolveProfession(playerId);
      return {
        professionId: prof.id,
        base: prof.base,
        skills: Object.fromEntries(prof.skills.map((entry) => [entry.slot, entry.skillId])),
        passiveIds: prof.passiveIds,
      };
    },

    // 会话开始:清背包(含山羊角)→ 按职业发放套装
    onSessionStart: (session) => {
      for (const state of session.players.values()) {
        const player = state.player;
        if (!player.isValid) continue;
        clearAllPlayerItems(player);
        const prof = professionRegistry.get(state.professionId ?? "");
        if (!prof) continue;
        grantProfessionKit(player, prof);
      }
      session.announce("§7提示: 潜行+攻击为重击;准备阶段右键山羊角选择职业");
    },

    // 重生:全量重发套装(架构 §6.3「复活时同样全量重发」)
    onPlayerRespawn: (playerId) => {
      const state = sessions.get(roomId)?.players.get(playerId);
      if (!state?.player.isValid) return;
      const prof =
        professionRegistry.get(state.professionId ?? "") ?? resolveProfession(playerId);
      clearAllPlayerItems(state.player);
      grantProfessionKit(state.player, prof);
    },

    // 近战武器结算 → 按职业路由(轻击/重击数值由职业定义计算)
    weaponAttack: (session, attackerId, victimId, isSneaking) => {
      const attacker = session.players.get(attackerId);
      if (!attacker) return;
      const prof = professionRegistry.get(attacker.professionId ?? "");
      prof?.handleAttack?.(session, attackerId, victimId, isSneaking);
    },

    // HUD 职业名
    professionNameOf: (professionId) => professionRegistry.get(professionId)?.displayName,
  };
}

// ── 会话 tick(由 listeners.ts 的单一 interval 驱动) ─────────────

export function tickSnd5Sessions(getRuntime: () => MinigameRuntime): void {
  for (const [roomId, session] of [...sessions]) {
    try {
      if (!getRuntime().isRunning(roomId)) {
        session.dispose();
        sessions.delete(roomId);
        continue;
      }
      session.tick(system.currentTick);
    } catch (error) {
      console.warn(`[SND5] 房间 ${roomId} tick 异常`, error);
    }
  }
}

// ── MinigameHooks 装配 ────────────────────────────────────────

export function makeSnd5Hooks(getRuntime: () => MinigameRuntime): MinigameHooks {
  return {
    onGameStart(roomId, players) {
      const runtime = getRuntime();
      const config: Snd5RuntimeConfig = loadSnd5Config();
      const injects = buildInjects(runtime, roomId);
      // 队伍分配必须在会话读取 getTeam 之前完成
      injects.assignTeams(players);
      const session = new MatchSession(runtime, roomId, injects, config, buildContentBundle());
      sessions.set(roomId, session);
      try {
        session.start(players);
      } catch (error) {
        console.warn(`[SND5] 房间 ${roomId} 会话启动异常`, error);
        session.dispose();
        sessions.delete(roomId);
      }
    },

    onBeforeReset(roomId) {
      // 引擎层会重建场地;会话与 HUD 在此全量回收
      const session = sessions.get(roomId);
      if (!session) return;
      for (const state of session.players.values()) {
        if (state.player.isValid) clearHudTitle(state.player);
      }
      session.dispose();
      sessions.delete(roomId);
    },

    onRoomReset() {
      // 场地已从模板重建(补给站/占点标记随之恢复),无需额外处理
    },

    // 场地保护:玩家不可放置/破坏;创生物写入由脚本完成不走此钩子
    canPlace: () => false,
    canBreak: () => false,

    // TODO(对局层): openConfig —— /bearcade:config snd5 的热调参界面
    //   (scoreTarget/respawnSeconds 等,复用 shared configUi 编辑器)
  };
}
