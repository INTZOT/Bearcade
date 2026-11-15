// ============================================================
// SkillSystem —— 施法调度中枢(架构设计 §4.4)
// 五阶段生命周期:路由 → 校验 → 预扣 → 执行 → 结算。
// 四种 castMode 共享同一套校验与结算,只有施法体的调用时机不同:
// - instant:按下即结算(抓钩/定锚/秘典法术)
// - charge:长按积累,松手按累积值结算(坦克重击/大招)
// - windup:按下后固定前摇(坦克固有Ⅱ)
// - channel:长按持续结算,松手停止(控制固有Ⅱ)
//
// 冷却由 CastResult 意图驱动(§4.4.7):技能不直接写 CooldownStore;
// 「施法成功但冷却不同」的三处分支(定锚命中/落地/群法切定律)
// 统一收口在 settle / applyCooldown。
// ============================================================
import { system, type Player } from "@minecraft/server";
import type { MatchSession } from "../session";
import { CooldownStore, StackStore, skillKey } from "./stores";
import type {
  CastContext,
  CastFailReason,
  CastOutcome,
  CastResult,
  CooldownBranchName,
  SkillDefinition,
  SkillSlot,
} from "./types";
import { normalizeCastResult } from "./types";

/**
 * 物品绑定表:内容层把技能物品 typeId 映射到 skillId,
 * 输入适配层(listeners.ts)据此把 itemUse/itemStartUse 等事件路由进来。
 */
export const skillItemBindings = new Map<string, string>();

interface ActiveCast {
  kind: "charge" | "windup" | "channel";
  def: SkillDefinition;
  ctx: CastContext;
  startedTick: number;
  lastActionTick: number;
}

/** 进行中施法的只读视图(IndicatorSystem 轮询/调试用;调用方不得修改) */
export interface ActiveCastView {
  readonly kind: "charge" | "windup" | "channel";
  readonly def: SkillDefinition;
  readonly ctx: CastContext;
  readonly startedTick: number;
}

export class SkillSystem {
  private readonly cooldowns = new CooldownStore();
  private readonly stacks = new StackStore();
  private readonly passiveCooldowns = new CooldownStore();
  /** Map<playerId, Map<skillId, 私有存储>>(二段施法状态) */
  private readonly privateStores = new Map<string, Map<string, Map<string, unknown>>>();
  /** 进行中的蓄力/前摇/吟唱,键为 playerId(同一玩家同时只允许一个) */
  private readonly activeCasts = new Map<string, ActiveCast>();
  /** Map<playerId, Partial<Record<slot, skillId>>> */
  private readonly loadouts = new Map<string, Record<string, string>>();
  /** 同 tick 去重:部分原版物品 itemUse / itemStartUse 会同时到达 */
  private readonly lastInstantCast = new Map<string, { skillId: string; tick: number }>();
  private lastSweepTick = 0;
  private readonly busOffs: Array<() => void> = [];

  constructor(private readonly session: MatchSession) {
    // 冷却结束 → 堆叠回满(串联语义,§4.4.8;两个 store 互不 import,靠事件解耦)
    this.busOffs.push(
      this.session.bus.on("cooldown.end", ({ playerId, skillId }) => {
        const def = this.session.content.skills.get(skillId);
        if (def && (def.stackRecoveryTicks ?? null) !== null) return; // 逐层恢复型不走回满
        this.stacks.refill(skillKey(playerId, skillId));
      }),
    );
    // 施法中受伤打断(蓄力/前摇;打断退还预扣)
    this.busOffs.push(
      this.session.bus.on("entity.damaged", ({ targetId }) => {
        this.interruptCast(targetId, "受伤");
      }),
    );
  }

  // ── 装备映射(职业装载写入) ────────────────────────────────────

  equip(playerId: string, slot: string, skillId?: string): void {
    let loadout = this.loadouts.get(playerId);
    if (!loadout) {
      loadout = {};
      this.loadouts.set(playerId, loadout);
    }
    if (skillId) loadout[slot] = skillId;
    else delete loadout[slot];
    // 秘典在开局/重生时随物品重发,禁用(耗尽)状态一并复位
    if (skillId && (slot === "codex_1" || slot === "codex_2")) {
      this.refillStacks(playerId, skillId);
    }
  }

