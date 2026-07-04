import { DIM } from '../core/constants.js';

/* ---------------- EnderDragon: エンダードラゴン（ボスモジュール） ----------------
 * このファイルはゲーム本体を書き換えずに追加された「モジュール」の実例。
 * 新しいボス/モブを追加するときはこのファイルをコピーして
 *  - install(game, cfg) の中で game.registerHook(...) / registerItemDef(...) する
 *  - modules/registry.js にエントリを足す
 *  - world.json の "monsters" 配列に id を書く
 * だけで完成する（エンジン側 js/core/*.js は一切変更しない）。
 */
class EnderDragon {
  constructor(world, cx, cy, cz, radius, maxHp) {
    this.world = world;
    this.center = new THREE.Vector3(cx, cy, cz);
    this.radius = radius || 26;
    this.maxHp = maxHp || 20;
    this.hp = this.maxHp;
    this.t = Math.random() * 100;
    this.ft = 0;
    this.dead = false;
    this.deathT = 0;
    this.flash = 0;
    this.buildMesh();
    world.group.add(this.group);
  }
  buildMesh() {
    this.matBody = new THREE.MeshLambertMaterial({ color: 0x1c1c24 });
    this.matDark = new THREE.MeshLambertMaterial({ color: 0x101016 });
    const matEye = new THREE.MeshLambertMaterial({ color: 0xcc55ff, emissive: 0x8822cc });
    const g = new THREE.Group();
    const box = (w, h, d, x, y, z, m) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      g.add(mesh);
      return mesh;
    };
    box(2.2, 1.6, 5.0, 0, 0, 0, this.matBody);
    box(1.3, 1.1, 1.8, 0, 0.4, -3.4, this.matBody);
    box(0.2, 0.2, 0.55, -0.4, 0.75, -4.15, matEye);
    box(0.2, 0.2, 0.55, 0.4, 0.75, -4.15, matEye);
    box(0.5, 0.5, 2.2, 0, 0.1, 3.4, this.matDark);
    box(0.35, 0.35, 2.0, 0, 0.1, 5.4, this.matDark);
    this.wingL = new THREE.Group();
    this.wingR = new THREE.Group();
    const wl = new THREE.Mesh(new THREE.BoxGeometry(5, 0.14, 2.8), this.matDark);
    wl.position.set(-2.6, 0, 0); wl.castShadow = true;
    const wr = new THREE.Mesh(new THREE.BoxGeometry(5, 0.14, 2.8), this.matDark);
    wr.position.set(2.6, 0, 0); wr.castShadow = true;
    this.wingL.add(wl); this.wingR.add(wr);
    this.wingL.position.set(-1, 0.7, -0.5);
    this.wingR.position.set(1, 0.7, -0.5);
    g.add(this.wingL); g.add(this.wingR);
    this.group = g;
  }
  update(dt) {
    if (this.dead) {
      this.deathT += dt;
      this.group.rotation.y += dt * 6;
      this.group.position.y -= dt * 7;
      const s = Math.max(0.05, 1 - this.deathT * 0.35);
      this.group.scale.set(s, s, s);
      return this.deathT < 2.6;
    }
    this.t += dt * 0.22;
    this.ft += dt;
    const x = this.center.x + Math.cos(this.t) * this.radius;
    const z = this.center.z + Math.sin(this.t) * this.radius;
    const y = this.center.y + Math.sin(this.t * 2.3) * 4;
    this.group.position.set(x, y, z);
    const vx = -Math.sin(this.t), vz = Math.cos(this.t);
    this.group.rotation.y = Math.atan2(-vx, -vz);
    const flap = Math.sin(this.ft * 7) * 0.55;
    this.wingL.rotation.z = flap;
    this.wingR.rotation.z = -flap;
    if (this.flash > 0) {
      this.flash -= dt;
      if (this.flash <= 0) {
        this.matBody.color.setHex(0x1c1c24);
        this.matDark.color.setHex(0x101016);
      }
    }
    return true;
  }
  hit() {
    if (this.dead) return;
    this.hp--;
    this.flash = 0.18;
    this.matBody.color.setHex(0xaa2222);
    this.matDark.color.setHex(0x881818);
    if (this.hp <= 0) { this.dead = true; this.deathT = 0; }
  }
  intersectRay(o, d, maxDist) {
    const c = this.group.position, r = 3.4;
    const ox = c.x - o.x, oy = c.y - o.y, oz = c.z - o.z;
    const tca = ox * d.x + oy * d.y + oz * d.z;
    if (tca < 0 || tca > maxDist) return -1;
    const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
    return d2 <= r * r ? tca : -1;
  }
  dispose() {
    this.world.group.remove(this.group);
    this.group.traverse(o => {
      if (o.isMesh) { o.geometry.dispose(); if (o.material.dispose) o.material.dispose(); }
    });
  }
}

