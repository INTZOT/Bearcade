// ============================================================
// Fighter:一名角色(自定义实体 bearcade:allstars_chunye + 背后操控它的玩家)
//
// 职责边界:
//   - 持有血量 / 气 / 朝向 / 状态机时钟;
//   - 把 Intent 转成动画 + 位移(位置由**脚本接管**,不依赖引擎重力);
//   - 招式释放与命中窗口判定(占位版:中段窗口 + 单一 reach);
//   - 受击 / 防御 / 击退。
//
// 不做的事(留给 Match):回合编排、HUD、相机、清场、胜负。
// ============================================================

import {
  system,
  type Dimension,
  type Entity,
  type Player,
  type VanillaEntityIdentifier,
  type Vector3,
} from "@minecraft/server";
import {
  ACTIVE_WINDOW_BONUS_TICKS,
  ACTIVE_WINDOW_MIN_TICKS,
  ARENA_AXIS,
  ARENA_CENTER,
  ARENA_FLOOR_Y,
  ARENA_HALF_WIDTH,
  CHAIN_WINDOW_TICKS,
  COMBO_RESET_TICKS,
  DASH_PEARL_RELEASE_TICKS,
  DASH_SPEED,
  FACING_DEADZONE,
  FIGHTER_TAG,
  GRAVITY_PER_TICK,
  GROUND_SNAP_EPSILON,
  GETUP_INVULNERABILITY_TICKS,
  GUARD_HITSTUN_TICKS,
  HITSTOP_BLOCKED_TICKS,
  HITSTOP_TICKS,
  HIT_KNOCKBACK_SPEED,
  HIT_VERTICAL_TOLERANCE,
  LEAF_RISE_HIT_REACH,
  LEAF_RISE_VERTICAL_TOLERANCE,
  JUMP_LANDING_TICKS,
  JUMP_STARTUP_TICKS,
  JUMP_VELOCITY,
  KNOCKBACK_DECAY_PER_TICK,
  KNOCKDOWN_COMBO_HITS,
  KNOCKDOWN_GETUP_TICKS,
  KNOCKDOWN_INVULNERABLE,
  KNOCKDOWN_KNOCKBACK_SPEED,
  KNOCKDOWN_POP_VELOCITY,
  KNOCKDOWN_TICKS,
  LEAF_DIVE_DOWN_SPEED,
  LEAF_DIVE_FORWARD_SPEED,
  LEAF_COOLDOWN_TICKS,
  LEAF_RISE_RECOVERY_TICKS,
  LEAF_DIVE_HITSTUN_TICKS,
  LEAF_COUNTER_STARTUP_MAX_TICKS,
  LEAF_COUNTER_VERTICAL_TOLERANCE,
  LEAF_LAUNCH_KNOCKBACK,
  LEAF_LAUNCH_POP,
  LEAF_LAUNCH_TICKS,
  LEAF_RISE_FORWARD_SPEED,
  LEAF_RISE_LOOP_MAX,
  LEAF_RISE_UP_SPEED,
  MAX_FALL_SPEED,
  MAX_HP,
  MAX_METER,
  METER_ON_TAKE_HIT,
  METER_PER_SUPER_DAMAGE,
  MIN_FIGHTER_GAP,
  MIN_GAP_IGNORE_HEIGHT,
  MOVE_SPEED,
  DASH_TICKS,
  SKILLS,
  SPECIAL_VERTICAL_TOLERANCE_BONUS,
  SUPER_CLIP_BY_METER,
  SUPER_CAPTURE_RATE,
  SUPER_1_STEP_DISTANCE,
  SUPER_1_HIT_REACH,
  SUPER_1_GUARD_AUTHOR_START,
  SUPER_1_GUARD_AUTHOR_END,
  SUPER_HITSTOP_TICKS,
  SUPER_VICTIM_CLIP,
  SUPER_WHIFF_CLIP,
  THROW_KNOCKDOWN,
  THROW_KNOCKDOWN_TICKS,
  THROW_TECH_CAST_CLIP,
  THROW_TECH_SEPARATE_SPEED,
  THROW_TECH_VICTIM_CLIP,
  THROW_TECH_WINDOW_TICKS,
  THROW_VICTIM_START_OFFSET_TICKS,
  THROW_WHIFF_CLIP,
  USE_REAL_FRAME_DATA,
} from "./combat-config";
import type { ArenaAxis, SkillSlot, StanceName, SuperTier } from "./combat-config";
import {
  advanceClip,
  clipElapsed,
  delayQueuedClip,
  forgetClip,
  setBodyOpacity,
  clearQueuedClip,
  clipGameTicks,
  currentClip,
  flushQueuedClip,
  hasClip,
  playClip,
  queueClip,
  releaseClipHold,
} from "./anim";
import { currentTick } from "./tick";
import {
  dismissProp,
  handPoint,
  moveProp,
  spawnPearl,
} from "./props";
import type { Facing, Intent } from "./input";
import { CHUNYE_ENTITY_ID } from "./data/chunye.clips";
import { attackFrames } from "./data/chunye.combat";
import { CHUNYE_DAMAGE } from "./data/chunye.damage";
import { CHUNYE_HIT_LEVELS, type HitLevel } from "./data/chunye.hit-levels";
import { DamageCombo, SUPER_MIN_DAMAGE_PERCENT, type ComboStarter } from "./damage";

/** 角色状态机状态 */
export type FighterState =
  | "idle"
  | "walk"
  | "crouch"
  | "jump"
  | "attack"
  | "hit"
  | "down"
  | "guard"
  | "victory";

/** 一次命中的结算结果,交给 Match 决定震屏 / 播报 / 回合逻辑 */
export interface HitInfo {
  attacker: Fighter;
  victim: Fighter;
  skill: SkillSlot;
  damage: number;
  blocked: boolean;
  /** 本次命中把对手打倒在地(投技命中 / 连击打满) */
  knockdown: boolean;
  /** 本次命中的定帧 tick(双方一起停;Match 用它同步冻结相机时钟) */
  hitstop: number;
  /** 这次命中是否把防御姿态打穿（用于 HUD 提示，不改变伤害结算）。 */
  guardBroken?: boolean;
  /** 捕获不是伤害接触；不要用 damage===0 猜测，以免重复进入配对。 */
  capture?: "throw" | "super2";
  /** 捕获时已锁定补正，冲击帧才真正扣血。 */
  deferredDamage?: number;
}

/** 当前正在执行的招式(active 窗口判定用) */
interface ActiveMove {
  slot: SkillSlot;
  clipId: string;
  hitLevel: HitLevel;
  startTick: number;
  /** 实际按键被接受的 tick，不随演出快慢而变，用于后发反击排序。 */
  acceptedTick: number;
  totalTicks: number;
  activeFrom: number;
  activeTo: number;
  /** 本次挥击已结算过命中(只结算一次) */
  resolved: boolean;
  /** 分段位移动作(发波空中/蹲下变体) */
  special?: MoveSpecial;
  pearlStep?: { origin: number; target: number; from: Vector3 };
  /** 一气位移阶段是否观察到对手处于正确防御；蓄力阶段不再新开防御窗口。 */
  super1GuardSeen?: boolean;
}

/** 分段动作里的一段(动画 + 时长) */
interface MoveStage {
  clip: string;
  ticks: number;
}

/**
 * 发波的两个"有位移的分段动作"(规格给的分段语义):
 *   dive = 空中叶片俯冲:start → loop×N(向右下移动)→ 命中切 hit / 真实落地切 land
 *   rise = 蹲下上挑本体:start → loop×N(向上移动)→ end,之后按真实高度下落
 * 命中或落地后**立刻停止位移**。
 */
interface MoveSpecial {
  kind: "dive" | "rise";
  stages: MoveStage[];
  /** 命中后的收势 */
  hitClip?: string;
  /** 未命中但真实落地后的收势 */
  landClip?: string;
  /** 命中窗口(相对招式起手的 tick 区间) */
  activeFrom: number;
  activeTo: number;
}

/**
 * 命中"风味":由施放者在判定成功那一刻决定,传给受击者决定它播什么。
 * 规格要求 `*_victim` 不绑定玩家按键,而是**服务端确认命中后**自动触发。
 */
export interface HitFlavor {
  /** 当前挥击的防御属性；脱离角色飞行的波固定传 mid。 */
  hitLevel?: HitLevel;
  /** 一气只允许使用位移阶段留下的防御资格。 */
  super1GuardOnlyDuringTravel?: boolean;
  /** 受击方配对动画(一/二气大招的 super_N_victim) */
  victimClip?: string;
  /** 被上挑击飞(蹲下发波命中):hit → air 循环 → 真实落地 land → 倒地/起身 */
  launch?: boolean;
  /** 由出招时的招式类型决定，不能读取命中时已经改变的站姿。 */
  leafKind?: "rise" | "dive";
}

/** 倒地方案:一条"进入动画 → 躺地 → 起身"的动作时钟 */
interface DownPlan {
  /** 进入动画 */
  enter: string;
  /** 躺地循环 */
  idle: string;
  /** 被打飞时的空中循环(有它才会在空中播它,而不是一直播进入动画) */
  airLoop?: string;
  /** 真实落地时的收势(只播一次) */
  landClip?: string;
  /** 总时长(含最后的 getup) */
  totalTicks: number;
  /** 上抛初速(格/tick) */
  pop: number;
  /** 水平击退初速(格/tick) */
  knockback: number;
}

function axisComponent(axis: ArenaAxis): "x" | "z" {
  return axis === "x" ? "x" : "z";
}

/** 站姿 → 动画。蹲下/空中没有独立走路动画,用蹲待机 / 空中姿态占位 [待调] */
const WALK_CLIPS: Record<StanceName, string> = {
  stand: "walk_forward",
  crouch: "idle_crouch",
  air: "air_rise",
};

/** 背离对手方向走时用的动画(stand 有 walk_backward,其余复用占位) */
const BACK_CLIPS: Record<StanceName, string> = {
  stand: "walk_backward",
  crouch: "idle_crouch",
  air: "air_rise",
};

const IDLE_CLIPS: Record<StanceName, string> = {
  stand: "idle_stand",
  crouch: "idle_crouch",
  air: "air_fall",
};

const GUARD_CLIPS: Record<StanceName, string> = {
  stand: "guard_stand",
  crouch: "guard_crouch",
  air: "guard_stand",
};

const GUARD_HIT_CLIPS: Record<StanceName, string> = {
  stand: "guard_hit_stand",
  crouch: "guard_hit_crouch",
  air: "guard_hit_stand",
};

const HIT_CLIPS: Record<StanceName, string> = {
  stand: "hit_stand",
  crouch: "hit_crouch",
  air: "hit_air",
};

/** 轻/中/重的站姿前缀 */
const ATTACK_PREFIX: Record<StanceName, string> = {
  stand: "attack_stand_",
  crouch: "attack_crouch_",
  air: "attack_air_",
};

/** 被打倒(连续挨打打满)的倒地方案 */
const KNOCKDOWN_PLAN: DownPlan = {
  enter: "knockdown",
  idle: "idle_down",
  totalTicks: KNOCKDOWN_TICKS,
  pop: KNOCKDOWN_POP_VELOCITY,
  knockback: KNOCKDOWN_KNOCKBACK_SPEED,
};

/** 被投技摔倒的倒地方案(用配对的 throw_victim) */
const THROW_DOWN_PLAN: DownPlan = {
  enter: "throw_victim",
  idle: "idle_down",
  totalTicks: THROW_KNOCKDOWN_TICKS,
  pop: KNOCKDOWN_POP_VELOCITY,
  knockback: KNOCKDOWN_KNOCKBACK_SPEED,
};

