// ============================================================
// 群法 ｜ 多属性 · 自循环 · AOE(内容设计 PDF 第 17-22 页)
// 面板 100/15/160;武器球型魔杖「周期」(自定义物品):
// - 轻击:6 点近战;携带魔力凝聚 → 「此为至纯魔力的一击」:
//   28 点 + 魔力残留 + 炸飞攻击者与受击者(凝聚消耗)。
// - 重击:不再走近战路由 —— weapon_heavy 伪技能直接绑定在
//   自定义武器上(长按右键弓式蓄力 1.4s,见 skills/magus.ts)。
// - 技能物品为自定义物品(snd5:magus_skill_1/2),定律类型由
//   物品名显示;释放走 ItemCustomComponent 组件回调。
// ============================================================
import { professionRegistry } from "./registry";
import {
  STATUS_MANA_CONDENSE,
  STATUS_MANA_RESIDUE,
} from "../statuses/magus";
import { MAGUS_WEAPON_ITEM, magusSkillItemBuild } from "../skills/magus";

const WEAPON_LIGHT_DAMAGE = 6;
const PURE_DAMAGE = 28;
const MELEE_MAX_DISTANCE_SQ = 25;

export const magusProfession = professionRegistry.register({
  id: "snd5:magus",
  displayName: "群法",
  tagline: "多属性 · 自循环 · AOE",
  base: { hp: 100, armor: 15, mana: 160 },
  available: true,
  weapon: {
    itemTypeId: MAGUS_WEAPON_ITEM,
    name: "§5球型魔杖·周期§r",
    lore: [
      "§7轻击: 6 点近战伤害",
      "§7魔力凝聚时轻击 → 至纯魔力的一击: 28 点+魔力残留+炸飞双方",
      "§7重击(长按右键蓄力): ¼圆6格 总量40点均摊 + 魔力残留",
      "§7潜行蓄力 → 魔力凝聚: 不攻击,下次轻击进阶",
    ],
  },
  skills: [
    { slot: "innate_1", skillId: "snd5:magus_innate_1", itemTypeId: "snd5:magus_skill_1" },
    { slot: "innate_2", skillId: "snd5:magus_innate_2", itemTypeId: "snd5:magus_skill_2" },
    // 重击绑定武器自身:game.ts 发放套装时不再重复发放物品
    { slot: "weapon_heavy", skillId: "snd5:magus_heavy", itemTypeId: MAGUS_WEAPON_ITEM },
  ],
  passiveIds: ["snd5:magus_mana_flesh"],

  // 技能物品名称随定律变化(物品名显示定律类型)
  buildSkillItem: (entry, session, playerId) => magusSkillItemBuild(entry, session, playerId),

  handleAttack(session, attackerId, victimId, _isSneaking) {
    // 重击为 weapon_heavy 伪技能(武器右键蓄力),近战路由只处理轻击
    const attacker = session.players.get(attackerId);
    const victim = session.players.get(victimId);
    if (!attacker?.alive || !victim?.alive) return;
    if (!attacker.player.isValid || !victim.player.isValid) return;
    const dx = attacker.player.location.x - victim.player.location.x;
    const dy = attacker.player.location.y - victim.player.location.y;
    const dz = attacker.player.location.z - victim.player.location.z;
    if (dx * dx + dy * dy + dz * dz > MELEE_MAX_DISTANCE_SQ) return;

    // 魔力凝聚 → 此为至纯魔力的一击:28 点 + 魔力残留 + 炸飞双方
    if (session.status.has(attackerId, STATUS_MANA_CONDENSE)) {
      session.status.remove(attackerId, STATUS_MANA_CONDENSE, "consumed");
      const result = session.combat.dealDamage(attackerId, victimId, {
        hp: PURE_DAMAGE,
        element: "physical",
        tags: ["weapon", "melee"],
      });
      if (result) {
        session.status.apply(victimId, STATUS_MANA_RESIDUE, attackerId);
        session.primitives.launch(victimId, 0.8); // 炸飞受击者
        session.primitives.launch(attackerId, 0.6); // 炸飞攻击者
      }
      return;
    }

    // 轻击:6 点近战
    session.combat.dealDamage(attackerId, victimId, {
      hp: WEAPON_LIGHT_DAMAGE,
      element: "physical",
      tags: ["weapon", "melee"],
    });
  },
});
