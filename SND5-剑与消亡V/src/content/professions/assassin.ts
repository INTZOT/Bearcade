// ============================================================
// 刺客 ｜ 高移速 · DOT · 破甲(内容设计 PDF 第 5-6 页)
// 面板 70/30/70;武器横刀「离心」(自定义物品):
// - 轻击:10 点近战(惯性加成在此结算);
//   重击不走近战路由 —— weapon_heavy 伪技能直接绑定在自定义武器上
//   (长按右键弓式蓄力 0.5s,见 skills/assassin.ts),半径 3 格半圆
//   18 点 + 击碎 20% 护甲上限(惯性加成同样在重击结算)。
// - 技能物品为自定义物品(snd5:assassin_skill_1/2),释放走
//   ItemCustomComponent 组件回调;抓钩(锁定+摆荡+潜行收绳,Grappling
//   Hooks Add-On 方案)/定锚为盔甲架占位实体。
// ============================================================
import { professionRegistry } from "./registry";
import { skillRegistry } from "../../framework";
import { ASSASSIN_WEAPON_ITEM, consumeInertia, toastInertia } from "../skills/assassin";
import { STATUS_LACERATION } from "../statuses/assassin";

const WEAPON_LIGHT_DAMAGE = 10;
/** 近战触达保险距离(格),与战士/控制一致 */
const MELEE_MAX_DISTANCE_SQ = 25;

/** 技能物品说明(按槽位区分) */
function skillItemLore(slot: string): string[] | undefined {
  if (slot === "innate_1") {
    return [
      "§7固有Ⅰ · 右键发射;潜行收绳;潜行+右键松开",
      "§8钩命中方块后锁定,进入钟摆摆荡(可荡可悬停)",
      "§8潜行收绳拉自己(25 格/秒),抵达弹起并回收;飞行中右键重射",
      "§8命中玩家: 7 点伤害 + 牵拉 2 秒 + 撕裂;锁定后每 0.5s 叠 1 层惯性",
    ];
  }
  if (slot === "innate_2") {
    return [
      "§7固有Ⅱ · 右键投掷,再次点击瞬移劈砍",
      "§8雪球抛出定锚(约 6 格): 命中敌方停驻,5 点伤害 + 撕裂,不进冷却",
      "§8定锚驻场 6 秒后消失(进 9 秒冷却);飞行中点击无效",
      "§8二段: 瞬移至锚点,半径3半圆 30 点 + 击碎 40% 护甲上限(进 18 秒冷却)",
    ];
  }
  return undefined;
}

export const assassinProfession = professionRegistry.register({
  id: "snd5:assassin",
  displayName: "刺客",
  tagline: "高移速 · DOT · 破甲",
  base: { hp: 70, armor: 30, mana: 70 },
  available: true,
  weapon: {
    itemTypeId: ASSASSIN_WEAPON_ITEM,
    name: "§7横刀·离心§r",
    lore: [
      "§7轻击: 10 点近战伤害",
      "§7重击(长按右键蓄力 0.5 秒): 半径3格半圆 18 点,额外击碎 20% 护甲上限",
      "§8惯性(抓钩叠层): 下次攻击伤害 +10/15/20%(1/2/3 层);4 层附加撕裂",
    ],
  },
  skills: [
    { slot: "innate_1", skillId: "snd5:assassin_grapple", itemTypeId: "snd5:assassin_skill_1" },
    { slot: "innate_2", skillId: "snd5:assassin_anchor", itemTypeId: "snd5:assassin_skill_2" },
    // 重击绑定武器自身:game.ts 发放套装时不再重复发放物品
    { slot: "weapon_heavy", skillId: "snd5:assassin_heavy", itemTypeId: ASSASSIN_WEAPON_ITEM },
  ],
  passiveIds: ["snd5:assassin_shadow_step"],

  // 技能物品说明:抓钩/定锚的行为较长,按槽位覆写默认文案
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

    // 轻击:10 点近战,消耗「下一次攻击」惯性加成(4 层附加撕裂)
    const inertia = consumeInertia(session, attackerId);
    toastInertia(session, attackerId, inertia);
    const damage = Math.max(1, Math.round(WEAPON_LIGHT_DAMAGE * inertia.damageMul));
    const result = session.combat.dealDamage(attackerId, victimId, {
      hp: damage,
      element: "physical",
      tags: ["weapon", "melee"],
    });
    if (result && inertia.applyLaceration) {
      session.status.apply(victimId, STATUS_LACERATION, attackerId);
    }
  },
});
