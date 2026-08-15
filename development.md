# Bearcade 小游戏开发规范

> 本文档是架构与开发规则的**唯一事实来源**,与 README.md 保持一致。面向所有向该服务器新增或修改小游戏的开发者。

## 1. 总体原则

- 一个目录 = 一个 mcaddon,根目录下每个子目录都是独立的包。
- 全局能力一律放在 `Core-核心`,小游戏包不重复实现全局逻辑。
- 小游戏包之间**禁止相互依赖**;需要共享能力时,统一下沉到 Core 或由 Core 提供接口。
- **共享逻辑放 `shared/minigame-core`**:维度注册、模板复制与常加载、房间状态机、Core 上报、命令、结束回大厅等通用房间逻辑统一封装在 `shared/minigame-core`(构建期内联进每个小游戏包,产物仍自包含);修改共享代码后只需 `npm run build` 重新构建,所有包同步生效,禁止在包内复制第二份。
- 单个小游戏包的故障与更新,不得影响其他小游戏包。
- 每个小游戏必须使用**容器化房间**:一个维度 = 一个游戏 = 一个房间,房间之间互不干扰。
- Core 只负责「接收上报、DDUI 展示、入房校验、传送至准备区域」,对局内的一切逻辑属于小游戏包,不得要求 Core 处理。
- **玩法与对局流程不做统一规范**:房间内部如何准备、开局、结算、设计规则,由开发者自行发挥。
- 小游戏包必须满足三条强制契约:**注册游戏信息**(§5.2)、**向 Core 发信**(§3.4)、**对局结束后将玩家传送回大厅**(§4.4)。
- 强制中止、进入模板维度、应用模板命令由 **Core 统一提供**(`/bearcade:quit <gamename>`、`/bearcade:tmp tp|ap <gamename>`),小游戏包只需响应对应 IPC 指令(已封装在 `shared/minigame-core`)。

## 2. 包目录规范

| 目录 | 包类型 | 说明 |
| --- | --- | --- |
| `Core-核心/` | 全局调控包 | 所有包的基础 |
| `Gomoku-五子棋/` | 小游戏包 | 五子棋玩法,8 个房间 |
| `GuessNBuild-建筑猜猜乐/` | 小游戏包 | 建筑猜猜乐,3~16 人,第一版可运行 |
| `BridgeWar-急速战桥/` | 小游戏包 | 急速战桥,红蓝两队核心区得分,可运行 |
| `PigCatcher-猪猪争夺战/` | 小游戏包 | 猪猪争夺战,四队驱猪进核心区,可运行 |
| `SND5-剑与消亡V/` | 小游戏包 | 剑与消亡V,骨架阶段,玩法待定 |
| `Toolkit-开发者工具/` | 工具包 | 纯工具不注册游戏:悬浮公告 /btd、物品属性编辑 /cis |

新增小游戏时,在根目录新建独立目录,命名沿用 `英文标识-中文说明` 的风格(如 `Gomoku-五子棋`)。

### 2.1 行为包定义文件(实体/物品/方块等)

- 包内需要自定义实体、物品、方块、合成配方、刷怪规则、战利品表、函数、语言文本等**行为包 JSON 定义**时,直接放在包目录下对应文件夹,与 `src/` 平级:

  | 目录 | 内容 | 说明 |
  | --- | --- | --- |
  | `entities/` | 自定义实体定义 | 示例:BridgeWar 的 `entities/bearcade_loadout_dummy.json`(装备仓库实体) |
  | `items/` | 自定义物品 | — |
  | `blocks/` | 自定义方块 | — |
  | `recipes/` | 合成配方 | — |
  | `spawn_rules/` | 生物刷怪规则 | — |
  | `loot_tables/` | 战利品表 | — |
  | `tags/` | 标签定义 | — |
  | `trading/` | 村民交易 | — |
  | `dialogue/` | 对话框 | — |
  | `structures/` | 结构文件 | — |
  | `functions/` | 函数(mcfunction) | — |
  | `texts/` | 语言文本 | — |

- **处理方式**:`npm run build` 只生成 `manifest.json` 与打包 `scripts/`,定义文件目录**原样保留在包目录内**,由 `npm run package`(产出 mcpack)与 `npm run deploy`(部署到开发包目录)自动随包复制;脚本侧统一从 `scripts/extras.mjs` 的 `EXTRA_DIRS` 读取目录清单,**新增定义类型目录时只需在该文件登记**;
- 定义文件目录与 `scripts/`、`manifest.json` 一样**随包分发**,不单独入库管理;
- 注意区分:`docs/` 目录下存放的是 **ScriptAPI 类型定义快照**(`@minecraft/*` 的 `.d.ts` 与官方文档),那是给脚本开发用的类型声明,**不是**行为包 JSON 定义文件,两者不要混放。

### 2.2 装备储存实体(队伍装备/道具配置)

用于"管理员配置某队的队服+道具,对局开局/复活时按队整体覆盖玩家物品"的模式(急速战桥、猪猪争夺战已实现):

- **实体定义**:包内 `entities/*_loadout_dummy.json`——自定义实体,`is_summonable: true`,含 41 格 `minecraft:inventory`(36 背包 + 36~40 盔甲/副手槽)。**实体 id 必须全服唯一**(每包各自定义,如 `bearcade:bridgewar_loadout_dummy` / `bearcade:pigcatcher_loadout_dummy`,勿跨包复用同一 id);
- **仓库实体**:生成在**模板维度**的固定站位(如 y=-60,按队错开),以 `nameTag` 标识队伍(如 `bearcade:pc_red_loadout`);worldLoad 初期区块可能未加载,生成需延迟重试(`ensureLoadoutEntities`);找不到时按需重建兜底;
- **存取**:`saveLoadout(team, player)` 把玩家全套物品(背包/盔甲/副手)存入仓库实体;`applyLoadout(team, player)` 先清空玩家再整体覆盖;**未配置的队伍 = 空背包**(不兜底默认道具,保证配置即真实);
- **接入**:包内 `src/loadout.ts` 实现存取(仿 `BridgeWar-急速战桥/src/loadout.ts`);`main.ts` worldLoad 时 `ensureLoadoutEntities()`;`/bearcade:config` 菜单加"XX队装备配置"(保存当前玩家装备/清空);开局与复活时按队伍 `applyLoadout`;
- 依赖 §2.1 的 `entities/` 目录自动随包打包/部署,无需额外配置。

