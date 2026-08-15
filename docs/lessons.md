# Bearcade 实战参考:踩坑与解决

> 开发中踩过的 ScriptAPI/工程坑与解决方案汇总。新增踩坑时请追加到对应分类;
> 规范类内容以 `development.md` 为准,本文件只记录"现象 → 原因 → 解决"。

## 1. 事件与执行上下文

### 1.1 before 事件回调运行在 restricted execution
- **现象**:在 `entityHurt` / `chatSend` / 自定义命令回调里直接调用 `teleport`、`unleash`、开表单等原生 API 抛 "cannot be used in restricted execution"。
- **原因**:所有 before 事件(及自定义命令)回调以受限特权运行,只允许读状态与改内存。
- **解决**:原生调用一律经 `system.run` / `system.runTimeout` 延迟到正常上下文;回调内先同步锁定状态(如置 `phase`),再延迟结算。

### 1.2 `entityHitEntity` 对鱼钩(附着型弹射物)不派发
- **现象**:PigCatcher 用 `entityHitEntity` 判断"钓鱼竿勾中猪"解拴,从不触发(2026-08-15 大厅实测)。
- **原因**:`entityHitEntity` 只对常规弹射物(箭/雪球)可靠;鱼钩走附着逻辑,不派发该事件;它与伤害是否取消无关(`entityHurt` cancel 不影响命中报告)。
- **解决**:改用 `entityHurt(before)` 作为勾中信号——**0 伤害命中照样触发**,实测字段 `damage=0, cause=projectile, damagingEntity=投掷者玩家`;在猪无敌 `cancel` 之前先解拴,并用"邻近 1.5 格存在 `fishing_hook` 实体"二次确认,防雪球/箭误解拴。详见 `PigCatcher-猪猪争夺战/src/game.ts` 与 development.md §11。

### 1.3 弹射物命中的 `damagingEntity` 归属是投掷者
- **现象**:鱼钩勾中猪,事件里 `damagingEntity` 是玩家而非鱼钩实体。
- **原因**:基岩版将投射命中伤害归属给投掷者。
- **解决**:判断"哪种弹射物"不能靠 `damagingEntity.typeId`,要用 `cause` + 邻近实体查询(如查 `fishing_hook`)。

### 1.4 聊天答题 before 事件的时序陷阱(GuessNBuild)
- **现象**:答对后回合卡死;第二回合开场即结算。
- **原因**:`chatSend` before 回调受限,直接结算不可行;且回合开始未重置防重入标记,导致连续触发。
- **解决**:before 内同步置 `phase` 锁,`system.run` 延迟结算;每回合开始重置 `settling` 标记。

## 2. 维度、结构与常加载

### 2.1 结构引擎上限 64×384×64
- **现象**:65 宽(或 385 层)结构 `createFromWorld` 抛 "Structure size exceeds the maximum"。
- **解决**:共享运行时按 `tileSize`(默认 64)自动分块捕获/放置;纵向取满时 `from.y=-64`、`to.y=319`(320 超限 1 格)。

### 2.2 模板维度必须常加载
- **现象**:worldLoad 时 `createFromWorld` 捕获结构失败(区块未加载)。
- **解决**:模板维度创建常加载区域(`bearcade:ta_<game>_template`)并保留;常加载区只覆盖实际内容,不要整列 384 层(每包 chunk 有上限)。

### 2.3 tickingAreaManager 的坑
- **异步**:`createTickingArea` 返回 Promise,必须 await 完成、区块开始加载后才能上报 `idle`;
- **按包隔离**:只能管理本包创建的常加载区域;
- **chunk 上限**:每包常加载 chunk 有 `maxChunkCount`,场地尺寸预留余量。

### 2.4 自定义维度只能 startup 注册
- 维度注册仅在 `system.beforeEvents.startup` 的 `dimensionRegistry.registerCustomDimension` 允许;重复注册抛错,必须幂等容错(捕获记录)。

### 2.5 `Dimension.id` 返回完整命名空间 ID
- 判断大厅/房间维度必须以完整 ID 为准(`minecraft:overworld`、`bearcade:gamename_n`),不要用短名。

