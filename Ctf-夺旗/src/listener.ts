import { EntityHealCause, Player, system, world } from "@minecraft/server";
import { MinecraftEffectTypes } from "@minecraft/vanilla-data";
import { config } from "./config";
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
      gameManager.handlePlayerDeath(hurtEntity, attackerPlayer);
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

    if (event.block.typeId === 'minecraft:tnt') {
      // 移除原方块
      event.block.setType('minecraft:air');
      // 安排爆炸
      gameManager.scheduleTntExplosion(event.block.location, player);
      gameManager.removePlacedBlock(event.block.location);
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

  // 箭矢破坏方块
  world.afterEvents.projectileHitBlock.subscribe((event) => {
    if (gameManager.getGameState() !== GameState.RUNNING) return;

    const projectile = event.projectile;
    if (projectile.typeId !== 'minecraft:arrow') return;
    const projectileComp = projectile.getComponent('projectile');
    if (!projectileComp) return;
    const owner = projectileComp.owner;
    if (!(owner instanceof Player)) return;

    const ctfPlayer = gameManager.getPlayerManager().getPlayer(owner.id);
    if (!ctfPlayer) return;

    const hitLoc = event.location;
    gameManager.breakPlacedBlocksInRadius(hitLoc, config.arrowBreakRadius);
  });

  world.afterEvents.entityHurt.subscribe((event) => {
    const { hurtEntity } = event;
    if (!(hurtEntity instanceof Player)) return;

    // 游戏运行中才记录
    if (gameManager.getGameState() !== GameState.RUNNING) return;

    gameManager.onPlayerDamaged(hurtEntity);
  });

  world.beforeEvents.itemUse.subscribe((event) => {
    const player = event.source;
    const item = event.itemStack;

    // 仅游戏运行时生效
    if (gameManager.getGameState() !== GameState.RUNNING) return;
    // 只处理甜浆果
    if (item.typeId !== 'minecraft:sweet_berries') return;

    // 取消原本的食物使用
    event.cancel = true;

    system.run(() => {
      // 从背包中移除一个浆果
      const inventory = player.getComponent('inventory')?.container;
      if (!inventory) {
        player.sendMessage('§c无法获取背包');
        return;
      }

      for (let i = 0; i < inventory.size; i++) {
        const slotItem = inventory.getItem(i);
        if (slotItem && slotItem.typeId === 'minecraft:sweet_berries') {
          if (slotItem.amount > 1) {
            slotItem.amount -= 1;
            inventory.setItem(i, slotItem);
          } else {
            inventory.setItem(i, undefined);
          }
          break;
        }
      }

      // 给予速度 I 效果，持续 60 秒（60 * 20 刻）
      player.addEffect(MinecraftEffectTypes.Speed, 60 * 20, {
        amplifier: 0,
        showParticles: false
      });
    });
  });
}