import { system, world } from "@minecraft/server";
import {
  Player,
  CustomCommandStatus,
  CommandPermissionLevel,
} from "@minecraft/server";
import { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { initGo, makeGoHooks, passCommand } from "./game";
import { getGoConfig, loadGoConfig } from "./go-config";
import {
  DISPLAY_NAME,
  GAME_ID,
  IPC_CHANNEL,
  LOBBY_DIMENSION_ID,
  MAX_PLAYERS,
  PACK_ID,
  PREP_SPAWN,
  ROOM_COPY_ORIGIN,
  ROOM_COUNT,
  START_POS_BLACK,
  START_POS_WHITE,
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
    minPlayers: 2,
    partyAvailable: false,
    prepSpawn: PREP_SPAWN,
    templateFrom: TEMPLATE_FROM,
    templateTo: TEMPLATE_TO,
    roomCopyOrigin: ROOM_COPY_ORIGIN,
    tickingFrom: TICKING_FROM,
    tickingTo: TICKING_TO,
    structureId: STRUCTURE_ID,
    templateSpawn: TEMPLATE_SPAWN,
    startPositions: [START_POS_BLACK, START_POS_WHITE],
    lobbyDimensionId: LOBBY_DIMENSION_ID,
    ipcChannel: IPC_CHANNEL,
    startDelayTicks: 60 * 20,
    debugStartDelayTicks: 10 * 20,
  },
  makeGoHooks(getRuntime),
);

system.beforeEvents.startup.subscribe((event) => {
  runtime.initStartup(event);
  // 停一手命令
  try {
    event.customCommandRegistry.registerCommand(
      {
        name: "bearcade:go_pass",
        description: "围棋:停一手(双方连续停手则终局计目)",
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
          player.sendMessage(
            passCommand(getRuntime(), player)
              ? "§a已停一手"
              : "§c停一手失败(不在对局中或未轮到你)",
          );
        });
        return {
          status: CustomCommandStatus.Success,
          message: "正在停一手",
        };
      },
    );
  } catch (error) {
    console.warn("[Bearcade Go] 注册 /bearcade:go_pass 失败", error);
  }
});

world.afterEvents.worldLoad.subscribe(() => {
  loadGoConfig();
  runtime.config.prepSpawn = getGoConfig().prepSpawn;
  runtime.initWorld();
  runtime.initEvents();
  initGo(getRuntime);
});
