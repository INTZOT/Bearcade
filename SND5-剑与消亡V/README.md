# 剑与消亡V(SND5)

Bearcade 小游戏包(7 职业 PvP:剑与消亡V · 上密会战)。房间/模板/上报/HUD 通道复用 `shared/minigame-core` + `Core-核心`;包内实现**会话化战斗框架层**(`src/framework/`)+ **注册式内容层**(`src/content/`)。

> 设计依据:《SND5 架构设计 v2 · Bearcade 适配版》 + 《SND5 内容设计》PDF。
> 当前进度:**框架层就绪;内容层已实装「准备阶段职业选择」与「战士」全量内容(武器 + 两个主动 + 被动 + 状态/元素反应)**;对局层(占点/计分/补给)框架就绪但数据待填;场地与自定义物品/实体仍为占位。

## 当前状态

- 基础设施:房间/模板维度注册、模板捕获 → 复制 → 常加载、`game.register` / `room.status` 上报与心跳、对局状态机(空闲 → 倒计时 → 运行 → 结算 → 重置)、房间保护、结束回大厅、强制中断;
- 框架层(`src/framework/`):
  - `session.ts` MatchSession 聚合根 —— 多房间并发,事件订阅/定时器/创生物随会话全量回收;
  - `attribute.ts` 三资源账本(HP/护甲/魔力/临时护甲,比例映射原版血条,快照恢复);
  - `status/` 状态系统(叠层/互斥/进化/modifiers 聚合/收束标志位);
  - `combat/` 六阶段伤害管线(元素 × 状态反应表、真实伤害、致死拦截、击杀归属);
  - `skill/` 技能调度(instant/charge/windup/channel 四种施法模式、四段式冷却、堆叠串联、被动 = 事件订阅者、效果原语 Primitives);
  - `summon.ts` 创生物系统(实体承载 + tag 清扫,投掷物命中转发);
  - `score.ts` / `capture.ts` / `supply.ts` 占点计分 / 占点双段读秒 / 补给站 20s 限频 —— 占点产分曲线 [0,1,2,4,8,16]/s(占下即产分,离人不中断),任意阵亡对方 +5,先到 2000 分获胜,20 分钟到点比总分(平分平局);占领:中立点独占累计 20s,敌方点接管累计 40s,双方同点进度暂停;
  - `hud.ts` 右侧面板 HUD(比分/三资源/冷却/占点/状态效果,title 通道渲染;状态行正面绿、负面红、附剩余秒数);
- 内容层(`src/content/`,**已实装**):
  - **准备阶段职业选择**:进入房间维度发山羊角 → 右键表单选择 → 开局 `loadoutFor` 消费;7 职业中仅战士 `available: true`,其余 6 个为面板占位(选择界面显示「开发中」);
  - **战士**:面板 100/50/100,武器「弧光」轻击/重击,固有Ⅰ 突进、固有Ⅱ 球状闪电、固有Ⅲ 雷魂(被动);
  - **状态与反应**:重伤、零火、电流涌动、电流迸发,以及「零火 × 电」的连锁反应;
  - 武器与技能**全部用原版物品占位**,见下方《操作与占位映射》;
- 对局层数据(`buildContentBundle()`):计分规则表 / 占点区域 / 7 个补给站坐标仍为空数组,待场地建好后填(不影响职业选择与战士战斗链路);
- 房间规模:`ROOM_COUNT = 2`、`MAX_PLAYERS = 2`、`START_POSITIONS` 两项也是占位,正式 4v4 前需调整 `src/config.ts`(引擎最少开局人数默认 2);
- 场地坐标全为占位(`src/config.ts`),模板维度需要先建场(见《开发流程》)。

## 玩法流程(当前可验证链路)

```text
大厅加入 snd5 房间(准备阶段,phase = idle/pending)
      │  进入房间维度 → 发放山羊角
      ▼
右键山羊角 → 职业选择表单(仅「战士」可选)
      │  选择记在内存,准备阶段可反复改选;离线清除;未选择兜底战士
      ▼
开局 onGameStart → 分配红/蓝队 → 清空背包 → 按职业发放套装
      │  武器槽 + 2 个技能物品 + 名牌前缀 + HUD(职业/三资源/技能冷却)
      ▼
对局:左键轻击 / 潜行+左键重击 / 右键技能物品施放
      │  原版伤害全部拦截,数值统一走 CombatPipeline
      ▼
死亡(脚本死亡)→ 旁观 → 8 秒后重生(默认值,`runtime-config.ts` 可改)→ 全量重发套装
      │
      └─ 结束(当前仅计时到点/强制中断;计分规则待填)→ 回大厅 → 整房模板重建
```

