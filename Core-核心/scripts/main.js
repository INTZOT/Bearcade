// Core-核心/src/main.ts
import { world as world5, system as system4 } from "@minecraft/server";

// Core-核心/src/registry.ts
import { world } from "@minecraft/server";

// Core-核心/src/types.ts
var IPC_CHANNEL = "bearcade:ipc";
var REGISTRY_KEY = "bearcade:registry";
var LOBBY_DIMENSION_ID = "minecraft:overworld";

// Core-核心/src/registry.ts
var STALE_MS = 15e3;
function roomKey(game, roomId) {
  return `${game}:${roomId}`;
}
function dimensionId(game, roomId) {
  return `bearcade:${game}_${roomId}`;
}
var GameRegistry = class {
  constructor() {
    this.games = /* @__PURE__ */ new Map();
    this.playerRooms = /* @__PURE__ */ new Map();
    this.load();
  }
  load() {
    try {
      const raw = world.getDynamicProperty(REGISTRY_KEY);
      if (typeof raw !== "string" || raw.length === 0) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        const entry = item;
        if (typeof entry.game !== "string" || typeof entry.displayName !== "string" || typeof entry.packId !== "string" || typeof entry.roomCount !== "number" || typeof entry.maxPlayers !== "number" || typeof entry.prepSpawn !== "object") {
          continue;
        }
        this.createEntry(
          entry.game,
          entry.displayName,
          entry.packId,
          entry.roomCount,
          entry.maxPlayers,
          entry.prepSpawn
        );
      }
      console.warn("[Bearcade Core] \u5DF2\u4ECE\u52A8\u6001\u5C5E\u6027\u6062\u590D\u6E38\u620F\u6CE8\u518C\u8868");
    } catch (error) {
      console.warn("[Bearcade Core] \u6CE8\u518C\u8868\u52A0\u8F7D\u5931\u8D25", error);
    }
  }
  persist() {
    const snapshot = [...this.games.values()].map((entry) => ({
      game: entry.game,
      displayName: entry.displayName,
      packId: entry.packId,
      roomCount: entry.roomCount,
      maxPlayers: entry.maxPlayers,
      prepSpawn: entry.prepSpawn
    }));
    world.setDynamicProperty(REGISTRY_KEY, JSON.stringify(snapshot));
  }
  createEntry(game, displayName, packId, roomCount, maxPlayers, prepSpawn) {
    const rooms = /* @__PURE__ */ new Map();
    for (let id = 1; id <= roomCount; id++) {
      rooms.set(id, {
        id,
        players: 0,
        status: "initializing",
        lastSeen: 0,
        reserved: 0,
        stale: true
      });
    }
    const entry = {
      game,
      displayName,
      packId,
      roomCount,
      maxPlayers,
      prepSpawn,
      rooms
    };
    this.games.set(game, entry);
    return entry;
  }
  upsertGame(payload, packId) {
    if (typeof payload.game !== "string" || !/^[a-z0-9_]+$/.test(payload.game) || typeof payload.displayName !== "string" || typeof payload.roomCount !== "number" || !Number.isInteger(payload.roomCount) || payload.roomCount < 1 || typeof payload.maxPlayers !== "number" || !Number.isInteger(payload.maxPlayers) || payload.maxPlayers < 1 || !payload.prepSpawn || typeof payload.prepSpawn.x !== "number" || typeof payload.prepSpawn.y !== "number" || typeof payload.prepSpawn.z !== "number") {
      return false;
    }
    this.createEntry(
      payload.game,
      payload.displayName,
      packId,
      payload.roomCount,
      payload.maxPlayers,
      payload.prepSpawn
    );
    this.persist();
    console.warn(
      `[Bearcade Core] \u6E38\u620F\u6CE8\u518C:${payload.displayName}(${payload.game}),${payload.roomCount} \u4E2A\u623F\u95F4`
    );
    return true;
  }
  updateRooms(game, packId, rooms) {
    const entry = this.games.get(game);
    if (!entry || entry.packId !== packId) return false;
    if (!Array.isArray(rooms)) return false;
    for (const report of rooms) {
      if (!report || typeof report.id !== "number" || !Number.isInteger(report.id) || report.id < 1 || report.id > entry.roomCount || typeof report.players !== "number" || !Number.isInteger(report.players) || report.players < 0 || report.status !== "initializing" && report.status !== "idle" && report.status !== "running") {
        return false;
      }
    }
    const now = Date.now();
    for (const report of rooms) {
      const room = entry.rooms.get(report.id);
      if (!room) continue;
      room.players = report.players;
      room.status = report.status;
      room.reserved = 0;
      room.lastSeen = now;
      room.stale = false;
    }
    return true;
  }
  tick(now) {
    for (const entry of this.games.values()) {
      for (const room of entry.rooms.values()) {
        if (now - room.lastSeen > STALE_MS) {
          room.stale = true;
        }
      }
    }
  }
  getGame(game) {
    return this.games.get(game);
  }
  listGames() {
    return [...this.games.values()].sort(
      (a, b) => a.displayName.localeCompare(b.displayName, "zh-CN")
    );
  }
  getRoom(game, roomId) {
    return this.games.get(game)?.rooms.get(roomId);
  }
  effectivePlayers(room) {
    return Math.max(room.players, room.reserved);
  }
  canJoin(entry, room) {
    return !room.stale && room.status === "idle" && this.effectivePlayers(room) < entry.maxPlayers;
  }
  roomDimensionId(game, roomId) {
    return dimensionId(game, roomId);
  }
  bindPlayer(playerId, game, roomId) {
    this.playerRooms.set(playerId, roomKey(game, roomId));
  }
  unbindPlayer(playerId) {
    this.playerRooms.delete(playerId);
  }
  getPlayerRoom(playerId) {
    return this.playerRooms.get(playerId);
  }
};

