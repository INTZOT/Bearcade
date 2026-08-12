import {
  system,
  CustomCommandStatus,
  CommandPermissionLevel,
} from "@minecraft/server";
import { toggleDebug } from "./debug";

export function initDebugCommand(): void {
  system.beforeEvents.startup.subscribe((event) => {
    event.customCommandRegistry.registerCommand(
      {
        name: "bearcade:gnb_debug",
        description: "开关建筑猜猜乐调试日志",
        permissionLevel: CommandPermissionLevel.Admin,
        cheatsRequired: false,
      },
      () => {
        const on = toggleDebug();
        return {
          status: CustomCommandStatus.Success,
          message: `调试日志已${on ? "开启" : "关闭"}`,
        };
      },
    );
  });
}
