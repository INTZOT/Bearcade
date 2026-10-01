// ============================================================
// 轮转井字棋(Trio)入口
// - 接入 shared/minigame-core 房间运行时(2 房 / 每房 2 人)
// - 注册管理员命令 /bearcade:trio_buildmap 在模板维度生成场地
// - 加载运行时配置(/bearcade:config trio)
// ============================================================
import {
  system,
  world,
  CommandPermissionLevel,
  CustomCommandStatus,
  type Player,
} from "@minecraft/server";
import { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { initTrio, makeTrioHooks } from "./game";
import { buildTrioMap } from "./map";
import { getTrioConfig, loadTrioConfig } from "./trio-config";
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
    lobbyDimensionId: LOBBY_DIMENSION_ID,
    ipcChannel: IPC_CHANNEL,
    startDelayTicks: 60 * 20,
    debugStartDelayTicks: 10 * 20,
  },
  makeTrioHooks(getRuntime),
);

system.beforeEvents.startup.subscribe((event) => {
  runtime.initStartup(event);

  // 管理员地图构建指令:/bearcade:trio_buildmap(在模板维度生成场地)
  try {
    event.customCommandRegistry.registerCommand(
      {
        name: "bearcade:trio_buildmap",
        description: "在模板维度生成轮转井字棋场地(3×3 磁石棋盘 + 走道 + 准备平台)",
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
        const player = entity as Player;
        if (!player.hasTag("op")) {
          return {
            status: CustomCommandStatus.Failure,
            message: "权限不足:需要 op tag(管理员)",
          };
        }
        system.run(() => {
          if (player.dimension.id !== runtime.templateDimensionId()) {
            player.sendMessage(
              "§c请先进入模板维度: /bearcade:tmp tp trio",
            );
            return;
          }
          buildTrioMap(player.dimension);
          player.sendMessage(
            "§a轮转井字棋场地已生成!可执行 /bearcade:tmp ap trio 应用到全部房间。",
          );
        });
        return { status: CustomCommandStatus.Success };
      },
    );
    console.warn(
      "[Bearcade trio] 地图构建指令 /bearcade:trio_buildmap 已注册",
    );
  } catch (error) {
    console.warn("[Bearcade trio] 注册 /bearcade:trio_buildmap 失败", error);
  }
});

world.afterEvents.worldLoad.subscribe(() => {
  loadTrioConfig();
  runtime.config.prepSpawn = getTrioConfig().prepSpawn;
  runtime.initWorld();
  runtime.initEvents();
  initTrio(getRuntime);
});
