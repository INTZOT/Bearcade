// ============================================================
// 夺旗(Ctf)运行时配置(/bearcade:config ctf)
// 可配置:准备房间坐标、两队出生点/旗帜位置、商店位置、
// 时长/比分/复活/回城、经济、回复/诅咒、TNT、水中伤害、拾取半径等;
// 界面提供"恢复默认"。对局进行中禁止修改。
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
  CTF_CONFIG_DEFAULTS,
  GAME_ID,
  type CTFConfig,
} from "./config";

let cfg: CTFConfig = cloneConfig(CTF_CONFIG_DEFAULTS);

export function getCTFConfig(): CTFConfig {
  return cfg;
}

export function loadCTFConfig(): void {
  cfg = cloneConfig(loadGameConfig(GAME_ID, CTF_CONFIG_DEFAULTS));
}

/** 深拷贝:teams/itemShops 等嵌套数组不得与默认值共享引用(修改会污染默认值) */
function cloneConfig(value: CTFConfig): CTFConfig {
  return JSON.parse(JSON.stringify(value)) as CTFConfig;
}

function persist(): void {
  saveGameConfig(GAME_ID, { ...cfg });
}

function backTo(player: Player, runtime: MinigameRuntime): () => void {
  return () => openCTFConfig(player, runtime);
}

/** 整数项编辑(保存即持久化,返回配置主菜单) */
function intEntry(
  player: Player,
  runtime: MinigameRuntime,
  label: string,
  title: string,
  hint: string,
  get: () => number,
  set: (value: number) => void,
  min: number,
  max: number,
): { label: string; open: () => void } {
  return {
    label,
    open: () =>
      openIntEditor(player, title, get(), (value) => {
        set(value);
        persist();
      }, {
        min,
        max,
        hint,
        back: backTo(player, runtime),
      }),
  };
}

/** 坐标项编辑(保存即持久化,返回配置主菜单) */
function vec3Entry(
  player: Player,
  runtime: MinigameRuntime,
  label: string,
  title: string,
  get: () => { x: number; y: number; z: number },
  set: (value: { x: number; y: number; z: number }) => void,
): { label: string; open: () => void } {
  return {
    label,
    open: () =>
      openVec3Editor(player, title, get(), (value) => {
        set(value);
        persist();
      }, backTo(player, runtime)),
  };
}

