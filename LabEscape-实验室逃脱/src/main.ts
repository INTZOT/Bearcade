import { system, world } from "@minecraft/server";

import { MinigameRuntime } from "../../shared/minigame-core/runtime";

import { makeLabEscapeHooks, initLabEscapeEvents } from "./game";

import { loadLabEscapeConfig, getLabEscapeConfig } from "./labescape-config";

import { registerLabEscapeBuildCommand } from "./map";

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

    // 完赛玩家可提前 /lobby 离开,剩余玩家继续完成最后冲刺;

    // 不得依赖"改全局 minPlayers=1"实现(会污染其他房间),由玩法自身 endRoom 收尾

    endGameWhenBelowMin: false,

  },

  makeLabEscapeHooks(() => runtime),

);



// 必须在 startup 事件触发前注册订阅,不能嵌套在另一个 startup 回调里注册

registerLabEscapeBuildCommand();



system.beforeEvents.startup.subscribe((event) => {

  runtime.initStartup(event);

});



world.afterEvents.worldLoad.subscribe(() => {

  loadLabEscapeConfig();

  runtime.config.prepSpawn = getLabEscapeConfig().prepSpawn;

  runtime.config.maxPlayers = getLabEscapeConfig().maxPlayers;

  runtime.initWorld();

  runtime.initEvents();

  initLabEscapeEvents(() => runtime);

});

