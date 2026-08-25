// ============================================================
// 冰冻地板(FrozenFloor)入口
// - 接入 shared/minigame-core 房间运行时
// - 注册管理员命令 /bearcade:ffbuild 在模板维度生成地图
// - 加载运行时配置(/bearcade:config frozenfloor)
// ============================================================
import {
  system,
  world,
  CommandPermissionLevel,
  CustomCommandStatus,
  type Player,
} from "@minecraft/server";
import { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { initFrozenFloor, makeFrozenFloorHooks } from "./game";
import { buildFrozenFloorMap } from "./map";
import { getFrozenFloorConfig, loadFrozenFloorConfig } from "./frozenfloor-config";
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
    // 对局进行中最低人数按 1 处理:剩 1 人时由玩法判定胜利,不由共享运行时提前结束
    endGameWhenBelowMin: false,
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
  makeFrozenFloorHooks(getRuntime),
);

system.beforeEvents.startup.subscribe((event) => {
  runtime.initStartup(event);

  // 管理员地图构建指令:/bearcade:ffbuild(在模板维度生成地图)
  try {
    event.customCommandRegistry.registerCommand(
      {
        name: "bearcade:ffbuild",
        description: "在模板维度生成冰冻地板场地",
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
              "§c请先进入模板维度: /bearcade:tmp tp frozenfloor",
            );
            return;
          }
          buildFrozenFloorMap(player.dimension);
          player.sendMessage(
            `§a冰冻地板场地已生成!可执行 /bearcade:tmp ap frozenfloor 应用到全部房间。`,
          );
        });
        return { status: CustomCommandStatus.Success };
      },
    );
    console.warn("[Bearcade frozenfloor] 地图构建指令 /bearcade:ffbuild 已注册");
  } catch (error) {
    console.warn("[Bearcade frozenfloor] 注册 /bearcade:ffbuild 失败", error);
  }
});

world.afterEvents.worldLoad.subscribe(() => {
  loadFrozenFloorConfig();
  runtime.config.prepSpawn = getFrozenFloorConfig().prepSpawn;
  runtime.initWorld();
  runtime.initEvents();
  initFrozenFloor(getRuntime);
});
