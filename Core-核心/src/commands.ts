import {
  system,
  world,
  Player,
  CustomCommandStatus,
  CommandPermissionLevel,
} from "@minecraft/server";
import { LOBBY_DIMENSION_ID } from "./types";

export function initCommands(): void {
  system.beforeEvents.startup.subscribe((event) => {
    event.customCommandRegistry.registerCommand(
      {
        name: "bearcade:lobby",
        description: "传送回大厅(主世界)",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || !(player instanceof Player)) {
          return {
            status: CustomCommandStatus.Failure,
            message: "该命令只能由玩家执行",
          };
        }
        // 命令回调运行在 restricted execution 模式,须延迟到正常上下文
        system.run(() => {
          try {
            const dimension = world.getDimension(LOBBY_DIMENSION_ID);
            player.teleport(world.getDefaultSpawnLocation(), { dimension });
          } catch (error) {
            console.warn("[Bearcade Core] /bearcade:lobby 传送失败", error);
          }
        });
        return {
          status: CustomCommandStatus.Success,
          message: "正在传送回大厅",
        };
      },
    );
  });
}
