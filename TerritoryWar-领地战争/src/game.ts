// ============================================================
// 领地战争(TerritoryWar)玩法实现
//
// 规则(源自《围城大作战》/ Surround.io):
// - 以自己的领地为起点向外移动,身后留下一串尾迹;
// - 回到自己的领土时,尾迹 + 领土围住的区域(含圈到的他人领土)全部归自己;
// - 踩到别人的尾迹 = 切断对方路线 = 击杀对方(对方领土清零并复活);
// - 限时对局,时间到按领土占比排名;占比达到目标可提前结束。
//
// 实现要点:
// - 场地 = 边长 N 的方块网格,每格 1 个方块,领土/尾迹各用一种方块渲染;
// - 每 2 tick 采样一次玩家所在格,跨格时逐格补线(对角也不会漏格);
// - 圈地 = 从场地四边向内洪水填充,漫不到的封闭区域即本次圈到的地;
// - 只在"回到自己领土"这一刻触发结算,单格进出不产地面(防贴边蹭地)。
// ============================================================
import {
  GameMode,
  system,
  world,
  type Player,
  type RawMessage,
} from "@minecraft/server";
import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import {
  clearHudTitle,
  ensureObjective as ensureHudObjective,
  hudMessage,
  releaseObjective,
  scoreToken,
  setHudTitle,
  setObjectiveScore,
} from "../../shared/minigame-core/scoreboardHud";
import { clearAllPlayerItems } from "../../shared/minigame-core/playerItems";
import { stripSectionCodes } from "../../shared/minigame-core/text";
import { PLAYER_COLORS } from "./config";
import {
  NEUTRAL,
  applyOwnership,
  cellAt,
  cellCount,
  cellStand,
  centerCell,
  clampFieldSize,
  clampPlotSize,
  computeCapture,
  createField,
  fieldOrigin,
  findFreePlot,
  isPlotFree,
  paintCell,
  paintFieldNeutral,
  plotCells,
  plotCenterCell,
  clampPlotTopLeft,
  releaseTerritory,
  repaintCell,
  territoryBlock,
  territoryPercent,
  trailBlock,
  type FieldState,
} from "./field";
import {
  getTerritoryWarConfig,
  openTerritoryWarConfig,
} from "./territory-war-config";

// ================= 会话状态 =================

interface PlayerState {
  id: string;
  /** 剥离 § 格式码后的玩家名(公告/HUD 用) */
  name: string;
  /** 颜色槽(0..PLAYER_COLORS.length-1) */
  index: number;
  /** 拖出中的尾迹格(按行进顺序) */
  trail: number[];
  /** 上一次采样到的格(用于补线) */
  lastCell: number;
  alive: boolean;
  /** 复活时刻(0 = 不复活的淘汰状态) */
  respawnTick: number;
  kills: number;
  deaths: number;
}

interface Session {
  field: FieldState;
  players: Map<string, PlayerState>;
  /** 颜色槽 → 玩家状态 */
  byIndex: (PlayerState | undefined)[];
  /** 颜色已满、本局只能旁观的玩家(避免每 tick 重复提示) */
  rejected: Set<string>;
  endTick: number;
  ended: boolean;
  tickCounter: number;
}

const sessions = new Map<number, Session>();

/** HUD 刷新间隔(2 tick 主循环 × 10 = 每 20 tick 一次) */
const HUD_REFRESH_STEPS = 10;

// ================= 工具 =================

function objectiveId(roomId: number): string {
  return `bearcade:territory_war_${roomId}`;
}

function scoreEntry(roomId: number, index: number): string {
  return `tw${roomId}_${index}`;
}

function colorOf(index: number) {
  return PLAYER_COLORS[index] ?? PLAYER_COLORS[0];
}

function shortName(name: string): string {
  return name.length > 10 ? `${name.slice(0, 9)}..` : name;
}

function findPlayer(
  runtime: MinigameRuntime,
  roomId: number,
  id: string,
): Player | undefined {
  return runtime.roomPlayers(roomId).find((player) => player.id === id);
}

