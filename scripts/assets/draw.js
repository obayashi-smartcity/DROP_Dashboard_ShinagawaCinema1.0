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

  // 日別の新規訪問者
  dash.draw('ga-daily', (el) => {
    const res = SC.ready(el, ['ga_daily']);
    if (!res) return;
    const [rows] = res;
    SC.vbars(el, {
      rows,
      aria: '日別の新規訪問者数。告知の種類（配信・常設のリンク・会場の QR・識別タグなし）の積み上げ棒グラフ',
      noYAxis: true,
      x: (r) => SC.md(r.date),
      series: [{ key: 'push', color: C.accent }, { key: 'link', color: C.grayDark }, { key: 'onsite', color: C.grayMid }, { key: 'untagged', color: C.grayLight }],
      band: { test: (r) => r.period === '開催期間', label: '' },
      ann: [
        { test: (r) => r.date === '2026-11-06', text: 'メール配信（とみられる）' },
        { test: (r) => r.date === '2026-11-09', text: '開幕' },
      ],
      missing: (r) => r.ga_missing === true || r.ga_missing === 'true',
      missingText: '欠損',
      tip: (r) => (r.ga_missing === true || r.ga_missing === 'true')
        ? [SC.md(r.date) + '（' + r.period + '）', 'GAの行が0件（欠損の可能性）']
        : [SC.md(r.date) + '（' + r.period + '）', `合計 ${r.total}人`, `配信（社内イントラ・LINE・メール） ${r.push}人`, `常設のリンク（公式HP・PC画面の左側表示） ${r.link}人`, `会場の QR ${r.onsite}人`, `識別タグなし・他イベント ${r.untagged}人`],
    });
  });

  // 流入経路×日別：すべての経路を同じ目盛りの小さな棒で（告知の種類ごとにまとめる）
  dash.draw('ga-daybars', (el) => {
    const res = SC.ready(el, ['ga_daily_channel', 'ga_channel', 'ga_daily']);
    if (!res) return;
    const [cells, chs, days] = res;
    const val = new Map(cells.map((c) => [c.channel + '|' + c.date, +c.users]));
    const max = d3.max(cells, (c) => +c.users) || 1;
    const list = [...chs].sort((p, q) => (+p.kind_order - +q.kind_order) || (+p.rank - +q.rank));
    const groups = d3.groups(list, (r) => r.kind_label);
    const W = Math.max(300, el.clientWidth || 600);
    const probe = d3.select(el).append('svg').append('text').attr('class', 'sc-tick');
    let lw = 0;
    list.forEach((r) => { probe.text(SC.short(r.channel)); lw = Math.max(lw, probe.node().getComputedTextLength()); });
    probe.node().parentNode.remove();
    const L = Math.min(Math.ceil(lw) + 12, Math.round(W * 0.34)), R = 40, rowH = 32, headH = 22, top = 34;
    const H = top + groups.length * headH + list.length * rowH + 4;
    el.replaceChildren();
    const svg = d3.select(el).append('svg').attr('class', 'sc-svg').attr('width', W).attr('height', H)
      .attr('role', 'img').attr('aria-label', '流入経路ごとの日別の新規訪問者。すべての行で同じ目盛りの小さな棒');
    const x = d3.scaleBand().domain(days.map((_, i) => i)).range([L, W - R]).paddingInner(0.2);
    const bh = rowH - 14;
    const during = days.map((d, i) => (d.period === '開催期間' ? i : -1)).filter((i) => i >= 0);
    if (during.length) {
      const bx0 = x(during[0]) - (x.step() * x.paddingInner()) / 2;
      const bx1 = x(during[during.length - 1]) + x.bandwidth() + (x.step() * x.paddingInner()) / 2;
      svg.append('rect').attr('class', 'sc-band').attr('x', bx0).attr('y', top - 6).attr('width', bx1 - bx0).attr('height', H - top + 6);
      svg.append('text').attr('class', 'sc-band-label').attr('x', bx0 + 3).attr('y', 11).text('開催期間');
    }
    svg.append('text').attr('class', 'sc-band-label').attr('x', x(0)).attr('y', 11).text('告知期間');
    const every = x.step() < 26 ? 2 : 1;
    days.forEach((d, i) => {
      if (i % every === 0 || i === days.length - 1) svg.append('text').attr('class', 'sc-tick').attr('x', x(i) + x.bandwidth() / 2).attr('y', 27).attr('text-anchor', 'middle').text(SC.md(d.date));
      if (d.ga_missing === true || d.ga_missing === 'true') svg.append('rect').attr('class', 'sc-hatch').attr('x', x(i)).attr('y', top - 2).attr('width', x.bandwidth()).attr('height', H - top);
    });
    svg.append('text').attr('class', 'sc-tick').attr('x', W).attr('y', 27).attr('text-anchor', 'end').text('合計');
    const tip = SC.tip(el);
    let y = top;
    for (const [label, rows] of groups) {
      svg.append('text').attr('class', 'sc-tl-title').attr('x', 0).attr('y', y + 15).text(label);
      svg.append('line').attr('class', 'sc-tl-sep').attr('x1', 0).attr('x2', W).attr('y1', y + 20).attr('y2', y + 20);
      y += headH;
      for (const r of rows) {
        const base = y + rowH - 3;
        const hi = r.kind === 'push';
        svg.append('text').attr('class', 'sc-tick').attr('x', 6).attr('y', base - 4).text(SC.short(r.channel));
        days.forEach((d, i) => {
          const v = val.get(r.channel + '|' + d.date) || 0;
          if (!v) return;
          const h = Math.max(1.5, (v / max) * bh);
          svg.append('rect').attr('x', x(i)).attr('width', x.bandwidth()).attr('y', base - h).attr('height', h).attr('rx', 1).style('fill', hi ? C.accent : C.grayMid);
          svg.append('text').attr('class', 'sc-vlabel').attr('x', x(i) + x.bandwidth() / 2).attr('y', base - h - 2).attr('text-anchor', 'middle').style('font-size', '10px').text(v);
        });
        svg.append('line').attr('class', 'sc-axis').attr('x1', L).attr('x2', W - R).attr('y1', base).attr('y2', base);
        svg.append('text').attr('class', 'sc-vlabel').attr('x', W).attr('y', base - 4).attr('text-anchor', 'end').style('font-weight', 600).text(f0(r.users));
        svg.append('rect').attr('class', 'sc-hit').attr('x', 0).attr('y', y).attr('width', W).attr('height', rowH)
          .on('mousemove', (ev) => {
            const i = Math.max(0, Math.min(days.length - 1, Math.floor((d3.pointer(ev, svg.node())[0] - L) / x.step())));
            const d = days[i];
            const miss = d.ga_missing === true || d.ga_missing === 'true';
            tip.show(ev, [r.channel, miss ? `${SC.md(d.date)}：GA 欠損の可能性` : `${SC.md(d.date)}（${d.period}）：${val.get(r.channel + '|' + d.date) || 0}人`, `${r.kind_label}・計${f0(r.users)}人`]);
          })
          .on('mouseleave', () => tip.hide());
        y += rowH;
      }
    }
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

  // スポット別：一般の投稿と運営メンバーの投稿を、表の形の棒で
  dash.draw('drop-spot', (el) => {
    const res = SC.ready(el, ['drop_spot']);
    if (!res) return;
    const rows = res[0];
    const chosen = rows.filter((r) => r.spot !== 'スポット指定なし');
    const top = chosen.reduce((p, q) => (+q.general > +p.general ? q : p), chosen[0] || {});
    const maxG = d3.max(rows, (r) => +r.general) || 1, maxO = d3.max(rows, (r) => +r.operation) || 1;
    const box = SC.el('div', 'sc-org');
    const head = SC.el('div', 'sc-org-row is-head is-3');
    head.append(SC.el('span', 'sc-org-lab', 'スポット'), SC.el('span', '', '一般の投稿'), SC.el('span', '', '運営メンバーの投稿'));
    box.append(head);
    const cell = (v, max, hi, unit) => {
      const c = SC.el('span', 'sc-org-c');
      const bar = SC.el('i'); bar.style.width = `calc((100% - 3em) * ${+v / max})`;
      bar.style.background = hi ? C.accent : (unit === 'op' ? C.grayLight : C.grayMid);
      c.append(bar, SC.el('b', '', `${v}件`));
      return c;
    };
    const tips = new Map();
    for (const r of rows) {
      const hi = r === top;
      const row = SC.el('div', 'sc-org-row is-3' + (hi ? ' is-hi' : '') + (r.spot === 'スポット指定なし' ? ' is-none' : ''));
      row.append(SC.el('span', 'sc-org-lab', r.spot === 'スポット指定なし' ? 'スポットを選んでいない' : r.spot), cell(+r.general, maxG, hi, 'g'), cell(+r.operation, maxO, false, 'op'));
      tips.set(row, [r.spot, `一般の投稿 ${r.general}件`, `運営メンバーの投稿 ${r.operation}件`]);
      box.append(row);
    }
    el.replaceChildren(box);
    const tip = SC.tip(el);
    box.addEventListener('mousemove', (ev) => { const r = ev.target.closest('.sc-org-row'); if (r && tips.has(r)) tip.show(ev, tips.get(r)); else tip.hide(); });
    box.addEventListener('mouseleave', () => tip.hide());
  });

  // 投稿時刻
  dash.draw('drop-hour', (el) => {
    const res = SC.ready(el, ['hour_v']);
    if (!res) return;
    const rows = res[0];
    SC.vbars(el, {
      rows,
      height: 190,
      aria: '一般投稿の時刻別件数。17〜22時を強調',
      noYAxis: true,
      x: (r) => String(r.hour),
      every: 3,
      band: { test: (r) => +r.hour >= 17 && +r.hour <= 22, label: '17〜22時' },
      series: [{ key: 'posts', color: (r) => (+r.hour >= 17 && +r.hour <= 22 ? C.accent : C.gray) }],
      tip: (r) => [`${r.hour}時台`, `投稿 ${r.posts}件`],
    });
  });

  // 年代・性別：投稿した人と新規登録の人数を、並べた横棒で
  dash.draw('drop-attr', (el) => {
    const id = el.dataset.source, key = el.dataset.key;
    const res = SC.ready(el, [id]);
    if (!res) return;
    const rows = res[0];
    const max = d3.max(rows, (r) => Math.max(+r.posters, +r.registrants)) || 1;
    const box = SC.el('div', 'sc-attr');
    const tips = new Map();
    for (const r of rows) {
      const row = SC.el('div', 'sc-attr-row');
      const bars = SC.el('span', 'sc-attr-bars');
      [['posters', '投稿した人', C.grayDark], ['registrants', '新規登録', C.gray]].forEach(([k, name, c]) => {
        const line = SC.el('span', 'sc-attr-line');
        const bar = SC.el('i'); bar.style.width = `calc((100% - 2.6em) * ${+r[k] / max})`; bar.style.background = c;
        line.append(bar, SC.el('b', '', `${r[k]}人`));
        line.title = name;
        bars.append(line);
      });
      row.append(SC.el('span', 'sc-attr-lab', r[key]), bars);
      tips.set(row, [r[key], `投稿した人 ${r.posters}人`, `新規登録（映画祭きっかけ） ${r.registrants}人`]);
      box.append(row);
    }
    el.replaceChildren(box);
    const tip = SC.tip(el);
    box.addEventListener('mousemove', (ev) => { const r = ev.target.closest('.sc-attr-row'); if (r && tips.has(r)) tip.show(ev, tips.get(r)); else tip.hide(); });
    box.addEventListener('mouseleave', () => tip.hide());
  });

  // 経路ごとの日別（小さなグラフの並び）
  dash.draw('ga-multiples', (el) => {
    const res = SC.ready(el, ['ga_daily_channel', 'ga_channel', 'ga_daily']);
    if (!res) return;
    const [cells, chs, days] = res;
    const list = [...chs].filter((r) => +r.users >= 10).sort((a, b) => (+a.kind_order - +b.kind_order) || (+a.rank - +b.rank));
    const grid = SC.el('div', 'sc-sm');
    const items = [];
    for (const ch of list) {
      const vals = days.map((d) => ({ d, v: +((cells.find((c) => c.channel === ch.channel && c.date === d.date) || {}).users || 0) }));
      const peak = vals.reduce((a, b) => (b.v > a.v ? b : a), vals[0]);
      const box = SC.el('div', 'sc-sm-item' + (ch.kind === 'push' ? ' is-hi' : ''));
      const head = SC.el('div', 'sc-sm-head');
      head.append(SC.el('span', 'sc-sm-name', SC.short(ch.channel)), SC.el('span', 'sc-sm-total', `計${f0(ch.users)}人`));
      const sub = SC.el('div', 'sc-sm-peak', `${ch.kind_label}｜最多 ${SC.md(peak.d.date)}（${peak.v}人）`);
      const plot = SC.el('div', 'sc-sm-plot');
      box.append(head, sub, plot);
      grid.append(box);
      items.push({ ch, vals, plot });
    }
    el.replaceChildren(grid);
    const tip = SC.tip(el);
    for (const { ch, vals, plot } of items) {
      const W = Math.max(140, plot.clientWidth || 200), H = 64, b = 14;
      const hi = ch.kind === 'push';
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
        if (v.v) svg.append('rect').attr('x', x(i)).attr('width', x.bandwidth()).attr('y', y(v.v)).attr('height', H - b - y(v.v)).attr('rx', 1.5).style('fill', hi ? C.accent : C.grayMid);
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

  // 登録の経路ごとの、投稿した人数と投稿数
  dash.draw('drop-origin', (el) => {
    const res = SC.ready(el, ['origin_v']);
    if (!res) return;
    const rows = res[0];
    const maxP = d3.max(rows, (r) => +r.people) || 1, maxN = d3.max(rows, (r) => +r.posts) || 1;
    const box = SC.el('div', 'sc-org');
    const head = SC.el('div', 'sc-org-row is-head');
    head.append(SC.el('span', 'sc-org-lab', '登録の経路'), SC.el('span', '', '投稿した人'), SC.el('span', '', '投稿数'), SC.el('span', 'sc-org-pp', '1人あたり'));
    box.append(head);
    const tips = new Map();
    const cell = (v, max, unit) => {
      const c = SC.el('span', 'sc-org-c');
      const bar = SC.el('i'); bar.style.width = `calc((100% - 3.4em) * ${+v / max})`;
      c.append(bar, SC.el('b', '', `${v}${unit}`));
      return c;
    };
    for (const r of rows) {
      const row = SC.el('div', 'sc-org-row' + (r.origin === '映画祭をきっかけに新規登録' ? ' is-hi' : ''));
      row.append(SC.el('span', 'sc-org-lab', r.origin), cell(r.people, maxP, '人'), cell(r.posts, maxN, '件'), SC.el('span', 'sc-org-pp', `${SC.fmt(r.posts_per_person, 'dec1')}件`));
      tips.set(row, [r.origin, `投稿した人 ${r.people}人・投稿 ${r.posts}件（1人あたり ${SC.fmt(r.posts_per_person, 'dec1')}件）`].concat(r.detail ? [`登録したイベント：${r.detail}`] : []));
      box.append(row);
    }
    const tot = SC.el('div', 'sc-org-row is-total');
    const tp = d3.sum(rows, (r) => +r.people), tn = d3.sum(rows, (r) => +r.posts);
    tot.append(SC.el('span', 'sc-org-lab', '合計'), SC.el('span', '', `${tp}人`), SC.el('span', '', `${tn}件`), SC.el('span', 'sc-org-pp', `${SC.fmt(tn / (tp || 1), 'dec1')}件`));
    box.append(tot);
    el.replaceChildren(box);
    const tip = SC.tip(el);
    box.addEventListener('mousemove', (ev) => { const r = ev.target.closest('.sc-org-row'); if (r && tips.has(r)) tip.show(ev, tips.get(r)); else tip.hide(); });
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
    const seg = (r) => [{ v: +r.land_event, color: C.grayDark }, { v: +r.land_other, color: C.accent }, { v: +r.land_misc, color: C.grayLight }];
    const tipOf = (r) => [r.site, `${f0(r.users)}人（全体の${SC.fmt(r.share_pct, 'pct')}）`, `最初に開いたページ：映画祭のページ ${r.land_event}人・他イベントのページ ${r.land_other}人・その他 ${r.land_misc}人`, `流入経路：${r.channels}`];
    const items = [{ type: 'header', text: '参照元サイトが記録された訪問', sub: `${f0(d3.sum(withRef, (r) => +r.users))}人` }];
    withRef.forEach((r) => items.push({ label: r.site, sub: r.domains, segs: seg(r), valueText: `${f0(r.users)}人`, tip: tipOf(r) }));
    noRef.forEach((r) => {
      items.push({ type: 'header', text: '参照元が記録されない訪問', sub: `${f0(r.users)}人` });
      const parts = String(r.channels).split(/(?<=\d)・/);
      items.push({ type: 'note', text: `QRコード・メール・社内イントラなど、リンク元が残らない経路から来た人。内訳：${parts.join('、')}` });
    });
    SC.hbars(el, items, { labelWidth: '15em', valW: '5em' });
  });

  // 登録時アンケート（番号のまま）：縦の棒
  dash.draw('survey', (el) => {
    const res = SC.ready(el, ['survey_codes']);
    if (!res) return;
    const q = el.dataset.q;
    const rows = res[0].filter((r) => r.question === q);
    SC.vbars(el, {
      rows,
      height: 150,
      aria: `登録時アンケート ${q} の選択肢番号ごとの人数`,
      noYAxis: true,
      x: (r) => String(r.code),
      every: 1,
      series: [{ key: 'n', color: C.grayMid }],
      tip: (r) => [`${q} ${r.label}`, `${r.n}人`],
    });
  });
})();
