// ============================================================
// CustomItemStack:/cis 手持物品属性编辑
// 玩家手持物品执行 /cis,打开表单直接修改主手 ItemStack 的
// 全部可写属性(数量/名称/Lore/附魔/可摧毁/可放置/
// 耐久/锁定等),写回主手,不发放新物品。
// ============================================================
import {
  EnchantmentType,
  ItemLockMode,
  ItemStack,
  system,
  type Player,
} from "@minecraft/server";
import {
  CustomForm,
  ObservableBoolean,
  ObservableNumber,
  ObservableString,
} from "@minecraft/server-ui";

// 附魔 ID 硬编码(原版 42 种,与 vanilla-data 枚举一致)。
// 不 import @minecraft/vanilla-data:该原生模块在 1.26.42 引擎中版本不匹配会被拒载。
const VANILLA_ENCHANTMENTS: { label: string; zh: string; id: string }[] = [
  { label: "AquaAffinity", zh: "水下速掘", id: "minecraft:aqua_affinity" },
  { label: "BaneOfArthropods", zh: "节肢杀手", id: "minecraft:bane_of_arthropods" },
  { label: "Binding", zh: "绑定诅咒", id: "minecraft:binding" },
  { label: "BlastProtection", zh: "爆炸保护", id: "minecraft:blast_protection" },
  { label: "BowInfinity", zh: "无限", id: "minecraft:infinity" },
  { label: "Breach", zh: "破甲", id: "minecraft:breach" },
  { label: "Channeling", zh: "引雷", id: "minecraft:channeling" },
  { label: "Density", zh: "致密", id: "minecraft:density" },
  { label: "DepthStrider", zh: "深海探索者", id: "minecraft:depth_strider" },
  { label: "Efficiency", zh: "效率", id: "minecraft:efficiency" },
  { label: "FeatherFalling", zh: "摔落保护", id: "minecraft:feather_falling" },
  { label: "FireAspect", zh: "火焰附加", id: "minecraft:fire_aspect" },
  { label: "FireProtection", zh: "火焰保护", id: "minecraft:fire_protection" },
  { label: "Flame", zh: "火矢", id: "minecraft:flame" },
  { label: "Fortune", zh: "时运", id: "minecraft:fortune" },
  { label: "FrostWalker", zh: "冰霜行者", id: "minecraft:frost_walker" },
  { label: "Impaling", zh: "穿刺", id: "minecraft:impaling" },
  { label: "Knockback", zh: "击退", id: "minecraft:knockback" },
  { label: "Looting", zh: "抢夺", id: "minecraft:looting" },
  { label: "Loyalty", zh: "忠诚", id: "minecraft:loyalty" },
  { label: "LuckOfTheSea", zh: "海之眷顾", id: "minecraft:luck_of_the_sea" },
  { label: "Lunge", zh: "突刺", id: "minecraft:lunge" },
  { label: "Lure", zh: "饵钓", id: "minecraft:lure" },
  { label: "Mending", zh: "经验修补", id: "minecraft:mending" },
  { label: "Multishot", zh: "多重射击", id: "minecraft:multishot" },
  { label: "Piercing", zh: "穿透", id: "minecraft:piercing" },
  { label: "Power", zh: "力量", id: "minecraft:power" },
  { label: "ProjectileProtection", zh: "弹射物保护", id: "minecraft:projectile_protection" },
  { label: "Protection", zh: "保护", id: "minecraft:protection" },
  { label: "Punch", zh: "冲击", id: "minecraft:punch" },
  { label: "QuickCharge", zh: "快速装填", id: "minecraft:quick_charge" },
  { label: "Respiration", zh: "水下呼吸", id: "minecraft:respiration" },
  { label: "Riptide", zh: "激流", id: "minecraft:riptide" },
  { label: "Sharpness", zh: "锋利", id: "minecraft:sharpness" },
  { label: "SilkTouch", zh: "精准采集", id: "minecraft:silk_touch" },
  { label: "Smite", zh: "亡灵杀手", id: "minecraft:smite" },
  { label: "SoulSpeed", zh: "灵魂疾行", id: "minecraft:soul_speed" },
  { label: "SwiftSneak", zh: "迅捷潜行", id: "minecraft:swift_sneak" },
  { label: "Thorns", zh: "荆棘", id: "minecraft:thorns" },
  { label: "Unbreaking", zh: "耐久", id: "minecraft:unbreaking" },
  { label: "Vanishing", zh: "消失诅咒", id: "minecraft:vanishing" },
  { label: "WindBurst", zh: "风爆", id: "minecraft:wind_burst" },
];

