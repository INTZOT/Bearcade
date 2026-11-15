// ============================================================
// 准备阶段职业与秘典选择
// 流程:玩家进入 SND5 房间维度(idle/pending)→ 发放山羊角 →
// 右键打开选择表单 → 记录选择 → 顺延秘典Ⅰ/Ⅱ选择表单 →
// 开局 onGameStart 时由 game.ts loadoutFor/发装消费
// (职业未选择兜底战士;秘典未选择则槽位空)。
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
import { CODEX_SPELLS, type CodexTier } from "./codex";

export const SELECTOR_ITEM_TYPE = "minecraft:goat_horn";
const SELECTOR_ITEM_NAME = "§e§l职业选择§r§7(右键)";

const selectionByPlayer = new Map<string, string>();
/** 已选秘典(与职业选择同寿命:模块级内存,离线清除) */
const codexSelection = new Map<string, { codex1?: string; codex2?: string }>();
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
    codexSelection.delete(event.playerId);
  });
}

/** 已选职业 id(undefined = 未选择,开局兜底战士) */
export function getSelectedProfessionId(playerId: string): string | undefined {
  return selectionByPlayer.get(playerId);
}

/** 已选秘典法术(undefined = 未选择,开局槽位空) */
export function getSelectedCodex(
  playerId: string,
): { codex1?: string; codex2?: string } | undefined {
  return codexSelection.get(playerId);
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
  // 顺延秘典Ⅰ/Ⅱ选择(可清空跳过;右键山羊角可随时改选)
  await openCodexTierForm(player, "codex_1");
  await openCodexTierForm(player, "codex_2");
}

/** 秘典选择表单(对应物品栏槽位 6/7);「清空」= 不携带 */
async function openCodexTierForm(player: Player, tier: CodexTier): Promise<void> {
  const spells = CODEX_SPELLS.filter((spell) => spell.tier === tier);
  const selection = codexSelection.get(player.id) ?? {};
  const currentId = tier === "codex_1" ? selection.codex1 : selection.codex2;
  const tierLabel = tier === "codex_1" ? "秘典Ⅰ" : "秘典Ⅱ";
  const current = spells.find((spell) => spell.skillId === currentId);
  const form = new ActionFormData()
    .title(`§l${tierLabel}选择`)
    .body(
      `当前${tierLabel}: ${current ? `§f${current.displayName}` : "§7未选择"}\n` +
        "§7开局后装备在槽位 6/7;使用一次后禁用,需在资源补给站补充。",
    );
  for (const spell of spells) {
    form.button(
      spell.skillId === currentId
        ? `§a✔ ${spell.displayName}\n§7${spell.tagline}`
        : `§f${spell.displayName}\n§7${spell.tagline}`,
    );
  }
  form.button("§7清空\n§8不携带此秘典");
  const response = await form.show(player);
  if (response.canceled || response.selection === undefined) return;
  if (!player.isValid) return;
  const next = codexSelection.get(player.id) ?? {};
  if (response.selection === spells.length) {
    if (tier === "codex_1") next.codex1 = undefined;
    else next.codex2 = undefined;
    codexSelection.set(player.id, next);
    player.onScreenDisplay.setActionBar(`§7${tierLabel}已清空`);
    return;
  }
  const spell = spells[response.selection];
  if (!spell) return;
  if (tier === "codex_1") next.codex1 = spell.skillId;
  else next.codex2 = spell.skillId;
  codexSelection.set(player.id, next);
  player.onScreenDisplay.setActionBar(`§a${tierLabel}已选择: §f${spell.displayName} §7(开局生效)`);
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
