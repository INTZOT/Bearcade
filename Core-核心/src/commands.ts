import {
  system,
  world,
  Player,
  CustomCommandStatus,
  CommandPermissionLevel,
  CustomCommandParamType,
} from "@minecraft/server";
import { IPC_CHANNEL, LOBBY_DIMENSION_ID } from "./types";
import type { GameRegistry } from "./registry";

const CORE_PACK_ID = "9ce781fb-ff67-4e21-904d-6a5b8b457703";
const TMP_ACTION_ENUM = "bearcade_tmp_action";

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
    event.customCommandRegistry.registerEnum(TMP_ACTION_ENUM, ["tp", "ap"]);

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

    event.customCommandRegistry.registerCommand(
      {
        name: "bearcade:tmp",
        description: "开发/运维:tp=传送到模板维度,ap=应用模板到全部房间",
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
          } else {
            send("game.apply", { game: gamename });
          }
        });
        return {
          status: CustomCommandStatus.Success,
          message:
            action === "tp"
              ? "正在传送到模板维度"
              : "正在应用模板到全部房间",
        };
      },
    );

    event.customCommandRegistry.registerCommand(
      {
        name: "bearcade:quit",
        description: "强制中止当前维度运行中的小游戏",
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
        const roomPattern = new RegExp(`^bearcade:${gamename}_\\d+$`);
        if (!roomPattern.test(player.dimension.id)) {
          return {
            status: CustomCommandStatus.Failure,
            message: "当前维度不是该游戏的房间",
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
  });
}