  getEquipped(playerId: string, slot: string): SkillDefinition | undefined {
    const skillId = this.loadouts.get(playerId)?.[slot];
    return skillId ? this.session.content.skills.get(skillId) : undefined;
  }

  getLoadout(playerId: string): Readonly<Record<string, string>> {
    return this.loadouts.get(playerId) ?? {};
  }

  // ── 输入入口(listeners.ts 调用) ──────────────────────────────

  /** 右键使用(itemUse)→ 按施法模式分发 */
  requestCast(player: Player, skillId: string): void {
    const def = this.session.content.skills.get(skillId);
    if (!def) return;
    switch (def.castMode ?? "instant") {
      case "instant":
        this.castInstant(player, def);
        break;
      case "windup":
        this.beginTimedCast(player, def, "windup");
        break;
      case "charge":
        this.beginCharge(player, def);
        break;
      case "channel":
        this.beginChannel(player, def);
        break;
    }
  }

  /**
   * 开始使用(itemStartUse):蓄力/前摇/吟唱开始。
   * instant 技能在这里也分发一次,但与 itemUse 的重复由 castInstant 的
   * 同 tick 去重兜住 —— 部分原版物品会同时触发两类事件,不同物品又可能
   * 只有其中一类(占位阶段无法逐个实测),两条路都留才稳妥。
   */
  beginUse(player: Player, skillId: string): void {
    const def = this.session.content.skills.get(skillId);
    if (!def) return;
    switch (def.castMode ?? "instant") {
      case "charge":
        this.beginCharge(player, def);
        break;
      case "channel":
        this.beginChannel(player, def);
        break;
      case "windup":
        this.beginTimedCast(player, def, "windup");
        break;
      default:
        this.castInstant(player, def);
        break;
    }
  }

  /** 松手(itemReleaseUse):蓄力释放 / 吟唱停止 */
  releaseUse(player: Player): void {
    const cast = this.activeCasts.get(player.id);
    if (!cast) return;
    if (cast.kind === "charge") this.finishCharge(cast, false);
    else if (cast.kind === "channel") this.stopChannel(cast, false);
  }

  /** 使用完成(itemCompleteUse):蓄满自动释放 */
  completeUse(player: Player, skillId: string): void {
    const cast = this.activeCasts.get(player.id);
    if (!cast || cast.kind !== "charge" || cast.def.id !== skillId) return;
    this.finishCharge(cast, true);
  }

  /** 打断进行中的施法(受伤/死亡;退还预扣,不进冷却) */
  interruptCast(playerId: string, reason: string): void {
    const cast = this.activeCasts.get(playerId);
    if (!cast) return;
    if (cast.def.interruptible === false) return;
    if (cast.kind === "channel") {
      // 吟唱只受魔力枯竭与主动松手控制,受伤不打断
      return;
    }
    this.activeCasts.delete(playerId);
    this.refundPrededucted(cast.ctx);
    const player = cast.ctx.player;
    if (player.isValid) {
      this.session.hud.toast(player, `§c施法被打断(${reason})`);
    }
  }

  // ── 校验 / 预扣(五阶段之 2/3) ────────────────────────────────

  /** 校验失败固定顺序:存活 → 装备 → 冷却 → 堆叠 → 魔力 → 潜行 → 状态 */
  private validate(playerId: string, def: SkillDefinition, ctx: CastContext): CastFailReason | null {
    const state = this.session.players.get(playerId);
    if (!state?.alive) return "dead";

    const loadout = this.loadouts.get(playerId);
    if (!loadout || !Object.values(loadout).includes(def.id)) return "not_equipped";

    const now = system.currentTick;
    if (!this.cooldowns.isReady(skillKey(playerId, def.id), now)) return "cooldown";

    if (!this.stackAvailable(playerId, def)) return "no_stacks";

    const cost = this.resolveManaCost(def, ctx);
    if (cost > 0 && !def.allowInsufficientMana && !def.hpSubstitute) {
      if (this.session.attributes.getMana(playerId) + 1e-9 < cost) return "no_mana";
    }

    if (def.requiresSneak && !ctx.isSneaking) return "sneak_required";
    if (def.forbidSneak && ctx.isSneaking) return "sneak_forbidden";
    for (const statusId of def.requiresStatus ?? []) {
      if (!this.session.status.has(playerId, statusId)) return "status_required";
    }
    for (const statusId of def.forbidsStatus ?? []) {
      if (this.session.status.has(playerId, statusId)) return "status_forbidden";
    }
    return null;
  }

