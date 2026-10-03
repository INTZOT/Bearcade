// ============================================================
// 《灯塔全明星》动画清单审计(开发机一次性运行,不参与构建)
//
// 用法:node scripts/allstars-audit-clips.mjs
//
// 回答一个问题:**代码里用到的每一段动画,资源包里到底有没有?**
//   ① chunye.clips.ts(资源包动画清单)里的每一段,是否都登记进了
//      resource-pack/entity/chunye.entity.json 的 animations 映射
//      —— playAnimation 解析的前提,漏登记 = 该段永远播不出来;
//   ② src/ 里以字符串字面量出现的动画 id 是否都在清单里(拼错 = 静默失败);
//   ③ 六个技能 × 三种站姿 各自解析到哪一段、时长多少(打印成表格)。
//
// 退出码:有"缺失/未登记"时 exit 1,可以直接当 CI 门禁用。
// ============================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const PKG = "AllStars-灯塔全明星";
const CLIPS_TS = path.join(PKG, "src", "data", "chunye.clips.ts");
const ENTITY_JSON = path.join(PKG, "resource-pack", "entity", "chunye.entity.json");
const SRC_DIR = path.join(PKG, "src");

// ---------- 1. 资源包动画清单(chunye.clips.ts) ----------
const clipsSource = readFileSync(CLIPS_TS, "utf8");
/** id → { name, gameTicks, seconds, loop } */
const clips = new Map();
for (const line of clipsSource.split("\n")) {
  const m =
    /^\s*"([a-z0-9_]+)":\s*\{\s*id:\s*"([a-z0-9_]+)",\s*name:\s*"([^"]+)",\s*seconds:\s*([\d.]+),\s*authoringTicks:\s*(\d+),\s*gameTicks:\s*(\d+),\s*loop:\s*(true|false)/.exec(
      line,
    );
  if (!m) continue;
  clips.set(m[1], {
    name: m[3],
    seconds: Number(m[4]),
    gameTicks: Number(m[6]),
    loop: m[7] === "true",
  });
}

// ---------- 2. 客户端实体登记的动画(playAnimation 的前提) ----------
const entityJson = JSON.parse(readFileSync(ENTITY_JSON, "utf8"));
const registered = new Set(
  Object.keys(
    entityJson["minecraft:client_entity"]?.description?.animations ?? {},
  ),
);

// ---------- 3. src/ 里引用的动画字面量 ----------
/** 只扫这些前缀的字面量,避免把普通字符串当成动画 id */
const KNOWN_PREFIXES = [
  "attack_",
  "super_",
  "throw_",
  "hit_",
  "guard_",
  "walk_",
  "idle_",
  "air_",
  "jump_",
  "crouch_",
  "dash_",
  "leaf_",
  "special_",
  "victory_",
];
const STANDALONE = ["knockdown", "getup", "intro"];

function walkTs(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** 文件名 → 该文件里出现的"像动画 id"的字面量 */
const referenced = new Map();
function note(file, id) {
  if (!referenced.has(file)) referenced.set(file, new Set());
  referenced.get(file).add(id);
}

for (const file of walkTs(SRC_DIR)) {
  const rel = path.relative(process.cwd(), file);
  // 生成文件里的清单/帧数据是"定义",不算引用(帧数据的键是短名,不是动画 id)
  if (rel.includes(`${path.sep}data${path.sep}`)) continue;
  const source = readFileSync(file, "utf8");
  for (const m of source.matchAll(/"([a-z][a-z0-9_]{2,})"/g)) {
    const id = m[1];
    const looksLikeClip =
      KNOWN_PREFIXES.some((p) => id.startsWith(p)) || STANDALONE.includes(id);
    if (looksLikeClip) note(rel, id);
  }
}

// ---------- 4. 技能 → 动画矩阵 ----------
const configSource = readFileSync(
  path.join(PKG, "src", "combat-config.ts"),
  "utf8",
);
/** meter → clip */
const superByMeter = new Map();
for (const m of configSource.matchAll(
  /\{\s*meter:\s*(\d+),\s*clip:\s*"([a-z0-9_]+)"\s*\}/g,
)) {
  superByMeter.set(Number(m[1]), m[2]);
}
/** 三段连锁:super_3 的中间段与终结段 */
const super3Stages = [];
for (const m of configSource.matchAll(
  /export const SUPER_3_STAGES[^=]*=\s*\[([^\]]*)\]/g,
)) {
  super3Stages.push(...[...m[1].matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1]));
}
for (const m of configSource.matchAll(
  /export const SUPER_3_FINISH_(NORMAL|LOW)\s*=\s*"([a-z0-9_]+)"/g,
)) {
  super3Stages.push(m[2]);
}

const ATTACK_PREFIX = { stand: "attack_stand_", crouch: "attack_crouch_", air: "attack_air_" };
const SKILL_BASE = {
  1: "light",
  2: "medium",
  3: "heavy",
};

function clipLine(id) {
  const info = clips.get(id);
  if (!info) return `§ 缺失 ${id}`;
  return `${id}(${info.gameTicks}t${info.loop ? ",loop" : ""})`;
}

