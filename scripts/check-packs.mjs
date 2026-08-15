import { readFileSync } from "node:fs";
import path from "node:path";

// 校验 config/packs.json 的 headerUuid 与各包 src/config.ts 的 PACK_ID 一致。
// PACK_ID 双处维护:漂移会导致 IPC 来源校验/房间状态校验静默失败。

const root = process.cwd();
const config = JSON.parse(
  readFileSync(path.join(root, "config", "packs.json"), "utf8"),
);

let failed = false;

for (const pack of config.packs) {
  if (pack.type === "resource") {
    console.log(`- ${pack.id}:资源包,不参与 IPC,跳过 packId 校验`);
    continue;
  }
  // 各包 PACK_ID 定义位置不同:小游戏包在 src/config.ts,Core 的 CORE_PACK_ID 唯一常量在 shared/minigame-core/types.ts(Core/src/types.ts 仅转发)
  const candidates = [
    { file: path.join(root, pack.dir, "src", "config.ts"), pattern: /export const PACK_ID\s*=\s*"([^"]+)"/ },
    { file: path.join(root, pack.dir, "src", "types.ts"), pattern: /export const CORE_PACK_ID\s*=\s*"([^"]+)"/ },
    {
      // Core 的 CORE_PACK_ID 唯一常量已下沉到 shared/minigame-core/types.ts,
      // Core/src/types.ts 仅 re-export;这里直接校验共享常量,避免三处漂移。
      file: path.join(root, "shared", "minigame-core", "types.ts"),
      pattern: /export const CORE_PACK_ID\s*=\s*"([^"]+)"/,
      onlyFor: "core",
    },
  ];
  let found = false;
  for (const { file, pattern, onlyFor } of candidates) {
    if (onlyFor && onlyFor !== pack.id) continue;
    let source = "";
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue; // 该文件不存在,尝试下一个候选
    }
    const match = pattern.exec(source);
    if (!match) continue;
    found = true;
    if (match[1] !== pack.headerUuid) {
      console.error(
        `✗ ${pack.id}:packId 不一致 — config/packs.json=${pack.headerUuid},源码=${match[1]} (${file})`,
      );
      failed = true;
    } else {
      console.log(`✓ ${pack.id}:packId 一致(${match[1]})`);
    }
    break;
  }
  if (!found) {
    // 不参与 IPC 的包(如 Toolkit)可以不定义 packId
    console.log(`- ${pack.id}:未找到 packId 定义(不参与 IPC,跳过)`);
  }
}

if (failed) {
  console.error(
    "packId 校验失败:请同步 config/packs.json 与各包 src/config.ts 的 UUID",
  );
  process.exit(1);
}
console.log("packId 校验通过");
