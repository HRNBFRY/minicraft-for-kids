/* ---------------- Pet: プレイヤーについてくる簡単なペット（モジュール実例） ----------------
 * profiles/*.json の enabledFeatures.pet と "pet" 設定（色・名前）だけで見た目が変わる。
 * 新しいペットの種類を増やしたい場合は buildMesh() に kind の分岐を足すだけでよい。
 */
function buildMesh(kind, color) {
  const mat = new THREE.MeshLambertMaterial({ color: color || '#ffcc00' });
  let geo;
  if (kind === 'sphere') geo = new THREE.SphereGeometry(0.35, 10, 10);
  else geo = new THREE.BoxGeometry(0.55, 0.55, 0.55); // 既定: cube
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

export default {
  id: 'pet',
  install(game, cfg) {
    const conf = cfg || {};
    const mesh = buildMesh(conf.kind, conf.color);
    game.scene.add(mesh);
    let t = 0;
    const pos = new THREE.Vector3(game.player.pos.x, game.player.pos.y, game.player.pos.z);
    mesh.position.copy(pos);

    game.registerHook('pet', 'tick', dt => {
      t += dt;
      const p = game.player.pos, yaw = game.player.yaw;
      const tx = p.x + Math.sin(yaw) * 1.8;
      const tz = p.z + Math.cos(yaw) * 1.8;
      const ty = p.y + 0.4 + Math.sin(t * 2.4) * 0.12;
      const k = 1 - Math.exp(-4 * dt);
      pos.x += (tx - pos.x) * k;
      pos.y += (ty - pos.y) * k;
      pos.z += (tz - pos.z) * k;
      mesh.position.copy(pos);
      mesh.rotation.y += dt * 1.2;
    });

    game.registerHook('pet', 'hudLine', () =>
      conf.name ? '🐾 ' + conf.name + ' がついてきている' : null
    );
  }
};
