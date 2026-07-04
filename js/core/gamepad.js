/* ---------------- GamepadInput: Switch Proコン等 (Gamepad API) ---------------- */
export class GamepadInput {
  constructor() {
    this.gp = null;
    this.connected = false;
    this.prev = new Array(20).fill(false);
    this.edge = new Array(20).fill(false);
    window.addEventListener('gamepadconnected', () => {});
    window.addEventListener('gamepaddisconnected', () => {});
  }
  poll() {
    const gps = (navigator.getGamepads && navigator.getGamepads()) || [];
    this.gp = null;
    for (let i = 0; i < gps.length; i++) {
      if (gps[i] && gps[i].connected) { this.gp = gps[i]; break; }
    }
    this.connected = !!this.gp;
    for (let i = 0; i < 20; i++) {
      const now = !!(this.gp && this.gp.buttons[i] && this.gp.buttons[i].pressed);
      this.edge[i] = now && !this.prev[i];
      this.prev[i] = now;
    }
  }
  // デッドゾーン付きスティック値
  axis(i) {
    if (!this.gp || this.gp.axes.length <= i) return 0;
    const v = this.gp.axes[i];
    return Math.abs(v) < 0.18 ? 0 : v;
  }
  held(i) { return !!(this.gp && this.gp.buttons[i] && this.gp.buttons[i].pressed); }
  pressed(i) { return this.edge[i]; }
}
