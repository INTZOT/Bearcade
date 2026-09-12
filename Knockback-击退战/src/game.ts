import {
  EnchantmentType,
  EntityComponentTypes,
  EntityDamageCause,
  EquipmentSlot,
  InputPermissionCategory,
  ItemComponentTypes,
  ItemStack,
  system,
  TextPrimitive,
  world,
  type Entity,
  type EntityEquippableComponent,
  type EntityHurtBeforeEvent,
  type EntityInventoryComponent,
  type EntityItemComponent,
  type EntityItemPickupAfterEvent,
  type ItemDurabilityComponent,
  type ItemEnchantableComponent,
  type Player,
} from "@minecraft/server";
import type { MinigameHooks } from "../../shared/minigame-core/types";
import { stripSectionCodes } from "../../shared/minigame-core/text";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { clearHudTitle } from "../../shared/minigame-core/scoreboardHud";
import { clearAllPlayerItems } from "../../shared/minigame-core/playerItems";
import {
  BONUS_SCORE_PER_INTERVAL,
  HUD_REFRESH_TICKS,
  KNOCKBACK_ITEM_IDS,
  KNOCKBACK_STRENGTH,
  SCORE_INTERVAL_TICKS,
  SCORE_PER_INTERVAL,
  STICK_DURABILITY,
  STICK_SPAWN_STOP_SECONDS,
  TIME_WARNING_SECONDS,
  type KnockbackTier,
} from "./config";
import { getKnockbackConfig, openKnockbackConfig } from "./knockback-config";

const TIER_ORDER: Record<KnockbackTier, number> = {
  weak: 0,
  medium: 1,
  strong: 2,
};

const TIER_NAMES: Record<KnockbackTier, string> = {
  weak: "弱击退木棍",
  medium: "中级击退木棍",
  strong: "强力击退木棍",
};

const SCORE_SHAPE_Y = 2.0; // 玩家名字下方浮空分数

interface RoomGameState {
  scores: Map<string, number>;
  tickCounter: number;
  scoreShapes: Map<string, TextPrimitive>;
  countdownActive: boolean;
  announcedReminders: Set<number>;
  countdownIntervalId?: number;
  intervalId?: number;
  endTimeoutId?: number;
}

const roomStates = new Map<number, RoomGameState>();

let runtimeGetter: () => MinigameRuntime = () => {
  throw new Error("Knockback runtime not initialized");
};

function isKnockbackItem(typeId: string): boolean {
  return (
    typeId === KNOCKBACK_ITEM_IDS.weak ||
    typeId === KNOCKBACK_ITEM_IDS.medium ||
    typeId === KNOCKBACK_ITEM_IDS.strong
  );
}

function tierOf(typeId: string): KnockbackTier | undefined {
  if (typeId === KNOCKBACK_ITEM_IDS.weak) return "weak";
  if (typeId === KNOCKBACK_ITEM_IDS.medium) return "medium";
  if (typeId === KNOCKBACK_ITEM_IDS.strong) return "strong";
  return undefined;
}

function makeStickItem(tier: KnockbackTier): ItemStack {
  const item = new ItemStack(KNOCKBACK_ITEM_IDS[tier], 1);
  const durability = item.getComponent(
    ItemComponentTypes.Durability,
  ) as ItemDurabilityComponent | undefined;
  if (durability) {
    durability.damage = STICK_DURABILITY[tier];
  }
  const enchantable = item.getComponent(
    ItemComponentTypes.Enchantable,
  ) as ItemEnchantableComponent | undefined;
  if (enchantable) {
    const level = tier === "weak" ? 1 : tier === "medium" ? 2 : 2;
    try {
      enchantable.addEnchantment({
        type: new EnchantmentType("knockback"),
        level,
      });
    } catch {
      // 等级/兼容性失败时静默,击退仍由脚本自定义力度实现
    }
  }
  return item;
}

function getInventory(player: Player): EntityInventoryComponent | undefined {
  return player.getComponent(
    EntityComponentTypes.Inventory,
  ) as EntityInventoryComponent | undefined;
}

function getMainhandItem(player: Player): ItemStack | undefined {
  const equippable = player.getComponent(
    EntityComponentTypes.Equippable,
  ) as EntityEquippableComponent | undefined;
  return equippable?.getEquipment(EquipmentSlot.Mainhand);
}

