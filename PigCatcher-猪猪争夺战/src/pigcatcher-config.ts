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
  GAME_ID,
  PIG_CONFIG_DEFAULTS,
  TEAMS,
  TEAM_NAMES,
  type PigConfig,
  type Team,
} from "./config";

let cfg: PigConfig = { ...PIG_CONFIG_DEFAULTS };

export function getPigConfig(): PigConfig {
  return cfg;
}

export function loadPigConfig(): void {
  cfg = loadGameConfig(GAME_ID, PIG_CONFIG_DEFAULTS);
}

function persist(): void {
  saveGameConfig(GAME_ID, { ...cfg });
}

function backTo(player: Player, runtime: MinigameRuntime): () => void {
  return () => openPigConfig(player, runtime);
}

export function openPigConfig(
  player: Player,
  runtime: MinigameRuntime,
): void {
  if (runtime.hasActiveGame()) {
    player.sendMessage("§c当前有对局进行中,禁止修改配置");
    return;
  }
  const entries: { label: string; open: () => void }[] = [
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
      label: "猪猪刷新点",
      open: () =>
        openVec3Editor(
          player,
          "猪猪刷新点(场地中心)",
          cfg.pigSpawn,
          (value) => {
            cfg.pigSpawn = value;
            persist();
          },
          backTo(player, runtime),
        ),
    },
    {
      label: "开局初始猪数",
      open: () =>
        openIntEditor(
          player,
          "开局初始猪数(无上限)",
          cfg.pigInitialCount,
          (value) => {
            cfg.pigInitialCount = value;
            persist();
          },
          { min: 0, max: 20, back: backTo(player, runtime) },
        ),
    },
    {
      label: "每次刷新数量",
      open: () =>
        openIntEditor(
          player,
          "每次刷新补充的猪数(无上限)",
          cfg.pigSpawnBatch,
          (value) => {
            cfg.pigSpawnBatch = value;
            persist();
          },
          { min: 1, max: 10, back: backTo(player, runtime) },
        ),
    },
    {
      label: "猪猪刷新间隔(秒)",
      open: () =>
        openIntEditor(
          player,
          "猪猪刷新间隔(秒)",
          Math.round(cfg.pigRespawnIntervalTicks / 20),
          (value) => {
            cfg.pigRespawnIntervalTicks = value * 20;
            persist();
          },
          { min: 5, max: 120, back: backTo(player, runtime) },
        ),
    },
    {
      label: "游戏时长(秒)",
      open: () =>
        openIntEditor(
          player,
          "游戏时长(秒)",
          Math.round(cfg.gameDurationTicks / 20),
          (value) => {
            cfg.gameDurationTicks = value * 20;
            persist();
          },
          { min: 60, max: 3600, back: backTo(player, runtime) },
        ),
    },
    {
      label: "核心区吸引半径(格)",
      open: () =>
        openIntEditor(
          player,
          "核心区吸引半径(格)",
          cfg.lureRadius,
          (value) => {
            cfg.lureRadius = value;
            persist();
          },
          { min: 1, max: 16, back: backTo(player, runtime) },
        ),
    },
    {
      label: "核心区吸引强度(1-100)",
      open: () =>
        openIntEditor(
          player,
          "核心区吸引强度(1-100,默认15)",
          Math.round(cfg.lureStrength * 100),
          (value) => {
            cfg.lureStrength = value / 100;
            persist();
          },
          {
            min: 1,
            max: 100,
            hint: "数值越大拉得越狠,过大会让偷猪变难",
            back: backTo(player, runtime),
          },
        ),
    },
  ];

  for (const team of TEAMS) {
    const t = team as Team;
    entries.push({
      label: `${TEAM_NAMES[t]}出生点`,
      open: () =>
        openVec3Editor(
          player,
          `${TEAM_NAMES[t]}出生点`,
          cfg.teamSpawns[t],
          (value) => {
            cfg.teamSpawns[t] = value;
            persist();
          },
          backTo(player, runtime),
        ),
    });
  }
  for (const team of TEAMS) {
    const t = team as Team;
    entries.push({
      label: `${TEAM_NAMES[t]}核心区`,
      open: () =>
        openRegionEditor(
          player,
          `${TEAM_NAMES[t]}核心区`,
          cfg.cores[t],
          (value) => {
            cfg.cores[t] = value;
            persist();
          },
          backTo(player, runtime),
        ),
    });
  }

  entries.push({
    label: "恢复默认",
    open: () =>
      openConfigMenu(player, "确认恢复默认", [
        {
          label: "确认",
          open: () => {
            cfg = { ...PIG_CONFIG_DEFAULTS };
            persist();
            runtime.config.prepSpawn = cfg.prepSpawn;
            runtime.resendRegister();
            player.sendMessage("§a已恢复默认");
          },
        },
      ]),
  });

  openConfigMenu(player, "猪猪争夺战 · 配置", entries);
}
