import {
  system,
  world,
  GameMode,
  DisplaySlotId,
  ObjectiveSortOrder,
  type Player,
} from "@minecraft/server";
import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { getGuessConfig, openGuessConfig } from "./guess-config";
import {
  BUILDER_GAIN,
  GUESSER_GAIN,
  MIN_PLAYERS,
  ROUND_SECONDS,
  targetScoreFor,
} from "./config";
import { loadQuestions } from "./qbank";
import { dbg } from "./debug";

type RoundResult = "correct" | "timeout" | "builder_left";

interface Session {
  phase: "building" | "ended";
  settling: boolean;
  target: number;
  order: string[];
  builderIndex: number;
  builderId: string;
  question: string;
  lastQuestion: string;
  deadlineTick: number;
  scores: Map<string, number>;
}

const sessions = new Map<number, Session>();

function objectiveId(roomId: number): string {
  return `bearcade:gnb_score_${roomId}`;
}

function normalized(text: string): string {
  return text.trim().toLowerCase();
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
  if (existing) {
    world.scoreboard.removeObjective(id);
  }
  const objective = world.scoreboard.addObjective(
    id,
    `建筑猜猜乐 · 目标 ${target} 分`,
  );
  world.scoreboard.setObjectiveAtDisplaySlot(DisplaySlotId.Sidebar, {
    objective,
    sortOrder: ObjectiveSortOrder.Descending,
  });
}

function setScore(roomId: number, playerId: string, score: number): void {
  const objective = world.scoreboard.getObjective(objectiveId(roomId));
  const player = world.getAllPlayers().find((p) => p.id === playerId);
  if (objective && player) {
    objective.setScore(player, score);
  }
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
        `[Bearcade guessnbuild] 清理实体失败(${entity.typeId})`,
        error,
      );
    }
  }
}

function drawQuestion(session: Session): string | undefined {
  const bank = loadQuestions();
  if (bank.length === 0) return undefined;
  if (bank.length === 1) return bank[0];
  let pick = bank[Math.floor(Math.random() * bank.length)];
  while (pick === session.lastQuestion) {
    pick = bank[Math.floor(Math.random() * bank.length)];
  }
  return pick;
}

function setGameModes(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  for (const player of runtime.roomPlayers(roomId)) {
    player.setGameMode(
      player.id === session.builderId
        ? GameMode.Creative
        : GameMode.Spectator,
    );
  }
}

function updateActionbars(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  const remain = Math.max(
    0,
    Math.ceil((session.deadlineTick - system.currentTick) / 20),
  );
  const hintLength = session.question.trim().length;
  for (const player of runtime.roomPlayers(roomId)) {
    const score = session.scores.get(player.id) ?? 0;
    player.onScreenDisplay.setActionBar(
      player.id === session.builderId
        ? `§e剩余 ${remain} 秒 | 你是建筑者 | 你的分数 ${score}`
        : `§e剩余 ${remain} 秒 | 答案 ${hintLength} 个字 | 你的分数 ${score}`,
    );
  }
}

/** 按环形散开生成全员回合落点(派对模式大部队不会叠在一起);边界取运行时模板范围,与场地实际位置一致 */
function roundSpawnPositions(
  count: number,
  bounds: { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } },
): { x: number; y: number; z: number }[] {
  const center = getGuessConfig().roundSpawn;
  const positions: { x: number; y: number; z: number }[] = [];
  const seen = new Set<string>();
  let radius = 1;
  while (positions.length < count) {
    const ring: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const x = Math.round(center.x + radius * Math.cos(angle));
      const z = Math.round(center.z + radius * Math.sin(angle));
      if (
        x < bounds.from.x ||
        x > bounds.to.x ||
        z < bounds.from.z ||
        z > bounds.to.z
      ) {
        continue;
      }
      const key = `${x},${z}`;
      if (!seen.has(key)) {
        seen.add(key);
        ring.push({ x, y: center.y, z });
      }
    }
    if (ring.length === 0) break;
    for (const pos of ring) {
      positions.push(pos);
      if (positions.length >= count) break;
    }
    radius++;
  }
  while (positions.length < count) {
    positions.push({ ...center });
  }
  return positions;
}

