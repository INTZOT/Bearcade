import { Player, ItemStack } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

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
  private items: Map<string, ShopItem>;
  private callbacks: Map<string, (player: Player, tag: string, price: number) => void>;

  constructor(name: string) {
    this.name = name;
    this.title = name;
    this.items = new Map();
    this.callbacks = new Map();
  }

  setTitle(title: string): void {
    this.title = title;
  }

  setName(name: string): void {
    // 内部标识名
  }

  setDescription(desc: string): void {
    // TODO: 商店副标题或整体描述
  }

  /** 设置栏目（标签名、栏目名、价格） */
  addItem(tag: string, item: ShopItem): void {
    this.items.set(tag, item);
  }

  /** 设置回调函数(标签名, (栏目标签名, 价格, 玩家对象)) */
  setCallback(tag: string, callback: (player: Player, tag: string, price: number) => void): void {
    this.callbacks.set(tag, callback);
  }

  /** 展示商店给玩家（使用 ActionFormData） */
  async show(player: Player): Promise<void> {
    const form = new ActionFormData();
    form.title(this.title);
    form.body("选择你要购买的物品");

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
