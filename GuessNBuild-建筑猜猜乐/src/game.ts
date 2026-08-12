import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { START_POSITIONS } from "./config";

export function makeGameHooks(
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
      runtime.announce(roomId, "§a对局开始!建筑猜猜乐玩法待实现");
      // TODO: 在这里实现玩法:发道具、出题/谜题、建筑验证、计分、胜负判定等。
      // 需要结束对局时调用 runtime.endGame(roomId, "胜负原因", "提示文案")。
    },
  };
}