### 2.6 传送坐标与结构坐标的 +0.5 规则
- 传送类坐标按方块中心自动 `+0.5`;结构捕获与常加载区域保持方块坐标,**不加 0.5**。

### 2.7 多房间并发重置竞态
- **现象**:两个房间同时结束对局(或 apply 与重置并发),共享同一组结构 ID 的"删除→重建→放置"互相打断,`place` 抛"结构不存在"。
- **解决**:共享运行时 `enqueueReset` 串行队列,所有捕获/放置流程排队执行;重置失败重试一次,仍失败保持 `initializing` 并可经 `/bearcade:tmp ap` 修复。

## 3. UI 与表单

### 3.1 DDUI 按钮文本不解析 § 颜色码
- `CustomForm.button()` 的文本不渲染颜色码,`label()` 可以;状态只能用纯文本/符号表达。

### 3.2 表单连续打开要"先关后开 + 延迟"
- 菜单切换时先 `close()` 当前表单,再延迟 2 tick 打开新表单,避免 DDUI 连续显示问题。

### 3.3 受限上下文不能开表单
- 自定义命令回调里 `new CustomForm(...).show()` 会抛错;先 `system.run` 延迟再打开(参考 qbank、Toolkit 命令)。

## 4. 房间状态机与对局

### 4.1 准备倒计时(pending)必须上报为 idle
- **现象**:倒计时期间房间被上报为 `running`,其他玩家无法加入,房间永远开不了局。
- **解决**:`getReportStatus` 中 pending 视为 `idle`(仅 running 报 running,resetting 报 initializing)。

### 4.2 玩家重生点残留
- **现象**:对局内 `setSpawnPoint`(队伍基地)未清除,结束后玩家死亡在旧房间维度复活。
- **解决**:游戏结束清理重生点(游戏包 onBeforeReset)+ 大厅契约兜底:玩家进入主世界一律 `setSpawnPoint(undefined)`(Core 统一处理)。

### 4.3 断线重连的数据残留
- **现象**:玩家断线后重连,局内道具/模式/重生点原样保留,甚至回到对局。
- **解决**:契约"断线视为退出":重连时 Core 检测不在主世界则传回大厅并强制数据初始化(清全套物品/恢复冒险/清重生点/名牌/效果),详见 development.md §4.7。

### 4.4 人数不足/队伍无人必须即时结束
- 运行中人数低于 `minPlayers`、任一队伍全员离场时,必须立即结束对局并重置,不得让房间停留在 `running`。

### 4.5 锁定的钟物品与背包管理
- `ItemLockMode.slot` 只限制玩家交互,脚本 `setItem(undefined)` 仍可移除;入房移除钟、回大厅补发由 Core 管理,避免钟占用对局背包格。

### 4.6 大厅冒险模式契约:依赖放置/破坏的对局必须显式切换模式
- **现象**:五子棋进入对局后无法放置压力板落子——玩家在大厅被 Core 统一设为冒险(大厅契约 §4.7),进入房间时保持该模式,冒险模式下引擎禁止放置方块;
- **解决**:所有依赖放置/破坏的对局在 `onGameStart` 必须显式 `setGameMode`(五子棋→生存、建筑猜猜乐建筑者→创造),结束 `onBeforeReset` 恢复冒险(Core 回大厅时也会兜底初始化);入场传送不等于模式就绪,模式要自己设。

## 5. 通信与安全

### 5.1 scriptEvent 来源伪造
- **现象/风险**:玩家 `/scriptevent`、命令方块、NPC 可伪造 IPC 消息(如 `game.tp` 传送任意玩家、`game.quit` 强制中止)。
- **解决**:Core 与游戏包都拒绝 Entity(玩家)/Block/NPCDialogue 来源;游戏包另校验信封 `packId` 必须为 Core 的 header UUID(`CORE_PACK_ID`)。

### 5.2 packId 双重维护漂移
- `config/packs.json` 与各包 `src/config.ts` 各存一份 UUID,漂移会导致 IPC 校验静默失败;`npm run check` 校验一致性(已接入 CI)。

