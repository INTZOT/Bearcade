// ============================================================
// 建筑猜猜乐(GuessNBuild)小游戏配置
// 坐标在模板维度建好场地后填写,或使用 /bearcade:tmp sz guessnbuild 表单配置。
// ============================================================
export const GAME_ID = "guessnbuild";
export const DISPLAY_NAME = "建筑猜猜乐";
export const PACK_ID = "452ba546-30fd-45d4-bfc5-cee80429ecfc";
export const IPC_CHANNEL = "bearcade:ipc";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";

export const ROOM_COUNT = 2;
export const MAX_PLAYERS = 16;
export const MIN_PLAYERS = 3;

// 回合与计分规则
export const ROUND_SECONDS = 300;
export const BUILDER_GAIN = 1;
export const GUESSER_GAIN = 2;
export const QB_KEY = "bearcade:qbank_guessnbuild";

/** 获胜所需分数,由游玩人数决定 */
export function targetScoreFor(playerCount: number): number {
  if (playerCount >= 3 && playerCount <= 5) return 11;
  if (playerCount >= 6 && playerCount <= 9) return 9;
  return 7; // 10~16 人
}

// ===== 场地坐标(开发者配置) =====
export const TEMPLATE_FROM = { x: -7, y: -64, z: -7 };
export const TEMPLATE_TO = { x: 7, y: 319, z: 7 };
export const ROOM_COPY_ORIGIN = { x: -7, y: -64, z: -7 };
export const PREP_SPAWN = { x: 0, y: 0, z: 0 };
export const TICKING_FROM = { x: -7, y: -1, z: -7 };
export const TICKING_TO = { x: 7, y: 65, z: 7 };
export const STRUCTURE_ID = "bearcade:guessnbuild_room";
export const TEMPLATE_SPAWN = { x: 0, y: 100, z: 0 };
export const ROUND_SPAWN = { x: 0, y: 64, z: 0 };
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
