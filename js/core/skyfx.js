/* ---------------- SkyFX: 虹・オーロラ（Phase2残りの空エフェクト） ----------------
 * オーバーワールドのみ。既存の Weather（雨）と同じく、ライトウェイトな板/トーラス
 * ジオメトリをプレイヤーに追従させるだけで、ブロックやセーブデータには一切触れない。
 * 何も条件が揃わないときは常に非表示（= 既存ワールドに無影響）。
 */
import { OB } from './worldgen.js';

const COLD_BIOMES = new Set([OB.SNOWY_PLAINS, OB.SNOWY_TAIGA, OB.GLACIER, OB.SNOWY_PEAKS, OB.FROZEN_OCEAN]);
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

export class SkyFX {
  constructor(scene) {
    this.scene = scene;
    this.auroraT = 0;
    this.auroraAlpha = 0;
    this.rainbowAlpha = 0;
    this._rainGraceT = 0;
    this._sponCheckT = 30 + Math.random() * 40;
    this._sponActiveT = 0;
    this._buildAurora();
    this._buildRainbow();
  }

  // 寒冷バイオーム×夜だけプレイヤー上空に出す、波打つ半透明カーテン（3枚重ね）
  _buildAurora() {
    const group = new THREE.Group();
    const bands = [
      { color: 0x55ffb0, opacity: 0.5, offsetY: 34, rotY: 0.0, phase: 0.0 },
      { color: 0x3fd0ff, opacity: 0.4, offsetY: 42, rotY: 1.05, phase: 2.1 },
      { color: 0xb07bff, opacity: 0.35, offsetY: 50, rotY: -1.05, phase: 4.2 }
    ];
    this.auroraBands = bands.map(b => {
      const geo = new THREE.PlaneGeometry(64, 24, 18, 2);
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const col = new THREE.Color(b.color);
      for (let i = 0; i < pos.count; i++) {
        const edge = Math.abs(pos.getY(i)) / 12; // 0=中央 1=上下端
        const bright = 1 - edge * 0.92; // 端は黒に近づけ、加算合成でフェードして見せる
        colors[i * 3] = col.r * bright; colors[i * 3 + 1] = col.g * bright; colors[i * 3 + 2] = col.b * bright;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: true
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.rotation.x = -0.2;
      mesh.position.set(0, b.offsetY, -6);
      group.add(mesh);
      return { mesh, geo, baseOpacity: b.opacity, rotY: b.rotY, phase: b.phase };
    });
    group.visible = false;
    group.frustumCulled = false;
    this.scene.add(group);
    this.auroraGroup = group;
  }

  // 太陽と反対方向の遠景に半円アーチ（内側=紫 → 外側=赤 の6色トーラス片）
  _buildRainbow() {
    const group = new THREE.Group();
    const colors = [0x8b3bff, 0x2f7dff, 0x34c759, 0xffe600, 0xff9500, 0xff3b30]; // 紫→赤
    const baseR = 30, step = 1.5, tube = 0.9;
    this.rainbowBands = colors.map((color, i) => {
      const geo = new THREE.TorusGeometry(baseR + i * step, tube, 6, 48, Math.PI);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, fog: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      group.add(mesh);
      return { mesh, baseOpacity: 0.5 };
    });
    group.visible = false;
    group.frustumCulled = false;
    this.scene.add(group);
    this.rainbowGroup = group;
  }

  _isColdBiome(gen, pos) {
    const c = gen.column(Math.floor(pos.x), Math.floor(pos.z));
    return COLD_BIOMES.has(c.biome);
  }

  // opts: { overworld, gen, playerPos, isNight, weatherEnabled, sunPos }
  update(dt, opts) {
    this._updateAurora(dt, opts);
    this._updateRainbow(dt, opts);
  }

  _updateAurora(dt, opts) {
    const cold = opts.overworld && opts.gen && opts.isNight && this._isColdBiome(opts.gen, opts.playerPos);
    const target = cold ? 1 : 0;
    this.auroraAlpha += (target - this.auroraAlpha) * Math.min(1, dt * 0.5);
    if (this.auroraAlpha < 0.004 && !cold) { this.auroraGroup.visible = false; return; }
    this.auroraGroup.visible = true;
    this.auroraT += dt;
    const p = opts.playerPos;
    this.auroraGroup.position.set(p.x, p.y, p.z);
    for (const b of this.auroraBands) {
      b.mesh.rotation.y = b.rotY + Math.sin(this.auroraT * 0.06 + b.phase) * 0.25;
      b.mesh.material.opacity = b.baseOpacity * this.auroraAlpha;
      const pos = b.geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i), vy = pos.getY(i);
        pos.setZ(i, Math.sin(this.auroraT * 1.1 + vx * 0.12 + b.phase) * (3 + Math.abs(vy) * 0.15));
      }
      pos.needsUpdate = true;
    }
  }

  _updateRainbow(dt, opts) {
    if (opts.weatherEnabled) this._rainGraceT = 18;
    else this._rainGraceT = Math.max(0, this._rainGraceT - dt);
    this._sponCheckT -= dt;
    if (this._sponCheckT <= 0) {
      this._sponCheckT = 50 + Math.random() * 70;
      if (this._rainGraceT <= 0 && this._sponActiveT <= 0 && Math.random() < 0.15) this._sponActiveT = 18 + Math.random() * 12;
    }
    if (this._sponActiveT > 0) this._sponActiveT -= dt;
    const rainSource = opts.weatherEnabled || this._rainGraceT > 0;
    const active = opts.overworld && (rainSource || this._sponActiveT > 0);
    const target = active ? 1 : 0;
    this.rainbowAlpha += (target - this.rainbowAlpha) * Math.min(1, dt * 0.4);
    if (this.rainbowAlpha < 0.004 && !active) { this.rainbowGroup.visible = false; return; }
    this.rainbowGroup.visible = true;

    const p = opts.playerPos, sun = opts.sunPos;
    let dx = p.x - sun.x, dz = p.z - sun.z; // 太陽→プレイヤーの延長線上（太陽と反対側）
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const D = 60, ry = p.y + 1.6;
    this.rainbowGroup.position.set(p.x + dx * D, ry, p.z + dz * D);
    this.rainbowGroup.lookAt(p.x, ry, p.z);
    for (const b of this.rainbowBands) b.mesh.material.opacity = b.baseOpacity * clamp01(this.rainbowAlpha);
  }
}
