// ============================================================
// 杀年猪运行时配置(/bearcade:config newyearpig)
// 可配置:准备房间坐标、地图、动物生成、计分、受惊逃跑、特殊事件等;恢复默认。
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
  GAME_ID,
  NEW_YEAR_PIG_CONFIG_DEFAULTS,
  type NewYearPigConfig,
} from "./config";

let cfg: NewYearPigConfig = { ...NEW_YEAR_PIG_CONFIG_DEFAULTS };

export function getNewYearPigConfig(): NewYearPigConfig {
  return cfg;
}

export function loadNewYearPigConfig(): void {
  cfg = loadGameConfig(GAME_ID, NEW_YEAR_PIG_CONFIG_DEFAULTS);
}

function persist(): void {
  saveGameConfig(GAME_ID, { ...cfg });
}

function backTo(player: Player, runtime: MinigameRuntime): () => void {
  return () => openNewYearPigConfig(player, runtime);
}

export function openNewYearPigConfig(
  player: Player,
  runtime: MinigameRuntime,
): void {
  if (runtime.hasActiveGame()) {
    player.sendMessage("§c当前有对局进行中,禁止修改配置");
    return;
  }

  openConfigMenu(player, "杀年猪 · 配置", [
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
      label: "地图原点(草方块地皮一角)",
      open: () =>
        openVec3Editor(
          player,
          "地图原点",
          cfg.mapOrigin,
          (value) => {
            cfg.mapOrigin = value;
            persist();
          },
          backTo(player, runtime),
        ),
    },
    {
      label: "地图边长",
      open: () =>
        openIntEditor(
          player,
          "地图边长(格)",
          cfg.mapSize,
          (value) => {
            cfg.mapSize = value;
            persist();
          },
          {
            min: 8,
            max: 64,
            hint: "草方块地皮边长,默认 32;需与模板范围匹配",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "一局时长(秒)",
      open: () =>
        openIntEditor(
          player,
          "一局时长(秒)",
          cfg.gameDurationSeconds,
          (value) => {
            cfg.gameDurationSeconds = value;
            persist();
          },
          { min: 10, max: 600, back: backTo(player, runtime) },
        ),
    },
    {
      label: "开局动物数量",
      open: () =>
        openIntEditor(
          player,
          "开局动物数量",
          cfg.initialSpawnCount,
          (value) => {
            cfg.initialSpawnCount = value;
            persist();
          },
          { min: 0, max: 100, back: backTo(player, runtime) },
        ),
    },
    {
      label: "生成间隔(秒)",
      open: () =>
        openIntEditor(
          player,
          "生成间隔(秒)",
          cfg.spawnIntervalSeconds,
          (value) => {
            cfg.spawnIntervalSeconds = value;
            persist();
          },
          { min: 1, max: 30, back: backTo(player, runtime) },
        ),
    },
    {
      label: "每批基础生成数",
      open: () =>
        openIntEditor(
          player,
          "每批基础生成数",
          cfg.spawnBatchBase,
          (value) => {
            cfg.spawnBatchBase = value;
            persist();
          },
          { min: 0, max: 20, back: backTo(player, runtime) },
        ),
    },
    {
      label: "人数加成(每 N 人 +1 只/批)",
      open: () =>
        openIntEditor(
          player,
          "人数加成(每 N 人 +1 只/批)",
          cfg.playersPerExtraSpawn,
          (value) => {
            cfg.playersPerExtraSpawn = value;
            persist();
          },
          {
            min: 0,
            max: 16,
            hint: "0 表示不按人数加成",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "场上动物上限",
      open: () =>
        openIntEditor(
          player,
          "场上动物上限",
          cfg.maxAnimals,
          (value) => {
            cfg.maxAnimals = value;
            persist();
          },
          { min: 1, max: 200, back: backTo(player, runtime) },
        ),
    },
    {
      label: "-50% 动物概率(%)",
      open: () =>
        openIntEditor(
          player,
          "-50% 动物概率(%)",
          cfg.cursedChancePercent,
          (value) => {
            cfg.cursedChancePercent = value;
            persist();
          },
          { min: 0, max: 100, back: backTo(player, runtime) },
        ),
    },
    {
      label: "受惊逃跑秒数(0=一直跑)",
      open: () =>
        openIntEditor(
          player,
          "受惊逃跑秒数",
          cfg.fleeSeconds,
          (value) => {
            cfg.fleeSeconds = value;
            persist();
          },
          {
            min: 0,
            max: 600,
            hint: "0 = 一直逃跑;默认 15 秒后恢复正常",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "受惊冲量强度(%)",
      open: () =>
        openIntEditor(
          player,
          "受惊冲量强度(%)",
          Math.round(cfg.panicStrength * 100),
          (value) => {
            cfg.panicStrength = value / 100;
            persist();
          },
          {
            min: 0,
            max: 200,
            hint: "数值越大跑得越快/越远,默认 35",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "动物分值(鸡/猪/羊)",
      open: () =>
        openConfigMenu(player, "动物分值", [
          {
            label: "鸡 +1",
            open: () =>
              openIntEditor(
                player,
                "鸡分值",
                cfg.chickenPoints,
                (value) => {
                  cfg.chickenPoints = value;
                  persist();
                },
                { min: 1, max: 100, back: backTo(player, runtime) },
              ),
          },
          {
            label: "猪 +3",
            open: () =>
              openIntEditor(
                player,
                "猪分值",
                cfg.pigPoints,
                (value) => {
                  cfg.pigPoints = value;
                  persist();
                },
                { min: 1, max: 100, back: backTo(player, runtime) },
              ),
          },
          {
            label: "羊 +5",
            open: () =>
              openIntEditor(
                player,
                "羊分值",
                cfg.sheepPoints,
                (value) => {
                  cfg.sheepPoints = value;
                  persist();
                },
                { min: 1, max: 100, back: backTo(player, runtime) },
              ),
          },
        ]),
    },
    {
      label: "生成权重(鸡/猪/羊)",
      open: () =>
        openConfigMenu(player, "生成权重", [
          {
            label: "鸡权重",
            open: () =>
              openIntEditor(
                player,
                "鸡权重",
                cfg.chickenWeight,
                (value) => {
                  cfg.chickenWeight = value;
                  persist();
                },
                { min: 1, max: 100, back: backTo(player, runtime) },
              ),
          },
          {
            label: "猪权重",
            open: () =>
              openIntEditor(
                player,
                "猪权重",
                cfg.pigWeight,
                (value) => {
                  cfg.pigWeight = value;
                  persist();
                },
                { min: 1, max: 100, back: backTo(player, runtime) },
              ),
          },
          {
            label: "羊权重",
            open: () =>
              openIntEditor(
                player,
                "羊权重",
                cfg.sheepWeight,
                (value) => {
                  cfg.sheepWeight = value;
                  persist();
                },
                { min: 1, max: 100, back: backTo(player, runtime) },
              ),
          },
        ]),
    },
    {
      label: "特殊事件",
      open: () =>
        openConfigMenu(player, "特殊事件", [
          {
            label: "钻石剑实际剩余耐久",
            open: () =>
              openIntEditor(
                player,
                "钻石剑实际剩余耐久",
                cfg.diamondSwordDurabilityLeft,
                (value) => {
                  cfg.diamondSwordDurabilityLeft = value;
                  persist();
                },
                { min: 1, max: 100, back: backTo(player, runtime) },
              ),
          },
          {
            label: "钻石剑公告播报耐久",
            open: () =>
              openIntEditor(
                player,
                "钻石剑公告播报耐久",
                cfg.diamondSwordAnnounceDurability,
                (value) => {
                  cfg.diamondSwordAnnounceDurability = value;
                  persist();
                },
                { min: 1, max: 100, back: backTo(player, runtime) },
              ),
          },
          {
            label: "牛来血量",
            open: () =>
              openIntEditor(
                player,
                "牛来血量",
                cfg.specialCowHealth,
                (value) => {
                  cfg.specialCowHealth = value;
                  persist();
                },
                { min: 1, max: 200, back: backTo(player, runtime) },
              ),
          },
          {
            label: "牛来分值",
            open: () =>
              openIntEditor(
                player,
                "牛来分值",
                cfg.specialCowPoints,
                (value) => {
                  cfg.specialCowPoints = value;
                  persist();
                },
                { min: 1, max: 100, back: backTo(player, runtime) },
              ),
          },
          {
            label: "牛来速度等级",
            open: () =>
              openIntEditor(
                player,
                "牛来速度等级(amplifier)",
                cfg.specialCowSpeedAmplifier,
                (value) => {
                  cfg.specialCowSpeedAmplifier = value;
                  persist();
                },
                { min: 0, max: 10, back: backTo(player, runtime) },
              ),
          },
          {
            label: "第一波钻石剑剩余秒数下限",
            open: () =>
              openIntEditor(
                player,
                "第一波钻石剑剩余秒数下限",
                cfg.swordSpawnFirstMinRemaining,
                (value) => {
                  cfg.swordSpawnFirstMinRemaining = value;
                  persist();
                },
                { min: 0, max: 600, back: backTo(player, runtime) },
              ),
          },
          {
            label: "第一波钻石剑剩余秒数上限",
            open: () =>
              openIntEditor(
                player,
                "第一波钻石剑剩余秒数上限",
                cfg.swordSpawnFirstMaxRemaining,
                (value) => {
                  cfg.swordSpawnFirstMaxRemaining = value;
                  persist();
                },
                { min: 0, max: 600, back: backTo(player, runtime) },
              ),
          },
          {
            label: "第二波钻石剑剩余秒数下限",
            open: () =>
              openIntEditor(
                player,
                "第二波钻石剑剩余秒数下限",
                cfg.swordSpawnSecondMinRemaining,
                (value) => {
                  cfg.swordSpawnSecondMinRemaining = value;
                  persist();
                },
                { min: 0, max: 600, back: backTo(player, runtime) },
              ),
          },
          {
            label: "第二波钻石剑剩余秒数上限",
            open: () =>
              openIntEditor(
                player,
                "第二波钻石剑剩余秒数上限",
                cfg.swordSpawnSecondMaxRemaining,
                (value) => {
                  cfg.swordSpawnSecondMaxRemaining = value;
                  persist();
                },
                { min: 0, max: 600, back: backTo(player, runtime) },
              ),
          },
          {
            label: "牛来刷新剩余秒数下限",
            open: () =>
              openIntEditor(
                player,
                "牛来刷新剩余秒数下限",
                cfg.specialCowMinRemaining,
                (value) => {
                  cfg.specialCowMinRemaining = value;
                  persist();
                },
                { min: 0, max: 600, back: backTo(player, runtime) },
              ),
          },
          {
            label: "牛来刷新剩余秒数上限",
            open: () =>
              openIntEditor(
                player,
                "牛来刷新剩余秒数上限",
                cfg.specialCowMaxRemaining,
                (value) => {
                  cfg.specialCowMaxRemaining = value;
                  persist();
                },
                { min: 0, max: 600, back: backTo(player, runtime) },
              ),
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
              cfg = { ...NEW_YEAR_PIG_CONFIG_DEFAULTS };
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
