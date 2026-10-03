// ============================================================
// 《灯塔全明星》玩法钩子(M1 运行时核心)
//
// 职责:
//   - onGameStart:建 Match(选人 → 三局两胜 → 结束回大厅);
//   - 起一个 system.runInterval(1 tick) 统一推进所有房间的对局;
//   - 订阅 /scriptevent allstars:probe 输入探针;
//   - onBeforeReset:清场(可重复执行)。
//
// 所有原生调用(playAnimation / setCamera / teleport / spawnEntity …)都发生在
// runInterval 回调里,不在 restricted execution(before 事件/命令回调)中。
// ============================================================

import { system, world, type Player } from "@minecraft/server";
import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { clearHudTitle } from "../../shared/minigame-core/scoreboardHud";
import { IN_GAME_NAME, ROOM_COUNT } from "./config";
import { PROBE_COMMAND_ID, SKILL_ITEMS } from "./combat-config";
import { handleSkillSelection, startProbe, stopProbe } from "./input";
import { resetPlayerCamera } from "./camera";
import {
  activeMatchCount,
  createMatch,
  getMatch,
  resetRoom,
  tickMatches,
} from "./match";

let runtimeGetter: () => MinigameRuntime = () => {
  throw new Error("AllStars runtime not initialized");
};

/** 1 tick 推进句柄:整个世界只起一次 */
let tickHandle: number | undefined;
let probeSubscribed = false;
let hotbarSubscribed = false;

function runtime(): MinigameRuntime {
  return runtimeGetter();
}

/** 起全局 1 tick 推进器(幂等) */
function ensureTickLoop(): void {
  if (tickHandle !== undefined) return;
  tickHandle = system.runInterval(() => {
    try {
      tickMatches();
    } catch (error) {
      console.warn("[Bearcade allstars] 对局推进循环异常", error);
    }
  }, 1);
  console.warn("[Bearcade allstars] 1 tick 对局推进器已启动");
}

/** 订阅 probe 调试命令(幂等,只需一次) */
function ensureProbeCommand(): void {
  if (probeSubscribed) return;
  probeSubscribed = true;
  // 注意:scriptEventReceive 是 after 事件,但仍属于受限环境,
  // 所以这里只做"登记",真正的轮询在 runInterval 里做。
  system.afterEvents.scriptEventReceive.subscribe((event) => {
    try {
      if (event.id !== PROBE_COMMAND_ID) return;
      const player = event.sourceEntity;
      if (!player || player.typeId !== "minecraft:player") return;
      handleProbe(player as Player);
    } catch (error) {
      console.warn("[Bearcade allstars] probe 命令异常", error);
    }
  });
}

function handleProbe(player: Player): void {
  const facing = facingOfPlayer(player.id);
  startProbe(
    player,
    facing,
    (message) => {
      // 用 runtime.dbg(受调试开关控制)+ console.warn 双通道,
      // 保证没开调试时也能从内容日志看到
      runtime().dbg(message);
      console.warn(`[Bearcade allstars probe] ${message}`);
    },
  );
}

function facingOfPlayer(playerId: string): 1 | -1 {
  for (let roomId = 1; roomId <= ROOM_COUNT; roomId++) {
    const match = getMatch(roomId);
    if (!match) continue;
    const facing = match.facingOf(playerId);
    if (facing !== undefined) return facing;
  }
  // 不在任何对局里(例如在准备区):按面朝 +轴 处理,probe 仍可用
  return 1;
}

/** 该玩家是否正在某个房间里对局(大厅里的操作不该触发技能) */
function inMatch(playerId: string): boolean {
  for (let roomId = 1; roomId <= ROOM_COUNT; roomId++) {
    const match = getMatch(roomId);
    if (match && match.facingOf(playerId) !== undefined) return true;
  }
  return false;
}

/**
 * 订阅 hotbar 选中变化事件(技能键的**真正边缘触发**)。
 *
 * 规格要求"切到技能格立刻放技能,然后立刻回到空置格":只靠每 tick 轮询
 * selectedSlotIndex 的话,一旦客户端本地预测把槽位刷回来,同一格会被当成
 * **连按**(实机表现为"跳格连放技能")。事件给出的是"玩家真的换了格",
 * 天然一次一格;事件不可用时仍有 tick 循环里的"槽位变化"轮询兜底。
 */
function ensureHotbarEvents(): void {
  if (hotbarSubscribed) return;
  hotbarSubscribed = true;
  try {
    world.afterEvents.playerHotbarSelectedSlotChange.subscribe(
      (event) => {
        try {
          if (!inMatch(event.player.id)) return;
          // Capture the direction with the key. Native slot writes happen on
          // later match ticks, after this selection event has fully completed.
          handleSkillSelection(event.player, event.newSlotSelected);
        } catch {
          // 单次事件异常不影响对局
        }
      },
      { allowedSlots: [0, ...SKILL_ITEMS.map((item) => item.slot)] },
    );
    console.warn("[Bearcade allstars] hotbar 技能键事件已订阅(边缘触发)");
  } catch (error) {
    // 事件不可用:退回轮询兜底,功能不受影响
    console.warn(
      "[Bearcade allstars] hotbar 事件订阅失败,改用槽位变化轮询兜底",
      error,
    );
  }
}

export function makeAllStarsHooks(
  getRuntime: () => MinigameRuntime,
): MinigameHooks {
  runtimeGetter = getRuntime;
  return {
    onGameStart(roomId, players) {
      try {
        ensureTickLoop();
        ensureProbeCommand();
        ensureHotbarEvents();
        if (players.length < 2) {
          runtime().endGame(roomId, "人数不足", "§c需要 2 名玩家才能开始对决");
          return;
        }
        runtime().announce(roomId, `§6【${IN_GAME_NAME}】§a对局开始!`);
        const match = createMatch(runtime(), roomId, players);
        match?.start();
      } catch (error) {
        console.warn(`[Bearcade allstars] room${roomId} 开局初始化异常`, error);
        try {
          runtime().endGame(roomId, "开局失败", "§c开局初始化失败,即将返回大厅…");
        } catch {
          // 忽略
        }
      }
    },

    onBeforeReset(roomId) {
      try {
        // 清场(可重复执行):HUD / 相机 / 实体 / 输入权限 / 隐身 / 快捷栏
        resetRoom(roomId);
      } catch (error) {
        console.warn(`[Bearcade allstars] room${roomId} 结算清理异常`, error);
      }
      // 兜底:把还在房间里的玩家 HUD / 探针 / **相机** 清掉,免得残留到大厅。
      // 相机这条尤其重要:match 对象可能已经清掉,但玩家的 free 相机与
      // KO 特写的 38° FOV 是"玩家身上"的状态,不主动复位就会带进大厅。
      try {
        for (const player of runtime().roomPlayers(roomId)) {
          clearHudTitle(player);
          stopProbe(player.id);
          try {
            resetPlayerCamera(player);
          } catch {
            // 忽略
          }
        }
      } catch {
        // 忽略
      }
      // 没有任何对局时把 1 tick 推进器停掉,避免空转
      if (activeMatchCount() === 0 && tickHandle !== undefined) {
        try {
          system.clearRun(tickHandle);
        } catch {
          // 忽略
        }
        tickHandle = undefined;
        console.warn("[Bearcade allstars] 1 tick 对局推进器已停止");
      }
    },
  };
}
