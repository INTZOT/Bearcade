import { system, world } from "@minecraft/server";
import { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { initHungerGame, makeHungerGameHooks } from "./game";
import { getHungerGameConfig, loadHungerGameConfig } from "./game-config";
import { ensurePoolEntities } from "./loot";
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
    partyAvailable: true,
    // FFA:有人退出视为淘汰,对局继续,不能因人数低于 min 自动结束
    endGameWhenBelowMin: false,
    // 512² 地图:64 格分块 + 窗口化逐单元捕获/放置(引擎常加载上限 100 区块/个)
    tileSize: 64,
    tileWindowed: true,
    prepSpawn: PREP_SPAWN,
    templateFrom: TEMPLATE_FROM,
    templateTo: TEMPLATE_TO,
    roomCopyOrigin: ROOM_COPY_ORIGIN,
    tickingFrom: TICKING_FROM,
    tickingTo: TICKING_TO,
    structureId: STRUCTURE_ID,
    templateSpawn: TEMPLATE_SPAWN,
    startPositions: [],
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
  // 物资池实体(每房间 4 级,区块未加载时内部重试)
  ensurePoolEntities(getRuntime);
  // 玩法事件监听
  initHungerGame(getRuntime);
});
