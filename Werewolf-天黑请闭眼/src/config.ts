// ============================================================
// 天黑请闭眼(Werewolf)配置
// 玩法:6~10 人推理派对游戏。夜间狙击手/守卫/杀手/警察依次行动,
// 白天讨论并公投;好人方消灭全部杀手获胜,坏人方消灭全部平民
// 或全部警察获胜。场地沿用旧版《天黑请闭眼》围桌布局。
// ============================================================
import type { Vec3 } from "../../shared/minigame-core/types";

export const GAME_ID = "werewolf";
export const DISPLAY_NAME = "天黑请闭眼";
export const PACK_ID = "42eff47c-569c-4125-8049-21d3cef59a19";
export const IPC_CHANNEL = "bearcade:ipc";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";

// 人数与派对配置
export const ROOM_COUNT = 4;
export const MIN_PLAYERS = 6;
export const MAX_PLAYERS = 10;
export const PARTY_AVAILABLE = false; // 职业表最多支持 10 人,派对模式不可用

// ===== 身份职业表(6~10 人) =====
export type Role = "civilian" | "police" | "guard" | "killer" | "sniper";

export interface RoleCounts {
  civilian: number;
  police: number;
  guard: number;
  killer: number;
  sniper: number;
  /** 狙击手开局子弹数 */
  sniperBullets: number;
}

export const ROLE_COUNTS: Record<number, RoleCounts> = {
  // 5 人为调试配置(指令 /bearcade:ww5 开启后可用):比 6 人少 1 个平民
  5: { civilian: 1, police: 1, guard: 1, killer: 1, sniper: 1, sniperBullets: 1 },
  6: { civilian: 2, police: 1, guard: 1, killer: 1, sniper: 1, sniperBullets: 1 },
  7: { civilian: 3, police: 1, guard: 1, killer: 1, sniper: 1, sniperBullets: 1 },
  8: { civilian: 3, police: 2, guard: 1, killer: 2, sniper: 0, sniperBullets: 0 },
  9: { civilian: 3, police: 2, guard: 1, killer: 2, sniper: 1, sniperBullets: 2 },
  10: { civilian: 4, police: 2, guard: 1, killer: 2, sniper: 1, sniperBullets: 2 },
};

export function roleCountsFor(playerCount: number): RoleCounts {
  return ROLE_COUNTS[playerCount] ?? ROLE_COUNTS[10];
}

export const ROLE_NAMES: Record<Role, string> = {
  civilian: "平民",
  police: "警察",
  guard: "守卫",
  killer: "杀手",
  sniper: "狙击手",
};

export const ROLE_COLORS: Record<Role, string> = {
  civilian: "§f", // 白
  police: "§b", // 浅蓝
  guard: "§e", // 黄
  killer: "§c", // 浅红
  sniper: "§4", // 深红
};

// ===== 阶段时长(秒,可经 /bearcade:config werewolf 修改) =====
export const SNIPER_SECONDS = 30;
export const GUARD_SECONDS = 30;
export const KILLER_SECONDS = 60;
export const POLICE_SECONDS = 60;
export const DAY_SECONDS = 90;

// ===== 交互物品 =====
// 自定义物品 bearcade:werewolf_vote(定义见 items/werewolf_vote.item.json):
// 右键经 on_use 稳定触发 itemUse,完全不占用原版物品,与大厅钟、望远镜等零冲突;
// 用 nameTag 区分"投给 N号"与"取消选择"。
export const ACTION_ITEM = "bearcade:werewolf_vote";
export const CANCEL_NAME = "§c取消选择";
export const VOTE_NAME_PREFIX = "投给 ";

