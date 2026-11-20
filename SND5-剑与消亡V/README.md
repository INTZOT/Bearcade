# 剑与消亡V(SND5)

Bearcade 小游戏包(7 职业 PvP:剑与消亡V · 上密会战)。房间/模板/上报/HUD 通道复用 `shared/minigame-core` + `Core-核心`;包内实现**会话化战斗框架层**(`src/framework/`)+ **注册式内容层**(`src/content/`)。

> 设计依据:《SND5 架构设计 v2 · Bearcade 适配版》 + 《SND5 内容设计》PDF。
> 当前进度:**框架层就绪;内容层已实装「准备阶段职业选择」「刺客」「战士」「增益」「控制」「群法」全量内容(武器 + 主动/被动 + 状态)与 10 个秘典法术、回复类消耗品**;对局层(占点/计分/补给)框架就绪但数据待填;场地与多数创生物实体仍为盔甲架占位(抓钩绳体已用自定义实体 + `snd5_hud` 资源包渲染)。群法是首个使用**自定义物品**(`items/*.json`,原版贴图占位)+ **ItemCustomComponent 释放入口**的职业,控制/刺客沿用该模式;刺客的抓钩绳体是包内首个**自定义实体**(服务端属性 + 客户端 molang 拉伸渲染,见《刺客实现细节》)。

## 当前状态

- 基础设施:房间/模板维度注册、模板捕获 → 复制 → 常加载、`game.register` / `room.status` 上报与心跳、对局状态机(空闲 → 倒计时 → 运行 → 结算 → 重置)、房间保护、结束回大厅、强制中断;
- 框架层(`src/framework/`):
  - `session.ts` MatchSession 聚合根 —— 多房间并发,事件订阅/定时器/创生物随会话全量回收;
  - `attribute.ts` 三资源账本(HP/护甲/魔力/临时护甲,比例映射原版血条,快照恢复);
  - `status/` 状态系统(叠层/互斥/进化/modifiers 聚合/收束标志位);
  - `combat/` 六阶段伤害管线(元素 × 状态反应表、真实伤害、致死拦截、击杀归属);
  - `skill/` 技能调度(instant/charge/windup/channel 四种施法模式、四段式冷却、堆叠串联、被动 = 事件订阅者、效果原语 Primitives);
  - `indicator.ts` 攻击指示器(圆形/扇形/直线三种形状,self/team/all 可见性;`SkillDefinition.indicator` 在蓄力/前摇/吟唱期间自动显示并逐拍跟随,`primitives.showIndicator` 做落点闪烁;逐玩家渲染走 `Player.spawnParticle`,不可用自动回退全员);
  - `summon.ts` 创生物系统(实体承载 + tag 清扫,投掷物命中转发);
  - `score.ts` / `capture.ts` / `supply.ts` 占点计分 / 占点双段读秒 / 补给站 20s 限频 —— 占点产分曲线 [0,1,2,4,8,16]/s(占下即产分,离人不中断),任意阵亡对方 +5,先到 2000 分获胜,20 分钟到点比总分(平分平局);占领:中立点独占累计 20s,敌方点接管累计 40s,双方同点进度暂停;
  - `hud.ts` 右侧面板 HUD(比分/三资源/冷却/占点/状态效果,title 通道渲染;状态行正面绿、负面红、附剩余秒数);
