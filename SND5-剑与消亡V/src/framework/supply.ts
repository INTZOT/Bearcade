// ============================================================
// SupplySystem —— 资源补给站(修改意见④)
// 决策:站点不消耗库存,只有玩家 20 秒限频,
// 7 个站点(5 内圈 + 2 外围);整房重建后由新会话重新生成载体。
// - 载体:盔甲架占位实体(后续替换自定义实体),经 SummonSystem 生成
//   (挂 snd5:summon tag 随会话回收)+ STATION_TAG 标识 + 站点 id 动态属性;
// - 交互:右键载体实体 → before 事件取消盔甲架原版装备界面 →
//   按 snd5:station 动态属性查站点 → 打开补给表单;
// - 防破坏:载体免伤(entityHurt 取消);tick 每 2 秒巡检,
//   被移除(如 /kill)的载体自动重新生成;
// - 限频:每人 20 秒一次,内存冷却(不用方块/物品的 minecraft:cooldown);
// - 携带上限:血药 2 / 甲修 8 / 魔瓶 4 / 秘典各 1(PDF 第 4 页);
// - 回复类道具的使用结算走 CombatPipeline(受治疗修正/收束影响)。
// ============================================================
import { ItemStack, system, world, type Player } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import type { Vec3 } from "../../../shared/minigame-core/types";
import type { MatchSession } from "./session";

/** 站点载体实体类型(占位:盔甲架) */
const STATION_CARRIER_TYPE = "minecraft:armor_stand";
/** 站点载体标识 tag(listeners 交互识别/免伤用) */
export const STATION_TAG = "snd5:supply_station";
/** 站点载体上的站点 id 动态属性(交互路由用) */
export const STATION_ID_PROP = "snd5:station";

export interface SupplyItemDef {
  itemTypeId: string;
  displayName: string;
  /** 携带上限(个) */
  maxCarry: number;
  /** 单次补给数量 */
  amountPerGrant: number;
  /**
   * 秘典槽位充能条目:填写后本条目不发放新物品,而是给对应秘典槽位的
   * 已耗尽法术充能(复位堆叠 + 物品恢复可用态,经 injects.codexItemRestore)。
   */
  codexSlot?: "codex_1" | "codex_2";
}

export interface SupplyStationDef {
  id: string;
  displayName: string;
  /** 站点载体实体位置(模板场地内,需落在实体方块上防跌落) */
  location: Vec3;
  items: SupplyItemDef[];
}

export class SupplySystem {
  private readonly stations = new Map<string, SupplyStationDef>();
  /** Map<playerId, 上次成功使用的 tick> */
  private readonly lastUsed = new Map<string, number>();
  /** Map<stationId, 载体实体 id>(巡检重生成用) */
  private readonly stationEntities = new Map<string, string>();
  private lastIntegrityTick = 0;

  constructor(
    private readonly session: MatchSession,
    defs: readonly SupplyStationDef[],
  ) {
    for (const def of defs) this.stations.set(def.id, def);
    for (const station of this.stations.values()) this.spawnStationEntity(station);
  }

  /** 周期巡检:载体实体被移除(如 /kill)时重新生成 */
  tick(nowTick: number): void {
    if (nowTick - this.lastIntegrityTick < 40) return;
    this.lastIntegrityTick = nowTick;
    for (const station of this.stations.values()) {
      const entityId = this.stationEntities.get(station.id);
      if (entityId && this.isEntityValid(entityId)) continue;
      this.spawnStationEntity(station);
    }
  }

  isOnCooldown(playerId: string): number {
    const last = this.lastUsed.get(playerId);
    if (last === undefined) return 0;
    const cooldownTicks = this.session.config.supplyCooldownSeconds * 20;
    return Math.max(0, cooldownTicks - (system.currentTick - last));
  }

