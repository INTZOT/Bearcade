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
  MAHJONG_CONFIG_DEFAULTS,
  SEAT_POSITIONS,
  type MahjongConfig,
} from "./config";

let cfg: MahjongConfig = { ...MAHJONG_CONFIG_DEFAULTS };

export function getMahjongConfig(): MahjongConfig {
  return cfg;
}

export function loadMahjongConfig(): void {
  cfg = loadGameConfig(GAME_ID, MAHJONG_CONFIG_DEFAULTS);
  if (cfg.seatPositions?.length !== 4) {
    cfg.seatPositions = [...MAHJONG_CONFIG_DEFAULTS.seatPositions];
  }
  if (typeof cfg.meldDisplayOffset !== "number") {
    cfg.meldDisplayOffset = MAHJONG_CONFIG_DEFAULTS.meldDisplayOffset;
  }
  // 旧默认座位顺序 [南,西,北,东] 迁移为 [南,东,北,西]
  const oldDefault = [
    SEAT_POSITIONS[0],
    SEAT_POSITIONS[1],
    SEAT_POSITIONS[2],
    SEAT_POSITIONS[3],
  ];
  const isOldDefault = cfg.seatPositions.every(
    (p, i) =>
      p &&
      p.x === oldDefault[i].x &&
      p.y === oldDefault[i].y &&
      p.z === oldDefault[i].z,
  );
  if (isOldDefault) {
    cfg.seatPositions = [
      oldDefault[0],
      oldDefault[3],
      oldDefault[2],
      oldDefault[1],
    ];
  }
}

function persist(): void {
  saveGameConfig(GAME_ID, { ...cfg });
}

function backTo(player: Player, runtime: MinigameRuntime): () => void {
  return () => openMahjongConfig(player, runtime);
}

function openFieldBoundsEditor(player: Player, runtime: MinigameRuntime): void {
  const minX = new ObservableString(String(cfg.fieldMinX), {
    clientWritable: true,
  });
  const maxX = new ObservableString(String(cfg.fieldMaxX), {
    clientWritable: true,
  });
  const minZ = new ObservableString(String(cfg.fieldMinZ), {
    clientWritable: true,
  });
  const maxZ = new ObservableString(String(cfg.fieldMaxZ), {
    clientWritable: true,
  });
  const form = new CustomForm(player, "场地 X/Z 范围");
  form.header("场地 X/Z 范围");
  form.spacer();
  form.label("26×26 方形场地范围(整数,含端点)。");
  form.spacer();
  form.textField("最小 X", minX);
  form.textField("最大 X", maxX);
  form.textField("最小 Z", minZ);
  form.textField("最大 Z", maxZ);
  form.spacer();
  form.button("保存", () => {
    const nxMin = Number(minX.getData());
    const nxMax = Number(maxX.getData());
    const nzMin = Number(minZ.getData());
    const nzMax = Number(maxZ.getData());
    if (
      !Number.isInteger(nxMin) ||
      !Number.isInteger(nxMax) ||
      !Number.isInteger(nzMin) ||
      !Number.isInteger(nzMax) ||
      nxMin >= nxMax ||
      nzMin >= nzMax ||
      nxMax - nxMin + 1 > 64 ||
      nzMax - nzMin + 1 > 64
    ) {
      player.sendMessage("§c参数不合法:需整数,min<max,跨度 ≤64");
      return;
    }
    form.close();
    cfg.fieldMinX = nxMin;
    cfg.fieldMaxX = nxMax;
    cfg.fieldMinZ = nzMin;
    cfg.fieldMaxZ = nzMax;
    persist();
    player.sendMessage("§a已保存");
  });
  form.button("返回", () => {
    form.close();
    system.runTimeout(() => openMahjongConfig(player, runtime), 2);
  });
  form.show().catch((error) =>
    console.warn("[Bearcade Mahjong] 场地范围表单失败", error),
  );
}

export function openMahjongConfig(
  player: Player,
  runtime: MinigameRuntime,
): void {
  if (runtime.hasActiveGame()) {
    player.sendMessage("§c当前有对局进行中,禁止修改配置");
    return;
  }
  openConfigMenu(player, "麻将 · 配置", [
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
      label: "场地 Y",
      open: () =>
        openIntEditor(
          player,
          "场地 Y",
          cfg.fieldY,
          (value) => {
            cfg.fieldY = value;
            persist();
          },
          {
            min: -64,
            max: 318,
            hint: "地板所在 Y;场地内其他坐标会基于该值生成",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "场地 X/Z 范围",
      open: () => openFieldBoundsEditor(player, runtime),
    },
    {
      label: "骰子按钮位置",
      open: () =>
        openVec3Editor(
          player,
          "骰子按钮位置",
          cfg.dicePos,
          (value) => {
            cfg.dicePos = value;
            persist();
          },
          backTo(player, runtime),
        ),
    },
    ...[0, 1, 2, 3].map((idx, i) => ({
      label: `座位 ${i + 1}(${["南", "东", "北", "西"][i] ?? i + 1})坐标`,
      open: () =>
        openVec3Editor(
          player,
          `座位 ${i + 1} 坐标`,
          cfg.seatPositions[idx],
          (value) => {
            cfg.seatPositions[idx] = value;
            persist();
          },
          backTo(player, runtime),
        ),
    })),
    {
      label: "牌垛距离(中心)",
      open: () =>
        openIntEditor(
          player,
          "牌垛距离(中心)",
          cfg.stackInset,
          (value) => {
            cfg.stackInset = value;
            persist();
          },
          {
            min: 1,
            max: 60,
            hint: "牌垛到场地中心的距离,建议小于场地半径",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "手牌展示距离(中心)",
      open: () =>
        openIntEditor(
          player,
          "手牌展示距离(中心)",
          cfg.handDisplayOffset,
          (value) => {
            cfg.handDisplayOffset = value;
            persist();
          },
          {
            min: 1,
            max: 60,
            hint: "手牌行到场地中心的距离",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "副露距离(中心)",
      open: () =>
        openIntEditor(
          player,
          "副露距离(中心)",
          cfg.meldDisplayOffset,
          (value) => {
            cfg.meldDisplayOffset = value;
            persist();
          },
          {
            min: 1,
            max: 60,
            hint: "吃/碰/杠副露到场地中心的距离",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "手牌行长度",
      open: () =>
        openIntEditor(
          player,
          "手牌行长度",
          cfg.handRowLength,
          (value) => {
            cfg.handRowLength = value;
            persist();
          },
          {
            min: 1,
            max: 30,
            hint: "手牌展示一行最多放几张",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "牌河起始距离(中心)",
      open: () =>
        openIntEditor(
          player,
          "牌河起始距离(中心)",
          cfg.discardStartOffset,
          (value) => {
            cfg.discardStartOffset = value;
            persist();
          },
          {
            min: 0,
            max: 30,
            hint: "第一张打出牌离骰子中心的距离",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "牌河每行数量",
      open: () =>
        openIntEditor(
          player,
          "牌河每行数量",
          cfg.discardRowLength,
          (value) => {
            cfg.discardRowLength = value;
            persist();
          },
          {
            min: 1,
            max: 20,
            hint: "牌河每行最多几个,行满换下一行",
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
              cfg = { ...MAHJONG_CONFIG_DEFAULTS };
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
