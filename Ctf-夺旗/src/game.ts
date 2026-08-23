import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import {
  clearHudTitle,
} from "../../shared/minigame-core/scoreboardHud";
import { START_POSITIONS } from "./config";
import { system } from "@minecraft/server";
import { GameManager } from "./GameManager";

let intervalID: number;
const gameManager = GameManager.getInstance();

export function makeCTFHooks(
  getRuntime: () => MinigameRuntime,
): MinigameHooks {
  return {
    onGameStart(roomId, players) {
      const runtime = getRuntime();
      players.forEach((player, index) => {
        runtime.teleportPlayer(
          roomId,
          player,
          START_POSITIONS[index] ?? START_POSITIONS[0],
        );
      });
      runtime.announce(roomId, "§a对局开始!在这里实现你的玩法");



      gameManager.initialize(runtime, roomId);
      gameManager.start();

      intervalID = system.runInterval(() => {
        gameManager.tick();
      }, 2)
    },
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
