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
- **解决**:共享运行时按 `tileSize`(默认 64,**上限也是 64**,超配会被钳制)自动分块捕获/放置。
  因此**横向(X/Z)没有实际上限**:100×100 的场地分成 2×2 四块,512² 分成 8×8 六十四块。
  只有**纵向 384 层**是世界高度内的硬限制(纵向取满时 `from.y=-64`、`to.y=319`,320 超限 1 格)。
  `/bearcade:tmp sz` 的校验据此只限制 Y,不再拒绝超 64 的 X/Z。

### 2.2 模板维度必须常加载
- **现象**:worldLoad 时 `createFromWorld` 捕获结构失败(区块未加载)。
- **解决**:模板维度创建常加载区域(`bearcade:ta_<game>_template`)并保留。
  **范围变更(`/tmp sz` 移动模板)后必须重建该区域**,否则仍覆盖旧位置,新位置会被捕获成空气
  (共享运行时用坐标指纹判断是否重建,并在重建后等 3 tick 让区块加载)。

### 2.3 tickingAreaManager 的坑
- **异步**:`createTickingArea` 返回 Promise,必须 await 完成、区块开始加载后才能上报 `idle`;
- **按包隔离**:只能管理本包创建的常加载区域;
- **Y 不参与区块加载(1.26.42 实测)**:常加载区域按**区块(X/Z)**生效,一个区块被加载即整列(所有 Y)可用,
  因此**不存在"y 范围之外内容会被卸载"的问题**,也不必为了省预算而把 Y 收窄;
  旧文档"常加载区只覆盖实际内容、不要整列 384 层"的说法据此作废 —— 真正影响预算的是 X/Z 覆盖的区块数。
- **单区域区块上限**:单个常加载区域能覆盖的区块数有限(实测约 100)。超过时应:
  1) 用 `tileWindowed`(逐块"建常加载 → 操作 → 卸载")做整图捕获/放置;
  2) 把包内 `TICKING_FROM/TICKING_TO` 收敛到**实际游玩区**(而不是整张模板);
  `/tmp sz` 保存范围时会自动算区块数:超限则**保留包内 TICKING 配置**并提示需要 `tileWindowed`,
  不会硬造一个超限的常加载区。
- **变更后同步**:房间常加载区在 `ap`/重置时**先删后建**,保证 `/tmp sz` 改范围后覆盖区跟着变
  (旧实现"缺失才创建",改范围后房间仍覆盖旧位置)。

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
- 自定义命令回调里 `new CustomForm(...).show()` 会抛错;先 `system.run` 延迟再打开(参考 GuessNBuild 配置菜单、Toolkit 命令)。

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

### 5.3 已卸载/停用的游戏会残留在菜单
- **现象**:游戏包被禁用或卸载后,Core 从动态属性恢复的注册表仍把它列在游戏列表,只是房间显示“数据过期”。
- **原因**:注册表只持久化了游戏配置,没有区分“历史配置”和“本会话已激活”。
- **解决**:`GameEntry` 增加 `active`/`lastActivity`;恢复条目默认 inactive,收到 `game.register` 或 `room.status` 才激活;`listGames()` 只返回 active;30 秒无任何上报自动隐藏。

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

### 9.5 俯瞰视角/自由相机控制方案(2026-08-17,gomoku/go 实测)

- **自定义相机预设在本版本完全不加载**(2026-08-22 cchess 实证):不只 `inherit_from: "minecraft:free" + control_scheme`,连 `inherit_from: "minecraft:third_person_boom" + radius` 也 `Invalid camera preset`;启动日志伴随 `[Camera][error]-Failed to load the contents of file <乱码>`(引擎报错打印文件名是乱码)。Collapse 观战"能用"是因为代码里有**内置 `minecraft:follow_orbit` 回退**,不能证明自定义预设被加载——**结论:一律使用内置预设,自定义预设当作不存在**;
- **`minecraft:third_person_boom` 在本版本无效**(文档中的 ID,实测 `Invalid camera preset`);可用的内置第三人称/跟随预设:`minecraft:follow_orbit`(默认半径 10,引擎级跟随,零抖动)与 `minecraft:free`、`minecraft:third_person` 等;
- **原生 `/controlscheme` 命令**(1.21.90 起不再需要 "Experimental Creator Camera" 实验开关,权限 Game Directors、需世界作弊):`/controlscheme <players> set camera_relative|player_relative|camera_relative_strafe|player_relative_strafe|locked_player_relative_strafe`、`/controlscheme <players> clear`;`camera_relative` = 鼠标/摇杆以相机自身为轴转动(俯视视角手感正确);
- **最终可用组合**(俯瞰视角):`player.camera.setCamera("minecraft:free", { location, rotation: { x: 90, y: 0 } })` + `player.dimension.runCommand("controlscheme @a[tag=xxx] set camera_relative")`(命令层无 `@s`,先打临时 tag 再 selector;脚本 API 无控制方案参数,必须走命令);恢复时 `camera.clear()` + `controlscheme ... clear`;
- 依赖:世界作弊(与 `/camera` 命令同要求);ScriptAPI 侧 `rotation.x = 90` 合法(俯视极限值);
- **第三人称跟随**(cchess 采纳):直接 `setCamera("minecraft:follow_orbit")` 无参数——引擎渲染帧率跟随玩家零抖动、鼠标可环绕(controlscheme 生效时)、距离 10 比原版第三人称(≈4)更远;红黑双方无需 yaw 差异(对称)。

## 10. 每玩家独立记分板:JSON UI + rawtext score(本轮引入)

### 10.1 为什么不能用全局 Sidebar

- `DisplaySlotId.Sidebar` 是全服唯一显示槽,`setObjectiveAtDisplaySlot` 不接受 player/房间参数;
- 多房间/多小游戏同时运行时,后设置者覆盖前者;一个房间 reset 时 `clearObjectiveAtDisplaySlot` 还会误清另一个房间的显示。

### 10.2 最终方案(已覆盖全部小游戏)

- **数据层**:仍使用每房间独立 scoreboard objective(真实玩家用玩家身份,队伍/计时用假玩家名),但**不挂 Sidebar**。
- **传输层**:`player.onScreenDisplay.setTitle({ rawtext: [..., { score: { name, objective } }, ...] })`。rawtext score 是按玩家解析的,title 又是每玩家实例,因此每个玩家看到的是自己房间的分数,多房间天然隔离。
- **表现层**:与行为包同目录的 `resource-pack/ui/hud_screen.json` 覆写原版 `hud_title_text`,把居中大标题重排版为屏幕**右侧垂直居中**的紧凑信息面板;label 继续绑定引擎变量 `#hud_title_text_string`,不引入自定义 binding。
- 公共实现集中在 `shared/minigame-core/scoreboardHud.ts`:`ensureObjective` / `setObjectiveScore` / `releaseObjective` / `scoreToken` / `hudMessage` / `setHudTitle` / `clearHudTitle`。

### 10.3 避坑

