// CChess 方块体系重构脚本:
// 1) 从 Go-围棋 复制 5 个棋盘方块定义(blank/center/center_point/corner/side)
//    → identifier 改为 bearcade:cchess_board_* / geometry.cchess_board / 贴图 cchess_board_*
// 2) 全部 24 个方块(19 现有 + 5 新)menu_category 统一折叠到 group itemGroup.name.cchess
// 3) 重写 terrain_texture.json / blocks.json / zh_CN.lang / en_US.lang
import { readFileSync, writeFileSync, readdirSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BP = join(ROOT, 'blocks');
const RP = join(ROOT, 'resource-pack');
const GO = join(ROOT, '..', 'Go-围棋');

const GROUP = 'bearcade:itemGroup.name.cchess'; // 组键带包命名空间(Go 模式)
const fmt = (o) => JSON.stringify(o, null, 2);

// ---------- 1) 从 Go 复制 5 个棋盘方块 ----------
const goBoards = ['blank', 'center', 'center_point', 'corner', 'side'];
for (const name of goBoards) {
  const src = join(GO, 'blocks', `chestboard_${name}.json`);
  const block = JSON.parse(readFileSync(src, 'utf8'));
  const desc = block['minecraft:block'].description;
  desc.identifier = `bearcade:cchess_board_${name}`;
  if (!desc.menu_category) desc.menu_category = {};
  desc.menu_category.category = 'construction';
  desc.menu_category.group = GROUP;
  const comps = block['minecraft:block'].components;
  comps['minecraft:geometry'] = {
    identifier: 'geometry.cchess_board',
    culling_shape: 'minecraft:unit_cube'
  };
  comps['minecraft:material_instances']['*'].texture = `cchess_board_${name}`;
  writeFileSync(join(BP, `cchess_board_${name}.json`), fmt(block));
  console.log(`+ blocks/cchess_board_${name}.json (from Go chestboard_${name})`);
}

// ---------- 1.5) side_slash 拆分为 left/right 两个差分方块(资产来源:建模目录更新) ----------
const slashSrc = join(BP, 'cchess_board_side_slash.json');
if (existsSync(slashSrc)) {
  const slash = JSON.parse(readFileSync(slashSrc, 'utf8'));
  for (const side of ['left', 'right']) {
    const b = JSON.parse(JSON.stringify(slash));
    b['minecraft:block'].description.identifier = `bearcade:cchess_board_side_slash_${side}`;
    b['minecraft:block'].components['minecraft:material_instances']['*'].texture = `cchess_board_side_slash_${side}`;
    writeFileSync(join(BP, `cchess_board_side_slash_${side}.json`), fmt(b));
    console.log(`+ blocks/cchess_board_side_slash_${side}.json (差分自 side_slash)`);
  }
  rmSync(slashSrc);
  console.log(`- blocks/cchess_board_side_slash.json (已拆分)`);
}

// ---------- 1.6) side_star:棋盘边+星位(资产来源:建模目录新增) ----------
const sideStarSrc = join(BP, 'cchess_board_side_star.json');
if (!existsSync(sideStarSrc) && existsSync(join(BP, 'cchess_board_side.json'))) {
  const side = JSON.parse(readFileSync(join(BP, 'cchess_board_side.json'), 'utf8'));
  side['minecraft:block'].description.identifier = 'bearcade:cchess_board_side_star';
  side['minecraft:block'].components['minecraft:material_instances']['*'].texture = 'cchess_board_side_star';
  writeFileSync(sideStarSrc, fmt(side));
  console.log('+ blocks/cchess_board_side_star.json (模板自 side,4朝向)');
}

// ---------- 2) 全部方块:menu_category 只留 category(折叠走 item_catalog,与 group 同定义冲突) ----------
const allBlocks = readdirSync(BP).filter((f) => f.endsWith('.json'));
const names = [];
// 棋子四向旋转(与棋盘同款排列:南0/西270/北180/东90,up/down 不转)
const ROT_PERMS = [
  ['south', [0, 0, 0]],
  ['west', [0, 270, 0]],
  ['north', [0, 180, 0]],
  ['east', [0, 90, 0]],
  ['up', [0, 0, 0]],
  ['down', [0, 0, 0]]
].map(([d, r]) => ({
  condition: `q.block_state('minecraft:facing_direction') == '${d}'`,
  components: { 'minecraft:transformation': { rotation: r } }
}));
const isPiece = (n) => n.startsWith('cchess_red_') || n.startsWith('cchess_black_');
for (const f of allBlocks) {
  const p = join(BP, f);
  const block = JSON.parse(readFileSync(p, 'utf8'));
  const desc = block['minecraft:block'].description;
  if (!desc.menu_category) desc.menu_category = {};
  desc.menu_category.category = 'construction';
  delete desc.menu_category.group; // 引擎自动加 minecraft: 前缀,自定义组走 catalog
  const n = desc.identifier.split(':')[1];
  if (isPiece(n)) {
    if (!desc.traits) desc.traits = {};
    desc.traits['minecraft:placement_direction'] = { enabled_states: ['minecraft:facing_direction'] };
    block['minecraft:block'].permutations = ROT_PERMS;
    console.log(`~ ${f} -> + 4朝向`);
  }
  writeFileSync(p, fmt(block));
  names.push(n);
}

// ---------- 3) terrain_texture.json ----------
const texAlias = { cchess_test: 'cchess_red_bing' }; // 测试方块复用红兵贴图
const texData = {};
for (const n of names) {
  texData[n] = { textures: `textures/blocks/${texAlias[n] ?? n}` };
}
writeFileSync(join(RP, 'textures', 'terrain_texture.json'), fmt({
  texture_data: texData,
  resource_pack_name: 'bearcade_cchess',
  texture_name: 'atlas.terrain',
  num_mip_levels: 4,
  padding: 8
}));
console.log(`~ terrain_texture.json: ${names.length} entries`);

// ---------- 4) blocks.json ----------
const boardSound = (n) => n.startsWith('cchess_board') ? 'wood' : 'stone';
const blockMaps = {};
for (const n of names) {
  blockMaps[`bearcade:${n}`] = { textures: texAlias[n] ?? n, sound: boardSound(n) };
}
writeFileSync(join(RP, 'blocks.json'), fmt({
  format_version: '1.19.0',
  ...blockMaps
}));
console.log(`~ blocks.json: ${names.length} mappings`);

// ---------- 4.5) item_catalog 折叠分组(Go 模式,icon 必须带) ----------
mkdirSync(join(ROOT, 'item_catalog'), { recursive: true });
const catalogItems = names.map((n) => `bearcade:${n}`);
writeFileSync(join(ROOT, 'item_catalog', 'crafting_item_catalog.json'), fmt({
  format_version: '1.21.60',
  'minecraft:crafting_items_catalog': {
    categories: [
      {
        category_name: 'construction',
        groups: [
          {
            group_identifier: {
              icon: 'bearcade:cchess_board_blank',
              name: GROUP
            },
            items: catalogItems
          }
        ]
      }
    ]
  }
}));
console.log(`~ item_catalog: ${catalogItems.length} items, icon bearcade:cchess_board_blank`);

// ---------- 5) lang ----------
const cnNames = {
  cchess_test: '测试象棋方块',
  cchess_board_blank: '象棋棋盘·素面',
  cchess_board_center: '象棋棋盘·中心',
  cchess_board_center_point: '象棋棋盘·中心点',
  cchess_board_corner: '象棋棋盘·角',
  cchess_board_side: '象棋棋盘·边',
  cchess_board_side_star: '象棋棋盘·边星位',
  cchess_board_center_slash: '象棋棋盘·中心斜线',
  cchess_board_center_star: '象棋棋盘·中心星位',
  cchess_board_corner_slash: '象棋棋盘·角斜线',
  cchess_board_side_slash_left: '象棋棋盘·边斜线(左)',
  cchess_board_side_slash_right: '象棋棋盘·边斜线(右)',
  cchess_red_bing: '红兵', cchess_red_shi: '红仕', cchess_red_shuai: '红帅',
  cchess_red_pao: '红炮', cchess_red_xiang: '红相', cchess_red_ju: '红車', cchess_red_ma: '红马',
  cchess_black_zu: '黑卒', cchess_black_shi: '黑士', cchess_black_jiang: '黑将',
  cchess_black_pao: '黑炮', cchess_black_xiang: '黑象', cchess_black_ju: '黑車', cchess_black_ma: '黑马'
};
const enNames = {
  cchess_test: 'CChess Test Block',
  cchess_board_blank: 'Chessboard · Plain',
  cchess_board_center: 'Chessboard · Center',
  cchess_board_center_point: 'Chessboard · Center Point',
  cchess_board_corner: 'Chessboard · Corner',
  cchess_board_side: 'Chessboard · Side',
  cchess_board_side_star: 'Chessboard · Side Star',
  cchess_board_center_slash: 'Chessboard · Center Slash',
  cchess_board_center_star: 'Chessboard · Center Star',
  cchess_board_corner_slash: 'Chessboard · Corner Slash',
  cchess_board_side_slash_left: 'Chessboard · Side Slash (Left)',
  cchess_board_side_slash_right: 'Chessboard · Side Slash (Right)',
  cchess_red_bing: 'Red Pawn', cchess_red_shi: 'Red Advisor', cchess_red_shuai: 'Red General',
  cchess_red_pao: 'Red Cannon', cchess_red_xiang: 'Red Elephant', cchess_red_ju: 'Red Chariot', cchess_red_ma: 'Red Horse',
  cchess_black_zu: 'Black Pawn', cchess_black_shi: 'Black Advisor', cchess_black_jiang: 'Black General',
  cchess_black_pao: 'Black Cannon', cchess_black_xiang: 'Black Elephant', cchess_black_ju: 'Black Chariot', cchess_black_ma: 'Black Horse'
};
const zhLines = [`${GROUP}=中国象棋`];
const enLines = [`${GROUP}=Chinese Chess`];
for (const n of names) {
  zhLines.push(`tile.bearcade:${n}.name=${cnNames[n] ?? n}`);
  enLines.push(`tile.bearcade:${n}.name=${enNames[n] ?? n}`);
}
writeFileSync(join(RP, 'texts', 'zh_CN.lang'), zhLines.join('\n') + '\n');
writeFileSync(join(RP, 'texts', 'en_US.lang'), enLines.join('\n') + '\n');
console.log(`~ lang: ${names.length} block names + group label`);

// ---------- 校验 ----------
console.log(`\n总计方块: ${names.length}`);
const missingTex = names.filter((n) => !texAlias[n] && !existsSync(join(RP, 'textures', 'blocks', `${n}.png`)));
if (missingTex.length) {
  console.error(`!! 缺少贴图: ${missingTex.join(', ')}`);
  process.exit(1);
}
console.log('贴图齐全 ✓');
