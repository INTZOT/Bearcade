// ============================================================
// HungerGame(饥饿游戏)运行时配置(/bearcade:config hungergame)
// 含:阶段时长、出生圆、死斗场、扣血保底、观战台、物资池管理
// ============================================================
import { system, type Player } from "@minecraft/server";
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
  clearPool,
  countPoolItems,
  savePlayerInventoryToPool,
} from "./loot";
import {
  GAME_ID,
  HUNGER_GAME_CONFIG_DEFAULTS,
  POOL_LEVELS,
  type HungerGameConfig,
} from "./config";

let cfg: HungerGameConfig = { ...HUNGER_GAME_CONFIG_DEFAULTS };

export function getHungerGameConfig(): HungerGameConfig {
  return cfg;
}

export function loadHungerGameConfig(): void {
  cfg = loadGameConfig(GAME_ID, HUNGER_GAME_CONFIG_DEFAULTS);
}

function persist(): void {
  saveGameConfig(GAME_ID, { ...cfg });
}

function backTo(player: Player, runtime: MinigameRuntime): () => void {
  return () => openHungerGameConfig(player, runtime);
}

function intEditor(
  player: Player,
  runtime: MinigameRuntime,
  title: string,
  current: number,
  save: (value: number) => void,
  options: { min: number; max: number; hint: string },
): void {
  openIntEditor(
    player,
    title,
    current,
    (value) => {
      save(value);
      persist();
    },
    { ...options, back: backTo(player, runtime) },
  );
}

function vecEditor(
  player: Player,
  runtime: MinigameRuntime,
  title: string,
  current: { x: number; y: number; z: number },
  save: (value: { x: number; y: number; z: number }) => void,
): void {
  openVec3Editor(
    player,
    title,
    current,
    (value) => {
      save(value);
      persist();
    },
    backTo(player, runtime),
  );
}

