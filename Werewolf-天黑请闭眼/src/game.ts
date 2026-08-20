// ============================================================
// 天黑请闭眼(Werewolf)玩法实现
// - 6~10 人,身份表见 config.ts;座位按入场顺序自动 1~N 号;
// - 夜晚依次:狙击手(30s)→ 守卫(30s)→ 杀手(60s)→ 警察(60s);
//   白天讨论+公投(90s),平票无人出局;
// - 投票/行动物品 = 自定义物品 bearcade:werewolf_vote(nameTag 区分"投给 N号"与"取消选择"),锁定槽位;
// - 队内聊天:聊天栏以 ! 开头,仅杀手/警察同队存活玩家可见(狙击手无队内聊天);
// - 死亡:隐身、清物品、留在座位,公开身份,弹表单写遗言(TextPrimitive 浮空字);
// - 退出/断线视为出局(无遗言),对局继续;
// - 胜利:杀手全部出局 → 好人方胜;平民全灭 或 警察全灭 → 坏人方胜。
// ============================================================
import {
  system,
  world,
  GameMode,
  InputPermissionCategory,
  ItemLockMode,
  ItemStack,
  EasingType,
  EntityComponentTypes,
  TextPrimitive,
  type EntityInventoryComponent,
  type Player,
  type Vector3,
} from "@minecraft/server";
import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { CustomForm, ObservableNumber } from "@minecraft/server-ui";
import { clearAllPlayerItems } from "../../shared/minigame-core/playerItems";
import { getWerewolfConfig, openWerewolfConfig } from "./werewolf-config";
import { promptTestament, spawnTestament } from "./testament";
import {
  ACTION_ITEM,
  CAMERA_FACING,
  CAMERA_LOCATION,
  PAD_COLORS,
  ROLE_COLORS,
  ROLE_NAMES,
  SEATS,
  roleCountsFor,
  usedSeatsFor,
  type Role,
  type RoleCounts,
} from "./config";

type Phase = "sniper" | "guard" | "killer" | "police" | "day";

interface Member {
  playerId: string;
  name: string;
  number: number;
  role: Role;
  alive: boolean;
  seat: Vector3;
  /** 名字/物品颜色:跟随所站色块 */
  color: string;
  /** 是否已提交过遗言(防止重复写) */
  testamentDone: boolean;
}

interface Session {
  night: number;
  phase: Phase;
  phaseEndTick: number;
  /** 当前阶段各行动者的选择:玩家 id -> 目标座位号 */
  selections: Map<string, number>;
  members: Map<string, Member>;
  sniperBullets: number;
  /** 本夜守卫守护的座位号(killer 阶段判定用) */
  protectedSeat: number;
  /** 上一夜守护的座位号(连续两晚不可守护同一人) */
  lastProtectedSeat: number;
  testaments: TextPrimitive[];
  /** 出局玩家身份标识浮空字 */
  identityShapes: TextPrimitive[];
  /** 白天投票标记:座位号 -> "获 N 票" 浮空字 */
  voteMarkers: Map<number, TextPrimitive>;
  /** 夜间行动选择标记:行动者 id -> 只对自己/队友可见的浮空字 */
  actionMarkers: Map<string, TextPrimitive>;
  /** 玩家头顶号码浮空字:玩家 id -> shape */
  numberShapes: Map<string, TextPrimitive>;
  finished: boolean;
  /** 最近一次全场相机锁定 tick(用于周期性重锁兜底) */
  lastCameraTick: number;
  /** 开局身份展示阶段:true 时只显示身份 Title,不进入正式阶段流程 */
  identityPhase: boolean;
}

// 头顶/座位浮空字高度
const NUMBER_SHAPE_Y = 2.2; // 头顶号码
const IDENTITY_Y = 1.5; // 身份(遗言下方,比原 2.0 再下移半格)
const VOTE_MARK_Y = 3.2; // 白天票数(遗言位置上方,避免与遗言/身份重叠)
const IDENTITY_SHOW_TICKS = 80; // 开局身份 Title 展示 4 秒后再进入第一夜

// 交互物品 nameTag(自定义物品 bearcade:werewolf_vote)
const VOTE_OPEN_NAME = "§e打开投票";
const TESTAMENT_OPEN_NAME = "§e写遗言";

const SEAT_RGBA: Record<string, { red: number; green: number; blue: number }> = {
  "0": { red: 0, green: 0, blue: 0 }, // 黑
  "3": { red: 0, green: 1, blue: 1 }, // 青
  "4": { red: 0.7, green: 0, blue: 0 }, // 深红(狙击手身份)
  "5": { red: 1, green: 0, blue: 1 }, // 紫
  "9": { red: 0.35, green: 0.35, blue: 1 }, // 深蓝
  a: { red: 0.55, green: 1, blue: 0.55 }, // 绿
  b: { red: 0.55, green: 0.85, blue: 1 }, // 浅蓝
  c: { red: 1, green: 0.55, blue: 0.55 }, // 红
  d: { red: 1, green: 0.55, blue: 1 }, // 粉
  e: { red: 1, green: 1, blue: 0.55 }, // 黄
  f: { red: 1, green: 1, blue: 1 }, // 白
};

function seatRgba(colorCode: string): { red: number; green: number; blue: number; alpha: number } {
  const key = colorCode.replace("§", "");
  return { ...(SEAT_RGBA[key] ?? SEAT_RGBA.f), alpha: 1 };
}

const sessions = new Map<number, Session>();

/** 调试开关:/bearcade:ww5 开启后 5 人即可开局(5 人配置少 1 平民) */
let fivePlayerDebug = false;
export function setFivePlayerDebug(enabled: boolean): void {
  fivePlayerDebug = enabled;
}
export function isFivePlayerDebug(): boolean {
  return fivePlayerDebug;
}

const PHASE_ORDER: Phase[] = ["sniper", "guard", "killer", "police", "day"];

const PHASE_NAMES: Record<Phase, string> = {
  sniper: "狙击手",
  guard: "守卫",
  killer: "杀手",
  police: "警察",
  day: "白天讨论投票",
};

function phaseRole(phase: Phase): Role | undefined {
  switch (phase) {
    case "sniper":
      return "sniper";
    case "guard":
      return "guard";
    case "killer":
      return "killer";
    case "police":
      return "police";
    default:
      return undefined;
  }
}

