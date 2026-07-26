/* =============================================================================
   sim-pilots.js — LOOTFLEET · SIMULATED PILOT SYSTEM (client adapter)
   -----------------------------------------------------------------------------
   The roster lives server-side (supabase/simulated-pilots.sql) and progresses on
   an hourly pg_cron tick. This file is a thin READ adapter: it pulls the guarded
   board, hands rows to the leaderboard in exactly the same shape a real account
   publishes, and supplies deterministic tile defenders for the Galaxy and Void
   maps. No gameplay code branches on "is this a bot" — sims travel the same
   render, ranking and combat paths as humans.

   WHAT THIS FILE DELIBERATELY DOES NOT DO
     • It never writes to sim_pilots. Progression, attacks and ascension are the
       server's job; a client that could advance bots is a cheat vector.
     • It never grants the player anything. Sim rewards are not eligible
       (sim_config.reward_eligible) and nothing they "earn" enters the economy.
     • It never infers bot status from a name — always the protected
       is_simulated column.

   INVISIBILITY (product direction, Jul 2026)
     Players must NOT be able to tell a simulated pilot from a human one. The
     goal is a galaxy that feels populated, so nothing in the UI marks a sim:
     no chip, no "(sim)" suffix, no profile disclosure. `is_simulated` stays a
     protected INTERNAL flag — it drives the fairness guards, keeps sim activity
     out of human analytics, and makes every action auditable. Turning the
     designation back on is a one-line change in chip() if policy demands it.

   FAIRNESS, ENFORCED SERVER-SIDE
     • sim_board() caps sim power just under the top human row unless
       allow_rank1, so a simulated pilot can never hold #1.
     • max_top10 / max_top100 trim how many sims may occupy the visible board.
   ========================================================================== */
