# Bearcade 基岩版小游戏服务器

基于 Minecraft 基岩版(1.26.x,ScriptAPI 2.10-beta)的多人小游戏服务器框架,采用**分包解耦 + 容器化房间**架构:

- **分包解耦**:每个目录对应一个独立的 mcpack;`Core-核心` 负责全局调控,其余小游戏包互不依赖、互不影响;
- **容器化房间**:利用自定义维度实现"一个维度 = 一个游戏 = 一个房间",游戏实例完全隔离;
- **玩法零约束**:Core 只做大厅、入房校验与状态汇聚,小游戏内部流程完全由各游戏包自由实现。

**当前状态**:**Gomoku(五子棋)**、**GuessNBuild(建筑猜猜乐)第一版**、**BridgeWar(急速战桥)**、**PigCatcher(猪猪争夺战)** 均已完整可运行——Gomoku 含随机黑白、放置方块落子、五连判定;GuessNBuild 含 3~16 人回合制建筑猜谜、聊天答题、题库表单、每玩家 HUD 计分;BridgeWar 含红蓝两队核心区得分、回合制搭拆桥、队伍装备配置;PigCatcher 含四队驱赶中立猪进核心区、钓鱼竿解拴/拴绳拖拽/核心区引力场、计时结算、队伍装备实体储存;**Collapse(豆腐渣地板)** 玩法已实现(多层地板塌陷、PVP 对抗、掉虚空淘汰与 Camera 跟随观战),场地坐标当前为占位值,按包内 README 制作模板场地后即可运行;**Werewolf(天黑请闭眼)** 玩法已实现(6~10 人昼夜行动、身份分配、投票与遗言浮空字),包内已附带旧版围桌场地结构,按 README 载入模板维度后即可运行;另有 **SND5(剑与消亡V)** 骨架包(玩法待定),以及可直接复制开发的小游戏模板包与开发者工具包(悬浮公告 /btd、物品属性编辑 /cis)。

## 快速开始

环境要求:

- Minecraft 基岩版 1.26.42+ / 1.26.43(启用 **Beta APIs** 实验);
- Node.js 18+ 与 npm;
- 开发时把包部署到 `development_behavior_packs` 目录。

常用命令:

```bash
npm install          # 安装类型定义与构建工具
npm run typecheck    # TypeScript 类型检查
npm run check        # 校验 config/packs.json 与各包源码的 packId 一致性
npm run build        # 生成各包 manifest 并打包脚本
npm run deploy       # 按一对一分包部署:指定行为包会自动带上配对 *_hud 资源包(Windows 默认路径;其他平台设置 MC_DEV_PACKS / MC_DEV_RESOURCE_PACKS)
npm run package      # 产出 dist/packages/*.mcpack(含各小游戏一对一配对的 *_hud 资源包)与 bearcade.mcaddon
npm run distribute   # 生成可分发的开发套件 dist/BearcadeDevKit-<版本>.zip
npm run watch        # 监听 config/、shared/ 与各包 src/ui,变更后自动重建(开发时)
```

部署后进入世界执行 `/reload`,Core 加载时内容日志会出现 `[Bearcade Core] 已加载`;玩家在大厅使用钟物品打开菜单。

> 记分板 HUD 采用 JSON UI:资源包内嵌在对应行为包目录的 `resource-pack/` 子目录中,构建/部署时再还原为 `Xxx-资源包` 一对一安装包;`npm run deploy` 与 `bearcade.mcaddon` 会自动带上。

> 各包目录下的 `manifest.json` 与 `scripts/` 均为构建产物,不入库;克隆仓库后先执行 `npm install && npm run build` 生成。

## 目录结构

```text
Bearcade/
├── Core-核心/              # 全局调控包(大厅、DDUI 菜单、入房校验、状态汇聚)
├── Gomoku-五子棋/          # 五子棋小游戏(首个完整可运行的小游戏)
├── Template-小游戏模板/    # 小游戏模板包(复制即可开发新游戏)
├── <游戏>/resource-pack/  # 内嵌的配对资源包(JSON UI/贴图/模型),构建时拆分为 <游戏>-资源包
├── shared/minigame-core/   # 共享小游戏运行时(维度/复制/状态机/上报,构建期内联进各包)
├── docs/                   # ScriptAPI 类型定义、官方文档快照与实战参考(lessons.md)
├── docs/addon-content.md   # 自定义物品/方块/实体开发规范
├── config/packs.json       # 包定义唯一来源(构建时生成 manifest)
├── scripts/                # 构建/打包/部署/分发脚本
├── README.md               # 架构介绍(本文档)
└── development.md          # 小游戏开发规范(唯一事实来源)
```

