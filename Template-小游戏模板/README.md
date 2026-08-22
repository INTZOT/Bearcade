# Bearcade 小游戏模板

这是一个可复制的小游戏包模板,已包含与 Core 对接的全部基础设施:

- 房间/模板维度注册(startup 阶段);
- 模板结构捕获 → 复制到各房间 → 常加载(worldLoad 后);
- `game.register` / `room.status` 上报与 5 秒心跳;
- 对局状态机(空闲 → 倒计时 → 运行 → 结算 → 重置);
- 房间保护、结束回大厅、强制中断命令;
- 开发命令进入模板维度制作场地。

房间管理通用逻辑(维度注册、模板复制、状态机、上报、命令等)统一封装在仓库 `shared/minigame-core`,由构建工具内联进本包——**不要在本包内复制第二份**;修改共享代码后重新 `npm run build` 即可让所有小游戏包同步生效。

模板横向超过 64 时无需额外处理:共享运行时按 `tileSize`(默认 64)自动分块捕获与放置。

> 进入模板维度/应用模板/强制中止命令由 **Core 统一提供**:`/bearcade:tmp tp <gamename>`、`/bearcade:tmp ap <gamename>`、`/bearcade:quit`(在对应房间维度执行)。小游戏包无需自己注册命令,共享运行时已内置对应 IPC 响应。

> 派对模式:在 `src/config.ts` 中设置 `PARTY_AVAILABLE`(去除最大人数上限后仍可正常运行才设为 true),Core 的 `/bearcade:party` 会依据该属性决定是否允许管理员带队全员加入。

> 运行时配置:实现 `MinigameHooks.openConfig` 钩子即可接入 `/bearcade:config <gamename>`(可复用 `shared/minigame-core` 的 configStore/configUi)。

开发流程:先 `/bearcade:tmp tp mygame` 进入模板维度建场地;模板范围可用 `/bearcade:tmp sz mygame` 表单配置起始点/终点;场地改好后 `/bearcade:tmp ap mygame` 一键应用到全部房间。

## 行为包定义文件(实体/物品/方块等)

需要自定义实体、物品、方块、合成配方、刷怪规则、战利品表、函数、语言文本等定义时,直接放在包目录下与 `src/` 平级的对应文件夹(`entities/`、`items/`、`blocks/`、`recipes/`、`spawn_rules/`、`loot_tables/`、`tags/`、`trading/`、`dialogue/`、`structures/`、`functions/`、`texts/`),**无需任何额外配置**——`npm run package` 与 `npm run deploy` 会自动把这些目录随包复制(目录清单见仓库 `scripts/extras.mjs`)。参考示例:BridgeWar 的自定义实体 `BridgeWar-急速战桥/entities/bearcade_loadout_dummy.json`。

> 配对资源包已内嵌在 `resource-pack/`(JSON UI HUD、贴图、模型等),不要另建第二个顶层目录;`npm run package`/`npm run deploy` 会自动拆成 `MyGame-我的游戏-资源包`。

> `docs/` 目录下的是 ScriptAPI 类型定义快照(`@minecraft/*` 的 `.d.ts`),是给脚本开发用的类型声明,与行为包 JSON 定义文件是两回事,不要混放。

## 使用步骤

### 自动创建
执行`npm run create`按照提示填写即可

### 手动创建
1. 复制 `Template-小游戏模板` 目录,重命名(如 `MyGame-我的游戏`);
2. 全局替换 `mygame` 为你的游戏 ID(小写字母/数字/下划线,如 `mygame`);
3. 修改 [src/config.ts](src/config.ts):`DISPLAY_NAME`、`ROOM_COUNT`、`MAX_PLAYERS`,并重新生成 `PACK_ID` 与 manifest UUID;
4. 在 `config/packs.json` 注册你的包(参考 template + template_hud 两条:行为包 `dir` 为游戏目录,资源包 `dir` 为 `<游戏目录>/resource-pack`),`npm run build` 生成 manifest;
5. 部署后进游戏 `/reload`,执行 `/bearcade:tmp tp mygame` 进入模板维度建场地;
6. 填写 config 里的坐标(模板范围、复制原点、准备房间、常加载区域);
7. 在 [src/game.ts](src/game.ts) 的 `TODO` 处实现你的玩法;
8. `npm run typecheck && npm run build && npm run package`,分发时连同 Core 包与 `development.md` 一起给出。

## 协议速查

- 通道:`bearcade:ipc`,信封 `{ op, packId, payload }`;
- `game.register`:游戏 ID、显示名、房间数、最大人数、准备房坐标;
- `room.status`:全量房间快照 + 5 秒心跳,状态仅 `initializing` / `idle` / `running`;
- 维度命名:`bearcade:<gamename>_n` 与 `bearcade:<gamename>_template`;
- Core 只读取 `prepSpawn` 做入房传送,场地坐标全部由小游戏包配置。

## 常见坑

- 自定义命令回调运行在 restricted execution 模式,原生调用(传送/表单)必须经 `system.run` 延迟;
- `Dimension.id` 返回完整命名空间 ID(主世界为 `minecraft:overworld`);
- 结构引擎上限 64×384×64,纵向取满为 y -64~319;
- 每包常加载 chunk 有上限,常加载区域只覆盖实际内容;
- DDUI 按钮文本不解析 `§` 颜色码,label 可以。

详细规范见仓库根目录 `development.md`。
