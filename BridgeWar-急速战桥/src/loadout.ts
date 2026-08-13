import {
  world,
  system,
  EquipmentSlot,
  type Entity,
  type Player,
  type VanillaEntityIdentifier,
} from "@minecraft/server";
import { TEMPLATE_DIMENSION_ID } from "./config";

const DUMMY_TYPE = "bearcade:loadout_dummy";
const INVENTORY_SLOTS = 36;
const SLOT_HELMET = 36;
const SLOT_CHEST = 37;
const SLOT_LEGGINGS = 38;
const SLOT_BOOTS = 39;
const SLOT_OFFHAND = 40;

type Team = "red" | "blue";

function teamTag(team: Team): string {
  return team === "red" ? "bearcade:bw_red_loadout" : "bearcade:bw_blue_loadout";
}

function loadoutEntity(team: Team): Entity | undefined {
  const dimension = world.getDimension(TEMPLATE_DIMENSION_ID);
  return dimension
    .getEntities({ type: DUMMY_TYPE })
    .find((entity) => entity.nameTag === teamTag(team));
}

export function ensureLoadoutEntities(): void {
  const dimension = world.getDimension(TEMPLATE_DIMENSION_ID);
  const spawnAll = (): void => {
    for (const team of ["red", "blue"] as const) {
      if (loadoutEntity(team)) continue;
      const entity = dimension.spawnEntity(
        DUMMY_TYPE as VanillaEntityIdentifier,
        {
          x: 0,
          y: -60,
          z: team === "red" ? -1 : 1,
        },
      );
      entity.nameTag = teamTag(team);
    }
  };

  // 模板维度区块在 worldLoad 初期可能尚未加载,延迟重试
  let remaining = 30;
  const trySpawn = (): void => {
    try {
      spawnAll();
    } catch (error) {
      if (remaining > 0) {
        remaining--;
        system.runTimeout(trySpawn, 40);
      } else {
        console.warn(
          "[Bearcade bridgewar] 装备仓库实体生成失败",
          error,
        );
      }
    }
  };
  trySpawn();
}

export function saveLoadout(team: Team, player: Player): boolean {
  const entity = loadoutEntity(team);
  if (!entity) return false;
  const container = entity.getComponent("minecraft:inventory") as
    | import("@minecraft/server").EntityInventoryComponent
    | undefined;
  const playerInventory = player.getComponent("minecraft:inventory") as
    | import("@minecraft/server").EntityInventoryComponent
    | undefined;
  const equippable = player.getComponent("minecraft:equippable") as
    | import("@minecraft/server").EntityEquippableComponent
    | undefined;
  if (!container?.container || !playerInventory?.container) return false;

  for (let slot = 0; slot < INVENTORY_SLOTS; slot++) {
    container.container.setItem(slot, playerInventory.container.getItem(slot));
  }
  container.container.setItem(SLOT_HELMET, equippable?.getEquipment(EquipmentSlot.Head));
  container.container.setItem(SLOT_CHEST, equippable?.getEquipment(EquipmentSlot.Chest));
  container.container.setItem(SLOT_LEGGINGS, equippable?.getEquipment(EquipmentSlot.Legs));
  container.container.setItem(SLOT_BOOTS, equippable?.getEquipment(EquipmentSlot.Feet));
  container.container.setItem(SLOT_OFFHAND, equippable?.getEquipment(EquipmentSlot.Offhand));
  return true;
}

export function clearLoadout(team: Team): boolean {
  const entity = loadoutEntity(team);
  if (!entity) return false;
  const container = entity.getComponent("minecraft:inventory") as
    | import("@minecraft/server").EntityInventoryComponent
    | undefined;
  if (!container?.container) return false;
  for (let slot = 0; slot <= SLOT_OFFHAND; slot++) {
    container.container.setItem(slot, undefined);
  }
  return true;
}

export function applyLoadout(team: Team, player: Player): void {
  const entity = loadoutEntity(team);
  const playerInventory = player.getComponent("minecraft:inventory") as
    | import("@minecraft/server").EntityInventoryComponent
    | undefined;
  const equippable = player.getComponent("minecraft:equippable") as
    | import("@minecraft/server").EntityEquippableComponent
    | undefined;

  // 先清空,再按配置覆盖
  if (playerInventory?.container) {
    for (let slot = 0; slot < INVENTORY_SLOTS; slot++) {
      playerInventory.container.setItem(slot, undefined);
    }
  }
  if (equippable) {
    equippable.setEquipment(EquipmentSlot.Head, undefined);
    equippable.setEquipment(EquipmentSlot.Chest, undefined);
    equippable.setEquipment(EquipmentSlot.Legs, undefined);
    equippable.setEquipment(EquipmentSlot.Feet, undefined);
    equippable.setEquipment(EquipmentSlot.Offhand, undefined);
  }

  if (!entity) return;
  const container = entity.getComponent("minecraft:inventory") as
    | import("@minecraft/server").EntityInventoryComponent
    | undefined;
  if (!container?.container) return;

  if (playerInventory?.container) {
    for (let slot = 0; slot < INVENTORY_SLOTS; slot++) {
      playerInventory.container.setItem(slot, container.container.getItem(slot));
    }
  }
  if (equippable) {
    equippable.setEquipment(EquipmentSlot.Head, container.container.getItem(SLOT_HELMET));
    equippable.setEquipment(EquipmentSlot.Chest, container.container.getItem(SLOT_CHEST));
    equippable.setEquipment(EquipmentSlot.Legs, container.container.getItem(SLOT_LEGGINGS));
    equippable.setEquipment(EquipmentSlot.Feet, container.container.getItem(SLOT_BOOTS));
    equippable.setEquipment(EquipmentSlot.Offhand, container.container.getItem(SLOT_OFFHAND));
  }
}
