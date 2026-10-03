// ============================================================
// 《灯塔全明星》运行时核心(M1)全部可调常量
//
// 数值分级约定:
//   [已定]  规格书明确给出的值,改动前请先确认规格
//   [待调]  占位值,必须实机试玩后调整(不调就是"能跑但手感不对")
//   [实测]  引擎实测约束,改动可能导致相机/动画异常
//
// 所有坐标都是**房间维度内的世界坐标**;竞技场默认以原点为中心。
// ============================================================

import type { Vec3 } from "../../shared/minigame-core/types";
import { CHUNYE_DAMAGE } from "./data/chunye.damage";

// ============================================================
// 一、竞技场几何
// ============================================================

/** [待调] 竞技场水平轴:两名角色沿该轴对峙。 */
export type ArenaAxis = "x" | "z";
export const ARENA_AXIS: ArenaAxis = "x";

/** [待调] 擂台中心(房间维度内)。START_POSITIONS 只用于兜底,实际站位由本值 ± 半距推导。 */
export const ARENA_CENTER: Vec3 = { x: 0, y: 65, z: 0 };

/** [待调] 开局双方距中心的水平半距(格)。 */
export const ARENA_START_HALF_DISTANCE = 2.5;

/** [待调] 擂台可行走半宽(格):角色中心不得超出 center ± 该值,防止走出场地。 */
export const ARENA_HALF_WIDTH = 12;

/** [待调] 擂台地板高度(角色脚底 y)。角色 y 由脚本接管,不用引擎重力。 */
export const ARENA_FLOOR_Y = 65;

/** [已定] 单侧最大血量，所有战斗伤害使用整数 HP。 */
export const MAX_HP = 10000;

/** [待调] 气上限(格)。规格:上限 3 气。 */
export const MAX_METER = 3;

// ============================================================
// 二、输入(P1 关键不确定项)
// ============================================================

/**
 * [关键] getMovementVector() 的轴向语义在本版本**未经实机确认**。
 * 两种候选假设:
 *   "x_horizontal" → vector.x 是左右横移、vector.y 是前后;
 *   "y_horizontal" → vector.y 是左右横移、vector.x 是前后。
 * 默认取 "x_horizontal"(与 WASD→(x=横,y=前)的常见约定一致)。
 * 实机用 `/scriptevent allstars:probe` 观察原始值后改这一行即可全局翻转。
 */
export type InputAxisMode = "x_horizontal" | "y_horizontal";
export const INPUT_AXIS_MODE: InputAxisMode = "x_horizontal";

/**
 * [待调] 轴输入死区:绝对值小于该值视为无输入(摇杆漂移抑制)。
 */
export const INPUT_DEADZONE = 0.2;

// ------------------------------------------------------------
// 二之二、输入轴向**实机校准**(M1 唯一硬件相关不确定项的自动化)
//
// 背景:`getMovementVector()` 官方 d.ts 只说是 Vector2,未定义 x/y 语义
// (哪个是左右、哪个是前后、正负朝哪)。默认值 = 下面这组常量;
// 实机跑一次 `/bearcade:allstars_calibrate`,脚本会把推杆结果写进
// 世界动态属性并**持久化**,deriveIntent 优先用校准结果。
// 删掉动态属性即回到本组默认值。
// ------------------------------------------------------------

/** 输入校准结果的动态属性键(世界级持久化) */
export const INPUT_CALIBRATION_KEY = "bearcade:allstars_input_calibration";
/** 校准每一步的采样时长(tick) */
export const CALIBRATION_STEP_TICKS = 30;
/**
 * 未校准时使用的水平轴符号(校准会覆盖它;正 = 原始分量正方向为"右")。
 * [实测 2026-09-25] 实测"向右推"读到 raw.x = **-0.86** ⇒ 该轴是"左正",
 * 所以要 -1 才能让 intent.horizontal 正 = 屏幕右。
 */
export const INPUT_HORIZONTAL_SIGN: 1 | -1 = -1;
/**
 * 未校准时使用的"前后轴"符号(校准会覆盖它;depth 正 = 屏幕上方 = 前)。
 * [实测 2026-09-25] 实测"向前推"读到 raw.y = **+1.00** ⇒ 正向即为"前"。
 */
export const INPUT_DEPTH_SIGN: 1 | -1 = 1;
/** [待调] 校准判定用最小模长:某一步平均向量模长低于该值 = 没推到,判失败。 */
export const CALIBRATION_MIN_MAGNITUDE = 0.35;
/**
 * [待调] 校准"主轴分离度"上限:|cos(F,R)| 超过该值说明"前推"与"右推"几乎同向,
 * 无法区分前后/左右轴 → 判校准失败(0.75 ≈ 夹角 < 41° 或 > 139°)。
 */
export const CALIBRATION_MAX_COS = 0.75;

/**
 * [待调] 前后轴判定阈值:朝屏幕上方推过 +该值 = 前(跳),
 * 朝屏幕下方拉过 -该值 = 后(蹲/防御)。落在区间内视为中立。
 *
 * ★帧约定(2026-09-25 实机修正):`getMovementVector()` 给出的是**摇杆自身的朝向**
 * (前=y+、右=x−,由校准测出),两名玩家用的是**同一台侧视相机**,
 * 因此**双方都是绝对屏幕方向映射**,不再按 facing 翻转:
 *   前推(屏幕上方)= 跳 / 后拉(下方)= 蹲 / 左推 = 屏幕左移 / 右推 = 屏幕右移。
 * (旧实现按 facing 翻转 ⇒ P2 前推变蹲、右推变左移,实机复现。)
 */
export const INPUT_DEPTH_THRESHOLD = 0.5;

/** [实测] 控制笼内玩家每 tick 被拉回锚点,所以必须保留 Movement 权限读输入。 */
export const CAGE_KEEP_MOVEMENT_INPUT = true;
/**
 * [测不准 · 实机必查] 禁掉跳跃/潜行权限,避免玩家本体真的起跳或蹲下改变中点高度。
 *
 * ⚠️ 风险:有说法认为关掉 Jump/Sneak 权限会连 getMovementVector() 的前后分量一起
 * 清零(权限是"输入闸门"而非"动作闸门")。若实机 probe 显示前后推杆始终为 0,
 * 就把这两项改成 false——本体位移已经由 pullBackToCage 每 tick 归位兜住了,
 * 不去禁用权限也不会真的跑掉。
 */
// [实测修正] 风险已规避:关掉 Jump/Sneak 权限有把 getMovementVector() 前后分量一起清零的风险,
// 会让"前推跳 / 后拉蹲"整体失效;而玩家本体位移由 pullBackToCage 每 tick 归位兜住,
// 不禁权限也不会跑掉 —— 因此改为**不禁**,保证输入向量完整可读。
export const CAGE_DISABLE_JUMP_INPUT = false;
export const CAGE_DISABLE_SNEAK_INPUT = false;

