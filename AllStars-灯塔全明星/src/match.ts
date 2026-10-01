// ============================================================
// Match:一个房间的一场对局(房间隔离,支持 8 房并存)
//
// 状态机:
//   select → intro → countdown → fight → roundEnd →(countdown | matchEnd)→ 结束回大厅
//
// 生命周期约定:
//   - 每局有递增 matchId / castId;清场后 matchId 失效,旧回调自然停摆
//     (所有 tick 先比对 this.matchId 与最新槽位,不一致就自杀);
//   - cleanup() 与 onBeforeReset 都必须**可重复执行**,见 §清理契约;
//   - 任何玩家/实体操作都 try/catch + isValid 兜底,单个玩家断线不能卡死房间。
// ============================================================

import {
  InputPermissionCategory,
  type Entity,
  type Player,
  type Vector3,
} from "@minecraft/server";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { stripSectionCodes } from "../../shared/minigame-core/text";
import {
  ARENA_AXIS,
  ARENA_CENTER,
  ARENA_START_HALF_DISTANCE,
  BACKSTAGE_ANCHOR_Y,
  BACKSTAGE_SPREAD,
  CAMERA_SIDE,
  ENTITY_CLEANUP_RADIUS,
  HIT_SHAKE_SECONDS,
  HUD_REFRESH_TICKS,
  INPUT_BUFFER_TICKS,
  INTRO_CAMERA_TICKS,
  INTRO_TICKS,
  KO_HITSTOP_TICKS,
  KO_PHASE_TICKS,
  KO_PHASE_SUPER_TICKS,
  KO_SHAKE_INTENSITY,
  KO_SHAKE_SECONDS,
  MATCH_END_TICKS,
  MAX_HP,
  ROUND_END_TICKS,
  ROUND_INTRO_TICKS,
  ROUND_TICKS,
  ROUNDS_TO_WIN_MATCH,
  SELECT_TIMEOUT_TICKS,
  SKILLS,
  SUPER_3_FINISH_LOW,
  SUPER_3_FINISH_NORMAL,
  SUPER_3_LOW_HEALTH_RATIO,
  SUPER_3_PAIR_REACH,
  SUPER_3_CONFIRM_AUTHOR_TICK,
  SUPER_3_CONFIRM_GUARD_BREAK_AUTHOR_TICKS,
  SUPER_3_STARTUP_INVULNERABILITY_TICKS,
  SUPER_3_TELEPORT_START_AUTHOR_TICKS,
  SUPER_3_OPENING_BEATS,
  SUPER_3_PURSUIT_RATE,
  SUPER_3_PURSUIT_SPEED,
  SUPER_FREEZE_SHAKE,
  VFX_PROJECTILE_SPEED,
  VFX_PROJECTILE_RANGE,
  WAVE_HIT_RANGE,
  WAVE_HIT_SWEEP_BUFFER,
  WAVE_HIT_VERTICAL_TOLERANCE,
  THROW_IMPACT_GAME_TICKS,
  SUPER_FREEZE_TICKS,
  SUPER_FREEZE_TIERS,
} from "./combat-config";
import type { SkillSlot, SuperTier } from "./combat-config";
import { SideCamera, lastCameraPose } from "./camera";
import {
  despawnAllProps,
  despawnProp,
  dismissProp,
  advanceProps,
  bodyPoint,
  handPoint,
  moveProp,
  spawnCommandBlock,
  spawnCommandCage,
  spawnPearl,
  spawnProp,
} from "./props";
import { Fighter, type HitInfo } from "./fighter";
import * as hud from "./hud";
import {
  consumeSkillPress,
  deriveIntent,
  emptyIntent,
  forgetCage,
  pollSkillPress,
  probeTick,
  pullBackToCage,
  superTierForIntent,
  resetSkillSlot,
  setupCage,
  setupSkillHotbar,
  clearSkillHotbar,
  clearSkillPresses,
  teardownCage,
  type Facing,
  type Intent,
} from "./input";
import {
  fallbackResult,
  findCharacter,
  openSelectForm,
  type SelectResult,
} from "./select";
import { currentTick } from "./tick";
import victoryScenes from "./data/victory-scenes.json";
import super3Scenes from "./data/super3-scenes.json";
import { scenePointToWorld } from "./scene-space";
import { CHUNYE_SUPER_3_DAMAGE } from "./data/chunye.damage";
import { currentClip, clipElapsed, clipFinished, clipGameTicks, seekClip, setBodyOpacity, setPresentationHidden } from "./anim";
import { CHUNYE_ENTITY_ID, CHUNYE_CLIPS } from "./data/chunye.clips";
import {
  applyHitPresentation,
  applyKoBurst,
  koCameraFrame,
  applyTeleportBurst,
  applyKoFlash,
  applyProjectileBurst,
  applyLeafMobilityTrail,
  applySuperCastBurst,
  applySuperFreezeAura,
  applySuperFreezeFlash,
  applySuperHitBurst,
  applyWaveClash,
  resetVfxThrottle,
} from "./fx";

export type MatchPhase =
  | "select"
  | "intro"
  | "countdown"
  | "fight"
  | "ko"
  | "roundEnd"
  | "matchEnd"
  | "finished";

/** roomId → 当前对局(新局覆盖旧局,旧局的 tick 会因 matchId 不符自杀) */
const matches = new Map<number, Match>();
let matchIdCounter = 0;

export function activeMatchCount(): number {
  return matches.size;
}

export function getMatch(roomId: number): Match | undefined {
  return matches.get(roomId);
}

/** 清掉某房间的对局条目(J 清理契约的一部分;可重复调用) */
export function dropMatch(roomId: number): void {
  matches.delete(roomId);
}

interface PlayerSlot {
  player: Player;
  side: 0 | 1;
  facing: Facing;
  anchor: Vector3;
  yaw: number;
  selection?: SelectResult;
}

/** 三气分段演出的时间线(双方共用同一个动作时钟) */
interface Super3Plan {
  castId: number;
  caster: Fighter;
  victim: Fighter;
  variant: "normal" | "low";
  time: number;
  stage: number;
  hits: number;
  damageDealt: number;
  /** 首拳捕获时锁定的八次伤害，演出时钟与剩余 HP 不改变该补正。 */
  damageHits?: readonly number[];
  victimHpAtConfirm?: number;
  origin: number;
  pairOrigin: number;
  facing: number;
  openingHidden?: boolean;
}

interface ThrowPairPlan {
  caster: Fighter;
  victim: Fighter;
  /** 捕获发生的游戏 tick；共享时钟从这里开始。 */
  capturedTick: number;
  /** 捕获时施放者 throw_cast 已播放的游戏 tick。 */
  casterElapsedAtCapture: number;
  /** 捕获时受击者 throw_victim 的起播偏移(游戏 tick)。 */
  victimStartOffset: number;
  /** 捕获后经过多少个可播放 tick 到达摔倒冲击。 */
  impactElapsed: number;
  /** 捕获后经过多少个可播放 tick 结束施放者收势。 */
  endElapsed: number;
  elapsed: number;
  struck: boolean;
  damage: number;
}

export interface MatchOptions {
  /** 递增的对局编号(用于日志与旧回调辨识) */
  matchId: number;
  /** 递增的 castId:每次真正开打 +1(换局/重开时刷新) */
  castId: number;
}

/**
 * 玩家**本体**的落脚点:后台小平台(擂台地板正下方)。
 *
 * 规格(2026-09-25):玩家原来的身体不许出现在场地里 —— 场地内只有前台角色
 * (自定义实体)。玩家看到的一切来自脚本下发的 free 侧视相机,与本体位置无关,
 * 所以本体可以藏在绝对看不见的地方:同维度、同常加载区,但在擂台地板底下。
 * 两个人横向错开 BACKSTAGE_SPREAD 格,避免两个隐身本体互相挤。
 */
function backstageAnchor(side: 0 | 1): Vector3 {
  const offset = (side === 0 ? -1 : 1) * BACKSTAGE_SPREAD;
  return ARENA_AXIS === "x"
    ? {
        x: ARENA_CENTER.x + offset,
        y: BACKSTAGE_ANCHOR_Y,
        z: ARENA_CENTER.z,
      }
    : {
        x: ARENA_CENTER.x,
        y: BACKSTAGE_ANCHOR_Y,
        z: ARENA_CENTER.z + offset,
      };
}

/**
 * 把玩家编号映射到站位。
 * 位置 0(靠 -轴一侧)面朝 +轴;位置 1 面朝 -轴。双方镜像对称。
 * 注意 anchor 是**后台**落脚点(不在场地内),擂台上的位置由前台实体自己站。
 */
function buildSlots(players: Player[]): PlayerSlot[] {
  return players.slice(0, 2).map((player, index) => {
    const side: 0 | 1 = index === 0 ? 0 : 1;
    const facing: Facing = side === 0 ? 1 : -1;
    const anchor = backstageAnchor(side);
    // 本体在后台且隐身,朝向只影响"给自己看的"画面;仍按朝对手处理。
    // ⚠️ MC 约定 yaw 0 = +Z、90 = **-X**、-90 = **+X** ⇒ 朝 +x(facing=1)要用 -90。
    const yaw =
      ARENA_AXIS === "x" ? (facing === 1 ? -90 : 90) : facing === 1 ? 0 : 180;
    return { player, side, facing, anchor, yaw };
  });
}

export class Match {
  readonly roomId: number;
  readonly matchId: number;
  readonly runtime: MinigameRuntime;
  castId: number;

  phase: MatchPhase = "select";

  private readonly slots: PlayerSlot[];
  private readonly cameras = new Map<string, SideCamera>();
  private fighters: [Fighter, Fighter] | undefined;

  /** 比分[side0, side1] */
  private score: [number, number] = [0, 0];
  private round = 0;
  private phaseUntilTick = 0;
  private selectDeadlineTick = 0;
  private readonly selectInFlight = new Set<string>();
  private lastHudTick = -999;
  private ending = false;
  private cleaned = false;

  // ---- M2-a ① 一二气释放时停窗口(逻辑层 + 输入层,非 /tick freeze) ----
  /**
   * 时停窗口。窗口内:
   *   - side 一侧的对手 → 喂 emptyIntent(冻结其格斗逻辑时钟)+ 每 tick clearVelocity
   *     + Movement 输入权限关闭;
   *   - 施法者不受影响(资产语义:auraClock 在战斗逻辑暂停期间独立推进)。
   * castId 用于防旧回调清新局(与全局 matchId 自杀模式一致)。
   */
  private superFreeze?: {
    castId: number;
    /** 被定住的那一侧(永远是施法者的对手) */
    side: 0 | 1;
    untilTick: number;
    casterSide?: 0 | 1;
    tier?: 1 | 2 | 3;
    lastAuraTick?: number;
  };

  // ---- M2-a ② 三气分段演出时间线 ----
  private super3?: Super3Plan;
  private waves: {
    caster: Fighter;
    victim: Fighter;
    released: boolean;
    axis: number;
    height: number;
    facing: number;
    distance: number;
    /** 对向波存在时，粒子寿命提前截到预测相遇点。 */
    particleRange?: number;
  }[]=[];
  private throwPair?: ThrowPairPlan;
  private super2?: { caster: Fighter; victim: Fighter; struck: boolean; damage: number };
  private pearlReturn?: {caster: Fighter; axis: number; atTick: number};
  private koSlowRemaining = 0;
  private koDownStarted = false;
  private koDisplayAtTick = 0;
  private koDisplayed = false;

  // ---- M2-a ③ KO 慢放 + 特写运镜 ----
  private koWinnerSide?: 0 | 1;
  private koUntilTick = 0;

  // ---- M2-c-1 招式输入缓冲 ----
  /**
   * 玩家 id → 忙碌期按下、等待硬直结束起手的技能键。
   * 只保留最新一次按键(覆盖写);`useSkill` 因非 busy 原因被拒(防御中/空中-only)时不写。
   */
  private readonly inputBuffer = new Map<
    string,
    { slot: SkillSlot; tick: number; superTier?: SuperTier }
  >();

  /** 快捷栏复位日志节流(player id → 上次打印 tick;调试开关打开时才用) */

  /** 本局是否是"开局"(第一局):是则播开场动画 + 近景运镜 */
  private cinematicIntro = false;
  /** 开场运镜当前展示的是哪一侧(-1 = 还没开始) */
  private introSegment = -1;
  private fightSignalUntilTick = 0;

  // ---- 道具(末影珍珠 / 命令方块):纯表现,规格见 src/props.ts 顶部注释 ----
  /** 开场运镜时角色手里那颗珍珠(每段一个) */
  private introProp?: Entity;
  /** HUD 的透明跟随锚点; TextPrimitive 绑定到它,避免直接重定位文字产生抖动。 */
  private hudAnchor?: Entity;
  private hudAnchorUpdatedTick = -Infinity;
  private sceneProps = new Map<string, Entity>();
  private previousVisual = new Map<Fighter,{visible:boolean; at:Vector3}>();
  private presentationDelta=1;
  private victoryOrigins = new Map<Fighter, {axis:number; facing:number}>();
  private resultsWinnerSide?: 0 | 1;
  private victoryCameraShot = "";
  private hudPresentationHidden = false;
  /** 两侧的短时战斗提示(拆投/防御/破防)，由 HUD 画在对应一侧。 */
  private hudFeedback: [
    { text: string; until: number } | undefined,
    { text: string; until: number } | undefined,
  ] = [undefined, undefined];
  /** 三气镜头最近一次硬切的镜头段，避免每 tick 重置相机。 */
  private super3CameraShot = "";
  private super1CameraCaster?: Fighter;
  private super1CameraEnterUntilTick = 0;