## 3. 容器化房间规范

### 3.1 维度命名

- 统一命名空间前缀:`bearcade:`;
- 房间维度格式:`bearcade:gamename_n`;
- `gamename` 为游戏**正式英文名**,全小写;
- `n` 为房间编号,固定从 1 开始的正整数;
- 模板房间格式:`bearcade:gamename_template`。

示例:

```text
bearcade:gomoku_1
bearcade:gomoku_2
...
bearcade:gomoku_8
bearcade:gomoku_template
```

**注册要求**:

- 所有房间维度与模板维度必须在 `system.beforeEvents.startup` 中通过 `event.dimensionRegistry.registerCustomDimension(typeId)` 注册,这是 ScriptAPI 唯一允许注册自定义维度的时机;
- 注册创建的是 void 生成器空维度,不会自动生成安全出生点;
- `typeId` 必须为带命名空间的合法标识,即 `bearcade:gamename_n` / `bearcade:gamename_template`;
- 重复注册会抛 `CustomDimensionAlreadyRegisteredError`,注册逻辑必须幂等容错(捕获并记录);
- 维度注册属于 beta 脚本表面,manifest 必须依赖 beta 版 `@minecraft/server`;
- 注册完成后在 worldLoad 阶段通过 `world.getDimension(...)` 获取维度并初始化场地。

### 3.2 模板房间与场地复制

每个游戏必须注册且仅注册一个模板房间 `bearcade:gamename_template`,作为场地源。模板房间只允许用于捕获场地结构,不承载实际对局。

**结构标识符**:`bearcade:<gamename>_room`(必须包含命名空间、全服唯一;每个游戏初始化时从模板维度捕获一次,后续所有房间复用,不必重复捕获)。

**房间初始化流程**(房间创建或重置时):

1. 从模板维度捕获场地结构:`world.structureManager.createFromWorld("bearcade:<gamename>_room", 模板维度, from, to)`;
2. 将结构复制到目标房间维度的指定位置:对该结构调用 `place(房间维度, 位置)`;
3. 创建常加载区域:`world.tickingAreaManager.createTickingArea("bearcade:ta_<gamename>_<n>", { dimension: 房间维度, from, to })`,该方法为**异步**调用,必须等待 Promise 完成、区块开始加载后才可上报就绪。

**房间重置流程**:

1. 先 `removeTickingArea("bearcade:ta_<gamename>_<n>")` 移除旧常加载区域(如存在);
2. 重新 `place` 复制场地;
3. 重新 `createTickingArea`;
4. 上报 `idle`。

模板维度自身创建常加载区域 `bearcade:ta_<gamename>_template` 并保留,保证随时可读取。

- **强制要求**:进入模板维度的命令由 Core 统一提供,格式为 `/bearcade:tmp tp <gamename>`,执行后传送到 `bearcade:<gamename>_template`;应用模板到全部房间使用 `/bearcade:tmp ap <gamename>`(Core 经 IPC 路由到对应游戏包)。
- 模板范围可用 `/bearcade:tmp sz <gamename>` 在游戏内通过表单配置(起始点/终点,保存到动态属性 `bearcade:template_bounds_<gamename>`);**游戏内配置优先于 config.ts**,想恢复代码默认值需清除对应动态属性。
- **restricted execution 陷阱**:自定义命令回调运行在受限上下文,直接调用 `teleport`、`getDimension` 等原生 API 会抛 `cannot be used in restricted execution`;回调内须先用 `system.run(...)` / `runTimeout(...)` 延迟到正常上下文再执行原生调用。

**API 注意事项**:

- 房间维度通过 `world.getDimension("bearcade:gamename_n")` 获取,维度不存在时调用抛错,初始化时必须处理;
- `world.tickingAreaManager` 按包隔离:只能管理本包创建的常加载区域,不能操作其他包或命令创建的;
- 每包常加载 chunk 有上限(`maxChunkCount`),场地尺寸设计需预留余量;
- 结构引擎上限为 **64×384×64**:纵向取满时 `from.y = -64`、`to.y = 319`(320 会超限 1 格);
- **超宽模板自动分块**:横向超过 64 时,`shared/minigame-core` 会自动按 `tileSize`(默认 64)切成多块结构捕获/放置/重置(块 ID 形如 `bearcade:<gamename>_room_x0_z0`);已实测 65×384×65 会抛 `Structure size exceeds the maximum of 64x384x64`,请勿尝试单块超限;
- **模板维度必须常加载**(否则 worldLoad 时区块未加载,`createFromWorld` 捕获失败);常加载区域只覆盖实际内容(准备房间 + 场地),不要跟随结构整列 384 层,以节省每包 chunk 上限;
- 自定义维度传送前必须保证到达区域已加载:场地与常加载就绪(上报 `idle`)前禁止放玩家进入。

要求:

- 场地复制与常加载区域注册必须在房间上报 `idle` 之前完成;
- 重置期间房间状态必须为 `initializing`,禁止出现"空闲中但场地未就绪"的窗口;
- **模板复制起始点/终点、每个房间内的复制目标原点、准备房间坐标、场地尺寸与布局,全部由小游戏包开发者配置**(建议集中放在包内 `src/config.ts` 等配置文件),Core 不持有任何场地坐标;
- Core 只读取注册消息(`game.register`)中的 `prepSpawn` 用于入房传送,其余坐标一律不感知。
- **传送类坐标默认按方块中心处理**:配置中写方块坐标(如 `(0, 64, 0)`),传送时由共享运行时/Core 自动 +0.5;结构捕获与常加载区域保持方块坐标,不加 0.5。
- 准备房间与游戏场地位于**同一房间维度的不同位置**:场地由模板复制而来,准备房间位置由开发者单独配置(如 gomoku 为 `(0, 0, 0)`)。

### 3.3 房间数量与创建时机

