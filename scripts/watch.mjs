import { watch } from "node:fs/promises";
import { spawn } from "node:child_process";

const targets = ["config", "Core-核心/src"];

async function rebuild() {
  await new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/build.mjs"], {
      stdio: "inherit",
    });
    child.on("exit", resolve);
  });
}

console.log("watch:监听 config/ 与各包 src/,Ctrl+C 退出");
await rebuild();

const watchers = await Promise.all(
  targets.map((target) => watch(target, { recursive: true })),
);
for (const watcher of watchers) {
  (async () => {
    for await (const _ of watcher) {
      await rebuild();
    }
  })();
}