/**
 * [待调] 防御 = 按住**背向对手**的左右方向(规格:玩家在左、敌人在右时摁左键)。
 * 判定式:`horizontal * facing * GUARD_HORIZONTAL_BACK_SIGN > 阈值`
 * (facing 是"角色朝向"= 朝对手的方向,所以乘出来 > 0 就是"离对手越来越远")。
 * 与"后拉(depth<0)=防御"是 **或** 关系,两者都生效。
 * 若实机发现方向相反(推离对手反而前进),把 GUARD_HORIZONTAL_BACK_SIGN 改成 1。
 */
export const GUARD_ON_HORIZONTAL_BACK = true;
export const GUARD_HORIZONTAL_THRESHOLD = 0.5;
export const GUARD_HORIZONTAL_BACK_SIGN: 1 | -1 = -1;

/**
 * [待调] 按键兜底:若方向向量的前后分量始终为 0(权限/设备问题),
 * 仍然可以用跳跃键触发跳、潜行键触发蹲/蹲防,保证首测不因输入不可读而"完全动不了"。
 */
export const INPUT_BUTTON_FALLBACK = true;
/** [实测] 玩家本体全程隐身(与擂台上的自定义实体无关)。 */
export const PLAYER_INVISIBILITY_TICKS = 20 * 60 * 60;

/** [实测] probe 调试命令 id 与观察时长(tick)。 */
export const PROBE_COMMAND_ID = "allstars:probe";
export const PROBE_DURATION_TICKS = 5 * 20;

// ============================================================
// 三、Fighter 运动学(脚本接管 y,不用引擎重力)
// ============================================================

/** [待调] 水平移动速率(格/tick)。 */
export const MOVE_SPEED = 0.25;

/** [待调] 冲刺速率(格/tick):双击同方向触发的突进。 */
export const DASH_SPEED = 0.5;

/**
 * [待调] 双击判定窗口(tick):同方向两次"推到底"落在这个窗口内 = 突进。
 * 8 tick = 0.4 秒(格斗游戏常见的双击窗口)。
 */
export const DASH_DOUBLE_TAP_TICKS = 8;

/** [待调] 把水平轴推过该值才算"按了一下"(双击检测用)。 */
export const DASH_TAP_THRESHOLD = 0.6;

/**
 * [待调] 突进持续时长(tick):期间锁普通操作,位移由脚本给。
 * 7 = dash_backward(7t)/dash_forward(6t) 的长度 —— 动画放完位移也正好结束,
 * 不会出现"动画完了人还在滑"或"动画被重播"。
 */
export const DASH_TICKS = 7;

/**
 * [待调] 跳跃初速度(格/tick)。
 * 0.58 配 GRAVITY_PER_TICK = 0.052 ⇒ 顶点约 3.2 格、滞空约 22 tick:
 * **足以从对手头顶跳过去**(对手碰撞箱高 2.9 格)。旧值 0.42/0.045 只有 1.96 格,
 * 实机表现是"跳不过去、像穿模"。
 */
export const JUMP_VELOCITY = 0.58;

/** [待调] 每 tick 重力加速度(格/tick²),抛物线由脚本积分。 */
export const GRAVITY_PER_TICK = 0.052;

/** [待调] 允许的最大下落速度(格/tick),防止穿透地板。 */
export const MAX_FALL_SPEED = 1.2;

/** [待调] 落地判定容差(格):y ≤ 地板 + 该值 即视为着地。 */
export const GROUND_SNAP_EPSILON = 0.06;

/** [待调] 起跳前的蓄力硬直(jump_start 只有 1 tick,补一点让动作可见)。 */
export const JUMP_STARTUP_TICKS = 2;

/** [待调] 落地硬直(jump_land 期间不可行动)。 */
export const JUMP_LANDING_TICKS = 3;

/** [待调] 命中后水平击退速度(格/tick),衰减见 KNOCKBACK_DECAY_PER_TICK。 */
export const HIT_KNOCKBACK_SPEED = 0.28;

/** [待调] 击退速度每 tick 衰减系数(0.8 = 每 tick 掉 20%)。 */
export const KNOCKBACK_DECAY_PER_TICK = 0.8;

/** [待调] 双方最小间距(格):防止两个角色重叠成一坨。 */
export const FACING_DEADZONE = 0.15;
export const MIN_FIGHTER_GAP = 0.9;

/**
 * [待调] 高度差超过该值(格)就**不再**做最小间距分离 ⇒ 可以从对手头顶跳过去。
 * 取 1.4:起跳后几 tick 就超过它,落地前又回到分离范围,不会出现"卡在对手身上"。
 */
export const MIN_GAP_IGNORE_HEIGHT = 1.4;

// ------------------------------------------------------------
// 三之二、后台(玩家本体待的地方)
//
// 规格(2026-09-25):**玩家原来的身体不许出现在场地里**,场地内只有前台角色
// (自定义实体)。所以控制笼的锚点从"擂台上的起始位"挪到**擂台地板正下方**的
// 后台小平台:同一维度、同一常加载区,但相机(侧视,略俯视)完全看不到;
// 玩家看到的画面始终是脚本下发的 free 相机,与本体位置无关。
// ------------------------------------------------------------

/** [实测] 后台平台方块层 y(擂台地板下 4 格,TEMPLATE 复制区最低层就是 60) */
export const BACKSTAGE_PAD_Y = ARENA_FLOOR_Y - 5;
/** [实测] 后台平台顶面 = 玩家脚底 y */
export const BACKSTAGE_FEET_Y = BACKSTAGE_PAD_Y + 1;
/** [实测] 控制笼锚点 y(teleport 时会 +0.5 ⇒ 脚底正好站在台面上,不抖不掉) */
export const BACKSTAGE_ANCHOR_Y = BACKSTAGE_FEET_Y - 0.5;
/** [待调] 两名人物的横向间距(格):避免两个隐身本体互相挤 */
export const BACKSTAGE_SPREAD = 3;
/** [待调] 后台平台半宽(格,7×7) */
export const BACKSTAGE_HALF_SIZE = 3;

// ============================================================
// 四、招式与命中判定(M1 从简:中段窗口 + 单一 reach)
// ============================================================

/** 快捷栏槽位 → 招式。第 1 格(slot 0)空,slot 1~6 对应 6 个技能。 */
export type SkillSlot = 1 | 2 | 3 | 4 | 5 | 6;
export type StanceName = "stand" | "crouch" | "air";

export interface SkillDef {
  /** 槽位(1 基) */
  slot: SkillSlot;
  /** 中文名(HUD / 播报用) */
  label: string;
  /** 最短动画 id 前缀:`attack_stand_light` / `attack_stand_light_2` / `attack_stand_light_3` */
  clipBase: string;
  /** [待调] 水平命中距离(格) */
  reach: number;
  /** [待调] 命中伤害 */
  damage: number;
  /** [待调] 命中后对手硬直 tick */
  hitstunTicks: number;
  /** [待调] 命中回复自身的气 */
  meterOnHit: number;
  /** [兼容字段] 旧版曾用于防御掉气；当前防御成功改为小幅涨气，不再读取 */
  guardChipMeter: number;
  /** [待调] 被防御时的 chip 伤害(默认 0 = 完全免伤) */
  guardChipDamage: number;
  /** [待调] active 窗口在整段动画中的起止比例(占位;M2 换成逐招帧数据) */
  activeStart: number;
  activeEnd: number;
  /** [待调] 三段连打窗口(占位;M2 接连锁系统) */
  chainCount: number;
  /** 是否需要对手在地面 */
  groundOnly: boolean;
}

