import {
  DisplaySlotId,
  GameMode,
  ItemStack,
  ObjectiveSortOrder,
  system,
  world,
  type Entity,
  type Player,
} from "@minecraft/server";
import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { clearAllPlayerItems } from "../../shared/minigame-core/playerItems";
import { getPigConfig, openPigConfig } from "./pigcatcher-config";
import {
  TEAMS,
  TEAM_COLORS,
  TEAM_NAMES,
  type Region,
  type Team,
} from "./config";

interface Session {
  teams: Record<Team, string[]>;
  startTick: number;
  lastRefillTick: number;
  finished: boolean;
}

const sessions = new Map<number, Session>();
// roomId -> (hookId -> 最近猪 id(上一轮)),用于鱼钩解拴的连续一致性判定;
// 按房间隔离:某房间无鱼钩时只清本房间状态,不影响其他房间正在积累的一致性
const hookTargets = new Map<number, Map<string, string>>();

function objectiveId(roomId: number): string {
  return `bearcade:pc_score_${roomId}`;
}

function teamOf(session: Session, playerId: string): Team | undefined {
  for (const team of TEAMS) {
    if (session.teams[team].includes(playerId)) return team;
  }
  return undefined;
}

function setTeamName(player: Player, team?: Team): void {
  if (team) {
    player.nameTag = `${TEAM_COLORS[team]}${player.name}§r`;
    player.chatNamePrefix = TEAM_COLORS[team];
    player.chatNameSuffix = "§r";
  } else {
    player.nameTag = player.name;
    player.chatNamePrefix = undefined;
    player.chatNameSuffix = undefined;
  }
}

function playerName(
  runtime: MinigameRuntime,
  roomId: number,
  playerId: string,
): string {
  return (
    runtime.roomPlayers(roomId).find((p) => p.id === playerId)?.name ??
    playerId
  );
}

