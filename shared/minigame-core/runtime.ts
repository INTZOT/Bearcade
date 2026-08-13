import {
  system,
  world,
  Player,
  type DimensionRegistry,
  type ScriptEventCommandMessageAfterEvent,
} from "@minecraft/server";
import { CustomForm, ObservableString } from "@minecraft/server-ui";
import type { MinigameConfig, MinigameHooks } from "./types";
import type { Vec3 } from "./types";

type Phase = "idle" | "pending" | "running" | "resetting";

interface RoomState {
  phase: Phase;
  players: string[];
  pendingDeadlineTick?: number;
}

interface StartupContext {
  dimensionRegistry: DimensionRegistry;
}

/**
 * 小游戏房间运行时(构建期内联到每个小游戏包):
 * 维度注册、模板命令/强制中止命令、模板捕获与复制、常加载、
 * 房间状态机、Core 上报、结束回大厅与重置。
 */
export class MinigameRuntime {
  readonly config: MinigameConfig;
  readonly hooks: MinigameHooks;
  private readonly states = new Map<number, RoomState>();
  private readonly ready = new Map<number, boolean>();
  private readonly roomPattern: RegExp;
  private started = false;
  private partyMode = false;
  private debugEnabled = false;

  constructor(config: MinigameConfig, hooks: MinigameHooks = {}) {
    this.config = config;
    this.hooks = hooks;
    this.roomPattern = new RegExp(`^bearcade:${config.gameId}_(\\d+)$`);
  }

  private log(message: string, error?: unknown): void {
    console.warn(`[Bearcade ${this.config.gameId}] ${message}`, error ?? "");
  }

  // ================= 维度与命令 =================

  initStartup(event: StartupContext): void {
    for (let roomId = 1; roomId <= this.config.roomCount; roomId++) {
      event.dimensionRegistry.registerCustomDimension(
        this.roomDimensionId(roomId),
      );
    }
    event.dimensionRegistry.registerCustomDimension(this.templateDimensionId());

    this.log(
      `已注册 ${this.config.roomCount} 个房间维度与模板维度`,
    );
  }

  // ================= Core 指令路由(经 IPC 下发) =================

  private handleIpc(event: ScriptEventCommandMessageAfterEvent): void {
    if (event.id !== (this.config.ipcChannel ?? "bearcade:ipc")) return;

    let envelope: { op?: unknown; payload?: unknown };
    try {
      envelope = JSON.parse(event.message) as { op?: unknown; payload?: unknown };
    } catch {
      return;
    }
    if (!envelope || typeof envelope.op !== "string") return;

    const payload = envelope.payload as
      | {
          game?: unknown;
          playerId?: unknown;
          dimensionId?: unknown;
          enabled?: unknown;
        }
      | undefined;
    if (!payload) return;

    if (envelope.op === "party.mode") {
      if (typeof payload.enabled === "boolean") {
        this.setPartyMode(payload.enabled);
      }
      return;
    }

    if (payload.game !== this.config.gameId) return;

    switch (envelope.op) {
      case "game.tp": {
        if (typeof payload.playerId !== "string") return;
        const player = world
          .getAllPlayers()
          .find((p) => p.id === payload.playerId);
        if (!player) return;
        const dimension = world.getDimension(this.templateDimensionId());
        // 坐标默认按方块中心:传送时 +0.5
        player.teleport(
          {
            x: this.config.templateSpawn.x + 0.5,
            y: this.config.templateSpawn.y + 0.5,
            z: this.config.templateSpawn.z + 0.5,
          },
          { dimension },
        );
        break;
      }
      case "game.apply":
        void this.applyTemplateToAllRooms();
        break;
      case "game.quit":
        if (typeof payload.dimensionId !== "string") return;
        if (!this.forceStopInDimension(payload.dimensionId)) {
          this.log("quit:当前维度没有运行中的对局");
        }
        break;
      case "game.sz": {
        if (typeof payload.playerId !== "string") return;
        const player = world
          .getAllPlayers()
          .find((p) => p.id === payload.playerId);
        if (player) this.openTemplateBoundsForm(player);
        break;
      }
      case "game.config": {
        if (typeof payload.playerId !== "string") return;
        const player = world
          .getAllPlayers()
          .find((p) => p.id === payload.playerId);
        if (!player) return;
        if (this.hooks.openConfig) {
          this.hooks.openConfig(player);
        } else {
          player.sendMessage("§c该游戏未提供配置界面");
        }
        break;
      }
      case "game.debug": {
        if (typeof payload.enabled !== "boolean") return;
        this.setDebug(payload.enabled);
        if (typeof payload.playerId === "string") {
          const player = world
            .getAllPlayers()
            .find((p) => p.id === payload.playerId);
          player?.sendMessage(
            `调试日志已${payload.enabled ? "开启" : "关闭"}`,
          );
        }
        break;
      }
    }
  }

