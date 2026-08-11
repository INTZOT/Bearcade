# Bearcade 基岩版小游戏服务器

## 项目简介

基于 Minecraft 基岩版的多人小游戏服务器,采用**分包解耦 + 容器化房间**架构:

- **分包解耦**:根目录下每个目录对应一个独立的 mcaddon;`Core-核心` 负责全局调控,其余小游戏包互不依赖、互不影响。
- **容器化房间**:利用 ScriptAPI 自定义维度,实现"一个维度 = 一个游戏 = 一个房间",游戏实例之间完全隔离。

## 目录结构

```text
Bearcade/
├── Core-核心/        # 全局调控包(核心底座)
├── Gomoku-五子棋/    # 五子棋小游戏包
├── SND5-剑与消亡V/   # 剑与消亡 V 小游戏包
├── README.md         # 架构介绍(本文档)
└── development.md    # 小游戏开发规范(唯一事实来源)
```

## 架构原则

1. **一目录一包**:根目录下每个目录最终构建为一个独立的 mcaddon。
2. **全局能力归 Core**:跨小游戏共享的逻辑、全局状态与调控能力统一放在 `Core-核心` 中。
3. **小游戏间解耦**:除依赖 Core 外,各小游戏包不允许互相引用;单个小游戏出问题不应影响其他小游戏。
4. **单维度单房间**:每个游戏房间拥有独立的自定义维度,维度内的实体、区块、常加载区域与玩法状态互不干扰。
5. **独立演进**:各包可单独开发、打包、发布和回滚。
6. **Core 职责收敛**:Core 只负责全局调控(接收上报、展示状态、入房校验与传送),不介入任何对局逻辑。

## 容器化房间设计

### 维度命名规范

- 所有游戏房间维度统一使用命名空间前缀 `bearcade:`;
- 房间维度格式:`bearcade:gamename_n`;
- `gamename` 为游戏正式英文名,全小写;
- `n` 为房间编号,固定从 1 开始的正整数(`1 ~ roomCount`);
- 模板房间格式:`bearcade:gamename_template`。

示例:

```text
bearcade:gomoku_1 ~ bearcade:gomoku_8   # 五子棋 8 个房间
bearcade:snd5_1  ~ bearcade:snd5_2      # 剑与消亡 V 2 个房间
```

### 维度注册

所有房间维度与模板维度必须在 **startup 阶段**注册,这是 ScriptAPI 唯一允许注册自定义维度的时机:

```text
system.beforeEvents.startup → event.dimensionRegistry.registerCustomDimension(typeId)
```

- 注册会创建 **void 生成器**的空维度,不会自动生成安全出生点;
- `typeId` 必须使用带命名空间的合法标识(如 `bearcade:gomoku_1`);
- 重复注册会抛 `CustomDimensionAlreadyRegisteredError`,注册逻辑必须幂等容错;
- 维度注册属于 beta 脚本表面,manifest 需依赖 beta 版 `@minecraft/server`(见「工程与发布」);
- 注册完成后,在 worldLoad 阶段通过 `world.getDimension("bearcade:gamename_n")` 获取维度并初始化场地。

参考实现:Beatorini 在 startup 中循环注册 `namespace:void_1 ~ void_n` 的自定义维度。

### 模板房间与场地复制

每个游戏必须注册且仅注册一个模板房间 `bearcade:gamename_template`,作为**场地源**,不承载实际对局。

初始化或重置房间时的标准流程:

1. 从模板维度捕获场地结构:`world.structureManager.createFromWorld("bearcade:<gamename>_room", 模板维度, from, to)` —— 结构标识符必须包含命名空间且全服唯一,每个游戏只捕获一次,所有房间复用;
2. 将结构复制到目标房间维度的指定位置:对该结构调用 `place(房间维度, 位置)`;
3. 为该房间创建常加载区域:`world.tickingAreaManager.createTickingArea("bearcade:ta_<gamename>_<n>", { dimension, from, to })` —— 该调用是**异步**的,必须等 Promise 完成、区块真正开始加载后才算就绪。

重置流程:先 `removeTickingArea` 移除旧常加载区域 → 重新复制场地 → 重新创建常加载区域。

API 注意事项:

- 房间维度通过 `world.getDimension("bearcade:gamename_n")` 获取,维度不存在时调用会抛错,游戏包必须在初始化时处理;
- `world.tickingAreaManager` **按包隔离**:只能管理本包创建的常加载区域,不能操作其他包或命令创建的;
- 每包常加载 chunk 有上限(`maxChunkCount`),房间场地尺寸规划需预留余量;
- 自定义维度传送前必须保证到达区域已加载:房间未完成「场地 + 常加载」前禁止传送玩家进入(上报 `idle` 即代表就绪)。

