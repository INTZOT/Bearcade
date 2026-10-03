// ============================================================
// 输入轴向**游戏内校准**:`/bearcade:allstars_calibrate`
//
// 为什么需要它:
//   `player.inputInfo.getMovementVector()` 返回 Vector2,但官方 d.ts
//   **没有定义 x/y 的语义**(哪个分量是左右、哪个是前后,以及正负方向),
//   也没说它是"相机相对"还是"世界相对"。原方案靠 combat-config.ts 的
//   INPUT_AXIS_MODE 硬编码假设,错了要改代码 + 重新构建部署。
//
// 本文件把这件事变成一条命令:
//   在游戏里按提示"前推 / 右推 / 后拉"各保持 1.5 秒,脚本对三步分别取
//   平均向量,自动解出 { axisMode, horizontalSign, depthSign },写入
//   world 动态属性(INPUT_CALIBRATION_KEY)持久化,并同时刷新模块级缓存
//   ⇒ **无需重启世界、无需重新部署**立即生效。
//
// 失败策略(实机事故后收紧):
//   任何一步样本不足 / 分不开两轴 / 太斜 ⇒ **判校准失败,不写入任何数据**,
//   旧校准值继续生效(绝不"猜符号":曾用后拉反推兜底,写出过错误的
//   horizontalSign=-1 并被持久化)。玩家可重跑本命令以最新一次为准。
//
// 语义契约(与 input.ts / combat-config.ts 严格一致):
//   前推时 intent.depth > 0;右推时 intent.horizontal > 0。
//   - axisMode      :"前后轴"落在原始哪个分量上("y_horizontal" ⇒ 前后轴是 y)
//   - depthSign     :depth = (前后轴原始分量) * depthSign(**显式带符号,
//                     不再有旧代码里的隐含 `-(…)`**)
//   - horizontalSign:horizontal = (左右轴原始分量) * horizontalSign
//
// 纪律:所有原生调用都在 `system.run` / 回调链内(restricted execution)。
// ============================================================
import {
  CommandPermissionLevel,
  CustomCommandStatus,
  Player,
  system,
  world,
} from "@minecraft/server";
import {
  CALIBRATION_MAX_COS,
  CALIBRATION_MIN_MAGNITUDE,
  CALIBRATION_STEP_TICKS,
  INPUT_CALIBRATION_KEY,
  INPUT_DEADZONE,
} from "./combat-config";
import type { InputAxisMode } from "./combat-config";

const TAG = "§6[校准]§r";

/** probe 命令 id(提示语里用;不 import input.ts,避免循环依赖) */
const PROBE_IDS = "allstars:probe";

/**
 * 前推"前后轴"分量占前推模长的最低比例:低于该值说明玩家是**斜推**,
 * "前后轴落在哪个原始分量上"的判定不可信 → 判校准失败(不写入)。
 */
const DOMINANCE_MIN_RATIO = 0.75;

/** 一次实测得到的轴向映射(同时也是持久化到动态属性的 JSON 结构) */
export interface InputCalibration {
  /** 前后轴落在原始哪个分量上 */
  axisMode: InputAxisMode;
  /** 左右轴符号:horizontal = 左右轴原始分量 * horizontalSign */
  horizontalSign: 1 | -1;
  /** 前后轴符号:depth = 前后轴原始分量 * depthSign(正 = 朝对手 = 前) */
  depthSign: 1 | -1;
}

/** 模块级缓存:`undefined` = 未校准(退回 combat-config 默认值) */
let cachedCalibration: InputCalibration | undefined;

/**
 * 从世界动态属性读取校准结果(世界加载时调一次即可)。
 * 不存在 / 解析失败 / 字段非法 ⇒ 缓存为 undefined,**不抛错**。
 */
export function loadInputCalibration(): void {
  cachedCalibration = undefined;
  try {
    const raw = world.getDynamicProperty(INPUT_CALIBRATION_KEY);
    if (typeof raw !== "string" || raw.length === 0) return;
    const parsed: unknown = JSON.parse(raw);
    if (isInputCalibration(parsed)) cachedCalibration = parsed;
    else console.warn("[Bearcade allstars] 输入校准数据字段非法,已退回默认轴向");
  } catch (error) {
    console.warn("[Bearcade allstars] 读取输入校准失败(退回默认轴向)", error);
  }
}

