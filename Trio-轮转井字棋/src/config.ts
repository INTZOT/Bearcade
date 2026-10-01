// ============================================================
// 轮转井字棋(Trio)配置
// 玩法:3×3 棋盘三连取胜;每方场上最多 3 子,轮到自己时最老的一子
// 轮转出局,并在原格留下"虚化"标记(仅本回合存在,禁止原地复下)。
// ============================================================
export const GAME_ID = "trio";
export const DISPLAY_NAME = "轮转井字棋";
export const PACK_ID = "09fed5ca-d50b-47ad-a1a6-d78a0a228509";
export const IPC_CHANNEL = "bearcade:ipc";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";

// ===== 规模 =====
export const ROOM_COUNT = 2;
export const MAX_PLAYERS = 2;
export const MIN_PLAYERS = 2;
/**
 * 派对模式接口预留:本作是双人棋,"派对带队 + 全服观战"尚未启用。
 * 开启前必须保持 false,否则 Core 会把全服玩家一起塞进同一房间。
 */
export const PARTY_AVAILABLE = false;
/** 观战接口预留:启用后允许第三人进房观战(需同时放宽 MAX_PLAYERS 与 Core 入房校验) */
export const SPECTATE_ENABLED = false;
/** 派对模式下"全服观战"接口预留 */
export const PARTY_SPECTATE_ENABLED = false;

// ===== 场地坐标(模板维度建好场地后可用 /bearcade:tmp sz trio 调整捕获范围) =====
export const TEMPLATE_FROM = { x: -8, y: -64, z: -8 };
export const TEMPLATE_TO = { x: 8, y: 319, z: 8 };
export const ROOM_COPY_ORIGIN = { x: -8, y: -64, z: -8 };
export const PREP_SPAWN = { x: 0, y: 0, z: 0 };
export const TICKING_FROM = { x: -8, y: -1, z: -8 };
export const TICKING_TO = { x: 8, y: 65, z: 8 };
export const STRUCTURE_ID = "bearcade:trio_room";
export const TEMPLATE_SPAWN = { x: 0, y: 100, z: 0 };

// ===== 棋盘 =====
export const BOARD_SIZE = 3;
/** 磁石棋盘所在层;棋子方块放置在 BOARD_Y + 1 层 */
export const BOARD_Y = 63;
export const BOARD_BLOCK = "minecraft:lodestone";
// 棋子方块:正常 = 深红 X / 深蓝 O;虚化 = 浅红 X / 浅蓝 O(半透明)
export const PIECE_X = "bearcade:trio_x";
export const PIECE_O = "bearcade:trio_o";
export const GHOST_X = "bearcade:trio_x_ghost";
export const GHOST_O = "bearcade:trio_o_ghost";

// ===== 规则 =====
/** 每步限时(秒):超时由脚本在合法格中随机落子 */
export const MOVE_TIMEOUT_SECONDS = 45;
/** 同一玩家连续超时达到该次数,本局判负(手动落子即清零该计数) */
export const TIMEOUT_LOSS_STREAK = 3;
/** 三局两胜:先取得该胜局数者赢下整场 */
export const WINS_TO_MATCH = 2;
/** 流局兜底:每局手数上限,超限判平局(该局不计分) */
export const MAX_MOVES_PER_ROUND = 60;
/** 整场上限局数:打满仍未分出胜负则按胜局数判定,仍相同则整场平局 */
export const MAX_ROUNDS = 5;

/**
 * X/O 双方的开局站位(棋盘两侧面对面)。
 * 站在走道上:走道地板在 boardY-1 层,顶面即 boardY,因此 y 取 boardY。
 */
export const START_POS_X = { x: 0, y: 63, z: -3 };
export const START_POS_O = { x: 0, y: 63, z: 3 };

// ===== 运行时可配置项(供 /bearcade:config 修改,动态属性持久化优先于代码默认值) =====
export interface TrioConfig {
  prepSpawn: { x: number; y: number; z: number };
  boardY: number;
  /** 棋盘最小角坐标(3×3 由此推算:x ~ x+2,z ~ z+2) */
  boardMinX: number;
  boardMinZ: number;
  xStart: { x: number; y: number; z: number };
  oStart: { x: number; y: number; z: number };
  moveTimeoutSeconds: number;
  winsToMatch: number;
  maxMovesPerRound: number;
}

export const TRIO_CONFIG_DEFAULTS: TrioConfig = {
  prepSpawn: PREP_SPAWN,
  boardY: BOARD_Y,
  boardMinX: -1,
  boardMinZ: -1,
  xStart: START_POS_X,
  oStart: START_POS_O,
  moveTimeoutSeconds: MOVE_TIMEOUT_SECONDS,
  winsToMatch: WINS_TO_MATCH,
  maxMovesPerRound: MAX_MOVES_PER_ROUND,
};
