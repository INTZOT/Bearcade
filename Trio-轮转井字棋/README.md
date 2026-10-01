# 轮转井字棋(Trio)

Bearcade 小游戏包:3×3 棋盘三连取胜,但**每方场上最多 3 子**——轮到你时,自己最老的一子会轮转出局,并在原格留下一枚**虚化标记**(仅你本回合存在,禁止原地复下)。房间管理复用 `shared/minigame-core`,玩法在 [src/game.ts](src/game.ts)。

## 玩法规则

- **棋盘**:3×3(模板维度里 9 块磁石的上表面),棋子方块放在棋盘层上方一格;
- **棋子**:X = 深红,O = 深蓝;开局随机分配谁执 X、谁执 O;
- **轮转机制**:
  - 开局前 3 手正常落子(场上不足 3 枚时不触发轮转);
  - 场上满 3 枚后,每次轮到你 → **你最老的一枚直接消失**,原格变为「虚化格」(浅色半透明同形方块);
  - 「虚化格」**只在你的本回合存在**:本回合你不能把新子下在这一格,回合结束标记自动消失,对手回合该格就是普通空格;
  - 所以你永远只有 3 枚实子在盘上,且不能原地不动;
- **胜利**:与井字棋相同——横/竖/斜任意一条线三连;
- **制式**:**三局两胜**。第 1 局随机先手,第 2 局换边先手,第 3 局回到第 1 局的先手(逐局轮换);
- **每步限时 45 秒**:超时由脚本在合法格中**随机落子**继续对局;同一玩家**连续 3 次超时**则**本局判负**(手动落子即清零该计数);
- **流局兜底**:每局手数上限 60 手,达到上限仍未三连则该局**平局、不计分**;整场最多 5 局,打满后按胜局数判定,仍相同则整场平局;
- **离开/断线**:一律视为退出,房间人数不足时结束整场并回大厅。

## 房间与人数

| 项 | 值 |
| --- | --- |
| 房间数 | 2(`bearcade:trio_1` ~ `bearcade:trio_2`) |
| 每房人数 | 固定 2 人(满 2 人锁房) |
| 最少开局人数 | 2 |
| 派对模式 | 不支持(`partyAvailable: false`) |
| 观战 | 未启用(代码预留接口,见下) |

## 场地制作

在模板维度 `bearcade:trio_template` 生成场地:

```text
/bearcade:tmp tp trio          # 进入模板维度
/bearcade:trio_buildmap        # 自动生成:3×3 磁石棋盘 + 走道 + 屏障 + 准备平台
/bearcade:tmp sz trio          # (可选)调整模板捕获范围
/bearcade:tmp ap trio          # 应用到全部房间
```

`/bearcade:trio_buildmap` 生成的内容:

- **中央 3×3 磁石棋盘**(位于 `boardY = 63`,比走道高一格);
- **11×11 走道**(`boardY - 1` 层),四周 2 格高屏障——自定义维度是空维度,屏障用于防止玩家掉出场地;
- **准备房间平台**(7×7,位于 `prepSpawn` 下方一层);
- 棋子层与头顶净空自动清空。

> 场地坐标全部可在游戏内用 `/bearcade:config trio` 调整;改动棋盘点位后建议重跑一次 `/bearcade:trio_buildmap`。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `/bearcade:tmp tp trio` | 传送到模板维度 |
| `/bearcade:tmp sz trio` | 表单配置模板捕获范围 |
| `/bearcade:tmp ap trio` | 把模板应用到全部房间 |
| `/bearcade:trio_buildmap` | 在模板维度生成场地(需 op tag) |
| `/bearcade:config trio` | 运行时配置(需 op tag,对局中禁改) |
| `/bearcade:debug trio enable\|disable` | 开关调试日志 |
| `/bearcade:quit` | 在房间维度执行,强制中止对局 |

## 运行时可配置项(`/bearcade:config trio`)

