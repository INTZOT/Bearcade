// ============================================================
// 冰冻地板(FrozenFloor)小游戏配置
// 玩法:环形蓝冰场,每 30 秒内外圈向中间“融化”收缩,
// 玩家用无限雪球互相击落到虚空,最后存活者获胜。
// ============================================================
import type { Vec3 } from "../../shared/minigame-core/types";

export const GAME_ID = "frozenfloor";
export const DISPLAY_NAME = "冰冻地板";
export const PACK_ID = "8978bb6f-80dc-4af8-8741-966304bf3e57";
export const IPC_CHANNEL = "bearcade:ipc";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";

// ===== 人数与派对配置 =====
export const ROOM_COUNT = 4;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 12;
export const PARTY_AVAILABLE = true;

// ===== 模板与房间坐标(地图由 /bearcade:ffbuild 生成) =====
// 模板范围:蓝冰环外半径默认 28,加上装饰保留到 ±31(63×63,单块结构不超限)
export const TEMPLATE_FROM = { x: -31, y: -10, z: -31 };
export const TEMPLATE_TO = { x: 31, y: 80, z: 31 };
export const ROOM_COPY_ORIGIN = { x: -31, y: -10, z: -31 };
// 准备房间坐标(等待大厅平台上方)
export const PREP_SPAWN = { x: 0, y: 1, z: 0 };
// 常加载区域:覆盖准备大厅与蓝冰环场地
export const TICKING_FROM = { x: -31, y: -1, z: -31 };
export const TICKING_TO = { x: 31, y: 80, z: 31 };
export const STRUCTURE_ID = "bearcade:frozenfloor_room";
export const TEMPLATE_SPAWN = { x: 0, y: 100, z: 0 };
// 开局站位(实际会按当前内外半径在环上动态生成)
export const START_POSITIONS = Array.from({ length: MAX_PLAYERS }, (_, index) => {
  const angle = (index / MAX_PLAYERS) * Math.PI * 2;
  const radius = 17.5;
  return {
    x: Math.round(radius * Math.cos(angle)),
    y: 66,
    z: Math.round(radius * Math.sin(angle)),
  };
});

// ===== 玩法配置(默认值,全部可经 /bearcade:config frozenfloor 调整) =====
export interface FrozenFloorConfig {
  /** 准备房间坐标(Core 入房传送点) */
  prepSpawn: Vec3;
  /** 环形场地中心(仅 x/z 生效,y 使用 ringY) */
  arenaCenter: Vec3;
  /** 蓝冰环顶部方块 y(玩家站在 y+1) */
  ringY: number;
  /** 内圈半径(中心空洞半径) */
  innerRadius: number;
  /** 外圈半径 */
  outerRadius: number;
  /** 每轮融化间隔(秒) */
  meltIntervalSeconds: number;
  /** 融化动画时长(秒),期间逐块消失 */
  meltAnimationSeconds: number;
  /** 总共融化次数 */
  meltTimes: number;
  /** 每轮外圈向内收缩格数 */
  outerShrinkPerMelt: number;
  /** 每轮内圈向外扩张格数 */
  innerExpandPerMelt: number;
  /** 掉到该 y 以下视为淘汰 */
  voidY: number;
  /** 雪球水平击退强度(原版为 1 左右,可调 0~10) */
  snowballKnockback: number;
  /** 雪球垂直击退强度 */
  snowballVerticalKnockback: number;
  /** 每格雪球数量(默认 16,开局直接放入快捷栏) */
  snowballStackSize: number;
  /** 观战台位置(淘汰玩家本体传送至此) */
  spectateSpot: Vec3;
  /** 构建地图时是否生成参考旧图的装饰 */
  generateDecorations: boolean;
}

export const FROZENFLOOR_CONFIG_DEFAULTS: FrozenFloorConfig = {
  prepSpawn: PREP_SPAWN,
  arenaCenter: { x: 0, y: 65, z: 0 },
  ringY: 65,
  innerRadius: 7,
  outerRadius: 28,
  meltIntervalSeconds: 30,
  meltAnimationSeconds: 3,
  meltTimes: 6,
  outerShrinkPerMelt: 2,
  innerExpandPerMelt: 1,
  voidY: -20,
  snowballKnockback: 1,
  snowballVerticalKnockback: 0.3,
  snowballStackSize: 16,
  spectateSpot: { x: 0, y: 72, z: 34 },
  generateDecorations: true,
};
