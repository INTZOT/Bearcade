# Doublecheck spec

## Goal
PigCatcher 猪猪争夺战玩法完整实现:红黄蓝绿四队用钓鱼竿/胡萝卜钓竿/拴绳把中立猪赶进自家核心区,5 分钟后按核心区猪数结算,typecheck 与 build 通过。

## Scope
改写 PigCatcher-猪猪争夺战/src/game.ts(队伍/猪/道具/计分/结算/事件装配,initPigCatcher 模式同 BridgeWar)、src/config.ts(四队颜色与名称、出生点/核心区/地图边界/猪刷新点坐标占位、PigConfig 运行时默认值、GAME_DURATION_TICKS/PIG_CAP/PIG_RESPAWN_INTERVAL)、新建 src/pigcatcher-config.ts(loadGameConfig/saveGameConfig + openConfig 菜单)、src/main.ts(worldLoad 同步配置并调 initPigCatcher)。不触碰 shared/、Core 与其他游戏包;不新增实体定义文件。

## Acceptance criteria
① npm run typecheck 零错误、npm run build 成功;② 开局:4~16 名玩家随机均分红/黄/蓝/绿四队,名字按队染色(nameTag+chatNamePrefix),发放钓鱼竿+胡萝卜钓竿+拴绳×3,传送至各队出生点,死亡在队出生点复活并重新发放道具;③ 猪:开局一次性补足 10 只中立猪于场地中心(±3 随机偏移),之后每 20 秒补足到 10;猪不越界(出地图边界或 y<-30 传送回中心)、不可被伤害/击杀(entityHurt 一律取消);④ 归属与计分:每 tick 按猪所在核心区实时归属,侧边栏显示四队猪数(Descending),actionbar 显示队名/剩余时间/四队猪数;⑤ 结算:5 分钟到(6000 tick)按核心区猪数判定,最高分并列获胜并公告各队猪数,若全 0 则平局,随后 endGame 回大厅;⑥ 三种道具生效:胡萝卜钓竿靠原版跟随,拴绳靠原版拴绳,钓鱼竿靠脚本(entityHitEntity 钩到猪→applyImpulse 拉向持竿玩家,itemUse 兜底近距牵引);⑦ PVP:异队可互伤、同队免伤(entityHurt 取消),猪不受任何伤害;⑧ 清理:onBeforeReset 清掉房间全部猪、清背包、还原名字、移除计分板目标与会话;任何一队无人时提前结束。

## Failure modes
玩家中途退出使总人数低于 4:运行时状态机自动结束对局;某一队全退出:对局 tick 检测到即提前结束并公告;猪掉虚空/出边界:每 tick 检测后传送回中心刷新点;钓鱼钩无 owner 信息(API 无 owner 属性):回退为钩中时取 15 格内最近持竿玩家,再回退 itemUse 近距牵引,保证道具始终可用;猪被拴绳拴住时边界回拉会与玩家拉扯:拴住的猪跳过边界回拉(leashable 组件存在时检查 leashHolder);计分板多房间冲突:沿用全局侧边栏已知限制(单房间测试优先);运行时配置 JSON 损坏:configStore 回退代码默认值;实体残留:onBeforeReset 全量移除本房间 pig 实体。

## Priorities
先跑通核心闭环(分队→刷猪→道具捕猪→按位置计分→计时结算→清理);道具手感(拉力/钩中力度)先给合理初值,游戏内再调;所有规则数值(时长/猪上限/刷新间隔)做成 /bearcade:config 运行时可改;单房间测试优先(侧边栏全局槽已知限制);配置界面覆盖全部坐标与数值项。

## Non-goals
不做场地编辑器(用 /bearcade:tmp 系列命令建场地,坐标默认占位);不新增自定义实体/物品(猪用原版 minecraft:pig,道具用原版三件);不做猪"定居"逻辑(用户明确选择完全自由走动、归属按位置判定);不做加时赛(平局并列);不给玩家发放武器(纯道具对抗);不修改 shared/minigame-core、Core 或既有游戏包;不部署、不提交 git。
