(function () {
  const SC = window.SC;
  const C = SC.C;
  const f0 = d3.format(',');

  // 文中・カードの数値
  dash.draw('v', (el) => {
    const d = dash.data(el.dataset.source);
    if (d.status === 'loading') return;
    el.classList.remove('dash-skeleton');
    if (d.status !== 'ok') { el.textContent = '—'; return; }
    const row = SC.pick(d.data, el);
    el.textContent = SC.fmt(row ? row[el.dataset.field] : null, el.dataset.fmt);
  });

  // 流入経路別の新規訪問者数
  dash.draw('ch-bars', (el) => {
    const res = SC.ready(el, ['ga_channel', 'ga_group']);
    if (!res) return;
    const [rows, groups] = res;
    const items = [];
    for (const gr of groups) {
      const rs = rows.filter((r) => r.group === gr.group).sort((a, b) => +a.rank - +b.rank);
      if (!rs.length) continue;
      items.push({ type: 'header', text: gr.group, sub: `${f0(gr.users)}人・${SC.fmt(gr.share_pct, 'pct')}` });
      for (const r of rs) {
        const cin = r.is_cinema === true || r.is_cinema === 'true';
        items.push({
          label: r.channel,
          segs: [{ v: +r.users, color: cin ? C.accent : C.gray }],
          valueText: `${f0(r.users)}人（${SC.fmt(r.share_pct, 'pct')}）`,
          tip: [r.channel, `新規訪問者 ${f0(r.users)}人（全体の${SC.fmt(r.share_pct, 'pct')}）`, `告知期間 ${r.pre}人／開催期間 ${r.during}人`, `utm_source：${r.utm}`, `参照元：${r.sites}`, r.note],
        });
      }
    }
    SC.hbars(el, items, { labelWidth: '13em', valW: '7.5em' });
  });

  // 日別の新規訪問者
  dash.draw('ga-daily', (el) => {
    const res = SC.ready(el, ['ga_daily']);
    if (!res) return;
    const [rows] = res;
    SC.vbars(el, {
      rows,
      aria: '日別の新規訪問者数。映画祭の告知経由とそれ以外の積み上げ棒グラフ',
      x: (r) => SC.md(r.date),
      series: [{ key: 'cinema', color: C.accent }, { key: 'other', color: C.gray }],
      band: { test: (r) => r.period === '開催期間', label: '開催期間' },
      missing: (r) => r.ga_missing === true || r.ga_missing === 'true',
      missingText: '欠損',
      tip: (r) => (r.ga_missing === true || r.ga_missing === 'true')
        ? [SC.md(r.date) + '（' + r.period + '）', 'GAの行が0件（欠損の可能性）']
        : [SC.md(r.date) + '（' + r.period + '）', `合計 ${r.total}人`, `映画祭の告知経由 ${r.cinema}人`, `それ以外 ${r.other}人`],
    });
  });

  // 流入経路×日別（ヒートマップ）
  dash.draw('ga-heat', (el) => {
    const res = SC.ready(el, ['ga_daily_channel', 'ga_channel', 'ga_daily']);
    if (!res) return;
    const [cells, chs, days] = res;
    const max = d3.max(cells, (c) => +c.users) || 1;
    const val = new Map(cells.map((c) => [c.channel + '|' + c.date, +c.users]));
    const wrap = document.createElement('div');
    wrap.className = 'sc-scroll';
    const t = document.createElement('table');
    t.className = 'sc-heat';
    const thead = t.createTHead();
    const h1 = thead.insertRow();
    const corner = document.createElement('th'); corner.rowSpan = 2; corner.textContent = '流入経路'; corner.className = 'sc-heat-ch'; h1.append(corner);
    const periods = d3.groups(days, (d) => d.period);
    for (const [p, ds] of periods) { const th = document.createElement('th'); th.colSpan = ds.length; th.textContent = p; th.className = 'sc-heat-period'; h1.append(th); }
    const tot = document.createElement('th'); tot.rowSpan = 2; tot.textContent = '合計'; h1.append(tot);
    const h2 = thead.insertRow();
    for (const d of days) { const th = document.createElement('th'); th.textContent = SC.md(d.date); h2.append(th); }
    const tb = t.createTBody();
    for (const ch of [...chs].sort((a, b) => +a.rank - +b.rank)) {
      const tr = tb.insertRow();
      const th = document.createElement('th'); th.textContent = ch.channel; th.className = 'sc-heat-ch'; tr.append(th);
      for (const d of days) {
        const td = tr.insertCell();
        const missing = d.ga_missing === true || d.ga_missing === 'true';
        const v = val.get(ch.channel + '|' + d.date) || 0;
        if (missing) { td.className = 'sc-heat-missing'; td.textContent = ''; }
        else {
          const a = v ? 0.12 + 0.88 * (v / max) : 0;
          td.style.background = v ? `rgba(${C.teal},${a.toFixed(2)})` : 'transparent';
          if (a > 0.55) td.style.color = '#fff';
          td.textContent = v ? String(v) : '·';
          if (!v) td.classList.add('sc-heat-zero');
        }
        td.dataset.tip = missing ? `${ch.channel}|${SC.md(d.date)}：GA欠損の可能性` : `${ch.channel}|${SC.md(d.date)}（${d.period}）：${v}人`;
      }
      const tt = tr.insertCell(); tt.className = 'sc-heat-total'; tt.textContent = f0(ch.users);
    }
    wrap.append(t);
    el.replaceChildren(wrap);
    const tip = SC.tip(el);
    t.addEventListener('mousemove', (ev) => { const td = ev.target.closest('td'); if (td && td.dataset.tip) tip.show(ev, td.dataset.tip.split('|')); else tip.hide(); });
    t.addEventListener('mouseleave', () => tip.hide());
  });

  // 表：流入経路の一覧
  dash.draw('ga-channel-body', (tb) => {
    const d = dash.data('ga_channel');
    if (d.status !== 'ok') { tb.replaceChildren(); return; }
    tb.replaceChildren();
    for (const r of [...d.data].sort((a, b) => +a.rank - +b.rank)) {
      const tr = tb.insertRow();
      const cells = [r.group, r.channel, r.utm, f0(r.users), SC.fmt(r.share_pct, 'pct'), r.pre, r.during, r.sites, r.note];
      cells.forEach((c, i) => { const td = tr.insertCell(); td.textContent = c; if (i >= 3 && i <= 6) td.className = 'sc-num'; });
    }
  });

  // 表：着地ページ
  dash.draw('ga-landing-body', (tb) => {
    const d = dash.data('ga_landing');
    if (d.status !== 'ok') { tb.replaceChildren(); return; }
    tb.replaceChildren();
    for (const r of d.data) {
      const tr = tb.insertRow();
      [r.landing, f0(r.users), SC.fmt(r.share_pct, 'pct'), r.cinema_online, r.cinema_onsite, r.no_utm, r.other_event, r.unknown]
        .forEach((c, i) => { const td = tr.insertCell(); td.textContent = c; if (i) td.className = 'sc-num'; });
    }
  });

  // 日別の投稿数と新規登録
  dash.draw('drop-daily', (el) => {
    const res = SC.ready(el, ['drop_daily']);
    if (!res) return;
    const rows = res[0].filter((r) => r.period === '開催期間');
    SC.vbars(el, {
      rows,
      aria: '開催期間の日別投稿数（一般投稿と運営投稿の積み上げ）と新規登録数',
      x: (r) => SC.md(r.date),
      series: [{ key: 'general', color: C.accent }, { key: 'operation', color: C.gray }],
      sub: (r) => `登録 ${r.registrations}`,
      tip: (r) => [SC.md(r.date), `一般投稿 ${r.general}件`, `運営の投稿 ${r.operation}件`, `映画祭きっかけの新規登録 ${r.registrations}人`],
    });
  });

  // スポット別
  dash.draw('drop-spot', (el) => {
    const res = SC.ready(el, ['drop_spot']);
    if (!res) return;
    const items = res[0].map((r) => ({
      label: r.spot,
      segs: [{ v: +r.general, color: C.accent }, { v: +r.operation, color: C.gray }],
      valueText: `一般${r.general}・運営${r.operation}`,
      tip: [r.spot, `一般投稿 ${r.general}件`, `運営の投稿 ${r.operation}件`],
    }));
    SC.hbars(el, items, { labelWidth: '14em', valW: '7.5em' });
  });

  // 投稿時刻
  dash.draw('drop-hour', (el) => {
    const res = SC.ready(el, ['drop_hour']);
    if (!res) return;
    const rows = res[0];
    SC.vbars(el, {
      rows,
      height: 190,
      aria: '一般投稿の時刻別件数。17〜22時を強調',
      x: (r) => String(r.hour),
      every: 3,
      series: [{ key: 'posts', color: (r) => (+r.hour >= 17 && +r.hour <= 22 ? C.accent : C.gray) }],
      tip: (r) => [`${r.hour}時台`, `一般投稿 ${r.posts}件`],
    });
  });

  // 表：年代・性別
  const attrBody = (id, key) => (tb) => {
    const d = dash.data(id);
    if (d.status !== 'ok') { tb.replaceChildren(); return; }
    tb.replaceChildren();
    for (const r of d.data) {
      const tr = tb.insertRow();
      [r[key], r.posters, r.registrants].forEach((c, i) => { const td = tr.insertCell(); td.textContent = c; if (i) td.className = 'sc-num'; });
    }
  };
  dash.draw('drop-age-body', attrBody('drop_age', 'age_group'));
  dash.draw('drop-gender-body', attrBody('drop_gender', 'gender'));

  // アンケート（番号のまま）
  dash.draw('survey', (el) => {
    const res = SC.ready(el, ['survey_codes']);
    if (!res) return;
    const q = el.dataset.q;
    const rows = res[0].filter((r) => r.question === q);
    const items = rows.map((r) => ({
      label: r.label,
      segs: [{ v: +r.n, color: C.gray }],
      valueText: `${r.n}人`,
      tip: [`${q} ${r.label}`, `${r.n}人`],
    }));
    SC.hbars(el, items, { labelWidth: '3.5em', valW: '3em' });
  });

  // 流入の大分類（100%の帯）
  dash.draw('ga-mix', (el) => {
    const res = SC.ready(el, ['ga_group']);
    if (!res) return;
    const rows = res[0].filter((r) => +r.users > 0);
    const col = { '映画祭の告知（オンライン）': C.accent, '映画祭の告知（現地・紙）': C.accentLight, 'UTMなし': C.gray, '他イベント由来': C.grayLight, '要確認': C.grayLighter };
    const tips = new Map();
    const bar = SC.el('div', 'sc-mix-bar');
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', '新規訪問者の流入の大分類の構成比');
    for (const r of rows) {
      const seg = SC.el('div', 'sc-mix-seg');
      seg.style.flex = `${+r.share_pct} 1 0`;
      seg.style.background = col[r.group] || C.gray;
      if (+r.share_pct >= 8) {
        const t = SC.el('span', '', `${Math.round(+r.share_pct)}%`);
        if ((col[r.group] || '') === C.accent) t.style.color = '#fff';
        seg.append(t);
      }
      tips.set(seg, [r.group, `${f0(r.users)}人（${SC.fmt(r.share_pct, 'pct')}）`]);
      bar.append(seg);
    }
    const leg = SC.el('div', 'sc-mix-legend');
    for (const r of rows) {
      const it = SC.el('div', 'sc-mix-item');
      const sw = SC.el('i', 'sc-sw'); sw.style.background = col[r.group] || C.gray;
      it.append(sw, SC.el('span', 'sc-mix-name', r.group), SC.el('span', 'sc-mix-val', `${f0(r.users)}人・${SC.fmt(r.share_pct, 'pct')}`));
      leg.append(it);
    }
    el.replaceChildren(bar, leg);
    const tip = SC.tip(el);
    bar.addEventListener('mousemove', (ev) => { const s = ev.target.closest('.sc-mix-seg'); if (s && tips.has(s)) tip.show(ev, tips.get(s)); else tip.hide(); });
    bar.addEventListener('mouseleave', () => tip.hide());
  });

  // 告知期間→開催期間（1日あたり）のスロープチャート
  dash.draw('ga-slope', (el) => {
    const res = SC.ready(el, ['ga_channel']);
    if (!res) return;
    const rows = res[0].filter((r) => +r.users >= 10);
    const W = Math.max(300, el.clientWidth || 500);
    const H = 300;
    el.replaceChildren();
    const svg = d3.select(el).append('svg').attr('class', 'sc-svg').attr('width', W).attr('height', H)
      .attr('role', 'img').attr('aria-label', '流入経路ごとの1日あたり新規訪問者数。告知期間と開催期間の比較');
    const lab = (r) => `${SC.short(r.channel)} ${SC.fmt(r.during_daily, 'dec1')}${+r.during_daily > +r.pre_daily ? '↑' : (+r.during_daily < +r.pre_daily ? '↓' : '')}`;
    const probe = svg.append('text').attr('class', 'sc-slope-lab');
    let rw = 0;
    rows.forEach((r) => { probe.text(lab(r)); rw = Math.max(rw, probe.node().getComputedTextLength()); });
    probe.remove();
    const m = { l: 38, r: Math.ceil(rw) + 14, t: 34, b: 14 };
    const x0 = m.l, x1 = Math.max(m.l + 80, W - m.r);
    const max = d3.max(rows, (r) => Math.max(+r.pre_daily, +r.during_daily)) || 1;
    const y = d3.scaleLinear().domain([0, max * 1.05]).range([H - m.b, m.t]);
    svg.append('text').attr('class', 'sc-slope-head').attr('x', x0).attr('y', 14).attr('text-anchor', 'middle').text('告知期間');
    svg.append('text').attr('class', 'sc-slope-head').attr('x', x1).attr('y', 14).attr('text-anchor', 'middle').text('開催期間');
    svg.append('text').attr('class', 'sc-tick').attr('x', (x0 + x1) / 2).attr('y', 14).attr('text-anchor', 'middle').text('1日あたりの人数');
    [x0, x1].forEach((x) => svg.append('line').attr('class', 'sc-axis').attr('x1', x).attr('x2', x).attr('y1', m.t - 8).attr('y2', H - m.b));
    const colr = (r) => (+r.during_daily >= +r.pre_daily ? C.up : C.down);
    const tip = SC.tip(el);
    const pts = rows.map((r) => ({ r, y: y(+r.during_daily) }));
    SC.spread(pts, 13, m.t, H - m.b);
    const lpts = rows.map((r) => ({ r, y: y(+r.pre_daily) }));
    SC.spread(lpts, 12, m.t, H - m.b);
    const g = svg.append('g');
    rows.forEach((r) => {
      const c = colr(r);
      g.append('line').attr('x1', x0).attr('x2', x1).attr('y1', y(+r.pre_daily)).attr('y2', y(+r.during_daily)).style('stroke', c).attr('stroke-width', 2);
      g.append('circle').attr('cx', x0).attr('cy', y(+r.pre_daily)).attr('r', 4).style('fill', c);
      g.append('circle').attr('cx', x1).attr('cy', y(+r.during_daily)).attr('r', 4).style('fill', c);
    });
    pts.forEach((p) => svg.append('text').attr('class', 'sc-slope-lab').attr('x', x1 + 8).attr('y', p.ly).attr('dy', '0.32em').text(lab(p.r)));
    lpts.forEach((p) => svg.append('text').attr('class', 'sc-tick').attr('x', x0 - 7).attr('y', p.ly).attr('dy', '0.32em').attr('text-anchor', 'end').text(SC.fmt(p.r.pre_daily, 'dec1')));
    const hit = svg.append('g');
    rows.forEach((r) => {
      hit.append('line').attr('class', 'sc-hitline').attr('x1', x0).attr('x2', x1).attr('y1', y(+r.pre_daily)).attr('y2', y(+r.during_daily))
        .on('mousemove', (ev) => tip.show(ev, [r.channel, `告知期間 ${SC.fmt(r.pre_daily, 'dec1')}人/日（計${r.pre}人・7日）`, `開催期間 ${SC.fmt(r.during_daily, 'dec1')}人/日（計${r.during}人・5日）`]))
        .on('mouseleave', () => tip.hide());
    });
  });

  // 経路ごとの日別（小さなグラフの並び）
  dash.draw('ga-multiples', (el) => {
    const res = SC.ready(el, ['ga_daily_channel', 'ga_channel', 'ga_daily']);
    if (!res) return;
    const [cells, chs, days] = res;
    const list = [...chs].filter((r) => +r.users >= 10).sort((a, b) => +a.rank - +b.rank);
    const grid = SC.el('div', 'sc-sm');
    const items = [];
    for (const ch of list) {
      const vals = days.map((d) => ({ d, v: +((cells.find((c) => c.channel === ch.channel && c.date === d.date) || {}).users || 0) }));
      const peak = vals.reduce((a, b) => (b.v > a.v ? b : a), vals[0]);
      const box = SC.el('div', 'sc-sm-item');
      const head = SC.el('div', 'sc-sm-head');
      head.append(SC.el('span', 'sc-sm-name', SC.short(ch.channel)), SC.el('span', 'sc-sm-total', `計${f0(ch.users)}人`));
      const sub = SC.el('div', 'sc-sm-peak', `最多 ${SC.md(peak.d.date)}（${peak.v}人）`);
      const plot = SC.el('div', 'sc-sm-plot');
      box.append(head, sub, plot);
      grid.append(box);
      items.push({ ch, vals, plot });
    }
    el.replaceChildren(grid);
    const tip = SC.tip(el);
    for (const { ch, vals, plot } of items) {
      const W = Math.max(140, plot.clientWidth || 200), H = 64, b = 14;
      const cin = ch.is_cinema === true || ch.is_cinema === 'true';
      const svg = d3.select(plot).append('svg').attr('class', 'sc-svg').attr('width', W).attr('height', H)
        .attr('role', 'img').attr('aria-label', `${ch.channel}の日別新規訪問者数`);
      const x = d3.scaleBand().domain(vals.map((_, i) => i)).range([0, W]).paddingInner(0.2);
      const max = d3.max(vals, (v) => v.v) || 1;
      const y = d3.scaleLinear().domain([0, max]).range([H - b, 4]);
      const ev = vals.map((v, i) => (v.d.period === '開催期間' ? i : -1)).filter((i) => i >= 0);
      if (ev.length) svg.append('rect').attr('class', 'sc-band').attr('x', x(ev[0]) - 1).attr('y', 0).attr('width', x(ev[ev.length - 1]) + x.bandwidth() - x(ev[0]) + 2).attr('height', H - b);
      vals.forEach((v, i) => {
        const miss = v.d.ga_missing === true || v.d.ga_missing === 'true';
        if (miss) { svg.append('rect').attr('class', 'sc-sm-miss').attr('x', x(i)).attr('width', x.bandwidth()).attr('y', 4).attr('height', H - b - 4); return; }
        if (v.v) svg.append('rect').attr('x', x(i)).attr('width', x.bandwidth()).attr('y', y(v.v)).attr('height', H - b - y(v.v)).attr('rx', 1.5).style('fill', cin ? C.accent : C.grayMid);
      });
      svg.append('line').attr('class', 'sc-axis').attr('x1', 0).attr('x2', W).attr('y1', H - b).attr('y2', H - b);
      [0, ev.length ? ev[0] : -1, vals.length - 1].filter((i) => i >= 0).forEach((i) => {
        svg.append('text').attr('class', 'sc-tick').attr('x', x(i) + x.bandwidth() / 2).attr('y', H - 2).attr('text-anchor', i === 0 ? 'start' : (i === vals.length - 1 ? 'end' : 'middle')).text(SC.md(vals[i].d.date));
      });
      svg.append('g').selectAll('rect').data(vals).join('rect').attr('class', 'sc-hit')
        .attr('x', (_, i) => x(i) - x.step() * 0.1).attr('width', x.step()).attr('y', 0).attr('height', H)
        .on('mousemove', (e, v) => tip.show(e, (v.d.ga_missing === true || v.d.ga_missing === 'true') ? [ch.channel, `${SC.md(v.d.date)}：GA欠損の可能性`] : [ch.channel, `${SC.md(v.d.date)}（${v.d.period}）：${v.v}人`]))
        .on('mouseleave', () => tip.hide());
    }
  });

  // 投稿者・投稿の内訳（ワッフル）
  dash.draw('drop-waffle', (el) => {
    const res = SC.ready(el, ['drop_poster_origin']);
    if (!res) return;
    const rows = res[0];
    const col = { '映画祭をきっかけに新規登録': C.accent, '期間中に別の入口から新規登録': C.gray, '以前からの会員': C.grayDark };
    const wrap = SC.el('div', 'sc-waf');
    const tips = new Map();
    for (const [key, unit, name] of [['people', '人', '投稿者'], ['posts', '件', '投稿']]) {
      const row = SC.el('div', 'sc-waf-row');
      const total = d3.sum(rows, (r) => +r[key]);
      row.append(SC.el('div', 'sc-waf-label', `${name} ${total}${unit}`));
      const cells = SC.el('div', 'sc-waf-cells');
      for (const r of rows) {
        const grp = SC.el('span', 'sc-waf-grp');
        for (let i = 0; i < +r[key]; i++) { const q = SC.el('i', 'sc-waf-sq'); q.style.background = col[r.origin] || C.gray; grp.append(q); }
        tips.set(grp, [r.origin, `${name} ${r[key]}${unit}`, `1人あたり ${SC.fmt(r.posts_per_person, 'dec1')}件`, r.detail]);
        cells.append(grp);
      }
      row.append(cells);
      wrap.append(row);
    }
    const leg = SC.el('div', 'sc-waf-legend');
    for (const r of rows) {
      const it = SC.el('div', 'sc-mix-item');
      const sw = SC.el('i', 'sc-sw'); sw.style.background = col[r.origin] || C.gray;
      it.append(sw, SC.el('span', 'sc-mix-name', r.origin), SC.el('span', 'sc-mix-val', `${r.people}人・${r.posts}件（1人${SC.fmt(r.posts_per_person, 'dec1')}件）`));
      leg.append(it);
    }
    wrap.append(leg);
    el.replaceChildren(wrap);
    const tip = SC.tip(el);
    wrap.addEventListener('mousemove', (ev) => { const g = ev.target.closest('.sc-waf-grp'); if (g && tips.has(g)) tip.show(ev, tips.get(g)); else tip.hide(); });
    wrap.addEventListener('mouseleave', () => tip.hide());
  });

  // 投稿に出てくる言葉（大きさ＝件数）
  dash.draw('drop-words', (el) => {
    const res = SC.ready(el, ['drop_words']);
    if (!res) return;
    const rows = res[0];
    const mx = d3.max(rows, (r) => +r.posts) || 1, mn = d3.min(rows, (r) => +r.posts) || 0;
    const box = SC.el('div', 'sc-chips');
    const tips = new Map();
    rows.forEach((r, i) => {
      const c = SC.el('span', 'sc-chip' + (i < 3 ? ' sc-chip-hl' : ''));
      c.style.fontSize = `${12 + 10 * ((+r.posts - mn) / Math.max(1, mx - mn))}px`;
      c.append(SC.el('span', '', r.word), SC.el('span', 'sc-chip-n', `${r.posts}`));
      tips.set(c, [r.word, `${r.posts}件の一般投稿に登場（${SC.fmt(r.share_pct, 'pct')}）`]);
      box.append(c);
    });
    el.replaceChildren(box);
    const tip = SC.tip(el);
    box.addEventListener('mousemove', (ev) => { const c = ev.target.closest('.sc-chip'); if (c && tips.has(c)) tip.show(ev, tips.get(c)); else tip.hide(); });
    box.addEventListener('mouseleave', () => tip.hide());
  });

  // 参照元サイト別
  dash.draw('ga-site', (el) => {
    const res = SC.ready(el, ['ga_site']);
    if (!res) return;
    const rows = [...res[0]].sort((a, b) => +a.rank - +b.rank);
    const isRef = (r) => r.has_ref === true || r.has_ref === 'true';
    const withRef = rows.filter(isRef);
    const noRef = rows.filter((r) => !isRef(r));
    const seg = (r) => [{ v: +r.cinema, color: C.accent }, { v: +r.no_utm, color: C.gray }, { v: +r.other, color: C.grayLight }];
    const tipOf = (r) => [r.site, `${f0(r.users)}人（全体の${SC.fmt(r.share_pct, 'pct')}）`, `映画祭の告知 ${r.cinema}人・UTMなし ${r.no_utm}人・他イベント由来など ${r.other}人`, `内訳：${r.channels}`];
    const items = [{ type: 'header', text: '参照元サイトが記録された訪問', sub: `${f0(d3.sum(withRef, (r) => +r.users))}人` }];
    withRef.forEach((r) => items.push({ label: r.site, sub: r.domains, segs: seg(r), valueText: `${f0(r.users)}人`, tip: tipOf(r) }));
    noRef.forEach((r) => {
      items.push({ type: 'header', text: '参照元が記録されない訪問', sub: `${f0(r.users)}人` });
      const parts = String(r.channels).split(/(?<=\d)・/);
      items.push({ label: r.site, sub: parts.slice(0, 5).join('、') + (parts.length > 5 ? ' ほか' : ''), segs: seg(r), valueText: `${f0(r.users)}人`, tip: tipOf(r) });
    });
    SC.hbars(el, items, { labelWidth: '15em', valW: '5em' });
  });
})();
