import { world, system, EquipmentSlot, ItemStack, ItemLockMode, MolangVariableMap, GameMode, DisplaySlotId, ObjectiveSortOrder, TextPrimitive } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";

// ============ 常量 ============
const HB = "minecraft:health_boost";
const REGEN = "minecraft:regeneration";
const ABSORPTION = "minecraft:absorption";
const RESISTANCE = "minecraft:resistance";
const STRENGTH = "minecraft:strength";
const SLOWNESS = "minecraft:slowness";
const POISON = "minecraft:poison";
const FATAL_POISON = "minecraft:fatal_poison";
const INSTANT_HEALTH = "minecraft:instant_health";
const INVISIBILITY = "minecraft:invisibility";
const SPEED = "minecraft:speed";

// 负面效果：官方文档提示 effectAdd 的 effectType 会按服务器语言本地化（如中文服返回“中毒”），
// 所以同时匹配英文 ID / 英文短名 / 中文名，避免免疫拦截失效。
const NEGATIVE_EFFECT_IDS = [
  "slowness",
  "poison",
  "fatal_poison",
  "weakness",
  "blindness",
  "nausea",
  "hunger",
  "wither",
  "mining_fatigue",
  "darkness",
  "levitation"
];
const NEGATIVE_EFFECTS = NEGATIVE_EFFECT_IDS.map((id) => "minecraft:" + id);
const NEGATIVE_EFFECT_NAMES = new Set([
  "缓慢", "中毒", "致命中毒", "虚弱", "失明", "反胃", "饥饿", "凋零", "挖掘疲劳", "黑暗", "漂浮",
  "slowness", "poison", "fatal poison", "weakness", "blindness", "nausea", "hunger",
  "wither", "mining fatigue", "darkness", "levitation",
  "effect.slowness", "effect.poison", "effect.fatal_poison", "effect.weakness",
  "effect.blindness", "effect.nausea", "effect.hunger", "effect.wither",
  "effect.mining_fatigue", "effect.darkness", "effect.levitation"
]);

function isNegativeEffect(typeIdOrName) {
  if (!typeIdOrName) return false;
  const s = String(typeIdOrName).toLowerCase().replace(/^minecraft:/, "");
  if (NEGATIVE_EFFECT_IDS.indexOf(s) !== -1) return true;
  return NEGATIVE_EFFECT_NAMES.has(String(typeIdOrName).toLowerCase());
}

const SCHOOLS = [
  { id: "jiemie", name: "输出丨击灭学派", weapon: "jimie:halberd", skill1: "jimie:charge", skill2: "jimie:heal" },
  { id: "fuzu", name: "控制丨缚阻学派", weapon: "jimie:wand_bind", skill1: "jimie:slow_field", skill2: "jimie:poison_field" },
  { id: "life", name: "治疗丨生命学派", weapon: "jimie:wand_life", skill1: "jimie:same_boat", skill2: "jimie:bless" },
  { id: "speed", name: "游走丨疾行学派", weapon: "jimie:longsword", skill1: "jimie:dash", skill2: "jimie:stealth" }
];

const TOMES = [
  { id: "buddha", name: "禅师丨布德宗圣典", item: "jimie:tome_buddha" },
  { id: "priest", name: "司铎丨卡鲁教廷圣典", item: "jimie:tome_priest" },
  { id: "knight", name: "骑士丨“南十字”法典", item: "jimie:tome_knight" },
  { id: "doctor", name: "医师丨塔莫琳秘典", item: "jimie:tome_doctor" },
  { id: "summoner", name: "召唤师丨芙希秘典", item: "jimie:tome_summoner" },
  { id: "blade", name: "魔剑士丨阿玛拉加秘典", item: "jimie:tome_blade" },
  { id: "herbalist", name: "药师丨茶雅秘典", item: "jimie:tome_herbalist" },
  { id: "prophet", name: "预言家丨普林西斯秘典", item: "jimie:tome_prophet" },
  { id: "formation", name: "阵法师丨佩莉秘典", item: "jimie:tome_formation" }
];

const RED_TAG = "jimie_red";
const BLUE_TAG = "jimie_blue";

// 脚本侧冷却（秒）：原生物品冷却在当前版本不可靠，这里做强制拦截
const ITEM_CD = {
  "jimie:wand_bind": 0.6,
  "jimie:wand_life": 0.6,
  "jimie:charge": 40,
  "jimie:heal": 50,
  "jimie:slow_field": 55,
  "jimie:poison_field": 60,
  "jimie:same_boat": 50,
  "jimie:bless": 60,
  "jimie:dash": 35,
  "jimie:stealth": 60,
  "jimie:tome_priest": 55,
  "jimie:tome_knight": 45,
  "jimie:tome_doctor": 45,
  "jimie:tome_summoner": 65,
  "jimie:tome_blade": 20,
  "jimie:tome_herbalist": 18,
  "jimie:tome_prophet": 70,
  "jimie:tome_formation": 90
};

// 负载物品固定槽位（快捷栏第 3~7 格；container 索引 0-8）
const LOADOUT_SLOT_WEAPON = 4;   // 第 5 格：武器
const LOADOUT_SLOT_SKILL1 = 2;   // 第 3 格：学派技能 I
const LOADOUT_SLOT_SKILL2 = 3;   // 第 4 格：学派技能 II
const LOADOUT_SLOT_TOME1 = 5;    // 第 6 格：秘典 1
const LOADOUT_SLOT_TOME2 = 6;    // 第 7 格：秘典 2
const RESPAWN_SELECTOR_SLOT = 4; // 复活等待期：选择器固定第 5 格

const SCHOOL_SHORT = { jiemie: "击灭", fuzu: "缚阻", life: "生命", speed: "疾行" };
const TOME_SHORT = {
  buddha: "布德宗", priest: "卡鲁", knight: "南十字", doctor: "塔莫琳",
  summoner: "芙希", blade: "阿玛拉加", herbalist: "茶雅",
  prophet: "普林西斯", formation: "佩莉"
};
const ITEM_SHORT = {
  "jimie:charge": "突进", "jimie:heal": "战愈",
  "jimie:slow_field": "迟滞", "jimie:poison_field": "瘴阵",
  "jimie:same_boat": "同舟", "jimie:bless": "祝福",
  "jimie:dash": "掠影", "jimie:stealth": "隐袭",
  "jimie:wand_bind": "缚杖", "jimie:wand_life": "愈杖",
  "jimie:tome_priest": "卡鲁", "jimie:tome_knight": "南十字",
  "jimie:tome_doctor": "塔莫琳", "jimie:tome_summoner": "芙希",
  "jimie:tome_blade": "阿玛拉加", "jimie:tome_herbalist": "茶雅",
  "jimie:tome_prophet": "普林西斯", "jimie:tome_formation": "佩莉"
};

// 名牌状态显示：效果 typeId -> 中文名（生命提升单独处理，按 *4 为基准换算）
const EFFECT_NAMES = {
  "minecraft:regeneration": "恢复",
  "minecraft:absorption": "吸收",
  "minecraft:resistance": "抗性",
  "minecraft:strength": "力量",
  "minecraft:slowness": "缓慢",
  "minecraft:poison": "中毒",
  "minecraft:fatal_poison": "致命中毒",
  "minecraft:invisibility": "隐身",
  "minecraft:speed": "速度",
  "minecraft:weakness": "虚弱",
  "minecraft:blindness": "失明",
  "minecraft:nausea": "反胃",
  "minecraft:hunger": "饥饿",
  "minecraft:wither": "凋零",
  "minecraft:mining_fatigue": "挖掘疲劳",
  "minecraft:darkness": "黑暗",
  "minecraft:levitation": "漂浮",
  "minecraft:jump_boost": "跳跃提升",
  "minecraft:fire_resistance": "抗火",
  "minecraft:water_breathing": "水下呼吸",
  "minecraft:night_vision": "夜视"
};
const EFFECT_SKIP = new Set(["minecraft:instant_health", "minecraft:instant_damage"]);
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

// ============ 夺点玩法常量 ============
const CAPTURE_RADIUS = 17;
const ZONE_HALF_HEIGHT = 20;
const NEUTRAL_CAPTURE_TICKS = 400;  // 20s：中立点占领
const OWNED_TAKEOVER_TICKS = 800;   // 40s：已占点被敌方接管
const GAME_DURATION_TICKS = 24000;  // 20 分钟
const WIN_SCORE = 2000;
const DEATH_WAIT_TICKS = 240;       // 12s 等待复活
const KILL_SCORE = 5;
const SCORE_PER_NODE = [0, 1, 2, 4, 8, 16];
const SPECTATOR_TAG = "jimie_spectator";
const NODES = [
  { id: "base_red", name: "红方大本营", x: 0, z: 100, isBase: true },
  { id: "base_blue", name: "蓝方大本营", x: 0, z: -100, isBase: true },
  { id: "node_center", name: "中心点", x: 0, z: 0 },
  { id: "node_ne", name: "东北点", x: 87, z: 50 },
  { id: "node_nw", name: "西北点", x: -87, z: 50 },
  { id: "node_se", name: "东南点", x: 87, z: -50 },
  { id: "node_sw", name: "西南点", x: -87, z: -50 }
];

// ============ 运行时状态 ============
const blessBoostUntil = new Map(); // playerId -> tick
const immuneUntil = new Map();      // playerId -> tick
const lastImmuneLog = new Map();    // playerId -> tick（免疫兜底日志节流）
const lastWolfBiteLog = new Map();  // playerId -> tick（狗咬伤日志节流）
const fallImmuneUntil = new Map();  // playerId -> tick
const totemState = new Map();       // playerId -> { had }
const indicators = new Map();       // entityId -> indicator 数据
const peiliIndicators = new Map();  // ownerId -> entityId
const prophets = new Map();         // indicatorId -> Map(enemyId -> markerId)
const wolves = new Map();           // wolfId -> { ownerId, expireTick }
const lastUse = new Map();          // playerId -> { tick, id } 防止 itemUse/itemUseOn 重复触发
const cooldownUntil = new Map();    // playerId:itemId -> tick（脚本侧冷却）
const recentHurtBy = new Map();     // victimId -> attackerId（法杖无伤害来源时的击杀归属）
const formOpen = new Set();         // 同一时间每个玩家只允许一个弹窗
const formGen = new Map();          // 弹窗代际，重置/切换后旧弹窗结果作废
const formOpenSince = new Map();    // playerId -> 弹窗打开时的 tick（看门狗用）
const selectionWait = new Map();    // playerId -> 首次发现未选择时的 tick（超时自动默认配置）

// 夺点玩法状态
const gameState = {
  active: false,
  startTick: 0,
  endTick: 0,
  score: { [RED_TAG]: 0, [BLUE_TAG]: 0 },
  scoreAccum: { [RED_TAG]: 0, [BLUE_TAG]: 0 },
  nodes: []
};
const deathState = new Map();       // playerId -> { untilTick, selectedNodeId }
const sidebarIdentities = new Map(); // 行名 -> ScoreboardIdentity（复用身份，避免每次 setScore 新建假玩家）
const lastSidebarNodeState = new Map(); // nodeId -> 上次行名（状态变化时重建侧边栏，清除旧行）
const nodeTextShapes = new Map();   // nodeId -> TextPrimitive（点位上方浮空字）
const playerLabels = new Map();     // playerId -> { text }（队友名牌 TextPrimitive）
const dogLabels = new Map();        // wolfId -> { text }（芙希狗名牌 TextPrimitive）

function bumpFormGen(p) {
  formGen.set(p.id, (formGen.get(p.id) || 0) + 1);
}

// ============ 基础工具 ============
function teamOf(entity) {
  if (!entity) return "";
  if (entity.hasTag(RED_TAG)) return RED_TAG;
  if (entity.hasTag(BLUE_TAG)) return BLUE_TAG;
  return "";
}

function isEnemy(a, b) {
  const ta = teamOf(a), tb = teamOf(b);
  return ta !== "" && tb !== "" && ta !== tb;
}

function isFriendly(a, b) {
  const ta = teamOf(a), tb = teamOf(b);
  return ta !== "" && ta === tb;
}

function isEnemyByTeam(entity, team) {
  const t = teamOf(entity);
  return team !== "" && t !== "" && t !== team;
}

// 是否是芙希召唤的狗（自定义旧版 + 原版 minecraft:wolf 带 jimie_owner 标记）
function isOurWolf(e) {
  if (!e) return false;
  if (e.typeId.indexOf("jimie:fuxi_wolf") === 0) return true;
  return e.typeId === "minecraft:wolf" && e.getDynamicProperty("jimie_owner") !== undefined;
}

function parseVec(s) {
  const parts = String(s).split(",");
  if (parts.length < 3) return { x: 0, y: 0, z: 0 };
  return { x: Number(parts[0]), y: Number(parts[1]), z: Number(parts[2]) };
}

function vecKey(v) {
  return v.x + "," + v.y + "," + v.z;
}

function nearPoint(entity, p) {
  const pts = [entity.location, { x: entity.location.x, y: entity.location.y + 1.2, z: entity.location.z }];
  for (const q of pts) {
    const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
    if (dx * dx + dy * dy + dz * dz < 1.0) return true;
  }
  return false;
}

// 指示物放置用的目标吸附：1 格内即吸附（恢复原判定；方块落点仍用引擎精确射线）
function nearPointStrict(entity, p) {
  const pts = [entity.location, { x: entity.location.x, y: entity.location.y + 1.0, z: entity.location.z }];
  for (const q of pts) {
    const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
    if (dx * dx + dy * dy + dz * dz < 1.0) return true;
  }
  return false;
}

// 引擎精确射线：返回准星与方块面的精确世界坐标交点
function preciseBlockPoint(dim, origin, dir, maxDist) {
  try {
    const hit = dim.getBlockFromRay(origin, dir, { maxDistance: maxDist });
    if (hit && hit.faceLocation) {
      const b = hit.block;
      return {
        x: b.location.x + hit.faceLocation.x,
        y: b.location.y + hit.faceLocation.y,
        z: b.location.z + hit.faceLocation.z
      };
    }
  } catch (e) {}
  return undefined;
}

function playersInCylinder(center, radius, halfHeight, filter) {
  return world.getAllPlayers().filter((p) => {
    if (p.dimension.id !== center.dim) return false;
    const dx = p.location.x - center.x;
    const dy = p.location.y - center.y;
    const dz = p.location.z - center.z;
    if (dx * dx + dz * dz > radius * radius) return false;
    if (Math.abs(dy) > halfHeight) return false;
    return !filter || filter(p);
  });
}

// 范围内的敌方狗（按主人队伍判定，友方狗不计入）
function enemyWolvesInCylinder(center, radius, halfHeight, team) {
  const out = [];
  try {
    const dim = world.getDimension(center.dim);
    for (const typeId of ["jimie:fuxi_wolf_red", "jimie:fuxi_wolf_blue"]) {
      const list = dim.getEntities({ type: typeId });
      for (const w of list) {
        if (!w.isValid) continue;
        const oid = w.getDynamicProperty("jimie_owner");
        if (!oid) continue;
        const owner = world.getAllPlayers().find((q) => q.id === oid);
        if (!owner || !isEnemyByTeam(owner, team)) continue;
        const dx = w.location.x - center.x;
        const dy = w.location.y - center.y;
        const dz = w.location.z - center.z;
        if (dx * dx + dz * dz > radius * radius) continue;
        if (Math.abs(dy) > halfHeight) continue;
        out.push(w);
      }
    }
  } catch (e) {}
  return out;
}

function rayToBlock(player, maxDist) {
  const dim = player.dimension;
  const origin = player.getHeadLocation();
  const dir = player.getViewDirection();
  const h = dim.heightRange;
  const step = 0.25;
  let lastAir = { x: origin.x, y: origin.y, z: origin.z };
  for (let d = step; d <= maxDist; d += step) {
    const p = { x: origin.x + dir.x * d, y: origin.y + dir.y * d, z: origin.z + dir.z * d };
    const by = Math.floor(p.y);
    if (by < h.min || by >= h.max) return { hit: p, lastAir: lastAir };
    const b = dim.getBlock({ x: Math.floor(p.x), y: by, z: Math.floor(p.z) });
    if (b && b.isSolid) return { hit: p, lastAir: lastAir };
    lastAir = p;
  }
  return undefined;
}

function rayToBlockOrEnemy(player, maxDist) {
  const dim = player.dimension;
  const origin = player.getHeadLocation();
  const dir = player.getViewDirection();
  const h = dim.heightRange;
  const blockPoint = preciseBlockPoint(dim, origin, dir, maxDist);
  const enemies = world.getAllPlayers().filter((e) => isEnemy(player, e) && e.dimension.id === dim.id);
  const step = 0.25;
  let lastAir = { x: origin.x, y: origin.y, z: origin.z };
  for (let d = step; d <= maxDist; d += step) {
    const p = { x: origin.x + dir.x * d, y: origin.y + dir.y * d, z: origin.z + dir.z * d };
    const by = Math.floor(p.y);
    if (by < h.min || by >= h.max) return { hit: "block", point: blockPoint || lastAir, lastAir: blockPoint || lastAir };
    for (const e of enemies) {
      if (nearPointStrict(e, p)) {
        return { hit: "enemy", point: { x: e.location.x, y: e.location.y, z: e.location.z }, lastAir: p };
      }
    }
    const b = dim.getBlock({ x: Math.floor(p.x), y: by, z: Math.floor(p.z) });
    if (b && b.isSolid) return { hit: "block", point: blockPoint || lastAir, lastAir: blockPoint || lastAir };
    lastAir = p;
  }
  return blockPoint ? { hit: "block", point: blockPoint, lastAir: blockPoint } : undefined;
}

