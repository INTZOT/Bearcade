// ============================================================
// 领地战争 · 模板地图生成
// /bearcade:territory_war_buildmap —— 在模板维度生成:
//   - size×size 的中立领地地面(玩家站在地面 +1 层)
//   - 场地外一圈黑色框 + 2 格高屏障(自定义维度是空维度,防止掉虚空)
//   - 北侧准备平台(prepSpawn 处,7×7 + 围栏)
//   - 若干海晶灯装饰照明
// 命令可重复执行:先整块清空再重建,不会累积残留。
// ============================================================
import {
  BlockVolume,
  CommandPermissionLevel,
  CustomCommandStatus,
  system,
  type Dimension,
  type Player,
  type Vector3,
} from "@minecraft/server";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import {
  NEUTRAL_BLOCK,
  TEMPLATE_FROM,
  TEMPLATE_TO,
} from "./config";
import { clampFieldSize, fieldOrigin } from "./field";
import { getTerritoryWarConfig } from "./territory-war-config";

export const BUILD_MAP_COMMAND = "bearcade:territory_war_buildmap";

const AIR = "minecraft:air";
const BASE_BLOCK = "minecraft:stone";
const FRAME_BLOCK = "minecraft:black_concrete";
const PREP_FLOOR = "minecraft:smooth_stone";
const PREP_EDGE = "minecraft:polished_andesite";
const BARRIER = "minecraft:barrier";
const LAMP = "minecraft:sea_lantern";
/** 准备平台半径(7×7) */
const PREP_HALF = 3;
/**
 * 单次 fillBlocks 的方块数上限(引擎实测约 32768)。
 * 整块清空模板范围(57×25×57 ≈ 8.1 万)必须分片,否则会被拒绝或只填一部分。
 */
const MAX_FILL_VOLUME = 20000;

function fill(
  dimension: Dimension,
  from: Vector3,
  to: Vector3,
  block: string,
): void {
  const xCount = Math.abs(to.x - from.x) + 1;
  const zCount = Math.abs(to.z - from.z) + 1;
  const area = xCount * zCount;
  const yLow = Math.min(from.y, to.y);
  const yHigh = Math.max(from.y, to.y);
  const layerStep = Math.max(1, Math.floor(MAX_FILL_VOLUME / Math.max(1, area)));
  let y = yLow;
  while (y <= yHigh) {
    const sliceTop = Math.min(yHigh, y + layerStep - 1);
    try {
      dimension.fillBlocks(
        new BlockVolume(
          { x: from.x, y, z: from.z },
          { x: to.x, y: sliceTop, z: to.z },
        ),
        block,
        { ignoreChunkBoundErrors: true },
      );
    } catch (error) {
      console.warn(
        `[Bearcade territory_war] fillBlocks 失败 y=${y}~${sliceTop}`,
        error,
      );
    }
    y = sliceTop + 1;
  }
}

/** 场地几何摘要(供命令回执与自检) */
export interface MapGeometry {
  size: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y: number;
  prepFloorY: number;
}

export function mapGeometry(): MapGeometry {
  const cfg = getTerritoryWarConfig();
  const size = clampFieldSize(cfg.fieldSize);
  const originX = fieldOrigin(cfg.centerX, size);
  const originZ = fieldOrigin(cfg.centerZ, size);
  const y = Math.floor(cfg.fieldY);
  return {
    size,
    minX: originX,
    maxX: originX + size - 1,
    minZ: originZ,
    maxZ: originZ + size - 1,
    y,
    prepFloorY: Math.floor(cfg.prepSpawn.y) - 1,
  };
}

/** 生成前自检:返回需要提醒开发者的事项(不阻塞生成) */
export function mapWarnings(geometry: MapGeometry): string[] {
  const warnings: string[] = [];
  const cfg = getTerritoryWarConfig();
  const margin = 2;
  if (
    geometry.minX - margin < TEMPLATE_FROM.x ||
    geometry.maxX + margin > TEMPLATE_TO.x ||
    geometry.minZ - margin < TEMPLATE_FROM.z ||
    geometry.maxZ + margin > TEMPLATE_TO.z
  ) {
    warnings.push(
      `场地(含外框 ${geometry.minX - margin}~${geometry.maxX + margin})超出模板范围 ` +
        `${TEMPLATE_FROM.x}~${TEMPLATE_TO.x},修改中心/边长后请先用 /bearcade:tmp sz territory_war 扩大范围`,
    );
  }
  const px = Math.floor(cfg.prepSpawn.x);
  const pz = Math.floor(cfg.prepSpawn.z);
  const overlapsField =
    px + PREP_HALF >= geometry.minX - 1 &&
    px - PREP_HALF <= geometry.maxX + 1 &&
    pz + PREP_HALF >= geometry.minZ - 1 &&
    pz - PREP_HALF <= geometry.maxZ + 1;
  if (overlapsField) {
    warnings.push(
      `准备平台(中心 ${px},${pz},半径 ${PREP_HALF})与场地重叠,请调整准备房间坐标或场地中心`,
    );
  }
  if (
    geometry.prepFloorY < TEMPLATE_FROM.y ||
    geometry.prepFloorY + 3 > TEMPLATE_TO.y
  ) {
    warnings.push("准备平台 Y 超出模板纵向范围(56~80),请调整准备房间坐标");
  }
  return warnings;
}

