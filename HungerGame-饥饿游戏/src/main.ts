import { system, world } from "@minecraft/server";
import { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { makeHungerGameHooks } from "./game";
import { getHungerGameConfig, loadHungerGameConfig } from "./game-config";
import {
  DISPLAY_NAME,
  GAME_ID,
  IPC_CHANNEL,
  LOBBY_DIMENSION_ID,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PACK_ID,
  PREP_SPAWN,
  ROOM_COPY_ORIGIN,
  ROOM_COUNT,
  START_POS,
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
    partyAvailable: false,
    prepSpawn: PREP_SPAWN,
    templateFrom: TEMPLATE_FROM,
    templateTo: TEMPLATE_TO,
    roomCopyOrigin: ROOM_COPY_ORIGIN,
    tickingFrom: TICKING_FROM,
    tickingTo: TICKING_TO,
    structureId: STRUCTURE_ID,
    templateSpawn: TEMPLATE_SPAWN,
    startPositions: [START_POS],
    lobbyDimensionId: LOBBY_DIMENSION_ID,
    ipcChannel: IPC_CHANNEL,
    startDelayTicks: 60 * 20,
    debugStartDelayTicks: 10 * 20,
  },
  makeHungerGameHooks(getRuntime),
);

system.beforeEvents.startup.subscribe((event) => {
  runtime.initStartup(event);
});

world.afterEvents.worldLoad.subscribe(() => {
  loadHungerGameConfig();
  runtime.config.prepSpawn = getHungerGameConfig().prepSpawn;
  runtime.initWorld();
  runtime.initEvents();
  // 待定:玩法事件监听(轮询/伤害/交互)在玩法设计后于此处注册
});