- `RawMessage.rawtext` 的元素是 `RawMessage[]`,字符串要显式包成 `{ text: "..." }`;换行用 `{ text: "\n" }`(注意 Python/批处理脚本写入 TS 源文件时反斜杠可能被转义成真实换行,写入后用 `repr`/`cat -v` 复核)。
- 假玩家分数不要每次 `setScore(字符串)`:按 `getParticipants()` 找 `ScoreboardIdentity` 并缓存;objective 移除时清理缓存。
- title 刷新用 `fadeInDuration: 0 / fadeOutDuration: 0`,stay 用 80 tick 左右,按 10~20 tick 刷新即可,不需要每 tick 重设。
- 资源包 manifest 的 module type 是 `"resources"`,**没有 entry**;行为包才有 `scripts/main.js` 入口。构建脚本必须按 `pack.type` 分流。
- 资源包与行为包**一对一分包,但源码不拆两个顶层目录**:每个小游戏目录内放 `resource-pack/`(如 `Gomoku-五子棋/resource-pack`),build/package 生成独立 `<gameid>_hud.mcpack`,deploy 还原为 `Gomoku-五子棋-资源包`;不要做全局 HUD 资源包;deploy/package 都要按配对关系处理(指定行为包自动带 `_hud` 资源包)。
- 资源包部署目录是 `development_resource_packs`(与 `development_behavior_packs` 相邻),不要混放。
- **已实测(1.26.42)**:同名控件是按属性合并而不是整控件替换,小文件只写 `hud_title_text` 会导致 `Unknown property [orientation]` 等错误、内容不显示;本项目已改为**完整复制原版 `ui/hud_screen.json` 后只改 `hud_title_text` 定义**,不要再退回小文件覆写。
- JSON UI 文件允许 `//` 注释;校验时要用 json5/jsonc,不能直接 `json.load`。
- 资源包 UI 改动后通常需要**完整重启/重进世界**才生效,`/reload` 可能不重新加载 UI 定义。

### 10.4 最终可用布局(1.26.42 实测)

`hud_title_text` 用以下结构,已经过多轮大厅实测:

- 必须是**完整原版 `ui/hud_screen.json` 副本**,只改 `hud_title_text`;
- 外层 `type: "stack_panel"` 且显式 `"orientation": "vertical"`(引擎会合并原版 `orientation`,不写会报 `Unknown property [orientation]`);
- 锚点用 `right_middle` / `right_middle`,外层偏移 `[0, 0]`;
- **alpha 固定为 `1.0`**,不要用 `@hud.anim_title_text_alpha_in`;否则每次 `setTitle` 背景会随渐隐动画闪烁,文字却不闪;
- 背景和文字不能直接作为 stack_panel 的两个兄弟(会上下排列错位),要包进同一个 `title_frame` panel 叠放;
- 背景:`textures/ui/Black`,`alpha: 0.62`,`layer: -1`,尺寸 `["100%sm + 8px", "100%sm + 6px"]`,跟随文字大小;
- 文字:`font_size: "normal"`、`text_alignment: "right"`、`localize: false`,并给 label 加 `offset: [-4, 0]` 作为右侧安全边距;
- 测试时用临时行为包每 10 tick 调 `player.onScreenDisplay.setTitle({ rawtext:[...] }, { fadeInDuration: 0, stayDuration: 40, fadeOutDuration: 0 })`,能同时验证刷新频率、闪烁和 rawtext score。


## 11. 本轮修复速查(可复用结论)

- **Cameras 目录大小写**:引擎按精确路径加载,源码必须 `Cameras/Presets`,打包/部署清单也必须用 `"Cameras"`;小写路径在 Windows 上能复制但产物路径错误,在 Linux 上则直接漏打包。
- **模板 ap 修复路径**:`applyTemplateToAllRooms` 成功后除了置 `ready`,还必须把卡在 `resetting` 的房间状态重置为 `idle`,并补齐缺失的房间 ticking area。
- **模板范围变更残留**:旧范围要在“每个房间”下次重置前各清理一次;若只记一个全局待清列表,先结束的房间会把它消费掉,其他房间仍残留旧场地。
- **before/after 钩子都要兜底**:`onGameStart` 抛错会让房间卡在 running;`onBeforeReset` 抛错会阻止玩家回大厅。运行时统一 try/catch 并走 `endGame`/继续传送。
- **异步重置竞态**:`await resetRoom` 恢复后要先检查 `runtime.getPhase` 是否仍为 running、session 是否仍是当前对象,再决定是否继续开新回合。
- **回大厅清理契约要覆盖 UI 残留**:除物品/模式/重生点/名牌/效果外,还要清 camera、actionbar 与 HUD title。
- **资源配置与版本单一来源**:资源包同样注册进 `config/packs.json`;`package.json.version` 与 `projectVersion` 强制一致;watch 目标按 pack 类型派生(`src/` vs `ui/`)。

## 12. 自定义方块(Data-Driven Blocks):格式坑与创造物品栏分组

> 2026-08-17,源自 Gomoku 六个自定义方块(棋盘 blank/center/side/corner + 黑白棋子)从建模到进创造栏的完整过程。参考成品实现:`D:\Develop\ADDON_reference`(史诗幻想/真枪实弹)。

### 12.1 组件/字段速查(1.26.42,block format 1.21.x)

| 组件/字段 | 错误现象(日志) | 正确写法 |
| --- | --- | --- |
| `minecraft:light_dissipation`: `0`(裸数字) | `child 'minecraft:light_dissipation' not valid here` | 直接删掉(默认就是 0) |
| `minecraft:transformation.rotation`: `[0,90,180,270]` | `Expected [x, y, z]` | 单个三元组 `[0, 90, 0]`;列表是旧版 `minecraft:rotation` 组件写法 |
| 4 朝向 | — | `description.traits` 的 `minecraft:placement_direction`(`enabled_states: ["minecraft:facing_direction"]`)+ permutations 按状态给 `transformation.rotation`(北0/东90/南180/西270) |
| `y_rotation_offset` | 改了没效果 | permutations 的 transformation **覆盖** trait 偏移,该字段对显式排列无效,可删 |
| 朝向镜像 | 对角朝向写反 | 只交换 **E↔W 一对排列值**(east=270/west=90);全局翻转(改 offset/全体+180)对镜像无效 |
| `minecraft:creative_category` 组件 | 整块 `Block definition parsing failed`(无详细行) | **组件不存在**(物品旧写法);方块用 `description.menu_category` |
| `menu_category.group` 带 `minecraft:` 前缀 | `minecraft:minecraft:... | Invalid identifier` 炸包 | 引擎**自动加 `minecraft:` 前缀**,值必须无前缀;自定义组别用 catalog(见 12.2) |
| `collision_box: { "enabled": false }` | 无报错但碰撞仍是完整方块 | **布尔 `false`** 才生效(参考项目同款写法) |
| 自定义几何方块 | 相邻面全渲染 | `"minecraft:geometry": { "identifier": "...", "culling_shape": "minecraft:unit_cube" }`(完整方块);**镂空/圆片形状不要给 culling shape**——满盒会把下方方块顶面整块剔除导致透视 |

### 12.2 创造物品栏折叠分组(最终可用方案)

```json
// BP 的 item_catalog/crafting_item_catalog.json(format 1.21.60)
{ "format_version": "1.21.60", "minecraft:crafting_items_catalog": {
  "categories": [ { "category_name": "construction", "groups": [
    { "group_identifier": { "icon": "bearcade:chestboard_blank", "name": "bearcade:itemGroup.name.gomoku" },
      "items": ["bearcade:chestboard_blank", "..."] }
  ] } ] } }
```
```lang
// RP texts/zh_CN.lang
bearcade:itemGroup.name.gomoku=五子棋方块
```

- 组键用**包自己的命名空间**(`bearcade:itemGroup.name.gomoku`,不是 `minecraft:` 前缀、不是裸键),语言文件同款键;
- **`icon` 必须带**(参考成品全部带,缺 icon 组不生成);
- 方块定义里 `menu_category` **只留 category 不放 group**(与 catalog 同时定义会 content warning 冲突,物品留在旧组不折叠);
- 方块名:`tile.<ns>:<id>.name`(RP lang);组名/方块名都走 RP texts,记得完整重启。

### 12.3 部署/排错要点

