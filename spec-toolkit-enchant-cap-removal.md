# Doublecheck spec

## Goal
从 Toolkit 包完整移除"突破原版附魔上限"功能(实测锋利 666 仍失败,SAPI 等级校验不受数据驱动 max_level 覆盖影响),仓库与部署目录不留残留,typecheck/build 通过。

## Scope
删除 Toolkit-开发者工具/enchantments/(42 个覆盖文件)、scripts/gen-enchantments.mjs、spec-toolkit-enchant-cap.md;scripts/deploy.mjs 与 scripts/package.mjs 移除 "enchantments" 枚举项;Toolkit-开发者工具/src/big.ts 附魔等级文案还原;重新构建并部署 toolkit。

## Acceptance criteria
① Toolkit-开发者工具/enchantments/ 目录(42 个文件)与 scripts/gen-enchantments.mjs 已删除;② scripts/deploy.mjs 与 scripts/package.mjs 的静态目录清单还原(不含 enchantments);③ big.ts 附魔等级输入提示还原为不带 32767 的文案;④ spec-toolkit-enchant-cap.md 删除;⑤ npm run typecheck/build 通过,重新部署后开发行为包目录下不存在 Toolkit-开发者工具/enchantments;⑥ /big 附魔超限时仍走原有 try/catch 提示(原版上限生效)。

## Failure modes
残留 enchantments 目录部署到游戏:重新 npm run deploy toolkit 会整体重建包目录,源目录删除后残留自动清除,并显式验证;deploy/package 脚本多出的枚举项:还原删除,避免死代码;误删无关文件:仅删 enchantments/、gen-enchantments.mjs、spec-toolkit-enchant-cap.md 三个目标,不动 big.ts 的附魔下拉与发放逻辑(该部分保留,仅改文案)。

## Priorities
以用户指令为准直接移除;保证部署目录与仓库同步清理;保留 /big 其余全部功能。

## Non-goals
不调试附魔覆盖为何不生效(用户明确要求移除);不删除 /big 的附魔字段与发放逻辑(仅移除上限突破数据与提示文案);不修改 shared/Core/其他游戏包;不提交 git。