// ===== 场地坐标(旧版围桌场地,结构文件见包内 structures/) =====
// 旧场地结构 mystructure:changdi,尺寸 35×18×35,结构原点 (-14,-61,-18)。
// 在模板维度执行 /structure load changdi -14 -61 -18 后即可捕获复制。
export const TEMPLATE_FROM = { x: -14, y: -61, z: -18 };
export const TEMPLATE_TO = { x: 20, y: 319, z: 16 };
export const ROOM_COPY_ORIGIN = { x: -14, y: -61, z: -18 };
// 准备房间坐标:围桌中央(等待开局用,开局后按座位号落座)
export const PREP_SPAWN = { x: 2, y: -54, z: 0 };
// 常加载区域只覆盖实际场地(围桌 y -61~-44)
export const TICKING_FROM = { x: -14, y: -61, z: -18 };
export const TICKING_TO = { x: 20, y: -30, z: 16 };
export const STRUCTURE_ID = "bearcade:werewolf_room";
export const TEMPLATE_SPAWN = { x: 0, y: 100, z: 0 };

// 10 个座位(1~10 号,沿用旧版围桌布局;从左到右对应色块:
// 绿1、浅蓝2、红3、粉4、黄5、白6、青7、紫8、深蓝9、黑10)
export const SEATS: Vec3[] = [
  { x: -2, y: -57, z: 7 },
  { x: -4, y: -57, z: 7 },
  { x: -6, y: -57, z: 5 },
  { x: -6, y: -57, z: 3 },
  { x: -6, y: -57, z: 1 },
  { x: -6, y: -57, z: -1 },
  { x: -6, y: -57, z: -3 },
  { x: -6, y: -57, z: -5 },
  { x: -4, y: -57, z: -7 },
  { x: -2, y: -57, z: -7 },
];

/** 座位号 -> 名字/名牌颜色(与场地色块一致) */
export const PAD_COLORS: Record<number, string> = {
  1: "§a", // 绿(浅绿)
  2: "§b", // 浅蓝
  3: "§c", // 红
  4: "§d", // 粉
  5: "§e", // 黄
  6: "§f", // 白
  7: "§3", // 青
  8: "§5", // 紫
  9: "§9", // 深蓝
  10: "§0", // 黑
};

/** 按开局人数使用哪些物理座位(色块);玩家号码仍从 1 开始顺序排,颜色跟随所站色块 */
export const USED_SEATS: Record<number, number[]> = {
  5: [3, 4, 5, 6, 7], // 1号红, 2号粉, 3号黄, 4号白, 5号青(调试5人局)
  6: [3, 4, 5, 6, 7, 8], // 1号红, 2号粉, 3号黄, 4号白, 5号青, 6号紫
  7: [3, 4, 5, 6, 7, 8, 9], // ... 7号深蓝
  8: [2, 3, 4, 5, 6, 7, 8, 9], // 1号浅蓝, 2号红, ... 8号深蓝
  9: [2, 3, 4, 5, 6, 7, 8, 9, 10], // ... 9号黑
  10: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], // 1号绿 ... 10号黑
};

export function usedSeatsFor(playerCount: number): number[] {
  return USED_SEATS[playerCount] ?? USED_SEATS[10];
}

// ===== 全场固定视角(旧版同款机位,开局后锁定) =====
// 旧版为 pos 3 -55 0;实测画面偏右,向左收 1 格到场地中心正上方
export const CAMERA_LOCATION = { x: 2, y: -55, z: 0 };
export const CAMERA_FACING = { x: -7, y: -55, z: 0 };


// ===== 运行时可配置项(供 /bearcade:config 修改,持久化优先) =====
export interface WerewolfConfig {
  prepSpawn: Vec3;
  sniperSeconds: number;
  guardSeconds: number;
  killerSeconds: number;
  policeSeconds: number;
  daySeconds: number;
}

export const WEREWOLF_CONFIG_DEFAULTS: WerewolfConfig = {
  prepSpawn: PREP_SPAWN,
  sniperSeconds: SNIPER_SECONDS,
  guardSeconds: GUARD_SECONDS,
  killerSeconds: KILLER_SECONDS,
  policeSeconds: POLICE_SECONDS,
  daySeconds: DAY_SECONDS,
};
