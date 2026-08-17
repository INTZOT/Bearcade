# 饥饿游戏(HungerGame)

Bearcade 小游戏包:FFA 大逃杀——等分圆出生、搜刮物资箱、遭遇战,最后存活者获胜。房间管理复用 `shared/minigame-core`,玩法在 [src/game.ts](src/game.ts)。

## 已确认玩法

- **每房 4~16 人,共 2 个房间,支持派对模式**(派对超 16 人出生等分圆第二圈);
- **五个阶段 + 保底**:1 冻结(不可移动,默认 10s)→ 2 保护期(可移动可搜刮不可战斗,30s)→ 3 PVP 一阶段(300s)→ 4 PVP 二阶段(中心箱升级 4 级,300s)→ 5 死斗(剩余玩家传送死斗场,120s)→ 6 扣血保底(全员持续扣血,同归于尽并列获胜);全部时长可 `/bearcade:config` 配置;
- **地图死场景**:512×512 场地仅作静态场景,放置/破坏全拦截(`canPlace` 返回 false),每次重置只清理掉落物,不重建地图;
- **物资箱热重载**:中心箱(`bearcade:hg_center_chest`,固定 2 级,阶段 4 重置为 4 级)与野外箱(`bearcade:hg_wild_chest`,打开时随机 1~4 级);玩家打开箱子的瞬间才从对应等级物资池随机抽 4~8 个物品分布到 27 槽(原版箱子大小),一局内首次打开填充;
- **物资池**:4 个等级池,每房间各一个隐形 inventory 实体(`bearcade:hg_loot_pool`),`/bearcade:config` → 物资池管理 可保存当前玩家背包到某级池/清空(同步全部房间);效仿战桥 loadout 实体方案;
- **死亡**:掉包保留(掉落物可拾取),最后一击者计击杀;死亡玩家传送观战台 + follow_orbit 观战(照搬 Collapse 方案,需世界作弊),手持望远镜轮换观战目标;
- **退出/断线**:视为淘汰,对局继续(`endGameWhenBelowMin: false`);
- HUD:存活人数 / 阶段 / 击杀数(scoreboardHud)。

## 场地制作(模板维度)

512×512 场地在模板维度 `bearcade:hungergame_template` 制作(`/bearcade:tmp tp hungergame`),坐标范围 ±256:

1. 铺设地图与死斗场(边界由模板自行做墙/屏障),放置中心箱与野外箱点位;
2. 准备房间位于模板坐标 (0,0,0) 附近(与 `src/config.ts` 的 `PREP_SPAWN` 对应);
3. `/bearcade:tmp sz hungergame` 配置捕获范围,`/bearcade:tmp ap hungergame` 应用(64 格分块,8×8=64 块);
4. `/bearcade:config hungergame` 配置出生圆/死斗场中心/观战台/阶段时长。

> 注意:引擎常加载区域上限 100 区块/个,512² 整图无法常加载——已启用 runtime **窗口化分块模式**(`tileWindowed: true`):捕获与放置均按 64×64 单元逐个"建常加载 → 操作 → 卸载",从左上到右下依次进行;房间常加载只覆盖中心区 + 准备房,野外区块由玩家走动自然加载。

## 常用命令

- `/bearcade:tmp tp hungergame` / `sz` / `ap`:模板维度开发;
- `/bearcade:config hungergame`:阶段/出生/死斗/物资池配置;
- `/bearcade:quit`:在房间维度执行,强制中止对局。

详细规范见仓库根目录 `development.md`。
