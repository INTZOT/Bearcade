import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const config = JSON.parse(
  await readFile(path.join(root, "config", "packs.json"), "utf8"),
);

const EXTERNALS = [
  "@minecraft/common",
  "@minecraft/math",
  "@minecraft/server",
  "@minecraft/server-ui",
  "@minecraft/vanilla-data",
];

for (const pack of config.packs) {
  const dir = path.join(root, pack.dir);
  const entry = path.join(dir, "src", "main.ts");

  await mkdir(path.join(dir, "scripts"), { recursive: true });
  await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    target: "es2020",
    external: EXTERNALS,
    sourcemap: true,
    outfile: path.join(dir, "scripts", "main.js"),
    logLevel: "info",
  });

  const packDeps = (pack.packDependencies ?? []).map((depId) => {
    const dep = config.packs.find((item) => item.id === depId);
    if (!dep) {
      throw new Error(`packDependencies 引用了未定义的包: ${depId}`);
    }
    return { uuid: dep.headerUuid, version: dep.version };
  });

  const manifest = {
    format_version: 2,
    header: {
      name: pack.name,
      description: pack.description,
      uuid: pack.headerUuid,
      version: pack.version,
      min_engine_version: pack.minEngineVersion,
    },
    modules: [
      {
        type: "script",
        language: "javascript",
        uuid: pack.moduleUuid,
        version: pack.version,
        entry: "scripts/main.js",
      },
    ],
    dependencies: [...(pack.dependencies ?? []), ...packDeps],
  };

  await writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}

console.log("build 完成:manifest 已生成,脚本已打包");
