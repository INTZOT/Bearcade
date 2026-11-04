// ============================================================
// 领地战争的"格子棋盘"模型
// - 每个格子 = 1 个方块,owner 记录归属(0 = 中立,1..N = 颜色槽 + 1);
// - trailOwner 记录"拖出中、尚未落定"的尾迹归属;
// - 圈地判定用洪水填充:从场地四边向内漫灌,漫不到的封闭区域即为圈到的地。
// 本文件只做网格与方块写入,不含对局流程(见 game.ts)。
// ============================================================
import { BlockVolume, type Dimension } from "@minecraft/server";
import {
  FIELD_SIZE_MAX,
  FIELD_SIZE_MIN,
  NEUTRAL_BLOCK,
  PLAYER_COLORS,
} from "./config";

/** 中立(无人占领) */
export const NEUTRAL = 0;

export interface FieldState {
  /** 边长(格) */
  readonly size: number;
  /** 最小角 X(格坐标) */
  readonly originX: number;
  /** 最小角 Z(格坐标) */
  readonly originZ: number;
  /** 地面方块所在 Y */
  readonly y: number;
  /** 每格归属:0 = 中立,1..N = 颜色槽 + 1 */
  owner: Uint8Array;
  /** 每格尾迹归属:0 = 无尾迹,1..N = 颜色槽 + 1 */
  trailOwner: Uint8Array;
  /** 每个颜色槽的领土格数(随占领实时维护) */
  counts: number[];
}

/** 场地边长钳制为合法奇数 */
export function clampFieldSize(size: number): number {
  const rounded = Math.round(Number.isFinite(size) ? size : FIELD_SIZE_MIN);
  const odd = rounded % 2 === 0 ? rounded + 1 : rounded;
  return Math.min(FIELD_SIZE_MAX, Math.max(FIELD_SIZE_MIN, odd));
}

/** 初始领地边长钳制为不小于 1 的奇数 */
export function clampPlotSize(size: number): number {
  const rounded = Math.round(Number.isFinite(size) ? size : 3);
  const odd = rounded % 2 === 0 ? rounded + 1 : rounded;
  return Math.min(15, Math.max(1, odd));
}

export function createField(
  size: number,
  originX: number,
  originZ: number,
  y: number,
): FieldState {
  const total = size * size;
  return {
    size,
    originX,
    originZ,
    y,
    owner: new Uint8Array(total),
    trailOwner: new Uint8Array(total),
    counts: new Array<number>(PLAYER_COLORS.length).fill(0),
  };
}

/** 由运行时配置推出场地最小角坐标(中心对齐) */
export function fieldOrigin(center: number, size: number): number {
  return Math.floor(center - (size - 1) / 2);
}

export function cellCount(field: FieldState): number {
  return field.size * field.size;
}

/** 世界坐标 → 格索引;越界返回 undefined */
export function cellAt(
  field: FieldState,
  x: number,
  z: number,
): number | undefined {
  const ix = Math.floor(x) - field.originX;
  const iz = Math.floor(z) - field.originZ;
  if (ix < 0 || iz < 0 || ix >= field.size || iz >= field.size) {
    return undefined;
  }
  return iz * field.size + ix;
}

export function cellX(field: FieldState, cell: number): number {
  return field.originX + (cell % field.size);
}

export function cellZ(field: FieldState, cell: number): number {
  return field.originZ + Math.floor(cell / field.size);
}

/** 站在该格上的坐标(传送按方块中心自动 +0.5,故这里传整数) */
export function cellStand(field: FieldState, cell: number): {
  x: number;
  y: number;
  z: number;
} {
  return { x: cellX(field, cell), y: field.y + 1, z: cellZ(field, cell) };
}

export function centerCell(field: FieldState): number {
  const mid = Math.floor(field.size / 2);
  return mid * field.size + mid;
}

// ================= 方块外观 =================

export function territoryBlock(index: number): string {
  return PLAYER_COLORS[index]?.territory ?? NEUTRAL_BLOCK;
}

export function trailBlock(index: number): string {
  return PLAYER_COLORS[index]?.trail ?? NEUTRAL_BLOCK;
}

/** 按归属取"领土"方块(0 = 中立地面) */
export function ownerBlock(owner: number): string {
  return owner === NEUTRAL ? NEUTRAL_BLOCK : territoryBlock(owner - 1);
}

