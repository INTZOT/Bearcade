// ============================================================
// Go(围棋)小游戏配置
// 19×19 棋盘,双方各 60 分钟局时,黑贴 5.5 目。
// ============================================================
export const GAME_ID = "go";
export const DISPLAY_NAME = "围棋";
export const PACK_ID = "eaf0da19-91f3-46e6-9f09-2b036c3c7f7c";
export const IPC_CHANNEL = "bearcade:ipc";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";

export const ROOM_COUNT = 8;
export const MAX_PLAYERS = 2;

// ===== 模板坐标(19×19 棋盘 ±9,+1 边距) =====
export const TEMPLATE_FROM = { x: -10, y: -64, z: -10 };
export const TEMPLATE_TO = { x: 10, y: 319, z: 10 };
export const ROOM_COPY_ORIGIN = { x: -10, y: -64, z: -10 };
export const PREP_SPAWN = { x: 0, y: 0, z: 0 };
export const TICKING_FROM = { x: -10, y: -1, z: -10 };
export const TICKING_TO = { x: 10, y: 65, z: 10 };
export const STRUCTURE_ID = "bearcade:go_room";

// ===== 棋盘玩法配置 =====
export const BOARD_Y = 63; // 棋盘方块所在 y(棋子位于 BOARD_Y + 1 = 64)
export const GRID_MIN = -9;
export const GRID_MAX = 9; // 19×19
export const STONE_BLACK = "bearcade:go_black_stone";
export const STONE_WHITE = "bearcade:go_white_stone";
export const START_POS_BLACK = { x: 0, y: 65, z: -1 };
export const START_POS_WHITE = { x: 0, y: 65, z: 1 };

export const TEMPLATE_SPAWN = { x: 0, y: 100, z: 0 };

// ===== 规则常量 =====
/** 黑贴目(目) */
export const GO_KOMI = 5.5;
/** 每方局时(tick):60 分钟 = 72000 tick */
export const CLOCK_TICKS = 60 * 60 * 20;

// ===== 运行时可配置项(供 /bearcade:config 修改,持久化优先) =====
export interface GoConfig {
  prepSpawn: { x: number; y: number; z: number };
  boardY: number;
  gridMin: number;
  gridMax: number;
  blackStart: { x: number; y: number; z: number };
  whiteStart: { x: number; y: number; z: number };
  komi: number;
  clockTicks: number;
}

export const GO_CONFIG_DEFAULTS: GoConfig = {
  prepSpawn: PREP_SPAWN,
  boardY: BOARD_Y,
  gridMin: GRID_MIN,
  gridMax: GRID_MAX,
  blackStart: START_POS_BLACK,
  whiteStart: START_POS_WHITE,
  komi: GO_KOMI,
  clockTicks: CLOCK_TICKS,
};
