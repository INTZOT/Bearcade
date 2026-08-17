// ============================================================
// Go(围棋)玩法实现
// - 落子:放置自定义棋子方块,先手黑方;
// - 提子:落子后先提对方无气连通组(数组 + 世界方块同步),再查自杀;
// - 劫:上一步单子被提的位置禁落(简单劫,不做 superko);
// - 停一手:使用发放的纸张(物品)停一手,双方连续 pass 终局计目;
// - 计目:领地(单色包围空域)+ 提子数,黑贴 GO_KOMI 目;
// - 计时:每方 CLOCK_TICKS,当前玩家计时,超时判负;
// - 认输:当前玩家丢弃手中的棋子物品即认输(库存轮询检测)。
// ============================================================
import {
  system,
  world,
  GameMode,
  ItemStack,
  ItemLockMode,
  EntityComponentTypes,
  type EntityInventoryComponent,
  type Player,
  type PlayerPlaceBlockBeforeEvent,
} from "@minecraft/server";
import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { getGoConfig, openGoConfig } from "./go-config";
import { STONE_BLACK, STONE_WHITE, type GoConfig } from "./config";

type Color = "black" | "white";
type Cell = Color | null;

interface GoState {
  board: Cell[][];
  turn: Color;
  players: { black?: string; white?: string };
  /** prisoners[c] = c 方累计提子数 */
  prisoners: Record<Color, number>;
  passed: Record<Color, boolean>;
  /** 剩余局时(tick) */
  clocks: Record<Color, number>;
  /** 劫:上一步单子被提位置(禁落点) */
  ko: { x: number; z: number } | null;
  /** 本 tick 内完成落子(抑制"丢子=认输"误判) */
  justPlaced: boolean;
  /** 处于俯瞰视角(望远镜切换)中的玩家 */
  overview: Set<string>;
}

const games = new Map<number, GoState>();

const other = (c: Color): Color => (c === "black" ? "white" : "black");
const stoneId = (c: Color): string => (c === "black" ? STONE_BLACK : STONE_WHITE);
const stoneName = (c: Color): string => (c === "black" ? "黑" : "白");

function boardSize(): number {
  const cfg = getGoConfig();
  return cfg.gridMax - cfg.gridMin + 1;
}

function inGrid(x: number, z: number): boolean {
  const cfg = getGoConfig();
  return x >= cfg.gridMin && x <= cfg.gridMax && z >= cfg.gridMin && z <= cfg.gridMax;
}

const idx = (v: number): number => v - getGoConfig().gridMin;

function neighbors(x: number, z: number): [number, number][] {
  return (
    [
      [x - 1, z],
      [x + 1, z],
      [x, z - 1],
      [x, z + 1],
    ] as [number, number][]
  ).filter(([nx, nz]) => inGrid(nx, nz));
}

