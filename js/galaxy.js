/* =============================================================================
   galaxy.js — Loot Fleet · THE GALAXY (one massive unified hex grid)
   ---------------------------------------------------------------------------
   A single strategic hex map expanding outward in rings from a neutral HOME
   CITADEL at the exact center (unconquerable — every player's safe harbor).
   ~25 rings ≈ 1,950 conquerable tiles. Each ring is a level band; deeper rings
   mean stronger enemies, better loot, richer output. Tiles are deterministic
   per coordinate (seeded), so the map is identical across sessions/players.

   Tile types: combat · resource · boss · CITADEL SIEGE ZONE (rare, 100× output,
   24h siege lockout). Rings ≥ DEEP_RING are deep space (25× resources, 10×
   loot, 20× density, lose 2 items on death).

   Pure data + math; ownership lives in game state. Exposes window.GALAXYMAP.
   ============================================================================= */
(function () {
  'use strict';

  const RES = {
    fuel:   { key: 'fuel',   name: 'Fuel',   color: '#5bc0ff', glyph: '⬢' },
    iron:   { key: 'iron',   name: 'Iron',   color: '#d0a060', glyph: '◆' },
    plasma: { key: 'plasma', name: 'Plasma', color: '#c07bff', glyph: '✦' },
  };
  const RES_KEYS = ['fuel', 'iron', 'plasma'];

  const RINGS = 25;                 // conquerable rings beyond the center
  const DEEP_RING = 18;             // rings ≥ this are deep space
  const DEEP_MULT = { density: 20, rate: 3, loot: 10, resource: 25 };
  const CITADEL_RATE_MULT = 1000;  // a citadel pays 1000× a normal tile
  const CITADEL_COST_MULT = 100;   // …but costs 100× to warp into
  const TILE_VALUE_MULT = 50;      // global ×50 economy pass on every tile's yield

  // Ring → recommended level (spec curve for 1..8, then +20/ring, capped 500)
  const RING_LEVELS = [0, 10, 25, 30, 45, 50, 100, 125, 130];
  function ringLevel(ring) {
    if (ring <= 0) return 0;
    if (ring < RING_LEVELS.length) return RING_LEVELS[ring];
    return Math.min(500, 130 + (ring - 8) * 20);
  }
  // Combat-zone difficulty for a ring (maps level band onto zone numbers)
  function ringDiff(ring) { return Math.max(1, Math.round(ringLevel(Math.max(1, ring)) * 0.95)); }

  // ---- axial hex math -------------------------------------------------------
  function tileId(q, r) { return q + ',' + r; }
  function parseId(id) {
    const m = /^(-?\d+),(-?\d+)$/.exec(id);
    return m ? { q: +m[1], r: +m[2] } : null;
  }
  function ringOf(q, r) { return Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)); }
  const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  function neighbors(q, r) { return DIRS.map((d) => ({ q: q + d[0], r: r + d[1] })); }
  // all coords of a given ring (ring 0 = [center])
  function ringCoords(ring) {
    if (ring === 0) return [{ q: 0, r: 0 }];
    const out = [];
    let q = DIRS[4][0] * ring, r = DIRS[4][1] * ring;   // start at corner
    for (let side = 0; side < 6; side++) {
      for (let i = 0; i < ring; i++) { out.push({ q, r }); q += DIRS[side][0]; r += DIRS[side][1]; }
    }
    return out;
  }
  // axial → pixel (pointy-top)
  function pixel(q, r, size) { return { x: size * Math.sqrt(3) * (q + r / 2), y: size * 1.5 * r }; }
  // pixel → axial (pointy-top), rounded to nearest hex
  function unpixel(x, y, size) {
    const qf = (Math.sqrt(3) / 3 * x - 1 / 3 * y) / size;
    const rf = (2 / 3 * y) / size;
    let q = Math.round(qf), r = Math.round(rf), s = Math.round(-qf - rf);
    const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - (-qf - rf));
    if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
    return { q, r };
  }

  // ---- seeded RNG (mulberry32) ----------------------------------------------
  function rngFor(seed) {
    let a = seed >>> 0;
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  const PRE = ['Vel', 'Kor', 'Zar', 'Tyr', 'Aql', 'Nyx', 'Pyr', 'Sol', 'Dra', 'Cir', 'Vex', 'Hal', 'Oss', 'Rho', 'Vyn', 'Tau', 'Mor', 'Cyg', 'Lyr', 'Ark'];
  const MID = ['a', 'e', 'i', 'o', 'an', 'or', 'en', 'is', 'ux', 'ar'];
  const SUF = ['Prime', 'Reach', 'Expanse', 'Gate', 'Verge', 'Drift', 'Hollow', 'Spire', 'Nexus', 'Crown', 'Deep', 'Rift', 'Vault', 'Forge', 'Cradle', 'Sprawl'];
  const GREEK = ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ'];
  function genName(rnd) {
    const a = PRE[(rnd() * PRE.length) | 0], b = MID[(rnd() * MID.length) | 0];
    return rnd() < 0.5
      ? `${a}${b} ${SUF[(rnd() * SUF.length) | 0]}`
      : `${a}${b} ${GREEK[(rnd() * GREEK.length) | 0]}-${1 + ((rnd() * 9) | 0)}`;
  }

  // Per-tile resource yield per hour (before deep ×25 / citadel ×1000 / rarity),
  // then the global ×50 value pass is applied at the end of tileAt().
  function baseRate(ring, resKey) {
    const base = 8 + ring * 6;
    const mult = resKey === 'fuel' ? 1 : resKey === 'iron' ? 0.85 : 0.7;
    return Math.max(3, Math.round(base * mult));
  }

  // ---- THE KAEVITH INCURSION -------------------------------------------------
  // A galaxy-wide EVENT layer sitting on top of the map: ~20% of conquerable
  // tiles are held by an alien fleet. Rolled from its OWN seeded stream (never
  // the tile's, so no existing name / type / rate / rarity shifts), which makes
  // the invasion identical for every account without a single server round-trip.
  // Ownership, citadels and cooldowns are untouched — only what defends the
  // tile, and what clearing it can drop.
  const XEN = {
    name: 'The Kaevith', event: 'THE KAEVITH INCURSION', seed: 0x4b41ff,
    share: 0.20, color: '#c26bff', deepColor: '#7a2ac4',
    hpMod: 1.35, dmgMod: 1.22,          // slightly above the zone's normal garrison
    // PER-CLEAR ODDS OF RECOVERING A HULL, ring 1 → rim. History: 1%/10% at launch,
    // cut 5× to 0.2%/2% in Aug 2026 because hulls stopped reading as event prizes.
    // That overshot — at 0.2% a realistic pilot fighting the inner rings could
    // clear invaded zones for weeks and see nothing. Now 0.8%/5%, and the drought
    // itself does the work: game-v93's dry-streak escalator raises the effective
    // rate on every clear that misses (see xenChanceNow), so a first clear is
    // still a long shot while a long drought cannot stay unrewarded.
    minChance: 0.008, maxChance: 0.05,
  };
  function isInvaded(q, r) {
    const ring = ringOf(q, r);
    if (ring <= 0 || ring > RINGS) return false;
    return rngFor(((q * 0x27d4eb2d) ^ (r * 0x165667b1) ^ XEN.seed) >>> 0)() < XEN.share;
  }
  // Recovery odds for clearing an invaded tile: 0.8% on ring 1 → 5% at the rim,
  // before the dry-streak escalator. The curve is sqrt-shaped, not linear: over
  // RINGS rings a linear ramp left almost every real player parked near the floor,
  // which read as broken. Square-rooting climbs fast out of the low rings and
  // still lands exactly on the two endpoints.
  function alienChance(ring) {
    const f = RINGS > 1 ? Math.min(1, Math.max(0, (ring - 1) / (RINGS - 1))) : 1;
    return XEN.minChance + (XEN.maxChance - XEN.minChance) * Math.sqrt(f);
  }

  // ---- NATURAL CITADEL SCARCITY --------------------------------------------
  // FIVE NATURAL CITADELS PER 100 LEVELS OF TILES, and no more. The old rule was
  // a per-tile 3% roll, which is a RATE and not a BUDGET: it produced 73 of them,
  // spread 2 / 12 / 6 / 30 / 23 across the five level bands purely by luck of the
  // seed. A fortress paying CITADEL_RATE_MULT× a resource field is the single
  // richest thing on the map, so "how many exist" is an economy decision and it
  // should not be an accident. Now it is a fixed budget per band: 25 in the
  // galaxy, evenly available at every depth (the shallow band actually GAINS
  // three — it had two).
  //
  // THE SELECTION IS A BAND-WIDE SORT, NOT A PER-TILE ROLL, because "exactly five"
  // cannot be decided by a tile looking only at itself. Each candidate is scored
  // from its own coordinates on a dedicated seed stream, the five lowest scores in
  // each band win, and ties break on id — so the set is identical for every
  // account, on every device, forever, with no server round-trip. Built once and
  // cached; it never changes at runtime.
  const CIT_BAND = 100;      // levels per band
  const CIT_PER_BAND = 5;    // natural citadels per band
  let _citSet = null;
  function citScore(q, r) {
    return rngFor(((q * 0x1f123bb5) ^ (r * 0x27d4eb2d) ^ 0x0c17ade1) >>> 0)();
  }
  function citadelSet() {
    if (_citSet) return _citSet;
    const bands = {};
    for (let ring = 2; ring <= RINGS; ring++) {          // ring 1 has never held one
      const b = Math.floor(ringLevel(ring) / CIT_BAND);
      const list = bands[b] || (bands[b] = []);
      const coords = ringCoords(ring);
      for (let i = 0; i < coords.length; i++) {
        const c = coords[i];
        list.push({ id: tileId(c.q, c.r), s: citScore(c.q, c.r) });
      }
    }
    const keep = {};
    for (const b in bands) {
      bands[b].sort((x, y) => (x.s - y.s) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
      for (let i = 0; i < CIT_PER_BAND && i < bands[b].length; i++) keep[bands[b][i].id] = 1;
    }
    return (_citSet = keep);
  }
  // THE OLD PREDICATE, KEPT ON PURPOSE. A pilot who already holds one of the 48
  // fortresses this pass retires must not have it turn into an ordinary tile under
  // them — they fought a siege for it and it is most of their income. game-v93
  // asks this for each system the local account owns and hands the answer to
  // grandfather() before anything reads a tile. Reproduces the FIRST draw of
  // tileAt()'s own stream exactly; do not re-order either.
  function legacyCitadel(q, r) {
    const ring = ringOf(q, r);
    if (ring < 2 || ring > RINGS) return false;
    return rngFor((q * 73856093) ^ (r * 19349663) ^ 0x5bd1)() < 0.03;
  }
  // RETIRED (737) — see the note in tileAt(). Kept as a no-op so an older caller
  // cannot throw, and because the export is part of the module's contract.
  const _grand = {};
  function grandfather() { return 0; }

  // ---- deterministic tile ----------------------------------------------------
  const HOME = tileId(0, 0);
  const _cache = {};
  function tileAt(id) {
    if (_cache[id]) return _cache[id];
    const p = parseId(id);
    if (!p) return null;
    const ring = ringOf(p.q, p.r);
    if (ring > RINGS) return null;
    if (ring === 0) {
      return (_cache[id] = {
        id, q: 0, r: 0, ring: 0, type: 'home', home: true, boss: false, citadel: false, deep: false,
        resource: null, rarity: 0, diff: 0, level: 0, name: 'Home Citadel', rate: 0,
      });
    }
    const rnd = rngFor((p.q * 73856093) ^ (p.r * 19349663) ^ 0x5bd1);
    const roll = rnd();
    // CITADEL SIEGE ZONES — a fixed budget of 5 per 100 levels (see citadelSet),
    // plus any fortress this account already holds from the old 3% rule.
    //
    // `roll` IS STILL DRAWN, AND THE BRANCHES BELOW ARE UNCHANGED, so that a tile
    // which stops being a citadel keeps its name, rarity and resource: the old
    // rule needed roll < 0.03, which is also < 0.11, so such a tile lands on the
    // BOSS branch — and boss and citadel consume exactly the same number of draws.
    // Rewriting the type line to always draw would re-roll every boss tile in the
    // galaxy instead. Leave the draw order alone.
  // GRANDFATHERING IS RETIRED (737). The scarcity pass cut the galaxy from the old
  // 3% roll's 73 natural citadels to a fixed budget of 25, and `_grand` kept the
  // other 48 alive for whoever already held them. That kindness produced a tile
  // the game cannot otherwise make: a fortress got RETIRED, the pilot built a
  // player citadel on it while it was an ordinary hex (legal — canBuildCitadel
  // gates on `!t.citadel`), and then grandfather() handed the fortress back
  // UNDERNEATH the citadel. The tile then paid ×1000 for being natural AND ×10/rank
  // for the citadel, ~×25 more than either alone. One account was carrying 31 of
  // them. The same collision runs the other way for the CURRENT 25: a tile that was
  // ordinary when the citadel went up became a fortress when the pass landed.
  //
  // The retired 48 are ordinary tiles now, which is what the scarcity pass decided.
  // A citadel already standing on one keeps paying as a citadel — see tileRateOf().
  const citadel = ring >= 2 && citadelSet()[id] === 1;
    const boss = !citadel && roll < 0.11;                  // ~8% boss tiles
    let type = citadel ? 'citadel' : boss ? 'boss' : (rnd() < 0.5 ? 'resource' : 'combat');
    // rarity: 0 common · 1 uncommon · 2 rare (boosts output)
    const rr = rnd();
    const rarity = rr < 0.7 ? 0 : rr < 0.93 ? 1 : 2;
    // EVERY tile yields a resource to some degree — a combat sector pays less than
    // a dedicated resource field, but holding ANY tile now produces income.
    const pool = ['fuel'];
    if (ring >= 2) pool.push('iron');
    if (ring >= 5) pool.push('plasma', 'plasma');
    if (ring >= DEEP_RING) pool.push('iron', 'plasma');
    const resource = pool[(rnd() * pool.length) | 0];
    const deep = ring >= DEEP_RING;
    // output multiplier by tile type: boss ×1.5 · resource field ×1 · combat ×0.4
    // (combat tiles are a real but smaller faucet, so resource tiles stay best).
    const typeMult = boss ? 1.5 : (type === 'resource' ? 1 : 0.4);
    let rate = Math.max(3, Math.round(baseRate(ring, resource) * (1 + rarity * 0.6) * typeMult));
    // NATURAL CITADEL — CITADEL_RATE_MULT× a RESOURCE-GRADE tile of the same ring
    // and rarity. Stated explicitly because the citadel branch cannot use
    // typeMult: a citadel tile's own type is 'citadel', which scores 0.4 on the
    // line above, so folding it in would silently cut fortress output to 40% and
    // make the advertised multiplier wrong in the other direction. Pinning the
    // comparand to 1.0 is what makes the ×1000 in the UI literally true — the
    // copy names the comparand for the same reason.
    if (citadel) rate = Math.round(baseRate(ring, resource) * (1 + rarity * 0.6) * 1) * CITADEL_RATE_MULT;
    rate *= TILE_VALUE_MULT;
    const tile = {
      id, q: p.q, r: p.r, ring, type, home: false, boss, citadel, deep,
      resource, rarity, diff: ringDiff(ring), level: ringLevel(ring),
      name: citadel ? ('Citadel ' + genName(rnd)) : genName(rnd), rate,
      alien: isInvaded(p.q, p.r),
    };
    return (_cache[id] = tile);
  }

  // ENTRY COST — warping into a tile burns Galaxy Resources, and deep rings
  // get EXPENSIVE: fuel always, iron from ring 3, plasma from ring 6.
  // ENTRY COST — warping into a tile burns Galaxy Resources, and deep rings
  // get EXPENSIVE: fuel always, iron from ring 3, plasma from ring 6.
  // Citadel siege zones cost CITADEL_COST_MULT× (pass the tile as 2nd arg).
  function entryCost(ring, tile) {
    if (ring <= 0) return null;
    const cost = { fuel: Math.round(30 * Math.pow(ring, 1.8)) };
    if (ring >= 3) cost.iron = Math.round(12 * Math.pow(ring - 2, 1.8));
    if (ring >= 6) cost.plasma = Math.round(10 * Math.pow(ring - 5, 1.9));
    if (tile && tile.citadel) for (const k in cost) cost[k] *= CITADEL_COST_MULT;
    return cost;
  }

  function ringTiles(ring) { return ringCoords(ring).map((c) => tileAt(tileId(c.q, c.r))).filter(Boolean); }
  function tileCount() { let n = 0; for (let r2 = 1; r2 <= RINGS; r2++) n += r2 * 6; return n; }

  window.GALAXYMAP = {
    RES, RES_KEYS, RINGS, DEEP_RING, DEEP_MULT, CITADEL_RATE_MULT, CITADEL_COST_MULT, TILE_VALUE_MULT, HOME,
    CIT_BAND, CIT_PER_BAND, citadelSet, legacyCitadel, grandfather,
    tileId, parseId, ringOf, neighbors, ringCoords, ringTiles, tileAt, tileCount,
    ringLevel, ringDiff, pixel, unpixel, entryCost, XEN, isInvaded, alienChance,
  };
})();
