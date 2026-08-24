import { Player, ItemStack, Entity } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { MinecraftEntityTypes } from "@minecraft/vanilla-data";
import { GameManager } from "./GameManager";
import { Vector3 } from "./types";

export interface ShopItem {
  tag: string;
  name: string;
  price: number;
  icon?: string;           // 贴图路径
  itemStack?: ItemStack;   // 购买后给予的物品
  callback?: (player: Player, item: ShopItem) => void;
}

export class Shop {
  public readonly name: string;
  private title: string;
  private description: string | undefined;
  private items: Map<string, ShopItem>;
  private callbacks: Map<string, (player: Player, tag: string, price: number) => void>;
  private shopEntity: Map<string, Entity>;

  constructor(name: string) {
    this.name = name;
    this.title = name;
    this.items = new Map();
    this.callbacks = new Map();
    this.shopEntity = new Map();
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

    const gameManager = GameManager.getInstance();
    const entity = gameManager.getGameDimension()?.spawnEntity(MinecraftEntityTypes.ArmorStand, location);
    
    if (entity === undefined) throw new Error("无法创建实体");
    this.shopEntity.set(entity.id, entity);
  }

  clearShopEntity(id?: string): void {
    if (this.shopEntity === undefined) return;

    if (id) {
      const entity = this.shopEntity.get(id);
      if (entity) {
        entity.remove();
        this.shopEntity.delete(id);
      }
      return;
    } else {
      for (const entity of this.shopEntity.values()) {
        entity.remove();
      }
      this.shopEntity.clear();
    }
  }

  getShopEntity(id: string): Entity | undefined {
    return this.shopEntity.get(id);
  }
  
  /** 判断指定实体是否属于本商店 */
  hasEntity(entityId: string): boolean {
    return this.shopEntity.has(entityId);
  }

  /** 展示商店给玩家（使用 ActionFormData） */
  async show(player: Player): Promise<void> {
    const form = new ActionFormData();
    form.title(this.title);
    if(this.description) form.body(this.description);

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
