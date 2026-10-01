// ============================================================
// 开发者面板
// 右键「命令方块矿车」物品(仅 op tag 管理员)打开,为
// /bearcade:config、/bearcade:tmp、/bearcade:debug、/bearcade:party、
// /bearcade:quit 提供图形入口。
// 所有动作复用 actions.ts,与命令共用同一份实现与提示文案,
// 面板本身不新增任何对游戏包的指令语义。
// ============================================================
import { system, world, Player } from "@minecraft/server";
import {
  CustomForm,
  ObservableBoolean,
  ObservableString,
} from "@minecraft/server-ui";
import type { GameRegistry } from "./registry";
import type { GameEntry, RoomInfo } from "./types";
import { isAdmin, isPartyMode, togglePartyMode } from "./party";
import { isGameOpen, setGameOpen } from "./access";
import { MENU_DELAY_TICKS, showNotice, trackForm } from "./ui";
import {
  ROOM_DIM_PATTERN,
  isGameDebugEnabled,
  requestConfig,
  requestDebug,
  requestQuitDimension,
  requestTmpAction,
  teleportToLobby,
  type ActionResult,
} from "./actions";

/** 触发物品:原版命令方块矿车(可手持右键,无需自建物品定义) */
export const DEV_PANEL_ITEM = "minecraft:command_block_minecart";

/**
 * 切换调试开关后重新打开详情页的延迟。
 * 游戏包收到 game.debug 后才把状态写入动态属性(经 system.run 延迟),
 * 立即重读会拿到旧值,留 1 秒让它落盘。
 */
const DEBUG_STATE_REFRESH_TICKS = 20;

let registryForDev: GameRegistry | undefined;

/** 房间状态面板的实时刷新表:playerId -> 视图 */
const roomStatusViews = new Map<
  string,
  { form: CustomForm; game: string; labels: Map<number, ObservableString> }
>();

/**
 * 注册触发监听。需在 worldLoad 之后调用(此时注册表已就绪)。
 * 管理员手持命令方块矿车右键 → 打开面板;非管理员不拦截,保留原版行为。
 */
export function initDevPanel(registry: GameRegistry): void {
  registryForDev = registry;

  world.beforeEvents.itemUse.subscribe((event) => {
    const player = event.source;
    if (!player || !(player instanceof Player)) return;
    if (event.itemStack?.typeId !== DEV_PANEL_ITEM) return;
    if (!isAdmin(player)) return;
    // 拦截物品原本的放置行为,避免站在铁轨上误放矿车
    event.cancel = true;
    // before 事件运行在 restricted execution 上下文,开表单必须延迟到正常上下文
    system.run(() => {
      try {
        openDevPanel(player);
      } catch (error) {
        console.warn("[Bearcade Core] 打开开发者面板失败", error);
      }
    });
  });
}

/** 面板实时刷新(挂在 Core 的 2 秒轮询里) */
export function refreshDevViews(): void {
  if (roomStatusViews.size === 0) return;
  for (const [playerId, view] of roomStatusViews) {
    const registry = registryForDev;
    const entry = registry?.getActiveGame(view.game);
    if (!view.form.isShowing() || !registry || !entry) {
      roomStatusViews.delete(playerId);
      continue;
    }
    for (const [roomId, label] of view.labels) {
      const room = entry.rooms.get(roomId);
      if (room) label.setData(roomStatusLine(registry, entry, room));
    }
  }
}

function registryOrNotice(player: Player): GameRegistry | undefined {
  if (!registryForDev) {
    showNotice(player, "注册表尚未就绪,请稍后再试。");
    return undefined;
  }
  return registryForDev;
}

/** 失败时用与命令一致的中文提示;返回是否成功 */
function applyResult(player: Player, result: ActionResult): boolean {
  if (result.ok) return true;
  showNotice(player, result.reason);
  return false;
}

function roomStatusLine(
  registry: GameRegistry,
  entry: GameEntry,
  room: RoomInfo,
): string {
  const status = room.stale
    ? "数据过期"
    : room.status === "initializing"
      ? "初始化中"
      : room.status === "idle"
        ? "空闲中"
        : "运行中";
  const tail = registry.canJoin(entry, room)
    ? " §a可加入"
    : room.stale
      ? " §c数据已过期"
      : room.status === "running"
        ? " §e对局中"
        : " §7不可加入";
  return `§7房间 §f${room.id} §7[§f${status}§7] §f${room.players}§7/${entry.maxPlayers} 人${tail}`;
}

