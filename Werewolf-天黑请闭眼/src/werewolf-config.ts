// ============================================================
// 天黑请闭眼运行时配置(/bearcade:config werewolf)
// 可配置:准备房间坐标与各阶段时长;恢复默认。
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
  WEREWOLF_CONFIG_DEFAULTS,
  type WerewolfConfig,
} from "./config";

let cfg: WerewolfConfig = { ...WEREWOLF_CONFIG_DEFAULTS };

export function getWerewolfConfig(): WerewolfConfig {
  return cfg;
}

export function loadWerewolfConfig(): void {
  cfg = loadGameConfig(GAME_ID, WEREWOLF_CONFIG_DEFAULTS);
}

function persist(): void {
  saveGameConfig(GAME_ID, { ...cfg });
}

function backTo(player: Player, runtime: MinigameRuntime): () => void {
  return () => openWerewolfConfig(player, runtime);
}

export function openWerewolfConfig(
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
      label: "狙击手行动时间(秒)",
      open: () =>
        openIntEditor(
          player,
          "狙击手行动时间(秒)",
          cfg.sniperSeconds,
          (value) => {
            cfg.sniperSeconds = value;
            persist();
          },
          { min: 10, max: 120, back: backTo(player, runtime) },
        ),
    },
    {
      label: "守卫行动时间(秒)",
      open: () =>
        openIntEditor(
          player,
          "守卫行动时间(秒)",
          cfg.guardSeconds,
          (value) => {
            cfg.guardSeconds = value;
            persist();
          },
          { min: 10, max: 120, back: backTo(player, runtime) },
        ),
    },
    {
      label: "杀手行动时间(秒)",
      open: () =>
        openIntEditor(
          player,
          "杀手行动时间(秒)",
          cfg.killerSeconds,
          (value) => {
            cfg.killerSeconds = value;
            persist();
          },
          { min: 10, max: 180, back: backTo(player, runtime) },
        ),
    },
    {
      label: "警察行动时间(秒)",
      open: () =>
        openIntEditor(
          player,
          "警察行动时间(秒)",
          cfg.policeSeconds,
          (value) => {
            cfg.policeSeconds = value;
            persist();
          },
          { min: 10, max: 180, back: backTo(player, runtime) },
        ),
    },
    {
      label: "白天讨论投票时间(秒)",
      open: () =>
        openIntEditor(
          player,
          "白天讨论投票时间(秒)",
          cfg.daySeconds,
          (value) => {
            cfg.daySeconds = value;
            persist();
          },
          { min: 30, max: 300, back: backTo(player, runtime) },
        ),
    },
    {
      label: "恢复默认",
      open: () =>
        openConfigMenu(player, "确认恢复默认", [
          {
            label: "确认",
            open: () => {
              cfg = { ...WEREWOLF_CONFIG_DEFAULTS };
              persist();
              runtime.config.prepSpawn = cfg.prepSpawn;
              runtime.resendRegister();
              player.sendMessage("§a已恢复默认");
            },
          },
        ]),
    },
  ];

  openConfigMenu(player, "天黑请闭眼 · 配置", entries);
}
