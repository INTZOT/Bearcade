// ============================================================
// 杀年猪(NewYearPig)玩法
// 32×32 草方块地皮,持续刷新鸡/猪/羊;限时 90 秒击杀得分。
// - 鸡 +1(1 击),猪 +3(2 击,速度 III),羊 +5(2 击,速度 IV)
// - 约 30% 动物为红色 -50%,击杀后当前总分四舍五入减半
// - 猪/羊受惊后按配置逃跑(默认 15 秒,可设 0=一直跑)
// - 特殊事件:随机刷新 3 耐久钻石剑、以及“牛来”特殊牛
// ============================================================
import {
  EntityComponentTypes,
  GameMode,
  ItemComponentTypes,
  ItemDurabilityComponent,
  ItemLockMode,
  ItemStack,
  system,
  world,
  TextPrimitive,
  type Entity,
  type EntityHealthComponent,
  type EntityInventoryComponent,
  type Player,
  type RawMessage,
  type VanillaEntityIdentifier,
} from "@minecraft/server";
import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import {
  clearHudTitle,
  ensureObjective as ensureHudObjective,
  hudMessage,
  releaseObjective,
  setHudTitle,
  setObjectiveScore,
} from "../../shared/minigame-core/scoreboardHud";
import { clearAllPlayerItems } from "../../shared/minigame-core/playerItems";
import {
  getNewYearPigConfig,
  openNewYearPigConfig,
} from "./newyearpig-config";
import {
  ANIMAL_HEALTH,
  ANIMAL_SPEED_AMPLIFIER,
  ANIMAL_TEXT,
  ANIMAL_TEXT_OFFSET,
  ANIMAL_TYPES,
  CURSED_TEXT,
  PLAYER_WEAPON,
  START_POSITIONS,
  type AnimalKind,
  type NewYearPigConfig,
} from "./config";

interface TrackedAnimal {
  entity: Entity;
  kind: AnimalKind;
  cursed: boolean;
  shape: TextPrimitive;
  lastHitterId?: string;
  /** 速度效果 amplifier;undefined 表示不加速 */
  speedAmplifier: number | undefined;
  /** 受惊逃跑截止 tick;0 = 未受惊,Infinity = 一直逃跑 */
  panicUntilTick: number;
}

interface Session {
  startTick: number;
  lastSpawnTick: number;
  scores: Map<string, number>;
  names: Map<string, string>;
  animals: Map<string, TrackedAnimal>;
  /** 两次钻石剑刷新 tick */
  swordEventTicks: number[];
  swordSpawned: boolean[];
  /** “牛来”刷新 tick */
  cowEventTick: number;
  cowSpawned: boolean;
  finished: boolean;
}

const sessions = new Map<number, Session>();

function objectiveId(roomId: number): string {
  return `bearcade:nyp_score_${roomId}`;
}

function pointsFor(cfg: NewYearPigConfig, kind: AnimalKind): number {
  switch (kind) {
    case "chicken":
      return cfg.chickenPoints;
    case "pig":
      return cfg.pigPoints;
    case "sheep":
      return cfg.sheepPoints;
    case "cow":
      return cfg.specialCowPoints;
  }
}

function pickKind(cfg: NewYearPigConfig): AnimalKind {
  const total = cfg.chickenWeight + cfg.pigWeight + cfg.sheepWeight;
  const roll = Math.random() * total;
  if (roll < cfg.chickenWeight) return "chicken";
  if (roll < cfg.chickenWeight + cfg.pigWeight) return "pig";
  return "sheep";
}

function randomSpawnLocation(cfg: NewYearPigConfig) {
  const x = cfg.mapOrigin.x + Math.floor(Math.random() * cfg.mapSize);
  const z = cfg.mapOrigin.z + Math.floor(Math.random() * cfg.mapSize);
  return {
    x: x + 0.5,
    y: cfg.mapOrigin.y + 1,
    z: z + 0.5,
  };
}

