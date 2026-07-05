/* ============================================================
 * constants.js — ブロック/タイル/次元などエンジン共通の定義
 * ここに新しい鉱石やブロックを追加する場合は
 *  1) B に id を追加
 *  2) TILE にタイル番号を追加（ATLAS_COLS*ATLAS_ROWS の空きに収まるよう調整）
 *  3) BLOCK_DEFS に見た目・性質を追加
 *  4) js/core/textures.js の drawAll() にテクスチャ生成関数を追加
 * だけで良い（ワールド生成側は worlds/*.json の "ores" 設定で
 * 出現率を切り替えるだけで済む）。
 * ============================================================ */

// 実行時に world.json の内容で上書きされる可変設定
export const CFG = {
  SEED: 20260704,
  WORLD_SIZE: 512,
  CHUNK: 16,
  HEIGHT: 128,
  SEA: 30,
  SNOW_LINE: 72,
  RENDER_DIST: 8,
  GEN_PER_FRAME: 4,
  MESH_PER_FRAME: 2,
  REMESH_PER_FRAME: 3,
  GRAVITY: 28,
  REACH: 8,
  SAVE_KEY: 'minicraft_default_normal_v1',
  SPEED_WALK: 5.6,
  SPEED_FLY: 11,
  SPEED_WATER: 3.2
};
CFG.CHUNKS = CFG.WORLD_SIZE / CFG.CHUNK;

// ブロックID
export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, COBBLE: 4, SAND: 5, GRAVEL: 6,
  WOOD: 7, LEAVES: 8, GLASS: 9, WATER: 10, SNOW: 11, BRICK: 12,
  PLANKS: 13, WOOL: 14, GLOW: 15, BEDROCK: 16,
  CTABLE: 17, OBSIDIAN: 18, NETHERRACK: 19, PORTAL: 20,
  ENDSTONE: 21, EPF: 22, EPF_EYE: 23, ENDPORTAL: 24, LAVA: 25,
  COAL_ORE: 26, IRON_ORE: 27
};

// 名前 -> ID（JSON設定で文字列参照するため）
export function blockIdByName(name) {
  return Object.prototype.hasOwnProperty.call(B, name) ? B[name] : undefined;
}

// タイル（テクスチャアトラス内の番号）
export const TILE = {
  GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, COBBLE: 4, SAND: 5,
  GRAVEL: 6, LOG_SIDE: 7, LOG_TOP: 8, LEAVES: 9, GLASS: 10, WATER: 11,
  SNOW: 12, BRICK: 13, PLANKS: 14, WOOL: 15, GLOW: 16, BEDROCK: 17,
  CTABLE_TOP: 18, CTABLE_SIDE: 19, OBSIDIAN: 20, NETHERRACK: 21,
  PORTAL: 22, ENDSTONE: 23, EPF_SIDE: 24, EPF_TOP: 25, EPF_TOP_EYE: 26,
  ENDPORTAL: 27, LAVA: 28, COAL_ORE: 29, IRON_ORE: 30
};
// 6x6 = 36枠（将来の鉱石追加のため余裕を持たせてある）
export const ATLAS_COLS = 6, ATLAS_ROWS = 6;

// 次元
export const DIM = { OVER: 0, NETHER: 1, END: 2 };
export const DIM_NAME = ['オーバーワールド', 'ネザー', 'ジ・エンド'];

// コア道具アイテム（モジュールは registerItemDef() で追加登録する）
export const CORE_ITEM_DEFS = {
  flint: { name: '火打石 Flint & Steel（黒曜石の枠に使用）' },
  eye:   { name: 'エンダーアイ Eye of Ender（フレームに使用）' }
};