- 行为包 JSON(方块/预设/物品)改动**必须完整重启**,`/reload` 不重新扫描;部署发生在会话中途时,该会话测的永远是旧文件——先核对日志会话时间与部署时间;
- 方块解析失败先看 `[Blocks][error]` 的**详细行**(组件名 + 具体字段),"Block definition parsing failed" 无详细行时,通常是**组件整体不存在/格式根本性错误**(如 creative_category);
- RP `blocks.json` 报 "block does not exist in the registry" 是方块未注册的连带,先修 BP;
- 改 JSON 用工具写入后注意 **BOM**:PowerShell `-Encoding UTF8` 会加 BOM,引擎/校验器可能不认,统一 `UTF8Encoding($false)` 无 BOM 写入;
- 与可用成品 addon **逐字段比对**是最快的定位手段(组键命名空间、icon、menu_category 冲突都是这么查出来的)。

## 13. 围棋(Go)玩法与俯瞰视角实录(2026-08-17)

> 源自 Go 完整开发:19×19 棋盘、提子/劫/计目/计时、物品停一手、终局确认,以及 gomoku/go 共用的俯瞰视角(望远镜切换 + 脚下落子)。全部在 1.26.42 / @minecraft/server 2.10.0-beta 实测。

### 13.1 丢子检测:API 没有玩家丢弃事件

- **2.10.0-beta 没有 `playerDropItem` 事件**;认输判定(丢出棋子=认输)只能**库存轮询**:每 10 tick 数当前持棋玩家手中棋子数,为 0 且非刚落子 → 认输;
- 刚落子也会扣光手中棋子 → 落子时置 `justPlaced` 标志,轮询先消费该标志再判断(本 tick 刚落子不误判);
- 离房/断线:订阅 `playerDimensionChange`,当前持棋玩家离开房间维度 → 视为认输(断线=退出契约)。

### 13.2 停一手:自定义命令 → 物品交互

- 自定义命令(`customCommandRegistry.registerCommand`)回调跑在 restricted 上下文,实际逻辑必须 `system.run` 延迟;后来干脆**改为物品**(纸张)+ `itemUse` 事件,去掉命令;
- **随机入包会误触**:`addItem` 把纸张塞进任意空格,玩家乱点可能误停一手 → **固定快捷栏槽位**:`container.setItem(8, item)` + `ItemLockMode.slot`(望远镜同理放第 8 格);
- 腾格逻辑(背包满清杂物)必须**排除对局道具**(棋子/纸张/望远镜),否则会被当杂物清掉。

### 13.3 双方停手后的终局确认

- 状态机:`pendingEnd: boolean` + `endConfirm: Set<playerId>`;双方连续 pass 后弹 `MessageFormData`(双按钮:确认终局/取消继续);
- `MessageFormResponse.selection`:**0 = 第一个按钮**;`undefined` = 玩家直接关闭表单(要当作取消处理,否则挂死);
- 确认期**暂停认输轮询与计时**(`pendingEnd` 时跳过 pollResign/pollClock),否则弹窗期间会超时判负/丢子误判;
- **60s 超时自动取消**防挂机;超时回调必须带 `games.get(roomId) !== state` 守卫——房间重置后旧 state 对象作废,直接操作会污染新对局;
- 取消后清空 `passed`,`giveTurn` 给最后一个停手方继续行棋。

### 13.4 俯瞰视角:落子射线跟随玩家本体,不跟随相机

- **放置/交互射线 = 玩家本体头部朝向,与相机无关**;free 相机 + `controlscheme camera_relative` 下:鼠标不转相机、本体视线**强制水平**(俯仰锁 0、yaw 随移动),`setRotation` 改俯仰无效——"让玩家自己瞄准脚下"此路不通(详见 §9.5);
- **aim assist 路线**:API 全通(注册 ✓ 激活 ✓)但**实测不出锁定框**——瞄准锥以**角色面朝方向**为中心,脚下棋盘在正下方 90°,超出锥角;且无法旋转角色朝向,几何上无解。教训:aim assist 适合"视线前方 ±45° 内的目标",不适合"脚下目标";
- **最终方案:多事件源右键检测 + 脚本落子**:
  - 本版本 API:`itemUseOn` **已拆分为 `itemStartUseOn` / `itemStopUseOn`**(`itemStack` 可选);`World`/`Player` 上的 aim assist 是 **`getAimAssist()` 方法**不是属性;
  - 方块物品右键**同时触发 `itemUse` 和 `itemStartUseOn`**(对空也触发 itemUse,实测日志证实)→ canPlace 兜底 + 两事件三路统一入口,**同 tick 去重**(`lastOverviewPlaceTick` map)防重复落子;
  - 引擎放置被取消(`canPlace` 返回 false)后**物品不会被消耗** → 脚本放置后手动 `consumeStone`;
  - aim assist 注册 API 备忘:配置写在 **Settings 类**(`AimAssistCategorySettings`/`AimAssistPresetSettings` 可写字段+setter),`addCategory/addPreset` 返回的句柄只读;数据驱动 JSON(`Cameras/Presets/aim_assist_preset.json` + `categories.json`)与自定义 camera preset 同族问题——**本版本不加载**,必须走 ScriptAPI 注册表。

### 13.5 俯瞰落子的具体坑

- **`Math.round` 取格 bug**:玩家站在格心时 `player.location` 是 `整数 + 0.5`,`round(0.5)` 进位 → 棋子落在**相邻格**(斜对角偏移);应 `Math.floor` 取"脚底所在格"(负坐标也正确);
- 落子后给玩家提示/写方块必须 `system.run` 延迟(before 事件 restricted 上下文);
- **粒子选中框**:`spawnParticle` 沿格子四边按 0.2 间距撒点即可画方框;粒子 ID 无效时**静默失败**(无报错)→ 加一次性诊断日志(`spawnParticle` 抛错只打一条);实测可用:`minecraft:balloon_gas_particle`;
- 相机锁视野:`player.camera.setFov({ fov: 60 })`——**相机作用域**,`camera.clear()` 自动还原,不需要手动恢复;
- 俯瞰中离房/对局重置:统一 `exitOverviewState`(清 aim assist/controlscheme/相机),幂等防重复。

### 13.6 环境:本地模型服务(Ollama)排障备忘

- 现象:`vision` 工具 `fetch failed`、本地推理 500 → Ollama 没在跑 或 安装损坏;
- 排查顺序:进程/端口(11434)→ `server.log`(`%LOCALAPPDATA%\Ollama\server.log`)→ `ollama list`;**`error starting llama-server: binary not found` = 安装损坏**(`lib\ollama\llama-server.exe` 缺失,更新半途失败常见),重装即可,模型库(自定义 `OLLAMA_MODELS`)不受影响;
- 安装器支持 `/DIR=D:\...` + `/VERYSILENT` 指定安装盘;`OLLAMA_KEEP_ALIVE=0s` 会导致每次调用冷加载(慢 10~30s),改 `5m` 后连续调用秒回。

## 14. 自定义实体渲染(2026-09-25,AllStars 春叶实机实录)

现象:脚本能生成实体、能触发事件、粒子正常显示,**但模型完全看不见**(不是"黑"也不是"错位",是没有)。

### 14.1 ★ 客户端实体是"整条描述"级别校验:任何一处不合法 → 整个模型不渲染

- 元凶:资源包 `entity/<x>.entity.json` 里
  ```json
  "scripts": { "animate": [] }
  ```
  空数组过不了客户端 schema 校验,内容日志每次加载世界都报:
  `[Animation][error]-entity/chunye.entity.json | minecraft:client_entity | description | scripts | animate | Array too small (0 < 1)`
- 后果:**整条 `minecraft:client_entity` 描述被丢弃**。实体照样存在(脚本 API 全部正常)、行为包不受影响、粒子也正常,唯独没有模型 —— 完全符合"实体在、看不到"的观测。
- 做法:动画全部由 `entity.playAnimation()` 驱动时,**不要写 `scripts` 块**;确实要用 `scripts.animate` 就至少给一个真实条目(不能是空数组)。
- 推论:以后遇到"自定义实体看不见",**先看内容日志里这个实体对应的 `[Animation]/[Geometry]/[Rendering]` 报错**,不要先怀疑贴图/几何。校验失败是整条丢弃,报错文本只会指向出错的那个字段。

