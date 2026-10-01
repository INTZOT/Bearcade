// ============================================================
// 轮转井字棋地图构建
// 由管理员命令 /bearcade:trio_buildmap 在模板维度生成:
//   - 11×11 走道地板(准备对局时站位)
//   - 走道四周 2 格高屏障(自定义维度是空维度,防止玩家掉虚空)
//   - 中央 3×3 磁石棋盘(比走道高一格,棋子方块放在棋盘上表面 = boardY+1)
//   - 准备房间平台(prepSpawn 下方一层,7×7)
// 游戏过程中不会重建地图;房间重置只从模板重新复制。
// ============================================================
import { type Dimension } from "@minecraft/server";
import { getTrioConfig } from "./trio-config";
import { BOARD_BLOCK, BOARD_SIZE } from "./config";

const AIR = "minecraft:air";
const FLOOR = "minecraft:smooth_stone";
const FLOOR_EDGE = "minecraft:polished_andesite";
const BARRIER = "minecraft:barrier";
const LIGHT = "minecraft:sea_lantern";
const PREP_FLOOR = "minecraft:smooth_stone";
const PREP_EDGE = "minecraft:polished_andesite";

/** 走道在地板外再外扩的半径(除棋盘外的可站立区域) */
const WALK_RADIUS = 4;

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

export function buildTrioMap(dim: Dimension): void {
  const cfg = getTrioConfig();
  const boardY = Math.floor(cfg.boardY);
  const minX = Math.floor(cfg.boardMinX);
  const minZ = Math.floor(cfg.boardMinZ);
  const maxX = minX + BOARD_SIZE - 1;
  const maxZ = minZ + BOARD_SIZE - 1;
  const centerX = Math.floor((minX + maxX) / 2);
  const centerZ = Math.floor((minZ + maxZ) / 2);
  const edge = Math.floor(BOARD_SIZE / 2) + WALK_RADIUS; // 3×3 时为 1+4=5

  // ---- 走道地板(y = boardY - 1)+ 屏障 + 顶部清空 ----
  for (let x = centerX - edge; x <= centerX + edge; x++) {
    for (let z = centerZ - edge; z <= centerZ + edge; z++) {
      const isEdge =
        x === centerX - edge ||
        x === centerX + edge ||
        z === centerZ - edge ||
        z === centerZ + edge;
      setBlock(dim, x, boardY - 1, z, isEdge ? FLOOR_EDGE : FLOOR);
      // 屏障:外圈地板之上 2 格(防止玩家走出场地掉虚空)
      setBlock(dim, x, boardY, z, isEdge ? BARRIER : AIR);
      setBlock(dim, x, boardY + 1, z, isEdge ? BARRIER : AIR);
      setBlock(dim, x, boardY + 2, z, AIR);
    }
  }

  // ---- 中央 3×3 磁石棋盘(y = boardY,比走道高一格)----
  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      setBlock(dim, x, boardY, z, BOARD_BLOCK);
      // 棋子层与头顶净空
      setBlock(dim, x, boardY + 1, z, AIR);
      setBlock(dim, x, boardY + 2, z, AIR);
    }
  }

  // ---- 走道四角灯(装饰与照明)----
  for (const [dx, dz] of [
    [-edge + 1, -edge + 1],
    [edge - 1, -edge + 1],
    [-edge + 1, edge - 1],
    [edge - 1, edge - 1],
  ]) {
    setBlock(dim, centerX + dx, boardY, centerZ + dz, LIGHT);
    setBlock(dim, centerX + dx, boardY + 1, centerZ + dz, AIR);
  }

  // ---- 准备房间平台(prepSpawn 下方一层,7×7)----
  const prep = cfg.prepSpawn;
  const px = Math.floor(prep.x);
  const pz = Math.floor(prep.z);
  const py = Math.floor(prep.y) - 1;
  const half = 3;
  for (let x = px - half; x <= px + half; x++) {
    for (let z = pz - half; z <= pz + half; z++) {
      const isEdge =
        Math.abs(x - px) === half || Math.abs(z - pz) === half;
      setBlock(dim, x, py, z, isEdge ? PREP_EDGE : PREP_FLOOR);
      for (let y = py + 1; y <= py + 4; y++) {
        setBlock(dim, x, y, z, AIR);
      }
    }
  }
  for (const [dx, dz] of [
    [-half, -half],
    [half, -half],
    [-half, half],
    [half, half],
  ]) {
    setBlock(dim, px + dx, py + 1, pz + dz, LIGHT);
  }
}
