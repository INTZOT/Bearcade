// ============================================================
// MatchSession —— 会话聚合根(Bearcade 适配的核心新增,§A)
// 架构文档的全局单例 Store 改为「每房间一个会话」:
// - 多房间并发(ROOM_COUNT 个维度同时跑对局),会话天然隔离;
// - 会话持有三地基(Attribute/Status/Combat)+ 调度中枢(Skill)
//   + 专用执行器(Summon/Score/Capture/Supply/HUD);
// - 生命周期严格对齐 MinigameRuntime:onGameStart 创建,
//   onBeforeReset/dispose 销毁(事件订阅/定时器/创生物全量回收);
// - 对局状态纯内存,断线即退出(无热重连)。
// ============================================================
import { GameMode, system, type Dimension, type Player } from "@minecraft/server";
import type { MinigameRuntime } from "../../../shared/minigame-core/runtime";
import { clearHudTitle } from "../../../shared/minigame-core/scoreboardHud";
import { AttributeSystem, type AttributeSnapshot } from "./attribute";
import { CaptureSystem } from "./capture";
import { CombatPipeline } from "./combat/pipeline";
import { EventBus, extractInvolvedIds } from "./events";
import { HudBridge } from "./hud";
import { CaptureVisualizer } from "./captureVisual";
import { PassiveManager } from "./skill/passives";
import { Primitives } from "./skill/primitives";
import { SkillSystem } from "./skill/system";
import { ScoreSystem } from "./score";
import { StatusEffectSystem, STATUS_TICK_INTERVAL } from "./status/system";
import { SummonSystem } from "./summon";
import { SupplySystem } from "./supply";
import { DEFAULT_BASE, type Snd5RuntimeConfig, type SessionInjects, type Snd5ContentBundle, type TeamId } from "./types";

/** 无队伍时的兜底(队伍由内容层在对局开始前分配) */
const NEUTRAL_TEAM: TeamId = "neutral";

export interface PlayerState {
  id: string;
  name: string;
  player: Player;
  teamId: TeamId;
  alive: boolean;
  professionId?: string;
  /** 死亡后的重生 tick(alive=false 时有效) */
  respawnAtTick?: number;
}

interface SessionTimer {
  atTick: number;
  callback: (run: number) => void;
  intervalTicks?: number;
  remainingRuns?: number;
  cancelled?: boolean;
}

export class MatchSession {
  readonly roomId: number;
  readonly dimension: Dimension;
  readonly config: Snd5RuntimeConfig;
  readonly injects: SessionInjects;
  readonly content: Snd5ContentBundle;
  readonly bus = new EventBus();
  readonly players = new Map<string, PlayerState>();
  readonly primitives: Primitives;
  readonly attributes: AttributeSystem;
  readonly status: StatusEffectSystem;
  readonly combat: CombatPipeline;
  readonly skills: SkillSystem;
  readonly passives: PassiveManager;
  readonly summons: SummonSystem;
  readonly score: ScoreSystem;
  readonly capture: CaptureSystem;
  readonly captureVisual: CaptureVisualizer;
  readonly supply: SupplySystem;
  readonly hud: HudBridge;

  private readonly runtime: MinigameRuntime;
  private readonly timers: SessionTimer[] = [];
  private readonly busOffs: Array<() => void> = [];
  private startedAtTick = 0;
  private ended = false;

  constructor(
    runtime: MinigameRuntime,
    roomId: number,
    injects: SessionInjects,
    config: Snd5RuntimeConfig,
    content: Snd5ContentBundle,
  ) {
    this.runtime = runtime;
    this.roomId = roomId;
    this.injects = injects;
    this.config = config;
    this.content = content;
    const dimension = runtime.roomDim(roomId);
    if (!dimension) throw new Error(`[SND5] 房间维度不存在: ${roomId}`);
    this.dimension = dimension;

    // 三地基 → 调度中枢 → 专用执行器(依赖方向单向,反向走事件总线)
    this.primitives = new Primitives(this);
    this.attributes = new AttributeSystem(this);
    this.status = new StatusEffectSystem(this, content.statuses);
    this.combat = new CombatPipeline(this);
    this.passives = new PassiveManager(this);
    this.skills = new SkillSystem(this);
    this.summons = new SummonSystem(this);
    this.score = new ScoreSystem(this);
    this.capture = new CaptureSystem(this, content.capturePoints ?? []);
    this.captureVisual = new CaptureVisualizer(this);
    this.supply = new SupplySystem(this, content.supplyStations ?? []);
    this.hud = new HudBridge(this);

    // 事件总线 → 状态进化检查(电流涌动→进发、水仙初临→伴生)
    this.busOffs.push(
      this.bus.onAny((name, payload) => {
        this.status.handleEventForEvolve(name, extractInvolvedIds(payload));
      }),
    );
  }

