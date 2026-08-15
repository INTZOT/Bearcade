import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { zipDirectory } from "./zip.mjs";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const config = JSON.parse(
  readFileSync(path.join(root, "config", "packs.json"), "utf8"),
);

// 版本唯一事实来源是 config/packs.json.projectVersion;
// package.json.version 必须与其一致,避免 devkit 与 manifest 版本漂移。
if (!Array.isArray(config.projectVersion) || config.projectVersion.length !== 3) {
  throw new Error("config/packs.json 的 projectVersion 必须为 [major, minor, patch]");
}
const version = config.projectVersion.join(".");
if (pkg.version !== version) {
  throw new Error(
    `版本不一致:package.json.version=${pkg.version},config/packs.json.projectVersion=${version}`,
  );
}

// 先重新执行 package,确保 devkit 内附带的 core/template mcpack 与当前源码一致
execFileSync(process.execPath, [path.join(root, "scripts", "package.mjs")], {
  stdio: "inherit",
});

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
// 这两个是本地手动下载的官方文档快照(约 9.4MB,.gitignore 不入库),不进 devkit
rmSync(path.join(dist, "docs", "bedrock-creator-docs.md"), { force: true });
rmSync(path.join(dist, "docs", "minecraft-creator.md"), { force: true });
copy("package.json", "package.json");
copy("tsconfig.json", "tsconfig.json");
copy("scripts", "scripts");
copy("shared", "shared");

// 包:Core + 模板(模板目录内已内嵌 resource-pack,不含内部小游戏)
copy("Core-核心", "Core-核心");
copy("Template-小游戏模板", "Template-小游戏模板");

// 过滤后的包配置:开发者只会构建 Core 与自己的游戏;
// projectVersion/phase 必须保留,否则开发套件构建时版本会静默回退。
const filtered = {
  projectVersion: config.projectVersion,
  phase: config.phase,
  packs: config.packs.filter((pack) =>
    ["core", "template", "template_hud"].includes(pack.id),
  ),
};
mkdirSync(path.join(dist, "config"), { recursive: true });
writeFileSync(
  path.join(dist, "config", "packs.json"),
  JSON.stringify(filtered, null, 2) + "\n",
);

// 直接安装的 mcpack(已由上面的 package.mjs 重新生成)
mkdirSync(path.join(dist, "packs"), { recursive: true });
copy("dist/packages/core.mcpack", "packs/core.mcpack");
copy("dist/packages/template.mcpack", "packs/template.mcpack");
copy("dist/packages/template_hud.mcpack", "packs/template_hud.mcpack");

const zipPath = path.join(root, "dist", `BearcadeDevKit-${version}.zip`);
await zipDirectory(dist, zipPath);
console.log(`开发套件已生成:${zipPath}`);