- 房间数量由各游戏包根据自身游玩人数自行注册,Core 不负责指定;
- 游戏包在 **startup 阶段注册**全部房间维度与模板维度(`registerCustomDimension`),**worldLoad 后**再初始化场地、常加载并上报状态;
- 房间编号固定 `1 ~ roomCount`,不动态分配;
- 修改房间数量只影响本包,不涉及其他包;
- 当前配置:

| 游戏 | 房间数量 | 维度范围 |
| --- | --- | --- |
| Gomoku | 8 | `bearcade:gomoku_1` ~ `bearcade:gomoku_8` |
| GuessNBuild | 2 | `bearcade:guessnbuild_1` ~ `bearcade:guessnbuild_2` |
| BridgeWar | 4 | `bearcade:bridgewar_1` ~ `bearcade:bridgewar_4` |
| PigCatcher | 2 | `bearcade:pigcatcher_1` ~ `bearcade:pigcatcher_2` |
| SND5 | 2 | `bearcade:snd5_1` ~ `bearcade:snd5_2` |
| Template | 2 | `bearcade:mygame_1` ~ `bearcade:mygame_2` |

### 3.4 向 Core 上报状态

**状态枚举**:

| 状态 | 含义 | 可否加入 |
| --- | --- | --- |
| `initializing`(初始化中) | 房间创建或重置中,场地未就绪 | 否 |
| `idle`(空闲中) | 场地就绪,无对局 | 是 |
| `running`(运行中) | 对局进行中 | 否 |

**上报规则**:

- 状态变化时**立即**上报(创建完成、开局、结束、重置、人数增减);
- 每 **5 秒**发送一次全量心跳(`system.runInterval`),作为兜底;
- 每次上报包含全部房间的全量快照,不发送增量;
- Core 超过 **15 秒**未收到某房间的任何上报时,标记为数据过期:菜单显示不可用,拒绝入房。

上报使用 `room.status` 消息,格式见 §5.3。消息解析必须容错:解析失败、字段缺失、来源不匹配时丢弃并记录,不得崩溃。

### 3.5 隔离要求

- 房间逻辑只能操作**本房间维度**内的实体、方块与常加载区域;
- 禁止跨维度读写其他房间的状态;
- 房间重置时只清空并重建本房间场地,不影响其他房间;
- 全局/跨房间能力一律通过 Core 提供的通道进行。

## 4. Core 职责边界与入房协作

### 4.1 Core 职责

Core 只负责以下内容:

1. 接收小游戏包的注册与房间状态上报;
2. 通过 DDUI 三级菜单实时向玩家展示游戏与房间状态;
3. 校验入房请求:仅当「有效人数 < 最大游玩人数」且「房间状态 = 空闲中」时放行;
4. 放行后仅将玩家传送至对应房间维度的准备房间区域。

### 4.2 入房流程与规则

1. 玩家点击三级菜单中的房间,视为发起入房请求;
2. Core 先去重:玩家已有房间绑定则拒绝(已在房间内 / 已在其他房间);
3. Core 校验:有效人数与状态满足条件才放行;
4. 放行:Core 预留一个名额并传送玩家至 `bearcade:gamename_n` 的准备区域;
5. 传送完成后 Core 不再干预,由该小游戏包接管玩家后续流程;
6. 校验失败:拒绝并给出原因提示(提示文案由 Core 统一维护)。

并发规则:

- Core 为每个房间维护"已放行未确认"名额,校验按 `max(最近上报人数, 已放行数) < maxPlayers` 判断;
- 游戏包下一次上报到达后,以上报人数为准,重置预留数;
- 同一玩家同一时刻只处理一个入房请求,连点只生效一次。
- Core 监听 `world.afterEvents.playerDimensionChange`(事件直接提供 `Player` 对象)维护 `玩家 → 房间` 绑定,玩家回到主世界时清除。

小游戏包必须遵守:

- 准备房间区域的坐标由本包在注册消息中提供(`prepSpawn`),Core 只使用该坐标传送;
- 玩家进入准备区域后的一切逻辑(准备、开局、对局、结算)均由本包处理;
- 不得假设 Core 会处理任何房间内部逻辑。

### 4.3 大厅与菜单协作

- 主世界(overworld)是大厅维度,由 Core 管理,小游戏包不得占用大厅维度进行对局;
- 注意:当前 ScriptAPI 的 `Dimension.id` 返回**完整命名空间 ID**(如主世界为 `minecraft:overworld`),游戏包判断大厅/房间维度时必须以完整 ID 为准(`bearcade:gamename_n` 本身就是完整 ID);
- 玩家进入主世界(进服或从房间返回)时,Core 自动发放「钟」物品:放入快捷栏第 1 格,并设置 `ItemLockMode.slot` 锁定(等价于 `minecraft:item_lock` 的 `lock_in_slot`),不可移动、不可丢弃;已有钟则不重复发放;
- 玩家在大厅使用「钟」物品后,Core 展示一级主菜单:基于 `@minecraft/server-ui` 的 **CustomForm(DDUI 数据驱动 UI)**,校验失败等反馈使用 MessageBox / MessageFormData;
- 菜单路径:一级菜单 →「游戏列表」→ 二级菜单(游戏列表)→ 选择游戏 → 三级菜单(房间列表);
- 三级菜单显示每个房间的 人数 / 最大人数 / 状态:Core **每 2 秒轮询**汇总最新上报,并通过 ObservableString 等可观察对象**实时更新已打开的菜单**;不可加入的房间用按钮禁用态(`ButtonOptions.disabled`)表达;
- 菜单切换时先 `close()` 当前表单,再延迟 2 tick 打开新表单,避免 DDUI 连续显示问题(参考 Beatorini 实践);
- 二级菜单的游戏信息来自小游戏包的注册消息,Core 收到注册后立即刷新;
- 小游戏包不参与大厅菜单逻辑,只需保证注册与上报数据及时、准确。

### 4.4 对局结束与送回大厅