### 14.2 渲染控制器优先用原版内建 `controller.render.default`

- 内建定义(vanilla `resource_packs/vanilla/render_controllers/default.render_controllers.json`,format 1.8.0)就是:`geometry: Geometry.default` / `materials: [{"*": "Material.default"}]` / `textures: [Texture.default]`。
- 自建一个**内容完全相同**的 RC 文件(只换 id)在本轮实机报:`[Rendering][error]-render_controllers/chunye.render_controllers.json | error parsing render_controllers/chunye.render_controllers.json:`(冒号后无细节)—— 即自建 RC 文件本身有解析风险。
- 结论:只要不需要"多材质/多贴图/分部件条件渲染",直接 `"render_controllers": ["controller.render.default"]`,**不要建 `render_controllers/` 目录**。仓内先例:`Ctf-夺旗` 三个自定义实体全部如此(且其 client_entity **没有** `scripts` 块)。
- 注意:`controller.render.default` 用的是 `Texture.default`,所以 `textures` 里必须有一个叫 `default` 的条目。

### 14.3 `minecraft:damage_sensor` 的 `triggers` 用对象写法(数组 + cause 会报 Json 错)

- 报错(非致命,实体仍能生成):
  `[Json][error]-… | bearcade:allstars_chunye | minecraft:entity | components | minecraft:damage_sensor | triggers | deals_damage | deals_damage | unknown child schema option type. Allowed types: 'string'`
- 原版写法(vanilla `behavior_packs/vanilla/entities/*.json`,如 `agent.json`/`bat.json`)是**对象**,不是数组:
  ```json
  "minecraft:damage_sensor": { "triggers": { "cause": "all", "deals_damage": false } }
  ```
  仓内 `Ctf-夺旗` 用的是数组但**不带 `cause`**(`"triggers": [{ "deals_damage": false }]`),也不报错。要写 `cause` 就用对象形式。

### 14.4 "模型看不见"的排查套路(可复用)

1. **内容日志是唯一权威**:`%APPDATA%\Minecraft Bedrock\logs\ContentLog<日期>.txt`,逐包逐文件给出行号级报错。按实体名/文件名 grep `[Animation]|[Geometry]|[Rendering]|error` 即可。脚本侧"已下发/已生成"**不能证明渲染成功**——`playAnimation` 返回不抛错 ≠ 模型在渲染。
2. **A/B 渲染探针**:同时生成①"最简方块实体"(取目标模型的**同一张贴图**,client_entity 写法完全一致,只是几何是一个 16³ 方块、无动画)与②真模型,让玩家回答"看到哪几个"。`①可见+②不可见` ⇒ 问题在真模型的几何/动画定义;`两者都不可见` ⇒ 问题在"行为包实体 + 客户端实体"这一层。比反复猜贴图/UV 高效得多(本轮已把它做进 `/bearcade:allstars_diag`)。
3. **贴图与 UV 的机械核验**:Python/Node 解码 PNG,统计"逐面 UV 覆盖区域里不透明像素占比"。本轮据此排除了"贴图全透明""UV 落在透明区"两个假设(总体不透明率 52.8%、2844 个面全部命中不透明像素)。
4. **部署路径**:测试存档加载的是 `minecraftWorlds/<id>/behavior_packs|resource_packs/` 下的**世界内副本**;`.env` 指向的 `development_*_packs` 与该世界无关。装包要落世界副本,并且**必须完整退出世界再进**——客户端实体/几何/动画只在 pack 加载时读一次,资源包文件热替换无效(行为包脚本倒是会重载)。
5. 手动落包后核对:`world_resource_packs.json` / `world_behavior_packs.json` 里引用的 **pack 版本号必须与实际 manifest 一致**(本轮一直是 `[0,0,1]`,所以 manifest 版本不能随手升级),包内文件用 SHA256 与仓库产物逐个比对,排除"装的是旧包"。
6. 镜像世界内副本时用 `robocopy <staging> <世界内副本> /MIR`——**删除多余文件是必须的**(本轮自建 RC 文件被删后,世界副本里那份残留会继续报 parse 错)。

## 15. 横板格斗的相机 / 输入 / HUD 实机修正(2026-09-25,AllStars 第二轮)

### 15.1 `Entity.teleport()` 的 rotation.y:yaw 0 = +Z、**90 = -X**、-90 = +X

- 模型朝向从"参数"推不出来,必须**按几何自证**:vanilla `armor_stand.geo.json` 里 `rightarm` 的 `origin.x = -7`(模型右手在 **-X** 侧);"面朝 +Z 时右手在 -X"成立 ⇒ **模型正面 = +Z**。
- 所以"让角色面朝 +x"要写 `yaw = -90`,不是 90。本轮写反了,实机表现就是**两个角色都背对对手**。
- 同一约定在 `camera.lookAt()` 里也要一致:`(-sin(yaw), cos(yaw))` 才是朝向向量。

### 15.2 两台相机 ≠ 一台:共享侧视相机时,输入必须用**绝对屏幕方向**

- 前提:两个玩家看的是**同一个** free 相机(位置/朝向都由脚本算,完全相同)。
- `getMovementVector()` 给的是**摇杆自身朝向**(前=y+、右=x−,由校准实测),既然两台相机一样,两名玩家的 raw 语义就完全一样 ⇒ **不要再乘 facing**。
- 本轮旧实现把 depth/horizontal 都乘了 `facing`,结果:P2 前推变下蹲、右推变左移(实机复现)。修正后双方统一:前推=跳、后拉=蹲、左推=屏幕左移、右推=屏幕右移。
- `facing` 仍然有用:判断"防御 = 按住**背向对手**的方向"(`horizontal * facing * (-1) > 阈值`)。
- 推论:凡"每个玩家一套操作"的设计,先问一句**两人看到的画面是不是同一幅**;是,就做绝对映射。

### 15.3 防御判定不能吞掉移动

- "背向对手推左右"在侧视下就是"往远离对手的方向推左右"——正是**后撤方向**。旧实现 `if (intent.guard) return;` 直接定身 ⇒ 玩家一按左右角色就不动,表现成**"左右移动失灵"**。
- 正解:防御期间照常横向移动,只是慢速(`GUARD_MOVE_SPEED_SCALE`,格斗游戏的防御后撤);"是否下蹲"只看有没有真的按后(depth),不再无条件 `isCrouchingFlag = true`。

### 15.4 `camera.clear()` 之后**不要**再 `setFov()`

- `setFov` 是**相机作用域**:`clear()` 会把玩家自己的视野设置还原回来(§13.5 实测)。
- 若清场时写成 `clear(); setFov({fov: 62})`,等于在复位之后又按上了一个 62 ⇒ 玩家回大厅后视野被永久顶成 62(实机"结束后 FOV 残留")。
- 正确清理 = `camera.clear()` + `camera.stopShaking()`,**不碰 setFov**;外部改过 FOV 的场合(KO 特写 38°)要让侧视相机 `invalidate()` 掉缓存,否则它会因为"缓存里还是 62"而**不重发**,38° 一直粘到下一局。

### 15.5 快捷栏技能键:**边缘触发**识别 + **每 tick 钉回空手格**