  private stackAvailable(playerId: string, def: SkillDefinition): boolean {
    const entry = this.stacks.get(skillKey(playerId, def.id));
    if (!entry || entry.current > 0) return true;
    return def.canIgnoreStackCheck?.(this.session, playerId) === true;
  }

  private resolveManaCost(def: SkillDefinition, ctx: CastContext): number {
    if (!def.manaCost) return 0;
    return typeof def.manaCost === "function" ? def.manaCost(ctx) : def.manaCost;
  }

  /**
   * 预扣顺序:先扣魔力,后扣堆叠(「堆叠为 0 但魔力够」是最常见的
   * 失败场景,先扣魔力会造成退还的麻烦)。校验失败不扣任何资源。
   */
  private prededuct(ctx: CastContext): boolean {
    const def = ctx.def;
    const cost = this.resolveManaCost(def, ctx);
    if (cost > 0) {
      const attributes = this.session.attributes;
      const available = attributes.getMana(ctx.casterId);
      if (available + 1e-9 < cost) {
        if (def.allowInsufficientMana) {
          // 不足也触发:消耗当前全部魔力(控制被动)
          attributes.spendMana(ctx.casterId, available);
          ctx.predeductedMana = available;
        } else if (def.hpSubstitute) {
          // 魔力不足部分用生命值代替(群法被动;血魔合计不足时拒绝)
          const deficit = cost - available;
          const hp = attributes.getHp(ctx.casterId);
          if (hp + available + 1e-9 < cost) return false;
          attributes.spendMana(ctx.casterId, available);
          if (deficit > 0) attributes.applyDamage(ctx.casterId, { trueDamage: deficit });
          ctx.predeductedMana = available;
        } else {
          return false;
        }
      } else {
        attributes.spendMana(ctx.casterId, cost);
        ctx.predeductedMana = cost;
      }
    }
    // 后扣堆叠
    const max = def.maxStacks ?? 1;
    const key = skillKey(ctx.casterId, def.id);
    this.stacks.initIfAbsent(key, max, def.stackRecoveryTicks ?? undefined, system.currentTick);
    ctx.predeductedStacks = this.stacks.consume(key);
    return true;
  }

  /**
   * 退还预扣资源。
   * @param options.mana 只退部分魔力(突进未命中);缺省全退
   * @param options.stacks 是否退还堆叠;成功结算的部分退款传 false(堆叠照常消耗)
   */
  private refundPrededucted(ctx: CastContext, options?: { mana?: number; stacks?: boolean }): void {
    if (ctx.predeductedMana > 0) {
      const refund = options?.mana ?? ctx.predeductedMana;
      this.session.attributes.restoreMana(ctx.casterId, Math.min(ctx.predeductedMana, refund));
      ctx.predeductedMana = 0;
    }
    if ((options?.stacks ?? true) && ctx.predeductedStacks) {
      this.stacks.refund(skillKey(ctx.casterId, ctx.skillId));
      ctx.predeductedStacks = false;
    }
  }

  // ── 执行与结算(五阶段之 4/5) ─────────────────────────────────

  private castInstant(player: Player, def: SkillDefinition): void {
    // 同 tick 去重:itemUse 与 itemStartUse 都路由到 instant 技能时只放一次
    const now = system.currentTick;
    const last = this.lastInstantCast.get(player.id);
    if (last && last.skillId === def.id && last.tick === now) return;
    this.lastInstantCast.set(player.id, { skillId: def.id, tick: now });

    const ctx = this.buildContext(player, def);
    const fail = this.validate(player.id, def, ctx);
    if (fail) {
      this.failCast(player, def, fail);
      return;
    }
    if (!this.prededuct(ctx)) {
      this.failCast(player, def, "no_mana");
      return;
    }
    this.executeCast(def, ctx);
  }

