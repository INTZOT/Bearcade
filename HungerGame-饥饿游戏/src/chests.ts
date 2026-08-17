// ============================================================
// HungerGame 物资箱热重载
// 地图为死场景、箱子内容不落库:玩家打开箱子的瞬间才抽取等级并
// 从物资池随机 4~8 个物品分布到 27 个槽位。一局内首次打开填充,
// 中心箱在阶段 4 由 game.ts 调 resetCenterChests 重置为 4 级。
// ============================================================
import {
  world,
  ItemStack,
  EntityComponentTypes,
  type Block,
  type Container,
} from "@minecraft/server";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { poolItems } from "./loot";
import {
  CHEST_CENTER,
  CHEST_ITEM_MAX,
  CHEST_ITEM_MIN,
  CHEST_SLOTS,
  CHEST_WILD,
} from "./config";

/** 已填充箱子 key:dimId:x,y,z(地图永不重建,会话内内存即可) */
const filled = new Set<string>();
/** 本局已填充的中心箱坐标(dimId -> 坐标列表,阶段 4 重置用) */
const centerChests = new Map<string, { x: number; y: number; z: number }[]>();
/** 中心箱当前等级(开局 2,阶段 4 升 4) */
let centerLevel = 2;

function chestKey(block: Block): string {
  return `${block.dimension.id}:${block.x},${block.y},${block.z}`;
}

function randomSlot(container: Container, used: Set<number>): number {
  let slot = Math.floor(Math.random() * container.size);
  let tries = 0;
  while (used.has(slot) && tries < container.size * 3) {
    slot = Math.floor(Math.random() * container.size);
    tries++;
  }
  return slot;
}

/** 填充一个物资箱(未填充过才动作);返回是否本次填充 */
export function fillChest(
  getRuntime: () => MinigameRuntime,
  roomId: number,
  block: Block,
): boolean {
  const key = chestKey(block);
  if (filled.has(key)) return false;
  // 等级:中心箱固定(centerLevel);野外箱打开时随机 1~4
  const level =
    block.typeId === CHEST_CENTER
      ? centerLevel
      : 1 + Math.floor(Math.random() * 4);
  const pool = poolItems(getRuntime, roomId, level);
  const container = block.getComponent(EntityComponentTypes.Inventory)
    ?.container;
  if (!container || container.size !== CHEST_SLOTS) return false;
  if (pool.length === 0) {
    // 池为空:不标记已填充,管理员补货后仍可开出
    return false;
  }
  const count =
    CHEST_ITEM_MIN +
    Math.floor(Math.random() * (CHEST_ITEM_MAX - CHEST_ITEM_MIN + 1));
  const used = new Set<number>();
  for (let i = 0; i < count; i++) {
    const item = pool[Math.floor(Math.random() * pool.length)];
    const slot = randomSlot(container, used);
    used.add(slot);
    container.setItem(slot, new ItemStack(item.typeId, item.amount));
  }
  filled.add(key);
  if (block.typeId === CHEST_CENTER) {
    const list = centerChests.get(block.dimension.id) ?? [];
    list.push({ x: block.x, y: block.y, z: block.z });
    centerChests.set(block.dimension.id, list);
  }
  return true;
}

/** 阶段 4:中心箱整体重置——清空已填充内容,等级升为 4,本局可再次搜刮 */
export function resetCenterChests(dimensionId: string): void {
  const dim = world.getDimension(dimensionId);
  for (const pos of centerChests.get(dimensionId) ?? []) {
    const block = dim.getBlock({ x: pos.x, y: pos.y, z: pos.z });
    const container = block?.getComponent(EntityComponentTypes.Inventory)
      ?.container;
    if (container) container.clearAll();
    filled.delete(`${dimensionId}:${pos.x},${pos.y},${pos.z}`);
  }
  centerChests.set(dimensionId, []);
  centerLevel = 4;
}

/** 查询中心箱当前等级(游戏内公告用) */
export function getCenterChestLevel(): number {
  return centerLevel;
}

/** 野外/中心箱类型判断 */
export function isChestBlock(typeId: string): boolean {
  return typeId === CHEST_CENTER || typeId === CHEST_WILD;
}
