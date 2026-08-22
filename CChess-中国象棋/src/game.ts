// ============================================================
// CChess(中国象棋)玩法实现
// 9×10 棋盘,红先黑后,吃帅/将即胜;禁送将/将帅照面;
// 操作木棍右键=玩家所在格选中/走子(itemUse 驱动,与 Go 落子同构),
// 粒子高亮合法走法;望远镜俯瞰、book 认输、玻璃瓶求和(对方确认)。
// ============================================================
import {
  system,
  world,
  GameMode,
  ItemStack,
  ItemLockMode,
  EntityComponentTypes,
  type Dimension,
  type Player,
} from "@minecraft/server";
import { MessageFormData } from "@minecraft/server-ui";
import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { getCChessConfig, openCChessConfig } from "./cchess-config";
import {
  COLS,
  defaultLayout,
  DRAW_ITEM,
  OPERATE_ITEM,
  OVERHEAD_PRESET,
  OVERVIEW_TAG,
  PIECES,
  RESIGN_ITEM,
  ROWS,
  SLOT_DRAW,
  SLOT_OPERATE,
  SLOT_RESIGN,
  SLOT_SPYGLASS,
  SPYGLASS_ITEM,
  type PieceType,
} from "./config";

type Color = "red" | "black";

interface CChessState {
  /** board[row][col],row=z 行、col=x 列 */
  board: (PieceType | null)[][];
  turn: Color;
  players: { red?: string; black?: string };
  selected: { row: number; col: number } | null;
  overview: Set<string>;
  clocks: Record<Color, number>;
  /** 求和提议方(等待对方确认) */
  drawProposer?: Color;
}

const games = new Map<number, CChessState>();

const PIECE_NAMES: Record<PieceType, string> = {
  red_shuai: "帅", red_shi: "仕", red_xiang: "相", red_ma: "马",
  red_ju: "车", red_pao: "炮", red_bing: "兵",
  black_jiang: "将", black_shi: "士", black_xiang: "象", black_ma: "马",
  black_ju: "车", black_pao: "炮", black_zu: "卒",
};

function colorOf(piece: PieceType): Color {
  return piece.startsWith("red") ? "red" : "black";
}

function pieceId(piece: PieceType): string {
  return PIECES[piece];
}

function inBoard(row: number, col: number): boolean {
  return row >= 0 && row < ROWS && col >= 0 && col < COLS;
}

function inPalace(row: number, col: number, color: Color): boolean {
  return (
    col >= 3 &&
    col <= 5 &&
    (color === "red" ? row >= 7 && row <= 9 : row >= 0 && row <= 2)
  );
}

/** 是否过河(红方过河=进入黑方半场 row<=4;黑方=row>=5) */
function crossedRiver(row: number, color: Color): boolean {
  return color === "red" ? row <= 4 : row >= 5;
}

/** 棋子伪走法(不含吃己方、不含送将/照面检查) */
function pseudoMoves(
  board: (PieceType | null)[][],
  row: number,
  col: number,
): { row: number; col: number }[] {
  const piece = board[row][col];
  if (!piece) return [];
  const color = colorOf(piece);
  const moves: { row: number; col: number }[] = [];
  const push = (r: number, c: number): void => {
    if (inBoard(r, c) && board[r][c]?.startsWith(color) !== true) {
      moves.push({ row: r, col: c });
    }
  };
  const name = piece.replace(/^(red|black)_/, "");
  switch (name) {
    case "shuai":
    case "jiang": {
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const r = row + dr, c = col + dc;
        if (inPalace(r, c, color)) push(r, c);
      }
      break;
    }
    case "shi": {
      for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const r = row + dr, c = col + dc;
        if (inPalace(r, c, color)) push(r, c);
      }
      break;
    }
    case "xiang": {
      // 相/象:田字,塞相眼,不过河(目标与起点均须在己方半场)
      for (const [dr, dc] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
        const r = row + dr, c = col + dc;
        const eye = board[row + dr / 2]?.[col + dc / 2];
        if (
          inBoard(r, c) &&
          (color === "red" ? r >= 5 : r <= 4) &&
          !eye
        ) {
          push(r, c);
        }
      }
      break;
    }
    case "ma": {
      for (const [dr, dc] of [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]]) {
        if (Number.isInteger(row + dr / 2)) {
          if (!board[row + dr / 2]?.[col]) push(row + dr, col + dc);
        } else if (!board[row]?.[col + dc / 2]) {
          push(row + dr, col + dc);
        }
      }
      break;
    }
    case "ju": {
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let r = row + dr, c = col + dc;
        while (inBoard(r, c)) {
          const target = board[r][c];
          if (target) {
            if (colorOf(target) !== color) push(r, c);
            break;
          }
          push(r, c);
          r += dr;
          c += dc;
        }
      }
      break;
    }
    case "pao": {
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let r = row + dr, c = col + dc;
        let jumped = false;
        while (inBoard(r, c)) {
          const target = board[r][c];
          if (!jumped) {
            if (target) {
              jumped = true;
            } else {
              push(r, c);
            }
          } else if (target) {
            if (colorOf(target) !== color) push(r, c);
            break;
          }
          r += dr;
          c += dc;
        }
      }
      break;
    }
    case "bing":
    case "zu": {
      const forward = color === "red" ? -1 : 1;
      push(row + forward, col);
      if (crossedRiver(row, color)) {
        push(row, col - 1);
        push(row, col + 1);
      }
      break;
    }
  }
  return moves;
}