## 6. 工程与工具链

### 6.1 archiver v8 是 ESM + 类 API
- **现象**:旧式 `import archiver from "archiver"` 报 "does not provide an export named 'default'";`require('archiver')` 得到对象而非函数。
- **原因**:archiver 8 改为 ESM,导出 `ZipArchive` 等类。
- **解决**:`import { ZipArchive } from "archiver"`,`new ZipArchive({ zlib: { level: 9 } })`(见 `scripts/zip.mjs`)。

### 6.2 打包脚本避免依赖 Windows PowerShell
- `Compress-Archive` 仅限 Windows,CI/其他系统不可用;改用跨平台 archiver,CI 增加 `npm run package` 验证。

### 6.3 包依赖缺 version 导致小游戏包不被识别
- manifest 的 `packDependencies` 必须带 version;构建脚本统一回退 `projectVersion`。

### 6.4 capabilities 非必需
- manifest 不含 `capabilities`(如 `script_eval`)实测可正常加载,文档不再声称包含。

## 7. 调试技巧

- 内容日志:游戏内 `/contentlog` 打开面板,脚本 `console.warn` 输出;
- 游戏包调试开关:`/bearcade:debug <gamename|all> enable|disable`(持久化到动态属性,重载后仍生效,测完记得关);
- 定位"事件是否派发/字段归属"类问题:临时打点(`console.warn` 打印 `typeId`/`damageSource`/`dimension`),实测后删除,不要凭猜测改逻辑(参考 §1.2 的排查过程)。

## 8. 模拟玩家(SimulatedPlayer):引擎限制与功能回滚

> 2026-08-15,源自 Toolkit `/spm`(生成/列表/删除模拟玩家)功能从实现到回滚的完整过程。功能已整体回滚(commit `0f1cab0`),如需重做可从 `b32d1c1` 找回实现,但须先验证引擎版本是否开放模拟玩家对象访问。

**目标**:生成模拟玩家凑开局人数,并参与对局(入队/站场/装备)。

**实测结论(当前引擎 1.26.42 的限制)**:

- 模拟玩家在**大厅(overworld)**是完整 Player 对象:可枚举、可 `getEntity`、可操作(tag/名字/坐标均可读);
- 一旦进入**自定义维度**(`bearcade:*`),所有对象获取途径失效:
  - `dimension.getPlayers()` / `world.getAllPlayers()`:返回 **undefined 占位**(`length` 仍计入,可凑人数);
  - `dimension.getEntities({type:"minecraft:player"})`:不返回模拟玩家;
  - `world.getEntity(id)`:返回 `invalid`;
  - **动态属性跨包不可见**:一个包写入的键,另一个包 `getDynamicProperty` 读到 `undefined`(不能靠它跨包传递 id 记录);
- 因此模拟玩家只能"占人数"(开局判定/状态上报/菜单人数正常),**无法入队/站场/传送/装备**;列表/删除也仅在大厅有效。

**事件行为陷阱**:模拟玩家会触发 `playerSpawn`/`playerDimensionChange`/`entityHurt` 等事件,但事件实体字段为 **undefined**(`event.player`/`hurtEntity`),`sendMessage`/`onScreenDisplay` 为 undefined——订阅这些事件的处理器必须判空防御(回滚时随功能一并移除,重做需加回)。

**排查方法论(可复用)**:

1. 现象驱动:先写临时诊断打点(内容日志打印各 API 的返回值构成),不要猜;
2. 逐层排除:事件字段缺失 → 枚举占位 → `getEntity` invalid → 动态属性跨包隔离,一层层缩小范围;
3. 计数兜底:人数统计用 `getPlayers().length`(占位)与实体枚举维度过滤取最大值,可规避可见性不稳定;
4. **跨包共享数据优先用实体自身属性(tag)与世界级枚举,不要依赖跨包动态属性**(实测隔离);
5. **自定义维度中的实体对象可见性要在设计阶段验证**,实现完成后再发现等于返工;
6. 引擎能力边界确认后及时止损回滚,不硬撑。

