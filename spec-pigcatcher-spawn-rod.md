# Doublecheck spec

## Goal
PigCatcher 三项调整:去除猪刷新上限(改为初始数量+周期批量补充)、删除脚本版钓鱼竿拉扯(只留原版行为)、新增钓鱼竿钩中猪解除拴绳。

## Scope
PigCatcher-猪猪争夺战:config.ts(常量与 PigConfig/默认值)、pigcatcher-config.ts(配置菜单两项替换)、game.ts(初始生成/周期补充/entityHitEntity 改为解除拴绳/删除 itemUse 与 reels 与 nearestRodHolder 与主循环 reel 块)。重新构建并部署 pigcatcher。

## Acceptance criteria
① 猪刷新:移除上限概念——开局生成 PIG_INITIAL_COUNT(默认5)只,每 pigRespawnIntervalTicks(20s)补充 PIG_SPAWN_BATCH(默认1)只,不再检查上限;② 钓鱼竿脚本拉扯全部移除:entityHitEntity 不再 applyPull/登记 reels,itemUse 近距牵引兜底删除,reels 表与 nearestRodHolder 删除,主循环 reel 牵引块删除;拉扯只剩原版行为;③ 新增:钓鱼竿钩中猪(房间内、对局中)→ 若猪被拴住(leashable.isLeashed)则 unleash() 解除拴绳;④ /bearcade:config 界面:猪猪上限条目改为"初始猪数(0-20)"与"每次刷新数量(1-10)";⑤ typecheck/build 通过并重新部署 pigcatcher。

## Failure modes
applyPull 仍被引力场使用→ 保留该函数与 PIG_PULL 无关参数,只删钓鱼竿相关调用;unleash 抛错(实体已移除/非受限上下文)→ try/catch;配置里旧 pigCap 持久化数据残留→ loadGameConfig 合并时旧字段被忽略(类型中已无该字段);引力场与拴绳逻辑不受影响。

## Priorities
先移除上限与脚本拉扯(删除干净无死代码);再接解除拴绳;参数全部进 /bearcade:config 可调。

## Non-goals
不新增猪数硬上限(用户明确去除);不改引力场、边界救援、计分结算等其余逻辑;不修改其他包。