// Core-核心/src/ipc.ts
import { system, ScriptEventSource } from "@minecraft/server";
function isObject(value) {
  return typeof value === "object" && value !== null;
}
function initIpc(registry) {
  system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== IPC_CHANNEL) return;
    if (event.sourceType === ScriptEventSource.Entity && event.sourceEntity?.typeId === "minecraft:player") {
      return;
    }
    let envelope;
    try {
      envelope = JSON.parse(event.message);
    } catch {
      console.warn("[Bearcade Core] \u6536\u5230\u65E0\u6CD5\u89E3\u6790\u7684 IPC \u6D88\u606F");
      return;
    }
    if (!isObject(envelope) || typeof envelope.op !== "string" || typeof envelope.packId !== "string") {
      return;
    }
    switch (envelope.op) {
      case "game.register":
        handleRegister(registry, envelope.packId, envelope.payload);
        break;
      case "room.status":
        handleRoomStatus(registry, envelope.packId, envelope.payload);
        break;
      default:
        console.warn(`[Bearcade Core] \u672A\u77E5\u64CD\u4F5C\u7801:${envelope.op}`);
        break;
    }
  });
}
function handleRegister(registry, packId, payload) {
  if (!isObject(payload)) return;
  const ok = registry.upsertGame(
    payload,
    packId
  );
  if (!ok) {
    console.warn(`[Bearcade Core] \u975E\u6CD5 game.register(packId=${packId})`);
  }
}
function handleRoomStatus(registry, packId, payload) {
  if (!isObject(payload) || typeof payload.game !== "string") return;
  const ok = registry.updateRooms(
    payload.game,
    packId,
    payload.rooms
  );
  if (!ok) {
    console.warn(
      `[Bearcade Core] \u975E\u6CD5 room.status(game=${payload.game},packId=${packId})`
    );
  }
}

// Core-核心/src/lobby.ts
import {
  world as world3,
  ItemStack,
  ItemLockMode,
  EntityComponentTypes
} from "@minecraft/server";

