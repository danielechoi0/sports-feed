/* Game Day dashboard – vanilla JS frontend */
(() => {
  'use strict';

  // ---------- state ----------
  const hashDate = /^#(\d{8})$/.exec(location.hash)?.[1];
  const state = {
    date: hashDate || ymd(new Date()),
    data: null,
    games: new Map(),
    hiddenLeagues: new Set(load('hiddenLeagues', [])),
    timer: null,
    seq: 0,
    live: null, // EventSource
    liveConnected: false,
    modalId: null,
    modalTimer: null,
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const el = {
    daylabel: $('#daylabel'),
    updated: $('#updated'),
    banner: $('#banner'),
    datepick: $('#datepick'),
    filters: $('#league-filters'),
    modal: $('#modal'),
    modalBody: $('#modal-body'),
    sections: {
      nfl: $('#sec-nfl'),
      nba: $('#sec-nba'),
      soccer: $('#sec-soccer'),
    },
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

  function img(src, alt, cls = '') {
    return src
      ? `<img src="${esc(src)}" alt="${esc(alt || '')}" loading="lazy" class="${cls}" onerror="this.style.visibility='hidden'">`
      : `<span class="${cls}" style="display:inline-block;width:30px;height:30px"></span>`;
  }

  // ---------- weather icons ----------
  const ICON = {
    sun: '<circle cx="12" cy="12" r="4.2" fill="#f59e0b"/><g stroke="#f59e0b" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></g>',
    'cloud-sun': '<circle cx="9" cy="9" r="3.4" fill="#f59e0b"/><g stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round"><path d="M9 2.8v1.6M2.8 9h1.6M4.6 4.6l1.1 1.1M13.4 4.6l-1.1 1.1"/></g><path d="M8.5 20h9a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6-1.3A4.2 4.2 0 0 0 8.5 20z" fill="#9ca3af"/>',
    cloud: '<path d="M7 19h10.5a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6-1.4A4.7 4.7 0 0 0 7 19z" fill="#9ca3af"/>',
    fog: '<path d="M7 15h10.5a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6-1.4A4.7 4.7 0 0 0 7 15z" fill="#9ca3af"/><g stroke="#9ca3af" stroke-width="1.8" stroke-linecap="round"><path d="M5 18h14M7 21h10"/></g>',
    drizzle: '<path d="M7 15h10.5a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6-1.4A4.7 4.7 0 0 0 7 15z" fill="#9ca3af"/><g stroke="#60a5fa" stroke-width="1.8" stroke-linecap="round"><path d="M9 18v2M13 18v2M17 18v2"/></g>',
    rain: '<path d="M7 14h10.5a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6-1.4A4.7 4.7 0 0 0 7 14z" fill="#9ca3af"/><g stroke="#3b82f6" stroke-width="1.8" stroke-linecap="round"><path d="M8 17l-1 4M12 17l-1 4M16 17l-1 4"/></g>',
    snow: '<path d="M7 14h10.5a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6-1.4A4.7 4.7 0 0 0 7 14z" fill="#9ca3af"/><g fill="#93c5fd"><circle cx="8.5" cy="18" r="1.3"/><circle cx="12.5" cy="20.5" r="1.3"/><circle cx="16.5" cy="18" r="1.3"/></g>',
    storm: '<path d="M7 14h10.5a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6-1.4A4.7 4.7 0 0 0 7 14z" fill="#6b7280"/><path d="M13 13l-3 5h2.5l-1 4 3.5-5.5H12.5z" fill="#fbbf24"/>',
    thermo: '<path d="M10 4a2 2 0 0 1 4 0v9.3a4 4 0 1 1-4 0z" fill="none" stroke="#9ca3af" stroke-width="1.8"/><circle cx="12" cy="17" r="2" fill="#ef4444"/>',
    indoor: '<path d="M4 11l8-6 8 6v9H4z" fill="none" stroke="#9ca3af" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 20v-5h4v5" fill="none" stroke="#9ca3af" stroke-width="1.8"/>',
    wind: '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 8h11a2.5 2.5 0 1 0-2.5-2.5M3 12h15a2.5 2.5 0 1 1-2.5 2.5M3 16h9a2 2 0 1 1-2 2"/></g>',
    drop: '<path d="M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11z" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  };
  const svg = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name] || ICON.thermo}</svg>`;

  function wxChip(w) {
    if (!w) return '';
    if (w.indoor) return `<span class="wx" title="Indoor venue">${svg('indoor')} Indoors</span>`;
    const bits = [deg(w.tempF)];
    if (w.precipProb != null) bits.push(`${w.precipProb}% rain`);
    if (w.windMph != null) bits.push(`${Math.round(w.windMph)} mph`);
    return `<span class="wx" title="${esc(w.label || '')}${w.place ? ' · ' + esc(w.place) : ''}">${svg(w.icon)} ${bits.join(' · ')}</span>`;
  }

  function wxPanel(w) {
    if (!w) return `<aside class="wx-panel">${svg('thermo')}<div class="lbl">No forecast</div></aside>`;
    if (w.indoor) return `<aside class="wx-panel">${svg('indoor')}<div class="lbl">Indoors</div><div class="sub">Dome / roof</div></aside>`;
    const sub = [];
    if (w.windMph != null) sub.push(`${Math.round(w.windMph)} mph wind`);
    if (w.precipProb != null) sub.push(`${w.precipProb}% precip`);
    return `<aside class="wx-panel" title="${esc(w.place || '')}">${svg(w.icon)}<div class="temp">${deg(w.tempF)}</div><div class="lbl">${esc(w.label || '')}</div><div class="sub">${sub.join(' · ')}</div></aside>`;
  }

  // ---------- status ----------
  function statusHtml(g) {
    const s = g.status;
    if (s.state === 'in') {
      // Soccer: show the running clock, except for named breaks (HT, ET, Pens).
      const named = s.shortDetail && !/\d/.test(s.shortDetail) ? s.shortDetail : null;
      const txt = g.sport === 'soccer' ? named || s.clock || s.shortDetail || 'Live' : s.shortDetail || s.detail || 'Live';
      return `<span class="status live">${esc(txt)}</span>`;
    }
    if (s.state === 'post') {
      const txt = g.sport === 'soccer' ? s.shortDetail || 'FT' : s.shortDetail || 'Final';
      return `<span class="status">${esc(txt)}</span>`;
    }
    const txt = s.description && /postponed|cancel|delay|tbd/i.test(s.description) ? s.description : fmtTime(g.date);
    return `<span class="status">${esc(txt)}</span>`;
  }

  function scoreCell(g, team) {
    if (g.status.state === 'pre') return `<div class="score dim">${esc(team.record || '')}</div>`;
    return `<div class="score">${esc(team.score ?? '')}</div>`;
  }

  function teamRow(g, team, opts = {}) {
    const isWinner = g.status.state === 'post' && team.winner;
    const isLoser = g.status.state === 'post' && !team.winner && g.home.score !== g.away.score;
    const tag = `<span class="tag ${team.homeAway === 'home' ? 'home' : ''}">${team.homeAway === 'home' ? 'HOME' : 'AWAY'}</span>`;
    const rec = g.status.state === 'pre' ? '' : `<div class="rec">${esc(team.record || '')}</div>`;
    return `<div class="team ${isWinner ? 'winner' : ''} ${isLoser ? 'loser' : ''}">
      ${img(team.logo, team.name)}
      <div class="tname"><div class="n"><span class="nm">${esc(opts.short ? team.shortName : team.name)}</span>${tag}</div>${rec}</div>
      ${opts.form ? formHtml(team.last5) : '<span></span>'}
      ${scoreCell(g, team)}
    </div>`;
  }

  function formHtml(last5) {
    if (!last5 || !last5.length) return '<div class="form"></div>';
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
    return `<div class="form" title="Last 5, oldest to newest">${chips}</div>`;
  }

  // ---------- cards ----------
  function venueText(g) {
    const v = g.venue;
    return [v.name, v.city].filter(Boolean).join(' · ');
  }

  function cardSoccer(g) {
    return `<article class="card soccer ${g.status.state === 'in' ? 'live' : ''}" data-id="${esc(g.id)}" tabindex="0" role="button">
      <div class="card-top"><span class="chip">${esc(g.league.short || g.league.name)}</span>${g.broadcast ? `<span>${esc(g.broadcast)}</span>` : ''}${statusHtml(g)}</div>
      <div class="teams">${teamRow(g, g.home, { form: true, short: true })}${teamRow(g, g.away, { form: true, short: true })}</div>
      <div class="card-foot"><span class="venue">${esc(venueText(g))}</span>${wxChip(g.weather)}</div>
    </article>`;
  }

  function cardNfl(g) {
    return `<article class="card nfl ${g.status.state === 'in' ? 'live' : ''}" data-id="${esc(g.id)}" tabindex="0" role="button">
      <div class="main">
        <div class="card-top"><span class="chip">NFL</span>${g.broadcast ? `<span>${esc(g.broadcast)}</span>` : ''}${g.odds ? `<span>${esc(g.odds)}</span>` : ''}${statusHtml(g)}</div>
        <div class="teams">${teamRow(g, g.away, { short: true })}${teamRow(g, g.home, { short: true })}</div>
        <div class="card-foot"><span class="venue">${esc(venueText(g))}</span></div>
      </div>
      ${wxPanel(g.weather)}
    </article>`;
  }

  function cardNba(g) {
    return `<article class="card nba ${g.status.state === 'in' ? 'live' : ''}" data-id="${esc(g.id)}" tabindex="0" role="button">
      <div class="card-top"><span class="chip">NBA</span>${g.broadcast ? `<span>${esc(g.broadcast)}</span>` : ''}${g.odds ? `<span>${esc(g.odds)}</span>` : ''}${statusHtml(g)}</div>
      <div class="teams">${teamRow(g, g.away)}${teamRow(g, g.home)}</div>
      <div class="card-foot"><span class="venue">${esc(venueText(g))}</span></div>
    </article>`;
  }

  // ---------- render day ----------
  function renderFilters(leagues, soccer) {
    const counts = new Map();
    for (const g of soccer) counts.set(g.league.slug, (counts.get(g.league.slug) || 0) + 1);
    el.filters.innerHTML = leagues
      .map((l) => {
        const on = !state.hiddenLeagues.has(l.slug);
        const n = counts.get(l.slug) || 0;
        return `<button class="filter ${on ? 'on' : ''}" data-slug="${esc(l.slug)}" aria-pressed="${on}">${esc(l.short || l.name)}${n ? ` · ${n}` : ''}</button>`;
      })
      .join('');
  }

  function renderSection(key, games, renderer, emptyText) {
    const sec = el.sections[key];
    const grid = $('[data-grid]', sec);
    $('[data-count]', sec).textContent = games.length ? `${games.length} game${games.length === 1 ? '' : 's'}` : '';
    grid.innerHTML = games.length ? games.map(renderer).join('') : `<div class="empty">${esc(emptyText)}</div>`;
  }

  function render() {
    const d = state.data;
    if (!d) return;
    state.games.clear();
    for (const g of [...d.nfl, ...d.nba, ...d.soccer]) state.games.set(g.id, g);

    renderSection('nfl', d.nfl, cardNfl, 'No NFL games today.');
    renderSection('nba', d.nba, cardNba, 'No NBA games today.');
    renderFilters(d.leagues, d.soccer);
    const soccer = d.soccer.filter((g) => !state.hiddenLeagues.has(g.league.slug));
    renderSection('soccer', soccer, cardSoccer, d.soccer.length ? 'All leagues filtered out.' : 'No matches in the top-5 leagues, Champions League or Europa League today.');

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
      for (const key of Object.keys(el.sections)) $('[data-grid]', el.sections[key]).innerHTML = '<div class="empty">Loading…</div>';
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
    const d = state.data;
    const anyLive = d && [...d.nfl, ...d.nba, ...d.soccer].some((g) => g.status.state === 'in');
    const isToday = state.date === ymd(new Date());
    if (!isToday && !anyLive) return;
    // With the live stream connected, scores arrive by push; the full reload only
    // picks up new fixtures, weather and form. Without it, poll quickly.
    const ms = state.liveConnected ? 5 * 60_000 : anyLive ? 30_000 : 5 * 60_000;
    state.timer = setTimeout(() => loadDay({ silent: true }), ms);
  }

  // ---------- live updates (Server-Sent Events) ----------
  const liveDot = $('#livedot');
  function setLive(on) {
    state.liveConnected = on;
    liveDot.classList.toggle('hidden', !on);
  }

  function rerenderCard(id) {
    const g = state.games.get(id);
    const old = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    if (!g || !old) return;
    const renderer = g.sport === 'soccer' ? cardSoccer : g.sport === 'nfl' ? cardNfl : cardNba;
    const tmp = document.createElement('div');
    tmp.innerHTML = renderer(g);
    const fresh = tmp.firstElementChild;
    const hadFocus = document.activeElement === old;
    old.replaceWith(fresh);
    if (hadFocus) fresh.focus();
    fresh.classList.add('flash');
    setTimeout(() => fresh.classList.remove('flash'), 1200);
  }

  function applyLive(u) {
    const g = state.games.get(u.id);
    if (!g) return; // not on the day being viewed
    g.status = u.status;
    Object.assign(g.home, u.home);
    Object.assign(g.away, u.away);
    rerenderCard(u.id);
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
      el.modalBody.querySelectorAll('details').forEach((d, i) => { if (open[i]) d.open = true; });
      el.modal.scrollTop = scroll;
    } catch {
      /* keep the old body */
    }
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
    const left = g.sport === 'soccer' ? g.home : g.away;
    const right = g.sport === 'soccer' ? g.away : g.home;
    const score = (t) => (g.status.state === 'pre' ? '' : `<span class="mscore">${esc(t.score ?? '')}</span>`);
    const sep = g.sport === 'soccer' ? 'vs' : '@';
    const sub = [
      statusHtml(g),
      g.venue.name ? `<span>${esc(venueText(g))}</span>` : '',
      g.broadcast ? `<span>${esc(g.broadcast)}</span>` : '',
      g.odds ? `<span>${esc(g.odds)}</span>` : '',
    ]
      .filter(Boolean)
      .join('');
    return `<div class="mhead" id="modal-title">
      <div class="mteam">${img(left.logo, left.name)}<span>${esc(left.name)}</span>${score(left)}</div>
      <span class="vs">${sep}</span>
      <div class="mteam">${score(right)}${img(right.logo, right.name)}<span>${esc(right.name)}</span></div>
    </div><div class="msub">${sub}</div>`;
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
    const cells = showStats
      ? SOCCER_COLS.map((k) => `<td class="${s[k] ? 'hi' : ''}">${s[k] ?? 0}</td>`).join('')
      : '';
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
        return `<tr><td><span class="f f-${esc(res)}">${esc(res)}</span></td><td>${esc(r.score || '')}</td><td class="op">${r.opponentLogo ? img(r.opponentLogo, r.opponent) : ''}<span>${r.isHome ? 'vs' : '@'} ${esc(r.opponent || '')}</span></td><td class="mut">${r.competition ? esc(r.competition) : ''}</td><td class="mut">${r.date ? fmtShort(r.date) : ''}</td></tr>`;
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
      parts.push(`<div class="panel full"><h3>Lineups</h3><p class="note" style="margin:0">Starting XIs are not out yet. ESPN publishes them roughly an hour before kickoff.${d.previousLineups?.length ? ' Below is each side\'s most recent starting XI.' : ''}</p></div>`);
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
          return `<li><span class="clk">${esc(k.clock)}</span><span>${icon}</span><span>${t ? img(t.logo, t.name, '') : ''}${esc(k.player ? `${k.player} · ` : '')}${esc(k.type)}${t ? ` <span class="mut" style="color:var(--muted)">(${esc(t.shortName)})</span>` : ''}</span></li>`;
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
    if (w.indoor) return `<div class="panel"><h3>Weather</h3><div class="wxbig">${svg('indoor')}<div><div class="temp" style="font-size:18px">Indoors</div><div class="det">Dome or closed roof</div></div></div></div>`;
    const det = [w.label, w.windMph != null ? `wind ${Math.round(w.windMph)} mph${w.gustMph ? ` (gusts ${Math.round(w.gustMph)})` : ''}` : null, w.precipProb != null ? `${w.precipProb}% chance of precipitation` : null]
      .filter(Boolean)
      .join(' · ');
    return `<div class="panel"><h3>Weather at kickoff${w.place ? `<span class="right">${esc(w.place)}</span>` : ''}</h3><div class="wxbig">${svg(w.icon)}<div><div class="temp">${deg(w.tempF)}</div><div class="det">${esc(det)}</div></div></div></div>`;
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
      return c.collapsible
        ? `<details><summary>${esc(c.title)}${more}</summary>${table}</details>`
        : `<div class="subhead">${esc(c.title)}</div>${table}`;
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
  el.filters.addEventListener('click', (e) => {
    const b = e.target.closest('[data-slug]');
    if (!b) return;
    const slug = b.dataset.slug;
    if (state.hiddenLeagues.has(slug)) state.hiddenLeagues.delete(slug);
    else state.hiddenLeagues.add(slug);
    save('hiddenLeagues', [...state.hiddenLeagues]);
    render();
  });
  document.getElementById('main').addEventListener('click', (e) => {
    const card = e.target.closest('.card[data-id]');
    if (card) openGame(card.dataset.id);
  });
  document.getElementById('main').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.card[data-id]');
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
    if (el.modal.classList.contains('hidden') && !e.target.closest('input')) {
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
