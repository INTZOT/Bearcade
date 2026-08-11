export const GAME_ID = "gomoku";
export const DISPLAY_NAME = "五子棋";
export const ROOM_COUNT = 8;
export const MAX_PLAYERS = 2;

// ===== 以下坐标全部由小游戏包开发者配置 =====

// 模板复制起始点/终点:模板维度中场地结构的两个对角坐标(含端点)
// TODO: 场地制作完成后填写,例如 { x: -10, y: 100, z: -10 } ~ { x: 10, y: 100, z: 10 }
export const TEMPLATE_FROM = { x: 0, y: 100, z: 0 };
export const TEMPLATE_TO = { x: 0, y: 100, z: 0 };

// 每个房间维度内放置场地的原点坐标(结构复制到该位置)
// TODO: 与模板场地尺寸配套填写
export const ROOM_COPY_ORIGIN = { x: 0, y: 100, z: 0 };

// 准备房间坐标:玩家入房后传送到本房间维度的哪个位置(随 game.register 上报给 Core)
// TODO: 模板场地完成后填写
export const PREP_SPAWN = { x: 0, y: 100, z: 0 };

export const DIMENSION_NAMESPACE = "bearcade";
export const TEMPLATE_DIMENSION_ID = `${DIMENSION_NAMESPACE}:${GAME_ID}_template`;
export const TEMPLATE_SPAWN = { x: 0, y: 100, z: 0 };

export function roomDimensionId(roomId: number): string {
  return `${DIMENSION_NAMESPACE}:${GAME_ID}_${roomId}`;
}
