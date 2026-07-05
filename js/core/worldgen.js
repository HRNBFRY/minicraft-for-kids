/* ============================================================
 * worldgen.js — 巨大オープンワールド用 手続き型生成エンジン（Phase1）
 * ------------------------------------------------------------
 * 方針:
 *  - このファイルは THREE に依存しない純粋な生成ロジック。
 *  - 既存エンジン（world.js の従来パス）には一切触れず、world.json で
 *    "engine":"openworld" を指定したワールドのときだけ World に注入される。
 *  - シード値から用途別の独立ノイズ層を作り、複数のノイズを合成して
 *    「歩いているだけで景色が変わる」連続した世界を作る。
 *
 * 独立ノイズ層（Noise Layer）:
 *   Height / Temperature / Humidity / BiomeWeight / River / Cave
 *   Perlin(fBm) と Ridged(尾根) を組み合わせて自然な地形にする。
 *
 * バイオーム: 35種類（気候×標高×稀少マスクで決定）。色は気候から連続的に
 *   補間するため、境界は自然につながる。
 * ============================================================ */
import { Noise, derivedSeed } from './noise.js';
import { B } from './constants.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// バイオームID（表示・木の種類・稀にある固有色に使う）
export const OB = {
  DEEP_OCEAN: 0, OCEAN: 1, FROZEN_OCEAN: 2, CORAL_REEF: 3, BEACH: 4, STONE_SHORE: 5,
  RIVER: 6, PLAINS: 7, SUNFLOWER: 8, FLOWER: 9, MEADOW: 10, FOREST: 11, DARK_FOREST: 12,
  AUTUMN: 13, CHERRY: 14, BAMBOO: 15, JUNGLE: 16, TAIGA: 17, SNOWY_TAIGA: 18,
  SNOWY_PLAINS: 19, GLACIER: 20, SWAMP: 21, MARSH: 22, SAVANNA: 23, DESERT: 24,
  OASIS: 25, BADLANDS: 26, HILLS: 27, HIGHLANDS: 28, MOUNTAINS: 29, MOUNTAIN_FOREST: 30,
  ROCKY_PEAKS: 31, SNOWY_PEAKS: 32, VOLCANO: 33, HOT_SPRING: 34, MUSHROOM: 35
};