> 模板复制的起始点/终点、复制目标位置、准备房间坐标与场地布局**全部由小游戏包开发者配置**,Core 不持有任何场地坐标,只使用注册消息中的 `prepSpawn` 做入房传送。

准备房间与游戏场地位于同一房间维度的不同位置:场地由模板复制,准备房间位置由小游戏包单独配置(如 Gomoku 为 `(0, 0, 0)`)。

常加载区域 ID 规范:

```text
bearcade:ta_<gamename>_<n>          # 房间常加载区域
bearcade:ta_<gamename>_template     # 模板常加载区域(保留,供随时读取)
```

### 房间数量与创建时机

- 房间数量由各游戏包**根据自身游玩人数自行注册**,Core 不负责指定;
- 游戏包在 **startup 阶段注册**全部房间维度与模板维度,并在 **worldLoad 后**初始化场地、常加载并上报状态;
- 房间编号固定为 `1 ~ roomCount`,不动态分配。

| 游戏 | 房间数量 | 维度范围 |
| --- | --- | --- |
| Gomoku-五子棋 | 8 | `bearcade:gomoku_1` ~ `bearcade:gomoku_8` |
| SND5-剑与消亡V | 2 | `bearcade:snd5_1` ~ `bearcade:snd5_2` |

### 房间状态

每个房间处于以下三种状态之一:

| 状态 | 含义 | 可否加入 |
| --- | --- | --- |
| `initializing`(初始化中) | 房间创建或重置中,场地未就绪 | 否 |
| `idle`(空闲中) | 场地就绪,无对局 | 是 |
| `running`(运行中) | 对局进行中 | 否 |

状态变化即时上报,并以 5 秒为周期心跳上报;Core 超过 15 秒未收到某房间任何上报时,将其视为**数据过期**,显示为不可用并拒绝入房。

## Core 职责边界

Core 是全局调控层,职责严格限定为以下四件事:

1. **接收信息**:接收各小游戏包上报的房间状态与注册信息。
2. **实时展示**:通过 DDUI 三级菜单向玩家实时展示游戏与房间状态(2 秒轮询刷新)。
3. **入房校验**:玩家申请加入房间时,仅当「有效人数 < 最大游玩人数」且「房间状态 = 空闲中」才放行。
4. **传送**:放行后仅将玩家传送到对应房间维度的准备房间区域。

入房流程:

```text
玩家点击三级菜单中的房间
   │
   ▼
Core 去重检查:玩家是否已在房间内
   │
   ▼
Core 校验:有效人数 < 最大人数 且 状态 = 空闲中
   │
   ├─ 不通过 → 拒绝并提示原因
   └─ 通过 → 预留名额 + 传送至 bearcade:gamename_n 准备区域
                │
                ▼
         Core 不再干预,后续由对应小游戏包接管
```

并发与去重规则:

- Core 为每个房间维护"已放行未确认"名额;校验时按 `max(最近上报人数, 已放行数)` 判断,防止同时点击导致超员;
- 游戏包下一次上报到达后,以上报人数为准;
- Core 监听玩家维度切换事件(`world.afterEvents.playerDimensionChange`,事件直接提供 `Player` 对象),在内存中维护 `玩家 → 房间` 绑定:已在房间内的玩家重复点击会被拒绝;玩家维度切换回主世界时清除绑定;
- 同一玩家同一时刻只处理一个入房请求。

**Core 不负责的内容**:对局流程、房间内部事件、游戏规则、计分、场地管理等,一概由对应小游戏包自行处理。

## 大厅与 DDUI 菜单

主世界(overworld)即**大厅维度**,由 Core 管理,玩家在此选择游戏与房间。

菜单为三级结构,全部由 Core 基于 DDUI 实现:

```text
大厅维度(主世界)
   │ 玩家使用「钟」物品
   ▼
一级菜单:主菜单
   │ 点击「游戏列表」
   ▼
二级菜单:游戏列表(Gomoku / SND5 …)
   │ 选择指定游戏
   ▼
三级菜单:房间列表(2 秒轮询刷新:人数 / 最大人数 / 状态)
   │ 点击某个房间
   ▼
视为加入该房间 → 进入 Core 入房校验
```

要点:

- 玩家每次回到大厅(进入主世界)时,Core 自动发放钟物品:固定放入快捷栏第 1 格,并设置 `ItemLockMode.slot` 锁定(等价于 `minecraft:item_lock` 的 `lock_in_slot`),实现不可移动、不可丢弃;
- 钟物品是进入菜单的唯一入口,由 Core 负责检测与展示;菜单基于 `@minecraft/server-ui` 的 **CustomForm(数据驱动 UI,DDUI)** 实现,校验失败反馈使用 MessageBox / MessageFormData;
- 提供自定义命令 `/bearcade:lobby`,任意维度下执行即可传送回大厅(主世界默认出生点);
- 二级菜单的游戏列表来自各游戏包在 worldLoad 时发送的注册消息,Core 汇总并持久化;
- 三级菜单的房间数据来自各游戏包上报的状态:Core 每 2 秒轮询汇总最新上报,并通过 ObservableString 等可观察对象**实时更新已打开的菜单**;不可加入的房间用按钮禁用态表达;
- DDUI 菜单切换时先 `close()` 当前表单,再延迟 2 tick 打开新表单,避免表单排队/无法显示(参考 Beatorini 实践);
- 点击房间即等同于发起入房请求,校验与传送规则见「Core 职责边界」。

