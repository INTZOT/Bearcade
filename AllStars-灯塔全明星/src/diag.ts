// ============================================================
// 自检命令:`/bearcade:allstars_diag`
//
// 目的:把首次实机的所有"未知/假设"一次性打出来,避免反复猜:
//   1) 配置与场地坐标是否符合预期
//   2) 当前是否在模板/房间维度(场地操作要在模板维度做)
//   3) 86 段动画清单是否齐全、名字能否解析
//   4) 自定义实体能否生成(客户端资源包是否真的加载 → 看得见模型)
//   5) 无重力组件组事件能否触发(脚本驱动 y 轴的前提)
//   6) playAnimation 能否成功发出
//   7) 相机 free 预设 + setFov 是否可用(0.4 秒后自动清除)
//   8) TextPrimitive HUD 能否创建(含 maxShapes 上限)
//   9) 原始输入向量与 Jump/Sneak 按钮(定轴向)
//  10) 擂台是否已生成
//
// 需 op tag。自检分两段,聊天栏按 0/1/2/3/4 秒错开输出,不再是"一瞬间刷完":
//   视觉段(约 12 秒)同时在场三件东西,其中实体是 **A/B 对照**:
//                       A 组 = 极简单方块实体 12 秒(正前方 1.5 格,贴图取自春叶贴图)
//                              —— 判定"客户端实体 + 渲染控制器写法"这一层通不通;
//                       B 组 = 春叶模型 12 秒(正前方 3 格、与脚底同高、面朝你)
//                              —— 待判定对象;
//                       浮空字 10 秒(正前方 2.5 格、与视线齐平)、
//                       相机 0.4 秒(动之前/之后各提示一次,自动恢复);
//   数值段:配置/动画/输入/场地的结论随进度写入聊天栏,并同时写入内容日志。
// 重复执行会先清掉上一次的探针(实体按 tag 清扫 + 记住浮空字句柄),不会越堆越多。
// ============================================================
import {
  CommandPermissionLevel,
  CustomCommandStatus,
  EasingType,
  InputButton,
  MolangVariableMap,
  Player,
  TextPrimitive,
  system,
  world,
  type Entity,
  type VanillaEntityIdentifier,
  type Vector3,
} from "@minecraft/server";
import {
  ARENA_CENTER,
  ARENA_FLOOR_Y,
  ARENA_HALF_WIDTH,
  BACKSTAGE_FEET_Y,
  BACKSTAGE_PAD_Y,
  DASH_DOUBLE_TAP_TICKS,
  DASH_SPEED,
  DASH_TICKS,
  GRAVITY_PER_TICK,
  HITSTOP_BLOCKED_TICKS,
  HITSTOP_TICKS,
  JUMP_VELOCITY,
  KNOCKDOWN_COMBO_HITS,
  KO_CAMERA_FOV,
  KO_HITSTOP_TICKS,
  KO_PHASE_SUPER_TICKS,
  KO_PHASE_TICKS,
  LEAF_DIVE_LOOP_MAX,
  LEAF_RISE_LOOP_MAX,
  MOVE_SPEED,
  SUPER_FREEZE_TICKS,
  SUPER_HITSTOP_TICKS,
  THROW_TECH_WINDOW_TICKS,
} from "./combat-config";
import {
  GAME_ID,
  MAX_PLAYERS,
  PREP_SPAWN,
  ROOM_COUNT,
  TEMPLATE_FROM,
  TEMPLATE_TO,
  TICKING_FROM,
  TICKING_TO,
} from "./config";
import { hasClip, playClip } from "./anim";
import { frameFor } from "./camera";
import { despawnProp, spawnCommandBlock, spawnPearl } from "./props";
import { getInputCalibration } from "./calib";
import { CHUNYE_CLIP_IDS, CHUNYE_ENTITY_ID, clip } from "./data/chunye.clips";

const TAG = "§6【灯塔全明星 · 自检】§r";
const OK = "§a✓§r";
const BAD = "§c✗§r";
const WARN = "§e!§r";

// ------------------------------------------------------------
// 视觉段时长与构图(实机按"看得最清楚"调,只影响自检,不影响对局)
// ------------------------------------------------------------

/** 测试实体存活 240 tick = 12 秒(原 60 tick = 3 秒,玩家来不及看清) */
const PROBE_ENTITY_TICKS = 240;
/** 浮空字存活 200 tick = 10 秒(原 60 tick = 3 秒) */
const PROBE_TEXT_TICKS = 200;
/** 清除前多少 tick 提醒一次(40 tick = 2 秒) */
const PROBE_CLEAR_WARN_TICKS = 40;
/** 测试实体落点:玩家正前方几格 */
const PROBE_ENTITY_DISTANCE = 3;
/** 落点候选(正前方被方块堵住时依次后退,保证模型一定看得见) */
const PROBE_ENTITY_DISTANCE_FALLBACKS: number[] = [3, 2.5, 2, 1.5];
/** 浮空字落点:玩家正前方几格 */
const PROBE_TEXT_DISTANCE = 2.5;
/** 浮空字高度:玩家脚底 + 1.6 格 ≈ 视线齐平 */
const PROBE_EYE_HEIGHT = 1.6;
/** 探针实体身上的 tag(重复执行时按它清扫上一次的残留) */
const PROBE_TAG = "bearcade:allstars_diag_probe";
/**
 * A/B 对照的 A 组:极简单方块探针实体(行为包 entities/allstars_probe.json,
 * 客户端定义 resource-pack/entity/allstars_probe.entity.json)。
 */