// バイオーム定義テーブル。tint省略時は気候から連続補間（=境界が自然）。
// tree: 'oak'|'birch'|'pine'|'jungle'|'acacia'|'cherry'|'palm'|'dead'|'giant'|'mush'|'none'
const DEF = {};
DEF[OB.DEEP_OCEAN]   = { name: '深海',       surf: B.GRAVEL, sub: B.STONE, tree: 'none' };
DEF[OB.OCEAN]        = { name: '海洋',       surf: B.SAND,   sub: B.STONE, tree: 'none' };
DEF[OB.FROZEN_OCEAN] = { name: '氷海',       surf: B.ICE,    sub: B.STONE, tree: 'none', water: [0.75, 0.85, 1.0] };
DEF[OB.CORAL_REEF]   = { name: 'サンゴ礁',   surf: B.SAND,   sub: B.SAND,  tree: 'none', water: [0.35, 0.85, 0.95] };
DEF[OB.BEACH]        = { name: '海岸',       surf: B.SAND,   sub: B.SAND,  tree: 'none' };
DEF[OB.STONE_SHORE]  = { name: '石の海岸',   surf: B.STONE,  sub: B.STONE, tree: 'none' };
DEF[OB.RIVER]        = { name: '川',         surf: B.SAND,   sub: B.DIRT,  tree: 'none' };
DEF[OB.PLAINS]       = { name: '草原',       surf: B.GRASS,  sub: B.DIRT,  tree: 'oak',    density: 0.03 };
DEF[OB.SUNFLOWER]    = { name: 'ヒマワリ平原', surf: B.GRASS, sub: B.DIRT,  tree: 'oak',    density: 0.02, tint: [0.9, 1.05, 0.45] };
DEF[OB.FLOWER]       = { name: '花畑',       surf: B.GRASS,  sub: B.DIRT,  tree: 'oak',    density: 0.05, tint: [0.95, 1.05, 0.7] };
DEF[OB.MEADOW]       = { name: '高原の草地', surf: B.GRASS,  sub: B.DIRT,  tree: 'oak',    density: 0.02, tint: [0.7, 1.0, 0.55] };
DEF[OB.FOREST]       = { name: '森林',       surf: B.GRASS,  sub: B.DIRT,  tree: 'oak',    density: 0.5 };
DEF[OB.DARK_FOREST]  = { name: '深い森',     surf: B.GRASS,  sub: B.DIRT,  tree: 'oak',    density: 0.85, tint: [0.42, 0.62, 0.32] };
DEF[OB.AUTUMN]       = { name: '紅葉の森',   surf: B.GRASS,  sub: B.DIRT,  tree: 'autumn', density: 0.6, tint: [0.85, 0.7, 0.4], leaf: [1.35, 0.7, 0.25] };
DEF[OB.CHERRY]       = { name: '桜',         surf: B.GRASS,  sub: B.DIRT,  tree: 'cherry', density: 0.55, tint: [0.75, 1.0, 0.6], leaf: [1.4, 0.72, 0.85] };
DEF[OB.BAMBOO]       = { name: '竹林',       surf: B.GRASS,  sub: B.DIRT,  tree: 'bamboo', density: 0.9, tint: [0.6, 1.05, 0.4] };
DEF[OB.JUNGLE]       = { name: 'ジャングル', surf: B.GRASS,  sub: B.DIRT,  tree: 'jungle', density: 0.8, tint: [0.45, 1.1, 0.32], leaf: [0.4, 1.05, 0.3] };
DEF[OB.TAIGA]        = { name: 'タイガ',     surf: B.GRASS,  sub: B.DIRT,  tree: 'pine',   density: 0.6, tint: [0.5, 0.78, 0.5], leaf: [0.4, 0.66, 0.42] };
DEF[OB.SNOWY_TAIGA]  = { name: '雪の針葉樹林', surf: B.SNOW, sub: B.DIRT,  tree: 'pine',   density: 0.5, snow: true, leaf: [0.55, 0.7, 0.6] };
DEF[OB.SNOWY_PLAINS] = { name: '雪原',       surf: B.SNOW,   sub: B.DIRT,  tree: 'none',   snow: true };
DEF[OB.GLACIER]      = { name: '氷河',       surf: B.ICE,    sub: B.SNOW,  tree: 'none',   snow: true, tint: [0.8, 0.9, 1.0] };
DEF[OB.SWAMP]        = { name: '沼',         surf: B.GRASS,  sub: B.DIRT,  tree: 'oak',    density: 0.3, tint: [0.5, 0.68, 0.42], water: [0.4, 0.55, 0.42] };
DEF[OB.MARSH]        = { name: '湿原',       surf: B.GRASS,  sub: B.DIRT,  tree: 'none',   density: 0.05, tint: [0.55, 0.75, 0.45], water: [0.45, 0.6, 0.45] };
DEF[OB.SAVANNA]      = { name: 'サバンナ',   surf: B.GRASS,  sub: B.DIRT,  tree: 'acacia', density: 0.12, tint: [1.1, 1.0, 0.42] };
DEF[OB.DESERT]       = { name: '砂漠',       surf: B.SAND,   sub: B.SAND,  tree: 'dead',   density: 0.02 };
DEF[OB.OASIS]        = { name: 'オアシス',   surf: B.GRASS,  sub: B.SAND,  tree: 'palm',   density: 0.4, tint: [0.75, 1.05, 0.4], water: [0.35, 0.8, 0.9] };
DEF[OB.BADLANDS]     = { name: '荒野',       surf: B.SAND,   sub: B.STONE, tree: 'none',   tint: [1.2, 0.65, 0.4] };
DEF[OB.HILLS]        = { name: '丘陵',       surf: B.GRASS,  sub: B.DIRT,  tree: 'oak',    density: 0.25 };
DEF[OB.HIGHLANDS]    = { name: '高地',       surf: B.GRASS,  sub: B.DIRT,  tree: 'pine',   density: 0.2, tint: [0.65, 0.9, 0.5] };
DEF[OB.MOUNTAINS]    = { name: '巨大山脈',   surf: B.STONE,  sub: B.STONE, tree: 'none' };
DEF[OB.MOUNTAIN_FOREST] = { name: '山の森', surf: B.GRASS,  sub: B.DIRT,  tree: 'pine',   density: 0.5, tint: [0.5, 0.8, 0.5], leaf: [0.42, 0.68, 0.44] };
DEF[OB.ROCKY_PEAKS]  = { name: '岩峰',       surf: B.STONE,  sub: B.STONE, tree: 'none' };
DEF[OB.SNOWY_PEAKS]  = { name: '雪山',       surf: B.SNOW,   sub: B.STONE, tree: 'none',   snow: true };
DEF[OB.VOLCANO]      = { name: '火山',       surf: B.NETHERRACK, sub: B.STONE, tree: 'none', tint: [0.9, 0.4, 0.35] };
DEF[OB.HOT_SPRING]   = { name: '温泉',       surf: B.GRASS,  sub: B.STONE, tree: 'pine',   density: 0.15, tint: [0.6, 0.85, 0.55], water: [0.5, 0.85, 0.95] };
DEF[OB.MUSHROOM]     = { name: 'キノコ島',   surf: B.MOSSY_STONE_BRICK, sub: B.DIRT, tree: 'mush', density: 0.3, tint: [0.7, 0.6, 0.75] };
export const OB_DEF = DEF;

