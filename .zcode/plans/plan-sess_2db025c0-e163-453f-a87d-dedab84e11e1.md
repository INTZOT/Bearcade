# SND5 秘典实现计划

## Context

内容设计中秘典Ⅰ/Ⅱ 各 5 个法术，玩家在准备阶段各选一个，以道具形式装备在物品栏槽位 6/7。使用后给自身施加**同名状态效果**，随后物品进入**禁用（耗尽）状态**，需到资源补给站补充后才能再次使用。物品暂用原版物品占位。

**已确认的决策**（用户已选定）：
- 禁用表现：物品保留在背包、名称变灰标注「已耗尽」；HUD 技能冷却行**不显示**秘典槽位（状态行照常显示法术状态）
- 消耗：全部 0 魔力、无冷却（禁用即代价）
- 信标：完整实现（部署点创生物 + 重生优先传送 + 限用 3 人次）
- 占位物品：复用萝卜钓竿/诡异菌钓竿/望远镜，靠 nameTag 区分路由

**现有基础**（无需改动）：`SkillSlot` 已含 `codex_1/codex_2`、loadout 装备链路、HUD 槽位标签齐备；补给站交互/限频/表单已实现（站点数据为空）；山羊角职业选择表单已有。

## 一、内容层新增 `src/content/codex/`

### 1.1 `statuses.ts` — 10 个同名状态注册

| 状态 id | 名称 | kind | 持续 | 实现要点 |
|---|---|---|---|---|
| `snd5:codex_ember_ash` | 燃灰 | neutral | 140t(7s) | 纯标记（烟雾由技能 cast 调度） |
| `snd5:codex_vanish` | 匿迹 | buff | 160t(8s) | onApply/onExpire/onRemoved → `session.players.get(targetId)?.player.addEffect/removeEffect("minecraft:invisibility")`（原版效果由内容层应用是既有约定） |
| `snd5:codex_quake` | 地震 | neutral | 20t | 纯标记（击飞由 cast 一次执行） |
| `snd5:codex_armor_crush` | 碎甲 | buff | 100t(5s) | `modifiers: { armorDealtMul: 1.5 }` ← 新修饰器（见三-1） |
| `snd5:codex_blitz` | 闪袭 | neutral | 20t | 纯标记（位移由 cast 执行） |
| `snd5:codex_beacon` | 信标 | neutral | 200t(10s) | 纯标记（部署点由 cast 生成） |
| `snd5:codex_blessing` | 护佑 | buff | 200t(10s) | cast 里 `addTempArmor(自身, 30, 200)`，状态为标记 |
| `snd5:codex_mana_tide` | 溪源 | buff | 120t(6s) | `tickIntervalTicks: 20`，onTick → `primitives.healFull(自身, {mana: 12})`，5 脉冲 × 12 = 60（走治疗管线，受重伤/收束影响） |
| `snd5:codex_healing_wave` | 疗愈 | buff | 100t(5s) | `tickIntervalTicks: 15`，onTick → `healFull({amount: 5})`，6 脉冲 × 5 = 30 |
| `snd5:codex_field_repair` | 紧急维修 | buff | 50t(2.5s) | `tickIntervalTicks: 10`，onTick → `healFull({armor: 10})`，4 脉冲 × 10 = 40 |

### 1.2 `skills.ts` — 10 个技能注册（全部 `castMode: "instant"`、`manaCost` 无、`cooldown: 0`、`maxStacks: 1`）

统一模式：`cast(ctx)` 执行动作 + `primitives.applyStatus(自身, 同名状态)`，返回 `{ ok: true, suppressCooldown: true }`（无冷却；堆叠耗尽即禁用，校验阶段 `no_stacks` 拦截）。每技能 `failureHint: { no_stacks: "秘典已耗尽,请前往补给站补充" }`。

| 法术 | cast 动作 | 占位物品 |
|---|---|---|
| 燃灰 | `spawnProjectile("minecraft:snowball", 头部, 视角方向)`，onHitBlock/onExpire → 落点烟雾：`scheduleRepeating(5, 28, spawnParticle("minecraft:basic_smoke_particle", 随机偏移))`（纯视觉，设计未定义烟雾效果） | `warped_fungus_on_a_stick` |
| 匿迹 | 仅施加状态 | `spyglass` |
| 地震 | `playersInRadius(自身, 3)`（含自身）逐个 `launch(1.2)` + `playSound("random.explode")` | `carrot_on_a_stick` |
| 碎甲 | 仅施加状态 | `warped_fungus_on_a_stick` |
| 闪袭 | `dash(自身, ctx.direction, 6)` | `carrot_on_a_stick` |
| 信标 | `spawnSummon("minecraft:area_effect_cloud", 脚下, { ownerId, lifetimeTicks: 200, deployUses: 3, tickIntervalTicks: 10, onTick: 粒子柱 endrod ×4 层 })` | `warped_fungus_on_a_stick` |
| 护佑 | `addTempArmor(自身, 30, 200)` | `carrot_on_a_stick` |
| 溪源 | 仅施加状态（回复在状态 onTick） | `warped_fungus_on_a_stick` |
| 疗愈 | 仅施加状态 | `carrot_on_a_stick` |
| 紧急维修 | 仅施加状态 | `spyglass` |

### 1.3 `index.ts` — 元数据 + 名称绑定

- `CODEX_SPELLS`：`{ tier, skillId, displayName, tagline, itemTypeId }` 表（供选择表单与发装消费）
- nameTag 约定函数与绑定表：`codexItemNameTag(displayName, exhausted)` → 可用态 `§e名§r` / 耗尽态 `§8名·已耗尽§r`；`codexItemLore(tier, exhausted)`；`codexItemNameTags: Map<精确nameTag字符串, skillId>`（两种形态都注册，供 listeners 路由）

