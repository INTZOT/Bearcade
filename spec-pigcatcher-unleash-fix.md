# Doublecheck spec

## Goal
将鱼钩解拴检测从"猪侧 1.5 格轮询"改为"鱼钩侧最近猪 + 连续两轮一致性",消除波及相邻猪的误解拴。

## Scope
仅修改 PigCatcher-猪猪争夺战/src/game.ts(替换轮询块为鱼钩侧一致性判定 + hookTargets 表),重新构建并部署 pigcatcher。

## Acceptance criteria
① 移除"按猪找鱼钩"的轮询块,改为"按鱼钩找最近猪":遍历房间内 minecraft:fishing_hook 实体,以 hook.location 为中心 1.5 格查询最近 pig(closest:1);② 连续两轮(约1秒)同一鱼钩指向同一只猪才算钩中,才执行 unleash(被拴住时);未连续指向或未拴住则不解;③ hookTargets 映射表(hookId→pigId)管理,房间内无鱼钩时清空;④ dbg 日志保留;⑤ typecheck/build 通过并重新部署 pigcatcher。

## Failure modes
鱼钩路过(擦边)→ 最近猪会变化或消失,两轮连续性不满足,不误解;两猪重叠时钩子取中心更近的一只→ 只解一只,不波及;钩子挂在猪上但猪移动→ 钩跟随猪,连续性保持;unleash 抛错→ try/catch;hookTargets 残留→ 无鱼钩时清空。

## Priorities
误伤率最低优先(一致性判定);实现保持轻量(hookTargets 单表);保留 dbg 诊断。

## Non-goals
不缩小解拴半径以外的规则;不改原版拉扯;不修改其他包。