- 每 tick 读 `player.selectedSlotIndex`,只要非 0 就当"按了一下" ⇒ 一旦客户端本地预测把槽位刷回来(复位没生效),同一格会被**每 tick 起手一次**(实机表现:"跳格连放技能")。
- 正解:**按键识别**用边缘触发 —— `world.afterEvents.playerHotbarSelectedSlotChange`(+ `{ allowedSlots }` 过滤)才是真正的"玩家换了格";把它记进一个待消费队列,由 tick 循环消费。事件不可用时用"槽位变化"轮询兜底;事件写入时同步更新轮询的"上次观测值",两条来源不会重复触发。
- **★复位不能挂在"按键那一支"上**(第二轮实机踩到的坑):边缘触发一旦确认过某格,后续每 tick 都 `continue`,于是**再也没人写回 0**,槽位就永远卡在被选中的格子上 —— 实机反馈正是"选了技能格不会迅速回到原物品栏"。
  - 正确做法:**每 tick 无条件**把槽位钉回第 1 格(放在 `tick()` 末尾,所有阶段都生效,且不会漏掉按键);
  - 再加一层:`playerHotbarSelectedSlotChange` 回调里**立刻**写一次 `selectedSlotIndex = 0`,把"最多晚 1 tick"压到 0。after 事件若是受限上下文,这一句会抛错 ⇒ 用 try/catch 吞掉,交给每 tick 的复位兜底。
  - 回环安全:我们自己写 0 若又触发一次事件,`newSlotSelected = 0` 会被 `slot <= 0` 直接丢弃。
  - 振荡安全:同一格在 4 tick 内的重复上报(客户端把槽位刷回来 → 又产生一次 0→N 变化)按"同一次选择"丢弃,否则"钉回 0"和"刷回 N"会互相激成连放。
- `selectedSlotIndex` 是**可写**属性(d.ts:`selectedSlotIndex: number`,仅"不能在 restricted-execution 模式编辑"),所以 `system.runInterval` 里写它是合法的 —— 复位不生效时先怀疑"没写",再怀疑"被客户端刷回"。

### 15.6 侧视相机"看着太近 / 会抖"的三条经验

1. **别用 FOV 当变焦**:FOV 一变等于整幅画面缩放,既抖又容易过头。固定 FOV,用**机位距离**表达远近。
2. **距离由取景需求反解**:`需要覆盖的视野半高 = max(取景半高, (两人距离/2 + 左右余量)/宽高比)`,`R = 半高 / tan(FOV/2)`。这样"贴身"与"拉开"都能自动装下,且 R 随距离连续变化(不会突然跳)。
3. **平滑 = 脚本侧指数平滑 + 引擎缓动首尾相接**:目标是"每 2 tick 发一次、easeTime = 0.1s(= 节流间隔)、easeType = Linear",这样每段缓动正好走到新目标,连起来是匀速运动(InOutSine 在每段内又加速又减速 ⇒ 叠起来一顿一顿)。大幅换位(换局、从特写回位)才切成长缓动 + InOutSine(参考 Collapse 的 `GLIDE_TICKS` 做法)。
4. 相机 y / pitch:`pitch` 由几何算(`atan((相机高 - 落点高)/R)`),不要写死固定俯角——机位一拉远,固定俯角就会"越看越偏下"。

## 16. 横板格斗:本体出场/击倒/跳跃越人(2026-09-25,AllStars 第三轮)

### 16.1 "玩家本体不出现在场地里"的正确做法:地板下的**后台暗格**

- 只靠隐身不够:隐身不隐藏**手持物**、也挡不住第三人称/名字牌;而"控制笼"原本就在擂台上,
  本体和前台角色重叠 ⇒ 一定会有穿帮。
- 做法:控制笼锚点搬到**擂台地板正下方**的小平台(同维度、同常加载区、y 递减 4 格),
  相机是脚本下发的侧视 free 相机,与本体位置无关 ⇒ 场地里只剩前台角色。
- 三个必须一起处理的坑:
  1. **选人阶段也得下发相机**(`SideCamera.preview()`),否则玩家盯着后台小房间的墙;
     而且 preview 只能在"从未下发过"时用长缓动,否则整个选人阶段每 tick 重发一条 0.5s 缓动指令。
  2. **别用 `buildPad()` 铺地板下方的东西**:它会顺带清出 `ARENA_HEADROOM` 高的净空,
     而净空范围正好包含擂台地板 —— 一清就把地板打穿。手工 `fillBlocks` 只动必要的那几层。
  3. **平台要自愈**:旧存档不会重跑建图命令,进笼时检查脚下方块,是空气就补一块小平台;
     否则玩家会一直往下掉(本体隐形看不出,但落地伤害/位置异常迟早爆)。
- 后台位置必须落在**模板复制区**内(否则 `tmp ap` 复制不到各房间);相对地,房间 y 下限就是复制区下限。

### 16.2 击倒要区分"击倒流程"与"KO 倒地"

- 两者都进 `state = "down"`,但 KO 的倒地**永不自动起身**。如果只有一个"倒计时到点就起身"的
  `tickDown()`,KO 败者会在下一 tick 被"扶起来"——必须让 KO 走 `playDown()` 并写一个
  `downUntilTick = MAX_SAFE_INTEGER`(或加"downUntilTick <= 0 直接返回"的护栏)。
- 击倒期间建议**免疫伤害并让对手的攻击落空**:否则贴脸连打会把人永久锁在地上,
  体验是"倒地即死"。攻击落空要做到 `tickMove` 层(`if (opponent.isDown && INVULNERABLE) return`),
  只在 `receiveHit` 里拦会让招式仍然"消耗掉"这一击。
- 倒地期间还要屏蔽 `tickPhysics` 里的**空中循环动画**(`air_rise/air_fall`)与**落地动画**
  (`jump_land`),否则"被摔飞"的动作会被它们顶掉 —— 状态机与物理的优先级要显式写出来。
- 防御成功**不**计入连击:否则一直按着防御也会被判"连打倒地"。

### 16.3 跳跃要能"从对手头顶越过去"

- 两个独立条件,缺一不可:
  1. **顶点高度 > 对手碰撞箱高度**:`apex = v²/(2g)`。本轮 0.42/0.045 只有 1.96 格,
     对手 2.9 格 ⇒ 实机就是"跳不过去、像穿模";改成 0.58/0.052 ⇒ 3.23 格。
  2. **空中不做"最小间距"分离**:角色间防重叠的推挤是每 tick 施加的,不按高度分层的话,
     起跳后会被水平推开、永远越不过去。给高度差设阈值(`MIN_GAP_IGNORE_HEIGHT`),
     超过就跳过分离,落地后自然恢复。
- 把这条做成 `diag` 的一行输出(顶点/滞空/横移),调参时不用进游戏试。

### 16.4 动画资产审计要"机器可查"

- "每个技能都有对应动画吗"这类问题不能靠眼看:`scripts/allstars-audit-clips.mjs` 做三件事 ——
  ① 生成清单 ↔ 客户端实体 `animations` 双向核对(漏登记 = `playAnimation` 静默失败);
  ② 扫 `src/` 里像动画 id 的字面量,与清单比对(拼错 = 静默失败);
  ③ 按"技能 × 站姿"打印解析结果与时长矩阵。
- 注意排除**生成文件**(`src/data/*`):那里的键是帧数据的短名(`crouch_light`),不是动画 id,
  不排除会报一堆假问题。有条件把这类审计做成 `npm run` 脚本,当 CI 门禁用。

## 17. 横板格斗:动画排队 / 开场运镜 / 双击突进(2026-09-25,AllStars 第四轮)

### 17.1 ★ 同一 tick 连播两段动画 = 第一段**完全看不到**

- `playAnimation` 是"把当前动画设成这一段",没有队列。所以
  ```ts
  playClip(entity, "victory_round", { force: true });
  playClip(entity, "victory_round_idle");      // ← 同一 tick 立刻把上一段顶掉
  ```
  的结果是**胜利动画一帧都看不到**,只播了待机循环。实机反馈就是"赢了没有胜利动画"。
  同样的写法让"KO 摔倒动画"也一直被 `idle_down` 顶掉。