/**
 * M1 招式表:轻/中/重/投/发波/大招。
 * 轻中重各有 stand / crouch / air 三套动画,由 Fighter 按当前站姿选前缀。
 * 伤害与硬直全部 [待调]。
 */
export const SKILLS: Record<SkillSlot, SkillDef> = {
  1: {
    slot: 1,
    label: "轻攻击",
    clipBase: "attack_stand_light",
    reach: 1.9,
    damage: CHUNYE_DAMAGE.light,
    hitstunTicks: 10,
    meterOnHit: 0.15,
    guardChipMeter: 0.10,
    guardChipDamage: 0,
    activeStart: 0.25,
    activeEnd: 0.6,
    chainCount: 3,
    groundOnly: false,
  },
  2: {
    slot: 2,
    label: "中攻击",
    clipBase: "attack_stand_medium",
    reach: 2.2,
    damage: CHUNYE_DAMAGE.medium,
    hitstunTicks: 14,
    meterOnHit: 0.22,
    guardChipMeter: 0.15,
    guardChipDamage: 0,
    activeStart: 0.3,
    activeEnd: 0.65,
    chainCount: 3,
    groundOnly: false,
  },
  3: {
    slot: 3,
    label: "重攻击",
    clipBase: "attack_stand_heavy",
    reach: 2.4,
    damage: CHUNYE_DAMAGE.heavy,
    hitstunTicks: 20,
    meterOnHit: 0.3,
    guardChipMeter: 0.25,
    guardChipDamage: 200,
    activeStart: 0.35,
    activeEnd: 0.7,
    chainCount: 3,
    groundOnly: false,
  },
  4: {
    slot: 4,
    label: "投技",
    clipBase: "throw_cast",
    reach: 1.5,
    damage: CHUNYE_DAMAGE.throw,
    hitstunTicks: 26,
    meterOnHit: 0.35,
    guardChipMeter: 0.4,
    guardChipDamage: 300,
    activeStart: 0.2,
    activeEnd: 0.35,
    chainCount: 1,
    groundOnly: true,
  },
  5: {
    slot: 5,
    label: "发波",
    clipBase: "special_leaf_burst",
    // [实机 2026-09-25] 发波射程太近 → **×3**(6.5 → 19.5,约等于整个擂台宽度)
    reach: 19.5,
    damage: CHUNYE_DAMAGE.wave,
    hitstunTicks: 12,
    meterOnHit: 0.2,
    guardChipMeter: 0.1,
    guardChipDamage: 0,
    activeStart: 0.35,
    activeEnd: 0.75,
    chainCount: 1,
    groundOnly: false,
  },
  6: {
    slot: 6,
    label: "大招",
    clipBase: "super", // 第 7 格一气，朝对手或跳跃方向+7 二气，下蹲方向+7 三气
    // [实机 2026-09-25] 大招判定距离太近 → **×3**(3.2 → 9.6)
    reach: 9.6,
    damage: CHUNYE_DAMAGE.super1, // 二气与三气由各自配对时间线结算
    hitstunTicks: 40,
    meterOnHit: 0,
    guardChipMeter: 1,
    guardChipDamage: 800,
    activeStart: 0.3,
    activeEnd: 0.6,
    chainCount: 1,
    groundOnly: false,
  },
};

/**
 * 大招由按键方向选档，并支付所选档位的气量：1/2/3 气分别对应
 * 单按 7、朝对手+7（兼容 W+7）、S+7。气量不足时拒绝，不自动降档。
 *
 * 注意 tier 3 这里只给**起始段**(super_3_start),整段演出由
 * Match 的"大招时间线"(SUPER_3_STAGES + SUPER_3_FINISH_*)驱动,
 * 因为三气的分支必须在"释放被接受"那一刻取样并锁定(见下)。
 */
export type SuperTier = 1 | 2 | 3;
export const SUPER_CLIP_BY_METER: { meter: SuperTier; clip: string }[] = [
  { meter: 1, clip: "super_1" },
  { meter: 2, clip: "super_2" },
  { meter: 3, clip: "super_3_start" },
];

// ============================================================
// 四之二、大招演出(M2-a)
//
// 全部语义来自源资产 super_metadata.json / super_3_metadata.json:
//   releaseFreeze.owner = "game_shared_combat_clock",bakedIntoBodyAnimation = false,
//   duration = null → 时停**必须游戏侧实现**,长度由我们定;
//   ⚠️ 绝不能用 /tick freeze:世界 tick 冻结会把 system.runInterval 一起冻死,
//      脚本再也解不开;ScriptAPI 也没有时间缩放 API ⇒ "时停" = 逻辑层 + 输入层实现。
//   auraClock(施法者气场)在战斗逻辑暂停期间**独立推进** ⇒ 施法者不受时停影响。
// ============================================================

/** [待调] 一/二气释放时停长度(tick)。20 tick = 1 秒。 */
/** 一/二气释放时停：0.4 秒，给双方看清起手特效后再进入判定。 */
export const SUPER_FREEZE_TICKS = 8;

/** [待调] 触发释放时停的气量档位(三气走自己的分段演出,不进这里)。 */
export const SUPER_FREEZE_TIERS: number[] = [1, 2];

/** [待调] 释放时停的震屏强度(0~4)。 */
export const SUPER_FREEZE_SHAKE = 0.5;

/** [待调] 释放时停白闪的淡出时长(秒)。 */
export const SUPER_FREEZE_FADE_SECONDS = 0.1;

/** [待调] 三气"低血量分支"阈值:hp / MAX_HP <= 该值 走低血结尾。 */
export const SUPER_3_LOW_HEALTH_RATIO = 0.25;

/** [待调] 三气起始段之后的中间段顺序(super_3_start 由 SUPER_CLIP_BY_METER 播)。 */
export const SUPER_3_STAGES: string[] = ["super_3_confirm", "super_3_chain"];

/** [待调] 三气普通结尾段 */
export const SUPER_3_FINISH_NORMAL = "super_3_finish";
/** [待调] 三气低血量结尾段 */
export const SUPER_3_FINISH_LOW = "super_3_low_finish";

/** [待调] 受击方配对片段后缀(资产命名约定:<段名> + "_victim") */
export const SUPER_3_VICTIM_SUFFIX = "_victim";

/** [待调] 分段之间的空档(tick):给引擎一点时间把上一段收干净,避免硬切。 */
export const SUPER_3_STAGE_GAP_TICKS = 2;

