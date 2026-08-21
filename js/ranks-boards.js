/* =============================================================================
   ranks-boards.js — NINE LADDERS for Command ▸ Ranks
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
      empty: 'No operators have published a fleet yet.',
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
      id: 'cargo', ic: '\u26df', col: '#ffb84d', label: 'HAULAGE', sub: 'Cargo Delivered',
      sql: 'cargo-ladder.sql',
      info: 'Space Cargo Defense — lifetime shipments escorted to the Citadel. Ties break on best delivered condition.',
      empty: 'No shipments have been escorted yet. Run one Cargo Defense contract and you take this board.',
      unit: 'HAULS',
      metric: (p) => (p.cargo || 0) * 1e3 + Math.min(999, (p.cargo_best | 0) * 9),
      fmt: (v, p) => fmt(p.cargo | 0),
      meta: (p) => ((p.cargo | 0) ? 'best delivery ' + Math.min(100, p.cargo_best | 0) + '% · ' : '') + rankLabel(ascOf(p)) + ' · Lv ' + (p.level | 0),
    },
    {
      // NANOCORES — the top of the scale only. Common through Epic cores drop
      // for everyone; ranking them would rank crate volume. This board measures
      // the 1.5% pull, then what the pilot did with it: how deep they built ONE
      // core, and how many rolls landed in the top 5% of their range.
      id: 'nano', ic: '\u25c8', col: '#f0972a', label: 'NANOCORE', sub: 'Legendary Cores',
      sql: 'nanocore-ladder.sql',
      info: 'Legendary Nanocores recovered — 1.5% a crate. Ties break on the deepest single core built, then on top-5% buff rolls.',
      unit: 'CORES',
      metric: (p) => (p.nano_legend | 0) * 1e9 + Math.min(5, p.nano_slots | 0) * 1e6 + Math.min(999999, p.nano_god | 0),
      fmt: (v, p) => String(p.nano_legend | 0),
      meta: (p) => {
        const s = Math.min(5, p.nano_slots | 0), g = p.nano_god | 0;
        if (!(p.nano_legend | 0)) return 'No Legendary core yet · Lv ' + (p.level | 0);
        return (s >= 5 ? '★ 5/5 slots — core finished' : s + '/5 slots on one core') +
               (g ? ' · ' + fmt(g) + ' god roll' + (g === 1 ? '' : 's') : '') +
               ' · Lv ' + (p.level | 0);
      },
      empty: 'No Legendary Nanocores recovered yet. They drop at 1.5% a crate — the first pilot to pull one takes this board outright.',
    },
    {
      id: 'badges', ic: '\u2b21', col: '#b57bff', label: 'BADGES', sub: 'Ranks Claimed',
      get info() { return 'Lifetime commendations claimed, out of ' + badgeTotal().toLocaleString() + '. Claim them all and the Titan Sina is granted.'; },
      get unit() { return '/' + badgeTotal(); },
      metric: (p) => p.badges || 0,
      fmt: (v) => String(v | 0),
      meta: (p) => {
        const n = p.badges | 0, T = badgeTotal();
        return n >= T ? 'Lv ' + (p.level | 0) + ' · ★ Titan Sina granted'
                      : 'Lv ' + (p.level | 0) + ' · ' + fmt(T - n) + ' badges to the Titan Sina';
      },
      empty: 'No badges claimed yet.',
    },
    {
      // HOME DEFENSE — the deepest wave the pilot is HOLDING. The Home Citadel
      // never rolls a wave back on a breach (a breach damages the base and halts
      // mining; the wave stands), so "holding" and "best" are the same number
      // and the board can say the stronger of the two honestly.
      id: 'hcwave', ic: '\u26e8', col: '#6fe0a0', label: 'HOME DEFENSE', sub: 'Deepest Wave',
      sql: 'new-ladders.sql',
      info: 'Ranked by the deepest Home Citadel wave you are holding. Every wave cleared raises passive production forever — this is the one board that shows whose base earns hardest. Ties break on fleet power.',
      unit: 'WAVE',
      metric: (p) => (p.hcwave | 0) * 1e15 + Math.min(1e15 - 1, p.power || 0),
      fmt: (v, p) => String(p.hcwave | 0),
      meta: (p) => {
        const w = p.hcwave | 0;
        const era = w >= 250 ? 'MYTHIC era' : w >= 100 ? 'LEGENDARY era · ×2 production' : w >= 50 ? 'EPIC era' : w >= 20 ? 'RARE raiders' : 'building up';
        return (w ? era : 'No waves cleared') + ' · Lv ' + (p.level | 0);
      },
      empty: 'Nobody is holding a wave yet. Clear Wave 1 in the Home Citadel and you take this board outright.',
    },
    {
      // EXPLORATION — counts DEBRIEFED expeditions only, so a fleet still in
      // flight is not yet worth anything here and a recalled one never counts.
      id: 'expo', ic: '\u25ce', col: '#7fe0ff', label: 'EXPLORATION', sub: 'Expeditions Flown',
      sql: 'new-ladders.sql',
      info: 'Fleet Exploration — expeditions completed and debriefed. Recalled runs do not count. Ties break on the strongest wing ever sent out.',
      unit: 'FLOWN',
      metric: (p) => (p.expo | 0) * 1e9 + Math.min(1e9 - 1, p.expo_best | 0),
      fmt: (v, p) => fmt(p.expo | 0),
      meta: (p) => ((p.expo_best | 0) ? 'best wing rating ' + (p.expo_best | 0) + ' · ' : '') + 'Lv ' + (p.level | 0),
      empty: 'No expeditions flown yet. Launch one from Command ▸ Fleet Exploration.',
    },
    {
      // THE TEMPLE — PvP standing. Ranked on ALTARS TAKEN first, kills second:
      // a pure kill board would reward farming whoever is weakest at the rim and
      // ignoring the altar, and the altar is the point of the zone. Deaths are
      // SHOWN but never ranked on — the hull reset already punished them once,
      // and a public shame number would make the whole zone a place to avoid.
      // Server-owned end to end (temple_claims + temple_kills, both written only
      // by security-definer RPCs), so nothing here can be self-reported.
      id: 'temple', ic: '\u2694', col: '#c98bff', label: 'TEMPLE', sub: 'PvP \u00b7 Altars \u00b7 Kills',
      sql: 'temple.sql',
      info: 'The Temple \u2014 altars claimed off the disk, then kills. Deaths are shown, never ranked. Every row is a real pilot; nothing in the Temple can be reported by the player who did it.',
      unit: 'ALTARS',
      metric: (p) => (p.altars | 0) * 1e9 + (p.kills | 0) * 1e3 + (p.best_rarity | 0),
      fmt: (v, p) => String(p.altars | 0),
      meta: (p) => {
        const r = (window.CONFIG && window.CONFIG.RARITY[p.best_rarity | 0]) || null;
        return (p.kills | 0) + ' kill' + ((p.kills | 0) === 1 ? '' : 's') + ' \u00b7 ' + (p.deaths | 0) + ' death' + ((p.deaths | 0) === 1 ? '' : 's')
          + ((p.best_rarity | 0) >= 11 && r ? ' \u00b7 best: ' + r.name : '');
      },
      empty: 'No altars have been taken. The first pilot to lift one off the disk owns this board.',
      async: true,
    },
    {
      // KING OF THE HILL — the only board with two views, because the event has
      // two honest answers to "who is winning". TODAY is the live race from
      // koth_top(); CROWNS is the career record from koth_hall. Neither is
      // published by the client — both are server-owned, so nothing here can be
      // self-reported and no migration probe is needed.
      id: 'koth', ic: '\u{1F451}', col: '#ffd24d', label: 'KING OF THE HILL', sub: 'Daily · Crowns',
      sql: 'koth.sql',
      info: 'The 24-hour kill race. TODAY is the live board and resets at 00:05 UTC; CROWNS counts days won for good. Ties on crowns break on total kills across winning days.',
      unit: 'KILLS',
      views: [
        { id: 'day', label: 'TODAY', unit: 'KILLS' },
        { id: 'hall', label: 'CROWNS', unit: 'WINS' },
      ],
      metric: (p) => (p.view === 'hall'
        ? (p.wins | 0) * 1e12 + Math.min(1e12 - 1, Number(p.kills) || 0)
        : (Number(p.kills) || 0)),
      fmt: (v, p) => (p.view === 'hall' ? String(p.wins | 0) : fmt(Number(p.kills) || 0)),
      meta: (p) => (p.view === 'hall'
        ? fmt(Number(p.kills) || 0) + ' kills across ' + (p.wins | 0) + ' winning day' + ((p.wins | 0) === 1 ? '' : 's')
        : 'Tier ' + Math.max(1, p.tier | 0) + (p.ship ? ' · ' + hullName(p.ship) : '')),
      empty: 'The race has not started. Enter from Command ▸ King of the Hill.',
      emptyHall: 'No crowns awarded yet. The first event closes at 00:05 UTC.',
      async: true,
    },
  ];
  const BY_ID = {};
  TABS.forEach((t) => { BY_ID[t.id] = t; });

  function fmt(n) { try { return G().formatNum(n); } catch (e) { return String(Math.floor(n || 0)); } }
  function fmtRaw(n) { try { return (G().formatNumRaw || G().formatNum)(n); } catch (e) { return String(Math.floor(n || 0)); } }

  // A HULL KEY IS NOT A HULL NAME. The KOTH rows carry the raw save key, so the
  // board printed lowercase internals — 'dread6' for the Dread Omega, 'titansina'
  // for the Titan Sina. Resolve through CONFIG; if a key ever outlives its ship
  // entry, title-case it rather than leaking the identifier.
  function hullName(k) {
    const key = String(k || '');
    try { const s = (window.CONFIG && window.CONFIG.SHIP_BY_KEY) ? window.CONFIG.SHIP_BY_KEY[key] : null; if (s && s.name) return s.name; } catch (e) {}
    return key ? key.charAt(0).toUpperCase() + key.slice(1) : '';
  }
  // The badge ladder's size is ACHIEVE's to state, not this board's to remember:
  // the total moved from 1,000 to 1,110 when the nanocore chains joined the count
  // and every readout that hardcoded it drifted. Read it live, every render.
  function badgeTotal() {
    try { if (window.ACHIEVE && ACHIEVE.TOTAL) return ACHIEVE.TOTAL | 0; } catch (e) {}
    return 1110;
  }

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

    // HAULAGE — Cargo Defense opens at Pilot Ascension ★3 and rations two runs a
    // day, so even a veteran sim's count stays believable (and ★2 hauls zero).
    p.cargo = st >= 3 ? Math.max(1, Math.floor(career * 0.6 * (0.4 + r() * 0.8))) : 0;
    p.cargo_best = p.cargo ? Math.min(100, 58 + Math.floor(r() * 43)) : 0;
    // MISSIONS — a board a day, give or take, across the whole career
    const missions = Math.floor(career * (0.55 + r() * 0.75));

    // BADGES — the full ladder is a multi-year climb; even veterans are low
    const badges = Math.min(badgeTotal(), Math.floor(Math.pow(career, 0.92) * (0.22 + r() * 0.4)));

    // NANOCORES — gated at Lv 50 and paid for in Prism Ingots, so a sim's
    // Legendary count tracks career rather than luck, and stays low enough that
    // one real 1.5% pull is worth something on the board. Slot depth is weighted
    // hard toward the shallow end: 25 successful upgrades on ONE core is the rare
    // thing, and no derived pilot is ever handed a finished 5/5 — that row has to
    // be earned by a human.
    const legend = lv >= 50 ? Math.max(0, Math.floor((career / 900) * (0.25 + r() * 1.35))) : 0;
    p.nano_legend = Math.min(14, legend);
    p.nano_slots = legend ? Math.min(4, Math.floor(Math.pow(r(), 1.7) * 5.4)) : 0;
    p.nano_god = legend ? Math.floor(legend * r() * 1.4) : 0;

    p.tiles = tiles; p.citadels = citadels; p.tile_rev = rev;
    p.ships = ships; p.missions = missions; p.badges = badges;

    // HOME DEFENSE — a wave is cleared roughly every two levels early and slows
    // sharply once raiders outscale a casual fleet, so this tracks career with a
    // hard taper rather than growing linearly forever.
    p.hcwave = Math.max(0, Math.floor(Math.pow(career, 0.78) * (0.5 + r() * 0.7)));
    // EXPLORATION — real-time gated: even a permanent resident cannot run more
    // than a handful of expeditions a day, so the count is bounded by how long
    // the account has plausibly existed rather than by how strong it is.
    p.expo = Math.max(0, Math.floor(Math.pow(career, 0.62) * (0.35 + r() * 0.9)));
    p.expo_best = p.expo ? Math.min(420, 40 + Math.floor(Math.pow(career, 0.55) * (1.2 + r() * 2.4))) : 0;

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

  // KING OF THE HILL — both views come straight from the KOTH module, which owns
  // the RPCs and their caching. Nothing is derived and nothing is published: a
  // daily standing and a crown are both decided server-side.
  async function fetchKoth(view) {
    const K = window.KOTH;
    if (!K) return [];
    if (view === 'hall') {
      const rows = await K.pollHall(true);
      return (rows || []).map((r) => Object.assign({}, r, { view: 'hall' }));
    }
    await K.pollBoard();
    return (K.board() || []).map((r) => Object.assign({}, r, { view: 'day' }));
  }

  async function fetchTemple() {
    const c = cl(); if (!c) return [];
    const r = await c.rpc('temple_top', { p_n: 50 });
    if (r.error) throw r.error;
    return r.data || [];
  }

  function loadAsync(id, cb) {
    const hit = _cache[id];
    if (hit && Date.now() - hit.at < TTL) { cb(hit.rows, hit.err); return; }
    const job = id === 'voidmaw' ? fetchVoidmaw()
      : id === 'koth' ? fetchKoth('day')
      : id === 'koth:hall' ? fetchKoth('hall')
      : id === 'temple' ? fetchTemple()
      : Promise.resolve([]);
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
  const NEEDS_SQL = { tiles: 1, ships: 1, missions: 1, badges: 1, cargo: 1, nano: 1, hcwave: 1, expo: 1 };
  // Which property proves the migration for THIS board ran. Haulage and Nanocore
  // ship in their OWN migrations (cargo-ladder.sql, nanocore-ladder.sql), so the
  // shared lb-onefunction probe would pass on a server that had run neither and
  // both boards would quietly rank every human at zero. Home Defense and
  // Exploration are the same story again, in new-ladders.sql.
  const SQL_PROBE = {
    cargo: ['cargo', 'cargo_best'],
    nano: ['nano_legend', 'nano_slots'],
    hcwave: ['hcwave'],
    expo: ['expo', 'expo_best'],
  };
  function migrated(rows, id) {
    // THE NEW LADDERS ASK THE SERVER, NOT THE ROWS.
    //
    // The row probe below cannot answer for hcwave/expo. It deliberately skips
    // the player's own row (mineInto writes those fields from the live save, so
    // they are always present whether or not the column exists) and every
    // simulated row (derive() fills them too). On a board where few humans have
    // published, nothing is left to inspect — and the ladder reported "waiting on
    // a database migration" permanently, even with the SQL run and the columns
    // there. The failing state looked identical to the real one, which is the
    // worst property a diagnostic can have.
    //
    // CLOUD.lbShape() reports which SELECT actually succeeded, which is a direct
    // statement about the schema and cannot be faked by a merged local row.
    if (id === 'hcwave' || id === 'expo') {
      try {
        const s = window.CLOUD && window.CLOUD.lbShape && window.CLOUD.lbShape();
        if (s) return s === 'new';
      } catch (e) {}
      // No board read has landed yet (offline, signed out, first paint). We do
      // not know, and the two wrong answers are both bad: claim the migration is
      // missing and we accuse a healthy database, or claim it is present and we
      // rank a board of simulated pilots. Say so instead — board() turns this
      // into a loading state.
      return 'unknown';
    }
    const keys = SQL_PROBE[id] || ['missions', 'tile_rev'];
    for (const p of rows) {
      if (p.isMe || p._sim || p.is_simulated || p._filler) continue;
      for (const k of keys) if (p[k] !== undefined) return true;
    }
    return false;                       // no human row carries the columns
  }

  // ---- board assembly --------------------------------------------------------
  // Returns { rows, real, tab, pending, err }. `pending` means an async board is
  // still loading and the caller should re-render when `onReady` fires.
  function board(id, onReady, view) {
    const tab = BY_ID[id] || TABS[0];
    const LB = window.LEADERBOARD;
    const g = G();
    if (!LB || !g) return { rows: [], real: 0, tab, pending: false };

    // ASYNC LADDERS — their own tables, not the leaderboard row
    if (tab.async) {
      // A tab with VIEWS caches each view under its own key: they are different
      // questions against different tables and must never share a slot.
      const vId = (tab.views && view && view !== tab.views[0].id
        && tab.views.some((v) => v.id === view)) ? id + ':' + view : id;
      const hit = _cache[vId];
      if (!hit || Date.now() - hit.at >= TTL) {
        loadAsync(vId, () => { if (onReady) onReady(); });
        if (!hit) return { rows: [], real: 0, tab, view, pending: true };
      }
      const mine = myName();
      const rows = (hit ? hit.rows : []).map((p) => Object.assign({}, p, { isMe: p.name === mine }));
      rows.sort((a, b) => tab.metric(b) - tab.metric(a));
      rows.forEach((p, i) => { p.rank = i + 1; });
      return { rows, real: rows.length, tab, view, pending: false, err: hit && hit.err };
    }

    // LEADERBOARD LADDERS — the same pool the power board uses, re-sorted
    const data = LB.allTimeBoard(g);
    if (NEEDS_SQL[id]) {
      const m = migrated(data.board, id);
      // 'unknown' means no server read has landed yet — render as loading, not as
      // a missing migration, and re-render when the answer arrives.
      if (m === 'unknown') {
        try { if (window.CLOUD && window.CLOUD.lbTop) Promise.resolve(window.CLOUD.lbTop(100)).catch(() => {}).then(() => { if (onReady) onReady(); }); } catch (e) {}
        return { rows: [], real: 0, tab, pending: true };
      }
      if (!m) return { rows: [], real: 0, tab, pending: false, needsSql: true };
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
    q.cargo = (s.cargo && s.cargo.wins) | 0;
    q.cargo_best = Math.min(100, (s.cargo && s.cargo.best) | 0);
    // ART FIELDS — which hull, which core, which freighter. The Discord feed can
    // see COUNTS change but not what changed, so it could never show real game
    // art for the thing that just happened. These three name it.
    q.cargo_tier = Math.min(5, Math.max(0, (s.cargo && s.cargo.lastTier) | 0));
    q.hull_last = String((s.lastHull && s.lastHull.key) || '').slice(0, 32);
    // HOME DEFENSE + EXPLORATION — read live from the save, same as every other
    // figure on this row, so your own rank never lags the publish heartbeat.
    q.hcwave = (s.homecit && s.homecit.wave) | 0;
    q.expo = (s.expo && s.expo.log && s.expo.log.done) | 0;
    q.expo_best = (s.expo && s.expo.log && s.expo.log.best) | 0;
    // Nanocores read through the module so this row, the badge chains and the
    // Discord feed all quote one number.
    try {
      const f = (window.NANO && window.NANO.feedFields) ? window.NANO.feedFields() : null;
      q.nano_legend = f ? f.nano_legend | 0 : 0;
      q.nano_slots = f ? f.nano_slots | 0 : 0;
      q.nano_god = f ? f.nano_god | 0 : 0;
    } catch (e) { q.nano_legend = q.nano_slots = q.nano_god = 0; }
    q.badges = (() => {
      // Badges live in state.achieve.claimed (per-chain counts) — the old
      // badgeRanks/achClaimed fields never existed, so every real player
      // published 0 on this board. ACHIEVE.totalClaimed() is the same figure the
      // Missions screen shows; the inline sum is the no-module fallback.
      try { if (window.ACHIEVE && ACHIEVE.totalClaimed) return ACHIEVE.totalClaimed() | 0; } catch (e) {}
      try { const c = (s.achieve && s.achieve.claimed) || {}; let n = 0; for (const k in c) n += c[k] | 0; return Math.min(badgeTotal(), n); } catch (e) { return 0; }
    })();
    return q;
  }

  // A human row that has published the new columns uses them; one that hasn't
  // published since the migration reads 0 rather than a fabricated number.
  function fill(q) {
    q.tiles = q.tiles | 0; q.citadels = q.citadels | 0;
    q.tile_rev = Number(q.tile_rev) || 0;
    q.ships = q.ships | 0; q.missions = q.missions | 0; q.badges = q.badges | 0;
    q.cargo = q.cargo | 0; q.cargo_best = q.cargo_best | 0;
    q.cargo_tier = Math.min(5, Math.max(0, q.cargo_tier | 0));
    q.hull_last = String(q.hull_last || '').slice(0, 32);
    q.nano_last = String(q.nano_last || '').slice(0, 32);
    q.nano_legend = q.nano_legend | 0; q.nano_slots = Math.min(5, q.nano_slots | 0); q.nano_god = q.nano_god | 0;
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
      const out = {
        tiles: Object.keys(s.ownedSystems || {}).length,
        tile_rev: tileRevenue(),
        ships: Object.keys(s.ownedShips || {}).length || 1,
        missions: s.lifetimeMissions | 0,
        hcwave: (s.homecit && s.homecit.wave) | 0,
        expo: (s.expo && s.expo.log && s.expo.log.done) | 0,
        expo_best: (s.expo && s.expo.log && s.expo.log.best) | 0,
        cargo: (s.cargo && s.cargo.wins) | 0,
        cargo_best: Math.min(100, (s.cargo && s.cargo.best) | 0),
        cargo_tier: Math.min(5, Math.max(0, (s.cargo && s.cargo.lastTier) | 0)),
        hull_last: String((s.lastHull && s.lastHull.key) || '').slice(0, 32),
        badges: (() => {
      // Badges live in state.achieve.claimed (per-chain counts) — the old
      // badgeRanks/achClaimed fields never existed, so every real player
      // published 0 on this board. ACHIEVE.totalClaimed() is the same figure the
      // Missions screen shows; the inline sum is the no-module fallback.
      try { if (window.ACHIEVE && ACHIEVE.totalClaimed) return ACHIEVE.totalClaimed() | 0; } catch (e) {}
      try { const c = (s.achieve && s.achieve.claimed) || {}; let n = 0; for (const k in c) n += c[k] | 0; return Math.min(badgeTotal(), n); } catch (e) { return 0; }
    })(),
      };
      // NANOCORES — legendary-only figures (Legendary cores recovered, deepest
      // slot count on one of them, top-5% rolls), read through the module so the
      // Discord feed and the game can never disagree about what a pilot did.
      try { if (window.NANO && window.NANO.feedFields) Object.assign(out, window.NANO.feedFields()); } catch (e) {}
      return out;
    } catch (e) { return null; }
  }

  window.RANKBOARDS = { TABS, BY_ID, board, publishFields, tileRevenue };
})();
