// ============================================================
// HUD:血条/气条 + 局分
//
// 主方案 —— TextPrimitive 世界空间"伪屏幕"HUD:
//   相机的位姿由本包完全掌控(SideCamera 记录最近一次算出的位姿),
//   于是可以把"屏幕坐标"反算成世界坐标,再把 TextPrimitive 摆在相机前方:
//     - depthTest = false  → 永远渲染,不被方块/角色遮挡;
//     - 默认始终面向相机    → 天然的 HUD;
//     - visibleTo = 本房两人 → 逐玩家隔离,多房间并存不串台。
//   这样做的好处是**完全不碰** resource-pack/ui/hud_screen.json
//   (它与其它 20 个资源包逐字节相同,改动会与其它游戏冲突,见 lessons §10.3)。
//
// 演出期间隐藏原有四个 HUD 形状，结束后恢复；开场操控信息走 actionbar。
// TextPrimitive 不可用时记录日志，不切换到 title HUD。
//
// 不要用全局 Sidebar(lessons §10.1)。
// ============================================================

import {
  TextPrimitive,
  world,
  type Entity,
  type Player,
  type Vector3,
} from "@minecraft/server";
import {
  clearHudTitle,
} from "../../shared/minigame-core/scoreboardHud";
import { stripSectionCodes } from "../../shared/minigame-core/text";
import {
  CAMERA_ASPECT,
  HUD_HP_BAR_WIDTH,
  HUD_METER_BAR_WIDTH,
  MAX_HP,
  MAX_METER,
  ROUNDS_TO_WIN_MATCH,
  ROUND_SECONDS,
  SUPER_3_LOW_HEALTH_RATIO,
} from "./combat-config";
import { lastCameraPose, type CameraPose } from "./camera";
import type { Fighter } from "./fighter";
import { bodyPoint } from "./props";

// ---- TextPrimitive HUD 参数(可调) ----
/** "textPrimitive" = 世界空间悬浮字(主方案);"title" = title 通道降级 */
export const HUD_MODE: "textPrimitive" | "title" = "textPrimitive";
/**
 * 悬浮字所在平面到相机的距离(格)。
 * 浮空字的世界尺寸与 scale 绑定,取 4 格让"血条 + 空格 + 血条"这条长文本
 * 只占屏幕宽度的一部分(太近会被挤出画面两侧)。
 */
export const HUD_PLANE_DISTANCE = 4;
/** 文字缩放(整条太宽/太窄改它) */
export const HUD_SCALE = 1;
/** 左右两条血条之间的间隔(空格数):"中间用一段空格隔开" */
export const HUD_HP_GAP = 6;
/**
 * 屏幕布局:u∈[-1,1] 右正、v∈[-1,1] 上正。
 *
 * 规格(2026-09-25):**血条合成一条文本**(两边血条 + 中间一段空格),
 * 摆在"摄像头上方中心位置" ⇒ 前三行全部 u=0、贴着画面上沿；
 * 第四行是中央倒计时/KO 大字。左条 = P1(侧视下 P1 在屏幕左侧)、右条 = P2。
 */
export const HUD_LAYOUT = {
  /** 血条:左右两条 + 中间空格 */
  hp: { u: 0, v: 0.82 },
  /** 气条:同上,带 SP 前缀 */
  meter: { u: 0, v: 0.72 },
  /** 阶段 / 局数 / 比分 / 倒计时 */
  center: { u: 0, v: 0.62 },
  /** 中央大屏倒计时 / KO; 与前三个形状分开,保持原有大字演出。 */
  countdown: { u: 0, v: 0 },
} as const;
const HUD_SPOTS = [
  HUD_LAYOUT.hp,
  HUD_LAYOUT.meter,
  HUD_LAYOUT.center,
  HUD_LAYOUT.countdown,
];

/**
 * TextPrimitive 绑定透明锚点时使用的固定本地坐标。
 *
 * 旧实现每次刷新都把屏幕坐标反解成世界坐标，再写回四个字形；特写或
 * 大招切镜头时，目标相机仍在缓动，字形就会在锚点上重复追赶而抖动。
 * 锚点已经负责跟随屏幕中心，字形只保留固定的纵向间距。
 */