const PROBE_CUBE_ENTITY_ID = "bearcade:allstars_probe";
/**
 * A 组方块探针的落点:玩家正前方固定 1.5 格(不做避墙回退,避墙不是关键)。
 * 1×1 方块半宽 0.5、玩家半宽 0.3 → 间距 0.7 格,不与玩家碰撞箱重叠。
 */
const PROBE_CUBE_DISTANCE = 1.5;
/** 相机探测持续时间:8 tick = 0.4 秒(保持很短,避免干扰玩家) */
const CAMERA_PROBE_TICKS = 8;

// ------------------------------------------------------------
// 聊天栏节奏:三处视觉提示与数值段各错开 1~2 秒(不再一瞬间刷完)
// ------------------------------------------------------------

/** 1.0 秒:浮空字(视觉段 ②) */
const AT_PROBE_TEXT = 20;
/** 2.0 秒:相机探测(视觉段 ③) */
const AT_PROBE_CAMERA = 40;
/** 3.0 秒:输入读取(数值段) */
const AT_PROBE_INPUT = 60;
/** 4.0 秒:场地方块(数值段) */
const AT_PROBE_ARENA = 80;

/** 上一次自检留下的探针(重复执行时先清掉) */
let lastProbeEntity: Entity | undefined;
/** 上一次自检留下的 A 组方块探针 */
let lastProbeCube: Entity | undefined;
let lastProbeProps: Entity[] = [];
let lastProbeText: TextPrimitive | undefined;
/** 上一次自检注册过的所有定时(重跑时全部撤销,免得旧提示乱入新一次自检) */
let probeTimers: number[] = [];

function fmt(v: Vector3): string {
  return `(${v.x}, ${v.y}, ${v.z})`;
}

function tell(player: Player, line: string): void {
  try {
    player.sendMessage(line);
  } catch {
    // 玩家离线:忽略
  }
}

/** 安全定时:`system.runTimeout` + 内层 try/catch;返回定时 id(-1 = 注册失败) */
function scheduleAt(tick: number, task: () => void): number {
  try {
    return system.runTimeout(() => {
      try {
        task();
      } catch (error) {
        console.warn("[Bearcade allstars diag] 定时任务异常", error);
      }
    }, tick);
  } catch (error) {
    console.warn("[Bearcade allstars diag] 定时任务注册失败", error);
    return -1;
  }
}

/** 注册一个"属于本次自检"的定时(重跑时会被统一撤销) */
function scheduleProbe(tick: number, task: () => void): void {
  probeTimers.push(scheduleAt(tick, task));
}

/** 玩家正前方(水平朝向)`distance` 格、高度偏移 `heightOffset` 处的坐标 */
function frontPoint(player: Player, distance: number, heightOffset: number): Vector3 {
  const base = player.location;
  let yaw = 0;
  try {
    yaw = player.getRotation().y;
  } catch {
    yaw = 0;
  }
  const rad = (yaw * Math.PI) / 180;
  return {
    x: base.x - Math.sin(rad) * distance,
    y: base.y + heightOffset,
    z: base.z + Math.cos(rad) * distance,
  };
}

/** 清掉上一次自检留下的探针实体、浮空字与所有定时(避免重复执行越堆越多/提示乱入) */
function clearPastProbe(player: Player, report: (line: string) => void): void {
  for (const prop of lastProbeProps) despawnProp(prop);
  lastProbeProps = [];
  for (const timer of probeTimers) {
    if (timer < 0) continue;
    try {
      system.clearRun(timer);
    } catch {
      // 已触发/已被引擎回收:忽略
    }
  }
  probeTimers = [];

  let cleaned = 0;
  if (lastProbeText) {
    try {
      world.primitiveShapesManager.removeText(lastProbeText);
      cleaned += 1;
    } catch {
      // 已被引擎回收:忽略
    }
    lastProbeText = undefined;
  }
  if (lastProbeCube) {
    try {
      if (lastProbeCube.isValid) {
        lastProbeCube.remove();
        cleaned += 1;
      }
    } catch {
      // 已被引擎回收:忽略
    }
    lastProbeCube = undefined;
  }
  if (lastProbeEntity) {
    try {
      if (lastProbeEntity.isValid) {
        lastProbeEntity.remove();
        cleaned += 1;
      }
    } catch {
      // 已被引擎回收:忽略
    }
    lastProbeEntity = undefined;
  }

  // 兜底:脚本重载过、或玩家换过维度时,按 tag 把上一次的探针实体扫掉。
  // 只认本模块自己打的 tag + 本模块自己的两个实体 id,绝不会误伤对局中的角色实体。
  const probeTypes = [PROBE_CUBE_ENTITY_ID, CHUNYE_ENTITY_ID];
  const dims = [player.dimension];
  for (const id of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
    try {
      const dim = world.getDimension(id);
      if (!dims.some((known) => known.id === dim.id)) dims.push(dim);
    } catch {
      // 该维度不存在:忽略
    }
  }
  for (const dim of dims) {
    for (const probeType of probeTypes) {
      try {
        for (const stale of dim.getEntities({ type: probeType, tags: [PROBE_TAG] })) {
          try {
            stale.remove();
            cleaned += 1;
          } catch {
            // 忽略
          }
        }
      } catch {
        // 该维度不可查询:忽略
      }
    }
  }

  if (cleaned > 0) report(`§7→ 已清掉上一次自检残留的探针 ×${cleaned}`);
}

