#!/usr/bin/env node
import { createInterface } from "node:readline";
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  copyFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const question = (q) => new Promise((resolve) => rl.question(q, resolve));

const root = process.cwd();
const templateDir = "Template-小游戏模板";

/* ---------- 工具函数 ---------- */

async function copyDir(src, dest) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

function isTextFile(fileName) {
  const textExts = [
    ".ts", ".js", ".json", ".md", ".mjs", ".txt", ".css", ".html", ".xml",
  ];
  return textExts.some((ext) => fileName.toLowerCase().endsWith(ext));
}

async function replaceInFile(filePath, replacements) {
  if (!isTextFile(filePath)) return;
  let content = await readFile(filePath, "utf8");
  let changed = false;
  for (const { from, to } of replacements) {
    if (typeof from === "string") {
      if (content.includes(from)) {
        content = content.split(from).join(to);
        changed = true;
      }
    } else if (from.test(content)) {
      content = content.replace(from, to);
      changed = true;
    }
  }
  if (changed) {
    await writeFile(filePath, content, "utf8");
  }
}

/* ---------- 主流程 ---------- */

async function main() {
  console.log("🐻 Bearcade 小游戏创建向导");
  console.log("请按提示填写信息，脚本将自动从模板创建新小游戏包。\n");

  /* 1. 游戏ID */
  let gameId = "";
  while (true) {
    gameId = await question("1/7 游戏ID (小写字母/数字/下划线，如 mygame): ");
    if (!gameId) {
      console.log("   ❌ 游戏ID不能为空");
      continue;
    }
    if (!/^[a-z][a-z0-9_]*$/.test(gameId)) {
      console.log("   ❌ 格式错误：必须以字母开头，只能包含小写字母、数字、下划线");
      continue;
    }
    break;
  }

  /* 2. 中文显示名 */
  let displayName = await question("2/7 中文显示名 (如 我的游戏): ");
  if (!displayName) displayName = gameId;

  /* 3. 目录名 */
  const defaultDirName =
    gameId.charAt(0).toUpperCase() + gameId.slice(1) + "-" + displayName;
  let dirName = await question(`3/7 目录名 [${defaultDirName}]: `);
  if (!dirName) dirName = defaultDirName;

  /* 4. 房间数量 */
  let roomCount = await question("4/7 房间数量 [2]: ");
  if (!roomCount) roomCount = "2";
  roomCount = parseInt(roomCount, 10);
  if (isNaN(roomCount) || roomCount < 1) roomCount = 2;

  /* 5. 最大玩家数 */
  let maxPlayers = await question("5/7 单房间最大玩家数 [2]: ");
  if (!maxPlayers) maxPlayers = "2";
  maxPlayers = parseInt(maxPlayers, 10);
  if (isNaN(maxPlayers) || maxPlayers < 1) maxPlayers = 2;

  /* 6. 派对模式 */
  let partyRaw = await question("6/7 派对模式可用 (去除人数上限后仍可正常运行) [y/N]: ");
  const partyAvailable = partyRaw.trim().toLowerCase() === "y";

  /* 7. 准备房间坐标 */
  let prepCoord = await question("7/7 准备房间坐标 x,y,z [0,0,0]: ");
  if (!prepCoord) prepCoord = "0,0,0";
  const [px, py, pz] = prepCoord.split(",").map((s) => parseInt(s.trim(), 10));
  const prepSpawn = {
    x: isNaN(px) ? 0 : px,
    y: isNaN(py) ? 0 : py,
    z: isNaN(pz) ? 0 : pz,
  };

  /* 确认 */
  console.log("\n📋 确认信息：");
  console.log(`   游戏ID        : ${gameId}`);
  console.log(`   中文显示名    : ${displayName}`);
  console.log(`   目录名        : ${dirName}`);
  console.log(`   房间数量      : ${roomCount}`);
  console.log(`   最大玩家数    : ${maxPlayers}`);
  console.log(`   派对模式可用  : ${partyAvailable ? "是" : "否"}`);
  console.log(`   准备房间坐标  : (${prepSpawn.x}, ${prepSpawn.y}, ${prepSpawn.z})`);

  const confirm = await question("\n确认创建? [Y/n]: ");
  if (confirm.trim().toLowerCase() === "n") {
    console.log("已取消");
    return;
  }

  /* 检查目录是否已存在 */
  const destPath = path.join(root, dirName);
  if (existsSync(destPath)) {
    console.error(`\n❌ 目录已存在: ${dirName}`);
    process.exit(1);
  }

  /* 检查模板目录 */
  const templatePath = path.join(root, templateDir);
  if (!existsSync(templatePath)) {
    console.error(`\n❌ 模板目录不存在: ${templateDir}`);
    process.exit(1);
  }

  /* 复制模板 */
  console.log(`\n📂 复制模板到 ${dirName} ...`);
  await copyDir(templatePath, destPath);

  /* 生成新UUID */
  const behaviorHeaderUuid = randomUUID();
  const behaviorModuleUuid = randomUUID();
  const resourceHeaderUuid = randomUUID();
  const resourceModuleUuid = randomUUID();

  /* 先精确修改 config.ts（在全局替换之前，避免正则失效） */
  const configPath = path.join(destPath, "src", "config.ts");
  let configContent = await readFile(configPath, "utf8");

  configContent = configContent
    .replace(
      /export const GAME_ID = "mygame";/,
      `export const GAME_ID = "${gameId}";`
    )
    .replace(
      /export const DISPLAY_NAME = "我的小游戏";/,
      `export const DISPLAY_NAME = "${displayName}";`
    )
    .replace(
      /export const PACK_ID = "95076440-41a8-49f8-9aeb-f57f4edd0db5";/,
      `export const PACK_ID = "${behaviorHeaderUuid}";`
    )
    .replace(
      /export const ROOM_COUNT = 2;/,
      `export const ROOM_COUNT = ${roomCount};`
    )
    .replace(
      /export const MAX_PLAYERS = 2;/,
      `export const MAX_PLAYERS = ${maxPlayers};`
    )
    .replace(
      /export const PARTY_AVAILABLE = false;/,
      `export const PARTY_AVAILABLE = ${partyAvailable};`
    )
    .replace(
      /export const STRUCTURE_ID = "bearcade:mygame_room";/,
      `export const STRUCTURE_ID = "bearcade:${gameId}_room";`
    )
    .replace(
      /export const PREP_SPAWN = \{ x: 0, y: 0, z: 0 \};/,
      `export const PREP_SPAWN = { x: ${prepSpawn.x}, y: ${prepSpawn.y}, z: ${prepSpawn.z} };`
    );

  // 自动生成 START_POSITIONS（环形分布，避免重叠）
  const positions = [];
  for (let i = 0; i < maxPlayers; i++) {
    const angle = (i / Math.max(maxPlayers, 1)) * Math.PI * 2;
    const x = Math.round(Math.cos(angle) * 2);
    const z = Math.round(Math.sin(angle) * 2);
    positions.push(`  { x: ${x}, y: 65, z: ${z} }`);
  }
  const startPositionsStr = `export const START_POSITIONS = [\n${positions.join(",\n")},\n];`;
  configContent = configContent.replace(
    /export const START_POSITIONS = [\s\S]*?\];/,
    startPositionsStr
  );

  await writeFile(configPath, configContent, "utf8");

  /* 全局替换：递归处理新目录下所有文本文件 */
  const globalReplacements = [
    { from: "mygame", to: gameId },
    { from: "我的小游戏", to: displayName },
    { from: "95076440-41a8-49f8-9aeb-f57f4edd0db5", to: behaviorHeaderUuid },
    { from: "606ae45a-4410-4625-adba-f1532e850615", to: behaviorModuleUuid },
    { from: "c572494e-0ae6-4dd4-84e0-68e7e9ff6f28", to: resourceHeaderUuid },
    { from: "f081d86e-be48-4e58-b198-520dd8c03ae7", to: resourceModuleUuid },
    { from: "Template-小游戏模板", to: dirName },
  ];

  async function walkAndReplace(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walkAndReplace(fullPath);
      } else {
        await replaceInFile(fullPath, globalReplacements);
      }
    }
  }
  await walkAndReplace(destPath);

  /* 修改 config/packs.json */
  const packsPath = path.join(root, "config", "packs.json");
  const packsConfig = JSON.parse(await readFile(packsPath, "utf8"));

  if (
    packsConfig.packs.some(
      (p) => p.id === gameId || p.id === `${gameId}_hud`
    )
  ) {
    console.error(`\n❌ packs.json 中已存在 id 为 ${gameId} 或 ${gameId}_hud 的包`);
    process.exit(1);
  }

  const projectVersion = packsConfig.projectVersion ?? [0, 0, 1];

  packsConfig.packs.push({
    id: gameId,
    dir: dirName,
    name: `Bearcade ${displayName}`,
    description: `Bearcade ${displayName}小游戏包(骨架阶段,玩法待定)`,
    headerUuid: behaviorHeaderUuid,
    moduleUuid: behaviorModuleUuid,
    minEngineVersion: [1, 26, 40],
    dependencies: [
      { module_name: "@minecraft/server", version: "2.10.0-beta" },
      { module_name: "@minecraft/server-ui", version: "2.2.0-beta" },
    ],
    packDependencies: ["core"],
    type: "behavior",
  });

  packsConfig.packs.push({
    id: `${gameId}_hud`,
    type: "resource",
    dir: `${dirName}/resource-pack`,
    name: `Bearcade ${displayName} HUD`,
    description: `Bearcade ${displayName}占位资源包(当前无 HUD 内容,保持一对一资源包结构)`,
    headerUuid: resourceHeaderUuid,
    moduleUuid: resourceModuleUuid,
    minEngineVersion: [1, 26, 40],
    dependencies: [],
    packDependencies: [],
  });

  await writeFile(packsPath, JSON.stringify(packsConfig, null, 2) + "\n", "utf8");

  /* 修改 tsconfig.json */
  const tsconfigPath = path.join(root, "tsconfig.json");
  const tsconfig = JSON.parse(await readFile(tsconfigPath, "utf8"));
  const newInclude = `${dirName}/src/**/*.ts`;
  if (!tsconfig.include.includes(newInclude)) {
    tsconfig.include.push(newInclude);
    tsconfig.include.sort();
    await writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2) + "\n", "utf8");
  }

  /* 完成提示 */
  console.log("\n✅ 小游戏包创建完成！");
  console.log(`   目录: ${dirName}/`);
  console.log(`   行为包 UUID: ${behaviorHeaderUuid}`);
  console.log(`   资源包 UUID: ${resourceHeaderUuid}`);
  console.log("\n📖 后续步骤：");
  console.log(`   1. npm run build`);
  console.log(`   2. npm run typecheck`);
  console.log(`   3. 部署后进游戏执行 /reload，然后 /bearcade:tmp tp ${gameId} 进入模板维度建场地`);
  console.log(`   4. 在 ${dirName}/src/game.ts 的 TODO 处实现玩法`);
  console.log(`   5. npm run typecheck && npm run build && npm run package`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => rl.close());
