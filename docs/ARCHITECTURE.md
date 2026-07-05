# MiniCraft アーキテクチャ・ガイド

このドキュメントは「今後 Claude（AI）が自然言語の指示だけで安全に機能追加できる」ことを目的に書かれている。
新しい依頼が来たら、まずこのファイルを読んで該当パターンに当てはめること。

## 起動方法（重要）

このゲームは `fetch()` で `profiles/*.json` と `worlds/*.json` を読み込む。
そのため **`index.html` をダブルクリックして `file://` で開くと動かない**（ブラウザのCORS制限）。
GitHub Pages などの `http(s)://` 経由で配信すること。ローカル確認は
`python3 -m http.server` などの簡易サーバーで行う。

## ディレクトリ構成

```
index.html          … DOM構造のみ。ロジックは一切書かない
css/style.css        … 見た目
js/main.js           … 起動処理。プロフィール/ワールド選択画面 → Game 生成
js/core/             … エンジン本体（ここは基本的に「壊さない」）
  constants.js        ブロックID・タイル・次元などの定義
  noise.js            乱数・Perlinノイズ
  textures.js         テクスチャアトラス生成（world.json の palette で配色を変える）
  world.js            チャンク生成・地形・レイキャスト（world.json の terrain で挙動を変える）
  player.js           一人称視点・物理
  input.js            キーボード
  gamepad.js           Proコン等の低レベル入力
  inventory.js        クリエイティブインベントリ
  save.js             localStorage 自動セーブ（モジュールの状態も保存する）
  weather.js           天候（雨）
  daynight.js          昼夜サイクル
  events.js            world.json の specialEvents を実行する汎用スケジューラ
  game.js              全体を束ねるオーケストレーター。モジュール接続API を提供する
js/modules/          … 追加機能（ドラゴン・ペット等）。ここが「増える」場所
  registry.js          モジュールの一覧と、profile/world から何を読み込むかの判定
  dragon.js            例1: ボス（world.monsters で出現）
  pet.js               例2: プレイヤー追従の道連れ（profile.enabledFeatures で on/off）
profiles/*.json       … 誰が遊ぶか（名前・スキン色・難易度・使える機能・初期アイテム）
worlds/*.json         … どこで遊ぶか（地形・鉱石・モンスター・天候・昼夜・特殊イベント）
```

**エンジンは1つ。** `profiles/` と `worlds/` の組み合わせで見た目や難易度が変わるだけで、
「お兄ちゃん版」「妹版」のようにコードを分岐・複製することは絶対にしない。

## profiles/*.json の書き方

```json
{
  "id": "brother",
  "extends": "default",
  "playerName": "おにいちゃん",
  "skin": { "color": "#3a7bd5" },
  "difficulty": "normal",
  "enabledFeatures": { "inventory": true, "dragon": true, "pet": true, "shadows": true, "gamepad": true },
  "initialItems": ["WOOD", "STONE", "flint"],
  "pet": { "kind": "cube", "color": "#55c0ff", "name": "ロボわん" }
}
```
- `extends` を指定すると `profiles/default.json` の内容をベースにマージする。
- `enabledFeatures.<モジュールID>` を `false` にすると、そのモジュールが world 側で有効でも
  強制的にオフにできる（保護者的なキルスイッチ）。
- 新しいプロフィールを追加する手順:
  1. `profiles/xxxx.json` を作る
  2. `profiles/manifest.json` の配列に `"xxxx"` を追加する
  3. 以上。コードは一切触らない。

## worlds/*.json の書き方

主なフィールド:
- `terrain.overworld` … 海抜・雪線・バイオーム閾値・木の密度・`ores`（鉱石出現率）
- `terrain.nether` / `terrain.end` … 各次元の地形パラメータ
- `palette` … `grass` / `leaves` / `stone` / `sand` の基準色（[r,g,b]）。地形アルゴリズムは
  共通のまま見た目だけを変えられる
- `monsters` … 出現させる「monster」カテゴリのモジュールID配列（例: `["dragon"]`）
- `weather` / `dayNightCycle` / `specialEvents` / `bgm` … 環境演出
- `gravityMultiplier` / `movement` … 重力・移動速度

