import {
  world,
  system,
  type Player,
} from "@minecraft/server";
import {
  CustomForm,
  MessageBox,
  ObservableString,
  ObservableBoolean,
} from "@minecraft/server-ui";
import type { GameRegistry } from "./registry";
import type { GameEntry, RoomInfo } from "./types";
import { isAdmin, isPartyMode } from "./party";

const MENU_DELAY_TICKS = 2;
let registryForUi: GameRegistry;

interface RoomView {
  game: GameEntry;
  form: CustomForm;
  labels: Map<number, ObservableString>;
  disabled: Map<number, ObservableBoolean>;
}

const openForms = new Map<string, CustomForm>();
const roomViews = new Map<string, RoomView>();

function closeForm(playerId: string): void {
  const form = openForms.get(playerId);
  if (form && form.isShowing()) {
    try {
      form.close();
    } catch (error) {
      console.warn("[Bearcade Core] 关闭表单失败", error);
    }
  }
  openForms.delete(playerId);
}

function trackForm(playerId: string, form: CustomForm): void {
  closeForm(playerId);
  openForms.set(playerId, form);
  try {
    const shown = form.show();
    shown.catch((error) => {
      console.warn("[Bearcade Core] 表单显示失败", error);
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
    console.warn("[Bearcade Core] 表单 show() 同步抛出", error);
    openForms.delete(playerId);
  }
}

function showNotice(player: Player, text: string): void {
  new MessageBox(player, "Bearcade")
    .body(text)
    .button1("确定")
    .show()
    .catch((error) => {
      console.warn("[Bearcade Core] 提示框显示失败", error);
    });
}

// 注意:DDUI 按钮文本不解析 § 颜色码,状态只能用纯文本/符号表达
function roomLabel(entry: GameEntry, room: RoomInfo): string {
  const status = room.stale
    ? "数据过期"
    : room.status === "initializing"
      ? "初始化中"
      : room.status === "idle"
        ? "空闲中"
        : "运行中";
  return `房间 ${room.id} [${status}] ${room.players}/${entry.maxPlayers} 人`;
}

function canJoinForUi(entry: GameEntry, room: RoomInfo): boolean {
  // 派对模式下忽略人数上限,只看房间是否空闲且数据未过期
  if (isPartyMode()) {
    return !room.stale && room.status === "idle";
  }
  return registryForUi.canJoin(entry, room);
}

export function openMainMenu(player: Player): void {
  closeForm(player.id);
  const form = new CustomForm(player, "Bearcade 服务器");
  form.label(`§e欢迎, ${player.name}`);
  form.spacer();
  if (isPartyMode()) {
    form.label(
      isAdmin(player)
        ? "§e派对模式已开启,点击游戏列表带队加入"
        : "§e派对模式已开启,等待管理员带队加入",
    );
    form.spacer();
  }
  if (isPartyMode() && !isAdmin(player)) {
    form.button("关闭", () => {
      closeForm(player.id);
    });
    trackForm(player.id, form);
    return;
  }
  form.button("游戏列表", () => {
    closeForm(player.id);
    system.runTimeout(() => openGameList(player), MENU_DELAY_TICKS);
  });
  trackForm(player.id, form);
}

export function openGameList(player: Player): void {
  closeForm(player.id);
  const form = new CustomForm(player, "游戏列表");
  const games = registryForUi
    .listGames()
    .filter((entry) => !isPartyMode() || entry.partyAvailable);

  if (games.length === 0) {
    form.label(
      isPartyMode()
        ? "§7派对模式:暂无支持全员加入的游戏"
        : "§7暂无游戏(等待小游戏包注册)",
    );
  } else {
    for (const entry of games) {
      form.button(entry.displayName, () => {
        closeForm(player.id);
        system.runTimeout(
          () => openRoomList(player, entry.game),
          MENU_DELAY_TICKS,
        );
      });
    }
  }
  form.spacer();
  form.button("返回", () => {
    closeForm(player.id);
    system.runTimeout(() => openMainMenu(player), MENU_DELAY_TICKS);
  });
  trackForm(player.id, form);
}

export function setUiRegistry(registry: GameRegistry): void {
  registryForUi = registry;
}

export function openRoomList(player: Player, game: string): void {
  const entry = registryForUi.getGame(game);
  if (!entry) return;

  closeForm(player.id);
  const labels = new Map<number, ObservableString>();
  const disabled = new Map<number, ObservableBoolean>();
  const form = new CustomForm(player, `${entry.displayName} · 房间列表`);

  for (let roomId = 1; roomId <= entry.roomCount; roomId++) {
    const room = entry.rooms.get(roomId);
    if (!room) continue;
    const label = new ObservableString(roomLabel(entry, room));
    const disable = new ObservableBoolean(!canJoinForUi(entry, room));
    labels.set(roomId, label);
    disabled.set(roomId, disable);
    form.button(
      label,
      () => {
        void handleJoin(player, entry, roomId);
      },
      { disabled: disable },
    );
  }

  form.spacer();
  form.button("返回", () => {
    closeForm(player.id);
    system.runTimeout(() => openGameList(player), MENU_DELAY_TICKS);
  });

  roomViews.set(player.id, { game: entry, form, labels, disabled });
  trackForm(player.id, form);
}

function handleJoin(player: Player, entry: GameEntry, roomId: number): void {
  closeForm(player.id);

  // 派对模式:管理员带队,全服玩家一起加入(仅 PartyAvailable 游戏)
  if (isPartyMode()) {
    if (!isAdmin(player)) return;
    if (!entry.partyAvailable) {
      showNotice(player, "该游戏不支持派对模式。");
      return;
    }
    const partyRoom = registryForUi.getRoom(entry.game, roomId);
    if (!partyRoom || partyRoom.stale || partyRoom.status !== "idle") {
      showNotice(player, "该房间当前不可用,请稍后再试。");
      return;
    }
    const allPlayers = world.getAllPlayers();
    // 派对模式需全服在线人数达到该游戏最少开局人数,否则房间永远无法开局
    if (allPlayers.length < entry.minPlayers) {
      showNotice(
        player,
        `派对模式需要至少 ${entry.minPlayers} 名玩家在线才能开局,当前 ${allPlayers.length} 人。`,
      );
      return;
    }
    const previousReserved = partyRoom.reserved;
    partyRoom.reserved = Math.max(partyRoom.reserved, allPlayers.length);
    const dimensionId = registryForUi.roomDimensionId(entry.game, roomId);
    try {
      const dimension = world.getDimension(dimensionId);
      for (const p of allPlayers) {
        p.teleport(
          {
            x: entry.prepSpawn.x + 0.5,
            y: entry.prepSpawn.y + 0.5,
            z: entry.prepSpawn.z + 0.5,
          },
          { dimension },
        );
        registryForUi.bindPlayer(p.id, entry.game, roomId);
      }
      showNotice(player, `已带领 ${allPlayers.length} 名玩家加入房间 ${roomId}`);
    } catch (error) {
      // 回滚本次带队预留;下一次 room.status 上报仍会以实际上报人数为准
      partyRoom.reserved = previousReserved;
      console.warn(
        `[Bearcade Core] 派对传送失败:${player.name} -> ${dimensionId}`,
        error,
      );
      showNotice(player, "派对加入失败:房间维度尚未就绪。");
    }
    return;
  }

  if (registryForUi.getPlayerRoom(player.id)) {
    showNotice(player, "你已在房间内,请先返回大厅再选择其他房间。");
    return;
  }

  const room = registryForUi.getRoom(entry.game, roomId);
  if (!room) return;
  if (!registryForUi.canJoin(entry, room)) {
    showNotice(player, "该房间当前不可加入(人数已满或不在空闲中)。");
    return;
  }

  room.reserved += 1;
  const dimensionId = registryForUi.roomDimensionId(entry.game, roomId);
  try {
    const dimension = world.getDimension(dimensionId);
    // 坐标默认按方块中心:传送时 +0.5
    player.teleport(
      {
        x: entry.prepSpawn.x + 0.5,
        y: entry.prepSpawn.y + 0.5,
        z: entry.prepSpawn.z + 0.5,
      },
      { dimension },
    );
    registryForUi.bindPlayer(player.id, entry.game, roomId);
  } catch (error) {
    room.reserved = Math.max(0, room.reserved - 1);
    console.warn(
      `[Bearcade Core] 传送失败:${player.name} -> ${dimensionId}`,
      error,
    );
    showNotice(player, "加入失败:房间维度尚未就绪。");
  }
}

export function refreshRoomViews(): void {
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
      view.disabled
        .get(roomId)
        ?.setData(!canJoinForUi(entry, room));
    }
  }
}
