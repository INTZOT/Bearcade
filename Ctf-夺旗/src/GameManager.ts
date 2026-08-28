import { Dimension, Entity, EntityDamageCause, EquipmentSlot, GameMode, ItemStack, Player, system, VanillaEntityIdentifier } from '@minecraft/server';
import { MinecraftEffectTypes, MinecraftEntityTypes, MinecraftItemTypes } from '@minecraft/vanilla-data';
import { MinigameRuntime } from '../../shared/minigame-core/runtime';
import { config, PREP_SPAWN } from './config';
import { CTFPlayer } from './CTFPlayer';
import { FlagManager } from './FlagManager';
import { PlayerManager } from './PlayerManager';
import { ScoreboardManager } from './ScoreboardManager';
import { ShopManager } from './ShopManager';
import { TeamManager } from './TeamManager';
import { Timer } from './Timer';
import { FlagState, GameState, PlayerState, Vector3 } from './types';
import { distance } from './utils';

type TNTFuses = {
  location: Vector3;
  placerId: string;
  remainingTicks: number;
  entity: Entity;
}[];

export class GameManager {
  private static instance: GameManager;
  private timeStamp = 0;
  private tickDuration = 0;
  private waterTickCounter = new Map<string, number>();
  private deathPlayers: Map<string, number> = new Map();
  private readonly RESPAWN_DELAY_TICKS = config.respawnTime * 20;
  private placedBlocks: Set<string> = new Set();
  private tntFuses: TNTFuses = [];
  private gamestate: GameState;
  private roomId: number | undefined;
  private runtime: MinigameRuntime | undefined;
  private flagManager: FlagManager;
  private teamManager: TeamManager;
  private playerManager: PlayerManager;
  private scoreboardManager: ScoreboardManager;
  private shopManager: ShopManager;
  private initialized = false;

  private constructor() {
    this.gamestate = GameState.ENDING;
    this.flagManager = new FlagManager();
    this.teamManager = new TeamManager();
    this.playerManager = new PlayerManager();
    this.scoreboardManager = new ScoreboardManager();
    this.shopManager = new ShopManager();

    this.setupTeamEvents();
  }

  static getInstance(): GameManager {
    if (!GameManager.instance) {
      GameManager.instance = new GameManager();
    }
    return GameManager.instance;
  }

  /**
   * 订阅队伍事件，同步 CTFPlayer.teamId 缓存
   */
  private setupTeamEvents(): void {
    this.teamManager.on('playerJoined', ({ playerId, teamId }) => {
      console.warn(`玩家 ${playerId} 加入队伍 ${teamId}`);
      const player = this.playerManager.getPlayer(playerId);
      if (player) player.teamId = teamId;
    });

    this.teamManager.on('playerLeft', ({ playerId }) => {
      console.warn(`玩家 ${playerId} 离开队伍`);
      const player = this.playerManager.getPlayer(playerId);
      if (player) player.teamId = null;
    });
  }

