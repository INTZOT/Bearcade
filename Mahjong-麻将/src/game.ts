import {
  BlockPermutation,
  GameMode,
  ItemStack,
  Player,
  system,
  world,
} from "@minecraft/server";
import {
  CustomForm,
  ObservableBoolean,
  ObservableNumber,
  ObservableString,
} from "@minecraft/server-ui";
import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import {
  clearHudTitle,
  hudMessage,
  setHudTitle,
} from "../../shared/minigame-core/scoreboardHud";
import { clearAllPlayerItems } from "../../shared/minigame-core/playerItems";
import { getMahjongConfig, openMahjongConfig } from "./mahjong-config";
import {
  MUDANJIANG_TILE_SET,
  PRESETS,
  SCORE_BUTTONS,
  TILE_CATEGORIES,
} from "./config";
import {
  buildTileDeck,
  tileCountForSelection,
  tileDisplayName,
} from "./tiles";

interface StackInfo {
  location: { x: number; y: number; z: number };
  count: number;
  direction: string;
  tiles: string[];
  nextIndex: number;
}

interface MeldEntry {
  location: { x: number; y: number; z: number };
  tileId: string;
  /** 吃牌时保存三张具体牌;碰/杠可省略,默认按 tileId 复制 */
  tiles?: string[];
  /** 暗杠在玩家听牌前为暗置,不计入亮出计数;听牌后改为明置 */
  concealed?: boolean;
}

interface RoomSession {
  roomId: number;
  joinOrder: string[];
  away: Set<string>;
  hostId?: string;
  selectedTiles: Set<string>;
  presetId?: number;
  scores: Map<string, number>;
  wallBuilt: boolean;
  started: boolean;
  deck: string[];
  drawIndex: number;
  stacks: StackInfo[];
  // 自动开局/理牌/打出设置
  autoDeal: boolean;
  singleDoraReserve: boolean;
  reserveMode: number; // 1=不留牌 2=确定墩数 3=骰子决定
  reserveStacks: number; // 1~8
  openMode: number; // 1=对家开门 2=单骰开门
  takeStacks: number; // 1/2/3/6
  autoSort: boolean;
  autoDiscard: boolean;
  hands: Map<string, string[]>;
  handDisplays: Map<string, { location: { x: number; y: number; z: number }; tileId: string }[]>;
  discardCounts: Map<string, number>;
  discardSlots: Map<string, { location: { x: number; y: number; z: number }; tileId: string | null }[]>;
  melds: Map<string, MeldEntry[]>;
  meldDisplays: Map<string, { location: { x: number; y: number; z: number }; tileId: string }[]>;
  dealCursor: number;
  darkMode: Set<string>;
  presetName?: string;
  dealerSeat: number;
  currentTurnSeat: number;
  tingSeats: Set<number>;
  /** 听牌后当前手牌允许打出的牌(打出后仍保持听牌) */
  tingDiscards: Map<string, string[]>;
  /** 本回合已经出过牌的玩家(防止卡顿连打两张) */
  discardedThisTurn: Set<string>;
  /** 已经告知过宝牌的听牌玩家(宝牌在叫听并打出后才告知) */
  doraTold: Set<string>;
  /** 四家均听牌并打出后,宝牌是否已公开明置 */
  doraRevealedPublicly?: boolean;
  /** 换宝次数(新宝牌在流局剩余张数中计入) */
  doraReplaceCount: number;
  /** 本手为最后一手,行动结束后宣布流局 */
  pendingLiuju?: boolean;
  doraTile?: string;
  doraLocation?: { x: number; y: number; z: number };
  openedPlayers: Set<string>;
  lastDiscard?: { playerId: string; tileId: string };
  pendingAction?: {
    discardPlayerId: string;
    tileId: string;
    eligible: { playerId: string; actions: string[] }[];
    index: number;
    source?: "discard" | "self" | "post_discard_ting";
  };
  /** 流局后等待房主重开下一局(分数保留) */
  roundOver?: boolean;
}

// 座位编号顺序(逆时针行动):南0 → 东1 → 北2 → 西3
const SEAT_ASSIGN_ORDER = [0, 1, 2, 3];
// 座位 → 其面前牌墙在 sides 数组中的索引
// 南→南墙(2), 东→东墙(1), 北→北墙(0), 西→西墙(3)
const SEAT_TO_WALL = [2, 1, 0, 3];

const sessions = new Map<number, RoomSession>();

function getSession(roomId: number): RoomSession | undefined {
  return sessions.get(roomId);
}

function getOrCreateSession(roomId: number): RoomSession {
  let session = sessions.get(roomId);
  if (!session) {
    session = {
      roomId,
      joinOrder: [],
      away: new Set(),
      selectedTiles: new Set(PRESETS[0].tiles),
      scores: new Map(),
      wallBuilt: false,
      started: false,
      deck: [],
      drawIndex: 0,
      stacks: [],
      autoDeal: true,
      singleDoraReserve: false,
      reserveMode: 1,
      reserveStacks: 0,
      openMode: 1,
      takeStacks: 2,
      autoSort: true,
      autoDiscard: true,
      hands: new Map(),
      handDisplays: new Map(),
      discardCounts: new Map(),
      discardSlots: new Map(),
      melds: new Map(),
      meldDisplays: new Map(),
      dealCursor: 0,
      darkMode: new Set(),
      dealerSeat: 0,
      currentTurnSeat: 0,
      tingSeats: new Set(),
      tingDiscards: new Map(),
      discardedThisTurn: new Set(),
      doraTold: new Set(),
      doraRevealedPublicly: false,
      doraReplaceCount: 0,
      pendingLiuju: false,
      openedPlayers: new Set(),
      roundOver: false,
    };
    sessions.set(roomId, session);
  }
  return session;
}

function clearSession(roomId: number): void {
  sessions.delete(roomId);
}

function roomIdOfDimension(dimensionId: string, runtime: MinigameRuntime): number | undefined {
  const prefix = `bearcade:${runtime.config.gameId}_`;
  if (!dimensionId.startsWith(prefix)) return undefined;
  const n = Number(dimensionId.slice(prefix.length));
  return Number.isInteger(n) && n >= 1 ? n : undefined;
}

function playerSeatIndex(session: RoomSession, playerId: string): number {
  const idx = session.joinOrder.indexOf(playerId);
  return idx >= 0 ? SEAT_ASSIGN_ORDER[idx] : -1;
}

function playerIdAtSeat(session: RoomSession, seat: number): string | undefined {
  const idx = SEAT_ASSIGN_ORDER.indexOf(seat);
  return idx >= 0 ? session.joinOrder[idx] : undefined;
}

function physicalPlayers(runtime: MinigameRuntime, roomId: number): Player[] {
  return runtime.roomPlayers(roomId);
}

function handlePlayerEnterRoom(player: Player, roomId: number, runtime: MinigameRuntime): void {
  const session = getOrCreateSession(roomId);
  if (!session.joinOrder.includes(player.id)) {
    session.joinOrder.push(player.id);
    session.scores.set(player.id, 0);
  }
  session.away.delete(player.id);
  if (!session.hostId) {
    session.hostId = player.id;
    runtime.announce(roomId, `§e${player.name} 成为房主`);
  }
  refreshHostBook(session);
  if (session.started && runtime.isRunning(roomId)) {
    // 回到游戏:传送回对应座位
    const seatIndex = playerSeatIndex(session, player.id);
    const cfg = getMahjongConfig();
    const seat = cfg.seatPositions[seatIndex] ?? cfg.seatPositions[0];
    runtime.teleportPlayer(roomId, player, seat);
    player.setGameMode(session.presetName ? GameMode.Adventure : GameMode.Survival);
  }
}

function handlePlayerLeaveRoom(player: Player, roomId: number, runtime: MinigameRuntime): void {
  const session = getSession(roomId);
  if (!session) return;
  if (session.joinOrder.includes(player.id)) {
    session.away.add(player.id);
  }
  if (session.hostId === player.id) {
    transferHost(session, runtime);
  }
  refreshHostBook(session);
}

function transferHost(session: RoomSession, runtime: MinigameRuntime): void {
  let next: Player | undefined;
  if (!session.started) {
    // 等待/倒计时阶段:按加入顺序顺延(先加入者优先)
    for (const id of session.joinOrder) {
      if (id === session.hostId || session.away.has(id)) continue;
      const entity = world.getEntity(id);
      if (entity instanceof Player) {
        next = entity;
        break;
      }
    }
  } else {
    // 对局中:随机其他房间内玩家
    const candidates = physicalPlayers(runtime, session.roomId).filter(
      (p) => p.id !== session.hostId && !session.away.has(p.id),
    );
    if (candidates.length > 0) {
      next = candidates[Math.floor(Math.random() * candidates.length)];
    }
  }
  if (!next) {
    session.hostId = undefined;
    return;
  }
  session.hostId = next.id;
  runtime.announce(session.roomId, `§e${next.name} 成为新房主`);
}

function refreshHostBook(session: RoomSession): void {
  if (!session.hostId) return;
  const host = world.getEntity(session.hostId);
  if (!host || !(host instanceof Player)) return;
  const container = host.getComponent("inventory")?.container;
  if (!container) return;
  const book = new ItemStack("minecraft:book", 1);
  book.nameTag = "§e游戏设置";
  container.setItem(8, book);
}

function giveHostBook(player: Player): void {
  const container = player.getComponent("inventory")?.container;
  if (!container) return;
  const book = new ItemStack("minecraft:book", 1);
  book.nameTag = "§e游戏设置";
  container.setItem(8, book);
}

// ================= 开局:牌垛生成(显示用,数据在 deck 中) =================

function wallFaceDirection(wallIndex: number): string {
  // 北/东/南/西 四面连续牌墙的朝向
  return ["north", "east", "south", "west"][wallIndex] ?? "north";
}

function buildStacks(roomId: number, runtime: MinigameRuntime, session: RoomSession): void {
  const cfg = getMahjongConfig();
  const dim = runtime.roomDim(roomId);
  const deck = buildTileDeck(session.selectedTiles);
  session.deck = deck;
  session.drawIndex = 0;
  session.stacks = [];

  const totalStacks = Math.ceil(deck.length / 2);
  const centerX = Math.floor((cfg.fieldMinX + cfg.fieldMaxX) / 2);
  const centerZ = Math.floor((cfg.fieldMinZ + cfg.fieldMaxZ) / 2);
  const inset = cfg.stackInset;
  const y = cfg.fieldY + 1;

  // 连续牌墙顺序:北(西→东) → 东(北→南) → 南(东→西) → 西(南→北)
  const sides = [
    { alongX: true, fixedZ: centerZ - inset, step: 1 }, // north
    { alongX: false, fixedX: centerX + inset, step: 1 }, // east
    { alongX: true, fixedZ: centerZ + inset, step: -1 }, // south
    { alongX: false, fixedX: centerX - inset, step: -1 }, // west
  ];

  const perSide = Math.ceil(totalStacks / 4);
  let stackIndex = 0;
  for (let s = 0; s < 4 && stackIndex < totalStacks; s++) {
    const countThisSide = Math.min(perSide, totalStacks - stackIndex);
    const startOffset =
      sides[s].step === 1
        ? -Math.floor(countThisSide / 2)
        : Math.floor(countThisSide / 2);
    const def = sides[s];
    const dir = wallFaceDirection(s);
    for (let i = 0; i < countThisSide; i++) {
      const offset = startOffset + i * def.step;
      const pos = def.alongX
        ? { x: centerX + offset, y, z: def.fixedZ! }
        : { x: def.fixedX!, y, z: centerZ + offset };
      const start = stackIndex * 2;
      const tiles = deck.slice(start, start + 2);
      const count = tiles.length;
      const blockId =
        count === 2 ? "mahjong:mahjong_stack_full" : "mahjong:mahjong_stack_half";
      try {
        const permutation = BlockPermutation.resolve(blockId as never, {
          "minecraft:cardinal_direction": dir,
        } as never);
        dim.setBlockPermutation(pos, permutation);
      } catch (error) {
        runtime.dbg(`放置牌垛失败 ${blockId} @ ${JSON.stringify(pos)}`, error);
      }
      session.stacks.push({ location: pos, count, direction: dir, tiles, nextIndex: 0 });
      stackIndex++;
    }
  }
}

function sameLocation(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function drawFromStack(
  player: Player,
  roomId: number,
  stackLoc: { x: number; y: number; z: number },
  runtime: MinigameRuntime,
): void {
  const session = getSession(roomId);
  if (!session || !session.started) return;
  if (session.presetName) {
    player.sendMessage("§c预设模式由系统自动摸牌,不能手动按牌垛");
    return;
  }
  const stack = session.stacks.find((s) => sameLocation(s.location, stackLoc));
  if (!stack || stack.count <= 0) return;

  const tileId = takeFromStack(session, runtime, stack);
  if (!tileId) {
    player.sendMessage("§c这个牌垛已经摸完了");
    return;
  }

  const hand = session.hands.get(player.id) ?? [];
  hand.push(tileId);
  session.hands.set(player.id, hand);
  if (session.autoSort) refreshPlayerHandDisplay(session, runtime, player.id);
  player.sendMessage(`§a摸到 ${tileDisplayName(tileId)}`);
}

// ================= 自动发牌 / 理牌 / 打出 =================

function updateStackVisual(
  session: RoomSession,
  runtime: MinigameRuntime,
  stack: StackInfo,
): void {
  const dim = runtime.roomDim(session.roomId);
  try {
    if (stack.count === 1) {
      const half = BlockPermutation.resolve(
        "mahjong:mahjong_stack_half" as never,
        { "minecraft:cardinal_direction": stack.direction } as never,
      );
      dim.setBlockPermutation(stack.location, half);
    } else if (stack.count === 0) {
      dim.setBlockPermutation(
        stack.location,
        BlockPermutation.resolve("minecraft:air" as never),
      );
    }
  } catch (error) {
    runtime.dbg(`更新牌垛失败 @ ${JSON.stringify(stack.location)}`, error);
  }
}

function takeFromStack(
  session: RoomSession,
  runtime: MinigameRuntime,
  stack: StackInfo,
): string | undefined {
  if (stack.nextIndex >= stack.tiles.length) return undefined;
  const tile = stack.tiles[stack.nextIndex++];
  stack.count = stack.tiles.length - stack.nextIndex;
  updateStackVisual(session, runtime, stack);
  return tile;
}

function takeFromDealCursor(
  session: RoomSession,
  runtime: MinigameRuntime,
): string | undefined {
  for (let i = 0; i < session.stacks.length; i++) {
    const stack = session.stacks[session.dealCursor];
    if (stack.nextIndex < stack.tiles.length) {
      return takeFromStack(session, runtime, stack);
    }
    session.dealCursor = (session.dealCursor + 1) % session.stacks.length;
  }
  return undefined;
}

/** 从牌墙尾部(剩余待摸牌的最后位置)摸一张,用于杠后补牌和换宝 */
function takeFromWallTail(
  session: RoomSession,
  runtime: MinigameRuntime,
): string | undefined {
  const remaining: StackInfo[] = [];
  for (let i = 0; i < session.stacks.length; i++) {
    const idx = (session.dealCursor + i) % session.stacks.length;
    const s = session.stacks[idx];
    if (s.nextIndex < s.tiles.length) remaining.push(s);
  }
  if (remaining.length === 0) return undefined;
  return takeFromStack(session, runtime, remaining[remaining.length - 1]);
}

function giveItem(player: Player, typeId: string, nameTag?: string): void {
  const item = new ItemStack(typeId, 1);
  if (nameTag) item.nameTag = nameTag;
  const container = player.getComponent("inventory")?.container;
  const leftover = container?.addItem(item);
  if (leftover) {
    player.dimension.spawnItem(leftover, player.location);
  } else if (!container) {
    player.dimension.spawnItem(item, player.location);
  }
}

function removeTileItem(player: Player, tileId: string): boolean {
  const container = player.getComponent("inventory")?.container;
  if (!container) return false;
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (item?.typeId === `mahjong:${tileId}`) {
      if (item.amount > 1) {
        item.amount = item.amount - 1;
        container.setItem(i, item);
      } else {
        container.setItem(i, undefined);
      }
      return true;
    }
  }
  return false;
}

