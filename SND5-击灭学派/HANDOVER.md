# 交接报告：击灭学派·学派战技能包（Minecraft 基岩版 1.26.40）

> 最新汇总请先读 `交接报告_2026-08-14.md`（当前状态、路径、系统清单、未决事项与流程约定），历史汇总见 `交接报告_2026-08-13.md`。本文件是逐轮修复流水账。

> 本文件是给下一位接手的 Codex / 开发者看的完整上下文。明天新窗口收到本文件后，按“§6 下一步行动”直接开工，不要重新向用户确认已确认过的问题。

## 0. 一句话现状

完整 Addon 代码已写完、已打包，JSON/JS 语法校验全部通过。用户已进行过一轮实机测试，反馈“有一些好了，有一些坏了”，但**尚未提供具体坏项清单和报错日志**。下一步是等用户提供“好的/坏的清单 + ContentLog 报错”，逐项修复。

## 1. 项目需求（用户原始设计，全部需实现）

### 全局规则
- 所有玩家：生命提升\*4（按约定=生命提升 V 级，+10 颗心），复活时重新施加并回满血。
- 盔甲只用于分队标识、无防护作用——**用户说“盔甲先不用管”，当前未实现**。
- 效果标注约定：所有“效果\*N”实际为 N+1 级。例：瞬间伤害\*0 = I 级瞬间伤害。

### 输出丨击灭学派
- 武器：击灭丨战戟，+2（总攻击 3 点=1.5 颗心）。
- 被动：击灭丨勇战——击杀一名敌对玩家后获得 5s 力量\*0（力量 I）。必须是最后一击；狼击杀也算；摔死/烧死不算。
- 学派 I：击灭丨突进——面向方向 -20°～20°、半径 13 格（扇柱体）；范围内敌对玩家受一次瞬间伤害\*0（6 点=3 颗心），范围内敌人与施法者一起传送到“施法者面向方向 13 格、上方 3.5 格”的同一点。CD 40s。
- 学派 II：击灭丨战愈——2s 生命恢复\*2（恢复 III）+ 10s 伤害吸收\*2（吸收 III）。CD 50s。

### 控制丨缚阻学派
- 武器：缚阻丨法杖——35 格内视线方向射线子弹，命中敌对玩家或方块停止；对玩家造成 2 点伤害（1 颗心）。无 CD。
- 学派 I：缚阻丨迟滞——35 格视线方向第一个方块处放置指示物；以指示物为中心半径 10 范围敌对玩家持续获得缓慢\*1（缓慢 II）；存在 10s。CD 55s。
- 学派 II：缚阻丨瘴阵——同上，半径 10，持续致命中毒\*1（致命中毒 II，基岩版 `fatal_poison`），存在 15s。CD 60s。

### 治疗丨生命学派
- 武器：生命丨魔杖——同法杖射线，命中造成 1 点伤害（0.5 颗心）。
- 被动：生命丨自愈——持续拥有生命恢复\*0（恢复 I）。
- 学派 I：生命丨同舟——35 格视线方向方块为中心，半径 7 友方玩家获得一次瞬间治疗\*1（治疗 II）；施法者自己受一次瞬间伤害\*0（6 点）。CD 50s。
- 学派 II：生命丨祝福——同中心半径 7，友方（**含自己**）获得瞬间治疗\*2（治疗 III）+ 15s 生命提升 V→VIII（结束后回 V）+ 5s 免疫负面。CD 60s。

### 游走丨疾行学派
- 武器：疾行丨长剑，+1（总攻击 2 点=1 颗心）。
- 学派 I：疾行丨掠影——向视线方向高速位移 10 格（水平，会被墙挡住，不能垂直滞空）。CD 35s。
- 学派 II：疾行丨隐袭——15s 隐身 + 15s 速度\*1（速度 II）。CD 60s。

### 圣典/法典/秘典（9 本）
- 禅师丨布德宗圣典：副手持有不死图腾；图腾触发后读 120s CD，CD 结束且玩家存活时自动补充；图腾给的恢复 II 45s 改为 13s。CD 120s。
- 司铎丨卡鲁教廷圣典：8s 免疫负面（清除已有+阻止新增；瞬间伤害不可免疫）。CD 55s。
- 骑士丨“南十字”法典：10s 伤害吸收\*2 + 10s 抗性提升\*0。CD 45s。
- 医师丨塔莫琳秘典：10s 生命恢复\*1（恢复 II）。CD 45s。
- 召唤师丨芙希秘典：召唤两只驯服狗；无敌人时在施法者旁待命；自动锁定以玩家为中心 35 格内最近敌人攻击；持续抗性提升\*1（抗性 II）；35s 后死亡；提前被打死 CD 照常；狼算友方单位。CD 65s。
- 魔剑士丨阿玛拉加秘典：自己受一次瞬间伤害\*0 + 2s 中毒\*1（中毒 II）+ 7s 力量\*0；允许把自己毒死。CD 20s。
- 药师丨茶雅秘典：指示物半径 5，持续中毒\*0（中毒 I），存在 8s。CD 18s。
- 预言家丨普林西斯秘典：指示物半径 15，范围内敌对玩家被“标记”（友方可见的浮空字，绑定被标记者）；离开半径标记消失；存在 25s。CD 70s。
- 阵法师丨佩莉秘典：清除自己旧阵眼，在脚下最近地面放实体阵眼；敌人攻击 3 次破坏；玩家死亡后阵眼发光柱；若复活前未被破坏，玩家可选此点复活（选择 UI 用户暂缓，当前实现为死后自动在此复活）；使用后阵眼破坏。CD 90s。

## 2. 用户已确认的规则（不要再问）

1. 版本以 1.26.40 正式版为基准；交付 .mcaddon；允许用原版实体做底子，外观由开发者决定。
2. 两队（红/蓝）；分队问题暂不深究；只涉及游戏内玩家；盔甲暂不管。
3. 生命提升\*4=生命提升 V，死亡复活自动重新施加并回满血。
4. 死亡不掉落；每人 1 个学派（武器+两个技能+被动固定）+ 自选 2 本圣典。
5. 开局自选（UI 菜单）。
6. 每个技能/圣典是独立物品，手持后电脑右键/手机长按使用。
7. CD 用物品原生冷却，使用即开始算；被动加入学派即生效。
8. 效果换算无误：\*0=I 级……依次类推。
9. 祝福＝生命提升 V→VIII 15s，结束回 V。
10. 负面清单：缓慢、中毒、致命中毒、虚弱、失明、反胃等；瞬间伤害不可免疫；免疫=清除已有+阻止新增；自己给自己上的负面也遵循免疫（理解为同样被清除/阻止）。
11. 持续施加效果可按 1s 刷新、持续 2s。
12. 指示物范围为柱体，高约 15 格（实现为 ±7.5）。
13. 战戟 +2 无其他要求。
14. 法杖=射线判定、无下坠、穿过友方/生物、35 格。
15. 法杖伤害为魔法伤害，击杀归属施法者。
16. 突进=扇柱体（高度实现为 15，±7.5）、统一传送到同一点、无敌人也位移、施法者免摔落（实现为 3s 内取消摔落伤害）、敌人正常摔落。
17. 指示物对空失败但 CD 照扣；离开范围后效果 2s 内消退（实现：40tick 持续，10tick 刷新）。
18. 同舟友方不含自己，自己固定 3 颗心伤害；周围无队友也照常受伤、CD 照算。
19. 祝福友方含自己。
20. 掠影=水平高速位移，被墙拦住，不做垂直滞空。
21. 隐袭=隐身 15s + 速度 II 15s。
22. 圣典使用方式同技能。
23. 布德宗：图腾放副手；CD 结束就补，玩家死亡则复活后补；CD 期间死亡 CD 继续；恢复 II 45s→13s（实现为检测图腾消耗后移除恢复再给 13s）。
24. 卡鲁=8s 免疫（同第 10 条）。
25. 芙希：驯服狼，无敌人待在施法者旁边；狼可被杀，属性同普通狼+持续抗性 II；35s 内被杀 CD 照常；狼算友方。
26. 阿玛拉加允许自伤致死。
27. 普林西斯：浮空字绑定被标记者；离开半径消失；做不到仅友方可见就所有人可见；无其他用途。
28. 佩莉：不会放到虚空；实体形式、敌人打 2-3 次（实现 3 次）破坏；可见；死后光柱所有人可见；复活选择暂不细做（实现为自动在阵眼复活）。
29. 勇战：必须最后一击；狼击杀算施法者击杀；环境死亡不算。
30. 技能伤害用脚本以施法者为伤害来源，保证击杀归属。
31. 和平/创造/旁观都可触发，方便测试。

## 3. 工程文件与结构

源工程根目录：`C:\Users\24827\jimie_schools`

```
jimie_schools/
  HANDOVER.md                      # 本文件
  build.ps1                        # 打包脚本（生成 击灭学派技能包.mcaddon）
  击灭学派技能包.mcaddon           # 已生成（约 25KB）
  BP/
    manifest.json                  # 1.26.40；@minecraft/server 2.9.0；@minecraft/server-ui 2.1.0
    items/                         # 21 个自定义物品
    entities/                      # area_indicator / peili_indicator / fuxi_wolf_red / fuxi_wolf_blue
    scripts/main.js                # 全部逻辑（单文件）
  RP/
    manifest.json
    texts/ (en_US.lang, zh_CN.lang, languages.json)
    textures/item_texture.json
    entity/fuxi_wolf_red.entity.json, fuxi_wolf_blue.entity.json
    render_controllers/jimie_wolf.json
```

已安装目录（用户提供）：
- BP：`C:\Users\24827\AppData\Roaming\Minecraft Bedrock\Users\Shared\games\com.mojang\behavior_packs\jimie_schools_BP`
- RP：`C:\Users\24827\AppData\Roaming\Minecraft Bedrock\Users\Shared\games\com.mojang\resource_packs\jimie_schools_RP`

修改后需要同步到已安装目录（见 §7 命令），游戏内 `/reload` 或重进世界生效。

## 4. 物品清单（identifier → 名称 → CD）

| identifier | 名称 | CD |
|---|---|---|
| jimie:halberd | 击灭丨战戟 | 无 |
| jimie:wand_bind | 缚阻丨法杖 | 无（右键射线） |
| jimie:wand_life | 生命丨魔杖 | 无（右键射线） |
| jimie:longsword | 疾行丨长剑 | 无 |
| jimie:charge | 击灭丨突进 | 40s |
| jimie:heal | 击灭丨战愈 | 50s |
| jimie:slow_field | 缚阻丨迟滞 | 55s |
| jimie:poison_field | 缚阻丨瘴阵 | 60s |
| jimie:same_boat | 生命丨同舟 | 50s |
| jimie:bless | 生命丨祝福 | 60s |
| jimie:dash | 疾行丨掠影 | 35s |
| jimie:stealth | 疾行丨隐袭 | 60s |
| jimie:tome_buddha | 禅师丨布德宗圣典 | 被动（图腾 120s） |
| jimie:tome_priest | 司铎丨卡鲁教廷圣典 | 55s |
| jimie:tome_knight | 骑士丨“南十字”法典 | 45s |
| jimie:tome_doctor | 医师丨塔莫琳秘典 | 45s |
| jimie:tome_summoner | 召唤师丨芙希秘典 | 65s |
| jimie:tome_blade | 魔剑士丨阿玛拉加秘典 | 20s |
| jimie:tome_herbalist | 药师丨茶雅秘典 | 18s |
| jimie:tome_prophet | 预言家丨普林西斯秘典 | 70s |
| jimie:tome_formation | 阵法师丨佩莉秘典 | 90s |

## 5. 脚本实现要点（main.js，修复时必读）

