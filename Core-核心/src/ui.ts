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

function statusText(room: RoomInfo): string {
  if (room.stale) return "§8数据过期§r";
  switch (room.status) {
    case "initializing":
      return "§7初始化中§r";
    case "idle":
      return "§a空闲中§r";
    case "running":
      return "§c运行中§r";
  }
}

function roomLabel(entry: GameEntry, room: RoomInfo): string {
  return `房间 ${room.id}  ${statusText(room)}  ${room.players}/${entry.maxPlayers} 人`;
}

export function openMainMenu(player: Player): void {
  closeForm(player.id);
  const form = new CustomForm(player, "Bearcade 服务器");
  form.label(`§e欢迎, ${player.name}`);
  form.spacer();
  form.button("游戏列表", () => {
    closeForm(player.id);
    system.runTimeout(() => openGameList(player), MENU_DELAY_TICKS);
  });
  form.closeButton();
  trackForm(player.id, form);
}

export function openGameList(player: Player): void {
  closeForm(player.id);
  const form = new CustomForm(player, "游戏列表");
  const games = registryForUi.listGames();

  if (games.length === 0) {
    form.label("§7暂无游戏(等待小游戏包注册)");
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
  form.closeButton();
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
    const disable = new ObservableBoolean(!registryForUi.canJoin(entry, room));
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
  form.closeButton();

  roomViews.set(player.id, { game: entry, form, labels, disabled });
  trackForm(player.id, form);
}

function handleJoin(player: Player, entry: GameEntry, roomId: number): void {
  closeForm(player.id);

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
    player.teleport(entry.prepSpawn, { dimension });
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
        ?.setData(!registryForUi.canJoin(entry, room));
    }
  }
}
