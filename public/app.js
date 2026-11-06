/* Game Day dashboard – vanilla JS frontend (Timeline × Scoreboard layout) */
(() => {
  'use strict';

  // ---------- state ----------
  const hashDate = /^#(\d{8})$/.exec(location.hash)?.[1];
  const state = {
    date: hashDate || ymd(new Date()),
    data: null,
    games: new Map(),
    hiddenLeagues: new Set(load('hiddenLeagues', [])),
    sportTab: load('sportTab', 'all'),
    timer: null,
    seq: 0,
    live: null, // EventSource
    liveConnected: false,
    modalId: null,
    modalTimer: null,
  };
  if (!['all', 'nfl', 'nba', 'soccer'].includes(state.sportTab)) state.sportTab = 'all';

  const $ = (sel, root = document) => root.querySelector(sel);
  const el = {
    daylabel: $('#daylabel'),
    updated: $('#updated'),
    banner: $('#banner'),
    datepick: $('#datepick'),
    tabs: $('#sport-tabs'),
    filters: $('#league-filters'),
    groups: $('#groups'),
    modal: $('#modal'),
    modalBody: $('#modal-body'),
    livedot: $('#livedot'),
  };

  // ---------- helpers ----------
  function load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  }
  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }
  function ymd(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  }
  function fromYmd(s) {
    return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
  }
  function isoDate(s) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const shortDateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  const fmtTime = (iso) => timeFmt.format(new Date(iso));
  const fmtShort = (iso) => shortDateFmt.format(new Date(iso));
  const deg = (t) => (t == null ? '--' : `${Math.round(t)}°`);
  const SPORT_ORDER = { nfl: 0, nba: 1, soccer: 2 };

  function img(src, alt, cls = '') {
    return src
      ? `<img src="${esc(src)}" alt="${esc(alt || '')}" loading="lazy" class="${cls}" onerror="this.style.visibility='hidden'">`
      : `<span class="${cls}" style="display:inline-block;width:30px;height:30px"></span>`;
  }

  // Team badge: ESPN logo with a colored-square + abbreviation fallback when the image fails.
  function badge(team, size) {
    const color = team.color ? `#${String(team.color).replace('#', '')}` : '#5a6270';
    const image = team.logo ? `<img src="${esc(team.logo)}" alt="" loading="lazy" onerror="this.remove()">` : '';
    return `<span class="badge ${size}" style="--tc:${esc(color)}" aria-hidden="true"><span class="abbr">${esc(team.abbrev || '')}</span>${image}</span>`;
  }

  // ---------- weather icons (currentColor strokes) ----------
  const CLOUD = '<path d="M7 18h10.5a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6-1.4A4.7 4.7 0 0 0 7 18z"/>';
  const CLOUD_HI = '<path d="M7 15h10.5a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6-1.4A4.7 4.7 0 0 0 7 15z"/>';
  const ICON = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>',
    'cloud-sun': '<circle cx="8" cy="8" r="2.8"/><path d="M8 2.5v1.5M2.5 8H4M4.1 4.1l1 1M11.9 4.1l-1 1"/><path d="M9.5 20h8a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6-1.3A4.2 4.2 0 0 0 9.5 20z"/>',
    cloud: CLOUD,
    fog: CLOUD_HI + '<path d="M5 18.5h14M7 21.5h10"/>',
    drizzle: CLOUD_HI + '<path d="M9 18v2.5M13 18v2.5M17 18v2.5"/>',
    rain: CLOUD_HI + '<path d="M8.5 18l-1 3.5M12.5 18l-1 3.5M16.5 18l-1 3.5"/>',
    snow: CLOUD_HI + '<circle cx="8.5" cy="19" r="1"/><circle cx="12.5" cy="21" r="1"/><circle cx="16.5" cy="19" r="1"/>',
    storm: CLOUD_HI + '<path d="M13 14l-2.5 4h3l-1.5 4"/>',
    thermo: '<path d="M10 4a2 2 0 0 1 4 0v9.3a4 4 0 1 1-4 0z"/><circle cx="12" cy="17" r="1.6"/>',
    indoor: '<path d="M4 11l8-6 8 6v9H4z"/><path d="M10 20v-5h4v5"/>',
  };
  const svg = (name, label = '') =>
    `<svg class="wxicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"'}>${ICON[name] || ICON.thermo}</svg>`;

  // ---------- status helpers ----------
  const IRREGULAR = /postponed|cancel|delay|suspend|tbd/i;
  function isIrregular(g) {
    return IRREGULAR.test(g.status.description || '') || IRREGULAR.test(g.status.detail || '');
  }
  function groupOf(g) {
    if (isIrregular(g) && g.status.state !== 'in') return 'upcoming';
    if (g.status.state === 'in') return 'live';
    if (g.status.state === 'post') return 'final';
    return 'upcoming';
  }
  // Short live clock text: "58'", "HT", "Q2 8:42", "HALF", "END Q1", "OT 2:10".
  function liveClock(g) {
    const s = g.status;
    if (g.sport === 'soccer') {
      const named = s.shortDetail && !/\d/.test(s.shortDetail) ? s.shortDetail : null;
      return named || s.clock || s.shortDetail || 'LIVE';
    }
    if (/halftime/i.test(s.description || '')) return 'HALF';
    if (/end of/i.test(s.description || '') && s.period) return `END Q${s.period}`;
    if (s.period && s.clock) {
      const p = s.period > 4 ? (s.period === 5 ? 'OT' : `${s.period - 4}OT`) : `Q${s.period}`;
      return `${p} ${s.clock}`;
    }
    return s.shortDetail || s.detail || 'LIVE';
  }
  function finalText(g) {
    return g.sport === 'soccer' ? g.status.shortDetail || 'FT' : 'Final';
  }
  function statusHtml(g) {
    const s = g.status;
    if (s.state === 'in') return `<span class="status live"><span class="dot" aria-hidden="true"></span>${esc(liveClock(g))}</span>`;
    if (s.state === 'post') return `<span class="status">${esc(finalText(g))}</span>`;
    const txt = isIrregular(g) ? s.description : fmtTime(g.date);
    return `<span class="status">${esc(txt)}</span>`;
  }
  function teamsInOrder(g) {
    return g.sport === 'soccer' ? [g.home, g.away] : [g.away, g.home];
  }
  function isLoser(g, team) {
    if (g.status.state !== 'post') return false;
    const a = Number(g.home.score);
    const b = Number(g.away.score);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return false;
    return team.homeAway === 'home' ? a < b : b < a;
  }
  function accessibleName(g) {
    const [x, y] = teamsInOrder(g);
    const sep = g.sport === 'soccer' ? 'vs' : 'at';
    const grp = groupOf(g);
    const score = grp === 'upcoming' ? '' : `, ${x.score ?? 0} to ${y.score ?? 0}`;
    const st = grp === 'live' ? ', live' : grp === 'final' ? ', final' : `, ${isIrregular(g) ? g.status.description : fmtTime(g.date)}`;
    return `${x.shortName} ${sep} ${y.shortName}${st}${score}`;
  }

  function formHtml(last5) {
    if (!last5 || !last5.length) return '';
    const chips = last5
      .map((r) => {
        const res = (r.result || '-').toUpperCase();
        let title = res === 'W' ? 'Win' : res === 'D' ? 'Draw' : res === 'L' ? 'Loss' : 'Unknown';
        if (!r.formOnly && r.opponent) {
          title += ` ${r.score} ${r.isHome ? 'vs' : '@'} ${r.opponent} · ${fmtShort(r.date)}${r.competition ? ' · ' + r.competition : ''}`;
        }
        return `<span class="f f-${esc(res)}" title="${esc(title)}">${esc(res)}</span>`;
      })
      .join('');
    return `<span class="form" title="Last 5, oldest to newest">${chips}</span>`;
  }

  function venueText(g) {
    return [g.venue.name, g.venue.city].filter(Boolean).join(' · ');
  }
  function metaLine(g) {
    const bits = [`<span class="chip">${esc(g.league.short || g.league.name)}</span>`];
    if (g.broadcast) bits.push(`<span>${esc(g.broadcast)}</span>`);
    if (g.odds && g.sport !== 'soccer') bits.push(`<span class="spread">${esc(g.odds)}</span>`);
    return bits.join('');
  }
  const tagHtml = (t) => `<span class="tag ${t.homeAway === 'home' ? 'home' : ''}">${t.homeAway === 'home' ? 'HOME' : 'AWAY'}</span>`;

  // ---------- live card ----------
  function liveCard(g) {
    const teams = teamsInOrder(g);
    const rows = teams
      .map((t) => `<div class="trow">${badge(t, 'lg')}<span class="tname">${esc(t.shortName)}</span>${tagHtml(t)}</div>`)
      .join('');
    const scores = teams.map((t) => `<div class="s">${esc(t.score ?? 0)}</div>`).join('');
    let wx = '';
    if (g.sport !== 'nba' && g.weather) {
      wx = g.weather.indoor
        ? `<span class="wx">${svg('indoor', 'Indoors')} Indoors</span>`
        : `<span class="wx">${svg(g.weather.icon, g.weather.label || 'Weather')} ${deg(g.weather.tempF)}${g.weather.precipProb != null ? ` · ${g.weather.precipProb}%` : ''}</span>`;
    }
    return `<article class="live-card" data-id="${esc(g.id)}" tabindex="0" role="button" aria-label="${esc(accessibleName(g))}">
      <div class="meta">${metaLine(g)}</div>
      <div class="body"><div class="teams">${rows}</div>
        <div class="tile">${scores}<div class="clock"><span class="dot" aria-hidden="true"></span>${esc(liveClock(g))}</div></div></div>
      <div class="foot"><span class="venue">${esc(venueText(g))}</span>${wx}</div>
    </article>`;
  }

  // ---------- rail row ----------
  function weatherPanelHtml(g) {
    if (g.sport === 'nba') return '';
    const w = g.weather;
    if (!w) return `<aside class="wxp">${svg('thermo', 'No forecast')}<div class="cond">No forecast</div></aside>`;
    if (w.indoor) return `<aside class="wxp">${svg('indoor', 'Indoors')}<div class="cond">Indoors</div><div class="sub">Dome or roof</div></aside>`;
    const sub = [w.windMph != null ? `${Math.round(w.windMph)} mph` : null, w.precipProb != null ? `${w.precipProb}%` : null].filter(Boolean).join(' · ');
    return `<aside class="wxp" title="${esc(w.place || '')}">${svg(w.icon, w.label || 'Weather')}<div class="temp">${deg(w.tempF)}</div><div class="cond">${esc(w.label || '')}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</aside>`;
  }

  function railRow(g, group) {
    const teams = teamsInOrder(g);
    const draw = g.status.state === 'post' && Number(g.home.score) === Number(g.away.score);
    const rows = teams
      .map((t) => {
        const loser = isLoser(g, t);
        let right = '';
        if (group === 'final') right = `<span class="stile ${loser ? 'dim' : ''}">${esc(t.score ?? 0)}</span>`;
        else if (g.status.state === 'pre' && t.record) right = `<span class="record">${esc(t.record)}</span>`;
        return `<div class="trow ${loser ? 'loser' : ''}">${badge(t, 'sm')}<span class="tname">${esc(t.shortName)}</span>${tagHtml(t)}${g.sport === 'soccer' ? formHtml(t.last5) : ''}${right}</div>`;
      })
      .join('');
    let time;
    let timeCls = '';
    if (group === 'final') {
      time = finalText(g);
      timeCls = 'muted';
    } else if (isIrregular(g)) {
      time = g.status.description;
      timeCls = 'muted';
    } else {
      time = fmtTime(g.date);
    }
    return `<div class="rail-row"><div class="time ${timeCls}">${esc(time)}</div>
      <div class="rail"><span class="marker" aria-hidden="true"></span>
        <article class="row-card" data-id="${esc(g.id)}" tabindex="0" role="button" aria-label="${esc(accessibleName(g))}${draw ? ', draw' : ''}">
          <div class="main">
            <div class="teams">${rows}</div>
            <div class="info"><div class="line">${metaLine(g)}</div><div class="venue">${esc(g.venue.name || '')}</div><div>${esc(g.venue.city || '')}</div></div>
          </div>
          ${weatherPanelHtml(g)}
        </article>
      </div></div>`;
  }

  // ---------- render day ----------
  function allGames() {
    const d = state.data;
    return d ? [...d.nfl, ...d.nba, ...d.soccer] : [];
  }
  function visible(g) {
    if (state.sportTab !== 'all' && g.sport !== state.sportTab) return false;
    if (g.sport === 'soccer' && state.hiddenLeagues.has(g.league.slug)) return false;
    return true;
  }

  function renderTabs(games) {
    const counts = { all: games.length, nfl: 0, nba: 0, soccer: 0 };
    for (const g of games) counts[g.sport]++;
    const labels = { all: 'All', nfl: 'NFL', nba: 'NBA', soccer: 'Soccer' };
    el.tabs.innerHTML = Object.keys(labels)
      .map((k) => `<button class="tab" data-tab="${k}" aria-pressed="${state.sportTab === k}">${labels[k]}<span class="n">${counts[k]}</span></button>`)
      .join('');
  }

  function renderFilters(leagues, soccer) {
    const counts = new Map();
    for (const g of soccer) counts.set(g.league.slug, (counts.get(g.league.slug) || 0) + 1);
    const disabled = state.sportTab === 'nfl' || state.sportTab === 'nba';
    el.filters.innerHTML = leagues
      .map((l) => {
        const on = !state.hiddenLeagues.has(l.slug);
        return `<button class="chip-btn" data-slug="${esc(l.slug)}" aria-pressed="${on}" aria-disabled="${disabled}" ${disabled ? 'tabindex="-1"' : ''}>${esc(l.short || l.name)}<span class="n">${counts.get(l.slug) || 0}</span></button>`;
      })
      .join('');
  }

  const byKick = (a, b) => a.date.localeCompare(b.date) || SPORT_ORDER[a.sport] - SPORT_ORDER[b.sport];
  const bySportThenKick = (a, b) => SPORT_ORDER[a.sport] - SPORT_ORDER[b.sport] || a.date.localeCompare(b.date);

  function render() {
    const d = state.data;
    if (!d) return;
    const games = allGames();
    state.games.clear();
    for (const g of games) state.games.set(g.id, g);

    renderTabs(games);
    renderFilters(d.leagues, d.soccer);

    const shown = games.filter(visible);
    const live = shown.filter((g) => groupOf(g) === 'live').sort(bySportThenKick);
    const upcoming = shown.filter((g) => groupOf(g) === 'upcoming').sort(byKick);
    const final = shown.filter((g) => groupOf(g) === 'final').sort(byKick);

    const head = (cls, label, n) =>
      `<h2 class="group-head ${cls}">${cls === 'live' ? '<span class="dot" aria-hidden="true"></span>' : ''}${label}<span class="n" aria-label="${n} games">· ${n}</span></h2>`;
    const parts = [];
    if (live.length) parts.push(`<section class="group">${head('live', 'Live now', live.length)}<div class="live-grid">${live.map(liveCard).join('')}</div></section>`);
    if (upcoming.length) parts.push(`<section class="group">${head('', 'Coming up', upcoming.length)}<div class="rail">${upcoming.map((g) => railRow(g, 'upcoming')).join('')}</div></section>`);
    if (final.length) parts.push(`<section class="group">${head('', 'Final', final.length)}<div class="rail">${final.map((g) => railRow(g, 'final')).join('')}</div></section>`);
    if (!parts.length) {
      const msg = games.length ? 'No games match the current filters.' : 'No NFL, NBA or top-flight soccer games on this day.';
      parts.push(`<div class="empty">${msg}</div>`);
    }
    el.groups.innerHTML = parts.join('');

    el.updated.textContent = `Updated ${timeFmt.format(new Date(d.generatedAt))}`;
    if (d.errors?.length) {
      el.banner.textContent = `Some feeds failed: ${d.errors.map((e) => e.league).join(', ')}. Showing what loaded.`;
      el.banner.classList.remove('hidden');
    } else {
      el.banner.classList.add('hidden');
    }
  }

  async function loadDay({ silent = false } = {}) {
    const seq = ++state.seq; // later requests win; stale responses are dropped
    const date = state.date;
    const dt = fromYmd(state.date);
    const wantHash = date === ymd(new Date()) ? '' : `#${date}`;
    if (location.hash !== wantHash) history.replaceState(null, '', location.pathname + wantHash);
    el.daylabel.textContent = dayFmt.format(dt);
    el.datepick.value = isoDate(state.date);
    if (!silent) {
      el.updated.textContent = 'Loading…';
      el.groups.innerHTML = '<div class="empty">Loading…</div>';
    }
    try {
      const res = await fetch(`/api/day?date=${date}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (seq !== state.seq) return;
      state.data = data;
      render();
    } catch (e) {
      if (seq !== state.seq) return;
      el.updated.textContent = 'Load failed';
      el.banner.textContent = `Could not load games: ${e.message}`;
      el.banner.classList.remove('hidden');
    } finally {
      if (seq === state.seq) scheduleRefresh();
    }
  }

  function scheduleRefresh() {
    clearTimeout(state.timer);
    const anyLive = allGames().some((g) => g.status.state === 'in');
    const isToday = state.date === ymd(new Date());
    if (!isToday && !anyLive) return;
    // With the live stream connected, scores arrive by push; the full reload only
    // picks up new fixtures, weather and form. Without it, poll quickly.
    const ms = state.liveConnected ? 5 * 60_000 : anyLive ? 30_000 : 5 * 60_000;
    state.timer = setTimeout(() => loadDay({ silent: true }), ms);
  }

  // ---------- live updates (Server-Sent Events) ----------
  function setLive(on) {
    state.liveConnected = on;
    el.livedot.classList.toggle('hidden', !on);
  }

  function applyLive(u) {
    const g = state.games.get(u.id);
    if (!g) return; // not on the day being viewed
    g.status = u.status;
    Object.assign(g.home, u.home);
    Object.assign(g.away, u.away);
    // A game may move between groups (pre -> live -> final), so re-render the list.
    const focused = document.activeElement?.closest?.('[data-id]')?.dataset.id;
    render();
    const card = document.querySelector(`[data-id="${CSS.escape(u.id)}"]`);
    if (card) {
      card.classList.add('flash');
      setTimeout(() => card.classList.remove('flash'), 1200);
    }
    if (focused) document.querySelector(`[data-id="${CSS.escape(focused)}"]`)?.focus();
    if (state.modalId === u.id) {
      const head = $('#modal-title');
      const sub = head?.nextElementSibling;
      if (head) {
        const tmp = document.createElement('div');
        tmp.innerHTML = modalHead(g);
        head.replaceWith(tmp.firstElementChild);
        if (sub) sub.replaceWith(tmp.firstElementChild);
      }
    }
    el.updated.textContent = `Updated ${timeFmt.format(new Date())}`;
  }

  function connectLive() {
    if (state.live || !('EventSource' in window)) return;
    const es = new EventSource('/api/live');
    state.live = es;
    es.addEventListener('hello', () => {
      setLive(true);
      scheduleRefresh();
    });
    es.addEventListener('game', (e) => {
      try {
        applyLive(JSON.parse(e.data));
      } catch (err) {
        console.warn('bad live message', err);
      }
    });
    es.onerror = () => {
      // The browser reconnects on its own; poll faster until it does.
      if (state.liveConnected) {
        setLive(false);
        scheduleRefresh();
      }
    };
  }

  function shiftDay(n) {
    const dt = fromYmd(state.date);
    dt.setDate(dt.getDate() + n);
    state.date = ymd(dt);
    loadDay();
  }

  // ---------- modal ----------
  function openModal(html) {
    el.modalBody.innerHTML = html;
    el.modal.classList.remove('hidden');
    el.modal.scrollTop = 0;
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    el.modal.classList.add('hidden');
    el.modalBody.innerHTML = '';
    document.body.style.overflow = '';
    stopModalRefresh();
  }

  function modalHead(g) {
    const [left, right] = teamsInOrder(g);
    const score = (t) => (g.status.state === 'pre' ? '' : `<span class="mscore">${esc(t.score ?? '')}</span>`);
    const sep = g.sport === 'soccer' ? 'vs' : '@';
    const sub = [
      statusHtml(g),
      g.venue.name ? `<span>${esc(venueText(g))}</span>` : '',
      g.broadcast ? `<span>${esc(g.broadcast)}</span>` : '',
      g.odds ? `<span class="spread">${esc(g.odds)}</span>` : '',
    ]
      .filter(Boolean)
      .join('');
    return `<div class="mhead" id="modal-title">
      <div class="mteam">${img(left.logo, left.name)}<span>${esc(left.name)}</span>${score(left)}</div>
      <span class="vs">${sep}</span>
      <div class="mteam">${score(right)}${img(right.logo, right.name)}<span>${esc(right.name)}</span></div>
    </div><div class="msub">${sub}</div>`;
  }

  function startModalRefresh(id) {
    stopModalRefresh();
    state.modalId = id;
    const g = state.games.get(id);
    if (!g || g.status.state === 'post') return;
    state.modalTimer = setInterval(() => {
      const cur = state.games.get(id);
      if (!cur || state.modalId !== id) return stopModalRefresh();
      const soon = new Date(cur.date).getTime() - Date.now() < 90 * 60_000; // lineups window
      if (cur.status.state === 'in' || (cur.status.state === 'pre' && soon)) refreshModalBody(id);
      if (cur.status.state === 'post') stopModalRefresh();
    }, 10_000);
  }
  function stopModalRefresh() {
    clearInterval(state.modalTimer);
    state.modalTimer = null;
    state.modalId = null;
  }
  async function refreshModalBody(id) {
    const g = state.games.get(id);
    if (!g) return;
    try {
      const res = await fetch(`/api/game/${g.sport}/${g.league.slug}/${g.id}`);
      if (!res.ok) return;
      const detail = await res.json();
      if (state.modalId !== id || el.modal.classList.contains('hidden')) return;
      const body = g.sport === 'soccer' ? detailSoccer(g, detail) : g.sport === 'nfl' ? detailNfl(g, detail) : detailNba(g, detail);
      const open = [...el.modalBody.querySelectorAll('details')].map((d) => d.open);
      const scroll = el.modal.scrollTop;
      el.modalBody.innerHTML = modalHead(g) + body;
      el.modalBody.querySelectorAll('details').forEach((d, i) => {
        if (open[i]) d.open = true;
      });
      el.modal.scrollTop = scroll;
    } catch {
      /* keep the old body */
    }
  }

  async function openGame(id) {
    const g = state.games.get(id);
    if (!g) return;
    openModal(`${modalHead(g)}<div class="spinner">Loading details…</div>`);
    try {
      const res = await fetch(`/api/game/${g.sport}/${g.league.slug}/${g.id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const detail = await res.json();
      if (el.modal.classList.contains('hidden')) return;
      const body = g.sport === 'soccer' ? detailSoccer(g, detail) : g.sport === 'nfl' ? detailNfl(g, detail) : detailNba(g, detail);
      el.modalBody.innerHTML = modalHead(g) + body;
      startModalRefresh(g.id);
    } catch (e) {
      el.modalBody.innerHTML = `${modalHead(g)}<p class="error">Could not load details: ${esc(e.message)}</p>`;
    }
  }

  // ---------- soccer detail ----------
  const SOCCER_COLS = ['G', 'A', 'SH', 'SOT', 'SV'];
  function soccerRow(p, showStats, sub) {
    const s = p.stats || {};
    const cards = `${s.YC ? '<span class="cardi yc" title="Yellow card"></span>' : ''}${s.RC ? '<span class="cardi rc" title="Red card"></span>' : ''}`;
    const flags = `${p.subbedOut ? '<span class="flag off" title="Substituted off">off</span>' : ''}${p.subbedIn ? '<span class="flag on" title="Substituted on">on</span>' : ''}`;
    const cells = showStats ? SOCCER_COLS.map((k) => `<td class="${s[k] ? 'hi' : ''}">${s[k] ?? 0}</td>`).join('') : '';
    return `<tr class="${sub ? 'sub' : ''}"><td class="num">${esc(p.jersey || '')}</td><td class="pname">${esc(p.name)}${cards}${flags}</td><td class="pos">${esc(p.pos || '')}</td>${cells}</tr>`;
  }

  function lineupPanel(l, title, showStats = false) {
    const anyStats = l.starters.concat(l.subs || []).some((p) => p.stats);
    showStats = showStats && anyStats;
    const head = `<thead><tr><th></th><th>Player</th><th></th>${showStats ? SOCCER_COLS.map((c) => `<th title="${c === 'G' ? 'Goals' : c === 'A' ? 'Assists' : c === 'SH' ? 'Shots' : c === 'SOT' ? 'Shots on target' : 'Saves'}">${c}</th>`).join('') : ''}</tr></thead>`;
    const starters = l.starters.map((p) => soccerRow(p, showStats, false)).join('');
    const usedSubs = (l.subs || []).filter((p) => p.subbedIn);
    const unused = (l.subs || []).filter((p) => !p.subbedIn);
    const subsRows = usedSubs.map((p) => soccerRow(p, showStats, true)).join('');
    const bench = unused.length
      ? `<details><summary>Unused substitutes (${unused.length})</summary><table class="box">${unused.map((p) => soccerRow(p, false, true)).join('')}</table></details>`
      : '';
    return `<div class="panel"><h3>${img(l.team.logo, l.team.name)} ${esc(l.team.name)}${l.formation ? `<span class="right">${esc(l.formation)}</span>` : ''}</h3>
      ${title ? `<p class="note" style="margin:0 0 8px">${title}</p>` : ''}
      <div class="scroll"><table class="box">${head}<tbody>${starters}${subsRows}</tbody></table></div>${bench}</div>`;
  }

  // Side-by-side team stat comparison with proportional bars.
  function comparePanel(title, teams, rows) {
    if (!teams || teams.length !== 2) return '';
    const [a, b] = teams;
    const numeric = (v) => {
      const m = String(v ?? '').match(/-?\d+(\.\d+)?/);
      return m ? Number(m[0]) : null;
    };
    const body = rows
      .filter((r) => a.stats[r.key] != null || b.stats[r.key] != null)
      .map((r) => {
        const va = a.stats[r.key] ?? '-';
        const vb = b.stats[r.key] ?? '-';
        const na = numeric(va) ?? 0;
        const nb = numeric(vb) ?? 0;
        const tot = na + nb || 1;
        const pa = Math.round((na / tot) * 100);
        const lead = r.lowerBetter ? na < nb : na > nb;
        const leadB = r.lowerBetter ? nb < na : nb > na;
        return `<div class="cmp"><span class="va ${lead ? 'lead' : ''}">${esc(r.fmt ? r.fmt(va) : va)}</span><div class="bars"><div class="bar a" style="width:${pa}%"></div><div class="bar b" style="width:${100 - pa}%"></div></div><span class="vb ${leadB ? 'lead' : ''}">${esc(r.fmt ? r.fmt(vb) : vb)}</span><span class="lbl">${esc(r.label)}</span></div>`;
      })
      .join('');
    if (!body) return '';
    return `<div class="panel full"><h3>${esc(title)}</h3>
      <div class="cmp-head"><span>${img(a.team.logo, a.team.name)} ${esc(a.team.abbrev || a.team.name)}</span><span>${esc(b.team.abbrev || b.team.name)} ${img(b.team.logo, b.team.name)}</span></div><div class="cmp-grid">${body}</div></div>`;
  }

  // Generic box-score table: labels + rows of {name, pos, jersey, stats[]}.
  function boxTable(labels, rows, { keep = null, sortBy = null, limit = null, descriptions = [] } = {}) {
    let cols = labels.map((l, i) => ({ l, i, d: descriptions[i] || '' }));
    if (keep) cols = cols.filter((c) => keep.includes(c.l));
    let list = rows;
    if (sortBy != null) {
      const si = labels.indexOf(sortBy);
      if (si >= 0) list = [...rows].sort((x, y) => (parseFloat(y.stats[si]) || 0) - (parseFloat(x.stats[si]) || 0));
    }
    if (limit) list = list.slice(0, limit);
    return `<div class="scroll"><table class="box"><thead><tr><th>Player</th>${cols.map((c) => `<th title="${esc(c.d)}">${esc(c.l)}</th>`).join('')}</tr></thead><tbody>${list
      .map((r) => `<tr class="${r.cls || ''}"><td class="pname">${esc(r.name)}${r.pos ? `<span class="pos">${esc(r.pos)}</span>` : ''}</td>${cols.map((c) => `<td>${esc(r.stats[c.i] ?? '')}</td>`).join('')}</tr>`)
      .join('')}</tbody></table></div>`;
  }

  const SOCCER_TEAM_ROWS = [
    { key: 'possessionPct', label: 'Possession', fmt: (v) => `${v}%` },
    { key: 'totalShots', label: 'Shots' },
    { key: 'shotsOnTarget', label: 'On target' },
    { key: 'blockedShots', label: 'Blocked shots' },
    { key: 'wonCorners', label: 'Corners' },
    { key: 'offsides', label: 'Offsides' },
    { key: 'foulsCommitted', label: 'Fouls', lowerBetter: true },
    { key: 'yellowCards', label: 'Yellow cards', lowerBetter: true },
    { key: 'redCards', label: 'Red cards', lowerBetter: true },
    { key: 'passPct', label: 'Pass accuracy', fmt: (v) => `${Math.round(Number(v) * 100)}%` },
    { key: 'totalTackles', label: 'Tackles' },
    { key: 'interceptions', label: 'Interceptions' },
    { key: 'saves', label: 'Saves' },
  ];
  const NFL_TEAM_ROWS = [
    { key: 'totalYards', label: 'Total yards' },
    { key: 'netPassingYards', label: 'Passing yards' },
    { key: 'rushingYards', label: 'Rushing yards' },
    { key: 'firstDowns', label: 'First downs' },
    { key: 'thirdDownEff', label: '3rd down' },
    { key: 'fourthDownEff', label: '4th down' },
    { key: 'redZoneAttempts', label: 'Red zone' },
    { key: 'turnovers', label: 'Turnovers', lowerBetter: true },
    { key: 'sacksYardsLost', label: 'Sacked', lowerBetter: true },
    { key: 'totalPenaltiesYards', label: 'Penalties', lowerBetter: true },
    { key: 'possessionTime', label: 'Possession' },
  ];
  const NBA_TEAM_ROWS = [
    { key: 'fieldGoalsMade-fieldGoalsAttempted', label: 'Field goals' },
    { key: 'fieldGoalPct', label: 'FG %', fmt: (v) => `${v}%` },
    { key: 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', label: '3-pointers' },
    { key: 'threePointFieldGoalPct', label: '3P %', fmt: (v) => `${v}%` },
    { key: 'freeThrowsMade-freeThrowsAttempted', label: 'Free throws' },
    { key: 'totalRebounds', label: 'Rebounds' },
    { key: 'offensiveRebounds', label: 'Off. rebounds' },
    { key: 'assists', label: 'Assists' },
    { key: 'steals', label: 'Steals' },
    { key: 'blocks', label: 'Blocks' },
    { key: 'turnovers', label: 'Turnovers', lowerBetter: true },
    { key: 'pointsInPaint', label: 'Points in paint' },
    { key: 'fastBreakPoints', label: 'Fast break pts' },
    { key: 'fouls', label: 'Fouls', lowerBetter: true },
  ];

  function orderTeams(stats, leftId) {
    if (!stats || stats.length !== 2) return null;
    return String(stats[0].team.id) === String(leftId) ? stats : [stats[1], stats[0]];
  }

  function last5Table(games) {
    if (!games?.length) return '<p class="note">No recent results.</p>';
    return `<table class="l5">${[...games]
      .reverse()
      .map((r) => {
        const res = (r.result || '-').toUpperCase();
        return `<tr><td><span class="f f-${esc(res)}">${esc(res)}</span></td><td class="score">${esc(r.score || '')}</td><td class="op">${r.opponentLogo ? img(r.opponentLogo, r.opponent) : ''}<span>${r.isHome ? 'vs' : '@'} ${esc(r.opponent || '')}</span></td><td class="mut">${r.competition ? esc(r.competition) : ''}</td><td class="mut">${r.date ? fmtShort(r.date) : ''}</td></tr>`;
      })
      .join('')}</table>`;
  }

  function detailSoccer(g, d) {
    const parts = [];
    const started = g.status.state !== 'pre';
    if (started) parts.push(comparePanel('Match stats', orderTeams(d.teamStats, g.home.id), SOCCER_TEAM_ROWS));
    if (d.lineupsAvailable) {
      const ordered = [...d.lineups].sort((a, b) => (a.homeAway === 'home' ? -1 : 1) - (b.homeAway === 'home' ? -1 : 1));
      parts.push(ordered.map((l) => lineupPanel(l, null, started)).join(''));
    } else {
      parts.push(`<div class="panel full"><h3>Lineups</h3><p class="note" style="margin:0">Starting XIs are not out yet. ESPN publishes them roughly an hour before kickoff.${d.previousLineups?.length ? " Below is each side's most recent starting XI." : ''}</p></div>`);
      for (const l of d.previousLineups || []) {
        const c = l.context;
        const title = c ? `Last XI: ${esc(c.result || '')} ${esc(c.score || '')} ${c.isHome ? 'vs' : '@'} ${esc(c.opponent || '')} · ${c.date ? fmtShort(c.date) : ''}${c.competition ? ' · ' + esc(c.competition) : ''}` : 'Most recent starting XI';
        parts.push(lineupPanel(l, title));
      }
    }
    if (d.keyEvents?.length) {
      const teamOf = (id) => (String(id) === String(g.home.id) ? g.home : String(id) === String(g.away.id) ? g.away : null);
      parts.push(`<div class="panel full"><h3>Key events</h3><ul class="events">${d.keyEvents
        .map((k) => {
          const t = teamOf(k.teamId);
          const icon = /red/i.test(k.type) ? '🟥' : /yellow/i.test(k.type) ? '🟨' : /penalty.*miss|missed/i.test(k.type) ? '❌' : '⚽';
          return `<li><span class="clk">${esc(k.clock)}</span><span>${icon}</span><span>${t ? img(t.logo, t.name, '') : ''}${esc(k.player ? `${k.player} · ` : '')}${esc(k.type)}${t ? ` <span style="color:var(--muted)">(${esc(t.shortName)})</span>` : ''}</span></li>`;
        })
        .join('')}</ul></div>`);
    }
    const l5 = (team) => {
      const games = d.last5?.find((x) => String(x.teamId) === String(team.id))?.games || team.last5;
      return `<div class="panel"><h3>${img(team.logo, team.name)} ${esc(team.name)} <span class="right">last 5</span></h3>${last5Table(games)}</div>`;
    };
    parts.push(l5(g.home), l5(g.away));
    parts.push(weatherPanel(g));
    return `<div class="mgrid">${parts.join('')}</div>`;
  }

  function weatherPanel(g) {
    const w = g.weather;
    if (!w) return '';
    if (w.indoor) return `<div class="panel"><h3>Weather</h3><div class="wxbig">${svg('indoor', 'Indoors')}<div><div class="temp" style="font-size:18px">Indoors</div><div class="det">Dome or closed roof</div></div></div></div>`;
    const det = [w.label, w.windMph != null ? `wind ${Math.round(w.windMph)} mph${w.gustMph ? ` (gusts ${Math.round(w.gustMph)})` : ''}` : null, w.precipProb != null ? `${w.precipProb}% chance of precipitation` : null]
      .filter(Boolean)
      .join(' · ');
    return `<div class="panel"><h3>Weather at kickoff${w.place ? `<span class="right">${esc(w.place)}</span>` : ''}</h3><div class="wxbig">${svg(w.icon, w.label || 'Weather')}<div><div class="temp">${deg(w.tempF)}</div><div class="det">${esc(det)}</div></div></div></div>`;
  }

  // ---------- NFL detail ----------
  function statusClass(s) {
    const k = String(s || '').toLowerCase().replace(/[^a-z]+/g, '-');
    if (/^(out|ir|injured-reserve|pup|nfi|suspended|sus|doubtful)/.test(k)) return k.startsWith('injured') ? 'st-ir' : `st-${k.split('-')[0]}`;
    if (/questionable/.test(k)) return 'st-questionable';
    if (/day-to-day|gtd/.test(k)) return 'st-day-to-day';
    if (/probable|active/.test(k)) return 'st-probable';
    return 'st-other';
  }

  function injuryList(team, list) {
    const items = list?.length
      ? `<ul class="inj">${list
          .map((i) => {
            const why = [i.type, i.side, i.returnDate && i.status !== 'Out' ? `return ${fmtShort(i.returnDate)}` : null].filter(Boolean).join(' · ');
            return `<li><span class="who">${esc(i.name)}<span class="pos">${esc(i.pos || '')}</span>${why ? `<span class="why">${esc(why)}</span>` : ''}</span><span class="st ${statusClass(i.status)}">${esc(i.status || '')}</span></li>`;
          })
          .join('')}</ul>`
      : '<p class="note" style="margin:0">No players listed.</p>';
    return `<div class="panel"><h3>${img(team.logo, team.name)} ${esc(team.name)} <span class="right">injuries</span></h3>${items}</div>`;
  }

  function rankTier(r, n = 32) {
    if (!r) return 'mid';
    if (r <= Math.ceil(n / 4)) return 'good';
    if (r > n - Math.ceil(n / 4)) return 'bad';
    return 'mid';
  }
  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return `${n}<sup>${s[(v - 20) % 10] || s[v] || s[0]}</sup>`;
  }

  function rankPanel(team, rk, meta) {
    if (!rk) return `<div class="panel"><h3>${img(team.logo, team.name)} ${esc(team.name)} <span class="right">rankings</span></h3><p class="note" style="margin:0">${esc(meta?.note || 'Rankings not available yet.')}</p></div>`;
    const cell = (k, label) => {
      const v = rk[k];
      return `<div class="rank"><div class="k">${label}</div><div class="v"><span class="r ${rankTier(v.rank)}">${ordinal(v.rank)}</span><span class="y">${esc(v.perGame)} yds/g</span></div></div>`;
    };
    return `<div class="panel"><h3>${img(team.logo, team.name)} ${esc(team.name)} <span class="right">rankings</span></h3>
      <div class="ranks">${cell('passOff', 'Pass offense')}${cell('rushOff', 'Rush offense')}${cell('passDef', 'Pass defense')}${cell('rushDef', 'Rush defense')}</div>
      <p class="note">Yards per game over ${rk.games} game${rk.games === 1 ? '' : 's'}${meta?.week ? ` · through week ${meta.week}` : ''}</p></div>`;
  }

  const NFL_CATS = [
    { name: 'passing', title: 'Passing' },
    { name: 'rushing', title: 'Rushing' },
    { name: 'receiving', title: 'Receiving' },
    { name: 'defensive', title: 'Defense', sortBy: 'TOT', limit: 8, collapsible: true },
    { name: 'kicking', title: 'Kicking', collapsible: true },
    { name: 'interceptions', title: 'Interceptions', collapsible: true },
    { name: 'fumbles', title: 'Fumbles', collapsible: true },
    { name: 'kickReturns', title: 'Kick returns', collapsible: true },
    { name: 'puntReturns', title: 'Punt returns', collapsible: true },
    { name: 'punting', title: 'Punting', collapsible: true },
  ];

  function nflBoxPanel(t, box) {
    const b = box?.find((x) => String(x.team.id) === String(t.id));
    if (!b) return '';
    const blocks = NFL_CATS.map((c) => {
      const cat = b.categories.find((x) => x.name === c.name);
      if (!cat || !cat.athletes.length) return '';
      const table = boxTable(cat.labels, cat.athletes, { sortBy: c.sortBy, limit: c.limit, descriptions: cat.descriptions });
      const more = c.limit && cat.athletes.length > c.limit ? ` (top ${c.limit} of ${cat.athletes.length})` : '';
      return c.collapsible ? `<details><summary>${esc(c.title)}${more}</summary>${table}</details>` : `<div class="subhead">${esc(c.title)}</div>${table}`;
    }).join('');
    return `<div class="panel"><h3>${img(t.logo, t.name)} ${esc(t.name)} <span class="right">box score</span></h3>${blocks}</div>`;
  }

  function detailNfl(g, d) {
    const teams = [g.away, g.home];
    const parts = [];
    const meta = d.rankings?.meta;
    if (g.status.state !== 'pre') {
      parts.push(comparePanel('Team stats', orderTeams(d.teamStats, g.away.id), NFL_TEAM_ROWS));
      for (const t of teams) parts.push(nflBoxPanel(t, d.players));
    }
    for (const t of teams) parts.push(rankPanel(t, d.rankings?.teams?.[String(t.id)], meta));
    for (const t of teams) {
      const inj = d.injuries?.find((x) => String(x.team.id) === String(t.id));
      parts.push(injuryList(t, inj?.list || []));
    }
    parts.push(weatherPanel(g));
    if (d.rankings?.error) parts.push(`<p class="error full">Rankings unavailable: ${esc(d.rankings.error)}</p>`);
    return `<div class="mgrid">${parts.join('')}</div>`;
  }

  // ---------- NBA detail ----------
  function nbaPlayerLi(p, opts = {}) {
    const stat = p.dnp ? `<span class="stat">DNP${p.reason ? ` · ${esc(p.reason.toLowerCase())}` : ''}</span>` : p.min != null ? `<span class="stat">${esc(p.min)} min · ${esc(p.pts ?? 0)} pts</span>` : '';
    const inj = p.injury ? `<span class="st ${statusClass(p.injury.status)}" title="${esc(p.injury.type || '')}">${esc(p.injury.status)}</span>` : '';
    return `<li class="${opts.sub ? 'sub' : ''}"><span class="num">${esc(p.jersey || '')}</span><span class="pname">${esc(p.name)} <span class="pos">${esc(p.pos || '')}</span></span><span>${stat}${inj}</span></li>`;
  }

  function detailNba(g, d) {
    const parts = [];
    const teams = [g.away, g.home];
    if (d.lineups) {
      parts.push(comparePanel('Team stats', orderTeams(d.teamStats, g.away.id), NBA_TEAM_ROWS));
      const keep = ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PF', '+/-'];
      for (const t of teams) {
        const l = d.lineups.find((x) => String(x.team.id) === String(t.id));
        if (!l) continue;
        const bench = l.bench.filter((p) => !p.dnp);
        const dnp = l.bench.filter((p) => p.dnp);
        const rows = [...l.starters.map((p) => ({ ...p, cls: 'starter' })), ...bench.map((p) => ({ ...p, cls: 'sub' }))];
        parts.push(`<div class="panel full"><h3>${img(t.logo, t.name)} ${esc(t.name)} <span class="right">box score · starters then bench</span></h3>
          ${boxTable(l.labels, rows, { keep, descriptions: l.descriptions })}
          ${dnp.length ? `<details><summary>Did not play (${dnp.length})</summary><ul class="plist">${dnp.map((p) => nbaPlayerLi(p, { sub: true })).join('')}</ul></details>` : ''}
        </div>`);
      }
    } else {
      parts.push(`<div class="panel full"><h3>Lineups</h3><p class="note" style="margin:0">Starting fives post at tip-off. Until then, here is each roster with the current injury report.</p></div>`);
      for (const t of teams) {
        const r = d.rosters?.find((x) => String(x.team.id) === String(t.id));
        const players = [...(r?.players || [])].sort((a, b) => (a.injury ? 1 : 0) - (b.injury ? 1 : 0) || String(a.pos).localeCompare(String(b.pos)));
        parts.push(`<div class="panel"><h3>${img(t.logo, t.name)} ${esc(t.name)} <span class="right">roster</span></h3>
          ${players.length ? `<ul class="plist">${players.map((p) => nbaPlayerLi(p)).join('')}</ul>` : `<p class="note" style="margin:0">Roster unavailable${r?.error ? `: ${esc(r.error)}` : ''}.</p>`}</div>`);
      }
    }
    for (const t of teams) {
      const inj = d.injuries?.find((x) => String(x.team.id) === String(t.id));
      if (inj?.list?.length) parts.push(injuryList(t, inj.list));
    }
    return `<div class="mgrid">${parts.join('')}</div>`;
  }

  // ---------- events ----------
  $('#prev').addEventListener('click', () => shiftDay(-1));
  $('#next').addEventListener('click', () => shiftDay(1));
  $('#today').addEventListener('click', () => {
    state.date = ymd(new Date());
    loadDay();
  });
  $('#refresh').addEventListener('click', () => loadDay());
  el.datepick.addEventListener('change', () => {
    if (!el.datepick.value) return;
    state.date = el.datepick.value.replace(/-/g, '');
    loadDay();
  });
  el.tabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    state.sportTab = b.dataset.tab;
    save('sportTab', state.sportTab);
    render();
  });
  el.filters.addEventListener('click', (e) => {
    const b = e.target.closest('[data-slug]');
    if (!b || b.getAttribute('aria-disabled') === 'true') return;
    const slug = b.dataset.slug;
    if (state.hiddenLeagues.has(slug)) state.hiddenLeagues.delete(slug);
    else state.hiddenLeagues.add(slug);
    save('hiddenLeagues', [...state.hiddenLeagues]);
    render();
  });
  el.groups.addEventListener('click', (e) => {
    const card = e.target.closest('[data-id]');
    if (card) openGame(card.dataset.id);
  });
  el.groups.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('[data-id]');
    if (card) {
      e.preventDefault();
      openGame(card.dataset.id);
    }
  });
  el.modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.modal.classList.contains('hidden')) closeModal();
    if (el.modal.classList.contains('hidden') && !e.target.closest?.('input')) {
      if (e.key === 'ArrowLeft') shiftDay(-1);
      if (e.key === 'ArrowRight') shiftDay(1);
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.data) loadDay({ silent: true });
  });

  loadDay();
  connectLive();
})();