function tileSortValue(tileId: string): number {
  const body = tileId.startsWith("mahjong_") ? tileId.slice("mahjong_".length) : tileId;
  const cat = body.charAt(0);
  const num = Number(body.slice(1)) || 0;
  const order: Record<string, number> = { a: 0, b: 1, c: 2, d: 3, e: 4, f: 5 };
  return (order[cat] ?? 9) * 100 + num;
}

function tileNum(tileId: string): number {
  return Number(tileId.slice(-1)) || 0;
}

function tileSuit(tileId: string): string {
  return tileId.slice(0, -1);
}

function canFormMelds(hand: string[]): boolean {
  if (hand.length === 0) return true;
  hand = [...hand].sort((a, b) => tileSortValue(a) - tileSortValue(b));
  const first = hand[0];
  // 刻子
  const tripletCount = hand.filter((t) => t === first).length;
  if (tripletCount >= 3) {
    const rest = [...hand];
    let removed = 0;
    for (let i = rest.length - 1; i >= 0 && removed < 3; i--) {
      if (rest[i] === first) {
        rest.splice(i, 1);
        removed++;
      }
    }
    if (canFormMelds(rest)) return true;
  }
  // 顺子(仅万/条/饼)
  const suit = tileSuit(first);
  if (suit !== "mahjong_e") {
    const n = tileNum(first);
    if (n <= 7) {
      const seq = [`${suit}${n}`, `${suit}${n + 1}`, `${suit}${n + 2}`];
      if (seq.every((t) => hand.includes(t))) {
        const rest = [...hand];
        for (const t of seq) {
          const idx = rest.indexOf(t);
          if (idx >= 0) rest.splice(idx, 1);
        }
        if (canFormMelds(rest)) return true;
      }
    }
  }
  return false;
}

function canFormMeldsChecked(
  hand: string[],
  hasSeq: boolean,
  hasTri: boolean,
): boolean {
  if (hand.length === 0) return hasSeq && hasTri;
  hand = [...hand].sort((a, b) => tileSortValue(a) - tileSortValue(b));
  const first = hand[0];
  // 刻子
  const tripletCount = hand.filter((t) => t === first).length;
  if (tripletCount >= 3) {
    const rest = [...hand];
    let removed = 0;
    for (let i = rest.length - 1; i >= 0 && removed < 3; i--) {
      if (rest[i] === first) {
        rest.splice(i, 1);
        removed++;
      }
    }
    if (canFormMeldsChecked(rest, hasSeq, true)) return true;
  }
  // 顺子
  const suit = tileSuit(first);
  if (suit !== "mahjong_e") {
    const n = tileNum(first);
    if (n <= 7) {
      const seq = [`${suit}${n}`, `${suit}${n + 1}`, `${suit}${n + 2}`];
      if (seq.every((t) => hand.includes(t))) {
        const rest = [...hand];
        for (const t of seq) {
          const idx = rest.indexOf(t);
          if (idx >= 0) rest.splice(idx, 1);
        }
        if (canFormMeldsChecked(rest, true, hasTri)) return true;
      }
    }
  }
  return false;
}

function meldTiles(melds: MeldEntry[]): string[] {
  return melds.flatMap((m) => m.tiles ?? Array(3).fill(m.tileId));
}

function hasYaoInTiles(tiles: string[]): boolean {
  return tiles.some((t) => {
    const n = tileNum(t);
    return n === 1 || n === 9;
  });
}

