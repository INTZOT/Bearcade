# Doublecheck spec

## Goal
从 Template-小游戏模板 复制出 PigCatcher-猪猪争夺战 骨架包并注册进 Bearcade 构建系统,typecheck 与 build 均通过,不实现任何玩法。

## Scope
新建 PigCatcher-猪猪争夺战/src/{config.ts,game.ts,main.ts}(mygame→pigcatcher 全局替换、新 PACK_ID);config/packs.json 增加 pigcatcher 条目(新 header/module UUID、packDependencies:["core"]、minEngineVersion [1,26,40]);tsconfig.json include 增加新目录。占位参数:ROOM_COUNT=2、MAX_PLAYERS=16、minPlayers=4、PARTY_AVAILABLE=true,坐标全部保留模板占位。不触碰 shared/minigame-core、Core 与其他游戏包。

## Acceptance criteria
① npm run typecheck 零错误;② npm run build 成功,生成 PigCatcher-猪猪争夺战/manifest.json 与 scripts/main.js(均被 gitignore);③ packs.json 含 pigcatcher 条目且 packDependencies 引用 core 存在;④ manifest header UUID 与 config.ts 的 PACK_ID 一致(891f4267-9bcd-4eb4-b207-8b9fb2d179e1);⑤ git status 只新增 PigCatcher 源文件与 packs.json/tsconfig.json 修改,无构建产物入库。

## Failure modes
UUID 冲突:本次已新生成 header/module UUID,构建后与现有包不重复;游戏 ID 非法:用全小写 pigcatcher,维度名 bearcade:pigcatcher_n/_template 合法;tsconfig 漏 include:已把新目录加入,typecheck 会覆盖新包;build 报错(如 packs.json 语法错):修到 build 通过为止,不留半成品条目;构建产物误入库:*.manifest.json 与 */scripts/ 已 gitignore,提交前用 git status 复核。

## Priorities
骨架与模板对齐、最小改动优先;占位参数用用户给定值(2 房/16 人/4 人开局/派对 true);先保证 typecheck 通过,再保证 build 通过;不部署、不提交 git(用户明确只 typecheck+build)。

## Non-goals
不实现猪猪争夺战玩法流程(用户稍后单独提供);不填写真实场地坐标与开局站位;不部署到开发行为包目录;不提交或推送 git;不修改 shared/minigame-core、Core 或既有游戏包;不接运行时配置界面(openConfig)与调试日志,玩法确定后再说。
