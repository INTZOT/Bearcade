import { world } from "@minecraft/server";
import {
  ROOM_COUNT,
  ROOM_COPY_ORIGIN,
  STRUCTURE_ID,
  TEMPLATE_DIMENSION_ID,
  TEMPLATE_FROM,
  TEMPLATE_TO,
  TICKING_FROM,
  TICKING_TO,
  roomDimensionId,
  tickingAreaId,
} from "./config";

const roomReady = new Map<number, boolean>();

export function isRoomReady(roomId: number): boolean {
  return roomReady.get(roomId) === true;
}

async function ensureTemplateStructure() {
  const templateDim = world.getDimension(TEMPLATE_DIMENSION_ID);

  // 先保证模板维度常加载,再捕获结构,避免读到未加载区块
  const templateAreaId = tickingAreaId("template");
  if (!world.tickingAreaManager.hasTickingArea(templateAreaId)) {
    await world.tickingAreaManager.createTickingArea(templateAreaId, {
      dimension: templateDim,
      from: TICKING_FROM,
      to: TICKING_TO,
    });
  }

  // 结构保存于世界:已存在则复用,不存在才从模板捕获
  let structure = world.structureManager.get(STRUCTURE_ID);
  if (structure) {
    const expectedSize = {
      x: TEMPLATE_TO.x - TEMPLATE_FROM.x + 1,
      y: TEMPLATE_TO.y - TEMPLATE_FROM.y + 1,
      z: TEMPLATE_TO.z - TEMPLATE_FROM.z + 1,
    };
    const size = structure.size;
    if (
      size.x !== expectedSize.x ||
      size.y !== expectedSize.y ||
      size.z !== expectedSize.z
    ) {
      // 模板范围变化(如 ±6 → ±7),删除旧结构重新捕获
      world.structureManager.delete(STRUCTURE_ID);
      structure = undefined;
      console.warn("[Bearcade Gomoku] 模板结构尺寸变化,重新捕获");
    }
  }
  if (!structure) {
    structure = world.structureManager.createFromWorld(
      STRUCTURE_ID,
      templateDim,
      TEMPLATE_FROM,
      TEMPLATE_TO,
    );
    console.warn(`[Bearcade Gomoku] 已捕获模板结构 ${STRUCTURE_ID}`);
  }
  return structure;
}

async function initRoom(roomId: number, structureId: string): Promise<void> {
  const dim = world.getDimension(roomDimensionId(roomId));
  const areaId = tickingAreaId(roomId);

  if (world.tickingAreaManager.hasTickingArea(areaId)) {
    world.tickingAreaManager.removeTickingArea(areaId);
  }

  // 先加载目标区块,再放置结构
  await world.tickingAreaManager.createTickingArea(areaId, {
    dimension: dim,
    from: TICKING_FROM,
    to: TICKING_TO,
  });
  world.structureManager.place(structureId, dim, ROOM_COPY_ORIGIN);

  roomReady.set(roomId, true);
  console.warn(`[Bearcade Gomoku] 房间 ${roomId} 场地就绪`);
}

export async function initRooms(): Promise<void> {
  console.warn(
    `[Bearcade Gomoku] tickingAreaManager chunk 上限:${world.tickingAreaManager.maxChunkCount}`,
  );
  try {
    const structure = await ensureTemplateStructure();
    for (let roomId = 1; roomId <= ROOM_COUNT; roomId++) {
      try {
        await initRoom(roomId, structure.id);
      } catch (error) {
        roomReady.set(roomId, false);
        console.warn(`[Bearcade Gomoku] 房间 ${roomId} 初始化失败`, error);
      }
    }
  } catch (error) {
    console.warn("[Bearcade Gomoku] 模板结构捕获失败", error);
  }
}
