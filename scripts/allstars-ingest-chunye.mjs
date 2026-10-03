// ============================================================
// 《灯塔全明星》角色资产接入器(开发机一次性运行,产物入库)
//
// 用法:node scripts/allstars-ingest-chunye.mjs
//
// 来源:春叶(chunye)源资产 v047,86 段原生 Bedrock 动画 + 几何 + 贴图。
//   - 技术 ID 沿用 green_beret(资产内部动画/几何标识不动,避免改 27MB 动画 JSON)
//   - 实体标识使用本包命名空间:bearcade:allstars_chunye
// 产物:
//   AllStars-灯塔全明星/resource-pack/models/entity/chunye.geo.json
//   AllStars-灯塔全明星/resource-pack/animations/chunye.animation.json
//   AllStars-灯塔全明星/resource-pack/textures/entity/chunye{,_blue}.png
//   AllStars-灯塔全明星/resource-pack/entity/chunye.entity.json   ← 自动生成
//   AllStars-灯塔全明星/src/data/chunye.clips.ts                  ← 自动生成
// ============================================================
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";

import { resolveWorkflowRoot } from "./allstars-source-paths.mjs";

const SRC = path.join(resolveWorkflowRoot(process.argv[2]), "characters/green_beret/source/v047");
const PKG = "AllStars-灯塔全明星";
const RP = path.join(PKG, "resource-pack");
const ENTITY_ID = "bearcade:allstars_chunye";
const GEOMETRY_ID = "geometry.green_beret_fighter";
/**
 * 渲染控制器 id:直接用原版内建 controller.render.default
 * (等价于 `geometry Geometry.default / materials {*: Material.default} / textures Texture.default`)。
 * 不要自建 RC 文件、也不要在 client_entity 里写 `scripts.animate` 空数组 ——
 * 空 animate 数组过不了客户端 schema 校验("Array too small (0 < 1)"),
 * 会导致**整条 client_entity 描述被丢弃**(实体在、粒子在、模型完全不可见)。
 */
const RENDER_CONTROLLER_ID = "controller.render.default";
const ANIM_PREFIX = "animation.green_beret.";
const TEXTURE_DEFAULT = "textures/entity/chunye";
const TEXTURE_BLUE = "textures/entity/chunye_blue";

// glTF 动画 JSON 里键为 animation.green_beret.<id>;循环标记在 .loop
const ANIM_SOURCE = "green_beret_fighter.animation.json";
const GEO_SOURCE = "green_beret_fighter.geo.json";
const TEX_DEFAULT_SOURCE = "task04d_hat_fit.png";
const TEX_BLUE_SOURCE = "task04d_hat_fit_blue.png";

const AUTHORING_TICKS_PER_SECOND = 60;
const GAME_TICKS_PER_SECOND = 20;

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

function mustExist(p) {
  try {
    statSync(p);
  } catch {
    console.error(`✗ 缺少源文件: ${p}`);
    process.exit(1);
  }
}

