# 建筑猜猜乐(GuessNBuild)

Bearcade 小游戏包,**第一版已可运行**。房间管理复用 `shared/minigame-core`,玩法在 [src/game.ts](src/game.ts) 的 `makeGameHooks` 中实现。

## 已实现

- 3~16 人,最小 3 人开局;满足最小人数后默认 60 秒倒计时(调试开启时 10 秒),满员压至 5 秒;
- 每回合随机抽题(不连续重复),建筑者(创造模式)获知完整答案并建造,猜测者(旁观模式)看到字数提示并在聊天栏答题;
- 答对:猜对者 +2、建筑者 +1,回合结束并播报;答错消息照常广播;超时或建筑者离开无人得分;
- 每回合结束清空场地实体、从模板重置场地,建筑者按加入顺序轮换,全员传送回场地中心;
- 目标分按人数(3~5 人 11 分 / 6~9 人 9 分 / 10~16 人 7 分),达标结束,侧边栏实时显示分数与目标;
- 题库管理 `/bearcade:qbank`(添加/查看/删除/清空,持久化);
- 调试开关 `/bearcade:gnb_debug`(详细回合日志)。

## 常用命令

```text
/bearcade:qbank            管理员:题库管理
/bearcade:config guessnbuild  管理员:游戏配置(含题库/坐标)
/bearcade:debug guessnbuild  管理员:开关调试日志(原 gnb_debug 仍可用)
/bearcade:quit             在房间维度强制中止
/bearcade:tmp tp guessnbuild   进入模板维度
/bearcade:tmp sz guessnbuild   表单配置模板范围
/bearcade:tmp ap guessnbuild   应用模板到全部房间
```

## 开发流程

1. 在 [src/config.ts](src/config.ts) 里确认游戏 ID(`guessnbuild`)、房间数、最大人数;
2. `npm run build && npm run deploy`,进游戏 `/reload`;
3. `/bearcade:tmp tp guessnbuild` 进入模板维度建场地;
4. 建好后填写 `TEMPLATE_FROM/TO`、`ROOM_COPY_ORIGIN`、`PREP_SPAWN`、`TICKING_FROM/TO`(或 `/bearcade:tmp sz guessnbuild` 表单配置);
5. `/bearcade:tmp ap guessnbuild` 应用到全部房间;
6. 在 `src/game.ts` 实现玩法,在房间维度执行 `/bearcade:quit` 可强制中止测试。

详细规范见仓库根目录 [development.md](../development.md)。
