// ページの動き：暗い表示の判定、「運営の投稿を含める」の切り替え、目次（押すと移動・いま見ている節に印）
// 本文を表示したあとに app.js から呼ぶ。
window.__setupPage = function () {
  // 暗い表示では、紺の見出しなどを明るい色にする（文字色の明るさで判定）
  document.querySelectorAll('.sc').forEach((root) => {
    const m = (getComputedStyle(root).color || '').match(/\d+/g);
    if (m && 0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2] > 150) root.classList.add('sc-dark');
  });
  // 運営の投稿を含める：どのチェックボックスも同じフィルター（ops）を切りかえる
  const boxes = [...document.querySelectorAll('.sc-ops-in')];
  const sync = () => { let on = false; try { on = dash.params().ops === 'all'; } catch (e) {} boxes.forEach((b) => { b.checked = on; }); };
  boxes.forEach((b) => b.addEventListener('change', () => {
    try { dash.setParams({ ops: b.checked ? 'all' : 'general' }); } catch (e) {}
    sync();
  }));
  sync();
  const go = (id, smooth) => {
    const t = document.getElementById(id);
    if (!t) return;
    if (t.tagName === 'DETAILS') t.open = true;
    t.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  };
  document.querySelectorAll('[data-jump],[data-go]').forEach((a) => {
    a.addEventListener('click', (ev) => {
      const id = a.dataset.jump || a.dataset.go;
      if (!id) return;
      ev.preventDefault();
      go(id, true);
      try { dash.setLink(id); } catch (e) {}
    });
  });
  // 目次：いま見ている節に印をつける
  const links = [...document.querySelectorAll('.sc-toc a[data-jump]')];
  const secs = links.map((a) => document.getElementById(a.dataset.jump)).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    const seen = new Map();
    const io = new IntersectionObserver((ents) => {
      ents.forEach((e) => seen.set(e.target.id, e.isIntersecting));
      const on = secs.filter((s) => seen.get(s.id));
      const cur = on.length ? on[on.length - 1].id : null;
      if (!cur) return;
      links.forEach((a) => a.classList.toggle('is-on', a.dataset.jump === cur));
    }, { root: document, rootMargin: '0px 0px -65% 0px' });
    secs.forEach((s) => io.observe(s));
  }
  const h = decodeURIComponent((location.hash || '').slice(1));
  if (h) setTimeout(() => go(h, false), 400);
};
