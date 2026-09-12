// ============================================================
// 从 Mc-Mahjong(现成麻将牌全套)同步资产到 Bearcade Mahjong 包。
// 来源:C:\Users\24827\Downloads\Mc-Mahjong
// 同步内容:BP blocks/item_catalog,RP models/textures/texts/blocks.json
// ============================================================
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = "C:/Users/24827/Downloads/Mc-Mahjong (2)";
const DST = path.join(ROOT, "Mahjong-麻将");

const DIRS = [
  [path.join(SRC, "BP", "blocks"), path.join(DST, "blocks")],
  [path.join(SRC, "RP", "models", "blocks"), path.join(DST, "resource-pack", "models", "blocks")],
  [path.join(SRC, "RP", "textures", "blocks"), path.join(DST, "resource-pack", "textures", "blocks")],
];

const FILES = [
  [path.join(SRC, "BP", "item_catalog", "crafting_item_catalog.json"), path.join(DST, "item_catalog", "crafting_item_catalog.json")],
  [path.join(SRC, "RP", "textures", "terrain_texture.json"), path.join(DST, "resource-pack", "textures", "terrain_texture.json")],
  [path.join(SRC, "RP", "blocks.json"), path.join(DST, "resource-pack", "blocks.json")],
  [path.join(SRC, "RP", "texts", "zh_CN.lang"), path.join(DST, "resource-pack", "texts", "zh_CN.lang")],
  [path.join(SRC, "RP", "texts", "en_US.lang"), path.join(DST, "resource-pack", "texts", "en_US.lang")],
];

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

function copyDir(src, dst) {
  ensureDir(dst);
  for (const name of readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dst, name);
    if (existsSync(s)) copyFileSync(s, d);
  }
}

function copyFile(src, dst) {
  ensureDir(path.dirname(dst));
  if (existsSync(src)) copyFileSync(src, dst);
  else console.warn(`缺少文件: ${src}`);
}

for (const [src, dst] of DIRS) copyDir(src, dst);
for (const [src, dst] of FILES) copyFile(src, dst);

console.log(
  `完成:从 Mc-Mahjong 同步麻将资产(${readdirSync(path.join(DST, "blocks")).filter((f) => f.endsWith(".json")).length} 个方块)`,
);
