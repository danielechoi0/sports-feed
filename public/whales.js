/* Game Day – "Whales" tab: large Kalshi trades on the board's games.
 *
 * app.js calls Whales.view(container, games, onUpdate) when the Whales tab is
 * selected. Each game's trades come from /api/whales/:sport/:league/:id
 * (game-winner market only; fills of one order already combined). Games load
 * a few at a time, live games first, and the feed fills in as they arrive.
 * While the tab is open, live and upcoming games refresh every minute.
 * Rows carry data-id, so app.js's click handler opens the game modal.
 */
(() => {
  'use strict';

  const REFRESH_MS = 60_000;
  const CONCURRENCY = 3;
  const THRESHOLDS = [500, 1000, 2500, 5000, 10000, 25000, 100000];
  const store = new Map(); // game id -> { data, error, at }
  const inflight = new Set();
  let ctx = null; // { container, games, onUpdate }
  let timer = null;
  let queue = [];
  let running = 0;

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
  let minSize = THRESHOLDS.includes(read('whaleMin', 1000)) ? read('whaleMin', 1000) : 1000;
  let sortBy = read('whaleSort', 'time') === 'size' ? 'size' : 'time';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const img = (src, alt) => (src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" />` : '');
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const money = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v).toLocaleString()}`);
  const moneyShort = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1000 ? `$${(v / 1000).toFixed(v >= 1e4 ? 0 : 1)}k` : `$${v}`);
  const cents = (p) => `${Math.round(p * 100)}¢`;
  const leagueTag = (g) => (g.sport === 'soccer' ? g.league.short || g.league.name : g.sport.toUpperCase());

  // ---- loading ----------------------------------------------------------

  const rank = (g) => (g.status.state === 'in' ? 0 : g.status.state === 'pre' ? 1 : 2);
  const stale = (g) => {
    const s = store.get(String(g.id));
    if (!s) return true;
    if (s.data && !s.data.available) return Date.now() - s.at >= 10 * 60_000; // no market yet: check again now and then
    if (g.status.state === 'post' && s.data && s.at > Date.parse(g.date) + 4 * 3600_000) return false;
    return Date.now() - s.at >= REFRESH_MS - 1000;
  };

  function pump() {
    while (running < CONCURRENCY && queue.length) {
      const g = queue.shift();
      const id = String(g.id);
      if (inflight.has(id)) continue;
      inflight.add(id);
      running++;
      fetch(`/api/whales/${g.sport}/${encodeURIComponent(g.league.slug)}/${encodeURIComponent(id)}`)
        .then(async (res) => {
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
          store.set(id, { data: body, error: null, at: Date.now() });
        })
        .catch((e) => {
          const prev = store.get(id);
          store.set(id, { data: prev?.data || null, error: e.message, at: Date.now() });
        })
        .finally(() => {
          inflight.delete(id);
          running--;
          if (ctx) ctx.onUpdate();
          pump();
        });
    }
  }

  function schedule() {
    if (!ctx) return;
    const want = ctx.games.filter(stale).filter((g) => !inflight.has(String(g.id)));
    const queued = new Set(queue.map((g) => String(g.id)));
    queue.push(...want.filter((g) => !queued.has(String(g.id))).sort((a, b) => rank(a) - rank(b)));
    pump();
  }

  // ---- rendering --------------------------------------------------------

  function ordersFor(games) {
    const out = [];
    for (const g of games) {
      const d = store.get(String(g.id))?.data;
      if (!d?.available) continue;
      for (const o of d.orders) if (o.notional >= minSize) out.push({ ...o, g });
    }
    return out.sort(sortBy === 'size' ? (a, b) => b.notional - a.notional : (a, b) => b.time.localeCompare(a.time));
  }

  function row(o) {
    const g = o.g;
    const team = o.team === 'home' ? g.home : o.team === 'away' ? g.away : null;
    const what = o.team === 'tie' ? 'Draw' : o.label || team?.shortName || '';
    const status = g.status.state === 'in' ? '<span class="wh-live">Live</span>' : g.status.state === 'post' ? '<span class="wh-final">Final</span>' : '';
    const t = new Date(o.time);
    return `<article class="wh-row" data-id="${esc(g.id)}" tabindex="0" role="button" aria-label="${esc(`${o.side === 'yes' ? 'Yes' : 'No'} on ${what}, ${money(o.notional)}, ${g.away.shortName || g.away.abbrev} at ${g.home.shortName || g.home.abbrev}`)}">
      <time class="wh-time" datetime="${esc(o.time)}">${esc(timeFmt.format(t))}</time>
      <div class="wh-game">
        <span class="wh-tag">${esc(leagueTag(g))}</span>
        <span class="wh-match">${img(g.away.logo, '')}${esc(g.away.abbrev)} <span class="wh-at">@</span> ${img(g.home.logo, '')}${esc(g.home.abbrev)}</span>
        ${status}
      </div>
      <div class="wh-bet">
        <span class="wh-side ${o.side}">${o.side === 'yes' ? 'Yes' : 'No'}</span>
        <span class="wh-what ${esc(o.team)}">${team ? img(team.logo, '') : ''}${esc(what)}</span>
        <span class="wh-px">at ${cents(o.price)}</span>
      </div>
      <div class="wh-size">
        <strong>${money(o.notional)}</strong>
        <span>${Math.round(o.contracts).toLocaleString()} contracts${o.fills > 1 ? ` · ${o.fills} fills` : ''}${o.block ? ' · <b class="wh-block">block</b>' : ''}</span>
      </div>
    </article>`;
  }

  function toolbar() {
    return `<div class="wh-tools">
      <h2 class="group-head">Whale trades</h2>
      <label class="wh-ctl">Min size
        <select id="wh-min">${THRESHOLDS.map((v) => `<option value="${v}"${v === minSize ? ' selected' : ''}>${moneyShort(v)}+</option>`).join('')}</select>
      </label>
      <label class="wh-ctl">Sort
        <select id="wh-sort"><option value="time"${sortBy === 'time' ? ' selected' : ''}>Newest</option><option value="size"${sortBy === 'size' ? ' selected' : ''}>Largest</option></select>
      </label>
    </div>
    <div id="wh-body"></div>`;
  }

  function body(games) {
    const loaded = games.filter((g) => store.get(String(g.id))?.data || store.get(String(g.id))?.error);
    const noMarket = games.filter((g) => store.get(String(g.id))?.data?.available === false);
    const failed = games.filter((g) => {
      const s = store.get(String(g.id));
      return s?.error && !s.data;
    });
    const partial = games.some((g) => store.get(String(g.id))?.data?.partial);
    const orders = ordersFor(games);
    const total = orders.reduce((s, o) => s + o.notional, 0);
    const biggest = orders.reduce((m, o) => (o.notional > (m?.notional ?? 0) ? o : m), null);
    const loading = loaded.length < games.length;

    const stats = `<div class="wh-stats">
      <div><span>Orders</span><strong>${orders.length}</strong></div>
      <div><span>Total</span><strong>${money(total)}</strong></div>
      <div><span>Largest</span><strong>${biggest ? money(biggest.notional) : '–'}</strong></div>
      <div><span>Games</span><strong>${loaded.length}<small>/${games.length}</small></strong></div>
    </div>`;

    let feed;
    if (!games.length) feed = '<div class="empty">No games on this day.</div>';
    else if (orders.length) feed = `<div class="wh-feed">${orders.slice(0, 400).map(row).join('')}</div>`;
    else feed = `<div class="empty">${loading ? 'Loading trades…' : `No trades of ${moneyShort(minSize)} or more yet.`}</div>`;

    const notes = [
      loading ? `Loading ${games.length - loaded.length} more game${games.length - loaded.length === 1 ? '' : 's'}…` : null,
      orders.length > 400 ? `Showing the ${sortBy === 'size' ? 'largest' : 'newest'} 400; raise the minimum size to see fewer.` : null,
      'Game-winner markets only. Fills of one order (same side, same second) are combined; size is contracts × the price paid. Trades from 3 h before kickoff.',
      partial ? 'The busiest markets show only their most recent trades.' : null,
      noMarket.length ? `No Kalshi market: ${noMarket.map((g) => `${g.away.abbrev} @ ${g.home.abbrev}`).join(', ')}.` : null,
      failed.length ? `Couldn't load: ${failed.map((g) => `${g.away.abbrev} @ ${g.home.abbrev}`).join(', ')}.` : null,
    ].filter(Boolean);

    return `${stats}${feed}<p class="wh-note">${notes.map(esc).join(' ')}</p>`;
  }

  function paint() {
    if (!ctx || !ctx.container.isConnected) return;
    let root = ctx.container.querySelector('#whales');
    if (!root) {
      ctx.container.innerHTML = `<section class="group" id="whales">${toolbar()}</section>`;
      root = ctx.container.querySelector('#whales');
      root.querySelector('#wh-min').addEventListener('change', (e) => {
        minSize = Number(e.target.value);
        write('whaleMin', minSize);
        ctx.onUpdate();
      });
      root.querySelector('#wh-sort').addEventListener('change', (e) => {
        sortBy = e.target.value;
        write('whaleSort', sortBy);
        ctx.onUpdate();
      });
    }
    root.querySelector('#wh-body').innerHTML = body(ctx.games);
  }

  // Called by app.js on every render while the tab is selected.
  function view(container, games, onUpdate) {
    const fresh = !ctx || ctx.container !== container;
    ctx = { container, games, onUpdate };
    if (fresh) container.innerHTML = '';
    paint();
    schedule();
    if (!timer) timer = setInterval(() => document.visibilityState === 'visible' && schedule(), 15_000);
  }

  function stop() {
    ctx = null;
    queue = [];
    clearInterval(timer);
    timer = null;
  }

  // Orders at or above the current minimum, for the tab badge (null before any load).
  function count(games) {
    if (!games.some((g) => store.has(String(g.id)))) return null;
    return ordersFor(games).length;
  }

  window.Whales = { view, stop, count };
})();