function getBestStick(
  player: Player,
): { slot: number; tier: KnockbackTier; damage: number } | undefined {
  const inventory = getInventory(player);
  if (!inventory?.container) return undefined;

  let best: { slot: number; tier: KnockbackTier; damage: number } | undefined;
  for (let slot = 0; slot < inventory.container.size; slot++) {
    const item = inventory.container.getItem(slot);
    if (!item) continue;
    const tier = tierOf(item.typeId);
    if (!tier) continue;
    const durability = item.getComponent(
      ItemComponentTypes.Durability,
    ) as ItemDurabilityComponent | undefined;
    const damage = durability?.damage ?? 0;
    if (
      !best ||
      TIER_ORDER[tier] > TIER_ORDER[best.tier] ||
      (tier === best.tier && damage < best.damage)
    ) {
      best = { slot, tier, damage };
    }
  }
  return best;
}

function removeKnockbackItems(player: Player, exceptSlot?: number): void {
  const inventory = getInventory(player);
  if (!inventory?.container) return;
  for (let slot = 0; slot < inventory.container.size; slot++) {
    if (slot === exceptSlot) continue;
    const item = inventory.container.getItem(slot);
    if (item && isKnockbackItem(item.typeId)) {
      inventory.container.setItem(slot, undefined);
    }
  }
}

/** 保证玩家身上最多只有一根击退木棍,并放到快捷栏第 1 格(slot 0) */
function consolidateSticks(player: Player): void {
  const inventory = getInventory(player);
  if (!inventory?.container) return;

  const best = getBestStick(player);
  if (!best) {
    inventory.container.setItem(0, makeStickItem("weak"));
    removeKnockbackItems(player, 0);
    return;
  }

  const bestItem = inventory.container.getItem(best.slot);
  if (best.slot !== 0) {
    inventory.container.setItem(0, bestItem);
    inventory.container.setItem(best.slot, undefined);
  }
  removeKnockbackItems(player, 0);
}

function giveStartStick(player: Player): void {
  clearAllPlayerItems(player);
  const inventory = getInventory(player);
  inventory?.container?.setItem(0, makeStickItem("weak"));
}

function isInCentralArea(player: Player): boolean {
  const cfg = getKnockbackConfig();
  const dx = player.location.x - cfg.arenaCenter.x;
  const dz = player.location.z - cfg.arenaCenter.z;
  const horizontalIn = dx * dx + dz * dz <= cfg.centerRadius * cfg.centerRadius;
  const onHighPlatform = player.location.y >= cfg.centerFloorY + 0.5;
  return horizontalIn && onHighPlatform;
}

function isInBonusArea(player: Player): boolean {
  const cfg = getKnockbackConfig();
  const dx = player.location.x - cfg.arenaCenter.x;
  const dz = player.location.z - cfg.arenaCenter.z;
  const horizontalIn = dx * dx + dz * dz <= cfg.bonusRadius * cfg.bonusRadius;
  const onBonusPlatform = player.location.y >= cfg.centerFloorY + 1 + 0.5;
  return horizontalIn && onBonusPlatform;
}

function getStickSpawnPoints(): { x: number; y: number; z: number }[] {
  const cfg = getKnockbackConfig();
  const centerY = cfg.centerFloorY + 1;
  const outerY = cfg.outerFloorY + 1;
  const outerR = Math.max(cfg.outerRadius - 4, cfg.centerRadius + 2);
  const points = [
    { x: cfg.arenaCenter.x, y: centerY, z: cfg.arenaCenter.z },
    { x: cfg.arenaCenter.x + 3, y: centerY, z: cfg.arenaCenter.z + 3 },
    { x: cfg.arenaCenter.x - 3, y: centerY, z: cfg.arenaCenter.z - 3 },
    { x: cfg.arenaCenter.x + 4, y: centerY, z: cfg.arenaCenter.z - 4 },
  ];
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    points.push({
      x: cfg.arenaCenter.x + Math.round(Math.cos(angle) * outerR),
      y: outerY,
      z: cfg.arenaCenter.z + Math.round(Math.sin(angle) * outerR),
    });
  }
  return points;
}