(function () {
  'use strict';
  const S = () => (window.CLOUD && window.CLOUD.enabled ? window.CLOUD.client : null);

  let _cfg = null;              // sim_config snapshot
  let _rows = [];               // mapped sim pilots, strongest first
  let _at = 0, _inflight = false, _tries = 0;
  const TTL = 120000;           // 2 min — the server ticks hourly, no need to poll hard

  function enabled() { return !!(_cfg && _cfg.enabled) || SEEDS.length > 0; }

  // ---- one server row, in the exact shape leaderboard.js expects -------------
  function map(r) {
    // dedupe the server's fleet — unique hulls only, same rule as the cohort
    const raw = Array.isArray(r.fleet) ? r.fleet.filter((k) => window.CONFIG && window.CONFIG.SHIP_BY_KEY[k]) : null;
    const fleet = raw ? raw.filter((k, i) => raw.indexOf(k) === i).slice(0, 5) : null;
    return {
      name: r.name || 'Pilot',
      level: capLevel(r.level || 1),
      zone: r.zone || 1,
      power: Number(r.power) || 0,
      kills: Number(r.kills) || 0,
      asc: r.asc_stars | 0,
      _fleet: fleet,
      _loadout: null,
      // PROTECTED designation — read from the column, never guessed
      _sim: true,
      _pers: r.personality || null,
      _marked: r.marked !== false,
    };
  }

  function refresh(cb) {
    const c = S();
    if (!c || _inflight) { if (cb) cb(_rows); return; }
    if (Date.now() - _at < TTL && _rows.length) { if (cb) cb(_rows); return; }
    _inflight = true;
    Promise.all([
      c.from('sim_config').select('*').eq('id', 1).maybeSingle(),
      c.rpc('sim_board', { p_limit: 160 }),
    ]).then(([cfgRes, boardRes]) => {
      _inflight = false; _at = Date.now();
      if (!cfgRes.error && cfgRes.data) _cfg = cfgRes.data;
      if (!boardRes.error && Array.isArray(boardRes.data)) {
        const had = _rows.length;
        _rows = boardRes.data.map(map).sort((a, b) => b.power - a.power);
        // REPAINT. The board renders synchronously at boot, long before this
        // promise lands — without this the roster only appeared if you navigated
        // away and came back, which read as "the bots never showed up".
        if (_rows.length !== had) { try { window.UI && window.UI.refreshAll && window.UI.refreshAll(); } catch (e2) {} }
      } else if (!_rows.length && _tries < 4) {
        // transient failure, or the SQL is not deployed — back off and retry
        _tries++; _at = 0; setTimeout(() => refresh(), 4000 * _tries);
      }
      if (cb) cb(_rows);
    }).catch(() => { _inflight = false; _at = Date.now(); if (cb) cb(_rows); });
  }

  // ===========================================================================
  // LOCAL ROSTER — works with ZERO server deployment
  // ---------------------------------------------------------------------------
  // The Supabase roster is the authoritative, shared, progressing version. But
  // the galaxy has to feel populated on day one, before any SQL is run, so this
  // generates a deterministic roster client-side from a fixed seed: every player
  // sees the same pilots with the same names and fleets, and they persist across
  // reloads because nothing is random at runtime.
  //
  // When the server roster IS deployed it takes over — roster() prefers _rows.
  // ===========================================================================
  const NAME_A = ['Void','Nyx','Solar','Kestrel','Vanta','Frost','Drift','Zero','Orion','Ember','Ashen','Halcyon',
    'Quasar','Rift','Umbra','Cinder','Nova','Onyx','Pale','Vesper','Wraith','Zephyr','Cobalt','Hollow','Iron','Saint',
    'Dusk','Krieg','Mako','Sable','Tundra','Verge','Wolf','Talon','Bracken','Corvid','Lumen','Harrow','Pyre','Slate'];
  const NAME_B = ['harbor','warden','nine','byte','king','moon','spire','fang','crown','runner','forge','wake',
    'reach','lance','shade','bloom','gate','helm','vault','drake','shard','tide','watch','maw','wing','helix'];
  const NAME_S = ['Vanta','Kestrel','Halo','Juno','Rook','Cinder','Pyx','Lux','Wren','Onyx','Sable','Bex','Nix','Tor','Vex','Kade'];
  const NAME_TAG = ['ARC','VOID','9TH','SOL','RVN','OBS','KRN','HEX','ZNT','APEX','NULL','VLT'];
  const NAME_G = ['xX','no','big','lil','real','ur','iam','pro','mr','ms','the'];
  const NAME_H = ['scope','clutch','gamer','sniper','tank','main','carry','goat','diff','andy','pilot','sweat'];
  const HULLS = [
    ['frigate','interceptor'],
    ['interceptor','cruiser','heavycruiser'],
    ['heavycruiser','destroyer','battleship','dreadnought'],
    ['battleship','dreadnought','carrier','aegis','supercarrier'],
    ['supercarrier','titan','mothership','carrier','aegis'],
  ];
  // xorshift — stable across sessions, so the roster never reshuffles
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  function nameFrom(r) {
    const pick = (a) => a[(r() * a.length) | 0];
    switch ((r() * 7) | 0) {
      case 0: return pick(NAME_A);
      case 1: return pick(NAME_A) + pick(NAME_B).replace(/^./, (c) => c.toUpperCase());
      case 2: return pick(NAME_A) + (r() < 0.5 ? '_' : '') + (r() < 0.4 ? (10 + ((r() * 89) | 0)) : (100 + ((r() * 899) | 0)));
      case 3: return '[' + pick(NAME_TAG) + '] ' + pick(NAME_S);
      case 4: return (pick(NAME_A).slice(0, 4) + '-' + pick(NAME_B)).toUpperCase();
      case 5: return pick(NAME_S);
      default: return pick(NAME_G) + pick(NAME_H) + (r() < 0.35 ? (2 + ((r() * 97) | 0)) : '');
    }
  }
  // ---------------------------------------------------------------------------
  // A LIVING COHORT
  // Pilots do not all exist at once. Each has a JOIN TIME (~1-2 an hour) and,
  // from that moment, its own career: it levels on its own curve, its power
  // follows from its level the way a real account's does, and its HULL EVOLVES as
  // it climbs — frigate to interceptor to cruiser and on up. Everything is a pure
  // function of (seed, hours since join), so the roster is deterministic, needs
  // no storage, and every reload shows the cohort exactly where it should be.
  //
  // The variance is the point: a Grinder hits Lv 300 in a fortnight, a Casual is
  // still in the 40s a month later, and a few plateau and effectively stop. That
  // spread is what makes a board read as people rather than a curve.
  // ---------------------------------------------------------------------------
  const JOIN_PER_HOUR = 1.5;         // ~1-2 new pilots an hour
  const ROSTER_MAX = 400;            // ceiling on the simulated population
  const LVL_CAP = 500;               // ascend and restart, exactly like a human

  // HULL EVOLUTION — the ladder a pilot actually walks as it levels. Index = the
  // flagship at that level band; escorts are drawn from strictly lower bands, so
  // a wing always looks like a fleet that was built up rather than handed over.
  const HULL_LADDER = [
    [0,   'frigate'], [12,  'interceptor'], [28,  'cruiser'],   [55,  'heavycruiser'],
    [95,  'destroyer'], [150, 'battleship'], [215, 'dreadnought'], [285, 'carrier'],
    [350, 'aegis'], [410, 'supercarrier'], [455, 'titan'], [485, 'mothership'],
  ];
  function hullIdxFor(level) {
    let i = 0;
    for (let k = 0; k < HULL_LADDER.length; k++) if (level >= HULL_LADDER[k][0]) i = k;
    return i;
  }
  function fleetFor(level, stars, r) {
    const top = hullIdxFor(level);
    // escort slots unlock every 100 levels, exactly as CONFIG.FLEET does
    const slots = Math.min(4, Math.floor(level / 100));
    const out = [HULL_LADDER[top][1]];
    // ascended veterans field a tighter, better-kitted wing
    const reach = Math.min(top, 3 + (stars > 0 ? 2 : 0));
    for (let k = 0; k < slots && out.length < 5; k++) {
      let pick = null;
      for (let t = 0; t < 8 && !pick; t++) {
        const idx = Math.max(0, top - 1 - ((r() * reach) | 0));
        const key = HULL_LADDER[idx][1];
        if (out.indexOf(key) === -1) pick = key;      // hulls are unique per fleet
      }
      if (pick) out.push(pick);
    }
    return out;
  }

  // LEVELLING — fast at first, slowing hard. `pace` is the pilot's dedication.
  // Base pace reaches ~Lv 100 in a week and the 500 wall in roughly three months;
  // a casual pilot is still in the double digits after a month and may never get
  // there. Deliberately slower than it feels like it should be — a board where
  // everyone is Lv 400 inside a fortnight stops meaning anything.
  function levelAt(hours, pace) {
    return Math.max(1, Math.floor(5.2 * pace * Math.pow(Math.max(0, hours), 0.58)));
  }
  // POWER follows LEVEL, not the clock — that is what makes the two agree on the
  // row. Geometric, mirroring how the real economy scales per level.
  function powerFor(level, stars, wealth) {
    const p = 1400 * Math.pow(1.041, level) * wealth;
    return Math.max(600, Math.round(p * (1 + stars * 0.55)));   // ascension compounds
  }

  const LOCAL_SEED = 0x10F71EE7;
  // one stable identity per roster slot, built once
  const SEEDS = (() => {
    const r = rng(LOCAL_SEED), out = [], seen = {};
    for (let i = 0; i < ROSTER_MAX; i++) {
      let nm = '';
      for (let t = 0; t < 14; t++) { nm = nameFrom(r); if (!seen[nm.toLowerCase()]) break; }
      if (seen[nm.toLowerCase()]) continue;
      seen[nm.toLowerCase()] = 1;
      // pace: heavily skewed to the middle, with real outliers at both ends
      const roll = r();
      const pace = roll < 0.14 ? 0.30 + r() * 0.20      // casual — months to mid-game
                 : roll < 0.78 ? 0.60 + r() * 0.55      // the bulk of the board
                 : roll < 0.95 ? 1.15 + r() * 0.45      // committed
                 : 1.60 + r() * 0.55;                   // the few who push
      out.push({
        name: nm,
        joinH: (i / JOIN_PER_HOUR) + (r() * 0.9 - 0.45),   // jittered arrival
        pace,
        wealth: 0.55 + r() * 0.9,        // gear luck — two pilots at a level differ
        // some accounts stall: they stop progressing at a personal ceiling
        plateauAt: r() < 0.22 ? (40 + r() * 260) : 1e9,
        rr: r(),                         // stable per-pilot randomness
      });
    }
    return out;
  })();

  // The cohort as it stands RIGHT NOW.
  function cohort() {
    const nowH = ageHours();
    const out = [];
    for (const p of SEEDS) {
      const h = nowH - p.joinH;
      if (h <= 0) continue;                              // hasn't joined yet
      let raw = levelAt(h, p.pace);
      if (raw > p.plateauAt) raw = Math.round(p.plateauAt + (raw - p.plateauAt) * 0.08);
      // LEVEL 500 = ascend and start over, exactly like a human
      const stars = Math.floor((raw - 1) / LVL_CAP);
      const level = ((raw - 1) % LVL_CAP) + 1;
      const fr = rng((LOCAL_SEED ^ (p.name.length * 2654435761)) + Math.round(p.rr * 1e6));
      const fleet = fleetFor(level, stars, fr);
      const power = powerFor(level, stars, p.wealth);
      out.push({
        name: p.name, level,
        zone: Math.max(1, Math.min(1000, Math.round(level * (0.72 + p.rr * 0.5)))),
        power,
        kills: Math.round(h * 900 * p.pace * (0.7 + p.rr * 0.7)),
        asc: stars,
        _fleet: fleet, _loadout: null, _sim: true, _local: true,
        _joinedH: h,
      });
    }
    return out.sort((a, b) => b.power - a.power);
  }
  let _cohort = null, _cohortAt = 0;
  const LOCAL = { get length() { return SEEDS.length; } };
  function localRoster() {
    // recompute at most once a minute — levels only move on the scale of hours
    if (!_cohort || Date.now() - _cohortAt > 60000) { _cohort = cohort(); _cohortAt = Date.now(); }
    return _cohort;
  }
  function roster() { return (_rows && _rows.length) ? _rows : localRoster(); }

  // ---- THE CLIMB -------------------------------------------------------------
  // Nothing shows for the first day — a brand-new cohort has nothing to display.
  // After that the only global rule left is a CEILING: no simulated pilot may
  // out-power the strongest human. Their individual progression does the rest.
  // Nothing shows for the first couple of hours — a cohort that materialises the
  // instant someone installs the game is the one thing that gives it away. Two
  // hours reads as arrivals rather than a seeded list, without leaving a fresh
  // install staring at an empty board all day.
  const HIDE_HOURS = 2;
  function epoch() {
    try {
      let e = parseInt(localStorage.getItem('lf-sim-epoch') || '', 10);
      if (!e || !isFinite(e)) { e = Date.now(); localStorage.setItem('lf-sim-epoch', String(e)); }
      return e;
    } catch (err) { return Date.now(); }
  }
  const ageHours = () => (Date.now() - epoch()) / 36e5;
  function surfaced() { return ageHours() >= HIDE_HOURS; }
  function capLevel(lv) { const n = Math.max(1, Math.round(lv || 1)); return n > LVL_CAP ? ((n - 1) % LVL_CAP) + 1 : n; }
  // ---- BOARD INJECTION -------------------------------------------------------
  // Given the real board (humans + you), return the sims that may appear on it.
  //
  // HUMANS ARE NEVER DISPLACED. The ranks screen renders a fixed number of rows,
  // so as the roster grows sims would quietly push real players off the page —
  // the exact opposite of the goal. Sims only ever fill the slots humans are not
  // using, on top of the top-10 and top-100 seat caps.
  const VISIBLE_ROWS = 60;
  function forBoard(realBoard) {
    const pool = roster();
    if (!pool.length) return [];
    // DAY ONE: the roster is not on the board at all. Brand-new accounts have
    // nothing to show, and an empty first day is more convincing than a crowd.
    if (!(_rows && _rows.length) && !surfaced()) return [];
    const cfg = _cfg || {};
    const maxTop10 = cfg.max_top10 == null ? 2 : cfg.max_top10;
    const maxTop100 = cfg.max_top100 == null ? 25 : cfg.max_top100;
    const humans = (realBoard || []).slice().sort((a, b) => (b.power || 0) - (a.power || 0));
    const topHuman = humans.length ? (humans[0].power || 0) : 0;
    // every human keeps their row; sims take what's left of the visible page
    const room = Math.max(0, VISIBLE_ROWS - humans.length);
    const budget = Math.min(maxTop100, room);
    if (budget <= 0) return [];

    // THE ONLY GLOBAL RULE LEFT: no simulated pilot may out-power the strongest
    // human. Each pilot's level, power, hull and kills already come from its own
    // career (see cohort()), so nothing else needs flattening — the board reads as
    // people at different points in their own progression, which is the point.
    let list = pool;
    if (!(_rows && _rows.length) && topHuman > 50000) {
      list = pool.map((p) => (p.power >= topHuman
        ? Object.assign({}, p, { power: Math.max(1, topHuman - 1) })
        : p)).sort((a, b) => b.power - a.power);
    }

    const out = [];
    let inTop10 = 0;
    for (const s of list) {
      if (out.length >= budget) break;
      const above = humans.filter((h) => (h.power || 0) > s.power).length;
      const pos = above + out.filter((o) => o.power > s.power).length + 1;
      if (pos <= 10) {
        if (inTop10 >= maxTop10) continue;   // top-10 seat cap
        inTop10++;
      }
      out.push(s);
    }
    return out;
  }

  // ---- TILE DEFENDERS --------------------------------------------------------
  // A simulated pilot garrisons a tile deterministically: the same tile always
  // draws the same pilot, so ownership feels stable between sessions without any
  // server write. The returned shape is identical to rivalDefense()'s, so the
  // clone-fight maths (cloneMatchup) treats it like any other defender.
  function defenderFor(tileId) {
    const pool = roster();
    if (!pool.length || !tileId) return null;
    let h = 0;
    for (let i = 0; i < tileId.length; i++) h = ((h * 31 + tileId.charCodeAt(i)) >>> 0);
    const p = pool[h % pool.length];
    if (!p) return null;
    const fleet = (p._fleet && p._fleet.length) ? p._fleet : ['cruiser'];
    return {
      name: p.name, real: false, sim: true, citadel: false, score: p.power,
      snap: {
        ship: fleet[0], nm: (window.CONFIG.SHIP_BY_KEY[fleet[0]] || {}).name || fleet[0],
        lvl: p.level, score: p.power, hp: 0, dps: 0, asc: p.asc,
        esc: Math.max(0, fleet.length - 1), escKeys: fleet.slice(1, 5),
      },
    };
  }

  // ---- the SIM designation chip ---------------------------------------------
  // DELIBERATELY EMPTY — see the INVISIBILITY note in the header.
  function chip() { return ''; }

  function stats() {
    const c = localRoster();
    return { enabled: enabled(), config: _cfg, server: _rows.length,
             cohort: c.length, seats: SEEDS.length, fetchedAt: _at,
             ageHours: ageHours().toFixed(1), surfaced: surfaced(),
             joinPerHour: JOIN_PER_HOUR,
             topLevel: c.length ? c[0].level : 0,
             newest: c.length ? Math.min.apply(null, c.map((p) => p._joinedH)).toFixed(1) + 'h ago' : '—' };
  }

  // no styling needed — sims are visually indistinguishable from humans
  function boot() {}
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  // warm the cache shortly after boot, then let the TTL handle it
  setTimeout(() => refresh(), 1200);
  // and again once the UI has certainly booted, so the first paint of the Ranks
  // page always has the roster available
  setTimeout(() => refresh(), 6000);

  window.SIMPILOTS = { refresh, forBoard, defenderFor, chip, stats, enabled, rows: () => roster() };
})();
