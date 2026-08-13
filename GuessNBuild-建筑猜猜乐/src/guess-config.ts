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
import { openQBankMain } from "./qbank";
import {
  GAME_ID,
  GUESS_CONFIG_DEFAULTS,
  type GuessConfig,
} from "./config";

let cfg: GuessConfig = { ...GUESS_CONFIG_DEFAULTS };

export function getGuessConfig(): GuessConfig {
  return cfg;
}

export function loadGuessConfig(): void {
  cfg = loadGameConfig(GAME_ID, GUESS_CONFIG_DEFAULTS);
}

function persist(): void {
  saveGameConfig(GAME_ID, { ...cfg });
}

function backTo(player: Player, runtime: MinigameRuntime): () => void {
  return () => openGuessConfig(player, runtime);
}

export function openGuessConfig(
  player: Player,
  runtime: MinigameRuntime,
): void {
  openConfigMenu(player, "建筑猜猜乐 · 配置", [
    {
      label: "题库管理",
      open: () => openQBankMain(player),
    },
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
      label: "每回合开局传送坐标",
      open: () =>
        openVec3Editor(
          player,
          "每回合开局传送坐标",
          cfg.roundSpawn,
          (value) => {
            cfg.roundSpawn = value;
            persist();
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
              cfg = { ...GUESS_CONFIG_DEFAULTS };
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
