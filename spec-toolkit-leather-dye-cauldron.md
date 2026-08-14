# Doublecheck spec

## Goal
确认 1.26.42 无法用 SAPI 直接给原版皮革装备染色后,移除被拒的 items/ 覆盖,改用"自动发放水桶+对应染料+炼药锅步骤提示"的原版路径辅助用户获得染色皮革装备。

## Scope
删除 Toolkit-开发者工具/items/(4 文件);scripts/deploy.mjs 与 scripts/package.mjs 还原静态清单;Toolkit-开发者工具/src/big.ts:COLOR_PRESETS 增加 dye 字段(16 色)、染色失败分支增加皮革装备的炼药锅辅助(发水桶+染料+步骤提示)。重新构建部署;更新项目记忆。

## Acceptance criteria
① 删除 Toolkit-开发者工具/items/ 四个被引擎拒绝的覆盖文件,deploy.mjs/package.mjs 还原(移除 items 枚举);② big.ts 染色失败分支升级:若目标物品为四件皮革装备且请求了颜色,自动发放 1 个水桶 + 1 个与预设色匹配的染料(预设表增加 dye 字段,16 色映射 16 种染料),并给出炼药锅染色步骤提示(放锅→倒水→染料调色→皮革甲点锅);非皮革物品保持原提示;③ 组件清单诊断日志保留;④ typecheck/build 通过并重新部署;⑤ 记忆更新:1.26.42 原版皮革装备 SAPI 不暴露 dyeable、旧格式物品无法 items/ 覆盖、脚本直染不可行(炼药锅为唯一路径)。

## Failure modes
预设无对应染料(手动输入颜色)→ 只给水桶+通用提示(玩家自备染料);背包满→ addItem 返回剩余,沿用剩余堆提示;玩家不知道炼药锅操作→ 提示写明完整步骤;覆盖文件删除后 ContentLog 不再有 Item error 噪音。

## Priorities
先清理失败方案(覆盖文件与脚本枚举);辅助路径尽可能顺滑(水桶+染料一次给齐);信息透明(告知机制限制)。

## Non-goals
不造自定义 ID 的染色皮革替代品;不模拟炼药锅染色(引擎无此 API);不做染料与任意 RGB 的精确匹配(只覆盖 16 预设色)。
