// ============================================================
// HungerGame(饥饿游戏)小游戏配置
// 玩法:FFA 大逃杀——等分圆出生 → 冻结 → 保护期 → PVP → 死斗 → 扣血保底
// ============================================================
export const GAME_ID = "hungergame";
export const DISPLAY_NAME = "饥饿游戏";
export const PACK_ID = "25db9388-fb9c-47c6-ad91-cdf0915ec7d6";
export const IPC_CHANNEL = "bearcade:ipc";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";

// 4~16 人/房,2 间房,支持派对模式(派对下人数可超 16,出生等分圆第二圈)
export const ROOM_COUNT = 2;
export const MAX_PLAYERS = 16;
export const MIN_PLAYERS = 4;

// ===== 模板坐标(512×512 地图:±256;经 tileSize=64 分块应用) =====
export const TEMPLATE_FROM = { x: -256, y: -64, z: -256 };
export const TEMPLATE_TO = { x: 256, y: 319, z: 256 };
export const ROOM_COPY_ORIGIN = { x: -256, y: -64, z: -256 };
export const PREP_SPAWN = { x: 0, y: 0, z: 0 };
// 常加载只覆盖中心区 + 准备房(整图 1024 区块超引擎 100 区块上限)
export const TICKING_FROM = { x: -16, y: -1, z: -16 };
export const TICKING_TO = { x: 16, y: 65, z: 16 };

export const STRUCTURE_ID = "bearcade:hungergame_room";
export const TEMPLATE_SPAWN = { x: 0, y: 100, z: 0 };

// ===== 物资箱方块 =====
export const CHEST_CENTER = "bearcade:hg_center_chest"; // 中心固定箱(2级开局,阶段4重置为4级)
export const CHEST_WILD = "bearcade:hg_wild_chest"; // 野外随机箱(等级随机)
export const CHEST_SLOTS = 27; // 原版箱子大小
export const CHEST_ITEM_MIN = 4; // 每箱刷新物品数
export const CHEST_ITEM_MAX = 8;

// ===== 物资池实体 =====
export const POOL_ENTITY = "bearcade:hg_loot_pool"; // 隐形 inventory 容器实体(每房间每等级 1 个)
export const POOL_LEVELS = 4;
export const POOL_ENTITY_Y = -60; // 房间维度地下(常加载区覆盖 xz)

// ===== 观战 =====
export const SPECTATE_ITEM = "minecraft:spyglass"; // 观战切换物品(淘汰玩家手持使用轮换目标)

// ===== 运行时可配置项(/bearcade:config hungergame,持久化优先) =====
export interface HungerGameConfig {
  prepSpawn: { x: number; y: number; z: number };
  /** 各阶段时长(秒) */
  freezeSeconds: number; // 阶段1:冻结(预热,不可移动)
  protectSeconds: number; // 阶段2:PVP 保护(可移动,可开箱,不可战斗)
  pvp1Seconds: number; // 阶段3:PVP 一阶段
  pvp2Seconds: number; // 阶段4:PVP 二阶段(中心箱重置为 4 级)
  duelSeconds: number; // 阶段5:死斗(传送最终决战场所)
  /** 出生等分圆圆心(场地中心)与半径 */
  spawnCenter: { x: number; y: number; z: number };
  spawnRadius: number;
  /** 派对超员时第二圈半径(16 人内单圈等分) */
  spawnRadiusParty: number;
  /** 死斗场中心(剩余玩家传送后圆形扩散) */
  duelCenter: { x: number; y: number; z: number };
  duelRadius: number;
  /** 阶段6扣血保底:间隔(秒)与每次伤害 */
  bleedInterval: number;
  bleedDamage: number;
  /** 观战台位置(淘汰玩家本体传送至此) */
  spectateSpot: { x: number; y: number; z: number };
}

export const HUNGER_GAME_CONFIG_DEFAULTS: HungerGameConfig = {
  prepSpawn: PREP_SPAWN,
  freezeSeconds: 10,
  protectSeconds: 30,
  pvp1Seconds: 300,
  pvp2Seconds: 300,
  duelSeconds: 120,
  spawnCenter: { x: 0, y: 65, z: 0 },
  spawnRadius: 48,
  spawnRadiusParty: 96,
  duelCenter: { x: 0, y: 65, z: 0 },
  duelRadius: 16,
  bleedInterval: 5,
  bleedDamage: 1,
  spectateSpot: { x: 0, y: 80, z: 0 },
};
