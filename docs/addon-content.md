# Bearcade 自定义物品 / 方块 / 实体开发规范

> 本文档面向未来在 Bearcade 小游戏包中引入 addon 自定义内容(物品、方块、实体)的开发。
> 与 `development.md` 的关系:本文只讲“内容定义文件怎么放、怎么写、怎么与现有工具链配合”;
> 维度/房间/状态机/打包发布等总规范仍以 `development.md` 为唯一事实来源。

## 1. 总原则

1. **一对一分包**:每个小游戏一个顶层目录 `Xxx-中文名/`;行为包文件放在该目录根,资源包文件放在该目录的 `resource-pack/` 子目录。构建/部署时自动拆分为同名 `Xxx-中文名-资源包`。
   - 行为包负责“数据/逻辑定义”:`items/`、`blocks/`、`entities/` 等;
   - 资源包负责“客户端表现”:贴图、模型、动画、client entity、物品图标、UI 等。
   - 不新建全局共享资源包;单独分发某个小游戏时,必须连同其配对资源包一起分发。
2. **命名空间统一 `bearcade:`**:自定义标识符一律 `bearcade:<gameid>_<name>`,全小写,只使用 `a-z0-9_`(必要时 `.` `-`,但项目默认不用)。
   - 物品:`bearcade:bridgewar_grapple`
   - 方块:`bearcade:collapse_trap_block`
   - 实体:`bearcade:pigcatcher_pig_king`
   - 结构、tag、动画、几何名称同样带 `bearcade:` 或 `geometry.bearcade_*`。
3. **标识符全服唯一**:小游戏之间禁止复用同一物品/方块/实体 ID;复制模板后先全局替换 `mygame`,再重新生成 header/module UUID(`npm run gen:uuid`)。
4. **定义文件自包含在包目录内**:源文件放包目录对应文件夹,不依赖其他游戏包文件;跨包共享只能下沉 `shared/`(纯 TS 逻辑)或由 Core 提供接口。
5. **JSON 必须过校验**:`npm run typecheck/check/build` 不校验内容 JSON 的业务正确性,提交前单独 `json5`/`json.load` 校验,并在游戏内 `/contentlog` 检查加载错误。
6. **版本匹配**:`format_version` 与当前引擎 1.26.42/1.26.43 及实验开关匹配;优先参考仓库 `docs/bedrock-creator-docs.md` 中当前版本的自定义内容示例,而不是网络旧教程。

## 2. 目录与自动分发对照

### 2.1 行为包侧(放入小游戏行为包目录)

| 目录 | 内容 | 说明 |
| --- | --- | --- |
| `items/` | `*.json` 物品定义 | 自定义物品数据与组件 |
| `blocks/` | `*.json` / `*.block.json` 方块定义 | 按当前引擎示例选择命名 |
| `entities/` | `*.json` 实体定义 | 行为组件、掉落、属性 |
| `recipes/` | 配方 | 如需合成/烧炼 |
| `loot_tables/` | 战利品表 | 方块掉落、实体掉落 |
| `spawn_rules/` | 刷怪规则 | 自然生成 |
| `trading/` | 交易 | 村民交易 |
| `dialogue/` | NPC 对话 | — |
| `structures/` | 结构 | — |
| `functions/` | mcfunction | — |
| `texts/` | 语言文件 | 行为包侧语言键 |
| `features/` `feature_rules/` `biomes/` | 世界生成 | 未来地形/结构生成用 |
| `Cameras/` | 相机预设 | 注意大小写 |

这些目录已登记在 `scripts/extras.mjs` 的 `EXTRA_DIRS`,由 `npm run package`/`npm run deploy` 自动复制,新增目录类型时先登记。

### 2.2 资源包侧(放入 `<游戏>/resource-pack/` 目录)

| 目录/文件 | 内容 | 说明 |
| --- | --- | --- |
| `ui/` | JSON UI | HUD、屏幕 |
| `items/` | `*.json` client item 定义 | 物品图标、使用动画 |
| `entity/` | `*.entity.json` client entity | 实体外观定义 |
| `models/entity/` | `*.geo.json` | 实体/方块几何 |
| `textures/` | `*.png`、`item_texture.json`、`terrain_texture.json` 等 | 贴图与图集 |
| `texts/` | `*.lang` | 名称本地化 |
| `animations/` | `*.animation.json` | 动画 |
| `animation_controllers/` | `*.animation_controllers.json` | 动画控制器 |
| `render_controllers/` | `*.render_controllers.json` | 渲染控制器 |
| `attachables/` | 附着物 | 装备外观等 |
| `particles/` | 粒子 | — |
| `sounds/` + 根 `sounds.json` | 音效 | — |
| 根 `blocks.json` | 方块声音/纹理映射 | 自定义方块必须 |
| 根 `biomes_client.json` | 客户端生物群系(弃用中) | 按需 |

