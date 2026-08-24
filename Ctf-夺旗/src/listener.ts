import { Player, world } from "@minecraft/server";
import { GameManager } from "./GameManager";

export function initCTFListener(): void {
  const gameManager = GameManager.getInstance();

  // 右键点击商店实体打开商店
  world.afterEvents.playerInteractWithEntity.subscribe((event) => {
    const player = event.player;
    const target = event.target;

    const shop = gameManager.getShopManager().findShopByEntity(target);
    if (shop) {
      shop.show(player);
    }
  });

  // 左键攻击商店实体打开商店
  world.afterEvents.entityHitEntity.subscribe((event) => {
    const attacker = event.damagingEntity;
    const target = event.hitEntity;

    if (!(attacker instanceof Player)) return;

    const shop = gameManager.getShopManager().findShopByEntity(target);
    if (shop) {
      shop.show(attacker);
    }
  });
}