/** 按实际人数生成等分圆出生点(派对模式忽略人数上限时也不会重叠) */
function getStartPositions(count: number): { x: number; y: number; z: number }[] {
  const cfg = getKnockbackConfig();
  const radius = Math.max(cfg.outerRadius - 4, cfg.centerRadius + 2);
  const y = cfg.outerFloorY + 1;
  const n = Math.max(count, 1);
  return Array.from({ length: n }, (_, i) => {
    const angle = (i / n) * Math.PI * 2;
    return {
      x: cfg.arenaCenter.x + Math.round(Math.cos(angle) * radius),
      y,
      z: cfg.arenaCenter.z + Math.round(Math.sin(angle) * radius),
    };
  });
}

function getStickSpawnCounts(): { medium: number; strong: number } {
  const cfg = getKnockbackConfig();
  return { medium: cfg.mediumSpawnCount, strong: cfg.strongSpawnCount };
}

function getStickRespawnTicks(): number {
  return getKnockbackConfig().stickRespawnSeconds * 20;
}

function getStickEntities(
  roomId: number,
  runtime: MinigameRuntime,
): { entity: Entity; tier: KnockbackTier }[] {
  try {
    const dimension = runtime.roomDim(roomId);
    const result: { entity: Entity; tier: KnockbackTier }[] = [];
    for (const entity of dimension.getEntities({ type: "minecraft:item" })) {
      const itemComp = entity.getComponent(
        EntityComponentTypes.Item,
      ) as EntityItemComponent | undefined;
      const tier = itemComp ? tierOf(itemComp.itemStack.typeId) : undefined;
      if (tier) {
        result.push({ entity, tier });
      }
    }
    return result;
  } catch {
    return [];
  }
}

function spawnStickAtFreePoint(
  roomId: number,
  tier: KnockbackTier,
  runtime: MinigameRuntime,
): void {
  try {
    const dimension = runtime.roomDim(roomId);
    const occupied = new Set(
      getStickEntities(roomId, runtime).map(
        (entry) => `${Math.round(entry.entity.location.x)},${Math.round(entry.entity.location.z)}`,
      ),
    );
    const freePoints = getStickSpawnPoints().filter(
      (point) => !occupied.has(`${point.x},${point.z}`),
    );
    if (freePoints.length === 0) return;
    const point = freePoints[Math.floor(Math.random() * freePoints.length)];
    dimension.spawnItem(makeStickItem(tier), point);
    runtime.announce(roomId, `§e${TIER_NAMES[tier]}在场上出现!`);
  } catch {
    // 场地未就绪等异常忽略,由下一轮刷新补
  }
}

function ensureStickSpawns(roomId: number, runtime: MinigameRuntime): void {
  const counts: Record<"medium" | "strong", number> = { medium: 0, strong: 0 };
  for (const entry of getStickEntities(roomId, runtime)) {
    if (entry.tier === "medium" || entry.tier === "strong") {
      counts[entry.tier]++;
    }
  }
  const countsConfig = getStickSpawnCounts();
  for (const tier of ["medium", "strong"] as const) {
    while (counts[tier] < countsConfig[tier]) {
      spawnStickAtFreePoint(roomId, tier, runtime);
      counts[tier]++;
    }
  }
}

function damageMainhandStick(
  player: Player,
  expectedTier?: KnockbackTier,
): void {
  const equippable = player.getComponent(
    EntityComponentTypes.Equippable,
  ) as EntityEquippableComponent | undefined;
  const item = equippable?.getEquipment(EquipmentSlot.Mainhand);
  const tier = item ? tierOf(item.typeId) : undefined;

  // 主手已经空了/换掉了:如果刚才是中/强木棍,按“损坏”补一根弱木棍
  if (!item || !tier) {
    if (expectedTier === "medium" || expectedTier === "strong") {
      equippable?.setEquipment(EquipmentSlot.Mainhand, makeStickItem("weak"));
      player.onScreenDisplay.setActionBar("§c木棍损坏,已换成弱击退木棍");
    }
    return;
  }

  // 弱木棍无限耐久
  if (tier === "weak") return;

  const durability = item.getComponent(
    ItemComponentTypes.Durability,
  ) as ItemDurabilityComponent | undefined;
  if (!durability) return;

  if (durability.damage + 1 >= durability.maxDurability) {
    equippable?.setEquipment(EquipmentSlot.Mainhand, makeStickItem("weak"));
    player.onScreenDisplay.setActionBar("§c木棍损坏,已换成弱击退木棍");
  } else {
    const next = makeStickItem(tier);
    const nextDurability = next.getComponent(
      ItemComponentTypes.Durability,
    ) as ItemDurabilityComponent | undefined;
    if (nextDurability) {
      nextDurability.damage = durability.damage + 1;
    }
    equippable?.setEquipment(EquipmentSlot.Mainhand, next);
  }
}

