import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const config = JSON.parse(
  readFileSync(path.join(root, "config", "packs.json"), "utf8"),
);

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
  cpSync(path.join(src, "manifest.json"), path.join(targetDir, "manifest.json"));
  cpSync(path.join(src, "scripts"), path.join(targetDir, "scripts"), {
    recursive: true,
  });
  console.log(`已部署 ${pack.name} -> ${targetDir}`);
}