// Core-核心/src/ui.ts
import {
  world as world2,
  system as system2
} from "@minecraft/server";
import {
  CustomForm,
  MessageBox,
  ObservableString,
  ObservableBoolean
} from "@minecraft/server-ui";
var MENU_DELAY_TICKS = 2;
var registryForUi;
var openForms = /* @__PURE__ */ new Map();
var roomViews = /* @__PURE__ */ new Map();
function closeForm(playerId) {
  const form = openForms.get(playerId);
  if (form && form.isShowing()) {
    try {
      form.close();
    } catch (error) {
      console.warn("[Bearcade Core] \u5173\u95ED\u8868\u5355\u5931\u8D25", error);
    }
  }
  openForms.delete(playerId);
}
function trackForm(playerId, form) {
  closeForm(playerId);
  openForms.set(playerId, form);
  try {
    const shown = form.show();
    shown.catch((error) => {
      console.warn("[Bearcade Core] \u8868\u5355\u663E\u793A\u5931\u8D25", error);
    });
    shown.finally(() => {
      if (openForms.get(playerId) === form) {
        openForms.delete(playerId);
      }
      const view = roomViews.get(playerId);
      if (view && view.form === form) {
        roomViews.delete(playerId);
      }
    });
  } catch (error) {
    console.warn("[Bearcade Core] \u8868\u5355 show() \u540C\u6B65\u629B\u51FA", error);
    openForms.delete(playerId);
  }
}
function showNotice(player, text) {
  new MessageBox(player, "Bearcade").body(text).button1("\u786E\u5B9A").show().catch((error) => {
    console.warn("[Bearcade Core] \u63D0\u793A\u6846\u663E\u793A\u5931\u8D25", error);
  });
}
function roomLabel(entry, room) {
  const status = room.stale ? "\u6570\u636E\u8FC7\u671F" : room.status === "initializing" ? "\u521D\u59CB\u5316\u4E2D" : room.status === "idle" ? "\u7A7A\u95F2\u4E2D" : "\u8FD0\u884C\u4E2D";
  return `\u623F\u95F4 ${room.id} [${status}] ${room.players}/${entry.maxPlayers} \u4EBA`;
}
function openMainMenu(player) {
  closeForm(player.id);
  const form = new CustomForm(player, "Bearcade \u670D\u52A1\u5668");
  form.label(`\xA7e\u6B22\u8FCE, ${player.name}`);
  form.spacer();
  form.button("\u6E38\u620F\u5217\u8868", () => {
    closeForm(player.id);
    system2.runTimeout(() => openGameList(player), MENU_DELAY_TICKS);
  });
  trackForm(player.id, form);
}
function openGameList(player) {
  closeForm(player.id);
  const form = new CustomForm(player, "\u6E38\u620F\u5217\u8868");
  const games = registryForUi.listGames();
  if (games.length === 0) {
    form.label("\xA77\u6682\u65E0\u6E38\u620F(\u7B49\u5F85\u5C0F\u6E38\u620F\u5305\u6CE8\u518C)");
  } else {
    for (const entry of games) {
      form.button(entry.displayName, () => {
        closeForm(player.id);
        system2.runTimeout(
          () => openRoomList(player, entry.game),
          MENU_DELAY_TICKS
        );
      });
    }
  }
  form.spacer();
  form.button("\u8FD4\u56DE", () => {
    closeForm(player.id);
    system2.runTimeout(() => openMainMenu(player), MENU_DELAY_TICKS);
  });
  trackForm(player.id, form);
}
function setUiRegistry(registry) {
  registryForUi = registry;
}
function openRoomList(player, game) {
  const entry = registryForUi.getGame(game);
  if (!entry) return;
  closeForm(player.id);
  const labels = /* @__PURE__ */ new Map();
  const disabled = /* @__PURE__ */ new Map();
  const form = new CustomForm(player, `${entry.displayName} \xB7 \u623F\u95F4\u5217\u8868`);
  for (let roomId = 1; roomId <= entry.roomCount; roomId++) {
    const room = entry.rooms.get(roomId);
    if (!room) continue;
    const label = new ObservableString(roomLabel(entry, room));
    const disable = new ObservableBoolean(!registryForUi.canJoin(entry, room));
    labels.set(roomId, label);
    disabled.set(roomId, disable);
    form.button(
      label,
      () => {
        void handleJoin(player, entry, roomId);
      },
      { disabled: disable }
    );
  }
  form.spacer();
  form.button("\u8FD4\u56DE", () => {
    closeForm(player.id);
    system2.runTimeout(() => openGameList(player), MENU_DELAY_TICKS);
  });
  roomViews.set(player.id, { game: entry, form, labels, disabled });
  trackForm(player.id, form);
}
function handleJoin(player, entry, roomId) {
  closeForm(player.id);
  if (registryForUi.getPlayerRoom(player.id)) {
    showNotice(player, "\u4F60\u5DF2\u5728\u623F\u95F4\u5185,\u8BF7\u5148\u8FD4\u56DE\u5927\u5385\u518D\u9009\u62E9\u5176\u4ED6\u623F\u95F4\u3002");
    return;
  }
  const room = registryForUi.getRoom(entry.game, roomId);
  if (!room) return;
  if (!registryForUi.canJoin(entry, room)) {
    showNotice(player, "\u8BE5\u623F\u95F4\u5F53\u524D\u4E0D\u53EF\u52A0\u5165(\u4EBA\u6570\u5DF2\u6EE1\u6216\u4E0D\u5728\u7A7A\u95F2\u4E2D)\u3002");
    return;
  }
  room.reserved += 1;
  const dimensionId2 = registryForUi.roomDimensionId(entry.game, roomId);
  try {
    const dimension = world2.getDimension(dimensionId2);
    player.teleport(entry.prepSpawn, { dimension });
    registryForUi.bindPlayer(player.id, entry.game, roomId);
  } catch (error) {
    room.reserved = Math.max(0, room.reserved - 1);
    console.warn(
      `[Bearcade Core] \u4F20\u9001\u5931\u8D25:${player.name} -> ${dimensionId2}`,
      error
    );
    showNotice(player, "\u52A0\u5165\u5931\u8D25:\u623F\u95F4\u7EF4\u5EA6\u5C1A\u672A\u5C31\u7EEA\u3002");
  }
}
function refreshRoomViews() {
  for (const [playerId, view] of roomViews) {
    const entry = registryForUi.getGame(view.game.game);
    if (!entry) {
      roomViews.delete(playerId);
      continue;
    }
    for (const roomId of view.labels.keys()) {
      const room = entry.rooms.get(roomId);
      if (!room) continue;
      view.labels.get(roomId)?.setData(roomLabel(entry, room));
      view.disabled.get(roomId)?.setData(!registryForUi.canJoin(entry, room));
    }
  }
}

