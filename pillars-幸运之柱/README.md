# 幸运之柱(Pillars of Fortune)

Bearcade 小游戏包:**双环基岩柱大乱斗,随机物品生存战**。房间管理复用 `shared/minigame-core`,玩法在 [src/game.ts](src/game.ts)。

## 玩法规则

- **人数/房间**:2~20 人 / 4 房,不支持派对模式;
- **地图**:两个同心圆环上均匀分布 20 根基岩柱(默认内环 10 根 + 外环 10 根),柱顶单格站立;下方是草方块地面,柱高默认 35 格,从柱顶坠落基本必死;
- **等候点**:玩家在 `(0,1,0)` 等候,不额外生成石头平台;
- **边界**:地图外 5 格为限制边界,玩家越界会被传送回进入前的位置;边界禁止区以外均可放置/破坏方块;
- **限高**:`y >= 50` 或 `y < 0`（即 y=-1 及以下）禁止放置方块(可进入,只是不能搭建),数值可通过 `/bearcade:config pillars` 调整;
- **随机物品**:每 5 秒给所有存活玩家随机发放一件物品,尽量不重复;物品直接进背包,背包满则本次不获得,有空位后继续获得;
- **物品池**:MC 全部常规物品(不含命令方块、屏障等管理/调试方块,但包含末地传送门等),每次发放数量固定 1 个;
- **开局倒计时**:开局有 3 秒 title 倒计时,期间玩家不能移动,防止误触;局内剩余时间以“倒计时 mm:ss”显示在屏幕下方居中 actionbar;
- **刷怪蛋**:使用刷怪蛋生成的生物击杀玩家时,击杀数记在刷怪蛋使用者名下;
- **胜负**:
  - 5 分钟内最后存活者为第一名;
  - 5 分钟到时仍有 ≥2 人存活,则击杀数最高者为第一名;击杀数相同则并列第一;
  - 死亡后进入旁观模式,可自行 `/bearcade:lobby` 返回大厅;退出/断线视为淘汰。

## 配置

重要数值已接入 `/bearcade:config pillars`(对局中禁止修改),持久化优先于代码默认值:

- 游戏时长(默认 300 秒)
- 发物品间隔(默认 5 秒)
- 内环/外环柱子数(默认 10/10)
- 内环/外环半径(默认 8/13)
- 柱子高度(默认 35)
- 地面 Y(默认 0)
- 搭建高度上限(默认 50)
- 搭建高度下限(默认 0)

## 地图生成(首次必做)

游戏对局中**不再自动生成地图**;地图需要先在模板维度生成一次,再由共享运行时复制到各房间。

1. 进入模板维度:`/bearcade:tmp tp pillars`;
2. 执行地图生成命令(管理员):`/bearcade:pillars_buildmap`;
3. 可选:用 `/structure save pillars_map <起点> <终点>` 导出 `.mcstructure` 文件;
4. 应用地图到全部房间:`/bearcade:tmp ap pillars`;
5. 之后即可正常游玩。

## 开发/部署

1. `npm run typecheck && npm run build && npm run package`;
2. `npm run deploy pillars`;
3. 进世界 `/reload`,大厅钟菜单选择“幸运之柱”;
4. 需要调参用 `/bearcade:config pillars`。

> 进入模板维度/应用模板/强制中止命令由 **Core 统一提供**:`/bearcade:tmp tp|ap|sz pillars`、`/bearcade:quit`(在对应房间维度执行),小游戏包无需自己注册命令。

## 常用命令

- `/bearcade:config pillars`:运行时配置;
- `/bearcade:pillars_buildmap`:在模板维度生成地图(管理员);
- `/bearcade:quit`:在房间维度执行,强制中止对局;
- `/bearcade:debug pillars enable|disable`:调试日志;
- `/bearcade:lobby`:任意维度返回大厅。

## 常见坑

- 自定义命令回调运行在 restricted execution 模式,原生调用(传送/表单)必须经 `system.run` 延迟;
- `Dimension.id` 返回完整命名空间 ID(主世界为 `minecraft:overworld`);
- 结构引擎上限 64×384×64;常加载区域必须覆盖高空柱顶;
- 每包常加载 chunk 有上限,常加载区域只覆盖实际内容;
- DDUI 按钮文本不解析 `§` 颜色码,label 可以。

详细规范见仓库根目录 `development.md`。
