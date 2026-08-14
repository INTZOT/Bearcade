# Doublecheck spec

## Goal
从 /cis CustomItemStack 表单中移除颜色(染色)属性及其炼药锅辅助,保留其余全部属性编辑能力。

## Scope
仅修改 Toolkit-开发者工具/src/cis.ts(移除颜色相关代码与表单字段),重新构建并部署 toolkit。

## Acceptance criteria
① cis.ts 移除全部颜色相关代码:颜色RGB文本框、16色预设下拉、COLOR_PRESETS/LEATHER_ARMOR/findDyeForColor 常量、ItemProps.color、applyProperties 颜色分支、giveCauldronAssist 及调用;② 其余属性(数量/名称/Lore/附魔/可摧毁/可放置/不可破坏/耐久损坏值/keepOnDeath/lockMode)与表单预填保持不变;③ 表单标题/提示文案不再提及颜色与炼药锅;④ typecheck/build 通过并重新部署。

## Failure modes
漏删引用导致 typecheck 报错→ 以 tsc 输出逐一清理;部署残留旧版→ npm run deploy toolkit 整体重建包目录;记忆中的颜色/炼药锅相关描述同步更新。

## Priorities
干净移除(无死代码);其余功能零回归。

## Non-goals
不新增属性字段(动态属性编辑待用户确认后另行实现);不修改 /btd;不修改其他包。
