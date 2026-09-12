// ============================================================
// 麻将(Mahjong)小游戏配置
// 牡丹江麻将已实现:8 房 / 3~4 人 / 房主开局 / 牌墙生成 / 场地构建,
// 吃碰杠听胡、宝牌/换宝、计分、流局/下一局、离线托管。
// ============================================================
export const GAME_ID = "mahjong";
export const DISPLAY_NAME = "麻将";
export const PACK_ID = "6d0963dd-a2cf-4cf6-9218-41d584f26221";
export const IPC_CHANNEL = "bearcade:ipc";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";

// 人数与房间
export const ROOM_COUNT = 8;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 4;
export const PARTY_AVAILABLE = false;

// ===== 场地坐标(模板维度内构建,26×26 方形) =====
export const FIELD_Y = 64; // 地板所在 Y
export const FIELD_MIN_X = -12;
export const FIELD_MAX_X = 13; // 26 格:-12 ~ 13
export const FIELD_MIN_Z = -12;
export const FIELD_MAX_Z = 13;
export const DICE_POS = { x: 0, y: FIELD_Y + 1, z: -1 };

// 四个座位(南/西/北/东),3 人时只使用前 3 个
export const SEAT_POSITIONS = [
  { x: 0, y: FIELD_Y + 1, z: 9 },
  { x: -9, y: FIELD_Y + 1, z: 0 },
  { x: 0, y: FIELD_Y + 1, z: -9 },
  { x: 9, y: FIELD_Y + 1, z: 0 },
];

// 每侧计分按钮(加/减),与座位一一对应
export const SCORE_BUTTONS = [
  { plus: { x: -1, y: FIELD_Y + 1, z: 12 }, minus: { x: 1, y: FIELD_Y + 1, z: 12 } },
  { plus: { x: -12, y: FIELD_Y + 1, z: -1 }, minus: { x: -12, y: FIELD_Y + 1, z: 1 } },
  { plus: { x: -1, y: FIELD_Y + 1, z: -12 }, minus: { x: 1, y: FIELD_Y + 1, z: -12 } },
  { plus: { x: 12, y: FIELD_Y + 1, z: -1 }, minus: { x: 12, y: FIELD_Y + 1, z: 1 } },
];

// 模板捕获范围(含地板、边界、骰子与计分按钮)
export const TEMPLATE_FROM = { x: -13, y: 63, z: -13 };
export const TEMPLATE_TO = { x: 14, y: 70, z: 14 };
export const ROOM_COPY_ORIGIN = { x: -13, y: 63, z: -13 };
export const PREP_SPAWN = { x: 0, y: FIELD_Y + 1, z: 2 };
export const TICKING_FROM = { x: -13, y: 63, z: -13 };
export const TICKING_TO = { x: 14, y: 70, z: 14 };
export const STRUCTURE_ID = "bearcade:mahjong_room";
export const TEMPLATE_SPAWN = { x: 0, y: 100, z: 0 };

// ===== 麻将牌定义 =====
export interface TileCategory {
  key: string;
  name: string;
  tiles: string[]; // 形如 mahjong_a1
}

export const TILE_CATEGORIES: TileCategory[] = [
  { key: "a", name: "万", tiles: Array.from({ length: 9 }, (_, i) => `mahjong_a${i + 1}`) },
  { key: "b", name: "条", tiles: Array.from({ length: 9 }, (_, i) => `mahjong_b${i + 1}`) },
  { key: "c", name: "饼", tiles: Array.from({ length: 9 }, (_, i) => `mahjong_c${i + 1}`) },
  { key: "d", name: "风", tiles: ["mahjong_d1", "mahjong_d2", "mahjong_d3", "mahjong_d4"] },
  { key: "e", name: "字", tiles: ["mahjong_e1", "mahjong_e2", "mahjong_e3"] },
];

export const ALL_TILE_IDS: string[] = TILE_CATEGORIES.flatMap((c) => c.tiles);

/** 牡丹江麻将牌组:万/条/饼 1-9 ×4 + 红中 ×4 = 112 张 */
export const MUDANJIANG_TILE_SET: string[] = [
  ...TILE_CATEGORIES[0].tiles,
  ...TILE_CATEGORIES[1].tiles,
  ...TILE_CATEGORIES[2].tiles,
  "mahjong_e1",
];