function openDevPanel(player: Player): void {
  const registry = registryOrNotice(player);
  if (!registry) return;
  const games = registry.listGames();
  const inRoom = ROOM_DIM_PATTERN.test(player.dimension.id);

  const form = new CustomForm(player, "Bearcade 开发者面板");
  form.label(
    `§7在线游戏:§f${games.length} §7| 派对模式:§f${isPartyMode() ? "开" : "关"}`,
  );
  form.label(`§7当前维度:§f${player.dimension.id}`);
  if (!inRoom) form.label("§7(不在房间维度,无法强制中止对局)");
  form.spacer();
  form.button("游戏列表", () => {
    form.close();
    system.runTimeout(() => openDevGameList(player), MENU_DELAY_TICKS);
  });
  form.button("切换派对模式", () => {
    form.close();
    system.runTimeout(() => {
      togglePartyMode();
      openDevPanel(player);
    }, MENU_DELAY_TICKS);
  });
  form.button("传送回大厅", () => {
    form.close();
    system.runTimeout(() => teleportToLobby(player), MENU_DELAY_TICKS);
  });
  form.button(
    "强制中止当前房间对局",
    () => {
      form.close();
      system.runTimeout(() => {
        const result = requestQuitDimension(registry, player.dimension.id);
        if (!applyResult(player, result)) {
          openDevPanel(player);
        } else {
          player.sendMessage("§a已请求强制中止当前对局");
        }
      }, MENU_DELAY_TICKS);
    },
    { disabled: new ObservableBoolean(!inRoom) },
  );
  form.spacer();
  form.button("关闭", () => form.close());
  trackForm(player.id, form);
}

function openDevGameList(player: Player): void {
  const registry = registryOrNotice(player);
  if (!registry) return;
  const games = registry.listGames();

  const form = new CustomForm(player, "开发者面板 · 游戏列表");
  if (games.length === 0) {
    form.label("§7暂无游戏(等待小游戏包注册)");
  } else {
    for (const entry of games) {
      const open = isGameOpen(entry.game);
      form.button(
        `${entry.displayName}${open ? "" : "(暂未开放)"}  (${entry.roomCount} 房 / ${entry.maxPlayers} 人)`,
        () => {
          form.close();
          system.runTimeout(
            () => openDevGameDetail(player, entry.game),
            MENU_DELAY_TICKS,
          );
        },
      );
    }
  }
  form.spacer();
  form.button("返回", () => {
    form.close();
    system.runTimeout(() => openDevPanel(player), MENU_DELAY_TICKS);
  });
  trackForm(player.id, form);
}

function openDevGameDetail(player: Player, game: string): void {
  const registry = registryOrNotice(player);
  if (!registry) return;
  const entry = registry.getActiveGame(game);
  if (!entry) {
    showNotice(player, `游戏已不可用:${game}`);
    openDevPanel(player);
    return;
  }
  const debugOn = isGameDebugEnabled(entry.game);

  const form = new CustomForm(player, `开发者面板 · ${entry.displayName}`);
  form.label(`§7游戏 ID:§f${entry.game}`);
  form.label(
    `§7房间:§f${entry.roomCount} §7| 单房上限:§f${entry.maxPlayers} §7| 最少开局:§f${entry.minPlayers}`,
  );
  const open = isGameOpen(entry.game);
  form.label(
    `§7派对可用:§f${entry.partyAvailable ? "是" : "否"} §7| 调试日志:§f${debugOn ? "开" : "关"} §7| 进入:§f${open ? "开放" : "暂未开放"}`,
  );
  form.label(
    `§7准备点:§f(${entry.prepSpawn.x}, ${entry.prepSpawn.y}, ${entry.prepSpawn.z})`,
  );
  form.spacer();
  form.button(`进入开关(当前${open ? "开放" : "暂未开放"})`, () => {
    form.close();
    system.runTimeout(
      () => openDevGameAccess(player, entry.game),
      MENU_DELAY_TICKS,
    );
  });
  form.button("运行时配置", () => {
    form.close();
    system.runTimeout(() => {
      if (!applyResult(player, requestConfig(registry, player, entry.game))) {
        openDevGameDetail(player, entry.game);
      }
    }, MENU_DELAY_TICKS);
  });
  form.button("进入模板维度", () => {
    form.close();
    system.runTimeout(() => {
      if (
        !applyResult(player, requestTmpAction(registry, player, "tp", entry.game))
      ) {
        openDevGameDetail(player, entry.game);
      }
    }, MENU_DELAY_TICKS);
  });
  form.button("应用模板到全部房间", () => {
    form.close();
    system.runTimeout(
      () => openDevApplyConfirm(player, entry.game),
      MENU_DELAY_TICKS,
    );
  });
  form.button("模板范围配置", () => {
    form.close();
    system.runTimeout(() => {
      if (
        !applyResult(player, requestTmpAction(registry, player, "sz", entry.game))
      ) {
        openDevGameDetail(player, entry.game);
      }
    }, MENU_DELAY_TICKS);
  });
  form.button(`切换调试日志(当前${debugOn ? "开" : "关"})`, () => {
    form.close();
    system.runTimeout(() => {
      applyResult(player, requestDebug(registry, player, entry.game, !debugOn));
      openDevGameDetail(player, entry.game);
    }, DEBUG_STATE_REFRESH_TICKS);
  });
  form.button("房间状态", () => {
    form.close();
    system.runTimeout(
      () => openDevRoomStatus(player, entry.game),
      MENU_DELAY_TICKS,
    );
  });
  form.spacer();
  form.button("返回", () => {
    form.close();
    system.runTimeout(() => openDevGameList(player), MENU_DELAY_TICKS);
  });
  trackForm(player.id, form);
}

