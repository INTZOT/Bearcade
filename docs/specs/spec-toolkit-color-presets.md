# Doublecheck spec

## Goal
/big 皮革染色增加常用颜色预设下拉,一键选择常见染料色。

## Scope
仅修改 Toolkit-开发者工具/src/big.ts:新增 COLOR_PRESETS 常量、颜色预设下拉字段(colorPresetObs)、提交逻辑预设优先。重新构建并部署 toolkit。

## Acceptance criteria
① /big 表单新增"常用颜色预设"下拉(16 种常见皮革染色色:白/黑/红/橙/黄/绿/青/蓝/紫/粉/棕/灰/金/深红/天蓝/深绿 + 无);② 提交时若选中预设(非"无")优先使用预设 RGB(转 0-1 浮点写入 ItemDyeableComponent.color),手填 RGB 框被忽略(表单 label 注明);③ 未选预设时沿用原手填解析(非法输入仍报错中止);④ typecheck/build 通过并重新部署。

## Failure modes
预设索引越界→ 下拉索引始终在合法范围,兜底当"无"处理;物品不可染色→ 沿用原提示"该物品不可染色,已忽略颜色";预设颜色值本身无需校验(常量);手填与预设同时存在→ 预设优先,label 明示避免困惑。

## Priorities
预设覆盖 16 种常用染料色;交互简单(下拉+提交即用);改动仅限 Toolkit/src/big.ts。

## Non-goals
不做色板/取色器 UI;不做预设实时回填文本框(提交时直接取用);不改动染色与发放既有逻辑。
