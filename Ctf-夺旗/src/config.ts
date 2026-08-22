// ============================================================
// 小游戏模板配置
// 复制本包后,请全局替换 "ctf" 为你的游戏 ID(小写字母/数字/下划线),
// 并修改 DISPLAY_NAME / ROOM_COUNT / MAX_PLAYERS / PACK_ID。
// ============================================================
export const GAME_ID = "ctf";
export const DISPLAY_NAME = "夺旗";
export const PACK_ID = "b7bf4418-3194-41a9-b4af-89219c8e247a";
export const IPC_CHANNEL = "bearcade:ipc";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";
export const ROOM_COUNT = 2;
export const MAX_PLAYERS = 12;
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
export const STRUCTURE_ID = "bearcade:ctf_room";
// 开发命令 /bearcade:tmp tp ctf 进入模板维度的落点
export const TEMPLATE_SPAWN = { x: 0, y: 100, z: 0 };
// 开局站位(与 MAX_PLAYERS 对应,可自行增删)
export const START_POSITIONS = [
  { x: 2, y: 65, z: 0 },
  { x: 2, y: 65, z: 1 },
  { x: 1, y: 65, z: 2 },
  { x: 0, y: 65, z: 2 },
  { x: -1, y: 65, z: 2 },
  { x: -2, y: 65, z: 1 },
  { x: -2, y: 65, z: 0 },
  { x: -2, y: 65, z: -1 },
  { x: -1, y: 65, z: -2 },
  { x: 0, y: 65, z: -2 },
  { x: 1, y: 65, z: -2 },
  { x: 2, y: 65, z: -1 },
];
