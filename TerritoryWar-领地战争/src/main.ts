// ============================================================
// 领地战争(TerritoryWar)入口
// - 接入 shared/minigame-core 房间运行时(2 房 / 每房 8 人)
// - 注册管理员建图命令 /bearcade:territory_war_buildmap
// - 加载运行时配置(/bearcade:config territory_war)
// ============================================================
import { system, world } from "@minecraft/server";
import { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { initTerritoryWar, makeTerritoryWarHooks } from "./game";
import { registerTerritoryWarBuildCommand } from "./map";
import {
  getTerritoryWarConfig,
  loadTerritoryWarConfig,
} from "./territory-war-config";
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
  },
  makeTerritoryWarHooks(getRuntime),
);

// 建图命令自带 startup 订阅,需与维度注册同帧注册
registerTerritoryWarBuildCommand(getRuntime);

system.beforeEvents.startup.subscribe((event) => {
  runtime.initStartup(event);
});

world.afterEvents.worldLoad.subscribe(() => {
  // 配置读取依赖世界已加载(动态属性),必须在 worldLoad 内进行;
  // 并把持久化的准备点写回运行时,否则重启后 Core 仍按代码常量传送。
  loadTerritoryWarConfig();
  runtime.config.prepSpawn = getTerritoryWarConfig().prepSpawn;
  runtime.initWorld();
  runtime.initEvents();
  initTerritoryWar(getRuntime);
});