  initialize(): void {
    if (this.initialized) return;
    this.gamestate = GameState.INITIALIZING;

    const mainScoreboard = this.scoreboardManager.createTemplate('ctf_main');
    mainScoreboard.addColumn('header', '§l§e夺旗', {});
    mainScoreboard.addColumn('team_name', '§f队伍: {team}', {
      team: (player) => {
        const team = this.teamManager.getTeamOfPlayer(player.id);
        return team?.name ?? '§7无';
      }
    });
    mainScoreboard.addColumn('team_score', '§f得分: {score}', {
      score: (player) => {
        const team = this.teamManager.getTeamOfPlayer(player.id);
        return team?.score.toString() ?? '无数据';
      }
    });
    mainScoreboard.addColumn('player_money', '§f经济: {money}', {
      money: (player) => {
        const ctfPlayer = this.playerManager.getPlayer(player.id);
        return ctfPlayer?.economy?.toString() ?? '无数据';
      }
    });
    mainScoreboard.addColumn('time_left', '§f剩余时间: {time}', {
      time: () => {
        const elapsedSec = this.timeStamp / 20;
        const remaining = Math.max(0, Math.floor(config.matchTime - elapsedSec));
        const min = Math.floor(remaining / 60);
        const sec = remaining % 60;
        return `${min}:${sec.toString().padStart(2, '0')}`;
      }
    });
    mainScoreboard.addColumn('debug', '§fDEBUG: {debug}', {
      debug: () => {
        return `tick: ${this.tickDuration}ms`;
      }
    })

    const itemShop = this.shopManager.createShop('item_shop');
    if (!itemShop) throw new Error('Failed to create item shop.');
    itemShop.setTitle('物品商店');
    itemShop.setDescription('在这里可以购买装备或道具');

    // 1. 方块（羊毛）x16
    itemShop.addItem('block', {
      tag: 'block',
      name: '方块 x16',
      price: 15,
      icon: 'textures/items/wool'
    });
    itemShop.setCallback('block', (player, _name) => {
      const inventory = player.getComponent('inventory');
      if (!inventory?.container) {
        player.sendMessage('§c无法获取背包');
        return false;
      }
      const team = this.teamManager.getTeamOfPlayer(player.id);
      if (!team) {
        player.sendMessage('§c你还没有队伍！');
        return false;
      }
      const color = team.color; // 'blue' 或 'green'
      const woolId = `minecraft:${color}_wool`;
      const item = new ItemStack(woolId, 16);
      const result = inventory.container.addItem(item);
      if (result) {
        player.sendMessage('§c背包空间不足！');
        return false;
      }
      return true;
    });

    // 2. 箭 x16
    itemShop.addItem('arrow', {
      tag: 'arrow',
      name: '箭 x16',
      price: 25,
      icon: 'textures/items/arrow'
    });
    itemShop.setCallback('arrow', (player, _name) => {
      const inventory = player.getComponent('inventory');
      if (!inventory?.container) return false;
      const item = new ItemStack(MinecraftItemTypes.Arrow, 16);
      const result = inventory.container.addItem(item);
      if (result) {
        player.sendMessage('§c背包空间不足！');
        return false;
      }
      return true;
    });

    // 3. 速度浆果（甜浆果）
    itemShop.addItem('berry', {
      tag: 'berry',
      name: '速度浆果',
      price: 40,
      icon: 'textures/items/sweet_berries'
    });
    itemShop.setCallback('berry', (player, _name) => {
      const inventory = player.getComponent('inventory');
      if (!inventory?.container) return false;
      const item = new ItemStack(MinecraftItemTypes.SweetBerries, 1);
      const result = inventory.container.addItem(item);
      if (result) {
        player.sendMessage('§c背包空间不足！');
        return false;
      }
      return true;
    });

    // 4. TNT
    itemShop.addItem('tnt', {
      tag: 'tnt',
      name: 'TNT',
      price: 75,
      icon: 'textures/items/tnt'
    });
    itemShop.setCallback('tnt', (player, _name) => {
      const inventory = player.getComponent('inventory');
      if (!inventory?.container) return false;
      const item = new ItemStack(MinecraftItemTypes.Tnt, 1);
      const result = inventory.container.addItem(item);
      if (result) {
        player.sendMessage('§c背包空间不足！');
        return false;
      }
      return true;
    });

    // 5. 铁剑
    itemShop.addItem('iron_sword', {
      tag: 'iron_sword',
      name: '铁剑',
      price: 100,
      icon: 'textures/items/iron_sword'
    });
    itemShop.setCallback('iron_sword', (player, _name) => {
      const inventory = player.getComponent('inventory');
      if (!inventory?.container) return false;

      // 检查是否已有铁剑或钻石剑
      let hasBetter = false;
      let replaceSlot = -1;
      for (let i = 0; i < inventory.container.size; i++) {
        const item = inventory.container.getItem(i);
        if (!item) continue;
        const type = item.typeId;
        if (type === 'minecraft:iron_sword' || type === 'minecraft:diamond_sword') {
          hasBetter = true;
          break;
        }
        if (type === 'minecraft:stone_sword') replaceSlot = i;
      }
      if (hasBetter) {
        player.sendMessage('§c你已拥有更好的剑！');
        return false;
      }
      if (replaceSlot !== -1) {
        inventory.container.setItem(replaceSlot, new ItemStack(MinecraftItemTypes.IronSword, 1));
      } else {
        const result = inventory.container.addItem(new ItemStack(MinecraftItemTypes.IronSword, 1));
        if (result) {
          player.sendMessage('§c背包空间不足！');
          return false;
        }
      }
      return true;
    });

    // 6. 钻石剑
    itemShop.addItem('diamond_sword', {
      tag: 'diamond_sword',
      name: '钻石剑',
      price: 200,
      icon: 'textures/items/diamond_sword'
    });
    itemShop.setCallback('diamond_sword', (player, _name) => {
      const inventory = player.getComponent('inventory');
      if (!inventory?.container) return false;

      // 检查是否已有钻石剑
      let hasDiamond = false;
      let replaceSlot = -1; // 石剑或铁剑的位置
      for (let i = 0; i < inventory.container.size; i++) {
        const item = inventory.container.getItem(i);
        if (!item) continue;
        const type = item.typeId;
        if (type === 'minecraft:diamond_sword') {
          hasDiamond = true;
          break;
        }
        if (type === 'minecraft:stone_sword' || type === 'minecraft:iron_sword') {
          replaceSlot = i;
        }
      }
      if (hasDiamond) {
        player.sendMessage('§c你已拥有钻石剑！');
        return false;
      }
      if (replaceSlot !== -1) {
        inventory.container.setItem(replaceSlot, new ItemStack(MinecraftItemTypes.DiamondSword, 1));
      } else {
        const result = inventory.container.addItem(new ItemStack(MinecraftItemTypes.DiamondSword, 1));
        if (result) {
          player.sendMessage('§c背包空间不足！');
          return false;
        }
      }
      return true;
    });

    // 7. 铁套装（护腿+靴子）
    itemShop.addItem('iron_armor', {
      tag: 'iron_armor',
      name: '铁制套装',
      price: 100,
      icon: 'textures/items/iron_leggings'
    });
    itemShop.setCallback('iron_armor', (player, _name) => {
      const equippable = player.getComponent('equippable');
      if (!equippable) {
        player.sendMessage('§c无法装备盔甲');
        return false;
      }
      // 检查是否已有铁护腿或铁靴子
      const legs = equippable.getEquipment(EquipmentSlot.Legs);
      const feet = equippable.getEquipment(EquipmentSlot.Feet);
      if (legs?.typeId === 'minecraft:iron_leggings' && feet?.typeId === 'minecraft:iron_boots') {
        player.sendMessage('§c你已拥有铁套装！');
        return false;
      }
      // 设置（若已有其他材质则覆盖）
      equippable.setEquipment(EquipmentSlot.Legs, new ItemStack(MinecraftItemTypes.IronLeggings, 1));
      equippable.setEquipment(EquipmentSlot.Feet, new ItemStack(MinecraftItemTypes.IronBoots, 1));
      return true;
    });

    this.initialized = true;
    this.gamestate = GameState.WAITING;
  }

