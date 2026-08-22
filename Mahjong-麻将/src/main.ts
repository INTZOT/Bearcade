import {
  CommandPermissionLevel,
  CustomCommandStatus,
  system,
  world,
  type Player,
} from "@minecraft/server";
import { MinigameRuntime } from "../../shared/minigame-core/runtime";
import {
  makeMahjongHooks,
  initMahjong,
  handleMahjongBack,
  openHostMenu,
} from "./game";
import { loadMahjongConfig, getMahjongConfig } from "./mahjong-config";
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
    manualStart: false,
    endGameWhenBelowMin: false,
    prepSpawn: PREP_SPAWN,
    templateFrom: TEMPLATE_FROM,
    templateTo: TEMPLATE_TO,
    roomCopyOrigin: ROOM_COPY_ORIGIN,
    tickingFrom: TICKING_FROM,
    tickingTo: TICKING_TO,
    structureId: STRUCTURE_ID,
    templateSpawn: TEMPLATE_SPAWN,
    startPositions: getMahjongConfig().seatPositions,
    lobbyDimensionId: LOBBY_DIMENSION_ID,
    ipcChannel: IPC_CHANNEL,
    startDelayTicks: 60 * 20,
    debugStartDelayTicks: 10 * 20,
  },
  makeMahjongHooks(getRuntime),
);

system.beforeEvents.startup.subscribe((event) => {
  runtime.initStartup(event);
  try {
    event.customCommandRegistry.registerCommand(
      {
        name: "mahjong:back",
        description: "回到你所在的麻将房间座位",
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
        system.runTimeout(() => handleMahjongBack(player, getRuntime()), 2);
        return { status: CustomCommandStatus.Success };
      },
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "mahjong:setup",
        description: "打开麻将房主设置界面",
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
        const roomId = runtime.roomIdFromDimension(player.dimension.id);
        if (roomId === undefined) {
          return {
            status: CustomCommandStatus.Failure,
            message: "请在麻将房间内使用",
          };
        }
        system.runTimeout(() => openHostMenu(player, roomId, getRuntime()), 2);
        return { status: CustomCommandStatus.Success };
      },
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "mahjong:buildfield",
        description: "在麻将模板维度生成 26×26 场地(脚本版,不依赖 mcfunction)",
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
        if (player.dimension.id !== "bearcade:mahjong_template") {
          return {
            status: CustomCommandStatus.Failure,
            message: "请在麻将模板维度使用(/bearcade:tmp tp mahjong)",
          };
        }
        system.runTimeout(() => {
          try {
            const dim = player.dimension;
            dim.runCommand("fill -13 63 -13 14 70 14 air");
            dim.runCommand("fill -12 64 -12 13 64 13 minecraft:polished_blackstone");
            dim.runCommand("fill -13 65 -13 -13 65 13 minecraft:barrier");
            dim.runCommand("fill 14 65 -13 14 65 13 minecraft:barrier");
            dim.runCommand("fill -13 65 -13 14 65 -13 minecraft:barrier");
            dim.runCommand("fill -13 65 14 14 65 14 minecraft:barrier");
            dim.runCommand("setblock 0 65 0 minecraft:gold_block");
            dim.runCommand("setblock 0 65 -1 minecraft:stone_button [\"facing_direction\"=2]");
            dim.runCommand("setblock -1 65 13 minecraft:polished_blackstone");
            dim.runCommand("setblock 1 65 13 minecraft:polished_blackstone");
            dim.runCommand("setblock -1 65 12 minecraft:stone_button [\"facing_direction\"=2]");
            dim.runCommand("setblock 1 65 12 minecraft:stone_button [\"facing_direction\"=2]");
            dim.runCommand("setblock -13 65 -1 minecraft:polished_blackstone");
            dim.runCommand("setblock -13 65 1 minecraft:polished_blackstone");
            dim.runCommand("setblock -12 65 -1 minecraft:stone_button [\"facing_direction\"=5]");
            dim.runCommand("setblock -12 65 1 minecraft:stone_button [\"facing_direction\"=5]");
            dim.runCommand("setblock -1 65 -13 minecraft:polished_blackstone");
            dim.runCommand("setblock 1 65 -13 minecraft:polished_blackstone");
            dim.runCommand("setblock -1 65 -12 minecraft:stone_button [\"facing_direction\"=3]");
            dim.runCommand("setblock 1 65 -12 minecraft:stone_button [\"facing_direction\"=3]");
            dim.runCommand("setblock 13 65 -1 minecraft:polished_blackstone");
            dim.runCommand("setblock 13 65 1 minecraft:polished_blackstone");
            dim.runCommand("setblock 12 65 -1 minecraft:stone_button [\"facing_direction\"=4]");
            dim.runCommand("setblock 12 65 1 minecraft:stone_button [\"facing_direction\"=4]");
            player.sendMessage("§a[Mahjong] 场地已生成(脚本命令)");
          } catch (error) {
            console.warn("[Bearcade Mahjong] buildfield 失败", error);
            player.sendMessage("§c场地生成失败,详见内容日志");
          }
        }, 2);
        return { status: CustomCommandStatus.Success };
      },
    );
  } catch (error) {
    console.warn("[Bearcade Mahjong] 注册命令失败", error);
  }
});

world.afterEvents.worldLoad.subscribe(() => {
  loadMahjongConfig();
  const cfg = getMahjongConfig();
  runtime.config.prepSpawn = cfg.prepSpawn;
  runtime.config.startPositions = cfg.seatPositions;
  runtime.initWorld();
  runtime.initEvents();
  initMahjong(getRuntime);
});
