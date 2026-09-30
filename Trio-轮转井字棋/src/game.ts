// ============================================================
// 轮转井字棋玩法(3×3 / 每方最多 3 子 / 最老一子轮转虚化)
//
// 规则要点:
// - 棋盘 = 模板维度里 3×3 磁石棋盘的"上表面",棋子方块放在棋盘层 +1;
// - 每方场上最多 3 子;轮到自己时,最老的一子"轮转出局",原格留下虚化方块;
// - 虚化格仅在**该方自己的本回合**存在(禁止原地复下),回合结束即消失,
//   对手回合可以直接下这一格;
// - 三连即胜(8 条线);三局两胜;第 1 局随机先手,之后逐局轮换;
// - 每步限时 45 秒:超时由脚本在合法格中随机落子;同一玩家连续 3 次超时本局判负;
// - 流局兜底:每局手数上限 60,超限判平局(该局不计分),最多打 5 局。
//
// 说明:canPlace 回调运行在 restricted execution,内部**只改内存状态**,
// 一切世界写入/消息/结算都延迟到 system.run(见 docs/lessons.md §1.1)。
// ============================================================
import {
  system,
  world,
  ItemStack,
  GameMode,
  EntityComponentTypes,
  type EntityInventoryComponent,
  type Player,
  type PlayerPlaceBlockBeforeEvent,
  type RawMessage,
} from "@minecraft/server";
import type { MinigameHooks } from "../../shared/minigame-core/types";
import { stripSectionCodes } from "../../shared/minigame-core/text";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import {
  clearHudTitle,
  ensureObjective as ensureHudObjective,
  hudMessage,
  releaseObjective,
  scoreToken,
  setHudTitle,
  setObjectiveScore,
} from "../../shared/minigame-core/scoreboardHud";
import { getTrioConfig, openTrioConfig } from "./trio-config";
import {
  BOARD_SIZE,
  GHOST_O,
  GHOST_X,
  MAX_ROUNDS,
  PARTY_SPECTATE_ENABLED,
  PIECE_O,
  PIECE_X,
  SPECTATE_ENABLED,
  TIMEOUT_LOSS_STREAK,
} from "./config";

type Mark = "x" | "o";

interface RoundState {
  /** 9 格棋盘(索引 = (z - boardMinZ) * 3 + (x - boardMinX)) */
  board: (Mark | null)[];
  /** 每方棋子格索引队列(最老在前,最多 BOARD_SIZE 个) */
  queue: Record<Mark, number[]>;
  /** 虚化格:仅该方自己的回合存在 */
  ghost: Record<Mark, number | null>;
  turn: Mark;
  /** 本局累计手数(双方合计) */
  moves: number;
}

interface MatchState {
  players: Record<Mark, string | undefined>;
  wins: Record<Mark, number>;
  roundNo: number;
  /** 第 1 局的先手(随机),之后逐局轮换 */
  round1First: Mark;
  rs: RoundState;
  phase: "playing" | "roundEnd";
  /** 连续超时计数(手动落子清零) */
  timeoutStreak: Record<Mark, number>;
  /** 本步截止 tick */
  deadlineTick: number;
  /** 观战者(接口预留,SPECTATE_ENABLED 关闭时不启用) */
  spectators: Set<string>;
}

type RoundResult =
  | { kind: "win"; mark: Mark }
  | { kind: "timeoutLoss"; mark: Mark }
  | { kind: "draw" };

const matches = new Map<number, MatchState>();
const AIR = "minecraft:air";