function rayToBlockOrFriendly(player, maxDist) {
  const dim = player.dimension;
  const origin = player.getHeadLocation();
  const dir = player.getViewDirection();
  const h = dim.heightRange;
  const blockPoint = preciseBlockPoint(dim, origin, dir, maxDist);
  const friends = world.getAllPlayers().filter((e) => e.id !== player.id && isFriendly(player, e) && e.dimension.id === dim.id);
  const step = 0.25;
  let lastAir = { x: origin.x, y: origin.y, z: origin.z };
  for (let d = step; d <= maxDist; d += step) {
    const p = { x: origin.x + dir.x * d, y: origin.y + dir.y * d, z: origin.z + dir.z * d };
    const by = Math.floor(p.y);
    if (by < h.min || by >= h.max) return { hit: "block", point: blockPoint || lastAir, lastAir: blockPoint || lastAir };
    for (const e of friends) {
      if (nearPointStrict(e, p)) {
        return { hit: "friendly", point: { x: e.location.x, y: e.location.y, z: e.location.z }, lastAir: p };
      }
    }
    const b = dim.getBlock({ x: Math.floor(p.x), y: by, z: Math.floor(p.z) });
    if (b && b.isSolid) return { hit: "block", point: blockPoint || lastAir, lastAir: blockPoint || lastAir };
    lastAir = p;
  }
  return blockPoint ? { hit: "block", point: blockPoint, lastAir: blockPoint } : undefined;
}

function findSafeTeleport(dim, pos) {
  const h = dim.heightRange;
  for (let i = 0; i < 8; i++) {
    const y = pos.y + i;
    if (y < h.min || y + 1 > h.max) break;
    const f = dim.getBlock({ x: Math.floor(pos.x), y: Math.floor(y), z: Math.floor(pos.z) });
    const hd = dim.getBlock({ x: Math.floor(pos.x), y: Math.floor(y + 1), z: Math.floor(pos.z) });
    if ((!f || !f.isSolid) && (!hd || !hd.isSolid)) return { x: pos.x, y: y, z: pos.z };
  }
  return pos;
}

function blockedAt(dim, pos) {
  const h = dim.heightRange;
  if (pos.y < h.min || pos.y + 1 > h.max) return true;
  const b1 = dim.getBlock({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) });
  const b2 = dim.getBlock({ x: Math.floor(pos.x), y: Math.floor(pos.y + 1), z: Math.floor(pos.z) });
  return (b1 && b1.isSolid) || (b2 && b2.isSolid);
}

function spawnBurst(dim, loc, particle) {
  for (let i = 0; i < 8; i++) {
    dim.spawnParticle(particle, {
      x: loc.x + (Math.random() - 0.5) * 1.5,
      y: loc.y + Math.random() * 1.5,
      z: loc.z + (Math.random() - 0.5) * 1.5
    });
  }
}

function beamParticles(dim, center, color, height) {
  try {
    const mv = new MolangVariableMap();
    mv.setColorRGB("variable.color", color);
    for (let y = 0; y <= height; y += 2) {
      dim.spawnParticle("minecraft:colored_flame_particle", {
        x: center.x + (Math.random() - 0.5) * 0.5,
        y: center.y + y,
        z: center.z + (Math.random() - 0.5) * 0.5
      }, mv);
    }
  } catch (e) {}
}

function drawIndicatorRing(dim, center, radius, color) {
  try {
    const mv = new MolangVariableMap();
    mv.setColorRGB("variable.color", color);
    const segments = Math.max(16, Math.floor(radius * 5));
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const px = center.x + Math.cos(a) * radius;
      const pz = center.z + Math.sin(a) * radius;
      dim.spawnParticle("minecraft:colored_flame_particle", {
        x: px,
        y: center.y + 1.5,
        z: pz
      }, mv);
    }
  } catch (e) {}
}

function spawnRingBurst(dim, center, radius, color, frames) {
  const n = frames || 3;
  for (let i = 0; i < n; i++) {
    system.runTimeout(() => {
      try { drawIndicatorRing(dim, center, radius, color); } catch (e) {}
    }, i * 2);
  }
}

function nodeColor(node) {
  if (node.owner === RED_TAG) return { red: 1.0, green: 0.25, blue: 0.25 };
  if (node.owner === BLUE_TAG) return { red: 0.25, green: 0.65, blue: 1.0 };
  return { red: 0.85, green: 0.85, blue: 0.85 };
}

function drawNodeRings() {
  if (!gameState.active || gameState.nodes.length === 0) return;
  try {
    const dim = world.getDimension("overworld");
    for (const node of gameState.nodes) {
      drawIndicatorRing(dim, { x: node.x, y: -53.5, z: node.z }, CAPTURE_RADIUS, nodeColor(node));
    }
  } catch (e) {}
}

function nodeSidebarName(node) {
  if (node.owner === "neutral") {
    if (node.progress > 0) return node.name + "·§c红占";
    if (node.progress < 0) return node.name + "·§b蓝占";
    return node.name + "·§7中立";
  }
  let name = node.name + "·" + (node.owner === RED_TAG ? "§4红方" : "§9蓝方");
  if (node.progress > 0) name += "·" + (node.owner === RED_TAG ? "§b蓝攻" : "§c红攻");
  if (node.paused) name += "·§7锁";
  return name;
}

function nodeFloatText(node) {
  let txt = node.name;
  if (node.owner === "neutral") {
    txt += " §7中立";
    if (node.progress > 0) txt += " §c红占 " + (node.progress / 20).toFixed(2) + "s/20s";
    else if (node.progress < 0) txt += " §b蓝占 " + (-node.progress / 20).toFixed(2) + "s/20s";
  } else {
    txt += node.owner === RED_TAG ? " §4红方" : " §9蓝方";
    if (node.progress > 0) txt += " §e被攻 " + (node.progress / 20).toFixed(2) + "s/40s";
    if (node.paused) txt += " §c锁定";
  }
  return txt;
}

function ensureNodeTextShapes() {
  if (!world.primitiveShapesManager || typeof TextPrimitive === "undefined") return;
  try {
    const dim = world.getDimension("overworld");
    for (const node of gameState.nodes) {
      if (node.isBase) continue;
      let shape = nodeTextShapes.get(node.id);
      if (!shape) {
        try {
          shape = new TextPrimitive({ x: node.x + 0.5, y: -50, z: node.z + 0.5 }, nodeFloatText(node));
          try { shape.scale = 3.2; } catch (e) {}
          try { shape.backgroundColorOverride = { red: 0, green: 0, blue: 0, alpha: 0.5 }; } catch (e) {}
          try { shape.depthTest = false; } catch (e) {}
          world.primitiveShapesManager.addText(shape, dim);
          nodeTextShapes.set(node.id, shape);
        } catch (e) { continue; }
      } else {
        try { shape.setText(nodeFloatText(node)); } catch (e) {}
      }
    }
  } catch (e) {}
}

function clearNodeTextShapes() {
  for (const shape of nodeTextShapes.values()) {
    try { shape.remove(); } catch (e) {}
  }
  nodeTextShapes.clear();
}

function currentNodeFor(p) {
  for (const node of gameState.nodes) {
    if (node.isBase) continue;
    if (playerInNodeZone(p, node)) return node;
  }
  return undefined;
}

function nodeSpeedText(node) {
  if (node.paused) return "§e进度锁定（双方在场）";
  if (node.owner === "neutral") {
    if (node.progress > 0) {
      const remain = Math.ceil((NEUTRAL_CAPTURE_TICKS - node.progress) / 20);
      return "§c红方占领中 §7固定速度（约 " + remain + " 秒完成）";
    }
    if (node.progress < 0) {
      const remain = Math.ceil((NEUTRAL_CAPTURE_TICKS + node.progress) / 20);
      return "§b蓝方占领中 §7固定速度（约 " + remain + " 秒完成）";
    }
    return "§7中立（等待占领）";
  }
  const ownerText = node.owner === RED_TAG ? "§4红方" : "§9蓝方";
  const enemy = node.owner === RED_TAG ? "§b蓝方" : "§c红方";
  if (node.progress > 0) {
    const remain = Math.ceil((OWNED_TAKEOVER_TICKS - node.progress) / 20);
    return ownerText + " 受 " + enemy + " 攻打 §7固定速度（约 " + remain + " 秒接管）";
  }
  return ownerText + " 已占领";
}

function showNodeSpeedHud(p) {
  try {
    const node = currentNodeFor(p);
    if (node) {
      p.onScreenDisplay.setActionBar(nodeSpeedText(node));
    } else {
      p.onScreenDisplay.setActionBar("");
    }
  } catch (e) {}
}

function setSidebarRow(objective, name, score) {
  try {
    let identity = sidebarIdentities.get(name);
    if (!identity || !identity.isValid) {
      const stripped = name.replace(/§./g, "");
      identity = objective.getParticipants().find((p) => {
        const dn = p.displayName || "";
        return dn === name || dn === stripped;
      });
      if (!identity) {
        objective.setScore(name, 0);
        identity = objective.getParticipants().find((p) => {
          const dn = p.displayName || "";
          return dn === name || dn === stripped;
        });
      }
      if (identity) sidebarIdentities.set(name, identity);
    }
    if (identity) objective.setScore(identity, score);
  } catch (e) {}
}

function ensureGameSidebar() {
  try {
    let objective = world.scoreboard.getObjective("jimie_game");
    if (objective) world.scoreboard.removeObjective(objective);
    objective = world.scoreboard.addObjective("jimie_game", "§6击灭学派·夺点战");
    world.scoreboard.setObjectiveAtDisplaySlot(DisplaySlotId.Sidebar, {
      objective: objective,
      sortOrder: ObjectiveSortOrder.Descending
    });
    sidebarIdentities.clear();
    lastSidebarNodeState.clear();
  } catch (e) {}
}

function rebuildSidebar() {
  try {
    world.scoreboard.clearObjectiveAtDisplaySlot(DisplaySlotId.Sidebar);
  } catch (e) {}
  ensureGameSidebar();
}

function updateGameSidebar() {
  try {
    let needRebuild = false;
    for (const node of gameState.nodes) {
      if (node.isBase) continue;
      if (lastSidebarNodeState.get(node.id) !== nodeSidebarName(node)) {
        needRebuild = true;
        break;
      }
    }
    if (needRebuild) rebuildSidebar();
    const objective = world.scoreboard.getObjective("jimie_game");
    if (!objective) return;
    const remain = Math.max(0, Math.ceil((gameState.endTick - system.currentTick) / 20));
    setSidebarRow(objective, "红队", gameState.score[RED_TAG]);
    setSidebarRow(objective, "蓝队", gameState.score[BLUE_TAG]);
    setSidebarRow(objective, "剩余时间", remain);
    for (const node of gameState.nodes) {
      if (node.isBase) continue; // 侧边栏不显示大本营
      const name = nodeSidebarName(node);
      lastSidebarNodeState.set(node.id, name);
      setSidebarRow(objective, name, Math.round(Math.abs(node.progress) / 20));
    }
  } catch (e) {}
}

function clearGameSidebar() {
  try {
    world.scoreboard.clearObjectiveAtDisplaySlot(DisplaySlotId.Sidebar);
  } catch (e) {}
  try {
    const objective = world.scoreboard.getObjective("jimie_game");
    if (objective) world.scoreboard.removeObjective(objective);
  } catch (e) {}
  sidebarIdentities.clear();
  lastSidebarNodeState.clear();
}

function colorFor(skill) {
  switch (skill) {
    case "slow": return { red: 0.35, green: 0.7, blue: 1.0 };
    case "poison_field": return { red: 0.75, green: 0.2, blue: 0.9 };
    case "herbalist": return { red: 0.35, green: 0.9, blue: 0.35 };
    case "prophet": return { red: 1.0, green: 0.85, blue: 0.2 };
    default: return { red: 0.9, green: 0.9, blue: 0.9 };
  }
}

function removeNegatives(p) {
  for (const ef of NEGATIVE_EFFECTS) {
    try { p.removeEffect(ef); } catch (e) {}
  }
  // 兜底：按实际挂着的效果逐个清理（typeId 一定是标准 ID，不受语言影响）
  try {
    for (const ef of (p.getEffects() || [])) {
      const tid = String(ef.typeId || "").toLowerCase().replace(/^minecraft:/, "");
      if (NEGATIVE_EFFECT_IDS.indexOf(tid) !== -1) {
        try { p.removeEffect(ef.typeId); } catch (e) {}
      }
    }
  } catch (e) {}
}

function hasItem(container, typeId) {
  for (let i = 0; i < container.size; i++) {
    const it = container.getItem(i);
    if (it && it.typeId === typeId) return true;
  }
  return false;
}

function loadoutStack(typeId, lockMode) {
  const stack = new ItemStack(typeId);
  try { stack.keepOnDeath = true; } catch (e) {}
  try { stack.lockMode = lockMode || ItemLockMode.inventory; } catch (e) {}
  return stack;
}

function markKeepOnDeath(player) {
  const inv = player.getComponent("minecraft:inventory");
  if (!inv) return;
  const c = inv.container;
  for (let i = 0; i < c.size; i++) {
    const it = c.getItem(i);
    if (it && it.typeId.indexOf("jimie:") === 0) {
      const slot = c.getSlot(i);
      try { slot.keepOnDeath = true; } catch (e) {}
    }
  }
}

function clearJimieItems(p) {
  try {
    const inv = p.getComponent("minecraft:inventory");
    if (inv) {
      const c = inv.container;
      for (let i = c.size - 1; i >= 0; i--) {
        const it = c.getItem(i);
        if (it && it.typeId.indexOf("jimie:") === 0) {
          try { c.getSlot(i).lockMode = ItemLockMode.none; } catch (e) {}
          try { c.setItem(i, undefined); } catch (e) {}
        }
      }
    }
  } catch (e) {}
  try {
    const eq = p.getComponent("minecraft:equippable");
    if (eq) {
      const off = eq.getEquipment(EquipmentSlot.Offhand);
      if (off && off.typeId.indexOf("jimie:") === 0) {
        try { eq.getEquipmentSlot(EquipmentSlot.Offhand).lockMode = ItemLockMode.none; } catch (e) {}
        try { eq.setEquipment(EquipmentSlot.Offhand, undefined); } catch (e) {}
      }
      const main = eq.getEquipment(EquipmentSlot.Mainhand);
      if (main && main.typeId.indexOf("jimie:") === 0) {
        try { eq.getEquipmentSlot(EquipmentSlot.Mainhand).lockMode = ItemLockMode.none; } catch (e) {}
        try { eq.setEquipment(EquipmentSlot.Mainhand, undefined); } catch (e) {}
      }
    }
  } catch (e) {}
}

// 幽灵等待期间移除副手/主手的不死图腾，避免隐身时被看到手持图腾暴露位置
function stripGhostTotem(p) {
  try {
    const eq = p.getComponent("minecraft:equippable");
    if (!eq) return;
    for (const slot of [EquipmentSlot.Offhand, EquipmentSlot.Mainhand]) {
      try {
        const it = eq.getEquipment(slot);
        if (it && it.typeId === "minecraft:totem_of_undying") {
          try { eq.getEquipmentSlot(slot).lockMode = ItemLockMode.none; } catch (e2) {}
          try { eq.setEquipment(slot, undefined); } catch (e2) {}
        }
      } catch (e2) {}
    }
  } catch (e) {}
}

function clearProperties(p) {
  try { p.setDynamicProperty("jimie_school", null); } catch (e) {}
  try { p.setDynamicProperty("jimie_tome1", null); } catch (e) {}
  try { p.setDynamicProperty("jimie_tome2", null); } catch (e) {}
  try { p.setDynamicProperty("jimie_totem_remain", null); } catch (e) {}
}

function resetRuntimeState(p) {
  totemState.delete(p.id);
  for (const key of [...cooldownUntil.keys()]) {
    if (key.startsWith(p.id + ":")) cooldownUntil.delete(key);
  }
  formOpen.delete(p.id);
  formOpenSince.delete(p.id);
  bumpFormGen(p);
  selectionWait.delete(p.id);
  blessBoostUntil.delete(p.id);
  immuneUntil.delete(p.id);
  fallImmuneUntil.delete(p.id);
  const peiliId = peiliIndicators.get(p.id);
  if (peiliId) {
    const pe = world.getEntity(peiliId);
    if (pe && pe.isValid) {
      try { pe.remove(); } catch (e) { try { pe.kill(); } catch (e2) {} }
    }
    peiliIndicators.delete(p.id);
  }
  for (const [wid, w] of [...wolves]) {
    if (w.ownerId === p.id) {
      const wolf = world.getEntity(wid);
      if (wolf && wolf.isValid) { try { wolf.kill(); } catch (e) {} }
      wolves.delete(wid);
    }
  }
}

function clearPlayerState(p) {
  clearProperties(p);
  resetRuntimeState(p);
  clearPlayerLabel(p);
  try { p.removeTag(RED_TAG); } catch (e) {}
  try { p.removeTag(BLUE_TAG); } catch (e) {}
}

