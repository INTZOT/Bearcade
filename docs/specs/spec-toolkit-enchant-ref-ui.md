# Doublecheck spec

## Goal
为 /big 增加独立的"附魔译名参考"界面:42 种附魔以"英文名 → 中文名"列表展示,可从主表单一键进入并返回。

## Scope
仅修改 Toolkit-开发者工具/src/big.ts:新增 openEnchantReference 独立表单函数;openBigForm 底部增加"附魔译名参考"按钮;主表单参考 label 缩短。重新构建并部署 toolkit。

## Acceptance criteria
① 新增独立表单"附魔译名参考":42 种附魔逐行列出,格式"英文名 → 中文名"(如 Sharpness → 锋利),label 支持 § 颜色区分;② /big 主表单底部新增"附魔译名参考"按钮,打开独立界面,该界面"返回"回到主表单(保持连续发放流程);③ 主表单内原有的长中文参考 label 缩短为一行指引(指向独立界面);④ typecheck/build 通过并重新部署。

## Failure modes
表单内容超长不滚动→ DDUI CustomForm 支持纵向滚动(配置菜单已有 15+ 按钮先例),42 行 label 可滚动浏览;中文/§ 颜色码在 label 不生效→ 已知 label 支持 §,若不支持则退化为纯文本;按钮误放中间影响布局→ 参考按钮与发放/关闭同放底部。

## Priorities
列表可读性(颜色区分英文/中文);与主表单双向跳转;改动仅限 Toolkit/src/big.ts。

## Non-goals
不在主表单内展示完整译名列表(用户明确要单独界面);不做译名搜索/分类(纯列表);不改动附魔输入与解析逻辑(中文名输入已支持)。
