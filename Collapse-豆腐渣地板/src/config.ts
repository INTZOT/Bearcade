// ============================================================
// Collapse(豆腐渣地板)小游戏配置
// 玩法:多层豆腐渣地板(白色混凝土),踩过的地板进入塌陷状态
// (黄→橙→红→消失),PVP 开启后可互相攻击,掉虚空淘汰,
// 最后存活者获胜。层数由模板场地决定,场地大小由本配置决定。
// ============================================================
import type { Vec3 } from "../../shared/minigame-core/types";

export const GAME_ID = "collapse";
export const DISPLAY_NAME = "豆腐渣地板";
export const PACK_ID = "aae0fcae-3e6d-402a-ba37-0a4186396c3b";
export const IPC_CHANNEL = "bearcade:ipc";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";

// 人数与派对配置
export const ROOM_COUNT = 2;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 16;
export const PARTY_AVAILABLE = true;

// ===== 玩法配置(默认值,模板场地建好后核对) =====
/** 场地中心(房间维度内,与模板场地对齐;占位,模板建好后核对) */
export const ARENA_CENTER = { x: 0, z: 0 };
/** 场地单层宽/深(默认 19×19 白色混凝土;多层由模板决定) */
export const ARENA_SIZE = 19;
/** 顶层地板 y(占位,模板建好后填写;出生与塌陷检测基准) */
export const TOP_Y = 65;
/** 掉到该 y 以下视为淘汰 */
export const VOID_Y = -20;
/** PVP 开启延迟(开局后 60 秒) */
export const PVP_DELAY_TICKS = 60 * 20;
/** 塌陷每阶段持续 tick(1 秒 = 20 tick):黄→橙→红 各 1 秒,第 4 秒消失 */
export const STAGE_TICKS = 20;
/** 地板初始方块(被踩后进入塌陷状态) */
export const FLOOR_BLOCK = "minecraft:white_concrete";
/** 塌陷阶段方块:阶段1 黄 / 阶段2 橙 / 阶段3 红(阶段4 消失) */
export const STAGE_BLOCKS = [
  "minecraft:yellow_concrete",
  "minecraft:orange_concrete",
  "minecraft:red_concrete",
];
/** 观战切换物品(淘汰玩家手持使用切换观战对象) */
export const SPECTATE_ITEM = "minecraft:spyglass";

// ===== 场地坐标(占位,模板维度建好场地后填写/核对) =====
export const TEMPLATE_FROM = { x: -12, y: -64, z: -12 };
export const TEMPLATE_TO = { x: 12, y: 319, z: 12 };
export const ROOM_COPY_ORIGIN = { x: -12, y: -64, z: -12 };
export const PREP_SPAWN = { x: 0, y: 0, z: 0 };
export const TICKING_FROM = { x: -12, y: -1, z: -12 };
export const TICKING_TO = { x: 12, y: 65, z: 12 };
export const STRUCTURE_ID = "bearcade:collapse_room";
export const TEMPLATE_SPAWN = { x: 0, y: 100, z: 0 };
// 开局站位占位(实际按场地中心环形散开,见 game.ts)

// ===== 运行时可配置项(供 /bearcade:config 修改,持久化优先) =====
export interface CollapseConfig {
  prepSpawn: Vec3;
  /** 场地中心(仅 x/z 生效,y 忽略) */
  arenaCenter: Vec3;
  /** 场地单层宽/深(奇数为宜) */
  arenaSize: number;
  /** 顶层地板 y(出生与场地范围基准) */
  topY: number;
  /** 掉到该 y 以下视为淘汰 */
  voidY: number;
  /** PVP 开启延迟(秒) */
  pvpDelaySeconds: number;
  /** 塌陷每阶段时长(秒):黄→橙→红→消失 */
  stageSeconds: number;
  /** 观战台位置(淘汰玩家本体传送至此;建议放场地边缘上空,位于常加载区内) */
  spectateSpot: Vec3;
}

export const COLLAPSE_CONFIG_DEFAULTS: CollapseConfig = {
  prepSpawn: PREP_SPAWN,
  arenaCenter: { x: ARENA_CENTER.x, y: TOP_Y, z: ARENA_CENTER.z },
  arenaSize: ARENA_SIZE,
  topY: TOP_Y,
  voidY: VOID_Y,
  pvpDelaySeconds: Math.round(PVP_DELAY_TICKS / 20),
  stageSeconds: Math.round(STAGE_TICKS / 20),
  // 默认观战台:场地边缘正上方(常加载区内),模板建好后可按场地调整
  spectateSpot: {
    x: ARENA_CENTER.x,
    y: TOP_Y + 6,
    z: ARENA_CENTER.z + Math.floor(ARENA_SIZE / 2),
  },
};