- 对局结束的触发时机由游戏包自行决定(胜负、超时、自定义规则);
- 对局结束时,游戏包必须将房间内**所有剩余玩家**传送回主世界**默认出生点**(`world.getDefaultSpawnLocation()`),并立即上报该房间 `idle`(如需重置,先置 `initializing`,重置完成后再报 `idle`);
- **强制兜底**:对局进行中房间人数归零时,游戏包必须立即终止对局、重置房间并上报,不得让房间停留在 `running`;
- 玩家回到主世界后,由 Core 自动补发钟物品,玩家可再次通过菜单加入房间;
- Core 不负责接送玩家回大厅,只负责玩家回到主世界后的发放与绑定清理。

**手动强制中止与重置(强制要求)**:

- 强制中止命令由 Core 统一提供,格式为 `/bearcade:quit`(无参数,执行者必须位于该游戏的房间维度,Core 自动从维度 ID 解析游戏);
- 命令行为:无论对局处于**倒计时中**还是**运行中**,执行后立即中断对局 → 将房间内玩家传送回大厅 → 从模板维度重新复制场地 → 上报 `idle`;
- 命令在非对局维度或无对局运行时返回明确失败提示,不得误伤其他房间;
- 该机制是运营与测试的兜底,不允许小游戏包省略。

Core 提供自定义命令 `/bearcade:lobby`:任意维度下传送回大厅(主世界默认出生点),小游戏包不得注册同名命令。

### 4.5 派对模式

派对模式是 Core 提供的全局开关(管理员命令 `/bearcade:party`,状态持久化)。

- **`partyAvailable`**:小游戏注册时必须上报(见 §5.2);若小游戏去除最大人数上限后依然可以正常运行,则该属性为 `true`,否则为 `false`(如 gomoku=false、guessnbuild=true);
- 派对模式开启后:
  - 普通玩家无法自行选择游戏加入,主菜单只提示"等待管理员带队加入";
  - 游戏列表只显示 `partyAvailable=true` 的小游戏;
  - 管理员点击房间后,Core 会将**全服在线玩家**一起传送进该房间,且**忽略最大人数上限**;
- 管理员判定:玩家拥有 `op` tag;
- 派对模式下房间仍必须处于 `idle` 且数据未过期,否则拒绝加入。
- 派对模式开启时,开局倒计时**固定 60 秒**且不再触发"满员压至 5 秒";Core 通过 `party.mode` IPC 把状态同步给各游戏包。
- **最少开局人数校验**:游戏注册时上报 `minPlayers`(默认 2);派对模式带队加入时,Core 要求全服在线人数 ≥ `minPlayers`,否则拒绝并提示,避免"人数不足永远无法开局"的困局。

### 4.6 运行时配置(`/bearcade:config`)

Core 提供命令 `/bearcade:config <gamename>`(管理员),经 `game.config` IPC 打开对应游戏的配置界面。

- 配置界面**只负责游戏运行时配置**,不包含最小人数/最大人数/房间数(这些由包内 `config.ts` 决定);
- 每个游戏的可配置项由开发者自行控制,通过 `MinigameHooks.openConfig` 实现(未实现时提示"该游戏未提供配置界面");
- 配置保存到动态属性 `bearcade:config_<gameid>`,持久化优先于代码默认值;界面提供"恢复默认";
- 修改 `prepSpawn` 后会自动重新向 Core 注册,入房落点即时生效;
- 当前可配置项:
  - 五子棋:准备房间坐标、棋盘位置(棋盘 Y / x-z 范围)、黑方开局坐标、白方开局坐标;
  - 建筑猜猜乐:题库管理、准备房间坐标、每回合开局传送坐标;
  - 急速战桥:准备房间坐标、红/蓝队出生点、红/蓝队核心区、获胜所需分数。
  - 急速战桥装备:红/蓝方装备配置(通过模板维度内自定义实体保存玩家全套物品,开局/复活自动覆盖)。
  - 猪猪争夺战:准备房间坐标、地图边界、猪刷新点、初始猪数/刷新数量/刷新间隔、游戏时长、核心区吸引半径/强度、四队出生点与核心区。
- **对局中禁止修改**:存在运行中/倒计时对局时,配置界面拒绝打开(共享运行时 `hasActiveGame` 守卫)。

调试命令:`/bearcade:debug <gamename|all> enable|disable`(管理员)经 `game.debug` IPC 显式开启/关闭该游戏的调试日志;`all` 时 Core 会批量下发到全部已注册游戏(共享运行时统一管理,GuessNBuild 已接入;旧 `/bearcade:gnb_debug` 已移除)。

### 4.7 返回大厅数据初始化与断线处理(强制契约)

**返回大厅强制数据初始化**:

- 玩家进入主世界的**任意路径**(对局正常结束、`/bearcade:lobby`、`/bearcade:quit` 强制中止、手动传送、断线重连),由 Core 统一执行强制数据初始化:
  1. 清空全套物品(背包/快捷栏/盔甲/副手);
  2. 恢复游戏模式为冒险(Adventure);
  3. 清除对局内设置的重生点(`setSpawnPoint(undefined)`);
  4. 还原名牌与聊天染色(`nameTag` / `chatNamePrefix` / `chatNameSuffix`);
  5. 清除全部效果(`clearEffects`);
  6. 随后重新发放钟物品。
- 游戏包自身的清理逻辑(onBeforeReset 等)保留,Core 为**最终兜底**;游戏包不得假设玩家回大厅时背包/模式/重生点未被 Core 处理。
- 玩家**进入**房间维度时,Core 自动移除大厅钟(避免占用对局背包格),返回大厅时重新发放。

**断线一律视为退出游戏(不提供热重连)**:

- 玩家断线即视为退出当前对局;游戏包状态机负责对局侧收尾(运行中人数低于最少人数、任一队伍无人等场景立即结束对局并重置);
- 玩家重连时,Core 检查其所在维度:不在主世界(断线时位于房间/模板维度)则自动传送回大厅并执行上述数据初始化;已在大厅则直接执行初始化;初始化后重新发放钟,玩家以全新状态重新选择游戏加入。

## 5. 通信协议规范

### 5.1 通道与信封

包间通信统一使用 ScriptEvent 通道:

```text
事件 ID:bearcade:ipc
信封格式:{ "op": string, "packId": string, "payload": object }
```

