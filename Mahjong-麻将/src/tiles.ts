// ============================================================
// 麻将牌组工具:预设、自定义选择、牌墙牌堆生成
// ============================================================
import {
  ALL_TILE_IDS,
  PRESETS,
  TILE_CATEGORIES,
  TILE_COPIES,
  type MahjongPreset,
} from "./config";

export function getPresetById(id: number): MahjongPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

export function tileDisplayName(id: string): string {
  const cat = TILE_CATEGORIES.find((c) => c.tiles.includes(id));
  if (!cat) return id;
  const num = id.replace(`mahjong_${cat.key}`, "");
  if (cat.key === "d") {
    const winds = ["东", "南", "西", "北"];
    return `${winds[Number(num) - 1] ?? num}风`;
  }
  if (cat.key === "e") {
    const dragons = ["红中", "发财", "白板"];
    return dragons[Number(num) - 1] ?? `${num}${cat.name}`;
  }
  return `${num}${cat.name}`;
}

export function categoryOf(id: string): string | undefined {
  return TILE_CATEGORIES.find((c) => c.tiles.includes(id))?.key;
}

export function tileCountForSelection(selected: Set<string>): number {
  let count = 0;
  for (const id of ALL_TILE_IDS) {
    if (selected.has(id)) count += TILE_COPIES;
  }
  return count;
}

/**
 * 预设可用人数过滤。
 * 当前玩法规则未定,暂默认 3 人/4 人均可用;后续在这里按预设规则收窄。
 */
export function isPresetAvailableForPlayers(
  _preset: MahjongPreset,
  _playerCount: number,
): boolean {
  return _playerCount === 3 || _playerCount === 4;
}

/**
 * 根据选中的牌种生成完整牌堆(每种 4 张,随机打乱)。
 * 返回牌 ID 数组,长度为 selected.size * TILE_COPIES。
 */
export function buildTileDeck(selected: Set<string>): string[] {
  const deck: string[] = [];
  for (const id of ALL_TILE_IDS) {
    if (!selected.has(id)) continue;
    for (let i = 0; i < TILE_COPIES; i++) deck.push(id);
  }
  // Fisher-Yates
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * 把牌堆平均分成 4 面牌墙,每面上下两层。
 * 返回每面墙的牌 ID 列表(顺序为靠近玩家侧向外?这里按数组顺序从墙的一端到另一端)。
 * 若牌数不能被 4 整除,前面几面多一张。
 */
export function splitWalls(deck: string[]): string[][] {
  const walls: string[][] = [[], [], [], []];
  const base = Math.floor(deck.length / 4);
  let extra = deck.length % 4;
  let index = 0;
  for (let w = 0; w < 4; w++) {
    const size = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    for (let i = 0; i < size; i++) {
      walls[w].push(deck[index++]);
    }
  }
  return walls;
}
