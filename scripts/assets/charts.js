(function () {
  const SC = (window.SC = {});
  SC.C = { accent: '#BE258D', gray: '#B9C4C9', grayDark: '#5B6770', pre: '#BFAAEF', during: '#6239A0', teal: '0,153,174' };

  SC.fmt = (v, f) => {
    if (v === null || v === undefined || v === '' || (typeof v === 'number' && isNaN(v))) return '—';
    const n = +v;
    if (f === 'pct') return n.toFixed(1) + '%';
    if (f === 'dec1') return n.toFixed(1);
    if (f === 'int') return d3.format(',')(n);
    return String(v);
  };
  SC.md = (s) => { const p = String(s).split('-'); return +p[1] + '/' + +p[2]; };

  SC.pick = (rows, el) => {
    if (el.dataset.row != null) return rows[+el.dataset.row];
    if (el.dataset.where) {
      const conds = el.dataset.where.split('&').map((p) => p.split('=').map(decodeURIComponent));
      return rows.find((r) => conds.every(([k, v]) => String(r[k]) === v));
    }
    return rows[0];
  };

  // 読み込み状態の処理：rows の配列を返す。読み込み中・失敗なら null
  SC.ready = (el, ids) => {
    const ds = ids.map((id) => dash.data(id));
    if (ds.some((d) => d.status === 'loading')) return null;
    el.classList.remove('dash-skeleton');
    const bad = ds.find((d) => d.status !== 'ok');
    if (bad) {
      if (bad.status === 'error' || bad.status === 'missing') {
        const p = document.createElement('p');
        p.className = 'sc-err';
        p.textContent = 'この図のデータを読み込めませんでした。';
        el.replaceChildren(p);
      } else el.replaceChildren('—');
      return null;
    }
    return ds.map((d) => d.data);
  };

  SC.tip = (el) => {
    const t = document.createElement('div');
    t.className = 'sc-tip';
    t.hidden = true;
    el.append(t);
    return {
      show(ev, lines) {
        t.replaceChildren(...lines.map((s, i) => { const d = document.createElement('div'); d.textContent = s; if (i === 0) d.className = 'sc-tip-h'; return d; }));
        t.hidden = false;
        const b = el.getBoundingClientRect();
        let x = ev.clientX - b.left + 14;
        const y = ev.clientY - b.top + 14;
        if (x + t.offsetWidth > el.clientWidth) x = Math.max(0, ev.clientX - b.left - t.offsetWidth - 14);
        t.style.left = x + 'px';
        t.style.top = y + 'px';
      },
      hide() { t.hidden = true; },
    };
  };

  // 横棒（HTML）。items: {type:'header', text, sub} か {label, sub, segs:[{v,color}], valueText, tip:[...]}
  SC.hbars = (el, items, o = {}) => {
    const bars = items.filter((i) => i.segs);
    const max = o.max || d3.max(bars, (i) => d3.sum(i.segs, (s) => +s.v || 0)) || 1;
    const wrap = document.createElement('div');
    wrap.className = 'sc-hb';
    if (o.labelWidth) wrap.style.setProperty('--sc-lw', o.labelWidth);
    const tips = new Map();
    for (const it of items) {
      if (it.type === 'note') {
        const n = document.createElement('div');
        n.className = 'sc-hb-note';
        n.textContent = it.text;
        wrap.append(n);
        continue;
      }
      if (it.type === 'header') {
        const h = document.createElement('div');
        h.className = 'sc-hb-head';
        const a = document.createElement('span'); a.textContent = it.text; h.append(a);
        if (it.sub) { const b = document.createElement('span'); b.className = 'sc-hb-headsub'; b.textContent = it.sub; h.append(b); }
        wrap.append(h);
        continue;
      }
      const row = document.createElement('div');
      row.className = 'sc-hb-row';
      const lab = document.createElement('div');
      lab.className = 'sc-hb-label';
      lab.textContent = it.label;
      if (it.sub) { const s = document.createElement('div'); s.className = 'sc-hb-sub'; s.textContent = it.sub; lab.append(s); }
      const track = document.createElement('div');
      track.className = 'sc-hb-track';
      for (const s of it.segs) {
        const v = +s.v || 0;
        if (!v) continue;
        const b = document.createElement('div');
        b.className = 'sc-hb-bar';
        b.style.width = `calc((100% - ${o.valW || '7.5em'}) * ${v / max})`;
        b.style.background = s.color;
        track.append(b);
      }
      const val = document.createElement('span');
      val.className = 'sc-hb-val';
      val.textContent = it.valueText;
      track.append(val);
      row.append(lab, track);
      wrap.append(row);
      if (it.tip) tips.set(row, it.tip);
    }
    el.replaceChildren(wrap);
    const tip = SC.tip(el);
    wrap.addEventListener('mousemove', (ev) => { const r = ev.target.closest('.sc-hb-row'); if (r && tips.has(r)) tip.show(ev, tips.get(r)); else tip.hide(); });
    wrap.addEventListener('mouseleave', () => tip.hide());
  };

  // 縦棒（SVG、積み上げ可）
  SC.vbars = (el, o) => {
    const W = Math.max(280, el.clientWidth || 600);
    const H = o.height || 220;
    const subH = o.sub ? 20 : 0;
    el.replaceChildren();
    const svg = d3.select(el).append('svg').attr('class', 'sc-svg').attr('width', W).attr('height', H + subH)
      .attr('role', 'img').attr('aria-label', o.aria);
    const stacks = o.rows.map((r) => { let y0 = 0; return o.series.map((s) => { const v = +r[s.key] || 0; const seg = { r, s, y0, y1: y0 + v, v }; y0 += v; return seg; }); });
    const maxY = d3.max(stacks, (st) => st[st.length - 1].y1) || 1;
    const y0 = d3.scaleLinear().domain([0, maxY * 1.12]).nice();
    const ticks = y0.ticks(4).filter(Number.isInteger);
    const probe = svg.append('text').attr('class', 'sc-tick');
    let lw = 0;
    ticks.forEach((t) => { probe.text(d3.format(',')(t)); lw = Math.max(lw, probe.node().getComputedTextLength()); });
    probe.remove();
    const m = { l: o.noYAxis ? 4 : Math.ceil(lw) + 10, r: 6, t: (o.band ? 20 : 8) + (o.ann ? 16 : 0), b: 24 };
    const y = y0.range([H - m.b, m.t]);
    const x = d3.scaleBand().domain(o.rows.map((_, i) => i)).range([m.l, W - m.r]).paddingInner(0.25).paddingOuter(0.1);
    if (o.band) {
      const idx = o.rows.map((r, i) => (o.band.test(r) ? i : -1)).filter((i) => i >= 0);
      if (idx.length) {
        const bx0 = x(idx[0]) - (x.step() * x.paddingInner()) / 2;
        const bx1 = x(idx[idx.length - 1]) + x.bandwidth() + (x.step() * x.paddingInner()) / 2;
        svg.append('rect').attr('class', 'sc-band').attr('x', bx0).attr('y', m.t - 16).attr('width', bx1 - bx0).attr('height', H - m.b - m.t + 16);
        svg.append('text').attr('class', 'sc-band-label').attr('x', bx0 + 4).attr('y', m.t - 4).text(o.band.label);
      }
    }
    if (!o.noYAxis) svg.append('g').selectAll('line').data(ticks).join('line').attr('class', 'sc-gridline')
      .attr('x1', m.l).attr('x2', W - m.r).attr('y1', (t) => y(t)).attr('y2', (t) => y(t));
    if (!o.noYAxis) svg.append('g').selectAll('text').data(ticks).join('text').attr('class', 'sc-tick')
      .attr('x', m.l - 6).attr('y', (t) => y(t)).attr('dy', '0.32em').attr('text-anchor', 'end').text((t) => d3.format(',')(t));
    const g = svg.append('g');
    stacks.forEach((st, i) => {
      st.forEach((seg) => {
        if (!seg.v) return;
        g.append('rect').attr('class', 'sc-vbar').attr('x', x(i)).attr('width', x.bandwidth())
          .attr('y', y(seg.y1)).attr('height', Math.max(0, y(seg.y0) - y(seg.y1)))
          .style('fill', seg.s.color ? (typeof seg.s.color === 'function' ? seg.s.color(seg.r) : seg.s.color) : SC.C.gray);
      });
      const tot = st[st.length - 1].y1;
      const r = o.rows[i];
      if (o.missing && o.missing(r)) {
        svg.append('text').attr('class', 'sc-missing').attr('x', x(i) + x.bandwidth() / 2).attr('y', H - m.b - 6).attr('text-anchor', 'middle').text(o.missingText || 'なし');
      } else if (tot && o.showTotals !== false) {
        svg.append('text').attr('class', 'sc-vlabel').attr('x', x(i) + x.bandwidth() / 2).attr('y', y(tot) - 4).attr('text-anchor', 'middle').text(d3.format(',')(tot));
      }
    });
    svg.append('line').attr('class', 'sc-axis').attr('x1', m.l).attr('x2', W - m.r).attr('y1', H - m.b).attr('y2', H - m.b);
    // 注記（例：配信日・開幕日）。o.ann = [{test(r), text}]
    (o.ann || []).forEach((a) => {
      const i = o.rows.findIndex(a.test);
      if (i < 0) return;
      const cx = x(i) + x.bandwidth() / 2;
      const top = y(stacks[i][stacks[i].length - 1].y1) - 16;
      svg.append('line').attr('class', 'sc-ann-line').attr('x1', cx).attr('x2', cx).attr('y1', 15).attr('y2', Math.max(18, top));
      const t = svg.append('text').attr('class', 'sc-ann').attr('x', cx).attr('y', 11).attr('text-anchor', 'middle').text(a.text);
      const w = t.node().getComputedTextLength();
      if (cx - w / 2 < m.l) t.attr('text-anchor', 'start').attr('x', Math.max(m.l, cx - 6));
      else if (cx + w / 2 > W) t.attr('text-anchor', 'end').attr('x', Math.min(W, cx + 6));
    });
    const every = o.every || (x.step() < 30 ? Math.ceil(30 / x.step()) : 1);
    o.rows.forEach((r, i) => {
      if (i % every) return;
      svg.append('text').attr('class', 'sc-tick').attr('x', x(i) + x.bandwidth() / 2).attr('y', H - m.b + 15).attr('text-anchor', 'middle').text(o.x(r));
    });
    if (o.sub) {
      o.rows.forEach((r, i) => {
        svg.append('text').attr('class', 'sc-sub').attr('x', x(i) + x.bandwidth() / 2).attr('y', H + 12).attr('text-anchor', 'middle').text(o.sub(r));
      });
    }
    const tip = SC.tip(el);
    svg.append('g').selectAll('rect').data(o.rows).join('rect').attr('class', 'sc-hit')
      .attr('x', (_, i) => x(i) - (x.step() * x.paddingInner()) / 2).attr('width', x.step()).attr('y', 0).attr('height', H + subH)
      .on('mousemove', (ev, r) => tip.show(ev, o.tip(r))).on('mouseleave', () => tip.hide());
  };
})();

// ---- v2 追加 ----
(function () {
  const SC = window.SC;
  Object.assign(SC.C, { accentLight: '#E7A3CF', grayLight: '#D3DADD', grayLighter: '#E6EAEC', grayMid: '#8A979D', up: '#0099AE', down: '#E07B39' });
  SC.short = (s) => String(s).replace(/（.*?）/g, '');
  // ラベルの重なりを避けて y をずらす（arr: {y} → ly を付ける）
  SC.spread = (arr, gap, lo, hi) => {
    const a = [...arr].sort((p, q) => p.y - q.y);
    a.forEach((d, i) => { d.ly = i ? Math.max(d.y, a[i - 1].ly + gap) : Math.max(d.y, lo); });
    for (let i = a.length - 1; i >= 0; i--) {
      const lim = i === a.length - 1 ? hi : a[i + 1].ly - gap;
      if (a[i].ly > lim) a[i].ly = lim;
    }
    return arr;
  };
  SC.el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
})();