新しいワールドを追加する手順:
1. `worlds/xxxx.json` を作る（既存ファイルをコピーして数値を変えるのが早い）
2. `worlds/manifest.json` に `"xxxx"` を追加する
3. 以上。地形生成コード（`js/core/world.js`）は変更しない。

## 鉱石・ブロックの追加手順

新しい鉱石やブロックが欲しい場合（「新しい鉱石を追加して」など）:
1. `js/core/constants.js` の `B` に ID を1つ足す
2. 同ファイルの `TILE` にタイル番号を1つ足す（`ATLAS_COLS*ATLAS_ROWS` の空きが必要。
   足りなくなったら `ATLAS_ROWS` を増やす）
3. `BLOCK_DEFS` に見た目・性質のエントリを足す
4. `js/core/textures.js` の `drawAll()` に、そのタイル用の描画関数呼び出しを1行足す
5. 出現率を変えたい場合は `worlds/*.json` の `terrain.overworld.ores` に
   `{ "id": "新しいID", "chance": 0.02, "minY": 5, "maxY": 60 }` を足すだけ
   （`js/core/world.js` の `pickUnderground()` が自動的に拾う）

## 新しいモジュール（ドラゴン/ペット/ロボット/魔法/レーザー/乗り物/NPC/ダンジョン等）の追加手順

モジュールはゲーム本体を書き換えずに機能を足すための仕組み。`js/modules/dragon.js`（ボス・敵の例）、
`js/modules/pet.js`（プレイヤー追従・見た目だけの例）、`js/modules/weapons.js`（道具アイテム＋攻撃ダメージ
＋視覚エフェクトの例。剣5種・戦斧・弓・レーザー系3種の計10武器）を参考にする。

1. `js/modules/xxxx.js` を作る。中身は次の形の default export ひとつだけ:
   ```js
   export default {
     id: 'xxxx',
     install(game, cfg) {
       // ここで登録するだけ。ゲーム本体(js/core/*.js)は触らない
     }
   };
   ```
2. `install(game, cfg)` の中で使える接続API（`js/core/game.js` が提供）:
   - `game.registerItemDef(key, {name})` … クリエイティブインベントリに道具アイテムを追加
   - `game.registerItemHandler(key, (hit, targetBlockId) => {...})` … その道具を右クリックした時の処理
   - `game.registerHook(moduleId, 'tick', dt => {...})` … 毎フレーム呼ばれる
   - `game.registerHook(moduleId, 'onEnterDim', dim => { ... return '追加メッセージ文字列 or null'; })`
     … 次元切替のたびに呼ばれる（オーバーワールド/ネザー/エンドのどれに入ったかは `dim` で判定）
   - `game.registerHook(moduleId, 'getAttackCandidates', (origin, dir, maxDist) => [{dist, onHit(dmg)}])`
     … 左クリック/ZRで殴った時に、ブロックより優先して攻撃されるエンティティを返す。
     `onHit` には攻撃側のダメージ量（下記 `getAttackDamage` 参照。省略時は1扱い）が渡る
   - `game.registerHook(moduleId, 'getAttackDamage', (origin, dir, dist) => ダメージ量 or null)`
     … 攻撃時に現在選択中の道具（武器）からダメージ量を算出する。`js/modules/weapons.js` の例を参照。
     `dist` は対象までの距離、`origin`/`dir` はレーザー等の視覚エフェクトを描くのに使う。
     どのモジュールも null を返した場合は既定値1（素手と同じ）になる
   - `game.registerHook(moduleId, 'hudLine', () => '文字列 or null')` … HUDに1行追加表示
   - `game.registerHook(moduleId, 'serialize', () => state)` /
     `game.registerHook(moduleId, 'deserialize', state => {...})` … セーブ/ロード対応
   - モジュール専用のオブジェクトは `game.scene`（全次元共通）か
     `game.worlds[DIM.OVER/NETHER/END].group`（その次元だけ）に add する
3. `js/modules/registry.js` の `MODULE_LOADERS` に1行追加する:
   ```js
   xxxx: { category: 'monster' /* または 'feature' */, load: () => import('./xxxx.js') }
   ```
   - `category: 'monster'` … `worlds/*.json` の `monsters` 配列に id を書くと出現する
   - `category: 'feature'` … `profiles/*.json` の `enabledFeatures.<id>` を true にすると有効になる