### 1.4 `content/selection.ts` — 准备阶段秘典选择

- 新增模块级 `codexSelection: Map<playerId, { codex1?, codex2? }>`（`playerLeave` 清除，与职业选择同寿命）
- `openSelectionForm` 选定职业后顺延弹出「秘典Ⅰ选择」→「秘典Ⅱ选择」表单：按钮 = 5 法术（显示已选 ✔）+「清空(不携带)」；重开山羊角可改选全部
- 导出 `getSelectedCodex(playerId)` 供 game.ts 消费
- `content/index.ts`：`import "./codex"` + 补充 re-export

## 二、装配层 `src/game.ts` / `src/config.ts`

- **发装** `grantProfessionKit`：固有物品之后，按 `getSelectedCodex` 在容器槽 5/6（热键栏 6/7，对应设计槽位 6/7）发放秘典物品（nameTag/lore 用 codex 模块函数，未选不发）
- **loadoutFor**：skills 追加 `codex_1/codex_2`（校验 skillRegistry 已注册）
- **使用后变灰**：`onGameStart` 建 session 后订阅 `session.bus.on("skill.cast")` → `outcome.ok && slot 为 codex_*` 时扫描该玩家背包找到该秘典物品（按 nameTag 两种形态匹配）重写为耗尽态（nameTag/lore）
- **SessionInjects 新增 `codexItemRestore?(player, slot, skillId)`**（game.ts 实现）：补给站补充时把物品重写回可用态
- **补给站数据**：`config.ts` 新增 `SND5_SUPPLY_STATIONS`（7 个占位坐标：5 内圈贴占点、2 外围，TODO 场地建好后微调）；每站 items = 血药(上限2)/甲修(8)/魔瓶(4) + 秘典Ⅰ/秘典Ⅱ 两条 codexSlot 条目；`buildContentBundle` 接线（消耗品本身的使用结算不在本次范围）

## 三、框架层小改

1. **碎甲修饰器**：`status/types.ts`（`StatusModifiers.armorDealtMul?`、`AggregatedMods.armorDealtMul`、`NEUTRAL_MODS` 补 1）、`status/system.ts` aggregate 乘算、`combat/pipeline.ts` 护甲路径 `dealtMul × armorDealtMul`（hp 路径不变，注释标明仅放大护甲伤害）
2. **禁用语义（零新概念）**：靠既有堆叠——耗尽后无 CD 结算故不回满。`skill/system.ts` 新增 `refillStacks(playerId, skillId)`（initIfAbsent+refill）与 `isExhausted(playerId, skillId)`；`getCooldownSummary` 跳过 codex_1/codex_2（用户要求技能行不显示秘典）
3. **重生复位**：`session.ts equip()` 对 codex 槽位调用 `refillStacks`（开局/重生重发物品时禁用态一并复位，与发装一致）
4. **部署点**：`summon.ts` —— `SummonOptions.deployUses?`（spawn 时写实体动态属性 `snd5:uses`）+ `consumeDeployPoint(teamId)`（扫描 active 中本队、uses>0 的创生物，扣 1 次数返回位置）；`session.ts respawn()` 重生落位改为 `consumeDeployPoint(state.teamId) ?? injects.getRespawnLocation(...)`（开局落位不变）
5. **补给站秘典补充**：`supply.ts` `SupplyItemDef` 增加可选 `codexSlot?: "codex_1"|"codex_2"`；表单按钮显示「秘典Ⅰ·燃灰 (可用/已耗尽/未装备)」；选中后走充能分支：未装备/仍可用 → 提示不耗冷却；已耗尽 → `refillStacks` + `injects.codexItemRestore` + 消耗 20s 限频
6. `framework/types.ts`：`SessionInjects` 增加可选 `codexItemRestore`（框架不 import 内容，物品重写由装配层实现）

## 四、适配层 `src/listeners.ts`

- 新增 `resolveSkillIdFromItem(itemStack)`：先查 `codexItemNameTags.get(nameTag)`（精确匹配，覆盖可用/耗尽两种形态），未命中回退 `skillItemBindings.get(typeId)`；`itemUse / itemStartUse / itemCompleteUse` 三个处理器统一换用（战士物品 nameTag 不在秘典表 → 行为不变；同 tick 去重仍兜住双事件）

## 五、验证

- 构建：`npm run typecheck && npm run check && npm run build`
- 手动测试清单（需 MCBE 服务器实测，无法在此环境运行）：
  1. 准备阶段山羊角 → 选战士 → 顺延选秘典Ⅰ/Ⅱ → 开局槽 6/7 有对应物品
  2. 逐个施放 10 法术：状态出现在 HUD 状态行；物品变灰「已耗尽」；再次右键提示前往补给站
  3. 数值抽查：护佑 +30 临时护甲 10s；溪源 6s 回 60 魔；疗愈 5s 回 30 血；紧急维修 2.5s 回 40 甲；碎甲期间护甲伤害 ×1.5；闪袭位移 6 格；地震 3 格含自身击飞；匿迹隐身 8s；信标 10s 消失
  4. 补给站交互：耗尽后充能恢复（物品复原、可再施放）；20s 限频生效
  5. 信标：队友死亡重生传送到部署点，第 4 次或 10s 后回退出生点
  6. 重生后秘典物品恢复可用态；战士固有技能路由不受影响；`/bearcade:quit` 后无残留
