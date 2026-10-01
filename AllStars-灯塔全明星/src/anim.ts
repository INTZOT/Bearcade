// ============================================================
// 动画驱动门面
//
// Persistent BP properties select exactly one native RP track and its source time.
// Scripts own once/loop/hold; freezing source time freezes bones without replay packets.
// This path must run in a writable Script API tick, not a before-event callback.
// ============================================================

import { system, type Entity, type Player } from "@minecraft/server";
import { CHUNYE_CLIPS, clipGameTicks } from "./data/chunye.clips";
import { clearHudTitle, hudMessage, setHudTitle } from "../../shared/minigame-core/scoreboardHud";

export { clipGameTicks };

export interface PlayClipOptions {
  /** 目标在播同一 clip 时也重新播放(连打/受击重复触发) */
  force?: boolean;
  /** Resume an authored failure/pair branch at its shared source time (seconds). */
  startSeconds?: number;
  /** 只对该玩家可见(默认全场可见) */
  players?: Player[];
  /** 混合淡出时长(秒),默认交给引擎 */
  blendOutTime?: number;
}

interface ClipRecord {
  clipId: string;
  /** 开始播放的 tick */
  startTick: number;
  /** 预计结束的 tick(startTick + gameTicks - 1) */
  endTick: number;
  /** 是否循环动画 */
  loop: boolean;
  elapsed: number;
}

const records = new WeakMap<Entity, ClipRecord>();
// Presentation hiding masks the current animation's visibility without replacing it.
// A dash/landing/advanceClip owner must not reveal an actor during another close-up.
const presentationHidden = new WeakSet<Entity>();
const bodyOpacity = new WeakMap<Entity, number>();

/** 动画名解析:短名 → 完整名。未知 id 返回 undefined(不抛错)。 */
export function clipFullName(clipId: string): string | undefined {
  return CHUNYE_CLIPS[clipId]?.name;
}

/** 该 clip 是否存在 */
export function hasClip(clipId: string): boolean {
  return CHUNYE_CLIPS[clipId] !== undefined;
}

/**
 * 播放一段动画。返回是否成功更新了客户端同步播放状态
 * (false = 实体无效 / clip 不存在 / 同 clip 未 force = 被吞掉)。
 */
export function playClip(
  entity: Entity | undefined,
  clipId: string,
  options: PlayClipOptions = {},
): boolean {
  if (!entity) return false;
  try {
    if (!entity.isValid) return false;
  } catch {
    return false;
  }

  const fullName = clipFullName(clipId);
  if (!fullName) {
    console.warn(`[Bearcade allstars] 未知动画 id: ${clipId}`);
    return false;
  }

  const now = system.currentTick;
  const prev = records.get(entity);
  if (
    prev &&
    prev.clipId === clipId &&
    !options.force &&
    (prev.loop || prev.elapsed < clipTotal(entity))
  ) {
    // 同 clip 且仍在播放(或循环中)→ 不重发,避免每 tick 重播造成的段落 snap
    return false;
  }

  const ticks = Math.max(1, CHUNYE_CLIPS[clipId]!.seconds * 20);
  const elapsed = Math.max(0, (options.startSeconds ?? 0) * 20);
  const record: ClipRecord = {
    clipId, startTick: now, endTick: now + ticks - elapsed,
    loop: CHUNYE_CLIPS[clipId]?.loop ?? false, elapsed,
  };
  records.set(entity, record);
  // Persistent synced state survives entity/client loading; no one-shot animation packet to miss.
  try {
    entity.setProperty("bearcade:allstars_clip", CLIP_IDS.indexOf(clipId));
    publishTime(entity, record);
  } catch (error) {
    records.delete(entity);
    console.warn(`[Bearcade allstars] 动画属性写入失败 ${clipId}`, error);
    return false;
  }

  return true;
}

/** 当前正在播放的 clip id */
export function currentClip(entity: Entity | undefined): string | undefined {
  if (!entity) return undefined;
  return records.get(entity)?.clipId;
}

/** 当前 clip 已播放的 tick 数(无记录返回 0) */
export function clipElapsed(entity: Entity | undefined): number {
  if (!entity) return 0;
  const record = records.get(entity);
  if (!record) return 0;
  return record.elapsed;
}

/** 当前 clip 的总时长(游戏 tick);无记录返回 0 */
export function clipTotal(entity: Entity | undefined): number {
  if (!entity) return 0;
  const record = records.get(entity);
  if (!record) return 0;
  return CHUNYE_CLIPS[record.clipId]!.seconds * 20;
}

/** 当前 clip 是否已播完(循环动画恒为 false) */
export function clipFinished(entity: Entity | undefined): boolean {
  if (!entity) return true;
  const record = records.get(entity);
  if (!record) return true;
  if (record.loop) return false;
  return record.elapsed >= clipTotal(entity);
}

/** 当前 clip 播放进度 0~1(无记录返回 1) */
export function clipProgress(entity: Entity | undefined): number {
  const total = clipTotal(entity);
  if (total <= 0) return 1;
  return Math.min(1, clipElapsed(entity) / total);
}

