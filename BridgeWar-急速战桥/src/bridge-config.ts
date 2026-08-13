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
import { clearLoadout, saveLoadout } from "./loadout";
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
      label: "地图边界",
      open: () =>
        openRegionEditor(
          player,
          "地图边界",
          cfg.mapBoundary,
          (value) => {
            cfg.mapBoundary = value;
            persist();
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
      label: "红方装备配置",
      open: () =>
        openConfigMenu(player, "红方装备配置", [
          {
            label: "保存当前玩家装备为红方装备",
            open: () => {
              const ok = saveLoadout("red", player);
              player.sendMessage(ok ? "§a已保存红方装备" : "§c保存失败(装备仓库未就绪)");
            },
          },
          {
            label: "清空红方装备",
            open: () => {
              clearLoadout("red");
              player.sendMessage("§a已清空红方装备");
            },
          },
        ]),
    },
    {
      label: "蓝方装备配置",
      open: () =>
        openConfigMenu(player, "蓝方装备配置", [
          {
            label: "保存当前玩家装备为蓝方装备",
            open: () => {
              const ok = saveLoadout("blue", player);
              player.sendMessage(ok ? "§a已保存蓝方装备" : "§c保存失败(装备仓库未就绪)");
            },
          },
          {
            label: "清空蓝方装备",
            open: () => {
              clearLoadout("blue");
              player.sendMessage("§a已清空蓝方装备");
            },
          },
        ]),
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
