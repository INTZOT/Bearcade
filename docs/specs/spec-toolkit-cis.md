# Doublecheck spec

## Goal
将 /big 物品发放功能改造为 CustomItemStack:/cis 命令,手持物品打开表单,直接修改主手 ItemStack 的全部可写属性(含数量/耐久损坏值),不再发放新物品。

## Scope
Toolkit-开发者工具:config.ts 命令常量改为 COMMAND_CIS;main.ts 注册 toolkit:cis 并移除 toolkit:big;删除 src/big.ts,新增 src/cis.ts(openCisForm + 属性应用 + 主手写回,含数量/耐久损坏值字段);重新构建并部署。

## Acceptance criteria
① 命令更名为 /cis(注册名 toolkit:cis),/big 移除;功能名 CustomItemStack,入口为手持物品后执行命令;② 表单不再有类型ID/数量(发放)与"应用到主手"开关,改为显示当前手持物品类型,属性字段:数量(可写,1-255,超限或不可堆叠时捕获提示)、nameTag、lore、附魔列表(中英文名)、颜色RGB+预设、可摧毁/可放置、unbreakable、耐久损坏值(0-maxDurability,仅带耐久组件时生效)、keepOnDeath、lockMode;③ 提交后直接改主手物品并写回(空手不开表单;写回前校验槽位未变);④ 皮革染色失败仍走水桶+染料+炼药锅提示;⑤ 附魔译名参考按钮保留;⑥ big.ts 删除、新增 cis.ts;config.ts/main.ts 命令常量与注册同步;⑦ typecheck/build 通过并重新部署。

## Failure modes
主手为空→ openCisForm 检查并提示不开表单;数量超物品上限/不可堆叠→ 捕获异常提示"该物品不支持该数量";耐久损坏值越界→ clamp 0..maxDurability;写回时主手被换走→ 校验失败提示重试;皮革染色→ 炼药锅辅助;旧 /big 命令失效属预期(功能更名)。

## Priorities
属性覆盖面完整(补齐数量与耐久损坏值);单一路径(应用即写回主手);复用现有 applyProperties/炼药锅辅助/译名参考逻辑。

## Non-goals
不保留发放(give)模式与 /big 命令;不做物品删除/重置按钮;不修改 /btd;不修改其他包。
