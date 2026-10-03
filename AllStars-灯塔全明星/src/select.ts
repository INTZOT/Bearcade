// ============================================================
// 选人阶段(DDUI CustomForm)
//
// M1 只有「春叶」一个角色,但流程按"以后会有多个"设计:
//   - 角色表 characters 是数组,加一行就多一个选项;
//   - 每人各出一份选择结果(selected: Map<playerId, characterId>);
//   - 兜底:超时或表单异常按默认角色开打,避免一人挂机把房间卡死。
// ============================================================

import type { Player } from "@minecraft/server";
import { CustomForm } from "@minecraft/server-ui";
import { CHUNYE_CLIPS } from "./data/chunye.clips";

export interface CharacterDef {
  id: string;
  name: string;
  /** 角色实体标识(目前统一用春叶实体) */
  entityId: string;
  /** 简介,表单里显示 */
  blurb: string;
}

export const DEFAULT_CHARACTER_ID = "chunye";

/** M1 角色表(只有春叶) */
export const CHARACTERS: CharacterDef[] = [
  {
    id: "chunye",
    name: "春叶",
    entityId: "bearcade:allstars_chunye",
    blurb: "绿贝雷格斗家 · 86 段原生动画 · 轻/中/重/投/发波/大招",
  },
];

export function findCharacter(id: string): CharacterDef | undefined {
  return CHARACTERS.find((item) => item.id === id) ?? CHARACTERS[0];
}

export function characterCount(): number {
  return CHARACTERS.length;
}

/** 角色动画数量(表单里做一句"已就绪"的提示,便于实机确认资源包加载) */
export function characterClipCount(): number {
  return Object.keys(CHUNYE_CLIPS).length;
}

export interface SelectResult {
  playerId: string;
  characterId: string;
  /** true = 玩家真的点了按钮;false = 超时/关窗兜底默认角色 */
  confirmed: boolean;
}

/**
 * 给单个玩家弹出选人表单。
 * @returns 选择结果;表单被关闭/异常时返回 undefined(由 Match 重试或超时兜底)
 */
export async function openSelectForm(
  player: Player,
): Promise<SelectResult | undefined> {
  if (CHARACTERS.length === 0) return undefined;
  return new Promise<SelectResult | undefined>((resolve) => {
    let settled = false;
    const finish = (value: SelectResult | undefined) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    try {
      const form = new CustomForm(player, "灯塔全明星 · 选人");
      form.label(
        `可用角色 ${CHARACTERS.length} 个 · 动画 ${characterClipCount()} 段已载入`,
      );
      form.spacer();
      for (const character of CHARACTERS) {
        form.button(`选择「${character.name}」`, () => {
          try {
            form.close();
          } catch {
            // 表单可能已关闭
          }
          finish({
            playerId: player.id,
            characterId: character.id,
            confirmed: true,
          });
        });
        form.label(`§7${character.blurb}`);
      }
      form.spacer();
      form.label("§8关闭表单将按默认角色「春叶」准备(超时会自动开始)");

      form
        .show()
        .then(() => {
          // 玩家关掉了表单:不选也算确认默认角色,避免反复弹窗骚扰
          finish({
            playerId: player.id,
            characterId: DEFAULT_CHARACTER_ID,
            confirmed: false,
          });
        })
        .catch((error) => {
          console.warn("[Bearcade allstars] 选人表单异常", error);
          finish(undefined);
        });
    } catch (error) {
      console.warn("[Bearcade allstars] 选人表单构建失败", error);
      finish(undefined);
    }
  });
}

/** 超时/异常兜底:直接给默认角色 */
export function fallbackResult(player: Player): SelectResult {
  return {
    playerId: player.id,
    characterId: DEFAULT_CHARACTER_ID,
    confirmed: false,
  };
}