- 内容层(`src/content/`,**已实装**):
  - **准备阶段职业选择**:进入房间维度发山羊角 → 右键表单选择 → 开局 `loadoutFor` 消费;7 职业中刺客/战士/增益/控制/群法 `available: true`,其余 2 个为面板占位(选择界面显示「开发中」);
  - **战士**:面板 100/50/100,武器「弧光」轻击/重击,固有Ⅰ 突进、固有Ⅱ 球状闪电、固有Ⅲ 雷魂(被动);
  - **增益**:面板 140/20/120,武器「水仙之梦」轻击 + spyglass 蓄力重击(weapon_heavy 伪技能,潜行蓄力=晨露对光的独白),固有Ⅰ 涤雨、固有Ⅱ 水仙庇护、固有Ⅲ 水仙之约(被动);状态清流/洁雨/水仙初临/水仙伴生(初临溢出进阶伴生、70 点伤害转魔力、伴生 1 次全额减免);
  - **群法**:面板 100/15/160,武器「周期」= 自定义物品(轻击 + 长按右键弓式蓄力重击),固有Ⅰ/Ⅱ 定律技能(自定义物品,潜行右键切定律、**定律类型由物品名显示**),固有Ⅲ 法力血契(被动,魔力不足生命代替);状态魔力残留/魔力凝聚 + 电离/焙烧/浸润互斥三角(获得时按被清空对象立即结算);
  - **控制**:面板 70/70/140,武器「不等式」= 自定义物品(轻击 + 长按右键蓄力重击,潜行释放回收浊露进阶**水的两面性**),固有Ⅰ 魔瘴之泉(盔甲架占位,托管血量 60)、固有Ⅱ 魔魇降临(首个 **channel 吟唱**技能)、固有Ⅲ 魔魂代偿(被动,致死拦截+魔力转生命);状态浊露(32 层梯度惩罚)/魔魇降临(受伤叠层,50 层掉固体灵魂)/魔魇噬魂;
  - **刺客**:面板 70/30/70,武器「横刀·离心」= 自定义物品(轻击 + 长按右键蓄力 0.5s 重击,击碎 20% 护甲上限),固有Ⅰ 抓钩(**Grappling Hooks Add-On 普通钩爪方案**:锁定摆荡 + 潜行收绳 + 全局 1t 物理,命中方块锚定/命中玩家牵拉 + 撕裂,锁定后叠**惯性**)、固有Ⅱ 定锚(首个**四段式冷却**二段施法技能:投掷不进 CD → 二段瞬移劈砍 18s / 定锚消失 9s)、固有Ⅲ 影遁(被动,技能后迅捷Ⅰ+隐身 1s);状态撕裂(受伤 +10% + 0.5s 跳伤)/惯性(叠层并刷新 1.5s 衰减窗,武器攻击消耗);
  - **状态与反应**:重伤、撕裂、惯性、零火、电流涌动、电流迸发,以及「零火 × 电」的连锁反应;
  - 战士/增益的武器与技能**仍用原版物品占位**,见下方《操作与占位映射》;群法已升级为自定义物品(`items/*.json`,贴图用原版材质名占位,无需资源包文件);
- 对局层数据(`buildContentBundle()`):计分规则表 / 占点区域 / 7 个补给站坐标仍为空数组,待场地建好后填(不影响职业选择与战士战斗链路);
- 房间规模:`ROOM_COUNT = 2`、`MAX_PLAYERS = 2`、`START_POSITIONS` 两项也是占位,正式 4v4 前需调整 `src/config.ts`(引擎最少开局人数默认 2);
- 场地坐标全为占位(`src/config.ts`),模板维度需要先建场(见《开发流程》)。

## 玩法流程(当前可验证链路)