/** 当前生效的校准结果;`undefined` = 未校准(调用方退回默认常量) */
export function getInputCalibration(): InputCalibration | undefined {
  return cachedCalibration;
}

function isInputCalibration(value: unknown): value is InputCalibration {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const axisMode = record.axisMode;
  if (axisMode !== "x_horizontal" && axisMode !== "y_horizontal") return false;
  return isSign(record.horizontalSign) && isSign(record.depthSign);
}

function isSign(value: unknown): value is 1 | -1 {
  return value === 1 || value === -1;
}

// ============================================================
// 采样与结算
// ============================================================

interface AxisSample {
  /** 采样到的 x 累加 */
  sumX: number;
  /** 采样到的 y 累加 */
  sumY: number;
  /** 有效样本数(只统计模长 > INPUT_DEADZONE 的 tick) */
  count: number;
}

interface StepDef {
  /** 聊天栏提示语 */
  prompt: string;
  /** 内容日志摘要里的短名 */
  label: string;
}

/** 三步动作定义:① 前推 ② 右推 ③ 后拉 */
const STEPS: StepDef[] = [
  { prompt: "① 请把摇杆/按键**向前推**(朝屏幕上方)并保持 1.5 秒", label: "前推" },
  { prompt: "② 请**向右推**并保持 1.5 秒", label: "右推" },
  { prompt: "③ 请**向后拉**并保持 1.5 秒", label: "后拉" },
];

interface CalibrationSession {
  player: Player;
  /** 当前步:0=前推 1=右推 2=后拉 */
  step: number;
  /** 本步已采样 tick */
  ticks: number;
  /** 三步累加器 */
  samples: AxisSample[];
  runId: number;
  running: boolean;
}

/** 玩家 id → 进行中的校准(重复执行命令以最新一次为准) */
const sessions = new Map<string, CalibrationSession>();

function echo(player: Player, line: string): void {
  try {
    player.sendMessage(line);
  } catch {
    // 玩家离线:忽略
  }
  console.warn(`[Bearcade allstars calib] ${line.replace(/§./g, "")}`);
}

function report(player: Player, line: string): void {
  echo(player, `${TAG} ${line}`);
}

/** 校准期间的"现在推到哪了"提示:动作检测权限异常时能一眼看出来 */
function statusLine(vector: { x: number; y: number }): string {
  const magnitude = Math.hypot(vector.x, vector.y);
  if (magnitude <= INPUT_DEADZONE) {
    return "§c没读到推杆(原始向量接近 0)§r";
  }
  return `§a已读到推杆§r raw=(${vector.x.toFixed(2)}, ${vector.y.toFixed(2)})`;
}

function emptySample(): AxisSample {
  return { sumX: 0, sumY: 0, count: 0 };
}

/** 启动三步引导(由命令回调在 system.run 内调用) */
function startCalibration(player: Player): void {
  cancelSession(player.id);

  const session: CalibrationSession = {
    player,
    step: 0,
    ticks: 0,
    samples: [emptySample(), emptySample(), emptySample()],
    runId: -1,
    running: true,
  };
  sessions.set(player.id, session);

  report(
    player,
    `§e开始输入轴向校准(共 3 步,每步 ${Math.round(CALIBRATION_STEP_TICKS / 20)} 秒)§r;` +
      "请**只推一个方向**、推到底并保持,中途松手会记到零样本。",
  );
  report(player, STEPS[0].prompt);

  try {
    session.runId = system.runInterval(() => {
      sampleTick(session);
    }, 1);
  } catch (error) {
    session.running = false;
    sessions.delete(player.id);
    report(player, `§c启动采样失败:${String(error)}`);
  }
}

/** 停掉某个玩家进行中的校准(不结算) */
function cancelSession(playerId: string): void {
  const existing = sessions.get(playerId);
  if (!existing) return;
  sessions.delete(playerId);
  if (!existing.running) return;
  existing.running = false;
  try {
    system.clearRun(existing.runId);
  } catch {
    // 已被引擎回收,忽略
  }
}

function isOnline(player: Player): boolean {
  try {
    return player.isValid;
  } catch {
    return false;
  }
}

