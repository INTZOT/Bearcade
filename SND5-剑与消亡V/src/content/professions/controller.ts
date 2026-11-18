// ============================================================
// 控制 ｜ 水属性 · 控制 · 清效果(内容设计 PDF 第 14-17 页)
// 面板 70/70/140;武器筒型魔杖「不等式」(自定义物品):
// - 轻击:5 点近战;重击不走近战路由 —— weapon_heavy 伪技能直接
//   绑定在自定义武器上(长按右键弓式蓄力 1.7s,见 skills/controller.ts),
//   潜行释放回收浊露进阶「水的两面性」。
// - 技能物品为自定义物品(snd5:controller_skill_1/2),释放走
//   ItemCustomComponent 组件回调;魔瘴之泉/固体灵魂为盔甲架占位实体。
// ============================================================
import { professionRegistry } from "./registry";
import { skillRegistry } from "../../framework";
import { CONTROLLER_WEAPON_ITEM } from "../skills/controller";

const WEAPON_LIGHT_DAMAGE = 5;
/** 近战触达保险距离(格),与战士/增益一致 */
const MELEE_MAX_DISTANCE_SQ = 25;

/** 技能物品说明(按槽位区分:固有Ⅰ 右键施放,固有Ⅱ 长按吟唱) */
function skillItemLore(slot: string): string[] | undefined {
  if (slot === "innate_1") {
    return [
      "§7固有Ⅰ · 右键施放",
      "§8原地放置魔瘴之泉(可被破坏,60 血)并前移 3 格",
      "§8泉水每 3 秒对 5 格内敌方泼洒 1 层浊露",
    ];
  }
  if (slot === "innate_2") {
    return [
      "§7固有Ⅱ · 长按吟唱,松手停止",
      "§8每秒 2 魔力;圆心朝准星缓慢移动(最远 8 格)",
      "§8对圆心 6 格内敌方施加魔魇降临,50 层掉落固体灵魂",
    ];
  }
  return undefined;
}

export const controllerProfession = professionRegistry.register({
  id: "snd5:controller",
  displayName: "控制",
  tagline: "水属性 · 控制 · 清效果",
  base: { hp: 70, armor: 70, mana: 140 },
  available: true,
  weapon: {
    itemTypeId: CONTROLLER_WEAPON_ITEM,
    name: "§b筒型魔杖·不等式§r",
    lore: [
      "§7轻击: 5 点近战伤害",
      "§7重击(长按右键蓄力): ¼圆6格 10点水伤,随距离衰减",
      "§7潜行蓄力 → 水的两面性: 回收6格内敌方浊露,¼圆8格伤害+1/层",
      "§8对魔魇噬魂目标附加 5 秒失明",
    ],
  },
  skills: [
    { slot: "innate_1", skillId: "snd5:controller_spring", itemTypeId: "snd5:controller_skill_1" },
    { slot: "innate_2", skillId: "snd5:controller_nightmare", itemTypeId: "snd5:controller_skill_2" },
    // 重击绑定武器自身:game.ts 发放套装时不再重复发放物品
    { slot: "weapon_heavy", skillId: "snd5:controller_heavy", itemTypeId: CONTROLLER_WEAPON_ITEM },
  ],
  passiveIds: ["snd5:controller_mana_shield"],

  // 技能物品说明:固有Ⅱ为吟唱入口,默认「右键施放」文案不准确,按槽位覆写
  buildSkillItem(entry) {
    const lore = skillItemLore(entry.slot);
    if (!lore) return undefined;
    const name = skillRegistry.get(entry.skillId)?.displayName ?? entry.slot;
    return { name: `§e${name}§r`, lore };
  },

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

    // 轻击:5 点近战
    session.combat.dealDamage(attackerId, victimId, {
      hp: WEAPON_LIGHT_DAMAGE,
      element: "physical",
      tags: ["weapon", "melee"],
    });
  },
});
