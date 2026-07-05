/* ---------------- SoundManager: 効果音（Web Audio APIによる合成、音声ファイル不要） ----------------
 * 効果音ファイルを一切追加せず、Web Audio APIのノイズ/オシレータを組み合わせて
 * その場で音を合成する。よく再生されるアクション（破壊・設置・足音・ジャンプ/着地・
 * UIクリック）ごとに数種類のバリエーションを用意し、再生毎にランダムで選び、
 * さらにピッチをわずかに揺らして単調な繰り返しにならないようにする。
 * ブラウザの自動再生制限があるため、ユーザー操作（クリック等）のタイミングで
 * resume() を呼び、AudioContext を起動/再開する必要がある。
 */
export class SoundManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this._noiseBuf = null;
  }

  // ユーザー操作の直後に呼ぶ（複数回呼んでも安全）
  resume() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
      } catch (e) { this.enabled = false; return; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  _noise() {
    if (this._noiseBuf) return this._noiseBuf;
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * 0.4);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noiseBuf = buf;
    return buf;
  }

  // 汎用パーカッシブ音: ノイズ(フィルタ通過)とオシレータを減衰エンベロープで混ぜて1発生成する
  _hit(o) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const freq = o.freq || 300;
    const decay = o.decay || 0.15;
    const gain = (o.gain || 0.3) * (this.volume == null ? 1 : this.volume);
    const noiseMix = o.noiseMix == null ? 0.5 : o.noiseMix;
    const detune = o.detune || 0;
    const pitch = Math.pow(2, detune / 1200);

    const out = ctx.createGain();
    out.gain.setValueAtTime(gain, t0);
    out.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    out.connect(this.master);

    if (noiseMix > 0) {
      const src = ctx.createBufferSource();
      src.buffer = this._noise();
      const filt = ctx.createBiquadFilter();
      filt.type = o.filterType || 'bandpass';
      filt.frequency.value = (o.filterFreq || 900) * pitch;
      filt.Q.value = o.filterQ == null ? 1 : o.filterQ;
      const g = ctx.createGain();
      g.gain.value = noiseMix;
      src.connect(filt); filt.connect(g); g.connect(out);
      src.start(t0); src.stop(t0 + decay + 0.05);
    }
    if (noiseMix < 1) {
      const osc = ctx.createOscillator();
      osc.type = o.wave || 'sine';
      osc.frequency.setValueAtTime(freq * pitch, t0);
      if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd * pitch, t0 + decay);
      const g = ctx.createGain();
      g.gain.value = 1 - noiseMix;
      osc.connect(g); g.connect(out);
      osc.start(t0); osc.stop(t0 + decay + 0.05);
    }
  }

  // バリエーションの中からランダムに1つ選び、ピッチを少し揺らして再生する
  _playVariant(variants) {
    if (!this.enabled || !this.ctx) return;
    const v = variants[(Math.random() * variants.length) | 0];
    const jitter = (Math.random() - 0.5) * 5; // ±2.5半音程度のランダムなピッチ揺らぎ
    this._hit(Object.assign({}, v, { detune: (v.detune || 0) + jitter }));
  }

  playBreak() { this._playVariant(BREAK_VARIANTS); }
  playPlace() { this._playVariant(PLACE_VARIANTS); }
  playFootstep() { this._playVariant(STEP_VARIANTS); }
  playJump() { this._playVariant(JUMP_VARIANTS); }
  playLand() { this._playVariant(LAND_VARIANTS); }
  playClick() { this._playVariant(CLICK_VARIANTS); }
}

// ---- 各アクションの音バリエーション（周波数・減衰・ノイズ比などを変えて複数用意） ----

const BREAK_VARIANTS = [
  { freq: 180, freqEnd: 90,  decay: 0.14, gain: 0.32, noiseMix: 0.75, filterFreq: 1200, filterQ: 0.8, wave: 'square' },
  { freq: 140, freqEnd: 70,  decay: 0.16, gain: 0.30, noiseMix: 0.80, filterFreq: 800,  filterQ: 1.0, wave: 'square' },
  { freq: 220, freqEnd: 100, decay: 0.12, gain: 0.30, noiseMix: 0.65, filterFreq: 1500, filterQ: 0.7, wave: 'triangle' },
  { freq: 160, freqEnd: 80,  decay: 0.18, gain: 0.34, noiseMix: 0.85, filterFreq: 600,  filterQ: 1.4, wave: 'sawtooth' }
];

const PLACE_VARIANTS = [
  { freq: 130, freqEnd: 160, decay: 0.10, gain: 0.30, noiseMix: 0.55, filterFreq: 500, filterQ: 1.2, wave: 'sine' },
  { freq: 110, freqEnd: 140, decay: 0.12, gain: 0.28, noiseMix: 0.60, filterFreq: 420, filterQ: 1.0, wave: 'triangle' },
  { freq: 150, freqEnd: 180, decay: 0.09, gain: 0.30, noiseMix: 0.50, filterFreq: 650, filterQ: 1.3, wave: 'sine' },
  { freq: 100, freqEnd: 130, decay: 0.13, gain: 0.28, noiseMix: 0.65, filterFreq: 380, filterQ: 0.9, wave: 'square' }
];

const STEP_VARIANTS = [
  { freq: 90,  decay: 0.07, gain: 0.14, noiseMix: 0.85, filterFreq: 700, filterQ: 1.0, wave: 'sine' },
  { freq: 100, decay: 0.06, gain: 0.13, noiseMix: 0.90, filterFreq: 900, filterQ: 1.1, wave: 'sine' },
  { freq: 80,  decay: 0.08, gain: 0.15, noiseMix: 0.80, filterFreq: 600, filterQ: 0.9, wave: 'triangle' },
  { freq: 95,  decay: 0.07, gain: 0.14, noiseMix: 0.88, filterFreq: 800, filterQ: 1.2, wave: 'sine' }
];

const JUMP_VARIANTS = [
  { freq: 260, freqEnd: 420, decay: 0.12, gain: 0.22, noiseMix: 0.25, wave: 'sine' },
  { freq: 240, freqEnd: 380, decay: 0.14, gain: 0.20, noiseMix: 0.30, wave: 'triangle' },
  { freq: 280, freqEnd: 440, decay: 0.11, gain: 0.22, noiseMix: 0.20, wave: 'sine' }
];

const LAND_VARIANTS = [
  { freq: 130, freqEnd: 60, decay: 0.16, gain: 0.30, noiseMix: 0.70, filterFreq: 500, filterQ: 1.0, wave: 'sine' },
  { freq: 110, freqEnd: 55, decay: 0.18, gain: 0.28, noiseMix: 0.75, filterFreq: 420, filterQ: 1.1, wave: 'triangle' },
  { freq: 150, freqEnd: 65, decay: 0.15, gain: 0.30, noiseMix: 0.65, filterFreq: 560, filterQ: 0.9, wave: 'square' }
];

const CLICK_VARIANTS = [
  { freq: 900,  decay: 0.05,  gain: 0.12, noiseMix: 0.20, wave: 'square' },
  { freq: 1100, decay: 0.045, gain: 0.11, noiseMix: 0.15, wave: 'square' },
  { freq: 750,  decay: 0.055, gain: 0.12, noiseMix: 0.25, wave: 'sine' }
];
