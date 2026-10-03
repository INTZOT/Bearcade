# AllStars 演出参考资料

这里保存不会被打包脚本覆盖的演出参考文件。

- [super2-reference/super2-reference.html](super2-reference/super2-reference.html) / [super2-reference/super2-reference.png](super2-reference/super2-reference.png)：二气空间框的历史预览。HTML 的 `<base>` 指向下述冻结归档里的 `fighter_workflow/characters/green_beret/previews/v034/`，从那里读取帧图；PNG 是独立截图。
- 原始角色预览、Blockbench 工程和 86 段源动画现位于 `D:\下载 D\2026927\Yes-Steve-Model-Repo\fighter_workflow`。制作入口为该目录的 `README.md`，当前源资产位于 `characters/green_beret/source/v047/`。
- 完整冻结归档位于制作目录下的 `archives/chunye_v1_v047_2026-09-24/`，从其中的 `打开预览.html` 浏览完整预览。归档及同名 ZIP 已校验，不要回写冻结内容。
- 游戏仓库内的 `src/data`、`README.md` 和 [HANDOVER.md](../../HANDOVER.md) 记录了实装数据；旧制作文档中“未接入战斗系统”的描述只代表动画冻结时的状态。

## 外部制作目录配置

[config/allstars-assets.json](../../../config/allstars-assets.json) 的 `workflowRoot` 是四个离线导入/生成脚本的默认来源。解析优先级为命令行第一个参数、`ALLSTARS_FIGHTER_WORKFLOW` 环境变量、该配置。适用于 `allstars-ingest-chunye.mjs`、`allstars-ingest-props.mjs`、`allstars-gen-combat.mjs`、`allstars-scene-assets.mjs`。无效目录会在生成前报错。

以后制作目录再搬家，更新该配置，同时更新二气参考 HTML 的 `<base>`（使用正确编码的 `file:` URL）。日常构建、打包及游戏运行使用仓库内资产，不依赖外部制作目录；无需因为搬家重新导入全部动画。导入脚本会重写运行资产，只在需要更新资产并审查差异时执行。

## 2026-09-27 搬迁核验

冻结归档 10,070 个文件哈希通过，同名 ZIP 的 SHA256 与旁存校验文件一致；工作清单内 114 项资产哈希通过。工作树与归档映射的 10,051 项对比中，三个历史预览目录 `v031`、`v034`、`v036` 各缺 `task04d_hat_fit.png`；完整副本均在冻结归档同路径。不能据此判断它们是否在搬家时丢失。模型、动画及当前游戏包未发现损坏。

**2026-09-28 已恢复：** 用户授权 UAC 管理员进程后，三个工作预览 PNG 已从冻结归档补回；管理员进程与普通开发进程分别校验 SHA256，三项均与 `ARCHIVE_MANIFEST.json` 一致。二气参考页面继续直接引用完整冻结归档。

**后续制作的写权限：** 此次直接以管理员权限复制，未修改目录 ACL。普通用户仍仅有“读取和执行”，工作制作 `README.md` 与 `character_manifest.json` 的旧本机路径也尚未更新。以后保存模型或修改这些元数据时，需使用有写权限的进程，或为实际开发账号配置工作目录“修改”权限；冻结归档继续保持不修改。游戏导入脚本读取的是已更新的路径配置。

构建暂存、测试输出和旧同步备份不作为开发依赖。需要时可以通过源码和 `npm run` 命令重新生成。