/**
 * 在指定维度生成整块场地。可重复执行。
 * 返回给管理员看的摘要行。
 */
export function buildTerritoryWarMap(dimension: Dimension): string[] {
  const geometry = mapGeometry();
  const cfg = getTerritoryWarConfig();
  const { size, minX, maxX, minZ, maxZ, y, prepFloorY } = geometry;

  // 1) 整块清空,避免改小场地后残留旧方块
  fill(dimension, TEMPLATE_FROM, TEMPLATE_TO, AIR);

  // 2) 地基:场地外扩 2 格、向下 4 层,杜绝从边缘掉下去
  fill(
    dimension,
    { x: minX - 2, y: y - 4, z: minZ - 2 },
    { x: maxX + 2, y: y - 1, z: maxZ + 2 },
    BASE_BLOCK,
  );

  // 3) 领地表面(中立地面)
  fill(
    dimension,
    { x: minX, y, z: minZ },
    { x: maxX, y, z: maxZ },
    NEUTRAL_BLOCK,
  );

  // 4) 头顶净空
  fill(
    dimension,
    { x: minX, y: y + 1, z: minZ },
    { x: maxX, y: y + 5, z: maxZ },
    AIR,
  );

  // 5) 外框:表面一圈黑色框 + 2 格高屏障
  fill(
    dimension,
    { x: minX - 1, y, z: minZ - 1 },
    { x: maxX + 1, y, z: minZ - 1 },
    FRAME_BLOCK,
  );
  fill(
    dimension,
    { x: minX - 1, y, z: maxZ + 1 },
    { x: maxX + 1, y, z: maxZ + 1 },
    FRAME_BLOCK,
  );
  fill(
    dimension,
    { x: minX - 1, y, z: minZ },
    { x: minX - 1, y, z: maxZ },
    FRAME_BLOCK,
  );
  fill(
    dimension,
    { x: maxX + 1, y, z: minZ },
    { x: maxX + 1, y, z: maxZ },
    FRAME_BLOCK,
  );
  for (let ly = y + 1; ly <= y + 2; ly++) {
    fill(
      dimension,
      { x: minX - 1, y: ly, z: minZ - 1 },
      { x: maxX + 1, y: ly, z: minZ - 1 },
      BARRIER,
    );
    fill(
      dimension,
      { x: minX - 1, y: ly, z: maxZ + 1 },
      { x: maxX + 1, y: ly, z: maxZ + 1 },
      BARRIER,
    );
    fill(
      dimension,
      { x: minX - 1, y: ly, z: minZ },
      { x: minX - 1, y: ly, z: maxZ },
      BARRIER,
    );
    fill(
      dimension,
      { x: maxX + 1, y: ly, z: minZ },
      { x: maxX + 1, y: ly, z: maxZ },
      BARRIER,
    );
  }

  // 6) 四角海晶灯(框上,不占场地格)
  for (const [lx, lz] of [
    [minX - 1, minZ - 1],
    [maxX + 1, minZ - 1],
    [minX - 1, maxZ + 1],
    [maxX + 1, maxZ + 1],
  ]) {
    fill(
      dimension,
      { x: lx, y, z: lz },
      { x: lx, y, z: lz },
      LAMP,
    );
  }

  // 7) 准备平台(7×7 + 2 格高围栏),与场地同一地面层
  const px = Math.floor(cfg.prepSpawn.x);
  const pz = Math.floor(cfg.prepSpawn.z);
  fill(
    dimension,
    { x: px - PREP_HALF, y: prepFloorY - 1, z: pz - PREP_HALF },
    { x: px + PREP_HALF, y: prepFloorY - 1, z: pz + PREP_HALF },
    BASE_BLOCK,
  );
  fill(
    dimension,
    { x: px - PREP_HALF, y: prepFloorY, z: pz - PREP_HALF },
    { x: px + PREP_HALF, y: prepFloorY, z: pz + PREP_HALF },
    PREP_FLOOR,
  );
  for (let ly = prepFloorY + 1; ly <= prepFloorY + 3; ly++) {
    fill(
      dimension,
      { x: px - PREP_HALF, y: ly, z: pz - PREP_HALF },
      { x: px + PREP_HALF, y: ly, z: pz + PREP_HALF },
      AIR,
    );
  }
  for (let ly = prepFloorY + 1; ly <= prepFloorY + 2; ly++) {
    fill(
      dimension,
      { x: px - PREP_HALF, y: ly, z: pz - PREP_HALF },
      { x: px + PREP_HALF, y: ly, z: pz - PREP_HALF },
      BARRIER,
    );
    fill(
      dimension,
      { x: px - PREP_HALF, y: ly, z: pz + PREP_HALF },
      { x: px + PREP_HALF, y: ly, z: pz + PREP_HALF },
      BARRIER,
    );
    fill(
      dimension,
      { x: px - PREP_HALF, y: ly, z: pz - PREP_HALF + 1 },
      { x: px - PREP_HALF, y: ly, z: pz + PREP_HALF - 1 },
      BARRIER,
    );
    fill(
      dimension,
      { x: px + PREP_HALF, y: ly, z: pz - PREP_HALF + 1 },
      { x: px + PREP_HALF, y: ly, z: pz + PREP_HALF - 1 },
      BARRIER,
    );
  }
  // 准备平台外圈描边(4 条边)
  fill(
    dimension,
    { x: px - PREP_HALF, y: prepFloorY, z: pz - PREP_HALF },
    { x: px + PREP_HALF, y: prepFloorY, z: pz - PREP_HALF },
    PREP_EDGE,
  );
  fill(
    dimension,
    { x: px - PREP_HALF, y: prepFloorY, z: pz + PREP_HALF },
    { x: px + PREP_HALF, y: prepFloorY, z: pz + PREP_HALF },
    PREP_EDGE,
  );
  fill(
    dimension,
    { x: px - PREP_HALF, y: prepFloorY, z: pz - PREP_HALF + 1 },
    { x: px - PREP_HALF, y: prepFloorY, z: pz + PREP_HALF - 1 },
    PREP_EDGE,
  );
  fill(
    dimension,
    { x: px + PREP_HALF, y: prepFloorY, z: pz - PREP_HALF + 1 },
    { x: px + PREP_HALF, y: prepFloorY, z: pz + PREP_HALF - 1 },
    PREP_EDGE,
  );
  // 四角灯(描边之后再放,嵌在地面里不挡视线)
  for (const [dx, dz] of [
    [-PREP_HALF, -PREP_HALF],
    [PREP_HALF, -PREP_HALF],
    [-PREP_HALF, PREP_HALF],
    [PREP_HALF, PREP_HALF],
  ]) {
    fill(
      dimension,
      { x: px + dx, y: prepFloorY, z: pz + dz },
      { x: px + dx, y: prepFloorY, z: pz + dz },
      LAMP,
    );
  }

  const notes = [
    `领地 ${size}×${size}(X ${minX}~${maxX} / Z ${minZ}~${maxZ},地面 Y=${y})`,
    `准备平台中心 (${px}, ${prepFloorY + 1}, ${pz}),7×7 带围栏`,
    "下一步:/bearcade:tmp ap territory_war 应用到全部房间",
  ];
  for (const warning of mapWarnings(geometry)) notes.push(`§c注意:${warning}`);
  console.warn(
    `[Bearcade territory_war] 场地已生成 ${size}×${size} @ (${minX},${y},${minZ})`,
  );
  return notes;
}