/** 模拟走子后的棋盘副本 */
function afterMove(
  board: (PieceType | null)[][],
  from: { row: number; col: number },
  to: { row: number; col: number },
): (PieceType | null)[][] {
  const next = board.map((r) => [...r]);
  next[to.row][to.col] = next[from.row][from.col];
  next[from.row][from.col] = null;
  return next;
}

/** (row,col) 是否被 color 方任意棋子攻击 */
function isAttacked(
  board: (PieceType | null)[][],
  row: number,
  col: number,
  byColor: Color,
): boolean {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const piece = board[r][c];
      if (!piece || colorOf(piece) !== byColor) continue;
      if (
        pseudoMoves(board, r, c).some((m) => m.row === row && m.col === col)
      ) {
        return true;
      }
    }
  }
  return false;
}

/** 帅将是否照面(同列且中间无子) */
function kingsFacing(board: (PieceType | null)[][]): boolean {
  let redRow = -1;
  let blackRow = -1;
  let col = -1;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c] === "red_shuai") {
        redRow = r;
        col = c;
      }
      if (board[r][c] === "black_jiang") blackRow = r;
    }
  }
  if (redRow === -1 || blackRow === -1 || col === -1) return false;
  // 同列且两帅之间无子
  if (board[blackRow][col] !== "black_jiang") return false;
  const lo = Math.min(redRow, blackRow) + 1;
  const hi = Math.max(redRow, blackRow) - 1;
  for (let r = lo; r <= hi; r++) {
    if (board[r][col]) return false;
  }
  return true;
}

/** 合法走子(含禁送将/照面) */
function canMove(
  board: (PieceType | null)[][],
  from: { row: number; col: number },
  to: { row: number; col: number },
  color: Color,
): boolean {
  const piece = board[from.row][from.col];
  if (!piece || colorOf(piece) !== color) return false;
  if (
    !pseudoMoves(board, from.row, from.col).some(
      (m) => m.row === to.row && m.col === to.col,
    )
  ) {
    return false;
  }
  const next = afterMove(board, from, to);
  const ownGeneral = color === "red" ? "red_shuai" : "black_jiang";
  let gr = -1;
  let gc = -1;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (next[r][c] === ownGeneral) {
        gr = r;
        gc = c;
      }
    }
  }
  if (gr === -1) return false;
  if (isAttacked(next, gr, gc, color === "red" ? "black" : "red")) return false;
  if (kingsFacing(next)) return false;
  return true;
}

/** 某棋子的全部合法走法(高亮用) */
function legalMoves(
  board: (PieceType | null)[][],
  row: number,
  col: number,
  color: Color,
): { row: number; col: number; capture: boolean }[] {
  return pseudoMoves(board, row, col)
    .filter((m) => canMove(board, { row, col }, m, color))
    .map((m) => ({ ...m, capture: board[m.row][m.col] !== null }));
}

// ================= 棋谱 =================

function columnNum(col: number, color: Color): number {
  return color === "red" ? COLS - col : col + 1;
}

