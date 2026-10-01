import {
  system,
  Player,
  CustomCommandStatus,
  CommandPermissionLevel,
  CustomCommandParamType,
} from "@minecraft/server";
import type { GameRegistry } from "./registry";
import { togglePartyMode } from "./party";
import {
  requestConfig,
  requestDebug,
  requestQuitDimension,
  requestTmpAction,
  teleportToLobby,
  type ActionResult,
  type TmpAction,
} from "./actions";
import { setGameOpen } from "./access";

const TMP_ACTION_ENUM = "bearcade:tmp_action";
const DEBUG_STATE_ENUM = "bearcade:debug_state";

/**
 * 管理命令权限校验:命令以 Any 注册(引擎权限不设门槛),
 * 管理员判定统一按 op tag(与 README"管理员以 op tag 判定"一致)。
 * 通过时返回收窄后的 player,否则返回拒绝结果。
 */
function requireAdmin(
  entity: import("@minecraft/server").Entity | undefined,
):
  | { ok: true; player: Player }
  | { ok: false; result: { status: CustomCommandStatus; message: string } } {
  if (!entity || !(entity instanceof Player)) {
    return {
      ok: false,
      result: {
        status: CustomCommandStatus.Failure,
        message: "该命令只能由玩家执行",
      },
    };
  }
  if (!entity.hasTag("op")) {
    return {
      ok: false,
      result: {
        status: CustomCommandStatus.Failure,
        message: "权限不足:需要 op tag(管理员)",
      },
    };
  }
  return { ok: true, player: entity };
}

/** 把动作层结果转成命令返回值(失败提示与面板共用同一份文案) */
function toCommandResult(
  result: ActionResult,
  successMessage: string,
): { status: CustomCommandStatus; message: string } {
  return result.ok
    ? { status: CustomCommandStatus.Success, message: successMessage }
    : { status: CustomCommandStatus.Failure, message: result.reason };
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
      event.customCommandRegistry.registerEnum(DEBUG_STATE_ENUM, [
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
          system.run(() => teleportToLobby(player));
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
          permissionLevel: CommandPermissionLevel.Any,
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
          const check = requireAdmin(origin.sourceEntity);
          if (!check.ok) return check.result;
          const registry = getRegistry();
          const tmpAction = action as TmpAction;
          const message =
            tmpAction === "tp"
              ? "正在传送到模板维度"
              : tmpAction === "ap"
                ? "正在应用模板到全部房间"
                : "正在打开模板范围配置";
          if (!registry) {
            return {
              status: CustomCommandStatus.Failure,
              message: `未知游戏:${gamename}`,
            };
          }
          return toCommandResult(
            requestTmpAction(registry, check.player, tmpAction, gamename),
            message,
          );
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
          permissionLevel: CommandPermissionLevel.Any,
          cheatsRequired: false,
        },
        (origin) => {
          const check = requireAdmin(origin.sourceEntity);
          if (!check.ok) return check.result;
          const registry = getRegistry();
          if (!registry) {
            return {
              status: CustomCommandStatus.Failure,
              message: "注册表尚未就绪",
            };
          }
          return toCommandResult(
            requestQuitDimension(registry, check.player.dimension.id),
            "已请求强制中止当前对局",
          );
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
          permissionLevel: CommandPermissionLevel.Any,
          cheatsRequired: false,
        },
        (origin) => {
          const check = requireAdmin(origin.sourceEntity);
          if (!check.ok) return check.result;
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
          permissionLevel: CommandPermissionLevel.Any,
          cheatsRequired: false,
          mandatoryParameters: [
            {
              name: "gamename",
              type: CustomCommandParamType.String,
            },
          ],
        },
        (origin, gamename: string) => {
          const check = requireAdmin(origin.sourceEntity);
          if (!check.ok) return check.result;
          const registry = getRegistry();
          if (!registry) {
            return {
              status: CustomCommandStatus.Failure,
              message: `未知游戏:${gamename}`,
            };
          }
          return toCommandResult(
            requestConfig(registry, check.player, gamename),
            "正在打开配置界面",
          );
        },
      );
    } catch (error) {
      console.warn("[Bearcade Core] 注册 /bearcade:config 失败", error);
    }

    try {
      event.customCommandRegistry.registerCommand(
        {
          name: "bearcade:enable",
          description: "开放/关闭指定游戏的进入(关闭后仍在列表显示但带「暂未开放」且不可点击)",
          permissionLevel: CommandPermissionLevel.Any,
          cheatsRequired: false,
          mandatoryParameters: [
            {
              name: "gamename",
              type: CustomCommandParamType.String,
            },
            {
              name: "enabled",
              type: CustomCommandParamType.Boolean,
            },
          ],
        },
        (origin, gamename: string, enabled: boolean) => {
          const check = requireAdmin(origin.sourceEntity);
          if (!check.ok) return check.result;
          if (!getRegistry()?.getActiveGame(gamename)) {
            return {
              status: CustomCommandStatus.Failure,
              message: `未知游戏:${gamename}`,
            };
          }
          const changed = setGameOpen(gamename, enabled);
          return {
            status: CustomCommandStatus.Success,
            message: changed
              ? `已${enabled ? "开放" : "关闭"}「${gamename}」进入`
              : `「${gamename}」已是${enabled ? "开放" : "关闭"}状态`,
          };
        },
      );
    } catch (error) {
      console.warn("[Bearcade Core] 注册 /bearcade:enable 失败", error);
    }

    try {
      event.customCommandRegistry.registerCommand(
        {
          name: "bearcade:debug",
          description: "切换指定游戏的调试日志",
          permissionLevel: CommandPermissionLevel.Any,
          cheatsRequired: false,
          mandatoryParameters: [
            {
              name: "gamename",
              type: CustomCommandParamType.String,
            },
            {
              name: "enabled",
              type: CustomCommandParamType.Enum,
              enumName: DEBUG_STATE_ENUM,
            },
          ],
        },
        (origin, gamename: string, state: string) => {
          const check = requireAdmin(origin.sourceEntity);
          if (!check.ok) return check.result;
          const registry = getRegistry();
          const enabled = state === "enable";
          if (!registry) {
            return {
              status: CustomCommandStatus.Failure,
              message: "注册表尚未就绪",
            };
          }
          return toCommandResult(
            requestDebug(registry, check.player, gamename, enabled),
            gamename === "all"
              ? `已对全部游戏${enabled ? "启用" : "关闭"}调试日志`
              : `调试日志已${enabled ? "开启" : "关闭"}`,
          );
        },
      );
    } catch (error) {
      console.warn("[Bearcade Core] 注册 /bearcade:debug 失败", error);
    }
  });
}