const HUD_LOCAL_OFFSETS: ReadonlyArray<Vector3> = [
  { x: 0, y: 1.82, z: 0 },
  { x: 0, y: 1.38, z: 0 },
  { x: 0, y: 0.94, z: 0 },
  { x: 0, y: 0, z: 0 },
];

export interface HudFighterInfo {
  name: string;
  hp: number;
  meter: number;
}

export interface HudState {
  /** 第几局(1 起) */
  round: number;
  /** 本局剩余 tick */
  remainTicks: number;
  /** 比分 [P1, P2] */
  score: [number, number];
  /** 阶段提示(如 "选人中" / "准备" / "第 2 局") */
  phaseLine: string;
  centerText?: string;
  /** 开场特写期间只显示当前操控者说明,隐藏血量/气条/回合信息。 */
  introOnly?: boolean;
  hideBars?: boolean;
  feedback?: [string?, string?];
  fighters: [HudFighterInfo, HudFighterInfo];
}

/** 用 ▍/▎绘制格斗 HUD 的条形；空缺格使用深灰色 section code。 */
function symbolBar(value: number, max: number, width: number): string {
  const ratio = max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  let filled = Math.round(ratio * width);
  if (filled === 0 && value > 0) filled = 1;
  if (filled === width && value < max) filled = width - 1;
  return `${"▍".repeat(filled)}§8${"▎".repeat(Math.max(0, width - filled))}§r`;
}

function symbolMeter(meter: number, width: number): string {
  const value = Number.isFinite(meter) ? Math.max(0, Math.min(MAX_METER, meter)) : 0;
  const full = Math.floor(value);
  const progress = full >= MAX_METER ? 1 : value - full;
  const filled = full >= MAX_METER ? width : Math.min(width - 1, Math.floor(progress * width + 1e-8));
  return `${full}气 ${"▍".repeat(filled)}§8${"▎".repeat(Math.max(0, width - filled))}§r ${full >= MAX_METER ? "MAX" : `${Math.floor(progress * 100 + 1e-8)}%`}`;
}

/** 已有整气 + 到下一气的进度；满 3 气时满条，不伪造第 4 气。 */
export function meterText(meter: number, width = HUD_METER_BAR_WIDTH): string {
  const value = Number.isFinite(meter) ? Math.max(0, Math.min(MAX_METER, meter)) : 0;
  const full = Math.floor(value);
  const maxed = full === MAX_METER;
  const progress = maxed ? 1 : value - full;
  const filled = maxed ? width : Math.min(width-1, Math.floor(progress * width + 1e-8));
  const track = `[${"=".repeat(filled)}${"-".repeat(width-filled)}]`;
  return `${full}气 ${track} ${maxed ? "MAX" : `${Math.min(99,Math.floor(progress*100+1e-8))}%`}`;
}

function hpValue(fighter: Fighter): number {
  return Math.max(0, Math.round(fighter.hp));
}

/** 血量低于 25% 时血条变黄，与气条的黄色条件分开。 */
function isLowHealth(info: HudFighterInfo): boolean {
  return info.hp / MAX_HP <= SUPER_3_LOW_HEALTH_RATIO;
}

/** 只有残血且确实拥有三气时，气条才使用黄色提示色。 */
function isLowHealthWithThreeMeter(info: HudFighterInfo): boolean {
  return isLowHealth(info) && info.meter >= MAX_METER;
}