function applyConfig(p, schoolId, tomeIds, teamArg) {
  const school = SCHOOLS.find((s) => s.id === schoolId);
  if (!school) return false;
  const books = tomeIds.map((id) => TOMES.find((t) => t.id === id)).filter(Boolean);
  if (books.length !== 2) return false;
  clearJimieItems(p);
  clearPlayerState(p);
  try {
    p.setDynamicProperty("jimie_school", school.id);
    p.setDynamicProperty("jimie_tome1", books[0].id);
    p.setDynamicProperty("jimie_tome2", books[1].id);
  } catch (e) { return false; }
  if (teamArg) {
    try { changeTeamOnly(p, teamArg); } catch (e) {}
  }
  try { ensureLoadout(p); } catch (e) {}
  try { p.sendMessage("§a配置已应用：" + school.name + " + " + books[0].name + " + " + books[1].name); } catch (e) {}
  return true;
}

function changeSchoolOnly(p, schoolId) {
  const school = SCHOOLS.find((s) => s.id === schoolId);
  if (!school) return false;
  clearJimieItems(p);
  resetRuntimeState(p);
  try { p.setDynamicProperty("jimie_school", school.id); } catch (e) { return false; }
  try { ensureLoadout(p); } catch (e) {}
  try { p.sendMessage("§a学派已改为：" + school.name); } catch (e) {}
  return true;
}

function changeTomesOnly(p, tomeIds) {
  const books = tomeIds.map((id) => TOMES.find((t) => t.id === id)).filter(Boolean);
  if (books.length !== 2) return false;
  clearJimieItems(p);
  resetRuntimeState(p);
  try {
    p.setDynamicProperty("jimie_tome1", books[0].id);
    p.setDynamicProperty("jimie_tome2", books[1].id);
  } catch (e) { return false; }
  try { ensureLoadout(p); } catch (e) {}
  try { p.sendMessage("§a圣典已改为：" + books[0].name + " + " + books[1].name); } catch (e) {}
  return true;
}

function changeTeamOnly(p, teamArg) {
  const t = String(teamArg || "").trim().toLowerCase();
  if (t === "red" || t === "红") { setTeam(p, RED_TAG); return true; }
  if (t === "blue" || t === "蓝") { setTeam(p, BLUE_TAG); return true; }
  if (t === "auto" || t === "自动") { assignTeam(p); return true; }
  return false;
}

function resetSelection(p) {
  clearJimieItems(p);
  clearPlayerState(p);
  try { p.sendMessage("§e配置已重置，请重新选择队伍、学派与圣典"); } catch (e) {}
  try { startSelection(p); } catch (e) {}
}

// ============ 队伍（占位方案） ============
function applyTeamVisual(p) {
  try {
    const team = teamOf(p);
    if (world.primitiveShapesManager && typeof TextPrimitive !== "undefined") {
      // 原版头顶名牌隐藏，改用 TextPrimitive 队友名牌（仅友方可见）
      p.nameTag = "";
    } else if (team === RED_TAG) p.nameTag = "§c" + p.name;
    else if (team === BLUE_TAG) p.nameTag = "§b" + p.name;
    else p.nameTag = p.name;
  } catch (e) {}
}

function setTeam(p, tag) {
  p.removeTag(RED_TAG);
  p.removeTag(BLUE_TAG);
  p.addTag(tag);
  applyTeamVisual(p);
  p.sendMessage("§a你已加入" + (tag === RED_TAG ? "红队" : "蓝队"));
}

function assignTeam(p) {
  let r = 0, b = 0;
  for (const q of world.getAllPlayers()) {
    if (q.hasTag(RED_TAG)) r++;
    else if (q.hasTag(BLUE_TAG)) b++;
  }
  p.addTag(r <= b ? RED_TAG : BLUE_TAG);
  applyTeamVisual(p);
  p.sendMessage("§a自动分配：" + (teamOf(p) === RED_TAG ? "红队" : "蓝队"));
}

// ============ 玩家名牌（TextPrimitive：友方恒可见；敌方 35 格内可见，隐身/蹲下隐藏，普林西斯范围内无视隐藏） ============
function effectRoman(amp) {
  const n = Math.max(1, Math.min(12, (Number(amp) || 0) + 1));
  return ROMAN[n] || String(n);
}

// 当前状态列表：药水效果（生命提升 *4 不显示，其他按 *N 显示）+ 脚本侧状态
function statusParts(p) {
  const parts = [];
  const now = system.currentTick;
  let effects = [];
  try { effects = p.getEffects() || []; } catch (e) {}
  for (const ef of effects) {
    let typeId = "";
    let amp = 0;
    let ticks = 0;
    try { typeId = String(ef.typeId || ""); } catch (e) {}
    try { amp = Number(ef.amplifier || 0); } catch (e) {}
    try { ticks = Number(ef.duration || 0); } catch (e) {}
    if (!typeId || EFFECT_SKIP.has(typeId)) continue;
    const sec = Math.max(1, Math.ceil(ticks / 20));
    if (typeId === HB) {
      if (amp === 4) continue; // 生命提升 V（*4）人人都有，不显示
      const rel = amp - 4;     // 以 *4 为基准换算等级
      parts.push("生命提升" + (rel >= 0 ? "+" : "") + rel + " " + sec + "s");
      continue;
    }
    const name = EFFECT_NAMES[typeId];
    if (!name) continue;
    parts.push(name + effectRoman(amp) + " " + sec + "s");
  }
  const iu = immuneUntil.get(p.id) || 0;
  if (now < iu) parts.push("免疫 " + Math.ceil((iu - now) / 20) + "s");
  const fu = fallImmuneUntil.get(p.id) || 0;
  if (now < fu) parts.push("免摔落 " + Math.ceil((fu - now) / 20) + "s");
  const tr = Number(p.getDynamicProperty("jimie_totem_remain") || 0);
  if (tr > 0) parts.push("图腾CD " + Math.ceil(tr) + "s");
  return parts;
}

// 状态行：每行最多约 16 个字符，最多 2 行，避免名牌过宽
function statusLines(p) {
  const parts = statusParts(p);
  if (parts.length === 0) return ["§7状态 §f无"];
  const lines = [];
  let cur = "§7状态 §f";
  for (const part of parts) {
    const add = (cur === "§7状态 §f" ? "" : " ") + part;
    if (cur !== "§7状态 §f" && cur.length + add.length > 16) {
      lines.push(cur);
      cur = "§7状态 §f" + part;
      if (lines.length >= 2) break;
    } else {
      cur += add;
    }
  }
  if (lines.length < 2 && cur !== "§7状态 §f") lines.push(cur);
  return lines.length ? lines : ["§7状态 §f无"];
}

// 名牌血量行：血条（10 格）+ 数值（当前/上限，含生命提升）
function healthText(p) {
  try {
    const hc = p.getComponent("minecraft:health");
    if (!hc) return "§7血量 §f?/?";
    const cur = Math.max(0, Math.round(Number(hc.currentValue) || 0));
    let max = 20;
    try { max = Number(hc.effectiveMax) || 20; } catch (e) {}
    if (!isFinite(max) || max < 20) max = 20;
    const ratio = max > 0 ? cur / max : 0;
    const filled = Math.max(0, Math.min(10, Math.round(ratio * 10)));
    const barColor = ratio > 0.5 ? "§a" : ratio > 0.25 ? "§e" : "§c";
    const bar = barColor + "█".repeat(filled) + "§7" + "░".repeat(10 - filled);
    return "§7血量 " + bar + " §f" + cur + "/" + max;
  } catch (e) {
    return "§7血量 §f?/?";
  }
}

// 是否被普林西斯指示物暴露给 viewer（同队施法者的指示物范围内，无视隐身/蹲下/距离）
function isProphetRevealedTo(p, viewer) {
  try {
    const vTeam = teamOf(viewer);
    if (!vTeam || !p) return false;
    const pdim = p.dimension.id.replace(/^minecraft:/, "");
    const pl = p.location;
    for (const [id, ind] of [...indicators]) {
      if (ind.skill !== "prophet" || ind.team !== vTeam) continue;
      if (!ind.center) continue;
      const cdim = String(ind.center.dim || "").replace(/^minecraft:/, "");
      if (cdim !== pdim) continue;
      const ent = world.getEntity(id);
      if (!ent || !ent.isValid) continue;
      const dx = pl.x - ind.center.x;
      const dy = pl.y - ind.center.y;
      const dz = pl.z - ind.center.z;
      if (dx * dx + dz * dz <= ind.radius * ind.radius && Math.abs(dy) <= 7.5) return true;
    }
  } catch (e) {}
  return false;
}

function labelViewers(p) {
  const t = teamOf(p);
  const viewers = [];
  let sneaking = false;
  let invisible = false;
  try { sneaking = !!p.isSneaking; } catch (e) {}
  try { invisible = !!p.getEffect(INVISIBILITY); } catch (e) {}
  const loc = p.location;
  for (const q of world.getAllPlayers()) {
    if (q.id === p.id) continue; // 本人看不到自己的名牌
    const tq = teamOf(q);
    if (tq !== "" && tq === t) {
      viewers.push(q); // 友方始终可见
      continue;
    }
    if (t !== "" && tq !== "" && tq !== t) {
      // 敌方：普林西斯范围内对所有己方显示，无视隐藏；否则 35 格内且不隐身不蹲下才显示
      if (deathState.has(p.id)) continue; // 幽灵等待期不向敌方暴露
      if (isProphetRevealedTo(p, q)) {
        viewers.push(q);
        continue;
      }
      if (invisible || sneaking) continue;
      const dx = q.location.x - loc.x;
      const dy = q.location.y - loc.y;
      const dz = q.location.z - loc.z;
      if (dx * dx + dy * dy + dz * dz <= 35 * 35) viewers.push(q);
    }
  }
  return viewers;
}

function playerLabelText(p) {
  try {
    const team = teamOf(p);
    const nameColor = team === RED_TAG ? "§c" : team === BLUE_TAG ? "§b" : "§7";
    const school = SCHOOLS.find((s) => s.id === p.getDynamicProperty("jimie_school"));
    const t1 = TOMES.find((t) => t.id === p.getDynamicProperty("jimie_tome1"));
    const t2 = TOMES.find((t) => t.id === p.getDynamicProperty("jimie_tome2"));
    let line2 = "§7未配置";
    if (school) {
      const books = [t1, t2].filter(Boolean).map((t) => TOME_SHORT[t.id] || t.name);
      line2 = "§7" + (SCHOOL_SHORT[school.id] || school.name) + (books.length ? " §7| §f" + books.join("·") : "");
    }
    const active = [];
    if (school) active.push(school.skill1, school.skill2);
    if (t1 && ITEM_CD[t1.item]) active.push(t1.item);
    if (t2 && ITEM_CD[t2.item]) active.push(t2.item);
    const now = system.currentTick;
    const parts = [];
    for (const id of active) {
      const remainTick = (cooldownUntil.get(p.id + ":" + id) || 0) - now;
      if (remainTick <= 0) continue;
      const sec = remainTick / 20;
      const short = ITEM_SHORT[id] || id.split(":").pop();
      parts.push(short + (sec >= 10 ? Math.ceil(sec) + "s" : sec.toFixed(1) + "s"));
    }
    const lineCd = parts.length ? "§7CD §f" + parts.join(" ") : "§7CD §f就绪";
    const lines = [nameColor + p.name, healthText(p), line2, ...statusLines(p), lineCd];
    return lines.join("\n");
  } catch (e) {
    return "§7" + (p ? p.name : "?");
  }
}

function ensurePlayerLabel(p) {
  if (!world.primitiveShapesManager || typeof TextPrimitive === "undefined") return;
  try {
    const viewers = labelViewers(p);
    if (viewers.length === 0) {
      // 没有观众时不创建/移除名牌：空名单 = 全员可见（文档坑）
      clearPlayerLabel(p);
      return;
    }
    let marker = playerLabels.get(p.id);
    if (!marker || !marker.text) {
      const text = new TextPrimitive({ x: 0, y: 2.5, z: 0 }, playerLabelText(p));
      text.attachedTo = p;
      text.visibleTo = viewers;
      try { text.scale = 0.6; } catch (e) {}
      try { text.backgroundColorOverride = { red: 0, green: 0, blue: 0, alpha: 0.4 }; } catch (e) {}
      try { text.depthTest = false; } catch (e) {}
      world.primitiveShapesManager.addText(text, p.dimension);
      try { text.visibleTo = viewers; } catch (e) {}
      playerLabels.set(p.id, { text });
    } else {
      try { marker.text.setText(playerLabelText(p)); } catch (e) {}
      try { marker.text.visibleTo = viewers; } catch (e) {}
    }
  } catch (e) {}
}

function clearPlayerLabel(p) {
  const marker = playerLabels.get(p.id);
  if (marker && marker.text) {
    try { marker.text.remove(); } catch (e) {}
  }
  playerLabels.delete(p.id);
}

function tickPlayerLabels() {
  for (const [pid, marker] of [...playerLabels]) {
    const p = world.getEntity(pid);
    if (!p || !p.isValid) {
      try { if (marker.text) marker.text.remove(); } catch (e) {}
      playerLabels.delete(pid);
    }
  }
  for (const p of world.getAllPlayers()) {
    ensurePlayerLabel(p);
  }
}

// ============ 芙希狗名牌（与玩家同规则：友方恒可见，敌方 35 格内可见，普林西斯无视隐藏） ============
function dogLabelViewers(wolf) {
  const t = teamOf(wolf);
  const viewers = [];
  let invisible = false;
  try { invisible = !!wolf.getEffect(INVISIBILITY); } catch (e) {}
  const loc = wolf.location;
  for (const q of world.getAllPlayers()) {
    const tq = teamOf(q);
    if (tq !== "" && tq === t) {
      viewers.push(q);
      continue;
    }
    if (t !== "" && tq !== "" && tq !== t) {
      if (isProphetRevealedTo(wolf, q)) {
        viewers.push(q);
        continue;
      }
      if (invisible) continue;
      const dx = q.location.x - loc.x;
      const dy = q.location.y - loc.y;
      const dz = q.location.z - loc.z;
      if (dx * dx + dy * dy + dz * dz <= 35 * 35) viewers.push(q);
    }
  }
  return viewers;
}

function dogLabelText(wolf, w) {
  try {
    const team = teamOf(wolf);
    const nameColor = team === RED_TAG ? "§c" : team === BLUE_TAG ? "§b" : "§7";
    const teamName = team === RED_TAG ? "红队" : team === BLUE_TAG ? "蓝队" : "无队";
    const owner = w.ownerId ? world.getEntity(w.ownerId) : undefined;
    const ownerName = owner && owner.isValid ? owner.name : "未知主人";
    return nameColor + "[" + teamName + "] §f" + ownerName + "的狗\n" + healthText(wolf);
  } catch (e) {
    return "§7狗";
  }
}

function ensureDogLabel(wolf, w) {
  if (!world.primitiveShapesManager || typeof TextPrimitive === "undefined") return;
  try {
    const viewers = dogLabelViewers(wolf);
    if (viewers.length === 0) {
      clearDogLabel(wolf.id);
      return;
    }
    let marker = dogLabels.get(wolf.id);
    if (!marker || !marker.text) {
      const text = new TextPrimitive({ x: 0, y: 1.15, z: 0 }, dogLabelText(wolf, w));
      text.attachedTo = wolf;
      text.visibleTo = viewers;
      try { text.scale = 0.5; } catch (e) {}
      try { text.backgroundColorOverride = { red: 0, green: 0, blue: 0, alpha: 0.4 }; } catch (e) {}
      try { text.depthTest = false; } catch (e) {}
      world.primitiveShapesManager.addText(text, wolf.dimension);
      try { text.visibleTo = viewers; } catch (e) {}
      dogLabels.set(wolf.id, { text });
    } else {
      try { marker.text.setText(dogLabelText(wolf, w)); } catch (e) {}
      try { marker.text.visibleTo = viewers; } catch (e) {}
    }
  } catch (e) {}
}

function clearDogLabel(id) {
  const marker = dogLabels.get(id);
  if (marker && marker.text) {
    try { marker.text.remove(); } catch (e) {}
  }
  dogLabels.delete(id);
}

function tickDogLabels() {
  if (!world.primitiveShapesManager || typeof TextPrimitive === "undefined") return;
  const alive = new Set();
  for (const [id, w] of [...wolves]) {
    const wolf = world.getEntity(id);
    if (!wolf || !wolf.isValid) continue;
    alive.add(id);
    ensureDogLabel(wolf, w);
  }
  for (const [id] of [...dogLabels]) {
    if (!alive.has(id)) clearDogLabel(id);
  }
}

// ============ 全局生命提升 ============
function applyGlobalBoosts(player) {
  try {
    player.addEffect(HB, 40, { amplifier: 4, showParticles: false });
    // 等效果真正计入上限后再回满：同一 tick 立刻读 effectiveMax 可能还是 20，
    // 会把“生命提升 V 的 +10 颗心”留成空血（看起来像半血）。
    system.runTimeout(() => {
      try {
        if (!player.isValid) return;
        const hc = player.getComponent("minecraft:health");
        if (!hc || typeof hc.setCurrentValue !== "function") return;
        let max = 20;
        try { max = hc.effectiveMax !== undefined ? hc.effectiveMax : max; } catch (e) {}
        if (typeof max !== "number" || !isFinite(max) || max < 20) max = 20;
        // 生命提升 V（amplifier 4）= 基础 20 + 20 = 40；把十颗心也算进满血
        if (max < 40) max = 40;
        hc.setCurrentValue(max);
      } catch (e) {}
    }, 2);
  } catch (e) {}
}