function startRound(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  const builderId = session.order[session.builderIndex];
  if (!builderId) {
    runtime.endGame(roomId, "人数不足");
    return;
  }
  const question = drawQuestion(session);
  if (!question) {
    runtime.endGame(roomId, "题库为空", "§c题库为空,请管理员先添加题目");
    return;
  }

  session.builderId = builderId;
  session.question = question;
  session.lastQuestion = question;
  session.deadlineTick = system.currentTick + ROUND_SECONDS * 20;
  session.settling = false; // 新回合重置防重入标记
  session.phase = "building";
  setGameModes(runtime, roomId, session);

  const builder = runtime
    .roomPlayers(roomId)
    .find((p) => p.id === builderId);
  builder?.sendMessage(`§a你是建筑者!题目:${question}`);
  for (const player of runtime.roomPlayers(roomId)) {
    if (player.id !== builderId) {
      player.sendMessage(
        `§a建筑开始!答案是 ${question.trim().length} 个字,在聊天栏发送你的答案`,
      );
    }
  }
  updateActionbars(runtime, roomId, session);
  // 每回合开始把玩家传送到场地中心(方块中心由运行时自动 +0.5)
  const players = runtime.roomPlayers(roomId);
  const spawns = roundSpawnPositions(players.length, {
    from: runtime.config.templateFrom,
    to: runtime.config.templateTo,
  });
  for (const [index, player] of players.entries()) {
    runtime.teleportPlayer(
      roomId,
      player,
      spawns[index] ?? getGuessConfig().roundSpawn,
    );
  }
  dbg(
    `回合开始 room=${roomId} builder=${builderId} question=${question} deadline=${session.deadlineTick}`,
  );
}

async function nextRound(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): Promise<void> {
  try {
    // 每回合结束:清空实体并从模板重置场地
    dbg(`重置场地 room=${roomId}`);
    clearFieldEntities(runtime, roomId);
    await runtime.resetRoom(roomId);
    dbg(`场地重置完成 room=${roomId}`);
    startRound(runtime, roomId, session);
  } catch (error) {
    console.warn(
      `[Bearcade guessnbuild] 回合重置失败 room=${roomId}`,
      error,
    );
    runtime.endGame(roomId, "回合重置失败");
  }
}

async function roundEnd(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
  result: RoundResult,
  guesserId?: string,
): Promise<void> {
  if (session.settling) return;
  session.settling = true;
  session.phase = "ended";
  dbg(
    `回合结束 room=${roomId} result=${result} guesser=${guesserId ?? "-"} scores=${JSON.stringify([...session.scores.entries()])}`,
  );

  try {
    if (result === "correct" && guesserId) {
    session.scores.set(
      guesserId,
      (session.scores.get(guesserId) ?? 0) + GUESSER_GAIN,
    );
    session.scores.set(
      session.builderId,
      (session.scores.get(session.builderId) ?? 0) + BUILDER_GAIN,
    );
    runtime.announce(
      roomId,
      `§a${playerName(runtime, roomId, guesserId)} 答对(+${GUESSER_GAIN}),${playerName(runtime, roomId, session.builderId)} 建筑成功(+${BUILDER_GAIN})`,
    );
    } else if (result === "timeout") {
      runtime.announce(roomId, "§7时间到,无人答对,无人得分");
    } else {
      runtime.announce(roomId, "§7建筑者离开,本回合作废,无人得分");
    }

    for (const [playerId, score] of session.scores) {
      setScore(roomId, playerId, score);
    }

    // 胜负判定:任一在场玩家达到目标分即结束,同分并列
    const players = runtime.roomPlayers(roomId);
    const presentIds = new Set(players.map((p) => p.id));
    const target = session.target;
    const reached = [...session.scores.entries()].filter(
      ([id, score]) => presentIds.has(id) && score >= target,
    );
    if (reached.length > 0) {
      const max = Math.max(...reached.map(([, score]) => score));
      const winners = reached
        .filter(([, score]) => score === max)
        .map(([id]) => playerName(runtime, roomId, id));
      runtime.endGame(
        roomId,
        "游戏结束",
        `§e游戏结束!获胜:${winners.join("、")}(最高 ${max} 分)`,
      );
      return;
    }

    // 轮换建筑者(按加入顺序)
    if (result === "builder_left") {
      session.order = session.order.filter((id) => id !== session.builderId);
      if (session.order.length < MIN_PLAYERS) {
        runtime.endGame(roomId, "人数不足");
        return;
      }
      session.builderIndex = session.builderIndex % session.order.length;
    } else {
      session.builderIndex = (session.builderIndex + 1) % session.order.length;
    }
    await nextRound(runtime, roomId, session);
  } catch (error) {
    console.warn(
      `[Bearcade guessnbuild] 回合结算异常 room=${roomId}`,
      error,
    );
    runtime.endGame(roomId, "回合结算异常");
  }
}