function getCurrentTier(player: Player): KnockbackTier | undefined {
  return getBestStick(player)?.tier;
}

function onEntityHurt(event: EntityHurtBeforeEvent): void {
  const runtime = runtimeGetter();
  const victim = event.hurtEntity;
  const roomId = runtime.roomIdFromDimension(victim.dimension.id);
  if (roomId === undefined || !runtime.isRunning(roomId)) return;
  if (victim.typeId !== "minecraft:player") return;

  // 倒计时期间不结算任何伤害/击退
  if (roomStates.get(roomId)?.countdownActive) {
    event.cancel = true;
    return;
  }

  // 纯击退:摔落不掉血
  if (event.damageSource.cause === EntityDamageCause.fall) {
    event.cancel = true;
    return;
  }

  if (event.damageSource.cause !== EntityDamageCause.entityAttack) return;

  const attacker = event.damageSource.damagingEntity;
  if (!attacker || attacker.typeId !== "minecraft:player") return;

  // 玩家之间攻击一律不掉血,只做自定义击退
  event.cancel = true;

  const attackerPlayer = attacker as Player;
  const mainhand = getMainhandItem(attackerPlayer);
  const tier = mainhand ? tierOf(mainhand.typeId) : undefined;
  if (!tier) return;

  const strength = KNOCKBACK_STRENGTH[tier];
  const dx = victim.location.x - attacker.location.x;
  const dz = victim.location.z - attacker.location.z;
  const length = Math.hypot(dx, dz) || 1;
  const nx = dx / length;
  const nz = dz / length;

  system.run(() => {
    if (!victim.isValid || !attacker.isValid) return;
    victim.applyKnockback(
      { x: nx * strength.horizontal, z: nz * strength.horizontal },
      strength.vertical,
    );
    try {
      victim.dimension.spawnParticle("minecraft:critical_hit_emitter", {
        x: victim.location.x,
        y: victim.location.y + 1,
        z: victim.location.z,
      });
    } catch {
      // 粒子不存在时忽略,不影响击退
    }
    damageMainhandStick(attackerPlayer, tier);
  });
}

function onItemPickup(event: EntityItemPickupAfterEvent): void {
  const runtime = runtimeGetter();
  const entity = event.entity;
  if (entity.typeId !== "minecraft:player") return;
  const player = entity as Player;

  const roomId = runtime.roomIdFromDimension(player.dimension.id);
  if (roomId === undefined || !runtime.isRunning(roomId)) return;

  const hasUpgrade = event.items.some(
    (item) => tierOf(item.typeId) === "medium" || tierOf(item.typeId) === "strong",
  );
  if (!hasUpgrade) return;

  consolidateSticks(player);
  const currentTier = getCurrentTier(player);
  if (currentTier === "medium" || currentTier === "strong") {
    player.onScreenDisplay.setActionBar(`§a获得${TIER_NAMES[currentTier]}!`);
  }
}

function createScoreShapes(
  roomId: number,
  players: Player[],
  state: RoomGameState,
  runtime: MinigameRuntime,
): void {
  for (const player of players) {
    try {
      const shape = new TextPrimitive({ x: 0, y: SCORE_SHAPE_Y, z: 0 }, `§l0.0`);
      shape.scale = 1;
      shape.color = { red: 1, green: 1, blue: 1, alpha: 1 };
      shape.backgroundColorOverride = {
        red: 0,
        green: 0,
        blue: 0,
        alpha: 0.4,
      };
      shape.depthTest = false;
      shape.attachedTo = player;
      // 自己的分数不给本人看,只显示给其他玩家
      shape.visibleTo = players.filter((p) => p.id !== player.id);
      world.primitiveShapesManager.addText(shape, runtime.roomDim(roomId));
      state.scoreShapes.set(player.id, shape);
    } catch (error) {
      console.warn("[Bearcade knockback] 创建分数浮空字失败", error);
    }
  }
}

