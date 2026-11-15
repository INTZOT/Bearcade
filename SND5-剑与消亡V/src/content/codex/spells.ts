// ============================================================
// 秘典法术元数据(内容设计 PDF 第 26-27 页)
// 纯数据表:准备阶段选择表单、开局发装与占位物品绑定共用;
// 与 skills.ts 的注册 id/displayName/slot 在 index.ts 启动期校验一致(fail-fast)。
// 占位物品约定:右键可触发且无副作用的原版物品循环复用,
// 靠 nameTag(可用态/耗尽态)区分路由;后续替换自定义物品只改本表。
// ============================================================

export type CodexTier = "codex_1" | "codex_2";

export interface CodexSpellMeta {
  tier: CodexTier;
  skillId: string;
  displayName: string;
  /** 选择表单里的简述 */
  tagline: string;
  /** 占位物品(原版) */
  itemTypeId: string;
}

export const CODEX_SPELLS: readonly CodexSpellMeta[] = [
  // ── 秘典Ⅰ ───────────────────────────────────────────────────
  {
    tier: "codex_1",
    skillId: "snd5:codex_ember_ash",
    displayName: "燃灰",
    tagline: "投掷烟雾弹,落点烟雾持续 7 秒",
    itemTypeId: "minecraft:warped_fungus_on_a_stick",
  },
  {
    tier: "codex_1",
    skillId: "snd5:codex_vanish",
    displayName: "匿迹",
    tagline: "自身隐身 8 秒",
    itemTypeId: "minecraft:spyglass",
  },
  {
    tier: "codex_1",
    skillId: "snd5:codex_quake",
    displayName: "地震",
    tagline: "击飞半径 3 格内所有角色(含自身)",
    itemTypeId: "minecraft:carrot_on_a_stick",
  },
  {
    tier: "codex_1",
    skillId: "snd5:codex_armor_crush",
    displayName: "碎甲",
    tagline: "5 秒内对甲伤害提升 50%",
    itemTypeId: "minecraft:warped_fungus_on_a_stick",
  },
  {
    tier: "codex_1",
    skillId: "snd5:codex_blitz",
    displayName: "闪袭",
    tagline: "向视角方向位移 6 格",
    itemTypeId: "minecraft:carrot_on_a_stick",
  },
  // ── 秘典Ⅱ ───────────────────────────────────────────────────
  {
    tier: "codex_2",
    skillId: "snd5:codex_beacon",
    displayName: "信标",
    tagline: "放置 10 秒部署点,可供 3 人部署",
    itemTypeId: "minecraft:warped_fungus_on_a_stick",
  },
  {
    tier: "codex_2",
    skillId: "snd5:codex_blessing",
    displayName: "护佑",
    tagline: "获得持续 10 秒的 30 点临时护甲",
    itemTypeId: "minecraft:carrot_on_a_stick",
  },
  {
    tier: "codex_2",
    skillId: "snd5:codex_mana_tide",
    displayName: "溪源",
    tagline: "6 秒内回复 60 点魔力值",
    itemTypeId: "minecraft:warped_fungus_on_a_stick",
  },
  {
    tier: "codex_2",
    skillId: "snd5:codex_healing_wave",
    displayName: "疗愈",
    tagline: "5 秒内回复 30 点生命值",
    itemTypeId: "minecraft:carrot_on_a_stick",
  },
  {
    tier: "codex_2",
    skillId: "snd5:codex_field_repair",
    displayName: "紧急维修",
    tagline: "2 秒内回复 40 点护甲值",
    itemTypeId: "minecraft:spyglass",
  },
];

// ── 物品名称约定(可用态/耗尽态) ───────────────────────────────

/** 可用态高亮名称;耗尽态灰名标注(玩家与补给站都以此辨识) */
export function codexItemNameTag(displayName: string, exhausted: boolean): string {
  return exhausted ? `§8${displayName}·已耗尽§r` : `§e${displayName}§r`;
}

export function codexItemLore(tier: CodexTier, exhausted: boolean): string[] {
  if (exhausted) return ["§8已耗尽 · 前往资源补给站补充§r"];
  const tierLabel = tier === "codex_1" ? "秘典Ⅰ" : "秘典Ⅱ";
  return [`§7${tierLabel} · 右键施放`, "§8用完后在资源补给站补充"];
}
