import {
  system,
  world,
  Player,
  CustomCommandStatus,
  CommandPermissionLevel,
  CustomCommandParamType,
} from "@minecraft/server";
import { IPC_CHANNEL, LOBBY_DIMENSION_ID, CORE_PACK_ID } from "./types";
import type { GameRegistry } from "./registry";
import { togglePartyMode } from "./party";

const TMP_ACTION_ENUM = "bearcade:tmp_action";

function send(op: string, payload: unknown): void {
  system.sendScriptEvent(
    IPC_CHANNEL,
    JSON.stringify({ op, packId: CORE_PACK_ID, payload }),
  );
}

export function initCommands(
  getRegistry: () => GameRegistry | undefined,
): void {
  system.beforeEvents.startup.subscribe((event) => {
    try {
      event.customCommandRegistry.registerEnum(TMP_ACTION_ENUM, [
        "tp",
        "ap",
        "sz",
      ]);
      event.customCommandRegistry.registerEnum("bearcade:debug_state", [
        "enable",
        "disable",
      ]);
    } catch (error) {
      console.warn("[Bearcade Core] 注册 tmp 枚举失败", error);
    }

    try {
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
    } catch (error) {
      console.warn("[Bearcade Core] 注册 /bearcade:lobby 失败", error);
    }

    try {
      event.customCommandRegistry.registerCommand(
        {
          name: "bearcade:tmp",
          description: "开发/运维:tp=模板维度,ap=应用模板,sz=表单配置模板范围",
          permissionLevel: CommandPermissionLevel.Admin,
          cheatsRequired: false,
          mandatoryParameters: [
            {
              name: "action",
              type: CustomCommandParamType.Enum,
              enumName: TMP_ACTION_ENUM,
            },
            {
              name: "gamename",
              type: CustomCommandParamType.String,
            },
          ],
        },
        (origin, action: string, gamename: string) => {
          const player = origin.sourceEntity;
          if (!player || !(player instanceof Player)) {
            return {
              status: CustomCommandStatus.Failure,
              message: "该命令只能由玩家执行",
            };
          }
          if (!getRegistry()?.getGame(gamename)) {
            return {
              status: CustomCommandStatus.Failure,
              message: `未知游戏:${gamename}`,
            };
          }
          system.run(() => {
            if (action === "tp") {
              send("game.tp", { game: gamename, playerId: player.id });
            } else if (action === "ap") {
              send("game.apply", { game: gamename, playerId: player.id });
            } else {
              send("game.sz", { game: gamename, playerId: player.id });
            }
          });
          return {
            status: CustomCommandStatus.Success,
            message:
              action === "tp"
                ? "正在传送到模板维度"
                : action === "ap"
                  ? "正在应用模板到全部房间"
                  : "正在打开模板范围配置",
          };
        },
      );
    } catch (error) {
      console.warn("[Bearcade Core] 注册 /bearcade:tmp 失败", error);
    }

    try {
      event.customCommandRegistry.registerCommand(
        {
          name: "bearcade:quit",
          description: "强制中止当前维度运行中的小游戏",
          permissionLevel: CommandPermissionLevel.Admin,
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
          const match = /^bearcade:([a-z0-9_]+)_\d+$/.exec(
            player.dimension.id,
          );
          if (!match) {
            return {
              status: CustomCommandStatus.Failure,
              message: "当前维度不是游戏房间",
            };
          }
          const gamename = match[1];
          if (!getRegistry()?.getGame(gamename)) {
            return {
              status: CustomCommandStatus.Failure,
              message: `未知游戏:${gamename}`,
            };
          }
          system.run(() => {
            send("game.quit", {
              game: gamename,
              dimensionId: player.dimension.id,
            });
          });
          return {
            status: CustomCommandStatus.Success,
            message: "已请求强制中止当前对局",
          };
        },
      );
    } catch (error) {
      console.warn("[Bearcade Core] 注册 /bearcade:quit 失败", error);
    }

    try {
      event.customCommandRegistry.registerCommand(
        {
          name: "bearcade:party",
          description: "开关派对模式(管理员带队全服加入 PartyAvailable 游戏)",
          permissionLevel: CommandPermissionLevel.Admin,
          cheatsRequired: false,
        },
        () => {
          const on = togglePartyMode();
          return {
            status: CustomCommandStatus.Success,
            message: `派对模式已${on ? "开启" : "关闭"}`,
          };
        },
      );
    } catch (error) {
      console.warn("[Bearcade Core] 注册 /bearcade:party 失败", error);
    }

    try {
      event.customCommandRegistry.registerCommand(
        {
          name: "bearcade:config",
          description: "打开指定游戏的运行时配置界面",
          permissionLevel: CommandPermissionLevel.Admin,
          cheatsRequired: false,
          mandatoryParameters: [
            {
              name: "gamename",
              type: CustomCommandParamType.String,
            },
          ],
        },
        (origin, gamename: string) => {
          const player = origin.sourceEntity;
          if (!player || !(player instanceof Player)) {
            return {
              status: CustomCommandStatus.Failure,
              message: "该命令只能由玩家执行",
            };
          }
          if (!getRegistry()?.getGame(gamename)) {
            return {
              status: CustomCommandStatus.Failure,
              message: `未知游戏:${gamename}`,
            };
          }
          system.run(() => {
            send("game.config", { game: gamename, playerId: player.id });
          });
          return {
            status: CustomCommandStatus.Success,
            message: "正在打开配置界面",
          };
        },
      );
    } catch (error) {
      console.warn("[Bearcade Core] 注册 /bearcade:config 失败", error);
    }

    try {
      event.customCommandRegistry.registerCommand(
        {
          name: "bearcade:debug",
          description: "切换指定游戏的调试日志",
          permissionLevel: CommandPermissionLevel.Admin,
          cheatsRequired: false,
          mandatoryParameters: [
            {
              name: "gamename",
              type: CustomCommandParamType.String,
            },
            {
              name: "enabled",
              type: CustomCommandParamType.Enum,
              enumName: "bearcade:debug_state",
            },
          ],
        },
        (origin, gamename: string, state: string) => {
          const player = origin.sourceEntity;
          if (!player || !(player instanceof Player)) {
            return {
              status: CustomCommandStatus.Failure,
              message: "该命令只能由玩家执行",
            };
          }
          const enabled = state === "enable";
          const registry = getRegistry();
          if (gamename === "all") {
            if (!registry) {
              return {
                status: CustomCommandStatus.Failure,
                message: "注册表尚未就绪",
              };
            }
            system.run(() => {
              for (const game of registry.listGames()) {
                send("game.debug", {
                  game: game.game,
                  playerId: player.id,
                  enabled,
                });
              }
            });
            return {
              status: CustomCommandStatus.Success,
              message: `已对全部游戏${enabled ? "启用" : "关闭"}调试日志`,
            };
          }
          if (!registry?.getGame(gamename)) {
            return {
              status: CustomCommandStatus.Failure,
              message: `未知游戏:${gamename}`,
            };
          }
          system.run(() => {
            send("game.debug", {
              game: gamename,
              playerId: player.id,
              enabled,
            });
          });
          return {
            status: CustomCommandStatus.Success,
            message: `调试日志已${enabled ? "开启" : "关闭"}`,
          };
        },
      );
    } catch (error) {
      console.warn("[Bearcade Core] 注册 /bearcade:debug 失败", error);
    }
  });
}
