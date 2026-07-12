# minecraft-for-kids

ブラウザで動くマイクラ風ゲーム（Three.js製の静的サイト）。ビルド不要、`js/` `css/` `index.html` をそのまま配信するだけで動く。

## ローカルで試す

`fetch()` で `worlds/*.json` などを読み込むため、`index.html` を直接ダブルクリック（`file://`）では動かない。ローカルサーバー経由で開くこと。

```bash
# リポジトリのルートで実行
python3 -m http.server 8765
```

起動後、ブラウザで [http://localhost:8765](http://localhost:8765) を開く。止めるには `Ctrl+C`。

（Claude Codeのプレビュー機能を使う場合は `.claude/launch.json` に同じ設定を登録済みなので、そちらから起動してもよい）

### 同じWi-FiのiPhone/iPadから開く

`python3 -m http.server` はMac上の全ネットワークインターフェースで待ち受けるので、追加設定なしで同じWi-Fiの他端末からアクセスできる。MacのローカルIPを調べてiPhone/iPadのSafariでそのIP宛に開けばよい。

```bash
# MacのWi-FiのIPアドレスを調べる
ipconfig getifaddr en0
```

表示された値（例: `192.168.10.121`）を使って、iPhone/iPadのSafariで次を開く（ポート番号も忘れずに）。

```
http://192.168.10.121:8765
```

うまく開けない場合は次を確認する。

- Macとタブレット/スマホが**同じWi-Fiネットワーク**に接続されている（ゲスト用Wi-Fiなど端末間通信が遮断される設定は不可）。
- ローカルサーバー（`python3 -m http.server`）がMac側で起動したままになっている。
- 初回起動時にmacOSのファイアウォールが確認ダイアログを出したら「許可」を選ぶ。すでに拒否してしまった場合は システム設定 → ネットワーク → ファイアウォール → オプション から `python3` の着信接続を許可する。

## GitHubにアップロードする（push）

このリポジトリは `main` ブランチへの push で GitHub Pages に自動デプロイされる。

```bash
# 1. 作業前に必ず最新を取得（CLAUDE.mdのルール）
git pull

# 2. 変更内容を確認
git status
git diff

# 3. 変更をコミット
git add <変更したファイル>
git commit -m "コミットメッセージ"

# 4. GitHubにアップロード
git push
```

`git push` が拒否された場合（リモートに新しいコミットがある等）は、`git push --force` は使わずまず `git pull` して状況を確認する。

## その他、知っておくと便利なコマンド

```bash
# 変更されたファイル一覧・差分を確認
git status
git diff

# コミット履歴を確認
git log --oneline -10

# 直前のコミット内容を取り消さずに、変更を一時退避する
git stash
git stash pop   # 退避した変更を戻す

# リモートの最新状態だけ取得して差分を見る（pullはしない）
git fetch origin
git log HEAD..origin/main --oneline
```

## 注意事項（重要）

- `worlds/`・`profiles/` はユーザーのセーブデータ。削除・初期化・上書きしない。
- 修正対象はゲーム本体（`js/`, `css/`, `index.html` など）のみ。
- 詳しい開発ルールは [`CLAUDE.md`](CLAUDE.md) を参照。
