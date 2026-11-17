// ============================================================
// 职业注册入口:战士/增益/群法 + 其余 4 职业占位
// ESM import 提升保证先注册的职业排序靠前(可读性更好,
// PDF 顺序为 刺客/战士/坦克/增益/控制/群法/单法,占位阶段以可用性区分)。
// ============================================================
import { professionRegistry, type ProfessionDefinition } from "./registry";
import "./warrior";
import "./support";
import "./magus";

/**
 * 未实装职业占位(面板取自 PDF,选择界面显示「开发中」)。
 * 增益(professions/support.ts)与群法(professions/magus.ts)已实装,不在此列。
 */
const PLACEHOLDER_PROFESSIONS: ProfessionDefinition[] = [
  {
    id: "snd5:assassin",
    displayName: "刺客",
    tagline: "高移速 · DOT · 破甲",
    base: { hp: 70, armor: 30, mana: 70 },
    available: false,
    weapon: { itemTypeId: "minecraft:iron_sword", name: "横刀·离心", lore: [] },
    skills: [],
    passiveIds: [],
  },
  {
    id: "snd5:tank",
    displayName: "坦克",
    tagline: "火属性 · 创生物 · 减伤",
    base: { hp: 120, armor: 70, mana: 90 },
    available: false,
    weapon: { itemTypeId: "minecraft:iron_sword", name: "阔剑·征服", lore: [] },
    skills: [],
    passiveIds: [],
  },
  {
    id: "snd5:controller",
    displayName: "控制",
    tagline: "水属性 · 控制 · 清效果",
    base: { hp: 70, armor: 70, mana: 140 },
    available: false,
    weapon: { itemTypeId: "minecraft:iron_sword", name: "筒型魔杖·不等式", lore: [] },
    skills: [],
    passiveIds: [],
  },
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