- 物品触发：`itemUse` + `itemUseOn` 都订阅，用 `lastUse`（玩家id→{tick,id}）去重，防止同一操作触发两次。
- 冷却：全部由物品 JSON 的 `minecraft:cooldown`（type=use）实现，使用即开始，冷却中不会触发 itemUse。
- 效果等级：`addEffect(类型, 时长tick, {amplifier: N})`，即 \*N 用 amplifier N。
- 伤害：一律 `entity.damage(数值, {cause:"magic", damagingEntity: 施法者})`，保证勇战击杀归属。
- 射线：手写步进 0.25 格×35；只检测“敌对玩家”和实心方块，穿过友方/生物；用于法杖与指示物定位。
- 指示物：`jimie:area_indicator`（隐形 marker 实体），动态属性存 skill/team/center/radius/effect/amplifier/remain；每 10tick 刷新范围内敌对玩家效果（40tick 持续）+ 粒子光柱；到期 kill。柱体判定半径 R、|Δy|≤7.5。
- 预言家标记：原版 `minecraft:armor_stand` + 隐身效果 + nameTag（`§d✦标记·玩家名`），每 10tick 跟随敌人头部上方；离开半径或指示物到期则 kill。全玩家可见（用户接受兜底）。
- 佩莉阵眼：`jimie:peili_indicator`（health 1000、无模型、0.6×1.0 碰撞箱），`entityHurt` 里敌对玩家攻击计数 3 次破坏；玩家死亡（health≤0）时每 10tick 喷红色光柱（高 24 格）；`playerSpawn`（非首次）时若阵眼还在→传送玩家到阵眼、销毁阵眼（即“自动复活”占位实现）。
- 芙希狼：`jimie:fuxi_wolf_red`（索敌 tag jimie_blue）/ `jimie:fuxi_wolf_blue`（索敌 tag jimie_red），`runtime_identifier: minecraft:wolf`；召唤后 `tameable.tame(player)` + `triggerEvent("jimie:on_tame")` 加入驯服组件组（is_tamed、health20、attack4、follow_owner、owner_hurt_by/by_target、nearest_attackable_target 35 格）；动态属性 `jimie_owner`/`jimie_remain`（700tick，每 10tick 减 10）；持续抗性 II；到期 kill。狼击杀→`entityDie` 里按 owner 归属。
- 布德宗：`tickTotems` 检测副手图腾从有→无：`removeEffect(regeneration)` + `addEffect(regeneration,260,amp1)`；`jimie_totem_remain=120`（秒，每 10tick 减 0.5）；归零且副手空→`equippable.setEquipment(Offhand, totem)`。
- 免疫：`immuneUntil` map；生效期间每 10tick 移除 NEGATIVE_EFFECTS 列表全部效果（缓慢/中毒/致命中毒/虚弱/失明/反胃/饥饿/凋零/挖掘疲劳/黑暗/漂浮）。
- 祝福：`blessBoostUntil` map；生效期间 tickMaintenance 给 HB amplifier 7（VIII），否则给 amplifier 4（V）；重生时清除该玩家祝福/免疫状态。
- 勇战：`entityDie` 中 `damageSource.damagingEntity` 为玩家或狼；确认敌我不同队且击杀者学派=jiemie → 力量 I 100tick。
- 突进免摔落：`beforeEvents.entityHurt` 中 cause=fall 且 60tick 内 → cancel。
- 队伍占位：tag `jimie_red`/`jimie_blue`；进服自动交替分配；聊天 `!team red` / `!team blue` 切换。
- 选择 UI：首次生成弹 ActionForm 选学派→选两本圣典；存动态属性 jimie_school/jimie_tome1/jimie_tome2；取消自动重试；复活时补发 5 件物品（含布德宗副手图腾逻辑）。

## 6. 下一步行动（新 Codex 接手的顺序）

1. 先向用户要：**好的/坏的清单 + 每项坏功能的 ContentLog 红字报错（含 main.js 行号）**。
2. 报错日志路径（用户机）：`%LOCALAPPDATA%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\logs\ContentLog.txt`
3. 拿到报错后修改 `C:\Users\24827\jimie_schools` 源工程（apply_patch 可用；shell 大概率仍不可用）。
4. 让用户执行 §7 的“同步到已安装目录”命令，游戏内 `/reload` 或重进世界复测。
5. 用户全量回归后，若一切正常再重新打包最终版 `.mcaddon`。
6. 本地文档 `C:\Users\24827\Downloads\SND5test\Bearcade\docs\bedrock-creator-docs.md` 尚未读取；若 shell 恢复应读取对照修正（特别是物品/实体/脚本 API 的 1.26.40 细节）。

## 7. 用户侧命令（让用户在自己终端执行并贴回输出）

JSON 校验：
```powershell
Get-ChildItem -Path "C:\Users\24827\jimie_schools" -Recurse -Filter *.json | ForEach-Object { try { Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json | Out-Null; Write-Host "OK   $($_.FullName)" } catch { Write-Host "FAIL $($_.FullName): $($_.Exception.Message)" } }
```

JS 语法校验：
```powershell
node --check "C:\Users\24827\jimie_schools\BP\scripts\main.js"
```

打包：
```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File "C:\Users\24827\jimie_schools\build.ps1"
```
（不要用 `powershell` 跑 build.ps1：Windows PowerShell 5.1 会把 UTF-8 脚本按 GBK 解读，生成乱码文件名。）

同步到已安装目录：
```powershell
Copy-Item -Path "C:\Users\24827\jimie_schools\BP\*" -Destination "C:\Users\24827\AppData\Roaming\Minecraft Bedrock\Users\Shared\games\com.mojang\behavior_packs\jimie_schools_BP\" -Recurse -Force
Copy-Item -Path "C:\Users\24827\jimie_schools\RP\*" -Destination "C:\Users\24827\AppData\Roaming\Minecraft Bedrock\Users\Shared\games\com.mojang\resource_packs\jimie_schools_RP\" -Recurse -Force
```

## 8. 环境状态（2026-08-12 第二轮更新）

- Codex 的 shell_command 现在可用，宿主为 pwsh 7（`C:\Users\24827\AppData\Local\Programs\PowerShell\7\pwsh.exe`）；读文件/校验/同步/打包均已验证。
- Windows PowerShell 5.1 不再崩溃，但会把无 BOM 的 UTF-8 脚本按 GBK 解读，导致中文路径乱码（build.ps1 的 `$out` 变成乱码文件名）。**统一用 pwsh 7 执行脚本命令。**
- ContentLog 实际路径：`C:\Users\24827\AppData\Roaming\Minecraft Bedrock\logs\ContentLog*.txt`（不是 `%LOCALAPPDATA%\Packages\...`）。
- 测试世界 `eNwshH6Royc=` 内嵌了自己的 BP/RP 副本（`minecraftWorlds\eNwshH6Royc=\behavior_packs\jimie_schools_BP`），修改后需同时同步 Shared 目录与该世界副本；本世界两份已确认与源工程一致。

## 9. 当前校验/测试记录

- 2026-08-12：用户执行三条命令全部通过：67/67 JSON OK；`node --check` OK（node v24.12.0）；`build.ps1` 成功生成 `击灭学派技能包.mcaddon`（25,353 字节）。
- 实机测试：用户已试玩，反馈“有一些好了，有一些坏了”，**具体坏项与报错尚未提供**。
- 尚未验证：自定义狼驯服/索敌、指示物实体、佩莉阵眼攻击判定、普林西斯浮空字、布德宗图腾触发、fatal_poison 显示等，均需实机回归。

## 10. 第二轮修复记录（2026-08-12，已同步并重新打包）

1. **main.js:883 启动崩溃**：订阅了已被 @minecraft/server 2.9.0 移除的 `world.afterEvents.itemUseOn`（ItemUseOnAfterEvent 已删除），导致脚本在启动阶段抛 `TypeError`，`startup()` 及后续订阅（chatSend/playerSpawn）全部未执行。已删除该订阅，仅保留 `itemUse`（实机日志证明物品使用会触发 itemUse）。
2. **狼实体加载失败**：`fuxi_wolf_red/blue` 的 `minecraft:behavior.look_at_player` 使用了 1.26 schema 不认的 `target_distance`，实体 JSON 解析失败。已改为 `look_distance`（与文档中原版狼一致）。
3. **射线越界报错**：玩家在世界底部（y=-64）附近发射法杖/放置指示物时，步进点低于世界下限调用 `dim.getBlock` 抛 `LocationOutOfWorldBoundariesError`，技能中断。已在 `wandShot`/`rayToBlock` 加入 `heightRange` 越界保护，粒子与终点也做了边界钳制。
4. **伤害 API 已改名**：对照开发文档确认 @minecraft/server 2.9.0 中 Entity 的伤害方法是 `applyDamage`（旧 `damage` 已移除）。`wandShot`、`skillCharge`、`sameBoat`、`tomeBlade` 的伤害调用全部从 `.damage()` 改为 `.applyDamage()`。旧代码被 try/catch 包住，之前是“静默失效”（特效/粒子正常但完全不掉血）。
5. **回血 API 已改名**：`player.setHealth()` 在当前版本不存在，改为 `HealthComponent.setCurrentValue()`。现在复活回满血真正生效。
6. **死亡不掉落落实**：发放的 5 件负载物品和不死图腾统一用 `loadoutStack()` 创建，`ItemStack.keepOnDeath = true`。
7. **生成失败兜底**：`spawnIndicator`/`tomeFormation` 实体生成失败时不再抛错，而是给玩家明确提示。
8. **build.ps1 兼容性**：PowerShell 7 的 `Compress-Archive` 不接受 `.mcaddon` 扩展名，已改为先生成 `_build.zip` 再改名；同步更新了 §7 的打包命令为 `pwsh`。

## 11. 第三轮修复记录（2026-08-12，用户实测反馈后）

用户第二轮实测（ContentLog 14:18-14:45）显示脚本仍整体崩溃：`main.js:917 world.beforeEvents.chatSend.subscribe` 的 `chatSend` 在当前运行时是 undefined（文档列了 beforeEvents.chatSend，但稳定版 2.9.0 未暴露）。

1. **崩溃点清除**：删除 `world.beforeEvents.chatSend` 订阅；改为可选的 `world.afterEvents.chatSend`（存在才订阅，`!team` 命令保留为“能生效就用，不能就自动分队”）。
2. **全部事件订阅加存在性保护**：entityDie / entityHurt(before+after) / itemUse / playerSpawn 全部改为 `if (xxx) xxx.subscribe(...)`，任何一个 API 缺失都只跳过该功能，不再让整份脚本崩溃。`startup()` 内各步骤也全部 try/catch，保证定时器一定能注册。
3. **定时兜底**：`tickMaintenance` 每 10 tick 检查——没队标自动分队、没学派自动弹选择 UI、有学派没圣典弹圣典 UI、物品缺失自动补发、已有 jimie 物品统一补打 keepOnDeath。
4. **UI 超时默认配置**：如果选择 UI 持续 60 秒无法完成，自动分配默认配置（击灭 + 布德宗 + 卡鲁）并发物品，保证“放技能系统”一定有东西可用。
5. **被动按持有物品生效**：生命学派自愈（持有生命魔杖/同舟/祝福）、击灭勇战（持有战戟/突进/战愈）、布德宗图腾（背包里有布德宗圣典即可）不再依赖 UI 选择结果。
6. **死亡不掉落**：`markKeepOnDeath` 对背包中所有 `jimie:` 前缀物品的 ContainerSlot 设置 `keepOnDeath = true`，旧物品也能被修正。

7. **测试重置渠道**：新增 `/scriptevent` 命令（system.afterEvents.scriptEventReceive，不依赖聊天事件）：
   - `/scriptevent jimie:reset`：清空 jimie 物品与配置，重新弹选择 UI；
   - `/scriptevent jimie:give`：按当前配置补发物品；
   - `/scriptevent jimie:set jiemie,buddha,priest`：直接设置学派+两本圣典。
   聊天版 `!reset` / `!give` 仅在 `afterEvents.chatSend` 可用时生效。

## 12. 第四轮修复记录（2026-08-12，用户第三次实测反馈后）

新 ContentLog（14:51-15:04）显示脚本仍在启动时崩溃：`ReferenceError: Native function [World::getAllPlayers] cannot be used in early execution. at startup`。事件订阅已全部不崩，但 `startup()` 在顶层直接执行时，早期执行阶段禁止调用 `world.getAllPlayers()`，导致 `system.runInterval` 从未注册。

1. **启动延迟**：`startup()` 改为 `system.run(startup)` 延迟到下一 tick 执行；`world.getAllPlayers()` 循环整体 try/catch，定时器注册也 try/catch。布德宗图腾、卡鲁持续免疫、狼 35s 消失、自动分队/选择/补发全部随定时器恢复。
2. **免疫改为“应用即阻止”**：新增 `world.beforeEvents.effectAdd` 订阅，免疫期间对 `NEGATIVE_EFFECTS` 列表内的效果直接 `ev.cancel = true`（原来只靠 10 tick 清理，玩家仍会短暂看到负面生效）。
3. **迟滞/瘴阵/茶雅误伤友军修复**：`isEnemyByTeam` 原来在“指示物所属队伍为空”时，会把任何带队标的玩家都判为敌人（施法者无队标时友军也会吃 debuff）。已改为要求 `team !== "" && t !== "" && t !== team`，无队标时技能不对任何人生效。

### 用户反馈逐项对应（第三轮）

