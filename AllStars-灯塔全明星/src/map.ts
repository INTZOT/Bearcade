// ============================================================
// 造场命令:`/bearcade:allstars_buildmap`
//
// 在**模板维度**生成一套最小可用场地:
//   1) 1v1 擂台:地板(方块层 y = ARENA_FLOOR_Y - 1,角色脚底站 ARENA_FLOOR_Y)
//      + 头顶净空 + 四周一圈屏障(不可见但挡人,防止被打出场地) + 双方起始位标记;
//   2) 准备台:入房后的落点(PREP_SPAWN 处 5×5 小台 + 一圈矮墙),开局再被传进擂台。
//
// 生成后执行 `/bearcade:tmp ap allstars` 一键复制到全部房间。
// 尺寸与坐标要和 src/config.ts 的 TEMPLATE_FROM/TO / ROOM_COPY_ORIGIN / TICKING_* 一致,
// 改尺寸时三处一起改。
//
// 控制笼不需要方块:玩家本体由 pullBackToCage 每 tick 归位 + 隐身实现。
// 命令回调整体走 system.run 延迟,避免 restricted execution。
// ============================================================
import {
  BlockVolume,
  CommandPermissionLevel,
  CustomCommandStatus,
  Player,
  system,
  type Dimension,
  type Vector3,
} from "@minecraft/server";
import {
  ARENA_AXIS,
  ARENA_CENTER,
  ARENA_FLOOR_Y,
  ARENA_HALF_WIDTH,
  ARENA_START_HALF_DISTANCE,
  BACKSTAGE_HALF_SIZE,
  BACKSTAGE_PAD_Y,
} from "./combat-config";
import { GAME_ID, PREP_SPAWN } from "./config";

/** 擂台进深(垂直于竞技场轴的半宽) [待调] */
export const ARENA_HALF_DEPTH = 4;
/** 边界屏障高度(格) [待调] */
export const ARENA_WALL_HEIGHT = 4;
/** 头顶净空高度(格) [待调] */
export const ARENA_HEADROOM = 7;
/** 准备台半宽(5×5) [待调] */
export const PREP_HALF_SIZE = 2;
/** 准备台矮墙高度(格) [待调] */
export const PREP_WALL_HEIGHT = 2;
/** 擂台方块 */
export const FLOOR_BLOCK = "minecraft:quartz_block";
/** 准备台方块 */
export const PREP_BLOCK = "minecraft:smooth_stone";
/** 边界屏障(不可见、挡人) */
export const BOUNDARY_BLOCK = "minecraft:barrier";
/** 起始位标记 */
export const START_MARK_BLOCK = "minecraft:light_blue_concrete";

/** 竞技场轴上的偏移 → 世界坐标(方块坐标) */
function axisOffset(offset: number, y: number): Vector3 {
  const c = ARENA_CENTER;
  return ARENA_AXIS === "x"
    ? { x: c.x + offset, y, z: c.z }
    : { x: c.x, y, z: c.z + offset };
}

/** 擂台的水平范围(方块坐标 from/to) */
function arenaBounds(): { from: Vector3; to: Vector3 } {
  const c = ARENA_CENTER;
  const half = ARENA_HALF_WIDTH;
  const depth = ARENA_HALF_DEPTH;
  return ARENA_AXIS === "x"
    ? {
        from: { x: c.x - half, y: 0, z: c.z - depth },
        to: { x: c.x + half, y: 0, z: c.z + depth },
      }
    : {
        from: { x: c.x - depth, y: 0, z: c.z - half },
        to: { x: c.x + depth, y: 0, z: c.z + half },
      };
}

