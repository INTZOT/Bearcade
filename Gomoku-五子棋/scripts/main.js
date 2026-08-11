// Gomoku-五子棋/src/main.ts
import {
  system as system3,
  world as world4,
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
var LOBBY_DIMENSION_ID = "minecraft:overworld";
var TEMPLATE_FROM = { x: -7, y: -64, z: -7 };
var TEMPLATE_TO = { x: 7, y: 319, z: 7 };
var ROOM_COPY_ORIGIN = { x: -7, y: -64, z: -7 };
var PREP_SPAWN = { x: 0, y: 0, z: 0 };
var TICKING_FROM = { x: -7, y: -1, z: -7 };
var TICKING_TO = { x: 7, y: 65, z: 7 };
var STRUCTURE_ID = "bearcade:gomoku_room";
var BOARD_Y = 64;
var GRID_MIN = -7;
var GRID_MAX = 7;
var STONE_BLACK = "minecraft:polished_blackstone_pressure_plate";
var STONE_WHITE = "minecraft:heavy_weighted_pressure_plate";
var START_POS_BLACK = { x: 0, y: 66, z: -1 };
var START_POS_WHITE = { x: 0, y: 66, z: 1 };
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
      console.warn("[Bearcade Gomoku] \u6A21\u677F\u7ED3\u6784\u5C3A\u5BF8\u53D8\u5316,\u91CD\u65B0\u6355\u83B7");
    }
  }
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
import { system as system2, world as world3 } from "@minecraft/server";

