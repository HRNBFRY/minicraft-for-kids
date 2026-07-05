/* ---------------- Chunk / World: 地形生成・編集・レイキャスト ----------------
 * 地形の見た目や出現率は World 構築時に渡される terrainCfg（worlds/*.json 由来）
 * だけで変化する。アルゴリズム自体は全ワールド共通（"同じ機能を複数実装しない"方針）。
 */
import { CFG, B, BLOCK_DEFS, BIOME, FACES, DIM, ATLAS_COLS, ATLAS_ROWS } from './constants.js';
import { hash2, hash3, Noise } from './noise.js';

// 描画半径内のオフセット（近い順） -- CFG.RENDER_DIST 確定後に構築
export function buildOffsets() {
  const OFFSETS = [];
  for (let dz = -CFG.RENDER_DIST; dz <= CFG.RENDER_DIST; dz++)
    for (let dx = -CFG.RENDER_DIST; dx <= CFG.RENDER_DIST; dx++)
      OFFSETS.push([dx, dz]);
  OFFSETS.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]));
  return OFFSETS;
}
const NB4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth01 = t => t * t * (3 - 2 * t);

export class Chunk {
  constructor(world, cx, cz) {
    this.world = world;
    this.cx = cx; this.cz = cz;
    this.data = null;        // Uint8Array
    this.solidMesh = null;   // 不透明メッシュ
    this.alphaMesh = null;   // 半透明メッシュ（水・ガラス）
    this.meshed = false;
  }
  generate() {
    if (this.world.dim === DIM.NETHER) { this.generateNether(); return; }
    if (this.world.dim === DIM.END) { this.generateEnd(); return; }
    if (this.world.gen) { this.generateOpen(); return; } // 巨大オープンワールド
    const d = new Uint8Array(16 * 16 * CFG.HEIGHT);
    const w = this.world, x0 = this.cx * 16, z0 = this.cz * 16;
    const sea = w.terrain.sea;
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const gx = x0 + lx, gz = z0 + lz;
      w.columnInto(gx, gz);
      const h = w.colH, biome = w.colB;
      const beach = h >= sea - 2 && h <= sea + 1;
      const col = lx + (lz << 4);
      for (let y = 0; y <= h; y++) {
        let id;
        if (y === 0) id = B.BEDROCK;
        else if (y < h - 3) {
          id = w.pickUnderground(gx, y, gz);
        } else if (y < h) {
          id = (biome === BIOME.DESERT || beach) ? B.SAND : B.DIRT;
        } else { // 表面
          if (biome === BIOME.DESERT) id = B.SAND;
          else if (h < sea - 2) {
            const r = hash2(gx, gz, w.seed ^ 0x5ea);
            id = r < 0.35 ? B.SAND : (r < 0.55 ? B.GRAVEL : B.DIRT);
          }
          else if (beach) id = hash2(gx, gz, w.seed ^ 0xbeac) < 0.2 ? B.GRAVEL : B.SAND;
          else if (biome === BIOME.SNOW) id = B.SNOW;
          else if (biome === BIOME.MOUNTAIN && h > 66) id = B.STONE;
          else id = B.GRASS;
        }
        d[col + (y << 8)] = id;
      }
      // 海抜以下は水を自動生成
      for (let y = h + 1; y <= sea; y++) d[col + (y << 8)] = B.WATER;
    }
    this.data = d;
    this.plantTrees();
    this.applyEdits();
  }
  // 巨大オープンワールド地形: gen（OpenWorldGen）が返す列情報で地表・地下・水・洞窟を組む
  generateOpen() {
    const d = new Uint8Array(16 * 16 * CFG.HEIGHT);
    const w = this.world, gen = w.gen, x0 = this.cx * 16, z0 = this.cz * 16;
    const sea = w.terrain.sea;
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const gx = x0 + lx, gz = z0 + lz, col = lx + (lz << 4);
      const c = gen.column(gx, gz);
      const h = c.h, land = h > sea;
      // 峡谷: 高台で谷ノイズが強い列は上部を削って切り立った渓谷にする
      let carveTop = -1;
      if (land && h > sea + 10) {
        const cs = gen.canyonStrength(gx, gz);
        if (cs > 0.28) carveTop = h - Math.round(cs * Math.min(h - sea - 4, 24));
      }
      for (let y = 0; y <= h; y++) {
        let id;
        if (y === 0) id = B.BEDROCK;
        else if (y < h - 3) id = w.pickUnderground(gx, y, gz); // 鉱石＋石（既存関数を再利用）
        else if (y < h) id = c.sub;
        else id = c.surf; // 地表
        // 洞窟: 陸の地下だけ空洞化（海底のスカスカ化を防ぐ）
        if (id !== B.BEDROCK && y < h && land && gen.caveAt(gx, y, gz)) id = B.AIR;
        if (carveTop >= 1 && y > carveTop && y < h) id = B.AIR; // 峡谷の削り
        d[col + (y << 8)] = id;
      }
      for (let y = h + 1; y <= sea; y++) d[col + (y << 8)] = B.WATER; // 海抜以下を水で満たす
    }
    this.data = d;
    this.plantTreesOpen();
    this.placeFeatures(); // 自然生成の巨大構造・ランドマーク（Phase2）
    this.applyEdits();
  }
  // オープンワールドの植生: 列ごとの biome/tree/density に従い木を配置
  plantTreesOpen() {
    const w = this.world, gen = w.gen, x0 = this.cx * 16, z0 = this.cz * 16;
    if (!w.plantsEnabled) return;
    const sea = w.terrain.sea;
    for (let gz = z0 - 3; gz < z0 + 19; gz++) for (let gx = x0 - 3; gx < x0 + 19; gx++) {
      if (gx < 0 || gz < 0 || gx >= CFG.WORLD_SIZE || gz >= CFG.WORLD_SIZE) continue;
      const c = gen.column(gx, gz);
      if (c.tree === 'none' || c.density <= 0) continue;
      const r = hash2(gx, gz, w.seed ^ 0x7ee5);
      if (r >= c.density * 0.12) continue; // density(0..0.9) を出現確率へ写像
      const h = c.h;
      if (h <= sea || h > CFG.HEIGHT - 16) continue;
      if (h > sea + 10 && gen.canyonStrength(gx, gz) > 0.28) continue; // 峡谷で削れた列には植えない
      this.drawTree(gx, h, gz, c.tree);
    }
  }
  // 木の形状（種別ごと）。幹=WOOD、葉=LEAVES（色はバイオームtintで変化）
  drawTree(gx, h, gz, kind) {
    const w = this.world, seed = w.seed;
    const rnd = (s) => hash2(gx, gz, seed ^ s);
    const canopy = (cy, rad, chop) => {
      for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
        if (chop && Math.abs(dx) === rad && Math.abs(dz) === rad && hash3(gx + dx, cy, gz + dz, seed) < 0.55) continue;
        this.setLocalIfEmpty(gx + dx, cy, gz + dz, B.LEAVES);
      }
    };
    if (kind === 'bamboo') { // 竹: 細く高い数本
      const n = 1 + (rnd(0x1) * 3 | 0);
      for (let k = 0; k < n; k++) {
        const bx = gx + (k % 2), bz = gz + ((k >> 1) & 1);
        const th = 5 + (hash2(bx, bz, seed ^ 0x2) * 6 | 0);
        for (let y = h + 1; y <= h + th; y++) this.setLocal(bx, y, bz, B.WOOD);
        this.setLocalIfEmpty(bx, h + th + 1, bz, B.LEAVES);
      }
      return;
    }
    if (kind === 'dead') { // 枯れ木: 幹のみ
      const th = 3 + (rnd(0x3) * 3 | 0);
      for (let y = h + 1; y <= h + th; y++) this.setLocal(gx, y, gz, B.WOOD);
      return;
    }
    if (kind === 'pine') { // 針葉樹: 円錐
      const th = 7 + (rnd(0x4) * 5 | 0);
      for (let y = h + 1; y <= h + th; y++) this.setLocal(gx, y, gz, B.WOOD);
      for (let ly = h + 3; ly <= h + th + 1; ly++) {
        const rad = Math.max(0, Math.round((h + th - ly) / 2));
        canopy(ly, rad, rad >= 2);
      }
      return;
    }
    if (kind === 'palm') { // ヤシ: 高い幹＋頂上の葉
      const th = 6 + (rnd(0x5) * 3 | 0);
      for (let y = h + 1; y <= h + th; y++) this.setLocal(gx, y, gz, B.WOOD);
      for (const [dx, dz] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, -1], [1, -1], [-1, 1]])
        this.setLocalIfEmpty(gx + dx, h + th + (dx || dz ? 0 : 1), gz + dz, B.LEAVES);
      return;
    }
    if (kind === 'acacia') { // アカシア: 平たい傘状
      const th = 5 + (rnd(0x6) * 2 | 0);
      for (let y = h + 1; y <= h + th; y++) this.setLocal(gx, y, gz, B.WOOD);
      canopy(h + th, 3, true); canopy(h + th + 1, 2, true);
      return;
    }
    if (kind === 'jungle' || kind === 'giant') { // ジャングル大木
      const th = 9 + (rnd(0x7) * 8 | 0);
      for (let y = h + 1; y <= h + th; y++) this.setLocal(gx, y, gz, B.WOOD);
      canopy(h + th, 2, true); canopy(h + th - 1, 3, true); canopy(h + th - 2, 2, true);
      return;
    }
    if (kind === 'mush') { // 巨大キノコ: 幹＋広い笠
      const th = 4 + (rnd(0x8) * 3 | 0);
      for (let y = h + 1; y <= h + th; y++) this.setLocal(gx, y, gz, B.WOOD);
      canopy(h + th + 1, 3, true);
      for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) this.setLocalIfEmpty(gx + dx, h + th, gz + dz, B.LEAVES);
      return;
    }
    // oak / autumn / cherry / birch など標準広葉樹（色はtintで差が出る）
    const th = 4 + (rnd(0x9) * 3 | 0);
    for (let y = h + 1; y <= h + th; y++) this.setLocal(gx, y, gz, B.WOOD);
    canopy(h + th - 1, 2, true); canopy(h + th, 2, true); canopy(h + th + 1, 1, false);
  }

  /* ========== Phase2: 自然生成の巨大構造・ランドマーク ==========
   * 各セルは決定的に1つの地表ランドマークを持ち、500〜1000ブロックの空白を作らない。
   * 各スタンプは「自分のチャンクに重なる範囲だけ」を書く（木・要塞と同じ分割描画方式）。*/
  placeFeatures() {
    const w = this.world, gen = w.gen;
    const x0 = this.cx * 16, z0 = this.cz * 16;
    const LM = gen.LM, R = gen.LM_MAXR;
    const cx0 = Math.floor((x0 - R) / LM), cx1 = Math.floor((x0 + 15 + R) / LM);
    const cz0 = Math.floor((z0 - R) / LM), cz1 = Math.floor((z0 + 15 + R) / LM);
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      if (cx < 0 || cz < 0) continue;
      const f = gen.landmarkCell(cx, cz);
      if (!this.bboxHits(f.ax, f.az, R)) continue;
      this.stampLandmark(f);
    }
    const UG = gen.UG, UR = 22;
    const ux0 = Math.floor((x0 - UR) / UG), ux1 = Math.floor((x0 + 15 + UR) / UG);
    const uz0 = Math.floor((z0 - UR) / UG), uz1 = Math.floor((z0 + 15 + UR) / UG);
    for (let uz = uz0; uz <= uz1; uz++) for (let ux = ux0; ux <= ux1; ux++) {
      if (ux < 0 || uz < 0) continue;
      const f = gen.undergroundCell(ux, uz);
      if (f && this.bboxHits(f.ax, f.az, UR)) this.stampUnderground(f);
    }
    // 都市（Phase3）: ランドマークより大きいセルを確率的に走査
    const CITY = gen.CITY, CR = 200; // 探索マージン（実際の都市半径は f.R で個別判定）
    const cx0c = Math.floor((x0 - CR) / CITY), cx1c = Math.floor((x0 + 15 + CR) / CITY);
    const cz0c = Math.floor((z0 - CR) / CITY), cz1c = Math.floor((z0 + 15 + CR) / CITY);
    for (let cz = cz0c; cz <= cz1c; cz++) for (let cx = cx0c; cx <= cx1c; cx++) {
      if (cx < 0 || cz < 0) continue;
      const f = gen.cityCell(cx, cz);
      if (f && this.bboxHits(f.ax, f.az, f.R)) this.stampCity(f);
    }
  }
  bboxHits(ax, az, R) {
    const x0 = this.cx * 16, z0 = this.cz * 16;
    return ax + R >= x0 && ax - R <= x0 + 15 && az + R >= z0 && az - R <= z0 + 15;
  }
  // このチャンクと [ax±R, az±R] の交差範囲を (gx,gz) で走査するヘルパ
  _each(ax, az, R, fn) {
    const x0 = this.cx * 16, z0 = this.cz * 16;
    const gx0 = Math.max(x0, ax - R), gx1 = Math.min(x0 + 15, ax + R);
    const gz0 = Math.max(z0, az - R), gz1 = Math.min(z0 + 15, az + R);
    for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) fn(gx, gz);
  }
  gh(gx, gz) { return this.world.gen.column(gx, gz).h; }

  stampLandmark(f) {
    switch (f.type) {
      case 'volcano': return this.stampVolcano(f);
      case 'giant_tree': return this.stampGiantTree(f);
      case 'mushroom': case 'giant_mushroom_field': return this.stampGiantMushroom(f);
      case 'float': return this.stampFloatingIsland(f);
      case 'arch': return this.stampArch(f);
      case 'tower': return this.stampTower(f);
      case 'waterfall': return this.stampWaterfall(f);
      case 'hot_spring': return this.stampHotSpring(f);
      case 'island': return this.stampIsland(f);
    }
  }

  stampVolcano(f) {
    const gen = this.world.gen, ax = f.ax, az = f.az, base = f.h;
    const R = 16 + (hash2(ax, az, f.fseed) * 10 | 0);
    const peak = base + R + 6;
    this._each(ax, az, R, (gx, gz) => {
      const dx = gx - ax, dz = gz - az, d = Math.sqrt(dx * dx + dz * dz);
      if (d > R) return;
      const rimH = Math.round(peak - (d / R) * (peak - base));
      const g = gen.column(gx, gz).h;
      for (let y = Math.max(1, g); y <= rimH; y++)
        this.setLocal(gx, y, gz, hash3(gx, y, gz, f.fseed) < 0.25 ? B.NETHERRACK : B.STONE);
      if (d < R * 0.34) { // 火口＋溶岩
        const cf = peak - 5;
        for (let y = cf + 1; y <= rimH; y++) this.setLocal(gx, y, gz, B.AIR);
        this.setLocal(gx, cf, gz, B.LAVA);
      }
    });
  }

  stampGiantTree(f) {
    const ax = f.ax, az = f.az, base = f.h;
    const th = 16 + (hash2(ax, az, f.fseed) * 10 | 0);
    const cr = 5 + (hash2(ax, az, f.fseed ^ 0x9) * 3 | 0); // 樹冠半径
    const cyTop = base + th, R = cr + 1;
    this._each(ax, az, R, (gx, gz) => {
      const inTrunk = (gx === ax || gx === ax + 1) && (gz === az || gz === az + 1);
      if (inTrunk) for (let y = base + 1; y <= cyTop; y++) this.setLocal(gx, y, gz, B.WOOD);
      const dx = gx - (ax + 0.5), dz = gz - (az + 0.5);
      for (let y = cyTop - cr; y <= cyTop + cr - 1; y++) {
        const dy = (y - cyTop) * 1.15;
        if (dx * dx + dz * dz + dy * dy <= cr * cr) this.setLocalIfEmpty(gx, y, gz, B.LEAVES);
      }
    });
  }

  stampGiantMushroom(f) {
    const ax = f.ax, az = f.az, base = f.h;
    const th = 8 + (hash2(ax, az, f.fseed) * 6 | 0);
    const cr = 4 + (hash2(ax, az, f.fseed ^ 0x3) * 3 | 0);
    const capY = base + th, R = cr + 1;
    this._each(ax, az, R, (gx, gz) => {
      if (gx === ax && gz === az) for (let y = base + 1; y <= capY; y++) this.setLocal(gx, y, gz, B.WOOD);
      const dx = gx - ax, dz = gz - az, d2 = dx * dx + dz * dz;
      if (d2 <= cr * cr) { // 笠（かさ）
        this.setLocalIfEmpty(gx, capY + 1, gz, B.LEAVES);
        if (d2 >= (cr - 1) * (cr - 1)) this.setLocalIfEmpty(gx, capY, gz, B.LEAVES); // 笠の縁を垂らす
      }
    });
  }

  stampFloatingIsland(f) {
    const ax = f.ax, az = f.az;
    const rx = 7 + (hash2(ax, az, f.fseed) * 5 | 0);
    let iy = Math.max(f.h + 28, this.world.terrain.sea + 42);
    iy = Math.min(iy, CFG.HEIGHT - 14);
    const R = rx + 1;
    this._each(ax, az, R, (gx, gz) => {
      const dx = gx - ax, dz = gz - az, dd = dx * dx + dz * dz;
      const rr = rx * Math.sqrt(Math.max(0, 1 - dd / (rx * rx)));
      if (dd > rx * rx) return;
      const bottom = iy - Math.round(rr) - 1; // 下面はしずく状に尖らせる
      for (let y = bottom; y <= iy; y++) {
        const id = y === iy ? B.GRASS : (y >= iy - 2 ? B.DIRT : B.STONE);
        this.setLocal(gx, y, gz, id);
      }
      if (dx === 0 && dz === 0) { // 中央に木
        for (let y = iy + 1; y <= iy + 4; y++) this.setLocal(gx, y, gz, B.WOOD);
        for (let ddx = -2; ddx <= 2; ddx++) for (let ddz = -2; ddz <= 2; ddz++)
          this.setLocalIfEmpty(gx + ddx, iy + 4, gz + ddz, B.LEAVES);
      }
    });
  }

  stampArch(f) { // 天然橋（石のアーチ）
    const ax = f.ax, az = f.az, base = f.h;
    const horiz = hash2(ax, az, f.fseed) < 0.5;
    const L = 14 + (hash2(ax, az, f.fseed ^ 0x5) * 10 | 0);
    const H = 7 + (hash2(ax, az, f.fseed ^ 0x6) * 5 | 0);
    const wdt = 1 + (hash2(ax, az, f.fseed ^ 0x7) * 2 | 0);
    const R = Math.ceil(L / 2) + wdt + 1;
    this._each(ax, az, R, (gx, gz) => {
      const along = horiz ? gx - (ax - (L >> 1)) : gz - (az - (L >> 1));
      const side = horiz ? gz - az : gx - ax;
      if (along < 0 || along > L || Math.abs(side) > wdt) return;
      const yTop = base + Math.round(H * Math.sin(Math.PI * along / L));
      const g = this.gh(gx, gz);
      for (let y = yTop - 1; y <= yTop + 1; y++) this.setLocal(gx, y, gz, hash3(gx, y, gz, f.fseed) < 0.3 ? B.MOSSY_STONE_BRICK : B.STONE);
      if (along === 0 || along === L) for (let y = g; y < yTop - 1; y++) this.setLocal(gx, y, gz, B.STONE); // 脚
    });
  }

  stampTower(f) { // 塔・遺跡（半壊の石レンガ塔）
    const ax = f.ax, az = f.az, base = f.h;
    const rad = 3 + (hash2(ax, az, f.fseed) * 2 | 0);
    const th = 10 + (hash2(ax, az, f.fseed ^ 0x2) * 9 | 0);
    const R = rad + 1;
    this._each(ax, az, R, (gx, gz) => {
      const dx = gx - ax, dz = gz - az, d = Math.sqrt(dx * dx + dz * dz);
      if (d > rad + 0.3) return;
      const wall = d >= rad - 0.75;
      for (let y = base; y <= base + th; y++) {
        if (wall) {
          if (hash3(gx, y, gz, f.fseed) < 0.14) continue; // 崩れた欠け
          if (y > base + th - 2 && hash3(gx, y, gz, f.fseed ^ 0x9) < 0.5) continue; // 天辺は不揃い
          this.setLocal(gx, y, gz, hash3(gx, y, gz, f.fseed) < 0.3 ? B.MOSSY_STONE_BRICK : B.STONE_BRICK);
        } else {
          this.setLocal(gx, y, gz, y === base ? B.STONE_BRICK : B.AIR); // 内部は空洞＋床
        }
      }
      if (dx === 0 && dz === 0) this.setLocal(gx, base + 1, gz, B.GLOW); // 灯り
    });
  }

  stampWaterfall(f) { // 滝（切り立った岩壁を流れ落ちる水）
    const ax = f.ax, az = f.az, base = f.h;
    const Hc = 10 + (hash2(ax, az, f.fseed) * 8 | 0);
    const R = 4;
    this._each(ax, az, R, (gx, gz) => {
      const dx = gx - ax, dz = gz - az;
      if (Math.abs(dx) <= 1 && dz >= 0 && dz <= 2) { // 岩壁
        for (let y = base; y <= base + Hc; y++) this.setLocal(gx, y, gz, B.STONE);
      }
      if (dx === 0 && dz === -1) { // 前面を落ちる水
        for (let y = base + 1; y <= base + Hc; y++) this.setLocal(gx, y, gz, B.WATER);
      }
      if (Math.abs(dx) <= 2 && dz >= -3 && dz <= -1) { // 滝壺
        const g = this.gh(gx, gz);
        this.setLocal(gx, g, gz, B.WATER);
      }
    });
  }

  stampHotSpring(f) { // 温泉（浅い湯だまり＋石の縁）
    const ax = f.ax, az = f.az, base = f.h;
    const rad = 3 + (hash2(ax, az, f.fseed) * 3 | 0);
    const R = rad + 1;
    this._each(ax, az, R, (gx, gz) => {
      const dx = gx - ax, dz = gz - az, d = Math.sqrt(dx * dx + dz * dz);
      if (d > rad + 0.5) return;
      if (d <= rad - 1) { // 湯
        this.setLocal(gx, base, gz, B.WATER);
        this.setLocal(gx, base - 1, gz, B.STONE);
        this.setLocal(gx, base + 1, gz, B.AIR);
      } else { // 石の縁
        this.setLocal(gx, base, gz, hash2(gx, gz, f.fseed) < 0.4 ? B.MOSSY_STONE_BRICK : B.STONE);
      }
    });
  }

  stampIsland(f) { // 海の離島（砂浜＋ヤシ）
    const ax = f.ax, az = f.az, sea = this.world.terrain.sea;
    const rad = 5 + (hash2(ax, az, f.fseed) * 4 | 0);
    const top = sea + 2 + (hash2(ax, az, f.fseed ^ 0x1) * 4 | 0);
    const R = rad + 1;
    this._each(ax, az, R, (gx, gz) => {
      const dx = gx - ax, dz = gz - az, d = Math.sqrt(dx * dx + dz * dz);
      if (d > rad) return;
      const th = Math.round(top - (d / rad) * (top - sea));
      for (let y = sea - 3; y <= th; y++) this.setLocal(gx, y, gz, y >= th - 1 ? B.SAND : B.STONE);
      if (dx === 0 && dz === 0) this.drawTree(gx, th, gz, 'palm');
    });
  }

  /* ========== Phase3: 都市生成（Procedural City） ==========
   * ランドマークと同じ決定的セル方式（cityCell）。まず整地→道路グリッド→広場→
   * 建物の順に、このチャンクに重なる範囲だけを列単位で判定して書き込む。 */
  _cityPalette(type) {
    switch (type) {
      case 'stone':      return { wall: B.STONE_BRICK, wallAlt: B.MOSSY_STONE_BRICK, floor: B.STONE_BRICK, road: B.COBBLE, roof: B.BRICK, wallHeight: [5, 8] };
      case 'harbor':     return { wall: B.PLANKS, wallAlt: B.COBBLE, floor: B.PLANKS, road: B.GRAVEL, roof: B.PLANKS, wallHeight: [4, 6] };
      case 'mountain':   return { wall: B.STONE_BRICK, wallAlt: B.STONE, floor: B.STONE, road: B.STONE, roof: B.STONE_BRICK, wallHeight: [5, 7] };
      case 'island':     return { wall: B.QUARTZ_BLOCK, wallAlt: B.SAND, floor: B.SAND, road: B.QUARTZ_BLOCK, roof: B.QUARTZ_BLOCK, wallHeight: [4, 6] };
      case 'snow':       return { wall: B.PLANKS, wallAlt: B.STONE_BRICK, floor: B.SNOW, road: B.STONE, roof: B.SNOW, wallHeight: [4, 6] };
      case 'volcano':    return { wall: B.NETHER_BRICK, wallAlt: B.STONE_BRICK, floor: B.STONE_BRICK, road: B.STONE, roof: B.NETHER_BRICK, wallHeight: [5, 8] };
      case 'giant_tree': return { wall: B.PLANKS, wallAlt: B.WOOD, floor: B.PLANKS, road: B.DIRT, roof: B.PLANKS, wallHeight: [3, 5] };
      default:           return { wall: B.PLANKS, wallAlt: B.WOOD, floor: B.PLANKS, road: B.DIRT, roof: B.PLANKS, wallHeight: [3, 5] }; // forest
    }
  }
  stampCity(f) {
    const w = this.world, gen = w.gen, sea = w.terrain.sea;
    const pal = this._cityPalette(f.type);
    const organic = f.type === 'forest' || f.type === 'giant_tree';
    const enclosed = f.type === 'stone' || f.type === 'mountain' || f.type === 'volcano' || f.type === 'snow';
    const BS = organic ? 10 : 14;     // 街区の一辺
    const RW = organic ? 2 : 3;       // 道幅
    const plazaR = organic ? 7 : 10;  // 中央広場の半径
    const wallBand = enclosed ? 14 : 0;
    const coreR = f.R - wallBand - 6; // 道路・建物を置く実効半径
    this._each(f.ax, f.az, f.R, (gx, gz) => {
      const dx = gx - f.ax, dz = gz - f.az, d = Math.sqrt(dx * dx + dz * dz);
      if (d > f.R) return;
      const c = gen.column(gx, gz);
      const t = smooth01(clamp01((f.R - d) / 16)); // 1=都市中心 0=元の地形
      let groundH = Math.round(c.h + (f.base - c.h) * t);
      groundH = Math.max(sea - 6, Math.min(122, groundH));
      const core = d <= coreR;
      // 整地: 地下は鉱石抽選、表層は都市中心なら舗装、外周は自然の地表へ自然に溶かす
      for (let y = 1; y < groundH - 3; y++) this.setLocal(gx, y, gz, w.pickUnderground(gx, y, gz));
      for (let y = Math.max(1, groundH - 3); y < groundH; y++) this.setLocal(gx, y, gz, core ? B.STONE : c.sub);
      this.setLocal(gx, groundH, gz, core ? pal.floor : c.surf);
      for (let y = groundH + 1; y <= f.base + 30; y++) this.setLocal(gx, y, gz, B.AIR); // 旧地形・木を除去
      if (groundH < sea) for (let y = groundH + 1; y <= sea; y++) this.setLocal(gx, y, gz, B.WATER);

      const mxp = ((dx % BS) + BS) % BS, mzp = ((dz % BS) + BS) % BS;
      const isRoad = mxp < RW || mzp < RW;
      // 城壁: coreR のすぐ外側。道路が通る位置には門を開ける
      if (enclosed && d > coreR - 1 && d < coreR + 3 && !isRoad) {
        const wh = 5;
        for (let y = groundH + 1; y <= groundH + wh; y++)
          this.setLocal(gx, y, gz, hash3(gx, y, gz, f.fseed ^ 0x77) < 0.25 ? pal.wallAlt : pal.wall);
        if (f.type === 'volcano' && d > coreR + 1) this.setLocal(gx, groundH, gz, B.LAVA);
      }
      if (f.type === 'island' && d > coreR) this.setLocal(gx, groundH, gz, B.SAND); // 浜辺
      if (!core) return;

      const isPlaza = d <= plazaR;
      if (isPlaza) {
        if (f.type === 'giant_tree') { // 広場中央に巨木のランドマークを兼ねる
          const trunk = Math.abs(dx) <= 1 && Math.abs(dz) <= 1;
          const topY = f.base + 24;
          if (trunk) for (let y = groundH + 1; y <= topY; y++) this.setLocal(gx, y, gz, B.WOOD);
          const cr = plazaR - 1;
          for (let y = topY - cr; y <= topY + cr - 2; y++) {
            const dy = (y - topY) * 1.1;
            if (dx * dx + dz * dz + dy * dy <= cr * cr) this.setLocalIfEmpty(gx, y, gz, B.LEAVES);
          }
        } else {
          if (d < 2.5) { this.setLocal(gx, groundH, gz, B.WATER); this.setLocal(gx, groundH - 1, gz, B.STONE); } // 噴水
          const lampR = Math.round(plazaR * 0.7);
          if ((Math.abs(dx) === lampR && dz === 0) || (Math.abs(dz) === lampR && dx === 0))
            this.setLocal(gx, groundH + 1, gz, B.GLOW);
        }
        return;
      }
      if (isRoad) { this.setLocal(gx, groundH, gz, pal.road); return; }

      // プロット（建物・市場・庭）
      const px = Math.floor(dx / BS), pz = Math.floor(dz / BS);
      const hb = hash2(px, pz, f.fseed ^ 0x9001);
      const plotCx = px * BS + BS / 2, plotCz = pz * BS + BS / 2;
      const plotDist = Math.sqrt(plotCx * plotCx + plotCz * plotCz);
      const isMarketRing = plotDist < plazaR + BS * 1.6;
      const kind = hb < 0.14 ? 'garden' : (isMarketRing && hb < 0.5 ? 'market' : 'house');
      const blx = mxp - RW, blz = mzp - RW; // プロット内ローカル座標
      const avail = BS - RW - 1;
      if (kind === 'garden') {
        this.setLocal(gx, groundH, gz, f.type === 'snow' ? B.SNOW : (c.surf === B.SAND ? c.surf : B.GRASS));
        if (blx === (avail >> 1) && blz === (avail >> 1)) this.drawTree(gx, groundH, gz, c.tree !== 'none' ? c.tree : 'oak');
        return;
      }
      const hSize = hash2(px, pz, f.fseed ^ 0x9002);
      const bsz = kind === 'market' ? 5 : (6 + (hSize * Math.max(1, avail - 6) | 0));
      const offset = Math.max(0, (avail - bsz) >> 1);
      if (blx < offset || blx >= offset + bsz || blz < offset || blz >= offset + bsz) {
        this.setLocal(gx, groundH, gz, pal.floor); // プロット内・建物の周りの余白
        return;
      }
      const bfx0 = offset, bfx1 = offset + bsz - 1, bfz0 = offset, bfz1 = offset + bsz - 1;
      const perim = blx === bfx0 || blx === bfx1 || blz === bfz0 || blz === bfz1;
      const doorSide = hash2(px, pz, f.fseed ^ 0x9003) < 0.5 ? 'x' : 'z';
      const doorPos = Math.floor((bfx0 + bfx1) / 2);
      const isDoor = perim && ((doorSide === 'x' && blz === bfz0 && blx === doorPos) || (doorSide === 'z' && blx === bfx0 && blz === doorPos));
      if (kind === 'market') {
        const wh = 2;
        const openSide = perim && ((doorSide === 'x' && blz === bfz1) || (doorSide === 'z' && blx === bfx1));
        for (let y = groundH + 1; y <= groundH + wh; y++)
          this.setLocal(gx, y, gz, (perim && !openSide) ? pal.wallAlt : B.AIR);
        if (blx === bfx0 + (bsz >> 1) && blz === bfz0 + (bsz >> 1)) this.setLocal(gx, groundH + 1, gz, B.HAY_BALE);
        if (perim) this.setLocal(gx, groundH + wh + 1, gz, pal.roof);
        return;
      }
      // 住宅
      const wallH = pal.wallHeight[0] + (hash2(px, pz, f.fseed ^ 0x9004) * (pal.wallHeight[1] - pal.wallHeight[0]) | 0);
      if (perim) {
        const midSpan = (blx === doorPos && (blz === bfz0 || blz === bfz1)) || (blz === doorPos && (blx === bfx0 || blx === bfx1));
        for (let y = groundH + 1; y <= groundH + wallH; y++) {
          if (isDoor && y <= groundH + 2) { this.setLocal(gx, y, gz, B.AIR); continue; }
          const isWindowRow = y === groundH + Math.max(2, wallH - 2);
          const mat = hash3(gx, y, gz, f.fseed) < 0.22 ? pal.wallAlt : pal.wall;
          this.setLocal(gx, y, gz, (isWindowRow && midSpan && !isDoor) ? B.GLASS : mat);
        }
      } else {
        for (let y = groundH + 1; y <= groundH + wallH; y++) this.setLocal(gx, y, gz, B.AIR);
      }
      // 段々ピラミッドの屋根
      const distToEdge = Math.min(blx - bfx0, bfx1 - blx, blz - bfz0, bfz1 - blz);
      const maxLayer = Math.min(3, bsz >> 1);
      if (distToEdge <= maxLayer) this.setLocal(gx, groundH + wallH + 1 + distToEdge, gz, pal.roof);
    });
  }

  stampUnderground(f) {
    if (f.type === 'ug_temple') return this.stampTemple(f);
    // ug_lake / ug_cavern: 楕円空洞。lake は下半分を水にする
    const ax = f.ax, az = f.az, ay = f.ay, lake = f.type === 'ug_lake';
    const rx = (lake ? 7 : 9) + (hash2(ax, az, f.fseed) * 4 | 0);
    const ry = 4 + (hash2(ax, az, f.fseed ^ 0x2) * 3 | 0);
    const R = rx + 1;
    this._each(ax, az, R, (gx, gz) => {
      const dx = gx - ax, dz = gz - az;
      for (let y = ay - ry; y <= ay + ry; y++) {
        const dy = (y - ay) / ry, dd = (dx * dx + dz * dz) / (rx * rx) + dy * dy;
        if (dd > 1) continue;
        if (lake && y <= ay) this.setLocal(gx, y, gz, B.WATER);
        else this.setLocal(gx, y, gz, B.AIR);
      }
      if (lake && dx === 0 && dz === 0) this.setLocal(gx, ay - ry, gz, B.GLOW);
    });
  }

  stampTemple(f) { // 地下神殿（石レンガの部屋＋灯り＋宝）
    const ax = f.ax, az = f.az, ay = f.ay;
    const hw = 4, H = 5, R = hw + 1;
    this._each(ax, az, R, (gx, gz) => {
      const dx = gx - ax, dz = gz - az;
      if (Math.abs(dx) > hw || Math.abs(dz) > hw) return;
      const edge = Math.abs(dx) === hw || Math.abs(dz) === hw;
      for (let y = ay; y <= ay + H; y++) {
        const shell = edge || y === ay || y === ay + H;
        if (shell) this.setLocal(gx, y, gz, hash3(gx, y, gz, f.fseed) < 0.3 ? B.MOSSY_STONE_BRICK : B.STONE_BRICK);
        else this.setLocal(gx, y, gz, B.AIR);
      }
      if ((Math.abs(dx) === hw - 1) && (Math.abs(dz) === hw - 1)) this.setLocal(gx, ay + H - 1, gz, B.GLOW); // 四隅の灯り
      if (dx === 0 && dz === 0) { this.setLocal(gx, ay + 1, gz, B.GOLD_BLOCK); this.setLocal(gx, ay + 2, gz, B.DIAMOND_BLOCK); } // 宝
    });
  }
  // ネザー地形: 溶岩の海・天井・グロウストーン
  generateNether() {
    const d = new Uint8Array(16 * 16 * CFG.HEIGHT);
    const w = this.world, n = w.noise, x0 = this.cx * 16, z0 = this.cz * 16;
    const t = w.terrain; // {lavaLevel, wallChance, glowChance, oreChance}
    const LAVA_LV = t.lavaLevel;
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const gx = x0 + lx, gz = z0 + lz, col = lx + (lz << 4);
      const f1 = n.fbm(gx * 0.012 + 55.5, gz * 0.012 - 77.7, 3) * 2.2;
      const f2 = n.fbm(gx * 0.015 - 333.3, gz * 0.015 + 111.1, 3) * 2.2;
      const wall = n.fbm(gx * 0.02 + 901.1, gz * 0.02 - 455.5, 3) * 2.2;
      let floor = Math.max(5, Math.min(60, (30 + f1 * 12) | 0));
      let ceil = Math.max(floor + 6, Math.min(118, (92 - f2 * 12) | 0));
      d[col] = B.BEDROCK;
      d[col + (127 << 8)] = B.BEDROCK;
      if (wall > t.wallChance) { // 岩壁地帯
        for (let y = 1; y < 127; y++) d[col + (y << 8)] = B.NETHERRACK;
      } else {
        for (let y = 1; y <= floor; y++)
          d[col + (y << 8)] = (hash3(gx, y, gz, w.seed) < t.oreChance) ? B.GRAVEL : B.NETHERRACK;
        for (let y = floor + 1; y <= Math.min(LAVA_LV, ceil - 1); y++)
          d[col + (y << 8)] = B.LAVA;
        for (let y = ceil; y < 127; y++) d[col + (y << 8)] = B.NETHERRACK;
        // 天井のグロウストーン
        const gh = hash2(gx, gz, w.seed ^ 0x910);
        if (gh < t.glowChance) d[col + (ceil << 8)] = B.GLOW;
        if (gh < t.glowChance * 0.27 && ceil - 1 > floor + 2) d[col + ((ceil - 1) << 8)] = B.GLOW;
      }
    }
    const fort = this.fortressInfo();
    if (fort) this.drawFortress(d, fort);
    this.data = d;
    this.applyEdits();
  }
  // ネザー要塞: 64x64ブロックのセルごとに確率で1つ配置を決める（決定的・チャンク非依存）
  // セル内に収まる大きさに制限しているので、このチャンクが属するセルだけ調べれば良い
  // （木の配置と同じ考え方: 各チャンクは自分の担当範囲だけ書き込む）
  fortressInfo() {
    const w = this.world, seed = w.seed;
    if (w.terrain.fortressEnabled === false) return null; // world.json で明示的にoffも可能
    const CELL = 64;
    const cellX = Math.floor((this.cx * 16) / CELL), cellZ = Math.floor((this.cz * 16) / CELL);
    const r = hash2(cellX, cellZ, seed ^ 0xf057);
    const chance = w.terrain.fortressChance != null ? w.terrain.fortressChance : 0.35;
    if (r >= chance) return null;
    const ox = cellX * CELL + 16 + ((hash2(cellX, cellZ, seed ^ 0xf058) * 16) | 0);
    const oz = cellZ * CELL + 16 + ((hash2(cellX, cellZ, seed ^ 0xf059) * 16) | 0);
    const horiz = hash2(cellX, cellZ, seed ^ 0xf05a) < 0.5;
    const len = 16 + ((hash2(cellX, cellZ, seed ^ 0xf05b) * 10) | 0); // 16-25
    const baseY = 38 + ((hash2(cellX, cellZ, seed ^ 0xf05c) * 12) | 0); // 38-49（溶岩面より上）
    return { ox, oz, horiz, len, baseY };
  }
  // ネザーレンガの橋状通路（手すり・狭間・支柱つき）をこのチャンクの担当分だけ描画
  drawFortress(d, f) {
    const { ox, oz, horiz, len, baseY } = f;
    for (let i = 0; i < len; i++) {
      const gx = horiz ? ox + i : ox;
      const gz = horiz ? oz : oz + i;
      if ((gx >> 4) !== this.cx || (gz >> 4) !== this.cz) continue; // 自チャンク外は担当しない
      const lx = gx & 15, lz = gz & 15;
      for (let s = -2; s <= 2; s++) {
        const fx = horiz ? lx : lx + s;
        const fz = horiz ? lz + s : lz;
        if (fx < 0 || fx > 15 || fz < 0 || fz > 15) continue;
        const col = fx + (fz << 4);
        d[col + (baseY << 8)] = B.NETHER_BRICK; // 床
        for (let cy = baseY + 1; cy <= baseY + 4; cy++) d[col + (cy << 8)] = B.AIR; // 通路の空洞
        if (Math.abs(s) === 2) { // 手すり＋狭間(凹凸)模様
          d[col + ((baseY + 1) << 8)] = B.NETHER_BRICK;
          if (i % 3 !== 0) d[col + ((baseY + 2) << 8)] = B.NETHER_BRICK;
        }
      }
      if (i % 6 === 0) { // 支柱（下の溶岩・岩盤地帯まで伸ばす）
        const col = lx + (lz << 4);
        for (let py = baseY - 1; py > 4; py--) {
          const cur = d[col + (py << 8)];
          if (cur === B.NETHERRACK || cur === B.LAVA || cur === B.AIR) d[col + (py << 8)] = B.NETHER_BRICK;
          else break;
        }
      }
    }
  }
  // ジ・エンド地形: 浮遊島と黒曜石の柱
  generateEnd() {
    const d = new Uint8Array(16 * 16 * CFG.HEIGHT);
    const w = this.world, n = w.noise, x0 = this.cx * 16, z0 = this.cz * 16;
    const t = w.terrain; // {islandRadius, pillarCount}
    const R = t.islandRadius, PC = t.pillarCount;
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const gx = x0 + lx, gz = z0 + lz, col = lx + (lz << 4);
      const dx = gx - 256, dz = gz - 256;
      const r = Math.sqrt(dx * dx + dz * dz);
      if (r >= R) continue; // 島の外は奈落
      const tk = 1 - (r / R) * (r / R);
      const nz = n.fbm(gx * 0.02 + 11.1, gz * 0.02 + 22.2, 3) * 2.2;
      const top = (58 + nz * 4 * tk + tk * 6) | 0;
      const bot = (58 - 26 * tk + nz * 3) | 0;
      if (top <= bot) continue;
      for (let y = Math.max(1, bot); y <= Math.min(120, top); y++)
        d[col + (y << 8)] = B.ENDSTONE;
      // 黒曜石の柱（頂上にグロウストーン）
      for (let k = 0; k < PC; k++) {
        const a = k * Math.PI * 2 / PC;
        const px = 256 + Math.cos(a) * 32, pz = 256 + Math.sin(a) * 32;
        const ddx = gx - px, ddz = gz - pz;
        if (ddx * ddx + ddz * ddz <= 6.25) {
          const ph = 70 + k * 3;
          for (let y = top; y < ph; y++) d[col + (y << 8)] = B.OBSIDIAN;
          d[col + (ph << 8)] = B.GLOW;
        }
      }
    }
    this.data = d;
    this.applyEdits();
  }
  // 森林などに木を配置（チャンク境界をまたぐ木も考慮）
  plantTrees() {
    const w = this.world, x0 = this.cx * 16, z0 = this.cz * 16;
    if (!w.plantsEnabled) return;
    const td = w.terrain.treeDensity;
    for (let gz = z0 - 2; gz < z0 + 18; gz++) for (let gx = x0 - 2; gx < x0 + 18; gx++) {
      if (gx < 0 || gz < 0 || gx >= CFG.WORLD_SIZE || gz >= CFG.WORLD_SIZE) continue;
      const r = hash2(gx, gz, w.seed ^ 0x7ee5);
      if (r >= 0.06) continue; // まず粗くふるい落とす
      w.columnInto(gx, gz);
      const h = w.colH, biome = w.colB;
      let dens = 0;
      if (biome === BIOME.FOREST) dens = td.forest;
      else if (biome === BIOME.PLAINS) dens = td.plains;
      else if (biome === BIOME.SNOW) dens = td.snow;
      else if (biome === BIOME.MOUNTAIN) dens = td.mountain;
      if (r >= dens) continue;
      if (h <= w.terrain.sea + 1 || h > CFG.HEIGHT - 12) continue;
      const th = 4 + ((hash2(gx, gz, w.seed ^ 0x51ab) * 3) | 0); // 幹の高さ 4-6
      for (let y = h + 1; y <= h + th; y++) this.setLocal(gx, y, gz, B.WOOD);
      for (let ly = h + th - 2; ly <= h + th + 1; ly++) {
        const rad = ly >= h + th ? 1 : 2;
        for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
          if (dx === 0 && dz === 0 && ly <= h + th) continue; // 幹の位置
          if (Math.abs(dx) === rad && Math.abs(dz) === rad &&
              hash3(gx + dx, ly, gz + dz, w.seed) < 0.5) continue; // 角を欠けさせる
          this.setLocalIfEmpty(gx + dx, ly, gz + dz, B.LEAVES);
        }
      }
    }
  }
  setLocal(gx, y, gz, id) {
    if ((gx >> 4) !== this.cx || (gz >> 4) !== this.cz || y < 0 || y >= CFG.HEIGHT) return;
    this.data[(gx & 15) + ((gz & 15) << 4) + (y << 8)] = id;
  }
  setLocalIfEmpty(gx, y, gz, id) {
    if ((gx >> 4) !== this.cx || (gz >> 4) !== this.cz || y < 0 || y >= CFG.HEIGHT) return;
    const i = (gx & 15) + ((gz & 15) << 4) + (y << 8);
    if (this.data[i] === B.AIR) this.data[i] = id;
  }
  applyEdits() {
    const m = this.world.edits.get(this.world.key(this.cx, this.cz));
    if (!m) return;
    for (const [i, id] of m) this.data[i] = id;
  }
  buildMesh() {
    this.disposeMeshes();
    const w = this.world, d = this.data, x0 = this.cx * 16, z0 = this.cz * 16;
    const A = { pos: [], nor: [], col: [], uv: [], idx: [] }; // 不透明
    const T = { pos: [], nor: [], col: [], uv: [], idx: [] }; // 半透明
    for (let y = 0; y < CFG.HEIGHT; y++) {
      const yo = y << 8;
      for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
        const id = d[lx + (lz << 4) + yo];
        if (id === B.AIR) continue;
        const def = BLOCK_DEFS[id];
        const bkt = def.translucent ? T : A;
        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nx = lx + face.d[0], ny = y + face.d[1], nz = lz + face.d[2];
          let nid;
          if (nx >= 0 && nx < 16 && nz >= 0 && nz < 16) {
            nid = ny < 0 ? B.BEDROCK : ny >= CFG.HEIGHT ? B.AIR : d[nx + (nz << 4) + (ny << 8)];
          } else {
            nid = w.getBlock(x0 + nx, ny, z0 + nz);
          }
          if (nid === id) continue;
          if (nid !== B.AIR && !BLOCK_DEFS[nid].transparent) continue;
          const tile = f === 3 ? def.tiles[0] : f === 2 ? def.tiles[1] : def.tiles[2];
          const tx = tile % w.atlasCols, ty = (tile / w.atlasCols) | 0;
          const base = bkt.pos.length / 3, sh = face.s;
          // バイオーム色ティント（オープンワールドのみ／草・葉・水）。気候から連続補間
          // されているので境界が自然につながる。
          let cr = sh, cg = sh, cb = sh;
          if (w.gen && (id === B.GRASS || id === B.LEAVES || id === B.WATER)) {
            const cc = w.gen.column(x0 + lx, z0 + lz);
            const tnt = id === B.LEAVES ? cc.tintL : (id === B.WATER ? cc.tintW : cc.tintG);
            cr = sh * tnt[0]; cg = sh * tnt[1]; cb = sh * tnt[2];
          }
          for (let ci = 0; ci < 4; ci++) {
            const c = face.c[ci];
            let py = y + c[1];
            if (def.liquid && f === 3 && c[1] === 1) py -= 0.12;
            bkt.pos.push(x0 + lx + c[0], py, z0 + lz + c[2]);
            bkt.nor.push(face.d[0], face.d[1], face.d[2]);
            bkt.col.push(cr, cg, cb);
            bkt.uv.push((tx + c[3]) / w.atlasCols, 1 - (ty + 1 - c[4]) / w.atlasRows);
          }
          bkt.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
        }
      }
    }
    this.solidMesh = this.makeMesh(A, w.matSolid, true);
    this.alphaMesh = this.makeMesh(T, w.matAlpha, false);
    if (this.solidMesh) w.scene.add(this.solidMesh);
    if (this.alphaMesh) w.scene.add(this.alphaMesh);
    this.meshed = true;
    w.meshCount++;
  }
  makeMesh(b, mat, shadow) {
    if (b.idx.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    g.setIndex(b.idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.matrixAutoUpdate = false;
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    return m;
  }
  disposeMeshes() {
    if (this.solidMesh) {
      this.world.scene.remove(this.solidMesh);
      this.solidMesh.geometry.dispose();
      this.solidMesh = null;
    }
    if (this.alphaMesh) {
      this.world.scene.remove(this.alphaMesh);
      this.alphaMesh.geometry.dispose();
      this.alphaMesh = null;
    }
    if (this.meshed) { this.meshed = false; this.world.meshCount--; }
  }
}

export class World {
  // terrainCfg: 次元に応じた地形設定（overworld/nether/end のいずれか）
  constructor(seed, group, matSolid, matAlpha, dim, terrainCfg, opts) {
    this.seed = seed;
    this.dim = dim || DIM.OVER;
    this.scene = group;
    this.group = group;
    this.matSolid = matSolid;
    this.matAlpha = matAlpha;
    this.terrain = terrainCfg;
    this.atlasCols = (opts && opts.atlasCols) || ATLAS_COLS;
    this.atlasRows = (opts && opts.atlasRows) || ATLAS_ROWS;
    this.plantsEnabled = !opts || opts.plantsEnabled !== false;
    this.oreDefs = (opts && opts.oreDefs) || [];
    // 巨大オープンワールド生成エンジン（world.json で engine:"openworld" のときだけ注入される）。
    // null のときは従来の生成パスがそのまま使われる。
    this.gen = (opts && opts.gen) || null;
    this.noise = new Noise(seed);
    this.chunks = new Map();
    this.edits = new Map();
    this.dirty = new Set();
    // 従来パスの列キャッシュ（512世界前提の平坦配列）。巨大世界では gen 側が
    // 独自にキャッシュするので確保しない（8192²=64MBの確保を避ける）。
    if (!this.gen) {
      this.heightCache = new Uint8Array(CFG.WORLD_SIZE * CFG.WORLD_SIZE);
      this.biomeCache = new Uint8Array(CFG.WORLD_SIZE * CFG.WORLD_SIZE);
    }
    this.col = null; // gen パスの現在列情報
    this.meshCount = 0;
    this.saveDirty = false;
    this.frame = 0;
    this.colH = 0; this.colB = 0;
    this.offsets = buildOffsets();
  }
  key(cx, cz) { return cx + cz * CFG.CHUNKS; }

  // 描画範囲（CFG.RENDER_DIST）変更時に呼び直し、生成/メッシュ済み範囲を再計算する
  rebuildOffsets() { this.offsets = buildOffsets(); }

  // 地下ブロック抽選（鉱石 -> なければ石）。ore設定は worlds/*.json の "ores" 配列。
  pickUnderground(gx, y, gz) {
    for (let i = 0; i < this.oreDefs.length; i++) {
      const o = this.oreDefs[i];
      if (y < o.minY || y > o.maxY) continue;
      const salt = this.seed ^ (0x9e3779b9 * (i + 1) | 0);
      if (hash3(gx, y, gz, salt) < o.chance) return o.blockId;
    }
    return B.STONE;
  }

  columnInto(x, z) {
    if (this.gen) { // 巨大オープンワールド: 生成エンジンに委譲
      const c = this.gen.column(x, z);
      this.col = c; this.colH = c.h; this.colB = c.biome;
      return;
    }
    const i = x + (z << 9);
    if (this.heightCache[i] === 0) {
      const n = this.noise;
      const c = n.fbm(x * 0.0032, z * 0.0032, 4) * 2.4;
      const m = n.fbm(x * 0.006 + 337.7, z * 0.006 - 118.2, 4) * 2.8;
      const dtl = n.fbm(x * 0.025 - 74.1, z * 0.025 + 201.4, 2);
      let h = 36 + c * 22 + dtl * 4;
      const mm = Math.max(0, m - 0.35);
      h += mm * mm * 170;
      h = Math.max(3, Math.min(122, h)) | 0;
      const temp = n.fbm(x * 0.0022 + 513.3, z * 0.0022 + 77.7, 2) * 3;
      const wet = n.fbm(x * 0.0023 - 311.1, z * 0.0023 + 941.2, 2) * 2.5;
      const bt = this.terrain.biomeThresholds;
      let biome = BIOME.PLAINS;
      if (h >= this.terrain.snowLine || temp < -0.55) biome = BIOME.SNOW;
      else if (temp > bt.desertTemp && wet < bt.desertWet && h <= this.terrain.sea + 22) biome = BIOME.DESERT;
      else if (wet > bt.forestWet) biome = BIOME.FOREST;
      if (h >= bt.mountainHeight && biome !== BIOME.SNOW && mm > 0.12) biome = BIOME.MOUNTAIN;
      this.heightCache[i] = h;
      this.biomeCache[i] = biome;
    }
    this.colH = this.heightCache[i];
    this.colB = this.biomeCache[i];
  }

  getBlock(x, y, z) {
    const OUT = this.dim === DIM.END ? B.AIR : B.BEDROCK;
    if (y < 0) return OUT;
    if (y >= CFG.HEIGHT) return B.AIR;
    if (x < 0 || z < 0 || x >= CFG.WORLD_SIZE || z >= CFG.WORLD_SIZE) return OUT;
    const ch = this.chunks.get(this.key(x >> 4, z >> 4));
    if (!ch || !ch.data) return OUT;
    return ch.data[(x & 15) + ((z & 15) << 4) + (y << 8)];
  }

  setBlock(x, y, z, id) {
    if (x < 0 || z < 0 || x >= CFG.WORLD_SIZE || z >= CFG.WORLD_SIZE || y < 0 || y >= CFG.HEIGHT) return;
    const cx = x >> 4, cz = z >> 4;
    const ch = this.ensureData(cx, cz);
    if (!ch) return;
    const li = (x & 15) + ((z & 15) << 4) + (y << 8);
    if (ch.data[li] === id) return;
    ch.data[li] = id;
    const k = this.key(cx, cz);
    let m = this.edits.get(k);
    if (!m) { m = new Map(); this.edits.set(k, m); }
    m.set(li, id);
    this.saveDirty = true;
    this.dirty.add(ch);
    const lx = x & 15, lz = z & 15;
    if (lx === 0) this.addDirty(cx - 1, cz);
    if (lx === 15) this.addDirty(cx + 1, cz);
    if (lz === 0) this.addDirty(cx, cz - 1);
    if (lz === 15) this.addDirty(cx, cz + 1);
  }
  addDirty(cx, cz) {
    const ch = this.chunks.get(this.key(cx, cz));
    if (ch && ch.meshed) this.dirty.add(ch);
  }

  ensureData(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= CFG.CHUNKS || cz >= CFG.CHUNKS) return null;
    const k = this.key(cx, cz);
    let ch = this.chunks.get(k);
    if (!ch) { ch = new Chunk(this, cx, cz); this.chunks.set(k, ch); }
    if (!ch.data) {
      ch.generate();
      this.addDirty(cx - 1, cz); this.addDirty(cx + 1, cz);
      this.addDirty(cx, cz - 1); this.addDirty(cx, cz + 1);
    }
    return ch;
  }
  meshChunk(ch) { ch.buildMesh(); }

  updateChunks(px, pz) {
    const pcx = Math.floor(px / 16), pcz = Math.floor(pz / 16);
    let gen = CFG.GEN_PER_FRAME, mesh = CFG.MESH_PER_FRAME;

    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++)
      this.ensureData(pcx + dx, pcz + dz);

    if (this.dirty.size) {
      let n = 0;
      for (const ch of this.dirty) {
        this.dirty.delete(ch);
        if (ch.data) { this.meshChunk(ch); if (++n >= CFG.REMESH_PER_FRAME) break; }
      }
    }

    const OFFSETS = this.offsets;
    for (let oi = 0; oi < OFFSETS.length; oi++) {
      if (gen <= 0 && mesh <= 0) break;
      const cx = pcx + OFFSETS[oi][0], cz = pcz + OFFSETS[oi][1];
      if (cx < 0 || cz < 0 || cx >= CFG.CHUNKS || cz >= CFG.CHUNKS) continue;
      const ch = this.chunks.get(this.key(cx, cz));
      if (!ch || !ch.data) {
        if (gen > 0) { this.ensureData(cx, cz); gen--; }
        continue;
      }
      if (ch.meshed) continue;
      let ok = true;
      for (let ni = 0; ni < 4; ni++) {
        const nx = cx + NB4[ni][0], nz = cz + NB4[ni][1];
        if (nx < 0 || nz < 0 || nx >= CFG.CHUNKS || nz >= CFG.CHUNKS) continue;
        if (Math.abs(nx - pcx) > CFG.RENDER_DIST || Math.abs(nz - pcz) > CFG.RENDER_DIST) continue;
        const nc = this.chunks.get(this.key(nx, nz));
        if (!nc || !nc.data) {
          if (gen > 0) { this.ensureData(nx, nz); gen--; }
          else ok = false;
        }
      }
      if (ok && mesh > 0) { this.meshChunk(ch); mesh--; }
    }

    this.frame = (this.frame + 1) & 31;
    if (this.frame === 0) {
      for (const ch of this.chunks.values()) {
        if (ch.meshed &&
            (Math.abs(ch.cx - pcx) > CFG.RENDER_DIST + 1 ||
             Math.abs(ch.cz - pcz) > CFG.RENDER_DIST + 1)) {
          ch.disposeMeshes();
        }
      }
    }
  }

  raycast(o, dir, maxDist, out) {
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const sx = dir.x > 0 ? 1 : -1, sy = dir.y > 0 ? 1 : -1, sz = dir.z > 0 ? 1 : -1;
    const dx = Math.abs(dir.x) > 1e-9 ? Math.abs(1 / dir.x) : Infinity;
    const dy = Math.abs(dir.y) > 1e-9 ? Math.abs(1 / dir.y) : Infinity;
    const dz = Math.abs(dir.z) > 1e-9 ? Math.abs(1 / dir.z) : Infinity;
    let tx = dx === Infinity ? Infinity : (sx > 0 ? (x + 1 - o.x) : (o.x - x)) * dx;
    let ty = dy === Infinity ? Infinity : (sy > 0 ? (y + 1 - o.y) : (o.y - y)) * dy;
    let tz = dz === Infinity ? Infinity : (sz > 0 ? (z + 1 - o.z) : (o.z - z)) * dz;
    let nx = 0, ny = 0, nz = 0, t = 0;
    while (t <= maxDist) {
      if (nx || ny || nz) {
        const id = this.getBlock(x, y, z);
        if (id !== B.AIR && !BLOCK_DEFS[id].liquid) {
          out.x = x; out.y = y; out.z = z;
          out.nx = nx; out.ny = ny; out.nz = nz;
          return true;
        }
      }
      if (tx <= ty && tx <= tz) { x += sx; t = tx; tx += dx; nx = -sx; ny = 0; nz = 0; }
      else if (ty <= tz)        { y += sy; t = ty; ty += dy; ny = -sy; nx = 0; nz = 0; }
      else                      { z += sz; t = tz; tz += dz; nz = -sz; nx = 0; ny = 0; }
    }
    return false;
  }

  lightNetherPortal(x, y, z) {
    if (this.getBlock(x, y, z) !== B.AIR) return false;
    return this.lightAxis(x, y, z, 1, 0) || this.lightAxis(x, y, z, 0, 1);
  }
  lightAxis(x, y, z, dx, dz) {
    const g = (a, b, c) => this.getBlock(a, b, c);
    let by = y, n = 0;
    while (by > 1 && g(x, by - 1, z) === B.AIR && n++ < 30) by--;
    if (g(x, by - 1, z) !== B.OBSIDIAN) return false;
    let bx = x, bz = z; n = 0;
    while (n++ < 30 && g(bx - dx, by, bz - dz) === B.AIR) { bx -= dx; bz -= dz; }
    if (g(bx - dx, by, bz - dz) !== B.OBSIDIAN) return false;
    let wLen = 0;
    while (wLen < 9 && g(bx + dx * wLen, by, bz + dz * wLen) === B.AIR) wLen++;
    if (wLen < 2 || wLen > 8) return false;
    if (g(bx + dx * wLen, by, bz + dz * wLen) !== B.OBSIDIAN) return false;
    let hLen = 0;
    while (hLen < 9 && g(bx, by + hLen, bz) === B.AIR) hLen++;
    if (hLen < 3 || hLen > 8) return false;
    for (let i = 0; i < wLen; i++) {
      if (g(bx + dx * i, by - 1, bz + dz * i) !== B.OBSIDIAN) return false;
      if (g(bx + dx * i, by + hLen, bz + dz * i) !== B.OBSIDIAN) return false;
      for (let j = 0; j < hLen; j++)
        if (g(bx + dx * i, by + j, bz + dz * i) !== B.AIR) return false;
    }
    for (let j = 0; j < hLen; j++) {
      if (g(bx - dx, by + j, bz - dz) !== B.OBSIDIAN) return false;
      if (g(bx + dx * wLen, by + j, bz + dz * wLen) !== B.OBSIDIAN) return false;
    }
    for (let i = 0; i < wLen; i++) for (let j = 0; j < hLen; j++)
      this.setBlock(bx + dx * i, by + j, bz + dz * i, B.PORTAL);
    return true;
  }

  checkEndPortal(fx, fy, fz) {
    const cands = [];
    for (let i = 0; i < 3; i++) {
      cands.push([fx - i, fz + 1], [fx - i, fz - 3], [fx + 1, fz - i], [fx - 3, fz - i]);
    }
    for (const [ix, iz] of cands) {
      let ok = true;
      for (let i = 0; i < 3 && ok; i++) {
        if (this.getBlock(ix + i, fy, iz - 1) !== B.EPF_EYE) ok = false;
        else if (this.getBlock(ix + i, fy, iz + 3) !== B.EPF_EYE) ok = false;
        else if (this.getBlock(ix - 1, fy, iz + i) !== B.EPF_EYE) ok = false;
        else if (this.getBlock(ix + 3, fy, iz + i) !== B.EPF_EYE) ok = false;
      }
      if (ok) {
        for (let dx2 = 0; dx2 < 3; dx2++) for (let dz2 = 0; dz2 < 3; dz2++)
          this.setBlock(ix + dx2, fy, iz + dz2, B.ENDPORTAL);
        return true;
      }
    }
    return false;
  }
}
