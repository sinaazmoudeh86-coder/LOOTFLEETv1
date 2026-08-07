/* =============================================================================
   ranks-boards.js — SEVEN LADDERS for Command ▸ Ranks
   ---------------------------------------------------------------------------
   The Ranks screen used to be one board: all-time fleet power. This adds six
   more, each measuring something a pilot actually *did* rather than power they
   currently hold.

     power     fleet power                    leaderboard.power        (as before)
     tiles     hourly revenue from held space leaderboard.tile_rev
     voidmaw   Season 1 Voidmaw stage         sdread_scores
     ships     hulls built                    leaderboard.ships
     missions  lifetime missions completed    leaderboard.missions
     badges    lifetime badge ranks claimed   leaderboard.badges

   WHERE THE NUMBERS COME FROM
   Four of the new columns ride on the leaderboard row every account already
   publishes on its heartbeat (see account.js → publishLb). They are therefore
   exactly as fresh as `power` is, and no fresher — a dormant account shows its
   last-known figures, same as everywhere else on this page.

   SIMULATED PILOTS
   Sims carry only power/level/zone/kills/asc_stars server-side. Giving them
   real columns would mean writing sim rows into `leaderboard`, which the
   fairness guards exist to prevent. Instead each sim's figures are DERIVED here
   from its own name and level through a seeded RNG: deterministic (the same
   pilot always shows the same numbers, on every device and every refresh),
   plausible (they track the pilot's level the way a human's would), and never
   written anywhere.

   ============================================================================= */