/** 三段连打状态(按实体隔离)。
 * 资产规定 `automatic_three_hit_playback = false`、`one_short_press_one_strike = true`:
 * 每次短按只出一段,连打才递进 —— 用"上一次攻击键 + 窗口到期 tick"驱动。
 */
interface ChainState {
  slot?: SkillSlot;
  /** 0 = 第一段,1 = _2,2 = _3 */
  segment: number;
  expireTick: number;
  stance?: StanceName;
}

const chainStates = new WeakMap<Entity, ChainState>();

/** 推进连段并返回本次应使用的段下标(0/1/2);非攻击键会清空连段 */
function advanceChain(
  entity: Entity | undefined,
  slot: SkillSlot,
  now: number,
  stance: StanceName,
): number {
  if (!entity) return 0;
  if (slot !== 1 && slot !== 2 && slot !== 3) {
    chainStates.delete(entity);
    return 0;
  }
  const state = chainStates.get(entity) ?? { segment: 0, expireTick: 0 };
  const continuing =
    state.slot === slot && state.stance === stance && now <= state.expireTick && state.segment < 2;
  const segment = continuing ? state.segment + 1 : 0;
  chainStates.set(entity, {
    slot,
    stance,
    segment,
    expireTick: now + CHAIN_WINDOW_TICKS,
  });
  return segment;
}

/** 清空连段状态(受击 / 回合开始时调用) */
function resetChain(entity: Entity | undefined): void {
  if (entity) chainStates.delete(entity);
}

/**
 * 一名角色。构造时**尚未生成实体**,调用 spawn() 才落场。
 * 之后所有方法都必须在 system.runInterval / system.run 回调内调用。
 */
export class Fighter {
  readonly dimension: Dimension;
  readonly player: Player;
  readonly side: 0 | 1;
  readonly name: string;

  /**
   * 当前朝向(朝对手的方向,+1 = 竞技场轴正方向)。
   * **会随双方实际左右关系变化**(规格 2026-09-25:人物左右关系改变后自动转向);
   * 但"动作开始后锁定朝向"——出招/冲刺/硬直/倒地期间不转身,免得后撤突进时反身。
   */
  private facingValue: Facing;

  get facing(): Facing {
    return this.facingValue;
  }

  entity?: Entity;
  hp = MAX_HP;
  meter = 0;
  state: FighterState = "idle";
  /** 招式/硬直锁定到的 tick(<= 当前 tick 表示可行动) */
  busyUntilTick = 0;
  /** 垂直速度(格/tick) */
  velocityY = 0;
  stance: StanceName = "stand";
  /**
   * 最近一次成功释放大招时**实际消耗的气量档位**(1/2/3)。
   * 只有 slot 6 会写它;用途:Match 侧据此决定
   *   - 1/2 气 → 释放时停窗口(SUPER_FREEZE_TIERS);
   *   - 3 气 → 启动三气分段演出时间线(低血分支在释放被接受时锁定)。
   * 读取时机约定:在 useSkill(6) 返回 true 之后**同一 tick 内**读。
   */
  lastSuperTier?: 1 | 2 | 3;

  /**
   * 连续命中计数(被打的一侧累加):
   * 每次**非防御**命中 +1,达到 KNOCKDOWN_COMBO_HITS 就把被打者打倒地并清零;
   * 超过 COMBO_RESET_TICKS 没再被命中也会清零(连招断了)。
   * 防御成功(chip)/ 倒地免疫期间不累加。
   */
  private comboHits = 0;
  private comboExpireTick = 0;
  /** 独立于五连击强制倒地计数，演出/时停不会导致伤害补正过期。 */
  private readonly damageCombo = new DamageCombo();
  /** 倒地状态结束 tick */
  private downUntilTick = 0;
  /** 倒地"进入动画"播完、开始循环 idle_down 的 tick */
  private downIdleFromTick = 0;
  /** 当前倒地方案(击倒 / 被投 / 被上挑击飞 / KO) */
  private downPlan?: DownPlan;
  /** 被上挑击飞后是否真的在空中待过(决定要不要播落地收势) */
  private downWasAirborne = false;
  /** 落地收势是否已播过 */
  private downLandPlayed = false;
  /** 命中定帧结束 tick:这段时间内不接受移动/击退/垂直物理(动画继续播) */
  private hitstopUntilTick = 0;
  /** 三气起手的极短无敌窗口，按游戏 tick 计。 */
  private invulnerableUntilTick = 0;
  /** 冲刺(突进)结束 tick;dashDir 是绝对屏幕方向(±1) */
  private dashUntilTick = 0;
  private dashDir = 0;
  private dashClip = "dash_forward";
  /** 冲刺的末影珍珠道具(源资产:dash.release 后独立飞向突进终点) */
  private dashPearl?: Entity;
  private dashPearlReleaseTick = 0;
  private dashPearlFrom?: Vector3;
  private dashOrigin = 0;
  private dashTarget = 0;
  private offstage = false;

  /** 沿竞技场轴的局部坐标(以 ARENA_CENTER 为原点) */
  private localAxis: number;
  /** 脚底 y(脚本接管) */
  private y = ARENA_FLOOR_Y;
  /** 击退速度(沿轴局部量,格/tick) */
  private knockback = 0;
  private activeMove?: ActiveMove;
  private leafCooldownUntilTick = 0;
  /**
   * 是否正在播"脚本编排的演出"(三气分段 / 大招时停)。
   * 为 true 时:**不自动回 idle**、**不结算命中**——演出段的进度由 Match 的时间线
   * 独占驱动,否则超长段动画中途会被 idle 顶掉,或让一个大招打出多次伤害。
   */
  private performing = false;
  /** 最近一次由本角色检测到的拆投对象，交给 Match 做一次全局播报。 */
  private throwTechPartner?: Fighter;
  private pendingVictory?: { matchWinner: boolean; landUntilTick?: number };

  get waitingForVictory(): boolean { return this.pendingVictory !== undefined; }

  constructor(
    dimension: Dimension,
    player: Player,
    side: 0 | 1,
    facing: Facing,
    name: string,
    spawnLocalAxis: number,
  ) {
    this.dimension = dimension;
    this.player = player;
    this.side = side;
    this.facingValue = facing;
    this.name = name;
    this.localAxis = spawnLocalAxis;
  }

  // ================= 生成 / 销毁 =================

  /** 生成角色实体。失败返回 false(Match 会兜底结束对局)。 */
  spawn(): boolean {
    try {
      // spawnEntity 的形参类型是 VanillaEntityIdentifier(原版 id 联合类型),
      // 自定义实体 id 需要断言;这是仓库内既有做法(自定义实体都这么生成)。
      const entity = this.dimension.spawnEntity(
        CHUNYE_ENTITY_ID as VanillaEntityIdentifier,
        this.worldPos(this.localAxis, this.y),
      );
      this.entity = entity;
      try {
        entity.addTag(FIGHTER_TAG);
      } catch {
        // 忽略
      }
      try {
        // 角色头顶固定显示操控席位；颜色按屏幕两侧绑定，双方视角一致。
        entity.nameTag = ""; // TextPrimitive seat markers replace vanilla name tags.
      } catch {
        // 忽略
      }
      // 关掉引擎重力:实体定义里的 bearcade:allstars_driven 组件组
      // (has_gravity: false)才是脚本接管 y 的前提,否则引擎重力每 tick 与
      // 脚本 teleport 互相打架 → 角色抖动/悬浮。
      try {
        entity.triggerEvent("bearcade:allstars_driven");
      } catch (error) {
        console.warn(
          "[Bearcade allstars] 切换到无重力组件组失败,角色可能出现抖动",
          error,
        );
      }
      entity.setProperty("bearcade:allstars_blue", this.side === 1);
      this.commitPosition();
      playClip(entity, "idle_stand", { force: true });
      return true;
    } catch (error) {
      console.warn(`[Bearcade allstars] 角色实体生成失败 side=${this.side}`, error);
      this.entity = undefined;
      return false;
    }
  }

  /** 移除角色实体(**可重复调用**) */
  remove(): void {
    const entity = this.entity;
    forgetClip(entity);
    this.entity = undefined;
    if (!entity) return;
    try {
      if (entity.isValid) entity.remove();
    } catch {
      // 已经被移除 / 维度卸载
    }
  }

  get isValid(): boolean {
    try {
      return this.entity !== undefined && this.entity.isValid;
    } catch {
      return false;
    }
  }

  /**
   * 实体世界坐标(脚底基准);实体无效时返回脚本推算的位置。
   * 用 getter(而不是方法)是为了直接满足 camera.ts 的 CameraFighter 接口
   * (`{ isValid, location }`),相机侧不需要额外适配。
   */
  get location(): Vector3 {
    if (this.entity) {
      try {
        return this.entity.location;
      } catch {
        // 落到下面的兜底
      }
    }
    return this.worldPos(this.localAxis, this.y);
  }

  /** 沿竞技场轴的局部坐标(相机 / 命中判定用) */
  get axisPosition(): number {
    if (this.entity) {
      try {
        const loc = this.entity.location;
        const center = ARENA_CENTER;
        return axisComponent(ARENA_AXIS) === "x"
          ? loc.x - center.x
          : loc.z - center.z;
      } catch {
        // 落到下面的兜底
      }
    }
    return this.localAxis;
  }

  /** 当前脚底 y */
  get feetY(): number {
    try {
      return this.entity?.location.y ?? this.y;
    } catch {
      return this.y;
    }
  }

  /** 与另一名角色的水平距离 */
  distanceTo(other: Fighter): number {
    return Math.abs(this.axisPosition - other.axisPosition);
  }

  private worldPos(localAxis: number, feetY: number): Vector3 {
    const center = ARENA_CENTER;
    return axisComponent(ARENA_AXIS) === "x"
      ? { x: center.x + localAxis, y: feetY, z: center.z }
      : { x: center.x, y: feetY, z: center.z + localAxis };
  }

  /** 把脚本算出的局部坐标写进世界 */
  private cinematicPose?: { depth: number; yaw: number };

  private commitPosition(): void {
    const entity = this.entity;
    if (!entity) return;
    try {
      if (!entity.isValid) return;
      const position=this.worldPos(this.localAxis, this.y);
      if (this.offstage) position.y = ARENA_FLOOR_Y - 32;
      if (this.cinematicPose) {
        if (ARENA_AXIS === "x") position.z += this.cinematicPose.depth;
        else position.x += this.cinematicPose.depth;
      }
      entity.teleport(position, {
        checkForBlocks: false,
        // MC 约定:yaw 0 = +Z(南),yaw 90 = **-X**,yaw -90 = **+X**。
        // 所以"朝 +x(facing=1)"要用 -90 —— 旧代码写反了(90),实机表现为
        // 角色背对对手(模型朝向反了)。见 docs/lessons.md §14。
        rotation: { x: 0, y: this.cinematicPose?.yaw ?? (ARENA_AXIS === "x" ? (this.facing === 1 ? -90 : 90) : (this.facing === 1 ? 0 : 180)) },
      });
    } catch {
      // 实体恰好失效:忽略,下一 tick 再试
    }
  }

  // ================= 每 tick 推进 =================

