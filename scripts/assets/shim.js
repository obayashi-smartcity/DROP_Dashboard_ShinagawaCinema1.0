// claude.ai のダッシュボード（dash）と同じ呼び方で描画コードを動かすための小さな置き換え。
// データは window.DASH_DATA（パスワードで復号した集計表）から渡す。
// dash.calc（集計表から作る表）と dash.params／setParams（「運営の投稿を含める」の切り替え）にも対応する。
window.DASH_DATA = {};
(function () {
  const draws = [];
  const calcs = {};
  const params = { ops: 'general' };   // 切り替えの初期値（一般の投稿だけ）
  const rows = (id) => {
    if (calcs[id]) {
      const c = calcs[id];
      if (c.inputs.some((i) => !window.DASH_DATA[i])) return null;
      return c.fn(...c.inputs.map((i) => window.DASH_DATA[i]));
    }
    return window.DASH_DATA[id] || null;
  };
  window.dash = {
    data: (id) => {
      try {
        const r = rows(id);
        return r ? { status: 'ok', data: r } : { status: 'missing', data: [] };
      } catch (e) {
        console.error(id, e);
        return { status: 'error', data: [] };
      }
    },
    calc: (id, def) => { calcs[id] = def; },
    draw: (name, fn) => { draws.push([name, fn]); },
    onData: (fn) => fn(),
    setLink: (name) => { try { history.replaceState(null, '', '#' + name); } catch (e) { /* 何もしない */ } },
    params: () => ({ ...params }),
    setParams: (o) => { Object.assign(params, o || {}); if (window.__runDraws) window.__runDraws(); },
    resetParams: () => { Object.keys(params).forEach((k) => delete params[k]); params.ops = 'general'; if (window.__runDraws) window.__runDraws(); },
    refresh: () => { if (window.__runDraws) window.__runDraws(); },
    colors: [],
  };
  window.__runDraws = () => {
    for (const [name, fn] of draws) {
      document.querySelectorAll('[data-draw="' + name + '"]').forEach((el) => {
        try { fn(el); } catch (e) { console.error(name, e); }
      });
    }
  };
})();
