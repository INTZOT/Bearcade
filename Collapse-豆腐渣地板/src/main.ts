import { system, world } from "@minecraft/server";
import {
  Player,
  CustomCommandStatus,
  CommandPermissionLevel,
  CustomCommandParamType,
} from "@minecraft/server";
import { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { initCollapse, makeCollapseHooks } from "./game";
import { getCollapseConfig, loadCollapseConfig } from "./collapse-config";
import {
  DISPLAY_NAME,
  GAME_ID,
  IPC_CHANNEL,
  LOBBY_DIMENSION_ID,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PACK_ID,
  PARTY_AVAILABLE,
  PREP_SPAWN,
  ROOM_COPY_ORIGIN,
  ROOM_COUNT,
  START_POSITIONS,
  STRUCTURE_ID,
  TEMPLATE_FROM,
  TEMPLATE_SPAWN,
  TEMPLATE_TO,
  TICKING_FROM,
  TICKING_TO,
} from "./config";

let runtime: MinigameRuntime;
const getRuntime = () => runtime;
runtime = new MinigameRuntime(
  {
    gameId: GAME_ID,
    displayName: DISPLAY_NAME,
    packId: PACK_ID,
    roomCount: ROOM_COUNT,
    maxPlayers: MAX_PLAYERS,
    minPlayers: MIN_PLAYERS,
    partyAvailable: PARTY_AVAILABLE,
    prepSpawn: PREP_SPAWN,
    templateFrom: TEMPLATE_FROM,
    templateTo: TEMPLATE_TO,
    roomCopyOrigin: ROOM_COPY_ORIGIN,
    tickingFrom: TICKING_FROM,
    tickingTo: TICKING_TO,
    structureId: STRUCTURE_ID,
    templateSpawn: TEMPLATE_SPAWN,
    startPositions: START_POSITIONS,
    lobbyDimensionId: LOBBY_DIMENSION_ID,
    ipcChannel: IPC_CHANNEL,
    startDelayTicks: 60 * 20,
    debugStartDelayTicks: 10 * 20,
  },
  makeCollapseHooks(getRuntime),
);

system.beforeEvents.startup.subscribe((event) => {
  runtime.initStartup(event);
});

world.afterEvents.worldLoad.subscribe(() => {
  loadCollapseConfig();
  runtime.config.prepSpawn = getCollapseConfig().prepSpawn;
  runtime.initWorld();
  runtime.initEvents();
  initCollapse(getRuntime);
});

// ============================================================
// 调试命令 /bearcade:spec <目标玩家>:
// 把执行者的相机附加到指定玩家——follow_orbit 预设 + 命令
// `/camera @s attach_to_entity`(命令层无玩家限制;脚本 API 的
// attachToEntity 限定非玩家实体)。需实验开关 "Creator Cameras:
// New Third Person Presets"。验证通过后集成进观战流程。
// ============================================================
const SPEC_TAG = "bearcade:spec_target";

system.beforeEvents.startup.subscribe((event) => {
  try {
    event.customCommandRegistry.registerCommand(
      {
        name: "bearcade:spec",
        description: "调试:绑定相机到指定玩家(follow_orbit+attach)",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
        mandatoryParameters: [
          { name: "target", type: CustomCommandParamType.EntitySelector },
        ],
      },
      (origin, target: unknown) => {
        const player = origin.sourceEntity;
        if (!player || !(player instanceof Player)) {
          return {
            status: CustomCommandStatus.Failure,
            message: "该命令只能由玩家执行",
          };
        }
        // 命令回调运行在受限模式,camera API 需经 system.run 延迟执行
        system.run(() => {
          try {
            // EntitySelector 可能解析为 Entity 或 Entity[],取第一个
            const entity = Array.isArray(target) ? target[0] : target;
            if (!entity || !(entity instanceof Player)) {
              player.sendMessage("§c目标不是玩家");
              return;
            }
            // 1. follow_orbit 预设(默认环绕自己,锚点随后由 attach 接管)
            player.camera.setCamera("minecraft:follow_orbit");
            // 2. 给目标打临时 tag,用命令把相机附加到目标实体
            entity.addTag(SPEC_TAG);
            try {
              const result = player.runCommand(
                `camera @s attach_to_entity @e[tag=${SPEC_TAG}]`,
              );
              player.sendMessage(
                result.successCount > 0
                  ? `§a已附加到 §e${entity.name}§a(follow_orbit,鼠标可环绕视角)`
                  : "§c附加命令未生效",
              );
            } finally {
              entity.removeTag(SPEC_TAG);
            }
          } catch (error) {
            player.sendMessage(`§c绑定失败:${String(error)}`);
            console.warn("[Bearcade collapse] /bearcade:spec 失败", error);
          }
        });
        return {
          status: CustomCommandStatus.Success,
          message: "正在附加相机(follow_orbit)",
        };
      },
    );
  } catch (error) {
    console.warn("[Bearcade collapse] 注册 /bearcade:spec 失败", error);
  }
});