/**
 * A/B 对照的 **A 组**:极简单方块探针实体。
 *
 * 它和春叶走**同一套客户端实体写法**(format 1.10.0 的 client_entity + materials
 * entity_alphatest + textures 取春叶贴图 + 原版内建 "controller.render.default",
 * 与春叶完全一致;春叶那边另有一段 scripts.animate:[] 曾导致整条描述被丢弃,
 * 已删除,详见 docs/lessons.md)。唯一差别是"几何只有一个不透明方块、没有任何
 * 动画/骨骼树"。因此"看得到 / 看不到"的组合能直接把问题锁到某一层:
 *   A 可见 + B 不可见 → 问题在春叶的几何定义或那段 27MB 动画文件;
 *   A 不可见          → 问题在"行为包实体 + 客户端实体"这一层(与春叶几何无关);
 *   A、B 都可见       → 之前是时序/位置问题。
 *
 * 落点固定 frontPoint(player, 1.5, 0),不做避墙回退。
 * 返回落点坐标(生成失败返回 undefined),供 A/B 对照说明打印实测坐标。
 */
function spawnProbeCube(player: Player, report: (line: string) => void): Vector3 | undefined {
  const target = frontPoint(player, PROBE_CUBE_DISTANCE, 0);
  try {
    const entity = player.dimension.spawnEntity(
      PROBE_CUBE_ENTITY_ID as VanillaEntityIdentifier,
      target,
    );
    const ok = entity.isValid;
    report(
      `${ok ? OK : BAD} [A 组] 方块探针生成 ${PROBE_CUBE_ENTITY_ID}` +
        `(位置 ${fmt(target)},你正前方 ${PROBE_CUBE_DISTANCE} 格)`,
    );
    if (!ok) return undefined;

    lastProbeCube = entity;
    try {
      entity.addTag(PROBE_TAG);
    } catch {
      // tag 只是重复执行的清扫线索,失败不影响本次自检
    }

    try {
      entity.triggerEvent("bearcade:probe_driven");
      report(`${OK} [A 组] 无重力组件组事件 bearcade:probe_driven 已触发`);
    } catch (error) {
      report(`${BAD} [A 组] 无重力事件触发失败:${String(error)}`);
    }

    // 与春叶同一时刻清除(清除提示各给一条)
    scheduleProbe(PROBE_ENTITY_TICKS - PROBE_CLEAR_WARN_TICKS, () => {
      report("§e提醒:探针方块(正前方 1.5 格)将在 2 秒后清除,春叶模型同时清除。");
    });
    scheduleProbe(PROBE_ENTITY_TICKS, () => {
      try {
        if (entity.isValid) entity.remove();
      } catch {
        // 忽略
      }
      if (lastProbeCube === entity) lastProbeCube = undefined;
    });
    return target;
  } catch (error) {
    report(`${BAD} [A 组] 方块探针生成失败:${String(error)}`);
    report(
      "§7→ 多半是行为包未启用/未完整重启世界,或 entities/allstars_probe.json 未被加载",
    );
    return undefined;
  }
}

/**
 * 道具探针:在眼前生成一颗末影珍珠 + 一个命令方块(冲刺/大招用的视觉道具)。
 *
 * 为什么单独探:这两个模型来自源资产 `props/`,是**独立实体**(动画 JSON 里没有
 * 它们的通道),所以"珍珠/方块哪去了"只能靠肉眼确认模型有没有加载。
 * 12 秒后自动清除。
 */
function spawnPropProbe(
  player: Player,
  report: (line: string) => void,
): void {
  try {
    const base = frontPoint(player, 2.5, 0);
    const pearlAt: Vector3 = { x: base.x - 0.8, y: base.y + 1.2, z: base.z };
    const blockAt: Vector3 = { x: base.x + 0.8, y: base.y + 1.2, z: base.z };
    // The probe owns its slow scale samples; it is independent of match time.
    const pearl = spawnPearl(player.dimension, pearlAt, false);
    const block = spawnCommandBlock(player.dimension, blockAt, false);
    lastProbeProps = [pearl, block].filter((entity): entity is Entity => entity !== undefined);
    if (pearl || block) {
      report("§e珍珠和命令方块在第 2～6 秒缓慢缩小再放大，请观察大小变化。");
      for (let tick = 40; tick <= 120; tick += 2) {
        const scale = Math.max(0.001, Math.abs(tick - 80) / 40);
        scheduleProbe(tick, () => {
          if (pearl?.isValid) pearl.setProperty("bearcade:prop_scale", scale);
          if (block?.isValid) block.setProperty("bearcade:prop_scale", scale);
        });
      }
    }
    report(
      `${pearl ? OK : BAD} 道具探针:末影珍珠 ${pearlAt ? fmt(pearlAt) : ""} + 命令方块 ${fmt(blockAt)}` +
        `(都在你正前方 2.5 格、脚底 +1.2)`,
    );
    if (!pearl || !block) {
      report(
        "§7→ 生成失败:确认行为包已启用且完整重启过世界(entities/allstars_pearl.json / allstars_command_block.json)",
      );
    }
    scheduleProbe(PROBE_ENTITY_TICKS, () => {
      despawnProp(pearl);
      despawnProp(block);
      report("§7 道具探针已清除");
    });
  } catch (error) {
    report(`${BAD} 道具探针失败:${String(error)}`);
  }
}

