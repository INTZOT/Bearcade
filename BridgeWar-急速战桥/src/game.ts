import {
  system,
  world,
  GameMode,
  DisplaySlotId,
  ObjectiveSortOrder,
  type Player,
  type EntityHealthComponent,
} from "@minecraft/server";
import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { getBridgeConfig, openBridgeConfig } from "./bridge-config";
import { applyLoadout } from "./loadout";
import {
  ROUND_END_DELAY_TICKS,
  BRIDGE_WOOLS,
  SPAWN_PROTECT_RADIUS,
  TEMPLATE_FROM,
  TEMPLATE_TO,
} from "./config";

type Team = "red" | "blue";

interface CoreRegion {
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
}

interface Session {
  teams: { red: string[]; blue: string[] };
  scores: { red: number; blue: number };
  target: number;
  roundActive: boolean;
}

const sessions = new Map<number, Session>();
const placedBlocks = new Map<number, Set<string>>();

function objectiveId(roomId: number): string {
  return `bearcade:bw_score_${roomId}`;
}

function teamName(team: Team): string {
  return team === "red" ? "红队" : "蓝队";
}

function teamColor(team: Team): string {
  return team === "red" ? "§c" : "§9";
}

/** 玩家名字染色:头顶名牌(nameTag)与聊天名字(chatNamePrefix/Suffix) */
function setTeamName(player: Player, team?: Team): void {
  if (team) {
    player.nameTag = `${teamColor(team)}${player.name}§r`;
    player.chatNamePrefix = teamColor(team);
    player.chatNameSuffix = "§r";
  } else {
    player.nameTag = player.name;
    player.chatNamePrefix = undefined;
    player.chatNameSuffix = undefined;
  }
}

