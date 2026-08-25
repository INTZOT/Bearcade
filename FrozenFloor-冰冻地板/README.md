# 冰冻地板(FrozenFloor)

Bearcade 小游戏包:环形蓝冰场 + 无限雪球互怼,地板每 30 秒融化收缩,最后存活者获胜。

## 已实现规则

- **房间与人数**:4 个房间,每房 2~12 人,支持派对模式。
- **场地**:环形蓝冰场,默认内圈半径 7、外圈半径 28(可通过 `/bearcade:config frozenfloor` 调整)。
- **融化机制**:
  - 每 30 秒一轮融化,共 6 轮;
  - 每轮外圈向内收缩 2 格、内圈向外扩张 1 格;
  - 融化过程持续数秒,逐块消失;
  - 每轮开始/结束都有公告提示。
- **战斗**:
  - 玩家拥有无限雪球(每格 16 个,开局直接发放,使用后自动补满);
  - 雪球命中后由脚本施加击退,强度可配置;
  - 玩家之间近战伤害/击退完全禁止。
- **生存**:
  - 开局自动获得长时间“饱和”效果,防止饿死。
- **淘汰与排名**:
  - 掉到可配置淘汰高度以下即淘汰;
  - 淘汰玩家进入 follow_orbit 观战(参考豆腐渣地板),手持望远镜切换观战对象;
  - 场上剩 3 人时公布前三名;
  - 对局结束时公布第一名、第二名、第三名;
  - 被淘汰后退出的玩家仍保留名次并上榜;
  - 未被淘汰就主动退出的玩家无法上榜;
  - 最后 1 名存活者获胜,同时淘汰则平局。

## 地图构建

地图**不在游玩过程中生成**,由管理员在模板维度手动生成:

```text
/bearcade:tmp tp frozenfloor     # 进入模板维度
/bearcade:ffbuild                # 生成蓝冰环 + 等待大厅 + 观战台 + 装饰(仅管理员)
/bearcade:tmp sz frozenfloor     # 如需要可配置模板范围
/bearcade:tmp ap frozenfloor     # 应用到全部 4 个房间
```

> 生成地图前请先进入模板维度;`/bearcade:ffbuild` 需要玩家拥有 `op` tag。

## 配置

所有数值均通过 `/bearcade:config frozenfloor` 管理(对局中禁止修改):

- 准备房间坐标、场地中心、蓝冰环顶部 Y;
- 内圈半径、外圈半径;
- 融化间隔、融化动画时长、融化次数;
- 外圈每轮收缩格数、内圈每轮扩张格数;
- 虚空淘汰高度;
- 雪球水平/垂直击退强度;
- 每格雪球数量;
- 观战台位置;
- 是否生成装饰。

## 常用命令

- `/bearcade:ffbuild`:在模板维度生成地图(管理员);
- `/bearcade:tmp tp|ap|sz frozenfloor`:模板维度开发;
- `/bearcade:config frozenfloor`:运行时配置;
- `/bearcade:quit`:在房间维度强制中止;
- `/bearcade:debug frozenfloor enable|disable`:调试日志。

## 结构

```text
FrozenFloor-冰冻地板/
├── Cameras/Presets/spectate.json   # 观战相机预设
├── src/
│   ├── config.ts                   # 游戏/模板/玩法默认配置
│   ├── frozenfloor-config.ts       # /bearcade:config 实现
│   ├── map.ts                      # /bearcade:ffbuild 地图构建
│   ├── game.ts                     # 玩法逻辑
│   └── main.ts                     # 入口 + 命令注册
└── resource-pack/                  # 配对 HUD 资源包
```

详细规范见仓库根目录 `development.md`。
