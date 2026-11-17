// ============================================================
// SND5 游戏装配层
// MinigameHooks 接线(引擎层契约,见 development.md §3/§4)+
// 会话注入实现:队伍/职业装载/套装发放/武器结算路由。
// 内容层经 src/content 统一入口 import 即注册。
// ============================================================
import { ItemStack, system, type Player } from "@minecraft/server";
import type { MinigameHooks } from "../../shared/minigame-core/types";
import type { MinigameRuntime } from "../../shared/minigame-core/runtime";
import { clearHudTitle } from "../../shared/minigame-core/scoreboardHud";
import { clearAllPlayerItems } from "../../shared/minigame-core/playerItems";
import {
  CapturePointDef,
  MatchSession,
  sessions,
  skillRegistry,
  statusRegistry,
  type SessionInjects,
  type Snd5ContentBundle,
  type Snd5RuntimeConfig,
  type SupplyItemDef,
  type SupplyStationDef,
  type TeamId,
  type TeamProvider,
} from "./framework";
import {
  CODEX_SPELLS,
  codexItemLore,
  codexItemNameTag,
  CONSUMABLE_DEFINITIONS,
  getSelectedCodex,
  getSelectedProfessionId,
  professionRegistry,
  type CodexSpellMeta,
  type ProfessionDefinition,
} from "./content";
import { loadSnd5Config } from "./runtime-config";
import { SND5_CAPTURE_POINTS, SND5_SUPPLY_STATION_POINTS, START_POSITIONS } from "./config";

// ── 默认队伍提供器 ────

const TEAM_IDS: readonly TeamId[] = ["red", "blue"];

class DefaultTeamProvider implements TeamProvider {
  private readonly assignment = new Map<string, TeamId>();

  readonly teamIds = TEAM_IDS;

  assignAll(players: Player[]): void {
    this.assignment.clear();
    const shuffled = [...players];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    shuffled.forEach((player, index) => {
      this.assignment.set(player.id, index % 2 === 0 ? "red" : "blue");
    });
  }

  getTeam(playerId: string): TeamId | undefined {
    return this.assignment.get(playerId);
  }

  teamDisplayName(teamId: TeamId): string {
    return teamId === "red" ? "§c红队" : teamId === "blue" ? "§9蓝队" : "§7中立";
  }
}

// ── 职业解析(准备阶段选择 → 开局装载) ─────────────────────────

/** 已选职业;未选/失效兜底默认战士 */
function resolveProfession(playerId: string): ProfessionDefinition {
  const selectedId = getSelectedProfessionId(playerId);
  const selected = selectedId ? professionRegistry.get(selectedId) : undefined;
  if (selected?.available) return selected;
  return professionRegistry.require("snd5:warrior");
}

/** 开局发放职业套装:清背包 → 武器/技能物品 → 秘典物品 → 命名牌前缀。
 * 占位职业用原版物品 + 默认命名;自定义物品职业(群法)的技能物品
 * 名称由 profession.buildSkillItem 构建(随会话内状态变化,如群法定律)。
 */
function grantProfessionKit(session: MatchSession, player: Player, prof: ProfessionDefinition): void {
  const container = player.getComponent("minecraft:inventory")?.container;
  if (!container) return;
  try {
    const weapon = new ItemStack(prof.weapon.itemTypeId, 1);
    weapon.nameTag = prof.weapon.name;
    if (prof.weapon.lore.length > 0) weapon.setLore(prof.weapon.lore);
    container.setItem(0, weapon);
    prof.skills.forEach((entry, index) => {
      // 重击绑定在武器自身(自定义物品职业):武器已发放,不重复发放物品
      if (entry.slot === "weapon_heavy" && entry.itemTypeId === prof.weapon.itemTypeId) return;
      const skillDef = skillRegistry.get(entry.skillId);
      const item = new ItemStack(entry.itemTypeId, 1);
      const built = prof.buildSkillItem?.(entry, session, player.id);
      item.nameTag = built?.name ?? `§e${skillDef?.displayName ?? entry.slot}§r`;
      const slotLabel =
        entry.slot === "innate_1"
          ? "固有Ⅰ"
          : entry.slot === "innate_2"
            ? "固有Ⅱ"
            : "重击(蓄力)";
      const usage = entry.slot === "weapon_heavy" ? "按住右键蓄力,松手施放" : "右键施放";
      item.setLore(built?.lore ?? [`§7${slotLabel} · ${usage}`]);
      container.setItem(index + 1, item);
    });
    // 秘典槽位(容器槽 5/6 = 热键栏 6/7,对应设计物品栏槽位 6/7):
    // 准备阶段已选择的法术;未选择则槽位空
    const codex = getSelectedCodex(player.id);
    const codexEntries: Array<readonly ["codex_1" | "codex_2", string | undefined]> = [
      ["codex_1", codex?.codex1],
      ["codex_2", codex?.codex2],
    ];
    for (const [slot, skillId] of codexEntries) {
      if (!skillId) continue;
      const meta = codexMetaOf(skillId);
      if (!meta) continue;
      container.setItem(slot === "codex_1" ? 5 : 6, makeCodexItemStack(meta, false));
    }
    player.nameTag = `§6[${prof.displayName}]§r ${player.name}`;
    player.onScreenDisplay.setActionBar(`§a你已化身 ${prof.displayName}!`);
  } catch (error) {
    console.warn("[SND5] 职业套装发放失败", error);
  }
}

