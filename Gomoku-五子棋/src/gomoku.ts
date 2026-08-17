import {
  system,
  world,
  ItemStack,
  GameMode,
  ItemLockMode,
  AimAssistCategorySettings,
  AimAssistPresetSettings,
  AimAssistTargetMode,
  EntityComponentTypes,
  type EntityInventoryComponent,
  type Dimension,
  type Player,
  type PlayerPlaceBlockBeforeEvent,
} from "@minecraft/server";
import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import {
  clearHudTitle,
  hudMessage,
  setHudTitle,
} from "../../shared/minigame-core/scoreboardHud";
import { getGomokuConfig, openGomokuConfig } from "./gomoku-config";
import {
  STONE_BLACK,
  STONE_WHITE,
  type GomokuConfig,
} from "./config";

type Cell = "black" | "white" | null;
type Color = "black" | "white";

interface GomokuState {
  board: Cell[][];
  turn: Color;
  players: { black?: string; white?: string };
  /** 处于俯瞰视角(望远镜切换)中的玩家 */
  overview: Set<string>;
}

const games = new Map<number, GomokuState>();

function gridSize(): number {
  const cfg = getGomokuConfig();
  return cfg.gridMax - cfg.gridMin + 1;
}

function emptyBoard(): Cell[][] {
  const size = gridSize();
  return Array.from({ length: size }, () =>
    Array<Cell>(size).fill(null),
  );
}

function inGrid(x: number, z: number): boolean {
  const cfg = getGomokuConfig();
  return (
    x >= cfg.gridMin &&
    x <= cfg.gridMax &&
    z >= cfg.gridMin &&
    z <= cfg.gridMax
  );
}

function inventoryOf(player: Player): EntityInventoryComponent | undefined {
  return player.getComponent(
    EntityComponentTypes.Inventory,
  ) as EntityInventoryComponent | undefined;
}

