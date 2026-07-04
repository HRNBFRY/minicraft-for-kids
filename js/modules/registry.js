/* ---------------- モジュールレジストリ ----------------
 * 新しいモジュール（ペット/ロボット/魔法/レーザー/乗り物/NPC/ダンジョン等）を追加するときは
 *   1) js/modules/xxx.js を作成し、{ id, install(game, cfg) } を default export する
 *   2) 下の MODULE_LOADERS に一行足す
 *   3) worlds/*.json の "monsters"（敵/モブ系）や profiles/*.json の enabledFeatures
 *      （プレイヤー機能系）で on/off を切り替える
 * だけでよい。js/core/*.js は変更しない。
 */
// category: 'monster'  -> worlds/*.json の "monsters" 配列で出現を制御
// category: 'feature'  -> profiles/*.json の enabledFeatures で on/off を制御
export const MODULE_LOADERS = {
  dragon: { category: 'monster', load: () => import('./dragon.js') },
  pet:    { category: 'feature', load: () => import('./pet.js') }
};

// profile / world の設定から「今回インストールするモジュール一覧」を決定する。
// どちらのカテゴリでも profiles の enabledFeatures.<id> === false は常に優先して除外できる
// （＝保護者側のプロフィール設定で特定モジュールを止められる）。
export async function resolveModules(profile, world) {
  const wanted = new Set();
  const feats = profile.enabledFeatures || {};
  for (const m of (world.monsters || [])) {
    if (MODULE_LOADERS[m] && MODULE_LOADERS[m].category === 'monster') wanted.add(m);
  }
  for (const key in MODULE_LOADERS) {
    if (MODULE_LOADERS[key].category === 'feature' && feats[key]) wanted.add(key);
  }
  for (const key of Array.from(wanted)) {
    if (feats[key] === false) wanted.delete(key);
  }

  const cfgFor = (id) => {
    if (id === 'dragon') return { difficulty: profile.difficulty };
    if (id === 'pet') return profile.pet || {};
    return {};
  };

  const out = [];
  for (const id of wanted) {
    const entry = MODULE_LOADERS[id];
    if (!entry) { console.warn('unknown module in config:', id); continue; }
    const mod = await entry.load();
    out.push({ id, install: mod.default.install, cfg: cfgFor(id) });
  }
  return out;
}
