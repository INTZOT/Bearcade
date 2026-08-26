/**
 * 生成 UUID v4（用于内部对象标识，非 manifest UUID）
 */
 export function generateUUID(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === "x" ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  
  /**
   * 计算两点间距离
   */
  export function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /** Minecraft 颜色名称 → 颜色代码映射 */
export const MINECRAFT_COLOR_CODES: Record<string, string> = {
  black:        '§0',
  dark_blue:    '§1',
  dark_green:   '§2',
  dark_aqua:    '§3',
  dark_red:     '§4',
  dark_purple:  '§5',
  gold:         '§6',
  gray:         '§7',
  dark_gray:    '§8',
  blue:         '§9',
  green:        '§a',
  aqua:         '§b',
  red:          '§c',
  light_purple: '§d',
  yellow:       '§e',
  white:        '§f',
};

/** 根据颜色名获取颜色代码，未知名称默认返回白色 §f */
export function getColorCode(colorName: string): string {
  return MINECRAFT_COLOR_CODES[colorName.toLowerCase()] ?? '§f';
}
  