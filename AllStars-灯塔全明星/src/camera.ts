// ============================================================
// 横板侧视相机
//
// 几何(用户明确要求):
//   1. 每 tick 求两名角色的中点 M;
//   2. 从 M 沿"垂直于两人连线"的方向引出中垂线;
//   3. 相机放在中垂线上的顶点(距离由"取景需求"反解,见下);
//   4. 朝向 M 上方一点(侧视),pitch 由几何算出。
//
// 取景(2026-09-25 实机反馈"太近"后重做):
//   - **FOV 固定 62°**,画面远近只由机位距离决定;
//   - 机位距离 = 装下"两人 + 余量"所需视野半高 / tan(FOV/2),
//     夹在 CAMERA_MIN_DISTANCE ~ CAMERA_MAX_DISTANCE 之间
//     ⇒ 两人贴身时机位约 11 格(旧实现 3.5 格,这就是"太近"的根因);
//   - 只有两人拉开到超过上限时才用 FOV 补足视野。
//
// 平滑(参考 Collapse-豆腐渣地板/src/game.ts):
//   1. 目标位姿先做**指数平滑**(CAMERA_SMOOTHING),抹掉逐 tick 抖动;
//   2. 节流下发(CAMERA_UPDATE_TICKS),easeTime ≈ 节流间隔 + Linear,
//      每次下发正好用这段时间走到新目标 ⇒ 首尾相接的匀速运镜;
//   3. 大幅换位(换局/从 KO 特写回位)用 force:目标直接吸附 + 更长的
//      InOutSine 缓动(引擎从当前相机状态插值,无需知道当前位置)。
//
// 引擎约束(已实测,见 docs/lessons.md §9):
//   - 自定义相机预设在本版本**不加载**,只能用内置 "minecraft:free";
//   - follow_orbit 半径锁死 10,所以机位距离只能靠 free + setCamera 自己给;
//   - setFov 是"相机作用域":camera.clear() 会一并还原(§13.5),
//     所以清理时**绝不能**在 clear() 之后再 setFov(那会把玩家自己的
//     FOV 设置永久顶掉 —— 实机"结束后 FOV 残留"就是这么来的)。
// ============================================================

import {
  CameraShakeType,
  EasingType,
  system,
  type Player,
  type Vector3,
} from "@minecraft/server";
import {
  ARENA_CENTER,
  ARENA_FLOOR_Y,
  ARENA_START_HALF_DISTANCE,
  CAMERA_AIM_HEIGHT,
  CAMERA_ASPECT,
  CAMERA_BASE_FOV,
  CAMERA_EASE_SECONDS,
  CAMERA_ENTER_EASE_SECONDS,
  CAMERA_FOV_EASE_SECONDS,
  CAMERA_FOV_EPSILON,
  CAMERA_FOV_MAX,
  CAMERA_FOV_MIN,
  CAMERA_FOV_QUANTIZE,
  CAMERA_FRAME_HALF_HEIGHT,
  CAMERA_FRAME_HALF_WIDTH,
  CAMERA_FRAME_MARGIN_X,
  CAMERA_HEIGHT_OFFSET,
  CAMERA_MAX_DISTANCE,
  CAMERA_MIN_DISTANCE,
  CAMERA_MIN_Y,
  CAMERA_POS_EPSILON,
  CAMERA_SIDE,
  CAMERA_SMOOTHING,
  CAMERA_UPDATE_TICKS,
  INTRO_CAMERA_AIM_HEIGHT,
  INTRO_CAMERA_DISTANCE,
  INTRO_CAMERA_DRIFT,
  INTRO_CAMERA_FOV,
  INTRO_CAMERA_HEIGHT,
  type ArenaAxis,
} from "./combat-config";

/** 相机上下文:知道竞技场轴向才能算"中垂线"方向 */
export interface CameraContext {
  axis: ArenaAxis;
}

