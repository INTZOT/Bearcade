import { system, world } from "@minecraft/server";
import { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { initBridgeWar, makeGameHooks } from "./game";
import { getBridgeConfig, loadBridgeConfig } from "./bridge-config";
import { ensureLoadoutEntities } from "./loadout";
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
  },
  makeGameHooks(getRuntime),
);

system.beforeEvents.startup.subscribe((event) => {
  runtime.initStartup(event);
});

world.afterEvents.worldLoad.subscribe(() => {
  loadBridgeConfig();
  runtime.config.prepSpawn = getBridgeConfig().prepSpawn;
  ensureLoadoutEntities();
  runtime.initWorld();
  runtime.initEvents();
  initBridgeWar(getRuntime);
});