  // ── 门面 ─────────────────────────────────────────────────────

  get teams() {
    return this.injects.teams;
  }

  nowTick(): number {
    return system.currentTick;
  }

  isDead(playerId: string): boolean {
    return this.players.get(playerId)?.alive === false;
  }

  getPlayerState(playerId: string): PlayerState | undefined {
    return this.players.get(playerId);
  }

  announce(message: string): void {
    this.runtime.announce(this.roomId, message);
  }

  // ── 调度(原语 schedule 的落点;会话销毁自动取消) ───────────────

  schedule(delayTicks: number, callback: () => void): void {
    this.timers.push({
      atTick: system.currentTick + Math.max(0, delayTicks),
      callback,
    });
  }

  scheduleRepeating(intervalTicks: number, times: number, callback: (run: number) => void): void {
    this.timers.push({
      atTick: system.currentTick + Math.max(1, intervalTicks),
      callback,
      intervalTicks: Math.max(1, intervalTicks),
      remainingRuns: Math.max(1, times),
    });
  }

  // ── 生命周期 ─────────────────────────────────────────────────

  start(players: Player[]): void {
    this.startedAtTick = system.currentTick;
    for (const player of players) {
      const teamId = this.injects.teams.getTeam(player.id) ?? NEUTRAL_TEAM;
      this.players.set(player.id, {
        id: player.id,
        name: player.name,
        player,
        teamId,
        alive: true,
      });
    }
    for (const state of this.players.values()) {
      // 首次落位到重生点;装载(面板/技能/被动)统一在 applyLoadout
      this.runtime.teleportPlayer(this.roomId, state.player, this.injects.getRespawnLocation(state.id));
      this.applyLoadout(state);
    }
    this.injects.onSessionStart?.(this);
    this.bus.emit("match.start", { playerIds: [...this.players.keys()] });
    this.captureVisual.start(); // 占点浮空字 + 粒子环
    this.hud.renderAll();
  }

  /** 会话周期推进;由游戏层单一 interval 驱动(5 tick) */
  tick(nowTick: number): void {
    if (this.ended) return;

    this.syncPlayers();

    // 重生队列
    for (const state of [...this.players.values()]) {
      if (!state.alive && state.respawnAtTick !== undefined && nowTick >= state.respawnAtTick) {
        this.respawn(state.id);
      }
    }

    this.runTimers(nowTick);
    this.status.tick(nowTick);
    this.attributes.tick(nowTick);
    this.skills.tick(nowTick);
    this.summons.tick(nowTick);
    this.capture.tick(nowTick, STATUS_TICK_INTERVAL);
    this.score.tick(nowTick); // 占点产分(内部按秒结算)

    // 对局计时兜底:到点比总分,平分平局
    if (this.config.matchSeconds > 0 && nowTick - this.startedAtTick >= this.config.matchSeconds * 20) {
      const { leader, tie } = this.score.standings();
      this.endMatch(
        tie ? undefined : leader,
        tie ? "match_timeout_draw" : "match_timeout",
      );
      return;
    }

    this.captureVisual.tick(nowTick);
    this.hud.tick(nowTick);
  }

  /**
   * 脚本死亡(CombatPipeline 致死判定后调用):
   * 清全部状态(含不可清除)→ 旁观 → 定时重生。
   * 物品掉落/战绩等由内容层经 onPlayerDeath / player.death 事件处理。
   */
  handleDeath(playerId: string, killerId?: string, cause = "damage"): void {
    const state = this.players.get(playerId);
    if (!state || !state.alive || this.ended) return;
    state.alive = false;
    state.respawnAtTick = system.currentTick + this.config.respawnSeconds * 20;

    this.status.clearAll(playerId, false);
    this.skills.interruptCast(playerId, "死亡");
    try {
      state.player.setGameMode(GameMode.Spectator);
    } catch {
      // 玩家可能已离开
    }
    this.hud.toast(state.player, `§c你被击败了,${this.config.respawnSeconds} 秒后重生`);
    this.injects.onPlayerDeath?.(playerId, killerId);
    this.bus.emit("player.death", { playerId, killerId, cause });
  }