function clearTokens(runtime: MinigameRuntime, roomId: number): void {
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

function refreshHud(
  runtime: MinigameRuntime,
  roomId: number,
  state: GomokuState,
): void {
  for (const roomPlayer of runtime.roomPlayers(roomId)) {
    const turnColor = state.turn;
    const myTurn = state.players[turnColor] === roomPlayer.id;
    setHudTitle(
      roomPlayer,
      hudMessage([
        { text: "§e五子棋§r" },
        { text: "\n" },
        {
          text: myTurn
            ? `§a轮到你落子 · ${turnColor === "black" ? "黑方" : "白方"}`
            : `§7等待对方落子 · ${turnColor === "black" ? "黑方" : "白方"}`,
        },
      ]),
      6000,
    );
  }
}

function giveTurn(
  runtime: MinigameRuntime,
  roomId: number,
  player: Player,
  color: Color,
): void {
  clearTokens(runtime, roomId);
  const container = inventoryOf(player)?.container;
  if (container) {
    // 背包满时先移除一个非棋子杂物腾出空格,保证棋子能放入(对局中其他物品无意义)
    if (container.emptySlotsCount === 0) {
      for (let slot = 0; slot < container.size; slot++) {
        const item = container.getItem(slot);
        if (item && item.typeId !== STONE_BLACK && item.typeId !== STONE_WHITE) {
          container.setItem(slot, undefined);
          break;
        }
      }
    }
    container.addItem(
      new ItemStack(color === "black" ? STONE_BLACK : STONE_WHITE, 1),
    );
  }
  const name = color === "black" ? "黑" : "白";
  player.sendMessage(`§a轮到你落子(${name}方)`);
  const state = games.get(roomId);
  if (state) refreshHud(runtime, roomId, state);
}

function checkWin(
  board: Cell[][],
  cx: number,
  cz: number,
  color: Color,
): boolean {
  const directions = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  const size = gridSize();
  for (const [dx, dz] of directions) {
    let count = 1;
    for (const sign of [-1, 1]) {
      let nx = cx + dx * sign;
      let nz = cz + dz * sign;
      while (
        nx >= 0 &&
        nx < size &&
        nz >= 0 &&
        nz < size &&
        board[nx][nz] === color
      ) {
        count++;
        nx += dx * sign;
        nz += dz * sign;
      }
    }
    if (count >= 5) return true;
  }
  return false;
}

function isBoardFull(board: Cell[][]): boolean {
  return board.every((row) => row.every((cell) => cell !== null));
}

function handlePlace(
  runtime: MinigameRuntime,
  event: PlayerPlaceBlockBeforeEvent,
  roomId: number,
): boolean {
  const player = event.player;
  if (!runtime.isRunning(roomId)) return false;
  const state = games.get(roomId);
  if (!state) return false;
  const cfg = getGomokuConfig();

  // 俯瞰视角:准星脱离相机(本体视线强制水平),右键落子改为落在玩家脚下最近的交叉点
  // (aim assist 在本版本实测不产生锁定,不承担功能;此处无条件脚本落子)
  if (state.overview.has(player.id)) {
    tryPlaceAtPlayer(runtime, roomId, state, player);
    return false; // 取消引擎放置,由脚本放置
  }

  const { x, y, z } = event.block.location;
  if (y !== cfg.boardY + 1 || !inGrid(x, z)) {
    system.run(() => player.sendMessage("§c棋子只能放在棋盘格上"));
    return false;
  }
  const cx = x - cfg.gridMin;
  const cz = z - cfg.gridMin;
  if (state.board[cx][cz]) {
    system.run(() => player.sendMessage("§c该位置已有棋子"));
    return false;
  }
  if (state.players[state.turn] !== player.id) {
    system.run(() => player.sendMessage("§c还没轮到你落子"));
    return false;
  }

  const color = state.turn;
  const expected = color === "black" ? STONE_BLACK : STONE_WHITE;
  if (event.permutationToPlace.type.id !== expected) {
    system.run(() => player.sendMessage("§c请放置你手中的对应颜色棋子"));
    return false;
  }

  // 校验通过:同步更新棋盘(受限上下文内只改内存),提示/结算延迟到 system.run
  state.board[cx][cz] = color;
  const won = checkWin(state.board, cx, cz, color);
  const full = !won && isBoardFull(state.board);
  state.turn = state.turn === "black" ? "white" : "black";
  const next = state.turn;

  system.run(() => {
    player.sendMessage(
      `§7落子:${color === "black" ? "黑" : "白"} (${x}, ${z})`,
    );
    if (won) {
      runtime.announce(
        roomId,
        `§e${color === "black" ? "黑方" : "白方"}五连,对局结束`,
      );
      runtime.endGame(
        roomId,
        color === "black" ? "黑方获胜" : "白方获胜",
        "§e即将返回大厅…",
      );
      return;
    }
    if (full) {
      runtime.announce(roomId, "§e棋盘已满,平局");
      runtime.endGame(roomId, "平局", "§e即将返回大厅…");
      return;
    }
    const nextPlayer = runtime
      .roomPlayers(roomId)
      .find((p) => p.id === state.players[next]);
    if (nextPlayer) giveTurn(runtime, roomId, nextPlayer, next);
    runtime.announce(
      roomId,
      `轮到${next === "black" ? "黑方" : "白方"}落子`,
    );
  });
  return true;
}

/** 俯瞰视角落子:忽略引擎瞄准位置,在玩家脚下最近的交叉点落子(取消引擎放置,脚本放置) */
function placeAtPlayer(
  runtime: MinigameRuntime,
  roomId: number,
  state: GomokuState,
  player: Player,
): boolean {
  const cfg = getGomokuConfig();
  // 玩家站在格心时 location 为 整数+0.5,Math.round 会进位到相邻格 → 用 floor 取"脚底所在格子"
  const gx = Math.floor(player.location.x);
  const gz = Math.floor(player.location.z);
  if (!inGrid(gx, gz)) {
    system.run(() => player.sendMessage("§c俯瞰落子:请站到棋盘格上方"));
    return false;
  }
  const cx = gx - cfg.gridMin;
  const cz = gz - cfg.gridMin;
  if (state.board[cx][cz]) {
    system.run(() => player.sendMessage("§c该位置已有棋子"));
    return false;
  }
  if (state.players[state.turn] !== player.id) {
    system.run(() => player.sendMessage("§c还没轮到你落子"));
    return false;
  }
  const color = state.turn;
  const stoneType = color === "black" ? STONE_BLACK : STONE_WHITE;
  if (countStone(player, stoneType) < 1) {
    system.run(() => player.sendMessage("§c请手持对应颜色棋子再右键"));
    return false;
  }

  // 提交状态(与正常落子一致)
  state.board[cx][cz] = color;
  const won = checkWin(state.board, cx, cz, color);
  const full = !won && isBoardFull(state.board);
  state.turn = state.turn === "black" ? "white" : "black";
  const next = state.turn;

  // 世界同步 + 消耗棋子 + 提示/结算(取消引擎放置,需脚本放置)
  system.run(() => {
    try {
      runtime
        .roomDim(roomId)
        .setBlockType({ x: gx, y: cfg.boardY + 1, z: gz }, stoneType);
    } catch (error) {
      console.warn("[Bearcade Gomoku] 俯瞰落子写方块失败", error);
    }
    consumeStone(player, stoneType);
    player.sendMessage(`§7俯瞰落子:${color === "black" ? "黑" : "白"} (${gx}, ${gz})`);
    if (won) {
      runtime.announce(
        roomId,
        `§e${color === "black" ? "黑方" : "白方"}五连,对局结束`,
      );
      runtime.endGame(
        roomId,
        color === "black" ? "黑方获胜" : "白方获胜",
        "§e即将返回大厅…",
      );
      return;
    }
    if (full) {
      runtime.announce(roomId, "§e棋盘已满,平局");
      runtime.endGame(roomId, "平局", "§e即将返回大厅…");
      return;
    }
    const nextPlayer = runtime
      .roomPlayers(roomId)
      .find((p) => p.id === state.players[next]);
    if (nextPlayer) giveTurn(runtime, roomId, nextPlayer, next);
    runtime.announce(
      roomId,
      `轮到${next === "black" ? "黑方" : "白方"}落子`,
    );
  });
  return false;
}

/** 消耗玩家手中的一颗棋子(引擎取消放置后手动扣减) */
function consumeStone(player: Player, stoneType: string): void {
  try {
    const container = inventoryOf(player)?.container;
    if (!container) return;
    for (let slot = 0; slot < container.size; slot++) {
      const item = container.getItem(slot);
      if (item?.typeId === stoneType) {
        if (item.amount > 1) {
          item.amount -= 1;
          container.setItem(slot, item);
        } else {
          container.setItem(slot, undefined);
        }
        return;
      }
    }
  } catch {
    // 忽略
  }
}

/** 玩家背包中某类棋子数量 */
function countStone(player: Player, stoneType: string): number {
  const container = inventoryOf(player)?.container;
  if (!container) return 0;
  let n = 0;
  for (let slot = 0; slot < container.size; slot++) {
    const item = container.getItem(slot);
    if (item?.typeId === stoneType) n += item.amount;
  }
  return n;
}

export function makeGomokuHooks(
  getRuntime: () => MinigameRuntime,
): MinigameHooks {
  return {
    onGameStart(roomId, players) {
      const runtime = getRuntime();
      const cfg = getGomokuConfig();
      // 随机决定黑/白方
      const blackIsFirst = Math.random() < 0.5;
      const black = blackIsFirst ? players[0] : players[1];
      const white = blackIsFirst ? players[1] : players[0];
      games.set(roomId, {
        board: emptyBoard(),
        turn: "black",
        players: { black: black.id, white: white.id },
        overview: new Set(),
      });
      // 生存模式才能放置棋子方块落子(放置合法性由 canPlace 钩子控制);
      // 玩家从大厅(冒险)进入,必须显式切换
      black.setGameMode(GameMode.Survival);
      white.setGameMode(GameMode.Survival);
      // 发放望远镜(槽位锁定,用于切换俯瞰视角)
      giveSpyglass(black);
      giveSpyglass(white);
      runtime.teleportPlayer(roomId, black, cfg.blackStart);
      runtime.teleportPlayer(roomId, white, cfg.whiteStart);
      runtime.announce(
        roomId,
        `§a对局开始!黑方:${black.name} / 白方:${white.name},放置棋子落子`,
      );
      refreshHud(runtime, roomId, games.get(roomId)!);
      giveTurn(runtime, roomId, black, "black");
    },
    onBeforeReset(roomId) {
      const runtime = getRuntime();
      for (const player of runtime.roomPlayers(roomId)) {
        clearHudTitle(player);
      }
      // 恢复冒险模式(回大厅后 Core 也会兜底初始化)
      for (const player of runtime.roomPlayers(roomId)) {
        if (player !== undefined) {
          try {
            player.setGameMode(GameMode.Adventure);
          } catch {
            // 忽略
          }
          exitOverviewState(player);
          removeSpyglass(player);
        }
      }
      clearTokens(runtime, roomId);
      games.delete(roomId);
    },
    canPlace(event, roomId) {
      return handlePlace(getRuntime(), event, roomId);
    },
    openConfig(player) {
      openGomokuConfig(player, getRuntime());
    },
  };
}

// ================= 俯瞰视角(望远镜切换) =================

const SPYGLASS_ID = "minecraft:spyglass";
/** 原生自由相机预设(无自定义预设,避免预设加载问题) */
const OVERHEAD_PRESET = "minecraft:free";
/** 执行 /controlscheme 时给玩家打的临时 tag(命令层无 @s 源) */
const OVERVIEW_TAG = "bearcade_overview";
/** aim assist 预设/类别(启动时经 world.aimAssist 注册,只锁定棋盘/棋子方块) */
const AIM_ASSIST_PRESET = "bearcade:gomoku_overview";
const AIM_ASSIST_CATEGORY = "bearcade:gomoku_board";
/** 俯瞰落子去重:同一 tick 内多个事件源(canPlace/itemUse/itemStartUseOn)只落一次 */
const lastOverviewPlaceTick = new Map<string, number>();

/** 开局发放锁定在物品栏的望远镜(槽位锁定,可用不可丢) */
function giveSpyglass(player: Player): void {
  try {
    const spyglass = new ItemStack(SPYGLASS_ID, 1);
    spyglass.lockMode = ItemLockMode.slot;
    player
      .getComponent(EntityComponentTypes.Inventory)
      ?.container?.addItem(spyglass);
  } catch (error) {
    console.warn("[Bearcade Gomoku] 发放望远镜失败", error);
  }
}

/** 回收玩家身上的望远镜(对局重置时清理) */
function removeSpyglass(player: Player): void {
  try {
    const container = player.getComponent(EntityComponentTypes.Inventory)
      ?.container;
    if (!container) return;
    for (let slot = 0; slot < container.size; slot++) {
      const item = container.getItem(slot);
      if (item?.typeId === SPYGLASS_ID) container.setItem(slot, undefined);
    }
  } catch {
    // 忽略
  }
}

/** 切换俯瞰视角:开启时摄像机置于棋盘正上方,再次使用望远镜恢复 */
function toggleOverview(
  player: Player,
  state: GomokuState,
  cfg: GomokuConfig,
): void {
  if (state.overview.has(player.id)) {
    state.overview.delete(player.id);
    exitOverviewState(player);
    player.sendMessage("§7已恢复普通视角");
    return;
  }
  const center = (cfg.gridMin + cfg.gridMax) / 2;
  try {
    // 原生 free 预设 + 定位/俯视(依赖世界作弊,与 /camera 命令相同)
    player.camera.setCamera(OVERHEAD_PRESET, {
      location: {
        x: center,
        y: cfg.boardY + 1 + cfg.overviewHeight,
        z: center,
      },
      rotation: { x: 90, y: 0 },
    });
    setOverheadControls(player);
    setOverviewAimAssist(player);
    state.overview.add(player.id);
    player.sendMessage(
      `§a俯瞰视角(高度 ${cfg.overviewHeight} 格,右键=在脚下落子),再次使用望远镜恢复`,
    );
  } catch (error) {
    player.sendMessage("§c俯瞰视角切换失败");
    console.warn("[Bearcade Gomoku] 俯瞰视角设置失败", error);
  }
}

/** 退出俯瞰状态:清除 aim assist + 控制方案与相机(幂等) */
function exitOverviewState(player: Player): void {
  clearOverviewAimAssist(player);
  clearOverheadControls(player);
  try {
    player.camera.clear();
  } catch (error) {
    console.warn("[Bearcade Gomoku] 恢复视角失败", error);
  }
}

/** 激活 aim assist:仅作视觉辅助(本版本实测不产生锁定框,不承担落子功能) */
function setOverviewAimAssist(player: Player): void {
  try {
    player.getAimAssist().set({
      presetId: AIM_ASSIST_PRESET,
      distance: 16,
      viewAngle: { x: 90, y: 90 },
      targetMode: AimAssistTargetMode.Distance,
    });
    console.warn(
      "[Bearcade Gomoku] aim assist 已激活",
      player.getAimAssist().settings?.presetId ?? "?",
    );
  } catch (error) {
    console.warn("[Bearcade Gomoku] aim assist 设置失败(需实验/作弊?)", error);
  }
}

/** 关闭 aim assist(传空参数即禁用) */
function clearOverviewAimAssist(player: Player): void {
  try {
    player.getAimAssist().set();
  } catch {
    // 忽略
  }
}

/** 开启相机相对控制(鼠标/摇杆以相机自身为轴转动,适合俯视) */
function setOverheadControls(player: Player): void {
  try {
    player.addTag(OVERVIEW_TAG);
    const result = player.dimension.runCommand(
      `controlscheme @a[tag=${OVERVIEW_TAG}] set camera_relative`,
    );
    if (result.successCount < 1) {
      console.warn("[Bearcade Gomoku] controlscheme 设置失败(需世界作弊?)");
    }
  } catch (error) {
    console.warn("[Bearcade Gomoku] controlscheme 设置异常", error);
  } finally {
    player.removeTag(OVERVIEW_TAG);
  }
}

/** 清除相机控制方案(恢复默认视角控制) */
function clearOverheadControls(player: Player): void {
  try {
    player.addTag(OVERVIEW_TAG);
    player.dimension.runCommand(
      `controlscheme @a[tag=${OVERVIEW_TAG}] clear`,
    );
  } catch {
    // 忽略
  } finally {
    player.removeTag(OVERVIEW_TAG);
  }
}

/** 俯瞰落子统一入口:同一 tick 内多个事件源(canPlace/itemUse/itemUseOn)只落一次 */
function tryPlaceAtPlayer(
  runtime: MinigameRuntime,
  roomId: number,
  state: GomokuState,
  player: Player,
): void {
  const last = lastOverviewPlaceTick.get(player.id) ?? -100;
  if (system.currentTick - last < 2) return;
  if (placeAtPlayer(runtime, roomId, state, player)) {
    lastOverviewPlaceTick.set(player.id, system.currentTick);
  }
}

/** 是否为棋子方块物品 */
function isStone(typeId: string): boolean {
  return typeId === STONE_BLACK || typeId === STONE_WHITE;
}

/** 沿格子四条边按间距撒粒子,画出一个正方形框 */
function spawnCellFrame(
  dim: Dimension,
  gx: number,
  gz: number,
  y: number,
  effect: string,
): void {
  try {
    for (let t = 0; t <= 1.0001; t += 0.2) {
      dim.spawnParticle(effect, { x: gx + t, y, z: gz });
      dim.spawnParticle(effect, { x: gx + t, y, z: gz + 1 });
      dim.spawnParticle(effect, { x: gx, y, z: gz + t });
      dim.spawnParticle(effect, { x: gx + 1, y, z: gz + t });
    }
  } catch {
    // 忽略
  }
}

/** 俯瞰选中格提示:每 0.25s 在玩家脚下格上表面画白色正方形框(与落子同一取格语义) */
function spawnOverviewMarker(
  runtime: MinigameRuntime,
  roomId: number,
  state: GomokuState,
): void {
  const cfg = getGomokuConfig();
  const dim = runtime.roomDim(roomId);
  const y = cfg.boardY + 1 + 0.1;
  for (const id of state.overview) {
    const player = runtime
      .roomPlayers(roomId)
      .find((p) => p !== undefined && p.id === id);
    if (!player) continue;
    const gx = Math.floor(player.location.x);
    const gz = Math.floor(player.location.z);
    if (!inGrid(gx, gz)) continue;
    spawnCellFrame(dim, gx, gz, y, "minecraft:endrod");
  }
}

/** 注册俯瞰 aim assist 预设:只锁定棋盘/棋子方块(其余优先级 0) */
function registerOverviewAimAssist(): void {
  try {
    const registry = world.getAimAssist();
    if (registry.getPreset(AIM_ASSIST_PRESET)) return; // 已注册(防重复)
    const categorySettings = new AimAssistCategorySettings(
      AIM_ASSIST_CATEGORY,
    );
    categorySettings.defaultBlockPriority = 0;
    categorySettings.defaultEntityPriority = 0;
    categorySettings.setBlockPriorities({
      "bearcade:chestboard_blank": 10,
      "bearcade:chestboard_center": 10,
      "bearcade:chestboard_center_point": 10,
      "bearcade:chestboard_side": 10,
      "bearcade:chestboard_corner": 10,
      "bearcade:black_stone": 10,
      "bearcade:white_stone": 10,
    });
    categorySettings.setEntityPriorities({});
    registry.addCategory(categorySettings);
    const presetSettings = new AimAssistPresetSettings(AIM_ASSIST_PRESET);
    presetSettings.defaultItemSettings = AIM_ASSIST_CATEGORY;
    presetSettings.handSettings = AIM_ASSIST_CATEGORY;
    presetSettings.setItemSettings({});
    registry.addPreset(presetSettings);
    console.warn(
      "[Bearcade Gomoku] aim assist 预设已注册",
      registry.getPreset(AIM_ASSIST_PRESET)?.identifier ?? "?",
    );
  } catch (error) {
    console.warn("[Bearcade Gomoku] aim assist 预设注册失败", error);
  }
}

/** 初始化俯瞰视角:望远镜切换 + 手持棋子 use=在脚下落子(仅对局运行中响应) */
export function initGomoku(getRuntime: () => MinigameRuntime): void {
  const runtime = getRuntime();
  registerOverviewAimAssist();

  // 俯瞰选中格粒子提示(0.25s 轮询,跟随玩家脚下格)
  system.runInterval(() => {
    for (const [roomId, state] of [...games.entries()]) {
      try {
        if (runtime.getPhase(roomId) !== "running") continue;
        spawnOverviewMarker(runtime, roomId, state);
      } catch (error) {
        console.warn(`[Bearcade Gomoku] 俯瞰标记异常 room=${roomId}`, error);
      }
    }
  }, 5);

  // 手持棋子使用(use):与望远镜同一事件源;俯瞰中命中 → 在玩家脚下落子
  world.afterEvents.itemUse.subscribe((event) => {
    const roomId = runtime.roomIdFromDimension(event.source.dimension.id);
    if (roomId === undefined) return;
    const state = games.get(roomId);
    if (!state || runtime.getPhase(roomId) !== "running") return;
    const player = event.source;
    if (event.itemStack.typeId === SPYGLASS_ID) {
      toggleOverview(player, state, getGomokuConfig());
      return;
    }
    if (isStone(event.itemStack.typeId)) {
      if (state.overview.has(player.id)) {
        console.warn("[Bearcade Gomoku] [diag] itemUse stone in overview");
        tryPlaceAtPlayer(runtime, roomId, state, player);
      }
      return;
    }
  });

  // 右键点在方块上(start use on):俯瞰中持棋子点任何方块 → 同样视为脚下落子
  world.afterEvents.itemStartUseOn.subscribe((event) => {
    if (!event.itemStack || !isStone(event.itemStack.typeId)) return;
    const roomId = runtime.roomIdFromDimension(event.source.dimension.id);
    if (roomId === undefined) return;
    const state = games.get(roomId);
    if (!state || runtime.getPhase(roomId) !== "running") return;
    if (!state.overview.has(event.source.id)) return;
    console.warn("[Bearcade Gomoku] [diag] itemStartUseOn stone in overview");
    tryPlaceAtPlayer(runtime, roomId, state, event.source);
  });

  // 离房清理:俯瞰状态中途离开(对局结束/断线)也要清除相机与控制方案
  world.afterEvents.playerDimensionChange.subscribe((event) => {
    for (const state of games.values()) {
      if (state.overview.has(event.player.id)) {
        exitOverviewState(event.player);
        return;
      }
    }
  });
}