/**
 * A/B 对照说明:两条探针都在场时打印一次。
 * 玩家只需回答"看到哪几个",就能直接映射到结论 —— 不需要懂几何/渲染控制器。
 */
function reportAbComparison(
  report: (line: string) => void,
  cubePoint: Vector3 | undefined,
  chunyePoint: Vector3 | undefined,
): void {
  report(
    "★ A/B 探针:正前方 1.5 格 = §b单方块探针实体(贴图取自春叶贴图)§r;" +
      "正前方 3 格 = §b春叶模型§r。请告诉我:①只看到方块 ②只看到春叶 ③两个都看到 ④两个都没看到" +
      " —— 这四种结果分别指向不同原因。",
  );
  report(
    `§7 实测落点:A 组(方块)= ${cubePoint ? fmt(cubePoint) : "(生成失败)"},` +
      `B 组(春叶)= ${chunyePoint ? fmt(chunyePoint) : "(生成失败)"};` +
      `${PROBE_ENTITY_TICKS / 20} 秒后两条探针一并清除(清除前 2 秒各有一次提醒)。`,
  );
  report(
    "§7→ ①只看到方块 = 问题在春叶的几何/动画文件;②只看到春叶 = A 组探针侧配置有误;" +
      "③都看到 = 修复生效(此前 scripts.animate 空数组会让模型整条不渲染);" +
      "④都没看到 = 行为包实体+客户端实体这一层不通,看内容日志 [Geometry]/[Rendering]/[Animation] 报错。",
  );
}

/** 生成一只测试角色:正前方 3 格、与玩家脚底同高、面朝玩家,12 秒后自动清除 */
function spawnProbeEntity(
  player: Player,
  report: (line: string) => void,
): Vector3 | undefined {
  const base: Vector3 = {
    x: player.location.x,
    y: player.location.y,
    z: player.location.z,
  };
  // 视野朝向的水平单位向量(与 getRotation().y 的 yaw 约定一致)
  const ahead = frontPoint(player, 1, 0);
  const dirX = ahead.x - base.x;
  const dirZ = ahead.z - base.z;

  // 与玩家**脚底同高**:模型就站在对面地面上,视线自然落在它的上半身(看得最清楚)。
  // 前方若被方块堵住就依次往后退,避免模型卡进墙里"看不见"。
  let distance = PROBE_ENTITY_DISTANCE;
  let target: Vector3 = {
    x: base.x + dirX * PROBE_ENTITY_DISTANCE,
    y: base.y,
    z: base.z + dirZ * PROBE_ENTITY_DISTANCE,
  };
  for (const candidate of PROBE_ENTITY_DISTANCE_FALLBACKS) {
    const point: Vector3 = {
      x: base.x + dirX * candidate,
      y: base.y,
      z: base.z + dirZ * candidate,
    };
    try {
      const feet = player.dimension.getBlock(point);
      const head = player.dimension.getBlock({ x: point.x, y: point.y + 1, z: point.z });
      const blocked =
        (feet !== undefined && !feet.isAir && !feet.isLiquid) ||
        (head !== undefined && !head.isAir && !head.isLiquid);
      if (!blocked) {
        distance = candidate;
        target = point;
        break;
      }
    } catch {
      // 区块未加载等:保留默认落点
      break;
    }
  }

  try {
    const entity = player.dimension.spawnEntity(
      CHUNYE_ENTITY_ID as VanillaEntityIdentifier,
      target,
    );
    const ok = entity.isValid;
    report(
      `${ok ? OK : BAD} [B 组] 实体生成 ${CHUNYE_ENTITY_ID}(位置 ${fmt(target)},你正前方 ${distance} 格)`,
    );
    if (!ok) return undefined;

    lastProbeEntity = entity;
    try {
      entity.addTag(PROBE_TAG);
    } catch {
      // tag 只是重复执行的清扫线索,失败不影响本次自检
    }

    // 面朝玩家:yaw 指向"实体 → 玩家"的方向
    try {
      const faceYaw = (Math.atan2(-(base.x - target.x), base.z - target.z) * 180) / Math.PI;
      entity.setRotation({ x: 0, y: faceYaw });
      report(`${OK} 测试实体已面朝你(yaw=${faceYaw.toFixed(0)}°)`);
    } catch (error) {
      report(`${WARN} 测试实体转向失败(不影响其它检查):${String(error)}`);
    }

    report(
      `§e★ 请看这里:你正前方 ${distance} 格、与脚底同高处 ${fmt(target)} —— ` +
        `应站着「春叶」模型(面朝你,${PROBE_ENTITY_TICKS / 20} 秒后自动清除)`,
    );
    report("§7→ 若没看到:请转身面向上面这个坐标,或朝它走近 1~2 格,再等 1 秒(同时看 1.5 格处的方块探针)。");

    try {
      entity.triggerEvent("bearcade:allstars_driven");
      report(`${OK} 无重力组件组事件 bearcade:allstars_driven 已触发`);
    } catch (error) {
      report(`${BAD} 无重力事件触发失败:${String(error)}`);
    }

    const played = playClip(entity, "idle_stand", { force: true });
    report(
      `${played ? OK : BAD} playAnimation(idle_stand) ${played ? "已发出" : "未发出"}`,
    );
    const played2 = playClip(entity, "attack_stand_light", { force: true });
    report(
      `${played2 ? OK : BAD} playAnimation(attack_stand_light) ${played2 ? "已发出" : "未发出"}`,
    );

    // 清除前 2 秒提醒一次,再真正清除(重复执行时这些定时会被 clearPastProbe 撤销)
    scheduleProbe(PROBE_ENTITY_TICKS - PROBE_CLEAR_WARN_TICKS, () => {
      report("§e提醒:测试实体(春叶模型)将在 2 秒后清除;想再看一次就重跑本命令。");
    });
    scheduleProbe(PROBE_ENTITY_TICKS, () => {
      try {
        if (entity.isValid) entity.remove();
      } catch {
        // 忽略
      }
      if (lastProbeEntity === entity) lastProbeEntity = undefined;
    });
    return target;
  } catch (error) {
    report(`${BAD} [B 组] 实体生成失败:${String(error)}`);
    report(
      "§7→ 多半是行为包未启用/未完整重启世界,或 entities/allstars_chunye.json 未被加载",
    );
    return undefined;
  }
}

