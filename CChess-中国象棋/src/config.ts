// ============================================================
// CChess(中国象棋)小游戏配置
// 9 列 × 10 行棋盘,红先黑后,吃帅/将即胜;
// 俯瞰视角复用 Go 模式(望远镜切换,右键=玩家所在格操作)。
// ============================================================
export const GAME_ID = "cchess";
export const DISPLAY_NAME = "中国象棋";
export const PACK_ID = "fc9ae3e0-6996-4083-8c57-ec24fdaff4dd";
export const IPC_CHANNEL = "bearcade:ipc";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";

export const ROOM_COUNT = 8;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 2;
export const PARTY_AVAILABLE = false;

// ===== 场地坐标(模板建好后按实际校准) =====
export const TEMPLATE_FROM = { x: -7, y: -64, z: -7 };
export const TEMPLATE_TO = { x: 7, y: 319, z: 7 };
export const ROOM_COPY_ORIGIN = { x: -7, y: -64, z: -7 };
export const PREP_SPAWN = { x: 0, y: 0, z: 0 };
export const TICKING_FROM = { x: -7, y: -1, z: -7 };
export const TICKING_TO = { x: 7, y: 65, z: 7 };
export const STRUCTURE_ID = "bearcade:cchess_room";
export const TEMPLATE_SPAWN = { x: 0, y: 100, z: 0 };

// ===== 棋盘(9 列 × 10 行)=====
export const BOARD_Y = 63; // 棋盘方块所在 y(棋子位于 boardY + 1)
export const GRID_MIN_X = 0;
export const GRID_MAX_X = 8; // 9 列
export const GRID_MIN_Z = 0;
export const GRID_MAX_Z = 9; // 10 行
export const COLS = GRID_MAX_X - GRID_MIN_X + 1; // 9
export const ROWS = GRID_MAX_Z - GRID_MIN_Z + 1; // 10

// 红方在 z 大侧(GRID_MAX_Z),黑方在 z 小侧(GRID_MIN_Z)
export const RED_SIDE_Z = GRID_MAX_Z;
export const BLACK_SIDE_Z = GRID_MIN_Z;

// ===== 棋子方块 ID =====
export const PIECES = {
  red_shuai: "bearcade:cchess_red_shuai", // 帅
  red_shi: "bearcade:cchess_red_shi", // 仕
  red_xiang: "bearcade:cchess_red_xiang", // 相
  red_ma: "bearcade:cchess_red_ma", // 马
  red_ju: "bearcade:cchess_red_ju", // 车
  red_pao: "bearcade:cchess_red_pao", // 炮
  red_bing: "bearcade:cchess_red_bing", // 兵
  black_jiang: "bearcade:cchess_black_jiang", // 将
  black_shi: "bearcade:cchess_black_shi", // 士
  black_xiang: "bearcade:cchess_black_xiang", // 象
  black_ma: "bearcade:cchess_black_ma", // 马
  black_ju: "bearcade:cchess_black_ju", // 车
  black_pao: "bearcade:cchess_black_pao", // 炮
  black_zu: "bearcade:cchess_black_zu", // 卒
} as const;

export type PieceType = keyof typeof PIECES;

/** 默认初始布局(标准摆法):board[row][col],值=棋子类型或 null */
export function defaultLayout(): (PieceType | null)[][] {
  const board: (PieceType | null)[][] = Array.from({ length: ROWS }, () =>
    Array<PieceType | null>(COLS).fill(null),
  );
  const put = (row: number, col: number, piece: PieceType): void => {
    board[row][col] = piece;
  };
  // 黑方(下方 z=0 行):将 士 象 马 车 炮 卒
  put(0, 0, "black_ju"); put(0, 1, "black_ma"); put(0, 2, "black_xiang");
  put(0, 3, "black_shi"); put(0, 4, "black_jiang"); put(0, 5, "black_shi");
  put(0, 6, "black_xiang"); put(0, 7, "black_ma"); put(0, 8, "black_ju");
  put(2, 1, "black_pao"); put(2, 7, "black_pao");
  put(3, 0, "black_zu"); put(3, 2, "black_zu"); put(3, 4, "black_zu");
  put(3, 6, "black_zu"); put(3, 8, "black_zu");
  // 红方(上方 z=9 行):帅 仕 相 马 车 炮 兵
  put(9, 0, "red_ju"); put(9, 1, "red_ma"); put(9, 2, "red_xiang");
  put(9, 3, "red_shi"); put(9, 4, "red_shuai"); put(9, 5, "red_shi");
  put(9, 6, "red_xiang"); put(9, 7, "red_ma"); put(9, 8, "red_ju");
  put(7, 1, "red_pao"); put(7, 7, "red_pao");
  put(6, 0, "red_bing"); put(6, 2, "red_bing"); put(6, 4, "red_bing");
  put(6, 6, "red_bing"); put(6, 8, "red_bing");
  return board;
}

// ===== 物品与槽位 =====
export const OPERATE_ITEM = "minecraft:stick"; // 操作木棍(第 1 格,右键=脚下格操作)
export const SPYGLASS_ITEM = "minecraft:spyglass"; // 俯瞰切换(第 8 格)
export const RESIGN_ITEM = "minecraft:book"; // 认输(第 9 格)
export const DRAW_ITEM = "minecraft:glass_bottle"; // 求和(第 7 格)
export const SLOT_OPERATE = 0;
export const SLOT_SPYGLASS = 7;
export const SLOT_RESIGN = 8;
export const SLOT_DRAW = 6;

// ===== 俯瞰(复用 Go 模式) =====
export const OVERHEAD_PRESET = "minecraft:free";
export const OVERVIEW_TAG = "bearcade_cchess_overview";
export const AIM_ASSIST_PRESET = "bearcade:cchess_overview";
export const AIM_ASSIST_CATEGORY = "bearcade:cchess_board";
export const CHESS_PIECE_IDS = Object.values(PIECES);

// ===== 运行时可配置项 =====
export interface CChessConfig {
  prepSpawn: { x: number; y: number; z: number };
  boardY: number;
  gridMinX: number;
  gridMaxX: number;
  gridMinZ: number;
  gridMaxZ: number;
  redStart: { x: number; y: number; z: number };
  blackStart: { x: number; y: number; z: number };
  overviewHeight: number;
  clockTicks: number; // 每方局时(tick),超时判负
}

export const CCHESS_CONFIG_DEFAULTS: CChessConfig = {
  prepSpawn: PREP_SPAWN,
  boardY: BOARD_Y,
  gridMinX: GRID_MIN_X,
  gridMaxX: GRID_MAX_X,
  gridMinZ: GRID_MIN_Z,
  gridMaxZ: GRID_MAX_Z,
  redStart: { x: 4, y: 65, z: 7 },
  blackStart: { x: 4, y: 65, z: 2 },
  overviewHeight: 24,
  clockTicks: 10 * 60 * 20, // 默认每方 10 分钟
};