/** [待调] 配对受击方的最大水平距离(格):超出视为落空,对手不播配对段。 */
// [实机 2026-09-25] 大招判定距离 ×3(4.0 → 12),与 SKILLS[6].reach 同步放大
export const SUPER_3_PAIR_REACH = 12;

// ---- 四之四 逐招帧数据与三段连打 [待调] ----
/**
 * 是否使用逐招真帧数据(src/data/chunye.combat.ts,由 scripts/allstars-gen-combat.mjs 生成)。
 * false 时退回 M1 的 activeStart/activeEnd 比例估算。
 */
export const USE_REAL_FRAME_DATA = true;
/**
 * active 窗口的**最小游戏 tick 数**。
 *
 * 实测约束:作者是 60tick/秒,而游戏逻辑是 20tick/秒 —— 轻攻击 active 只有
 * `[3,5)` 作者 tick = `[1,2)` 游戏 tick,即**仅 1 个 tick**。1 tick 的窗口在手感上
 * 基本"打不中",所以这里放宽到 2(可按手感调 1~3)。
 */
export const ACTIVE_WINDOW_MIN_TICKS = 2;
/** active 窗口额外延长(在最小宽度之上再补,默认 0) */
export const ACTIVE_WINDOW_BONUS_TICKS = 0;
/**
 * 三段连打窗口(从**起手**算起,单位 tick)。
 *
 * ⚠ 可用余量 = 本值 − 该招式的 `clipGameTicks`:
 *   轻击 5 → 23 tick;中击 8 → 20;重击 11 → 17;`_3` 重击 13 → 15。
 * 之所以要留足:`useSkill` 在忙碌期(busyUntilTick)内**直接拒绝**,没有输入缓冲,
 * 所以玩家必须"硬直一结束、且在窗口内"按下才接得上。窗口过小会让三段连打变成掐点操作。
 * 实机若觉得连段太容易/太难,先调这一个值(建议 22~30)。
 * TODO(M2-c):做输入缓冲(忙碌期记下按键,结束瞬间自动起手)或按 recovery 区间做取消窗口。
 */
export const CHAIN_WINDOW_TICKS = 28;

/**
 * [待调] 招式输入缓冲窗口(tick)。
 * 忙碌期(招式/硬直中)按下的技能键会被记住,在硬直结束的瞬间自动起手;
 * 超过该窗口则丢弃(避免"很久以前按的键"突然触发)。
 * 建议 4~10(即 0.2~0.5 秒);0 = 关闭缓冲(退回旧行为)。
 */
export const INPUT_BUFFER_TICKS = 8;

// ============================================================
// 四之三、KO 慢放 + 特写运镜(M2-a)
//
// 资产规定 presentation = "impact_hitstop_is_short_all_hits; strong_slow_is_KO_only"
// → 重慢放只在**确认 KO** 时启用;且不能改整个世界 tick 速度。
// ScriptAPI 无时间缩放 ⇒ "突慢" = 逻辑停顿 + 运镜 + 闪光。
// ============================================================

/** [待调] KO 阶段总时长(tick):这段时间内双方锁输入,播特写运镜。 */
export const KO_PHASE_TICKS = 48;
/** [待调] KO 特写 FOV(度):比常规 62 收窄 ⇒ 视觉上"拉近"。 */
export const KO_CAMERA_FOV = 38;
/** [待调] KO 特写机位到败者的**侧向**距离(格)。 */
export const KO_CAMERA_DISTANCE = 3.4;
/** [待调] KO 特写机位抬高(格,基于败者脚底)。 */
export const KO_CAMERA_HEIGHT = 1.8;
/** [待调] KO 特写运镜缓动时长(秒),配 OutCubic。 */
export const KO_CAMERA_EASE_SECONDS = 0.28;
/** KO 中央大字要等特写镜头完成缓动后再出现，额外留 1 tick 接缝。 */
export const KO_DISPLAY_DELAY_TICKS = 7;
/** [待调] KO 白闪淡出时长(秒)。 */
export const KO_FADE_SECONDS = 0.12;
/** [待调] KO 震屏强度(0~4) */
export const KO_SHAKE_INTENSITY = 0.9;
/** [待调] KO 震屏时长(秒) */
export const KO_SHAKE_SECONDS = 0.35;

/** [待调] 发波消耗气(规格:0 气)。 */
export const PROJECTILE_METER_COST = 0;

// ------------------------------------------------------------
// 四之五、叶流粒子表现(VFX)
//
// 素材来自角色源资产 Leaf_RP(identifier 保持 green_beret:leaf_* / green_beret:pearl_pop,
// 粒子定义与贴图已随本包资源包分发:resource-pack/particles + resource-pack/textures/particle)。
// 全部是**纯表现**:任何一步失败都静默,绝不影响伤害/回合/输入锁。
// 关闭方式:VFX_ENABLED = false(只剩逻辑,便于排查性能或画面干扰)。
// ------------------------------------------------------------

/** [待调] 粒子表现开关(关掉只剩逻辑,便于排查性能/干扰) */
export const VFX_ENABLED = true;

/**
 * [待调] 同一次触发最多撒几个粒子(性能上限)。
 *
 * 预算按"粒子定义单次微粒数"计价,而各定义的微粒数差别很大:
 *   leaf_flight = 56、leaf_end = 28、leaf_mobility = 18、leaf_rise_stream = 18、
 *   pearl_pop = 8、leaf_gather = 6、leaf_pearl = 1。
 * 所以预算必须 ≥ 最大单次用量,否则会出现"整次发射被跳过"的观感问题:
 *   - 24 时:发波(leaf_flight 56)一次都放不完 → 看不到扇形叶流;
 *   - 24 时:KO 的 3×pearl_pop 正好吃光预算 → 上冲叶流被跳过。
 * 128 可同时容纳双方相遇时的两枚发波(2×56 + 两侧聚气)；KO 与
 * 普通单侧爆发仍远低于这个上限。
 */
export const VFX_MAX_PER_BURST = 128;

/** [待调] 两次粒子触发之间的最小间隔(tick),防止逐 tick 刷屏 */
export const VFX_MIN_INTERVAL_TICKS = 2;

// ---- 以下为落地时按素材实测补的调参(改这些不会影响战斗数值) ----