  isDebug(): boolean {
    return this.debugEnabled;
  }

  setDebug(enabled: boolean): void {
    this.debugEnabled = enabled;
    system.run(() => {
      try {
        world.setDynamicProperty(
          `bearcade:debug_${this.config.gameId}`,
          this.debugEnabled,
        );
      } catch (error) {
        this.log("调试状态持久化失败", error);
      }
    });
    this.log(`调试日志已${enabled ? "开启" : "关闭"}`);
  }

  private loadDebugState(): void {
    try {
      this.debugEnabled =
        world.getDynamicProperty(`bearcade:debug_${this.config.gameId}`) ===
        true;
    } catch {
      this.debugEnabled = false;
    }
  }

  dbg(...args: unknown[]): void {
    if (this.debugEnabled) {
      console.warn(`[Bearcade ${this.config.gameId} Debug]`, ...args);
    }
  }

  private async applyTemplateToAllRooms(): Promise<void> {
    const roomIds = Array.from(
      { length: this.config.roomCount },
      (_, index) => index + 1,
    );
    try {
      await this.resetRoomsFromTemplate(roomIds);
      this.log("已应用模板到全部房间");
    } catch (error) {
      this.log("应用模板失败", error);
    }
    this.sendRoomStatus();
  }

  // ================= 模板范围表单配置 =================

  private loadPersistedTemplateBounds(): void {
    try {
      const raw = world.getDynamicProperty(
        `bearcade:template_bounds_${this.config.gameId}`,
      );
      if (typeof raw !== "string" || raw.length === 0) return;
      const data = JSON.parse(raw) as { from?: Vec3; to?: Vec3 };
      if (!data.from || !data.to) return;
      this.applyTemplateBounds(data.from, data.to);
      this.log("已加载游戏内配置的模板范围");
    } catch (error) {
      this.log("模板范围配置加载失败", error);
    }
  }

  private applyTemplateBounds(from: Vec3, to: Vec3): void {
    this.config.templateFrom = from;
    this.config.templateTo = to;
    this.config.roomCopyOrigin = from;
    this.config.tickingFrom = { x: from.x, y: -1, z: from.z };
    this.config.tickingTo = { x: to.x, y: 65, z: to.z };
  }

  saveTemplateBounds(from: Vec3, to: Vec3): boolean {
    const x1 = Math.min(from.x, to.x);
    const x2 = Math.max(from.x, to.x);
    const y1 = Math.min(from.y, to.y);
    const y2 = Math.max(from.y, to.y);
    const z1 = Math.min(from.z, to.z);
    const z2 = Math.max(from.z, to.z);
    if (
      y1 < -64 ||
      y2 > 320 ||
      x2 - x1 + 1 > 64 ||
      y2 - y1 + 1 > 384 ||
      z2 - z1 + 1 > 64
    ) {
      return false;
    }
    const normalized = {
      from: { x: x1, y: y1, z: z1 } as Vec3,
      to: { x: x2, y: y2, z: z2 } as Vec3,
    };
    this.applyTemplateBounds(normalized.from, normalized.to);
    world.setDynamicProperty(
      `bearcade:template_bounds_${this.config.gameId}`,
      JSON.stringify(normalized),
    );
    this.log(
      `模板范围已保存:(${x1},${y1},${z1}) ~ (${x2},${y2},${z2}),执行 /bearcade:tmp ap ${this.config.gameId} 应用到全部房间`,
    );
    return true;
  }

