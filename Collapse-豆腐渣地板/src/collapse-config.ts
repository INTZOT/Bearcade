// ============================================================
// Collapse(豆腐渣地板)运行时配置(/bearcade:config collapse)
// 可配置:准备房间坐标、场地中心、顶层地板 Y、场地大小、
// PVP 开启延迟、塌陷阶段时长、虚空淘汰高度;恢复默认。
// ============================================================
import { type Player } from "@minecraft/server";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import {
  loadGameConfig,
  saveGameConfig,
} from "../../shared/minigame-core/configStore";
import {
  openConfigMenu,
  openIntEditor,
  openVec3Editor,
} from "../../shared/minigame-core/configUi";
import {
  COLLAPSE_CONFIG_DEFAULTS,
  GAME_ID,
  type CollapseConfig,
} from "./config";

let cfg: CollapseConfig = { ...COLLAPSE_CONFIG_DEFAULTS };

export function getCollapseConfig(): CollapseConfig {
  return cfg;
}

export function loadCollapseConfig(): void {
  cfg = loadGameConfig(GAME_ID, COLLAPSE_CONFIG_DEFAULTS);
}

function persist(): void {
  saveGameConfig(GAME_ID, { ...cfg });
}

function backTo(player: Player, runtime: MinigameRuntime): () => void {
  return () => openCollapseConfig(player, runtime);
}

export function openCollapseConfig(
  player: Player,
  runtime: MinigameRuntime,
): void {
  if (runtime.hasActiveGame()) {
    player.sendMessage("§c当前有对局进行中,禁止修改配置");
    return;
  }
  openConfigMenu(player, "豆腐渣地板 · 配置", [
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
      label: "场地中心",
      open: () =>
        openVec3Editor(
          player,
          "场地中心(x/z 生效)",
          cfg.arenaCenter,
          (value) => {
            cfg.arenaCenter = value;
            persist();
          },
          backTo(player, runtime),
        ),
    },
    {
      label: "顶层地板 Y",
      open: () =>
        openIntEditor(
          player,
          "顶层地板 Y",
          cfg.topY,
          (value) => {
            cfg.topY = value;
            persist();
          },
          {
            min: -64,
            max: 320,
            hint: "出生点与场地塌陷检测的顶层基准",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "场地大小",
      open: () =>
        openIntEditor(
          player,
          "场地大小(单层宽/深)",
          cfg.arenaSize,
          (value) => {
            cfg.arenaSize = value;
            persist();
          },
          {
            min: 3,
            max: 63,
            hint: "单层白色混凝土地板边长,奇数为宜",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "PVP 开启延迟(秒)",
      open: () =>
        openIntEditor(
          player,
          "PVP 开启延迟(秒)",
          cfg.pvpDelaySeconds,
          (value) => {
            cfg.pvpDelaySeconds = value;
            persist();
          },
          {
            min: 10,
            max: 300,
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "塌陷阶段时长(秒)",
      open: () =>
        openIntEditor(
          player,
          "塌陷阶段时长(秒)",
          cfg.stageSeconds,
          (value) => {
            cfg.stageSeconds = value;
            persist();
          },
          {
            min: 1,
            max: 10,
            hint: "黄→橙→红 各持续该秒数,之后消失",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "虚空淘汰高度",
      open: () =>
        openIntEditor(
          player,
          "虚空淘汰高度",
          cfg.voidY,
          (value) => {
            cfg.voidY = value;
            persist();
          },
          {
            min: -64,
            max: 64,
            hint: "掉到该 y 以下即淘汰",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "观战玩家位置",
      open: () =>
        openVec3Editor(
          player,
          "观战玩家位置",
          cfg.spectateSpot,
          (value) => {
            cfg.spectateSpot = value;
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
              cfg = { ...COLLAPSE_CONFIG_DEFAULTS };
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
