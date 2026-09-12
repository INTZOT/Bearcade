// ============================================================
// 冰冻地板地图构建
// 由管理员命令 /bearcade:ffbuild 调用,在模板维度生成场地。
// 游戏过程中不会生成地图,只会在房间副本上做融化修改。
// ============================================================
import { type Dimension } from "@minecraft/server";
import { getFrozenFloorConfig } from "./frozenfloor-config";

const AIR = "minecraft:air";
const BLUE_ICE = "minecraft:blue_ice";
const PACKED_ICE = "minecraft:packed_ice";
const SNOW_BLOCK = "minecraft:snow_block";
const SEA_LANTERN = "minecraft:sea_lantern";

function setBlock(
  dim: Dimension,
  x: number,
  y: number,
  z: number,
  type: string,
): void {
  try {
    dim.setBlockType({ x, y, z }, type);
  } catch {
    // 忽略单个方块失败,保证构建命令尽量完整执行
  }
}

function clearArea(
  dim: Dimension,
  cx: number,
  cz: number,
  half: number,
  yMin: number,
  yMax: number,
): void {
  for (let x = cx - half; x <= cx + half; x++) {
    for (let z = cz - half; z <= cz + half; z++) {
      for (let y = yMin; y <= yMax; y++) {
        setBlock(dim, x, y, z, AIR);
      }
    }
  }
}

/** 在指定维度生成冰冻地板场地(蓝冰环 + 等待大厅 + 观战台 + 装饰) */
export function buildFrozenFloorMap(dim: Dimension): void {
  const cfg = getFrozenFloorConfig();
  const cx = Math.floor(cfg.arenaCenter.x);
  const cz = Math.floor(cfg.arenaCenter.z);
  const ringY = Math.floor(cfg.ringY);
  const inner = cfg.innerRadius;
  const outer = cfg.outerRadius;

  // 清理场地范围(含等待大厅与观战台)
  const clearHalf = Math.max(outer + 6, 16);
  clearArea(
    dim,
    cx,
    cz,
    clearHalf,
    Math.min(ringY - 4, -4),
    ringY + 8,
  );

  // 蓝冰环:两层厚,顶部为 ringY,下层为 ringY-1
  for (let x = cx - outer - 1; x <= cx + outer + 1; x++) {
    for (let z = cz - outer - 1; z <= cz + outer + 1; z++) {
      const dx = x - cx;
      const dz = z - cz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist >= inner && dist <= outer) {
        setBlock(dim, x, ringY - 1, z, BLUE_ICE);
        setBlock(dim, x, ringY, z, BLUE_ICE);
      }
    }
  }

  if (cfg.generateDecorations) {
    // 外圈装饰冰柱:16 根,围绕在外圈外 2 格,不参与对局
    const pillarCount = 16;
    for (let i = 0; i < pillarCount; i++) {
      const angle = (i / pillarCount) * Math.PI * 2;
      const px = Math.round(cx + (outer + 2) * Math.cos(angle));
      const pz = Math.round(cz + (outer + 2) * Math.sin(angle));
      for (let y = ringY + 1; y <= ringY + 4; y++) {
        setBlock(dim, px, y, pz, PACKED_ICE);
      }
      setBlock(dim, px, ringY + 5, pz, SEA_LANTERN);
    }
  }

  // 等待大厅:以 prepSpawn 为中心 13×13 平台
  const prep = cfg.prepSpawn;
  const prepY = Math.floor(prep.y) - 1;
  const prepHalf = 6;
  for (let x = Math.floor(prep.x) - prepHalf; x <= Math.floor(prep.x) + prepHalf; x++) {
    for (let z = Math.floor(prep.z) - prepHalf; z <= Math.floor(prep.z) + prepHalf; z++) {
      setBlock(dim, x, prepY, z, SNOW_BLOCK);
    }
  }
  // 等待大厅四周装饰灯
  for (let dx = -prepHalf; dx <= prepHalf; dx += prepHalf * 2) {
    for (let dz = -prepHalf; dz <= prepHalf; dz += prepHalf * 2) {
      setBlock(dim, Math.floor(prep.x) + dx, prepY + 1, Math.floor(prep.z) + dz, SEA_LANTERN);
    }
  }

  // 观战台:3×3 平台,避免淘汰玩家传送后掉落
  const spec = cfg.spectateSpot;
  const specY = Math.floor(spec.y) - 1;
  for (let x = Math.floor(spec.x) - 1; x <= Math.floor(spec.x) + 1; x++) {
    for (let z = Math.floor(spec.z) - 1; z <= Math.floor(spec.z) + 1; z++) {
      setBlock(dim, x, specY, z, SNOW_BLOCK);
    }
  }
}