- `packId`:发送方 mcaddon 的 manifest header UUID,用于来源校验;
- 所有消息由发送方序列化为 JSON,接收方解析必须容错(失败丢弃并记录日志);
- `system.sendScriptEvent` 的 `id` 必须是带命名空间的合法标识(命名空间错误会抛 `NamespaceNameError`),`bearcade:ipc` 符合要求;
- 除 §5.2、§5.3 定义的操作码外,任何未知操作码一律丢弃。

### 5.2 注册消息 `game.register`

发送时机:worldLoad 后由游戏包发送一次(重复发送视为覆盖更新)。

```json
{
  "op": "game.register",
  "packId": "<游戏包 manifest header UUID>",
  "payload": {
    "game": "gomoku",
    "displayName": "五子棋",
    "roomCount": 8,
    "maxPlayers": 2,
    "minPlayers": 2,
    "partyAvailable": false,
    "prepSpawn": { "x": 0, "y": 64, "z": 0 }
  }
}
```

字段说明:

- `game`:正式英文名(全小写),与维度命名一致;
- `roomCount`:房间数量,必须 ≥ 1;
- `maxPlayers`:该游戏单房间最大游玩人数,Core 入房校验与菜单展示使用;
- `minPlayers`:该游戏开局所需最少玩家数(默认 2),派对模式带队时校验全服在线人数用;
- `partyAvailable`:派对模式可用性(去除最大人数上限后仍可正常运行则为 true,默认 false);
- `prepSpawn`:准备房间区域坐标(房间维度内),同一游戏所有房间共用;Core 仅用它传送。

Core 行为:校验通过后写入注册表,并持久化到世界动态属性 `bearcade:registry`;`packId` 与 `game` 的对应关系作为后续状态消息的校验依据。

### 5.3 状态消息 `room.status`

发送时机:状态变化时立即发送 + 每 5 秒全量心跳。

```json
{
  "op": "room.status",
  "packId": "<游戏包 manifest header UUID>",
  "payload": {
    "game": "gomoku",
    "rooms": [
      { "id": 1, "players": 0, "status": "idle" },
      { "id": 2, "players": 2, "status": "running" },
      { "id": 3, "players": 0, "status": "initializing" }
    ]
  }
}
```

字段说明:

- `rooms`:全量房间快照,每次上报必须包含所有房间;
- `id`:房间编号,与维度 `bearcade:gamename_n` 的 `n` 一致;
- `players`:当前房间人数(由游戏包统计,含准备区与对局中玩家);
- `status`:仅允许 `initializing` / `idle` / `running`;
- 最大人数不在此消息中,来自注册消息。

### 5.4 Core → 游戏包指令

由 Core 下发、游戏包响应(实现统一在 `shared/minigame-core` 的 `MinigameRuntime`,包内校验 `payload.game` 是否为本包游戏 ID):

| 操作码 | 触发命令 | 载荷 |
| --- | --- | --- |
| `game.tp` | `/bearcade:tmp tp <gamename>` | `{ game, playerId }` 传送到模板维度 |
| `game.apply` | `/bearcade:tmp ap <gamename>` | `{ game }` 应用模板到全部房间 |
| `game.sz` | `/bearcade:tmp sz <gamename>` | `{ game, playerId }` 打开模板范围配置表单 |
| `game.quit` | `/bearcade:quit`(在房间维度执行) | `{ game, dimensionId }` 强制中止指定维度对局 |
| `party.mode` | `/bearcade:party`(Core 广播) | `{ enabled }` 通知游戏包派对模式开关(游戏包侧按 §4.5 调整倒计时) |
| `game.config` | `/bearcade:config <gamename>` | `{ game, playerId }` 打开游戏运行时配置界面 |
| `game.debug` | `/bearcade:debug <gamename|all> enable|disable` | `{ game, playerId, enabled }` 显式开启/关闭该游戏调试日志(游戏名 `all` 时逐游戏下发) |

### 5.5 来源校验

- Core 只接受 `packId` 已注册且与 `game` 匹配的消息;
- `room.status` 的 `game` 必须在注册表中存在;
- 消息中出现注册表外的房间编号或非法状态值:整个消息丢弃并记录日志;
- 结合事件字段 `sourceType` 过滤:玩家 `/scriptevent`(Entity + player)、命令方块(Block)、NPC 对话(NPCDialogue)产生的消息一律丢弃,只接受脚本模块(`system.sendScriptEvent`)发来的消息;
- **游戏包侧同样校验**:共享运行时 `handleIpc` 拒绝玩家/命令方块/NPC 来源,并要求信封 `packId` 等于 Core 的 manifest header UUID(`CORE_PACK_ID`),防止伪造 `game.tp`/`game.quit`/`game.apply` 等指令;
- 玩家通过命令等方式伪造的消息因来源过滤与 packId 校验而被拒绝。

## 6. 工程与发布

- 每个包独立构建、独立发布为 `.mcaddon`,构建产物统一收集到根目录 `dist/packages/`;
- **包版本统一管理**:所有包的 manifest 版本由 `config/packs.json` 的 `projectVersion` 统一写入(当前 **Beta v0.0.1**),日常迭代不逐包升 manifest 版本,直接构建覆盖部署;正式发版时才统一提升 `projectVersion`;
- `npm run deploy` 部署到开发行为包目录(默认 Levilauncher 1.26.42.01 的全局 `Users\Shared`,可用 `MC_DEV_PACKS` 覆盖),世界重载或 `/reload` 后生效;
- 游戏包 manifest 使用包依赖(`packDependencies`)声明依赖 `Core-核心`(header UUID + 版本),保证 Core 先加载;
- 类型定义以仓库 `docs/` 为准(同步自 Beatorini 包内最新定义):当前为 `@minecraft/server` 2.10.0-beta.1.26.43-stable、`@minecraft/server-ui` 2.2.0-beta.1.26.43-stable、`@minecraft/common` 1.3.0、`@minecraft/vanilla-data` 1.26.40(对应 MC 1.26.42/1.26.43);该定义为预发布版本,启用时需匹配对应实验开关;manifest 依赖版本与 `min_engine_version` 必须与所选定义对齐;若改用稳定版,须先核对 API 差异;
- manifest 由 `scripts/build.mjs` 生成:dependencies 声明 `@minecraft/server` 2.10.0-beta 与 `@minecraft/server-ui` 2.2.0-beta,`min_engine_version` 为 [1, 26, 40];实测不包含 `capabilities` 字段也可正常加载(无需 `script_eval`);
- Core 注册表持久化到动态属性 `bearcade:registry`;房间状态、玩家房间绑定仅存内存,服务器重启后房间统一回到 `initializing`,由游戏包重新初始化并上报;
- 开发阶段所有包启用调试日志;消息解析失败、来源校验失败必须记录,不得抛出导致脚本崩溃。

