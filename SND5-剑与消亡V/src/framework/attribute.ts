// ============================================================
// AttributeSystem —— 账本(架构设计 §4.1)
// 只负责存储与写入 HP / Armor / Mana / TempArmor,不理解状态,
// 不做伤害计算(修饰器逻辑在 CombatPipeline)。
//
// 会话化改造(Bearcade 适配):多房间并发,实例随 MatchSession
// 创建/销毁;对局状态纯内存,不落 DynamicProperties(断线即退出,
// 无热重连,见 development.md §4.7)。
// ============================================================
import type { EntityHealthComponent, Player } from "@minecraft/server";
import type { MatchSession } from "./session";
import type { ResourceTriple } from "./types";
import { applyHurtFeedback } from "./vanilla";

/** 魔力自然回复间隔:每 2 秒(标准规则) */
const MANA_REGEN_INTERVAL_TICKS = 40;
/** 载体血条保底:脚本死亡不触发原版死亡(0.5 = 半颗心) */
const CARRIER_MIN_HEALTH = 0.5;

export interface TempArmorState {
  amount: number;
  expiresAtTick: number;
}

export interface AttributeState {
  id: string;
  /** 职业面板,初始化写入,永不改变(百分比技能按此换算) */
  base: ResourceTriple;
  /** 当前值;允许浮点(吟唱类按 tick 扣魔力) */
  current: ResourceTriple;
  tempArmor: TempArmorState;
}

export interface ApplyDamageResult {
  lethal: boolean;
  actual: { hp: number; armor: number; tempArmor: number };
}

export interface AttributeSnapshot {
  hp: number;
  armor: number;
  mana: number;
  timestamp: number;
}

export class AttributeSystem {
  private readonly states = new Map<string, AttributeState>();
  private lastManaRegenTick = 0;

  constructor(private readonly session: MatchSession) {}

  // ── 初始化与查询 ──────────────────────────────────────────────

  /** 写入职业面板(开局/重生调用;current 归满并同步载体血条) */
  init(playerId: string, base: ResourceTriple): void {
    this.states.set(playerId, {
      id: playerId,
      base: { ...base },
      current: { ...base },
      tempArmor: { amount: 0, expiresAtTick: 0 },
    });
    this.syncToCarrier(playerId);
  }

  has(playerId: string): boolean {
    return this.states.has(playerId);
  }

  get(playerId: string): AttributeState | undefined {
    return this.states.get(playerId);
  }

  require(playerId: string): AttributeState {
    const state = this.states.get(playerId);
    if (!state) throw new Error(`[SND5] 未初始化的属性账本: ${playerId}`);
    return state;
  }

  getHp(playerId: string): number {
    return this.states.get(playerId)?.current.hp ?? 0;
  }

  getArmor(playerId: string): number {
    return this.states.get(playerId)?.current.armor ?? 0;
  }

  getMana(playerId: string): number {
    return this.states.get(playerId)?.current.mana ?? 0;
  }

  getTempArmor(playerId: string): number {
    return this.states.get(playerId)?.tempArmor.amount ?? 0;
  }

  /**
   * 直写生命值:绕过 CombatPipeline(致死拦截成功后补回 1 点等),
   * 与 restore 并列的例外通道,调用处必须注释说明。
   */
  setHp(playerId: string, hp: number): void {
    const state = this.states.get(playerId);
    if (!state) return;
    state.current.hp = Math.max(0, Math.min(state.base.hp, hp));
    this.syncToCarrier(playerId);
  }

  /** 扣魔力(施法预扣/吟唱扣费);不足返回 false,支持浮点余量 */
  spendMana(playerId: string, amount: number): boolean {
    const state = this.states.get(playerId);
    if (!state || state.current.mana + 1e-9 < amount) return false;
    state.current.mana = Math.max(0, state.current.mana - amount);
    return true;
  }

  // ── 伤害写入( CombatPipeline 专用) ────────────────────────────