function updateScoreShapes(
  players: Player[],
  state: RoomGameState,
): void {
  for (const player of players) {
    const shape = state.scoreShapes.get(player.id);
    if (!shape) continue;
    const score = state.scores.get(player.id) ?? 0;
    try {
      shape.setText(`§l${score.toFixed(1)}`);
    } catch {
      // ignore
    }
  }
}

function removeScoreShapes(state: RoomGameState): void {
  for (const shape of state.scoreShapes.values()) {
    try {
      shape.remove();
    } catch {
      // ignore
    }
  }
  state.scoreShapes.clear();
}

function updateActionBar(
  players: Player[],
  state: RoomGameState,
): void {
  const elapsedTicks = state.tickCounter * SCORE_INTERVAL_TICKS;
  const elapsedSeconds = elapsedTicks / 20;
  const remaining = Math.max(
    0,
    getKnockbackConfig().gameDurationSeconds - Math.floor(elapsedSeconds),
  );

  for (const player of players) {
    const score = state.scores.get(player.id) ?? 0;
    player.onScreenDisplay.setActionBar(
      `§l时间: ${remaining}s   §l得分: ${score.toFixed(1)}`,
    );
  }
}

function tickRoom(roomId: number, runtime: MinigameRuntime): void {
  const state = roomStates.get(roomId);
  if (!state) return;
  if (!runtime.isRunning(roomId)) {
    stopRoomTimers(roomId);
    return;
  }

  state.tickCounter++;
  const players = runtime.roomPlayers(roomId);
  for (const player of players) {
    if (isInBonusArea(player)) {
      state.scores.set(
        player.id,
        (state.scores.get(player.id) ?? 0) + BONUS_SCORE_PER_INTERVAL,
      );
    } else if (isInCentralArea(player)) {
      state.scores.set(
        player.id,
        (state.scores.get(player.id) ?? 0) + SCORE_PER_INTERVAL,
      );
    }

    // 兜底:玩家背包里没有任何木棍时,自动补一根弱击退木棍
    if (!getBestStick(player)) {
      consolidateSticks(player);
      player.onScreenDisplay.setActionBar("§c检测到没有木棍,已补充弱击退木棍");
    }
  }

  // 剩余时间提醒
  const remaining =
    getKnockbackConfig().gameDurationSeconds -
    (state.tickCounter * SCORE_INTERVAL_TICKS) / 20;
  const remainingCeil = Math.ceil(remaining);
  if (
    (TIME_WARNING_SECONDS as readonly number[]).includes(remainingCeil) &&
    !state.announcedReminders.has(remainingCeil)
  ) {
    state.announcedReminders.add(remainingCeil);
    runtime.announce(roomId, `§e还剩 ${remainingCeil} 秒!`);
  }

  if (state.tickCounter % HUD_REFRESH_TICKS === 0) {
    updateActionBar(players, state);
    updateScoreShapes(players, state);
  }
  if (
    state.tickCounter % getStickRespawnTicks() === 0 &&
    remaining > STICK_SPAWN_STOP_SECONDS
  ) {
    ensureStickSpawns(roomId, runtime);
  }
}

function stopRoomTimers(roomId: number): void {
  const state = roomStates.get(roomId);
  if (!state) return;
  if (state.countdownIntervalId !== undefined) {
    try {
      system.clearRun(state.countdownIntervalId);
    } catch {
      // ignore
    }
  }
  if (state.intervalId !== undefined) {
    try {
      system.clearRun(state.intervalId);
    } catch {
      // ignore
    }
  }
  if (state.endTimeoutId !== undefined) {
    try {
      system.clearRun(state.endTimeoutId);
    } catch {
      // ignore
    }
  }
  state.countdownIntervalId = undefined;
  state.intervalId = undefined;
  state.endTimeoutId = undefined;
}

function startGameLoop(
  roomId: number,
  players: Player[],
  state: RoomGameState,
  runtime: MinigameRuntime,
): void {
  state.intervalId = system.runInterval(
    () => tickRoom(roomId, runtime),
    SCORE_INTERVAL_TICKS,
  );
  state.endTimeoutId = system.runTimeout(() => {
    if (runtime.isRunning(roomId)) {
      runtime.endGame(roomId, "时间到", "§e时间到!击退战结束");
    }
  }, getKnockbackConfig().gameDurationSeconds * 20);

  updateActionBar(players, state);
  updateScoreShapes(players, state);
}

