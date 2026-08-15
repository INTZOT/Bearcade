import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import {
  clearHudTitle,
  hudMessage,
  setHudTitle,
} from "../../shared/minigame-core/scoreboardHud";
import { START_POSITIONS } from "./config";

export function makeTemplateHooks(
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
      for (const roomPlayer of players) {
        setHudTitle(
          roomPlayer,
          hudMessage([
            { text: "§e对局进行中§r" },
            { text: "\n" },
            { text: "在这里实现你的玩法 HUD" },
          ]),
          6000,
        );
      }
      // TODO: 玩法初始化(发道具/初始化棋盘/计分等)
    },
    onBeforeReset(roomId) {
      const runtime = getRuntime();
      for (const player of runtime.roomPlayers(roomId)) {
        clearHudTitle(player);
      }
    },
  };
}
