import { readFile, watch } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const packsConfig = JSON.parse(
  await readFile(path.join(root, "config", "packs.json"), "utf8"),
);

// 监听目标从 config/packs.json 派生,新增游戏包无需手工维护本文件;
// devkit 的过滤后 config 只含 core/template,监听也自动只覆盖存在的目录。
const targets = [
  "config",
  "shared",
  ...packsConfig.packs.map((pack) =>
    pack.type === "resource" ? `${pack.dir}/ui` : `${pack.dir}/src`,
  ),
];

function runBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/build.mjs"], {
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`build.mjs exited with code ${code}`));
    });
  });
}

// 事件可能密集到达:串行重建 + 运行期间最多排队一次尾随重建,
// 避免多个 build 并发写同一 main.js/manifest.json。
let running = false;
let queued = false;

function requestRebuild() {
  if (running) {
    queued = true;
    return;
  }
  running = true;
  void runBuild()
    .catch((error) => {
      console.error("watch rebuild failed:", error);
    })
    .finally(() => {
      running = false;
      if (queued) {
        queued = false;
        requestRebuild();
      }
    });
}

console.log("watch:监听 config/、shared/ 与 config/packs.json 中各包 src/,Ctrl+C 退出");
await runBuild();

const watchers = await Promise.all(
  targets.map((target) => watch(target, { recursive: true })),
);
for (const watcher of watchers) {
  (async () => {
    for await (const _ of watcher) {
      requestRebuild();
    }
  })();
}
