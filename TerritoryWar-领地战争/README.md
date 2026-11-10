# 领地战争(TerritoryWar)

Bearcade 小游戏包:基于《围城大作战》(Surround.io)的**圈地扩张**玩法——以自己的领地为起点向外拖出尾迹,回到自己的领土时,尾迹围住的区域(含圈到的他人领土)全部归自己;踩断别人的尾迹即可击杀对方。房间管理复用 `shared/minigame-core`,玩法在 [src/game.ts](src/game.ts),格子模型在 [src/field.ts](src/field.ts)。

## 玩法规则

- **领土**:每人开局拥有一块 `3×3`(可配)的同色领地,格子上铺同色混凝土;
- **拖尾迹**:走出自己的领土后,脚下每经过一格都会铺上同色羊毛(尾迹)——尾迹是**未落定**的,随时可能被别人踩断;
- **圈地**:再次**回到自己的领土**的那一刻结算:用「自己的领土 + 自己的尾迹」围出的封闭区域,连同尾迹线一起变成自己的领土;
  - 判定方式是从场地四边向内洪水填充,漫不到的封闭格才算圈到;
  - 只走出 1 格又走回来**不会**得地(必须真的围出封闭区域,防止贴边一格一格蹭面积);
- **抢占**:被围住的区域里如果有**别人的领土**,一并抢过来(同时扣掉对方的面积);
- **击杀**:踩到**别人正在拖的尾迹** = 切断对方路线 → 对方**领土清零**、被送回准备区,等待复活(默认 5 秒,可在随机空地重开);
- **两种模式**:
  - **限时模式**(默认):一局 180 秒,时间到按**领土面积**排名(面积相同看击杀数);
  - **无尽模式**:把「一局时长」配成 `0` 即为不限时,只剩最后一名存活者时结束(需同时把复活等待设为 `0`,否则死不了人);
- **提前结束**:任一玩家领土占比达到 `60%`(可配)立即结束并判胜;
- **离开/断线**:一律视为退出,其领土立即回收为中立地。

> 对局内**禁止一切伤害**:击杀只由"切断尾迹"决定,不靠 PvP。玩家固定冒险模式,禁止放置/破坏方块。

## 房间与人数

| 项 | 值 |
| --- | --- |
| 房间数 | 2(`bearcade:territory_war_1` ~ `bearcade:territory_war_2`) |
| 每房人数 | 最多 8 人(颜色槽 = 8) |
| 最少开局人数 | 2 |
| 派对模式 | 不支持(`partyAvailable: false`,超过 8 人会复用颜色) |
| 场地 | 41×41 格(可在配置界面调 15~41 奇数) |

## 场地制作

在模板维度 `bearcade:territory_war_template` 生成场地:

```text
/bearcade:tmp tp territory_war     # 进入模板维度
/bearcade:territory_war_buildmap   # 自动生成:领地地面 + 外墙 + 准备平台
/bearcade:tmp sz territory_war     # (可选)调整模板捕获范围
/bearcade:tmp ap territory_war     # 应用到全部房间
```

`/bearcade:territory_war_buildmap`(需 `op` tag)生成的内容:

- **41×41 中立领地地面**(默认 `fieldY = 63`,玩家站在 +1 层),整块一次刷成中立白混凝土;
- **场地外框**:表面一圈黑色框 + 2 格高屏障(自定义维度是空维度,防止掉下去)+ 四角海晶灯;
- **准备平台**:`prepSpawn` 处 7×7 平台 + 2 格高围栏,用于等待开局与被击杀后等待复活;
- 命令**可重复执行**:先整块清空再重建,改小场地也不会残留旧方块。

> 场地几何(中心/边长/地面 Y)改动后必须重跑建图命令并 `/bearcade:tmp ap territory_war`,否则场地与规则不匹配。模板范围为 `(-28,56,-28) ~ (28,80,28)`,57×57 区域约 16 区块/房,远低于单区域约 100 区块上限。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `/bearcade:tmp tp territory_war` | 传送到模板维度 |
| `/bearcade:tmp sz territory_war` | 表单配置模板捕获范围 |
| `/bearcade:tmp ap territory_war` | 把模板应用到全部房间 |
| `/bearcade:territory_war_buildmap` | 在模板维度生成场地(需 op tag) |
| `/bearcade:config territory_war` | 运行时配置(需 op tag,对局中禁改) |
| `/bearcade:debug territory_war enable\|disable` | 开关调试日志 |
| `/bearcade:quit` | 在房间维度执行,强制中止对局 |

