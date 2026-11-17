// ============================================================
// 群法相关状态(内容设计 PDF 第 18-22 页)
// - 魔力残留: 8s;每秒回 1 魔力;受电伤额外扣 3 魔力/
//   受火伤额外扣 3 护甲/受水伤清除并掉落液态魔力
// - 魔力凝聚: 持续至下次轻击;下次轻击进阶「此为至纯魔力的一击」
// - 电离/焙烧/浸润: 互斥三角;「获得本效果时」按被清空的互斥对象
//   立即结算(框架 excludedPresent 传递,见 StatusContext)
// - 隐藏跟进状态: 元素易伤小窗口(不出现在职业文档,仅作反应余波)
// ============================================================
import { statusRegistry } from "../../framework";
import type { MatchSession } from "../../framework";

export const STATUS_MANA_RESIDUE = "snd5:mana_residue";
export const STATUS_MANA_CONDENSE = "snd5:mana_condense";
export const STATUS_IONIZE = "snd5:ionize";
export const STATUS_ROAST = "snd5:roast";
export const STATUS_SOAK = "snd5:soak";

/** 隐藏跟进状态:电离×火,3 秒内电/火伤 +3 */
const STATUS_SCORCH_SURGE = "snd5:scorch_surge";
/** 隐藏跟进状态:焙烧×水,2 秒受伤 +50% */
const STATUS_ROAST_VULN = "snd5:roast_vuln";
/** 隐藏跟进状态:浸润×电,4 秒电伤 +3 */
const STATUS_SOAK_SURGE = "snd5:soak_surge";
/** 隐藏跟进状态:定律Ⅲ×焙烧,2 秒护甲伤害 +50% */
export const STATUS_ARMOR_BRITTLE = "snd5:armor_brittle";
/** 隐藏跟进状态:定律Ⅲ×电离,2 秒电伤 +10% */
export const STATUS_ELECTRIC_FRAGILE = "snd5:electric_fragile";

// ── 通用小工具 ──────────────────────────────────────────────────

/** 立即结算一笔追加伤害(on-gain 反应/元素易伤跟进) */
function dealFollowUp(
  session: MatchSession,
  sourceId: string | undefined,
  targetId: string,
  payload: Parameters<MatchSession["combat"]["dealDamage"]>[2],
): void {
  try {
    session.combat.dealDamage(sourceId, targetId, payload);
  } catch (error) {
    console.warn("[SND5] 群法追加伤害结算异常", error);
  }
}

/**
 * 延迟 1 tick 的固定跟进伤害。
 * onDamageTaken 钩子在 combat.beforeDamage 内触发,直接嵌套 dealDamage
 * 会再次进入本目标的钩子链;延迟一拍并把元素改为物理即可天然切断递归
 * (跟进伤害不再是电/火/水元素,不满足易伤条件)。
 */
function scheduleFollowUpDamage(
  session: MatchSession,
  sourceId: string | undefined,
  targetId: string,
  amount: number,
): void {
  session.primitives.schedule(1, () => {
    if (session.isDead(targetId)) return;
    dealFollowUp(session, sourceId, targetId, {
      hp: amount,
      element: "physical",
      tags: ["reaction"],
    });
  });
}

// ── 液态魔力(魔力残留受水伤掉落;不可破坏创生物占位) ────────────

/** 1 秒后爆炸:半径 3 格敌方 10 点伤害 + 友方回复 5 点魔力 */
function dropLiquidMana(session: MatchSession, ownerId: string, location: { x: number; y: number; z: number }): void {
  session.primitives.spawnSummon("minecraft:armor_stand", location, {
    ownerId,
    lifetimeTicks: 20, // 1 秒
    onExpire: () => {
      for (const state of session.primitives.enemyPlayersInRadius(ownerId, location, 3)) {
        // 元素保持物理:避免水伤再次触发目标的魔力残留掉落(无限连锁)
        dealFollowUp(session, ownerId, state.id, {
          hp: 10,
          element: "physical",
          tags: ["skill"],
        });
      }
      // 友方(含施法者自身)回复 5 点魔力
      for (const state of session.primitives.allyPlayersInRadius(ownerId, location, 3)) {
        session.primitives.restoreMana(state.id, 5);
      }
      if (session.players.has(ownerId)) session.primitives.restoreMana(ownerId, 5);
    },
  });
}