/** 每 tick 采样:累加当前步的原始向量,步满则推进/结算 */
function sampleTick(session: CalibrationSession): void {
  if (!session.running) return;

  if (!isOnline(session.player)) {
    session.running = false;
    sessions.delete(session.player.id);
    try {
      system.clearRun(session.runId);
    } catch {
      // 忽略
    }
    return;
  }

  const sample = session.samples[session.step];
  if (!sample) {
    finishSession(session);
    return;
  }

  let vector: { x: number; y: number } = { x: 0, y: 0 };
  try {
    const raw = session.player.inputInfo.getMovementVector();
    vector = {
      x: Number.isFinite(raw.x) ? raw.x : 0,
      y: Number.isFinite(raw.y) ? raw.y : 0,
    };
  } catch {
    // 读不到就按零样本计,最后会判失败并给出排查提示
  }
  if (Math.hypot(vector.x, vector.y) > INPUT_DEADZONE) {
    sample.sumX += vector.x;
    sample.sumY += vector.y;
    sample.count += 1;
  }

  session.ticks += 1;
  if (session.ticks < CALIBRATION_STEP_TICKS) {
    // 每 10 tick 反馈一次"是否读到推杆",权限/设备异常时不用等结算
    if (session.ticks % 10 === 0) {
      echo(session.player, `§7[校准] 采样中…(第 ${session.step + 1}/3 步)${statusLine(vector)}`);
    }
    return;
  }

  const summary = summarize(sample);
  echo(
    session.player,
    `§7[校准] 第 ${session.step + 1}/3 步(${STEPS[session.step]?.label ?? "?"})完成:` +
      `平均向量=(${summary.fx.toFixed(2)}, ${summary.fy.toFixed(2)}) 样本=${sample.count}`,
  );

  session.step += 1;
  session.ticks = 0;
  if (session.step < STEPS.length) {
    report(session.player, STEPS[session.step]?.prompt ?? "");
    return;
  }
  finishSession(session);
}

interface StepSummary {
  fx: number;
  fy: number;
  magnitude: number;
  count: number;
}

function summarize(sample: AxisSample): StepSummary {
  if (sample.count <= 0) {
    return { fx: 0, fy: 0, magnitude: 0, count: 0 };
  }
  const fx = sample.sumX / sample.count;
  const fy = sample.sumY / sample.count;
  return { fx, fy, magnitude: Math.hypot(fx, fy), count: sample.count };
}

function finishSession(session: CalibrationSession): void {
  session.running = false;
  sessions.delete(session.player.id);
  try {
    system.clearRun(session.runId);
  } catch {
    // 忽略
  }
  try {
    settle(session);
  } catch (error) {
    console.warn("[Bearcade allstars] 校准结算异常", error);
    report(session.player, `§c校准结算异常:${String(error)}`);
  }
}

/**
 * 结算:三步平均向量 → { axisMode, horizontalSign, depthSign }。
 *
 * 判据(与 input.ts 的 deriveIntent 严格对应):
 *   axisMode      :|F.y| > |F.x| ⇒ 前后轴落在 y ⇒ 左右轴是 x ⇒ "x_horizontal";否则 "y_horizontal"
 *   depthSign     :F 在前后轴上的**带符号**分量符号(depth = raw * depthSign ⇒ F ⇒ depth > 0)
 *   horizontalSign:R 在左右轴上的**带符号**分量符号(R ⇒ horizontal > 0)
 *
 * 纪律(after 实机事故):**样本不足就判失败,绝不猜符号**。
 *   早先版本在"右推"太弱时会用 -B(后拉的反推)兜底,结果是:右推样本没读到时
 *   反推出 horizontalSign=-1 并被持久化,玩家存档里的左右操作整体反向。
 *   现在任何一步样本不足/不可信 ⇒ 直接 return,不写入动态属性、不动模块级缓存。
 */
