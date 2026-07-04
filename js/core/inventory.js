import { BLOCK_DEFS, blockIdByName } from './constants.js';

/* ---------------- Inventory: クリエイティブインベントリ ----------------
 * itemDefs はコア（flint/eye）＋モジュールが registerItemDef() で追加した
 * ものをまとめたオブジェクト。プロフィールの initialItems で並び順の先頭を
 * 差し替えられる。
 */
export class Inventory {
  constructor(tex, itemDefs, onChange, onToggle, initialItems) {
    this.itemDefs = itemDefs;
    this.items = [];
    for (let id = 1; id < BLOCK_DEFS.length; id++) this.items.push(id); // ブロック
    for (const k in itemDefs) this.items.push(k);                       // 道具アイテム

    if (initialItems && initialItems.length) {
      const front = [];
      for (const key of initialItems) {
        const bid = blockIdByName(key);
        const entry = bid !== undefined ? bid : key;
        const idx = this.items.indexOf(entry);
        if (idx >= 0) { this.items.splice(idx, 1); front.push(entry); }
      }
      this.items = front.concat(this.items);
    }

    this.index = 0;
    this.open = false;
    this.onChange = onChange;
    this.onToggle = onToggle;
    this.el = document.getElementById('inventory');
    this.icons = {};
    this.cells = [];
    const grid = document.getElementById('invGrid');
    grid.innerHTML = '';
    this.items.forEach((entry, i) => {
      const isBlock = typeof entry === 'number';
      const name = isBlock ? BLOCK_DEFS[entry].name : itemDefs[entry].name;
      const cell = document.createElement('div');
      cell.className = 'invItem';
      cell.title = name;
      const img = document.createElement('img');
      img.src = isBlock ? tex.iconURL(BLOCK_DEFS[entry].tiles[2]) : tex.itemIcon(entry);
      img.alt = name;
      this.icons[entry] = img.src;
      cell.appendChild(img);
      cell.addEventListener('click', () => { this.select(i); this.setOpen(false); });
      grid.appendChild(cell);
      this.cells.push(cell);
    });
    this.refresh();
  }
  entryName(e) {
    return typeof e === 'number' ? BLOCK_DEFS[e].name : this.itemDefs[e].name;
  }
  get current() { return this.items[this.index]; }
  setOpen(v) {
    if (this.open === v) return;
    this.open = v;
    this.el.classList.toggle('hidden', !v);
    if (v) this.refresh();
    if (this.onToggle) this.onToggle(v);
  }
  toggle() { this.setOpen(!this.open); }
  select(i) { this.index = i; this.refresh(); this.onChange(this.current); }
  cycle(d) {
    this.index = (this.index + d + this.items.length) % this.items.length;
    this.refresh();
    this.onChange(this.current);
  }
  move(d) {
    this.index = Math.max(0, Math.min(this.items.length - 1, this.index + d));
    this.refresh();
    this.onChange(this.current);
  }
  refresh() {
    for (let i = 0; i < this.cells.length; i++)
      this.cells[i].classList.toggle('selected', i === this.index);
  }
}