// Core-核心/src/lobby.ts
var CLOCK_ITEM = "minecraft:clock";
var HOTBAR_SLOT = 0;
var ROOM_DIM_PATTERN = /^bearcade:([a-z0-9_]+)_(\d+)$/;
function ensureClock(player) {
  const inventory = player.getComponent(
    EntityComponentTypes.Inventory
  );
  if (!inventory?.container) return;
  const slot = inventory.container.getSlot(HOTBAR_SLOT);
  const existing = slot.getItem();
  if (existing && existing.typeId === CLOCK_ITEM && existing.lockMode === ItemLockMode.slot) {
    return;
  }
  const clock = new ItemStack(CLOCK_ITEM, 1);
  clock.lockMode = ItemLockMode.slot;
  inventory.container.setItem(HOTBAR_SLOT, clock);
}
function handleDimensionChange(registry, event) {
  if (event.toDimension.id === LOBBY_DIMENSION_ID) {
    registry.unbindPlayer(event.player.id);
    ensureClock(event.player);
    return;
  }
  const match = ROOM_DIM_PATTERN.exec(event.toDimension.id);
  if (!match) return;
  const [, game, roomIdText] = match;
  const roomId = Number(roomIdText);
  const entry = registry.getGame(game);
  if (entry && roomId >= 1 && roomId <= entry.roomCount) {
    registry.bindPlayer(event.player.id, game, roomId);
  }
}
function handleSpawn(registry, event) {
  if (event.player.dimension.id === LOBBY_DIMENSION_ID) {
    ensureClock(event.player);
  }
}
function initLobby(registry) {
  world3.afterEvents.itemUse.subscribe((event) => {
    const { source: player, itemStack } = event;
    console.warn(
      `[Bearcade Core][itemUse] type=${itemStack.typeId} dim=${player.dimension.id} player=${player.name}`
    );
    if (itemStack.typeId === CLOCK_ITEM) {
      if (player.dimension.id !== LOBBY_DIMENSION_ID) {
        console.warn(
          `[Bearcade Core][itemUse] \u65F6\u949F\u4F7F\u7528\u4F46\u4E0D\u5728\u5927\u5385\u7EF4\u5EA6,\u5FFD\u7565`
        );
        return;
      }
      try {
        openMainMenu(player);
      } catch (error) {
        console.warn("[Bearcade Core][itemUse] \u6253\u5F00\u4E3B\u83DC\u5355\u5931\u8D25", error);
      }
    }
  });
  world3.afterEvents.playerDimensionChange.subscribe((event) => {
    handleDimensionChange(registry, event);
  });
  world3.afterEvents.playerSpawn.subscribe((event) => {
    handleSpawn(registry, event);
  });
  world3.afterEvents.playerLeave.subscribe((event) => {
    registry.unbindPlayer(event.playerId);
  });
}
function ensureClockForAll() {
  for (const player of world3.getAllPlayers()) {
    if (player.dimension.id === LOBBY_DIMENSION_ID) {
      ensureClock(player);
    }
  }
}