/** 相机可用性测试(setCamera free + setFov),0.4 秒后自动恢复 */
function cameraProbe(player: Player, report: (line: string) => void): void {
  try {
    report("§e→ 即将移动你的视角 0.4 秒(相机探测),随后自动恢复,不要慌。");
    const loc: Vector3 = {
      x: player.location.x,
      y: player.location.y + 4,
      z: player.location.z + 6,
    };
    player.camera.setCamera("minecraft:free", {
      location: loc,
      rotation: { x: 8, y: 0 },
      easeOptions: { easeTime: 0.2, easeType: EasingType.InOutSine },
    });
    report(`${OK} camera.setCamera("minecraft:free", …easeOptions) 已下发`);
    player.camera.setFov({ fov: 60, easeOptions: { easeTime: 0.2 } });
    report(`${OK} camera.setFov(60) 已下发`);
    // 取景反解自检:不开打也能核对"机位多远 / FOV 多少"(手感太近就调
    // combat-config 的 CAMERA_FRAME_HALF_HEIGHT,越大越远)
    for (const d of [5, 12, 24]) {
      const frame = frameFor(d);
      report(
        `§7   取景:两人相距 ${d} 格 ⇒ 机位 ${frame.radius.toFixed(1)} 格 / FOV ${frame.fov.toFixed(1)}°`,
      );
    }
    scheduleProbe(CAMERA_PROBE_TICKS, () => {
      try {
        player.camera.clear();
        report(`${OK} camera.clear() 已恢复(视角应回到第一人称)`);
      } catch (error) {
        report(`${WARN} camera.clear() 失败(如视角没回来请手动切视角):${String(error)}`);
      }
    });
  } catch (error) {
    report(`${BAD} 相机调用失败:${String(error)}`);
  }
}

/** TextPrimitive 可用性与 maxShapes 上限 */
function hudProbe(player: Player, report: (line: string) => void): void {
  try {
    const maxShapes = world.primitiveShapesManager.maxShapes;
    report(`${OK} TextPrimitive 上限 maxShapes = ${maxShapes}`);
  } catch (error) {
    report(`${BAD} 读 maxShapes 失败:${String(error)}`);
  }
  try {
    // 正前方 2.5 格、与视线齐平(比"头顶上方 3 格"好找得多)
    const target = frontPoint(player, PROBE_TEXT_DISTANCE, PROBE_EYE_HEIGHT);
    const shape = new TextPrimitive(target, "§e自检浮空字§r");
    shape.depthTest = false;
    shape.visibleTo = [player];
    world.primitiveShapesManager.addText(shape, player.dimension);
    lastProbeText = shape;
    report(
      `${OK} TextPrimitive 创建成功(位置 ${fmt(target)},正前方 ${PROBE_TEXT_DISTANCE} 格、与视线齐平)`,
    );
    report(
      `§e★ 请平视正前方 ${PROBE_TEXT_DISTANCE} 格:应看到「自检浮空字」` +
        `(穿墙可见,${PROBE_TEXT_TICKS / 20} 秒后移除)`,
    );
    scheduleProbe(PROBE_TEXT_TICKS - PROBE_CLEAR_WARN_TICKS, () => {
      report("§e提醒:浮空字将在 2 秒后移除。");
    });
    scheduleProbe(PROBE_TEXT_TICKS, () => {
      try {
        world.primitiveShapesManager.removeText(shape);
      } catch {
        // 忽略
      }
      if (lastProbeText === shape) lastProbeText = undefined;
    });
  } catch (error) {
    report(`${BAD} TextPrimitive 创建失败(HUD 会降级为 title):${String(error)}`);
  }
}

