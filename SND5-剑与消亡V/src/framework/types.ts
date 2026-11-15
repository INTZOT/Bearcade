// ============================================================
// SND5 框架层共享类型
// 分层约束(见《SND5 架构设计》§1.3):
// - 框架层允许 import @minecraft/server,但内容层禁止;
// - 内容层只通过 ctx.primitives / session 门面访问框架能力;
// - 系统间反向影响一律走事件总线(见 events.ts)。
// ============================================================
import type { Player } from "@minecraft/server";
import type { Vec3 } from "../../../shared/minigame-core/types";
import type { Registry } from "./registry";
import type { SkillDefinition } from "./skill/types";
import type { StatusDefinition } from "./status/types";
import type { CapturePointDef } from "./capture";
import type { SupplyStationDef } from "./supply";
import type { MatchSession } from "./session";

/** 伤害元素(内容设计 PDF 第 1 页:无/电/火/水/本源) */
export type DamageElement = "physical" | "electric" | "fire" | "water" | "origin";

/**
 * 伤害标签:影响结算规则。
 * - dot:不触发吸血,致死拦截可选择性跳过(由被动自行判断);
 * - reaction:反应伤害,管线不再递归解析反应。
 */
export type DamageTag = "melee" | "skill" | "dot" | "projectile" | "sweep" | "reaction" | "weapon";

export type TeamId = string;

/** 三资源(生命/护甲/魔力),SND5 全部独立于原版属性 */
export interface ResourceTriple {
  hp: number;
  armor: number;
  mana: number;
}

/** 队伍查询门面(内容层/对局层提供实现,框架层只读) */
export interface TeamProvider {
  readonly teamIds: readonly TeamId[];
  getTeam(playerId: string): TeamId | undefined;
  teamDisplayName(teamId: TeamId): string;
}

/**
 * 玩家配置(职业装载):由内容层提供,会话在开局与重生时读取。
 * 属性面板写入 AttributeSystem;技能写入 SkillLoadout;被动交给 PassiveManager。
 */
export interface PlayerLoadout {
  professionId?: string;
  base: ResourceTriple;
  /** 槽位 → 技能 id(innate_1 / innate_2 / codex_1 / codex_2) */
  skills?: Record<string, string>;
  /** 被动技能 id 列表(固有Ⅲ) */
  passiveIds?: string[];
}

/** 对局注入点:框架层不认识任何职业,队伍/出生点/装载全部由内容层提供 */
export interface SessionInjects {
  teams: TeamProvider;
  /** 重生点(含开局首次落位) */
  getRespawnLocation(playerId: string): Vec3;
  /** 职业装载(返回 undefined 时使用默认面板) */
  loadoutFor?(playerId: string): PlayerLoadout | undefined;
  /** 会话开始(发武器/消耗品等,内容层实现) */
  onSessionStart?(session: MatchSession): void;
  /** 玩家脚本死亡(内容层可做掉落/提示等) */
  onPlayerDeath?(playerId: string, killerId?: string): void;
  /** 玩家重生(重新发放武器/消耗品,内容层实现) */
  onPlayerRespawn?(playerId: string): void;
  /**
   * 秘典补给恢复:补给站为耗尽的秘典充能后,把背包内物品重写为可用态。
   * 具体物品外观约定(占位物品/nameTag)由装配层实现,框架只负责调度。
   */
  codexItemRestore?(player: Player, slot: "codex_1" | "codex_2", skillId: string): void;
  /** 职业显示名(HUD 用;按 professionId 查询,内容层职业注册表提供) */
  professionNameOf?(professionId: string): string | undefined;
  /**
   * 近战武器结算:轻击/重击数值与附加效果由内容层按职业计算。
   * 原版近战伤害已在 entityHurt 前事件统一取消,不实现该钩子则近战无伤害。
   */
  weaponAttack?(
    session: MatchSession,
    attackerId: string,
    victimId: string,
    isSneaking: boolean,
  ): void;
}

/** 运行时可调数值(/bearcade:config 热调参,持久化到 bearcade:config_snd5) */
export interface Snd5RuntimeConfig {
  /** 先达到该分数的队伍获胜(默认 2000,到分立即结束) */
  scoreTarget: number;
  /** 对局时长上限(秒),到点比总分判定,平分平局;0 = 不限时 */
  matchSeconds: number;
  /** 任意玩家阵亡时对方队伍得分 */
  deathScore: number;
  /**
   * 占点产分曲线:下标 = 当前占有点数,值 = 每秒得分。
   * 默认 [0,1,2,4,8,16](5 点封顶,超出按末位)。
   */
  holdScoreRates: number[];
  /** 中立点占领读秒(秒):单队独占累计该时长完成占领 */
  neutralCaptureSeconds: number;
  /** 敌方已占点接管读秒(秒):单队独占累计该时长完成接管 */
  takeoverCaptureSeconds: number;
  /** 死亡后重生等待(秒) */
  respawnSeconds: number;
  /** 每 2 秒自然回复的魔力(标准:1) */
  manaRegenAmount: number;
  /** 每人使用资源补给站的冷却(秒,标准:20) */
  supplyCooldownSeconds: number;
  /** 受击反馈(红闪/音效/动画/方向击退),关闭后伤害无原版表现 */
  hurtFeedback: boolean;
}

/**
 * 内容层注册束:会话构造时传入。
 * 技能/状态用 Registry 注册模式(意见③);占点/补给是数据数组。
 */
export interface Snd5ContentBundle {
  skills: Registry<SkillDefinition>;
  statuses: Registry<StatusDefinition>;
  capturePoints?: readonly CapturePointDef[];
  supplyStations?: readonly SupplyStationDef[];
}

/** 默认三资源面板(内容层未提供装载时的兜底,对应标准面板) */
export const DEFAULT_BASE: ResourceTriple = { hp: 100, armor: 50, mana: 100 };

/** 归一化向量工具 */
export function normalizeVector(vector: { x: number; y: number; z: number }): {
  x: number;
  y: number;
  z: number;
} {
  const length = Math.sqrt(vector.x ** 2 + vector.y ** 2 + vector.z ** 2);
  if (length < 1e-6) return { x: 0, y: 0, z: 0 };
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}