/** [待调] 发波(slot 5)释放时朝对手方向撒的飞行粒子数 */
export const VFX_PROJECTILE_FLIGHT_COUNT = 16;
/** [待调] 发波释放时脚下聚气粒子数(leaf_gather 单次只出 6 个,一次触发连撒几次) */
export const VFX_PROJECTILE_GATHER_COUNT = 4;
/** [待调] 发波飞行粒子的水平初速(格/秒,喂给 particle_initial_speed) */
export const VFX_PROJECTILE_SPEED = 11.25;
/** [待调] 发波飞行粒子的预期射程(格):用于反推寿命 = range / speed */
export const VFX_PROJECTILE_RANGE = SKILLS[5].reach;
/** [待调] 命中时相消弹珠(pearl_pop)在身体上的高度偏移(格) */
export const VFX_POP_HEIGHT_OFFSET = 0.9;
/** [待调] 大招(slot 6)释放 + 三气每段起播时的聚气触发次数 */
export const VFX_SUPER_GATHER_STEPS = 3;
/** [待调] 大招聚气粒子的上浮初速(格/秒)与寿命(秒) */
export const VFX_SUPER_SPEED = 2.5;
export const VFX_SUPER_LIFE = 0.35;
/** [待调] 大招命中(leaf_end)的触发次数与初速(格/秒)、寿命(秒) */
export const VFX_SUPER_HIT_STEPS = 2;
export const VFX_SUPER_HIT_SPEED = 4;
export const VFX_SUPER_HIT_LIFE = 0.22;
/** [待调] KO 特写时 pearl_pop 的触发次数(单次 8 个粒子) */
export const VFX_KO_POP_STEPS = 3;
/** [待调] KO 特写时 pearl_pop 的扩散点半径 */
export const VFX_KO_POP_RADIUS = 0.5;
/** [待调] KO 特写时向上冲的叶流(leaf_rise_stream)次数与初速(格/秒)、寿命(秒) */
export const VFX_KO_RISE_TRIGGER_STEPS = 2;
export const VFX_KO_RISE_SPEED = 6;
export const VFX_KO_RISE_LIFE = 0.5;
export const VFX_KO_RISE_FADE_DELAY = 0.2;
/** [待调] KO 特写时向上冲的叶流在水平面上的散布半径(格) */
export const VFX_KO_RISE_STREAM_SPREAD = 0.4;
/** [待调] 原版 critical 粒子在**非 KO** 命中时的保留概率(1 = 全保留,0 = 不再出现)。 */
export const VFX_LEGACY_HIT_PARTICLE_CHANCE = 0.5;

/**
 * 命中判定的垂直容差(格):只比水平距离,但空中目标要用更宽松的窗口。
 * [待调]
 */
export const HIT_VERTICAL_TOLERANCE = 1.6;

/** 普通站立发波的实际命中垂直窗口(格)。视觉叶流仍保持原射程。 */
export const WAVE_HIT_VERTICAL_TOLERANCE = 0.9;
/** 普通发波扫过目标时的水平时间缓冲(格)，避免远距离擦边命中。 */
export const WAVE_HIT_SWEEP_BUFFER = 0.22;
/** 普通发波的逻辑命中射程(格)，小于视觉射程，给跳跃躲避留下空间。 */
export const WAVE_HIT_RANGE = 17.5;

// ============================================================
// 四之七、击倒(投技 / 连续挨打)与起身
//
// 规格(2026-09-25):
//   ① 投技命中 → **把对手摔倒在地**;
//   ② 一方连续打出若干次攻击 → **把对手打倒地**。
// 击倒期间:锁输入、免疫伤害(防止倒地还被连打)、到点播 getup 起身回战斗。
// ============================================================

/** [待调] 投技命中是否必定击倒(规格要求:摔倒在地)。 */
export const THROW_KNOCKDOWN = true;

/** [待调] 连续被命中多少次 ⇒ 打倒地(每次命中 +1;被打断/击倒后清零)。 */
export const KNOCKDOWN_COMBO_HITS = 5;

/** [待调] 连击计数在这么久没再命中后清零(tick)。 */
export const COMBO_RESET_TICKS = 50;

/** [待调] 普通击倒总时长(tick):knockdown(10) + 躺地 + getup(14)。 */
export const KNOCKDOWN_TICKS = 36;

/**
 * [待调] 被投技摔倒的总时长(tick)。
 * throw_victim 本身 28 tick,再留几 tick 躺地 + getup(14) ⇒ 48 ≈ 2.4 秒。
 */
export const THROW_KNOCKDOWN_TICKS = 48;
/** 投技捕获后受击者从 throw_victim 的第几个游戏 tick 起播，和施放者 0.35 秒前摇对齐。 */
export const THROW_VICTIM_START_OFFSET_TICKS = 7;
/** 投技从按下到摔倒冲击的共享时钟位置：1.4 秒 = 28 游戏 tick。 */
export const THROW_IMPACT_GAME_TICKS = 28;

/** [待调] 起身动画(getup)时长(tick):倒计时到最后这么多 tick 时起播。 */
export const KNOCKDOWN_GETUP_TICKS = 14;

/** 起身完成后给角色的短暂无敌，防止最后一帧被压回倒地。 */
export const GETUP_INVULNERABILITY_TICKS = 4;

/** [待调] 进入倒地时的水平击退初速(格/tick),让"摔"有位移感。 */
export const KNOCKDOWN_KNOCKBACK_SPEED = 0.42;

/** [待调] 进入倒地时向上弹起的初速(格/tick):0 = 不弹,直接躺。 */
export const KNOCKDOWN_POP_VELOCITY = 0.26;

/** [待调] 倒地期间是否免疫伤害(推荐 true:否则贴脸连打会把人锁死在地上)。 */
export const KNOCKDOWN_INVULNERABLE = true;

// ============================================================
// 四之八、发波三变体(站/蹲/空)+ 上挑击飞 + 投技失败/拆投 + 大招受击方
//
// 规格(2026-09-25):这些段**不是玩家直接按键触发的收招**,必须由
// "按键 → 状态/目标检查 → 播施放者动画 → 到达判定时间 → 服务端确认
// 命中/防御/落空 → 才给受击者发对应动画"这条链驱动,并且**双方共用同一个
// 动作时钟**(用 clipGameTicks 取每段长度,不手写"第几个基岩 tick")。
// ============================================================

/** [待调] 空中发波(叶片俯冲)loop 段最多重复几次 */
export const LEAF_DIVE_LOOP_MAX = 3;
/** [待调] 俯冲时的水平速度(格/tick,朝对手方向) */
export const LEAF_DIVE_FORWARD_SPEED = 0.48;
/** [待调] 俯冲时额外的下坠速度(格/tick,叠加在重力之上) */
export const LEAF_DIVE_DOWN_SPEED = 0.42;
/** 三种叶片技能共用起手间隔；普通波收招后还有 0.4 秒空档。 */
export const LEAF_COOLDOWN_TICKS = 28;
/** 升龙最后一个 loop 结束后停止攻击，保留 0.5 秒可惩罚收招。 */
export const LEAF_RISE_RECOVERY_TICKS = 10;
/** 俯冲命中后，受击者 0.6 秒硬直；施放者沿用 0.3 秒收势。 */
export const LEAF_DIVE_HITSTUN_TICKS = 12;
/** 仅升龙/俯冲相遇时保护后发者的起手，不能挡普通拳脚、投或波。 */
export const LEAF_COUNTER_STARTUP_MAX_TICKS = 8;
/** 升龙/俯冲对抗时可拦截头顶来袭者，普通升龙判定仍用 2.2 格。 */
export const LEAF_COUNTER_VERTICAL_TOLERANCE = 3.2;

