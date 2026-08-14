import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { START_POSITIONS } from "./config";

export function makeSnd5Hooks(
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
      // TODO: 玩法初始化(发道具/初始化棋盘/计分等)——玩法待定,先讨论再实现
    },
  };
}