  /** 本 tick 开始前的回合时钟状态，用来让同 tick 起播的演出也不消耗秒数。 */
  private roundClockWasPaused = false;

  /** 命中定帧窗口(相机时钟一起停) */
  private hitstopUntilTick = 0;
  /** 最近一次命中的招式槽位(KO 演出按时长分档用) */
  private lastHitSkill?: SkillSlot;

  constructor(
    runtime: MinigameRuntime,
    roomId: number,
    players: Player[],
    options: MatchOptions,
  ) {
    this.runtime = runtime;
    this.roomId = roomId;
    this.matchId = options.matchId;
    this.castId = options.castId;
    this.slots = buildSlots(players);
  }

  // ================= 启动 =================

  /**
   * 进入选人阶段:搭笼(后台)、隐身、摆快捷栏、下发预览相机、弹表单。
   *
   * ⚠ 玩家本体在**后台**(擂台地板下的平台,规格:本体不出现在场地里),
   *   所以选人阶段就得把相机切到擂台的固定取景,否则玩家看到的是后台小房间。
   */
  start(): void {
    this.phase = "select";
    this.round = 0;
    this.score = [0, 0];
    this.fighters = undefined;
    this.ending = false;
    this.cleaned = false;
    // M2-c-1 入场即清空缓冲,避免上一场的残留按键进场
    this.inputBuffer.clear();
    this.selectDeadlineTick = currentTick() + SELECT_TIMEOUT_TICKS;
    this.ensureCameras();

    for (const slot of this.slots) {
      const { player } = slot;
      try {
        setupCage(player, slot.anchor, slot.yaw);
        setupSkillHotbar(player);
      } catch (error) {
        this.log(`玩家 ${player.name} 控制笼初始化失败`, error);
      }
      try {
        player.sendMessage(
          "§6【灯塔全明星对决】§a请选择角色(默认「春叶」)。选人完成后自动开局。",
        );
      } catch {
        // 忽略
      }
      this.promptSelect(slot);
    }
    this.previewCameras();
    this.broadcast("§7选人阶段…(超时将按默认角色开始)");
  }

  /** 建立本房两台侧视相机(幂等:选人阶段就建好,换局复用同一对象保留平滑状态) */
  private ensureCameras(): void {
    for (const slot of this.slots) {
      if (this.cameras.has(slot.player.id)) continue;
      try {
        this.cameras.set(
          slot.player.id,
          new SideCamera(slot.player, { axis: ARENA_AXIS }),
        );
      } catch {
        // 单玩家失败不影响另一人
      }
    }
  }

  /** 选人/准备阶段的固定取景(还没有前台角色) */
  private previewCameras(): void {
    for (const camera of this.cameras.values()) {
      try {
        camera.preview();
      } catch {
        // 忽略
      }
    }
  }

  private promptSelect(slot: PlayerSlot): void {
    if (this.selectInFlight.has(slot.player.id)) return;
    this.selectInFlight.add(slot.player.id);
    void openSelectForm(slot.player)
      .then((result) => {
        this.selectInFlight.delete(slot.player.id);
        if (this.phase !== "select") return;
        slot.selection = result ?? fallbackResult(slot.player);
      })
      .catch((error) => {
        this.selectInFlight.delete(slot.player.id);
        if (this.phase !== "select") return;
        slot.selection = fallbackResult(slot.player);
        this.log("选人结果异常,按默认角色继续", error);
      });
  }

  private allSelected(): boolean {
    return (
      this.slots.length === 2 &&
      this.slots.every((slot) => slot.selection !== undefined)
    );
  }

  private fillMissingSelections(): void {
    for (const slot of this.slots) {
      if (!slot.selection) slot.selection = fallbackResult(slot.player);
    }
  }

  // ================= 每 tick 推进 =================

  tick(): void {
    try {
      // 玩家掉线/离开:交给 runtime 结束对局,这里只做安全停摆
      if (this.liveSlotCount() < 2 && this.phase !== "finished") {
        this.log("对局中玩家不足,请求结束");
        this.finishMatch("玩家离开");
        return;
      }

      // One playback clock per actor, including intro/results and both sides of release freeze.
      const phaseAtTickStart = this.phase;
      this.roundClockWasPaused = this.isRoundClockPaused();
      const frozen = this.superFreeze !== undefined && currentTick() < this.superFreeze.untilTick;
      const slow = this.phase === "ko" && this.koSlowRemaining > 0;
      const victoryTravel = this.phase === "matchEnd" && this.fighters?.some(f =>
        currentClip(f.entity) === "victory_match" && clipElapsed(f.entity)*3 >= 124 && clipElapsed(f.entity)*3 < 220);
      const rate = slow ? 0.1 : victoryTravel ? 0.65 : 1;
      const delta = frozen || this.fighters?.some(f => f.inHitstop) ? 0 : rate;
      this.presentationDelta=delta;
      if (delta<1) for (const buffered of this.inputBuffer.values()) buffered.tick+=1-delta;
      if (this.fighters) advanceProps(this.fighters[0].dimension.id, delta);
      for (const fighter of this.fighters ?? []) fighter.advancePresentation(frozen, rate);
      if (victoryTravel) this.phaseUntilTick += 1-delta;
      if (slow && delta > 0) this.koSlowRemaining = Math.max(0, this.koSlowRemaining - delta);
      if (this.super3) {
        const p=this.super3;
        let remaining=delta*3;
        if (p.stage===0) {
          // Spend a tick across beat boundaries without skipping frames or adding holds.
          for (const beat of SUPER_3_OPENING_BEATS) {
            if (p.time>=beat.end) continue;
            const spent=Math.min(remaining,(beat.end-p.time)/beat.rate);
            p.time=Math.min(beat.end,p.time+spent*beat.rate);
            remaining=Math.max(0,remaining-spent);
          }
          p.time=Math.min(SUPER_3_CONFIRM_AUTHOR_TICK,p.time+remaining*SUPER_3_PURSUIT_RATE);
        } else p.time+=remaining;
      }
      if (this.phase !== "fight") {
        for (const slot of this.slots) {
          consumeSkillPress(slot.player.id);
          pollSkillPress(slot.player); // Also discard fallback input on the last countdown tick.
        }
        this.inputBuffer.clear();
      }
      if (this.pearlReturn && currentTick() >= this.pearlReturn.atTick) {
        const pending = this.pearlReturn;
        this.pearlReturn = undefined;
        if (pending.caster.hp > 0 && this.phase === "fight") pending.caster.returnToPearl(pending.axis);
      }
      switch (this.phase) {
        case "select":
          this.tickSelect();
          break;
        case "intro":
          this.tickIntro();
          break;
        case "countdown":
          this.tickCountdown();
          break;
        case "fight":
          this.tickFight();
          break;
        case "ko":
          this.tickKo();
          break;
        case "roundEnd":
          this.tickRoundEnd();
          break;
        case "matchEnd":
          this.tickMatchEnd();
          break;
        case "finished":
          break;
      }

      // 回合秒表只在可正常行动的战斗时钟上走。演出可能在本 tick 的
      // 技能轮询中刚刚建立，因此同时检查 tick 开始和结束两个状态。
      if (
        phaseAtTickStart === "fight" &&
        this.phase === "fight" &&
        (this.roundClockWasPaused || this.isRoundClockPaused())
      ) {
        this.roundStartTick++;
      }

      // HUD 锚点每 tick 跟随相机的中点/中垂线目标，文字本身只需更新内容。
      // 这一步放在所有 phase 的相机更新之后，确保附着实体与画面构图同钟。
      this.tickSceneProps();
      if (this.phase === "roundEnd" || this.phase === "matchEnd") this.updateVictoryCamera();
      this.hudAnchorUpdatedTick = -Infinity;
      this.updateHudAnchor();
      if (this.phase === "ko") this.pushHud("§cK.O.",0);
      if (this.phase === "roundEnd" || this.phase === "matchEnd") this.pushHud("§6胜利");
      hud.refreshSeatMarkers(this.slots.map(s=>s.player), this.fighters ?? []);
    } catch (error) {
      // 单 tick 异常不能卡死对局:记录后继续,下一 tick 再试
      this.log("tick 异常", error);
    } finally {
      // Slot return must also run when presentation fails, in every match phase.
      this.pinHotbarToEmptySlot();
    }
  }

  /** Deferred retries run even when the server already reports slot zero. */
  private pinHotbarToEmptySlot(): void {
    for (const slot of this.slots) {
      try {
        resetSkillSlot(slot.player, message => this.runtime.dbg(`room${this.roomId} ${slot.player.name} ${message}`));
      } catch {
        // 单玩家失败不影响另一人
      }
    }
  }

  private liveSlotCount(): number {
    let count = 0;
    for (const slot of this.slots) {
      try {
        if (slot.player.isValid) count++;
      } catch {
        // 忽略
      }
    }
    return count;
  }

  private tickSelect(): void {
    // 笼子 + 输入探针 + 预览相机(玩家本体在后台,画面全靠相机)
    for (const slot of this.slots) {
      this.holdPlayer(slot);
      probeTick(slot.player, slot.facing, (message) => this.runtime.dbg(message));
    }
    this.previewCameras();
    this.pushHud("§e选人中");

    if (this.allSelected()) {
      this.beginIntro();
      return;
    }
    if (currentTick() >= this.selectDeadlineTick) {
      this.broadcast("§e选人超时,按默认角色开始");
      this.fillMissingSelections();
      this.beginIntro();
    }
  }

  private beginIntro(): void {
    this.castId++;
    this.round = 0;
    this.score = [0, 0];
    const dim = this.runtime.roomDim(this.roomId);
    const half = ARENA_START_HALF_DISTANCE;

    const built = this.slots.map((slot) => {
      const character = findCharacter(
        slot.selection?.characterId ?? "chunye",
      );
      const name = character?.name ?? "春叶";
      const fighter = new Fighter(
        dim,
        slot.player,
        slot.side,
        slot.facing,
        name,
        -half * slot.facing,
      );
      return fighter;
    });

    const [f0, f1] = built;
    if (!f0 || !f1 || !f0.spawn() || !f1.spawn()) {
      this.broadcast("§c角色实体生成失败,本局结束");
      this.log("角色实体生成失败", undefined);
      this.finishMatch("角色生成失败");
      return;
    }
    this.fighters = [f0, f1];

    // 相机在选人阶段就建好了(这里只做幂等兜底,换局复用同一对象)
    this.ensureCameras();

    this.round = 1;
    this.setupRound();
  }

  /** 开一局:复位双方、播 intro、进 intro 阶段 */
  private setupRound(): void {
    const fighters = this.fighters;
    if (!fighters) return;
    // 上一局遗留的演出/时停/KO 状态必须清干净(否则新局的输入锁会串味)
    this.clearPresentationState();
    // M2-c-1 换局不继承上一局的缓冲按键
    this.inputBuffer.clear();
    const half = ARENA_START_HALF_DISTANCE;
    const now = currentTick();
    fighters[0].resetForRound(-half, this.round > 1);
    fighters[1].resetForRound(half, this.round > 1);
    // 只有**第一局**播开场动画 + 近景运镜;后续换局直接进"准备"
    // (否则每局都要等 6.5 秒的运镜)。
    // ★开场动画在**各自的特写段开始时**才播(见 updateIntroCameras):
    //   两人同时起播的话,第二段特写时那个人早就演完了,看起来像"开场动画没加载"。
    this.cinematicIntro = this.round === 1;
    this.introSegment = -1;
    this.fightSignalUntilTick = 0;
    this.phase = "intro";
    this.phaseUntilTick =
      now + (this.cinematicIntro ? INTRO_TICKS : ROUND_INTRO_TICKS);
    this.broadcast(
      `§6第 ${this.round} 局§e 准备…(${this.score[0]} : ${this.score[1]})`,
    );
    for (const camera of this.cameras.values()) {
      try {
        // 开场:先让相机定位(之后 tickIntro 会接管成特写)
        camera.update([fighters[0], fighters[1]], { force: true });
      } catch {
        // 忽略
      }
    }
    if (!this.cinematicIntro) this.beginCountdown(now);
  }

  private tickIntro(): void {
    for (const slot of this.slots) this.holdPlayer(slot);
    const fighters = this.fighters;
    const now = currentTick();
    this.tickPresentation();
    if (now >= this.phaseUntilTick) {
      this.beginCountdown(now);
      this.tickCountdown();
      return;
    }
    if (this.cinematicIntro && fighters) {
      // 开局:近景运镜 + "谁操控谁"标注
      this.updateIntroCameras(fighters, now);
    } else {
      this.updateCameras();
    }
    this.pushHud(
      this.cinematicIntro ? this.introCastLine() : `§6第 ${this.round} 局 · 准备`,
      this.phaseUntilTick - now,
      fighters,
    );
  }

  private beginCountdown(now: number): void {
    this.phase = "countdown";
    this.phaseUntilTick = now + ROUND_INTRO_TICKS;
    this.lastHudTick = -Infinity;
    this.despawnIntroProp();
    // 倒计时期间回到双方同框机位，倒计时结束才接受战斗输入。
    for (const camera of this.cameras.values()) {
      try { camera.invalidate(); } catch { /* player left */ }
    }
  }