## 7. 依赖规则

1. 小游戏包只能依赖 `Core-核心`,且依赖方式为 manifest 包依赖(UUID + 版本)。
2. 小游戏包之间不允许任何形式的引用、事件耦合或共享文件依赖。
3. 若两个小游戏出现"需要互相配合"的需求,先审视是否应把该能力下沉到 Core。
4. 所有跨包可见标识(动态属性键、tag、常加载区域 ID、消息操作码)统一使用 `bearcade:` 前缀;游戏包内部私有标识使用 `<gamename>_` 前缀。
5. `shared/minigame-core` 为纯工具共享层,默认面向小游戏包内联;**Core 也可复用其中的纯工具函数**(如 `playerItems.ts` 的 `clearAllPlayerItems`,构建期内联,产物仍自包含),但不得依赖其中的运行时状态。

## 8. 开发与提交要求

- 新增或修改包时,只改动自己的目录,不触碰其他包的内容。
- 提交说明中注明影响范围(所属包)。
- 每包提交前必须通过类型检查与构建,并验证 `.mcaddon` 可正常安装加载。
- 修改任何跨包契约(消息格式、维度命名、状态枚举)时,必须同步更新本文档与 README.md。
- 所有涉及 ScriptAPI 的实现必须以 `docs/` 目录的类型定义为准;升级或更换版本前先核对 API 差异。
- 包目录内的 `manifest.json` 与 `scripts/` 是构建产物,**不入库**(已加入 .gitignore);克隆后先 `npm install && npm run build` 再部署/打包。

## 9. 新游戏合并到 master 的流程

每个新游戏 = 根目录下一个独立包目录 + `config/packs.json` 一条配置,合并过程如下:

1. **开发者侧**:复制 `Template-小游戏模板` 为游戏目录(如 `MyGame-我的游戏`),全局替换 `mygame` 为游戏 ID,重新生成 `headerUuid` / `moduleUuid`(`npm run gen:uuid`),填好 `src/config.ts`,实现玩法;
2. **本地自检**:`npm run typecheck && npm run check && npm run build && npm run package`,确认自己的 `.mcpack` 可安装;
3. **提交方式**(二选一):
   - 有仓库权限:基于 master 开分支(`feat/<gameid>`),提交后发 Pull Request;
   - 无权限:把游戏目录打包发来,由管理员合入;
4. **管理员合入检查清单**:
   - Pull Request 会自动运行 `npm ci && npm run typecheck && npm run build`(GitHub Actions),通过后才合并;`.mcpack` 打包依赖 Windows PowerShell,仍在本地执行,不纳入 CI;
   - 只新增游戏目录,未改动 Core / 其他游戏;
   - `config/packs.json` 中新增条目 `packDependencies: ["core"]`,UUID 不与现有包重复;
   - 游戏 ID、结构 ID、维度名符合命名规范(`bearcade:<gameid>_n` 等);
   - tsconfig `include` 已加新包源码;
   - `npm run typecheck && npm run check && npm run build` 通过;
   - 部署到开发环境实测:入房、状态上报、结束回大厅、`/bearcade:quit` 强制中止、模板命令均正常;
5. **合入后**:管理员合并到 master,开发套件(`npm run distribute`)会自动包含新游戏。

> 构建产物(manifest/scripts)不入库;合入时不要提交它们,合并后由 `npm run build` 统一生成。

## 10. 开放项(不阻塞开发)

- 大厅保护规则(PvP、掉落物清理、大厅区域限制)暂未纳入;
- 轮询 / 心跳参数可按实际规模调整;
- 菜单样式与提示文案可统一美化;
- 房间场地布局工具与可视化预览暂未规划。

## 11. ScriptAPI 实战参考

开发中踩过的坑与解决方案(事件上下文、维度与结构、UI、状态机、安全、工具链等)统一收录在 **[docs/lessons.md](docs/lessons.md)**,规范类内容仍以本文档为准;**新增踩坑时追加到该文件对应分类**,并同步在"更新记录"登记。

## 更新记录

