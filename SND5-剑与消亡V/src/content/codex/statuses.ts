// ============================================================
// 秘典法术同名状态(内容设计 PDF 第 26-27 页)
// 使用规则:使用秘典后给自身施加同名状态;物品转入耗尽态,
// 由补给站充能后恢复(充能流程见 supply.ts / game.ts)。
// - 燃灰/地震/闪袭/信标: 动作在技能 cast 一次性执行,状态作同名标记,
//   持续时间对应设计中的表现时长(烟雾 7s / 部署点 10s 等);
// - 匿迹: 原版隐身效果随状态挂/摘(原版效果应用由内容层执行的既有约定);
// - 碎甲: 来源侧护甲伤害 ×1.5(armorDealtMul,仅放大护甲分量);
// - 护佑: 30 点临时护甲由 cast 施加,状态作同名标记对齐 10s 时长;
// - 溪源/疗愈/紧急维修: 回复脉冲挂在状态 onTick —— 死亡清状态即停止,
//   总量按「脉冲次数 × 单次量」对齐设计(60 魔 / 30 血 / 40 甲)。
// ============================================================
import { statusRegistry, type StatusContext } from "../../framework";

export const STATUS_EMBER_ASH = "snd5:codex_ember_ash";
export const STATUS_VANISH = "snd5:codex_vanish";
export const STATUS_QUAKE = "snd5:codex_quake";
export const STATUS_ARMOR_CRUSH = "snd5:codex_armor_crush";
export const STATUS_BLITZ = "snd5:codex_blitz";
export const STATUS_BEACON = "snd5:codex_beacon";
export const STATUS_BLESSING = "snd5:codex_blessing";
export const STATUS_MANA_TIDE = "snd5:codex_mana_tide";
export const STATUS_HEALING_WAVE = "snd5:codex_healing_wave";
export const STATUS_FIELD_REPAIR = "snd5:codex_field_repair";

// ── 匿迹 ─────────────────────────────────────────────────────
const VANISH_DURATION_TICKS = 160; // 8 秒(与状态持续一致)
const INVISIBILITY_EFFECT = "minecraft:invisibility";

function playerOf(ctx: StatusContext) {
  return ctx.session.players.get(ctx.targetId)?.player;
}

// ── 溪源 / 疗愈 / 紧急维修 ────────────────────────────────────
/** 溪源:每 1 秒 12 点 × 5 脉冲 = 6 秒 60 点魔力 */
const MANA_TIDE_PULSE = 12;
/** 疗愈:每 0.75 秒 5 点 × 6 脉冲 = 5 秒 30 点生命 */
const HEALING_WAVE_PULSE = 5;
/** 紧急维修:每 0.5 秒 10 点 × 4 脉冲 = 2 秒 40 点护甲 */
const FIELD_REPAIR_PULSE = 10;

statusRegistry.register({
  id: STATUS_EMBER_ASH,
  displayName: "燃灰",
  kind: "neutral",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 140, // 7 秒烟雾存续期
  clearable: true,
});

statusRegistry.register({
  id: STATUS_VANISH,
  displayName: "匿迹",
  kind: "buff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: VANISH_DURATION_TICKS,
  clearable: true,
  onApply(ctx) {
    const player = playerOf(ctx);
    if (!player?.isValid) return;
    try {
      player.addEffect(INVISIBILITY_EFFECT, VANISH_DURATION_TICKS);
    } catch {
      // 效果应用失败不影响状态挂载
    }
  },
  onExpire(ctx) {
    const player = playerOf(ctx);
    if (!player?.isValid) return;
    try {
      player.removeEffect(INVISIBILITY_EFFECT);
    } catch {
      // 忽略
    }
  },
  // 死亡/净化走 remove 路径:同步摘除隐身,避免清状态后隐身残留
  onRemoved(ctx) {
    const player = playerOf(ctx);
    if (!player?.isValid) return;
    try {
      player.removeEffect(INVISIBILITY_EFFECT);
    } catch {
      // 忽略
    }
  },
});

statusRegistry.register({
  id: STATUS_QUAKE,
  displayName: "地震",
  kind: "neutral",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 20, // 1 秒短标记(击飞由技能即时结算)
  clearable: true,
});

statusRegistry.register({
  id: STATUS_ARMOR_CRUSH,
  displayName: "碎甲",
  kind: "buff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 100, // 5 秒
  clearable: true,
  modifiers: { armorDealtMul: 1.5 }, // 对甲伤害提升 50%
});

statusRegistry.register({
  id: STATUS_BLITZ,
  displayName: "闪袭",
  kind: "neutral",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 20, // 1 秒短标记(位移由技能即时结算)
  clearable: true,
});

statusRegistry.register({
  id: STATUS_BEACON,
  displayName: "信标",
  kind: "neutral",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 200, // 10 秒部署点存续期
  clearable: true,
});

statusRegistry.register({
  id: STATUS_BLESSING,
  displayName: "护佑",
  kind: "buff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 200, // 10 秒(与临时护甲到期一致)
  clearable: true,
});

statusRegistry.register({
  id: STATUS_MANA_TIDE,
  displayName: "溪源",
  kind: "buff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 120, // 6 秒
  clearable: true,
  tickIntervalTicks: 20, // 每 1 秒 1 脉冲(20/40/60/80/100 各 1 次)
  onTick(ctx) {
    // 走治疗管线:受重伤(治疗量修正)与收束(记录改返还)影响
    ctx.session.primitives.healFull(ctx.targetId, ctx.targetId, { mana: MANA_TIDE_PULSE });
  },
});

statusRegistry.register({
  id: STATUS_HEALING_WAVE,
  displayName: "疗愈",
  kind: "buff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 100, // 5 秒
  clearable: true,
  tickIntervalTicks: 15, // 每 0.75 秒 1 脉冲(15/30/45/60/75/90 共 6 次)
  onTick(ctx) {
    ctx.session.primitives.healFull(ctx.targetId, ctx.targetId, { amount: HEALING_WAVE_PULSE });
  },
});

statusRegistry.register({
  id: STATUS_FIELD_REPAIR,
  displayName: "紧急维修",
  kind: "buff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 50, // 2.5 秒
  clearable: true,
  tickIntervalTicks: 10, // 每 0.5 秒 1 脉冲(10/20/30/40 共 4 次)
  onTick(ctx) {
    ctx.session.primitives.healFull(ctx.targetId, ctx.targetId, { armor: FIELD_REPAIR_PULSE });
  },
});
