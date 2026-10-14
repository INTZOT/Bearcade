## 🎮 夺旗 (Capture The Flag) - Bearcade 小游戏包

基于 [Bearcade](https://github.com/bearcade) 框架的多人夺旗小游戏，适用于 Minecraft Bedrock Edition（Script API）。

---

### 📁 项目结构

```
src/
├── main.ts                 # 入口
├── config.ts               # 全部游戏配置
├── game.ts                 # 实现 MinigameHooks
├── GameManager.ts          # 核心控制器（管理游戏状态、功能实现，逻辑主循环）
├── CTFPlayer.ts            # 玩家数据类（经济、击杀/死亡、队伍缓存）
├── PlayerManager.ts        # CTFPlayer 生命周期管理
├── Team.ts                 # 队伍纯数据实体（分数、出生点）
├── TeamManager.ts          # 队伍管理：玩家归属、得分、事件总线
├── TeamEvents.ts           # 队伍事件定义与事件总线实现
├── Flag.ts                 # 旗帜实体（状态、携带者、掉落回城）
├── FlagManager.ts          # 旗帜集合管理
├── Shop.ts                 # 商店类（ActionForm 交互、购买逻辑）
├── ShopManager.ts          # 商店集合与实体查找
├── ScoreboardTemplate.ts   # 计分板模板（多列渲染）
├── ScoreboardManager.ts    # 玩家计分板显示管理
├── Counter.ts              # 通用计数器（暂未使用）
├── types.ts                # 共享类型定义
├── utils.ts                # 工具函数
├── listener.ts             # 世界事件监听
└── README.md               # 文档
```

---

### ⚙️ 配置说明

#### 运行时配置(`/bearcade:config ctf`)

管理员在游戏中执行 `/bearcade:config ctf` 打开配置界面(对局进行中禁止修改),配置持久化到动态属性 `bearcade:config_ctf`,重启后仍生效,界面提供「恢复默认」。可配置项:

- 准备房间坐标(保存后自动重新向 Core 注册,入房落点即时生效);
- 各队出生点 / 旗帜位置(蓝队、绿队);
- 物品商店 / 增益商店实体位置;
- 获胜所需分数、对局时长(分钟)、旗帜掉落回城时间(秒)、复活等待(秒);
- 初始羊毛方块数、击杀回血(半心);
- 生命回复:延迟(秒)/ 速度(半心/秒);
- 旗帜诅咒:触发秒数 / 被诅咒者生命上限(半心);
- TNT:引信(秒)/ 爆炸半径(格)/ 伤害(半心);
- 经济:初始金币、击杀奖励、夺旗奖励、每秒金币;
- 水中受伤延迟(秒)/ 水中伤害(半心)、旗帜拾取半径(格)。

#### 代码默认值

以上各项的代码默认值集中在 [src/config.ts](src/config.ts) 的 `CTF_CONFIG_DEFAULTS`(持久化值优先)。初始护甲与武器(`INITIAL_ARMOR`/`INITIAL_INVENTORY`,物品 ID 不适合表单编辑)仍为代码常量。

> **修改提示**:商店商品(价格、图标、回调)在 `GameManager.initialize()` 中硬编码,如需调整请直接编辑该方法内的 `itemShop.addItem()` 和 `setCallback()` 部分。

---

### 开发与部署

```bash
npm install          # 安装依赖
npm run typecheck    # 类型检查
npm run build        # 编译 TypeScript → dist
npm run package      # 打包为 .mcpack（输出至 dist/packages）
npm run deploy       # 自动部署至 Minecraft 开发目录（需配置路径）
```

**测试流程**：
1. 进入游戏，执行 `/reload` 加载包。
2. 使用 `/bearcade:tmp tp ctf` 进入模板维度搭建场地。
3. 调整 `config.ts` 中的坐标（`TEMPLATE_FROM`、`TEMPLATE_TO`、`ROOM_COPY_ORIGIN` 等）。
4. 应用模板：`/bearcade:tmp ap ctf`。
5. 通过 Core UI 或命令创建房间并加入。

---

### 📌 注意事项
- 队友伤害（含箭矢、TNT）被完全禁止。
- 玩家只能破坏自己放置的方块。
- 旗帜实体为盔甲架，拾取后自动隐藏；商店实体同为盔甲架，左右键点击均可打开。
- 所有自定义实体（旗帜、商店、TNT 引信）在游戏结束时自动清理。
