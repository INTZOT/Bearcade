// ============================================================
// 杀年猪 · 模板地图生成指令
// /bearcade:newyearpig_buildmap —— 在模板维度生成 32×32 草方块地皮。
// 仅管理员(op tag)且必须在模板维度执行;不要在游玩过程中调用。
// ============================================================
import {
  BlockVolume,
  CommandPermissionLevel,
  CustomCommandStatus,
  system,
  world,
  type Player,
} from "@minecraft/server";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { getNewYearPigConfig } from "./newyearpig-config";

export const BUILD_MAP_COMMAND = "bearcade:newyearpig_buildmap";

export function registerNewYearPigBuildCommand(
  getRuntime: () => MinigameRuntime,
): void {
  system.beforeEvents.startup.subscribe((event) => {
    try {
      event.customCommandRegistry.registerCommand(
        {
          name: BUILD_MAP_COMMAND,
          description: "在模板维度生成杀年猪草方块地皮(管理员)",
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
              message: "该命令只能在模板维度执行(/bearcade:tmp tp newyearpig)",
            };
          }
          system.run(() => {
            try {
              const cfg = getNewYearPigConfig();
              const from = {
                x: cfg.mapOrigin.x,
                y: cfg.mapOrigin.y,
                z: cfg.mapOrigin.z,
              };
              const to = {
                x: cfg.mapOrigin.x + cfg.mapSize - 1,
                y: cfg.mapOrigin.y,
                z: cfg.mapOrigin.z + cfg.mapSize - 1,
              };
              player.dimension.fillBlocks(
                new BlockVolume(from, to),
                "minecraft:grass_block",
              );
              player.sendMessage(
                `§a已生成 ${cfg.mapSize}×${cfg.mapSize} 草方块地皮(原点 ${from.x},${from.y},${from.z})`,
              );
              console.warn(
                `[Bearcade newyearpig] 已生成地图:${cfg.mapSize}×${cfg.mapSize} @ (${from.x},${from.y},${from.z})`,
              );
            } catch (error) {
              player.sendMessage("§c地图生成失败,详情见内容日志");
              console.warn("[Bearcade newyearpig] 地图生成失败", error);
            }
          });
          return { status: CustomCommandStatus.Success };
        },
      );
    } catch (error) {
      console.warn("[Bearcade newyearpig] 注册地图指令失败", error);
    }
  });
}

/** 供其他模块直接调用(如初始化时兜底) */
export function generateNewYearPigMap(): boolean {
  try {
    const runtimeDimId = `bearcade:newyearpig_template`;
    const dimension = world.getDimension(runtimeDimId);
    const cfg = getNewYearPigConfig();
    const from = {
      x: cfg.mapOrigin.x,
      y: cfg.mapOrigin.y,
      z: cfg.mapOrigin.z,
    };
    const to = {
      x: cfg.mapOrigin.x + cfg.mapSize - 1,
      y: cfg.mapOrigin.y,
      z: cfg.mapOrigin.z + cfg.mapSize - 1,
    };
    dimension.fillBlocks(new BlockVolume(from, to), "minecraft:grass_block");
    return true;
  } catch (error) {
    console.warn("[Bearcade newyearpig] 直接生成地图失败", error);
    return false;
  }
}