/** 输入读取 */
function inputProbe(player: Player, report: (line: string) => void): void {
  try {
    const v = player.inputInfo.getMovementVector();
    const jump = player.inputInfo.getButtonState(InputButton.Jump);
    const sneak = player.inputInfo.getButtonState(InputButton.Sneak);
    report(
      `${OK} 输入: movementVector=(${v.x.toFixed(2)}, ${v.y.toFixed(2)}) ` +
        `Jump=${String(jump)} Sneak=${String(sneak)}`,
    );
    report("§7→ 推杆时再跑 /scriptevent allstars:probe 看 raw 值变化,定 INPUT_AXIS_MODE");
  } catch (error) {
    report(`${BAD} 输入读取失败:${String(error)}`);
  }
}

/** 场地是否已生成 */
function arenaProbe(player: Player, report: (line: string) => void): void {
  try {
    const floorY = ARENA_FLOOR_Y - 1;
    const a = player.dimension.getBlock({ x: ARENA_CENTER.x, y: floorY, z: ARENA_CENTER.z });
    const typeA = a?.typeId ?? "(未加载)";
    const edge = player.dimension.getBlock({
      x: ARENA_CENTER.x + ARENA_HALF_WIDTH,
      y: floorY,
      z: ARENA_CENTER.z,
    });
    const typeB = edge?.typeId ?? "(未加载)";
    const generated = typeA !== "minecraft:air" && typeA !== "(未加载)";
    report(
      `${generated ? OK : WARN} 擂台方块: 中心(${ARENA_CENTER.x},${floorY},${ARENA_CENTER.z})=${typeA}, ` +
        `边缘(${ARENA_CENTER.x + ARENA_HALF_WIDTH},${floorY},${ARENA_CENTER.z})=${typeB}`,
    );
    if (!generated) {
      report(
        `§7→ 场地未生成:先 /bearcade:tmp tp ${GAME_ID} 进模板维度,再 /bearcade:allstars_buildmap`,
      );
    }

    // 后台平台:玩家本体(隐身)待的地方,必须在擂台地板**下方**(相机看不到)
    const back = player.dimension.getBlock({
      x: ARENA_CENTER.x,
      y: BACKSTAGE_PAD_Y,
      z: ARENA_CENTER.z,
    });
    const backType = back?.typeId ?? "(未加载)";
    const backOk = backType !== "minecraft:air" && backType !== "(未加载)";
    report(
      `${backOk ? OK : BAD} 后台平台: (${ARENA_CENTER.x},${BACKSTAGE_PAD_Y},${ARENA_CENTER.z})=${backType}` +
        `(玩家脚底 y=${BACKSTAGE_FEET_Y},在擂台地板 y=${ARENA_FLOOR_Y - 1} 之下 —— 场地里只有前台角色)`,
    );
    if (!backOk) {
      report("§7→ 旧场地没有后台平台:重跑 /bearcade:allstars_buildmap + /bearcade:tmp ap " + GAME_ID);
    }

    // 跳跃能力自检:顶点高度必须高过对手碰撞箱(2.9 格),否则"跳不过去"
    const opponentHeight = 2.9; // 与 entities/allstars_chunye.json 的 collision_box.height 一致
    const apex = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY_PER_TICK);
    const airTicks = (2 * JUMP_VELOCITY) / GRAVITY_PER_TICK;
    const crossable = apex > opponentHeight;
    report(
      `${crossable ? OK : BAD} 跳跃:顶点 ${apex.toFixed(2)} 格 / 滞空 ${airTicks.toFixed(0)} tick` +
        `(对手碰撞箱高 ${opponentHeight} 格 ⇒ ${crossable ? "可以跳过" : "跳不过去,调大 JUMP_VELOCITY"}),` +
        `空中横移 ${(airTicks * MOVE_SPEED).toFixed(1)} 格`,
    );

    // 冲刺(双击同方向)参数一览:位移距离 = DASH_SPEED × DASH_TICKS
    report(
      `§7   冲刺:双击窗口 ${DASH_DOUBLE_TAP_TICKS} tick / 位移 ` +
        `${(DASH_SPEED * DASH_TICKS).toFixed(2)} 格(朝对手 dash_forward,背离 dash_backward)`,
    );

    // 技能 → 动画链(静态表):一眼看清"每个按键到底会播哪几段"
    report("§e 技能动画链(含成功/被防御/落空分支):");
    report("§7   发波·站: special_leaf_burst");
    report(
      `§7   发波·空: leaf_dive_start → leaf_dive_loop ×${LEAF_DIVE_LOOP_MAX} → ` +
        "命中 leaf_dive_hit / 落地 leaf_dive_land(命中或落地即停位移)",
    );
    report(
      `§7   发波·蹲: leaf_rise_start → leaf_rise_loop ×${LEAF_RISE_LOOP_MAX} → leaf_rise_end` +
        "(本体随叶流抬起,结束后按真实高度下落/落地);命中把对手挑飞 " +
        "(leaf_launch_hit → leaf_launch_air → leaf_launch_land → 倒地 → 起身)",
    );
    report(
      `§7   投技: throw_cast → 命中对手播 throw_victim(摔倒在地);` +
        `空振走 throw_whiff;对方在 ${THROW_TECH_WINDOW_TICKS} tick 内也出投 → ` +
        "throw_tech_cast / throw_tech_victim(拆投,双方分开)",
    );
    report(
      "§7   大招 1/2 气: super_1 / super_2 → 命中受击方播 super_1_victim / super_2_victim;" +
        "被防御或落空 → super_2_whiff(1 气无失败段)",
    );
    report(
      "§7   大招 3 气: super_3_start → 首击确认 super_3_confirm(受击方 super_3_confirm_victim)" +
        " → super_3_chain(配对 super_3_chain_victim)→ finish / low_finish(配对 *_victim);" +
        "首击未确认(超距/被防御)→ super_3_whiff,不进连击",
    );
    report(
      `§7   连打倒地: 非防御命中累计 ${KNOCKDOWN_COMBO_HITS} 下 → knockdown → idle_down → getup`,
    );

    // 表现规格:源资产 ownership.presentation 的三分工(时停 / 定帧 / KO 慢放)
    report("§e 表现规格(源资产 ownership.presentation):");
    report(
      `§7   释放时停(一/二气): 双方冻结 ${SUPER_FREEZE_TICKS} tick,施法者气场时钟独立推进`,
    );
    report(
      `§7   命中定帧(所有命中): 轻 ${HITSTOP_TICKS[1]} / 中 ${HITSTOP_TICKS[2]} / 重 ${HITSTOP_TICKS[3]} / ` +
        `投 ${HITSTOP_TICKS[4]} / 发波 ${HITSTOP_TICKS[5]} tick,大招按气量 ` +
        `${SUPER_HITSTOP_TICKS[1]}/${SUPER_HITSTOP_TICKS[2]}/${SUPER_HITSTOP_TICKS[3]} tick,` +
        `被防御 ${HITSTOP_BLOCKED_TICKS} tick —— 期间双方 + 相机一起顿住`,
    );
    report(
      `§7   强慢放(只在 KO): 撞击定帧 ${KO_HITSTOP_TICKS} tick + KO 停顿 ` +
        `${KO_PHASE_TICKS} tick(大招 KO ${KO_PHASE_SUPER_TICKS})+ 特写机位 setFov ${KO_CAMERA_FOV}`,
    );
    report(
      "§7   注:playAnimation 没有播放倍率参数,规格里的 ko.rate=0.1 无法直接实现," +
        "以上是等价近似(定帧 + 拉长停顿 + 运镜)",
    );
  } catch (error) {
    report(`${BAD} 读方块失败:${String(error)}`);
  }
}