// ============ 选择与发放 ============
function startSelection(player) {
  showConfigForm(player);
}

function showConfigForm(player) {
  if (formOpen.has(player.id)) return;
  formOpen.add(player.id);
  formOpenSince.set(player.id, system.currentTick);
  const form = new ModalFormData();
  form.title("击灭学派·初始配置");
  form.dropdown("队伍", ["红队", "蓝队", "自动分配"]);
  form.dropdown("学派", SCHOOLS.map((s) => s.name));
  form.dropdown("圣典/秘典 1", TOMES.map((t) => t.name));
  form.dropdown("圣典/秘典 2", TOMES.map((t) => t.name));
  form.show(player).then((res) => {
    try { console.warn("[jimie] 配置弹窗返回: " + JSON.stringify(res)); } catch (e) {}
    formOpen.delete(player.id);
    formOpenSince.delete(player.id);
    if (res.canceled || !res.formValues || res.formValues.length < 4) {
      try { console.warn("[jimie] 配置弹窗取消或值缺失: " + JSON.stringify(res)); } catch (e) {}
      system.runTimeout(() => {
        if (player.isValid && !player.getDynamicProperty("jimie_school")) showConfigForm(player);
      }, 20);
      return;
    }
    const teamIdx = Number(res.formValues[0]);
    const school = SCHOOLS[Number(res.formValues[1])];
    let b1 = TOMES[Number(res.formValues[2])];
    let b2 = TOMES[Number(res.formValues[3])];
    try { console.warn("[jimie] 解析结果: " + (school ? school.id : "?") + "," + (b1 ? b1.id : "?") + "," + (b2 ? b2.id : "?")); } catch (e) {}
    if (!school || !b1 || !b2) {
      try { player.sendMessage("§c配置读取异常，请重试：" + JSON.stringify(res.formValues)); } catch (e) {}
      return;
    }
    if (b1.id === b2.id) {
      b2 = TOMES[(Number(res.formValues[3]) + 1) % TOMES.length];
      try { player.sendMessage("§e两本圣典相同，第二本已自动改为：" + b2.name); } catch (e) {}
    }
    clearJimieItems(player);
    clearProperties(player);
    resetRuntimeState(player);
    if (teamIdx === 0) setTeam(player, RED_TAG);
    else if (teamIdx === 1) setTeam(player, BLUE_TAG);
    else assignTeam(player);
    try {
      player.setDynamicProperty("jimie_school", school.id);
      player.setDynamicProperty("jimie_tome1", b1.id);
      player.setDynamicProperty("jimie_tome2", b2.id);
    } catch (e) {}
    try { console.warn("[jimie] 属性已设置"); } catch (e) {}
    try { ensureLoadout(player); } catch (e) {}
    try { console.warn("[jimie] 发放流程结束"); } catch (e) {}
    try { player.sendMessage("§a配置完成：" + school.name + " + " + b1.name + " + " + b2.name + "，物品已发放（背包满会自动掉落在脚下）"); } catch (e) {}
  }).catch((err) => {
    try { console.warn("[jimie] 配置弹窗异常: " + String(err && err.message || err)); } catch (e) {}
    formOpen.delete(player.id);
    formOpenSince.delete(player.id);
    system.runTimeout(() => {
      if (player.isValid && !player.getDynamicProperty("jimie_school")) showConfigForm(player);
    }, 20);
  });
}

function showTomeForm(player) {
  if (formOpen.has(player.id)) return;
  formOpen.add(player.id);
  formOpenSince.set(player.id, system.currentTick);
  const form = new ModalFormData();
  form.title("选择两本圣典");
  form.dropdown("圣典/秘典 1", TOMES.map((t) => t.name));
  form.dropdown("圣典/秘典 2", TOMES.map((t) => t.name));
  form.show(player).then((res) => {
    formOpen.delete(player.id);
    formOpenSince.delete(player.id);
    if (res.canceled || !res.formValues || res.formValues.length < 2) {
      system.runTimeout(() => {
        if (player.isValid && !player.getDynamicProperty("jimie_tome1")) showTomeForm(player);
      }, 20);
      return;
    }
    let b1 = TOMES[Number(res.formValues[0])];
    let b2 = TOMES[Number(res.formValues[1])];
    if (!b1 || !b2) return;
    if (b1.id === b2.id) b2 = TOMES[(Number(res.formValues[1]) + 1) % TOMES.length];
    clearJimieItems(player);
    resetRuntimeState(player);
    try {
      player.setDynamicProperty("jimie_tome1", b1.id);
      player.setDynamicProperty("jimie_tome2", b2.id);
    } catch (e) {}
    try { ensureLoadout(player); } catch (e) {}
    try { player.sendMessage("§a圣典已选择：" + b1.name + " + " + b2.name + "，物品已发放"); } catch (e) {}
  }).catch((err) => {
    try { console.warn("[jimie] 圣典弹窗异常: " + String(err && err.message || err)); } catch (e) {}
    formOpen.delete(player.id);
    formOpenSince.delete(player.id);
    system.runTimeout(() => {
      if (player.isValid && !player.getDynamicProperty("jimie_tome1")) showTomeForm(player);
    }, 20);
  });
}

function ensureLoadout(player) {
  const school = SCHOOLS.find((s) => s.id === player.getDynamicProperty("jimie_school"));
  if (!school) return;
  const t1 = TOMES.find((t) => t.id === player.getDynamicProperty("jimie_tome1"));
  const t2 = TOMES.find((t) => t.id === player.getDynamicProperty("jimie_tome2"));
  if (!t1 || !t2) return;
  const entries = [
    { id: school.weapon, slot: LOADOUT_SLOT_WEAPON },
    { id: school.skill1, slot: LOADOUT_SLOT_SKILL1 },
    { id: school.skill2, slot: LOADOUT_SLOT_SKILL2 },
    { id: t1.item, slot: LOADOUT_SLOT_TOME1 },
    { id: t2.item, slot: LOADOUT_SLOT_TOME2 }
  ];
  let container;
  try {
    const inv = player.getComponent("minecraft:inventory");
    container = inv ? inv.container : undefined;
  } catch (e) {
    container = undefined;
  }
  for (const entry of entries) {
    try {
      const cur = container ? container.getItem(entry.slot) : undefined;
      if (cur && cur.typeId === entry.id) {
        // 已在正确槽位：确保槽位锁定与死亡保留
        try { container.getSlot(entry.slot).lockMode = ItemLockMode.slot; } catch (e) {}
        try { container.getSlot(entry.slot).keepOnDeath = true; } catch (e) {}
        continue;
      }
      // 移除背包中其他位置的同 id 物品（旧版可能散落在任意槽位）
      if (container) {
        for (let i = container.size - 1; i >= 0; i--) {
          const it = container.getItem(i);
          if (it && it.typeId === entry.id) {
            try { container.getSlot(i).lockMode = ItemLockMode.none; } catch (e) {}
            try { container.setItem(i, undefined); } catch (e) {}
          }
        }
      }
      const stack = loadoutStack(entry.id, ItemLockMode.slot);
      let rest = stack;
      if (container) {
        try {
          try { container.getSlot(entry.slot).lockMode = ItemLockMode.none; } catch (e) {}
          container.setItem(entry.slot, stack);
          try { container.getSlot(entry.slot).lockMode = ItemLockMode.slot; } catch (e) {}
          try { container.getSlot(entry.slot).keepOnDeath = true; } catch (e) {}
          rest = undefined;
        } catch (e) {}
      }
      if (rest) {
        try { player.dimension.spawnItem(rest, player.location); } catch (e) {}
      }
    } catch (e) {
      try { console.warn("[jimie] 物品发放失败: " + entry.id + " - " + String(e && e.message || e)); } catch (e2) {}
      try { player.sendMessage("§c物品发放失败：" + entry.id + " - " + String(e && e.message || e)); } catch (e2) {}
    }
  }
}

// ============ 射线武器 ============
function wandShot(player, damage, trailParticle, projectileParticle) {
  trailParticle = trailParticle || "minecraft:spell";
  projectileParticle = projectileParticle || "minecraft:endrod";
  const dim = player.dimension;
  const origin = player.getHeadLocation();
  const dir = player.getViewDirection();
  const h = dim.heightRange;
  const enemies = world.getAllPlayers().filter((e) => isEnemy(player, e) && e.dimension.id === dim.id);
  // 敌方狗也可被射线命中（按主人队伍判定；友方狗穿透）
  const enemyWolves = [];
  try {
    for (const typeId of ["jimie:fuxi_wolf_red", "jimie:fuxi_wolf_blue"]) {
      const list = dim.getEntities({ type: typeId });
      for (const w of list) {
        if (!w.isValid) continue;
        const oid = w.getDynamicProperty("jimie_owner");
        if (!oid) continue;
        const owner = world.getAllPlayers().find((q) => q.id === oid);
        if (owner && isEnemy(player, owner)) enemyWolves.push(w);
      }
    }
  } catch (e) {}
  const targets = [...enemies, ...enemyWolves];
  const step = 0.25;
  let lastP = origin;
  let hit = null;
  for (let d = step; d <= 35; d += step) {
    const p = { x: origin.x + dir.x * d, y: origin.y + dir.y * d, z: origin.z + dir.z * d };
    const by = Math.floor(p.y);
    if (by < h.min || by >= h.max) {
      hit = { type: "block", point: lastP };
      break;
    }
    for (const e of targets) {
      if (nearPoint(e, p)) {
        hit = { type: e.typeId === "minecraft:player" ? "player" : "wolf", entity: e, point: p };
        break;
      }
    }
    if (hit) break;
    const b = dim.getBlock({ x: Math.floor(p.x), y: by, z: Math.floor(p.z) });
    if (b && b.isSolid) {
      hit = { type: "block", point: p };
      break;
    }
    lastP = p;
  }
  const end = hit ? hit.point : lastP;
  if (end.y < h.min) end.y = h.min;
  const endDist = Math.min(34, Math.hypot(end.x - origin.x, end.y - origin.y, end.z - origin.z));
  // 静态轨迹线：从己方到命中点每 0.5 格一粒
  for (let k = 0.5; k <= endDist; k += 0.5) {
    const py = origin.y + dir.y * k;
    if (py < h.min || py >= h.max) continue;
    dim.spawnParticle(trailParticle, { x: origin.x + dir.x * k, y: py, z: origin.z + dir.z * k });
  }
  // 飞行子弹：0.3 秒内沿射线从己方飞向命中点
  for (let i = 1; i <= 6; i++) {
    system.runTimeout(() => {
      try {
        if (!player.isValid || player.dimension.id !== dim.id) return;
        const t = i / 6;
        const px = origin.x + (end.x - origin.x) * t;
        const py = origin.y + (end.y - origin.y) * t;
        const pz = origin.z + (end.z - origin.z) * t;
        if (py < h.min || py >= h.max) return;
        dim.spawnParticle(projectileParticle, { x: px, y: py, z: pz });
      } catch (e) {}
    }, i);
  }
  if (hit && hit.type === "player") {
    // 不带 damagingEntity：消除默认攻击击退；击杀归属用 recentHurtBy 记录
    recentHurtBy.set(hit.entity.id, player.id);
    try { hit.entity.applyDamage(damage, { cause: "magic" }); } catch (e) {}
    const dist = Math.hypot(
      hit.entity.location.x - player.location.x,
      hit.entity.location.y - player.location.y,
      hit.entity.location.z - player.location.z
    );
    if (dist <= 5) {
      try {
        const dx = hit.entity.location.x - player.location.x;
        const dz = hit.entity.location.z - player.location.z;
        const len = Math.hypot(dx, dz) || 1;
        hit.entity.applyKnockback({ x: (dx / len) * 0.55, z: (dz / len) * 0.55 }, 0.22);
      } catch (e) {}
    }
    spawnBurst(dim, hit.entity.location, "minecraft:critical_hit");
  } else if (hit && hit.type === "wolf") {
    try { hit.entity.applyDamage(damage, { cause: "magic" }); } catch (e) {}
    const dist = Math.hypot(
      hit.entity.location.x - player.location.x,
      hit.entity.location.y - player.location.y,
      hit.entity.location.z - player.location.z
    );
    if (dist <= 5) {
      try {
        const dx = hit.entity.location.x - player.location.x;
        const dz = hit.entity.location.z - player.location.z;
        const len = Math.hypot(dx, dz) || 1;
        hit.entity.applyKnockback({ x: (dx / len) * 0.55, z: (dz / len) * 0.55 }, 0.22);
      } catch (e) {}
    }
    spawnBurst(dim, hit.entity.location, "minecraft:critical_hit");
  } else {
    spawnBurst(dim, end, "minecraft:endrod");
  }
  dim.playSound("mob.blaze.shoot", end);
}

// ============ 击灭学派 ============
function skillCharge(player) {
  const dim = player.dimension;
  const enemies = world.getAllPlayers().filter((e) => isEnemy(player, e) && e.dimension.id === dim.id);
  const enemyDogs = enemyWolvesInCylinder(
    { x: player.location.x, y: player.location.y, z: player.location.z, dim: dim.id },
    13, 7.5, teamOf(player)
  );
  const candidates = [...enemies, ...enemyDogs];
  const view = player.getViewDirection();
  const vh = Math.hypot(view.x, view.z);
  const hitList = [];
  if (vh > 0.001) {
    const vx = view.x / vh, vz = view.z / vh;
    for (const e of candidates) {
      const dx = e.location.x - player.location.x;
      const dz = e.location.z - player.location.z;
      const dy = e.location.y - player.location.y;
      const distH = Math.hypot(dx, dz);
      if (distH > 13 || Math.abs(dy) > 7.5) continue;
      const dot = (dx * vx + dz * vz) / distH;
      const ang = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
      if (ang <= 20) hitList.push(e);
    }
  }
  for (const e of hitList) {
    try { e.applyDamage(6, { cause: "magic", damagingEntity: player }); } catch (err) {}
  }
  const dest = { x: player.location.x + view.x * 13, y: player.location.y + 3.5, z: player.location.z + view.z * 13 };
  const safe = findSafeTeleport(dim, dest);
  for (const e of [...hitList, player]) {
    try { e.teleport(safe); } catch (err) {}
  }
  fallImmuneUntil.set(player.id, system.currentTick + 60);
  dim.playSound("mob.enderman.teleport", safe);
  for (const e of hitList) spawnBurst(dim, e.location, "minecraft:critical_hit");
  player.sendMessage("§c击灭丨突进：命中 " + hitList.length + " 名敌人");
}

function skillHeal(player) {
  player.addEffect(REGEN, 40, { amplifier: 2 });
  player.addEffect(ABSORPTION, 200, { amplifier: 2 });
  player.dimension.playSound("random.levelup", player.location);
  spawnBurst(player.dimension, player.location, "minecraft:villager_happy");
  player.sendMessage("§a击灭丨战愈：恢复III 2s + 吸收III 10s");
}

// ============ 缚阻学派 ============
function placeField(player, skill, radius, effect, amplifier, durationTicks, name) {
  const t = rayToBlockOrEnemy(player, 35);
  // 35 格内没有目标时不再失败，改为以施法者当前位置为中心释放
  const center = t
    ? { x: t.point.x, y: t.point.y, z: t.point.z, dim: player.dimension.id }
    : { x: player.location.x, y: player.location.y, z: player.location.z, dim: player.dimension.id };
  spawnIndicator(skill, center, radius, effect, amplifier, durationTicks, player);
  player.sendMessage("§a" + name + "：指示物已放置" +
    (t ? (t.hit === "enemy" ? "（命中敌人）" : "") : "（35格内无目标，已以自身为中心释放）"));
}

function skillSlowField(player) {
  placeField(player, "slow", 10, SLOWNESS, 1, 200, "缚阻丨迟滞");
}

function skillPoisonField(player) {
  placeField(player, "poison_field", 10, FATAL_POISON, 1, 300, "缚阻丨瘴阵");
}

// ============ 生命学派 ============
function skillSameBoat(player) {
  const t = rayToBlockOrFriendly(player, 35);
  // 35 格内没有目标时不再失败，改为以施法者当前位置为中心释放
  const center = t
    ? { x: t.point.x, y: t.point.y, z: t.point.z, dim: player.dimension.id }
    : { x: player.location.x, y: player.location.y, z: player.location.z, dim: player.dimension.id };
  const friends = playersInCylinder(center, 7, 7.5, (q) => isFriendly(player, q) && q.id !== player.id);
  for (const f of friends) {
    try { f.addEffect(INSTANT_HEALTH, 1, { amplifier: 1, showParticles: true }); } catch (e) {}
  }
  try { player.applyDamage(6, { cause: "magic", damagingEntity: player }); } catch (e) {}
  player.dimension.playSound("random.levelup", center);
  beamParticles(player.dimension, center, { red: 0.4, green: 1.0, blue: 0.5 }, 6);
  spawnRingBurst(player.dimension, center, 7, { red: 0.4, green: 1.0, blue: 0.5 }, 3);
  player.sendMessage("§a生命丨同舟：队友治疗II，自身受到3颗心伤害" +
    (t ? (t.hit === "friendly" ? "（命中友方）" : "") : "（35格内无目标，已以自身为中心释放）"));
}

