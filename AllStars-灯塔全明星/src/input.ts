// ============================================================
// 输入重定向:控制笼 + Intent 推导 + /scriptevent allstars:probe 调试
//
// 背景(M1 最大不确定项):
//   `player.inputInfo.getMovementVector()` 的**轴向语义未经实机确认**——
//   无法确定返回的 x/y 是"相机相对"还是"世界相对",也不知道哪个分量对应
//   前后推杆。因此:
//     - 所有轴向判定集中在本文件的 deriveIntent(),不散落到别处;
//     - 未校准时轴向假设由 combat-config.ts 的 INPUT_AXIS_MODE(配
//       INPUT_HORIZONTAL_SIGN / INPUT_DEPTH_SIGN)一行切换;
//       实机跑 `/bearcade:allstars_calibrate` 后,校准结果(持久化在 world
//       动态属性)会**覆盖**这三个默认常量;
//     - /scriptevent allstars:probe 打印 5 秒原始值,校准前后都可复核。
//
// 控制笼设计:
//   玩家的**移动输入必须保持可用**(否则读不到方向),但玩家本体不能真的
//   在场上乱跑。做法:每 tick 把玩家拉回笼内锚点(水平归位、朝向锁定),
//   同时隐身 + 禁跳跃/潜行权限。这样 movement vector 仍是"玩家想往哪走"。
// ============================================================

import {
  BlockVolume,
  EntityComponentTypes,
  GameMode,
  HudElement,
  HudVisibility,
  InputButton,
  InputPermissionCategory,
  ItemStack,
  ItemLockMode,
  system,
  type Container,
  type EntityInventoryComponent,
  type Player,
  type Vector3,
} from "@minecraft/server";
import {
  ARENA_AXIS,
  CAGE_DISABLE_JUMP_INPUT,
  CAGE_DISABLE_SNEAK_INPUT,
  CAGE_KEEP_MOVEMENT_INPUT,
  DASH_DOUBLE_TAP_TICKS,
  DASH_TAP_THRESHOLD,
  GUARD_HORIZONTAL_BACK_SIGN,
  GUARD_HORIZONTAL_THRESHOLD,
  GUARD_ON_HORIZONTAL_BACK,
  GUARD_ON_HOLD_BACK,
  INPUT_AXIS_MODE,
  INPUT_BUTTON_FALLBACK,
  INPUT_DEADZONE,
  INPUT_DEPTH_SIGN,
  INPUT_DEPTH_THRESHOLD,
  INPUT_HORIZONTAL_SIGN,
  PLAYER_INVISIBILITY_TICKS,
  PROBE_COMMAND_ID,
  PROBE_DURATION_TICKS,
  PLAYER_TAG,
  SKILL_ITEMS,
} from "./combat-config";
import type { ArenaAxis, InputAxisMode, SuperTier } from "./combat-config";
import { getInputCalibration } from "./calib";

/** 角色朝向:相对竞技场轴,+1 = 朝轴正方向,-1 = 朝轴负方向 */
export type Facing = 1 | -1;

/** 一 tick 的玩家意图(全部由原始输入推导,不含招式状态机) */
export interface Intent {
  /** 左右轴 -1..1(绝对屏幕方向:正 = 屏幕右) */
  horizontal: number;
  /** 前后轴 -1..1(正 = 屏幕上方 = 前) */
  depth: number;
  /** 是否触发跳跃(前 + 在地面) */
  jump: boolean;
  /** 是否按住下蹲(后) */
  crouch: boolean;
  /** 是否处于防御姿态(按住后 / 背向对手) */
  guard: boolean;
  /**
   * 冲刺(突进)方向:0 = 无;-1 = 向左突进;+1 = 向右突进。
   * 由"双击同方向"推导(见 detectDash),具体播 dash_forward 还是 dash_backward
   * 由 Fighter 按"该方向是不是朝对手"决定。
   */
  dash: number;
  /** 原始 movement vector(probe / 排查用) */
  rawX: number;
  rawY: number;
  /** 原始按键状态(probe / 排查用) */
  rawJump: boolean;
  rawSneak: boolean;
}

/** 空的"无输入"意图 */
export function emptyIntent(): Intent {
  return {
    horizontal: 0,
    depth: 0,
    jump: false,
    crouch: false,
    guard: false,
    dash: 0,
    rawX: 0,
    rawY: 0,
    rawJump: false,
    rawSneak: false,
  };
}