  start(runtime: MinigameRuntime, roomId: number): void {
    if (this.gamestate !== GameState.WAITING) {
      throw new Error('非法的游戏状态：' + this.gamestate);
    }
    this.runtime = runtime;
    this.roomId = roomId;

    this.cleanEntity();

    // 1. 初始化队伍
    this.teamManager.initialize(config.teams);

    // 2. 创建旗帜
    for (const teamCfg of config.teams) {
      const flagPos = teamCfg.flagHomePosition;
      if (flagPos) {
        this.flagManager.createFlag(teamCfg.id, flagPos);
      }
    }

    // 3. 创建商店实体
    const itemShop = this.shopManager.getShop('item_shop');
    if (itemShop) {
      itemShop.spawnShopEntity(config.arena.redShop);
      itemShop.spawnShopEntity(config.arena.blueShop);
    }

    // 4. 注册玩家 → 分配队伍 → 给予经济 → 显示计分板
    const players = this.runtime.roomPlayers(this.roomId);
    for (const mcPlayer of players) {
      const ctfPlayer = this.playerManager.getOrCreatePlayer(mcPlayer);
      ctfPlayer.setEconomy(config.economy.initial);
      this.scoreboardManager.setPlayerDisplay(mcPlayer.id, 'ctf_main');

      // 轮询自动分配
      this.teamManager.autoAssignPlayer(ctfPlayer.uuid);

      // 分配初始护甲
      const equippable = mcPlayer.getComponent('equippable');
      if (equippable) {
        equippable.setEquipment(EquipmentSlot.Legs, new ItemStack(config.initialArmor.leggings));
        equippable.setEquipment(EquipmentSlot.Feet, new ItemStack(config.initialArmor.boots));
      }

      // 分配初始物品到背包
      const inventory = mcPlayer.getComponent('inventory')?.container;
      if (inventory) {
        for (const entry of config.initialInventory) {
          inventory.addItem(new ItemStack(entry.item, entry.count));
        }
      }
      const team = this.teamManager.getTeamOfPlayer(mcPlayer.id);
      if (team && inventory) {
        const woolId = `minecraft:${team.color}_wool`;
        try {
          inventory.addItem(new ItemStack(woolId, config.initialBlockCount));
        } catch (err) {
          console.warn(`[GameManager] 无法生成: ${woolId}`, err);
        }
      }

      // 玩家饱和&满血&生存模式
      mcPlayer.addEffect(MinecraftEffectTypes.Saturation, 99999, { showParticles: false });
      mcPlayer.getComponent('minecraft:health')?.resetToMaxValue();
      mcPlayer.setGameMode(GameMode.Survival);
    }

    // 5. 传送玩家到各队出生点
    for (const player of this.playerManager.getAllPlayers()) {
      if (!player.teamId) continue;
      const team = this.teamManager.getTeam(player.teamId);
      const mcPlayer = player.getPlayer();
      if (team && mcPlayer && this.runtime) {
        this.runtime.teleportPlayer(this.roomId, mcPlayer, team.spawnPoint);
      }
    }

    this.gamestate = GameState.RUNNING;
  }