/** 构建完整 HUD 文本(纯 ASCII + § 颜色码) */
export function buildHudText(state: HudState): string {
  if (state.introOnly) {
    return state.phaseLine;
  }
  const [p1, p2] = state.fighters;
  const seconds = Math.max(0, Math.ceil(state.remainTicks / 20));
  const timer = `${seconds}`.padStart(2, "0");
  const meterWidth = Math.max(1, HUD_METER_BAR_WIDTH);
  const phaseText = stripSectionCodes(state.phaseLine);
  const roundText = `第 ${state.round} 局`;
  const phaseWithRound = /第\s*\d+\s*局/.test(phaseText)
    ? phaseText
    : `${phaseText}  ${roundText}`;

  const lines: string[] = [
    `§6${phaseWithRound}`,
    `${isLowHealth(p1) ? "§e" : "§b"}${p1.name} P1 ${symbolBar(p1.hp, MAX_HP, HUD_HP_BAR_WIDTH)} ${Math.round(p1.hp)}`,
    `${isLowHealth(p2) ? "§e" : "§c"}${p2.name} P2 ${symbolBar(p2.hp, MAX_HP, HUD_HP_BAR_WIDTH)} ${Math.round(p2.hp)}`,
    `${isLowHealthWithThreeMeter(p1) ? "§e" : "§b"}${symbolMeter(p1.meter, meterWidth)} P1 §c/ ${isLowHealthWithThreeMeter(p2) ? "§e" : "§c"}${symbolMeter(p2.meter, meterWidth)} P2` +
      ` §7(${meterText(p1.meter, meterWidth)} P1 / ${meterText(p2.meter, meterWidth)} P2)` +
      `    §f${timer}s  ${state.score[0]}:${state.score[1]}`,
    `§7(先胜 ${ROUNDS_TO_WIN_MATCH} 局者赢,单局 ${ROUND_SECONDS} 秒)`,
  ];
  if (state.centerText) {
    lines.push(state.centerText === "ＫＯ" ? "§c§l✦ ＫＯ ✦" : `§c§l${state.centerText}`);
  }
  for (const [index, feedback] of (state.feedback ?? []).entries()) {
    if (feedback) lines.push(`§l${index === 0 ? "§b" : "§c"}${feedback}`);
  }
  return lines.join("\n");
}

/** 单人个性化(自己那行加 ">" 指示) */
export function buildHudTextFor(
  player: Player,
  state: HudState,
  selfSide: 0 | 1,
): string {
  const text = buildHudText(state);
  const lines = text.split("\n");
  // 行 1 = P1、行 2 = P2
  const idx = selfSide === 0 ? 1 : 2;
  if (lines[idx]) {
    // 保留这一行原本绑定 P1/P2 的颜色码，再加上自己的方向标记。
    const colorCode = lines[idx].startsWith("§") ? lines[idx].slice(0, 2) : "";
    lines[idx] = `${colorCode}§l>${lines[idx].slice(colorCode ? 2 : 0)}`;
  }
  void player;
  return lines.join("\n");
}

// ================= TextPrimitive 伪屏幕 HUD =================

interface ShapeSet {
  shapes: TextPrimitive[];
  playerIds: string[];
  anchor?: Entity;
}

/** 按"本房两人"为一组,组内 4 条悬浮字(血条 / 气条 / 中央信息 / 大屏提示) */
const shapeSets = new Map<string, ShapeSet>();
const seatMarkers = new Map<Entity, {shape: TextPrimitive; playerIds: string[]}>();
const actionBarPlayers = new Set<string>();
/** 创建失败(多为 maxShapes 上限)后停用，避免每 tick 抛错。 */
let primitiveHudDisabled = false;

function isUsable(player: Player | undefined): player is Player {
  if (!player) return false;
  try {
    return player.isValid;
  } catch {
    return false;
  }
}

function groupKey(playerIds: string[]): string {
  return [...playerIds].sort().join("|");
}

function validAnchor(anchor: Entity | undefined): anchor is Entity {
  if (!anchor) return false;
  try {
    return anchor.isValid;
  } catch {
    return false;
  }
}