/** 按尾迹归属取方块(0 = 该格当前归属的领土方块) */
export function cellBlock(field: FieldState, cell: number): string {
  const trail = field.trailOwner[cell];
  if (trail !== NEUTRAL) return trailBlock(trail - 1);
  return ownerBlock(field.owner[cell]);
}

export function paintCell(
  dimension: Dimension,
  field: FieldState,
  cell: number,
  typeId: string,
): void {
  try {
    dimension.setBlockType(
      { x: cellX(field, cell), y: field.y, z: cellZ(field, cell) },
      typeId,
    );
  } catch (error) {
    console.warn(
      `[Bearcade territory_war] 写方块失败 cell=${cell} type=${typeId}`,
      error,
    );
  }
}

/** 按当前归属(含尾迹)重画一格 */
export function repaintCell(
  dimension: Dimension,
  field: FieldState,
  cell: number,
): void {
  paintCell(dimension, field, cell, cellBlock(field, cell));
}

/** 把整块场地刷回中立(一次 fillBlocks,重置/开局用) */
export function paintFieldNeutral(
  dimension: Dimension,
  field: FieldState,
): void {
  try {
    dimension.fillBlocks(
      new BlockVolume(
        { x: field.originX, y: field.y, z: field.originZ },
        {
          x: field.originX + field.size - 1,
          y: field.y,
          z: field.originZ + field.size - 1,
        },
      ),
      NEUTRAL_BLOCK,
      { ignoreChunkBoundErrors: true },
    );
  } catch (error) {
    console.warn("[Bearcade territory_war] 场地刷回中立失败", error);
  }
}

// ================= 归属变更 =================

export interface OwnershipResult {
  /** 本次新纳入我的格数(不含本来就属于我的) */
  captured: number;
  /** 其中从别人手里抢来的格数 */
  stolen: number;
}

/** 把一批格子划给某个颜色槽(不负责画方块) */
export function applyOwnership(
  field: FieldState,
  colorIndex: number,
  cells: readonly number[],
): OwnershipResult {
  const me = colorIndex + 1;
  let captured = 0;
  let stolen = 0;
  for (const cell of cells) {
    const prev = field.owner[cell];
    if (prev === me) continue;
    if (prev !== NEUTRAL) {
      field.counts[prev - 1] = Math.max(0, field.counts[prev - 1] - 1);
      stolen++;
    }
    field.owner[cell] = me;
    field.counts[colorIndex]++;
    captured++;
  }
  return { captured, stolen };
}

/** 清空某颜色槽的全部领土,返回被清空的格子 */
export function releaseTerritory(
  field: FieldState,
  colorIndex: number,
): number[] {
  const me = colorIndex + 1;
  const released: number[] = [];
  for (let cell = 0; cell < field.owner.length; cell++) {
    if (field.owner[cell] === me) {
      field.owner[cell] = NEUTRAL;
      released.push(cell);
    }
  }
  field.counts[colorIndex] = 0;
  return released;
}

/** 领土占比(整数百分比) */
export function territoryPercent(
  field: FieldState,
  colorIndex: number,
): number {
  const total = cellCount(field);
  if (total === 0) return 0;
  return Math.round((field.counts[colorIndex] / total) * 100);
}

/**
 * 圈地判定:返回本次应当归入 colorIndex 的格子。
 * - 被我的领土 + 我的尾迹围住、且从场地四边漫灌不到的格子 = 圈到的地;
 * - 尾迹线本身一并落定(它们同样是圈地边界);
 * - 没有围出任何封闭格时返回空数组(单格进出不给地,防止贴边反复蹭面积)。
 */
