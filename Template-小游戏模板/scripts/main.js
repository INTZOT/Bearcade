// Template-小游戏模板/src/main.ts
import {
  system as system3,
  world as world4,
  Player,
  CustomCommandStatus,
  CommandPermissionLevel
} from "@minecraft/server";

// Template-小游戏模板/src/config.ts
var GAME_ID = "mygame";
var DISPLAY_NAME = "\u6211\u7684\u5C0F\u6E38\u620F";
var PACK_ID = "95076440-41a8-49f8-9aeb-f57f4edd0db5";
var IPC_CHANNEL = "bearcade:ipc";
var LOBBY_DIMENSION_ID = "minecraft:overworld";
var ROOM_COUNT = 2;
var MAX_PLAYERS = 2;
var TEMPLATE_FROM = { x: -7, y: -64, z: -7 };
var TEMPLATE_TO = { x: 7, y: 319, z: 7 };
var ROOM_COPY_ORIGIN = { x: -7, y: -64, z: -7 };
var PREP_SPAWN = { x: 0, y: 0, z: 0 };
var TICKING_FROM = { x: -7, y: -1, z: -7 };
var TICKING_TO = { x: 7, y: 65, z: 7 };
var STRUCTURE_ID = "bearcade:mygame_room";
var TEMPLATE_SPAWN = { x: 0, y: 100, z: 0 };
var START_POSITIONS = [
  { x: 0, y: 65, z: -1 },
  { x: 0, y: 65, z: 1 }
];
var DIMENSION_NAMESPACE = "bearcade";
var TEMPLATE_DIMENSION_ID = `${DIMENSION_NAMESPACE}:${GAME_ID}_template`;
function roomDimensionId(roomId) {
  return `${DIMENSION_NAMESPACE}:${GAME_ID}_${roomId}`;
}
function tickingAreaId(roomId) {
  return `bearcade:ta_${GAME_ID}_${roomId}`;
}

// Template-小游戏模板/src/rooms.ts
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
  if (structure) {
    const expectedSize = {
      x: TEMPLATE_TO.x - TEMPLATE_FROM.x + 1,
      y: TEMPLATE_TO.y - TEMPLATE_FROM.y + 1,
      z: TEMPLATE_TO.z - TEMPLATE_FROM.z + 1
    };
    const size = structure.size;
    if (size.x !== expectedSize.x || size.y !== expectedSize.y || size.z !== expectedSize.z) {
      world.structureManager.delete(STRUCTURE_ID);
      structure = void 0;
      console.warn("[Bearcade Template] \u6A21\u677F\u7ED3\u6784\u5C3A\u5BF8\u53D8\u5316,\u91CD\u65B0\u6355\u83B7");
    }
  }
  if (!structure) {
    structure = world.structureManager.createFromWorld(
      STRUCTURE_ID,
      templateDim,
      TEMPLATE_FROM,
      TEMPLATE_TO
    );
    console.warn(`[Bearcade Template] \u5DF2\u6355\u83B7\u6A21\u677F\u7ED3\u6784 ${STRUCTURE_ID}`);
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
  console.warn(`[Bearcade Template] \u623F\u95F4 ${roomId} \u573A\u5730\u5C31\u7EEA`);
}
async function initRooms() {
  try {
    const structure = await ensureTemplateStructure();
    for (let roomId = 1; roomId <= ROOM_COUNT; roomId++) {
      try {
        await initRoom(roomId, structure.id);
      } catch (error) {
        roomReady.set(roomId, false);
        console.warn(`[Bearcade Template] \u623F\u95F4 ${roomId} \u521D\u59CB\u5316\u5931\u8D25`, error);
      }
    }
  } catch (error) {
    console.warn("[Bearcade Template] \u6A21\u677F\u7ED3\u6784\u6355\u83B7\u5931\u8D25", error);
  }
}
async function resetRoomsFromTemplate(roomIds) {
  if (world.structureManager.get(STRUCTURE_ID)) {
    world.structureManager.delete(STRUCTURE_ID);
  }
  const templateDim = world.getDimension(TEMPLATE_DIMENSION_ID);
  const structure = world.structureManager.createFromWorld(
    STRUCTURE_ID,
    templateDim,
    TEMPLATE_FROM,
    TEMPLATE_TO
  );
  for (const roomId of roomIds) {
    const dim = world.getDimension(roomDimensionId(roomId));
    world.structureManager.place(structure.id, dim, ROOM_COPY_ORIGIN);
  }
}