  /** 打开补给表单并发放;成功补给才消耗 20 秒冷却 */
  async tryUse(player: Player, stationId: string): Promise<void> {
    const station = this.stations.get(stationId);
    if (!station || !player.isValid) return;

    const remaining = this.isOnCooldown(player.id);
    if (remaining > 0) {
      this.session.hud.toast(player, `§c补给冷却中 ${Math.ceil(remaining / 20)}s`);
      return;
    }

    const form = new ActionFormData()
      .title("§l资源补给站")
      .body(
        `§7${station.displayName}\n§7每人每 ${this.session.config.supplyCooldownSeconds} 秒限用 1 次`,
      );
    const items = station.items;
    for (const item of items) {
      if (item.codexSlot) {
        form.button(this.codexButtonLabel(player, item));
        continue;
      }
      const carried = this.countCarried(player, item.itemTypeId);
      form.button(`${item.displayName} §7(${carried}/${item.maxCarry})`);
    }
    const response = await form.show(player);
    if (response.canceled || response.selection === undefined) return;
    if (!player.isValid) return;

    const item = items[response.selection];
    if (!item) return;

    // 秘典条目:不走发放,走「耗尽 → 充能」流程
    if (item.codexSlot) {
      this.rechargeCodex(player, item);
      return;
    }

    const carried = this.countCarried(player, item.itemTypeId);
    if (carried >= item.maxCarry) {
      this.session.hud.toast(player, `§c${item.displayName}已达携带上限(${item.maxCarry})`);
      return;
    }

    const inventory = player.getComponent("minecraft:inventory");
    const grantAmount = Math.min(item.amountPerGrant, item.maxCarry - carried);
    try {
      inventory?.container?.addItem(new ItemStack(item.itemTypeId, grantAmount));
    } catch (error) {
      console.warn(`[SND5] 补给发放失败 ${item.itemTypeId}`, error);
      return;
    }
    this.lastUsed.set(player.id, system.currentTick);
    this.session.hud.toast(player, `§a已补给 ${item.displayName} ×${grantAmount}`);
  }

  dispose(): void {
    this.stations.clear();
    this.lastUsed.clear();
    this.stationEntities.clear();
  }

  // ── 内部 ─────────────────────────────────────────────────────

  /** 生成站点载体(盔甲架占位;可交互/免伤标识由 listeners 识别) */
  private spawnStationEntity(station: SupplyStationDef): void {
    const entity = this.session.summons.spawnSummon(STATION_CARRIER_TYPE, station.location);
    if (!entity) return;
    try {
      entity.nameTag = `§e§l${station.displayName}§r`;
      entity.addTag(STATION_TAG);
      entity.setDynamicProperty(STATION_ID_PROP, station.id);
    } catch {
      // 标识写入失败不影响载体存在
    }
    this.stationEntities.set(station.id, entity.id);
  }

  private isEntityValid(entityId: string): boolean {
    try {
      return world.getEntity(entityId)?.isValid ?? false;
    } catch {
      return false;
    }
  }

  /** 秘典条目按钮文案:显示当前装备的法术与可用状态 */
  private codexButtonLabel(player: Player, item: SupplyItemDef): string {
    const def = item.codexSlot
      ? this.session.skills.getEquipped(player.id, item.codexSlot)
      : undefined;
    if (!def) return `${item.displayName} §8(未装备)`;
    const stateText = this.session.skills.isExhausted(player.id, def.id) ? "§c已耗尽" : "§7可用";
    return `${item.displayName}·${def.displayName} ${stateText}`;
  }

  /** 秘典充能:仅对耗尽的秘典生效;未装备/仍可用仅提示,不消耗 20s 限频 */
  private rechargeCodex(player: Player, item: SupplyItemDef): void {
    const slot = item.codexSlot;
    if (!slot) return;
    const def = this.session.skills.getEquipped(player.id, slot);
    if (!def) {
      this.session.hud.toast(player, `§7未装备${item.displayName}(准备阶段右键山羊角选择)`);
      return;
    }
    if (!this.session.skills.isExhausted(player.id, def.id)) {
      this.session.hud.toast(player, `§7${def.displayName}仍可用,无需补充`);
      return;
    }
    this.session.skills.refillStacks(player.id, def.id);
    this.session.injects.codexItemRestore?.(player, slot, def.id);
    this.lastUsed.set(player.id, system.currentTick);
    this.session.hud.toast(player, `§a已补充 ${def.displayName}`);
  }

  /** 统计背包内某物品数量 */
  private countCarried(player: Player, itemTypeId: string): number {
    const container = player.getComponent("minecraft:inventory")?.container;
    if (!container) return 0;
    let count = 0;
    for (let slot = 0; slot < container.size; slot++) {
      const stack = container.getItem(slot);
      if (stack?.typeId === itemTypeId) count += stack.amount;
    }
    return count;
  }
}
