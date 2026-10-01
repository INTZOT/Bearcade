/** 防御属性属于招式，不能读取命中时施放者的站姿（飞行波尤其如此）。 */
export type HitLevel = "mid" | "low" | "overhead" | "throw";

export const CHUNYE_HIT_LEVELS: Readonly<Record<string, HitLevel>> = {
  attack_stand_light: "mid", attack_stand_light_2: "mid", attack_stand_light_3: "mid",
  attack_stand_medium: "mid", attack_stand_medium_2: "mid", attack_stand_medium_3: "mid",
  attack_stand_heavy: "mid", attack_stand_heavy_2: "mid", attack_stand_heavy_3: "mid",
  attack_crouch_light: "low", attack_crouch_light_2: "low", attack_crouch_light_3: "low",
  attack_crouch_medium: "low", attack_crouch_medium_2: "low", attack_crouch_medium_3: "low",
  attack_crouch_heavy: "low", attack_crouch_heavy_2: "low", attack_crouch_heavy_3: "low",
  attack_air_light: "overhead", attack_air_light_2: "overhead", attack_air_light_3: "overhead",
  attack_air_medium: "overhead", attack_air_medium_2: "overhead", attack_air_medium_3: "overhead",
  attack_air_heavy: "overhead", attack_air_heavy_2: "overhead", attack_air_heavy_3: "overhead",
  special_leaf_burst: "mid", leaf_rise_start: "mid", leaf_dive_start: "overhead",
  super_1: "mid", super_2: "mid", throw_cast: "throw",
};
