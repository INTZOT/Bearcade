import {
  system,
  world,
  Player,
  ScriptEventSource,
  type DimensionRegistry,
  type ScriptEventCommandMessageAfterEvent,
} from "@minecraft/server";
import { CustomForm, ObservableString } from "@minecraft/server-ui";
import type { MinigameConfig, MinigameHooks } from "./types";
import { CORE_PACK_ID, type Vec3 } from "./types";

type Phase = "idle" | "pending" | "running" | "resetting";

interface RoomState {
  phase: Phase;
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
      try {
        event.dimensionRegistry.registerCustomDimension(
          this.roomDimensionId(roomId),
        );
      } catch (error) {
        this.log(`房间维度 ${roomId} 注册失败(可能已注册)`, error);
      }
    }
    try {
      event.dimensionRegistry.registerCustomDimension(
        this.templateDimensionId(),
      );
    } catch (error) {
      this.log("模板维度注册失败(可能已注册)", error);
    }

    this.log(
      `已注册 ${this.config.roomCount} 个房间维度与模板维度`,
    );
  }

  // ================= Core 指令路由(经 IPC 下发) =================

  private handleIpc(event: ScriptEventCommandMessageAfterEvent): void {
    if (event.id !== (this.config.ipcChannel ?? "bearcade:ipc")) return;

    // 来源过滤:只响应 Core 脚本模块下发的指令。
    // 玩家 /scriptevent(Entity+player)、命令方块(Block)、NPC 对话(NPCDialogue)
    // 一律丢弃;信封 packId 必须等于 Core 的 header UUID,防止伪造指令
    // (如 game.tp 传送任意玩家、game.quit 强制中止、game.apply 重置全部房间)。
    if (
      event.sourceType === ScriptEventSource.Block ||
      event.sourceType === ScriptEventSource.NPCDialogue ||
      (event.sourceType === ScriptEventSource.Entity &&
        event.sourceEntity?.typeId === "minecraft:player")
    ) {
      return;
    }

    let envelope: { op?: unknown; packId?: unknown; payload?: unknown };
    try {
      envelope = JSON.parse(event.message) as {
        op?: unknown;
        packId?: unknown;
        payload?: unknown;
      };
    } catch {
      return;
    }
    if (!envelope || typeof envelope.op !== "string") return;
    if (envelope.packId !== CORE_PACK_ID) return;

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
        void this.applyTemplateToAllRooms(
          typeof payload.playerId === "string" ? payload.playerId : undefined,
        );
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
    const delay = this.effectiveStartDelay();
    for (const state of this.states.values()) {
      if (state.phase === "pending") {
        state.pendingDeadlineTick = system.currentTick + delay;
      }
    }
    this.log(
      `调试日志已${enabled ? "开启" : "关闭"},开局倒计时 ${Math.round(delay / 20)} 秒`,
    );
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

  private async applyTemplateToAllRooms(playerId?: string): Promise<void> {
    const roomIds = Array.from(
      { length: this.config.roomCount },
      (_, index) => index + 1,
    );
    // 运行中/倒计时中的房间禁止应用模板,防止替换正在对局的场地
    const active = roomIds.filter((roomId) => {
      const phase = this.getState(roomId).phase;
      return phase === "running" || phase === "pending";
    });
    if (active.length > 0) {
      this.log(`应用模板被拒绝:房间 ${active.join(",")} 有进行中的对局`);
      const player = playerId
        ? world.getAllPlayers().find((p) => p.id === playerId)
        : undefined;
      player?.sendMessage(
        `§c应用模板被拒绝:房间 ${active.join("、")} 有进行中的对局,请先结束再重试`,
      );
      return;
    }
    try {
      await this.resetRoomsFromTemplate(roomIds);
      // 应用模板后全部房间场地就绪(含此前初始化失败的房间,提供修复路径)。
      // 同时把停留在 resetting 的房间状态恢复为 idle,否则失败重置经 ap 修复后仍永远显示初始化中。
      for (const roomId of roomIds) {
        this.ready.set(roomId, true);
        this.states.set(roomId, { phase: "idle" });
      }
      this.log("已应用模板到全部房间");
    } catch (error) {
      this.log("应用模板失败", error);
      const player = playerId
        ? world.getAllPlayers().find((p) => p.id === playerId)
        : undefined;
      player?.sendMessage("§c应用模板失败,详情见内容日志");
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
      z2 - z1 + 1 > 64 ||
      // 常加载区固定为 y −1~65:模板 y 范围必须与之相交,
      // 否则场地内容(如高架平台)不在常加载区内,区块可能被卸载
      y2 < -1 ||
      y1 > 65
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
          "§c范围不合法:需在 y -64~320 内、尺寸不超过 64×384×64,且 y 范围必须与常加载区(-1~65)相交",
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

  /** 是否存在进行中(运行/倒计时)的对局,供"对局中禁止修改配置"守卫使用 */
  hasActiveGame(): boolean {
    for (const state of this.states.values()) {
      if (state.phase === "running" || state.phase === "pending") return true;
    }
    return false;
  }

  // ================= 房间初始化与重置 =================

  private getState(roomId: number): RoomState {
    let state = this.states.get(roomId);
    if (!state) {
      state = { phase: "idle" };
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
    await this.enqueueReset(async () => {
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
    });
  }

  /**
   * 模板捕获/放置串行队列:所有"删除结构 → 重建结构 → 放置"流程排入同一队列,
   * 防止并发重置(多房间同时结束、apply 与重置并发)互相删除/重建同一组结构 ID。
   */
  private resetChain: Promise<void> = Promise.resolve();

  private enqueueReset(task: () => Promise<void>): Promise<void> {
    const run = this.resetChain.then(task, task);
    this.resetChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** 确保房间游玩区有常加载区域(ap 修复缺失常加载区的房间时使用;已存在则不动) */
  private async ensureRoomTickingArea(roomId: number): Promise<void> {
    const dim = this.roomDim(roomId);
    const areaId = this.tickingAreaId(roomId);
    if (!world.tickingAreaManager.hasTickingArea(areaId)) {
      await world.tickingAreaManager.createTickingArea(areaId, {
        dimension: dim,
        from: this.config.tickingFrom,
        to: this.config.tickingTo,
      });
    }
  }

  private async resetRoomsFromTemplate(roomIds: number[]): Promise<void> {
    await this.enqueueReset(async () => {
      const tiles = await this.captureTemplateTiles();
      for (const roomId of roomIds) {
        const dim = this.roomDim(roomId);
        await this.ensureRoomTickingArea(roomId);
        // 注意:模板范围变更(移动/改尺寸)导致的旧场地残留不再自动清理,
        // 由开发者在模板维度人工处理(重建房间场地后 ap 覆盖)。
        this.placeTiles(dim, tiles);
      }
    });
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
    try {
      this.hooks.onGameStart?.(roomId, players);
    } catch (error) {
      this.log(`房间 ${roomId} 开局钩子异常`, error);
      this.endGame(roomId, "开局失败", "§c开局初始化失败,即将返回大厅…");
    }
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
    try {
      this.hooks.onBeforeReset?.(roomId);
    } catch (error) {
      this.log(`房间 ${roomId} 结算清理钩子异常(继续送玩家回大厅)`, error);
    }

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

    // 场地重置失败时重试一次;仍失败则保持"未就绪"(上报 initializing),
    // 由管理员执行 /bearcade:tmp ap 修复,避免出现"场地未就绪却显示空闲可加入"
    let resetOk = false;
    for (let attempt = 1; attempt <= 2 && !resetOk; attempt++) {
      try {
        await this.resetRoomsFromTemplate([roomId]);
        resetOk = true;
      } catch (error) {
        this.log(`房间 ${roomId} 场地重置失败(第 ${attempt} 次)`, error);
      }
    }
    if (!resetOk) {
      this.ready.set(roomId, false);
      this.log(
        `房间 ${roomId} 重置失败,保持初始化中;请执行 /bearcade:tmp ap ${this.config.gameId} 修复`,
      );
      this.sendRoomStatus();
      return;
    }
    try {
      this.hooks.onRoomReset?.(roomId);
    } catch (error) {
      this.log(`房间 ${roomId} 重置后钩子异常`, error);
    }
    this.ready.set(roomId, true);
    this.states.set(roomId, { phase: "idle" });
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
        } else if (
          state.phase === "running" &&
          count < min &&
          (this.config.endGameWhenBelowMin ?? true)
        ) {
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
    if (this.partyMode) {
      return this.config.partyStartDelayTicks ?? 60 * 20;
    }
    if (this.debugEnabled) {
      return this.config.debugStartDelayTicks ?? 10 * 20;
    }
    return this.config.startDelayTicks ?? 60 * 20;
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
    // 准备倒计时(pending)仍视为空闲,允许其他玩家继续加入
    if (phase === "running") return "running";
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
            minPlayers: this.config.minPlayers ?? 2,
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
