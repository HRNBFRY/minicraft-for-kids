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

// デプロイ確認用のバージョン表示（タイトル画面に出す）。
// 変更を commit するたびに、ここの日付・連番を更新すること。
export const GAME_VERSION = '2026.07.05-3';

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
  COAL_ORE: 26, IRON_ORE: 27,
  // ここから追加ブロック（インベントリ拡張分）
  END_CRYSTAL: 28, ENCHANT_TABLE: 29, FURNACE: 30,
  BED_RED: 31, BED_BLUE: 32, BED_GREEN: 33, BED_YELLOW: 34, BED_WHITE: 35,
  COMMAND_BLOCK: 36, PISTON: 37, STICKY_PISTON: 38,
  REDSTONE_TORCH: 39, REDSTONE_BLOCK: 40, REDSTONE_LAMP: 41, LEVER: 42,
  TNT: 43, BOOKSHELF: 44, NETHER_BRICK: 45, QUARTZ_BLOCK: 46,
  GOLD_BLOCK: 47, DIAMOND_BLOCK: 48, EMERALD_BLOCK: 49,
  STONE_BRICK: 50, MOSSY_STONE_BRICK: 51, PUMPKIN: 52, MELON_BLOCK: 53,
  HAY_BALE: 54, ICE: 55, SPONGE: 56, BONE_BLOCK: 57
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
  ENDPORTAL: 27, LAVA: 28, COAL_ORE: 29, IRON_ORE: 30,
  // ここから追加タイル（インベントリ拡張分）
  END_CRYSTAL: 31, ENCHANT_TOP: 32, ENCHANT_SIDE: 33,
  FURNACE_TOP: 34, FURNACE_SIDE: 35,
  BED_RED: 36, BED_BLUE: 37, BED_GREEN: 38, BED_YELLOW: 39, BED_WHITE: 40,
  COMMAND_BLOCK: 41, PISTON: 42, STICKY_PISTON: 43,
  REDSTONE_TORCH: 44, REDSTONE_BLOCK: 45, REDSTONE_LAMP: 46, LEVER: 47,
  TNT: 48, BOOKSHELF: 49, NETHER_BRICK: 50, QUARTZ_BLOCK: 51,
  GOLD_BLOCK: 52, DIAMOND_BLOCK: 53, EMERALD_BLOCK: 54,
  STONE_BRICK: 55, MOSSY_STONE_BRICK: 56, PUMPKIN: 57, MELON_BLOCK: 58,
  HAY_BALE: 59, ICE: 60, SPONGE: 61, BONE_BLOCK: 62
};
// 8x8 = 64枠（インベントリ拡張のため 6x6 から拡張。まだ数枠の余裕あり）
export const ATLAS_COLS = 8, ATLAS_ROWS = 8;

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
  { name: '鉄鉱石 Iron Ore',        tiles: [TILE.IRON_ORE, TILE.IRON_ORE, TILE.IRON_ORE] },
  // ここから追加ブロック（インベントリ拡張分）
  { name: 'エンドクリスタル End Crystal', tiles: [TILE.END_CRYSTAL, TILE.END_CRYSTAL, TILE.END_CRYSTAL], transparent: true, translucent: true },
  { name: 'エンチャントテーブル Enchanting Table', tiles: [TILE.ENCHANT_TOP, TILE.OBSIDIAN, TILE.ENCHANT_SIDE] },
  { name: 'かまど Furnace',         tiles: [TILE.FURNACE_TOP, TILE.FURNACE_TOP, TILE.FURNACE_SIDE] },
  { name: 'ベッド(赤) Bed Red',     tiles: [TILE.BED_RED, TILE.BED_RED, TILE.BED_RED] },
  { name: 'ベッド(青) Bed Blue',    tiles: [TILE.BED_BLUE, TILE.BED_BLUE, TILE.BED_BLUE] },
  { name: 'ベッド(緑) Bed Green',   tiles: [TILE.BED_GREEN, TILE.BED_GREEN, TILE.BED_GREEN] },
  { name: 'ベッド(黄) Bed Yellow',  tiles: [TILE.BED_YELLOW, TILE.BED_YELLOW, TILE.BED_YELLOW] },
  { name: 'ベッド(白) Bed White',   tiles: [TILE.BED_WHITE, TILE.BED_WHITE, TILE.BED_WHITE] },
  { name: 'コマンドブロック Command Block', tiles: [TILE.COMMAND_BLOCK, TILE.COMMAND_BLOCK, TILE.COMMAND_BLOCK] },
  { name: 'ピストン Piston',        tiles: [TILE.PISTON, TILE.PISTON, TILE.PISTON] },
  { name: '粘着ピストン Sticky Piston', tiles: [TILE.STICKY_PISTON, TILE.STICKY_PISTON, TILE.STICKY_PISTON] },
  { name: 'レッドストーントーチ Redstone Torch', tiles: [TILE.REDSTONE_TORCH, TILE.REDSTONE_TORCH, TILE.REDSTONE_TORCH] },
  { name: 'レッドストーンブロック Redstone Block', tiles: [TILE.REDSTONE_BLOCK, TILE.REDSTONE_BLOCK, TILE.REDSTONE_BLOCK] },
  { name: 'レッドストーンランプ Redstone Lamp', tiles: [TILE.REDSTONE_LAMP, TILE.REDSTONE_LAMP, TILE.REDSTONE_LAMP] },
  { name: 'レバー Lever',           tiles: [TILE.LEVER, TILE.LEVER, TILE.LEVER] },
  { name: 'TNT',                    tiles: [TILE.TNT, TILE.TNT, TILE.TNT] },
  { name: '本棚 Bookshelf',         tiles: [TILE.BOOKSHELF, TILE.BOOKSHELF, TILE.BOOKSHELF] },
  { name: 'ネザーレンガ Nether Bricks', tiles: [TILE.NETHER_BRICK, TILE.NETHER_BRICK, TILE.NETHER_BRICK] },
  { name: 'クォーツブロック Quartz Block', tiles: [TILE.QUARTZ_BLOCK, TILE.QUARTZ_BLOCK, TILE.QUARTZ_BLOCK] },
  { name: '金ブロック Gold Block',  tiles: [TILE.GOLD_BLOCK, TILE.GOLD_BLOCK, TILE.GOLD_BLOCK] },
  { name: 'ダイヤモンドブロック Diamond Block', tiles: [TILE.DIAMOND_BLOCK, TILE.DIAMOND_BLOCK, TILE.DIAMOND_BLOCK] },
  { name: 'エメラルドブロック Emerald Block', tiles: [TILE.EMERALD_BLOCK, TILE.EMERALD_BLOCK, TILE.EMERALD_BLOCK] },
  { name: '石レンガ Stone Bricks',  tiles: [TILE.STONE_BRICK, TILE.STONE_BRICK, TILE.STONE_BRICK] },
  { name: '苔石レンガ Mossy Stone Bricks', tiles: [TILE.MOSSY_STONE_BRICK, TILE.MOSSY_STONE_BRICK, TILE.MOSSY_STONE_BRICK] },
  { name: 'かぼちゃ Pumpkin',       tiles: [TILE.PUMPKIN, TILE.PUMPKIN, TILE.PUMPKIN] },
  { name: 'スイカブロック Melon Block', tiles: [TILE.MELON_BLOCK, TILE.MELON_BLOCK, TILE.MELON_BLOCK] },
  { name: '干し草の俵 Hay Bale',    tiles: [TILE.HAY_BALE, TILE.HAY_BALE, TILE.HAY_BALE] },
  { name: '氷 Ice',                 tiles: [TILE.ICE, TILE.ICE, TILE.ICE], transparent: true, translucent: true },
  { name: 'スポンジ Sponge',        tiles: [TILE.SPONGE, TILE.SPONGE, TILE.SPONGE] },
  { name: '骨ブロック Bone Block',  tiles: [TILE.BONE_BLOCK, TILE.BONE_BLOCK, TILE.BONE_BLOCK] }
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