// ── 秘典物品外观(占位物品/nameTag 约定见 content/codex/spells.ts) ──

/** 按技能 id 查秘典元数据 */
function codexMetaOf(skillId: string): CodexSpellMeta | undefined {
  return CODEX_SPELLS.find((spell) => spell.skillId === skillId);
}

/** 构建秘典物品(可用态/耗尽态) */
function makeCodexItemStack(meta: CodexSpellMeta, exhausted: boolean): ItemStack {
  const item = new ItemStack(meta.itemTypeId, 1);
  item.nameTag = codexItemNameTag(meta.displayName, exhausted);
  item.setLore(codexItemLore(meta.tier, exhausted));
  return item;
}

/** 在背包中定位秘典物品(可用态/耗尽态两种 nameTag 都匹配) */
function findCodexItemSlot(player: Player, skillId: string): number | undefined {
  const meta = codexMetaOf(skillId);
  if (!meta) return undefined;
  const container = player.getComponent("minecraft:inventory")?.container;
  if (!container) return undefined;
  const names = [
    codexItemNameTag(meta.displayName, false),
    codexItemNameTag(meta.displayName, true),
  ];
  for (let slot = 0; slot < container.size; slot++) {
    if (names.includes(container.getItem(slot)?.nameTag ?? "")) return slot;
  }
  return undefined;
}

/** 重写秘典物品状态(使用后变灰 / 补给站充能恢复) */
function setCodexItemState(player: Player, skillId: string, exhausted: boolean): void {
  const meta = codexMetaOf(skillId);
  if (!meta) return;
  const slot = findCodexItemSlot(player, skillId);
  if (slot === undefined) return;
  const container = player.getComponent("minecraft:inventory")?.container;
  try {
    container?.setItem(slot, makeCodexItemStack(meta, exhausted));
  } catch (error) {
    console.warn("[SND5] 秘典物品状态更新失败", error);
  }
}

// ── 内容注册束(占点/补给/计分规则待场地建好后填入) ──────────────

/** 组装补给站条目:消耗品直接取自 content/consumables.ts(避免双份数据漂移) */
function buildSupplyStations(): SupplyStationDef[] {
  const consumableItems: SupplyItemDef[] = CONSUMABLE_DEFINITIONS.map((def) => ({
    itemTypeId: def.itemTypeId,
    displayName: def.displayName,
    maxCarry: def.maxCarry,
    amountPerGrant: 1,
  }));
  // itemTypeId 仅为结构占位,充能分支不发放物品(按玩家已装备法术重置)
  const codexItems: SupplyItemDef[] = [
    { itemTypeId: "minecraft:book", displayName: "秘典Ⅰ", maxCarry: 1, amountPerGrant: 1, codexSlot: "codex_1" },
    { itemTypeId: "minecraft:book", displayName: "秘典Ⅱ", maxCarry: 1, amountPerGrant: 1, codexSlot: "codex_2" },
  ];
  const items = [...consumableItems, ...codexItems];
  return SND5_SUPPLY_STATION_POINTS.map((point) => ({ ...point, items }));
}

function buildContentBundle(): Snd5ContentBundle {
  return {
    skills: skillRegistry,
    statuses: statusRegistry,
    // 占点区域坐标见 config.ts(5 点占位,场地建好后微调)
    capturePoints: SND5_CAPTURE_POINTS as CapturePointDef[],
    // 补给站坐标见 config.ts(7 个占位:5 内圈 + 2 外围,场地建好后微调);
    // 站点条目 = 血药/甲修/魔瓶(消耗品定义组装) + 秘典Ⅰ/Ⅱ 充能条目
    supplyStations: buildSupplyStations(),
  };
}

// ── 会话注入

interface Snd5Injects extends SessionInjects {
  assignTeams(players: Player[]): void;
}

