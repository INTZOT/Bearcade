# ============================================================
# 麻将 26×26 场地构建(在模板维度执行)
# 用法:/function build_field
# 默认场地:地板 Y=64,范围 X -12~13, Z -12~13
# 包含:地板、边界 Barrier、中央骰子台、四侧计分按钮(墙装)
# ============================================================

# 清空
fill -13 63 -13 14 70 14 air

# 地板(26×26)
fill -12 64 -12 13 64 13 minecraft:polished_blackstone

# 边界墙(barrier 不可见,防止玩家离开方形区域)
fill -13 65 -13 -13 65 13 minecraft:barrier
fill 14 65 -13 14 65 13 minecraft:barrier
fill -13 65 -13 14 65 -13 minecraft:barrier
fill -13 65 14 14 65 14 minecraft:barrier

# 中央骰子台:中心放金块,按钮装在金块北面
setblock 0 65 0 minecraft:gold_block
setblock 0 65 -1 minecraft:stone_button ["facing_direction"=2]

# 四侧计分按钮:支撑块在场地边缘,按钮朝场内
# 南侧(座位1):支撑块 z=13,按钮 z=12 朝北
setblock -1 65 13 minecraft:polished_blackstone
setblock 1 65 13 minecraft:polished_blackstone
setblock -1 65 12 minecraft:stone_button ["facing_direction"=2]
setblock 1 65 12 minecraft:stone_button ["facing_direction"=2]

# 西侧(座位2):支撑块 x=-13,按钮 x=-12 朝东
setblock -13 65 -1 minecraft:polished_blackstone
setblock -13 65 1 minecraft:polished_blackstone
setblock -12 65 -1 minecraft:stone_button ["facing_direction"=5]
setblock -12 65 1 minecraft:stone_button ["facing_direction"=5]

# 北侧(座位3):支撑块 z=-13,按钮 z=-12 朝南
setblock -1 65 -13 minecraft:polished_blackstone
setblock 1 65 -13 minecraft:polished_blackstone
setblock -1 65 -12 minecraft:stone_button ["facing_direction"=3]
setblock 1 65 -12 minecraft:stone_button ["facing_direction"=3]

# 东侧(座位4):支撑块 x=13,按钮 x=12 朝西
setblock 13 65 -1 minecraft:polished_blackstone
setblock 13 65 1 minecraft:polished_blackstone
setblock 12 65 -1 minecraft:stone_button ["facing_direction"=4]
setblock 12 65 1 minecraft:stone_button ["facing_direction"=4]

say Mahjong 场地已生成:26×26 方形,中央骰子与四侧计分按钮就绪