function ensureShapeSet(
  players: Player[],
  anchor?: Entity,
): ShapeSet | undefined {
  if (primitiveHudDisabled) return undefined;
  const key = groupKey(players.map((p) => p.id));
  const existing = shapeSets.get(key);
  if (existing) {
    if (validAnchor(anchor) && existing.anchor !== anchor) {
      existing.anchor = anchor;
      for (const shape of existing.shapes) shape.attachedTo = anchor;
    } else if (!validAnchor(anchor) && existing.anchor) {
      existing.anchor = undefined;
      for (const shape of existing.shapes) shape.attachedTo = undefined;
    }
    return existing;
  }

  const dimension = players[0]?.dimension;
  if (!dimension) return undefined;

  const shapes: TextPrimitive[] = [];
  try {
    for (let i = 0; i < HUD_SPOTS.length; i++) {
      // 初始放到世界外,refresh 时再移到相机前
      const shape = new TextPrimitive({ x: 0, y: -2048, z: 0 }, "");
      shape.depthTest = false;
      shape.visibleTo = players;
      shape.scale = i === 3 ? HUD_SCALE * 3 : HUD_SCALE;
      shape.backgroundColorOverride = {
        red: 0,
        green: 0,
        blue: 0,
        alpha: i === 3 ? 0 : 0.45,
      };
      if (validAnchor(anchor)) shape.attachedTo = anchor;
      world.primitiveShapesManager.addText(shape, dimension);
      shapes.push(shape);
    }
  } catch (error) {
    // 上限/引擎异常:回收已建形状，保持对局继续运行
    for (const shape of shapes) {
      try {
        world.primitiveShapesManager.removeText(shape);
      } catch {
        // 忽略
      }
    }
    primitiveHudDisabled = true;
    console.warn(
      "[Bearcade allstars] TextPrimitive HUD 创建失败,已暂停 HUD",
      error,
    );
    return undefined;
  }

  const set: ShapeSet = {
    shapes,
    playerIds: players.map((p) => p.id),
    anchor: validAnchor(anchor) ? anchor : undefined,
  };
  shapeSets.set(key, set);
  return set;
}

function disposeSetsFor(playerIds: string[]): void {
  const clearing = new Set(playerIds);
  for (const [key, set] of Array.from(shapeSets.entries())) {
    if (!set.playerIds.some((id) => clearing.has(id))) continue;
    for (const shape of set.shapes) {
      try {
        world.primitiveShapesManager.removeText(shape);
      } catch {
        // 形状可能已被引擎清理:忽略
      }
    }
    shapeSets.delete(key);
  }
}