export interface MahjongPreset {
  id: number;
  name: string;
  tiles: string[];
  /** 花牌未制作前,预设 7 与预设 5 相同 */
  note?: string;
}

export const PRESETS: MahjongPreset[] = [
  {
    id: 1,
    name: "预设1:万条筒",
    tiles: [...TILE_CATEGORIES[0].tiles, ...TILE_CATEGORIES[1].tiles, ...TILE_CATEGORIES[2].tiles],
  },
  {
    id: 2,
    name: "预设2:万条筒+东南西北",
    tiles: [...TILE_CATEGORIES[0].tiles, ...TILE_CATEGORIES[1].tiles, ...TILE_CATEGORIES[2].tiles, ...TILE_CATEGORIES[3].tiles],
  },
  {
    id: 3,
    name: "预设3:万条筒+中",
    tiles: [...TILE_CATEGORIES[0].tiles, ...TILE_CATEGORIES[1].tiles, ...TILE_CATEGORIES[2].tiles, "mahjong_e1"],
  },
  {
    id: 4,
    name: "预设4:万条筒+中发白",
    tiles: [...TILE_CATEGORIES[0].tiles, ...TILE_CATEGORIES[1].tiles, ...TILE_CATEGORIES[2].tiles, ...TILE_CATEGORIES[4].tiles],
  },
  {
    id: 5,
    name: "预设5:万条筒+东南西北中发白",
    tiles: [...TILE_CATEGORIES[0].tiles, ...TILE_CATEGORIES[1].tiles, ...TILE_CATEGORIES[2].tiles, ...TILE_CATEGORIES[3].tiles, ...TILE_CATEGORIES[4].tiles],
  },
  {
    id: 7,
    name: "预设7:万条筒+东南西北中发白+花(花未制作)",
    tiles: [...TILE_CATEGORIES[0].tiles, ...TILE_CATEGORIES[1].tiles, ...TILE_CATEGORIES[2].tiles, ...TILE_CATEGORIES[3].tiles, ...TILE_CATEGORIES[4].tiles],
    note: "花牌尚未制作,当前与预设 5 相同",
  },
];

/** 每个玩家每种牌的数量(标准 4 张) */
export const TILE_COPIES = 4;

// ===== 运行时可配置项(供 /bearcade:config mahjong 修改,持久化优先) =====
export interface MahjongConfig {
  prepSpawn: { x: number; y: number; z: number };
  fieldY: number;
  fieldMinX: number;
  fieldMaxX: number;
  fieldMinZ: number;
  fieldMaxZ: number;
  dicePos: { x: number; y: number; z: number };
  seatPositions: { x: number; y: number; z: number }[];
  /** 牌垛到场地中心的距离 */
  stackInset: number;
  /** 手牌展示行到场地中心的距离 */
  handDisplayOffset: number;
  /** 副露(吃/碰/杠)到场地中心的距离 */
  meldDisplayOffset: number;
  /** 手牌展示行长度(最多几张) */
  handRowLength: number;
  /** 第一张打出牌离骰子中心的距离 */
  discardStartOffset: number;
  /** 牌河每行最多几个 */
  discardRowLength: number;
}

export const MAHJONG_CONFIG_DEFAULTS: MahjongConfig = {
  prepSpawn: PREP_SPAWN,
  fieldY: FIELD_Y,
  fieldMinX: FIELD_MIN_X,
  fieldMaxX: FIELD_MAX_X,
  fieldMinZ: FIELD_MIN_Z,
  fieldMaxZ: FIELD_MAX_Z,
  dicePos: DICE_POS,
  seatPositions: [
    SEAT_POSITIONS[0],
    SEAT_POSITIONS[3],
    SEAT_POSITIONS[2],
    SEAT_POSITIONS[1],
  ],
  stackInset: 7,
  handDisplayOffset: 10,
  meldDisplayOffset: 8,
  handRowLength: 14,
  discardStartOffset: 1,
  discardRowLength: 6,
};