/** 按名称解析附魔:支持 sharpness 5、minecraft:sharpness 5、Sharpness:5、锋利 5 等写法 */
function parseEnchantList(text: string): {
  enchantments: { id: string; level: number }[];
  unknown: string[];
} {
  const enchantments: { id: string; level: number }[] = [];
  const unknown: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^([^\s:]+):?\s*(\d*)$/.exec(line);
    if (!match) {
      unknown.push(line);
      continue;
    }
    const rawName = match[1].toLowerCase().replace("minecraft:", "").replace(/_/g, "");
    const level =
      match[2] && /^\d+$/.test(match[2])
        ? Math.max(1, Math.min(255, Number(match[2])))
        : 1;
    // 匹配顺序:完整 ID > 英文枚举名(忽略大小写/下划线)> 中文名
    const found =
      VANILLA_ENCHANTMENTS.find((e) => e.id === `minecraft:${rawName}`) ??
      VANILLA_ENCHANTMENTS.find((e) => e.label.toLowerCase() === rawName) ??
      VANILLA_ENCHANTMENTS.find((e) => e.zh === match[1]);
    if (found) {
      enchantments.push({ id: found.id, level });
    } else {
      unknown.push(line);
    }
  }
  return { enchantments, unknown };
}

/** 附魔名简称(去 minecraft: 前缀),用于提示文案 */
function shortEnchantId(id: string): string {
  return id.replace("minecraft:", "");
}

/** 物品属性(提交给应用逻辑的完整集合) */
interface ItemProps {
  amount?: number;
  nameTag: string;
  lore: string;
  enchantments: { id: string; level: number }[];
  canDestroy: string[];
  canPlaceOn: string[];
  unbreakable: boolean;
  durabilityDamage?: number;
  keepOnDeath: boolean;
  lockMode: ItemLockMode;
}

const LOCK_OPTIONS: { label: string; value: ItemLockMode }[] = [
  { label: "不锁定", value: ItemLockMode.none },
  { label: "锁定快捷栏槽位", value: ItemLockMode.slot },
  { label: "锁定物品栏", value: ItemLockMode.inventory },
];

/**
 * 对物品栈应用全部属性。返回 false 表示硬失败(附魔全败/参数错误)需中止。
 */
function applyProperties(
  stack: ItemStack,
  player: Player,
  input: ItemProps,
): boolean {
  if (input.amount !== undefined) {
    try {
      stack.amount = Math.max(1, Math.min(255, Math.round(input.amount)));
    } catch (error) {
      player.sendMessage(`§e该物品不支持该数量,已忽略:${error}`);
    }
  }
  if (input.nameTag.trim()) {
    stack.nameTag = input.nameTag.trim();
  }
  const loreLines = input.lore
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (loreLines.length > 0) {
    stack.setLore(loreLines);
  }

  if (input.canDestroy.length > 0) {
    try {
      stack.setCanDestroy(input.canDestroy);
    } catch (error) {
      player.sendMessage(`§c设置可摧毁方块失败:${error}`);
      return false;
    }
  }
  if (input.canPlaceOn.length > 0) {
    try {
      stack.setCanPlaceOn(input.canPlaceOn);
    } catch (error) {
      player.sendMessage(`§c设置可放置方块失败:${error}`);
      return false;
    }
  }
  if (input.enchantments.length > 0) {
    const enchantable = stack.getComponent("minecraft:enchantable");
    if (!enchantable) {
      player.sendMessage("§c该物品不支持附魔");
      return false;
    }
    const ok: string[] = [];
    const failed: string[] = [];
    for (const entry of input.enchantments) {
      const enchantment = {
        type: new EnchantmentType(entry.id),
        level: entry.level,
      };
      try {
        if (!enchantable.canAddEnchantment(enchantment)) {
          failed.push(
            `${shortEnchantId(entry.id)} Lv.${entry.level}(与已有附魔冲突)`,
          );
          continue;
        }
        enchantable.addEnchantment(enchantment);
        ok.push(`${shortEnchantId(entry.id)} Lv.${entry.level}`);
      } catch (error) {
        failed.push(`${shortEnchantId(entry.id)} Lv.${entry.level}(${error})`);
      }
    }
    if (ok.length > 0) {
      player.sendMessage(`§a已附魔:${ok.join("、")}`);
    }
    if (failed.length > 0) {
      player.sendMessage(`§c附魔失败:${failed.join("、")}`);
      if (ok.length === 0) return false;
    }
  }
  if (input.unbreakable) {
    const durability = stack.getComponent("minecraft:durability");
    if (durability) {
      durability.unbreakable = true;
    } else {
      player.sendMessage("§e该物品无耐久组件,已忽略『不可破坏』");
    }
  }
  if (input.durabilityDamage !== undefined) {
    const durability = stack.getComponent("minecraft:durability");
    if (durability) {
      durability.damage = Math.max(
        0,
        Math.min(
          durability.maxDurability,
          Math.round(input.durabilityDamage),
        ),
      );
    } else {
      player.sendMessage("§e该物品无耐久组件,已忽略耐久损坏值");
    }
  }
  stack.keepOnDeath = input.keepOnDeath;
  stack.lockMode = input.lockMode;
  return true;
}