function phaseSeconds(phase: Phase): number {
  const cfg = getWerewolfConfig();
  switch (phase) {
    case "sniper":
      return cfg.sniperSeconds;
    case "guard":
      return cfg.guardSeconds;
    case "killer":
      return cfg.killerSeconds;
    case "police":
      return cfg.policeSeconds;
    default:
      return cfg.daySeconds;
  }
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function inventoryOf(player: Player): EntityInventoryComponent | undefined {
  return player.getComponent(
    EntityComponentTypes.Inventory,
  ) as EntityInventoryComponent | undefined;
}

function playerInRoom(
  runtime: MinigameRuntime,
  roomId: number,
  playerId: string,
): Player | undefined {
  return runtime.roomPlayers(roomId).find((p) => p.id === playerId);
}

function numberText(member: Member): string {
  return `${member.color}${member.number}号§r ${member.name}`;
}

function roleText(role: Role): string {
  return `${ROLE_COLORS[role]}${ROLE_NAMES[role]}§r`;
}

function aliveMembers(session: Session): Member[] {
  return [...session.members.values()].filter((m) => m.alive);
}

function aliveRoleMembers(session: Session, role: Role): Member[] {
  return aliveMembers(session).filter((m) => m.role === role);
}

function bySeat(session: Session, seat: number): Member | undefined {
  for (const member of session.members.values()) {
    if (member.number === seat) return member;
  }
  return undefined;
}

function isValidTarget(
  session: Session,
  actor: Member,
  phase: Phase,
  target: Member,
): boolean {
  if (!target.alive || target.playerId === actor.playerId) return false;
  switch (phase) {
    case "guard":
      // 守卫不可守护自己,且不可连续两晚守护同一人
      return target.number !== session.lastProtectedSeat;
    case "killer":
      // 杀手不可杀自己与队友
      return target.role !== "killer";
    case "police":
      // 警察不可查验自己与队友
      return target.role !== "police";
    case "sniper":
      return true; // 狙击手不认识杀手,可能误杀任何非己玩家
    case "day":
      return true; // 白天不可投自己(已在 isValidTarget 首行排除)
  }
}

function candidateSeats(
  session: Session,
  actor: Member,
  phase: Phase,
): number[] {
  const seats: number[] = [];
  for (const target of aliveMembers(session).sort(
    (a, b) => a.number - b.number,
  )) {
    if (isValidTarget(session, actor, phase, target)) {
      seats.push(target.number);
    }
  }
  return seats;
}

/** 旧版同款全场固定机位:free 相机固定在桌区一侧,看向全场(所有玩家均锁定) */
function lockArenaCamera(
  runtime: MinigameRuntime,
  roomId: number,
): void {
  for (const player of runtime.roomPlayers(roomId)) {
    try {
      player.camera.setCamera("minecraft:free", {
        location: CAMERA_LOCATION,
        facingLocation: CAMERA_FACING,
        easeOptions: { easeTime: 0.3, easeType: EasingType.Linear },
      });
    } catch (error) {
      console.warn(
        `[Bearcade werewolf] 相机锁定失败:${player.name}`,
        error,
      );
    }
  }
}

/** 通过输入权限组件只禁用横向移动(保留原地跳跃/下蹲/镜头转动与点击);locked=false 恢复 */
function setMovementLocked(
  runtime: MinigameRuntime,
  roomId: number,
  locked: boolean,
): void {
  for (const player of runtime.roomPlayers(roomId)) {
    try {
      player.inputPermissions.setPermissionCategory(
        InputPermissionCategory.LateralMovement,
        !locked,
      );
    } catch (error) {
      console.warn(
        `[Bearcade werewolf] 移动权限${locked ? "禁用" : "恢复"}失败:${player.name}`,
        error,
      );
    }
  }
}

// ================= 头顶号码浮空字(参考 title.js) =================

function removeNumberShape(session: Session, playerId: string): void {
  const shape = session.numberShapes.get(playerId);
  if (!shape) return;
  try {
    world.primitiveShapesManager.removeText(shape);
  } catch {
    // 忽略
  }
  session.numberShapes.delete(playerId);
}

function createNumberShape(
  runtime: MinigameRuntime,
  roomId: number,
  member: Member,
  session: Session,
): void {
  removeNumberShape(session, member.playerId);
  const player = playerInRoom(runtime, roomId, member.playerId);
  if (!player) return;
  try {
    const shape = new TextPrimitive(
      { x: 0, y: NUMBER_SHAPE_Y, z: 0 },
      `${member.number}号`,
    );
    shape.scale = 1;
    shape.color = seatRgba(member.color);
    shape.backgroundColorOverride = {
      red: 0,
      green: 0,
      blue: 0,
      alpha: 0.45,
    };
    shape.depthTest = false;
    shape.attachedTo = player;
    world.primitiveShapesManager.addText(shape, runtime.roomDim(roomId));
    session.numberShapes.set(member.playerId, shape);
  } catch (error) {
    console.warn("[Bearcade werewolf] 头顶号码创建失败", error);
  }
}

/** 玩家退出后:把他的头顶号码转成座位上的静态号码牌,仍对剩余玩家可见 */
function convertNumberShapeToStatic(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
  member: Member,
): void {
  // 移除跟随玩家的动态号码
  removeNumberShape(session, member.playerId);
  const remaining = runtime
    .roomPlayers(roomId)
    .filter((p) => p.id !== member.playerId);
  if (remaining.length === 0) return;
  try {
    const shape = new TextPrimitive(
      {
        x: member.seat.x + 0.5,
        y: member.seat.y + NUMBER_SHAPE_Y,
        z: member.seat.z + 0.5,
      },
      `${member.number}号`,
    );
    shape.scale = 1;
    shape.color = seatRgba(member.color);
    shape.backgroundColorOverride = {
      red: 0,
      green: 0,
      blue: 0,
      alpha: 0.45,
    };
    shape.depthTest = false;
    shape.visibleTo = remaining;
    world.primitiveShapesManager.addText(shape, runtime.roomDim(roomId));
    session.numberShapes.set(member.playerId, shape);
  } catch (error) {
    console.warn("[Bearcade werewolf] 离场号码牌创建失败", error);
  }
}

// ================= 聊天气泡(参考 chatbubble.js) =================

interface BubbleEntry {
  text: string;
  shape?: TextPrimitive;
}

const BUBBLE_LIFETIME_TICKS = 100; // 5 秒
const MAX_BUBBLES = 5;
const BUBBLE_BASE_Y = 2.8;
const BUBBLE_SPACING = 0.4;

const chatBubbles = new Map<string, { entries: BubbleEntry[]; timer?: number }>();

function removeChatBubbles(playerId: string): void {
  const data = chatBubbles.get(playerId);
  if (!data) return;
  chatBubbles.delete(playerId);
  if (data.timer !== undefined) {
    try {
      system.clearRun(data.timer);
    } catch {
      // 忽略
    }
  }
  for (const entry of data.entries) {
    if (entry.shape) {
      try {
        world.primitiveShapesManager.removeText(entry.shape);
      } catch {
        // 忽略
      }
    }
  }
}

function renderChatBubbles(player: Player, data: { entries: BubbleEntry[] }): void {
  for (const entry of data.entries) {
    if (entry.shape) {
      try {
        world.primitiveShapesManager.removeText(entry.shape);
      } catch {
        // 忽略
      }
      entry.shape = undefined;
    }
  }
  const count = data.entries.length;
  data.entries.forEach((entry, index) => {
    try {
      const shape = new TextPrimitive(
        {
          x: 0,
          y: BUBBLE_BASE_Y + (count - 1 - index) * BUBBLE_SPACING,
          z: 0,
        },
        entry.text,
      );
      shape.scale = 1;
      shape.color = { red: 1, green: 1, blue: 1, alpha: 1 };
      shape.backgroundColorOverride = {
        red: 0,
        green: 0,
        blue: 0,
        alpha: 0.45,
      };
      shape.depthTest = false;
      shape.attachedTo = player;
      world.primitiveShapesManager.addText(shape, player.dimension);
      entry.shape = shape;
    } catch (error) {
      console.warn("[Bearcade werewolf] 聊天气泡创建失败", error);
    }
  });
}

function addChatBubble(player: Player, text: string): void {
  const trimmed = text.trim().slice(0, 40);
  if (!trimmed) return;
  let data = chatBubbles.get(player.id);
  if (!data) {
    data = { entries: [] };
    chatBubbles.set(player.id, data);
  }
  data.entries.push({ text: trimmed });
  while (data.entries.length > MAX_BUBBLES) {
    const dropped = data.entries.shift();
    if (dropped?.shape) {
      try {
        world.primitiveShapesManager.removeText(dropped.shape);
      } catch {
        // 忽略
      }
    }
  }
  renderChatBubbles(player, data);
  if (data.timer !== undefined) {
    try {
      system.clearRun(data.timer);
    } catch {
      // 忽略
    }
  }
  data.timer = system.runTimeout(
    () => removeChatBubbles(player.id),
    BUBBLE_LIFETIME_TICKS,
  );
}

// ================= 身份/票数浮空字 =================

function spawnIdentityMarker(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
  member: Member,
): void {
  try {
    const shape = new TextPrimitive(
      {
        x: member.seat.x + 0.5,
        y: member.seat.y + IDENTITY_Y,
        z: member.seat.z + 0.5,
      },
      `身份:${ROLE_NAMES[member.role]}`,
    );
    shape.color = seatRgba(ROLE_COLORS[member.role]);
    shape.backgroundColorOverride = {
      red: 0,
      green: 0,
      blue: 0,
      alpha: 0.45,
    };
    shape.depthTest = false;
    world.primitiveShapesManager.addText(shape, runtime.roomDim(roomId));
    session.identityShapes.push(shape);
  } catch (error) {
    console.warn("[Bearcade werewolf] 身份浮空字创建失败", error);
  }
}

/** 清除某玩家的临时通知浮空字(退出/重开时用) */
function clearTemporaryTextsForPlayer(playerId: string): void {
  const shapes = tempTexts.get(playerId);
  if (!shapes) return;
  for (const shape of shapes) {
    try {
      shape.remove();
    } catch {
      // 忽略
    }
  }
  tempTexts.delete(playerId);
}

/** 玩家临时通知浮空字:在 (-2,-55,0) 生成只对该玩家可见的文字,几秒后消失 */
const tempTexts = new Map<string, TextPrimitive[]>();

function showTemporaryTextForPlayer(
  runtime: MinigameRuntime,
  roomId: number,
  player: Player,
  lines: string[],
  durationTicks: number,
): void {
  const old = tempTexts.get(player.id);
  if (old) {
    for (const shape of old) {
      try {
        shape.remove();
      } catch {
        // 忽略
      }
    }
    tempTexts.delete(player.id);
  }
  const shapes: TextPrimitive[] = [];
  lines.forEach((line, i) => {
    try {
      const shape = new TextPrimitive(
        { x: -2, y: -55 + (lines.length - 1 - i) * 0.4, z: 0 },
        line,
      );
      shape.scale = 1.5;
      shape.color = { red: 1, green: 1, blue: 1, alpha: 1 };
      shape.backgroundColorOverride = {
        red: 0,
        green: 0,
        blue: 0,
        alpha: 0.45,
      };
      shape.depthTest = false;
      shape.visibleTo = [player];
      world.primitiveShapesManager.addText(shape, runtime.roomDim(roomId));
      shapes.push(shape);
    } catch (error) {
      console.warn("[Bearcade werewolf] 临时通知浮空字创建失败", error);
    }
  });
  if (shapes.length === 0) return;
  tempTexts.set(player.id, shapes);
  system.runTimeout(() => {
    for (const shape of shapes) {
      try {
        shape.remove();
      } catch {
        // 忽略
      }
    }
    if (tempTexts.get(player.id) === shapes) {
      tempTexts.delete(player.id);
    }
  }, durationTicks);
}

/** 清除本房间场地内的静态悬浮字(遗言/身份/票数/行动标记残留),保留玩家头顶/聊天气泡 */
function clearArenaFloatingTexts(
  runtime: MinigameRuntime,
  roomId: number,
): void {
  try {
    const dim = runtime.roomDim(roomId);
    const shapes = world.primitiveShapesManager.getShapes({
      location: { x: 3, y: -55, z: 0 },
      maxDistance: 45,
    });
    for (const shape of shapes) {
      if (shape.attachedTo) continue;
      if (shape.dimension.id !== dim.id) continue;
      try {
        shape.remove();
      } catch {
        // 忽略
      }
    }
  } catch (error) {
    console.warn("[Bearcade werewolf] 场地悬浮字清理失败", error);
  }
}

function clearVoteMarkers(session: Session): void {
  for (const [seat, shape] of [...session.voteMarkers.entries()]) {
    try {
      world.primitiveShapesManager.removeText(shape);
    } catch {
      // 忽略
    }
    session.voteMarkers.delete(seat);
  }
}

function clearActionMarkers(session: Session): void {
  for (const [playerId, shape] of [...session.actionMarkers.entries()]) {
    try {
      world.primitiveShapesManager.removeText(shape);
    } catch {
      // 忽略
    }
    session.actionMarkers.delete(playerId);
  }
}

/** 夜间行动选择标记:狙击手/守卫只对自己可见;杀手/警察对自己+同队存活玩家可见 */
function refreshActionMarker(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
  actor: Member,
): void {
  const existing = session.actionMarkers.get(actor.playerId);
  if (existing) {
    try {
      world.primitiveShapesManager.removeText(existing);
    } catch {
      // 忽略
    }
    session.actionMarkers.delete(actor.playerId);
  }
  const seat = session.selections.get(actor.playerId);
  if (seat === undefined) return;
  const target = bySeat(session, seat);
  if (!target) return;
  const isTeamRole = actor.role === "killer" || actor.role === "police";
  const text = isTeamRole
    ? `§e${actor.number}号→${target.color}${target.number}号`
    : `§e你已选:${target.color}${target.number}号`;
  try {
    const shape = new TextPrimitive(
      {
        x: target.seat.x + 0.5,
        y: target.seat.y + VOTE_MARK_Y,
        z: target.seat.z + 0.5,
      },
      text,
    );
    shape.color = seatRgba(actor.color);
    shape.backgroundColorOverride = {
      red: 0,
      green: 0,
      blue: 0,
      alpha: 0.45,
    };
    shape.depthTest = false;
    if (isTeamRole) {
      const teamPlayers = runtime.roomPlayers(roomId).filter((p) => {
        const m = session.members.get(p.id);
        return m?.role === actor.role && m.alive;
      });
      shape.visibleTo = teamPlayers;
    } else {
      const player = playerInRoom(runtime, roomId, actor.playerId);
      if (player) shape.visibleTo = [player];
    }
    world.primitiveShapesManager.addText(shape, runtime.roomDim(roomId));
    session.actionMarkers.set(actor.playerId, shape);
  } catch (error) {
    console.warn("[Bearcade werewolf] 行动标记创建失败", error);
  }
}

function refreshVoteMarker(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
  seat: number,
): void {
  const target = bySeat(session, seat);
  if (!target) return;
  const voters: Member[] = [];
  for (const [voterId, selected] of session.selections) {
    const voter = session.members.get(voterId);
    if (voter?.alive && selected === seat) voters.push(voter);
  }
  voters.sort((a, b) => a.number - b.number);
  const count = voters.length;
  const existing = session.voteMarkers.get(seat);
  if (count <= 0) {
    if (existing) {
      try {
        world.primitiveShapesManager.removeText(existing);
      } catch {
        // 忽略
      }
      session.voteMarkers.delete(seat);
    }
    return;
  }
  const text = `§6获 ${count} 票:§f${voters
    .map((v) => `${v.color}${v.number}号`)
    .join("、")}`;
  if (existing) {
    try {
      existing.setText(text);
    } catch {
      // 忽略
    }
    return;
  }
  try {
    const shape = new TextPrimitive(
      {
        x: target.seat.x + 0.5,
        y: target.seat.y + VOTE_MARK_Y,
        z: target.seat.z + 0.5,
      },
      text,
    );
    shape.color = { red: 1, green: 0.8, blue: 0, alpha: 1 };
    shape.backgroundColorOverride = {
      red: 0,
      green: 0,
      blue: 0,
      alpha: 0.45,
    };
    shape.depthTest = false;
    world.primitiveShapesManager.addText(shape, runtime.roomDim(roomId));
    session.voteMarkers.set(seat, shape);
  } catch (error) {
    console.warn("[Bearcade werewolf] 投票标记创建失败", error);
  }
}

/** 用"打开表单"物品把玩家背包全部槽位占满(所有人始终手中有物品) */
function fillActionItems(player: Player): void {
  const container = inventoryOf(player)?.container;
  if (!container) return;
  const item = new ItemStack(ACTION_ITEM, 1);
  item.nameTag = VOTE_OPEN_NAME;
  item.lockMode = ItemLockMode.slot;
  for (let slot = 0; slot < container.size; slot++) {
    container.setItem(slot, item);
  }
}

function clearPhaseItems(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  for (const player of runtime.roomPlayers(roomId)) {
    const member = session.members.get(player.id);
    // 出局玩家保留「写遗言」物品,不被阶段清背包清掉
    if (member && !member.alive) continue;
    try {
      clearAllPlayerItems(player);
    } catch {
      // 忽略
    }
  }
}

/** 每个阶段给所有存活玩家发满背包的触发物品(行动者用它开表单,非行动者是占位) */
function givePhaseItems(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  for (const member of aliveMembers(session)) {
    const player = playerInRoom(runtime, roomId, member.playerId);
    if (!player) continue;
    fillActionItems(player);
  }
}

/** 白天投票表单:选择目标(弃权=0),提交后写选择并刷新票数浮空字 */
function openVoteForm(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
  member: Member,
): void {
  const player = playerInRoom(runtime, roomId, member.playerId);
  if (!player || !member.alive || session.finished) return;
  const candidates = aliveMembers(session)
    .filter((m) => m.playerId !== member.playerId)
    .sort((a, b) => a.number - b.number);
  const options = candidates.map((m) => ({
    label: `${m.number}号 ${m.name}`,
    value: m.number,
  }));
  options.push({ label: "弃权", value: 0 });
  const current = session.selections.get(member.playerId) ?? 0;
  const currentIndex = Math.max(
    0,
    options.findIndex((o) => o.value === current),
  );
  const selected = new ObservableNumber(currentIndex, {
    clientWritable: true,
  });
  const form = new CustomForm(player, "白天投票");
  form.label("§e请选择要投票的玩家(平票无人出局)。");
  form.spacer();
  form.dropdown(
    "投票目标",
    selected,
    options.map((o, i) => ({ label: o.label, value: i })),
  );
  form.spacer();
  form.button("确认投票", () => {
    form.close();
    const opt = options[selected.getData()];
    const oldSeat = session.selections.get(member.playerId);
    if (!opt || opt.value === 0) {
      if (session.selections.delete(member.playerId)) {
        player.sendMessage("§7你选择了弃权");
        if (oldSeat !== undefined) {
          refreshVoteMarker(runtime, roomId, session, oldSeat);
        }
      }
      return;
    }
    session.selections.set(member.playerId, opt.value);
    const target = bySeat(session, opt.value);
    player.sendMessage(
      `§a你投票给了 ${target ? numberText(target) : opt.value + "号"}`,
    );
    if (oldSeat !== undefined && oldSeat !== opt.value) {
      refreshVoteMarker(runtime, roomId, session, oldSeat);
    }
    refreshVoteMarker(runtime, roomId, session, opt.value);
  });
  form.show().catch(() => {
    // 被聊天框等 UI 顶掉/关闭:玩家可再点「打开投票」重开
  });
}

/** 夜间行动表单:狙击手/守卫/杀手/警察,选择后刷新仅自己/队友可见的行动标记 */
function openActionForm(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
  member: Member,
): void {
  const player = playerInRoom(runtime, roomId, member.playerId);
  if (!player || !member.alive || session.finished) return;
  if (session.phase === "day") {
    openVoteForm(runtime, roomId, session, member);
    return;
  }
  const role = phaseRole(session.phase);
  if (!role || member.role !== role) {
    player.sendMessage("§7现在不是你的行动阶段");
    return;
  }
  const seats = candidateSeats(session, member, session.phase);
  const options = seats.map((seat) => {
    const target = bySeat(session, seat);
    return {
      label: target
        ? `${target.number}号 ${target.name}`
        : `${seat}号`,
      value: seat,
    };
  });
  options.push({ label: "不行动/弃权", value: 0 });
  const current = session.selections.get(member.playerId) ?? 0;
  const currentIndex = Math.max(
    0,
    options.findIndex((o) => o.value === current),
  );
  const selected = new ObservableNumber(currentIndex, {
    clientWritable: true,
  });
  const form = new CustomForm(player, `${ROLE_NAMES[role]}行动`);
  form.label(
    `§e请选择行动目标(§6${phaseSeconds(session.phase)} 秒§e内可改)。`,
  );
  form.spacer();
  form.dropdown(
    "目标",
    selected,
    options.map((o, i) => ({ label: o.label, value: i })),
  );
  form.spacer();
  form.button("确认行动", () => {
    form.close();
    const opt = options[selected.getData()];
    if (!opt || opt.value === 0) {
      if (session.selections.delete(member.playerId)) {
        player.sendMessage("§7你选择了不行动/弃权");
        refreshActionMarker(runtime, roomId, session, member);
      }
      return;
    }
    session.selections.set(member.playerId, opt.value);
    const target = bySeat(session, opt.value);
    player.sendMessage(
      `§a你选择了 ${target ? numberText(target) : opt.value + "号"}`,
    );
    refreshActionMarker(runtime, roomId, session, member);
  });
  form.show().catch(() => {
    // 被聊天框等 UI 顶掉/关闭:玩家可再点手中物品重开
  });
}

function titleForPlayer(
  runtime: MinigameRuntime,
  roomId: number,
  player: Player,
  member: Member | undefined,
  session: Session,
  seconds: number,
  isActor: boolean,
): void {
  if (!member || !member.alive) {
    showTemporaryTextForPlayer(runtime, roomId, player, [
      "§7§l你已出局",
      "§7§l请安静观看本局游戏",
    ], 40);
    return;
  }
  if (session.phase === "day") {
    showTemporaryTextForPlayer(runtime, roomId, player, [
      "§a§l进入白天",
      `§f§l讨论并投票 · ${seconds} 秒 · 点击「打开投票」`,
    ], 60);
    return;
  }
  if (isActor) {
    showTemporaryTextForPlayer(runtime, roomId, player, [
      `${ROLE_COLORS[member.role]}§l${ROLE_NAMES[member.role]} §f§l请行动`,
      `§f§l${seconds} 秒 · 使用手中物品选择目标`,
    ], 60);
  } else {
    showTemporaryTextForPlayer(runtime, roomId, player, [
      "§0§l天黑请闭眼",
      `§f§l等待${PHASE_NAMES[session.phase]}行动 · ${seconds} 秒`,
    ], 60);
  }
}

function announcePhaseStart(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  const seconds = phaseSeconds(session.phase);
  const role = phaseRole(session.phase);

  if (session.phase === "day") {
    runtime.announce(
      roomId,
      `§e☀ 第 ${session.night} 夜结束,进入白天!讨论并投票(§6${seconds} 秒§e),点击「打开投票」进行投票。`,
    );
  } else {
    // 只公布"哪个身份在行动",绝不公开行动者的名字(否则等于公开身份)
    runtime.announce(
      roomId,
      `§e🌙 第 ${session.night} 夜 · ${roleText(role!)}行动中(§6${seconds} 秒§e)`,
    );
  }

  for (const player of runtime.roomPlayers(roomId)) {
    const member = session.members.get(player.id);
    const role2 = phaseRole(session.phase);
    const isActor =
      session.phase === "day"
        ? (member?.alive ?? false)
        : (member?.alive ?? false) && member?.role === role2;
    titleForPlayer(runtime, roomId, player, member, session, seconds, isActor);
    if (member?.alive && session.phase !== "day" && isActor) {
      player.sendMessage(
        `${ROLE_COLORS[member.role]}轮到你行动了§r(剩余 §6${seconds} 秒§r):使用手中投票物品选择目标,「取消选择」可取消。`,
      );
    }
    if (member?.alive && session.phase === "day") {
      player.sendMessage(
        `§e白天开始:§r点击「打开投票」物品投票(表单被聊天框顶掉可再点一次),平票将无人被裁决。队内聊天:消息以 §d!§r 开头。`,
      );
    }
  }

  // 白天自动为每位存活玩家弹一次投票表单;夜晚自动为行动者弹行动表单
  // (被聊天框顶掉都可再点手中物品重开)
  if (session.phase === "day") {
    for (const member of aliveMembers(session)) {
      const player = playerInRoom(runtime, roomId, member.playerId);
      if (player) {
        system.runTimeout(
          () => openVoteForm(runtime, roomId, session, member),
          10,
        );
      }
    }
  } else {
    const role = phaseRole(session.phase);
    if (role) {
      for (const member of aliveRoleMembers(session, role)) {
        const player = playerInRoom(runtime, roomId, member.playerId);
        if (player) {
          system.runTimeout(
            () => openActionForm(runtime, roomId, session, member),
            10,
          );
        }
      }
    }
  }

  // 每阶段开始重新锁一次全场固定视角
  lockArenaCamera(runtime, roomId);
}

function updateActionbars(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  // 开局身份展示阶段:不显示阶段倒计时,避免干扰身份 Title
  if (session.identityPhase) {
    for (const player of runtime.roomPlayers(roomId)) {
      const member = session.members.get(player.id);
      player.onScreenDisplay.setActionBar(
        member?.alive ? "§e身份确认中…" : "§7你已出局,等待游戏结束",
      );
    }
    return;
  }
  const remain = Math.max(
    0,
    Math.ceil((session.phaseEndTick - system.currentTick) / 20),
  );
  const role = phaseRole(session.phase);
  for (const player of runtime.roomPlayers(roomId)) {
    const member = session.members.get(player.id);
    if (!member) continue;
    if (!member.alive) {
      player.onScreenDisplay.setActionBar(
        `§7你已出局 · ${PHASE_NAMES[session.phase]} · 剩余 ${remain} 秒`,
      );
      continue;
    }
    const isActor =
      session.phase === "day" || member.role === role;
    const selected = session.selections.get(player.id);
    const target = selected !== undefined ? bySeat(session, selected) : undefined;
    const selectionText = target
      ? `§a已选:${numberText(target)}`
      : "§7未选择";
    if (isActor) {
      player.onScreenDisplay.setActionBar(
        `§e${PHASE_NAMES[session.phase]} · ${remain} 秒 · ${selectionText}`,
      );
    } else {
      player.onScreenDisplay.setActionBar(
        `§e等待${PHASE_NAMES[session.phase]}行动 · ${remain} 秒`,
      );
    }
  }
}

// ================= 出局与胜负 =================

function checkWin(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  if (session.finished) return;
  const killers = aliveRoleMembers(session, "killer").length;
  const civilians = aliveRoleMembers(session, "civilian").length;
  const police = aliveRoleMembers(session, "police").length;

  let message = "";
  let reason = "";
  if (killers === 0) {
    reason = "杀手全部出局";
    message = "§b警察阵营胜利!所有杀手已出局。";
  } else if (civilians === 0 || police === 0) {
    reason = civilians === 0 ? "平民全部出局" : "警察全部出局";
    message = "§c杀手阵营胜利!";
  } else {
    return;
  }

  session.finished = true;
  const reveal = [...session.members.values()]
    .sort((a, b) => a.number - b.number)
    .map(
      (m) =>
        `§e${m.number}号§r ${m.name}:${ROLE_COLORS[m.role]}${ROLE_NAMES[m.role]}${m.alive ? "" : "§7(已出局)"}`,
    )
    .join(" · ");
  runtime.announce(roomId, `§e游戏结束,身份揭晓:\n${reveal}`);
  runtime.endGame(roomId, reason, message);
}

/** 打开遗言表单;已写过则不再弹,并清掉"写遗言"物品 */
function openTestamentForm(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
  member: Member,
  player: Player,
): void {
  if (member.testamentDone) {
    try {
      clearAllPlayerItems(player);
    } catch {
      // 忽略
    }
    return;
  }
  promptTestament(player, (text) => {
    if (member.testamentDone) return;
    member.testamentDone = true;
    // 对局已结束/已重置:不再生成遗言,避免残留到下一局
    if (session.finished || runtime.getPhase(roomId) !== "running") {
      try {
        player.sendMessage("§7对局已结束,遗言不再生成");
        clearAllPlayerItems(player);
      } catch {
        // 忽略
      }
      return;
    }
    try {
      const shape = spawnTestament(
        runtime.roomDim(roomId),
        member.seat,
        text,
      );
      session.testaments.push(shape);
    } catch (error) {
      console.warn("[Bearcade werewolf] 遗言浮空字创建失败", error);
    }
    runtime.announce(
      roomId,
      `§7遗言 · ${numberText(member)}:§o${text.trim() || "空"}`,
    );
    try {
      clearAllPlayerItems(player);
    } catch {
      // 忽略
    }
  });
}

function eliminate(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
  member: Member,
  cause: string,
  allowTestament: boolean,
): void {
  if (!member.alive || session.finished) return;
  member.alive = false;
  session.selections.delete(member.playerId);

  const player = playerInRoom(runtime, roomId, member.playerId);
  if (player) {
    try {
      clearAllPlayerItems(player);
      player.setGameMode(GameMode.Adventure);
      player.addEffect("minecraft:invisibility", 999999, {
        showParticles: false,
      });
      // 出局后仍保持全场固定视角(旧版同款),不还给玩家自由视角
      lockArenaCamera(runtime, roomId);
    } catch {
      // 忽略
    }
    player.onScreenDisplay.setActionBar("§7你已出局");
  }

  runtime.announce(roomId, `§c${numberText(member)} 出局:${cause}`);
  runtime.announce(
    roomId,
    `§7身份揭示:${numberText(member)} 的身份是 ${roleText(member.role)}`,
  );
  // 在遗言位置下方(更靠近座位)写明身份,颜色与身份对应
  spawnIdentityMarker(runtime, roomId, session, member);

  if (allowTestament && player) {
    // 给一个"写遗言"物品:表单被聊天框顶掉后可以右键重新打开
    const inventory = inventoryOf(player)?.container;
    if (inventory) {
      const item = new ItemStack(ACTION_ITEM, 1);
      item.nameTag = TESTAMENT_OPEN_NAME;
      item.lockMode = ItemLockMode.slot;
      inventory.setItem(0, item);
    }
    system.runTimeout(
      () => openTestamentForm(runtime, roomId, session, member, player),
      10,
    );
  }

  checkWin(runtime, roomId, session);
}

function eliminateLeaver(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
  member: Member,
): void {
  // 离场玩家立即恢复移动权限,避免把"禁足"带到大厅
  const leaving = world
    .getAllPlayers()
    .find((p) => p.id === member.playerId);
  if (leaving) {
    try {
      leaving.inputPermissions.setPermissionCategory(
        InputPermissionCategory.LateralMovement,
        true,
      );
      leaving.inputPermissions.setPermissionCategory(
        InputPermissionCategory.Camera,
        true,
      );
      leaving.camera.clear();
    } catch {
      // 忽略
    }
    clearTemporaryTextsForPlayer(leaving.id);
  }
  convertNumberShapeToStatic(runtime, roomId, session, member);
  removeChatBubbles(member.playerId);
  const marker = session.actionMarkers.get(member.playerId);
  if (marker) {
    try {
      world.primitiveShapesManager.removeText(marker);
    } catch {
      // 忽略
    }
    session.actionMarkers.delete(member.playerId);
  }
  eliminate(
    runtime,
    roomId,
    session,
    member,
    "离开了游戏(视为出局,无遗言)",
    false,
  );
}

// ================= 阶段结算 =================

function resolveSniper(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  const sniper = aliveRoleMembers(session, "sniper")[0];
  if (!sniper) return;
  const seat = session.selections.get(sniper.playerId);
  const target = seat !== undefined ? bySeat(session, seat) : undefined;
  if (
    target &&
    target.alive &&
    target.playerId !== sniper.playerId &&
    session.sniperBullets > 0
  ) {
    session.sniperBullets--;
    eliminate(
      runtime,
      roomId,
      session,
      target,
      "被狙击手开枪击中",
      true,
    );
    runtime.announce(
      roomId,
      `§7狙击手剩余子弹:§4${session.sniperBullets} 发`,
    );
  } else {
    runtime.announce(roomId, "§7狙击手没有开枪");
  }
}

function resolveGuard(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  const guard = aliveRoleMembers(session, "guard")[0];
  if (!guard) return;
  const seat = session.selections.get(guard.playerId);
  const target = seat !== undefined ? bySeat(session, seat) : undefined;
  if (target && target.alive && target.number !== session.lastProtectedSeat) {
    session.protectedSeat = target.number;
    session.lastProtectedSeat = target.number;
    const player = playerInRoom(runtime, roomId, guard.playerId);
    player?.sendMessage(`§a你守护了 ${numberText(target)}`);
  } else {
    session.protectedSeat = 0;
    // 本轮没有守护任何人:不占用"连续两晚"冷却,下一晚可自由选择
    session.lastProtectedSeat = 0;
    // 不公开说守卫没守护任何人,只私聊守卫本人
    playerInRoom(runtime, roomId, guard.playerId)?.sendMessage(
      "§7你没有守护任何人",
    );
  }
}

function resolveKiller(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  const killers = aliveRoleMembers(session, "killer");
  const picks = new Set<number>();
  for (const killer of killers) {
    const seat = session.selections.get(killer.playerId);
    const target = seat !== undefined ? bySeat(session, seat) : undefined;
    if (
      target &&
      target.alive &&
      target.role !== "killer" &&
      target.playerId !== killer.playerId
    ) {
      picks.add(target.number);
    }
  }
  if (picks.size === 0) {
    runtime.announce(roomId, "§7杀手没有行动");
  } else if (picks.size > 1) {
    runtime.announce(
      roomId,
      "§7杀手意见分歧,今晚没有玩家被杀害",
    );
  } else {
    const target = bySeat(session, [...picks][0]);
    if (target && target.number === session.protectedSeat) {
      runtime.announce(
        roomId,
        `§g守卫格挡了杀手对 ${numberText(target)} 的攻击!`,
      );
    } else if (target) {
      eliminate(
        runtime,
        roomId,
        session,
        target,
        "被杀手杀害",
        true,
      );
    }
  }
}

function resolvePolice(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  const police = aliveRoleMembers(session, "police");
  const picks = new Set<number>();
  for (const p of police) {
    const seat = session.selections.get(p.playerId);
    const target = seat !== undefined ? bySeat(session, seat) : undefined;
    if (
      target &&
      target.alive &&
      target.role !== "police" &&
      target.playerId !== p.playerId
    ) {
      picks.add(target.number);
    }
  }
  if (picks.size === 0) {
    runtime.announce(roomId, "§7警察没有查验任何人");
    return;
  }
  // 两人选不同目标时随机查验其一;只有一人行动时按该选择生效
  const pickList = [...picks];
  const chosen =
    pickList.length === 1
      ? pickList[0]
      : pickList[Math.floor(Math.random() * pickList.length)];
  const target = bySeat(session, chosen);
  if (!target) return;
  for (const p of police) {
    const player = playerInRoom(runtime, roomId, p.playerId);
    player?.sendMessage(
      `§b查验结果:${numberText(target)} 的身份是 ${roleText(target.role)}`,
    );
  }
}

function resolveDay(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  const votes = new Map<number, number>();
  for (const member of aliveMembers(session)) {
    const seat = session.selections.get(member.playerId);
    if (seat === undefined) continue;
    const target = bySeat(session, seat);
    if (!target || !target.alive || target.playerId === member.playerId) {
      continue;
    }
    votes.set(target.number, (votes.get(target.number) ?? 0) + 1);
  }
  if (votes.size === 0) {
    runtime.announce(roomId, "§7没有人投票,无人被公投裁决");
    return;
  }
  const max = Math.max(...votes.values());
  const winners = [...votes.entries()]
    .filter(([, count]) => count === max)
    .map(([seat]) => seat);
  if (winners.length !== 1) {
    runtime.announce(
      roomId,
      `§7平票(各 ${max} 票),无人被公投裁决`,
    );
    return;
  }
  const target = bySeat(session, winners[0]);
  if (target) {
    eliminate(
      runtime,
      roomId,
      session,
      target,
      `被公投裁决(§6${max} 票§c)`,
      true,
    );
  }
}

function resolvePhase(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  switch (session.phase) {
    case "sniper":
      resolveSniper(runtime, roomId, session);
      break;
    case "guard":
      resolveGuard(runtime, roomId, session);
      break;
    case "killer":
      resolveKiller(runtime, roomId, session);
      break;
    case "police":
      resolvePolice(runtime, roomId, session);
      break;
    case "day":
      resolveDay(runtime, roomId, session);
      break;
  }
}

function skipReason(session: Session, phase: Phase): string | undefined {
  switch (phase) {
    case "sniper": {
      if (aliveRoleMembers(session, "sniper").length === 0) {
        return "§7狙击手已出局,跳过狙击手阶段";
      }
      if (session.sniperBullets <= 0) {
        return "§7狙击手没有子弹,跳过狙击手阶段";
      }
      return undefined;
    }
    case "guard":
      return aliveRoleMembers(session, "guard").length === 0
        ? "§7守卫已出局,跳过守卫阶段"
        : undefined;
    case "killer":
      return aliveRoleMembers(session, "killer").length === 0
        ? "§7没有存活的杀手,跳过杀手阶段"
        : undefined;
    case "police":
      return aliveRoleMembers(session, "police").length === 0
        ? "§7警察已全部出局,跳过警察阶段"
        : undefined;
    default:
      return undefined;
  }
}

function enterPhase(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
  phase: Phase,
): void {
  let index = PHASE_ORDER.indexOf(phase);
  while (!session.finished) {
    const current = PHASE_ORDER[index % PHASE_ORDER.length];
    const reason = skipReason(session, current);
    if (reason) {
      runtime.announce(roomId, reason);
      index++;
      continue;
    }
    if (current === "sniper") {
      session.night++;
    }
    if (current === "day") {
      session.protectedSeat = 0;
    }
    session.phase = current;
    session.phaseEndTick =
      system.currentTick + phaseSeconds(current) * 20;
    session.selections.clear();
    clearVoteMarkers(session);
    clearActionMarkers(session);
    clearPhaseItems(runtime, roomId, session);
    givePhaseItems(runtime, roomId, session);
    announcePhaseStart(runtime, roomId, session);
    return;
  }
}

// ================= 主循环 =================

function tick(runtime: MinigameRuntime): void {
  for (const [roomId, session] of [...sessions.entries()]) {
    try {
      const phase = runtime.getPhase(roomId);
      // 结束进入 resetting 时保留 session,让 onBeforeReset 能清理浮空字;
      // 只有真正离开 running/resetting(回到 idle)才删除
      if (phase !== "running" && phase !== "resetting") {
        sessions.delete(roomId);
        continue;
      }
      if (session.finished) continue;

      // 退出/断线/传送离场一律视为出局(无遗言),对局继续
      const inRoomIds = new Set(
        runtime.roomPlayers(roomId).map((p) => p.id),
      );
      for (const member of [...session.members.values()]) {
        if (!member.alive || inRoomIds.has(member.playerId)) continue;
        eliminateLeaver(runtime, roomId, session, member);
      }
      if (session.finished) continue;

      // 掉下场地拉回座位(存活与已出局玩家都处理)
      for (const member of [...session.members.values()]) {
        const player = playerInRoom(runtime, roomId, member.playerId);
        if (player && player.location.y < -63) {
          player.teleport(
            {
              x: member.seat.x + 0.5,
              y: member.seat.y,
              z: member.seat.z + 0.5,
            },
            { dimension: runtime.roomDim(roomId) },
          );
        }
      }

      updateActionbars(runtime, roomId, session);

      // 周期重锁全场视角(每 20 tick),防止个别玩家相机被客户端/其他输入抢占
      if (system.currentTick - session.lastCameraTick >= 20) {
        lockArenaCamera(runtime, roomId);
        session.lastCameraTick = system.currentTick;
      }

      // 开局身份展示阶段:4 秒后才正式进入第一夜
      if (session.identityPhase) {
        if (system.currentTick >= session.phaseEndTick) {
          session.identityPhase = false;
          enterPhase(runtime, roomId, session, "sniper");
        }
        continue;
      }

      if (system.currentTick >= session.phaseEndTick) {
        resolvePhase(runtime, roomId, session);
        if (session.finished) continue;
        const next =
          PHASE_ORDER[
            (PHASE_ORDER.indexOf(session.phase) + 1) % PHASE_ORDER.length
          ];
        enterPhase(runtime, roomId, session, next);
      }
    } catch (error) {
      console.warn(
        `[Bearcade werewolf] 对局 tick 异常 room=${roomId}`,
        error,
      );
    }
  }
}

// ================= 事件装配 =================

function handleItemUse(
  runtime: MinigameRuntime,
  event: import("@minecraft/server").ItemUseAfterEvent,
): void {
  if (event.itemStack.typeId !== ACTION_ITEM) return;
  const player = event.source;
  const roomId = runtime.roomIdFromDimension(player.dimension.id);
  if (roomId === undefined) return;
  const session = sessions.get(roomId);
  const member = session?.members.get(player.id);
  if (
    !session ||
    !member ||
    session.finished ||
    runtime.getPhase(roomId) !== "running"
  ) {
    return;
  }

  const name = event.itemStack.nameTag ?? "";

  // 出局玩家:只能使用「写遗言」物品重开遗言表单(被聊天框顶掉后可重开)
  if (!member.alive) {
    if (name.includes("写遗言")) {
      openTestamentForm(runtime, roomId, session, member, player);
    }
    return;
  }

  // 存活玩家:点击手中物品 → 白天开投票表单;夜晚行动者开行动表单,非行动者提示
  if (session.phase === "day") {
    openVoteForm(runtime, roomId, session, member);
    return;
  }
  const role = phaseRole(session.phase);
  if (role && member.role === role) {
    openActionForm(runtime, roomId, session, member);
  } else {
    player.sendMessage("§7现在不是你的行动阶段");
  }
}

function handleTeamChat(
  runtime: MinigameRuntime,
  event: import("@minecraft/server").ChatSendBeforeEvent,
): void {
  const roomId = runtime.roomIdFromDimension(event.sender.dimension.id);
  if (roomId === undefined) return;
  const session = sessions.get(roomId);
  const member = session?.members.get(event.sender.id);
  if (!session || !member) return;

  const sender = event.sender;

  // 出局玩家本局禁言:公开聊天与队内聊天一律拦截
  if (!member.alive) {
    event.cancel = true;
    system.run(() => {
      sender.sendMessage(
        "§c你已出局,本局禁言;若要写遗言,请使用手中的『写遗言』物品",
      );
    });
    return;
  }

  // 普通公开聊天:放行 + 头顶聊天气泡
  if (!event.message.startsWith("!")) {
    const bubbleText = event.message;
    system.run(() => addChatBubble(sender, bubbleText));
    return;
  }

  event.cancel = true;
  const text = event.message.slice(1).trim();
  const team: Role | undefined =
    member.role === "killer" || member.role === "police"
      ? member.role
      : undefined;

  system.run(() => {
    if (!text) {
      sender.sendMessage("§c队内消息不能为空(!+内容)");
      return;
    }
    if (!team) {
      sender.sendMessage("§c你的身份没有队内聊天");
      return;
    }
    const prefix = `§l§d[队内]§r ${numberText(member)}§r: ${text}`;
    for (const other of session.members.values()) {
      if (other.role !== team || !other.alive) continue;
      playerInRoom(runtime, roomId, other.playerId)?.sendMessage(prefix);
    }
  });
}

function teleportToSeat(
  runtime: MinigameRuntime,
  roomId: number,
  member: Member,
): void {
  const player = playerInRoom(runtime, roomId, member.playerId);
  if (!player) return;
  player.teleport(
    {
      x: member.seat.x + 0.5,
      y: member.seat.y,
      z: member.seat.z + 0.5,
    },
    { dimension: runtime.roomDim(roomId) },
  );
  player.setSpawnPoint({
    dimension: runtime.roomDim(roomId),
    x: member.seat.x + 0.5,
    y: member.seat.y,
    z: member.seat.z + 0.5,
  });
}

// ================= 玩法钩子 =================

export function makeWerewolfHooks(
  getRuntime: () => MinigameRuntime,
): MinigameHooks {
  return {
    onGameStart(roomId, players) {
      const runtime = getRuntime();
      const counts: RoleCounts = roleCountsFor(players.length);

      // 角色随机洗牌分配,座位号按入场顺序 1..N
      const rolePool: Role[] = [];
      for (const role of [
        "civilian",
        "police",
        "guard",
        "killer",
        "sniper",
      ] as Role[]) {
        for (let i = 0; i < counts[role]; i++) rolePool.push(role);
      }
      const shuffledRoles = shuffle(rolePool);
      const pads = usedSeatsFor(players.length);

      const members = new Map<string, Member>();
      players.forEach((player, index) => {
        const pad = pads[index] ?? pads[pads.length - 1];
        const member: Member = {
          playerId: player.id,
          name: player.name,
          // 号码永远从 1 开始顺序排;站到中间的物理色块上,颜色跟随色块
          number: index + 1,
          role: shuffledRoles[index],
          alive: true,
          seat: SEATS[pad - 1] ?? SEATS[SEATS.length - 1],
          color: PAD_COLORS[pad] ?? "§f",
          testamentDone: false,
        };
        members.set(player.id, member);
      });

      const session: Session = {
        night: 0,
        phase: "sniper",
        phaseEndTick: 0,
        selections: new Map(),
        members,
        sniperBullets: counts.sniperBullets,
        protectedSeat: 0,
        lastProtectedSeat: 0,
        testaments: [],
        identityShapes: [],
        voteMarkers: new Map(),
        actionMarkers: new Map(),
        numberShapes: new Map(),
        finished: false,
        lastCameraTick: 0,
        identityPhase: true,
      };
      sessions.set(roomId, session);

      // 正式开始前再清一次场地内的静态悬浮字(防止上局/意外残留)
      clearArenaFloatingTexts(runtime, roomId);

      // 落座与基础状态:名牌只做颜色染色,号码改用头顶 TextPrimitive
      for (const member of members.values()) {
        const player = playerInRoom(runtime, roomId, member.playerId);
        if (!player) continue;
        player.setGameMode(GameMode.Adventure);
        // 对局中给饱和,防止饿死
        try {
          player.addEffect("minecraft:saturation", 999999, {
            amplifier: 0,
            showParticles: false,
          });
        } catch {
          // 忽略
        }
        player.nameTag = `${member.color}${member.name}§r`;
        player.chatNamePrefix = `${member.color}${member.number}号§r `;
        player.chatNameSuffix = "§r";
        teleportToSeat(runtime, roomId, member);
        createNumberShape(runtime, roomId, member, session);
        player.sendMessage(
          `§a你是 ${member.color}${member.number}号§r,身份:${roleText(member.role)}`,
        );
      }

      // 阵营互相知晓
      const police = aliveRoleMembers(session, "police");
      const killers = aliveRoleMembers(session, "killer");
      for (const p of police) {
        playerInRoom(runtime, roomId, p.playerId)?.sendMessage(
          `§b警察阵营玩家:${police.map(numberText).join("、")}\n§7队内聊天:消息以 §d!§r 开头(仅警察可见)。`,
        );
      }
      for (const k of killers) {
        playerInRoom(runtime, roomId, k.playerId)?.sendMessage(
          `§c杀手阵营玩家:${killers.map(numberText).join("、")}\n§7队内聊天:消息以 §d!§r 开头(仅杀手可见)。`,
        );
      }
      for (const member of members.values()) {
        const player = playerInRoom(runtime, roomId, member.playerId);
        if (!player) continue;
        const title = `${ROLE_COLORS[member.role]}§l${ROLE_NAMES[member.role]}§r`;
        let subtitle = "";
        if (member.role === "civilian") {
          subtitle = "§l§f找出杀手,投票将其淘汰!";
          player.sendMessage("§f目标:通过发言找出杀手,投票将其淘汰!");
        } else if (member.role === "guard") {
          subtitle = "§l§e每晚保护一名玩家;不可连续两晚保护同一人。";
          player.sendMessage(
            "§g目标:每晚保护一名玩家免受杀手伤害;不可连续两晚保护同一人,不可保护自己。",
          );
        } else if (member.role === "police") {
          subtitle = `§l§b查验身份,揪出杀手!队友:${police
            .map((m) => `${m.number}号 ${m.name}`)
            .join("、")}`;
          player.sendMessage("§b目标:每晚查验一名玩家身份,协助找出杀手!");
        } else if (member.role === "killer") {
          subtitle = `§l§c杀死全部平民或全部警察!队友:${killers
            .map((m) => `${m.number}号 ${m.name}`)
            .join("、")}`;
          player.sendMessage(
            "§c目标:杀死全部平民或全部警察;每晚与队友选择同一目标才可击杀。",
          );
        } else if (member.role === "sniper") {
          subtitle = `§l§4协助杀手消灭全部平民或警察!子弹:${session.sniperBullets} 发`;
          player.sendMessage(
            `§4目标:协助杀手消灭全部平民或全部警察;你有 §6${session.sniperBullets} 发§4子弹,可在任意夜晚开枪,无队内聊天。`,
          );
        }
        try {
          showTemporaryTextForPlayer(
            runtime,
            roomId,
            player,
            [title, subtitle],
            IDENTITY_SHOW_TICKS,
          );
        } catch {
          // 忽略
        }
      }

      runtime.announce(
        roomId,
        `§a天黑请闭眼开始!${players.length} 名玩家,职业配置:` +
          `平民 ${counts.civilian} / 警察 ${counts.police} / 守卫 ${counts.guard} / 杀手 ${counts.killer} / 狙击手 ${counts.sniper}。`,
      );
      // 禁足:通过输入权限组件禁用移动(不是持续 tp)
      setMovementLocked(runtime, roomId, true);
      // 旧版同款全场固定视角;传送刚完成立即 setCamera 可能被吞,
      // 因此立刻锁一次 + 延迟 2/10 tick 再补锁两次兜底,后续每个阶段与每 20 tick 周期性重锁
      lockArenaCamera(runtime, roomId);
      system.runTimeout(() => lockArenaCamera(runtime, roomId), 2);
      system.runTimeout(() => lockArenaCamera(runtime, roomId), 10);
      // 先展示身份 Title/Subtitle(4 秒),再进入第一夜,避免被阶段 Title 立刻盖掉
      session.phaseEndTick = system.currentTick + IDENTITY_SHOW_TICKS;
    },

    onBeforeReset(roomId) {
      const runtime = getRuntime();
      const session = sessions.get(roomId);
      if (session) {
        session.finished = true;
        for (const shape of session.testaments) {
          try {
            shape.remove();
          } catch {
            // 忽略
          }
        }
        for (const shape of session.identityShapes) {
          try {
            shape.remove();
          } catch {
            // 忽略
          }
        }
        clearVoteMarkers(session);
        clearActionMarkers(session);
        for (const playerId of [...session.numberShapes.keys()]) {
          removeNumberShape(session, playerId);
        }
        for (const member of session.members.values()) {
          removeChatBubbles(member.playerId);
        }
      }
      for (const player of runtime.roomPlayers(roomId)) {
        try {
          clearAllPlayerItems(player);
          player.setGameMode(GameMode.Adventure);
          player.setSpawnPoint(undefined);
          player.removeEffect("minecraft:invisibility");
          player.nameTag = player.name;
          player.chatNamePrefix = undefined;
          player.chatNameSuffix = undefined;
          // 恢复横向移动与视角
          player.inputPermissions.setPermissionCategory(
            InputPermissionCategory.LateralMovement,
            true,
          );
          player.inputPermissions.setPermissionCategory(
            InputPermissionCategory.Camera,
            true,
          );
          player.camera.clear();
        } catch {
          // 忽略,Core 回大厅时还会兜底初始化
        }
      }
      sessions.delete(roomId);
    },

    openConfig(player) {
      openWerewolfConfig(player, getRuntime());
    },
  };
}

export function initWerewolf(getRuntime: () => MinigameRuntime): void {
  const runtime = getRuntime();

  // 自定义投票物品 on_use 会执行 scoreboard 命令,预建计分板目标保证命令有效
  try {
    if (!world.scoreboard.getObjective("ww_click")) {
      world.scoreboard.addObjective("ww_click", "dummy");
    }
  } catch {
    // 忽略
  }

  // 对局内与等候室一律禁止玩家伤害(无 PVP、无摔落伤害)
  world.beforeEvents.entityHurt.subscribe((event) => {
    const victim = event.hurtEntity;
    if (victim.typeId !== "minecraft:player") return;
    const roomId = runtime.roomIdFromDimension(victim.dimension.id);
    if (
      roomId !== undefined &&
      roomId >= 1 &&
      roomId <= runtime.config.roomCount
    ) {
      event.cancel = true;
    }
  });

  // 队内聊天:!开头 → 仅同队存活玩家可见
  world.beforeEvents.chatSend.subscribe((event) => {
    handleTeamChat(runtime, event);
  });

  // 离开房间维度时立即恢复移动权限、释放强制相机、清理该玩家所有悬浮字(回大厅/断线路径兜底)
  world.afterEvents.playerDimensionChange.subscribe((event) => {
    const fromRoom = runtime.roomIdFromDimension(event.fromDimension.id);
    if (fromRoom !== undefined && sessions.has(fromRoom)) {
      try {
        event.player.inputPermissions.setPermissionCategory(
          InputPermissionCategory.LateralMovement,
          true,
        );
        event.player.inputPermissions.setPermissionCategory(
          InputPermissionCategory.Camera,
          true,
        );
        event.player.camera.clear();
      } catch {
        // 忽略
      }
      removeChatBubbles(event.player.id);
      clearTemporaryTextsForPlayer(event.player.id);
      const session = sessions.get(fromRoom);
      if (session) {
        const member = session.members.get(event.player.id);
        if (member) {
          convertNumberShapeToStatic(runtime, fromRoom, session, member);
        }
        const marker = session.actionMarkers.get(event.player.id);
        if (marker) {
          try {
            world.primitiveShapesManager.removeText(marker);
          } catch {
            // 忽略
          }
          session.actionMarkers.delete(event.player.id);
        }
      }
    }
  });

  world.afterEvents.playerLeave.subscribe((event) => {
    removeChatBubbles(event.playerId);
  });

  // 投票/行动物品
  world.afterEvents.itemUse.subscribe((event) => {
    handleItemUse(runtime, event);
  });

  // 等待阶段(空闲/准备/初始化)持续清理场地内残留的上一局静态悬浮字
  system.runInterval(() => {
    try {
      const rt = getRuntime();
      for (let roomId = 1; roomId <= rt.config.roomCount; roomId++) {
        const phase = rt.getPhase(roomId);
        if (phase === "idle" || phase === "pending") {
          clearArenaFloatingTexts(rt, roomId);
        }
      }
    } catch {
      // 忽略
    }
  }, 100);

  // 主循环
  system.runInterval(() => tick(runtime), 10);
}