function buildInjects(_runtime: MinigameRuntime, roomId: number): Snd5Injects {
  const teamProvider = new DefaultTeamProvider();
  return {
    teams: teamProvider,
    assignTeams: (players) => teamProvider.assignAll(players),
    // 重生点:暂用开局站位(场地建好后改为队伍出生点/部署点)
    getRespawnLocation: (playerId) => {
      const teamId = teamProvider.getTeam(playerId) ?? "red";
      const index = teamId === "blue" ? 1 : 0;
      return START_POSITIONS[index] ?? START_POSITIONS[0];
    },

    // 职业装载:面板 + 技能装备 + 秘典槽位 + 被动挂载(会话 applyLoadout 消费)
    loadoutFor: (playerId) => {
      const prof = resolveProfession(playerId);
      const skills: Record<string, string> = Object.fromEntries(
        prof.skills.map((entry) => [entry.slot, entry.skillId]),
      );
      // 秘典槽位:准备阶段选择的法术(未选择/已失效则槽位空)
      const codex = getSelectedCodex(playerId);
      if (codex?.codex1 && skillRegistry.has(codex.codex1)) skills.codex_1 = codex.codex1;
      if (codex?.codex2 && skillRegistry.has(codex.codex2)) skills.codex_2 = codex.codex2;
      return {
        professionId: prof.id,
        base: prof.base,
        skills,
        passiveIds: prof.passiveIds,
      };
    },

    // 会话开始:清背包(含山羊角)→ 按职业发放套装
    onSessionStart: (session) => {
      for (const state of session.players.values()) {
        const player = state.player;
        if (!player.isValid) continue;
        clearAllPlayerItems(player);
        const prof = professionRegistry.get(state.professionId ?? "");
        if (!prof) continue;
        grantProfessionKit(session, player, prof);
      }
      session.announce("§7提示: 潜行+攻击为重击;准备阶段右键山羊角选择职业");
    },

    // 重生:全量重发套装(架构 §6.3「复活时同样全量重发」)
    onPlayerRespawn: (playerId) => {
      const session = sessions.get(roomId);
      const state = session?.players.get(playerId);
      if (!state?.player.isValid) return;
      const prof =
        professionRegistry.get(state.professionId ?? "") ?? resolveProfession(playerId);
      clearAllPlayerItems(state.player);
      if (session) grantProfessionKit(session, state.player, prof);
    },

    // 秘典充能恢复:补给站消耗后把背包物品重写为可用态
    codexItemRestore: (player, _slot, skillId) => {
      setCodexItemState(player, skillId, false);
    },

    // 近战武器结算 → 按职业路由(轻击/重击数值由职业定义计算)
    weaponAttack: (session, attackerId, victimId, isSneaking) => {
      const attacker = session.players.get(attackerId);
      if (!attacker) return;
      const prof = professionRegistry.get(attacker.professionId ?? "");
      prof?.handleAttack?.(session, attackerId, victimId, isSneaking);
    },

    // HUD 职业名
    professionNameOf: (professionId) => professionRegistry.get(professionId)?.displayName,
  };
}

// ── 会话 tick(由 listeners.ts 的单一 interval 驱动) ─────────────

export function tickSnd5Sessions(getRuntime: () => MinigameRuntime): void {
  for (const [roomId, session] of [...sessions]) {
    try {
      if (!getRuntime().isRunning(roomId)) {
        session.dispose();
        sessions.delete(roomId);
        continue;
      }
      session.tick(system.currentTick);
    } catch (error) {
      console.warn(`[SND5] 房间 ${roomId} tick 异常`, error);
    }
  }
}

// ── MinigameHooks 装配 ────────────────────────────────────────

export function makeSnd5Hooks(getRuntime: () => MinigameRuntime): MinigameHooks {
  return {
    onGameStart(roomId, players) {
      const runtime = getRuntime();
      const config: Snd5RuntimeConfig = loadSnd5Config();
      const injects = buildInjects(runtime, roomId);
      // 队伍分配必须在会话读取 getTeam 之前完成
      injects.assignTeams(players);
      const session = new MatchSession(runtime, roomId, injects, config, buildContentBundle());
      sessions.set(roomId, session);
      // 秘典使用成功 → 物品转入耗尽态(名称变灰;补给站充能/重生重发时恢复)
      session.bus.on("skill.cast", ({ casterId, skillId, slot, outcome }) => {
        if (!outcome.ok) return;
        if (slot !== "codex_1" && slot !== "codex_2") return;
        const state = session.players.get(casterId);
        if (!state?.player.isValid) return;
        setCodexItemState(state.player, skillId, true);
      });
      try {
        session.start(players);
      } catch (error) {
        console.warn(`[SND5] 房间 ${roomId} 会话启动异常`, error);
        session.dispose();
        sessions.delete(roomId);
      }
    },

    onBeforeReset(roomId) {
      // 引擎层会重建场地;会话与 HUD 在此全量回收
      const session = sessions.get(roomId);
      if (!session) return;
      for (const state of session.players.values()) {
        if (state.player.isValid) clearHudTitle(state.player);
      }
      session.dispose();
      sessions.delete(roomId);
    },

    onRoomReset() {
      // 场地已从模板重建(补给站/占点标记随之恢复),无需额外处理
    },

    // 场地保护:玩家不可放置/破坏;创生物写入由脚本完成不走此钩子
    canPlace: () => false,
    canBreak: () => false,

    // TODO(对局层): openConfig —— /bearcade:config snd5 的热调参界面
    //   (scoreTarget/respawnSeconds 等,复用 shared configUi 编辑器)
  };
}