| 反馈 | 根因 | 处理 |
|---|---|---|
| 布德宗不补副手图腾/效果没改/冷却没启动 | 定时器未注册 | startup 延迟执行 |
| 卡鲁持续免疫期间负面仍生效 | 定时器未注册 + 无应用即阻止 | 定时器恢复 + effectAdd cancel |
| 狗不消失 | 定时器未注册 | startup 延迟执行 |
| 迟滞对友军有 debuff | isEnemyByTeam 空队伍判定漏洞 | 要求双方队伍非空 |

## 13. 第五轮修复记录（2026-08-12，选择流程体验反馈）

1. **防重复弹窗**：新增 `formOpen`（同一时间每人只允许一个弹窗）与 `formGen`（弹窗代际）机制。重置/切换配置会使旧弹窗结果作废，杜绝“重置后弹两个选择界面、选择重复”。
2. **队伍选择环节**：首次选择流程改为「选择队伍 → 选择学派 → 选择圣典」三步；已有职业的老玩家才自动补分队，不再抢在队伍弹窗前。
3. **单改渠道**（不整体重置）：
   - `/scriptevent jimie:school life`：只改学派，保留圣典与队伍；
   - `/scriptevent jimie:tome buddha,priest`：只改两本圣典，保留学派与队伍；
   - `/scriptevent jimie:team blue`：只改队伍（red/blue/auto）；
   - `/scriptevent jimie:set jiemie,buddha,priest,red`：直设三项（第 4 项队伍可选）。
4. `jimie:reset` 现在会同时清掉队伍标签，让玩家重新走完整的“队伍 → 学派 → 圣典”流程。

## 14. 第六轮修复记录（2026-08-12，队伍弹窗出现但学派弹窗不出现）

现象：脚本无报错（ContentLog 15:19 加载后无 Scripting error），队伍弹窗能出，但选完队伍后学派弹窗不出现。

根因：基岩版客户端不允许在弹窗关闭的同一 tick 立即打开下一个弹窗，连开太快时第二个表单会被静默丢弃（无任何日志）。

处理：
1. 表单链改为延迟 2 tick：队伍 → 学派、学派 → 圣典之间用 `system.runTimeout(..., 2)` 过渡。
2. 新增弹窗看门狗 `formOpenSince`：某个弹窗打开超过 30 秒仍未完成（例如被客户端丢弃且 promise 未返回），自动作废并重新打开对应表单，杜绝流程卡死。

## 15. 第七轮修复记录（2026-08-12，队伍弹窗后其余弹窗仍不出现）

现象：队伍 ActionForm 能弹出，但后续学派/圣典 ActionForm 即使加了 2 tick 延迟仍被客户端吞掉；且进游戏时不再自动弹窗。

根因：基岩版该版本对“短时间内连续打开多个表单”限制很严，链式表单不可靠。

处理：
1. **弃用链式 ActionForm，改为单次 ModalFormData**：队伍、学派、圣典 1、圣典 2 合并为一个弹窗（4 个下拉框），一次提交全部配置。彻底不存在“第二个弹窗”问题。
2. 仅补选圣典的场景也改为单次 ModalFormData（2 个下拉框）。
3. 进游戏自动弹窗路径不变：playerSpawn 触发；若未触发，tickMaintenance 每 10 tick 兜底重试；弹窗看门狗 30 秒自动重开仍保留。

## 16. 第八轮修复记录（2026-08-12，四合一弹窗提交后不发物品）

现象：弹窗能提交，但物品没有发放（ContentLog 无脚本报错，异常被 try/catch 静默吞掉）。

处理：
1. `ensureLoadout` 改为逐件 try/catch：单件失败不再中断整批；失败时向玩家聊天框输出「物品发放失败：id - 错误原因」。
2. 背包容器不可用或 `addItem` 抛错时，直接把物品掉落在玩家脚下（`dimension.spawnItem`），保证物品一定出现。
3. 弹窗返回值异常时输出调试信息「配置读取异常：formValues」，方便定位是表单值类型问题还是发放问题。

## 17. 第九轮修复记录（2026-08-12，提交后仍不发物品 + 可重复选同一秘典）

处理：
1. 在 `showConfigForm` 回调中加入 `console.warn("[jimie] ...")` 分步诊断：弹窗返回内容、解析结果、属性设置完成、发放流程结束、异常与取消原因，全部写入 ContentLog，下次测试可直接定位卡在哪一步。
2. `ensureLoadout` 的单件失败也写入 `console.warn("[jimie] 物品发放失败: id - 原因")`。
3. 两本圣典选择相同时自动把第二本改为下一本，并在聊天框提示「两本圣典相同，第二本已自动改为：X」。

注意：ModalForm 的下拉框是静态的，无法根据第一个下拉框实时联动；重复选择只能靠提交后自动纠正。

## 18. 第十轮修复记录（2026-08-12，配置弹窗提交被静默丢弃 + CD 不生效）

日志证据：`[jimie] 配置弹窗返回: {}` 之后没有任何后续日志 → 回调在“弹窗代际检查”处被静默丢弃。
时间线：插件 15:35:04 加载 → 弹窗打开 → 玩家 33 秒后提交（15:35:37），而 30 秒看门狗已在 15:35:34 把弹窗标记过期并 bump 代际。

处理：
1. **删除配置/圣典弹窗回调里的代际检查**（formGen 不再丢弃任何提交结果）；`formOpen` 仍负责防止同时弹多个窗。
2. **看门狗从 30 秒放宽到 120 秒**，且不再 bump 代际，只清理卡死的表单状态。
3. **CD 强制拦截**：原生物品冷却在该版本不拦截 itemUse，新增脚本侧冷却表 `ITEM_CD` + `cooldownUntil`，`handleUse` 在技能执行前检查、执行后写入（失败也照扣 CD，符合设计）；冷却中会提示剩余秒数。
4. 重置/切换配置时清空该玩家的脚本冷却状态。

## 19. 第十一轮修复记录（2026-08-12，射线行为调整）

按用户要求调整射线：
1. **法杖/魔杖**：射线不再在第一个敌人处停止——穿过所有敌人直到实心方块或 35 格上限；射线路径上的所有敌对玩家都受伤害（Set 去重，每步 0.25 格近点判定）。
2. **指示物类技能**（迟滞/瘴阵/茶雅/普林西斯）：新增 `rayToBlockOrEnemy`，射线途中先遇到敌人就在敌人脚下放置指示物并终止；没有敌人时仍放在第一个方块前。
3. 同舟/祝福维持原设计（35 格视线方向方块为中心），未改为敌人处终止。

## 20. 第十二轮修复记录（2026-08-12，用户对射线行为的最终要求）

1. **法杖/魔杖改回“打第一个”**：射线命中第一个敌对玩家即停止，只对该玩家造成伤害（用户明确要求，覆盖上一轮的“全路径伤害”）。
2. **同舟/祝福改为遇友方截止**：新增 `rayToBlockOrFriendly`，射线途中先碰到友方玩家就在友方脚下为中心施放；没有友方仍以第一个方块前为中心。
3. **祝福必定包含施法者自己**：`skillBless` 的目标列表 = 半径内友方（不含自己）+ 自己，自己不再依赖队标或半径判定，必定获得治疗 III + 生命提升 VIII 15s + 免疫负面 5s。

## 21. 第十三轮修复记录（2026-08-12，用户澄清祝福范围 + 布德宗触发条件）

1. **祝福恢复“范围判定含自己”**：目标过滤改为 `q.id === player.id || isFriendly(player, q)`，自己与友方一样必须在半径 7 格内才获益；不再无视范围直接给自己上 buff。
2. **布德宗收紧触发条件**：`tickTotems` 的 `hasBuddha` 从“选择了布德宗 OR 背包持有布德宗圣典”改为“仅 `jimie_tome1/2 === 'buddha'`”，只有明确选择布德宗的玩家才会自动补副手图腾、改图腾恢复时长、启动 120s 冷却。

## 22. 第十四轮修复记录（2026-08-12，发放物品不可丢弃）

1. `loadoutStack` 与 `markKeepOnDeath` 统一设置 `ItemLockMode.inventory`：发放的 jimie 物品与不死图腾不可丢弃、不可合成，但仍可在背包内移动。
2. `clearJimieItems` 在清除物品前先把对应槽位 `lockMode` 临时改为 `none`，保证重置/切换配置仍能正常回收旧物品（主手/副手同样处理）。

## 23. 第十五轮修复记录（2026-08-12，祝福到期血量被整段扣空）

问题：生命提升 VIII（+32）到期时，基岩版会直接从当前血量里扣掉整个增幅，玩家掉回 20 点；再补回生命提升 V（+20）时，多出的血条是空的。

处理：
1. ~~新增 `blessBaseHealth` 记录施放时血量~~（已被下一版替换）。
2. 祝福生效期间固定补 40 tick 的 VIII，保证效果不会在两个维护周期之间自然消失。
3. 到期瞬间由脚本接管：先移除 VIII → 立刻补回 V → 把当前血量写为 `min(到期瞬间血量, 40)`。祝福期间的治疗/受伤全部保留，血量数字不丢、血条不空（“无缝衔接”版，覆盖上一版“回退到施放前血量”的方案）。
4. 不再需要额外记录施放前血量。

## 24. 第十六轮修复记录（2026-08-12，法杖冷却 + 茶雅毒不跳伤害）

1. **法杖/魔杖 0.6 秒冷却**：`ITEM_CD` 增加 `jimie:wand_bind` / `jimie:wand_life`（0.6s，脚本强制拦截），物品 JSON 同步加 `minecraft:cooldown`（category 各自独立），冷却提示显示一位小数（如 0.6 秒）。
2. **茶雅/指示物持续效果修复**：原实现每 10 tick 对范围内敌人重新施加效果，导致中毒的伤害计时器被不断重置、永远不跳伤害。改为 `getEffect()` 检查——目标已有该效果就不再覆盖，让效果自然走完 40 tick（中毒 I 会在约 25 tick 跳一次伤害），离开范围仍按原设计 2 秒内消退。该修复同样作用于瘴阵（致命中毒）。

## 25. 第十七轮修复记录（2026-08-12，指示物落点不准）

现象：茶雅等指示物技能落点会“往后放一段”，不像准星正对的位置。

排查结论：方块落点本身用的是命中方块前 0.25 格（准星命中面），误差很小；真正的问题是**敌人/友方吸附判定半径过大（1 格）**——目标只要偏离射线 1 格以内就会被吸过去，指示物会落到偏离准星、离施法者更近的目标身上。

处理：新增 `nearPointStrict`（0.6 格内才吸附），仅用于指示物类技能的敌人/友方终止判定；法杖仍保留 1 格判定（战斗手感不变）。

## 26. 第十八轮修复记录（2026-08-12，未锁定敌人时方块落点偏后）

用户澄清：不是敌人吸附问题；纯方块落点也“偏后”。

根因：原实现用 0.25 格步进 + `floor()` 采样，命中方块时返回“上一个步进点”（最多比真实命中面偏后 0.25 格），且斜视时误差会叠加。

处理：新增 `preciseBlockPoint`，用引擎 `dim.getBlockFromRay(origin, dir, { maxDistance: 35 })` 拿 `BlockRaycastHit.faceLocation`，并加上 `block.location` 换算成世界坐标——落点就是准星与方块面的精确交点。`rayToBlockOrEnemy` / `rayToBlockOrFriendly` 的方块分支都改用它（敌人/友方分支不变）。

## 27. 第十九轮新增功能（2026-08-12，视觉区分与粒子表现）

1. **队伍名字染色**：`applyTeamVisual(p)` 设置 `nameTag`——红队 `§c`、蓝队 `§b`；换队、进服、复活、定时维护（每 10 tick）都会刷新。
2. **法杖/魔杖子弹轨迹**：射线静态粒子加密到每 0.5 格一粒（`minecraft:spell`），并新增 6 tick（0.3 秒）飞行子弹（`minecraft:endrod`）从己方沿射线飞向命中点。
3. **指示物选区边界环**：`drawIndicatorRing` 按指示物半径画彩色粒子圆环（`colored_flame_particle`，颜色同技能），配合原有光柱标出选区；所有指示物类技能生效期间持续绘制。

### 微调（2026-08-12 18:30）

- 选区边界环高度从 `center.y + 0.15` 抬高到 `center.y + 1.5`，避免环埋进地里。

## 28. 第二十轮新增功能（2026-08-12，同舟/祝福选区环 + 双法杖粒子区分）

