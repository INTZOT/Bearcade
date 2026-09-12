// ============================================================
// 工作室(Studio)配置
// 玩法:合成制作交付类——每回合从题库抽一个目标物品,玩家在工作室中
// 采集原材料并使用工作台/熔炉合成,前三名完成者得分。
// 所有可调参数均可经 /bearcade:config studio 修改,持久化优先。
// ============================================================
import type { Vec3 } from "../../shared/minigame-core/types";

export const GAME_ID = "studio";
export const DISPLAY_NAME = "工作室";
export const PACK_ID = "b9d20ffb-810a-4bfb-ac25-38c7447562f7";
export const IPC_CHANNEL = "bearcade:ipc";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";

// 房间与人数:2 房 / 普通模式 2~8 人 / 派对模式不限人数(可超过 8 人)
export const ROOM_COUNT = 2;
export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;
export const PARTY_AVAILABLE = true;

// ===== 地图几何(单位:方块) =====
// groundY 是地面表面 Y(玩家站在地面时的脚底 Y);地面方块在 groundY-1
export const GROUND_Y = 64;
// 默认场地边长(奇数),可用 /studio:build <尺寸> 重新生成
export const DEFAULT_ARENA_SIZE = 21;
export const MIN_ARENA_SIZE = 11;
export const MAX_ARENA_SIZE = 41;
// 墙壁高度:墙壁从 groundY 到 groundY+WALL_HEIGHT-1,天花板在 groundY+WALL_HEIGHT
export const WALL_HEIGHT = 5;

// ===== 模板范围(按默认 21×21 场地预留,实际以 /bearcade:tmp sz 为准) =====
const DEFAULT_HALF = Math.floor(DEFAULT_ARENA_SIZE / 2);
export const TEMPLATE_FROM = {
  x: -DEFAULT_HALF,
  y: GROUND_Y - 1,
  z: -DEFAULT_HALF,
};
export const TEMPLATE_TO = {
  x: DEFAULT_HALF,
  y: GROUND_Y + WALL_HEIGHT + 1,
  z: DEFAULT_HALF,
};
export const ROOM_COPY_ORIGIN = { ...TEMPLATE_FROM };
// 准备房间坐标:放在场地中央上方,开局后由 onGameStart 统一传送到各自出生点
export const PREP_SPAWN = { x: 0, y: GROUND_Y + 2, z: 0 };
// 常加载区域:只覆盖实际场地,不要整列 384 层
export const TICKING_FROM = { ...TEMPLATE_FROM };
export const TICKING_TO = { ...TEMPLATE_TO };
export const STRUCTURE_ID = "bearcade:studio_room";
// 开发命令 /bearcade:tmp tp studio 进入模板维度的落点
export const TEMPLATE_SPAWN = { x: 0, y: GROUND_Y + WALL_HEIGHT + 4, z: 0 };
// 开局站位(与 MAX_PLAYERS 对应;派对人数更多时按模循环)
export const START_POSITIONS: Vec3[] = [
  { x: -4, y: GROUND_Y, z: -4 },
  { x: 4, y: GROUND_Y, z: -4 },
  { x: -4, y: GROUND_Y, z: 4 },
  { x: 4, y: GROUND_Y, z: 4 },
  { x: -4, y: GROUND_Y, z: 0 },
  { x: 4, y: GROUND_Y, z: 0 },
  { x: 0, y: GROUND_Y, z: -4 },
  { x: 0, y: GROUND_Y, z: 4 },
];

// ===== 默认题库(目标物品,可经 /bearcade:config studio 调整) =====
export const DEFAULT_TARGET_ITEMS = [
  "minecraft:furnace",
  "minecraft:crafting_table",
  "minecraft:bed",
  "minecraft:barrel",
  "minecraft:bucket",
  "minecraft:activator_rail",
  "minecraft:comparator",
] as const;

// 默认原材料(货架上可挖掘采集的方块,可经 /bearcade:config studio 调整)
export const DEFAULT_MATERIAL_BLOCKS = [
  "minecraft:oak_log",
  "minecraft:stone",
  "minecraft:white_wool",
  "minecraft:coal_ore",
  "minecraft:iron_ore",
  "minecraft:gold_ore",
  "minecraft:quartz_ore",
  "minecraft:redstone_ore",
] as const;

// 目标物品显示名(未知物品回退显示原始 ID)
export const TARGET_ITEM_NAMES: Record<string, string> = {
  "minecraft:furnace": "熔炉",
  "minecraft:crafting_table": "工作台",
  "minecraft:bed": "床",
  "minecraft:barrel": "木桶",
  "minecraft:bucket": "桶",
  "minecraft:activator_rail": "激活铁轨",
  "minecraft:redstone_comparator": "红石比较器",
  "minecraft:comparator": "红石比较器",
  "minecraft:piston": "活塞",
  "minecraft:dispenser": "发射器",
  "minecraft:hopper": "漏斗",
  "minecraft:iron_door": "铁门",
  "minecraft:golden_apple": "金苹果",
};

// ===== 运行时配置(经 /bearcade:config studio 修改,持久化优先) =====
export interface StudioConfig {
  prepSpawn: Vec3;
  /** 普通模式单房间最大人数(经 /bearcade:config 可调;派对模式忽略) */
  maxPlayers: number;
  /** 总回合数 */
  roundCount: number;
  /** 单回合无人完成时的超时秒数 */
  roundTimeoutSeconds: number;
  /** 第一名完成后到下一回合的等待秒数 */
  afterFirstSuccessSeconds: number;
  /** 本回合第一/二/三名得分 */
  scoreFirst: number;
  scoreSecond: number;
  scoreThird: number;
  /** 地面表面 Y,供 /studio:build 生成地图 */
  groundY: number;
  /** /studio:build 默认尺寸(边长,奇数) */
  defaultArenaSize: number;
  /** 目标物品题库(物品 ID 列表) */
  targetItems: string[];
  /** 货架原材料方块(方块 ID 列表) */
  materialBlocks: string[];
}

export const STUDIO_CONFIG_DEFAULTS: StudioConfig = {
  prepSpawn: PREP_SPAWN,
  maxPlayers: MAX_PLAYERS,
  roundCount: 7,
  roundTimeoutSeconds: 60,
  afterFirstSuccessSeconds: 10,
  scoreFirst: 3,
  scoreSecond: 2,
  scoreThird: 1,
  groundY: GROUND_Y,
  defaultArenaSize: DEFAULT_ARENA_SIZE,
  targetItems: [...DEFAULT_TARGET_ITEMS],
  materialBlocks: [...DEFAULT_MATERIAL_BLOCKS],
};
