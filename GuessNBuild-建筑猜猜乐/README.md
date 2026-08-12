# 建筑猜猜乐(GuessNBuild)

Bearcade 小游戏包。房间管理复用 `shared/minigame-core`,玩法在 [src/game.ts](src/game.ts) 的 `makeGameHooks` 中实现。

## 开发流程

1. 在 [src/config.ts](src/config.ts) 里确认游戏 ID(`guessnbuild`)、房间数、最大人数;
2. `npm run build && npm run deploy`,进游戏 `/reload`;
3. `/bearcade:tmp tp guessnbuild` 进入模板维度建场地;
4. 建好后填写 `TEMPLATE_FROM/TO`、`ROOM_COPY_ORIGIN`、`PREP_SPAWN`、`TICKING_FROM/TO`(或 `/bearcade:tmp sz guessnbuild` 表单配置);
5. `/bearcade:tmp ap guessnbuild` 应用到全部房间;
6. 在 `src/game.ts` 实现玩法,`/bearcade:quit guessnbuild` 可强制中止测试。

详细规范见仓库根目录 [development.md](../development.md)。
