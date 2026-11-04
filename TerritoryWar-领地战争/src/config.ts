// ============================================================
// 领地战争(TerritoryWar)配置
//
// 玩法(源自《围城大作战》/ Surround.io):
// - 以自己的领地为起点向外移动,身后拖出尾迹;
// - 再次回到自己领土时,尾迹圈住的区域(含圈到的他人领土)全部归自己;
// - 踩断别人的尾迹即击杀对方,对方领土清零并复活重开;
// - 限时对局,时间到按领土占比排名(达成占比目标可提前结束)。
// ============================================================
export const GAME_ID = "territory_war";
export const DISPLAY_NAME = "领地战争";
export const PACK_ID = "73f75e88-36ae-4b64-8e9f-1eb5bdc99da0";
export const IPC_CHANNEL = "bearcade:ipc";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";

// ===== 规模 =====
export const ROOM_COUNT = 2;
/** 每种颜色对应一名玩家,因此上限 = PLAYER_COLORS.length(8) */
export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 1;
/** 派对模式会让全服玩家进同一房间,超过 8 人会复用颜色,故不开放 */
export const PARTY_AVAILABLE = false;

// ===== 场地坐标 =====
// 模板范围覆盖:41×41 领地 + 外墙(±22)+ 准备平台(z -28~-22),纵向只取场地附近,
// 避免 57×384×57 的超大结构捕获(单块上限 64×384×64,这里 57×25×57 一块即可)。
export const TEMPLATE_FROM = { x: -28, y: 56, z: -28 };
export const TEMPLATE_TO = { x: 28, y: 80, z: 28 };
export const ROOM_COPY_ORIGIN = { x: -28, y: 56, z: -28 };
// 准备房间:场地北侧 7×7 平台上方(FIELD_Y 为地面方块层,站立在 +1 层)
export const PREP_SPAWN = { x: 0, y: 64, z: -25 };
// 常加载区按区块(X/Z)生效:57×57 → 4×4 = 16 区块/房
export const TICKING_FROM = { x: -28, y: 56, z: -28 };
export const TICKING_TO = { x: 28, y: 80, z: 28 };
export const STRUCTURE_ID = "bearcade:territory_war_room";
// /bearcade:tmp tp territory_war 的落点(场地正上方,便于俯视建图)
export const TEMPLATE_SPAWN = { x: 0, y: 90, z: 0 };

// ===== 场地 =====
/** 领地边长(格,奇数;可选 15~57) */
export const FIELD_SIZE = 41;
/** 场地中心(格坐标,领地以它为中心展开) */
export const FIELD_CENTER_X = 0;
export const FIELD_CENTER_Z = 0;
/** 领地地面方块所在层;玩家站立在 FIELD_Y + 1 */
export const FIELD_Y = 63;
/** 中立地面方块 */
export const NEUTRAL_BLOCK = "minecraft:white_concrete";

// ===== 规则 =====
/** 一局时长(秒) */
export const GAME_DURATION_SECONDS = 180;
/** 被击杀后复活等待(秒);0 = 淘汰不复活 */
export const RESPAWN_SECONDS = 5;
/** 开局/复活的初始领地边长(格,奇数) */
export const START_PLOT_SIZE = 3;
/** 领土占比达到该百分比直接获胜 */
export const WIN_PERCENT = 60;
/** 加速效果等级(0 = 无加速) */
export const SPEED_AMPLIFIER = 1;

/**
 * 玩家颜色表:序号即"颜色槽",同一房间内一名玩家占一个槽。
 * 领土 = 混凝土(纯色高对比),尾迹 = 羊毛(带纹理,便于区分"未落定"区域)。
 */
export interface TerritoryColor {
  /** 中文色名(公告/配置界面用) */
  name: string;
  /** 聊天与 HUD 颜色码 */
  code: string;
  /** 已经圈定的领土方块 */
  territory: string;
  /** 拖出中的尾迹方块 */
  trail: string;
}

export const PLAYER_COLORS: readonly TerritoryColor[] = [
  {
    name: "红",
    code: "§c",
    territory: "minecraft:red_concrete",
    trail: "minecraft:red_wool",
  },
  {
    name: "蓝",
    code: "§9",
    territory: "minecraft:blue_concrete",
    trail: "minecraft:blue_wool",
  },
  {
    name: "绿",
    code: "§a",
    territory: "minecraft:lime_concrete",
    trail: "minecraft:lime_wool",
  },
  {
    name: "黄",
    code: "§e",
    territory: "minecraft:yellow_concrete",
    trail: "minecraft:yellow_wool",
  },
  {
    name: "橙",
    code: "§6",
    territory: "minecraft:orange_concrete",
    trail: "minecraft:orange_wool",
  },
  {
    name: "紫",
    code: "§5",
    territory: "minecraft:purple_concrete",
    trail: "minecraft:purple_wool",
  },
  {
    name: "青",
    code: "§b",
    territory: "minecraft:cyan_concrete",
    trail: "minecraft:cyan_wool",
  },
  {
    name: "粉",
    code: "§d",
    territory: "minecraft:pink_concrete",
    trail: "minecraft:pink_wool",
  },
];

/** 场地边长允许范围(奇数);上限受模板范围(±28)与准备平台位置约束 */
export const FIELD_SIZE_MIN = 15;
export const FIELD_SIZE_MAX = 41;

// ===== 运行时可配置项(供 /bearcade:config 修改,动态属性持久化优先于代码默认值) =====
export interface TerritoryWarConfig {
  prepSpawn: { x: number; y: number; z: number };
  /** 场地中心 X/Z(格坐标) */
  centerX: number;
  centerZ: number;
  /** 领地边长(格,奇数) */
  fieldSize: number;
  /** 领地地面层(Y) */
  fieldY: number;
  /** 一局时长(秒) */
  gameDurationSeconds: number;
  /** 死亡复活等待(秒),0 = 淘汰不复活 */
  respawnSeconds: number;
  /** 初始领地边长(格,奇数) */
  startPlotSize: number;
  /** 领土占比达到该百分比直接获胜 */
  winPercent: number;
  /** 加速效果等级(0~3) */
  speedAmplifier: number;
}

export const TERRITORY_WAR_CONFIG_DEFAULTS: TerritoryWarConfig = {
  prepSpawn: PREP_SPAWN,
  centerX: FIELD_CENTER_X,
  centerZ: FIELD_CENTER_Z,
  fieldSize: FIELD_SIZE,
  fieldY: FIELD_Y,
  gameDurationSeconds: GAME_DURATION_SECONDS,
  respawnSeconds: RESPAWN_SECONDS,
  startPlotSize: START_PLOT_SIZE,
  winPercent: WIN_PERCENT,
  speedAmplifier: SPEED_AMPLIFIER,
};
