# 围棋(Go)

Bearcade 小游戏包:19×19 围棋,黑先手,提子/劫/计时/计目,丢出棋子物品即认输。房间管理复用 `shared/minigame-core`,玩法在 [src/game.ts](src/game.ts)。

## 已确认规则

- 每房 2 人(黑/白),8 个房间,不支持派对模式;
- **落子**:放置自定义棋子方块——黑方 `bearcade:go_black_stone`、白方 `bearcade:go_white_stone`(棋子位于 `boardY + 1` 层);黑先手;
- **提子**:落子后先提对方无气连通组(棋盘与方块同步移除),再检查自杀——禁着点(自杀)会被拒绝;
- **劫**:上一步单子被提的交叉点禁落(简单劫);
- **停一手**:开局发放纸张(槽位锁定),**使用纸张**即停一手(仅轮到你时有效),双方连续停手 → 终局;
- **计目**:领地(单色完全包围的空域)+ 提子数,黑贴 5.5 目(可配置);空域同时邻接双方不计;
- **计时**:每方 60 分钟局时(可配置),当前玩家计时,超时判负;
- **认输**:当前持棋玩家**丢弃手中的棋子物品**即认输;离开房间/断线视为认输(断线=退出契约);
- **俯瞰视角**:开局发放槽位锁定的望远镜,对局中使用望远镜在棋盘正上方俯瞰视角与普通视角间切换——原生 `minecraft:free` 相机定位到棋盘中心正上方 `boardY + 1 + overviewHeight`(高度可配置);俯瞰中本体视线强制水平(控制方案特性),**手持棋子 use(右键)= 在自己脚下最近的交叉点落子**(引擎落点被取消,由脚本放置并扣减棋子;canPlace/itemUse/itemUseOn 多事件源统一入口,同 tick 去重);
- 配置经 `/bearcade:config go`(对局中禁止):准备房间坐标、棋盘位置、黑/白方开局坐标、黑贴目、每方局时、俯瞰视角高度(5~64 格)。

## 场地制作

棋盘场地在模板维度 `bearcade:go_template` 制作(默认:19×19 棋盘格位于 y 63~64,坐标范围 ±9,准备房间位于 y 0,范围 ±10):

1. `/bearcade:tmp tp go` 进入模板维度;
2. 用棋盘方块铺 19×19 棋盘:`bearcade:go_chestboard_blank`(内部格)+ **9 个星位** `bearcade:go_chestboard_center_point`(天元与四星,坐标为 (-6,-6),(-6,0),(-6,6),(0,-6),(0,0),(0,6),(6,-6),(6,0),(6,6))+ 四周 `go_chestboard_side/corner` 包边(边/角放置时注意朝向);
3. `/bearcade:tmp sz go` 配置模板捕获范围,`/bearcade:tmp ap go` 应用到全部房间;
4. 坐标若有调整,用 `/bearcade:config go` 同步。

> 结构上限 64×384×64;常加载区域只需覆盖准备房间与棋盘层(y -1~65),不要整列 384 层。

## 自定义方块

棋盘与棋子为自包含复制的自定义方块(`bearcade:go_*` 标识符,与五子棋包互不冲突):

| 方块 | ID |
| --- | --- |
| 棋盘 空白/中心/星位 | `bearcade:go_chestboard_blank` / `_center` / `_center_point` |
| 棋盘 边/角(4 朝向) | `bearcade:go_chestboard_side` / `_corner` |
| 黑子/白子 | `bearcade:go_black_stone` / `go_white_stone` |

- 行为包定义在 `blocks/`,资源包(贴图/模型)在 `resource-pack/`(随 deploy 一并部署,`Go-围棋-资源包`);
- 棋子为不完整方块(无碰撞箱),手持由 `item_visual` 渲染居中 3D 模型(需世界实验开关 "Upcoming Creator Features"),放置后贴地平放。

## 常用命令

- `/bearcade:tmp tp go` / `sz` / `ap`:模板维度开发;
- `/bearcade:config go`:规则与坐标配置(对局中禁止);
- `/bearcade:quit`:在房间维度执行,强制中止对局;
- `/bearcade:debug go enable|disable`:调试日志。

详细规范见仓库根目录 `development.md`。
