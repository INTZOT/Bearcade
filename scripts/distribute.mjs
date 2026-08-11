import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;
const dist = path.join(root, "dist", "devkit", `BearcadeDevKit-${version}`);

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

function copy(src, dst) {
  cpSync(path.join(root, src), path.join(dist, dst), { recursive: true });
}

// 文档与工具链
copy("README.md", "README.md");
copy("development.md", "development.md");
copy(".gitignore", ".gitignore");
copy("docs", "docs");
copy("package.json", "package.json");
copy("tsconfig.json", "tsconfig.json");
copy("scripts", "scripts");

// 包:仅 Core + 模板(不含内部小游戏)
copy("Core-核心", "Core-核心");
copy("Template-小游戏模板", "Template-小游戏模板");

// 过滤后的包配置:开发者只会构建 Core 与自己的游戏
const config = JSON.parse(
  readFileSync(path.join(root, "config", "packs.json"), "utf8"),
);
const filtered = {
  packs: config.packs.filter((pack) => ["core", "template"].includes(pack.id)),
};
mkdirSync(path.join(dist, "config"), { recursive: true });
writeFileSync(
  path.join(dist, "config", "packs.json"),
  JSON.stringify(filtered, null, 2) + "\n",
);

// 可直接安装的 mcpack(需先执行 npm run package)
mkdirSync(path.join(dist, "packs"), { recursive: true });
copy("dist/packages/core.mcpack", "packs/core.mcpack");
copy("dist/packages/template.mcpack", "packs/template.mcpack");

const zipPath = path.join(root, "dist", `BearcadeDevKit-${version}.zip`);
execFileSync(
  "powershell",
  [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path '${dist}\\*' -DestinationPath '${zipPath}' -Force`,
  ],
  { stdio: "inherit" },
);
console.log(`开发套件已生成:${zipPath}`);
