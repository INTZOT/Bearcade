# Doublecheck spec

## Goal
修复 /big 皮革装备染色失败:实测 ItemStack.getComponent("minecraft:dyeable") 对原版 leather_chestplate 返回空;通过 items/ 覆盖定义显式补齐 dyeable 组件 + 失败时输出组件清单实证。

## Scope
新增 Toolkit-开发者工具/items/ 四个皮革装备覆盖 JSON;scripts/deploy.mjs 与 scripts/package.mjs 静态清单加 "items";Toolkit-开发者工具/src/big.ts 染色失败分支加组件清单诊断日志。重新构建并部署 toolkit。

## Acceptance criteria
① Toolkit 包新增 items/ 目录:leather_helmet/leather_chestplate/leather_leggings/leather_boots 四个覆盖定义,显式声明 minecraft:dyeable(default_color 175,105,62)及 icon/display_name/max_stack_size/enchantable/wearable/durability 组件;② scripts/deploy.mjs 与 scripts/package.mjs 静态目录清单增加 "items";③ big.ts 染色失败分支增加诊断:console.warn 输出该 ItemStack 的完整组件清单(getComponents().map(typeId)),玩家提示保持;④ typecheck/build 通过并重新部署;⑤ 部署目录含 items/ 四文件。

## Failure modes
原版皮革本无 dyeable 组件→ items/ 覆盖补上(若为合并语义)或完整替换(定义已含必需组件);覆盖定义被引擎拒绝→ 内容日志报错、物品回退原版定义,不影响其他功能;组件清单仍无 dyeable→ 说明 SAPI 不暴露该组件,据 ContentLog 实证再定下一步(可能需完整复刻原版定义);染色成功→ 玩家直接看到蓝色皮革装备。

## Priorities
先拿实证(组件清单日志);覆盖定义尽量保真(必需组件齐全);失败安全(被拒则回退原版)。

## Non-goals
不覆盖狼铠等非皮革物品;不做完整原版定义逐字段复刻(先验证覆盖是否被接受);不改动染色逻辑本身。
