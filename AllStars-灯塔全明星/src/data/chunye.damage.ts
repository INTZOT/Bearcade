/** 春叶基础命中伤害。站/蹲/空与三段普攻同档同伤害。 */
export const CHUNYE_DAMAGE = {
  light: 300,
  medium: 600,
  heavy: 850,
  throw: 1200,
  wave: 650,
  rise: 1400,
  dive: 800,
  super1: 2000,
  super2: 2800,
} as const;

/** 七次重击 + 终结：裸放普通三气 4000，残血三气 4500。 */
export const CHUNYE_SUPER_3_DAMAGE = {
  normal: [500, 300, 300, 350, 350, 350, 350, 1500],
  low: [500, 300, 300, 350, 350, 350, 350, 2000],
} as const;