// Core-核心/src/commands.ts
import {
  system as system3,
  world as world4,
  Player,
  CustomCommandStatus,
  CommandPermissionLevel
} from "@minecraft/server";
function initCommands() {
  system3.beforeEvents.startup.subscribe((event) => {
    event.customCommandRegistry.registerCommand(
      {
        name: "bearcade:lobby",
        description: "\u4F20\u9001\u56DE\u5927\u5385(\u4E3B\u4E16\u754C)",
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
          try {
            const dimension = world4.getDimension(LOBBY_DIMENSION_ID);
            player.teleport(world4.getDefaultSpawnLocation(), { dimension });
          } catch (error) {
            console.warn("[Bearcade Core] /bearcade:lobby \u4F20\u9001\u5931\u8D25", error);
          }
        });
        return {
          status: CustomCommandStatus.Success,
          message: "\u6B63\u5728\u4F20\u9001\u56DE\u5927\u5385"
        };
      }
    );
  });
}

// Core-核心/src/main.ts
var POLL_INTERVAL_TICKS = 40;
initCommands();
world5.afterEvents.worldLoad.subscribe(() => {
  const registry = new GameRegistry();
  setUiRegistry(registry);
  initIpc(registry);
  initLobby(registry);
  system4.runInterval(() => {
    registry.tick(Date.now());
    refreshRoomViews();
  }, POLL_INTERVAL_TICKS);
  ensureClockForAll();
  console.warn("[Bearcade Core] \u5DF2\u52A0\u8F7D:\u5927\u5385\u3001DDUI \u83DC\u5355\u3001\u5165\u623F\u6821\u9A8C\u5C31\u7EEA");
});
//# sourceMappingURL=main.js.map
