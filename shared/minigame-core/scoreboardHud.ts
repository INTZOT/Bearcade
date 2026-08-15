// ============================================================
// 每玩家独立记分板 HUD(配合各行为包 resource-pack/ 的 JSON UI,构建时拆分为一对一资源包):
// - 分数数据仍存在每房间独立 scoreboard objective 中;
// - 不使用全局 Sidebar 显示槽(避免多房间/多游戏互相覆盖);
// - 通过 rawtext { score: { name, objective } } 把本房间分数注入
//   player.setTitle(),JSON UI 将标题通道重排版为右上角记分板。
// 每个玩家拿到的是自己的 title 实例,因此多房间天然隔离。
// ============================================================
import { world, type Player, type RawMessage, type ScoreboardIdentity, type ScoreboardObjective } from "@minecraft/server";

const HUD_TITLE_STAY_TICKS = 80;
const identityCache = new Map<string, ScoreboardIdentity>();

export function objectiveKey(objectiveId: string): string {
  return objectiveId;
}

/** 创建/复用房间计分板 objective(不再挂到任何全局显示槽) */
export function ensureObjective(
  objectiveId: string,
  displayName: string,
): ScoreboardObjective | undefined {
  try {
    const existing = world.scoreboard.getObjective(objectiveId);
    if (existing) return existing;
    return world.scoreboard.addObjective(objectiveId, displayName);
  } catch (error) {
    console.warn(`[Bearcade HUD] 创建计分板失败 ${objectiveId}`, error);
    return undefined;
  }
}

/**
 * 给真实玩家或假玩家写分。假玩家使用缓存的 ScoreboardIdentity,
 * 避免每次 setScore(字符串) 反复创建新的假玩家身份(见 lessons §? 计分板避坑)。
 */
export function setObjectiveScore(
  objective: ScoreboardObjective,
  participant: string | Player,
  score: number,
): void {
  try {
    if (typeof participant === "string") {
      const key = `${objective.id}:${participant}`;
      let identity = identityCache.get(key);
      if (!identity || !identity.isValid) {
        objective.setScore(participant, score);
        const found = objective
          .getParticipants()
          .find((item) => item.displayName === participant);
        if (found) identityCache.set(key, found);
        return;
      }
      objective.setScore(identity, score);
      return;
    }
    objective.setScore(participant, score);
  } catch (error) {
    console.warn(
      `[Bearcade HUD] 写分失败 objective=${objective.id} participant=${typeof participant === "string" ? participant : participant.id}`,
      error,
    );
  }
}

/** 移除 objective,并清掉对应假玩家身份缓存 */
export function releaseObjective(objectiveId: string): void {
  try {
    const objective = world.scoreboard.getObjective(objectiveId);
    if (objective) {
      world.scoreboard.removeObjective(objective);
    }
  } catch {
    // objective 可能已不存在
  }
  for (const key of identityCache.keys()) {
    if (key.startsWith(`${objectiveId}:`)) {
      identityCache.delete(key);
    }
  }
}

export function scoreToken(name: string, objectiveId: string): RawMessage {
  return { score: { name, objective: objectiveId } };
}

/** 把多段 RawMessage 拼成一个 rawtext 标题 */
export function hudMessage(parts: RawMessage[]): RawMessage {
  return { rawtext: parts };
}

/** 每玩家独立 HUD 标题;周期性刷新用默认 stay,静态提示可传更长 stay */
export function setHudTitle(
  player: Player,
  message: RawMessage | string,
  stayTicks: number = HUD_TITLE_STAY_TICKS,
): void {
  try {
    player.onScreenDisplay.setTitle(message, {
      fadeInDuration: 0,
      stayDuration: stayTicks,
      fadeOutDuration: 0,
    });
  } catch (error) {
    console.warn(`[Bearcade HUD] 设置 HUD 失败 player=${player.id}`, error);
  }
}

export function clearHudTitle(player: Player): void {
  try {
    player.onScreenDisplay.setTitle("", {
      fadeInDuration: 0,
      stayDuration: 1,
      fadeOutDuration: 0,
    });
  } catch {
    // 忽略
  }
}