/** 注册管理员地图构建命令(在 startup 阶段调用) */
export function registerTerritoryWarBuildCommand(
  getRuntime: () => MinigameRuntime,
): void {
  system.beforeEvents.startup.subscribe((event) => {
    try {
      event.customCommandRegistry.registerCommand(
        {
          name: BUILD_MAP_COMMAND,
          description: "在模板维度生成领地战争场地(领地地面 + 外墙 + 准备平台)",
          permissionLevel: CommandPermissionLevel.Any,
          cheatsRequired: false,
        },
        (origin) => {
          const entity = origin.sourceEntity;
          if (!entity || entity.typeId !== "minecraft:player") {
            return {
              status: CustomCommandStatus.Failure,
              message: "该命令只能由玩家执行",
            };
          }
          if (!entity.hasTag("op")) {
            return {
              status: CustomCommandStatus.Failure,
              message: "权限不足:需要 op tag(管理员)",
            };
          }
          const player = entity as Player;
          const runtime = getRuntime();
          if (player.dimension.id !== runtime.templateDimensionId()) {
            return {
              status: CustomCommandStatus.Failure,
              message:
                "该命令只能在模板维度执行(/bearcade:tmp tp territory_war)",
            };
          }
          system.run(() => {
            try {
              const notes = buildTerritoryWarMap(player.dimension);
              for (const note of notes) player.sendMessage(`§a${note}`);
            } catch (error) {
              player.sendMessage("§c地图生成失败,详情见内容日志");
              console.warn("[Bearcade territory_war] 地图生成失败", error);
            }
          });
          return { status: CustomCommandStatus.Success };
        },
      );
      console.warn(
        `[Bearcade territory_war] 地图构建指令 /${BUILD_MAP_COMMAND} 已注册`,
      );
    } catch (error) {
      console.warn(
        "[Bearcade territory_war] 注册地图构建指令失败",
        error,
      );
    }
  });
}