// Gomoku-五子棋/src/game.ts
import { system, world as world2 } from "@minecraft/server";
var GRID_SIZE = GRID_MAX - GRID_MIN + 1;
var ROOM_DIM_PATTERN = new RegExp(`^bearcade:${GAME_ID}_(\\d+)$`);
var START_DELAY_TICKS = 40;
var END_DELAY_TICKS = 60;
var states = /* @__PURE__ */ new Map();
function emptyBoard() {
  return Array.from(
    { length: GRID_SIZE },
    () => Array(GRID_SIZE).fill(null)
  );
}
function getState(roomId) {
  let state = states.get(roomId);
  if (!state) {
    state = {
      phase: "idle",
      board: emptyBoard(),
      turn: "black",
      players: {}
    };
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
function inGrid(x, z) {
  return x >= GRID_MIN && x <= GRID_MAX && z >= GRID_MIN && z <= GRID_MAX;
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
  state.pendingRunId = system.runTimeout(() => startGame(roomId), START_DELAY_TICKS);
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
  state.board = emptyBoard();
  state.turn = "black";
  state.players = { black: players[0].id, white: players[1].id };
  players[0].teleport(START_POS_BLACK, { dimension: roomDim(roomId) });
  players[1].teleport(START_POS_WHITE, { dimension: roomDim(roomId) });
  announce(roomId, "\xA7a\u5BF9\u5C40\u5F00\u59CB!\u9ED1\u65B9\u5148\u624B,\u53F3\u952E\u68CB\u76D8\u683C\u843D\u5B50");
  sendRoomStatus();
}
function checkWin(board, cx, cz, color) {
  const directions = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1]
  ];
  for (const [dx, dz] of directions) {
    let count = 1;
    for (const sign of [-1, 1]) {
      let nx = cx + dx * sign;
      let nz = cz + dz * sign;
      while (nx >= 0 && nx < GRID_SIZE && nz >= 0 && nz < GRID_SIZE && board[nx][nz] === color) {
        count++;
        nx += dx * sign;
        nz += dz * sign;
      }
    }
    if (count >= 5) return true;
  }
  return false;
}
function isBoardFull(board) {
  return board.every((row) => row.every((cell) => cell !== null));
}
function handleInteract(player, block) {
  const roomId = roomIdFromDimension(block.dimension.id);
  if (!roomId) return;
  const state = getState(roomId);
  if (state.phase !== "running") return;
  const { x, y, z } = block.location;
  if (y !== BOARD_Y || !inGrid(x, z)) return;
  const cx = x - GRID_MIN;
  const cz = z - GRID_MIN;
  if (state.board[cx][cz]) return;
  if (state.players[state.turn] !== player.id) {
    player.sendMessage("\xA7c\u8FD8\u6CA1\u8F6E\u5230\u4F60\u843D\u5B50");
    return;
  }
  const color = state.turn;
  const target = block.dimension.getBlock({
    x: block.location.x,
    y: block.location.y + 1,
    z: block.location.z
  });
  target?.setType(color === "black" ? STONE_BLACK : STONE_WHITE);
  state.board[cx][cz] = color;
  player.sendMessage(
    `\xA77\u843D\u5B50:${color === "black" ? "\u9ED1" : "\u767D"} (${x}, ${z})`
  );
  if (checkWin(state.board, cx, cz, color)) {
    const winnerText = color === "black" ? "\u9ED1\u65B9" : "\u767D\u65B9";
    announce(roomId, `\xA7e${winnerText}\u4E94\u8FDE,\u5BF9\u5C40\u7ED3\u675F`);
    endGame(roomId, color);
    return;
  }
  if (isBoardFull(state.board)) {
    announce(roomId, "\xA7e\u68CB\u76D8\u5DF2\u6EE1,\u5E73\u5C40");
    endGame(roomId, "draw");
    return;
  }
  state.turn = state.turn === "black" ? "white" : "black";
  announce(
    roomId,
    `\u8F6E\u5230${state.turn === "black" ? "\u9ED1\u65B9" : "\u767D\u65B9"}\u843D\u5B50`
  );
}
function endGame(roomId, result) {
  const state = getState(roomId);
  if (state.phase === "resetting") return;
  cancelPending(state);
  state.phase = "resetting";
  const resultText = result === "draw" ? "\u5E73\u5C40" : result === "black" ? "\u9ED1\u65B9\u83B7\u80DC" : "\u767D\u65B9\u83B7\u80DC";
  announce(roomId, `\xA7e${resultText},\u5373\u5C06\u8FD4\u56DE\u5927\u5385\u2026`);
  system.runTimeout(() => finishReset(roomId), END_DELAY_TICKS);
}
function finishReset(roomId) {
  const dim = roomDim(roomId);
  const lobbyDim = world2.getDimension(LOBBY_DIMENSION_ID);
  const spawn = world2.getDefaultSpawnLocation();
  for (const player of roomPlayers(roomId)) {
    try {
      player.teleport(spawn, { dimension: lobbyDim });
    } catch (error) {
      console.warn(
        `[Bearcade Gomoku] \u623F\u95F4 ${roomId} \u73A9\u5BB6\u56DE\u5927\u5385\u5931\u8D25`,
        error
      );
    }
  }
  try {
    world2.structureManager.place(STRUCTURE_ID, dim, ROOM_COPY_ORIGIN);
  } catch (error) {
    console.warn(`[Bearcade Gomoku] \u623F\u95F4 ${roomId} \u573A\u5730\u91CD\u7F6E\u5931\u8D25`, error);
  }
  states.set(roomId, {
    phase: "idle",
    board: emptyBoard(),
    turn: "black",
    players: {}
  });
  console.warn(`[Bearcade Gomoku] \u623F\u95F4 ${roomId} \u5DF2\u91CD\u7F6E`);
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
      if (players.length === 1) {
        const winner = state.players.black === players[0].id ? "black" : "white";
        announce(
          roomId,
          `\xA7e\u5BF9\u65B9\u79BB\u5F00,${winner === "black" ? "\u9ED1\u65B9" : "\u767D\u65B9"}\u83B7\u80DC`
        );
        endGame(roomId, winner);
      } else {
        endGame(roomId, "draw");
      }
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
function initGame() {
  world2.afterEvents.playerInteractWithBlock.subscribe((event) => {
    handleInteract(event.player, event.block);
  });
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

// Gomoku-五子棋/src/ipc.ts
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
  console.warn("[Bearcade Gomoku] \u5DF2\u5411 Core \u6CE8\u518C\u6E38\u620F\u4FE1\u606F");
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

// Gomoku-五子棋/src/main.ts
system3.beforeEvents.startup.subscribe((event) => {
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
  console.warn(
    `[Bearcade Gomoku] \u5DF2\u6CE8\u518C ${GAME_ID} \u623F\u95F4\u7EF4\u5EA6 1~${ROOM_COUNT} \u4E0E\u6A21\u677F\u7EF4\u5EA6`
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
