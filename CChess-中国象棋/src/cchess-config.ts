// ============================================================
// CChess(中国象棋)运行时配置(/bearcade:config cchess)
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
  CCHESS_CONFIG_DEFAULTS,
  GAME_ID,
  type CChessConfig,
} from "./config";

let cfg: CChessConfig = { ...CCHESS_CONFIG_DEFAULTS };

export function getCChessConfig(): CChessConfig {
  return cfg;
}

export function loadCChessConfig(): void {
  cfg = loadGameConfig(GAME_ID, CCHESS_CONFIG_DEFAULTS);
}

function persist(): void {
  saveGameConfig(GAME_ID, { ...cfg });
}

function backTo(player: Player, runtime: MinigameRuntime): () => void {
  return () => openCChessConfig(player, runtime);
}

function openBoardEditor(player: Player, runtime: MinigameRuntime): void {
  const y = new ObservableString(String(cfg.boardY), { clientWritable: true });
  const minX = new ObservableString(String(cfg.gridMinX), {
    clientWritable: true,
  });
  const maxX = new ObservableString(String(cfg.gridMaxX), {
    clientWritable: true,
  });
  const minZ = new ObservableString(String(cfg.gridMinZ), {
    clientWritable: true,
  });
  const maxZ = new ObservableString(String(cfg.gridMaxZ), {
    clientWritable: true,
  });
  const form = new CustomForm(player, "棋盘位置");
  form.header("棋盘位置(9 列 × 10 行)");
  form.spacer();
  form.label("棋盘所在 Y 与 x/z 范围(整数);棋子位于 boardY+1 层。");
  form.spacer();
  form.textField("棋盘 Y", y);
  form.textField("最小 X(列)", minX);
  form.textField("最大 X(列)", maxX);
  form.textField("最小 Z(行)", minZ);
  form.textField("最大 Z(行)", maxZ);
  form.spacer();
  form.button("保存", () => {
    const ny = Number(y.getData());
    const nx1 = Number(minX.getData());
    const nx2 = Number(maxX.getData());
    const nz1 = Number(minZ.getData());
    const nz2 = Number(maxZ.getData());
    if (
      !Number.isInteger(ny) ||
      !Number.isInteger(nx1) ||
      !Number.isInteger(nx2) ||
      !Number.isInteger(nz1) ||
      !Number.isInteger(nz2) ||
      ny < -64 ||
      ny > 318 ||
      nx1 >= nx2 ||
      nz1 >= nz2 ||
      nx2 - nx1 + 1 > 64 ||
      nz2 - nz1 + 1 > 64
    ) {
      player.sendMessage("§c参数不合法(需整数,min<max,跨度 ≤64)");
      return;
    }
    form.close();
    cfg.boardY = ny;
    cfg.gridMinX = nx1;
    cfg.gridMaxX = nx2;
    cfg.gridMinZ = nz1;
    cfg.gridMaxZ = nz2;
    persist();
    player.sendMessage("§a已保存");
  });
  form.button("返回", () => {
    form.close();
    system.runTimeout(() => openCChessConfig(player, runtime), 2);
  });
  form.show().catch((error) =>
    console.warn("[Bearcade CChess] 棋盘表单失败", error),
  );
}

export function openCChessConfig(
  player: Player,
  runtime: MinigameRuntime,
): void {
  if (runtime.hasActiveGame()) {
    player.sendMessage("§c当前有对局进行中,禁止修改配置");
    return;
  }
  openConfigMenu(player, "中国象棋 · 配置", [
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
      label: "红方开局坐标",
      open: () =>
        openVec3Editor(
          player,
          "红方开局坐标",
          cfg.redStart,
          (value) => {
            cfg.redStart = value;
            persist();
          },
          backTo(player, runtime),
        ),
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
      label: "俯瞰视角高度",
      open: () =>
        openIntEditor(
          player,
          "俯瞰视角高度(格)",
          cfg.overviewHeight,
          (value) => {
            cfg.overviewHeight = value;
            persist();
          },
          {
            min: 5,
            max: 64,
            hint: "对局中使用望远镜切换俯瞰视角的摄像机高度",
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
              cfg = { ...CCHESS_CONFIG_DEFAULTS };
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