function distance(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function isInside(
  region: Region,
  location: { x: number; y: number; z: number },
): boolean {
  const x = Math.floor(location.x);
  const y = Math.floor(location.y);
  const z = Math.floor(location.z);
  return (
    x >= region.from.x &&
    x <= region.to.x &&
    y >= region.from.y &&
    y <= region.to.y &&
    z >= region.from.z &&
    z <= region.to.z
  );
}

function assignTeams(players: Player[]): Record<Team, string[]> {
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  const teams: Record<Team, string[]> = {
    red: [],
    yellow: [],
    blue: [],
    green: [],
  };
  shuffled.forEach((player, index) => {
    teams[TEAMS[index % TEAMS.length]].push(player.id);
  });
  return teams;
}

function giveTools(player: Player): void {
  const inventory = player.getComponent("minecraft:inventory");
  const container = inventory?.container;
  if (!container) return;
  try {
    container.addItem(new ItemStack("minecraft:fishing_rod", 1));
    container.addItem(new ItemStack("minecraft:carrot_on_a_stick", 1));
    container.addItem(new ItemStack("minecraft:lead", 3));
  } catch (error) {
    console.warn("[Bearcade pigcatcher] 发放道具失败", error);
  }
}

/** 清空玩家全套物品(背包/盔甲/副手),统一走共享实现 */
function clearPlayerItems(player: Player): void {
  clearAllPlayerItems(player);
}

function pigsInRoom(runtime: MinigameRuntime, roomId: number): Entity[] {
  try {
    return runtime.roomDim(roomId).getEntities({ type: "minecraft:pig" });
  } catch {
    return [];
  }
}

function spawnPig(runtime: MinigameRuntime, roomId: number): void {
  const center = getPigConfig().pigSpawn;
  const offset = () => (Math.random() - 0.5) * 6;
  try {
    runtime.roomDim(roomId).spawnEntity("minecraft:pig", {
      x: center.x + 0.5 + offset(),
      y: center.y + 1,
      z: center.z + 0.5 + offset(),
    });
  } catch (error) {
    console.warn(`[Bearcade pigcatcher] 刷猪失败 room=${roomId}`, error);
  }
}

function clearPigs(runtime: MinigameRuntime, roomId: number): void {
  for (const pig of pigsInRoom(runtime, roomId)) {
    try {
      pig.remove();
    } catch (error) {
      console.warn("[Bearcade pigcatcher] 清理猪失败", error);
    }
  }
}

/** 猪被拴绳拴住时跳过边界回拉,避免与玩家拉扯 */
function isLeashed(pig: Entity): boolean {
  try {
    const leashable = pig.getComponent("minecraft:leashable");
    return leashable?.leashHolder !== undefined;
  } catch {
    return false;
  }
}

function applyPull(
  pig: Entity,
  target: { x: number; y: number; z: number },
  strength: number,
): void {
  const dx = target.x - pig.location.x;
  const dy = target.y - pig.location.y;
  const dz = target.z - pig.location.z;
  const horizontal = Math.sqrt(dx * dx + dz * dz);
  if (horizontal < 0.3) return;
  const scale = Math.min(1, horizontal / 4);
  try {
    pig.applyImpulse({
      x: (dx / horizontal) * strength * scale,
      y: 0.25,
      z: (dz / horizontal) * strength * scale,
    });
  } catch {
    // 实体可能已被移除
  }
}

function ensureObjective(roomId: number): void {
  const id = objectiveId(roomId);
  const existing = world.scoreboard.getObjective(id);
  if (existing) world.scoreboard.removeObjective(id);
  const objective = world.scoreboard.addObjective(id, "猪猪争夺战 · 实时猪数");
  world.scoreboard.setObjectiveAtDisplaySlot(DisplaySlotId.Sidebar, {
    objective,
    sortOrder: ObjectiveSortOrder.Descending,
  });
}

function refreshScoreboard(
  roomId: number,
  counts: Record<Team, number>,
): void {
  const objective = world.scoreboard.getObjective(objectiveId(roomId));
  if (!objective) return;
  for (const team of TEAMS) {
    objective.setScore(TEAM_NAMES[team], counts[team]);
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function updateActionbars(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
  counts: Record<Team, number>,
): void {
  const cfg = getPigConfig();
  const remain = Math.max(
    0,
    Math.ceil(
      (cfg.gameDurationTicks - (system.currentTick - session.startTick)) /
        20,
    ),
  );
  for (const player of runtime.roomPlayers(roomId)) {
    const team = teamOf(session, player.id);
    if (!team) continue;
    player.onScreenDisplay.setActionBar(
      `${TEAM_COLORS[team]}${TEAM_NAMES[team]}§r · ${formatTime(remain)} · ` +
        `红${counts.red} 黄${counts.yellow} 蓝${counts.blue} 绿${counts.green}`,
    );
  }
}

function finishGame(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
  counts: Record<Team, number>,
): void {
  const max = Math.max(...TEAMS.map((t) => counts[t]));
  const winners = TEAMS.filter((t) => counts[t] === max);
  const summary = TEAMS.map(
    (t) => `${TEAM_COLORS[t]}${TEAM_NAMES[t]} ${counts[t]} 只§r`,
  ).join(" · ");
  let message: string;
  if (max <= 0) {
    message = `§e时间到!${summary}\n§7没有队伍捕获猪猪,平局结束`;
  } else if (winners.length === 1) {
    message = `§e时间到!${summary}\n${TEAM_COLORS[winners[0]]}${TEAM_NAMES[winners[0]]} 获胜!§r`;
  } else {
    const winnerText = winners
      .map((t) => `${TEAM_COLORS[t]}${TEAM_NAMES[t]}§r`)
      .join("、");
    message = `§e时间到!${summary}\n${winnerText} 并列获胜!`;
  }
  runtime.endGame(roomId, "时间到", message);
}

export function makePigCatcherHooks(
  getRuntime: () => MinigameRuntime,
): MinigameHooks {
  return {
    onGameStart(roomId, players) {
      const runtime = getRuntime();
      const cfg = getPigConfig();
      const session: Session = {
        teams: assignTeams(players),
        startTick: system.currentTick,
        lastRefillTick: system.currentTick,
        finished: false,
      };
      sessions.set(roomId, session);
      ensureObjective(roomId);
      refreshScoreboard(roomId, { red: 0, yellow: 0, blue: 0, green: 0 });

      for (const player of players) {
        const team = teamOf(session, player.id);
        if (!team) continue;
        const spawn = cfg.teamSpawns[team];
        player.setGameMode(GameMode.Survival);
        runtime.teleportPlayer(roomId, player, spawn);
        player.setSpawnPoint({
          dimension: runtime.roomDim(roomId),
          x: spawn.x,
          y: spawn.y,
          z: spawn.z,
        });
        giveTools(player);
        setTeamName(player, team);
      }
      for (let i = 0; i < cfg.pigInitialCount; i++) spawnPig(runtime, roomId);

      const teamLine = TEAMS.map((t) => {
        const names = session.teams[t]
          .map((id) => playerName(runtime, roomId, id))
          .join("、");
        return names ? `${TEAM_COLORS[t]}${TEAM_NAMES[t]}:${names}§r` : null;
      })
        .filter(Boolean)
        .join(" / ");
      const minutes = Math.round(cfg.gameDurationTicks / 20 / 60);
      runtime.announce(
        roomId,
        `§a猪猪争夺战开始!§r\n${teamLine}\n把场地中央的中立猪赶进自家核心区:胡萝卜钓竿引诱、钓鱼竿钩拽、拴绳拖走;${minutes} 分钟后按核心区猪数结算,平局并列。`,
      );
    },
    onBeforeReset(roomId) {
      const runtime = getRuntime();
      clearPigs(runtime, roomId);
      for (const player of runtime.roomPlayers(roomId)) {
        clearPlayerItems(player);
        player.setGameMode(GameMode.Adventure);
        setTeamName(player);
        // 重置对局内设置的队伍出生点重生点,结束后回默认(大厅)
        try {
          player.setSpawnPoint(undefined);
        } catch {
          // 忽略,不影响重置流程
        }
      }
      sessions.delete(roomId);
      try {
        world.scoreboard.removeObjective(objectiveId(roomId));
      } catch {
        // 目标可能已不存在
      }
      try {
        world.scoreboard.clearObjectiveAtDisplaySlot(DisplaySlotId.Sidebar);
      } catch {
        // 无侧边栏目标时忽略
      }
    },
    openConfig(player) {
      openPigConfig(player, getRuntime());
    },
  };
}

export function initPigCatcher(getRuntime: () => MinigameRuntime): void {
  // 死亡复活:回本队出生点、补道具、恢复队伍名
  world.afterEvents.playerSpawn.subscribe((event) => {
    const runtime = getRuntime();
    const roomId = runtime.roomIdFromDimension(event.player.dimension.id);
    if (roomId === undefined) return;
    const session = sessions.get(roomId);
    if (!session || session.finished) return;
    const team = teamOf(session, event.player.id);
    if (!team) return;
    const player = event.player;
    const spawn = getPigConfig().teamSpawns[team];
    player.setGameMode(GameMode.Survival);
    runtime.teleportPlayer(roomId, player, spawn);
    player.setSpawnPoint({
      dimension: runtime.roomDim(roomId),
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
    });
    giveTools(player);
    setTeamName(player, team);
  });

  // 伤害控制:猪无敌 + 同队免伤(仅本游戏房间维度生效,不影响其他维度/其他游戏)
  world.beforeEvents.entityHurt.subscribe((event) => {
    const victim = event.hurtEntity;
    const runtime = getRuntime();
    if (victim.typeId === "minecraft:pig") {
      const roomId = runtime.roomIdFromDimension(victim.dimension.id);
      // 正式逻辑:仅房间维度生效;调试模式(debug enable)下放宽到任意维度,
      // 便于在大厅直接验证解拴逻辑,测试完 disable 即恢复
      if (roomId === undefined && !runtime.isDebug()) return;
      // 鱼钩勾中(实测:0 伤害投射命中,damage=0、cause=projectile、归属投掷者玩家):
      // entityHitEntity 对鱼钩不派发,此事件是唯一可靠的"勾中"信号,且触发先于本处的
      // 无敌 cancel,故在此抢在 cancel 前解拴。事件回调为受限上下文,unleash 延迟到
      // system.run;用"邻近鱼钩实体"二次确认,避免雪球/箭等投射物误解拴。
      const source = event.damageSource;
      if (event.damage === 0 && source?.cause === "projectile") {
        const nearbyHook = victim.dimension
          .getEntities({
            type: "minecraft:fishing_hook",
            location: victim.location,
            maxDistance: 1.5,
            closest: 1,
          })[0];
        if (nearbyHook) {
          system.run(() => {
            try {
              if (!victim.isValid) return;
              const leashable = victim.getComponent("minecraft:leashable");
              if (leashable?.isLeashed) {
                leashable.unleash();
                runtime.dbg(`猪 ${victim.id} 被鱼钩勾中,已解除拴绳`);
              }
            } catch (error) {
              console.warn("[Bearcade pigcatcher] 解除拴绳失败", error);
            }
          });
        }
      }
      event.cancel = true; // 猪无敌:取消全部伤害(含 0 伤害命中;按需求不恢复原版拉扯)
      return;
    }
    const attacker = event.damageSource?.damagingEntity;
    if (
      !attacker ||
      attacker.typeId !== "minecraft:player" ||
      victim.typeId !== "minecraft:player"
    ) {
      return;
    }
    const roomId = runtime.roomIdFromDimension(victim.dimension.id);
    if (roomId === undefined) return;
    const session = sessions.get(roomId);
    if (!session || session.finished) return;
    const victimTeam = teamOf(session, victim.id);
    const attackerTeam = teamOf(session, attacker.id);
    if (victimTeam && victimTeam === attackerTeam) {
      event.cancel = true;
    }
  });

  // (entityHitEntity 对鱼钩勾中不派发——实测仅 entityHurt 触发,解拴已上移至
  //  entityHurt 处理器抢在无敌 cancel 前执行;此处不再订阅)

  // 对局主循环:刷猪、归属判定、边界回拉、牵引、计分、计时结算
  system.runInterval(() => {
    const runtime = getRuntime();
    for (const [roomId, session] of [...sessions.entries()]) {
      try {
        if (session.finished) continue;
        if (runtime.getPhase(roomId) !== "running") {
          sessions.delete(roomId);
          continue;
        }
        const cfg = getPigConfig();
        const players = runtime.roomPlayers(roomId);
        const present = new Set(players.map((p) => p.id));
        // 任一队伍全员离场则提前结束
        let emptyTeam: Team | undefined;
        for (const team of TEAMS) {
          if (!session.teams[team].some((id) => present.has(id))) {
            emptyTeam = team;
            break;
          }
        }
        if (emptyTeam) {
          session.finished = true;
          runtime.endGame(
            roomId,
            "队伍无人",
            `§c${TEAM_COLORS[emptyTeam]}${TEAM_NAMES[emptyTeam]}§r 全员离场,游戏结束`,
          );
          continue;
        }
        // 周期性补充中立猪(无上限)
        const pigs = pigsInRoom(runtime, roomId);
        if (
          system.currentTick - session.lastRefillTick >=
          cfg.pigRespawnIntervalTicks
        ) {
          session.lastRefillTick = system.currentTick;
          for (let i = 0; i < cfg.pigSpawnBatch; i++) {
            spawnPig(runtime, roomId);
          }
        }
        // 归属判定与边界回拉
        const counts: Record<Team, number> = {
          red: 0,
          yellow: 0,
          blue: 0,
          green: 0,
        };
        for (const pig of pigs) {
          for (const team of TEAMS) {
            if (isInside(cfg.cores[team], pig.location)) {
              counts[team] += 1;
              break;
            }
          }
          const leashed = isLeashed(pig);
          if (!isInside(cfg.mapBoundary, pig.location) || pig.location.y < -30) {
            if (!leashed) {
              try {
                pig.teleport({
                  x: cfg.pigSpawn.x + 0.5,
                  y: cfg.pigSpawn.y + 0.5,
                  z: cfg.pigSpawn.z + 0.5,
                });
              } catch {
                // 实体可能已移除
              }
            }
          }
          // 核心区胡萝卜引力场:半径内未被拴住的猪被温和拉向核心区中心
          if (!leashed) {
            for (const team of TEAMS) {
              const region = cfg.cores[team];
              const center = {
                x: (region.from.x + region.to.x) / 2 + 0.5,
                y: (region.from.y + region.to.y) / 2 + 0.5,
                z: (region.from.z + region.to.z) / 2 + 0.5,
              };
              if (distance(pig.location, center) <= cfg.lureRadius) {
                applyPull(pig, center, cfg.lureStrength);
                break;
              }
            }
          }
        }
        // 钓鱼竿钩中猪 → 解除拴绳:按鱼钩找最近猪,连续两轮指向同一只才算钩中(避免波及相邻猪)。
        // 与 entityHurt 处理器的事件驱动解拴互为兜底:事件驱动覆盖"勾中瞬间已拴住"的主场景,
        // 轮询覆盖"先勾住、后拴绳"的滞留场景(鱼钩附着未被无敌 cancel 破坏时)。
        const roomHookTargets = hookTargets.get(roomId);
        const hooks = runtime.roomDim(roomId).getEntities({
          type: "minecraft:fishing_hook",
        });
        if (hooks.length === 0) {
          // 只清本房间的连续一致性状态,不影响其他房间
          hookTargets.delete(roomId);
        } else {
          const targets = roomHookTargets ?? new Map<string, string>();
          if (!roomHookTargets) hookTargets.set(roomId, targets);
          for (const hook of hooks) {
            const nearest = runtime.roomDim(roomId).getEntities({
              type: "minecraft:pig",
              location: hook.location,
              maxDistance: 1.5,
              closest: 1,
            })[0];
            if (!nearest) {
              targets.delete(hook.id);
              continue;
            }
            const prev = targets.get(hook.id);
            targets.set(hook.id, nearest.id);
            if (prev !== nearest.id) continue; // 连续两轮同一只才算钩中
            if (!isLeashed(nearest)) continue;
            try {
              const leashable = nearest.getComponent("minecraft:leashable");
              if (leashable?.isLeashed) {
                leashable.unleash();
                runtime.dbg(`猪 ${nearest.id} 被鱼钩钩中,已解除拴绳`);
              }
            } catch (error) {
              console.warn("[Bearcade pigcatcher] 解除拴绳失败", error);
            }
          }
        }
        refreshScoreboard(roomId, counts);
        updateActionbars(runtime, roomId, session, counts);
        // 时间到
        if (system.currentTick - session.startTick >= cfg.gameDurationTicks) {
          session.finished = true;
          finishGame(runtime, roomId, session, counts);
        }
      } catch (error) {
        console.warn(
          `[Bearcade pigcatcher] 对局 tick 异常 room=${roomId}`,
          error,
        );
      }
    }
  }, 10);
}
