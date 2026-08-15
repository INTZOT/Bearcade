import { watch } from "node:fs/promises";
import { spawn } from "node:child_process";

const targets = [
  "config",
  "shared",
  "Core-核心/src",
  "Gomoku-五子棋/src",
  "Template-小游戏模板/src",
  "GuessNBuild-建筑猜猜乐/src",
  "BridgeWar-急速战桥/src",
  "Collapse-豆腐渣地板/src",
  "PigCatcher-猪猪争夺战/src",
  "SND5-剑与消亡V/src",
  "Toolkit-开发者工具/src",
];

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