  end(): void {
    if (this.gamestate !== GameState.RUNNING) {
      throw new Error('非法的游戏状态：' + this.gamestate);
    }
    this.gamestate = GameState.ENDING;

    try {
      this.clearTntFuses();
      this.clearPlacedBlocks();
      this.waterTickCounter.clear();
      this.flagManager.clear();
      this.teamManager.resetTeams();
      this.playerManager.clear();
      this.shopManager.removeShopEntity();
      this.runtime?.endGame(this.roomId!, '游戏结束');
    } catch (error) {
      console.error('游戏结束时发生错误：', error);
    } finally {
      this.gamestate = GameState.WAITING;
    }
  }

  tick(): void {
    const start = Date.now();

    if (this.gamestate !== GameState.RUNNING) return;

    this.scoreboardManager?.updateAll();
    this.flagManager.updateAll();
    this.checkCaptures();
    this.checkScore();
    this.processWaterDamage();
    this.handlePlayerRespawn();
    this.handleRegeneration();
    this.updateTntFuses();
    this.naturalMoney();
    this.checkWin();

    this.timeStamp += 2;
    Timer.update(2);

    this.tickDuration = Date.now() - start;
  }

  private cleanEntity(): void {
    if (!this.runtime || this.roomId === undefined) return;
    const dim = this.runtime.roomDim(this.roomId);
    if (!dim) return;
    for (const entity of dim.getEntities()) {
      if (entity.getDynamicProperty('ctf:entity_need_remove') === true) {
        entity.remove();
      }
    }
  }

  private naturalMoney(): void {
    if (this.timeStamp % 20 === 0) {
      this.playerManager.addEconomyToAll(config.economy.tickReward);
    }
  }