4. 必要なら `resolveModules()` 内の `cfgFor()` に、そのモジュールへ渡す設定
   （例: 難易度やプロフィールの色）を1行足す

これで「ドラゴンを追加して」「ペットを追加して」のような依頼は、既存の `js/core/*.js` を
一切変更せずに `js/modules/` にファイルを1つ足すだけで完結する。

## 依頼を受けたときの判断フロー

1. 「新しいブロック/鉱石」→ 上の「鉱石・ブロックの追加手順」
2. 「新しいモンスター/ボス/ペット/乗り物/NPC/ダンジョン等」→ 上の「新しいモジュールの追加手順」
3. 「新しいワールド（テーマ）」→ `worlds/*.json` を1つ追加
4. 「新しいプレイヤー/プロフィール」→ `profiles/*.json` を1つ追加
5. 「既存の見た目や難易度の調整」→ まず JSON の数値変更で済まないか検討する
   （地形パラメータ・パレット・重力・移動速度・難易度は全て設定値）
6. 上記に当てはまらない根本的な変更のみ `js/core/*.js` を編集する。編集する場合も
   既存のメソッド構造・フック名は変えない（他のモジュールが依存しているため）

## 巨大オープンワールド生成エンジン（Phase1）

`worlds/*.json` に `"engine": "openworld"` を指定したワールドだけ、新しい生成エンジン
（`js/core/worldgen.js` の `OpenWorldGen`）が有効になる。指定が無い従来ワールドは一切影響を
受けず、これまでどおりの地形生成パスで動く（`World.gen === null` で分岐）。

- **仕組み**: シード値から用途別の独立ノイズ層（Height / Temperature / Humidity /
  BiomeWeight / River / Cave）を派生させ、Perlin(fBm) と Ridged(尾根) を合成して連続した
  巨大地形を作る。35種類のバイオームを気候×標高×稀少マスクで決定し、草・葉・水の色は
  気候から連続補間するので境界が自然につながる。
- **接続点**: `config-loader.js` が `engine==="openworld"` のとき `OpenWorldGen` を生成し、
  `game.js` がオーバーワールド次元の `World` にだけ `opts.gen` として渡す。`world.js` は
  `this.gen` があるときだけ `generateOpen()` / `plantTreesOpen()` / 洞窟 / 色ティントを使う。
- **大規模対応**: `worldSize` は 8192 以上に拡張可能。従来の平坦な列キャッシュ配列
  （512²前提）は `gen` 有効時には確保せず、`OpenWorldGen` 側が列単位でキャッシュする。
- **パラメータ**: `terrain.overworld.openworld` に `heightAmp` / `mountainAmp` /
  `continentFreq` を置くと地形の起伏・山の高さ・大陸スケールを調整できる。
- **自然生成・ランドマーク（Phase2）**: `worldgen.js` の `landmarkCell()` / `undergroundCell()`
  がセル単位で決定的にフィーチャの種類・位置を返し、`world.js` の `placeFeatures()` と各
  `stamp*()` がチャンクに重なる範囲だけを書き込む（木・ネザー要塞と同じ分割描画方式）。
  地表ランドマークは `LM`（既定176ブロック）セルごとに必ず1つ配置され、
  何もない景色が500〜1000ブロック続かないことを保証する。
  - 地表: 火山 / 巨大樹 / 巨大キノコ / 浮島 / 天然橋(アーチ) / 塔・遺跡 / 滝 / 温泉 / 離島
  - 地下: 地下湖 / 巨大空洞 / 地下神殿(宝つき)。峡谷は `canyonStrength()` で `generateOpen()` が直接削る。
  - 追加・調整はすべて `worldgen.js`（記述子）と `world.js` の `stamp*`（見た目）で完結。
- **今後（Phase2残り／Phase3以降）**: 虹・オーロラ等の空エフェクト（描画系）、都市生成、建物内部生成。
  いずれも従来エンジンには触れず拡張する。

## セーブデータ

- 保存キーは `profile.id` と `world.id` の組み合わせ（`minicraft_<profile>_<world>_v1`）。
  プロフィール×ワールドごとに別々のセーブになる。
- モジュールの状態は `SaveManager` が `game.collectSerialize()` / `game.runDeserialize()` 経由で
  自動的に保存・復元する。モジュール側は `serialize`/`deserialize` フックを登録するだけでよい。
