// ============================================================
// 职业定义与注册表(内容层)
// 职业不进框架 Registry 单例,由内容层自持 —— 框架仍不认识职业。
// handleAttack 承接近战武器结算(轻击/重击数值与附加效果),
// 占位判定约定(2026-11 确认):轻击=普通命中;重击=潜行+命中。
// ============================================================
import { Registry } from "../../framework";
import type { MatchSession, ResourceTriple } from "../../framework";

export interface ProfessionSkillEntry {
  slot: "innate_1" | "innate_2" | "weapon_heavy";
  skillId: string;
  /** 施放入口的物品;原版职业用原版占位,自定义物品职业用 items/*.json 的 typeId */
  itemTypeId: string;
}

/** buildSkillItem 的返回:技能物品的名称与说明(缺省 = 框架默认命名) */
export interface SkillItemAppearance {
  name: string;
  lore: string[];
}

export interface ProfessionDefinition {
  id: string;
  displayName: string;
  /** 定位标签(选择界面第二行展示,如「电属性 · 连锁伤害 · 吸血」) */
  tagline: string;
  base: ResourceTriple;
  /** 是否已实装;false 时选择界面不可选 */
  available: boolean;
  weapon: {
    itemTypeId: string;
    name: string;
    lore: string[];
  };
  skills: ProfessionSkillEntry[];
  passiveIds: string[];
  /**
   * 自定义物品职业的技能物品构建钩子(名称随会话内运行时状态变化,
   * 如群法的定律显示)。未定义时使用默认命名(§e技能名 + 槽位说明)。
   * 注意:weapon_heavy 绑定武器自身时(itemTypeId === weapon.itemTypeId)
   * 不重复发放物品,本钩子不会被调用。
   */
  buildSkillItem?(
    entry: ProfessionSkillEntry,
    session: MatchSession,
    playerId: string,
  ): SkillItemAppearance | undefined;
  /**
   * 近战武器结算(由 listeners entityHitEntity 路由,原版伤害已取消)。
   * 同队攻击在此前被 game.ts 拦截,这里只处理敌我判定后的数值。
   */
  handleAttack?(
    session: MatchSession,
    attackerId: string,
    victimId: string,
    isSneaking: boolean,
  ): void;
}

export const professionRegistry = new Registry<ProfessionDefinition>("profession");
