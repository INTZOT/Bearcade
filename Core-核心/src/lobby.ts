import {
  world,
  system,
  ItemStack,
  ItemLockMode,
  GameMode,
  EntityComponentTypes,
  type EntityInventoryComponent,
  type Player,
  type PlayerDimensionChangeAfterEvent,
  type PlayerSpawnAfterEvent,
} from "@minecraft/server";
// Core 复用共享纯工具函数(构建期内联,产物仍自包含)
import { clearAllPlayerItems } from "../../shared/minigame-core/playerItems";
import type { GameRegistry } from "./registry";
import { openMainMenu } from "./ui";
import { LOBBY_DIMENSION_ID } from "./types";

export const CLOCK_ITEM = "minecraft:clock";
export const HOTBAR_SLOT = 0;
const ROOM_DIM_PATTERN = /^bearcade:([a-z0-9_]+)_(\d+)$/;

function ensureClock(player: Player): void {
  const inventory = player.getComponent(
    EntityComponentTypes.Inventory,
  ) as EntityInventoryComponent | undefined;
  if (!inventory?.container) return;

  const slot = inventory.container.getSlot(HOTBAR_SLOT);
  const existing = slot.getItem();
  if (
    existing &&
    existing.typeId === CLOCK_ITEM &&
    existing.lockMode === ItemLockMode.slot
  ) {
    return;
  }

  const clock = new ItemStack(CLOCK_ITEM, 1);
  clock.lockMode = ItemLockMode.slot;
  inventory.container.setItem(HOTBAR_SLOT, clock);
}

/** 移除玩家背包中的全部大厅钟(进入房间维度时调用,避免占用对局背包格;返回大厅时重新发放) */
function removeClock(player: Player): void {
  const inventory = player.getComponent(
    EntityComponentTypes.Inventory,
  ) as EntityInventoryComponent | undefined;
  const container = inventory?.container;
  if (!container) return;
  for (let slot = 0; slot < container.size; slot++) {
    const item = container.getItem(slot);
    if (item?.typeId === CLOCK_ITEM) {
      container.setItem(slot, undefined);
    }
  }
}

/**
 * 返回大厅强制数据初始化(契约):
 * 玩家回到主世界时(正常结束、/bearcade:lobby、/bearcade:quit、手动传送、断线重连),
 * 统一清空全套物品、恢复冒险模式、清除对局内设置的重生点/名牌染色/效果,
 * 确保无任何游戏内残留;钟物品由 ensureClock 在初始化后重新发放。
 * 游戏包自身的清理逻辑保留,此处为 Core 兜底(双保险)。
 */
function initPlayerData(player: Player): void {
  try {
    clearAllPlayerItems(player);
  } catch (error) {
    console.warn("[Bearcade Core] 清理玩家物品失败", error);
  }
  try {
    player.setGameMode(GameMode.Adventure);
  } catch (error) {
    console.warn("[Bearcade Core] 恢复游戏模式失败", error);
  }
  try {
    player.setSpawnPoint(undefined);
  } catch {
    // 玩家可能未设置重生点,忽略
  }
  try {
    player.nameTag = player.name;
    player.chatNamePrefix = undefined;
    player.chatNameSuffix = undefined;
  } catch {
    // 忽略
  }
  try {
    // 清除全部效果(本版本无 clearEffects,逐个移除)
    for (const effect of player.getEffects()) {
      player.removeEffect(effect.typeId);
    }
  } catch {
    // 忽略
  }
}

function handleDimensionChange(
  registry: GameRegistry,
  event: PlayerDimensionChangeAfterEvent,
): void {
  if (event.toDimension.id === LOBBY_DIMENSION_ID) {
    registry.unbindPlayer(event.player.id);
    // 契约:返回大厅强制数据初始化,再补发钟
    initPlayerData(event.player);
    ensureClock(event.player);
    return;
  }

  // 玩家以其他方式进入房间维度时,也同步建立绑定,避免重复入房;
  // 同时移除大厅钟,避免占用对局背包格
  const match = ROOM_DIM_PATTERN.exec(event.toDimension.id);
  if (!match) return;
  const [, game, roomIdText] = match;
  const roomId = Number(roomIdText);
  const entry = registry.getGame(game);
  if (entry && roomId >= 1 && roomId <= entry.roomCount) {
    registry.bindPlayer(event.player.id, game, roomId);
    removeClock(event.player);
  }
}

function handleSpawn(
  registry: GameRegistry,
  event: PlayerSpawnAfterEvent,
): void {
  if (event.player.dimension.id === LOBBY_DIMENSION_ID) {
    ensureClock(event.player);
  }

  // 契约:断线一律视为退出游戏(不提供热重连)。
  // initialSpawn 仅在进服/重连时触发(死亡重生为 false):若重连位置不在大厅
  // (断线时位于房间/模板维度),先传送回大厅(传送触发 dimensionChange → 数据初始化);
  // 已在大厅则直接初始化,再补发钟。
  if (event.initialSpawn) {
    const player = event.player;
    system.run(() => {
      try {
        if (player.dimension.id !== LOBBY_DIMENSION_ID) {
          player.teleport(world.getDefaultSpawnLocation(), {
            dimension: world.getDimension(LOBBY_DIMENSION_ID),
          });
        } else {
          initPlayerData(player);
          ensureClock(player);
        }
      } catch (error) {
        // 传送失败等异常时兜底初始化,保证数据一定干净
        console.warn("[Bearcade Core] 重连玩家初始化失败", error);
        try {
          initPlayerData(player);
          ensureClock(player);
        } catch {
          // 忽略
        }
      }
    });
  }
}

export function initLobby(registry: GameRegistry): void {
  world.afterEvents.itemUse.subscribe((event) => {
    const { source: player, itemStack } = event;
    if (itemStack.typeId !== CLOCK_ITEM) return;
    if (player.dimension.id !== LOBBY_DIMENSION_ID) return;
    try {
      openMainMenu(player);
    } catch (error) {
      console.warn("[Bearcade Core] 打开主菜单失败", error);
    }
  });

  world.afterEvents.playerDimensionChange.subscribe((event) => {
    handleDimensionChange(registry, event);
  });

  world.afterEvents.playerSpawn.subscribe((event) => {
    handleSpawn(registry, event);
  });

  world.afterEvents.playerLeave.subscribe((event) => {
    registry.unbindPlayer(event.playerId);
  });
}

export function ensureClockForAll(): void {
  for (const player of world.getAllPlayers()) {
    if (player.dimension.id === LOBBY_DIMENSION_ID) {
      ensureClock(player);
    }
  }
}
