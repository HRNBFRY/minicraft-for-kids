/* ---------------- TouchControls: iPad等のタッチ操作（Proコン不要） ----------------
 * 左下: 仮想スティックで移動　/　画面右側ドラッグ: 視点操作
 * 右下ボタン: 上段に設置・インベントリ・破壊、下段にブロック切替・ジャンプ、
 * 最下段にしゃがみ降下を配置（設置・破壊をインベントリの隣に置き親指で押しやすくする）。
 * ジャンプはダブルタップで飛行切替。設置は長押しで連続設置（移動しながらのブリッジ設置向け）。
 * ◀▶（ブロック切替）も長押しで連続切替できる。
 * メニュー「操作ボタンの配置を変更」で編集モードに入ると、各ボタンをドラッグして
 * 好きな位置に動かせる（enterLayoutEdit/exitLayoutEdit）。位置は localStorage に保存し、
 * 次回起動時にも復元する。
 */
const LAYOUT_KEY = 'minicraft_touch_layout_v1';

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
    this.editingLayout = false;
    this.customLayout = this.loadLayout();
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
      '</div>' +
      '<div id="tcLayoutBar">' +
        '<div id="tcLayoutHint">ボタンをドラッグして配置を変更できます</div>' +
        '<button id="tcLayoutReset" class="tcLayoutBtn" type="button">リセット</button>' +
        '<button id="tcLayoutDone" class="tcLayoutBtn tcLayoutDone" type="button">✅ 完了してゲームに戻る</button>' +
      '</div>';
    document.body.appendChild(root);
    this.root = root;
    this.joyZone = root.querySelector('#tcJoyZone');
    this.joyStick = root.querySelector('#tcJoyStick');
    this.lookZone = root.querySelector('#tcLookZone');
    this.layoutBar = root.querySelector('#tcLayoutBar');
    this.buttons = Array.from(root.querySelectorAll('.tcBtn'));

    this.bindJoystick();
    this.bindLook();
    this.bindButtons();
    this.applyLayout();

    this.layoutBar.querySelector('#tcLayoutReset').addEventListener('touchstart', e => {
      e.preventDefault(); this.resetLayout();
    }, { passive: false });
    this.layoutBar.querySelector('#tcLayoutDone').addEventListener('touchstart', e => {
      e.preventDefault(); this.exitLayoutEdit(); this.game.closePauseMenu();
    }, { passive: false });

    // 縦持ち⇔横持ちの回転でビューポートの幅/高さが入れ替わると、保存済みの
    // 座標（%換算）がそのままでは画面外にはみ出すことがあるため、サイズが
    // 変わるたびにカスタム配置のボタンだけ現在のビューポートで位置を再計算する。
    window.addEventListener('resize', () => this.applyLayout());
    window.addEventListener('orientationchange', () => this.applyLayout());
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  // ---- ボタン配置編集モード ----
  enterLayoutEdit() {
    if (!this.root) return;
    this.editingLayout = true;
    this.show();
    this.root.classList.add('editingLayout');
  }
  exitLayoutEdit() {
    this.editingLayout = false;
    if (this.root) this.root.classList.remove('editingLayout');
  }
  loadLayout() {
    try { return JSON.parse(localStorage.getItem(LAYOUT_KEY)) || {}; }
    catch (e) { return {}; }
  }
  saveLayout() {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.customLayout)); }
    catch (e) { /* ignore */ }
  }
  // 保存済みの位置があるボタンだけ、グリッドから外して固定位置に配置する
  applyLayout() {
    for (const el of this.buttons) {
      const pos = this.customLayout[el.id];
      if (pos) this.placeAt(el, pos.xPct * window.innerWidth, pos.yPct * window.innerHeight);
    }
  }
  placeAt(el, x, y) {
    const w = el.offsetWidth || 58, h = el.offsetHeight || 52;
    x = Math.max(4, Math.min(window.innerWidth - w - 4, x));
    y = Math.max(4, Math.min(window.innerHeight - h - 4, y));
    el.style.position = 'fixed';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.margin = '0';
  }
  resetLayout() {
    this.customLayout = {};
    this.saveLayout();
    for (const el of this.buttons) {
      el.style.position = ''; el.style.left = ''; el.style.top = '';
      el.style.right = ''; el.style.bottom = ''; el.style.margin = '';
    }
  }

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
    this._releaseFns = [];
    // ボタン単位で押下中のタッチIDを覚えておき、同じボタンに複数指が触れても
    // onUp が二重に走ったり、無関係な指のtouchendで誤解除されたりしないようにする。
    // onDown/onUp が確実に対で呼ばれるよう、releaseAll() からも onUp を呼べるように登録する。
    // editingLayout 中はボタンのアクションを発火させず、ドラッグでの位置移動に切り替える。
    const hold = (el, onDown, onUp) => {
      let touchId = null, dragging = false, offX = 0, offY = 0;
      const down = e => {
        if (touchId !== null) return;
        e.preventDefault();
        const t = e.changedTouches[0];
        touchId = t.identifier;
        if (this.editingLayout) {
          dragging = true;
          el.classList.add('dragging');
          const r = el.getBoundingClientRect();
          this.placeAt(el, r.left, r.top);
          offX = t.clientX - r.left; offY = t.clientY - r.top;
        } else {
          onDown();
        }
      };
      const move = e => {
        if (!dragging) return;
        for (const t of e.changedTouches) {
          if (t.identifier === touchId) {
            e.preventDefault();
            this.placeAt(el, t.clientX - offX, t.clientY - offY);
          }
        }
      };
      const up = e => {
        if (e && e.changedTouches) {
          let found = false;
          for (const t of e.changedTouches) if (t.identifier === touchId) found = true;
          if (!found) return;
        }
        if (touchId === null) return;
        touchId = null;
        if (dragging) {
          dragging = false;
          el.classList.remove('dragging');
          this.customLayout[el.id] = {
            xPct: parseFloat(el.style.left) / window.innerWidth,
            yPct: parseFloat(el.style.top) / window.innerHeight
          };
          this.saveLayout();
        } else onUp();
      };
      el.addEventListener('touchstart', down, { passive: false });
      el.addEventListener('touchmove', move, { passive: false });
      el.addEventListener('touchend', e => { e.preventDefault(); up(e); });
      el.addEventListener('touchcancel', up);
      this._releaseFns.push(() => { if (touchId !== null) up(null); });
    };
    // 押した瞬間に1回、以後は指を離すまで一定間隔で fn を繰り返す
    // （◀▶のブロック切替や▲▼の長押しなど、連続動作用の共通ヘルパー）。
    const holdRepeat = (el, fn, interval = 220) => {
      let timer = null;
      hold(el,
        () => { fn(); timer = setInterval(fn, interval); },
        () => { if (timer) { clearInterval(timer); timer = null; } });
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
    // タップのみ（離しても何もしない）だが、editingLayout中はhold()と同じくドラッグ対応にする
    const tap = (id, fn) => { hold(this.root.querySelector(id), fn, () => {}); };
    tap('#tcBreak', () => g.doBreak());
    tap('#tcInv', () => g.toggleInventory());
    // ◀▶は長押しで連続切替（▲▼・設置と同じ「押しっぱなしで動作継続」に統一する）
    holdRepeat(this.root.querySelector('#tcPrev'), () => { if (g.playing()) g.inventory.cycle(-1); });
    holdRepeat(this.root.querySelector('#tcNext'), () => { if (g.playing()) g.inventory.cycle(1); });

    // 画面が非表示になる・アプリがバックグラウンドに回る等で touchend/touchcancel が
    // 発火しないまま長押し状態が固定されてしまう事故を防ぐ安全策。
    const releaseAll = () => { for (const fn of this._releaseFns) fn(); };
    document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
    window.addEventListener('blur', releaseAll);
    this._releaseAll = releaseAll;
  }

  consumeLook() {
    const d = { x: this._lookDX, y: this._lookDY };
    this._lookDX = 0; this._lookDY = 0;
    return d;
  }

  start() { this.active = true; this.show(); }
  stop() {
    this.active = false; this.hide();
    if (this._releaseAll) this._releaseAll();
    this.moveF = 0; this.moveS = 0;
    this.jumpHeld = false; this.downHeld = false; this.placeHeld = false;
    this._joyTouchId = null; this._lookTouchId = null;
  }
}