## 架构原则

1. **一目录一包**:根目录下每个目录最终构建为一个独立的 mcpack(全部包再合并为一个 bearcade.mcaddon)。
2. **全局能力归 Core**:跨小游戏共享的逻辑、全局状态与调控能力统一放在 `Core-核心`。
3. **小游戏间解耦**:除依赖 Core 外,各小游戏包不允许互相引用。
4. **单维度单房间**:每个游戏房间拥有独立的自定义维度,互不干扰。
5. **独立演进**:各包可单独开发、打包、发布和回滚。
6. **Core 职责收敛**:Core 只负责全局调控,不介入任何对局逻辑。

## 容器化房间设计

### 维度命名

- 统一命名空间前缀 `bearcade:`;
- 房间维度:`bearcade:gamename_n`(`gamename` 为正式英文名,全小写;`n` 为正整数,固定 `1 ~ roomCount`);
- 模板维度:`bearcade:gamename_template`(场地源,不承载对局)。

示例:Gomoku 注册 `bearcade:gomoku_1 ~ bearcade:gomoku_8` 与 `bearcade:gomoku_template`。

### 维度注册

自定义维度在 **startup 阶段**注册(`system.beforeEvents.startup` → `event.dimensionRegistry.registerCustomDimension(typeId)`),这是 ScriptAPI 唯一允许的注册时机:

- 注册创建 void 生成器空维度,不自动生成安全出生点;
- 重复注册会抛错,注册逻辑必须幂等容错;
- 维度注册属于 beta 脚本表面,manifest 需依赖 beta 版 `@minecraft/server`。

### 模板场地与复制

- 模板复制起始点/终点、每个房间的复制原点、准备房间坐标、场地布局**全部由小游戏包开发者配置**,Core 不持有任何场地坐标;
- 初始化/重置时从模板维度捕获结构(`structureManager.createFromWorld`,结构上限 64×384×64)并复制到房间,再以 `tickingAreaManager` 常加载;
- 横向超过 64 的模板由共享运行时**自动分块**捕获/放置(默认每块 ≤64×64,`tileSize` 可配),无需手工处理;
- 每次重置都删除旧结构、从模板维度重新捕获复制,模板是唯一场地源;
- 模板维度**必须常加载**(worldLoad 捕获结构前区块必须已加载);房间游玩区同样常加载;
- 准备房间与游戏场地位于同一房间维度的不同位置。

### 房间状态

| 状态 | 含义 | 可否加入 |
| --- | --- | --- |
| `initializing`(初始化中) | 房间创建或重置中,场地未就绪 | 否 |
| `idle`(空闲中) | 场地就绪,无对局 | 是 |
| `running`(运行中) | 对局进行中 | 否 |

状态变化即时上报 + 每 5 秒心跳;Core 超过 15 秒未收到房间上报时标记数据过期并拒绝入房,超过 30 秒未上报的游戏包自动从菜单隐藏。

## Core 职责边界

Core 只做四件事:

1. 接收小游戏包的注册与房间状态上报;
2. 通过 DDUI 三级菜单实时展示游戏与房间状态(2 秒轮询数据,Observable 实时刷新);
3. 入房校验:有效人数 < 最大人数 且 房间为空闲中(含去重与并发预留);
4. 放行后仅将玩家传送到对应房间维度的准备区域,之后不再干预。

Core 提供命令:

- `/bearcade:lobby`:任意维度下传送回大厅;
- `/bearcade:tmp tp <gamename>`:传送到指定游戏的模板维度;
- `/bearcade:tmp ap <gamename>`:将指定游戏的模板应用到其全部房间;
- `/bearcade:tmp sz <gamename>`:打开表单配置模板范围的起始点/终点(游戏内配置优先于 config.ts,保存到动态属性);
- `/bearcade:quit`:在对应游戏房间维度执行,强制中止该房间的对局;
- `/bearcade:party`:管理员开关**派对模式**;
- `/bearcade:config <gamename>`:管理员打开指定游戏的**运行时配置界面**(五子棋/建筑猜猜乐/急速战桥/猪猪争夺战/豆腐渣地板已接入,对局进行中禁止修改);
- `/bearcade:debug <gamename|all> enable|disable`:管理员开启/关闭指定游戏(或 `all` 全部游戏)的调试日志(共享运行时统一支持)。

