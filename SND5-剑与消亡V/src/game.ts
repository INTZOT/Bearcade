// ============================================================
// SND5 游戏装配层
// MinigameHooks 接线(引擎层契约,见 development.md §3/§4)+
// 默认队伍/重生点注入 + 内容注册束组装。
//
// 内容层(content/)当前为空骨架:职业/技能/状态定义就绪后,
// 在 buildContentBundle() 里换入真实注册表与数据即可,
// 框架层不需要任何改动(意见①②③的验收标准)。
// ============================================================
import { system, type Player } from "@minecraft/server";
import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { clearHudTitle } from "../../shared/minigame-core/scoreboardHud";
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
import { loadSnd5Config } from "./runtime-config";
import { START_POSITIONS } from "./config";

// ── 默认队伍提供器(内容层就绪后替换为职业队伍逻辑) ──────────────

const TEAM_IDS: readonly TeamId[] = ["red", "blue"];

class DefaultTeamProvider implements TeamProvider {
  private readonly assignment = new Map<string, TeamId>();

  readonly teamIds = TEAM_IDS;

  /** 对局开始前均衡分配(洗牌对半分;BridgeWar assignTeams 先例) */
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

// ── 内容注册束(内容层就绪后在此换入真实数据) ────────────────────

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

// ── 会话注入(默认实现;内容层就绪后替换) ────────────────────────

interface Snd5Injects extends SessionInjects {
  assignTeams(players: Player[]): void;
}

function buildInjects(_runtime: MinigameRuntime, _roomId: number): Snd5Injects {
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
    // TODO(内容层): 职业装载(loadoutFor)+ 武器结算(weaponAttack)+
    //   职业选择 UI(准备阶段)。未提供时使用默认面板(100/50/100)。
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
