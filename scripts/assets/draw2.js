// 第1部の新しい図と、要点カードの小さな図
(function () {
  const SC = window.SC;
  const C = SC.C;
  const f0 = d3.format(',');
  const isTrue = (v) => v === true || v === 'true';
  const GROUP_COLOR = {
    '映画祭の告知（オンライン）': C.accent,
    '映画祭の告知（現地・紙）': C.accentLight,
    'UTMなし': C.grayMid,
    '他イベント由来': C.gray,
    '要確認': C.gray,
  };
  const groupColor = (g) => GROUP_COLOR[g] || C.gray;
  // ラベルを「名前」と「（補足）」の2行に分ける
  const split2 = (s) => { const i = String(s).indexOf('（'); return i > 0 ? [s.slice(0, i), s.slice(i)] : [String(s), '']; };

  // ---------- 運営の投稿を含める（切り替え） ----------
  // ページの切り替え（フィルター ops）に合わせて、一般のみ／運営を含む の表を選ぶ
  const OPS = () => (dash.params().ops === 'all' ? 'all' : 'general');
  dash.calc('posts_v', { inputs: ['drop_posts'], title: '投稿の集計（切り替えに合わせた行）', description: '「運営の投稿を含める」の切り替えに合わせて、一般のみ（general）か運営を含む（all）の行を選んだもの',
    fn: (drop_posts) => drop_posts.filter((r) => r.ops === (dash.params().ops === 'all' ? 'all' : 'general')) });
  dash.calc('hour_v', { inputs: ['drop_hour', 'drop_hour_all'], title: '投稿の時刻（切り替えに合わせた表）', description: '切り替えが「運営を含む」なら drop_hour_all、それ以外は drop_hour',
    fn: (drop_hour, drop_hour_all) => (dash.params().ops === 'all' ? drop_hour_all : drop_hour) });
  dash.calc('words_v', { inputs: ['drop_words', 'drop_words_all'], title: '投稿の言葉（切り替えに合わせた表）', description: '切り替えが「運営を含む」なら drop_words_all、それ以外は drop_words',
    fn: (drop_words, drop_words_all) => (dash.params().ops === 'all' ? drop_words_all : drop_words) });
  dash.calc('cooc_v', { inputs: ['drop_cooc', 'drop_cooc_all'], title: '一緒に出た言葉（切り替えに合わせた表）', description: '切り替えが「運営を含む」なら drop_cooc_all、それ以外は drop_cooc',
    fn: (drop_cooc, drop_cooc_all) => (dash.params().ops === 'all' ? drop_cooc_all : drop_cooc) });
  dash.calc('origin_v', { inputs: ['drop_poster_origin', 'drop_poster_origin_all'], title: '投稿した人の登録の経路（切り替えに合わせた表）', description: '切り替えが「運営を含む」なら drop_poster_origin_all（運営メンバーの行つき）、それ以外は drop_poster_origin',
    fn: (drop_poster_origin, drop_poster_origin_all) => (dash.params().ops === 'all' ? drop_poster_origin_all : drop_poster_origin) });

  // ---------- 要点カードの小さな図 ----------

  // 新規訪問者の大分類（100% の帯）
  dash.draw('mini-mix', (el) => {
    const res = SC.ready(el, ['ga_group']);
    if (!res) return;
    const rows = res[0].filter((r) => +r.users > 0);
    const bar = SC.el('span', 'sc-stack is-big');
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', '新規訪問者の流入の大分類の割合');
    const tips = new Map();
    for (const r of rows) {
      const seg = SC.el('span', 'sc-seg' + (r.group === '映画祭の告知（オンライン）' ? ' is-hi' : ''));
      seg.style.flex = `${+r.share_pct} 1 0`;
      seg.style.background = groupColor(r.group);
      if (+r.share_pct >= 12) seg.textContent = `${Math.round(+r.share_pct)}%`;
      tips.set(seg, [r.group, `${f0(r.users)}人（${SC.fmt(r.share_pct, 'pct')}）`]);
      bar.append(seg);
    }
    const leg = SC.el('span', 'sc-mini-leg');
    [['映画祭の告知（オンライン）', C.accent], ['映画祭の告知（現地・紙）', C.accentLight], ['それ以外', C.grayMid]].forEach(([t, c]) => {
      const s = SC.el('span'); const i = SC.el('i'); i.style.background = c; s.append(i, t); leg.append(s);
    });
    el.replaceChildren(bar, leg);
    const tip = SC.tip(el);
    bar.addEventListener('mousemove', (ev) => { const s = ev.target.closest('.sc-seg'); if (s && tips.has(s)) tip.show(ev, tips.get(s)); else tip.hide(); });
    bar.addEventListener('mouseleave', () => tip.hide());
  });

  // 経路の上位5つ（上位2つを強調）
  dash.draw('mini-top', (el) => {
    const res = SC.ready(el, ['ga_channel']);
    if (!res) return;
    const rows = [...res[0]].sort((a, b) => +b.users - +a.users).slice(0, 5);
    const max = +rows[0].users || 1;
    const box = SC.el('span');
    rows.forEach((r, i) => {
      const row = SC.el('span', 'sc-mrow' + (i < 2 ? ' is-hi' : ''));
      const t = SC.el('span', 'sc-mrow-t');
      const bar = SC.el('i'); bar.style.width = `calc((100% - 3.2em) * ${+r.users / max})`;
      t.append(bar, SC.el('b', '', `${f0(r.users)}人`));
      row.append(SC.el('span', 'sc-mrow-l', SC.short(r.channel)), t);
      box.append(row);
    });
    el.replaceChildren(box);
  });

  // ダンベル（告知期間 → 開催期間の1日あたり）。本文の図と小さな図で共用
  const dumbbell = (el, rows, o = {}) => {
    const max = o.max || Math.max(1, Math.ceil(d3.max(rows, (r) => Math.max(+r.pre_daily, +r.during_daily)) / 2) * 2);
    const pos = (v) => `${(+v / max) * 100}%`;
    const box = SC.el(o.compact ? 'span' : 'div', 'sc-db');
    if (o.aria) { box.setAttribute('role', 'group'); box.setAttribute('aria-label', o.aria); }
    if (!o.compact) {
      const ax = SC.el('div', 'sc-db-axis');
      const ticks = SC.el('div', 'sc-db-ticks');
      d3.range(0, max + 0.001, max <= 6 ? 1 : 2).forEach((t) => { const s = SC.el('span', '', String(t)); s.style.left = pos(t); ticks.append(s); });
      ax.append(SC.el('span', '', ''), ticks, SC.el('span', '', '人/日'));
      box.append(ax);
    }
    const tips = new Map();
    for (const r of rows) {
      const a = +r.pre_daily, b = +r.during_daily;
      const dir = b > a ? 'is-up' : (b < a ? 'is-down' : 'is-flat');
      const row = SC.el(o.compact ? 'span' : 'div', 'sc-db-row ' + dir);
      const tr = SC.el('span', 'sc-db-tr');
      const bar = SC.el('i', 'sc-db-bar');
      bar.style.left = pos(Math.min(a, b)); bar.style.width = `${(Math.abs(b - a) / max) * 100}%`;
      const da = SC.el('i', 'sc-db-a'); da.style.left = pos(a);
      const db = SC.el('i', 'sc-db-b'); db.style.left = pos(b);
      tr.append(bar, da, db);
      const v = SC.el('span', 'sc-db-v');
      v.append(`${SC.fmt(a, 'dec1')} → `, SC.el('b', '', SC.fmt(b, 'dec1')), SC.el('small', '', ' 人/日'));
      row.append(SC.el('span', 'sc-db-lab', SC.short(r.channel)), tr, v);
      tips.set(row, [r.channel, `告知期間 ${SC.fmt(a, 'dec1')}人/日（計${r.pre}人・7日）`, `開催期間 ${SC.fmt(b, 'dec1')}人/日（計${r.during}人・5日）`]);
      box.append(row);
    }
    el.replaceChildren(box);
    const tip = SC.tip(el);
    box.addEventListener('mousemove', (ev) => { const r = ev.target.closest('.sc-db-row'); if (r && tips.has(r)) tip.show(ev, tips.get(r)); else tip.hide(); });
    box.addEventListener('mouseleave', () => tip.hide());
  };
  dash.draw('dumbbell', (el) => {
    const res = SC.ready(el, ['ga_channel']);
    if (!res) return;
    const rows = res[0].filter((r) => +r.users >= 10)
      .sort((p, q) => (+q.during_daily - +q.pre_daily) - (+p.during_daily - +p.pre_daily));
    dumbbell(el, rows, { aria: '流入経路ごとの1日あたりの新規訪問者。白い点が告知期間、色の点が開催期間' });
  });
  dash.draw('mini-db', (el) => {
    const res = SC.ready(el, ['ga_channel']);
    if (!res) return;
    const want = (el.dataset.channels || '').split('|');
    const rows = want.map((c) => res[0].find((r) => r.channel === c)).filter(Boolean);
    dumbbell(el, rows, { compact: true, max: Math.max(1, Math.ceil(d3.max(res[0].filter((r) => +r.users >= 10), (r) => Math.max(+r.pre_daily, +r.during_daily)))) });
  });

  // 検索から来た人の、最初に開いたページ
  dash.draw('mini-search', (el) => {
    const res = SC.ready(el, ['ga_flow']);
    if (!res) return;
    const rows = res[0].filter((r) => String(r.ref).startsWith('検索'));
    const by = d3.rollups(rows, (v) => d3.sum(v, (r) => +r.users), (r) => r.landing).sort((a, b) => b[1] - a[1]);
    const total = d3.sum(by, (d) => d[1]) || 1;
    const bar = SC.el('span', 'sc-stack is-big');
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', '検索から来た人が最初に開いたページの割合');
    const tips = new Map();
    const col = (l) => (l.startsWith('他イベント') ? C.accent : (l.startsWith('映画祭') ? C.grayMid : C.gray));
    by.forEach(([l, n]) => {
      const seg = SC.el('span', 'sc-seg' + (l.startsWith('他イベント') ? ' is-hi' : ''));
      seg.style.flex = `${n} 1 0`;
      seg.style.background = col(l);
      if (n / total >= 0.12) seg.textContent = `${n}人`;
      tips.set(seg, [l, `${n}人（検索から来た${total}人のうち）`]);
      bar.append(seg);
    });
    const leg = SC.el('span', 'sc-mini-leg');
    by.forEach(([l]) => { const s = SC.el('span'); const i = SC.el('i'); i.style.background = col(l); s.append(i, split2(l)[0]); leg.append(s); });
    el.replaceChildren(bar, leg);
    const tip = SC.tip(el);
    bar.addEventListener('mousemove', (ev) => { const s = ev.target.closest('.sc-seg'); if (s && tips.has(s)) tip.show(ev, tips.get(s)); else tip.hide(); });
    bar.addEventListener('mouseleave', () => tip.hide());
  });

  // 小さな縦の棒（日別の登録・時刻別の投稿）
  const miniBars = (el, rows, o) => {
    const W = Math.max(200, el.clientWidth || 260), H = 64, b = 14, t = 12;
    el.replaceChildren();
    const svg = d3.select(el).append('svg').attr('class', 'sc-svg').attr('width', W).attr('height', H)
      .attr('role', 'img').attr('aria-label', o.aria);
    const x = d3.scaleBand().domain(rows.map((_, i) => i)).range([0, W]).paddingInner(0.18);
    const max = d3.max(rows, (r) => +r[o.key]) || 1;
    const y = d3.scaleLinear().domain([0, max]).range([H - b, t]);
    if (o.band) {
      const idx = rows.map((r, i) => (o.band(r) ? i : -1)).filter((i) => i >= 0);
      if (idx.length) svg.append('rect').attr('class', 'sc-band').attr('x', x(idx[0]) - 1).attr('y', 0).attr('width', x(idx[idx.length - 1]) + x.bandwidth() - x(idx[0]) + 2).attr('height', H - b);
    }
    rows.forEach((r, i) => {
      const v = +r[o.key];
      if (v) svg.append('rect').attr('x', x(i)).attr('width', x.bandwidth()).attr('y', y(v)).attr('height', H - b - y(v)).attr('rx', 1.5).style('fill', o.color(r));
      if (o.labels && v) svg.append('text').attr('class', 'sc-vlabel').attr('x', x(i) + x.bandwidth() / 2).attr('y', y(v) - 3).attr('text-anchor', 'middle').text(v);
    });
    svg.append('line').attr('class', 'sc-axis').attr('x1', 0).attr('x2', W).attr('y1', H - b).attr('y2', H - b);
    o.ticks.forEach((i) => {
      if (i < 0 || i >= rows.length) return;
      svg.append('text').attr('class', 'sc-tick').attr('x', x(i) + x.bandwidth() / 2).attr('y', H - 2)
        .attr('text-anchor', i === 0 ? 'start' : (i === rows.length - 1 ? 'end' : 'middle')).text(o.x(rows[i]));
    });
    if (o.note) o.note(svg, x, H - b);
    const tip = SC.tip(el);
    svg.append('g').selectAll('rect').data(rows).join('rect').attr('class', 'sc-hit')
      .attr('x', (_, i) => x(i) - (x.step() * x.paddingInner()) / 2).attr('width', x.step()).attr('y', 0).attr('height', H)
      .on('mousemove', (ev, r) => tip.show(ev, o.tip(r))).on('mouseleave', () => tip.hide());
  };
  dash.draw('mini-reg', (el) => {
    const res = SC.ready(el, ['drop_daily']);
    if (!res) return;
    const rows = res[0];
    const during = (r) => r.period === '開催期間';
    const first = rows.findIndex(during);
    miniBars(el, rows, {
      key: 'registrations', aria: '映画祭をきっかけにした新規登録の日別人数', labels: true,
      color: () => C.accent, band: during,
      ticks: [0, first, rows.length - 1], x: (r) => SC.md(r.date),
      tip: (r) => [`${SC.md(r.date)}（${r.period}）`, `新規登録 ${r.registrations}人`],
      note: (svg, x, base) => {
        const pre = rows.map((r, i) => (!during(r) ? i : -1)).filter((i) => i >= 0);
        if (!pre.length) return;
        const n = d3.sum(pre, (i) => +rows[i].registrations);
        const cx = (x(pre[0]) + x(pre[pre.length - 1]) + x.bandwidth()) / 2;
        svg.append('text').attr('class', 'sc-tl-zero').attr('x', cx).attr('y', base - 6).attr('text-anchor', 'middle').text(`告知期間 ${n}人`);
      },
    });
  });
  dash.draw('mini-hour', (el) => {
    const res = SC.ready(el, ['drop_hour']);
    if (!res) return;
    const ev = (r) => +r.hour >= 17 && +r.hour <= 22;
    miniBars(el, res[0], {
      key: 'posts', aria: '一般の投稿の時刻別件数。17〜22時を強調',
      color: (r) => (ev(r) ? C.accent : C.gray),
      ticks: [0, 6, 12, 18], x: (r) => `${r.hour}時`,
      tip: (r) => [`${r.hour}時台`, `一般の投稿 ${r.posts}件`],
    });
  });

  // ---------- 流れ図：リンク元 → 流入経路 → 最初に開いたページ ----------
  let flowSel = null; // 選んだ項目（列番号|名前）
  dash.draw('flow', (el) => {
    const res = SC.ready(el, ['ga_flow']);
    if (!res) return;
    const rows = res[0].map((r) => ({ ...r, users: +r.users }));
    const total = d3.sum(rows, (r) => r.users) || 1;
    const COLS = [
      { key: 'ref', ord: 'ref_order', head: 'リンク元' },
      { key: 'channel', ord: 'channel_order', head: '流入経路（識別タグ）' },
      { key: 'landing', ord: 'landing_order', head: '最初に開いたページ' },
    ];
    const cols = COLS.map((c, ci) => d3.rollups(rows, (v) => ({ v: d3.sum(v, (r) => r.users), o: +v[0][c.ord], group: v[0].group, sites: v[0].ref_sites }), (r) => r[c.key])
      .map(([name, a]) => ({ id: ci + '|' + name, name, col: ci, v: a.v, o: a.o, group: ci === 1 ? a.group : null, sites: ci === 0 ? a.sites : '' }))
      .sort((a, b) => a.o - b.o));
    const byId = new Map(cols.flat().map((n) => [n.id, n]));
    const links = [];
    for (const [s, t] of [[0, 1], [1, 2]]) {
      d3.rollups(rows, (v) => ({ v: d3.sum(v, (r) => r.users), group: v[0].group }), (r) => r[COLS[s].key], (r) => r[COLS[t].key])
        .forEach(([a, m]) => m.forEach(([b, x]) => links.push({ s: byId.get(s + '|' + a), t: byId.get(t + '|' + b), v: x.v, group: x.group })));
    }

    // 大きさ
    const minW = 640;
    const W = Math.max(minW, el.clientWidth || minW);
    const k = 1.0, nodeW = 10, top = 30, minPad = 10;
    const maxN = d3.max(cols, (c) => c.length);
    const inner = total * k + minPad * (maxN - 1);
    const H = top + inner + 20;
    el.replaceChildren();
    const wrap = SC.el('div', 'sc-scroll');
    el.append(wrap);
    const svg = d3.select(wrap).append('svg').attr('class', 'sc-svg').attr('width', W).attr('height', H)
      .attr('role', 'img').attr('aria-label', '新規訪問者の流れ。リンク元のサイトから、識別タグで分けた流入経路を経て、最初に開いたページまで。帯の太さは人数');
    // 右の列のラベル幅をはかる
    const probe = svg.append('text').attr('class', 'sc-fl-lab');
    let rw = 0;
    cols[2].forEach((n) => split2(n.name).forEach((s, i) => { probe.text(i ? s : `${s} ${n.v}`); rw = Math.max(rw, probe.node().getComputedTextLength()); }));
    probe.remove();
    const xs = [0, Math.round((W - rw - 12 - nodeW) * 0.5), W - rw - 12 - nodeW];
    cols.forEach((c, ci) => {
      const pad = c.length > 1 ? (inner - total * k) / (c.length - 1) : 0;
      let y = top;
      c.forEach((n) => { n.x = xs[ci]; n.y = y; n.h = Math.max(1, n.v * k); n.out = 0; n.in = 0; y += n.h + pad; });
    });
    // 帯の位置（出る側は行き先の順、入る側は出どころの順）
    const ord = (n) => n.col * 1000 + n.o;
    [...links].sort((a, b) => ord(a.t) - ord(b.t)).forEach((l) => { l.sy = l.s.y + l.s.out; l.s.out += l.v * k; });
    [...links].sort((a, b) => ord(a.s) - ord(b.s)).forEach((l) => { l.ty = l.t.y + l.t.in; l.t.in += l.v * k; });
    const path = (l) => {
      const x0 = l.s.x + nodeW, x1 = l.t.x, xm = (x0 + x1) / 2, h = l.v * k;
      return `M${x0},${l.sy}C${xm},${l.sy} ${xm},${l.ty} ${x1},${l.ty}L${x1},${l.ty + h}C${xm},${l.ty + h} ${xm},${l.sy + h} ${x0},${l.sy + h}Z`;
    };
    COLS.forEach((c, ci) => svg.append('text').attr('class', 'sc-fl-head').attr('x', ci === 0 ? 0 : xs[ci] + (ci === 2 ? nodeW + 6 : 0)).attr('y', 14)
      .attr('text-anchor', 'start').text(c.head));
    const tip = SC.tip(el);
    const gl = svg.append('g');
    const lsel = gl.selectAll('path').data(links).join('path').attr('class', 'sc-fl-link').attr('d', path)
      .style('fill', (l) => groupColor(l.group))
      .on('mousemove', (ev, l) => tip.show(ev, [`${split2(l.s.name)[0]} → ${SC.short(l.t.name)}`, `${f0(l.v)}人`]))
      .on('mouseleave', () => tip.hide());
    const gn = svg.append('g');
    gn.selectAll('rect').data(cols.flat()).join('rect').attr('class', 'sc-fl-node')
      .attr('x', (n) => n.x).attr('y', (n) => n.y).attr('width', nodeW).attr('height', (n) => n.h).attr('rx', 1.5)
      .style('fill', (n) => (n.col === 1 ? groupColor(n.group) : null));
    // ラベル：左と中は帯の上（白い縁取り）、右は外側
    const labs = cols.flat().map((n) => ({ n, y: n.y + n.h / 2 }));
    cols.forEach((c, ci) => SC.spread(labs.filter((d) => d.n.col === ci), ci === 1 ? 13 : 26, top + 6, H - 6));
    const gt = svg.append('g');
    labs.forEach((d) => {
      const n = d.n;
      const [a, b] = n.col === 1 ? [SC.short(n.name), ''] : split2(n.name);
      const t = gt.append('text').attr('class', 'sc-fl-lab').attr('data-id', n.id)
        .attr('x', n.x + nodeW + 5).attr('y', d.ly).attr('dy', b ? '-0.2em' : '0.35em');
      t.append('tspan').text(a + ' ');
      t.append('tspan').attr('class', 'n').text(f0(n.v));
      if (b) t.append('tspan').attr('class', 'n').attr('x', n.x + nodeW + 5).attr('dy', '1.25em').style('font-size', '11px').text(b);
    });
    // 押したところを通る流れを強くする
    const apply = () => {
      const on = (l) => flowSel && (l.s.id === flowSel || l.t.id === flowSel);
      lsel.classed('is-on', (l) => !!on(l)).classed('is-dim', (l) => !!flowSel && !on(l));
      gt.selectAll('text').classed('is-on', function () { return this.dataset.id === flowSel; });
    };
    const pick = (n) => { flowSel = flowSel === n.id ? null : n.id; apply(); };
    gn.selectAll('rect.sc-fl-hit').data(cols.flat()).join('rect').attr('class', 'sc-fl-hit')
      .attr('x', (n) => n.x - 3).attr('y', (n) => n.y - 4).attr('width', (n) => (n.col === 2 ? rw + nodeW + 12 : 150)).attr('height', (n) => Math.max(14, n.h + 8))
      .attr('tabindex', 0).attr('role', 'button')
      .attr('aria-label', (n) => `${n.name} ${n.v}人。押すと、ここを通る流れを強調`)
      .on('click', (ev, n) => pick(n))
      .on('keydown', (ev, n) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(n); } })
      .on('mousemove', (ev, n) => tip.show(ev, [n.name, `${f0(n.v)}人（全体の${SC.fmt((n.v / total) * 100, 'pct')}）`].concat(n.sites ? [`内訳：${n.sites}`] : []).concat(n.col === 1 ? [n.group] : [])))
      .on('mouseleave', () => tip.hide());
    apply();
  });

  // ---------- 同じ日付の軸で：GA の新規訪問者・DROP の新規登録・一般の投稿 ----------
  dash.draw('timeline', (el) => {
    const res = SC.ready(el, ['ga_daily', 'drop_daily']);
    if (!res) return;
    const [ga, dr] = res;
    const days = ga.map((g) => ({ g, d: dr.find((x) => x.date === g.date) || {} }));
    const W = Math.max(300, el.clientWidth || 600);
    const pk = OPS() === 'all' ? 'posts_all' : 'general';
    const panels = [
      { title: 'GA の新規訪問者（人）', h: 104, max: d3.max(days, (x) => +x.g.total) || 1, segs: (x) => [[+x.g.total, C.gray]], total: (x) => +x.g.total, missing: (x) => isTrue(x.g.ga_missing) },
      { title: 'DROP の新規登録（映画祭きっかけ・人）', h: 56, max: d3.max(days, (x) => +x.d.registrations) || 1, segs: (x) => [[+x.d.registrations, C.accent]], total: (x) => +x.d.registrations, pre: (n) => `告知期間の登録 ${n}人` },
      { title: OPS() === 'all' ? '投稿（運営メンバーを含む・件）' : '一般の投稿（件）', h: 72, max: d3.max(days, (x) => +x.d[pk]) || 1, segs: (x) => [[+x.d[pk], C.gray]], total: (x) => +x.d[pk], pre: () => '告知期間は投稿できない設定' },
    ];
    const gapT = 34, m = { l: 4, r: 4, b: 20 };
    let y0 = 14;
    panels.forEach((p) => { p.top = y0 + gapT; p.base = p.top + p.h; y0 = p.base; });
    const H = y0 + m.b;
    el.replaceChildren();
    const svg = d3.select(el).append('svg').attr('class', 'sc-svg').attr('width', W).attr('height', H)
      .attr('role', 'img').attr('aria-label', '日別の GA 新規訪問者、DROP の新規登録、一般の投稿を同じ日付の軸に並べた図。告知期間は訪問のみで、登録と投稿は開催期間に入ってから');
    const x = d3.scaleBand().domain(days.map((_, i) => i)).range([m.l, W - m.r]).paddingInner(0.22).paddingOuter(0.05);
    const during = days.map((x2, i) => (x2.g.period === '開催期間' ? i : -1)).filter((i) => i >= 0);
    const pre = days.map((x2, i) => (x2.g.period !== '開催期間' ? i : -1)).filter((i) => i >= 0);
    if (during.length) {
      const bx0 = x(during[0]) - (x.step() * x.paddingInner()) / 2;
      const bx1 = x(during[during.length - 1]) + x.bandwidth() + (x.step() * x.paddingInner()) / 2;
      svg.append('rect').attr('class', 'sc-band').attr('x', bx0).attr('y', 0).attr('width', bx1 - bx0).attr('height', y0);
      svg.append('text').attr('class', 'sc-band-label').attr('x', bx0 + 4).attr('y', 12).text('開催期間');
    }
    if (pre.length) svg.append('text').attr('class', 'sc-band-label').attr('x', x(pre[0])).attr('y', 12).text('告知期間');
    panels.forEach((p, pi) => {
      const y = d3.scaleLinear().domain([0, p.max * 1.18]).range([p.base, p.top]);
      svg.append('text').attr('class', 'sc-tl-title').attr('x', m.l).attr('y', p.top - 12).text(p.title);
      if (pi) svg.append('line').attr('class', 'sc-tl-sep').attr('x1', 0).attr('x2', W).attr('y1', p.top - 28).attr('y2', p.top - 28);
      days.forEach((d, i) => {
        if (p.missing && p.missing(d)) {
          svg.append('rect').attr('class', 'sc-hatch').attr('x', x(i)).attr('width', x.bandwidth()).attr('y', p.top + 8).attr('height', p.h - 8);
          svg.append('text').attr('class', 'sc-missing').attr('x', x(i) + x.bandwidth() / 2).attr('y', p.base - 6).attr('text-anchor', 'middle').text('欠損');
          return;
        }
        let acc = 0;
        p.segs(d).forEach(([v, c]) => {
          if (!v) return;
          svg.append('rect').attr('class', 'sc-vbar').attr('x', x(i)).attr('width', x.bandwidth()).attr('y', y(acc + v)).attr('height', y(acc) - y(acc + v)).style('fill', c);
          acc += v;
        });
        const tot = p.total(d);
        if (tot) svg.append('text').attr('class', 'sc-vlabel').attr('x', x(i) + x.bandwidth() / 2).attr('y', y(tot) - 3).attr('text-anchor', 'middle').text(tot);
      });
      if (p.pre && pre.length) {
        const n = d3.sum(pre, (i) => p.total(days[i]));
        const cx = (x(pre[0]) + x(pre[pre.length - 1]) + x.bandwidth()) / 2;
        svg.append('text').attr('class', 'sc-tl-zero').attr('x', cx).attr('y', p.base - 8).attr('text-anchor', 'middle').text(p.pre(n));
      }
      svg.append('line').attr('class', 'sc-axis').attr('x1', m.l).attr('x2', W - m.r).attr('y1', p.base).attr('y2', p.base);
    });
    const every = x.step() < 34 ? 2 : 1;
    days.forEach((d, i) => { if (i % every === 0 || i === days.length - 1) svg.append('text').attr('class', 'sc-tick').attr('x', x(i) + x.bandwidth() / 2).attr('y', H - 5).attr('text-anchor', 'middle').text(SC.md(d.g.date)); });
    const tip = SC.tip(el);
    svg.append('g').selectAll('rect').data(days).join('rect').attr('class', 'sc-hit')
      .attr('x', (_, i) => x(i) - (x.step() * x.paddingInner()) / 2).attr('width', x.step()).attr('y', 0).attr('height', H)
      .on('mousemove', (ev, d) => tip.show(ev, [
        `${SC.md(d.g.date)}（${d.g.period}）`,
        isTrue(d.g.ga_missing) ? 'GA：行が0件（欠損の可能性）' : `GA の新規訪問者 ${d.g.total}人`,
        `DROP の新規登録 ${d.d.registrations}人`,
        OPS() === 'all' ? `投稿 ${d.d.posts_all}件（うち運営メンバー ${d.d.operation}件）` : `一般の投稿 ${d.d.general}件`,
      ]))
      .on('mouseleave', () => tip.hide());
  });

  // ---------- スポット（ドーナツ） ----------
  dash.draw('donut-spot', (el) => {
    const res = SC.ready(el, ['drop_spot', 'posts_v']);
    if (!res) return;
    const [spots, kpi] = res;
    const vk = OPS() === 'all' ? 'total' : 'general';
    const rows = spots.filter((r) => +r[vk] > 0)
      .map((r) => ({ name: r.spot, v: +r[vk], none: r.spot === 'スポット指定なし' }))
      .sort((a, b) => (b.none - a.none) || (b.v - a.v));
    const grays = [C.grayDark, C.grayMid, C.gray, C.grayLight, C.grayLighter];
    rows.forEach((r, i) => { r.color = r.none ? C.accent : grays[Math.min(grays.length - 1, i - 1)]; });
    const total = d3.sum(rows, (r) => r.v) || 1;
    const S = 150, R = S / 2, r0 = R * 0.62;
    const box = SC.el('div', 'sc-donut');
    const holder = SC.el('div');
    box.append(holder);
    const ul = SC.el('ul', 'sc-donut-l');
    rows.forEach((r) => {
      const li = SC.el('li', r.none ? 'is-hi' : '');
      const sw = SC.el('i', 'sc-sw'); sw.style.background = r.color;
      li.append(sw, SC.el('span', '', r.none ? '選んでいない' : r.name), SC.el('b', '', `${r.v}件`));
      ul.append(li);
    });
    box.append(ul);
    el.replaceChildren(box);
    const svg = d3.select(holder).append('svg').attr('class', 'sc-svg').attr('width', S).attr('height', S)
      .attr('role', 'img').attr('aria-label', '一般の投稿で選んだスポットの割合。スポットを選んでいない投稿を強調');
    const g = svg.append('g').attr('transform', `translate(${R},${R})`);
    const arcs = d3.pie().sort(null).value((r) => r.v)(rows);
    const tip = SC.tip(el);
    g.selectAll('path').data(arcs).join('path').attr('d', d3.arc().innerRadius(r0).outerRadius(R - 2).padAngle(0.012))
      .style('fill', (a) => a.data.color)
      .on('mousemove', (ev, a) => tip.show(ev, [a.data.none ? 'スポットを選んでいない' : a.data.name, `${OPS() === 'all' ? '投稿（運営を含む）' : '一般の投稿'} ${a.data.v}件（${SC.fmt((a.data.v / total) * 100, 'pct')}）`]))
      .on('mouseleave', () => tip.hide());
    const k = kpi[0] || {};
    g.append('text').attr('class', 'sc-donut-big').attr('text-anchor', 'middle').attr('dy', '0.1em').text(SC.fmt(k.no_spot_pct, 'pct'));
    g.append('text').attr('class', 'sc-donut-cap').attr('text-anchor', 'middle').attr('dy', '1.6em').text('選んでいない');
  });

  // ---------- 言葉のまとまり ----------
  dash.draw('words-themes', (el) => {
    const res = SC.ready(el, ['words_v']);
    if (!res) return;
    const rows = res[0];
    const mx = d3.max(rows, (r) => +r.people) || 1, mn = d3.min(rows, (r) => +r.people) || 0;
    const groups = d3.groups(rows, (r) => r.theme).sort((a, b) => +a[1][0].theme_order - +b[1][0].theme_order);
    const box = SC.el('div', 'sc-themes');
    const tips = new Map();
    for (const [theme, ws] of groups) {
      const row = SC.el('div', 'sc-theme');
      const h = SC.el('div', 'sc-theme-h', theme);
      h.append(SC.el('small', '', `${ws.length}語`));
      const chips = SC.el('div', 'sc-chips');
      [...ws].sort((a, b) => +b.people - +a.people || +b.posts - +a.posts).forEach((r, i) => {
        const c = SC.el('span', 'sc-chip' + (i === 0 ? ' is-hi' : ''));
        c.style.fontSize = `${12 + 10 * ((+r.people - mn) / Math.max(1, mx - mn))}px`;
        c.append(SC.el('span', '', r.word), SC.el('span', 'sc-chip-n', `${r.people}人`));
        tips.set(c, [r.word, `${r.people}人が使った（投稿した人の${SC.fmt(r.share_pct, 'pct')}）`, `${r.posts}件の投稿に出た`]);
        chips.append(c);
      });
      row.append(h, chips);
      box.append(row);
    }
    el.replaceChildren(box);
    const tip = SC.tip(el);
    box.addEventListener('mousemove', (ev) => { const c = ev.target.closest('.sc-chip'); if (c && tips.has(c)) tip.show(ev, tips.get(c)); else tip.hide(); });
    box.addEventListener('mouseleave', () => tip.hide());
  });

  // ---------- 共起ネットワーク（同じ投稿に一緒に出た言葉） ----------
  let coocSel = '品川'; // はじめに選ぶ言葉
  dash.draw('drop-cooc', (el) => {
    const res = SC.ready(el, ['cooc_v']);
    if (!res) return;
    const rows = res[0];
    const nodes = rows.filter((r) => r.type === 'node').map((r) => ({ id: r.word, people: +r.people, posts: +r.posts, theme: r.theme }));
    const links = rows.filter((r) => r.type === 'edge').map((r) => ({ source: r.source, target: r.target, people: +r.people, posts: +r.posts }));
    if (!nodes.some((n) => n.id === coocSel)) coocSel = nodes.length ? nodes[0].id : null;
    const W = Math.max(300, el.clientWidth || 600), H = 340 + Math.max(0, nodes.length - 14) * 14, pad = 42;
    const rr = d3.scaleSqrt().domain([0, d3.max(nodes, (n) => n.people) || 1]).range([0, 24]);
    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id((d) => d.id).distance((l) => 60 + 40 / l.people).strength(0.7))
      .force('charge', d3.forceManyBody().strength(-280))
      .force('x', d3.forceX(0).strength(0.07)).force('y', d3.forceY(0).strength(0.12))
      .force('collide', d3.forceCollide((d) => rr(d.people) + 20)).stop();
    for (let i = 0; i < 320; i++) sim.tick();
    const xs = d3.extent(nodes, (n) => n.x), ys = d3.extent(nodes, (n) => n.y);
    const k = Math.min(1.5, (W - 2 * pad - 60) / Math.max(1, xs[1] - xs[0]), (H - 2 * pad) / Math.max(1, ys[1] - ys[0]));
    nodes.forEach((n) => { n.px = W / 2 + (n.x - (xs[0] + xs[1]) / 2) * k; n.py = H / 2 + (n.y - (ys[0] + ys[1]) / 2) * k; });
    el.replaceChildren();
    const svg = d3.select(el).append('svg').attr('class', 'sc-svg').attr('width', W).attr('height', H)
      .attr('role', 'img').attr('aria-label', '投稿に一緒に出た言葉のつながり。線は2人以上が同じ投稿で一緒に使った組み合わせ');
    const tip = SC.tip(el);
    const ls = svg.append('g').selectAll('line').data(links).join('line').attr('class', 'sc-cn-link')
      .attr('x1', (l) => l.source.px).attr('y1', (l) => l.source.py).attr('x2', (l) => l.target.px).attr('y2', (l) => l.target.py)
      .attr('stroke-width', (l) => 1.5 + (l.people - 2) * 2)
      .on('mousemove', (ev, l) => tip.show(ev, [`${l.source.id} × ${l.target.id}`, `${l.people}人が同じ投稿で一緒に使った（${l.posts}件）`]))
      .on('mouseleave', () => tip.hide());
    const ns = svg.append('g').selectAll('g').data(nodes).join('g').attr('class', 'sc-cn-node')
      .attr('transform', (n) => `translate(${n.px},${n.py})`).attr('tabindex', 0).attr('role', 'button')
      .attr('aria-label', (n) => `${n.id}（${n.people}人）。押すと、この言葉と一緒に使われた言葉を強調`);
    ns.append('circle').attr('r', (n) => Math.max(5, rr(n.people)));
    const lab = ns.append('text').attr('class', 'sc-cn-lab').attr('x', (n) => Math.max(5, rr(n.people)) + 4).attr('dy', '0.35em');
    lab.append('tspan').text((n) => n.id);
    lab.append('tspan').attr('dx', 3).text((n) => `${n.people}人`);
    const info = SC.el('p', 'sc-cn-info');
    el.append(info);
    const apply = () => {
      const nb = new Map();
      links.forEach((l) => {
        if (l.source.id === coocSel) nb.set(l.target.id, l);
        if (l.target.id === coocSel) nb.set(l.source.id, l);
      });
      ls.classed('is-on', (l) => l.source.id === coocSel || l.target.id === coocSel)
        .classed('is-dim', (l) => !(l.source.id === coocSel || l.target.id === coocSel));
      ns.classed('is-sel', (n) => n.id === coocSel).classed('is-nb', (n) => nb.has(n.id))
        .classed('is-dim', (n) => n.id !== coocSel && !nb.has(n.id));
      const list = [...nb.entries()].sort((a, b) => b[1].people - a[1].people || b[1].posts - a[1].posts)
        .map(([w, l]) => `${w} ${l.people}人`);
      info.replaceChildren(SC.el('b', '', `「${coocSel}」と一緒に使われた言葉：`), list.length ? list.join('・') : '（2人以上の組み合わせはありません）');
    };
    const pick = (n) => { coocSel = n.id; apply(); };
    ns.on('click', (ev, n) => pick(n))
      .on('keydown', (ev, n) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(n); } })
      .on('mousemove', (ev, n) => tip.show(ev, [n.id, `${n.people}人が使った（${n.posts}件の投稿）`, `まとまり：${n.theme}`]))
      .on('mouseleave', () => tip.hide());
    apply();
  });
})();