  private openTemplateBoundsForm(player: Player): void {
    const { templateFrom, templateTo } = this.config;
    const fromX = new ObservableString(String(templateFrom.x), {
      clientWritable: true,
    });
    const fromY = new ObservableString(String(templateFrom.y), {
      clientWritable: true,
    });
    const fromZ = new ObservableString(String(templateFrom.z), {
      clientWritable: true,
    });
    const toX = new ObservableString(String(templateTo.x), {
      clientWritable: true,
    });
    const toY = new ObservableString(String(templateTo.y), {
      clientWritable: true,
    });
    const toZ = new ObservableString(String(templateTo.z), {
      clientWritable: true,
    });

    const form = new CustomForm(
      player,
      `${this.config.displayName} · 模板范围配置`,
    );
    form.label(
      "填写模板维度的起始点/终点坐标(含端点)。保存后执行 /bearcade:tmp ap 应用到全部房间。",
    );
    form.spacer();
    form.textField("起始点 X", fromX);
    form.textField("起始点 Y", fromY);
    form.textField("起始点 Z", fromZ);
    form.textField("终点 X", toX);
    form.textField("终点 Y", toY);
    form.textField("终点 Z", toZ);
    form.button("保存", () => {
      form.close();
      const from = this.parseIntVec3(fromX, fromY, fromZ);
      const to = this.parseIntVec3(toX, toY, toZ);
      if (!from || !to) {
        player.sendMessage("§c坐标格式不正确,请输入整数");
        return;
      }
      if (!this.saveTemplateBounds(from, to)) {
        player.sendMessage(
          "§c范围不合法:需在 y -64~320 内,且尺寸不超过 64×384×64",
        );
        return;
      }
      player.sendMessage(
        `§a已保存模板范围,执行 /bearcade:tmp ap ${this.config.gameId} 应用到全部房间`,
      );
    });
    form.show().catch((error) => {
      this.log("模板范围表单显示失败", error);
    });
  }

  private parseIntVec3(
    x: ObservableString,
    y: ObservableString,
    z: ObservableString,
  ): Vec3 | undefined {
    const nx = Number(x.getData());
    const ny = Number(y.getData());
    const nz = Number(z.getData());
    if (
      !Number.isInteger(nx) ||
      !Number.isInteger(ny) ||
      !Number.isInteger(nz)
    ) {
      return undefined;
    }
    return { x: nx, y: ny, z: nz };
  }

  // ================= 维度与房间工具 =================

  roomDimensionId(roomId: number): string {
    return `bearcade:${this.config.gameId}_${roomId}`;
  }

  templateDimensionId(): string {
    return `bearcade:${this.config.gameId}_template`;
  }

  roomIdFromDimension(dimensionId: string): number | undefined {
    const match = this.roomPattern.exec(dimensionId);
    return match ? Number(match[1]) : undefined;
  }

  roomDim(roomId: number) {
    return world.getDimension(this.roomDimensionId(roomId));
  }

  roomPlayers(roomId: number): Player[] {
    return this.roomDim(roomId).getPlayers();
  }

  announce(roomId: number, message: string): void {
    for (const player of this.roomPlayers(roomId)) {
      player.sendMessage(message);
    }
  }

  teleportPlayer(
    roomId: number,
    player: Player,
    location: MinigameConfig["startPositions"][number],
  ): void {
    // 坐标默认按方块中心:传送时 +0.5
    player.teleport(
      {
        x: location.x + 0.5,
        y: location.y + 0.5,
        z: location.z + 0.5,
      },
      { dimension: this.roomDim(roomId) },
    );
  }

  getPhase(roomId: number): Phase {
    return this.getState(roomId).phase;
  }

  isRunning(roomId: number): boolean {
    return this.getState(roomId).phase === "running";
  }

  // ================= 房间初始化与重置 =================

  private getState(roomId: number): RoomState {
    let state = this.states.get(roomId);
    if (!state) {
      state = { phase: "idle", players: [] };
      this.states.set(roomId, state);
    }
    return state;
  }

  private isRoomReady(roomId: number): boolean {
    return this.ready.get(roomId) === true;
  }

