// ============================================================
// 实验室逃脱(LabEscape)配置
// 玩法:圆环分布柱子,玩家从柱顶挖到底部,跑向中央塌陷区跳下。
// 所有可调参数均可经 /bearcade:config labescape 修改,持久化优先。
// ============================================================
import type { Vec3 } from "../../shared/minigame-core/types";

export const GAME_ID = "labescape";
export const DISPLAY_NAME = "实验室逃脱";
export const PACK_ID = "f3b0d54d-1c49-4db1-83bf-febc27840dab";
export const IPC_CHANNEL = "bearcade:ipc";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";

// 房间与人数:4 房 / 普通模式 2~16 人 / 派对模式默认上限 40 人
export const ROOM_COUNT = 4;
export const MAX_PLAYERS = 16;
export const PARTY_MAX_PLAYERS = 40;
export const MIN_PLAYERS = 2;
export const PARTY_AVAILABLE = true;

// 柱子数量:普通默认 16,派对最多 40(由 /labescape:build <数量> 在模板维度生成)
export const DEFAULT_COLUMN_COUNT = 16;
export const MAX_PARTY_COLUMNS = 40;

// ===== 地图几何(单位:方块) =====
// groundY 是地面表面 Y(玩家站在地面时的脚底 Y);地面方块在 groundY-1
export const GROUND_Y = 64;
// 柱子高度:柱子方块从 groundY 到 groundY+columnHeight-1,玩家出生在 groundY+columnHeight
export const COLUMN_HEIGHT = 50;
// 玻璃底部开口高度:玻璃从 groundY+glassBottomOpenHeight 开始,底部留出出口
export const GLASS_BOTTOM_OPEN_HEIGHT = 2;
// 中央圆形塌陷区半径 / 深度 / 完成判定深度
export const CENTER_PIT_RADIUS = 5;
export const CENTER_PIT_DEPTH = 10;
export const CENTER_ENTER_DEPTH = 3;
// 圆环半径:0=按柱子数量自动;非 0 则强制使用该半径
export const MIN_RING_RADIUS = 12;
export const COLUMN_SPACING = 4;
export const RING_RADIUS_OVERRIDE = 0;

// 柱子材料(每格随机)与玻璃/地面方块
export const COLUMN_MATERIALS = [
  "minecraft:sand",
  "minecraft:oak_log",
  "minecraft:stone",
] as const;
export const GLASS_BLOCK_ID = "minecraft:glass";
export const GROUND_BLOCK_ID = "minecraft:stone";

// ===== 计时 =====
export const GAME_DURATION_SECONDS = 105;
export const FINAL_DURATION_SECONDS = 15;
export const HUD_REFRESH_TICKS = 10; // 0.5 秒刷新一次 HUD

// ===== 模板范围(按 40 柱最大地图预留,实际以 /bearcade:tmp sz 为准) =====
const MAP_RADIUS = 32;
export const TEMPLATE_FROM = {
  x: -MAP_RADIUS,
  y: GROUND_Y - CENTER_PIT_DEPTH - 5,
  z: -MAP_RADIUS,
};
export const TEMPLATE_TO = {
  x: MAP_RADIUS - 1,
  y: GROUND_Y + COLUMN_HEIGHT + 5,
  z: MAP_RADIUS - 1,
};
export const ROOM_COPY_ORIGIN = { ...TEMPLATE_FROM };
// 准备房间坐标:放在场地中央上方空中,入场后由 onGameStart 统一传送到各自柱顶
export const PREP_SPAWN = { x: 0, y: GROUND_Y + COLUMN_HEIGHT + 8, z: 0 };
// 常加载区域:只覆盖实际场地,不要整列 384 层
export const TICKING_FROM = {
  x: -MAP_RADIUS,
  y: GROUND_Y - CENTER_PIT_DEPTH - 2,
  z: -MAP_RADIUS,
};
export const TICKING_TO = {
  x: MAP_RADIUS - 1,
  y: GROUND_Y + COLUMN_HEIGHT + 3,
  z: MAP_RADIUS - 1,
};
export const STRUCTURE_ID = "bearcade:labescape_room";
// 开发命令 /bearcade:tmp tp labescape 进入模板维度的落点
export const TEMPLATE_SPAWN = { x: 0, y: GROUND_Y + COLUMN_HEIGHT + 10, z: 0 };

// ===== 运行时配置(经 /bearcade:config labescape 修改,持久化优先) =====
export interface LabEscapeConfig {
  prepSpawn: Vec3;
  /** 普通模式单房间最大人数(经 /bearcade:config 可调) */
  maxPlayers: number;
  /** 派对模式单房间最大人数上限 */
  partyMaxPlayers: number;
  groundY: number;
  columnHeight: number;
  glassBottomOpenHeight: number;
  centerPitRadius: number;
  centerPitDepth: number;
  centerEnterDepth: number;
  minRingRadius: number;
  columnSpacing: number;
  ringRadiusOverride: number;
  gameDurationSeconds: number;
  finalDurationSeconds: number;
  maxPartyColumns: number;
}

export const LABESCAPE_CONFIG_DEFAULTS: LabEscapeConfig = {
  prepSpawn: PREP_SPAWN,
  maxPlayers: MAX_PLAYERS,
  partyMaxPlayers: PARTY_MAX_PLAYERS,
  groundY: GROUND_Y,
  columnHeight: COLUMN_HEIGHT,
  glassBottomOpenHeight: GLASS_BOTTOM_OPEN_HEIGHT,
  centerPitRadius: CENTER_PIT_RADIUS,
  centerPitDepth: CENTER_PIT_DEPTH,
  centerEnterDepth: CENTER_ENTER_DEPTH,
  minRingRadius: MIN_RING_RADIUS,
  columnSpacing: COLUMN_SPACING,
  ringRadiusOverride: RING_RADIUS_OVERRIDE,
  gameDurationSeconds: GAME_DURATION_SECONDS,
  finalDurationSeconds: FINAL_DURATION_SECONDS,
  maxPartyColumns: MAX_PARTY_COLUMNS,
};
