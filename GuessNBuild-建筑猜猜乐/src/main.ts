import { system, world } from "@minecraft/server";
import { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { initGuessGame, makeGameHooks } from "./game";
import { initQBank } from "./qbank";
import { initDebugCommand } from "./debugCommand";
import { bindDebugRuntime, isDebug } from "./debug";
import { getGuessConfig, loadGuessConfig } from "./guess-config";
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
bindDebugRuntime(getRuntime);

function syncDebugCountdown(on: boolean): void {
  // 调试开启时倒计时 10 秒,关闭后恢复 60 秒默认
  runtime.config.startDelayTicks = (on ? 10 : 60) * 20;
}

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
  },
  makeGameHooks(getRuntime),
);

system.beforeEvents.startup.subscribe((event) => {
  runtime.initStartup(event);
});

initQBank();
initDebugCommand(syncDebugCountdown);

world.afterEvents.worldLoad.subscribe(() => {
  syncDebugCountdown(isDebug());
  loadGuessConfig();
  runtime.config.prepSpawn = getGuessConfig().prepSpawn;
  runtime.initWorld();
  runtime.initEvents();
  initGuessGame(getRuntime);
});
