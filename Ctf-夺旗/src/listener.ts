import { EntityHealCause, Player, world } from "@minecraft/server";
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

  world.beforeEvents.entityHurt.subscribe((event) => {
    const { hurtEntity, damageSource } = event;

    if (!(hurtEntity instanceof Player)) return;

    let attackerPlayer: Player | undefined;

    // 阻止队友伤害
    if (damageSource.damagingEntity instanceof Player) {
      attackerPlayer = damageSource.damagingEntity;
    } else if (damageSource.damagingEntity) {
      const projectile = damageSource.damagingEntity.getComponent('projectile');
      if (projectile) {
        const owner = projectile.owner;
        if (owner instanceof Player) {
          attackerPlayer = owner;
        }
      }
    }

    if (attackerPlayer) {
      if (gameManager.getGameState() !== GameState.RUNNING) return;

      const teamManager = gameManager.getTeamManager();
      const attackerTeam = teamManager.getTeamIdOfPlayer(attackerPlayer.id);
      const hurtTeam = teamManager.getTeamIdOfPlayer(hurtEntity.id);

      if (attackerTeam !== null && attackerTeam === hurtTeam) {
        event.cancel = true;
        return; // 队友伤害已取消，不再继续检测致死
      }
    }

    // 检测是否致命伤害（仅游戏进行中）
    if (gameManager.getGameState() !== GameState.RUNNING) return;

    const healthComp = hurtEntity.getComponent('health');
    if (!healthComp) return;
    const currentHealth = healthComp.currentValue;
    const newHealth = currentHealth - event.damage;
    if (newHealth <= 0) {
      // 取消原伤害，自定义死亡流程
      event.cancel = true;
      gameManager.handlePlayerDeath(hurtEntity);
    }
  });

  // ---------- 阻止玩家自身恢复 ----------
  world.beforeEvents.entityHeal.subscribe((event) => {
    if (gameManager.getGameState() !== GameState.RUNNING) return;
    if (!(event.healedEntity instanceof Player)) return;
    gameManager.getPlayerManager().getAllPlayers().find(player => {
      if (player.getPlayer()?.id === event.healedEntity.id) {
        event.cancel = true;
      }
    });
  }, {
    allowedHealCauses: [EntityHealCause.SelfHeal],
  });

  // 记录玩家放置的方块
  world.afterEvents.playerPlaceBlock.subscribe((event) => {
    if (gameManager.getGameState() !== GameState.RUNNING) return;
    const player = event.player;
    const ctfPlayer = gameManager.getPlayerManager().getPlayer(player.id);
    if (ctfPlayer) {
      gameManager.addPlacedBlock(event.block.location);
    }
  });

  // 破坏方块前检查：仅允许破坏玩家放置过的方块
  world.beforeEvents.playerBreakBlock.subscribe((event) => {
    if (gameManager.getGameState() !== GameState.RUNNING) return;
    const player = event.player;
    const ctfPlayer = gameManager.getPlayerManager().getPlayer(player.id);
    if (!ctfPlayer) return;

    const blockLoc = event.block.location;
    if (gameManager.isPlacedBlock(blockLoc)) {
      // 允许破坏，并移除记录（防止重复记录）
      gameManager.removePlacedBlock(blockLoc);
    } else {
      event.cancel = true;
      player.sendMessage("§c你不能破坏该方块！");
    }
  });
}