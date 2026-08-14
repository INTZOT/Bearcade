# Doublecheck spec

## Goal
/big 增加"对主手物品应用属性"模式:直接修改玩家手持物品的名称/Lore/附魔/颜色/可摧毁/可放置/锁定等属性并写回主手,不发新物品。

## Scope
仅修改 Toolkit-开发者工具/src/big.ts:提取 applyProperties 公共函数(现有 giveItem 属性应用逻辑重构)、新增 applyToHeldItem、表单加"应用到主手物品"开关、提交分支处理。重新构建并部署 toolkit。

## Acceptance criteria
① /big 表单新增开关"应用到主手物品(不发放新物品,忽略类型/数量)";开启时:读取玩家主手 ItemStack(container.getItem(selectedSlotIndex)),空手则提示"请先手持一个物品";② 开启时应用全部属性字段:nameTag/lore/附魔列表/颜色/可摧毁/可放置/unbreakable/keepOnDeath/lockMode(语义与发放模式一致:附魔叠加、改名覆盖、颜色失败提示);应用后 container.setItem 写回主手;③ 发放模式行为与现状完全一致(类型+数量新建发放);④ 颜色失败且目标为皮革装备时,两种模式都走"水桶+染料+炼药锅步骤提示"辅助;⑤ typecheck/build 通过并重新部署。

## Failure modes
主手为空→ 明确提示并中止;主手物品在应用期间被换走/清空→ setItem 前重新 getItem 校验同一槽位,异常 try/catch;皮革装备读主手后仍无 dyeable 组件→ 保持炼药锅辅助(实测若主手物品能暴露 dyeable 则直接染色成功,属于额外收获);属性应用失败(附魔全败等)→ 与发放模式相同的中止/部分成功语义;开关开启时忽略类型/数量输入(不再校验)。

## Priorities
属性应用逻辑与发放模式完全复用(单一代码路径);写回主手安全(写回前重新校验);皮革染色辅助逻辑两模式共享。

## Non-goals
不做物品清理/重置按钮;不改变发放模式行为;不模拟炼药锅染色;不修改其他包。
