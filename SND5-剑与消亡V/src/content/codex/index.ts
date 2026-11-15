// ============================================================
// 秘典(内容层门面)
// import 即注册 10 个同名状态与 10 个法术技能;并注册
// nameTag → skillId 路由绑定(占位物品按名称区分)与启动期校验。
// ============================================================
import { skillRegistry } from "../../framework";
import { CODEX_SPELLS, codexItemNameTag } from "./spells";
import "./statuses";
import "./skills";

export { CODEX_SPELLS, codexItemLore, codexItemNameTag } from "./spells";
export type { CodexSpellMeta, CodexTier } from "./spells";

/** nameTag → skillId(可用态与耗尽态都注册;listeners 输入路由用) */
export const codexItemNameTags = new Map<string, string>();
for (const spell of CODEX_SPELLS) {
  codexItemNameTags.set(codexItemNameTag(spell.displayName, false), spell.skillId);
  codexItemNameTags.set(codexItemNameTag(spell.displayName, true), spell.skillId);
}

// 启动期校验:元数据表与技能注册严格一致(fail-fast)
for (const spell of CODEX_SPELLS) {
  const def = skillRegistry.require(spell.skillId);
  if (def.displayName !== spell.displayName) {
    throw new Error(`[SND5] 秘典元数据与技能定义 displayName 不一致: ${spell.skillId}`);
  }
  if (def.slot !== spell.tier) {
    throw new Error(`[SND5] 秘典元数据与技能定义 slot 不一致: ${spell.skillId}`);
  }
}