## 操作与占位映射

| 操作 | 当前实现(占位) | 最终设计(内容设计 PDF) | 替换方式 |
|---|---|---|---|
| 轻击 | 左键普通攻击(`minecraft:iron_sword`) | 7 点近战 | 数值已在内容层,无需换实现 |
| 重击 | **潜行 + 左键** | 蓄力 0.7 秒 → 半径 3 格半圆 12 点 + 重伤 | 原版剑没有 `use_duration`,无法蓄力;换自定义武器物品 + `charge` 施法模式 |
| 固有Ⅰ 突进 | 右键 `minecraft:carrot_on_a_stick` | 13s CD / 0~5 魔力 | 换自定义技能物品 + `snd5:skill_trigger` 组件 |
| 固有Ⅱ 球状闪电 | 右键 `minecraft:warped_fungus_on_a_stick` | 18s CD / 20 魔力 / 堆叠 2 | 同上;投射物换自定义实体 |
| 固有Ⅲ 雷魂 | 被动,无物品 | — | — |
| 职业选择 | 右键 `minecraft:goat_horn` | 准备阶段表单 | 换自定义物品或 Core 菜单入口 |

> 占位物品选用原则:右键能触发使用事件。胡萝卜钓竿/诡异菌钓竿是原版少有的「手持可用」物品,右键不消耗、不放置,适合当技能触发器;山羊角自带音效,兼作操作反馈。普通纸张/木棍右键不触发使用事件,不要拿来占位。

## 战士实现细节

内容文件:[professions/warrior.ts](src/content/professions/warrior.ts)、[skills/warrior.ts](src/content/skills/warrior.ts)、[statuses/warrior.ts](src/content/statuses/warrior.ts)。

| 项 | 实现 |
|---|---|
| 基础面板 | 生命 100 / 护甲 50 / 魔力 100 |
| 武器「弧光」 | 轻击 7 点物理近战;重击(占位)半径 3 格 180° 半圆 12 点物理,命中所有敌方并施加重伤;近战触达上限 5 格 |
| 固有Ⅰ 突进 | 魔力 5、CD 13 秒、堆叠 1;向前突进 3 格后对半径 5 格 180° 范围造成 20 点电伤,命中后按总伤害 10%(至少 1)回血;**未命中退还 5 魔力**;**潜行施放不突进**(`castSneaking` 变体) |
| 固有Ⅱ 球状闪电 | 魔力 20、CD 18 秒、堆叠 2;投掷物 3 秒引爆,半径 5 格内敌人按距离 5~30 点电伤并施加零火;占位用雪球承载,提前命中方块/实体则就地引爆 |
| 固有Ⅲ 雷魂(被动) | 击杀敌人:消耗最多 10 魔力,2 秒内缓慢回复 10 点生命,并获得电流涌动;若已处于电流迸发则刷新迸发(不降阶) |

状态与反应:

| 状态 | 规则 |
|---|---|
| 重伤 `snd5:grievous_wound` | 10 秒,受到的治疗量 ×0.8 |
| 零火 `snd5:zero_fire` | 10 秒;受到电属性伤害时本体额外 5 点电伤,并以 BFS 向 2 格内其他零火携带者连锁 5 点(深度上限 8,防乒乓) |
| 电流涌动 `snd5:current_surge` | 8 秒,轻击获得电元素附魔;期间再次击杀进化为电流迸发 |
| 电流迸发 `snd5:current_burst` | 8 秒,轻击电附魔 + 附加零火 + 命中回复 3 点生命;期间再次击杀刷新自身 |

> 重击、突进、球状闪电的伤害全部经 `CombatPipeline`,因此受伤/减伤/元素反应/致死拦截/伤害贡献对它们天然生效。

## 准备阶段职业选择

实现:[content/selection.ts](src/content/selection.ts)。

