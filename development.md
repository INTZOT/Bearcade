# Bearcade 小游戏开发规范

> 本文档是架构与开发规则的**唯一事实来源**,与 README.md 保持一致。面向所有向该服务器新增或修改小游戏的开发者。

## 1. 总体原则

- 一个目录 = 一个 mcaddon,根目录下每个子目录都是独立的包。
- 全局能力一律放在 `Core-核心`,小游戏包不重复实现全局逻辑。
- 小游戏包之间**禁止相互依赖**;需要共享能力时,统一下沉到 Core 或由 Core 提供接口。
- 单个小游戏包的故障与更新,不得影响其他小游戏包。
- 每个小游戏必须使用**容器化房间**:一个维度 = 一个游戏 = 一个房间,房间之间互不干扰。
- Core 只负责「接收上报、DDUI 展示、入房校验、传送至准备区域」,对局内的一切逻辑属于小游戏包,不得要求 Core 处理。
- **玩法与对局流程不做统一规范**:房间内部如何准备、开局、结算、设计规则,由开发者自行发挥。
- 小游戏包必须满足三条强制契约:**注册游戏信息**(§5.2)、**向 Core 发信**(§3.4)、**对局结束后将玩家传送回大厅**(§4.4)。

## 2. 包目录规范

| 目录 | 包类型 | 说明 |
| --- | --- | --- |
| `Core-核心/` | 全局调控包 | 所有包的基础 |
| `Gomoku-五子棋/` | 小游戏包 | 五子棋玩法,8 个房间 |
| `SND5-剑与消亡V/` | 小游戏包 | 剑与消亡 V 玩法,2 个房间 |

新增小游戏时,在根目录新建独立目录,命名沿用 `英文标识-中文说明` 的风格(如 `Gomoku-五子棋`)。

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

- 开发期建议注册一个自定义命令进入模板维度制作场地(示例:gomoku 包提供 `/bearcade:gomoku`,传送至 `bearcade:gomoku_template`)。
- **restricted execution 陷阱**:自定义命令回调运行在受限上下文,直接调用 `teleport`、`getDimension` 等原生 API 会抛 `cannot be used in restricted execution`;回调内须先用 `system.run(...)` / `runTimeout(...)` 延迟到正常上下文再执行原生调用。

**API 注意事项**:

- 房间维度通过 `world.getDimension("bearcade:gamename_n")` 获取,维度不存在时调用抛错,初始化时必须处理;
- `world.tickingAreaManager` 按包隔离:只能管理本包创建的常加载区域,不能操作其他包或命令创建的;
- 每包常加载 chunk 有上限(`maxChunkCount`),场地尺寸设计需预留余量;
- 结构引擎上限为 **64×384×64**:纵向取满时 `from.y = -64`、`to.y = 319`(320 会超限 1 格);
- 常加载区域建议只覆盖实际内容(准备房间 + 场地),不要跟随结构整列 384 层,以节省每包 chunk 上限;
- 自定义维度传送前必须保证到达区域已加载:场地与常加载就绪(上报 `idle`)前禁止放玩家进入。

要求:

- 场地复制与常加载区域注册必须在房间上报 `idle` 之前完成;
- 重置期间房间状态必须为 `initializing`,禁止出现"空闲中但场地未就绪"的窗口;
- **模板复制起始点/终点、每个房间内的复制目标原点、准备房间坐标、场地尺寸与布局,全部由小游戏包开发者配置**(建议集中放在包内 `src/config.ts` 等配置文件),Core 不持有任何场地坐标;
- Core 只读取注册消息(`game.register`)中的 `prepSpawn` 用于入房传送,其余坐标一律不感知。
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
| SND5 | 2 | `bearcade:snd5_1` ~ `bearcade:snd5_2` |

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

