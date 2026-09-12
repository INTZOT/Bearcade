import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { zipDirectory } from "./zip.mjs";
import { EXTRA_DIRS, RESOURCE_DIRS, RESOURCE_ROOT_FILES } from "./extras.mjs";

const root = process.cwd();
const config = JSON.parse(
  readFileSync(path.join(root, "config", "packs.json"), "utf8"),
);
const dist = path.join(root, "dist", "packages");
const staging = path.join(root, "dist", "staging");


mkdirSync(dist, { recursive: true });
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

const copyOptions = {
  recursive: true,
  filter: (source) => !source.endsWith(".js.map"),
};

for (const pack of config.packs) {
  const src = path.join(root, pack.dir);
  const dest = path.join(staging, pack.id);
  mkdirSync(dest, { recursive: true });
  cpSync(path.join(src, "manifest.json"), path.join(dest, "manifest.json"));
  if (pack.type === "resource") {
    for (const extra of RESOURCE_DIRS) {
      const extraPath = path.join(src, extra);
      if (existsSync(extraPath)) {
        cpSync(extraPath, path.join(dest, extra), copyOptions);
      }
    }
    for (const file of RESOURCE_ROOT_FILES) {
      const filePath = path.join(src, file);
      if (existsSync(filePath) && !filePath.endsWith(".js.map")) {
        cpSync(filePath, path.join(dest, file));
      }
    }
  } else {
    cpSync(path.join(src, "scripts"), path.join(dest, "scripts"), copyOptions);
    for (const extra of EXTRA_DIRS) {
      const extraPath = path.join(src, extra);
      if (existsSync(extraPath)) {
        cpSync(extraPath, path.join(dest, extra), copyOptions);
      }
    }
  }

  const zipPath = path.join(dist, `${pack.id}.mcpack`);
  await zipDirectory(dest, zipPath);
  console.log(`已生成 ${zipPath}`);
}

// 合并 addon 前剔除 devOnly 包(如 Template):
// 模板包注册的是 "mygame" 游戏,打进正式 bearcade.mcaddon 会在大厅菜单出现"我的小游戏"。
// 独立 .mcpack 仍会产出(开发套件 distribute 需要),仅不并入合并包。
for (const pack of config.packs) {
  if (pack.devOnly) {
    rmSync(path.join(staging, pack.id), { recursive: true, force: true });
  }
}

const addonPath = path.join(dist, "bearcade.mcaddon");
await zipDirectory(staging, addonPath);
console.log(`已生成 ${addonPath}`);
