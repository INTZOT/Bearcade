import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import {
  clearHudTitle,
} from "../../shared/minigame-core/scoreboardHud";
import { START_POSITIONS } from "./config";
import { system } from "@minecraft/server";
import { GameManager } from "./GameManager";
import { GlobalDataCache } from "./GlobalDataCache";

let intervalID: number;
const gameManager = GameManager.getInstance();

export function makeCTFHooks(
  getRuntime: () => MinigameRuntime,
): MinigameHooks {
  return {
    onGameStart(roomId, players) {
      const runtime = getRuntime();
      players.forEach((player, index) => {
        // Teleport player to start position
        runtime.teleportPlayer(
          roomId,
          player,
          START_POSITIONS[index] ?? START_POSITIONS[0],
        );

        GlobalDataCache.getInstance().onPlayerJoin(player);
      });
      runtime.announce(roomId, "§a对局开始!");

      gameManager.start(runtime, roomId);

      intervalID = system.runInterval(() => {
        gameManager.tick();
      }, 2)
    },

    canPlace() { return true; },
    canBreak() { return true; },

    onBeforeReset(roomId) {
      if (intervalID !== null) system.clearRun(intervalID);
      gameManager.end();

      const runtime = getRuntime();
      for (const player of runtime.roomPlayers(roomId)) {
        clearHudTitle(player);
      }
    },
  };
}
