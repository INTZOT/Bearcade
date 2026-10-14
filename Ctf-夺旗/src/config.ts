// ============================================================
// 夺旗(Ctf)配置
// 玩法:红蓝两队夺旗对抗(旗帜掉落回城、经济与物品商店、TNT 与搭桥)。
// 房间管理复用 shared/minigame-core,玩法实现在 src/game.ts。
// 注意:下方"场地坐标"仍为模板占位值,需在模板维度建好场地后填写,
//      或用 /bearcade:tmp sz ctf 表单配置,再 /bearcade:tmp ap ctf 应用。
// ============================================================
import type { Vec3 } from "../../shared/minigame-core/types";

export const GAME_ID = "ctf";
export const DISPLAY_NAME = "夺旗";
export const PACK_ID = "b7bf4418-3194-41a9-b4af-89219c8e247a";
export const IPC_CHANNEL = "bearcade:ipc";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";
export const ROOM_COUNT = 2;
export const MAX_PLAYERS = 12;
export const MIN_PLAYERS = 1;
// 派对模式可用性:去除最大人数上限后仍可正常运行才设为 true
export const PARTY_AVAILABLE = false;

// ===== 以下坐标由开发者在模板维度建好场地后填写 =====
// 模板复制起始点/终点(引擎结构上限 64×384×64,纵向取满为 y -64~319)
export const TEMPLATE_FROM = { x: -7, y: -64, z: -7 };
export const TEMPLATE_TO = { x: 7, y: 319, z: 7 };
// 每个房间维度内放置场地的原点坐标(结构 from 角落在该位置)
export const ROOM_COPY_ORIGIN = { x: -7, y: -64, z: -7 };
// 准备房间坐标:与场地位于同一房间维度的不同位置,随 game.register 上报给 Core
export const PREP_SPAWN = { x: 0, y: 64, z: 0 };
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

// ===== 初始装备(物品 ID 不支持表单编辑,保留为代码常量) =====
export const INITIAL_ARMOR = {
  leggings: "minecraft:diamond_leggings",
  boots: "minecraft:diamond_boots",
} as const;
export const INITIAL_INVENTORY = [
  { item: "minecraft:diamond_sword", count: 1 },
  { item: "minecraft:bow", count: 1 },
  { item: "minecraft:arrow", count: 16 },
] as const;

// ===== 运行时可配置项(供 /bearcade:config ctf 修改,持久化优先) =====
export interface TeamConfig {
  id: string;
  name: string;
  color: string;
  hex: string;
  spawnPoint: Vec3;
  flagHomePosition: Vec3;
}

export interface CTFConfig {
  prepSpawn: Vec3;
  /** 各队定义(出生点/旗帜位置,与 TeamManager 对齐) */
  teams: TeamConfig[];
  /** 获胜所需分数 */
  maxScore: number;
  /** 对局时长(秒) */
  matchTime: number;
  /** 旗帜掉落后自动回城时间(秒) */
  flagReturnTime: number;
  /** 玩家复活等待时间(秒) */
  respawnTime: number;
  /** 初始羊毛方块数量 */
  initialBlockCount: number;
  /** 箭矢破坏玩家放置方块的默认/升级半径(格) */
  arrowBreakRadius: number;
  arrowBreakRadiusUpgraded: number;
  /** 击杀敌人后恢复的血量(半心单位) */
  killRestoration: number;
  /** 在水中持续多少刻后开始受到伤害 */
  waterDamageTriggerDelay: number;
  /** 水中周期性伤害值(半心单位) */
  waterDamage: number;
  /** 生命恢复:受伤后延迟秒数 / 每秒恢复量 */
  regenDelaySeconds: number;
  regenPerSecond: number;
  /** 旗帜诅咒:触发秒数 / 被诅咒者生命上限(半心单位) */
  flagCurseTriggerSeconds: number;
  flagCurseMaxHealth: number;
  /** TNT:引信(刻)/ 爆炸半径(格)/ 伤害(半心单位) */
  tntFuseTicks: number;
  tntExplosionRadius: number;
  tntPlayerDamage: number;
  /** 经济:初始/击杀/夺旗/胜利/每秒 */
  economyInitial: number;
  economyKillReward: number;
  economyFlagReward: number;
  economyWinReward: number;
  economyTickReward: number;
  /** 商店实体位置 */
  itemShops: Vec3[];
  buffShops: Vec3[];
  /** 旗帜拾取/归还判定半径(格) */
  captureRadius: number;
}

export const CTF_CONFIG_DEFAULTS: CTFConfig = {
  prepSpawn: PREP_SPAWN,
  teams: [
    {
      id: "blue",
      name: "蓝队",
      color: "blue",
      hex: "#5555FF",
      spawnPoint: { x: 5, y: 65, z: 0 },
      flagHomePosition: { x: 6, y: 65, z: 0 },
    },
    {
      id: "green",
      name: "绿队",
      color: "green",
      hex: "#55FF55",
      spawnPoint: { x: -5, y: 65, z: 0 },
      flagHomePosition: { x: -6, y: 65, z: 0 },
    },
  ],
  maxScore: 3,
  matchTime: 300,
  flagReturnTime: 15,
  respawnTime: 5,
  initialBlockCount: 32,
  arrowBreakRadius: 0.5,
  arrowBreakRadiusUpgraded: 1.5,
  killRestoration: 6,
  waterDamageTriggerDelay: 20,
  waterDamage: 4,
  regenDelaySeconds: 15,
  regenPerSecond: 1,
  flagCurseTriggerSeconds: 180,
  flagCurseMaxHealth: 6,
  tntFuseTicks: 80,
  tntExplosionRadius: 4,
  tntPlayerDamage: 8,
  economyInitial: 200,
  economyKillReward: 15,
  economyFlagReward: 150,
  economyWinReward: 100,
  economyTickReward: 1,
  itemShops: [
    { x: -1, y: 65, z: 0 },
    { x: 1, y: 65, z: 0 },
  ],
  buffShops: [
    { x: -2, y: 65, z: 0 },
    { x: 2, y: 65, z: 0 },
  ],
  captureRadius: 1,
};