/** 八条三连线 */
const LINES: number[][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

// ================= 坐标与标识 =================

function cellTotal(): number {
  return BOARD_SIZE * BOARD_SIZE;
}

function cellIndex(x: number, z: number): number {
  const cfg = getTrioConfig();
  return (z - cfg.boardMinZ) * BOARD_SIZE + (x - cfg.boardMinX);
}

function cellPos(index: number): { x: number; z: number } {
  const cfg = getTrioConfig();
  return {
    x: cfg.boardMinX + (index % BOARD_SIZE),
    z: cfg.boardMinZ + Math.floor(index / BOARD_SIZE),
  };
}

function inBoard(x: number, z: number): boolean {
  const cfg = getTrioConfig();
  return (
    x >= cfg.boardMinX &&
    x < cfg.boardMinX + BOARD_SIZE &&
    z >= cfg.boardMinZ &&
    z < cfg.boardMinZ + BOARD_SIZE
  );
}

function otherMark(mark: Mark): Mark {
  return mark === "x" ? "o" : "x";
}

function markLabel(mark: Mark): string {
  return mark === "x" ? "§cX§r" : "§9O§r";
}

function markPlain(mark: Mark): string {
  return mark === "x" ? "X(深红)" : "O(深蓝)";
}

function pieceType(mark: Mark): string {
  return mark === "x" ? PIECE_X : PIECE_O;
}

function ghostType(mark: Mark): string {
  return mark === "x" ? GHOST_X : GHOST_O;
}

function isTrioItem(typeId: string): boolean {
  return (
    typeId === PIECE_X ||
    typeId === PIECE_O ||
    typeId === GHOST_X ||
    typeId === GHOST_O
  );
}

function objectiveId(roomId: number): string {
  return `bearcade:trio_${roomId}`;
}

function scoreName(roomId: number, mark: Mark): string {
  return mark === "x" ? `trio_x${roomId}` : `trio_o${roomId}`;
}

function emptyRound(): RoundState {
  return {
    board: Array.from({ length: cellTotal() }, () => null as Mark | null),
    queue: { x: [], o: [] },
    ghost: { x: null, o: null },
    turn: "x",
    moves: 0,
  };
}

function timeoutTicks(): number {
  return Math.max(5, Math.round(getTrioConfig().moveTimeoutSeconds)) * 20;
}

// ================= 世界同步 =================

function setCellBlock(
  runtime: MinigameRuntime,
  roomId: number,
  index: number,
  typeId: string,
): void {
  const { x, z } = cellPos(index);
  try {
    runtime
      .roomDim(roomId)
      .setBlockType({ x, y: getTrioConfig().boardY + 1, z }, typeId);
  } catch (error) {
    console.warn(`[Bearcade trio] 棋盘格写方块失败 (${x}, ${z})`, error);
  }
}

function setPieceCell(
  runtime: MinigameRuntime,
  roomId: number,
  index: number,
  typeId: string | null,
): void {
  setCellBlock(runtime, roomId, index, typeId ?? AIR);
}

/** 清空落子层(棋子 + 虚化标记) */
function clearBoard(runtime: MinigameRuntime, roomId: number): void {
  for (let index = 0; index < cellTotal(); index++) {
    setPieceCell(runtime, roomId, index, null);
  }
}

// ================= 背包与棋子发放 =================

function inventoryOf(player: Player): EntityInventoryComponent | undefined {
  return player.getComponent(EntityComponentTypes.Inventory) as
    | EntityInventoryComponent
    | undefined;
}

function clearTokens(runtime: MinigameRuntime, roomId: number): void {
  for (const player of runtime.roomPlayers(roomId)) {
    const container = inventoryOf(player)?.container;
    if (!container) continue;
    for (let slot = 0; slot < container.size; slot++) {
      const item = container.getItem(slot);
      if (item && isTrioItem(item.typeId)) {
        container.setItem(slot, undefined);
      }
    }
  }
}

function givePiece(
  runtime: MinigameRuntime,
  roomId: number,
  player: Player,
  mark: Mark,
): void {
  clearTokens(runtime, roomId);
  const container = inventoryOf(player)?.container;
  if (!container) return;
  // 背包满时先移除一个杂物腾格(对局中其他物品无意义)
  if (container.emptySlotsCount === 0) {
    for (let slot = 0; slot < container.size; slot++) {
      const item = container.getItem(slot);
      if (item && !isTrioItem(item.typeId)) {
        container.setItem(slot, undefined);
        break;
      }
    }
  }
  try {
    container.addItem(new ItemStack(pieceType(mark), 1));
  } catch (error) {
    console.warn("[Bearcade trio] 发放棋子失败", error);
  }
}

// ================= 计分板 HUD =================

function ensureObjective(roomId: number): void {
  // 仅作 rawtext score 数据源,不占用全服唯一的 Sidebar 显示槽
  ensureHudObjective(objectiveId(roomId), "轮转井字棋");
}

function updateScores(roomId: number, match: MatchState): void {
  const objective = world.scoreboard.getObjective(objectiveId(roomId));
  if (!objective) return;
  setObjectiveScore(objective, scoreName(roomId, "x"), match.wins.x);
  setObjectiveScore(objective, scoreName(roomId, "o"), match.wins.o);
}

function markOf(match: MatchState, playerId: string): Mark | undefined {
  if (match.players.x === playerId) return "x";
  if (match.players.o === playerId) return "o";
  return undefined;
}

function playerOf(
  runtime: MinigameRuntime,
  roomId: number,
  match: MatchState,
  mark: Mark,
): Player | undefined {
  const id = match.players[mark];
  if (!id) return undefined;
  return runtime.roomPlayers(roomId).find((item) => item.id === id);
}

function hudTurnText(match: MatchState, me: Mark | undefined): string {
  if (!me) return "§7观战中";
  if (match.phase !== "playing") return "§7本局结束";
  if (match.rs.turn === me) return `§a▶ 轮到你(${markLabel(me)}§a)`;
  return `§7等待对方(${markLabel(match.rs.turn)}§7)`;
}

function refreshHud(
  runtime: MinigameRuntime,
  roomId: number,
  match: MatchState,
): void {
  const objective = world.scoreboard.getObjective(objectiveId(roomId));
  const rs = match.rs;
  const maxMoves = getTrioConfig().maxMovesPerRound;
  const remain =
    match.phase === "playing"
      ? Math.max(0, Math.ceil((match.deadlineTick - system.currentTick) / 20))
      : 0;
  for (const player of runtime.roomPlayers(roomId)) {
    const me = markOf(match, player.id);
    const parts: RawMessage[] = [
      { text: "§e轮转井字棋§r" },
      { text: "\n" },
      {
        text: `第 §f${match.roundNo}§r 局 · 手数 §f${rs.moves}§r/${maxMoves}`,
      },
      { text: "\n" },
      { text: "§cX " },
      objective
        ? scoreToken(scoreName(roomId, "x"), objectiveId(roomId))
        : { text: String(match.wins.x) },
      { text: "§r : §r" },
      objective
        ? scoreToken(scoreName(roomId, "o"), objectiveId(roomId))
        : { text: String(match.wins.o) },
      { text: " §9O" },
      { text: "\n" },
      { text: hudTurnText(match, me) },
      { text: "\n" },
      {
        text:
          match.phase === "playing"
            ? `§7剩余 §f${remain}§7s`
            : `§7比分 §f${match.wins.x} : ${match.wins.o}`,
      },
    ];
    setHudTitle(player, hudMessage(parts), 6000);
  }
}

// ================= 胜负判定 =================

function checkWin(board: (Mark | null)[], mark: Mark): boolean {
  return LINES.some((line) => line.every((index) => board[index] === mark));
}

function roundFirstOf(match: MatchState): Mark {
  // 第 1 局随机先手,之后逐局轮换(第 2 局换边,第 3 局回到第 1 局的先手)
  return match.roundNo % 2 === 1 ? match.round1First : otherMark(match.round1First);
}

// ================= 回合流程 =================

/** 把回合交给 mark:先让最老的一子轮转出局并留下虚化标记,再发放棋子并计时 */
function turnStart(
  runtime: MinigameRuntime,
  roomId: number,
  match: MatchState,
  mark: Mark,
): void {
  const rs = match.rs;
  const queue = rs.queue[mark];
  if (queue.length >= BOARD_SIZE) {
    const oldest = queue.shift();
    if (oldest !== undefined) {
      rs.board[oldest] = null;
      rs.ghost[mark] = oldest;
      setPieceCell(runtime, roomId, oldest, ghostType(mark));
      const { x, z } = cellPos(oldest);
      runtime.announce(
        roomId,
        `§7${markLabel(mark)}§7 最老的一子轮转出局 → 虚化格 (§f${x}§7, §f${z}§7) 本回合不可落子`,
      );
    }
  }
  rs.turn = mark;
  match.deadlineTick = system.currentTick + timeoutTicks();
  const player = playerOf(runtime, roomId, match, mark);
  if (player) {
    givePiece(runtime, roomId, player, mark);
    try {
      player.sendMessage(`§a轮到你落子(${markLabel(mark)}§a)`);
    } catch {
      // 玩家可能刚好断线
    }
  }
  refreshHud(runtime, roomId, match);
}

/** 开始新的一局:清空棋盘、复位站位、随机/轮换先手 */
function beginRound(
  runtime: MinigameRuntime,
  roomId: number,
  match: MatchState,
): void {
  match.phase = "playing";
  match.rs = emptyRound();
  match.timeoutStreak = { x: 0, o: 0 };
  clearBoard(runtime, roomId);

  const cfg = getTrioConfig();
  const xPlayer = playerOf(runtime, roomId, match, "x");
  const oPlayer = playerOf(runtime, roomId, match, "o");
  if (xPlayer) {
    try {
      xPlayer.setGameMode(GameMode.Survival);
    } catch {
      // 忽略
    }
    runtime.teleportPlayer(roomId, xPlayer, cfg.xStart);
  }
  if (oPlayer) {
    try {
      oPlayer.setGameMode(GameMode.Survival);
    } catch {
      // 忽略
    }
    runtime.teleportPlayer(roomId, oPlayer, cfg.oStart);
  }

  const first = roundFirstOf(match);
  runtime.announce(
    roomId,
    `§a第 §f${match.roundNo}§a 局开始,${markLabel(first)}§a 先手(三局两胜)`,
  );
  turnStart(runtime, roomId, match, first);
}

/** 结束本局:记分 → 展示终局盘面 → 进入下一局或结束整场 */
function endRound(
  runtime: MinigameRuntime,
  roomId: number,
  match: MatchState,
  result: RoundResult,
): void {
  if (match.phase !== "playing") return;
  match.phase = "roundEnd";
  match.deadlineTick = Number.MAX_SAFE_INTEGER;
  clearTokens(runtime, roomId);

  let reason: string;
  if (result.kind === "win") {
    match.wins[result.mark]++;
    reason = `${markLabel(result.mark)}§e 三连,本局获胜`;
  } else if (result.kind === "timeoutLoss") {
    match.wins[otherMark(result.mark)]++;
    reason = `§c${markLabel(result.mark)}§c 连续 ${TIMEOUT_LOSS_STREAK} 次超时,本局判负`;
  } else {
    reason = "§e本局平局(达到手数上限,该局不计分)";
  }
  updateScores(roomId, match);
  runtime.announce(roomId, reason);
  refreshHud(runtime, roomId, match);

  const cfg = getTrioConfig();
  const decided =
    match.wins.x >= cfg.winsToMatch ||
    match.wins.o >= cfg.winsToMatch ||
    match.roundNo >= MAX_ROUNDS;

  system.runTimeout(() => {
    // 强制中止/玩家离开后不再推进(房间状态已离开 running)
    if (matches.get(roomId) !== match || !runtime.isRunning(roomId)) return;
    clearBoard(runtime, roomId);
    if (decided) {
      const rx = match.wins.x;
      const ro = match.wins.o;
      const title = rx > ro ? "X 方获胜" : ro > rx ? "O 方获胜" : "双方平局";
      runtime.endGame(
        roomId,
        title,
        `§e${title}(局分 §f${rx}§e : §f${ro}§e),即将返回大厅…`,
      );
      return;
    }
    match.roundNo++;
    beginRound(runtime, roomId, match);
  }, 60);
}

/** 超时随机落子(脚本直接写方块,不走引擎放置) */
function autoMove(
  runtime: MinigameRuntime,
  roomId: number,
  match: MatchState,
  mark: Mark,
): void {
  const rs = match.rs;
  const ghostCell = rs.ghost[mark];
  const legal: number[] = [];
  for (let index = 0; index < cellTotal(); index++) {
    if (rs.board[index] === null && index !== ghostCell) legal.push(index);
  }
  rs.ghost[mark] = null;
  if (ghostCell !== null) setPieceCell(runtime, roomId, ghostCell, null);

  if (legal.length === 0) {
    // 理论不会发生(盘面最多 6 枚,合法格恒 ≥3);兜底直接换手
    console.warn(`[Bearcade trio] 房间 ${roomId} 无合法落点,直接换手`);
    turnStart(runtime, roomId, match, otherMark(mark));
    return;
  }

  const index = legal[Math.floor(Math.random() * legal.length)];
  rs.board[index] = mark;
  rs.queue[mark].push(index);
  rs.moves++;
  setPieceCell(runtime, roomId, index, pieceType(mark));
  const { x, z } = cellPos(index);
  runtime.announce(
    roomId,
    `§e${markLabel(mark)}§e 超时,已在 (§f${x}§e, §f${z}§e) 随机落子`,
  );

  if (checkWin(rs.board, mark)) {
    endRound(runtime, roomId, match, { kind: "win", mark });
    return;
  }
  if (rs.moves >= getTrioConfig().maxMovesPerRound) {
    endRound(runtime, roomId, match, { kind: "draw" });
    return;
  }
  turnStart(runtime, roomId, match, otherMark(mark));
}

// ================= 落子校验(restricted execution:只改内存) =================

function handlePlace(
  runtime: MinigameRuntime,
  event: PlayerPlaceBlockBeforeEvent,
  roomId: number,
): boolean {
  const player = event.player;
  if (!runtime.isRunning(roomId)) return false;
  const match = matches.get(roomId);
  if (!match || match.phase !== "playing") return false;

  const me = markOf(match, player.id);
  if (!me) {
    if (match.spectators.has(player.id)) {
      system.run(() => player.sendMessage("§7观战中,无法落子"));
    }
    return false;
  }

  const rs = match.rs;
  const cfg = getTrioConfig();
  const { x, y, z } = event.block.location;
  if (y !== cfg.boardY + 1 || !inBoard(x, z)) {
    system.run(() => player.sendMessage("§c棋子只能下在 3×3 棋盘格上"));
    return false;
  }
  const index = cellIndex(x, z);
  if (rs.turn !== me) {
    system.run(() => player.sendMessage("§c还没轮到你落子"));
    return false;
  }
  if (rs.board[index] !== null) {
    system.run(() => player.sendMessage("§c该格已有棋子"));
    return false;
  }
  if (rs.ghost[me] === index) {
    system.run(() =>
      player.sendMessage("§c该格本回合已虚化(你刚轮转出局的位置),不可落子"),
    );
    return false;
  }
  if (event.permutationToPlace.type.id !== pieceType(me)) {
    system.run(() =>
      player.sendMessage(`§c请放置你手中的棋子(${markPlain(me)})`),
    );
    return false;
  }

  // ---- 校验通过:受限上下文内只改内存,世界同步与结算延迟到 system.run ----
  const ghostCell = rs.ghost[me];
  rs.ghost[me] = null;
  rs.board[index] = me;
  rs.queue[me].push(index);
  rs.moves++;
  match.timeoutStreak[me] = 0; // 手动落子清零连续超时计数
  const won = checkWin(rs.board, me);
  const draw = !won && rs.moves >= cfg.maxMovesPerRound;
  const playerId = player.id;

  system.run(() => {
    if (matches.get(roomId) !== match || !runtime.isRunning(roomId)) return;
    // 虚化标记随本回合结束消失(对手回合该格即可落子)
    if (ghostCell !== null) setPieceCell(runtime, roomId, ghostCell, null);
    const live = runtime.roomPlayers(roomId).find((item) => item.id === playerId);
    if (live) {
      try {
        live.sendMessage(`§7落子:${markLabel(me)}§7 (§f${x}§7, §f${z}§7)`);
      } catch {
        // 忽略
      }
    }
    if (won) {
      endRound(runtime, roomId, match, { kind: "win", mark: me });
      return;
    }
    if (draw) {
      endRound(runtime, roomId, match, { kind: "draw" });
      return;
    }
    turnStart(runtime, roomId, match, otherMark(me));
  });

  // 放行引擎放置(棋子方块由引擎写入,物品由引擎消耗)
  return true;
}

// ================= 观战 / 派对接口(预留,暂不启用) =================

/**
 * 观战接口(预留):把玩家登记为某房间的观战者。
 * 仅在 SPECTATE_ENABLED 开启后生效;关闭时返回 false,调用方自行拒绝。
 */
export function addSpectator(
  roomId: number,
  player: Player,
): boolean {
  if (!SPECTATE_ENABLED) return false;
  const match = matches.get(roomId);
  if (!match) return false;
  match.spectators.add(player.id);
  return true;
}

/** 某房间当前是否处于对局中(供派对/观战接入方判断) */
export function isMatchRunning(roomId: number): boolean {
  return matches.get(roomId)?.phase === "playing";
}

// ================= 导出:钩子与主循环 =================

export function initTrio(getRuntime: () => MinigameRuntime): void {
  system.runInterval(() => {
    const runtime = getRuntime();
    // 拷贝一份,避免迭代期间被 onBeforeReset 删除
    for (const [roomId, match] of [...matches]) {
      if (!runtime.isRunning(roomId)) continue;
      if (
        match.phase === "playing" &&
        system.currentTick >= match.deadlineTick
      ) {
        const mark = match.rs.turn;
        match.timeoutStreak[mark]++;
        if (match.timeoutStreak[mark] >= TIMEOUT_LOSS_STREAK) {
          runtime.announce(
            roomId,
            `§c${markLabel(mark)}§c 连续 ${TIMEOUT_LOSS_STREAK} 次超时,本局判负`,
          );
          endRound(runtime, roomId, match, { kind: "timeoutLoss", mark });
        } else {
          autoMove(runtime, roomId, match, mark);
        }
      }
      refreshHud(runtime, roomId, match);
    }
  }, 20);
}

export function makeTrioHooks(
  getRuntime: () => MinigameRuntime,
): MinigameHooks {
  return {
    onGameStart(roomId, players) {
      const runtime = getRuntime();
      const first = players[0];
      const second = players[1];
      if (!first || !second) {
        runtime.endGame(roomId, "人数不足");
        return;
      }
      // 随机决定谁是 X(深红)/ O(深蓝)
      const xIsFirstJoined = Math.random() < 0.5;
      const xPlayer = xIsFirstJoined ? first : second;
      const oPlayer = xIsFirstJoined ? second : first;

      const match: MatchState = {
        players: { x: xPlayer.id, o: oPlayer.id },
        wins: { x: 0, o: 0 },
        roundNo: 1,
        round1First: Math.random() < 0.5 ? "x" : "o",
        rs: emptyRound(),
        phase: "playing",
        timeoutStreak: { x: 0, o: 0 },
        deadlineTick: system.currentTick,
        spectators: new Set<string>(),
      };
      matches.set(roomId, match);

      // 观战接口预留:仅在开启后把第 3 名及以后的玩家登记为观战者
      if (SPECTATE_ENABLED || PARTY_SPECTATE_ENABLED) {
        for (const player of players) {
          if (player.id !== xPlayer.id && player.id !== oPlayer.id) {
            match.spectators.add(player.id);
          }
        }
      }

      ensureObjective(roomId);
      updateScores(roomId, match);
      runtime.announce(
        roomId,
        `§a对局开始!§cX§a:${stripSectionCodes(xPlayer.name)} / §9O§a:${stripSectionCodes(oPlayer.name)} · 三局两胜`,
      );
      beginRound(runtime, roomId, match);
    },
    onBeforeReset(roomId) {
      const runtime = getRuntime();
      matches.delete(roomId);
      releaseObjective(objectiveId(roomId));
      for (const player of runtime.roomPlayers(roomId)) {
        clearHudTitle(player);
        try {
          player.setGameMode(GameMode.Adventure);
        } catch {
          // 忽略
        }
      }
      clearTokens(runtime, roomId);
      clearBoard(runtime, roomId);
    },
    onRoomReset(roomId) {
      // 模板重新复制后兜底清空落子层(防止模板捕获时把棋子/虚化方块一起复制)
      const runtime = getRuntime();
      clearBoard(runtime, roomId);
    },
    canPlace(event, roomId) {
      return handlePlace(getRuntime(), event, roomId);
    },
    canBreak() {
      // 棋盘与棋子一律不可破坏(棋子由脚本管理)
      return false;
    },
    openConfig(player) {
      openTrioConfig(player, getRuntime());
    },
  };
}