  private tickCountdown(): void {
    for (const slot of this.slots) this.holdPlayer(slot);
    this.tickPresentation();
    this.updateCameras();
    const now = currentTick();
    const remaining = this.phaseUntilTick - now;
    if (remaining <= 0) {
      this.phase = "fight";
      this.roundStartTick = now;
      this.fightSignalUntilTick = now + 12;
      this.lastHudTick = -Infinity;
      this.pushHud("§a开打!", ROUND_TICKS);
      this.broadcast("§a开打!");
      return;
    }
    this.pushHud(`§6第 ${this.round} 局 · ${Math.ceil(remaining / 20)}`, ROUND_TICKS);
  }

  /**
   * 开局近景运镜:依次给两名角色特写(每人 INTRO_CAMERA_TICKS)。
   * 换人时 `invalidate()` 让相机用长缓动滑过去;HUD 文案同步切换成"谁操控谁"。
   */
  private updateIntroCameras(fighters: [Fighter, Fighter], now: number): void {
    const remain = Math.max(0, this.phaseUntilTick - now);
    const elapsed = Math.max(0, INTRO_TICKS - remain);
    const segment = elapsed < INTRO_CAMERA_TICKS ? 0 : 1;
    if (segment !== this.introSegment) {
      this.introSegment = segment;
      // ★换人:让这一位**现在**开始播自己的开场动画(intro,3.3s)。
      //   两人同时起播的话,轮到第二段特写时他的动画早演完了 —— 实机看起来
      //   就是"开场动画没加载"(只剩一个静止姿势)。
      try {
        fighters[segment]?.playIntro(now);
      } catch {
        // 单个角色失败不影响运镜
      }
      // 道具:源资产 intro.pearlGather —— 珍珠在双手中生成,末段移到右手并收进
      this.despawnIntroProp();
      try {
        const performer = fighters[segment];
        if (performer) {
          this.introProp = spawnPearl(
            performer.dimension,
            this.handOf(performer, "mid"),
          );
        }
      } catch {
        // 道具失败不影响运镜
      }
      this.runtime.dbg(
        `room${this.roomId} 开场运镜 ${segment + 1}/2 → ${fighters[segment]?.name}` +
          `(由 ${stripSectionCodes(this.slots[segment]?.player.name ?? "?")} 操控)`,
      );
      for (const camera of this.cameras.values()) {
        try {
          camera.invalidate();
        } catch {
          // 忽略
        }
      }
    }
    const progress = (elapsed % INTRO_CAMERA_TICKS) / INTRO_CAMERA_TICKS;
    const target = fighters[segment];
    if (!target) return;
    // 珍珠跟随双手;末段(源 intro pearlGather 156-180 制作tick ≈ 段内最后 20%)
    // 从双手之间移向右手并收进 —— 对应"聚珠→收珠"的收尾。
    if (progress >= 180 / 198) this.despawnIntroProp();
    const pearl = this.introProp;
    if (pearl) {
      try {
        const mid = this.handOf(target, "mid");
        if (progress > 0.78) {
          const right = this.handOf(target, "right");
          const t = Math.min(1, (progress - 0.78) / 0.2);
          moveProp(
            pearl,
            {
              x: mid.x + (right.x - mid.x) * t,
              y: mid.y + (right.y - mid.y) * t,
              z: mid.z + (right.z - mid.z) * t,
            },
            { x: 0, y: (target.entity?.getRotation().y ?? 0) + 90 },
          );
        } else {
          // 珍珠模型的长轴与春叶手势相差 90°，开场始终校正到正确朝向。
          moveProp(pearl, mid, { x: 0, y: (target.entity?.getRotation().y ?? 0) + 90 });
        }
      } catch {
        // 忽略
      }
    }
    for (const camera of this.cameras.values()) {
      try {
          camera.introCloseUp(target.location, progress, target.facing);
      } catch {
        // 单玩家相机失败不影响对局
      }
    }
  }

  /** 开场 HUD 文案:当前镜头里的角色由**谁**操控 */
  private introCastLine(): string {
    const side = this.introSegment === 1 ? 1 : 0;
    const slot = this.slots[side];
    const fighter = this.fighters?.[side];
    if (!slot || !fighter) return "§6开场";
    const who = stripSectionCodes(slot.player.name);
    const seat = side === 0 ? "§b1P" : "§c2P";
    return `${seat} §f${who}§r 操控「${fighter.name}」`;
  }

  private roundStartTick = 0;

  /**
   * 回合倒计时暂停条件。普通攻击动画仍消耗回合时间；完整的超必、投技
   * 配对、释放时停、命中定帧以及三气分段演出都使用独立的表现时钟，不能
   * 让 99 秒回合倒计时在镜头演出中继续减少。
   */
  private isRoundClockPaused(): boolean {
    if (this.phase !== "fight") return false;
    if (this.superFreeze || this.super2 || this.super3 || this.throwPair) return true;
    if (this.hitstopUntilTick > currentTick()) return true;
    if (this.fighters?.some((fighter) => fighter.inHitstop)) return true;
    for (const fighter of this.fighters ?? []) {
      const clip = currentClip(fighter.entity);
      if (
        clip?.startsWith("super_1") ||
        clip?.startsWith("super_2") ||
        // 拼接避免动画审计把前缀 super_3 当成一个独立资源名。
        clip?.startsWith("super_" + "3") ||
        clip === "throw_victim" ||
        clip === "throw_cast" ||
        clip === "throw_whiff" ||
        clip === "throw_tech_cast" ||
        clip === "throw_tech_victim"
      ) {
        return true;
      }
    }
    return false;
  }

  private tickFight(): void {
    const fighters = this.fighters;
    if (!fighters) return;

    // 三气的输入阶段在读取本 tick 意图前更新一次，保证 69/114 作者 tick
    // 的解锁/重新锁定不会晚一帧。
    this.syncSuper3InputPermission();
    const intents: [Intent,Intent]=[this.intentFor(0),this.intentFor(1)];
    for (const fighter of fighters) fighter.prepareInput(intents[fighter.side]);

    // 首拳确认留到敌方已有攻击结算之后，不能先捕获并清掉对方的有效招式。
    this.tickSuper3(true);
    this.tickSuper2();
    this.tickThrowPair();
    if(this.phase === "fight") this.tickWaves();
    // 0a) 释放时停窗口:每 tick 清掉对手剩余动量 + 到点恢复权限
    this.tickSuperFreeze();
    if (this.superFreeze && currentTick() >= this.superFreeze.untilTick) {
      this.endSuperFreeze();
    }
    // 0c) 道具跟踪(珍珠贴在手上 / 抛向目标),到点自动收掉

    // 0b) M2-c-1 输入缓冲:硬直在上一个 tick 结束时,这一 tick 立刻替玩家起手。
    //     必须早于技能槽轮询,否则同 tick 的新按键会先被消费掉。
    this.consumeInputBuffer();

    // 1) 玩家笼 + 技能槽轮询
    for (const slot of this.slots) {
      this.holdPlayer(slot);
      probeTick(slot.player, slot.facing, (message) => this.runtime.dbg(message));
      // 边缘触发:优先用 hotbar 选中变化事件,事件不可用时退回"槽位变化"轮询。
      // 同一格持续按住只算一次(旧实现每 tick 读一次就把同一格当成连按)。
      // 槽位复位统一放在 tick() 末尾(所有阶段都生效),不在这里做。
      const intent = intents[slot.side];
      const facing=fighters[slot.side].facing;
      const pressed = consumeSkillPress(slot.player.id) ?? pollSkillPress(slot.player, superTierForIntent(intent,facing));
      if (pressed === undefined) continue;
      // 规格要求:一旦切到非 0 格就释放技能
      const skill = pressed.slot as SkillSlot;
      const superTier = skill === 6 ? pressed.superTier === undefined ? superTierForIntent(intent,facing)
        : superTierForIntent({crouch:pressed.superTier===3,jump:pressed.superTier===2,horizontal:pressed.superHorizontal},facing) : undefined;
      // W+7 is a super command. Even an insufficient-meter rejection must not
      // turn that same command into a jump during locomotion later in this tick.
      if (skill === 6) intent.jump = false;
      const thrown=this.throwPair;
      if(skill===4 && thrown?.victim.side===slot.side && !thrown.struck && currentTick()-thrown.capturedTick<2) {
        thrown.caster.setPerforming(false);thrown.victim.setPerforming(false);
        thrown.caster.resolveThrowTech(thrown.victim,currentTick());
        // 后按投技的一方是拆投者；聊天栏明确记录双方席位，避免 HUD
        // 在镜头切换或 TextPrimitive 刷新时被错过。
        this.announceThrowTech(thrown.victim, thrown.caster);
        thrown.caster.consumeThrowTechPartner();
        this.throwPair=undefined;continue;
      }
      // 被时停定住的一侧:快捷栏不在 InputPermissionCategory 的闸门内,
      // 必须在这里显式拦住,否则"被定住"的对手还能从格子里搓出招来。
      if (this.isSuperFrozen(slot.side)) continue;
      if (this.super2 || this.super3InputLocked(slot.side)) continue;
      const fighter = fighters[slot.side];
      const ok = fighter.useSkill(skill, superTier);
      if (ok) {
        // M2-c-1:起手成功 → 清掉该玩家尚未消费的缓冲键(新招式已接管)
        this.inputBuffer.delete(slot.player.id);
        this.announceSkill(slot, skill);
      } else if (fighter.isBusy || (skill===5 && fighter.leafCooldownRemaining>0 && fighter.leafCooldownRemaining<=INPUT_BUFFER_TICKS)) {
        // M2-c-1:忙碌期被拒的按键不再丢失,记进缓冲等硬直结束自动起手。
        // 只保留最新一次按键;非 busy 原因(防御中 / groundOnly / 无该 clip)
        // 的拒绝**不**写缓冲,否则硬直结束会冒出玩家早先的无效按键。
        this.inputBuffer.set(slot.player.id, {
          slot: skill,
          tick: currentTick(),
          superTier,
        });
      }
    }

    // 2) 角色推进
    const motionFrom = fighters.map(f => ({ ...f.location }));
    const order=fighters[1].resolvesBefore(fighters[0]) ? [fighters[1],fighters[0]] : fighters;
    for (const fighter of order) {
      if (this.isSuperFrozen(fighter.side)) continue;
      const hit=fighter.tick(intents[fighter.side],fighters[fighter.side===0?1:0],!this.super3InputLocked(fighter.side));
      if (hit) this.onHit(hit);
    }
    if (this.super3?.stage===0 && this.super3.time>=SUPER_3_TELEPORT_START_AUTHOR_TICKS) this.tickSuper3();
    for (const fighter of fighters) {
      const partner = fighter.consumeThrowTechPartner();
      if (partner) this.announceThrowTech(fighter, partner);
    }
    for (const fighter of fighters) applyLeafMobilityTrail(fighter, motionFrom[fighter.side]!);

    // 3) 相机 + HUD
    if (this.super3) this.updateSuper3Camera(this.super3);
    else this.updateCameras();
    const pausedThisTick = this.isRoundClockPaused();
    const elapsed = Math.max(
      0,
      currentTick() - this.roundStartTick - (pausedThisTick ? 1 : 0),
    );
    const remain = Math.max(0, ROUND_TICKS - elapsed);
    this.pushHud(`§6第 ${this.round} 局`, remain, fighters);

    // 4) 回合结束判定:KO 先进"慢放 + 特写"阶段,由 tickKo 到点再 endRound
    // 三气只有最后接触可把 HP 扣到 0；KO 阶段继续推进配对收尾。
    // Damage only reaches zero on the final super contact. Start KO at that
    // contact; tickKo keeps the paired animation alive through its recovery.
    if (fighters[0].hp <= 0 || fighters[1].hp <= 0) {
      const winnerSide: 0 | 1 = fighters[0].hp <= 0 ? 1 : 0;
      this.beginKo(winnerSide);
      return;
    }
    if (remain <= 0) {
      // 超时:血多者胜;相同则判平(算双方各不拿分,重打一局)
      if (fighters[0].hp === fighters[1].hp) {
        this.endRound(undefined, "时间到 · 平局");
      } else {
        const winnerSide = fighters[0].hp > fighters[1].hp ? 0 : 1;
        this.endRound(winnerSide, "时间到");
      }
    }
  }

  private intentFor(side: 0 | 1): Intent {
    const slot = this.slots[side];
    if (!slot) return emptyIntent();
    // 时停窗口:被定住的一侧喂空意图 = 它的格斗逻辑时钟暂停。
    // 施法者不受影响(气场时钟独立推进)。
    if (this.isSuperFrozen(side)) return emptyIntent();
    // 三气分段演出期间双方都定格(施法者在演、受击方在挨),走位会破坏配对构图
    if (this.super2 || this.super3InputLocked(side)) return emptyIntent();
    try {
      // 招式/硬直期间照常喂输入:Fighter 内部会忽略(锁输入在 Fighter 里)。
      // ★facing 用**角色当前的实际朝向**(会随左右关系自动转向),不是出生槽位 ——
      //   否则跳过对手后,"防御 = 背向对手"的判定方向会反。
      const facing = this.fighters?.[side]?.facing ?? slot.facing;
      return deriveIntent(slot.player, facing, ARENA_AXIS);
    } catch {
      return emptyIntent();
    }
  }