  private beginTimedCast(player: Player, def: SkillDefinition, kind: "windup"): void {
    if (this.activeCasts.has(player.id)) return;
    const ctx = this.buildContext(player, def);
    const fail = this.validate(player.id, def, ctx);
    if (fail) {
      this.failCast(player, def, fail);
      return;
    }
    if (!this.prededuct(ctx)) {
      this.failCast(player, def, "no_mana");
      return;
    }
    this.activeCasts.set(player.id, {
      kind,
      def,
      ctx,
      startedTick: system.currentTick,
      lastActionTick: system.currentTick,
    });
  }

  private beginCharge(player: Player, def: SkillDefinition): void {
    if (this.activeCasts.has(player.id)) return;
    const ctx = this.buildContext(player, def);
    const fail = this.validate(player.id, def, ctx);
    if (fail) {
      this.failCast(player, def, fail);
      return;
    }
    if (!this.prededuct(ctx)) {
      this.failCast(player, def, "no_mana");
      return;
    }
    this.activeCasts.set(player.id, {
      kind: "charge",
      def,
      ctx,
      startedTick: system.currentTick,
      lastActionTick: system.currentTick,
    });
  }

  private beginChannel(player: Player, def: SkillDefinition): void {
    if (this.activeCasts.has(player.id)) return;
    const ctx = this.buildContext(player, def);
    const fail = this.validate(player.id, def, ctx);
    if (fail) {
      this.failCast(player, def, fail);
      return;
    }
    // 吟唱魔力逐 tick 扣(控制固有Ⅱ 每秒 2 点),开始时不预扣
    this.activeCasts.set(player.id, {
      kind: "channel",
      def,
      ctx,
      startedTick: system.currentTick,
      lastActionTick: system.currentTick,
    });
  }

  /** 统一执行施法体(潜行变体在入口分发,技能内部不写 if) */
  private executeCast(def: SkillDefinition, ctx: CastContext): void {
    const handler = ctx.isSneaking && def.castSneaking ? def.castSneaking : def.cast;
    if (!handler) {
      // 无施法体(被动误入施法流程等):退款并失败
      this.refundPrededucted(ctx);
      this.failCast(ctx.player, def, "failed");
      return;
    }
    let result: CastResult;
    try {
      result = handler.call(def, ctx);
    } catch (error) {
      console.warn(`[SND5] 技能执行异常 ${def.id}`, error);
      result = false;
    }
    const outcome = normalizeCastResult(result);
    if (!outcome.ok) {
      this.refundPrededucted(ctx);
      this.failCast(ctx.player, def, "failed");
      return;
    }
    this.settle(ctx, outcome);
  }

  /** 结算:发事件 → CastResult 意图驱动冷却与堆叠 */
  private settle(ctx: CastContext, outcome: CastOutcome): void {
    this.session.bus.emit("skill.cast", {
      casterId: ctx.casterId,
      skillId: ctx.skillId,
      slot: ctx.slot,
      outcome,
    });

    const key = skillKey(ctx.casterId, ctx.skillId);
    const stackEntry = this.stacks.get(key);
    const exhausted = !stackEntry || stackEntry.current <= 0;
    if (outcome.suppressCooldown) return; // 冷却由技能稍后 requestCooldown 显式申请

    // 部分退款(战士突进未命中):只退魔力,堆叠已消耗、冷却照常结算
    if (outcome.refundMana) {
      this.refundPrededucted(ctx, { mana: outcome.refundMana, stacks: false });
    }

    const ticks =
      outcome.cooldownTicks ??
      this.resolveCooldownTicks(ctx.def, outcome.cooldown ?? "ready", ctx);
    if (exhausted) this.cooldowns.start(key, Math.max(0, ticks), system.currentTick);
  }

  /** 显式冷却申请(原语 requestCooldown 的落点) */
  applyCooldown(playerId: string, skillId: string, branch: CooldownBranchName | number): void {
    const def = this.session.content.skills.get(skillId);
    if (!def) return;
    const ticks =
      typeof branch === "number"
        ? branch
        : this.resolveCooldownBranch(def, branch);
    this.cooldowns.start(skillKey(playerId, skillId), Math.max(0, ticks), system.currentTick);
  }

