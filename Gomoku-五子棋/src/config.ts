export const GAME_ID = "gomoku";
export const DISPLAY_NAME = "五子棋";
export const PACK_ID = "cae46db7-ef95-477a-841c-5c29d38eefe5";
export const IPC_CHANNEL = "bearcade:ipc";
export const ROOM_COUNT = 8;
export const MAX_PLAYERS = 2;
export const LOBBY_DIMENSION_ID = "minecraft:overworld";

// ===== 以下坐标全部由小游戏包开发者配置 =====

// 模板复制起始点/终点:模板维度中场地结构的两个对角坐标(含端点)
// 注意:引擎结构上限为 64×384×64,纵向取满时 from.y = -64、to.y = 319(320 超限 1 格)
// 已从 ±7 扩一圈到 ±8(棋盘仍为 ±7,四周留一圈边)
export const TEMPLATE_FROM = { x: -8, y: -64, z: -8 };
export const TEMPLATE_TO = { x: 8, y: 319, z: 8 };

// 每个房间维度内放置场地的原点坐标(结构 from 角落在该位置)
// 与模板同坐标放置:房间场地位于 y 63~64、准备房间位于 y 0(同模板)
export const ROOM_COPY_ORIGIN = { x: -8, y: -64, z: -8 };

// 准备房间坐标:与游戏场地位于同一房间维度的不同位置(玩家入房后传送到此,随 game.register 上报给 Core)
export const PREP_SPAWN = { x: 0, y: 0, z: 0 };

// 常加载区域:只需覆盖实际内容(准备房间 y0 与场地 y63~64),不要整列 384 层,以节省每包 chunk 上限
export const TICKING_FROM = { x: -8, y: -1, z: -8 };
export const TICKING_TO = { x: 8, y: 65, z: 8 };

export const STRUCTURE_ID = "bearcade:gomoku_room";

// ===== 棋盘玩法配置(开发者可调整) =====
export const BOARD_Y = 63; // 棋盘方块所在 y(玩家放置的棋子位于 BOARD_Y + 1 = 64)
export const GRID_MIN = -7;
export const GRID_MAX = 7; // 15×15 棋盘
export const STONE_BLACK = "minecraft:polished_blackstone_pressure_plate";
export const STONE_WHITE = "minecraft:heavy_weighted_pressure_plate";
export const START_POS_BLACK = { x: 0, y: 65, z: -1 };
export const START_POS_WHITE = { x: 0, y: 65, z: 1 };

export const TEMPLATE_SPAWN = { x: 0, y: 100, z: 0 };

// ===== 运行时可配置项(供 /bearcade:config 修改,持久化优先) =====
export interface GomokuConfig {
  prepSpawn: { x: number; y: number; z: number };
  boardY: number;
  gridMin: number;
  gridMax: number;
  blackStart: { x: number; y: number; z: number };
  whiteStart: { x: number; y: number; z: number };
}

export const GOMOKU_CONFIG_DEFAULTS: GomokuConfig = {
  prepSpawn: PREP_SPAWN,
  boardY: BOARD_Y,
  gridMin: GRID_MIN,
  gridMax: GRID_MAX,
  blackStart: START_POS_BLACK,
  whiteStart: START_POS_WHITE,
};