/** [待调] 蹲下发波(上挑)loop 段最多重复几次 */
export const LEAF_RISE_LOOP_MAX = 2;
/** [待调] 上挑时本体上升速度(格/tick) */
export const LEAF_RISE_UP_SPEED = 0.3;
/** [待调] 上挑时的水平速度(格/tick,朝对手) */
export const LEAF_RISE_FORWARD_SPEED = 0.12;

/** [待调] 被上挑击飞时的初速(格/tick,向上) */
export const LEAF_LAUNCH_POP = 0.5;
/** [待调] 被上挑击飞时的水平击退(格/tick) */
export const LEAF_LAUNCH_KNOCKBACK = 0.3;
/** [待调] 被上挑击飞的"倒地+起身"总时长(tick) */
export const LEAF_LAUNCH_TICKS = 46;

/**
 * [待调] 分段动作(俯冲/上挑)的**垂直命中容差加成**(格)。
 * 上挑时本体自己会被抬到 2~3 格高,用常规容差(1.6)会在半程就打不中地面目标 ——
 * 而"跳起来把地面的人挑飞"本来就是这个招式的目的。
 */
export const SPECIAL_VERTICAL_TOLERANCE_BONUS = 2.5;
/** 升龙单独使用较窄的判定，避免在高点仍能命中地面目标。 */
export const LEAF_RISE_HIT_REACH = 1.9;
export const LEAF_RISE_VERTICAL_TOLERANCE = 2.2;

/** 三气源时间线(作者 tick):抛珠起点与首击确认点。 */
export const SUPER_3_TELEPORT_START_AUTHOR_TICKS = 69;
export const SUPER_3_CONFIRM_AUTHOR_TICK = 114;
/** 开场增加 0.2 秒：低头与抬头后聚珠/高抛各加 0.1 秒，猛抬头仍原速。
 * end 为源作者帧；只调整播放速度，原骨骼、追击和伤害节点保持原时间轴。 */
export const SUPER_3_OPENING_BEATS = [
  { end: 25, rate: 25 / 31 },
  { end: 30, rate: 1 },
  { end: SUPER_3_TELEPORT_START_AUTHOR_TICKS, rate: 39 / 45 },
] as const;
/** 仅三气追击降为上一版的 1/2；源时间与实际位移一起减速，保留追击距离。 */
export const SUPER_3_TRAVEL_SPEED_SCALE = 0.5;
export const SUPER_3_PURSUIT_RATE = 1.75 * SUPER_3_TRAVEL_SPEED_SCALE;
export const SUPER_3_PURSUIT_SPEED = 1.1 * SUPER_3_TRAVEL_SPEED_SCALE;
export const SUPER_CAPTURE_RATE = 1.5;
/** 一气短突进上限；近身提前停下，根位移由游戏实际执行。 */
export const SUPER_1_STEP_DISTANCE = 2.5;
/** 一气是瞬移后的近身拳，不能复用二气远距离捕获的 9.6 格范围。 */
export const SUPER_1_HIT_REACH = 1.65;
/** 一气只有真实位移阶段允许进入防御；作者帧之后是不可防的蓄力/出拳。 */
export const SUPER_1_GUARD_AUTHOR_START = 12;
export const SUPER_1_GUARD_AUTHOR_END = 20;
/** 三气起手施放者的短暂无敌(游戏 tick,约 0.15 秒)。 */
export const SUPER_3_STARTUP_INVULNERABILITY_TICKS = 3;
/** 首击确认附近允许穿过防御的极短窗口(作者 tick)。 */
/** 三气首击破防窗口：3 个制作 tick（约 0.05 秒），只覆盖首击接触瞬间。 */
export const SUPER_3_CONFIRM_GUARD_BREAK_AUTHOR_TICKS = 3;

/**
 * [待调] 投技拆投窗口(tick)。
 * 源资产 `motion_vfx_metadata.throw.techWindow = [21,27)`(制作 tick,60/秒)
 * ⇒ 0.1 秒 = **2 个游戏 tick**(不是"6 个制作 tick 就当 6 个游戏 tick")。
 */
export const THROW_TECH_WINDOW_TICKS = 2;
/** [待调] 拆投成功后双方分开的推力(格/tick) */
export const THROW_TECH_SEPARATE_SPEED = 0.22;

/** [待调] 大招"受击方"配对动画:按施放者消耗的气量(1/2 气)。 */
export const SUPER_VICTIM_CLIP: Record<number, string> = {
  1: "super_1_victim",
  2: "super_2_victim",
};

/** [待调] 大招"落空/被防御"的施放者收招:按气量档位。 */
export const SUPER_WHIFF_CLIP: Record<number, string> = {
  2: "super_2_whiff",
  3: "super_3_whiff",
};

/** [实测] 普通投技落空收招 */
export const THROW_WHIFF_CLIP = "throw_whiff";
/** [实测] 拆投双方动画 */
export const THROW_TECH_CAST_CLIP = "throw_tech_cast";
export const THROW_TECH_VICTIM_CLIP = "throw_tech_victim";

// ------------------------------------------------------------
// 四之九、道具(末影珍珠 / 命令方块)—— 冲刺与大招的非伤害视觉道具
//
// 源资产 props/ 里有独立建模,但动画 JSON 里**没有**它们的通道 ⇒ 用独立实体
// 渲染,每 tick 传送到"手"的位置。规格见 source/v047 的
// motion_vfx_metadata.json / super_metadata.json(已在 docs/lessons.md §19 记录)。
// ------------------------------------------------------------

/** [实测] 道具实体 id(由 scripts/allstars-ingest-props.mjs 生成) */
export const PROP_PEARL_ID = "bearcade:allstars_prop_pearl";
export const PROP_COMMAND_BLOCK_ID = "bearcade:allstars_prop_command_block";

/**
 * 手部近似局部偏移(格)。脚本读不到骨骼世界坐标,只能按"位置 + 朝向"估:
 * 前 = 朝向 × FORWARD,上 = HEIGHT,侧 = ±SIDE,并统一朝相机偏 TOWARD_CAMERA
 * (相机恒在 +z 一侧),否则道具会被身体挡住。
 */
export const PROP_HAND_FORWARD = 0.32;
export const PROP_HAND_HEIGHT = 1.32;
export const PROP_HAND_SIDE = 0.22;
export const PROP_HAND_TOWARD_CAMERA = 0.2;

/** [实测] 冲刺珍珠:释放发生在第几个游戏 tick(源 release=4/5 制作tick ≈ 1~2) */
export const DASH_PEARL_RELEASE_TICKS = 2;
/** [实测] 一气"聚珠"持续时间(游戏 tick):源 pearlGather=[5,12] 制作tick */
export const SUPER_PEARL_GATHER_TICKS = 4;
/** [实测] 二气命令方块的可见窗口(游戏 tick):源 propVisible=[8,124] 制作tick */
export const SUPER_2_PROP_FROM_TICKS = 3;
export const SUPER_2_PROP_UNTIL_TICKS = 41;
/** [待调] 珍珠从手边飞到目标所需时长(tick) */
export const SUPER_PROP_FLIGHT_TICKS = 8;

