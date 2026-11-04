// ============================================================
// 领地战争 · 运行时配置(/bearcade:config territory_war)
// 保存到动态属性 bearcade:config_territory_war,持久化优先于代码默认值。
// 改场地几何(中心/边长/地面 Y)后必须重跑 /bearcade:territory_war_buildmap
// 并 /bearcade:tmp ap territory_war,否则场地与规则不匹配。
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
  FIELD_SIZE_MAX,
  FIELD_SIZE_MIN,
  GAME_ID,
  TERRITORY_WAR_CONFIG_DEFAULTS,
  type TerritoryWarConfig,
} from "./config";

let cfg: TerritoryWarConfig = { ...TERRITORY_WAR_CONFIG_DEFAULTS };

export function getTerritoryWarConfig(): TerritoryWarConfig {
  return cfg;
}

export function loadTerritoryWarConfig(): void {
  cfg = loadGameConfig(GAME_ID, TERRITORY_WAR_CONFIG_DEFAULTS);
}

function persist(): void {
  saveGameConfig(GAME_ID, { ...cfg });
}

function backTo(player: Player, runtime: MinigameRuntime): () => void {
  return () => openTerritoryWarConfig(player, runtime);
}

/** 场地中心(X/Z)表单 */
function openCenterEditor(player: Player, runtime: MinigameRuntime): void {
  const x = new ObservableString(String(cfg.centerX), { clientWritable: true });
  const z = new ObservableString(String(cfg.centerZ), { clientWritable: true });
  const form = new CustomForm(player, "场地中心");
  form.header("场地中心");
  form.spacer();
  form.label(
    "领地以该格坐标为中心展开(整数)。改动后需重跑 /bearcade:territory_war_buildmap 与 /bearcade:tmp ap territory_war。",
  );
  form.spacer();
  form.textField("中心 X", x);
  form.textField("中心 Z", z);
  form.spacer();
  form.button("保存", () => {
    const nx = Number(x.getData());
    const nz = Number(z.getData());
    if (!Number.isInteger(nx) || !Number.isInteger(nz)) {
      player.sendMessage("§c请输入整数坐标");
      return;
    }
    form.close();
    cfg.centerX = nx;
    cfg.centerZ = nz;
    persist();
    player.sendMessage(
      "§a已保存。请重跑 /bearcade:territory_war_buildmap 重建场地,再 /bearcade:tmp ap territory_war",
    );
  });
  form.button("返回", () => {
    form.close();
    system.runTimeout(() => openTerritoryWarConfig(player, runtime), 2);
  });
  form.show().catch((error) =>
    console.warn("[Bearcade territory_war] 场地中心表单失败", error),
  );
}

export function openTerritoryWarConfig(
  player: Player,
  runtime: MinigameRuntime,
): void {
  if (runtime.hasActiveGame()) {
    player.sendMessage("§c当前有对局进行中,禁止修改配置");
    return;
  }
  openConfigMenu(player, "领地战争 · 配置", [
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
      label: "场地中心(X / Z)",
      open: () => openCenterEditor(player, runtime),
    },
    {
      label: "场地边长(格)",
      open: () =>
        openIntEditor(
          player,
          "场地边长(格,奇数)",
          cfg.fieldSize,
          (value) => {
            cfg.fieldSize = value;
            persist();
          },
          {
            min: FIELD_SIZE_MIN,
            max: FIELD_SIZE_MAX,
            hint: `领地是正方形边长(${FIELD_SIZE_MIN}~${FIELD_SIZE_MAX},奇数)。改动后需重跑 /bearcade:territory_war_buildmap 与 /bearcade:tmp ap territory_war`,
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "场地地面 Y",
      open: () =>
        openIntEditor(
          player,
          "场地地面 Y",
          cfg.fieldY,
          (value) => {
            cfg.fieldY = value;
            persist();
          },
          {
            min: 58,
            max: 76,
            hint: "领地地面方块所在层,玩家站立在 +1 层。改动后需重跑建图命令",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "一局时长(秒,0=无尽)",
      open: () =>
        openIntEditor(
          player,
          "一局时长(秒,0 = 无尽模式)",
          cfg.gameDurationSeconds,
          (value) => {
            cfg.gameDurationSeconds = value;
            persist();
          },
          {
            min: 0,
            max: 900,
            hint: "限时模式:时间到按领土占比排名(占比相同看击杀数);填 0 = 无尽模式,不限时,只剩最后一名存活者时结束(此时建议把复活等待设为 0)",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "复活等待(秒,0=不复活)",
      open: () =>
        openIntEditor(
          player,
          "复活等待(秒,0 = 淘汰不复活)",
          cfg.respawnSeconds,
          (value) => {
            cfg.respawnSeconds = value;
            persist();
          },
          {
            min: 0,
            max: 60,
            hint: "被切断尾迹后等待多久在随机空地复活;0 表示直接淘汰不复活",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "初始领地边长(格)",
      open: () =>
        openIntEditor(
          player,
          "初始领地边长(格,奇数)",
          cfg.startPlotSize,
          (value) => {
            cfg.startPlotSize = value;
            persist();
          },
          {
            min: 1,
            max: 15,
            hint: "开局与复活时每人的正方形领地边长(奇数)",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "获胜领土占比(%)",
      open: () =>
        openIntEditor(
          player,
          "获胜领土占比(%)",
          cfg.winPercent,
          (value) => {
            cfg.winPercent = value;
            persist();
          },
          {
            min: 20,
            max: 100,
            hint: "某玩家领土占比达到该值立即结束对局并判胜(时间到仍按占比排名)",
            back: backTo(player, runtime),
          },
        ),
    },
    {
      label: "移动加速等级(0~3)",
      open: () =>
        openIntEditor(
          player,
          "移动加速等级(0~3)",
          cfg.speedAmplifier,
          (value) => {
            cfg.speedAmplifier = value;
            persist();
          },
          {
            min: 0,
            max: 3,
            hint: "0 = 不加速,1 = 速度 I,等级越高移动越快(尾迹也拖得更快)",
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
              cfg = { ...TERRITORY_WAR_CONFIG_DEFAULTS };
              persist();
              runtime.config.prepSpawn = cfg.prepSpawn;
              runtime.resendRegister();
              player.sendMessage("§a已恢复默认(场地几何改动需重跑建图命令)");
            },
          },
        ]),
    },
  ]);
}
