// ============================================================
// 自定义物品技能触发(架构设计 §5.5 方案 A 的落地)
// 职业技能物品从原版占位升级为自定义物品(items/*.json)后,
// 释放入口改走 ItemCustomComponent 回调 —— 与原版占位的
// nameTag/typeId 全局路由(skillItemBindings)并存:
// - 自定义物品:每个 typeId 唯一对应一个技能,无需 nameTag 匹配,
//   物品名可自由重写(群法定律显示依赖这一点);
// - 组件回调里只读上下文,实际动作经 system.run 延后(restricted
//   execution 纪律,与 listeners.ts 一致)。
// ============================================================
import { system, type ItemStack, type Player, type StartupEvent } from "@minecraft/server";
import { sessions, type MatchSession } from "../session";

/**
 * 自定义技能物品绑定:内容层在注册技能时写入。
 * 键为自定义物品 typeId(items/*.json 的 identifier)。
 */
export interface CustomSkillItemBinding {
  skillId: string;
  /**
   * 潜行 + 右键的效用动作(如群法切换定律)。
   * 定义后潜行右键不再进入施法流程(不校验/不预扣/不进冷却),
   * 对应内容设计「切换定律的操作与冷却时间无关」;
   * 未定义时潜行右键照常施法(蓄力类潜行变体由 castSneaking 分发)。
   */
  onSneakUse?(session: MatchSession, playerId: string): void;
}

export const customItemBindings = new Map<string, CustomSkillItemBinding>();

/** 是否为已绑定的自定义技能物品(监听层据此跳过全局事件路由) */
export function isCustomSkillItem(typeId: string): boolean {
  return customItemBindings.has(typeId);
}

/** 自定义物品 typeId → skillId(监听层的蓄力/松手事件路由用) */
export function customItemSkillId(typeId: string): string | undefined {
  return customItemBindings.get(typeId)?.skillId;
}

/** 按会话成员匹配定位玩家会话(组件回调无维度上下文) */
function sessionOfPlayer(playerId: string): MatchSession | undefined {
  for (const session of sessions.values()) {
    if (session.players.has(playerId)) return session;
  }
  return undefined;
}

/**
 * 技能触发组件:snd5:skill_trigger
 * 挂在即时类技能物品(items/*.json custom_components)上:
 * onUse(右键)→ 潜行走效用动作,否则进入施法流程。
 */
const SKILL_TRIGGER_COMPONENT = {
  onUse(event: { source: Player; itemStack?: ItemStack }, _params: unknown): void {
    const typeId = event.itemStack?.typeId;
    if (!typeId) return;
    const binding = customItemBindings.get(typeId);
    if (!binding) return;
    const player = event.source;
    const sneaking = player.isSneaking;
    system.run(() => {
      try {
        const session = sessionOfPlayer(player.id);
        if (!session) return;
        if (sneaking && binding.onSneakUse) {
          // 效用动作(切定律):与冷却无关,不进施法流程
          binding.onSneakUse(session, player.id);
          return;
        }
        session.skills.requestCast(player, binding.skillId);
      } catch (error) {
        console.warn("[SND5] 自定义物品技能触发异常", error);
      }
    });
  },
};

/**
 * startup 期注册自定义物品组件(main.ts 的 system.beforeEvents.startup
 * 订阅中调用,与 runtime.initStartup(event) 并存 —— 多订阅者互不影响)。
 */
export function registerSnd5ItemComponents(event: StartupEvent): void {
  event.itemComponentRegistry.registerCustomComponent("snd5:skill_trigger", SKILL_TRIGGER_COMPONENT);
}