  // ================= M2-c-1 招式输入缓冲 =================

  /**
   * 消费缓冲:对每个"有缓冲键且已不忙碌"的玩家,替他在这一 tick 起手。
   *
   * 顺序无关正确性,但策略如下:
   *   1. 过期(now − buffered.tick > INPUT_BUFFER_TICKS)→ 直接丢弃,缓冲不会无限累积;
   *   2. 该侧被时停 / 三气演出进行中 → 保留,等演出结束那一 tick 再看(同样受 1 兜底);
   *   3. 仍在忙碌(isBusy)→ 保留,下一 tick 再看;
   *   4. 空闲 → 取出缓冲并 useSkill;失败静默丢弃(缓冲只保证"按键不丢",不保证必成)。
   *
   * `INPUT_BUFFER_TICKS = 0` 时:缓冲写入发生在轮询阶段(本方法之后),
   * 下一 tick 距离必然 ≥ 1 > 0 ⇒ 一定被过期规则丢弃,行为等价于改动前。
   */
  private consumeInputBuffer(): void {
    const fighters = this.fighters;
    if (!fighters || this.inputBuffer.size === 0) return;
    const now = currentTick();
    for (const slot of this.slots) {
      const buffered = this.inputBuffer.get(slot.player.id);
      if (!buffered) continue;
      if (now - buffered.tick > INPUT_BUFFER_TICKS) {
        this.inputBuffer.delete(slot.player.id);
        continue;
      }
      if (this.isSuperFrozen(slot.side)) continue;
      if (this.super2 || this.super3InputLocked(slot.side)) continue;
      const fighter = fighters[slot.side];
      if (fighter.isBusy) continue;
      if (buffered.slot===5 && fighter.leafCooldownRemaining>0) continue;
      this.inputBuffer.delete(slot.player.id);
      if (fighter.useSkill(buffered.slot, buffered.superTier)) {
        this.announceSkill(slot, buffered.slot);
      }
    }
  }

  /**
   * 一次"技能被接受"的播报 + 大招分派。
   * 技能槽直连路径与输入缓冲路径共用,保证两条路径的行为与日志完全一致。
   */
  private announceSkill(slot: PlayerSlot, skill: SkillSlot): void {
    const label = SKILLS[skill]?.label ?? `技能${skill}`;
    this.runtime.dbg(`room${this.roomId} ${slot.player.name} 释放 ${label}`);
    this.onSkillAccepted(slot.side, skill);
    // 叶流粒子:释放瞬间的表现(纯表现,内部整段 try/catch,失败不影响出招)
    this.applySkillVfx(slot.side, skill);
  }

  /**
   * 招式释放瞬间的粒子分派(slot 5 发波 / slot 6 大招)。
   * 放在"释放被接受"之后,所以不会出现"起了招却没粒子"的错位。
   */
  private applySkillVfx(side: 0 | 1, skill: SkillSlot): void {
    const fighters = this.fighters;
    if (!fighters) return;
    const caster = fighters[side];
    if (!caster) return;
    const opponent = fighters[side === 0 ? 1 : 0];
    if (skill === 5) {
      if(currentClip(caster.entity)==="special_leaf_burst") {
        this.waves=this.waves.filter(w=>w.caster!==caster||w.released);
        this.waves.push({
          caster,
          victim: opponent,
          released: false,
          axis: caster.axisPosition,
          height: caster.feetY,
          facing: caster.facing,
          distance: 0,
        });
        return;
      }
      // 升龙/俯冲在实际位移时持续发射，不复用站立水平波体。
      return;
    }
    if (skill === 6) applySuperCastBurst(caster, opponent);
  }

  // ================= M2-a ① 一二气释放时停 =================

  /** 技能释放被接受后的分派:一/二气 → 时停;三气 → 分段演出时间线 */
  private onSkillAccepted(side: 0 | 1, slot: SkillSlot): void {
    if (this.pearlReturn?.caster.side===side) this.pearlReturn=undefined;
    if (slot !== 6) return;
    const caster = this.fighters?.[side];
    if (!caster) return;
    const tier = caster.lastSuperTier;
    if (tier === undefined) return;
    // 道具(纯表现):一气/三气=珍珠,二气=命令方块(源资产 super_metadata)
    if (SUPER_FREEZE_TIERS.includes(tier)) {
      this.beginSuperFreeze(side);
      return;
    }
    if (tier === 3) this.beginSuper3(side, caster);
  }

  private isSuperFrozen(_side: 0 | 1): boolean {
    const freeze = this.superFreeze;
    return (
      freeze !== undefined &&
      currentTick() < freeze.untilTick
    );
  }

  /** 三气各阶段的输入闸门：只有抛珠后的瞬移追击窗口允许受击方操作。 */
  private super3InputLocked(side: 0 | 1): boolean {
    const p = this.super3;
    if (!p) return false;
    if (side === p.caster.side) return true;
    return p.stage > 0 ||
      p.time < SUPER_3_TELEPORT_START_AUTHOR_TICKS ||
      p.time >= SUPER_3_CONFIRM_AUTHOR_TICK;
  }

  /** 同步敌方 Movement 权限；快捷栏攻击还会在轮询闸门中单独拦截。 */
  private syncSuper3InputPermission(): void {
    const p = this.super3;
    if (!p) return;
    const victimSide = p.victim.side;
    const locked = this.super3InputLocked(victimSide);
    this.setSuper3OpeningHidden(p, p.stage === 0 && p.time < SUPER_3_TELEPORT_START_AUTHOR_TICKS);
    try {
      this.slots[victimSide]?.player.inputPermissions.setPermissionCategory(
        InputPermissionCategory.Movement,
        !locked,
      );
    } catch {
      // 玩家断线/权限对象暂时不可用时，逻辑闸门仍然生效。
    }
  }

  /** Only the opening close-up hides the opponent; paired hit reactions stay visible. */
  private setSuper3OpeningHidden(p: Super3Plan, hidden: boolean): void {
    if (!!p.openingHidden === hidden) return;
    p.openingHidden=hidden;
    setPresentationHidden(p.victim.entity, hidden);
    // This is a camera staging change, not the victim performing a pearl teleport.
    this.previousVisual.delete(p.victim);
  }

  /**
   * 开启时停窗口(一/二气)。
   * 只对**对手**生效:关 Movement 权限 + 每 tick clearVelocity + 喂空意图。
   * 施法者完全不动,可以继续走完自己的大招动画(auraClock 独立)。
   */
  private beginSuperFreeze(casterSide: 0 | 1): void {
    // 只在"当前没有开着的窗口"时开新窗:同一 tick 内双方同时放招也不会叠两个窗口;
    // 上一个窗口已经到点的话,新一发大招照常享受自己的时停。
    // (旧局残留由 castId 比对 + cleanup 兜底,不靠这里限制频率)
    if (this.superFreeze && currentTick() < this.superFreeze.untilTick) return;
    const opponentSide: 0 | 1 = casterSide === 0 ? 1 : 0;
    this.superFreeze = {
      castId: this.castId,
      side: opponentSide,
      untilTick: currentTick() + SUPER_FREEZE_TICKS,
      casterSide,
      tier: this.fighters?.[casterSide]?.lastSuperTier,
      lastAuraTick: currentTick(),
    };
    const opponentSlot = this.slots[opponentSide];
    try {
      opponentSlot?.player.inputPermissions.setPermissionCategory(
        InputPermissionCategory.Movement,
        false,
      );
    } catch (error) {
      this.log("时停:关闭对手移动权限失败", error);
    }
    const caster = this.fighters?.[casterSide];
    const opponent = this.fighters?.[opponentSide];
    if (caster) {
      try { applySuperFreezeAura(caster, opponent); } catch { /* 纯表现 */ }
    }
    this.applySuperFreezePresentation();
  }

  private applySuperFreezePresentation(): void {
    for (const slot of this.slots) {
      try {
        this.cameras
          .get(slot.player.id)
          ?.shake(SUPER_FREEZE_SHAKE, 0.2);
      } catch {
        // 震屏失败不影响逻辑
      }
      try {
        applySuperFreezeFlash(slot.player);
      } catch {
        // 白闪失败不影响逻辑
      }
    }
  }

  /**
   * 一次性收掉本局所有道具(珍珠/命令方块)。
   * 道具是纯表现,任何一条路径漏掉都可能留下一个"空中飘着的珍珠" —— 所以
   * 除了在各流程收尾时点名收掉,清场与换局也一律走 `despawnAllProps()` 兜底。
   */
  private despawnIntroProp(): void {
    dismissProp(this.introProp);
    this.introProp = undefined;
  }

  private despawnSuperProp(): void {
    for (const prop of this.sceneProps.values()) dismissProp(prop);
    this.sceneProps.clear();
    this.previousVisual.clear();
  }

  private handOf(fighter: Fighter, which: "right" | "left" | "mid"): Vector3 {
    return handPoint({location:fighter.location,facing:fighter.facing,entity:fighter.entity},which);
  }

  /**
   * 创建/更新 HUD 透明锚点。
   *
   * 锚点使用已有的 afterimage 实体并把 allstars_opacity 置零，因此不增加
   * 新模型或贴图。它位于相机正前方的屏幕中心；相机本身由两名角色的中点和
   * 中垂线计算，锚点复用同一几何目标并用指数平滑跟随。TextPrimitive 绑定
   * 到锚点后只改变相对偏移和文字，不再每次把四个字形瞬移到绝对坐标。
   */
  private updateHudAnchor(): Entity | undefined {
    const now = currentTick();
    if (this.hudAnchorUpdatedTick === now) return this.hudAnchor;
    this.hudAnchorUpdatedTick = now;
    const fighters = this.fighters;
    if (!fighters?.[0] || !fighters[1]) return undefined;
    const dimension = fighters[0].dimension;
    let anchor = this.hudAnchor;
    try {
      if (!anchor?.isValid) anchor = undefined;
    } catch {
      anchor = undefined;
    }
    if (!anchor) {
      const first = fighters[0].location;
      const second = fighters[1].location;
      const at = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2 + 1.2,
        z: (first.z + second.z) / 2,
      };
      anchor = spawnProp(dimension, "bearcade:allstars_afterimage", at);
      if (!anchor) return undefined;
      try {
        anchor.setProperty("bearcade:allstars_opacity", 0);
        anchor.setProperty("bearcade:allstars_clip", 44);
        anchor.setProperty("bearcade:allstars_time", 0);
      } catch {
        // 锚点是纯表现,属性失败仍可作为跟随实体使用
      }
      this.hudAnchor = anchor;
    }

