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
| `update_dashboard.bat` | 集計して HTML を作り直す（ダブルクリック） | 上げる |
| `setup.bat` | 最初に1回だけ、必要なライブラリを入れる | 上げる |
| `scripts/drop_aggregate.py` | 集計の手順（流入経路の分け方・投稿の数え方など） | 上げる |
| `scripts/build_dashboard.py` | 元データを探す → 集計 → 暗号化 → HTML に書き出す | 上げる |
| `scripts/assets/` | ページのひな形・図の描画コード・d3 | 上げる |
| `raw/` | 元データ（zip または JSON） | **上げない**（`.gitignore`） |

## はじめに（1回だけ）

1. Python 3.10 以上を入れる（https://www.python.org/ 。インストール時に「Add python.exe to PATH」にチェック）
2. `setup.bat` をダブルクリック（pandas・janome・cryptography が入ります）

## データを更新するとき

1. Google Drive から元データの zip（例：`json-shinagawa-cinema-2026-20261125.zip`）をダウンロードして `raw` フォルダに入れる
   - zip が複数あるときは、いちばん新しいものを使います
2. `update_dashboard.bat` をダブルクリック
   - ページのパスワードを2回入力します（8文字以上。画面には表示されません）
3. 書き換わった `ShinagawaCinema2026_DROP_Dashboard.html` をコミットして GitHub に push する

画面に「新規訪問者 ○人／映画祭の告知経由 ○%…」と出れば成功です。

## 使う元データ（10ファイルのうち7つ）

| ファイル | 中身 |
|---|---|
| `mart_ga.json` | GA のアクセス（初回訪問） |
| `mart_action_drop.json` | DROP の投稿 |
| `mart_user.json` | 映画祭をきっかけに登録したユーザー |
| `mart_user_allevent.json` | DROP の全登録ユーザー（登録経路・属性） |
| `mart_inspiration.json` | いいね |
| `int_event_master.json` | スポット（会場）マスタ |
| `stg_user_persona_note_expanded.json` | 登録時アンケート |

使わないもの：`int_action.json`・`mart_action_stamp.json`（スタンプラリーなしで0件）、`int_user_profile.json`（`mart_user_allevent.json` で代わりがきく）。zip ごと置けば、必要なものだけ使います。

ページの「6. 元データと集計」に、使ったファイルの件数と指紋（SHA-256）、図ごとの元データの列が出ます。集計表は CSV でダウンロードできます。

## パスワードと暗号化について

- 暗号化：AES-256-GCM。鍵はパスワードから PBKDF2-SHA256（60万回）で作ります。パスワードがなければ、HTML のソースを見ても数字や本文は読めません。
- パスワードを知っている人は誰でも見られます。人ごとに見られなくすることはできません。パスワードを変えたいときは `update_dashboard.bat` を実行し直して push します。
- **パスワードは GitHub（README・コミットメッセージ・Issue）には書かないでください。**
- **元データ（`raw` の中身）を一度でも push すると、あとで消してもコミット履歴に残ります。** `.gitignore` で防いでいますが、`git add -f` などで追加しないよう注意してください。

## GitHub Pages で公開する

リポジトリの Settings → Pages で、Branch を `main`、フォルダを `/ (root)` にします。
`https://<アカウント>.github.io/<リポジトリ名>/` を開くと、ダッシュボードに転送されます。

## 集計の設定を変えるとき

- イベント名・集計期間：`scripts/drop_aggregate.py` の先頭（`EVENT`・`START`・`END`・`EVENT_START`）
- 見出しや「要点」の文章は 2026/11/25 時点のデータに合わせて書いています（`scripts/assets/dashboard_body.html`）。数字は自動で入れ替わりますが、データを更新したら文章の内容も確認してください。

## ライセンス

- d3（`scripts/assets/d3.min.js`）：ISC License（`scripts/assets/d3.LICENSE.txt`）
