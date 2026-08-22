// ============================================================
// CChess(涓浗璞℃)鐜╂硶瀹炵幇
// 9脳10 妫嬬洏,绾㈠厛榛戝悗,鍚冨竻/灏嗗嵆鑳?绂侀€佸皢/灏嗗竻鐓ч潰;
// 鎿嶄綔鏈ㄦ鍙抽敭=鐜╁鎵€鍦ㄦ牸閫変腑/璧板瓙(itemUse 椹卞姩,涓?Go 钀藉瓙鍚屾瀯),
// 绮掑瓙楂樹寒鍚堟硶璧版硶;鏈涜繙闀滀刊鐬般€乥ook 璁よ緭銆佺幓鐠冪摱姹傚拰(瀵规柟纭)銆?
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
  SLOT_COMPASS,
  COMPASS_ITEM,
  type PieceType,
} from "./config";

type Color = "red" | "black";

interface CChessState {
  /** board[row][col],row=z 琛屻€乧ol=x 鍒?*/
  board: (PieceType | null)[][];
  turn: Color;
  players: { red?: string; black?: string };
  selected: { row: number; col: number } | null;
  overview: Set<string>;
  clocks: Record<Color, number>;
  /** 姹傚拰鎻愯鏂?绛夊緟瀵规柟纭) */
  drawProposer?: Color;
}

const games = new Map<number, CChessState>();

const PIECE_NAMES: Record<PieceType, string> = {
  red_shuai: "甯?, red_shi: "浠?, red_xiang: "鐩?, red_ma: "椹?,
  red_ju: "杞?, red_pao: "鐐?, red_bing: "鍏?,
  black_jiang: "灏?, black_shi: "澹?, black_xiang: "璞?, black_ma: "椹?,
  black_ju: "杞?, black_pao: "鐐?, black_zu: "鍗?,
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

/** 鏄惁杩囨渤(绾㈡柟杩囨渤=杩涘叆榛戞柟鍗婂満 row<=4;榛戞柟=row>=5) */
function crossedRiver(row: number, color: Color): boolean {
  return color === "red" ? row <= 4 : row >= 5;
}

/** 妫嬪瓙浼蛋娉?涓嶅惈鍚冨繁鏂广€佷笉鍚€佸皢/鐓ч潰妫€鏌? */
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
      // 鐩?璞?鐢板瓧,濉炵浉鐪?涓嶈繃娌?鐩爣涓庤捣鐐瑰潎椤诲湪宸辨柟鍗婂満)
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

/** 妯℃嫙璧板瓙鍚庣殑妫嬬洏鍓湰 */
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

/** (row,col) 鏄惁琚?color 鏂逛换鎰忔瀛愭敾鍑?*/
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

/** 甯呭皢鏄惁鐓ч潰(鍚屽垪涓斾腑闂存棤瀛? */
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
  // 鍚屽垪涓斾袱甯呬箣闂存棤瀛?
  if (board[blackRow][col] !== "black_jiang") return false;
  const lo = Math.min(redRow, blackRow) + 1;
  const hi = Math.max(redRow, blackRow) - 1;
  for (let r = lo; r <= hi; r++) {
    if (board[r][col]) return false;
  }
  return true;
}

/** 鍚堟硶璧板瓙(鍚閫佸皢/鐓ч潰) */
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

/** 鏌愭瀛愮殑鍏ㄩ儴鍚堟硶璧版硶(楂樹寒鐢? */
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

// ================= 妫嬭氨 =================

function columnNum(col: number, color: Color): number {
  return color === "red" ? COLS - col : col + 1;
}

