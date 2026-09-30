// ============================================================
// 轮转井字棋 · 运行时配置(/bearcade:config trio)
// 保存到动态属性 bearcade:config_trio,持久化优先于代码默认值。
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
import { GAME_ID, TRIO_CONFIG_DEFAULTS, type TrioConfig } from "./config";

let cfg: TrioConfig = { ...TRIO_CONFIG_DEFAULTS };

export function getTrioConfig(): TrioConfig {
  return cfg;
}

export function loadTrioConfig(): void {
  cfg = loadGameConfig(GAME_ID, TRIO_CONFIG_DEFAULTS);
}

function persist(): void {
  saveGameConfig(GAME_ID, { ...cfg });
}

function backTo(player: Player, runtime: MinigameRuntime): () => void {
  return () => openTrioConfig(player, runtime);
}

/** 棋盘位置:层高 + 3×3 最小角坐标 */
function openBoardEditor(player: Player, runtime: MinigameRuntime): void {
  const y = new ObservableString(String(cfg.boardY), { clientWritable: true });
  const minX = new ObservableString(String(cfg.boardMinX), {
    clientWritable: true,
  });
  const minZ = new ObservableString(String(cfg.boardMinZ), {
    clientWritable: true,
  });
  const form = new CustomForm(player, "棋盘位置");
  form.header("棋盘位置");
  form.spacer();
  form.label(
    "磁石棋盘所在 Y 与 3×3 最小角 X/Z(整数);棋子方块放置在 boardY+1 层。",
  );
  form.spacer();
  form.textField("棋盘 Y", y);
  form.textField("最小 X", minX);
  form.textField("最小 Z", minZ);
  form.spacer();
  form.button("保存", () => {
    const ny = Number(y.getData());
    const nx = Number(minX.getData());
    const nz = Number(minZ.getData());
    if (
      !Number.isInteger(ny) ||
      !Number.isInteger(nx) ||
      !Number.isInteger(nz) ||
      ny < -64 ||
      ny > 317 ||
      Math.abs(nx) > 1000 ||
      Math.abs(nz) > 1000
    ) {
      player.sendMessage(
        "§c参数不合法(需整数,棋盘 Y 需在 -64~317,保证棋子层不超过 318)",
      );
      return;
    }
    form.close();
    cfg.boardY = ny;
    cfg.boardMinX = nx;
    cfg.boardMinZ = nz;
    persist();
    player.sendMessage("§a已保存(棋盘点位改动后建议 /bearcade:trio_buildmap 重铺棋盘)");
  });
  form.button("返回", () => {
    form.close();
    system.runTimeout(() => openTrioConfig(player, runtime), 2);
  });
  form.show().catch((error) =>
    console.warn("[Bearcade trio] 棋盘表单失败", error),
  );
}

export function openTrioConfig(
  player: Player,
  runtime: MinigameRuntime,
): void {
  if (runtime.hasActiveGame()) {
    player.sendMessage("§c当前有对局进行中,禁止修改配置");
    return;
  }
  openConfigMenu(player, "轮转井字棋 · 配置", [
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
      label: "X 方开局坐标",
      open: () =>
        openVec3Editor(
          player,
          "X 方开局坐标",
          cfg.xStart,
          (value) => {
            cfg.xStart = value;
            persist();
          },
          backTo(player, runtime),
        ),
    },
    {
      label: "O 方开局坐标",
      open: () =>
        openVec3Editor(
          player,
          "O 方开局坐标",
          cfg.oStart,
          (value) => {
            cfg.oStart = value;
            persist();
          },
          backTo(player, runtime),
        ),
    },
    {
      label: "每步限时(秒)",
      open: () =>
        openIntEditor(
          player,
          "每步限时(秒)",
          cfg.moveTimeoutSeconds,
          (value) => {
            cfg.moveTimeoutSeconds = value;
            persist();
          },
          {
            min: 5,
            max: 300,
            hint: "超时后由脚本在合法格中随机落子;同一玩家连续 3 次超时本局判负",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "胜利所需局数",
      open: () =>
        openIntEditor(
          player,
          "胜利所需局数(三局两胜=2)",
          cfg.winsToMatch,
          (value) => {
            cfg.winsToMatch = value;
            persist();
          },
          {
            min: 1,
            max: 3,
            hint: "先取得该胜局数者赢下整场(2 = 三局两胜)",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "每局手数上限",
      open: () =>
        openIntEditor(
          player,
          "每局手数上限",
          cfg.maxMovesPerRound,
          (value) => {
            cfg.maxMovesPerRound = value;
            persist();
          },
          {
            min: 10,
            max: 200,
            hint: "达到上限仍未三连则本局平局(该局不计分)",
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
              cfg = { ...TRIO_CONFIG_DEFAULTS };
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
