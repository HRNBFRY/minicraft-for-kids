import { CFG, B, BLOCK_DEFS, DIM, DIM_NAME, CORE_ITEM_DEFS } from './constants.js';
import { World } from './world.js';
import { TextureGenerator } from './textures.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { GamepadInput } from './gamepad.js';
import { TouchControls } from './touch.js';
import { Inventory } from './inventory.js';
import { SaveManager } from './save.js';
import { Weather } from './weather.js';
import { DayNight } from './daynight.js';
import { EventScheduler } from './events.js';

/* ---------------- Game: レンダラ・ループ・次元・イベント統括 ----------------
 * モジュール（ドラゴン等）はここに直接書き込まず、registerHook / registerItemDef /
 * registerItemHandler 経由でエンジンへ接続する。詳細は docs/ARCHITECTURE.md 参照。
 */
export class Game {
  constructor(profile, world, derived, moduleDefs) {
    this.profile = profile;
    this.world_ = world; // world.json 本体（設定参照用。Worldインスタンスと名前が被るので別名）
    this.derived = derived;

    this.locked = false;
    this.gpStarted = false;
    this.lastSpace = 0;
    this.gpBreakT = 0;
    this.gpPlaceT = 0;
    this.gpShotLatch = false;
    this.fps = 0;
    this.frames = 0;
    this.fpsT = performance.now();
    this.hudT = 0;
    this.last = performance.now();
    this.shadows = profile.enabledFeatures.shadows !== false;
    this.featureInventory = profile.enabledFeatures.inventory !== false;
    this.gamepadEnabled = profile.enabledFeatures.gamepad !== false;
    this.startDim = DIM.OVER;
    this.pauseOpen = false;
    this.isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    this.renderLevels = [
      { label: '近', dist: 5 },
      { label: '中', dist: 8 },
      { label: '遠', dist: 14 }
    ];
    this.renderLevelIndex = this.renderLevels.findIndex(l => l.dist === CFG.RENDER_DIST);
    if (this.renderLevelIndex < 0) this.renderLevelIndex = 1;
    this.portalCd = 0;
    this.lastPos = [null, null, null];
    this.lastEnterDimNotes = [];
    this.ctl = { f: 0, s: 0, jump: false, down: false };
    this._dir = new THREE.Vector3();
    this._hit = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };

    // モジュール接続点
    this.itemDefs = Object.assign({}, CORE_ITEM_DEFS);
    this.itemHandlers = {};
    this.hooks = { tick: [], onEnterDim: [], getAttackCandidates: [], serialize: [], deserialize: [], hudLine: [] };
    this.moduleIds = [];

    this.initRenderer();

    this.tex = new TextureGenerator(world.seed, world.palette);
    this.matSolid = new THREE.MeshLambertMaterial({ map: this.tex.texture, vertexColors: true });
    this.matAlpha = new THREE.MeshLambertMaterial({
      map: this.tex.texture, vertexColors: true,
      transparent: true, depthWrite: false, side: THREE.DoubleSide
    });

    // 3次元ワールド（オーバーワールド / ネザー / ジ・エンド）— 生成パラメータのみ world.json 依存
    this.worlds = [];
    for (let d = 0; d < 3; d++) {
      const grp = new THREE.Group();
      const opts = {
        atlasCols: 6, atlasRows: 6,
        plantsEnabled: derived.plantsEnabled,
        oreDefs: d === DIM.OVER ? derived.oreDefs : []
      };
      this.worlds.push(new World(world.seed, grp, this.matSolid, this.matAlpha, d, derived.terrainByDim[d], opts));
    }
    this.player = new Player(this.worlds[DIM.OVER]);
    this.input = new Input();
    this.pad = new GamepadInput();

    // モジュールのインストール（アイテム登録・フック登録）。Inventory構築の前に行う。
    for (const m of moduleDefs) {
      try {
        m.install(this, m.cfg);
        this.moduleIds.push(m.id);
      } catch (e) {
        console.error('module install failed:', m.id, e);
      }
    }

