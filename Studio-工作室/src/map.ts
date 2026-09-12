import {
  BlockVolume,
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
  Player,
  system,
  world,
  type Dimension,
} from "@minecraft/server";
import { getStudioConfig } from "./studio-config";
import type { StudioConfig } from "./config";
import {
  GAME_ID,
  MAX_ARENA_SIZE,
  MIN_ARENA_SIZE,
  WALL_HEIGHT,
} from "./config";

const BUILD_SIZE_KEY = "bearcade:studio_build_size";

export interface MaterialPos {
  x: number;
  y: number;
  z: number;
  typeId: string;
}

/** 读取模板中实际生成的工作室尺寸(由 /studio:build 写入) */
export function getBuildSize(): number {
  const raw = world.getDynamicProperty(BUILD_SIZE_KEY);
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= MIN_ARENA_SIZE) {
    return Math.min(raw, MAX_ARENA_SIZE);
  }
  return getStudioConfig().defaultArenaSize;
}

/** 记录模板中实际生成的工作室尺寸 */
export function setBuildSize(size: number): void {
  world.setDynamicProperty(BUILD_SIZE_KEY, size);
}

/** 计算货架原材料方块位置(材料块放在 shelfY+1,底座在 shelfY) */
export function materialPositions(
  size: number,
  cfg: StudioConfig,
): MaterialPos[] {
  const half = Math.floor(size / 2);
  const materialY = cfg.groundY + 2;
  const spots: { x: number; z: number }[] = [];

  // 四面沿墙内侧各放一排货架(避开角落重复)
  for (let x = -half + 1; x <= half - 1; x++) {
    spots.push({ x, z: -half + 1 });
    spots.push({ x, z: half - 1 });
  }
  for (let z = -half + 2; z <= half - 2; z++) {
    spots.push({ x: -half + 1, z });
    spots.push({ x: half - 1, z });
  }

  const materials = cfg.materialBlocks.length > 0 ? cfg.materialBlocks : ["minecraft:stone"];
  return spots.map((p, i) => ({
    x: p.x,
    y: materialY,
    z: p.z,
    typeId: materials[i % materials.length],
  }));
}

/** 在模板维度生成完整封闭工作室地图 */
export function buildStudioMap(dimension: Dimension, size: number): void {
  const cfg = getStudioConfig();
  const half = Math.floor(size / 2);
  const groundY = cfg.groundY;
  const wallTop = groundY + WALL_HEIGHT - 1;
  const ceilY = groundY + WALL_HEIGHT;

  // 清空区域(比场地大一圈,避免重建小地图后残留旧建筑)
  dimension.fillBlocks(
    new BlockVolume(
      { x: -half - 1, y: groundY - 1, z: -half - 1 },
      { x: half + 1, y: ceilY + 1, z: half + 1 },
    ),
    "minecraft:air",
  );

  // 地板
  dimension.fillBlocks(
    new BlockVolume(
      { x: -half, y: groundY - 1, z: -half },
      { x: half, y: groundY - 1, z: half },
    ),
    "minecraft:stone_bricks",
  );

  // 四面墙
  dimension.fillBlocks(
    new BlockVolume(
      { x: -half, y: groundY, z: -half },
      { x: half, y: wallTop, z: -half },
    ),
    "minecraft:stone_bricks",
  );
  dimension.fillBlocks(
    new BlockVolume(
      { x: -half, y: groundY, z: half },
      { x: half, y: wallTop, z: half },
    ),
    "minecraft:stone_bricks",
  );
  dimension.fillBlocks(
    new BlockVolume(
      { x: -half, y: groundY, z: -half + 1 },
      { x: -half, y: wallTop, z: half - 1 },
    ),
    "minecraft:stone_bricks",
  );
  dimension.fillBlocks(
    new BlockVolume(
      { x: half, y: groundY, z: -half + 1 },
      { x: half, y: wallTop, z: half - 1 },
    ),
    "minecraft:stone_bricks",
  );

  // 玻璃天花板(封闭但透光)
  dimension.fillBlocks(
    new BlockVolume(
      { x: -half, y: ceilY, z: -half },
      { x: half, y: ceilY, z: half },
    ),
    "minecraft:glass",
  );

  // 工作台与熔炉(中央区域)
  const stations: { x: number; z: number; type: string }[] = [
    { x: -2, z: -2, type: "minecraft:crafting_table" },
    { x: 0, z: -2, type: "minecraft:crafting_table" },
    { x: 2, z: -2, type: "minecraft:crafting_table" },
    { x: -2, z: 0, type: "minecraft:furnace" },
    { x: 0, z: 0, type: "minecraft:furnace" },
    { x: 2, z: 0, type: "minecraft:furnace" },
    { x: -2, z: 2, type: "minecraft:crafting_table" },
    { x: 0, z: 2, type: "minecraft:crafting_table" },
    { x: 2, z: 2, type: "minecraft:crafting_table" },
  ];
  for (const station of stations) {
    dimension.setBlockType(
      { x: station.x, y: groundY, z: station.z },
      station.type,
    );
  }

  // 货架:底座 + 原材料
  const mats = materialPositions(size, cfg);
  for (const pos of mats) {
    dimension.setBlockType(
      { x: pos.x, y: groundY + 1, z: pos.z },
      "minecraft:oak_planks",
    );
    dimension.setBlockType({ x: pos.x, y: pos.y, z: pos.z }, pos.typeId);
  }
}

/** 每回合开始时复原/补充货架原材料 */
export function refillMaterials(dimension: Dimension): void {
  const cfg = getStudioConfig();
  const size = getBuildSize();
  for (const pos of materialPositions(size, cfg)) {
    dimension.setBlockType({ x: pos.x, y: pos.y, z: pos.z }, pos.typeId);
  }
}

/** 注册 /studio:build <尺寸> 自定义命令(管理员,仅模板维度) */
export function registerStudioBuildCommand(): void {
  system.beforeEvents.startup.subscribe((event) => {
    try {
      event.customCommandRegistry.registerCommand(
        {
          name: "studio:build",
          description: "在模板维度生成工作室地图,可选边长(默认21,奇数)",
          permissionLevel: CommandPermissionLevel.Any,
          cheatsRequired: false,
          optionalParameters: [
            { name: "size", type: CustomCommandParamType.Integer },
          ],
        },
        (origin, size?: number) => {
          const player = origin.sourceEntity;
          if (!player || !(player instanceof Player)) {
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
              message: `请在模板维度执行(${templateId})`,
            };
          }
          const cfg = getStudioConfig();
          let n = Math.max(
            MIN_ARENA_SIZE,
            Math.min(size ?? cfg.defaultArenaSize, MAX_ARENA_SIZE),
          );
          if (n % 2 === 0) n += 1; // 保证奇数边长,中心对称
          const finalSize = n;
          system.run(() => {
            try {
              buildStudioMap(player.dimension, finalSize);
              setBuildSize(finalSize);
              player.sendMessage(
                `§a工作室地图已生成:边长 ${finalSize},地面 Y=${cfg.groundY}`,
              );
            } catch (error) {
              console.warn("[Studio] 地图生成失败", error);
              const detail =
                error instanceof Error ? error.message : String(error);
              player.sendMessage(`§c地图生成失败:${detail}`);
            }
          });
          return {
            status: CustomCommandStatus.Success,
            message: `开始生成边长 ${finalSize} 的工作室…`,
          };
        },
      );
    } catch (error) {
      console.warn("[Studio] 注册 /studio:build 失败", error);
    }
  });
}
