import { Team, TeamMetadata } from './Team';
import { TeamEventBus, TeamEventType, TeamEventHandler } from './TeamEvents';

/**
 * TeamManager - 队伍系统的唯一状态源
 * 
 * 设计要点：
 * 1. 所有玩家归属关系由本类统一维护（playerId → teamId）
 * 2. 提供事件总线，支持外部模块订阅队伍变更
 * 3. 自动分配使用内置轮询策略
 * 4. 所有写操作均做防御性校验
 */
export class TeamManager {
  private teams = new Map<string, Team>();
  private playerToTeam = new Map<string, string>(); // playerId -> teamId
  private eventBus = new TeamEventBus();
  private capacityOverrides = new Map<string, number>(); // 可针对特定房间覆盖容量
  /** 轮询分配用的当前索引 */
  private roundRobinIndex = 0;

  constructor() {}

  // ==================== 事件订阅 ====================

  on<T extends TeamEventType>(
    event: T,
    handler: TeamEventHandler<T>
  ): () => void {
    return this.eventBus.on(event, handler);
  }

  once<T extends TeamEventType>(
    event: T,
    handler: TeamEventHandler<T>
  ): void {
    this.eventBus.once(event, handler);
  }

  // ==================== 队伍 CRUD ====================

  /**
   * 从配置批量初始化队伍
   */
  initialize(configs: readonly TeamMetadata[]): void {
    this.clear();
    for (const cfg of configs) {
      this.createTeam(cfg);
    }
  }

  /**
   * 创建队伍
   */
  createTeam(config: TeamMetadata): Team {
    if (this.teams.has(config.id)) {
      throw new Error(`Team with id '${config.id}' already exists`);
    }

    const team = new Team(config);
    this.teams.set(config.id, team);
    this.eventBus.emit('teamCreated', { teamId: config.id });
    return team;
  }

  /**
   * 获取队伍
   */
  getTeam(teamId: string): Team | undefined {
    return this.teams.get(teamId);
  }

  /**
   * 获取所有队伍
   */
  getAllTeams(): Team[] {
    return Array.from(this.teams.values());
  }

  /**
   * 获取所有队伍 ID
   */
  getAllTeamIds(): string[] {
    return Array.from(this.teams.keys());
  }

  /**
   * 移除队伍（会自动将该队玩家踢出）
   */
  removeTeam(teamId: string): boolean {
    const team = this.teams.get(teamId);
    if (!team) return false;

    // 先踢出所有玩家，避免悬空引用
    const playerIds = this.getPlayerIdsOfTeam(teamId);
    for (const pid of playerIds) {
      this.removePlayerFromTeam(pid);
    }

    this.teams.delete(teamId);
    this.capacityOverrides.delete(teamId);
    this.eventBus.emit('teamRemoved', { teamId });
    return true;
  }

  /**
   * 队伍是否存在
   */
  hasTeam(teamId: string): boolean {
    return this.teams.has(teamId);
  }

  /**
   * 获取队伍数量
   */
  getTeamCount(): number {
    return this.teams.size;
  }

  // ==================== 容量管理 ====================

  /**
   * 设置特定队伍容量上限
   */
  setTeamCapacity(teamId: string, capacity: number): void {
    if (!this.teams.has(teamId)) {
      throw new Error(`Team '${teamId}' does not exist`);
    }
    if (capacity < 0) {
      throw new Error('Capacity must be non-negative');
    }
    this.capacityOverrides.set(teamId, capacity);
  }

  /**
   * 获取队伍容量
   */
  getTeamCapacity(teamId: string): number {
    const team = this.teams.get(teamId);
    if (!team) return 0;
    return this.capacityOverrides.get(teamId) ?? team.maxPlayers;
  }

  /**
   * 队伍是否已满
   */
  isTeamFull(teamId: string): boolean {
    return this.getPlayerCountOfTeam(teamId) >= this.getTeamCapacity(teamId);
  }

  // ==================== 玩家归属管理 ====================

  /**
   * 将玩家分配到指定队伍
   * @returns 是否成功
   */
  assignPlayerToTeam(playerId: string, teamId: string): boolean {
    const team = this.teams.get(teamId);
    if (!team) {
      console.warn(`[TeamManager] Cannot assign player to non-existent team '${teamId}'`);
      return false;
    }

    if (this.isTeamFull(teamId)) {
      console.warn(`[TeamManager] Team '${teamId}' is full`);
      return false;
    }

    const previousTeamId = this.playerToTeam.get(playerId) ?? null;

    // 如果已在该队，无需操作
    if (previousTeamId === teamId) return true;

    // 先从旧队移除
    if (previousTeamId) {
      this.playerToTeam.delete(playerId);
      this.eventBus.emit('playerLeft', {
        playerId,
        teamId: previousTeamId,
        newTeamId: teamId
      });
    }

    // 加入新队
    this.playerToTeam.set(playerId, teamId);
    this.eventBus.emit('playerJoined', {
      playerId,
      teamId,
      previousTeamId
    });

    return true;
  }

  /**
   * 轮询自动分配玩家到队伍
   * 按顺序轮流分配，保证各队人数严格均衡
   */
  autoAssignPlayer(playerId: string): Team | null {
    const teams = this.getAllTeams();
    if (teams.length === 0) return null;

    // 如果玩家已在某队，先移除
    this.removePlayerFromTeam(playerId);

    const startIndex = this.roundRobinIndex;
    const teamCount = teams.length;

    do {
      const team = teams[this.roundRobinIndex % teamCount];
      this.roundRobinIndex++;

      if (!this.isTeamFull(team.id)) {
        const success = this.assignPlayerToTeam(playerId, team.id);
        return success ? team : null;
      }
    } while (this.roundRobinIndex % teamCount !== startIndex % teamCount);

    // 所有队伍已满
    console.warn(`[TeamManager] All teams are full, cannot assign player ${playerId}`);
    return null;
  }

