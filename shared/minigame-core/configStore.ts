import { world } from "@minecraft/server";

/** 读取游戏运行时配置(动态属性持久化,与代码默认值合并) */
export function loadGameConfig<T extends object>(
  gameId: string,
  defaults: T,
): T {
  try {
    const raw = world.getDynamicProperty(`bearcade:config_${gameId}`);
    if (typeof raw !== "string" || raw.length === 0) return { ...defaults };
    const parsed = JSON.parse(raw) as Partial<T>;
    return { ...defaults, ...parsed };
  } catch {
    return { ...defaults };
  }
}

export function saveGameConfig(gameId: string, config: object): void {
  world.setDynamicProperty(`bearcade:config_${gameId}`, JSON.stringify(config));
}