// ------------------------------------------------------------
// 四之十、慢放与定帧(源资产 ownership.presentation 的权威分工)
//
//   impact_hitstop_is_short_all_hits;  strong_slow_is_KO_only;
//   release_freeze_separate_and_not_simulated
//
// ① **释放时停**(一/二气):见 SUPER_FREEZE_* —— 冻结双方、施法者气场时钟独立;
// ② **命中定帧**(所有命中,越重越长):本段;定帧期间双方**都不动**(动量/垂直
//    物理一起停)但动画继续播,相机也一起定住(规格:affected = both_actors_
//    and_pearl_camera_clock);
// ③ **强慢放只在 KO**:我们没有"改动画播放倍率"的接口(playAnimation 无 speed 参数),
//    所以用"撞击定帧 + 更长的 KO 停顿 + 特写运镜"来近似 0.1 倍速的观感
//    (规格 ko.rate=0.1 / sourceInterval=[22,30]、[124,132])。
// ------------------------------------------------------------

/** [源资产] 普通招式命中定帧(tick):轻/中/重/投/发波/大招(大招见下面分档) */
export const HITSTOP_TICKS: Record<number, number> = {
  1: 2,
  2: 3,
  3: 5,
  4: 5,
  5: 3,
  6: 8,
};
/** [源资产] 被防御时的定帧(super_metadata.hitstop.blockPresentationTicks = 2) */
export const HITSTOP_BLOCKED_TICKS = 2;
/** [源资产] 大招命中定帧,按气量分档(super_1=4 / super_2=8 / super_3 首记=7) */
export const SUPER_HITSTOP_TICKS: Record<number, number> = { 1: 4, 2: 8, 3: 7 };
/** [源资产] 三气终结段的撞击定帧(super_3.finishers.*.hitstop.duration = 10) */
export const SUPER_3_FINISH_HITSTOP_TICKS = 10;
/** [源资产] KO 撞击定帧(强慢放的起点) */
export const KO_HITSTOP_TICKS = 10;
/** [待调] KO 演出时长:普通 KO / **大招 KO**(强慢放,更长) */
export const KO_PHASE_SUPER_TICKS = 72;

// ============================================================
// 五、防御 / 受伤 / 气
// ============================================================

/**
 * [待调] 按住"后方向"是否也算防御。
 *
 * ★2026-09-25 实机修正:改成 **false** —— 下蹲与防御必须是两个独立输入,
 * 否则"长按后拉"会被防御分支抢走,永远进不了 crouch_enter/idle_crouch,
 * 实机表现就是"按下去只蹲一下、不会持续下蹲"。
 * 防御按规格走"背向对手的左右方向"(见 GUARD_ON_HORIZONTAL_BACK)。
 */
export const GUARD_ON_HOLD_BACK = false;
/** [待调] 防御姿态下被命中的硬直(guard_hit_stand/crouch 之后回 guard_*) */
export const GUARD_HITSTUN_TICKS = 4;
/**
 * [待调] 防御中移动速率倍率(0 = 完全定身)。
 *
 * ★2026-09-25 从 0.35 调到 0.6:"背向对手推左右"既是防御也是**后撤**,
 * 旧实现防御直接 return(定身)⇒ 一按左右就原地不动,表现为"左右移动失灵"。
 * 现在防御期间照常横向移动,只是慢一点(格斗游戏的防御后撤)。
 */
export const GUARD_MOVE_SPEED_SCALE = 0.6;
/** [待调] 被命中回复的气(被打也涨气) */
export const METER_ON_TAKE_HIT = 0.12;
/** 大招受击按实际扣血积攒气；每损失半条血积攒一气。 */
export const METER_PER_SUPER_DAMAGE = 2 / MAX_HP;
/** [待调] 命中瞬间的相机震屏强度(Camera.addShake 上限 4.0) */
export const HIT_SHAKE_INTENSITY = 0.35;
/** [待调] 震屏时长(秒) */
export const HIT_SHAKE_SECONDS = 0.18;
/** [待调] 重击(重攻击/投技/大招)额外震屏强度 */
export const HEAVY_HIT_SHAKE_INTENSITY = 0.6;

// ============================================================
// 六、回合与比赛
// ============================================================

/** [已定] 每回合时长(秒) */
export const ROUND_SECONDS = 99;
export const ROUND_TICKS = ROUND_SECONDS * 20;
/** [已定] 三局两胜 */
export const ROUNDS_TO_WIN_MATCH = 2;
/**
 * [已定] **第一局**开场的近景运镜时长(tick):依次给两名角色特写,
 * 让玩家看清各自的"开场动画"以及**谁操控谁**。
 * 每人 INTRO_CAMERA_TICKS(= INTRO_TICKS/2),刚好放完 3.3s 的 intro 动画。
 */
export const INTRO_TICKS = 132;
/** [待调] 开场运镜里每名角色的特写时长(tick) */
export const INTRO_CAMERA_TICKS = 66;
/** [待调] 特写机位到角色的侧向距离(格) */
export const INTRO_CAMERA_DISTANCE = 4.6;
/** [待调] 特写机位抬高(格,基于角色脚底) */
export const INTRO_CAMERA_HEIGHT = 2.2;
/** [待调] 特写段内的横向平移量(格,± 各一次 ⇒ 有"运镜"感) */
export const INTRO_CAMERA_DRIFT = 1.3;
/** [待调] 特写视线落点高度(格,基于角色脚底) */
export const INTRO_CAMERA_AIM_HEIGHT = 1.5;
/** [待调] 特写 FOV(度):比常规 62 略收窄 = 近景 */
export const INTRO_CAMERA_FOV = 55;
/**
 * [已定] 每局开打前 3、2、1 倒计时，各持续 20 游戏 tick。
 * 第一局完整运镜后开始；后续换局直接开始，不重播开场动作。
 */
export const ROUND_INTRO_TICKS = 60;
/** [待调] 回合结束后、下一回合开始前的等待(victory_round 3.5s ≈ 70 tick) */
export const ROUND_END_TICKS = 95;
/** [待调] 决胜局结束后、回大厅前的等待(victory_match 5.57s ≈ 111 tick) */
export const MATCH_END_TICKS = 130;
/** [待调] 赛前选人阶段超时(tick);超时按默认角色开打,防止一人挂机卡死房间 */
export const SELECT_TIMEOUT_TICKS = 90 * 20;