/** 绕 from/to 矩形外扩 1 格铺一圈墙(高度 height,底在 baseY) */
function fillRing(
  dimension: Dimension,
  from: Vector3,
  to: Vector3,
  baseY: number,
  height: number,
  block: string,
): void {
  const topY = baseY + height - 1;
  const segments: Array<{ from: Vector3; to: Vector3 }> = [
    {
      from: { x: from.x - 1, y: baseY, z: from.z - 1 },
      to: { x: from.x - 1, y: topY, z: to.z + 1 },
    },
    {
      from: { x: to.x + 1, y: baseY, z: from.z - 1 },
      to: { x: to.x + 1, y: topY, z: to.z + 1 },
    },
    {
      from: { x: from.x - 1, y: baseY, z: from.z - 1 },
      to: { x: to.x + 1, y: topY, z: from.z - 1 },
    },
    {
      from: { x: from.x - 1, y: baseY, z: to.z + 1 },
      to: { x: to.x + 1, y: topY, z: to.z + 1 },
    },
  ];
  for (const seg of segments) {
    dimension.fillBlocks(new BlockVolume(seg.from, seg.to), block);
  }
}

/** 铺一块水平platform:先清空上方净空再铺方块 */
function buildPad(
  dimension: Dimension,
  center: Vector3,
  halfSize: number,
  floorBlockY: number,
  block: string,
): { from: Vector3; to: Vector3 } {
  const from: Vector3 = {
    x: center.x - halfSize,
    y: floorBlockY,
    z: center.z - halfSize,
  };
  const to: Vector3 = {
    x: center.x + halfSize,
    y: floorBlockY,
    z: center.z + halfSize,
  };
  // 净空
  dimension.fillBlocks(
    new BlockVolume(from, { x: to.x, y: floorBlockY + ARENA_HEADROOM, z: to.z }),
    "minecraft:air",
  );
  // 台面
  dimension.fillBlocks(new BlockVolume(from, to), block);
  return { from, to };
}

/**
 * 在指定维度生成完整场地(擂台 + 准备台)。**可重复执行**:先清空再铺,不会累积残留。
 * 单次 fillBlocks 体积都很小(最大约 29×8×11),远低于引擎 32768 上限。
 */
export function buildAllStarsArena(dimension: Dimension): void {
  const floorBlockY = ARENA_FLOOR_Y - 1; // 台面方块层,角色脚底在 ARENA_FLOOR_Y
  const { from, to } = arenaBounds();
  const topY = ARENA_FLOOR_Y + ARENA_HEADROOM;

  // 1) 清空擂台空间(含头顶净空)
  dimension.fillBlocks(
    new BlockVolume(
      { x: from.x, y: floorBlockY, z: from.z },
      { x: to.x, y: topY, z: to.z },
    ),
    "minecraft:air",
  );

  // 2) 铺擂台地板
  dimension.fillBlocks(
    new BlockVolume(
      { x: from.x, y: floorBlockY, z: from.z },
      { x: to.x, y: floorBlockY, z: to.z },
    ),
    FLOOR_BLOCK,
  );

  // 3) 四周屏障(比地板外扩 1 格)
  fillRing(dimension, from, to, floorBlockY, ARENA_WALL_HEIGHT, BOUNDARY_BLOCK);

  // 4) 双方起始位标记
  for (const offset of [-ARENA_START_HALF_DISTANCE, ARENA_START_HALF_DISTANCE]) {
    dimension.setBlockType(
      axisOffset(offset, floorBlockY),
      START_MARK_BLOCK,
    );
  }

  // 5) 准备台(入房落点,开局再被传进擂台)
  const prepCenter: Vector3 = { x: PREP_SPAWN.x, y: PREP_SPAWN.y, z: PREP_SPAWN.z };
  const prep = buildPad(
    dimension,
    prepCenter,
    PREP_HALF_SIZE,
    PREP_SPAWN.y - 1,
    PREP_BLOCK,
  );
  fillRing(
    dimension,
    prep.from,
    prep.to,
    PREP_SPAWN.y - 1,
    PREP_WALL_HEIGHT,
    BOUNDARY_BLOCK,
  );

  // 6) 后台平台:玩家本体(隐身)待的地方 —— 擂台地板**正下方**,
  //    相机(侧视)看不到,场地里只留前台角色。必须落在 TEMPLATE 复制区
  //    (y ≥ 60)里,否则 `tmp ap` 复制不到各房间。
  //
  //    ⚠ 这里**不能**用 buildPad:它会顺带清出 ARENA_HEADROOM 高的净空,
  //      而 y=64 正是擂台地板 —— 一清就把地板打穿了。手工只动 60~63。
  const back = {
    from: {
      x: ARENA_CENTER.x - BACKSTAGE_HALF_SIZE,
      y: BACKSTAGE_PAD_Y,
      z: ARENA_CENTER.z - BACKSTAGE_HALF_SIZE,
    },
    to: {
      x: ARENA_CENTER.x + BACKSTAGE_HALF_SIZE,
      y: BACKSTAGE_PAD_Y + 3,
      z: ARENA_CENTER.z + BACKSTAGE_HALF_SIZE,
    },
  };
  dimension.fillBlocks(new BlockVolume(back.from, back.to), "minecraft:air");
  dimension.fillBlocks(
    new BlockVolume(
      { x: back.from.x, y: BACKSTAGE_PAD_Y, z: back.from.z },
      { x: back.to.x, y: BACKSTAGE_PAD_Y, z: back.to.z },
    ),
    PREP_BLOCK,
  );
  // 顶上一盏光:后台本身看不到,但万一相机没下发的瞬间不至于伸手不见五指
  dimension.setBlockType(
    { x: ARENA_CENTER.x, y: BACKSTAGE_PAD_Y + 3, z: ARENA_CENTER.z },
    "minecraft:glowstone",
  );
}

