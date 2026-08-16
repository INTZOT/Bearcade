import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { cp as cpDir } from "node:fs/promises";
import path from "node:path";
import { EXTRA_DIRS } from "./extras.mjs";

const root = process.cwd();
const config = JSON.parse(
  readFileSync(path.join(root, "config", "packs.json"), "utf8"),
);

// 默认部署目标:本机开发环境(Levilauncher 1.26.42.01 全局开发行为包目录),可用 MC_DEV_PACKS 覆盖
const DEFAULT_TARGET =
  "D:\\Apps\\Levilauncher\\versions\\1.26.42.01\\Minecraft Bedrock\\Users\\Shared\\games\\com.mojang\\development_behavior_packs";

const targetRoot = path.resolve(process.env.MC_DEV_PACKS ?? DEFAULT_TARGET);
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
  await cpDir(path.join(src, "manifest.json"), path.join(targetDir, "manifest.json"));
  await cpDir(path.join(src, "scripts"), path.join(targetDir, "scripts"), {
    recursive: true,
  });
  for (const extra of EXTRA_DIRS) {
    const extraPath = path.join(src, extra);
    if (existsSync(extraPath)) {
      await cpDir(extraPath, path.join(targetDir, extra), { recursive: true });
    }
  }
  console.log(`已部署 ${pack.name} -> ${targetDir}`);
}
