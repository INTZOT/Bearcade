// ============================================================
// 职业注册入口:刺客/战士/坦克/增益/控制/群法 + 其余 1 职业占位
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

/**
 * 未实装职业占位(面板取自 PDF,选择界面显示「开发中」)。
 * 刺客(professions/assassin.ts)、坦克(professions/tank.ts)、增益(professions/support.ts)、
 * 控制(professions/controller.ts)与群法(professions/magus.ts)已实装。
 */
const PLACEHOLDER_PROFESSIONS: ProfessionDefinition[] = [
  {
    id: "snd5:ranger",
    displayName: "单法",
    tagline: "全属性 · 远射程 · 时间回溯",
    base: { hp: 30, armor: 100, mana: 150 },
    available: false,
    weapon: { itemTypeId: "minecraft:iron_sword", name: "环型魔杖·日月", lore: [] },
    skills: [],
    passiveIds: [],
  },
];

for (const stub of PLACEHOLDER_PROFESSIONS) {
  professionRegistry.register(stub);
}