/** 注册 `/bearcade:allstars_buildmap`(只在模板维度、需 op tag) */
export function registerAllStarsBuildCommand(): void {
  system.beforeEvents.startup.subscribe((event) => {
    try {
      event.customCommandRegistry.registerCommand(
        {
          name: `bearcade:${GAME_ID}_buildmap`,
          description: "在模板维度生成 1v1 擂台 + 准备台",
          permissionLevel: CommandPermissionLevel.Any,
          cheatsRequired: false,
        },
        (origin) => {
          const player = origin.sourceEntity;
          if (!(player instanceof Player)) {
            return {
              status: CustomCommandStatus.Failure,
              message: "该命令只能由玩家执行",
            };
          }
          if (!player.hasTag("op")) {
            return {
              status: CustomCommandStatus.Failure,
              message: "权限不足:需要 op tag(管理员)",
            };
          }
          const templateId = `bearcade:${GAME_ID}_template`;
          if (player.dimension.id !== templateId) {
            return {
              status: CustomCommandStatus.Failure,
              message: `请在模板维度执行(/bearcade:tmp tp ${GAME_ID} 进入 ${templateId})`,
            };
          }
          // restricted execution:原生方块操作延迟到 system.run
          system.run(() => {
            try {
              buildAllStarsArena(player.dimension);
              player.sendMessage(
                `§a场地已生成:擂台 ${ARENA_HALF_WIDTH * 2 + 1}×${ARENA_HALF_DEPTH * 2 + 1} 格` +
                  `(脚底 y=${ARENA_FLOOR_Y})+ 准备台(z=${PREP_SPAWN.z})。` +
                  `§e接着执行 §f/bearcade:tmp ap ${GAME_ID}§e 应用到全部房间。`,
              );
            } catch (error) {
              console.warn("[Bearcade allstars] 场地生成失败", error);
              const detail =
                error instanceof Error ? error.message : String(error);
              player.sendMessage(`§c场地生成失败:${detail}`);
            }
          });
          return {
            status: CustomCommandStatus.Success,
            message: "开始生成 1v1 擂台…",
          };
        },
      );
    } catch (error) {
      console.warn("[Bearcade allstars] 注册 buildmap 命令失败", error);
    }
  });
}