  private checkWin() :void { 
    const team = this.teamManager.checkWinCondition(config.maxScore);
    if (team) {
      this.sendMessage(`${team.name} 获得胜利！`);
      this.end();
    }
  }

  /**
   * 处理玩家复活 
   */
  private handlePlayerRespawn(): void {
    for (const [playerId, remainingTicks] of this.deathPlayers) {
      if (remainingTicks <= 0) {
        this.respawnPlayer(playerId);
      } else {
        this.deathPlayers.set(playerId, remainingTicks - 2);
      }
    }
  }

  private handleRegeneration(): void {
    // 仅游戏进行中执行
    if (this.gamestate !== GameState.RUNNING) return;

    // 每秒（20刻）执行一次恢复
    if (this.timeStamp % 20 !== 0) return;

    const players = this.playerManager.getAllPlayers();
    for (const ctfPlayer of players) {
      // 仅存活玩家可恢复
      if (ctfPlayer.state !== PlayerState.ALIVE) continue;

      const mcPlayer = ctfPlayer.getPlayer();
      if (!mcPlayer?.isValid) continue;

      const healthComp = mcPlayer.getComponent('health');
      if (!healthComp) continue;

      const maxHealth = healthComp.effectiveMax;
      const currentHealth = healthComp.currentValue;
      if (currentHealth >= maxHealth) continue; // 满血不恢复

      // 判断未受伤时长（刻）
      const elapsedTicks = this.timeStamp - ctfPlayer.lastDamageTime;
      const delayTicks = config.regeneration.delaySeconds * 20;
      if (elapsedTicks <= delayTicks) continue;

      // 恢复生命值（每秒恢复配置量）
      const newHealth = Math.min(maxHealth, currentHealth + config.regeneration.perSecond);
      healthComp.setCurrentValue(newHealth);
    }
  }

  /**
   * 安排一个 TNT 爆炸（放置后调用）
   * @param location 方块位置
   * @param placer 放置者的 UUID
   */
  public scheduleTntExplosion(location: Vector3, placer: Player): void {
    const entity = this.spawnEntity(MinecraftEntityTypes.ArmorStand, location);
    entity.nameTag = 'TNT';
    this.tntFuses.push({
      location: { ...location },
      placerId: placer.id,
      remainingTicks: config.tnt.fuseTicks,
      entity: entity
    });
    placer.playSound('random.fuse');
  }

