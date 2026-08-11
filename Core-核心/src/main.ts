import { world, system } from "@minecraft/server";
import { GameRegistry } from "./registry";
import { initIpc } from "./ipc";
import { initLobby, ensureClockForAll } from "./lobby";
import { refreshRoomViews, setUiRegistry } from "./ui";
import { initCommands } from "./commands";

const POLL_INTERVAL_TICKS = 40; // 2 秒

initCommands();

world.afterEvents.worldLoad.subscribe(() => {
  const registry = new GameRegistry();
  setUiRegistry(registry);
  initIpc(registry);
  initLobby(registry);

  system.runInterval(() => {
    registry.tick(Date.now());
    refreshRoomViews();
  }, POLL_INTERVAL_TICKS);

  ensureClockForAll();
  console.warn("[Bearcade Core] 已加载:大厅、DDUI 菜单、入房校验就绪");
});