  /**
   * 将玩家从队伍中移除
   */
  removePlayerFromTeam(playerId: string): boolean {
    const teamId = this.playerToTeam.get(playerId);
    if (!teamId) return false;

    this.playerToTeam.delete(playerId);
    this.eventBus.emit('playerLeft', {
      playerId,
      teamId,
      newTeamId: null
    });
    return true;
  }

  /**
   * 切换玩家队伍
   */
  switchPlayerTeam(playerId: string, newTeamId: string): boolean {
    return this.assignPlayerToTeam(playerId, newTeamId);
  }

  /**
   * 获取玩家所在队伍 ID
   */
  getTeamIdOfPlayer(playerId: string): string | null {
    return this.playerToTeam.get(playerId) ?? null;
  }

  /**
   * 获取玩家所在队伍对象
   */
  getTeamOfPlayer(playerId: string): Team | undefined {
    const teamId = this.playerToTeam.get(playerId);
    if (!teamId) return undefined;
    return this.teams.get(teamId);
  }

  /**
   * 玩家是否属于指定队伍
   */
  isPlayerInTeam(playerId: string, teamId: string): boolean {
    return this.playerToTeam.get(playerId) === teamId;
  }

  /**
   * 获取某队所有玩家 ID
   */
  getPlayerIdsOfTeam(teamId: string): string[] {
    const ids: string[] = [];
    for (const [pid, tid] of this.playerToTeam) {
      if (tid === teamId) ids.push(pid);
    }
    return ids;
  }

  /**
   * 获取某队玩家数量
   */
  getPlayerCountOfTeam(teamId: string): number {
    let count = 0;
    for (const tid of this.playerToTeam.values()) {
      if (tid === teamId) count++;
    }
    return count;
  }

  /**
   * 获取未分配队伍的玩家
   */
  getUnassignedPlayerIds(allPlayerIds: string[]): string[] {
    return allPlayerIds.filter(id => !this.playerToTeam.has(id));
  }

  // ==================== 得分管理 ====================

  /**
   * 为队伍增加得分
   */
  addTeamScore(teamId: string, amount: number = 1): boolean {
    const team = this.teams.get(teamId);
    if (!team) return false;

    const oldScore = team.score;
    team.addScore(amount);
    this.eventBus.emit('teamScoreChanged', {
      teamId,
      oldScore,
      newScore: team.score
    });
    return true;
  }

  /**
   * 设置队伍得分
   */
  setTeamScore(teamId: string, score: number): boolean {
    const team = this.teams.get(teamId);
    if (!team) return false;

    const oldScore = team.score;
    if (oldScore === score) return true;

    team.score = score;
    this.eventBus.emit('teamScoreChanged', {
      teamId,
      oldScore,
      newScore: score
    });
    return true;
  }

  /**
   * 获取队伍得分
   */
  getTeamScore(teamId: string): number {
    return this.teams.get(teamId)?.score ?? 0;
  }

  /**
   * 检查是否有队伍达到目标分数
   */
  checkWinCondition(targetScore: number): Team | null {
    for (const team of this.teams.values()) {
      if (team.score >= targetScore) return team;
    }
    return null;
  }

  // ==================== 批量操作 ====================

  /**
   * 重置所有队伍（清空玩家、归零分数）
   */
  resetTeams(): void {
    // 先清空所有玩家归属
    const entries = Array.from(this.playerToTeam.entries());
    this.playerToTeam.clear();

    for (const [playerId, teamId] of entries) {
      this.eventBus.emit('playerLeft', {
        playerId,
        teamId,
        newTeamId: null
      });
    }

    // 重置队伍分数
    for (const [teamId, team] of this.teams) {
      const oldScore = team.score;
      team.reset();
      if (oldScore !== 0) {
        this.eventBus.emit('teamScoreChanged', {
          teamId,
          oldScore,
          newScore: 0
        });
      }
    }

    // 重置轮询索引
    this.roundRobinIndex = 0;

    this.eventBus.emit('teamsReset', {});
  }

  /**
   * 完全清空（移除所有队伍和数据）
   */
  clear(): void {
    // 先触发所有玩家的 leave 事件
    for (const [playerId, teamId] of this.playerToTeam) {
      this.eventBus.emit('playerLeft', {
        playerId,
        teamId,
        newTeamId: null
      });
    }

    this.teams.clear();
    this.playerToTeam.clear();
    this.capacityOverrides.clear();
    this.roundRobinIndex = 0;
    // this.eventBus.clear();
  }

  // ==================== 调试辅助 ====================

  /**
   * 打印当前队伍状态
   */
  debugPrint(): void {
    console.log('========== TeamManager Status ==========');
    for (const team of this.teams.values()) {
      const count = this.getPlayerCountOfTeam(team.id);
      const capacity = this.getTeamCapacity(team.id);
      console.log(`[${team.id}] ${team.name} | Score: ${team.score} | Players: ${count}/${capacity}`);
    }
    console.log(`Total players assigned: ${this.playerToTeam.size}`);
    console.log(`Round-robin index: ${this.roundRobinIndex}`);
    console.log('========================================');
  }
}