准备房间坐标 / 棋盘位置(棋盘 Y 与 3×3 最小角 X、Z)/ X 方开局坐标 / O 方开局坐标 / 每步限时(秒)/ 胜利所需局数 / 每局手数上限,以及「恢复默认」。持久化在动态属性 `bearcade:config_trio`,优先于代码默认值。

## 方块与资源包

| 方块 ID | 用途 | 贴图 |
| --- | --- | --- |
| `bearcade:trio_x` | X 方棋子(深红) | `trio_x.png` |
| `bearcade:trio_o` | O 方棋子(深蓝) | `trio_o.png` |
| `bearcade:trio_x_ghost` | X 方虚化标记(浅红半透明,不显形于创造物品栏) | `trio_x_ghost.png` |
| `bearcade:trio_o_ghost` | O 方虚化标记(浅蓝半透明) | `trio_o_ghost.png` |

- 模型来自用户提供的 `X_jzq.geo.json` / `O_jzq.geo.json`(11×11 像素、1 像素厚的像素画形状),已做两处适配:
  1. **居中**:原模型 X/Z 占 `0~11`,按仓库惯例平移到 `-5.5~5.5`(方块内居中);
  2. **手持变体**:`trio_x_hand` / `trio_o_hand` 把整体上移到中心 `Y = 8`(`7.5~8.5`),供 `minecraft:item_visual` 在手中显示 3D 棋子。
- 资源包与行为包**一对一**分布(`trio_hud.mcpack`),含 4 张 16×16 贴图、4 个几何体与 JSON UI 记分板(`ui/hud_screen.json`,`hud_title_text` 重排版为屏幕右侧面板)。
- 部署:`npm run deploy trio` 会自动带上配对的 `trio_hud` 资源包。

## HUD

每房间独立 objective `bearcade:trio_<房间号>`,经 `shared/minigame-core/scoreboardHud` 把「局分」以 rawtext `score` token 注入每位玩家的 title,由配对资源包重排为右侧面板:

```text
轮转井字棋
第 1 局 · 手数 12/60
X  1 : 0  O
▶ 轮到你(X)
剩余 38s
```

不使用全服唯一的 Sidebar 显示槽,因此多房间/多游戏同时运行互不覆盖。

## 观战 / 派对接口(预留,暂不启用)

[src/config.ts](src/config.ts) 中预留了三个开关,默认全为 `false`(因此注册时 `partyAvailable: false`、`maxPlayers: 2`):

- `SPECTATE_ENABLED`:开启后允许第三人进房观战(需同时放宽 `MAX_PLAYERS` 与 Core 侧入房校验);
- `PARTY_SPECTATE_ENABLED`:派对模式下"全服观战"接口;
- `PARTY_AVAILABLE`:派对模式下把全服带进同一房间(双人棋,默认关闭)。

[src/game.ts](src/game.ts) 已导出 `addSpectator()` 与 `isMatchRunning()` 作为接入点;对局状态内的 `spectators` 集合与「非玩家不可落子」的判定也已就位,开启开关即可接入。

## 实现要点

- **restricted execution**:`canPlace` 回调内只改内存状态(移除最老棋子、记分、判定三连),世界写入/消息/结算一律延迟到 `system.run`(见 `docs/lessons.md` §1.1);
- **虚化方块生命周期**:回合开始 → 最老棋子所在格直接替换为虚化方块;本回合落子完成后 → 该格置空(`minecraft:air`),对手回合即可落子;
- **落子放行**:校验通过时返回 `true`,由引擎写入棋子方块并消耗手中物品;超时随机落子走脚本路径(自行写方块);
- **棋盘保护**:`canBreak` 恒为 `false`(棋子与棋盘不可破坏),`canPlace` 只放行 3×3 棋盘层 +1 的合法空格;
- **场地重置**:`onBeforeReset` 与 `onRoomReset` 都显式清空棋子层,避免模板捕获时把棋子/虚化方块一起复制。

详细规范见仓库根目录 [development.md](../development.md) 与 [docs/lessons.md](../docs/lessons.md)。