    this.inventory = new Inventory(
      this.tex, this.itemDefs,
      () => this.updateCurBlock(),
      open => this.onInventoryToggle(open),
      profile.initialItems
    );
    this.saveMgr = new SaveManager(this);
    this.weather = new Weather(this.scene, world.weather);
    this.dayNight = new DayNight(world.dayNightCycle);
    this.events = new EventScheduler(this.scene, world.specialEvents);

    const saved = this.saveMgr.load();
    if (saved) this.saveMgr.apply(saved);
    else this.player.spawn();
    this.setDim(this.startDim);
    this.renderer.shadowMap.enabled = this.shadows;

    this.hudEl = document.getElementById('hud');
    this.hintEl = document.getElementById('hint');
    this.msgEl = document.getElementById('msg');
    this.curIcon = document.getElementById('curIcon');
    this.curName = document.getElementById('curName');
    this.btnMenuOpen = document.getElementById('btnMenuOpen');
    this.pauseMenuEl = document.getElementById('pauseMenu');
    this.btnResume = document.getElementById('btnResume');
    this.btnRenderDist = document.getElementById('btnRenderDist');
    this.btnShadowToggle = document.getElementById('btnShadowToggle');
    this.btnHome = document.getElementById('btnHome');
    this.updateCurBlock();
    this.applyProfileUI();

    if (this.isTouch) {
      this.touch = new TouchControls(this);
      this.touch.mount();
    } else {
      this.touch = null;
    }

    this.bindEvents();
    this.updatePauseMenuUI();

    try {
      const saved = localStorage.getItem('minicraft_render_dist_v1');
      if (saved !== null) {
        const idx = parseInt(saved, 10);
        if (idx >= 0 && idx < this.renderLevels.length && idx !== this.renderLevelIndex) this.setRenderDist(idx);
      }
    } catch (e) { /* ignore */ }

    setInterval(() => this.saveMgr.save(), 4000);
    window.addEventListener('beforeunload', () => this.saveMgr.save());

