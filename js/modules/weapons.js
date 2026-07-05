/* ---------------- Weapons: 武器システム（モジュール） ----------------
 * 剣5種・戦斧・弓・レーザー系3種の計10種類の武器を追加する。
 * 作業台（B.CTABLE）を右クリックするとクリエイティブインベントリが開く既存の
 * 仕組みに乗るだけで良いので（game.js doPlace 参照）、武器も他の道具と同様に
 * game.registerItemDef() でアイテム登録するだけでインベントリからクラフト（選択）
 * できるようになる。
 *
 * 攻撃時のダメージは game.js の 'getAttackDamage' フックから供給する
 * （引数: origin, dir, dist＝攻撃対象までの距離。戻り値: ダメージ量 or null）。
 * レーザー系はここで受け取った origin/dir/dist を使って視覚的なビームも描画する。
 * クールダウン（連射制限）も本モジュール内で完結させ、js/core/*.js は変更しない。
 */
const MELEE = 'melee';
const RANGED = 'ranged';

// 武器定義: key, name, type, dmg（ダメージ量）, cooldown（ms, 連続攻撃の最短間隔）
// ranged のみ color（ビーム色）と beamWidth（ビーム太さ）を持つ
const WEAPONS = [
  { key: 'sword_wood',      name: '木の剣 Wooden Sword',            type: MELEE,  dmg: 2,  cooldown: 350 },
  { key: 'sword_stone',     name: '石の剣 Stone Sword',             type: MELEE,  dmg: 3,  cooldown: 350 },
  { key: 'sword_iron',      name: '鉄の剣 Iron Sword',              type: MELEE,  dmg: 4,  cooldown: 320 },
  { key: 'sword_gold',      name: '金の剣 Gold Sword（攻撃間隔が短い）', type: MELEE,  dmg: 3,  cooldown: 220 },
  { key: 'sword_diamond',   name: 'ダイヤモンドの剣 Diamond Sword', type: MELEE,  dmg: 5,  cooldown: 320 },
  { key: 'battle_axe',      name: '戦斧 Battle Axe（重い一撃）',     type: MELEE,  dmg: 7,  cooldown: 600 },
  { key: 'bow',             name: '弓 Bow',                         type: RANGED, dmg: 3,  cooldown: 500, color: 0xf4f0e0, beamWidth: 0.045 },
  { key: 'laser_gun',       name: 'レーザーガン Laser Gun',          type: RANGED, dmg: 4,  cooldown: 260, color: 0xff3030, beamWidth: 0.07 },
  { key: 'plasma_rifle',    name: 'プラズマライフル Plasma Rifle',  type: RANGED, dmg: 6,  cooldown: 420, color: 0x40e0ff, beamWidth: 0.10 },
  { key: 'rocket_launcher', name: 'ロケットランチャー Rocket Launcher（高威力・低連射）', type: RANGED, dmg: 10, cooldown: 900, color: 0xffa030, beamWidth: 0.16 }
];

const BEAM_LIFE = 0.12; // ビーム表示時間（秒）
const AXIS_Y = { x: 0, y: 1, z: 0 };

export default {
  id: 'weapons',
  install(game, cfg) {
    const byKey = {};
    for (const w of WEAPONS) {
      byKey[w.key] = w;
      game.registerItemDef(w.key, { name: w.name, weapon: w });
    }

    const lastFire = {};
    const beams = [];

    function fireBeam(origin, dir, dist, w) {
      const len = Math.max(0.5, Math.min(dist, 90));
      const geo = new THREE.CylinderGeometry(w.beamWidth, w.beamWidth, len, 6, 1, true);
      const mat = new THREE.MeshBasicMaterial({
        color: w.color, transparent: true, opacity: 0.85, depthWrite: false
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        origin.x + dir.x * len / 2,
        origin.y + dir.y * len / 2,
        origin.z + dir.z * len / 2
      );
      const dv = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(AXIS_Y.x, AXIS_Y.y, AXIS_Y.z), dv);
      game.scene.add(mesh);
      beams.push({ mesh, mat, life: BEAM_LIFE });
      game.sound.playLaser();
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
      if (w.type === RANGED) fireBeam(origin, dir, dist, w);
      else game.sound.playSwing();
      return w.dmg;
    });

    game.registerHook('weapons', 'tick', dt => {
      for (let i = beams.length - 1; i >= 0; i--) {
        const b = beams[i];
        b.life -= dt;
        b.mat.opacity = Math.max(0, b.life / BEAM_LIFE) * 0.85;
        if (b.life <= 0) {
          game.scene.remove(b.mesh);
          b.mesh.geometry.dispose();
          b.mat.dispose();
          beams.splice(i, 1);
        }
      }
    });
  }
};