这些已登记在 `scripts/extras.mjs` 的 `RESOURCE_DIRS` / `RESOURCE_ROOT_FILES`,自动随配对资源包复制。

## 3. 自定义物品

### 3.1 行为包 `items/<name>.json` 最小示例

```json
{
  "format_version": "1.21.90",
  "minecraft:item": {
    "description": {
      "identifier": "bearcade:mygame_example_item",
      "menu_category": {
        "category": "items",
        "group": "minecraft:itemGroup.name.miscFood"
      }
    },
    "components": {
      "minecraft:icon": "bearcade_mygame_example_item",
      "minecraft:display_name": { "value": "示例物品" },
      "minecraft:max_stack_size": 64,
      "minecraft:hand_equipped": false
    }
  }
}
```

常用组件:食物 `minecraft:food`、耐久 `minecraft:durability`、穿戴 `minecraft:wearable`、附魔 `minecraft:enchantable`、投掷 `minecraft:throwable`、放置方块 `minecraft:block_placer`、冷却 `minecraft:cooldown`、使用时长 `minecraft:use_modifiers`。以 `docs/bedrock-creator-docs.md` 当前示例为准。

### 3.2 资源包 `resource-pack/items/<name>.json`

```json
{
  "format_version": "1.10",
  "minecraft:item": {
    "description": {
      "identifier": "bearcade:mygame_example_item"
    },
    "components": {
      "minecraft:icon": "bearcade_mygame_example_item",
      "minecraft:use_animation": "eat"
    }
  }
}
```

图标必须在资源包 `textures/item_texture.json` 登记:

```json
{
  "resource_pack_name": "bearcade_mygame",
  "texture_name": "atlas.items",
  "texture_data": {
    "bearcade_mygame_example_item": {
      "textures": "textures/items/example_item"
    }
  }
}
```

贴图放 `textures/items/example_item.png`。

### 3.3 脚本侧注意事项

- `ItemStack` 可以用字符串 ID 构造:`new ItemStack("bearcade:mygame_example_item", 1)`;类型定义若只收 `VanillaEntityIdentifier`,按现有 `loadout.ts` 模式 `as VanillaEntityIdentifier` 断言。
- 自定义物品可被现有装备仓库实体正常保存/发放;`clearAllPlayerItems` 按槽位清空,与物品类型无关。
- 自定义物品必须 BP + RP 同时启用,否则手里是“未知物品/黑紫块”。
- 如需让方块物品可用,优先使用 `minecraft:block_placer` 指向方块 ID,避免单独维护 place 逻辑。

## 4. 自定义方块

### 4.1 行为包 `blocks/<name>.json`

最小可用示例(具体 `format_version` 以当前引擎示例为准):

```json
{
  "format_version": "1.21.80",
  "minecraft:block": {
    "description": {
      "identifier": "bearcade:mygame_example_block",
      "menu_category": {
        "category": "construction",
        "group": "minecraft:itemGroup.name.construction"
      }
    },
    "components": {
      "minecraft:geometry": "minecraft:geometry.full_block",
      "minecraft:material_instances": {
        "*": {
          "texture": "bearcade_mygame_example_block",
          "render_method": "opaque"
        }
      },
      "minecraft:destructible_by_mining": { "seconds_to_destroy": 1.0 },
      "minecraft:destructible_by_explosion": { "explosion_resistance": 3.0 },
      "minecraft:map_color": "#7a7a7a",
      "minecraft:loot": "loot_tables/blocks/example_block.json"
    }
  }
}
```

需要自定义几何时,将 `minecraft:geometry` 指向资源包 `models/` 中的 geometry,并给每个面/`*` 配置 `material_instances`。

### 4.2 资源包侧(`resource-pack/`)

- 贴图:`textures/blocks/example_block.png`。
- 纹理名:`textures/terrain_texture.json` 中 `"bearcade_mygame_example_block": { "textures": "textures/blocks/example_block" }`。
- 方块映射:根目录 `blocks.json` 注册 `"bearcade:mygame_example_block": { "textures": "...", "sound": "stone" }`。
- 自定义几何:`models/block/*.geo.json`(若引擎要求 models/ 内对应路径),并保证 geometry 名称与 BP 中一致。

### 4.3 与容器化房间/模板的配合

- 模板维度中的自定义方块会被 `structureManager.createFromWorld/place` 按 ID 正常保存/复制;BP+RP 加载顺序与 ID 唯一即可。
- 房间放置校验 (`canPlace/canBreak`) 通过 `event.block.typeId` 字符串比较,可直接判断 `bearcade:*` ID。
- 方块破坏/放置事件对自定义方块同样触发;不要假设只有原版方块。

## 5. 自定义实体

### 5.1 行为包 `entities/<name>.json`

建议以当前原版实体为基线。最小骨架:

