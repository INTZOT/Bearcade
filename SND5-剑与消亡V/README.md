# 剑与消亡V(SND5)

Bearcade 小游戏包(骨架阶段,**玩法待定**)。房间管理复用 `shared/minigame-core`,玩法在 [src/game.ts](src/game.ts) 的 `TODO` 处实现。

## 当前状态

- 基础设施已就绪:房间/模板维度注册(startup 阶段)、模板捕获 → 复制 → 常加载、`game.register` / `room.status` 上报与 5 秒心跳、对局状态机(空闲 → 倒计时 → 运行 → 结算 → 重置)、房间保护、结束回大厅、强制中断;
- 房间数 `ROOM_COUNT`、最大人数 `MAX_PLAYERS`、派对可用性 `PARTY_AVAILABLE` 等暂用模板默认值(2 房 / 2 人),等玩法确认后再调整;
- 场地坐标全为占位,待模板维度建好场地后填写(见下方开发流程)。

## 开发流程

1. `/bearcade:tmp tp snd5` 进入模板维度建场地;
2. 模板范围用 `/bearcade:tmp sz snd5` 表单配置起始点/终点;
3. 场地改好后 `/bearcade:tmp ap snd5` 一键应用到全部房间;
4. 在 [src/config.ts](src/config.ts) 填写坐标(模板范围、复制原点、准备房间、常加载区域);
5. 玩法确认后在 [src/game.ts](src/game.ts) 的 `TODO` 处实现;
6. `npm run typecheck && npm run build && npm run package`。

> 进入模板维度/应用模板/强制中止命令由 **Core 统一提供**:`/bearcade:tmp tp|ap|sz snd5`、`/bearcade:quit`(在对应房间维度执行),小游戏包无需自己注册命令。

## 常见坑

- 自定义命令回调运行在 restricted execution 模式,原生调用(传送/表单)必须经 `system.run` 延迟;
- `Dimension.id` 返回完整命名空间 ID(主世界为 `minecraft:overworld`);
- 结构引擎上限 64×384×64,纵向取满为 y -64~319;
- 每包常加载 chunk 有上限,常加载区域只覆盖实际内容;
- DDUI 按钮文本不解析 `§` 颜色码,label 可以。

详细规范见仓库根目录 `development.md`。
