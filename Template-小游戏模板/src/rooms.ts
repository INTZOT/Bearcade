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

  // 先保证模板维度常加载,再捕获结构
  const templateAreaId = tickingAreaId("template");
  if (!world.tickingAreaManager.hasTickingArea(templateAreaId)) {
    await world.tickingAreaManager.createTickingArea(templateAreaId, {
      dimension: templateDim,
      from: TICKING_FROM,
      to: TICKING_TO,
    });
  }

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
      world.structureManager.delete(STRUCTURE_ID);
      structure = undefined;
      console.warn("[Bearcade Template] 模板结构尺寸变化,重新捕获");
    }
  }
  if (!structure) {
    structure = world.structureManager.createFromWorld(
      STRUCTURE_ID,
      templateDim,
      TEMPLATE_FROM,
      TEMPLATE_TO,
    );
    console.warn(`[Bearcade Template] 已捕获模板结构 ${STRUCTURE_ID}`);
  }
  return structure;
}

async function initRoom(roomId: number, structureId: string): Promise<void> {
  const dim = world.getDimension(roomDimensionId(roomId));
  const areaId = tickingAreaId(roomId);

  if (world.tickingAreaManager.hasTickingArea(areaId)) {
    world.tickingAreaManager.removeTickingArea(areaId);
  }

  await world.tickingAreaManager.createTickingArea(areaId, {
    dimension: dim,
    from: TICKING_FROM,
    to: TICKING_TO,
  });
  world.structureManager.place(structureId, dim, ROOM_COPY_ORIGIN);

  roomReady.set(roomId, true);
  console.warn(`[Bearcade Template] 房间 ${roomId} 场地就绪`);
}

export async function initRooms(): Promise<void> {
  try {
    const structure = await ensureTemplateStructure();
    for (let roomId = 1; roomId <= ROOM_COUNT; roomId++) {
      try {
        await initRoom(roomId, structure.id);
      } catch (error) {
        roomReady.set(roomId, false);
        console.warn(`[Bearcade Template] 房间 ${roomId} 初始化失败`, error);
      }
    }
  } catch (error) {
    console.warn("[Bearcade Template] 模板结构捕获失败", error);
  }
}

/**
 * 从模板维度重新捕获场地并复制到指定房间(每次重置都走这条路径)。
 */
export async function resetRoomsFromTemplate(
  roomIds: number[],
): Promise<void> {
  if (world.structureManager.get(STRUCTURE_ID)) {
    world.structureManager.delete(STRUCTURE_ID);
  }

  const templateDim = world.getDimension(TEMPLATE_DIMENSION_ID);
  const structure = world.structureManager.createFromWorld(
    STRUCTURE_ID,
    templateDim,
    TEMPLATE_FROM,
    TEMPLATE_TO,
  );

  for (const roomId of roomIds) {
    const dim = world.getDimension(roomDimensionId(roomId));
    world.structureManager.place(structure.id, dim, ROOM_COPY_ORIGIN);
  }
}