  /**
   * 应用一次已计算完毕的伤害:
   * ① 真实伤害绕过一切池;② 护甲伤害先临时护甲后普通护甲,不溢出到生命;
   * ③ 生命值伤害独立结算。
   */
  applyDamage(
    playerId: string,
    damage: { hp?: number; armor?: number; trueDamage?: number; sourceId?: string },
  ): ApplyDamageResult {
    const state = this.require(playerId);
    const actual = { hp: 0, armor: 0, tempArmor: 0 };

    // ① 真实伤害
    const trueDamage = Math.max(0, damage.trueDamage ?? 0);
    if (trueDamage > 0) {
      const real = Math.min(Math.max(0, state.current.hp), trueDamage);
      state.current.hp -= real;
      actual.hp += real;
    }

    // ② 护甲伤害:先临时护甲,后普通护甲;扣不完不转生命伤害
    const armorDamage = Math.max(0, damage.armor ?? 0);
    if (armorDamage > 0) {
      let remaining = armorDamage;
      if (state.tempArmor.amount > 0) {
        const absorbed = Math.min(state.tempArmor.amount, remaining);
        state.tempArmor.amount -= absorbed;
        remaining -= absorbed;
        actual.tempArmor += absorbed;
      }
      if (remaining > 0) {
        const armorLoss = Math.min(Math.max(0, state.current.armor), remaining);
        state.current.armor -= armorLoss;
        actual.armor += armorLoss;
      }
    }

    // ③ 生命值伤害
    const hpDamage = Math.max(0, damage.hp ?? 0);
    if (hpDamage > 0) {
      const hpLoss = Math.min(Math.max(0, state.current.hp), hpDamage);
      state.current.hp -= hpLoss;
      actual.hp += hpLoss;
    }

    // 受击反馈(红闪/音效/动画/击退):在写最终血量前借原版伤害
    // 事件触发(见 vanilla.ts 三步法);任何实际伤害都反馈,含 DOT
    if (
      actual.hp + actual.armor + actual.tempArmor > 0 &&
      this.session.config.hurtFeedback
    ) {
      this.triggerHurtFeedback(playerId, damage.sourceId);
    }

    this.syncToCarrier(playerId);
    return { lethal: state.current.hp <= 0, actual };
  }

  /**
   * 受击反馈:解析攻击者(entityAttack 原因才有方向击退),
   * 死亡/旁观状态不反馈。反馈失败不影响数值结算。
   */
  private triggerHurtFeedback(playerId: string, sourceId?: string): void {
    const playerState = this.session.players.get(playerId);
    if (!playerState?.alive) return;
    const attacker = sourceId
      ? this.session.players.get(sourceId)?.player
      : undefined;
    applyHurtFeedback(playerState.player, attacker?.isValid ? attacker : undefined);
  }

  // ── 治疗与回复写入( CombatPipeline 专用) ──────────────────────

  /** 纯数值写入:治疗修正/收束判断在管线,溢出返回给管线发事件 */
  applyHeal(playerId: string, amount: number): { actual: number; overflow: number } {
    const state = this.require(playerId);
    const missing = Math.max(0, state.base.hp - state.current.hp);
    const actual = Math.min(missing, Math.max(0, amount));
    state.current.hp += actual;
    this.syncToCarrier(playerId);
    return { actual, overflow: Math.max(0, amount) - actual };
  }

  restoreMana(playerId: string, amount: number): number {
    const state = this.require(playerId);
    const actual = Math.min(Math.max(0, state.base.mana - state.current.mana), Math.max(0, amount));
    state.current.mana += actual;
    return actual;
  }

  restoreArmor(playerId: string, amount: number): number {
    const state = this.require(playerId);
    const actual = Math.min(
      Math.max(0, state.base.armor - state.current.armor),
      Math.max(0, amount),
    );
    state.current.armor += actual;
    return actual;
  }

  /**
   * 临时护甲:不叠加,取较大值;同值或更小时只刷新到期时间。
   * 它是资源不是状态效果,归 AttributeSystem 管(架构设计 §4.1.5)。
   */
  addTempArmor(playerId: string, amount: number, durationTicks: number): void {
    const state = this.require(playerId);
    const expiresAtTick = this.currentTick() + durationTicks;
    if (amount >= state.tempArmor.amount) {
      state.tempArmor.amount = amount;
      state.tempArmor.expiresAtTick = expiresAtTick;
    } else {
      state.tempArmor.expiresAtTick = Math.max(state.tempArmor.expiresAtTick, expiresAtTick);
    }
  }

