# Snowstorm 粒子工作区

这个目录只用于在 VS Code 的 Snowstorm 扩展中制作和预览新粒子。

- `particles/*.particle.json` 是从当前资源包复制出的只读参考副本，原来的 `resource-pack/particles/*.json` 没有修改。
- `textures/particle/` 放置预览所需的贴图。Snowstorm 会根据粒子 JSON 中的 `texture` 路径加载它们。
- 新效果先在这里制作和预览，确认样式后再复制到 `resource-pack/particles/`，改成正式 identifier，并由脚本接入 `src/fx.ts`。

## 在 VS Code 中打开

1. 打开 `AllStars-灯塔全明星` 项目目录。
2. 打开本目录下任意 `*.particle.json`。Snowstorm 的自定义编辑器只匹配这个后缀；正式资源包里的旧文件名仍保持 `.json`。
3. 在 Snowstorm 中调发射数量、寿命、速度、朝向、billboard、颜色和 UV，保存后 JSON 会直接更新。
4. 贴图面板可以新建或导入 PNG。固定的 `KO`、`SA3`、`BREAK` 等字样可以做成贴图粒子；动态血量、气量、回合数和玩家名继续使用现有 TextPrimitive/UI。

## 适合与不适合的用途

Snowstorm 生成的是基岩版世界空间粒子，适合：

- 大招蓄力光环、叶片环、珍珠爆散、冲击波和轨迹；
- 固定内容的近景字样或徽标贴图；
- 跟随施法者、受击点或镜头附近锚点的短时特效。

它不能可靠地提供真正的屏幕空间图层。全屏黑幕、白闪和可控的遮罩优先使用 `camera.fade` 或资源包 UI；动态文字优先使用 TextPrimitive。把超大的 billboard 粒子放在镜头前可以做装饰性遮罩，但会受 FOV、距离、视线遮挡和粒子裁剪影响，暂不作为核心 HUD 方案。

制作新的大招演出时，先在这里新建粒子和贴图，确认后再接入战斗逻辑；现有七个叶片/珍珠粒子保持不动。
