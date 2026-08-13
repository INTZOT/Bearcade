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
export const RESPAWN_DELAY_TICKS = 60; // 掉虚空后 3 秒内不能得分
export const ROUND_END_DELAY_TICKS = 60; // 回合结束后 3 秒重置并开下一回合

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

export const DIMENSION_NAMESPACE = "bearcade";
export const TEMPLATE_DIMENSION_ID = `${DIMENSION_NAMESPACE}:${GAME_ID}_template`;

export function roomDimensionId(roomId: number): string {
  return `${DIMENSION_NAMESPACE}:${GAME_ID}_${roomId}`;
}

export function tickingAreaId(roomId: number): string {
  return `bearcade:ta_${GAME_ID}_${roomId}`;
}