/** 浼犵粺璁拌氨,濡?鍏典笁杩涗竴 / 杞︿簩骞充簲 / 椹叓杩涗竷;杩斿洖 null 琛ㄧず鏃犳硶璁拌氨 */
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
  // 鍚屽垪鍚屽悕妫嬪瓙 >1 鏃跺姞 鍓?鍚?绾㈡柟鍓?琛屽皬,榛戞柟鍓?琛屽ぇ)
  let prefix = "";
  const sameCol: number[] = [];
  for (let r = 0; r < ROWS; r++) {
    if (board[r][from.col] === piece) sameCol.push(r);
  }
  if (sameCol.length > 1) {
    const isFront =
      color === "red" ? from.row < sameCol[1] : from.row > sameCol[0];
    prefix = isFront ? "鍓? : "鍚?;
  }
  const dz = to.row - from.row;
  const dx = to.col - from.col;
  const straight = ["shuai", "jiang", "ju", "pao", "bing", "zu"].includes(
    piece.replace(/^(red|black)_/, ""),
  );
  let movePart: string;
  if (dz === 0 && dx !== 0) {
    movePart = `骞?{colTo}`;
  } else if (straight) {
    const isForward = color === "red" ? dz < 0 : dz > 0;
    movePart = `${isForward ? "杩? : "閫€"}${Math.abs(dz)}`;
  } else {
    // 鏂滆蛋(椹?鐩?浠?:杩?閫€ + 鐩爣鍒楀彿
    const isForward = color === "red" ? dz < 0 : dz > 0;
    movePart = `${isForward ? "杩? : "閫€"}${colTo}`;
  }
  const captured = board[to.row][to.col];
  const capturePart = captured ? `,鍚?{PIECE_NAMES[captured]}` : "";
  return `${prefix}${name}${colFrom}${movePart}${capturePart}`;
}

// ================= 绮掑瓙楂樹寒 =================

/** 娌挎牸瀛愬洓鏉¤竟鎾掔矑瀛愮敾妗?淇灠鑴氫笅鏍兼彁绀虹敤) */
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
    // 蹇界暐
  }
}

/** 閫変腑楂樹寒(鍙惤鐐瑰洓杈规,villager_happy)+ 淇灠鑴氫笅鏍兼彁绀?浠呬刊鐬?鍥涜竟妗? */
function spawnMarkers(
  runtime: MinigameRuntime,
  roomId: number,
  state: CChessState,
): void {
  const cfg = getCChessConfig();
  const dim = runtime.roomDim(roomId);
  const y = cfg.boardY + 1 + 0.1; // 璐存澘闈㈤珮搴?涓庤剼涓嬫牸鎻愮ず涓€鑷?
  if (state.selected) {
    for (const m of legalMoves(
      state.board,
      state.selected.row,
      state.selected.col,
      state.turn,
    )) {
      spawnCellFrame(dim, m.col, m.row, y, "minecraft:villager_happy");
    }
  }
  // 鐜╁鑴氫笅鏍兼彁绀?浠呬刊鐬拌瑙掔敓鏁?
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

// ================= 淇灠 =================

function giveItem(player: Player, slot: number, itemId: string): void {
  try {
    const item = new ItemStack(itemId, 1);
    item.lockMode = ItemLockMode.slot;
    player
      .getComponent(EntityComponentTypes.Inventory)
      ?.container?.setItem(slot, item);
  } catch {
    // 蹇界暐
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
          item.typeId === COMPASS_ITEM ||
          item.typeId === RESIGN_ITEM ||
          item.typeId === DRAW_ITEM)
      ) {
        container.setItem(slot, undefined);
      }
    }
  } catch {
    // 蹇界暐
  }
}

/** 寮€鍚帶鍒舵柟妗?涓存椂 tag + 缁村害鍛戒护;player_relative_strafe:绉诲姩鐩稿鐩告満鏂瑰悜,瑙ｅ喅绾㈡柟 180掳 鍙嶅悜) */
function setOverheadControls(player: Player): void {
  try {
    player.addTag(OVERVIEW_TAG);
    player.dimension.runCommand(
      `controlscheme @a[tag=${OVERVIEW_TAG}] set player_relative_strafe`,
    );
  } catch {
    // 蹇界暐
  } finally {
    player.removeTag(OVERVIEW_TAG);
  }
}