    const pose = lastCameraPose(this.slots[0]?.player.id ?? "");
    let target: Vector3;
    if (pose) {
      target = hud.screenToWorld(pose, 0, 0);
    } else {
      const first = fighters[0].location;
      const second = fighters[1].location;
      target = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2 + 1.2,
        z: (first.z + second.z) / 2,
      };
    }
    // 相机本身已经在 SideCamera 内做了目标平滑；这里再做一层 0.32
    // 的指数平滑会让 HUD 落后于相机，尤其在大招硬切/KO 特写时看起来
    // 像血条乱飞。锚点直接绑定到同一个 screen-center 目标，字形再用
    // HUD 内固定的本地坐标排布，保证整组 HUD 一起移动而不互相漂移。
    moveProp(anchor, target);
    return anchor;
  }

  private despawnHudAnchor(): void {
    despawnProp(this.hudAnchor);
    this.hudAnchor = undefined;
    this.hudAnchorUpdatedTick = -Infinity;
  }

  /** Props share source time with bodies. Every room owns its complete desired set. */
  private tickSceneProps(): void {
    const desired=new Set<string>();
    const show=(key:string,fighter:Fighter,position:Vector3,cube=false) => {
      desired.add(key);
      let prop=this.sceneProps.get(key);
      if (!prop?.isValid) { prop=cube ? spawnCommandBlock(fighter.dimension,position) : spawnPearl(fighter.dimension,position); if(prop)this.sceneProps.set(key,prop); }
      moveProp(prop,position,cube ? {x:0,y:clipElapsed(fighter.entity)*4} : {x:0,y:0});
    };
    const worldPoint=(_f:Fighter,point:number[],origin:number,facing:number):Vector3 => {
      return scenePointToWorld(point,origin,facing);
    };
    for(const f of this.fighters ?? []) {
      if (!f.isOnStage) continue;
      const id=currentClip(f.entity),t=clipElapsed(f.entity)*3;
      if(id==="super_2" && t>=8 && t<124) show(`cube${f.side}`,f,this.handOf(f,"mid"),true);
      if(id==="super_1" && t>=5 && t<22) {
        show(`super1${f.side}`,f,f.super1PearlPoint());
      }
      if(id?.startsWith("leaf_") && !/^leaf_launch_/.test(id) && !id.endsWith("_hit") && !id.endsWith("_land") && !id.endsWith("_end")) {
        const span=id.endsWith("_loop") ? t%12 : t;
        const hand=this.handOf(f,"right");
        const u=Math.max(0,Math.min(1,(span-4)/6));
        if(ARENA_AXIS==="x")hand.x+=f.facing*u;else hand.z+=f.facing*u;
        hand.y+=(id.includes("rise")?.65:-.7)*u;
        show(`leaf${f.side}`,f,hand);
      }
      if(id==="victory_match" || id==="victory_match_idle") {
        let origin=this.victoryOrigins.get(f);
        if(!origin){origin={axis:f.axisPosition,facing:f.facing};this.victoryOrigins.set(f,origin);}
        const frame=victoryScenes[id==="victory_match_idle" ? victoryScenes.length-1 : Math.min(victoryScenes.length-1,Math.floor(t))]!;
        f.placeCinematic(frame.scene.anchor,frame.scene.yaw,origin.axis,origin.facing);
        setBodyOpacity(f.entity,frame.scene.visible ? 1 : 0);
        frame.pearls.forEach(p=>{if(p.kind!=="burst" && p.alpha>0.05)show(`victory${f.side}:${p.key}`,f,worldPoint(f,p.world,origin.axis,origin.facing));});
      }
    }
    // Only a confirmed super 2 capture creates the reference preview's command cage.
    const seal = this.super2;
    if (seal?.caster.isValid && seal.victim.isValid) {
      const time = clipElapsed(seal.caster.entity)*3;
      if (time >= 36 && time < 140) {
        const key = 'super2Cage';
        desired.add(key);
        let cage = this.sceneProps.get(key);
        if (!cage?.isValid) { cage = spawnCommandCage(seal.victim.dimension,seal.victim.location); if(cage)this.sceneProps.set(key,cage); }
        if (cage) {
          moveProp(cage,seal.victim.location,{x:0,y:(ARENA_AXIS==='x'?0:90)+(seal.caster.facing<0?180:0)});
          cage.setProperty('bearcade:cage_time',time/60);
        }
      }
    }
    const p=this.super3;
    if(p) {
      if(p.time>=31 && p.time<SUPER_3_TELEPORT_START_AUTHOR_TICKS)show('super3Gather',p.caster,this.handOf(p.caster,'right'));
      if(p.time>=SUPER_3_TELEPORT_START_AUTHOR_TICKS && p.time<222) {
        const u=(p.time-SUPER_3_TELEPORT_START_AUTHOR_TICKS)/153;
        const at=worldPoint(p.caster,[0,32*(1-u)+65*4*u*(1-u),-8*u],p.origin,p.facing);
        show('super3High',p.caster,at);
      }
      if(p.stage>0) {
        const frames=super3Scenes[p.variant],frame=frames[Math.min(frames.length-1,Math.max(0,Math.floor(p.time)-SUPER_3_CONFIRM_AUTHOR_TICK))]!;
        for(const pearl of frame.pearls)if(!pearl.burst)show(`scatter${pearl.index}`,p.caster,worldPoint(p.caster,pearl.world,p.pairOrigin,p.facing));
      }
    } else if(this.pearlReturn) {
      const r=this.pearlReturn,u=Math.max(0,Math.min(1,1-(r.atTick-currentTick())/51));
      show('returnPearl',r.caster,worldPoint(r.caster,[0,32*(1-u)+65*4*u*(1-u),0],r.axis,r.caster.facing));
    }
    for(const [key,entity] of this.sceneProps)if(!desired.has(key)){dismissProp(entity);this.sceneProps.delete(key);}
    for(const f of this.fighters ?? []) {
      if (!f.isOnStage) { this.previousVisual.delete(f); continue; }
      const visible=Number(f.entity?.getProperty("bearcade:allstars_opacity") ?? 1)>0;
      const prev=this.previousVisual.get(f);
      if (prev && prev.visible !== visible) {
        applyTeleportBurst(f,visible ? f.location : prev.at,visible ? "arrive" : "leave");
      }
      this.previousVisual.set(f,{visible,at:{...f.location}});
    }
  }

  /** 时停窗口每 tick 维持:清速度(ClearVelocity 只清动量,不冻结逻辑) */
  private tickSuperFreeze(): void {
    const freeze = this.superFreeze;
    if (!freeze) return;
    if (this.castId !== freeze.castId) {
      // 旧局的回调:直接丢弃,不碰新局权限
      this.superFreeze = undefined;
      return;
    }
    const opponent = this.fighters?.[freeze.side];
    if (!opponent) return;
    try {
      if (opponent.entity?.isValid) opponent.entity.clearVelocity();
    } catch {
      // 实体此刻无效:忽略
    }
    const caster = freeze.casterSide === undefined ? undefined : this.fighters?.[freeze.casterSide];
    if (caster && currentTick() - (freeze.lastAuraTick ?? -999) >= 2) {
      freeze.lastAuraTick = currentTick();
      try { applySuperFreezeAura(caster, opponent); } catch { /* 纯表现 */ }
    }
  }

  /** 结束时停窗口:恢复对手移动权限(**可重复执行**) */
  private endSuperFreeze(): void {
    const freeze = this.superFreeze;
    this.superFreeze = undefined;
    if (!freeze) return;
    this.restoreMovementPermission(this.slots[freeze.side]?.player);
    // Release freeze ends before the authored skill; its props remain alive.
  }

  /** 恢复某玩家的移动输入权限;幂等,任何路径都可安全调用 */
  private restoreMovementPermission(player: Player | undefined): void {
    if (!player) return;
    try {
      player.inputPermissions.setPermissionCategory(
        InputPermissionCategory.Movement,
        true,
      );
    } catch {
      // 玩家已离线:忽略
    }
  }

  /**
   * 清掉 M2-a 的全部演出状态(时停窗口 / 三气时间线 / KO 阶段)。
   * **可重复执行**:setupRound 与 cleanup 都会调用。
   * 关键职责:把被时停关掉的 Movement 输入权限**兜底恢复**回来。
   */
  private clearPresentationState(): void {
    if (this.superFreeze) {
      const frozen = this.superFreeze;
      this.superFreeze = undefined;
      this.restoreMovementPermission(this.slots[frozen.side]?.player);
    }
    // 未结束时也要恢复权限(理论上 endSuperFreeze 已经恢复过,这里幂等兜底)
    for (const slot of this.slots) {
      this.restoreMovementPermission(slot.player);
    }
    if (this.super3) this.setSuper3OpeningHidden(this.super3, false);
    this.super3 = undefined;
    this.super2 = undefined;
    this.throwPair = undefined;
    this.waves=[];
    this.victoryOrigins.clear();
    this.resultsWinnerSide = undefined;
    this.victoryCameraShot = "";
    this.pearlReturn = undefined;
    this.koSlowRemaining = 0;
    this.koDownStarted = false;
    this.koWinnerSide = undefined;
    this.koUntilTick = 0;
    this.koDisplayAtTick = 0;
    this.koDisplayed = false;
    this.super3CameraShot = "";
    this.super1CameraCaster = undefined;
    this.hudFeedback = [undefined, undefined];
    // 道具:换局一律收干净(珍珠/命令方块都是纯表现,不该跨局留存)
    this.despawnIntroProp();
    this.despawnSuperProp();
    if (this.fighters) despawnAllProps(this.fighters[0].dimension.id);
    // 技能键的边缘触发状态:换局清掉,避免上一局的"已按过该格"把新局第一次按键吃掉
    clearSkillPresses(this.slots.map(slot => slot.player.id));
    // 叶流粒子:换局清掉节流记录,避免上一局的"刚撒过"把新局第一次发射吃掉
    resetVfxThrottle();
  }

  // ================= M2-a ② 三气低血量分支 + 分段演出 =================

  /**
   * 启动三气演出时间线。
   * **分支在"释放被接受"这一刻取样并锁定**(variantLockedUntilEnd):
   * caster.hp / MAX_HP <= SUPER_3_LOW_HEALTH_RATIO → 低血结尾,中途掉血不换结尾。
   * 起始段 super_3_start 已由 useSkill 播出,这里接着排 confirm/chain/终结段。
   */
  private beginSuper3(casterSide: 0 | 1, caster: Fighter): void {
    const victim = this.fighters?.[casterSide === 0 ? 1 : 0];
    if (!victim) return;
    this.pearlReturn = undefined;
    this.super3 = {castId:this.castId, caster, victim,
      variant: caster.hp / MAX_HP <= SUPER_3_LOW_HEALTH_RATIO ? "low" : "normal",
      time:0, stage:0, hits:0, damageDealt:0, origin:caster.axisPosition,pairOrigin:victim.axisPosition,facing:caster.facing};
    caster.beginPerformance(Number.MAX_SAFE_INTEGER);
    caster.grantInvulnerability(SUPER_3_STARTUP_INVULNERABILITY_TICKS);
    this.syncSuper3InputPermission();
  }

  private tickSuper3(deferConfirmation = false): void {
    const p = this.super3;
    if (!p) return;
    if (p.castId !== this.castId || !p.caster.isValid || !p.victim.isValid) { this.finishSuper3(); return; }
    if (p.stage === 0 && !p.caster.isPerforming) {
      this.super3Whiff(p, "起手被打断", false); return;
    }
    let t = p.time;
    if (p.stage===0) seekClip(p.caster.entity,t/60);
    // Pursuit is ordinary script translation. The opponent remains actionable until confirmation.
    if (deferConfirmation && p.stage === 0 && t >= SUPER_3_TELEPORT_START_AUTHOR_TICKS && t < SUPER_3_CONFIRM_AUTHOR_TICK) {
      const distance = Math.max(0, Math.abs(p.victim.axisPosition-p.caster.axisPosition)-1.1);
      p.caster.placePerformance(p.caster.axisPosition + p.caster.facing*Math.min(SUPER_3_PURSUIT_SPEED,distance));
      const hidden = (t>=90 && t<94) || (t>=100 && t<104);
      setBodyOpacity(p.caster.entity, hidden ? 0 : 1);
    }
    if (p.stage === 0 && t >= SUPER_3_TELEPORT_START_AUTHOR_TICKS) {
      if (deferConfirmation) return;
      // 每 tick 的敌方有效攻击先结算。进入原有抓取区即确认；没有目标时
      // 继续原速追击，到原截止点仍未抓到才挥空，不增加判定范围或禁跳。
      if (!this.super3ConfirmLands(p)) {
        if (t >= SUPER_3_CONFIRM_AUTHOR_TICK) this.super3Whiff(p,"首击未确认");
        return;
      }
      const guardBreak = p.time < SUPER_3_CONFIRM_AUTHOR_TICK + SUPER_3_CONFIRM_GUARD_BREAK_AUTHOR_TICKS;
      const wasGuarding = p.victim.isGuarding;
      // 只跳过剩余追击，配对首拳仍从原作者 t114 开始，两人/镜头同钟。
      p.time = t = SUPER_3_CONFIRM_AUTHOR_TICK;
      if (guardBreak && wasGuarding) this.announceGuardBreak(p.caster, p.victim);
      p.stage=1;
      p.victimHpAtConfirm=p.victim.hp;
      p.damageHits=p.victim.confirmDamage(p.caster,6,CHUNYE_SUPER_3_DAMAGE[p.variant],3);
      p.pairOrigin=p.victim.axisPosition;
      p.caster.forceClip("super_3_confirm");
      p.victim.beginPerformance(Number.MAX_SAFE_INTEGER);
      p.victim.forceClip("super_3_confirm_victim");
      seekClip(p.caster.entity,(t-SUPER_3_CONFIRM_AUTHOR_TICK)/60); seekClip(p.victim.entity,(t-SUPER_3_CONFIRM_AUTHOR_TICK)/60);
      this.syncSuper3InputPermission();
      // Close-range pair anchor; authored bone displacement is not applied twice.
      p.caster.placePerformance(p.victim.axisPosition-p.caster.facing*1.1);
      this.despawnSuperProp();
    }
    if (p.stage === 1 && t >= 206) {
      p.stage=2;
      p.caster.forceClip("super_3_chain"); p.victim.forceClip("super_3_chain_victim");
      seekClip(p.caster.entity,(t-206)/60); seekClip(p.victim.entity,(t-206)/60);
    }
    if (p.stage === 2 && t >= 436) {
      p.stage=3;
      const id=p.variant === "low" ? SUPER_3_FINISH_LOW : SUPER_3_FINISH_NORMAL;
      p.caster.forceClip(id); p.victim.forceClip(id+"_victim");
      seekClip(p.caster.entity,(t-436)/60); seekClip(p.victim.entity,(t-436)/60);
    }
    if (p.stage>0) {
      const frames=super3Scenes[p.variant];
      const frame=frames[Math.min(frames.length-1,Math.max(0,Math.floor(t)-SUPER_3_CONFIRM_AUTHOR_TICK))]!;
      p.caster.placeCinematic(frame.actor.anchor,frame.actor.yaw,p.pairOrigin,p.facing);
      p.victim.placeCinematic(frame.victim.anchor,frame.victim.yaw,p.pairOrigin,p.facing);
      setBodyOpacity(p.caster.entity,frame.actor.visible ? 1 : 0);
      const offset=p.stage===1 ? SUPER_3_CONFIRM_AUTHOR_TICK : p.stage===2 ? 206 : 436;
      seekClip(p.caster.entity,(t-offset)/60); seekClip(p.victim.entity,(t-offset)/60);
    }
    const final=p.variant === "low" ? 615 : 482;
    const impacts=[166,230,276,316,352,384,412,final];
    while (p.hits < impacts.length && t >= impacts[p.hits]!) {
      const index=p.hits;
      // 首拳捕获时已锁定整招补正。七次重击后，终结段承担更高伤害。
      // 非终结段不能提前把目标 HP 打到 0；即使目标只剩 1 点，也保留到
      // 最后一击才结算 KO，这样七连击的完整演出不会中途跳入 KO 镜头。
      const damage = index === 7
        ? p.damageHits![index]!
        : Math.min(p.damageHits![index]!, Math.max(0, p.victim.hp - 1));
      const info=p.victim.receiveCinematicHit(p.caster,damage,index===7);
      p.hits++;
      p.damageDealt+=info.damage;
      const stop=index===7 ? (p.variant === "low" ? 4 : 3) : index===0 ? 3 : 2;
      p.caster.applyHitstop(stop); p.victim.applyHitstop(stop); info.hitstop=stop;
      this.onHit(info);
      applySuperHitBurst(p.victim,p.caster);
    }
    if (t >= (p.variant === "low" ? 686 : 518)) this.finishSuper3();
  }

  private super3ConfirmLands(p: Super3Plan): boolean {
    const guardBreak = p.time < SUPER_3_CONFIRM_AUTHOR_TICK + SUPER_3_CONFIRM_GUARD_BREAK_AUTHOR_TICKS;
    return p.victim.isValid && !p.victim.isDown && !p.victim.isInvulnerable && (guardBreak || !p.victim.isGuarding) &&
      p.caster.distanceTo(p.victim) <= Math.min(2.4,SUPER_3_PAIR_REACH) &&
      Math.abs(p.caster.feetY-p.victim.feetY)<1.8;
  }

  private super3Whiff(p: Super3Plan, reason: string, animate=true): void {
    this.runtime.dbg(`room${this.roomId} 三气失败:${reason}`);
    this.setSuper3OpeningHidden(p, false);
    p.caster.setPerforming(false,!animate);
    if (p.stage>0) p.victim.setPerforming(false);
    this.restoreMovementPermission(p.victim.player);
    if (animate) p.caster.startSuper3Whiff();
    if (p.time>=SUPER_3_TELEPORT_START_AUTHOR_TICKS) this.pearlReturn={caster:p.caster,axis:p.origin+p.caster.facing*0.5,atTick:currentTick()+Math.ceil((222-p.time)/3)};
    this.despawnSuperProp(); this.super3=undefined;
  }

  private finishSuper3(): void {
    const p=this.super3;
    this.super3=undefined; this.despawnSuperProp();
    if (!p) return;
    this.setSuper3OpeningHidden(p, false);
    this.restoreMovementPermission(p.victim.player);
    if (p.stage>0) {
      this.log(`三气结算 ${p.variant} P${p.caster.side+1}→P${p.victim.side+1}: `+
        `${p.hits}/8 击，实际扣血 ${p.damageDealt}，HP ${p.victimHpAtConfirm}→${p.victim.hp}`+
        (p.hits===8 ? "，完整结束" : "，提前结束"));
    }
    p.caster.setPerforming(false);
    p.victim.setPerforming(false);
    if (p.stage>0) p.victim.settlePerformanceDown(p.victim.hp<=0);
  }

  private tickWaves(): void {
    if(this.presentationDelta===0 || this.isSuperFrozen(0))return;
    const active: typeof this.waves = [];
    for (const w of this.waves) {
      if(!w.caster.isValid || !w.victim.isValid) continue;
      if(!w.released){
        if(currentClip(w.caster.entity)!=="special_leaf_burst") continue;
        if(clipElapsed(w.caster.entity)<7){ active.push(w); continue; }
        w.released=true;w.axis=w.caster.axisPosition;w.height=w.caster.feetY;
        // 波实体在技能接受时就登记了初始轴坐标，因此即使对手这一 tick
        // 还没走到释放帧，也可以先算出两枚相向波的共同相遇距离。粒子
        // 会在该点自然结束，随后由 applyWaveClash 播出双向撞击反馈。
        const counterpart = this.waves.find((other) =>
          other !== w &&
          other.caster.side !== w.caster.side &&
          other.facing === -w.facing &&
          Math.abs(other.height - w.height) <= WAVE_HIT_VERTICAL_TOLERANCE,
        );
        if (counterpart) {
          const separation = Math.abs(counterpart.axis - w.axis);
          if (separation > 0.8) {
            w.particleRange = Math.max(
              0.8,
              Math.min(VFX_PROJECTILE_RANGE, separation / 2),
            );
            counterpart.particleRange = w.particleRange;
          }
        }
        applyProjectileBurst(w.caster,w.victim,w.particleRange);
      }
      w.distance=Math.min(VFX_PROJECTILE_RANGE,w.distance+VFX_PROJECTILE_SPEED/20*this.presentationDelta);
      if(w.distance<=VFX_PROJECTILE_RANGE) active.push(w);
    }

    // 双方的叶波在同一条线上相向飞行时同时消耗，不会穿过彼此继续命中。
    const canceled = new Set<typeof active[number]>();
    for (let i = 0; i < active.length; i++) {
      const a = active[i]!;
      if (!a.released || canceled.has(a)) continue;
      for (let j = i + 1; j < active.length; j++) {
        const b = active[j]!;
        if (!b.released || canceled.has(b) || a.caster.side === b.caster.side || a.facing === b.facing) continue;
        if (Math.abs(a.height - b.height) > WAVE_HIT_VERTICAL_TOLERANCE) continue;
        const frontA = a.axis + a.facing * a.distance;
        const frontB = b.axis + b.facing * b.distance;
        if (Math.abs(frontA - frontB) > 0.45) continue;
        canceled.add(a); canceled.add(b);
        const collisionAxis = (frontA + frontB) / 2;
        const axisDelta = collisionAxis - a.caster.axisPosition;
        const at: Vector3 = ARENA_AXIS === "x"
          ? { x: a.caster.location.x + axisDelta, y: a.height, z: a.caster.location.z }
          : { x: a.caster.location.x, y: a.height, z: a.caster.location.z + axisDelta };
        try { applyWaveClash(a.caster, b.caster, at); } catch { /* 纯表现 */ }
        break;
      }
    }

    this.waves = active.filter(w => {
      if (canceled.has(w)) return false;
      if (!w.released) return true;
      const previous = Math.max(0, w.distance - VFX_PROJECTILE_SPEED/20*this.presentationDelta);
      const distance=(w.victim.axisPosition-w.axis)*w.facing;
      if(!w.victim.isDown && !w.victim.isPerforming &&
        distance <= WAVE_HIT_RANGE &&
        Math.abs(w.victim.feetY-w.height) < WAVE_HIT_VERTICAL_TOLERANCE &&
        distance >= previous-WAVE_HIT_SWEEP_BUFFER &&
        distance <= w.distance+WAVE_HIT_SWEEP_BUFFER){
        const hit=w.victim.receiveHit(w.caster,5,{hitLevel:"mid"});w.victim.applyHitstop(2);hit.hitstop=2;this.onHit(hit);return false;
      }
      return w.distance < VFX_PROJECTILE_RANGE;
    });
  }

  private tickThrowPair(): void {
    const p=this.throwPair;if(!p)return;
    // 施放者和受击者共用捕获后的动作时钟；不再用某一方当前 clip 的进度
    // 反推另一方的摔倒时刻。定帧/慢放时 presentationDelta=0/0.1，双方一起停。
    p.elapsed += this.presentationDelta;
    const casterElapsed = p.casterElapsedAtCapture + p.elapsed;
    const victimElapsed = p.victimStartOffset + p.elapsed;
    seekClip(p.caster.entity, casterElapsed / 20);
    if (!p.struck) seekClip(p.victim.entity, victimElapsed / 20);
    if(!p.struck && p.elapsed>=p.impactElapsed) {
      p.struck=true;
      this.onHit(p.victim.receiveCinematicHit(p.caster,p.damage,true,4));
      p.victim.settlePerformanceDown(p.victim.hp<=0,10);
    }
    if(p.elapsed>=p.endElapsed){p.caster.setPerforming(false);this.throwPair=undefined;}
  }

  private tickSuper2(): void {
    const p=this.super2;
    if (!p) return;
    const t=clipElapsed(p.caster.entity)*3;
    if (!p.struck && t>=124) {
      p.struck=true;
      const hit=p.victim.receiveCinematicHit(p.caster,p.damage,false);
      hit.knockdown = true;
      p.caster.applyHitstop(3); p.victim.applyHitstop(3); hit.hitstop=3;
      this.onHit(hit);
    }
    if (t>=168) {
      p.caster.setPerforming(false);
      // 二气成功命中总是进入倒地流程；是否 KO 仍由真实血量决定。
      p.victim.settlePerformanceDown(p.victim.hp <= 0);
      this.super2=undefined;
    }
  }

  // ================= M2-a ③ KO 慢放 + 特写运镜 =================

  /**
   * 进入 KO 阶段:双方锁输入 KO_PHASE_TICKS,败者倒地,打白闪 + 特写 + 震屏。
   * 注意:**本阶段内不调用 SideCamera.update()**,否则侧视相机会把特写顶掉。
   */
  private beginKo(winnerSide: 0 | 1): void {
    const fighters = this.fighters;
    if (!fighters) return;
    const now = currentTick();
    const winner = fighters[winnerSide];
    const loser = fighters[winnerSide === 0 ? 1 : 0];

    // ---- 强慢放(源资产:strong_slow_is_KO_only,ko.rate=0.1)----
    // Synced source time advances at 0.1 only in the confirmed KO impact window.
    const superKo = this.lastHitSkill === 6;
    const koTicks = superKo ? KO_PHASE_SUPER_TICKS : KO_PHASE_TICKS;
    try {
      winner.applyHitstop(KO_HITSTOP_TICKS);
      loser.applyHitstop(KO_HITSTOP_TICKS);
      this.hitstopUntilTick = Math.max(
        this.hitstopUntilTick,
        now + KO_HITSTOP_TICKS,
      );
    } catch {
      // 定帧失败不影响结算
    }

    this.koSlowRemaining = 8 / 3;
    this.koDownStarted = false;
    this.koWinnerSide = winnerSide;
    this.koUntilTick = now + koTicks;
    // 终结接触硬切特写并同时显示 KO；不等待演出收尾才慢放。
    this.koDisplayAtTick = now;
    this.koDisplayed = true;
    this.lastHudTick = -Infinity;

    // 双方定格:KO 慢放是"逻辑停顿",不是改世界 tick 速度
    try {
      winner.lockInputUntil(this.koUntilTick);
      loser.lockInputUntil(this.koUntilTick);
    } catch (error) {
      this.log("KO 锁输入失败", error);
    }

    this.applyKoPresentation(winner, loser);

    const reason = "KO";
    this.broadcast(
      `§c${reason}!§e ${winner.player.name} 击倒 ${loser.player.name}`,
    );
    this.phase = "ko";
  }

  private applyKoPresentation(winner: Fighter, loser: Fighter): void {
    const side: 1 | -1 = CAMERA_SIDE === "positive" ? 1 : -1;
    // 叶流粒子:KO 特写那一刻在败者身上补一次弹珠爆发 + 叶流上冲。
    // 放在玩家循环**外面**:这是"场景级"一次性表现,不是每人一份;
    // 循环里调只会被 fx 侧节流挡掉,白跑一趟。
    try {
      applyKoBurst(loser, winner);
    } catch {
      // 粒子失败不影响回合结算
    }
    for (const slot of this.slots) {
      const camera = this.cameras.get(slot.player.id);
      try {
        const frame = koCameraFrame({
          axis: ARENA_AXIS,
          side,
          victim: loser,
          winner,
        });
        camera?.hardCut(frame.pos,frame.focus,frame.fov);
      } catch {
        // 运镜失败不影响回合结算
      }
      try {
        applyKoFlash(slot.player);
      } catch {
        // 白闪失败不影响回合结算
      }
      try {
        camera?.shake(KO_SHAKE_INTENSITY, KO_SHAKE_SECONDS);
      } catch {
        // 震屏失败不影响回合结算
      }
    }
  }

  /** KO 阶段继续推进配对收尾；定格后按实际骨骼位置跟随取景。 */
  private tickKo(): void {
    for (const slot of this.slots) this.holdPlayer(slot);
    // ★演出阶段也要推进倒地/胜利动画:否则败者停在 knockdown 最后一帧,
    //   永远进不了 idle_down 躺地循环(实机"KO 之后没血的没有持续倒地")
    this.tickSuper3();
    this.tickSuper2();
    this.tickThrowPair();
    if(this.phase === "fight") this.tickWaves();
    this.tickPresentation();
    const fighters = this.fighters;
    if (this.koSlowRemaining <= 0 && fighters && this.koWinnerSide !== undefined) {
      fighters[this.koWinnerSide].settleAfterKo();
    }
    if (!this.super3 && !this.super2 && !this.throwPair && this.koSlowRemaining <= 0 && !this.koDownStarted && fighters && this.koWinnerSide !== undefined) {
      const loser=fighters[this.koWinnerSide===0?1:0];
      const looping=CHUNYE_CLIPS[currentClip(loser.entity) ?? ""]?.loop;
      if (loser.isDown || looping || clipFinished(loser.entity)) { loser.playDown(); this.koDownStarted=true; }
    }
    if (!this.koDisplayed && currentTick() >= this.koDisplayAtTick) {
      this.koDisplayed = true;
      this.lastHudTick = -Infinity;
    }
    // Follow actual animated torso/head positions after the impact pause, so
    // launch/downward finishers cannot leave a static camera staring at empty floor.
    if (fighters && this.koWinnerSide !== undefined && this.presentationDelta > 0) {
      const winner=fighters[this.koWinnerSide], loser=fighters[this.koWinnerSide===0?1:0];
      const frame=koCameraFrame({axis:ARENA_AXIS,side:CAMERA_SIDE==="positive"?1:-1,victim:loser,winner});
      for(const camera of this.cameras.values()) camera.hardCut(frame.pos,frame.focus,frame.fov);
    }
    this.pushHud(this.koDisplayed ? "§cK.O." : "§7终结演出", 0, fighters);
    if (this.super3 || this.super2 || this.throwPair || this.koSlowRemaining > 0 || !this.koDownStarted) return;
    if (currentTick() < this.koUntilTick) return;
    const winnerSide = this.koWinnerSide;
    if (winnerSide === undefined) {
      this.endRound(undefined, "KO");
      return;
    }
    this.endRound(winnerSide, "KO");
  }

  /**
   * 演出阶段的动画推进(KO / 回合结束 / 整场结束三个阶段都调)。
   * 这三个阶段不跑 Fighter.tick(),但倒地与胜利的动画衔接都挂在它的
   * flushQueuedClip / tickDown 上 —— 所以必须单独推一下。
   */
  private tickPresentation(): void {
    const fighters = this.fighters;
    if (!fighters) return;
    // 落地等待不占用短/长胜利动画本身的展示时间。
    if ((this.phase === "roundEnd" || this.phase === "matchEnd") &&
        fighters.some(f => f.isValid && f.waitingForVictory)) this.phaseUntilTick++;
    for (const fighter of fighters) {
      try {
        fighter.tickPresentation(this.phase === "ko" && this.koSlowRemaining > 0);
      } catch {
        // 单个角色失败不影响演出
      }
    }
  }

  private onHit(hit: HitInfo): void {
    // 三气首拳在确认前仍可被打断。tickSuper3() 在本 tick 的角色推进
    // 之前运行；如果首拳确认点正好落在这一 tick，而对手上一 tick
    // 已经打开的普通攻击/投技随后命中施放者，三气可能已经切到配对段。
    // 在投技配对分支之前立即撤销时间线，避免后续七连击继续播放。
    // 无敌帧命中会返回 blocked=true、damage=0，因此不会误触发这里。
    const super3 = this.super3;
    const super3InitialHitInterrupted =
      super3 !== undefined &&
      hit.victim === super3.caster &&
      !hit.blocked &&
      super3.hits === 0 &&
      super3.stage <= 1 &&
      super3.time <= SUPER_3_CONFIRM_AUTHOR_TICK;
    if (super3InitialHitInterrupted) {
      this.super3Whiff(super3, "首拳判定时施放者被打断", false);
    }
    if (hit.damage>0) this.lastHudTick=-Infinity;
    if (hit.blocked) this.showFeedback(hit.victim.side, "防御成功");
    if (hit.guardBroken) this.announceGuardBreak(hit.attacker, hit.victim);
    if(hit.capture === "throw") {
      const casterElapsedAtCapture = clipElapsed(hit.attacker.entity);
      this.throwPair={
        caster:hit.attacker,
        victim:hit.victim,
        capturedTick:currentTick(),
        casterElapsedAtCapture,
        // 受击动画从捕获这一刻进入，但要按施放者当前的共享进度校准，
        // 即使判定在窗口后半段确认，双方仍会在绝对 1.4 秒节点同时落地。
        victimStartOffset:casterElapsedAtCapture,
        impactElapsed:Math.max(1,THROW_IMPACT_GAME_TICKS-casterElapsedAtCapture),
        endElapsed:Math.max(1,clipGameTicks("throw_cast")-casterElapsedAtCapture),
        elapsed:0,
        struck:false,
        damage:hit.deferredDamage!,
      };
      seekClip(hit.victim.entity, casterElapsedAtCapture / 20);
      hit.attacker.beginPerformance(Number.MAX_SAFE_INTEGER);hit.victim.beginPerformance(Number.MAX_SAFE_INTEGER);
      return;
    }
    if (hit.capture === "super2" && !this.super2) {
      this.super2={caster:hit.attacker,victim:hit.victim,struck:false,damage:hit.deferredDamage!};
      hit.attacker.beginPerformance(Number.MAX_SAFE_INTEGER);
      hit.victim.beginPerformance(Number.MAX_SAFE_INTEGER);
      return;
    }
    // 定帧窗口:相机的"时钟"也跟着停(源资产 hitstop.affected =
    // both_actors_and_pearl_camera_clock ⇒ 镜头也一起顿住)
    if (hit.hitstop > 0) {
      this.hitstopUntilTick = Math.max(
        this.hitstopUntilTick,
        currentTick() + hit.hitstop,
      );
    }
    // 记住这一击用的什么招式:KO 演出时长按"是不是大招 KO"分档(强慢放只给 KO)
    this.lastHitSkill = hit.skill;
    try {
      applyHitPresentation(hit, (playerId, intensity) => {
        const camera = this.cameras.get(playerId);
        camera?.shake(intensity, HIT_SHAKE_SECONDS);
      });
    } catch (error) {
      this.log("命中表现异常", error);
    }
    const label = SKILLS[hit.skill]?.label ?? "攻击";
    this.runtime.dbg(
      `room${this.roomId} ${hit.attacker.name} 用${label}命中 ${hit.victim.name}` +
        `(-${hit.damage}${hit.blocked ? " 被防御" : ""}` +
        `${hit.knockdown ? " 击倒!" : ` 连击${hit.victim.comboCount}`})`,
    );
    // 击倒(投技摔倒 / 连打倒地)是全房可见的关键事件,播报一条
    if (hit.knockdown) {
      this.showFeedback(hit.victim.side, "倒地!");
      this.broadcast(
        `§c击倒!§e ${stripSectionCodes(hit.victim.player.name)} 被打倒在地`,
      );
    }
  }

  /** 结束一局。winnerSide === undefined 表示平局(双方都不加分) */
  private endRound(winnerSide: 0 | 1 | undefined, reason: string): void {
    const fighters = this.fighters;
    if (!fighters) return;

    this.throwPair=undefined;
    this.waves=[];
    // 收掉可能还在跑的三气演出:不这么做,演出者的 performing 标记会残留到
    // roundEnd/matchEnd,把胜利动画顶掉。
    this.finishSuper3();

    if (winnerSide !== undefined) {
      this.score[winnerSide] += 1;
    }
    const winner = winnerSide === undefined ? undefined : fighters[winnerSide];
    const loser =
      winnerSide === undefined
        ? undefined
        : fighters[winnerSide === 0 ? 1 : 0];

    if (winnerSide !== undefined && this.score[winnerSide] >= ROUNDS_TO_WIN_MATCH) {
      this.beginMatchEnd(); return;
    }
    try {
      winner?.playVictory(false);
      loser?.playDown();
      loser?.leaveStage();
      this.resultsWinnerSide=winnerSide;
      this.victoryCameraShot="";
    } catch (error) {
      this.log("回合收尾动画异常", error);
    }

    const scoreText = `${this.score[0]} : ${this.score[1]}`;
    const winnerName = winner?.player.name ?? "双方";
    this.broadcast(
      `§6第 ${this.round} 局结束(${reason})§e ${winnerName} 胜 §7比分 ${scoreText}`,
    );

    this.phase = "roundEnd";
    this.lastHudTick=-Infinity;
    this.phaseUntilTick = currentTick() + ROUND_END_TICKS;
  }

  private tickRoundEnd(): void {
    for (const slot of this.slots) this.holdPlayer(slot);
    this.tickPresentation();
    const fighters = this.fighters;
    this.pushHud(
      `§6第 ${this.round} 局结束`,
      0,
      fighters,
    );
    if (currentTick() < this.phaseUntilTick) return;

    // 比赛是否已分出胜负?
    if (this.score[0] >= ROUNDS_TO_WIN_MATCH || this.score[1] >= ROUNDS_TO_WIN_MATCH) {
      this.beginMatchEnd();
      return;
    }
    this.round += 1;
    this.setupRound();
  }

  private beginMatchEnd(): void {
    const fighters = this.fighters;
    if (!fighters) return;
    const winnerSide: 0 | 1 = this.score[0] >= ROUNDS_TO_WIN_MATCH ? 0 : 1;
    const winner = fighters[winnerSide];
    const loser = fighters[winnerSide === 0 ? 1 : 0];
    try {
      winner.playVictory(true);
      loser.playDown();
      loser.leaveStage();
      this.resultsWinnerSide=winnerSide;
      this.victoryCameraShot="";
    } catch (error) {
      this.log("比赛收尾动画异常", error);
    }
    this.broadcast(
      `§6★ ${winner.player.name} 以 ${this.score[0]} : ${this.score[1]} 赢下整场!★`,
    );
    this.phase = "matchEnd";
    this.lastHudTick=-Infinity;
    this.phaseUntilTick = currentTick() + MATCH_END_TICKS;
    this.matchWinnerSide = winnerSide;
  }

  private matchWinnerSide: 0 | 1 | undefined;

  private tickMatchEnd(): void {
    for (const slot of this.slots) this.holdPlayer(slot);
    // 整场结束同样要推动画:败者持续倒地、胜者从胜利动画接待机
    this.tickPresentation();
    this.pushHud("§6比赛结束");
    if (currentTick() < this.phaseUntilTick) return;
    const winner = this.matchWinnerSide;
    const text =
      winner === undefined
        ? "灯塔全明星对决结束"
        : `${this.slots[winner]?.player.name ?? "?"} 以 ${this.score[0]} : ${this.score[1]} 获胜!`;
    this.finishMatch(text);
  }

  // ================= 结束 / 清理 =================

  /** 结束整场:先做视觉清理,再把玩家交回 runtime 送回大厅 */
  private finishMatch(message: string): void {
    if (this.phase === "finished") return;
    this.phase = "finished";
    this.cleanup();
    if (!this.ending) {
      this.ending = true;
      try {
        this.runtime.endGame(
          this.roomId,
          "allstars",
          `§6【灯塔全明星对决】§e${message}§7,即将返回大厅…`,
        );
      } catch (error) {
        this.log("endGame 调用失败", error);
      }
    }
  }

  /**
   * 清场。**必须可重复执行**:
   *   HUD → 相机 → 角色实体 → 输入权限/隐身/笼 → 快捷栏 → 兜底扫描。
   */
  cleanup(): void {
    const players = this.slots.map((slot) => slot.player);

    // 0) M2-a 演出状态:三气时间线 / 时停窗口 / KO 阶段
    //    (时停会关掉对手的 Movement 权限,这里必须兜底恢复)
    try {
      this.clearPresentationState();
    } catch {
      // 忽略
    }
    // 0a) 道具兜底:任何遗留的珍珠/命令方块实体一并收掉
    try {
      if (this.fighters) despawnAllProps(this.fighters[0].dimension.id);
    } catch {
      // 忽略
    }
    // 0a) M2-c-1 输入缓冲:清场后不得残留待起手的按键(Map.clear 不会抛)
    this.inputBuffer.clear();

    // 1) HUD
    try {
      hud.clear(players);
    } catch {
      // 忽略
    }
    try {
      this.despawnHudAnchor();
    } catch {
      // 忽略
    }

    // 2) 相机
    for (const camera of this.cameras.values()) {
      try {
        camera.clear();
      } catch {
        // 忽略
      }
    }
    this.cameras.clear();

    // 3) 角色实体
    if (this.fighters) {
      for (const fighter of this.fighters) {
        try {
          fighter.dispose();
          fighter.remove();
        } catch {
          // 忽略
        }
      }
      this.fighters = undefined;
    }
    this.sweepFighterEntities();

    // 4) 玩家状态:输入权限 / 隐身 / 笼 / 快捷栏
    for (const slot of this.slots) {
      try {
        clearSkillHotbar(slot.player);
      } catch {
        // 忽略
      }
      try {
        teardownCage(slot.player, slot.player.id);
      } catch {
        // 忽略
      }
      forgetCage(slot.player.id);
    }

    if (this.matchId !== undefined && !this.cleaned) {
      this.cleaned = true;
      // 只有"当前活跃对局"才允许从表里删除自己,避免旧局误删新局
      const current = matches.get(this.roomId);
      if (current === this) matches.delete(this.roomId);
    }
  }

  /**
   * 兜底:按实体类型 + 半径扫掉遗留的角色实体。
   * 为什么不用 tag 查询:EntityQueryOptions 只保证 type/location/maxDistance
   * 这组字段,用 tag 还得额外查 family;这里按 type 精确匹配已经足够,
   * 而且 if/else 判空逻辑更简单。tag(FIGHTER_TAG)仍会打在实体上,便于
   * 游戏内 /tag 人工排查。
   */
  private sweepFighterEntities(): void {
    try {
      const dim = this.runtime.roomDim(this.roomId);
      const entities = dim.getEntities({
        type: CHUNYE_ENTITY_ID,
        location: ARENA_CENTER,
        maxDistance: ENTITY_CLEANUP_RADIUS,
      });
      for (const entity of entities) {
        try {
          if (entity.isValid) entity.remove();
        } catch {
          // 忽略
        }
      }
    } catch {
      // 维度可能已不可用
    }
  }

  // ================= 工具 =================

  /** 笼内保持:每 tick 把玩家拉回锚点 */
  private holdPlayer(slot: PlayerSlot): void {
    try {
      pullBackToCage(slot.player, {
        anchor: slot.anchor,
        yaw: slot.yaw,
        pitch: 0,
        built: true,
      });
    } catch {
      // 忽略
    }
  }

  private updateCameras(): void {
    const fighters = this.fighters;
    if (!fighters) return;
    // 定帧期间相机也一起停(规格:定帧影响双方与相机时钟)
    if (currentTick() < this.hitstopUntilTick) return;
    const punchCaster = this.phase === "fight" && !this.super2 && !this.super3
      ? fighters.find(f => currentClip(f.entity) === "super_1" && clipElapsed(f.entity)*3 < 28)
      : undefined;
    if (punchCaster) {
      const opponent = fighters[punchCaster.side === 0 ? 1 : 0];
      const first = this.super1CameraCaster !== punchCaster;
      this.super1CameraCaster = punchCaster;
      if (first) this.super1CameraEnterUntilTick = currentTick()+5;
      else if (currentTick() < this.super1CameraEnterUntilTick) return;
      const focus = bodyPoint(punchCaster,"torso");
      // 预先朝珍珠落点构图，不追着隐藏中的本体突然跳机位；同时包括拳头和对手。
      focus[ARENA_AXIS] += punchCaster.super1StepDestination(opponent)-punchCaster.axisPosition+punchCaster.facing*0.55;
      const at = {...focus,y:focus.y+0.4};
      at[ARENA_AXIS] += punchCaster.facing*1.0;
      at[ARENA_AXIS === "x" ? "z" : "x"] += (CAMERA_SIDE === "positive" ? 1 : -1)*4.6;
      for (const camera of this.cameras.values()) camera.smoothShot(at,focus,54,first ? 0.25 : 0.05);
      return;
    }
    if (this.super1CameraCaster) {
      this.super1CameraCaster = undefined;
      for (const camera of this.cameras.values()) camera.invalidate();
    }
    for (const slot of this.slots) {
      const camera = this.cameras.get(slot.player.id);
      if (!camera) continue;
      try {
        camera.update([fighters[0], fighters[1]]);
      } catch {
        // 单玩家相机失败不影响对局
      }
    }
  }

  private pushHud(
    phaseLine: string,
    remainTicks?: number,
    fighters?: [Fighter, Fighter],
  ): void {
    const now = currentTick();
    const hideBars = this.phase === "ko" || this.phase === "roundEnd" || this.phase === "matchEnd" ||
      (this.phase === "intro" && this.cinematicIntro) || !!this.superFreeze || !!this.super2 || !!this.super3 ||
      (this.fighters?.some(f=>currentClip(f.entity)?.startsWith("super_")) ?? false);
    if (hideBars !== this.hudPresentationHidden) {
      this.hudPresentationHidden=hideBars;
      this.lastHudTick=-Infinity;
    }
    if (this.phase !== "ko" && now - this.lastHudTick < HUD_REFRESH_TICKS) return;
    this.lastHudTick = now;
    const list = fighters ?? this.fighters;
    if (!list) return;
    const remain =
      remainTicks ??
      Math.max(0, this.phaseUntilTick - now);
    const state = hud.stateFrom(
      list,
      Math.max(1, this.round),
      Math.max(0, remain),
      this.score,
      phaseLine,
    );
    const anchor = this.updateHudAnchor();
    // 开场特写只保留“谁操控谁”的说明；血量、气条、回合信息和中央大屏
    // 都在倒计时阶段再显示，避免开场演出被 HUD 抢画面。
    state.introOnly = this.phase === "intro" && this.cinematicIntro;
    state.hideBars = hideBars;
    state.centerText = this.phase === "countdown"
      ? String(Math.max(1, Math.ceil((this.phaseUntilTick - now) / 20)))
      : this.phase === "fight" && now < this.fightSignalUntilTick ? "开打!" : "";
    if (this.phase === "ko" && this.koDisplayed) state.centerText = "ＫＯ";
    state.feedback = [
      this.hudFeedback[0] && this.hudFeedback[0].until > now ? this.hudFeedback[0].text : undefined,
      this.hudFeedback[1] && this.hudFeedback[1].until > now ? this.hudFeedback[1].text : undefined,
    ];
    try {
      hud.refresh(
        this.slots.map((slot) => slot.player),
        state,
        (player) => (this.slots[0]?.player.id === player.id ? 0 : 1),
        anchor,
      );
    } catch {
      // HUD 失败不影响对局
    }
  }

  /** 三气分段镜头：每个重要阶段只在切段时硬切一次，避免普通侧视相机把
   * 特写顶掉。阶段 0 正面看抛珠，瞬移后回到侧面，随后按七次接触和终结
   * 分别取略有高低差的重击角度。 */
  private updateSuper3Camera(plan: Super3Plan): void {
    const time = plan.time;
    if (plan.stage > 0) {
      const frames=super3Scenes[plan.variant];
      const frame=frames[Math.min(frames.length-1,Math.max(0,Math.floor(time)-SUPER_3_CONFIRM_AUTHOR_TICK))]!;
      const reference=frame.camera;
      const yaw=reference.angle*Math.PI/180;
      const direction=[90*Math.sin(yaw),reference.vertical,-90*Math.cos(yaw)];
      const length=Math.hypot(...direction);
      const distance=reference.span/(2*Math.tan(24*Math.PI/180));
      const position=reference.target.map((v,i)=>v+direction[i]!/length*distance);
      const shot=`source-${[114,218,258,300,338,370,398,446].filter(t=>time>=t).length}`;
      const cut=shot!==this.super3CameraShot;
      if (!cut && this.presentationDelta===0) return;
      this.super3CameraShot=shot;
      const focus=scenePointToWorld(reference.target,plan.pairOrigin,plan.facing);
      const at=scenePointToWorld(position,plan.pairOrigin,plan.facing);
      for(const camera of this.cameras.values()) camera.hardCut(at,focus,48,cut?0:0.05);
      return;
    }
    let shot = "front";
    if (plan.stage === 0 && time >= SUPER_3_TELEPORT_START_AUTHOR_TICKS) shot = "teleport";
    else if (plan.stage > 0) shot = `hit-${plan.hits}-${plan.stage}`;
    if (shot === this.super3CameraShot) return;
    this.super3CameraShot = shot;

    const caster = plan.caster.location;
    const victim = plan.victim.location;
    const mid: Vector3 = {
      x: (caster.x + victim.x) / 2,
      y: (caster.y + victim.y) / 2 + 1.15,
      z: (caster.z + victim.z) / 2,
    };
    const axis = ARENA_AXIS === "x"
      ? { x: 1, y: 0, z: 0 }
      : { x: 0, y: 0, z: 1 };
    const side = CAMERA_SIDE === "positive" ? 1 : -1;
    const perp = ARENA_AXIS === "x"
      ? { x: 0, y: 0, z: side }
      : { x: side, y: 0, z: 0 };
    let location: Vector3;
    let focus = mid;
    if (shot === "front") {
      // 释放者正面：镜头在其朝向前方，略偏侧避免完全遮住双手。
      location = {
        x: caster.x + axis.x * plan.facing * 4.4 + perp.x * 0.8,
        y: caster.y + 1.65,
        z: caster.z + axis.z * plan.facing * 4.4 + perp.z * 0.8,
      };
      focus = { x: caster.x, y: caster.y + 1.2, z: caster.z };
    } else if (shot === "teleport") {
      location = { x: mid.x + perp.x * 7.5, y: mid.y + 2.0, z: mid.z + perp.z * 7.5 };
    } else {
      const n = Math.max(0, plan.hits);
      const axisOffset = ((n % 3) - 1) * 0.8;
      const height = 1.7 + (n % 2) * 0.45;
      location = {
        x: victim.x + perp.x * 4.2 + axis.x * axisOffset,
        y: victim.y + height,
        z: victim.z + perp.z * 4.2 + axis.z * axisOffset,
      };
      focus = { x: (caster.x + victim.x) / 2, y: victim.y + 1.2, z: (caster.z + victim.z) / 2 };
    }
    for (const camera of this.cameras.values()) {
      try { camera.hardCut(location, focus, shot === "front" ? 48 : 54); } catch { /* 单玩家失败 */ }
    }
  }

  private updateVictoryCamera(): void {
    const winner=this.resultsWinnerSide === undefined ? undefined : this.fighters?.[this.resultsWinnerSide];
    if (!winner?.isValid) return;
    const id=currentClip(winner.entity), t=clipElapsed(winner.entity)*3;
    const origin=this.victoryOrigins.get(winner);
    if (origin && (id === "victory_match" || id === "victory_match_idle")) {
      const frame=victoryScenes[id === "victory_match_idle" ? victoryScenes.length-1 : Math.min(victoryScenes.length-1,Math.floor(t))]!;
      const shot=t>=206 || id==="victory_match_idle" ? "final" : t>=112 ? "travel" : "opening";
      const cut=this.victoryCameraShot!==shot;
      this.victoryCameraShot=shot;
      const at=scenePointToWorld(frame.camera.position,origin.axis,origin.facing);
      const focus=scenePointToWorld(frame.camera.target,origin.axis,origin.facing);
      for(const camera of this.cameras.values()) camera.hardCut(at,focus,frame.camera.fov,cut?0:0.05);
    } else {
      const root=winner.location, head=bodyPoint(winner,"head");
      const focus={x:head.x,y:(root.y+head.y)/2,z:head.z};
      const at={x:focus.x,y:focus.y+0.35,z:focus.z};
      at[ARENA_AXIS]+=winner.facing*5;
      at[ARENA_AXIS==="x"?"z":"x"]+=0.8;
      const cut=this.victoryCameraShot!=="round";
      this.victoryCameraShot="round";
      for(const camera of this.cameras.values()) camera.hardCut(at,focus,42,cut?0:0.05);
    }
  }

  /** 在对应玩家一侧显示一个短暂的格斗反馈。 */
  private showFeedback(side: 0 | 1, text: string, ticks = 24): void {
    this.hudFeedback[side] = { text, until: currentTick() + Math.max(1, ticks) };
    this.lastHudTick = -Infinity;
  }

  /** 拆投是后出投技的一方打断先出投技的一方；HUD 与聊天栏同时给出明确席位。 */
  private announceThrowTech(later: Fighter, earlier: Fighter): void {
    this.showFeedback(later.side, "拆投!");
    this.showFeedback(earlier.side, "拆投!");
    this.broadcast(`${this.seatLabel(later.side)} 对 ${this.seatLabel(earlier.side)} 拆投!`);
  }

  private announceGuardBreak(attacker: Fighter, victim: Fighter): void {
    this.showFeedback(attacker.side, "破防!");
    this.broadcast(`${this.seatLabel(attacker.side)} 对 ${this.seatLabel(victim.side)} 破防!`);
  }

  private seatLabel(side: 0 | 1): string {
    return side === 0 ? "1P" : "2P";
  }

  private broadcast(message: string): void {
    try {
      this.runtime.announce(this.roomId, message);
    } catch {
      // 忽略
    }
  }

  private log(message: string, error?: unknown): void {
    console.warn(
      `[Bearcade allstars] room${this.roomId} match#${this.matchId} ${message}`,
      error ?? "",
    );
  }

  // ================= 只读访问(调试 / probe 用) =================

  get fightersRef(): [Fighter, Fighter] | undefined {
    return this.fighters;
  }

  get scoreRef(): [number, number] {
    return this.score;
  }

  get roundRef(): number {
    return this.round;
  }

  /** probe / 调试用:玩家在对局里的朝向;不在本局则 undefined */
  facingOf(playerId: string): Facing | undefined {
    const slot = this.slots.find((item) => item.player.id === playerId);
    return slot?.facing;
  }
}

