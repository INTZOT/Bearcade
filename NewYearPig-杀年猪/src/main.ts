import { system, world } from "@minecraft/server";
import { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { makeNewYearPigHooks, initNewYearPig } from "./game";
import { getNewYearPigConfig, loadNewYearPigConfig } from "./newyearpig-config";
import { registerNewYearPigBuildCommand } from "./map";
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
  makeNewYearPigHooks(() => runtime),
);

registerNewYearPigBuildCommand(() => runtime);

system.beforeEvents.startup.subscribe((event) => {
  runtime.initStartup(event);
});

world.afterEvents.worldLoad.subscribe(() => {
  // 配置读取依赖世界已加载(动态属性),必须在 worldLoad 内进行;
  // 并把持久化的准备点写回运行时,否则 /bearcade:config 改过的 prepSpawn
  // 在服务器重启后失效(Core 仍按代码常量传送)。
  loadNewYearPigConfig();
  runtime.config.prepSpawn = getNewYearPigConfig().prepSpawn;
  runtime.initWorld();
  runtime.initEvents();
  initNewYearPig(() => runtime);
});