function settle(session: CalibrationSession): void {
  const player = session.player;
  const forward = summarize(session.samples[0] ?? emptySample());
  const right = summarize(session.samples[1] ?? emptySample());
  const back = summarize(session.samples[2] ?? emptySample());
  const pair = (v: StepSummary): string => `(${v.fx.toFixed(2)}, ${v.fy.toFixed(2)})`;

  report(
    player,
    `三步平均向量: 前推 F=${pair(forward)} 右推 R=${pair(right)} 后拉 B=${pair(back)}`,
  );
  report(
    player,
    `样本数: 前推 ${forward.count} 右推 ${right.count} 后拉 ${back.count}(每步满额 ${CALIBRATION_STEP_TICKS})`,
  );

  // 判失败 ⇒ 直接 return,**不写入任何数据**(动态属性与模块级缓存都不动),
  // 因此上一次成功的校准值继续生效。这里统一给出"旧值仍在 + 如何回退默认"的提示。
  const fail = (reason: string): void => {
    echo(
      player,
      `${TAG} §c✗ 校准失败:${
        reason || "没检测到推杆,请重试,并确认动作检测权限正常"
      }§r`,
    );
    echo(
      player,
      `${TAG} §7本次没有写入任何数据:旧校准值仍然生效;` +
        `若要回退默认,清掉动态属性 ${INPUT_CALIBRATION_KEY} 后重启世界。`,
    );
    echo(
      player,
      `${TAG} §7排查:① 用 /scriptevent ${PROBE_IDS} 看原始向量是否有变化;` +
        "② 确认 inputPermissions 的 Movement 权限没被关;" +
        "③ 若显示 raw≈0 ⇒ 动作检测读不到该方向,先把问题报给引擎侧。",
    );
  };

  // ---- 健壮性:三步都必须真的有推杆 ----
  const missing: string[] = [];
  if (forward.count <= 0) missing.push("前推");
  if (right.count <= 0) missing.push("右推");
  if (back.count <= 0) missing.push("后拉");
  if (missing.length > 0) {
    fail(
      `第「${missing.join("、")}」步一个有效样本都没读到(实测样本数 前推 ${forward.count} / ` +
        `右推 ${right.count} / 后拉 ${back.count},每步满额 ${CALIBRATION_STEP_TICKS};` +
        `判据是向量模长 > ${INPUT_DEADZONE})。请重跑本命令,并把推杆推到底、全程不松手,` +
        "同时确认动作检测权限正常。",
    );
    return;
  }

  // ---- 前后轴落在哪个原始分量 ----
  const useYAsDepth = Math.abs(forward.fy) > Math.abs(forward.fx);
  const axisMode: InputAxisMode = useYAsDepth ? "x_horizontal" : "y_horizontal";
  const depthRaw = useYAsDepth ? forward.fy : forward.fx;
  const crossRaw = useYAsDepth ? forward.fx : forward.fy;

  // ---- 健壮性:三步推杆模长都要够大(否则轴归属与符号都不可信) ----
  // 每步单独判、单独报,报错里带**实测数值 + 阈值 + 该重做的动作**,玩家一眼知道错在哪步。
  const stepSeconds = CALIBRATION_STEP_TICKS / 20;
  if (forward.magnitude < CALIBRATION_MIN_MAGNITUDE) {
    fail(
      `第 1 步"向前推"没检测到有效输入(实测模长 ${forward.magnitude.toFixed(2)},` +
        `需 ≥ ${CALIBRATION_MIN_MAGNITUDE})。请重跑本命令,并在第 1 步把摇杆/按键向前推到底、` +
        `保持 ${stepSeconds} 秒。`,
    );
    return;
  }
  if (right.magnitude < CALIBRATION_MIN_MAGNITUDE) {
    fail(
      `第 2 步"向右推"没检测到有效输入(实测模长 ${right.magnitude.toFixed(2)},` +
        `需 ≥ ${CALIBRATION_MIN_MAGNITUDE})。请重跑本命令,并在第 2 步把摇杆/按键向右推到底、` +
        `保持 ${stepSeconds} 秒。`,
    );
    return;
  }
  if (back.magnitude < CALIBRATION_MIN_MAGNITUDE) {
    fail(
      `第 3 步"向后拉"没检测到有效输入(实测模长 ${back.magnitude.toFixed(2)},` +
        `需 ≥ ${CALIBRATION_MIN_MAGNITUDE})。请重跑本命令,并在第 3 步把摇杆/按键向后拉到底、` +
        `保持 ${stepSeconds} 秒。`,
    );
    return;
  }

  // ---- 健壮性:"前推"必须是**准单轴**推杆,否则轴归属不可信 ----
  // depthRaw 是 F 在"前后轴"上的分量;若它只占 F 模长的一小半,说明 F 斜着落在两轴上,
  // 前后/左右的归属本身就不成立(例如相机 45° 摆放)→ 判失败,别把错的映射写进去。
  if (
    Math.abs(depthRaw) < CALIBRATION_MIN_MAGNITUDE ||
    Math.abs(depthRaw) < forward.magnitude * DOMINANCE_MIN_RATIO
  ) {
    fail(
      `前后与左右轴分不开:前推平均向量 ${pair(forward)} 的"前后轴"分量只有 ${depthRaw.toFixed(
        2,
      )},占模长的 ${(Math.abs(depthRaw) / Math.max(forward.magnitude, 1e-6)).toFixed(
        2,
      )}(需 ≥ ${DOMINANCE_MIN_RATIO})——请只推屏幕上下一个方向、推到底。`,
    );
    return;
  }

  // ---- 健壮性:"前推"与"右推"必须几乎正交,否则无法区分两轴 ----
  const cosFR =
    (forward.fx * right.fx + forward.fy * right.fy) /
    Math.max(forward.magnitude * right.magnitude, 1e-6);
  if (Math.abs(cosFR) > CALIBRATION_MAX_COS) {
    fail(
      `前后与左右轴分不开:前推与右推的平均向量几乎同向(cos=${cosFR.toFixed(
        2,
      )},上限 ${CALIBRATION_MAX_COS})——请分别沿屏幕上下、屏幕左右推杆。`,
    );
    return;
  }

  // ---- 健壮性:前推的"另一轴"污染不能太大(斜推会让轴归属不可信) ----
  // 摇杆/手柄即使"直推"也会有小幅横向漂移,所以这里的上限取
  // max(死区, 前后轴分量的 45%)——纯斜推(45°)必然超限,轻微飘逸不受影响。
  const crossLimit = Math.max(
    CALIBRATION_MIN_MAGNITUDE,
    Math.abs(depthRaw) * DOMINANCE_MIN_RATIO,
  );
  if (Math.abs(crossRaw) > crossLimit) {
    fail(
      `前推时明显动到了另一轴(分量 ${crossRaw.toFixed(
        2,
      )},需 ≤ ${crossLimit.toFixed(2)})——请只推屏幕上下一个方向、推到底。`,
    );
    return;
  }

  // ---- 定符号 ----
  // depthSign 由"前推"直接读出。
  const depthSign: 1 | -1 = depthRaw >= 0 ? 1 : -1;

  // horizontalSign 必须由"右推"**在左右轴上的分量**直接读出。
  // ⚠️ 这里绝不能再用"后拉反推"之类的兜底:右推样本太弱时反推出来的符号一旦写错,
  //    会被持久化进存档,导致左右操作整体反向(实机已踩过:得出 horizontalSign=-1)。
  //    样本不足 ⇒ 判校准失败、不写入任何数据。
  const rightRaw = useYAsDepth ? right.fx : right.fy;
  if (Math.abs(rightRaw) < CALIBRATION_MIN_MAGNITUDE) {
    fail(
      `第 2 步"向右推"没检测到有效输入(实测 |raw|=${Math.abs(rightRaw).toFixed(2)},` +
        `需 ≥ ${CALIBRATION_MIN_MAGNITUDE};该轴是 ${useYAsDepth ? "raw.x" : "raw.y"})。` +
        `请重跑本命令,并在第 2 步把摇杆/按键向右推到底、保持 ${stepSeconds} 秒。`,
    );
    // 额外自查线索:右推"有力气、却几乎全落在前后轴上"时,更可能是 axisMode 判错
    // (右推被读成了前推),而不是玩家没推 —— 这时先验证第 1 步是否推得够纯。
    const rightOnDepthAxis = useYAsDepth ? right.fy : right.fx;
    if (Math.abs(rightOnDepthAxis) >= CALIBRATION_MIN_MAGNITUDE) {
      echo(
        player,
        `${TAG} §e另外:这一步在"前后轴"(${useYAsDepth ? "raw.y" : "raw.x"})上的分量反而很大` +
          `(${rightOnDepthAxis.toFixed(2)})。这更像是轴归属判错了(右推被当成前推),而不是你没推。` +
          "请重跑本命令,第 1 步只推屏幕上下、绝不蹭左右(把前方样本推纯),再看本行是否消失。",
      );
    }
    return;
  }
  const horizontalSign: 1 | -1 = rightRaw >= 0 ? 1 : -1;

  const calibration: InputCalibration = { axisMode, horizontalSign, depthSign };

  // ---- 持久化(世界级动态属性)+ 刷新模块级缓存(立即生效) ----
  let stored = true;
  try {
    world.setDynamicProperty(INPUT_CALIBRATION_KEY, JSON.stringify(calibration));
  } catch (error) {
    stored = false;
    console.warn("[Bearcade allstars] 写入输入校准动态属性失败", error);
  }
  cachedCalibration = calibration;

  report(
    player,
    `${stored ? "§a✓ 校准成功" : "§e! 校准成功(但持久化写入失败,重启世界会丢失)"}§r`,
  );
  report(
    player,
    `结论: §baxisMode=${axisMode}§r(前后轴 = ${useYAsDepth ? "raw.y" : "raw.x"}` +
      `,左右轴 = ${useYAsDepth ? "raw.x" : "raw.y"})`,
  );
  report(
    player,
    `结论: §bhorizontalSign=${horizontalSign}§r  ⇒  ` +
      `实测右推·左右轴分量 = ${rightRaw >= 0 ? "+" : ""}${rightRaw.toFixed(2)}` +
      ` ⇒ 右推时 intent.horizontal = ${horizontalSign * rightRaw >= 0 ? "+" : ""}${(horizontalSign * rightRaw).toFixed(2)}` +
      `(${horizontalSign > 0 ? "该轴为正向映射" : "该原始轴为反向,已由 SIGN 翻正"})`,
  );
  report(
    player,
    `结论: §bdepthSign=${depthSign}§r  ⇒  ` +
      `实测前推·前后轴分量 = ${depthRaw >= 0 ? "+" : ""}${depthRaw.toFixed(2)}` +
      ` ⇒ 前推时 intent.depth = ${depthSign * depthRaw >= 0 ? "+" : ""}${(depthSign * depthRaw).toFixed(2)}` +
      `(${depthSign > 0 ? "该轴为正向映射" : "该原始轴为反向,已由 SIGN 翻正"})`,
  );
  echo(
    player,
    `${TAG} §7复核:进对局后推右看角色是否朝屏幕右移动、推前看是否起跳;` +
      "若方向相反,重跑本命令(推到底),或手动把对应 SIGN 翻号。",
  );
  echo(
    player,
    `${TAG} §7可直接粘贴到 combat-config.ts(固化进代码用):§r ` +
      `INPUT_AXIS_MODE = "${axisMode}"; INPUT_HORIZONTAL_SIGN = ${horizontalSign}; INPUT_DEPTH_SIGN = ${depthSign};`,
  );
  echo(
    player,
    `${TAG} §7已持久化(键 ${INPUT_CALIBRATION_KEY}),重启世界仍生效;` +
      `现在可跑 /scriptevent ${PROBE_IDS} 立即复核:前推应 depth>0、右推应 horizontal>0。`,
  );
  echo(
    player,
    `${TAG} §7要恢复默认:清掉动态属性 ${INPUT_CALIBRATION_KEY},然后重启世界` +
      `(或重进模板维度)即退回 combat-config 默认值;重跑一次本命令则以最新校准为准。`,
  );
}

// ============================================================
// 命令注册:`/bearcade:allstars_calibrate`
// ============================================================

/** 注册 `/bearcade:allstars_calibrate`(需 op tag) */
export function registerAllStarsCalibrationCommand(): void {
  system.beforeEvents.startup.subscribe((event) => {
    try {
      event.customCommandRegistry.registerCommand(
        {
          name: "bearcade:allstars_calibrate",
          description: "灯塔全明星:三步引导校准输入轴向(前推/右推/后拉,各 1.5 秒)",
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
              startCalibration(player);
            } catch (error) {
              console.warn("[Bearcade allstars] 校准启动异常", error);
              echo(player, `${TAG} §c校准启动异常:${String(error)}`);
            }
          });
          return {
            status: CustomCommandStatus.Success,
            message: "开始输入轴向校准:请按聊天栏提示推杆(共 3 步)…",
          };
        },
      );
    } catch (error) {
      console.warn("[Bearcade allstars] 注册 calibrate 命令失败", error);
    }
  });
}