export function computeCapture(
  field: FieldState,
  colorIndex: number,
  trail: readonly number[],
): number[] {
  const me = colorIndex + 1;
  const size = field.size;
  const total = field.owner.length;
  const reachable = new Uint8Array(total);
  const stack: number[] = [];

  const blocked = (cell: number): boolean =>
    field.owner[cell] === me || field.trailOwner[cell] === me;

  const push = (cell: number): void => {
    if (reachable[cell] !== 0 || blocked(cell)) return;
    reachable[cell] = 1;
    stack.push(cell);
  };

  // 从四周边界漫灌
  for (let i = 0; i < size; i++) {
    push(i); // 北边(z = 0)
    push(total - 1 - i); // 南边
    push(i * size); // 西边
    push(i * size + size - 1); // 东边
  }
  while (stack.length > 0) {
    const cell = stack.pop() as number;
    const x = cell % size;
    const z = (cell - x) / size;
    if (x > 0) push(cell - 1);
    if (x < size - 1) push(cell + 1);
    if (z > 0) push(cell - size);
    if (z < size - 1) push(cell + size);
  }

  const enclosed: number[] = [];
  for (let cell = 0; cell < total; cell++) {
    if (!blocked(cell) && reachable[cell] === 0) enclosed.push(cell);
  }
  if (enclosed.length === 0) return [];

  for (const cell of trail) {
    if (field.owner[cell] !== me) enclosed.push(cell);
  }
  return enclosed;
}

// ================= 出生地块 =================

/** 由左上角格索引推出 plotSize×plotSize 的格子列表(自动裁到场地内) */
export function plotCells(
  field: FieldState,
  topLeft: number,
  plotSize: number,
): number[] {
  const minX = topLeft % field.size;
  const minZ = Math.floor(topLeft / field.size);
  const cells: number[] = [];
  for (let dz = 0; dz < plotSize; dz++) {
    for (let dx = 0; dx < plotSize; dx++) {
      const x = minX + dx;
      const z = minZ + dz;
      if (x < 0 || z < 0 || x >= field.size || z >= field.size) continue;
      cells.push(z * field.size + x);
    }
  }
  return cells;
}

/** 地块中心格(出生传送落点) */
export function plotCenterCell(
  field: FieldState,
  topLeft: number,
  plotSize: number,
): number {
  const minX = topLeft % field.size;
  const minZ = Math.floor(topLeft / field.size);
  const cx = Math.min(field.size - 1, minX + Math.floor(plotSize / 2));
  const cz = Math.min(field.size - 1, minZ + Math.floor(plotSize / 2));
  return cz * field.size + cx;
}

/** 把中心格夹到"容忍 plotSize 边界"的范围内 */
export function clampPlotTopLeft(
  field: FieldState,
  centerX: number,
  centerZ: number,
  plotSize: number,
): number {
  const half = Math.floor(plotSize / 2);
  const minX = Math.min(
    Math.max(0, Math.round(centerX) - half),
    Math.max(0, field.size - plotSize),
  );
  const minZ = Math.min(
    Math.max(0, Math.round(centerZ) - half),
    Math.max(0, field.size - plotSize),
  );
  return minZ * field.size + minX;
}

/** 判断某块 plotSize×plotSize 空地是否可用(全部中立且没有尾迹) */
export function isPlotFree(
  field: FieldState,
  topLeft: number,
  plotSize: number,
): boolean {
  const minX = topLeft % field.size;
  const minZ = Math.floor(topLeft / field.size);
  if (minX < 0 || minZ < 0) return false;
  if (minX + plotSize > field.size || minZ + plotSize > field.size) {
    return false;
  }
  for (let dz = 0; dz < plotSize; dz++) {
    for (let dx = 0; dx < plotSize; dx++) {
      const cell = (minZ + dz) * field.size + (minX + dx);
      if (
        field.owner[cell] !== NEUTRAL ||
        field.trailOwner[cell] !== NEUTRAL
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * 找一块空地:优先随机撒点(快),失败后退化为顺序扫描(保证能找到)。
 * 空地 = plotSize×plotSize 全部中立且没有尾迹。
 */
export function findFreePlot(
  field: FieldState,
  plotSize: number,
  rand: () => number,
): number | undefined {
  const max = field.size - plotSize;
  if (max < 0) return undefined;

  for (let attempt = 0; attempt < 120; attempt++) {
    const minX = Math.min(max, Math.floor(rand() * (max + 1)));
    const minZ = Math.min(max, Math.floor(rand() * (max + 1)));
    const topLeft = minZ * field.size + minX;
    if (isPlotFree(field, topLeft, plotSize)) return topLeft;
  }
  for (let minZ = 0; minZ <= max; minZ++) {
    for (let minX = 0; minX <= max; minX++) {
      const topLeft = minZ * field.size + minX;
      if (isPlotFree(field, topLeft, plotSize)) return topLeft;
    }
  }
  return undefined;
}