export interface Cage {
  /** 玩家本体站立锚点(方块角坐标,teleport 时 +0.5) */
  anchor: Vector3;
  /** 锁定的朝向 yaw(度) */
  yaw: number;
  /** 锁定的 pitch(度) */
  pitch: number;
  /** 玩家 id → 是否已建笼 */
  built: boolean;
}

/** 玩家 id → 笼 */
const cages = new Map<string, Cage>();

/** 竞技场轴 → 世界轴方向向量(单位) */
export function axisVector(axis: ArenaAxis): { x: number; z: number } {
  return axis === "x" ? { x: 1, z: 0 } : { x: 0, z: 1 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function withDeadzone(value: number, deadzone = INPUT_DEADZONE): number {
  return Math.abs(value) < deadzone ? 0 : clamp(value, -1, 1);
}

// ------------------------------------------------------------
// 双击同方向 → 冲刺(突进)
//
// 规格(2026-09-25):"连续两次左左 / 右右"向对应方向突进;具体播向前突进还是
// 向后突进的动画,由 Fighter 按"该方向是不是朝对手"判断(dash_forward/backward)。
//
// 实现:只认**边缘**(从未推过阈值 → 推过阈值)才算"按了一下",按住不放不会连发;
// 用掉一次双击后立刻清掉记录,避免"三击连冲"。
// ------------------------------------------------------------

interface DashTapState {
  /** 上一次单击的方向(0 = 无) */
  dir: number;
  tick: number;
  /** 上一 tick 是否已推过阈值(边缘检测) */
  pressed: boolean;
}

const dashTaps = new Map<string, DashTapState>();

function detectDash(playerId: string, horizontal: number): number {
  const now = system.currentTick;
  const state = dashTaps.get(playerId) ?? { dir: 0, tick: -999, pressed: false };
  const pressed = Math.abs(horizontal) >= DASH_TAP_THRESHOLD;
  let dash = 0;
  if (pressed && !state.pressed) {
    const dir = Math.sign(horizontal);
    if (dir === state.dir && now - state.tick <= DASH_DOUBLE_TAP_TICKS) {
      dash = dir;
      // 用掉这次双击:第三次连击不会又触发一次
      state.dir = 0;
      state.tick = -999;
    } else {
      state.dir = dir;
      state.tick = now;
    }
  }
  state.pressed = pressed;
  dashTaps.set(playerId, state);
  return dash;
}

/** 清掉双击状态(清理契约,可重复执行) */
export function clearDashTaps(): void {
  dashTaps.clear();
}

/**
 * 当前生效的轴向映射:校准结果优先,未校准则用 combat-config 的三个默认常量。
 */
function effectiveAxes(): {
  axisMode: InputAxisMode;
  horizontalSign: 1 | -1;
  depthSign: 1 | -1;
} {
  const calibrated = getInputCalibration();
  if (calibrated) return calibrated;
  return {
    axisMode: INPUT_AXIS_MODE,
    horizontalSign: INPUT_HORIZONTAL_SIGN,
    depthSign: INPUT_DEPTH_SIGN,
  };
}

/**
 * 原始输入 → Intent。
 *
 * 轴向映射(优先级:实机校准结果 > combat-config 默认常量):
 *   axisMode      :"前后轴"落在原始哪个分量上
 *                   "x_horizontal" → 左右轴 = x、前后轴 = y
 *                   "y_horizontal" → 左右轴 = y、前后轴 = x
 *   horizontalSign:horizontal = 左右轴原始分量 * horizontalSign(保证"右推 > 0")
 *   depthSign     :depth      = 前后轴原始分量 * depthSign(保证"前推 > 0")
 *
 * ⚠ 语义说明:旧代码在 depth 上写的是 `-(…)`(隐含取负),现在把那个负号
 * **显式化**进 depthSign —— 默认组合 INPUT_AXIS_MODE = "x_horizontal" +
 * INPUT_DEPTH_SIGN = -1 + INPUT_HORIZONTAL_SIGN = 1 与旧行为逐位等价。
 * 校准命令算出的 depthSign 已把该负号包含在内,所以这里不再有任何隐含取负。
 *
 * 运算顺序:取原始双轴 → 乘符号(得到左右/前后语义)→ z 轴互换
 * → 阈值判定 → 防御判定(用 facing 判断"是否背向对手")。
 *
 * ★**不乘 facing**:两名玩家共用同一台侧视相机,raw 向量表达的是摇杆朝向,
 * 所以双方都是绝对屏幕方向映射(前推=跳、后拉=蹲、左推=左移、右推=右移)。
 * facing 只用来判断"防御 = 按住背向对手的方向"。
 */
export function deriveIntent(
  player: Player,
  facing: Facing,
  axis: ArenaAxis = ARENA_AXIS,
  trackDash = true,
): Intent {
  const intent = emptyIntent();
  let rawX = 0;
  let rawY = 0;
  try {
    const vector = player.inputInfo.getMovementVector();
    rawX = Number.isFinite(vector.x) ? vector.x : 0;
    rawY = Number.isFinite(vector.y) ? vector.y : 0;
  } catch {
    // 玩家离线 / 输入不可读 → 保持零输入
  }
  intent.rawX = rawX;
  intent.rawY = rawY;

  try {
    intent.rawJump =
      player.inputInfo.getButtonState(InputButton.Jump) === "Pressed";
    intent.rawSneak =
      player.inputInfo.getButtonState(InputButton.Sneak) === "Pressed";
  } catch {
    intent.rawJump = false;
    intent.rawSneak = false;
  }

  const { axisMode, horizontalSign, depthSign } = effectiveAxes();

  // 第一步:按 axisMode 取出"左右轴 / 前后轴"的原始分量,再乘上符号
  // (默认值已按实测校准结果写死:horizontalSign=-1、depthSign=+1;见 combat-config)
  const horizontal = withDeadzone(
    (axisMode === "x_horizontal" ? rawX : rawY) * horizontalSign,
  );
  const depth = withDeadzone(
    (axisMode === "x_horizontal" ? rawY : rawX) * depthSign,
  );

  // ---- 原始双轴 → 竞技场语义双轴 ----
  // 角色恒定面向对手,所以:
  //   沿竞技场轴的分量 = 水平轴(左右移动)
  //   垂直于竞技场轴的分量 = 深度轴(前 = 跳,后 = 蹲/防御)
  // 轴为 z 时两个原始分量互换。
  // 轴向歧义已由 `/bearcade:allstars_calibrate` 三步校准解决(结果持久化在
  // world 动态属性里),不再需要手改 INPUT_AXIS_MODE。
  if (axis === "z") {
    intent.horizontal = depth;
    intent.depth = -horizontal;
  } else {
    intent.horizontal = horizontal;
    intent.depth = depth;
  }

  // ★帧约定(2026-09-25 实机修正,**不要**再乘 facing):
  //   两名玩家共用**同一台侧视相机**,输入向量表达的就是"摇杆自身的朝向"
  //   (前 = y 正、右 = x 负,由校准实测),因此对双方都是**绝对屏幕方向**:
  //     前推(屏幕上方)= 跳 / 后拉(下方)= 蹲 / 左推 = 屏幕左移 / 右推 = 屏幕右移。
  //   旧实现把两轴都乘上 facing,结果是 P2 前推变蹲、右推变左移 —— 实机复现,
  //   因为"两台相机各看各的"这个前提根本不成立(两人看到的是同一幅画面)。

  // 只有明显推过阈值才算"前/后",避免斜推时误判
  const jump = intent.depth > INPUT_DEPTH_THRESHOLD;
  const back = intent.depth < -INPUT_DEPTH_THRESHOLD;
  intent.jump = jump;
  intent.crouch = back;

  // 防御:规格是"按住背向对手方向"(玩家在左、敌人在右时摁左键)—— 侧视下就是
  // **水平轴远离对手**。facing = 朝对手的方向,所以 horizontal*facing > 0 是"朝对手",
  // 再乘 GUARD_HORIZONTAL_BACK_SIGN(-1) 后过阈值 = "背向对手"。
  // 单独下蹲是否防御由 GUARD_ON_HOLD_BACK 决定，默认关闭。
  const horizontalBack =
    GUARD_ON_HORIZONTAL_BACK &&
    intent.horizontal * facing * GUARD_HORIZONTAL_BACK_SIGN >
      GUARD_HORIZONTAL_THRESHOLD;
  intent.guard = (GUARD_ON_HOLD_BACK && back) || horizontalBack;

  // 按键兜底:方向向量的前后分量不可用(权限被关/设备不产生该分量)时,
  // 跳跃键 → 跳;潜行键 → 蹲。蹲防仍需要同时按远离对手的方向。
  if (INPUT_BUTTON_FALLBACK) {
    if (!intent.jump && intent.rawJump) intent.jump = true;
    if (!intent.crouch && intent.rawSneak) {
      intent.crouch = true;
      if (GUARD_ON_HOLD_BACK) intent.guard = true;
    }
  }

  if (!jump && !back) {
    intent.depth = 0;
  }

  // 双击同方向 → 冲刺(突进);方向是绝对屏幕方向,与 facing 无关
  intent.dash = trackDash ? detectDash(player.id, intent.horizontal) : 0;

  return intent;
}

// ============================================================
// 控制笼:建屏障 + 传玩家 + 隐身 + 权限
// ============================================================

/** 笼的默认锚点:落在开局站位上(玩家本体完全隐身,位置只为读输入) */
export function registerCage(
  player: Player,
  anchor: Vector3,
  yaw: number,
): Cage {
  const cage: Cage = { anchor, yaw, pitch: 0, built: false };
  cages.set(player.id, cage);
  return cage;
}

export function getCage(playerId: string): Cage | undefined {
  return cages.get(playerId);
}

export function forgetCage(playerId: string): void {
  cages.delete(playerId);
}

/**
 * 笼子搭建:玩家本体被**隐身**并每 tick 拉回后台锚点(见 match.ts 的 backstageAnchor)。
 *
 * 说明:M1 **不铺实体屏障**,而是每 tick 把玩家水平坐标拉回锚点
 * (`pullBackToCage`),这比 setBlockType 建墙更省、也不会污染场地模板
 * (场地每局会从模板重建,写方块进场地有风险)。
 * 若实机发现玩家能靠跳跃/潜行位移,再把 CAGE_BUILD_BARRIER 打开。
 *
 * ★后台兜底(2026-09-25):玩家本体现在站在擂台地板**下方**的小平台上。
 * 旧场地(没重跑 buildmap)在锚点下面可能是空气 —— 那样玩家会持续下落。
 * 所以这里**自愈**:脚下不是实心方块就地补一块 5×5 平台,免去"必须先重建场地"。
 */
export function setupCage(player: Player, anchor: Vector3, yaw: number): void {
  const cage = registerCage(player, anchor, yaw);
  ensureBackstageFloor(player, anchor);
  try {
    player.addTag(PLAYER_TAG);
  } catch {
    // 忽略
  }
  try {
    player.addEffect("minecraft:invisibility", PLAYER_INVISIBILITY_TICKS, {
      showParticles: false,
    });
  } catch (error) {
    console.warn("[Bearcade allstars] 隐身效果添加失败", error);
  }
  // 移动必须保留(否则读不到方向);跳跃/潜行关掉,防止本体真的动
  try {
    player.inputPermissions.setPermissionCategory(
      InputPermissionCategory.Movement,
      CAGE_KEEP_MOVEMENT_INPUT,
    );
  } catch {
    // 忽略
  }
  if (CAGE_DISABLE_JUMP_INPUT) {
    try {
      player.inputPermissions.setPermissionCategory(
        InputPermissionCategory.Jump,
        false,
      );
    } catch {
      // 忽略
    }
  }
  if (CAGE_DISABLE_SNEAK_INPUT) {
    try {
      player.inputPermissions.setPermissionCategory(
        InputPermissionCategory.Sneak,
        false,
      );
    } catch {
      // 忽略
    }
  }
  try {
    player.setGameMode(GameMode.Adventure);
  } catch {
    // 忽略
  }
  pullBackToCage(player, cage, true);
  cage.built = true;
}

/**
 * 后台落脚点自愈:脚下若是空气,就地补一块 5×5 平台。
 * 只在"场地没重建过"时才会动手(新场地 buildmap 已经铺好了)。
 */
function ensureBackstageFloor(player: Player, anchor: Vector3): void {
  try {
    const dimension = player.dimension;
    const x = Math.floor(anchor.x);
    const y = Math.floor(anchor.y);
    const z = Math.floor(anchor.z);
    const under = dimension.getBlock({ x, y, z });
    if (under && under.typeId !== "minecraft:air") return;
    dimension.fillBlocks(
      new BlockVolume(
        { x: x - 2, y, z: z - 2 },
        { x: x + 2, y, z: z + 2 },
      ),
      "minecraft:smooth_stone",
    );
    console.warn(
      `[Bearcade allstars] 后台平台缺失,已在 (${x},${y},${z}) 就地补一块 5×5(建议重跑 buildmap + tmp ap)`,
    );
  } catch (error) {
    // 补不上也不致命:玩家仍被每 tick 归位,只是站在空气里(观感无影响,本体隐身)
    console.warn("[Bearcade allstars] 后台平台自愈失败", error);
  }
}

/**
 * 每 tick 把玩家拉回笼内(水平归位 + 朝向锁定)。
 * 垂直方向也一并归位:玩家被跳跃/坠落带走会让相机中点抖动。
 */
export function pullBackToCage(player: Player, cage: Cage, force = false): void {
  if (!force && !cage.built) return;
  try {
    if (!player.isValid) return;
  } catch {
    return;
  }
  try {
    player.teleport(
      {
        x: cage.anchor.x + 0.5,
        y: cage.anchor.y + 0.5,
        z: cage.anchor.z + 0.5,
      },
      {
        rotation: { x: cage.pitch, y: cage.yaw },
        checkForBlocks: false,
      },
    );
  } catch {
    // 玩家恰好离线/维度未加载,忽略
  }
}

/** 清理笼子与对局态玩家状态。**可重复执行**。 */
export function teardownCage(player: Player, playerId?: string): void {
  const id = playerId ?? player.id;
  cages.delete(id);
  try {
    player.removeTag(PLAYER_TAG);
  } catch {
    // 忽略
  }
  try {
    player.removeEffect("minecraft:invisibility");
  } catch {
    // 忽略
  }
  // 恢复输入权限(全部打开)
  for (const category of [
    InputPermissionCategory.Movement,
    InputPermissionCategory.Jump,
    InputPermissionCategory.Sneak,
    InputPermissionCategory.LateralMovement,
    InputPermissionCategory.Camera,
  ]) {
    try {
      player.inputPermissions.setPermissionCategory(category, true);
    } catch {
      // 忽略
    }
  }
  try {
    player.setGameMode(GameMode.Adventure);
  } catch {
    // 忽略
  }
}

// ============================================================
// 快捷栏技能标记物品
// ============================================================

function getContainer(player: Player): Container | undefined {
  const inventory = player.getComponent(
    EntityComponentTypes.Inventory,
  ) as EntityInventoryComponent | undefined;
  return inventory?.container;
}

/**
 * 布置技能快捷栏:slot 0 留空,slot 1~6 放带中文名的标记物品。
 * 只是"按钮",不依赖物品功能,所以全部 keepOnDeath 且不可堆叠。
 */
export function setupSkillHotbar(player: Player): void {
  try {
    const container = getContainer(player);
    if (!container) return;
    for (let slot = 0; slot < 9; slot++) {
      container.setItem(slot, undefined);
    }
    for (const def of SKILL_ITEMS) {
      const item = new ItemStack(def.itemId, 1);
      item.nameTag = def.name;
      item.setLore(def.slot === 6
      ? ["§7单按7:一气 / 朝对手+7或W+7:二气 / S+7:三气", "§7朝对手=左右方向键，S=下蹲方向", "§7按所选档位消耗气；气不足时不会释放"]
        : ["§7切到该格释放技能", "§7选中后自动回到第1格"]);
      item.keepOnDeath = true;
      item.lockMode = ItemLockMode.slot;
      container.setItem(def.slot, item);
    }
    player.selectedSlotIndex = 0;
  } catch (error) {
    console.warn("[Bearcade allstars] 技能快捷栏布置失败", error);
  }
}

/** 清空快捷栏(清理契约,可重复执行) */
export function clearSkillHotbar(player: Player): void {
  try { restoreHotbarUi(player.id); } catch (error) {
    console.warn("[Bearcade allstars] 清场时恢复快捷栏显示失败", error);
  }
  try {
    const container = getContainer(player);
    if (!container) return;
    for (let slot = 0; slot < 9; slot++) {
      container.setItem(slot, undefined);
    }
    player.selectedSlotIndex = 0;
  } catch {
    // 忽略
  }
}

/**
 * 读快捷栏技能槽:返回 1~6;第 0 格返回 undefined。
 * 回位由 resetSkillSlot 延后执行，不能在选中事件内立即写回。
 */
export function pollSkillSlot(player: Player): number | undefined {
  let slot = 0;
  try {
    slot = player.selectedSlotIndex;
  } catch {
    return undefined;
  }
  if (!Number.isFinite(slot) || slot <= 0 || slot > 6) return undefined;
  return slot;
}

/** A super's direction is sampled with the press, not when a buffered move starts. */
export function superTierForIntent(intent: Pick<Intent, "jump" | "crouch"> & Partial<Pick<Intent, "horizontal">>, facing: Facing = 1): SuperTier {
  // Opposing inputs are resolved consistently: crouch takes priority.
  return intent.crouch ? 3 : intent.jump || (intent.horizontal ?? 0) * facing > INPUT_DEPTH_THRESHOLD ? 2 : 1;
}

export function readSuperTier(player: Player, facing: Facing = 1): SuperTier {
  // Sampling a hotbar event must not consume a left/right double-tap edge.
  return superTierForIntent(deriveIntent(player, facing, ARENA_AXIS, false), facing);
}

export interface SkillPress {
  slot: number;
  tick: number;
  superTier?: SuperTier;
  /** 选中瞬间的左右方向；由 Match 按真实角色朝向解析，不能写死 1P 朝向。 */
  superHorizontal?: number;
}

const pendingSkill = new Map<string, SkillPress>();
const lastObservedSlot = new Map<string, number>();
const lastAcceptedPress = new Map<string, { slot: number; tick: number }>();
const SKILL_PRESS_TTL_TICKS = 10;

interface HotbarReturn {
  nextTick: number;
  remaining: number;
}
const hotbarReturns = new Map<string, HotbarReturn>();
const hotbarUiRestores = new Map<string, {player: Player; tick: number}>();
const lastResetErrorTick = new Map<string, number>();
const HOTBAR_RETURN_WRITES = 3;

function restoreHotbarUi(playerId: string): void {
  const pending = hotbarUiRestores.get(playerId);
  if (!pending) return;
  if (!pending.player.isValid) { hotbarUiRestores.delete(playerId); return; }
  // Only undo the visibility change owned by this match, never reset other HUD elements.
  pending.player.onScreenDisplay.setHudVisibility(HudVisibility.Reset, [HudElement.Hotbar]);
  hotbarUiRestores.delete(playerId);
}

function refreshHotbarUi(player: Player): void {
  const display = player.onScreenDisplay;
  if (typeof display.getHiddenHudElements !== "function" || typeof display.setHudVisibility !== "function") return;
  if (hotbarUiRestores.has(player.id) || display.getHiddenHudElements().includes(HudElement.Hotbar)) return;
  display.setHudVisibility(HudVisibility.Hide, [HudElement.Hotbar]);
  hotbarUiRestores.set(player.id, {player, tick: system.currentTick + 1});
}

/** Only queues work; never changes native selection inside the selection event. */
function requestHotbarReturn(playerId: string, newSelection = false): void {
  const request = hotbarReturns.get(playerId);
  if (!request) {
    hotbarReturns.set(playerId, { nextTick: system.currentTick + 1, remaining: HOTBAR_RETURN_WRITES });
  } else if (newSelection) {
    request.nextTick = system.currentTick + 1;
    request.remaining = HOTBAR_RETURN_WRITES;
  }
}

/**
 * Run from the match tick after input consumption. The first write is deferred
 * past the selection event; two following ticks retry even if the SERVER reads 0.
 * Server readback alone is not evidence that the client's selection box moved.
 */
export function resetSkillSlot(player: Player, log?: (message: string) => void): boolean {
  const id = player.id;
  const refresh = hotbarUiRestores.get(id);
  if (refresh && system.currentTick >= refresh.tick) {
    try { restoreHotbarUi(id); } catch (error) {
      if (system.currentTick - (lastResetErrorTick.get(id) ?? -999) >= 100) {
        lastResetErrorTick.set(id, system.currentTick);
        console.warn("[Bearcade allstars] 快捷栏显示恢复失败，下一 tick 重试", error);
      }
    }
  }
  const observed = readSelectedSlot(player);
  if (observed > 6) { hotbarReturns.delete(id); return false; }
  if (observed >= 1) requestHotbarReturn(id);
  const request = hotbarReturns.get(id);
  if (!request || system.currentTick < request.nextTick) return false;

  request.nextTick = system.currentTick + 1;
  request.remaining--;
  if (request.remaining <= 0) hotbarReturns.delete(id);
  try {
    // Do not skip this write because selectedSlotIndex is already 0 on the server.
    player.selectedSlotIndex = 0;
    const after = player.selectedSlotIndex;
    if (after !== 0) throw new Error("server readback stayed at " + after);
    lastObservedSlot.set(id, 0);
    // The user's current client moves selection logically but leaves its old
    // highlight painted. Refresh only the native hotbar panel after final return.
    if (request.remaining === 0) refreshHotbarUi(player);
    const message = "快捷栏延后回位: server " + observed + " -> " + after +
      ", remaining=" + request.remaining + " (客户端选中框需实机确认)";
    log?.(message);
    if (isProbing(id)) console.warn("[Bearcade allstars] " + message);
    return true;
  } catch (error) {
    if (system.currentTick - (lastResetErrorTick.get(id) ?? -999) >= 100) {
      lastResetErrorTick.set(id, system.currentTick);
      console.warn("[Bearcade allstars] 快捷栏回位写入失败 player=" + id, error);
    }
    return false;
  }
}

/** Records a real selection edge; the poller only supplies missing events. */
function acceptPress(playerId: string, slot: number, superTier?: SuperTier, superHorizontal?: number): boolean {
  const now = system.currentTick;
  const last = lastAcceptedPress.get(playerId);
  if (last?.slot === slot && last.tick === now) return false;
  lastAcceptedPress.set(playerId, { slot, tick: now });
  pendingSkill.set(playerId, { slot, tick: now, ...(slot === 6 ? { superTier, superHorizontal } : {}) });
  return true;
}

/** Selection events also schedule return when the move is rejected or inputs are locked. */
export function noteSkillPress(playerId: string, slot: number, superTier?: SuperTier, superHorizontal?: number): void {
  if (slot === 0) { lastObservedSlot.set(playerId, 0); return; }
  if (!Number.isInteger(slot) || slot < 1 || slot > 6) return;
  lastObservedSlot.set(playerId, slot);
  requestHotbarReturn(playerId, true);
  acceptPress(playerId, slot, superTier, superHorizontal);
}

export function handleSkillSelection(player: Player, slot: number): void {
  const intent = slot === 6 ? deriveIntent(player, 1, ARENA_AXIS, false) : undefined;
  noteSkillPress(player.id, slot, intent ? superTierForIntent({ jump:intent.jump, crouch:intent.crouch }) : undefined, intent?.horizontal);
}

export function consumeSkillPress(playerId: string): SkillPress | undefined {
  const hit = pendingSkill.get(playerId);
  if (!hit) return undefined;
  pendingSkill.delete(playerId);
  if (system.currentTick - hit.tick > SKILL_PRESS_TTL_TICKS) return undefined;
  return hit;
}

export function pollSkillPress(player: Player, superTier?: SuperTier): SkillPress | undefined {
  const slot = pollSkillSlot(player);
  if (slot === undefined) {
    lastObservedSlot.delete(player.id);
    return undefined;
  }
  if (lastObservedSlot.get(player.id) === slot) return undefined;
  lastObservedSlot.set(player.id, slot);
  requestHotbarReturn(player.id, true);
  if (!acceptPress(player.id, slot, slot === 6 ? (superTier ?? readSuperTier(player)) : undefined)) return undefined;
  return consumeSkillPress(player.id);
}

/** Room-scoped cleanup also cancels pending return writes, including after leave. */
export function clearSkillPresses(playerIds?: string[]): void {
  for (const id of playerIds ?? [...hotbarUiRestores.keys()]) {
    try { restoreHotbarUi(id); } catch (error) {
      console.warn("[Bearcade allstars] 清理时恢复快捷栏显示失败", error);
    }
  }
  const maps = [pendingSkill, lastObservedSlot, lastAcceptedPress, hotbarReturns, lastResetErrorTick];
  for (const map of maps) {
    if (playerIds) for (const id of playerIds) map.delete(id);
    else map.clear();
  }
}

/** 读当前选中格(读不到返回 -1),仅用于调试日志 */
export function readSelectedSlot(player: Player): number {
  try {
    const value = player.selectedSlotIndex;
    return Number.isFinite(value) ? value : -1;
  } catch {
    return -1;
  }
}

// ============================================================
// /scriptevent allstars:probe 调试
// ============================================================

interface ProbeState {
  playerId: string;
  untilTick: number;
  lastX: number;
  lastY: number;
  lastJump: boolean;
  lastSneak: boolean;
  facing: Facing;
  axis: ArenaAxis;
}

const probes = new Map<string, ProbeState>();

/** 开启一次 5 秒输入探针 */
export function startProbe(
  player: Player,
  facing: Facing = 1,
  log: (message: string) => void,
  axis: ArenaAxis = ARENA_AXIS,
): void {
  const now = system.currentTick;
  probes.set(player.id, {
    playerId: player.id,
    untilTick: now + PROBE_DURATION_TICKS,
    lastX: Number.NaN,
    lastY: Number.NaN,
    lastJump: false,
    lastSneak: false,
    facing,
    axis,
  });
  log(
    `probe 开始(${Math.round(PROBE_DURATION_TICKS / 20)} 秒)axisMode=${effectiveAxes().axisMode}${
      getInputCalibration() ? "(已校准)" : "(默认)"
    } ` +
      `arenaAxis=${axis} facing=${facing} deadzone=${INPUT_DEADZONE} ` +
      `depthThreshold=${INPUT_DEPTH_THRESHOLD}`,
  );
  try {
    player.sendMessage(
      "§e[probe] 现在依次做:前进 / 后退 / 左移 / 右移 / 跳跃 / 潜行,每次保持 0.5 秒。原始值见内容日志。",
    );
  } catch {
    // 忽略
  }
}

export function isProbing(playerId: string): boolean {
  return probes.has(playerId);
}

export function stopProbe(playerId: string): void {
  probes.delete(playerId);
}

export function clearProbes(): void {
  probes.clear();
}

/**
 * 每 tick 调用:探针期间,只在输入**发生变化**时打印原始值 + 推导结果。
 * 用 runtime.dbg 之外的 console.warn 兜底(caller 传 log 进来)。
 */
export function probeTick(
  player: Player,
  facing: Facing,
  log: (message: string) => void,
): void {
  const state = probes.get(player.id);
  if (!state) return;
  const now = system.currentTick;
  if (now > state.untilTick) {
    probes.delete(player.id);
    log("probe 结束");
    try {
      player.sendMessage("§7[probe] 结束,原始值见内容日志");
    } catch {
      // 忽略
    }
    return;
  }

  const intent = deriveIntent(player, facing, state.axis, false);
  const changed =
    intent.rawX !== state.lastX ||
    intent.rawY !== state.lastY ||
    intent.rawJump !== state.lastJump ||
    intent.rawSneak !== state.lastSneak;
  if (!changed) return;

  state.lastX = intent.rawX;
  state.lastY = intent.rawY;
  state.lastJump = intent.rawJump;
  state.lastSneak = intent.rawSneak;

  const axes = effectiveAxes();
  log(
    `probe raw=(x ${intent.rawX.toFixed(3)}, y ${intent.rawY.toFixed(3)}) ` +
      `jump=${intent.rawJump} sneak=${intent.rawSneak} | ` +
      `derived(axisMode=${axes.axisMode}${getInputCalibration() ? " 已校准" : " 默认"}` +
      ` hSign=${axes.horizontalSign} dSign=${axes.depthSign}) ` +
      `horizontal=${intent.horizontal.toFixed(2)} ` +
      `depth=${intent.depth.toFixed(2)} → jump=${intent.jump} crouch=${intent.crouch} ` +
      `guard=${intent.guard} dash=${intent.dash}(判据:depth<0 或 horizontal*facing*${GUARD_HORIZONTAL_BACK_SIGN}>${GUARD_HORIZONTAL_THRESHOLD})`,
  );
}

/** 命令 id,供 game.ts 订阅 scriptEventReceive 时比对 */
export const PROBE_ID = PROBE_COMMAND_ID;