```text
大厅加入 snd5 房间(准备阶段,phase = idle/pending)
      │  进入房间维度 → 发放山羊角
      ▼
右键山羊角 → 职业选择表单(刺客/战士/增益/控制/群法可选)
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

### 增益占位映射

| 操作 | 当前实现(占位) | 最终设计(内容设计 PDF) | 替换方式 |
|---|---|---|---|
| 轻击 | 左键 `minecraft:wooden_sword` | 5 点近战 | 数值已在内容层,无需换实现 |
| 重击 | `minecraft:spyglass` 按住右键蓄力 0.8s(weapon_heavy 伪技能,自带缩放瞄准) | 蓄力 0.8s → 视准心 r2 圆形 12 点水伤 + 友方清流;潜行=晨露 | 换自定义武器物品(use_duration),蓄力/晨露逻辑无需重写 |
| 固有Ⅰ 涤雨 | 右键 `minecraft:fishing_rod` | 19s CD / 25 魔力 | 换自定义技能物品 |
| 固有Ⅱ 水仙庇护 | 按住 `minecraft:shield`(前摇 1.2s 举盾) | 25s CD / 35 魔力 / 前摇 | 换自定义技能物品 |
| 固有Ⅲ 水仙之约 | 被动,无物品 | — | — |

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

## 增益实现细节

内容文件:[professions/support.ts](src/content/professions/support.ts)、[skills/support.ts](src/content/skills/support.ts)、[statuses/support.ts](src/content/statuses/support.ts)。

| 项 | 实现 |
|---|---|
| 基础面板 | 生命 140 / 护甲 20 / 魔力 120 |
| 武器「水仙之梦」 | 轻击 5 点物理近战;**重击走 `weapon_heavy` 伪技能**(spyglass 按住右键蓄力 0.8s,蓄力期间圆形指示器跟随准星,松手结算) |
| 重击(普通) | 视准心地面点为圆心,半径 2 格敌方 12 点水伤;圈内友方施加**清流** |
| 重击(晨露对光的独白) | **潜行蓄力**:半径 +3(5 格)、无法施加清流;总伤 = 12 + 5×正面效果总层数,被命中敌方均摊;按负面总层数回复魔力(每层 1 点,12 秒限一次) |
| 固有Ⅰ 涤雨 | 25 魔力、CD 19 秒;扣除自身 25% 当前生命(真实伤害),自身洁雨;视准心半径 8 内友方(除自己)刷新主动技 CD,并按人数档位加 10 秒临时护甲(1-2→30 / 3-4→23 / 5+→15);落点圈 team 可见 |
| 固有Ⅱ 水仙庇护 | 35 魔力、CD 25 秒、前摇 1.2s(圈内指示器 team 可见);自身+半径 7 敌方 6 点水伤;圈内友方(含自己)施加**水仙初临**,生命 <30% 最大值者额外尝试清流 |
| 固有Ⅲ 水仙之约(被动) | 重击同时命中 ≥3 名友方 → 自身获得水仙初临(5 秒内置冷却;当前 `MAX_PLAYERS=2` 暂无法完整实测) |

状态链:

| 状态 | 规则 |
|---|---|
| 清流 `snd5:clear_stream` | 1 秒,减伤 10% + 缓慢回 5 血;**每 3 秒最多被施加 1 次**(状态系统 `reapplyCooldownTicks` 通用能力) |
| 洁雨 `snd5:pure_rain` | 5 秒,减伤 50%→0% 线性递减(modifiers 按实例函数);每秒回 5 血共 15;**自然到期**对半径 2 敌方溅射 3 点水伤 |
| 水仙初临 `snd5:narcissus_arrival` | 12 秒;获得时随机清 1 负面,每 1.2 秒回 10 血,每 3 秒随机清 1 负面;累计受伤 >70(实际写入量)→ 清空并 2 秒回 10 魔力;**治疗溢出(含自身回血)即进阶水仙伴生**(`evolve` 挂 `heal.overflow`) |
| 水仙伴生 `snd5:narcissus_symbiosis` | 20 秒,**不可清除**;1 次 100% 伤害减免(真伤穿透),每秒回 10 血,每 5 秒清全部负面 |

框架侧为增益新增的通用能力(其余职业直接复用):`weapon_heavy` 伪槽位(重击蓄力走完整 charge 流程)、状态 `onDamageTaken` 接线(此前为死代码)、`onAfterDamaged` 实际伤害钩子(后续魔魇降临按点叠层用它)、`reapplyCooldownTicks` 限频施加、`clearDebuffs` 随机净化。

## 控制实现细节(自定义物品 + 盔甲架占位创生物)

内容文件:[professions/controller.ts](src/content/professions/controller.ts)、[skills/controller.ts](src/content/skills/controller.ts)、[statuses/controller.ts](src/content/statuses/controller.ts);物品定义 [items/](items/)(`snd5:controller_weapon` / `snd5:controller_skill_1` / `snd5:controller_skill_2`,贴图为原版材质名占位:lightning_rod / conduit / wither_rose)。释放入口与群法同一套自定义物品组件框架。

| 项 | 实现 |
|---|---|
| 基础面板 | 生命 70 / 护甲 70 / 魔力 140 |
| 武器「不等式」 | 轻击 5 点物理近战;**重击走 `weapon_heavy` 伪技能**(长按右键蓄力 1.7s,蓄力期间 ¼ 圆指示器跟随视角,潜行显示进阶半径) |
| 重击(普通) | ¼ 圆 6 格 10 点水伤,**随距离线性衰减**(近端全额 → 半径边缘 50%;PDF 未给曲线,数值集中在 `decayedDamage` 一处) |
| 重击(水的两面性) | **潜行释放**:回收半径 6 圆内敌方全部**浊露**层数 → ¼ 圆 8 格,伤害 = (10+回收层数) 同曲线衰减;命中携带**魔魇噬魂**的目标附加 5 秒失明;未回收任何层数则按普通重击结算 |
| 固有Ⅰ 魔瘴之泉 | 15 魔力、CD 8 秒、堆叠 3;原地放置泉水创生物(盔甲架占位,**托管血量 60**,18s)后自身前移 3 格;每 3 秒对 5 格内敌方 4 点水伤 + 1 层浊露 |
| 固有Ⅱ 魔魇降临 | **channel 吟唱**(长按,每秒耗 2 魔力,松手/枯竭/死亡停止);圆心从自身出发以每秒 2 格朝准星地面点移动(最远 8 格),每秒对圆心半径 6 圆内敌方 2 点水伤 + **尝试**施加魔魇降临(已携带者自动跳过);CD 5 秒 |
| 固有Ⅲ 魔魂代偿(被动) | 订阅 `damage.lethal` 拦截致命伤害(DOT 致死不拦,架构 §5.4 约定);下一拍消耗全部魔力等量回血(走治疗管线);100 秒冷却 |

状态链:

| 状态 | 规则 |
|---|---|
| 浊露 `snd5:turbid_dew` | 24 秒,叠层并刷新;**32 层上限后冻结**(freezeAtMax);每 5 秒 2 点水伤;梯度惩罚:4 层移速 -8%(原版缓慢 I 近似)/ 8 层受伤 +2 / 16 层造成伤害 -5 / **32 层每 5 秒所有主动技能 CD +3 秒**(getRemaining + applyCooldown 延长,只延冷却中的技能) |
| 魔魇降临 `snd5:nightmare_descent` | 30 秒,**不可重新施加**(reapplyable false);每受 1 点伤害(实际写入量含护甲/真伤分量)+1 层;2 秒不增长则每秒 -4 层;**50 层清空并掉落固体灵魂** |
| 固体灵魂(创生物) | 盔甲架占位、免伤;每角色同时最多 1 个;掉落 2 秒后仅原主**走近拾取**(1.5 格);场上存在魔瘴之泉时朝 10 格内最近者每秒 3 格移动;**8 秒未拾回 → 原主 20 点真实伤害 + 魔魇噬魂** |
| 魔魇噬魂 `snd5:nightmare_devour` | 12 秒,**不可清除**;获得时所有技能进入冷却(取与效果等长,设计未给具体数值);每秒 2 点真实伤害;移速 -20%、受伤 +5 |

框架侧为控制新增的通用能力(其余职业直接复用):`SummonOptions.maxHp` / `invulnerable` / `kind`(盔甲架占位实体的脚本托管血量、免伤与语义类型;listeners `entityHurt` 对托管实体取消原版伤害并转发 `handleSummonHurt` 累计,满血破坏发 `summon.destroyed` reason "broken")、`SummonSystem.getByKind/countByKind`(跨创生物联动查询)、**channel 吟唱按真实经过 tick 结算**(此前每次会话 tick 只按 1 tick 扣魔/计数,5t 网格下每秒仅扣 0.5 魔力;现按 elapsed 折算并增加吟唱者死亡守卫)。

## 群法实现细节(首个自定义物品职业)

内容文件:[professions/magus.ts](src/content/professions/magus.ts)、[skills/magus.ts](src/content/skills/magus.ts)、[statuses/magus.ts](src/content/statuses/magus.ts);物品定义 [items/](items/)(`snd5:magus_weapon` / `snd5:magus_skill_1` / `snd5:magus_skill_2`,贴图为原版材质名占位:blaze_rod / lightning_rod / fire_charge)。

**释放入口(自定义物品 vs 原版占位)**:

| 环节 | 原版占位职业(战士/增益) | 群法(自定义物品) |
|---|---|---|
| 即时施放 | `world.afterEvents.itemUse` + nameTag/typeId 绑定表 | `snd5:skill_trigger` 组件 `onUse` 回调(main.ts startup 注册) |
| 潜行右键效用 | 同上(castSneaking 变体) | 绑定表 `onSneakUse` 效用动作(**不进施法流程**,不校验/不预扣/不进冷却) |
| 蓄力/松手 | `itemStartUse` / `itemReleaseUse` | 同左(组件无 start/release 回调,仍走全局事件) |
| 双触发防护 | `lastInstantCast` 同 tick 去重 | itemUse/itemStartUse 对自定义物品直接跳过,单路径 |

物品 JSON 触发载体:`minecraft:food`(nutrition 0 + can_always_eat)+ `minecraft:use_modifiers`(use_duration 3600s,永不完成故不消耗物品;武器 movement_modifier 0.35 减速)+ `minecraft:use_animation`(武器 "spear" 抬臂蓄力姿、技能 "drink";旧版 "bow" 在当前引擎为非功能性动画)。**组件挂接(Custom Components v2)**:v1 的 `"minecraft:custom_components": []` 数组已从 Schema 移除,改为把注册名直接写成组件条目 `"snd5:skill_trigger": {}`(与原版组件同列,可携带 JSON 参数经 `CustomComponentParameters` 读到)。技能物品**不挂** `minecraft:cooldown` 组件:该组件会在冷却期封锁右键,导致潜行切定律在冷却期不可用(设计要求切定律与冷却无关);冷却提示走 HUD 摘要。

| 项 | 实现 |
|---|---|
| 基础面板 | 生命 100 / 护甲 15 / 魔力 160 |
| 武器「周期」 | 轻击 6 点物理近战;魔力凝聚时轻击 → **至纯魔力的一击** 28 点+魔力残留+炸飞双方(凝聚消耗);重击 = `weapon_heavy` 伪技能**绑定在武器自身**(长按右键蓄力 ≈1.4s/35 魔力,¼圆 6 格总量 40 点均摊+魔力残留,未命中退魔;蓄力期间 ¼ 圆指示器跟随) |
| 重击(潜行释放) | 蓄满后潜行松手 → 不攻击,**魔力凝聚**(35 魔力全额退还;法力血契使魔力不足时可先扣生命起蓄,但潜行释放仅退魔力,差额不退) |
| 固有Ⅰ 定律投掷 | 潜行右键切定律(轮流,与冷却无关,两技能共享同一定律);定律Ⅰ 电 17 魔力/5s:雪球投掷落地驻场**固体雷云**(8s,0.5s 跳 4 格 5 电+电离);定律Ⅱ 火 23 魔力/8s:**球状烈焰**每秒 1 格前移、4s 后爆(7 格 15 火+焙烧+向中心聚拢 2 格,撞墙提前引爆);定律Ⅲ 水 15 魔力/6s:**倒置积云** 2s 后每秒 1 格跟随施放者(0.5s 跳 10 格随机 1~5 水+浸润,最低伤每秒 +1) |
| 固有Ⅱ 定律范围 | 定律Ⅰ 22 魔力/16s:¼圆 8 格随距离增加 8~12 电;浸润→2s 内 4×3 电;焙烧→30% 最大护甲伤害。定律Ⅱ 35 魔力/20s:¼圆 8 格随距离衰减 7~15 火;电离→+12 并炸飞;浸润→+6 与 2s 减速(缓慢 I 近似 20%)。定律Ⅲ 30 魔力/18s:半圆 6 格 3×4 水(0.5s 间隔);焙烧→每次 +2 甲伤与 2s 甲伤 +50%;电离→每次 +1 电与 2s 电伤 +10% |
| 固有Ⅲ 法力血契(被动) | `hpSubstitute` 标志(框架 prededuct 已实现):魔力不足部分用生命值代替;生命+魔力合计不足则不触发 |
| 物品名显示定律 | 切换定律即时重写两个技能物品 nameTag(`§d固有Ⅰ§7·§b定律Ⅰ(电)§r` 样式);重生发装按当前定律命名(`profession.buildSkillItem` 钩子) |

状态链(电离/焙烧/浸润为互斥三角,「获得本效果时」按 `excludedPresent` 立即结算):

| 状态 | 规则 |
|---|---|
| 魔力残留 `snd5:mana_residue` | 8 秒,每秒回 1 魔力;受电伤额外扣 3 魔力/受火伤额外扣 3 护甲(直写账本);**受水伤清除并原地掉落液态魔力**(1s 后爆:3 格敌方 10 点物理 + 友方含施法者回 5 魔力;物理元素防掉落连锁) |
| 魔力凝聚 `snd5:mana_condense` | 持续至下次轻击(武器侧消费后移除) |
| 电离 `snd5:ionize` | 15 秒;获得时清浸润→1s 内 2×3 电伤;清焙烧→10 点火伤 + 3s 电/火伤 +3 |
| 焙烧 `snd5:roast` | 18 秒;获得时清电离→10 点火伤 + 炸飞;清浸润→15 甲伤 + 8 血伤 + 2s 受伤 +50% |
| 浸润 `snd5:soak` | 20 秒;获得时清焙烧→30 甲伤 + 10 血伤;清电离→4s 内 4×1 电伤 + 4s 电伤 +3 |
| 隐藏跟进状态 | 灼流/导电(电/火伤 +3 跟进,延迟 1 tick 物理结算防递归)、焦脆(受伤 +50%)、甲碎(armorTakenMul 1.5,管线护甲分量专用乘区)、感电(电伤 +10% 折算跟进) |

框架侧为群法新增的通用能力(其余职业直接复用):`StatusContext.excludedPresent`(互斥清除前在场的状态表,「获得本效果时立即结算」类规则的基础)、`StatusModifiers.armorTakenMul`(目标侧护甲承伤乘区)、`primitives.applyEffect/removeEffect`(原版状态效果)、自定义物品组件框架 [framework/skill/customItems.ts](src/framework/skill/customItems.ts)(`customItemBindings` 绑定表 + `snd5:skill_trigger` 组件,`onSneakUse` 效用动作不进施法流程)。

## 刺客实现细节(抓钩位移 + 定锚二段施法)

内容文件:[professions/assassin.ts](src/content/professions/assassin.ts)、[skills/assassin.ts](src/content/skills/assassin.ts)、[statuses/assassin.ts](src/content/statuses/assassin.ts);物品定义 [items/](items/)(`snd5:assassin_weapon` / `snd5:assassin_skill_1` / `snd5:assassin_skill_2`,贴图为原版材质名占位:iron_sword / tripwire_hook / lodestone)。释放入口与群法/控制同一套自定义物品组件框架。

| 项 | 实现 |
|---|---|
| 基础面板 | 生命 70 / 护甲 30 / 魔力 70 |
| 武器「横刀·离心」 | 轻击 10 点物理近战(professions handleAttack);重击 = `weapon_heavy` 伪技能**绑定在武器自身**(长按右键蓄力 0.5s,半径 3 格半圆 18 点 + 击碎 20% 护甲上限,蓄力期间半圆指示器跟随) |
| 固有Ⅰ 抓钩 | 8s CD / 0 魔力 / 堆叠 3(发射消耗 1 堆叠,魔瘴之泉模式:耗尽进 8s CD 后回满);**Grappling Hooks Add-On(Yeggs)普通钩爪方案**:右键发射钩(盔甲架占位,脚本速度 60 格/秒,raycast 分步碰撞,最远 35 格)→ 命中方块**锁定** → **钟摆摆荡**(自定义重力 -40/秒²、阻尼 0.2、绳张力 20 倍位移修正,每拍速度经 `primitives.setVelocity`→`applyKnockback` 逼近施加,保留原版碰撞手感);**潜行按住**收绳拉自己(25 格/秒 + 朝钩 80/秒²,重力减半),抵达钩点 1.4 格内弹起并回收;**潜行+右键**松开(`onSneakUse` 效用动作,不进施法流程,任意状态可用);飞行/锁定中右键(不潜行)移除重射;命中玩家 → 7 点伤害 + 3 格/秒牵拉 2 秒 + 撕裂(保留 PDF 效果);锚点方块被破坏自动脱落(附加包 checkRopeAnchor);**物理跑 listeners 的全局 1t 循环**(附加包同粒度);单段绳简化:玩家↔钩直连距离约束,不复刻附加包的分段绳链(绳绕墙角);防摔不需要(SND5 原版伤害已全拦截) |
| 固有Ⅱ 定锚 | **四段式冷却** `ready 360 / expire 180`(二段劈砍 18s / 定锚消失 9s)/ 堆叠 1;**雪球投掷**(原版雪球承载抛物线与碰撞,初速 0.8 格/tick 约 6 格落点,与战士球状闪电/群法固体雷云同款「投射物 → 驻场」结构):命中敌方玩家 → 停驻目标位置 + 5 点伤害 + 撕裂;命中其他实体/方块 → 同样停驻(无伤害,防雪球撞毁丢锚);到期兜底亦停驻(投掷统一 suppressCooldown **不进 CD**);驻场定锚 = 盔甲架 6 秒,自然消失 → expire 9s(`onExpire` → `requestCooldown`);**再次点击 = 二段瞬移**(瞬移至锚点 + 半径 3 半圆 30 点 + 击碎 40% 护甲上限,销毁定锚 → ready 18s);雪球飞行中点击不放行二段(`no_stacks` 提示「定锚未就绪」);驻场定锚被外力破坏走 `canIgnoreStackCheck` 惰性恢复 |
| 固有Ⅲ 影遁(被动) | 订阅 `skill.cast`(施放成功才触发,含重击/秘典):迅捷Ⅰ + 隐身 1 秒,被动冷却 8 秒 |
| 惯性 | 状态层 `snd5:inertia`:`stackMode "both"`(叠层并刷新 1.5s 衰减窗口 = PDF「1.5 秒未增长则清空」),上限 4 层;叠层时机随抓钩方案迁移:锁定后(摆荡/收绳 = PDF「牵引飞行时间」的映射)每 0.5s 叠 1 层,钩飞行阶段玩家未位移不叠;轻击/重击结算时 `consumeInertia` 消耗全部层数(1/2/3 层伤害 ×1.10/1.15/1.20,4 层取 3 层档并附加撕裂 —— PDF 未给 4 层伤害数值);技能伤害不消耗惯性(PDF「下一次攻击」仅指武器攻击) |
| 定锚外部破坏兜底 | 定锚盔甲架被玩家打碎(非自然到期)时 expire 冷却不会触发:`canIgnoreStackCheck` 惰性恢复 —— 下次点击发现锚失效即清 store 并申请 9s 冷却,本次提示「定锚已被破坏,冷却中」 |
| 绳体可视化 | 自定义实体 `snd5:rope`(包内首个自定义实体,配 `snd5_hud` 资源包,Grappling Hooks Add-On rope_display 的简化版):服务端无物理/免伤实体逐拍跟随玩家**腰部连接点**(脚部 +0.9,视觉 A 端与摆荡/收绳物理锚点共用,保证绷直时绳杆不松弛),钩点世界坐标经 `client_sync` 属性(`snd5:hook_x/y/z`)下放;客户端 molang `pre_animation` 按「实体位置→钩点」向量计算朝向(`-atan2`)并拉伸一根细杆(16×16×16 立方,scale_x/y=0.1、scale_z=距离),飞行/锁定两阶段统一渲染;贴图 `textures/entity/snd5_rope.png`(16×16 绳纹,六面全 UV);被外力移除时物理循环下一拍自动重生,松开/回收/会话销毁统一清理 |

## 攻击指示器接口

实现:[framework/indicator.ts](src/framework/indicator.ts)。内容设计 PDF 中的「指示器」(辅助的偏移圆形、坦克 1~10 格蓄力直线、群法 ¼圆、单法光束等)统一由本接口表达。

**形状**(`IndicatorSpec`,可单个或数组组合):

| kind | 字段 | 对应设计示例 |
|---|---|---|
| `circle` | `center` / `radius` | 辅助重击圆形(圆心最远 5 格)、坦克固有Ⅱ三段扩张环(5/7/9) |
| `sector` | `origin` / `direction` / `radius` / `angleDegrees` | 战士/刺客半圆(180°)、群法 ¼圆(90°) |
| `line` | `origin` / `direction`(3D) / `length` / `width` | 坦克 1~10 格劈砍、单法宽 1 格光束 |

**两种用法**:

1. **声明式(蓄力/前摇/吟唱)**:`SkillDefinition.indicator(ctx)` —— 施法期间自动显示,每会话 tick(5t)用最新 ctx 重算(跟随位置/视角/蓄力值;`ctx.castElapsedTicks` 为真实经过 tick,蓄力进度/圆心移动速率以它为准),结算/被打断/死亡即回收;返回 `undefined` 表示本拍隐藏;潜行变体差异直接读 `ctx.isSneaking`(晨露 +3 格、水的两面性 6→8 格)。`indicatorOptions` 可覆写可见性/粒子效果。
2. **命令式(即时落点闪烁)**:`ctx.primitives.showIndicator(ownerId, spec, { durationTicks })`,返回 `{ update, stop }` 句柄;`stopIndicators(ownerId)` 一键清除。

**可见性** `visibility`:`"self"`(默认,仅施法者,`Player.spawnParticle` 逐玩家渲染)/ `"team"` / `"all"`;`Player.spawnParticle` 不可用时自动回退全员渲染并告警。渲染为沿轮廓撒点(vanilla 粒子,默认 `minecraft:endrod`,`effect` 可换自定义粒子),纯表现层,任何失败只降级不影响结算。

示例(控制固有Ⅱ:吟唱中圆心每秒 2 格朝准星地面点移动,半径 6,最远 8 格;圆心存于 `ctx.store` 跨拍追踪,判定与指示器共用同一点):

```ts
indicator(ctx) {
  return { kind: "circle", center: channelCenter(ctx), radius: NIGHTMARE_RADIUS };
},
// onChannelTick 内按 (channelTicks - movedAtTicks) × 每tick步长 把圆心朝
// viewGroundCenter(ctx, 8) 移动,伤害脉冲按 channelTicks 每 20 tick 一拍
```

> 已接入验证:战士突进劈砍(落点扇形闪烁,self)、秘典地震(震圈闪烁,all)、增益 spyglass 蓄力重击(跟随准星的圆形,charge 声明式)、增益涤雨/水仙庇护(team 可见)。

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
│   ├── framework/             # 战斗框架(Attribute/Status/Combat/Skill/Indicator/Summon/Score/Capture/Supply/HUD)
│   └── content/               # 内容层(纯定义)
│       ├── index.ts           # 唯一门面:import 即注册
│       ├── selection.ts       # 准备阶段职业选择
│       ├── professions/
│       │   ├── registry.ts    # 职业定义接口 + 注册表(含 handleAttack/buildSkillItem)
│       │   ├── index.ts       # 注册入口:刺客/战士/增益/控制/群法 + 坦克/单法占位
│       │   └── *.ts           # 各职业:面板/武器/技能物品/近战结算
│       ├── skills/            # warrior / support / controller / magus / assassin
│       ├── statuses/          # warrior / support / controller / magus / assassin
│       ├── codex/             # 秘典Ⅰ/Ⅱ(10 个法术,与职业技能同构)
│       └── consumables.ts     # 血药/甲修/魔瓶(回复走治疗管线)
├── items/                     # 自定义物品 JSON(群法/控制/刺客,贴图用原版材质名占位)
├── entities/                  # 自定义实体 JSON(snd5:rope 抓钩绳体可视化)
├── resource-pack/             # snd5_hud 资源包:绳体客户端实体/几何体/molang 拉伸动画
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
2. **其余 2 职业**:坦克/单法(注册表已占位,`available: false`);
3. **战士/增益物品升级**:武器与技能物品仍用原版占位(可玩);升级为自定义物品(`use_duration` + `charge`)后 0.7 秒蓄力重击等按 PDF 精确实现;
4. **自定义资源包**:武器/技能物品贴图与模型(只放贴图/模型,**不要放 `ui/hud_screen.json`**);
5. **调试**:`CastLogger`、`/snd5` 调试命令、多房间并发与残留实测。

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
