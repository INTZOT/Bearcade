// ============================================================
// CChess(中国象棋)小游戏配置
// 玩法:待实现(两方对弈)。当前阶段:自定义方块与资源包验证。
// ============================================================
export const GAME_ID = "cchess";
export const DISPLAY_NAME = "中国象棋";
export const PACK_ID = "fc9ae3e0-6996-4083-8c57-ec24fdaff4dd";
export const IPC_CHANNEL = "bearcade:ipc";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";

// 人数与派对配置
export const ROOM_COUNT = 8;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 2;
export const PARTY_AVAILABLE = false;

// ===== 场地坐标(占位,玩法实现后建场地时填写/核对) =====
export const TEMPLATE_FROM = { x: -7, y: -64, z: -7 };
export const TEMPLATE_TO = { x: 7, y: 319, z: 7 };
export const ROOM_COPY_ORIGIN = { x: -7, y: -64, z: -7 };
export const PREP_SPAWN = { x: 0, y: 0, z: 0 };
export const TICKING_FROM = { x: -7, y: -1, z: -7 };
export const TICKING_TO = { x: 7, y: 65, z: 7 };
export const STRUCTURE_ID = "bearcade:cchess_room";
export const TEMPLATE_SPAWN = { x: 0, y: 100, z: 0 };
export const START_POSITIONS = [
  { x: 0, y: 65, z: -1 },
  { x: 0, y: 65, z: 1 },
];
