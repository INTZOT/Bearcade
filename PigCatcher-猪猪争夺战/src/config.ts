// ============================================================
// PigCatcher(猪猪争夺战)配置
// 玩法:红黄蓝绿四队,用钓鱼竿/胡萝卜钓竿/拴绳把中立猪赶进
// 自家核心区,计时结束后按核心区猪数结算。
// 场地坐标默认占位,模板维度建好场地后填写或游戏内配置。
// ============================================================
import type { Vec3 } from "../../shared/minigame-core/types";

export const GAME_ID = "pigcatcher";
export const DISPLAY_NAME = "猪猪争夺战";
export const PACK_ID = "891f4267-9bcd-4eb4-b207-8b9fb2d179e1";
export const IPC_CHANNEL = "bearcade:ipc";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";

// 人数与派对配置
export const ROOM_COUNT = 2;
export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 16;
export const PARTY_AVAILABLE = true;

// 玩法规则(默认值,运行时可经 /bearcade:config 修改)
export const GAME_DURATION_TICKS = 5 * 60 * 20; // 一局 5 分钟
export const PIG_INITIAL_COUNT = 5; // 开局初始猪数(无上限)
export const PIG_SPAWN_BATCH = 1; // 每个刷新周期补充的猪数(无上限)
export const PIG_RESPAWN_INTERVAL_TICKS = 20 * 20; // 每 20 秒补充一批
export const LURE_RADIUS = 6; // 核心区胡萝卜引力场半径(格)
export const LURE_STRENGTH = 0.15; // 核心区引力场每 tick 冲量

// 队伍
export type Team = "red" | "yellow" | "blue" | "green";
export const TEAMS: readonly Team[] = ["red", "yellow", "blue", "green"];
export const TEAM_NAMES: Record<Team, string> = {
  red: "红队",
  yellow: "黄队",
  blue: "蓝队",
  green: "绿队",
};
export const TEAM_COLORS: Record<Team, string> = {
  red: "§c",
  yellow: "§e",
  blue: "§9",
  green: "§a",
};

export interface Region {
  from: Vec3;
  to: Vec3;
}

// ===== 场地坐标(待模板场地建好后填写) =====
// 模板复制起始点/终点(引擎结构上限 64×384×64,纵向取满为 y -64~319)
export const TEMPLATE_FROM = { x: -12, y: -64, z: -12 };
export const TEMPLATE_TO = { x: 12, y: 319, z: 12 };
// 每个房间维度内放置场地的原点坐标(结构 from 角落在该位置)
export const ROOM_COPY_ORIGIN = { x: -12, y: -64, z: -12 };
// 准备房间坐标:与场地位于同一房间维度的不同位置,随 game.register 上报给 Core
export const PREP_SPAWN = { x: 0, y: 0, z: 0 };
// 常加载区域:只需覆盖实际内容,不要整列 384 层(节省每包 chunk 上限)
export const TICKING_FROM = { x: -12, y: -1, z: -12 };
export const TICKING_TO = { x: 12, y: 65, z: 12 };
// 从模板捕获的结构标识
export const STRUCTURE_ID = "bearcade:pigcatcher_room";
// 开发命令 /bearcade:tmp tp pigcatcher 进入模板维度的落点
export const TEMPLATE_SPAWN = { x: 0, y: 100, z: 0 };
// 开局站位(占位,实际按队伍出生点传送)
export const START_POSITIONS = [
  { x: -10, y: 65, z: 0 },
  { x: 0, y: 65, z: -10 },
  { x: 10, y: 65, z: 0 },
  { x: 0, y: 65, z: 10 },
];

// ===== 运行时可配置项(供 /bearcade:config 修改,持久化优先) =====
export interface PigConfig {
  prepSpawn: Vec3;
  mapBoundary: Region;
  pigSpawn: Vec3;
  pigInitialCount: number;
  pigSpawnBatch: number;
  pigRespawnIntervalTicks: number;
  gameDurationTicks: number;
  lureRadius: number;
  lureStrength: number;
  teamSpawns: Record<Team, Vec3>;
  cores: Record<Team, Region>;
}

const TEAM_SPAWNS_DEFAULT: Record<Team, Vec3> = {
  red: { x: -10, y: 65, z: 0 },
  yellow: { x: 0, y: 65, z: -10 },
  blue: { x: 10, y: 65, z: 0 },
  green: { x: 0, y: 65, z: 10 },
};

const CORES_DEFAULT: Record<Team, Region> = {
  red: { from: { x: -10, y: 64, z: -2 }, to: { x: -7, y: 66, z: 2 } },
  yellow: { from: { x: -2, y: 64, z: -10 }, to: { x: 2, y: 66, z: -7 } },
  blue: { from: { x: 7, y: 64, z: -2 }, to: { x: 10, y: 66, z: 2 } },
  green: { from: { x: -2, y: 64, z: 7 }, to: { x: 2, y: 66, z: 10 } },
};

export const PIG_CONFIG_DEFAULTS: PigConfig = {
  prepSpawn: PREP_SPAWN,
  mapBoundary: { from: TEMPLATE_FROM, to: TEMPLATE_TO },
  pigSpawn: { x: 0, y: 65, z: 0 },
  pigInitialCount: PIG_INITIAL_COUNT,
  pigSpawnBatch: PIG_SPAWN_BATCH,
  pigRespawnIntervalTicks: PIG_RESPAWN_INTERVAL_TICKS,
  gameDurationTicks: GAME_DURATION_TICKS,
  lureRadius: LURE_RADIUS,
  lureStrength: LURE_STRENGTH,
  teamSpawns: { ...TEAM_SPAWNS_DEFAULT },
  cores: { ...CORES_DEFAULT },
};
