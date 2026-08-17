// ============================================================
// HungerGame 物资池:4 级物资池实体(效仿战桥 loadout 实体仓库)
// 模板维度 512² 无法整图常加载(引擎每区域 ≤100 区块),池实体改放
// 房间维度地下(常加载区覆盖 xz),每房间每等级 1 个隐形 inventory 实体。
// ============================================================
import {
  system,
  ItemStack,
  EntityComponentTypes,
  type Entity,
  type EntityInventoryComponent,
  type Player,
  type VanillaEntityIdentifier,
} from "@minecraft/server";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import {
  POOL_ENTITY,
  POOL_LEVELS,
  POOL_ENTITY_Y,
  ROOM_COUNT,
} from "./config";

function poolTag(level: number): string {
  return `bearcade:hg_pool_${level}`;
}

function poolEntity(
  dim: import("@minecraft/server").Dimension,
  level: number,
): Entity | undefined {
  return dim
    .getEntities({ type: POOL_ENTITY })
    .find((entity) => entity.nameTag === poolTag(level));
}

/** 找不到池实体时当场重建(兜底);失败返回 undefined(区块未加载等) */
function ensurePoolEntity(
  dim: import("@minecraft/server").Dimension,
  level: number,
): Entity | undefined {
  const existing = poolEntity(dim, level);
  if (existing) return existing;
  try {
    const entity = dim.spawnEntity(POOL_ENTITY as VanillaEntityIdentifier, {
      x: 0,
      y: POOL_ENTITY_Y,
      z: (level - 2.5) * 3,
    });
    entity.nameTag = poolTag(level);
    return entity;
  } catch {
    return undefined;
  }
}

/** 启动时确保全部房间的 4 级池实体存在(区块未加载时延迟重试) */
export function ensurePoolEntities(getRuntime: () => MinigameRuntime): void {
  let remaining = 30;
  const trySpawn = (): void => {
    let failed = false;
    for (let roomId = 1; roomId <= ROOM_COUNT; roomId++) {
      const dim = getRuntime().roomDim(roomId);
      for (let level = 1; level <= POOL_LEVELS; level++) {
        if (!ensurePoolEntity(dim, level)) failed = true;
      }
    }
    if (failed && remaining > 0) {
      remaining--;
      system.runTimeout(trySpawn, 40);
    } else if (failed) {
      console.warn(
        "[Bearcade hungergame] 物资池实体生成失败(重试 30 次后仍未成功)",
      );
    }
  };
  trySpawn();
}

function poolContainer(
  getRuntime: () => MinigameRuntime,
  roomId: number,
  level: number,
): import("@minecraft/server").Container | undefined {
  const entity = poolEntity(getRuntime().roomDim(roomId), level);
  if (!entity) return undefined;
  const inventory = entity.getComponent(
    EntityComponentTypes.Inventory,
  ) as EntityInventoryComponent | undefined;
  return inventory?.container;
}

/** 读取某级物资池全部物品(开箱抽选用) */
export function poolItems(
  getRuntime: () => MinigameRuntime,
  roomId: number,
  level: number,
): ItemStack[] {
  const container = poolContainer(getRuntime, roomId, level);
  if (!container) return [];
  const items: ItemStack[] = [];
  for (let slot = 0; slot < container.size; slot++) {
    const item = container.getItem(slot);
    if (item) items.push(item);
  }
  return items;
}

/** 把玩家背包保存到某级物资池(同步写入全部房间) */
export function savePlayerInventoryToPool(
  getRuntime: () => MinigameRuntime,
  player: Player,
  level: number,
): boolean {
  if (level < 1 || level > POOL_LEVELS) return false;
  const source = player
    .getComponent(EntityComponentTypes.Inventory)
    ?.container;
  if (!source) return false;
  let ok = true;
  for (let roomId = 1; roomId <= ROOM_COUNT; roomId++) {
    const container = poolContainer(getRuntime, roomId, level);
    if (!container) {
      ok = false;
      continue;
    }
    for (let slot = 0; slot < container.size; slot++) {
      container.setItem(slot, source.getItem(slot) ?? undefined);
    }
  }
  return ok;
}

/** 清空某级物资池(全部房间) */
export function clearPool(
  getRuntime: () => MinigameRuntime,
  level: number,
): boolean {
  if (level < 1 || level > POOL_LEVELS) return false;
  let ok = true;
  for (let roomId = 1; roomId <= ROOM_COUNT; roomId++) {
    const container = poolContainer(getRuntime, roomId, level);
    if (!container) {
      ok = false;
      continue;
    }
    container.clearAll();
  }
  return ok;
}

/** 调试:查看某级物资池物品数(全部房间合计) */
export function countPoolItems(
  getRuntime: () => MinigameRuntime,
  level: number,
): number {
  let n = 0;
  for (let roomId = 1; roomId <= ROOM_COUNT; roomId++) {
    n += poolItems(getRuntime, roomId, level).length;
  }
  return n;
}
