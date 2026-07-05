/* ---------------- Input: キーボード状態管理 ---------------- */
export class Input {
  constructor() {
    this.keys = new Set();
    this.onDown = null;
    window.addEventListener('keydown', e => {
      if (e.code === 'Space' || e.code === 'F5') e.preventDefault();
      const first = !e.repeat && !this.keys.has(e.code);
      this.keys.add(e.code);
      if (first && this.onDown) this.onDown(e.code);
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }
}
