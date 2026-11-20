// ============================================================
// SND5 内容层统一入口:import 即完成注册
// (职业 → 技能 → 状态 → 反应表 → 秘典;game.ts / listeners.ts import 本文件触发)
// 框架层不认识任何具体职业/技能;本文件是内容层唯一对外门面。
// ============================================================
import "./professions";
import "./skills/warrior";
import "./skills/tank";
import "./skills/support";
import "./skills/controller";
import "./skills/magus";
import "./skills/assassin";
import "./statuses/warrior";
import "./statuses/tank";
import "./statuses/support";
import "./statuses/controller";
import "./statuses/magus";
import "./statuses/assassin";
import "./codex";
import "./consumables";

export { professionRegistry } from "./professions/registry";
export type { ProfessionDefinition, ProfessionSkillEntry } from "./professions/registry";
export { warriorProfession } from "./professions/warrior";
export { tankProfession } from "./professions/tank";
export { supportProfession } from "./professions/support";
export { controllerProfession } from "./professions/controller";
export { magusProfession } from "./professions/magus";
export { assassinProfession } from "./professions/assassin";
export { tickGrapple } from "./skills/assassin";
export {
  getSelectedCodex,
  getSelectedProfessionId,
  handleSelectorUse,
  initProfessionSelection,
  SELECTOR_ITEM_TYPE,
} from "./selection";
export { CODEX_SPELLS, codexItemLore, codexItemNameTag, codexItemNameTags } from "./codex";
export type { CodexSpellMeta, CodexTier } from "./codex";
export { CONSUMABLE_DEFINITIONS, consumableItemBindings, handleConsumableComplete } from "./consumables";
export type { ConsumableDefinition } from "./consumables";
