// ============================================================
// 准备阶段职业选择
// 流程:玩家进入 SND5 房间维度(idle/pending)→ 发放山羊角 →
// 右键打开选择表单 → 记录选择 → 开局 onGameStart 时由
// game.ts loadoutFor 消费(未选择兜底战士,2026-11 确认)。
// 选择存模块级内存:准备阶段尚无会话,DynamicProperties 约定
// 只放跨重启配置,对局/流程状态一律内存。
// 占位物品说明:普通书本不是「可用物品」,右键不触发 itemUse,
// 故选择入口用山羊角(使用时自带号角音效,兼作操作反馈)。
// ============================================================
import { ItemStack, system, world, type Player } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import type { MinigameRuntime } from "../../../shared/minigame-core/runtime";
import { GAME_ID } from "../config";
import { professionRegistry } from "./professions/registry";

export const SELECTOR_ITEM_TYPE = "minecraft:goat_horn";
const SELECTOR_ITEM_NAME = "§e§l职业选择§r§7(右键)";

const selectionByPlayer = new Map<string, string>();
let initialized = false;

const ROOM_DIMENSION_PATTERN = new RegExp(`^bearcade:${GAME_ID}_(\\d+)$`);

/** 初始化监听(由 listeners.initSnd5Gameplay 调用一次) */
export function initProfessionSelection(getRuntime: () => MinigameRuntime): void {
  if (initialized) return;
  initialized = true;

  // 进入 SND5 房间维度(准备阶段)发放选择道具
  world.afterEvents.playerDimensionChange.subscribe((event) => {
    const match = ROOM_DIMENSION_PATTERN.exec(event.toDimension.id);
    if (!match) return;
    const runtime = getRuntime();
    const phase = runtime.getPhase(Number(match[1]));
    if (phase !== "idle" && phase !== "pending") return;
    system.run(() => giveSelectorItem(event.player));
  });

  // 离线清除选择(重进默认战士,可重新选择)
  world.afterEvents.playerLeave.subscribe((event) => {
    selectionByPlayer.delete(event.playerId);
  });
}

/** 已选职业 id(undefined = 未选择,开局兜底战士) */
export function getSelectedProfessionId(playerId: string): string | undefined {
  return selectionByPlayer.get(playerId);
}

/** 右键山羊角(listeners.itemUse 路由)。仅 SND5 房间维度内响应 */
export function handleSelectorUse(player: Player): void {
  if (!ROOM_DIMENSION_PATTERN.test(player.dimension.id)) return;
  void openSelectionForm(player);
}

// ── 内部 ─────────────────────────────────────────────────────

async function openSelectionForm(player: Player): Promise<void> {
  const professions = professionRegistry.all();
  const currentId = selectionByPlayer.get(player.id);
  const current = professions.find((prof) => prof.id === currentId);
  const form = new ActionFormData()
    .title("§l职业选择")
    .body(
      `当前职业: ${current ? `§f${current.displayName}` : "§7未选择(开局默认战士)"}\n` +
        "§7选择在开局时生效(准备阶段可随时改选);死亡重生保持职业。",
    );
  for (const prof of professions) {
    form.button(
      prof.available ? `§a${prof.displayName}\n§7${prof.tagline}` : `§7${prof.displayName}\n§8开发中`,
    );
  }
  const response = await form.show(player);
  if (response.canceled || response.selection === undefined) return;
  if (!player.isValid) return;
  const prof = professions[response.selection];
  if (!prof) return;
  if (!prof.available) {
    player.onScreenDisplay.setActionBar(`§c${prof.displayName}开发中,敬请期待`);
    return;
  }
  selectionByPlayer.set(player.id, prof.id);
  player.onScreenDisplay.setActionBar(`§a职业已选择: §f${prof.displayName} §7(开局生效)`);
}

/** 发放选择道具(已有则跳过,防止重复发放) */
function giveSelectorItem(player: Player): void {
  if (!player.isValid) return;
  const container = player.getComponent("minecraft:inventory")?.container;
  if (!container) return;
  for (let slot = 0; slot < container.size; slot++) {
    if (container.getItem(slot)?.typeId === SELECTOR_ITEM_TYPE) return;
  }
  try {
    const item = new ItemStack(SELECTOR_ITEM_TYPE, 1);
    item.nameTag = SELECTOR_ITEM_NAME;
    container.addItem(item);
  } catch (error) {
    console.warn("[SND5] 职业选择道具发放失败", error);
  }
}