export class OpenWorldGen {
  constructor(seed, cfg) {
    this.seed = seed >>> 0;
    this.sea = cfg.sea != null ? cfg.sea : 30;
    this.snowLine = cfg.snowLine != null ? cfg.snowLine : 76;
    const p = cfg.openworld || {};
    this.heightAmp = p.heightAmp != null ? p.heightAmp : 34;
    this.mountainAmp = p.mountainAmp != null ? p.mountainAmp : 96;
    this.contFreq = p.continentFreq != null ? p.continentFreq : 0.00085;
    // 用途別に相関の低い独立ノイズ層を作る（同一シードから決定的に派生）
    this.nCont  = new Noise(derivedSeed(seed, 0x00c0));  // 大陸・海（Height基盤）
    this.nHill  = new Noise(derivedSeed(seed, 0x1111));  // 丘の起伏（Height細部）
    this.nMtn   = new Noise(derivedSeed(seed, 0x2222));  // 山脈（Ridged）
    this.nDetail= new Noise(derivedSeed(seed, 0x3333));  // 表面ディテール
    this.nTemp  = new Noise(derivedSeed(seed, 0x4444));  // Temperature
    this.nHum   = new Noise(derivedSeed(seed, 0x5555));  // Humidity
    this.nWeird = new Noise(derivedSeed(seed, 0x6666));  // BiomeWeight（変種の選択）
    this.nRiver = new Noise(derivedSeed(seed, 0x7777));  // River
    this.nCaveA = new Noise(derivedSeed(seed, 0x8888));  // Cave
    this.nCaveB = new Noise(derivedSeed(seed, 0x9999));
    this.nSpec  = new Noise(derivedSeed(seed, 0xaaaa));  // 稀少バイオームマスク
    this._cache = new Map();
    this._cap = 220000;
  }

  // 気候（温度・湿度）。標高が高いほど寒くなる補正込み。返り値 [-1,1]
  climate(x, z, h) {
    let t = this.nTemp.fbm(x * 0.0011 + 41.3, z * 0.0011 - 8.7, 3) * 1.15;
    const m = this.nHum.fbm(x * 0.0013 - 77.1, z * 0.0013 + 120.5, 3) * 1.2;
    t -= Math.max(0, h - this.snowLine) * 0.02; // 高所は寒冷化
    return [clamp(t, -1, 1), clamp(m, -1, 1)];
  }

