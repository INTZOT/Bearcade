# 饥饿游戏(HungerGame)

Bearcade 小游戏包:**骨架阶段**——房间/模板维度注册与空钩子已就位,玩法流程与实现思路待定。房间管理复用 `shared/minigame-core`,玩法在 [src/game.ts](src/game.ts)。

## 当前状态

- **每房 4~16 人,共 2 个房间,支持派对模式**(派对下人数可超 16,出生点循环分配);
- 已接入 Core 注册、准备房间、模板捕获/应用、`/bearcade:config hungergame`(目前仅准备房间坐标 + 恢复默认);
- 模板结构 `bearcade:hungergame_room`,默认范围 ±16(占位,按实际场地调整;横向超 64 时在 main.ts 配置 `tileSize` 自动分块)。

## 待定(与用户讨论后填充)

- [ ] 玩法流程(出生/倒计时/装备/道具/淘汰/胜负)
- [ ] 场地制作(模板维度 `bearcade:hungergame_template`,`/bearcade:tmp tp hungergame`)
- [ ] 可配置项(时长、出生点、道具参数等)
- [ ] 对局状态机与事件监听(伤害/死亡/交互/区域)

## 常用命令

- `/bearcade:tmp tp hungergame` / `sz` / `ap`:模板维度开发;
- `/bearcade:config hungergame`:运行时配置;
- `/bearcade:quit`:在房间维度执行,强制中止对局。

详细规范见仓库根目录 `development.md`。