const DIFFICULTY_HP = { easy: 12, normal: 20, hard: 30 };

export default {
  id: 'dragon',
  install(game, cfg) {
    const maxHp = DIFFICULTY_HP[(cfg && cfg.difficulty) || 'normal'] || 20;
    const byDim = { [DIM.OVER]: [], [DIM.NETHER]: [], [DIM.END]: [] };
    let defeated = false;

    function spawn(dim, x, y, z, radius) {
      byDim[dim].push(new EnderDragon(game.worlds[dim], x, y, z, radius, maxHp));
    }

    // スポーンエッグ（道具アイテム）: どの次元でも自由に戦って遊べるおまけ
    game.registerItemDef('egg', { name: 'スポーンエッグ（エンダードラゴン）' });
    game.registerItemHandler('egg', (h) => {
      spawn(game.dim, h.x + h.nx + 0.5, h.y + h.ny + 10, h.z + h.nz + 0.5, 14);
      game.showMsg('エンダードラゴンが出現！（クリック / ZR で攻撃）');
    });

    // ジ・エンドに入ったら（未撃破なら）ボスを配置し、HUD向けの追伸メッセージを返す
    game.registerHook('dragon', 'onEnterDim', dim => {
      if (dim !== DIM.END) return null;
      if (!defeated && byDim[DIM.END].length === 0) spawn(DIM.END, 256, 80, 256, 26);
      return defeated ? null : '　エンダードラゴンを倒せ！';
    });

    // 現在の次元にいるドラゴンだけ更新（他次元は非表示なので静止でよい）
    game.registerHook('dragon', 'tick', dt => {
      const arr = byDim[game.dim];
      if (!arr) return;
      for (let i = arr.length - 1; i >= 0; i--) {
        if (!arr[i].update(dt)) {
          const dr = arr[i];
          dr.dispose();
          arr.splice(i, 1);
          if (game.dim === DIM.END && !defeated) {
            defeated = true;
            game.spawnExitPortal(DIM.END, 256, 256);
            game.showMsg('エンダードラゴンを討伐した！　島の中心に帰還ポータルが現れた', 6000);
            game.saveMgr.save();
          } else {
            game.showMsg('エンダードラゴンを倒した！');
          }
        }
      }
    });

    // 攻撃判定（クリック/ZRで一番近いエンティティを優先的に殴る）
    game.registerHook('dragon', 'getAttackCandidates', (origin, dir, maxDist) => {
      const arr = byDim[game.dim];
      if (!arr || !arr.length) return null;
      const out = [];
      for (const dr of arr) {
        if (dr.dead) continue;
        const t = dr.intersectRay(origin, dir, maxDist);
        if (t >= 0) out.push({ dist: t, onHit: () => dr.hit() });
      }
      return out;
    });

    game.registerHook('dragon', 'hudLine', () => {
      const arr = byDim[game.dim];
      if (arr && arr.length && !arr[0].dead) return 'エンダードラゴン HP: ' + arr[0].hp + ' / ' + arr[0].maxHp;
      return null;
    });

    game.registerHook('dragon', 'serialize', () => ({ defeated }));
    game.registerHook('dragon', 'deserialize', state => { defeated = !!(state && state.defeated); });
  }
};
