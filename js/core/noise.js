/* ---------------- 乱数・ハッシュ・Perlinノイズ ---------------- */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 座標から決定論的に [0,1) を返す
export function hash2(x, z, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function hash3(x, y, z, seed) {
  return hash2(x ^ Math.imul(y, 2246822519), z, seed);
}

export class Noise {
  constructor(seed) {
    const rand = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  static fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  static lerp(a, b, t) { return a + (b - a) * t; }
  static grad(h, x, y) {
    switch (h & 7) {
      case 0: return  x + y; case 1: return -x + y;
      case 2: return  x - y; case 3: return -x - y;
      case 4: return  x;     case 5: return -x;
      case 6: return  y;     default: return -y;
    }
  }
  perlin2(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = Noise.fade(x), v = Noise.fade(y), p = this.perm;
    const aa = p[p[X] + Y],     ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
    return Noise.lerp(
      Noise.lerp(Noise.grad(aa, x, y),     Noise.grad(ba, x - 1, y),     u),
      Noise.lerp(Noise.grad(ab, x, y - 1), Noise.grad(bb, x - 1, y - 1), u), v);
  }
  // fBm（オクターブ合成、[-1,1]に正規化）
  fbm(x, y, oct) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += amp * this.perlin2(x * freq, y * freq);
      norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  }

  // Ridged multifractal（尾根状ノイズ）: 山脈や峡谷の鋭い稜線を作る。返り値 [0,1]
  ridged(x, y, oct) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      let n = 1 - Math.abs(this.perlin2(x * freq, y * freq)); // 折り返して尾根化
      n *= n;                                                 // 稜線を鋭く
      sum += amp * n;
      norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  }

  // Domain warp: 座標自体をノイズでずらし、うねった自然な模様を得る
  // scale=座標のずらし量。fn(nx,ny) に歪めた座標を渡して評価する
  warp(x, y, scale, warpFreq) {
    const wx = this.perlin2(x * warpFreq + 19.1, y * warpFreq - 47.3);
    const wy = this.perlin2(x * warpFreq - 71.7, y * warpFreq + 3.9);
    return [x + wx * scale, y + wy * scale];
  }
}

// 独立したシード系列を得るためのユーティリティ。
// 同じ seed から用途別（Height/Temp/…）に相関の低い Noise を作るために使う。
export function derivedSeed(seed, salt) {
  let h = Math.imul(seed ^ salt, 2654435761);
  h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13;
  return h >>> 0;
}
