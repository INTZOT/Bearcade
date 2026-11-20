// ============================================================
// 刺客相关状态(内容设计 PDF 第 5-6 页)
// - 撕裂(重伤·撕裂): 10s;受伤 +10%,每 0.5s 受到 1 点伤害
// - 惯性: 抓钩牵引飞行中每 0.5s 叠 1 层(上限 4);
//   1/2/3 层 → 下次武器攻击伤害 +10%/15%/20%,4 层附加撕裂;
//   1.5 秒未增长(层数与时长均未刷新)则自然到期清空 —— 由
//   stackMode "both"(叠层并刷新时长)表达,无需额外计时逻辑。
// ============================================================
import { statusRegistry } from "../../framework";

export const STATUS_LACERATION = "snd5:laceration";
export const STATUS_INERTIA = "snd5:inertia";

/** 撕裂 DOT:每 0.5 秒 1 点(tag dot,不触发吸血/状态钩子约定见架构 §5.3) */
const LACERATION_DOT_INTERVAL_TICKS = 10;
const LACERATION_DOT_DAMAGE = 1;

statusRegistry.register({
  id: STATUS_LACERATION,
  displayName: "撕裂",
  kind: "debuff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 200, // 10 秒
  clearable: true,
  modifiers: { damageTakenMul: 1.1 },
  tickIntervalTicks: LACERATION_DOT_INTERVAL_TICKS,
  onTick(ctx) {
    // DOT 跳伤计入施加者伤害贡献(击杀/助攻判定);目标死亡由管线过滤
    ctx.session.combat.dealDamage(ctx.instance.sourceId, ctx.targetId, {
      hp: LACERATION_DOT_DAMAGE,
      element: "physical",
      tags: ["dot"],
    });
  },
});

statusRegistry.register({
  id: STATUS_INERTIA,
  displayName: "惯性",
  kind: "buff",
  maxStacks: 4,
  // 叠层并刷新:每次叠加把 1.5 秒衰减窗口重置(PDF「1.5 秒后没再增长则清空」)
  stackMode: "both",
  durationTicks: 30, // 1.5 秒
  clearable: true,
  // 伤害加成不走 modifiers:加成只作用于「下一次武器攻击」并在攻击时
  // 消耗全部层数(见 skills/assassin.ts consumeInertia),全局修饰会把
  // 技能伤害也放大,与「下一次攻击」语义不符。
});
