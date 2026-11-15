// ============================================================
// 回复类消耗品
// 血药 ×2 / 回复 80 生命 · 甲修 ×8 / 回复 25 护甲 · 魔瓶 ×4 / 回复 50 魔力
//
// 使用模型:
// - 触发:「物品使用完毕」(itemCompleteUse)结算 —— 吃完才生效,
//   中途松手不消耗不生效;原版自然消耗物品,背包数量回落,
//   补给站按携带上限继续补给(countCarried 语义天然成立)。
// - 使用时长:由物品定义承载 —— 占位阶段用原版可使用物品,
//   实际时长为原版物品自带时长;后续替换自定义物品
//   (use_duration 组件填设计值 6s/1.5s/3.5s)后无需改逻辑。
// - 结算:走 CombatPipeline.heal(受重伤 healingTakenMul ×0.8、
//   收束 healIntercept 记录改返还影响,与治疗技能同一管线)。
//
// 占位物品必须是右键可「使用」的原版物品(use_duration):
// 血药=甜浆果(可食用) / 甲修=面包(约 1.6s,最接近设计 1.5s) /
// 魔瓶=药水(水瓶占位,饮用无副作用;饮用后原版会返还玻璃瓶,属占位杂音)。
// 不可使用物品(铁锭/青金石等)无法触发 itemCompleteUse,不能占位。
// ============================================================
import type { MatchSession } from "../framework";

export interface ConsumableDefinition {
  id: string;
  displayName: string;
  /** 占位物品(原版可使用物品);替换自定义物品只改此字段 */
  itemTypeId: string;
  /** 设计使用时长(秒);占位阶段实际时长由原版物品决定 */
  designUseSeconds: number;
  /** 携带上限(与补给站配置一致,PDF 第 4 页) */
  maxCarry: number;
  /** 使用完毕的回复结算(走 CombatPipeline.heal) */
  payload: { amount?: number; mana?: number; armor?: number };
}

export const CONSUMABLE_BLOOD_POTION: ConsumableDefinition = {
  id: "snd5:consumable_blood_potion",
  displayName: "血药",
  itemTypeId: "minecraft:sweet_berries",
  designUseSeconds: 6,
  maxCarry: 2,
  payload: { amount: 80 },
};

export const CONSUMABLE_ARMOR_REPAIR: ConsumableDefinition = {
  id: "snd5:consumable_armor_repair",
  displayName: "甲修",
  itemTypeId: "minecraft:bread",
  designUseSeconds: 1.5,
  maxCarry: 8,
  payload: { armor: 25 },
};

export const CONSUMABLE_MANA_BOTTLE: ConsumableDefinition = {
  id: "snd5:consumable_mana_bottle",
  displayName: "魔瓶",
  itemTypeId: "minecraft:potion",
  designUseSeconds: 3.5,
  maxCarry: 4,
  payload: { mana: 50 },
};

export const CONSUMABLE_DEFINITIONS: readonly ConsumableDefinition[] = [
  CONSUMABLE_BLOOD_POTION,
  CONSUMABLE_ARMOR_REPAIR,
  CONSUMABLE_MANA_BOTTLE,
];

/** typeId → 定义(listeners itemCompleteUse 路由用) */
export const consumableItemBindings = new Map<string, ConsumableDefinition>();
for (const def of CONSUMABLE_DEFINITIONS) {
  consumableItemBindings.set(def.itemTypeId, def);
}

/**
 * 使用完毕(itemCompleteUse)结算:回复走治疗管线。
 * @param playerId 使用者(会话成员;非会话玩家由 listeners 侧拦截)
 */
export function handleConsumableComplete(
  session: MatchSession,
  playerId: string,
  def: ConsumableDefinition,
): void {
  const state = session.players.get(playerId);
  if (!state?.player.isValid || session.isDead(playerId)) return;
  const result = session.combat.heal(playerId, playerId, def.payload);
  if (!result) return;
  if (result.recorded) {
    session.hud.toast(state.player, "§7收束状态:回复已记录,效果结束后返还");
    return;
  }
  const parts: string[] = [];
  if (result.hp > 0) parts.push(`+${result.hp} 生命`);
  if (result.armor > 0) parts.push(`+${result.armor} 护甲`);
  if (result.mana > 0) parts.push(`+${result.mana} 魔力`);
  session.hud.toast(
    state.player,
    parts.length > 0
      ? `§a${def.displayName}: ${parts.join(" ")}`
      : `§7${def.displayName}无效(数值已满)`,
  );
}
