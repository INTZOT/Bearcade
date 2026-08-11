export const GAME_ID = "gomoku";
export const DISPLAY_NAME = "五子棋";
export const ROOM_COUNT = 8;
export const MAX_PLAYERS = 2;

// ===== 以下坐标全部由小游戏包开发者配置 =====

// 模板复制起始点/终点:模板维度中场地结构的两个对角坐标(含端点)
export const TEMPLATE_FROM = { x: -6, y: 63, z: -6 };
export const TEMPLATE_TO = { x: 6, y: 64, z: 6 };

// 每个房间维度内放置场地的原点坐标(结构 from 角落在该位置)
// 暂按“与模板同坐标放置”:房间场地将位于 x -6~6, y 63~64, z -6~6(待确认)
export const ROOM_COPY_ORIGIN = { x: -6, y: 63, z: -6 };

// 准备房间坐标:与游戏场地位于同一房间维度的不同位置(玩家入房后传送到此,随 game.register 上报给 Core)
export const PREP_SPAWN = { x: 0, y: 0, z: 0 };

export const DIMENSION_NAMESPACE = "bearcade";
export const TEMPLATE_DIMENSION_ID = `${DIMENSION_NAMESPACE}:${GAME_ID}_template`;
export const TEMPLATE_SPAWN = { x: 0, y: 100, z: 0 };

export function roomDimensionId(roomId: number): string {
  return `${DIMENSION_NAMESPACE}:${GAME_ID}_${roomId}`;
}