  /**
   * 每 tick 推进一次。
   * @returns 本 tick 产生的命中(0 或 1 个),由 Match 结算特效与回合逻辑
   */
  tick(
    intent: Intent,
    opponent: Fighter | undefined,
    allowControl: boolean,
  ): HitInfo | undefined {
    if (!this.isValid) return undefined;
    const now = currentTick();
    if (this.inHitstop) return undefined;
    this.resetDamageComboIfRecovered();

    // -1) 转向:按双方实际左右关系朝对手;动作/硬直/倒地期间锁定
    this.updateFacing(opponent);

    this.refreshStance();

    // 0) 先补播到点的过渡衔接动画(如 crouch_enter → idle_crouch)。
    //    已经排定的衔接必须优先于本 tick 重新推导的状态动画,否则会被顶掉。
    if (flushQueuedClip(this.entity, this.key())) {
      this.tickPhysics(now, opponent);
      return undefined;
    }

    // 0a) 倒地(投技摔倒 / 连击打满):锁输入 + 免疫伤害 + 播"倒地→躺地→起身"
    if (this.state === "down") {
      this.tickDown(now);
      if (this.state === "down") {
        this.tickPhysics(now, opponent);
        return undefined;
      }
      // 起身完成:本 tick 直接交回下面的正常流程
    }

    // 1) 招式推进优先(招式期间完全锁输入)
    if (this.performing) {
      // 脚本编排的演出中:不结算命中、不自动回 idle,只跑物理。
      // 段落推进由 Match 的大招时间线独占驱动。
      this.commitPosition();
      return undefined;
    }
    const hit = this.tickMove(now, opponent);
    if (hit) {
      // 位移招式已推进 localAxis；命中即提交，避免定帧结束后才补跳一格。
      this.commitPosition();
      return hit;
    }

    // 1a) 冲刺(突进)推进:位移由脚本给,期间不接受普通操作
    if (now < this.dashUntilTick) {
      this.tickDash();
      this.tickPhysics(now, opponent);
      return undefined;
    }
    // 冲刺结束(或没开始过):顺手收回珍珠道具(可重复调用,无道具时是空操作)
    this.endDashPearl();

    // 2) 硬直/招式收尾中:只跑物理
    if (now < this.busyUntilTick) {
      // 空中受击后仍要落地
      this.tickPhysics(now, opponent);
      return undefined;
    }

    // 3) 可行动
    if (!allowControl) {
      this.enterIdle();
      this.tickPhysics(now, opponent);
      return undefined;
    }

    this.tickLocomotion(intent, now);
    this.tickPhysics(now, opponent);
    return undefined;
  }

  /**
   * 按双方实际左右关系更新朝向(自动转向对手)。
   *
   * 规格(2026-09-25):"人物左右关系改变后不会自动转向" —— 旧实现把朝向写死在
   * 出生侧(槽位),跳过对手后就一直背对着人。
   *
   * 锁定期:出招 / 冲刺 / 硬直 / 倒地 / 演出期间**不转身**(源资产 integration.facing:
   * "lock facing at action start; backward dash never turns away")。
   */
  private updateFacing(opponent: Fighter | undefined): void {
    if (!opponent || !opponent.isValid) return;
    if (this.isBusy || this.isDown || this.performing) return;
    const gap = opponent.axisPosition - this.axisPosition;
    if (Math.abs(gap) < FACING_DEADZONE) return;
    this.facingValue = gap > 0 ? 1 : -1;
  }

  private refreshStance(): void {    if (!this.isGrounded()) {
      this.stance = "air";
      return;
    }
    this.stance = this.isCrouchingFlag ? "crouch" : "stand";
  }

  /** 是否处于下蹲姿态(由 tickLocomotion 维护,refreshStance 只读) */
  private isCrouchingFlag = false;

  private isGrounded(): boolean {
    return this.y <= ARENA_FLOOR_Y + GROUND_SNAP_EPSILON;
  }

  private tickLocomotion(intent: Intent, now: number): void {
    // ---- 冲刺(突进):双击同方向触发,优先级高于普通移动 ----
    if (intent.dash !== 0 && this.isGrounded()) {
      this.beginDash(intent.dash, now);
      this.tickDash();
      return;
    }

    // ---- 防御:按住"背向对手"的水平方向 / 后拉(规格要求) ----
    // ★防御**不再定身**(2026-09-25 实机修正):旧实现按 `intent.guard` 直接 return,
    //   而"背向对手"在侧视下就是"往远离对手的方向推左右" ⇒ 玩家一按左/右键
    //   角色就原地不动,表现为"左右移动失灵"。现在防御期间横向仍可移动(慢速),
    //   与格斗游戏的"防御后撤"一致;下蹲与否只看是否真的按了后(depth)。
    if (intent.guard) {
      // ★防御动画必须跟随站姿:旧实现只在"进入 guard 那一 tick"播一次,
      //   之后 stance 从 stand 变 crouch 也不会换段 ⇒ 长按后拉看到的一直是
      //   站立防(实机"不会持续下蹲"的一个成因)。
      const crouching = intent.crouch && this.isGrounded();
      this.isCrouchingFlag = crouching;
      const guardClip = GUARD_CLIPS[crouching ? "crouch" : "stand"];
      const guardHitClip = GUARD_HIT_CLIPS[crouching ? "crouch" : "stand"];
      this.state = "guard";
      // 后拉本身仍然是可移动的后退动作；真正被命中时 receiveHit 才切
      // guard_hit_*，这样玩家不会一按后退就像原地举盾。
      const hitReactionPlaying = currentClip(this.entity) === guardHitClip && this.isBusy;
      if (!hitReactionPlaying && Math.abs(intent.horizontal) > 0.01) {
        const dir = Math.sign(intent.horizontal);
        this.localAxis +=
          dir * MOVE_SPEED * Math.min(1, Math.abs(intent.horizontal));
        this.clampToArena();
        const retreatClip = BACK_CLIPS[crouching ? "crouch" : "stand"];
        if (currentClip(this.entity) !== retreatClip) playClip(this.entity, retreatClip);
      } else if (!hitReactionPlaying && currentClip(this.entity) !== guardClip) {
        playClip(this.entity, guardClip);
      }
      return;
    }
    if (this.state === "guard") {
      // 松开防御 → 交回下面的跳跃/下蹲/移动分支决定姿态
      this.state = "idle";
    }

    // ---- 跳跃:必须在地面 ----
    if (intent.jump && this.isGrounded()) {
      this.state = "jump";
      this.isCrouchingFlag = false;
      this.velocityY = JUMP_VELOCITY;
      this.busyUntilTick = now + JUMP_STARTUP_TICKS;
      playClip(this.entity, "jump_start", { force: true });
      // jump_start 只有 1 tick:等它播完再交给空中循环动画(air_rise/air_fall)
      this.stance = "air";
      return;
    }

    // ---- 下蹲 ----
    if (intent.crouch && this.isGrounded()) {
      this.isCrouchingFlag = true;
      if (this.state !== "crouch") {
        this.state = "crouch";
        this.stance = "crouch";
        playClip(this.entity, "crouch_enter", { force: true });
        // 过渡段 1 tick,延后 2 tick 再切蹲待机,否则过渡段一帧都看不到
        queueClip(this.key(), "idle_crouch", 2);
      }
      return;
    }
    if (this.state === "crouch" && !intent.crouch) {
      this.state = "idle";
      this.isCrouchingFlag = false;
      this.stance = "stand";
      playClip(this.entity, "crouch_exit", { force: true });
      queueClip(this.key(), "idle_stand", 2);
      return;
    }

    // ---- 水平移动 ----
    if (Math.abs(intent.horizontal) > 0.01) {
      const dir = Math.sign(intent.horizontal);
      this.isCrouchingFlag = false;
      this.localAxis +=
        dir * MOVE_SPEED * Math.min(1, Math.abs(intent.horizontal));
      this.clampToArena();
      this.state = "walk";
      // horizontal 是**绝对屏幕方向**(不再乘 facing):
      //   dir === facing ⇒ 朝对手方向走(walk_forward),否则是后撤(walk_backward)
      playClip(
        this.entity,
        dir === this.facing ? WALK_CLIPS[this.stance] : BACK_CLIPS[this.stance],
      );
      return;
    }

    // ---- 站立 ----
    this.isCrouchingFlag = false;
    this.enterIdle();
  }

  private enterIdle(): void {
    this.refreshStance();
    const target: FighterState = this.isGrounded() ? "idle" : "jump";
    const clip = IDLE_CLIPS[this.stance];
    if (this.state === target && currentClip(this.entity) === clip) return;
    this.state = target;
    playClip(this.entity, clip);
  }

  /**
   * 起手一次冲刺(突进)。
   *
   * 规格(2026-09-25):"连续两次左左 / 右右"向对应方向突进,并按实际情况调用
   * `dash_forward` / `dash_backward` —— 该方向**朝着对手**就用 forward,
   * 背离对手就用 backward(与 facing 比较即可)。
   */
  private beginDash(dir: number, now: number): void {
    const towardOpponent = dir === this.facing;
    this.dashDir = dir;
    this.dashClip = towardOpponent ? "dash_forward" : "dash_backward";
    clearQueuedClip(this.key());
    this.dashUntilTick = now + clipGameTicks(this.dashClip);
    // 冲刺期间锁普通操作(招式/移动让位);输入缓冲会把这段时间按的键接上
    this.busyUntilTick = Math.max(this.busyUntilTick, this.dashUntilTick);
    this.state = "walk";
    this.isCrouchingFlag = false;
    playClip(this.entity, this.dashClip, { force: true });

    // ---- 道具表现:末影珍珠先挂右手,release 后独立飞向突进终点 ----
    // (源资产 motion_vfx_metadata.dash:dash_forward release=4 制作tick ≈ 2 游戏 tick)
    try {
      this.dashPearlFrom = undefined;
      this.dashOrigin = this.localAxis;
      this.dashTarget = Math.max(-ARENA_HALF_WIDTH, Math.min(ARENA_HALF_WIDTH,
        this.localAxis + this.dashDir * DASH_SPEED * (DASH_TICKS - 1)));
      this.dashPearlReleaseTick = now + DASH_PEARL_RELEASE_TICKS;
      this.dashPearl = spawnPearl(this.dimension, this.handPoint("right"));
    } catch {
      // 道具是纯表现:失败不影响冲刺
    }
  }

  /** 冲刺位移(每 tick 一格 DASH_SPEED)+ 珍珠道具跟踪 */
  private tickDash(): void {
    const t = clipElapsed(this.entity) * 3;
    const start = currentClip(this.entity) === "dash_backward" ? 8 : 6;
    const u = Math.max(0, Math.min(1, (t-start) / 6));
    this.localAxis = this.dashOrigin + (this.dashTarget-this.dashOrigin)*u;
    this.clampToArena();
    this.tickDashPearl();
  }

  /** 珍珠:释放前贴右手,释放后直线飞向突进终点(与本体同一个可达终点) */
  private tickDashPearl(): void {
    const pearl = this.dashPearl;
    if (!pearl) return;
    try {
      const now = currentTick();
      const hand = this.handPoint("right");
      if (now < this.dashPearlReleaseTick) {
        moveProp(pearl, hand);
        return;
      }
      if (!this.dashPearlFrom) this.dashPearlFrom = hand;
      const end = this.worldPos(this.dashTarget, this.y + 0.08);
      const span = Math.max(1, (currentClip(this.entity) === "dash_backward" ? 14 : 12)/3 - DASH_PEARL_RELEASE_TICKS);
      const t = Math.min(1, (now - this.dashPearlReleaseTick) / span);
      const from = this.dashPearlFrom;
      moveProp(pearl, {
        x: from.x + (end.x - from.x) * t,
        y: from.y + (end.y - from.y) * t + 0.3*4*t*(1-t),
        z: from.z + (end.z - from.z) * t,
      });
    } catch {
      // 忽略
    }
  }

  /** 收回冲刺珍珠(冲刺结束/被打断/清场都调;可重复) */
  private endDashPearl(): void {
    dismissProp(this.dashPearl);
    this.dashPearl = undefined;
    this.dashPearlFrom = undefined;
  }

  /** 当前朝向下的"手"世界坐标(近似;见 props.handPoint) */
  private handPoint(which: "right" | "left" | "mid"): Vector3 {
    return handPoint({ location: this.location, facing: this.facing, entity: this.entity }, which);
  }

