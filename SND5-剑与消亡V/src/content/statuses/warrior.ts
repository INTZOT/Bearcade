// ============================================================
// 战士相关状态与元素反应(内容设计 PDF 第 7-8 页)
// - 重伤: 10s 治疗量 -20%(武器重击施加)
// - 零火: 10s;受电伤额外 5 点,2 格内其他零火携带者连锁 5 点
// - 电流涌动/迸发: 轻击电附魔;击杀进阶/刷新
// ============================================================
import { reactionTable, statusRegistry } from "../../framework";

export const STATUS_GRIEVOUS_WOUND = "snd5:grievous_wound";
export const STATUS_ZERO_FIRE = "snd5:zero_fire";
export const STATUS_CURRENT_SURGE = "snd5:current_surge";
export const STATUS_CURRENT_BURST = "snd5:current_burst";

/** 零火连锁半径(格)与连锁伤害(点) */
const ZERO_FIRE_CHAIN_RADIUS = 2;
const ZERO_FIRE_CHAIN_DAMAGE = 5;
/** 连锁防乒乓的 BFS 深度上限 */
const ZERO_FIRE_CHAIN_MAX_DEPTH = 8;

statusRegistry.register({
  id: STATUS_GRIEVOUS_WOUND,
  displayName: "重伤",
  kind: "debuff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 200, // 10 秒
  clearable: true,
  modifiers: { healingTakenMul: 0.8 },
});

statusRegistry.register({
  id: STATUS_ZERO_FIRE,
  displayName: "零火",
  kind: "debuff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 200, // 10 秒
  clearable: true,
});

// 零火 × 电:本体额外 5 点电伤(反应伤害走完整管线);
// 2 格内其他零火携带者连锁受到 5 点(BFS 去重防 A/B 乒乓)。
// 连锁伤害带 reaction 标签,不再触发反应 —— 由本 BFS 统一扩散。
reactionTable.add({
  statusId: STATUS_ZERO_FIRE,
  trigger: "electric",
  build(ctx) {
    const { session, sourceId, targetId } = ctx;
    const visited = new Set<string>([targetId]);
    let frontier: string[] = [targetId];
    for (let depth = 0; depth < ZERO_FIRE_CHAIN_MAX_DEPTH && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const carrierId of frontier) {
        const carrier = session.players.get(carrierId);
        if (!carrier?.player.isValid) continue;
        const center = carrier.player.location;
        for (const other of session.primitives.playersInRadius(
          { x: center.x, y: center.y, z: center.z },
          ZERO_FIRE_CHAIN_RADIUS,
        )) {
          if (visited.has(other.id)) continue;
          if (!session.status.has(other.id, STATUS_ZERO_FIRE)) continue;
          visited.add(other.id);
          next.push(other.id);
          session.combat.dealDamage(sourceId, other.id, {
            hp: ZERO_FIRE_CHAIN_DAMAGE,
            element: "electric",
            tags: ["reaction"],
          });
        }
      }
      frontier = next;
    }
    return { payloads: [{ hp: ZERO_FIRE_CHAIN_DAMAGE, element: "electric" }] };
  },
});

statusRegistry.register({
  id: STATUS_CURRENT_SURGE,
  displayName: "电流涌动",
  kind: "buff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 160, // 8 秒
  clearable: true,
  excludes: [STATUS_CURRENT_BURST],
  // 击杀进阶为电流迸发(系统在 entity.killed 时统一检查)
  evolve: { triggerEvent: "entity.killed", to: STATUS_CURRENT_BURST },
});

statusRegistry.register({
  id: STATUS_CURRENT_BURST,
  displayName: "电流迸发",
  kind: "buff",
  maxStacks: 1,
  stackMode: "refresh",
  durationTicks: 160, // 8 秒
  clearable: true,
  excludes: [STATUS_CURRENT_SURGE],
  // 击杀刷新自身(重新获得电流迸发)
  evolve: { triggerEvent: "entity.killed", to: STATUS_CURRENT_BURST },
});