// Template-小游戏模板/src/ipc.ts
import { system as system2, world as world3 } from "@minecraft/server";

// Template-小游戏模板/src/game.ts
import { system, world as world2 } from "@minecraft/server";
var ROOM_DIM_PATTERN = new RegExp(`^bearcade:${GAME_ID}_(\\d+)$`);
var START_DELAY_TICKS = 40;
var END_DELAY_TICKS = 60;
var states = /* @__PURE__ */ new Map();
function getState(roomId) {
  let state = states.get(roomId);
  if (!state) {
    state = { phase: "idle", players: [] };
    states.set(roomId, state);
  }
  return state;
}
function roomDim(roomId) {
  return world2.getDimension(roomDimensionId(roomId));
}
function roomPlayers(roomId) {
  return roomDim(roomId).getPlayers();
}
function roomIdFromDimension(dimensionId) {
  const match = ROOM_DIM_PATTERN.exec(dimensionId);
  return match ? Number(match[1]) : void 0;
}
function announce(roomId, message) {
  for (const player of roomPlayers(roomId)) {
    player.sendMessage(message);
  }
}
function cancelPending(state) {
  if (state.pendingRunId !== void 0) {
    system.clearRun(state.pendingRunId);
    state.pendingRunId = void 0;
  }
}
function startPending(roomId) {
  const state = getState(roomId);
  if (state.phase !== "idle") return;
  state.phase = "pending";
  state.pendingRunId = system.runTimeout(
    () => startGame(roomId),
    START_DELAY_TICKS
  );
  announce(roomId, "\xA7e\u4E24\u540D\u73A9\u5BB6\u5DF2\u5C31\u4F4D,\u5BF9\u5C40\u5373\u5C06\u5F00\u59CB\u2026");
}
function startGame(roomId) {
  const state = getState(roomId);
  if (state.phase !== "pending") return;
  const players = roomPlayers(roomId);
  if (players.length < 2) {
    state.phase = "idle";
    return;
  }
  state.phase = "running";
  state.players = players.map((p) => p.id);
  players.forEach((player, index) => {
    const pos = START_POSITIONS[index] ?? START_POSITIONS[0];
    player.teleport(pos, { dimension: roomDim(roomId) });
  });
  announce(roomId, "\xA7a\u5BF9\u5C40\u5F00\u59CB!\u5728\u8FD9\u91CC\u5B9E\u73B0\u4F60\u7684\u73A9\u6CD5");
  sendRoomStatus();
}
function endGame(roomId, reason) {
  const state = getState(roomId);
  if (state.phase === "resetting") return;
  cancelPending(state);
  state.phase = "resetting";
  announce(roomId, `\xA7e\u5BF9\u5C40\u7ED3\u675F(${reason}),\u5373\u5C06\u8FD4\u56DE\u5927\u5385\u2026`);
  system.runTimeout(() => {
    void finishReset(roomId);
  }, END_DELAY_TICKS);
}
async function finishReset(roomId) {
  const lobbyDim = world2.getDimension(LOBBY_DIMENSION_ID);
  const spawn = world2.getDefaultSpawnLocation();
  for (const player of roomPlayers(roomId)) {
    try {
      player.teleport(spawn, { dimension: lobbyDim });
    } catch (error) {
      console.warn(`[Bearcade Template] \u623F\u95F4 ${roomId} \u73A9\u5BB6\u56DE\u5927\u5385\u5931\u8D25`, error);
    }
  }
  try {
    await resetRoomsFromTemplate([roomId]);
  } catch (error) {
    console.warn(`[Bearcade Template] \u623F\u95F4 ${roomId} \u573A\u5730\u91CD\u7F6E\u5931\u8D25`, error);
  }
  states.set(roomId, { phase: "idle", players: [] });
  sendRoomStatus();
}
function tickGames() {
  for (let roomId = 1; roomId <= ROOM_COUNT; roomId++) {
    if (!isRoomReady(roomId)) continue;
    const state = getState(roomId);
    const players = roomPlayers(roomId);
    if (state.phase === "idle" && players.length >= 2) {
      startPending(roomId);
    } else if (state.phase === "pending" && players.length < 2) {
      cancelPending(state);
      state.phase = "idle";
      announce(roomId, "\xA77\u7B49\u5F85\u73A9\u5BB6\u5C31\u4F4D\u2026");
    } else if (state.phase === "running" && players.length < 2) {
      endGame(roomId, "\u73A9\u5BB6\u79BB\u5F00");
    }
  }
}
function getReportStatus(roomId) {
  if (!isRoomReady(roomId)) return "initializing";
  const phase = getState(roomId).phase;
  if (phase === "running" || phase === "pending") return "running";
  if (phase === "resetting") return "initializing";
  return "idle";
}
function forceStopInDimension(dimensionId) {
  const roomId = roomIdFromDimension(dimensionId);
  if (!roomId) return false;
  const state = getState(roomId);
  if (state.phase !== "running" && state.phase !== "pending") return false;
  system.run(() => endGame(roomId, "\u5F3A\u5236\u4E2D\u65AD"));
  return true;
}
function initGame() {
  world2.beforeEvents.playerBreakBlock.subscribe((event) => {
    if (roomIdFromDimension(event.block.dimension.id)) {
      event.cancel = true;
    }
  });
  world2.beforeEvents.playerPlaceBlock.subscribe((event) => {
    if (roomIdFromDimension(event.block.dimension.id)) {
      event.cancel = true;
    }
  });
}

