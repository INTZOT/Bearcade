import {
  CommandPermissionLevel,
  CustomCommandStatus,
  EntityComponentTypes,
  EntityDamageCause,
  EquipmentSlot,
  GameMode,
  InputPermissionCategory,
  ItemStack,
  BlockVolume,
  system,
  world,
  type Dimension,
  type Entity,
  type EntityDamageSource,
  type EntityDieAfterEvent,
  type EntityEquippableComponent,
  type EntityHealthComponent,
  type EntityHurtAfterEvent,
  type EntityHurtBeforeEvent,
  type EntityInventoryComponent,
  type EntityProjectileComponent,
  type EntitySpawnAfterEvent,
  type ItemUseBeforeEvent,
  type PlayerDimensionChangeAfterEvent,
  Player,
} from "@minecraft/server";
import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { loadGameConfig, saveGameConfig } from "../../shared/minigame-core/configStore";
import { openConfigMenu, openIntEditor } from "../../shared/minigame-core/configUi";
import { clearHudTitle } from "../../shared/minigame-core/scoreboardHud";
import {
  PILLARS_DEFAULTS,
  PREP_SPAWN,
  type PillarsGameConfig,
} from "./config";
import { ALL_ITEMS } from "./items";

// ============================================================
// 幸运之柱(Pillars of Fortune)玩法
// - 双环基岩柱大乱斗,柱顶单格站立
// - 每 N 秒给所有存活玩家随机一件物品(尽量不重复)
// - 最后存活者第一;时间到存活≥2 时按击杀数定第一,击杀相同并列第一
// - 死亡后进入旁观模式,可自行 /bearcade:lobby 回大厅
// ============================================================

const OWNER_PROPERTY = "bearcade:pillars_owner";
const RECENT_HIT_TICKS = 100; // 5 秒内被玩家/宠物击中后摔死,仍算该玩家击杀

interface ItemEntry {
  typeId: string;
  amount: number;
}

// 随机物品池:MC 全部常规物品(不含命令方块/屏障等管理方块),每次发放数量固定 1 个
const ITEM_POOL: ItemEntry[] = ALL_ITEMS.map((typeId) => ({
  typeId,
  amount: 1,
}));

interface RoomGame {
  roomId: number;
  alive: Set<string>;
  playerNames: Map<string, string>;
  kills: Map<string, number>;
  startTick: number;
  endTick: number;
  countdownEndTick: number;
  lastItemTick: number;
  pillarPositions: { x: number; y: number; z: number }[];
  lastSafePositions: Map<string, { x: number; y: number; z: number }>;
  /** 已淘汰玩家按淘汰顺序记录(越晚淘汰排名越高) */
  eliminated: { playerId: string; name: string; deathTick: number; kills: number }[];
  /** 中途未死亡主动退出/离开的玩家(排名不计入) */
  quitPlayers: Set<string>;
  /** 开局时的原始最小人数(结算重置时恢复) */
  originalMinPlayers: number;
  /** 已触发结束(防止重复结算) */
  ended: boolean;
}

const roomGames = new Map<number, RoomGame>();
// victimId -> { killerId, tick } 用于“被击落后摔死”的击杀归属
const recentHits = new Map<
  string,
  { killerId: string; mobTypeId?: string; tick: number }
>();
// playerId -> 使用刷怪蛋后的待归属信息
const pendingSpawns = new Map<
  string,
  { expiresTick: number; location: { x: number; y: number; z: number }; dimensionId: string }
>();

function getConfig(): PillarsGameConfig {
  return loadGameConfig("pillars", PILLARS_DEFAULTS);
}