// tiles: [上面, 底面, 側面]
export const BLOCK_DEFS = [
  { name: 'Air',                    tiles: null,                                          solid: false, transparent: true },
  { name: '草ブロック Grass',        tiles: [TILE.GRASS_TOP, TILE.DIRT, TILE.GRASS_SIDE] },
  { name: '土 Dirt',                tiles: [TILE.DIRT, TILE.DIRT, TILE.DIRT] },
  { name: '石 Stone',               tiles: [TILE.STONE, TILE.STONE, TILE.STONE] },
  { name: '丸石 Cobblestone',       tiles: [TILE.COBBLE, TILE.COBBLE, TILE.COBBLE] },
  { name: '砂 Sand',                tiles: [TILE.SAND, TILE.SAND, TILE.SAND] },
  { name: '砂利 Gravel',            tiles: [TILE.GRAVEL, TILE.GRAVEL, TILE.GRAVEL] },
  { name: '原木 Wood',              tiles: [TILE.LOG_TOP, TILE.LOG_TOP, TILE.LOG_SIDE] },
  { name: '葉 Leaves',              tiles: [TILE.LEAVES, TILE.LEAVES, TILE.LEAVES],       transparent: true },
  { name: 'ガラス Glass',           tiles: [TILE.GLASS, TILE.GLASS, TILE.GLASS],          transparent: true, translucent: true },
  { name: '水 Water',               tiles: [TILE.WATER, TILE.WATER, TILE.WATER],          solid: false, transparent: true, translucent: true, liquid: true },
  { name: '雪 Snow',                tiles: [TILE.SNOW, TILE.SNOW, TILE.SNOW] },
  { name: 'レンガ Brick',           tiles: [TILE.BRICK, TILE.BRICK, TILE.BRICK] },
  { name: '木材 Planks',            tiles: [TILE.PLANKS, TILE.PLANKS, TILE.PLANKS] },
  { name: '羊毛 Wool',              tiles: [TILE.WOOL, TILE.WOOL, TILE.WOOL] },
  { name: 'グロウストーン Glowstone', tiles: [TILE.GLOW, TILE.GLOW, TILE.GLOW] },
  { name: '岩盤 Bedrock',           tiles: [TILE.BEDROCK, TILE.BEDROCK, TILE.BEDROCK],    breakable: false },
  { name: '作業台 Crafting Table',  tiles: [TILE.CTABLE_TOP, TILE.PLANKS, TILE.CTABLE_SIDE] },
  { name: '黒曜石 Obsidian',        tiles: [TILE.OBSIDIAN, TILE.OBSIDIAN, TILE.OBSIDIAN] },
  { name: 'ネザーラック Netherrack', tiles: [TILE.NETHERRACK, TILE.NETHERRACK, TILE.NETHERRACK] },
  { name: 'ネザーポータル Nether Portal', tiles: [TILE.PORTAL, TILE.PORTAL, TILE.PORTAL], solid: false, transparent: true, translucent: true },
  { name: 'エンドストーン End Stone', tiles: [TILE.ENDSTONE, TILE.ENDSTONE, TILE.ENDSTONE] },
  { name: 'エンドポータルフレーム End Portal Frame', tiles: [TILE.EPF_TOP, TILE.ENDSTONE, TILE.EPF_SIDE] },
  { name: 'フレーム（目入り） Frame + Eye', tiles: [TILE.EPF_TOP_EYE, TILE.ENDSTONE, TILE.EPF_SIDE] },
  { name: 'エンドポータル End Portal', tiles: [TILE.ENDPORTAL, TILE.ENDPORTAL, TILE.ENDPORTAL], solid: false, transparent: true, translucent: true },
  { name: '溶岩 Lava',              tiles: [TILE.LAVA, TILE.LAVA, TILE.LAVA],             solid: false, transparent: true, liquid: true },
  { name: '石炭鉱石 Coal Ore',      tiles: [TILE.COAL_ORE, TILE.COAL_ORE, TILE.COAL_ORE] },
  { name: '鉄鉱石 Iron Ore',        tiles: [TILE.IRON_ORE, TILE.IRON_ORE, TILE.IRON_ORE] }
];
for (const d of BLOCK_DEFS) {
  if (d.solid === undefined) d.solid = true;
  if (d.transparent === undefined) d.transparent = false;
  if (d.translucent === undefined) d.translucent = false;
  if (d.breakable === undefined) d.breakable = true;
  if (d.liquid === undefined) d.liquid = false;
}

export const BIOME = { PLAINS: 0, FOREST: 1, DESERT: 2, SNOW: 3, MOUNTAIN: 4 };

/* 立方体の6面定義（外向きCCW）
 * c: [px, py, pz, u, v] ×4頂点
 * 面番号: 0:-X 1:+X 2:-Y 3:+Y 4:-Z 5:+Z */
export const FACES = [
  { d: [-1, 0, 0], s: 0.82, c: [[0,1,0,0,1],[0,0,0,0,0],[0,1,1,1,1],[0,0,1,1,0]] },
  { d: [ 1, 0, 0], s: 0.82, c: [[1,1,1,0,1],[1,0,1,0,0],[1,1,0,1,1],[1,0,0,1,0]] },
  { d: [ 0,-1, 0], s: 0.55, c: [[1,0,1,1,0],[0,0,1,0,0],[1,0,0,1,1],[0,0,0,0,1]] },
  { d: [ 0, 1, 0], s: 1.00, c: [[0,1,1,1,1],[1,1,1,0,1],[0,1,0,1,0],[1,1,0,0,0]] },
  { d: [ 0, 0,-1], s: 0.72, c: [[1,0,0,0,0],[0,0,0,1,0],[1,1,0,0,1],[0,1,0,1,1]] },
  { d: [ 0, 0, 1], s: 0.72, c: [[0,0,1,0,0],[1,0,1,1,0],[0,1,1,0,1],[1,1,1,1,1]] }
];

// 次元ごとの既定の空・霧・光設定（world.json の "sky" で上書き可能）
export const DEFAULT_SKY = [
  { sky: 0x8fc6ea, fogNear: 55, fogFar: null, ambIntensity: 0.55, ambColor: 0xffffff, sunIntensity: 0.5,  sunColor: 0xfff3d8 },
  { sky: 0x2a0a0c, fogNear: 20, fogFar: 70,   ambIntensity: 0.5,  ambColor: 0xffb9a0, sunIntensity: 0.12, sunColor: 0xff8060 },
  { sky: 0x0c0a16, fogNear: 45, fogFar: null, ambIntensity: 0.5,  ambColor: 0xc8c0e8, sunIntensity: 0.25, sunColor: 0xb0a0ff }
];