function canWin(hand: string[], melds: MeldEntry[] = []): boolean {
  if (hand.length % 3 !== 2) return false;
  const hasRedCenter =
    hand.includes("mahjong_e1") || meldTiles(melds).includes("mahjong_e1");
  const openSeq = melds.some((m) => !isPungMeld(m));
  const openTri = melds.some((m) => isPungMeld(m));
  const allTiles = [...hand, ...meldTiles(melds)];
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      if (hand[i] === hand[j]) {
        const rest = hand.filter((_, idx) => idx !== i && idx !== j);
        if (hasRedCenter) {
          if (canFormMelds(rest)) return true;
        } else {
          if (
            canFormMeldsChecked(rest, openSeq, openTri) &&
            hasYaoInTiles(allTiles)
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

function readyTiles(hand: string[], melds: MeldEntry[] = []): string[] {
  const results: string[] = [];
  const candidates = new Set<string>(MUDANJIANG_TILE_SET);
  for (const t of candidates) {
    if (canWin([...hand, t], melds)) results.push(t);
  }
  return results;
}

function uniqueTiles(hand: string[]): string[] {
  return [...new Set(hand)];
}

/** 当前手牌(含摸到的牌,尚未打出)中,打出哪些牌后能进入听牌状态 */
function readyDiscards(
  hand: string[],
  melds: MeldEntry[] = [],
): string[] {
  const result: string[] = [];
  for (const t of uniqueTiles(hand)) {
    const idx = hand.indexOf(t);
    const rest = [...hand];
    rest.splice(idx, 1);
    if (readyTiles(rest, melds).length > 0) result.push(t);
  }
  return result;
}

/** 检查某个吃牌组合吃完后是否还能打出一张并保持听牌 */
function canChiTingWithNeed(
  hand: string[],
  tileId: string,
  need: string[],
  melds: MeldEntry[] = [],
): boolean {
  const rest = [...hand];
  for (const t of need) {
    const idx = rest.indexOf(t);
    if (idx >= 0) rest.splice(idx, 1);
  }
  // 吃后必须再打一张;听牌后手牌至少剩 4 张(不能手把一)
  if (rest.length - 1 < 4) return false;
  const newMelds: MeldEntry[] = [
    ...melds,
    { location: { x: 0, y: 0, z: 0 }, tileId, tiles: [need[0], need[1], tileId] },
  ];
  return readyDiscards(rest, newMelds).length > 0;
}

/** 吃牌后(claimed 不入手,只从手牌移除 need)是否还有一张可打出的牌能听 */
function canChiTingWith(
  hand: string[],
  tileId: string,
  melds: MeldEntry[] = [],
): boolean {
  return chiOptions(hand, tileId).some((need) =>
    canChiTingWithNeed(hand, tileId, need, melds),
  );
}

/** 逆时针距离:from 之后第几个轮到此 seat */
function counterClockwiseDistance(
  fromSeat: number,
  toSeat: number,
  count: number,
): number {
  return (toSeat - fromSeat + count) % count;
}

function dealGame(
  session: RoomSession,
  runtime: MinigameRuntime,
  onDone?: () => void,
): void {
  const dealerSeat = session.dealerSeat;
  const dealerId = playerIdAtSeat(session, dealerSeat);
  const count = session.joinOrder.length;
  if (count === 0) return;

  // 开牌位置
  let startSeat: number;
  if (session.openMode === 1) {
    startSeat = (dealerSeat + 2) % count; // 对家开门
  } else {
    const die = Math.floor(Math.random() * 6) + 1;
    runtime.announce(session.roomId, `§e开牌骰子:${die}`);
    if (die === 1 || die === 5) startSeat = dealerSeat;
    else if (die === 2 || die === 6) startSeat = (dealerSeat + 1) % count; // 下家
    else if (die === 3) startSeat = (dealerSeat + 2) % count; // 对家
    else startSeat = (dealerSeat + 3) % count; // 上家
  }

  // 留牌
  let reserved = 0;
  if (session.reserveMode === 2) reserved = session.reserveStacks;
  else if (session.reserveMode === 3) {
    reserved = Math.floor(Math.random() * 6) + 1;
    runtime.announce(session.roomId, `§e留牌骰子:${reserved}`);
  }

  // 映射到牌垛起始位置
  const totalStacks = session.stacks.length;
  const perSide = Math.ceil(totalStacks / 4);
  const startSide = SEAT_TO_WALL[startSeat] ?? 0;
  session.dealCursor =
    totalStacks > 0 ? (startSide * perSide + reserved) % totalStacks : 0;

  // 初始化手牌
  session.hands.clear();
  for (const id of session.joinOrder) session.hands.set(id, []);

  // 生成发牌步骤(按逆时针座位顺序)
  const dealSeats = SEAT_ASSIGN_ORDER.slice(0, count);
  const steps: string[] = [];
  const tilesPerPick = session.takeStacks * 2;
  const rounds = Math.ceil(12 / tilesPerPick);
  for (let r = 0; r < rounds; r++) {
    for (const seat of dealSeats) {
      const pid = playerIdAtSeat(session, seat);
      if (!pid) continue;
      for (let t = 0; t < tilesPerPick; t++) {
        steps.push(pid);
      }
    }
  }
  for (const seat of dealSeats) {
    const pid = playerIdAtSeat(session, seat);
    if (pid) steps.push(pid);
  }
  if (dealerId) steps.push(dealerId);

  let stepIndex = 0;
  const stepDelayTicks = 6; // 约 0.3 秒

  function nextStep(): void {
    if (stepIndex >= steps.length) {
      if (session.singleDoraReserve) placeDoraIndicator(session, runtime);
      runtime.announce(session.roomId, "§a发牌完成");
      onDone?.();
      return;
    }
    const playerId = steps[stepIndex++];
    const tile = takeFromDealCursor(session, runtime);
    if (!tile) {
      runtime.announce(session.roomId, "§c牌堆不足,发牌中断");
      return;
    }
    const hand = session.hands.get(playerId);
    if (hand) hand.push(tile);
    if (session.autoSort) refreshPlayerHandDisplay(session, runtime, playerId);
    system.runTimeout(nextStep, stepDelayTicks);
  }

  nextStep();
}

/** 按自定义模式“单张宝牌预留”的放置规则:放在剩余待摸牌倒数第三摞上方 */
function placeDoraAtReservedSpot(
  session: RoomSession,
  runtime: MinigameRuntime,
  tile: string,
): boolean {
  const remaining: StackInfo[] = [];
  for (let i = 0; i < session.stacks.length; i++) {
    const idx = (session.dealCursor + i) % session.stacks.length;
    const s = session.stacks[idx];
    if (s.count > 0) remaining.push(s);
  }
  if (remaining.length < 3) return false;
  const stack = remaining[remaining.length - 3];
  if (!stack) return false;
  const pos = {
    x: stack.location.x,
    y: stack.location.y + 1,
    z: stack.location.z,
  };
  session.doraLocation = pos;
  placeTileBlock(runtime.roomDim(session.roomId), pos, tile, "down", stack.direction);
  return true;
}

function placeDoraIndicator(
  session: RoomSession,
  runtime: MinigameRuntime,
): void {
  if (session.stacks.length < 3) return;
  const tile = takeFromDealCursor(session, runtime);
  if (!tile) return;
  session.doraTile = tile;
  if (!placeDoraAtReservedSpot(session, runtime, tile)) return;
  runtime.announce(session.roomId, "§a宝牌已暗置叠放");
}

function handDisplayPositions(seat: number): { x: number; y: number; z: number }[] {
  const cfg = getMahjongConfig();
  const y = cfg.fieldY + 1;
  const centerX = Math.floor((cfg.fieldMinX + cfg.fieldMaxX) / 2);
  const centerZ = Math.floor((cfg.fieldMinZ + cfg.fieldMaxZ) / 2);
  const offset = cfg.handDisplayOffset;
  const length = cfg.handRowLength;
  const start = -Math.floor(length / 2);
  const positions: { x: number; y: number; z: number }[] = [];
  let baseX = 0;
  let baseZ = 0;
  let dx = 1;
  let dz = 0;
  if (seat === 0) { baseX = centerX + start; baseZ = centerZ + offset; dx = 1; dz = 0; }
  else if (seat === 1) { baseX = centerX + offset; baseZ = centerZ - start; dx = 0; dz = -1; }
  else if (seat === 2) { baseX = centerX - start; baseZ = centerZ - offset; dx = -1; dz = 0; }
  else { baseX = centerX - offset; baseZ = centerZ + start; dx = 0; dz = 1; }
  for (let i = 0; i < length; i++) {
    positions.push({ x: baseX + i * dx, y, z: baseZ + i * dz });
  }
  return positions;
}

function refreshPlayerHandDisplay(
  session: RoomSession,
  runtime: MinigameRuntime,
  playerId: string,
): void {
  // 先清除该玩家旧的手牌展示
  const oldList = session.handDisplays.get(playerId) ?? [];
  const dim = runtime.roomDim(session.roomId);
  for (const entry of oldList) {
    try {
      dim.setBlockPermutation(
        entry.location,
        BlockPermutation.resolve("minecraft:air" as never),
      );
    } catch {
      // ignore
    }
  }

  const seat = playerSeatIndex(session, playerId);
  if (seat < 0) return;
  const hand = session.hands.get(playerId) ?? [];
  const sorted = [...hand].sort((a, b) => tileSortValue(a) - tileSortValue(b));
  const positions = handDisplayPositions(seat);
  const list: { location: { x: number; y: number; z: number }; tileId: string }[] = [];
  const dir = ["north", "west", "south", "east"][seat] ?? "north";
  for (let i = 0; i < sorted.length && i < positions.length; i++) {
    const pos = positions[i];
    placeTileBlock(dim, pos, sorted[i], "stand", dir);
    list.push({ location: pos, tileId: sorted[i] });
  }
  session.handDisplays.set(playerId, list);
}

/** 听牌玩家的手牌展示强制暗置(锁定,不能吃碰杠) */
function applyTingHandLock(
  session: RoomSession,
  runtime: MinigameRuntime,
  playerId: string,
): void {
  const seat = playerSeatIndex(session, playerId);
  if (!session.tingSeats.has(seat)) return;
  const dim = runtime.roomDim(session.roomId);
  const displayList = session.handDisplays.get(playerId) ?? [];
  for (const entry of displayList) {
    try {
      const b = dim.getBlock(entry.location);
      if (!b) continue;
      const curPerm = b.permutation as any;
      const curDir =
        curPerm.getState("minecraft:cardinal_direction") ?? "north";
      const perm = BlockPermutation.resolve(b.typeId as never, {
        "mahjong:pose": "down",
        "minecraft:cardinal_direction": curDir,
      } as never);
      dim.setBlockPermutation(entry.location, perm);
    } catch {
      // ignore
    }
  }
}

function buildHandDisplay(session: RoomSession, runtime: MinigameRuntime): void {
  for (const player of runtime.roomPlayers(session.roomId)) {
    refreshPlayerHandDisplay(session, runtime, player.id);
  }
}

function clearHandDisplay(session: RoomSession, runtime: MinigameRuntime): void {
  const dim = runtime.roomDim(session.roomId);
  for (const list of session.handDisplays.values()) {
    for (const entry of list) {
      try {
        dim.setBlockPermutation(
          entry.location,
          BlockPermutation.resolve("minecraft:air" as never),
        );
      } catch {
        // ignore
      }
    }
  }
  session.handDisplays.clear();
}

function clearMeldDisplay(session: RoomSession, runtime: MinigameRuntime): void {
  const dim = runtime.roomDim(session.roomId);
  for (const list of session.meldDisplays.values()) {
    for (const entry of list) {
      try {
        dim.setBlockPermutation(
          entry.location,
          BlockPermutation.resolve("minecraft:air" as never),
        );
      } catch {
        // ignore
      }
    }
  }
  session.meldDisplays.clear();
}

function meldDisplayPositions(
  seat: number,
  meldIndex: number,
  count: number,
): { x: number; y: number; z: number }[] {
  const cfg = getMahjongConfig();
  const y = cfg.fieldY + 1;
  const centerX = Math.floor((cfg.fieldMinX + cfg.fieldMaxX) / 2);
  const centerZ = Math.floor((cfg.fieldMinZ + cfg.fieldMaxZ) / 2);
  const offset = cfg.meldDisplayOffset;
  const groupGap = 4;
  const positions: { x: number; y: number; z: number }[] = [];
  if (seat === 0) {
    const baseX = centerX - 6 + meldIndex * groupGap;
    const baseZ = centerZ + offset;
    for (let i = 0; i < count; i++) positions.push({ x: baseX + i, y, z: baseZ });
  } else if (seat === 2) {
    const baseX = centerX + 6 - meldIndex * groupGap;
    const baseZ = centerZ - offset;
    for (let i = 0; i < count; i++) positions.push({ x: baseX - i, y, z: baseZ });
  } else if (seat === 1) {
    const baseX = centerX + offset;
    const baseZ = centerZ - 6 + meldIndex * groupGap;
    for (let i = 0; i < count; i++) positions.push({ x: baseX, y, z: baseZ + i });
  } else {
    const baseX = centerX - offset;
    const baseZ = centerZ + 6 - meldIndex * groupGap;
    for (let i = 0; i < count; i++) positions.push({ x: baseX, y, z: baseZ - i });
  }
  return positions;
}

function refreshMeldDisplay(
  session: RoomSession,
  runtime: MinigameRuntime,
  playerId: string,
): void {
  const oldList = session.meldDisplays.get(playerId) ?? [];
  const dim = runtime.roomDim(session.roomId);
  for (const entry of oldList) {
    try {
      dim.setBlockPermutation(
        entry.location,
        BlockPermutation.resolve("minecraft:air" as never),
      );
    } catch {
      // ignore
    }
  }
  const seat = playerSeatIndex(session, playerId);
  if (seat < 0) return;
  const melds = session.melds.get(playerId) ?? [];
  const dir = ["north", "west", "south", "east"][seat] ?? "north";
  const list: { location: { x: number; y: number; z: number }; tileId: string }[] = [];
  melds.forEach((m, idx) => {
    const tiles = m.tiles ?? Array(3).fill(m.tileId);
    const positions = meldDisplayPositions(seat, idx, tiles.length);
    const pose = m.concealed ? "down" : "up";
    tiles.forEach((tileId, i) => {
      const pos = positions[i];
      if (!pos) return;
      placeTileBlock(dim, pos, tileId, pose, dir);
      list.push({ location: pos, tileId });
    });
  });
  session.meldDisplays.set(playerId, list);
}

/** 玩家听牌时,把其暗杠改为明置;明置后才计入换宝的亮出计数 */
function revealMeldsOnTing(
  session: RoomSession,
  runtime: MinigameRuntime,
  playerId: string,
): boolean {
  const melds = session.melds.get(playerId);
  if (!melds) return false;
  const playerName =
    world.getEntity(playerId)?.nameTag ??
    `座位${playerSeatIndex(session, playerId) + 1}`;
  let changed = false;
  const revealed: string[] = [];
  for (const m of melds) {
    if (m.concealed) {
      m.concealed = false;
      changed = true;
      revealed.push(tileDisplayName(m.tileId));
    }
  }
  if (!changed) return false;
  refreshMeldDisplay(session, runtime, playerId);
  if (revealed.length > 0) {
    runtime.announce(
      session.roomId,
      `§e${playerName} 的暗杠亮出:${revealed.join("、")}`,
    );
  }
  return maybeReplaceDora(session, runtime);
}

function discardPosition(seat: number, count: number): { x: number; y: number; z: number } {
  const cfg = getMahjongConfig();
  const y = cfg.fieldY + 1;
  const centerX = Math.floor((cfg.fieldMinX + cfg.fieldMaxX) / 2);
  const centerZ = Math.floor((cfg.fieldMinZ + cfg.fieldMaxZ) / 2);
  const startOffset = cfg.discardStartOffset;
  const perRow = cfg.discardRowLength;
  let baseX = centerX;
  let baseZ = centerZ;
  let dx = 1;
  let dz = 0;
  let rowStepX = 0;
  let rowStepZ = 1;
  if (seat === 0) { baseZ = centerZ + startOffset; dx = 1; dz = 0; rowStepZ = 1; }
  else if (seat === 1) { baseX = centerX + startOffset; baseZ = centerZ; dx = 0; dz = -1; rowStepX = 1; rowStepZ = 0; }
  else if (seat === 2) { baseZ = centerZ - startOffset; dx = -1; dz = 0; rowStepZ = -1; }
  else { baseX = centerX - startOffset; baseZ = centerZ; dx = 0; dz = 1; rowStepX = -1; rowStepZ = 0; }
  const col = count % perRow;
  const row = Math.floor(count / perRow);
  return {
    x: baseX + col * dx + row * rowStepX,
    y,
    z: baseZ + col * dz + row * rowStepZ,
  };
}

/** 被吃/碰/杠 claim 的牌要从牌河移除(清除对应方块和数据) */
function removeDiscardFromRiver(
  session: RoomSession,
  runtime: MinigameRuntime,
  discardPlayerId: string,
  tileId: string,
): void {
  const slots = session.discardSlots.get(discardPlayerId);
  if (!slots) return;
  const dim = runtime.roomDim(session.roomId);
  for (let i = slots.length - 1; i >= 0; i--) {
    const s = slots[i];
    if (s && s.tileId === tileId) {
      try {
        dim.setBlockPermutation(
          s.location,
          BlockPermutation.resolve("minecraft:air" as never),
        );
      } catch {
        // ignore
      }
      slots.splice(i, 1);
      session.discardSlots.set(discardPlayerId, slots);
      return;
    }
  }
}

/** 玩家打出牌后,若手牌(含副露)已处于听牌状态,可先选择是否听牌 */
function canDeclareTingAfterDiscard(
  session: RoomSession,
  playerId: string,
): boolean {
  const seat = playerSeatIndex(session, playerId);
  if (session.tingSeats.has(seat)) return false;
  if (!session.openedPlayers.has(playerId)) return false;
  const hand = session.hands.get(playerId) ?? [];
  if (hand.length < 4) return false;
  return readyTiles(hand, session.melds.get(playerId) ?? []).length > 0;
}

function discardTile(
  player: Player,
  roomId: number,
  entry: { location: { x: number; y: number; z: number }; tileId: string },
  runtime: MinigameRuntime,
): void {
  const session = getSession(roomId);
  if (!session || !session.started || session.roundOver) return;
  const seat = playerSeatIndex(session, player.id);
  if (seat < 0) return;
  if (session.presetName === "mudanjiang" && seat !== session.currentTurnSeat) {
    player.sendMessage("§c还没轮到你,不能出牌");
    return;
  }
  if (session.discardedThisTurn.has(player.id)) {
    player.sendMessage("§c你已经出过牌了,请等待下一轮");
    return;
  }
  if (session.tingSeats.has(seat)) {
    const allowed = session.tingDiscards.get(player.id);
    if (allowed && !allowed.includes(entry.tileId)) {
      player.sendMessage(
        `§c听牌后只能打出保持听牌的牌:${allowed.map(tileDisplayName).join("、")}`,
      );
      return;
    }
  }

  const hand = session.hands.get(player.id);
  if (!hand) return;
  const idx = hand.indexOf(entry.tileId);
  if (idx === -1) return;
  hand.splice(idx, 1);
  session.discardedThisTurn.add(player.id);
  session.tingDiscards.delete(player.id);
  removeTileItem(player, entry.tileId);

  // 移除面前展示块
  const dim = runtime.roomDim(roomId);
  try {
    dim.setBlockPermutation(
      entry.location,
      BlockPermutation.resolve("minecraft:air" as never),
    );
  } catch {
    // ignore
  }
  const displayList = session.handDisplays.get(player.id) ?? [];
  session.handDisplays.set(
    player.id,
    displayList.filter((e) => !sameLocation(e.location, entry.location)),
  );
  if (session.autoSort) refreshPlayerHandDisplay(session, runtime, player.id);
  applyTingHandLock(session, runtime, player.id);

  // 放到桌面(亮牌):从头开始逐格扫描,放到第一个空位
  const slots = session.discardSlots.get(player.id) ?? [];
  let index = 0;
  let pos = discardPosition(seat, index);
  while (slots.some((s) => s && sameLocation(s.location, pos)) && index < 200) {
    index++;
    pos = discardPosition(seat, index);
  }
  slots.push({ location: pos, tileId: entry.tileId });
  session.discardSlots.set(player.id, slots);
  placeTileBlock(
    dim,
    pos,
    entry.tileId,
    "up",
    ["north", "west", "south", "east"][seat] ?? "north",
  );
  runtime.announce(roomId, `§e${player.name} 打出 ${tileDisplayName(entry.tileId)}`);
  // 已提前叫听的玩家,打出牌后才告知宝牌
  if (
    session.tingSeats.has(seat) &&
    session.doraTile &&
    !session.doraTold.has(player.id)
  ) {
    player.sendMessage(`§b宝牌:${tileDisplayName(session.doraTile)}`);
    session.doraTold.add(player.id);
    maybeRevealDoraWhenAllTingAndDiscarded(session, runtime);
  }
  // 已听牌玩家打出牌后,暗杠改为明置并公布
  if (session.tingSeats.has(seat)) {
    revealMeldsOnTing(session, runtime, player.id);
  }
  clearTingItemsForAll(session);
  if (session.presetName === "mudanjiang") {
    session.lastDiscard = { playerId: player.id, tileId: entry.tileId };
    // 牌墙(含换宝计数)剩余 15 张时,本手为最后一手,行动结束后流局
    if (effectiveRemainingTiles(session) <= 15) {
      session.pendingLiuju = true;
      runtime.announce(
        session.roomId,
        "§e牌墙剩余15张,本手为最后一手",
      );
    }
    // 打出后如果自己已经听牌,先让自己选择是否听牌,再让其他玩家行动
    if (canDeclareTingAfterDiscard(session, player.id)) {
      session.pendingAction = {
        discardPlayerId: player.id,
        tileId: entry.tileId,
        eligible: [{ playerId: player.id, actions: ["ting"] }],
        index: 0,
        source: "post_discard_ting",
      };
      promptNextAction(session, runtime);
      return;
    }
    system.runTimeout(
      () => beginActionPhase(session, runtime, player.id, entry.tileId),
      10,
    );
  }
}

/** 自动出牌:离线托管或听牌后摸到非胡/非宝牌时自动打出 */
function autoDiscardForAway(
  session: RoomSession,
  runtime: MinigameRuntime,
  playerId: string,
  drawnTile?: string,
  isAway = true,
): void {
  if (session.roundOver) return;
  if (session.discardedThisTurn.has(playerId)) return;
  const roomId = session.roomId;
  const seat = playerSeatIndex(session, playerId);
  if (seat < 0) return;
  const hand = session.hands.get(playerId);
  if (!hand || hand.length === 0) return;

  let chosen: string | undefined;
  if (session.tingSeats.has(seat)) {
    const allowed = session.tingDiscards.get(playerId) ?? [];
    chosen =
      allowed.find((t) => t === drawnTile && hand.includes(t)) ??
      allowed.find((t) => hand.includes(t)) ??
      hand[0];
  } else if (drawnTile && hand.includes(drawnTile)) {
    chosen = drawnTile;
  } else {
    chosen = hand[0];
  }
  if (!chosen) return;

  const idx = hand.indexOf(chosen);
  hand.splice(idx, 1);
  session.discardedThisTurn.add(playerId);
  session.tingDiscards.delete(playerId);
  if (session.tingSeats.has(seat)) {
    session.doraTold.add(playerId);
    maybeRevealDoraWhenAllTingAndDiscarded(session, runtime);
    revealMeldsOnTing(session, runtime, playerId);
  }
  const dim = runtime.roomDim(roomId);
  const displayList = session.handDisplays.get(playerId) ?? [];
  const entry = displayList.find((e) => e.tileId === chosen);
  if (entry) {
    try {
      dim.setBlockPermutation(
        entry.location,
        BlockPermutation.resolve("minecraft:air" as never),
      );
    } catch {
      // ignore
    }
    session.handDisplays.set(
      playerId,
      displayList.filter((e) => !sameLocation(e.location, entry.location)),
    );
  }
  applyTingHandLock(session, runtime, playerId);

  const slots = session.discardSlots.get(playerId) ?? [];
  let index = 0;
  let pos = discardPosition(seat, index);
  while (slots.some((s) => s && sameLocation(s.location, pos)) && index < 200) {
    index++;
    pos = discardPosition(seat, index);
  }
  slots.push({ location: pos, tileId: chosen });
  session.discardSlots.set(playerId, slots);
  placeTileBlock(
    dim,
    pos,
    chosen,
    "up",
    ["north", "west", "south", "east"][seat] ?? "north",
  );
  const playerName = world.getEntity(playerId)?.nameTag ?? `座位${seat + 1}`;
  const suffix = isAway ? "(托管)" : "(自动)";
  runtime.announce(roomId, `§e${playerName}${suffix} 打出 ${tileDisplayName(chosen)}`);
  clearTingItemsForAll(session);
  if (session.presetName === "mudanjiang") {
    session.lastDiscard = { playerId, tileId: chosen };
    if (effectiveRemainingTiles(session) <= 15) {
      session.pendingLiuju = true;
      runtime.announce(session.roomId, "§e牌墙剩余15张,本手为最后一手");
    }
    system.runTimeout(
      () => beginActionPhase(session, runtime, playerId, chosen),
      10,
    );
  }
}

/** 剩余牌数:实际牌墙 + 换宝次数(新宝牌计入,初始宝牌不计) */
function effectiveRemainingTiles(session: RoomSession): number {
  let wall = 0;
  for (const s of session.stacks) wall += s.count;
  return wall + session.doraReplaceCount;
}

/** 宣布流局(分数不变,留在房间) */
function declareLiuju(
  session: RoomSession,
  runtime: MinigameRuntime,
): void {
  session.roundOver = true;
  session.pendingAction = undefined;
  session.pendingLiuju = false;
  for (const pid of session.joinOrder) {
    const p = world.getEntity(pid);
    if (p instanceof Player) clearActionItems(p);
  }
  runtime.announce(
    session.roomId,
    "§c牌墙剩余15张,本局流局,分数不变;房主可用设置书选择“下一局”重新发牌",
  );
}

/** 一手牌打完后:如果已到最后一手则流局,否则轮到下家摸牌 */
function afterDiscardResolution(
  session: RoomSession,
  runtime: MinigameRuntime,
): void {
  if (session.pendingLiuju) {
    declareLiuju(session, runtime);
    return;
  }
  advanceMudanjiangTurn(session, runtime);
}

function advanceMudanjiangTurn(session: RoomSession, runtime: MinigameRuntime): void {
  if (session.roundOver) return;
  if (session.pendingLiuju) {
    declareLiuju(session, runtime);
    return;
  }
  const count = session.joinOrder.length;
  if (count === 0) return;
  session.currentTurnSeat = (session.currentTurnSeat + 1) % count;
  session.discardedThisTurn.clear();
  const playerId = playerIdAtSeat(session, session.currentTurnSeat);
  if (!playerId) return;
  const player = world.getEntity(playerId);
  const isAway = session.away.has(playerId);
  if (!(player instanceof Player) && !isAway) return;
  // 每次轮转只保留当前回合玩家可能需要的听牌选项
  clearTingItemsForAll(session);
  // 自动摸一张
  const tile = takeFromDealCursor(session, runtime);
  if (!tile) {
    session.roundOver = true;
    session.pendingAction = undefined;
    for (const pid of session.joinOrder) {
      const p = world.getEntity(pid);
      if (p instanceof Player) clearActionItems(p);
    }
    runtime.announce(
      session.roomId,
      "§c牌墙已摸完,本局流局,分数不变;房主可用设置书选择“下一局”重新发牌",
    );
    return;
  }
  const hand = session.hands.get(playerId) ?? [];
  hand.push(tile);
  session.hands.set(playerId, hand);
  if (session.autoSort) refreshPlayerHandDisplay(session, runtime, playerId);
  applyTingHandLock(session, runtime, playerId);
  if (session.tingSeats.has(session.currentTurnSeat)) {
    session.tingDiscards.set(
      playerId,
      readyDiscards(hand, session.melds.get(playerId) ?? []),
    );
  }
  if (
    player instanceof Player &&
    !session.tingSeats.has(session.currentTurnSeat) &&
    canSelfGang(session, playerId)
  ) {
    giveItem(player, "mahjong:mahjong_action_gang", "§d暗杠/补杠");
  }
  if (!isAway) {
    giveTingItemIfReady(session, playerId);
  }
  const awayName =
    player instanceof Player
      ? player.name
      : world.getEntity(playerId)?.nameTag ?? `座位${session.currentTurnSeat + 1}`;
  const isTing = session.tingSeats.has(session.currentTurnSeat);
  const isDoraDraw = session.doraTile === tile;
  const melds = session.melds.get(playerId) ?? [];
  if (isAway) {
    // 离线玩家能胡就胡;听牌后自摸宝牌直接胡
    if (isTing && (canWin(hand, melds) || isDoraDraw)) {
      declareWin(playerId, awayName, session.roomId, runtime, tile, "self");
      return;
    }
    system.runTimeout(
      () => autoDiscardForAway(session, runtime, playerId, tile),
      10,
    );
    return;
  }
  if (isTing && isDoraDraw) {
    // 听牌后自摸宝牌:直接胡
    declareWin(playerId, awayName, session.roomId, runtime, tile, "self");
    return;
  }
  if (isTing && canWin(hand, melds)) {
    // 普通自摸也使用胡牌物品,可选择胡或跳过
    session.pendingAction = {
      discardPlayerId: playerId,
      tileId: tile,
      eligible: [{ playerId, actions: ["hu"] }],
      index: 0,
      source: "self",
    };
    promptNextAction(session, runtime);
    return;
  }
  if (isTing) {
    // 听牌后摸到非胡/非宝牌:自动打出刚摸的牌
    system.runTimeout(
      () => autoDiscardForAway(session, runtime, playerId, tile, false),
      10,
    );
    return;
  }
  if (player instanceof Player) {
    player.sendMessage(`§a轮到你,自动摸到 ${tileDisplayName(tile)}`);
  }
  runtime.announce(session.roomId, `§e轮到 ${awayName} 行动`);
}

function declareTing(
  player: Player,
  roomId: number,
  runtime: MinigameRuntime,
): void {
  const session = getSession(roomId);
  if (!session || session.presetName !== "mudanjiang" || session.roundOver) return;
  const seat = playerSeatIndex(session, player.id);
  if (seat !== session.currentTurnSeat) {
    player.sendMessage("§c还没轮到你,不能报听");
    return;
  }
  if (session.tingSeats.has(seat)) {
    player.sendMessage("§c你已经听牌了");
    return;
  }
  const hand = session.hands.get(player.id) ?? [];
  const melds = session.melds.get(player.id) ?? [];
  const readyNow = readyTiles(hand, melds);
  const discards = readyDiscards(hand, melds);
  if (readyNow.length === 0 && discards.length === 0) {
    player.sendMessage("§c当前手牌还没有听牌");
    return;
  }
  if (!session.openedPlayers.has(player.id)) {
    player.sendMessage("§c必须先开门(吃/碰/明杠)才能听牌");
    return;
  }
  // 听牌后手牌至少剩 4 张,不能手把一
  if (readyNow.length > 0 && hand.length < 4) {
    player.sendMessage("§c不能手把一,最少剩4张手牌才能听");
    return;
  }
  if (readyNow.length === 0 && hand.length - 1 < 4) {
    player.sendMessage("§c不能手把一,最少剩4张手牌才能听");
    return;
  }
  const waits = new Set<string>();
  if (readyNow.length > 0) {
    for (const w of readyNow) waits.add(w);
  } else {
    for (const d of discards) {
      const idx = hand.indexOf(d);
      const rest = [...hand];
      rest.splice(idx, 1);
      for (const w of readyTiles(rest, melds)) waits.add(w);
    }
  }
  session.tingSeats.add(seat);
  session.tingDiscards.set(player.id, discards);
  // 暗杠在听牌且打出牌后才亮出;这里如果是打出牌后补叫听,则立即亮出
  const doraReplaced = session.discardedThisTurn.has(player.id)
    ? revealMeldsOnTing(session, runtime, player.id)
    : false;
  player.sendMessage(
    readyNow.length > 0
      ? `§a你已听牌!听:${[...waits].map(tileDisplayName).join("、")}`
      : `§a你已听牌!可打:${discards.map(tileDisplayName).join("、")} 听:${[...waits].map(tileDisplayName).join("、")}`,
  );
  if (
    session.doraTile &&
    !doraReplaced &&
    session.discardedThisTurn.has(player.id)
  ) {
    player.sendMessage(`§b宝牌:${tileDisplayName(session.doraTile)}`);
    session.doraTold.add(player.id);
    maybeRevealDoraWhenAllTingAndDiscarded(session, runtime);
  }
  if (session.autoSort) refreshPlayerHandDisplay(session, runtime, player.id);
  // 听牌后先不暗置,等打出牌后再暗置锁定
  clearTingItemsForAll(session);
  runtime.announce(session.roomId, `§e${player.name} 听牌`);
}

const ACTION_ITEM_IDS = [
  "mahjong:mahjong_action_chi",
  "mahjong:mahjong_action_peng",
  "mahjong:mahjong_action_gang",
  "mahjong:mahjong_action_hu",
  "mahjong:mahjong_action_guo",
];

function clearActionItems(player: Player): void {
  const container = player.getComponent("inventory")?.container;
  if (!container) return;
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (item && ACTION_ITEM_IDS.includes(item.typeId)) {
      container.setItem(i, undefined);
    }
  }
}

/** 移除所有玩家身上的“听”物品(听牌选项只在满足听牌手牌时发放) */
function clearTingItemsForAll(session: RoomSession): void {
  for (const pid of session.joinOrder) {
    const p = world.getEntity(pid);
    if (!(p instanceof Player)) continue;
    const container = p.getComponent("inventory")?.container;
    if (!container) continue;
    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);
      if (item?.typeId === "mahjong:mahjong_action_ting") {
        container.setItem(i, undefined);
      }
    }
  }
}

/** 当前回合玩家如果手牌“差一张就能胡”,才发放听牌物品 */
function giveTingItemIfReady(
  session: RoomSession,
  playerId: string,
): void {
  const player = world.getEntity(playerId);
  if (!(player instanceof Player)) return;
  const seat = playerSeatIndex(session, playerId);
  if (seat < 0) return;
  if (session.tingSeats.has(seat)) return;
  const hand = session.hands.get(playerId) ?? [];
  if (readyDiscards(hand, session.melds.get(playerId) ?? []).length > 0) {
    giveItem(player, "mahjong:mahjong_action_ting", "§e听");
  }
}

/** 胡牌结算时,把所有人的手牌/副露和宝牌都翻成亮置展示 */
function revealAllForShowdown(
  session: RoomSession,
  runtime: MinigameRuntime,
): void {
  const dim = runtime.roomDim(session.roomId);
  const revealList = (
    list: { location: { x: number; y: number; z: number }; tileId: string }[],
  ): void => {
    for (const entry of list) {
      try {
        const b = dim.getBlock(entry.location);
        if (!b) continue;
        const curPerm = b.permutation as any;
        const curDir =
          curPerm.getState("minecraft:cardinal_direction") ?? "north";
        const perm = BlockPermutation.resolve(b.typeId as never, {
          "mahjong:pose": "up",
          "minecraft:cardinal_direction": curDir,
        } as never);
        dim.setBlockPermutation(entry.location, perm);
      } catch {
        // ignore
      }
    }
  };
  for (const list of session.handDisplays.values()) revealList(list);
  for (const list of session.meldDisplays.values()) revealList(list);
  if (session.doraLocation && session.doraTile) {
    placeTileBlock(
      dim,
      session.doraLocation,
      session.doraTile,
      "up",
      "north",
    );
  }
}

/** 四家均听牌且都已打出牌(手牌全暗置)时,把宝牌明置 */
function maybeRevealDoraWhenAllTingAndDiscarded(
  session: RoomSession,
  runtime: MinigameRuntime,
): void {
  if (session.doraRevealedPublicly || !session.doraTile || !session.doraLocation) {
    return;
  }
  const count = session.joinOrder.length;
  if (count === 0) return;
  const allTingAndDiscarded = session.joinOrder.every((pid) =>
    session.doraTold.has(pid),
  );
  if (!allTingAndDiscarded) return;
  session.doraRevealedPublicly = true;
  placeTileBlock(
    runtime.roomDim(session.roomId),
    session.doraLocation,
    session.doraTile,
    "up",
    "north",
  );
  runtime.announce(
    session.roomId,
    `§b四家均已听牌并打出,宝牌明置:${tileDisplayName(session.doraTile)}`,
  );
}

/** 玩家完成一次吃/碰/杠后,重新判定并发放仍有效的行动物品(杠/听) */
function refreshTurnActionItems(
  session: RoomSession,
  player: Player,
): void {
  const seat = playerSeatIndex(session, player.id);
  clearActionItems(player);
  clearTingItemsForAll(session);
  if (seat < 0) return;
  if (session.tingSeats.has(seat)) return;
  if (canSelfGang(session, player.id)) {
    giveItem(player, "mahjong:mahjong_action_gang", "§d暗杠/补杠");
  }
  giveTingItemIfReady(session, player.id);
}

/** 返回所有可能的吃牌组合(need 为手牌需打出的两张) */
function chiOptions(hand: string[], tileId: string): string[][] {
  const suit = tileSuit(tileId);
  if (suit === "mahjong_e") return [];
  const n = tileNum(tileId);
  const combos: string[][] = [];
  if (n >= 1 && n <= 7) combos.push([`${suit}${n}`, `${suit}${n + 1}`, `${suit}${n + 2}`]);
  if (n >= 2 && n <= 8) combos.push([`${suit}${n - 1}`, `${suit}${n}`, `${suit}${n + 1}`]);
  if (n >= 3 && n <= 9) combos.push([`${suit}${n - 2}`, `${suit}${n - 1}`, `${suit}${n}`]);
  const result: string[][] = [];
  for (const combo of combos) {
    const need = combo.filter((t) => t !== tileId);
    if (need.every((t) => hand.includes(t))) result.push(need);
  }
  return result;
}

function canChiWith(hand: string[], tileId: string): string[] | undefined {
  return chiOptions(hand, tileId)[0];
}

function beginActionPhase(
  session: RoomSession,
  runtime: MinigameRuntime,
  discardPlayerId: string,
  tileId: string,
): void {
  maybeReplaceDora(session, runtime);
  const count = session.joinOrder.length;
  const eligible: {
    playerId: string;
    actions: string[];
    tier: number;
    dist: number;
  }[] = [];
  const discardSeat = playerSeatIndex(session, discardPlayerId);
  const nextSeat = (discardSeat + 1) % count;

  for (const playerId of session.joinOrder) {
    if (playerId === discardPlayerId) continue;
    const seat = playerSeatIndex(session, playerId);
    const hand = session.hands.get(playerId) ?? [];
    const melds = session.melds.get(playerId) ?? [];
    const actions: string[] = [];
    let tier = 99;
    const canHu =
      session.tingSeats.has(seat) && canWin([...hand, tileId], melds);
    // 禁止手把一:只剩 4 张及以下手牌时,不能再吃/碰/明杠/吃听
    const canClaim = hand.length > 4;
    // 吃听可以吃任意一家打出的牌;普通吃只能吃下家
    const canChiTing = canClaim && canChiTingWith(hand, tileId, melds);
    const cnt = hand.filter((t) => t === tileId).length;
    const canPeng = canClaim && cnt >= 2;
    const canGang = canClaim && cnt >= 3;
    const canChi =
      canClaim && seat === nextSeat && canChiWith(hand, tileId) !== undefined;

    if (canHu) actions.push("hu");
    if (session.tingSeats.has(seat)) {
      // 听牌后只能胡,不能吃/碰/杠
      if (actions.length === 0) continue;
      tier = 0;
    } else {
      // 同一玩家可同时获得吃/碰/杠等多个合法选项
      if (canChiTing) actions.push("chi_ting");
      if (canPeng) actions.push("peng");
      if (canGang) actions.push("gang");
      if (canChi) actions.push("chi");
      if (actions.includes("hu")) tier = 0;
      else if (actions.includes("chi_ting")) tier = 1;
      else if (actions.includes("peng") || actions.includes("gang")) tier = 2;
      else if (actions.includes("chi")) tier = 3;
    }

    if (actions.length > 0) {
      eligible.push({
        playerId,
        actions,
        tier,
        dist: counterClockwiseDistance(discardSeat, seat, count),
      });
    }
  }

  // 严格优先级:胡 > 吃听 > 碰/杠 > 吃;同层按逆时针顺序(截胡/近家优先)
  eligible.sort((a, b) => a.tier - b.tier || a.dist - b.dist);

  if (eligible.length === 0) {
    afterDiscardResolution(session, runtime);
    return;
  }

  session.pendingAction = {
    discardPlayerId,
    tileId,
    eligible: eligible.map(({ playerId, actions }) => ({ playerId, actions })),
    index: 0,
  };
  promptNextAction(session, runtime);
}

function promptNextAction(session: RoomSession, runtime: MinigameRuntime): void {
  const pending = session.pendingAction;
  if (!pending) return;
  if (pending.index >= pending.eligible.length) {
    session.pendingAction = undefined;
    if (pending.source === "self") {
      const p = world.getEntity(pending.discardPlayerId);
      if (p instanceof Player) p.sendMessage("§a你选择不胡,请打出一张手牌");
      return;
    }
    afterDiscardResolution(session, runtime);
    return;
  }
  const entry = pending.eligible[pending.index];
  const player = world.getEntity(entry.playerId);
  const isAway = session.away.has(entry.playerId);
  if (isAway) {
    const awayName =
      player instanceof Player
        ? player.name
        : world.getEntity(entry.playerId)?.nameTag ??
          `座位${playerSeatIndex(session, entry.playerId) + 1}`;
    if (entry.actions.includes("hu")) {
      declareWin(
        entry.playerId,
        awayName,
        session.roomId,
        runtime,
        pending.tileId,
        pending.source === "self" ? "self" : "discard",
      );
    } else {
      pending.index++;
      promptNextAction(session, runtime);
    }
    return;
  }
  if (!(player instanceof Player)) {
    pending.index++;
    promptNextAction(session, runtime);
    return;
  }
  clearActionItems(player);
  const actions = entry.actions;
  if (actions.includes("ting")) {
    giveItem(player, "mahjong:mahjong_action_ting", "§e听");
    giveItem(player, "mahjong:mahjong_action_guo", "§7过");
    player.sendMessage("§e你已满足听牌条件,可以选择听牌,或选“过”继续");
    return;
  }
  if (actions.includes("hu")) giveItem(player, "mahjong:mahjong_action_hu", "§c胡");
  if (actions.includes("peng")) giveItem(player, "mahjong:mahjong_action_peng", "§b碰");
  if (actions.includes("gang")) giveItem(player, "mahjong:mahjong_action_gang", "§d杠");
  if (actions.includes("chi")) giveItem(player, "mahjong:mahjong_action_chi", "§a吃");
  if (actions.includes("chi_ting")) giveItem(player, "mahjong:mahjong_action_chi", "§e吃听");
  giveItem(player, "mahjong:mahjong_action_guo", "§7过");
  player.sendMessage(
    `§e你可以对 ${tileDisplayName(pending.tileId)} 执行:${actions.join("、")};使用物品选择,或选“过”`,
  );
}

/** 判断副露是否为刻子/杠(三张或四张相同),只有这种才能补杠 */
function isPungMeld(m: MeldEntry): boolean {
  const tiles = m.tiles ?? Array(3).fill(m.tileId);
  return tiles.length >= 3 && tiles.every((t) => t === m.tileId);
}

function canSelfGang(session: RoomSession, playerId: string): boolean {
  const seat = playerSeatIndex(session, playerId);
  if (session.tingSeats.has(seat)) return false;
  const hand = session.hands.get(playerId) ?? [];
  const counts = new Map<string, number>();
  for (const t of hand) counts.set(t, (counts.get(t) ?? 0) + 1);
  // 暗杠会新增一杠并导致手把一,只有杠完并打出后手牌仍 >=4 才允许
  const hasConcealed = [...counts.values()].some((c) => c >= 4);
  if (hasConcealed && hand.length >= 8) return true;
  // 补杠只能补“刻子/碰”,不能补“顺子/吃”
  const meldList = session.melds.get(playerId) ?? [];
  return meldList.some((m) => isPungMeld(m) && hand.includes(m.tileId));
}

function handleSelfGang(
  player: Player,
  roomId: number,
  runtime: MinigameRuntime,
): void {
  const session = getSession(roomId);
  if (!session || session.presetName !== "mudanjiang" || session.roundOver) return;
  const seat = playerSeatIndex(session, player.id);
  if (seat !== session.currentTurnSeat) {
    player.sendMessage("§c还没轮到你,不能杠");
    return;
  }
  if (session.tingSeats.has(seat)) {
    player.sendMessage("§c听牌后不能杠");
    return;
  }
  const hand = session.hands.get(player.id) ?? [];
  const counts = new Map<string, number>();
  for (const t of hand) counts.set(t, (counts.get(t) ?? 0) + 1);

  // 暗杠:手牌有 4 张相同
  const concealed = [...counts.entries()].find(([, c]) => c >= 4)?.[0];
  if (concealed) {
    if (hand.length < 8) {
      player.sendMessage("§c不能手把一,不能再暗杠");
      return;
    }

    let removed = 0;
    for (let i = hand.length - 1; i >= 0 && removed < 4; i--) {
      if (hand[i] === concealed) {
        hand.splice(i, 1);
        removed++;
      }
    }
    session.hands.set(player.id, hand);
    const melds = session.melds.get(player.id) ?? [];
    melds.push({
      location: { x: 0, y: 0, z: 0 },
      tileId: concealed,
      tiles: [concealed, concealed, concealed, concealed],
      concealed: true,
    });
    session.melds.set(player.id, melds);
    refreshMeldDisplay(session, runtime, player.id);
    maybeReplaceDora(session, runtime);
    const draw = takeFromWallTail(session, runtime);
    if (draw) {
      hand.push(draw);
      session.hands.set(player.id, hand);
    }
    if (session.autoSort) refreshPlayerHandDisplay(session, runtime, player.id);
    applyTingHandLock(session, runtime, player.id);
    refreshTurnActionItems(session, player);
    runtime.announce(session.roomId, `§e${player.name} 暗杠了`);
    player.sendMessage("§a你暗杠了,请打出一张手牌");
    return;
  }

  // 补杠:已有副露 + 手牌有同张
  const meldList = session.melds.get(player.id) ?? [];
  for (const m of meldList) {
    if (isPungMeld(m) && hand.includes(m.tileId)) {
      const idx = hand.indexOf(m.tileId);
      hand.splice(idx, 1);
      session.hands.set(player.id, hand);
      if (!m.tiles) m.tiles = [m.tileId, m.tileId, m.tileId];
      m.tiles.push(m.tileId);
      session.melds.set(player.id, meldList);
      refreshMeldDisplay(session, runtime, player.id);
      const draw = takeFromWallTail(session, runtime);
      if (draw) {
        hand.push(draw);
        session.hands.set(player.id, hand);
      }
      if (session.autoSort) refreshPlayerHandDisplay(session, runtime, player.id);
      applyTingHandLock(session, runtime, player.id);
      refreshTurnActionItems(session, player);
      runtime.announce(
        session.roomId,
        `§e${player.name} 补杠了 ${tileDisplayName(m.tileId)}`,
      );
      player.sendMessage("§a你补杠了,请打出一张手牌");
      return;
    }
  }

  player.sendMessage("§c当前没有可以杠的牌");
}

function handlePresetAction(
  player: Player,
  roomId: number,
  itemId: string,
  runtime: MinigameRuntime,
  itemName?: string,
): void {
  const session = getSession(roomId);
  if (!session || session.presetName !== "mudanjiang" || session.roundOver) return;
  const pending = session.pendingAction;
  if (!pending) {
    if (itemId === "mahjong:mahjong_action_gang") {
      handleSelfGang(player, roomId, runtime);
    } else {
      player.sendMessage("§c当前没有可执行的动作");
    }
    return;
  }
  const entry = pending.eligible[pending.index];
  if (!entry || entry.playerId !== player.id) {
    player.sendMessage("§c还没轮到你选择动作");
    return;
  }

  // 打出牌后自己满足听牌条件:先选择听或过,再让其他玩家行动
  if (pending.source === "post_discard_ting") {
    if (itemId === "mahjong:mahjong_action_ting") {
      clearActionItems(player);
      declareTing(player, roomId, runtime);
      session.pendingAction = undefined;
      system.runTimeout(
        () => beginActionPhase(session, runtime, pending.discardPlayerId, pending.tileId),
        10,
      );
      return;
    }
    if (itemId === "mahjong:mahjong_action_guo") {
      clearActionItems(player);
      session.pendingAction = undefined;
      system.runTimeout(
        () => beginActionPhase(session, runtime, pending.discardPlayerId, pending.tileId),
        10,
      );
      return;
    }
    player.sendMessage("§c请选择听或过");
    return;
  }

  const tileId = pending.tileId;
  const hand = session.hands.get(player.id) ?? [];

  if (itemId === "mahjong:mahjong_action_guo") {
    clearActionItems(player);
    if (pending.source === "self") {
      session.pendingAction = undefined;
      refreshTurnActionItems(session, player);
      player.sendMessage("§a你选择不胡,请打出一张手牌");
      return;
    }
    pending.index++;
    promptNextAction(session, runtime);
    return;
  }

  if (itemId === "mahjong:mahjong_action_hu") {
    clearActionItems(player);
    declareWin(
      player.id,
      player.name,
      roomId,
      runtime,
      tileId,
      pending.source === "self" ? "self" : "discard",
    );
    return;
  }

  if (itemId === "mahjong:mahjong_action_peng") {
    // 碰:移除两张,加入副露
    let removed = 0;
    for (let i = hand.length - 1; i >= 0 && removed < 2; i--) {
      if (hand[i] === tileId) {
        hand.splice(i, 1);
        removed++;
      }
    }
    removeDiscardFromRiver(session, runtime, pending.discardPlayerId, tileId);
    session.hands.set(player.id, hand);
    const melds = session.melds.get(player.id) ?? [];
    melds.push({
      location: { x: 0, y: 0, z: 0 },
      tileId,
      tiles: [tileId, tileId, tileId],
    });
    session.melds.set(player.id, melds);
    refreshMeldDisplay(session, runtime, player.id);
    session.openedPlayers.add(player.id);
    maybeReplaceDora(session, runtime);
    if (session.autoSort) refreshPlayerHandDisplay(session, runtime, player.id);
    session.pendingAction = undefined;
    session.currentTurnSeat = playerSeatIndex(session, player.id);
    session.discardedThisTurn.delete(player.id);
    refreshTurnActionItems(session, player);
    runtime.announce(session.roomId, `§e${player.name} 碰了 ${tileDisplayName(tileId)}`);
    player.sendMessage("§a你碰了这张牌,请打出一张手牌");
    return;
  }

  if (itemId === "mahjong:mahjong_action_gang") {
    let removed = 0;
    for (let i = hand.length - 1; i >= 0 && removed < 3; i--) {
      if (hand[i] === tileId) {
        hand.splice(i, 1);
        removed++;
      }
    }
    removeDiscardFromRiver(session, runtime, pending.discardPlayerId, tileId);
    session.hands.set(player.id, hand);
    const melds = session.melds.get(player.id) ?? [];
    melds.push({
      location: { x: 0, y: 0, z: 0 },
      tileId,
      tiles: [tileId, tileId, tileId, tileId],
    });
    session.melds.set(player.id, melds);
    refreshMeldDisplay(session, runtime, player.id);
    session.openedPlayers.add(player.id);
    maybeReplaceDora(session, runtime);
    if (session.autoSort) refreshPlayerHandDisplay(session, runtime, player.id);
    // 杠后从尾部摸一张
    const draw = takeFromWallTail(session, runtime);
    if (draw) {
      hand.push(draw);
      session.hands.set(player.id, hand);
      if (session.autoSort) refreshPlayerHandDisplay(session, runtime, player.id);
    }
    session.pendingAction = undefined;
    session.currentTurnSeat = playerSeatIndex(session, player.id);
    session.discardedThisTurn.delete(player.id);
    refreshTurnActionItems(session, player);
    runtime.announce(session.roomId, `§e${player.name} 杠了 ${tileDisplayName(tileId)}`);
    player.sendMessage("§a你杠了这张牌,请打出一张手牌");
    return;
  }

  if (itemId === "mahjong:mahjong_action_chi") {
    const options = chiOptions(hand, tileId);
    if (options.length === 0) {
      player.sendMessage("§c无法吃这张牌");
      return;
    }
    const isChiTing = itemName?.includes("吃听") ?? false;
    let usable = options;
    if (isChiTing) {
      usable = options.filter((need) =>
        canChiTingWithNeed(
          hand,
          tileId,
          need,
          session.melds.get(player.id) ?? [],
        ),
      );
      if (usable.length === 0) {
        player.sendMessage("§c吃听失败:吃完后没有可打出的听牌");
        return;
      }
    }
    const doChi = (need: string[]) =>
      performChi(
        player,
        roomId,
        runtime,
        tileId,
        need,
        isChiTing,
        pending.discardPlayerId,
      );
    if (usable.length === 1) {
      doChi(usable[0]);
      return;
    }
    // 多种吃法:让玩家选择组合
    const form = new CustomForm(
      player,
      isChiTing ? "选择吃听组合" : "选择吃牌组合",
    );
    form.spacer();
    form.label("请选择要吃的组合:");
    for (const need of usable) {
      const combo = [need[0], need[1], tileId].sort((a, b) =>
        tileSortValue(a) - tileSortValue(b),
      );
      form.button(combo.map(tileDisplayName).join(" "), () => {
        form.close();
        doChi(need);
      });
    }
    form.button("取消", () => form.close());
    form.show().catch((error) =>
      console.warn("[Bearcade Mahjong] 吃牌选择失败", error),
    );
    return;
  }

  player.sendMessage("§c未知动作");
}

/** 执行一次吃牌(need 为从手牌移除的两张,被吃牌直接进副露) */
function performChi(
  player: Player,
  roomId: number,
  runtime: MinigameRuntime,
  tileId: string,
  need: string[],
  isChiTing: boolean,
  discardPlayerId: string,
): void {
  const session = getSession(roomId);
  if (!session || session.presetName !== "mudanjiang" || session.roundOver) return;
  const hand = session.hands.get(player.id) ?? [];
  for (const t of need) {
    const idx = hand.indexOf(t);
    if (idx >= 0) hand.splice(idx, 1);
  }
  removeDiscardFromRiver(session, runtime, discardPlayerId, tileId);
  session.hands.set(player.id, hand);
  const melds = session.melds.get(player.id) ?? [];
  melds.push({
    location: { x: 0, y: 0, z: 0 },
    tileId,
    tiles: [need[0], need[1], tileId],
  });
  session.melds.set(player.id, melds);
  refreshMeldDisplay(session, runtime, player.id);
  session.openedPlayers.add(player.id);
  maybeReplaceDora(session, runtime);
  if (session.autoSort) refreshPlayerHandDisplay(session, runtime, player.id);
  if (isChiTing) {
    const discards = readyDiscards(hand, melds);
    const waits = new Set<string>();
    for (const d of discards) {
      const idx = hand.indexOf(d);
      const rest = [...hand];
      rest.splice(idx, 1);
      for (const w of readyTiles(rest, melds)) waits.add(w);
    }
    session.tingSeats.add(playerSeatIndex(session, player.id));
    session.tingDiscards.set(player.id, discards);
    // 暗杠等打出牌后再亮出;宝牌也等打出牌后再告知
    clearTingItemsForAll(session);
    player.sendMessage(
      `§a吃听成功!可打:${discards.map(tileDisplayName).join("、")} 听:${[...waits].map(tileDisplayName).join("、")}`,
    );
  }
  session.pendingAction = undefined;
  session.currentTurnSeat = playerSeatIndex(session, player.id);
  session.discardedThisTurn.delete(player.id);
  refreshTurnActionItems(session, player);
  const comboName = [need[0], need[1], tileId]
    .sort((a, b) => tileSortValue(a) - tileSortValue(b))
    .map(tileDisplayName)
    .join(" ");
  runtime.announce(
    session.roomId,
    isChiTing
      ? `§e${player.name} 吃听 ${comboName}`
      : `§e${player.name} 吃了 ${comboName}`,
  );
  player.sendMessage("§a你吃了这张牌,请打出一张手牌");
}

function isKanchanWait(hand: string[], winTile: string): boolean {
  const suit = tileSuit(winTile);
  if (suit === "mahjong_e") return false;
  const n = tileNum(winTile);
  return (
    hand.includes(`${suit}${n - 1}`) &&
    hand.includes(`${suit}${n + 1}`) &&
    !hand.includes(winTile)
  );
}

function declareWin(
  playerId: string,
  playerName: string,
  roomId: number,
  runtime: MinigameRuntime,
  winTile: string,
  source: "discard" | "self",
): void {
  const session = getSession(roomId);
  if (!session || session.presetName !== "mudanjiang") return;
  const seat = playerSeatIndex(session, playerId);
  const isDora = session.doraTile === winTile;
  const handBefore = (session.hands.get(playerId) ?? []).filter((t) => t !== winTile);
  const isBaoZhongBao =
    source === "self" && isDora && isKanchanWait(handBefore, winTile);

  const count = session.joinOrder.length;
  // 未听牌点炮:点炮者一人包赔;听牌后点炮:其他各家各出 1 分
  const discarderIsTing =
    source === "discard" && session.lastDiscard
      ? session.tingSeats.has(
          playerSeatIndex(session, session.lastDiscard.playerId),
        )
      : false;
  let perPlayer = 0;
  let discarderPays = false;
  if (source === "discard" && !discarderIsTing) {
    perPlayer = 0;
    discarderPays = true;
  } else if (source === "discard") {
    perPlayer = 1;
  } else if (isBaoZhongBao) {
    perPlayer = 6;
  } else if (isDora) {
    perPlayer = 3;
  } else {
    perPlayer = 2;
  }

  if (discarderPays && session.lastDiscard) {
    const payerId = session.lastDiscard.playerId;
    const fullPoint = count === 3 ? 2 : 3;
    const cur = session.scores.get(payerId) ?? 0;
    session.scores.set(payerId, cur - fullPoint);
    const winScore = session.scores.get(playerId) ?? 0;
    session.scores.set(playerId, winScore + fullPoint);
    runtime.announce(
      roomId,
      `§e${playerName} 胡牌!(未听点炮) ${session.lastDiscard.playerId === playerId ? "" : `点炮者-${fullPoint}`}`,
    );
  } else {
    for (const pid of session.joinOrder) {
      if (pid === playerId) continue;
      const cur = session.scores.get(pid) ?? 0;
      session.scores.set(pid, cur - perPlayer);
    }
    const winScore = session.scores.get(playerId) ?? 0;
    session.scores.set(playerId, winScore + perPlayer * (count - 1));
    const type = isBaoZhongBao
      ? "宝中宝"
      : isDora
        ? "摸宝"
        : source === "self"
          ? "自摸"
          : "点炮";
    runtime.announce(
      roomId,
      `§e${playerName} ${type}胡牌!赢得 ${perPlayer * (count - 1)} 分`,
    );
  }

  refreshScoreHud(roomId, runtime);
  session.roundOver = true;
  session.pendingAction = undefined;
  for (const pid of session.joinOrder) {
    const p = world.getEntity(pid);
    if (p instanceof Player) clearActionItems(p);
  }
  revealAllForShowdown(session, runtime);
  if (seat !== session.dealerSeat) {
    session.dealerSeat = (session.dealerSeat + 1) % count;
  }
  const nextDealerId = playerIdAtSeat(session, session.dealerSeat);
  const nextDealerName = nextDealerId
    ? world.getEntity(nextDealerId)?.nameTag ?? "庄家"
    : "庄家";
  runtime.announce(roomId, `§a${playerName} 胡牌!本局结束,分数保留`);
  runtime.announce(
    roomId,
    `§e房主可用设置书选择“下一局”;下一局庄家:${nextDealerName}`,
  );
}

function maybeReplaceDora(session: RoomSession, runtime: MinigameRuntime): boolean {
  if (!session.doraTile || !session.doraLocation) return false;
  let count = 0;
  for (const melds of session.melds.values()) {
    // 只有明置副露才计入亮出计数,暗杠在听牌前不算;按实际牌张数统计
    for (const m of melds) {
      if (m.concealed) continue;
      const tiles = m.tiles ?? Array(3).fill(m.tileId);
      count += tiles.filter((t) => t === session.doraTile).length;
    }
  }
  for (const slots of session.discardSlots.values()) {
    count += slots.filter((s) => s && s.tileId === session.doraTile).length;
  }
  if (count >= 3) {
    const oldTile = session.doraTile;
    const oldLocation = session.doraLocation;
    const newTile = takeFromWallTail(session, runtime);
    if (!newTile) return false;
    const dim = runtime.roomDim(session.roomId);
    session.doraTile = newTile;
    session.doraReplaceCount++;
    if (!placeDoraAtReservedSpot(session, runtime, newTile) && session.doraLocation) {
      placeTileBlock(dim, session.doraLocation, newTile, "down", "north");
    }
    // 如果已经四家听牌公开明置,新宝也保持明置
    if (session.doraRevealedPublicly && session.doraLocation) {
      placeTileBlock(dim, session.doraLocation, newTile, "up", "north");
    }
    // 新宝位置和旧位置不同时,清掉旧宝牌指示块
    if (
      oldLocation &&
      (!session.doraLocation || !sameLocation(oldLocation, session.doraLocation))
    ) {
      try {
        dim.setBlockPermutation(
          oldLocation,
          BlockPermutation.resolve("minecraft:air" as never),
        );
      } catch {
        // ignore
      }
    }
    // 旧宝牌放入当前牌河弃置
    const seat = session.currentTurnSeat;
    const pid = seat >= 0 ? playerIdAtSeat(session, seat) : undefined;
    if (pid) {
      const slots = session.discardSlots.get(pid) ?? [];
      let index = 0;
      let pos = discardPosition(seat, index);
      while (
        slots.some((s) => s && sameLocation(s.location, pos)) &&
        index < 200
      ) {
        index++;
        pos = discardPosition(seat, index);
      }
      slots.push({ location: pos, tileId: oldTile });
      session.discardSlots.set(pid, slots);
      placeTileBlock(
        dim,
        pos,
        oldTile,
        "up",
        ["north", "west", "south", "east"][seat] ?? "north",
      );
    }
    // 宝牌不公开:只私下告知已听牌玩家新宝是什么
    runtime.announce(session.roomId, "§b宝牌已更换(暗置)");
    for (const pid of session.joinOrder) {
      const seat = playerSeatIndex(session, pid);
      // 只通知已经被告知过宝牌的听牌玩家;新听牌玩家等打出牌后再告知当前宝牌
      if (!session.tingSeats.has(seat) || !session.doraTold.has(pid)) continue;
      const p = world.getEntity(pid);
      if (p instanceof Player) {
        p.sendMessage(`§b宝牌已更换为新宝:${tileDisplayName(newTile)}`);
      }
    }
    return true;
  }
  return false;
}

function placeTileBlock(
  dim: import("@minecraft/server").Dimension,
  pos: { x: number; y: number; z: number },
  tileId: string,
  pose: string,
  direction: string,
): void {
  try {
    const perm = BlockPermutation.resolve(`mahjong:${tileId}` as never, {
      "mahjong:pose": pose,
      "minecraft:cardinal_direction": direction,
    } as never);
    dim.setBlockPermutation(pos, perm);
    return;
  } catch (error) {
    console.warn(
      `[Bearcade Mahjong] 带姿态放置失败 ${tileId} @ ${JSON.stringify(pos)}`,
      error,
    );
  }
  try {
    const perm = BlockPermutation.resolve(`mahjong:${tileId}` as never);
    dim.setBlockPermutation(pos, perm);
  } catch (error) {
    console.warn(
      `[Bearcade Mahjong] 默认放置失败 ${tileId} @ ${JSON.stringify(pos)}`,
      error,
    );
  }
}

function tileIdFromBlockType(typeId: string): string | undefined {
  if (!typeId.startsWith("mahjong:mahjong_")) return undefined;
  if (typeId.includes("stack")) return undefined;
  return typeId.slice("mahjong:".length); // 返回 mahjong_a9 这种内部 ID
}

function handleBreakMahjongBlock(
  event: import("@minecraft/server").PlayerBreakBlockAfterEvent,
  runtime: MinigameRuntime,
): void {
  const roomId = roomIdOfDimension(event.block.dimension.id, runtime);
  if (roomId === undefined) return;
  const session = getSession(roomId);
  if (!session || !session.started) return;
  const tileId = tileIdFromBlockType(event.brokenBlockPermutation.type.id);
  if (!tileId) return;
  const loc = event.block.location;

  // 1. 破坏的是手牌展示块
  for (const [pid, list] of session.handDisplays) {
    const entry = list.find((e) => sameLocation(e.location, loc));
    if (entry) {
      const hand = session.hands.get(pid);
      if (hand) {
        const idx = hand.indexOf(entry.tileId);
        if (idx >= 0) hand.splice(idx, 1);
      }
      session.handDisplays.set(
        pid,
        list.filter((e) => !sameLocation(e.location, loc)),
      );
      if (session.autoSort) refreshPlayerHandDisplay(session, runtime, pid);
      return;
    }
  }

  // 2. 破坏的是牌河里的牌:移除该牌,留下空位,由下一次打出时从头扫描补位
  for (const slots of session.discardSlots.values()) {
    const idx = slots.findIndex(
      (s) => s && s.tileId && sameLocation(s.location, loc),
    );
    if (idx >= 0 && slots[idx]?.tileId) {
      slots.splice(idx, 1);
      // 从牌河拿走的牌不自动回手牌;放到手牌两侧才会被自动理牌计入。
      return;
    }
  }

  // 3. 破坏的是自己/别人门前的副露牌
  for (const [pid, list] of session.melds) {
    const entry = list.find((e) => sameLocation(e.location, loc));
    if (entry) {
      session.melds.set(
        pid,
        list.filter((e) => !sameLocation(e.location, loc)),
      );
      if (session.autoSort) refreshPlayerHandDisplay(session, runtime, pid);
      return;
    }
  }
}

function handlePlaceMahjongBlock(
  event: import("@minecraft/server").PlayerPlaceBlockAfterEvent,
  runtime: MinigameRuntime,
): void {
  const roomId = roomIdOfDimension(event.block.dimension.id, runtime);
  if (roomId === undefined) return;
  const session = getSession(roomId);
  if (!session || !session.started) return;
  const tileId = tileIdFromBlockType(event.block.typeId);
  if (!tileId) return;
  const loc = event.block.location;
  const handList = session.handDisplays.get(event.player.id) ?? [];
  const seat = playerSeatIndex(session, event.player.id);
  const adjacentToHand = handList.some((e) => {
    const dx = e.location.x - loc.x;
    const dy = e.location.y - loc.y;
    const dz = e.location.z - loc.z;
    if (seat === 0 || seat === 2) {
      // 南/北家:手牌左右 = X 方向,前后不计入
      return dy === 0 && dz === 0 && Math.abs(dx) === 1;
    }
    if (seat === 1 || seat === 3) {
      // 西/东家:手牌左右 = Z 方向,前后不计入
      return dy === 0 && dx === 0 && Math.abs(dz) === 1;
    }
    return false;
  });

  if (adjacentToHand) {
    // 挨着手牌放置:计入该玩家手牌数据
    const hand = session.hands.get(event.player.id) ?? [];
    hand.push(tileId);
    session.hands.set(event.player.id, hand);
    if (session.autoSort) refreshPlayerHandDisplay(session, runtime, event.player.id);
  } else {
    // 其他放置:如果是牌河区域,记录到牌河槽位,防止后续打出覆盖
    let placed = false;
    for (const slots of session.discardSlots.values()) {
      const slot = slots.find((s) => s && sameLocation(s.location, loc));
      if (slot) {
        slot.tileId = tileId;
        placed = true;
        break;
      }
    }
    if (!placed) {
      const slots = session.discardSlots.get(event.player.id) ?? [];
      slots.push({ location: loc, tileId });
      session.discardSlots.set(event.player.id, slots);
    }
    // 同时记录为门前副露,便于破坏时识别
    const list = session.melds.get(event.player.id) ?? [];
    list.push({ location: loc, tileId });
    session.melds.set(event.player.id, list);
  }

  // 根据暗置模式设置默认放置姿态:暗置模式→down,否则→stand
  try {
    const b = event.block;
    const curPerm = b.permutation as any;
    if (curPerm.getState("mahjong:pose") !== undefined) {
      const dark = session.darkMode.has(event.player.id);
      const defaultPose = dark ? "down" : "stand";
      const curDir =
        curPerm.getState("minecraft:cardinal_direction") ?? "north";
      const perm = BlockPermutation.resolve(b.typeId as never, {
        "mahjong:pose": defaultPose,
        "minecraft:cardinal_direction": curDir,
      } as never);
      b.dimension.setBlockPermutation(b.location, perm);
    }
  } catch (error) {
    console.warn("[Bearcade Mahjong] 默认放置姿态设置失败", error);
  }
}

// ================= 计分器与骰子 =================

function buttonRoomId(dimensionId: string, runtime: MinigameRuntime): number | undefined {
  return roomIdOfDimension(dimensionId, runtime);
}

function isScoreButton(loc: { x: number; y: number; z: number }): { seat: number; delta: number } | undefined {
  for (let i = 0; i < SCORE_BUTTONS.length; i++) {
    const b = SCORE_BUTTONS[i];
    if (b.plus.x === loc.x && b.plus.y === loc.y && b.plus.z === loc.z) return { seat: i, delta: 1 };
    if (b.minus.x === loc.x && b.minus.y === loc.y && b.minus.z === loc.z) return { seat: i, delta: -1 };
  }
  return undefined;
}

function isDiceButton(loc: { x: number; y: number; z: number }): boolean {
  const cfg = getMahjongConfig();
  return cfg.dicePos.x === loc.x && cfg.dicePos.y === loc.y && cfg.dicePos.z === loc.z;
}

function handleScoreButton(roomId: number, seat: number, delta: number, runtime: MinigameRuntime): void {
  const session = getSession(roomId);
  if (!session || !session.started) return;
  const playerId = session.joinOrder[seat];
  if (!playerId) return;
  const current = session.scores.get(playerId) ?? 0;
  session.scores.set(playerId, current + delta);
  const player = world.getEntity(playerId);
  if (player instanceof Player) {
    player.sendMessage(`§e你的分数:${current + delta}`);
  }
  refreshScoreHud(roomId, runtime);
}

function handleDiceButton(roomId: number, runtime: MinigameRuntime): void {
  const result = Math.floor(Math.random() * 6) + 1;
  runtime.announce(roomId, `§a骰子点数:§e${result}`);
}

function refreshScoreHud(roomId: number, runtime: MinigameRuntime): void {
  const session = getSession(roomId);
  if (!session) return;
  for (const player of runtime.roomPlayers(roomId)) {
    const seatIndex = playerSeatIndex(session, player.id);
    const score = session.scores.get(player.id) ?? 0;
    setHudTitle(
      player,
      hudMessage([
        { text: "§e麻将 · 分数§r" },
        { text: "\n" },
        { text: `座位 ${seatIndex + 1}: ${score}` },
      ]),
      6000,
    );
  }
}

// ================= 房主 UI =================

export function openHostMenu(player: Player, roomId: number, runtime: MinigameRuntime): void {
  const session = getSession(roomId);
  if (!session) return;
  if (session.hostId !== player.id) {
    player.sendMessage("§c只有房主可以设置游戏");
    return;
  }
  const form = new CustomForm(player, "麻将 · 房主设置");
  form.spacer();
  form.label(
    `当前牌组:${tileCountForSelection(session.selectedTiles)} 张` +
      (session.presetId ? `(预设 ${session.presetId})` : "(自定义)"),
  );
  form.spacer();
  form.button("预设模式", () => {
    form.close();
    system.runTimeout(() => openPresetPicker(player, roomId, runtime), 2);
  });
  form.button("自定义模式", () => {
    form.close();
    system.runTimeout(() => openCustomModePicker(player, roomId, runtime), 2);
  });
  form.button("开始游戏", () => {
    form.close();
    system.runTimeout(() => hostStartGame(player, roomId, runtime), 2);
  });
  if (session.roundOver) {
    form.button("下一局(重新发牌)", () => {
      form.close();
      system.runTimeout(() => startNextMudanjiangRound(player, roomId, runtime), 2);
    });
  }
  form.button("结束游戏", () => {
    form.close();
    system.runTimeout(() => hostEndGame(player, roomId, runtime), 2);
  });
  form.button("关闭", () => form.close());
  form.show().catch((error) => console.warn("[Bearcade Mahjong] 房主菜单失败", error));
}

function hostStartGame(player: Player, roomId: number, runtime: MinigameRuntime): void {
  const session = getSession(roomId);
  if (!session || session.hostId !== player.id) return;
  const phase = runtime.getPhase(roomId);
  if (phase !== "idle" && phase !== "pending") {
    player.sendMessage("§c当前不是等待开局状态");
    return;
  }
  if (runtime.roomPlayers(roomId).length < runtime.config.minPlayers!) {
    player.sendMessage(`§c至少需要 ${runtime.config.minPlayers} 名玩家才能开始`);
    return;
  }
  if (session.selectedTiles.size === 0) {
    player.sendMessage("§c请先选择牌组");
    return;
  }
  if (!runtime.forceStartGame(roomId)) {
    player.sendMessage("§c开局失败,请确认房间状态与人数");
    return;
  }
  runtime.announce(roomId, `§e房主 ${player.name} 已开始游戏`);
}

function hostEndGame(player: Player, roomId: number, runtime: MinigameRuntime): void {
  const session = getSession(roomId);
  if (!session || session.hostId !== player.id) return;
  const phase = runtime.getPhase(roomId);
  if (phase === "running" || phase === "pending") {
    runtime.forceStopInDimension(runtime.roomDimensionId(roomId));
    runtime.announce(roomId, `§e房主 ${player.name} 结束了游戏`);
  } else {
    player.sendMessage("§c当前没有进行中的对局");
  }
}

/** 流局后由房主重开下一局:清桌、保留分数、重新发牌,庄家不变 */
function startNextMudanjiangRound(
  player: Player,
  roomId: number,
  runtime: MinigameRuntime,
): void {
  const session = getSession(roomId);
  if (!session || session.hostId !== player.id) return;
  if (!session.started || session.presetName !== "mudanjiang") {
    player.sendMessage("§c当前不是牡丹江麻将对局");
    return;
  }
  if (!session.roundOver) {
    player.sendMessage("§c当前没有可重开的已结束对局");
    return;
  }
  const dim = runtime.roomDim(roomId);
  clearHandDisplay(session, runtime);
  clearMeldDisplay(session, runtime);
  for (const slots of session.discardSlots.values()) {
    for (const s of slots) {
      if (!s) continue;
      try {
        dim.setBlockPermutation(
          s.location,
          BlockPermutation.resolve("minecraft:air" as never),
        );
      } catch {
        // ignore
      }
    }
  }
  clearTingItemsForAll(session);
  for (const pid of session.joinOrder) {
    const p = world.getEntity(pid);
    if (!(p instanceof Player)) continue;
    clearActionItems(p);
  }
  // 清除上一局宝牌指示块
  if (session.doraLocation) {
    try {
      dim.setBlockPermutation(
        session.doraLocation,
        BlockPermutation.resolve("minecraft:air" as never),
      );
    } catch {
      // ignore
    }
  }

  // 清空本局数据,但保留 scores
  session.hands.clear();
  session.handDisplays.clear();
  session.discardCounts.clear();
  session.discardSlots.clear();
  session.melds.clear();
  session.tingSeats.clear();
  session.tingDiscards.clear();
  session.discardedThisTurn.clear();
  session.doraTold.clear();
  session.doraRevealedPublicly = false;
  session.doraReplaceCount = 0;
  session.pendingLiuju = false;
  session.openedPlayers.clear();
  session.dealCursor = 0;
  session.drawIndex = 0;
  session.doraTile = undefined;
  session.doraLocation = undefined;
  session.lastDiscard = undefined;
  session.pendingAction = undefined;
  session.roundOver = false;

  buildStacks(roomId, runtime, session);
  session.wallBuilt = true;
  if (session.autoDeal) {
    dealGame(session, runtime, () => {
      const dealerId = playerIdAtSeat(session, session.dealerSeat);
      if (!dealerId) return;
      if (session.away.has(dealerId)) {
        system.runTimeout(
          () => autoDiscardForAway(session, runtime, dealerId),
          10,
        );
      } else {
        if (canSelfGang(session, dealerId)) {
          const dealer = world.getEntity(dealerId);
          if (dealer instanceof Player) {
            giveItem(dealer, "mahjong:mahjong_action_gang", "§d暗杠/补杠");
          }
        }
        giveTingItemIfReady(session, dealerId);
      }
    });
    if (session.autoSort) buildHandDisplay(session, runtime);
  }
  const dealerSeat = session.dealerSeat;
  session.currentTurnSeat = dealerSeat;
  const dealerId = playerIdAtSeat(session, dealerSeat);
  const dealerName = dealerId
    ? world.getEntity(dealerId)?.nameTag ?? "庄家"
    : "庄家";
  runtime.announce(roomId, `§a新一局开始!庄家:${dealerName},分数保留`);
  refreshScoreHud(roomId, runtime);
}

function openPresetPicker(player: Player, roomId: number, runtime: MinigameRuntime): void {
  const session = getSession(roomId);
  if (!session) return;
  const form = new CustomForm(player, "预设模式");
  form.spacer();
  form.label("选择一个预设玩法。");
  form.spacer();
  form.button("牡丹江麻将", () => {
    form.close();
    session.presetName = "mudanjiang";
    session.selectedTiles = new Set(MUDANJIANG_TILE_SET);
    session.autoDeal = true;
    session.autoSort = true;
    session.autoDiscard = true;
    session.takeStacks = 3;
    session.reserveMode = 3;
    session.openMode = 1;
    session.singleDoraReserve = true;
    player.sendMessage("§a已选择预设:牡丹江麻将");
    system.runTimeout(() => openHostMenu(player, roomId, runtime), 2);
  });
  form.button("返回", () => {
    form.close();
    system.runTimeout(() => openHostMenu(player, roomId, runtime), 2);
  });
  form.show().catch((error) => console.warn("[Bearcade Mahjong] 预设选择失败", error));
}

function openCustomModePicker(player: Player, roomId: number, runtime: MinigameRuntime): void {
  const session = getSession(roomId);
  if (!session) return;
  const form = new CustomForm(player, "自定义模式 · 选择牌组");
  form.spacer();
  form.label("选择一组自定义预设,之后可进入微调。");
  form.spacer();
  for (const preset of PRESETS) {
    form.button(`${preset.name}(${tileCountForSelection(new Set(preset.tiles))} 张)`, () => {
      form.close();
      session.selectedTiles = new Set(preset.tiles);
      session.presetId = preset.id;
      system.runTimeout(() => openFineTuneMenu(player, roomId, runtime), 2);
    });
  }
  form.button("返回", () => {
    form.close();
    system.runTimeout(() => openHostMenu(player, roomId, runtime), 2);
  });
  form.show().catch((error) => console.warn("[Bearcade Mahjong] 自定义模式选择失败", error));
}

function openFineTuneMenu(player: Player, roomId: number, runtime: MinigameRuntime): void {
  const session = getSession(roomId);
  if (!session) return;
  const form = new CustomForm(player, "微调牌组");
  form.spacer();
  form.label(`当前共 ${tileCountForSelection(session.selectedTiles)} 张牌,可继续按类目微调。`);
  form.spacer();
  for (const cat of TILE_CATEGORIES) {
    const selectedInCat = cat.tiles.filter((id) => session.selectedTiles.has(id)).length;
    form.button(`${cat.name}(${selectedInCat}/${cat.tiles.length})`, () => {
      form.close();
      system.runTimeout(() => openCategoryEditor(player, roomId, runtime, cat.key), 2);
    });
  }
  form.spacer();
  form.button("对局设置", () => {
    form.close();
    system.runTimeout(() => openGameSettings(player, roomId, runtime), 2);
  });
  form.button("清空牌组", () => {
    session.selectedTiles = new Set();
    session.presetId = undefined;
    player.sendMessage("§e已清空牌组");
    form.close();
    system.runTimeout(() => openFineTuneMenu(player, roomId, runtime), 2);
  });
  form.button("确认使用当前牌组", () => {
    form.close();
    player.sendMessage(`§a已保存牌组:${tileCountForSelection(session.selectedTiles)} 张`);
    system.runTimeout(() => openHostMenu(player, roomId, runtime), 2);
  });
  form.button("返回", () => {
    form.close();
    system.runTimeout(() => openHostMenu(player, roomId, runtime), 2);
  });
  form.show().catch((error) => console.warn("[Bearcade Mahjong] 微调菜单失败", error));
}

function openGameSettings(
  player: Player,
  roomId: number,
  runtime: MinigameRuntime,
): void {
  const session = getSession(roomId);
  if (!session) return;

  const autoDeal = new ObservableBoolean(session.autoDeal, {
    clientWritable: true,
  });
  const singleDoraReserve = new ObservableBoolean(session.singleDoraReserve, {
    clientWritable: true,
  });
  const autoSort = new ObservableBoolean(session.autoSort, {
    clientWritable: true,
  });
  const autoDiscard = new ObservableBoolean(session.autoDiscard, {
    clientWritable: true,
  });
  const reserveMode = new ObservableNumber(session.reserveMode - 1, {
    clientWritable: true,
  });
  const reserveStacks = new ObservableString(String(session.reserveStacks), {
    clientWritable: true,
  });
  const openMode = new ObservableNumber(session.openMode - 1, {
    clientWritable: true,
  });
  const takeStacks = new ObservableNumber(
    [1, 2, 3, 6].indexOf(session.takeStacks) === -1 ? 1 : [1, 2, 3, 6].indexOf(session.takeStacks),
    { clientWritable: true },
  );

  const form = new CustomForm(player, "对局设置");
  form.spacer();
  form.toggle("自动开局", autoDeal);
  form.toggle("单张宝牌预留", singleDoraReserve);
  form.toggle("自动理牌", autoSort);
  form.toggle("自动打出", autoDiscard);
  form.spacer();
  form.dropdown("留牌", reserveMode, [
    { label: "不留牌", value: 0 },
    { label: "留牌为确定墩数", value: 1 },
    { label: "留牌根据骰子确定", value: 2 },
  ]);
  form.textField("确定墩数(1-8)", reserveStacks);
  form.dropdown("开牌位置", openMode, [
    { label: "对家开门", value: 0 },
    { label: "单骰开门", value: 1 },
  ]);
  form.dropdown("单次拿取墩数", takeStacks, [
    { label: "1 墩", value: 0 },
    { label: "2 墩", value: 1 },
    { label: "3 墩", value: 2 },
    { label: "6 墩", value: 3 },
  ]);
  form.spacer();
  form.button("保存", () => {
    session.autoDeal = autoDeal.getData();
    session.singleDoraReserve = singleDoraReserve.getData();
    session.autoSort = autoSort.getData();
    session.autoDiscard = autoDiscard.getData();
    session.reserveMode = reserveMode.getData() + 1;
    const rs = Number(reserveStacks.getData());
    session.reserveStacks =
      Number.isInteger(rs) && rs >= 1 && rs <= 8 ? rs : 0;
    session.openMode = openMode.getData() + 1;
    session.takeStacks = [1, 2, 3, 6][takeStacks.getData()] ?? 2;
    form.close();
    player.sendMessage("§a已保存对局设置");
    system.runTimeout(() => openFineTuneMenu(player, roomId, runtime), 2);
  });
  form.button("返回", () => {
    form.close();
    system.runTimeout(() => openFineTuneMenu(player, roomId, runtime), 2);
  });
  form.show().catch((error) =>
    console.warn("[Bearcade Mahjong] 对局设置表单失败", error),
  );
}

function openCategoryEditor(
  player: Player,
  roomId: number,
  runtime: MinigameRuntime,
  categoryKey: string,
): void {
  const session = getSession(roomId);
  if (!session) return;
  const cat = TILE_CATEGORIES.find((c) => c.key === categoryKey);
  if (!cat) return;
  const toggles = cat.tiles.map((id) => {
    const obs = new ObservableBoolean(session.selectedTiles.has(id), {
      clientWritable: true,
    });
    return { id, obs };
  });
  const form = new CustomForm(player, `微调 · ${cat.name}`);
  form.spacer();
  for (const t of toggles) {
    form.toggle(tileDisplayName(t.id), t.obs);
  }
  form.spacer();
  form.button("保存", () => {
    for (const t of toggles) {
      if (t.obs.getData()) session.selectedTiles.add(t.id);
      else session.selectedTiles.delete(t.id);
    }
    form.close();
    system.runTimeout(() => openFineTuneMenu(player, roomId, runtime), 2);
  });
  form.button("返回", () => {
    form.close();
    system.runTimeout(() => openFineTuneMenu(player, roomId, runtime), 2);
  });
  form.show().catch((error) => console.warn("[Bearcade Mahjong] 类目编辑失败", error));
}

// ================= 回座命令 =================

export function handleMahjongBack(player: Player, runtime: MinigameRuntime): boolean {
  for (const [roomId, session] of sessions) {
    if (!session.joinOrder.includes(player.id)) continue;
    if (session.away.has(player.id)) session.away.delete(player.id);
    const seatIndex = playerSeatIndex(session, player.id);
    const cfg = getMahjongConfig();
    const seat = cfg.seatPositions[seatIndex] ?? cfg.seatPositions[0];
    runtime.teleportPlayer(roomId, player, seat);
    player.sendMessage(`§a已回到麻将房间 ${roomId}`);
    if (!session.hostId) {
      session.hostId = player.id;
      giveHostBook(player);
      runtime.announce(roomId, `§e${player.name} 成为房主`);
    }
    return true;
  }
  player.sendMessage("§c你当前没有可回到的麻将房间");
  return false;
}

// ================= 初始化 =================

export function initMahjong(getRuntime: () => MinigameRuntime): void {
  world.afterEvents.playerDimensionChange.subscribe((event) => {
    const runtime = getRuntime();
    const roomId = roomIdOfDimension(event.player.dimension.id, runtime);
    if (roomId !== undefined) {
      handlePlayerEnterRoom(event.player, roomId, runtime);
    }
    // 离开房间维度:记录托管,但保留座位
    const fromRoom = roomIdOfDimension(event.fromDimension?.id ?? "", runtime);
    if (fromRoom !== undefined) {
      handlePlayerLeaveRoom(event.player, fromRoom, runtime);
    }
  });

  world.afterEvents.playerLeave.subscribe((event) => {
    const runtime = getRuntime();
    for (const [roomId, session] of sessions) {
      if (session.joinOrder.includes(event.playerId)) {
        session.away.add(event.playerId);
        if (session.hostId === event.playerId) {
          transferHost(session, runtime);
          refreshHostBook(session);
        }
        if (physicalPlayers(runtime, roomId).length === 0 && session.started) {
          runtime.endGame(roomId, "房间内没有玩家");
        }
      }
    }
  });

  world.afterEvents.itemUse.subscribe((event) => {
    const runtime = getRuntime();
    const itemId = event.itemStack?.typeId;
    const roomId = roomIdOfDimension(event.source.dimension.id, runtime);
    const session = roomId !== undefined ? getSession(roomId) : undefined;

    // 预设模式交互物品
    if (itemId?.startsWith("mahjong:mahjong_action_")) {
      if (!session || session.presetName !== "mudanjiang") return;
      if (
        itemId === "mahjong:mahjong_action_ting" &&
        session.pendingAction?.source !== "post_discard_ting"
      ) {
        declareTing(event.source, roomId!, runtime);
      } else {
        handlePresetAction(
          event.source,
          roomId!,
          itemId,
          runtime,
          event.itemStack?.nameTag,
        );
      }
      return;
    }

    if (itemId !== "minecraft:book") return;
    if (roomId === undefined) return;
    if (!session) return;
    if (session.hostId === event.source.id) {
      system.runTimeout(() => openHostMenu(event.source, roomId, runtime), 2);
    } else {
      event.source.sendMessage("§c只有房主可以设置游戏");
    }
  });

  // 麻将方块交互:
  // - 空手右键牌垛 → 摸牌
  // - 空手+潜行右键单张牌 → 循环切换 stand/down/up
  // - 手持砖类右键单张牌 → 直接设定姿态
  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    const { player, block, itemStack, isFirstEvent } = event;
    if (!player || !block || !isFirstEvent) return;
    if (!block.typeId.startsWith("mahjong:")) return;
    console.warn(
      `[Bearcade Mahjong] interact ${block.typeId} item=${itemStack?.typeId ?? "空手"} sneak=${player.isSneaking}`,
    );

    const runtime = getRuntime();
    const roomId = roomIdOfDimension(block.dimension.id, runtime);

    // 面前手牌方块:支持状态物品/潜行翻面/自动打出
    if (roomId !== undefined) {
      const session = getSession(roomId);
      const displayEntry = session?.handDisplays
        .get(player.id)
        ?.find((e) => sameLocation(e.location, block.location));
      if (session && displayEntry) {
        const seat = playerSeatIndex(session, player.id);
        const dir = ["north", "west", "south", "east"][seat] ?? "north";
        // 听牌后手牌锁定:不能翻面/改朝向/换牌,只能在自己的回合空手点击打出
        if (
          session.tingSeats.has(seat) &&
          !(session.currentTurnSeat === seat && !itemStack && !player.isSneaking)
        ) {
          event.cancel = true;
          return;
        }
        const loc = block.location;
        const dim = block.dimension;
        const BRICK_POSE: Record<string, string> = {
          "minecraft:brick": "stand",
          "minecraft:netherbrick": "down",
          "minecraft:resin_brick": "up",
        };
        // 三种砖:只改变亮/立/暗,不改朝向
        if (itemStack && BRICK_POSE[itemStack.typeId] !== undefined) {
          event.cancel = true;
          const pose = BRICK_POSE[itemStack.typeId];
          system.run(() => {
            try {
              const b = dim.getBlock(loc);
              if (!b) return;
              const curPerm = b.permutation as any;
              const curDir =
                curPerm.getState("minecraft:cardinal_direction") ?? dir;
              const perm = BlockPermutation.resolve(block.typeId as never, {
                "mahjong:pose": pose,
                "minecraft:cardinal_direction": curDir,
              } as never);
              dim.setBlockPermutation(loc, perm);
            } catch (error) {
              console.warn("[Bearcade Mahjong] 砖改姿态失败", error);
            }
          });
          return;
        }
        // 木棍:循环改变麻将牌朝向
        if (itemStack?.typeId === "minecraft:stick") {
          event.cancel = true;
          const DIR_ORDER = ["north", "east", "south", "west"];
          system.run(() => {
            try {
              const b = dim.getBlock(loc);
              if (!b) return;
              const curPerm = b.permutation as any;
              const curDir =
                curPerm.getState("minecraft:cardinal_direction") ?? "north";
              const nextDir =
                DIR_ORDER[
                  (DIR_ORDER.indexOf(curDir as string) + 1) % DIR_ORDER.length
                ];
              const pose = curPerm.getState("mahjong:pose") ?? "stand";
              const perm = BlockPermutation.resolve(block.typeId as never, {
                "mahjong:pose": pose,
                "minecraft:cardinal_direction": nextDir,
              } as never);
              dim.setBlockPermutation(loc, perm);
            } catch (error) {
              console.warn("[Bearcade Mahjong] 木棍改朝向失败", error);
            }
          });
          return;
        }
        // 骨头:切换暗置模式
        if (itemStack?.typeId === "minecraft:bone") {
          event.cancel = true;
          const dark = session.darkMode.has(player.id);
          if (dark) session.darkMode.delete(player.id);
          else session.darkMode.add(player.id);
          player.sendMessage(
            dark
              ? "§a暗置模式已关闭:潜行 立→暗→亮,默认放下为立"
              : "§a暗置模式已开启:潜行 暗→立→亮,默认放下为暗",
          );
          return;
        }
        // 空手+潜行:根据暗置模式循环
        if (!itemStack && player.isSneaking) {
          event.cancel = true;
          system.run(() => {
            try {
              const b = dim.getBlock(loc);
              if (!b) return;
              const dark = session.darkMode.has(player.id);
              const POSE_ORDER = dark
                ? ["down", "stand", "up"]
                : ["stand", "down", "up"];
              const curPerm = b.permutation as any;
              const cur = curPerm.getState("mahjong:pose") ?? "stand";
              const next =
                POSE_ORDER[
                  (POSE_ORDER.indexOf(cur as string) + 1) % POSE_ORDER.length
                ];
              const curDir =
                curPerm.getState("minecraft:cardinal_direction") ?? dir;
              const perm = BlockPermutation.resolve(block.typeId as never, {
                "mahjong:pose": next,
                "minecraft:cardinal_direction": curDir,
              } as never);
              dim.setBlockPermutation(loc, perm);
            } catch (error) {
              console.warn("[Bearcade Mahjong] 潜行翻面失败", error);
            }
          });
          return;
        }
        if (!itemStack && session?.autoDiscard) {
          event.cancel = true;
          system.run(() => discardTile(player, roomId, displayEntry, runtime));
          return;
        }
        return;
      }
    }

    // 牌垛:空手右键摸牌
    if (
      block.typeId === "mahjong:mahjong_stack_full" ||
      block.typeId === "mahjong:mahjong_stack_half"
    ) {
      if (itemStack) return; // 手持物品时不拦截
      if (roomId === undefined) return;
      event.cancel = true;
      const loc = block.location;
      system.run(() => drawFromStack(player, roomId, loc, runtime));
      return;
    }

    // 单张麻将牌:砖改姿态 / 木棍改朝向 / 骨头切换暗置模式 / 潜行循环
    const loc = block.location;
    const dim = block.dimension;
    const sessionForSeat = roomId !== undefined ? getSession(roomId) : undefined;
    const seat = sessionForSeat ? playerSeatIndex(sessionForSeat, player.id) : -1;
    const faceDir = ["north", "west", "south", "east"][seat] ?? undefined;
    const BRICK_POSE: Record<string, string> = {
      "minecraft:brick": "stand",
      "minecraft:netherbrick": "down",
      "minecraft:resin_brick": "up",
    };

    if (itemStack && BRICK_POSE[itemStack.typeId] !== undefined) {
      event.cancel = true;
      const pose = BRICK_POSE[itemStack.typeId];
      console.warn(`[Bearcade Mahjong] 砖改姿态 ${block.typeId} -> ${pose}`);
      system.run(() => {
        try {
          const b = dim.getBlock(loc);
          if (!b) return;
          const curPerm = b.permutation as any;
          const curDir =
            curPerm.getState("minecraft:cardinal_direction") ?? faceDir ?? "north";
          const perm = BlockPermutation.resolve(block.typeId as never, {
            "mahjong:pose": pose,
            "minecraft:cardinal_direction": curDir,
          } as never);
          dim.setBlockPermutation(loc, perm);
        } catch (error) {
          console.warn("[Bearcade Mahjong] 砖改姿态失败", error);
        }
      });
      return;
    }

    if (itemStack?.typeId === "minecraft:stick") {
      event.cancel = true;
      const DIR_ORDER = ["north", "east", "south", "west"];
      console.warn(`[Bearcade Mahjong] 木棍改朝向 ${block.typeId}`);
      system.run(() => {
        try {
          const b = dim.getBlock(loc);
          if (!b) return;
          const curPerm = b.permutation as any;
          const curDir =
            curPerm.getState("minecraft:cardinal_direction") ?? "north";
          const nextDir =
            DIR_ORDER[
              (DIR_ORDER.indexOf(curDir as string) + 1) % DIR_ORDER.length
            ];
          const pose = curPerm.getState("mahjong:pose") ?? "stand";
          const perm = BlockPermutation.resolve(block.typeId as never, {
            "mahjong:pose": pose,
            "minecraft:cardinal_direction": nextDir,
          } as never);
          dim.setBlockPermutation(loc, perm);
        } catch (error) {
          console.warn("[Bearcade Mahjong] 木棍改朝向失败", error);
        }
      });
      return;
    }

    if (itemStack?.typeId === "minecraft:bone") {
      event.cancel = true;
      if (sessionForSeat) {
        const dark = sessionForSeat.darkMode.has(player.id);
        if (dark) sessionForSeat.darkMode.delete(player.id);
        else sessionForSeat.darkMode.add(player.id);
        player.sendMessage(
          dark
            ? "§a暗置模式已关闭:潜行 立→暗→亮,默认放下为立"
            : "§a暗置模式已开启:潜行 暗→立→亮,默认放下为暗",
        );
      }
      return;
    }

    if (!itemStack && player.isSneaking) {
      event.cancel = true;
      console.warn(`[Bearcade Mahjong] 潜行翻面 ${block.typeId}`);
      system.run(() => {
        try {
          const b = dim.getBlock(loc);
          if (!b) return;
          const dark = sessionForSeat?.darkMode.has(player.id) ?? false;
          const POSE_ORDER = dark
            ? ["down", "stand", "up"]
            : ["stand", "down", "up"];
          const curPerm = b.permutation as any;
          const cur = curPerm.getState("mahjong:pose") ?? "stand";
          const next =
            POSE_ORDER[
              (POSE_ORDER.indexOf(cur as string) + 1) % POSE_ORDER.length
            ];
          const curDir =
            curPerm.getState("minecraft:cardinal_direction") ?? faceDir ?? "north";
          const perm = BlockPermutation.resolve(block.typeId as never, {
            "mahjong:pose": next,
            "minecraft:cardinal_direction": curDir,
          } as never);
          dim.setBlockPermutation(loc, perm);
        } catch (error) {
          console.warn("[Bearcade Mahjong] 潜行翻面失败", error);
        }
      });
      return;
    }

    return; // 其他情况不拦截
  });

  world.afterEvents.buttonPush.subscribe((event) => {
    const runtime = getRuntime();
    const roomId = buttonRoomId(event.block.dimension.id, runtime);
    if (roomId === undefined) return;
    if (isDiceButton(event.block.location)) {
      handleDiceButton(roomId, runtime);
      return;
    }
    const score = isScoreButton(event.block.location);
    if (score) {
      handleScoreButton(roomId, score.seat, score.delta, runtime);
    }
  });

  // 玩家破坏/放置麻将方块时,同步更新数据库并自动理牌
  world.afterEvents.playerBreakBlock.subscribe((event) => {
    handleBreakMahjongBlock(event, getRuntime());
  });
  world.afterEvents.playerPlaceBlock.subscribe((event) => {
    handlePlaceMahjongBlock(event, getRuntime());
  });

  // 每 10 tick 检查:房间内无人则自动重置;房主不在则顺延
  system.runInterval(() => {
    const runtime = getRuntime();
    for (const [roomId, session] of sessions) {
      const players = physicalPlayers(runtime, roomId);
      if (players.length === 0 && session.started) {
        runtime.endGame(roomId, "房间内没有玩家");
        continue;
      }
      if (session.hostId && !session.away.has(session.hostId)) {
        // 房主可能离线或离开房间;若不在房间且不在 away 集合,补标记
        const hostOnline = players.some((p) => p.id === session.hostId);
        if (!hostOnline && !world.getAllPlayers().some((p) => p.id === session.hostId)) {
          session.away.add(session.hostId);
          transferHost(session, runtime);
          refreshHostBook(session);
        }
      }
    }
  }, 10);
}

