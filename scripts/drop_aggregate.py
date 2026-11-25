# 品川国際映画祭2026 × みんまちDROP：ダッシュボード用の集計
# build(src_dir) が、図の元になる集計表（dict: 表名 -> rows）と、その元テーブル名を返す。
# 直接実行した場合は従来どおり out/data/*.json に書き出す：python drop_aggregate.py <jsonフォルダ> <出力フォルダ>
import json, os, re, sys
from collections import Counter
import pandas as pd

EVENT = "shinagawa-cinema-2026"
START, END = "2026-11-02", "2026-11-14"       # 集計期間（DROP公開＝スタンプ期間 11/2〜11/14）
EVENT_START = "2026-11-09"                    # 映画祭の開催開始日（11/9〜11/14）

def build(SRC):
    RESULTS, INPUTS = {}, {}

    def load(name):
        with open(os.path.join(SRC, name + ".json"), encoding="utf-8-sig") as f:
            o = json.load(f)
        return pd.DataFrame(o["records"] if isinstance(o, dict) and "records" in o else o)

    def is_true(s):
        return s.astype(str).str.strip().str.upper().isin(["TRUE", "1"])

    def save(name, df, inputs):
        RESULTS[name] = json.loads(df.to_json(orient="records", force_ascii=False))
        INPUTS[name] = inputs

    def period(d):
        return "告知期間" if d < EVENT_START else "開催期間"

    # =========================================================
    # 1. GA：流入経路
    # =========================================================
    ga = load("mart_ga")
    ga = ga[(ga["collab_event_name"] == EVENT) & ga["event_date_jp"].between(START, END)]
    ga_all_rows = len(ga)
    ga_op_rows = int(is_true(ga["is_operation_member"]).sum())
    ga = ga[~is_true(ga["is_operation_member"])].copy()
    days = [d.strftime("%Y-%m-%d") for d in pd.date_range(START, END)]
    GA_MISSING = [d for d in days if not (ga["event_date_jp"] == d).any()]   # GAの行が0件の日（欠損の可能性）

    # 着地ページの分類
    def landing(url):
        u = url or ""
        if re.search(r"/event/EV02002\d+", u) or "mood=shinagawa-cinema-2026" in u:
            return "映画祭のスポット・案内ページ"
        if re.search(r"/event/EV020(00|01|03)\d+", u) or "spot=EV02003" in u or re.search(r"mood=(?!shinagawa-cinema)", u):
            return "他イベントのページ（富山・大阪など）"
        path = re.sub(r"\?.*", "", re.sub(r"https://drop\.machiapps\.com", "", u))
        if path == "/collab-a/":
            return "TOPページ"
        return "その他（投稿・登録・一覧など）"
    ga["landing"] = ga["page_location"].map(landing)

    # 2ページ目で first_visit が記録された行は、参照元URL（同サイトTOP）のUTMで流入元を補う
    def utm_from(url, key):
        m = re.search(rf"[?&]{key}=([^&]+)", url or "")
        return m.group(1) if m else None
    ga["utm_src"] = ga["utm_source"]
    ga["utm_camp"] = ga["campaign"].where(~ga["campaign"].isin(["(organic)", "(referral)", "(direct)"]))
    ga["referrer_fix"] = False
    mask = ga["utm_src"].isna() & ga["page_referrer"].fillna("").str.contains("drop.machiapps.com/collab-a/\\?utm_source=")
    ga.loc[mask, "utm_src"] = ga.loc[mask, "page_referrer"].map(lambda u: utm_from(u, "utm_source"))
    ga.loc[mask, "utm_camp"] = ga.loc[mask, "page_referrer"].map(lambda u: utm_from(u, "utm_campaign"))
    ga.loc[mask, "referrer_fix"] = True

    CINEMA = {  # utm_source → (表示名, 大分類, 補足)
        "official_web": ("映画祭公式HP", "映画祭の告知（オンライン）", "shinagawa-cinema.com からのリンク"),
        "intranet":     ("社内イントラ", "映画祭の告知（オンライン）", "社内向けポータル"),
        "machiapps":    ("PC画面の左側表示用", "映画祭の告知（オンライン）", "DROPサイトのPC表示時の左側エリア"),
        "line_app":     ("LINE公式アカウント", "映画祭の告知（オンライン）", "lstep.app 経由"),
        "reactivation": ("DROPリテンションメール", "映画祭の告知（オンライン）", "既存DROP会員向けメール"),
        "poster":       ("現地ポスター", "映画祭の告知（現地・紙）", "QRコード"),
        "flyer":        ("フライヤー", "映画祭の告知（現地・紙）", "QRコード"),
        "screen":       ("会場スクリーン（CREATOR'S THEATER）", "映画祭の告知（現地・紙）", "utm_source=screen"),
    }
    def channel(r):
        other_page = r["landing"].startswith("他イベント")
        if r["utm_camp"] == "shinagawa_cinema" and r["utm_src"] in CINEMA:
            n, g, note = CINEMA[r["utm_src"]]
            return n, g, r["utm_src"], note
        if r["utm_camp"] in ("culture_snack", "toyama_event"):
            return "他イベントのQR・リンク", "他イベント由来", r["utm_src"], "culture_snack・toyama_event のUTM"
        if isinstance(r["utm_camp"], str) and r["utm_camp"].startswith("fuvab"):
            return "UTM値が判読できない", "要確認", str(r["source"]), "utm値が意味の読めない文字列（medium=" + str(r["medium"]) + "）"
        if other_page:
            return "他イベントのページに着地", "他イベント由来", "(なし)", "検索・直接で富山などのページに着地"
        if r["medium"] == "organic":
            return "自然検索（Google・Yahoo!・Bing）", "UTMなし", "(なし)", "検索エンジン"
        if r["source"] == "l.instagram.com":
            return "Instagram", "UTMなし", "(なし)", "l.instagram.com"
        return "直接・参照元不明", "UTMなし", "(なし)", "ブックマーク・アプリ内ブラウザなど"
    ga[["channel", "group", "utm", "note"]] = ga.apply(lambda r: pd.Series(channel(r)), axis=1)
    ga["period"] = ga["event_date_jp"].map(period)

    # 参照元サイト（page_referrer のドメイン）
    SITE = {
        "www.shinagawa-cinema.com": "品川国際映画祭 公式サイト", "shinagawa-cinema.com": "品川国際映画祭 公式サイト",
        "webtest.tokyo": "webtest.tokyo（公式サイトのテスト環境の可能性）",
        "lstep.app": "LINE（Lステップ・LINEアプリ内）", "liff-gateway.lineml.jp": "LINE（Lステップ・LINEアプリ内）",
        "www.google.com": "Google検索", "www.google.co.jp": "Google検索",
        "search.yahoo.co.jp": "Yahoo!検索", "www.bing.com": "Bing検索",
        "l.instagram.com": "Instagram", "instagram.com": "Instagram",
        "drop.machiapps.com": "みんまちDROP本体サイト",
        "www.fc.obayashi.co.jp": "大林組 社内サイト",
    }
    def ref_domain(u):
        m = re.match(r"https?://([^/?#]+)", u) if isinstance(u, str) else None
        return m.group(1) if m else None
    ga["ref_domain"] = ga["page_referrer"].map(ref_domain)
    # 2ページ目で記録された行の参照元は同サイト内なので「参照元なし」とみなす
    ga.loc[ga["referrer_fix"], "ref_domain"] = None
    ga["site"] = ga["ref_domain"].map(lambda d: SITE.get(d, d) if pd.notna(d) else "参照元なし（QR・メール・社内イントラなど）")
    ga["is_mobile"] = ga["category"].eq("mobile")

    GROUP_ORDER = ["映画祭の告知（オンライン）", "映画祭の告知（現地・紙）", "UTMなし", "他イベント由来", "要確認"]
    total_users = ga["user_pseudo_id"].nunique()
    pre_days = len([d for d in days if d < EVENT_START and d not in GA_MISSING])
    during_days = len([d for d in days if d >= EVENT_START and d not in GA_MISSING])

    uniq = lambda s: "・".join(sorted(set(s)))
    def site_mix(x):
        vc = x.map(lambda d: d if pd.notna(d) else "参照元なし").value_counts()
        return "・".join(f"{k} {v}" for k, v in vc.items())
    g = ga.groupby(["group", "channel"]).agg(
        utm=("utm", uniq), note=("note", uniq), sites=("ref_domain", site_mix),
        users=("user_pseudo_id", "nunique"),
        pre=("period", lambda s: int((s == "告知期間").sum())),
        during=("period", lambda s: int((s == "開催期間").sum())),
        mobile=("is_mobile", "sum"),
    ).reset_index()
    g["share_pct"] = (g["users"] / total_users * 100).round(1)
    g["pre_daily"] = (g["pre"] / pre_days).round(1)
    g["during_daily"] = (g["during"] / during_days).round(1)
    g["mobile_pct"] = (g["mobile"] / g["users"] * 100).round(1)
    g["pc_pct"] = (100 - g["mobile_pct"]).round(1)
    g["group_order"] = g["group"].map(GROUP_ORDER.index)
    g = g.sort_values(["group_order", "users"], ascending=[True, False]).reset_index(drop=True)
    g["rank"] = range(1, len(g) + 1)
    g["is_cinema"] = g["group"].str.startswith("映画祭")
    ga_channel = g[["rank", "group", "channel", "utm", "note", "users", "share_pct", "pre", "during",
                    "pre_daily", "during_daily", "mobile", "mobile_pct", "pc_pct", "is_cinema", "sites"]]
    save("ga_channel", ga_channel, ["mart_ga.json"])

    gg = ga.groupby("group")["user_pseudo_id"].nunique().reindex(GROUP_ORDER).fillna(0).astype(int).reset_index()
    gg.columns = ["group", "users"]
    gg["share_pct"] = (gg["users"] / total_users * 100).round(1)
    save("ga_group", gg, ["mart_ga.json"])

    # 参照元サイト別（大分類の内訳つき）
    ga["seg"] = ga["group"].map(lambda x: "cinema" if x.startswith("映画祭") else ("no_utm" if x == "UTMなし" else "other"))
    sg = ga.groupby("site").agg(users=("user_pseudo_id", "nunique"),
                                cinema=("seg", lambda v: int((v == "cinema").sum())),
                                no_utm=("seg", lambda v: int((v == "no_utm").sum())),
                                other=("seg", lambda v: int((v == "other").sum())),
                                domains=("ref_domain", lambda v: "・".join(sorted(set(d for d in v if pd.notna(d))))),
                                channels=("channel", lambda v: "・".join(f"{k} {n}" for k, n in v.value_counts().items()))).reset_index()
    sg["has_ref"] = ~sg["site"].str.startswith("参照元なし")
    sg["share_pct"] = (sg["users"] / total_users * 100).round(1)
    sg = sg.sort_values(["has_ref", "users"], ascending=[False, False]).reset_index(drop=True)
    sg["rank"] = range(1, len(sg) + 1)
    save("ga_site", sg[["rank", "site", "domains", "users", "share_pct", "cinema", "no_utm", "other", "has_ref", "channels"]], ["mart_ga.json"])

    # 日別（映画祭の告知経由／それ以外）と、日別×チャネル
    ga["is_cinema"] = ga["group"].str.startswith("映画祭")
    dd = []
    for d in days:
        x = ga[ga["event_date_jp"] == d]
        dd.append({"date": d, "period": period(d), "ga_missing": d in GA_MISSING,
                   "cinema": int(x["is_cinema"].sum()), "other": int((~x["is_cinema"]).sum()), "total": len(x)})
    save("ga_daily", pd.DataFrame(dd), ["mart_ga.json"])

    dc = []
    for ch in ga_channel["channel"]:
        for d in days:
            dc.append({"channel": ch, "date": d, "ga_missing": d in GA_MISSING,
                       "users": int(((ga["channel"] == ch) & (ga["event_date_jp"] == d)).sum())})
    save("ga_daily_channel", pd.DataFrame(dc), ["mart_ga.json"])

    lp = ga.groupby(["landing", "group"])["user_pseudo_id"].nunique().unstack(fill_value=0)
    lp = lp.reindex(columns=GROUP_ORDER, fill_value=0)
    lp["users"] = lp.sum(axis=1)
    lp = lp.sort_values("users", ascending=False).reset_index()
    lp.columns = ["landing", "cinema_online", "cinema_onsite", "no_utm", "other_event", "unknown", "users"]
    lp["share_pct"] = (lp["users"] / total_users * 100).round(1)
    save("ga_landing", lp, ["mart_ga.json"])

    # =========================================================
    # 2. DROP：投稿・登録・いいね・アンケート
    # =========================================================
    drop = load("mart_action_drop")
    drop = drop[(drop["post_collab_event_name"] == EVENT) & (~is_true(drop["artwork_is_deleted"]))].copy()
    drop["date"] = drop["post_dated_at"].str[:10]
    drop = drop[drop["date"].between(START, END)]
    drop["is_op"] = is_true(drop["is_operation_member"])
    gen = drop[~drop["is_op"]].copy()

    ua = load("mart_user_allevent")
    users = load("mart_user")
    reg = users[(users["inflow_event_id"] == EVENT) & (~is_true(users["is_operation_member"])) & (~is_true(users["del_flg"]))].copy()
    reg["date"] = reg["created_at"].str[:10]

    # 投稿マート＋いいね数（skill §7）。GAに click_artwork_id が無いので閲覧数は作れない
    insp = load("mart_inspiration")
    i = insp[(insp["inspiration_collab_event_name"] == EVENT)].copy()
    i["d"] = i["inspiration_occurred_at"].str[:10]
    i = i[i["d"].between(START, END)]
    like_op = int(is_true(i["inspiration_account_is_operation_member"]).sum())
    i_gen = i[~is_true(i["inspiration_account_is_operation_member"]) & i["inspiration_id"].notna()]
    like = i_gen.groupby(i_gen["artwork_id"].astype(str).str.strip()).size().rename("like_count")
    eng = drop.drop(columns=["date", "is_op"]).copy()
    eng["_k"] = eng["artwork_id"].astype(str).str.strip()
    eng = eng.join(like, on="_k").drop(columns="_k")
    eng["like_count"] = eng["like_count"].fillna(0).astype(int)
    eng["pv_count"] = pd.NA  # mart_ga が first_visit のみで作品IDが無いため作成不可
    like_not_in_mart = int(like[~like.index.isin(set(eng["artwork_id"].astype(str).str.strip()))].sum())
    drop = drop.merge(eng[["artwork_id", "like_count"]], on="artwork_id", how="left")
    gen = drop[~drop["is_op"]].copy()

    # 投稿者の登録経路
    pu = gen[["account_id"]].drop_duplicates().merge(ua[["account_id", "inflow_event_id", "created_at", "gender", "age_group"]], on="account_id", how="left")
    def origin(r):
        if r["inflow_event_id"] == EVENT:
            return "映画祭をきっかけに新規登録"
        if str(r["created_at"])[:10] >= START:
            return "期間中に別の入口から新規登録"
        return "以前からの会員"
    pu["origin"] = pu.apply(origin, axis=1)
    posts_by_acc = gen.groupby("account_id").size().rename("posts")
    pu = pu.join(posts_by_acc, on="account_id")
    ORIGIN_ORDER = ["映画祭をきっかけに新規登録", "期間中に別の入口から新規登録", "以前からの会員"]
    po = pu.groupby("origin").agg(people=("account_id", "nunique"), posts=("posts", "sum"))
    po = po.reindex(ORIGIN_ORDER).fillna(0).astype(int).reset_index()
    def detail(o):
        x = pu[pu["origin"] == o]["inflow_event_id"].value_counts()
        return "、".join(f"{k} {v}人" for k, v in x.items())
    po["detail"] = po["origin"].map(detail)
    po["posts_per_person"] = (po["posts"] / po["people"]).round(1)
    save("drop_poster_origin", po, ["mart_action_drop.json", "mart_user_allevent.json"])

    # 日別：投稿（一般／運営）と新規登録
    dd = []
    for d in days:
        dd.append({"date": d, "period": period(d),
                   "general": int((gen["date"] == d).sum()),
                   "operation": int(((drop["date"] == d) & drop["is_op"]).sum()),
                   "registrations": int((reg["date"] == d).sum())})
    save("drop_daily", pd.DataFrame(dd), ["mart_action_drop.json", "mart_user.json"])

    # スポット別
    em = load("int_event_master")
    spot = dict(zip(em["event_id"], em["event_name"]))
    drop["spot"] = drop["event_id"].map(spot).fillna("スポット指定なし")
    sp = drop.groupby("spot").agg(general=("is_op", lambda s: int((~s).sum())), operation=("is_op", "sum")).reset_index()
    sp["operation"] = sp["operation"].astype(int)
    sp["total"] = sp["general"] + sp["operation"]
    sp["is_none"] = sp["spot"].eq("スポット指定なし")
    sp = sp.sort_values(["is_none", "general", "total"], ascending=[True, False, False]).reset_index(drop=True)
    save("drop_spot", sp[["spot", "general", "operation", "total"]], ["mart_action_drop.json", "int_event_master.json"])

    # 投稿時刻（一般投稿）
    gen["hour"] = gen["post_dated_at"].str[11:13].astype(int)
    hr = pd.DataFrame({"hour": range(24)})
    hr["posts"] = hr["hour"].map(gen["hour"].value_counts()).fillna(0).astype(int)
    hr["label"] = hr["hour"].map(lambda h: f"{h}時")
    save("drop_hour", hr, ["mart_action_drop.json"])

    # 属性：投稿者（一般）と映画祭きっかけの新規登録者
    reg_attr = reg[["account_id"]].merge(ua[["account_id", "gender", "age_group"]], on="account_id", how="left")
    AGE = ["10代", "20代", "30代", "40代", "50代", "60代", "70代以上"]
    ag = pd.DataFrame({"age_group": AGE})
    ag["posters"] = ag["age_group"].map(pu["age_group"].value_counts()).fillna(0).astype(int)
    ag["registrants"] = ag["age_group"].map(reg_attr["age_group"].value_counts()).fillna(0).astype(int)
    ag = ag[(ag["posters"] + ag["registrants"]) > 0]
    save("drop_age", ag, ["mart_action_drop.json", "mart_user.json", "mart_user_allevent.json"])
    GEN = ["男性", "女性", "無回答"]
    gd = pd.DataFrame({"gender": GEN})
    gd["posters"] = gd["gender"].map(pu["gender"].value_counts()).fillna(0).astype(int)
    gd["registrants"] = gd["gender"].map(reg_attr["gender"].value_counts()).fillna(0).astype(int)
    save("drop_gender", gd, ["mart_action_drop.json", "mart_user.json", "mart_user_allevent.json"])

    # 投稿の言葉（一般投稿の5行の詩から名詞を抽出。1投稿で同じ語は1回）
    from janome.tokenizer import Tokenizer
    tk = Tokenizer()
    STOP = {"こと", "もの", "よう", "ため", "それ", "これ", "ここ", "そこ", "さん", "の", "ん", "一", "日", "中", "前", "後", "時", "今", "人"}
    COMPOUNDS = ["品川国際映画祭", "品川セントラルガーデン", "セントラルガーデン", "品川インターシティ", "グランドコモンズ", "イルミネーション", "クリスマス"]
    cnt = Counter()
    for _, r in gen.iterrows():
        text = " ".join(str(r[f"word{k}"]) for k in range(1, 6) if pd.notna(r[f"word{k}"]))
        words = set()
        for c in COMPOUNDS:                     # 固有名詞はひとかたまりで数える（「品川」を含むものは「品川」にも数える）
            if c in text:
                words.add(c)
                if "品川" in c:
                    words.add("品川")
                text = text.replace(c, " ")
        for t in tk.tokenize(text):
            pos = t.part_of_speech.split(",")
            if pos[0] == "名詞" and pos[1] in ("一般", "固有名詞", "サ変接続", "形容動詞語幹") and len(t.surface) >= 1:
                w = t.base_form if t.base_form != "*" else t.surface
                if w not in STOP and not re.fullmatch(r"[0-9０-９]+", w):
                    words.add(w)
        cnt.update(words)
    wd = pd.DataFrame(sorted(cnt.items(), key=lambda kv: (-kv[1], kv[0])), columns=["word", "posts"])   # 同数は五十音順（実行ごとに順番が変わらないように）
    wd = wd[wd["posts"] >= 3].head(20).reset_index(drop=True)
    wd["share_pct"] = (wd["posts"] / len(gen) * 100).round(1)
    save("drop_words", wd, ["mart_action_drop.json（word1〜word5）"])

    # 登録時アンケート（映画祭：q1・q2、番号のまま）
    sv = load("stg_user_persona_note_expanded")
    sv = sv[sv["account_id"].isin(reg["account_id"])]
    sq = []
    for q in ["questionnaire_q1", "questionnaire_q2"]:
        vals = pd.to_numeric(sv[q], errors="coerce").dropna().astype(int)
        for code in range(1, int(vals.max()) + 1):
            sq.append({"question": q.replace("questionnaire_", "").upper(), "code": code, "label": f"{code}番",
                       "n": int((vals == code).sum())})
    save("survey_codes", pd.DataFrame(sq), ["stg_user_persona_note_expanded.json"])

    # KPI（1行）
    cin = ga["is_cinema"]
    reg_posted = int(reg["account_id"].isin(gen["account_id"]).sum())
    kpi = {
        "ga_users": int(total_users),
        "ga_rows_all": int(ga_all_rows),
        "ga_op_rows": ga_op_rows,
        "ga_cinema_users": int(cin.sum()),
        "ga_cinema_pct": round(float(cin.mean()) * 100, 1),
        "ga_mobile_pct": round(float(ga["is_mobile"].mean()) * 100, 1),
        "ga_referrer_fixed": int(ga["referrer_fix"].sum()),
        "ga_with_referrer": int(ga["ref_domain"].notna().sum()),
        "ga_no_referrer": int(ga["ref_domain"].isna().sum()),
        "ga_pre_users": int((ga["period"] == "告知期間").sum()),
        "ga_during_users": int((ga["period"] == "開催期間").sum()),
        "ga_pre_daily": round((ga["period"] == "告知期間").sum() / pre_days, 1),
        "ga_during_daily": round((ga["period"] == "開催期間").sum() / during_days, 1),
        "reg_cinema": int(len(reg)),
        "reg_posted": reg_posted,
        "reg_posted_pct": round(reg_posted / len(reg) * 100, 1),
        "reg_per_visitor_pct": round(len(reg) / total_users * 100, 1),
        "posts_all": int(len(drop)),
        "posts_general": int(len(gen)),
        "posts_operation": int(drop["is_op"].sum()),
        "posters_general": int(gen["account_id"].nunique()),
        "posts_no_spot_general": int(gen["event_id"].isna().sum()),
        "posts_evening_general": int(gen["hour"].between(17, 22).sum()),
        "posts_evening_pct": round(float(gen["hour"].between(17, 22).mean()) * 100, 1),
        "likes_general": int(len(i_gen)),
        "likes_general_people": int(i_gen["inspiration_account_id"].nunique()),
        "likes_operation": like_op,
        "like_not_in_mart": like_not_in_mart,
        "survey_n": int(sv["account_id"].nunique()),
        "spots": int(len(em)),
    }
    save("kpi", pd.DataFrame([kpi]), ["mart_ga.json", "mart_action_drop.json", "mart_user.json",
                                      "mart_user_allevent.json", "mart_inspiration.json", "stg_user_persona_note_expanded.json"])
    return RESULTS, INPUTS


if __name__ == "__main__":
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(os.path.join(out, "data"), exist_ok=True)
    results, inputs = build(src)
    for name, rows in results.items():
        with open(os.path.join(out, "data", name + ".json"), "w", encoding="utf-8") as f:
            json.dump({"rows": rows, "inputs": inputs[name]}, f, ensure_ascii=False)
    print(json.dumps(results["kpi"][0], ensure_ascii=False, indent=1))