/** 娓呴櫎鐩告満鎺у埗鏂规(涓?Go 瀹屽叏涓€鑷? */
function clearOverheadControls(player: Player): void {
  try {
    player.addTag(OVERVIEW_TAG);
    player.dimension.runCommand(
      `controlscheme @a[tag=${OVERVIEW_TAG}] clear`,
    );
  } catch {
    // 蹇界暐
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
    player.sendMessage("搂7宸叉仮澶嶆櫘閫氳瑙?);
    return;
  }
  const cx = (cfg.gridMinX + cfg.gridMaxX) / 2;
  const cz = (cfg.gridMinZ + cfg.gridMaxZ) / 2;
  try {
    // 淇灠鐩告満:榛戞柟 yaw 0,绾㈡柟鏃嬭浆 180掳
    const color: Color = state.players.red === player.id ? "red" : "black";
    player.camera.setCamera(OVERHEAD_PRESET, {
      location: { x: cx, y: cfg.boardY + 1 + cfg.overviewHeight, z: cz },
      rotation: { x: 90, y: color === "red" ? 180 : 0 },
    });
    setOverheadControls(player);
    // 閿?60 瑙嗛噹(鐩告満浣滅敤鍩?閫€鍑烘椂鑷姩杩樺師)鈥斺€斾笌 Go 淇灠涓€鑷?
    try {
      player.camera.setFov({ fov: 60 });
    } catch {
      // 蹇界暐
    }
    state.overview.add(player.id);
    player.sendMessage(
      `搂a淇灠瑙嗚(楂樺害 ${cfg.overviewHeight} 鏍?:鍙抽敭鏈ㄦ=鐬勫噯鏍兼搷浣?鏈涜繙闀滃彸閿?鍒囨崲瑙嗚`,
    );
  } catch (error) {
    player.sendMessage("搂c淇灠瑙嗚鍒囨崲澶辫触");
    console.warn("[Bearcade CChess] 淇灠瑙嗚璁剧疆澶辫触", error);
  }
}

function exitOverviewState(player: Player): void {
  clearOverheadControls(player);
  try {
    player.camera.clear();
  } catch {
    // 蹇界暐
  }
}

// ================= 浜や簰(閫変腑/璧板瓙) =================

/**
 * 鏈ㄦ鎿嶄綔鐩爣鏍?淇灠涓?鐜╁鎵€鍦ㄦ牸(floor,涓?Go 钀藉瓙鍚屾瀯);
 * 鏅€氳瑙?瑙嗙嚎鐬勫噯鐨勬柟鍧?鑴氭湰灏勭嚎,涓嶄緷璧?interact 浜嬩欢)銆?
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
    player.sendMessage("搂c杩樻病杞埌浣犺蛋妫?);
    return;
  }
  if (state.selected) {
    const sel = state.selected;
    if (cell.row === sel.row && cell.col === sel.col) {
      state.selected = null;
      player.sendMessage("搂7宸插彇娑堥€変腑");
      return;
    }
    if (piece && colorOf(piece) === color) {
      state.selected = cell;
      player.sendMessage(`搂a閫変腑 ${PIECE_NAMES[piece]}`);
      return;
    }
    if (!canMove(state.board, sel, cell, color)) {
      player.sendMessage("搂c闈炴硶璧版硶,璇烽噸鏂伴€夋嫨鐩爣鏍?);
      return;
    }
    applyMove(runtime, roomId, state, sel, cell);
    return;
  }
  if (!piece || colorOf(piece) !== color) {
    player.sendMessage("搂c璇烽€変腑浣犵殑妫嬪瓙(鍙抽敭鏈ㄦ,鏅€氳瑙掗渶鐬勫噯妫嬪瓙鏍?");
    return;
  }
  state.selected = cell;
  player.sendMessage(`搂a閫変腑 ${PIECE_NAMES[piece]}`);
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
    `${PIECE_NAMES[piece]} 绉诲姩`;
  // 鍏堣惤搴撳啀鎾姤(notation 渚濊禆璧板瓙鍓嶆鐩?
  state.board[to.row][to.col] = piece;
  state.board[from.row][from.col] = null;
  state.selected = null;
  // 涓栫晫鍚屾
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
      console.warn("[Bearcade CChess] 璧板瓙鍐欐柟鍧楀け璐?, error);
    }
  });
  runtime.announce(roomId, `搂e${moveText}`);
  // 鍚冨竻/灏?鈫?鑳?
  if (captured === "red_shuai" || captured === "black_jiang") {
    runtime.announce(
      roomId,
      `搂e${PIECE_NAMES[captured]}琚悆,${color === "red" ? "绾㈡柟" : "榛戞柟"}鑾疯儨!`,
    );
    runtime.endGame(
      roomId,
      "灏嗘",
      `搂b${color === "red" ? "绾㈡柟" : "榛戞柟"}鑾疯儨`,
    );
    return;
  }
  // 灏嗗啗妫€娴?瀵规墜甯?灏嗘槸鍚﹁鏀诲嚮)
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
    runtime.announce(roomId, "搂c灏嗗啗!");
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
      "瀵规墜宸茬寮€",
      `搂b${next === "red" ? "榛戞柟" : "绾㈡柟"}鑾疯儨`,
    );
    return;
  }
  player.sendMessage(`搂a杞埌浣犺蛋妫?${next === "red" ? "绾㈡柟" : "榛戞柟"})`);
}

// ================= 璁よ緭 / 姹傚拰 / 璁℃椂 =================

function handleResign(
  runtime: MinigameRuntime,
  roomId: number,
  state: CChessState,
  player: Player,
): void {
  const color = state.players.red === player.id ? "red" : "black";
  runtime.announce(roomId, `搂c${color === "red" ? "绾㈡柟" : "榛戞柟"}璁よ緭!`);
  runtime.endGame(
    roomId,
    "璁よ緭",
    `搂b${color === "red" ? "榛戞柟" : "绾㈡柟"}鑾疯儨`,
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
    player.sendMessage("搂c宸叉湁姹傚拰鎻愯鍦ㄧ瓑寰呯‘璁?);
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
  runtime.announce(roomId, `搂e${color === "red" ? "绾㈡柟" : "榛戞柟"}鎻愬嚭姹傚拰`);
  if (!opponent) {
    state.drawProposer = undefined;
    return;
  }
  const form = new MessageFormData()
    .title("姹傚拰")
    .body(`${color === "red" ? "绾㈡柟" : "榛戞柟"}鎻愬嚭鍜屾,鏄惁鍚屾剰?`)
    .button1("搂a鍚屾剰鍜屾")
    .button2("搂7鎷掔粷");
  form
    .show(opponent)
    .then((response) => {
      if (games.get(roomId) !== state) return;
      if (response.selection === 0) {
        runtime.endGame(roomId, "鍜屾", "搂e鍙屾柟鍚屾剰鍜屾");
      } else {
        state.drawProposer = undefined;
        runtime.announce(roomId, "搂e瀵规柟鎷掔粷鍜屾,瀵瑰眬缁х画");
      }
    })
    .catch(() => {
      if (games.get(roomId) === state) state.drawProposer = undefined;
    });
}

// ================= 閽╁瓙 =================

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
        giveItem(player, SLOT_COMPASS, COMPASS_ITEM);
        giveItem(player, SLOT_RESIGN, RESIGN_ITEM);
        giveItem(player, SLOT_DRAW, DRAW_ITEM);
      }
      runtime.announce(
        roomId,
        `搂a瀵瑰眬寮€濮?绾㈡柟:${red.name} / 榛戞柟:${black.name},绾㈠厛;璧板埌鐩爣鏍煎悗鍙抽敭鏈ㄦ=閫変腑/璧板瓙`,
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
          // 蹇界暐
        }
        exitOverviewState(player);
        removeGameItems(player);
      }
      games.delete(roomId);
    },
    canPlace() {
      // 姝诲満鏅?绂佹涓€鍒囨斁缃?
      return false;
    },
    openConfig(player) {
      openCChessConfig(player, getRuntime());
    },
  };
}

// ================= 鍒濆鍖?=================

export function initCChess(getRuntime: () => MinigameRuntime): void {
  const runtime = getRuntime();

  // 璁℃椂杞(1s):褰撳墠鐜╁鍑忔椂,瓒呮椂鍒よ礋;姹傚拰纭鏈熼棿鏆傚仠
  system.runInterval(() => {
    for (const [roomId, state] of [...games.entries()]) {
      try {
        if (runtime.getPhase(roomId) !== "running") continue;
        if (state.drawProposer) continue;
        state.clocks[state.turn] -= 10;
        if (state.clocks[state.turn] <= 0) {
          runtime.announce(
            roomId,
            `搂c${state.turn === "red" ? "绾㈡柟" : "榛戞柟"}瓒呮椂!`,
          );
          runtime.endGame(
            roomId,
            "瓒呮椂",
            `搂b${state.turn === "red" ? "榛戞柟" : "绾㈡柟"}鑾疯儨`,
          );
        }
      } catch (error) {
        console.warn(`[Bearcade CChess] 璁℃椂寮傚父 room=${roomId}`, error);
      }
    }
  }, 20);

  // 閫変腑楂樹寒 + 淇灠鑴氫笅鏍肩矑瀛?0.25s)
  system.runInterval(() => {
    for (const [roomId, state] of [...games.entries()]) {
      try {
        if (runtime.getPhase(roomId) !== "running") continue;
        spawnMarkers(runtime, roomId, state);
      } catch (error) {
        console.warn(`[Bearcade CChess] 楂樹寒寮傚父 room=${roomId}`, error);
      }
    }
  }, 5);

  // 鐗╁搧:鏈ㄦ=鍞竴鎿嶄綔閫氶亾(鏅€?鐬勫噯鏂瑰潡,淇灠=鐜╁鎵€鍦ㄦ牸);鏈涜繙闀?鍒囨崲;book=璁よ緭;鐜荤拑鐡?姹傚拰
  world.afterEvents.itemUse.subscribe((event) => {
    const roomId = runtime.roomIdFromDimension(event.source.dimension.id);
    if (roomId === undefined) return;
    const state = games.get(roomId);
    if (!state || runtime.getPhase(roomId) !== "running") return;
    const player = event.source;
    if (event.itemStack.typeId === OPERATE_ITEM) {
      // itemUse 椹卞姩(瀵圭┖鍙抽敭涔熻Е鍙?;绌烘墜涓嶅鐞?
      const overview = state.overview.has(player.id);
      const cell = operateCell(getCChessConfig(), player, overview);
      if (!cell) {
        player.sendMessage(
          overview ? "搂c璇风珯鍒版鐩樻牸涓婃搷浣? : "搂c璇风瀯鍑嗘鐩樻牸鎿嶄綔",
        );
        return;
      }
      handleInteract(runtime, roomId, state, player, cell);
      return;
    }
    if (event.itemStack.typeId === COMPASS_ITEM) {
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

  // 绂绘埧:褰撳墠鎸佹鐜╁绂诲紑=璁よ緭;淇灠娓呯悊
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
      runtime.announce(roomId, `搂c${event.player.name} 绂诲紑,瑙嗕负璁よ緭!`);
      runtime.endGame(
        roomId,
        "璁よ緭",
        `搂b${color === "red" ? "榛戞柟" : "绾㈡柟"}鑾疯儨`,
      );
    }
  });
}
