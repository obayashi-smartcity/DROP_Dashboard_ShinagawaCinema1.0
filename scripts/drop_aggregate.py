# 品川国際映画祭2026 × みんまちDROP：ダッシュボード用の集計
# build(src_dir, extra_sites, quote_picks, survey_xlsx, post_layers) が、図の元になる集計表（dict: 表名 -> rows）と、その元テーブル名を返す。
#   extra_sites：参照元ドメイン → 表示名の追加分（公開したくない社内サイトなど。raw/site_names.json から渡す）
#   quote_picks：テーマ別の一節に使う投稿と行（raw/quote_picks.json から渡す）
#   survey_xlsx：アンケート分析用 xlsx（会員登録時・特典応募時。個人情報削除済み。raw に置く）
#   post_layers：投稿の4層（コンテンツ・最初の関心・行動・愛着の関心・意向）の読み取り結果（raw/post_layers.json から渡す）
# 直接実行した場合は out/data/*.json に書き出す：python drop_aggregate.py <jsonフォルダ> <出力フォルダ>
import json, os, re, sys
from collections import Counter
import pandas as pd

EVENT = "shinagawa-cinema-2026"
START, END = "2026-11-02", "2026-11-14"       # 集計期間（DROP公開＝スタンプ期間 11/2〜11/14）
EVENT_START = "2026-11-09"                    # 映画祭の開催開始日（11/9〜11/14）