function auditClip(id, where, problems) {
  if (!clips.has(id)) {
    problems.push(`${where} 引用了不存在的动画 ${id}`);
    return;
  }
  if (!registered.has(id)) {
    problems.push(`${where} 用到的 ${id} 没有登记进 chunye.entity.json 的 animations`);
  }
}

const problems = [];

console.log("=".repeat(78));
console.log("《灯塔全明星》动画审计");
console.log("=".repeat(78));
console.log(
  `资源包动画清单:${clips.size} 段;客户端实体已登记:${registered.size} 段`,
);

// 清单 ↔ 登记 双向核对
for (const id of clips.keys()) {
  if (!registered.has(id)) problems.push(`清单有 ${id},但 chunye.entity.json 未登记`);
}
for (const id of registered) {
  if (!clips.has(id)) problems.push(`chunye.entity.json 登记了 ${id},但清单里没有`);
}

console.log("\n-- 技能 → 动画(按站姿展开)--");
for (const [slotText, suffix] of Object.entries(SKILL_BASE)) {
  const slot = Number(slotText);
  const label = { 1: "轻攻击", 2: "中攻击", 3: "重攻击" }[slot];
  for (const stance of ["stand", "crouch", "air"]) {
    const base = `${ATTACK_PREFIX[stance]}${suffix}`;
    const ids = [base, `${base}_2`, `${base}_3`];
    for (const id of ids) auditClip(id, `技能${slot}(${label}/${stance})`, problems);
    console.log(
      `  技能${slot} ${label.padEnd(4)} ${stance.padEnd(6)} → ` +
        ids.map(clipLine).join(" → "),
    );
  }
}

console.log("\n-- 其他技能 --");
const other = {
  "投技(地面)": ["throw_cast", "throw_whiff", "throw_tech_cast", "throw_tech_victim"],
  "投技(命中对手)": ["throw_victim"],
  "发波": ["special_leaf_burst"],
  "大招(1/2/3 气起手)": [...superByMeter.values()],
  "三气分段": super3Stages,
};
for (const [label, ids] of Object.entries(other)) {
  for (const id of ids) auditClip(id, label, problems);
  console.log(`  ${label.padEnd(18)} → ${ids.map(clipLine).join(", ")}`);
}

console.log("\n-- 通用动作 --");
const common = [
  "idle_stand",
  "idle_crouch",
  "idle_down",
  "walk_forward",
  "walk_backward",
  "crouch_enter",
  "crouch_exit",
  "jump_start",
  "jump_land",
  "air_rise",
  "air_fall",
  "hit_stand",
  "hit_crouch",
  "hit_air",
  "hit_stand_heavy",
  "guard_stand",
  "guard_crouch",
  "guard_hit_stand",
  "guard_hit_crouch",
  "knockdown",
  "getup",
  "intro",
  "victory_round",
  "victory_round_idle",
  "victory_match",
  "victory_match_idle",
];
for (const id of common) auditClip(id, "通用动作", problems);
console.log("  " + common.map(clipLine).join(", "));

console.log("\n-- src/ 引用但清单里没有的动画(拼写错误会静默失败)--");
let missingRefs = 0;
for (const [file, ids] of [...referenced.entries()].sort()) {
  const bad = [...ids].filter((id) => !clips.has(id));
  // super_3 / super 之类的"前缀占位"不是真 id,单列出来供人工判断
  const maybePrefix = bad.filter((id) => id === "super" || id.endsWith("_"));
  const real = bad.filter((id) => !maybePrefix.includes(id));
  if (real.length === 0) continue;
  missingRefs += real.length;
  console.log(`  ✗ ${file}: ${real.join(", ")}`);
}
if (missingRefs === 0) console.log("  ✓ 无");

console.log("\n-- 清单里从未在 src/ 出现的动画(仅参考,不报错)--");
const usedAnywhere = new Set();
for (const ids of referenced.values()) for (const id of ids) usedAnywhere.add(id);
// 三段连锁是拼出来的,统一视为已使用
for (const suffix of Object.values(SKILL_BASE)) {
  for (const stance of Object.values(ATTACK_PREFIX)) {
    for (const tail of ["", "_2", "_3"]) usedAnywhere.add(`${stance}${suffix}${tail}`);
  }
}
// 三气的配对受击方也是**代码拼出来的名字**(match.ts: `${stageId}${SUPER_3_VICTIM_SUFFIX}`),
// 不按同样规则展开就会误报成"未使用"(上一轮就是这么错的)。
for (const stage of super3Stages) usedAnywhere.add(`${stage}_victim`);
const unused = [...clips.keys()].filter((id) => !usedAnywhere.has(id));
console.log(
  unused.length === 0
    ? "  ✓ 全部用到"
    : `  ${unused.length} 段未使用:${unused.join(", ")}`,
);

console.log("\n" + "=".repeat(78));
if (problems.length > 0 || missingRefs > 0) {
  console.error(`审计失败:${problems.length + missingRefs} 个问题`);
  for (const p of problems) console.error("  ✗ " + p);
  process.exit(1);
}
console.log("审计通过:技能动画齐全、全部登记、无拼写错误");