/**
 * 资源包加载判定探针(决定性):
 *   同时喷一颗**本包自带**的粒子与一颗**原版**粒子。
 *   - 两颗都可见 → 资源包已加载
 *   - 只有原版可见 → **资源包没加载**(去世界设置里确认资源包已激活)
 *   - 都看不见    → 粒子被渲染设置/距离挡住,或引擎问题
 * 本包粒子用 pearl_pop:它不依赖任何 Molang 变量,裸调即可显示。
 */
function packProbe(player: Player, report: (line: string) => void): void {
  const eye = frontPoint(player, 2.5, PROBE_EYE_HEIGHT);
  const vanilla: Vector3 = { x: eye.x, y: eye.y + 0.6, z: eye.z };
  try {
    const vars = new MolangVariableMap();
    player.dimension.spawnParticle("green_beret:pearl_pop", eye, vars);
    player.dimension.spawnParticle("minecraft:basic_crit_particle", vanilla, vars);
    report(
      "★ 资源包探针:正前方 2.5 格已同时喷出 §b本包粒子(green_beret:pearl_pop,青绿色)§r 与 " +
        "§7原版粒子(minecraft:basic_crit_particle,白色)§r。",
    );
    report(
      "§e请判断:两颗都看到 = 资源包已加载;§e只看到白色§r = **资源包没加载**(去世界设置-资源包确认" +
        "「Bearcade 灯塔全明星对决」处于已激活);两颗都没有 = 距离/渲染设置问题。",
    );
  } catch (error) {
    report(
      `${BAD} 粒子喷发失败:${String(error)}(若报 unknown particle,说明资源包未加载)`,
    );
  }
}