- 正解:用**延后衔接**(本仓库 `queueClip(key, clipId, ticks)`,内部按 `system.currentTick`
  到点再播),把循环待机排在主动画的长度之后:
  ```ts
  playClip(entity, "victory_round", { force: true });
  queueClip(key, "victory_round_idle", clipGameTicks("victory_round"), true);
  ```
- 排查线索:凡"某段动画看起来从来没播过",先检查它后面同 tick 有没有第二段 `playClip`;
  这类 bug **不会报错、不会打日志**,只会安静地少播一段。
- 同理要注意 `clearQueuedClip` 的时机:被击倒 / 起手大招(forceClip)时要清掉待播队列,
  否则上一状态排的待播动画会在新状态里冒出来顶掉画面。

### 17.2 开场运镜(近景展示 + 标注谁操控谁)

- 需求:"开局用近景运镜展示两个角色的开场动画,并显示分别是哪个玩家操控的"。
- 实现要点:
  1. 运镜**必须接管侧视相机的每 tick update**,否则全景逻辑会把特写顶掉 ——
     `Match.tickIntro()` 在"开场运镜"分支里只调 `camera.introCloseUp()`,不调 `updateCameras()`。
  2. 每人一段、段内做一个横向 `drift`,就有"运镜"而不是定点呆看;
     **换人时**先 `invalidate()`(作废缓存 + 下一次用长缓动)⇒ 相机从上一个特写滑到下一个,不硬切。
  3. 特写结束回到全景同样要先 `invalidate()`,否则第一帧用 0.1 s 短缓动位移 8 格 = 硬切。
  4. 运镜只在**第一局**:后续换局给个短停顿即可(常量 `ROUND_INTRO_TICKS`)。
     `setupRound()` 是全局面共用的,必须用 `this.round === 1` 区分。
  5. HUD 上写明"谁操控谁":两名角色同模型同贴图时,这是**唯一**能区分的手段;
     文案拼进已有的 phaseLine 即可,不用加新的 TextPrimitive 形状(空文本也可能画出底框)。

### 17.3 双击突进:边缘检测 + 方向归一

- 只认**边缘**(上一 tick 未过阈值 → 这一 tick 过阈值)才算"按了一下",按住不放不会连发;
  用掉一次双击后立刻清掉记录,避免"三击连冲"。
- 触发的方向用**绝对屏幕方向**(见 §15.2),再交给角色判断"这个方向是不是朝对手"⇒
  朝对手播 `dash_forward`、背离播 `dash_backward` —— 这就是"按实际情况调用向前/向后突进"。
- 位移时长取**动画长度**(本轮 `dash_*` 是 6~7 tick):动画放完位移正好结束。
  若位移比动画长,角色会"动画播完了还在滑";重复 `playClip` 同一段又会把动画闪回开头。
- 突进期间 `busyUntilTick` 锁普通操作,同时**输入缓冲**把这段时间按的攻击键接上(冲刺结束自动起手),
  手感上就是"冲刺取消接招"。

## 18. 横板格斗:受击方动画 / 失败分支 / 分段位移(2026-09-25,AllStars 第五轮)

规格给的核心原则:**按键 → 状态与目标检查 → 播施放者动画 → 到判定时间 →
服务端确认命中/防御/落空 → 才给受击者发对应动画**,双方共用**同一个动作时钟**。
这一轮把资产里剩下的 17 段全接上,踩到的点记在下面。

### 18.1 `*_victim` 绝不能绑定玩家按键

- 受击方动画(MOH 里所有 `super_N_victim` / `leaf_launch_*`)= "服务端确认命中后自动触发"。
  实现上就是:**施放者**在自己的 `tickMove` 判定成功那一刻,把"风味"(HitFlavor)传给
  `opponent.receiveHit()`;受击者据此决定播什么。这样被防御/落空时天然不会播。
- 三气是分段时间线,受击方必须按**同一段名**配对(`${stageId}_victim`),由 Match 的时间线
  在"施放者播这一段"的同一 tick 一起发下去,否则两边动作会错拍。
- **被动受击动画要顺带把硬直撑到动画长度**(`busyUntilTick = max(hitstun, clipTicks)`),
  否则配对动画(比如 2.2s 的二气受击)会被短硬直腰斩成半截。

### 18.2 失败分支要在"判定窗口关闭那一刻"切,不是等整段动画放完

- 投技挥空、二气没抓到、三气首击没确认,都属于"这一发废了"。
  如果等整段动画(投技 1.7s、二气 2.8s)播完再放 whiff,手感是**卡住不动**。
- 正解:在 `tickMove` 里"过了 active 窗口且未结算命中"那一 tick 立刻 `playRecovery(whiff)`
  —— 收招动画自己有时长,把它当作"这一发的结果"。
- 被防御同理:命中结算返回 `blocked` 时,施放者当场改走失败收招(规格:"敌人在捕获前防御成功")。

### 18.3 分段动作 = 共享动作时钟 + **真实位移**

- "俯冲 / 上挑"这类招式不是一段动画,而是 `start → loop×N → (hit|land|end)` 的序列:
  每段的长度**从资产换算**(`clipGameTicks`),用累计 tick 找当前段 —— 这就是"共享动作时钟",
  比手写"第几个基岩 tick 该播哪段"稳得多(资产一改长度就自动跟着走)。
- 位移由脚本给(引擎物理只负责重力):俯冲每 tick 朝对手前进 + 强制下坠;
  上挑每 tick 给一个向上速度。**动画只负责姿势**。
- 结束条件必须看**真实状态**:俯冲"真实落地"才切 land;"上挑结束后根据真实高度进入下落",
  不能因为"动画播完了"就把角色放回地面站着 —— 这就是规格里那句
  "不能仅凭动画播完就站在空中"。实现上就是让 `enterIdle()` 按 `isGrounded()` 决定 idle/air。
- 分段动作的垂直命中容差要放宽:上挑时本体自己会被抬到 2~3 格高,用常规容差会在半程就打不中地面目标。

### 18.4 被击飞:倒地状态要按"真实在空/真实落地"驱动动画

- 把"倒地"从"三段固定动画"升级成 `DownPlan { enter, airLoop?, landClip?, idle, totalTicks, pop, knockback }`:
  `enter →(真实在空中)airLoop →(真实落地)landClip 一次 → idle → getup`。
- 关键点:**只有真的在空中待过才播落地收势**(`downWasAirborne` 标记),否则地面上的普通击倒
  会莫名其妙播一次"落地"。
- KO 的倒地是特例(`totalTicks = MAX`),它不进"到点起身"流程;忘了这点,KO 败者会被
  下一 tick 的 `tickDown` 扶起来。

### 18.5 动态拼出来的动画名会让静态审计误报

- `match.ts` 里三气受击方是 `${stageId}${SUPER_3_VICTIM_SUFFIX}` 拼出来的,
  所以"扫源码字面量"的审计脚本会把 `super_3_confirm_victim` 这类报成"未使用"。
  审计脚本必须**按同样的规则展开**(用配置里的段名列表生成候选名),否则结论会误导人。
- 这一轮的实际收益:审计跑到"**清单里从未在 src/ 出现的动画:全部用到**" —— 86 段资产
  每一段都有明确触发路径,不再有"资产有、代码没接"的死段。

## 19. 独立道具(末影珍珠 / 命令方块)与源资产 metadata(2026-09-25,AllStars 第六轮)

### 19.1 "资产里明明有模型,游戏里怎么没有?" —— 先看它是不是**骨骼**

- 源资产 `props/` 下有 `ender_pearl.geo.json`(121 方块薄模型)与 `command_block.geo.json`,
  但**角色动画 JSON 里搜不到任何 pearl/command 通道**(34 条通道全是身体骨骼)。
  ⇒ 它们是预览器里"挂在手骨上的独立道具",不是角色的一部分。
