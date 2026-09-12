// ============================================================
// 冰冻地板(FrozenFloor)运行时配置(/bearcade:config frozenfloor)
// 所有数值均可在游戏内调整并持久化,避免硬编码。
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
  FROZENFLOOR_CONFIG_DEFAULTS,
  GAME_ID,
  type FrozenFloorConfig,
} from "./config";

let cfg: FrozenFloorConfig = { ...FROZENFLOOR_CONFIG_DEFAULTS };

export function getFrozenFloorConfig(): FrozenFloorConfig {
  return cfg;
}

export function loadFrozenFloorConfig(): void {
  cfg = loadGameConfig(GAME_ID, FROZENFLOOR_CONFIG_DEFAULTS);
}

function persist(): void {
  saveGameConfig(GAME_ID, { ...cfg });
}

function backTo(player: Player, runtime: MinigameRuntime): () => void {
  return () => openFrozenFloorConfig(player, runtime);
}

export function openFrozenFloorConfig(
  player: Player,
  runtime: MinigameRuntime,
): void {
  if (runtime.hasActiveGame()) {
    player.sendMessage("§c当前有对局进行中,禁止修改配置");
    return;
  }
  openConfigMenu(player, "冰冻地板 · 配置", [
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
      label: "蓝冰环顶部 Y",
      open: () =>
        openIntEditor(
          player,
          "蓝冰环顶部 Y",
          cfg.ringY,
          (value) => {
            cfg.ringY = value;
            persist();
          },
          {
            min: -64,
            max: 320,
            hint: "蓝冰环方块所在 y,玩家站在 y+1",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "内圈半径",
      open: () =>
        openIntEditor(
          player,
          "内圈半径(中心空洞)",
          cfg.innerRadius,
          (value) => {
            cfg.innerRadius = value;
            persist();
          },
          {
            min: 1,
            max: 63,
            hint: "中心空洞半径,需小于外圈半径",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "外圈半径",
      open: () =>
        openIntEditor(
          player,
          "外圈半径",
          cfg.outerRadius,
          (value) => {
            cfg.outerRadius = value;
            persist();
          },
          {
            min: 2,
            max: 63,
            hint: "蓝冰环外半径,需大于内圈半径",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "融化间隔(秒)",
      open: () =>
        openIntEditor(
          player,
          "融化间隔(秒)",
          cfg.meltIntervalSeconds,
          (value) => {
            cfg.meltIntervalSeconds = value;
            persist();
          },
          {
            min: 5,
            max: 300,
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "融化动画时长(秒)",
      open: () =>
        openIntEditor(
          player,
          "融化动画时长(秒)",
          cfg.meltAnimationSeconds,
          (value) => {
            cfg.meltAnimationSeconds = value;
            persist();
          },
          {
            min: 1,
            max: 20,
            hint: "每轮融化期间逐块消失的持续时间",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "融化次数",
      open: () =>
        openIntEditor(
          player,
          "融化次数",
          cfg.meltTimes,
          (value) => {
            cfg.meltTimes = value;
            persist();
          },
          {
            min: 0,
            max: 20,
            hint: "总共收缩多少轮",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "外圈每轮收缩格数",
      open: () =>
        openIntEditor(
          player,
          "外圈每轮收缩格数",
          cfg.outerShrinkPerMelt,
          (value) => {
            cfg.outerShrinkPerMelt = value;
            persist();
          },
          {
            min: 0,
            max: 10,
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "内圈每轮扩张格数",
      open: () =>
        openIntEditor(
          player,
          "内圈每轮扩张格数",
          cfg.innerExpandPerMelt,
          (value) => {
            cfg.innerExpandPerMelt = value;
            persist();
          },
          {
            min: 0,
            max: 10,
            hint: "内圈向外扩大的格数,用于缩小环宽",
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
      label: "雪球水平击退强度",
      open: () =>
        openIntEditor(
          player,
          "雪球水平击退强度",
          Math.round(cfg.snowballKnockback * 10),
          (value) => {
            cfg.snowballKnockback = value / 10;
            persist();
          },
          {
            min: 0,
            max: 100,
            hint: "原版约为 1.0,这里以 0.1 为单位(10=1.0)",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "雪球垂直击退强度",
      open: () =>
        openIntEditor(
          player,
          "雪球垂直击退强度",
          Math.round(cfg.snowballVerticalKnockback * 10),
          (value) => {
            cfg.snowballVerticalKnockback = value / 10;
            persist();
          },
          {
            min: 0,
            max: 50,
            hint: "以 0.1 为单位(3=0.3)",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "每格雪球数量",
      open: () =>
        openIntEditor(
          player,
          "每格雪球数量",
          cfg.snowballStackSize,
          (value) => {
            cfg.snowballStackSize = value;
            persist();
          },
          {
            min: 1,
            max: 64,
            hint: "开局时每个快捷栏雪球叠放数量",
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
      label: "生成装饰(0/1)",
      open: () =>
        openIntEditor(
          player,
          "生成装饰(0=关,1=开)",
          cfg.generateDecorations ? 1 : 0,
          (value) => {
            cfg.generateDecorations = value === 1;
            persist();
          },
          {
            min: 0,
            max: 1,
            hint: "构建地图时是否生成参考旧图的装饰",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "恢复默认",
      open: () =>
        openConfigMenu(player, "确认恢复默认", [
          {
            label: "确认",
            open: () => {
              cfg = { ...FROZENFLOOR_CONFIG_DEFAULTS };
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
