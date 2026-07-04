import { CFG, DIM } from './constants.js';

/* ---------------- SaveManager: localStorageへ自動保存（全次元＋モジュール対応） ---------------- */
export class SaveManager {
  constructor(game) { this.game = game; }
  load() {
    try {
      const s = localStorage.getItem(CFG.SAVE_KEY);
      if (!s) return null;
      const d = JSON.parse(s);
      if (d.seed !== CFG.SEED) return null;
      return d;
    } catch (e) { return null; }
  }
  apply(d) {
    const g = this.game;
    const dims = d.dims || [{ edits: d.edits || {} }];
    dims.forEach((dd, i) => {
      if (!dd || !dd.edits || !g.worlds[i]) return;
      for (const k in dd.edits) {
        const m = new Map(), o = dd.edits[k];
        for (const idx in o) m.set(idx | 0, o[idx]);
        g.worlds[i].edits.set(k | 0, m);
      }
    });
    const p = d.player;
    if (p && typeof p.x === 'number') {
      g.player.pos.set(p.x, p.y, p.z);
      g.player.yaw = p.yaw || 0;
      g.player.pitch = p.pitch || 0;
      g.player.flying = !!p.fly;
      g.startDim = p.dim || DIM.OVER;
    } else {
      g.player.spawn();
    }
    if (typeof d.sel === 'number') {
      g.inventory.index = Math.max(0, Math.min(d.sel, g.inventory.items.length - 1));
      g.inventory.refresh();
    }
    if (typeof d.shadows === 'boolean') g.shadows = d.shadows;
    // モジュール固有の状態（例: ドラゴン撃破フラグ）
    g.runDeserialize(d.modules || {});
  }
  save() {
    try {
      const g = this.game;
      const dims = g.worlds.map(w => {
        const edits = {};
        for (const [k, m] of w.edits) {
          const o = {};
          for (const [i, v] of m) o[i] = v;
          edits[k] = o;
        }
        return { edits };
      });
      const p = g.player;
      const data = {
        v: 3, seed: CFG.SEED, dims,
        player: { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, pitch: p.pitch, fly: p.flying, dim: g.dim },
        sel: g.inventory.index,
        shadows: g.shadows,
        modules: g.collectSerialize()
      };
      localStorage.setItem(CFG.SAVE_KEY, JSON.stringify(data));
      g.worlds.forEach(w => { w.saveDirty = false; });
    } catch (e) { /* 容量超過などは無視 */ }
  }
}
