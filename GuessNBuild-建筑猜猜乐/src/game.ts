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
import {
  BUILDER_GAIN,
  BUILD_SPAWN,
  GUESSER_GAIN,
  MIN_PLAYERS,
  ROUND_SECONDS,
  TEMPLATE_FROM,
  TEMPLATE_TO,
  targetScoreFor,
} from "./config";
import { loadQuestions } from "./qbank";

type RoundResult = "correct" | "timeout" | "builder_left";

interface Session {
  phase: "building" | "ended";
  settling: boolean;
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

function ensureObjective(roomId: number): void {
  const id = objectiveId(roomId);
  let objective = world.scoreboard.getObjective(id);
  if (!objective) {
    objective = world.scoreboard.addObjective(id, "建筑猜猜乐");
  }
  world.scoreboard.setObjectiveAtDisplaySlot(DisplaySlotId.Sidebar, {
    objective,
    sortOrder: ObjectiveSortOrder.Descending,
  });
}

function setScore(roomId: number, playerId: string, score: number): void {
  const objective = world.scoreboard.getObjective(objectiveId(roomId));
  const player = world.getAllPlayers().find((p) => p.id === playerId);
  if (objective && player?.scoreboardIdentity) {
    objective.setScore(player.scoreboardIdentity, score);
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
}

async function nextRound(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): Promise<void> {
  // 每回合结束:清空实体并从模板重置场地
  clearFieldEntities(runtime, roomId);
  await runtime.resetRoom(roomId);
  startRound(runtime, roomId, session);
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
  const target = targetScoreFor(players.length);
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
  return (
    location.x >= TEMPLATE_FROM.x &&
    location.x <= TEMPLATE_TO.x &&
    location.z >= TEMPLATE_FROM.z &&
    location.z <= TEMPLATE_TO.z
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
        order: players.map((p) => p.id),
        builderIndex: 0,
        builderId: "",
        question: "",
        lastQuestion: "",
        deadlineTick: 0,
        scores: new Map(players.map((p) => [p.id, 0])),
      };
      sessions.set(roomId, session);
      ensureObjective(roomId);
      for (const player of players) setScore(roomId, player.id, 0);
      runtime.teleportPlayer(roomId, players[0], BUILD_SPAWN);
      void nextRound(runtime, roomId, session);
    },
    onBeforeReset(roomId) {
      const runtime = getRuntime();
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
    event.cancel = true;
    if (normalized(event.message) === normalized(session.question)) {
      // 聊天 before 事件运行在受限上下文:先同步锁定,再延迟到正常上下文结算
      const guesserId = event.sender.id;
      if (!session.settling) {
        session.settling = true;
        session.phase = "ended";
        system.run(() => {
          void roundEnd(runtime, roomId, session, "correct", guesserId);
        });
      }
    }
    // 错误答案不做处理
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
