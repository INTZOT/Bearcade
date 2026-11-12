// ============================================================
// 战士 ｜ 电属性 · 连锁伤害 · 吸血(内容设计 PDF 第 7-8 页)
// 面板 100/50/100;武器长剑「弧光」:轻击 7 近战,
// 重击(占位:潜行+攻击)半径 3 格半圆 12 点 + 重伤。
// ============================================================
import { professionRegistry } from "./registry";
import { skillItemBindings } from "../../framework";
import type { MatchSession } from "../../framework";
import {
  STATUS_CURRENT_BURST,
  STATUS_CURRENT_SURGE,
  STATUS_GRIEVOUS_WOUND,
  STATUS_ZERO_FIRE,
} from "../statuses/warrior";

const WEAPON_LIGHT_DAMAGE = 7;
const WEAPON_HEAVY_DAMAGE = 12;
const WEAPON_HEAVY_RADIUS = 3;
/** 近战触达保险距离(格) */
const MELEE_MAX_DISTANCE_SQ = 25;

/** 轻击:7 点近战;电流涌动/迸发期间轻击获得电元素附魔 */
function lightAttack(session: MatchSession, attackerId: string, victimId: string): void {
  const surging =
    session.status.has(attackerId, STATUS_CURRENT_SURGE) ||
    session.status.has(attackerId, STATUS_CURRENT_BURST);
  const result = session.combat.dealDamage(attackerId, victimId, {
    hp: WEAPON_LIGHT_DAMAGE,
    element: surging ? "electric" : "physical",
    tags: ["weapon", "melee"],
  });
  if (!result) return;
  // 电流迸发:轻击附加零火,命中回复 3 点
  if (session.status.has(attackerId, STATUS_CURRENT_BURST)) {
    session.status.apply(victimId, STATUS_ZERO_FIRE, attackerId);
    session.combat.heal(attackerId, attackerId, { amount: 3 });
  }
}

/** 重击:半径 3 格半圆 12 点(所有敌方),并施加重伤 */
function heavyAttack(session: MatchSession, attackerId: string): void {
  const attacker = session.players.get(attackerId);
  if (!attacker?.player.isValid) return;
  const location = attacker.player.location;
  const myTeam = session.teams.getTeam(attackerId);
  const outcome = session.primitives.dealSectorDamage(
    attackerId,
    { x: location.x, y: location.y, z: location.z },
    attacker.player.getViewDirection(),
    WEAPON_HEAVY_RADIUS,
    180,
    { hp: WEAPON_HEAVY_DAMAGE, element: "physical", tags: ["weapon", "melee", "sweep"] },
    (state) => state.id !== attackerId && session.teams.getTeam(state.id) !== myTeam,
  );
  for (const targetId of outcome.targets) {
    session.status.apply(targetId, STATUS_GRIEVOUS_WOUND, attackerId);
  }
}

export const warriorProfession = professionRegistry.register({
  id: "snd5:warrior",
  displayName: "战士",
  tagline: "电属性 · 连锁伤害 · 吸血",
  base: { hp: 100, armor: 50, mana: 100 },
  available: true,
  weapon: {
    itemTypeId: "minecraft:iron_sword",
    name: "§b长剑·弧光§r",
    lore: [
      "§7轻击: 7 点近战伤害",
      "§7重击(占位: 潜行+攻击): 半径3格半圆 12 点 + 重伤",
    ],
  },
  skills: [
    { slot: "innate_1", skillId: "snd5:warrior_leap_slash", itemTypeId: "minecraft:carrot_on_a_stick" },
    { slot: "innate_2", skillId: "snd5:warrior_ball_lightning", itemTypeId: "minecraft:warped_fungus_on_a_stick" },
  ],
  passiveIds: ["snd5:warrior_storm_passive"],

  handleAttack(session, attackerId, victimId, isSneaking) {
    const attacker = session.players.get(attackerId);
    const victim = session.players.get(victimId);
    if (!attacker?.alive || !victim?.alive) return;
    if (!attacker.player.isValid || !victim.player.isValid) return;
    const dx = attacker.player.location.x - victim.player.location.x;
    const dy = attacker.player.location.y - victim.player.location.y;
    const dz = attacker.player.location.z - victim.player.location.z;
    if (dx * dx + dy * dy + dz * dz > MELEE_MAX_DISTANCE_SQ) return;
    if (isSneaking) heavyAttack(session, attackerId);
    else lightAttack(session, attackerId, victimId);
  },
});

// 占位物品 → 技能绑定(右键路由)
for (const entry of warriorProfession.skills) {
  skillItemBindings.set(entry.itemTypeId, entry.skillId);
}
