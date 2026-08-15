// ============================================================
// 急速战桥(BridgeWar)小游戏配置
// 玩法细节待定,坐标在模板维度建好场地后填写。
// ============================================================
export const GAME_ID = "bridgewar";
export const DISPLAY_NAME = "急速战桥";
export const PACK_ID = "1f434015-345b-4a9a-926d-2c1da5a29681";
export const IPC_CHANNEL = "bearcade:ipc";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";

// 人数与派对配置
export const ROOM_COUNT = 4;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const PARTY_AVAILABLE = true;

// 玩法规则
export const WIN_SCORE = 5; // 先到 5 分队胜
export const ROUND_END_DELAY_TICKS = 60; // 回合结束后 3 秒重置并开下一回合
export const BRIDGE_WOOLS = [
  "minecraft:red_wool",
  "minecraft:blue_wool",
]; // 玩家仅可放置这两种方块
export const SPAWN_PROTECT_RADIUS = 1; // 出生点周边禁止放置的半径

// ===== 场地坐标(待模板场地建好后填写) =====
export const TEMPLATE_FROM = { x: -16, y: -64, z: -8 };
export const TEMPLATE_TO = { x: 16, y: 319, z: 8 };
export const ROOM_COPY_ORIGIN = { x: -16, y: -64, z: -8 };
export const PREP_SPAWN = { x: 0, y: 0, z: 0 };
export const TICKING_FROM = { x: -16, y: -1, z: -8 };
export const TICKING_TO = { x: 16, y: 65, z: 8 };
export const STRUCTURE_ID = "bearcade:bridgewar_room";
export const TEMPLATE_SPAWN = { x: 0, y: 100, z: 0 };
export const START_POSITIONS = [
  { x: -16, y: 64, z: 0 },
  { x: 16, y: 64, z: 0 },
];

// 队伍出生点与核心区(开发者配置,模板场地建好后核对)
export const RED_SPAWN = { x: -14, y: 64, z: 0 };
export const BLUE_SPAWN = { x: 14, y: 64, z: 0 };
export const RED_CORE_FROM = { x: -16, y: 63, z: -4 };
export const RED_CORE_TO = { x: -13, y: 66, z: 4 };
export const BLUE_CORE_FROM = { x: 13, y: 63, z: -4 };
export const BLUE_CORE_TO = { x: 16, y: 66, z: 4 };

// 装备仓库实体所在维度(loadout.ts 使用);其余维度 ID 由共享运行时统一计算
export const TEMPLATE_DIMENSION_ID = "bearcade:bridgewar_template";

// ===== 运行时可配置项(供 /bearcade:config 修改,持久化优先) =====
export interface BridgeConfig {
  prepSpawn: { x: number; y: number; z: number };
  mapBoundary: { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } };
  redSpawn: { x: number; y: number; z: number };
  blueSpawn: { x: number; y: number; z: number };
  redCore: { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } };
  blueCore: { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } };
  winScore: number;
}

export const BRIDGE_CONFIG_DEFAULTS: BridgeConfig = {
  prepSpawn: PREP_SPAWN,
  mapBoundary: { from: TEMPLATE_FROM, to: TEMPLATE_TO },
  redSpawn: RED_SPAWN,
  blueSpawn: BLUE_SPAWN,
  redCore: { from: RED_CORE_FROM, to: RED_CORE_TO },
  blueCore: { from: BLUE_CORE_FROM, to: BLUE_CORE_TO },
  winScore: WIN_SCORE,
};
