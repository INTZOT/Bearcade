// ============================================================
// 职业注册入口: 刺客/战士/坦克/增益/控制/群法/单法
// ESM import 提升保证先注册的职业排序靠前(可读性更好,
// PDF 顺序为 刺客/战士/坦克/增益/控制/群法/单法,占位阶段以可用性区分)。
// ============================================================
import { professionRegistry, type ProfessionDefinition } from "./registry";
import "./assassin";
import "./warrior";
import "./tank";
import "./support";
import "./controller";
import "./magus";
import "./ranger";

/**
 * 未实装职业占位(面板取自 PDF,选择界面显示「开发中」)。
 * 增益(professions/support.ts)、控制(professions/controller.ts)、
 * 群法(professions/magus.ts)与单法(professions/ranger.ts)已实装,不在此列。
 */
const PLACEHOLDER_PROFESSIONS: ProfessionDefinition[] = [

];

for (const stub of PLACEHOLDER_PROFESSIONS) {
  professionRegistry.register(stub);
}