// Template-小游戏模板/src/ipc.ts
function send(op, payload) {
  system2.sendScriptEvent(
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
  console.warn("[Bearcade Template] \u5DF2\u5411 Core \u6CE8\u518C\u6E38\u620F\u4FE1\u606F");
}
function sendRoomStatus() {
  const rooms = [];
  for (let roomId = 1; roomId <= ROOM_COUNT; roomId++) {
    const dim = world3.getDimension(roomDimensionId(roomId));
    rooms.push({
      id: roomId,
      players: dim.getPlayers().length,
      status: getReportStatus(roomId)
    });
  }
  send("room.status", { game: GAME_ID, rooms });
}

// Template-小游戏模板/src/main.ts
system3.beforeEvents.startup.subscribe((event) => {
  for (let roomId = 1; roomId <= ROOM_COUNT; roomId++) {
    event.dimensionRegistry.registerCustomDimension(roomDimensionId(roomId));
  }
  event.dimensionRegistry.registerCustomDimension(TEMPLATE_DIMENSION_ID);
  event.customCommandRegistry.registerCommand(
    {
      name: `bearcade:${GAME_ID}`,
      description: "\u5F00\u53D1\u7528:\u8FDB\u5165\u6A21\u677F\u7EF4\u5EA6\u5236\u4F5C\u573A\u5730",
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
      system3.run(() => {
        const dimension = world4.getDimension(TEMPLATE_DIMENSION_ID);
        player.teleport(TEMPLATE_SPAWN, { dimension });
      });
      return {
        status: CustomCommandStatus.Success,
        message: `\u5DF2\u4F20\u9001\u81F3\u6A21\u677F\u7EF4\u5EA6 ${TEMPLATE_DIMENSION_ID}`
      };
    }
  );
  event.customCommandRegistry.registerCommand(
    {
      name: `bearcade:${GAME_ID}_stop`,
      description: "\u5F3A\u5236\u4E2D\u65AD\u5F53\u524D\u7EF4\u5EA6\u8FD0\u884C\u4E2D\u7684\u5BF9\u5C40",
      permissionLevel: CommandPermissionLevel.Admin,
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
      if (!forceStopInDimension(player.dimension.id)) {
        return {
          status: CustomCommandStatus.Failure,
          message: "\u5F53\u524D\u7EF4\u5EA6\u6CA1\u6709\u8FD0\u884C\u4E2D\u7684\u5BF9\u5C40"
        };
      }
      return {
        status: CustomCommandStatus.Success,
        message: "\u5DF2\u5F3A\u5236\u4E2D\u65AD\u5F53\u524D\u5BF9\u5C40"
      };
    }
  );
  console.warn(
    `[Bearcade Template] \u5DF2\u6CE8\u518C ${GAME_ID} \u623F\u95F4\u7EF4\u5EA6 1~${ROOM_COUNT} \u4E0E\u6A21\u677F\u7EF4\u5EA6`
  );
});
world4.afterEvents.worldLoad.subscribe(() => {
  sendGameRegister();
  void initRooms();
  initGame();
  system3.runInterval(() => tickGames(), 10);
  system3.runInterval(() => sendRoomStatus(), 100);
});
//# sourceMappingURL=main.js.map
