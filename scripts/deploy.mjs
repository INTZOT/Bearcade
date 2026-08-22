import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { EXTRA_DIRS, RESOURCE_DIRS, RESOURCE_ROOT_FILES } from "./extras.mjs";

const root = process.cwd();
const config = JSON.parse(
  readFileSync(path.join(root, "config", "packs.json"), "utf8"),
);


// 默认部署目标:本机开发环境(Levilauncher 1.26.42.01 全局开发行为包目录),可用 MC_DEV_PACKS 覆盖
const DEFAULT_TARGET =
  "D:\\Apps\\Levilauncher\\versions\\1.26.42.01\\Minecraft Bedrock\\Users\\Shared\\games\\com.mojang\\development_behavior_packs";

// 默认路径仅对 Windows 开发机有效;其他平台必须显式设置 MC_DEV_PACKS,
// 避免 path.resolve 把 "D:\..." 解析成本仓库内的怪目录。
let behaviorRoot;
if (process.env.MC_DEV_PACKS) {
  behaviorRoot = path.resolve(process.env.MC_DEV_PACKS);
} else if (process.platform === "win32") {
  behaviorRoot = path.resolve(DEFAULT_TARGET);
} else {
  throw new Error(
    "当前平台没有默认开发行为包目录,请设置 MC_DEV_PACKS 后重试",
  );
}
const onlyIds = process.argv.slice(2);
mkdirSync(behaviorRoot, { recursive: true });

// 资源包部署到与行为包目录相邻的 development_resource_packs;
// 也可用 MC_DEV_RESOURCE_PACKS 单独覆盖。
function defaultResourceRoot(behaviorPackRoot) {
  return path.resolve(behaviorPackRoot, "..", "development_resource_packs");
}
let resourceRoot;
if (process.env.MC_DEV_RESOURCE_PACKS) {
  resourceRoot = path.resolve(process.env.MC_DEV_RESOURCE_PACKS);
} else {
  resourceRoot = defaultResourceRoot(behaviorRoot);
}
mkdirSync(resourceRoot, { recursive: true });

function targetRootFor(pack) {
  const rootForPack = pack.type === "resource" ? resourceRoot : behaviorRoot;
  // 资源包源码内嵌在 <游戏目录>/resource-pack,
  // 部署到开发目录时仍还原为一对一的 <游戏目录>-资源包 文件夹。
  const nestedDir =
    pack.dir.includes("/") || pack.dir.includes(path.sep);
  const folder =
    pack.type === "resource" && nestedDir
      ? `${path.basename(path.dirname(pack.dir))}-资源包`
      : pack.dir;
  const prefix = rootForPack.endsWith(path.sep) ? rootForPack : rootForPack + path.sep;
  const targetDir = path.join(rootForPack, folder);
  // 防误删:目标必须位于对应开发包根目录之内
  if (!targetDir.startsWith(prefix)) {
    throw new Error(`部署目标超出允许目录: ${targetDir}`);
  }
  return targetDir;
}

const requestedIds = new Set(onlyIds);
function isSelected(pack) {
  if (requestedIds.size === 0) return true;
  if (requestedIds.has(pack.id)) return true;
  // 一对一分包:请求任一行为包时自动带上其配对 _hud 资源包,反之亦然
  if (pack.type === "resource" && requestedIds.has(pack.id.replace(/_hud$/, ""))) {
    return true;
  }
  if (pack.type !== "resource" && requestedIds.has(`${pack.id}_hud`)) {
    return true;
  }
  return false;
}

for (const pack of config.packs) {
  // devOnly 包(如 Template,注册"mygame"游戏)默认不部署,显式指定时才部署
  if (pack.devOnly && !requestedIds.has(pack.id)) continue;
  if (!isSelected(pack)) continue;
  const src = path.join(root, pack.dir);
  const targetDir = targetRootFor(pack);

  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  cpSync(path.join(src, "manifest.json"), path.join(targetDir, "manifest.json"));
  if (pack.type === "resource") {
    for (const extra of RESOURCE_DIRS) {
      const extraPath = path.join(src, extra);
      if (existsSync(extraPath)) {
        cpSync(extraPath, path.join(targetDir, extra), { recursive: true });
      }
    }
    for (const file of RESOURCE_ROOT_FILES) {
      const filePath = path.join(src, file);
      if (existsSync(filePath)) {
        cpSync(filePath, path.join(targetDir, file));
      }
    }
  } else {
    cpSync(path.join(src, "scripts"), path.join(targetDir, "scripts"), {
      recursive: true,
    });
    for (const extra of EXTRA_DIRS) {
      const extraPath = path.join(src, extra);
      if (existsSync(extraPath)) {
        cpSync(extraPath, path.join(targetDir, extra), { recursive: true });
      }
    }
  }
  console.log(`已部署 ${pack.name} -> ${targetDir}`);
}