/** 传统记谱,如 兵三进一 / 车二平五 / 马八进七;返回 null 表示无法记谱 */
function notation(
  board: (PieceType | null)[][],
  from: { row: number; col: number },
  to: { row: number; col: number },
  piece: PieceType,
): string | null {
  const color = colorOf(piece);
  const name = PIECE_NAMES[piece];
  const colFrom = columnNum(from.col, color);
  const colTo = columnNum(to.col, color);
  // 同列同名棋子 >1 时加 前/后(红方前=行小,黑方前=行大)
  let prefix = "";
  const sameCol: number[] = [];
  for (let r = 0; r < ROWS; r++) {
    if (board[r][from.col] === piece) sameCol.push(r);
  }
  if (sameCol.length > 1) {
    const isFront =
      color === "red" ? from.row < sameCol[1] : from.row > sameCol[0];
    prefix = isFront ? "前" : "后";
  }
  const dz = to.row - from.row;
  const dx = to.col - from.col;
  const straight = ["shuai", "jiang", "ju", "pao", "bing", "zu"].includes(
    piece.replace(/^(red|black)_/, ""),
  );
  let movePart: string;
  if (dz === 0 && dx !== 0) {
    movePart = `平${colTo}`;
  } else if (straight) {
    const isForward = color === "red" ? dz < 0 : dz > 0;
    movePart = `${isForward ? "进" : "退"}${Math.abs(dz)}`;
  } else {
    // 斜走(马/相/仕):进/退 + 目标列号
    const isForward = color === "red" ? dz < 0 : dz > 0;
    movePart = `${isForward ? "进" : "退"}${colTo}`;
  }
  const captured = board[to.row][to.col];
  const capturePart = captured ? `,吃${PIECE_NAMES[captured]}` : "";
  return `${prefix}${name}${colFrom}${movePart}${capturePart}`;
}

// ================= 粒子高亮 =================

/** 沿格子四条边撒粒子画框(俯瞰脚下格提示用) */
function spawnCellFrame(
  dim: Dimension,
  col: number,
  row: number,
  y: number,
  effect: string,
): void {
  try {
    const gx = col;
    const gz = row;
    for (let t = 0; t <= 1.0001; t += 0.25) {
      dim.spawnParticle(effect, { x: gx + t, y, z: gz });
      dim.spawnParticle(effect, { x: gx + t, y, z: gz + 1 });
      dim.spawnParticle(effect, { x: gx, y, z: gz + t });
      dim.spawnParticle(effect, { x: gx + 1, y, z: gz + t });
    }
  } catch {
    // 忽略
  }
}

/** 格子中心撒粒子(棋子可走位置标记用) */
let markerParticleWarned = false;
function spawnCellCenter(
  dim: Dimension,
  col: number,
  row: number,
  y: number,
  effect: string,
): void {
  try {
    for (let i = 0; i < 4; i++) {
      dim.spawnParticle(effect, {
        x: col + 0.35 + Math.random() * 0.3,
        y: y + Math.random() * 0.15,
        z: row + 0.35 + Math.random() * 0.3,
      });
    }
  } catch (error) {
    if (!markerParticleWarned) {
      markerParticleWarned = true;
      console.warn(`[Bearcade CChess] 走法标记粒子无效: ${effect}`, error);
    }
  }
}

/** 选中高亮(格子中心粒子,可走/可吃统一)+ 俯瞰脚下格提示(仅俯瞰,四边框) */
function spawnMarkers(
  runtime: MinigameRuntime,
  roomId: number,
  state: CChessState,
): void {
  const cfg = getCChessConfig();
  const dim = runtime.roomDim(roomId);
  const y = cfg.boardY + 1 + 0.6; // 统一高度,高于棋子模型顶部
  if (state.selected) {
    for (const m of legalMoves(
      state.board,
      state.selected.row,
      state.selected.col,
      state.turn,
    )) {
      spawnCellCenter(dim, m.col, m.row, y, "minecraft:balloon_gas_particle");
    }
  }
  // 玩家脚下格提示:仅俯瞰视角生效
  for (const id of state.overview) {
    const player = runtime
      .roomPlayers(roomId)
      .find((p) => p !== undefined && p.id === id);
    if (!player) continue;
    const row = Math.floor(player.location.z) - cfg.gridMinZ;
    const col = Math.floor(player.location.x) - cfg.gridMinX;
    if (!inBoard(row, col)) continue;
    spawnCellFrame(dim, col, row, cfg.boardY + 1 + 0.1, "minecraft:balloon_gas_particle");
  }
}

