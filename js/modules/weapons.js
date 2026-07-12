/* ---------------- Weapons: 武器システム（モジュール） ----------------
 * 剣5種・戦斧・弓・レーザー系3種の計10種類の武器を追加する。
 * 作業台（B.CTABLE）を右クリックするとクリエイティブインベントリが開く既存の
 * 仕組みに乗るだけで良いので（game.js doPlace 参照）、武器も他の道具と同様に
 * game.registerItemDef() でアイテム登録するだけでインベントリからクラフト（選択）
 * できるようになる。
 *
 * 攻撃時のダメージは game.js の 'getAttackDamage' フックから供給する
 * （引数: origin, dir, dist＝攻撃対象までの距離。戻り値: ダメージ量 or null）。
 * game.js 側は攻撃対象（エンティティ）がいなくても、狙った方向へ武器を撃つたびに
 * このフックを呼ぶので、ranged武器は何もない方向に撃っても視覚エフェクトが出る。
 * エフェクトは大きく2系統に分かれる:
 *   - beam（レーザーガン/プラズマライフル）: 着弾まで一瞬で届くビーム。
 *     コア＋外側グロー(加算合成)の2層構成で派手さを出し、武器キーごとに1本の
 *     ビームを使い回して連射中は不透明度を維持、発射が止まってからゆっくり
 *     フェードアウトする（＝「ピュッ」ではなく「ビーッ」と出続ける見た目）。
 *   - projectile（弓/ロケットランチャー）: 命中判定自体は着弾点まで一瞬（ヒットスキャン）
 *     だが、見た目上は矢/ロケットが発射位置からゆっくり飛んでいき、着弾点で
 *     閃光が弾ける（ロケットは航跡の煙付き）。
 * クールダウン（連射制限）も本モジュール内で完結させ、js/core/*.js は変更しない。
 */
const MELEE = 'melee';
const RANGED = 'ranged';
const BEAM = 'beam';
const PROJECTILE = 'projectile';

// 武器定義: key, name, type, dmg（ダメージ量）, cooldown（ms, 連続攻撃の最短間隔）
// ranged のみ mode（'beam'|'projectile'）, color, beamWidth（beamのみ）, projSpeed（projectileのみ）を持つ
const WEAPONS = [
  { key: 'sword_wood',      name: '木の剣 Wooden Sword',            type: MELEE,  dmg: 2,  cooldown: 350 },
  { key: 'sword_stone',     name: '石の剣 Stone Sword',             type: MELEE,  dmg: 3,  cooldown: 350 },
  { key: 'sword_iron',      name: '鉄の剣 Iron Sword',              type: MELEE,  dmg: 4,  cooldown: 320 },
  { key: 'sword_gold',      name: '金の剣 Gold Sword（攻撃間隔が短い）', type: MELEE,  dmg: 3,  cooldown: 220 },
  { key: 'sword_diamond',   name: 'ダイヤモンドの剣 Diamond Sword', type: MELEE,  dmg: 5,  cooldown: 320 },
  { key: 'battle_axe',      name: '戦斧 Battle Axe（重い一撃）',     type: MELEE,  dmg: 7,  cooldown: 600 },
  { key: 'bow',             name: '弓 Bow',                         type: RANGED, dmg: 3,  cooldown: 500, mode: PROJECTILE, color: 0xf4f0e0, projSpeed: 30 },
  { key: 'laser_gun',       name: 'レーザーガン Laser Gun',          type: RANGED, dmg: 4,  cooldown: 260, mode: BEAM, color: 0xff3030, beamWidth: 0.08 },
  { key: 'plasma_rifle',    name: 'プラズマライフル Plasma Rifle',  type: RANGED, dmg: 6,  cooldown: 420, mode: BEAM, color: 0x40e0ff, beamWidth: 0.12 },
  { key: 'rocket_launcher', name: 'ロケットランチャー Rocket Launcher（高威力・低連射）', type: RANGED, dmg: 10, cooldown: 900, mode: PROJECTILE, color: 0xffa030, projSpeed: 15 }
];

const BEAM_FADE_DUR = 0.4;   // 発射が止まってからビームが消えるまでのフェード時間（秒）
const BEAM_GRACE_MS = 150;   // 連射がこの猶予内に続けば、ビームを消さずそのまま維持する
const BEAM_CORE_OPACITY = 0.95;
const BEAM_GLOW_OPACITY = 0.45;
const SMOKE_LIFE = 0.45;     // ロケット航跡の煙が消えるまでの時間（秒）
const SMOKE_INTERVAL = 0.04;
const FLASH_LIFE = 0.35;     // 着弾フラッシュが消えるまでの時間（秒）
const UP = { x: 0, y: 1, z: 0 };

