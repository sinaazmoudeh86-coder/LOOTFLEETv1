/* =============================================================================
   leaderboard.js — Loot Fleet
   REAL cross-account leaderboards. Every signed-in operator publishes a public
   row (name/power/level/zone/kills/fleet) via CLOUD.lbUpsert → the Supabase
   `leaderboard` table; the board reads the top N back with CLOUD.lbTop and ranks
   you against them live. No simulated rivals — the board reflects actual players.
   ============================================================================= */
(function () {
  'use strict';
  const C = window.CONFIG, ITEMS = window.ITEMS;

  // ---- REAL cloud entries (all known accounts), blended with the simulated
  //      roster so the board is never empty. Fetched from window.CLOUD.lbTop. ----
  let _real = null, _realT = 0, _realInflight = false;
  function myId(){ try { return (window.AUTH && AUTH.session && AUTH.session()) ? AUTH.session().id : null; } catch (e) { return null; } }
  function mapReal(r){ return { name: r.name || 'Operator', level: r.level || 1, zone: r.zone || 1, power: r.power || 0, kills: r.kills || 0, _fleet: Array.isArray(r.fleet) ? r.fleet : null, _uid: r.user_id, isReal: true }; }
  function ensureReal(cb){
    if (!(window.CLOUD && window.CLOUD.enabled && window.CLOUD.lbTop)) return;
    if (_realInflight || Date.now() - _realT < 8000) return;
    _realInflight = true; _realT = Date.now();
    window.CLOUD.lbTop(100).then((rows) => { _realInflight = false; if (rows) { _real = rows.map(mapReal); if (cb) cb(); } }).catch(() => { _realInflight = false; });
  }
  function realOthers(){ const id = myId(); return (_real || []).filter((p) => !id || p._uid !== id); }
  // Look up a REAL account's public row by commander name — used by My Galaxy
  // to reconstruct a tile owner's actual fleet when their claim carries no
  // defense snapshot. Warms the cache on a miss.
  function byName(nm){
    if (!nm) return null;
    if (!_real || Date.now() - _realT > 60000) { try { ensureReal(); } catch (e) {} }
    const n = String(nm).toLowerCase();
    return (_real || []).find((p) => (p.name || '').toLowerCase() === n) || null;
  }

  // The game's "launch" Monday. weeksSince(launch)+1 = current heat number.
  const LAUNCH = Date.UTC(2026, 0, 5);              // Mon Jan 5 2026
  const WEEK_MS = 7 * 24 * 3600 * 1000;
  const EPOCH = Date.UTC(2024, 0, 1);               // matches GAME.currentWeek()

  function heatNumber(startWeekIndex) {
    const startMs = EPOCH + startWeekIndex * WEEK_MS;
    return Math.max(1, Math.floor((startMs - LAUNCH) / WEEK_MS) + 1);
  }
  function mondayOfHeat(heatNum) {
    return new Date(LAUNCH + (heatNum - 1) * WEEK_MS);
  }
  function weekLabel(heatNum) {
    const d = mondayOfHeat(heatNum);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // seeded RNG
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  const FIRST = ['Ghost','Reaper','Viper','Hawk','Wolf','Raven','Steel','Ace','Frost','Diesel','Mako','Echo','Razor','Bolt','Talon','Iron','Nyx','Onyx','Saint','Krieg','Havoc','Slate','Comet','Bruja','Zero','Vandal','Cobra','Karma','Lynx','Phantom','Specter','Rogue','Maverick','Tundra','Ember'];
  const LAST = ['77','_TX','Actual','X','99','HD','OG','_Prime','2A','_GG','Mag','FPS','_Six','Tac','_Recon','01','_K','Bravo','Delta','_Nine','Sr','_Vet','420','_Pro','Mk2'];
  function nameFor(r) { return FIRST[(r()*FIRST.length)|0] + (r() < 0.6 ? LAST[(r()*LAST.length)|0] : ''); }

  function rarityForRank(rank, total) {
    const t = 1 - rank / total; // 1 = top
    if (t > 0.97) return 9 + ((Math.random()*2)|0);
    if (t > 0.9) return 7 + ((Math.random()*2)|0);
    if (t > 0.75) return 5 + ((Math.random()*2)|0);
    if (t > 0.5) return 3 + ((Math.random()*2)|0);
    if (t > 0.25) return 2 + ((Math.random()*2)|0);
    return ((Math.random()*3)|0);
  }

  // Build a roster. `strength` scales how deep/high-level the cohort is.
  function buildRoster(seed, count, strength) {
    const r = rng(seed);
    const list = [];
    for (let i = 0; i < count; i++) {
      const zone = Math.max(1, Math.round(strength * (0.4 + r() * 1.1)));
      const level = Math.max(1, Math.round(zone * (1.6 + r()) + r() * 8));
      const power = Math.round(C.dungeonScale(zone) * (40 + r() * 80) + level * 6);
      const kills = Math.round(power * (3 + r() * 9));
      list.push({ name: nameFor(r), zone, level, power, kills, _loadout: null });
    }
    return list;
  }

  // Deterministic rival FLEET — higher-ranked pilots field bigger, fancier
  // fleets (1–5 unique hulls, flagship first). Seeded by name; stable per heat.
  const FLEET_POOL = ['frigate', 'interceptor', 'cruiser', 'heavycruiser', 'destroyer', 'battleship', 'dreadnought', 'carrier', 'aegis', 'supercarrier', 'titan', 'mothership'];
  function fleetFor(p, rank, total) {
    if (p._fleet) return p._fleet;
    let h = 0; const nm = p.name || '?';
    for (let i = 0; i < nm.length; i++) h = (h * 31 + nm.charCodeAt(i)) >>> 0;
    const r = () => { h = (h * 1103515245 + 12345) >>> 0; return (h >>> 8) / 16777216; };
    const k = 1 - (rank - 1) / Math.max(1, (total || 20) - 1);   // 1 = top of board
    const ships = 1 + Math.min(4, Math.floor(k * 4 + r() * 1.2));
    const top = Math.max(2, Math.round(3 + k * (FLEET_POOL.length - 4)));
    const picks = [];
    let guard = 0;
    while (picks.length < ships && guard++ < 40) {
      const idx = Math.max(0, Math.min(FLEET_POOL.length - 1, top - ((r() * 5) | 0)));
      if (!picks.includes(FLEET_POOL[idx])) picks.push(FLEET_POOL[idx]);
    }
    p._fleet = picks;
    return picks;
  }

  function loadoutFor(p, rank, total) {
    if (p._loadout) return p._loadout;
    const eq = { bow: null, arrows: null, armor: null, boots: null, gloves: null, amulet: null };
    let guard = 0, filled = 0;
    while (filled < 6 && guard < 120) {
      guard++;
      const it = ITEMS.generate(p.zone, rarityForRank(rank || total, total || 1));
      if (!eq[it.slot]) { eq[it.slot] = it; filled++; }
    }
    p._loadout = eq;
    return eq;
  }

  function score(p) { return p.zone * 100000 + p.level * 50 + p.power; }
  function rankBoard(list) {
    list.sort((a, b) => score(b) - score(a));
    list.forEach((p, i) => { p.rank = i + 1; });
    return list;
  }
  // All-Time is a PURE POWER ladder — rank strictly by power, highest first.
  function rankByPower(list) {
    list.sort((a, b) => (b.power || 0) - (a.power || 0));
    list.forEach((p, i) => { p.rank = i + 1; });
    return list;
  }
  // Deterministic filler that sits in a descending power band *below* the
  // weakest real fleet — keeps the board from looking empty without ever
  // burying or out-powering an actual account. Stable across refreshes.
  function fillerRoster(count, refPower, refZone) {
    const r = rng(424242);
    const list = [];
    let pw = Math.max(60, refPower || 100);
    for (let i = 0; i < count; i++) {
      pw = Math.max(40, Math.round(pw * (0.80 + r() * 0.12)));   // strictly decreasing
      const zone = Math.max(1, Math.round((refZone || 5) * (0.45 + r() * 0.55)));
      const level = Math.max(1, Math.round(zone * (1.4 + r()) + r() * 6));
      const kills = Math.round(pw * (3 + r() * 8));
      list.push({ name: nameFor(r), zone, level, power: pw, kills, _loadout: null });
    }
    return list;
  }

  let _heatCache = {}, _allCache = null;

  function meEntry(GAME) {
    const s = GAME.state, st = GAME.getStats();
    return { name: 'You', isMe: true, zone: s.highestDungeonReached, level: s.level,
      power: GAME.score ? GAME.score() : Math.round((st ? st.theoryDps : 0) + (st ? st.maxHp : 0) * 0.5), kills: s.totalKills,
      fleet: [s.ship].concat(GAME.fleetShips ? GAME.fleetShips().map((x) => x.key) : []),
      _loadout: s.equipped };
  }

  function heatBoard(GAME) {
    // REAL live ladder — every signed-in operator (from the cloud leaderboard)
    // plus you, ranked by fleet progression. No simulated rivals: the board
    // reflects actual players, so it grows as real operators sign in and play.
    const heat = heatNumber(GAME.state.startWeek || GAME.currentWeek());
    const board = realOthers().map((p) => ({ ...p }));
    board.push(meEntry(GAME));
    rankBoard(board);
    return { heat, label: weekLabel(heat), board, real: board.length - 1 };
  }
  function allTimeBoard(GAME) {
    // REAL all-time POWER ladder: every known operator (all cloud accounts) plus
    // you, ranked strictly by power, highest first. Real players only.
    const me = meEntry(GAME);
    const board = realOthers().map((p) => ({ ...p }));
    board.push(me);
    rankByPower(board);                     // real fleets → true power ranks
    return { board, real: board.length - 1 };
  }

  window.LEADERBOARD = { heatBoard, allTimeBoard, loadoutFor, fleetFor, heatNumber, weekLabel, ensureReal, byName };
})();
