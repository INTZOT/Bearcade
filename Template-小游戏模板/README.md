# Bearcade 小游戏模板

这是一个可复制的小游戏包模板,已包含与 Core 对接的全部基础设施:

- 房间/模板维度注册(startup 阶段);
- 模板结构捕获 → 复制到各房间 → 常加载(worldLoad 后);
- `game.register` / `room.status` 上报与 5 秒心跳;
- 对局状态机(空闲 → 倒计时 → 运行 → 结算 → 重置);
- 房间保护、结束回大厅、强制中断命令;
- 开发命令进入模板维度制作场地。

## 使用步骤

1. 复制 `Template-小游戏模板` 目录,重命名(如 `SND5-剑与消亡V`);
2. 全局替换 `mygame` 为你的游戏 ID(小写字母/数字/下划线,如 `snd5`);
3. 修改 [src/config.ts](src/config.ts):`DISPLAY_NAME`、`ROOM_COUNT`、`MAX_PLAYERS`,并重新生成 `PACK_ID` 与 manifest UUID;
4. 在 `config/packs.json` 注册你的包(参考 template 条目),`npm run build` 生成 manifest;
5. 部署后进游戏 `/reload`,执行 `/bearcade:mygame` 进入模板维度建场地;
6. 填写 config 里的坐标(模板范围、复制原点、准备房间、常加载区域);
7. 在 [src/game.ts](src/game.ts) 的 `TODO` 处实现你的玩法;
8. `npm run typecheck && npm run build && npm run package`,分发时连同 Core 包与 `development.md` 一起给出。

## 协议速查

- 通道:`bearcade:ipc`,信封 `{ op, packId, payload }`;
- `game.register`:游戏 ID、显示名、房间数、最大人数、准备房坐标;
- `room.status`:全量房间快照 + 5 秒心跳,状态仅 `initializing` / `idle` / `running`;
- 维度命名:`bearcade:<gamename>_n` 与 `bearcade:<gamename>_template`;
- Core 只读取 `prepSpawn` 做入房传送,场地坐标全部由小游戏包配置。

## 常见坑

- 自定义命令回调运行在 restricted execution 模式,原生调用(传送/表单)必须经 `system.run` 延迟;
- `Dimension.id` 返回完整命名空间 ID(主世界为 `minecraft:overworld`);
- 结构引擎上限 64×384×64,纵向取满为 y -64~319;
- 每包常加载 chunk 有上限,常加载区域只覆盖实际内容;
- DDUI 按钮文本不解析 `§` 颜色码,label 可以。

详细规范见仓库根目录 `development.md`。
