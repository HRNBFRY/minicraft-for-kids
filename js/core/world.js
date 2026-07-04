/* ---------------- Chunk / World: 地形生成・編集・レイキャスト ----------------
 * 地形の見た目や出現率は World 構築時に渡される terrainCfg（worlds/*.json 由来）
 * だけで変化する。アルゴリズム自体は全ワールド共通（"同じ機能を複数実装しない"方針）。
 */
import { CFG, B, BLOCK_DEFS, BIOME, FACES, DIM } from './constants.js';
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
    this.data = d;
    this.applyEdits();
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
          for (let ci = 0; ci < 4; ci++) {
            const c = face.c[ci];
            let py = y + c[1];
            if (def.liquid && f === 3 && c[1] === 1) py -= 0.12;
            bkt.pos.push(x0 + lx + c[0], py, z0 + lz + c[2]);
            bkt.nor.push(face.d[0], face.d[1], face.d[2]);
            bkt.col.push(sh, sh, sh);
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
    this.atlasCols = (opts && opts.atlasCols) || 6;
    this.atlasRows = (opts && opts.atlasRows) || 6;
    this.plantsEnabled = !opts || opts.plantsEnabled !== false;
    this.oreDefs = (opts && opts.oreDefs) || [];
    this.noise = new Noise(seed);
    this.chunks = new Map();
    this.edits = new Map();
    this.dirty = new Set();
    this.heightCache = new Uint8Array(CFG.WORLD_SIZE * CFG.WORLD_SIZE);
    this.biomeCache = new Uint8Array(CFG.WORLD_SIZE * CFG.WORLD_SIZE);
    this.meshCount = 0;
    this.saveDirty = false;
    this.frame = 0;
    this.colH = 0; this.colB = 0;
    this.offsets = buildOffsets();
  }
  key(cx, cz) { return cx + cz * CFG.CHUNKS; }

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