// ================= 俯瞰 =================

function giveItem(player: Player, slot: number, itemId: string): void {
  try {
    const item = new ItemStack(itemId, 1);
    item.lockMode = ItemLockMode.slot;
    player
      .getComponent(EntityComponentTypes.Inventory)
      ?.container?.setItem(slot, item);
  } catch {
    // 忽略
  }
}

function removeGameItems(player: Player): void {
  try {
    const container = player.getComponent(EntityComponentTypes.Inventory)
      ?.container;
    if (!container) return;
    for (let slot = 0; slot < container.size; slot++) {
      const item = container.getItem(slot);
      if (
        item &&
        (item.typeId === OPERATE_ITEM ||
          item.typeId === SPYGLASS_ITEM ||
          item.typeId === RESIGN_ITEM ||
          item.typeId === DRAW_ITEM)
      ) {
        container.setItem(slot, undefined);
      }
    }
  } catch {
    // 忽略
  }
}

/** 开启相机相对控制(与 Go 完全一致:临时 tag + 维度命令) */
function setOverheadControls(player: Player): void {
  try {
    player.addTag(OVERVIEW_TAG);
    player.dimension.runCommand(
      `controlscheme @a[tag=${OVERVIEW_TAG}] set camera_relative`,
    );
  } catch {
    // 忽略
  } finally {
    player.removeTag(OVERVIEW_TAG);
  }
}

/** 清除相机控制方案(与 Go 完全一致) */
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

function toggleOverview(
  state: CChessState,
  player: Player,
): void {
  const cfg = getCChessConfig();
  if (state.overview.has(player.id)) {
    state.overview.delete(player.id);
    exitOverviewState(player);
    player.sendMessage("§7已恢复普通视角");
    return;
  }
  const cx = (cfg.gridMinX + cfg.gridMaxX) / 2;
  const cz = (cfg.gridMinZ + cfg.gridMaxZ) / 2;
  try {
    // 相机 yaw 跟随玩家本体朝向(玩家按 W 永远朝画面顶部走,方向不颠倒);
    // 双方进俯瞰时面朝棋盘中心,自然形成"自己在下"的红黑视角差异
    player.camera.setCamera(OVERHEAD_PRESET, {
      location: { x: cx, y: cfg.boardY + 1 + cfg.overviewHeight, z: cz },
      rotation: { x: 90, y: player.getRotation().y },
    });
    setOverheadControls(player);
    // 锁 60 视野(相机作用域,退出时自动还原)——与 Go 俯瞰一致
    try {
      player.camera.setFov({ fov: 60 });
    } catch {
      // 忽略
    }
    state.overview.add(player.id);
    player.sendMessage(
      `§a俯瞰视角(高度 ${cfg.overviewHeight} 格):右键木棍=瞄准格操作;望远镜右键=切换视角`,
    );
  } catch (error) {
    player.sendMessage("§c俯瞰视角切换失败");
    console.warn("[Bearcade CChess] 俯瞰视角设置失败", error);
  }
}

function exitOverviewState(player: Player): void {
  clearOverheadControls(player);
  try {
    player.camera.clear();
  } catch {
    // 忽略
  }
}

/** 俯瞰相机 yaw 跟随玩家本体朝向(每 2 tick 同步,移动转向时画面跟转) */
function syncOverviewCamera(
  runtime: MinigameRuntime,
  roomId: number,
  state: CChessState,
): void {
  const cfg = getCChessConfig();
  const cx = (cfg.gridMinX + cfg.gridMaxX) / 2;
  const cz = (cfg.gridMinZ + cfg.gridMaxZ) / 2;
  for (const id of state.overview) {
    const player = runtime
      .roomPlayers(roomId)
      .find((p) => p !== undefined && p.id === id);
    if (!player) continue;
    try {
      player.camera.setCamera(OVERHEAD_PRESET, {
        location: {
          x: cx,
          y: cfg.boardY + 1 + cfg.overviewHeight,
          z: cz,
        },
        rotation: { x: 90, y: player.getRotation().y },
      });
    } catch {
      // 忽略
    }
  }
}

