// ============================================================
// Core → 游戏包 动作层
// /bearcade:* 命令(commands.ts)与开发者面板(devenv.ts)共用同一份实现,
// 避免"命令一套、面板一套"的逻辑漂移。
// 所有函数只做内存校验,原生调用一律经 system.run 延迟
// (命令回调运行在 restricted execution 上下文)。
// ============================================================
import { system, world, type Player } from "@minecraft/server";
import { CORE_PACK_ID, IPC_CHANNEL, LOBBY_DIMENSION_ID } from "./types";
import type { GameRegistry } from "./registry";

/** 模板类动作:tp=进入模板维度,ap=应用模板到全部房间,sz=模板范围配置 */
export type TmpAction = "tp" | "ap" | "sz";

/** 房间维度命名匹配(与 shared/minigame-core 的 roomPattern 一致) */
export const ROOM_DIM_PATTERN = /^bearcade:([a-z0-9_]+)_\d+$/;

/** 动作结果:失败时 reason 为可直接展示给玩家的中文提示 */
export type ActionResult = { ok: true } | { ok: false; reason: string };

/** Core 向游戏包下发 IPC 指令的唯一出口 */
export function sendToGame(op: string, payload: unknown): void {
  try {
    system.sendScriptEvent(
      IPC_CHANNEL,
      JSON.stringify({ op, packId: CORE_PACK_ID, payload }),
    );
  } catch (error) {
    console.warn(`[Bearcade Core] 下发指令失败(${op})`, error);
  }
}

/** 传送回大厅默认出生点(需在正常执行上下文调用) */
export function teleportToLobby(player: Player): void {
  try {
    player.teleport(world.getDefaultSpawnLocation(), {
      dimension: world.getDimension(LOBBY_DIMENSION_ID),
    });
  } catch (error) {
    console.warn("[Bearcade Core] 传送回大厅失败", error);
  }
}

/** 请求模板动作(进入模板维度 / 应用模板 / 模板范围配置) */
export function requestTmpAction(
  registry: GameRegistry,
  player: Player,
  action: TmpAction,
  game: string,
): ActionResult {
  if (!registry.getActiveGame(game)) {
    return { ok: false, reason: `未知游戏:${game}` };
  }
  system.run(() => {
    if (action === "tp") {
      sendToGame("game.tp", { game, playerId: player.id });
    } else if (action === "ap") {
      sendToGame("game.apply", { game, playerId: player.id });
    } else {
      sendToGame("game.sz", { game, playerId: player.id });
    }
  });
  return { ok: true };
}

/** 请求强制中止指定维度正在进行的对局 */
export function requestQuitDimension(
  registry: GameRegistry,
  dimensionId: string,
): ActionResult {
  const match = ROOM_DIM_PATTERN.exec(dimensionId);
  if (!match) {
    return { ok: false, reason: "当前维度不是游戏房间" };
  }
  const game = match[1];
  if (!registry.getActiveGame(game)) {
    return { ok: false, reason: `未知游戏:${game}` };
  }
  system.run(() => sendToGame("game.quit", { game, dimensionId }));
  return { ok: true };
}

/** 请求打开某游戏的运行时配置界面 */
export function requestConfig(
  registry: GameRegistry,
  player: Player,
  game: string,
): ActionResult {
  if (!registry.getActiveGame(game)) {
    return { ok: false, reason: `未知游戏:${game}` };
  }
  system.run(() => sendToGame("game.config", { game, playerId: player.id }));
  return { ok: true };
}

/** 请求切换调试日志;game 为 "all" 时逐游戏下发 */
export function requestDebug(
  registry: GameRegistry,
  player: Player,
  game: string,
  enabled: boolean,
): ActionResult {
  if (game === "all") {
    system.run(() => {
      for (const entry of registry.listGames()) {
        sendToGame("game.debug", {
          game: entry.game,
          playerId: player.id,
          enabled,
        });
      }
    });
    return { ok: true };
  }
  if (!registry.getActiveGame(game)) {
    return { ok: false, reason: `未知游戏:${game}` };
  }
  system.run(() =>
    sendToGame("game.debug", { game, playerId: player.id, enabled }),
  );
  return { ok: true };
}

/**
 * 读取某游戏调试开关的当前状态(仅用于面板展示)。
 * 键 bearcade:debug_<gameid> 由 shared/minigame-core 的 MinigameRuntime 写入,
 * 切换动作仍统一走 game.debug IPC,不直接改这里。
 */
export function isGameDebugEnabled(game: string): boolean {
  try {
    return world.getDynamicProperty(`bearcade:debug_${game}`) === true;
  } catch {
    return false;
  }
}
