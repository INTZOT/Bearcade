import { system, type Player } from "@minecraft/server";
import { CustomForm, ObservableString } from "@minecraft/server-ui";
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
  STUDIO_CONFIG_DEFAULTS,
  type StudioConfig,
} from "./config";

let cfg: StudioConfig = { ...STUDIO_CONFIG_DEFAULTS };

export function getStudioConfig(): StudioConfig {
  return cfg;
}

export function loadStudioConfig(): void {
  cfg = loadGameConfig(GAME_ID, STUDIO_CONFIG_DEFAULTS);
}

function persist(): void {
  saveGameConfig(GAME_ID, { ...cfg });
}

function backTo(player: Player, runtime: MinigameRuntime): () => void {
  return () => openStudioConfig(player, runtime);
}

function openStringListEditor(
  player: Player,
  title: string,
  current: string[],
  hint: string,
  onSave: (value: string[]) => void,
  back?: () => void,
): void {
  const input = new ObservableString(current.join(","), {
    clientWritable: true,
  });
  const form = new CustomForm(player, title);
  form.header(title);
  form.spacer();
  form.label(hint);
  form.spacer();
  form.textField("逗号分隔列表", input);
  form.spacer();
  form.button("保存", () => {
    const list = input
      .getData()
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    form.close();
    onSave(list);
    player.sendMessage("§a已保存");
  });
  form.button("返回", () => {
    form.close();
    if (back) system.runTimeout(back, 2);
  });
  form.show().catch((error) => console.warn("[Studio] 列表表单失败", error));
}

export function openStudioConfig(
  player: Player,
  runtime: MinigameRuntime,
): void {
  if (runtime.hasActiveGame()) {
    player.sendMessage("§c当前有对局进行中,禁止修改配置");
    return;
  }
  openConfigMenu(player, "工作室 · 配置", [
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
          {
            min: 2,
            max: 40,
            hint: "Core 普通入房上限;派对模式忽略此上限",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "总回合数",
      open: () =>
        openIntEditor(
          player,
          "总回合数",
          cfg.roundCount,
          (value) => {
            cfg.roundCount = value;
            persist();
          },
          {
            min: 1,
            max: 30,
            hint: "游戏进行的回合数",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "单回合超时(秒)",
      open: () =>
        openIntEditor(
          player,
          "单回合超时(秒)",
          cfg.roundTimeoutSeconds,
          (value) => {
            cfg.roundTimeoutSeconds = value;
            persist();
          },
          {
            min: 10,
            max: 600,
            hint: "无人完成时等待多少秒后强制进入下一回合",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "第一名后等待(秒)",
      open: () =>
        openIntEditor(
          player,
          "第一名后等待(秒)",
          cfg.afterFirstSuccessSeconds,
          (value) => {
            cfg.afterFirstSuccessSeconds = value;
            persist();
          },
          {
            min: 3,
            max: 120,
            hint: "第一名完成后留给其他玩家继续完成的时间",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "第一名得分",
      open: () =>
        openIntEditor(
          player,
          "第一名得分",
          cfg.scoreFirst,
          (value) => {
            cfg.scoreFirst = value;
            persist();
          },
          {
            min: 0,
            max: 100,
            hint: "本回合第一个完成者得分",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "第二名得分",
      open: () =>
        openIntEditor(
          player,
          "第二名得分",
          cfg.scoreSecond,
          (value) => {
            cfg.scoreSecond = value;
            persist();
          },
          {
            min: 0,
            max: 100,
            hint: "本回合第二个完成者得分",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "第三名得分",
      open: () =>
        openIntEditor(
          player,
          "第三名得分",
          cfg.scoreThird,
          (value) => {
            cfg.scoreThird = value;
            persist();
          },
          {
            min: 0,
            max: 100,
            hint: "本回合第三个完成者得分",
            back: backTo(player, runtime),
          },
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
          },
          {
            min: -60,
            max: 300,
            hint: "地面表面 Y;地面方块在 Y-1,/studio:build 使用",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "默认场地尺寸",
      open: () =>
        openIntEditor(
          player,
          "默认场地尺寸",
          cfg.defaultArenaSize,
          (value) => {
            cfg.defaultArenaSize = value;
            persist();
          },
          {
            min: 11,
            max: 41,
            hint: "/studio:build 不带参数时使用的边长(奇数)",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "题库管理(目标物品)",
      open: () =>
        openStringListEditor(
          player,
          "题库管理",
          cfg.targetItems,
          "输入目标物品 ID,用英文逗号分隔。例如:minecraft:furnace,minecraft:bed",
          (value) => {
            cfg.targetItems = value;
            persist();
          },
          backTo(player, runtime),
        ),
    },
    {
      label: "原材料列表(货架方块)",
      open: () =>
        openStringListEditor(
          player,
          "原材料列表",
          cfg.materialBlocks,
          "输入货架上的可挖掘方块 ID,用英文逗号分隔。例如:minecraft:oak_log,minecraft:stone",
          (value) => {
            cfg.materialBlocks = value;
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
              cfg = { ...STUDIO_CONFIG_DEFAULTS };
              persist();
              runtime.config.prepSpawn = cfg.prepSpawn;
              runtime.config.maxPlayers = cfg.maxPlayers;
              runtime.resendRegister();
              player.sendMessage("§a已恢复默认");
            },
          },
        ]),
    },
  ]);
}
