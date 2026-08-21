/* =============================================================================
   expedition.js — FLEET EXPLORATION · the model
   ---------------------------------------------------------------------------
   Dispatch idle hulls on real-time exploration missions. They leave the hangar,
   they come back hours later with cargo, scars and experience. No combat sim,
   no engine time: the whole system is arithmetic over the trusted clock, so it
   runs identically whether the player watched or was asleep.

   FIVE DECISIONS THIS FILE MAKES, AND WHY
   ---------------------------------------------------------------------------
   1. NO NEW SHIP STAT. "Exploration" is DERIVED from hull config the game
      already ships — bays, ammo, plating, thrust, sensor range — so every hull
      in the hangar has a survey profile from the moment this feature exists and
      nothing has to be re-balanced or re-grinded. Three sub-stats, not one, or
      "which ships" collapses into "the biggest ships".
   2. THE FLAGSHIP NEVER LEAVES. The opportunity cost the brief asks for is real
      and legible: expeditions consume hulls you would otherwise fly with. The
      flagship is hard-blocked; escorts CAN go but are pulled out of the fleet
      formation when they launch, and the confirm sheet says so.
   3. THE OUTCOME IS SEALED AT LAUNCH. A seeded PRNG over (mission, launch time,
      fleet) rolls the grade, the event timeline and the rewards the instant the
      fleet departs, and stores them. Nothing is decided at collection, so there
      is nothing to reload-scum, and the progress bar can honestly reveal events
      as the clock passes them.
   4. FAILURE IS A BAD DAY, NOT A LOSS. A fleet that MEETS the requirement can
      never score below Partial Success, and ★/★★ missions cannot hard-fail at
      all. Damage is a timer, never a write-off, and it always repairs itself
      free given four hours.
   5. NO NEW CURRENCY. Rewards are gold, the three galaxy resources, ◇ Dread
      Cores and (rarely, from one event) LootCoins. Everything scales off the
      pilot's own zone depth, so the payout is worth collecting at Zone 3 and
      still worth collecting at Zone 900.

   window.EXPO — see the export block at the bottom.
============================================================================= */
(function () {
  'use strict';
  const G = () => window.GAME;
  const CFG = () => window.CONFIG;
  const now = () => { try { return window.SERVERTIME ? window.SERVERTIME.now() : Date.now(); } catch (e) { return Date.now(); } };

  const HOUR = 3600000;
  const WIN_MS = 4 * HOUR;        // the board rotates every four hours, on the boundary
  const REPAIR_MS = 4 * HOUR;     // full self-repair from 100% damage, free
  const MAX_SHIPS = 5;            // hulls per expedition
  const GATE_LV = 20;             // Command card unlock — sits with Shipworks

  // ---- seeded PRNG ----------------------------------------------------------
  // Every roll in this file comes from here. Nothing calls Math.random(), so a
  // board is the same board on every device and a sealed outcome is auditable.
  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // ===========================================================================
  // STATE
  // ===========================================================================
  // Kept deliberately small and flat — it is unioned in account.js mergeSaves()
  // and every field there has to be reasoned about one by one.
  function ex() {
    const st = G() && G().state; if (!st) return null;
    let e = st.expo;
    if (!e || typeof e !== 'object') e = st.expo = {};
    if (e.v !== 1) e.v = 1;
    if (!e.salt) e.salt = hash((st.pilotName || '') + '|' + (st.createdAt || 0) + '|' + (st.totalKills | 0)) || 12345;
    if (!Array.isArray(e.act)) e.act = [];
    if (!e.hulls || typeof e.hulls !== 'object') e.hulls = {};
    if (!e.taken || typeof e.taken !== 'object') e.taken = {};
    if (!e.log || typeof e.log !== 'object') e.log = { done: 0, best: 0 };
    return e;
  }
  function lvl() { try { return (G().state.level | 0) || 1; } catch (e) { return 1; } }
  function unlocked() { return lvl() >= GATE_LV; }
  // RESOURCE-ECONOMY SCALE. Same shape as the Home Citadel's zScale() so the two
  // passive systems stay on one curve. Drives the fuel bill, the resource payout
  // and emergency repairs — all of which move roughly linearly with depth.
  function econ() {
    try { return Math.max(1, Math.pow(Math.max(1, G().state.highestDungeonReached | 0, G().state.currentDungeon | 0), 1.12)); }
    catch (e) { return 1; }
  }
  function zone() {
    try { const st = G().state; return Math.max(1, st.highestDungeonReached | 0, st.currentDungeon | 0); } catch (e) { return 1; }
  }
  // GOLD IS A DIFFERENT CURVE ENTIRELY, and getting that wrong is what made the
  // first pass of this feature pay peanuts. Gold in LOOTFLEET is EXPONENTIAL in
  // zone — C.enemyGold() rides dungeonScale(), roughly 1.18^z — while econ()
  // above is only polynomial. A gold reward anchored to econ() therefore falls
  // exponentially further behind the pilot's real income with every zone pushed:
  // at Zone 62 an eleven-hour four-star paid about ten minutes of active farming.
  //
  // Expedition gold is priced in EQUIVALENT KILLS at the pilot's own depth. It
  // tracks the real economy at any zone with no re-tuning, and it states the
  // design rule plainly: an expedition is worth a FRACTION of playing.
  function killGold() {
    try { const g = CFG().enemyGold(zone()); if (isFinite(g) && g > 0) return g; } catch (e) {}
    return 6 * Math.pow(zone(), 1.4) + 3;
  }
  // Concurrent expedition slots. Two is enough to teach the loop; the rest are
  // a reason to keep levelling.
  function slots() { const L = lvl(); return 2 + (L >= 60 ? 1 : 0) + (L >= 120 ? 1 : 0) + (L >= 250 ? 1 : 0); }
  const SLOT_STEPS = [[60, 3], [120, 4], [250, 5]];
  function nextSlot() { const L = lvl(); for (const s of SLOT_STEPS) if (L < s[0]) return { lv: s[0], n: s[1] }; return null; }

  // ===========================================================================
  // SURVEY PROFILE — three derived stats, from hull config only
  // ===========================================================================
  //   ◎ SURVEY   sensors, labs, launch bays — what the hull can actually LOOK at
  //   ◈ RANGE    endurance and reach — how far out it can operate and return
  //   ⛨ RESOLVE  what happens when the survey goes wrong
  // Weights are chosen so the ladder runs Frigate ~33 → Voidmaw ~170, which is
  // what the accelerating requirement table in TIERS is calibrated against:
  // one starter hull clears ★, and ★★★★★ genuinely wants an endgame wing.
  function profile(key) {
    const sh = (CFG().SHIP_BY_KEY || {})[key];
    if (!sh) return { sv: 0, rg: 0, rs: 0, tot: 0 };
    const m = sh.mods || {};
    const sv = 6 + (sh.drones | 0) * 2.2 + (sh.ammo | 0) * 3 + (m.rangePct || 0) * 0.35 + (sh.fighterCapacity | 0) * 2;
    const rg = (6 + (sh.hull | 0) * 4 + (m.moveSpeed || 0) * 0.30 + (sh.weapons | 0) * 0.8) * (sh.speedMult || 1);
    const rs = 5 + (sh.weapons | 0) * 3.2 + (m.hpPct || 0) * 0.16 + (m.dmgPct || 0) * 0.14;
    return { sv, rg, rs, tot: sv + rg + rs };
  }
  // Hull investment counts: yard upgrades and expedition experience both lift a
  // hull's survey profile, so a well-worked Cruiser can out-explore a fresh
  // Battleship. Damage takes it back down without ever zeroing it.
  function hullMult(key) {
    const st = G().state;
    const up = Math.max(0, (((st.shipLevels || {})[key] | 0) || 1) - 1);
    return 1 + up * 0.06;
  }
  function rankOf(key) { const e = ex(); return e ? Math.max(0, Math.min(5, (e.hulls[key] || {}).rank | 0)) : 0; }
  const RANK_ROMAN = ['—', 'I', 'II', 'III', 'IV', 'V'];
  // Expedition XP needed to reach each rank. Roughly: 4 short runs to I, then a
  // real commitment for V.
  const RANK_XP = [0, 200, 700, 1900, 4400, 9000];
  function rankMult(key) { return 1 + rankOf(key) * 0.08; }

  // Live damage, decayed against the repair clock. Stored as {d, at}; read never
  // trusts the stored number alone, so a save that sat closed for a week comes
  // back with a healed hangar without needing a migration.
  // REPAIR IS A CONSTANT RATE, NOT A CONSTANT DURATION: REPAIR_MS buys 100% of
  // hull back, so 20% damage clears in ~48 minutes and 80% takes the full four
  // hours. (The first cut decayed by a FRACTION of REPAIR_MS regardless of how
  // bad the damage was, which made repairLeft() disagree with the number the
  // bar was drawing.)
  function damage(key) {
    const e = ex(); if (!e) return 0;
    const h = e.hulls[key]; if (!h || !(h.d > 0)) return 0;
    const el = Math.max(0, now() - (h.at || 0));
    const d = h.d - el / REPAIR_MS;
    return d > 0.005 ? d : 0;
  }
  function dmgMult(key) { return 1 - damage(key) * 0.6; }
  function repairLeft(key) {
    const e = ex(); if (!e) return 0;
    const h = e.hulls[key]; if (!h || !(h.d > 0)) return 0;
    return Math.max(0, (h.at || 0) + REPAIR_MS * h.d - now());
  }
  // Emergency repair — ore, scaled to the pilot's economy and the damage taken.
  function repairCost(key) {
    const d = damage(key); if (d <= 0) return null;
    return { iron: Math.max(50, Math.ceil(600 * econ() * d)) };
  }
  function repairNow(key) {
    const e = ex(), st = G().state; if (!e) return { ok: false };
    const c = repairCost(key); if (!c) return { ok: false, reason: 'clean' };
    const r = st.resources || (st.resources = { fuel: 0, iron: 0, plasma: 0 });
    if ((r.iron || 0) < c.iron) return { ok: false, reason: 'iron', cost: c };
    r.iron -= c.iron;
    if (e.hulls[key]) { e.hulls[key].d = 0; e.hulls[key].at = 0; }
    save();
    return { ok: true, cost: c };
  }

  // A hull's contribution to a mission, already weighted for that mission type.
  function contribution(key, type) {
    const p = profile(key), w = (type && type.w) || [1, 1, 1];
    const raw = p.sv * w[0] + p.rg * w[1] + p.rs * w[2];
    return raw * hullMult(key) * rankMult(key) * dmgMult(key);
  }
  function fleetRating(keys, type) {
    let t = 0; (keys || []).forEach((k) => { if (k) t += contribution(k, type); });
    return Math.round(t);
  }

  // ---- availability ---------------------------------------------------------
  // The flagship is the one hull that can never go. Everything else is a warning,
  // not a wall — see decision 2 at the top of the file.
  function busyMap() {
    const e = ex(), m = {}; if (!e) return m;
    e.act.forEach((a) => { if (!a.done) (a.ships || []).forEach((k) => { m[k] = a.id; }); });
    return m;
  }
  function available() {
    const st = G().state, busy = busyMap();
    const escorts = {}; (st.fleet || []).forEach((k) => { if (k) escorts[k] = 1; });
    return Object.keys(st.ownedShips || {})
      .filter((k) => st.ownedShips[k] && (CFG().SHIP_BY_KEY || {})[k])
      .map((k) => ({
        key: k,
        name: (CFG().SHIP_BY_KEY[k] || {}).name || k,
        p: profile(k), rank: rankOf(k), dmg: damage(k),
        runs: ((ex().hulls[k] || {}).runs | 0),
        flag: k === st.ship, escort: !!escorts[k], busy: busy[k] || null,
        wrecked: damage(k) >= 0.85,
      }))
      .sort((a, b) => (a.flag - b.flag) || (!!a.busy - !!b.busy) || (b.p.tot - a.p.tot));
  }
  function canAssign(s) { return !s.flag && !s.busy && !s.wrecked; }

  // ===========================================================================
  // THE BOARD
  // ===========================================================================
  const TYPES = [
    { k: 'deep',  n: 'Deep-Space Survey',         ic: '◎', w: [1.5, 1.0, 0.5], line: 'A corridor past the mapped rim. Nobody has put instruments on it.' },
    { k: 'plan',  n: 'Planetary Survey',          ic: '◍', w: [1.3, 0.7, 1.0], line: 'Full-spectrum sweep of an uncatalogued world and its moons.' },
    { k: 'anom',  n: 'Anomaly Investigation',     ic: '✵', w: [1.4, 0.6, 1.0], line: 'Something out there is bending its own light. Find out what.' },
    { k: 'arch',  n: 'Archaeological Expedition', ic: '⌘', w: [1.2, 0.8, 1.0], line: 'Structures on the third moon, older than the rim charts.' },
    { k: 'bio',   n: 'Biological Survey',         ic: '❦', w: [1.5, 0.8, 0.7], line: 'Living signatures where the temperature says there is nothing.' },
    { k: 'cart',  n: 'Cartographic Expedition',   ic: '⊞', w: [1.0, 1.6, 0.4], line: 'Fold a run of unsurveyed jump lanes into the fleet chart.' },
    { k: 'recon', n: 'Long-Range Reconnaissance', ic: '➤', w: [0.7, 1.5, 0.8], line: 'Run the far perimeter, log everything, come back quiet.' },
  ];
  const TYPE_BY_K = {}; TYPES.forEach((t) => { TYPE_BY_K[t.k] = t; });
  // ★ tiers. THE REQUIREMENT CURVE ACCELERATES HARD: +35, +55, +100, +220. Each
  // star asks for a bigger WING, not one more mid hull. Against the survey ladder
  // (Frigate 33 → Voidmaw 170, five hulls max):
  //   ★     one starter hull
  //   ★★    two early hulls
  //   ★★★   three mid hulls
  //   ★★★★  a four-hull mid wing
  //   ★★★★★ FIVE HULLS, and good ones. 350 is set from the measured ceiling of a
  //         real endgame roster (11 hulls, Titan flying as flagship, yard Lv 6):
  //         the best FOUR reach 320 and the best FIVE reach 384. So four hulls
  //         cannot clear it at any weighting and five can — which is the whole
  //         point of the tier. It was briefly 430; that turned out to be above
  //         even a five-hull wing unless the pilot owned Mothership or Voidmaw,
  //         which made the top of the board dead content rather than hard.
  const TIERS = [
    { s: 1, req: 20,  dur: [2, 4],   risk: 'Very Low' },
    { s: 2, req: 55,  dur: [3, 6],   risk: 'Low' },
    { s: 3, req: 110, dur: [4, 8],   risk: 'Moderate' },
    { s: 4, req: 210, dur: [8, 12],  risk: 'High' },
    { s: 5, req: 350, dur: [12, 24], risk: 'Very High' },
  ];
  // Per-slot star range. Slot 0 is always ★ so the board is never unplayable for
  // a pilot who just unlocked it; slot 5 is the wildcard.
  const SLOT_RANGE = [[1, 1], [1, 2], [2, 3], [3, 4], [4, 5], [2, 5]];
  const PLACES = ['Kepler Reach', 'Thessaly Drift', 'the Ockren Verge', 'Carrow Deep', 'the Halden Belt',
    'Vell Corridor', 'the Sable Expanse', 'Ninefold Gate', 'Orin Shelf', 'the Bright Wound',
    'Marrow Cluster', 'Ashfall Rift', 'the Quiet Lanes', 'Tabor Sink', 'Hollow Meridian', 'the Lantern Fields'];

  function windowIdx() { return Math.floor(now() / WIN_MS); }
  function windowEnds() { return (windowIdx() + 1) * WIN_MS; }
  // Bumped whenever the generator's OUTPUT changes (requirement curve, type
  // pool, duration bands). A board is cached in the save for its whole four-hour
  // window, so without this a build that re-tunes difficulty would leave live
  // players holding contracts priced by the previous build until rotation.
  const BOARD_V = 3;

  function buildBoard(win) {
    const e = ex(), out = [], usedType = {};
    for (let i = 0; i < 6; i++) {
      const r = mulberry(hash(e.salt + ':' + win + ':' + i));
      const rng = SLOT_RANGE[i];
      const stars = rng[0] + Math.floor(r() * (rng[1] - rng[0] + 1));
      const tier = TIERS[stars - 1];
      // SIX DISTINCT MISSION TYPES PER BOARD. Picking independently per slot put
      // two Biological Surveys and two Cartographic Expeditions on the same
      // board, which makes six contracts read as three. Walk to the next unused
      // type instead — there are seven, so this always terminates with a
      // distinct pick and stays deterministic in the seed.
      let ti = Math.floor(r() * TYPES.length);
      for (let g = 0; g < TYPES.length && usedType[TYPES[ti].k]; g++) ti = (ti + 1) % TYPES.length;
      const type = TYPES[ti];
      usedType[type.k] = 1;
      const hours = Math.round((tier.dur[0] + r() * (tier.dur[1] - tier.dur[0])) * 2) / 2;
      out.push({
        id: win + '-' + i,
        t: type.k, stars, req: tier.req, hours,
        place: PLACES[Math.floor(r() * PLACES.length)],
        // reward jitter, sealed with the board so the card never lies
        j: 0.85 + r() * 0.3,
      });
    }
    return out;
  }
  function board() {
    const e = ex(); if (!e) return [];
    const win = windowIdx();
    if (!e.board || e.board.w !== win || e.board.bv !== BOARD_V) {
      e.board = { w: win, bv: BOARD_V, m: buildBoard(win) };
      // taken-ids belong to a window; drop the previous window's marks with it
      e.taken = {};
    }
    return e.board.m.filter((m) => !e.taken[m.id]);
  }
  function missionById(id) { const e = ex(); if (!e || !e.board) return null; return e.board.m.filter((m) => m.id === id)[0] || null; }

  // ---- costs and payouts ----------------------------------------------------
  // Ship count is deliberately SUB-LINEAR (+55% per extra hull, not +100%): a
  // bigger wing should cost more without making the biggest wing unaffordable,
  // because the wing size is already paid for in grounded hulls. Scaled by econ()
  // so the bill still bites at depth — a flat cost is free money by Zone 60 and
  // the whole "is this trip worth it" decision quietly disappears.
  function fuelCost(m, n) {
    if (!m || !n) return 0;
    return Math.max(5, Math.round(30 * (1 + (n - 1) * 0.55) * (m.hours / 4) * (1 + 0.5 * (m.stars - 1)) * econ()));
  }
  // The advertised reward, at Complete Success. Everything below that grade is
  // this table times the grade multiplier — so the card is a ceiling, not a lie.
  //
  // THE PAYOUT IS A PROPERTY OF THE MISSION, NOT OF THE WING. Anchoring it to a
  // one-hull cost is what makes the brief's core tension real: extra hulls buy
  // reliability and nothing else, while costing fuel and grounding escorts. If
  // rewards scaled with ship count instead, "send everything, every time" would
  // be the only correct play and the assignment screen would have no decision on
  // it at all.
  //
  // RESOURCES are priced off the ONE-HULL fuel bill, so the multiplier has to
  // clear the FIVE-hull bill or a max wing quietly runs the pilot dry — exactly
  // the wing the five-star tier now demands. A five-hull launch costs 3.2× the
  // one-hull bill, so the fuel share alone (half the pot) sits at 3.8× to 5.0×
  // it. Net: a solo survey is very fuel-efficient, a full wing barely breaks
  // even on fuel and is paid in ore, plasma, gold and cores instead. That is the
  // intended price of reliability.
  //
  // GOLD is equivalent-kills × the pilot's own per-kill gold (see killGold). KPH
  // is what one expedition hour is worth in kills, against roughly 14,000/hour of
  // active play. Gold is intentionally the minor half of the payout — see
  // GOLD_KPH_BASE below — and the resource haul is what makes a run worth the
  // grounded hulls. Passive should be worth collecting and never worth more
  // than the game.
  // ONE KNOB, DELIBERATELY. Expedition gold = (kills-worth per hour) x hours x
  // this pilot's gold-per-kill at their own depth. Tuning the whole economy is
  // these two numbers and nothing else.
  //
  // CUT 12x IN BUILD 685. The first pass set the base at 1200 kills/hour on the
  // theory that an expedition hour should be a visible fraction of an active
  // hour. That estimate of an active hour was far too low, so the "fraction"
  // came out a multiple: at Zone 305 a five-star full-day run paid ~1.8 TRILLION
  // gold for five grounded hulls and no attention — roughly a top-tier hull per
  // day, which made passive income the main faucet in the game and active play
  // the slow route. Gold is now the SMALL half of an expedition payout and the
  // resources are the reason to run one.
  const GOLD_KPH_BASE = 100;   // kills-worth of gold per hour at ★
  const GOLD_KPH_STAR = 0.9;   // added per star above ★ (★★★★★ = 4.6x base)
  // DEPTH TAPER — the part the 12x cut in 685 did not fix.
  //
  // Pricing gold in "equivalent kills" tracks active income perfectly, and that
  // is exactly the problem at depth: kill gold is EXPONENTIAL in zone while the
  // things gold buys are FIXED CONSTANTS (Dread Omega 50B, Titan Sina ~5T). So
  // any pure kills anchor eventually pays a hull per run no matter how small the
  // multiplier — even after 685, Zone 305 five-star still cleared a Dread Omega
  // and a half in one launch. Scaling the whole formula down again would just
  // move which zone that happens at.
  //
  // Raising the per-kill anchor to a fractional power bends the faucet toward
  // the fixed price ladder instead: at Zone 8 it changes almost nothing (16 ->
  // 10.6 gold/kill), by Zone 305 it is 11x smaller, and it keeps flattening. The
  // same shape dungeonScale() already uses on itself past Zone 100.
  const GOLD_TAPER = 0.85;
  function payout(m) {
    const j = m.j || 1;
    const kph = GOLD_KPH_BASE * (1 + GOLD_KPH_STAR * (m.stars - 1));
    const res = Math.round(fuelCost(m, 1) * (7.0 + 0.6 * m.stars) * j);
    const p = {
      gold: Math.round(Math.pow(killGold(), GOLD_TAPER) * kph * m.hours * j),
      fuel: Math.round(res * 0.5), iron: Math.round(res * 0.3), plasma: Math.round(res * 0.2),
      cores: 0, lc: 0,
    };
    if (m.stars >= 3) p.cores = Math.max(1, Math.min(12, Math.round((m.stars - 2) * (m.hours / 5) * j)));
    return p;
  }

  // ---- the estimate the player acts on --------------------------------------
  const BANDS = [
    { at: 0.80, k: 'critical', t: 'Critical',  c: '#ff6b7a' },
    { at: 1.00, k: 'risky',    t: 'Risky',     c: '#ff9a4d' },
    { at: 1.20, k: 'uncertain',t: 'Uncertain', c: '#e6c765' },
    { at: 1.50, k: 'good',     t: 'Favorable', c: '#6fe0a0' },
    { at: 99,   k: 'assured',  t: 'Assured',   c: '#5bc0ff' },
  ];
  function estimate(rating, req) {
    const ratio = req > 0 ? rating / req : 0;
    for (const b of BANDS) if (ratio < b.at) return { ratio, ...b };
    return { ratio, ...BANDS[BANDS.length - 1] };
  }
  const OVERKILL = 2.2;   // above this the confirm sheet says the wing is wasted here

  // ===========================================================================
  // EVENTS
  // ===========================================================================
  // `good`: 0 costs you something · 1 pays · 2 is the rare one worth a mail.
  const EVENTS = [
    { k: 'signal',  ic: '≋', good: 1, t: 'Unknown signal detected',      b: 'A repeating carrier wave, source unresolved. The science bay logged forty minutes of it.', mod: { gold: 0.15 } },
    { k: 'hostile', ic: '⚔', good: 0, t: 'Hostile encounter',            b: 'Unflagged raiders shadowed the survey line. The wing broke contact and pressed on.',        mod: { dmg: 0.09, gold: -0.10 } },
    { k: 'world',   ic: '◍', good: 1, t: 'Valuable planetary discovery', b: 'A shirtsleeve world with a intact biosphere, sitting unclaimed on no chart.',                mod: { res: 0.25, gold: 0.1 } },
    { k: 'navanom', ic: '✵', good: 0, t: 'Navigation anomaly',           b: 'The lane folded wrong. Six hours of survey time went into re-fixing position.',              mod: { gold: -0.14, res: -0.1 } },
    { k: 'breach',  ic: '⚠', good: 0, t: 'Hull breach',                  b: 'Micrometeorite swarm, unmapped. Pressure held, but the plating did not.',                    mod: { dmg: 0.13 } },
    { k: 'deposit', ic: '◆', good: 1, t: 'Rare resource deposit',        b: 'A metal-rich shard field, dense enough to strip on the way home.',                           mod: { res: 0.42 } },
    { k: 'ruins',   ic: '⌘', good: 1, t: 'Alien ruins discovered',       b: 'Cut stone and a power signature that has been running unattended for a very long time.',     mod: { gold: 0.35, cores: 1 } },
    { k: 'life',    ic: '❦', good: 1, t: 'Unusual lifeform encountered', b: 'It followed the fleet for two jumps, then lost interest. Nothing in the catalogue matches.',  mod: { gold: 0.2 } },
    { k: 'cache',   ic: '✦', good: 2, t: 'Exceptional find',             b: 'An intact prospector cache, sealed and abandoned. The manifest alone paid for the trip.',     mod: { lc: 1, gold: 0.3 } },
  ];
  const EV_BAD = EVENTS.filter((e) => e.good === 0);
  const EV_GOOD = EVENTS.filter((e) => e.good === 1);
  const EV_CACHE = EVENTS.filter((e) => e.good === 2)[0];

  // ===========================================================================
  // LAUNCH — the whole expedition is decided here and written down
  // ===========================================================================
  function launch(missionId, ships) {
    const e = ex(), st = G().state;
    if (!e) return { ok: false, reason: 'state' };
    if (!unlocked()) return { ok: false, reason: 'locked' };
    const m = missionById(missionId);
    if (!m || e.taken[m.id]) return { ok: false, reason: 'gone' };
    const active = e.act.filter((a) => !a.done);
    if (active.length >= slots()) return { ok: false, reason: 'slots' };

    // sanitise the fleet — unique, owned, assignable, capped
    const busy = busyMap(), seen = {};
    const keys = (ships || []).filter((k) => k && !seen[k] && (seen[k] = 1)
      && (st.ownedShips || {})[k] && (CFG().SHIP_BY_KEY || {})[k]
      && k !== st.ship && !busy[k] && damage(k) < 0.85).slice(0, MAX_SHIPS);
    if (!keys.length) return { ok: false, reason: 'nofleet' };

    const type = TYPE_BY_K[m.t];
    const cost = fuelCost(m, keys.length);
    const res = st.resources || (st.resources = { fuel: 0, iron: 0, plasma: 0 });
    if ((res.fuel || 0) < cost) return { ok: false, reason: 'fuel', cost };

    const rating = fleetRating(keys, type);
    const t0 = now(), t1 = t0 + m.hours * HOUR;
    const seed = hash(e.salt + '|' + m.id + '|' + t0 + '|' + keys.join(','));
    const out = resolve(m, keys, rating, seed);

    res.fuel -= cost;
    // escorts that shipped out leave the battle formation — stated on the sheet
    let pulled = [];
    if (Array.isArray(st.fleet)) {
      st.fleet = st.fleet.map((k) => { if (k && keys.indexOf(k) !== -1) { pulled.push(k); return null; } return k; });
    }

    e.taken[m.id] = 1;
    e.act.push({
      id: 'x' + t0.toString(36) + '-' + (e.act.length),
      mid: m.id, t: m.t, name: type.n, ic: type.ic, place: m.place,
      stars: m.stars, req: m.req, hours: m.hours,
      t0, t1, ships: keys, rating, fuel: cost,
      ev: out.ev, out: out.out, done: 0, mailed: 0, pulled,
    });
    save();
    try { if (window.GAME && GAME.refreshStats) GAME.refreshStats(); } catch (er) {}
    return { ok: true, cost, pulled, rating, eta: t1 };
  }

  // The sealed roll. Deterministic in `seed` alone.
  function resolve(m, keys, rating, seed) {
    const r = mulberry(seed);
    const ratio = m.req > 0 ? rating / m.req : 1;
    // grade — jittered ratio against fixed bands, then floored for fairness
    const eff = ratio + (r() - 0.5) * 0.25;
    let gi = eff >= 1.35 ? 0 : eff >= 1.05 ? 1 : eff >= 0.80 ? 2 : 3;
    if (ratio >= 1 && gi > 1) gi = 1;          // met the requirement — never worse than Partial
    if (m.stars <= 2 && gi > 2) gi = 2;        // early missions cannot hard-fail
    const GRADES = [
      { k: 'full',  t: 'Complete Success', c: '#6fe0a0', mult: 1.00, dmg: [0, 0] },
      { k: 'part',  t: 'Partial Success',  c: '#8fd0ff', mult: 0.62, dmg: [0.04, 0.12] },
      { k: 'comp',  t: 'Complication',     c: '#e6c765', mult: 0.45, dmg: [0.12, 0.26] },
      { k: 'fail',  t: 'Failure',          c: '#ff6b7a', mult: 0.12, dmg: [0.24, 0.44] },
    ];
    const g = GRADES[gi];

    // ---- event timeline. A stronger fleet meets fewer problems: that is what
    // over-committing actually buys, and it is the honest counterweight to the
    // overkill warning on the confirm sheet.
    const nEv = 1 + (m.stars >= 3 ? 1 : 0) + (r() < 0.45 ? 1 : 0);
    const badChance = Math.max(0.05, Math.min(0.75, 0.55 - (ratio - 1) * 0.45));
    const ev = [];
    const used = {};
    for (let i = 0; i < nEv; i++) {
      let pool;
      if (r() < 0.02 * m.stars && ratio >= 1) pool = [EV_CACHE];
      else pool = (r() < badChance) ? EV_BAD : EV_GOOD;
      let pick = pool[Math.floor(r() * pool.length)];
      if (used[pick.k] && pool.length > 1) pick = pool[(pool.indexOf(pick) + 1) % pool.length];
      used[pick.k] = 1;
      ev.push({ k: pick.k, at: 0.15 + (i + r() * 0.6) / (nEv + 0.4) * 0.75 });
    }
    ev.sort((a, b) => a.at - b.at);

    // ---- rewards: advertised table × grade × event modifiers
    const base = payout(m);
    let mg = g.mult, mr = g.mult, cores = 0, lc = 0;
    ev.forEach((x) => {
      const d = EVENTS.filter((q) => q.k === x.k)[0]; if (!d) return;
      if (d.mod.gold) mg += d.mod.gold * g.mult;
      if (d.mod.res) mr += d.mod.res * g.mult;
      if (d.mod.cores) cores += d.mod.cores;
      if (d.mod.lc) lc += Math.round((20 + 26 * m.stars) * (0.8 + r() * 0.6));
    });
    mg = Math.max(0, mg); mr = Math.max(0, mr);
    const rewards = {
      gold:   Math.max(0, Math.round(base.gold * mg)),
      fuel:   Math.max(0, Math.round(base.fuel * mr)),
      iron:   Math.max(0, Math.round(base.iron * mr)),
      plasma: Math.max(0, Math.round(base.plasma * mr)),
      cores:  Math.max(0, Math.round(base.cores * g.mult) + (gi <= 1 ? cores : 0)),
      lc:     gi <= 1 ? lc : 0,
    };

    // ---- damage, spread over a subset of the wing
    const dmg = {};
    let dTot = g.dmg[0] + r() * (g.dmg[1] - g.dmg[0]);
    ev.forEach((x) => { const d = EVENTS.filter((q) => q.k === x.k)[0]; if (d && d.mod.dmg) dTot += d.mod.dmg; });
    if (dTot > 0.005) {
      const hit = Math.max(1, Math.round(keys.length * (0.4 + r() * 0.6)));
      const order = keys.slice().sort(() => r() - 0.5);
      for (let i = 0; i < hit; i++) dmg[order[i]] = Math.min(0.8, Math.round(dTot * (0.6 + r() * 0.8) * 100) / 100);
    }

    // ---- expedition XP, per hull
    const xpEach = Math.round(m.req * m.hours * 0.55 * g.mult);
    const xp = {}; keys.forEach((k) => { xp[k] = xpEach; });

    return { ev, out: { g: g.k, t: g.t, c: g.c, mult: g.mult, rewards, dmg, xp } };
  }

  // ===========================================================================
  // PROGRESS + COLLECTION
  // ===========================================================================
  function progress(a) {
    const span = Math.max(1, a.t1 - a.t0);
    return Math.max(0, Math.min(1, (now() - a.t0) / span));
  }
  function returned(a) { return now() >= a.t1; }
  function active() { const e = ex(); return e ? e.act.filter((a) => !a.done) : []; }
  function ready() { return active().filter(returned); }
  function badge() { return unlocked() ? ready().length : 0; }
  // Events the clock has already passed — what the active card is allowed to show.
  function revealed(a) {
    const p = progress(a);
    return (a.ev || []).filter((x) => x.at <= p).map((x) => {
      const d = EVENTS.filter((q) => q.k === x.k)[0] || {};
      return { ...d, at: x.at, when: a.t0 + (a.t1 - a.t0) * x.at };
    });
  }
  function eventsOf(a) {
    return (a.ev || []).map((x) => {
      const d = EVENTS.filter((q) => q.k === x.k)[0] || {};
      return { ...d, at: x.at, when: a.t0 + (a.t1 - a.t0) * x.at };
    });
  }
  function byId(id) { const e = ex(); return e ? e.act.filter((a) => a.id === id)[0] || null : null; }

  // ESCORTS COME HOME TO THEIR SLOT.
  //
  // launch() pulls a hull out of the battle formation when it ships out, and
  // nothing ever put it back — the slot stayed empty after the fleet landed, so
  // running expeditions quietly and permanently dismantled the player's combat
  // formation one hull at a time. Worse, it was invisible: nothing on the
  // Expedition screen mentions the fleet, so the loss showed up as "my ship
  // score keeps dropping" with no cause attached.
  //
  // Restored into a FREE slot only, never over the top of a hull the player
  // has since slotted themselves — their later choice outranks our bookkeeping.
  function restoreEscorts(a) {
    const st = G().state;
    if (!a || !Array.isArray(a.pulled) || !a.pulled.length || !Array.isArray(st.fleet)) return 0;
    const owned = st.ownedShips || {};
    let n = 0;
    a.pulled.forEach((k) => {
      if (!k || !owned[k] || st.fleet.indexOf(k) !== -1) return;
      const slot = st.fleet.indexOf(null);
      if (slot >= 0) { st.fleet[slot] = k; n++; }
    });
    a.pulled = [];
    return n;
  }

  function collect(id) {
    const e = ex(), st = G().state; if (!e) return { ok: false };
    const a = byId(id);
    if (!a || a.done) return { ok: false, reason: 'gone' };
    if (!returned(a)) return { ok: false, reason: 'early' };
    a.done = 1;

    const R = a.out.rewards || {};
    const res = st.resources || (st.resources = { fuel: 0, iron: 0, plasma: 0 });
    let goldMul = 1; try { if (window.VIP && window.VIP.mult) goldMul = window.VIP.mult('gold') || 1; } catch (er) {}
    const paid = {
      gold: Math.round((R.gold || 0) * goldMul),
      // RESOURCE PAYOUTS PASS int32 AT DEPTH. econ() scales the whole bill with
      // zone, so a deep ★★★★★ haul clears 2.1 billion easily — and `| 0` would
      // wrap it NEGATIVE, subtracting resources as the reward for a clean run.
      // Cores and LootCoins are small, but they use the same form so nobody has
      // to work out which of these five is the dangerous one.
      fuel: Math.floor(Number(R.fuel) || 0), iron: Math.floor(Number(R.iron) || 0), plasma: Math.floor(Number(R.plasma) || 0),
      cores: Math.floor(Number(R.cores) || 0), lc: Math.floor(Number(R.lc) || 0),
    };
    st.gold = (st.gold || 0) + paid.gold;
    res.fuel = (res.fuel || 0) + paid.fuel;
    res.iron = (res.iron || 0) + paid.iron;
    res.plasma = (res.plasma || 0) + paid.plasma;
    if (paid.cores) st.dreadCores = (st.dreadCores || 0) + paid.cores;
    if (paid.lc) st.credits = (st.credits || 0) + paid.lc;

    // ---- damage + experience land on the hulls. A hull sold, ascended away or
    // otherwise missing since launch is skipped rather than resurrected.
    const owned = st.ownedShips || {};
    const ranked = [];
    (a.ships || []).forEach((k) => {
      if (!owned[k]) return;
      const h = e.hulls[k] || (e.hulls[k] = { xp: 0, rank: 0, runs: 0, d: 0, at: 0 });
      h.runs = (h.runs | 0) + 1;
      const gain = (a.out.xp || {})[k] | 0;
      h.xp = (h.xp | 0) + gain;
      const before = h.rank | 0;
      let rk = 0; for (let i = 5; i >= 1; i--) { if (h.xp >= RANK_XP[i]) { rk = i; break; } }
      h.rank = Math.max(before, rk);
      if (h.rank > before) ranked.push({ key: k, rank: h.rank });
      const d = (a.out.dmg || {})[k] || 0;
      if (d > 0) {
        // stack onto whatever is still unrepaired, and restart the repair clock
        const cur = damage(k);
        h.d = Math.min(0.9, cur + d); h.at = now();
      }
    });

    e.log.done = (e.log.done | 0) + 1;
    e.log.best = Math.max(e.log.best | 0, a.rating | 0);
    const backHome = restoreEscorts(a);
    // keep the ledger short — the debrief for a collected run is history, not state
    e.act = e.act.filter((x) => !x.done).concat(e.act.filter((x) => x.done).slice(-6));
    save();
    try { if (window.UI) window.UI.refreshAll(); } catch (er) {}
    return { ok: true, paid, ranked, a, escorts: backHome };
  }

  // Recall — abandon a running expedition. Half the fuel back, no rewards, no
  // damage. There has to be a way out of a mistake that is not a 24-hour wait.
  function recall(id) {
    const e = ex(), st = G().state; if (!e) return { ok: false };
    const a = byId(id); if (!a || a.done) return { ok: false, reason: 'gone' };
    if (returned(a)) return { ok: false, reason: 'landed' };
    a.done = 1; a.recalled = 1;
    // the launch bill itself passes int32 at depth — see the payout note above
    const back = Math.floor((Number(a.fuel) || 0) / 2);
    const escorts = restoreEscorts(a);
    const res = st.resources || (st.resources = { fuel: 0, iron: 0, plasma: 0 });
    res.fuel = (res.fuel || 0) + back;
    e.act = e.act.filter((x) => !x.done).concat(e.act.filter((x) => x.done).slice(-6));
    save();
    return { ok: true, back, escorts };
  }

  // ===========================================================================
  // TICK — mail, badges, board rotation. Safe to call as often as you like.
  // ===========================================================================
  let _tickT = 0;
  function tick() {
    const e = ex(); if (!e || !unlocked()) return;
    board();                                  // rotates the window if it has turned
    let dirty = false;
    e.act.forEach((a) => {
      if (a.done || a.mailed || !returned(a)) return;
      a.mailed = 1; dirty = true;
      try { mailReturn(a); } catch (er) {}
    });
    if (dirty) save();
  }
  function mailReturn(a) {
    if (!window.MAIL || !window.MAIL.push) return;
    const R = a.out.rewards || {};
    const bits = [];
    if (R.gold) bits.push('$' + fmt(R.gold));
    if (R.fuel) bits.push('⬢' + fmt(R.fuel));
    if (R.iron) bits.push('◆' + fmt(R.iron));
    if (R.plasma) bits.push('✦' + fmt(R.plasma));
    if (R.cores) bits.push('◇' + fmt(R.cores));
    if (R.lc) bits.push('◈' + fmt(R.lc) + ' LootCoins');
    const cache = (a.ev || []).some((x) => x.k === 'cache');
    window.MAIL.push({
      ic: a.ic || '◎',
      title: (cache ? 'Exceptional find — ' : 'Fleet returned — ') + a.name,
      body: 'The wing is back from <b>' + esc(a.place) + '</b>. Outcome: <b style="color:' + a.out.c + '">' + a.out.t + '</b>.'
        + (bits.length ? '<br>Cargo awaiting debrief: ' + bits.join(' · ') : '<br>Nothing worth logging came home.')
        + '<br><i>Collect it in Command ▸ Fleet Exploration.</i>',
      meta: { kind: 'expo', id: a.id },
    });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }
  function fmt(n) { try { return G().formatNum(Math.floor(n)); } catch (e) { return String(Math.floor(n || 0)); } }
  function save() { try { G().save(); } catch (e) {} }

  // background heartbeat — mail and the Command badge must land without the
  // screen ever being opened
  setInterval(() => { if (document.hidden) return; try { tick(); } catch (e) {} }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { try { tick(); } catch (e) {} } });
  // BOOT TICK. The heartbeat above first fires 30s in, which is 30 seconds of a
  // returning player staring at a Command menu that does not yet know their
  // fleet landed six hours ago. Poll for GAME coming up, tick once, stop.
  (function boot() {
    let n = 0;
    const t = setInterval(() => {
      n++;
      try { if (G() && G().state) { tick(); clearInterval(t); return; } } catch (e) {}
      if (n > 60) clearInterval(t);
    }, 500);
  })();

  // ---- DEV: ?expodev lets QA land a running expedition immediately. Gated on
  // the URL exactly like ?fitaudit; ships inert.
  function devLand(id) {
    try {
      if (location.search.indexOf('expodev') === -1) return false;
      const a = id ? byId(id) : active()[0]; if (!a) return false;
      const span = a.t1 - a.t0; a.t1 = now() - 1000; a.t0 = a.t1 - span;
      save(); tick(); return true;
    } catch (e) { return false; }
  }

  window.EXPO = {
    GATE_LV, MAX_SHIPS, TYPES, TYPE_BY_K, TIERS, EVENTS, RANK_XP, RANK_ROMAN, OVERKILL, HOUR, REPAIR_MS,
    ex, unlocked, lvl, econ, slots, nextSlot,
    profile, contribution, fleetRating, hullMult, rankOf, rankMult, damage, dmgMult, repairLeft, repairCost, repairNow,
    available, canAssign, busyMap,
    board, missionById, windowEnds, fuelCost, payout, estimate,
    launch, collect, recall, active, ready, badge, byId, progress, returned, revealed, eventsOf,
    tick, fmt, esc, devLand,
    // QA hook: the sealed roll is a pure function of its seed, so the harness
    // can hammer it for determinism and fairness-floor regressions.
    __resolve: resolve,
  };
})();
