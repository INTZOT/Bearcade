// ============================================================
// 建筑猜猜乐(GuessNBuild)小游戏配置
// 房间数量/最大人数/坐标均由本包开发者配置,模板坐标在场地建好后填写。
// ============================================================
export const GAME_ID = "guessnbuild";
export const DISPLAY_NAME = "建筑猜猜乐";
export const PACK_ID = "452ba546-30fd-45d4-bfc5-cee80429ecfc";
export const IPC_CHANNEL = "bearcade:ipc";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";
export const ROOM_COUNT = 2;
export const MAX_PLAYERS = 2;

// ===== 以下坐标由开发者在模板维度建好场地后填写 =====
export const TEMPLATE_FROM = { x: -7, y: -64, z: -7 };
export const TEMPLATE_TO = { x: 7, y: 319, z: 7 };
export const ROOM_COPY_ORIGIN = { x: -7, y: -64, z: -7 };
export const PREP_SPAWN = { x: 0, y: 0, z: 0 };
export const TICKING_FROM = { x: -7, y: -1, z: -7 };
export const TICKING_TO = { x: 7, y: 65, z: 7 };
export const STRUCTURE_ID = "bearcade:guessnbuild_room";
export const TEMPLATE_SPAWN = { x: 0, y: 100, z: 0 };
export const START_POSITIONS = [
  { x: 0, y: 65, z: -1 },
  { x: 0, y: 65, z: 1 },
];

export const DIMENSION_NAMESPACE = "bearcade";
export const TEMPLATE_DIMENSION_ID = `${DIMENSION_NAMESPACE}:${GAME_ID}_template`;

export function roomDimensionId(roomId: number): string {
  return `${DIMENSION_NAMESPACE}:${GAME_ID}_${roomId}`;
}

export function tickingAreaId(roomId: number): string {
  return `bearcade:ta_${GAME_ID}_${roomId}`;
}
