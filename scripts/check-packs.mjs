import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { entityFloatTokenErrors } from "./bedrock-entity-json.mjs";
import { allstarsRenderErrors } from "./allstars-render-validation.mjs";

// 校验 config/packs.json 的 headerUuid 与各包 src/config.ts 的 PACK_ID 一致。
// PACK_ID 双处维护:漂移会导致 IPC 来源校验/房间状态校验静默失败。
// 另含自定义实体的静态校验(见文件末尾):客户端实体是"整条描述"级别校验,
// 一处不合法会导致模型完全不渲染且脚本侧毫无异常,必须在打包前拦下。

const root = process.cwd();
const config = JSON.parse(
  readFileSync(path.join(root, "config", "packs.json"), "utf8"),
);

let failed = false;

for (const pack of config.packs) {
  if (pack.type === "resource") {
    console.log(`- ${pack.id}:资源包,不参与 IPC,跳过 packId 校验`);
    continue;
  }
  // 各包 PACK_ID 定义位置不同:小游戏包在 src/config.ts,Core 的 CORE_PACK_ID 唯一常量在 shared/minigame-core/types.ts(Core/src/types.ts 仅转发)
  const candidates = [
    { file: path.join(root, pack.dir, "src", "config.ts"), pattern: /export const PACK_ID\s*=\s*"([^"]+)"/ },
    { file: path.join(root, pack.dir, "src", "types.ts"), pattern: /export const CORE_PACK_ID\s*=\s*"([^"]+)"/ },
    {
      // Core 的 CORE_PACK_ID 唯一常量已下沉到 shared/minigame-core/types.ts,
      // Core/src/types.ts 仅 re-export;这里直接校验共享常量,避免三处漂移。
      file: path.join(root, "shared", "minigame-core", "types.ts"),
      pattern: /export const CORE_PACK_ID\s*=\s*"([^"]+)"/,
      onlyFor: "core",
    },
  ];
  let found = false;
  for (const { file, pattern, onlyFor } of candidates) {
    if (onlyFor && onlyFor !== pack.id) continue;
    let source = "";
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue; // 该文件不存在,尝试下一个候选
    }
    const match = pattern.exec(source);
    if (!match) continue;
    found = true;
    if (match[1] !== pack.headerUuid) {
      console.error(
        `✗ ${pack.id}:packId 不一致 — config/packs.json=${pack.headerUuid},源码=${match[1]} (${file})`,
      );
      failed = true;
    } else {
      console.log(`✓ ${pack.id}:packId 一致(${match[1]})`);
    }
    break;
  }
  if (!found) {
    // 不参与 IPC 的包(如 Toolkit)可以不定义 packId
    console.log(`- ${pack.id}:未找到 packId 定义(不参与 IPC,跳过)`);
  }
}

// ---------------------------------------------------------------
// 自定义实体静态校验(2026-09-25 实机踩坑后加入,详见 docs/lessons.md §14)
// 背景:客户端实体(client_entity)是**整条描述**级别校验 —— 任何一处不合法,
// 整条描述被丢弃,表现为"实体存在、脚本/粒子一切正常、模型完全不渲染",
// 脚本侧查不出来。以下规则全部来自实机内容日志的实测报错。
// ---------------------------------------------------------------

/** 递归列出目录下所有 .json(目录不存在返回空数组) */
function walkJson(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJson(full));
    else if (entry.name.endsWith(".json")) out.push(full);
  }
  return out;
}

/** 读取并解析 JSON;失败时打印并返回 undefined */
function readJson(rel, file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`✗ ${rel} 不是合法 JSON:${error.message}`);
    failed = true;
    return undefined;
  }
}

let entityChecked = 0;

for (const pack of config.packs) {
  const rpRoot = path.join(root, pack.dir, "resource-pack");

  // ① 客户端实体定义
  for (const file of walkJson(path.join(rpRoot, "entity"))) {
    const rel = path.relative(root, file);
    const json = readJson(rel, file);
    const desc = json?.["minecraft:client_entity"]?.description;
    if (!desc) continue;
    entityChecked += 1;

    // scripts.animate 不能是空数组(schema 报 "Array too small (0 < 1)" → 整条描述被丢弃)
    if (desc.scripts && "animate" in desc.scripts) {
      const animate = desc.scripts.animate;
      if (!Array.isArray(animate) || animate.length === 0) {
        console.error(
          `✗ ${rel}: scripts.animate 必须是非空数组 —— 空数组过不了客户端 schema 校验,` +
            "整条 client_entity 会被丢弃(实体在、粒子在、模型完全不渲染)。动画全由 playAnimation 驱动时不要写 scripts 块",
        );
        failed = true;
      }
    }

    // render_controllers 必填非空
    const rcs = desc.render_controllers;
    if (!Array.isArray(rcs) || rcs.length === 0) {
      console.error(`✗ ${rel}: 缺 render_controllers(非空数组),客户端可能不渲染模型`);
      failed = true;
    }

    // controller.render.default 用 Texture.default ⇒ textures.default 必须有
    if (!desc.textures || typeof desc.textures.default !== "string") {
      console.error(
        `✗ ${rel}: 缺 textures.default —— 内建 controller.render.default 渲染的就是 Texture.default`,
      );
      failed = true;
    }

    // 自定义渲染控制器必须真有对应文件(实机曾报 "error parsing …render_controllers.json:")
    for (const rc of Array.isArray(rcs) ? rcs : []) {
      if (typeof rc !== "string" || rc === "controller.render.default") continue;
      const found = walkJson(path.join(rpRoot, "render_controllers")).some((f) =>
        readFileSync(f, "utf8").includes(`"${rc}"`),
      );
      if (!found) {
        console.error(
          `✗ ${rel}: 引用了 ${rc} 但 resource-pack/render_controllers/ 下没有定义它的文件` +
            "(不需要多材质/多贴图时,建议直接用内建 controller.render.default)",
        );
        failed = true;
      }
    }
  }

  // ② 行为包实体:damage_sensor.triggers 用数组且带 cause 会报 Json 错(非致命但不该留)
  for (const file of walkJson(path.join(root, pack.dir, "entities"))) {
    const rel = path.relative(root, file);
    const json = readJson(rel, file);
    if (json) {
      for (const error of entityFloatTokenErrors(readFileSync(file, "utf8"))) {
        console.error(`✗ ${rel}: ${error}，否则实体可能无法注册`);
        failed = true;
      }
    }
    const components = json?.["minecraft:entity"]?.components;
    const triggers = components?.["minecraft:damage_sensor"]?.triggers;
    if (Array.isArray(triggers) && triggers.some((t) => t && typeof t === "object" && "cause" in t)) {
      console.error(
        `✗ ${rel}: minecraft:damage_sensor.triggers 是数组且带 cause —— 实机报` +
          ' "triggers | deals_damage | deals_damage | unknown child schema option type";' +
          ' 改用原版对象写法 {"triggers": {"cause": "all", "deals_damage": false}}',
      );
      failed = true;
    }
  }
}

const allstars = config.packs.find(pack => pack.id === "allstars");
if (allstars) {
  try {
    for (const error of allstarsRenderErrors(path.join(root, allstars.dir, "resource-pack"))) {
      console.error(`✗ ${error}`);
      failed = true;
    }
  } catch (error) {
    console.error(`✗ AllStars render resource validation: ${error.message}`);
    failed = true;
  }
}

if (failed) {
  console.error(
    "包校验失败:请修复上面列出的 UUID 或实体定义错误",
  );
  process.exit(1);
}
console.log(`packId 校验通过(另校验客户端实体 ${entityChecked} 个)`);