function canEdit(
  runtime: MinigameRuntime,
  roomId: number,
  player: Player,
  location: { x: number; y: number; z: number },
): boolean {
  const session = sessions.get(roomId);
  if (!session || session.phase !== "building") return false;
  if (session.builderId !== player.id) return false;
  // 边界取运行时模板范围(与 /bearcade:tmp sz 配置的场地实际位置一致)
  const bounds = {
    from: runtime.config.templateFrom,
    to: runtime.config.templateTo,
  };
  return (
    location.x >= bounds.from.x &&
    location.x <= bounds.to.x &&
    location.z >= bounds.from.z &&
    location.z <= bounds.to.z
  );
}

export function makeGameHooks(
  getRuntime: () => MinigameRuntime,
): MinigameHooks {
  return {
    onGameStart(roomId, players) {
      const runtime = getRuntime();
      const session: Session = {
        phase: "building",
        settling: false,
        target: targetScoreFor(players.length),
        order: players.map((p) => p.id),
        builderIndex: 0,
        builderId: "",
        question: "",
        lastQuestion: "",
        deadlineTick: 0,
        scores: new Map(players.map((p) => [p.id, 0])),
      };
      sessions.set(roomId, session);
      ensureObjective(roomId, session.target);
      for (const player of players) setScore(roomId, player.id, 0);
      dbg(`游戏开始 room=${roomId} players=${players.map((p) => p.name).join(",")}`);
      void nextRound(runtime, roomId, session);
    },
    onBeforeReset(roomId) {
      const runtime = getRuntime();
      dbg(`游戏结束重置 room=${roomId}`);
      clearFieldEntities(runtime, roomId);
      for (const player of runtime.roomPlayers(roomId)) {
        player.setGameMode(GameMode.Adventure);
      }
      sessions.delete(roomId);
      try {
        world.scoreboard.removeObjective(objectiveId(roomId));
      } catch {
        // 目标可能已不存在,忽略
      }
      try {
        world.scoreboard.clearObjectiveAtDisplaySlot(DisplaySlotId.Sidebar);
      } catch {
        // 无侧边栏目标时忽略
      }
    },
    canPlace(event, roomId) {
      return canEdit(getRuntime(), roomId, event.player, event.block.location);
    },
    canBreak(event, roomId) {
      return canEdit(getRuntime(), roomId, event.player, event.block.location);
    },
    openConfig(player) {
      openGuessConfig(player, getRuntime());
    },
  };
}

export function initGuessGame(getRuntime: () => MinigameRuntime): void {
  world.beforeEvents.chatSend.subscribe((event) => {
    const runtime = getRuntime();
    const roomId = runtime.roomIdFromDimension(event.sender.dimension.id);
    if (roomId === undefined) return;
    const session = sessions.get(roomId);
    if (!session || session.phase !== "building") return;
    if (event.sender.id === session.builderId) return; // 建筑者聊天放行
    if (normalized(event.message) === normalized(session.question)) {
      event.cancel = true;
      const guesserId = event.sender.id;
      // 聊天 before 事件运行在受限上下文:用 phase 同步锁定,再延迟到正常上下文结算
      if (session.phase === "building") {
        session.phase = "ended";
        dbg(`答对 room=${roomId} player=${event.sender.name} text=${event.message}`);
        system.run(() => {
          void roundEnd(runtime, roomId, session, "correct", guesserId);
        });
      }
    } else {
      dbg(`答错 room=${roomId} player=${event.sender.name} text=${event.message}`);
    }
    // 错误答案不做处理,消息照常广播
  });

  system.runInterval(() => {
    const runtime = getRuntime();
    for (const [roomId, session] of [...sessions.entries()]) {
      if (session.phase !== "building") continue;
      const players = runtime.roomPlayers(roomId);
      if (system.currentTick >= session.deadlineTick) {
        void roundEnd(runtime, roomId, session, "timeout");
      } else if (!players.some((p) => p.id === session.builderId)) {
        void roundEnd(runtime, roomId, session, "builder_left");
      } else {
        updateActionbars(runtime, roomId, session);
      }
    }
  }, 20);
}
