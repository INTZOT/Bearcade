# 五子棋(Gomoku)

Bearcade 小游戏包:放置压力板在棋盘上落子,五连获胜。房间管理复用 `shared/minigame-core`,玩法在 [src/gomoku.ts](src/gomoku.ts)。

## 已确认规则

- 每房 2 人(黑/白),8 个房间,不支持派对模式;
- 开局随机决定黑/白方,黑方先手;
- 落子方式:在棋盘格上放置压力板——黑方 `polished_blackstone_pressure_plate`、白方 `heavy_weighted_pressure_plate`(默认 15×15 棋盘,棋子位于 `boardY + 1` 层);
- 每回合只发给当前玩家一颗对应棋子,轮到谁发给谁;背包满时自动腾出空格保证棋子能放入;
- 横/竖/两斜任一方向五连即获胜;棋盘下满无五连则平局,对局结束返回大厅;
- 放置校验(脚本 `canPlace` 钩子):必须落在棋盘格内、空格、自己回合、且放置对应颜色棋子,否则拒绝并提示;
- 对局内显式切换生存模式(大厅为冒险模式,冒险下无法放置);对局结束/强制中止时恢复冒险模式,并清空双方棋子;
- 配置经 `/bearcade:config gomoku`(对局中禁止):准备房间坐标、棋盘位置(棋盘 Y 与 x/z 范围,跨度 ≤64)、黑/白方开局坐标;代码默认值在 `src/config.ts`。

## 场地制作

棋盘场地在模板维度 `bearcade:gomoku_template` 制作(默认:15×15 棋盘格位于 y 63~64,准备房间位于 y 0,范围 ±8):

1. `/bearcade:tmp tp gomoku` 进入模板维度;
2. 按 `src/config.ts` 坐标建造棋盘底座(棋盘格朝上,棋子落在 `BOARD_Y + 1` 层);
3. `/bearcade:tmp sz gomoku` 配置模板捕获范围,`/bearcade:tmp ap gomoku` 应用到全部房间;
4. 与棋盘相关坐标若调整,用 `/bearcade:config gomoku` 同步修改。

> 结构上限 64×384×64;常加载区域只需覆盖准备房间与棋盘层(y -1~65),不要整列 384 层。

## 常用命令

- `/bearcade:tmp tp gomoku` / `sz` / `ap`:模板维度开发;
- `/bearcade:config gomoku`:棋盘与坐标配置(对局中禁止);
- `/bearcade:quit`:在房间维度执行,强制中止对局;
- `/bearcade:debug gomoku enable|disable`:调试日志。

详细规范见仓库根目录 `development.md`。
