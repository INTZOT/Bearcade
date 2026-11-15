// ============================================================
// 增益 ｜ 水属性 · 治疗 · 净化(内容设计 PDF 第 11-14 页)
// 面板 140/20/120;武器「梭型魔杖·水仙之梦」:轻击 5 点近战。
// 重击不走近战路由 —— 是 weapon_heavy 伪技能(spyglass 蓄力,
// 见 skills/support.ts),占位物品均为原版且互不冲突:
// - wooden_sword 轻击(无使用动作,不会误触技能)
// - fishing_rod 固有Ⅰ(浮漂落水,水系彩蛋)
// - shield 固有Ⅱ(前摇期间举盾,贴近"引导屏障"意象)
// - spyglass 重击蓄力(按住右键 0.8 秒,自带缩放瞄准)
// ============================================================
import { professionRegistry } from "./registry";
import { skillItemBindings } from "../../framework";
import type { MatchSession } from "../../framework";

const WEAPON_LIGHT_DAMAGE = 5;
/** 近战触达保险距离(格),与战士一致 */
const MELEE_MAX_DISTANCE_SQ = 25;

/** 轻击:5 点近战(物理);潜行不改变轻击(重击在 spyglass 上) */
function lightAttack(session: MatchSession, attackerId: string, victimId: string): void {
  session.combat.dealDamage(attackerId, victimId, {
    hp: WEAPON_LIGHT_DAMAGE,
    element: "physical",
    tags: ["weapon", "melee"],
  });
}

export const supportProfession = professionRegistry.register({
  id: "snd5:support",
  displayName: "增益",
  tagline: "水属性 · 治疗 · 净化",
  base: { hp: 140, armor: 20, mana: 120 },
  available: true,
  weapon: {
    itemTypeId: "minecraft:wooden_sword",
    name: "§b梭型魔杖·水仙之梦§r",
    lore: [
      "§7轻击: 5 点近战伤害",
      "§7重击(占位: spyglass 按住右键蓄力): 视准心半径2格 12 点水伤 + 友方清流",
      "§7潜行蓄力 → 晨露对光的独白: 半径 5 格,正面层数加伤均摊,负面层数回魔",
    ],
  },
  skills: [
    { slot: "innate_1", skillId: "snd5:gain_refresh", itemTypeId: "minecraft:fishing_rod" },
    { slot: "innate_2", skillId: "snd5:gain_blessing", itemTypeId: "minecraft:shield" },
    { slot: "weapon_heavy", skillId: "snd5:gain_heavy_attack", itemTypeId: "minecraft:spyglass" },
  ],
  passiveIds: ["snd5:gain_narcissus_passive"],

  handleAttack(session, attackerId, victimId, _isSneaking) {
    // 重击为 weapon_heavy 伪技能(spyglass 蓄力),近战路由只处理轻击
    const attacker = session.players.get(attackerId);
    const victim = session.players.get(victimId);
    if (!attacker?.alive || !victim?.alive) return;
    if (!attacker.player.isValid || !victim.player.isValid) return;
    const dx = attacker.player.location.x - victim.player.location.x;
    const dy = attacker.player.location.y - victim.player.location.y;
    const dz = attacker.player.location.z - victim.player.location.z;
    if (dx * dx + dy * dy + dz * dz > MELEE_MAX_DISTANCE_SQ) return;
    lightAttack(session, attackerId, victimId);
  },
});

// 占位物品 → 技能绑定(右键路由)
for (const entry of supportProfession.skills) {
  skillItemBindings.set(entry.itemTypeId, entry.skillId);
}
