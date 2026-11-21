// ============================================================
// 单法 ｜ 全属性 · 远射程 · 时间回溯(内容设计 PDF 第 22-25 页)
// 面板 30/100/150;武器环型魔杖「日月」(自定义物品):
// - 轻击:3 点近战;重击不走近战路由 —— weapon_heavy 伪技能直接
//   绑定在自定义武器上(长按右键弓式蓄力 1s,见 skills/ranger.ts),
//   宽 1 格光束 + ¼ 圆溅射,携带境界面强化时进阶并附加收束。
// - 技能物品为自定义物品(snd5:ranger_skill_1/2),释放走
//   ItemCustomComponent 组件回调;时光种子/变量αβ/寻光信标为
//   盔甲架占位实体。
// ============================================================
import { professionRegistry } from "./registry";
import { skillRegistry } from "../../framework";
import { RANGER_WEAPON_ITEM } from "../skills/ranger";

const WEAPON_LIGHT_DAMAGE = 3;
/** 近战触达保险距离(格),与战士/增益/控制一致 */
const MELEE_MAX_DISTANCE_SQ = 25;

/** 技能物品说明(按槽位区分:固有Ⅰ 时光种子,固有Ⅱ 加强攻击) */
function skillItemLore(slot: string): string[] | undefined {
  if (slot === "innate_1") {
    return [
      "§7固有Ⅰ · 右键施放",
      "§8发射时光种子(每秒 8 格,飞行 2 秒)",
      "§8命中敌人记录双方状态,3 秒后判定时间回溯",
      "§8未命中不进冷却;命中进 16 秒冷却",
    ];
  }
  if (slot === "innate_2") {
    return [
      "§7固有Ⅱ · 右键施放",
      "§8下次重击进阶「境界面上的#%¥&$#」",
      "§8施加 1 层日蚀(远点概率 +25%)",
      "§8潜行施放: 改为施加 1 层月冕(概率 −25%)",
    ];
  }
  return undefined;
}

export const rangerProfession = professionRegistry.register({
  id: "snd5:ranger",
  displayName: "单法",
  tagline: "全属性 · 远射程 · 时间回溯",
  base: { hp: 30, armor: 100, mana: 150 },
  available: true,
  weapon: {
    itemTypeId: RANGER_WEAPON_ITEM,
    name: "§d环型魔杖·日月§r",
    lore: [
      "§7轻击: 3 点近战伤害",
      "§7重击(长按右键蓄力): 宽1格光束最远24格",
      "§7命中第一个敌人 24 点本源伤害+¼圆2格溅射 4 点",
      "§7境界面强化 → 30格/30点+收束+¼圆4格溅射2点,叠日蚀/月冕",
    ],
  },
  skills: [
    { slot: "innate_1", skillId: "snd5:ranger_time_seed", itemTypeId: "snd5:ranger_skill_1" },
    { slot: "innate_2", skillId: "snd5:ranger_empower", itemTypeId: "snd5:ranger_skill_2" },
    // 重击绑定武器自身:game.ts 发放套装时不再重复发放物品
    { slot: "weapon_heavy", skillId: "snd5:ranger_heavy", itemTypeId: RANGER_WEAPON_ITEM },
  ],
  passiveIds: ["snd5:ranger_light_beacon"],

  // 技能物品说明:按槽位覆写(时光种子/加强攻击的操作差异)
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

    // 轻击:3 点近战
    session.combat.dealDamage(attackerId, victimId, {
      hp: WEAPON_LIGHT_DAMAGE,
      element: "physical",
      tags: ["weapon", "melee"],
    });
  },
});