1. **同舟/祝福瞬间选区环**：新增 `spawnRingBurst`（3 帧闪烁），同舟绿色、祝福金色，半径为 7，施放瞬间显示作用范围。
2. **双法杖粒子区分**：`wandShot` 增加 `trailParticle` / `projectileParticle` 参数——缚阻法杖：`minecraft:spell` 轨迹 + `minecraft:endrod` 弹丸；生命魔杖：`minecraft:heart_particle` 轨迹 + 爱心弹丸。

### 微调（2026-08-12 18:59）

- 指示物技能的敌人/友方吸附半径从 0.6 格恢复为 1 格（用户反馈 0.6 太小）；方块落点仍使用引擎精确射线，不受影响。

## 29. 第二十一轮修复记录（2026-08-12，远程普通攻击击退过强）

处理：
1. 法杖/魔杖伤害改为 `applyDamage(damage, { cause: "magic" })`（不带 `damagingEntity`），消除引擎默认攻击击退。
2. 仅当目标距离施法者 ≤5 格时，手动施加轻微击退（水平 0.55 / 垂直 0.22，方向从施法者指向目标）。
3. 新增 `recentHurtBy` 击杀归属表：法杖击杀仍然计入施法者（勇战被动、击杀判定不受影响），`entityDie` 无伤害来源时回退查表。

## 30. 夺点玩法（比赛模式）实现（2026-08-12）

规则确认后已实现第一版：

- 地图：红方大本营 (0,100)、蓝方大本营 (0,-100)（不可占领、不计分）；5 个争夺点（中心/东北/西北/东南/西南），判定半径 17、高度地面 ±20。
- 占领：中立点 20s（400 tick）单方在场占领，进度带符号（红正/蓝负）支持 1:1 回退；已占点敌方 40s（800 tick）接管，无人时 1:1 回退；双方在场全部暂停。
- 计分：死亡给对立队伍 +5（含环境/自杀）；占领 1~5 点每秒 +1/2/4/8/16；20 分钟或 2000 分结束，结束即重置全部状态。
- 死亡/复活：12s 等待（隐身+无敌+漂浮，不参与点位判定）；默认大本营；潜行（`entityStartSneaking`，预发布事件，已加保护）或「复活选择器」物品循环切换复活点（己方已占点/佩莉阵眼，用后销毁）；选中点丢失自动回大本营。
- 观战/开始：`/scriptevent jimie:start` 开始（所有人转生存并分队），`/scriptevent jimie:stop` 结束重置；比赛进行中进服的玩家自动进旁观者模式。
- 常驻显示：ActionBar 显示双方比分、剩余时间、占领点数；死亡等待期显示当前复活点。
- 新增物品：`jimie:respawn_selector`（复活选择器，BP 物品 + RP 贴图/语言）。

待实机回归项：点位判定与占领/回退、死亡 12s 幽灵流程、潜行/物品切换复活点、旁观模式、计分与 2000 分结束、20 分钟结束、HUD 显示。

### 微调（2026-08-12 20:19）

- 所有点位（含大本营）中心 y 固定为 **-55**（判定高度 -75~-35），不再自动探测地面。
- 复活选择器：点击复活后必定进入完整 12 秒幽灵阶段并发放选择器（`untilTick = max(原值, 当前+240)`）；`tickDeathWait` 也会补发；发放失败时掉落在脚下并提示。

### 微调（2026-08-12 20:24）

- 所有点位（含大本营）在比赛中用粒子圆环标出区域（半径 17，绘制于 y=-53.5），颜色随归属变化（红/蓝/中立灰）。
- 所有点位重生 y 暂定 **-60**。
- 幽灵等待阶段会先收回全部 jimie 武器/技能/圣典（`clearJimieItems`），只保留复活选择器；完全复活后 `ensureLoadout` 重新发放全部物品。

### 微调（2026-08-12 20:33）

- **复活选择器改为原版指南针**（nameTag「复活选择器」），不再依赖自定义物品注册，发放失败问题根除；`handleUse` 用 `minecraft:compass` 判定。
- **侧边栏**：`world.scoreboard` 目标 `jimie_game`，显示红蓝比分、剩余时间、每个点位状态行（含被攻击秒数/锁定）；比赛结束清除。
- **点位悬浮状态文字**：每个点位上方隐形盔甲架实时显示归属/占领进度/锁定状态，比赛结束销毁。
- 点位圆环颜色随归属变化（红/蓝/中立灰）已在上一轮实现；本轮补充 `node.paused` 标记并显示「进度锁定」。

### 微调（2026-08-12 20:38）

- **幽灵阶段不再被补发物品**：`tickMaintenance` 与 `tickTotems` 对 `deathState` 中的玩家直接跳过，修复“等待复活时武器/技能又回来”的问题。
- **开局传送**：`startGame` 会把双方玩家传送回各自大本营（y=-60）。
- **占领诊断日志**：`tickGame` 在检测到点内有人时输出 `[jimie] 占领检测 <node> red=.. blue=.. owner=.. prog=..`，用于确认占领逻辑是否在跑；`startGame` 输出 `[jimie] 比赛开始`。

### 微调（2026-08-12 20:46）

- **圈内未计入诊断**：当点内横向半径内有玩家但 red/blue 均为 0 时，输出 `[jimie] 圈内未计入 <node> 玩家=.. team=.. dim=.. y=.. 幽灵=.. 观战=..`，直接定位为何没被计入（队伍/维度/y/幽灵/观战）。
- 佩莉阵眼复活改为传送到**阵眼上方 2.5 格**。
- **移除 ActionBar**（侧边栏已足够）：删除 `showGameHud`/`showRespawnBar` 的 ActionBar 显示；复活点切换改为聊天消息提示。

### 微调（2026-08-12 20:48）

- **幽灵等待位置跟随复活点**：`teleportGhost(p, st.selectedNodeId)` 支持佩莉阵眼——选中阵眼后，等待阶段会漂浮在阵眼正上方 30 格；阵眼失效时自动回退大本营。

### 关键修复（2026-08-12 20:52，占领不生效根因）

诊断日志显示玩家在中心点半径内、红队、主世界（`dim=minecraft:overworld`）、y≈-59、非幽灵非观战，但仍被排除。

根因：`playerInNodeZone` 的维度判断写的是 `p.dimension.id !== "overworld"`，而当前版本 `Dimension.id` 返回带命名空间的 `"minecraft:overworld"`，导致所有玩家永远被判定为“不在主世界”。

修复：改为 `p.dimension.id !== "minecraft:overworld"`。占领进度恢复正常。

### 微调（2026-08-12 20:55）

- **强制生存模式**：新增 `forceSurvival(p)`（`setGameMode(GameMode.survival)` + `runCommand("gamemode survival")` 双保险），在比赛开始、幽灵正式复活、比赛结束时统一调用，避免世界默认创造模式覆盖导致玩家变成创造；失败会写 `[jimie] setGameMode survival 失败 / gamemode 命令失败` 日志。

### 微调（2026-08-12 20:57）

- **侧边栏刷屏修复**：原来把“点位名+实时进度”当参与者名，进度每 0.5s 变化就新增一行。改为固定行名 `nodeSidebarName`（归属颜色 + 点位名，仅在被攻/锁定时加后缀），进度秒数写入分数列；同一行只更新数值，不再新增。

### 微调（2026-08-12 21:03，彻底防刷屏）

- **侧边栏只保留稳定行**：红队/蓝队比分、剩余时间、红方点数/蓝方点数；不再逐点位建行（点位详情由点位上方悬浮文字承担）。
- **点位悬浮盔甲架防重复**：生成改为“spawn 成功才登记到 map”，`addEffect`/`setDynamicProperty` 失败不再阻止登记；开局 `cleanupNodeStands()` 会清掉所有带 `jimie_node_stand` 标记的残留盔甲架（含上一局/旧版残留），杜绝每 0.5s 重复生成。

### 微调（2026-08-12 21:16，移除盔甲架 + 恢复侧边栏点位行）

- **移除全部点位盔甲架**（玩家可拆/可交互），点位状态改由侧边栏承担。
- 侧边栏恢复“每点位一行”：行名固定（点位名 + `·红/·蓝/·中立` + 状态切换时才加的 `·被攻/·锁` 后缀），进度秒数写在分数列（20s/40s 制），不会每 0.5s 新增行。
- 胜利条件确认：仅“先到 2000 分”或“20 分钟高分胜”，**没有占满 5 点即胜**；占领 1/2/3/4/5 点每秒 +1/2/4/8/16。

### 关键修复（2026-08-12 21:24，计分板假玩家不断新增）

根因：`ScoreboardObjective.setScore(字符串, 分数)` 每次调用都会**新建一个假玩家身份**，旧身份不会删除，所以侧边栏每 0.5s 多一行。

处理：
1. 新增 `sidebarIdentities` 表 + `setSidebarRow`：首次创建后从 `getParticipants()` 找到对应 `ScoreboardIdentity`，之后用**身份对象** `setScore(identity, score)` 更新同一行，不再新建。
2. 点位行名固定为点位名（不再加“·红/·被攻/·锁”后缀），彻底避免行名变化产生新身份；归属用粒子圈颜色与聊天播报体现，进度秒数仍在分数列。
3. 计分板目标重建/清除时同步清空身份表。

### 微调（2026-08-12 21:27）

- 侧边栏**不再显示大本营行**。
- 点位行名按状态命名：`点位·中立` / `点位·红占` / `点位·蓝占`（中立占领）、`点位·红方` / `点位·蓝方`、被攻打时加 `·红攻`/`·蓝攻`，双方交战加 `·锁`；进度秒数仍在分数列（20s/40s 制）。行名只在状态切换时变化，配合身份复用不刷屏；旧状态行会在下次开赛重建计分板时清除。

### 微调（2026-08-12 21:32）

- **状态切换立即重建侧边栏**：`lastSidebarNodeState` 检测到任一争夺点行名变化时调用 `rebuildSidebar()`（清显示槽 → 重建目标 → 重画全部行），旧状态行（如撤出后的“红占”）立即消失，恢复“中立”显示，不再残留。
- **行名配色**：攻占/被攻浅色（红 §c / 蓝 §b），已占领深色（红 §4 / 蓝 §9），中立/锁定灰色。
- 身份查找兼容颜色码剥离：`setSidebarRow` 同时匹配原始名与去码名，避免因 § 码导致找不到身份而重新建行。

### 微调（2026-08-12 21:38）

- 侧边栏去掉「红方点数/蓝方点数」两行，只保留：红队、蓝队、剩余时间、5 个争夺点状态行。
- 新增站位 ActionBar：站在争夺点判定区内时显示该点状态与占领速度（中立占领 20s 制、接管 40s 制，均速度 1x；双方在场显示「进度锁定」）；离开点位自动清空。

### 微调（2026-08-12 21:51，佩莉阵眼可视化与拆除反馈）

- 新增 RP 客户端实体 `jimie:peili_indicator`：使用末影水晶外观（`geometry.crystal` + 水晶贴图 + 默认渲染控制器），阵眼清晰可见。
- 碰撞箱从 0.6×1.0 加大到 0.8×1.5，方便敌方近战命中。
- 敌方玩家每次命中：粒子爆点 + 「阵眼受击 x/3」提示；第 3 次摧毁并全服播报「佩莉阵眼已被摧毁！」。

### 修复（2026-08-12 22:00，阵眼模型不显示）

日志报错：`geometry not found?` / `friendly name 'geometry.default' not found` —— 自定义实体找不到原版 `geometry.crystal`。

处理：新增自带几何模型 `RP/models/entity/peili_indicator.geo.json`（三层堆叠晶体，`geometry.jimie_peili`），贴图改用原版钻石图标（`textures/items/diamond`），客户端实体引用自带模型，不再依赖原版水晶模型。

### 最终方案（2026-08-12 22:04，弃用自定义阵眼模型）

自定义客户端模型在该版本仍报 `geometry not found?`。改为**直接使用原版 `minecraft:ender_crystal` 作为阵眼实体**：
- 自带末影水晶模型与光束，天然可见、可被近战攻击；
- 动态属性 `jimie_owner` / `jimie_hits` 记录归属与受击次数，敌方 3 次拆除；
- 销毁一律用 `ent.remove()`（不触发水晶爆炸），旧版自定义 `jimie:peili_indicator` 实体在加载时自动清理；
- RP 自定义模型文件保留但不再被使用。

### 再修复（2026-08-12 22:09，末影水晶受击仍爆炸）

用户实测：末影水晶被攻击的瞬间原版就会爆炸（早于脚本的 remove()）。

