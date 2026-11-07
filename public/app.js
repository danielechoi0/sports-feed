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
    polling: false, // fallback when the SSE stream is unavailable (serverless hosts)
    pollTimer: null,
    modalId: null,
    modalTimer: null,
    tickTimer: null,
    halftimeAt: new Map(), // soccer game id -> halftime whistle ISO (from detail)
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
  function setLive(on, mode = 'push') {
    state.liveConnected = on;
    el.livedot.classList.toggle('hidden', !on);
    el.livedot.title = mode === 'poll'
      ? 'Live updates via polling: scores and clocks refresh every 7 seconds'
      : 'Live updates connected: scores and clocks are pushed within seconds';
  }

  const liveKey = (g) => JSON.stringify([g.status, g.home.score, g.home.winner, g.home.record, g.away.score, g.away.winner, g.away.record]);

  function applyLive(u) {
    const g = state.games.get(u.id);
    if (!g) return; // not on the day being viewed
    if (liveKey(u) === liveKey(g)) return; // nothing changed (polling returns every live game)
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

  // Polling fallback: used when the server cannot hold an SSE stream open
  // (serverless hosts such as Vercel), when EventSource is missing, or when
  // the URL carries ?live=poll. Each tick fetches the live fields of every
  // in-progress game for the viewed date; applyLive ignores unchanged ones.
  function startPolling() {
    if (state.polling) return;
    state.polling = true;
    if (state.live) {
      state.live.close();
      state.live = null;
    }
    setLive(true, 'poll');
    scheduleRefresh();
    const tick = async () => {
      try {
        const res = await fetch(`/api/live-poll?date=${state.date}`);
        if (res.ok) {
          const j = await res.json();
          for (const u of j.games || []) applyLive(u);
        }
      } catch {
        /* transient; try again next tick */
      }
      state.pollTimer = setTimeout(tick, 7_000);
    };
    tick();
  }

  function connectLive() {
    if (state.live || state.polling) return;
    const forcePoll = new URLSearchParams(location.search).get('live') === 'poll';
    if (forcePoll || !('EventSource' in window)) return startPolling();
    const es = new EventSource('/api/live');
    state.live = es;
    let gotHello = false;
    const fallback = () => {
      clearTimeout(giveUp);
      es.close();
      state.live = null;
      startPolling();
    };
    // No greeting within 4 s (404 from a serverless host, proxy buffering, ...)
    // means the stream is not going to work: switch to polling.
    const giveUp = setTimeout(() => {
      if (!gotHello) fallback();
    }, 4_000);
    es.addEventListener('hello', () => {
      gotHello = true;
      clearTimeout(giveUp);
      setLive(true, 'push');
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
      if (!gotHello) return fallback();
      // The browser reconnects on its own; poll the day faster until it does.
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

  // Soccer halftime: count down to the expected restart (whistle + 15 min).
  const HALFTIME_MS = 15 * 60_000;
  function isSoccerHalftime(g) {
    const s = g.status;
    return g.sport === 'soccer' && s.state === 'in' && s.period === 1 && /halftime/i.test(s.description || '');
  }
  function restartText(restartMs) {
    const left = Math.round((restartMs - Date.now()) / 1000);
    if (left <= 0) return '2nd half starting soon';
    return `2nd half in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  }
  function halftimeHtml(g) {
    const at = state.halftimeAt.get(g.id);
    if (!isSoccerHalftime(g) || !at) return '';
    const whistle = new Date(at).getTime();
    if (!Number.isFinite(whistle)) return '';
    const restart = whistle + HALFTIME_MS;
    const title = `Estimate: halftime whistle at ${timeFmt.format(new Date(whistle))} + 15 min`;
    return `<span class="ht-countdown" data-restart="${restart}" title="${esc(title)}">${esc(restartText(restart))}</span>`;
  }
  function tickHalftime() {
    el.modalBody.querySelectorAll('[data-restart]').forEach((n) => {
      n.textContent = restartText(Number(n.dataset.restart));
    });
  }

  function modalHead(g) {
    const [left, right] = teamsInOrder(g);
    const score = (t) => (g.status.state === 'pre' ? '' : `<span class="mscore">${esc(t.score ?? '')}</span>`);
    const sep = g.sport === 'soccer' ? 'vs' : '@';
    const sub = [
      statusHtml(g),
      halftimeHtml(g),
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
    state.tickTimer = setInterval(tickHalftime, 1000);
  }
  function stopModalRefresh() {
    clearInterval(state.modalTimer);
    clearInterval(state.tickTimer);
    state.modalTimer = null;
    state.tickTimer = null;
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
      if (detail.halftimeAt) state.halftimeAt.set(g.id, detail.halftimeAt);
      if (g.sport === 'soccer' && sim.data && sim.gameId === id) await loadSim(g, { silent: true });
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
      if (detail.halftimeAt) state.halftimeAt.set(g.id, detail.halftimeAt);
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
    const yellow = s.YC || (p.secondYellow && p.sentOff);
    const cards = `${yellow ? `<span class="cardi yc" title="Yellow card${p.yellowAt ? ` ${esc(p.yellowAt)}` : ''}"></span>` : ''}${s.RC || p.sentOff ? `<span class="cardi rc" title="Red card${p.sentOff ? ` ${esc(p.sentOff)}` : ''}"></span>` : ''}`;
    const min = (m) => (m ? ` ${esc(m)}` : '');
    const flags = p.sentOff
      ? `<span class="flag sentoff" title="${p.secondYellow ? 'Sent off, second yellow' : 'Sent off, straight red'}">sent off${min(p.sentOff)}</span>`
      : `${p.subbedOut ? `<span class="flag off" title="Substituted off">off${min(p.subbedOutAt)}</span>` : ''}${p.subbedIn ? `<span class="flag on" title="Substituted on">on${min(p.subbedInAt)}</span>` : ''}`;
    const cells = showStats ? SOCCER_COLS.map((k) => `<td class="${s[k] ? 'hi' : ''}">${s[k] ?? 0}</td>`).join('') : '';
    const cls = [sub ? 'sub' : '', p.sentOff ? 'off' : ''].filter(Boolean).join(' ');
    return `<tr class="${cls}"><td class="num">${esc(p.jersey || '')}</td><td class="pname">${esc(p.name)}${cards}${flags}</td><td class="pos">${esc(p.pos || '')}</td>${cells}</tr>`;
  }

  // Players currently on the pitch after reds and substitutions.
  function menOnPitch(l) {
    const all = l.starters.concat(l.subs || []);
    return all.filter((p) => (p.starter || p.subbedIn) && !p.subbedOut && !p.sentOff).length;
  }

  function lineupPanel(l, title, showStats = false) {
    const anyStats = l.starters.concat(l.subs || []).some((p) => p.stats);
    showStats = showStats && anyStats;
    const reds = l.starters.concat(l.subs || []).filter((p) => p.sentOff);
    const men = menOnPitch(l);
    const menNote = reds.length && men < 11 ? `<span class="men" title="${esc(reds.map((p) => `${p.name} ${p.sentOff}`).join(', '))}">${men} men</span>` : '';
    const head = `<thead><tr><th></th><th>Player</th><th></th>${showStats ? SOCCER_COLS.map((c) => `<th title="${c === 'G' ? 'Goals' : c === 'A' ? 'Assists' : c === 'SH' ? 'Shots' : c === 'SOT' ? 'Shots on target' : 'Saves'}">${c}</th>`).join('') : ''}</tr></thead>`;
    const starters = l.starters.map((p) => soccerRow(p, showStats, false)).join('');
    const usedSubs = (l.subs || []).filter((p) => p.subbedIn);
    const unused = (l.subs || []).filter((p) => !p.subbedIn);
    const subsRows = usedSubs.map((p) => soccerRow(p, showStats, true)).join('');
    const bench = unused.length
      ? `<details><summary>Unused substitutes (${unused.length})</summary><table class="box">${unused.map((p) => soccerRow(p, false, true)).join('')}</table></details>`
      : '';
    return `<div class="panel"><h3>${img(l.team.logo, l.team.name)} ${esc(l.team.name)}<span class="right">${menNote}${l.formation ? esc(l.formation) : ''}</span></h3>
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
      .map((r) => `<tr class="${r.cls || ''}${r.ejected ? ' off' : ''}"><td class="pname">${esc(r.name)}${r.pos ? `<span class="pos">${esc(r.pos)}</span>` : ''}${r.ejected ? '<span class="flag sentoff" title="Ejected from the game">ejected</span>' : ''}</td>${cols.map((c) => `<td>${esc(r.stats[c.i] ?? '')}</td>`).join('')}</tr>`)
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
    parts.push(simPanelHtml(g));
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

  // ---------- soccer shot simulator ----------
  // Server supplies per-player rates (form-weighted, opponent-adjusted, shrunk
  // toward position priors) and team factors; the Monte Carlo runs here.
  const sim = { gameId: null, data: null, scenario: null, edits: null, loading: false, error: null, results: null, remainingAuto: true };
  const SIM_RUNS = 10000;
  const TEMPO = { slow: 0.85, normal: 1, fast: 1.15 };

  function simReset(gameId) {
    sim.gameId = gameId;
    sim.data = null;
    sim.scenario = null;
    sim.edits = null;
    sim.error = null;
    sim.results = null;
    sim.loading = false;
    sim.remainingAuto = true;
  }

  function simDefaultScenario(d) {
    const now = d.match.state === 'pre' ? 0 : d.match.minute;
    return {
      scoreState: 'current',
      red: 'none',
      redMinute: Math.min(90, now + 10),
      tempo: 'normal',
      remaining: d.match.state === 'post' ? 0 : Math.max(0, 90 - now),
      threshold: 10,
      subMinute: Math.min(90, now + 15),
      playerTeam: 'all',
      showAll: false,
    };
  }

  async function loadSim(g, { silent = false } = {}) {
    if (sim.gameId !== g.id) simReset(g.id);
    if (!silent) {
      sim.loading = true;
      sim.error = null;
      simRender(g);
    }
    try {
      const res = await fetch(`/api/soccer/${g.league.slug}/${g.id}/shotmodel`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Leagues with a fitted model (models/shot-<league>.json) are simulated by public/teamShare.js.
      if (data.model && !sim.TS) sim.TS = await import('./teamShare.js');
      if (sim.gameId !== g.id) return;
      sim.data = data;
      if (!sim.scenario) sim.scenario = simDefaultScenario(data);
      else if (sim.remainingAuto) sim.scenario.remaining = data.match.state === 'post' ? 0 : Math.max(0, 90 - (data.match.state === 'pre' ? 0 : data.match.minute));
      if (!sim.edits) sim.edits = {};
      simCompute();
      if (sim.results && !sim.thresholdTouched) {
        // Default y to the larger side's expected shots so both team probabilities are informative.
        sim.scenario.threshold = Math.max(1, Math.round(Math.max(...sim.results.teams.map((t) => t.mean))));
        simCompute();
      }
    } catch (e) {
      sim.error = e.message;
    } finally {
      sim.loading = false;
      simRender(g);
    }
  }

  function simRender(g) {
    const panel = document.getElementById('sim-panel');
    if (!panel) return;
    panel.innerHTML = simInner(g);
  }

  function simPanelHtml(g) {
    if (sim.gameId !== g.id) simReset(g.id);
    return `<div class="panel full sim" id="sim-panel">${simInner(g)}</div>`;
  }

  // ---- model ----
  function poisson(lambda) {
    if (lambda <= 0) return 0;
    if (lambda > 30) {
      // normal approximation for large rates
      const u = Math.random();
      const v = Math.random();
      const z = Math.sqrt(-2 * Math.log(u || 1e-12)) * Math.cos(2 * Math.PI * v);
      return Math.max(0, Math.round(lambda + z * Math.sqrt(lambda)));
    }
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= Math.random();
    } while (p > L);
    return k - 1;
  }
  function binomial(n, p) {
    let k = 0;
    for (let i = 0; i < n; i++) if (Math.random() < p) k++;
    return k;
  }

  // Build per-player expected shots (lambda) for the remainder, applying the scenario and lineup edits.
  function simPlan(d, sc, edits) {
    const pre = d.match.state === 'pre';
    const now = pre ? 0 : d.match.minute;
    const end = now + Math.max(0, Number(sc.remaining) || 0);
    const span = Math.max(0, end - now);
    const [home, away] = [d.teams.find((t) => t.id === d.match.homeId), d.teams.find((t) => t.id === d.match.awayId)];
    const teams = [home, away].filter(Boolean);
    const plan = { now, end, span, teams: [] };

    for (const t of teams) {
      const o = teams.find((x) => x.id !== t.id) || t;
      const isHome = t.id === d.match.homeId;
      // score state
      let stateMod = 1;
      const gh = d.match.score.home;
      const ga = d.match.score.away;
      const mine = isHome ? gh : ga;
      const theirs = isHome ? ga : gh;
      const lead = (s) => (s === 'level' ? 0 : s === 'home' ? (isHome ? 1 : -1) : s === 'away' ? (isHome ? -1 : 1) : Math.sign(mine - theirs));
      const ld = lead(sc.scoreState);
      if (ld < 0) stateMod = 1.2;
      else if (ld > 0) stateMod = 0.85;
      // red cards: scenario (time-weighted) + already shown
      let redMod = 1;
      if (sc.red !== 'none' && span > 0) {
        const rm = Math.min(end, Math.max(now, Number(sc.redMinute) || now));
        const f = (end - rm) / span;
        const scenarioTeam = sc.red === 'home' ? d.match.homeId : d.match.awayId;
        redMod *= scenarioTeam === t.id ? 1 + (0.65 - 1) * f : 1 + (1.3 - 1) * f;
      }
      if (t.redCards > 0) redMod *= 0.8;
      if (o.redCards > 0) redMod *= 1.2;
      const mult = o.leakiness * t.homeAwayFactor * (o.shape?.factor || 1) * (TEMPO[sc.tempo] || 1) * stateMod * redMod;
      const ed = edits[t.id] || { off: {}, on: {} };
      const goalBase = Math.max(0.05, 1 - (o.keeper?.saveRate ?? 0.7)) / 0.3;

      const players = [];
      let lost = 0;
      for (const p of t.players) {
        let s = null;
        let e = end;
        const offAt = ed.off[p.id];
        const onAt = ed.on[p.id];
        if (p.onPitch) s = now;
        else if (p.role === 'sub' && !p.subbedIn && onAt != null) s = Math.min(end, Math.max(now, onAt));
        else if (!d.match.lineupsAnnounced && p.role === 'starter' && offAt == null) s = now;
        if (s != null && offAt != null) e = Math.min(end, Math.max(s, offAt));
        if (s == null && p.onPitch && offAt != null) s = now;
        const minutes = s == null ? 0 : Math.max(0, e - s);
        const lambda = (p.rate.shots * mult * minutes) / 90;
        const removedAfter = offAt != null && s != null ? Math.max(0, end - e) : 0;
        if (removedAfter > 0) lost += (0.5 * p.rate.shots * mult * removedAfter) / 90;
        players.push({
          p,
          s,
          e,
          minutes,
          lambda,
          goalProb: Math.min(0.6, p.rate.conv * goalBase),
          activeAtEnd: s != null && e >= end && minutes > 0,
          edited: offAt != null ? 'off' : onAt != null ? 'on' : null,
        });
      }
      const activeSum = players.filter((x) => x.activeAtEnd).reduce((a, x) => a + x.lambda, 0);
      if (lost > 0 && activeSum > 0) for (const x of players) if (x.activeAtEnd) x.lambda += (lost * x.lambda) / activeSum;
      plan.teams.push({ t, o, isHome, mult, stateMod, redMod, players, lost });
    }
    return plan;
  }

  function simCompute() {
    const d = sim.data;
    if (!d) return;
    if (fittedModel(d)) return simComputeFitted();
    const sc = sim.scenario;
    const plan = simPlan(d, sc, sim.edits || {});
    const y = Math.max(0, Number(sc.threshold) || 0);
    const t0 = performance.now();
    const teamAcc = plan.teams.map((pt) => ({ shots: 0, sot: 0, goals: 0, ge: 0, hist: new Map(), players: pt.players.map(() => ({ shots: 0, sot: 0, goals: 0, g1: 0, c1: 0, c2: 0, c3: 0 })) }));
    const totalHist = new Map();
    let totalGe = 0;
    let totalSum = 0;
    for (let r = 0; r < SIM_RUNS; r++) {
      let total = 0;
      plan.teams.forEach((pt, ti) => {
        const acc = teamAcc[ti];
        let ts = pt.t.shotsSoFar;
        let tsot = pt.t.sotSoFar;
        let tg = pt.t.goals;
        pt.players.forEach((x, pi) => {
          if (x.lambda <= 0) return;
          const k = poisson(x.lambda);
          if (!k) return;
          const sot = binomial(k, x.p.rate.sotRatio);
          const goals = binomial(k, x.goalProb);
          const pa = acc.players[pi];
          pa.shots += k;
          pa.sot += sot;
          pa.goals += goals;
          if (k >= 1) pa.c1++;
          if (k >= 2) pa.c2++;
          if (k >= 3) pa.c3++;
          if (goals >= 1) pa.g1++;
          ts += k;
          tsot += sot;
          tg += goals;
        });
        acc.shots += ts;
        acc.sot += tsot;
        acc.goals += tg;
        if (ts >= y) acc.ge++;
        acc.hist.set(ts, (acc.hist.get(ts) || 0) + 1);
        total += ts;
      });
      totalSum += total;
      if (total >= y) totalGe++;
      totalHist.set(total, (totalHist.get(total) || 0) + 1);
    }
    const N = SIM_RUNS;
    sim.results = {
      ms: performance.now() - t0,
      plan,
      threshold: y,
      teams: plan.teams.map((pt, ti) => {
        const acc = teamAcc[ti];
        return {
          id: pt.t.id,
          name: pt.t.name,
          abbrev: pt.t.abbrev,
          logo: pt.t.logo,
          isHome: pt.isHome,
          mean: acc.shots / N,
          sot: acc.sot / N,
          goals: acc.goals / N,
          pGe: acc.ge / N,
          mult: pt.mult,
          hist: acc.hist,
          players: pt.players.map((x, pi) => {
            const pa = acc.players[pi];
            return { ...x, xShots: pa.shots / N, xSot: pa.sot / N, xGoals: pa.goals / N, p1: pa.c1 / N, p2: pa.c2 / N, p3: pa.c3 / N, pGoal: pa.g1 / N };
          }),
        };
      }),
      total: { mean: totalSum / N, pGe: totalGe / N, hist: totalHist },
    };
  }

  // ---- fitted model (Premier League) ----
  // The server sends the exported coefficients (d.model) and each team's and
  // player's features (t.ts, p.ts); public/teamShare.js turns the scenario into
  // expected shots per player and runs the Monte Carlo so that each team total
  // is NB(mu, k_team) and each player NB(lambda, k_player).
  const fittedModel = (d) => !!(d.model && sim.TS && d.teams.every((t) => t.ts));

  // A player's simulated interval [s, e] within [now, end] (s = null: does not play).
  function simWindow(d, p, ed, now, end) {
    let s = null;
    let e = end;
    const offAt = ed.off[p.id];
    const onAt = ed.on[p.id];
    if (p.onPitch) s = now;
    else if (p.role === 'sub' && !p.subbedIn && onAt != null) s = Math.min(end, Math.max(now, onAt));
    else if (!d.match.lineupsAnnounced && p.role === 'starter' && offAt == null) s = now;
    if (s != null && offAt != null) e = Math.min(end, Math.max(s, offAt));
    const minutes = s == null ? 0 : Math.max(0, e - s);
    return { s: minutes > 0 ? s : null, e, minutes, activeAtEnd: s != null && e >= end && minutes > 0, edited: offAt != null ? 'off' : onAt != null ? 'on' : null };
  }

  function simPlanFitted(d, sc, edits) {
    const TS = sim.TS;
    const pre = d.match.state === 'pre';
    const now = pre ? 0 : d.match.minute;
    const end = now + Math.max(0, Number(sc.remaining) || 0);
    const span = Math.max(0, end - now);
    const [home, away] = [d.teams.find((t) => t.id === d.match.homeId), d.teams.find((t) => t.id === d.match.awayId)];
    const teams = [home, away].filter(Boolean);
    const plan = { now, end, span, teams: [], fitted: true };
    for (const t of teams) {
      const o = teams.find((x) => x.id !== t.id) || t;
      const isHome = t.id === d.match.homeId;
      const mine = isHome ? d.match.score.home : d.match.score.away;
      const theirs = isHome ? d.match.score.away : d.match.score.home;
      const st = sc.scoreState;
      const diff = st === 'level' ? 0 : st === 'home' ? (isHome ? 1 : -1) : st === 'away' ? (isHome ? -1 : 1) : Math.sign(mine - theirs);
      // Man advantage: red cards already shown, then the scenario's card from its minute on.
      const reds = d.match.redCards || [];
      const manAdv0 = Math.max(-1, Math.min(1, reds.filter((r) => r.teamId !== t.id).length - reds.filter((r) => r.teamId === t.id).length));
      const scenarioReds = [];
      if (sc.red !== 'none' && span > 0) {
        const rm = Math.min(end, Math.max(now, Number(sc.redMinute) || now));
        const redTeam = sc.red === 'home' ? d.match.homeId : d.match.awayId;
        scenarioReds.push({ minute: rm, delta: redTeam === t.id ? -1 : 1 });
      }
      const ed = edits[t.id] || { off: {}, on: {} };
      const wins = t.players.map((p) => simWindow(d, p, ed, now, end));
      // Multi-competition model: home advantage does not apply at a neutral venue, and the
      // in-play evidence (shots so far vs the pre-match expectation, team and player) is
      // taken from the live state at the current minute and held for the rest of the run.
      const m = d.model;
      const home = isHome && !(m.home_excludes_neutral && d.match.neutral);
      const inplay = !!m.inplay && now > 0;
      const expected = m.inplay ? TS.expectedShots(m, t.ts.att, o.ts.dfn) : null;
      const sfRatio = inplay ? TS.teamSfRatio(m, t.ts.sf ?? 0, expected, now) : 0;
      const oppSfRatio = inplay ? TS.teamSfRatio(m, o.ts.sf ?? 0, TS.expectedShots(m, o.ts.att, t.ts.dfn), now) : 0;
      const psf = (p, w) => (inplay && p.onPitch && w.s === now && p.ts?.onMin != null ? TS.playerSfRatio(m, p.ts.sf ?? 0, p.ts.r90, now - p.ts.onMin, now) : 0);
      const units = t.players.map((p, i) => ({ id: p.id, group: p.ts?.group || 'M', r90: p.ts?.r90 ?? 1, pconv: p.ts?.pconv ?? 0.085, s: wins[i].s, e: wins[i].e, psf: psf(p, wins[i]) }));
      const res = TS.planTeam(m, { now, end, team: { att: t.ts.att, oppDfn: o.ts.dfn, home, sfRatio, oppSfRatio }, diff, manAdv0, reds: scenarioReds, units, tempo: TEMPO[sc.tempo] || 1 });
      const players = t.players.map((p, i) => ({ p, ...wins[i], lambda: res.players[i].lambda, goalProb: res.players[i].q, psf: units[i].psf }));
      plan.teams.push({ t, o, isHome, diff, manAdv0, players, others: res.others, mu: res.mu, expected, sfRatio, inplay });
    }
    return plan;
  }

  function simComputeFitted() {
    const d = sim.data;
    const sc = sim.scenario;
    const plan = simPlanFitted(d, sc, sim.edits || {});
    const y = Math.max(0, Number(sc.threshold) || 0);
    const t0 = performance.now();
    const input = plan.teams.map((pt) => ({
      base: { shots: pt.t.shotsSoFar, sot: pt.t.sotSoFar, goals: pt.t.goals },
      units: [...pt.players.map((x) => ({ lambda: x.lambda, q: x.goalProb, sot: x.p.rate?.sotRatio ?? 0.33 })), { lambda: pt.others.lambda, q: pt.others.q, sot: 0.33 }],
    }));
    const res = sim.TS.simulate(d.model, input, SIM_RUNS);
    const N = SIM_RUNS;
    const atLeast = (hist) => [...hist.entries()].reduce((a, [k, n]) => a + (k >= y ? n : 0), 0) / N;
    sim.results = {
      ms: performance.now() - t0,
      plan,
      threshold: y,
      fitted: true,
      teams: plan.teams.map((pt, ti) => {
        const acc = res.teams[ti];
        return {
          id: pt.t.id,
          name: pt.t.name,
          abbrev: pt.t.abbrev,
          logo: pt.t.logo,
          isHome: pt.isHome,
          mean: acc.shots / N,
          sot: acc.sot / N,
          goals: acc.goals / N,
          pGe: atLeast(acc.hist),
          range: simRange(acc.hist),
          hist: acc.hist,
          players: pt.players.map((x, pi) => {
            const pa = acc.units[pi];
            return { ...x, xShots: pa.shots / N, xSot: pa.sot / N, xGoals: pa.goals / N, p1: pa.c1 / N, p2: pa.c2 / N, p3: pa.c3 / N, pGoal: pa.g1 / N };
          }),
        };
      }),
      total: { mean: res.total.sum / N, pGe: atLeast(res.total.hist), hist: res.total.hist, range: simRange(res.total.hist) },
    };
  }

  // Central 80% range (10th to 90th percentile) of a simulated count histogram.
  function simRange(hist) {
    const e = [...hist.entries()].sort((a, b) => a[0] - b[0]);
    const n = e.reduce((a, x) => a + x[1], 0);
    let c = 0;
    let lo = null;
    let hi = null;
    for (const [k, m] of e) {
      c += m;
      if (lo == null && c >= 0.1 * n) lo = k;
      if (hi == null && c >= 0.9 * n) hi = k;
    }
    return [lo, hi];
  }

  // ---- rendering ----
  const pct = (x) => `${Math.round(x * 100)}%`;
  const shortName = (p) => p.shortName || String(p.name || '').replace(/^(\S)\S+\s+(?=\S)/, '$1. ');
  const num1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
  const simSel = (field, value, opts) =>
    `<select class="sel" data-sim-field="${field}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

  function simInner(g) {
    const head = `<h3>Shot simulator <span class="right">player-level Monte Carlo · ${SIM_RUNS.toLocaleString()} runs</span></h3>`;
    if (sim.error) return `${head}<p class="error">Could not build the model: ${esc(sim.error)}</p><button class="btn" data-sim="load">Retry</button>`;
    if (!sim.data) {
      if (sim.loading)
        return g.league?.slug === 'eng.1'
          ? `${head}<p class="note" style="margin:0">Building the model: last ten matches per club, every player's season numbers, opponent strength…</p>`
          : `${head}<p class="note" style="margin:0">Building the model: each club's recent league and European matches, their opponents' strength at the time, every player's history… The first match of a competition can take 10–20 seconds; later ones are quicker.</p>`;
      return `${head}<p class="note" style="margin:0 0 10px">Simulate how many shots each side and each player will take, under a thesis you set: score state, red cards, tempo, and your own substitutions. Rates come from each player's recent form and season stats, adjusted for the opposition.</p><button class="btn primary" data-sim="load">Load simulator</button>`;
    }
    const d = sim.data;
    const sc = sim.scenario;
    const r = sim.results;
    const home = d.teams.find((t) => t.id === d.match.homeId);
    const away = d.teams.find((t) => t.id === d.match.awayId);
    const live = d.match.state === 'in';
    const post = d.match.state === 'post';
    const stateLine = post
      ? 'Match finished: the simulation below starts from the final state, so set minutes remaining to replay a hypothetical.'
      : live
        ? `Live: minute ${d.match.minute}${d.match.clock ? ` (${esc(d.match.clock)})` : ''}, ${esc(home.abbrev)} ${d.match.score.home}–${d.match.score.away} ${esc(away.abbrev)}, shots so far ${home.shotsSoFar}–${away.shotsSoFar}. Totals below include shots already taken.`
        : d.match.lineupsAnnounced
          ? 'Pre-match: confirmed lineups.'
          : 'Pre-match: lineups not announced yet, so each side starts from its most recent starting XI. Edit them below.';

    const controls = `<div class="sim-controls">
      <label><span>Score state</span>${simSel('scoreState', sc.scoreState, [['current', 'As it stands'], ['level', 'Level'], ['home', `${home.abbrev} leads`], ['away', `${away.abbrev} leads`]])}</label>
      <label><span>Red card</span>${simSel('red', sc.red, [['none', 'None'], ['home', `${home.abbrev} player`], ['away', `${away.abbrev} player`]])}</label>
      <label><span>Red at min</span><input class="inp" type="number" min="0" max="120" data-sim-field="redMinute" value="${esc(sc.redMinute)}" ${sc.red === 'none' ? 'disabled' : ''}></label>
      <label><span>Tempo</span>${simSel('tempo', sc.tempo, [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']])}</label>
      <label><span>Minutes left</span><input class="inp" type="number" min="0" max="120" data-sim-field="remaining" value="${esc(sc.remaining)}"></label>
      <label><span>Threshold (y shots)</span><input class="inp" type="number" min="0" max="60" data-sim-field="threshold" value="${esc(sc.threshold)}"></label>
      <label><span>Sub minute</span><input class="inp" type="number" min="0" max="120" data-sim-field="subMinute" value="${esc(sc.subMinute)}"></label>
      <button class="btn" data-sim="reset" title="Clear lineup edits and scenario">Reset</button>
    </div>`;

    const range = (x) => (r?.fitted && x.range ? ` · 80% range ${x.range[0]}–${x.range[1]}` : '');
    const tiles = r
      ? `<div class="sim-tiles">
        ${[r.teams[0], r.teams[1]].filter(Boolean).map((t) => `<div class="tile-stat"><div class="k">${img(t.logo, t.name)} ${esc(t.abbrev)} ≥ ${r.threshold} shots</div><div class="v">${pct(t.pGe)}</div><div class="s">exp ${num1(t.mean)} shots${range(t)} · ${num1(t.sot)} on target · ${num1(t.goals)} goals</div></div>`).join('')}
        <div class="tile-stat total"><div class="k">Total ≥ ${r.threshold} shots</div><div class="v">${pct(r.total.pGe)}</div><div class="s">exp ${num1(r.total.mean)} shots in total${range(r.total)}</div></div>
      </div>`
      : '';

    const hist = r ? simHistogram(r.total.hist, r.threshold, r.total.mean) : '';

    const lineupCols = [home, away].map((t) => simLineupCol(t, r)).join('');

    const table = r ? simPlayerTable(r, sc) : '';

    const fm = r?.fitted ? d.model : null;
    const bt = fm?.backtest;
    const modelLine = fm?.pooled
      ? simPooledModelLine(fm)
      : fm
      ? `<p class="sim-model" title="${esc(`Model ${fm.model}, fitted ${String(fm.fitted).slice(0, 10)} on ${fm.seasons_fitted.join(', ')}. Sealed ${bt.season} test, ${bt.matches} matches, vs the original model: team shots NLL ${bt.model.team_nll} vs ${bt.previous_live_model.team_nll}, bias ${bt.model.bias} vs ${bt.previous_live_model.bias}, P(1+ shot) log-loss ${bt.model.p1_logloss} vs ${bt.previous_live_model.p1_logloss}, P(goal) log-loss ${bt.model.pgoal_logloss} vs ${bt.previous_live_model.pgoal_logloss}.`)}">Fitted model · backtested on ${esc(bt.season)}: 80% ranges hit ${pct(bt.model.cover80)} <span>(original model ${pct(bt.previous_live_model.cover80)})</span></p>`
      : `<p class="sim-model">Original model · hand-set rates; the fitted model could not be built for this match</p>`;
    const foot = fm?.pooled
      ? simPooledFoot(d, fm, r, home, away)
      : fm
      ? `<p class="note sim-foot">How it works: fitted on ${fm.fit_matches} Premier League matches (${esc(fm.seasons_fitted.join(', '))}). Each side's shots for the rest of the match follow a negative binomial whose mean comes from its recency-weighted shots per league match (last ${fm.recency.team_n}: ${home.abbrev} ${num1(home.ts.att)}, ${away.abbrev} ${num1(away.ts.att)}), the opponent's shots allowed (${home.abbrev} ${num1(home.ts.dfn)}, ${away.abbrev} ${num1(away.ts.dfn)}), home advantage, score state, man advantage and the minutes left; league average ${num1(fm.league_ref.rate)}. Each player's expected shots are a share of that mean, set by his recency-weighted shots per 90 (last ${fm.recency.player_n} league appearances, shrunk to his position) against the team-mates on the pitch and by his position; the rest falls to later substitutes. Goals use a fitted conversion per shot; on target uses each player's recent ratio. Tempo scales every rate. History: each club's league matches this season and last (${fm.historyMatches} matches); cup games are left out, as in the fit, and a player's matches for a previous club count only if that club is one of these two. Built in ${d.meta.ms} ms (${d.meta.matchesFetched} matches fetched, ${d.meta.cacheHits} cached), simulated in ${Math.round(r.ms)} ms.</p>`
      : `<p class="note sim-foot">How it works: each player's shots per 90 blend recent form (last ${d.meta.historyMatches} club matches, exponentially weighted, scaled by the defenses faced) with league-season totals, shrunk toward a position prior when the sample is small. The team rate is the sum of the players on the pitch × opposition leakiness (${home.abbrev} ${home.leakiness}, ${away.abbrev} ${away.leakiness}; 1.0 = league average) × home/away × shape × scenario. Goals thin from shots using each player's conversion and the opposing keeper's save rate (${esc(home.keeper?.name || '')} ${pct(home.keeper?.saveRate ?? 0.7)}, ${esc(away.keeper?.name || '')} ${pct(away.keeper?.saveRate ?? 0.7)}). Opposition lineup edits affect the model only through the keeper and shape; defenders are not modeled individually. League avg ${d.league.avgShots} shots per team. Built in ${d.meta.ms} ms (${d.meta.matchesFetched} matches fetched, ${d.meta.cacheHits} cached)${r ? `, simulated in ${Math.round(r.ms)} ms` : ''}.</p>`;

    return `${head}${modelLine}<p class="note" style="margin:0 0 10px">${stateLine}</p>${controls}${tiles}${hist}<div class="sim-lineups">${lineupCols}</div>${table}${foot}`;
  }

  // Multi-competition model (team_share_oppadj): this competition's sealed-test scores.
  function simPooledModelLine(fm) {
    const bt = fm.backtest;
    if (!bt?.model || !bt.previous_live_model) return `<p class="sim-model">Fitted model (all seven competitions)</p>`;
    const title = `Model ${fm.model}: one fit over all seven competitions, fitted ${String(fm.fitted).slice(0, 10)} on ${fm.seasons_fitted.join(', ')}. Sealed ${bt.season} test, ${bt.name}, ${bt.matches} matches, vs the original model: team shots NLL ${bt.model.team_nll} vs ${bt.previous_live_model.team_nll}, bias ${bt.model.bias} vs ${bt.previous_live_model.bias}, P(1+ shot) log-loss ${bt.model.p1_logloss} vs ${bt.previous_live_model.p1_logloss}, P(goal) log-loss ${bt.model.pgoal_logloss} vs ${bt.previous_live_model.pgoal_logloss}.`;
    return `<p class="sim-model" title="${esc(title)}">Fitted model · backtested on ${esc(bt.season)} ${esc(bt.name)}: 80% ranges hit ${pct(bt.model.cover80)} <span>(original model ${pct(bt.previous_live_model.cover80)})</span></p>`;
  }

  function simPooledFoot(d, fm, r, home, away) {
    const lg = fm.backtest?.name || 'this competition';
    const pt = (t) => r.plan.teams.find((x) => x.t.id === t.id);
    const live = r.plan.teams.some((x) => x.inplay);
    const sfText = live ? ` (now: ${home.abbrev} ${home.ts.sf} shots vs ${num1((pt(home).expected * r.plan.now) / fm.inplay.match_minutes)} expected by ${r.plan.now}', ${away.abbrev} ${away.ts.sf} vs ${num1((pt(away).expected * r.plan.now) / fm.inplay.match_minutes)})` : '';
    const neutral = d.match.neutral ? ' (none at this neutral venue)' : '';
    return `<p class="note sim-foot">How it works: one model fitted on ${fm.fit_matches.toLocaleString()} matches of all seven competitions (${esc(fm.seasons_fitted.join(', '))}), with its own shot level for each competition. Each side's shots for the rest of the match follow a negative binomial whose mean comes from its opponent-adjusted shots per match over its last ${fm.recency.team_n} league and European matches (each match's shots scaled by that opponent's strength at the time: ${home.abbrev} ${num1(home.ts.att)}, ${away.abbrev} ${num1(away.ts.att)}), the opponent's opponent-adjusted shots allowed (${home.abbrev} ${num1(home.ts.dfn)}, ${away.abbrev} ${num1(away.ts.dfn)}), home advantage${neutral}, score state, man advantage, the minutes left and, once the match is under way, each side's shots so far against its pre-match expectation${sfText}; ${esc(lg)} average ${num1(fm.league_ref.rate)}. Each player's expected shots are a share of that mean, set by his recency-weighted shots per 90 (last ${fm.recency.player_n} appearances in these competitions, shrunk to his position) against the team-mates on the pitch, by his position and, in play, by his own shots so far against expectation; the rest falls to later substitutes. Goals use a fitted conversion per shot; on target uses each player's recent ratio. Tempo scales every rate. History: ${d.model.historyMatches} matches (both clubs' recent matches in all seven competitions, and each recent opponent's matches before it met them); competition rates are fixed at the model's export, and a player's appearances for a previous club count when that club's matches were fetched. Built in ${d.meta.ms} ms (${d.meta.matchesFetched} matches fetched, ${d.meta.cacheHits} cached), simulated in ${Math.round(r.ms)} ms.</p>`;
  }

  function simHistogram(histMap, y, mean) {
    const entries = [...histMap.entries()].sort((a, b) => a[0] - b[0]);
    if (!entries.length) return '';
    const max = Math.max(...entries.map((e) => e[1]));
    const lo = entries[0][0];
    const hi = entries[entries.length - 1][0];
    const bars = [];
    // label every 2nd/5th/10th count so the axis stays readable on narrow screens
    const span = hi - lo;
    const step = span > 40 ? 10 : span > 16 ? 5 : 2;
    for (let k = lo; k <= hi; k++) {
      const n = histMap.get(k) || 0;
      const h = Math.round((n / max) * 100);
      bars.push(`<div class="hbar ${k >= y ? 'ge' : ''}" style="height:${h}%" title="${k} shots: ${pct(n / SIM_RUNS)}">${k % step === 0 ? `<span>${k}</span>` : ''}</div>`);
    }
    return `<div class="sim-hist"><div class="hlabel">Distribution of total shots · mean ${num1(mean)} · shaded = at or above ${y}</div><div class="hbars">${bars.join('')}</div></div>`;
  }

  function simLineupCol(t, r) {
    const rt = r?.teams.find((x) => x.id === t.id);
    const byId = new Map((rt?.players || []).map((x) => [x.p.id, x]));
    const d = sim.data;
    const chip = (p) => {
      const x = byId.get(p.id);
      const on = x && x.minutes > 0;
      const label = `${esc(shortName(p))}<span class="pp">${esc(p.pos || '')}</span>`;
      const rate = `<span class="pr" title="expected shots in the remaining span">${x ? num1(x.xShots) : ''}</span>`;
      if (x?.edited === 'off') return `<button class="pchip off" data-sim="restore:${t.id}:${p.id}" title="Taken off at ${x.e}'. Click to restore">${label}<span class="pm">off ${x.e}'</span></button>`;
      if (x?.edited === 'on') return `<button class="pchip on" data-sim="restore:${t.id}:${p.id}" title="Brought on at ${x.s}'. Click to undo">${label}<span class="pm">on ${x.s}'</span>${rate}</button>`;
      if (on) return `<button class="pchip" data-sim="off:${t.id}:${p.id}" title="Click to take off at the sub minute">${label}${rate}</button>`;
      if (p.subbedOut || p.redMin != null) return `<span class="pchip gone" title="${p.redMin != null ? 'Sent off' : 'Substituted'}">${label}<span class="pm">${p.redMin != null ? `red ${p.redMin}'` : `off ${p.subOutMin ?? ''}'`}</span></span>`;
      return `<button class="pchip bench" data-sim="on:${t.id}:${p.id}" title="Click to bring on at the sub minute">+ ${label}</button>`;
    };
    const onPitch = t.players.filter((p) => byId.get(p.id)?.minutes > 0 || byId.get(p.id)?.edited === 'off');
    const bench = t.players.filter((p) => !onPitch.includes(p) && !(p.subbedOut || p.redMin != null));
    const gone = t.players.filter((p) => !onPitch.includes(p) && (p.subbedOut || p.redMin != null));
    const src = t.lineupSource ? `<span class="right">last XI vs ${esc(t.lineupSource.opponent || '')}</span>` : t.formation ? `<span class="right">${esc(t.formation)}</span>` : '';
    return `<div class="sim-team"><h4>${img(t.logo, t.name)} ${esc(t.name)}${src}</h4>
      <div class="chips-wrap">${onPitch.map(chip).join('')}</div>
      ${bench.length ? `<div class="subhead">Bench</div><div class="chips-wrap">${bench.map(chip).join('')}</div>` : ''}
      ${gone.length ? `<div class="chips-wrap gone-wrap">${gone.map(chip).join('')}</div>` : ''}
    </div>`;
  }

  function simPlayerTable(r, sc) {
    let rows = r.teams.flatMap((t) => t.players.filter((x) => x.minutes > 0).map((x) => ({ ...x, team: t })));
    if (sc.playerTeam !== 'all') rows = rows.filter((x) => x.team.id === sc.playerTeam);
    rows.sort((a, b) => b.xShots - a.xShots);
    const limit = sc.showAll ? rows.length : 12;
    const formTag = (fi) => (fi >= 1.25 ? '<span class="fi hot" title="Recent form above season rate">hot</span>' : fi <= 0.75 ? '<span class="fi cold" title="Recent form below season rate">cold</span>' : '');
    const body = rows
      .slice(0, limit)
      .map(
        (x) => `<tr><td class="pname">${esc(shortName(x.p))}<span class="pos">${esc(x.p.pos || '')}</span>${formTag(x.p.rate.formIndex)}</td><td class="pos">${esc(x.team.abbrev)}</td><td>${x.minutes}'</td>${
          r.fitted && x.p.ts
            ? `<td title="shots per 90, recency-weighted over ${x.p.ts.apps} ${sim.data.model?.pooled ? 'appearances in league and European games' : 'league appearances'} (${x.p.ts.minutes} min, ${x.p.ts.shots} shots), shrunk to the ${esc(x.p.ts.group)} average${x.psf ? `; ${x.p.ts.sf} shot${x.p.ts.sf === 1 ? '' : 's'} so far in this match` : ''}">${num1(x.p.ts.r90)}</td>`
            : `<td title="rate per 90: form ${x.p.rate.components.form90 ?? '–'} · season ${x.p.rate.components.season90 ?? '–'} · prior ${x.p.rate.components.prior}">${num1(x.p.rate.shots)}</td>`
        }<td class="hi">${num1(x.xShots)}</td><td>${pct(x.p1)}</td><td>${pct(x.p2)}</td><td>${pct(x.p3)}</td><td>${num1(x.xSot)}</td><td>${pct(x.pGoal)}</td></tr>`,
      )
      .join('');
    const teamOpts = [['all', 'Both teams'], ...r.teams.map((t) => [t.id, t.abbrev])];
    return `<div class="sim-table"><div class="subhead" style="display:flex;align-items:center;gap:10px">Players <span style="font-weight:400;text-transform:none;letter-spacing:0">${simSel('playerTeam', sc.playerTeam, teamOpts)}</span></div>
      <div class="scroll"><table class="box"><thead><tr><th>Player</th><th>Team</th><th title="minutes simulated">Min</th><th title="shots per 90 (model rate)">/90</th><th title="expected shots in the span">xSh</th><th>≥1</th><th>≥2</th><th>≥3</th><th title="expected shots on target">xSOT</th><th title="probability of at least one goal">Goal</th></tr></thead><tbody>${body}</tbody></table></div>
      ${rows.length > 12 ? `<button class="btn small" data-sim="toggleAll">${sc.showAll ? 'Show top 12' : `Show all ${rows.length}`}</button>` : ''}</div>`;
  }

  function simAction(action, g) {
    const [kind, teamId, pid] = action.split(':');
    if (kind === 'load') return loadSim(g);
    if (!sim.data) return;
    const sc = sim.scenario;
    if (kind === 'reset') {
      sim.scenario = simDefaultScenario(sim.data);
      sim.thresholdTouched = false;
      sim.remainingAuto = true;
      sim.edits = {};
    } else if (kind === 'toggleAll') {
      sc.showAll = !sc.showAll;
    } else if (kind === 'off' || kind === 'on' || kind === 'restore') {
      const ed = (sim.edits[teamId] = sim.edits[teamId] || { off: {}, on: {} });
      const m = Math.max(0, Number(sc.subMinute) || 0);
      if (kind === 'off') ed.off[pid] = m;
      if (kind === 'on') ed.on[pid] = m;
      if (kind === 'restore') {
        delete ed.off[pid];
        delete ed.on[pid];
      }
    }
    simCompute();
    simRender(g);
  }

  function simField(field, value, g) {
    if (!sim.scenario) return;
    const sc = sim.scenario;
    if (field === 'remaining') sim.remainingAuto = false;
    if (field === 'threshold') sim.thresholdTouched = true;
    sc[field] = ['redMinute', 'remaining', 'threshold', 'subMinute'].includes(field) ? Number(value) : value;
    simCompute();
    simRender(g);
    if (field !== 'subMinute') {
      const again = document.querySelector(`#sim-panel [data-sim-field="${field}"]`);
      if (again && again.tagName === 'INPUT') again.focus();
    }
  }

  el.modalBody.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sim]');
    if (!b) return;
    const g = state.games.get(state.modalId || sim.gameId);
    if (g) simAction(b.dataset.sim, g);
  });
  el.modalBody.addEventListener('change', (e) => {
    const f = e.target.closest('[data-sim-field]');
    if (!f) return;
    const g = state.games.get(state.modalId || sim.gameId);
    if (g) simField(f.dataset.simField, f.value, g);
  });

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

  function depthPlayer(p, starter) {
    if (!p) return '<td class="dc-empty">–</td>';
    const inj = p.injury ? ` <span class="st ${statusClass(p.injury.status)}" title="${esc(p.injury.detail || '')}">${esc(p.injury.status.slice(0, 1))}</span>` : '';
    const short = esc(p.short || p.name);
    const name = starter ? `<span class="dc-full">${esc(p.name)}</span><span class="dc-short">${short}</span>` : short;
    return `<td class="${starter ? 'dc-starter' : 'dc-backup'}" title="${esc(p.name)}${p.injury ? ` – ${esc(p.injury.status)}` : ''}"><div class="dc-cell"><span class="dc-n">${name}</span>${inj}</div></td>`;
  }

  function depthTable(rows) {
    const body = rows
      .map((r) => `<tr><th title="${esc(r.name || '')}">${esc(r.pos)}</th>${[0, 1, 2].map((i) => depthPlayer(r.players[i], i === 0)).join('')}</tr>`)
      .join('');
    return `<table class="depth"><thead><tr><th></th><th>Starter</th><th>2nd</th><th>3rd</th></tr></thead><tbody>${body}</tbody></table>`;
  }

  function depthPanel(team, dc) {
    const head = `<h3>${img(team.logo, team.name)} ${esc(team.name)} <span class="right">depth chart</span></h3>`;
    if (!dc || dc.error || (!dc.offense?.length && !dc.defense?.length)) {
      return `<div class="panel">${head}<p class="note" style="margin:0">${esc(dc?.error ? `Depth chart unavailable: ${dc.error}` : 'No depth chart published.')}</p></div>`;
    }
    const sub = (title, f) => `<div class="subhead">${esc(title)}${f ? ` <span class="dc-form">${esc(f)}</span>` : ''}</div>`;
    return `<div class="panel">${head}
      ${dc.offense.length ? sub('Offense', dc.formation) + depthTable(dc.offense) : ''}
      ${dc.defense.length ? sub('Defense', dc.defenseFormation) + depthTable(dc.defense) : ''}
      ${dc.special.length ? `<details><summary>Special teams</summary>${depthTable(dc.special)}</details>` : ''}
      <p class="note">Projected starters from ESPN's depth chart; actual starters can change at kickoff.</p></div>`;
  }

  function detailNfl(g, d) {
    const teams = [g.away, g.home];
    const parts = [];
    const meta = d.rankings?.meta;
    if (g.status.state !== 'pre') {
      parts.push(comparePanel('Team stats', orderTeams(d.teamStats, g.away.id), NFL_TEAM_ROWS));
      for (const t of teams) parts.push(nflBoxPanel(t, d.players));
    }
    if (window.KalshiMarket) parts.push(window.KalshiMarket.panel(g)); // public/kalshi.js
    for (const t of teams) parts.push(depthPanel(t, d.depth?.find((x) => String(x.teamId) === String(t.id))));
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
    if (p.ejected) return `<li class="${opts.sub ? 'sub' : ''} off"><span class="num">${esc(p.jersey || '')}</span><span class="pname">${esc(p.name)} <span class="pos">${esc(p.pos || '')}</span><span class="flag sentoff" title="Ejected from the game">ejected</span></span><span>${stat}</span></li>`;
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