## 运行时可配置项(`/bearcade:config territory_war`)

准备房间坐标 / 场地中心(X、Z)/ 场地边长 / 场地地面 Y / 一局时长(0 = 无尽模式)/ 复活等待(0 = 淘汰不复活)/ 初始领地边长 / 获胜领土占比 / 移动加速等级,以及「恢复默认」。持久化在动态属性 `bearcade:config_territory_war`,优先于代码默认值;改场地几何后需重跑建图命令。

## HUD

每房间独立 objective `bearcade:territory_war_<房间号>`,经 `shared/minigame-core/scoreboardHud` 把各玩家领土占比以 rawtext `score` token 注入每位玩家的 title,由独立公共资源包 `hud`(`hud/ui/hud_screen.json`,`hud_title_text` 重排版;须启用)显示为屏幕右侧面板:

```text
领地战争
剩余 2:31 · 安全
▶ ■ 你 23%
  ■ 玩家B 18%
  ■ 玩家C 9%
击杀 2 · 死亡 1
```

不使用全服唯一的 Sidebar 显示槽,多房间/多游戏同时运行互不覆盖。**因此本包必须带配对资源包** `territory_war_hud`(`npm run deploy territory_war` 会自动带上)。

## 方块与配色

| 颜色槽 | 聊天色 | 领土方块(已落定) | 尾迹方块(拖出中) |
| --- | --- | --- | --- |
| 红 | `§c` | `minecraft:red_concrete` | `minecraft:red_wool` |
| 蓝 | `§9` | `minecraft:blue_concrete` | `minecraft:blue_wool` |
| 绿 | `§a` | `minecraft:lime_concrete` | `minecraft:lime_wool` |
| 黄 | `§e` | `minecraft:yellow_concrete` | `minecraft:yellow_wool` |
| 橙 | `§6` | `minecraft:orange_concrete` | `minecraft:orange_wool` |
| 紫 | `§5` | `minecraft:purple_concrete` | `minecraft:purple_wool` |
| 青 | `§b` | `minecraft:cyan_concrete` | `minecraft:cyan_wool` |
| 粉 | `§d` | `minecraft:pink_concrete` | `minecraft:pink_wool` |

中立地面为 `minecraft:white_concrete`。不使用自定义方块,因此行为包无需额外的 `blocks/` 定义与贴图。

## 实现要点

- **格子模型**([src/field.ts](src/field.ts)):`owner`(Uint8Array,0 = 中立,1..8 = 颜色槽 + 1)记录归属,`trailOwner` 记录未落定的尾迹归属,`counts` 维护每色面积;格子与世界方块 1:1 对应;
- **移动采样**:每 2 tick 读一次玩家脚底坐标,算出所在格;跨格时**逐格补线**(对角移动补成 L 形),避免斜走漏格导致封闭区域漏气;
- **圈地**:以「我的领土 + 我的尾迹」为墙,从场地四边界向内洪水填充,未被漫到的格子即本次圈到的地;再把尾迹线本身并入;
- **击杀**:踩到某格 `trailOwner` 是别人 → 对方 `killPlayer`:尾迹回退(只清尾迹归属并按当前归属重画)、领土整块刷回中立、传送到准备区、计复活倒计时;
- **复活**:在随机空位上重画一块「初始领地边长」的正方形(顺序扫描兜底,保证找得到);
- **重置**:`onBeforeReset` 清 HUD/物品/效果并删除会话;`onRoomReset` 用一次 `fillBlocks` 把场地刷回中立,防止模板异常时上一局颜色残留;
- **群体效果**:每秒刷新 `speed`(可配等级)、`saturation`(防饥饿)、`night_vision`(自定义维度没有稳定照明,夜视保证颜色块都看得清);
- **伤害拦截**:`world.beforeEvents.entityHurt` 取消房间维度内玩家的一切伤害,避免互殴抢戏;
- **受保护**:`canPlace`/`canBreak` 恒为 `false`,领地只由脚本绘制。

详细规范见仓库根目录 [development.md](../development.md) 与 [docs/lessons.md](../docs/lessons.md)。