// ================= 交互(选中/走子) =================

/**
 * 木棍操作目标格:俯瞰下=玩家所在格(floor,与 Go 落子同构);
 * 普通视角=视线瞄准的方块(脚本射线,不依赖 interact 事件)。
 */
function operateCell(
  cfg: ReturnType<typeof getCChessConfig>,
  player: Player,
  overview: boolean,
): { row: number; col: number } | null {
  let x: number;
  let z: number;
  if (overview) {
    x = Math.floor(player.location.x);
    z = Math.floor(player.location.z);
  } else {
    const hit = player.getBlockFromViewDirection({ maxDistance: 10 });
    if (!hit) return null;
    x = hit.block.location.x;
    z = hit.block.location.z;
  }
  const col = x - cfg.gridMinX;
  const row = z - cfg.gridMinZ;
  return inBoard(row, col) ? { row, col } : null;
}

function handleInteract(
  runtime: MinigameRuntime,
  roomId: number,
  state: CChessState,
  player: Player,
  cell: { row: number; col: number },
): void {
  const piece = state.board[cell.row][cell.col];
  const color = state.players.red === player.id ? "red" : "black";
  if (state.turn !== color) {
    player.sendMessage("§c还没轮到你走棋");
    return;
  }
  if (state.selected) {
    const sel = state.selected;
    if (cell.row === sel.row && cell.col === sel.col) {
      state.selected = null;
      player.sendMessage("§7已取消选中");
      return;
    }
    if (piece && colorOf(piece) === color) {
      state.selected = cell;
      player.sendMessage(`§a选中 ${PIECE_NAMES[piece]}`);
      return;
    }
    if (!canMove(state.board, sel, cell, color)) {
      player.sendMessage("§c非法走法,请重新选择目标格");
      return;
    }
    applyMove(runtime, roomId, state, sel, cell);
    return;
  }
  if (!piece || colorOf(piece) !== color) {
    player.sendMessage("§c请选中你的棋子(右键木棍,普通视角需瞄准棋子格)");
    return;
  }
  state.selected = cell;
  player.sendMessage(`§a选中 ${PIECE_NAMES[piece]}`);
}

function applyMove(
  runtime: MinigameRuntime,
  roomId: number,
  state: CChessState,
  from: { row: number; col: number },
  to: { row: number; col: number },
): void {
  const cfg = getCChessConfig();
  const piece = state.board[from.row][from.col]!;
  const color = colorOf(piece);
  const captured = state.board[to.row][to.col];
  const moveText =
    notation(state.board, from, to, piece) ??
    `${PIECE_NAMES[piece]} 移动`;
  // 先落库再播报(notation 依赖走子前棋盘)
  state.board[to.row][to.col] = piece;
  state.board[from.row][from.col] = null;
  state.selected = null;
  // 世界同步
  const dim = runtime.roomDim(roomId);
  const stoneY = cfg.boardY + 1;
  const gx = (c: number) => c + cfg.gridMinX;
  const gz = (r: number) => r + cfg.gridMinZ;
  system.run(() => {
    try {
      dim.setBlockType(
        { x: gx(from.col), y: stoneY, z: gz(from.row) },
        "minecraft:air",
      );
      dim.setBlockType(
        { x: gx(to.col), y: stoneY, z: gz(to.row) },
        pieceId(piece),
      );
    } catch (error) {
      console.warn("[Bearcade CChess] 走子写方块失败", error);
    }
  });
  runtime.announce(roomId, `§e${moveText}`);
  // 吃帅/将 → 胜
  if (captured === "red_shuai" || captured === "black_jiang") {
    runtime.announce(
      roomId,
      `§e${PIECE_NAMES[captured]}被吃,${color === "red" ? "红方" : "黑方"}获胜!`,
    );
    runtime.endGame(
      roomId,
      "将死",
      `§b${color === "red" ? "红方" : "黑方"}获胜`,
    );
    return;
  }
  // 将军检测(对手帅/将是否被攻击)
  const next: Color = state.turn === "red" ? "black" : "red";
  const general = next === "red" ? "red_shuai" : "black_jiang";
  let gr = -1;
  let gc = -1;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (state.board[r][c] === general) {
        gr = r;
        gc = c;
      }
    }
  }
  if (gr >= 0 && isAttacked(state.board, gr, gc, color)) {
    runtime.announce(roomId, "§c将军!");
  }
  state.turn = next;
  giveTurn(runtime, roomId, state);
}

