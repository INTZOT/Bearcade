import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";

export function makeGameHooks(
  getRuntime: () => MinigameRuntime,
): MinigameHooks {
  return {
    onGameStart(roomId, players) {
      const runtime = getRuntime();
      runtime.announce(
        roomId,
        `§a对局开始!${players.length} 名玩家,战桥玩法待实现`,
      );
      // TODO: 分队伍、开局、核心区得分、回合轮换、胜负判定等玩法待确认后实现
    },
  };
}