export function openCTFConfig(
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
    // 队伍出生点/旗帜位置
    ...cfg.teams.flatMap((team, index) => [
      vec3Entry(
        player,
        runtime,
        `${team.name}出生点`,
        `${team.name}出生点`,
        () => cfg.teams[index]!.spawnPoint,
        (value) => {
          cfg.teams[index]!.spawnPoint = value;
        },
      ),
      vec3Entry(
        player,
        runtime,
        `${team.name}旗帜位置`,
        `${team.name}旗帜位置`,
        () => cfg.teams[index]!.flagHomePosition,
        (value) => {
          cfg.teams[index]!.flagHomePosition = value;
        },
      ),
    ]),
    // 商店位置
    ...cfg.itemShops.flatMap((_, index) => [
      vec3Entry(
        player,
        runtime,
        `物品商店${index + 1}`,
        `物品商店${index + 1}`,
        () => cfg.itemShops[index]!,
        (value) => {
          cfg.itemShops[index] = value;
        },
      ),
    ]),
    ...cfg.buffShops.flatMap((_, index) => [
      vec3Entry(
        player,
        runtime,
        `增益商店${index + 1}`,
        `增益商店${index + 1}`,
        () => cfg.buffShops[index]!,
        (value) => {
          cfg.buffShops[index] = value;
        },
      ),
    ]),
    intEntry(
      player,
      runtime,
      "获胜所需分数",
      "获胜所需分数",
      "率先达到该分数的队伍获胜",
      () => cfg.maxScore,
      (value) => {
        cfg.maxScore = value;
      },
      1,
      100,
    ),
    intEntry(
      player,
      runtime,
      "对局时长(分钟)",
      "对局时长(分钟)",
      "时间到按当前得分判定胜负/平局",
      () => Math.round(cfg.matchTime / 60),
      (value) => {
        cfg.matchTime = value * 60;
      },
      1,
      60,
    ),
    intEntry(
      player,
      runtime,
      "旗帜掉落回城时间(秒)",
      "旗帜掉落回城时间(秒)",
      "掉落的旗帜超过该时间未被拾取自动回城",
      () => cfg.flagReturnTime,
      (value) => {
        cfg.flagReturnTime = value;
      },
      5,
      120,
    ),
    intEntry(
      player,
      runtime,
      "复活等待(秒)",
      "复活等待(秒)",
      "阵亡后等待多少秒复活",
      () => cfg.respawnTime,
      (value) => {
        cfg.respawnTime = value;
      },
      1,
      60,
    ),
    intEntry(
      player,
      runtime,
      "初始羊毛方块数",
      "初始羊毛方块数",
      "开局按队伍颜色发放的羊毛数量",
      () => cfg.initialBlockCount,
      (value) => {
        cfg.initialBlockCount = value;
      },
      0,
      128,
    ),
    intEntry(
      player,
      runtime,
      "击杀回血(半心)",
      "击杀回血(半心)",
      "击杀敌人后恢复的血量(半心单位)",
      () => cfg.killRestoration,
      (value) => {
        cfg.killRestoration = value;
      },
      0,
      20,
    ),
    intEntry(
      player,
      runtime,
      "回复延迟(秒)",
      "回复延迟(秒)",
      "受伤后多少秒开始自然恢复",
      () => cfg.regenDelaySeconds,
      (value) => {
        cfg.regenDelaySeconds = value;
      },
      0,
      60,
    ),
    intEntry(
      player,
      runtime,
      "回复速度(半心/秒)",
      "回复速度(半心/秒)",
      "自然恢复每秒恢复的血量(半心单位)",
      () => cfg.regenPerSecond,
      (value) => {
        cfg.regenPerSecond = value;
      },
      0,
      10,
    ),
    intEntry(
      player,
      runtime,
      "旗帜诅咒触发(秒)",
      "旗帜诅咒触发(秒)",
      "购买诅咒后,旗帜被夺持续该时间即诅咒夺旗者",
      () => cfg.flagCurseTriggerSeconds,
      (value) => {
        cfg.flagCurseTriggerSeconds = value;
      },
      10,
      600,
    ),
    intEntry(
      player,
      runtime,
      "诅咒生命上限(半心)",
      "诅咒生命上限(半心)",
      "被诅咒夺旗者的生命上限(半心单位,6=3颗心)",
      () => cfg.flagCurseMaxHealth,
      (value) => {
        cfg.flagCurseMaxHealth = value;
      },
      2,
      20,
    ),
    intEntry(
      player,
      runtime,
      "TNT 引信(秒)",
      "TNT 引信(秒)",
      "放置后多少秒爆炸",
      () => Math.round(cfg.tntFuseTicks / 20),
      (value) => {
        cfg.tntFuseTicks = value * 20;
      },
      1,
      10,
    ),
    intEntry(
      player,
      runtime,
      "TNT 爆炸半径(格)",
      "TNT 爆炸半径(格)",
      "球形破坏/伤害半径",
      () => cfg.tntExplosionRadius,
      (value) => {
        cfg.tntExplosionRadius = value;
      },
      1,
      16,
    ),
    intEntry(
      player,
      runtime,
      "TNT 伤害(半心)",
      "TNT 伤害(半心)",
      "对非队友玩家造成的伤害(半心单位)",
      () => cfg.tntPlayerDamage,
      (value) => {
        cfg.tntPlayerDamage = value;
      },
      0,
      40,
    ),
    intEntry(
      player,
      runtime,
      "初始金币",
      "初始金币",
      "开局发放的经济",
      () => cfg.economyInitial,
      (value) => {
        cfg.economyInitial = value;
      },
      0,
      10000,
    ),
    intEntry(
      player,
      runtime,
      "击杀奖励",
      "击杀奖励",
      "击杀敌人获得的金币",
      () => cfg.economyKillReward,
      (value) => {
        cfg.economyKillReward = value;
      },
      0,
      1000,
    ),
    intEntry(
      player,
      runtime,
      "夺旗奖励",
      "夺旗奖励",
      "成功夺旗得分时获得的金币",
      () => cfg.economyFlagReward,
      (value) => {
        cfg.economyFlagReward = value;
      },
      0,
      1000,
    ),
    intEntry(
      player,
      runtime,
      "每秒金币",
      "每秒金币",
      "全体玩家每秒被动获得的金币",
      () => cfg.economyTickReward,
      (value) => {
        cfg.economyTickReward = value;
      },
      0,
      100,
    ),
    intEntry(
      player,
      runtime,
      "水中受伤延迟(秒)",
      "水中受伤延迟(秒)",
      "在水中持续该时间后开始受伤",
      () => cfg.waterDamageTriggerDelay / 20,
      (value) => {
        cfg.waterDamageTriggerDelay = value * 20;
      },
      0,
      20,
    ),
    intEntry(
      player,
      runtime,
      "水中伤害(半心)",
      "水中伤害(半心)",
      "水中周期性伤害值(半心单位)",
      () => cfg.waterDamage,
      (value) => {
        cfg.waterDamage = value;
      },
      0,
      20,
    ),
    intEntry(
      player,
      runtime,
      "旗帜拾取半径(格)",
      "旗帜拾取半径(格)",
      "拾取/归还/得分的判定距离",
      () => cfg.captureRadius,
      (value) => {
        cfg.captureRadius = value;
      },
      1,
      8,
    ),
    {
      label: "恢复默认",
      open: () =>
        openConfigMenu(player, "确认恢复默认", [
          {
            label: "确认",
            open: () => {
              cfg = cloneConfig(CTF_CONFIG_DEFAULTS);
              persist();
              runtime.config.prepSpawn = cfg.prepSpawn;
              runtime.resendRegister();
              player.sendMessage("§a已恢复默认");
            },
          },
        ]),
    },
  ];
  openConfigMenu(player, "夺旗 · 配置", entries);
}