处理：改用 `beforeEvents.entityHurt` **在受伤前拦截**——对带 `jimie_owner` 的末影水晶直接 `ev.cancel = true`（完全阻止原版伤害/爆炸），受击次数改存脚本内存表 `peiliHits`（不在 before 事件里写动态属性），计数与视觉/播报用 `system.run` 延迟到下一 tick 执行；3 次后 `remove()` 移除。水晶现在既可见、又不会爆炸、且只吃敌方玩家的 3 次攻击。

### 最终方案（2026-08-12 22:15，放弃原版末影水晶）

用户实测该版本下末影水晶的爆炸仍无法被脚本拦截。最终方案：

1. **阵眼回到自定义实体 `jimie:peili_indicator`**：隐形但有 0.8×1.5 碰撞箱，可被近战命中，受击 3 次（`afterEvents.entityHurt` 按动态属性计数）后 `remove()`，不会爆炸。
2. **视觉用纯粒子**（不依赖任何模型）：每 10 tick 在阵眼位置画发光粒子球 + 底部 1 格光环，并保留原有光柱——必然可见。
3. 删除 RP 中废弃的阵眼模型/客户端实体文件（源与已安装目录都已清理）；`loadPeili` 会清除旧方案残留的末影水晶。

## 31. 普林西斯标记改用 TextPrimitive（2026-08-12 22:21）

按用户指定的 `docs/server/index.d.ts` 实现：
- 标记改为 `TextPrimitive`（`world.primitiveShapesManager.addText`），`attachedTo = 敌人` 实现自动绑定跟随，偏移 (0, 2.2, 0)；
- `visibleTo = 己方玩家列表`（按指示物所属队伍实时刷新），**敌方看不到标记**；
- 文字 `§d✦标记·玩家名`，缩放 0.9、半透明黑底、`depthTest=false` 始终显示；
- 敌人离开半径/指示物到期时 `remove()` 清除；`prophets` 表存 `{ text }` / `{ stand }` 包装，若运行时无 `primitiveShapesManager` 则回退旧盔甲架方案。

### 微调（2026-08-12 23:14，点位上方浮空字）

- 每个争夺点（不含大本营）新增 TextPrimitive 浮空字：显示点位名 + 归属（红/蓝/中立）+ 被攻/锁定 + 进度秒数（20s/40s 制），`scale=2.2` 放大字体、半透明黑底、`depthTest=false` 始终可见；
- `ensureNodeTextShapes` 每 10 tick 更新文字；比赛开始前/结束后 `clearNodeTextShapes` 清理；
- 所有玩家可见（全局观战用）。

## 32. 普林西斯/佩莉/浮空字修正（2026-08-13 00:01）

1. **普林西斯标记到期清理**：`clearProphetMarks` 对 TextPrimitive 同时调用 `remove()` 和 `primitiveShapesManager.removeText()`；`startup` 里 `removeAll()` 统一清掉世界重载后的残留浮空字；新增诊断日志（创建 text/stand、清除数量）。
2. **标记仅己方可见**：`visibleTo` 在创建前、`addText` 后都赋值，且每 10 tick 刷新为当前己方玩家名单；启动日志输出 `环境 primitiveShapes=.. TextPrimitive=..`，用于确认运行时是否有该 API（若输出 `标记创建 stand` 表示回退了盔甲架，`visibleTo` 无法生效）。
3. **佩莉阵眼可击打**：实体 JSON 增加 `minecraft:custom_hit_test`（0.8×1.5，pivot y=0.75），保证近战命中判定；受击时输出 `[jimie] 阵眼受击 x/3 attacker=..` 日志，便于确认敌方 3 次拆除。
4. **点位浮空字**：`scale` 2.2 → 3.2；占领/接管读秒从 0.1s 精度提高到 0.01s（`toFixed(2)`）。

### 关键修复（2026-08-13 0:11，标记清不掉 + 双方可见）

日志证据：`标记创建 text ... friends=0`（可见名单为空 → 按文档空列表=所有人可见）。

根因有两个：
1. `prophets` 映射键用的是 `ind.id`，但指示物数据对象里根本没有 `id` 字段（键一直是 undefined），到期 `clearProphetMarks(entityId)` 永远查不到 → 标记清不掉。已改为用 `indicatorEnt.id` 作键。
2. 指示物没存施法者，`friends` 只按队伍筛选，无队标时为 0 → 空 visibleTo = 全员可见。现在 `spawnIndicator` 记录 `ownerId`（并写入实体动态属性供重载恢复），`manageProphetMarks` 的可见名单 = 同队玩家 + 施法者本人；名单为空时不创建标记并移除已有标记。

另加 `clearAllProphetMarks()`，比赛开始/结束时统一清理。

### 用户实测问题逐项对应

| 用户反馈 | 根因 | 本轮处理 |
|---|---|---|
| 选队/放技能系统没出现 | playerSpawn 未注册（脚本崩在 chatSend） | 修复崩溃 + playerSpawn + 定时兜底 + 60s 默认配置 |
| 生命提升没上来 | startup()/playerSpawn 未运行 | 同上 |
| !team 不好使 | beforeEvents.chatSend 不存在 | 改 afterEvents 可选订阅；主要靠自动分队 |
| 远程没伤害 | 无队标 isEnemy=false + 未用 applyDamage | 自动分队 + applyDamage（上轮已改） |
| 祝福对自己无效 | 自己无队标被 isFriendly 排除 | 自动分队后含自己 |
| 瘴阵/茶雅/普林西斯无效果 | 敌对判定依赖队标 | 自动分队 |
| 死亡掉落 | 物品未走 loadoutStack | markKeepOnDeath 逐格补打 |
| 布德宗不补图腾/效果没变 | tickTotems 未运行 + 依赖选择属性 | 定时运行 + 持有即生效 |
| 狗不消失 | tickWolves 未运行 | 定时器兜底 |
| 卡鲁持续免疫不生效 | tickMaintenance 未运行 | 定时器兜底 |

### 待实机回归清单

- 开局选学派/两本圣典 UI、复活重发物品、自动分队。
- 全局生命提升 V、生命学派自愈、祝福 VIII→V 回落。
- 四学派技能、九本圣典全量测试（重点：突进/迟滞/瘴阵/同舟/祝福/掠影/隐袭）。
- 芙希两只狼：驯服、跟随、35 格索敌、抗性 II、35s 死亡、狼击杀归属。
- 布德宗：图腾消耗→恢复 II 13s→120s 后自动补。
- 佩莉：阵眼放置、3 次攻击破坏、死后光柱、自动复活。
- 普林西斯：浮空字绑定与离开范围消失。
- 聊天 `!team red/blue`。

复测后把「好的/坏的 + ContentLog 红字」贴回，再决定是否继续修。

## 33. 第三十三轮调整（2026-08-13，新需求：名牌/固定槽位/贴图隐藏）

用户提出的四项调整，全部已实现并同步到源工程：

1. **TextPrimitive 队友名牌（仅友方可见）**
   - 原版头顶名牌隐藏：`applyTeamVisual` 在 `primitiveShapesManager`/`TextPrimitive` 可用时把 `nameTag` 置空（不可用时回退原来的队伍染色名牌）。
   - 新增 `playerLabels` 表 + `ensurePlayerLabel`/`tickPlayerLabels`：每个玩家头顶一个 TextPrimitive（`attachedTo=玩家`、偏移 (0,2.5,0)、scale 0.6、半透明黑底、`depthTest=false`）。
   - 内容三行：名字（红 §c / 蓝 §b）→ 学派 + 两本秘典（短名）→ 当前在冷却的技能/秘典剩余时间（如 `突进32s 茶雅18s`；全就绪显示 `CD 就绪`）。
   - `visibleTo` = 同队玩家 + 自己（**永远至少包含自己**，避免空数组=全员可见的文档坑）；每 10 tick 刷新文字与可见名单；`clearPlayerState`/玩家离线时清理。
   - 冷却数据直接读脚本侧 `cooldownUntil`（`playerId:itemId -> tick`），未单独做持久化，重载后与现有冷却行为一致。

2. **负载物品固定槽位（槽位锁定）**
   - 常量：`LOADOUT_SLOT_WEAPON=4`（第 5 格）、`SKILL1=2`、`SKILL2=3`、`TOME1=5`、`TOME2=6`。
   - `ensureLoadout` 重写：目标槽位已有同 id 物品 → 只补 `ItemLockMode.slot` + `keepOnDeath`；否则先清除背包其他位置的同 id 物品（解锁后 `setItem(undefined)`），再 `container.setItem(slot, stack)`，`lockMode=ItemLockMode.slot`（不可移动/丢弃/合成）。发放失败仍掉落脚下兜底。
   - `markKeepOnDeath` 不再把 lockMode 覆盖回 `inventory`，避免每 10 tick 把槽位锁定“降级”成可移动。

3. **不死图腾 / 复活选择器对外隐藏贴图（保留第一人称）**
   - 复活选择器从“原版指南针 + nameTag”改回自定义物品 `jimie:respawn_selector`（BP 物品 JSON 一直保留，本次正式启用）：`isRespawnSelectorStack` 按 typeId 判断，`handleUse` 对应 `case "jimie:respawn_selector"`，`makeRespawnSelector` 用该物品创建。
   - 用 attachable 方案实现“对外透明、第一人称可见”：RP 新增 `attachables/jimie_totem_hand.json`（绑定 `minecraft:totem_of_undying`）与 `attachables/jimie_respawn_hand.json`（绑定 `jimie:respawn_selector`），模型为薄片立方体（`geometry.jimie_totem_hand` / `geometry.jimie_respawn_hand`，纹理直接引用原版 `textures/items/totem` / `textures/items/compass`），骨骼 `bb_main` 用 `q.item_slot_to_bone_name(context.item_slot)` 自动绑定主手/副手。
   - `scripts.animate`：`context.is_first_person == 1.0` 时播放 `animation.jimie.hand_first_person`（正常显示）；`== 0.0` 时播放 `animation.jimie.hand_hidden`（scale 0）。其他玩家/第三人称看不到手持物，持有者第一人称仍能看到。

4. **复活等待期选择器锁定第 5 格**
   - `RESPAWN_SELECTOR_SLOT=4`；`giveRespawnSelector` 先清掉其他位置的旧选择器，再 `setItem(4, ...)` 并补 `ItemLockMode.slot` + `keepOnDeath`；已有则只补锁。

### 待实机回归（新增）

- 名牌：仅同队可见、名字/学派/秘典/CD 是否正确、隐藏原版名牌是否生效（若 `nameTag=""` 在该版本仍显示名字，需要改用其他隐藏方案）。
- 名牌与普林西斯标记、点位浮空字共存是否正常（TextPrimitive 数量上限 1000，人数多时注意）。
- 槽位锁定：5 件物品固定第 3~7 格，无法移动/丢弃；旧版散落的物品自动归位。
- 复活等待期选择器在第 5 格且无法移动；对外视角不可见、第一人称可见（若 attachable 未覆盖原版手持渲染，需要回退为“图标改透明贴图”方案）。
- 图腾仍在副手正常触发/补充；复活等待期间图腾逻辑继续被跳过。

## 34. 第三十四轮调整（2026-08-13，超 35 格改为自身为中心释放）

用户反馈：视角释放类技能在 35 格内无目标时“直接失败且吃 CD”，要求改为以施法者当时所在位置为中心释放。

改动（`main.js`）：
- `placeField`（迟滞/瘴阵/茶雅）：`rayToBlockOrEnemy` 返回空时，中心改用 `player.location`，不再发失败提示、不再提前 return；聊天提示追加“（35格内无目标，已以自身为中心释放）”。
- `tomeProphet`（普林西斯）：同上。
- `skillSameBoat` / `skillBless`（同舟/祝福）：`rayToBlockOrFriendly` 返回空时，中心改用 `player.location`；同舟/祝福的生效范围与自身受伤/受益逻辑不变。
- 冷却照常扣除（视为成功释放）。

法杖/魔杖不在本次范围内：它们是射线武器，本身不会“释放失败”，超距只是打不到目标。

### 待实机确认

- 对空（看天空）使用迟滞/瘴阵/茶雅/普林西斯：指示物出现在脚下。
- 对空使用同舟/祝福：以自身为中心结算。

## 35. 第三十五轮调整（2026-08-13，名牌状态显示 + 敌方可见规则 + 普林西斯破除隐身）

用户需求：
1. 头顶名牌增加“当前状态”显示：生命提升 \*4 不显示（人人都有）；生命提升 \*7 换算为以 \*4 为基准的等级（显示“生命提升+3”）；其余效果按 \*N 显示等级与剩余秒数，另含脚本状态（免疫/免摔落/图腾CD）。
2. 敌方玩家在自己 35 格以内时也显示头顶信息；但隐身或蹲下时不显示。
3. 敌方处于普林西斯指示物范围内时，无论隐身/蹲下都对施法方全队显示。
4. 普林西斯新功能：隐身敌对玩家进入指示物范围即破除其隐身。

