import {
  world,
  ItemStack,
  ItemLockMode,
  EntityComponentTypes,
  type EntityInventoryComponent,
  type Player,
  type PlayerDimensionChangeAfterEvent,
  type PlayerSpawnAfterEvent,
} from "@minecraft/server";
import type { GameRegistry } from "./registry";
import { openMainMenu } from "./ui";

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

function handleDimensionChange(
  registry: GameRegistry,
  event: PlayerDimensionChangeAfterEvent,
): void {
  if (event.toDimension.id === "overworld") {
    registry.unbindPlayer(event.player.id);
    ensureClock(event.player);
    return;
  }

  // 玩家以其他方式进入房间维度时,也同步建立绑定,避免重复入房
  const match = ROOM_DIM_PATTERN.exec(event.toDimension.id);
  if (!match) return;
  const [, game, roomIdText] = match;
  const roomId = Number(roomIdText);
  const entry = registry.getGame(game);
  if (entry && roomId >= 1 && roomId <= entry.roomCount) {
    registry.bindPlayer(event.player.id, game, roomId);
  }
}

function handleSpawn(
  registry: GameRegistry,
  event: PlayerSpawnAfterEvent,
): void {
  if (event.player.dimension.id === "overworld") {
    ensureClock(event.player);
  }
}

export function initLobby(registry: GameRegistry): void {
  world.afterEvents.itemUse.subscribe((event) => {
    if (
      event.itemStack.typeId === CLOCK_ITEM &&
      event.source.dimension.id === "overworld"
    ) {
      openMainMenu(event.source);
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
    if (player.dimension.id === "overworld") {
      ensureClock(player);
    }
  }
}
