// ============================================================
// 击退战(Knockback)配置
// 玩法:中央高台停留得分,击退木棍把别人推下高台。
// 场地坐标目前为占位值,建好模板后按实际场地调整。
// ============================================================
import type { Vec3 } from "../../shared/minigame-core/types";

export const GAME_ID = "knockback";
export const DISPLAY_NAME = "击退战";
export const PACK_ID = "fee850e2-95f6-4045-a87f-feaa83e71502";
export const IPC_CHANNEL = "bearcade:ipc";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";

// 房间与人数:2~8 人 / 4 房 / 支持派对(派对无视人数上限)
export const ROOM_COUNT = 4;
export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;
export const PARTY_AVAILABLE = true;

// 对局时长
export const GAME_DURATION_SECONDS = 90;
// 剩余时间提醒节点(秒)
export const TIME_WARNING_SECONDS = [60, 30, 15, 10, 5, 4, 3, 2, 1] as const;

// 计分:每 0.1 秒(2 tick)计算一次,中央区域内的玩家 +0.1 分
export const SCORE_INTERVAL_TICKS = 2;
export const SCORE_PER_INTERVAL = 0.1;
// 1.5 倍得分区:每 0.1 秒 +0.15 分
export const BONUS_SCORE_PER_INTERVAL = 0.15;
export const HUD_REFRESH_TICKS = 5; // 0.25 秒刷新一次 actionbar

// ===== 场地配置(占位,按模板实际场地调整) =====
// 场地中心(中央高台方块坐标;高台顶部 = y + 1)
export const ARENA_CENTER = { x: 0, y: 64, z: 0 };
// 中央高台半径 / 外围区域半径(含中央)
export const CENTER_RADIUS = 7;
export const OUTER_RADIUS = 16;
// 中央高台所在方块 Y / 外围地面方块 Y(中央比外围高一格)
export const CENTER_FLOOR_Y = 64;
export const OUTER_FLOOR_Y = 63;
// 1.5 倍得分区:在中央高台再高一格的位置,半径 3
export const BONUS_RADIUS = 3;
export const BONUS_FLOOR_Y = CENTER_FLOOR_Y + 1;

// 模板复制起始点/终点(覆盖半径 16 + 边界墙)
export const TEMPLATE_FROM = { x: -18, y: -64, z: -18 };
export const TEMPLATE_TO = { x: 18, y: 319, z: 18 };
export const ROOM_COPY_ORIGIN = { x: -18, y: -64, z: -18 };
// 准备房间坐标(占位,建议放在外围或观战台)
export const PREP_SPAWN = { x: 0, y: 65, z: 12 };
// 常加载区域:只覆盖实际场地,不要整列 384 层
export const TICKING_FROM = { x: -18, y: -1, z: -18 };
export const TICKING_TO = { x: 18, y: 67, z: 18 };
export const STRUCTURE_ID = "bearcade:knockback_room";
// 开发命令 /bearcade:tmp tp knockback 进入模板维度的落点
export const TEMPLATE_SPAWN = { x: 0, y: 80, z: 0 };

// 开局站位:均匀分布在外围(占位,可自行调整)
export const START_POSITIONS = Array.from({ length: 8 }, (_, i) => {
  const angle = (i / 8) * Math.PI * 2;
  return {
    x: Math.round(Math.cos(angle) * 10),
    y: OUTER_FLOOR_Y + 1,
    z: Math.round(Math.sin(angle) * 10),
  };
});

// ===== 击退木棍 =====
export const KNOCKBACK_ITEM_IDS = {
  weak: "bearcade:knockback_stick_weak",
  medium: "bearcade:knockback_stick_medium",
  strong: "bearcade:knockback_stick_strong",
} as const;

export type KnockbackTier = keyof typeof KNOCKBACK_ITEM_IDS;

// 木棍最大耐久;weak 无耐久(无限使用),medium/strong 耐久已增强
export const STICK_MAX_DURABILITY = 128;
export const STICK_DURABILITY = {
  weak: 0, // 无耐久组件,无限使用
  medium: 40, // 剩余 88(比之前略减一点)
  strong: 72, // 剩余 56(比之前略减一点)
} as const;

// 击退力度:applyKnockback 的水平方向乘数 / 垂直力度(占位,可调)
export const KNOCKBACK_STRENGTH = {
  weak: { horizontal: 0.7, vertical: 0.25 },
  medium: { horizontal: 1.1, vertical: 0.35 },
  strong: { horizontal: 1.5, vertical: 0.45 },
} as const;

// 场地中刷新中/强木棍(中央高台 + 外围均可刷新)
export const STICK_SPAWN_POINTS = [
  { x: 0, y: CENTER_FLOOR_Y + 1, z: 0 },
  { x: 3, y: CENTER_FLOOR_Y + 1, z: 3 },
  { x: -3, y: CENTER_FLOOR_Y + 1, z: -3 },
  { x: 4, y: CENTER_FLOOR_Y + 1, z: -4 },
  { x: 0, y: OUTER_FLOOR_Y + 1, z: 12 },
  { x: 12, y: OUTER_FLOOR_Y + 1, z: 0 },
  { x: 0, y: OUTER_FLOOR_Y + 1, z: -12 },
  { x: -12, y: OUTER_FLOOR_Y + 1, z: 0 },
] as const;
export const STICK_SPAWN_COUNTS = { medium: 2, strong: 1 } as const;
export const STICK_RESPAWN_TICKS = 300; // 15 秒
// 剩余时间少于该秒数后停止刷新木棍,避免结束前遗留
export const STICK_SPAWN_STOP_SECONDS = 5;

// ===== 运行时配置(经 /bearcade:config knockback 修改,持久化优先) =====
export interface KnockbackConfig {
  prepSpawn: Vec3;
  arenaCenter: Vec3;
  centerRadius: number;
  bonusRadius: number;
  outerRadius: number;
  centerFloorY: number;
  outerFloorY: number;
  gameDurationSeconds: number;
  stickRespawnSeconds: number;
  mediumSpawnCount: number;
  strongSpawnCount: number;
}

export const KNOCKBACK_CONFIG_DEFAULTS: KnockbackConfig = {
  prepSpawn: PREP_SPAWN,
  arenaCenter: ARENA_CENTER,
  centerRadius: CENTER_RADIUS,
  bonusRadius: BONUS_RADIUS,
  outerRadius: OUTER_RADIUS,
  centerFloorY: CENTER_FLOOR_Y,
  outerFloorY: OUTER_FLOOR_Y,
  gameDurationSeconds: GAME_DURATION_SECONDS,
  stickRespawnSeconds: Math.round(STICK_RESPAWN_TICKS / 20),
  mediumSpawnCount: STICK_SPAWN_COUNTS.medium,
  strongSpawnCount: STICK_SPAWN_COUNTS.strong,
};
