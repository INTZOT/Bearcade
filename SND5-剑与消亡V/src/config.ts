// ============================================================
// 剑与消亡V(SND5)小游戏配置
// 玩法细节待定,房间数/人数/坐标在玩法确认与场地建好后填写。
// ============================================================
export const GAME_ID = "snd5";
export const DISPLAY_NAME = "剑与消亡V";
export const PACK_ID = "64212de9-a02f-4723-ae4e-6ceeb933d681";
export const IPC_CHANNEL = "bearcade:ipc";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";
export const ROOM_COUNT = 2;
export const MAX_PLAYERS = 2;
// 派对模式可用性:去除最大人数上限后仍可正常运行才设为 true
export const PARTY_AVAILABLE = false;

// ===== 以下坐标由开发者在模板维度建好场地后填写 =====
// 模板复制起始点/终点(引擎结构上限 64×384×64,纵向取满为 y -64~319)
export const TEMPLATE_FROM = { x: -7, y: -64, z: -7 };
export const TEMPLATE_TO = { x: 7, y: 319, z: 7 };
// 每个房间维度内放置场地的原点坐标(结构 from 角落在该位置)
export const ROOM_COPY_ORIGIN = { x: -7, y: -64, z: -7 };
// 准备房间坐标:与场地位于同一房间维度的不同位置,随 game.register 上报给 Core
export const PREP_SPAWN = { x: 0, y: 0, z: 0 };
// 常加载区域:只需覆盖实际内容,不要整列 384 层(节省每包 chunk 上限)
export const TICKING_FROM = { x: -7, y: -1, z: -7 };
export const TICKING_TO = { x: 7, y: 65, z: 7 };
// 从模板捕获的结构标识
export const STRUCTURE_ID = "bearcade:snd5_room";
// 开发命令 /bearcade:snd5 进入模板维度的落点
export const TEMPLATE_SPAWN = { x: 0, y: 100, z: 0 };
// 开局站位(与 MAX_PLAYERS 对应,可自行增删)
export const START_POSITIONS = [
  { x: 0, y: 65, z: -1 },
  { x: 0, y: 65, z: 1 },
];

export const DIMENSION_NAMESPACE = "bearcade";
export const TEMPLATE_DIMENSION_ID = `${DIMENSION_NAMESPACE}:${GAME_ID}_template`;

export function roomDimensionId(roomId: number): string {
  return `${DIMENSION_NAMESPACE}:${GAME_ID}_${roomId}`;
}

export function tickingAreaId(roomId: number | "template"): string {
  return `bearcade:ta_${GAME_ID}_${roomId}`;
}
