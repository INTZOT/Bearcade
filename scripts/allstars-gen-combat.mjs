// ============================================================
// 《灯塔全明星》逐招帧数据生成器(开发机一次性运行,产物入库)
//
// 用法:node scripts/allstars-gen-combat.mjs
//
// 来源:春叶源资产 v047 的 combat_metadata.json(27 段攻击,作者 tick = 60/秒,
//       区间语义 start_inclusive_end_exclusive 即 [start, end))
// 产物:AllStars-灯塔全明星/src/data/chunye.combat.ts
//
// 注意:元数据里 damage / hitstun_ticks / hitboxes / hurtboxes / knockback /
//       cancel_windows 等**全部为 null**(combat_status = "unconfigured"),
//       按资产文档要求**不能默认为 0 直接用于战斗** —— 本模块只提供**时序**,
//       数值仍由 combat-config.ts 的占位表决定,待实机调平衡。
// ============================================================
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

import { resolveWorkflowRoot } from "./allstars-source-paths.mjs";

const SRC = path.join(resolveWorkflowRoot(process.argv[2]), "characters/green_beret/source/v047");
const OUT = "AllStars-灯塔全明星/src/data/chunye.combat.ts";
const AUTHORING_TPS = 60;
const GAME_TPS = 20;

function main() {
  const srcPath = path.join(SRC, "combat_metadata.json");
  if (!existsSync(srcPath)) {
    console.error(`✗ 缺少源文件: ${srcPath}`);
    process.exit(1);
  }
  const meta = JSON.parse(readFileSync(srcPath, "utf8"));
  const clips = Array.isArray(meta.clips) ? meta.clips : [];
  if (clips.length === 0) {
    console.error("✗ combat_metadata.json 里没有 clips");
    process.exit(1);
  }

  const ratio = GAME_TPS / AUTHORING_TPS; // 1/3
  const toGame = (tick) => tick * ratio;

  const lines = [];
  lines.push("// 本文件由 scripts/allstars-gen-combat.mjs 自动生成,请勿手工修改。");
  lines.push(`// 来源:春叶源资产 v047 combat_metadata.json(version ${meta.version ?? "?"},${clips.length} 段攻击)`);
  lines.push(`// 作者 tick = ${AUTHORING_TPS}/秒;区间语义 = ${meta.interval_convention}`);
  lines.push("//");
  lines.push("// ⚠ 元数据中伤害/硬直/判定框/击退/取消窗口**全部为 null**(combat_status = unconfigured),");
  lines.push("//   按资产文档要求不得默认为 0 用于战斗。本模块只提供**时序**,数值见 combat-config.ts。");
  lines.push("");
  lines.push("export interface AttackFrameData {");
  lines.push("  clipId: string;");
  lines.push("  /** 连段组,如 stand_light */");
  lines.push("  comboGroup: string;");
  lines.push("  /** 组内第几段(1 起) */");
  lines.push("  comboIndex: number;");
  lines.push("  /** 中文动作名 */");
  lines.push("  labelZh: string;");
  lines.push("  /** 动画总长(作者 tick,60/秒) */");
  lines.push("  durationTicks: number;");
  lines.push("  /** 动画总长折算游戏 tick(20/秒,含小数) */");
  lines.push("  durationGameTicks: number;");
  lines.push("  /** startup 区间 [start,end)(作者 tick) */");
  lines.push("  startup: [number, number];");
  lines.push("  /** active 区间 [start,end)(作者 tick;**资产标注为 visual only**) */");
  lines.push("  active: [number, number];");
  lines.push("  /** recovery 区间 [start,end)(作者 tick) */");
  lines.push("  recovery: [number, number];");
  lines.push("  /** active 折算游戏 tick:开始向上取整、结束向下取整,保证至少覆盖 1 tick */");
  lines.push("  activeGameTicks: [number, number];");
  lines.push("  /** 起手/收势姿态 */");
  lines.push("  startPose: string;");
  lines.push("  endPose: string;");
  lines.push("}");
  lines.push("");
  lines.push(`export const COMBAT_TICK_RATE = ${meta.tick_rate ?? AUTHORING_TPS};`);
  lines.push(`export const COMBAT_INTERVAL_CONVENTION = ${JSON.stringify(meta.interval_convention ?? "")};`);
  lines.push(`export const COMBAT_STATUS = ${JSON.stringify(meta.status ?? "")};`);
  lines.push("");
  lines.push("/** 27 段攻击的逐招时序表(clipId → 帧数据) */");
  lines.push("export const ATTACK_FRAMES: Record<string, AttackFrameData> = {");
  for (const c of clips) {
    const startup = c.startup ?? [0, 0];
    const active = c.active ?? [0, 0];
    const recovery = c.recovery ?? [0, 0];
    const durationTicks = c.duration_ticks ?? 0;
    const aStart = Math.ceil(toGame(active[0]));
    const aEndRaw = Math.floor(toGame(active[1]));
    const aEnd = Math.max(aStart + 1, aEndRaw);
    lines.push(`  ${JSON.stringify(c.clip_id)}: {`);
    lines.push(`    clipId: ${JSON.stringify(c.clip_id)},`);
    lines.push(`    comboGroup: ${JSON.stringify(c.combo_group ?? "")},`);
    lines.push(`    comboIndex: ${c.combo_index ?? 0},`);
    lines.push(`    labelZh: ${JSON.stringify(c.label_zh ?? "")},`);
    lines.push(`    durationTicks: ${durationTicks},`);
    lines.push(`    durationGameTicks: ${Number(toGame(durationTicks).toFixed(4))},`);
    lines.push(`    startup: [${startup[0]}, ${startup[1]}],`);
    lines.push(`    active: [${active[0]}, ${active[1]}],`);
    lines.push(`    recovery: [${recovery[0]}, ${recovery[1]}],`);
    lines.push(`    activeGameTicks: [${aStart}, ${aEnd}],`);
    lines.push(`    startPose: ${JSON.stringify(c.start_pose ?? "")},`);
    lines.push(`    endPose: ${JSON.stringify(c.end_pose ?? "")},`);
    lines.push("  },");
  }
  lines.push("};");
  lines.push("");
  lines.push("/** 全部攻击 clipId(按连段组与组内序号排序) */");
  lines.push("export const ATTACK_CLIP_IDS: string[] = [");
  const sorted = [...clips].sort((a, b) => {
    const g = String(a.combo_group ?? "").localeCompare(String(b.combo_group ?? ""));
    return g !== 0 ? g : (a.combo_index ?? 0) - (b.combo_index ?? 0);
  });
  for (const c of sorted) lines.push(`  ${JSON.stringify(c.clip_id)},`);
  lines.push("];");
  lines.push("");
  lines.push("/** 取某段攻击的帧数据(非攻击片段返回 undefined) */");
  lines.push("export function attackFrames(clipId: string): AttackFrameData | undefined {");
  lines.push("  return ATTACK_FRAMES[clipId];");
  lines.push("}");
  lines.push("");
  lines.push("/** 该 clip 是否受帧数据覆盖 */");
  lines.push("export function hasFrameData(clipId: string): boolean {");
  lines.push("  return ATTACK_FRAMES[clipId] !== undefined;");
  lines.push("}");
  lines.push("");
  lines.push("/** 该 clip 的 active 窗口折算到游戏 tick;没有帧数据时返回 undefined */");
  lines.push("export function activeGameWindow(clipId: string): [number, number] | undefined {");
  lines.push("  return ATTACK_FRAMES[clipId]?.activeGameTicks;");
  lines.push("}");
  lines.push("");

  writeFileSync(OUT, lines.join("\n"), "utf8");
  console.log(`✓ ${OUT}`);
  console.log(`  攻击段数: ${clips.length}`);
  const groups = new Map();
  for (const c of clips) {
    const g = c.combo_group ?? "?";
    groups.set(g, (groups.get(g) ?? 0) + 1);
  }
  console.log(`  连段组: ${[...groups.entries()].map(([g, n]) => `${g}×${n}`).join(", ")}`);
  const noActive = clips.filter((c) => !c.active || c.active[1] <= c.active[0]);
  if (noActive.length) {
    console.warn(`  ⚠ ${noActive.length} 段 active 区间为空: ${noActive.map((c) => c.clip_id).join(", ")}`);
  }
}

main();