  /** 重生:清状态(防御)→ 面板归满 → 生存模式 → 落位部署点/重生点;物品重发由内容层完成 */
  respawn(playerId: string): void {
    const state = this.players.get(playerId);
    if (!state || state.alive || this.ended) return;
    if (!state.player.isValid) {
      this.removePlayer(playerId);
      return;
    }
    state.alive = true;
    state.respawnAtTick = undefined;
    // 防御:死亡窗口内仍可能有延迟回调/反应给尸体挂状态
    // (handleDeath 已清过一次,这里兜底保证重生净身)
    this.status.clearAll(playerId, false);
    this.applyLoadout(state);
    try {
      state.player.setGameMode(GameMode.Survival);
      // 部署点优先(秘典信标:本队、限用次数由 summon 消耗),无则回默认重生点
      const deployLocation = this.summons.consumeDeployPoint(state.teamId);
      this.runtime.teleportPlayer(
        this.roomId,
        state.player,
        deployLocation ?? this.injects.getRespawnLocation(playerId),
      );
    } catch {
      // 忽略
    }
    this.injects.onPlayerRespawn?.(playerId);
    this.bus.emit("player.respawn", { playerId });
  }

  endMatch(winnerTeamId?: TeamId, reason = "match_end"): void {
    if (this.ended) return;
    this.ended = true;
    this.bus.emit("match.end", { winnerTeamId, reason });
    const winnerName = winnerTeamId ? this.injects.teams.teamDisplayName(winnerTeamId) : undefined;
    this.runtime.announce(
      this.roomId,
      winnerName ? `§6${winnerName}§r 获胜!` : "§7平局",
    );
    for (const state of this.players.values()) {
      clearHudTitle(state.player);
    }
    // 唯一的结束出口:runtime 状态机 → 结算回大厅 → 整房模板重建
    this.runtime.endGame(this.roomId, reason, winnerName ? `${winnerName} 获胜` : "平局");
  }

  removePlayer(playerId: string): void {
    const state = this.players.get(playerId);
    if (!state) return;
    this.status.clearAll(playerId, false);
    this.attributes.remove(playerId);
    this.skills.detachPlayer(playerId);
    this.players.delete(playerId);
    this.bus.emit("player.left", { playerId });
  }

  dispose(): void {
    if (this.ended) return;
    this.ended = true;
    for (const off of this.busOffs) off();
    this.busOffs.length = 0;
    for (const timer of this.timers) timer.cancelled = true;
    this.timers.length = 0;
    this.skills.dispose();
    this.passives.dispose();
    this.summons.clearAll();
    this.status.dispose();
    this.combat.dispose();
    this.score.dispose();
    this.capture.dispose();
    this.captureVisual.dispose();
    this.supply.dispose();
    this.hud.dispose();
    for (const state of this.players.values()) {
      if (state.player.isValid) clearHudTitle(state.player);
    }
    this.attributes.dispose();
    this.players.clear();
    this.bus.clear();
  }

  // ── 内部 ─────────────────────────────────────────────────────

  /** 写入职业面板 → 装备技能 → 挂载被动;物品发放由内容层钩子完成 */
  private applyLoadout(state: PlayerState): void {
    const loadout = this.injects.loadoutFor?.(state.id);
    const base = loadout?.base ?? DEFAULT_BASE;
    this.attributes.init(state.id, base);
    if (loadout?.professionId) state.professionId = loadout.professionId;
    if (loadout?.skills) {
      for (const [slot, skillId] of Object.entries(loadout.skills)) {
        this.skills.equip(state.id, slot, skillId);
      }
    }
    if (loadout?.passiveIds?.length) {
      const passiveDefs = loadout.passiveIds
        .map((id) => this.content.skills.get(id))
        .filter((def): def is NonNullable<typeof def> => def !== undefined);
      this.skills.attachPassives(state.id, passiveDefs);
    }
  }

  /** 每周期比对房间人数,清理离场玩家(TerritoryWar syncPlayers 模式) */
  private syncPlayers(): void {
    const current = new Set(this.runtime.roomPlayers(this.roomId).map((player) => player.id));
    for (const playerId of [...this.players.keys()]) {
      if (!current.has(playerId)) this.removePlayer(playerId);
    }
  }

  private runTimers(nowTick: number): void {
    for (const timer of this.timers) {
      if (timer.cancelled || nowTick < timer.atTick) continue;
      try {
        timer.callback(timer.remainingRuns ?? 1);
      } catch (error) {
        console.warn("[SND5] 会话定时器异常", error);
      }
      if (timer.intervalTicks) {
        const remaining = (timer.remainingRuns ?? 1) - 1;
        if (remaining > 0) {
          timer.remainingRuns = remaining;
          timer.atTick = nowTick + timer.intervalTicks;
          continue;
        }
      }
      timer.cancelled = true;
    }
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.timers[i].cancelled) this.timers.splice(i, 1);
    }
  }
}

/** 会话注册表:多房间并发,键为 roomId */
export const sessions = new Map<number, MatchSession>();

/** 快照类型再导出(内容层时间回溯用) */
export type { AttributeSnapshot };
