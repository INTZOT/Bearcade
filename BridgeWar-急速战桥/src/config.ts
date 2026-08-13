// ============================================================
// 急速战桥(BridgeWar)小游戏配置
// 玩法细节待定,坐标在模板维度建好场地后填写。
// ============================================================
export const GAME_ID = "bridgewar";
export const DISPLAY_NAME = "急速战桥";
export const PACK_ID = "1f434015-345b-4a9a-926d-2c1da5a29681";
export const IPC_CHANNEL = "bearcade:ipc";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";

// 人数配置(待确认)
export const ROOM_COUNT = 2;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const PARTY_AVAILABLE = false;

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

export const DIMENSION_NAMESPACE = "bearcade";
export const TEMPLATE_DIMENSION_ID = `${DIMENSION_NAMESPACE}:${GAME_ID}_template`;

export function roomDimensionId(roomId: number): string {
  return `${DIMENSION_NAMESPACE}:${GAME_ID}_${roomId}`;
}

export function tickingAreaId(roomId: number): string {
  return `bearcade:ta_${GAME_ID}_${roomId}`;
}