  private templateTiles(): { id: string; from: Vec3; to: Vec3 }[] {
    const { templateFrom, templateTo, structureId } = this.config;
    const size = this.config.tileSize ?? 64;
    const width = templateTo.x - templateFrom.x + 1;
    const depth = templateTo.z - templateFrom.z + 1;
    const xCount = Math.ceil(width / size);
    const zCount = Math.ceil(depth / size);
    const tiles: { id: string; from: Vec3; to: Vec3 }[] = [];
    for (let tx = 0; tx < xCount; tx++) {
      for (let tz = 0; tz < zCount; tz++) {
        const from: Vec3 = {
          x: templateFrom.x + tx * size,
          y: templateFrom.y,
          z: templateFrom.z + tz * size,
        };
        const to: Vec3 = {
          x: Math.min(templateFrom.x + (tx + 1) * size - 1, templateTo.x),
          y: templateTo.y,
          z: Math.min(templateFrom.z + (tz + 1) * size - 1, templateTo.z),
        };
        const id =
          xCount === 1 && zCount === 1
            ? structureId
            : `${structureId}_x${tx}_z${tz}`;
        tiles.push({ id, from, to });
      }
    }
    return tiles;
  }

  private deleteTemplateTiles(): void {
    for (const tile of this.templateTiles()) {
      if (world.structureManager.get(tile.id)) {
        world.structureManager.delete(tile.id);
      }
    }
  }

  private async captureTemplateTiles(): Promise<
    { id: string; from: Vec3; to: Vec3 }[]
  > {
    const templateDim = world.getDimension(this.templateDimensionId());
    // 模板维度必须常加载,否则 worldLoad 时区块未加载,createFromWorld 会失败
    const templateAreaId = this.tickingAreaId("template");
    if (!world.tickingAreaManager.hasTickingArea(templateAreaId)) {
      await world.tickingAreaManager.createTickingArea(templateAreaId, {
        dimension: templateDim,
        from: this.config.tickingFrom,
        to: this.config.tickingTo,
      });
    }
    const tiles = this.templateTiles();
    this.deleteTemplateTiles();
    for (const tile of tiles) {
      world.structureManager.createFromWorld(
        tile.id,
        templateDim,
        tile.from,
        tile.to,
      );
    }
    this.log(
      `已捕获模板结构 ${tiles.length} 块(${tiles[0]?.id ?? "无"})`,
    );
    return tiles;
  }

  private tickingAreaId(roomId: number | "template"): string {
    return `bearcade:ta_${this.config.gameId}_${roomId}`;
  }

  private placeTiles(
    dimension: ReturnType<MinigameRuntime["roomDim"]>,
    tiles: { id: string; from: Vec3; to: Vec3 }[],
  ): void {
    for (const tile of tiles) {
      const dest: Vec3 = {
        x:
          this.config.roomCopyOrigin.x +
          (tile.from.x - this.config.templateFrom.x),
        y:
          this.config.roomCopyOrigin.y +
          (tile.from.y - this.config.templateFrom.y),
        z:
          this.config.roomCopyOrigin.z +
          (tile.from.z - this.config.templateFrom.z),
      };
      world.structureManager.place(tile.id, dimension, dest);
    }
  }

  private async initRoom(
    roomId: number,
    tiles: { id: string; from: Vec3; to: Vec3 }[],
  ): Promise<void> {
    const dim = this.roomDim(roomId);
    const areaId = this.tickingAreaId(roomId);
    if (world.tickingAreaManager.hasTickingArea(areaId)) {
      world.tickingAreaManager.removeTickingArea(areaId);
    }
    await world.tickingAreaManager.createTickingArea(areaId, {
      dimension: dim,
      from: this.config.tickingFrom,
      to: this.config.tickingTo,
    });
    this.placeTiles(dim, tiles);
    this.ready.set(roomId, true);
    this.log(`房间 ${roomId} 场地就绪`);
  }

  private async initRooms(): Promise<void> {
    try {
      const tiles = await this.captureTemplateTiles();
      for (let roomId = 1; roomId <= this.config.roomCount; roomId++) {
        try {
          await this.initRoom(roomId, tiles);
        } catch (error) {
          this.ready.set(roomId, false);
          this.log(`房间 ${roomId} 初始化失败`, error);
        }
      }
    } catch (error) {
      this.log("模板结构捕获失败", error);
    }
  }

  private async resetRoomsFromTemplate(roomIds: number[]): Promise<void> {
    const tiles = await this.captureTemplateTiles();
    for (const roomId of roomIds) {
      const dim = this.roomDim(roomId);
      this.placeTiles(dim, tiles);
    }
  }

  // ================= 对局状态机 =================

