// Gomoku-五子棋/src/main.ts
import { system as system3, world as world2 } from "@minecraft/server";

// shared/minigame-core/runtime.ts
import {
  system,
  world,
  Player,
  CustomCommandStatus,
  CommandPermissionLevel
} from "@minecraft/server";
var MinigameRuntime = class {
  constructor(config, hooks = {}) {
    this.states = /* @__PURE__ */ new Map();
    this.ready = /* @__PURE__ */ new Map();
    this.started = false;
    this.config = config;
    this.hooks = hooks;
    this.roomPattern = new RegExp(`^bearcade:${config.gameId}_(\\d+)$`);
  }
  log(message, error) {
    console.warn(`[Bearcade ${this.config.gameId}] ${message}`, error ?? "");
  }
  // ================= 维度与命令 =================
  initStartup(event) {
    for (let roomId = 1; roomId <= this.config.roomCount; roomId++) {
      event.dimensionRegistry.registerCustomDimension(
        this.roomDimensionId(roomId)
      );
    }
    event.dimensionRegistry.registerCustomDimension(
      this.templateDimensionId()
    );
    event.customCommandRegistry.registerCommand(
      {
        name: `bearcade:${this.config.gameId}`,
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
        system.run(() => {
          const dimension = world.getDimension(this.templateDimensionId());
          player.teleport(this.config.templateSpawn, { dimension });
        });
        return {
          status: CustomCommandStatus.Success,
          message: `\u5DF2\u4F20\u9001\u81F3\u6A21\u677F\u7EF4\u5EA6 ${this.templateDimensionId()}`
        };
      }
    );
    event.customCommandRegistry.registerCommand(
      {
        name: `bearcade:${this.config.gameId}_stop`,
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
        if (!this.forceStopInDimension(player.dimension.id)) {
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
    this.log(
      `\u5DF2\u6CE8\u518C ${this.config.roomCount} \u4E2A\u623F\u95F4\u7EF4\u5EA6\u4E0E\u6A21\u677F\u7EF4\u5EA6`
    );
  }
  // ================= 维度与房间工具 =================
  roomDimensionId(roomId) {
    return `bearcade:${this.config.gameId}_${roomId}`;
  }
  templateDimensionId() {
    return `bearcade:${this.config.gameId}_template`;
  }
  roomIdFromDimension(dimensionId) {
    const match = this.roomPattern.exec(dimensionId);
    return match ? Number(match[1]) : void 0;
  }
  roomDim(roomId) {
    return world.getDimension(this.roomDimensionId(roomId));
  }
  roomPlayers(roomId) {
    return this.roomDim(roomId).getPlayers();
  }
  announce(roomId, message) {
    for (const player of this.roomPlayers(roomId)) {
      player.sendMessage(message);
    }
  }
  teleportPlayer(roomId, player, location) {
    player.teleport(location, { dimension: this.roomDim(roomId) });
  }
  getPhase(roomId) {
    return this.getState(roomId).phase;
  }
  isRunning(roomId) {
    return this.getState(roomId).phase === "running";
  }
  // ================= 房间初始化与重置 =================
  getState(roomId) {
    let state = this.states.get(roomId);
    if (!state) {
      state = { phase: "idle", players: [] };
      this.states.set(roomId, state);
    }
    return state;
  }
  isRoomReady(roomId) {
    return this.ready.get(roomId) === true;
  }
  async ensureTemplateStructure() {
    const templateDim = world.getDimension(this.templateDimensionId());
    const templateAreaId = this.tickingAreaId("template");
    if (!world.tickingAreaManager.hasTickingArea(templateAreaId)) {
      await world.tickingAreaManager.createTickingArea(templateAreaId, {
        dimension: templateDim,
        from: this.config.tickingFrom,
        to: this.config.tickingTo
      });
    }
    let structure = world.structureManager.get(this.config.structureId);
    if (structure) {
      const expectedSize = {
        x: this.config.templateTo.x - this.config.templateFrom.x + 1,
        y: this.config.templateTo.y - this.config.templateFrom.y + 1,
        z: this.config.templateTo.z - this.config.templateFrom.z + 1
      };
      const size = structure.size;
      if (size.x !== expectedSize.x || size.y !== expectedSize.y || size.z !== expectedSize.z) {
        world.structureManager.delete(this.config.structureId);
        structure = void 0;
        this.log("\u6A21\u677F\u7ED3\u6784\u5C3A\u5BF8\u53D8\u5316,\u91CD\u65B0\u6355\u83B7");
      }
    }
    if (!structure) {
      structure = world.structureManager.createFromWorld(
        this.config.structureId,
        templateDim,
        this.config.templateFrom,
        this.config.templateTo
      );
      this.log(`\u5DF2\u6355\u83B7\u6A21\u677F\u7ED3\u6784 ${this.config.structureId}`);
    }
    return structure;
  }
  tickingAreaId(roomId) {
    return `bearcade:ta_${this.config.gameId}_${roomId}`;
  }
  async initRoom(roomId, structureId) {
    const dim = this.roomDim(roomId);
    const areaId = this.tickingAreaId(roomId);
    if (world.tickingAreaManager.hasTickingArea(areaId)) {
      world.tickingAreaManager.removeTickingArea(areaId);
    }
    await world.tickingAreaManager.createTickingArea(areaId, {
      dimension: dim,
      from: this.config.tickingFrom,
      to: this.config.tickingTo
    });
    world.structureManager.place(structureId, dim, this.config.roomCopyOrigin);
    this.ready.set(roomId, true);
    this.log(`\u623F\u95F4 ${roomId} \u573A\u5730\u5C31\u7EEA`);
  }
  async initRooms() {
    try {
      const structure = await this.ensureTemplateStructure();
      for (let roomId = 1; roomId <= this.config.roomCount; roomId++) {
        try {
          await this.initRoom(roomId, structure.id);
        } catch (error) {
          this.ready.set(roomId, false);
          this.log(`\u623F\u95F4 ${roomId} \u521D\u59CB\u5316\u5931\u8D25`, error);
        }
      }
    } catch (error) {
      this.log("\u6A21\u677F\u7ED3\u6784\u6355\u83B7\u5931\u8D25", error);
    }
  }
  async resetRoomsFromTemplate(roomIds) {
    if (world.structureManager.get(this.config.structureId)) {
      world.structureManager.delete(this.config.structureId);
    }
    const templateDim = world.getDimension(this.templateDimensionId());
    const structure = world.structureManager.createFromWorld(
      this.config.structureId,
      templateDim,
      this.config.templateFrom,
      this.config.templateTo
    );
    for (const roomId of roomIds) {
      const dim = this.roomDim(roomId);
      world.structureManager.place(structure.id, dim, this.config.roomCopyOrigin);
    }
  }
  // ================= 对局状态机 =================
  cancelPending(state) {
    if (state.pendingRunId !== void 0) {
      system.clearRun(state.pendingRunId);
      state.pendingRunId = void 0;
    }
  }
  startPending(roomId) {
    const state = this.getState(roomId);
    if (state.phase !== "idle") return;
    state.phase = "pending";
    state.pendingRunId = system.runTimeout(
      () => this.startGame(roomId),
      this.config.startDelayTicks ?? 40
    );
    this.announce(roomId, "\xA7e\u4E24\u540D\u73A9\u5BB6\u5DF2\u5C31\u4F4D,\u5BF9\u5C40\u5373\u5C06\u5F00\u59CB\u2026");
  }
  startGame(roomId) {
    const state = this.getState(roomId);
    if (state.phase !== "pending") return;
    const players = this.roomPlayers(roomId);
    if (players.length < 2) {
      state.phase = "idle";
      return;
    }
    state.phase = "running";
    state.players = players.map((p) => p.id);
    this.hooks.onGameStart?.(roomId, players);
    this.sendRoomStatus();
  }
  /** 结束对局并进入重置流程;message 为空时使用默认提示 */
  endGame(roomId, reason, message) {
    const state = this.getState(roomId);
    if (state.phase === "resetting") return;
    this.cancelPending(state);
    state.phase = "resetting";
    this.announce(
      roomId,
      message ?? `\xA7e\u5BF9\u5C40\u7ED3\u675F(${reason}),\u5373\u5C06\u8FD4\u56DE\u5927\u5385\u2026`
    );
    system.runTimeout(() => {
      void this.finishReset(roomId);
    }, this.config.endDelayTicks ?? 60);
  }
  async finishReset(roomId) {
    this.hooks.onBeforeReset?.(roomId);
    const lobbyDim = world.getDimension(
      this.config.lobbyDimensionId ?? "minecraft:overworld"
    );
    const spawn = world.getDefaultSpawnLocation();
    for (const player of this.roomPlayers(roomId)) {
      try {
        player.teleport(spawn, { dimension: lobbyDim });
      } catch (error) {
        this.log(`\u623F\u95F4 ${roomId} \u73A9\u5BB6\u56DE\u5927\u5385\u5931\u8D25`, error);
      }
    }
    try {
      await this.resetRoomsFromTemplate([roomId]);
    } catch (error) {
      this.log(`\u623F\u95F4 ${roomId} \u573A\u5730\u91CD\u7F6E\u5931\u8D25`, error);
    }
    this.hooks.onRoomReset?.(roomId);
    this.states.set(roomId, { phase: "idle", players: [] });
    this.log(`\u623F\u95F4 ${roomId} \u5DF2\u91CD\u7F6E`);
    this.sendRoomStatus();
  }
  tickGames() {
    for (let roomId = 1; roomId <= this.config.roomCount; roomId++) {
      try {
        if (!this.isRoomReady(roomId)) continue;
        const state = this.getState(roomId);
        const count = this.roomPlayers(roomId).length;
        if (state.phase === "idle" && count >= 2) {
          this.startPending(roomId);
        } else if (state.phase === "pending" && count < 2) {
          this.cancelPending(state);
          state.phase = "idle";
          this.announce(roomId, "\xA77\u7B49\u5F85\u73A9\u5BB6\u5C31\u4F4D\u2026");
        } else if (state.phase === "running" && count < 2) {
          this.endGame(roomId, "\u73A9\u5BB6\u79BB\u5F00");
        }
      } catch (error) {
        this.log(`\u623F\u95F4 ${roomId} \u72B6\u6001\u673A\u5F02\u5E38`, error);
      }
    }
  }
  forceStopInDimension(dimensionId) {
    const roomId = this.roomIdFromDimension(dimensionId);
    if (!roomId) return false;
    const state = this.getState(roomId);
    if (state.phase !== "running" && state.phase !== "pending") return false;
    system.run(() => this.endGame(roomId, "\u5F3A\u5236\u4E2D\u65AD"));
    return true;
  }
  // ================= Core 上报 =================
  getReportStatus(roomId) {
    if (!this.isRoomReady(roomId)) return "initializing";
    const phase = this.getState(roomId).phase;
    if (phase === "running" || phase === "pending") return "running";
    if (phase === "resetting") return "initializing";
    return "idle";
  }
  sendGameRegister() {
    try {
      system.sendScriptEvent(
        this.config.ipcChannel ?? "bearcade:ipc",
        JSON.stringify({
          op: "game.register",
          packId: this.config.packId,
          payload: {
            game: this.config.gameId,
            displayName: this.config.displayName,
            roomCount: this.config.roomCount,
            maxPlayers: this.config.maxPlayers,
            prepSpawn: this.config.prepSpawn
          }
        })
      );
      this.log("\u5DF2\u5411 Core \u6CE8\u518C\u6E38\u620F\u4FE1\u606F");
    } catch (error) {
      this.log("\u6CE8\u518C\u6D88\u606F\u53D1\u9001\u5931\u8D25", error);
    }
  }
  sendRoomStatus() {
    try {
      const rooms = [];
      for (let roomId = 1; roomId <= this.config.roomCount; roomId++) {
        rooms.push({
          id: roomId,
          players: this.roomPlayers(roomId).length,
          status: this.getReportStatus(roomId)
        });
      }
      system.sendScriptEvent(
        this.config.ipcChannel ?? "bearcade:ipc",
        JSON.stringify({
          op: "room.status",
          packId: this.config.packId,
          payload: { game: this.config.gameId, rooms }
        })
      );
    } catch (error) {
      this.log("\u72B6\u6001\u4E0A\u62A5\u5931\u8D25", error);
    }
  }
  // ================= 生命周期入口 =================
  initWorld() {
    if (this.started) return;
    this.started = true;
    this.sendGameRegister();
    void this.initRooms();
    system.runInterval(
      () => this.tickGames(),
      this.config.gameTickInterval ?? 10
    );
    system.runInterval(
      () => this.sendRoomStatus(),
      this.config.heartbeatInterval ?? 100
    );
  }
  initEvents() {
    world.beforeEvents.playerBreakBlock.subscribe((event) => {
      if (this.roomIdFromDimension(event.block.dimension.id) !== void 0) {
        event.cancel = true;
      }
    });
    world.beforeEvents.playerPlaceBlock.subscribe((event) => {
      const roomId = this.roomIdFromDimension(event.block.dimension.id);
      if (roomId === void 0) return;
      if (this.hooks.canPlace?.(event, roomId) ?? false) return;
      event.cancel = true;
    });
  }
};

// Gomoku-五子棋/src/gomoku.ts
import {
  system as system2,
  ItemStack,
  EntityComponentTypes
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
var BOARD_Y = 63;
var GRID_MIN = -7;
var GRID_MAX = 7;
var STONE_BLACK = "minecraft:polished_blackstone_pressure_plate";
var STONE_WHITE = "minecraft:heavy_weighted_pressure_plate";
var START_POS_BLACK = { x: 0, y: 65, z: -1 };
var START_POS_WHITE = { x: 0, y: 65, z: 1 };
var DIMENSION_NAMESPACE = "bearcade";
var TEMPLATE_DIMENSION_ID = `${DIMENSION_NAMESPACE}:${GAME_ID}_template`;
var TEMPLATE_SPAWN = { x: 0, y: 100, z: 0 };

// Gomoku-五子棋/src/gomoku.ts
var GRID_SIZE = GRID_MAX - GRID_MIN + 1;
var games = /* @__PURE__ */ new Map();
function emptyBoard() {
  return Array.from(
    { length: GRID_SIZE },
    () => Array(GRID_SIZE).fill(null)
  );
}
function inGrid(x, z) {
  return x >= GRID_MIN && x <= GRID_MAX && z >= GRID_MIN && z <= GRID_MAX;
}
function inventoryOf(player) {
  return player.getComponent(
    EntityComponentTypes.Inventory
  );
}
function clearTokens(runtime2, roomId) {
  for (const player of runtime2.roomPlayers(roomId)) {
    const container = inventoryOf(player)?.container;
    if (!container) continue;
    for (let slot = 0; slot < container.size; slot++) {
      const item = container.getItem(slot);
      if (item && (item.typeId === STONE_BLACK || item.typeId === STONE_WHITE)) {
        container.setItem(slot, void 0);
      }
    }
  }
}
function giveTurn(runtime2, roomId, player, color) {
  clearTokens(runtime2, roomId);
  const container = inventoryOf(player)?.container;
  if (container) {
    container.addItem(
      new ItemStack(color === "black" ? STONE_BLACK : STONE_WHITE, 1)
    );
  }
  const name = color === "black" ? "\u9ED1" : "\u767D";
  player.sendMessage(`\xA7a\u8F6E\u5230\u4F60\u843D\u5B50(${name}\u65B9)`);
  player.onScreenDisplay.setActionBar(`\xA7a\u8F6E\u5230\u4F60\u843D\u5B50 \xB7 ${name}\u65B9`);
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
function handlePlace(runtime2, event, roomId) {
  const player = event.player;
  if (!runtime2.isRunning(roomId)) return false;
  const state = games.get(roomId);
  if (!state) return false;
  const { x, y, z } = event.block.location;
  if (y !== BOARD_Y + 1 || !inGrid(x, z)) {
    system2.run(() => player.sendMessage("\xA7c\u68CB\u5B50\u53EA\u80FD\u653E\u5728\u68CB\u76D8\u683C\u4E0A"));
    return false;
  }
  const cx = x - GRID_MIN;
  const cz = z - GRID_MIN;
  if (state.board[cx][cz]) {
    system2.run(() => player.sendMessage("\xA7c\u8BE5\u4F4D\u7F6E\u5DF2\u6709\u68CB\u5B50"));
    return false;
  }
  if (state.players[state.turn] !== player.id) {
    system2.run(() => player.sendMessage("\xA7c\u8FD8\u6CA1\u8F6E\u5230\u4F60\u843D\u5B50"));
    return false;
  }
  const color = state.turn;
  const expected = color === "black" ? STONE_BLACK : STONE_WHITE;
  if (event.permutationToPlace.type.id !== expected) {
    system2.run(() => player.sendMessage("\xA7c\u8BF7\u653E\u7F6E\u4F60\u624B\u4E2D\u7684\u5BF9\u5E94\u989C\u8272\u68CB\u5B50"));
    return false;
  }
  state.board[cx][cz] = color;
  const won = checkWin(state.board, cx, cz, color);
  const full = !won && isBoardFull(state.board);
  state.turn = state.turn === "black" ? "white" : "black";
  const next = state.turn;
  system2.run(() => {
    player.sendMessage(
      `\xA77\u843D\u5B50:${color === "black" ? "\u9ED1" : "\u767D"} (${x}, ${z})`
    );
    if (won) {
      runtime2.announce(
        roomId,
        `\xA7e${color === "black" ? "\u9ED1\u65B9" : "\u767D\u65B9"}\u4E94\u8FDE,\u5BF9\u5C40\u7ED3\u675F`
      );
      runtime2.endGame(
        roomId,
        color === "black" ? "\u9ED1\u65B9\u83B7\u80DC" : "\u767D\u65B9\u83B7\u80DC",
        "\xA7e\u5373\u5C06\u8FD4\u56DE\u5927\u5385\u2026"
      );
      return;
    }
    if (full) {
      runtime2.announce(roomId, "\xA7e\u68CB\u76D8\u5DF2\u6EE1,\u5E73\u5C40");
      runtime2.endGame(roomId, "\u5E73\u5C40", "\xA7e\u5373\u5C06\u8FD4\u56DE\u5927\u5385\u2026");
      return;
    }
    const nextPlayer = runtime2.roomPlayers(roomId).find((p) => p.id === state.players[next]);
    if (nextPlayer) giveTurn(runtime2, roomId, nextPlayer, next);
    runtime2.announce(
      roomId,
      `\u8F6E\u5230${next === "black" ? "\u9ED1\u65B9" : "\u767D\u65B9"}\u843D\u5B50`
    );
  });
  return true;
}
function makeGomokuHooks(getRuntime) {
  return {
    onGameStart(roomId, players) {
      const runtime2 = getRuntime();
      const blackIsFirst = Math.random() < 0.5;
      const black = blackIsFirst ? players[0] : players[1];
      const white = blackIsFirst ? players[1] : players[0];
      games.set(roomId, {
        board: emptyBoard(),
        turn: "black",
        players: { black: black.id, white: white.id }
      });
      runtime2.teleportPlayer(roomId, black, START_POS_BLACK);
      runtime2.teleportPlayer(roomId, white, START_POS_WHITE);
      runtime2.announce(
        roomId,
        `\xA7a\u5BF9\u5C40\u5F00\u59CB!\u9ED1\u65B9:${black.name} / \u767D\u65B9:${white.name},\u653E\u7F6E\u538B\u529B\u677F\u843D\u5B50`
      );
      giveTurn(runtime2, roomId, black, "black");
    },
    onBeforeReset(roomId) {
      clearTokens(getRuntime(), roomId);
      games.delete(roomId);
    },
    canPlace(event, roomId) {
      return handlePlace(getRuntime(), event, roomId);
    }
  };
}

// Gomoku-五子棋/src/main.ts
var runtime;
runtime = new MinigameRuntime(
  {
    gameId: GAME_ID,
    displayName: DISPLAY_NAME,
    packId: PACK_ID,
    roomCount: ROOM_COUNT,
    maxPlayers: MAX_PLAYERS,
    prepSpawn: PREP_SPAWN,
    templateFrom: TEMPLATE_FROM,
    templateTo: TEMPLATE_TO,
    roomCopyOrigin: ROOM_COPY_ORIGIN,
    tickingFrom: TICKING_FROM,
    tickingTo: TICKING_TO,
    structureId: STRUCTURE_ID,
    templateSpawn: TEMPLATE_SPAWN,
    startPositions: [START_POS_BLACK, START_POS_WHITE],
    lobbyDimensionId: LOBBY_DIMENSION_ID,
    ipcChannel: IPC_CHANNEL
  },
  makeGomokuHooks(() => runtime)
);
system3.beforeEvents.startup.subscribe((event) => {
  runtime.initStartup(event);
});
world2.afterEvents.worldLoad.subscribe(() => {
  runtime.initWorld();
  runtime.initEvents();
});
//# sourceMappingURL=main.js.map
