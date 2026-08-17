// ============================================================
// Go(围棋)运行时配置(/bearcade:config go)
// ============================================================
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
  GO_CONFIG_DEFAULTS,
  GAME_ID,
  type GoConfig,
} from "./config";

let cfg: GoConfig = { ...GO_CONFIG_DEFAULTS };

export function getGoConfig(): GoConfig {
  return cfg;
}

export function loadGoConfig(): void {
  cfg = loadGameConfig(GAME_ID, GO_CONFIG_DEFAULTS);
}

function persist(): void {
  saveGameConfig(GAME_ID, { ...cfg });
}

function backTo(player: Player, runtime: MinigameRuntime): () => void {
  return () => openGoConfig(player, runtime);
}

function openBoardEditor(player: Player, runtime: MinigameRuntime): void {
  const y = new ObservableString(String(cfg.boardY), { clientWritable: true });
  const min = new ObservableString(String(cfg.gridMin), { clientWritable: true });
  const max = new ObservableString(String(cfg.gridMax), { clientWritable: true });
  const form = new CustomForm(player, "棋盘位置");
  form.header("棋盘位置");
  form.spacer();
  form.label("棋盘所在 Y 与 x/z 范围(整数);棋子放置在 boardY+1 层。");
  form.spacer();
  form.textField("棋盘 Y", y);
  form.textField("最小 X/Z", min);
  form.textField("最大 X/Z", max);
  form.spacer();
  form.button("保存", () => {
    const ny = Number(y.getData());
    const nmin = Number(min.getData());
    const nmax = Number(max.getData());
    if (
      !Number.isInteger(ny) ||
      !Number.isInteger(nmin) ||
      !Number.isInteger(nmax) ||
      ny < -64 ||
      ny > 320 ||
      nmin >= nmax ||
      nmax - nmin + 1 > 64
    ) {
      player.sendMessage("§c参数不合法(需整数,min<max,跨度 ≤64)");
      return;
    }
    form.close();
    cfg.boardY = ny;
    cfg.gridMin = nmin;
    cfg.gridMax = nmax;
    persist();
    player.sendMessage("§a已保存");
  });
  form.button("返回", () => {
    form.close();
    system.runTimeout(() => openGoConfig(player, runtime), 2);
  });
  form.show().catch((error) =>
    console.warn("[Bearcade Go] 棋盘表单失败", error),
  );
}

export function openGoConfig(player: Player, runtime: MinigameRuntime): void {
  if (runtime.hasActiveGame()) {
    player.sendMessage("§c当前有对局进行中,禁止修改配置");
    return;
  }
  openConfigMenu(player, "围棋 · 配置", [
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
      label: "棋盘位置",
      open: () => openBoardEditor(player, runtime),
    },
    {
      label: "黑方开局坐标",
      open: () =>
        openVec3Editor(
          player,
          "黑方开局坐标",
          cfg.blackStart,
          (value) => {
            cfg.blackStart = value;
            persist();
          },
          backTo(player, runtime),
        ),
    },
    {
      label: "白方开局坐标",
      open: () =>
        openVec3Editor(
          player,
          "白方开局坐标",
          cfg.whiteStart,
          (value) => {
            cfg.whiteStart = value;
            persist();
          },
          backTo(player, runtime),
        ),
    },
    {
      label: "黑贴目",
      open: () =>
        openIntEditor(
          player,
          "黑贴目(目)",
          Math.round(cfg.komi * 2),
          (value) => {
            cfg.komi = value / 2;
            persist();
          },
          {
            min: 0,
            max: 20,
            hint: "终局黑方加分,如 11 = 5.5 目",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "每方局时(分钟)",
      open: () =>
        openIntEditor(
          player,
          "每方局时(分钟)",
          Math.round(cfg.clockTicks / 1200),
          (value) => {
            cfg.clockTicks = value * 1200;
            persist();
          },
          {
            min: 1,
            max: 180,
            hint: "当前玩家计时,超时判负",
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
              cfg = { ...GO_CONFIG_DEFAULTS };
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
