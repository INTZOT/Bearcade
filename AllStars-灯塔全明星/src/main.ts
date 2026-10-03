import { system, world } from "@minecraft/server";
import { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { makeAllStarsHooks } from "./game";
import { registerAllStarsBuildCommand } from "./map";
import { registerAllStarsDiagCommand } from "./diag";
import {
  loadInputCalibration,
  registerAllStarsCalibrationCommand,
} from "./calib";
import {
  DISPLAY_NAME,
  GAME_ID,
  IPC_CHANNEL,
  LOBBY_DIMENSION_ID,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PARTY_AVAILABLE,
  PACK_ID,
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
  makeAllStarsHooks(() => runtime),
);

system.beforeEvents.startup.subscribe((event) => {
  runtime.initStartup(event);
});

world.afterEvents.worldLoad.subscribe(() => {
  // 输入轴向校准结果(世界动态属性)必须最先读出来:deriveIntent 依赖它
  loadInputCalibration();
  runtime.initWorld();
  runtime.initEvents();
});

// 造场命令:在模板维度生成 1v1 擂台 + 准备台(需 op tag)
registerAllStarsBuildCommand();
// 自检命令:一次性打印配置/动画/实体/相机/HUD/输入/场地(需 op tag)
registerAllStarsDiagCommand();
// 输入轴向校准命令:三步引导(前推/右推/后拉)自动定轴向并持久化(需 op tag)
registerAllStarsCalibrationCommand();