function startRoom(
  roomId: number,
  players: Player[],
  runtime: MinigameRuntime,
): void {
  const state: RoomGameState = {
    scores: new Map(),
    tickCounter: 0,
    scoreShapes: new Map(),
    countdownActive: true,
    announcedReminders: new Set(),
  };
  roomStates.set(roomId, state);

  const startPositions = getStartPositions(players.length);
  players.forEach((player, index) => {
    giveStartStick(player);
    runtime.teleportPlayer(
      roomId,
      player,
      startPositions[index] ?? startPositions[0],
    );
  });

  ensureStickSpawns(roomId, runtime);
  runtime.announce(roomId, "§a击退战开始!在中央高台停留得分,用木棍把别人推下去!");
  createScoreShapes(roomId, players, state, runtime);

  // 开局显示一次游戏名,3 秒倒计时内禁止移动
  for (const player of players) {
    player.onScreenDisplay.setTitle("§l击退战", {
      fadeInDuration: 0,
      stayDuration: 20,
      fadeOutDuration: 10,
    });
    player.onScreenDisplay.setActionBar("§l3");
    try {
      player.inputPermissions.setPermissionCategory(
        InputPermissionCategory.Movement,
        false,
      );
    } catch {
      // ignore
    }
  }

  let countdown = 3;
  state.countdownIntervalId = system.runInterval(() => {
    countdown--;
    if (countdown <= 0) {
      if (state.countdownIntervalId !== undefined) {
        try {
          system.clearRun(state.countdownIntervalId);
        } catch {
          // ignore
        }
        state.countdownIntervalId = undefined;
      }
      for (const player of players) {
        try {
          player.inputPermissions.setPermissionCategory(
            InputPermissionCategory.Movement,
            true,
          );
        } catch {
          // ignore
        }
      }
      state.countdownActive = false;
      startGameLoop(roomId, players, state, runtime);
    } else {
      for (const player of players) {
        player.onScreenDisplay.setActionBar(`§l${countdown}`);
      }
    }
  }, 20);
}

function announceResults(roomId: number, runtime: MinigameRuntime): void {
  const state = roomStates.get(roomId);
  if (!state) return;
  const players = runtime.roomPlayers(roomId);
  const entries = players
    .map((player) => ({
      name: stripSectionCodes(player.name),
      score: state.scores.get(player.id) ?? 0,
    }))
    .sort((a, b) => b.score - a.score);

  if (entries.length === 0) return;
  const lines = entries
    .map((entry, index) => `§e${index + 1}. ${entry.name} §f${entry.score.toFixed(1)}分`)
    .join("\n");
  runtime.announce(roomId, `§6=== 击退战结果 ===\n${lines}`);
}

export function makeKnockbackHooks(
  getRuntime: () => MinigameRuntime,
): MinigameHooks {
  runtimeGetter = getRuntime;
  // 全局监听只注册一次(模块加载时调用一次)
  world.beforeEvents.entityHurt.subscribe(onEntityHurt);
  world.afterEvents.entityItemPickup.subscribe(onItemPickup);

  return {
    onGameStart(roomId, players) {
      startRoom(roomId, players, getRuntime());
    },
    openConfig(player) {
      openKnockbackConfig(player, getRuntime());
    },
    onBeforeReset(roomId) {
      const runtime = getRuntime();
      const state = roomStates.get(roomId);
      announceResults(roomId, runtime);

      stopRoomTimers(roomId);
      if (state) {
        removeScoreShapes(state);
      }
      roomStates.delete(roomId);

      for (const player of runtime.roomPlayers(roomId)) {
        clearHudTitle(player);
        player.onScreenDisplay.setActionBar("");
        try {
          player.inputPermissions.setPermissionCategory(
            InputPermissionCategory.Movement,
            true,
          );
        } catch {
          // ignore
        }
        clearAllPlayerItems(player);
      }

      for (const entry of getStickEntities(roomId, runtime)) {
        try {
          entry.entity.kill();
        } catch {
          // ignore
        }
      }
    },
  };
}
