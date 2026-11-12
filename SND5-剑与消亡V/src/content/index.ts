// ============================================================
// SND5 内容层统一入口:import 即完成注册
// (职业 → 技能 → 状态 → 反应表;game.ts / listeners.ts import 本文件触发)
// 框架层不认识任何具体职业/技能;本文件是内容层唯一对外门面。
// ============================================================
import "./professions";
import "./skills/warrior";
import "./statuses/warrior";

export { professionRegistry } from "./professions/registry";
export type { ProfessionDefinition, ProfessionSkillEntry } from "./professions/registry";
export { warriorProfession } from "./professions/warrior";
export {
  getSelectedProfessionId,
  handleSelectorUse,
  initProfessionSelection,
  SELECTOR_ITEM_TYPE,
} from "./selection";