  // 気候から連続的に草・葉・水の色ティントを補間（境界が自然につながる要）
  climateGrass(t, m) {
    const warm = (t + 1) / 2, wet = (m + 1) / 2;
    return [
      clamp(0.6 + warm * 0.5 - wet * 0.18, 0.25, 1.4),
      clamp(0.8 + wet * 0.22 - Math.abs(t) * 0.06, 0.3, 1.3),
      clamp(0.32 + (1 - warm) * 0.4 - wet * 0.05, 0.2, 1.1)
    ];
  }
  climateWater(t) {
    const warm = (t + 1) / 2;
    return [clamp(0.42 + warm * 0.1, 0.3, 0.7), clamp(0.58 + warm * 0.18, 0.4, 0.85), clamp(1.0 - warm * 0.15, 0.7, 1.0)];
  }

  // 標高（連続）。大陸(海/陸)＋山脈(ridged)＋丘＋川の浸食。
  heightAt(x, z) {
    // 大陸ノイズを引き伸ばして海と陸をはっきり分ける
    const cont = clamp(this.nCont.fbm(x * this.contFreq, z * this.contFreq, 4) * 1.7 + 0.18, -1, 1);
    const land = smooth(-0.02, 0.12, cont); // 0=海 1=陸
    let h;
    if (cont < 0) {
      h = this.sea + cont * 30;                        // cont -1 → 海底(sea-30)
    } else {
      h = this.sea + Math.pow(cont, 1.15) * (this.heightAmp + 6); // なだらかな海岸→内陸
    }
    // 丘の起伏（陸のみ）
    h += this.nHill.fbm(x * 0.006 + 15.1, z * 0.006 - 9.4, 3) * 11 * land;
    // 山脈: ridgedノイズを内陸の高い所にだけ強く効かせる
    const ridge = this.nMtn.ridged(x * 0.0018 + 200.2, z * 0.0018 - 88.8, 4);
    const mmask = land * smooth(0.32, 0.72, cont);
    h += ridge * this.mountainAmp * mmask;
    // 表面ディテール
    h += this.nDetail.fbm(x * 0.03, z * 0.03, 2) * 3;
    return { h, cont, land };
  }

  // 川の強さ 0..1（1に近いほど川底）。海では無効。
  riverStrength(x, z, land) {
    if (land < 0.25) return 0;
    const [wx, wz] = this.nRiver.warp(x * 0.0016, z * 0.0016, 0.7, 0.004);
    const r = Math.abs(this.nRiver.fbm(wx, wz, 3));
    return smooth(0.05, 0.0, r) * land; // r が 0 付近 = 川
  }

