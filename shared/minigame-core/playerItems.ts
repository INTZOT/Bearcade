import {
  EquipmentSlot,
  EntityComponentTypes,
  type EntityEquippableComponent,
  type EntityInventoryComponent,
  type Player,
} from "@minecraft/server";

/** 清空玩家全套物品(背包/快捷栏全部槽位 + 盔甲 + 副手),对局结束清理用 */
export function clearAllPlayerItems(player: Player): void {
  const inventory = player.getComponent(
    EntityComponentTypes.Inventory,
  ) as EntityInventoryComponent | undefined;
  if (inventory?.container) {
    for (let slot = 0; slot < inventory.container.size; slot++) {
      inventory.container.setItem(slot, undefined);
    }
  }
  const equippable = player.getComponent(
    EntityComponentTypes.Equippable,
  ) as EntityEquippableComponent | undefined;
  if (equippable) {
    equippable.setEquipment(EquipmentSlot.Head, undefined);
    equippable.setEquipment(EquipmentSlot.Chest, undefined);
    equippable.setEquipment(EquipmentSlot.Legs, undefined);
    equippable.setEquipment(EquipmentSlot.Feet, undefined);
    equippable.setEquipment(EquipmentSlot.Offhand, undefined);
  }
}
