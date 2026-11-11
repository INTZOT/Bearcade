# 剑与消亡V(SND5)

Bearcade 小游戏包(7 职业 PvP:剑与消亡V · 上密会战)。房间管理复用 `shared/minigame-core`;**战斗框架层已就绪**,内容层(职业/技能/状态定义)与对局层(职业选择/计分规则/占点坐标)待实现。

## 当前状态

- 基础设施已就绪:房间/模板维度注册(startup 阶段)、模板捕获 → 复制 → 常加载、`game.register` / `room.status` 上报与 5 秒心跳、对局状态机(空闲 → 倒计时 → 运行 → 结算 → 重置)、房间保护、结束回大厅、强制中断;
- **框架层就绪**(`src/framework/`,详见《SND5 架构设计》文档):
  - `session.ts` MatchSession 聚合根 —— 多房间并发,事件订阅/定时器/创生物随会话全量回收;
  - `attribute.ts` 三资源账本(HP/护甲/魔力/临时护甲,比例映射原版血条,快照恢复);
  - `status/` 状态系统(叠层/互斥/进化/modifiers 聚合/收束拦截标志位);
  - `combat/` 六阶段伤害管线(元素×状态反应表、真实伤害、致死拦截、击杀归属);
  - `skill/` 技能调度(instant/charge/windup/channel 四种施法模式、四段式冷却、堆叠串联、被动=事件订阅者、效果原语 Primitives);
  - `summon.ts` 创生物系统(实体承载 + tag 清扫,投掷物命中转发);
  - `score.ts` / `capture.ts` / `supply.ts` 分数制胜负 / 占点 AABB 计数 / 补给站 20s 限频;
  - `hud.ts` 右侧面板 HUD(比分/三资源/冷却/占点,title 通道渲染);
- 原生事件适配在 [src/listeners.ts](src/listeners.ts):原版伤害拦截(数值全部走 CombatPipeline)、物品输入路由(`skillItemBindings` 由内容层填充)、补给站交互、离线/原版死亡兜底;
- 房间数 `ROOM_COUNT`、最大人数 `MAX_PLAYERS` 暂用模板默认值(2 房 / 2 人),按 4v4 玩法调整;
- 场地坐标全为占位,待模板维度建好场地后填写(见下方开发流程)。

## 下一步(内容层/对局层)

1. 职业定义:7 职业面板 + 技能(`skillRegistry.register`)+ 状态(`statusRegistry.register`)+ 反应表(`reactionTable.add`);
2. `game.ts` 注入点替换:`loadoutFor`(职业装载)、`weaponAttack`(武器结算)、`onSessionStart`(发武器/消耗品)、职业选择 UI;
3. `buildContentBundle()` 换入计分规则表 / 占点区域 / 补给站坐标(7 个:5 内圈 + 2 外围);
4. 元素反应的追加伤害/状态在反应表 build 中用 session 门面实现。

## 开发流程

1. `/bearcade:tmp tp snd5` 进入模板维度建场地;
2. 模板范围用 `/bearcade:tmp sz snd5` 表单配置起始点/终点;
3. 场地改好后 `/bearcade:tmp ap snd5` 一键应用到全部房间;
4. 在 [src/config.ts](src/config.ts) 填写坐标(模板范围、复制原点、准备房间、常加载区域);
5. 按「下一步」实现内容层与对局层;
6. `npm run typecheck && npm run build && npm run package`。

> 进入模板维度/应用模板/强制中止命令由 **Core 统一提供**:`/bearcade:tmp tp|ap|sz snd5`、`/bearcade:quit`(在对应房间维度执行),小游戏包无需自己注册命令。

## 常见坑

- 自定义命令回调运行在 restricted execution 模式,原生调用(传送/表单)必须经 `system.run` 延迟;
- `entityHurt` 前事件只允许同步取消,伤害数值在 `system.run` 里经 CombatPipeline 写入;
- `Dimension.spawnEntity` 的 typings 只接受原版实体标识,自定义实体 id(`snd5:xxx`)需显式转换(见 `framework/summon.ts`);
- 内容层禁止 import `@minecraft/server`,只能通过 `ctx.primitives` / session 门面执行动作;
- `Dimension.id` 返回完整命名空间 ID(主世界为 `minecraft:overworld`);
- 结构引擎上限 64×384×64,纵向取满为 y -64~319;
- 每包常加载 chunk 有上限,常加载区域只覆盖实际内容;
- DDUI 按钮文本不解析 `§` 颜色码,label 可以。

详细规范见仓库根目录 `development.md`;架构设计见《SND5 附加包架构设计》文档(含 Bearcade 适配修订)。
