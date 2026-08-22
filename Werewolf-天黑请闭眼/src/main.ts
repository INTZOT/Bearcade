import {

  system,

  world,

  CommandPermissionLevel,

  CustomCommandStatus,

  type Player,

} from "@minecraft/server";

import { MinigameRuntime } from "../../shared/minigame-core/runtime";

import {

  initWerewolf,

  makeWerewolfHooks,

  setFivePlayerDebug,

  isFivePlayerDebug,

} from "./game";

import { getWerewolfConfig, loadWerewolfConfig } from "./werewolf-config";

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



const FIVE_DEBUG_KEY = "bearcade:ww5_debug";



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


    lobbyDimensionId: LOBBY_DIMENSION_ID,

    ipcChannel: IPC_CHANNEL,

    startDelayTicks: 60 * 20,

    debugStartDelayTicks: 10 * 20,

    // 退出/断线视为出局、对局继续,由玩法自行处理离场玩家

    endGameWhenBelowMin: false,

  },

  makeWerewolfHooks(getRuntime),

);



system.beforeEvents.startup.subscribe((event) => {

  runtime.initStartup(event);



  // 调试指令:/bearcade:ww5 开启后 5 人即可开局(5 人配置少 1 平民)

  try {

    event.customCommandRegistry.registerCommand(

      {

        name: "bearcade:ww5",

        description: "调试:开启/关闭5人开局(5人配置少1平民)",

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

        const next = !isFivePlayerDebug();

        system.run(() => {

          setFivePlayerDebug(next);

          runtime.config.minPlayers = next ? 5 : MIN_PLAYERS;

          world.setDynamicProperty(FIVE_DEBUG_KEY, next);

          player.sendMessage(

            next

              ? "§a已开启5人调试开局(5人配置:1平民/1警察/1守卫/1杀手/1狙击手)"

              : "§7已关闭5人调试,恢复6人开局",

          );

        });

        return {

          status: CustomCommandStatus.Success,

          message: next ? "已开启5人调试开局" : "已关闭5人调试开局",

        };

      },

    );

    console.warn("[Bearcade werewolf] 调试指令 /bearcade:ww5 已注册");

  } catch (error) {

    console.warn("[Bearcade werewolf] 注册 /bearcade:ww5 失败", error);

  }

});



world.afterEvents.worldLoad.subscribe(() => {

  loadWerewolfConfig();

  // 恢复调试开关(持久化)

  const savedDebug = world.getDynamicProperty(FIVE_DEBUG_KEY) === true;

  setFivePlayerDebug(savedDebug);

  runtime.config.minPlayers = savedDebug ? 5 : MIN_PLAYERS;

  runtime.config.prepSpawn = getWerewolfConfig().prepSpawn;

  runtime.initWorld();

  runtime.initEvents();

  initWerewolf(getRuntime);

});

