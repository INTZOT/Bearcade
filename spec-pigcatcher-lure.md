# Doublecheck spec

## Goal
在 PigCatcher 各队核心区实现脚本版"模拟手持胡萝卜的隐形人"引力场:半径内未被拴住的猪被温和拉向核心区中心,参数可配置,typecheck/build 通过。

## Scope
改动仅 PigCatcher-猪猪争夺战:src/config.ts 增加 LURE_RADIUS/LURE_STRENGTH 常量与 PigConfig.lureRadius/lureStrength 字段及默认值;src/game.ts 对局 tick 循环中按核心区中心距离施加牵引(未拴住时);src/pigcatcher-config.ts 增加两个配置菜单项(半径整数、强度×100整数换算)。

## Acceptance criteria
① 对局运行期间,每个核心区中心存在持续"吸引场":距离中心 ≤ lureRadius(默认 6 格)且未被拴绳拴住的猪,每 tick 受到朝向中心、强度 lureStrength(默认 0.15)的冲量(复用 applyPull);② 被拴绳拴住的猪不受引力场影响;③ 参数进 /bearcade:config pigcatcher 配置界面:吸引半径(1~16 格整数)与吸引强度(1~100,存为 /100);④ 引力场弱于钓鱼竿牵引(0.45)与钩中强拉(1.8),偷猪依旧可行;⑤ npm run typecheck 与 npm run build 通过。

## Failure modes
引力太强导致偷猪不可行:强度默认 0.15 且可配置,实测可下调;猪被拴绳拖拽时被引力场对抗:isLeashed 跳过;多个核心区同时覆盖一只猪(场区重叠):取 TEAMS 顺序第一个命中的核心区;配置 JSON 存了浮点强度:持久化直接用数值(JSON 支持),表单用 ×100 整数换算避免小数输入;边界回拉与引力场同时触发:二者都是 applyPull 类冲量,叠加后方向冲突时以较大者为主,属预期。

## Priorities
复用现有 applyPull 与 isLeashed,改动最小;引力必须明显弱于主动捕捉手段(钓鱼竿/拴绳/原版诱惑),保证"偷猪"玩法不被破坏;默认值 半径6/强度0.15,全部可运行时配置。

## Non-goals
不伪造实体/不改原版猪 AI 定义(tempt 只认真实玩家,不做假玩家实体);不做粒子特效(留作后续可选);不调整钓鱼竿/拴绳既有逻辑;不修改 shared/minigame-core、Core 与其他游戏包。