## 9. 观战相机(Camera API):脚本跟随的引擎限制与最终方案

> 2026-08-15,源自 Collapse 观战机制从"脚本驱动自由相机"到"follow_orbit 引擎绑定"的完整排查(commit 4425c7c → bf2ca54 → eec1bff)。结论可直接复用:任何"相机跟随玩家"需求都按 9.1 做,不要走 9.3 的弯路。

### 9.1 最终方案(可用,已集成进 Collapse)

- **预设**:`minecraft:follow_orbit`(或 `third_person_boom`)——引擎原生"围绕目标公转、鼠标可环绕、随目标移动",相机由引擎在渲染帧率下跟随,零脚本负担、零抖动;
- **绑定目标**:脚本 API `attachToEntity` 文档限定**非玩家实体**(对玩家静默无效,不报错),必须走命令:`/camera @s attach_to_entity <目标>`(**命令层无玩家限制**);执行用 `dimension.runCommand` + 双方临时 tag(服务器上下文,免玩家权限,仅需世界作弊);
- **自定义预设**:需要半径/起始角可控时,在包内放 `Cameras/Presets/*.json`(`inherit_from: "minecraft:follow_orbit"`,字段 `radius`/`starting_rot_x`/`starting_rot_y`);**目录必须大写 `Cameras`/`Presets`**,小写会导致 "Invalid camera preset";
- **切换目标运镜**:先用 `setCamera("minecraft:free", { location: 环绕起点, rotation: 看向目标, easeOptions })` 缓动飞过去(引擎从当前相机状态插值,无需知道当前位置),延时后 `setCamera(预设)` + attach——环绕起点由预设几何(半径×起始角)精确算出,到达即 attach,无 snap;
- 依赖:世界实验开关 **"Creator Cameras: New Third Person Presets"**(世界级、开启后不可逆)+ 世界作弊(/camera 命令需要)。

### 9.2 脚本驱动自由相机的根本限制(为什么前面全失败)

- 相机位置来自服务器 **tick 采样**(10~20Hz 离散坐标),人物身体由引擎在**渲染帧率**下独立插值——两条运动路径相位不同步,人物相对相机微抖;**这是方案级限制,缓动/平滑参数无法根治**;
- 尝试过:线性缓动(0.1~0.2s 各种组合)、1/2/3 tick 刷新、二分逼近(指数平滑,位置+瞄准点)、playAnimation 样条——都只能缓解"镜头台阶"或"人物漂移"之一,无法同时消除;
- 结论:**需要"相机跟随人物"时直接上引擎级机制(follow_orbit + attach),不要在自由相机上堆平滑**。

### 9.3 各 API 实测结论(避坑)

| API | 实测行为 |
| --- | --- |
| `setCamera("minecraft:free", { location, facingEntity })` | **无 easeOptions 时 facingEntity 不生效**,free 预设默认旋转朝天;带 easeOptions 时可用 |
| `setCamera(..., { facingLocation })` | 同上,且缓动朝向滞后会造成人物在画面内漂移 |
| `setCamera(..., { targetEntity })` | 仅 free 相机"持续看向目标"语义;对 `third_person`/`follow_orbit` **无效**(仍环绕/看向自己) |
| `camera.attachToEntity({ entity: 玩家 })` | 对玩家**静默无效**(不抛错,相机原地不动) |
| `playAnimation(样条)` | 旋转关键帧间隔**必须 > 0.05s**(疑似按 tick 量化,0.09s 仍报错);控制点数量有校验(Linear≥2/3、Catmull-Rom≥4);每 tick 重播的段间衔接/起始 snap 问题难解 |
| `/camera ... attach_to_entity` / `targetEntity` | **命令层无玩家限制**,是脚本 API 限制的绕行通道 |

### 9.4 运维要点

- 行为包 JSON(含 camera 预设)改动后需**完整重启/重进世界**才重新加载,`/reload` 可能不生效;
- 实验开关开启后**不能关闭**,正式服建图时就开;
- 预设 JSON 的 `radius` 等参数与脚本侧几何(如运镜起点计算)要**双处一致**,改一处必须同步另一处。