function runDiagnostics(player: Player): void {
  const report = (line: string): void => {
    tell(player, line);
    console.warn(`[Bearcade allstars diag] ${line.replace(/§./g, "")}`);
  };

  report(
    `${TAG} 自检开始:先看视觉(约 ${PROBE_ENTITY_TICKS / 20} 秒),数值结果同时写入内容日志。`,
  );

  // 0) 先清掉上一次自检留下的探针(实体扫 tag + 浮空字按句柄),避免越堆越多
  clearPastProbe(player, report);

  // 1) 配置
  report(
    `1) 配置: gameId=${GAME_ID} 房间=${ROOM_COUNT} 满员=${MAX_PLAYERS} ` +
      `擂台中心=${fmt(ARENA_CENTER)} 脚底 y=${ARENA_FLOOR_Y} 半宽=${ARENA_HALF_WIDTH} 准备台=${fmt(PREP_SPAWN)}`,
  );
  report(
    `2) 模板范围: from=${fmt(TEMPLATE_FROM)} to=${fmt(TEMPLATE_TO)} ` +
      `常加载 ${fmt(TICKING_FROM)}~${fmt(TICKING_TO)}`,
  );

  // 2) 维度
  const dimId = player.dimension.id;
  const expectTemplate = `bearcade:${GAME_ID}_template`;
  if (dimId === expectTemplate) {
    report(`3) ${OK} 当前在模板维度 ${dimId}`);
  } else if (/^bearcade:allstars_\d+$/.test(dimId)) {
    report(`3) ${OK} 当前在房间维度 ${dimId}(场地已生成时可在此自检实体/相机)`);
  } else {
    report(
      `3) ${WARN} 当前维度 ${dimId};生成场地请在 ${expectTemplate}(先 /bearcade:tmp tp ${GAME_ID})`,
    );
  }

  // 3) 动画清单
  const missing = CHUNYE_CLIP_IDS.filter((id) => !hasClip(id));
  report(
    `4) ${missing.length === 0 ? OK : BAD} 动画清单 ${CHUNYE_CLIP_IDS.length - missing.length}/${CHUNYE_CLIP_IDS.length} 可用` +
      (missing.length ? `,缺失: ${missing.slice(0, 6).join(", ")}` : ""),
  );
  const sample = clip("idle_stand");
  report(`   抽样: idle_stand → ${sample?.name ?? "(缺失)"}  时长 ${sample?.seconds ?? "?"}s`);

  // 3.5) 当前生效的输入校准(若存档里存了错的符号,左右/前后会反向,这里一眼能看到)
  const calibration = getInputCalibration();
  if (calibration) {
    report(
      `5) ${OK} 当前生效输入校准(动态属性里的持久化值): axisMode=${calibration.axisMode} ` +
        `horizontalSign=${calibration.horizontalSign} depthSign=${calibration.depthSign}`,
    );
    report(
      "§7→ 若对局里左右/前后操作反向:重跑 /bearcade:allstars_calibrate(每步推到底),或清掉" +
        "动态属性 bearcade:allstars_input_calibration 并重启世界,退回 combat-config.ts 默认轴向。",
    );
  } else {
    report(`5) ${WARN} 未校准(当前使用 combat-config.ts 的默认轴向)`);
  }

  // 4) 视觉段 ①(第 0 秒):A/B 对照实体组 + 动画 + 无重力 —— 12 秒内请看向正前方
  //    A 组 = 正前方 1.5 格的单方块探针(判定"客户端实体 + 渲染控制器写法"这一层)
  //    B 组 = 正前方 3 格的春叶模型(待判定对象;落点被方块堵住时按 FALLBACKS 后退)
  const cubePoint = spawnProbeCube(player, report);
  const chunyePoint = spawnProbeEntity(player, report);
  reportAbComparison(report, cubePoint, chunyePoint);
  // 视觉段 ①b:道具模型探针(末影珍珠 + 命令方块,冲刺/大招用的视觉道具)
  spawnPropProbe(player, report);

  // 5) 视觉段 ②(第 1 秒):浮空字 —— 10 秒内请平视正前方
  scheduleProbe(AT_PROBE_TEXT, () => hudProbe(player, report));

  // 6) 视觉段 ③(第 2 秒):相机探测 0.4 秒后自动恢复
  scheduleProbe(AT_PROBE_CAMERA, () => cameraProbe(player, report));

  // 7) 数值段(错开 1~2 秒写入聊天栏,不再一瞬间刷完)
  scheduleProbe(AT_PROBE_INPUT, () => inputProbe(player, report));
  scheduleProbe(AT_PROBE_ARENA, () => arenaProbe(player, report));
  scheduleProbe(AT_PROBE_ARENA, () => packProbe(player, report));
  scheduleProbe(PROBE_ENTITY_TICKS, () =>
    report(`${TAG} 结束(视觉段已收尾;完整数值结论见上方与内容日志)`),
  );
}

/** 注册 `/bearcade:allstars_diag`(需 op tag) */
export function registerAllStarsDiagCommand(): void {
  system.beforeEvents.startup.subscribe((event) => {
    try {
      event.customCommandRegistry.registerCommand(
        {
          name: `bearcade:${GAME_ID}_diag`,
          description: "灯塔全明星自检:配置/动画/实体/相机/HUD/输入/场地",
          permissionLevel: CommandPermissionLevel.Any,
          cheatsRequired: false,
        },
        (origin) => {
          const player = origin.sourceEntity;
          if (!(player instanceof Player)) {
            return {
              status: CustomCommandStatus.Failure,
              message: "该命令只能由玩家执行",
            };
          }
          if (!player.hasTag("op")) {
            return {
              status: CustomCommandStatus.Failure,
              message: "权限不足:需要 op tag(管理员)",
            };
          }
          // restricted execution:所有原生调用延迟到 system.run
          system.run(() => {
            try {
              runDiagnostics(player);
            } catch (error) {
              console.warn("[Bearcade allstars] 自检异常", error);
              tell(player, `§c自检异常:${String(error)}`);
            }
          });
          return {
            status: CustomCommandStatus.Success,
            message: "开始自检:先看 12 秒视觉(A/B 探针:1.5 格方块 vs 3 格春叶),数值结果见聊天栏与内容日志…",
          };
        },
      );
    } catch (error) {
      console.warn("[Bearcade allstars] 注册 diag 命令失败", error);
    }
  });
}
