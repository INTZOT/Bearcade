// ============================================================
// 猪猪争夺战装备储存(与战桥一致):四队各自独立的装备仓库实体,
// 管理员把"队服 + 道具"全套物品保存到模板维度内的仓库实体,
// 开局/复活时按队伍整体覆盖玩家物品。
// 实体定义见 entities/pigcatcher_loadout_dummy.json。
// ============================================================
import {
  world,
  system,
  EquipmentSlot,
  type Entity,
  type Player,
  type VanillaEntityIdentifier,
} from "@minecraft/server";
import { TEAMS, type Team } from "./config";

const DUMMY_TYPE = "bearcade:pigcatcher_loadout_dummy";
const TEMPLATE_DIMENSION_ID = "bearcade:pigcatcher_template";
const INVENTORY_SLOTS = 36;
const SLOT_HELMET = 36;
const SLOT_CHEST = 37;
const SLOT_LEGGINGS = 38;
const SLOT_BOOTS = 39;
const SLOT_OFFHAND = 40;

function teamTag(team: Team): string {
  return `bearcade:pc_${team}_loadout`;
}

/** 仓库实体在模板维度中的站位(四队错开,互不重叠) */
function teamSpot(team: Team): { x: number; y: number; z: number } {
  const index = TEAMS.indexOf(team);
  return { x: (index - 1.5) * 2, y: -60, z: 0 };
}

function loadoutEntity(team: Team): Entity | undefined {
  const dimension = world.getDimension(TEMPLATE_DIMENSION_ID);
  return dimension
    .getEntities({ type: DUMMY_TYPE })
    .find((entity) => entity.nameTag === teamTag(team));
}

/** 找不到仓库实体时当场重建(兜底) */
function ensureTeamEntity(team: Team): Entity | undefined {
  const existing = loadoutEntity(team);
  if (existing) return existing;
  try {
    const dimension = world.getDimension(TEMPLATE_DIMENSION_ID);
    const spot = teamSpot(team);
    const entity = dimension.spawnEntity(
      DUMMY_TYPE as VanillaEntityIdentifier,
      spot,
    );
    entity.nameTag = teamTag(team);
    return entity;
  } catch (error) {
    console.warn("[Bearcade pigcatcher] 装备仓库实体生成失败", error);
    return undefined;
  }
}

export function ensureLoadoutEntities(): void {
  const spawnAll = (): void => {
    for (const team of TEAMS) {
      ensureTeamEntity(team);
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
          "[Bearcade pigcatcher] 装备仓库实体生成失败",
          error,
        );
      }
    }
  };
  trySpawn();
}

/** 把玩家当前全套物品(背包/快捷栏/盔甲/副手)保存为该队装备配置 */
export function saveLoadout(team: Team, player: Player): boolean {
  const entity = ensureTeamEntity(team);
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
  const entity = ensureTeamEntity(team);
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

/** 按队伍配置覆盖玩家全套物品(队服 + 道具);未配置时玩家为空背包(与战桥一致) */
export function applyLoadout(team: Team, player: Player): void {
  const entity = ensureTeamEntity(team);
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
