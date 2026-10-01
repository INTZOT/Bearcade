// ============================================================
// 游戏进入开关
// /bearcade:enable <game> true|false 与开发者面板的开关组件共用。
// 语义:只控制"能否从大厅进入",不影响已在对局中的玩家、
// 房间状态上报与注册;状态持久化,重启后仍然生效。
// ============================================================
import { world } from "@minecraft/server";

const ACCESS_KEY = "bearcade:game_access";

/** 被关闭进入的游戏 id 集合(不在集合内 = 开放) */
const closedGames = new Set<string>();

/** worldLoad 时恢复(与 loadPartyMode 同处调用) */
export function loadGameAccess(): void {
  closedGames.clear();
  try {
    const raw = world.getDynamicProperty(ACCESS_KEY);
    if (typeof raw !== "string" || raw.length === 0) return;
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (typeof item === "string" && /^[a-z0-9_]+$/.test(item)) {
        closedGames.add(item);
      }
    }
    if (closedGames.size > 0) {
      console.warn(
        `[Bearcade Core] 已恢复 ${closedGames.size} 个关闭进入的游戏:${[...closedGames].join("、")}`,
      );
    }
  } catch (error) {
    console.warn("[Bearcade Core] 游戏进入开关加载失败", error);
  }
}

function persist(): void {
  try {
    world.setDynamicProperty(ACCESS_KEY, JSON.stringify([...closedGames]));
  } catch (error) {
    console.warn("[Bearcade Core] 游戏进入开关持久化失败", error);
  }
}

/** 该游戏是否开放进入(缺省开放) */
export function isGameOpen(game: string): boolean {
  return !closedGames.has(game);
}

/** 设置开放/关闭;返回是否发生了变更 */
export function setGameOpen(game: string, open: boolean): boolean {
  if (open === isGameOpen(game)) return false;
  if (open) {
    closedGames.delete(game);
  } else {
    closedGames.add(game);
  }
  persist();
  return true;
}