  private tickPhysics(now: number, opponent: Fighter | undefined): void {
    // ---- 定帧(hitstop):整个物理段停住(动画继续播),这就是"打到那一下顿住" ----
    if (this.inHitstop) {
      this.commitPosition();
      return;
    }
    // ---- 垂直:脚本抛物线(实体 has_gravity 已关,位置完全由脚本决定) ----
    if (!this.isGrounded() || this.velocityY > 0) {
      this.velocityY = Math.max(
        -MAX_FALL_SPEED,
        this.velocityY - GRAVITY_PER_TICK,
      );
      this.y += this.velocityY;
      if (this.y <= ARENA_FLOOR_Y) {
        const wasAir = this.stance === "air";
        this.y = ARENA_FLOOR_Y;
        this.velocityY = 0;
        this.stance = this.isCrouchingFlag ? "crouch" : "stand";
        // 倒地时落地不接 jump_land(否则"摔倒"会被落地动画顶掉)
        if (wasAir && this.state !== "down" && this.state !== "hit" && this.state !== "victory" && !this.performing) {
          const dive = this.activeMove?.special?.kind === "dive";
          this.activeMove = undefined;
          clearQueuedClip(this.key());
          setBodyOpacity(this.entity, 1);
          resetChain(this.entity);
          if (dive) { this.playRecovery("leaf_dive_land", now); this.commitPosition(); return; }
          this.state = "idle";
          this.busyUntilTick = Math.max(
            this.busyUntilTick,
            now + Math.max(JUMP_LANDING_TICKS, clipGameTicks("jump_land")),
          );
          playClip(this.entity, "jump_land", { force: true });
        }
      } else {
        this.stance = "air";
        // ★只有"自由滞空"(state = jump)才由物理推 air_rise/air_fall。
        //   旧实现只挡了倒地,于是**空中攻击/受击/俯冲/招式收势的动画会被
        //   下一 tick 的 air_rise/air_fall 直接顶掉**(air 攻击等于没有动作)。
        //   收势结束后 enterIdle() 会把 state 设回 jump,空中循环自然恢复。
        if (this.state === "jump" && now >= this.busyUntilTick) {
          playClip(this.entity, this.velocityY > 0 ? "air_rise" : "air_fall");
        }
      }
    }

    // ---- 水平:击退惯性 ----
    if (Math.abs(this.knockback) > 0.01) {
      this.localAxis += this.knockback;
      this.knockback *= KNOCKBACK_DECAY_PER_TICK;
      if (Math.abs(this.knockback) <= 0.01) this.knockback = 0;
      this.clampToArena();
    }

    // ---- 最小间距:防止两个角色重叠成一坨 ----
    // 但**高度差够大时不做分离**(规格:跳跃要能跳过对手) —— 否则空中会被
    // 水平推开,永远越不过去。落地后高度差回到阈值内,分离自然恢复。
    if (opponent && opponent.isValid) {
      const heightGap = Math.abs(this.feetY - opponent.feetY);
      const gap = this.axisPosition - opponent.axisPosition;
      if (heightGap < MIN_GAP_IGNORE_HEIGHT && Math.abs(gap) < MIN_FIGHTER_GAP) {
        const push = (MIN_FIGHTER_GAP - Math.abs(gap)) * (gap >= 0 ? 0.5 : -0.5);
        this.localAxis += push;
        this.clampToArena();
      }
    }

    this.commitPosition();
  }

  private clampToArena(): void {
    this.localAxis = Math.max(
      -ARENA_HALF_WIDTH,
      Math.min(ARENA_HALF_WIDTH, this.localAxis),
    );
  }

  // ================= 招式 =================

  /** 当前是否在招式/硬直锁定中 */
  get isBusy(): boolean {
    return currentTick() < this.busyUntilTick || this.activeMove !== undefined;
  }

  /** 是否处于倒地状态(投技摔倒 / 连击打满 / KO 倒地) */
  get isDown(): boolean {
    return this.state === "down";
  }

  /** 是否正处在防御姿态(三气首击"被挡住"判定用) */
  get isGuarding(): boolean {
    return this.state === "guard";
  }

  /** 是否处在外部编排的无敌窗口内。 */
  get isInvulnerable(): boolean {
    return currentTick() < this.invulnerableUntilTick;
  }

  /** 给角色追加一段无敌时间；只延后，不会提前结束已有窗口。 */
  grantInvulnerability(ticks: number): void {
    if (ticks <= 0) return;
    this.invulnerableUntilTick = Math.max(
      this.invulnerableUntilTick,
      currentTick() + Math.ceil(ticks),
    );
  }

  /** 当前连击计数(被打了多少下还没倒;调试日志用) */
  get comboCount(): number {
    return this.comboHits;
  }

  get leafCooldownRemaining(): number { return Math.max(0, this.leafCooldownUntilTick-currentTick()); }

  /** 只有升龙参与的两类冲突走后发反击；判定结束后的收招仍可被正常攻击。 */
  private leafClashWith(opponent: Fighter): boolean {
    const a=this.activeMove, b=opponent.activeMove;
    if (!a?.special || !b?.special || a.resolved || b.resolved) return false;
    if (a.special.kind!=="rise" && b.special.kind!=="rise") return false;
    const now=currentTick();
    return now-a.startTick<a.activeTo && now-b.startTick<b.activeTo;
  }

  /** 明确的后发反击/有效投技优先，不能由 1P 的更新顺序决定。 */
  resolvesBefore(opponent: Fighter): boolean {
    if (this.leafClashWith(opponent)) return this.activeMove!.acceptedTick>opponent.activeMove!.acceptedTick;
    const a=this.activeMove, b=opponent.activeMove;
    const canThrow=(f:Fighter,m:ActiveMove|undefined,target:Fighter)=>m?.slot===4 && !m.resolved &&
      currentTick()-m.startTick>=m.activeFrom && currentTick()-m.startTick<m.activeTo &&
      !target.isDown && !target.isInvulnerable && target.isGrounded() &&
      (target.axisPosition-f.axisPosition)*f.facing>=-0.05 && f.distanceTo(target)<=SKILLS[4].reach;
    return !!canThrow(this,a,opponent) && !canThrow(opponent,b,this);
  }

  /**
   * 释放技能。返回 true 表示招式已起手(不保证命中)。
   * 快捷栏回位由 Match 独立处理，出招失败也应回位。
   */
  useSkill(slot: SkillSlot, superTier: SuperTier = 1): boolean {
    if (!this.isValid || this.hp <= 0 || this.isDown || this.performing) return false;
    if (this.isBusy) return false;
    if (slot === 5 && this.leafCooldownRemaining > 0) return false;
    // 三档由 7 / W+7 / S+7 选择；释放前检查并支付对应整数气量，不能自动降档。
    if (slot === 6) {
      if (![1, 2, 3].includes(superTier)) return false;
      if (this.meter < superTier) return false;
    }
    if (slot === 4 && !this.isGrounded()) slot = 3;
    const def = SKILLS[slot];
    if (!def) return false;
    if (def.groundOnly && !this.isGrounded()) return false;

    // Pressing attack leaves guard, including crouch + projectile in the same tick.
    clearQueuedClip(this.key());
    if (slot >= 4) resetChain(this.entity);
    const clipId = this.resolveSkillClip(slot, superTier);
    if (!clipId) return false;

    // 分段位移动作(发波空中/蹲下变体):把整段动作的时钟一次算清楚
    const special = slot === 5 ? this.buildLeafSpecial() : undefined;

    // 到这里才算"释放被接受":消费掉大招的气(早于这里扣气会白丢一整条气)。
    const consumedSuperTier = slot === 6 ? this.lastSuperTier : undefined;
    if (consumedSuperTier !== undefined) this.consumeSuperMeter(consumedSuperTier);

    const totalTicks = special
      ? Math.max(3, special.stages.reduce((sum, s) => sum + s.ticks, 0))
      : Math.max(3, clipGameTicks(clipId));
    const startTick = currentTick();

    // active 窗口:分段动作自带;否则优先用逐招真帧数据(作者 60tick/秒 → 折算游戏 tick),
    // 并按 ACTIVE_WINDOW_MIN_TICKS 放宽 —— 20tps 下真帧 active 常常只有 1 个游戏 tick,
    // 1 tick 的窗口在手感上等于"打不中"。
    const frames =
      special || !USE_REAL_FRAME_DATA ? undefined : attackFrames(clipId);
    let activeFrom: number;
    let activeTo: number;
    if (special) {
      activeFrom = special.activeFrom;
      activeTo = special.activeTo;
    } else if (frames) {
      activeFrom = frames.activeGameTicks[0];
      activeTo =
        Math.max(frames.activeGameTicks[1], activeFrom + ACTIVE_WINDOW_MIN_TICKS) +
        ACTIVE_WINDOW_BONUS_TICKS;
    } else {
      activeFrom = Math.floor(totalTicks * def.activeStart);
      activeTo = Math.max(activeFrom + 1, Math.ceil(totalTicks * def.activeEnd));
    }
    if (slot === 4) { activeFrom = 7; activeTo = 9; }
    if (clipId === "super_1") { activeFrom = 22 / 3; activeTo = 9; }
    if (clipId === "super_2") { activeFrom = 12; activeTo = 13; }
    // 夹在招式时长内,且至少 1 tick 宽
    activeFrom = Math.max(0, Math.min(activeFrom, totalTicks - 1));
    activeTo = Math.max(activeFrom + 1, Math.min(activeTo, totalTicks));

    this.activeMove = {
      slot,
      clipId,
      hitLevel: CHUNYE_HIT_LEVELS[clipId] ?? "mid",
      startTick,
      acceptedTick: startTick,
      totalTicks,
      activeFrom,
      activeTo,
      resolved: false,
      ...(special ? { special } : {}),
    };
    this.state = "attack";
    if (slot === 5) this.leafCooldownUntilTick = startTick + LEAF_COOLDOWN_TICKS;
    this.busyUntilTick = startTick + totalTicks;
    this.isCrouchingFlag = false;
    playClip(this.entity, clipId, { force: true });
    return true;
  }

  /**
   * 招式动画解析:
     *   大招(slot 6)→ 按输入指定档位选 super_1 / super_2 / super_3_start,
     *                 并把档位记进 lastSuperTier(对应扣气见 consumeSuperMeter);
   *   轻/中/重(1/2/3)→ 按站姿拼前缀:attack_stand_light / attack_crouch_light / attack_air_light;
   *   投技(4)→ 地面 throw_cast、空中 attack_air_heavy 兜底;
   *   发波(5)→ special_leaf_burst,不消耗气。
   * 三段连锁见函数体末段:同一攻击键在 CHAIN_WINDOW_TICKS 内再按 → 换 _2 / _3 后缀。
   */
  private resolveSkillClip(slot: SkillSlot, superTier: SuperTier): string | undefined {
    const def = SKILLS[slot];
    if (!def) return undefined;

    if (slot === 6) {
      const tier = superTier;
      // 对外暴露"这一发用的哪一档":Match 需要它决定时停 / 三气分段演出。
      // 只在解析阶段赋值,真正的扣气推迟到"释放被接受"之后。
      this.lastSuperTier = tier;
      const entry =
        SUPER_CLIP_BY_METER.find((item) => item.meter === tier) ??
        SUPER_CLIP_BY_METER[0];
      return entry?.clip;
    }
    if (slot === 4) {
      return this.stance === "air" ? "attack_air_heavy" : "throw_cast";
    }
    if (slot === 5) {
      // 站姿决定发波变体:站 = 普通发波;空 = 叶片俯冲;蹲 = 上挑本体
      if (this.stance === "air") return "leaf_dive_start";
      if (this.stance === "crouch") return "leaf_rise_start";
      return "special_leaf_burst";
    }

    // clipBase 形如 "attack_stand_light" → 取 "light" 再拼当前站姿前缀
    const suffix = def.clipBase.replace(/^attack_(stand|crouch|air)_/, "");
    const base = `${ATTACK_PREFIX[this.stance]}${suffix}`;
    // 三段连打:同一攻击键在 CHAIN_WINDOW_TICKS 内再按 → 接 _2 / _3
    const segment = advanceChain(this.entity, slot, currentTick(), this.stance);
    const chained = segment > 0 ? `${base}_${segment + 1}` : base;
    return hasClip(chained) ? chained : base;
  }

