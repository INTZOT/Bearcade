import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { EXTRA_DIRS } from "./extras.mjs";

const root = process.cwd();
const config = JSON.parse(
  readFileSync(path.join(root, "config", "packs.json"), "utf8"),
);

// 部署目标必须显式提供(不再硬编码本机路径,防止误部署到无关机器目录)
const targetRootEnv = process.env.MC_DEV_PACKS;
if (!targetRootEnv) {
  throw new Error(
    "未设置 MC_DEV_PACKS:请指向 Minecraft 的 development_behavior_packs 目录后重试",
  );
}
const targetRoot = path.resolve(targetRootEnv);
const onlyIds = process.argv.slice(2);
mkdirSync(targetRoot, { recursive: true });

for (const pack of config.packs) {
  if (onlyIds.length > 0 && !onlyIds.includes(pack.id)) continue;
  const src = path.join(root, pack.dir);
  const targetDir = path.join(targetRoot, pack.dir);

  // 防误删:目标必须位于 development_behavior_packs 根目录之内
  const rootPrefix = targetRoot.endsWith(path.sep)
    ? targetRoot
    : targetRoot + path.sep;
  if (!targetDir.startsWith(rootPrefix)) {
    throw new Error(`部署目标超出允许目录: ${targetDir}`);
  }

  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  cpSync(path.join(src, "manifest.json"), path.join(targetDir, "manifest.json"));
  cpSync(path.join(src, "scripts"), path.join(targetDir, "scripts"), {
    recursive: true,
  });
  for (const extra of EXTRA_DIRS) {
    const extraPath = path.join(src, extra);
    if (existsSync(extraPath)) {
      cpSync(extraPath, path.join(targetDir, extra), { recursive: true });
    }
  }
  console.log(`已部署 ${pack.name} -> ${targetDir}`);
}
