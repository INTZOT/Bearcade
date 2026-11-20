// ============================================================
// 坦克 ｜ 火属性 · 创生物 · 减伤(内容设计 PDF 第 9-10 页)
// 面板 120/70/90;武器阔剑「征服」(自定义物品 snd5:tank_weapon):
// - 轻击:8 点近战(handleAttack 路由);
// - 重击:weapon_heavy 伪技能(长按右键蓄力,直线矩形劈砍,
//   蓄力/磐石/熔火积攒见 skills/tank.ts);
// - 固有Ⅰ 固态火焰(投掷物 6 格/秒)/ 固有Ⅱ 焚天斩(长按蓄力 2 秒)/
//   固有Ⅲ 磐石壁垒(被动)。
// ============================================================
import { professionRegistry } from "./registry";
import type { SkillItemAppearance } from "./registry";
import { TANK_SKILL_ITEMS, TANK_WEAPON_ITEM } from "../skills/tank";

const WEAPON_LIGHT_DAMAGE = 8;
/** 近战触达保险距离(格) */
const MELEE_MAX_DISTANCE_SQ = 25;

/** 技能物品说明(默认命名只写「右键施放」,蓄力/投掷类需要准确描述) */
const SKILL_ITEM_LORE: Record<"innate_1" | "innate_2", SkillItemAppearance> = {
  innate_1: {
    name: "§e固态火焰§r",
    lore: [
      "§7右键施放: 15 魔力 / 18 秒 · 堆叠 3",
      "§7发射投掷物(6 格/秒),落地或命中即爆炸",
      "§7半径 3 格内敌方 10 点火元素伤害 + 炸飞",
      "§7落点生成凝固熔岩(岩浆块 3×3×3,15 秒后消失)",
      "§8被引爆: 以熔岩为中心 6 格 10 点火伤 + 熔火",
    ],
  },
  innate_2: {
    name: "§e焚天斩§r",
    lore: [
      "§7长按右键蓄力 2 秒,蓄满才能释放: 25 魔力 / 22 秒",
      "§8中途松手蓄力清零(退还魔力,不进冷却)",
      "§7三段圆形斩击: 半径 5/7/9 · 伤害 10/15/20 · 每 0.5 秒一斩",
      "§7击飞范围内敌方并施加焚烬(受火伤 3 秒内额外 3×2 点)",
      "§7同时引爆范围内所有凝固熔岩",
    ],
  },
};

export const tankProfession = professionRegistry.register({
  id: "snd5:tank",
  displayName: "坦克",
  tagline: "火属性 · 创生物 · 减伤",
  base: { hp: 120, armor: 70, mana: 90 },
  available: true,
  weapon: {
    itemTypeId: TANK_WEAPON_ITEM,
    name: "§c阔剑·征服§r",
    lore: [
      "§7轻击: 8 点近战伤害",
      "§7重击(长按右键蓄力): 直线矩形劈砍,距离 1~10 格/伤害 10~30 + 击飞",
      "§7潜行蓄力: 每 0.5 秒消耗 1 魔力 +1 层磐石(每层抵消 1 点伤害)",
      "§7携带磐石时重击转化为火元素伤害;蓄力结束清空磐石",
    ],
  },
  skills: [
    { slot: "innate_1", skillId: "snd5:tank_solid_flame", itemTypeId: TANK_SKILL_ITEMS.innate_1 },
    { slot: "innate_2", skillId: "snd5:tank_ember_slash", itemTypeId: TANK_SKILL_ITEMS.innate_2 },
    // 重击绑定武器自身:game.ts 发放套装时不再重复发放物品
    { slot: "weapon_heavy", skillId: "snd5:tank_heavy", itemTypeId: TANK_WEAPON_ITEM },
  ],
  passiveIds: ["snd5:tank_bulwark_passive"],

  // 技能物品外观:蓄力/投掷类使用准确的操作说明(SKILL_ITEM_LORE)
  buildSkillItem(entry) {
    if (entry.slot === "innate_1" || entry.slot === "innate_2") {
      return SKILL_ITEM_LORE[entry.slot];
    }
    return undefined;
  },

  // 重击为 weapon_heavy 伪技能(武器右键蓄力),近战路由只处理轻击
  handleAttack(session, attackerId, victimId, _isSneaking) {
    const attacker = session.players.get(attackerId);
    const victim = session.players.get(victimId);
    if (!attacker?.alive || !victim?.alive) return;
    if (!attacker.player.isValid || !victim.player.isValid) return;
    const dx = attacker.player.location.x - victim.player.location.x;
    const dy = attacker.player.location.y - victim.player.location.y;
    const dz = attacker.player.location.z - victim.player.location.z;
    if (dx * dx + dy * dy + dz * dz > MELEE_MAX_DISTANCE_SQ) return;
    session.combat.dealDamage(attackerId, victimId, {
      hp: WEAPON_LIGHT_DAMAGE,
      element: "physical",
      tags: ["weapon", "melee"],
    });
  },
});