/** 炼药锅染色辅助:发水桶 + 匹配染料 + 操作步骤 */
function giveCauldronAssist(player: Player, dyeId: string): void {
  const container = player.getComponent("minecraft:inventory")?.container;
  if (container) {
    container.addItem(new ItemStack("minecraft:water_bucket", 1));
    if (dyeId) container.addItem(new ItemStack(dyeId, 1));
  }
  player.sendMessage(
    `§e当前版本 SAPI 无法直接给原版皮革装备染色,已发水桶${dyeId ? "+染料" : ""}。` +
      "炼药锅染色:放锅→水桶倒水→染料丢进锅→手持皮革装备点锅。",
  );
}

/** 对玩家主手物品应用属性并写回 */
function applyToHeldItem(player: Player, input: ItemProps): void {
  const container = player.getComponent("minecraft:inventory")?.container;
  if (!container) {
    player.sendMessage("§c背包不可用");
    return;
  }
  const slot = player.selectedSlotIndex;
  const held = container.getItem(slot);
  if (!held) {
    player.sendMessage("§c请先手持一个物品");
    return;
  }

  if (!applyProperties(held, player, input)) return;

  // 写回前重新校验主手槽位未被换走
  const now = container.getItem(slot);
  if (!now || now.typeId !== held.typeId) {
    player.sendMessage("§c主手物品已变化,未写回,请重试");
    return;
  }
  try {
    container.setItem(slot, held);
  } catch (error) {
    player.sendMessage(`§c写回主手失败:${error}`);
    return;
  }
  player.sendMessage(`§a已应用到主手物品 §6${held.nameTag ?? held.typeId}`);
  player.playSound("random.orb");
}

/** 附魔译名参考(独立界面):英文名 → 中文名 */
export function openEnchantReference(player: Player): void {
  const form = new CustomForm(player, "附魔译名参考");
  form.label("§7英文名 → 中文名(共 42 种,附魔列表可直接输入中文名)");
  form.spacer();
  for (const e of VANILLA_ENCHANTMENTS) {
    form.label(`§f${e.label} §7→ §e${e.zh}`);
    form.spacer();
  }
  form.spacer();
  form.button("返回", () => {
    form.close();
    system.runTimeout(() => openCisForm(player), 2);
  });
  form.show().catch((e) => console.warn("Enchant reference form failed:", e));
}

