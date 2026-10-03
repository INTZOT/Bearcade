// ============================================================
// 道具(末影珍珠 / 命令方块)—— 冲刺与大招的"非伤害性视觉道具"
//
// 为什么是独立实体:
//   源资产把它们做在 props/ 里(geometry.green_beret.ender_pearl /
//   .command_block),**动画 JSON 里没有任何珍珠/方块通道** —— 它们不是角色骨骼,
//   预览器里是"挂在手骨上的独立道具"。Bedrock 侧要用它们,只能用独立实体:
//   每 tick 传送到"手"的世界坐标。
//
// 权威规格(source/v047/motion_vfx_metadata.json, super_metadata.json):
//   intro      pearlGather:珍珠在双手中生成 → 156-180 移到右手并收进
//   dash_forward   release=4(制作tick) hide=[6,12] afterimages=[5,7,9] distance=20
//   dash_backward  release=5            hide=[8,14] afterimages=[7,9,11] distance=-16
//   super_1    pearlGather=[5,12] move=[12,22] distance=22 hide=[14,19]
//   super_2    prop=command_block propVisible=[8,124](制作tick,60/秒)
//   super_3    chain 消耗六颗散落珍珠,第七颗进终结段
//
// ⚠ 近似说明:脚本**读不到骨骼世界坐标**(ScriptAPI 没有取骨骼位姿的接口),
//   所以"手的位置"是按角色位置 + 朝向 + 固定局部偏移算出来的,常量都可调。
// ============================================================

import anchors from "./data/hand-anchors.json";
import landmarks from "./data/body-landmarks.json";
import { modelPointToWorld } from "./scene-space";
import { currentClip, clipElapsed } from "./anim";
import { CHUNYE_CLIPS } from "./data/chunye.clips";
import { system, type Dimension, type Entity, type Vector3 } from "@minecraft/server";
import {
  PROP_COMMAND_BLOCK_ID,
  PROP_HAND_FORWARD,
  PROP_HAND_HEIGHT,
  PROP_HAND_SIDE,
  PROP_HAND_TOWARD_CAMERA,
  PROP_PEARL_ID,
} from "./combat-config";

/** 手上位置需要的最小信息(不依赖 Fighter 类,便于单测/解耦) */
export interface HandOwner {
  /** 脚底世界坐标 */
  location: Vector3;
  /** 当前朝向:+1 = 竞技场轴正方向 */
  facing: number;
  entity?: Entity;
}

/** 活的道具实体(清理契约用:任何漏掉的都要能被一次性收掉) */
const liveProps = new Set<Entity>();

/** Animated head/torso, including local bone displacement in knockdowns. */
export function bodyPoint(owner: HandOwner, which: "head" | "torso"): Vector3 {
  const id = currentClip(owner.entity);
  const frames = id ? (landmarks as Record<string, number[][][]>)[id] : undefined;
  if (!frames || !owner.entity) return { ...owner.location, y: owner.location.y + (which === "head" ? 2.6 : 1.65) };
  const def = CHUNYE_CLIPS[id!];
  const elapsed = clipElapsed(owner.entity);
  const t = def?.loop ? elapsed % (def.seconds * 20) : elapsed;
  const i = Math.min(frames.length-1, Math.floor(t)), j = Math.min(frames.length-1,i+1), u = t-Math.floor(t);
  const n = which === "head" ? 0 : 1;
  const point = frames[i]![n]!.map((v,k) => v+(frames[j]![n]![k]!-v)*u);
  return modelPointToWorld(point, owner.location, owner.entity.getRotation().y);
}
const propScales = new Map<Entity, {scale:number; closing:boolean; closeFrom:number; age:number}>();
const PROP_SCALE_TICKS = 3;
const PROP_MIN_SCALE = 0.001;

function isValid(entity: Entity | undefined): entity is Entity {
  if (!entity) return false;
  try {
    return entity.isValid;
  } catch {
    return false;
  }
}

/**
 * 角色的"手"世界坐标(近似)。
 *
 * 局部偏移(格,均可调):
 *   前  = 朝向 × PROP_HAND_FORWARD
 *   上  = PROP_HAND_HEIGHT
 *   侧  = ±PROP_HAND_SIDE(右手 = 背离相机一侧)
 *   并统一朝相机(+z)偏 PROP_HAND_TOWARD_CAMERA —— 否则道具会被身体挡住。
 */
export function handPoint(
  owner: HandOwner,
  which: "right" | "left" | "mid" = "right",
): Vector3 {
  const id=currentClip(owner.entity);
  const frames=id ? (anchors as Record<string, number[][][]>)[id] : undefined;
  if (frames && owner.entity) {
    const def=CHUNYE_CLIPS[id!];
    const elapsed=clipElapsed(owner.entity);
    const time=def?.loop ? elapsed % (def.seconds*20) : elapsed;
    const i=Math.min(frames.length-1,Math.floor(time)),j=Math.min(frames.length-1,i+1),u=time-Math.floor(time);
    const sample=(axis:number) => {
      const at=(frame:number) => which === "mid" ? (frames[frame]![0]![axis]!+frames[frame]![1]![axis]!)/2 : frames[frame]![which==="right"?0:1]![axis]!;
      return (at(i)+(at(j)-at(i))*u)/16;
    };
    return modelPointToWorld([sample(0)*16,sample(1)*16,sample(2)*16],owner.location,owner.entity.getRotation().y);
  }
  const forward = owner.facing >= 0 ? 1 : -1;
  // 相机恒定在 +z 一侧(CAMERA_SIDE = positive),所以"朝相机"就是 +z
  const side = which === "mid" ? 0 : which === "right" ? -1 : 1;
  return {
    x: owner.location.x + forward * PROP_HAND_FORWARD,
    y: owner.location.y + PROP_HAND_HEIGHT,
    z:
      owner.location.z +
      side * PROP_HAND_SIDE +
      PROP_HAND_TOWARD_CAMERA,
  };
}

