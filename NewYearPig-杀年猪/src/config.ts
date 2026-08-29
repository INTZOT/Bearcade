// ============================================================
// 杀年猪(NewYearPig)配置
// 玩法:32×32 草方块地皮上持续刷新鸡/猪/羊,玩家限时击杀得分;
// 约 30% 动物为红色 -50%,击杀后当前总分减半。
// 特殊事件:随机时间刷新“只剩 3 耐久钻石剑”,以及“牛来”特殊牛。
// ============================================================
import type { Vec3 } from "../../shared/minigame-core/types";

export const GAME_ID = "newyearpig";
export const DISPLAY_NAME = "杀年猪";
export const PACK_ID = "3d4dbe7a-189c-432d-bebb-747d99163ede";
export const IPC_CHANNEL = "bearcade:ipc";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";

// 人数与派对配置
export const ROOM_COUNT = 4;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const PARTY_AVAILABLE = true;

// ===== 场地坐标(模板维度建好场地后可按需调整) =====
// 45×45 草方块地皮:默认中心为 (0,0),一个角在 (-22,64,-22)
export const MAP_ORIGIN = { x: -22, y: 64, z: -22 };
export const MAP_SIZE = 45;

export const TEMPLATE_FROM = { x: -22, y: -64, z: -22 };
export const TEMPLATE_TO = { x: 22, y: 319, z: 22 };
export const ROOM_COPY_ORIGIN = { x: -22, y: -64, z: -22 };
export const PREP_SPAWN = { x: 0, y: 65, z: 0 };
export const TICKING_FROM = { x: -22, y: -1, z: -22 };
export const TICKING_TO = { x: 22, y: 65, z: 22 };
export const STRUCTURE_ID = "bearcade:newyearpig_room";
export const TEMPLATE_SPAWN = { x: 0, y: 100, z: 0 };
export const START_POSITIONS = [
  { x: -2, y: 65, z: 0 },
  { x: 2, y: 65, z: 0 },
  { x: 0, y: 65, z: -2 },
  { x: 0, y: 65, z: 2 },
  { x: -4, y: 65, z: 0 },
  { x: 4, y: 65, z: 0 },
  { x: 0, y: 65, z: -4 },
  { x: 0, y: 65, z: 4 },
];

// ===== 动物类型 =====
// 普通动物:鸡/猪/羊;cow 仅用于特殊事件“牛来”
export type AnimalKind = "chicken" | "pig" | "sheep" | "cow";

export const ANIMAL_TYPES: Record<AnimalKind, string> = {
  chicken: "minecraft:chicken",
  pig: "minecraft:pig",
  sheep: "minecraft:sheep",
  cow: "minecraft:cow",
};

export const ANIMAL_POINTS: Record<AnimalKind, number> = {
  chicken: 1,
  pig: 5,
  sheep: 3,
  cow: 10,
};

/** 开局发给玩家的武器:木剑攻击伤害 4,配合血量实现鸡 1 击 / 猪羊 2 击 */
export const PLAYER_WEAPON = "minecraft:wooden_sword";

export const ANIMAL_HEALTH: Record<AnimalKind, number> = {
  chicken: 4,
  pig: 8,
  sheep: 8,
  cow: 25,
};

/** 普通动物常驻速度:猪速度 IV(amplifier 3),羊速度 III(amplifier 2);牛来速度 VI(amplifier 5) */
export const ANIMAL_SPEED_AMPLIFIER: Partial<Record<AnimalKind, number>> = {
  pig: 3,
  sheep: 2,
  cow: 5,
};

/** 悬浮字在动物头顶的高度偏移(按体型微调) */
export const ANIMAL_TEXT_OFFSET: Record<AnimalKind, number> = {
  chicken: 1.5,
  pig: 2.1,
  sheep: 2.5,
  cow: 2.5,
};

export const ANIMAL_TEXT: Record<AnimalKind, string> = {
  chicken: "§a+1",
  pig: "§e+5",
  sheep: "§6+3",
  cow: "§e+10",
};

export const CURSED_TEXT = "§c-50%";

// ===== 特殊事件默认参数 =====
// 实际耐久 2,但公告仍播报 3(按需求保留播报文案)
export const DIAMOND_SWORD_DURABILITY_LEFT = 2;
export const DIAMOND_SWORD_ANNOUNCE_DURABILITY = 3;
export const SPECIAL_COW_HEALTH = 25;
export const SPECIAL_COW_POINTS = 10;
export const SPECIAL_COW_SPEED_AMPLIFIER = 5;