/** 清除记录(实体移除前调用,避免 WeakMap 残留误判) */
export function forgetClip(entity: Entity | undefined): void {
  if (entity) records.delete(entity);
}

// ============================================================
// 受击/结算类动画的"最短展示时间"守卫
// 招式硬直(几十 tick)常常长于 hit_stand(5 tick),若无条件在硬直结束后回 idle,
// 受击动作会被硬直时间盖住看不出来。这里给一次性动画保留一个最小时长。
// ============================================================

const reactHold = new Map<string, number>();

/** 给一次性动画设置最短展示结束 tick */
export function holdClipUntil(entityId: string, ticks: number): void {
  reactHold.set(entityId, system.currentTick + Math.max(1, ticks));
}

/** 该实体是否仍处于"最短展示"窗口内 */
export function isClipHeld(entityId: string): boolean {
  const until = reactHold.get(entityId);
  if (until === undefined) return false;
  if (system.currentTick >= until) {
    reactHold.delete(entityId);
    return false;
  }
  return true;
}

export function releaseClipHold(entityId: string): void {
  reactHold.delete(entityId);
}

// ============================================================
// 过渡动画 → 循环动画的延后衔接
//
// 为什么需要:
//   crouch_enter / crouch_exit / jump_start / jump_land 都是 1~3 tick 的
//   过渡段,播完要接 idle_crouch / idle_stand。如果在同一 tick 里连续调用
//   playClip(过渡) + playClip(循环),第二次调用会把第一次的动画直接顶掉,
//   过渡段**一帧都看不到**。
//   所以这里登记"tick 到点后再播"的待播动画。
// ============================================================

interface PendingClip {
  clipId: string;
  atTick: number;
  force: boolean;
}

const pendingClips = new Map<string, PendingClip>();

/** 登记一段"ticks 之后"再播的动画(覆盖同 key 的旧登记) */
export function queueClip(
  key: string,
  clipId: string,
  ticks: number,
  force = false,
): void {
  pendingClips.set(key, {
    clipId,
    atTick: system.currentTick + Math.max(1, ticks),
    force,
  });
}

/**
 * 每 tick 调用:到点则播待播动画。
 * @returns 本 tick 是否播了待播动画
 */
export function flushQueuedClip(entity: Entity | undefined, key: string): boolean {
  const pending = pendingClips.get(key);
  if (!pending) return false;
  if (system.currentTick < pending.atTick) return false;
  pendingClips.delete(key);
  return playClip(entity, pending.clipId, { force: pending.force });
}

export function clearQueuedClip(key: string): void {
  pendingClips.delete(key);
}

// ============================================================
// 兜底 HUD 提示:动画名解析失败时给玩家一条可见警告(便于实机定位资产问题)
// ============================================================

export function warnMissingClip(player: Player, clipId: string): void {
  try {
    setHudTitle(
      player,
      hudMessage([{ text: `§c缺少动画:${clipId}` }]),
      40,
    );
  } catch {
    // 忽略
  }
}

export { clearHudTitle };

const CLIP_IDS = Object.keys(CHUNYE_CLIPS).sort();
function publishTime(entity: Entity, record: ClipRecord): void {
  const seconds = CHUNYE_CLIPS[record.clipId]!.seconds;
  const t = record.elapsed / 20;
  entity.setProperty("bearcade:allstars_time", record.loop ? t % seconds : Math.min(t, Math.max(0, seconds - 1e-4)));
}
/** Called once per simulation tick, including intro/results. 0 freezes bones; .1 is actual slow motion. */
export function advanceClip(entity: Entity | undefined, gameTicks = 1): void {
  if (!entity) return;
  const record = records.get(entity);
  if (!record) return;
  record.elapsed += Math.max(0, gameTicks);
  try { publishTime(entity, record); } catch { /* removed entity */ }
}
export function seekClip(entity: Entity | undefined, seconds: number): void {
  if (!entity) return;
  const record = records.get(entity);
  if (!record) return;
  record.elapsed = Math.max(0, seconds * 20);
  try { publishTime(entity, record); } catch { /* removed entity */ }
}
export function setBodyOpacity(entity: Entity | undefined, alpha: number): void {
  if (!entity) return;
  const value = Math.max(0, Math.min(1, alpha));
  bodyOpacity.set(entity, value);
  try { entity.setProperty("bearcade:allstars_opacity", presentationHidden.has(entity) ? 0 : value); } catch { /* cleanup */ }
}
export function setPresentationHidden(entity: Entity | undefined, hidden: boolean): void {
  if (!entity) return;
  if (hidden) presentationHidden.add(entity);
  else presentationHidden.delete(entity);
  setBodyOpacity(entity, bodyOpacity.get(entity) ?? 1);
}
export function delayQueuedClip(key: string, ticks: number): void {
  const pending = pendingClips.get(key);
  if (pending) pending.atTick += ticks;
}
