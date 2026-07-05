/* ---------------- TouchControls: iPad等のタッチ操作（Proコン不要） ----------------
 * 左下: 仮想スティックで移動　/　画面右側ドラッグ: 視点操作
 * 右下ボタン: 上段に設置・インベントリ・破壊、下段にブロック切替・ジャンプ、
 * 最下段にしゃがみ降下を配置（設置・破壊をインベントリの隣に置き親指で押しやすくする）。
 * ジャンプはダブルタップで飛行切替。設置は長押しで連続設置（移動しながらのブリッジ設置向け）。
 */
export class TouchControls {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.moveF = 0;
    this.moveS = 0;
    this.jumpHeld = false;
    this.downHeld = false;
    this.placeHeld = false;
    this._lookDX = 0;
    this._lookDY = 0;
    this._joyTouchId = null;
    this._lookTouchId = null;
    this._joyCenter = { x: 0, y: 0 };
    this._lastJumpTap = 0;
    this.root = null;
  }

  mount() {
    const root = document.createElement('div');
    root.id = 'touchControls';
    root.className = 'hidden';
    root.innerHTML =
      '<div id="tcLookZone"></div>' +
      '<div id="tcJoyZone"><div id="tcJoyBase"><div id="tcJoyStick"></div></div></div>' +
      '<div id="tcButtons">' +
        '<button id="tcPlace" class="tcBtn" type="button">設置</button>' +
        '<button id="tcInv" class="tcBtn" type="button">📦</button>' +
        '<button id="tcBreak" class="tcBtn" type="button">破壊</button>' +
        '<button id="tcPrev" class="tcBtn" type="button">◀</button>' +
        '<button id="tcJump" class="tcBtn tcBig" type="button">▲</button>' +
        '<button id="tcNext" class="tcBtn" type="button">▶</button>' +
        '<div></div><button id="tcDown" class="tcBtn" type="button">▼</button><div></div>' +
      '</div>';
    document.body.appendChild(root);
    this.root = root;
    this.joyZone = root.querySelector('#tcJoyZone');
    this.joyStick = root.querySelector('#tcJoyStick');
    this.lookZone = root.querySelector('#tcLookZone');

    this.bindJoystick();
    this.bindLook();
    this.bindButtons();
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  bindJoystick() {
    const zone = this.joyZone;
    const onStart = e => {
      if (this._joyTouchId !== null) return;
      const t = e.changedTouches[0];
      this._joyTouchId = t.identifier;
      const r = zone.getBoundingClientRect();
      this._joyCenter = { x: r.left + 24 + 55, y: r.top + r.height - 24 - 55 };
      this.updateJoy(t);
      e.preventDefault();
    };
    const onMove = e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._joyTouchId) { this.updateJoy(t); e.preventDefault(); }
      }
    };
    const onEnd = e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._joyTouchId) {
          this._joyTouchId = null;
          this.moveF = 0; this.moveS = 0;
          this.joyStick.style.transform = 'translate(0px,0px)';
        }
      }
    };
    zone.addEventListener('touchstart', onStart, { passive: false });
    zone.addEventListener('touchmove', onMove, { passive: false });
    zone.addEventListener('touchend', onEnd);
    zone.addEventListener('touchcancel', onEnd);
  }

  updateJoy(t) {
    const R = 46;
    let dx = t.clientX - this._joyCenter.x, dy = t.clientY - this._joyCenter.y;
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = dx / len * R; dy = dy / len * R; }
    this.joyStick.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    this.moveS = dx / R;
    this.moveF = -dy / R;
  }

  bindLook() {
    const zone = this.lookZone;
    let lastX = 0, lastY = 0;
    const onStart = e => {
      if (this._lookTouchId !== null) return;
      const t = e.changedTouches[0];
      this._lookTouchId = t.identifier;
      lastX = t.clientX; lastY = t.clientY;
    };
    const onMove = e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._lookTouchId) {
          this._lookDX += t.clientX - lastX;
          this._lookDY += t.clientY - lastY;
          lastX = t.clientX; lastY = t.clientY;
          e.preventDefault();
        }
      }
    };
    const onEnd = e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._lookTouchId) this._lookTouchId = null;
      }
    };
    zone.addEventListener('touchstart', onStart, { passive: false });
    zone.addEventListener('touchmove', onMove, { passive: false });
    zone.addEventListener('touchend', onEnd);
    zone.addEventListener('touchcancel', onEnd);
  }

  bindButtons() {
    const g = this.game;
    const hold = (el, onDown, onUp) => {
      el.addEventListener('touchstart', e => { e.preventDefault(); onDown(); }, { passive: false });
      el.addEventListener('touchend', e => { e.preventDefault(); if (onUp) onUp(); });
      el.addEventListener('touchcancel', () => { if (onUp) onUp(); });
    };
    hold(this.root.querySelector('#tcJump'),
      () => {
        this.jumpHeld = true;
        const now = performance.now();
        if (now - this._lastJumpTap < 280) {
          g.player.flying = !g.player.flying;
          g.player.vel.y = 0;
          this._lastJumpTap = 0;
        } else this._lastJumpTap = now;
      },
      () => { this.jumpHeld = false; });
    hold(this.root.querySelector('#tcDown'),
      () => { this.downHeld = true; },
      () => { this.downHeld = false; });
    // 設置は長押しで連続設置（移動しながらのブリッジ設置で隙間ができないように）。
    // 実際の連続呼び出しは Game.tick() 側で毎フレーム doPlace() を呼ぶ。
    hold(this.root.querySelector('#tcPlace'),
      () => { this.placeHeld = true; g.doPlace(); },
      () => { this.placeHeld = false; });
    const tap = (id, fn) => {
      this.root.querySelector(id).addEventListener('touchstart', e => { e.preventDefault(); fn(); }, { passive: false });
    };
    tap('#tcBreak', () => g.doBreak());
    tap('#tcInv', () => g.toggleInventory());
    tap('#tcPrev', () => { if (g.playing()) g.inventory.cycle(-1); });
    tap('#tcNext', () => { if (g.playing()) g.inventory.cycle(1); });
  }

  consumeLook() {
    const d = { x: this._lookDX, y: this._lookDY };
    this._lookDX = 0; this._lookDY = 0;
    return d;
  }

  start() { this.active = true; this.show(); }
  stop() {
    this.active = false; this.hide();
    this.moveF = 0; this.moveS = 0;
    this.jumpHeld = false; this.downHeld = false; this.placeHeld = false;
    this._joyTouchId = null; this._lookTouchId = null;
  }
}
