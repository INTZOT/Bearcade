// External authoring files are only needed when explicitly importing/rebuilding assets.
// Normal build/package/runtime use the assets already stored in this repository.
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

export function resolveWorkflowRoot(override) {
  const configured = override ?? process.env.ALLSTARS_FIGHTER_WORKFLOW ??
    JSON.parse(readFileSync(new URL("../config/allstars-assets.json", import.meta.url), "utf8")).workflowRoot;
  if (typeof configured !== "string" || !configured.trim()) {
    throw new Error("请在 config/allstars-assets.json 中设置 workflowRoot，或指定 ALLSTARS_FIGHTER_WORKFLOW。");
  }
  const root = path.resolve(configured);
  for (const marker of ["animation_catalog.json", "characters/green_beret/character_manifest.json"]) {
    const file = path.join(root, marker);
    try {
      if (!statSync(file).isFile()) throw new Error("不是文件");
    } catch {
      throw new Error(`找不到春叶制作目录中的 ${file}；搬家后请更新 config/allstars-assets.json 的 workflowRoot。`);
    }
  }
  return root;
}
