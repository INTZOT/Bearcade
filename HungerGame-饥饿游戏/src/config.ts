// ============================================================
// HungerGame(饥饿游戏)小游戏配置
// 骨架阶段:玩法流程与数值待定,坐标均为占位,开发时按需修改。
// ============================================================
export const GAME_ID = "hungergame";
export const DISPLAY_NAME = "饥饿游戏";
export const PACK_ID = "25db9388-fb9c-47c6-ad91-cdf0915ec7d6";
export const IPC_CHANNEL = "bearcade:ipc";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";

// 大逃杀类:单房 4~16 人,支持派对模式(派对下人数可超 16,出生点按列表循环)
export const ROOM_COUNT = 2;
export const MAX_PLAYERS = 16;
export const MIN_PLAYERS = 4;

// ===== 模板坐标(占位 ±16,按实际场地调整;横向超 64 可配置 tileSize 自动分块) =====
export const TEMPLATE_FROM = { x: -16, y: -64, z: -16 };
export const TEMPLATE_TO = { x: 16, y: 319, z: 16 };
export const ROOM_COPY_ORIGIN = { x: -16, y: -64, z: -16 };
export const PREP_SPAWN = { x: 0, y: 0, z: 0 };
export const TICKING_FROM = { x: -16, y: -1, z: -16 };
export const TICKING_TO = { x: 16, y: 65, z: 16 };

export const STRUCTURE_ID = "bearcade:hungergame_room";
export const TEMPLATE_SPAWN = { x: 0, y: 100, z: 0 };

// 待定:玩家开局传送点(按最终场地配置)
export const START_POS = { x: 0, y: 65, z: 0 };

// ===== 运行时可配置项(供 /bearcade:config 修改,持久化优先) =====
export interface HungerGameConfig {
  prepSpawn: { x: number; y: number; z: number };
  // 待定:玩法相关可配置项(如游戏时长、出生点列表等)后续追加
}

export const HUNGER_GAME_CONFIG_DEFAULTS: HungerGameConfig = {
  prepSpawn: PREP_SPAWN,
};