  /**
   * 消费所选档位的整数气量，保留其余气(大招释放被接受时调用)
   */
  private consumeSuperMeter(tier: SuperTier): void {
    this.meter = Math.max(0, this.meter - tier);
  }

  /**
   * 标记"脚本编排的演出"开始/结束。结束时把输入锁收到当前 tick(立刻可行动),
   * 由 Match 的时间线在收尾时调用。
   *
   * 为什么需要它:三气分段用 forceClip 播的是自由控制的段,
   * Fighter 必须在演出期间**停止自动回 idle**,否则段与段之间会被 idle_stand 顶掉。
   */
  setPerforming(active: boolean, preserveRecovery = false): void {
    this.performing = active;
    if (!active) {
      this.cinematicPose=undefined;
      if (!preserveRecovery) this.busyUntilTick = Math.min(this.busyUntilTick, currentTick());
    }
  }

  /**
   * 起手一段"脚本编排的演出":作废当前招式的命中判定、锁输入到 endTick、
   * 进入 performing(不自动回 idle、不结算命中)。
   * 用于 Match 把 useSkill(6) 起手的大招**移交给分段时间线**。
   */
  beginPerformance(endTick: number): void {
    this.activeMove = undefined;
    clearQueuedClip(this.key());
    this.knockback = this.velocityY = 0;
    this.busyUntilTick = Math.max(this.busyUntilTick, endTick);
    this.performing = true;
    this.state = "attack";
  }

  /**
   * 把输入锁定延长到指定 tick(**只延后不提前**)。
   * 用途:Match 的时停 / 三气分段演出 / KO 阶段需要"外部"控制硬直长度,
   * 而又不想改 useSkill 的签名。
   */
  lockInputUntil(tick: number): void {
    this.busyUntilTick = Math.max(this.busyUntilTick, tick);
  }

  /**
   * 强制播放一段演出动画,并把输入锁到该段播完(+ extraTicks)。
   * 返回锁定到的 tick,方便调用方直接安排下一段的起点。
   *
   * 与 useSkill 的区别:不建 activeMove(演出段不结算命中)、不检查 isBusy
   * (分段演出必须能覆盖上一段的收尾)。仅限 Match 编排大招/演出时调用。
   */
  forceClip(clipId: string, extraTicks = 0): number {
    const endTick =
      currentTick() + clipGameTicks(clipId) + Math.max(0, extraTicks);
    this.state = "attack";
    this.activeMove = undefined;
    clearQueuedClip(this.key());
    this.knockback = this.velocityY = 0;
    this.busyUntilTick = Math.max(this.busyUntilTick, endTick);
    this.isCrouchingFlag = false;
    // 演出段必须独占画面:清掉残留的"过渡段衔接",否则它会在下一 tick
    // 被 flushQueuedClip 顶掉正在播的演出段。
    clearQueuedClip(this.key());
    playClip(this.entity, clipId, { force: true });
    return endTick;
  }

  /** 招式推进:跑 active 窗口,返回命中信息 */
  private tickMove(
    now: number,
    opponent: Fighter | undefined,
  ): HitInfo | undefined {
    const move = this.activeMove;
    if (!move) return undefined;

    // 两种位移技能实际相遇时，后发者可在 2 tick 后提前完成起手。
    // 否则旧俯冲会在新升龙 0.4 秒起手内穿过人物，虽不扣血却也无法反击。
    if (opponent && this.leafClashWith(opponent) && move.acceptedTick>opponent.activeMove!.acceptedTick &&
      now-move.startTick>=2 && now-move.startTick<move.activeFrom &&
      this.distanceTo(opponent)<=LEAF_RISE_HIT_REACH && Math.abs(this.feetY-opponent.feetY)<=LEAF_COUNTER_VERTICAL_TOLERANCE &&
      (opponent.axisPosition-this.axisPosition)*this.facing>=-0.05) {
      const skip=move.activeFrom-(now-move.startTick);
      move.startTick-=skip;
      this.busyUntilTick-=skip;
    }
    const elapsed = now - move.startTick;
    if (move.clipId === "super_1" && elapsed >= 4) {
      if (!move.pearlStep) {
        move.pearlStep = { origin:this.localAxis,
          target:this.super1StepDestination(opponent),
          from:this.handPoint("mid") };
      }
      const u = Math.max(0, Math.min(1, (elapsed*3-14)/5));
      this.localAxis = move.pearlStep.origin+(move.pearlStep.target-move.pearlStep.origin)*u;
      this.commitPosition();
    }
    if (move.clipId === "super_1" && opponent) {
      const authorTime = elapsed * 3;
      if (authorTime >= SUPER_1_GUARD_AUTHOR_START && authorTime < SUPER_1_GUARD_AUTHOR_END && opponent.isGuarding) {
        move.super1GuardSeen = true;
      }
    }
    if (move.special?.kind === "dive" && elapsed >= move.totalTicks && !this.isGrounded()) {
      move.totalTicks += clipGameTicks("leaf_dive_loop");
      move.activeTo=move.totalTicks;
      this.busyUntilTick=move.startTick+move.totalTicks;
    }
    if (elapsed >= move.totalTicks) {
      this.activeMove = undefined;
      // 打到人了吗?没打到就是"挥空" ⇒ 走失败收招(投技挥空 / 大招挥空)
      const whiff = move.resolved ? undefined : this.whiffClipFor(move.slot);
      if (whiff) this.playRecovery(whiff, now);
      else this.enterIdle();
      return undefined;
    }

    // ---- 分段位移动作:推进阶段 + 施加位移(真实位移由脚本给,动画只负责姿势) ----
    if (move.special && this.tickSpecialMotion(move, elapsed, now)) {
      return undefined;
    }

    if (move.clipId === "special_leaf_burst") { move.resolved=true; return undefined; }
    if (move.resolved) return undefined;
    if (elapsed < move.activeFrom) return undefined;
    if (elapsed >= move.activeTo) {
      // ★判定窗口已过且没打到:投技/大招**立刻**改走失败收招
      //   (throw_whiff / super_N_whiff),而不是把整段动画放完再收 ——
      //   否则"投空"要等 1.7 秒的投技动画走完,手感是卡住的。
      const whiff = this.whiffClipFor(move.slot);
      if (whiff) this.playRecovery(whiff, now);
      return undefined;
    }

    const def = SKILLS[move.slot];
    if (!def || !opponent || !opponent.isValid) return undefined;
    // 对手倒地且免疫期间:这一击直接落空(招式不结算,等他起身)
    if (opponent.isDown && KNOCKDOWN_INVULNERABLE) return undefined;

    if ((opponent.axisPosition - this.axisPosition) * this.facing < -0.05) return undefined;
    // 瞬移必须真正写入实体位置，随后只在落点附近结算近身拳击。
    if (move.clipId === "super_1" && (!move.pearlStep || Math.abs(this.axisPosition-move.pearlStep.target)>0.08)) return undefined;
    const specialReach = move.clipId === "super_1" ? SUPER_1_HIT_REACH : move.special?.kind === "rise"
      ? LEAF_RISE_HIT_REACH
      : move.special
        ? 2.4
        : def.reach;
    if (this.distanceTo(opponent) > specialReach) return undefined;
    // 升龙只在接近目标高度时有效；俯冲继续使用较宽的空中窗口。
    const verticalTolerance = this.leafClashWith(opponent) ? LEAF_COUNTER_VERTICAL_TOLERANCE : move.special?.kind === "rise"
      ? LEAF_RISE_VERTICAL_TOLERANCE
      : move.special
        ? HIT_VERTICAL_TOLERANCE + SPECIAL_VERTICAL_TOLERANCE_BONUS
        : HIT_VERTICAL_TOLERANCE;
    if (Math.abs(this.feetY - opponent.feetY) > verticalTolerance) {
      return undefined;
    }
    if (def.groundOnly && !opponent.isGrounded()) return undefined;

    if (this.leafClashWith(opponent)) {
      const other=opponent.activeMove!;
      if (move.acceptedTick < other.acceptedTick) {
        // 后发起手仅防住这一个旧升龙/俯冲。普通攻击、投技、独立波仍能打断它。
        const otherAge=now-other.startTick;
        if (otherAge>=other.activeFrom || otherAge<=LEAF_COUNTER_STARTUP_MAX_TICKS) return undefined;
      } else if (move.acceptedTick===other.acceptedTick) {
        // 同 tick 没有后发者：双方抵消，避免永远 1P 获胜。
        this.playRecovery(move.special!.kind==="rise" ? "leaf_rise_end" : "leaf_dive_hit",now);
        opponent.playRecovery(other.special!.kind==="rise" ? "leaf_rise_end" : "leaf_dive_hit",now);
        return undefined;
      }
    }

    // ---- 拆投:投技最初判定窗口内,对方也在出投 ⇒ 双方各播 0.3s 拆投动画后分开 ----
    if (move.slot === 4 && opponent.isThrowingWithin(THROW_TECH_WINDOW_TICKS)) {
      move.resolved = true;
      this.resolveThrowTech(opponent, now);
      return undefined;
    }

    move.resolved = true;
    const flavor = this.hitFlavorFor(move);
    const info = opponent.receiveHit(this, move.slot, flavor);

    // ---- 命中定帧:双方一起顿住(源资产:所有命中都有,越重越长) ----
    const stop = (move.clipId === "super_2" || move.slot === 4) && !info.blocked ? 0 : info.blocked
      ? HITSTOP_BLOCKED_TICKS
      : this.hitstopTicksFor(move.slot);
    if (stop > 0) {
      this.applyHitstop(stop);
      opponent.applyHitstop(stop);
      info.hitstop = stop;
    }

    // 分段动作命中 → 切收势并停止位移(俯冲 hit)
    if (move.special?.hitClip) {
      this.playRecovery(move.special.hitClip, now);
    }
    // 大招被防御 = "敌人在捕获前防御成功" ⇒ 施放者改走失败收招,不出后续压击
    if (info.blocked && move.slot === 6) {
      const whiff = this.whiffClipFor(6);
      if (whiff) this.playRecovery(whiff, now);
    }
    return info;
  }

  /**
   * 分段位移动作每 tick 推进:按"共享动作时钟"选当前阶段、施加该阶段的位移。
   *
   * @returns true = 本 tick 已经收势(俯冲真实落地),调用方直接返回
   */
  private tickSpecialMotion(
    move: ActiveMove,
    elapsed: number,
    now: number,
  ): boolean {
    const special = move.special;
    if (!special) return false;
    if (special.kind === "dive" && this.isGrounded()) {
      this.playRecovery(special.landClip ?? "leaf_dive_land", now);
      return true;
    }

    // 找到当前阶段(累计 tick)
    let acc = 0;
    let stage = special.stages[0];
    for (const candidate of special.stages) {
      stage = candidate;
      acc += candidate.ticks;
      if (elapsed < acc) break;
    }
    if (!stage) return false;

    if (special.kind === "dive") {
      // 俯冲:朝对手方向前进 + 稳定下坠;真实落地 → land 收势
      if (elapsed < special.activeFrom) return false;
      this.localAxis += this.facing * LEAF_DIVE_FORWARD_SPEED;
      this.clampToArena();
      this.velocityY = Math.min(this.velocityY, -LEAF_DIVE_DOWN_SPEED);
      if (elapsed >= special.activeFrom && this.isGrounded()) {
        this.playRecovery(special.landClip ?? "leaf_dive_land", now);
        return true;
      }
    } else if (elapsed >= special.activeFrom && elapsed <= special.activeTo) {
      // 上挑:本体跟着叶流向上(仅 loop 段);序列结束后交给物理自然下落
      this.velocityY = LEAF_RISE_UP_SPEED;
      this.localAxis += this.facing * LEAF_RISE_FORWARD_SPEED;
      this.clampToArena();
    }

    // 阶段切换时才会真的重播(playClip 对同一段幂等)
    playClip(this.entity, stage.clip);
    return false;
  }