/** 新建并登记一场对局(roomId 隔离) */
export function createMatch(
  runtime: MinigameRuntime,
  roomId: number,
  players: Player[],
): Match | undefined {
  const existing = matches.get(roomId);
  if (existing) {
    // 理论上不该发生(runtime 保证一房一局),真发生就先清旧的
    console.warn(
      `[Bearcade allstars] room${roomId} 已有对局,先清理旧局 match#${existing.matchId}`,
    );
    existing.cleanup();
    matches.delete(roomId);
  }
  matchIdCounter += 1;
  const match = new Match(runtime, roomId, players, {
    matchId: matchIdCounter,
    castId: 0,
  });
  matches.set(roomId, match);
  return match;
}

/** 推进所有房间的对局(由 game.ts 的 1 tick runInterval 调用) */
export function tickMatches(): void {
  if (matches.size === 0) return;
  for (const [roomId, match] of Array.from(matches.entries())) {
    if (matches.get(roomId) !== match) continue; // 已被新局替换 → 旧局不再推进
    try {
      match.tick();
    } catch (error) {
      console.warn(
        `[Bearcade allstars] room${roomId} 对局推进异常(match#${match.matchId})`,
        error,
      );
    }
  }
}

/** 由 onBeforeReset 调用:清掉某房间的对局(**可重复执行**) */
export function resetRoom(roomId: number): void {
  const match = matches.get(roomId);
  if (match) {
    match.cleanup();
    matches.delete(roomId);
  }
}
