# 品川国際映画祭2026 × みんまちDROP ダッシュボードを作る
#   1. raw フォルダの元データ（zip または JSON）を読む
#   2. drop_aggregate.py で集計する
#   3. 集計結果とページ本文をパスワードで暗号化（AES-256-GCM、鍵は PBKDF2-SHA256 で作る）
#   4. ShinagawaCinema2026_DROP_Dashboard.html に書き出す
# 使い方：リポジトリのフォルダで python scripts/build_dashboard.py
# パスワードは実行時に聞かれる。環境変数 DASHBOARD_PASSWORD があればそれを使う。
# 必要なライブラリ（pandas・janome・cryptography）がなければ、最初に自動で入れる。
# 画面に出したメッセージとエラーの内容は update_log.txt にも残す（パスワードは残さない。GitHub には上げない）。
import base64, datetime, getpass, glob, hashlib, importlib, importlib.util, json, os, platform, site, subprocess, sys, tempfile, traceback, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "raw")
ASSETS = os.path.join(HERE, "assets")
OUTPUT = os.path.join(ROOT, "ShinagawaCinema2026_DROP_Dashboard.html")
ITERATIONS = 600_000
LOG = os.path.join(ROOT, "update_log.txt")
REQUIRED = ["pandas", "janome", "cryptography", "openpyxl"]   # import 名と pip のパッケージ名が同じもの


class Tee:
    """画面に出す文字を update_log.txt にも書く。"""
    def __init__(self, stream, log):
        self.stream, self.log = stream, log
    def write(self, s):
        self.stream.write(s)
        self.log.write(s)
        self.log.flush()
    def flush(self):
        self.stream.flush()
    def __getattr__(self, name):   # encoding・isatty などは画面側のものを使う
        return getattr(self.stream, name)


def missing_packages():
    importlib.invalidate_caches()
    return [m for m in REQUIRED if importlib.util.find_spec(m) is None]


