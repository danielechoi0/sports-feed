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
      ${glance(d.glance)}
      ${shape(d)}
      <div class="kx-narr">${s.narrative.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
      ${linesTable(d)}
      ${keys(s.keyNumbers)}
      ${tilt(s.teamTilt)}
      ${players(d)}
      <p class="note kx-foot">${esc(s.method)} ${hit.error ? `Last refresh failed (${esc(hit.error)}); showing earlier prices. ` : ''}<strong>Prices from Kalshi, not betting advice.</strong></p>`;
  }

  const GL = { more: ['▲', 'More than normal'], normal: ['●', 'Normal'], less: ['▼', 'Less than normal'] };
  const GL_SHORT = { more: '▲', normal: '●', less: '▼' };
  const fmtN = (x) => (x == null ? '–' : Number.isInteger(x) || Math.abs(x) >= 20 ? String(Math.round(x)) : x.toFixed(1));

  function glance(items) {
    if (!items?.length) return '';
    return `<div class="kx-glance" role="list">${items
      .map((it) => {
        const [icon, text] = GL[it.level] || ['–', 'No read'];
        const nums = it.level ? `${fmtN(it.market)} vs ${fmtN(it.normal)} ${esc(it.unit)} normal` : esc(it.missing || '');
        const teams = it.teams
          .map((t) => `<span class="${esc(t.level || '')}" title="${esc(`${t.team}: ${fmtN(t.market)} vs ${fmtN(t.normal)} normal${t.basis ? ` (${t.basis})` : ''}`)}">${esc(t.team)} ${GL_SHORT[t.level] || '–'}</span>`)
          .join('');
        return `<div class="kx-g ${it.level || 'na'}" role="listitem" title="${esc(it.note || '')}"><div class="k">${esc(it.label)}</div><div class="lv"><i aria-hidden="true">${icon}</i>${esc(text)}</div><div class="nums">${nums}</div><div class="tm">${teams}</div></div>`;
      })
      .join('')}</div>`;
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

  // ---- game shape ---------------------------------------------------------

  const pct = (p) => `${Math.round(p * 100)}%`;
  const half = (x) => Math.round(x * 2) / 2;
  const TYPES = {
    more: { tight: 'Back-and-forth shootout', normal: 'Shootout', 'one-sided': 'Points, but one-sided' },
    normal: { tight: 'Tight game', normal: 'Standard script', 'one-sided': 'Favorite in control' },
    less: { tight: 'Tight grind', normal: 'Grind', 'one-sided': 'Low-scoring, one-sided' },
  };
  const ROWS = [['more', 'More scoring'], ['normal', 'Normal scoring'], ['less', 'Less scoring']];
  const COLS = [['tight', 'Tight'], ['normal', 'Normal'], ['one-sided', 'One-sided']];

  function typeGrid(gt) {
    const row = gt.scoring || 'normal';
    const cells = ROWS.map(
      ([r, rl]) => `<div class="rl">${esc(rl)}</div>` + COLS.map(([c]) => `<div class="cell${r === row && c === gt.margin ? ' on' : ''}">${esc(TYPES[r][c])}</div>`).join(''),
    ).join('');
    const note = gt.scoring ? '' : '<p class="note">No season baseline for scoring yet, so the row assumes normal.</p>';
    return `<div class="kx-type" role="img" aria-label="${esc(`Game type: ${gt.label}`)}">
      <div class="kx-type-grid"><div></div>${COLS.map(([, l]) => `<div class="cl">${esc(l)}</div>`).join('')}${cells}</div>${note}</div>`;
  }

  function marginBar(m, teams) {
    const a = teams.away.abbrev;
    const h = teams.home.abbrev;
    const segs = [
      ['away17', 'away strong', `${a} by 17+`],
      ['away8', 'away', `${a} by 8–16`],
      ['close', 'mid', '7 or fewer'],
      ['home8', 'home', `${h} by 8–16`],
      ['home17', 'home strong', `${h} by 17+`],
    ];
    const bar = segs
      .filter(([k]) => m.buckets[k] > 0)
      .map(([k, cls, label]) => `<div class="${cls}" style="flex-grow:${m.buckets[k]}" title="${esc(`${label}: ${pct(m.buckets[k])}`)}"></div>`)
      .join('');
    const legend = segs.map(([k, cls, label]) => `<span><i class="sw ${cls}"></i>${esc(label)} <b>${pct(m.buckets[k])}</b></span>`).join('');
    const exact =
      m.exact3 != null || m.exact7 != null
        ? `<p class="note">Favorite wins by exactly 3: ${m.exact3 != null ? pct(m.exact3) : '–'} · by exactly 7: ${m.exact7 != null ? pct(m.exact7) : '–'}.</p>`
        : '';
    return `<div class="k">Final margin</div>
      <div class="kx-mbar" role="img" aria-label="${esc(segs.map(([k, , l]) => `${l} ${pct(m.buckets[k])}`).join(', '))}">${bar}</div>
      <div class="kx-mleg">${legend}</div>${m.approx ? '<p class="note">The 17+ share on the side with fewer Kalshi rungs is an upper bound.</p>' : ''}${exact}`;
  }

  function totalRange(t, marks) {
    const lo0 = t.p10 ?? t.p25;
    const hi0 = t.p90 ?? t.p75;
    const vals = [lo0, hi0, ...marks.map((m) => m.v)];
    const lo = Math.floor(Math.min(...vals) / 5) * 5 - 5;
    const hi = Math.ceil(Math.max(...vals) / 5) * 5 + 5;
    const x = (v) => `${(((v - lo) / (hi - lo)) * 100).toFixed(2)}%`;
    const w = (a, b) => `${(((b - a) / (hi - lo)) * 100).toFixed(2)}%`;
    const wide = t.p10 != null && t.p90 != null;
    const outer = `<div class="b80" style="left:${x(lo0)};width:${w(lo0, hi0)}" title="${esc(`${wide ? '80%' : '50%'} of outcomes: ${Math.round(lo0)}–${Math.round(hi0)}`)}"></div>`;
    const inner = `<div class="b50" style="left:${x(t.p25)};width:${w(t.p25, t.p75)}" title="${esc(`Middle 50%: ${Math.round(t.p25)}–${Math.round(t.p75)}`)}"></div>`;
    const med = `<div class="med" style="left:${x(t.p50)}" title="${esc(`Kalshi median ${half(t.p50)}`)}"></div>`;
    const mk = marks.map((m) => `<div class="mk ${m.cls}" style="left:${x(m.v)}" title="${esc(`${m.label} ${m.v}`)}"></div>`).join('');
    const legend = [
      `<span><i class="sw b50"></i>middle 50%: ${Math.round(t.p25)}–${Math.round(t.p75)}</span>`,
      wide ? `<span><i class="sw b80"></i>80%: ${Math.round(t.p10)}–${Math.round(t.p90)}</span>` : '',
      `<span><i class="sw med"></i>Kalshi ${half(t.p50)}</span>`,
      ...marks.map((m) => `<span><i class="sw mk ${m.cls}"></i>${esc(m.label)} ${esc(m.v)}</span>`),
    ].join('');
    return `<div class="k">Total points</div>
      <div class="kx-trange" role="img" aria-label="${esc(`Total points: middle half ${Math.round(t.p25)} to ${Math.round(t.p75)}, median ${half(t.p50)}`)}">${outer}${inner}${med}${mk}</div>
      <div class="kx-tax"><span>${lo}</span><span>${hi}</span></div>
      <div class="kx-mleg">${legend}</div>`;
  }

  function shape(d) {
    const sh = d.shape;
    if (!sh || (!sh.margin && !sh.total)) return '';
    const marks = [];
    const bookTotal = d.compare?.rows?.find((r) => r.key === 'total')?.book?.now;
    if (bookTotal != null) marks.push({ v: bookTotal, label: d.compare.book.provider, cls: 'book' });
    const season = d.glance?.find((g) => g.key === 'scoring')?.normal;
    if (season != null) marks.push({ v: half(season), label: 'season-based', cls: 'season' });
    return `<div class="subhead">Game shape${sh.gameType ? `: ${esc(sh.gameType.label)}` : ''}</div>
      <div class="kx-shape">
        ${sh.gameType ? typeGrid(sh.gameType) : ''}
        <div class="kx-dist">${sh.margin ? marginBar(sh.margin, d.teams) : ''}${sh.total ? totalRange(sh.total, marks) : ''}</div>
      </div>`;
  }

  // ---- lines: Kalshi (with daily trend), sportsbook, ESPN model ----------

  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  function fmtLine(key, v, teams) {
    if (v == null) return '–';
    if (key === 'homeWin') return v >= 0.5 ? `${teams.home.abbrev} ${pct(v)}` : `${teams.away.abbrev} ${pct(1 - v)}`;
    if (key === 'homeMargin') return Math.abs(v) < 0.25 ? 'Pick’em' : `${v > 0 ? teams.home.abbrev : teams.away.abbrev} −${half(Math.abs(v))}`;
    return String(half(v));
  }
  function change(key, from, to, teams) {
    if (from == null || to == null) return '';
    const d = to - from;
    if (key === 'homeWin' ? Math.abs(d) < 0.01 : Math.abs(d) < 0.5) return '<span class="chg flat">no change</span>';
    if (key === 'total') return `<span class="chg">${d > 0 ? '▲' : '▼'} ${half(Math.abs(d))}</span>`;
    const toward = d > 0 ? teams.home.abbrev : teams.away.abbrev;
    const amt = key === 'homeWin' ? `+${Math.round(Math.abs(d) * 100)}%` : `+${half(Math.abs(d))}`;
    return `<span class="chg">→ ${esc(toward)} ${esc(amt)}</span>`;
  }
  function spark(key, series, teams) {
    if (!series || series.length < 2) return '<span class="note">–</span>';
    const W = 96;
    const H = 26;
    const vs = series.map((p) => p.v);
    let lo = Math.min(...vs);
    let hi = Math.max(...vs);
    const minSpan = key === 'homeWin' ? 0.04 : 1;
    if (hi - lo < minSpan) {
      const mid = (hi + lo) / 2;
      lo = mid - minSpan / 2;
      hi = mid + minSpan / 2;
    }
    const X = (i) => 4 + (i / (series.length - 1)) * (W - 8);
    const Y = (v) => H - 4 - ((v - lo) / (hi - lo)) * (H - 8);
    const line = series.map((p, i) => `${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
    const last = series.length - 1;
    const dots = series
      .map(
        (p, i) =>
          `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="${i === last ? 3 : 6}" class="${i === last ? 'end' : 'hit'}"><title>${esc(`${p.now ? 'Now' : dayFmt.format(new Date(p.ts * 1000))}: ${fmtLine(key, p.v, teams)}`)}</title></circle>`,
      )
      .join('');
    return `<svg class="kx-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(`Kalshi ${fmtLine(key, series[0].v, teams)} to ${fmtLine(key, series[last].v, teams)}`)}"><polyline points="${line}" />${dots}</svg>`;
  }

  const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
  function linesTable(d) {
    const c = d.compare;
    if (!c?.rows) return '';
    const teams = d.teams;
    const LABEL = { homeWin: 'Win prob', homeMargin: 'Spread', total: 'Total' };
    const bookName = c.book?.provider || 'Sportsbook';
    const rows = c.rows
      .map((r) => {
        const k = r.kalshi;
        const b = r.book;
        let bookCell = '–';
        if (b && (b.now != null || b.open != null)) {
          const moved = b.open != null && b.now != null && fmtLine(r.key, b.open, teams) !== fmtLine(r.key, b.now, teams);
          bookCell = `${moved ? `<span class="was">${esc(fmtLine(r.key, b.open, teams))}</span> → ` : ''}${esc(fmtLine(r.key, b.now ?? b.open, teams))}${change(r.key, b.open, b.now, teams)}`;
        }
        const model = r.key === 'homeWin' ? esc(fmtLine(r.key, r.model, teams)) : '';
        return `<tr><td class="lbl">${LABEL[r.key]}</td><td class="hi">${esc(fmtLine(r.key, k.now, teams))}</td><td><div class="trw">${spark(r.key, k.series, teams)}${change(r.key, k.first, k.now, teams)}</div></td><td>${bookCell}</td><td>${model}</td></tr>`;
      })
      .join('');
    const dp = d.shape?.depth;
    const depth = dp
      ? `<p class="note">Kalshi contracts traded in the last 24 h: ${compact(dp.game.volume24h)} winner, ${compact(dp.spread.volume24h)} spread, ${compact(dp.total.volume24h)} total (${compact(dp.game.openInterest + dp.spread.openInterest + dp.total.openInterest)} still open). On thin trading a line can move on little money.</p>`
      : '';
    return `<div class="subhead">Lines: Kalshi vs ${esc(bookName)} vs ESPN's model</div>
      <div class="scroll"><table class="box kx-lines"><thead><tr><th></th><th>Kalshi</th><th title="Kalshi's daily closing line, then now">Kalshi trend</th><th>${esc(bookName)} open → now</th><th title="${esc(c.model?.name || 'ESPN matchup predictor')}">ESPN model</th></tr></thead><tbody>${rows}</tbody></table></div>${depth}`;
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
