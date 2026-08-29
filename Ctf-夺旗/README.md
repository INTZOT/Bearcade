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
├── Timer.ts                # 计时器（游戏刻驱动）
├── Counter.ts              # 通用计数器（暂未使用）
├── types.ts                # 共享类型定义
├── utils.ts                # 工具函数
├── GlobalDataCache.ts      # 全局玩家缓存（暂无实际用途）
├── listener.ts             # 世界事件监听
└── README.md               # 文档
```

---

### ⚙️ 配置说明

```ts
export const config = {
  // ---- 队伍配置 ----
  teams: [
    {
      id: 'blue',
      name: '蓝队',
      color: 'blue',           // 对应羊毛颜色
      hex: '#5555FF',
      spawnPoint: { x: 5, y: 65, z: 0 },
      flagHomePosition: { x: 6, y: 65, z: 0 }
    },
    {
      id: 'green',
      name: '绿队',
      color: 'green',
      hex: '#55FF55',
      spawnPoint: { x: -5, y: 65, z: 0 },
      flagHomePosition: { x: -6, y: 65, z: 0 }
    }
  ] as const,

  // ---- 初始装备 ----
  initialArmor: {
    leggings: 'minecraft:diamond_leggings',
    boots: 'minecraft:diamond_boots'
  } as const,
  initialInventory: [
    { item: 'minecraft:diamond_sword', count: 1 },
    { item: 'minecraft:bow', count: 1 },
    { item: 'minecraft:arrow', count: 16 }
  ],
  initialBlockCount: 32,       // 初始羊毛方块数量

  // ---- 胜利条件与时间 ----
  maxScore: 3,                 // 获胜所需分数
  matchTime: 300,              // 对局时长（秒）
  flagReturnTime: 15,          // 旗帜掉落后自动回城时间（秒）
  respawnTime: 5,              // 玩家复活等待时间（秒）
  arrowBreakRadius: 1,         // 箭矢破坏玩家放置方块的半径

  // ---- 生命恢复 ----
  regeneration: {
    delaySeconds: 15,          // 受伤后延迟多少秒开始恢复
    perSecond: 1,              // 每秒恢复的生命值
  },

  // ---- TNT 爆炸参数 ----
  tnt: {
    fuseTicks: 80,             // 引信时长（刻，20刻=1秒）
    explosionRadius: 4,        // 爆炸半径（格）
    playerDamage: 8,           // 对非队友玩家造成的伤害（半心单位，8=4颗心）
  },

  // ---- 经济系统 ----
  economy: {
    initial: 200,              // 初始金币
    killReward: 15,            // 击杀奖励
    flagReward: 150,           // 成功夺旗奖励
    winReward: 100,            // 胜利队伍额外奖励（未使用）
    tickReward: 1              // 每秒自动获得的金币（被动收入）
  },

  // ---- 商店实体位置（盔甲架） ----
  itemShop: {
    shop1: { x: -1, y: 65, z: 0 },
    shop2: { x:  1, y: 65, z: 0 }
  },

  // ---- 旗帜判定半径 ----
  arena: {
    captureRadius: 1           // 拾取/归还旗帜的判定距离（格）
  }
};
```

> **修改提示**：商店商品（价格、图标、回调）在 `GameManager.initialize()` 中硬编码，如需调整请直接编辑该方法内的 `itemShop.addItem()` 和 `setCallback()` 部分。

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