## 小游戏包的最低契约

Core 对玩法本身**零约束**:小游戏包内部如何准备、开局、结算、设计规则,完全由开发者自行决定。

仅强制三条契约:

1. **注册**:加载世界时向 Core 注册游戏信息(游戏 ID、显示名、房间数、最大人数、准备区域坐标);
2. **发信**:按「容器化房间设计」中的状态规则,向 Core 上报每个房间的人数与状态;
3. **送回大厅**:对局结束后,由小游戏包将房间内玩家传送回大厅(主世界出生点),Core 不负责接送玩家回大厅。

其余一切(玩法规则、道具、胜负判定、场地细节)均由小游戏包自由发挥。

## 通信协议

包间通信统一走 ScriptEvent 通道,具体规范见 development.md §5。

```text
通道:bearcade:ipc
信封:{ op, packId, payload }
操作码:
  game.register  游戏包 → Core,worldLoad 时注册游戏信息
  room.status    游戏包 → Core,状态变化即时上报 + 5 秒心跳
```

Core 校验消息来源:

- `packId`(游戏包 manifest 的 header UUID)必须与已注册的 `game` 匹配;
- 结合 ScriptEvent 事件的 `sourceType` / `sourceEntity` 辅助过滤:直接由玩家执行 `/scriptevent` 产生的消息(Entity 来源)一律丢弃;
- 不匹配或解析失败的消息一律丢弃并记录日志。

## 模块说明

| 包名 | 目录 | 职责 | 依赖 |
| --- | --- | --- | --- |
| Core-核心 | `Core-核心/` | 大厅管理(主世界);钟物品发放与锁定(快捷栏第 1 格);三级 DDUI 菜单(CustomForm + Observable,2 秒轮询数据);接收注册与状态上报;入房校验(去重 + 并发预留);放行后仅传送玩家至对应维度准备区域 | 无 |
| Gomoku-五子棋 | `Gomoku-五子棋/` | 五子棋玩法(15×15 棋盘、随机黑白、棋权交接提示与棋子、五连判定、胜负结算、强制中断命令);注册 8 个房间 + 模板;场地复制与常加载;上报状态;结束送回大厅 | Core |
| SND5-剑与消亡V | `SND5-剑与消亡V/` | 剑与消亡 V 玩法;注册 2 个房间 + 模板;场地复制与常加载;上报状态;结束送回大厅 | Core |

## 工程与发布

- 每个包独立构建、独立发布为 `.mcaddon`;构建产物统一收集到根目录 `dist/packages/`;
- `npm run deploy` 可将包部署到开发行为包目录(默认 Levilauncher 1.26.42.01 的 development_behavior_packs,可用环境变量 `MC_DEV_PACKS` 覆盖);
- 游戏包 manifest 通过包依赖(`packDependencies`)声明依赖 Core 包(UUID + 版本),保证 Core 先加载;
- 所有包以仓库 `docs/` 内的类型定义为基准:当前为 `@minecraft/server` 2.10.0-beta.1.26.43-stable、`@minecraft/server-ui` 2.2.0-beta.1.26.43-stable、`@minecraft/common` 1.3.0、`@minecraft/vanilla-data` 1.26.40(对应 MC 1.26.42/1.26.43),属于预发布版本,启用时需匹配对应实验开关;manifest 依赖版本与 `min_engine_version` 必须与所选定义对齐;若改用稳定版,须先核对 API 差异;
- manifest 参考 Beatorini 实际配置:依赖声明 `@minecraft/server` 2.10.0-beta 与 `@minecraft/server-ui` 2.2.0-beta,`min_engine_version` 为 [1, 26, 40],capabilities 含 `script_eval`;
- Core 将游戏注册表持久化到世界动态属性 `bearcade:registry`;房间状态与玩家房间绑定**不持久化**,服务器重启后所有房间回到"初始化中",由游戏包重新初始化并上报。

## 后续可选优化

以下内容不阻塞当前架构,留待后续按需补充:

- 大厅保护规则(PvP、掉落物清理、大厅区域限制);
- 轮询 / 心跳参数根据实际玩家规模调优;
- 菜单样式与提示文案的统一定制;
- 房间场地布局的编辑工具或可视化预览。
