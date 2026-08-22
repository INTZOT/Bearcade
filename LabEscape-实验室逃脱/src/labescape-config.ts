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
  LABESCAPE_CONFIG_DEFAULTS,
  type LabEscapeConfig,
} from "./config";

/** 几何参数修改后必须重建模板地图并重新应用,否则对局坐标与地图错位 */
const GEOMETRY_CHANGED_HINT =
  "§e注意:地图几何参数已修改,请重新生成模板地图(/labescape:build <数量>)并应用(/bearcade:tmp ap labescape),否则对局坐标与地图可能不一致";

let cfg: LabEscapeConfig = { ...LABESCAPE_CONFIG_DEFAULTS };

export function getLabEscapeConfig(): LabEscapeConfig {
  return cfg;
}

export function loadLabEscapeConfig(): void {
  cfg = loadGameConfig(GAME_ID, LABESCAPE_CONFIG_DEFAULTS);
}

function persist(): void {
  saveGameConfig(GAME_ID, { ...cfg });
}

function backTo(player: Player, runtime: MinigameRuntime): () => void {
  return () => openLabEscapeConfig(player, runtime);
}

export function openLabEscapeConfig(
  player: Player,
  runtime: MinigameRuntime,
): void {
  if (runtime.hasActiveGame()) {
    player.sendMessage("§c当前有对局进行中,禁止修改配置");
    return;
  }
  openConfigMenu(player, "实验室逃脱 · 配置", [
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
      label: "普通模式最大人数",
      open: () =>
        openIntEditor(
          player,
          "普通模式最大人数",
          cfg.maxPlayers,
          (value) => {
            cfg.maxPlayers = value;
            persist();
            runtime.config.maxPlayers = value;
            runtime.resendRegister();
          },
          { min: 2, max: 40, hint: "Core 普通入房上限", back: backTo(player, runtime) },
        ),
    },
    {
      label: "派对模式最大人数",
      open: () =>
        openIntEditor(
          player,
          "派对模式最大人数",
          cfg.partyMaxPlayers,
          (value) => {
            cfg.partyMaxPlayers = value;
            persist();
          },
          { min: 2, max: 40, hint: "派对模式实际参赛人数上限,超出玩家转为观众", back: backTo(player, runtime) },
        ),
    },
    {
      label: "地面 Y",
      open: () =>
        openIntEditor(
          player,
          "地面 Y",
          cfg.groundY,
          (value) => {
            cfg.groundY = value;
            persist();
            player.sendMessage(GEOMETRY_CHANGED_HINT);
          },
          { min: -60, max: 300, hint: "地面表面 Y;地面方块在 Y-1", back: backTo(player, runtime) },
        ),
    },
    {
      label: "柱子高度",
      open: () =>
        openIntEditor(
          player,
          "柱子高度",
          cfg.columnHeight,
          (value) => {
            cfg.columnHeight = value;
            persist();
            player.sendMessage(GEOMETRY_CHANGED_HINT);
          },
          { min: 5, max: 100, hint: "柱子方块数量", back: backTo(player, runtime) },
        ),
    },
    {
      label: "玻璃底部开口高度",
      open: () =>
        openIntEditor(
          player,
          "玻璃底部开口高度",
          cfg.glassBottomOpenHeight,
          (value) => {
            cfg.glassBottomOpenHeight = value;
            persist();
            player.sendMessage(GEOMETRY_CHANGED_HINT);
          },
          { min: 1, max: 10, hint: "玻璃从地面往上第几格开始围起", back: backTo(player, runtime) },
        ),
    },
    {
      label: "中央塌陷区半径",
      open: () =>
        openIntEditor(
          player,
          "中央塌陷区半径",
          cfg.centerPitRadius,
          (value) => {
            cfg.centerPitRadius = value;
            persist();
            player.sendMessage(GEOMETRY_CHANGED_HINT);
          },
          { min: 1, max: 20, hint: "中央圆形坑半径", back: backTo(player, runtime) },
        ),
    },
    {
      label: "中央塌陷区深度",
      open: () =>
        openIntEditor(
          player,
          "中央塌陷区深度",
          cfg.centerPitDepth,
          (value) => {
            cfg.centerPitDepth = value;
            persist();
            player.sendMessage(GEOMETRY_CHANGED_HINT);
          },
          { min: 1, max: 64, hint: "坑向下挖多少格", back: backTo(player, runtime) },
        ),
    },
    {
      label: "完成判定深度",
      open: () =>
        openIntEditor(
          player,
          "完成判定深度",
          cfg.centerEnterDepth,
          (value) => {
            cfg.centerEnterDepth = value;
            persist();
            player.sendMessage(GEOMETRY_CHANGED_HINT);
          },
          { min: 1, max: 64, hint: "玩家低于地面该深度即判定完成", back: backTo(player, runtime) },
        ),
    },
    {
      label: "最小环半径",
      open: () =>
        openIntEditor(
          player,
          "最小环半径",
          cfg.minRingRadius,
          (value) => {
            cfg.minRingRadius = value;
            persist();
            player.sendMessage(GEOMETRY_CHANGED_HINT);
          },
          { min: 8, max: 60, hint: "自动计算圆环半径时的下限", back: backTo(player, runtime) },
        ),
    },
    {
      label: "柱间距",
      open: () =>
        openIntEditor(
          player,
          "柱间距",
          cfg.columnSpacing,
          (value) => {
            cfg.columnSpacing = value;
            persist();
            player.sendMessage(GEOMETRY_CHANGED_HINT);
          },
          { min: 3, max: 10, hint: "相邻柱子中心沿圆弧的间隔", back: backTo(player, runtime) },
        ),
    },
    {
      label: "环半径覆盖(0=自动)",
      open: () =>
        openIntEditor(
          player,
          "环半径覆盖(0=自动)",
          cfg.ringRadiusOverride,
          (value) => {
            cfg.ringRadiusOverride = value;
            persist();
            player.sendMessage(GEOMETRY_CHANGED_HINT);
          },
          { min: 0, max: 60, hint: "0 表示按柱子数量自动计算", back: backTo(player, runtime) },
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
          { min: 10, max: 600, hint: "第一名到达前的总倒计时", back: backTo(player, runtime) },
        ),
    },
    {
      label: "第一名后倒计时(秒)",
      open: () =>
        openIntEditor(
          player,
          "第一名后倒计时(秒)",
          cfg.finalDurationSeconds,
          (value) => {
            cfg.finalDurationSeconds = value;
            persist();
          },
          { min: 3, max: 120, hint: "第一名到达后留给其他玩家的时间", back: backTo(player, runtime) },
        ),
    },
    {
      label: "派对最大柱子数",
      open: () =>
        openIntEditor(
          player,
          "派对最大柱子数",
          cfg.maxPartyColumns,
          (value) => {
            cfg.maxPartyColumns = value;
            persist();
            player.sendMessage(GEOMETRY_CHANGED_HINT);
          },
          { min: 2, max: 40, hint: "/labescape:build 允许生成的最大柱子数量", back: backTo(player, runtime) },
        ),
    },
    {
      label: "恢复默认",
      open: () =>
        openConfigMenu(player, "确认恢复默认", [
          {
            label: "确认",
            open: () => {
              cfg = { ...LABESCAPE_CONFIG_DEFAULTS };
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
