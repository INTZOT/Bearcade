# Doublecheck spec

## Goal
新建独立工具包 Toolkit-开发者工具:完整移植 BetterTextDisplay 悬浮公告功能(/btd)并新增 BetterItemGive 物品获取功能(/big 表单发放带属性物品,取代原版 /give 的手工输入),typecheck 与 build 通过。

## Scope
新建 Toolkit-开发者工具/src/{config.ts,main.ts,notice.ts,big.ts};config/packs.json 注册 toolkit 条目(新 header/module UUID,dependencies 为 @minecraft/server 2.10.0-beta + @minecraft/server-ui 2.2.0-beta,packDependencies:[]);tsconfig.json include 增加该目录。notice.ts 为原版 BetterTextDisplay notice.js 的 TypeScript 移植(TextPrimitive + primitiveShapesManager,动态属性 notice:list);big.ts 为 /big 命令与表单。不动其他包。

## Acceptance criteria
① npm run typecheck 与 npm run build 零错误,生成 Toolkit-开发者工具/manifest.json 与 scripts/main.js(已 gitignore);② /btd(注册名 toolkit:btd)与 /big(注册名 toolkit:big)均仅管理员(op)可用、无需开作弊;③ 悬浮公告完整复刻原版 BetterTextDisplay:新建/编辑/删除、8 色、缩放 0.5~5、背景+透明度、跟随镜头/固定朝向 Yaw、多行(字面 \n 兼容),持久化 notice:list(旧数据兼容,缺 dimensionId 默认主世界),worldLoad 重建 + 每 200 tick 全量重渲染自愈;④ 公告渲染在创建者执行命令时所在维度(entry.dimensionId);⑤ /big 表单字段:类型ID(文本框,自动补 minecraft: 前缀)、数量(1-255)、nameTag、lore(多行)、附魔(下拉 47 种+无、等级任意整数)、不可破坏、死亡不掉落、物品锁定(不锁定/slot/inventory);发放成功提示并留在表单便于连续发放;⑥ 提交非法输入(无效类型ID/附魔超限或不适配/背包满)时给出明确提示并重开表单,不抛未捕获异常。

## Failure modes
附魔超限(EnchantmentLevelOutOfBoundsError)或类型不适配(EnchantmentTypeNotCompatibleError)→ try/catch 提示后重开表单;类型ID 无效→ ItemStack 构造抛错,捕获并提示;数量非数字/越界→ 解析失败提示,合法区间 1-255(引擎自动 clamp 到最大堆叠);无耐久组件的物品勾选不可破坏→ 组件不存在时跳过并提示;公告目标维度不存在或未加载→ renderNotice 逐行 try/catch,失败条目由 200 tick 自愈循环重试;旧数据无 dimensionId→ 默认主世界;命令回调受限上下文→ system.runTimeout 打开表单;背包满→ container.addItem 返回 false 时提示;构建产物入库→ gitignore 已覆盖 */scripts/ 与 */manifest.json。

## Priorities
悬浮公告 1:1 复刻原版功能与数据格式(无缝迁移);/big 覆盖用户已选全部字段(类型+数量、nameTag、lore、附魔、unbreakable、keepOnDeath、lockMode);遵循 Bearcade 工程约定(packs.json 唯一事实源、构建产物不入库、TS 源码 + esbuild);两命令权限按用户选择均设为仅管理员。

## Non-goals
不实现"装备属性"系统(手持加攻/加最大生命等 Java attribute 式效果——本轮只给出可行方案,后续作为扩展);不做物品类型下拉(用户选纯文本框);不向 Core 注册为小游戏(纯工具包,不参与房间/菜单);不修改 shared/minigame-core、Core 或既有游戏包;不部署、不提交 git。