  /** 刷新主动技能冷却(辅助固有Ⅰ:范围内友方主动技 CD 立即就绪) */
  refreshCooldowns(playerId: string, slots: SkillSlot[]): void {
    for (const slot of slots) {
      const def = this.getEquipped(playerId, slot);
      if (def) this.cooldowns.reset(skillKey(playerId, def.id));
    }
  }

  getCooldownRemaining(playerId: string, skillId: string): number {
    return this.cooldowns.getRemaining(skillKey(playerId, skillId), system.currentTick);
  }

  isReady(playerId: string, skillId: string): boolean {
    return this.cooldowns.isReady(skillKey(playerId, skillId), system.currentTick);
  }

  /**
   * 秘典禁用判定:堆叠实例存在且已归零(无实例 = 尚未使用,视为可用)。
   * 秘典 suppressCooldown 无冷却,耗尽后只能由补给站/重生复位。
   */
  isExhausted(playerId: string, skillId: string): boolean {
    const entry = this.stacks.get(skillKey(playerId, skillId));
    return !!entry && entry.current <= 0;
  }

  /** 充能:堆叠回满(补给站补充 / 开局重生重发物品时复位禁用态) */
  refillStacks(playerId: string, skillId: string): void {
    const def = this.session.content.skills.get(skillId);
    if (!def) return;
    const key = skillKey(playerId, skillId);
    this.stacks.initIfAbsent(key, def.maxStacks ?? 1, def.stackRecoveryTicks ?? undefined, system.currentTick);
    this.stacks.refill(key);
  }

  // ── 周期推进 ─────────────────────────────────────────────────

  tick(nowTick: number): void {
    // 蓄力/前摇/吟唱推进
    for (const [playerId, cast] of [...this.activeCasts]) {
      // 真实经过 tick(指示器移动/蓄力进度以这里为准,chargeTicks 是回调计数)
      cast.ctx.castElapsedTicks = nowTick - cast.startedTick;
      // 潜行按结算时点判定(蓄力松手/前摇完成时的潜行变体分发依据)
      if (cast.ctx.player.isValid) cast.ctx.isSneaking = cast.ctx.player.isSneaking;
      if (cast.kind === "charge") this.tickCharge(cast, nowTick);
      else if (cast.kind === "channel") this.tickChannel(cast, nowTick);
      else if (cast.kind === "windup" && nowTick - cast.startedTick >= (cast.def.windupTicks ?? 0)) {
        // 前摇完成:执行施法体并结算
        this.activeCasts.delete(playerId);
        this.executeCast(cast.def, cast.ctx);
      }
      // 玩家失效(离线/换维度)兜底清理
      if (!cast.ctx.player.isValid) {
        this.activeCasts.delete(playerId);
        this.refundPrededucted(cast.ctx);
      }
    }

    // 冷却到期扫描(每 5 tick 一次足够;到期只发一次 cooldown.end)
    if (nowTick - this.lastSweepTick >= 5) {
      this.lastSweepTick = nowTick;
      this.cooldowns.sweep(nowTick, (key) => {
        const [playerId, skillId] = key.split("::");
        if (playerId && skillId) {
          this.session.bus.emit("cooldown.end", { playerId, skillId });
        }
      });
      this.stacks.tickRecoveryAll(nowTick);
    }
  }

  private tickCharge(cast: ActiveCast, nowTick: number): void {
    const config = cast.def.chargeConfig;
    if (!config) {
      this.activeCasts.delete(cast.ctx.casterId);
      return;
    }
    const interval = config.tickIntervalTicks ?? 1;
    if (nowTick - cast.lastActionTick < interval) return;
    cast.lastActionTick = nowTick;
    cast.ctx.chargeTicks += interval;
    cast.ctx.chargePercent = Math.min(1, cast.ctx.chargeTicks / config.maxTicks);
    try {
      config.onChargeTick?.(cast.ctx);
    } catch (error) {
      console.warn(`[SND5] 蓄力回调异常 ${cast.def.id}`, error);
    }
    // 蓄满自动释放
    if (cast.ctx.chargeTicks >= config.maxTicks) this.finishCharge(cast, true);
  }

