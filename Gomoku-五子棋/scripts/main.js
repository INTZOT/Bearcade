// Gomoku-五子棋/src/main.ts
import {
  system as system2,
  world as world3,
  Player,
  CustomCommandStatus,
  CommandPermissionLevel
} from "@minecraft/server";

// Gomoku-五子棋/src/config.ts
var GAME_ID = "gomoku";
var DISPLAY_NAME = "\u4E94\u5B50\u68CB";
var PACK_ID = "cae46db7-ef95-477a-841c-5c29d38eefe5";
var IPC_CHANNEL = "bearcade:ipc";
var ROOM_COUNT = 8;
var MAX_PLAYERS = 2;
var TEMPLATE_FROM = { x: -6, y: -64, z: -6 };
var TEMPLATE_TO = { x: 6, y: 319, z: 6 };
var ROOM_COPY_ORIGIN = { x: -6, y: -64, z: -6 };
var PREP_SPAWN = { x: 0, y: 0, z: 0 };
var TICKING_FROM = { x: -6, y: -1, z: -6 };
var TICKING_TO = { x: 6, y: 65, z: 6 };
var STRUCTURE_ID = "bearcade:gomoku_room";
var DIMENSION_NAMESPACE = "bearcade";
var TEMPLATE_DIMENSION_ID = `${DIMENSION_NAMESPACE}:${GAME_ID}_template`;
var TEMPLATE_SPAWN = { x: 0, y: 100, z: 0 };
function roomDimensionId(roomId) {
  return `${DIMENSION_NAMESPACE}:${GAME_ID}_${roomId}`;
}
function tickingAreaId(roomId) {
  return `bearcade:ta_${GAME_ID}_${roomId}`;
}

// Gomoku-五子棋/src/rooms.ts
import { world } from "@minecraft/server";
var roomReady = /* @__PURE__ */ new Map();
function isRoomReady(roomId) {
  return roomReady.get(roomId) === true;
}
async function ensureTemplateStructure() {
  const templateDim = world.getDimension(TEMPLATE_DIMENSION_ID);
  const templateAreaId = tickingAreaId("template");
  if (!world.tickingAreaManager.hasTickingArea(templateAreaId)) {
    await world.tickingAreaManager.createTickingArea(templateAreaId, {
      dimension: templateDim,
      from: TICKING_FROM,
      to: TICKING_TO
    });
  }
  let structure = world.structureManager.get(STRUCTURE_ID);
  if (!structure) {
    structure = world.structureManager.createFromWorld(
      STRUCTURE_ID,
      templateDim,
      TEMPLATE_FROM,
      TEMPLATE_TO
    );
    console.warn(`[Bearcade Gomoku] \u5DF2\u6355\u83B7\u6A21\u677F\u7ED3\u6784 ${STRUCTURE_ID}`);
  }
  return structure;
}
async function initRoom(roomId, structureId) {
  const dim = world.getDimension(roomDimensionId(roomId));
  const areaId = tickingAreaId(roomId);
  if (world.tickingAreaManager.hasTickingArea(areaId)) {
    world.tickingAreaManager.removeTickingArea(areaId);
  }
  await world.tickingAreaManager.createTickingArea(areaId, {
    dimension: dim,
    from: TICKING_FROM,
    to: TICKING_TO
  });
  world.structureManager.place(structureId, dim, ROOM_COPY_ORIGIN);
  roomReady.set(roomId, true);
  console.warn(`[Bearcade Gomoku] \u623F\u95F4 ${roomId} \u573A\u5730\u5C31\u7EEA`);
}
async function initRooms() {
  console.warn(
    `[Bearcade Gomoku] tickingAreaManager chunk \u4E0A\u9650:${world.tickingAreaManager.maxChunkCount}`
  );
  try {
    const structure = await ensureTemplateStructure();
    for (let roomId = 1; roomId <= ROOM_COUNT; roomId++) {
      try {
        await initRoom(roomId, structure.id);
      } catch (error) {
        roomReady.set(roomId, false);
        console.warn(`[Bearcade Gomoku] \u623F\u95F4 ${roomId} \u521D\u59CB\u5316\u5931\u8D25`, error);
      }
    }
  } catch (error) {
    console.warn("[Bearcade Gomoku] \u6A21\u677F\u7ED3\u6784\u6355\u83B7\u5931\u8D25", error);
  }
}

// Gomoku-五子棋/src/ipc.ts
import { system, world as world2 } from "@minecraft/server";
function send(op, payload) {
  system.sendScriptEvent(
    IPC_CHANNEL,
    JSON.stringify({ op, packId: PACK_ID, payload })
  );
}
function sendGameRegister() {
  send("game.register", {
    game: GAME_ID,
    displayName: DISPLAY_NAME,
    roomCount: ROOM_COUNT,
    maxPlayers: MAX_PLAYERS,
    prepSpawn: PREP_SPAWN
  });
  console.warn("[Bearcade Gomoku] \u5DF2\u5411 Core \u6CE8\u518C\u6E38\u620F\u4FE1\u606F");
}
function sendRoomStatus() {
  const rooms = [];
  for (let roomId = 1; roomId <= ROOM_COUNT; roomId++) {
    const dim = world2.getDimension(roomDimensionId(roomId));
    rooms.push({
      id: roomId,
      players: dim.getPlayers().length,
      status: isRoomReady(roomId) ? "idle" : "initializing"
    });
  }
  send("room.status", { game: GAME_ID, rooms });
}

// Gomoku-五子棋/src/main.ts
system2.beforeEvents.startup.subscribe((event) => {
  for (let roomId = 1; roomId <= ROOM_COUNT; roomId++) {
    event.dimensionRegistry.registerCustomDimension(roomDimensionId(roomId));
  }
  event.dimensionRegistry.registerCustomDimension(TEMPLATE_DIMENSION_ID);
  event.customCommandRegistry.registerCommand(
    {
      name: "bearcade:gomoku",
      description: "\u5F00\u53D1\u7528:\u8FDB\u5165\u4E94\u5B50\u68CB\u6A21\u677F\u7EF4\u5EA6\u5236\u4F5C\u573A\u5730",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false
    },
    (origin) => {
      const player = origin.sourceEntity;
      if (!player || !(player instanceof Player)) {
        return {
          status: CustomCommandStatus.Failure,
          message: "\u8BE5\u547D\u4EE4\u53EA\u80FD\u7531\u73A9\u5BB6\u6267\u884C"
        };
      }
      system2.run(() => {
        const dimension = world3.getDimension(TEMPLATE_DIMENSION_ID);
        player.teleport(TEMPLATE_SPAWN, { dimension });
      });
      return {
        status: CustomCommandStatus.Success,
        message: `\u5DF2\u4F20\u9001\u81F3\u6A21\u677F\u7EF4\u5EA6 ${TEMPLATE_DIMENSION_ID}`
      };
    }
  );
  console.warn(
    `[Bearcade Gomoku] \u5DF2\u6CE8\u518C ${GAME_ID} \u623F\u95F4\u7EF4\u5EA6 1~${ROOM_COUNT} \u4E0E\u6A21\u677F\u7EF4\u5EA6`
  );
});
world3.afterEvents.worldLoad.subscribe(() => {
  sendGameRegister();
  void initRooms();
  system2.runInterval(() => sendRoomStatus(), 100);
});
//# sourceMappingURL=main.js.map