  clearTempArmor(playerId: string): void {
    const state = this.states.get(playerId);
    if (!state) return;
    state.tempArmor.amount = 0;
    state.tempArmor.expiresAtTick = 0;
  }

  // ── 快照与恢复(时间回溯/寻光信标) ─────────────────────────────

  snapshot(playerId: string): AttributeSnapshot {
    const state = this.require(playerId);
    return {
      hp: state.current.hp,
      armor: state.current.armor,
      mana: state.current.mana,
      timestamp: this.currentTick(),
    };
  }

  /**
   * 快照恢复:唯一绕过 CombatPipeline 的写入通道之一(另一处是致死拦截
   * 后的 setHp)。不是治疗——不触发治疗修正与溢出逻辑;溢出按 min(base, snap) 截断。
   */
  restore(playerId: string, snap: AttributeSnapshot): void {
    const state = this.require(playerId);
    state.current.hp = Math.min(state.base.hp, Math.max(0, snap.hp));
    state.current.armor = Math.min(state.base.armor, Math.max(0, snap.armor));
    state.current.mana = Math.min(state.base.mana, Math.max(0, snap.mana));
    this.syncToCarrier(playerId);
  }

  // ── 周期结算 ─────────────────────────────────────────────────

  /** 临时护甲到期 + 魔力自然回复(收束类 regenIntercept 状态改为记录) */
  tick(nowTick: number): void {
    for (const state of this.states.values()) {
      if (state.tempArmor.amount > 0 && nowTick >= state.tempArmor.expiresAtTick) {
        state.tempArmor.amount = 0;
        state.tempArmor.expiresAtTick = 0;
      }
    }

    if (nowTick - this.lastManaRegenTick < MANA_REGEN_INTERVAL_TICKS) return;
    this.lastManaRegenTick = nowTick;
    const regen = this.session.config.manaRegenAmount;
    for (const [playerId, state] of this.states) {
      const playerState = this.session.players.get(playerId);
      if (!playerState?.alive || state.current.hp <= 0) continue;
      const interceptor = this.session.status.findRegenInterceptor(playerId);
      if (interceptor) {
        // 收束:记录而非回复,效果结束时全量返还(内容层 onExpire 实现)
        this.session.status.updatePayload(playerId, interceptor.id, (payload) => {
          payload.manaRecorded = (payload.manaRecorded as number | undefined ?? 0) + regen;
        });
        continue;
      }
      state.current.mana = Math.min(state.base.mana, state.current.mana + regen);
    }
  }

  dispose(): void {
    this.states.clear();
  }

  /** 移除单个玩家(离场/断线清理;重生走 init 覆写即可) */
  remove(playerId: string): void {
    this.states.delete(playerId);
  }

  // ── 内部 ─────────────────────────────────────────────────────

  /**
   * 生命值同步采用比例映射到原版血条(玩家 maxHealth=20),
   * 避免原版上限造成溢出;护甲/魔力为纯脚本值无需同步。
   * SND5 的死亡是脚本层面的死亡:载体永远残血存活,判定归 CombatPipeline。
   * 即使 SND5 生命已归零也只写 0.5 保底——向载体写 0 会直接触发
   * 原版死亡(死亡界面/掉落),「已死亡」的表现由 handleDeath 的
   * 旁观模式切换承担,而不是血条清零。
   */
  private syncToCarrier(playerId: string): void {
    const state = this.states.get(playerId);
    const playerState = this.session.players.get(playerId);
    if (!state || !playerState) return;
    const player: Player | undefined = playerState.player;
    if (!player.isValid) return;
    const health = player.getComponent("minecraft:health") as EntityHealthComponent | undefined;
    if (!health) return;
    try {
      const max = health.effectiveMax || 20;
      const ratio = Math.max(0, state.current.hp) / Math.max(1, state.base.hp);
      const display = Math.max(CARRIER_MIN_HEALTH, ratio * max);
      health.setCurrentValue(Math.min(max, Math.max(CARRIER_MIN_HEALTH, display)));
    } catch {
      // 载体可能已失效(离开房间等),由 syncPlayers 兜底清理
    }
  }

  private currentTick(): number {
    return this.session.nowTick();
  }
}