派对模式:开启后普通玩家不能自行选择游戏加入;管理员从游戏列表点击房间时,Core 会把全服在线玩家一起带入该房间(忽略人数上限),且只允许 `partyAvailable=true` 的小游戏(如 gomoku=false、guessnbuild=true);带队时要求全服在线人数达到该游戏的最少开局人数(`minPlayers`),否则拒绝加入;派对模式开局倒计时固定 60 秒,不触发满员缩短。管理员以 `op` tag 判定。

## 大厅与 DDUI 菜单

- 主世界(`minecraft:overworld`)即大厅,由 Core 管理;
- 玩家每次回到大厅自动获得钟物品:快捷栏第 1 格,`ItemLockMode.slot` 锁定,不可移动/丢弃;
- 使用钟 → 一级主菜单 → 二级游戏列表 → 三级房间列表(人数 / 最大人数 / 状态,实时刷新);
- 点击房间即发起入房请求;菜单基于 `@minecraft/server-ui` 的 CustomForm(DDUI)。

### 返回大厅数据初始化与断线处理(契约)

- **返回大厅强制数据初始化**:玩家进入主世界的任意路径(对局正常结束、`/bearcade:lobby`、`/bearcade:quit` 强制中止、手动传送、断线重连),Core 统一执行:清空全套物品(背包/快捷栏/盔甲/副手)、恢复冒险模式、清除对局内设置的重生点、还原名牌与聊天染色、清除效果,随后重新发放钟物品。游戏包自身的清理逻辑保留,Core 为最终兜底,杜绝"未重置重生点/局内道具残留"一类问题;
- 玩家**进入**房间维度时自动移除大厅钟,避免占用对局背包格(返回大厅时重新发放);
- **断线一律视为退出游戏**(不提供热重连):重连时若玩家不在主世界(断线时位于房间/模板维度),Core 自动传送回大厅并执行上述数据初始化;对局侧由游戏包状态机按"人数不足/队伍无人"即时结束对局。

## 小游戏包的最低契约

玩法流程不做统一规范,小游戏包仅需满足五条契约:

1. **注册**:worldLoad 后发送 `game.register`(游戏 ID、显示名、房间数、最大人数、最少开局人数 `minPlayers`、`partyAvailable`、准备房坐标);
2. **发信**:按规则上报每房间人数与状态(变化即时 + 5 秒心跳);
3. **送回大厅**:对局结束后由游戏包将玩家传送回主世界出生点。
4. **兜底中止**:必须响应 Core 的 `/bearcade:quit`(在房间维度执行,强制中止并重置),便于运营与测试。
5. **模板命令**:必须响应 Core 的 `/bearcade:tmp tp|ap|sz <gamename>`(进入模板维度 / 应用模板 / 表单配置模板范围)。

## 通信协议

```text
通道:bearcade:ipc(ScriptEvent)
信封:{ op, packId, payload }
操作码:
  game.register  游戏包 → Core,worldLoad 时注册游戏信息
  room.status    游戏包 → Core,状态变化即时上报 + 5 秒心跳
```

Core 校验 `packId`(manifest header UUID)与 `game` 匹配,并结合 `sourceType` 过滤玩家伪造消息;解析失败一律丢弃并记录日志。协议细节见 development.md §5。

## 模块说明