function distance(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function nearestPlayer(
  runtime: MinigameRuntime,
  roomId: number,
  entity: Entity,
): Player | undefined {
  let best: Player | undefined;
  let bestDistance = Infinity;
  for (const player of runtime.roomPlayers(roomId)) {
    const d = distance(entity.location, player.location);
    if (d < bestDistance) {
      bestDistance = d;
      best = player;
    }
  }
  return best;
}

function applyFleeImpulse(
  entity: Entity,
  player: Player,
  strength: number,
): void {
  const dx = entity.location.x - player.location.x;
  const dz = entity.location.z - player.location.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.01) return;
  try {
    entity.applyImpulse({
      x: (dx / dist) * strength,
      y: 0.15,
      z: (dz / dist) * strength,
    });
  } catch {
    // 实体可能已被移除
  }
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function makeUnbreakableWoodenSword(): ItemStack {
  const sword = new ItemStack(PLAYER_WEAPON, 1);
  sword.lockMode = ItemLockMode.slot;
  const durability = sword.getComponent(
    ItemComponentTypes.Durability,
  ) as ItemDurabilityComponent | undefined;
  if (durability) {
    durability.unbreakable = true;
  }
  return sword;
}

function makeDiamondSword(durabilityLeft: number): ItemStack {
  const sword = new ItemStack("minecraft:diamond_sword", 1);
  const durability = sword.getComponent(
    ItemComponentTypes.Durability,
  ) as ItemDurabilityComponent | undefined;
  if (durability) {
    durability.damage = Math.max(0, durability.maxDurability - durabilityLeft);
  }
  return sword;
}

function spawnFirework(
  dimension: ReturnType<MinigameRuntime["roomDim"]>,
  location: { x: number; y: number; z: number },
): void {
  try {
    dimension.spawnEntity(
      "minecraft:fireworks_rocket" as VanillaEntityIdentifier,
      { x: location.x, y: location.y + 1.5, z: location.z },
    );
  } catch (error) {
    console.warn("[Bearcade newyearpig] 生成烟花失败", error);
  }
}

function spawnDiamondSword(runtime: MinigameRuntime, roomId: number): void {
  const cfg = getNewYearPigConfig();
  const loc = randomSpawnLocation(cfg);
  try {
    const sword = makeDiamondSword(cfg.diamondSwordDurabilityLeft);
    runtime.roomDim(roomId).spawnItem(sword, loc);
    spawnFirework(runtime.roomDim(roomId), loc);
    runtime.announce(
      roomId,
      `§e钻石剑已刷新在场上!耐久仅剩 ${cfg.diamondSwordAnnounceDurability} 点,快去抢!`,
    );
    console.warn(
      `[Bearcade newyearpig] 钻石剑生成成功 room=${roomId} @ ${loc.x},${loc.z}`,
    );
  } catch (error) {
    console.warn("[Bearcade newyearpig] 刷新钻石剑失败", error);
  }
}

function mapCenterLocation(cfg: NewYearPigConfig) {
  return {
    x: cfg.mapOrigin.x + Math.floor(cfg.mapSize / 2) + 0.5,
    y: cfg.mapOrigin.y + 1,
    z: cfg.mapOrigin.z + Math.floor(cfg.mapSize / 2) + 0.5,
  };
}

function spawnSpecialCow(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  const cfg = getNewYearPigConfig();
  const loc = mapCenterLocation(cfg);
  const dimension = runtime.roomDim(roomId);

  let entity: Entity;
  try {
    entity = dimension.spawnEntity(
      "minecraft:cow" as VanillaEntityIdentifier,
      loc,
    );
  } catch (error) {
    console.warn("[Bearcade newyearpig] 牛来实体生成失败", error);
    return;
  }

  try {
    // 原版牛最大生命只有 10,不能直接 setCurrentValue(25);
    // 用“10 血内基础血量 + 伤害吸收”凑出 25 点有效血量。
    const health = entity.getComponent(
      EntityComponentTypes.Health,
    ) as EntityHealthComponent | undefined;
    if (cfg.specialCowHealth <= 10) {
      health?.setCurrentValue(cfg.specialCowHealth);
    } else {
      const levels = Math.ceil((cfg.specialCowHealth - 10) / 4);
      const absorptionHp = levels * 4;
      const baseHealth = Math.max(
        1,
        Math.min(10, cfg.specialCowHealth - absorptionHp),
      );
      health?.setCurrentValue(baseHealth);
      entity.addEffect("absorption", 20 * 60, {
        amplifier: levels - 1,
        showParticles: false,
      });
    }
  } catch (error) {
    console.warn("[Bearcade newyearpig] 牛来血量设置失败", error);
  }

  try {
    entity.addEffect("speed", 20 * 60, {
      amplifier: cfg.specialCowSpeedAmplifier,
      showParticles: false,
    });
  } catch (error) {
    console.warn("[Bearcade newyearpig] 牛来速度buff失败", error);
  }

  // 悬浮字单独 try:即使浮空字失败,也要保证牛来实体和公告正常
  const shape = new TextPrimitive(
    { x: 0, y: ANIMAL_TEXT_OFFSET.cow, z: 0 },
    "§e+10\n§l§e牛来",
  );
  shape.attachedTo = entity;
  shape.scale = 1.6;
  try {
    world.primitiveShapesManager.addText(shape, dimension);
  } catch (error) {
    console.warn("[Bearcade newyearpig] 牛来悬浮字添加失败", error);
  }

  session.animals.set(entity.id, {
    entity,
    kind: "cow",
    cursed: false,
    shape,
    speedAmplifier: cfg.specialCowSpeedAmplifier,
    panicUntilTick: 0,
  });

  runtime.announce(roomId, `§e§l"牛来"§r 刷新在了场地中央！`);
  console.warn(
    `[Bearcade newyearpig] 牛来生成成功 room=${roomId} @ ${loc.x},${loc.z}`,
  );
  runtime.dbg(`牛来刷新 @ ${loc.x},${loc.z}`);
}

function scheduleSpecialEvents(cfg: NewYearPigConfig, session: Session): void {
  const start = session.startTick;
  const durationSec = cfg.gameDurationSeconds;
  const tickForRemaining = (remaining: number) =>
    start + Math.round((durationSec - remaining) * 20);

  const firstSword = tickForRemaining(
    randomBetween(
      cfg.swordSpawnFirstMinRemaining,
      cfg.swordSpawnFirstMaxRemaining,
    ),
  );
  const secondSword = tickForRemaining(
    randomBetween(
      cfg.swordSpawnSecondMinRemaining,
      cfg.swordSpawnSecondMaxRemaining,
    ),
  );
  let cow = tickForRemaining(
    randomBetween(cfg.specialCowMinRemaining, cfg.specialCowMaxRemaining),
  );
  // 牛来与第二把钻石剑错开至少 1 秒
  while (Math.abs(cow - secondSword) < 20) {
    cow = tickForRemaining(
      randomBetween(cfg.specialCowMinRemaining, cfg.specialCowMaxRemaining),
    );
  }

  session.swordEventTicks = [firstSword, secondSword];
  session.swordSpawned = [false, false];
  session.cowEventTick = cow;
  session.cowSpawned = false;
}

function spawnAnimal(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  const cfg = getNewYearPigConfig();
  if (session.animals.size >= cfg.maxAnimals) return;
  const kind = pickKind(cfg);
  const cursed = Math.random() * 100 < cfg.cursedChancePercent;
  const location = randomSpawnLocation(cfg);
  const dimension = runtime.roomDim(roomId);
  try {
    const entity = dimension.spawnEntity(
      ANIMAL_TYPES[kind] as VanillaEntityIdentifier,
      location,
    );

    // 鸡 1 击 / 猪、牛 2 击
    const health = entity.getComponent(
      EntityComponentTypes.Health,
    ) as EntityHealthComponent | undefined;
    health?.setCurrentValue(ANIMAL_HEALTH[kind]);

    // 猪/牛常驻速度效果
    const speedAmplifier = ANIMAL_SPEED_AMPLIFIER[kind];
    if (speedAmplifier !== undefined) {
      entity.addEffect("speed", 20 * 60, {
        amplifier: speedAmplifier,
        showParticles: false,
      });
    }

    // 头顶悬浮字(所有人可见)
    // TextPrimitive 支持 attachedTo 实体绑定:shape 的 location 会被当作相对实体的偏移
    const text = cursed ? CURSED_TEXT : ANIMAL_TEXT[kind];
    const shape = new TextPrimitive(
      {
        x: 0,
        y: ANIMAL_TEXT_OFFSET[kind],
        z: 0,
      },
      text,
    );
    shape.attachedTo = entity;
    world.primitiveShapesManager.addText(shape, dimension);

    session.animals.set(entity.id, {
      entity,
      kind,
      cursed,
      shape,
      speedAmplifier,
      panicUntilTick: 0,
    });
    runtime.dbg(`生成 ${kind}${cursed ? "(-50%)" : ""} @ ${entity.location.x},${entity.location.z}`);
  } catch (error) {
    console.warn(`[Bearcade newyearpig] 生成动物失败 room=${roomId}`, error);
  }
}

function clearSessionAnimals(session: Session): void {
  for (const animal of session.animals.values()) {
    try {
      world.primitiveShapesManager.removeText(animal.shape);
    } catch {
      // 可能已被移除
    }
    try {
      if (animal.entity.isValid) animal.entity.remove();
    } catch {
      // 忽略
    }
  }
  session.animals.clear();
}

/** 清理房间内掉落物和经验球,避免对局结束后残留 */
function clearDropsAndXp(runtime: MinigameRuntime, roomId: number): void {
  for (const type of ["minecraft:item", "minecraft:xp_orb"]) {
    try {
      const entities = runtime.roomDim(roomId).getEntities({
        type,
      });
      for (const entity of entities) {
        try {
          entity.remove();
        } catch {
          // 可能已被移除
        }
      }
    } catch {
      // 维度/查询异常忽略
    }
  }
}

function sortedScores(session: Session): [string, number][] {
  return [...session.scores.entries()].sort((a, b) => b[1] - a[1]);
}

function playerName(session: Session, playerId: string): string {
  return session.names.get(playerId) ?? "?";
}

function updateHud(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  const cfg = getNewYearPigConfig();
  const remain = Math.max(
    0,
    Math.ceil(
      (cfg.gameDurationSeconds * 20 - (system.currentTick - session.startTick)) /
        20,
    ),
  );
  const top = sortedScores(session).slice(0, 3);
  const parts: RawMessage[] = [
    { text: "§6杀年猪§r\n" },
    { text: `§e剩余 ${remain} 秒§r\n` },
    { text: "§b--- 前三 ---§r" },
  ];
  if (top.length === 0) {
    parts.push({ text: "\n§7暂无分数" });
  }
  for (let i = 0; i < top.length; i++) {
    const [playerId, score] = top[i];
    const name = playerName(session, playerId);
    parts.push({ text: `\n§f${i + 1}. ${name} §r§6${score} 分` });
  }

  for (const player of runtime.roomPlayers(roomId)) {
    setHudTitle(player, hudMessage(parts));
    const myScore = session.scores.get(player.id) ?? 0;
    player.onScreenDisplay.setActionBar(`§e我的分数: ${myScore}`);
  }
}

function finishGame(
  runtime: MinigameRuntime,
  roomId: number,
  session: Session,
): void {
  const top = sortedScores(session).slice(0, 3);
  const lines = top.map(([playerId, score], index) => {
    const name = playerName(session, playerId);
    return `${index + 1}. §e${name}§r §6${score} 分`;
  });
  const summary =
    lines.length > 0
      ? lines.join("\n")
      : "§7本局没有玩家获得分数";
  runtime.endGame(roomId, "时间到", `§e时间到!本局前三:\n${summary}`);
}

function tickNewYearPig(getRuntime: () => MinigameRuntime): void {
  const runtime = getRuntime();
  for (const [roomId, session] of [...sessions.entries()]) {
    try {
      if (session.finished) continue;
      if (runtime.getPhase(roomId) !== "running") {
        // 等待 onBeforeReset 统一清理动物/悬浮字,不要在这里提前删 session
        continue;
      }
      const cfg = getNewYearPigConfig();

      // 兜底:如果特殊事件计划缺失(例如配置异常),重新生成一次
      if (session.swordEventTicks.length < 2 || session.cowEventTick <= 0) {
        console.warn(
          `[Bearcade newyearpig] 特殊事件计划缺失,重新生成 room=${roomId}`,
        );
        scheduleSpecialEvents(cfg, session);
      }

      // 周期性生成动物
      if (
        system.currentTick - session.lastSpawnTick >=
        cfg.spawnIntervalSeconds * 20
      ) {
        session.lastSpawnTick = system.currentTick;
        const playerCount = runtime.roomPlayers(roomId).length;
        const extra =
          cfg.playersPerExtraSpawn > 0
            ? Math.floor(playerCount / cfg.playersPerExtraSpawn)
            : 0;
        const batch = cfg.spawnBatchBase + extra;
        for (let i = 0; i < batch; i++) {
          spawnAnimal(runtime, roomId, session);
        }
      }

      // 钻石剑刷新事件
      for (let i = 0; i < session.swordEventTicks.length; i++) {
        if (
          !session.swordSpawned[i] &&
          system.currentTick >= session.swordEventTicks[i]
        ) {
          session.swordSpawned[i] = true;
          console.warn(
            `[Bearcade newyearpig] 钻石剑事件触发 room=${roomId} 第${i + 1}波 tick=${system.currentTick}`,
          );
          spawnDiamondSword(runtime, roomId);
        }
      }

      // “牛来”刷新事件
      if (
        !session.cowSpawned &&
        system.currentTick >= session.cowEventTick
      ) {
        console.warn(
          `[Bearcade newyearpig] 牛来事件触发 room=${roomId} tick=${system.currentTick}`,
        );
        session.cowSpawned = true;
        spawnSpecialCow(runtime, roomId, session);
      }

      // 更新速度效果、受惊逃跑
      for (const animal of [...session.animals.values()]) {
        if (!animal.entity.isValid) {
          try {
            world.primitiveShapesManager.removeText(animal.shape);
          } catch {
            // 忽略
          }
          session.animals.delete(animal.entity.id);
          continue;
        }
        const speedAmplifier = animal.speedAmplifier;
        if (speedAmplifier !== undefined) {
          try {
            animal.entity.addEffect("speed", 20 * 30, {
              amplifier: speedAmplifier,
              showParticles: false,
            });
          } catch {
            // 忽略
          }
        }
        if (animal.panicUntilTick > system.currentTick) {
          const player = nearestPlayer(runtime, roomId, animal.entity);
          if (player) {
            applyFleeImpulse(animal.entity, player, cfg.panicStrength);
          }
        } else if (
          animal.panicUntilTick !== 0 &&
          animal.panicUntilTick !== Infinity
        ) {
          animal.panicUntilTick = 0;
        }
      }

      // 周期性续饱和,防止玩家饿死
      for (const player of runtime.roomPlayers(roomId)) {
        try {
          player.addEffect("saturation", 20 * 60 * 5, {
            amplifier: 0,
            showParticles: false,
          });
        } catch {
          // 忽略
        }
      }

      updateHud(runtime, roomId, session);

      // 时间到
      if (
        system.currentTick - session.startTick >=
        cfg.gameDurationSeconds * 20
      ) {
        session.finished = true;
        finishGame(runtime, roomId, session);
      }
    } catch (error) {
      console.warn(
        `[Bearcade newyearpig] 对局 tick 异常 room=${roomId}`,
        error,
      );
    }
  }
}

export function makeNewYearPigHooks(
  getRuntime: () => MinigameRuntime,
): MinigameHooks {
  return {
    onGameStart(roomId, players) {
      const runtime = getRuntime();
      const cfg = getNewYearPigConfig();
      const session: Session = {
        startTick: system.currentTick,
        lastSpawnTick: system.currentTick,
        scores: new Map(),
        names: new Map(),
        animals: new Map(),
        swordEventTicks: [],
        swordSpawned: [],
        cowEventTick: 0,
        cowSpawned: false,
        finished: false,
      };
      sessions.set(roomId, session);
      scheduleSpecialEvents(cfg, session);
      console.warn(
        `[Bearcade newyearpig] 房间 ${roomId} 特殊事件计划: 剑1=${session.swordEventTicks[0]}, 剑2=${session.swordEventTicks[1]}, 牛来=${session.cowEventTick}, 当前=${system.currentTick}`,
      );

      const objective = ensureHudObjective(objectiveId(roomId), "杀年猪 · 分数");
      players.forEach((player, index) => {
        player.setGameMode(GameMode.Survival);
        clearAllPlayerItems(player);
        const sword = makeUnbreakableWoodenSword();
        const inventory = player.getComponent(
          EntityComponentTypes.Inventory,
        ) as EntityInventoryComponent | undefined;
        inventory?.container?.setItem(0, sword);
        player.selectedSlotIndex = 0;
        // 饱和效果防饿死(持续 5 分钟,对局中会周期性续)
        player.addEffect("saturation", 20 * 60 * 5, {
          amplifier: 0,
          showParticles: false,
        });

        runtime.teleportPlayer(
          roomId,
          player,
          START_POSITIONS[index % START_POSITIONS.length] ?? START_POSITIONS[0],
        );
        session.scores.set(player.id, 0);
        session.names.set(player.id, player.name);
        if (objective) setObjectiveScore(objective, player, 0);
        player.onScreenDisplay.setActionBar("§e我的分数: 0");
      });

      for (let i = 0; i < cfg.initialSpawnCount; i++) {
        spawnAnimal(runtime, roomId, session);
      }

      updateHud(runtime, roomId, session);
      runtime.announce(
        roomId,
        `§a杀年猪开始!§r 限时 ${cfg.gameDurationSeconds} 秒,尽可能多击杀动物:\n` +
          `鸡 +${cfg.chickenPoints}(1 击) / 羊 +${cfg.sheepPoints}(2 击) / 猪 +${cfg.pigPoints}(2 击)\n` +
          `击杀红色 §c-50%§r 动物会使当前总分减半!\n` +
          `对局中会随机刷新钻石剑与特殊生物!`,
      );
    },
    onBeforeReset(roomId) {
      const runtime = getRuntime();
      const session = sessions.get(roomId);
      if (session) {
        session.finished = true;
        clearSessionAnimals(session);
      }
      clearDropsAndXp(runtime, roomId);
      for (const player of runtime.roomPlayers(roomId)) {
        clearHudTitle(player);
        player.onScreenDisplay.setActionBar("");
        clearAllPlayerItems(player);
        player.setGameMode(GameMode.Adventure);
      }
      sessions.delete(roomId);
      releaseObjective(objectiveId(roomId));
    },
    openConfig(player) {
      openNewYearPigConfig(player, getRuntime());
    },
  };
}

export function initNewYearPig(getRuntime: () => MinigameRuntime): void {
  // 动物死亡:给最后一击者计分,移除悬浮字
  world.afterEvents.entityDie.subscribe((event) => {
    const runtime = getRuntime();
    const deadId = event.deadEntity.id;
    for (const [roomId, session] of [...sessions.entries()]) {
      if (session.finished) continue;
      const animal = session.animals.get(deadId);
      if (!animal) continue;
      try {
        world.primitiveShapesManager.removeText(animal.shape);
      } catch {
        // 可能已被移除
      }
      session.animals.delete(deadId);

      const killerId = animal.lastHitterId;
      if (!killerId) return;
      const killer = runtime.roomPlayers(roomId).find((p) => p.id === killerId);
      if (!killer) return;

      const cfg = getNewYearPigConfig();
      let score = session.scores.get(killerId) ?? 0;
      if (animal.cursed) {
        score = Math.round(score / 2);
      } else {
        score += pointsFor(cfg, animal.kind);
      }
      session.scores.set(killerId, score);
      const objective = world.scoreboard.getObjective(objectiveId(roomId));
      if (objective) setObjectiveScore(objective, killer, score);
      killer.onScreenDisplay.setActionBar(`§e我的分数: ${score}`);
      updateHud(runtime, roomId, session);
      runtime.dbg(
        `玩家 ${killer.name} 击杀 ${animal.kind}${animal.cursed ? "(-50%)" : ""},分数 -> ${score}`,
      );
      return;
    }
  });

  // 伤害控制:禁止玩家互伤;记录动物最后一击者;猪/牛受惊
  world.beforeEvents.entityHurt.subscribe((event) => {
    const victim = event.hurtEntity;
    const runtime = getRuntime();
    const roomId = runtime.roomIdFromDimension(victim.dimension.id);
    if (roomId === undefined) return;
    const session = sessions.get(roomId);
    if (!session || session.finished) return;

    const attacker = event.damageSource?.damagingEntity;
    if (
      attacker &&
      attacker.typeId === "minecraft:player" &&
      victim.typeId === "minecraft:player"
    ) {
      event.cancel = true;
      return;
    }

    const animal = session.animals.get(victim.id);
    if (!animal) return;

    // 保留原版攻击:不取消伤害,让动物正常受伤、触发原版受惊;
    // 通过木剑伤害 + 预设血量保证鸡 1 击 / 猪牛 2 击。
    if (attacker && attacker.typeId === "minecraft:player") {
      animal.lastHitterId = attacker.id;
      if (
        animal.kind === "pig" ||
        animal.kind === "sheep" ||
        animal.kind === "cow"
      ) {
        const cfg = getNewYearPigConfig();
        animal.panicUntilTick =
          cfg.fleeSeconds === 0
            ? Infinity
            : system.currentTick + cfg.fleeSeconds * 20;
      }
    }
  });

  // 对局主循环
  system.runInterval(() => {
    tickNewYearPig(getRuntime);
  }, 10);
}
