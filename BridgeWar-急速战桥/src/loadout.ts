import {
  world,
  system,
  EquipmentSlot,
  type Entity,
  type Player,
  type VanillaEntityIdentifier,
} from "@minecraft/server";
import { clearAllPlayerItems } from "../../shared/minigame-core/playerItems";
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

/** 找不到仓库实体时当场重建(兜底);失败返回 undefined(不在此打日志,由调用方处理) */
function ensureTeamEntity(team: Team): Entity | undefined {
  const existing = loadoutEntity(team);
  if (existing) return existing;
  try {
    const dimension = world.getDimension(TEMPLATE_DIMENSION_ID);
    const entity = dimension.spawnEntity(
      DUMMY_TYPE as VanillaEntityIdentifier,
      {
        x: 0,
        y: -60,
        z: team === "red" ? -1 : 1,
      },
    );
    entity.nameTag = teamTag(team);
    return entity;
  } catch {
    // 模板维度区块可能尚未加载(LocationInUnloadedChunkError),返回 undefined 交由上层重试
    return undefined;
  }
}

export function ensureLoadoutEntities(): void {
  // 模板维度区块在 worldLoad 初期可能尚未加载,spawnEntity 抛
  // LocationInUnloadedChunkError(被 ensureTeamEntity 吞掉转 undefined),
  // 因此按返回值统计失败并延迟重试,全部成功即结束;30 次(约 60 秒)后仍失败才告警
  let remaining = 30;
  const trySpawn = (): void => {
    let failed = false;
    for (const team of ["red", "blue"] as const) {
      if (!ensureTeamEntity(team)) failed = true;
    }
    if (failed && remaining > 0) {
      remaining--;
      system.runTimeout(trySpawn, 40);
    } else if (failed) {
      console.warn(
        "[Bearcade bridgewar] 装备仓库实体生成失败(重试 30 次后仍未成功)",
      );
    }
  };
  trySpawn();
}

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

export function applyLoadout(team: Team, player: Player): void {
  const entity = ensureTeamEntity(team);
  // 仓库实体/容器不可用时:保留玩家当前物品(宁可不套装备,也不先清空背包导致空手开局)
  if (!entity) {
    console.warn(
      `[Bearcade bridgewar] 装备仓库实体不可用(team=${team}),保留玩家物品`,
    );
    return;
  }
  const container = entity.getComponent("minecraft:inventory") as
    | import("@minecraft/server").EntityInventoryComponent
    | undefined;
  if (!container?.container) {
    console.warn(
      `[Bearcade bridgewar] 装备仓库容器不可用(team=${team}),保留玩家物品`,
    );
    return;
  }
  const playerInventory = player.getComponent("minecraft:inventory") as
    | import("@minecraft/server").EntityInventoryComponent
    | undefined;
  const equippable = player.getComponent("minecraft:equippable") as
    | import("@minecraft/server").EntityEquippableComponent
    | undefined;

  // 先清空,再按配置覆盖(未配置的队伍 = 空背包,配置即真实)
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

/** 清空玩家全套物品(背包/盔甲/副手),统一走共享实现 */
export function clearPlayerInventory(player: Player): void {
  clearAllPlayerItems(player);
}
