import { system, world } from "@minecraft/server";
import { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { initStudioEvents, makeStudioHooks } from "./game";
import { loadStudioConfig, getStudioConfig } from "./studio-config";
import { registerStudioBuildCommand } from "./map";
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
    partyStartDelayTicks: 60 * 20,
    endGameWhenBelowMin: true,
  },
  makeStudioHooks(() => runtime),
);

// 必须在 startup 事件触发前注册订阅,不能嵌套在另一个 startup 回调里注册
registerStudioBuildCommand();

system.beforeEvents.startup.subscribe((event) => {
  runtime.initStartup(event);
});

world.afterEvents.worldLoad.subscribe(() => {
  loadStudioConfig();
  runtime.config.prepSpawn = getStudioConfig().prepSpawn;
  runtime.config.maxPlayers = getStudioConfig().maxPlayers;
  runtime.initWorld();
  runtime.initEvents();
  initStudioEvents(() => runtime);
});