function skillBless(player) {
  const t = rayToBlockOrFriendly(player, 35);
  // 35 格内没有目标时不再失败，改为以施法者当前位置为中心释放
  const center = t
    ? { x: t.point.x, y: t.point.y, z: t.point.z, dim: player.dimension.id }
    : { x: player.location.x, y: player.location.y, z: player.location.z, dim: player.dimension.id };
  const targets = playersInCylinder(center, 7, 7.5, (q) => q.id === player.id || isFriendly(player, q));
  const now = system.currentTick;
  for (const f of targets) {
    try {
      f.addEffect(INSTANT_HEALTH, 1, { amplifier: 2, showParticles: true });
      f.addEffect(HB, 300, { amplifier: 7, showParticles: true });
      blessBoostUntil.set(f.id, now + 300);
      immuneUntil.set(f.id, now + 100);
      removeNegatives(f);
    } catch (e) {}
  }
  player.dimension.playSound("random.levelup", center);
  beamParticles(player.dimension, center, { red: 1.0, green: 0.9, blue: 0.4 }, 7);
  spawnRingBurst(player.dimension, center, 7, { red: 1.0, green: 0.9, blue: 0.4 }, 3);
  player.sendMessage("§a生命丨祝福：友方与自己治疗III + 生命提升VIII 15s + 免疫负面5s" +
    (t ? (t.hit === "friendly" ? "（命中友方）" : "") : "（35格内无目标，已以自身为中心释放）"));
}

// ============ 疾行学派 ============
function skillDash(player) {
  const dim = player.dimension;
  const view = player.getViewDirection();
  const vh = Math.hypot(view.x, view.z);
  if (vh < 0.001) return;
  const dir = { x: view.x / vh, z: view.z / vh };
  const path = [];
  let cur = { x: player.location.x, y: player.location.y, z: player.location.z };
  for (let i = 0; i < 20; i++) {
    const next = { x: cur.x + dir.x * 0.5, y: cur.y, z: cur.z + dir.z * 0.5 };
    if (blockedAt(dim, next)) break;
    path.push(next);
    cur = next;
  }
  if (path.length === 0) {
    player.sendMessage("§c前方被阻挡");
    return;
  }
  let idx = 0;
  const runId = system.runInterval(() => {
    if (!player.isValid) {
      system.clearRun(runId);
      return;
    }
    for (let k = 0; k < 2 && idx < path.length; k++, idx++) {
      try { player.teleport(path[idx]); } catch (err) {
        system.clearRun(runId);
        return;
      }
    }
    if (idx >= path.length) system.clearRun(runId);
  }, 1);
  dim.playSound("mob.enderman.teleport", player.location);
  player.sendMessage("§a疾行丨掠影：向前高速位移10格");
}

function skillStealth(player) {
  player.addEffect(INVISIBILITY, 300, { amplifier: 0 });
  player.addEffect(SPEED, 300, { amplifier: 1 });
  player.sendMessage("§a疾行丨隐袭：隐身15s + 速度II 15s");
}

// ============ 圣典/法典/秘典 ============
function tomeBuddhaStatus(player) {
  const remain = Number(player.getDynamicProperty("jimie_totem_remain") || 0);
  const eq = player.getComponent("minecraft:equippable");
  const off = eq ? eq.getEquipment(EquipmentSlot.Offhand) : undefined;
  const has = !!off && off.typeId === "minecraft:totem_of_undying";
  if (has) player.sendMessage("§a不死图腾已就绪");
  else if (remain > 0) player.sendMessage("§6图腾冷却中：" + Math.ceil(remain) + "s");
  else player.sendMessage("§c图腾缺失，冷却结束后将自动补充");
}

function tomePriest(player) {
  immuneUntil.set(player.id, system.currentTick + 160);
  removeNegatives(player);
  player.sendMessage("§a卡鲁教廷圣典：8s内免疫负面状态");
}

function tomeKnight(player) {
  player.addEffect(ABSORPTION, 200, { amplifier: 2 });
  player.addEffect(RESISTANCE, 200, { amplifier: 0 });
  player.sendMessage("§a南十字法典：吸收III + 抗性I 10s");
}

function tomeDoctor(player) {
  player.addEffect(REGEN, 200, { amplifier: 1 });
  player.sendMessage("§a塔莫琳秘典：恢复II 10s");
}

function tomeSummoner(player) {
  const team = teamOf(player);
  const variant = team === RED_TAG ? "jimie:fuxi_wolf_red" : "jimie:fuxi_wolf_blue";
  const now = system.currentTick;
  let spawned = 0;
  try { console.warn("[jimie] 秘典触发 summoner team=" + (team || "无") + " variant=" + variant); } catch (e) {}
  for (let i = 0; i < 2; i++) {
    const raw = { x: player.location.x + (i === 0 ? 0.7 : -0.7), y: player.location.y, z: player.location.z };
    const loc = findSafeTeleport(player.dimension, raw);
    try {
      const wolf = player.dimension.spawnEntity(variant, loc);
      if (!wolf || !wolf.isValid) {
        try { console.warn("[jimie] 狼生成返回无效实体 " + variant); } catch (e2) {}
        continue;
      }
      try { wolf.nameTag = ""; } catch (e) {} // 隐藏原版名牌，只用 TextPrimitive 狗名牌
      const tameable = wolf.getComponent("minecraft:tameable");
      if (tameable && typeof tameable.tame === "function") {
        try {
          const ok = tameable.tame(player);
          try { console.warn("[jimie] 驯服结果 ok=" + ok + " isTamed=" + tameable.isTamed + " ownerId=" + tameable.tamedToPlayerId); } catch (e3) {}
        } catch (e) {
          try { console.warn("[jimie] 驯服异常 " + String(e && e.message || e)); } catch (e3) {}
        }
      }
      try { wolf.triggerEvent("jimie:on_tame"); } catch (e) {}
      // 项圈颜色：红队红(14)、蓝队蓝(11)
      try {
        const cc = wolf.getComponent("minecraft:color");
        if (cc) cc.value = team === RED_TAG ? 14 : 11;
      } catch (e) {}
      wolf.setDynamicProperty("jimie_owner", player.id);
      wolf.setDynamicProperty("jimie_remain", 700);
      if (team === RED_TAG || team === BLUE_TAG) {
        try { wolf.addTag(team); } catch (e) {}
      }
      wolves.set(wolf.id, { ownerId: player.id, expireTick: now + 700, spawnTick: now });
      spawned++;
      try { console.warn("[jimie] 狼召唤 " + variant + " owner=" + player.name + " team=" + (team || "无")); } catch (e) {}
      // 10 tick 后校验驯服是否真正生效；未生效则补触发
      let tameTries = 0;
      const verifyTame = () => {
        try {
          if (!wolf.isValid) return;
          tameTries++;
          const tb = wolf.getComponent("minecraft:tameable");
          const tamed = !!(tb && tb.isTamed);
          if (!tamed) {
            try { wolf.triggerEvent("jimie:on_tame"); } catch (e2) {}
            if (tameTries < 3) system.runTimeout(verifyTame, 10);
          }
          if (tameTries === 1 || tamed) {
            try { console.warn("[jimie] 狼驯服校验 isTamed=" + tamed + " ownerId=" + (tb && tb.tamedToPlayerId)); } catch (e3) {}
          }
        } catch (e2) {}
      };
      system.runTimeout(verifyTame, 10);
    } catch (e) {
      try { console.warn("[jimie] 狼生成失败 " + variant + " err=" + String(e && e.message || e)); } catch (e2) {}
    }
  }
  try { console.warn("[jimie] 狼召唤结束 成功=" + spawned + " 狼总数=" + wolves.size); } catch (e) {}
  player.dimension.playSound("random.levelup", player.location);
  player.sendMessage("§a芙希秘典：召唤两只狗（35s）");
}

function tomeBlade(player) {
  try { player.applyDamage(6, { cause: "magic", damagingEntity: player }); } catch (e) {}
  player.addEffect(POISON, 40, { amplifier: 1 });
  player.addEffect(STRENGTH, 140, { amplifier: 0 });
  player.sendMessage("§a阿玛拉加秘典：自伤3颗心 + 中毒II 2s + 力量I 7s");
}

function tomeHerbalist(player) {
  placeField(player, "herbalist", 5, POISON, 0, 160, "药师丨茶雅秘典");
}

function tomeProphet(player) {
  const t = rayToBlockOrEnemy(player, 35);
  // 35 格内没有目标时不再失败，改为以施法者当前位置为中心释放
  const center = t
    ? { x: t.point.x, y: t.point.y, z: t.point.z, dim: player.dimension.id }
    : { x: player.location.x, y: player.location.y, z: player.location.z, dim: player.dimension.id };
  spawnIndicator("prophet", center, 15, "", 0, 500, player);
  player.sendMessage("§a普林西斯秘典：标记指示物已放置（25s）" +
    (t ? (t.hit === "enemy" ? "（命中敌人）" : "") : "（35格内无目标，已以自身为中心释放）"));
}

function tomeFormation(player) {
  const oldId = peiliIndicators.get(player.id);
  if (oldId) {
    const old = world.getEntity(oldId);
    if (old && old.isValid) {
      try { old.remove(); } catch (e) { try { old.kill(); } catch (e2) {} }
    }
    peiliIndicators.delete(player.id);
  }
  const dim = player.dimension;
  let below;
  try { below = dim.getBlockBelow(player.location); } catch (e) {}
  if (!below) {
    player.sendMessage("§c下方没有可放置的地面");
    return;
  }
  const loc = { x: Math.floor(below.location.x) + 0.5, y: below.location.y + 1.0, z: Math.floor(below.location.z) + 0.5 };
  let ent;
  try {
    ent = dim.spawnEntity("jimie:peili_indicator", loc);
  } catch (e) {
    player.sendMessage("§c阵眼生成失败，请检查行为包是否加载");
    return;
  }
  ent.setDynamicProperty("jimie_owner", player.id);
  ent.setDynamicProperty("jimie_hits", 0);
  peiliIndicators.set(player.id, ent.id);
  dim.playSound("random.orb", loc);
  player.sendMessage("§a佩莉秘典：阵眼已放置");
}

// ============ 指示物 ============
function spawnIndicator(skill, center, radius, effect, amplifier, durationTicks, player) {
  let ent;
  try {
    ent = player.dimension.spawnEntity("jimie:area_indicator", { x: center.x, y: center.y, z: center.z });
  } catch (e) {
    player.sendMessage("§c指示物生成失败，请检查行为包是否加载");
    return;
  }
  ent.setDynamicProperty("jimie_skill", skill);
  ent.setDynamicProperty("jimie_team", teamOf(player));
  ent.setDynamicProperty("jimie_owner", player.id);
  ent.setDynamicProperty("jimie_center", vecKey(center));
  ent.setDynamicProperty("jimie_radius", radius);
  ent.setDynamicProperty("jimie_effect", effect || "");
  ent.setDynamicProperty("jimie_amplifier", amplifier);
  ent.setDynamicProperty("jimie_remain", durationTicks);
  indicators.set(ent.id, {
    skill: skill,
    team: teamOf(player),
    ownerId: player.id,
    center: { x: center.x, y: center.y, z: center.z, dim: player.dimension.id },
    radius: radius,
    effect: effect || "",
    amplifier: amplifier,
    expireTick: system.currentTick + durationTicks
  });
  ent.dimension.playSound("random.orb", ent.location);
}

function tickIndicators() {
  for (const [id, ind] of [...indicators]) {
    const ent = world.getEntity(id);
    if (!ent || !ent.isValid || system.currentTick >= ind.expireTick) {
      if (ent && ent.isValid) {
        try { ent.kill(); } catch (e) {}
      }
      if (ind.skill === "prophet") clearProphetMarks(id);
      indicators.delete(id);
      continue;
    }
    const dim = ent.dimension;
    const center = { x: ind.center.x, y: ind.center.y, z: ind.center.z };
    beamParticles(dim, center, colorFor(ind.skill), ind.skill === "prophet" ? 15 : 8);
    drawIndicatorRing(dim, center, ind.radius, colorFor(ind.skill));
    if (ind.effect) {
      const enemies = playersInCylinder({ ...center, dim: dim.id }, ind.radius, 7.5, (q) => isEnemyByTeam(q, ind.team));
      const enemyDogs = enemyWolvesInCylinder({ ...center, dim: dim.id }, ind.radius, 7.5, ind.team);
      const targets = [...enemies, ...enemyDogs];
      for (const e of targets) {
        // 免疫窗口内：负面效果直接从源头跳过，不施加
        const iu = immuneUntil.get(e.id) || 0;
        if (system.currentTick < iu && isNegativeEffect(ind.effect)) continue;
        // 只对“还没有该效果”的目标施加，避免每 10 tick 刷新把中毒伤害计时器重置
        try {
          if (!e.getEffect(ind.effect)) {
            e.addEffect(ind.effect, 40, { amplifier: ind.amplifier, showParticles: false });
          }
        } catch (err) {}
      }
    }
    if (ind.skill === "prophet") manageProphetMarks(ind, ent, center);
    ent.setDynamicProperty("jimie_remain", Math.max(0, ind.expireTick - system.currentTick));
  }
}

// ============ 预言家标记 ============
function manageProphetMarks(ind, indicatorEnt, center) {
  let marks = prophets.get(indicatorEnt.id) || new Map();
  const enemies = playersInCylinder({ ...center, dim: indicatorEnt.dimension.id }, ind.radius, 7.5, (q) => isEnemyByTeam(q, ind.team));
  const enemyIds = new Set(enemies.map((e) => e.id));
  // 普林西斯新功能：隐身敌对玩家进入范围即破除隐身
  for (const e of enemies) {
    try {
      if (!deathState.has(e.id) && e.getEffect(INVISIBILITY)) {
        e.removeEffect(INVISIBILITY);
        try { e.sendMessage("§c你的隐身已被普林西斯秘典破除！"); } catch (err) {}
        try { console.warn("[jimie] 普林西斯破除隐身 " + e.name); } catch (err) {}
      }
    } catch (err) {}
  }
  const owner = ind.ownerId ? world.getEntity(ind.ownerId) : undefined;
  const friends = world.getAllPlayers().filter((p) => {
    const t = teamOf(p);
    return t !== "" && t === ind.team;
  });
  if (owner && owner.typeId === "minecraft:player" && !friends.includes(owner)) {
    friends.push(owner);
  }
  for (const [eid, marker] of [...marks]) {
    const e = world.getEntity(eid);
    if (!enemyIds.has(eid) || !e || !e.isValid) {
      try {
        if (marker.text) marker.text.remove();
        else if (marker.stand) marker.stand.kill();
      } catch (err) {}
      marks.delete(eid);
    } else if (friends.length === 0) {
      try {
        if (marker.text) marker.text.remove();
        else if (marker.stand) marker.stand.kill();
      } catch (err) {}
      marks.delete(eid);
    } else if (marker.text) {
      try { marker.text.visibleTo = friends; } catch (err) {}
    } else if (marker.stand) {
      const m = world.getEntity(marker.stand.id);
      if (m && m.isValid) {
        try { m.teleport({ x: e.location.x, y: e.location.y + 2.2, z: e.location.z }); } catch (err) {}
      }
    }
  }
  for (const e of enemies) {
    if (marks.get(e.id)) continue;
    if (friends.length === 0) continue; // 没有可见对象时不创建标记
    try {
      if (world.primitiveShapesManager && typeof TextPrimitive !== "undefined") {
        const text = new TextPrimitive({ x: 0, y: 2.2, z: 0 }, "§d✦标记·" + e.name);
        text.attachedTo = e;
        text.visibleTo = friends;
        try { text.scale = 0.9; } catch (err) {}
        try { text.backgroundColorOverride = { red: 0, green: 0, blue: 0, alpha: 0.45 }; } catch (err) {}
        world.primitiveShapesManager.addText(text, e.dimension);
        try { text.visibleTo = friends; } catch (err) {}
        marks.set(e.id, { text });
        try { console.warn("[jimie] 标记创建 text enemy=" + e.name + " friends=" + friends.length); } catch (err) {}
      } else {
        const marker = indicatorEnt.dimension.spawnEntity("minecraft:armor_stand", { x: e.location.x, y: e.location.y + 2.2, z: e.location.z });
        marker.addEffect(INVISIBILITY, 1000000, { amplifier: 0, showParticles: false });
        marker.nameTag = "§d✦标记·" + e.name;
        marker.setDynamicProperty("jimie_marker_for", e.id);
        marks.set(e.id, { stand: marker });
        try { console.warn("[jimie] 标记创建 stand（TextPrimitive 不可用） enemy=" + e.name); } catch (err) {}
      }
    } catch (err) {}
  }
  prophets.set(indicatorEnt.id, marks);
}

function clearProphetMarks(indicatorId) {
  const marks = prophets.get(indicatorId) || new Map();
  for (const marker of marks.values()) {
    try {
      if (marker.text) {
        marker.text.remove();
        if (world.primitiveShapesManager) {
          try { world.primitiveShapesManager.removeText(marker.text); } catch (e) {}
        }
      }
      else if (marker.stand) marker.stand.kill();
    } catch (e) {}
  }
  try { console.warn("[jimie] 标记清除 indicator=" + indicatorId + " count=" + marks.size); } catch (e) {}
  prophets.delete(indicatorId);
}

function clearAllProphetMarks() {
  for (const key of [...prophets.keys()]) {
    clearProphetMarks(key);
  }
}

