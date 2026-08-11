import {
  system,
  world,
  Player,
  CustomCommandStatus,
  CommandPermissionLevel,
  type CustomCommandRegistry,
  type DimensionRegistry,
} from "@minecraft/server";
import type { MinigameConfig, MinigameHooks } from "./types";

type Phase = "idle" | "pending" | "running" | "resetting";

interface RoomState {
  phase: Phase;
  players: string[];
  pendingRunId?: number;
}

interface StartupContext {
  dimensionRegistry: DimensionRegistry;
  customCommandRegistry: CustomCommandRegistry;
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
    event.dimensionRegistry.registerCustomDimension(
      this.templateDimensionId(),
    );

    // 开发命令:进入模板维度
    event.customCommandRegistry.registerCommand(
      {
        name: `bearcade:${this.config.gameId}`,
        description: "开发用:进入模板维度制作场地",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || !(player instanceof Player)) {
          return {
            status: CustomCommandStatus.Failure,
            message: "该命令只能由玩家执行",
          };
        }
        system.run(() => {
          const dimension = world.getDimension(this.templateDimensionId());
          player.teleport(this.config.templateSpawn, { dimension });
        });
        return {
          status: CustomCommandStatus.Success,
          message: `已传送至模板维度 ${this.templateDimensionId()}`,
        };
      },
    );

    // 强制中止命令
    event.customCommandRegistry.registerCommand(
      {
        name: `bearcade:${this.config.gameId}_stop`,
        description: "强制中断当前维度运行中的对局",
        permissionLevel: CommandPermissionLevel.Admin,
        cheatsRequired: false,
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || !(player instanceof Player)) {
          return {
            status: CustomCommandStatus.Failure,
            message: "该命令只能由玩家执行",
          };
        }
        if (!this.forceStopInDimension(player.dimension.id)) {
          return {
            status: CustomCommandStatus.Failure,
            message: "当前维度没有运行中的对局",
          };
        }
        return {
          status: CustomCommandStatus.Success,
          message: "已强制中断当前对局",
        };
      },
    );

    this.log(
      `已注册 ${this.config.roomCount} 个房间维度与模板维度`,
    );
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
    player.teleport(location, { dimension: this.roomDim(roomId) });
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

  private async ensureTemplateStructure() {
    const templateDim = world.getDimension(this.templateDimensionId());
    const templateAreaId = this.tickingAreaId("template");
    if (!world.tickingAreaManager.hasTickingArea(templateAreaId)) {
      await world.tickingAreaManager.createTickingArea(templateAreaId, {
        dimension: templateDim,
        from: this.config.tickingFrom,
        to: this.config.tickingTo,
      });
    }

    let structure = world.structureManager.get(this.config.structureId);
    if (structure) {
      const expectedSize = {
        x: this.config.templateTo.x - this.config.templateFrom.x + 1,
        y: this.config.templateTo.y - this.config.templateFrom.y + 1,
        z: this.config.templateTo.z - this.config.templateFrom.z + 1,
      };
      const size = structure.size;
      if (
        size.x !== expectedSize.x ||
        size.y !== expectedSize.y ||
        size.z !== expectedSize.z
      ) {
        world.structureManager.delete(this.config.structureId);
        structure = undefined;
        this.log("模板结构尺寸变化,重新捕获");
      }
    }
    if (!structure) {
      structure = world.structureManager.createFromWorld(
        this.config.structureId,
        templateDim,
        this.config.templateFrom,
        this.config.templateTo,
      );
      this.log(`已捕获模板结构 ${this.config.structureId}`);
    }
    return structure;
  }

  private tickingAreaId(roomId: number | "template"): string {
    return `bearcade:ta_${this.config.gameId}_${roomId}`;
  }

  private async initRoom(roomId: number, structureId: string): Promise<void> {
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
    world.structureManager.place(structureId, dim, this.config.roomCopyOrigin);
    this.ready.set(roomId, true);
    this.log(`房间 ${roomId} 场地就绪`);
  }

  private async initRooms(): Promise<void> {
    try {
      const structure = await this.ensureTemplateStructure();
      for (let roomId = 1; roomId <= this.config.roomCount; roomId++) {
        try {
          await this.initRoom(roomId, structure.id);
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
    if (world.structureManager.get(this.config.structureId)) {
      world.structureManager.delete(this.config.structureId);
    }
    const templateDim = world.getDimension(this.templateDimensionId());
    const structure = world.structureManager.createFromWorld(
      this.config.structureId,
      templateDim,
      this.config.templateFrom,
      this.config.templateTo,
    );
    for (const roomId of roomIds) {
      const dim = this.roomDim(roomId);
      world.structureManager.place(structure.id, dim, this.config.roomCopyOrigin);
    }
  }

  // ================= 对局状态机 =================

  private cancelPending(state: RoomState): void {
    if (state.pendingRunId !== undefined) {
      system.clearRun(state.pendingRunId);
      state.pendingRunId = undefined;
    }
  }

  private startPending(roomId: number): void {
    const state = this.getState(roomId);
    if (state.phase !== "idle") return;
    state.phase = "pending";
    state.pendingRunId = system.runTimeout(
      () => this.startGame(roomId),
      this.config.startDelayTicks ?? 40,
    );
    this.announce(roomId, "§e两名玩家已就位,对局即将开始…");
  }

  private startGame(roomId: number): void {
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
  endGame(roomId: number, reason: string, message?: string): void {
    const state = this.getState(roomId);
    if (state.phase === "resetting") return;
    this.cancelPending(state);
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
        if (state.phase === "idle" && count >= 2) {
          this.startPending(roomId);
        } else if (state.phase === "pending" && count < 2) {
          this.cancelPending(state);
          state.phase = "idle";
          this.announce(roomId, "§7等待玩家就位…");
        } else if (state.phase === "running" && count < 2) {
          this.endGame(roomId, "玩家离开");
        }
      } catch (error) {
        this.log(`房间 ${roomId} 状态机异常`, error);
      }
    }
  }

  forceStopInDimension(dimensionId: string): boolean {
    const roomId = this.roomIdFromDimension(dimensionId);
    if (!roomId) return false;
    const state = this.getState(roomId);
    if (state.phase !== "running" && state.phase !== "pending") return false;
    system.run(() => this.endGame(roomId, "强制中断"));
    return true;
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
    // 房间维度内禁止破坏方块
    world.beforeEvents.playerBreakBlock.subscribe((event) => {
      if (this.roomIdFromDimension(event.block.dimension.id) !== undefined) {
        event.cancel = true;
      }
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