/** 生成一个道具实体;**失败返回 undefined**(道具是纯表现,绝不影响对局) */
export function spawnProp(
  dimension: Dimension,
  entityId: string,
  at: Vector3,
): Entity | undefined {
  try {
    const entity = dimension.spawnEntity(
      entityId as Parameters<Dimension["spawnEntity"]>[0],
      at,
    );
    try {
      entity.triggerEvent("bearcade:prop_driven");
    } catch {
      // 组件组事件失败不影响渲染(实体默认就有物理,只是会掉)
    }
    liveProps.add(entity);
    return entity;
  } catch (error) {
    console.warn(`[Bearcade allstars] 道具生成失败 ${entityId}`, error);
    return undefined;
  }
}

/** 生成末影珍珠 */
export function spawnPearl(dimension: Dimension, at: Vector3, animate = true): Entity | undefined {
  return spawnScaledProp(dimension, PROP_PEARL_ID, at, animate);
}

function spawnScaledProp(dimension: Dimension, id: string, at: Vector3, animate: boolean): Entity | undefined {
  const entity = spawnProp(dimension, id, at);
  if (!entity) return undefined;
  const scale = animate ? PROP_MIN_SCALE : 1;
  try { entity.setProperty("bearcade:prop_scale", scale); } catch { /* invalid entity */ }
  if (animate) propScales.set(entity, {scale, closing:false, closeFrom:scale, age:0});
  return entity;
}

/** Normal disappearance shrinks pearls/blocks; round/reset cleanup removes immediately. */
export function dismissProp(entity: Entity | undefined): void {
  if (!entity) return;
  const state = propScales.get(entity);
  if (!state) { despawnProp(entity); return; }
  if (!state.closing) { state.closing = true; state.closeFrom = state.scale; state.age = 0; }
}

/** One room advances its own props using the shared presentation clock. */
export function advanceProps(dimensionId: string, delta: number): void {
  for (const [entity, state] of propScales) {
    if (!isValid(entity)) { propScales.delete(entity); liveProps.delete(entity); continue; }
    if (entity.dimension.id !== dimensionId || delta <= 0) continue;
    state.age += delta;
    const u = Math.min(1, state.age / PROP_SCALE_TICKS);
    const smooth = u*u*(3-2*u);
    state.scale = state.closing ? state.closeFrom*(1-smooth) : PROP_MIN_SCALE+(1-PROP_MIN_SCALE)*smooth;
    try { entity.setProperty("bearcade:prop_scale", Math.max(PROP_MIN_SCALE, state.scale)); } catch { /* cleanup */ }
    if (state.closing && u >= 1) despawnProp(entity);
  }
}

/** 生成命令方块 */
export function spawnCommandBlock(
  dimension: Dimension,
  at: Vector3,
  animate = true,
): Entity | undefined {
  return spawnScaledProp(dimension, PROP_COMMAND_BLOCK_ID, at, animate);
}

/** The super 2 frame is a visual prop, with no collision or combat hitbox. */
export function spawnCommandCage(dimension: Dimension, at: Vector3): Entity | undefined {
  return spawnProp(dimension, "bearcade:allstars_command_cage", at);
}

/** 把道具挪到指定位置(失败静默;实体失效时从表里摘掉) */
export function moveProp(
  entity: Entity | undefined,
  at: Vector3,
  rotation?: { x: number; y: number },
): void {
  if (!isValid(entity)) {
    if (entity) liveProps.delete(entity);
    return;
  }
  try {
    entity.teleport(at, {
      checkForBlocks: false,
      ...(rotation ? { rotation } : {}),
    });
  } catch {
    // 实体恰好失效:忽略,下一次 moveProp 会把它摘掉
  }
}

/** 收掉一个道具(可重复调用) */
export function despawnProp(entity: Entity | undefined): void {
  if (!entity) return;
  liveProps.delete(entity);
  propScales.delete(entity);
  try {
    if (entity.isValid) entity.remove();
  } catch {
    // 忽略
  }
}

/** 收掉全部道具(清场契约;漏掉的实体也会被扫掉) */
export function despawnAllProps(dimensionId?: string): void {
  for (const entity of Array.from(liveProps)) {
    try { if (!dimensionId || entity.dimension.id === dimensionId) despawnProp(entity); } catch { liveProps.delete(entity); }
  }
}

/**
 * 让角色"瞬移隐形"若干 tick(源资产 hide 段:本体隐形 + 珍珠飞行 + 残影)。
 *
 * 用什么实现:自定义实体没有 visibility 组件,`minecraft:invisibility` 效果是
 * 通用做法(玩家本体隐身就是这么做的)。失败就静默 —— 这只是表现。
 */
export function ghostEntity(entity: Entity | undefined, ticks: number): void {
  if (!isValid(entity)) return;
  try {
    entity.addEffect("minecraft:invisibility", Math.max(1, ticks), {
      showParticles: false,
    });
  } catch {
    // 忽略
  }
}

/** 玩家/实体当前的朝向符号(竞技场轴),给 handPoint 用 */
export function facingOf(owner: { facing?: number }): number {
  return (owner.facing ?? 1) >= 0 ? 1 : -1;
}

/** 把"制作 tick(60/秒)"换算成游戏 tick(20/秒),四舍五入但至少 0 */
export function authoringToGameTicks(authoringTicks: number): number {
  return Math.max(0, Math.round((authoringTicks / 60) * 20));
}

/** 当前 tick(集中一处,便于将来换成逻辑时钟) */
export function now(): number {
  return system.currentTick;
}
