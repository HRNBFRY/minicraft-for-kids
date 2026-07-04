/* ---------------- DayNight: 昼夜サイクル（world.json の dayNightCycle で切替） ----------------
 * 無効な場合は何もしない（今まで通り固定の空・光を使う）。
 */
export class DayNight {
  constructor(cfg) {
    this.enabled = !!(cfg && cfg.enabled);
    this.dayLength = (cfg && cfg.dayLengthSec) || 600;
    this.t = 0.25; // 0=真夜中 0.25=朝 0.5=正午 0.75=夕方
  }
  update(dt) {
    if (!this.enabled) return;
    this.t = (this.t + dt / this.dayLength) % 1;
  }
  // 0（暗）〜1（明るい）の明るさ係数
  brightness() {
    if (!this.enabled) return 1;
    return 0.35 + 0.65 * Math.max(0, Math.sin(this.t * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5);
  }
  // 太陽の向き（プレイヤー中心からのオフセット）
  sunOffset(dist) {
    const a = this.t * Math.PI * 2;
    return { x: Math.cos(a) * dist, y: Math.sin(a) * dist * 0.7 + dist * 0.3, z: Math.sin(a * 0.7) * dist * 0.4 };
  }
  isNight() { return this.enabled && (this.t < 0.2 || this.t > 0.8); }
}