Core 提供自定义命令 `/bearcade:lobby`:任意维度下传送回大厅(主世界默认出生点),小游戏包不得注册同名命令。

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
    "prepSpawn": { "x": 0, "y": 64, "z": 0 }
  }
}
```

字段说明:

- `game`:正式英文名(全小写),与维度命名一致;
- `roomCount`:房间数量,必须 ≥ 1;
- `maxPlayers`:该游戏单房间最大游玩人数,Core 入房校验与菜单展示使用;
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

### 5.4 来源校验

- Core 只接受 `packId` 已注册且与 `game` 匹配的消息;
- `room.status` 的 `game` 必须在注册表中存在;
- 消息中出现注册表外的房间编号或非法状态值:整个消息丢弃并记录日志;
- 结合事件字段 `sourceType` / `sourceEntity` 辅助过滤:直接由玩家执行 `/scriptevent` 产生的消息(`sourceType` 为 Entity 且来源为玩家)一律丢弃;
- 玩家通过命令等方式伪造的消息因缺少合法 `packId` / 注册匹配而被拒绝。

## 6. 工程与发布

- 每个包独立构建、独立发布为 `.mcaddon`,构建产物统一收集到根目录 `dist/packages/`;
- `npm run deploy` 部署到开发行为包目录(默认 Levilauncher 1.26.42.01,可用 `MC_DEV_PACKS` 覆盖),世界重载或 `/reload` 后生效;
- 游戏包 manifest 使用包依赖(`packDependencies`)声明依赖 `Core-核心`(header UUID + 版本),保证 Core 先加载;
- 类型定义以仓库 `docs/` 为准(同步自 Beatorini 包内最新定义):当前为 `@minecraft/server` 2.10.0-beta.1.26.43-stable、`@minecraft/server-ui` 2.2.0-beta.1.26.43-stable、`@minecraft/common` 1.3.0、`@minecraft/vanilla-data` 1.26.40(对应 MC 1.26.42/1.26.43);该定义为预发布版本,启用时需匹配对应实验开关;manifest 依赖版本与 `min_engine_version` 必须与所选定义对齐;若改用稳定版,须先核对 API 差异;
- manifest 参考 Beatorini 实际配置:dependencies 声明 `@minecraft/server` 2.10.0-beta 与 `@minecraft/server-ui` 2.2.0-beta,`min_engine_version` 为 [1, 26, 40],capabilities 含 `script_eval`;
- Core 注册表持久化到动态属性 `bearcade:registry`;房间状态、玩家房间绑定仅存内存,服务器重启后房间统一回到 `initializing`,由游戏包重新初始化并上报;
- 开发阶段所有包启用调试日志;消息解析失败、来源校验失败必须记录,不得抛出导致脚本崩溃。

## 7. 依赖规则

1. 小游戏包只能依赖 `Core-核心`,且依赖方式为 manifest 包依赖(UUID + 版本)。
2. 小游戏包之间不允许任何形式的引用、事件耦合或共享文件依赖。
3. 若两个小游戏出现"需要互相配合"的需求,先审视是否应把该能力下沉到 Core。
4. 所有跨包可见标识(动态属性键、tag、常加载区域 ID、消息操作码)统一使用 `bearcade:` 前缀;游戏包内部私有标识使用 `<gamename>_` 前缀。

## 8. 开发与提交要求

- 新增或修改包时,只改动自己的目录,不触碰其他包的内容。
- 提交说明中注明影响范围(所属包)。
- 每包提交前必须通过类型检查与构建,并验证 `.mcaddon` 可正常安装加载。
- 修改任何跨包契约(消息格式、维度命名、状态枚举)时,必须同步更新本文档与 README.md。
- 所有涉及 ScriptAPI 的实现必须以 `docs/` 目录的类型定义为准;升级或更换版本前先核对 API 差异。

## 9. 开放项(不阻塞开发)

- 大厅保护规则(PvP、掉落物清理、大厅区域限制)暂未纳入;
- 轮询 / 心跳参数可按实际规模调整;
- 菜单样式与提示文案可统一美化;
- 房间场地布局工具与可视化预览暂未规划。

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
