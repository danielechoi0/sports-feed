/* Game Day – "Market read (Kalshi)" panel for the NFL game modal.
 *
 * app.js calls KalshiMarket.panel(game) while building the NFL modal body and
 * inserts the returned HTML. The first call for a game renders a placeholder
 * and fetches /api/nfl/:id/market in the background; later calls (the modal
 * re-renders every 10 s during a game) render straight from the cached result,
 * so the panel never flickers back to "loading".
 */
(() => {
  'use strict';

  const FRESH_MS = 3 * 60_000;
  const store = new Map(); // game id -> { data, error, at }
  const inflight = new Set();

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const img = (src, alt) => (src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" />` : '');
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const LEAN = { pass: 'pass-leaning', run: 'run-leaning', balanced: 'balanced' };

  async function load(id) {
    if (inflight.has(id)) return;
    inflight.add(id);
    try {
      const res = await fetch(`/api/nfl/${encodeURIComponent(id)}/market`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      store.set(id, { data: body, error: null, at: Date.now() });
    } catch (e) {
      const prev = store.get(id);
      store.set(id, { data: prev?.data || null, error: e.message, at: Date.now() });
    } finally {
      inflight.delete(id);
      const el = document.getElementById('kalshi-panel');
      if (el && el.dataset.game === String(id)) el.innerHTML = inner(id);
    }
  }

  function panel(g) {
    const id = String(g.id);
    const hit = store.get(id);
    if (!hit || Date.now() - hit.at > FRESH_MS) setTimeout(() => load(id), 0);
    return `<div class="panel full kx" id="kalshi-panel" data-game="${esc(id)}">${inner(id)}</div>`;
  }

  function head(right = '') {
    return `<h3>Market read (Kalshi)${right ? `<span class="right">${right}</span>` : ''}</h3>`;
  }

  function inner(id) {
    const hit = store.get(id);
    if (!hit) return `${head()}<p class="note kx-wait">Loading Kalshi prices…</p>`;
    const d = hit.data;
    if (!d) return `${head()}<p class="note">Market read unavailable: ${esc(hit.error)}</p>`;
    if (!d.available) return `${head()}<p class="note">No market read for this game. ${esc(d.reason || '')}</p>`;
    const s = d.summary;
    const updated = d.generatedAt ? `prices at ${esc(timeFmt.format(new Date(d.generatedAt)))}` : '';
    return `${head(updated)}
      <div class="kx-headline">${esc(s.headline)}</div>
      ${s.tags?.length ? `<div class="kx-tags">${s.tags.map((t) => `<span class="kx-tag">${esc(t)}</span>`).join('')}${d.live ? '<span class="kx-tag live">in-play prices</span>' : ''}</div>` : ''}
      <div class="kx-narr">${s.narrative.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
      ${keys(s.keyNumbers)}
      ${tilt(s.teamTilt)}
      ${players(d)}
      <p class="note kx-foot">${esc(s.method)} ${hit.error ? `Last refresh failed (${esc(hit.error)}); showing earlier prices. ` : ''}<strong>Prices from Kalshi, not betting advice.</strong></p>`;
  }

  function keys(list) {
    if (!list?.length) return '';
    return `<div class="kx-keys">${list
      .map((k) => `<div class="kx-key"><div class="k" title="${esc(k.label)}">${esc(k.label)}</div><div class="v">${esc(k.value)}</div>${k.note ? `<div class="n">${esc(k.note)}</div>` : ''}</div>`)
      .join('')}</div>`;
  }

  function tilt(rows) {
    if (!rows?.length) return '';
    const body = rows
      .map((t) => {
        if (t.passShare == null) {
          return `<div class="kx-tilt"><span class="kx-team">${img(t.logo, t.name)}${esc(t.team)}</span><span class="note kx-na">Not enough player markets for a pass/run split.</span></div>`;
        }
        const pass = Math.round(t.passShare * 100);
        const typ = Math.round(t.typicalShare * 100);
        const pp = t.pp > 0 ? `+${t.pp}` : String(t.pp);
        return `<div class="kx-tilt">
          <span class="kx-team">${img(t.logo, t.name)}${esc(t.team)}</span>
          <div class="kx-bar" role="img" aria-label="${esc(`${t.team}: ${pass}% of priced yards passing, ${typ}% for the same players this season`)}">
            <div class="pass" style="width:${pass}%"><span>${pass}% pass</span></div><div class="run"><span>${100 - pass}% run</span></div>
            <i class="mark" style="left:${typ}%" title="Same players' season split: ${typ}% pass"></i>
          </div>
          <span class="kx-lean ${esc(t.lean)}">${esc(LEAN[t.lean] || '')}<span class="pp">${esc(pp)} pts vs season · ${esc(t.passYds)} pass / ${esc(t.rushYds)} rush yds</span></span>
        </div>`;
      })
      .join('');
    return `<div class="subhead">Pass / run tilt of priced yards</div><div class="kx-tilts">${body}</div><p class="note kx-legend"><span class="sw pass"></span>QB passing line <span class="sw run"></span>listed rushers' lines <span class="sw mark"></span>same players' season split</p>`;
  }

  const VS = { high: '▲', low: '▼', 'in line': '' };
  const cell = (x) => {
    if (!x) return '<td>-</td>';
    const title = x.basis ? 'Mean from the scalar ladder market (median off the price ladder)' : x.below != null ? 'Median below the lowest Kalshi rung' : x.above != null ? 'Median above the highest Kalshi rung' : 'Implied median (50% point)';
    const avg = x.seasonAvg != null ? `. Season average ${Math.round(x.seasonAvg)}${x.vs && x.vs !== 'in line' ? ` (line ${x.vs === 'high' ? 'above' : 'below'} it)` : ''}` : '. No season average';
    const mark = x.vs && VS[x.vs] ? `<span class="kx-vs ${x.vs}">${VS[x.vs]}</span>` : '';
    const sub = x.seasonAvg != null ? `<span class="kx-avg">${Math.round(x.seasonAvg)}</span>` : '';
    return `<td class="${x.line != null || x.basis ? 'hi' : ''}" title="${esc(title + avg)}">${esc(x.display ?? '-')}${mark}${sub}</td>`;
  };

  function players(d) {
    const order = ['QB', 'RB', 'WR', 'TE'];
    const groups = order.filter((p) => d.players?.[p]?.length);
    if (!groups.length) return '<p class="note">No player markets are open for this game.</p>';
    const rows = groups
      .map(
        (pos) =>
          `<tr class="kx-pos"><td colspan="5">${esc(pos === 'QB' ? 'Quarterbacks' : pos === 'RB' ? 'Running backs' : pos === 'WR' ? 'Wide receivers' : 'Tight ends')}</td></tr>` +
          d.players[pos]
            .map((p) => {
              const att = pos === 'QB' ? p.passAtt : p.rushAtt;
              return `<tr><td class="pname">${esc(p.name)}<span class="pos">${esc(p.team)}</span></td>${cell(p.passYds)}${cell(p.rushYds)}${cell(p.recYds)}${cell(att)}</tr>`;
            })
            .join(''),
      )
      .join('');
    const n = groups.reduce((a, p) => a + d.players[p].length, 0);
    return `<details class="kx-players" open><summary>Player lines by position (${n})</summary><div class="scroll"><table class="box"><thead><tr><th>Player</th><th title="Passing yards">Pass</th><th title="Rushing yards">Rush</th><th title="Receiving yards">Rec</th><th title="Pass attempts (QB) or carries (RB)">Att</th></tr></thead><tbody>${rows}</tbody></table></div><p class="note">Small grey number: season average per game. ▲/▼: line above/below it.</p></details>`;
  }

  window.KalshiMarket = { panel };
})();