// 事件窗口按“剩余秒数”配置
export const SWORD_SPAWN_FIRST_MIN_REMAINING = 50;
export const SWORD_SPAWN_FIRST_MAX_REMAINING = 70;
export const SWORD_SPAWN_SECOND_MIN_REMAINING = 20;
export const SWORD_SPAWN_SECOND_MAX_REMAINING = 40;
export const SPECIAL_COW_MIN_REMAINING = 20;
export const SPECIAL_COW_MAX_REMAINING = 40;

// ===== 运行时可配置项(供 /bearcade:config 修改,持久化优先) =====
export interface NewYearPigConfig {
  prepSpawn: Vec3;
  /** 草方块地皮的一个角(方块坐标);y 为草方块所在层 */
  mapOrigin: Vec3;
  /** 地皮边长(格),默认 32 */
  mapSize: number;
  /** 一局时长(秒),默认 90 */
  gameDurationSeconds: number;
  /** 开局一次性生成数量 */
  initialSpawnCount: number;
  /** 每多少秒生成一批动物 */
  spawnIntervalSeconds: number;
  /** 每批基础生成数量 */
  spawnBatchBase: number;
  /** 每增加多少名玩家额外多生成 1 只/批;0 表示不按人数加成 */
  playersPerExtraSpawn: number;
  /** 场上动物数量上限,防止过度拥挤 */
  maxAnimals: number;
  /** -50% 动物出现概率(百分比 0~100),默认 20 */
  cursedChancePercent: number;
  /** 猪/羊受惊逃跑秒数;0 = 一直逃跑 */
  fleeSeconds: number;
  /** 受惊逃跑时每 tick 冲量强度(调大可跑更快更远) */
  panicStrength: number;
  chickenPoints: number;
  pigPoints: number;
  sheepPoints: number;
  /** 随机生成权重:鸡/猪/羊 */
  chickenWeight: number;
  pigWeight: number;
  sheepWeight: number;
  /** 特殊事件:钻石剑实际剩余耐久 */
  diamondSwordDurabilityLeft: number;
  /** 特殊事件:钻石剑公告播报的耐久(与实际可不同) */
  diamondSwordAnnounceDurability: number;
  /** 特殊事件:牛来血量 */
  specialCowHealth: number;
  /** 特殊事件:牛来分值 */
  specialCowPoints: number;
  /** 特殊事件:牛来速度等级 amplifier */
  specialCowSpeedAmplifier: number;
  /** 特殊事件窗口(剩余秒数) */
  swordSpawnFirstMinRemaining: number;
  swordSpawnFirstMaxRemaining: number;
  swordSpawnSecondMinRemaining: number;
  swordSpawnSecondMaxRemaining: number;
  specialCowMinRemaining: number;
  specialCowMaxRemaining: number;
}

export const NEW_YEAR_PIG_CONFIG_DEFAULTS: NewYearPigConfig = {
  prepSpawn: PREP_SPAWN,
  mapOrigin: MAP_ORIGIN,
  mapSize: MAP_SIZE,
  gameDurationSeconds: 90,
  initialSpawnCount: 12,
  spawnIntervalSeconds: 1,
  spawnBatchBase: 2,
  playersPerExtraSpawn: 3,
  maxAnimals: 120,
  cursedChancePercent: 20,
  fleeSeconds: 15,
  panicStrength: 0.35,
  chickenPoints: ANIMAL_POINTS.chicken,
  pigPoints: ANIMAL_POINTS.pig,
  sheepPoints: ANIMAL_POINTS.sheep,
  chickenWeight: 5,
  pigWeight: 3,
  sheepWeight: 2,
  diamondSwordDurabilityLeft: DIAMOND_SWORD_DURABILITY_LEFT,
  diamondSwordAnnounceDurability: DIAMOND_SWORD_ANNOUNCE_DURABILITY,
  specialCowHealth: SPECIAL_COW_HEALTH,
  specialCowPoints: SPECIAL_COW_POINTS,
  specialCowSpeedAmplifier: SPECIAL_COW_SPEED_AMPLIFIER,
  swordSpawnFirstMinRemaining: SWORD_SPAWN_FIRST_MIN_REMAINING,
  swordSpawnFirstMaxRemaining: SWORD_SPAWN_FIRST_MAX_REMAINING,
  swordSpawnSecondMinRemaining: SWORD_SPAWN_SECOND_MIN_REMAINING,
  swordSpawnSecondMaxRemaining: SWORD_SPAWN_SECOND_MAX_REMAINING,
  specialCowMinRemaining: SPECIAL_COW_MIN_REMAINING,
  specialCowMaxRemaining: SPECIAL_COW_MAX_REMAINING,
};