  private startPending(roomId: number): void {
    const state = this.getState(roomId);
    if (state.phase !== "idle") return;
    state.phase = "pending";
    const delay = this.effectiveStartDelay();
    state.pendingDeadlineTick = system.currentTick + delay;
    this.announce(
      roomId,
      `§e${this.config.minPlayers ?? 2} 名玩家已就位,${Math.round(delay / 20)} 秒后开始…`,
    );
  }

  private startGame(roomId: number): void {
    const state = this.getState(roomId);
    if (state.phase !== "pending") return;
    const players = this.roomPlayers(roomId);
    if (players.length < (this.config.minPlayers ?? 2)) {
      state.phase = "idle";
      return;
    }
    state.phase = "running";
    state.pendingDeadlineTick = undefined;
    state.players = players.map((p) => p.id);
    this.hooks.onGameStart?.(roomId, players);
    this.sendRoomStatus();
  }

  /** 结束对局并进入重置流程;message 为空时使用默认提示 */
  endGame(roomId: number, reason: string, message?: string): void {
    const state = this.getState(roomId);
    if (state.phase === "resetting") return;
    state.pendingDeadlineTick = undefined;
    state.phase = "resetting";
    this.announce(
      roomId,
      message ?? `§e对局结束(${reason}),即将返回大厅…`,
    );
    system.runTimeout(() => {
      void this.finishReset(roomId);
    }, this.config.endDelayTicks ?? 60);
  }

  private async finishReset(roomId: number): Promise<void> {
    this.hooks.onBeforeReset?.(roomId);

    const lobbyDim = world.getDimension(
      this.config.lobbyDimensionId ?? "minecraft:overworld",
    );
    const spawn = world.getDefaultSpawnLocation();
    for (const player of this.roomPlayers(roomId)) {
      try {
        player.teleport(spawn, { dimension: lobbyDim });
      } catch (error) {
        this.log(`房间 ${roomId} 玩家回大厅失败`, error);
      }
    }

    try {
      await this.resetRoomsFromTemplate([roomId]);
    } catch (error) {
      this.log(`房间 ${roomId} 场地重置失败`, error);
    }
    this.hooks.onRoomReset?.(roomId);
    this.states.set(roomId, { phase: "idle", players: [] });
    this.log(`房间 ${roomId} 已重置`);
    this.sendRoomStatus();
  }

  private tickGames(): void {
    for (let roomId = 1; roomId <= this.config.roomCount; roomId++) {
      try {
        if (!this.isRoomReady(roomId)) continue;
        const state = this.getState(roomId);
        const count = this.roomPlayers(roomId).length;
        const min = this.config.minPlayers ?? 2;
        if (state.phase === "idle" && count >= min) {
          this.startPending(roomId);
        } else if (state.phase === "pending" && count < min) {
          state.phase = "idle";
          state.pendingDeadlineTick = undefined;
          this.announce(roomId, "§7等待玩家就位…");
        } else if (state.phase === "pending") {
          const fullDelay = this.config.startFullShortenTicks ?? 100;
          if (
            !this.partyMode &&
            count >= this.config.maxPlayers &&
            (state.pendingDeadlineTick ?? system.currentTick) -
              system.currentTick >
              fullDelay
          ) {
            state.pendingDeadlineTick = system.currentTick + fullDelay;
            this.announce(
              roomId,
              `§e已满员,${Math.round(fullDelay / 20)} 秒后开始`,
            );
          }
          if (
            state.pendingDeadlineTick !== undefined &&
            system.currentTick >= state.pendingDeadlineTick
          ) {
            this.startGame(roomId);
          }
        } else if (state.phase === "running" && count < min) {
          this.endGame(roomId, "玩家离开");
        }

        if (
          (state.phase === "idle" && count > 0) ||
          state.phase === "pending"
        ) {
          this.updatePendingActionbars(roomId, state, count);
        }
      } catch (error) {
        this.log(`房间 ${roomId} 状态机异常`, error);
      }
    }
  }

  private updatePendingActionbars(
    roomId: number,
    state: RoomState,
    count: number,
  ): void {
    const total = this.config.maxPlayers;
    for (const player of this.roomPlayers(roomId)) {
      if (state.phase === "pending" && state.pendingDeadlineTick !== undefined) {
        const remain = Math.max(
          0,
          Math.ceil(
            (state.pendingDeadlineTick - system.currentTick) / 20,
          ),
        );
        player.onScreenDisplay.setActionBar(
          `§e目前人数 ${count}/${total} | 开局倒计时 ${remain} 秒`,
        );
      } else {
        player.onScreenDisplay.setActionBar(
          `§e目前人数 ${count}/${total} | 等待更多玩家`,
        );
      }
    }
  }