/** 相机只依赖这两样,便于单测/解耦(不需要完整 Fighter 类) */
export interface CameraFighter {
  isValid: boolean;
  location: Vector3;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec(a: Vector3, b: Vector3, t: number): Vector3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

function distanceOf(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * 从相机位置看向目标眼睛的旋转角。
 * 换算约定参考仓库既有实现 Collapse-豆腐渣地板/src/game.ts 的 lookAt():
 *   rot_y: 0 = 南(+z),顺时针为正 → atan2(-dx, dz)
 *   rot_x: 正 = 向下            → atan2(-dy, dist)
 * 返回 x/y 为**度**。
 *
 * 导出给 Match 的 KO 特写运镜复用(同一套 yaw/pitch 换算,避免两处各写一遍)。
 */
export function lookAt(cam: Vector3, eye: Vector3): { x: number; y: number } {
  const dx = eye.x - cam.x;
  const dy = eye.y - cam.y;
  const dz = eye.z - cam.z;
  const dist = Math.hypot(dx, dz);
  return {
    x: (Math.atan2(-dy, dist) * 180) / Math.PI,
    y: (Math.atan2(-dx, dz) * 180) / Math.PI,
  };
}

/** 相机"最近一次算出"的位姿。HUD(TextPrimitive 伪屏幕)要用它把屏幕坐标反算成世界坐标。 */
export interface CameraPose {
  pos: Vector3;
  /** yaw 度:0 = +Z(南),顺时针为正 */
  yaw: number;
  /** pitch 度:正 = 向下 */
  pitch: number;
  fov: number;
}

const lastPoses = new Map<string, CameraPose>();

/** 取某玩家最近一次的相机位姿(从未下发过相机 = undefined,此时 HUD 应降级) */
export function lastCameraPose(playerId: string): CameraPose | undefined {
  return lastPoses.get(playerId);
}

/** 丢弃某玩家的位姿记录(清理契约,可重复执行) */
export function clearCameraPose(playerId: string): void {
  lastPoses.delete(playerId);
}

/**
 * 取景反解:两人水平距离 → { 机位距离, FOV }。
 *
 *   halfWidth  = max(半宽下限, 距离/2 + 左右余量)   ← 要装下两人
 *   halfHeight = max(取景半高, halfWidth / 宽高比)   ← 再由屏幕比例换算成高度需求
 *   R          = halfHeight / tan(FOV/2)            ← 固定 FOV 下需要站多远
 *   R 超过上限 ⇒ 用上限机位,把 FOV 撑到刚好装下(观感已是"全场")。
 */
export function frameFor(distance: number): { radius: number; fov: number } {
  const halfWidth = Math.max(
    CAMERA_FRAME_HALF_WIDTH,
    distance / 2 + CAMERA_FRAME_MARGIN_X,
  );
  const halfHeight = Math.max(
    CAMERA_FRAME_HALF_HEIGHT,
    halfWidth / CAMERA_ASPECT,
  );
  const baseHalfFovRad = ((CAMERA_BASE_FOV / 2) * Math.PI) / 180;
  const desired = halfHeight / Math.tan(baseHalfFovRad);
  if (desired <= CAMERA_MAX_DISTANCE) {
    return {
      radius: clamp(desired, CAMERA_MIN_DISTANCE, CAMERA_MAX_DISTANCE),
      fov: CAMERA_BASE_FOV,
    };
  }
  const radius = CAMERA_MAX_DISTANCE;
  const fov = (2 * Math.atan(halfHeight / radius) * 180) / Math.PI;
  return {
    radius,
    fov: clamp(fov, CAMERA_FOV_MIN, CAMERA_FOV_MAX),
  };
}

/** 玩家是否可用(离线/实体失效一律 false) */
function isPlayerValid(player: Player): boolean {
  try {
    return player.isValid;
  } catch {
    return false;
  }
}

/**
 * 把某个玩家的相机**彻底复位**:清位姿记录 + clear() + 停震屏。
 *
 * ⚠️ 这里**不调用 setFov**:setFov 是相机作用域,clear() 会自动把玩家自己的
 * FOV 设置还原回来(lessons §13.5 实测);若在 clear() 之后再 setFov(62),
 * 反而会把玩家自己的视野设置永久顶掉 —— 实机"对局结束后视角/FOV 残留"
 * 就是这个顺序造成的。**可重复执行**。
 */
export function resetPlayerCamera(player: Player): void {
  clearCameraPose(player.id);
  try {
    player.camera.clear();
  } catch {
    // 玩家已离线/实体失效,忽略
  }
  try {
    player.camera.stopShaking();
  } catch {
    // stopShaking 为 beta,失败不影响复位
  }
}

export class SideCamera {
  private readonly player: Player;
  private readonly context: CameraContext;
  /** 上次实际发出的相机位置(undefined = 从未发过,必须立刻发一次) */
  private lastSentPos?: Vector3;
  /** 上次实际发出的 FOV(undefined = 从未发过) */
  private lastSentFov?: number;
  /** 节流闸门:允许发送的最早 tick */
  private nextAllowedTick = -1;
  private cleared = true;
  /** 指数平滑后的机位(= 真正下发的目标);undefined = 还没建立 */
  private smoothPos?: Vector3;
  /** 外部改过相机后,下一次下发要用"大幅换位"的长缓动 */
  private pendingEnterEase = false;

  constructor(player: Player, context: CameraContext) {
    this.player = player;
    this.context = context;
  }

  get isCleared(): boolean {
    return this.cleared;
  }

  /**
   * 外部改过这台相机之后调用(KO 特写等):下一次 update 强制重发位置与 FOV。
   * 不这么做的话,缓存里的 lastSentFov 会让侧视相机"以为"FOV 还是 62,
   * 于是 KO 的 38° 会一直粘到下一局(实机"结束后状态残留"的一个成因)。
   */
  invalidate(): void {
    this.lastSentPos = undefined;
    this.lastSentFov = undefined;
    this.nextAllowedTick = -1;
    // 位置差得远(如从 KO 特写回位)⇒ 下一次用长缓动,别硬切
    this.pendingEnterEase = true;
  }

  /**
   * 每 tick 调用一次(方法内部做平滑 + 节流 + 位置阈值判断)。
   * 所有原生调用集中在这里,caller 保证运行在 system.runInterval 回调内。
   *
   * @param options.force 换局/开场:目标立刻吸附 + 更长的 InOutSine 缓动,
   *                      用于"从上一局 / KO 特写平滑飞到新的取景"。
   */
  update(
    fighters: (CameraFighter | undefined)[],
    options: { force?: boolean } = {},
  ): void {
    if (!isPlayerValid(this.player)) return;
    const [a, b] = fighters;
    if (!a || !b || !a.isValid || !b.isValid) return;

    // ---- 取景(每 tick 算) ----
    const distance = Math.abs(this.horizontalOf(a, b));
    const mid: Vector3 = {
      x: (a.location.x + b.location.x) / 2,
      y: (a.location.y + b.location.y) / 2,
      z: (a.location.z + b.location.z) / 2,
    };
    this.placeAt(mid, distance, options.force === true);
  }

  /**
   * **选人 / 准备阶段**的固定取景:此时还没有前台角色,相机也不该停着不动。
   *
   * 为什么需要:玩家本体已经被挪到擂台地板下的"后台"(规格:本体不出现在场地里),
   * 不下发相机的话,玩家在选人阶段看到的就是后台小房间的墙。
   */
  preview(): void {
    if (!isPlayerValid(this.player)) return;
    // 只在"这台相机还没下发过"时用长缓动强制定位;之后走正常节流,
    // 否则整个选人阶段(最长 90 秒)会每 tick 重发一条 0.5s 缓动指令。
    const first = this.lastSentPos === undefined;
    this.placeAt(
      { x: ARENA_CENTER.x, y: ARENA_FLOOR_Y, z: ARENA_CENTER.z },
      ARENA_START_HALF_DISTANCE * 2,
      first,
    );
  }

  /** 公共几何:按"中点 + 两人水平距离"算机位/朝向,平滑后下发 */
  private placeAt(mid: Vector3, distance: number, forceOption: boolean): void {    const force = forceOption || this.pendingEnterEase;

    const { radius, fov } = frameFor(distance);
    const side = CAMERA_SIDE === "positive" ? 1 : -1;
    const target: Vector3 = { x: mid.x, y: 0, z: mid.z };
    if (this.context.axis === "x") {
      target.z += side * radius;
    } else {
      target.x += side * radius;
    }
    // 高度:双方中点 + 偏移,夹在地板安全高度以上
    target.y = Math.max(CAMERA_MIN_Y, mid.y + CAMERA_HEIGHT_OFFSET);

    // ---- 平滑:目标不抖,画面就不抖 ----
    const prev = this.smoothPos;
    // 首帧 / force(换局、开场)= 直接吸附目标,让引擎自己去插值这段位移
    const pos: Vector3 =
      prev === undefined || force
        ? { ...target }
        : lerpVec(prev, target, CAMERA_SMOOTHING);
    this.smoothPos = pos;

    // ---- 朝向:看向中点上方(aim),pitch 由几何算出 ----
    const look = lookAt(pos, {
      x: mid.x,
      y: mid.y + CAMERA_AIM_HEIGHT,
      z: mid.z,
    });
    const rotation = { x: clamp(look.x, -89, 89), y: look.y };

    this.maybeSendCamera(pos, rotation, force);
    this.maybeSendFov(fov, force);

    // 记录"最近一次算出的位姿",供 HUD(TextPrimitive 伪屏幕)反算世界坐标。
    // 注意:这里记的是**几何目标位姿**(每 tick 都在变),HUD 因此能连续跟随构图,
    //      而相机本体由引擎按 easeOptions 插值追上去。
    lastPoses.set(this.player.id, {
      pos: { ...pos },
      yaw: rotation.y,
      pitch: rotation.x,
      fov,
    });
  }

  private horizontalOf(a: CameraFighter, b: CameraFighter): number {
    return this.context.axis === "x"
      ? b.location.x - a.location.x
      : b.location.z - a.location.z;
  }

  /**
   * **开局近景运镜**:给单个角色一个特写,段内做一次横向平移(运镜感)。
   *
   * 规格(2026-09-25):开局用 camera 近景运镜展示两个角色的开场动画。
   * 每名角色一段(INTRO_CAMERA_TICKS),段内 progress 0→1 时镜头沿竞技场轴
   * 从 -DRIFT 平移到 +DRIFT;换人时由 Match 先 `invalidate()` ⇒ 相机用长缓动
   * 从上一个特写滑到下一个,不会硬切。
   *
   * @param target   角色脚底世界坐标
   * @param progress 该段进度 0~1
   */
  introCloseUp(target: Vector3, progress: number, facing: 1 | -1 = 1): void {
    if (!isPlayerValid(this.player)) return;
    const side = CAMERA_SIDE === "positive" ? 1 : -1;
    const drift =
      (clamp(progress, 0, 1) - 0.5) * 2 * INTRO_CAMERA_DRIFT;
    // 开场特写改为角色正面：沿角色朝向的竞技场轴放机位，另加很小的
    // 侧向偏移形成 3/4 运镜。这样能看清低头、抬头和手捧珍珠，而不是只
    // 从侧面看到一条轮廓。
    const pos: Vector3 = {
      x: target.x,
      y: Math.max(CAMERA_MIN_Y, target.y + INTRO_CAMERA_HEIGHT),
      z: target.z,
    };
    if (this.context.axis === "x") {
      pos.x += facing * INTRO_CAMERA_DISTANCE;
      pos.z += side * (0.75 + drift * 0.35);
      pos.x += drift * 0.18;
    } else {
      pos.z += facing * INTRO_CAMERA_DISTANCE;
      pos.x += side * (0.75 + drift * 0.35);
      pos.z += drift * 0.18;
    }
    const look = lookAt(pos, {
      x: target.x,
      y: target.y + INTRO_CAMERA_AIM_HEIGHT,
      z: target.z,
    });
    const rotation = { x: clamp(look.x, -89, 89), y: look.y };

    // 换人/首次下发用长缓动;段内按节流正常发(每 2 tick),连成平移
    const enter = this.pendingEnterEase || this.lastSentPos === undefined;
    this.pendingEnterEase = false;
    this.maybeSendCamera(
      pos,
      rotation,
      enter,
      enter ? CAMERA_ENTER_EASE_SECONDS : CAMERA_EASE_SECONDS,
    );
    this.maybeSendFov(INTRO_CAMERA_FOV, enter);

    lastPoses.set(this.player.id, {
      pos: { ...pos },
      yaw: rotation.y,
      pitch: rotation.x,
      fov: INTRO_CAMERA_FOV,
    });
  }

  /**
   * 大招镜头用的硬切。与普通 update/introCloseUp 不共享缓动，调用后下一帧
   * 的侧视 update 会重新建立缓存；适合“看清抛珠 → 硬切侧面 → 每次重击
   * 重新取景”的格斗演出。
   */
  hardCut(location: Vector3, focus: Vector3, fov = CAMERA_BASE_FOV, trackingSeconds = 0): void {
    this.setShot(location, focus, fov, trackingSeconds, false);
  }

  /** 平滑进入拳击特写，位置与 FOV 使用相同过渡时长。 */
  smoothShot(location: Vector3, focus: Vector3, fov: number, seconds: number): void {
    this.setShot(location, focus, fov, seconds, true);
  }

  private setShot(location: Vector3, focus: Vector3, fov: number, trackingSeconds: number, smoothFov: boolean): void {
    if (!isPlayerValid(this.player)) return;
    const rotation = lookAt(location, focus);
    try {
      this.player.camera.setCamera("minecraft:free", {
        location: { ...location },
        rotation: { x: clamp(rotation.x, -89, 89), y: rotation.y },
        ...(trackingSeconds > 0 ? {easeOptions:{easeTime:trackingSeconds,easeType:EasingType.Linear}} : {}),
      });
      this.player.camera.setFov({ fov,
        ...(smoothFov ? {easeOptions:{easeTime:trackingSeconds,easeType:EasingType.Linear}} : {}),
      });
      this.lastSentPos = { ...location };
      this.lastSentFov = fov;
      this.nextAllowedTick = system.currentTick + CAMERA_UPDATE_TICKS;
      this.smoothPos = { ...location };
      this.cleared = false;
      this.pendingEnterEase = false;
      lastPoses.set(this.player.id, {
        pos: { ...location },
        yaw: rotation.y,
        pitch: clamp(rotation.x, -89, 89),
        fov,
      });
    } catch (error) {
      console.warn("[Bearcade allstars] hardCut 相机失败", error);
    }
  }

  private maybeSendCamera(
    pos: Vector3,
    rotation: { x: number; y: number },
    force: boolean,
    easeSeconds?: number,
  ): void {
    const now = system.currentTick;
    const last = this.lastSentPos;
    if (!force && last !== undefined && now < this.nextAllowedTick) {
      return;
    }
    if (!force && last !== undefined) {
      if (distanceOf(pos, last) < CAMERA_POS_EPSILON) {
        // 位置几乎没动 → 不发,但把闸门顺延,避免下一 tick 又立刻发
        this.nextAllowedTick = now + Math.max(1, CAMERA_UPDATE_TICKS);
        return;
      }
    }
    try {
      this.player.camera.setCamera("minecraft:free", {
        location: { x: pos.x, y: pos.y, z: pos.z },
        rotation: { x: rotation.x, y: rotation.y },
        easeOptions: {
          easeTime:
            easeSeconds ??
            (force ? CAMERA_ENTER_EASE_SECONDS : CAMERA_EASE_SECONDS),
          // 常规运镜用 Linear:每次正好走完一个节流间隔 ⇒ 首尾相接的匀速运动
          // (InOutSine 会在每个 0.1s 分段内又加速又减速,叠起来就是"一顿一顿");
          // 大幅换位(force)才用 InOutSine,起步/收尾更柔和。
          easeType: force ? EasingType.InOutSine : EasingType.Linear,
        },
      });
      this.lastSentPos = { x: pos.x, y: pos.y, z: pos.z };
      this.nextAllowedTick = now + Math.max(1, CAMERA_UPDATE_TICKS);
      this.cleared = false;
      this.pendingEnterEase = false;
    } catch (error) {
      console.warn("[Bearcade allstars] setCamera 失败", error);
    }
  }

  private maybeSendFov(fov: number, force: boolean): void {
    const step = Math.max(0.1, CAMERA_FOV_QUANTIZE);
    const quantized = Math.round(fov / step) * step;
    if (
      !force &&
      this.lastSentFov !== undefined &&
      Math.abs(quantized - this.lastSentFov) < CAMERA_FOV_EPSILON
    ) {
      return;
    }
    try {
      this.player.camera.setFov({
        fov: quantized,
        easeOptions: {
          easeTime: CAMERA_FOV_EASE_SECONDS,
          easeType: EasingType.InOutSine,
        },
      });
      this.lastSentFov = quantized;
      this.cleared = false;
    } catch (error) {
      console.warn("[Bearcade allstars] setFov 失败", error);
    }
  }

  /** 命中震屏(intensity 会被夹到 Camera.addShake 上限 4.0) */
  shake(intensity: number, seconds: number): void {
    if (!isPlayerValid(this.player)) return;
    try {
      this.player.camera.addShake({
        intensity: clamp(intensity, 0, 4),
        duration: Math.max(0.01, seconds),
        type: CameraShakeType.Positional,
      });
    } catch (error) {
      console.warn("[Bearcade allstars] addShake 失败", error);
    }
  }

  /** 回合切换黑屏淡入淡出 */
  fade(seconds = 0.25): void {
    if (!isPlayerValid(this.player)) return;
    try {
      this.player.camera.fade({
        fadeTime: { fadeInTime: seconds, holdTime: 0, fadeOutTime: seconds },
        fadeColor: { red: 0, green: 0, blue: 0 },
      });
    } catch (error) {
      console.warn("[Bearcade allstars] camera.fade 失败", error);
    }
  }

  /** 清相机 + FOV/平滑状态复位。**可重复调用**(清理契约)。 */
  clear(): void {    this.lastSentPos = undefined;
    this.lastSentFov = undefined;
    this.nextAllowedTick = -1;
    this.smoothPos = undefined;
    this.cleared = true;
    resetPlayerCamera(this.player);
  }
}
