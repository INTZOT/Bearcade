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
  "features",
  "feature_rules",
  "biomes",
  "Cameras",
  "shapes",
  "item_catalog",
];

// 资源包文件目录清单:源码内嵌在 <游戏>/resource-pack,构建/部署时拆分为 <游戏>-资源包 并随包复制这些目录。
// 自定义物品/方块/实体时,行为包定义放 items/blocks/entities,
// 对应的客户端定义与贴图/模型放下面这些资源包目录。
export const RESOURCE_DIRS = [
  "ui",
  "textures",
  "texts",
  "items",
  "blocks",
  "entity",
  "models",
  "animations",
  "animation_controllers",
  "render_controllers",
  "attachables",
  "particles",
  "sounds",
  "materials",
  "font",
];

// 资源包根目录级文件:自定义方块/音效/客户端生物群系等会用到
export const RESOURCE_ROOT_FILES = [
  "blocks.json",
  "sounds.json",
  "biomes_client.json",
  "contents.json",
];
