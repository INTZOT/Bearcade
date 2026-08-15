# Doublecheck spec

## Goal
给 /big 补上三项能力:附魔中文名翻译参考(输入与提示),物品染色(皮革等可染色物品 RGB 自定义),以及 can_destroy/can_place_on 属性设置。

## Scope
仅修改 Toolkit-开发者工具/src/big.ts:VANILLA_ENCHANTMENTS 增加 zh 字段、parseEnchantList 支持中文名、表单新增颜色 RGB/可摧毁/可放置三字段及附魔参考提示、giveItem 增加三属性应用逻辑。重新构建并部署 toolkit。

## Acceptance criteria
① VANILLA_ENCHANTMENTS 增加中文名(42 种),附魔列表解析同时支持中文名(如"锋利 5"、耐久 3),表单附魔字段下加一行中文参考提示;② 表单新增"颜色 RGB"文本框(0-255 逗号分隔,如 255,85,255):物品带 minecraft:dyeable 组件(如皮革装备)时写入 ItemDyeableComponent.color(转 0-1 浮点),不可染色物品提示"该物品不可染色,已忽略颜色";③ 表单新增"可摧毁方块"与"可放置方块"文本框(逗号分隔方块 ID,如 stone,grass_block):分别调用 ItemStack.setCanDestroy/setCanPlaceOn,不设门禁、任意物品可设;④ 非法颜色输入(非数字/越界)提示并中止发放,合法输入 clamp 0-255;⑤ typecheck/build 通过并重新部署。

## Failure modes
颜色输入格式错误→ 明确提示"颜色格式应为 0-255 的 R,G,B"并中止本次发放;物品无 dyeable 组件→ 忽略颜色并黄色提示,不中止;can_destroy/can_place_on 传了无效方块 ID→ 引擎静默忽略或抛错,套 try/catch 后提示;解析器中文名与英文名冲突→ 中文名精确匹配优先于模糊匹配;表单字段过多→ 分组保持可读性,新字段插在附魔与开关之间。

## Priorities
三项功能全部走现有表单体系,零新依赖;中文翻译覆盖全部 42 种附魔;失败模式全部"提示并继续/中止"清晰;改动仅限 Toolkit/src/big.ts。

## Non-goals
不做颜色选择器(文本 RGB 输入即可);不做皮革装备之外的自定义染色纹理;不改动已上线的多附魔与发放流程;不修改其他包。