/** 按当前配置构造场地模型(几何以配置为准,方块写入由调用方负责) */
function makeField(): FieldState {
  const cfg = getTerritoryWarConfig();
  const size = clampFieldSize(cfg.fieldSize);
  return createField(
    size,
    fieldOrigin(cfg.centerX, size),
    fieldOrigin(cfg.centerZ, size),
    Math.floor(cfg.fieldY),
  );
}

function respawnTicks(): number {
  return Math.max(0, Math.round(getTerritoryWarConfig().respawnSeconds * 20));
}

function plotSize(): number {
  return clampPlotSize(getTerritoryWarConfig().startPlotSize);
}

// ================= 效果 =================

function applyAuras(player: Player): void {
  const cfg = getTerritoryWarConfig();
  try {
    if (cfg.speedAmplifier > 0) {
      player.addEffect("speed", 60, {
        amplifier: Math.min(3, Math.max(0, Math.round(cfg.speedAmplifier))),
        showParticles: false,
      });
    }
    // 长时间不吃东西,避免饥饿干扰走位
    player.addEffect("saturation", 100, {
      amplifier: 0,
      showParticles: false,
    });
    // 自定义维度没有可靠照明,夜视保证 41×41 的颜色块都看得清
    player.addEffect("night_vision", 200, {
      amplifier: 0,
      showParticles: false,
    });
  } catch {
    // 玩家可能刚好断线
  }
}

// ================= 领地 / 尾迹清理 =================

/** 清掉某玩家在场上的尾迹归属与全部领土(不负责传送/播报) */
function clearOwnership(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
  st: PlayerState,
): void {
  const field = session.field;
  const dimension = runtime.roomDim(roomId);
  for (const cell of st.trail) {
    field.trailOwner[cell] = NEUTRAL;
    repaintCell(dimension, field, cell);
  }
  st.trail = [];
  const released = releaseTerritory(field, st.index);
  for (const cell of released) {
    repaintCell(dimension, field, cell);
  }
}

// ================= 出生 =================

/** 把一块 plotSize×plotSize 空地划给玩家并传送过去 */
function claimPlot(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
  st: PlayerState,
  topLeft: number,
): void {
  const field = session.field;
  const dimension = runtime.roomDim(roomId);
  const size = plotSize();
  const cells = plotCells(field, topLeft, size);
  applyOwnership(field, st.index, cells);
  for (const cell of cells) {
    // 正常情况下出生地块是空地;若上面压着别人的尾迹,保留尾迹外观
    repaintCell(dimension, field, cell);
    if (field.trailOwner[cell] === NEUTRAL) {
      paintCell(dimension, field, cell, territoryBlock(st.index));
    }
  }
  st.lastCell = plotCenterCell(field, topLeft, size);
  st.alive = true;
  st.respawnTick = 0;

  const player = findPlayer(runtime, roomId, st.id);
  if (!player) return;
  try {
    runtime.teleportPlayer(roomId, player, cellStand(field, st.lastCell));
  } catch (error) {
    console.warn("[Bearcade territory_war] 出生传送失败", error);
  }
  applyAuras(player);
}

