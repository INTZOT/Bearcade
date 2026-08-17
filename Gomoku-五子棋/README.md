# 五子棋(Gomoku)

Bearcade 小游戏包:放置自定义棋子方块在棋盘上落子,五连获胜。房间管理复用 `shared/minigame-core`,玩法在 [src/gomoku.ts](src/gomoku.ts)。

## 已确认规则

- 每房 2 人(黑/白),8 个房间,不支持派对模式;
- 开局随机决定黑/白方,黑方先手;
- 落子方式:在棋盘格上放置自定义棋子方块——黑方 `bearcade:black_stone`、白方 `bearcade:white_stone`(默认 15×15 棋盘,棋子位于 `boardY + 1` 层);棋子为不完整方块,已剔除碰撞箱,玩家可自由走过;
- 每回合只发给当前玩家一颗对应棋子,轮到谁发给谁;背包满时自动腾出空格保证棋子能放入;
- 横/竖/两斜任一方向五连即获胜;棋盘下满无五连则平局,对局结束返回大厅;
- 放置校验(脚本 `canPlace` 钩子):必须落在棋盘格内、空格、自己回合、且放置对应颜色棋子,否则拒绝并提示;
- 对局内显式切换生存模式(大厅为冒险模式,冒险下无法放置);对局结束/强制中止时恢复冒险模式,并清空双方棋子;
- **俯瞰视角**:开局发放槽位锁定的望远镜,对局中使用望远镜在棋盘正上方俯瞰视角与普通视角间切换——原生 `minecraft:free` 相机定位到棋盘中心正上方 `boardY + 1 + overviewHeight`(高度可配置);进入俯瞰时激活 **aim assist**(数据驱动预设 `Cameras/Presets/aim_assist_preset.json` + `categories.json`,只锁定棋盘/棋子方块、最近优先、全向锥),本体视线虽强制水平,**手持棋子 use(右键)会直接落到 aim assist 锁定的脚下棋盘格**(引擎原生放置,自动消耗棋子);aim assist 未加载时回退为脚本落子(canPlace/itemUse/itemStartUseOn 多事件源 + 同 tick 去重);
- 配置经 `/bearcade:config gomoku`(对局中禁止):准备房间坐标、棋盘位置(棋盘 Y 与 x/z 范围,跨度 ≤64)、黑/白方开局坐标、俯瞰视角高度(5~64 格);代码默认值在 `src/config.ts`。

## 场地制作

棋盘场地在模板维度 `bearcade:gomoku_template` 制作(默认:15×15 棋盘格位于 y 63~64,准备房间位于 y 0,范围 ±8):

1. `/bearcade:tmp tp gomoku` 进入模板维度;
2. 按 `src/config.ts` 坐标建造棋盘底座(棋盘格朝上,棋子落在 `BOARD_Y + 1` 层);
3. `/bearcade:tmp sz gomoku` 配置模板捕获范围,`/bearcade:tmp ap gomoku` 应用到全部房间;
4. 与棋盘相关坐标若调整,用 `/bearcade:config gomoku` 同步修改。

> 结构上限 64×384×64;常加载区域只需覆盖准备房间与棋盘层(y -1~65),不要整列 384 层。

## 自定义方块

棋盘与棋子为自定义方块:行为包定义在 `blocks/`,资源包(贴图/模型)在 `resource-pack/`(`npm run deploy` 随行为包一并部署到 `development_resource_packs`,一对一配对):

| 方块 | ID | 说明 |
| --- | --- | --- |
| 棋盘(空白) | `bearcade:chestboard_blank` | 完整方块,棋盘内部格 |
| 棋盘(中心) | `bearcade:chestboard_center` | 完整方块,棋盘中心格 |
| 棋盘(边) | `bearcade:chestboard_side` | 完整方块,**4 朝向**(`minecraft:transformation` 旋转,放置时面向玩家) |
| 棋盘(角) | `bearcade:chestboard_corner` | 完整方块,**4 朝向** |
| 黑子 | `bearcade:black_stone` | 不完整方块,碰撞箱已剔除(选择箱为贴地矮盒) |
| 白子 | `bearcade:white_stone` | 同上 |

- 模型:棋盘共用 `geometry.chestboard`(全尺寸立方体;贴图 32×32,左下象限为顶面);棋子 `geometry.black_stones`/`geometry.white_stones`(逐像素堆叠圆片);
- 建模源文件:`D:\Files\Pictures\建模\Gomoku-五子棋`(六个方块各一目录,ID 标注在文件名);
- 改贴图/模型后无需改代码,重新 `npm run build && npm run deploy` 并完整重启游戏生效。

## 常用命令

- `/bearcade:tmp tp gomoku` / `sz` / `ap`:模板维度开发;
- `/bearcade:config gomoku`:棋盘与坐标配置(对局中禁止);
- `/bearcade:quit`:在房间维度执行,强制中止对局;
- `/bearcade:debug gomoku enable|disable`:调试日志。

详细规范见仓库根目录 `development.md`。
