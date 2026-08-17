// ============================================================
// HungerGame(饥饿游戏)运行时配置(/bearcade:config hungergame)
// ============================================================
import { type Player } from "@minecraft/server";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import {
  loadGameConfig,
  saveGameConfig,
} from "../../shared/minigame-core/configStore";
import {
  openConfigMenu,
  openVec3Editor,
} from "../../shared/minigame-core/configUi";
import {
  GAME_ID,
  HUNGER_GAME_CONFIG_DEFAULTS,
  type HungerGameConfig,
} from "./config";

let cfg: HungerGameConfig = { ...HUNGER_GAME_CONFIG_DEFAULTS };

export function getHungerGameConfig(): HungerGameConfig {
  return cfg;
}

export function loadHungerGameConfig(): void {
  cfg = loadGameConfig(GAME_ID, HUNGER_GAME_CONFIG_DEFAULTS);
}

function persist(): void {
  saveGameConfig(GAME_ID, { ...cfg });
}

function backTo(player: Player, runtime: MinigameRuntime): () => void {
  return () => openHungerGameConfig(player, runtime);
}

export function openHungerGameConfig(
  player: Player,
  runtime: MinigameRuntime,
): void {
  if (runtime.hasActiveGame()) {
    player.sendMessage("§c当前有对局进行中,禁止修改配置");
    return;
  }
  openConfigMenu(player, "饥饿游戏 · 配置", [
    {
      label: "准备房间坐标",
      open: () =>
        openVec3Editor(
          player,
          "准备房间坐标",
          cfg.prepSpawn,
          (value) => {
            cfg.prepSpawn = value;
            persist();
            runtime.config.prepSpawn = value;
            runtime.resendRegister();
          },
          backTo(player, runtime),
        ),
    },
    {
      label: "恢复默认",
      open: () =>
        openConfigMenu(player, "确认恢复默认", [
          {
            label: "确认",
            open: () => {
              cfg = { ...HUNGER_GAME_CONFIG_DEFAULTS };
              persist();
              runtime.config.prepSpawn = cfg.prepSpawn;
              runtime.resendRegister();
              player.sendMessage("§a已恢复默认");
            },
          },
        ]),
    },
  ]);
}
