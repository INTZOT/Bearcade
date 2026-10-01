// ============================================================
// 《灯塔全明星》道具资产接入器(开发机一次性运行,产物入库)
//
// 用法:node scripts/allstars-ingest-props.mjs
//
// 来源:角色源资产 v047 的 props/(独立道具,不是角色骨骼 —— 动画 JSON 里
//      完全没有珍珠/方块的通道,所以必须用**独立实体**渲染):
//   props/ender_pearl.{geo.json,png}      → 冲刺/大招的末影珍珠(121 方块薄模型)
//   props/command_block.{geo.json,png}    → 二气"双手夹方块压击"的命令方块
//
// 规格来源(权威):
//   source/v047/motion_vfx_metadata.json  → intro.pearlGather / dash.{forward,backward}
//                                            (.release/.hide/.afterimages)
//   source/v047/super_metadata.json       → super_1.pearlGather/move/hide、
//                                            super_2.prop=command_block、super_3 珍珠链
//
// 产物:
//   AllStars-灯塔全明星/resource-pack/models/entity/allstars_<prop>.geo.json
//   AllStars-灯塔全明星/resource-pack/textures/entity/allstars_<prop>.png
//   AllStars-灯塔全明星/resource-pack/entity/allstars_<prop>.entity.json   ← 自动生成
//   AllStars-灯塔全明星/entities/allstars_<prop>.json                      ← 自动生成
//
// ⚠ 两条实机踩坑规范(见 docs/lessons.md §14):
//   ① 客户端实体用**内建 controller.render.default**,不自建 RC 文件;
//   ② **不写 scripts 块**(空 animate 数组会让整条 client_entity 被丢弃 ⇒ 模型不可见)。
// ============================================================
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PROP_SCALES } from './allstars-visual-assets.mjs';

import { resolveWorkflowRoot } from "./allstars-source-paths.mjs";

const SRC = path.join(resolveWorkflowRoot(process.argv[2]), "characters/green_beret/source/v047/props");
const PKG = "AllStars-灯塔全明星";
const RP = path.join(PKG, "resource-pack");
const BP_ENTITIES = path.join(PKG, "entities");

/**
 * 道具的运行时放大倍数。
 * 源资产按"手掌道具"做尺寸(珍珠 3.2 模型单位 ≈ 0.2 格、方块 4.4 ≈ 0.28 格),
 * 珍珠改为 1.5 倍（旧 3 倍的一半），远景与手持共用同一尺寸。
 * 调整共享 PROP_SCALES 后重跑 build 即可，重新导入也使用同一配置。
 */
const SCALE = PROP_SCALES;

const PROPS = [
  {
    id: "pearl",
    entityId: "bearcade:allstars_prop_pearl",
    geometry: "geometry.green_beret.ender_pearl",
    geoSource: "ender_pearl.geo.json",
    textureSource: "ender_pearl.png",
    scale: SCALE.pearl,
    note: "冲刺/大招的末影珍珠(non_damaging_visual_prop)",
  },
  {
    id: "command_block",
    entityId: "bearcade:allstars_prop_command_block",
    geometry: "geometry.green_beret.command_block",
    geoSource: "command_block.geo.json",
    textureSource: "command_block.png",
    scale: SCALE.command_block,
    note: "二气压击时的命令方块(prop of super_2)",
  },
];

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

function mustExist(p) {
  try {
    const s = statSync(p);
    if (!s.isFile() || s.size <= 0) throw new Error("空文件");
  } catch (error) {
    throw new Error(`源文件不可用: ${p} (${String(error)})`);
  }
  return p;
}

function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

console.log("== 《灯塔全明星》道具接入 ==");
ensureDir(path.join(RP, "models", "entity"));
ensureDir(path.join(RP, "textures", "entity"));
ensureDir(path.join(RP, "entity"));
ensureDir(BP_ENTITIES);

for (const prop of PROPS) {
  const geoOut = path.join(RP, "models", "entity", `allstars_${prop.id}.geo.json`);
  const texOut = path.join(RP, "textures", "entity", `allstars_${prop.id}.png`);
  copyFileSync(mustExist(path.join(SRC, prop.geoSource)), geoOut);
  copyFileSync(mustExist(path.join(SRC, prop.textureSource)), texOut);
  console.log(`  ✓ 几何 → ${path.relative(process.cwd(), geoOut)}`);
  console.log(`  ✓ 贴图 → ${path.relative(process.cwd(), texOut)}`);

  // ---- 客户端实体(内建 RC + 不写 scripts) ----
  const clientEntity = {
    format_version: "1.10.0",
    "minecraft:client_entity": {
      description: {
        identifier: prop.entityId,
        materials: { default: "entity_alphatest" },
        textures: { default: `textures/entity/allstars_${prop.id}` },
        geometry: { default: prop.geometry },
        render_controllers: ["controller.render.default"],
      },
    },
  };
  const clientOut = path.join(RP, "entity", `allstars_${prop.id}.entity.json`);
  writeJson(clientOut, clientEntity);
  console.log(`  ✓ 客户端实体 → ${path.relative(process.cwd(), clientOut)}`);

  // ---- 行为包实体:纯装饰,无重力/无碰撞/免疫伤害/不可推动 ----
  const bpEntity = {
    format_version: "1.21.90",
    "minecraft:entity": {
      description: {
        identifier: prop.entityId,
        is_spawnable: false,
        is_summonable: true,
        is_experimental: false,
      },
      component_groups: {
        "bearcade:prop_driven": {
          "minecraft:physics": { has_gravity: false, has_collision: false },
        },
      },
      components: {
        "minecraft:type_family": { family: ["allstars_prop"] },
        "minecraft:health": { value: 20, max: 20 },
        "minecraft:collision_box": { width: 0.05, height: 0.05 },
        "minecraft:physics": { has_gravity: false, has_collision: false },
        "minecraft:pushable": {
          is_pushable: false,
          is_pushable_by_piston: false,
        },
        "minecraft:persistent": {},
        "minecraft:scale": { value: prop.scale },
        "minecraft:damage_sensor": {
          triggers: { cause: "all", deals_damage: "no" },
        },
      },
      events: {
        "bearcade:prop_driven": {
          add: { component_groups: ["bearcade:prop_driven"] },
        },
      },
    },
  };
  const bpOut = path.join(BP_ENTITIES, `allstars_${prop.id}.json`);
  writeJson(bpOut, bpEntity);
  console.log(
    `  ✓ 行为包实体 → ${path.relative(process.cwd(), bpOut)} (scale ${prop.scale}:${prop.note})`,
  );
}

console.log(`\n完成:${PROPS.length} 个道具已入库`);

await import("./allstars-presentation-assets.mjs");