| 日期 | 内容 |
| --- | --- |
| 2026-08-11 | 建立初始文档:分包解耦架构、包目录与依赖规则初版 |
| 2026-08-11 | 补充容器化房间设计:维度命名、模板房间与场地复制、房间数量注册、Core 状态上报、隔离要求 |
| 2026-08-11 | 补充 Core 职责边界:接收上报、DDUI 展示、入房校验、传送准备区;明确 Core 不介入对局逻辑 |
| 2026-08-11 | 补充大厅与 DDUI 菜单:主世界即大厅、钟物品入口、三级菜单结构与点击房间即入房 |
| 2026-08-11 | 补充大厅交互细节:定时轮询刷新、回大厅自动发放并锁定钟物品、游戏包 worldLoad 时自行注册游戏信息 |
| 2026-08-11 | 明确小游戏包最低契约:玩法流程不做规范,仅强制「发信」与「对局结束送回大厅」 |
| 2026-08-11 | 补齐细节决策:三态状态机、并发预留与去重、通信协议(通道/信封/操作码)、心跳与轮询周期、钟物品锁定方案、模板复制与常加载生命周期、重启策略、版本与打包约定 |
| 2026-08-11 | 按 `docs/` 内 ScriptAPI 定义修订:版本基准 2.9.0-beta、structureManager 标识符规范、tickingAreaManager 异步/按包隔离/chunk 上限、ItemLockMode.slot、playerDimensionChange、scriptevent 来源校验、server-ui 表单 |
| 2026-08-11 | 按最新定义(2.10.0-beta / MC 1.26.43)修订:新增 DimensionRegistry.registerCustomDimension 维度注册流程(startup 阶段、void 生成器、幂等容错),DDUI 明确为 CustomForm + Observable 实时刷新,manifest 参考 Beatorini 配置 |
| 2026-08-11 | 实现 Gomoku 全流程:13×13 棋盘交互落子、回合与五连判定、胜负/平局结算、房间保护、结束送大厅并重置场地、状态机与心跳上报 |
| 2026-08-11 | Gomoku 配置调整:模板与棋盘扩为 ±7 / 15×15,棋子改为压力板(黑=磨制黑石、白=重质测重),结构按尺寸变化自动重新捕获 |
| 2026-08-11 | Gomoku 流程细化:随机黑白、棋权交接给提示与一颗棋子(落子消耗)、强制中断命令 `/bearcade:gomoku_stop` |
| 2026-08-11 | 场地重置规则明确:每次重置都删除旧结构并从模板维度重新捕获复制,模板维度是唯一场地源 |
| 2026-08-11 | 落子方式改为直接发放压力板方块并监听放置方块事件(仅合法棋步放行),before 事件内同步更新棋盘、提示与结算延迟到 system.run |
| 2026-08-11 | 棋盘层修正为 y=63,落子判定与开局站位同步调整(棋子位于 y=64) |
| 2026-08-11 | 首个小游戏 Gomoku 全流程验证通过,Core + Gomoku 系统可正常运行 |
| 2026-08-11 | 清理调试日志;新增可分发小游戏模板包(Template-小游戏模板)与 `npm run distribute` 开发套件 |
| 2026-08-11 | 开发规范新增强制要求:小游戏包必须提供手动强制中止并重置的兜底机制(规范命令 `/bearcade:<gamename>_stop`) |
| 2026-08-11 | 开发规范新增强制要求:小游戏包必须提供进入模板维度的开发命令(规范命令 `/bearcade:<gamename>`) |
| 2026-08-11 | 抽取共享运行时 `shared/minigame-core`(MinigameRuntime):Gomoku 与模板包迁移为"共享运行时 + 玩法钩子",房间通用逻辑只维护一份 |
| 2026-08-11 | 自定义命令改版:Core 统一提供 `/bearcade:tmp tp|ap <gamename>` 与 `/bearcade:quit <gamename>`,经 IPC(`game.tp`/`game.apply`/`game.quit`)路由到游戏包 |
| 2026-08-12 | Gomoku 模板范围扩一圈(±7 → ±8),棋盘仍为 ±7,结构尺寸变化自动重新捕获 |
| 2026-08-12 | 新增 `/bearcade:tmp sz <gamename>`:游戏内表单配置模板范围(动态属性持久化,游戏内配置优先) |
| 2026-08-12 | 实测确认结构上限 64×384×64(65/100 均失败);共享运行时实现超宽模板自动分块(tileSize 可配) |
| 2026-08-12 | 移除模板维度的临时常加载区域(createFromWorld 可读未加载区块),常加载仅用于房间游玩区 |
| 2026-08-12 | 新增 GuessNBuild-建筑猜猜乐 小游戏包骨架(复用 shared/minigame-core,玩法待实现) |
| 2026-08-13 | GuessNBuild 玩法落地:3~16 人回合制、建筑者/猜测者、聊天答题、300 秒时限、题库表单命令、侧边栏计分、目标分按人数;共享运行时新增 minPlayers/canBreak/resetRoom |
| 2026-08-13 | 准备阶段体验:房间内 actionbar 显示人数与开局倒计时;满最小人数进入可配置倒计时(GuessNBuild 60 秒),满员后剩余超过 5 秒压至 5 秒 |
| 2026-08-13 | Gomoku 准备倒计时改为 5 秒(2/2 满员后 5 秒开局) |
| 2026-08-13 | 修正:恢复模板维度常加载(worldLoad 捕获结构前区块必须已加载,否则 createFromWorld 失败) |
| 2026-08-13 | GuessNBuild:修复答对后回合卡死(phase 同步锁 + system.run 结算),准备倒计时改为 10 秒,新增可开关调试日志命令 `/bearcade:gnb_debug` |
| 2026-08-13 | 修复 GuessNBuild 第二回合卡死(回合开始未重置 settling 防重入标记);回合重置/结算加异常兜底;`/bearcade:quit` 改为免参数、按当前维度路由 |
| 2026-08-13 | GuessNBuild 开局倒计时:默认 60 秒,调试开启时 10 秒,关闭调试自动恢复 60 秒 |
| 2026-08-13 | 传送统一按方块中心(+0.5);GuessNBuild 每回合开始把全部玩家传送到 `(0,64,0)` 中心 |
| 2026-08-13 | 新增 GitHub Actions PR 检查(自动 typecheck + build);development.md 补新游戏合并流程 |
| 2026-08-13 | GuessNBuild 第一版验证通过(回合制/聊天答题/题库/计分/调试开关全链路可运行) |
| 2026-08-13 | 包版本统一为 Preview v0.0.1:版本号集中在 config/packs.json 的 projectVersion,构建时写入 manifest |
| 2026-08-13 | 全流程测试通过,版本阶段记为 Beta v0.0.1 |
| 2026-08-13 | 移除 SND5-剑与消亡V 目录及文档中的相关引用(该游戏不在当前职责范围) |
| 2026-08-13 | 新增派对模式:游戏注册增加 partyAvailable 属性,Core 提供 `/bearcade:party` 开关,开启后普通玩家不能自行加入、管理员带队全服加入 PartyAvailable 游戏 |
| 2026-08-13 | GuessNBuild 派对适配:回合落点按环形散开(大部队不叠方块中心),目标分支持 17 人以上(5 分) |
| 2026-08-13 | 派对模式倒计时规则:开启后固定 60 秒、禁用满员缩短;新增 `party.mode` IPC 同步游戏包 |
| 2026-08-13 | 新增 BridgeWar-急速战桥 小游戏包骨架(玩法细节待确认后实现) |
| 2026-08-13 | BridgeWar 玩法确认并实现:2~8 人/4 房/派对支持、随机平分红蓝、核心区得分、无时限、可搭拆桥、虚空复活、队伍色名与侧边栏计分 |
| 2026-08-13 | 修复包依赖缺 version 导致小游戏包不被游戏识别的问题(构建脚本统一回退到 projectVersion) |
| 2026-08-13 | 新增 `/bearcade:config <gamename>` 运行时配置系统(共享配置存储/表单组件,三游戏已接入;题库并入配置界面) |
| 2026-08-13 | `/bearcade:debug <gamename|all> enable|disable` 显式开关调试日志,支持 all 批量控制全部游戏 |
| 2026-08-13 | 急速战桥新增红/蓝装备配置:自定义实体持久化玩家全套物品,每回合开始/复活时覆盖 |
| 2026-08-13 | 急速战桥:死亡在己方基地复活(设置出生点,不回大厅),虚空返回回满血,去除复活等待 |
| 2026-08-13 | 急速战桥玩家名字按队伍染色:头顶名牌用 Entity.nameTag,聊天名字用 chatNamePrefix/Suffix |
| 2026-08-13 | 急速战桥保护细化:仅可放置红/蓝羊毛,核心区与出生点周边禁止放置 |
| 2026-08-13 | 急速战桥简化保护:红/蓝羊毛可直接破坏,移除玩家放置位置记录 |
| 2026-08-13 | 急速战桥:回合间隙禁止玩家伤害;新增地图边界配置,放置/破坏羊毛仅限边界内 |
| 2026-08-13 | 急速战桥:回合间隙禁止得分(roundActive 门槛,已有逻辑显式标注) |
| 2026-08-13 | 急速战桥出生点保护范围由 ±2 收窄为 ±1 |
| 2026-08-13 | 急速战桥对局内改用生存模式(放置由脚本保护),回合结束回大厅恢复冒险 |
| 2026-08-13 | 急速战桥新增保护:进入己方核心区传送回出生点 |
| 2026-08-13 | 急速战桥结束游戏时清空玩家全部物品后返回大厅 |
| 2026-08-13 | 急速战桥掉虚空改为直接击杀,移除显式回满血机制 |
| 2026-08-13 | 开局倒计时逻辑下沉共享运行时:普通 60 秒/满员压 5 秒/调试模式可配(战桥 5 秒,猜猜乐保持 10 秒),切换调试实时刷新 |
| 2026-08-13 | 开局倒计时全游戏统一:普通 60 秒、满员压 5 秒、调试模式 10 秒(默认值下沉共享运行时) |
| 2026-08-13 | 修复准备倒计时被上报为 running 导致其他玩家无法加入的问题(pending 视为 idle,所有游戏包生效) |
| 2026-08-14 | 新增 SND5-剑与消亡V 小游戏包骨架(复制模板,复用 shared/minigame-core,玩法待定) |
| 2026-08-14 | 新增 PigCatcher-猪猪争夺战(四队驱猪进核心区,钓鱼竿/胡萝卜钓竿/拴绳交互,计时结算,可运行)与 Toolkit-开发者工具(悬浮公告 /btd、手持物品属性编辑 /cis) |
| 2026-08-15 | IPC 来源校验收紧:Core 与游戏包均拒绝玩家/命令方块/NPC 来源,游戏包另校验信封 packId 必须为 Core 的 UUID;模板捕获/放置改为串行队列,杜绝并发重置竞态;`/bearcade:tmp ap` 拒绝在运行中/倒计时房间执行;PigCatcher 鱼钩解拴状态按房间隔离;共享 `clearAllPlayerItems` 统一两包结束清物品(含盔甲/副手);GuessNBuild 建造/落点边界改读运行时模板范围;模板范围表单校验 y 与常加载区相交;配置界面增加对局中禁改守卫;Gomoku 背包满时自动腾格发棋子;派对模式带队校验全服在线人数 ≥ minPlayers |
| 2026-08-15 | 工程改进:watch 监听补全新包与 shared/;打包改用跨平台 archiver(替代 Windows PowerShell);deploy 必须显式设置 MC_DEV_PACKS;distribute 保留 projectVersion/phase;新增 `npm run check` 校验 packId 一致性(已接入 CI);清理各包 config.ts 未用维度函数;修正 packs.json/README/本文档中的过时描述 |
| 2026-08-15 | 新增契约:返回大厅强制数据初始化(任意路径回到主世界,Core 统一清空全套物品/恢复冒险模式/清除重生点/名牌染色/效果并补发钟;进入房间维度自动移除大厅钟);断线一律视为退出游戏,重连自动传送回大厅并初始化,不提供热重连 |
| 2026-08-15 | 行为包定义文件处理规范:实体/物品/方块等 JSON 定义放包目录对应文件夹,打包与部署自动包含;目录清单抽到 `scripts/extras.mjs` 统一登记(新增 items/blocks/recipes/spawn_rules/loot_tables/tags/trading/dialogue 等);模板 README 与本文档 §2.1 补充说明 |
| 2026-08-15 | 猪猪争夺战道具/装备改为实体储存(与战桥一致):四队独立仓库实体(`bearcade:pigcatcher_loadout_dummy` + nameTag 分队),`/bearcade:config` 新增"XX队装备配置"(保存/清空),开局/复活按队 `applyLoadout` 覆盖全套物品;移除默认三件套兜底(未配置即空背包);development.md 新增 §2.2 装备储存实体规范 |
| 2026-08-15 | 猪猪争夺战鱼钩解拴改用事件驱动:实测 `entityHitEntity` 对鱼钩勾中不派发,`entityHurt(before)` 在 0 伤害投射命中时可靠触发(damage=0、cause=projectile、damagingEntity=投掷者玩家);解拴逻辑移入 `entityHurt` 猪分支,抢在无敌 cancel 前经 `system.run` 延迟 unleash,邻近鱼钩实体二次确认防误解拴;删除 `entityHitEntity` 死代码,轮询保留作"先勾后拴"兜底;debug 模式放宽维度检查便于大厅测试;`deploy.mjs` 恢复本机默认部署路径(MC_DEV_PACKS 可覆盖);新增 §11 ScriptAPI 实战参考 |
| 2026-08-15 | 新建 `docs/lessons.md` 实战参考:汇总开发踩坑与解决(事件上下文/维度结构/UI/状态机/安全/工具链/调试技巧),§11 改为指向该文件 |
