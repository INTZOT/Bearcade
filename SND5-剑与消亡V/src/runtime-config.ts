// ============================================================
// SND5 运行时可调数值(占点模式计分参数面)
// 持久化到 bearcade:config_snd5(shared configStore 类型修复),
// 配合 Core 的 /bearcade:config snd5 可在服务器上热调参;
// 技能/状态等静态内容仍在 content/ 定义文件里。
//
// 产分曲线校算(scoreTarget = 2000,纯占点取胜用时):
//   1 点 1/s → 2000s ≈ 33.3 分钟(超过 20 分钟时限,单点赢不了)
//   2 点 2/s → 1000s ≈ 16.7 分钟
//   3 点 4/s →  500s ≈  8.3 分钟
//   4 点 8/s →  250s ≈  4.2 分钟
//   5 点 16/s → 125s ≈  2.1 分钟
// ============================================================
import { loadGameConfig } from "../../shared/minigame-core/configStore";
import type { Snd5RuntimeConfig } from "./framework/types";

export const SND5_CONFIG_DEFAULTS: Snd5RuntimeConfig = {
  /** 先达到该分数的队伍获胜,到分立即结束 */
  scoreTarget: 2000,
  /** 对局时长上限(秒),到点比总分,平分平局;1200 = 20 分钟 */
  matchSeconds: 1200,
  /** 任意玩家阵亡时对方队伍得分 */
  deathScore: 5,
  /** 占点产分曲线:下标 = 占有点数,值 = 每秒得分(超出按末位) */
  holdScoreRates: [0, 1, 2, 4, 8, 16],
  /** 中立点占领读秒(秒) */
  neutralCaptureSeconds: 20,
  /** 敌方已占点接管读秒(秒) */
  takeoverCaptureSeconds: 40,
  /** 死亡后重生等待(秒) */
  respawnSeconds: 8,
  /** 每 2 秒自然回复魔力(标准规则:1) */
  manaRegenAmount: 1,
  /** 每人使用补给站冷却(秒,标准:20) */
  supplyCooldownSeconds: 20,
  /** 受击反馈(红闪/音效/动画/方向击退) */
  hurtFeedback: true,
};

/** 读取运行时配置(类型修复合并默认值) */
export function loadSnd5Config(): Snd5RuntimeConfig {
  return loadGameConfig("snd5", SND5_CONFIG_DEFAULTS);
}