  /**
   * 更新所有 TNT 引信，倒计时归零时执行爆炸
   */
  private updateTntFuses(): void {
    const toRemove: number[] = [];
    for (let i = 0; i < this.tntFuses.length; i++) {
      const fuse = this.tntFuses[i];
      fuse.remainingTicks -= 2; // 因为 tick 每 2 刻执行一次
      if (fuse.remainingTicks <= 0) {
        this.executeTntExplosion(fuse.location, fuse.placerId, fuse.entity);
        toRemove.push(i);
      }
    }
    // 从后往前移除已完成的
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.tntFuses[toRemove[i]].entity.remove();
      this.tntFuses.splice(toRemove[i], 1);
    }
  }

  /**
   * 执行 TNT 爆炸效果
   * @param center 爆炸中心
   * @param placerId 放置者 ID（用于判定队友）
   * @param entity 放置的 TNT 实体
   */
  private executeTntExplosion(center: Vector3, placerId: string, entity: Entity): void {
    const dimension = this.getGameDimension();
    if (!dimension) return;

    // 如果实体可用，则使用实体的位置
    if (entity.isValid) center = entity.location;

    const radius = config.tnt.explosionRadius;
    const damage = config.tnt.playerDamage;

    // ---- 破坏玩家放置的方块（仅限 placedBlocks 中记录的） ----
    const startX = Math.floor(center.x - radius);
    const endX = Math.floor(center.x + radius);
    const startY = Math.floor(center.y - radius);
    const endY = Math.floor(center.y + radius);
    const startZ = Math.floor(center.z - radius);
    const endZ = Math.floor(center.z + radius);

    for (let x = startX; x <= endX; x++) {
      for (let y = startY; y <= endY; y++) {
        for (let z = startZ; z <= endZ; z++) {
          // 球形范围检查
          const dx = x - center.x;
          const dy = y - center.y;
          const dz = z - center.z;
          if (dx * dx + dy * dy + dz * dz > radius * radius) continue;

          const key = `${x},${y},${z}`;
          if (this.placedBlocks.has(key)) {
            const block = dimension.getBlock({ x, y, z });
            if (block) {
              block.setType('minecraft:air');
              this.placedBlocks.delete(key); // 移除记录
            }
          }
        }
      }
    }

    // ---- 对非队友玩家造成伤害 ----
    const players = dimension.getPlayers({ location: center, maxDistance: radius });
    for (const player of players) {
      // 检查距离（过滤可能超出范围的边缘玩家）
      if (distance(player.location, center) > radius) continue;

      // 获取放置者的队伍 ID（若放置者已离开或无队伍，则默认攻击所有人）
      const placerTeamId = this.teamManager.getTeamIdOfPlayer(placerId);
      if (placerTeamId !== null && this.teamManager.isPlayerInTeam(player.id, placerTeamId)) {
        continue; // 同队不伤害
      }

      player.applyDamage(damage, { cause: EntityDamageCause.entityExplosion });
    }

    // ---- 显示爆炸粒子效果 ----
    dimension.spawnParticle('minecraft:explosion_particle', center);
    dimension.playSound('random.explode', center);
  }

  /**
   * 清理 TNT 引信
   */
  private clearTntFuses(): void {
    for (const fuse of this.tntFuses) {
      fuse.entity.remove();
    }
    this.tntFuses = [];
  }

  /**
   * 当玩家受到伤害时调用，更新其最后受伤时间
   * @param player 受伤的玩家
   */
  onPlayerDamaged(player: Player): void {
    const ctfPlayer = this.playerManager.getPlayer(player.id);
    if (ctfPlayer) {
      ctfPlayer.lastDamageTime = this.timeStamp;
    }
  }

  /**
   * 处理玩家死亡（切换旁观、传送、掉落旗帜、开始复活计时）
   */
  handlePlayerDeath(player: Player, attacker: Player | undefined): void {
    system.run(() => {
      if (this.deathPlayers.has(player.id)) return; // 防止重复调用

      // 1. 切换旁观模式
      player.setGameMode(GameMode.Spectator);

      // 2. 玩家死亡事件
      this.playerManager.getOrCreatePlayer(player).onDeath();
      if (attacker) {
        this.playerManager.getOrCreatePlayer(attacker).onKill();
        this.playerManager.getOrCreatePlayer(attacker).addEconomy(config.economy.killReward);
        this.sendMessage(`§a${attacker.nameTag} 击杀了 ${player.nameTag}`);
      };

      // 3. 如果携带旗帜，则掉落
      const flags = this.flagManager.getAllFlags();
      for (const flag of flags) {
        if (flag.carrier && flag.carrier.uuid === player.id) {
          flag.drop(player.location);
          this.sendMessage(`${this.teamManager.getTeam(flag.teamId)?.name} 的旗帜已掉落！`)
          break;
        }
      }

      // 4. 发送消息
      player.sendMessage('§c你已阵亡，将在 ' + config.respawnTime + ' 秒后复活');

      // 5. 开始计时
      this.deathPlayers.set(player.id, this.RESPAWN_DELAY_TICKS);
    });
  }

  /**
   * 复活玩家
   */
  private respawnPlayer(playerId: string): void {
    const ctfplayer = this.playerManager.getPlayer(playerId);
    const player = ctfplayer?.getPlayer();
    if (!player) {
      this.deathPlayers.delete(playerId);
      return;
    }

    // 执行玩家复活事件
    ctfplayer?.onRespawn();

    // 获取队伍出生点
    const team = this.teamManager.getTeamOfPlayer(playerId);
    const spawnPoint = team?.spawnPoint ?? PREP_SPAWN

    // 传送并切换模式
    player.teleport(spawnPoint);
    player.setGameMode(GameMode.Survival);

    // 重置生命和饥饿
    const healthComp = player.getComponent('health');
    if (healthComp) {
      healthComp.setCurrentValue(healthComp.effectiveMax);
    }
    const hungerComp = player.getComponent('player.saturation');
    if (hungerComp) {
      hungerComp.setCurrentValue(hungerComp.effectiveMax);
    }

    // 移除记录
    this.deathPlayers.delete(playerId);

    player.sendMessage('§a你已复活！');
  }
  private processWaterDamage(): void {
    const players = this.runtime?.roomPlayers(this.roomId!) ?? [];

    for (const player of players) {
      if (!player.isValid) continue;

      if (player.isInWater) {
        const current = this.waterTickCounter.get(player.id) || 0;
        const newCount = current + 2; // tick 每 2 刻执行一次，步长 2

        if (newCount >= 20) {
          // 每秒造成 2 点窒息伤害
          player.applyDamage(2);
          this.waterTickCounter.set(player.id, 0);
        } else {
          this.waterTickCounter.set(player.id, newCount);
        }
      } else {
        this.waterTickCounter.delete(player.id); // 离水清除计时
      }
    }
  }

  private checkCaptures(): void {
    const captureRadius = config.arena.captureRadius; // 从配置读取拾取半径
    const flags = this.flagManager.getAllFlags();
    const players = this.playerManager.getAllPlayers();

    for (const flag of flags) {
      // 跳过已被携带的旗帜
      if (flag.state === FlagState.CARRIED) continue;

      const flagPos = flag.position; // 旗帜当前位置（HOME 或 DROPPED 时有效）

      for (const ctfPlayer of players) {
        const mcPlayer = ctfPlayer.getPlayer();
        if (!mcPlayer?.isValid) continue;               // 玩家离线
        if (!ctfPlayer.teamId) continue;       // 未分配队伍
        if (ctfPlayer.teamId === flag.teamId) continue; // 同队不能拾取
        if (ctfPlayer.state === PlayerState.DEAD) continue; // 玩家已死亡

        // 计算距离
        if (distance(mcPlayer.location, flagPos) > captureRadius) continue;

        // 检查该玩家是否已经携带了其他旗帜（一个玩家只能携带一个）
        let alreadyCarrying = false;
        for (const otherFlag of flags) {
          if (otherFlag.carrier && otherFlag.carrier.uuid === ctfPlayer.uuid) {
            alreadyCarrying = true;
            break;
          }
        }
        if (alreadyCarrying) continue;

        // 尝试拾取（Flag.pickup 内部会处理状态变更与实体清理）
        const success = flag.pickup(ctfPlayer, true);
        if (success) {
          this.sendMessage(`${mcPlayer.nameTag} 拾取了 ${this.teamManager.getTeam(flag.teamId)?.name} 的旗帜！`)
          break; // 旗帜已被拾取，退出内层循环
        }
      }
    }
  }

  private checkScore(): void {
    const captureRadius = config.arena.captureRadius;
    const flags = this.flagManager.getAllFlags();

    for (const flag of flags) {
      // 只处理被携带的旗帜
      if (flag.state !== FlagState.CARRIED || !flag.carrier) continue;

      const carrier = flag.carrier;
      const carrierTeamId = carrier.teamId;
      if (!carrierTeamId) continue; // 未分配队伍，忽略

      // 获取携带者所在队伍的旗帜（己方旗帜）
      const ownFlag = this.flagManager.getFlag(carrierTeamId);
      if (!ownFlag) continue;
      // 己方旗帜必须在家（未被偷走）才能得分
      if (ownFlag.state !== FlagState.HOME) continue;

      // 使用 flag.position（携带时与携带者位置同步）与己方旗帜 home 位置比较
      const dist = distance(flag.position, ownFlag.homePosition);
      if (dist > captureRadius) continue;

      // ====== 得分！ ======
      const mcPlayer = carrier.getPlayer();
      flag.returnHome(); // 敌方旗帜归还
      this.teamManager.addTeamScore(carrierTeamId, 1);

      const reward = config.economy.flagReward ?? 0;
      if (reward > 0) carrier.addEconomy(reward);

      if (mcPlayer) {
        mcPlayer.sendMessage(`§a成功夺旗！ +1 分，奖励 ${reward} 金币`);
      }
    }
  }

  /** 获取某队的所有 CTFPlayer 对象 */
  getPlayersByTeam(teamId: string): CTFPlayer[] {
    const playerIds = this.teamManager.getPlayerIdsOfTeam(teamId);
    return playerIds
      .map(id => this.playerManager.getPlayer(id))
      .filter((p): p is CTFPlayer => p !== undefined);
  }

  /** 获取未分配队伍的玩家 */
  getUnassignedPlayers(): CTFPlayer[] {
    return this.playerManager.getAllPlayers().filter(p => p.teamId === null);
  }

  /**
 * 破坏指定位置周围半径内所有由玩家放置的方块
 * @param center 中心坐标
 * @param radius 半径（使用切比雪夫距离便于遍历）
 */
  public breakPlacedBlocksInRadius(center: Vector3, radius: number): void {
    const dimension = this.getGameDimension();
    if (!dimension) return;

    const startX = Math.floor(center.x - radius);
    const endX = Math.floor(center.x + radius);
    const startY = Math.floor(center.y - radius);
    const endY = Math.floor(center.y + radius);
    const startZ = Math.floor(center.z - radius);
    const endZ = Math.floor(center.z + radius);

    for (let x = startX; x <= endX; x++) {
      for (let y = startY; y <= endY; y++) {
        for (let z = startZ; z <= endZ; z++) {
          const key = `${x},${y},${z}`;
          if (this.placedBlocks.has(key)) {
            const block = dimension.getBlock({ x, y, z });
            if (block) {
              block.setType('minecraft:air');
              this.placedBlocks.delete(key);
            }
          }
        }
      }
    }
  }

  /**
   * 在游戏维度中生成实体，并自动标记为“需要移除”
   * @param entityType 实体类型标识（如 'minecraft:armor_stand'）
   * @param location 生成位置
   * @returns 生成的实体
   * @throws 若维度不存在或生成失败则抛出错误
   */
  spawnEntity(entityType: VanillaEntityIdentifier, location: Vector3): Entity {
    const dimension = this.getGameDimension();
    if (!dimension) {
      throw new Error('无法获取游戏维度，请确保房间已初始化');
    }
    const entity = dimension.spawnEntity(entityType, location);
    if (!entity) {
      throw new Error(`无法创建实体：${entityType}`);
    }
    entity.setDynamicProperty('ctf:entity_need_remove', true);
    return entity;
  }

  /**
   * 发送消息给所有玩家
   * @param message 要发送的消息
   */
  sendMessage(message: string): void {
    this.playerManager.getAllPlayers().forEach(player => {
      player.getPlayer()?.sendMessage(message);
    });
  }

  addPlacedBlock(location: Vector3): void {
    this.placedBlocks.add(`${location.x},${location.y},${location.z}`);
  }

  isPlacedBlock(location: Vector3): boolean {
    return this.placedBlocks.has(`${location.x},${location.y},${location.z}`);
  }

  removePlacedBlock(location: Vector3): void {
    this.placedBlocks.delete(`${location.x},${location.y},${location.z}`);
  }

  private clearPlacedBlocks(): void {
    this.placedBlocks.clear();
  }

  getGameState(): GameState { return this.gamestate; }
  getTimeStamp(): number { return this.timeStamp; }
  getRoomId(): number | undefined { return this.roomId; }
  getRuntime(): MinigameRuntime | undefined { return this.runtime; }
  getFlagManager(): FlagManager { return this.flagManager; }
  getTeamManager(): TeamManager { return this.teamManager; }
  getPlayerManager(): PlayerManager { return this.playerManager; }
  getShopManager(): ShopManager { return this.shopManager; }
  getGameDimension(): Dimension | undefined {
    return this.roomId !== undefined ? this.runtime?.roomDim(this.roomId) : undefined;
  }
}