def ensure_packages():
    """必要なライブラリがなければ pip で入れる。"""
    missing = missing_packages()
    if not missing:
        return
    print("必要なライブラリ（" + "・".join(missing) + "）が入っていないので、いま入れます。1〜3分かかります。")
    req = os.path.join(ROOT, "requirements.txt")
    for extra in ([], ["--user"]):
        r = subprocess.run([sys.executable, "-m", "pip", "install", "--disable-pip-version-check", *extra, "-r", req],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
        print(r.stdout[-3000:])
        if extra:
            site.addsitedir(site.getusersitepackages())   # 初めて --user で入れたときの置き場所を読みにいく
        if not missing_packages():
            print("ライブラリを入れました。続けます。")
            return
    raise RuntimeError("NO_PACKAGES:" + "・".join(missing_packages()))

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

# 集計表ごとの「使っている図」と「元データの列」（番号はページの節）
SOURCES = {
    "kpi": ("主要な数字", "要点・各節の見出しと説明文の数字", "mart_ga（user_pseudo_id・campaign・utm_source・page_referrer ほか）、mart_action_drop（account_id・post_dated_at・event_id・image_file_path）、mart_user（account_id）、mart_inspiration（inspiration_id）"),
    "ga_group": ("流入の大分類", "要点（新規訪問者の内訳）、1. の説明文", "mart_ga：campaign・utm_source・medium・source・page_location・page_referrer"),
    "ga_channel": ("流入経路別", "要点、1. 期間で変わった経路、2. 経路ごとの日別、6. 流入経路の一覧", "mart_ga：campaign・utm_source・medium・source・page_location・page_referrer・event_date_jp"),
    "ga_flow": ("リンク元 × 流入経路 × 最初のページ", "要点（検索から来た人）、1. リンク元と最初のページ（流れ図）", "mart_ga：page_referrer（ドメイン）・campaign・utm_source・page_location"),
    "ga_site": ("参照元サイト別", "6. 参照元サイト", "mart_ga：page_referrer（ドメイン）・page_location"),
    "ga_daily": ("日別の新規訪問者", "2. 日別の新規訪問者（告知の種類別）、7. 訪問・登録・投稿の日別", "mart_ga：event_date_jp・campaign・utm_source"),
    "ga_daily_channel": ("流入経路 × 日別", "2. 経路ごとの日別、6. 経路ごとの日別", "mart_ga：event_date_jp と流入経路"),
    "ga_landing": ("最初に開いたページ", "1. の説明文、6. 着地ページ", "mart_ga：page_location"),
    "drop_theme": ("投稿のテーマ", "要点（投稿のテーマ）、3. 投稿のテーマ", "mart_action_drop：sentence・account_id（テーマごとに決めた言葉が出てくるかで分ける）"),
    "drop_quotes": ("テーマ別の一節", "3. テーマ別の一節", "mart_action_drop：word1〜word5・open_range（公開範囲が全体の一般の投稿から選んだ行。アカウント名・日時なし）"),
    "drop_daily": ("日別の投稿と新規登録", "要点（新規登録）、7. 訪問・登録・投稿の日別", "mart_action_drop：post_dated_at・is_operation_member、mart_user：created_at"),
    "drop_posts": ("投稿の要約（一般のみ／運営を含む）", "7. の見出しと説明文（切り替えで変わる数字）", "mart_action_drop：account_id・post_dated_at・event_id・is_operation_member"),
    "drop_poster_origin": ("投稿した人の登録の経路", "3. 投稿の数、7. 投稿した人（一般の投稿）", "mart_action_drop：account_id、mart_user_allevent：inflow_event_id・created_at"),
    "drop_poster_origin_all": ("投稿した人の登録の経路（運営を含む）", "7. 投稿した人（運営の投稿を含めたとき）", "mart_action_drop：account_id・is_operation_member、mart_user_allevent：inflow_event_id・created_at"),
    "drop_spot": ("スポット別の投稿", "7. スポット（ドーナツ）・スポット別の投稿", "mart_action_drop：event_id、int_event_master：event_id・event_name"),
    "drop_hour": ("投稿の時刻", "7. 投稿の時刻（一般の投稿）", "mart_action_drop：post_dated_at"),
    "drop_hour_all": ("投稿の時刻（運営を含む）", "7. 投稿の時刻（運営の投稿を含めたとき）", "mart_action_drop：post_dated_at・is_operation_member"),
    "drop_words": ("投稿に出てくる言葉", "7. 投稿の言葉（一般の投稿）", "mart_action_drop：word1〜word5・account_id（名詞を取り出し、使った人数で数える）"),
    "drop_words_all": ("投稿に出てくる言葉（運営を含む）", "7. 投稿の言葉（運営の投稿を含めたとき）", "mart_action_drop：word1〜word5・account_id・is_operation_member"),
    "drop_cooc": ("一緒に使われた言葉", "7. 一緒に使われた言葉（一般の投稿）", "mart_action_drop：word1〜word5・account_id（同じ投稿に出た言葉の組を、使った人数で数える）"),
    "drop_cooc_all": ("一緒に使われた言葉（運営を含む）", "7. 一緒に使われた言葉（運営の投稿を含めたとき）", "mart_action_drop：word1〜word5・account_id・is_operation_member"),
    "drop_age": ("年代", "7. 投稿した人・新規登録者の属性", "mart_user_allevent：age_group（50代以上はまとめる）"),
    "drop_gender": ("性別", "7. 投稿した人・新規登録者の属性", "mart_user_allevent：gender"),
    "survey_codes": ("登録時アンケート（住まい・勤め先）", "7. 登録時アンケート", "stg_user_persona_note_expanded：questionnaire_q1・q2、アンケート分析用 xlsx：設問マスター（選択肢の名前）"),
    "post_layers": ("投稿から読み取った体験の流れ（4層）", "3. 投稿から読み取った体験の流れ", "mart_action_drop：sentence（一般の投稿）と raw/post_layers.json（投稿ごとの4層の読み取り）。コンテンツ・最初の関心・行動・感じたこと・愛着の関心・意向の組み合わせごとの件数と人数だけで、本文・ID は入れない"),
    "attach_cross": ("投稿の読み取り × アンケート（同じ人）", "4. 投稿の読み取りとアンケートを重ねたカード", "raw/post_layers.json（④ が読み取れたか）と、アンケート分析用 xlsx（特典応募時の再訪意欲）を、投稿した人ごとに重ねた人数。ID は入れない"),
    "layer_examples": ("④ の読み取りの例", "3. 投稿から読み取った体験の流れ", "mart_action_drop：word1〜word5・open_range（公開範囲が全体の一般の投稿から選んだ行。アカウント名・日時なし）"),
    "journey_paths": ("体験の流れ（同じ人を追える人の道すじ）", "体験の流れ（全体図）", "mart_user・mart_user_allevent（登録の経路）、mart_action_drop（投稿・テーマ）、アンケート分析用 xlsx（知った媒体・再訪意欲）。道すじごとの人数だけで、個人の ID は入れない"),
    "app_survey": ("特典応募時アンケート", "要点（再訪意欲）、4. 品川への気持ち", "アンケート分析用 xlsx：カンマ区切り（特典応募時の回答。運営メンバーを除く。自由記述は入れない）"),
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
        if len(pw) < 4:
            print("4文字以上にしてください。")
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


def load_site_names():
    """公開したくない参照元ドメインの表示名（例：社内サイト）。raw フォルダに置くので GitHub には上がらない。"""
    path = os.path.join(RAW, "site_names.json")
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8-sig") as f:
        return json.load(f)


def find_survey():
    """raw フォルダのアンケート分析用 xlsx（いちばん新しいもの）。なければ None。"""
    xs = sorted(glob.glob(os.path.join(RAW, "*アンケート*.xlsx")), key=os.path.getmtime)
    if not xs:
        print("（raw にアンケート分析用 xlsx がないので、アンケートの図は空になります）")
        return None
    return xs[-1]


def load_quote_picks():
    """テーマ別の一節に使う投稿と行（artwork_id と行番号）。raw フォルダに置くので GitHub には上がらない。"""
    path = os.path.join(RAW, "quote_picks.json")
    if not os.path.exists(path):
        print("（raw/quote_picks.json がないので、テーマ別の一節は空になります）")
        return []
    with open(path, encoding="utf-8-sig") as f:
        return json.load(f)


def load_post_layers():
    """投稿ごとの4層（コンテンツ・最初の関心・行動・愛着の関心・意向）の読み取り結果。raw フォルダに置くので GitHub には上がらない。"""
    path = os.path.join(RAW, "post_layers.json")
    if not os.path.exists(path):
        print("（raw/post_layers.json がないので、投稿から読み取った体験の流れは空になります）")
        return {}
    with open(path, encoding="utf-8-sig") as f:
        return json.load(f)


def main():
    ensure_packages()
    sys.path.insert(0, HERE)
    global agg
    import drop_aggregate as agg  # noqa: E402
    src, label = find_input()
    print(f"元データ：{label}")
    survey = find_survey()
    results, _ = agg.build(src, load_site_names(), load_quote_picks(), survey, load_post_layers())
    inputs = describe_inputs(src)
    if survey:
        raw = open(survey, "rb").read()
        inputs.append({"file": os.path.basename(survey), "about": "アンケート分析用（会員登録時・特典応募時。個人情報削除済み）",
                       "records": None, "sha256_12": hashlib.sha256(raw).hexdigest()[:12]})
    lp = os.path.join(RAW, "post_layers.json")
    if os.path.exists(lp):
        raw = open(lp, "rb").read()
        inputs.append({"file": "post_layers.json", "about": "投稿ごとの4層の読み取り（raw に置く。GitHub には上げない）",
                       "records": len(json.loads(raw.decode("utf-8-sig")).get("posts", [])), "sha256_12": hashlib.sha256(raw).hexdigest()[:12]})
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
        ("/*__DRAW2__*/", read("draw2.js")),
        ("/*__PAGE__*/", read("page.js")),
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


HINTS = {
    "NO_PACKAGES": "ライブラリを入れられませんでした。社内ネットワークで pip のダウンロードが止められている可能性があります。"
                   "情報システムの担当に「Python の pip で pandas・janome・cryptography を入れたい」と相談してください。",
}


def run():
    log = open(LOG, "w", encoding="utf-8")
    sys.stdout, sys.stderr = Tee(sys.__stdout__, log), Tee(sys.__stderr__, log)
    print(f"Python {platform.python_version()}（{sys.executable}）／{platform.platform()}")
    try:
        main()
        print("完了しました。ShinagawaCinema2026_DROP_Dashboard.html をブラウザで開いて確かめてください。")
        return 0
    except SystemExit as e:   # 元データが見つからないなど、こちらで用意したメッセージ
        if e.code not in (None, 0):
            print("\n[止まりました] " + str(e.code))
        return 1
    except KeyboardInterrupt:
        print("\n中断しました。")
        return 1
    except Exception as e:
        print("\n[止まりました] ダッシュボードを作れませんでした。")
        key = str(e).split(":", 1)[0]
        if key in HINTS:
            print(HINTS[key])
        else:
            traceback.print_exc()
            print("この画面の内容は update_log.txt にも残っています。Claude に「update_log.txt を見て」と伝えてください。")
        return 1
    finally:
        log.flush()


if __name__ == "__main__":
    sys.exit(run())