  /** 蓄力释放;minTicks 之前松手无效(坦克重击 10% 强制蓄力) */
  private finishCharge(cast: ActiveCast, forced: boolean): void {
    const config = cast.def.chargeConfig;
    const minTicks = config?.minTicks ?? 0;
    if (!forced && cast.ctx.chargeTicks < minTicks) return; // 强制继续蓄力
    this.activeCasts.delete(cast.ctx.casterId);
    this.executeCast(cast.def, cast.ctx);
  }

  private tickChannel(cast: ActiveCast, nowTick: number): void {
    if (nowTick - cast.lastActionTick < 1) return;
    cast.lastActionTick = nowTick;
    cast.ctx.channelTicks += 1;
    // 吟唱魔力按 tick 折算(每秒 2 点 → 每 tick 0.1),扣不动即停止
    const perSecondCost = this.resolveManaCost(cast.def, cast.ctx);
    if (perSecondCost > 0) {
      const perTickCost = perSecondCost / 20;
      if (!this.session.attributes.spendMana(cast.ctx.casterId, perTickCost)) {
        this.stopChannel(cast, true);
        return;
      }
    }
    try {
      cast.def.onChannelTick?.(cast.ctx);
    } catch (error) {
      console.warn(`[SND5] 吟唱回调异常 ${cast.def.id}`, error);
    }
  }

  /** 吟唱停止(松手/魔力枯竭):onChannelEnd 后按 ready 分支结算 */
  private stopChannel(cast: ActiveCast, exhausted: boolean): void {
    this.activeCasts.delete(cast.ctx.casterId);
    try {
      cast.def.onChannelEnd?.(cast.ctx);
    } catch (error) {
      console.warn(`[SND5] 吟唱结束回调异常 ${cast.def.id}`, error);
    }
    if (exhausted) {
      this.session.hud.toast(cast.ctx.player, "§c魔力不足,吟唱中断");
    }
    // 吟唱结算:正常走 ready 冷却
    this.settle(cast.ctx, { ok: true });
  }

  // ── 被动(委托 PassiveManager,见 passives.ts) ─────────────────

  attachPassives(playerId: string, defs: readonly SkillDefinition[]): void {
    this.session.passives.attach(playerId, defs);
  }

  isPassiveReady(playerId: string, passiveId: string): boolean {
    return this.passiveCooldowns.isReady(`${playerId}::passive::${passiveId}`, system.currentTick);
  }

  startPassiveCooldown(playerId: string, passiveId: string, ticks: number): void {
    this.passiveCooldowns.start(`${playerId}::passive::${passiveId}`, ticks, system.currentTick);
  }

  // ── 查询/清理 ────────────────────────────────────────────────

  /** 当前全部进行中的施法(指示器轮询/调试用;返回快照副本) */
  getActiveCasts(): ActiveCastView[] {
    return [...this.activeCasts.values()];
  }

  privateStore(playerId: string, skillId: string): Map<string, unknown> {
    let bySkill = this.privateStores.get(playerId);
    if (!bySkill) {
      bySkill = new Map();
      this.privateStores.set(playerId, bySkill);
    }
    let store = bySkill.get(skillId);
    if (!store) {
      store = new Map();
      bySkill.set(skillId, store);
    }
    return store;
  }

  clearPrivateStore(playerId: string, skillId: string): void {
    this.privateStores.get(playerId)?.delete(skillId);
  }

  /** HUD 冷却摘要:每槽位一行「名称 剩余秒/就绪」;秘典不走冷却行(状态在物品名色标),重击无 CD 也不展示 */
  getCooldownSummary(playerId: string): string[] {
    const lines: string[] = [];
    for (const [slot, skillId] of Object.entries(this.getLoadout(playerId))) {
      if (slot === "codex_1" || slot === "codex_2" || slot === "weapon_heavy") continue;
      const def = this.session.content.skills.get(skillId);
      if (!def) continue;
      const remaining = this.cooldowns.getRemaining(skillKey(playerId, skillId), system.currentTick);
      const stacks = this.stacks.get(skillKey(playerId, skillId))?.current ?? (def.maxStacks ?? 1);
      const state =
        remaining > 0 ? `§e${Math.ceil(remaining / 20)}s` : stacks > 0 ? "§a就绪" : "§7耗尽";
      const stacksText = (def.maxStacks ?? 1) > 1 && stacks > 0 ? `§7×${stacks}` : "";
      lines.push(`§f${def.displayName}${stacksText}§7[${SLOT_LABELS[slot] ?? slot}] ${state}`);
    }
    return lines;
  }

