// ============================================================
// HungerGame(饥饿游戏)玩法实现
// 骨架阶段:仅注册房间/模板与空钩子,玩法流程待定。
// ============================================================
import { GameMode } from "@minecraft/server";
import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { openHungerGameConfig } from "./game-config";

// 待定:对局状态(存活玩家、道具、区域等)在玩法设计后补充

export function makeHungerGameHooks(
  getRuntime: () => MinigameRuntime,
): MinigameHooks {
  return {
    onGameStart(roomId, players) {
      const runtime = getRuntime();
      players.forEach((player) => {
        player.setGameMode(GameMode.Survival);
      });
      runtime.announce(
        roomId,
        `§a饥饿游戏开始!${players.map((p) => p.name).join("、")}`,
      );
      // 待定:出生点传送、倒计时、装备发放、道具生成等
    },
    onBeforeReset(roomId) {
      const runtime = getRuntime();
      for (const player of runtime.roomPlayers(roomId)) {
        if (player !== undefined) {
          try {
            player.setGameMode(GameMode.Adventure);
          } catch {
            // 忽略
          }
        }
      }
      // 待定:清理对局遗留(方块改动、道具、实体等)
    },
    openConfig(player) {
      openHungerGameConfig(player, getRuntime());
    },
  };
}
