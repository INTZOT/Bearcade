// 从 @minecraft/vanilla-data 类型快照生成《幸运之柱》的常规物品库。
// 用法:node scripts/gen-pillars-items.mjs
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = readFileSync(
  path.join(root, "docs", "vanilla-data", "lib", "mojang-item.d.ts"),
  "utf8",
);

const ids = [];
const re = /=\s*"(minecraft:[^"]+)"/g;
let match;
while ((match = re.exec(source))) {
  ids.push(match[1]);
}

// 排除管理/调试/非生存常规物品
const excluded = new Set([
  "minecraft:barrier",
  "minecraft:command_block",
  "minecraft:chain_command_block",
  "minecraft:repeating_command_block",
  "minecraft:command_block_minecart",
  "minecraft:structure_block",
  "minecraft:structure_void",
  "minecraft:jigsaw",
  "minecraft:border_block",
  "minecraft:allow",
  "minecraft:deny",
  "minecraft:camera",
]);
for (let i = 0; i <= 15; i++) {
  excluded.add(`minecraft:light_block_${i}`);
}

const filtered = ids.filter((id) => !excluded.has(id));

const output = `// 自动生成:由 docs/vanilla-data/lib/mojang-item.d.ts 提取的全部常规物品 ID。
// 如需更新,执行 node scripts/gen-pillars-items.mjs
export const ALL_ITEMS: readonly string[] = [
${filtered.map((id) => `  "${id}",`).join("\n")}
];
`;

writeFileSync(
  path.join(root, "pillars-幸运之柱", "src", "items.ts"),
  output,
  "utf8",
);
console.log(`已生成 ${filtered.length} 个物品 ID -> pillars-幸运之柱/src/items.ts`);
