import { Player, world } from "@minecraft/server";
import { GameManager } from "./GameManager";
import { GameState } from "./types";

export function initCTFListener(): void {
  const gameManager = GameManager.getInstance();

  // 右键点击商店实体打开商店
  world.afterEvents.playerInteractWithEntity.subscribe((event) => {
    const player = event.player;
    const target = event.target;

    const shop = gameManager.getShopManager().findShopByEntity(target);
    if (shop) {
      shop.show(player);
    }
  });

  // 左键攻击商店实体打开商店
  world.afterEvents.entityHitEntity.subscribe((event) => {
    const attacker = event.damagingEntity;
    const target = event.hitEntity;

    if (!(attacker instanceof Player)) return;

    const shop = gameManager.getShopManager().findShopByEntity(target);
    if (shop) {
      shop.show(attacker);
    }
  });

  // ---------- 阻止队友伤害 ----------
  world.beforeEvents.entityHurt.subscribe((event) => {
    const { hurtEntity, damageSource } = event;

    // 只处理玩家受到伤害的情况
    if (!(hurtEntity instanceof Player)) return;

    // 尝试获取实际攻击者（玩家）
    const damagingEntity = damageSource.damagingEntity;
    let attackerPlayer: Player | undefined;

    if (damagingEntity instanceof Player) {
      attackerPlayer = damagingEntity;
    } else if (damagingEntity) {
      // 处理弹射物（箭、雪球等），获取其所有者
      const projectile = damagingEntity.getComponent('projectile');
      if (projectile) {
        const owner = projectile.owner;
        if (owner instanceof Player) {
          attackerPlayer = owner;
        }
      }
    }

    // 没有有效的攻击玩家则忽略
    if (!attackerPlayer) return;

    // 仅在游戏进行时阻止队友伤害
    if (gameManager.getGameState() !== GameState.RUNNING) return;

    const teamManager = gameManager.getTeamManager();
    const attackerTeam = teamManager.getTeamIdOfPlayer(attackerPlayer.id);
    const hurtTeam = teamManager.getTeamIdOfPlayer(hurtEntity.id);

    // 如果双方都分配了队伍且相同，则取消本次伤害
    if (attackerTeam !== null && attackerTeam === hurtTeam) {
      event.cancel = true;
    }
  });
}