```json
{
  "format_version": "1.26.0",
  "minecraft:entity": {
    "description": {
      "identifier": "bearcade:mygame_example_entity",
      "is_summonable": true,
      "is_spawnable": false,
      "is_experimental": false
    },
    "components": {
      "minecraft:type_family": { "family": ["bearcade", "mygame_example"] },
      "minecraft:health": { "value": 20, "max": 20 },
      "minecraft:collision_box": { "width": 0.6, "height": 0.9 },
      "minecraft:physics": {},
      "minecraft:pushable": { "is_pushable": true, "is_pushable_by_piston": true },
      "minecraft:persistent": {},
      "minecraft:nameable": {}
    }
  }
}
```

- 装备仓库实体模式仍可复用:`is_summonable: true`、`minecraft:inventory`(41 格)+ 模板维度固定站位;如果只是隐形仓库,可不提供 RP client entity,但**可见实体必须提供**。
- `dimension.spawnEntity("bearcade:mygame_example_entity", location)` 在 TS 类型上同样按 `as VanillaEntityIdentifier` 处理;生成失败优先检查区块是否已加载(常加载区)与 `is_summonable`。
- 实体 ID 必须全服唯一;不要把 `bearcade:loadout_dummy` 一类 ID 复用到其他游戏。

### 5.2 资源包侧(`resource-pack/`)

- `entity/bearcade:mygame_example_entity.entity.json`(实际文件名按引擎约定,去掉 `:` 的实体名;参考原版 `entity/squid.entity.json`)。
- `models/entity/example_entity.geo.json`。
- `textures/entity/example_entity.png`。
- `render_controllers/example_entity.render_controllers.json`。
- 需要动画时:`animations/*.animation.json` + `animation_controllers/*.animation_controllers.json`,client entity 中声明 `scripts.animate`。

### 5.3 与现有运行时的配合

- 房间清理函数 `clearFieldEntities` 按 `entity.typeId !== "minecraft:player"` 移除全部非玩家实体;自定义实体必须自建自己的清理/登记逻辑,并放入游戏钩子的 `onBeforeReset`。
- PigCatcher/BridgeWar 的 `getEntities({ type })` 同样支持自定义实体 ID。
- 自定义实体若参与对局,状态机 tick 中必须判空/`isValid`,参考现有 `pigsInRoom` 的 try/catch。

## 6. 语言与本地化

- 名称优先用资源包 `texts/zh_CN.lang` / `en_US.lang`:`item.bearcade_mygame_example_item=示例物品`;若只做快速原型,BP `minecraft:display_name.value` 直接写文本。
- 行为包与资源包同名 `texts/` 会分别随包复制;命名键统一 `item.` / `tile.` / `entity.` 前缀,并带 `bearcade_` 前缀避免覆盖原版键。

## 7. 工程流程与检查清单

新增自定义内容时:

1. 在行为包创建 `items/` / `blocks/` / `entities/` 对应 JSON;
2. 在 `resource-pack/` 创建 client 定义、贴图/模型/图集/`blocks.json`;
3. 在 `config/packs.json` 确认行为包条目与资源包条目正确:行为包 `dir` 为游戏目录,资源包 `dir` 为 `<游戏>/resource-pack`,ID 分别为 `<gameid>` / `<gameid>_hud`;
4. `npm run typecheck && npm run check && npm run build && npm run package`;
5. `npm run deploy <gameid>`(会自动部署配对资源包到 `development_resource_packs`);
6. 世界同时启用两个包,`/reload`;资源包内容/UI/模型改动建议**完整重启重进世界**;
7. `/contentlog` 逐条清理:未知物品/方块、缺失贴图、client entity 缺失、几何/渲染控制器引用错误;
8. 在小游戏房间内验证:物品可获取/消耗、方块可放置/破坏且受 `canPlace/canBreak` 约束、实体可生成/清除/不跨房间残留。

## 8. 故障排查速查

| 现象 | 常见原因 |
| --- | --- |
| 物品显示黑紫块 | RP 未启用、`minecraft:icon` 名与 `item_texture.json` 不一致、贴图路径错误 |
| `/give` 未知物品 | BP item JSON 未加载、ID 拼写/命名空间错误、manifest 未声明依赖 |
| 方块透明/紫黑 | `terrain_texture.json` 或 `blocks.json` 缺失/名称不匹配 |
| 自定义实体是隐形/Steve | 缺少 `entity/*.entity.json`、geometry/render_controller 引用错误 |
| spawnEntity 抛 LocationInUnloadedChunkError | 目标区块未加载;先确保模板/房间常加载区就绪再生成 |
| 结构复制后自定义方块消失 | 客户端 RP 未启用,或 BP 未部署;结构 ID 与方块 ID 均需唯一 |
| 多游戏同时启用冲突 | 违反唯一 ID/跨包复用规则;物品/方块/实体 ID 必须按游戏前缀隔离 |

> 遇到新坑时,按 `docs/lessons.md` 的格式追加“现象 → 原因 → 解决”,并把规范更新到本文档。