  /** 组装发波的分段位移动作(空中俯冲 / 蹲下上挑)。段长全部来自 clipGameTicks。 */
  private buildLeafSpecial(): MoveSpecial | undefined {
    if (this.stance === "air") {
      const start: MoveStage = {
        clip: "leaf_dive_start",
        ticks: clipGameTicks("leaf_dive_start"),
      };
      const loop: MoveStage = {
        clip: "leaf_dive_loop",
        ticks: clipGameTicks("leaf_dive_loop"),
      };
      const stages: MoveStage[] = [start];
      stages.push(loop);
      return {
        kind: "dive",
        stages,
        hitClip: "leaf_dive_hit",
        landClip: "leaf_dive_land",
        activeFrom: start.ticks,
        activeTo: start.ticks + loop.ticks,
      };
    }
    if (this.stance === "crouch") {
      const start: MoveStage = {
        clip: "leaf_rise_start",
        ticks: clipGameTicks("leaf_rise_start"),
      };
      const loop: MoveStage = {
        clip: "leaf_rise_loop",
        ticks: clipGameTicks("leaf_rise_loop"),
      };
      const end: MoveStage = {
        clip: "leaf_rise_end",
        ticks: Math.max(LEAF_RISE_RECOVERY_TICKS, clipGameTicks("leaf_rise_end")),
      };
      const stages: MoveStage[] = [start];
      for (let i = 0; i < LEAF_RISE_LOOP_MAX; i++) stages.push(loop);
      stages.push(end);
      return {
        kind: "rise",
        stages,
        activeFrom: start.ticks,
        activeTo: start.ticks + loop.ticks * LEAF_RISE_LOOP_MAX,
      };
    }
    return undefined;
  }

  /** 挥空分支:投技挥空 / 大招挥空(按气量档位) */
  private whiffClipFor(slot: SkillSlot): string | undefined {
    if (slot === 4) return THROW_WHIFF_CLIP;
    if (slot === 6) {
      const tier = this.lastSuperTier;
      return tier === undefined ? undefined : SUPER_WHIFF_CLIP[tier];
    }
    return undefined;
  }

  /**
   * 本次命中应定帧多少 tick。
   * 大招按气量分档(源资产 super_metadata.hitstop.hitPresentationTicks:
   * 一气 4 / 二气 8 / 三气首记 7),其余招式见 HITSTOP_TICKS。
   */
  private hitstopTicksFor(slot: SkillSlot): number {
    if (slot === 6) {
      const tier = this.lastSuperTier;
      return (tier !== undefined ? SUPER_HITSTOP_TICKS[tier] : undefined) ?? 4;
    }
    return HITSTOP_TICKS[slot] ?? 2;
  }

  /**
   * 收招:停掉位移与判定,播该段并锁到它播完。
   * 用途:挥空收招(throw_whiff / super_N_whiff)、俯冲的命中/落地收势。
   */
  private playRecovery(clip: string, now: number): void {
    const previousElapsed = this.activeMove ? now - this.activeMove.startTick : 0;
    const offset = clip === "throw_whiff" || clip === "super_2_whiff" ? Math.min(previousElapsed, clipGameTicks(clip) - 1) : 0;
    this.activeMove = undefined;
    clearQueuedClip(this.key());
    setBodyOpacity(this.entity, 1);
    this.busyUntilTick = now + clipGameTicks(clip) - offset;
    this.state = "attack";
    this.knockback = 0;
    if (clip === "leaf_dive_land") this.velocityY = 0;
    if (clip === "leaf_dive_hit") this.velocityY = 0;
    playClip(this.entity, clip, { force: true, startSeconds: offset / 20 });
  }

  /**
   * 命中"风味":由施放者在判定成功那一刻决定受击者播什么。
   *   - 一/二气大招命中 ⇒ 受击方播 super_N_victim;
   *   - 蹲下发波(上挑)命中 ⇒ 把对手挑飞(leaf_launch_* 由受击方自己串)。
   * 三气的各段受击方由 Match 的时间线配对(pairSuper3Victim)。
   */
  private hitFlavorFor(move: ActiveMove): HitFlavor | undefined {
    if (move.slot === 6) {
      const tier = this.lastSuperTier;
      const clip = tier === undefined ? undefined : SUPER_VICTIM_CLIP[tier];
      return {
        hitLevel: move.hitLevel,
        victimClip: clip,
        ...(move.clipId === "super_1" ? { super1GuardOnlyDuringTravel: move.super1GuardSeen === true } : {}),
      };
    }
    if (move.slot === 5 && move.special) {
      return { hitLevel: move.hitLevel, launch: move.special.kind === "rise", leafKind: move.special.kind };
    }
    return { hitLevel: move.hitLevel };
  }

  /** 拆投(主动侧):自己播 throw_tech_cast,对方播 throw_tech_victim,立即分开 */
  resolveThrowTech(opponent: Fighter, now: number): void {
    this.throwTechPartner = opponent;
    const selfAxis = this.axisPosition;
    this.beginTechReaction(THROW_TECH_CAST_CLIP, now, opponent.axisPosition);
    opponent.beginTechReaction(THROW_TECH_VICTIM_CLIP, now, selfAxis);
  }

  /** 取出一次拆投事件；避免每 tick 重复播报。 */
  consumeThrowTechPartner(): Fighter | undefined {
    const partner = this.throwTechPartner;
    this.throwTechPartner = undefined;
    return partner;
  }

  /** 拆投(被动侧):中断自己的投技起手,播受身动画并被推开一点 */
  private beginTechReaction(clip: string, now: number, otherAxis: number): void {
    this.damageCombo.reset();
    this.activeMove = undefined;
    resetChain(this.entity);
    clearQueuedClip(this.key());
    this.performing=false;
    this.downPlan=undefined;
    this.busyUntilTick=now+clipGameTicks(clip);
    this.state = "attack";
    this.isCrouchingFlag = false;
    const away = Math.sign(this.axisPosition - otherAxis) || 1;
    this.knockback = away * THROW_TECH_SEPARATE_SPEED;
    playClip(this.entity, clip, { force: true });
  }

  /** 是否正在"投技起手的最初窗口内"(拆投判定用) */
  isThrowingWithin(window: number): boolean {
    const move = this.activeMove;
    if (!move || move.slot !== 4) return false;
    return currentTick() - move.startTick < move.activeFrom + window;
  }

  /**
   * 命中定帧(hitstop):双方一起定住若干 tick。
   *
   * 规格(源资产 ownership.presentation):**每次命中都有很短的定帧**,越重越长;
   * affected = both_actors_and_pearl_camera_clock ⇒ 攻守双方 + 相机时钟一起停。
   * 没有"暂停动画"的接口,所以这里停的是**位移/击退/垂直物理**;动画照常播 ——
   * 观感上就是"打到的那一下顿住了"。
   */
  applyHitstop(ticks: number): void {
    if (ticks <= 0) return;
    const now = currentTick();
    this.hitstopUntilTick = Math.max(this.hitstopUntilTick, now + ticks);
    // Preserve velocity: a frozen launch resumes with its original momentum.
  }

  /** 是否处于定帧中 */
  get inHitstop(): boolean {
    return currentTick() < this.hitstopUntilTick;
  }

  /** 当前招式的 active 窗口是否正在开着(HUD 调试预留) */
  get activeWindowOpen(): boolean {
    const move = this.activeMove;
    if (!move) return false;
    const elapsed = currentTick() - move.startTick;
    return (
      !move.resolved && elapsed >= move.activeFrom && elapsed <= move.activeTo
    );
  }