export default {
  id: 'weapons',
  install(game, cfg) {
    const byKey = {};
    for (const w of WEAPONS) {
      byKey[w.key] = w;
      game.registerItemDef(w.key, { name: w.name, weapon: w });
    }

    const lastFire = {};
    const activeBeams = {};   // key -> { core, glow, coreMat, glowMat, lastFireAt }
    const projectiles = [];   // 飛翔中の矢/ロケット
    const smokePuffs = [];    // ロケットの航跡煙
    const flashes = [];       // 着弾フラッシュ（beam/projectile共通）
    const beamGeoCache = {};
    let arrowParts = null, rocketParts = null;

    function getBeamGeo(radius) {
      let g = beamGeoCache[radius];
      if (!g) { g = new THREE.CylinderGeometry(radius, radius, 1, 8, 1, true); beamGeoCache[radius] = g; }
      return g;
    }

    function orient(mesh, dv) {
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(UP.x, UP.y, UP.z), dv);
    }

    // 着弾/通過点に一瞬だけ光る球を出す（加算合成でパッと目立たせる）
    function spawnFlash(pos, color, scale) {
      const geo = new THREE.SphereGeometry(0.18 * scale, 8, 8);
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      game.scene.add(mesh);
      flashes.push({ mesh, mat, life: FLASH_LIFE });
    }

    // ---- beam系（レーザーガン/プラズマライフル）----
    function fireBeam(origin, dir, dist, w, now) {
      const len = Math.max(0.5, Math.min(dist, 90));
      let b = activeBeams[w.key];
      if (!b) {
        const coreMat = new THREE.MeshBasicMaterial({
          color: w.color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending
        });
        const glowMat = new THREE.MeshBasicMaterial({
          color: w.color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending
        });
        const core = new THREE.Mesh(getBeamGeo(w.beamWidth), coreMat);
        const glow = new THREE.Mesh(getBeamGeo(w.beamWidth * 2.6), glowMat);
        core.visible = false; glow.visible = false;
        game.scene.add(core); game.scene.add(glow);
        b = activeBeams[w.key] = { core, glow, coreMat, glowMat, lastFireAt: 0 };
      }
      const dv = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
      const cx = origin.x + dir.x * len / 2, cy = origin.y + dir.y * len / 2, cz = origin.z + dir.z * len / 2;
      for (const mesh of [b.core, b.glow]) {
        mesh.visible = true;
        mesh.scale.set(1, len, 1);
        mesh.position.set(cx, cy, cz);
        orient(mesh, dv);
      }
      b.coreMat.opacity = BEAM_CORE_OPACITY;
      b.glowMat.opacity = BEAM_GLOW_OPACITY;
      b.lastFireAt = now;
      spawnFlash({ x: origin.x + dir.x * len, y: origin.y + dir.y * len, z: origin.z + dir.z * len }, w.color, w.beamWidth * 9);
      game.sound.playLaser();
    }

    function tickBeams(dt, now) {
      for (const key in activeBeams) {
        const b = activeBeams[key];
        if (!b.core.visible) continue;
        const w = byKey[key];
        if (now - b.lastFireAt > w.cooldown + BEAM_GRACE_MS) {
          const k = dt / BEAM_FADE_DUR;
          b.coreMat.opacity = Math.max(0, b.coreMat.opacity - BEAM_CORE_OPACITY * k);
          b.glowMat.opacity = Math.max(0, b.glowMat.opacity - BEAM_GLOW_OPACITY * k);
          if (b.coreMat.opacity <= 0) { b.core.visible = false; b.glow.visible = false; }
        }
      }
    }

    // ---- projectile系（弓/ロケットランチャー）----
    function getArrowParts() {
      if (arrowParts) return arrowParts;
      arrowParts = {
        shaftGeo: new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6),
        tipGeo: new THREE.ConeGeometry(0.05, 0.16, 6),
        finGeo: new THREE.BoxGeometry(0.14, 0.03, 0.2),
        glowGeo: new THREE.CylinderGeometry(0.09, 0.02, 0.7, 6),
        shaftMat: new THREE.MeshBasicMaterial({ color: 0x8a5a2b }),
        tipMat: new THREE.MeshBasicMaterial({ color: 0xe8e8e8 }),
        finMat: new THREE.MeshBasicMaterial({ color: 0xf4f0e0 }),
        glowMat: new THREE.MeshBasicMaterial({
          color: 0xfff2c0, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending
        })
      };
      return arrowParts;
    }
    function getRocketParts() {
      if (rocketParts) return rocketParts;
      rocketParts = {
        bodyGeo: new THREE.CylinderGeometry(0.12, 0.12, 0.6, 8),
        noseGeo: new THREE.ConeGeometry(0.12, 0.22, 8),
        flameGeo: new THREE.ConeGeometry(0.11, 0.32, 8),
        bodyMat: new THREE.MeshLambertMaterial({ color: 0x707070 }),
        noseMat: new THREE.MeshBasicMaterial({ color: 0xffa030 }),
        flameMat: new THREE.MeshBasicMaterial({
          color: 0xffcf60, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending
        })
      };
      return rocketParts;
    }
    function buildArrowMesh() {
      const p = getArrowParts();
      const g = new THREE.Group();
      const shaft = new THREE.Mesh(p.shaftGeo, p.shaftMat);
      const tip = new THREE.Mesh(p.tipGeo, p.tipMat);
      tip.position.y = 0.37;
      const fin = new THREE.Mesh(p.finGeo, p.finMat);
      fin.position.y = -0.31;
      const glow = new THREE.Mesh(p.glowGeo, p.glowMat);
      glow.position.y = 0.05;
      g.add(shaft, tip, fin, glow);
      return g;
    }
    function buildRocketMesh() {
      const p = getRocketParts();
      const g = new THREE.Group();
      const body = new THREE.Mesh(p.bodyGeo, p.bodyMat);
      const nose = new THREE.Mesh(p.noseGeo, p.noseMat);
      nose.position.y = 0.41;
      const flame = new THREE.Mesh(p.flameGeo, p.flameMat);
      flame.position.y = -0.44;
      flame.rotation.x = Math.PI;
      g.add(body, nose, flame);
      return g;
    }

    function spawnSmokePuff(pos) {
      const geo = new THREE.SphereGeometry(0.12, 6, 6);
      const mat = new THREE.MeshBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.55 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      game.scene.add(mesh);
      smokePuffs.push({ mesh, mat, life: SMOKE_LIFE });
    }

    function fireProjectile(origin, dir, dist, w) {
      const dv = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
      const travel = Math.max(0.5, Math.min(dist, 60));
      const mesh = w.key === 'rocket_launcher' ? buildRocketMesh() : buildArrowMesh();
      mesh.position.set(origin.x, origin.y, origin.z);
      orient(mesh, dv);
      game.scene.add(mesh);
      projectiles.push({ mesh, dir: dv, speed: w.projSpeed, remain: travel, w, smokeT: 0 });
      if (w.key === 'rocket_launcher') game.sound.playLaser();
      else game.sound.playSwing();
    }

    function tickProjectiles(dt) {
      for (let i = projectiles.length - 1; i >= 0; i--) {
        const pr = projectiles[i];
        const step = Math.min(pr.speed * dt, pr.remain);
        pr.mesh.position.x += pr.dir.x * step;
        pr.mesh.position.y += pr.dir.y * step;
        pr.mesh.position.z += pr.dir.z * step;
        pr.remain -= step;
        if (pr.w.key === 'rocket_launcher') {
          pr.smokeT -= dt;
          if (pr.smokeT <= 0) { spawnSmokePuff(pr.mesh.position); pr.smokeT = SMOKE_INTERVAL; }
        }
        if (pr.remain <= 0) {
          const isRocket = pr.w.key === 'rocket_launcher';
          spawnFlash(pr.mesh.position, pr.w.color, isRocket ? 3.2 : 1.4);
          game.scene.remove(pr.mesh);
          projectiles.splice(i, 1);
        }
      }
      for (let i = smokePuffs.length - 1; i >= 0; i--) {
        const s = smokePuffs[i];
        s.life -= dt;
        if (s.life <= 0) {
          game.scene.remove(s.mesh);
          s.mesh.geometry.dispose();
          s.mat.dispose();
          smokePuffs.splice(i, 1);
          continue;
        }
        s.mat.opacity = Math.max(0, s.life / SMOKE_LIFE) * 0.55;
        s.mesh.scale.setScalar(1 + (1 - s.life / SMOKE_LIFE) * 1.8);
      }
    }

    function tickFlashes(dt) {
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i];
        f.life -= dt;
        if (f.life <= 0) {
          game.scene.remove(f.mesh);
          f.mesh.geometry.dispose();
          f.mat.dispose();
          flashes.splice(i, 1);
          continue;
        }
        const t = 1 - f.life / FLASH_LIFE;
        f.mat.opacity = Math.max(0, 0.9 * (1 - t));
        f.mesh.scale.setScalar(1 + t * 1.6);
      }
    }

    game.registerHook('weapons', 'getAttackDamage', (origin, dir, dist) => {
      const key = game.inventory.current;
      if (typeof key !== 'string') return null;
      const w = byKey[key];
      if (!w) return null;
      const now = performance.now();
      const last = lastFire[w.key] || 0;
      if (now - last < w.cooldown) return 0; // クールダウン中は攻撃不発（ダメージ0）
      lastFire[w.key] = now;
      if (w.type === RANGED) {
        if (w.mode === BEAM) fireBeam(origin, dir, dist, w, now);
        else fireProjectile(origin, dir, dist, w);
      } else game.sound.playSwing();
      return w.dmg;
    });

    game.registerHook('weapons', 'tick', dt => {
      const now = performance.now();
      tickBeams(dt, now);
      tickProjectiles(dt);
      tickFlashes(dt);
    });
  }
};
