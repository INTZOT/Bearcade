import { world } from "@minecraft/server";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 用默认值修复持久化值:类型不匹配/损坏的字段回退默认值,未知字段(旧版本残留)丢弃。
 * 防止动态属性被写坏(如 prepSpawn 被存成字符串)后以坏值继续运行。
 */
function repairValue(defaults: unknown, value: unknown): unknown {
  if (Array.isArray(defaults)) {
    return Array.isArray(value) ? value : defaults;
  }
  if (isPlainObject(defaults)) {
    if (!isPlainObject(value)) return defaults;
    const out: Record<string, unknown> = { ...defaults };
    for (const key of Object.keys(defaults)) {
      if (key in value) out[key] = repairValue(defaults[key], value[key]);
    }
    return out;
  }
  if (typeof value !== typeof defaults || value === null) return defaults;
  return value;
}

/** 读取游戏运行时配置(动态属性持久化,与代码默认值合并并经类型修复) */
export function loadGameConfig<T extends object>(
  gameId: string,
  defaults: T,
): T {
  try {
    const raw = world.getDynamicProperty(`bearcade:config_${gameId}`);
    if (typeof raw !== "string" || raw.length === 0) return { ...defaults };
    const parsed = JSON.parse(raw) as unknown;
    return repairValue(defaults, parsed) as T;
  } catch {
    return { ...defaults };
  }
}

export function saveGameConfig(gameId: string, config: object): void {
  world.setDynamicProperty(`bearcade:config_${gameId}`, JSON.stringify(config));
}
