# Doublecheck spec

## Goal
/big 支持一个物品添加多个附魔:表单改为多行附魔列表输入,逐个校验与添加,成功/失败逐条反馈。

## Scope
仅修改 Toolkit-开发者工具/src/big.ts:表单字段替换(移除附魔下拉与等级输入,新增多行附魔列表文本框)、新增 parseEnchantList 解析函数、giveItem 附魔逻辑改为循环 canAddEnchantment+addEnchantment 并汇总成功/失败。其余文件不动。

## Acceptance criteria
① /big 表单的"附魔下拉+等级"替换为单个多行文本框"附魔列表",每行一个"名称 等级"(支持 minecraft: 前缀/下划线/CamelCase 枚举名,如 sharpness 5、minecraft:unbreaking 3、BowInfinity 1);② 解析后逐个调用 canAddEnchantment + addEnchantment:可加的附上,冲突/超限/未知的跳过并逐条报告失败原因(如"smite Lv.5(与已有附魔冲突)"),成功条目一并提示;③ 物品不支持附魔(无 enchantable 组件)时仍提示"该物品不支持附魔"并中止;④ typecheck/build 通过并重新部署;⑤ 单附魔行为与原来一致。

## Failure modes
名称解析失败(拼写错误/未知附魔)→ 该行报告"未知附魔"并继续处理其余行;等级非数字→ 按 1 处理;等级超出原版上限或冲突→ canAddEnchantment 抛错或返回 false,捕获后逐条提示,不影响其他附魔与物品发放;物品无 enchantable 组件→ 整体中止并提示(避免发一堆报错);表单文本为空→ 跳过附魔步骤,正常发放。

## Priorities
解析容错(名称多种写法);部分成功优于整体失败(逐个 try/catch);错误信息可读(中文提示+具体原因);改动局限在 Toolkit/src/big.ts。

## Non-goals
不做 DDUI 动态行表单(本版本无 ObservableArray);不做附魔冲突的自动替代(如实报告即可);不改动 42 种附魔清单与既有发放流程;不修改其他包。
