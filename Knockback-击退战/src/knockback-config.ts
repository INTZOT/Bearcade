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
  GAME_ID,
  KNOCKBACK_CONFIG_DEFAULTS,
  type KnockbackConfig,
} from "./config";

let cfg: KnockbackConfig = { ...KNOCKBACK_CONFIG_DEFAULTS };

export function getKnockbackConfig(): KnockbackConfig {
  return cfg;
}

export function loadKnockbackConfig(): void {
  cfg = loadGameConfig(GAME_ID, KNOCKBACK_CONFIG_DEFAULTS);
}

function persist(): void {
  saveGameConfig(GAME_ID, { ...cfg });
}

function backTo(player: Player, runtime: MinigameRuntime): () => void {
  return () => openKnockbackConfig(player, runtime);
}

export function openKnockbackConfig(
  player: Player,
  runtime: MinigameRuntime,
): void {
  if (runtime.hasActiveGame()) {
    player.sendMessage("§c当前有对局进行中,禁止修改配置");
    return;
  }
  openConfigMenu(player, "击退战 · 配置", [
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
          "场地中心",
          cfg.arenaCenter,
          (value) => {
            cfg.arenaCenter = value;
            persist();
          },
          backTo(player, runtime),
        ),
    },
    {
      label: "普通得分区半径",
      open: () =>
        openIntEditor(
          player,
          "普通得分区半径",
          cfg.centerRadius,
          (value) => {
            cfg.centerRadius = value;
            persist();
          },
          { min: 1, max: 30, hint: "中央高台水平判定半径", back: backTo(player, runtime) },
        ),
    },
    {
      label: "1.5倍得分区半径",
      open: () =>
        openIntEditor(
          player,
          "1.5倍得分区半径",
          cfg.bonusRadius,
          (value) => {
            cfg.bonusRadius = value;
            persist();
          },
          { min: 1, max: 30, hint: "中央高台再高一格的小平台半径", back: backTo(player, runtime) },
        ),
    },
    {
      label: "外围半径",
      open: () =>
        openIntEditor(
          player,
          "外围半径",
          cfg.outerRadius,
          (value) => {
            cfg.outerRadius = value;
            persist();
          },
          { min: 1, max: 60, hint: "包含中央高台在内的整个竞技场半径", back: backTo(player, runtime) },
        ),
    },
    {
      label: "中央高台 Y",
      open: () =>
        openIntEditor(
          player,
          "中央高台 Y",
          cfg.centerFloorY,
          (value) => {
            cfg.centerFloorY = value;
            persist();
          },
          { min: -64, max: 318, hint: "中央高台方块所在 Y", back: backTo(player, runtime) },
        ),
    },
    {
      label: "外围地面 Y",
      open: () =>
        openIntEditor(
          player,
          "外围地面 Y",
          cfg.outerFloorY,
          (value) => {
            cfg.outerFloorY = value;
            persist();
          },
          { min: -64, max: 318, hint: "外围地面方块所在 Y", back: backTo(player, runtime) },
        ),
    },
    {
      label: "游戏时长(秒)",
      open: () =>
        openIntEditor(
          player,
          "游戏时长(秒)",
          cfg.gameDurationSeconds,
          (value) => {
            cfg.gameDurationSeconds = value;
            persist();
          },
          { min: 10, max: 600, hint: "单局时长", back: backTo(player, runtime) },
        ),
    },
    {
      label: "木棍刷新间隔(秒)",
      open: () =>
        openIntEditor(
          player,
          "木棍刷新间隔(秒)",
          cfg.stickRespawnSeconds,
          (value) => {
            cfg.stickRespawnSeconds = value;
            persist();
          },
          { min: 3, max: 120, hint: "中/强木棍补货间隔", back: backTo(player, runtime) },
        ),
    },
    {
      label: "中级木棍数量",
      open: () =>
        openIntEditor(
          player,
          "中级木棍数量",
          cfg.mediumSpawnCount,
          (value) => {
            cfg.mediumSpawnCount = value;
            persist();
          },
          { min: 0, max: 10, hint: "场上同时存在的中级木棍数量", back: backTo(player, runtime) },
        ),
    },
    {
      label: "强力木棍数量",
      open: () =>
        openIntEditor(
          player,
          "强力木棍数量",
          cfg.strongSpawnCount,
          (value) => {
            cfg.strongSpawnCount = value;
            persist();
          },
          { min: 0, max: 10, hint: "场上同时存在的强力木棍数量", back: backTo(player, runtime) },
        ),
    },
    {
      label: "恢复默认",
      open: () =>
        openConfigMenu(player, "确认恢复默认", [
          {
            label: "确认",
            open: () => {
              cfg = { ...KNOCKBACK_CONFIG_DEFAULTS };
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
