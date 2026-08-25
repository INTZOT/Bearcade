import { Entity, Player } from "@minecraft/server";
import { Shop } from "./Shop";

export class ShopManager {
  private shops: Map<string, Shop>;

  constructor() {
    this.shops = new Map();
  }

  createShop(name: string): Shop {
    const shop = new Shop(name);
    this.shops.set(name, shop);
    return shop;
  }

  getShop(name: string): Shop | undefined {
    return this.shops.get(name);
  }

  spawnShopEntity(): void {
    // this.shops.get("tiem_shop")?.spawnShopEntity(config.arena.redShop);
    // this.shops.get("ti")?.spawnShopEntity(config.arena.blueShop);
  }

  removeShopEntity(): void {
    this.shops.forEach((shop) => {
      shop.clearShopEntity();
    });
  }

  /** 根据实体 ID 在所有商店中查找对应的 Shop */
  findShopByEntity(entity: Entity): Shop | undefined {
    for (const shop of this.shops.values()) {
      if (shop.hasEntity(entity.id)) {
        return shop;
      }
    }
    return undefined;
  }

  showShop(player: Player, shopName: string): void {
    const shop = this.shops.get(shopName);
    if (shop) {
      shop.show(player);
    }
  }
}