/** 屏幕坐标(u,v)→ 世界坐标(相机前方 HUD_PLANE_DISTANCE 处的平面) */
export function screenToWorld(pose: CameraPose, u: number, v: number): Vector3 {
  const yaw = (pose.yaw * Math.PI) / 180;
  const pitch = (pose.pitch * Math.PI) / 180;
  const fwd: Vector3 = {
    x: -Math.sin(yaw) * Math.cos(pitch),
    y: -Math.sin(pitch),
    z: Math.cos(yaw) * Math.cos(pitch),
  };
  // yaw 0 = 面向 +Z 时右手边为 -X(见 camera.lookAt 的角度约定)
  const right: Vector3 = { x: -Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
  const up: Vector3 = {
    x: right.y * fwd.z - right.z * fwd.y,
    y: right.z * fwd.x - right.x * fwd.z,
    z: right.x * fwd.y - right.y * fwd.x,
  };
  const d = HUD_PLANE_DISTANCE;
  const halfH = Math.tan(((pose.fov / 2) * Math.PI) / 180) * d;
  const halfW = halfH * CAMERA_ASPECT;
  return {
    x: pose.pos.x + fwd.x * d + right.x * u * halfW + up.x * v * halfH,
    y: pose.pos.y + fwd.y * d + right.y * u * halfW + up.y * v * halfH,
    z: pose.pos.z + fwd.z * d + right.z * u * halfW + up.z * v * halfH,
  };
}

/** 4 行悬浮字内容(一行一条,全部居中)。颜色和提示作为文字内容更新。 */
function primitiveLines(state: HudState): string[] {
  if (state.introOnly) {
    return ["", "", "", ""];
  }
  if (state.hideBars) return ["", "", "", state.centerText === "ＫＯ" ? "§e§l✦ ＫＯ ✦" : ""];
  const [p1, p2] = state.fighters;
  const seconds = Math.max(0, Math.ceil(state.remainTicks / 20));
  const meterWidth = Math.max(1, HUD_METER_BAR_WIDTH);
  // 颜色固定绑定 P1/P2：两名玩家看到的同一侧永远同色；低血量仅切黄色。
  const p1HpCode = isLowHealth(p1) ? "§e" : "§b";
  const p2HpCode = isLowHealth(p2) ? "§e" : "§c";
  const p1MeterCode = isLowHealthWithThreeMeter(p1) ? "§e" : "§b";
  const p2MeterCode = isLowHealthWithThreeMeter(p2) ? "§e" : "§c";
  const feedback = (state.feedback ?? [])
    .map((text, index) => text ? `${index === 0 ? "§b" : "§c"}${text}` : "")
    .filter(Boolean)
    .join(" §8/§r ");
  const phaseText = stripSectionCodes(state.phaseLine);
  const centerText = stripSectionCodes(state.centerText ?? "");
  const centerSuffix = centerText && !phaseText.includes(centerText) ? `  ${centerText}` : "";
  const phaseWithRound = /第\s*\d+\s*局/.test(phaseText)
    ? phaseText
    : `${phaseText}  第 ${state.round} 局`;
  return [
    // 首尾数字保持无色，兼容旧版客户端与调试探针；中间条段带 §b/§c。
    `${Math.round(p1.hp)} ${p1HpCode}${symbolBar(p1.hp, MAX_HP, HUD_HP_BAR_WIDTH)}§r` +
      `      ${p2HpCode}${symbolBar(p2.hp, MAX_HP, HUD_HP_BAR_WIDTH)}§r ${Math.round(p2.hp)}`,
    `${p1MeterCode}${symbolMeter(p1.meter, meterWidth)}§r      ${p2MeterCode}${symbolMeter(p2.meter, meterWidth)}§r`,
    `${phaseWithRound}  ${state.score[0]}:${state.score[1]}  ${seconds}s` +
      centerSuffix +
      (feedback ? `  ${feedback}` : ""),
    state.centerText === "ＫＯ"
      ? "§c§l✦ ＫＯ ✦"
      : stripSectionCodes(state.centerText ?? ""),
  ];
}

// ================= 对外接口 =================

/**
 * 刷新 HUD。
 * 调用方(Match)保证每 HUD_REFRESH_TICKS tick 调一次,且运行在 runInterval 内。
 */
export function refresh(
  players: (Player | undefined)[],
  state: HudState,
  _sideOf: (player: Player) => 0 | 1,
  anchor?: Entity,
): void {
  const usable = players.filter(isUsable);
  if (usable.length === 0) return;

  for (const player of usable) {
    try {
      if (state.introOnly) {
        player.onScreenDisplay.setActionBar(state.phaseLine);
        actionBarPlayers.add(player.id);
      } else if (actionBarPlayers.delete(player.id)) player.onScreenDisplay.setActionBar("");
    } catch { /* player left */ }
  }

  if (HUD_MODE === "title") {
    // This game uses TextPrimitive only; never replace the bars with a title HUD.
    return;
  }

  // 位姿取本房任一玩家最近一次下发的相机位姿(同房两人相机一致)
  let pose: CameraPose | undefined;
  for (const player of usable) {
    pose = lastCameraPose(player.id);
    if (pose) break;
  }
  if (!pose) {
    // 相机还没下发，等待下一次刷新。
    return;
  }

  const set = ensureShapeSet(usable, anchor);
  if (!set) {
    return;
  }

  const lines = primitiveLines(state);
  const attached = validAnchor(anchor) && set.anchor === anchor;
  for (let i = 0; i < set.shapes.length; i++) {
    try {
      const screenKo = i === 3 && state.centerText === "ＫＯ";
      set.shapes[i].attachedTo = screenKo ? undefined : attached ? anchor : undefined;
      if (attached && !screenKo) {
        // 绑定锚点后只写固定本地坐标；镜头移动由锚点实体承担，避免
        // 每次相机插值都再次重定位血条/气条。
        set.shapes[i].setLocation(HUD_LOCAL_OFFSETS[i] ?? { x: 0, y: 0, z: 0 });
      } else {
        const spot = screenToWorld(pose, HUD_SPOTS[i].u, HUD_SPOTS[i].v);
        set.shapes[i].setLocation(spot);
      }
      set.shapes[i].setText(lines[i] ?? "");
      // visibleTo=[] means EVERY player in the API, not hidden. Keep room
      // scoping and hide empty cinematic shapes with zero scale/background.
      set.shapes[i].visibleTo = usable;
      set.shapes[i].scale = !lines[i] && (state.introOnly || state.hideBars) ? 0 : i===3 ? HUD_SCALE*3 : HUD_SCALE;
      set.shapes[i].backgroundColorOverride = {red:0,green:0,blue:0,alpha:lines[i] && i<3 ? 0.45 : 0};
    } catch {
      // 单个形状失败不影响其它元素
    }
  }
}

/** 清 HUD(清理契约,可重复执行) */
export function clear(players: (Player | undefined)[]): void {
  const ids = players.filter(isUsable).map((player) => player.id);
  if (ids.length > 0) disposeSetsFor(ids);
  for (const [entity, marker] of seatMarkers) {
    if (!marker.playerIds.some(id => ids.includes(id))) continue;
    try { world.primitiveShapesManager.removeText(marker.shape); } catch { /* already removed */ }
    seatMarkers.delete(entity);
  }
  for (const player of players) {
    if (!isUsable(player)) continue;
    try {
      clearHudTitle(player);
      if (actionBarPlayers.delete(player.id)) player.onScreenDisplay.setActionBar("");
    } catch {
      // 忽略
    }
  }
}

/** Separate world-space seat labels, attached to each actual fighter model. */
export function refreshSeatMarkers(players: Player[], fighters: readonly Fighter[]): void {
  const viewers = players.filter(isUsable);
  if (viewers.length === 0) return;
  for (const fighter of fighters) {
    const entity = fighter.entity;
    if (!entity?.isValid) continue;
    let marker = seatMarkers.get(entity);
    try {
      if (!marker) {
        const shape = new TextPrimitive({x:0,y:2.7,z:0}, fighter.side === 0 ? "§b§l1P" : "§c§l2P");
        shape.attachedTo = entity;
        shape.depthTest = false;
        shape.scale = 0.8;
        shape.backgroundColorOverride = {red:0,green:0,blue:0,alpha:0};
        shape.color = fighter.side === 0 ? {red:0.35,green:0.85,blue:1,alpha:1} : {red:1,green:0.35,blue:0.35,alpha:1};
        shape.visibleTo = viewers;
        world.primitiveShapesManager.addText(shape, fighter.dimension);
        marker = {shape,playerIds:viewers.map(p=>p.id)};
        seatMarkers.set(entity,marker);
      }
      const head = bodyPoint(fighter,"head"), root = entity.location;
      marker.shape.setLocation({x:head.x-root.x,y:head.y-root.y+0.18,z:head.z-root.z});
      const visible=fighter.isOnStage && Number(entity.getProperty("bearcade:allstars_opacity") ?? 1)>0;
      marker.shape.visibleTo = viewers;
      marker.shape.scale = visible ? 0.8 : 0;
      marker.shape.setText(visible ? fighter.side===0 ? "§b§l1P" : "§c§l2P" : "");
    } catch { /* One marker failure must not disable the health HUD. */ }
  }
}

/** 便捷构造:从两名 Fighter + 比分生成 HUD 状态 */
export function stateFrom(
  fighters: [Fighter, Fighter],
  round: number,
  remainTicks: number,
  score: [number, number],
  phaseLine: string,
): HudState {
  return {
    round,
    remainTicks,
    score,
    phaseLine,
    feedback: [undefined, undefined],
    fighters: [
      { name: fighters[0].name, hp: hpValue(fighters[0]), meter: fighters[0].meter },
      { name: fighters[1].name, hp: hpValue(fighters[1]), meter: fighters[1].meter },
    ],
  };
}