- 所以 Bedrock 侧只有一条路:**独立实体**,每 tick 传送到手的位置。
  (另一条路是让模型作者把道具烘成骨骼加进角色 geo —— 那要动模型,脚本侧做不到。)
- 落地时踩的两条老坑都适用:客户端实体用**内建 `controller.render.default`**、
  行为包里**不写 `scripts` 块**(见 §14)。
- `minecraft:scale` 在当前版本是**只读**的(`EntityScaleComponent.value: readonly`),
  运行时改不了大小 ⇒ 玩具尺寸要烘进实体 JSON(本项目的道具源尺寸是给近景镜头做的,
  侧视机位 11 格外必须放大,`scripts/allstars-ingest-props.mjs` 的 `SCALE` 就是干这个)。

### 19.2 手部挂点只能"估",而且要留可调常量

- ScriptAPI **没有取骨骼世界坐标的接口**,所以"手在哪"只能按
  `角色位置 + 朝向 × 前偏移 + 侧偏移 + 高度` 估。
- 关键经验:一定要**统一朝相机偏一点**(本项目 `PROP_HAND_TOWARD_CAMERA`)——
  否则道具会被角色身体挡住,看起来像"没加载"。
- 把这些偏移全部做成常量,并允许实机一眼调;道具是纯表现层,偏移错了不影响任何逻辑。

### 19.3 源资产的 metadata 是**权威规格**,别自己发明触发时机

`source/v047/` 下每个系统都有一份 metadata(JSON),它们直接给出"什么时刻发生什么":

| 文件 | 给什么 |
| --- | --- |
| `motion_vfx_metadata.json` | intro / dash / throw 的分镜:`release`、`hide`、`afterimages`、`lift`、`travel`、`techWindow`、相机分镜(`introShots`) |
| `super_metadata.json` | 每一档大招的 `duration/contact/pearlGather/move/distance/hide/prop/propVisible`、失败分支、KO 倍率、运镜意图 |
| `combat_metadata.json` | 逐招真帧(startup/active/recovery) |
| `down_state_metadata.json` / `reaction_metadata.json` / `victory_metadata.json` | 倒地/受击/胜利的动作时钟 |

用法:实现前先读 metadata,把里面的**制作 tick(60/秒)换算成游戏 tick(20/秒)**
(`authoringToGameTicks`),再决定段长与触发点。本轮据此纠正了两个实测细节:

- 投技拆投窗口 `techWindow=[21,27)` = **2 游戏 tick**(不是 6);
- 冲刺的位移/珍珠终点要用**同一个可达终点**(`wall: sweep_clamp_motion_and_pearl_destination_to_same_reachable_endpoint`),
  不能各算各的。

### 19.4 表现层要能"整批收干净"

- 道具实体是"每 tick 生成/销毁"的东西,最怕漏:一场打完空中还飘着一颗珍珠。
- 做法:模块内维护 `Set<Entity>`(`liveProps`),除了各流程点名收,还提供
  `despawnAllProps()` 给换局/清场兜底 —— 表现层的资源一律走这条契约,逻辑层就不必关心。

## 20. 打击感:时停 / 定帧 / 慢放的分工(2026-09-25,AllStars 第七轮)

源资产把"打起来的手感"拆成三件**互不等价**的事,`super_metadata.ownership.presentation`
一句话写清了:

```
impact_hitstop_is_short_all_hits;  strong_slow_is_KO_only;  release_freeze_separate_and_not_simulated
```

| 机制 | 何时 | 数字(源资产) | 本仓实现 |
| --- | --- | --- | --- |
| **释放时停** release freeze | 大招**释放被接受**那一刻(不是命中) | `releaseFreeze.appliesTo=[super_1,super_2]`,冻结双方、施法者气场时钟独立 | `beginSuperFreeze`:关对手 Movement 权限 + 每 tick `clearVelocity` + 喂空意图;施法者动画照常 ⇒ 等价 |
| **命中定帧** hitstop | **每一次命中** | super_1 `hitPresentationTicks=4`、super_2 `=8`、三气首记 `duration=7`、终结 `=10`、被防御 `=2` | `Fighter.applyHitstop(ticks)`:停**位移/击退/垂直物理**,动画继续播;攻守双方 + 相机一起停 |
| **强慢放** strong slow | **只在 KO** | `ko.rate=0.1`,`sourceInterval=[22,30]`/`[124,132]`,`condition=confirmed_KO_only` | 无倍率接口 ⇒ 用「撞击定帧 10 + 停顿 34(大招 KO 52) + 特写 `setFov 38`」近似 |

要点与坑:

1. **定帧必须"双方 + 相机一起停"**(规格 `affected = both_actors_and_pearl_camera_clock`)。
   只停受击方会变成"我这边卡了";把相机也停住才有"全世界顿了一下"的重量感 ——
   实现上就是定帧窗口内 `updateCameras()` 直接 return。
2. **`playAnimation` 没有 speed 参数**:任何"改播放倍率"的规格(0.1 倍速慢放)在脚本层都做不到。
   可用的替代只有三种:① 定帧(pause);② 拉长停顿;③ 让模型作者**烘一版慢速动画**。
   别在代码里找"设置动画速度"的接口 —— 会白花时间。
3. 规格里所有时间都是**制作 tick(60/秒)**;定帧这种"几 tick"的量要按 20/20 直接用
   (游戏 tick),而动画段长用 `clipGameTicks()` 换算 —— 两者别混。
4. 定帧期间**不要**跳过动画/状态推进:我们只停物理段(`tickPhysics` 里 `inHitstop` 直接
   `commitPosition()` 返回),动画与状态机照常,所以"顿住"不会把连段窗口/硬直算错。

### 20.5 ★ 演出阶段(KO / 回合结束 / 整场结束)必须显式"推进动画"

- 现象:KO 之后"没血的那个人"**没有持续倒地** —— 停在摔倒动画的最后一帧。
- 根因:这三个阶段**不调用 `Fighter.tick()`**(设计上不该跑输入/物理/命中),
  但"摔倒 → 躺地"的衔接恰恰挂在 `tick()` 里的 `flushQueuedClip` / `tickDown` 上。
  没人推 ⇒ 排队的 `idle_down` 永远不播 ⇒ 非循环的 `knockdown` 播完就定格
  (引擎会把最后一帧一直保持,看起来像"半倒不倒")。
- 正解:给 Fighter 加一个**只推进画**的入口 `tickPresentation()`
  (补播排队衔接 + 推倒地动作时钟),在 ko/roundEnd/matchEnd 三个阶段每 tick 调用。
- 连带的两条:
  1. 别用两套机制写同一段动画:`playDown()` 里既 `queueClip(idle_down)` 又让
     `tickDown()` 到点播 `idle_down` —— 保留**一个**(现在归 DownPlan 的时钟),
     否则两处互相顶、还会掩盖"没人推"的问题。
  2. `playDown()` 要**幂等**:KO 阶段 → `endRound` → `beginMatchEnd` 会重复调用它,
     不去重的话败者会"重新摔一次"。
- 通用教训:**凡是"动画靠 tick 驱动"的项目,任何"冻结世界但还要播动画"的阶段
  (KO、结算、过场)都要显式留一个只推动画的 tick 入口**;否则症状永远是
  "某段动画卡在最后一帧"。


## 21. AllStars 时钟与资源修正（2026-09-26）

§19–20 是历史实现，以下纠正优先于旧结论，当前进度统一见 [HANDOVER](../AllStars-灯塔全明星/HANDOVER.md)。