(function () {
  'use strict';

  const G = () => window.GAME;
  const cl = () => (window.CLOUD && window.CLOUD.enabled ? window.CLOUD.client : null);

  // ---- ladder definitions ---------------------------------------------------
  // metric  → the number the board sorts by, descending
  // unit    → short label above that number in the row
  // meta    → the dim second line under the pilot's name
  // Real rows map stars to `asc` (leaderboard.js mapReal); sim rows carry the
  // raw `asc_stars`. Read both so the ladder can't silently rank one pool at 0.
  const ascOf = (p) => (((p && p.asc != null ? p.asc : (p && p.asc_stars)) || 0) | 0);
  // Reuse the game's own 5-star-per-tier model rather than restating it here —
  // the tier ladder IS the rarity ladder, and it must not drift from the badge
  // every other screen renders.
  function rankLabel(n) {
    if (n <= 0) return 'Unascended';
    try {
      const P = window.PASCEND;
      if (P && P.tierDef && P.starOf) return P.tierDef(n).name + ' \u2605' + P.starOf(n);
    } catch (e) {}
    return '\u2605' + n;
  }

  const TABS = [
    {
      id: 'power', ic: '\u26a1', col: '#f2b24b', label: 'POWER', sub: 'Fleet Power',
      info: 'Every operator ranked by total fleet power.',
      unit: 'PWR',
      metric: (p) => p.power || 0,
      fmt: (v) => fmtRaw(v),
      meta: (p) => 'Zone ' + (p.zone | 0) + ' · Lv ' + (p.level | 0) + ' · ' + fmt(p.kills || 0) + ' kills',
    },
    {
      // Needs no migration: asc_stars has always been on the leaderboard row and
      // publishes through its own p_asc cascade, so this ladder is live today
      // while tiles/ships/missions/badges still wait on lb-onefunction.sql.
      id: 'asc', ic: '\u2726', col: '#ffd24d', label: 'ASCENSION', sub: 'Pilot Rank',
      info: 'Ranked by ascension stars — pilots who reset a finished run for permanent account-wide perks. Ties break on fleet power.',
      unit: 'STARS',
      // stars dominate; power only separates pilots on the same star count
      metric: (p) => ascOf(p) * 1e15 + Math.min(1e15 - 1, p.power || 0),
      fmt: (v, p) => String(ascOf(p)),
      meta: (p) => rankLabel(ascOf(p)) + ' · Lv ' + (p.level | 0) + ' · ' + fmtRaw(p.power || 0) + ' power',
      empty: 'Nobody has ascended yet. The first pilot to reset a run takes this board outright.',
    },
    {
      id: 'tiles', ic: '\u2691', col: '#5fa8ff', label: 'TERRITORY', sub: 'Galaxy Tiles',
      info: 'Ranked by hourly revenue from held systems — not tile count. A few fortified systems beat a wide, undefended sprawl.',
      unit: '/HR',
      metric: (p) => p.tile_rev || 0,
      fmt: (v) => fmt(v),
      meta: (p) => (p.tiles | 0) + ' system' + ((p.tiles | 0) === 1 ? '' : 's') +
                   ((p.citadels | 0) ? ' · ' + (p.citadels | 0) + ' citadel' + ((p.citadels | 0) === 1 ? '' : 's') : '') +
                   ' · Lv ' + (p.level | 0),
      empty: 'No systems claimed yet. Take one in My Galaxy and it starts paying immediately.',
    },
    {
      id: 'voidmaw', ic: '\u2620', col: '#ff4d6d', label: 'VOIDMAW', sub: 'Season 1',
      info: 'Season 1 Voidmaw. Ranked by deepest stage cleared, then by total damage.',
      unit: 'STAGE',
      metric: (p) => (p.stage || 0) * 1e12 + Math.min(1e12, Math.log10(Math.max(1, p.total || 0)) * 1e10),
      fmt: (v, p) => String(p.stage | 0),
      meta: (p) => 'Stage ' + (p.stage | 0) + ' · ' + fmt(p.total || 0) + ' total damage',
      empty: 'Nobody has entered the Voidmaw this season.',
      async: true,
    },
    {
      id: 'ships', ic: '\u27a4', col: '#7ce0a0', label: 'HANGAR', sub: 'Hulls Owned',
      info: 'Every hull built, bought, or granted — the size of the collection, not the fleet flying.',
      unit: 'HULLS',
      metric: (p) => p.ships || 0,
      fmt: (v) => String(v | 0),
      meta: (p) => 'Lv ' + (p.level | 0) + ' · ' + fmt(p.power || 0) + ' power',
      empty: 'No hangars on record yet.',
    },
    {
      id: 'missions', ic: '\u2714', col: '#5fd1ff', label: 'MISSIONS', sub: 'Lifetime Cleared',
      info: 'Missions completed across every board — daily, weekly and monthly. Carries through ascension.',
      unit: 'DONE',
      metric: (p) => p.missions || 0,
      fmt: (v) => fmt(v),
      meta: (p) => {
        const n = p.missions | 0;
        return n >= 1000 ? 'Lv ' + (p.level | 0) + ' · ⌘ Veridian earned'
                         : 'Lv ' + (p.level | 0) + ' · ' + fmt(Math.max(0, 1000 - n)) + ' to the Veridian';
      },
      empty: 'No missions cleared yet.',
    },
    {
      id: 'badges', ic: '\u2b21', col: '#b57bff', label: 'BADGES', sub: 'Ranks Claimed',
      info: 'Lifetime commendations claimed, out of 1,000. Claim them all and the Titan Sina is granted.',
      unit: '/1000',
      metric: (p) => p.badges || 0,
      fmt: (v) => String(v | 0),
      meta: (p) => {
        const n = p.badges | 0;
        return n >= 1000 ? 'Lv ' + (p.level | 0) + ' · ★ Titan Sina granted'
                         : 'Lv ' + (p.level | 0) + ' · ' + fmt(1000 - n) + ' badges to the Titan Sina';
      },
      empty: 'No badges claimed yet.',
    },
  ];
  const BY_ID = {};
  TABS.forEach((t) => { BY_ID[t.id] = t; });

  function fmt(n) { try { return G().formatNum(n); } catch (e) { return String(Math.floor(n || 0)); } }
  function fmtRaw(n) { try { return (G().formatNumRaw || G().formatNum)(n); } catch (e) { return String(Math.floor(n || 0)); } }

  // ---- deterministic sim figures --------------------------------------------
  // How many hulls a simulated pilot can plausibly own. Derived from the live
  // roster so it can never drift out of range again, and it EXCLUDES the Kaevith
  // event hulls (alienTech): those are earned only by clearing an alien-held zone
  // in My Galaxy, at 1–10% per clear, so crediting bots with them would both
  // overstate the ceiling and imply they play an event they do not participate in.
  const SIM_HULL_CAP = (() => {
    try {
      const all = (window.CONFIG && window.CONFIG.SHIPS) || [];
      const n = all.filter((s) => !s.alienTech).length;
      return n > 0 ? n : 32;
    } catch (e) { return 32; }
  })();

  // Seeded on the pilot's NAME, so a given sim shows identical numbers forever,
  // on every device, without a byte of storage. Values track level and ascension
  // the way a human account's would — a Lv 400 ★12 pilot reads like one.
  function seed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return () => { h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
  }
  function derive(p) {
    if (p._derived) return p;
    const r = seed(String(p.name || '?')), lv = Math.max(1, p.level | 0), st = Math.max(0, p.asc_stars | 0);
    const career = lv + 500 * st;                        // total levels ever walked

    // TERRITORY — held space grows with career but plateaus; the galaxy is finite
    // and contested, so nobody holds hundreds of systems.
    const tiles = Math.min(60, Math.floor((career / 42) * (0.45 + r() * 1.1)));
    const citadels = tiles > 2 ? Math.floor(tiles * (0.1 + r() * 0.28)) : 0;
    // hourly revenue on the same scale as the real metric (tileRevenue →
    // resourceRates units): ~150-400 units per plain tile, citadels 10×, with a
    // mild depth factor for long careers — NOT the old ×1.028^level exponential,
    // which put veteran sims at 1e12/hr while real players sat at 1e4.
    const rev = tiles ? Math.round((tiles * 9 + citadels * 80) * 25 * (1 + career / 350) * (0.7 + r() * 0.8)) : 0;

    // HANGAR — hulls unlock roughly every 12 levels, capped at the roster size.
    // SIM_HULL_CAP is derived from CONFIG.SHIPS rather than hardcoded: the literal
    // 48 here predated several roster changes and outran the real count, so top
    // sim pilots were credited with more hulls than exist in the game.
    const ships = Math.max(1, Math.min(SIM_HULL_CAP, Math.floor(lv / 12) + Math.floor(st * 1.4) + Math.floor(r() * 3)));

    // MISSIONS — a board a day, give or take, across the whole career
    const missions = Math.floor(career * (0.55 + r() * 0.75));

    // BADGES — the 1,000-rank ladder is a multi-year climb; even veterans are low
    const badges = Math.min(1000, Math.floor(Math.pow(career, 0.92) * (0.22 + r() * 0.4)));

    p.tiles = tiles; p.citadels = citadels; p.tile_rev = rev;
    p.ships = ships; p.missions = missions; p.badges = badges;
    p._derived = true;
    return p;
  }

  // ---- async sources ---------------------------------------------------------
  const _cache = {};                                     // id → { at, rows }
  const TTL = 30000;

  async function fetchVoidmaw() {
    const c = cl(); if (!c) return [];
    const r = await c.from('sdread_scores')
      .select('user_id,name,season,stage,total')
      .order('stage', { ascending: false })
      .limit(200);
    if (r.error) throw r.error;
    // one row per pilot — the deepest stage they reached this season
    const best = new Map();
    for (const row of r.data || []) {
      const k = row.user_id || row.name;
      const cur = best.get(k);
      if (!cur || (row.stage | 0) > (cur.stage | 0)) best.set(k, row);
    }
    return [...best.values()];
  }

  function loadAsync(id, cb) {
    const hit = _cache[id];
    if (hit && Date.now() - hit.at < TTL) { cb(hit.rows, hit.err); return; }
    const job = id === 'voidmaw' ? fetchVoidmaw() : Promise.resolve([]);
    job.then((rows) => { _cache[id] = { at: Date.now(), rows, err: null }; cb(rows, null); })
       .catch((err) => { _cache[id] = { at: Date.now(), rows: [], err }; cb([], err); });
  }

  // ---- has lb-onefunction.sql run? --------------------------------------------
  // Until it has, `leaderboard` has no tiles/ships/missions/badges columns, so
  // every REAL pilot reads 0 on four of the six boards and only derived sim
  // figures rank. That is not a thin board — it is a WRONG one, and it would
  // quietly credit simulated pilots with records no human could be shown to
  // beat. Detected by absence of the property (not a zero value), and those
  // boards refuse to render until the columns exist.
  const NEEDS_SQL = { tiles: 1, ships: 1, missions: 1, badges: 1 };
  function migrated(rows) {
    for (const p of rows) {
      if (p.isMe || p._sim || p.is_simulated || p._filler) continue;
      if (p.missions !== undefined || p.tile_rev !== undefined) return true;
    }
    return false;                       // no human row carries the columns
  }

  // ---- board assembly --------------------------------------------------------
  // Returns { rows, real, tab, pending, err }. `pending` means an async board is
  // still loading and the caller should re-render when `onReady` fires.
  function board(id, onReady) {
    const tab = BY_ID[id] || TABS[0];
    const LB = window.LEADERBOARD;
    const g = G();
    if (!LB || !g) return { rows: [], real: 0, tab, pending: false };

    // ASYNC LADDERS — their own tables, not the leaderboard row
    if (tab.async) {
      const hit = _cache[id];
      if (!hit || Date.now() - hit.at >= TTL) {
        loadAsync(id, () => { if (onReady) onReady(); });
        if (!hit) return { rows: [], real: 0, tab, pending: true };
      }
      const mine = myName();
      const rows = (hit ? hit.rows : []).map((p) => Object.assign({}, p, { isMe: p.name === mine }));
      rows.sort((a, b) => tab.metric(b) - tab.metric(a));
      rows.forEach((p, i) => { p.rank = i + 1; });
      return { rows, real: rows.length, tab, pending: false, err: hit && hit.err };
    }

    // LEADERBOARD LADDERS — the same pool the power board uses, re-sorted
    const data = LB.allTimeBoard(g);
    if (NEEDS_SQL[id] && !migrated(data.board)) {
      return { rows: [], real: 0, tab, pending: false, needsSql: true };
    }
    const rows = data.board.map((p) => {
      const q = Object.assign({}, p);
      if (q.isMe) mineInto(q);
      else if (q._sim || q.is_simulated || q._filler) derive(q);
      else fill(q);
      return q;
    });
    rows.sort((a, b) => tab.metric(b) - tab.metric(a));
    rows.forEach((p, i) => { p.rank = i + 1; });
    return { rows, real: data.real || 0, tab, pending: false };
  }

  // YOUR row, read live from the save so it never lags the heartbeat.
  function mineInto(q) {
    const s = G().state || {};
    const own = s.ownedSystems || {}, cits = s.citadels || {};
    q.tiles = Object.keys(own).length;
    q.citadels = Object.keys(cits).length;
    q.tile_rev = tileRevenue();
    q.ships = Object.keys(s.ownedShips || {}).length || 1;
    q.missions = s.lifetimeMissions | 0;
    q.badges = (() => {
      // Badges live in state.achieve.claimed (per-chain counts) — the old
      // badgeRanks/achClaimed fields never existed, so every real player
      // published 0 on this board. ACHIEVE.totalClaimed() is the same figure the
      // Missions screen shows; the inline sum is the no-module fallback.
      try { if (window.ACHIEVE && ACHIEVE.totalClaimed) return ACHIEVE.totalClaimed() | 0; } catch (e) {}
      try { const c = (s.achieve && s.achieve.claimed) || {}; let n = 0; for (const k in c) n += c[k] | 0; return Math.min(1000, n); } catch (e) { return 0; }
    })();
    return q;
  }

  // A human row that has published the new columns uses them; one that hasn't
  // published since the migration reads 0 rather than a fabricated number.
  function fill(q) {
    q.tiles = q.tiles | 0; q.citadels = q.citadels | 0;
    q.tile_rev = Number(q.tile_rev) || 0;
    q.ships = q.ships | 0; q.missions = q.missions | 0; q.badges = q.badges | 0;
    return q;
  }

  // Total hourly output of everything you hold. Delegates to the SAME function
  // the Galaxy screen and Empire Income use (GAME.resourceRates), so the board
  // can never disagree with them. The old inline copy multiplied citadels by
  // 1000×lv (real: 10×lv) and skipped the ×25 galaxy yield, deep-space and Void
  // handling — fortress players ranked on numbers ~100× their real income.
  // Gold (Void spires pay it at 1000× resource scale) is normalised back to
  // resource units so one spire doesn't swamp the whole figure.
  function tileRevenue() {
    try {
      const g = G(), r = g.resourceRates ? g.resourceRates() : null;
      if (!r) return 0;
      return Math.round((r.fuel || 0) + (r.iron || 0) + (r.plasma || 0) + (r.gold || 0) / 1000);
    } catch (e) { return 0; }
  }

  function myName() {
    try { return (G().state && G().state.name) || null; } catch (e) { return null; }
  }

  // What THIS account publishes on its heartbeat — read by account.js.
  function publishFields() {
    try {
      const s = G().state || {};
      return {
        tiles: Object.keys(s.ownedSystems || {}).length,
        tile_rev: tileRevenue(),
        ships: Object.keys(s.ownedShips || {}).length || 1,
        missions: s.lifetimeMissions | 0,
        badges: (() => {
      // Badges live in state.achieve.claimed (per-chain counts) — the old
      // badgeRanks/achClaimed fields never existed, so every real player
      // published 0 on this board. ACHIEVE.totalClaimed() is the same figure the
      // Missions screen shows; the inline sum is the no-module fallback.
      try { if (window.ACHIEVE && ACHIEVE.totalClaimed) return ACHIEVE.totalClaimed() | 0; } catch (e) {}
      try { const c = (s.achieve && s.achieve.claimed) || {}; let n = 0; for (const k in c) n += c[k] | 0; return Math.min(1000, n); } catch (e) { return 0; }
    })(),
      };
    } catch (e) { return null; }
  }

  window.RANKBOARDS = { TABS, BY_ID, board, publishFields, tileRevenue };
})();