实现（`main.js`）：
- 新增 `EFFECT_NAMES`/`EFFECT_SKIP`/`ROMAN` 常量；`statusParts()` 读 `p.getEffects()`（`Effect.duration` 为 tick，换算秒），生命提升按 `amplifier-4` 显示相对等级；`statusLines()` 把状态压成最多 2 行（每行约 16 字符）。
- `playerLabelText` 行结构：名字 → 学派+秘典 → 状态（最多 2 行）→ CD。
- `labelViewers` 重写：同队恒可见；敌方在 35 格（三维距离）内且非隐身（`getEffect(INVISIBILITY)`）非蹲下（`p.isSneaking`）才可见；`isProphetRevealedTo()` 检查同队普林西斯指示物范围，命中则无视隐藏/距离显示；死亡等待幽灵不向敌方暴露。
- `isProphetRevealedTo` 的维度比较做了 `minecraft:` 前缀归一化（`loadIndicators` 存的是无前缀维度名，直接比较会失配）。
- `manageProphetMarks`：范围内隐身敌方（非幽灵）`removeEffect(INVISIBILITY)`，提示被破除者并写诊断日志。

### 待实机确认

- 名牌状态行：生命提升+3、恢复/力量/中毒等效果与秒数、免疫/免摔落/图腾CD 是否正确。
- 敌方 35 格内可见、隐身/蹲下隐藏、普林西斯范围内无视隐藏显示。
- 隐身敌人在普林西斯范围内被破除隐身（看日志 `[jimie] 普林西斯破除隐身 <名字>`）。

## 36. 第三十六轮调整（2026-08-13，本人看不到自己的名牌）

- `labelViewers` 不再把名牌主人自己加入可见名单；`ensurePlayerLabel` 在可见名单为空时移除/不创建名牌（空数组=全员可见的文档坑，所以不能留空数组），有观众时再创建。
- 单人在世界里时名牌整体不显示；队友/附近敌方出现时自动重新出现。

## 37. 第三十七轮修复（2026-08-13，复活后“半血”）

现象：玩家反馈复活后只有半血（基础 10 颗心满，生命提升 V 的 +10 颗心为空）。

根因：`applyGlobalBoosts` 在同一 tick 里先 `addEffect(HB)` 再立刻读 `hc.effectiveMax` 并 `setCurrentValue(max)`。该版本下效果还没计入上限时 `effectiveMax` 仍返回 20（或 `setCurrentValue(40)` 因当前上限 20 抛错被吞），导致只回满基础血，血条显示 20/40。

处理：改为 `addEffect` 后延迟 2 tick（`system.runTimeout(..., 2)`）再回满；目标血量取 `effectiveMax`，且保底不低于 40（基础 20 + 生命提升 V 的 20），确保十颗心也回满。

### 当前胜利条件（供确认，未改动）

- 20 分钟（24000 tick）结束，时间到高分方胜，平分则平局；
- 先到 2000 分立即获胜；
- **没有“占满 5 点即胜”的条件**；
- 计分：任意玩家死亡给对立队伍 +5（含环境/自杀）；占领 1/2/3/4/5 个点每秒 +1/2/4/8/16。

## 38. 第三十八轮修复（2026-08-13，蓝队狼不攻击 + 取消友伤）

### 狼不攻击

现象：蓝队玩家召唤的芙希狼不攻击敌人。

排查：红/蓝两个狼实体文件与全部安装副本一致，差异只有索敌 tag（红狼找 `jimie_blue`、蓝狼找 `jimie_red`），逻辑本身对称。问题点在于：
1. `nearest_attackable_target` 原先只放在“驯服组件组”里，靠 `tameable.tame()` + `triggerEvent("jimie:on_tame")` 添加；一旦驯服事件链路异常，狼就完全没有索敌行为。
2. 过滤器只写 `has_tag`，没有同时限定 `is_family: player`。

处理：
- 把 `minecraft:behavior.nearest_attackable_target` 移到基础组件（出生即生效，不依赖驯服事件），优先级 2，`max_dist` 35。
- 过滤器改为 `all_of`：`is_family=player` 且 `has_tag=对方队伍tag`（红狼找蓝、蓝狼找红）。
- `tomeSummoner` 召唤时给狼打上己方队伍 tag，并输出 `[jimie] 狼召唤 <type> owner=.. team=..` 诊断日志。

### 取消友伤

- `beforeEvents.entityHurt` 新增：受害者是玩家、伤害来源是玩家或 `jimie:fuxi_wolf`（按 `jimie_owner` 解析主人队伍）且双方同队时 `ev.cancel = true`。
- 自己打自己不拦截，保留同舟/阿玛拉加的自伤机制；幽灵无敌拦截、突进免摔落逻辑不变。

### 待实机确认

- 蓝队狼 35 格内主动攻击红队玩家；红队狼攻击蓝队玩家；狼不攻击己方。
- 同队玩家近战/远程互相打不掉血；同舟/阿玛拉加自伤仍然生效。

## 39. 第三十九轮修复（2026-08-13，接管进度冻结：攻方阵亡后守方留圈不回退）

现象：已占点被攻（双方在场锁定）时，攻方被击败、守方仍留在圈内，接管倒计时不再减少，一直冻结。

根因核实：`tickGame` 已占点分支的进度回退条件写的是 `red === 0 && blue === 0`（圈内完全无人）。攻方阵亡后守方仍在圈内，`enemyCount === 0` 但圈内并非无人，回退分支永不执行 → 进度永久冻结。

处理：回退条件改为只看 `enemyCount === 0`（攻方不在圈内），守方是否在场不影响：
- 攻方在 → 继续累计接管进度（40s/1:1 速度）；
- 双方在场 → 锁定暂停（不变）；
- 攻方阵亡/撤出 → 进度 1:1 回退到 0，即使守方留在圈内。
- 进度回退到 0 时同步清空 `progressTeam`。

### 待实机确认

- 红点被蓝攻中，蓝方玩家阵亡、红方留圈：被攻读数开始下降直至 0。
- 双方在场锁定期间进度仍暂停；蓝方重新进圈后继续累计。

## 40. 第四十轮修复（2026-08-13，狼不攻击 / 复活选择器贴图 / 远程冷却提示）

### 40.1 芙希狼不攻击（红蓝都反馈）

排查结论：
- 日志确认狼能正常召唤（`[jimie] 狼召唤`），且会移动（移动时日志出现 `[Animation][error]-Error: can't find animation walk`）。
- RP 的狼客户端实体引用了 `animation.wolf.walk`，但资源包没有提供该动画，属缺失文件。
- 索敌组件原先在基础组件里只有一份，且与原版驯服行为可能冲突；实际攻击链路不稳。

处理：
- RP 新增 `animations/wolf.animations.json`，定义 `animation.wolf.walk`（简易摆腿动画），消除报错。
- BP 狼实体：索敌 `nearest_attackable_target`（`is_family=player` + `has_tag=对方队伍`，35 格）放入驯服组件组并提到优先级 1，基础组件保留优先级 4 兜底；`owner_hurt_by_target`/`owner_hurt_target` 调整为 2/3。
- 新增 `minecraft:sittable` + `jimie:on_sit`/`jimie:on_stand` 事件与坐姿组件组，脚本每 tick 强制触发站立，防止被置为坐姿后不跟随不攻击。
- 脚本侧“护主犬”兜底（`tickWolves`）：每 10 tick 找 35 格内最近敌对玩家（排除幽灵/观战/已死亡）——
  - 超过 3.2 格时每 2 秒“扑跃”传送到目标旁安全点（带末地烛粒子+音效）；
  - 2.8 格内每 1 秒脚本撕咬 4 点伤害（`damagingEntity=狼`，走统一友伤/击杀归属通道）+ 小击退 + 暴击粒子；
  - 原版 `minecraft:attack` 伤害改为 0，避免自然近战与脚本撕咬叠加成双倍伤害。
- 新增诊断日志 `[jimie] 狼索敌 <type> 目标=<名字> 距离=..`（换目标时只打一次）。

### 40.2 复活选择器贴图

- 不再依赖原版 `textures/items/compass`（版本升级后该引用不稳定）。
- RP 新增本地 16x16 图标 `textures/items/jimie_respawn_selector.png`（蓝色菱形罗盘 + 红白指针）。
- `item_texture.json` 与 attachable `jimie_respawn_hand.json` 全部改为引用本地图标；第一人称可见、对外隐藏的逻辑不变。

### 40.3 远程普通攻击冷却提示

- 根因 1：冷却提示没有节流，冷却中连续点击每次都发“技能冷却中”，刷屏。
- 根因 2：名牌 CD 行只统计技能/秘典，法杖/魔杖（武器）没进列表，所以名牌上看不到武器冷却。
- 处理：
  - `handleUse` 冷却分支新增 `cdMsgSent` 集合，每个“玩家+物品”的每个冷却窗口只提示一次，冷却结束自动复位，重置配置时一并清理。
  - 名牌 CD 行把武器加入统计（缚杖/愈杖短名），名牌上会显示“缚杖 0.6s”等。

### 待实机确认

- 红/蓝狼都能追咬 35 格内敌方、不打己方、击杀归属施法者。
- 狼移动时不再出现 `can't find animation walk`。
- 复活选择器快捷栏与第一人称手持都有图标，不再显示紫色/黑色缺失贴图。
- 远程法杖冷却：连点只提示一次；队友名牌 CD 行能看到缚杖/愈杖剩余时间。

## 41. 第四十一轮调整（2026-08-13，去掉狼传送 / 修复狼实体加载失败 / 冷却提示按类型区分）

### 41.1 狼实体加载失败（关键根因）

现象：上一轮加的 `jimie:wolf_sitting` 组件组使用了 `minecraft:behavior.sit`，但 1.26.40 的 schema 已不接受该组件，日志报：
`component_groups -> jimie:wolf_sitting -> minecraft:behavior.sit: this component was found in the input, but is not present in the Schema`，随后 `Entity 'jimie:fuxi_wolf_red/blue' failed to load from JSON`。

处理：
- 删除 `jimie:wolf_sitting` 组件组与 `jimie:on_sit`/`jimie:on_stand` 事件。
- `minecraft:sittable` 保留但改回空对象（与原版一致），脚本也不再强制站立。
- 原版近战 `minecraft:attack.damage` 恢复为 4（上一轮为防叠加改成 0，现改回原版数值）。

### 41.2 去掉传送扑跃，恢复原版走咬

- 删除 `tickWolves` 里的“扑跃”传送逻辑，狼不再瞬移，完全按原版狼 AI 移动/追击。
- 脚本撕咬保留为“贴身兜底”：敌人玩家进入 2.8 格内每秒补 2 点伤害（原版近战 4 点照常生效，总计约 6 DPS），附带小击退与暴击粒子；仅对敌方玩家生效，不打己方、不打幽灵/观战。
- 新增诊断日志：换目标时 `[jimie] 狼索敌 ...`，首次咬到人时 `[jimie] 狼撕咬 ...`。

### 41.3 Shared 行为包目录残留清理