- 入口物品:`minecraft:goat_horn`(名称「职业选择(右键)」),仅在玩家**进入 `bearcade:snd5_<n>` 房间维度且该房间 phase 为 `idle`/`pending`** 时发放,背包已有则不重复发放;
- 表单:`ActionFormData`,逐条列出注册表里的职业;`available: false` 的职业置灰文案「开发中」,点击只提示不写入;
- 存储:模块级内存 `Map<playerId, professionId>`(准备阶段还没有会话,DynamicProperties 约定只放跨版本配置);离开服务器时清除;
- 消费:`game.ts` 的 `loadoutFor(playerId)` 在**开局与重生**时读取;未选择/职业未实装时兜底 `snd5:warrior`;
- 开局时套装发放会清空背包(山羊角一并清掉),因此选择只在准备阶段进行,对局中不能改选。

## 内容层与框架层的接线

```text
src/content/index.ts          ← 内容层唯一门面:import 即完成注册(职业/技能/状态/反应)
        ▲                              ▲
        │                              │
   game.ts(注入实现)            listeners.ts(原生事件路由)
```

`game.ts` 注入点(`SessionInjects`,会话在开局/重生时消费):

| 注入 | 作用 |
|---|---|
| `assignTeams` | 洗牌后红/蓝均分(2 队制) |
| `getRespawnLocation` | 按队伍返回 `START_POSITIONS`(占位:队伍出生点/部署点待场地) |
| `loadoutFor` | 职业 → 三资源面板 + 两个技能槽 + 被动 id 列表 |
| `onSessionStart` | 清空背包(含山羊角)→ 按职业发放武器/技能物品 → 名牌前缀 → 开局提示 |
| `onPlayerRespawn` | 重生后全量重发套装(架构 §6.3) |
| `weaponAttack` | 近战结算按职业路由到 `profession.handleAttack`(轻击/重击数值与附加效果由内容层决定) |
| `professionNameOf` | HUD 显示职业名 |

`listeners.ts` 适配层:

- `beforeEvents.entityHurt`:会话内玩家的原版伤害一律取消(数值统一由管线写入);
- `afterEvents.entityHitEntity`:`system.run` → `injects.weaponAttack(session, attackerId, victimId, isSneaking)`;
- `afterEvents.itemUse`:山羊角 → 职业选择表单;技能物品 → `SkillSystem.requestCast`(`skillItemBindings` 由职业定义文件注册);
- `itemStartUse` / `itemReleaseUse` / `itemCompleteUse`:蓄力/前摇/吟唱类技能;instant 技能在 `itemUse` 与 `itemStartUse` 两条路都会分发,由 `SkillSystem` 的**同 tick 去重**保证一次右键只放一次(原版物品的事件行为无法逐一实测);
- `projectileHitEntity` / `projectileHitBlock`:投掷物命中转发。**命中瞬间原版投掷物可能已被移除**,所以用 `event.dimension` + `projectile.id`(失效后仍可读)按创生物注册表反查,命中回调**同步**派发;不能对 `event.projectile` 调 `hasTag` / `dimension` / `location`(会抛 `InvalidEntityError`)。

新增职业只需在 `src/content/professions/` 加一个定义文件并在 `professions/index.ts` 注册,框架层零改动。

## 目录结构

```text
SND5-剑与消亡V/
├── src/
│   ├── main.ts                # 引擎接线 + startup 注册 + worldLoad 初始化
│   ├── config.ts              # 房间/场地坐标(占位)
│   ├── runtime-config.ts      # 热调参默认值(分数/重生/补给等)
│   ├── listeners.ts           # 适配层:原生事件桥 + 会话 tick 驱动
│   ├── game.ts                # MinigameHooks + SessionInjects 注入实现
│   ├── framework/             # 战斗框架(Attribute/Status/Combat/Skill/Summon/Score/Capture/Supply/HUD)
│   └── content/               # 内容层(纯定义)
│       ├── index.ts           # 唯一门面:import 即注册
│       ├── selection.ts       # 准备阶段职业选择
│       ├── professions/
│       │   ├── registry.ts    # 职业定义接口 + 注册表(含 handleAttack)
│       │   ├── index.ts       # 注册入口:战士 + 其余 6 职业占位
│       │   └── warrior.ts     # 战士:面板/武器/技能物品/近战结算
│       ├── skills/warrior.ts  # 突进 / 球状闪电 / 雷魂(被动)
│       └── statuses/warrior.ts # 重伤 / 零火 / 电流涌动 / 电流迸发 + 零火反应
└── README.md
```