  /**
   * 被命中:结算伤害 / 防御 / 硬直 / 击退。
   * @param flavor 施放者在判定成功那一刻决定的"风味"(配对受击动画 / 上挑击飞)。
   *   `*_victim` **不绑定玩家按键**,只由服务端确认命中后自动触发 —— 规格明确要求。
   */
  receiveHit(attacker: Fighter, slot: SkillSlot, flavor?: HitFlavor): HitInfo {
    const def = SKILLS[slot];
    const now = currentTick();
    const away = Math.sign(this.axisPosition - attacker.axisPosition) || 1;

    // ---- 倒地免疫(兜底:正常路径已在 tickMove 里跳过倒地目标) ----
    if (this.state === "down" && KNOCKDOWN_INVULNERABLE) {
      return {
        attacker,
        victim: this,
        skill: slot,
        damage: 0,
        blocked: true,
        knockdown: false,
        hitstop: 0,
      };
    }

    // 三气刚起手时的短暂无敌：攻击可以正常结束自己的判定，但不会打断施放者。
    if (this.isInvulnerable) {
      return {
        attacker,
        victim: this,
        skill: slot,
        damage: 0,
        blocked: true,
        knockdown: false,
        hitstop: 0,
      };
    }

    // ---- 防御中:只吃 chip(默认 0 伤害),防御方获得少量气,进 guard_hit ----
    const hitLevel = flavor?.hitLevel ?? (slot === 4 ? "throw" : "mid");
    const correctGuard = hitLevel === "mid" ||
      (hitLevel === "low" && this.stance === "crouch") ||
      (hitLevel === "overhead" && this.stance === "stand");
    const super1Restricted = flavor?.super1GuardOnlyDuringTravel !== undefined;
    const guardEligible = !super1Restricted || flavor?.super1GuardOnlyDuringTravel === true;
    if (this.state === "guard" && slot !== 4 && correctGuard && guardEligible) {
      this.damageCombo.reset();
      clearQueuedClip(this.key());
      const chip = Math.min(this.hp, def?.guardChipDamage ?? 0);
      this.hp = Math.max(0, this.hp - chip);
      this.meter = Math.min(MAX_METER, this.meter + METER_ON_TAKE_HIT * 0.5);
      this.busyUntilTick = now + GUARD_HITSTUN_TICKS;
      playClip(this.entity, GUARD_HIT_CLIPS[this.stance], { force: true });
      // 防御成功**不**累加连击(否则纯防守也会被"打倒地")
      return {
        attacker,
        victim: this,
        skill: slot,
        damage: chip,
        blocked: true,
        knockdown: false,
        hitstop: 0,
      };
    }

    // ---- 普通命中 ----
    const tier = attacker.lastSuperTier ?? 1;
    const baseDamage = slot === 5
      ? flavor?.leafKind === "rise" || flavor?.launch ? CHUNYE_DAMAGE.rise
        : flavor?.leafKind === "dive" ? CHUNYE_DAMAGE.dive : def.damage
      : slot === 6 && tier === 2 ? CHUNYE_DAMAGE.super2 : def.damage;
    const scaledDamage = this.confirmDamage(attacker, slot, [baseDamage], slot === 6 ? tier : undefined)[0]!;
    const capture = slot === 4 ? "throw" : slot === 6 && tier === 2 ? "super2" : undefined;
    // 被打断:连段必须断掉,否则受击后一按就直接跳 _2 / _3。
    clearQueuedClip(this.key());
    this.performing = false;
    this.dashUntilTick = 0;
    this.endDashPearl();
    setBodyOpacity(this.entity, 1);
    resetChain(this.entity);
    const damage = capture ? 0 : Math.min(this.hp, scaledDamage);
    this.hp = Math.max(0, this.hp - damage);
    if (!capture) this.gainHitMeter(damage, slot);
    this.knockback = away * (flavor?.leafKind === "dive" ? 0.08 : HIT_KNOCKBACK_SPEED);
    this.activeMove = undefined;
    this.state = "hit";
    this.isCrouchingFlag = false;
    // 受击动画优先级:大招配对动画(super_N_victim)
    //   > 重击(3/4/6)命中站立目标用 hit_stand_heavy
    //   > 按站姿的 hit_stand/crouch/air
    const victimClip = flavor?.victimClip;
    const heavy = slot === 3 || slot === 4 || slot === 6;
    const reaction =
      victimClip ??
      (heavy && this.stance === "stand" && hasClip("hit_stand_heavy")
        ? "hit_stand_heavy"
        : HIT_CLIPS[this.stance]);
    // 硬直至少要盖住受击动画本身,否则配对动画会被腰斩
    this.busyUntilTick = flavor?.leafKind === "dive" ? now + LEAF_DIVE_HITSTUN_TICKS : Math.max(
      now + (def?.hitstunTicks ?? 10),
      now + clipGameTicks(reaction),
    );
    playClip(this.entity, reaction, { force: true });

    // ---- 连续挨打 → 打倒地(规格:一方连续打出一定攻击要把对手打倒地) ----
    if (now > this.comboExpireTick) this.comboHits = 0;
    this.comboHits += 1;
    this.comboExpireTick = now + COMBO_RESET_TICKS;

    let knockdown = false;
    if (flavor?.launch) {
      // 被上挑击飞:hit → 空中循环 → 真实落地 land → 倒地保持 → 起身
      this.beginDown(away, {
        enter: "leaf_launch_hit",
        idle: "idle_down",
        airLoop: "leaf_launch_air",
        landClip: "leaf_launch_land",
        totalTicks: LEAF_LAUNCH_TICKS,
        pop: LEAF_LAUNCH_POP,
        knockback: LEAF_LAUNCH_KNOCKBACK,
      });
      knockdown = true;
      this.comboHits = 0;
    } else if (victimClip) {
      // 一/二气命中都是完整的成功收束：配对受击段结束后进入倒地流程，
      // 不让受击者播完 *_victim 又立即站回待机。
      if (victimClip === "super_1_victim" || victimClip === "super_2_victim") {
        this.beginDown(away, {
          enter: victimClip,
          idle: "idle_down",
          totalTicks: clipGameTicks(victimClip) + 8 + KNOCKDOWN_GETUP_TICKS,
          pop: 0,
          knockback: 0,
        });
        knockdown = true;
      }
    } else {
      const byThrow = slot === 4 && THROW_KNOCKDOWN;
      const byCombo = this.comboHits >= KNOCKDOWN_COMBO_HITS;
      if (byThrow || byCombo) {
        // 被投技摔:用配对的 throw_victim;被打倒:用 knockdown
        this.beginDown(away, byThrow ? THROW_DOWN_PLAN : KNOCKDOWN_PLAN);
        knockdown = true;
        this.comboHits = 0;
      }
    }

    attacker.meter = Math.min(MAX_METER, attacker.meter + (def?.meterOnHit ?? 0));
    return {
      attacker,
      victim: this,
      skill: slot,
      damage,
      capture,
      deferredDamage: capture ? scaledDamage : undefined,
      blocked: false,
      knockdown,
      hitstop: 0,
    };
  }

  /**
   * 进入倒地状态。
   *
   * 规格(2026-09-25):① 投技命中要把对手**摔倒在地**;② 一方连续打出若干次攻击
   * 要把对手**打倒地**;③ 蹲下发波(上挑)命中要把对手**挑飞**后落地再倒。
   * 三者共用这条路径,由 DownPlan 描述动作时钟。
   */
  private beginDown(away: number, plan: DownPlan): void {
    const now = currentTick();
    this.state = "down";
    this.performing = false;
    this.activeMove = undefined;
    this.isCrouchingFlag = false;
    resetChain(this.entity);
    clearQueuedClip(this.key());
    this.downPlan = plan;
    this.downWasAirborne = !this.isGrounded();
    this.downLandPlayed = false;
    this.busyUntilTick = Math.max(this.busyUntilTick, now + plan.totalTicks);
    this.downUntilTick = now + plan.totalTicks;
    const offset = plan.enter === "throw_victim" ? THROW_VICTIM_START_OFFSET_TICKS : 0;
    this.downIdleFromTick = now + clipGameTicks(plan.enter) - offset;
    if (offset) { this.downUntilTick = now + 45; this.busyUntilTick = this.downUntilTick; }
    this.knockback = away * plan.knockback;
    playClip(this.entity, plan.enter, { force: true, startSeconds: offset / 20 });
    // 站在地上被击倒 → 弹起一点再摔下去(有"摔"的观感);空中被打倒就顺势落地
    if (this.isGrounded()) this.velocityY = plan.pop;
  }

  /**
   * 倒地推进(按真实状态而不是"动画播完"):
   *   进入动画 →(真实在空中)空中循环 →(真实落地)落地收势 → 躺地循环 → getup → 回可行动
   */
  private tickDown(now: number): void {
    const plan = this.downPlan;
    // downUntilTick <= 0 / 没有方案 = 不是击倒流程(例如 KO 的 playDown 自己接管)
    if (this.downUntilTick <= 0 || !plan) return;
    const permanent = this.downUntilTick === Number.MAX_SAFE_INTEGER;
    if (!this.isGrounded() || this.velocityY > 0) {
      this.downWasAirborne = true;
      if (!permanent) {
        this.downUntilTick = Math.max(this.downUntilTick, now + (plan.landClip ? clipGameTicks(plan.landClip) : 0) + 8 + KNOCKDOWN_GETUP_TICKS);
        this.busyUntilTick = this.downUntilTick;
      }
      if (plan.airLoop && now >= this.downIdleFromTick) playClip(this.entity, plan.airLoop);
      return;
    }
    if (plan.landClip && this.downWasAirborne && !this.downLandPlayed) {
      this.downLandPlayed = true;
      playClip(this.entity, plan.landClip, {force:true});
      this.downIdleFromTick = now + clipGameTicks(plan.landClip);
      if (!permanent) this.downUntilTick = this.downIdleFromTick + 8 + KNOCKDOWN_GETUP_TICKS;
      this.busyUntilTick = this.downUntilTick;
      return;
    }
    if (!permanent && now >= this.downUntilTick) {
      this.downPlan = undefined;
      this.busyUntilTick = now;
      this.isCrouchingFlag = false;
      this.stance = "stand";
      this.state = "idle";
      // 起身保护覆盖输入缓冲与快速反击起手；不保证任意慢招都能反打。
      this.damageCombo.reset();
      this.grantInvulnerability(GETUP_INVULNERABILITY_TICKS);
      playClip(this.entity, "idle_stand", {force:true});
    } else if (!permanent && now >= this.downUntilTick - KNOCKDOWN_GETUP_TICKS) {
      playClip(this.entity, "getup");
    } else if (now >= this.downIdleFromTick) playClip(this.entity, plan.idle);
  }

  /**
   * **演出阶段**每 tick 调用(KO / 回合结束 / 整场结束)。
   *
   * 为什么需要:那三个阶段不跑 `tick()`(不跑输入/物理/命中),但**倒地与胜利的
   * 动画衔接是靠 tick() 里的 flushQueuedClip / tickDown 推的** —— 不推的话
   * 败者会永远停在 `knockdown` 的最后一帧(非循环段播完就定格),
   * 实机表现就是"KO 之后没血的没有持续倒地"。
   *
   * 推进倒地、胜者落地等待与排队衔接；不再处理战斗输入或命中。
   */
  tickPresentation(pausePhysics = false): void {
    if (!this.isValid || this.offstage) return;
    flushQueuedClip(this.entity, this.key());
    if (this.inHitstop) return;
    const victory = this.pendingVictory;
    if (victory) {
      const now = currentTick();
      if (victory.landUntilTick === undefined) {
        this.tickPhysics(now, undefined);
        if (!this.isGrounded()) return;
        this.y = ARENA_FLOOR_Y;
        this.velocityY = 0;
        this.stance = "stand";
        this.commitPosition();
        victory.landUntilTick = now + clipGameTicks("jump_land");
        playClip(this.entity, "jump_land", { force: true });
      } else if (now >= victory.landUntilTick) {
        this.pendingVictory = undefined;
        this.startVictoryClip(victory.matchWinner);
      }
      return;
    }
    if (this.state === "down") {
      if (!pausePhysics) this.tickPhysics(currentTick(), undefined);
      this.tickDown(currentTick());
    }
  }

  /** 血量归零 → 倒地表现(KO;由 Match 接管,不会自动起身) */
  playDown(): void {
    this.pendingVictory = undefined;
    // 已经在"KO 倒地"里了(KO 阶段 → endRound → beginMatchEnd 会重复调用):
    // 保持在躺地循环即可,不要再播一遍摔倒 —— 否则败者会"重新摔一次"。
    if (
      this.state === "down" &&
      this.downUntilTick === Number.MAX_SAFE_INTEGER &&
      this.downPlan
    ) {
      return;
    }
    clearQueuedClip(this.key());
    this.dashUntilTick = 0;
    this.endDashPearl();
    setBodyOpacity(this.entity, 1);
    this.state = "down";
    this.performing = false;
    this.busyUntilTick = Number.MAX_SAFE_INTEGER;
    this.activeMove = undefined;
    // KO 的"倒地"不参与击倒→起身流程:tickDown 靠这些值判断,
    // 不设的话旧值会让 tickDown 立刻把 KO 败者"扶起来"。
    this.downPlan = {
      enter: "knockdown",
      idle: "idle_down",
      totalTicks: Number.MAX_SAFE_INTEGER,
      pop: 0,
      knockback: 0,
    };
    this.downUntilTick = Number.MAX_SAFE_INTEGER;
    this.downIdleFromTick = currentTick() + clipGameTicks("knockdown");
    this.downWasAirborne = false;
    this.downLandPlayed = false;
    this.knockback = 0;
    // "摔倒 → 躺地"由 DownPlan 的动作时钟驱动(tickDown 到点播 idle_down);
    // 不要在这里再 queueClip 一遍 —— 两个机制同时写同一段只会互相顶。
    playClip(this.entity, "knockdown", { force: true });
  }

  /** 回合 / 整场胜利表现 */
  playVictory(matchWinner: boolean): void {
    clearQueuedClip(this.key());
    this.endDashPearl();
    this.hitstopUntilTick = 0;
    setBodyOpacity(this.entity, 1);
    this.state = "victory";
    this.performing = false;
    this.busyUntilTick = Number.MAX_SAFE_INTEGER;
    this.activeMove = undefined;
    this.dashUntilTick = 0;
    this.pendingVictory = undefined;
    this.knockback = 0;
    this.isCrouchingFlag = false;
    this.cinematicPose = undefined;
    // Grounded winners have no further physics commits in the results phase.
    // Apply the canonical facing now, clearing the last cinematic yaw/depth.
    this.commitPosition();
    if (!this.isGrounded()) {
      this.pendingVictory = { matchWinner };
      this.stance = "air";
      this.velocityY = Math.min(0, this.velocityY);
      playClip(this.entity, "air_fall", { force: true });
      return;
    }
    this.velocityY = 0;
    this.stance = "stand";
    this.startVictoryClip(matchWinner);
  }

