import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const config = JSON.parse(
  readFileSync(path.join(root, "config", "packs.json"), "utf8"),
);
const dist = path.join(root, "dist", "packages");
const staging = path.join(root, "dist", "staging");

mkdirSync(dist, { recursive: true });
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

for (const pack of config.packs) {
  const src = path.join(root, pack.dir);
  const dest = path.join(staging, pack.id);
  mkdirSync(dest, { recursive: true });
  cpSync(path.join(src, "manifest.json"), path.join(dest, "manifest.json"));
  cpSync(path.join(src, "scripts"), path.join(dest, "scripts"), {
    recursive: true,
  });

  const zipPath = path.join(dist, `${pack.id}.mcpack`);
  const zipTemp = `${zipPath}.zip`;
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${dest}\\*' -DestinationPath '${zipTemp}' -Force`,
    ],
    { stdio: "inherit" },
  );
  cpSync(zipTemp, zipPath);
  rmSync(zipTemp);
  console.log(`已生成 ${zipPath}`);
}

const addonPath = path.join(dist, "bearcade.mcaddon");
const addonTemp = `${addonPath}.zip`;
execFileSync(
  "powershell",
  [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path '${staging}\\*' -DestinationPath '${addonTemp}' -Force`,
  ],
  { stdio: "inherit" },
);
cpSync(addonTemp, addonPath);
rmSync(addonTemp);
console.log(`已生成 ${addonPath}`);
