export const GAME_ID = "gomoku";
export const DISPLAY_NAME = "五子棋";
export const ROOM_COUNT = 8;
export const MAX_PLAYERS = 2;

// TODO: 模板场地完成后,填写房间准备区坐标(房间维度内),再启动 game.register 上报
export const PREP_SPAWN = { x: 0, y: 100, z: 0 };

export const DIMENSION_NAMESPACE = "bearcade";
export const TEMPLATE_DIMENSION_ID = `${DIMENSION_NAMESPACE}:${GAME_ID}_template`;
export const TEMPLATE_SPAWN = { x: 0, y: 100, z: 0 };

export function roomDimensionId(roomId: number): string {
  return `${DIMENSION_NAMESPACE}:${GAME_ID}_${roomId}`;
}
