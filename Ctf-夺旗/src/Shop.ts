import { Player, ItemStack, Entity } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { GameManager } from "./GameManager";
import { Vector3 } from "./types";

export interface ShopItem {
  tag: string;
  name: string;
  description: string;
  price: number;
  icon?: string;           // 贴图路径
  itemStack?: ItemStack;   // 购买后给予的物品
  callback?: (player: Player, item: ShopItem) => void;
}

export class Shop {
  public readonly name: string;
  private title: string;
  private description: string;
  private items: Map<string, ShopItem>;
  private callbacks: Map<string, (player: Player, tag: string, price: number) => void>;
  private shopEntity: Entity | undefined;

  constructor(name: string) {
    this.name = name;
    this.title = name;
    this.description = "";
    this.items = new Map();
    this.callbacks = new Map();
    this.shopEntity = undefined;
  }

  setTitle(title: string): void {
    this.title = title;
  }

  setDescription(desc: string): void {
    this.description = desc;
  }

  /** 设置栏目（标签名、栏目名、价格） */
  addItem(tag: string, item: ShopItem): void {
    this.items.set(tag, item);
  }

  /** 设置回调函数(标签名, (栏目标签名, 价格, 玩家对象)) */
  setCallback(tag: string, callback: (player: Player, tag: string, price: number) => void): void {
    this.callbacks.set(tag, callback);
  }

  spawnShopEntity(location: Vector3): void {
    if (this.shopEntity !== undefined) return;

    const gameManager = GameManager.getInstance();
    this.shopEntity = gameManager.getGameDimension()?.spawnEntity("minecraft:armor_stand", location, { initialPersistence: true });
  }

  clearShopEntity(): void {
    if (this.shopEntity === undefined) return;

    this.shopEntity.remove();
    this.shopEntity = undefined;
  }

  /** 展示商店给玩家（使用 ActionFormData） */
  async show(player: Player): Promise<void> {
    const form = new ActionFormData();
    form.title(this.title);
    form.body(this.description);

    for (const item of this.items.values()) {
      form.button(`${item.name}\n§e${item.price} 金币`, item.icon || "");
    }

    const response = await form.show(player);
    if (response.canceled || response.selection === undefined) return;

    const selected = Array.from(this.items.values())[response.selection];
    const callback = this.callbacks.get(selected.tag);
    if (callback) {
      callback(player, selected.tag, selected.price);
    }
    if (selected.callback) {
      selected.callback(player, selected);
    }
  }
}
