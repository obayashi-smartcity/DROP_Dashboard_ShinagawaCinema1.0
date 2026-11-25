# 品川国際映画祭2026 × みんまちDROP 流入・利用レポート

みんまちDROP のデータ（GA のアクセス・投稿・登録・アンケート）から、品川国際映画祭2026（shinagawa-cinema-2026）の流入経路と DROP での行動をまとめたダッシュボードです。

- ページ：`ShinagawaCinema2026_DROP_Dashboard.html`（`index.html` はこのページへの転送用）
- ページの数字と本文は **パスワードで暗号化** されています。パスワードを入れたときだけブラウザの中で復号して表示します。
- 元データ（個人情報を含む）は **GitHub に置きません**。手元の `raw` フォルダに置いて、そこから集計します。

## フォルダの中身

| パス | 中身 | GitHub |
|---|---|---|
| `ShinagawaCinema2026_DROP_Dashboard.html` | ダッシュボード本体（暗号化済み） | 上げる |
| `index.html` | 上のページへ転送するだけのページ | 上げる |
| `scripts/drop_aggregate.py` | 集計の手順（流入経路の分け方・投稿の数え方など） | 上げる |
| `scripts/build_dashboard.py` | 元データを探す → 集計 → 暗号化 → HTML に書き出す | 上げる |
| `scripts/assets/` | ページのひな形・本文・図の描画コード・d3（下の表） | 上げる |
| `requirements.txt` | 集計に使う Python のライブラリ | 上げる |
| `raw/` | 元データ（zip）と、公開したくない表示名（`site_names.json`） | **上げない**（`.gitignore`） |

### `scripts/assets/` の中身

| ファイル | 中身 |
|---|---|
| `template.html` | ページの外側（パスワード画面など） |
| `dashboard_body.html` | ページの本文（見出し・要点・説明文。暗号化して埋め込む） |
| `dashboard.css` | 見た目 |
| `shim.js` | claude.ai 版と同じ描画コードを動かすための置き換え（「運営の投稿を含める」の切り替えもここ） |
| `charts.js`・`draw.js`・`draw2.js` | 図の描画 |
| `page.js` | 目次・切り替えのチェックボックスの動き |
| `app.js` | パスワードで復号して表示する、「8. 元データと集計」 |
| `d3.min.js` | 図のライブラリ（d3 v7） |

## ページを作り直すとき

元データの zip を `raw` フォルダに入れて、リポジトリのフォルダで次を実行します（Python 3.10 以上。足りないライブラリは自動で入ります）。

```
python scripts/build_dashboard.py
```

パスワードを2回聞かれます。書き換わった `ShinagawaCinema2026_DROP_Dashboard.html` をコミットして push します。実行の記録は `update_log.txt` に残ります（パスワードは記録しません。GitHub には上がりません）。

### 公開したくない名前（社内サイトなど）

参照元サイトの表示名のうち、社内サイトのドメインなど公開したくないものは、スクリプトには書かずに `raw/site_names.json` に書きます（`raw` フォルダなので GitHub には上がりません）。

```json
{ "社内サイトのドメイン": "表示名" }
```

ページの「8. 元データと集計」に、使ったファイルの件数と指紋（SHA-256）、図ごとの元データの列が出ます。集計表は CSV でダウンロードできます。

## パスワードと暗号化について

- 暗号化：AES-256-GCM。鍵はパスワードから PBKDF2-SHA256（60万回）で作ります。パスワードがなければ、HTML のソースを見ても数字や本文は読めません。
- パスワードを知っている人は誰でも見られます。人ごとに見られなくすることはできません。
- **パスワードは GitHub（README・コミットメッセージ・Issue）には書かないでください。**
- **元データ（`raw` の中身）を一度でも push すると、あとで消してもコミット履歴に残ります。** `.gitignore` で防いでいますが、`git add -f` などで追加しないよう注意してください。

## GitHub Pages で公開する

リポジトリの Settings → Pages で、Branch を `main`、フォルダを `/ (root)` にします。
`https://<アカウント>.github.io/<リポジトリ名>/` を開くと、ダッシュボードに転送されます。

## 集計の設定を変えるとき

- イベント名・集計期間：`scripts/drop_aggregate.py` の先頭（`EVENT`・`START`・`END`・`EVENT_START`）
- 見出しや「要点」の文章は 2026/11/25 時点のデータに合わせて書いています（`scripts/assets/dashboard_body.html`）。数字は自動で入れ替わりますが、データを更新したら文章の内容も確認してください。
- 運営メンバーの投稿は基本は数に入れていません。第1部の「3. 登録と投稿」「4. 投稿の言葉」だけ、ページ上の「運営メンバーの投稿も含める」で含めた数字に切りかえて見比べられます（集計表は `drop_posts`・`drop_hour_all`・`drop_words_all`・`drop_cooc_all`・`drop_poster_origin_all`）。

## ライセンス

- d3（`scripts/assets/d3.min.js`）：ISC License（`scripts/assets/d3.LICENSE.txt`）