function shuffle<T>(input: T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function distanceSq(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function pillarPositions(cfg: PillarsGameConfig): { x: number; y: number; z: number }[] {
  const positions: { x: number; y: number; z: number }[] = [];
  const topY = cfg.groundY + cfg.pillarHeight;
  for (let i = 0; i < cfg.innerRingCount; i++) {
    const angle = (Math.PI * 2 * i) / cfg.innerRingCount - Math.PI / 2;
    positions.push({
      x: Math.round(cfg.innerRingRadius * Math.cos(angle)),
      y: topY,
      z: Math.round(cfg.innerRingRadius * Math.sin(angle)),
    });
  }
  const outerOffset = Math.PI / Math.max(cfg.innerRingCount, cfg.outerRingCount);
  for (let i = 0; i < cfg.outerRingCount; i++) {
    const angle = (Math.PI * 2 * i) / cfg.outerRingCount - Math.PI / 2 + outerOffset;
    positions.push({
      x: Math.round(cfg.outerRingRadius * Math.cos(angle)),
      y: topY,
      z: Math.round(cfg.outerRingRadius * Math.sin(angle)),
    });
  }
  return positions;
}

function arenaRadius(cfg: PillarsGameConfig): number {
  return cfg.outerRingRadius + 3;
}

/** 地图外 5 格为限制边界:超过此范围会被传送回安全位置 */
function boundaryRadius(cfg: PillarsGameConfig): number {
  return arenaRadius(cfg) + 5;
}

/** 是否允许交互(放置/破坏):边界禁止区(地图外 5 格再往外)以外都允许 */
function canInteractAt(cfg: PillarsGameConfig, x: number, z: number): boolean {
  const r = boundaryRadius(cfg);
  return x * x + z * z <= r * r;
}

function buildArenaInDimension(dim: Dimension, cfg: PillarsGameConfig): void {
  const r = arenaRadius(cfg);
  // 草方块圆形地面
  for (let x = -r; x <= r; x++) {
    for (let z = -r; z <= r; z++) {
      if (x * x + z * z <= r * r) {
        try {
          dim.setBlockType({ x, y: cfg.groundY, z }, "minecraft:grass_block");
        } catch {
          // 单格失败不阻塞整体生成
        }
      }
    }
  }
  // 基岩柱
  for (const pos of pillarPositions(cfg)) {
    for (let y = cfg.groundY + 1; y <= cfg.groundY + cfg.pillarHeight; y++) {
      try {
        dim.setBlockType({ x: pos.x, y, z: pos.z }, "minecraft:bedrock");
      } catch {
        // 单格失败不阻塞整体生成
      }
    }
  }
}

function clearRoomEntities(dim: Dimension): void {
  // 只清除非玩家实体(刷怪蛋生物、掉落物、弹射物等),方块由模板重置负责
  for (const entity of dim.getEntities()) {
    if (entity.typeId !== "minecraft:player") {
      try {
        entity.remove();
      } catch {
        // 忽略已移除实体
      }
    }
  }
}

/** 结算保护:清掉威胁实体,并把所有玩家切到旁观/加抗性,避免回大厅前死亡 */
function protectPlayersAtEnd(runtime: MinigameRuntime, roomId: number): void {
  const cfg = getConfig();
  const dim = runtime.roomDim(roomId);
  clearRoomEntities(dim);
  for (const player of runtime.roomPlayers(roomId)) {
    try {
      player.setGameMode(GameMode.Spectator);
      player.teleport(
        { x: 0.5, y: cfg.groundY + 1, z: 0.5 },
        { dimension: dim },
      );
      player.addEffect("minecraft:resistance", 200, {
        amplifier: 255,
        showParticles: false,
      });
      player.addEffect("minecraft:fire_resistance", 200, {
        amplifier: 0,
        showParticles: false,
      });
      player.addEffect("minecraft:regeneration", 200, {
        amplifier: 255,
        showParticles: false,
      });
    } catch {
      // 玩家可能已离开,忽略
    }
  }
}

/** 在模板维度一次性生成地图(供管理员执行,不在对局中调用) */
function buildTemplateMap(runtime: MinigameRuntime, cfg: PillarsGameConfig): void {
  const dim = world.getDimension(runtime.templateDimensionId());
  // 先清空整个模板范围,避免缩小半径/柱子后残留旧方块
  try {
    dim.fillBlocks(
      new BlockVolume(runtime.config.templateFrom, runtime.config.templateTo),
      "minecraft:air",
    );
  } catch {
    // 清理失败不阻塞重建
  }
  buildArenaInDimension(dim, cfg);
}

function setPlayerMovementLocked(player: Player, locked: boolean): void {
  try {
    player.inputPermissions.setPermissionCategory(
      InputPermissionCategory.Movement,
      !locked,
    );
  } catch {
    // 忽略权限设置失败
  }
}

function playerById(id: string): Player | undefined {
  const entity = world.getEntity(id);
  if (entity && entity.typeId === "minecraft:player") {
    return entity as Player;
  }
  return undefined;
}

/** 玩家淘汰时模拟死亡掉落:把背包/装备物品向周围 r=5 喷射,越靠近中心越密集 */
function dropPlayerItems(player: Player): void {
  const dim = player.dimension;
  const origin = player.location;
  const dropStack = (stack: ItemStack | undefined) => {
    if (!stack) return;
    const angle = Math.random() * Math.PI * 2;
    // 使用线性半径:越靠近中心概率越高,形成“中间多、外围少”的散布
    const dist = 5 * Math.random();
    const loc = {
      x: origin.x + Math.cos(angle) * dist,
      y: origin.y + 0.5,
      z: origin.z + Math.sin(angle) * dist,
    };
    try {
      dim.spawnItem(stack, loc);
    } catch {
      // 忽略单件掉落失败
    }
  };

  const inventory = player.getComponent(
    EntityComponentTypes.Inventory,
  ) as EntityInventoryComponent | undefined;
  const container = inventory?.container;
  if (container) {
    for (let slot = 0; slot < container.size; slot++) {
      const item = container.getItem(slot);
      if (!item) continue;
      dropStack(item);
      try {
        container.setItem(slot, undefined);
      } catch {
        // 忽略清空失败
      }
    }
  }

  const equippable = player.getComponent(
    EntityComponentTypes.Equippable,
  ) as EntityEquippableComponent | undefined;
  if (equippable) {
    const slots = [
      EquipmentSlot.Head,
      EquipmentSlot.Chest,
      EquipmentSlot.Legs,
      EquipmentSlot.Feet,
      EquipmentSlot.Offhand,
    ];
    for (const slot of slots) {
      const item = equippable.getEquipment(slot);
      if (!item) continue;
      dropStack(item);
      try {
        equippable.setEquipment(slot, undefined);
      } catch {
        // 忽略清空失败
      }
    }
  }
}

function giveRandomItems(runtime: MinigameRuntime, roomId: number): void {
  const state = roomGames.get(roomId);
  if (!state) return;
  const alivePlayers = runtime
    .roomDim(roomId)
    .getPlayers()
    .filter((p) => state.alive.has(p.id));
  if (alivePlayers.length === 0) return;

  const pool = shuffle(ITEM_POOL);
  alivePlayers.forEach((player, index) => {
    const entry = pool[index % pool.length];
    const inventory = player.getComponent(
      EntityComponentTypes.Inventory,
    ) as EntityInventoryComponent | undefined;
    const container = inventory?.container;
    if (!container || container.emptySlotsCount <= 0) return;
    for (let slot = 0; slot < container.size; slot++) {
      if (!container.getItem(slot)) {
        try {
          container.setItem(slot, new ItemStack(entry.typeId, entry.amount));
          player.onScreenDisplay.setActionBar(`§a获得: §f${itemLabel(entry.typeId)}`);
        } catch {
          // 忽略单个物品发放失败
        }
        break;
      }
    }
  });
}

function itemLabel(typeId: string): string {
  const short = typeId.replace("minecraft:", "").replace(/_/g, " ");
  return short;
}

interface KillCredit {
  killerId: string;
  mobTypeId?: string;
}

const MOB_NAMES: Record<string, string> = {
  "minecraft:zombie": "僵尸",
  "minecraft:husk": "尸壳",
  "minecraft:drowned": "溺尸",
  "minecraft:skeleton": "骷髅",
  "minecraft:stray": "流浪者",
  "minecraft:spider": "蜘蛛",
  "minecraft:cave_spider": "洞穴蜘蛛",
  "minecraft:creeper": "苦力怕",
  "minecraft:enderman": "末影人",
  "minecraft:slime": "史莱姆",
  "minecraft:magma_cube": "岩浆怪",
  "minecraft:blaze": "烈焰人",
  "minecraft:witch": "女巫",
  "minecraft:silverfish": "蠹虫",
  "minecraft:phantom": "幻翼",
  "minecraft:shulker": "潜影贝",
  "minecraft:vex": "恼鬼",
  "minecraft:evoker": "唤魔者",
  "minecraft:vindicator": "卫道士",
  "minecraft:pillager": "掠夺者",
  "minecraft:ravager": "劫掠兽",
  "minecraft:warden": "循声守卫",
  "minecraft:wolf": "狼",
  "minecraft:bee": "蜜蜂",
  "minecraft:iron_golem": "铁傀儡",
  "minecraft:snow_golem": "雪傀儡",
};

function mobLabel(typeId: string): string {
  const known = MOB_NAMES[typeId];
  if (known) return known;
  return typeId.replace("minecraft:", "").replace(/_/g, " ");
}

/** 从实体(直接伤害者或弹射物)解析击杀归属,支持玩家/被标记生物/弹射物 owner */
function creditFromEntity(entity: Entity): KillCredit | undefined {
  if (entity.typeId === "minecraft:player") {
    return { killerId: entity.id };
  }
  const owner = entity.getDynamicProperty(OWNER_PROPERTY);
  if (typeof owner === "string") {
    return { killerId: owner, mobTypeId: entity.typeId };
  }
  // 弹射物(风弹/箭/雪球等):读取 projectile 组件的 owner
  const projectile = entity.getComponent(
    EntityComponentTypes.Projectile,
  ) as EntityProjectileComponent | undefined;
  const projOwner = projectile?.owner;
  if (projOwner) {
    if (projOwner.typeId === "minecraft:player") {
      return { killerId: projOwner.id };
    }
    const mobOwner = projOwner.getDynamicProperty(OWNER_PROPERTY);
    if (typeof mobOwner === "string") {
      return { killerId: mobOwner, mobTypeId: projOwner.typeId };
    }
  }
  return undefined;
}

function creditFromDamageSource(ds: EntityDamageSource): KillCredit | undefined {
  if (ds.damagingEntity) {
    const direct = creditFromEntity(ds.damagingEntity);
    if (direct) return direct;
  }
  if (ds.damagingProjectile) {
    const projectileCredit = creditFromEntity(ds.damagingProjectile);
    if (projectileCredit) return projectileCredit;
  }
  return undefined;
}

function resolveKillerFromSource(
  ds: EntityDamageSource,
  victimId: string,
): KillCredit | undefined {
  const direct = creditFromDamageSource(ds);
  if (direct) return direct;
  if (
    ds.cause === EntityDamageCause.fall ||
    ds.cause === EntityDamageCause.void
  ) {
    const recent = recentHits.get(victimId);
    if (recent && system.currentTick - recent.tick <= RECENT_HIT_TICKS) {
      return {
        killerId: recent.killerId,
        mobTypeId: recent.mobTypeId,
      };
    }
  }
  return undefined;
}

function resolveKiller(
  event: EntityDieAfterEvent,
  victimId: string,
): KillCredit | undefined {
  return resolveKillerFromSource(event.damageSource, victimId);
}

function announceDeath(
  runtime: MinigameRuntime,
  roomId: number,
  victimName: string,
  killer: KillCredit | undefined,
): void {
  const state = roomGames.get(roomId);
  const killerName = killer
    ? state?.playerNames.get(killer.killerId)
    : undefined;
  if (killerName && killerName !== victimName) {
    if (killer?.mobTypeId) {
      runtime.announce(
        roomId,
        `§c${victimName} 被 ${killerName} 的 ${mobLabel(killer.mobTypeId)} 击杀了`,
      );
    } else {
      runtime.announce(roomId, `§c${victimName} 被 ${killerName} 淘汰了`);
    }
  } else {
    runtime.announce(roomId, `§c${victimName} 淘汰了`);
  }
}

function updateHud(runtime: MinigameRuntime, roomId: number): void {
  const state = roomGames.get(roomId);
  if (!state) return;
  const remainSec = Math.max(0, Math.ceil((state.endTick - system.currentTick) / 20));
  const mm = String(Math.floor(remainSec / 60)).padStart(2, "0");
  const ss = String(remainSec % 60).padStart(2, "0");
  for (const player of runtime.roomDim(roomId).getPlayers()) {
    if (!state.alive.has(player.id)) continue;
    const kills = state.kills.get(player.id) ?? 0;
    // 局内倒计时保持 actionbar 显示,不要占用 title
    player.onScreenDisplay.setActionBar(
      `§e幸运之柱 §r| 存活 §a${state.alive.size}§r/§a${state.playerNames.size} §r| §c击杀 ${kills} §r| §b倒计时 ${mm}:${ss}`,
    );
  }
}

/** 生成最终排名文本:未死亡退出者不计入,已淘汰者按死亡时间排名,名字用开局存档 */
function buildRankingText(state: RoomGame): string {
  const aliveIds = [...state.alive];
  const entries: {
    id: string;
    name: string;
    kills: number;
    deathTick: number;
    group: "alive" | "dead";
  }[] = [];
  for (const id of aliveIds) {
    entries.push({
      id,
      name: state.playerNames.get(id) ?? id,
      kills: state.kills.get(id) ?? 0,
      deathTick: 0,
      group: "alive",
    });
  }
  for (const e of state.eliminated) {
    if (state.quitPlayers.has(e.playerId)) continue;
    entries.push({
      id: e.playerId,
      name: e.name,
      kills: e.kills,
      deathTick: e.deathTick,
      group: "dead",
    });
  }
  if (entries.length === 0) return "§c本局没有可排名玩家";

  // 存活者排在已淘汰者之前;存活按击杀数,已淘汰按死亡时间(越晚越高)
  entries.sort((a, b) => {
    if (a.group !== b.group) return a.group === "alive" ? -1 : 1;
    if (a.group === "alive") return b.kills - a.kills;
    return b.deathTick - a.deathTick || b.kills - a.kills;
  });

  const lines = ["§6=== 幸运之柱 结算 ==="];
  let prevKey: number | undefined;
  let prevPlace = 1;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const key = e.group === "alive" ? e.kills : e.deathTick;
    let place: number;
    if (prevKey !== undefined && key === prevKey) {
      place = prevPlace;
    } else {
      place = i + 1;
      prevPlace = place;
    }
    prevKey = key;
    lines.push(`§e第 ${place} 名:${e.name} §7(击杀 ${e.kills})`);
  }
  return lines.join("\n");
}

function checkEarlyEnd(runtime: MinigameRuntime, roomId: number): void {
  const state = roomGames.get(roomId);
  if (!state || state.ended) return;
  if (state.alive.size > 1) return;
  state.ended = true;
  const message = buildRankingText(state);
  // 结算期间保护玩家,避免最后存活者在回大厅前意外死亡
  protectPlayersAtEnd(runtime, roomId);
  runtime.endGame(roomId, "最后存活", message);
}

function endByTime(runtime: MinigameRuntime, roomId: number): void {
  const state = roomGames.get(roomId);
  if (!state || state.ended) return;
  state.ended = true;
  const message = buildRankingText(state);
  protectPlayersAtEnd(runtime, roomId);
  runtime.endGame(roomId, "时间到", message);
}

/** 统一执行“淘汰”收尾:播报、旁观、刷新 HUD、延迟结算 */
function finalizeElimination(
  runtime: MinigameRuntime,
  roomId: number,
  victimId: string,
  victimName: string,
  killer: KillCredit | undefined,
  deadEntity?: EntityDieAfterEvent["deadEntity"],
): void {
  const state = roomGames.get(roomId);
  if (!state || state.ended) return;

  // 记录淘汰顺序(用于最终排名;玩家之后 /lobby 也不会丢名字)
  if (!state.eliminated.some((e) => e.playerId === victimId)) {
    state.eliminated.push({
      playerId: victimId,
      name: victimName,
      deathTick: system.currentTick,
      kills: state.kills.get(victimId) ?? 0,
    });
  }

  // 模拟死亡掉落:把物品向周围 r=5 喷射(越靠近中心越密集)
  try {
    const dropTarget = deadEntity ? (deadEntity as Player) : playerById(victimId);
    if (dropTarget) dropPlayerItems(dropTarget);
  } catch {
    try {
      const p = playerById(victimId);
      if (p) dropPlayerItems(p);
    } catch {
      // 玩家可能已离开,跳过掉落
    }
  }

  announceDeath(runtime, roomId, victimName, killer);

  // 死亡/拦截后进入旁观模式,可自行 /bearcade:lobby 回大厅
  try {
    if (deadEntity) {
      const deadPlayer = deadEntity as Player;
      deadPlayer.setGameMode(GameMode.Spectator);
      deadPlayer.onScreenDisplay.setActionBar(
        "§7你已淘汰,输入 /bearcade:lobby 返回大厅",
      );
    } else {
      const player = playerById(victimId);
      if (player) {
        player.setGameMode(GameMode.Spectator);
        player.onScreenDisplay.setActionBar(
          "§7你已淘汰,输入 /bearcade:lobby 返回大厅",
        );
      }
    }
  } catch {
    try {
      const player = playerById(victimId);
      if (player) {
        player.setGameMode(GameMode.Spectator);
        player.onScreenDisplay.setActionBar(
          "§7你已淘汰,输入 /bearcade:lobby 返回大厅",
        );
      }
    } catch {
      // 玩家可能已离开
    }
  }

  updateHud(runtime, roomId);
  // 延迟 2 秒再结算,让死亡消息/旁观切换先展示
  system.runTimeout(() => {
    if (roomGames.get(roomId) === state) {
      checkEarlyEnd(runtime, roomId);
    }
  }, 40);
}

function handlePlayerDeath(
  runtime: MinigameRuntime,
  event: EntityDieAfterEvent,
): void {
  const dead = event.deadEntity;
  if (dead.typeId !== "minecraft:player") return;
  const roomId = runtime.roomIdFromDimension(dead.dimension.id);
  if (roomId === undefined) return;
  const state = roomGames.get(roomId);
  if (!state || state.ended) return;
  const victimId = dead.id;
  if (!state.alive.has(victimId)) return;

  state.alive.delete(victimId);
  const victimName = state.playerNames.get(victimId) ?? dead.nameTag ?? "玩家";
  const killer = resolveKiller(event, victimId);
  if (
    killer &&
    killer.killerId !== victimId &&
    state.kills.has(killer.killerId)
  ) {
    state.kills.set(
      killer.killerId,
      (state.kills.get(killer.killerId) ?? 0) + 1,
    );
  }

  finalizeElimination(runtime, roomId, victimId, victimName, killer, dead);
}

function handlePlayerLeave(runtime: MinigameRuntime, playerId: string): void {
  for (const state of roomGames.values()) {
    if (state.ended || !state.alive.has(playerId)) continue;
    state.alive.delete(playerId);
    state.quitPlayers.add(playerId);
    const name = state.playerNames.get(playerId) ?? "玩家";
    runtime.announce(state.roomId, `§7${name} 退出游戏,不计入排名`);
    system.runTimeout(() => {
      if (roomGames.get(state.roomId) === state) {
        checkEarlyEnd(runtime, state.roomId);
      }
    }, 20);
    break;
  }
}

/** 玩家通过 /lobby 等途径离开房间维度:未死亡则视为退出,不计入排名 */
function handlePlayerDimensionChange(
  runtime: MinigameRuntime,
  event: PlayerDimensionChangeAfterEvent,
): void {
  const roomId = runtime.roomIdFromDimension(event.fromDimension.id);
  if (roomId === undefined) return;
  const state = roomGames.get(roomId);
  if (!state || state.ended) return;
  const playerId = event.player.id;
  if (!state.alive.has(playerId)) return;
  state.alive.delete(playerId);
  state.quitPlayers.add(playerId);
  const name = state.playerNames.get(playerId) ?? event.player.name;
  runtime.announce(roomId, `§7${name} 退出游戏,不计入排名`);
  system.runTimeout(() => {
    if (roomGames.get(roomId) === state) {
      checkEarlyEnd(runtime, roomId);
    }
  }, 20);
}

function handleHurt(runtime: MinigameRuntime, event: EntityHurtAfterEvent): void {
  const entity = event.hurtEntity;
  if (entity.typeId !== "minecraft:player") return;
  const roomId = runtime.roomIdFromDimension(entity.dimension.id);
  if (roomId === undefined) return;
  const state = roomGames.get(roomId);
  if (!state || state.ended) return;
  const credit = creditFromDamageSource(event.damageSource);
  if (credit) {
    recentHits.set(entity.id, {
      killerId: credit.killerId,
      mobTypeId: credit.mobTypeId,
      tick: system.currentTick,
    });
  }
}

/** 在致命伤害前拦截:取消死亡,改为原地淘汰+旁观,避免自动回主城 */
function handleLethalDamageBefore(
  runtime: MinigameRuntime,
  event: EntityHurtBeforeEvent,
): void {
  const entity = event.hurtEntity;
  if (entity.typeId !== "minecraft:player") return;
  const roomId = runtime.roomIdFromDimension(entity.dimension.id);
  if (roomId === undefined) return;
  const state = roomGames.get(roomId);
  if (!state || state.ended || !state.alive.has(entity.id)) return;
  const health = entity.getComponent(
    EntityComponentTypes.Health,
  ) as EntityHealthComponent | undefined;
  if (!health) return;
  if (health.currentValue - event.damage > 0) return;

  // 拦截这次致命伤害,玩家不会真正死亡/回主城
  event.cancel = true;
  state.alive.delete(entity.id);
  const victimId = entity.id;
  const victimName = state.playerNames.get(victimId) ?? entity.nameTag ?? "玩家";
  const killer = resolveKillerFromSource(event.damageSource, victimId);
  if (
    killer &&
    killer.killerId !== victimId &&
    state.kills.has(killer.killerId)
  ) {
    state.kills.set(
      killer.killerId,
      (state.kills.get(killer.killerId) ?? 0) + 1,
    );
  }
  // before 事件是 restricted execution,实际切旁观/播报/结算延迟到 system.run
  system.run(() => {
    finalizeElimination(runtime, roomId, victimId, victimName, killer);
  });
}

function handleItemUse(runtime: MinigameRuntime, event: ItemUseBeforeEvent): void {
  const typeId = event.itemStack?.typeId;
  if (!typeId || !typeId.endsWith("_spawn_egg")) return;
  const roomId = runtime.roomIdFromDimension(event.source.dimension.id);
  if (roomId === undefined) return;
  const state = roomGames.get(roomId);
  if (!state || state.ended) return;
  pendingSpawns.set(event.source.id, {
    expiresTick: system.currentTick + 4,
    location: { ...event.source.location },
    dimensionId: event.source.dimension.id,
  });
}

function handleEntitySpawn(event: EntitySpawnAfterEvent): void {
  const entity = event.entity;
  if (entity.typeId === "minecraft:player") return;
  for (const [playerId, pending] of pendingSpawns) {
    if (pending.expiresTick < system.currentTick) {
      pendingSpawns.delete(playerId);
      continue;
    }
    if (pending.dimensionId !== entity.dimension.id) continue;
    if (distanceSq(pending.location, entity.location) > 10 * 10) continue;
    try {
      entity.setDynamicProperty(OWNER_PROPERTY, playerId);
    } catch {
      // 忽略标记失败
    }
    pendingSpawns.delete(playerId);
    break;
  }
}

/** 准备阶段保护:掉到 y<-30 传回准备点,并持续给予饱和效果 */
function handlePrepPhase(runtime: MinigameRuntime): void {
  for (let roomId = 1; roomId <= runtime.config.roomCount; roomId++) {
    const phase = runtime.getPhase(roomId);
    if (phase !== "idle" && phase !== "pending") continue;
    for (const player of runtime.roomDim(roomId).getPlayers()) {
      if (player.location.y < -30) {
        try {
          player.teleport(
            {
              x: PREP_SPAWN.x + 0.5,
              y: PREP_SPAWN.y + 0.5,
              z: PREP_SPAWN.z + 0.5,
            },
            { dimension: runtime.roomDim(roomId) },
          );
        } catch {
          // 忽略传送失败
        }
      }
      try {
        player.addEffect("minecraft:saturation", 100, {
          amplifier: 0,
          showParticles: false,
        });
      } catch {
        // 忽略效果添加失败
      }
    }
  }
}

/** 边界限制:地图外 5 格为界,玩家越界则传送回进入前的位置 */
function enforceBoundaries(runtime: MinigameRuntime): void {
  const cfg = getConfig();
  const limitSq = boundaryRadius(cfg) * boundaryRadius(cfg);
  for (const state of roomGames.values()) {
    if (state.ended) continue;
    for (const player of runtime.roomDim(state.roomId).getPlayers()) {
      if (!state.alive.has(player.id)) continue;
      const distSq = player.location.x * player.location.x + player.location.z * player.location.z;
      if (distSq > limitSq) {
        const safe = state.lastSafePositions.get(player.id) ?? {
          x: 0,
          y: cfg.groundY + 1,
          z: 0,
        };
        try {
          player.teleport(safe, { dimension: runtime.roomDim(state.roomId) });
        } catch {
          // 忽略传送失败
        }
        player.onScreenDisplay.setActionBar("§c已达边界,已返回安全位置");
      } else {
        state.lastSafePositions.set(player.id, {
          x: player.location.x,
          y: player.location.y,
          z: player.location.z,
        });
      }
    }
  }
}

/** 注册“在模板维度生成地图”的管理员命令(游戏对局中不会自动生成地图) */
export function initPillarsCommands(runtime: MinigameRuntime): void {
  system.beforeEvents.startup.subscribe((event) => {
    try {
      event.customCommandRegistry.registerCommand(
        {
          name: "bearcade:pillars_buildmap",
          description: "在模板维度生成幸运之柱地图(管理员)",
          permissionLevel: CommandPermissionLevel.Any,
          cheatsRequired: false,
        },
        (origin) => {
          const entity = origin.sourceEntity;
          if (!entity || !(entity instanceof Player)) {
            return {
              status: CustomCommandStatus.Failure,
              message: "该命令只能由玩家执行",
            };
          }
          if (!entity.hasTag("op")) {
            return {
              status: CustomCommandStatus.Failure,
              message: "权限不足:需要 op tag(管理员)",
            };
          }
          if (entity.dimension.id !== runtime.templateDimensionId()) {
            return {
              status: CustomCommandStatus.Failure,
              message: "请先进入模板维度(/bearcade:tmp tp pillars)再生成地图",
            };
          }
          // 自定义命令回调运行在 restricted execution,原生调用需延迟到 system.run
          system.run(() => {
            try {
              buildTemplateMap(runtime, getConfig());
              entity.sendMessage(
                "§a地图已生成,可执行 /bearcade:tmp ap pillars 应用到全部房间",
              );
            } catch (error) {
              runtime.dbg("模板地图生成失败", error);
              entity.sendMessage("§c地图生成失败,详见内容日志");
            }
          });
          return {
            status: CustomCommandStatus.Success,
            message: "地图生成已开始",
          };
        },
      );
    } catch (error) {
      console.warn("[Bearcade pillars] 注册地图生成命令失败", error);
    }
  });
}

export function initPillarsEvents(runtime: MinigameRuntime): void {
  world.afterEvents.entityDie.subscribe((event) => {
    try {
      handlePlayerDeath(runtime, event);
    } catch (error) {
      runtime.dbg("entityDie 处理异常", error);
    }
  });

  world.afterEvents.playerLeave.subscribe((event) => {
    try {
      handlePlayerLeave(runtime, event.playerId);
    } catch (error) {
      runtime.dbg("playerLeave 处理异常", error);
    }
  });

  // 玩家 /lobby 等离开房间维度时,按“未死亡退出”处理
  world.afterEvents.playerDimensionChange.subscribe((event) => {
    try {
      handlePlayerDimensionChange(runtime, event);
    } catch (error) {
      runtime.dbg("playerDimensionChange 处理异常", error);
    }
  });

  world.afterEvents.entityHurt.subscribe((event) => {
    try {
      handleHurt(runtime, event);
    } catch (error) {
      runtime.dbg("entityHurt 处理异常", error);
    }
  });

  // 致命伤害前拦截:取消死亡,改为原地淘汰+旁观,避免自动回主城
  world.beforeEvents.entityHurt.subscribe((event) => {
    try {
      handleLethalDamageBefore(runtime, event);
    } catch (error) {
      runtime.dbg("entityHurt before 处理异常", error);
    }
  });

  // 用 before 事件提前记录刷怪蛋使用者,确保实体生成前就能绑定归属
  world.beforeEvents.itemUse.subscribe((event) => {
    try {
      handleItemUse(runtime, event);
    } catch (error) {
      runtime.dbg("itemUse 处理异常", error);
    }
  });

  world.afterEvents.entitySpawn.subscribe((event) => {
    try {
      handleEntitySpawn(event);
    } catch (error) {
      runtime.dbg("entitySpawn 处理异常", error);
    }
  });

  // 每秒:时间到判定 + HUD 刷新 + 按配置间隔发物品
  system.runInterval(() => {
    for (const state of [...roomGames.values()]) {
      if (state.ended) continue;
      const roomId = state.roomId;
      const cfg = getConfig();
      const itemIntervalTicks = Math.max(1, Math.round(cfg.itemIntervalSeconds * 20));
      if (system.currentTick >= state.endTick) {
        endByTime(runtime, roomId);
        continue;
      }
      if (system.currentTick < state.countdownEndTick) continue;
      if (system.currentTick - state.lastItemTick >= itemIntervalTicks) {
        state.lastItemTick = system.currentTick;
        giveRandomItems(runtime, roomId);
      }
      updateHud(runtime, roomId);
    }
  }, 20);

  // 每 5 tick:准备阶段保护/饱和 + 地图边界
  system.runInterval(() => {
    try {
      handlePrepPhase(runtime);
    } catch (error) {
      runtime.dbg("准备阶段保护异常", error);
    }
    try {
      enforceBoundaries(runtime);
    } catch (error) {
      runtime.dbg("边界检查异常", error);
    }
  }, 5);
}

export function makePillarsHooks(
  getRuntime: () => MinigameRuntime,
): MinigameHooks {
  return {
    onGameStart(roomId, players) {
      const runtime = getRuntime();
      const cfg = getConfig();

      // 对局开始后(含 3-2-1 倒计时)最小人数改为 1,避免只剩 1 人时被共享运行时提前结束
      const originalMinPlayers = runtime.config.minPlayers ?? 2;
      runtime.config.minPlayers = 1;

      const positions = pillarPositions(cfg);
      const assigned = shuffle(positions);
      const countdownEndTick = system.currentTick + 3 * 20;
      const state: RoomGame = {
        roomId,
        alive: new Set(players.map((p) => p.id)),
        playerNames: new Map(players.map((p) => [p.id, p.nameTag])),
        kills: new Map(players.map((p) => [p.id, 0])),
        startTick: countdownEndTick,
        endTick:
          countdownEndTick + Math.max(10, cfg.gameDurationSeconds) * 20,
        countdownEndTick,
        lastItemTick: countdownEndTick,
        pillarPositions: positions,
        lastSafePositions: new Map(),
        eliminated: [],
        quitPlayers: new Set(),
        originalMinPlayers,
        ended: false,
      };
      roomGames.set(roomId, state);

      players.forEach((player, index) => {
        const pos = assigned[index % assigned.length] ?? assigned[0];
        try {
          player.teleport(
            {
              x: pos.x + 0.5,
              y: pos.y + 1,
              z: pos.z + 0.5,
            },
            { dimension: runtime.roomDim(roomId) },
          );
          player.setGameMode(GameMode.Survival);
          setPlayerMovementLocked(player, true);
          state.lastSafePositions.set(player.id, {
            x: pos.x + 0.5,
            y: pos.y + 1,
            z: pos.z + 0.5,
          });
        } catch (error) {
          runtime.dbg("玩家开局传送失败", error);
        }
      });

      // 3 秒 title 倒计时,期间禁用移动(使用 /title 命令显示,并同步一份到 subtitle)
      for (let i = 0; i < 3; i++) {
        system.runTimeout(() => {
          for (const player of players) {
            try {
              player.runCommand(`title @s title ${3 - i}`);
              player.runCommand(`title @s subtitle ${3 - i}`);
            } catch {
              // 玩家可能已离开或命令不可用
            }
          }
        }, i * 20);
      }

      system.runTimeout(() => {
        for (const player of players) {
          try {
            setPlayerMovementLocked(player, false);
            player.runCommand('title @s title "§a开始!"');
            player.runCommand('title @s subtitle "§a游戏开始!"');
          } catch {
            // 玩家可能已离开或命令不可用
          }
        }
        // 开始提示显示 1 秒后清理 title/subtitle
        system.runTimeout(() => {
          for (const player of players) {
            try {
              player.runCommand("title @s clear");
            } catch {
              // 玩家可能已离开或命令不可用
            }
          }
        }, 20);
        if (roomGames.get(roomId) !== state || state.ended) return;
        state.lastItemTick = system.currentTick;
        runtime.announce(
          roomId,
          `§a幸运之柱开始!共 ${players.length} 人,时长 ${cfg.gameDurationSeconds} 秒,每 ${cfg.itemIntervalSeconds} 秒发放随机物品。`,
        );
        giveRandomItems(runtime, roomId);
        updateHud(runtime, roomId);
      }, countdownEndTick - system.currentTick);
    },

    onBeforeReset(roomId) {
      const runtime = getRuntime();
      const state = roomGames.get(roomId);
      // 恢复原始最小人数,避免下一局 1 人也能开局
      runtime.config.minPlayers = state?.originalMinPlayers ?? 2;
      if (state) {
        for (const id of state.alive) {
          const player = playerById(id);
          if (player) {
            clearHudTitle(player);
            setPlayerMovementLocked(player, false);
            try {
              player.setGameMode(GameMode.Adventure);
            } catch {
              // 忽略
            }
          }
        }
        roomGames.delete(roomId);
      }
      for (const player of runtime.roomPlayers(roomId)) {
        clearHudTitle(player);
        setPlayerMovementLocked(player, false);
      }
      // 只清理实体,方块由模板重置负责
      clearRoomEntities(runtime.roomDim(roomId));
      // 清理本房间相关的临时归属数据
      for (const key of [...recentHits.keys()]) {
        if (state?.playerNames.has(key)) recentHits.delete(key);
      }
      for (const key of [...pendingSpawns.keys()]) {
        if (state?.playerNames.has(key)) pendingSpawns.delete(key);
      }
    },

    canPlace(event, roomId) {
      const state = roomGames.get(roomId);
      if (!state || state.ended) return false;
      if (system.currentTick < state.countdownEndTick) return false;
      const cfg = getConfig();
      if (event.block.location.y < cfg.minBuildY) return false;
      if (event.block.location.y >= cfg.maxBuildY) return false;
      return canInteractAt(cfg, event.block.location.x, event.block.location.z);
    },

    canBreak(event, roomId) {
      const state = roomGames.get(roomId);
      if (!state || state.ended) return false;
      if (system.currentTick < state.countdownEndTick) return false;
      const cfg = getConfig();
      return canInteractAt(cfg, event.block.location.x, event.block.location.z);
    },

    openConfig(player) {
      openPillarsConfig(player);
    },
  };
}

function openPillarsConfig(player: Player): void {
  const cfg = getConfig();
  const save = (patch: Partial<PillarsGameConfig>) => {
    const next = { ...getConfig(), ...patch };
    saveGameConfig("pillars", next);
    player.sendMessage("§a幸运之柱配置已保存");
  };

  openConfigMenu(player, "幸运之柱配置", [
    {
      label: `游戏时长(秒) [${cfg.gameDurationSeconds}]`,
      open: () =>
        openIntEditor(
          player,
          "游戏时长",
          cfg.gameDurationSeconds,
          (v) => save({ gameDurationSeconds: v }),
          { min: 10, max: 600, hint: "一局最长秒数,默认 300", back: () => openPillarsConfig(player) },
        ),
    },
    {
      label: `发物品间隔(秒) [${cfg.itemIntervalSeconds}]`,
      open: () =>
        openIntEditor(
          player,
          "发物品间隔",
          cfg.itemIntervalSeconds,
          (v) => save({ itemIntervalSeconds: v }),
          { min: 1, max: 60, hint: "每多少秒给所有存活玩家发一件随机物品,默认 5", back: () => openPillarsConfig(player) },
        ),
    },
    {
      label: `内环柱子数 [${cfg.innerRingCount}]`,
      open: () =>
        openIntEditor(
          player,
          "内环柱子数",
          cfg.innerRingCount,
          (v) => save({ innerRingCount: v }),
          { min: 1, max: 20, hint: "默认 10,与外环合计建议 20", back: () => openPillarsConfig(player) },
        ),
    },
    {
      label: `外环柱子数 [${cfg.outerRingCount}]`,
      open: () =>
        openIntEditor(
          player,
          "外环柱子数",
          cfg.outerRingCount,
          (v) => save({ outerRingCount: v }),
          { min: 1, max: 20, hint: "默认 10,与外环合计建议 20", back: () => openPillarsConfig(player) },
        ),
    },
    {
      label: `内环半径 [${cfg.innerRingRadius}]`,
      open: () =>
        openIntEditor(
          player,
          "内环半径",
          cfg.innerRingRadius,
          (v) => save({ innerRingRadius: v }),
          { min: 3, max: 16, hint: "默认 8,相邻柱间距约 5 格", back: () => openPillarsConfig(player) },
        ),
    },
    {
      label: `外环半径 [${cfg.outerRingRadius}]`,
      open: () =>
        openIntEditor(
          player,
          "外环半径",
          cfg.outerRingRadius,
          (v) => save({ outerRingRadius: v }),
          { min: 4, max: 16, hint: "默认 13,与内环保持较近距离", back: () => openPillarsConfig(player) },
        ),
    },
    {
      label: `柱子高度 [${cfg.pillarHeight}]`,
      open: () =>
        openIntEditor(
          player,
          "柱子高度",
          cfg.pillarHeight,
          (v) => save({ pillarHeight: v }),
          { min: 10, max: 60, hint: "默认 35,足够从柱顶摔落致死", back: () => openPillarsConfig(player) },
        ),
    },
    {
      label: `地面 Y [${cfg.groundY}]`,
      open: () =>
        openIntEditor(
          player,
          "地面 Y",
          cfg.groundY,
          (v) => save({ groundY: v }),
          { min: -60, max: 5, hint: "草方块地面高度,默认 0", back: () => openPillarsConfig(player) },
        ),
    },
    {
      label: `搭建高度上限 [${cfg.maxBuildY}]`,
      open: () =>
        openIntEditor(
          player,
          "搭建高度上限",
          cfg.maxBuildY,
          (v) => save({ maxBuildY: v }),
          { min: 1, max: 319, hint: "y >= 该值禁止放置方块,默认 50", back: () => openPillarsConfig(player) },
        ),
    },
    {
      label: `搭建高度下限 [${cfg.minBuildY}]`,
      open: () =>
        openIntEditor(
          player,
          "搭建高度下限",
          cfg.minBuildY,
          (v) => save({ minBuildY: v }),
          { min: -64, max: 50, hint: "y < 该值禁止放置方块,默认 0(即 y=-1 及以下禁止)", back: () => openPillarsConfig(player) },
        ),
    },
    {
      label: "恢复默认配置",
      open: () => {
        saveGameConfig("pillars", PILLARS_DEFAULTS);
        player.sendMessage("§a已恢复默认配置");
      },
    },
  ]);
}
