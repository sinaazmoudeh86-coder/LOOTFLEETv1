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
  const CITADEL_RATE_MULT = 100;    // a citadel pays 100× a normal tile

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

  // Per-tile resource yield per hour (before deep ×25 / citadel ×100 / rarity)
  function baseRate(ring, resKey) {
    const base = 8 + ring * 6;
    const mult = resKey === 'fuel' ? 1 : resKey === 'iron' ? 0.85 : 0.7;
    return Math.max(3, Math.round(base * mult));
  }

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
    // CITADEL SIEGE ZONES — rare (~3%), only ring 2+
    const citadel = ring >= 2 && roll < 0.03;
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
    if (citadel) rate = Math.round(baseRate(ring, resource) * (1 + rarity * 0.6)) * CITADEL_RATE_MULT;
    const tile = {
      id, q: p.q, r: p.r, ring, type, home: false, boss, citadel, deep,
      resource, rarity, diff: ringDiff(ring), level: ringLevel(ring),
      name: citadel ? ('Citadel ' + genName(rnd)) : genName(rnd), rate,
    };
    return (_cache[id] = tile);
  }

  // ENTRY COST — warping into a tile burns Galaxy Resources, and deep rings
  // get EXPENSIVE: fuel always, iron from ring 3, plasma from ring 6.
  function entryCost(ring) {
    if (ring <= 0) return null;
    const cost = { fuel: Math.round(30 * Math.pow(ring, 1.8)) };
    if (ring >= 3) cost.iron = Math.round(12 * Math.pow(ring - 2, 1.8));
    if (ring >= 6) cost.plasma = Math.round(10 * Math.pow(ring - 5, 1.9));
    return cost;
  }

  function ringTiles(ring) { return ringCoords(ring).map((c) => tileAt(tileId(c.q, c.r))).filter(Boolean); }
  function tileCount() { let n = 0; for (let r2 = 1; r2 <= RINGS; r2++) n += r2 * 6; return n; }

  window.GALAXYMAP = {
    RES, RES_KEYS, RINGS, DEEP_RING, DEEP_MULT, CITADEL_RATE_MULT, HOME,
    tileId, parseId, ringOf, neighbors, ringCoords, ringTiles, tileAt, tileCount,
    ringLevel, ringDiff, pixel, unpixel, entryCost,
  };
})();
