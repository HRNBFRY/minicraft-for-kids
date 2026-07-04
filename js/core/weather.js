/* ---------------- Weather: シンプルな雨エフェクト（world.json の weather で切替） ---------------- */
export class Weather {
  constructor(scene, cfg) {
    this.scene = scene;
    this.enabled = !!(cfg && cfg.enabled);
    this.type = (cfg && cfg.type) || 'rain';
    this.points = null;
    this.velY = -18;
    this.range = 40;
    if (this.enabled && this.type === 'rain') this.buildRain();
  }
  buildRain() {
    const COUNT = 900;
    const pos = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * this.range * 2;
      pos[i * 3 + 1] = Math.random() * 30;
      pos[i * 3 + 2] = (Math.random() - 0.5) * this.range * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x9fc6ff, size: 0.12, transparent: true, opacity: 0.55,
      depthWrite: false
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }
  update(dt, center) {
    if (!this.enabled || !this.points) return;
    const pos = this.points.geometry.attributes.position;
    const arr = pos.array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] += this.velY * dt;
      if (arr[i + 1] < 0) arr[i + 1] = 28 + Math.random() * 4;
    }
    pos.needsUpdate = true;
    this.points.position.set(center.x, 0, center.z);
  }
  setActive(v) {
    this.enabled = v;
    if (this.points) this.points.visible = v;
  }
  dispose() {
    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      this.points.material.dispose();
      this.points = null;
    }
  }
}