// ============ 佩莉阵眼 ============
function tickPeili() {
  for (const [oid, eid] of [...peiliIndicators]) {
    const ent = world.getEntity(eid);
    if (!ent || !ent.isValid) {
      peiliIndicators.delete(oid);
      continue;
    }
    const owner = world.getEntity(oid);
    let dead = true;
    if (owner && owner.isValid) {
      const hc = owner.getComponent("minecraft:health");
      dead = !hc || hc.currentValue <= 0;
    }
    beamParticles(
      ent.dimension,
      { x: ent.location.x, y: ent.location.y, z: ent.location.z },
      dead ? { red: 1.0, green: 0.15, blue: 0.15 } : { red: 0.95, green: 0.4, blue: 0.3 },
      dead ? 24 : 8
    );
    // 阵眼本体：发光粒子球 + 底部小光环（不依赖模型，必然可见）
    try {
      const orbColor = dead ? { red: 1.0, green: 0.15, blue: 0.15 } : { red: 1.0, green: 0.75, blue: 0.25 };
      const mv = new MolangVariableMap();
      mv.setColorRGB("variable.color", orbColor);
      const l = ent.location;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ent.dimension.spawnParticle("minecraft:colored_flame_particle", {
          x: l.x + Math.cos(a) * 0.55,
          y: l.y + 0.6 + Math.sin(a) * 0.2,
          z: l.z + Math.sin(a) * 0.55
        }, mv);
      }
      drawIndicatorRing(ent.dimension, { x: l.x, y: l.y + 0.2, z: l.z }, 1.0, orbColor);
    } catch (e) {}
  }
}

function handlePeiliRespawn(p) {
  const eid = peiliIndicators.get(p.id);
  if (!eid) return;
  const ent = world.getEntity(eid);
  if (ent && ent.isValid) {
    try {
      p.teleport({ x: ent.location.x, y: ent.location.y + 0.5, z: ent.location.z });
      p.sendMessage("§6你已通过阵眼复活");
    } catch (e) {}
    try { ent.remove(); } catch (e) { try { ent.kill(); } catch (e2) {} }
  }
  peiliIndicators.delete(p.id);
}

// ============ 芙希狼 ============
function nearestEnemyFor(entity, excludeTeam) {
  const dim = entity.dimension;
  let best = null;
  let bestD = Infinity;
  try {
    for (const q of world.getAllPlayers()) {
      if (q.dimension.id !== dim.id) continue;
      const t = teamOf(q);
      if (!t || t === excludeTeam) continue;
      if (deathState.has(q.id)) continue; // 幽灵等待期不打
      if (q.hasTag(SPECTATOR_TAG)) continue; // 观战不打
      try {
        const hc = q.getComponent("minecraft:health");
        if (hc && hc.currentValue <= 0) continue;
      } catch (e) {}
      const dx = q.location.x - entity.location.x;
      const dy = q.location.y - entity.location.y;
      const dz = q.location.z - entity.location.z;
      const d = Math.hypot(dx, dy, dz);
      if (d <= 35 && d < bestD) {
        best = q;
        bestD = d;
      }
    }
  } catch (e) {}
  return best;
}

// 自定义驯服狗：主动索敌（nearest_attackable_target，玩家+队伍标签 35 格）+ 原版复仇/跟随。
// 脚本零伤害、零移动干预，只做生命周期、防偷狗与追击诊断。
function tickWolves() {
  const now = system.currentTick;
  for (const [id, w] of [...wolves]) {
    const wolf = world.getEntity(id);
    if (!wolf || !wolf.isValid) {
      wolves.delete(id);
      continue;
    }
    // 防偷狗：狗只能属于召唤者；被其他人驯服则移除
    try {
      const tb = wolf.getComponent("minecraft:tameable");
      if (tb && tb.isTamed && tb.tamedToPlayerId && tb.tamedToPlayerId !== w.ownerId) {
        try { console.warn("[jimie] 狗被他人驯服，已移除 wolf=" + wolf.id); } catch (e2) {}
        try { wolf.kill(); } catch (e2) {}
        wolves.delete(id);
        continue;
      }
    } catch (e) {}
    try { wolf.addEffect(RESISTANCE, 40, { amplifier: 1, showParticles: false }); } catch (e) {}
    let remain = Number(wolf.getDynamicProperty("jimie_remain") || 0);
    if (remain <= 0) {
      try { wolf.kill(); } catch (e) {}
      wolves.delete(id);
      continue;
    }
    remain = Math.max(0, remain - 10);
    wolf.setDynamicProperty("jimie_remain", remain);
    w.expireTick = now + remain;
    const owner = w.ownerId ? world.getEntity(w.ownerId) : undefined;
    if (!owner || !owner.isValid) continue;
    const oTeam = teamOf(owner);
    if (!oTeam) continue;
    const enemy = nearestEnemyFor(wolf, oTeam);
    if (!enemy) {
      w.targetId = null;
      w.prevDist = undefined;
      continue;
    }
    const dx = enemy.location.x - wolf.location.x;
    const dy = enemy.location.y - wolf.location.y;
    const dz = enemy.location.z - wolf.location.z;
    const dist = Math.hypot(dx, dy, dz);
    if (w.targetId !== enemy.id) {
      w.targetId = enemy.id;
      w.prevDist = dist;
      w.checkAt = now;
      try { console.warn("[jimie] 狼索敌 " + wolf.typeId + " 目标=" + enemy.name + " 距离=" + dist.toFixed(1)); } catch (e) {}
    }
    // 追击诊断：每 2 秒输出一次距离变化，判断狗是否真的在追赶
    if (now >= (w.checkAt || 0)) {
      w.checkAt = now + 40;
      const delta = w.prevDist !== undefined ? dist - w.prevDist : 0;
      try {
        console.warn("[jimie] 狗追击检查 " + wolf.typeId + " 目标=" + enemy.name +
          " 距离=" + dist.toFixed(1) + " 变化=" + (delta >= 0 ? "+" : "") + delta.toFixed(1) +
          (delta < -1.0 ? "（正在追赶）" : delta > 1.0 ? "（正在远离）" : "（基本不动）"));
      } catch (e) {}
      w.prevDist = dist;
    }
  }
}

// ============ 布德宗图腾 ============
function tickTotems() {
  for (const p of world.getAllPlayers()) {
    if (deathState.has(p.id)) continue; // 幽灵等待期间不补图腾
    const t1 = p.getDynamicProperty("jimie_tome1");
    const t2 = p.getDynamicProperty("jimie_tome2");
    // 只有明确选择了布德宗圣典的玩家才触发图腾逻辑
    const hasBuddha = t1 === "buddha" || t2 === "buddha";
    if (!hasBuddha) {
      totemState.delete(p.id);
      continue;
    }
    let st = totemState.get(p.id);
    const eq = p.getComponent("minecraft:equippable");
    const off = eq ? eq.getEquipment(EquipmentSlot.Offhand) : undefined;
    const hasTotem = !!off && off.typeId === "minecraft:totem_of_undying";
    if (!st) st = { had: hasTotem };
    let remain = Number(p.getDynamicProperty("jimie_totem_remain") || 0);
    if (st.had && !hasTotem) {
      try { p.removeEffect(REGEN); } catch (e) {}
      try { p.addEffect(REGEN, 260, { amplifier: 1 }); } catch (e) {}
      remain = 120;
      p.setDynamicProperty("jimie_totem_remain", remain);
      p.sendMessage("§6布德宗圣典：图腾触发，生命恢复II 13s，120s后补充图腾");
    }
    st.had = hasTotem;
    if (remain > 0) {
      remain = Math.max(0, remain - 0.5);
      p.setDynamicProperty("jimie_totem_remain", remain);
    }
    if (remain <= 0 && !hasTotem && eq) {
      try {
        eq.setEquipment(EquipmentSlot.Offhand, loadoutStack("minecraft:totem_of_undying"));
        st.had = true;
        p.sendMessage("§6布德宗圣典：不死图腾已补充");
      } catch (e) {}
    }
    totemState.set(p.id, st);
  }
}

// ============ 全局维护 ============
function tickMaintenance() {
  const now = system.currentTick;
  for (const p of world.getAllPlayers()) {
    applyTeamVisual(p);
    if (deathState.has(p.id)) continue; // 幽灵等待期间不补发物品/效果
    if (p.getDynamicProperty("jimie_school") && !p.hasTag(RED_TAG) && !p.hasTag(BLUE_TAG)) {
      try { assignTeam(p); } catch (e) {}
    }
    markKeepOnDeath(p);
    const until = blessBoostUntil.get(p.id) || 0;
    if (now < until) {
      // 固定补 40 tick，确保到期瞬间由脚本接管过渡，不会自然消失导致血量被整段扣掉
      try { p.addEffect(HB, 40, { amplifier: 7, showParticles: false }); } catch (e) {}
    } else if (blessBoostUntil.has(p.id)) {
      // 祝福到期：记录到期瞬间血量 H，移除 VIII，立刻补回 V，再把血量写为 min(H, 40) 无缝衔接
      blessBoostUntil.delete(p.id);
      try {
        const hc = p.getComponent("minecraft:health");
        const h = hc ? hc.currentValue : 20;
        p.removeEffect(HB);
        p.addEffect(HB, 40, { amplifier: 4, showParticles: false });
        if (hc) {
          const desired = Math.min(40, Math.max(1, h));
          hc.setCurrentValue(desired);
        }
      } catch (e) {}
    } else {
      try { p.addEffect(HB, 40, { amplifier: 4, showParticles: false }); } catch (e) {}
    }
    const inv = p.getComponent("minecraft:inventory");
    const hasLife = p.getDynamicProperty("jimie_school") === "life" ||
      (inv && (hasItem(inv.container, "jimie:wand_life") || hasItem(inv.container, "jimie:same_boat") || hasItem(inv.container, "jimie:bless")));
    if (hasLife) {
      try { p.addEffect(REGEN, 40, { amplifier: 0, showParticles: false }); } catch (e) {}
    }
    // 弹窗看门狗：120 秒未完成才清理，避免误杀正在正常选择/提交的玩家
    if (formOpen.has(p.id) && now - (formOpenSince.get(p.id) || now) > 2400) {
      formOpen.delete(p.id);
      formOpenSince.delete(p.id);
    }
    const school = p.getDynamicProperty("jimie_school");
    if (!school) {
      if (!selectionWait.has(p.id)) selectionWait.set(p.id, now);
      if (!formOpen.has(p.id)) {
        try { startSelection(p); } catch (e) {}
      }
      if (now - selectionWait.get(p.id) >= 1200) {
        // UI 持续无法完成选择时，60 秒后给默认配置，保证物品与技能可用
        try {
          p.setDynamicProperty("jimie_school", "jiemie");
          p.setDynamicProperty("jimie_tome1", "buddha");
          p.setDynamicProperty("jimie_tome2", "priest");
          selectionWait.delete(p.id);
          formOpen.delete(p.id);
          bumpFormGen(p);
          ensureLoadout(p);
          p.sendMessage("§e未选择学派，已自动分配默认配置（击灭 + 布德宗 + 卡鲁）");
        } catch (e) {}
      }
    } else {
      selectionWait.delete(p.id);
      const t1 = p.getDynamicProperty("jimie_tome1");
      if (!t1) {
        if (!formOpen.has(p.id)) {
          try { showTomeForm(p); } catch (e) {}
        }
      } else {
        try { ensureLoadout(p); } catch (e) {}
      }
    }
    const iu = immuneUntil.get(p.id) || 0;
    if (now < iu) removeNegatives(p);
    else if (immuneUntil.has(p.id)) immuneUntil.delete(p.id);
  }
  for (const [id, until] of [...fallImmuneUntil]) {
    if (now >= until) fallImmuneUntil.delete(id);
  }
}

// ============ 击杀判定（击灭丨勇战） ============
if (world.afterEvents.entityDie) {
  world.afterEvents.entityDie.subscribe((ev) => {
    const victim = ev.deadEntity;
    if (victim.typeId !== "minecraft:player") return;
    if (gameState.active) {
      const vTeam = teamOf(victim);
      if (vTeam === RED_TAG || vTeam === BLUE_TAG) {
        addScore(vTeam === RED_TAG ? BLUE_TAG : RED_TAG, KILL_SCORE);
        if (!deathState.has(victim.id)) {
          deathState.set(victim.id, {
            untilTick: system.currentTick + DEATH_WAIT_TICKS,
            selectedNodeId: baseNodeId(vTeam),
            stashed: false
          });
          try { victim.sendMessage("§c你已阵亡；点击复活后将进入12秒幽灵等待，可潜行或使用「复活选择器」切换复活点"); } catch (e) {}
        }
      }
    }
    const src = ev.damageSource.damagingEntity;
    let killer = null;
    if (src && src.typeId === "minecraft:player") killer = src;
    else if (src && src.typeId.indexOf("jimie:fuxi_wolf") === 0) {
      const oid = src.getDynamicProperty("jimie_owner");
      if (oid) killer = world.getAllPlayers().find((p) => p.id === oid);
    } else if (src && src.typeId === "minecraft:wolf") {
      // 只认芙希召唤的原版狗（有 jimie_owner 标记），普通狗不计入
      const oid = src.getDynamicProperty("jimie_owner");
      if (oid) killer = world.getAllPlayers().find((p) => p.id === oid);
    } else {
      const pid = recentHurtBy.get(victim.id);
      if (pid) killer = world.getAllPlayers().find((p) => p.id === pid);
    }
    recentHurtBy.delete(victim.id);
    if (!killer || killer.id === victim.id) return;
    if (!isEnemy(killer, victim)) return;
    const inv = killer.getComponent("minecraft:inventory");
    const isJiemie = killer.getDynamicProperty("jimie_school") === "jiemie" ||
      (inv && (hasItem(inv.container, "jimie:halberd") || hasItem(inv.container, "jimie:charge") || hasItem(inv.container, "jimie:heal")));
    if (isJiemie) {
      try {
        killer.addEffect(STRENGTH, 100, { amplifier: 0 });
        killer.sendMessage("§c击灭丨勇战：力量I 5s");
      } catch (e) {}
    }
  });
}

// ============ 掉落伤害免疫（突进施法者） ============
if (world.beforeEvents.entityHurt) {
  world.beforeEvents.entityHurt.subscribe((ev) => {
    const p = ev.hurtEntity;
    // 芙希狗受击：友方玩家/友方狗打狗一律取消，避免狗反击友方；敌方伤害正常放行
    if (isOurWolf(p)) {
      const src2 = ev.damageSource.damagingEntity;
      if (src2 && src2.id !== p.id) {
        let srcTeam = "";
        if (src2.typeId === "minecraft:player") {
          srcTeam = teamOf(src2);
        } else if (isOurWolf(src2)) {
          const oid2 = src2.getDynamicProperty("jimie_owner");
          const owner2 = oid2 ? world.getAllPlayers().find((q) => q.id === oid2) : undefined;
          if (owner2) srcTeam = teamOf(owner2);
        }
        if (srcTeam !== "" && srcTeam === teamOf(p)) ev.cancel = true;
      }
      return;
    }
    if (p.typeId !== "minecraft:player") return;
    if (deathState.has(p.id)) {
      ev.cancel = true;
      return;
    }
    // 取消友伤：同队玩家之间、友方狼攻击同队玩家时都不造成伤害
    // （自己打自己除外，保留同舟/阿玛拉加的自伤机制）
    const src = ev.damageSource.damagingEntity;
    if (src && src.id !== p.id) {
      let srcTeam = "";
      if (src.typeId === "minecraft:player") {
        srcTeam = teamOf(src);
      } else if (src.typeId.indexOf("jimie:fuxi_wolf") === 0) {
        const oid = src.getDynamicProperty("jimie_owner");
        const owner = oid ? world.getAllPlayers().find((q) => q.id === oid) : undefined;
        if (owner) srcTeam = teamOf(owner);
      } else if (src.typeId === "minecraft:wolf" && src.getDynamicProperty("jimie_owner") !== undefined) {
        const oid = src.getDynamicProperty("jimie_owner");
        const owner = oid ? world.getAllPlayers().find((q) => q.id === oid) : undefined;
        if (owner) srcTeam = teamOf(owner);
      }
      if (srcTeam !== "" && srcTeam === teamOf(p)) ev.cancel = true;
    }
    if (String(ev.damageSource.cause) === "fall") {
      const until = fallImmuneUntil.get(p.id) || 0;
      if (system.currentTick < until) ev.cancel = true;
    }
  });
}

// ============ 免疫：阻止负面效果新增 ============
if (world.beforeEvents.effectAdd) {
  world.beforeEvents.effectAdd.subscribe((ev) => {
    const p = ev.entity;
    if (!p || p.typeId !== "minecraft:player") return;
    const iu = immuneUntil.get(p.id) || 0;
    if (system.currentTick < iu && isNegativeEffect(ev.effectType)) {
      ev.cancel = true;
      try { console.warn("[jimie] 免疫拦截 " + String(ev.effectType) + " player=" + p.name); } catch (e) {}
    }
  });
}