> `manifest.json` 与 `scripts/main.js` 为构建产物,不入库。

## 开发流程

```bash
npm run typecheck && npm run check && npm run build
```

1. `/bearcade:tmp tp snd5` 进入模板维度建场地(**当前必须先建场**:自定义维度默认是虚空,准备点/开局站位都在空中);
2. 模板范围用 `/bearcade:tmp sz snd5` 表单配置起始点/终点(默认 ±7 全高);
3. 场地改好后 `/bearcade:tmp ap snd5` 一键应用到全部房间;
4. 在 [src/config.ts](src/config.ts) 填写坐标(模板范围、复制原点、准备房间、常加载区域、开局站位);
5. 场地建好后把占点区域/补给站/计分规则填进 `game.ts` 的 `buildContentBundle()`;
6. 重新 `npm run typecheck && npm run build`,部署后在房间内验证。

> 进入模板维度/应用模板/强制中止命令由 **Core 统一提供**:`/bearcade:tmp tp|ap|sz snd5`、`/bearcade:quit`,小游戏包无需自己注册命令。

## 待办

1. **场地与对局层**:模板建场(含 7 个补给站)、占点区域坐标、计分规则表(击杀/助攻/占点/驻守/首杀)、`openConfig` 热调参界面;
2. **其余 6 职业**:刺客/坦克/增益/控制/群法/单法(注册表已占位,`available: false`);
3. **消耗品与秘典**:血药 6s/80、甲修 1.5s/25、魔瓶 3.5s/50、秘典Ⅰ/Ⅱ 补货与施放;
4. **真实输入**:自定义武器物品(`use_duration`)+ `charge` 模式实现 0.7 秒蓄力重击;自定义技能物品(14 件)替换原版占位;
5. **自定义资源包**:武器/技能物品贴图与模型(只放贴图/模型,**不要放 `ui/hud_screen.json`**);
6. **调试**:`CastLogger`、`/snd5` 调试命令、多房间并发与残留实测。

## 常见坑

- **内容层导入路径**:`src/content/professions/*` 引框架是 `../../framework`、引 shared 是 `../../../../shared`;`src/content/*` 直接文件引框架是 `../framework`、shared 是 `../../../shared`。写错会报 `Cannot find module`;
- 内容层禁止 import `@minecraft/server`,只能经 `ctx.primitives` / `session` 门面执行动作;
- 原版近战伤害已被 `entityHurt` 取消,武器数值只能由 `profession.handleAttack` 写;漏写就是「打人没伤害」;
- 原版物品的右键事件行为不确定(有的只触发 `itemUse`,有的 `itemUse`+`itemStartUse` 都触发):instant 技能两条路都分发,靠 `SkillSystem.castInstant` 的**同 tick 去重**兜住;新技能/新输入分支不要绕过 `requestCast` / `beginUse` 自己直接调 `cast`;
- 山羊角只在房间维度 `idle`/`pending` 发放与响应,离开房间维度后右键无效(防大厅误触);
- 自定义命令回调和 before 事件跑在 restricted execution:传送/表单/生成实体的原生调用必须 `system.run` 延后;
- 投掷物命中事件(`projectileHitBlock` / `projectileHitEntity`)里的 `event.projectile` **可能已失效**(雪球/箭命中瞬间就被原版移除):失效后只有 `id`/`typeId` 可读,`hasTag`/`dimension`/`location` 会抛 `InvalidEntityError`。路由必须用 `event.dimension` + 创生物注册表按 id 反查、同步派发(见 lessons §1.5),不要用标签过滤;
- `entityHurt` 前事件只允许同步取消,伤害数值在 `system.run` 里经 CombatPipeline 写入;
- `Dimension.spawnEntity` 的 typings 只接受原版实体标识,自定义实体 id(`snd5:xxx`)需显式转换(见 `framework/summon.ts`);
- `Dimension.id` 返回完整命名空间 ID(主世界为 `minecraft:overworld`);
- 结构引擎上限 64×384×64,纵向取满为 y -64~319;
- 每包常加载 chunk 有上限,常加载区域只覆盖实际内容;
- DDUI 按钮文本不解析 `§` 颜色码,label 可以。

详细规范见仓库根目录 `development.md`;架构设计见《SND5 附加包架构设计 v2 · Bearcade 适配版》。