def build(SRC, extra_sites=None, quote_picks=None, survey_xlsx=None, post_layers=None):
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
    }
    # 公開したくないドメイン（社内サイトなど）は raw/site_names.json に書く（GitHub には上がらない）。表示は名前だけにしてドメインは出さない
    HIDDEN = dict(extra_sites or {})
    SITE.update(HIDDEN)
    show_domain = lambda d: HIDDEN.get(d, d)
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
        vc = x.map(lambda d: show_domain(d) if pd.notna(d) else "参照元なし").value_counts()
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
    # 告知の種類：配信（その日に届く）／常設のリンク（いつでも見られる）／会場の QR／識別タグなし・他イベント
    KIND = {"intranet": "push", "line_app": "push", "reactivation": "push",
            "official_web": "link", "machiapps": "link",
            "poster": "onsite", "flyer": "onsite", "screen": "onsite"}
    KIND_LABEL = {"push": "配信（その日に届く）", "link": "常設のリンク", "onsite": "会場の QR", "untagged": "識別タグなし・他イベント"}
    g["kind"] = g.apply(lambda r: KIND.get(r["utm"], "untagged") if r["is_cinema"] else "untagged", axis=1)
    g["kind_label"] = g["kind"].map(KIND_LABEL)
    g["kind_order"] = g["kind"].map(["push", "link", "onsite", "untagged"].index)
    ga_channel = g[["rank", "group", "channel", "utm", "note", "users", "share_pct", "pre", "during",
                    "pre_daily", "during_daily", "mobile", "mobile_pct", "pc_pct", "is_cinema", "sites", "kind", "kind_label", "kind_order"]]
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
                                domains=("ref_domain", lambda v: "・".join(sorted(set(d for d in v if pd.notna(d) and d not in HIDDEN)))),
                                channels=("channel", lambda v: "・".join(f"{k} {n}" for k, n in v.value_counts().items())),
                                land_event=("landing", lambda v: int(v.isin(["TOPページ", "映画祭のスポット・案内ページ"]).sum())),
                                land_other=("landing", lambda v: int(v.str.startswith("他イベント").sum())),
                                land_misc=("landing", lambda v: int(v.str.startswith("その他").sum()))).reset_index()
    sg["has_ref"] = ~sg["site"].str.startswith("参照元なし")
    sg["share_pct"] = (sg["users"] / total_users * 100).round(1)
    sg = sg.sort_values(["has_ref", "users"], ascending=[False, False]).reset_index(drop=True)
    sg["rank"] = range(1, len(sg) + 1)
    save("ga_site", sg[["rank", "site", "domains", "users", "share_pct", "cinema", "no_utm", "other", "land_event", "land_other", "land_misc", "has_ref", "channels"]], ["mart_ga.json"])

    # 日別（映画祭の告知経由／それ以外）と、日別×チャネル
    ga["is_cinema"] = ga["group"].str.startswith("映画祭")
    ga["kind"] = ga.apply(lambda r: KIND.get(r["utm"], "untagged") if r["is_cinema"] else "untagged", axis=1)
    dd = []
    for d in days:
        x = ga[ga["event_date_jp"] == d]
        dd.append({"date": d, "period": period(d), "ga_missing": d in GA_MISSING,
                   "cinema": int(x["is_cinema"].sum()), "other": int((~x["is_cinema"]).sum()), "total": len(x),
                   "push": int((x["kind"] == "push").sum()), "link": int((x["kind"] == "link").sum()),
                   "onsite": int((x["kind"] == "onsite").sum()), "untagged": int((x["kind"] == "untagged").sum())})
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

    # 流れ図：リンク元 → 流入経路 → 最初に開いたページ（人数）
    REF_NODE = {"品川国際映画祭 公式サイト": "映画祭の公式サイト", "Google検索": "検索（Google・Yahoo!・Bing）",
                "Yahoo!検索": "検索（Google・Yahoo!・Bing）", "Bing検索": "検索（Google・Yahoo!・Bing）",
                "LINE（Lステップ・LINEアプリ内）": "LINE", "Instagram": "Instagram"}
    NO_REF = "リンク元が残らない（QR・メール・社内イントラなど）"
    REF_ORDER = ["映画祭の公式サイト", NO_REF, "LINE", "検索（Google・Yahoo!・Bing）", "Instagram", "その他のサイト"]
    ga["ref_node"] = ga.apply(lambda r: NO_REF if pd.isna(r["ref_domain"]) else REF_NODE.get(r["site"], "その他のサイト"), axis=1)
    ga["flow_channel"] = ga["channel"].where(ga["group"] != "他イベント由来", "他イベント由来")
    CH_ORDER = [c for c in ga_channel["channel"] if not c.startswith("他イベント")]
    CH_ORDER.insert(CH_ORDER.index("UTM値が判読できない"), "他イベント由来")
    LANDING_ORDER = ["TOPページ", "映画祭のスポット・案内ページ", "他イベントのページ（富山・大阪など）", "その他（投稿・登録・一覧など）"]
    fl = ga.groupby(["ref_node", "flow_channel", "group", "landing"])["user_pseudo_id"].nunique().rename("users").reset_index()
    fl.columns = ["ref", "channel", "group", "landing", "users"]
    fl["ref_order"] = fl["ref"].map(REF_ORDER.index)
    fl["channel_order"] = fl["channel"].map(CH_ORDER.index)
    fl["landing_order"] = fl["landing"].map(LANDING_ORDER.index)
    fl["ref_sites"] = fl.apply(lambda r: "・".join(f"{k} {v}" for k, v in ga[(ga["ref_node"] == r["ref"])]["site"].map(lambda x: x.split("（")[0]).value_counts().items()) if r["ref"] == "その他のサイト" else "", axis=1)
    fl = fl.sort_values(["ref_order", "channel_order", "landing_order"]).reset_index(drop=True)
    save("ga_flow", fl, ["mart_ga.json"])

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
    # 運営メンバーの投稿も含めた版（運営メンバーは別の行にする）
    opc = drop[drop["is_op"]]
    po_all = pd.concat([po, pd.DataFrame([{"origin": "運営メンバー", "people": int(opc["account_id"].nunique()), "posts": int(len(opc)), "detail": "",
                                            "posts_per_person": round(len(opc) / max(1, opc["account_id"].nunique()), 1)}])], ignore_index=True)
    save("drop_poster_origin_all", po_all, ["mart_action_drop.json", "mart_user_allevent.json"])

    # 日別：投稿（一般／運営）と新規登録
    dd = []
    for d in days:
        dd.append({"date": d, "period": period(d),
                   "general": int((gen["date"] == d).sum()),
                   "operation": int(((drop["date"] == d) & drop["is_op"]).sum()),
                   "posts_all": int((drop["date"] == d).sum()),
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
    # 運営メンバーの投稿も含めた版
    drop["hour"] = drop["post_dated_at"].str[11:13].astype(int)
    hr_all = pd.DataFrame({"hour": range(24)})
    hr_all["posts"] = hr_all["hour"].map(drop["hour"].value_counts()).fillna(0).astype(int)
    hr_all["label"] = hr_all["hour"].map(lambda h: f"{h}時")
    save("drop_hour_all", hr_all, ["mart_action_drop.json（運営メンバーの投稿を含む）"])

    # 投稿の集計（一般のみ／運営メンバーを含む）：ページの切り替えで使う
    ops = drop[drop["is_op"]]
    def post_summary(d, key, label):
        return {"ops": key, "label": label, "posts": int(len(d)), "posters": int(d["account_id"].nunique()),
                "evening_posts": int(d["hour"].between(17, 22).sum()), "evening_pct": round(float(d["hour"].between(17, 22).mean()) * 100, 1),
                "no_spot_posts": int(d["event_id"].isna().sum()), "no_spot_pct": round(float(d["event_id"].isna().mean()) * 100, 1),
                "op_posts": int(len(ops)), "op_people": int(ops["account_id"].nunique())}
    ps = pd.DataFrame([post_summary(gen, "general", "一般の投稿（運営メンバー以外）"),
                       post_summary(drop, "all", "運営メンバーを含む投稿")])
    save("drop_posts", ps, ["mart_action_drop.json"])

    # 属性：投稿者（一般）と映画祭きっかけの新規登録者
    reg_attr = reg[["account_id"]].merge(ua[["account_id", "gender", "age_group"]], on="account_id", how="left")
    # 人数が少なく個人が特定されやすい区分はまとめる（10代以下→20代以下、50代以上）
    AGE_MAP = {"0代": "20代以下", "10代": "20代以下", "20代": "20代以下", "30代": "30代", "40代": "40代"}
    def age_band(x):
        if not isinstance(x, str):
            return "不明"
        return AGE_MAP.get(x, "50代以上")
    AGE = ["20代以下", "30代", "40代", "50代以上", "不明"]
    ag = pd.DataFrame({"age_group": AGE})
    ag["posters"] = ag["age_group"].map(pu["age_group"].map(age_band).value_counts()).fillna(0).astype(int)
    ag["registrants"] = ag["age_group"].map(reg_attr["age_group"].map(age_band).value_counts()).fillna(0).astype(int)
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
    def words_of(r):
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
        return words

    # 言葉のまとまり（言葉の意味で手で分けたもの）
    THEME = {"品川": "まち・場所", "街": "まち・場所", "ビル": "まち・場所", "品川セントラルガーデン": "まち・場所", "品川インターシティ": "まち・場所",
             "映画": "映画祭（上映・ステージ）", "品川国際映画祭": "映画祭（上映・ステージ）", "音楽": "映画祭（上映・ステージ）",
             "ステージ": "映画祭（上映・ステージ）", "演奏": "映画祭（上映・ステージ）",
             "イルミネーション": "冬の夜（イルミネーション）", "クリスマス": "冬の夜（イルミネーション）"}
    THEME_ORDER = ["まち・場所", "映画祭（上映・ステージ）", "冬の夜（イルミネーション）", "そのほか"]

    from itertools import combinations
    def word_tables(posts):
        """posts の言葉の表（使った人数3人以上）と、共起（2人以上が使った言葉どうし、2人以上が一緒に使った組み合わせ）"""
        cnt, who, post_words = Counter(), {}, []
        for _, r in posts.iterrows():
            words = words_of(r)
            cnt.update(words)
            post_words.append((r["account_id"], words))
            for w in words:
                who.setdefault(w, set()).add(r["account_id"])
        # 同じ人が何度使っても1人と数える（同じ人の似た投稿で数が膨らまないように）
        wd = pd.DataFrame([(w, len(who[w]), cnt[w]) for w in cnt], columns=["word", "people", "posts"])
        wd = wd.sort_values(["people", "posts", "word"], ascending=[False, False, True])
        wd = wd[wd["people"] >= 3].head(20).reset_index(drop=True)
        wd["share_pct"] = (wd["people"] / posts["account_id"].nunique() * 100).round(1)   # 投稿した人のうち使った人の割合
        wd["theme"] = wd["word"].map(lambda w: THEME.get(w, "そのほか"))
        wd["theme_order"] = wd["theme"].map(THEME_ORDER.index)
        cw = {w for w, a in who.items() if len(a) >= 2}
        pair_people, pair_posts = {}, Counter()
        for acc, ws in post_words:
            for x, y in combinations(sorted(ws & cw), 2):
                pair_posts[(x, y)] += 1
                pair_people.setdefault((x, y), set()).add(acc)
        edges = [(x, y, len(a), pair_posts[(x, y)]) for (x, y), a in pair_people.items() if len(a) >= 2]
        edges.sort(key=lambda e: (-e[2], -e[3], e[0], e[1]))
        nodes = sorted({w for e in edges for w in e[:2]}, key=lambda w: (-len(who[w]), -cnt[w], w))
        co = [{"type": "node", "word": w, "people": len(who[w]), "posts": cnt[w], "theme": THEME.get(w, "そのほか"),
               "source": None, "target": None} for w in nodes]
        co += [{"type": "edge", "word": None, "people": n, "posts": k, "theme": None, "source": x, "target": y} for x, y, n, k in edges]
        return wd, pd.DataFrame(co)

    # 一般の投稿（運営メンバー以外）
    wd, co = word_tables(gen)
    save("drop_words", wd, ["mart_action_drop.json（word1〜word5）"])
    save("drop_cooc", co, ["mart_action_drop.json（word1〜word5）"])
    # 運営メンバーの投稿も含めた版（ページの「運営の投稿を含める」で切り替える）
    wd_all, co_all = word_tables(drop)
    save("drop_words_all", wd_all, ["mart_action_drop.json（word1〜word5、運営メンバーの投稿を含む）"])
    save("drop_cooc_all", co_all, ["mart_action_drop.json（word1〜word5、運営メンバーの投稿を含む）"])

    # 投稿のテーマ（一般の投稿）：本文（sentence）に決めた言葉が出てくるかで分ける。1つの投稿が複数のテーマに入ることがある
    POST_THEMES = [  # (キー, 表示名, 言葉)
        ("everyday", "いつもの品川が違って見えた", ["いつもの", "いつもは", "いつもと", "通い慣れた", "違和感", "新しい景色", "はじめまして", "非日常", "普通と違う", "街になる"]),
        ("season", "寒さ・季節", ["寒", "冷え", "紅葉", "秋", "冬", "季節", "サンタ", "暖か", "あったか", "温ま"]),
        ("movie", "映画・スクリーン", ["映画", "スクリーン", "ムービー", "シネマ", "作品", "上映"]),
        ("light", "光・イルミネーション", ["イルミネーション", "光", "ひかり", "灯り", "明かり", "あかり", "ライトアップ", "キラキラ", "ギラギラ", "きらめき", "ピカピカ", "夕焼け", "照ら", "てらす", "眩い"]),
        ("music", "音楽・ステージ", ["音楽", "ミュージック", "ライブ", "ステージ", "歌声", "ゴスペル", "演奏", "吹奏楽", "レゲエ", "リハーサル", "バイオリン", "ギター", "楽曲", "音色", "コンサート"]),
        ("people", "人・にぎわい", ["人が", "人々", "友人", "友達", "同僚", "子供", "老若男女", "誰か", "オーディエンス", "拍手", "足を止める", "集まって"]),
        ("food", "食べもの・飲みもの", ["ビール", "フード", "ドリンク", "カレー", "飲", "食", "おむすび", "ミネストローネ", "ワイン", "チキン", "お酒", "ピザ"]),
        ("work", "仕事帰り・帰り道", ["仕事", "しごと", "退勤", "働く", "帰り道", "帰りみち"]),
        ("repeat", "毎年の楽しみ・また来た", ["今年も", "毎年", "恒例", "風物詩", "待ってました", "も来ました"]),
    ]
    FEST_NAME = re.compile(r"品川国際映画祭|映画祭")
    def post_themes(sentence):
        t = str(sentence or "")
        out = []
        for key, _, words in POST_THEMES:
            text = FEST_NAME.sub("", t) if key == "movie" else t   # 「映画祭」は映画のテーマに数えない
            if any(w in text for w in words):
                out.append(key)
        return out
    gen["themes"] = gen["sentence"].map(post_themes)
    n_posters = gen["account_id"].nunique()
    th = []
    for order, (key, label, words) in enumerate(POST_THEMES):
        m = gen["themes"].map(lambda x, k=key: k in x)
        th.append({"theme": key, "label": label, "order": order, "people": int(gen.loc[m, "account_id"].nunique()),
                   "posts": int(m.sum()), "share_pct": round(gen.loc[m, "account_id"].nunique() / n_posters * 100, 1),
                   "highlight": key == "everyday", "words": "・".join(words)})
    th = pd.DataFrame(th).sort_values(["people", "posts", "order"], ascending=[False, False, True]).reset_index(drop=True)
    th["rank"] = range(1, len(th) + 1)
    save("drop_theme", th, ["mart_action_drop.json（sentence）"])

    # テーマごとの代表的な一節。選んだ投稿と行は raw/quote_picks.json（コードの外。GitHub には上げない）に書く
    # 使うのは一般の投稿で、公開範囲が全体（open_range=1）のものだけ。アカウント名・日時は出さない
    PICKS = list(quote_picks or [])
    label_of = {k: l for k, l, _ in POST_THEMES}
    order_of = {k: i for i, (k, _, _) in enumerate(POST_THEMES)}
    qt = []
    for p in PICKS:
        r = gen[(gen["artwork_id"] == p["artwork_id"]) & (gen["open_range"].astype(str) == "1")]
        if r.empty or p["theme"] not in label_of:
            continue
        r = r.iloc[0]
        lines = [str(r[f"word{i}"]).strip() for i in p["lines"] if pd.notna(r[f"word{i}"]) and str(r[f"word{i}"]).strip()]
        if lines:
            qt.append({"theme": p["theme"], "label": label_of[p["theme"]], "order": order_of[p["theme"]], "text": "\n".join(lines)})
    qt = pd.DataFrame(qt, columns=["theme", "label", "order", "text"])
    qt["no"] = qt.groupby("theme").cumcount() + 1
    save("drop_quotes", qt, ["mart_action_drop.json（word1〜word5・open_range）"])

    # アンケート分析用 xlsx（設問マスター＝選択肢の名前、カンマ区切り＝特典応募時の回答）
    def read_survey(path):
        if not path or not os.path.exists(path):
            return None, None
        master = pd.read_excel(path, sheet_name="設問マスター", dtype=str)
        ans = pd.read_excel(path, sheet_name="カンマ区切り", header=1, dtype=str)
        ans = ans[ans["結合Account_ID"].fillna("").str.len() > 20]
        return master, ans
    SV_MASTER, SV_ANS = read_survey(survey_xlsx)

    # 登録時アンケート（映画祭：Q1＝住まい、Q2＝勤め先。選択肢の名前は設問マスターから）
    sv = load("stg_user_persona_note_expanded")
    sv = sv[sv["account_id"].isin(reg["account_id"])]
    REG_Q = {"Q1": ("5", "住まい"), "Q2": ("6", "勤め先")}
    sq = []
    for q in ["questionnaire_q1", "questionnaire_q2"]:
        Q = q.replace("questionnaire_", "").upper()
        no, qname = REG_Q[Q]
        names = {}
        if SV_MASTER is not None:
            m = SV_MASTER[(SV_MASTER["アンケート種別"] == "会員登録時") & (SV_MASTER["設問番号"] == no)]
            names = {int(k): v for k, v in zip(m["選択肢番号"], m["選択肢"])}
        vals = pd.to_numeric(sv[q], errors="coerce").dropna().astype(int)
        for code in range(1, max([int(vals.max())] + list(names)) + 1):
            sq.append({"question": Q, "question_label": qname, "code": code, "label": names.get(code, f"{code}番"),
                       "n": int((vals == code).sum())})
    save("survey_codes", pd.DataFrame(sq), ["stg_user_persona_note_expanded.json", "アンケート分析用 xlsx（設問マスター）"])

    # 特典応募時アンケート（運営メンバーを除く）
    APP_Q = [  # (キー, 設問文に含まれる言葉, 表示名, 選択肢の並び, 言いたい選択肢)
        ("revisit", "再訪意欲", "品川エリアへの再訪意欲が高まったか",
         ["とても高まった", "やや高まった", "どちらでもない", "あまり高まらなかった", "全く高まらなかった"], ["とても高まった", "やや高まった"]),
        ("effect", "効果", "参加して得られた効果",
         ["街やセントラルガーデンの魅力を発見できた", "同僚・友人・家族と楽しむことができた", "新しいサービスを利用できた・試すことができた", "その他"], ["街やセントラルガーデンの魅力を発見できた"]),
        ("satisfaction", "体験満足度", "映画祭の体験満足度が高まったか",
         ["高まった", "やや高まった", "どちらでもない"], ["高まった", "やや高まった"]),   # 設問マスターにない設問。答えのあった選択肢だけ
        ("media", "情報媒体", "投稿コンテストを知った媒体",
         ["社内告知", "フライヤー", "会場ポスター", "LINE公式アカウント（みんまちPJ公式）", "品川国際映画祭WEBサイト", "みんまちDROPからの案内メール", "CinemaCaravan SNS", "その他（紹介・口コミなど）"], []),
        ("with", "どなたと", "一緒に利用した人",
         ["一人で", "同僚と一緒に", "友人・恋人と一緒に", "家族と一緒に", "その他"], []),
        ("nps", "おすすめ", "親しい人へのおすすめ度（0〜10）", [str(i) for i in range(11)], ["9", "10"]),
    ]
    app_rows, app_kpi = [], {}
    if SV_ANS is not None:
        a = SV_ANS[SV_ANS["特典応募アンケート有無"] == "有り"].copy()
        op_ids = set(ua.loc[is_true(ua["is_operation_member"]), "account_id"])
        app_kpi["app_n_all"] = int(len(a))
        app_kpi["app_operation"] = int(a["結合Account_ID"].isin(op_ids).sum())
        a = a[~a["結合Account_ID"].isin(op_ids)]
        n = len(a)
        col = lambda word: next(c for c in a.columns if word in str(c))
        for key, word, qlabel, opts, hi in APP_Q:
            v = a[col(word)].fillna("").astype(str).str.strip()
            v = v.str.replace(r"\.0$", "", regex=True)
            if key == "media":
                v = v.where(v.isin(opts[:-1]) | (v == ""), "その他（紹介・口コミなど）")
            opts = opts + sorted(set(v[(v != "") & ~v.isin(opts)]))   # 並びにない答えは後ろに足す
            for order, o in enumerate(opts):
                k = int((v == o).sum())
                app_rows.append({"q": key, "q_label": qlabel, "option": o, "order": order, "n": k,
                                 "pct": round(k / n * 100, 1) if n else 0, "hi": o in hi})
            app_kpi[f"app_{key}_hi"] = int(v.isin(hi).sum()) if hi else None
            app_kpi[f"app_{key}_hi_pct"] = round(float(v.isin(hi).mean()) * 100, 1) if hi and n else None
        nps = pd.to_numeric(a[col("おすすめ")], errors="coerce")
        app_kpi.update({
            "app_n": int(n),
            "app_revisit_very": int((a[col("再訪意欲")] == "とても高まった").sum()),
            "app_nps_mean": round(float(nps.mean()), 1),
            "app_nps_score": round(float(((nps >= 9).mean() - (nps <= 6).mean()) * 100), 0),
            "app_posted": int(a["結合Account_ID"].isin(gen["account_id"]).sum()),
            "app_reg_cinema": int(a["結合Account_ID"].isin(reg["account_id"]).sum()),
            "app_comments": int(a[col("ご意見")].fillna("").str.strip().ne("").sum()),
        })
        # 「いつもの品川が違って見えた」を書いた人の回答
        ev_ids = set(gen.loc[gen["themes"].map(lambda x: "everyday" in x), "account_id"])
        e = a[a["結合Account_ID"].isin(ev_ids)]
        app_kpi["app_everyday_n"] = int(len(e))
        app_kpi["app_everyday_up"] = int(e[col("再訪意欲")].isin(["とても高まった", "やや高まった"]).sum())
    save("app_survey", pd.DataFrame(app_rows, columns=["q", "q_label", "option", "order", "n", "pct", "hi"]),
         ["アンケート分析用 xlsx（特典応募時。運営メンバーを除く）", "mart_user_allevent.json（is_operation_member）"])

    # 体験の流れ（同じ人を追える DROP の会員データ。GA は人を追えないので入れない）
    #   知った媒体（特典応募時アンケート）→ 登録の経路 → 投稿 → 品川エリアへの再訪意欲（特典応募時アンケート）
    #   対象：映画祭をきっかけに登録した人・一般の投稿をした人・特典応募時アンケートに答えた人（運営メンバーを除く）
    J_SHORT = {"LINE公式アカウント（みんまちPJ公式）": "LINE公式アカウント", "品川国際映画祭WEBサイト": "映画祭WEBサイト",
               "みんまちDROPからの案内メール": "DROPの案内メール", "その他（紹介・口コミなど）": "紹介・口コミなど"}
    J_ORIGIN = {"映画祭をきっかけに新規登録": "映画祭で新規登録", "期間中に別の入口から新規登録": "期間中に別の入口から新規登録", "以前からの会員": "以前からの会員"}
    media_of, feel_of = {}, {}
    if SV_ANS is not None:
        mv = a[col("情報媒体")].fillna("").astype(str).str.strip()
        known = [o for o in APP_Q[3][3][:-1]]
        mv = mv.where(mv.isin(known) | (mv == ""), "その他（紹介・口コミなど）")
        media_of = dict(zip(a["結合Account_ID"], mv.map(lambda x: J_SHORT.get(x, x) if x else "答えなし")))
        feel_of = dict(zip(a["結合Account_ID"], a[col("再訪意欲")].fillna("答えなし")))
    uai = ua.drop_duplicates("account_id").set_index("account_id")
    reg_ids, gen_ids = set(reg["account_id"]), set(gen["account_id"])
    ev_ids = set(gen.loc[gen["themes"].map(lambda x: "everyday" in x), "account_id"])
    jr = []
    for acc in sorted(reg_ids | gen_ids | set(media_of)):
        org = "映画祭をきっかけに新規登録" if acc in reg_ids else (origin(uai.loc[acc]) if acc in uai.index else "以前からの会員")
        post = ("「いつもの品川」を書いた" if acc in ev_ids else "ほかのテーマを書いた") if acc in gen_ids else "投稿していない"
        jr.append({"media": media_of.get(acc, "わからない（応募なし）"), "origin": J_ORIGIN[org], "post": post,
                   "feel": feel_of.get(acc, "応募していない")})
    jrd = pd.DataFrame(jr)
    _mc = jrd["media"].value_counts()
    _solo = [m for m, n in _mc.items() if n == 1 and m not in ("答えなし", "わからない（応募なし）")]
    if len(_solo) >= 2:   # 1人だけの媒体が2つ以上あれば「そのほかの媒体」にまとめる（組み合わせで個人がわかりにくいように）
        jrd.loc[jrd["media"].isin(_solo), "media"] = "そのほかの媒体"
    app_kpi["journey_media_merged"] = "・".join(_solo) if len(_solo) >= 2 else ""
    jp = jrd.groupby(["media", "origin", "post", "feel"]).size().rename("people").reset_index()
    save("journey_paths", jp, ["mart_user.json", "mart_user_allevent.json", "mart_action_drop.json（sentence）", "アンケート分析用 xlsx（特典応募時。運営メンバーを除く）"])
    app_kpi["journey_people"] = int(len(jr))

    # 投稿から読み取った体験の流れ（4層）。一般の投稿を、ノード定義（①コンテンツ・②最初の関心・③行動・④愛着の関心・意向）に
    # 沿って1件ずつ読み取った結果は raw/post_layers.json（コードの外。GitHub には上げない）に書く。各層は、その投稿でいちばん中心に書かれたもの1つ
    LAYERS = dict(post_layers or {})
    LY_NONE = "読み取れない"
    if LAYERS.get("posts"):
        lc = pd.DataFrame(LAYERS["posts"]).merge(gen[["artwork_id", "account_id"]], on="artwork_id", how="inner")
        missing = int((~gen["artwork_id"].isin(lc["artwork_id"])).sum())
        if missing:
            print(f"注意：4層の読み取りがない一般の投稿が {missing}件あります（post_layers.json に追加してください）")
        lc["feeling"] = lc["feeling"].fillna("")
        lc["attach_type"] = lc["attach"].map(LAYERS.get("attach_type", {})).fillna("")
        order = {k: {v: i for i, v in enumerate(vs)} for k, vs in LAYERS.get("layers", {}).items()}
        pl = lc.groupby(["content", "interest", "action", "feeling", "attach", "attach_type"]).agg(
            posts=("artwork_id", "size"), people=("account_id", "nunique")).reset_index()
        for k in ["content", "interest", "action", "attach"]:
            pl[k + "_order"] = pl[k].map(order.get(k, {})).fillna(99).astype(int)
        fo = {v: i for i, v in enumerate(LAYERS.get("feelings", []))}
        pl["feeling_order"] = pl["feeling"].map(fo).fillna(99).astype(int)
        save("post_layers", pl, ["mart_action_drop.json（sentence。一般の投稿）", "post_layers.json（4層の読み取り）"])
        has = lc["attach"] != LY_NONE
        mv = lc["content"] == "映画の上映"
        app_kpi.update({
            "ly_posts": int(len(lc)),
            "ly_people": int(lc["account_id"].nunique()),
            "ly_attach_posts": int(has.sum()),
            "ly_attach_pct": round(float(has.mean()) * 100, 1),
            "ly_attach_people": int(lc.loc[has, "account_id"].nunique()),
            "ly_view_posts": int(lc["attach_type"].eq("見方・気持ち").sum()),
            "ly_revisit_posts": int(lc["attach_type"].eq("再訪・滞在").sum()),
            "ly_engage_posts": int(lc["attach_type"].eq("関わり・発信").sum()),
            "ly_movie_posts": int(mv.sum()),
            "ly_movie_attach": int((mv & has).sum()),
        })
        # 4 の読み取りの例。公開範囲が全体（open_range=1）の一般の投稿の行だけ。アカウント名・日時は出さない
        ex = []
        for e in LAYERS.get("examples", []):
            r = gen[(gen["artwork_id"] == e["artwork_id"]) & (gen["open_range"].astype(str) == "1")]
            if r.empty or not lc["artwork_id"].eq(e["artwork_id"]).any():
                continue
            r = r.iloc[0]
            lines = [str(r[f"word{i}"]).strip() for i in e["lines"] if pd.notna(r[f"word{i}"]) and str(r[f"word{i}"]).strip()]
            if lines:
                ex.append({"attach": e["attach"], "attach_type": LAYERS.get("attach_type", {}).get(e["attach"], ""),
                           "attach_order": order.get("attach", {}).get(e["attach"], 99), "text": "\n".join(lines)})
        ex = pd.DataFrame(ex, columns=["attach", "attach_type", "attach_order", "text"])
        ex["no"] = ex.groupby("attach").cumcount() + 1
        save("layer_examples", ex, ["mart_action_drop.json（word1〜word5・open_range）", "post_layers.json（読み取りの例に使う投稿と行）"])
        # 投稿の読み取り（4 があるか）× 特典応募時アンケートの再訪意欲。投稿した人ごと
        pp = lc.groupby("account_id")["attach"].apply(lambda s: bool((s != LY_NONE).any())).rename("has").reset_index()
        pp["post_attach"] = pp["has"].map({True: "愛着が読み取れた", False: "読み取れなかった"})
        pp["survey"] = pp["account_id"].map(feel_of).fillna("応募していない")
        S_ORDER = ["とても高まった", "やや高まった", "どちらでもない", "あまり高まらなかった", "全く高まらなかった", "答えなし", "応募していない"]
        ac = pp.groupby(["post_attach", "survey"]).size().rename("people").reset_index()
        ac["row_order"] = ac["post_attach"].map({"愛着が読み取れた": 0, "読み取れなかった": 1})
        ac["survey_order"] = ac["survey"].map({v: i for i, v in enumerate(S_ORDER)}).fillna(99).astype(int)
        save("attach_cross", ac.sort_values(["row_order", "survey_order"]), ["mart_action_drop.json（一般の投稿）", "post_layers.json（4層の読み取り）", "アンケート分析用 xlsx（特典応募時。運営メンバーを除く）"])
        up = pp["survey"].isin(["とても高まった", "やや高まった"])
        app_kpi.update({
            "ly_attach_applied": int((pp["has"] & (pp["survey"] != "応募していない")).sum()),
            "ly_attach_up": int((pp["has"] & up).sum()),
            "ly_noattach_people": int((~pp["has"]).sum()),
            "ly_noattach_applied": int((~pp["has"] & (pp["survey"] != "応募していない")).sum()),
            "ly_noattach_up": int((~pp["has"] & up).sum()),
        })

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
        "posts_per_poster": round(len(gen) / max(1, gen["account_id"].nunique()), 1),
        "posts_max_person": int(gen.groupby("account_id").size().max()),
        "posts_with_photo_pct": round(float(gen["image_file_path"].notna().mean()) * 100, 1),
        "posts_no_spot_general": int(gen["event_id"].isna().sum()),
        "posts_evening_general": int(gen["hour"].between(17, 22).sum()),
        "posts_evening_pct": round(float(gen["hour"].between(17, 22).mean()) * 100, 1),
        "likes_general": int(len(i_gen)),
        "likes_general_people": int(i_gen["inspiration_account_id"].nunique()),
        "likes_operation": like_op,
        "like_not_in_mart": like_not_in_mart,
        "survey_n": int(sv["account_id"].nunique()),
        "ga_other_unknown": int(ga["group"].isin(["他イベント由来", "要確認"]).sum()),
        "ga_related_users": int((~ga["group"].isin(["他イベント由来", "要確認"])).sum()),
        "ga_cinema_pct_related": round(float(cin.sum()) / int((~ga["group"].isin(["他イベント由来", "要確認"])).sum()) * 100, 1),
        "ga_intranet_users": int((ga["channel"] == "社内イントラ").sum()),
        "ga_search_users": int(ga["site"].isin(["Google検索", "Yahoo!検索", "Bing検索"]).sum()),
        "ga_search_other_pct": round(float((ga["site"].isin(["Google検索", "Yahoo!検索", "Bing検索"]) & (ga["seg"] == "other")).sum()) / max(1, int(ga["site"].isin(["Google検索", "Yahoo!検索", "Bing検索"]).sum())) * 100, 1),
        "ga_search_other_users": int((ga["site"].isin(["Google検索", "Yahoo!検索", "Bing検索"]) & (ga["seg"] == "other")).sum()),
        "reg_pre": int((reg["date"] < EVENT_START).sum()),
        "posts_pre": int((gen["date"] < EVENT_START).sum()),
        "posts_no_spot_pct": round(float(gen["event_id"].isna().mean()) * 100, 1),
        "spots": int(len(em)),
    }
    kpi.update({k: v for k, v in app_kpi.items()})
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