- `playAnimation` 没有 speed 参数，不等于原生骨骼动画不能变速：BP client_sync 属性可作为 RP `anim_time_update` 源时间；冻结/0.1 倍速由共享逻辑时钟控制。旧“动画继续播就等价时停”结论错误。
- 一二气释放冻结双方。定帧也暂停骨骼、判定和硬直 deadline，不能只停物理或清空击飞速度。60 制作 tick 与 20 游戏 tick 必须换算，不能把 metadata 的 7 制作 tick 直接当 7 游戏 tick。
- 配对段起播不是伤害事件，尤其二气捕获、三气 confirm。伤害按实际 contact marker 触发；终结刚开始也不能解锁。
- 当前实体格式 `damage_sensor.triggers.deals_damage` 用字符串 `"no"`，不是布尔 false。内容日志已给出明确 schema 错误。AllStars manifest 额外声明 data module；客户端实体使用独立 RC，避免同名默认控制器冲突。
- 某一房换局时不能调用无过滤的全局道具/输入清理。按维度及玩家 ID 限定。
- 参数化 RC 的 `color.a` 通过静态检查不代表材质使用最终 alpha。半透明 PNG、随后二值 alpha 的溶解 PNG 均被用户反馈为丢皮肤。已检查原皮肤和溶解 PNG 都只含 0/255 alpha，因此不能把新故障等同“不兼容所有小数透明度”。最新版本先停用过渡贴图，两套原皮肤使用固定纹理控制器，仅做布尔可见性；半透明/溶解暂不启用。
- 资产可加载检查、API 替身测试、真正客户端观感验收是三种不同证据，记录时不要混称“实测通过”。

### 21.1 实体 float 属性必须保留浮点数字写法（2026-09-26 实机故障）

新增 `allstars_opacity` 后，`JSON.stringify` 把默认值输出为整数 `1`；游戏内容日志明确报 `default value does not match the specified type float`，春叶和残影的整个实体定义注册失败。即使 JS 源码写成 `1.0`，直接 stringify 后仍是 `1`，手动修生成文件也会在下次构建时丢失。

实体生成器现通过 `scripts/bedrock-entity-json.mjs` 保留 float 属性默认值及范围的 `0.0 / 1.0 / 60.0`。`npm run check` 检查原始数字文本，不能先解析成 JS number 再比较。新增回归已证明错误旧文件被拦下，修正版通过；模拟 `spawnEntity` 成功不证明客户端能注册实体。当前部署和待验收状态统一见 AllStars `HANDOVER.md`。

### 21.2 道具渐变必须使用所属房间的演出时钟

珍珠的 `bearcade:prop_scale` 和二气框体的 `bearcade:cage_time` 是客户端同步 float 属性，经相同序列化器输出。珍珠最新改由 client entity `scripts.scale` 读取属性（原版羊也使用该通道），框体用独立 XYZ 表达式动画；旧道具动画文件在 03:45 实机加载失败。珍珠正常退场调用 `dismissProp`，保留至缩小完成；换局等硬清理立即删除。每房只推进本房维度的共享时间，避免时停/慢放或多房并发失步。

### 21.3 快捷栏 API 可写不等于客户端选中框已经同步

2026-09-26 用户再次反馈短按 2～7 不回第 1 格。旧实现既在选中 after-event 内写回，又在每 tick 仅当服务端读到非 0 时写回；一旦服务端已经是 0，补写条件就不成立，异常又被吞掉。不能由这个证据断言目标版本完全不支持，也不能把类型声明可写等同“实机已修复”。

最新方案撤去事件内原生写入，把首次写回排至下一游戏 tick，后续两 tick 再写；即使服务端读到 0 也完成重试。成功日志明确只报告 server，失败日志保留原始异常并节流。Match 在 finally 推进回位，按房间玩家清理待回位状态。该时序已自动验证，但真实客户端是否同步仍须重进验收。官方属性说明：[Player.selectedSlotIndex](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/player?view=minecraft-bedrock-stable#selectedslotindex)。

大招采用方向修饰键时，选中事件必须同时采样方向；缓冲存档位而不是只存技能槽，否则松开 W/S 后会变成一气。读取修饰键不能再次消费双击方向的边沿。气量只验证是否可支付，不能反过来替用户选最高档。

### 21.4 原生渲染资源要检查引用，客户端高亮要单独验收

03:45:02 内容日志拒绝 `allstars_props.animation.json`，随后累计 257 次 `can't find animation size`；03:45:04 还拒绝 cage RC/客户端实体。JSON 可解析、属性数值在模拟器变化都不能证明动画已加载。珍珠改用整体 `scripts.scale`；框体改为明确 XYZ 表达式及资源数组选择。`allstars-render-validation.mjs` 现检查纹理、动画与条件控制器引用，并对目标客户端采用保守写法检查；它不是完整官方 schema，不能声称已经确定日志未报告的具体失败字段。

选中槽逻辑回位后显示仍旧时，本轮尝试只把原生 Hotbar 隐藏 1 游戏 tick 再恢复，可能出现一帧闪动。记录并恢复本轮拥有的可见性，尊重原本已隐藏的 HUD，按玩家清理；不使用全局 `resetHudElementsVisibility`。无论测试替身还是服务端日志都不能验证真实选中框重绘，最终仍以新客户端反馈为准。

**后续客户端反馈：** 用户已确认 04:29 版本解决此前自动回位显示、紫黑纹理和珍珠缩放等问题。保留这个实机证据；当前原皮肤＋布尔可见性有效，不代表半透明渐变已经实现。

### 21.5 位移粒子与胜利演出必须尊重真实位置

升龙和俯冲曾共用 `applyProjectileBurst`，因而人物斜向移动、叶片却水平飞。位移发波改为在角色 tick 之后读取实际位置差，归一化为粒子方向，持续补发且按房间/角色侧节流。既能跟随转向，也能反映重力和场边截断；无位移、时停、命中/落地收招时不补移动叶流。升龙从轨迹反投的地面发射，俯冲按到地距离约束寿命，站立远程波保留自己的独立时钟与射程。

战斗结束阶段不再跑普通角色物理，不能直接在空中 `playVictory`。现在用 pendingVictory 等待下落和落地动画，再起播胜利并排队胜利待机；Match 同步延长结算截止时间，等待不能挤掉胜利演出。落地容差内要把实际坐标吸附到地板，避免数值已判 grounded、实体仍高出一点。回合重置/倒地要取消待播胜利。

命中还会提前退出角色 tick；位移招已更新的 localAxis 必须在这一返回路径提交，否则会在定帧结束后才补出最后一段位移，看起来像命中后又滑了一步。本轮回归已覆盖此路径及两侧叶流、50% 水平增幅、空中回合/整场胜利和完整结算时长。

### 21.6 “演出完成但血条不变”要同时核对伤害与显示

用户报告三气完整七连击及终结播放后偶发血条不减。扩展 P1/P2 × 普通/残血四组回归，确认每次接触后真实 HP 与原生 HUD 内容均更新、满血目标最终 100→74；当前没有复现用户客户端根因。

发现 HUD 的 setLocation/setText 共用静默 catch，原生形状失效时可能永久显示旧血条。改为先更新数值，更新失败清掉并重建本房形状，再失败以文字 HUD 显示当前值，记录一次恢复警告；不会清其它房间形状。故障注入已验证旧形状恢复与降级，不能将注入故障当作用户实机根因的证据。血条增加明确 HP，扣血后跳过普通 HUD 节流；每次已确认三气在退出时间线时记录命中数、实际总扣血和前后 HP，下一次客户端复现才能区分真实漏结算与显示不刷新。命中计数放在 receiveCinematicHit 成功之后，避免先消费尚未完成的结算。

命令方块与珍珠现共用 propScales 生命周期及 scripts.scale，不要给方块另建一套独立计时器；诊断探针传 animate=false 后由探针自己写缩放，避免离开比赛时钟后一直停在最小尺寸。