// ============ 免疫兜底：效果已加上后立即清除（防止 before 拦截在部分版本失效） ============
if (world.afterEvents.effectAdd) {
  world.afterEvents.effectAdd.subscribe((ev) => {
    const p = ev.entity;
    if (!p || p.typeId !== "minecraft:player") return;
    const iu = immuneUntil.get(p.id) || 0;
    if (system.currentTick >= iu) return;
    if (!isNegativeEffect(ev.effectType)) return;
    try { removeNegatives(p); } catch (e) {}
    const now = system.currentTick;
    if (now - (lastImmuneLog.get(p.id) || 0) >= 40) {
      lastImmuneLog.set(p.id, now);
      try { console.warn("[jimie] 免疫兜底清除 " + String(ev.effectType) + " player=" + p.name); } catch (e) {}
    }
  });
}

// ============ 佩莉阵眼被攻击 ============
if (world.afterEvents.entityHurt) {
  world.afterEvents.entityHurt.subscribe((ev) => {
    // 芙希狗咬伤日志（每 5 秒节流一次），用于确认原版狗攻击是否生效
    try {
      const hurtP = ev.hurtEntity;
      const srcE = ev.damageSource.damagingEntity;
      const isSummonWolf = srcE && (
        srcE.typeId.indexOf("jimie:fuxi_wolf") === 0 ||
        (srcE.typeId === "minecraft:wolf" && srcE.getDynamicProperty("jimie_owner") !== undefined)
      );
      if (hurtP.typeId === "minecraft:player" && isSummonWolf) {
        const now2 = system.currentTick;
        if (now2 - (lastWolfBiteLog.get(hurtP.id) || 0) >= 100) {
          lastWolfBiteLog.set(hurtP.id, now2);
          try { console.warn("[jimie] 狗咬伤 " + hurtP.name + " 伤害=" + ev.damage); } catch (e) {}
        }
      }
    } catch (e) {}
    const ent = ev.hurtEntity;
    const isEye = ent.typeId === "jimie:peili_indicator" ||
      (ent.typeId === "minecraft:ender_crystal" && ent.getDynamicProperty("jimie_owner") !== undefined);
    if (!isEye) return;
    const attacker = ev.damageSource.damagingEntity;
    if (!attacker || attacker.typeId !== "minecraft:player") return;
    const ownerId = ent.getDynamicProperty("jimie_owner");
    const owner = ownerId ? world.getEntity(ownerId) : undefined;
    if (!owner || !isEnemy(attacker, owner)) return;
    let hits = Number(ent.getDynamicProperty("jimie_hits") || 0) + 1;
    ent.setDynamicProperty("jimie_hits", hits);
    try { console.warn("[jimie] 阵眼受击 " + hits + "/3 attacker=" + attacker.name); } catch (e) {}
    ent.dimension.playSound("random.orb", ent.location);
    spawnBurst(ent.dimension, ent.location, "minecraft:critical_hit");
    try { attacker.sendMessage("§6阵眼受击 " + hits + "/3"); } catch (e) {}
    if (hits >= 3) {
      try { ent.remove(); } catch (e) { try { ent.kill(); } catch (e2) {} }
      peiliIndicators.delete(ownerId);
      try { world.sendMessage("§c佩莉阵眼已被摧毁！"); } catch (e) {}
    }
  });
}

// ============ 使用物品 ============
function handleUse(player, itemStack) {
  const id = itemStack.typeId;
  const now = system.currentTick;
  const prev = lastUse.get(player.id);
  if (prev && prev.tick === now && prev.id === id) return;
  lastUse.set(player.id, { tick: now, id: id });
  const cdKey = player.id + ":" + id;
  const cdUntil = cooldownUntil.get(cdKey) || 0;
  if (now < cdUntil) {
    // 远程普通攻击（法杖/魔杖）完全不提示冷却；其余技能保持每次触发都提示（原行为）
    if (id !== "jimie:wand_bind" && id !== "jimie:wand_life") {
      const remainSec = (cdUntil - now) / 20;
      const remainText = remainSec >= 10 ? String(Math.ceil(remainSec)) : remainSec.toFixed(1);
      try { player.sendMessage("§c技能冷却中（剩余 " + remainText + " 秒）"); } catch (e) {}
    }
    return;
  }
  switch (id) {
    case "jimie:wand_bind": wandShot(player, 2, "minecraft:spell", "minecraft:endrod"); break;
    case "jimie:wand_life": wandShot(player, 1, "minecraft:heart_particle", "minecraft:heart_particle"); break;
    case "jimie:charge": skillCharge(player); break;
    case "jimie:heal": skillHeal(player); break;
    case "jimie:slow_field": skillSlowField(player); break;
    case "jimie:poison_field": skillPoisonField(player); break;
    case "jimie:same_boat": skillSameBoat(player); break;
    case "jimie:bless": skillBless(player); break;
    case "jimie:dash": skillDash(player); break;
    case "jimie:stealth": skillStealth(player); break;
    case "jimie:tome_buddha": tomeBuddhaStatus(player); break;
    case "jimie:tome_priest": tomePriest(player); break;
    case "jimie:tome_knight": tomeKnight(player); break;
    case "jimie:tome_doctor": tomeDoctor(player); break;
    case "jimie:tome_summoner": tomeSummoner(player); break;
    case "jimie:tome_blade": tomeBlade(player); break;
    case "jimie:tome_herbalist": tomeHerbalist(player); break;
    case "jimie:tome_prophet": tomeProphet(player); break;
    case "jimie:tome_formation": tomeFormation(player); break;
    case "jimie:respawn_selector": if (deathState.has(player.id)) cycleRespawn(player); break;
    default: break;
  }
  const cdSec = ITEM_CD[id];
  if (cdSec) cooldownUntil.set(cdKey, now + cdSec * 20);
}

if (world.afterEvents.itemUse) {
  world.afterEvents.itemUse.subscribe((ev) => {
    if (ev.source && ev.source.typeId === "minecraft:player") handleUse(ev.source, ev.itemStack);
  });
}

// @minecraft/server 2.9.0 已移除 itemUseOn 事件（ItemUseOnAfterEvent 被删除），
// 物品在方块上使用时同样会触发 itemUse，因此只保留上面的订阅。

// ============ 聊天队伍切换（可选；事件不存在则跳过，不再导致脚本崩溃） ============
if (world.afterEvents.chatSend) {
  world.afterEvents.chatSend.subscribe((ev) => {
    const m = ev.message.trim().toLowerCase();
    if (m === "!team red" || m === "!team 红") setTeam(ev.sender, RED_TAG);
    else if (m === "!team blue" || m === "!team 蓝") setTeam(ev.sender, BLUE_TAG);
    else if (m === "!reset") resetSelection(ev.sender);
    else if (m === "!give") {
      try {
        ensureLoadout(ev.sender);
        ev.sender.sendMessage("§a已补发当前配置物品");
      } catch (e) {}
    }
  });
}

// ============ 死亡等待：潜行切换复活点（事件可用时） ============
if (world.afterEvents.entityStartSneaking) {
  world.afterEvents.entityStartSneaking.subscribe((ev) => {
    const e = ev.entity;
    if (e && e.typeId === "minecraft:player" && deathState.has(e.id)) cycleRespawn(e);
  });
}

// ============ 生成/复活 ============
if (world.afterEvents.playerSpawn) {
  world.afterEvents.playerSpawn.subscribe((ev) => {
    try {
      const p = ev.player;
      if (gameState.active && !ev.initialSpawn && deathState.has(p.id)) {
        const st = deathState.get(p.id);
        // 保证点击复活后至少还有完整的 12 秒选择时间
        st.untilTick = Math.max(st.untilTick, system.currentTick + DEATH_WAIT_TICKS);
        if (system.currentTick < st.untilTick) {
          // 幽灵等待阶段
          try { p.addEffect(INVISIBILITY, 1000000, { amplifier: 0, showParticles: false }); } catch (e) {}
          if (!st.stashed) {
            try { clearJimieItems(p); } catch (e) {}
            stripGhostTotem(p);
            st.stashed = true;
          }
          giveRespawnSelector(p);
          teleportGhost(p, st.selectedNodeId);
          notifyRespawnSelection(p, st);
          return;
        }
        // 等待结束，正式复活
        respawnAt(p, st.selectedNodeId);
        deathState.delete(p.id);
        removeRespawnSelector(p);
        try { p.removeEffect(INVISIBILITY); } catch (e) {}
        applyGlobalBoosts(p);
        ensureLoadout(p);
        forceSurvival(p);
        return;
      }
      if (ev.initialSpawn && gameState.active) {
        // 中途加入：观战
        p.addTag(SPECTATOR_TAG);
        try { p.setGameMode(GameMode.spectator); } catch (e) {}
        try { p.sendMessage("§7比赛进行中，你已进入观战模式"); } catch (e) {}
        return;
      }
      blessBoostUntil.delete(p.id);
      immuneUntil.delete(p.id);
      formOpen.delete(p.id);
      formOpenSince.delete(p.id);
      bumpFormGen(p);
      applyTeamVisual(p);
      const school = p.getDynamicProperty("jimie_school");
      const tome1 = p.getDynamicProperty("jimie_tome1");
      if (!school) {
        startSelection(p);
      } else {
        if (!p.hasTag(RED_TAG) && !p.hasTag(BLUE_TAG)) assignTeam(p);
        if (!tome1) showTomeForm(p);
        else ensureLoadout(p);
      }
      applyGlobalBoosts(p);
      if (!ev.initialSpawn) handlePeiliRespawn(p);
    } catch (e) {}
  });
}