    this._tick = this.tick.bind(this);
    requestAnimationFrame(this._tick);
  }

  /* ---------- モジュール接続API ---------- */
  registerItemDef(key, def) { this.itemDefs[key] = def; }
  registerItemHandler(key, fn) { this.itemHandlers[key] = fn; }
  registerHook(moduleId, name, fn) {
    if (!this.hooks[name]) throw new Error('unknown hook: ' + name);
    this.hooks[name].push({ moduleId, fn });
  }
  runTick(dt) { for (const h of this.hooks.tick) h.fn(dt); }
  runOnEnterDim(dim) {
    const notes = [];
    for (const h of this.hooks.onEnterDim) { const r = h.fn(dim); if (r) notes.push(r); }
    return notes;
  }
  collectAttackCandidates(origin, dir, maxDist) {
    let out = [];
    for (const h of this.hooks.getAttackCandidates) {
      const r = h.fn(origin, dir, maxDist);
      if (r) out = out.concat(r);
    }
    return out;
  }
  collectHudLines() {
    const out = [];
    for (const h of this.hooks.hudLine) { const r = h.fn(); if (r) out.push(r); }
    return out;
  }
  collectSerialize() {
    const o = {};
    for (const h of this.hooks.serialize) o[h.moduleId] = h.fn();
    return o;
  }
  runDeserialize(data) {
    for (const h of this.hooks.deserialize) h.fn(data ? data[h.moduleId] : undefined);
  }

  applyProfileUI() {
    const p = this.profile;
    document.documentElement.style.setProperty('--player-color', (p.skin && p.skin.color) || '#ffffff');
    this.playerNameLabel = p.playerName || '';
  }

  initRenderer() {
    const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setSize(window.innerWidth, window.innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(r.domElement);
    this.renderer = r;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fc6ea);
    this.scene.fog = new THREE.Fog(0x8fc6ea, 55, CFG.RENDER_DIST * 16 - 4);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 400);
    this.camera.rotation.order = 'YXZ';

    this.amb = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(this.amb);
    const sun = new THREE.DirectionalLight(0xfff3d8, 0.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70;
    sc.near = 1; sc.far = 400;
    sun.shadow.bias = -0.0006;
    this.sun = sun;
    this.scene.add(sun);
    this.scene.add(sun.target);
  }

  // 次元切替（グループ差し替え＋空気感の変更）。切替のたびに onEnterDim フックを呼ぶ。
  setDim(d) {
    if (this.dimInit && this.dim === d) return;
    if (this.dimInit) {
      this.lastPos[this.dim] = { x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z };
      this.scene.remove(this.worlds[this.dim].group);
    }
    this.dim = d;
    this.dimInit = true;
    this.world = this.worlds[d];
    this.player.world = this.world;
    this.scene.add(this.world.group);
    const cfg = this.derived.sky[d];
    this.scene.background.setHex(cfg.sky);
    this.scene.fog.color.setHex(cfg.sky);
    this.scene.fog.near = cfg.fogNear;
    this.scene.fog.far = cfg.fogFar;
    this.amb.intensity = cfg.ambIntensity; this.amb.color.setHex(cfg.ambColor);
    this.sun.intensity = cfg.sunIntensity; this.sun.color.setHex(cfg.sunColor);
    this.lastEnterDimNotes = this.runOnEnterDim(d);
  }

  bindEvents() {
    const canvas = this.renderer.domElement;
    this.hintEl.addEventListener('click', () => {
      if (this.isTouch) this.startTouchPlay();
      else this.requestLock();
    });
    canvas.addEventListener('click', () => {
      if (this.inventory.open || this.isTouch) return;
      this.requestLock();
    });
    this.btnMenuOpen.addEventListener('click', () => {
      if (this.pauseOpen) this.closePauseMenu(); else this.openPauseMenu();
    });
    this.btnResume.addEventListener('click', () => this.closePauseMenu());
    this.btnRenderDist.addEventListener('click', () => this.cycleRenderDist());
    this.btnShadowToggle.addEventListener('click', () => { this.toggleShadows(); this.updatePauseMenuUI(); });
    this.btnHome.addEventListener('click', () => this.goToTitle());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.syncOverlays();
    });
    document.addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.player.yaw -= e.movementX * 0.0022;
      this.player.pitch = Math.max(-1.55, Math.min(1.55, this.player.pitch - e.movementY * 0.0022));
    });
    document.addEventListener('mousedown', e => {
      if (!this.locked || this.inventory.open) return;
      if (e.button === 0) this.doBreak();
      else if (e.button === 2) this.doPlace();
    });
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('wheel', e => {
      if (this.playing()) this.inventory.cycle(e.deltaY > 0 ? 1 : -1);
    }, { passive: true });
    this.input.onDown = code => this.onKeyDown(code);
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  playing() {
    return (this.locked || this.gpStarted || (this.touch && this.touch.active)) &&
      !this.inventory.open && !this.pauseOpen;
  }

  requestLock() {
    try {
      const p = this.renderer.domElement.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* 連打などによる失敗は無視 */ }
  }
  startTouchPlay() {
    if (!this.touch) return;
    this.touch.start();
    this.syncOverlays();
  }
  syncOverlays() {
    const active = this.locked || this.gpStarted || (this.touch && this.touch.active);
    this.hintEl.classList.toggle('hidden', active || this.inventory.open || this.pauseOpen);
  }
  onInventoryToggle(open) {
    if (open) {
      if (this.locked) document.exitPointerLock();
    } else if (!this.gpStarted && !this.isTouch) {
      this.requestLock();
    }
    this.syncOverlays();
  }
  toggleInventory() { if (this.featureInventory) this.inventory.toggle(); }

  openPauseMenu() {
    if (this.inventory.open || this.pauseOpen) return;
    this.pauseOpen = true;
    if (this.locked) document.exitPointerLock();
    this.updatePauseMenuUI();
    this.pauseMenuEl.classList.remove('hidden');
    this.syncOverlays();
  }
  closePauseMenu() {
    if (!this.pauseOpen) return;
    this.pauseOpen = false;
    this.pauseMenuEl.classList.add('hidden');
    if (!this.gpStarted && !this.isTouch) this.requestLock();
    this.syncOverlays();
  }
  updatePauseMenuUI() {
    if (!this.btnRenderDist) return;
    this.btnRenderDist.textContent = '描画範囲: ' + this.renderLevels[this.renderLevelIndex].label;
    this.btnShadowToggle.textContent = '影MOD: ' + (this.shadows ? 'ON' : 'OFF');
  }
  goToTitle() {
    if (!confirm('トップ画面に戻りますか？（自動セーブ済み）')) return;
    try { this.saveMgr.save(); } catch (e) { /* ignore */ }
    location.reload();
  }

  // 描画範囲（近・中・遠）切替。各次元の World の生成/描画オフセットとフォグを再計算する。
  setRenderDist(idx) {
    idx = Math.max(0, Math.min(this.renderLevels.length - 1, idx));
    this.renderLevelIndex = idx;
    const dist = this.renderLevels[idx].dist;
    CFG.RENDER_DIST = dist;
    for (const w of this.worlds) w.rebuildOffsets();
    for (const s of this.derived.sky) if (s.fogFarAuto) s.fogFar = dist * 16 - 4;
    const cfg = this.derived.sky[this.dim];
    this.scene.fog.far = cfg.fogFar;
    try { localStorage.setItem('minicraft_render_dist_v1', String(idx)); } catch (e) { /* ignore */ }
    this.showMsg('描画範囲: ' + this.renderLevels[idx].label);
    this.updatePauseMenuUI();
  }
  cycleRenderDist() { this.setRenderDist((this.renderLevelIndex + 1) % this.renderLevels.length); }

  onKeyDown(code) {
    if (code === 'KeyE') {
      this.toggleInventory();
    } else if (code === 'KeyF') {
      this.toggleShadows();
    } else if (code === 'Escape') {
      if (this.inventory.open) this.inventory.setOpen(false);
      else if (this.pauseOpen) this.closePauseMenu();
      else if (this.locked || this.gpStarted || (this.touch && this.touch.active)) this.openPauseMenu();
      else this.gpStarted = false;
      this.syncOverlays();
    } else if (code === 'Space') {
      const now = performance.now();
      if (now - this.lastSpace < 280) {
        this.player.flying = !this.player.flying;
        this.player.vel.y = 0;
        this.lastSpace = 0;
      } else {
        this.lastSpace = now;
      }
    }
  }

  toggleShadows() {
    if (this.profile.enabledFeatures.shadows === false) return;
    this.shadows = !this.shadows;
    this.renderer.shadowMap.enabled = this.shadows;
    this.matSolid.needsUpdate = true;
    this.matAlpha.needsUpdate = true;
    this.showMsg('影MOD: ' + (this.shadows ? 'ON' : 'OFF'));
  }

  // キーボード＋ゲームパッドの操作を統合
  buildCtl() {
    const k = this.input.keys, c = this.ctl, g = this.pad;
    c.f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    c.s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    c.jump = k.has('Space');
    c.down = k.has('ShiftLeft') || k.has('ShiftRight');
    if (this.gamepadEnabled && g.connected) {
      c.f += -g.axis(1);
      c.s += g.axis(0);
      if (g.held(0)) c.jump = true;         // B: ジャンプ / 上昇（Switch版と同じ）
      if (g.held(1)) c.down = true;         // A: しゃがみ / 下降（Switch版と同じ）
      if (g.held(11)) c.down = true;        // 右スティック押込み: ゆっくり下降（Switch版と同じ）
    }
    if (this.touch && this.touch.active) {
      c.f += this.touch.moveF;
      c.s += this.touch.moveS;
      if (this.touch.jumpHeld) c.jump = true;
      if (this.touch.downHeld) c.down = true;
    }
    if (c.f > 1) c.f = 1; else if (c.f < -1) c.f = -1;
    if (c.s > 1) c.s = 1; else if (c.s < -1) c.s = -1;
  }

  // ゲームパッドのボタン処理（Switch版マイクラ(Bedrock)と同じボタン配置）
  // B:ジャンプ/飛行上昇  A:しゃがみ/飛行下降  X:インベントリ  Y:クラフト（インベントリと共用）
  // L/R:アイテム切替  ZL:設置/使用  ZR:攻撃/破壊  L+R:スクリーンショット
  // 左スティック押込み:影MOD切替（このゲーム独自機能）  ＋:ゲームメニュー（ポーズ）
  handleGamepad(now) {
    if (!this.gamepadEnabled) return;
    const g = this.pad;
    if (!g.connected) return;
    if (!this.gpStarted && !this.locked &&
        (g.pressed(9) || g.pressed(0) || g.pressed(1))) { // ＋/B/A でスタート
      this.gpStarted = true;
      this.syncOverlays();
      return;
    }
    if (this.gpStarted && g.pressed(9)) { // ＋: ゲームメニュー（ポーズ、Switch版と同じ）
      this.gpStarted = false;
      this.syncOverlays();
      return;
    }
    if (g.pressed(3) || g.pressed(2)) this.toggleInventory(); // X:インベントリ / Y:クラフト
    if (g.pressed(10)) this.toggleShadows();       // 左スティック押込み: 影MOD（独自機能）
    if (this.inventory.open) {
      if (g.pressed(14)) this.inventory.move(-1);
      if (g.pressed(15)) this.inventory.move(1);
      if (g.pressed(12)) this.inventory.move(-8);
      if (g.pressed(13)) this.inventory.move(8);
      if (g.pressed(0) || g.pressed(1)) this.inventory.setOpen(false);
      return;
    }
    if (!this.playing()) return;
    if (g.pressed(4)) this.inventory.cycle(-1);
    if (g.pressed(5)) this.inventory.cycle(1);
    if (g.pressed(0)) {
      if (now - this.lastSpace < 280) {
        this.player.flying = !this.player.flying;
        this.player.vel.y = 0;
        this.lastSpace = 0;
      } else this.lastSpace = now;
    }
    if (g.held(7)) {
      if (now >= this.gpBreakT) { this.gpBreakT = now + 250; this.doBreak(); }
    } else this.gpBreakT = 0;
    if (g.held(6)) {
      if (now >= this.gpPlaceT) { this.gpPlaceT = now + 250; this.doPlace(); }
    } else this.gpPlaceT = 0;
    if (g.held(4) && g.held(5)) {
      if (!this.gpShotLatch) { this.takeScreenshot(); this.gpShotLatch = true; }
    } else this.gpShotLatch = false;
  }

  takeScreenshot() {
    try {
      const url = this.renderer.domElement.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = 'minicraft_' + Date.now() + '.png';
      a.click();
      this.showMsg('スクリーンショットを保存した');
    } catch (e) { /* no-op */ }
  }

  // 破壊 or モジュール提供のエンティティ攻撃
  doBreak() {
    if (!this.playing()) return;
    this.camera.getWorldDirection(this._dir);
    const cands = this.collectAttackCandidates(this.camera.position, this._dir, 100);
    let best = null, bestT = 1e9;
    for (const c of cands) if (c.dist < bestT) { best = c; bestT = c.dist; }
    const hitOk = this.world.raycast(this.camera.position, this._dir, CFG.REACH, this._hit);
    let blockDist = 1e9;
    if (hitOk) {
      const h = this._hit;
      blockDist = Math.hypot(
        h.x + 0.5 - this.camera.position.x,
        h.y + 0.5 - this.camera.position.y,
        h.z + 0.5 - this.camera.position.z);
    }
    if (best && bestT < blockDist) { best.onHit(); return; }
    if (hitOk) {
      const h = this._hit;
      const id = this.world.getBlock(h.x, h.y, h.z);
      if (BLOCK_DEFS[id].breakable) this.world.setBlock(h.x, h.y, h.z, B.AIR);
    }
  }

  // 設置 or アイテム使用
  doPlace() {
    if (!this.playing()) return;
    this.camera.getWorldDirection(this._dir);
    if (!this.world.raycast(this.camera.position, this._dir, CFG.REACH, this._hit)) return;
    const h = this._hit;
    const tid = this.world.getBlock(h.x, h.y, h.z);
    const sneak = this.input.keys.has('ShiftLeft') || this.input.keys.has('ShiftRight');
    if (tid === B.CTABLE && !sneak) {
      if (this.featureInventory) this.inventory.setOpen(true);
      return;
    }
    const entry = this.inventory.current;
    if (typeof entry === 'string') { this.useItem(entry, h, tid); return; }
    const px = h.x + h.nx, py = h.y + h.ny, pz = h.z + h.nz;
    if (px < 0 || pz < 0 || px >= CFG.WORLD_SIZE || pz >= CFG.WORLD_SIZE ||
        py < 0 || py >= CFG.HEIGHT) return;
    const cur = this.world.getBlock(px, py, pz);
    if (cur !== B.AIR && !BLOCK_DEFS[cur].liquid) return;
    if (BLOCK_DEFS[entry].solid && this.player.intersectsBlock(px, py, pz)) return;
    this.world.setBlock(px, py, pz, entry);
  }

  useItem(key, h, tid) {
    if (this.itemHandlers[key]) { this.itemHandlers[key](h, tid); return; }
    if (key === 'flint') {
      if (tid === B.OBSIDIAN) {
        if (this.world.lightNetherPortal(h.x + h.nx, h.y + h.ny, h.z + h.nz))
          this.showMsg('ネザーポータルに点火した！');
        else
          this.showMsg('枠が不完全（黒曜石で 4×5 などの枠を作り、内側の面をクリック）');
      } else this.showMsg('黒曜石の枠に向かって使う');
    } else if (key === 'eye') {
      if (tid === B.EPF) {
        this.world.setBlock(h.x, h.y, h.z, B.EPF_EYE);
        if (this.world.checkEndPortal(h.x, h.y, h.z)) this.showMsg('エンドポータルが開いた！');
      } else if (tid === B.EPF_EYE) this.showMsg('もう目が入っている');
      else this.showMsg('フレームに向かって使う（3×3の周囲に12個のフレーム）');
    }
  }

  /* --------- ポータル移動（次元システムはコアエンジンの機能） --------- */
  checkPortalStep(now) {
    const p = this.player.pos;
    if (this.dim === DIM.END && p.y < -20 && now >= this.portalCd) {
      this.portalCd = now + 4000;
      this.returnOverworld('奈落に落ちた…オーバーワールドへ帰還');
      return;
    }
    if (now < this.portalCd) return;
    const id = this.world.getBlock(Math.floor(p.x), Math.floor(p.y + 0.2), Math.floor(p.z));
    if (id === B.PORTAL) this.travelNether(now);
    else if (id === B.ENDPORTAL) this.travelEnd(now, this.dim === DIM.END ? DIM.OVER : DIM.END);
  }
  travelNether(now) {
    this.portalCd = now + 4000;
    const x = Math.floor(this.player.pos.x), z = Math.floor(this.player.pos.z);
    const target = this.dim === DIM.NETHER ? DIM.OVER : DIM.NETHER;
    this.setDim(target);
    const w = this.world;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++)
      w.ensureData((x >> 4) + a, (z >> 4) + b);
    const p = this.findPortalNear(w, x, z);
    if (p) this.player.pos.set(p.x + 0.5, p.y, p.z + 0.5);
    else { const st = this.buildPortalAt(w, x, z); this.player.pos.set(st.x, st.y, st.z); }
    this.player.vel.set(0, 0, 0);
    this.showMsg(DIM_NAME[target] + ' へ移動した' + this.lastEnterDimNotes.join(''));
    this.saveMgr.save();
  }
  travelEnd(now, target) {
    this.portalCd = now + 4000;
    if (target === DIM.END) {
      this.setDim(DIM.END);
      const w = this.world, ex = 200, ez = 256;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++)
        w.ensureData((ex >> 4) + a, (ez >> 4) + b);
      const y = this.findStandY(w, ex, ez);
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        w.setBlock(ex + dx, y - 1, ez + dz, B.OBSIDIAN);
        for (let dy = 0; dy < 3; dy++) {
          if (w.getBlock(ex + dx, y + dy, ez + dz) !== B.AIR)
            w.setBlock(ex + dx, y + dy, ez + dz, B.AIR);
        }
      }
      this.player.pos.set(ex + 0.5, y, ez + 0.5);
      this.player.vel.set(0, 0, 0);
      const extra = this.lastEnterDimNotes.join('');
      this.showMsg(DIM_NAME[target] + ' へ移動した' + extra, extra ? 4500 : 2600);
      this.saveMgr.save();
    } else {
      this.returnOverworld('オーバーワールドへ帰還した');
    }
  }
  returnOverworld(msg) {
    this.setDim(DIM.OVER);
    const lp = this.lastPos[DIM.OVER];
    if (lp) this.player.pos.set(lp.x, lp.y, lp.z);
    else this.player.spawn();
    this.player.vel.set(0, 0, 0);
    this.showMsg(msg);
    this.saveMgr.save();
  }
  findPortalNear(w, x, z) {
    for (let dz = -16; dz <= 16; dz++) for (let dx = -16; dx <= 16; dx++)
      for (let y = 1; y < 126; y++)
        if (w.getBlock(x + dx, y, z + dz) === B.PORTAL) return { x: x + dx, y, z: z + dz };
    return null;
  }
  buildPortalAt(w, x, z) {
    const y = this.findStandY(w, x, z);
    for (let dx = -2; dx <= 3; dx++) for (let dz = -2; dz <= 2; dz++) {
      w.setBlock(x + dx, y - 1, z + dz, B.OBSIDIAN);
      for (let dy = 0; dy < 5; dy++) {
        if (w.getBlock(x + dx, y + dy, z + dz) !== B.AIR)
          w.setBlock(x + dx, y + dy, z + dz, B.AIR);
      }
    }
    for (let ix = -1; ix <= 2; ix++) for (let iy = 0; iy < 5; iy++) {
      const border = ix === -1 || ix === 2 || iy === 0 || iy === 4;
      w.setBlock(x + ix, y + iy, z, border ? B.OBSIDIAN : B.PORTAL);
    }
    return { x: x + 0.5, y: y, z: z + 1.5 };
  }
  findStandY(w, x, z) {
    for (let y = 36; y < CFG.HEIGHT - 8; y++) {
      if (BLOCK_DEFS[w.getBlock(x, y - 1, z)].solid &&
          w.getBlock(x, y, z) === B.AIR &&
          w.getBlock(x, y + 1, z) === B.AIR &&
          w.getBlock(x, y + 2, z) === B.AIR) return y;
    }
    for (let y = 5; y < 36; y++) {
      if (BLOCK_DEFS[w.getBlock(x, y - 1, z)].solid &&
          w.getBlock(x, y, z) === B.AIR &&
          w.getBlock(x, y + 1, z) === B.AIR) return y;
    }
    return 40;
  }
  // ボス撃破後の帰還ポータルをその次元の中心に建てる汎用ユーティリティ（モジュールから呼ばれる）
  spawnExitPortal(dim, cx, cz) {
    const w = this.worlds[dim];
    let gy = 80;
    while (gy > 4 && w.getBlock(cx, gy - 1, cz) === B.AIR) gy--;
    if (gy <= 4) gy = 60;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const border = Math.abs(dx) === 2 || Math.abs(dz) === 2;
      w.setBlock(cx + dx, gy, cz + dz, border ? B.BEDROCK : B.ENDPORTAL);
      for (let dy = 1; dy <= 3; dy++) {
        if (w.getBlock(cx + dx, gy + dy, cz + dz) !== B.AIR)
          w.setBlock(cx + dx, gy + dy, cz + dz, B.AIR);
      }
    }
  }

  showMsg(text, ms) {
    this.msgEl.textContent = text;
    this.msgEl.style.opacity = '1';
    clearTimeout(this._msgT);
    this._msgT = setTimeout(() => { this.msgEl.style.opacity = '0'; }, ms || 2600);
  }

  updateCurBlock() {
    const e = this.inventory.current;
    this.curIcon.src = this.inventory.icons[e];
    this.curName.textContent = this.inventory.entryName(e);
  }

  updateHUD() {
    const p = this.player.pos;
    let txt =
      (this.playerNameLabel ? this.playerNameLabel + '　' : '') +
      'XYZ: ' + p.x.toFixed(1) + ' / ' + p.y.toFixed(1) + ' / ' + p.z.toFixed(1) + '\n' +
      'FPS: ' + this.fps + '　次元: ' + DIM_NAME[this.dim] + '　ワールド: ' + this.world_.name + '\n' +
      'Chunks: 表示 ' + this.world.meshCount + ' / 生成 ' + this.world.chunks.size + '\n' +
      'Block: ' + this.inventory.entryName(this.inventory.current) + '\n' +
      '飛行: ' + (this.player.flying ? 'ON' : 'OFF') +
      '　影: ' + (this.shadows ? 'ON' : 'OFF') +
      '　描画: ' + this.renderLevels[this.renderLevelIndex].label +
      (this.gamepadEnabled && this.pad.connected ? '　🎮接続中' : '') +
      (this.touch && this.touch.active ? '　📱タッチ操作' : '');
    const extra = this.collectHudLines();
    if (extra.length) txt += '\n' + extra.join('\n');
    this.hudEl.textContent = txt;
  }

  tick(now) {
    requestAnimationFrame(this._tick);
    const dt = Math.min((now - this.last) / 1000 || 0, 1 / 30);
    this.last = now;

    if (this.gamepadEnabled) { this.pad.poll(); this.handleGamepad(now); }

    this.world.updateChunks(this.player.pos.x, this.player.pos.z);

    if (this.playing()) {
      this.buildCtl();
      if (this.gamepadEnabled && this.pad.connected) {
        this.player.yaw -= this.pad.axis(2) * 2.8 * dt;
        this.player.pitch = Math.max(-1.55, Math.min(1.55,
          this.player.pitch - this.pad.axis(3) * 2.0 * dt));
      }
      if (this.touch && this.touch.active) {
        const d = this.touch.consumeLook();
        this.player.yaw -= d.x * 0.0035;
        this.player.pitch = Math.max(-1.55, Math.min(1.55, this.player.pitch - d.y * 0.0035));
      }
      this.player.update(dt, this.ctl);
      this.checkPortalStep(now);
    }

    // モジュール（ドラゴン等）の更新
    this.runTick(dt);

    // 天候・昼夜・特殊イベント（world.json 設定に応じて有効/無効）
    this.weather.update(dt, this.player.pos);
    this.dayNight.update(dt);
    if (this.dayNight.enabled) {
      const b = this.dayNight.brightness();
      this.amb.intensity = this.derived.sky[this.dim].ambIntensity * b;
      this.sun.intensity = this.derived.sky[this.dim].sunIntensity * b;
    }
    this.events.update(dt, this.player.pos);

    this.player.updateCamera(this.camera);

    const pp = this.player.pos;
    if (this.dayNight.enabled) {
      const off = this.dayNight.sunOffset(100);
      this.sun.position.set(pp.x + off.x, pp.y + Math.max(20, off.y), pp.z + off.z);
    } else {
      this.sun.position.set(pp.x + 70, pp.y + 100, pp.z + 40);
    }
    this.sun.target.position.set(pp.x, pp.y, pp.z);

    this.renderer.render(this.scene, this.camera);

    this.frames++;
    if (now - this.fpsT >= 500) {
      this.fps = Math.round(this.frames * 1000 / (now - this.fpsT));
      this.frames = 0;
      this.fpsT = now;
    }
    if (now - this.hudT >= 150) {
      this.hudT = now;
      this.updateHUD();
    }
  }
}
