// ============================================================
// 幸运之柱(Pillars of Fortune)小游戏配置
// 玩法:双环基岩柱大乱斗,每 4 秒随机发物品,最后存活/击杀数决胜。
// 重要数值通过 /bearcade:config pillars 运行时配置,避免硬编码。
// ============================================================
export const GAME_ID = "pillars";
export const DISPLAY_NAME = "幸运之柱";
export const PACK_ID = "4e1a93f7-64f9-4e12-8f9c-8509565f9bff";
export const IPC_CHANNEL = "bearcade:ipc";
export const LOBBY_DIMENSION_ID = "minecraft:overworld";
export const ROOM_COUNT = 4;
export const MAX_PLAYERS = 20;
export const MIN_PLAYERS = 2;
// 派对模式可用性:柱位数固定为 20,人数超过柱位会共享/拥挤,暂不开放
export const PARTY_AVAILABLE = false;

// ===== 玩法默认配置(可经 /bearcade:config pillars 修改) =====
export interface PillarsGameConfig {
  /** 一局最长秒数 */
  gameDurationSeconds: number;
  /** 每多少秒给所有存活玩家发一件随机物品 */
  itemIntervalSeconds: number;
  /** 内环柱子数量 */
  innerRingCount: number;
  /** 外环柱子数量 */
  outerRingCount: number;
  /** 内环半径(格) */
  innerRingRadius: number;
  /** 外环半径(格) */
  outerRingRadius: number;
  /** 柱子高度(格,不含地面层) */
  pillarHeight: number;
  /** 草方块地面 Y */
  groundY: number;
  /** 禁止搭建的高度上限:y >= 该值不能放置方块 */
  maxBuildY: number;
  /** 禁止搭建的高度下限:y < 该值不能放置方块 */
  minBuildY: number;
}

export const PILLARS_DEFAULTS: PillarsGameConfig = {
  gameDurationSeconds: 300,
  itemIntervalSeconds: 5,
  innerRingCount: 10,
  outerRingCount: 10,
  innerRingRadius: 8,
  outerRingRadius: 13,
  pillarHeight: 35,
  groundY: 0,
  maxBuildY: 50,
  minBuildY: 0,
};

// ===== 以下坐标用于模板维度/准备房间/常加载区域 =====
// 地图由脚本按配置程序化生成,模板维度只保留一块准备/空场地。
// 常加载区域必须覆盖双环柱子范围(含高空柱顶),不要缩到只包准备房。
const ARENA_MARGIN = 20;
export const TEMPLATE_FROM = { x: -ARENA_MARGIN, y: -1, z: -ARENA_MARGIN };
export const TEMPLATE_TO = { x: ARENA_MARGIN, y: 65, z: ARENA_MARGIN };
export const ROOM_COPY_ORIGIN = { x: -ARENA_MARGIN, y: -1, z: -ARENA_MARGIN };
export const PREP_SPAWN = { x: 0, y: 1, z: 0 };
export const TICKING_FROM = { x: -ARENA_MARGIN, y: -1, z: -ARENA_MARGIN };
export const TICKING_TO = { x: ARENA_MARGIN, y: 65, z: ARENA_MARGIN };
export const STRUCTURE_ID = "bearcade:pillars_room";
export const TEMPLATE_SPAWN = { x: 0, y: 30, z: 0 };
// 开局站位占位;实际由 game.ts 按配置生成柱顶坐标并分配