  classify(x, z, h, cont, land, t, m, river) {
    const sea = this.sea;
    // --- 川（水域判定より先に。陸を横切る水路） ---
    if (river > 0.6 && land > 0.25 && h <= sea + 1) return OB.RIVER;
    // --- 水域 ---
    if (h < sea - 1) {
      if (h < sea - 9) return t < -0.45 ? OB.FROZEN_OCEAN : OB.DEEP_OCEAN;
      if (t > 0.35 && h > sea - 5) return OB.CORAL_REEF;
      return t < -0.45 ? OB.FROZEN_OCEAN : OB.OCEAN;
    }
    // --- 海岸 ---
    if (h <= sea + 1) {
      if (t < -0.4) return OB.SNOWY_PLAINS;
      return (h > sea && this.nWeird.fbm(x * 0.02, z * 0.02, 2) > 0.3) ? OB.STONE_SHORE : OB.BEACH;
    }
    const w = this.nWeird.fbm(x * 0.004 + 5.0, z * 0.004 - 3.0, 3);
    const spec = this.nSpec.fbm(x * 0.02, z * 0.02, 2);
    // --- 稀少バイオーム（島・火山・温泉・キノコ島） ---
    if (land > 0.8 && cont < 0.14 && this.nSpec.fbm(x * 0.01 + 500, z * 0.01 - 500, 2) > 0.4)
      return OB.MUSHROOM;
    if (t > 0.25 && spec > 0.45 && h > sea + 4 && h < this.snowLine) return OB.VOLCANO;
    // --- 高標高帯 ---
    if (h > this.snowLine + 22) return (t < -0.2 || h > this.snowLine + 30) ? OB.SNOWY_PEAKS : OB.ROCKY_PEAKS;
    if (h > this.snowLine + 4) {
      if (t < -0.3) return OB.SNOWY_PEAKS;
      return m > 0.1 ? OB.MOUNTAIN_FOREST : OB.MOUNTAINS;
    }
    if (h > this.snowLine - 10) {
      if (t < -0.35) return OB.SNOWY_TAIGA;
      if (spec < -0.42 && t < 0.1) return OB.HOT_SPRING;
      return m > 0.0 ? OB.HIGHLANDS : OB.HILLS;
    }
    // --- 低地: 気候×変種 ---
    if (t < -0.35) { // 寒冷
      if (t < -0.62 && m < 0.25) return OB.GLACIER;
      if (m > 0.0) return OB.SNOWY_TAIGA;
      return OB.SNOWY_PLAINS;
    }
    if (t > 0.38) { // 温暖・乾燥〜湿潤
      if (m < -0.3) {
        if (spec > 0.42) return OB.OASIS; // 砂漠の中の緑地（稀）
        return (w > 0.1 ? OB.BADLANDS : OB.DESERT);
      }
      if (m < 0.0) return OB.SAVANNA;
      if (m > 0.45) return w > 0.2 ? OB.BAMBOO : OB.JUNGLE;
      return OB.JUNGLE;
    }
    // 温帯
    if (m < -0.3) return OB.PLAINS;
    if (m > 0.5) return river > 0.2 || h < sea + 4 ? OB.SWAMP : OB.MARSH;
    if (m > 0.15) { // 森林系
      if (w > 0.45) return OB.CHERRY;
      if (w > 0.2) return OB.AUTUMN;
      if (w < -0.4) return OB.DARK_FOREST;
      if (t < -0.05) return OB.TAIGA;
      return OB.FOREST;
    }
    // 草原系
    if (w > 0.5) return OB.SUNFLOWER;
    if (w > 0.25) return OB.FLOWER;
    if (w < -0.4) return OB.MEADOW;
    return OB.PLAINS;
  }

  // 1カラム分の全情報。world.js から列ごとに呼ばれ、キャッシュされる。
  column(x, z) {
    const key = x * 16777619 + z; // 数値キー（大規模でも安全域）
    const c = this._cache.get(key);
    if (c) return c;
    const { h: rawH, cont, land } = this.heightAt(x, z);
    const river = this.riverStrength(x, z, land);
    let h = rawH;
    if (river > 0.4) { // 川の浸食: 強い川筋は水面下の川底まで下げる
      const bed = this.sea - 1 - river * 2;
      h = lerp(h, Math.min(h, bed), smooth(0.4, 0.9, river));
    }
    h = clamp(h, 3, 122) | 0;
    const [t, m] = this.climate(x, z, h);
    const biome = this.classify(x, z, h, cont, land, t, m, river);
    const def = DEF[biome];
    // 色: 気候から連続補間し、固有色を持つバイオームだけ上書き（境界は自然）
    let tintG = def.tint ? def.tint : this.climateGrass(t, m);
    let tintL = def.leaf ? def.leaf : tintG;
    let tintW = def.water ? def.water : this.climateWater(t);
    const out = {
      h, biome, surf: def.surf, sub: def.sub, snow: !!def.snow,
      tree: def.tree || 'none', density: def.density || 0,
      tintG, tintL, tintW, river
    };
    if (this._cache.size >= this._cap) this._cache.clear();
    this._cache.set(key, out);
    return out;
  }

  // 洞窟: 2つのノイズが同時に0付近＝トンネル/空洞。地表付近は掘らない。
  caveAt(x, y, z) {
    if (y < 4 || y > 96) return false;
    const a = this.nCaveA.fbm(x * 0.028, (y * 1.6) * 0.028 + z * 0.004, 2);
    const b = this.nCaveB.fbm(x * 0.028 + 100, (y * 1.6) * 0.028 - z * 0.004 + 50, 2);
    const yb = smooth(4, 12, y) * smooth(96, 70, y); // 端では細く
    return (a * a + b * b) < 0.0055 * yb;
  }
}
