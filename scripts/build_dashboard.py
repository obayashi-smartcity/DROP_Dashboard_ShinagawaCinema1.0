# 品川国際映画祭2026 × みんまちDROP ダッシュボードを作る
#   1. raw フォルダの元データ（zip または JSON）を読む
#   2. drop_aggregate.py で集計する
#   3. 集計結果とページ本文をパスワードで暗号化（AES-256-GCM、鍵は PBKDF2-SHA256 で作る）
#   4. ShinagawaCinema2026_DROP_Dashboard.html に書き出す
# 使い方：update_dashboard.bat をダブルクリック（または python scripts/build_dashboard.py）
# パスワードは実行時に聞かれる。環境変数 DASHBOARD_PASSWORD があればそれを使う。
import base64, datetime, getpass, glob, hashlib, json, os, sys, tempfile, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "raw")
ASSETS = os.path.join(HERE, "assets")
OUTPUT = os.path.join(ROOT, "ShinagawaCinema2026_DROP_Dashboard.html")
ITERATIONS = 600_000

sys.path.insert(0, HERE)
import drop_aggregate as agg  # noqa: E402

# 使う元データ（10ファイルのうち7つ）と中身の説明
INPUT_FILES = {
    "mart_ga.json": "GAのアクセス（初回訪問）",
    "mart_action_drop.json": "DROPの投稿",
    "mart_user.json": "映画祭をきっかけに登録したユーザー",
    "mart_user_allevent.json": "DROPの全登録ユーザー（登録経路・属性）",
    "mart_inspiration.json": "いいね",
    "int_event_master.json": "スポット（会場）マスタ",
    "stg_user_persona_note_expanded.json": "登録時アンケート",
}

# 集計表ごとの「使っている図」と「元データの列」
SOURCES = {
    "kpi": ("主要な数字", "上のカード・要点・見出しの数字", "mart_ga（user_pseudo_id・campaign・utm_source・page_referrer ほか）、mart_action_drop（account_id・post_dated_at・event_id・word1〜5）、mart_user（account_id）、mart_inspiration（inspiration_id）"),
    "ga_group": ("流入の大分類", "1. 内訳の帯グラフ", "mart_ga：campaign・utm_source・medium・source・page_location・page_referrer"),
    "ga_channel": ("流入経路別", "1. 経路別ランキング・告知期間と開催期間の比較、5. 流入経路の一覧", "mart_ga：campaign・utm_source・medium・source・page_location・page_referrer・event_date_jp"),
    "ga_site": ("参照元サイト別", "1. 参照元サイト別", "mart_ga：page_referrer（ドメイン）"),
    "ga_daily": ("日別の新規訪問者", "2. 日別の新規訪問者", "mart_ga：event_date_jp・campaign・utm_source"),
    "ga_daily_channel": ("流入経路×日別", "2. 経路ごとの日別・詳細データ", "mart_ga：event_date_jp と流入経路"),
    "ga_landing": ("最初に開いたページ", "5. 着地ページ", "mart_ga：page_location"),
    "drop_daily": ("日別の投稿と新規登録", "3. 開催期間の日別投稿数と新規登録", "mart_action_drop：post_dated_at・is_operation_member、mart_user：created_at"),
    "drop_poster_origin": ("投稿者の登録経路", "3. 投稿者・投稿の内訳", "mart_action_drop：account_id、mart_user_allevent：inflow_event_id・created_at"),
    "drop_spot": ("スポット別の投稿", "3. スポット別の投稿数", "mart_action_drop：event_id、int_event_master：event_id・event_name"),
    "drop_hour": ("投稿の時刻", "3. 投稿の時刻", "mart_action_drop：post_dated_at"),
    "drop_age": ("年代", "3. 投稿者・新規登録者の属性", "mart_user_allevent：age_group"),
    "drop_gender": ("性別", "3. 投稿者・新規登録者の属性", "mart_user_allevent：gender"),
    "drop_words": ("投稿に出てくる言葉", "4. 投稿の中身", "mart_action_drop：word1〜word5（形態素解析で名詞を抽出）"),
    "survey_codes": ("登録時アンケート", "5. 登録時アンケート", "stg_user_persona_note_expanded：questionnaire_q1・q2"),
}


