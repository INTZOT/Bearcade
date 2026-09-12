import { world, system } from "@minecraft/server";
import { GameRegistry } from "./registry";
import { initIpc, requestGameRegistration } from "./ipc";
import { initLobby, ensureClockForAll } from "./lobby";
import { refreshRoomViews, setUiRegistry } from "./ui";
import { initCommands } from "./commands";
import { broadcastPartyMode, loadPartyMode } from "./party";

const POLL_INTERVAL_TICKS = 40; // 2 秒

let registry: GameRegistry | undefined;
initCommands(() => registry);

world.afterEvents.worldLoad.subscribe(() => {
  loadPartyMode();
  // 等游戏包加载后广播一次当前派对状态,并请求一次重注册
  // (兜底"游戏包 game.register 早于 Core 订阅而丢失"的极端情况)
  system.runTimeout(() => {
    broadcastPartyMode();
    requestGameRegistration();
  }, 40);
  const coreRegistry = new GameRegistry();
  registry = coreRegistry;
  setUiRegistry(coreRegistry);
  initIpc(coreRegistry);
  initLobby(coreRegistry);

  system.runInterval(() => {
    coreRegistry.tick(system.currentTick);
    refreshRoomViews();
  }, POLL_INTERVAL_TICKS);

  ensureClockForAll();
  console.warn("[Bearcade Core] 已加载:大厅、DDUI 菜单、入房校验就绪");
});
