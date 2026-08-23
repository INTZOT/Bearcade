import { Player } from "@minecraft/server";
import { config } from "./config";
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
    this.shops.get("red")?.spawnShopEntity(config.arena.redShop);
    this.shops.get("blue")?.spawnShopEntity(config.arena.blueShop);
  }

  removeShopEntity(): void {
    this.shops.forEach((shop) => {
      shop.clearShopEntity();
    });
  }

  showShop(player: Player, shopName: string): void {
    const shop = this.shops.get(shopName);
    if (shop) {
      shop.show(player);
    }
  }
}