/** CustomItemStack 主表单:读取主手物品,编辑全部 ItemStack 属性 */
export function openCisForm(player: Player): void {
  const container = player.getComponent("minecraft:inventory")?.container;
  if (!container) {
    player.sendMessage("§c背包不可用");
    return;
  }
  const slot = player.selectedSlotIndex;
  const held = container.getItem(slot);
  if (!held) {
    player.sendMessage("§c请先手持一个物品");
    return;
  }
  const durabilityComp = held.getComponent("minecraft:durability");

  const amountObs = new ObservableString(String(held.amount), {
    clientWritable: true,
  });
  const nameObs = new ObservableString(held.nameTag ?? "", {
    clientWritable: true,
  });
  const loreObs = new ObservableString(held.getLore().join("\n"), {
    clientWritable: true,
  });
  const enchantListObs = new ObservableString("", { clientWritable: true });
  const canDestroyObs = new ObservableString(held.getCanDestroy().join(","), {
    clientWritable: true,
  });
  const canPlaceOnObs = new ObservableString(held.getCanPlaceOn().join(","), {
    clientWritable: true,
  });
  const unbreakableObs = new ObservableBoolean(
    durabilityComp?.unbreakable ?? false,
    { clientWritable: true },
  );
  const damageObs = new ObservableString(
    durabilityComp ? String(durabilityComp.damage) : "",
    { clientWritable: true },
  );
  const keepObs = new ObservableBoolean(held.keepOnDeath, {
    clientWritable: true,
  });
  const currentLockIndex = LOCK_OPTIONS.findIndex(
    (o) => o.value === held.lockMode,
  );
  const lockObs = new ObservableNumber(currentLockIndex >= 0 ? currentLockIndex : 0, {
    clientWritable: true,
  });

  const form = new CustomForm(player, "手持物品属性(CustomItemStack)");
  form
    .label(
      `§7当前手持:§f${held.typeId}${held.nameTag ? ` §6「${held.nameTag}」` : ""}`,
    )
    .spacer()
    .textField("数量(1-255,受物品堆叠上限限制)", amountObs)
    .textField("自定义名称(留空不修改)", nameObs)
    .textField("Lore 描述(每行一条,支持 \\n)", loreObs)
    .spacer()
    .textField(
      "附魔列表(每行一个:名称 等级,如 sharpness 5 / 锋利 5)",
      enchantListObs,
    )
    .label("附魔译名参考见下方按钮(英文名 → 中文名,共 42 种)")
    .spacer()
    .textField("可摧毁方块(逗号分隔 ID,如 stone,grass_block)", canDestroyObs)
    .textField("可放置方块(逗号分隔 ID,如 stone,grass_block)", canPlaceOnObs)
    .spacer()
    .toggle("不可破坏(unbreakable)", unbreakableObs)
    .textField("耐久损坏值(0-上限;无耐久组件时忽略)", damageObs)
    .toggle("死亡不掉落(keepOnDeath)", keepObs)
    .dropdown(
      "物品锁定(lockMode)",
      lockObs,
      LOCK_OPTIONS.map((opt, i) => ({ label: opt.label, value: i })),
    )
    .spacer()
    .button("附魔译名参考(英文→中文)", () => {
      form.close();
      system.runTimeout(() => openEnchantReference(player), 2);
    })
    .spacer()
    .button("应用", () => {
      const parsedEnchants = parseEnchantList(enchantListObs.getData());
      if (parsedEnchants.unknown.length > 0) {
        player.sendMessage(
          `§e未识别的附魔行(已忽略):${parsedEnchants.unknown.join("、")}`,
        );
      }

      // 方块 ID 列表(逗号/空格/中文逗号分隔)
      const splitBlocks = (text: string): string[] =>
        text
          .split(/[,，\s]+/)
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s.length > 0);

      // 数量与耐久损坏值(留空或非法时保持原值)
      const amountRaw = Number(amountObs.getData());
      const amount =
        Number.isInteger(amountRaw) && amountRaw >= 1
          ? Math.min(255, amountRaw)
          : undefined;
      const dmgRaw = Number(damageObs.getData());
      const durabilityDamage =
        damageObs.getData().trim() !== "" && Number.isFinite(dmgRaw) && dmgRaw >= 0
          ? dmgRaw
          : undefined;

      applyToHeldItem(player, {
        amount,
        nameTag: nameObs.getData(),
        lore: loreObs.getData(),
        enchantments: parsedEnchants.enchantments,
        canDestroy: splitBlocks(canDestroyObs.getData()),
        canPlaceOn: splitBlocks(canPlaceOnObs.getData()),
        unbreakable: unbreakableObs.getData(),
        durabilityDamage,
        keepOnDeath: keepObs.getData(),
        lockMode: LOCK_OPTIONS[lockObs.getData()]?.value ?? ItemLockMode.none,
      });
      form.close();
      // 留在表单,便于连续修改
      system.runTimeout(() => openCisForm(player), 2);
    })
    .spacer()
    .button("关闭", () => form.close());

  form.show().catch((e) => console.warn("Cis form failed:", e));
}