  detachPlayer(playerId: string): void {
    this.session.passives.detach(playerId);
    const cast = this.activeCasts.get(playerId);
    if (cast) {
      this.refundPrededucted(cast.ctx);
      this.activeCasts.delete(playerId);
    }
    this.loadouts.delete(playerId);
    this.cooldowns.resetForPlayer(playerId);
    this.passiveCooldowns.resetForPlayer(playerId);
    this.stacks.clearForPlayer(playerId);
    this.privateStores.delete(playerId);
    this.lastInstantCast.delete(playerId);
  }

  dispose(): void {
    for (const off of this.busOffs) off();
    this.busOffs.length = 0;
    for (const cast of this.activeCasts.values()) this.refundPrededucted(cast.ctx);
    this.activeCasts.clear();
    this.loadouts.clear();
    this.cooldowns.dispose();
    this.passiveCooldowns.dispose();
    this.stacks.dispose();
    this.privateStores.clear();
    this.lastInstantCast.clear();
  }

  // ── 内部 ─────────────────────────────────────────────────────

  private buildContext(player: Player, def: SkillDefinition): CastContext {
    return {
      session: this.session,
      player,
      casterId: player.id,
      skillId: def.id,
      def,
      slot: def.slot,
      isSneaking: player.isSneaking,
      direction: player.getViewDirection(),
      chargeTicks: 0,
      chargePercent: 0,
      channelTicks: 0,
      castElapsedTicks: 0,
      predeductedMana: 0,
      predeductedStacks: false,
      store: this.privateStore(player.id, def.id),
      primitives: this.session.primitives,
    };
  }

  private failCast(player: Player, def: SkillDefinition, reason: CastFailReason): void {
    const hint = def.failureHint?.[reason] ?? FAILURE_HINTS[reason];
    if (player.isValid) this.session.hud.toast(player, `§7${hint}`);
    this.session.bus.emit("skill.castFailed", {
      casterId: player.id,
      skillId: def.id,
      reason,
      hint,
    });
  }

  private resolveCooldownTicks(
    def: SkillDefinition,
    branch: CooldownBranchName,
    ctx: CastContext,
  ): number {
    if (typeof def.cooldown === "function") return def.cooldown(ctx) ?? 0;
    if (typeof def.cooldown === "number") {
      return branch === "ready" ? def.cooldown : this.resolveCooldownBranch(def, branch);
    }
    return this.resolveCooldownBranch(def, branch);
  }

  private resolveCooldownBranch(def: SkillDefinition, branch: CooldownBranchName): number {
    if (typeof def.cooldown === "number") return def.cooldown;
    if (typeof def.cooldown === "function") return 0;
    const value = def.cooldown[branch];
    return value ?? def.cooldown.ready;
  }
}

const FAILURE_HINTS: Record<CastFailReason, string> = {
  dead: "无法行动",
  not_equipped: "技能未装备",
  cooldown: "技能冷却中",
  no_stacks: "技能次数耗尽",
  no_mana: "魔力不足",
  sneak_required: "需要潜行施放",
  sneak_forbidden: "潜行状态无法施放",
  status_required: "缺少前置状态",
  status_forbidden: "当前状态无法施放",
  failed: "施法失败",
};

/** HUD 槽位缩写(内容层槽位键 → 玩家可读标签) */
const SLOT_LABELS: Record<string, string> = {
  innate_1: "固有Ⅰ",
  innate_2: "固有Ⅱ",
  codex_1: "秘典Ⅰ",
  codex_2: "秘典Ⅱ",
  weapon_heavy: "重击",
};
