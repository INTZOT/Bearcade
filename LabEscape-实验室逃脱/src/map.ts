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
import { getLabEscapeConfig } from "./labescape-config";
import {
  COLUMN_MATERIALS,
  DEFAULT_COLUMN_COUNT,
  GAME_ID,
  GLASS_BLOCK_ID,
  GROUND_BLOCK_ID,
  type LabEscapeConfig,
} from "./config";

const COLUMN_COUNT_KEY = "bearcade:labescape_column_count";

/** 读取模板中实际生成的柱子数量(由 /labescape:build 写入) */
export function getMapColumnCount(): number {
  const raw = world.getDynamicProperty(COLUMN_COUNT_KEY);
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 2) {
    return raw;
  }
  return DEFAULT_COLUMN_COUNT;
}

/** 记录模板中实际生成的柱子数量 */
export function setMapColumnCount(count: number): void {
  world.setDynamicProperty(COLUMN_COUNT_KEY, count);
}

/** 根据柱子数量计算圆环半径:0=自动,否则使用覆盖值 */
export function ringRadiusFor(count: number, cfg: LabEscapeConfig): number {
  if (cfg.ringRadiusOverride > 0) return cfg.ringRadiusOverride;
  return Math.max(
    cfg.minRingRadius,
    Math.ceil((count * cfg.columnSpacing) / (2 * Math.PI)),
  );
}

/** 第 index 根柱子的方块坐标(1x1 柱子中心) */
export function columnPosition(
  index: number,
  count: number,
  cfg: LabEscapeConfig,
): { x: number; z: number } {
  const r = ringRadiusFor(count, cfg);
  const angle = (index / count) * Math.PI * 2;
  return {
    x: Math.round(Math.cos(angle) * r),
    z: Math.round(Math.sin(angle) * r),
  };
}

function inCircle(x: number, z: number, radius: number): boolean {
  return x * x + z * z <= radius * radius;
}

/** 在模板维度生成完整地图:圆环柱子 + 玻璃方管 + 中央圆形塌陷区 */
export function buildLabEscapeMap(dimension: Dimension, count: number): void {
  const cfg = getLabEscapeConfig();
  const r = ringRadiusFor(count, cfg);
  // 清空范围按“当前数量”和“派对最大数量”中更大者计算,避免重建小地图后残留旧大地图
  const clearRadius = Math.max(r, ringRadiusFor(cfg.maxPartyColumns, cfg)) + 3;

  // 分块清空,避免一次性 fillBlocks 过大:
  // 1) 清空地面层
  dimension.fillBlocks(
    new BlockVolume(
      { x: -clearRadius, y: cfg.groundY - 1, z: -clearRadius },
      { x: clearRadius, y: cfg.groundY - 1, z: clearRadius },
    ),
    "minecraft:air",
  );
  // 2) 清空所有可能存在的柱子/玻璃(按派对最大数量逐个清)
  const maxGlassTop = cfg.groundY + cfg.columnHeight + 1;
  for (let i = 0; i < cfg.maxPartyColumns; i++) {
    const pos = columnPosition(i, cfg.maxPartyColumns, cfg);
    dimension.fillBlocks(
      new BlockVolume(
        { x: pos.x - 1, y: cfg.groundY, z: pos.z - 1 },
        { x: pos.x + 1, y: maxGlassTop, z: pos.z + 1 },
      ),
      "minecraft:air",
    );
  }

  // 当前数量对应的实际外沿(用于铺地面与柱子定位)
  const outer = r + 2;

  // 地面层(groundY 是表面,地面方块在 groundY-1)
  const groundBlockY = cfg.groundY - 1;
  dimension.fillBlocks(
    new BlockVolume(
      { x: -outer - 2, y: groundBlockY, z: -outer - 2 },
      { x: outer + 2, y: groundBlockY, z: outer + 2 },
    ),
    GROUND_BLOCK_ID,
  );

  // 中央圆形塌陷区:挖掉圆形区域
  for (let dx = -cfg.centerPitRadius; dx <= cfg.centerPitRadius; dx++) {
    for (let dz = -cfg.centerPitRadius; dz <= cfg.centerPitRadius; dz++) {
      if (!inCircle(dx, dz, cfg.centerPitRadius)) continue;
      for (
        let y = groundBlockY;
        y >= groundBlockY - cfg.centerPitDepth + 1;
        y--
      ) {
        dimension.setBlockType({ x: dx, y, z: dz }, "minecraft:air");
      }
    }
  }

  // 柱子 + 玻璃方管
  for (let i = 0; i < count; i++) {
    const { x, z } = columnPosition(i, count, cfg);

    // 柱子:groundY ~ groundY+columnHeight-1,每格随机材料
    for (let y = cfg.groundY; y < cfg.groundY + cfg.columnHeight; y++) {
      const material =
        COLUMN_MATERIALS[Math.floor(Math.random() * COLUMN_MATERIALS.length)];
      dimension.setBlockType({ x, y, z }, material);
    }

    // 玻璃方管:底部留 glassBottomOpenHeight 格开口,顶部比玩家出生层再高一格,防止跳出
    const glassTop = cfg.groundY + cfg.columnHeight + 1;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        for (
          let y = cfg.groundY + cfg.glassBottomOpenHeight;
          y <= glassTop;
          y++
        ) {
          dimension.setBlockType(
            { x: x + dx, y, z: z + dz },
            GLASS_BLOCK_ID,
          );
        }
      }
    }
  }
}

/** 注册 /labescape:build <数量> 自定义命令(管理员,仅模板维度) */
export function registerLabEscapeBuildCommand(): void {
  system.beforeEvents.startup.subscribe((event) => {
    try {
      event.customCommandRegistry.registerCommand(
        {
          name: "labescape:build",
          description: "在模板维度生成实验室逃脱地图,可选柱子数量(默认16)",
          permissionLevel: CommandPermissionLevel.Any,
          cheatsRequired: false,
          optionalParameters: [
            { name: "count", type: CustomCommandParamType.Integer },
          ],
        },
        (origin, count?: number) => {
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
          const cfg = getLabEscapeConfig();
          const n = Math.max(
            2,
            Math.min(count ?? DEFAULT_COLUMN_COUNT, cfg.maxPartyColumns),
          );
          system.run(() => {
            try {
              buildLabEscapeMap(player.dimension, n);
              setMapColumnCount(n);
              player.sendMessage(
                `§a地图已生成:${n} 根柱子,环半径 ${ringRadiusFor(n, cfg)}`,
              );
            } catch (error) {
              console.warn("[LabEscape] 地图生成失败", error);
              const detail =
                error instanceof Error ? error.message : String(error);
              player.sendMessage(`§c地图生成失败:${detail}`);
            }
          });
          return {
            status: CustomCommandStatus.Success,
            message: `开始生成 ${n} 柱地图…`,
          };
        },
      );
    } catch (error) {
      console.warn("[LabEscape] 注册 /labescape:build 失败", error);
    }
  });
}