// ================= 玩法钩子 =================

export function makeMahjongHooks(
  getRuntime: () => MinigameRuntime,
): MinigameHooks {
  return {
    onGameStart(roomId, players) {
      const runtime = getRuntime();
      const session = getOrCreateSession(roomId);
      session.started = true;
      session.wallBuilt = false;
      if (session.selectedTiles.size === 0) {
        session.selectedTiles = new Set(PRESETS[0].tiles);
      }
      const cfg = getMahjongConfig();
      players.forEach((player, index) => {
        const seatIndex = session.joinOrder.indexOf(player.id);
        const seat = cfg.seatPositions[seatIndex >= 0 ? seatIndex : index] ?? cfg.seatPositions[0];
        runtime.teleportPlayer(roomId, player, seat);
        player.setGameMode(
          session.presetName ? GameMode.Adventure : GameMode.Survival,
        );
        clearAllPlayerItems(player);
        giveItem(player, "minecraft:brick", "§e红砖·立牌");
        giveItem(player, "minecraft:netherbrick", "§e下界砖·暗牌");
        giveItem(player, "minecraft:resin_brick", "§e树脂砖·亮牌");
        giveItem(player, "minecraft:stick", "§e木棍·改朝向");
        giveItem(player, "minecraft:bone", "§e骨头·切换暗置模式");
        player.sendMessage(
          "§a[麻将] 物品用法:红砖=立牌, 下界砖=暗牌, 树脂砖=亮牌, 木棍=改朝向, 骨头=切换暗置模式; 潜行+空手点击=暗→立→亮",
        );
        session.scores.set(player.id, 0);
        if (session.hostId === player.id) giveHostBook(player);
      });
      buildStacks(roomId, runtime, session);
      session.wallBuilt = true;
      if (session.autoDeal) {
        dealGame(session, runtime, () => {
          if (session.presetName === "mudanjiang") {
            const dealerId = playerIdAtSeat(session, session.dealerSeat);
            if (!dealerId) return;
            if (session.away.has(dealerId)) {
              system.runTimeout(
                () => autoDiscardForAway(session, runtime, dealerId),
                10,
              );
            } else {
              if (canSelfGang(session, dealerId)) {
                const dealer = world.getEntity(dealerId);
                if (dealer instanceof Player) {
                  giveItem(dealer, "mahjong:mahjong_action_gang", "§d暗杠/补杠");
                }
              }
              giveTingItemIfReady(session, dealerId);
            }
          }
        });
        if (session.autoSort) buildHandDisplay(session, runtime);
      }
      if (session.presetName === "mudanjiang") {
        session.singleDoraReserve = true;
        const dealerSeat = session.hostId
          ? playerSeatIndex(session, session.hostId)
          : 0;
        session.dealerSeat = dealerSeat;
        session.currentTurnSeat = dealerSeat;
        const dealerId = playerIdAtSeat(session, dealerSeat);
        const dealerName = dealerId
          ? world.getEntity(dealerId)?.nameTag ?? "庄家"
          : "庄家";
        runtime.announce(roomId, `§a牡丹江麻将开始!庄家:${dealerName}`);
      }
      runtime.announce(
        roomId,
        `§a对局开始!牌垛已生成(共 ${tileCountForSelection(session.selectedTiles)} 张)`,
      );
      refreshScoreHud(roomId, runtime);
    },
    onBeforeReset(roomId) {
      const runtime = getRuntime();
      const session = getSession(roomId);
      if (session) {
        clearHandDisplay(session, runtime);
        clearMeldDisplay(session, runtime);
        if (session.doraLocation) {
          try {
            runtime
              .roomDim(roomId)
              .setBlockPermutation(
                session.doraLocation,
                BlockPermutation.resolve("minecraft:air" as never),
              );
          } catch {
            // ignore
          }
        }
        for (const player of runtime.roomPlayers(roomId)) {
          player.setGameMode(GameMode.Adventure);
          clearHudTitle(player);
        }
        clearSession(roomId);
      }
    },
    openConfig(player) {
      openMahjongConfig(player, getRuntime());
    },
    canBreak(event, roomId) {
      const session = getSession(roomId);
      if (session?.presetName) return false;
      return event.block.typeId.startsWith("mahjong:");
    },
    canPlace(event, roomId) {
      const session = getSession(roomId);
      if (session?.presetName) return false;
      return event.permutationToPlace.type.id.startsWith("mahjong:");
    },
  };
}