`Users\Shared\games\com.mojang\behavior_packs` 里残留了旧 `击灭学派技能包` 空文件夹和旧 `击灭学派技能包.zip`（内含 BP+RP 两个 manifest），游戏加载时报 `Multiple manifests found at the same directory level`。已移到项目内 `_stale_shared_packs\` 备份（未删除，可恢复）。

### 41.4 冷却提示按类型区分

- 远程普通攻击（`jimie:wand_bind` / `jimie:wand_life`）：冷却期间完全不发送“技能冷却中”提示，也不进入名牌 CD 行。
- 其余技能/秘典：恢复每次触发都提示剩余时间（不再节流，保持原行为）。
- 名牌 CD 行改回只统计技能与秘典，不统计武器。

### 待实机确认

- 两个世界重进后日志不再出现 `failed to load from JSON` / `Multiple manifests`。
- 狼不再瞬移，会像原版狗一样走路追击；敌方玩家贴身时被咬（看日志 `[jimie] 狼撕咬`）。
- 法杖/魔杖冷却期间没有任何提示；技能冷却提示每次点击都正常出现。

## 42. 第四十二轮排查（2026-08-13，召唤后狼不产生）

现象：用户反馈修复后召唤芙希秘典，狗完全不产生。

日志核实：22:26:56 世界重载后狼实体 JSON 无任何 schema/加载报错，但整个会话没有任何 `[jimie] 狼召唤` 日志（该日志原先在 `spawnEntity` 成功之后才输出），无法区分“秘典没触发”与“生成静默失败”。

处理（诊断增强，未改变玩法逻辑）：
- `tomeSummoner` 增加多段日志：
  - `[jimie] 秘典触发 summoner team=.. variant=..`（函数入口，先于生成）；
  - `[jimie] 狼生成失败 <variant> err=..`（捕获并输出异常）；
  - `[jimie] 狼生成返回无效实体`（spawnEntity 返回空）；
  - `[jimie] 狼召唤结束 成功=<n> 狼总数=<m>`。
- 出生点先用 `findSafeTeleport` 取安全坐标再生成，避免卡进方块/贴脸生成异常。
- 驯服异常也会打日志 `[jimie] 驯服异常 ..`。
- 新增测试命令：`/scriptevent jimie:summon` 直接调用 `tomeSummoner`（不消耗物品），用于区分“物品触发问题”和“生成问题”。

### 待实机确认（下次测试时请把日志结果发我）

- 使用秘典或 `/scriptevent jimie:summon` 后，日志应依次出现“秘典触发 → 狼召唤 ×2 → 狼召唤结束 成功=2”。
- 如果出现 `狼生成失败`，把 err 内容发我；如果只有“秘典触发”没有后续，说明 `spawnEntity` 卡住/未执行。

## 43. 第四十三轮修复（2026-08-13，净化/免疫负面失效）

现象：使用卡鲁教廷圣典或生命祝福后，免疫窗口内负面状态仍持续被加上（毒/缓慢等）。

根因：`world.beforeEvents.effectAdd` 的 `effectType` 字段在官方文档中明确注明“会按服务器语言翻译”（中文服返回“中毒”“缓慢”等本地名，而不是 `minecraft:poison`）。原实现用英文 ID 列表 `indexOf` 比对，中文环境下永远匹配不上 → `ev.cancel` 从未触发；`tickMaintenance` 的 10 tick 清除只能“清了又加”，表现为净化失效。

处理：
- 新增 `NEGATIVE_EFFECT_IDS`（英文短名）+ `NEGATIVE_EFFECT_NAMES`（中文名/英文本地名），`isNegativeEffect()` 先剥掉 `minecraft:` 前缀再同时匹配两种形式。
- `beforeEvents.effectAdd` 改用 `isNegativeEffect(ev.effectType)` 判断，命中即 `ev.cancel = true`，并输出 `[jimie] 免疫拦截 <效果名> player=..` 日志便于验证。
- `removeNegatives` 增加兜底：遍历 `p.getEffects()`，按标准 `typeId` 逐个清理（不受语言影响）。

### 待实机确认

- 祝福/卡鲁圣典生效期间，站在瘴阵/迟滞/茶雅范围内不再中负面；日志出现 `[jimie] 免疫拦截`。

## 44. 第四十四轮修复（2026-08-13，净化瞬间有效但持续期间仍被上负面）

现象澄清：使用卡鲁教廷圣典的瞬间能清除已有 debuff，但 8 秒免疫窗口内新上的 debuff 依然生效。

排查：负面效果主要由脚本指示物（迟滞/瘴阵/茶雅）在 `tickIndicators` 中每 10 tick `addEffect` 施加。`beforeEvents.effectAdd` 的取消在当前版本对脚本施加的效果并不可靠（且 `effectType` 存在本地化问题），导致“清了又加”反复出现。

处理（三层防护）：
1. 源头拦截：`tickIndicators` 对处于免疫窗口的玩家直接跳过负面效果施加（`isNegativeEffect(ind.effect)` 判断）。
2. 事后兜底：新增 `world.afterEvents.effectAdd` 订阅——免疫窗口内检测到负面效果已加上时，立即调用 `removeNegatives(p)` 清掉，并按每 40 tick 节流输出 `[jimie] 免疫兜底清除 <effectType> player=..`。
3. 保留 before 拦截与本地化匹配（`isNegativeEffect` 支持英文 ID / 短名 / 中文名 / effect.* 翻译键）。

### 待实机确认

- 卡鲁圣典/祝福期间站进瘴阵或迟滞：不再出现中毒/缓慢图标；日志出现“免疫拦截”或“免疫兜底清除”。
- 免疫结束后负面效果恢复生效。

## 46. 第四十六轮修复（2026-08-13，狗释放后不主动攻击玩家）

现象：狗能召唤、会跟随、会咬敌方的狗，但释放后只是待机，不主动攻击 35 格内最近的敌对玩家。

根因：狼实体一直使用 `runtime_identifier: minecraft:wolf`，导致原版驯服狼的行为组件组在后台接管：
- 原版驯服狼的 `nearest_attackable_target`（只追骷髅，优先级 5）会覆盖我们自定义的“追玩家”索敌组件；
- 原版驯服狼本身就不会主动攻击玩家，只做复仇/跟随/坐姿，正好对应“待机、咬狗不咬人”的现象。

处理：
- 两个狼实体去掉 `runtime_identifier: minecraft:wolf`，改为完全自管的自定义实体，原版驯服组件组不再介入。
- 驯服流程仍走 `minecraft:tameable` + `jimie:on_tame`，我们自己提供：`nearest_attackable_target`（敌方玩家，35 格，优先级 1）、`follow_owner`、`owner_hurt_by_target/owner_hurt_target`、`melee_attack`、`sittable`。
- 不添加 `teleport_to_owner`，避免狗追击途中瞬移回主人身边。
- 外观仍由 RP 的狼客户端实体渲染（原版狼模型/材质 + 自定义动画），无变化。
- 脚本侧保留贴身撕咬兜底与 `[jimie] 狼索敌` / `[jimie] 狼撕咬` 日志。

### 待实机确认

- 召唤后 35 格内有敌方玩家，狗应立即主动跑过去撕咬（原版近战 4 + 脚本兜底 2）。
- 不打己方、不瞬移；日志出现 `[jimie] 狼索敌`。

## 47. 第四十七轮修复（2026-08-13，狗咬到人但只击退不扣血）

日志核实：23:37-23:46 的测试日志显示脚本“狼索敌→狼撕咬”都正常触发（距离 1.9~2.7），目标是对面队伍存活玩家（非幽灵），但玩家只感觉到击退、没有伤害。

根因：脚本撕咬用的 `enemy.applyDamage(2, { cause: "entityAttack", damagingEntity: wolf })` 在当前版本成为“静默无效”——不抛异常、不扣血，而同 try 里的 `applyKnockback` 照常执行，表现就是“有击退没伤害”。

处理：
- 撕咬伤害改为与法杖一致的已验证写法：`recentHurtBy.set(enemy.id, owner.id)` + `enemy.applyDamage(2, { cause: "magic" })`（不带 `damagingEntity`），击杀归属仍记到施法者。
- 新增诊断：每个目标第一次咬时输出 `[jimie] 狼撕咬 ... 血量 40->38`（咬前/咬后），直接验证伤害是否入账；`applyDamage` 抛异常时输出 `[jimie] 狼咬伤害异常`。
- 召唤时新增组件检查日志 `[jimie] 狼组件 is_tamed=.. follow=.. target=..`，用于确认驯服组件组是否挂上。

### 待实机确认

- 敌方贴身被咬后血量下降（日志“狼撕咬 ... 血量 40->38”）；若血量不变则把日志发回。

## 48. 第四十八轮修复（2026-08-14，狗不追人：脚本追击助推 + 驯服校验）

现象：伤害已修好（日志“狼撕咬 ... 血量 40->38”），但狗不追赶，只有敌人接近狗时才有伤害，像“光环”一样。

日志核实：召唤后立即输出 `狼组件 is_tamed=false follow=false target=false`——驯服组件组在当 tick 尚未生效（行为组件 `hasComponent` 也不可靠），但狗的 AI 索敌从未把玩家选为目标，说明 AI 过滤器（`has_tag` 匹配玩家）在当前版本不可靠。

处理：
- 新增脚本追击助推 `wolfChaseTick`：每只狗一个 2 tick 定时器，35 格内有敌方且距离 >2.8 时，用 `applyImpulse` 朝目标推动（约 2.8 格/秒，行走动画随实际速度播放）；前方 0.7 格有实心块则停下等待；追到 2.8 格内停止推动，由原版近战 + 脚本撕咬结算伤害。彻底绕开 AI 索敌过滤器。
- 追击目标过滤沿用 `nearestEnemyFor`：只追 35 格内最近敌方存活玩家，不打己方/幽灵/观战。
- 驯服组件组延迟校验：召唤 20 tick 后输出 `狼驯服延迟检查 is_tamed=..`，确认组件组是否真正挂上；召唤时若 10 tick 后仍未挂上会补触发 `jimie:on_tame`（最多 3 次）。
- 狗消失/过期时自动清理助推定时器。

### 待实机确认

- 召唤后敌方在 35 格内，狗应主动跑向敌人（有奔跑动作），追到贴身后才开始咬（血量下降）。
- 不打己方、不穿墙、不瞬移；日志出现 `[jimie] 狼驯服延迟检查 is_tamed=true/false`。

## 49. 第四十九轮重构（2026-08-14，芙希狗改用真正的原版狼）

需求：释放的狗不打主人/友方、只打敌方；优先索敌 35 格内最近敌方，并采用原版狗的索敌与攻击（原生追击/撕咬动画/路径）。

方案（不再用自定义狼实体/脚本追击）：
- `tomeSummoner` 直接生成 `minecraft:wolf` 并 `tameable.tame(player)` 驯服——跟随、坐姿、复仇、攻击动画全部是原版行为。
- 项圈颜色区分队伍：红队红(14)、蓝队蓝(11)。
- 索敌驱动：脚本每 10 tick 找狗 35 格内最近敌方，以主人名义对目标施加 0.2 点魔法伤害（几乎无感），触发原版驯服狗的 `owner_hurt_target`——狗随即用原版 AI 追击并撕咬该目标。只“打”敌方，因此天然不会索敌主人/友方；每 1 秒轻击一次保持目标。
- 删除了全部脚本追击助推（`applyImpulse`）和脚本撕咬伤害；原版近战 4 点伤害即狗的真实咬伤。
- 友伤保护：`beforeEvents.entityHurt` 识别带 `jimie_owner` 标记的 `minecraft:wolf`，同队伤害照旧取消；普通野生/玩家驯服狗不受影响。
- 击杀归属：`entityDie` 识别带 `jimie_owner` 的原版狗，击杀记给召唤者（触发击灭被动）。
- 生命周期/清理：`jimie_remain` 35 秒倒计时；`loadWolves` 启动时清理旧版 `jimie:fuxi_wolf_*` 实体，并恢复带标记的原版狗。
- 旧文件：自定义狼 BP 实体/RP 客户端实体/渲染控制器/动画已归档到 `_stale_legacy_wolf\`（未删除，可恢复）。
- 诊断日志：`驯服结果 ok=.. isTamed=.. ownerId=..`、`狼索敌`、`狗咬伤 <名字> 伤害=..`（每 5 秒节流）。

### 待实机确认

- 召唤两只原版狗（红项圈/蓝项圈）；35 格内有敌方会自动跑过去，用原版撕咬动画咬人（4 伤害）；不打主人和友方。
- 无敌人时狗跟随主人；35 秒后消失；日志出现“驯服结果 ok=true”、“狗咬伤”。
- 若原版狗在追击中因距离过远瞬移回主人身边，这是原版狗自带的 teleport_to_owner 行为，属原版表现。

## 50. 第五十轮重构（2026-08-14，去掉轻击方案，改为实体级直锁仇恨）

用户反馈：轻击方案会给敌方造成可见伤害/击退，像作弊；且狗仍没有锁定仇恨。要求直接让狗锁定敌方。

核实：@minecraft/server 2.9.0 没有 setTarget/getTarget/addComponent，无法给“真原版狼”直接挂索敌；实体过滤器也没有 is_same_team。唯一能“直接锁定目标”的机制就是实体自带的 `nearest_attackable_target`（用过滤器选目标）。

处理（回到自定义实体，但行为完全复刻原版狗）：
- 两个狼实体重写为 `format_version: 1.26.10`（与原版 wolf.json 一致），组件集与原版驯服狼一致：跟随、坐姿、复仇（owner_hurt_by/owner_hurt_target）、melee_attack、leap、hurt_by_target、移动/导航/跳跃/碰撞等全部原版同款。
- 索敌：`nearest_attackable_target` 只选 `is_family=player` + `has_tag=对方队伍`，35 格、`must_see=false`、`scan_interval=5`、`within_radius=35`；驯服组件组里优先级 3，基础组件兜底优先级 7（不依赖驯服也能索敌）。
- 脚本不再造成任何伤害（删除 0.2 轻击与脚本撕咬），不干预移动；只保留生命周期、驯服校验（`tameable.isTamed`，10 tick 后校验并最多补触发 3 次）、击杀归属、友伤拦截、日志。
- 新增追击诊断：每 2 秒输出 `[jimie] 狗追击检查 目标=.. 距离=.. 变化=..（正在追赶/基本不动/正在远离）`，用于确认狗是否真的锁定并追上目标。
- 启动清理：移除上一版“真原版狗”方案带 `jimie_owner` 标记的原版狼残留。
- RP 外观文件（客户端实体/渲染控制器/行走动画）同步恢复。

### 待实机确认（重要）

- 召唤后 35 格内有敌方，日志应出现 `狗追击检查 ... 变化=-x.x（正在追赶）`，狗用原版走咬追上并咬伤（`狗咬伤` 日志）。
- 若日志连续显示“基本不动”，说明当前引擎的 `has_tag` 过滤器对玩家不生效，届时需要改用备选方案（如目标全玩家+脚本保友方安全），我会再和你确认。

## 52. 第五十二轮实现（2026-08-14，未驯服野生狗 + 敌方拉仇恨 + 空闲拉回）

用户方案（已采用）：狗不驯服，靠“被打还手”（hurt_by_target）锁仇恨；召唤后脚本模拟“35 格内最近敌方打了狗一下”，把仇恨锁到该敌方；友方打狗取消伤害；狗离主人太远自动 TP 回主人身边。

实现：
- 实体：两个狼实体改为未驯服版——删除 `minecraft:tameable`、驯服组件组与相关事件；血量/攻击 4/项圈颜色（红 14、蓝 11）全部放基础组件；保留 `hurt_by_target`（核心锁仇机制）、`melee_attack`、`leap_at_target`、移动/导航等原版同款组件；`nearest_attackable_target`（玩家+队伍标签）保留为“若引擎认则主动索敌”的附加能力。
- 召唤：不再 tame，不再触发 `jimie:on_tame`；仍设 `jimie_owner`/`jimie_remain`/队伍 tag/项圈颜色，并隐藏原版 nameTag。
- 拉仇恨：换目标时先 `wolf.applyDamage(0, {cause:"entityAttack", damagingEntity: enemy})`（0 伤害完全无感，日志 `拉仇恨0伤`）；每 2 秒追击检查若狗未追赶（delta > -1.0），降级为 0.1 点真实伤害并立刻把血量补回（日志 `拉仇恨0.1伤兜底 ...（已补回）`）。
- 友方安全：`beforeEvents.entityHurt` 新增“狗作为受害者”分支——友方玩家/友方狗打狗一律 `ev.cancel`，狗永远不会因友方伤害而反击友方；敌方伤害正常放行。
- 空闲拉回：没有目标且离主人 >24 格时，`teleport` 到主人身边安全点（日志 `狗拉回主人`，每 5 秒节流）；追击中不打断。
- 击杀归属、友伤拦截（玩家侧）、狗名牌、35 秒寿命均保留。

### 待实机确认

- 日志应出现 `拉仇恨0伤`（或 `拉仇恨0.1伤兜底`）→ 随后 `狗追击检查 ...（正在追赶）` → `狗咬伤`。
- 若 `拉仇恨0.1伤兜底` 出现后仍是“基本不动”，说明该引擎连伤害归属都不认，此路不通，转脚本追击方案。
- 友方打狗不掉血；狗空闲离主人远会自动回到主人身边。

## 53. 第五十三轮调整（2026-08-14，改用真正的原版狼）

用户怀疑自定义狗实体本身有问题，要求改为直接召唤原版 `minecraft:wolf`，其余要求不变。

处理：
- `tomeSummoner` 改为 `spawnEntity("minecraft:wolf")`，不驯服，保持野生状态；`jimie_owner`/`jimie_remain`/队伍 tag 照常设置。
- 拉仇恨机制不变：脚本模拟敌方对狗 0 伤攻击（无效则 0.1 伤并补回），触发原版野生狼的 `hurt_by_target` 锁仇恨。
- 友方打狗取消：`isOurWolf()` 统一识别“芙希狗”（自定义旧版或带 `jimie_owner` 的原版狼），友方伤害一律拦截。
- 防偷狗：原版狼可被喂骨头驯服，`tickWolves` 每 10 tick 检查 `tameable.isTamed`，一旦被驯服立即移除（日志 `狗被驯服，已移除`）。
- 空闲拉回、狗名牌、击杀归属、35 秒寿命不变。
- 旧自定义狼实体/RP 文件再次归档到 `_stale_legacy_wolf\`，启动时清理旧自定义狼实体、恢复带 `jimie_owner` 的原版狼。

### 待实机确认

- 召唤出的是原版狼外观；日志顺序 `拉仇恨0伤 → 狗追击检查（正在追赶） → 狗咬伤`。
- 友方打狗不掉血；离主人远会回主人身边；被喂骨头会直接消失。

## 54. 第五十四轮恢复（2026-08-14，恢复自定义驯服狗，去掉脚本硬输出）

用户确认：此前“狗不咬人”根因是和平模式（和平模式狗不会攻击），并非代码问题。

恢复内容：
- 自定义狼实体（`jimie:fuxi_wolf_red/blue`）恢复：驯服组件组（is_tamed/血量20/攻击4/项圈红14蓝11/坐姿）、原版仇恨组件（`owner_hurt_by_target`、`owner_hurt_target`、`teleport_to_owner`、`follow_owner`）、主动索敌（`nearest_attackable_target`：玩家+对方队伍标签，35 格，驯服组优先级 3 + 基础兜底优先级 7）。
- `tomeSummoner` 恢复：生成自定义狗 + `tame()` + `jimie:on_tame` + 10 tick 驯服校验（未生效自动补触发，最多 3 次）。
- RP 恢复：自定义狼客户端实体/渲染控制器/行走动画。

不恢复（用户明确不要脚本“硬输出”）：
- 脚本撕咬伤害（`applyDamage` 魔法伤害兜底）——删除；
- 拉仇恨 0 伤/0.1 伤机制——删除；
- 脚本追击助推（applyImpulse）——不恢复；
- 脚本空闲拉回 TP——不恢复（由原版 `follow_owner` + `teleport_to_owner` 负责）。

保留：狗名牌（队伍/主人/血量）、击杀归属、友伤拦截（玩家侧+狗侧）、35 秒寿命、追击诊断日志、防偷狗（被非主人驯服才移除）。

### 待实机确认（非和平模式）

- 狗主动索敌 35 格内最近敌方并用原版走咬；不打友方；跟随主人；日志出现 `狼索敌` / `狗追击检查（正在追赶）` / `狗咬伤`。

## 57. 第五十七轮调整（2026-08-14，幽灵隐藏图腾/选择器 + 复活倒计时）

需求：不死图腾（及可能的话第三人称复活选择器）不要显示，避免幽灵被手持物品暴露位置；复活等待显示剩余时间。

处理：
- 幽灵等待（`tickDeathWait` 与 `playerSpawn` 幽灵分支）新增 `stripGhostTotem(p)`：把主手/副手的不死图腾直接收走（原版图腾的手持模型无法被资源包可靠覆盖，收走物品最彻底）；复活后由布德宗图腾逻辑按 CD 自动补回。
- 复活选择器保持“第三人称隐藏、第一人称可见”，并给图腾/选择器两个 attachable 增加 `hand_invisible` 动画（`query.is_invisible` 时 scale 0）作为隐身兜底。
- 复活等待倒计时：`tickDeathWait` 每 10 tick 用 action bar 显示 `复活等待剩余 X 秒`（≥10 秒取整，<10 秒保留 1 位小数）。

## 56. 第五十六轮修复（2026-08-14，敌方群体范围效果对狗无效）

现象：敌方的迟滞/瘴阵/茶雅范围效果与击灭突进对狗无效。

根因：`playersInCylinder` 只返回玩家；指示物字段与突进的命中列表都只含玩家，狗被完全排除。

处理：
- 新增 `enemyWolvesInCylinder`：按 `jimie_owner` 解析主人队伍，只收集与施法方敌对的狗（友方狗不计入）。
- 指示物（迟滞/瘴阵/茶雅）：范围内目标 = 敌方玩家 + 敌方狗，狗同样被施加缓慢/致命中毒/中毒（沿用“没有该效果才施加”逻辑，免疫窗口对狗不适用）。
- 击灭突进：锥形判定目标 = 敌方玩家 + 敌方狗，狗同样受 6 点魔法伤害并随突进传送。
- 同舟/祝福等友方范围效果仍只作用于玩家，不涉及狗。

## 55. 第五十五轮修复（2026-08-14，敌方远程攻击打不到狗）

现象：敌方的法杖/魔杖射线对狗无效。

根因：`wandShot` 的射线命中列表只收集玩家（`world.getAllPlayers()`），狗不在列表里且不是实心方块，射线直接穿过狗，永远无法命中。

处理：
- `wandShot` 增加“敌方狗”命中：按 `jimie:fuxi_wolf_*` + `jimie_owner` 解析主人队伍，只把“与射击者敌对”的狗加入命中列表；友方狗仍穿透。
- 命中狗时与命中玩家同样处理：造成法杖伤害（2/1，魔法）、5 格内小击退、暴击粒子；击杀归属只对玩家生效（狗不计分）。
- 狗自身带抗性 II，伤害会有约 40% 减免，属正常减伤，不再是“无效”。

## 51. 第五十一轮调整（2026-08-14，芙希狗头顶名牌）

- 狗也加 TextPrimitive 头顶名牌，规则与玩家名牌一致：
  - 第 1 行：`[红队/蓝队] 主人名的狗`（红队 §c / 蓝队 §b）；
  - 第 2 行：血量条 + 数值（复用 `healthText`，上限 20）。
- 可见规则：同队玩家恒可见；敌方 35 格内可见；普林西斯指示物范围内无视距离/隐身显示；狗隐身时敌方不可见（正常情况狗不会隐身）。
- 隐藏狗的原版 `nameTag`，只保留 TextPrimitive；狗消失/过期时自动清理名牌。
- 名牌偏移 (0, 1.15, 0)、scale 0.5，每 10 tick 刷新血量与可见名单。

## 45. 第四十五轮调整（2026-08-13，头顶名牌加血量）

- `playerLabelText` 新增血量行（名字下方第二行）：10 格血条 + 数值“当前/上限”。
  - 血条按比例变色：>50% 绿色、>25% 黄色、其余红色；空血格用灰色 `░`。
  - 上限读取 `minecraft:health` 的 `effectiveMax`（含生命提升 V/VIII），基础保底 20。
- 名牌行结构变为：名字 → 血量 → 学派+秘典 → 状态 → CD。

## 58. 第五十八轮修复（2026-08-14，隐身时图腾第三人称仍可见）

现象：游戏中有隐身效果（隐袭等）时，不死图腾在第三人称仍会显示，暴露位置。

处理：
- 新增 render controller `controller.render.jimie_hand`，用 `part_visibility: { "*": "query.is_first_person" }` 在渲染控制器层面隐藏第三人称模型（`query.is_first_person` 为官方 Molang 查询，比动画条件更可靠）。
- 图腾与复活选择器两个 attachable 均改用该渲染控制器：第三人称（其他玩家视角）完全不显示手持模型，第一人称保持可见；对隐身/幽灵同样生效。
- 保留原有动画层隐藏与幽灵期间收走图腾的逻辑作为双保险。

## 59. 第五十九轮调整（2026-08-14，图腾第一/第三人称贴图分离）

用户反馈：不能用“隐身时收走图腾”的方案（隐身期间也可能死亡，图腾必须留在手上保命）；要求第一人称与第三人称贴图分离。

处理：
- 新增全透明贴图 `textures/items/jimie_totem_hidden.png`（16x16 全透明）。
- 图腾 attachable 定义两张贴图：`default`（原版图腾）/ `hidden`（全透明）。
- 新增专用渲染控制器 `controller.render.jimie_totem`：
  - 贴图数组按 `!query.is_first_person` 选择（第三人称用透明贴图）；
  - `part_visibility: { "*": "query.is_first_person" }` 双保险隐藏第三人称模型。
- 第一人称保持原版图腾贴图；图腾始终留在手上，不影响保命。
- 注意：若自定义 attachable 在该版本无法覆盖原版图腾的手持渲染，此方案也会失效——届时按用户约定“实在做不到就算了”。