function giveTurn(
  runtime: MinigameRuntime,
  roomId: number,
  state: CChessState,
): void {
  const next = state.turn;
  const player = runtime
    .roomPlayers(roomId)
    .find((p) => p !== undefined && p.id === state.players[next]);
  if (!player) {
    runtime.endGame(
      roomId,
      "对手已离开",
      `§b${next === "red" ? "黑方" : "红方"}获胜`,
    );
    return;
  }
  player.sendMessage(`§a轮到你走棋(${next === "red" ? "红方" : "黑方"})`);
}

// ================= 认输 / 求和 / 计时 =================

function handleResign(
  runtime: MinigameRuntime,
  roomId: number,
  state: CChessState,
  player: Player,
): void {
  const color = state.players.red === player.id ? "red" : "black";
  runtime.announce(roomId, `§c${color === "red" ? "红方" : "黑方"}认输!`);
  runtime.endGame(
    roomId,
    "认输",
    `§b${color === "red" ? "黑方" : "红方"}获胜`,
  );
}

function handleDrawOffer(
  runtime: MinigameRuntime,
  roomId: number,
  state: CChessState,
  player: Player,
): void {
  const color = state.players.red === player.id ? "red" : "black";
  if (state.drawProposer) {
    player.sendMessage("§c已有求和提议在等待确认");
    return;
  }
  state.drawProposer = color;
  const opponent = runtime
    .roomPlayers(roomId)
    .find(
      (p) =>
        p !== undefined &&
        p.id === state.players[color === "red" ? "black" : "red"],
    );
  runtime.announce(roomId, `§e${color === "red" ? "红方" : "黑方"}提出求和`);
  if (!opponent) {
    state.drawProposer = undefined;
    return;
  }
  const form = new MessageFormData()
    .title("求和")
    .body(`${color === "red" ? "红方" : "黑方"}提出和棋,是否同意?`)
    .button1("§a同意和棋")
    .button2("§7拒绝");
  form
    .show(opponent)
    .then((response) => {
      if (games.get(roomId) !== state) return;
      if (response.selection === 0) {
        runtime.endGame(roomId, "和棋", "§e双方同意和棋");
      } else {
        state.drawProposer = undefined;
        runtime.announce(roomId, "§e对方拒绝和棋,对局继续");
      }
    })
    .catch(() => {
      if (games.get(roomId) === state) state.drawProposer = undefined;
    });
}

// ================= 钩子 =================

export function makeCchessHooks(
  getRuntime: () => MinigameRuntime,
): MinigameHooks {
  return {
    onGameStart(roomId, players) {
      const runtime = getRuntime();
      const cfg = getCChessConfig();
      const redIsFirst = Math.random() < 0.5;
      const red = redIsFirst ? players[0] : players[1];
      const black = redIsFirst ? players[1] : players[0];
      const state: CChessState = {
        board: defaultLayout(),
        turn: "red",
        players: { red: red.id, black: black.id },
        selected: null,
        overview: new Set(),
        clocks: { red: cfg.clockTicks, black: cfg.clockTicks },
      };
      games.set(roomId, state);
      for (const player of players) {
        player.setGameMode(GameMode.Survival);
      }
      runtime.teleportPlayer(roomId, red, cfg.redStart);
      runtime.teleportPlayer(roomId, black, cfg.blackStart);
      for (const player of [red, black]) {
        giveItem(player, SLOT_OPERATE, OPERATE_ITEM);
        giveItem(player, SLOT_SPYGLASS, SPYGLASS_ITEM);
        giveItem(player, SLOT_RESIGN, RESIGN_ITEM);
        giveItem(player, SLOT_DRAW, DRAW_ITEM);
      }
      runtime.announce(
        roomId,
        `§a对局开始!红方:${red.name} / 黑方:${black.name},红先;走到目标格后右键木棍=选中/走子`,
      );
      giveTurn(runtime, roomId, state);
    },
    onBeforeReset(roomId) {
      const runtime = getRuntime();
      for (const player of runtime.roomPlayers(roomId)) {
        if (player === undefined) continue;
        try {
          player.setGameMode(GameMode.Adventure);
        } catch {
          // 忽略
        }
        exitOverviewState(player);
        removeGameItems(player);
      }
      games.delete(roomId);
    },
    canPlace() {
      // 死场景:禁止一切放置
      return false;
    },
    openConfig(player) {
      openCChessConfig(player, getRuntime());
    },
  };
}