// ============================================================
// 七、相机(侧视:中垂线顶点 + 固定 FOV 取景)
//
// 取景模型(2026-09-25 重做:实机反馈"太近 + 换位不平滑"):
//   1. 相机仍在两人中点的中垂线上(CAMERA_SIDE 决定哪一侧);
//   2. **FOV 固定**,画面远近只由"机位距离"决定 —— 不再用 FOV 拉伸,
//      因为 FOV 一变就等于整幅画面缩放,是"抖动感"的主要来源;
//   3. 机位距离 R 由**取景需求**反解:先算"要装下两名角色 + 余量"所需的
//      视野半高,再用 R = 半高 / tan(FOV/2) 求出该站多远(夹在上下限之间);
//      两人分开到超出上限时,才退回用 FOV 补足(此时观感已经是"全场"了);
//   4. 目标位姿先做**指数平滑**(CAMERA_SMOOTHING)再下发,配合
//      easeTime == 节流间隔的引擎缓动,连成匀速运镜(参考 Collapse 的
//      "free + easeOptions,引擎从当前状态插值"做法,见 docs/lessons.md §9)。
// ============================================================

/** [待调] 相机站在中垂线的哪一侧:"positive" = 另一轴的正方向。 */
export type CameraSide = "positive" | "negative";
export const CAMERA_SIDE: CameraSide = "positive";

/** [实测] 机位沿中垂线,不用 follow_orbit(半径锁死 10、自定义预设本版本不加载)。 */
export const CAMERA_ON_PERPENDICULAR = true;

/**
 * [待调] ★取景半高(格) —— **直接决定"看着多远"**,调大 = 画面更远。
 * 6.5 ⇒ 画面可见高度约 13 格(角色约 3 格高 ≈ 屏高 23%)。
 * 实机若仍嫌近/远,只改这一个数即可。
 */
export const CAMERA_FRAME_HALF_HEIGHT = 6.5;
/** [待调] 两人分开时画面左右各留的余量(格):越大越早开始后退。 */
export const CAMERA_FRAME_MARGIN_X = 5;
/** [待调] 取景半宽下限(格):两人贴身时也不少于它。 */
export const CAMERA_FRAME_HALF_WIDTH = 6;
/** [实测] 屏幕宽高比(脚本拿不到真实值,按常见客户端近似;与 HUD 反算共用)。 */
export const CAMERA_ASPECT = 16 / 9;

/** [待调] 机位距离下限(格):防贴脸 */
export const CAMERA_MIN_DISTANCE = 8;
/**
 * [待调] 机位距离上限(格)。房间是空维度,擂台 z=±4、准备台在 z≈20,
 * 上限取 18 可保证相机始终在场地净空内(屏障方块不可见,不挡视线)。
 */
export const CAMERA_MAX_DISTANCE = 18;

/**
 * [待调] 相机高度 = 双方中点 + 该偏移(格)。比人高 ⇒ 轻微俯视。
 */
export const CAMERA_HEIGHT_OFFSET = 2.4;

/**
 * [待调] 视线落点高度(格,基于双方中点):pitch 由几何算出(atan((相机高-落点)/R)),
 * 不再用固定俯角 —— 固定俯角在机位拉远后会"越看越偏下"。
 */
export const CAMERA_AIM_HEIGHT = 1.2;

/**
 * [实测] 目标位姿的指数平滑系数(0~1,越大跟得越紧;1 = 不平滑)。
 * 0.35 相当于时间常数约 3 tick:足以抹掉逐 tick 抖动,又不拖泥带水。
 */
export const CAMERA_SMOOTHING = 0.35;

/** [实测] 采样节流:每 N tick 发一次 setCamera。2 = 10Hz。 */
export const CAMERA_UPDATE_TICKS = 2;
/** [待调] 位置变化小于该阈值(格)就不发 setCamera,避免原地抖动。 */
export const CAMERA_POS_EPSILON = 0.04;
/**
 * [实测] 引擎缓动时长(秒)。**必须 ≈ 节流间隔**(2 tick = 0.1s):
 * 每次下发正好用这段时间走到新目标,引擎缓动首尾相接 ⇒ 连续匀速运镜。
 */
export const CAMERA_EASE_SECONDS = 0.1;

/**
 * [实测] **换局/开场**用的缓动时长(秒):目标直接吸附 + 引擎从当前相机状态
 * 平滑飞到新取景(KO 特写 → 侧视、第一人称 → 侧视都走这条)。
 * 参考 Collapse 的 GLIDE_TICKS 做法。
 */
export const CAMERA_ENTER_EASE_SECONDS = 0.5;

/** [待调] 基准 FOV(度):常规情况下恒定不变。 */
export const CAMERA_BASE_FOV = 62;
/** [待调] FOV 上下限(度)。仅在机位距离被上限夹住时才会往上走。 */
export const CAMERA_FOV_MIN = 50;
export const CAMERA_FOV_MAX = 80;
/** [实测] FOV 分段量化步长(度):1 度一档,防抖。 */
export const CAMERA_FOV_QUANTIZE = 1;
/** [实测] FOV 变化小于该值就不发 setFov。 */
export const CAMERA_FOV_EPSILON = 0.5;
/** [实测] FOV 缓动时长(秒)。 */
export const CAMERA_FOV_EASE_SECONDS = 0.25;

/** [待调] 相机允许的最低 y(防止穿到地板下方)。 */
export const CAMERA_MIN_Y = ARENA_FLOOR_Y + 0.8;

// ============================================================
// 八、HUD 节奏
// ============================================================

/** [已定] 每 4 tick 刷新一次 HUD。 */
export const HUD_REFRESH_TICKS = 4;
/** [实测] 标题 stay 必须 > 刷新间隔,否则会闪烁。 */
export const HUD_TITLE_STAY_TICKS = 12;
/** [待调] 血条字符宽度(满血时的字符数)。合并在一条文本里显示,别太长 */
export const HUD_HP_BAR_WIDTH = 12;
/** [待调] 气条字符宽度。 */
export const HUD_METER_BAR_WIDTH = 10;

// ============================================================
// 九、快捷栏标记物品
// ============================================================

/** slot 0 留空;slot 1~6 放这些原版物品做"技能按钮"。 */
export interface SkillItemDef {
  slot: SkillSlot;
  itemId: string;
  name: string;
}

export const SKILL_ITEMS: SkillItemDef[] = [
  { slot: 1, itemId: "minecraft:wooden_sword", name: "① 轻攻击" },
  { slot: 2, itemId: "minecraft:stone_sword", name: "② 中攻击" },
  { slot: 3, itemId: "minecraft:iron_sword", name: "③ 重攻击" },
  { slot: 4, itemId: "minecraft:lead", name: "④ 投技" },
  { slot: 5, itemId: "minecraft:snowball", name: "⑤ 发波" },
  { slot: 6, itemId: "minecraft:blaze_rod", name: "⑥ 大招" },
];

// ============================================================
// 十、清理 / 兜底
// ============================================================

/** [实测] 角色实体挂的 tag,清理时按 tag 扫描兜底(防止 match 对象丢了实体引用) */
export const FIGHTER_TAG = "bearcade:allstars_fighter";
/** [实测] 玩家身上的"对局中"tag */
export const PLAYER_TAG = "bearcade:allstars_in_match";
/** [实测] 实体扫描半径(格) */
export const ENTITY_CLEANUP_RADIUS = 48;