// ── 正面状态 ────────────────────────────────────────────────────

statusRegistry.register({
  id: STATUS_MANA_RESIDUE,
  displayName: "魔力残留",
  kind: "buff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 160, // 8 秒
  clearable: true,
  tickIntervalTicks: 20, // 每秒 +1 魔力
  onTick(ctx) {
    ctx.session.primitives.restoreMana(ctx.targetId, 1);
  },
  // 元素受击附加效果(框架 onDamageTaken 携带元素快照)
  onDamageTaken(ctx) {
    if (ctx.damage.element === "electric") {
      // 受电伤:额外扣除 3 点魔力(直写账本,不走伤害管线)
      ctx.session.attributes.spendMana(ctx.targetId, 3);
    } else if (ctx.damage.element === "fire") {
      // 受火伤:额外扣除 3 点护甲(直写账本)
      ctx.session.attributes.applyDamage(ctx.targetId, { armor: 3 });
    } else if (ctx.damage.element === "water") {
      // 受水伤:清除本效果,原地掉落一团液态魔力
      const player = ctx.session.players.get(ctx.targetId);
      ctx.removeSelf();
      if (player?.player.isValid) {
        dropLiquidMana(ctx.session, ctx.instance.sourceId ?? ctx.targetId, {
          x: player.player.location.x,
          y: player.player.location.y,
          z: player.player.location.z,
        });
      }
    }
  },
});

statusRegistry.register({
  id: STATUS_MANA_CONDENSE,
  displayName: "魔力凝聚",
  kind: "buff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: -1, // 持续至下次轻击(武器侧消费后移除)
  clearable: true,
});

// ── 互斥三角(获得本效果时按被清空的互斥对象立即结算) ────────────

statusRegistry.register({
  id: STATUS_IONIZE,
  displayName: "电离",
  kind: "debuff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 300, // 15 秒
  clearable: true,
  excludes: [STATUS_ROAST, STATUS_SOAK],
  onApply(ctx) {
    const sourceId = ctx.instance.sourceId;
    if (ctx.excludedPresent?.includes(STATUS_SOAK)) {
      // 清空浸润:1 秒内受到 2 次 3 点电元素伤害
      ctx.session.primitives.scheduleRepeating(10, 2, () => {
        if (!ctx.session.isDead(ctx.targetId)) {
          dealFollowUp(ctx.session, sourceId, ctx.targetId, {
            hp: 3,
            element: "electric",
            tags: ["reaction"],
          });
        }
      });
    }
    if (ctx.excludedPresent?.includes(STATUS_ROAST)) {
      // 清空焙烧:受到 10 点火元素伤害,3 秒内电/火伤 +3
      dealFollowUp(ctx.session, sourceId, ctx.targetId, {
        hp: 10,
        element: "fire",
        tags: ["reaction"],
      });
      ctx.session.status.apply(ctx.targetId, STATUS_SCORCH_SURGE, sourceId);
    }
  },
});

