// 行为包定义文件目录清单:打包(package.mjs)与部署(deploy.mjs)时随包复制。
// 各小游戏包把自定义实体/物品/方块等 JSON 定义放在包目录下对应文件夹,
// 新增定义类型目录时在此登记,两个脚本同步生效(构建 build.mjs 只处理 scripts/ 与 manifest)。
export const EXTRA_DIRS = [
  "entities",
  "items",
  "blocks",
  "recipes",
  "spawn_rules",
  "loot_tables",
  "tags",
  "trading",
  "dialogue",
  "structures",
  "functions",
  "texts",
];
