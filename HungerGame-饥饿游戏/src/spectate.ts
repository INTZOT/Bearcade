// ============================================================
// HungerGame 观战:照搬 Collapse 最终方案
// 淘汰玩家 → 传送观战台 + follow_orbit 引擎绑定(/camera attach_to_entity,
// 需世界作弊),手持望远镜轮换观战目标。不用旁观者模式(无法手持物品)。
// ============================================================
import {
  GameMode,
  ItemStack,
  ItemLockMode,
  EntityComponentTypes,
  type Player,
} from "@minecraft/server";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { SPECTATE_ITEM } from "./config";

const SPEC_OWNER_TAG = "bearcade:hg_spec_owner";
const SPEC_TARGET_TAG = "bearcade:hg_spec_target";

/** 引擎级附加:follow_orbit 预设 + /camera attach_to_entity(临时 tag 定位) */
export function attachSpectateCamera(spectator: Player, target: Player): void {
  try {
    spectator.addTag(SPEC_OWNER_TAG);
    target.addTag(SPEC_TARGET_TAG);
    try {
      spectator.dimension.runCommand(
        `camera @a[tag=${SPEC_OWNER_TAG}] attach_to_entity @e[tag=${SPEC_TARGET_TAG}]`,
      );
    } finally {
      spectator.removeTag(SPEC_OWNER_TAG);
      target.removeTag(SPEC_TARGET_TAG);
    }
  } catch (error) {
    console.warn("[Bearcade hungergame] 观战相机附加失败", error);
  }
}

/** 进入观战:冒险模式 + 传送观战台 + 发放望远镜 + 绑定目标 */
export function startSpectating(
  runtime: MinigameRuntime,
  roomId: number,
  spectator: Player,
  target: Player | undefined,
  spectateSpot: { x: number; y: number; z: number },
): void {
  try {
    spectator.setGameMode(GameMode.Adventure);
  } catch {
    // 忽略
  }
  runtime.teleportPlayer(roomId, spectator, spectateSpot);
  giveSpectateItem(spectator);
  if (target) {
    attachSpectateCamera(spectator, target);
    spectator.sendMessage(`§7正在观战 §e${target.name}§7(手持望远镜切换目标)`);
  } else {
    spectator.sendMessage("§7观战中,等待对局结束");
  }
}

/** 清除观战状态(对局结束/离房) */
export function clearSpectate(spectator: Player): void {
  try {
    spectator.camera.clear();
  } catch {
    // 忽略
  }
  removeSpectateItem(spectator);
}

/** 发放观战望远镜(槽位锁定,固定快捷栏第 9 格) */
function giveSpectateItem(player: Player): void {
  try {
    const spyglass = new ItemStack(SPECTATE_ITEM, 1);
    spyglass.lockMode = ItemLockMode.slot;
    player
      .getComponent(EntityComponentTypes.Inventory)
      ?.container?.setItem(8, spyglass);
  } catch {
    // 忽略
  }
}

function removeSpectateItem(player: Player): void {
  try {
    const container = player.getComponent(EntityComponentTypes.Inventory)
      ?.container;
    if (!container) return;
    for (let slot = 0; slot < container.size; slot++) {
      const item = container.getItem(slot);
      if (item?.typeId === SPECTATE_ITEM) container.setItem(slot, undefined);
    }
  } catch {
    // 忽略
  }
}