/** 进入开关:ObservableBoolean + subscribe,拨动即时生效,无需确认 */
function openDevGameAccess(player: Player, game: string): void {
  const registry = registryOrNotice(player);
  if (!registry) return;
  const entry = registry.getActiveGame(game);
  if (!entry) {
    showNotice(player, `游戏已不可用:${game}`);
    openDevPanel(player);
    return;
  }

  const openObs = new ObservableBoolean(isGameOpen(entry.game), {
    clientWritable: true,
  });
  const stateLabel = new ObservableString(
    accessStateLabel(isGameOpen(entry.game)),
  );

  const form = new CustomForm(player, `进入开关 · ${entry.displayName}`);
  form.label(
    "§7关闭后:该游戏仍出现在大厅游戏列表中,但带「暂未开放」后缀且无法点击进入。",
  );
  form.label("§7已在房间内的玩家不受影响,房间状态照常上报。");
  form.label(stateLabel);
  form.spacer();
  form.toggle("允许玩家进入", openObs);
  form.spacer();
  form.label("§7拨动即时生效,无需确认。");
  form.button("返回", () => {
    form.close();
    system.runTimeout(
      () => openDevGameDetail(player, entry.game),
      MENU_DELAY_TICKS,
    );
  });

  const handle = openObs.subscribe((value: boolean) => {
    const changed = setGameOpen(entry.game, value);
    stateLabel.setData(accessStateLabel(value));
    if (!changed) return;
    player.sendMessage(
      value
        ? `§a已开放「${entry.displayName}」进入`
        : `§c已关闭「${entry.displayName}」进入`,
    );
  });

  trackForm(player.id, form, () => openObs.unsubscribe(handle));
}

function accessStateLabel(open: boolean): string {
  return `§7当前状态:${open ? "§a开放" : "§c暂未开放"}`;
}

function openDevApplyConfirm(player: Player, game: string): void {
  const registry = registryOrNotice(player);
  if (!registry) return;
  const entry = registry.getActiveGame(game);
  if (!entry) {
    showNotice(player, `游戏已不可用:${game}`);
    openDevPanel(player);
    return;
  }

  const form = new CustomForm(player, `确认应用模板 · ${entry.displayName}`);
  form.label(`§7将用模板维度重建 §f${entry.roomCount} §7个房间的场地。`);
  form.label("§7进行中/倒计时中的房间会被拒绝,不会打断正在进行的对局。");
  form.label("§7此操作不可撤销。");
  form.spacer();
  form.button("确认应用", () => {
    form.close();
    system.runTimeout(() => {
      if (
        applyResult(player, requestTmpAction(registry, player, "ap", entry.game))
      ) {
        player.sendMessage("§a已请求应用模板到全部房间,进度见内容日志");
      } else {
        openDevGameDetail(player, entry.game);
      }
    }, MENU_DELAY_TICKS);
  });
  form.button("取消", () => {
    form.close();
    system.runTimeout(
      () => openDevGameDetail(player, entry.game),
      MENU_DELAY_TICKS,
    );
  });
  trackForm(player.id, form);
}

function openDevRoomStatus(player: Player, game: string): void {
  const registry = registryOrNotice(player);
  if (!registry) return;
  const entry = registry.getActiveGame(game);
  if (!entry) {
    showNotice(player, `游戏已不可用:${game}`);
    openDevPanel(player);
    return;
  }

  const labels = new Map<number, ObservableString>();
  const form = new CustomForm(
    player,
    `开发者面板 · ${entry.displayName} · 房间状态`,
  );
  for (let roomId = 1; roomId <= entry.roomCount; roomId++) {
    const room = entry.rooms.get(roomId);
    if (!room) continue;
    const label = new ObservableString(roomStatusLine(registry, entry, room));
    labels.set(roomId, label);
    form.label(label);
  }
  form.spacer();
  form.label("§7每 2 秒自动刷新");
  form.button("返回", () => {
    form.close();
    system.runTimeout(
      () => openDevGameDetail(player, entry.game),
      MENU_DELAY_TICKS,
    );
  });
  roomStatusViews.set(player.id, { form, game: entry.game, labels });
  trackForm(player.id, form);
}
