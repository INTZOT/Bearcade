// ============================================================
// 《灯塔全明星》(AllStars)配置
// - 菜单显示名:DISPLAY_NAME(灯塔全明星)
// - 进入对局后的正式名:IN_GAME_NAME(灯塔全明星对决),用于播报 / HUD
// - 玩法为 1v1:MAX_PLAYERS = 2,不支持派对模式(派对会忽略人数上限)
// ============================================================
export const GAME_ID = "allstars";
export const DISPLAY_NAME = "灯塔全明星对决";
/** 进入对局后在播报 / HUD 中使用的正式名 */
export const IN_GAME_NAME = "灯塔全明星对决";
export const PACK_ID = "efde1bf1-0b29-42a5-94db-8ce2f679cea0";
export const IPC_CHANNEL = "bearcade:ipc";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";
export const ROOM_COUNT = 8;
export const MAX_PLAYERS = 2;
/** 1v1:开局所需最少人数 */
export const MIN_PLAYERS = 2;
// 派对模式可用性:去除最大人数上限后仍可正常运行才设为 true(1v1 对决恒为 false)
export const PARTY_AVAILABLE = false;

// ===== 场地坐标(与 `buildmap` 造场命令生成的擂台一致,改尺寸时三处一起改) =====
// 擂台(combat-config 的 ARENA_CENTER / ARENA_HALF_WIDTH / map.ts 的 ARENA_HALF_DEPTH):
//   实体范围 x ±13、z ±5,地板方块层 y=64(角色脚底 y=65),屏障到 y=68
// 准备台:z=+20 附近 5×5 小平台(入房后落点,开局再被传进擂台)
//
// 模板复制起始点/终点(引擎结构上限 64×384×64;此处 29×17×30 远低于上限)
export const TEMPLATE_FROM = { x: -14, y: 60, z: -6 };
export const TEMPLATE_TO = { x: 14, y: 76, z: 23 };
// 每个房间维度内放置场地的原点坐标(结构 from 角落在该位置)
export const ROOM_COPY_ORIGIN = { x: -14, y: 60, z: -6 };
// 准备房间坐标:与场地位于同一房间维度的不同位置,随 game.register 上报给 Core
export const PREP_SPAWN = { x: 0, y: 65, z: 20 };
// 常加载区域:覆盖擂台 + 准备台即可,不要整列 384 层(节省每包 chunk 上限)
export const TICKING_FROM = { x: -14, y: -1, z: -6 };
export const TICKING_TO = { x: 14, y: 70, z: 23 };
// 从模板捕获的结构标识
export const STRUCTURE_ID = "bearcade:allstars_room";
// 开发命令 /bearcade:tmp tp allstars 进入模板维度的落点(擂台外、准备台上方)
export const TEMPLATE_SPAWN = { x: 0, y: 72, z: 20 };
// 开局站位(1v1:双方各占一侧;模板场地建好后按实际擂台调整)
export const START_POSITIONS = [
  { x: 2, y: 65, z: 0 },
  { x: -2, y: 65, z: 0 },
];
