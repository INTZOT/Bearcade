import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cp as cpDir } from "node:fs/promises";
import path from "node:path";
import { zipDirectory } from "./zip.mjs";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;
const dist = path.join(root, "dist", "devkit", `BearcadeDevKit-${version}`);

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

async function copy(src, dst) {
  await cpDir(path.join(root, src), path.join(dist, dst), { recursive: true });
}

// 文档与工具链
await copy("README.md", "README.md");
await copy("development.md", "development.md");
await copy(".gitignore", ".gitignore");
await copy("docs", "docs");
await copy("package.json", "package.json");
await copy("tsconfig.json", "tsconfig.json");
await copy("scripts", "scripts");
await copy("shared", "shared");

// 包:仅 Core + 模板(不含内部小游戏)
await copy("Core-核心", "Core-核心");
await copy("Template-小游戏模板", "Template-小游戏模板");

// 过滤后的包配置:开发者只会构建 Core 与自己的游戏;
// projectVersion/phase 必须保留,否则开发套件构建时版本会静默回退到 0.0.1
const config = JSON.parse(
  readFileSync(path.join(root, "config", "packs.json"), "utf8"),
);
const filtered = {
  projectVersion: config.projectVersion,
  phase: config.phase,
  packs: config.packs.filter((pack) => ["core", "template"].includes(pack.id)),
};
mkdirSync(path.join(dist, "config"), { recursive: true });
writeFileSync(
  path.join(dist, "config", "packs.json"),
  JSON.stringify(filtered, null, 2) + "\n",
);

// 可直接安装的 mcpack(需先执行 npm run package)
mkdirSync(path.join(dist, "packs"), { recursive: true });
await copy("dist/packages/core.mcpack", "packs/core.mcpack");
await copy("dist/packages/template.mcpack", "packs/template.mcpack");

const zipPath = path.join(root, "dist", `BearcadeDevKit-${version}.zip`);
await zipDirectory(dist, zipPath);
console.log(`开发套件已生成:${zipPath}`);