// ============ 测试/重置渠道：/scriptevent ============
// 用法：
//   /scriptevent jimie:reset                       重新弹选择 UI（清空物品/配置/队伍）
//   /scriptevent jimie:give                        按当前配置补发物品
//   /scriptevent jimie:set jiemie,buddha,priest[,red]  直接设置学派+两本圣典（可选第 4 项队伍）
//   /scriptevent jimie:school life                 只改学派，保留圣典与队伍
//   /scriptevent jimie:tome buddha,priest          只改两本圣典，保留学派与队伍
//   /scriptevent jimie:team red                    只改队伍（red/blue/auto）
//   /scriptevent jimie:start                       开始夺点比赛
//   /scriptevent jimie:stop                        结束并重置比赛
//   /scriptevent jimie:summon                      直接测试芙希召唤（不消耗物品）
if (system.afterEvents && system.afterEvents.scriptEventReceive) {
  system.afterEvents.scriptEventReceive.subscribe((ev) => {
    const p = ev.sourceEntity && ev.sourceEntity.typeId === "minecraft:player" ? ev.sourceEntity : undefined;
    if (!p) return;
    if (ev.id === "jimie:reset") {
      resetSelection(p);
    } else if (ev.id === "jimie:summon") {
      try {
        tomeSummoner(p);
        p.sendMessage("§a已执行直接召唤测试");
      } catch (e) {}
    } else if (ev.id === "jimie:give") {
      try {
        ensureLoadout(p);
        p.sendMessage("§a已补发当前配置物品");
      } catch (e) {}
    } else if (ev.id === "jimie:set" && ev.message) {
      const parts = ev.message.split(/[,; ]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (parts.length >= 3) {
        const ok = applyConfig(p, parts[0], [parts[1], parts[2]], parts[3]);
        if (!ok) p.sendMessage("§c配置无效，格式：/scriptevent jimie:set 学派,圣典1,圣典2");
      } else {
        p.sendMessage("§c用法：/scriptevent jimie:set jiemie,buddha,priest");
      }
    } else if (ev.id === "jimie:school" && ev.message) {
      const ok = changeSchoolOnly(p, ev.message.trim().toLowerCase());
      if (!ok) p.sendMessage("§c无效的学派 ID，可用：jiemie / fuzu / life / speed");
    } else if (ev.id === "jimie:tome" && ev.message) {
      const parts = ev.message.split(/[,; ]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (parts.length >= 2) {
        const ok = changeTomesOnly(p, [parts[0], parts[1]]);
        if (!ok) p.sendMessage("§c无效的圣典 ID，格式：/scriptevent jimie:tome buddha,priest");
      } else {
        p.sendMessage("§c用法：/scriptevent jimie:tome buddha,priest");
      }
    } else if (ev.id === "jimie:team" && ev.message) {
      const ok = changeTeamOnly(p, ev.message);
      if (!ok) p.sendMessage("§c用法：/scriptevent jimie:team red|blue|auto");
    } else if (ev.id === "jimie:start") {
      startGame();
    } else if (ev.id === "jimie:stop") {
      endGame(null);
    }
  });
}

// ============ 夺点玩法：点位与计分 ============
function findGroundY(x, z) {
  try {
    const dim = world.getDimension("overworld");
    for (let y = 200; y >= -60; y--) {
      const b = dim.getBlock({ x: Math.floor(x), y, z: Math.floor(z) });
      if (b && b.isSolid) return y + 1;
    }
  } catch (e) {}
  return 64;
}

function initNodes() {
  gameState.nodes = NODES.map((n) => ({
    ...n,
    owner: n.isBase ? (n.id === "base_red" ? RED_TAG : BLUE_TAG) : "neutral",
    progress: 0,
    progressTeam: "",
    groundY: -55
  }));
}

function baseNodeId(team) {
  return team === RED_TAG ? "base_red" : "base_blue";
}

function forceSurvival(p) {
  try { p.setGameMode(GameMode.survival); } catch (e) {
    try { console.warn("[jimie] setGameMode survival 失败: " + String(e && e.message || e)); } catch (e2) {}
  }
  try { p.runCommand("gamemode survival"); } catch (e) {
    try { console.warn("[jimie] gamemode 命令失败: " + String(e && e.message || e)); } catch (e2) {}
  }
}

function playerInNodeZone(p, node) {
  if (deathState.has(p.id)) return false;
  if (p.hasTag(SPECTATOR_TAG)) return false;
  if (p.dimension.id !== "minecraft:overworld") return false;
  const hc = p.getComponent("minecraft:health");
  if (hc && hc.currentValue <= 0) return false;
  const dx = p.location.x - node.x;
  const dz = p.location.z - node.z;
  if (dx * dx + dz * dz > CAPTURE_RADIUS * CAPTURE_RADIUS) return false;
  if (node.groundY !== null && node.groundY !== undefined && Math.abs(p.location.y - node.groundY) > ZONE_HALF_HEIGHT) return false;
  return true;
}

function ownedNodeCount(team) {
  let n = 0;
  for (const node of gameState.nodes) {
    if (!node.isBase && node.owner === team) n++;
  }
  return n;
}

function addScore(team, points) {
  if (!gameState.active) return;
  gameState.score[team] += points;
  if (gameState.score[team] >= WIN_SCORE) endGame(team);
}

function announceNode(node) {
  const ownerName = node.owner === RED_TAG ? "§c红方" : "§b蓝方";
  try { world.sendMessage(ownerName + "§f占领了§e " + node.name); } catch (e) {}
}

function tickGame() {
  if (!gameState.active) return;
  const now = system.currentTick;
  for (const node of gameState.nodes) {
    if (node.isBase) continue;
    let red = 0, blue = 0;
    for (const p of world.getAllPlayers()) {
      if (p.hasTag(SPECTATOR_TAG)) continue;
      const t = teamOf(p);
      if (t !== RED_TAG && t !== BLUE_TAG) continue;
      if (playerInNodeZone(p, node)) {
        if (t === RED_TAG) red++;
        else blue++;
      }
    }
    node.paused = red > 0 && blue > 0;
    if (node.paused) continue; // 双方在场：占领与回退都暂停
    if (red === 0 && blue === 0) {
      try {
        for (const p of world.getAllPlayers()) {
          const dx = p.location.x - node.x;
          const dz = p.location.z - node.z;
          if (dx * dx + dz * dz <= CAPTURE_RADIUS * CAPTURE_RADIUS) {
            console.warn(
              "[jimie] 圈内未计入 " + node.id + " 玩家=" + p.name +
              " team=" + (teamOf(p) || "无") +
              " dim=" + p.dimension.id +
              " y=" + p.location.y.toFixed(1) +
              " 幽灵=" + deathState.has(p.id) +
              " 观战=" + p.hasTag(SPECTATOR_TAG)
            );
          }
        }
      } catch (e) {}
    }
    if (red > 0 || blue > 0) {
      try { console.warn("[jimie] 占领检测 " + node.id + " red=" + red + " blue=" + blue + " owner=" + node.owner + " prog=" + node.progress); } catch (e) {}
    }
    if (node.owner === "neutral") {
      if (red > 0) {
        node.progress = Math.min(NEUTRAL_CAPTURE_TICKS, node.progress + 10);
        if (node.progress >= NEUTRAL_CAPTURE_TICKS) {
          node.owner = RED_TAG;
          node.progress = 0;
          node.progressTeam = "";
          announceNode(node);
        }
      } else if (blue > 0) {
        node.progress = Math.max(-NEUTRAL_CAPTURE_TICKS, node.progress - 10);
        if (node.progress <= -NEUTRAL_CAPTURE_TICKS) {
          node.owner = BLUE_TAG;
          node.progress = 0;
          node.progressTeam = "";
          announceNode(node);
        }
      } else {
        if (node.progress > 0) node.progress = Math.max(0, node.progress - 10);
        else if (node.progress < 0) node.progress = Math.min(0, node.progress + 10);
      }
    } else {
      const enemyTeam = node.owner === RED_TAG ? BLUE_TAG : RED_TAG;
      const enemyCount = node.owner === RED_TAG ? blue : red;
      if (enemyCount > 0) {
        node.progressTeam = enemyTeam;
        node.progress = Math.min(OWNED_TAKEOVER_TICKS, node.progress + 10);
        if (node.progress >= OWNED_TAKEOVER_TICKS) {
          node.owner = enemyTeam;
          node.progress = 0;
          node.progressTeam = "";
          announceNode(node);
        }
      } else if (node.progress > 0) {
        // 攻方不在圈内（阵亡或撤出）时，接管进度 1:1 回退；
        // 守方留在圈内也照常回退（之前只允许“圈内完全无人”时回退，导致冻结）
        node.progress = Math.max(0, node.progress - 10);
        if (node.progress === 0) node.progressTeam = "";
      }
    }
  }
  drawNodeRings();
  updateGameSidebar();
  ensureNodeTextShapes();
  for (const p of world.getAllPlayers()) {
    if (!deathState.has(p.id)) showNodeSpeedHud(p);
  }
  // 每秒占领分（1/2/4/8/16）
  for (const team of [RED_TAG, BLUE_TAG]) {
    const rate = SCORE_PER_NODE[ownedNodeCount(team)];
    gameState.scoreAccum[team] += rate / 2;
    while (gameState.scoreAccum[team] >= 1) {
      gameState.scoreAccum[team] -= 1;
      addScore(team, 1);
    }
  }
  if (now >= gameState.endTick) endGame(null);
}

// ============ 夺点玩法：死亡等待与复活选择 ============
function respawnOptions(p) {
  const team = teamOf(p);
  const opts = [];
  const base = gameState.nodes.find((n) => n.id === baseNodeId(team));
  if (base) opts.push({ id: base.id, name: base.name, kind: "base" });
  for (const node of gameState.nodes) {
    if (!node.isBase && node.owner === team) opts.push({ id: node.id, name: node.name, kind: "node" });
  }
  const peiliId = peiliIndicators.get(p.id);
  if (peiliId) {
    const pe = world.getEntity(peiliId);
    if (pe && pe.isValid) opts.push({ id: "peili:" + peiliId, name: "佩莉阵眼", kind: "peili" });
  }
  return opts;
}

function notifyRespawnSelection(p, st) {
  const opts = respawnOptions(p);
  const cur = opts.find((o) => o.id === st.selectedNodeId);
  const name = cur ? cur.name : "大本营";
  try {
    p.sendMessage("§e复活点：" + name + "§r  §7[潜行或使用复活选择器切换]");
  } catch (e) {}
}

function validateDeathSelection(p, st) {
  const opts = respawnOptions(p);
  if (!opts.some((o) => o.id === st.selectedNodeId)) {
    st.selectedNodeId = baseNodeId(teamOf(p));
    try { p.sendMessage("§c原复活点已不可用，已切换到大本营"); } catch (e) {}
  }
}

function cycleRespawn(p) {
  const st = deathState.get(p.id);
  if (!st) return;
  const opts = respawnOptions(p);
  if (opts.length === 0) {
    st.selectedNodeId = baseNodeId(teamOf(p));
    return;
  }
  let idx = opts.findIndex((o) => o.id === st.selectedNodeId);
  if (idx < 0) idx = -1;
  st.selectedNodeId = opts[(idx + 1) % opts.length].id;
  notifyRespawnSelection(p, st);
}

function isRespawnSelectorStack(it) {
  if (!it) return false;
  if (it.typeId === "jimie:respawn_selector") return true;
  // 兼容旧版“原版指南针 + nameTag”方案，便于清理迁移残留
  return it.typeId === "minecraft:compass" && String(it.nameTag || "").indexOf("复活选择器") !== -1;
}

function makeRespawnSelector() {
  const stack = loadoutStack("jimie:respawn_selector", ItemLockMode.slot);
  try { stack.nameTag = "§e复活选择器"; } catch (e) {}
  return stack;
}

function hasRespawnSelector(container) {
  for (let i = 0; i < container.size; i++) {
    if (isRespawnSelectorStack(container.getItem(i))) return true;
  }
  return false;
}

function giveRespawnSelector(p) {
  let given = false;
  try {
    const inv = p.getComponent("minecraft:inventory");
    if (inv) {
      const c = inv.container;
      const cur = c.getItem(RESPAWN_SELECTOR_SLOT);
      if (cur && cur.typeId === "jimie:respawn_selector") {
        // 已在第 5 格：确保槽位锁定
        try { c.getSlot(RESPAWN_SELECTOR_SLOT).lockMode = ItemLockMode.slot; } catch (e) {}
        try { c.getSlot(RESPAWN_SELECTOR_SLOT).keepOnDeath = true; } catch (e) {}
        given = true;
      } else {
        // 清掉其他位置的旧选择器，再放到第 5 格
        for (let i = c.size - 1; i >= 0; i--) {
          const it = c.getItem(i);
          if (isRespawnSelectorStack(it)) {
            try { c.getSlot(i).lockMode = ItemLockMode.none; } catch (e) {}
            try { c.setItem(i, undefined); } catch (e) {}
          }
        }
        try { c.getSlot(RESPAWN_SELECTOR_SLOT).lockMode = ItemLockMode.none; } catch (e) {}
        c.setItem(RESPAWN_SELECTOR_SLOT, makeRespawnSelector());
        if (isRespawnSelectorStack(c.getItem(RESPAWN_SELECTOR_SLOT))) {
          try { c.getSlot(RESPAWN_SELECTOR_SLOT).lockMode = ItemLockMode.slot; } catch (e) {}
          try { c.getSlot(RESPAWN_SELECTOR_SLOT).keepOnDeath = true; } catch (e) {}
          given = true;
        }
      }
    }
  } catch (e) {}
  if (!given) {
    try {
      p.dimension.spawnItem(makeRespawnSelector(), p.location);
      given = true;
    } catch (e) {}
  }
  if (!given) {
    try { p.sendMessage("§c复活选择器发放失败（jimie:respawn_selector 创建异常）"); } catch (e) {}
  }
}

function removeRespawnSelector(p) {
  try {
    const inv = p.getComponent("minecraft:inventory");
    if (!inv) return;
    const c = inv.container;
    for (let i = c.size - 1; i >= 0; i--) {
      const it = c.getItem(i);
      if (isRespawnSelectorStack(it)) {
        try { c.getSlot(i).lockMode = ItemLockMode.none; } catch (e) {}
        try { c.setItem(i, undefined); } catch (e) {}
      }
    }
  } catch (e) {}
}

function teleportGhost(p, id) {
  try {
    let x, z, gy;
    if (id && id.indexOf("peili:") === 0) {
      const eid = id.slice(6);
      const ent = world.getEntity(eid);
      if (ent && ent.isValid) {
        x = ent.location.x;
        z = ent.location.z;
        gy = ent.location.y;
      } else {
        id = baseNodeId(teamOf(p));
      }
    }
    if (x === undefined) {
      const node = gameState.nodes.find((n) => n.id === id) ||
        gameState.nodes.find((n) => n.id === baseNodeId(teamOf(p))) ||
        gameState.nodes[0];
      x = node ? node.x + 0.5 : 0.5;
      z = node ? node.z + 0.5 : 0.5;
      gy = node && node.groundY !== null && node.groundY !== undefined ? node.groundY : -55;
    }
    p.teleport({ x, y: gy + 30, z });
  } catch (e) {}
}

function respawnAt(p, id) {
  try {
    if (id && id.indexOf("peili:") === 0) {
      const eid = id.slice(6);
      const ent = world.getEntity(eid);
      if (ent && ent.isValid) {
        p.teleport({ x: ent.location.x, y: ent.location.y + 2.5, z: ent.location.z });
        p.sendMessage("§6你已通过佩莉阵眼复活");
        try { ent.remove(); } catch (e) { try { ent.kill(); } catch (e2) {} }
        peiliIndicators.delete(p.id);
        return;
      }
    }
    let node = gameState.nodes.find((n) => n.id === id);
    if (!node) node = gameState.nodes.find((n) => n.id === baseNodeId(teamOf(p)));
    if (!node) node = gameState.nodes[0];
    // 重生点 y 暂定 -60
    p.teleport({ x: node.x + 0.5, y: -60, z: node.z + 0.5 });
  } catch (e) {}
}

function tickDeathWait() {
  const now = system.currentTick;
  for (const [pid, st] of [...deathState]) {
    const p = world.getEntity(pid);
    if (!p || !p.isValid) {
      deathState.delete(pid);
      continue;
    }
    validateDeathSelection(p, st);
    try { p.addEffect(INVISIBILITY, 1000000, { amplifier: 0, showParticles: false }); } catch (e) {}
    if (!st.stashed) {
      try { clearJimieItems(p); } catch (e) {}
      stripGhostTotem(p);
      st.stashed = true;
    }
    giveRespawnSelector(p);
    teleportGhost(p, st.selectedNodeId);
    // 复活等待倒计时（action bar）
    const remainSec = Math.max(0, (st.untilTick - now) / 20);
    try {
      p.onScreenDisplay.setActionBar("§e复活等待剩余 " + (remainSec >= 10 ? String(Math.ceil(remainSec)) : remainSec.toFixed(1)) + " 秒");
    } catch (e) {}
    if (now >= st.untilTick) {
      respawnAt(p, st.selectedNodeId);
      deathState.delete(pid);
      removeRespawnSelector(p);
      try { p.removeEffect(INVISIBILITY); } catch (e) {}
      applyGlobalBoosts(p);
      ensureLoadout(p);
      forceSurvival(p);
      try { p.sendMessage("§a你已复活"); } catch (e) {}
    }
  }
}

// ============ 夺点玩法：开始 / 结束 ============
function startGame() {
  if (gameState.active) {
    try { world.sendMessage("§c比赛已在进行中"); } catch (e) {}
    return;
  }
  try { console.warn("[jimie] 比赛开始"); } catch (e) {}
  initNodes();
  gameState.active = true;
  gameState.startTick = system.currentTick;
  gameState.endTick = gameState.startTick + GAME_DURATION_TICKS;
  gameState.score = { [RED_TAG]: 0, [BLUE_TAG]: 0 };
  gameState.scoreAccum = { [RED_TAG]: 0, [BLUE_TAG]: 0 };
  ensureGameSidebar();
  clearNodeTextShapes();
  clearAllProphetMarks();
  for (const p of world.getAllPlayers()) {
    try {
      p.removeTag(SPECTATOR_TAG);
      if (!p.hasTag(RED_TAG) && !p.hasTag(BLUE_TAG)) assignTeam(p);
      forceSurvival(p);
      try { respawnAt(p, baseNodeId(teamOf(p))); } catch (e) {}
      try { console.warn("[jimie] 玩家 " + p.name + " team=" + (teamOf(p) || "无") + " dim=" + p.dimension.id + " y=" + p.location.y.toFixed(1)); } catch (e) {}
      applyGlobalBoosts(p);
      markKeepOnDeath(p);
      if (p.getDynamicProperty("jimie_school")) ensureLoadout(p);
    } catch (e) {}
  }
  try { world.sendMessage("§6=== 比赛开始：20分钟 / 先到2000分 ==="); } catch (e) {}
}

function endGame(winner) {
  if (!gameState.active) return;
  gameState.active = false;
  if (!winner) {
    if (gameState.score[RED_TAG] > gameState.score[BLUE_TAG]) winner = RED_TAG;
    else if (gameState.score[BLUE_TAG] > gameState.score[RED_TAG]) winner = BLUE_TAG;
  }
  try {
    if (winner) world.sendMessage("§6=== 比赛结束：" + (winner === RED_TAG ? "红队" : "蓝队") + " 获胜！===");
    else world.sendMessage("§6=== 比赛结束：平局 ===");
  } catch (e) {}
  initNodes();
  gameState.score = { [RED_TAG]: 0, [BLUE_TAG]: 0 };
  gameState.scoreAccum = { [RED_TAG]: 0, [BLUE_TAG]: 0 };
  clearGameSidebar();
  clearNodeTextShapes();
  clearAllProphetMarks();
  for (const p of world.getAllPlayers()) {
    try {
      p.removeTag(SPECTATOR_TAG);
      deathState.delete(p.id);
      removeRespawnSelector(p);
      p.removeEffect(INVISIBILITY);
      forceSurvival(p);
      const team = teamOf(p);
      if (team === RED_TAG || team === BLUE_TAG) respawnAt(p, baseNodeId(team));
    } catch (e) {}
  }
  try { world.sendMessage("§7已重置：分数清零、点位恢复中立、可重新开始"); } catch (e) {}
}

// ============ 启动扫描 ============
function loadIndicators() {
  for (const dimId of ["overworld", "nether", "the_end"]) {
    const dim = world.getDimension(dimId);
    let list = [];
    try { list = dim.getEntities({ type: "jimie:area_indicator" }); } catch (e) { continue; }
    for (const ent of list) {
      const remain = Math.max(0, Number(ent.getDynamicProperty("jimie_remain") || 0));
      const center = parseVec(String(ent.getDynamicProperty("jimie_center") || "0,0,0"));
      indicators.set(ent.id, {
        skill: String(ent.getDynamicProperty("jimie_skill") || ""),
        team: String(ent.getDynamicProperty("jimie_team") || ""),
        ownerId: String(ent.getDynamicProperty("jimie_owner") || ""),
        center: { x: center.x, y: center.y, z: center.z, dim: dimId },
        radius: Number(ent.getDynamicProperty("jimie_radius") || 0),
        effect: String(ent.getDynamicProperty("jimie_effect") || ""),
        amplifier: Number(ent.getDynamicProperty("jimie_amplifier") || 0),
        expireTick: system.currentTick + remain
      });
    }
  }
}

function loadWolves() {
  for (const dimId of ["overworld", "nether", "the_end"]) {
    const dim = world.getDimension(dimId);
    // 清理上一版“原版狼”方案残留（带 jimie_owner 标记的原版狼）
    {
      let list = [];
      try { list = dim.getEntities({ type: "minecraft:wolf" }); } catch (e) { list = []; }
      for (const ent of list) {
        if (ent.getDynamicProperty("jimie_owner") !== undefined) {
          try { ent.kill(); } catch (e) { try { ent.remove(); } catch (e2) {} }
        }
      }
    }
    // 恢复芙希自定义狗
    for (const typeId of ["jimie:fuxi_wolf_red", "jimie:fuxi_wolf_blue"]) {
      let list = [];
      try { list = dim.getEntities({ type: typeId }); } catch (e) { continue; }
      for (const wolf of list) {
        const remain = Math.max(0, Number(wolf.getDynamicProperty("jimie_remain") || 0));
        wolves.set(wolf.id, {
          ownerId: String(wolf.getDynamicProperty("jimie_owner") || ""),
          expireTick: system.currentTick + remain,
          spawnTick: system.currentTick
        });
      }
    }
  }
}

function loadPeili() {
  for (const dimId of ["overworld", "nether", "the_end"]) {
    const dim = world.getDimension(dimId);
    let list = [];
    // 清理遗留的原版末影水晶阵眼（旧方案残留）
    try { list = dim.getEntities({ type: "minecraft:ender_crystal" }); } catch (e) { list = []; }
    for (const ent of list) {
      if (ent.getDynamicProperty("jimie_owner") !== undefined) {
        try { ent.remove(); } catch (e) { try { ent.kill(); } catch (e2) {} }
      }
    }
    // 恢复自定义阵眼实体
    try { list = dim.getEntities({ type: "jimie:peili_indicator" }); } catch (e) { continue; }
    for (const ent of list) {
      const ownerId = String(ent.getDynamicProperty("jimie_owner") || "");
      if (ownerId) peiliIndicators.set(ownerId, ent.id);
    }
  }
}

function cleanupOldMarkers() {
  for (const dimId of ["overworld", "nether", "the_end"]) {
    const dim = world.getDimension(dimId);
    let list = [];
    try { list = dim.getEntities({ type: "minecraft:armor_stand" }); } catch (e) { continue; }
    for (const stand of list) {
      if (stand.getDynamicProperty("jimie_marker_for") !== undefined) {
        try { stand.kill(); } catch (e) {}
      }
    }
  }
}

function startup() {
  try { console.warn("[jimie] 环境 primitiveShapes=" + !!world.primitiveShapesManager + " TextPrimitive=" + typeof TextPrimitive); } catch (e) {}
  try { if (world.primitiveShapesManager) world.primitiveShapesManager.removeAll(); } catch (e) {}
  try { loadIndicators(); } catch (e) {}
  try { loadWolves(); } catch (e) {}
  try { loadPeili(); } catch (e) {}
  try { cleanupOldMarkers(); } catch (e) {}
  try {
    for (const p of world.getAllPlayers()) {
      try {
        applyTeamVisual(p);
        ensurePlayerLabel(p);
        if (p.getDynamicProperty("jimie_school") && !p.hasTag(RED_TAG) && !p.hasTag(BLUE_TAG)) assignTeam(p);
        applyGlobalBoosts(p);
        markKeepOnDeath(p);
        if (p.getDynamicProperty("jimie_school")) ensureLoadout(p);
      } catch (e) {}
    }
  } catch (e) {}
  try {
    system.runInterval(() => {
      tickMaintenance();
      tickIndicators();
      tickWolves();
      tickDogLabels();
      tickPeili();
      tickTotems();
      tickGame();
      tickDeathWait();
      tickPlayerLabels();
    }, 10);
  } catch (e) {}
}

// 不能在“早期执行”阶段直接调用 world.getAllPlayers()，延迟到下一 tick 再启动
if (system.run) {
  system.run(startup);
} else {
  startup();
}
