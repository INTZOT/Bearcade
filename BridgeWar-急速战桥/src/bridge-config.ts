import { type Player } from "@minecraft/server";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import {
  loadGameConfig,
  saveGameConfig,
} from "../../shared/minigame-core/configStore";
import {
  openConfigMenu,
  openIntEditor,
  openRegionEditor,
  openVec3Editor,
} from "../../shared/minigame-core/configUi";
import {
  BRIDGE_CONFIG_DEFAULTS,
  GAME_ID,
  type BridgeConfig,
} from "./config";

let cfg: BridgeConfig = { ...BRIDGE_CONFIG_DEFAULTS };

export function getBridgeConfig(): BridgeConfig {
  return cfg;
}

export function loadBridgeConfig(): void {
  cfg = loadGameConfig(GAME_ID, BRIDGE_CONFIG_DEFAULTS);
}

function persist(): void {
  saveGameConfig(GAME_ID, { ...cfg });
}

function backTo(player: Player, runtime: MinigameRuntime): () => void {
  return () => openBridgeConfig(player, runtime);
}

export function openBridgeConfig(
  player: Player,
  runtime: MinigameRuntime,
): void {
  openConfigMenu(player, "急速战桥 · 配置", [
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
      label: "红队出生点",
      open: () =>
        openVec3Editor(
          player,
          "红队出生点",
          cfg.redSpawn,
          (value) => {
            cfg.redSpawn = value;
            persist();
          },
          backTo(player, runtime),
        ),
    },
    {
      label: "蓝队出生点",
      open: () =>
        openVec3Editor(
          player,
          "蓝队出生点",
          cfg.blueSpawn,
          (value) => {
            cfg.blueSpawn = value;
            persist();
          },
          backTo(player, runtime),
        ),
    },
    {
      label: "红队核心区",
      open: () =>
        openRegionEditor(
          player,
          "红队核心区",
          cfg.redCore,
          (value) => {
            cfg.redCore = value;
            persist();
          },
          backTo(player, runtime),
        ),
    },
    {
      label: "蓝队核心区",
      open: () =>
        openRegionEditor(
          player,
          "蓝队核心区",
          cfg.blueCore,
          (value) => {
            cfg.blueCore = value;
            persist();
          },
          backTo(player, runtime),
        ),
    },
    {
      label: "获胜所需分数",
      open: () =>
        openIntEditor(
          player,
          "获胜所需分数",
          cfg.winScore,
          (value) => {
            cfg.winScore = value;
            persist();
          },
          { min: 1, max: 100, back: backTo(player, runtime) },
        ),
    },
    {
      label: "恢复默认",
      open: () =>
        openConfigMenu(player, "确认恢复默认", [
          {
            label: "确认",
            open: () => {
              cfg = { ...BRIDGE_CONFIG_DEFAULTS };
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