def find_input():
    """raw フォルダから元データを探す。zip があれば一番新しいもの、なければ JSON が入ったフォルダ。"""
    if not os.path.isdir(RAW):
        sys.exit(f"raw フォルダがありません：{RAW}")
    zips = sorted(glob.glob(os.path.join(RAW, "*.zip")), key=os.path.getmtime)
    if zips:
        z = zips[-1]
        tmp = tempfile.mkdtemp(prefix="drop_")
        with zipfile.ZipFile(z) as f:
            f.extractall(tmp)
        base, label = tmp, os.path.basename(z)
    else:
        base, label = RAW, "raw フォルダの JSON"
    for d, _, files in os.walk(base):
        if "mart_ga.json" in files:
            missing = [n for n in INPUT_FILES if n not in files]
            if missing:
                sys.exit("元データが足りません：" + "、".join(missing))
            return d, label
    sys.exit("raw フォルダに元データ（zip または mart_ga.json などの JSON）が見つかりません。")


def describe_inputs(src):
    rows = []
    for name, about in INPUT_FILES.items():
        path = os.path.join(src, name)
        raw = open(path, "rb").read()
        try:
            o = json.loads(raw.decode("utf-8-sig"))
            n = o.get("record_count", len(o.get("records", []))) if isinstance(o, dict) else len(o)
        except Exception:
            n = None
        rows.append({"file": name, "about": about, "records": n, "sha256_12": hashlib.sha256(raw).hexdigest()[:12]})
    return rows


def ask_password():
    pw = os.environ.get("DASHBOARD_PASSWORD")
    if pw:
        return pw
    while True:
        pw = getpass.getpass("ページのパスワードを入力してください（画面には表示されません）：")
        if len(pw) < 8:
            print("8文字以上にしてください。")
            continue
        if getpass.getpass("確認のため、もう一度入力してください：") != pw:
            print("一致しませんでした。もう一度お願いします。")
            continue
        return pw


def encrypt(obj, password):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERATIONS).derive(password.encode("utf-8"))
    data = AESGCM(key).encrypt(iv, json.dumps(obj, ensure_ascii=False).encode("utf-8"), None)
    b = lambda x: base64.b64encode(x).decode("ascii")
    return {"alg": "AES-256-GCM / PBKDF2-SHA256", "iterations": ITERATIONS, "salt": b(salt), "iv": b(iv), "data": b(data)}


def read(name):
    return open(os.path.join(ASSETS, name), encoding="utf-8").read()


def script_safe(text):
    return text.replace("</", "<\\/")


def main():
    src, label = find_input()
    print(f"元データ：{label}")
    results, _ = agg.build(src)
    inputs = describe_inputs(src)
    results["_inputs"] = inputs
    results["_sources"] = [
        {"table": k, "title": t, "used_in": u, "columns": c, "rows": len(results.get(k, []))}
        for k, (t, u, c) in SOURCES.items()
    ]
    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9)))
    manifest = {
        "generated_at": now.strftime("%Y-%m-%d %H:%M"),
        "input": label,
        "event": agg.EVENT,
        "period": f"{agg.START}〜{agg.END}",
        "files": [{"file": r["file"], "sha256_12": r["sha256_12"]} for r in inputs],
    }
    password = ask_password()
    payload = {"body": read("dashboard_body.html"), "datasets": results}
    enc = encrypt(payload, password)
    html = read("template.html")
    for key, value in [
        ("/*__DASHBOARD_CSS__*/", read("dashboard.css")),
        ("/*__MANIFEST__*/", script_safe(json.dumps(manifest, ensure_ascii=False))),
        ("/*__ENCRYPTED__*/", json.dumps(enc)),
        ("/*__D3__*/", read("d3.min.js")),
        ("/*__SHIM__*/", read("shim.js")),
        ("/*__CHARTS__*/", read("charts.js")),
        ("/*__DRAW__*/", read("draw.js")),
        ("/*__APP__*/", read("app.js")),
    ]:
        assert key in html, key
        html = html.replace(key, value, 1)
    with open(OUTPUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)
    k = results["kpi"][0]
    print(f"作成しました：{os.path.basename(OUTPUT)}（{len(html.encode('utf-8')) // 1024} KB）")
    print(f"  新規訪問者 {k['ga_users']}人／映画祭の告知経由 {k['ga_cinema_pct']}%／新規登録 {k['reg_cinema']}人／一般投稿 {k['posts_general']}件")
    print("GitHub に上げるのはこの HTML とスクリプトだけです（raw フォルダは上がりません）。")


if __name__ == "__main__":
    main()