statusRegistry.register({
  id: STATUS_ROAST,
  displayName: "焙烧",
  kind: "debuff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 360, // 18 秒
  clearable: true,
  excludes: [STATUS_IONIZE, STATUS_SOAK],
  onApply(ctx) {
    const sourceId = ctx.instance.sourceId;
    if (ctx.excludedPresent?.includes(STATUS_IONIZE)) {
      // 清空电离:受到 10 点火元素伤害,被炸飞
      dealFollowUp(ctx.session, sourceId, ctx.targetId, {
        hp: 10,
        element: "fire",
        tags: ["reaction"],
      });
      ctx.session.primitives.launch(ctx.targetId, 0.8);
    }
    if (ctx.excludedPresent?.includes(STATUS_SOAK)) {
      // 清空浸润:受到 15 点护甲伤害与 8 点生命值伤害,受伤 +50%(2s)
      dealFollowUp(ctx.session, sourceId, ctx.targetId, {
        hp: 8,
        armor: 15,
        element: "physical",
        tags: ["reaction"],
      });
      ctx.session.status.apply(ctx.targetId, STATUS_ROAST_VULN, sourceId);
    }
  },
});

statusRegistry.register({
  id: STATUS_SOAK,
  displayName: "浸润",
  kind: "debuff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 400, // 20 秒
  clearable: true,
  excludes: [STATUS_ROAST, STATUS_IONIZE],
  onApply(ctx) {
    const sourceId = ctx.instance.sourceId;
    if (ctx.excludedPresent?.includes(STATUS_ROAST)) {
      // 清空焙烧:受到 30 点护甲伤害与 10 点生命值伤害
      dealFollowUp(ctx.session, sourceId, ctx.targetId, {
        hp: 10,
        armor: 30,
        element: "physical",
        tags: ["reaction"],
      });
    }
    if (ctx.excludedPresent?.includes(STATUS_IONIZE)) {
      // 清空电离:4 秒内受到 4 次 1 点电元素伤害,电伤 +3(4s)
      ctx.session.primitives.scheduleRepeating(20, 4, () => {
        if (!ctx.session.isDead(ctx.targetId)) {
          dealFollowUp(ctx.session, sourceId, ctx.targetId, {
            hp: 1,
            element: "electric",
            tags: ["reaction"],
          });
        }
      });
      ctx.session.status.apply(ctx.targetId, STATUS_SOAK_SURGE, sourceId);
    }
  },
});

// ── 隐藏跟进状态(元素易伤小窗口) ────────────────────────────────

statusRegistry.register({
  id: STATUS_SCORCH_SURGE,
  displayName: "§7灼流",
  kind: "debuff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 60, // 3 秒
  clearable: true,
  onDamageTaken(ctx) {
    if (ctx.damage.element === "electric" || ctx.damage.element === "fire") {
      scheduleFollowUpDamage(ctx.session, ctx.instance.sourceId, ctx.targetId, 3);
    }
  },
});

statusRegistry.register({
  id: STATUS_ROAST_VULN,
  displayName: "§7焦脆",
  kind: "debuff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 40, // 2 秒
  clearable: true,
  modifiers: { damageTakenMul: 1.5 },
});

statusRegistry.register({
  id: STATUS_SOAK_SURGE,
  displayName: "§7导电",
  kind: "debuff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 80, // 4 秒
  clearable: true,
  onDamageTaken(ctx) {
    if (ctx.damage.element === "electric") {
      scheduleFollowUpDamage(ctx.session, ctx.instance.sourceId, ctx.targetId, 3);
    }
  },
});

statusRegistry.register({
  id: STATUS_ARMOR_BRITTLE,
  displayName: "§7甲碎",
  kind: "debuff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 40, // 2 秒
  clearable: true,
  modifiers: { armorTakenMul: 1.5 },
});

statusRegistry.register({
  id: STATUS_ELECTRIC_FRAGILE,
  displayName: "§7感电",
  kind: "debuff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 40, // 2 秒
  clearable: true,
  onDamageTaken(ctx) {
    if (ctx.damage.element === "electric") {
      // 电伤 +10%(按传入基础量折算,延迟一拍物理跟进)
      const extra = Math.max(1, Math.round((ctx.damage.hp ?? 0) * 0.1));
      scheduleFollowUpDamage(ctx.session, ctx.instance.sourceId, ctx.targetId, extra);
    }
  },
});
