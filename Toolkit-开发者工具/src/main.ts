// ============================================================
// Bearcade Toolkit(开发者工具)入口
// 纯工具包:自定义命令 /btd(悬浮公告管理)、/cis(CustomItemStack)
// ============================================================
import {
  system,
  world,
  CommandPermissionLevel,
  CustomCommandStatus,
  type Player,
} from "@minecraft/server";
import { initNotice, showNoticeAdminMenu } from "./notice";
import { openCisForm } from "./cis";
import { COMMAND_BTD, COMMAND_CIS, PACK_NAME } from "./config";

function registerCommands(): void {
  system.beforeEvents.startup.subscribe((event) => {
    try {
      event.customCommandRegistry.registerCommand(
        {
          name: COMMAND_BTD,
          description: "打开悬浮公告管理",
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
          // 管理员判定统一按 op tag(与 Core 一致)
          if (!entity.hasTag("op")) {
            return {
              status: CustomCommandStatus.Failure,
              message: "权限不足:需要 op tag(管理员)",
            };
          }
          const player = entity as Player;
          system.runTimeout(() => showNoticeAdminMenu(player), 2);
          return { status: CustomCommandStatus.Success };
        },
      );
    } catch (error) {
      console.warn("[Bearcade Toolkit] 注册 /btd 失败", error);
    }
    try {
      event.customCommandRegistry.registerCommand(
        {
          name: COMMAND_CIS,
          description: "打开手持物品属性编辑(CustomItemStack)",
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
          // 管理员判定统一按 op tag(与 Core 一致)
          if (!entity.hasTag("op")) {
            return {
              status: CustomCommandStatus.Failure,
              message: "权限不足:需要 op tag(管理员)",
            };
          }
          const player = entity as Player;
          system.runTimeout(() => openCisForm(player), 2);
          return { status: CustomCommandStatus.Success };
        },
      );
    } catch (error) {
      console.warn("[Bearcade Toolkit] 注册 /cis 失败", error);
    }
  });
}

registerCommands();
initNotice();

world.afterEvents.worldLoad.subscribe(() => {
  console.warn(
    `[${PACK_NAME}] 已加载:/btd 悬浮公告管理、/cis 手持物品属性编辑(仅管理员)`,
  );
});