  private startVictoryClip(matchWinner: boolean): void {
    // 同样:胜利动画 → (播完) → 胜利待机。旧实现两行连播,胜利动画被 idle 顶掉,
    // 实机表现就是"赢了没有胜利动画"。
    if (matchWinner) {
      playClip(this.entity, "victory_match", { force: true });
      queueClip(
        this.key(),
        "victory_match_idle",
        clipGameTicks("victory_match"),
        true,
      );
    } else {
      playClip(this.entity, "victory_round", { force: true });
      queueClip(
        this.key(),
        "victory_round_idle",
        clipGameTicks("victory_round"),
        true,
      );
    }
  }

  /**
   * 回到可战斗状态(新回合开始 / intro 前调用)。
   * @param keepMeter 是否保留气量。规格(2026-09-25):**气每局累积**,只有整场开始
   *   (第 1 局)才清零 —— 所以 rounds 2+ 传 true。
   */
  resetForRound(localAxis: number, keepMeter = false): void {
    this.offstage = false;
    this.throwTechPartner = undefined;
    this.pendingVictory = undefined;
    resetChain(this.entity);
    this.cinematicPose=undefined;
    this.hp = MAX_HP;
    if (!keepMeter) this.meter = 0;
    this.state = "idle";
    this.stance = "stand";
    this.isCrouchingFlag = false;
    this.performing = false;
    this.lastSuperTier = undefined;
    this.busyUntilTick = 0;
    this.activeMove = undefined;
    this.knockback = 0;
    this.velocityY = 0;
    // 连击计数 / 倒地流程跨局清零
    this.comboHits = 0;
    this.comboExpireTick = 0;
    this.damageCombo.reset();
    this.downUntilTick = 0;
    this.downIdleFromTick = 0;
    this.downPlan = undefined;
    this.downWasAirborne = false;
    this.downLandPlayed = false;
    this.dashUntilTick = 0;
    this.hitstopUntilTick = 0;
    this.invulnerableUntilTick = 0;
    this.leafCooldownUntilTick = 0;
    this.endDashPearl();
    setBodyOpacity(this.entity, 1);
    this.facingValue = this.side === 0 ? 1 : -1;
    this.y = ARENA_FLOOR_Y;
    this.localAxis = localAxis;
    releaseClipHold(this.key());
    clearQueuedClip(this.key());
    this.commitPosition();
    playClip(this.entity, "idle_stand", { force: true });
  }

  /** 播开场动画 */
  playIntro(startTick: number): void {
    this.state = "idle";
    this.performing = false;
    this.busyUntilTick = startTick + clipGameTicks("intro");
    this.activeMove = undefined;
    clearQueuedClip(this.key());
    playClip(this.entity, "intro", { force: true });
    queueClip(this.key(), "idle_stand", clipGameTicks("intro"));
  }

  private resetDamageComboIfRecovered(): void {
    if (!this.performing && !this.isDown && !(this.state === "hit" && this.isBusy)) {
      this.damageCombo.reset();
    }
  }

  /** 只在命中/捕获确认时调用。多段演出整招锁定补正，不在每次扣血时再补正。 */
  confirmDamage(attacker: Fighter, skill: SkillSlot, baseHits: readonly number[], superTier?: SuperTier): number[] {
    this.resetDamageComboIfRecovered();
    const starter: ComboStarter = skill === 1 ? "light" : skill === 3 ? "heavy" : "normal";
    return this.damageCombo.confirm(attacker.player.id, starter, baseHits,
      superTier === undefined ? 0 : SUPER_MIN_DAMAGE_PERCENT[superTier]);
  }

  /** 接收已补正伤害；保留配对姿态，且不重复增加连击/应用补正。 */
  receiveCinematicHit(attacker: Fighter, damage: number, lethal: boolean, skill: SkillSlot = 6): HitInfo {
    const before=this.hp;
    // lethal 仅供击倒提示，不代表必杀；三气非终结段保留 1 HP 由 Match 处理。
    this.hp=Math.max(0,this.hp-damage);
    this.gainHitMeter(before-this.hp, skill);
    return {attacker,victim:this,skill,damage:before-this.hp,blocked:false,knockdown:lethal,hitstop:0};
  }

  private gainHitMeter(damage: number, skill: SkillSlot): void {
    if (damage<=0) return;
    this.meter=Math.min(MAX_METER,this.meter+(skill===6 ? damage*METER_PER_SUPER_DAMAGE : METER_ON_TAKE_HIT));
  }
  returnToPearl(axis: number): void {
    // Do not erase damage, hitstun or the incoming reaction when the first pearl returns.
    this.localAxis=axis; this.clampToArena(); this.commitPosition();
  }
  startSuper3Whiff(): void {
    this.forceClip("super_3_whiff");
    this.activeMove={slot:3,clipId:"super_3_whiff",hitLevel:"mid",startTick:currentTick(),acceptedTick:currentTick(),totalTicks:clipGameTicks("super_3_whiff"),activeFrom:4/3,activeTo:3,resolved:false};
  }

  /** Advance exactly once per server tick. All deadline owners pause together. */
  advancePresentation(frozen = false, rate = 1): void {
    if (this.offstage) { setBodyOpacity(this.entity, 0); return; }
    const move=this.activeMove;
    const accelerating=move && !move.resolved && (move.clipId==="super_1" || move.clipId==="super_2") && currentTick()-move.startTick<=move.activeTo;
    const delta = frozen || this.inHitstop ? 0 : rate*(accelerating ? SUPER_CAPTURE_RATE : 1);
    const delay = 1 - delta;
    if (delay > 0) {
      for (const key of ["busyUntilTick", "downUntilTick", "downIdleFromTick", "dashUntilTick", "dashPearlReleaseTick", "invulnerableUntilTick", "leafCooldownUntilTick"] as const) {
        if (this[key] > 0 && this[key] < Number.MAX_SAFE_INTEGER) this[key] += delay;
      }
      if (this.activeMove) this.activeMove.startTick += delay;
      delayQueuedClip(this.key(), delay);
    }
    if (delay < 0 && move) {
      move.startTick += delay;
      this.busyUntilTick += delay;
    }
    advanceClip(this.entity, delta);
    const id = currentClip(this.entity);
    const t = clipElapsed(this.entity) * 3;
    const windows: Record<string, number[][]> = {
      dash_forward:[[6,12]], dash_backward:[[8,14]], super_1:[[14,19]],
      leaf_rise_loop:[[0,6],[12,18]], leaf_dive_loop:[[0,6],[12,18]],
      super_3_finish:[[4,10]], super_3_low_finish:[[4,10]],
    };
    const duration = id ? clipGameTicks(id) * 3 : 1;
    const sample = id?.endsWith("_loop") ? t % duration : t;
    setBodyOpacity(this.entity, (windows[id ?? ""] ?? []).some(([a,b]) => sample >= a! && sample < b!) ? 0 : 1);
  }
  /** Update stance before skill dispatch so crouch+fire in the same tick works. */
  prepareInput(intent: Intent): void {
    // 起身结束先交回控制权，再消费本 tick 按键/缓冲，不能浪费第一帧。
    if (this.isDown && !this.inHitstop) this.tickDown(currentTick());
    if (this.isBusy || this.isDown || this.performing) return;
    this.isCrouchingFlag = intent.crouch && this.isGrounded();
    this.refreshStance();
    if (this.state === "guard" && !intent.guard) this.state = "idle";
    if (intent.guard && this.isGrounded()) this.state = "guard";
  }
  get isPerforming(): boolean { return this.performing; }
  /** Paired cinematic placement is the sole owner; no second entity offset. */
  placePerformance(axis: number, height = 0): void {
    this.localAxis = axis;
    this.y = ARENA_FLOOR_Y + Math.max(0,height);
    this.velocityY = 0;
    this.knockback = 0;
    this.clampToArena();
    this.commitPosition();
  }
  placeCinematic(anchor: number[], yaw: number, origin: number, facing: number): void {
    const baseYaw = ARENA_AXIS === "x" ? (facing>0 ? -90 : 90) : (facing>0 ? 0 : 180);
    this.cinematicPose={depth:anchor[0]! * facing * (ARENA_AXIS === "x" ? -1 : 1) / 16,yaw:baseYaw+yaw};
    this.placePerformance(origin-anchor[2]! * facing / 16,anchor[1]! / 16);
  }
  get isOnStage(): boolean { return !this.offstage; }

  /** Reusable round object; defeated model is removed from the visible arena. */
  leaveStage(): void {
    this.offstage = true;
    this.endDashPearl();
    setBodyOpacity(this.entity, 0);
    this.commitPosition();
  }

  /** Finish falling during KO; never switch to standing idle in the air. */
  settleAfterKo(): void {
    if (this.performing || this.inHitstop || this.offstage) return;
    this.activeMove = undefined;
    clearQueuedClip(this.key());
    if (!this.isGrounded()) {
      this.state = "jump";
      this.stance = "air";
      this.velocityY = Math.min(0, this.velocityY);
      playClip(this.entity, "air_fall");
      this.tickPhysics(currentTick(), undefined);
    }
  }

  /** 相机、珍珠和本体共享同一个可达落点；拳击仍单独检查实际距离。 */
  super1StepDestination(opponent?: Fighter): number {
    if (this.activeMove?.pearlStep) return this.activeMove.pearlStep.target;
    const gap = opponent ? (opponent.axisPosition-this.localAxis)*this.facing : Infinity;
    const distance = Math.max(0, Math.min(SUPER_1_STEP_DISTANCE, gap-1.1));
    return Math.max(-ARENA_HALF_WIDTH,Math.min(ARENA_HALF_WIDTH,this.localAxis+this.facing*distance));
  }

  super1PearlPoint(): Vector3 {
    const step = this.activeMove?.pearlStep;
    if (!step) return this.handPoint("mid");
    const u = Math.max(0,Math.min(1,(clipElapsed(this.entity)*3-12)/7));
    const end = this.worldPos(step.target, ARENA_FLOOR_Y+0.08);
    return { x:step.from.x+(end.x-step.from.x)*u, y:step.from.y+(end.y-step.from.y)*u+0.25*4*u*(1-u), z:step.from.z+(end.z-step.from.z)*u };
  }

  settlePerformanceDown(permanent = false, holdTicks = 8): void {
    this.cinematicPose=undefined;
    this.performing = false;
    this.activeMove = undefined;
    this.beginDown(0, {enter:"idle_down",idle:"idle_down",totalTicks:permanent ? Number.MAX_SAFE_INTEGER : holdTicks+KNOCKDOWN_GETUP_TICKS,pop:0,knockback:0});
    if (permanent) this.downUntilTick = this.busyUntilTick = Number.MAX_SAFE_INTEGER;
    this.downIdleFromTick = currentTick();
  }

  // ================= 调试 =================

  private key(): string {
    return `allstars:${this.player.id}:${this.side}`;
  }

  debugLine(): string {
    return (
      `${this.name} hp=${this.hp} meter=${this.meter.toFixed(2)} ` +
      `state=${this.state} stance=${this.stance} ` +
      `axis=${this.axisPosition.toFixed(2)} y=${this.feetY.toFixed(2)} ` +
      `clip=${currentClip(this.entity) ?? "-"} ` +
      `busy=${Math.max(0, this.busyUntilTick - system.currentTick)}` +
      `${this.performing ? " perf=1" : ""}`
    );
  }

  /** 清计时器与动画记录(**可重复执行**) */
  dispose(): void {
    this.throwTechPartner = undefined;
    releaseClipHold(this.key());
    clearQueuedClip(this.key());
    this.activeMove = undefined;
    this.performing = false;
    this.busyUntilTick = 0;
  }
}
