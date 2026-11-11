// ============================================================
// SND5 运行时可调数值(修改意见⑥:分数制胜负的参数面)
// 持久化到 bearcade:config_snd5(shared configStore 类型修复),
// 配合 Core 的 /bearcade:config snd5 可在服务器上热调参;
// 技能/状态等静态内容仍在 content/ 定义文件里。
// ============================================================
import { loadGameConfig } from "../../shared/minigame-core/configStore";
import type { Snd5RuntimeConfig } from "./framework/types";

export const SND5_CONFIG_DEFAULTS: Snd5RuntimeConfig = {
  /** 先达到该分数的队伍获胜(战争领主风格默认:击杀 100 / 占点 200) */
  scoreTarget: 150,
  /** 对局时长上限(秒),到点按当前分数判定;600 = 10 分钟 */
  matchSeconds: 600,
  /** 死亡后重生等待(秒) */
  respawnSeconds: 8,
  /** 每 2 秒自然回复魔力(标准规则:1) */
  manaRegenAmount: 1,
  /** 每人使用补给站冷却(秒,标准:20) */
  supplyCooldownSeconds: 20,
  /** 占点读秒(秒) */
  captureDelaySeconds: 10,
  /** 驻守得分间隔(秒),0 = 关闭 */
  holdScoreIntervalSeconds: 10,
};

/** 读取运行时配置(类型修复合并默认值) */
export function loadSnd5Config(): Snd5RuntimeConfig {
  return loadGameConfig("snd5", SND5_CONFIG_DEFAULTS);
}