// ================= 初始化 =================

export function initCChess(getRuntime: () => MinigameRuntime): void {
  const runtime = getRuntime();

  // 计时轮询(1s):当前玩家减时,超时判负;求和确认期间暂停
  system.runInterval(() => {
    for (const [roomId, state] of [...games.entries()]) {
      try {
        if (runtime.getPhase(roomId) !== "running") continue;
        if (state.drawProposer) continue;
        state.clocks[state.turn] -= 10;
        if (state.clocks[state.turn] <= 0) {
          runtime.announce(
            roomId,
            `§c${state.turn === "red" ? "红方" : "黑方"}超时!`,
          );
          runtime.endGame(
            roomId,
            "超时",
            `§b${state.turn === "red" ? "黑方" : "红方"}获胜`,
          );
        }
      } catch (error) {
        console.warn(`[Bearcade CChess] 计时异常 room=${roomId}`, error);
      }
    }
  }, 20);

  // 选中高亮 + 俯瞰脚下格粒子(0.25s)
  system.runInterval(() => {
    for (const [roomId, state] of [...games.entries()]) {
      try {
        if (runtime.getPhase(roomId) !== "running") continue;
        spawnMarkers(runtime, roomId, state);
      } catch (error) {
        console.warn(`[Bearcade CChess] 高亮异常 room=${roomId}`, error);
      }
    }
  }, 5);

  // 俯瞰相机 yaw 跟随玩家本体朝向(2 tick 同步)
  system.runInterval(() => {
    for (const [roomId, state] of [...games.entries()]) {
      try {
        if (runtime.getPhase(roomId) !== "running") continue;
        syncOverviewCamera(runtime, roomId, state);
      } catch (error) {
        console.warn(`[Bearcade CChess] 俯瞰相机同步异常 room=${roomId}`, error);
      }
    }
  }, 2);

  // 物品:木棍=唯一操作通道(普通=瞄准方块,俯瞰=玩家所在格);望远镜=切换;book=认输;玻璃瓶=求和
  world.afterEvents.itemUse.subscribe((event) => {
    const roomId = runtime.roomIdFromDimension(event.source.dimension.id);
    if (roomId === undefined) return;
    const state = games.get(roomId);
    if (!state || runtime.getPhase(roomId) !== "running") return;
    const player = event.source;
    if (event.itemStack.typeId === OPERATE_ITEM) {
      // itemUse 驱动(对空右键也触发);空手不处理
      const overview = state.overview.has(player.id);
      const cell = operateCell(getCChessConfig(), player, overview);
      if (!cell) {
        player.sendMessage(
          overview ? "§c请站到棋盘格上操作" : "§c请瞄准棋盘格操作",
        );
        return;
      }
      handleInteract(runtime, roomId, state, player, cell);
      return;
    }
    if (event.itemStack.typeId === SPYGLASS_ITEM) {
      toggleOverview(state, player);
      return;
    }
    if (event.itemStack.typeId === RESIGN_ITEM) {
      handleResign(runtime, roomId, state, player);
      return;
    }
    if (event.itemStack.typeId === DRAW_ITEM) {
      handleDrawOffer(runtime, roomId, state, player);
    }
  });

  // 离房:当前持棋玩家离开=认输;俯瞰清理
  world.afterEvents.playerDimensionChange.subscribe((event) => {
    const roomId = runtime.roomIdFromDimension(event.fromDimension.id);
    if (roomId === undefined) return;
    const state = games.get(roomId);
    if (!state) return;
    if (state.overview.has(event.player.id)) {
      exitOverviewState(event.player);
    }
    if (state.players[state.turn] === event.player.id) {
      const color = state.turn;
      runtime.announce(roomId, `§c${event.player.name} 离开,视为认输!`);
      runtime.endGame(
        roomId,
        "认输",
        `§b${color === "red" ? "黑方" : "红方"}获胜`,
      );
    }
  });
}