  private effectiveStartDelay(): number {
    return this.partyMode
      ? (this.config.partyStartDelayTicks ?? 60 * 20)
      : (this.config.startDelayTicks ?? 40);
  }

  setPartyMode(enabled: boolean): void {
    if (this.partyMode === enabled) return;
    this.partyMode = enabled;
    const delay = this.effectiveStartDelay();
    for (const state of this.states.values()) {
      if (state.phase === "pending") {
        state.pendingDeadlineTick = system.currentTick + delay;
      }
    }
    this.log(
      `派对模式${enabled ? "开启" : "关闭"},开局倒计时 ${Math.round(delay / 20)} 秒`,
    );
  }

  forceStopInDimension(dimensionId: string): boolean {
    const roomId = this.roomIdFromDimension(dimensionId);
    if (!roomId) return false;
    const state = this.getState(roomId);
    if (state.phase !== "running" && state.phase !== "pending") return false;
    system.run(() => this.endGame(roomId, "强制中断"));
    return true;
  }

  /** 配置变更后重新向 Core 注册(更新 prepSpawn 等运行时字段) */
  resendRegister(): void {
    this.sendGameRegister();
  }

  /** 从模板重新复制场地到指定房间(每回合重置用) */
  async resetRoom(roomId: number): Promise<void> {
    await this.resetRoomsFromTemplate([roomId]);
  }

  // ================= Core 上报 =================

  getReportStatus(
    roomId: number,
  ): "idle" | "running" | "initializing" {
    if (!this.isRoomReady(roomId)) return "initializing";
    const phase = this.getState(roomId).phase;
    if (phase === "running" || phase === "pending") return "running";
    if (phase === "resetting") return "initializing";
    return "idle";
  }

  private sendGameRegister(): void {
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
            partyAvailable: this.config.partyAvailable ?? false,
            prepSpawn: this.config.prepSpawn,
          },
        }),
      );
      this.log("已向 Core 注册游戏信息");
    } catch (error) {
      this.log("注册消息发送失败", error);
    }
  }

  private sendRoomStatus(): void {
    try {
      const rooms: { id: number; players: number; status: string }[] = [];
      for (let roomId = 1; roomId <= this.config.roomCount; roomId++) {
        rooms.push({
          id: roomId,
          players: this.roomPlayers(roomId).length,
          status: this.getReportStatus(roomId),
        });
      }
      system.sendScriptEvent(
        this.config.ipcChannel ?? "bearcade:ipc",
        JSON.stringify({
          op: "room.status",
          packId: this.config.packId,
          payload: { game: this.config.gameId, rooms },
        }),
      );
    } catch (error) {
      this.log("状态上报失败", error);
    }
  }

  // ================= 生命周期入口 =================

  initWorld(): void {
    if (this.started) return;
    this.started = true;
    this.loadPersistedTemplateBounds();
    this.loadDebugState();
    this.sendGameRegister();
    void this.initRooms();
    system.runInterval(
      () => this.tickGames(),
      this.config.gameTickInterval ?? 10,
    );
    system.runInterval(
      () => this.sendRoomStatus(),
      this.config.heartbeatInterval ?? 100,
    );
  }

  initEvents(): void {
    // Core 指令路由(game.tp / game.apply / game.quit)
    system.afterEvents.scriptEventReceive.subscribe((event) => {
      this.handleIpc(event);
    });

    // 房间维度内禁止破坏方块
    world.beforeEvents.playerBreakBlock.subscribe((event) => {
      const roomId = this.roomIdFromDimension(event.block.dimension.id);
      if (roomId === undefined) return;
      if (this.hooks.canBreak?.(event, roomId) ?? false) return;
      event.cancel = true;
    });
    // 放置方块:由玩法钩子决定是否放行,默认全部取消
    world.beforeEvents.playerPlaceBlock.subscribe((event) => {
      const roomId = this.roomIdFromDimension(event.block.dimension.id);
      if (roomId === undefined) return;
      if (this.hooks.canPlace?.(event, roomId) ?? false) return;
      event.cancel = true;
    });
  }
}
