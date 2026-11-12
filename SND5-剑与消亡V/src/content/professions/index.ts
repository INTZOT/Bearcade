// ============================================================
// 职业注册入口:战士 + 其余 6 职业占位
// ESM import 提升保证战士先注册(选择界面排序靠前可读性更好,
// PDF 顺序为 刺客/战士/坦克/增益/控制/群法/单法,占位阶段以可用性区分)。
// ============================================================
import { professionRegistry, type ProfessionDefinition } from "./registry";
import "./warrior";

/** 未实装职业占位(面板取自 PDF,选择界面显示「开发中」) */
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
    id: "snd5:support",
    displayName: "增益",
    tagline: "水属性 · 治疗 · 净化",
    base: { hp: 140, armor: 20, mana: 120 },
    available: false,
    weapon: { itemTypeId: "minecraft:iron_sword", name: "梭型魔杖·水仙之梦", lore: [] },
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
    id: "snd5:magus",
    displayName: "群法",
    tagline: "多属性 · 自循环 · AOE",
    base: { hp: 100, armor: 15, mana: 160 },
    available: false,
    weapon: { itemTypeId: "minecraft:iron_sword", name: "球型魔杖·周期", lore: [] },
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
