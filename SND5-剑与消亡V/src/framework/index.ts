// ============================================================
// SND5 框架层统一出口
// 内容层只允许 import 本文件(以及各模块的「类型」),
// 禁止 import @minecraft/server。
// ============================================================
export { EventBus, extractInvolvedIds } from "./events";
export type { Snd5EventMap, Snd5EventName } from "./events";
export { Registry, skillRegistry, statusRegistry } from "./registry";
export {
  DEFAULT_BASE,
  normalizeVector,
} from "./types";
export type {
  DamageElement,
  DamageTag,
  PlayerLoadout,
  ResourceTriple,
  Snd5ContentBundle,
  Snd5RuntimeConfig,
  SessionInjects,
  TeamId,
  TeamProvider,
} from "./types";

export { AttributeSystem } from "./attribute";
export type { ApplyDamageResult, AttributeSnapshot, AttributeState } from "./attribute";

export { StatusEffectSystem, STATUS_TICK_INTERVAL } from "./status/system";
export type {
  AggregatedMods,
  StatusContext,
  StatusDefinition,
  StatusDamageContext,
  StatusFlags,
  StatusInstance,
  StatusKind,
  StatusModifiers,
} from "./status/types";

export { CombatPipeline } from "./combat/pipeline";
export { reactionTable } from "./combat/reactions";
export type {
  DamagePayload,
  DamageResult,
  HealPayload,
  HealResult,
} from "./combat/types";
export type { ReactionBuildContext, ReactionDefinition, ReactionOutcome } from "./combat/reactions";

export { SkillSystem, skillItemBindings } from "./skill/system";
export { PassiveManager } from "./skill/passives";
export { Primitives } from "./skill/primitives";
export { CooldownStore, StackStore, skillKey } from "./skill/stores";
export { normalizeCastResult } from "./skill/types";
export type {
  CastContext,
  CastFailReason,
  CastMode,
  CastOutcome,
  CastResult,
  ChargeConfig,
  CooldownBranchName,
  CooldownBranches,
  CooldownSpec,
  PassiveContext,
  SkillDefinition,
  SkillSlot,
} from "./skill/types";

export { SummonSystem, SUMMON_TAG } from "./summon";
export type { ProjectileOptions, SummonInstance, SummonOptions } from "./summon";

export { ScoreSystem } from "./score";
export type { ScoreRuleDef } from "./score";
export { CaptureSystem } from "./capture";
export type { CapturePointDef, CapturePointState } from "./capture";
export { SupplySystem } from "./supply";
export type { SupplyItemDef, SupplyStationDef } from "./supply";

export { HudBridge } from "./hud";
export { MatchSession, sessions } from "./session";
export type { PlayerState } from "./session";