function main() {
  for (const f of [ANIM_SOURCE, GEO_SOURCE, TEX_DEFAULT_SOURCE, TEX_BLUE_SOURCE]) {
    mustExist(path.join(SRC, f));
  }

  ensureDir(path.join(RP, "models", "entity"));
  ensureDir(path.join(RP, "animations"));
  ensureDir(path.join(RP, "textures", "entity"));
  ensureDir(path.join(RP, "entity"));
  ensureDir(path.join(PKG, "src", "data"));

  // ---- 1. 复制几何 / 动画 / 贴图 ----
  const copies = [
    [GEO_SOURCE, path.join(RP, "models", "entity", "chunye.geo.json")],
    [ANIM_SOURCE, path.join(RP, "animations", "chunye.animation.json")],
    [TEX_DEFAULT_SOURCE, path.join(RP, "textures", "entity", "chunye.png")],
    [TEX_BLUE_SOURCE, path.join(RP, "textures", "entity", "chunye_blue.png")],
  ];
  for (const [from, to] of copies) {
    copyFileSync(path.join(SRC, from), to);
    console.log(`  ✓ ${to}  (${(statSync(to).size / 1024 / 1024).toFixed(2)} MB)`);
  }

  // ---- 2. 解析动画清单 ----
  const animJson = JSON.parse(readFileSync(path.join(SRC, ANIM_SOURCE), "utf8"));
  const clips = [];
  for (const [fullName, def] of Object.entries(animJson.animations)) {
    if (!fullName.startsWith(ANIM_PREFIX)) continue;
    const id = fullName.slice(ANIM_PREFIX.length);
    const seconds = Number(def.animation_length ?? 0);
    const loop = def.loop === true || (typeof def.loop === "string" && def.loop !== "hold_on_last_frame");
    clips.push({
      id,
      name: fullName,
      seconds,
      authoringTicks: Math.round(seconds * AUTHORING_TICKS_PER_SECOND),
      gameTicks: Math.max(1, Math.ceil(seconds * GAME_TICKS_PER_SECOND - 1e-8)),
      loop,
    });
  }
  clips.sort((a, b) => a.id.localeCompare(b.id));
  console.log(`  ✓ 解析动画 ${clips.length} 段`);

  // ---- 3. 生成客户端实体定义(全部动画都要在此登记,playAnimation 才能解析) ----
  const animationsMap = {};
  for (const c of clips) animationsMap[c.id] = c.name;
  const clientEntity = {
    format_version: "1.10.0",
    "minecraft:client_entity": {
      description: {
        identifier: ENTITY_ID,
        materials: { default: "entity_alphatest" },
        textures: { default: TEXTURE_DEFAULT, blue: TEXTURE_BLUE },
        geometry: { default: GEOMETRY_ID },
        animations: animationsMap,
        render_controllers: [RENDER_CONTROLLER_ID],
      },
    },
  };
  writeFileSync(
    path.join(RP, "entity", "chunye.entity.json"),
    JSON.stringify(clientEntity, null, 2) + "\n",
    "utf8",
  );
  console.log(`  ✓ ${RP}/entity/chunye.entity.json  (登记 ${clips.length} 段动画)`);

  // ---- 3b. 渲染控制器:用原版内建 controller.render.default,不生成自定义 RC 文件 ----
  // 自建 RC 与内建完全等价,却多一条被解析失败的风险(实机曾报
  // "error parsing render_controllers/chunye.render_controllers.json:");动画由 playAnimation 驱动,
  // 因此也不需要 scripts.animate。详见 docs/lessons.md。

  // ---- 4. 生成 TS 动画清单 ----
  const lines = [];
  lines.push("// 本文件由 scripts/allstars-ingest-chunye.mjs 自动生成,请勿手工修改。");
  lines.push("// 来源:春叶源资产 v047(86 段原生 Bedrock 动画)。");
  lines.push("");
  lines.push(`export const CHUNYE_ENTITY_ID = "${ENTITY_ID}";`);
  lines.push(`export const CHUNYE_GEOMETRY_ID = "${GEOMETRY_ID}";`);
  lines.push(`export const CHUNYE_ANIM_PREFIX = "${ANIM_PREFIX}";`);
  lines.push("");
  lines.push("export interface ClipInfo {");
  lines.push("  /** 动画短名(playAnimation 用完整名 ClipInfo.name) */");
  lines.push("  id: string;");
  lines.push("  /** 完整动画标识 animation.green_beret.<id> */");
  lines.push("  name: string;");
  lines.push("  /** 动画时长(秒,引擎直接按秒采样) */");
  lines.push("  seconds: number;");
  lines.push("  /** 制作 tick 数(60/秒) */");
  lines.push("  authoringTicks: number;");
  lines.push("  /** 折算到游戏 tick 数(20/秒,仅供逻辑调度参考) */");
  lines.push("  gameTicks: number;");
  lines.push("  /** 是否自循环 */");
  lines.push("  loop: boolean;");
  lines.push("}");
  lines.push("");
  lines.push("export const CHUNYE_CLIPS: Record<string, ClipInfo> = {");
  for (const c of clips) {
    lines.push(
      `  ${JSON.stringify(c.id)}: { id: ${JSON.stringify(c.id)}, name: ${JSON.stringify(c.name)}, seconds: ${c.seconds}, authoringTicks: ${c.authoringTicks}, gameTicks: ${c.gameTicks}, loop: ${c.loop} },`,
    );
  }
  lines.push("};");
  lines.push("");
  lines.push("/** 全部动画短名(按字典序) */");
  lines.push("export const CHUNYE_CLIP_IDS: string[] = [");
  for (const c of clips) lines.push(`  ${JSON.stringify(c.id)},`);
  lines.push("];");
  lines.push("");
  lines.push("/** 取某段动画信息;不存在时返回 undefined */");
  lines.push("export function clip(id: string): ClipInfo | undefined {");
  lines.push("  return CHUNYE_CLIPS[id];");
  lines.push("}");
  lines.push("");
  lines.push("/** 该动画折算到游戏 tick 的时长(至少 1) */");
  lines.push("export function clipGameTicks(id: string): number {");
  lines.push("  return CHUNYE_CLIPS[id]?.gameTicks ?? 1;");
  lines.push("}");
  lines.push("");
  writeFileSync(path.join(PKG, "src", "data", "chunye.clips.ts"), lines.join("\n"), "utf8");
  console.log(`  ✓ ${PKG}/src/data/chunye.clips.ts`);

  // ---- 5. 校验:动画名唯一 / 无空时长 ----
  const bad = clips.filter((c) => !(c.seconds > 0));
  if (bad.length) {
    console.warn(`  ⚠ 有 ${bad.length} 段动画时长为 0: ${bad.map((c) => c.id).join(", ")}`);
  }
  console.log(`\n完成:春叶资产已接入 ${PKG}`);
}

main();
await import("./allstars-presentation-assets.mjs");
await import("./allstars-sample-hands.mjs");