function teamOf(session: Session, playerId: string): Team | undefined {
  if (session.teams.red.includes(playerId)) return "red";
  if (session.teams.blue.includes(playerId)) return "blue";
  return undefined;
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

function ensureObjective(roomId: number, target: number): void {
  const id = objectiveId(roomId);
  const existing = world.scoreboard.getObjective(id);
  if (existing) world.scoreboard.removeObjective(id);
  const objective = world.scoreboard.addObjective(
    id,
    `急速战桥 · 目标 ${target} 分`,
  );
  world.scoreboard.setObjectiveAtDisplaySlot(DisplaySlotId.Sidebar, {
    objective,
    sortOrder: ObjectiveSortOrder.Descending,
  });
}

function setScore(roomId: number, participant: string, score: number): void {
  const objective = world.scoreboard.getObjective(objectiveId(roomId));
  if (objective) objective.setScore(participant, score);
}

function refreshScoreboard(roomId: number, session: Session): void {
  setScore(roomId, "红队", session.scores.red);
  setScore(roomId, "蓝队", session.scores.blue);
}

function clearFieldEntities(
  runtime: MinigameRuntime,
  roomId: number,
): void {
  for (const entity of runtime.roomDim(roomId).getEntities()) {
    if (entity.typeId === "minecraft:player") continue;
    try {
      entity.remove();
    } catch (error) {
      console.warn(
        `[Bearcade bridgewar] 清理实体失败(${entity.typeId})`,
        error,
      );
    }
  }
}

function teamSpawn(team: Team) {
  const cfg = getBridgeConfig();
  return team === "red" ? cfg.redSpawn : cfg.blueSpawn;
}

function healPlayer(player: Player): void {
  const health = player.getComponent("minecraft:health") as
    | EntityHealthComponent
    | undefined;
  if (health) health.setCurrentValue(health.effectiveMax);
}

function isInside(
  region: CoreRegion,
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

function inTemplate(location: { x: number; y: number; z: number }): boolean {
  return (
    location.x >= TEMPLATE_FROM.x &&
    location.x <= TEMPLATE_TO.x &&
    location.y >= TEMPLATE_FROM.y &&
    location.y <= TEMPLATE_TO.y &&
    location.z >= TEMPLATE_FROM.z &&
    location.z <= TEMPLATE_TO.z
  );
}

function isInProtectedZone(
  location: { x: number; y: number; z: number },
): boolean {
  const cfg = getBridgeConfig();
  if (isInside(cfg.redCore, location) || isInside(cfg.blueCore, location)) {
    return true;
  }
  for (const spawn of [cfg.redSpawn, cfg.blueSpawn]) {
    if (
      Math.abs(location.x - spawn.x) <= SPAWN_PROTECT_RADIUS &&
      Math.abs(location.y - spawn.y) <= SPAWN_PROTECT_RADIUS &&
      Math.abs(location.z - spawn.z) <= SPAWN_PROTECT_RADIUS
    ) {
      return true;
    }
  }
  return false;
}

function updateActionbars(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  for (const player of runtime.roomPlayers(roomId)) {
    const team = teamOf(session, player.id);
    if (!team) continue;
    player.onScreenDisplay.setActionBar(
      `${teamColor(team)}${teamName(team)}§r · 比分 ${session.scores.red}:${session.scores.blue} · 目标 ${session.target}`,
    );
  }
}

async function startRound(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): Promise<void> {
  clearFieldEntities(runtime, roomId);
  await runtime.resetRoom(roomId);
  placedBlocks.get(roomId)?.clear();
  session.roundActive = true;

  for (const player of runtime.roomPlayers(roomId)) {
    const team = teamOf(session, player.id);
    if (!team) continue;
    player.setGameMode(GameMode.Adventure);
    runtime.teleportPlayer(roomId, player, teamSpawn(team));
    // 死亡时在己方基地复活,避免回到大厅触发少人结束
    player.setSpawnPoint({
      dimension: runtime.roomDim(roomId),
      x: teamSpawn(team).x,
      y: teamSpawn(team).y,
      z: teamSpawn(team).z,
    });
    applyLoadout(team, player);
    setTeamName(player, team);
  }

  runtime.announce(
    roomId,
    `§a回合开始!红队 ${session.teams.red.length} 人 / 蓝队 ${session.teams.blue.length} 人,冲进对方核心区得分!`,
  );
  updateActionbars(runtime, roomId, session);
}

async function scoreRound(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
  team: Team,
): Promise<void> {
  if (!session.roundActive) return;
  session.roundActive = false;
  session.scores[team] += 1;
  refreshScoreboard(roomId, session);
  runtime.announce(
    roomId,
    `${teamColor(team)}${teamName(team)} 得分!比分 ${session.scores.red}:${session.scores.blue}`,
  );

  if (session.scores[team] >= session.target) {
    runtime.endGame(
      roomId,
      "游戏结束",
      `${teamColor(team)}${teamName(team)} 获胜!比分 ${session.scores.red}:${session.scores.blue}`,
    );
    return;
  }
  system.runTimeout(() => {
    void startRound(runtime, roomId, session);
  }, ROUND_END_DELAY_TICKS);
}

function assignTeams(players: Player[]): Session["teams"] {
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  const half = Math.floor(shuffled.length / 2);
  const teams = {
    red: shuffled.slice(0, half).map((p) => p.id),
    blue: shuffled.slice(half, half * 2).map((p) => p.id),
  };
  // 奇数人数:多出的一人随机分给一队
  if (shuffled.length % 2 === 1) {
    const extra = shuffled[shuffled.length - 1];
    if (Math.random() < 0.5) {
      teams.red.push(extra.id);
    } else {
      teams.blue.push(extra.id);
    }
  }
  return teams;
}

export function makeGameHooks(
  getRuntime: () => MinigameRuntime,
): MinigameHooks {
  return {
    onGameStart(roomId, players) {
      const runtime = getRuntime();
      const session: Session = {
        teams: assignTeams(players),
        scores: { red: 0, blue: 0 },
        target: getBridgeConfig().winScore,
        roundActive: false,
      };
      sessions.set(roomId, session);
      placedBlocks.set(roomId, new Set());
      ensureObjective(roomId, session.target);
      refreshScoreboard(roomId, session);

      const redNames = session.teams.red
        .map((id) => playerName(runtime, roomId, id))
        .join("、");
      const blueNames = session.teams.blue
        .map((id) => playerName(runtime, roomId, id))
        .join("、");
      runtime.announce(
        roomId,
        `§a队伍分配:§c红队:${redNames} §r/ §9蓝队:${blueNames}`,
      );
      void startRound(runtime, roomId, session);
    },
    onBeforeReset(roomId) {
      const runtime = getRuntime();
      for (const player of runtime.roomPlayers(roomId)) {
        player.setGameMode(GameMode.Adventure);
        setTeamName(player);
      }
      sessions.delete(roomId);
      placedBlocks.delete(roomId);
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
    canPlace(event, roomId) {
      const session = sessions.get(roomId);
      if (!session || !session.roundActive) return false;
      const loc = event.block.location;
      if (!inTemplate(loc)) return false;
      const typeId = event.permutationToPlace.type.id;
      if (!BRIDGE_WOOLS.includes(typeId)) return false;
      if (isInProtectedZone(loc)) return false;
      placedBlocks
        .get(roomId)
        ?.add(`${loc.x},${loc.y},${loc.z}`);
      return true;
    },
    canBreak(event, roomId) {
      const session = sessions.get(roomId);
      if (!session || !session.roundActive) return false;
      const loc = event.block.location;
      const key = `${loc.x},${loc.y},${loc.z}`;
      const set = placedBlocks.get(roomId);
      if (!set || !set.has(key)) return false;
      set.delete(key);
      return true;
    },
    openConfig(player) {
      openBridgeConfig(player, getRuntime());
    },
  };
}

export function initBridgeWar(getRuntime: () => MinigameRuntime): void {
  // 死亡复活:回基地、回满血、应用装备
  world.afterEvents.playerSpawn.subscribe((event) => {
    const runtime = getRuntime();
    const roomId = runtime.roomIdFromDimension(event.player.dimension.id);
    if (roomId === undefined) return;
    const session = sessions.get(roomId);
    if (!session) return;
    const team = teamOf(session, event.player.id);
    if (!team) return;
    const player = event.player;
    player.setGameMode(GameMode.Adventure);
    healPlayer(player);
    runtime.teleportPlayer(roomId, player, teamSpawn(team));
    applyLoadout(team, player);
    setTeamName(player, team);
  });

  // 取消友军伤害(同房间同队伍玩家互相攻击不造成伤害)
  world.beforeEvents.entityHurt.subscribe((event) => {
    const attacker = event.damageSource?.damagingEntity;
    const victim = event.hurtEntity;
    if (
      !attacker ||
      attacker.typeId !== "minecraft:player" ||
      victim.typeId !== "minecraft:player"
    ) {
      return;
    }
    const runtime = getRuntime();
    const roomId = runtime.roomIdFromDimension(victim.dimension.id);
    if (roomId === undefined) return;
    const session = sessions.get(roomId);
    if (!session) return;
    const victimTeam = teamOf(session, victim.id);
    const attackerTeam = teamOf(session, attacker.id);
    if (victimTeam && victimTeam === attackerTeam) {
      event.cancel = true;
    }
  });

  // 虚空复活 / 核心区得分 / actionbar
  system.runInterval(() => {
    const runtime = getRuntime();
    for (const [roomId, session] of [...sessions.entries()]) {
      try {
        const players = runtime.roomPlayers(roomId);
        const present = new Set(players.map((p) => p.id));
        if (
          !session.teams.red.some((id) => present.has(id)) ||
          !session.teams.blue.some((id) => present.has(id))
        ) {
          runtime.endGame(roomId, "队伍无人", "§c有一方队伍已无人,游戏结束");
          continue;
        }

        for (const player of players) {
          const team = teamOf(session, player.id);
          if (!team) continue;
          if (player.location.y < -20) {
            runtime.teleportPlayer(roomId, player, teamSpawn(team));
            healPlayer(player);
            applyLoadout(team, player);
            setTeamName(player, team);
            player.sendMessage("§c你掉入虚空,已返回基地并回满血");
            continue;
          }
          if (session.roundActive) {
            const cfg = getBridgeConfig();
            const core =
              team === "red" ? cfg.blueCore : cfg.redCore;
            if (isInside(core, player.location)) {
              void scoreRound(runtime, roomId, session, team);
            }
          }
        }
        updateActionbars(runtime, roomId, session);
      } catch (error) {
        console.warn(
          `[Bearcade bridgewar] 对局 tick 异常 room=${roomId}`,
          error,
        );
      }
    }
  }, 10);
}
