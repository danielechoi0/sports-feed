/* Game Day – "Edges" tab: game-winner prices across sportsbooks, Kalshi and
 * Polymarket, and the gaps between them that are worth betting.
 *
 * app.js calls Edges.view(container, games, onUpdate, date) while the tab is
 * selected. One request (/api/edges?date=YYYYMMDD) returns every open game of
 * the day: per outcome, each venue's cost of $1 payout (fees included), its
 * fair probability, the leave-one-out consensus of the other venues and the
 * EV of buying there. This file only filters and draws. Refreshes every 30 s.
 * Rows carry data-id, so app.js's click handler opens the game modal.
 */
(() => {
  'use strict';

  const REFRESH_MS = 30_000;
  const EV_STEPS = [0.005, 0.01, 0.02, 0.03, 0.05];
  let ctx = null; // { container, games, onUpdate, date }
  let timer = null;
  let data = null; // last /api/edges response
  let dataDate = null;
  let error = null;
  let loading = false;

  const read = (k, fallback) => {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  };
  const write = (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  };
  let minEv = EV_STEPS.includes(read('edgeMinEv', 0.02)) ? read('edgeMinEv', 0.02) : 0.02;
  // Live games are opt-in: venues are fetched seconds apart and in-play prices
  // move faster than that, so live gaps are often stale rather than real.
  let withLive = read('edgeLive', false) === true;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const img = (src) => (src ? `<img src="${esc(src)}" alt="" loading="lazy" />` : '');
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const pct = (p, d = 1) => (p == null ? '–' : `${(p * 100).toFixed(d)}%`);
  const signedPct = (p) => (p == null ? '–' : `${p >= 0 ? '+' : '−'}${Math.abs(p * 100).toFixed(1)}%`);
  const leagueTag = (g) => (g.sport === 'soccer' ? g.league.short || g.league.name : g.sport.toUpperCase());
  // Cost of $1 payout -> American odds.
  const american = (cost) => {
    if (!(cost > 0 && cost < 1)) return '–';
    const dec = 1 / cost;
    return dec >= 2 ? `+${Math.round((dec - 1) * 100)}` : `−${Math.round(100 / (dec - 1))}`;
  };
  const priceText = (q) => (q.kind === 'exchange' ? `${Math.round(q.ask * 100)}¢` : american(q.cost));
  const outcomeName = (g, k) => (k === 'draw' ? 'Draw' : g[k].shortName || g[k].abbrev);
  const outcomeLogo = (g, k) => (k === 'draw' ? '' : img(g[k].logo));
  // Same order as the rest of the app: soccer home v away, US sports away @ home.
  const matchup = (g) =>
    g.sport === 'soccer'
      ? `${img(g.home.logo)}${esc(g.home.abbrev)} <span class="wh-at">v</span> ${img(g.away.logo)}${esc(g.away.abbrev)}`
      : `${img(g.away.logo)}${esc(g.away.abbrev)} <span class="wh-at">@</span> ${img(g.home.logo)}${esc(g.home.abbrev)}`;
  const ORDER = { soccer: ['home', 'draw', 'away'], other: ['away', 'home'] };
  const columns = (g) => (g.sport === 'soccer' ? ORDER.soccer : ORDER.other).map((k) => g.outcomes.find((o) => o.key === k)).filter(Boolean);
  const whenText = (g) => (g.state === 'in' ? `<span class="wh-live">Live${g.clock ? ` · ${esc(g.clock)}` : ''}</span>` : `<span class="ed-when">${esc(timeFmt.format(new Date(g.date)))}</span>`);

  // ---- loading ----------------------------------------------------------

  async function load() {
    if (!ctx || loading) return;
    const date = ctx.date;
    loading = true;
    try {
      const res = await fetch(`/api/edges?date=${encodeURIComponent(date)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      data = body;
      dataDate = date;
      error = null;
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
      if (ctx) ctx.onUpdate();
    }
  }

  // ---- selection --------------------------------------------------------

  function shownGames() {
    if (!data || dataDate !== ctx.date) return [];
    const ids = new Set(ctx.games.map((g) => String(g.id)));
    return data.games.filter((g) => ids.has(String(g.id)) && (withLive || g.state !== 'in'));
  }

  function opportunities(games) {
    const out = [];
    for (const g of games) {
      for (const o of g.outcomes) {
        for (const q of o.quotes) if (q.ev != null && q.ev >= minEv) out.push({ g, o, q });
      }
    }
    return out.sort((a, b) => b.q.ev - a.q.ev);
  }

  // ---- rendering --------------------------------------------------------

  function oppRow({ g, o, q }) {
    const what = outcomeName(g, o.key);
    const label = `${what} to win at ${q.source}, ${priceText(q)}, expected value ${signedPct(q.ev)}`;
    return `<article class="wh-row ed-row" data-id="${esc(g.id)}" tabindex="0" role="button" aria-label="${esc(label)}">
      <div class="ed-ev"><strong>${signedPct(q.ev)}</strong><span>EV</span></div>
      <div class="wh-game"><span class="wh-tag">${esc(leagueTag(g))}</span><span class="wh-match">${matchup(g)}</span>${whenText(g)}</div>
      <div class="wh-bet">
        <span class="wh-what ${esc(o.key)}">${outcomeLogo(g, o.key)}${esc(what)}${o.key === 'draw' ? '' : ' to win'}</span>
        <span class="ed-venue ${q.kind}">${esc(q.source)}</span>
        <span class="wh-px">at ${esc(priceText(q))}</span>
      </div>
      <div class="wh-size">
        <strong>${pct(q.consensus)} fair</strong>
        <span>costs ${pct(q.cost)} · fair from ${q.others} other venue${q.others === 1 ? '' : 's'}</span>
      </div>
    </article>`;
  }

  function arbCard(g) {
    const legs = g.arb.legs.map((l) => `<li>${outcomeLogo(g, l.key)}<b>${esc(outcomeName(g, l.key))}</b> at ${esc(l.source)} <span class="wh-px">${pct(l.cost)} per $1</span></li>`).join('');
    return `<article class="ed-arb" data-id="${esc(g.id)}" tabindex="0" role="button" aria-label="${esc(`Arbitrage ${signedPct(g.arb.margin)} on ${g.away.abbrev} at ${g.home.abbrev}`)}">
      <div class="wh-game"><span class="wh-tag">${esc(leagueTag(g))}</span><span class="wh-match">${matchup(g)}</span>${whenText(g)}<strong class="ed-arb-m">${signedPct(g.arb.margin)} locked</strong></div>
      <ul>${legs}</ul>
      <p class="wh-note">Buy every leg in proportion to its cost; the payouts total $1 for ${pct(g.arb.total)} spent. Check each price is still there before betting.${g.state === 'in' ? ' <b class="wh-block">Live:</b> venues are read seconds apart and in-play prices move fast, so this is likely stale.' : ''}</p>
    </article>`;
  }

  // One game: rows = venues, columns = outcomes. The cheapest price in each
  // column is marked; cells with EV over the threshold are highlighted.
  function gameTable(g) {
    const sources = g.sources;
    const cols = columns(g);
    const head = cols.map((o) => `<th scope="col">${outcomeLogo(g, o.key)}${esc(outcomeName(g, o.key))}</th>`).join('');
    const rows = sources
      .map((s) => {
        const cells = cols
          .map((o) => {
            const q = o.quotes.find((x) => x.source === s);
            if (!q || q.cost == null) return '<td class="ed-na">–</td>';
            const best = o.best && o.best.source === s;
            const hot = q.ev != null && q.ev >= minEv;
            const title = `${s}: ${priceText(q)} · costs ${pct(q.cost)} per $1 (fees included) · fair ${pct(q.fair)}${q.ev != null ? ` · EV ${signedPct(q.ev)} vs ${pct(q.consensus)} consensus` : ''}`;
            return `<td class="${best ? 'best' : ''} ${hot ? 'hot' : ''}" title="${esc(title)}"><b>${esc(priceText(q))}</b><span>${pct(q.fair)}${q.ev != null ? ` · ${signedPct(q.ev)}` : ''}</span></td>`;
          })
          .join('');
        const kind = g.outcomes.flatMap((o) => o.quotes).find((x) => x.source === s)?.kind;
        return `<tr><th scope="row"><span class="ed-venue ${kind}">${esc(s)}</span></th>${cells}</tr>`;
      })
      .join('');
    const cons = cols.map((o) => `<td><b>${pct(o.consensus)}</b><span>gap ${o.gap == null ? '–' : `${(o.gap * 100).toFixed(1)} pts`}</span></td>`).join('');
    const maxGap = Math.max(0, ...g.outcomes.map((o) => o.gap ?? 0));
    return `<article class="ed-game ${g.sport === 'soccer' ? 'three' : ''}" data-id="${esc(g.id)}" tabindex="0" role="button" aria-label="${esc(`${g.away.shortName} at ${g.home.shortName}, prices from ${sources.join(', ')}`)}">
      <div class="wh-game"><span class="wh-tag">${esc(leagueTag(g))}</span><span class="wh-match">${matchup(g)}</span>${whenText(g)}<span class="ed-gap ${maxGap >= 0.03 ? 'wide' : ''}">max gap ${(maxGap * 100).toFixed(1)} pts</span></div>
      ${sources.length ? `<div class="ed-scroll"><table class="ed-table"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}<tr class="ed-cons"><th scope="row">Consensus</th>${cons}</tr></tbody></table></div>` : '<p class="wh-note">No prices found for this game.</p>'}
    </article>`;
  }

  function toolbar() {
    return `<div class="wh-tools">
      <h2 class="group-head">Line gaps</h2>
      <label class="wh-ctl">Min EV
        <select id="ed-min">${EV_STEPS.map((v) => `<option value="${v}"${v === minEv ? ' selected' : ''}>${(v * 100).toFixed(v < 0.01 ? 1 : 0)}%+</option>`).join('')}</select>
      </label>
      <label class="wh-ctl"><input type="checkbox" id="ed-live"${withLive ? ' checked' : ''} /> Live games</label>
    </div>
    <div id="ed-body"></div>`;
  }

  function body() {
    if (!data || dataDate !== ctx.date) return `<div class="empty">${error ? `Couldn't load prices: ${esc(error)}` : 'Loading prices…'}</div>`;
    const games = shownGames().sort((a, b) => (a.state === 'in') - (b.state === 'in') || a.date.localeCompare(b.date));
    const opps = opportunities(games);
    const arbs = games.filter((g) => g.arb);
    const priced = games.filter((g) => g.sources.length >= 2);
    const biggestGap = Math.max(0, ...games.flatMap((g) => g.outcomes.map((o) => o.gap ?? 0)));

    const stats = `<div class="wh-stats">
      <div><span>+EV bets</span><strong>${opps.length}</strong></div>
      <div><span>Best EV</span><strong>${opps.length ? signedPct(opps[0].q.ev) : '–'}</strong></div>
      <div><span>Arbitrage</span><strong>${arbs.length}</strong></div>
      <div><span>Widest gap</span><strong>${(biggestGap * 100).toFixed(1)}<small> pts</small></strong></div>
    </div>`;

    const oppHtml = opps.length
      ? `<div class="wh-feed">${opps.slice(0, 100).map(oppRow).join('')}</div>`
      : `<div class="empty">${games.length ? `No bets at ${(minEv * 100).toFixed(minEv < 0.01 ? 1 : 0)}% EV or better right now.` : 'No open games on this day.'}</div>`;
    const arbHtml = arbs.length ? `<h3 class="ed-h">Arbitrage</h3><div class="wh-feed">${arbs.map(arbCard).join('')}</div>` : '';
    const tables = priced.length ? `<h3 class="ed-h">All prices <small>${priced.length} game${priced.length === 1 ? '' : 's'}</small></h3><div class="ed-games">${priced.map(gameTable).join('')}</div>` : '';
    const single = games.filter((g) => g.sources.length < 2);

    const notes = [
      `Game winner only (soccer: home / draw / away). Books: ${data.books}${/ESPN/.test(data.books) ? ' — set ODDS_API_KEY on the server to compare more sportsbooks' : ''}. ESPN has no sportsbook line once a game starts, so live games compare Kalshi and Polymarket only.`,
      `Fair price: a book's odds with its margin removed, or an exchange's bid/ask midpoint (ignored when the spread is over ${Math.round(data.settings.maxSpread * 100)}¢). EV compares one venue's price, fees included (Kalshi ${data.settings.kalshiFeeRate} × p × (1 − p) per contract; Polymarket's listed taker fee), with the median fair price of the other venues, and needs ${data.settings.minOthers}+ of them.`,
      'Exchange prices are the best ask only; check depth before sizing a bet. Updated every 30 s.',
      withLive ? 'Live games: each venue is read up to 30 s apart and in-play prices move faster than that, so live gaps are often stale, not real.' : null,
      single.length ? `Fewer than two venues: ${single.map((g) => `${g.away.abbrev} @ ${g.home.abbrev}`).join(', ')}.` : null,
      data.errors?.length ? `Unavailable: ${[...new Set(data.errors.map((e) => e.source))].join(', ')} (some leagues).` : null,
      error ? `Last refresh failed: ${error}.` : null,
    ].filter(Boolean);

    return `${stats}<h3 class="ed-h">+EV bets</h3>${oppHtml}${arbHtml}${tables}<p class="wh-note">${notes.map(esc).join(' ')}</p>`;
  }

  function paint() {
    if (!ctx || !ctx.container.isConnected) return;
    let root = ctx.container.querySelector('#edges');
    if (!root) {
      ctx.container.innerHTML = `<section class="group" id="edges">${toolbar()}</section>`;
      root = ctx.container.querySelector('#edges');
      root.querySelector('#ed-min').addEventListener('change', (e) => {
        minEv = Number(e.target.value);
        write('edgeMinEv', minEv);
        ctx.onUpdate();
      });
      root.querySelector('#ed-live').addEventListener('change', (e) => {
        withLive = e.target.checked;
        write('edgeLive', withLive);
        ctx.onUpdate();
      });
    }
    root.querySelector('#ed-body').innerHTML = body();
  }

  // Called by app.js on every render while the tab is selected.
  function view(container, games, onUpdate, date) {
    const fresh = !ctx || ctx.container !== container;
    const newDate = !ctx || ctx.date !== date;
    ctx = { container, games, onUpdate, date };
    if (fresh) container.innerHTML = '';
    paint();
    if (newDate || !data) load();
    if (!timer) timer = setInterval(() => document.visibilityState === 'visible' && load(), REFRESH_MS);
  }

  function stop() {
    ctx = null;
    clearInterval(timer);
    timer = null;
  }

  // +EV bets at the current threshold, for the tab badge (null before a load).
  function count(games, date) {
    if (!data || dataDate !== date) return null;
    const ids = new Set(games.map((g) => String(g.id)));
    return opportunities(data.games.filter((g) => ids.has(String(g.id)) && (withLive || g.state !== 'in'))).length;
  }

  window.Edges = { view, stop, count };
})();