| 包名 | 目录 | 职责 |
| --- | --- | --- |
| Core-核心 | `Core-核心/` | 大厅管理、钟物品、DDUI 菜单、注册与状态接收、入房校验、传送 |
| Gomoku-五子棋 | `Gomoku-五子棋/` | 五子棋:15×15 棋盘、随机黑白、发放压力板落子、五连判定、结算、强制中断 |
| Template-小游戏模板 | `Template-小游戏模板/` | 可复制的小游戏脚手架:维度注册、模板复制、上报、状态机、命令 |
| GuessNBuild-建筑猜猜乐 | `GuessNBuild-建筑猜猜乐/` | 建筑猜猜乐(第一版可运行):3~16 人回合制、建筑者创造/猜测者聊天答题、题库表单、每玩家 HUD 计分、目标分随人数、可开关调试 |
| BridgeWar-急速战桥 | `BridgeWar-急速战桥/` | 急速战桥(可运行):红蓝两队、进入对方核心区得分、回合制重置地图、羊毛搭拆桥、队伍装备配置 |
| PigCatcher-猪猪争夺战 | `PigCatcher-猪猪争夺战/` | 猪猪争夺战(可运行):四队驱赶中立猪进核心区、钓鱼竿解拴/拴绳拖拽/核心区引力场、计时结算、队伍装备实体储存 |
| Collapse-豆腐渣地板 | `Collapse-豆腐渣地板/` | 豆腐渣地板(玩法已实现,待建模板场地):多层地板踩踏塌陷(黄→橙→红→消失)、60 秒后 PVP、掉虚空淘汰、Camera 跟随观战可切换、最后存活者获胜 |
| SND5-剑与消亡V | `SND5-剑与消亡V/` | 剑与消亡V(骨架阶段,玩法待定):模板脚手架,基础设施就绪 |
| Werewolf-天黑请闭眼 | `Werewolf-天黑请闭眼/` | 天黑请闭眼(玩法已实现,待载入场地结构):6~10 人昼夜行动、身份分配、投票、队内聊天与遗言浮空字,4 房/10 人/6 人开局 |
| Toolkit-开发者工具 | `Toolkit-开发者工具/` | 纯工具包(不注册游戏):悬浮公告管理 `/btd`、手持物品属性编辑 `/cis`(均限管理员) |
| `<游戏>/resource-pack/` | 行为包目录内的资源包子目录 | 资源包(JSON UI):打包时拆分为 `<游戏>-资源包`,与行为包一对一安装;含 `ui/`、`textures/`、`models/` 等 |

> 记分板方案:所有小游戏已不再占用全服唯一的 Sidebar 显示槽。分数仍写入每房间独立 objective,由 `shared/minigame-core/scoreboardHud.ts` 转成 rawtext `{score:...}` 注入每位玩家的 title;每个小游戏的配对资源包(源码位于 `resource-pack/`)把 title 通道重排版为屏幕右侧垂直居中的记分板,因此多房间/多游戏同时运行互不覆盖。

## 开发新小游戏

1. 复制 `Template-小游戏模板` 目录并重命名;
2. 全局替换 `mygame` 为你的游戏 ID,修改 `src/config.ts`(显示名、房间数、最大人数、坐标);
3. 在 `config/packs.json` 注册你的包,`npm run build`;
4. 需要自定义实体/物品/方块等定义时,放入包目录对应文件夹(`entities/`、`items/`、`blocks/` 等,清单见 `scripts/extras.mjs`),打包/部署自动包含;
5. 部署后 `/reload`,执行 `/bearcade:tmp tp mygame` 进入模板维度建场地;
6. 在 `src/game.ts` 的 TODO 处实现玩法;
7. `npm run typecheck && npm run build && npm run package` 产出你的 `.mcpack`。

完整说明见 [Template-小游戏模板/README.md](Template-小游戏模板/README.md) 与 [development.md](development.md)。

## 工程与发布

- 每个包独立构建、独立发布为 `.mcpack`;`npm run package` 同时产出合并全部包的 `bearcade.mcaddon`,构建产物统一收集到 `dist/packages/`;
- 所有包统一版本 **Beta v0.0.1**,版本号集中在 `config/packs.json` 的 `projectVersion`,构建时写入 manifest;日常更新不逐包改版本;
- 游戏包 manifest 通过包依赖声明依赖 Core(保证加载顺序);
- 房间管理通用逻辑集中在 `shared/minigame-core`,构建期内联进每个小游戏包;改共享代码后 `npm run build` 即同步全部包;
- 所有包以 `docs/` 内类型定义为基准:当前 `@minecraft/server` 2.10.0-beta、`@minecraft/server-ui` 2.2.0-beta、`min_engine_version` [1, 26, 40](预发布版本,启用需匹配对应实验开关);
- Core 注册表持久化到动态属性 `bearcade:registry`;恢复出的历史条目默认不显示,当前会话收到注册/上报后才进入菜单;房间状态与玩家绑定不持久化,重启后房间回到初始化中;
- `npm run distribute` 生成含 Core、小游戏模板、开发文档与工具链的分发套件。

## 后续可选优化

- 大厅保护规则(PvP、掉落物清理、大厅区域限制);
- 轮询 / 心跳参数按实际规模调优;
- 菜单样式与提示文案统一定制;
- 房间场地布局编辑工具或可视化预览。
