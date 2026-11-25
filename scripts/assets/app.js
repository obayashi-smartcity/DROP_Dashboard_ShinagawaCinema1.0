// パスワードで集計データを復号し、ダッシュボードを表示する。
(function () {
  const $ = (id) => document.getElementById(id);
  const manifest = JSON.parse($('manifest').textContent);
  const enc = JSON.parse($('encrypted').textContent);
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  // パスワード画面に作成日時と元データ名を出す（数字は出さない）
  $('login-meta').textContent = `作成 ${manifest.generated_at}／元データ：${manifest.input}`;

  async function decrypt(password) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64(enc.salt), iterations: enc.iterations, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // 「6. 元データと集計」とフッター
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  dash.draw('build-meta', (p) => {
    p.textContent = `作成 ${manifest.generated_at}／元データ：${manifest.input}／イベント ${manifest.event}／集計期間 ${manifest.period}`;
  });
  dash.draw('footer', (p) => {
    p.textContent = `品川国際映画祭2026 × みんまちDROP 流入・利用レポート｜作成 ${manifest.generated_at}｜元データ：${manifest.input}｜集計：scripts/drop_aggregate.py`;
  });
  dash.draw('inputs-body', (tb) => {
    tb.replaceChildren();
    for (const r of (window.DASH_DATA._inputs || [])) {
      const tr = tb.insertRow();
      tr.append(el('td', 'sc-mono', r.file), el('td', '', r.about), el('td', 'sc-num', r.records == null ? '—' : d3.format(',')(r.records)), el('td', 'sc-mono', r.sha256_12));
    }
  });
  const toCsv = (rows) => {
    if (!rows.length) return '';
    const cols = Object.keys(rows[0]);
    const q = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [cols.map(q).join(','), ...rows.map((r) => cols.map((c) => q(r[c])).join(','))].join('\r\n');
  };
  const download = (name) => {
    const blob = new Blob(['﻿' + toCsv(window.DASH_DATA[name] || [])], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.csv`;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  dash.draw('sources-body', (tb) => {
    tb.replaceChildren();
    for (const r of (window.DASH_DATA._sources || [])) {
      const tr = tb.insertRow();
      const name = el('td');
      name.append(el('div', 'sc-mono', r.table), el('div', 'sc-hb-sub', r.title));
      const btnTd = el('td');
      const btn = el('button', 'sc-csv', 'CSV');
      btn.type = 'button';
      btn.addEventListener('click', () => download(r.table));
      btnTd.append(btn);
      tr.append(name, el('td', '', r.used_in), el('td', '', r.columns), el('td', 'sc-num', d3.format(',')(r.rows)), btnTd);
    }
  });

  function show(payload) {
    window.DASH_DATA = payload.datasets;
    const app = $('app');
    app.innerHTML = payload.body; // ビルド時に作った本文（自分たちのテンプレート）
    $('login').hidden = true;
    app.hidden = false;
    window.__runDraws();
    window.__setupPage();   // 目次・「運営の投稿を含める」の切り替え（page.js）
    let w = window.innerWidth, t;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { if (window.innerWidth !== w) { w = window.innerWidth; window.__runDraws(); } }, 150); });
    window.addEventListener('beforeprint', window.__runDraws);
  }

  $('login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $('login-btn');
    const msg = $('login-msg');
    if (!window.crypto || !crypto.subtle) { msg.textContent = 'このブラウザでは開けません（Chrome・Edge・Safari の最新版で開いてください）。'; return; }
    btn.disabled = true;
    msg.textContent = '';
    try {
      const payload = await decrypt($('login-pw').value);
      show(payload);
    } catch (e) {
      msg.textContent = 'パスワードが違います。';
      btn.disabled = false;
      $('login-pw').select();
    }
  });
  $('login-pw').focus();
})();