/** 开局按等分圆给每人一个不重叠的出生格 */
function startPlotTopLeft(
  field: FieldState,
  index: number,
  count: number,
): number {
  const size = plotSize();
  const radius = Math.max(size, Math.floor(field.size * 0.33));
  const angle = (index / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2;
  const centerX = Math.floor(field.size / 2 + Math.cos(angle) * radius);
  const centerZ = Math.floor(field.size / 2 + Math.sin(angle) * radius);
  const ring = clampPlotTopLeft(field, centerX, centerZ, size);
  if (isPlotFree(field, ring, size)) return ring;
  return findFreePlot(field, size, Math.random) ?? ring;
}

// ================= 玩家登记 =================

function registerPlayer(
  session: Session,
  player: Player,
  index: number,
): PlayerState {
  const st: PlayerState = {
    id: player.id,
    name: stripSectionCodes(player.name),
    index,
    trail: [],
    lastCell: -1,
    alive: false,
    respawnTick: 0,
    kills: 0,
    deaths: 0,
  };
  session.players.set(player.id, st);
  session.byIndex[index] = st;
  return st;
}

function freeColorIndex(session: Session): number | undefined {
  for (let index = 0; index < PLAYER_COLORS.length; index++) {
    if (!session.byIndex[index]) return index;
  }
  return undefined;
}

/** 房间内玩家与对局玩家对齐:新进补登记,离场回收领地 */
function syncPlayers(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  const present = runtime.roomPlayers(roomId);
  const ids = new Set(present.map((player) => player.id));

  for (const [id, st] of [...session.players]) {
    if (ids.has(id)) continue;
    clearOwnership(runtime, roomId, session, st);
    session.players.delete(id);
    if (session.byIndex[st.index] === st) session.byIndex[st.index] = undefined;
    runtime.announce(roomId, `§7${st.name} 离开了对局,其领地已回收`);
  }
  // 离场的旁观者不再占着"已拒绝"名单;有颜色空出来时也让仍在场的人重新排队
  for (const id of [...session.rejected]) {
    if (!ids.has(id) || freeColorIndex(session) !== undefined) {
      session.rejected.delete(id);
    }
  }

  for (const player of present) {
    if (session.players.has(player.id) || session.rejected.has(player.id)) {
      continue;
    }
    const index = freeColorIndex(session);
    if (index === undefined) {
      session.rejected.add(player.id);
      player.sendMessage("§7房间颜色已满,本局旁观");
      continue;
    }
    const st = registerPlayer(session, player, index);
    const topLeft = findFreePlot(session.field, plotSize(), Math.random);
    if (topLeft === undefined) {
      st.respawnTick = system.currentTick + 20;
      player.sendMessage("§e场上暂时没有空位,等待下一块空地…");
      continue;
    }
    claimPlot(runtime, roomId, session, st, topLeft);
    player.sendMessage(
      `§e你加入了进行中的对局,颜色:${colorOf(index).code}${colorOf(index).name}§e`,
    );
  }
}

// ================= 尾迹 / 圈地 =================

/**
 * 一次跨格移动逐格处理(对角移动补成 L 形,避免漏格导致封闭区域漏气)。
 * 返回逐格顺序的格子索引。
 */
function pathCells(field: FieldState, from: number, to: number): number[] {
  const size = field.size;
  if (from < 0) return [to];
  const fx = from % size;
  const fz = Math.floor(from / size);
  const tx = to % size;
  const tz = Math.floor(to / size);
  const dx = tx - fx;
  const dz = tz - fz;
  // 位移过大视为传送(复活/被拉回),不拖出长线
  if (Math.abs(dx) > 3 || Math.abs(dz) > 3) return [to];
  const sx = Math.sign(dx);
  const sz = Math.sign(dz);
  const cells: number[] = [];
  let x = fx;
  let z = fz;
  let guard = 0;
  while ((x !== tx || z !== tz) && guard < 16) {
    if (x !== tx) x += sx;
    else z += sz;
    cells.push(z * size + x);
    guard++;
  }
  return cells;
}

/** 收回尾迹(未圈到地时原样退回) */
function revertTrail(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
  st: PlayerState,
): void {
  const field = session.field;
  const dimension = runtime.roomDim(roomId);
  for (const cell of st.trail) {
    field.trailOwner[cell] = NEUTRAL;
    repaintCell(dimension, field, cell);
  }
  st.trail = [];
}

/** 回到自己领土:结算本次圈地 */
function closeTrail(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
  st: PlayerState,
): void {
  const field = session.field;
  const dimension = runtime.roomDim(roomId);
  const cells = computeCapture(field, st.index, st.trail);
  if (cells.length === 0) {
    // 没有围出封闭区域:尾迹撤回,不给地(防止贴边一格一格蹭面积)
    revertTrail(runtime, roomId, session, st);
    return;
  }

  // 先清掉自己的尾迹归属,再统一改归属并重画
  for (const cell of st.trail) field.trailOwner[cell] = NEUTRAL;
  const result = applyOwnership(field, st.index, cells);
  for (const cell of cells) {
    const otherTrail = field.trailOwner[cell];
    paintCell(
      dimension,
      field,
      cell,
      otherTrail !== NEUTRAL
        ? trailBlock(otherTrail - 1)
        : territoryBlock(st.index),
    );
  }
  st.trail = [];

  const player = findPlayer(runtime, roomId, st.id);
  if (player) {
    try {
      dimension.playSound("random.orb", player.location);
    } catch {
      // 声音失败不影响玩法
    }
    try {
      player.onScreenDisplay.setActionBar(
        `§a+${result.captured} 格${result.stolen > 0 ? ` §c(抢占 ${result.stolen} 格)` : ""} · 占比 ${territoryPercent(field, st.index)}%`,
      );
    } catch {
      // 忽略
    }
  }
  if (result.stolen > 0) {
    runtime.announce(
      roomId,
      `§e${colorOf(st.index).code}${st.name}§e 圈走了 ${result.stolen} 格别人的领土!`,
    );
  }
}

/** 击杀(或淘汰)一名玩家:清空领土与尾迹,送回准备区等待复活 */
function killPlayer(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
  st: PlayerState,
  killer: PlayerState | undefined,
  reason: string,
): void {
  if (!st.alive) return;
  st.alive = false;
  st.deaths++;
  clearOwnership(runtime, roomId, session, st);
  if (killer) killer.kills++;

  const cfg = getTerritoryWarConfig();
  st.respawnTick =
    cfg.respawnSeconds > 0 ? system.currentTick + respawnTicks() : 0;

  const player = findPlayer(runtime, roomId, st.id);
  const color = colorOf(st.index);
  if (player) {
    try {
      runtime.teleportPlayer(roomId, player, cfg.prepSpawn);
    } catch (error) {
      console.warn("[Bearcade territory_war] 淘汰传送失败", error);
    }
    try {
      const cause = killer ? "你的尾迹被切断" : `你${reason}`;
      player.sendMessage(
        cfg.respawnSeconds > 0
          ? `§c${cause},领土清零!§e${Math.round(cfg.respawnSeconds)} 秒后在随机空地复活`
          : `§c${cause},已淘汰!`,
      );
    } catch {
      // 忽略
    }
    try {
      runtime.roomDim(roomId).playSound("random.anvil_land", player.location);
    } catch {
      // 忽略
    }
  }

  if (killer) {
    const killerColor = colorOf(killer.index);
    runtime.announce(
      roomId,
      `§c${color.code}${st.name}§c 的尾迹被 ${killerColor.code}${killer.name}§c 切断,领土清零!`,
    );
    const killerPlayer = findPlayer(runtime, roomId, killer.id);
    try {
      killerPlayer?.sendMessage(
        `§a击杀 ${color.code}${st.name}§a!累计击杀 ${killer.kills}`,
      );
    } catch {
      // 忽略
    }
  } else {
    runtime.announce(roomId, `§c${color.code}${st.name}§c ${reason},领土清零!`);
  }
}

/** 复活:找一块空地重开 */
function respawnPlayer(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
  st: PlayerState,
): void {
  const topLeft = findFreePlot(session.field, plotSize(), Math.random);
  if (topLeft === undefined) {
    st.respawnTick = system.currentTick + 20;
    return;
  }
  claimPlot(runtime, roomId, session, st, topLeft);
  runtime.announce(
    roomId,
    `§a${colorOf(st.index).code}${st.name}§a 复活,重新开始圈地`,
  );
}

// ================= 移动采样 =================

/** 处理玩家进入的一格:踩尾迹击杀 / 拖尾迹 / 回自己领土结算 */
function stepCell(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
  st: PlayerState,
  cell: number,
): void {
  const field = session.field;
  const me = st.index + 1;

  if (field.owner[cell] === me) {
    if (st.trail.length > 0) closeTrail(runtime, roomId, session, st);
    return;
  }

  const cutOwner = field.trailOwner[cell];
  if (cutOwner === me) return;
  if (cutOwner !== NEUTRAL) {
    const victim = session.byIndex[cutOwner - 1];
    if (victim && victim.alive) {
      killPlayer(runtime, roomId, session, victim, st, "尾迹被切断");
    }
  }

  field.trailOwner[cell] = me;
  st.trail.push(cell);
  paintCell(runtime.roomDim(roomId), field, cell, trailBlock(st.index));
}

function stepPlayer(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
  player: Player,
  st: PlayerState,
): void {
  const field = session.field;
  const location = player.location;
  // 掉出场地(理论上屏障会挡住,兜底按死亡处理)
  if (location.y < field.y - 2) {
    killPlayer(runtime, roomId, session, st, undefined, "掉出场地");
    return;
  }

  const cell = cellAt(field, Math.floor(location.x), Math.floor(location.z));
  if (cell === undefined) {
    // 越界:送回上一格,避免拖出场地外的尾迹
    const back = st.lastCell >= 0 ? st.lastCell : centerCell(field);
    try {
      runtime.teleportPlayer(roomId, player, cellStand(field, back));
    } catch {
      // 忽略
    }
    st.lastCell = back;
    return;
  }
  if (cell === st.lastCell) return;

  for (const next of pathCells(field, st.lastCell, cell)) {
    stepCell(runtime, roomId, session, st, next);
  }
  st.lastCell = cell;
}

// ================= 结算 =================

function ranking(session: Session): PlayerState[] {
  const field = session.field;
  return [...session.players.values()].sort((a, b) => {
    const byLand = field.counts[b.index] - field.counts[a.index];
    if (byLand !== 0) return byLand;
    if (b.kills !== a.kills) return b.kills - a.kills;
    return b.deaths - a.deaths;
  });
}

function endMatch(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
  reason: string,
  forcedWinner?: PlayerState,
): void {
  if (session.ended) return;
  session.ended = true;
  const field = session.field;
  const rows = ranking(session);
  const top = forcedWinner ?? rows[0];
  if (!top) {
    runtime.endGame(roomId, reason, "§e对局结束,即将返回大厅…");
    return;
  }
  const lines = rows.slice(0, 3).map((st, i) => {
    const color = colorOf(st.index);
    return `${i + 1}. ${color.code}${st.name}§r §f${field.counts[st.index]} 格 ` +
      `(${territoryPercent(field, st.index)}%) · 击杀 ${st.kills}`;
  });
  runtime.endGame(
    roomId,
    reason,
    `§6=== 领地战争结束(${reason}) ===§r\n` +
      `§e冠军:${colorOf(top.index).code}${top.name}§e,` +
      `领土 ${field.counts[top.index]} 格(${territoryPercent(field, top.index)}%)\n` +
      lines.join("\n") +
      "\n§7即将返回大厅…",
  );
}

function checkEnd(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  if (session.ended) return;
  const field = session.field;
  const cfg = getTerritoryWarConfig();
  const target = Math.max(
    1,
    Math.ceil((cellCount(field) * cfg.winPercent) / 100),
  );
  for (const st of session.players.values()) {
    if (st.alive && field.counts[st.index] >= target) {
      endMatch(
        runtime,
        roomId,
        session,
        `${st.name} 领土占比达到 ${cfg.winPercent}%`,
      );
      return;
    }
  }

  const alive = [...session.players.values()].filter((st) => st.alive);
  const endless = Math.round(cfg.gameDurationSeconds) <= 0;
  if (endless) {
    // 无尽模式:不限时,只剩最后一名存活者即结束(需把复活等待设为 0)
    if (session.players.size >= 2 && alive.length <= 1) {
      endMatch(
        runtime,
        roomId,
        session,
        alive.length === 1 ? `${alive[0].name} 成为最后幸存者` : "全员出局",
        alive[0],
      );
    }
    return;
  }

  if (system.currentTick >= session.endTick) {
    endMatch(runtime, roomId, session, "时间到");
    return;
  }
  if (alive.length === 0) {
    endMatch(runtime, roomId, session, "场上已无存活玩家");
  }
}

// ================= HUD =================

function updateHud(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  const field = session.field;
  const cfg = getTerritoryWarConfig();
  const objective = world.scoreboard.getObjective(objectiveId(roomId));
  if (objective) {
    for (const st of session.players.values()) {
      setObjectiveScore(
        objective,
        scoreEntry(roomId, st.index),
        territoryPercent(field, st.index),
      );
    }
  }

  const endless = session.endTick === Number.MAX_SAFE_INTEGER;
  const remaining = endless
    ? 0
    : Math.max(0, Math.ceil((session.endTick - system.currentTick) / 20));
  const clock = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  const aliveCount = [...session.players.values()].filter((st) => st.alive).length;
  const rows = ranking(session);

  for (const player of runtime.roomPlayers(roomId)) {
    const me = session.players.get(player.id);
    const respawnLeft = me
      ? Math.max(0, Math.ceil((me.respawnTick - system.currentTick) / 20))
      : 0;
    const status = !me
      ? "§7旁观"
      : me.alive
        ? me.trail.length > 0
          ? "§c尾迹暴露"
          : "§a安全"
        : cfg.respawnSeconds > 0
          ? `§7复活中 ${respawnLeft}s`
          : "§8已淘汰";
    const parts: RawMessage[] = [
      { text: "§6领地战争" },
      { text: "\n" },
      {
        text: endless
          ? `§f无尽模式 §7· 存活 ${aliveCount} · ${status}`
          : `§f剩余 ${clock} §7· ${status}`,
      },
    ];
    for (const st of rows) {
      const color = colorOf(st.index);
      parts.push({ text: "\n" });
      parts.push({ text: st.id === player.id ? "§f▶ " : "§7  " });
      parts.push({ text: `${color.code}■ §f${shortName(st.name)} ` });
      if (objective) {
        parts.push(scoreToken(scoreEntry(roomId, st.index), objectiveId(roomId)));
      } else {
        parts.push({ text: String(territoryPercent(field, st.index)) });
      }
      parts.push({ text: "§r%" });
    }
    if (me) {
      parts.push({ text: "\n" });
      parts.push({ text: `§7击杀 ${me.kills} · 死亡 ${me.deaths}` });
    }
    setHudTitle(player, hudMessage(parts), 6000);
  }
}

// ================= 每房间主循环 =================

function tickRoom(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  const now = system.currentTick;
  syncPlayers(runtime, roomId, session);

  for (const player of runtime.roomPlayers(roomId)) {
    const st = session.players.get(player.id);
    if (!st) continue;
    if (!st.alive) {
      if (st.respawnTick > 0 && now >= st.respawnTick) {
        respawnPlayer(runtime, roomId, session, st);
      }
      continue;
    }
    stepPlayer(runtime, roomId, session, player, st);
  }

  session.tickCounter++;
  if (session.tickCounter % HUD_REFRESH_STEPS === 0) {
    for (const player of runtime.roomPlayers(roomId)) {
      if (session.players.has(player.id)) applyAuras(player);
    }
    updateHud(runtime, roomId, session);
  }
  checkEnd(runtime, roomId, session);
}

/** 注册对局主循环与房间保护事件 */
export function initTerritoryWar(
  getRuntime: () => MinigameRuntime,
): void {
  system.runInterval(() => {
    const runtime = getRuntime();
    for (const [roomId, session] of [...sessions]) {
      try {
        if (!runtime.isRunning(roomId)) {
          sessions.delete(roomId);
          continue;
        }
        tickRoom(runtime, roomId, session);
      } catch (error) {
        console.warn(
          `[Bearcade territory_war] 房间 ${roomId} 主循环异常`,
          error,
        );
      }
    }
  }, 2);

  // 对局内禁止一切伤害:击杀只由"切断尾迹"决定,避免互殴抢戏
  world.beforeEvents.entityHurt.subscribe((event) => {
    try {
      const entity = event.hurtEntity;
      if (entity.typeId !== "minecraft:player") return;
      const roomId = getRuntime().roomIdFromDimension(entity.dimension.id);
      if (roomId === undefined) return;
      event.cancel = true;
    } catch {
      // 维度不可读等情况直接放行,不影响其他包
    }
  });
}

// ================= 钩子 =================

export function makeTerritoryWarHooks(
  getRuntime: () => MinigameRuntime,
): MinigameHooks {
  return {
    onGameStart(roomId, players) {
      const runtime = getRuntime();
      const cfg = getTerritoryWarConfig();
      const field = makeField();
      const dimension = runtime.roomDim(roomId);

      // 场地复位:整块刷回中立(一次性 fillBlocks,不逐格写)
      paintFieldNeutral(dimension, field);

      // 时长 0 = 无尽模式:不限时,只剩最后一名存活者才结束
      const durationSeconds = Math.max(0, Math.round(cfg.gameDurationSeconds));
      const session: Session = {
        field,
        players: new Map(),
        byIndex: new Array<PlayerState | undefined>(PLAYER_COLORS.length).fill(
          undefined,
        ),
        rejected: new Set<string>(),
        endTick:
          durationSeconds > 0
            ? system.currentTick + durationSeconds * 20
            : Number.MAX_SAFE_INTEGER,
        ended: false,
        tickCounter: 0,
      };
      sessions.set(roomId, session);
      ensureHudObjective(objectiveId(roomId), "领地战争");

      // 随机分配颜色与出生位置
      const order = [...players];
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }

      let spawned = 0;
      order.forEach((player, index) => {
        if (index >= PLAYER_COLORS.length) {
          session.rejected.add(player.id);
          player.sendMessage("§7房间颜色已满,本局旁观");
          return;
        }
        const st = registerPlayer(session, player, index);
        try {
          player.setGameMode(GameMode.Adventure);
        } catch {
          // 忽略
        }
        clearAllPlayerItems(player);
        clearHudTitle(player);
        const topLeft = startPlotTopLeft(field, index, order.length);
        claimPlot(runtime, roomId, session, st, topLeft);
        spawned++;
        const color = colorOf(index);
        player.sendMessage(
          `§a你是 ${color.code}${color.name}§a 方:从自己的 §f${plotSize()}×${plotSize()}§a 领地出发,` +
            "走出尾迹再回到自己的领土即可圈地;踩到别人的尾迹可以击杀对方。",
        );
      });

      const durationText =
        durationSeconds <= 0
          ? "无尽模式(仅剩最后一人时结束)"
          : durationSeconds >= 60
            ? `${Math.round((durationSeconds / 60) * 10) / 10} 分钟`
            : `${durationSeconds} 秒`;
      runtime.announce(
        roomId,
        `§6=== 领地战争开始 ===§r\n` +
          `§e${spawned} 名玩家 · ${durationText} · ` +
          `领土占比达到 §f${cfg.winPercent}%§e 直接获胜\n` +
          "§7回到自己的领土才结算圈地;尾迹被别人踩断会清空领土!",
      );
      updateHud(runtime, roomId, session);
    },

    onBeforeReset(roomId) {
      const runtime = getRuntime();
      sessions.delete(roomId);
      releaseObjective(objectiveId(roomId));
      for (const player of runtime.roomPlayers(roomId)) {
        clearHudTitle(player);
        clearAllPlayerItems(player);
        try {
          player.setGameMode(GameMode.Adventure);
        } catch {
          // 忽略
        }
        for (const effect of ["speed", "night_vision", "saturation"]) {
          try {
            player.removeEffect(effect);
          } catch {
            // 没有该效果时会抛错,忽略
          }
        }
        try {
          player.onScreenDisplay.setActionBar("");
        } catch {
          // 忽略
        }
      }
    },

    onRoomReset(roomId) {
      // 模板重新复制后场地本应是中立;这里再兜底刷一次,
      // 防止"重置失败 / 模板被污染"导致上一局的颜色残留到下一局。
      const runtime = getRuntime();
      paintFieldNeutral(runtime.roomDim(roomId), makeField());
    },

    canPlace() {
      // 领地由脚本统一绘制,禁止玩家放置
      return false;
    },
    canBreak() {
      return false;
    },

    openConfig(player) {
      openTerritoryWarConfig(player, getRuntime());
    },
  };
}
