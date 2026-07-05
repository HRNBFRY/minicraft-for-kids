import { ATLAS_COLS, ATLAS_ROWS, TILE } from './constants.js';
import { mulberry32 } from './noise.js';

// ワールドごとの見た目差し替え用デフォルト色（world.json の "palette" で上書き可能）
const DEFAULT_PALETTE = {
  grass: [106, 170, 64],
  leaves: [54, 118, 38],
  stone: [125, 125, 125],
  sand: [219, 207, 163]
};

/* ---------------- TextureGenerator: Canvasで16x16テクスチャ生成 ---------------- */
export class TextureGenerator {
  constructor(seed, palette) {
    this.palette = Object.assign({}, DEFAULT_PALETTE, palette || {});
    const c = document.createElement('canvas');
    c.width = ATLAS_COLS * 16; c.height = ATLAS_ROWS * 16;
    this.canvas = c;
    this.ctx = c.getContext('2d');
    this.rand = mulberry32(seed ^ 0x9e3779b9);
    this.drawAll();
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    this.texture = tex;
  }
  // タイルt内の1ピクセル描画
  p(t, x, y, r, g, b, a = 255) {
    const px = (t % ATLAS_COLS) * 16 + x, py = ((t / ATLAS_COLS) | 0) * 16 + y;
    this.ctx.fillStyle = 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',' + (a / 255).toFixed(3) + ')';
    this.ctx.fillRect(px, py, 1, 1);
  }
  speckle(t, base, vary, alpha = 255) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const f = 1 + (this.rand() - 0.5) * vary;
      this.p(t, x, y, base[0] * f, base[1] * f, base[2] * f, alpha);
    }
  }
  grassSide(t) {
    this.speckle(t, [134, 96, 67], 0.2);
    const leaf = this.palette.grass;
    for (let x = 0; x < 16; x++) {
      const d = 3 + ((this.rand() * 2) | 0);
      for (let y = 0; y < d; y++) {
        const f = 1 + (this.rand() - 0.5) * 0.18;
        this.p(t, x, y, leaf[0] * f, leaf[1] * f, leaf[2] * f);
      }
    }
  }
  cobble(t) {
    this.speckle(t, [112, 112, 112], 0.22);
    for (let i = 0; i < 6; i++) {
      const cx = this.rand() * 16, cy = this.rand() * 16, r = 2 + this.rand() * 3;
      for (let a = 0; a < 22; a++) {
        const x = Math.round(cx + Math.cos(a / 22 * 6.283) * r);
        const y = Math.round(cy + Math.sin(a / 22 * 6.283) * r);
        if (x >= 0 && x < 16 && y >= 0 && y < 16) this.p(t, x, y, 70, 72, 74);
      }
    }
  }
  gravel(t) {
    const pal = [[126, 116, 106], [94, 88, 82], [146, 140, 132], [110, 98, 90]];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const c = pal[(this.rand() * 4) | 0];
      const f = 1 + (this.rand() - 0.5) * 0.1;
      this.p(t, x, y, c[0] * f, c[1] * f, c[2] * f);
    }
  }
  logSide(t) {
    for (let x = 0; x < 16; x++) {
      const stripe = (x % 4 === 0) ? 0.7 : (x % 4 === 2) ? 1.1 : 0.95;
      for (let y = 0; y < 16; y++) {
        const f = stripe * (1 + (this.rand() - 0.5) * 0.12);
        this.p(t, x, y, 106 * f, 80 * f, 48 * f);
      }
    }
  }
  logTop(t) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      const ring = (d > 6.5) || (d > 4 && d < 5) || (d > 1.5 && d < 2.5);
      const f = 1 + (this.rand() - 0.5) * 0.1;
      if (ring) this.p(t, x, y, 106 * f, 80 * f, 48 * f);
      else this.p(t, x, y, 170 * f, 136 * f, 84 * f);
    }
  }
  leaves(t) {
    const base = this.palette.leaves;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (this.rand() < 0.13) this.p(t, x, y, base[0] * 0.4, base[1] * 0.4, base[2] * 0.4);
      else {
        const f = 1 + (this.rand() - 0.5) * 0.25;
        this.p(t, x, y, base[0] * f, base[1] * f, base[2] * f);
      }
    }
  }
  glass(t) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (x === 0 || y === 0 || x === 15 || y === 15) this.p(t, x, y, 230, 240, 250, 255);
      else if ((x - y === 3 || x - y === 4) && x < 12) this.p(t, x, y, 255, 255, 255, 140);
      else this.p(t, x, y, 200, 228, 245, 28);
    }
  }
  water(t) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const f = 1 + (this.rand() - 0.5) * 0.15;
      if ((y === 3 || y === 9) && this.rand() < 0.5) this.p(t, x, y, 90, 150, 235, 190);
      else this.p(t, x, y, 40 * f, 92 * f, 205 * f, 190);
    }
  }
  brick(t) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const row = y >> 2;
      const mortar = (y % 4 === 3) || (((x + (row % 2) * 4) % 8) === 7);
      const f = 1 + (this.rand() - 0.5) * (mortar ? 0.08 : 0.12);
      if (mortar) this.p(t, x, y, 180 * f, 172 * f, 166 * f);
      else this.p(t, x, y, 150 * f, 64 * f, 52 * f);
    }
  }
  planks(t) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const row = y >> 2;
      const seam = (y % 4 === 3) || (x === ((row * 7 + 3) & 15));
      const f = 1 + (this.rand() - 0.5) * 0.1;
      if (seam) this.p(t, x, y, 110 * f, 84 * f, 50 * f);
      else this.p(t, x, y, 168 * f, 134 * f, 80 * f);
    }
  }
  wool(t) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      let f = 1 + (this.rand() - 0.5) * 0.07;
      if ((x + y) % 2 === 0) f *= 0.94;
      this.p(t, x, y, 235 * f, 235 * f, 235 * f);
    }
  }
  glow(t) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = this.rand();
      if (r < 0.18) this.p(t, x, y, 255, 225, 130);
      else if (r < 0.55) this.p(t, x, y, 228, 178, 66);
      else this.p(t, x, y, 158, 112, 42);
    }
  }
  ctableTop(t) {
    this.speckle(t, [178, 140, 86], 0.1);
    for (let i = 0; i < 16; i++) {
      this.p(t, i, 0, 96, 64, 36); this.p(t, i, 15, 96, 64, 36);
      this.p(t, 0, i, 96, 64, 36); this.p(t, 15, i, 96, 64, 36);
    }
    for (let i = 2; i < 14; i++) { this.p(t, i, 7, 140, 104, 60); this.p(t, 7, i, 140, 104, 60); }
  }
  ctableSide(t) {
    this.planks(t);
    const box = (x0, y0) => {
      for (let y = y0; y < y0 + 5; y++) for (let x = x0; x < x0 + 5; x++) {
        const b = (x === x0 || x === x0 + 4 || y === y0 || y === y0 + 4);
        this.p(t, x, y, b ? 84 : 150, b ? 58 : 112, b ? 34 : 66);
      }
    };
    box(2, 3); box(9, 3);
  }
  obsidianTex(t) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (this.rand() < 0.08) this.p(t, x, y, 86, 58, 130);
      else { const f = 1 + (this.rand() - 0.5) * 0.4; this.p(t, x, y, 24 * f, 18 * f, 36 * f); }
    }
  }
  netherrackTex(t) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = this.rand();
      if (r < 0.1) this.p(t, x, y, 58, 14, 14);
      else if (r < 0.16) this.p(t, x, y, 168, 66, 60);
      else { const f = 1 + (this.rand() - 0.5) * 0.3; this.p(t, x, y, 112 * f, 34 * f, 32 * f); }
    }
  }
  portalTex(t) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const s = Math.sin(x * 0.8 + y * 0.5) + Math.cos(y * 0.9 - x * 0.3) + (this.rand() - 0.5);
      if (s > 0.8) this.p(t, x, y, 196, 120, 255, 225);
      else if (s > -0.4) this.p(t, x, y, 128, 40, 208, 210);
      else this.p(t, x, y, 74, 16, 128, 195);
    }
  }
  endstoneTex(t) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (this.rand() < 0.14) this.p(t, x, y, 200, 202, 140);
      else { const f = 1 + (this.rand() - 0.5) * 0.07; this.p(t, x, y, 221 * f, 223 * f, 165 * f); }
    }
  }
  epfSide(t) {
    this.endstoneTex(t);
    for (let y = 4; y < 10; y++) for (let x = 0; x < 16; x++) {
      const b = (y === 4 || y === 9);
      this.p(t, x, y, b ? 46 : 66, b ? 70 : 104, b ? 54 : 80);
    }
  }
  epfTop(t) {
    this.endstoneTex(t);
    for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) {
      const b = (x === 3 || x === 12 || y === 3 || y === 12);
      this.p(t, x, y, b ? 46 : 30, b ? 70 : 44, b ? 54 : 36);
    }
  }
  epfTopEye(t) {
    this.epfTop(t);
    for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      if (dx * dx + dy * dy < 7) this.p(t, x, y, 61, 220, 132);
    }
    this.p(t, 7, 7, 16, 16, 16); this.p(t, 8, 7, 16, 16, 16);
    this.p(t, 7, 8, 16, 16, 16); this.p(t, 8, 8, 16, 16, 16);
  }
  endPortalTex(t) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (this.rand() < 0.06)
        this.p(t, x, y, 120 + this.rand() * 135, 120 + this.rand() * 135, 180 + this.rand() * 75, 240);
      else this.p(t, x, y, 6, 10, 20, 240);
    }
  }
  lavaTex(t) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = this.rand();
      if (r < 0.25) this.p(t, x, y, 255, 208, 64);
      else if (r < 0.6) this.p(t, x, y, 240, 120, 24);
      else this.p(t, x, y, 198, 60, 8);
    }
  }
  // 石炭鉱石: 石地に黒い粒
  coalOreTex(t) {
    const st = this.palette.stone;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const f = 1 + (this.rand() - 0.5) * 0.14;
      this.p(t, x, y, st[0] * f, st[1] * f, st[2] * f);
    }
    for (let i = 0; i < 7; i++) {
      const cx = 2 + ((this.rand() * 12) | 0), cy = 2 + ((this.rand() * 12) | 0);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > 1) continue;
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < 16 && y >= 0 && y < 16) this.p(t, x, y, 26, 24, 24);
      }
    }
  }
  // 鉄鉱石: 石地にベージュ〜オレンジの粒
  ironOreTex(t) {
    const st = this.palette.stone;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const f = 1 + (this.rand() - 0.5) * 0.14;
      this.p(t, x, y, st[0] * f, st[1] * f, st[2] * f);
    }
    for (let i = 0; i < 7; i++) {
      const cx = 2 + ((this.rand() * 12) | 0), cy = 2 + ((this.rand() * 12) | 0);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > 1) continue;
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < 16 && y >= 0 && y < 16) this.p(t, x, y, 216, 178, 140);
      }
    }
  }
  // 汎用: レンガ状パターン（通常レンガ/ネザーレンガ/石レンガで色違い使い回し）
  brickPattern(t, mortar, brick) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const row = y >> 2;
      const isMortar = (y % 4 === 3) || (((x + (row % 2) * 4) % 8) === 7);
      const f = 1 + (this.rand() - 0.5) * (isMortar ? 0.08 : 0.12);
      const c = isMortar ? mortar : brick;
      this.p(t, x, y, c[0] * f, c[1] * f, c[2] * f);
    }
  }
  endCrystalTex(t) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const dx = x - 7.5, dy = y - 7.5, d = Math.sqrt(dx * dx + dy * dy);
      if (d < 7) {
        const r = this.rand();
        this.p(t, x, y, r < 0.4 ? 255 : 190, r < 0.4 ? 255 : 245, r < 0.4 ? 255 : 210, 230);
      } else this.p(t, x, y, 255, 255, 255, 0);
    }
  }
  enchantTop(t) {
    this.speckle(t, [70, 40, 100], 0.12);
    for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) {
      const b = (x === 3 || x === 12 || y === 3 || y === 12);
      this.p(t, x, y, b ? 200 : 140, b ? 170 : 90, b ? 255 : 210);
    }
  }
  enchantSide(t) {
    this.speckle(t, [70, 46, 30], 0.15);
    for (let i = 3; i < 13; i++) { this.p(t, i, 2, 150, 110, 255); this.p(t, i, 13, 150, 110, 255); }
  }
  furnaceTop(t) {
    this.speckle(t, [130, 130, 132], 0.1);
  }
  furnaceSide(t) {
    this.speckle(t, [120, 120, 122], 0.12);
    for (let y = 5; y < 12; y++) for (let x = 4; x < 12; x++) {
      const b = (x === 4 || x === 11 || y === 5 || y === 11);
      this.p(t, x, y, b ? 60 : 22, b ? 60 : 20, b ? 62 : 22);
    }
  }
  bedTex(t, color) {
    this.speckle(t, color, 0.08);
    for (let x = 0; x < 16; x++) {
      this.p(t, x, 0, 255, 255, 255);
      this.p(t, x, 15, color[0] * 0.6, color[1] * 0.6, color[2] * 0.6);
    }
  }
  commandBlockTex(t) {
    this.speckle(t, [190, 150, 90], 0.1);
    for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) {
      const b = (x === 3 || x === 12 || y === 3 || y === 12);
      this.p(t, x, y, b ? 110 : 210, b ? 90 : 170, b ? 50 : 100);
    }
  }
  pistonTex(t) {
    this.speckle(t, [150, 150, 140], 0.08);
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) {
      const b = (x === 2 || x === 13 || y === 2 || y === 13);
      this.p(t, x, y, b ? 90 : 180, b ? 86 : 180, b ? 70 : 160);
    }
  }
  stickyPistonTex(t) {
    this.pistonTex(t);
    for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) this.p(t, x, y, 70, 150, 60);
  }
  redstoneTorchTex(t) {
    this.speckle(t, [120, 120, 124], 0.1);
    for (let y = 4; y < 11; y++) for (let x = 6; x < 10; x++) {
      const r = this.rand();
      this.p(t, x, y, r < 0.5 ? 255 : 200, r < 0.5 ? 40 : 20, r < 0.5 ? 30 : 20);
    }
  }
  leverTex(t) {
    this.cobble(t);
    for (let y = 2; y < 13; y++) this.p(t, 7 + (((y - 2) / 4) | 0), y, 40, 32, 28);
  }
  tntTex(t) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const band = y >= 6 && y < 10;
      const f = 1 + (this.rand() - 0.5) * 0.1;
      if (band) this.p(t, x, y, 235 * f, 235 * f, 225 * f);
      else this.p(t, x, y, 205 * f, 50 * f, 40 * f);
    }
    for (let x = 0; x < 16; x++) { this.p(t, x, 6, 40, 32, 28); this.p(t, x, 9, 40, 32, 28); }
  }
  bookshelfTex(t) {
    this.planks(t);
    const cols = [[180, 40, 40], [40, 90, 170], [210, 180, 60], [60, 140, 90]];
    for (let y = 1; y < 15; y += 3) {
      for (let x = 1; x < 15; x++) {
        const c = cols[(x + y) % cols.length];
        this.p(t, x, y, c[0], c[1], c[2]);
      }
    }
  }
  quartzTex(t) {
    this.speckle(t, [235, 230, 220], 0.05);
    for (let x = 0; x < 16; x += 4) for (let y = 0; y < 16; y++) this.p(t, x, y, 210, 204, 190);
  }
  mossyStoneBrick(t) {
    this.brickPattern(t, [150, 150, 150], [120, 120, 120]);
    for (let i = 0; i < 18; i++) {
      const x = (this.rand() * 16) | 0, y = (this.rand() * 16) | 0;
      this.p(t, x, y, 70, 120, 60);
    }
  }
  pumpkinTex(t) {
    this.speckle(t, [220, 120, 30], 0.1);
    for (let x = 0; x < 16; x += 4) for (let y = 0; y < 16; y++) this.p(t, x, y, 180, 90, 20);
    const dark = [40, 26, 10];
    this.p(t, 4, 5, dark[0], dark[1], dark[2]); this.p(t, 5, 5, dark[0], dark[1], dark[2]);
    this.p(t, 10, 5, dark[0], dark[1], dark[2]); this.p(t, 11, 5, dark[0], dark[1], dark[2]);
    for (let x = 4; x < 12; x++) this.p(t, x, 10, dark[0], dark[1], dark[2]);
  }
  melonTex(t) {
    this.speckle(t, [80, 160, 60], 0.08);
    for (let x = 0; x < 16; x += 3) for (let y = 0; y < 16; y++) this.p(t, x, y, 50, 120, 40);
  }
  hayTex(t) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const f = 1 + (this.rand() - 0.5) * 0.14;
      this.p(t, x, y, 214 * f, 178 * f, 64 * f);
    }
    for (let y = 2; y < 16; y += 4) for (let x = 0; x < 16; x++) this.p(t, x, y, 150, 120, 40);
  }
  iceTex(t) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const f = 1 + (this.rand() - 0.5) * 0.1;
      this.p(t, x, y, 170 * f, 215 * f, 240 * f, 210);
    }
  }
  spongeTex(t) {
    this.speckle(t, [200, 200, 60], 0.1);
    for (let i = 0; i < 10; i++) {
      const x = (this.rand() * 16) | 0, y = (this.rand() * 16) | 0;
      this.p(t, x, y, 150, 150, 30);
    }
  }
  boneTex(t) {
    this.speckle(t, [230, 222, 200], 0.06);
    for (let x = 2; x < 16; x += 5) for (let y = 0; y < 16; y++) this.p(t, x, y, 200, 190, 165);
  }
  drawAll() {
    const grass = this.palette.grass, stone = this.palette.stone, sand = this.palette.sand;
    this.speckle(TILE.GRASS_TOP, grass, 0.18);
    this.grassSide(TILE.GRASS_SIDE);
    this.speckle(TILE.DIRT, [134, 96, 67], 0.2);
    this.speckle(TILE.STONE, stone, 0.14);
    this.cobble(TILE.COBBLE);
    this.speckle(TILE.SAND, sand, 0.1);
    this.gravel(TILE.GRAVEL);
    this.logSide(TILE.LOG_SIDE);
    this.logTop(TILE.LOG_TOP);
    this.leaves(TILE.LEAVES);
    this.glass(TILE.GLASS);
    this.water(TILE.WATER);
    this.speckle(TILE.SNOW, [240, 246, 250], 0.06);
    this.brick(TILE.BRICK);
    this.planks(TILE.PLANKS);
    this.wool(TILE.WOOL);
    this.glow(TILE.GLOW);
    this.speckle(TILE.BEDROCK, [60, 60, 64], 0.5);
    this.ctableTop(TILE.CTABLE_TOP);
    this.ctableSide(TILE.CTABLE_SIDE);
    this.obsidianTex(TILE.OBSIDIAN);
    this.netherrackTex(TILE.NETHERRACK);
    this.portalTex(TILE.PORTAL);
    this.endstoneTex(TILE.ENDSTONE);
    this.epfSide(TILE.EPF_SIDE);
    this.epfTop(TILE.EPF_TOP);
    this.epfTopEye(TILE.EPF_TOP_EYE);
    this.endPortalTex(TILE.ENDPORTAL);
    this.lavaTex(TILE.LAVA);
    this.coalOreTex(TILE.COAL_ORE);
    this.ironOreTex(TILE.IRON_ORE);
    // ここから追加タイル（インベントリ拡張分）
    this.endCrystalTex(TILE.END_CRYSTAL);
    this.enchantTop(TILE.ENCHANT_TOP);
    this.enchantSide(TILE.ENCHANT_SIDE);
    this.furnaceTop(TILE.FURNACE_TOP);
    this.furnaceSide(TILE.FURNACE_SIDE);
    this.bedTex(TILE.BED_RED, [200, 50, 50]);
    this.bedTex(TILE.BED_BLUE, [50, 90, 200]);
    this.bedTex(TILE.BED_GREEN, [60, 160, 70]);
    this.bedTex(TILE.BED_YELLOW, [220, 200, 60]);
    this.bedTex(TILE.BED_WHITE, [225, 225, 230]);
    this.commandBlockTex(TILE.COMMAND_BLOCK);
    this.pistonTex(TILE.PISTON);
    this.stickyPistonTex(TILE.STICKY_PISTON);
    this.redstoneTorchTex(TILE.REDSTONE_TORCH);
    this.speckle(TILE.REDSTONE_BLOCK, [190, 20, 20], 0.12);
    this.speckle(TILE.REDSTONE_LAMP, [235, 205, 140], 0.08);
    this.leverTex(TILE.LEVER);
    this.tntTex(TILE.TNT);
    this.bookshelfTex(TILE.BOOKSHELF);
    this.brickPattern(TILE.NETHER_BRICK, [40, 14, 14], [70, 24, 22]);
    this.quartzTex(TILE.QUARTZ_BLOCK);
    this.speckle(TILE.GOLD_BLOCK, [250, 210, 60], 0.06);
    this.speckle(TILE.DIAMOND_BLOCK, [130, 230, 225], 0.06);
    this.speckle(TILE.EMERALD_BLOCK, [40, 200, 110], 0.08);
    this.brickPattern(TILE.STONE_BRICK, [150, 150, 150], [120, 120, 120]);
    this.mossyStoneBrick(TILE.MOSSY_STONE_BRICK);
    this.pumpkinTex(TILE.PUMPKIN);
    this.melonTex(TILE.MELON_BLOCK);
    this.hayTex(TILE.HAY_BALE);
    this.iceTex(TILE.ICE);
    this.spongeTex(TILE.SPONGE);
    this.boneTex(TILE.BONE_BLOCK);
  }
  // 道具アイテム用アイコン（32x32 dataURL）
  itemIcon(key) {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const g = c.getContext('2d');
    const P = (x, y, col) => { g.fillStyle = col; g.fillRect(x * 2, y * 2, 2, 2); };
    if (key === 'flint') {
      for (let a = 0; a < 26; a++) { // 火打金（C字）
        const t = Math.PI * 0.4 + a / 26 * Math.PI * 1.2;
        P(Math.round(7 + Math.cos(t) * 4.5), Math.round(8 + Math.sin(t) * 4.5), '#c8c8d0');
      }
      P(11, 4, '#ffd84a'); P(12, 3, '#ffb020'); P(12, 5, '#ff8020'); // 火花
      P(4, 11, '#7a5a3a'); P(5, 12, '#6a4c30'); P(4, 12, '#8a6a48'); P(5, 11, '#5c4028'); // 火打石
    } else if (key === 'eye') {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const dx = x - 7.5, dy = y - 7.5, d = Math.sqrt(dx * dx + dy * dy);
        if (d < 7) P(x, y, d < 2 ? '#101010' : d < 4.5 ? '#3ddc84' : '#1a5c38');
      }
    } else if (key === 'egg') {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const dx = (x - 7.5) / 5.2, dy = (y - 8) / 6.8;
        if (dx * dx + dy * dy < 1) P(x, y, Math.random() < 0.22 ? '#8a2be2' : '#141018');
      }
    }
    return c.toDataURL();
  }
  // インベントリ用アイコン（dataURL）
  iconURL(tile) {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const tx = tile % ATLAS_COLS, ty = (tile / ATLAS_COLS) | 0;
    g.drawImage(this.canvas, tx * 16, ty * 16, 16, 16, 0, 0, 32, 32);
    return c.toDataURL();
  }
}