/** (x,z) 所在同色连通组:格子列表 + 气数 */
function groupInfo(
  board: Cell[][],
  x: number,
  z: number,
): { cells: [number, number][]; liberties: number } {
  const color = board[idx(x)][idx(z)];
  if (!color) return { cells: [], liberties: 0 };
  const seen = new Set<string>();
  const stack: [number, number][] = [[x, z]];
  const cells: [number, number][] = [];
  const libs = new Set<string>();
  while (stack.length > 0) {
    const [cx, cz] = stack.pop()!;
    const key = `${cx},${cz}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push([cx, cz]);
    for (const [nx, nz] of neighbors(cx, cz)) {
      const c = board[idx(nx)][idx(nz)];
      if (c === color) stack.push([nx, nz]);
      else if (c === null) libs.add(`${nx},${nz}`);
    }
  }
  return { cells, liberties: libs.size };
}

/**
 * 模拟落子(棋盘数组已放入该子):
 * 先提对方无气组,再查本组气;自杀(无提子且本组无气)则回滚并返回失败。
 */
function simulatePlace(
  state: GoState,
  x: number,
  z: number,
  color: Color,
): { ok: boolean; captured: [number, number][] } {
  const board = state.board;
  const opp = other(color);
  const captured: [number, number][] = [];
  for (const [nx, nz] of neighbors(x, z)) {
    if (board[idx(nx)][idx(nz)] !== opp) continue;
    const g = groupInfo(board, nx, nz);
    if (g.liberties === 0) {
      for (const [gx, gz] of g.cells) {
        board[idx(gx)][idx(gz)] = null;
        captured.push([gx, gz]);
      }
    }
  }
  const own = groupInfo(board, x, z);
  if (own.liberties === 0 && captured.length === 0) {
    for (const [gx, gz] of captured) board[idx(gx)][idx(gz)] = opp;
    return { ok: false, captured: [] };
  }
  return { ok: true, captured };
}

// ================= 物品管理 =================

function inventoryOf(player: Player): EntityInventoryComponent | undefined {
  return player.getComponent(
    EntityComponentTypes.Inventory,
  ) as EntityInventoryComponent | undefined;
}

function countStones(player: Player, color: Color): number {
  const container = inventoryOf(player)?.container;
  if (!container) return 0;
  let n = 0;
  for (let slot = 0; slot < container.size; slot++) {
    const item = container.getItem(slot);
    if (item?.typeId === stoneId(color)) n += item.amount;
  }
  return n;
}

function clearStones(runtime: MinigameRuntime, roomId: number): void {
  for (const player of runtime.roomPlayers(roomId)) {
    const container = inventoryOf(player)?.container;
    if (!container) continue;
    for (let slot = 0; slot < container.size; slot++) {
      const item = container.getItem(slot);
      if (
        item &&
        (item.typeId === STONE_BLACK || item.typeId === STONE_WHITE)
      ) {
        container.setItem(slot, undefined);
      }
    }
  }
}

/** 给当前玩家发一颗棋子;背包满时清掉一个非棋子杂物腾格 */
function giveTurn(
  runtime: MinigameRuntime,
  roomId: number,
  player: Player,
  color: Color,
): void {
  clearStones(runtime, roomId);
  const container = inventoryOf(player)?.container;
  if (container) {
    if (container.emptySlotsCount === 0) {
      for (let slot = 0; slot < container.size; slot++) {
        const item = container.getItem(slot);
        if (
          item &&
          item.typeId !== STONE_BLACK &&
          item.typeId !== STONE_WHITE &&
          item.typeId !== SPYGLASS_ID &&
          item.typeId !== PASS_ITEM_ID
        ) {
          container.setItem(slot, undefined);
          break;
        }
      }
    }
    container.addItem(new ItemStack(stoneId(color), 1));
  }
  player.sendMessage(`§a轮到你落子(${stoneName(color)}方),纸张=停一手,丢弃棋子=认输`);
  player.onScreenDisplay.setActionBar(`§a轮到你落子 · ${stoneName(color)}方`);
}

function switchTurn(runtime: MinigameRuntime, roomId: number, state: GoState): void {
  state.turn = other(state.turn);
  const next = runtime
    .roomPlayers(roomId)
    .find((p) => p !== undefined && p.id === state.players[state.turn]);
  if (next) {
    giveTurn(runtime, roomId, next, state.turn);
    runtime.announce(roomId, `轮到${stoneName(state.turn)}方落子`);
  } else {
    runtime.endGame(roomId, "对手已离开");
  }
}

// ================= 落子 =================

function handlePlace(
  runtime: MinigameRuntime,
  event: PlayerPlaceBlockBeforeEvent,
  roomId: number,
): boolean {
  const state = games.get(roomId);
  if (!state || !runtime.isRunning(roomId)) return false;
  const player = event.player;
  const { x, y, z } = event.block.location;
  const cfg = getGoConfig();
  if (y !== cfg.boardY + 1 || !inGrid(x, z)) {
    system.run(() => player.sendMessage("§c棋子只能放在棋盘交叉点上"));
    return false;
  }
  if (state.board[idx(x)][idx(z)]) {
    system.run(() => player.sendMessage("§c该交叉点已有棋子"));
    return false;
  }
  if (state.players[state.turn] !== player.id) {
    system.run(() => player.sendMessage("§c还没轮到你落子"));
    return false;
  }
  const color = state.turn;
  if (event.permutationToPlace.type.id !== stoneId(color)) {
    system.run(() => player.sendMessage("§c请放置你手中的对应颜色棋子"));
    return false;
  }
  // 劫:上一步单子被提位置禁落
  if (state.ko && state.ko.x === x && state.ko.z === z) {
    system.run(() => player.sendMessage("§c劫争:此交叉点暂时不能落子"));
    return false;
  }
  // 模拟落子(数组先放子)
  state.board[idx(x)][idx(z)] = color;
  const sim = simulatePlace(state, x, z, color);
  if (!sim.ok) {
    state.board[idx(x)][idx(z)] = null;
    system.run(() => player.sendMessage("§c禁着点(自杀)"));
    return false;
  }
  // 落子成立:提交状态
  state.prisoners[color] += sim.captured.length;
  state.ko = sim.captured.length === 1
    ? { x: sim.captured[0][0], z: sim.captured[0][1] }
    : null;
  state.passed = { black: false, white: false };
  state.justPlaced = true;

  // 世界同步:移除被提棋子(延迟到放置完成)
  const dim = runtime.roomDim(roomId);
  const captured = sim.captured;
  const boardY = cfg.boardY + 1;
  system.run(() => {
    for (const [gx, gz] of captured) {
      try {
        dim.setBlockType({ x: gx, y: boardY, z: gz }, "minecraft:air");
      } catch {
        // 忽略
      }
    }
  });

  system.run(() => {
    if (captured.length > 0) {
      runtime.announce(
        roomId,
        `§e${stoneName(color)}方提子 ${captured.length} 子(累计 ${state.prisoners[color]})`,
      );
    }
    player.sendMessage(`§7落子:${stoneName(color)} (${x}, ${z})`);
    switchTurn(runtime, roomId, state);
  });
  return true;
}

// ================= 停一手 / 计目 =================

function handlePass(
  runtime: MinigameRuntime,
  roomId: number,
  player: Player,
): boolean {
  const state = games.get(roomId);
  if (!state || !runtime.isRunning(roomId)) return false;
  if (state.players[state.turn] !== player.id) {
    player.sendMessage("§c还没轮到你停一手");
    return false;
  }
  state.passed[state.turn] = true;
  runtime.announce(roomId, `§e${stoneName(state.turn)}方停一手`);
  if (state.passed.black && state.passed.white) {
    finishByScoring(runtime, roomId, state);
    return true;
  }
  switchTurn(runtime, roomId, state);
  return true;
}

/** 计目:领地(单色完全包围的空域)+ 提子,黑贴目;终局 */
function finishByScoring(
  runtime: MinigameRuntime,
  roomId: number,
  state: GoState,
): void {
  const size = boardSize();
  const board = state.board;
  const visited = new Set<string>();
  let territoryBlack = 0;
  let territoryWhite = 0;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      if (board[i][j] !== null) continue;
      const key = `${i},${j}`;
      if (visited.has(key)) continue;
      const stack: [number, number][] = [[i, j]];
      const colors = new Set<Color>();
      let region = 0;
      visited.add(key);
      while (stack.length > 0) {
        const [ci, cj] = stack.pop()!;
        region++;
        for (const [ni, nj] of neighbors(ci + getGoConfig().gridMin, cj + getGoConfig().gridMin)) {
          const bi = idx(ni);
          const bj = idx(nj);
          const c = board[bi][bj];
          if (c === null) {
            const nk = `${bi},${bj}`;
            if (!visited.has(nk)) {
              visited.add(nk);
              stack.push([bi, bj]);
            }
          } else {
            colors.add(c);
          }
        }
      }
      if (colors.size === 1) {
        if (colors.has("black")) territoryBlack += region;
        else territoryWhite += region;
      }
    }
  }
  const komi = getGoConfig().komi;
  const blackScore = territoryBlack + state.prisoners.black;
  const whiteScore = territoryWhite + state.prisoners.white + komi;
  const winner = whiteScore >= blackScore ? "白方" : "黑方";
  runtime.endGame(
    roomId,
    "终局",
    `§e终局计目:黑 ${territoryBlack}+${state.prisoners.black}=${blackScore} 目,白 ${territoryWhite}+${state.prisoners.white}+${komi} 贴目=${whiteScore} 目,§b${winner}获胜`,
  );
}

// ================= 认输 / 计时(轮询) =================

function pollResign(runtime: MinigameRuntime, roomId: number, state: GoState): void {
  // 当前持棋玩家棋子数为 0 且非刚落子 → 丢弃棋子 = 认输
  const holder = runtime
    .roomPlayers(roomId)
    .find((p) => p !== undefined && p.id === state.players[state.turn]);
  const justPlaced = state.justPlaced;
  state.justPlaced = false;
  if (!holder) return;
  if (!justPlaced && countStones(holder, state.turn) === 0) {
    runtime.announce(roomId, `§c${stoneName(state.turn)}方丢弃棋子,认输!`);
    runtime.endGame(roomId, "认输", `§b${stoneName(other(state.turn))}方获胜`);
  }
}

function pollClock(runtime: MinigameRuntime, roomId: number, state: GoState): void {
  state.clocks[state.turn] -= 20;
  if (state.clocks[state.turn] <= 0) {
    runtime.announce(roomId, `§c${stoneName(state.turn)}方超时!`);
    runtime.endGame(roomId, "超时", `§b${stoneName(other(state.turn))}方获胜`);
  }
}

// ================= 钩子 =================

export function makeGoHooks(getRuntime: () => MinigameRuntime): MinigameHooks {
  return {
    onGameStart(roomId, players) {
      const runtime = getRuntime();
      const cfg = getGoConfig();
      const size = boardSize();
      const state: GoState = {
        board: Array.from({ length: size }, () => Array<Cell>(size).fill(null)),
        turn: "black",
        players: { black: players[0].id, white: players[1].id },
        prisoners: { black: 0, white: 0 },
        passed: { black: false, white: false },
        clocks: { black: cfg.clockTicks, white: cfg.clockTicks },
        ko: null,
        justPlaced: false,
        overview: new Set(),
      };
      games.set(roomId, state);
      players.forEach((player) => {
        player.setGameMode(GameMode.Survival);
        // 发放望远镜(槽位锁定,俯瞰视角)与纸张(槽位锁定,停一手)
        giveSpyglass(player);
        givePassItem(player);
        player.sendMessage(
          `§a围棋开始!${players[0].name}(黑) vs ${players[1].name}(白),黑先手;丢出棋子=认输,使用纸张=停一手;每方 ${Math.round(cfg.clockTicks / 1200)} 分钟局时`,
        );
      });
      runtime.teleportPlayer(roomId, players[0], cfg.blackStart);
      runtime.teleportPlayer(roomId, players[1], cfg.whiteStart);
      giveTurn(runtime, roomId, players[0], "black");
    },
    onBeforeReset(roomId) {
      const runtime = getRuntime();
      for (const player of runtime.roomPlayers(roomId)) {
        if (player === undefined) continue;
        player.setGameMode(GameMode.Adventure);
        try {
          player.camera.clear();
        } catch {
          // 忽略
        }
        removeGameItems(player);
      }
      clearStones(runtime, roomId);
      games.delete(roomId);
    },
    canPlace(event, roomId) {
      return handlePlace(getRuntime(), event, roomId);
    },
    openConfig(player) {
      openGoConfig(player, getRuntime());
    },
  };
}

export function initGo(getRuntime: () => MinigameRuntime): void {
  const runtime = getRuntime();

  // 认输轮询(0.5s) + 计时(1s):对局运行中每房间检查
  system.runInterval(() => {
    for (const [roomId, state] of [...games.entries()]) {
      try {
        if (runtime.getPhase(roomId) !== "running") continue;
        pollResign(runtime, roomId, state);
        pollClock(runtime, roomId, state);
      } catch (error) {
        console.warn(`[Bearcade Go] 对局轮询异常 room=${roomId}`, error);
      }
    }
  }, 10);

  // 观战/离场:当前持棋玩家离开房间 → 视为认输(断线=退出契约)
  world.afterEvents.playerDimensionChange.subscribe((event) => {
    const roomId = runtime.roomIdFromDimension(event.fromDimension.id);
    if (roomId === undefined) return;
    const state = games.get(roomId);
    if (!state) return;
    if (state.players[state.turn] === event.player.id) {
      runtime.announce(roomId, `§c${event.player.name} 离开,视为认输!`);
      runtime.endGame(roomId, "认输", `§b${stoneName(other(state.turn))}方获胜`);
    }
  });

  // 物品交互:对局中使用望远镜=俯瞰视角,使用纸张=停一手
  world.afterEvents.itemUse.subscribe((event) => {
    const roomId = runtime.roomIdFromDimension(event.source.dimension.id);
    if (roomId === undefined) return;
    const state = games.get(roomId);
    if (!state || runtime.getPhase(roomId) !== "running") return;
    if (event.itemStack.typeId === SPYGLASS_ID) {
      toggleOverview(event.source, state, getGoConfig());
      return;
    }
    if (event.itemStack.typeId === PASS_ITEM_ID) {
      handlePass(runtime, roomId, event.source);
    }
  });
}

// ================= 俯瞰视角(望远镜切换) =================

const SPYGLASS_ID = "minecraft:spyglass";
const OVERHEAD_PRESET = "bearcade:go_overhead";

/** 开局发放锁定在物品栏的望远镜(槽位锁定,可用不可丢) */
function giveSpyglass(player: Player): void {
  try {
    const spyglass = new ItemStack(SPYGLASS_ID, 1);
    spyglass.lockMode = ItemLockMode.slot;
    player
      .getComponent(EntityComponentTypes.Inventory)
      ?.container?.addItem(spyglass);
  } catch (error) {
    console.warn("[Bearcade Go] 发放望远镜失败", error);
  }
}

/** 回收玩家身上的对局物品(望远镜/纸张,对局重置时清理) */
function removeGameItems(player: Player): void {
  try {
    const container = player.getComponent(EntityComponentTypes.Inventory)
      ?.container;
    if (!container) return;
    for (let slot = 0; slot < container.size; slot++) {
      const item = container.getItem(slot);
      if (
        item &&
        (item.typeId === SPYGLASS_ID || item.typeId === PASS_ITEM_ID)
      ) {
        container.setItem(slot, undefined);
      }
    }
  } catch {
    // 忽略
  }
}

// ================= 停一手(纸张) =================

const PASS_ITEM_ID = "minecraft:paper";

/** 开局发放锁定在物品栏的纸张(槽位锁定,使用=停一手,仅当前回合玩家有效) */
function givePassItem(player: Player): void {
  try {
    const pass = new ItemStack(PASS_ITEM_ID, 1);
    pass.lockMode = ItemLockMode.slot;
    player
      .getComponent(EntityComponentTypes.Inventory)
      ?.container?.addItem(pass);
  } catch (error) {
    console.warn("[Bearcade Go] 发放纸张(停一手)失败", error);
  }
}

/** 切换俯瞰视角:开启时摄像机置于棋盘正上方,再次使用望远镜恢复 */
function toggleOverview(
  player: Player,
  state: GoState,
  cfg: GoConfig,
): void {
  if (state.overview.has(player.id)) {
    state.overview.delete(player.id);
    try {
      player.camera.clear();
    } catch (error) {
      console.warn("[Bearcade Go] 恢复视角失败", error);
    }
    player.sendMessage("§7已恢复普通视角");
    return;
  }
  const center = (cfg.gridMin + cfg.gridMax) / 2;
  try {
    player.camera.setCamera(OVERHEAD_PRESET, {
      location: {
        x: center,
        y: cfg.boardY + 1 + cfg.overviewHeight,
        z: center,
      },
      rotation: { x: 90, y: 0 },
    });
    state.overview.add(player.id);
    player.sendMessage(
      `§a俯瞰视角(高度 ${cfg.overviewHeight} 格),再次使用望远镜恢复`,
    );
  } catch (error) {
    player.sendMessage("§c俯瞰视角切换失败");
    console.warn("[Bearcade Go] 俯瞰视角设置失败", error);
  }
}
