// claude.ai のダッシュボード（dash）と同じ呼び方で描画コードを動かすための小さな置き換え。
// データは window.DASH_DATA（パスワードで復号した集計表）から渡す。
window.DASH_DATA = {};
(function () {
  const draws = [];
  window.dash = {
    data: (id) => (window.DASH_DATA[id] ? { status: 'ok', data: window.DASH_DATA[id] } : { status: 'missing', data: [] }),
    draw: (name, fn) => { draws.push([name, fn]); },
    onData: (fn) => fn(),
    setLink: (name) => { try { history.replaceState(null, '', '#' + name); } catch (e) { /* 何もしない */ } },
    params: () => ({}), setParams: () => {}, resetParams: () => {}, refresh: () => {}, colors: [],
  };
  window.__runDraws = () => {
    for (const [name, fn] of draws) {
      document.querySelectorAll('[data-draw="' + name + '"]').forEach((el) => {
        try { fn(el); } catch (e) { console.error(name, e); }
      });
    }
  };
})();