export function openHungerGameConfig(
  player: Player,
  runtime: MinigameRuntime,
): void {
  if (runtime.hasActiveGame()) {
    player.sendMessage("§c当前有对局进行中,禁止修改配置");
    return;
  }
  openConfigMenu(player, "饥饿游戏 · 配置", [
    {
      label: "准备房间坐标",
      open: () =>
        vecEditor(player, runtime, "准备房间坐标", cfg.prepSpawn, (v) => {
          cfg.prepSpawn = v;
          runtime.config.prepSpawn = v;
          runtime.resendRegister();
        }),
    },
    {
      label: "阶段时长",
      open: () =>
        openConfigMenu(player, "阶段时长(秒)", [
          {
            label: "冻结(阶段1)",
            open: () =>
              intEditor(player, runtime, "冻结时长(秒)", cfg.freezeSeconds, (v) => {
                cfg.freezeSeconds = v;
              }, { min: 1, max: 120, hint: "开局不可移动的预热时间" }),
          },
          {
            label: "保护期(阶段2)",
            open: () =>
              intEditor(player, runtime, "保护期(秒)", cfg.protectSeconds, (v) => {
                cfg.protectSeconds = v;
              }, { min: 1, max: 300, hint: "可移动可搜刮,不可战斗" }),
          },
          {
            label: "PVP 一阶段",
            open: () =>
              intEditor(player, runtime, "PVP 一阶段(秒)", cfg.pvp1Seconds, (v) => {
                cfg.pvp1Seconds = v;
              }, { min: 10, max: 1800, hint: "正常战斗阶段" }),
          },
          {
            label: "PVP 二阶段",
            open: () =>
              intEditor(player, runtime, "PVP 二阶段(秒)", cfg.pvp2Seconds, (v) => {
                cfg.pvp2Seconds = v;
              }, { min: 10, max: 1800, hint: "中心区物资升级为 4 级" }),
          },
          {
            label: "死斗(阶段5)",
            open: () =>
              intEditor(player, runtime, "死斗(秒)", cfg.duelSeconds, (v) => {
                cfg.duelSeconds = v;
              }, { min: 10, max: 600, hint: "死斗结束后进入扣血保底" }),
          },
        ]),
    },
    {
      label: "出生等分圆",
      open: () =>
        openConfigMenu(player, "出生等分圆", [
          {
            label: "圆心",
            open: () =>
              vecEditor(player, runtime, "出生圆圆心", cfg.spawnCenter, (v) => {
                cfg.spawnCenter = v;
              }),
          },
          {
            label: "半径",
            open: () =>
              intEditor(player, runtime, "出生圆半径", cfg.spawnRadius, (v) => {
                cfg.spawnRadius = v;
              }, { min: 8, max: 256, hint: "16 人内单圈等分" }),
          },
          {
            label: "派对超员半径",
            open: () =>
              intEditor(player, runtime, "派对超员半径", cfg.spawnRadiusParty, (v) => {
                cfg.spawnRadiusParty = v;
              }, { min: 8, max: 256, hint: "派对模式超过 16 人时第二圈" }),
          },
        ]),
    },
    {
      label: "死斗场",
      open: () =>
        openConfigMenu(player, "死斗场", [
          {
            label: "中心",
            open: () =>
              vecEditor(player, runtime, "死斗场中心", cfg.duelCenter, (v) => {
                cfg.duelCenter = v;
              }),
          },
          {
            label: "扩散半径",
            open: () =>
              intEditor(player, runtime, "死斗场扩散半径", cfg.duelRadius, (v) => {
                cfg.duelRadius = v;
              }, { min: 4, max: 128, hint: "剩余玩家传送后圆形扩散" }),
          },
        ]),
    },
    {
      label: "扣血保底(阶段6)",
      open: () =>
        openConfigMenu(player, "扣血保底", [
          {
            label: "扣血间隔(秒)",
            open: () =>
              intEditor(player, runtime, "扣血间隔(秒)", cfg.bleedInterval, (v) => {
                cfg.bleedInterval = v;
              }, { min: 1, max: 60, hint: "每隔 N 秒全员扣血" }),
          },
          {
            label: "每次伤害",
            open: () =>
              intEditor(player, runtime, "每次伤害", cfg.bleedDamage, (v) => {
                cfg.bleedDamage = v;
              }, { min: 1, max: 10, hint: "生命值 20,建议 1~2" }),
          },
        ]),
    },
    {
      label: "观战台位置",
      open: () =>
        vecEditor(player, runtime, "观战台位置", cfg.spectateSpot, (v) => {
          cfg.spectateSpot = v;
        }),
    },
    {
      label: "物资池管理",
      open: () =>
        openConfigMenu(
          player,
          "物资池管理(1~4 级)",
          Array.from({ length: POOL_LEVELS }, (_, i) => {
            const level = i + 1;
            return {
              label: `${level} 级物资池(${countPoolItems(
                () => runtime,
                level,
              )} 件)`,
              open: () =>
                openConfigMenu(player, `${level} 级物资池`, [
                  {
                    label: "保存当前玩家背包到该池",
                    open: () => {
                      const ok = savePlayerInventoryToPool(
                        () => runtime,
                        player,
                        level,
                      );
                      player.sendMessage(
                        ok
                          ? `§a已保存(同步全部房间 ${level} 级池)`
                          : "§c保存失败(物资池实体未就绪)",
                      );
                      system.runTimeout(
                        () => openHungerGameConfig(player, runtime),
                        4,
                      );
                    },
                  },
                  {
                    label: "清空该池",
                    open: () =>
                      openConfigMenu(player, "确认清空", [
                        {
                          label: "确认",
                          open: () => {
                            clearPool(() => runtime, level);
                            player.sendMessage("§a已清空");
                            system.runTimeout(
                              () => openHungerGameConfig(player, runtime),
                              4,
                            );
                          },
                        },
                      ]),
                  },
                ]),
            };
          }),
        ),
    },
    {
      label: "恢复默认",
      open: () =>
        openConfigMenu(player, "确认恢复默认", [
          {
            label: "确认",
            open: () => {
              cfg = { ...HUNGER_GAME_CONFIG_DEFAULTS };
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
