# Doublecheck spec

## Goal
战桥与猪猪争夺战在游戏结束(onBeforeReset)时重置玩家重生点,避免对局内设置的队伍出生点重生点泄漏到结束后。

## Scope
BridgeWar-急速战桥/src/game.ts 与 PigCatcher-猪猪争夺战/src/game.ts 的 onBeforeReset 各加一行 spawn 重置;重新构建并部署两个包。

## Acceptance criteria
① BridgeWar-急速战桥/src/game.ts 与 PigCatcher-猪猪争夺战/src/game.ts 的 onBeforeReset 中对每位在场玩家执行 player.setSpawnPoint(undefined) 清除对局内设置的重生点(包裹 try/catch);② 游戏结束后玩家重生点回默认(世界出生点/大厅),不再在旧房间维度队伍出生点复活;③ typecheck/build 通过,重新部署 bridgewar 与 pigcatcher。

## Failure modes
setSpawnPoint(undefined) 抛错(极端情况)→ try/catch 吞掉不影响重置流程;玩家中途离场已在房外→ onBeforeReset 只处理在场玩家,离场玩家 spawn 本就不受影响;清理顺序:先清 spawn 再传送回大厅(finishReset 中 onBeforeReset 先于传送执行,符合预期)。

## Priorities
最小改动(每个包一处 try/catch);与既有重置流程顺序兼容。

## Non-goals
不修改 Core 与其他包;不动对局内 setSpawnPoint 的既有设置逻辑;不做重生点持久化。
