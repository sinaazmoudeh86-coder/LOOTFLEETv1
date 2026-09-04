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

  // ---- THE ARTERY -----------------------------------------------------------
  // A Lv 500+ filament hanging off the eastern rim: eleven systems, ONE TILE
  // WIDE, paying 3× the richest thing the ring generator can build.
  //
  // WHY A STRING AND NOT A BLOB — this IS the design, not decoration.
  // game-v93's tileShield() seals a tile only when all SIX neighbours share its
  // faction. A one-wide chain gives every tile at most TWO same-faction
  // neighbours, so `open` is never 0 and NOTHING IN THE ARTERY CAN EVER BE
  // SHIELDED — not one tile, not by one owner, not ever. Taking the whole branch
  // does not fortify it; it means all eleven hexes are permanently attackable and
  // one pilot has to answer for every one of them. The contest is structural.
  // Nothing had to be bolted on to make this region hostile to a monopolist; the
  // geometry does it, which is why the geometry is the feature.
  //
  // GEOMETRY. pixel() is pointy-top — x = size·√3·(q + r/2), y = size·1.5·r — so
  // +q along r=0 runs due EAST with zero vertical drift. The stem leaves the rim
  // beside (25,0); THE VALVE forks north-east ([1,-1]) and south ([0,1]), which
  // land symmetrically above and below the stem line.
  //
  // RINGS 26-33 SIT OUTSIDE THE MAP PROPER, AND THAT IS WHAT MAKES THIS SAFE:
  //   · citadelSet() loops ring 2..RINGS over ringCoords(), so the 25 existing
  //     natural fortresses are computed from exactly the coords they always were.
  //     No fortress moves, retires or appears. Asserted in the harness.
  //   · tileShield() decides "off the map" with `ringOf(n) > RINGS`, a pure ring
  //     test — so every EXISTING rim tile's shield maths is untouched and an
  //     Artery neighbour still reads to it as open space. That is the safe
  //     direction: no tile anywhere becomes newly sealable, so no holding gets
  //     quietly harder to attack.
  //   · The ids are ordinary hex ids, so ownership, capture, contiguity, the tile
  //     cap and territory sync all work with no new code and NO NEW SAVE KEY.
  //     The save's shape does not change; `ownedSystems` simply gains coordinates
  //     it could not previously hold.
  const ART_MULT = 3;        // ×3 the richest ordinary tile on the map
  const ART_LV0 = 500;       // the mouth
  const ART_LV_STEP = 10;    // per system outward
  // THE COMPARAND IS MEASURED, NOT ASSUMED — and this is the second attempt at it.
  //
  // The first version computed a THEORETICAL ceiling: rim ring, top rarity,
  // resource-grade. That figure (17,400) is not the map's maximum and is not even
  // close to it, because it left out `typeMult` — a BOSS tile pays ×1.5, so the
  // richest ordinary hex in the galaxy is a rarity-2 boss at ring 24 paying
  // 25,100. Multiplying the wrong comparand by three produced tiles worth 2.08×
  // the real ceiling, i.e. the region would have shipped quietly under-powered
  // against the brief and nobody would have noticed from reading the code.
  //
  // So: SWEEP THE REAL GENERATOR and take the real maxima, separately for an
  // ordinary tile and for a natural fortress (whose rate already carries the
  // baked ×CITADEL_RATE_MULT, and whose actual best is a ring-23 rarity-1 tile,
  // not the rim — the citadel budget decides where fortresses land, so the top
  // one is wherever citadelSet() put it).
  //
  // Memoized on first use and never recomputed. It is a pure function of the
  // seed, so the answer is identical for every account and every session. The
  // sweep only ever READS tileAt(), and an Artery id can never appear in it (the
  // walk is ringCoords(1..RINGS)), so there is no recursion and no chance of the
  // region measuring itself.
  //
  // Retune baseRate, TILE_VALUE_MULT, the rarity curve or the citadel budget and
  // the Artery tracks it automatically — which is the point of measuring rather
  // than writing 75300 down.
  let _maxima = null;
  function mapMaxima() {
    if (_maxima) return _maxima;
    _maxima = { ordinary: 1, citadel: 1 };      // set BEFORE the sweep — no re-entry, no repeat work
    let ord = 0, cit = 0;
    for (let ring = 1; ring <= RINGS; ring++) {
      const cs = ringCoords(ring);
      for (let i = 0; i < cs.length; i++) {
        const t = tileAt(tileId(cs[i].q, cs[i].r));
        if (!t || t.home) continue;
        if (t.citadel) { if (t.rate > cit) cit = t.rate; }
        else if (t.rate > ord) ord = t.rate;
      }
    }
    _maxima = { ordinary: Math.max(1, ord), citadel: Math.max(1, cit) };
    return _maxima;
  }
  function richestOrdinaryRate() { return mapMaxima().ordinary; }
  function richestCitadelRate() { return mapMaxima().citadel; }
  // `d` is DISTANCE FROM THE MOUTH along the filament, not an array index, so
  // both arms past the fork climb the level ladder identically.
  const ART_PATH = [
    { q: 26, r:  0, d: 0, res: 'fuel',   name: 'Lancet', citadel: true },
    { q: 27, r:  0, d: 1, res: 'iron',   name: 'Ligature' },
    { q: 28, r:  0, d: 2, res: 'plasma', name: 'Tourniquet', citadel: true },
    { q: 29, r:  0, d: 3, res: 'iron',   name: 'Suture' },
    { q: 30, r:  0, d: 4, res: 'plasma', name: 'The Valve', citadel: true },
    { q: 31, r: -1, d: 5, res: 'plasma', name: 'Ichor Reach' },
    { q: 32, r: -2, d: 6, res: 'fuel',   name: 'Cauter Drift' },
    { q: 33, r: -3, d: 7, res: 'plasma', name: 'Exsanguine', citadel: true },
    { q: 30, r:  1, d: 5, res: 'iron',   name: 'Vitrine Hollow' },
    { q: 30, r:  2, d: 6, res: 'plasma', name: 'Marrow Deep' },
    { q: 30, r:  3, d: 7, res: 'plasma', name: 'The Last Beat', citadel: true },
    // ---- THE THIRD STEM — THE XYN BERTH ------------------------------------
    // A stem off the natural citadel at the junction, running due east, ending on
    // the tile the XYN SUPER FIGHTER sits on.
    //
    // GEOMETRY NOTE, honestly: the fork already spends the Valve's north-east and
    // south borders, so a third stem east necessarily touches both arms at its
    // first tile — (31,0) has four Artery neighbours and the Valve has four. That
    // is fine and it is checked: the guarantee that matters is SIX, because that
    // is what tileShield() seals on. Four of six is still permanently attackable.
    // XYN PRIME itself is a dead end with ONE friendly border, so the arena tile is
    // the least defensible hex in the game — which is the correct shape for a prize
    // everyone has to be able to come and take.
    //
    // XYN PRIME IS DELIBERATELY NOT A FORTRESS. It already carries the region's
    // whole reason to exist; stacking a ×1000 fortress on the event arena would
    // make one hex both the best income and the only prize on the map, and its tile
    // sheet would have to argue two unrelated cases at once.
    { q: 31, r:  0, d: 5, res: 'iron',   name: 'Thrombus' },
    { q: 32, r:  0, d: 6, res: 'fuel',   name: 'Embolus' },
    { q: 33, r:  0, d: 7, res: 'plasma', name: 'Xyn Prime', xyn: true },
  ];
  // ---- THE FIVE FORTRESSES -------------------------------------------------
  // FIVE natural citadels in fourteen hexes, against twenty-five in the entire
  // rest of the galaxy. That concentration is the point and it is a deliberate
  // trade: the richest ground in the game sits in the one region that CANNOT BE
  // DEFENDED. Every hex here tops out at four friendly borders of six and
  // tileShield() seals at six, so none of it is ever safe. Enormous value, held
  // only for as long as you can keep beating everyone who comes for it.
  //
  // THEY ARE NOT WORTH THE SAME, AND THAT IS WHAT MAKES THE CHAIN WORTH PUSHING.
  // Value scales with DISTANCE FROM THE MOUTH, so a fortress you can reach on your
  // first tile is worth a third of one at an arm tip you have to fight the whole
  // filament to hold:
  //
  //   Lancet        d0  ×3.00   the mouth — the region's floor, and its chokepoint
  //   Tourniquet    d2  ×4.50   mid-stem
  //   The Valve     d4  ×6.00   the junction: whoever holds it controls both arms
  //   Exsanguine    d7  ×8.25   north arm tip
  //   The Last Beat d7  ×8.25   south arm tip
  //
  // × what? The map's own best natural fortress, measured (see mapMaxima). So the
  // mouth is exactly the ×3 the region was specified at, and depth is the bonus on
  // top — the ×3 is the FLOOR here, not the ceiling.
  // Written as the multiplier it actually is: the ×3 floor, plus a quarter of it
  // per step out from the mouth. d0 → ×3.00 · d2 → ×4.50 · d4 → ×6.00 · d7 → ×8.25.
  const ART_CIT_PER_STEP = 0.25;
  function artCitMult(d) { return ART_MULT * (1 + Math.max(0, d) * ART_CIT_PER_STEP); }
  const ARTERY = {
    key: 'artery', name: 'THE ARTERY', effect: 'EXSANGUINATION',
    color: '#ff2d6b', edge: '#ff9ab8', glow: 'rgba(255,45,107,0.55)',
    mult: ART_MULT, minLevel: ART_LV0,
    // TWO DIFFERENT TILES, AND THEY HAD THE SAME NAME. `mouth` used to mean the
    // rim hex the filament hangs off — which is an ORDINARY GALAXY TILE: isArtery()
    // is false for it, it has no arteryParent, and feeding it to the funnel's
    // shield walk would silently break the walk. The funnel's actual entrance is
    // the first hex OF the chain. Naming both "mouth" is how shieldDoors ended up
    // hand-deriving the entrance from path[0] inline rather than reading it.
    //
    //   rimAnchor  25,0  the galaxy tile the chain attaches to (NOT in the region)
    //   entry      26,0  the funnel's entrance — Lancet, the only hex that can
    //                    never shield, and the one an attacker has to break first
    //
    // `entry` is DERIVED FROM THE PATH so it cannot drift from the geometry: change
    // where the chain starts and the entrance follows automatically.
    rimAnchor: tileId(25, 0),
    entry: tileId(ART_PATH[0].q, ART_PATH[0].r),
    citadel: tileId(30, 0), xyn: tileId(33, 0), path: ART_PATH,
    citadels: ART_PATH.filter((a) => a.citadel).map((a) => tileId(a.q, a.r)),
  };
  const ART_BY_ID = (() => {
    const out = {};
    ART_PATH.forEach((a) => { out[tileId(a.q, a.r)] = a; });
    return out;
  })();
  const ART_IDS = Object.keys(ART_BY_ID);
  function isArtery(id) { return !!ART_BY_ID[id]; }
  function isXyn(id) { return !!(ART_BY_ID[id] && ART_BY_ID[id].xyn); }
  // ---- REACHABILITY: THE CHAIN IS A TREE ROOTED AT THE MOUTH ---------------
  // Every Artery hex is reachable only through the hex one step closer to the
  // mouth, which is what lets game-v93 shield the region as a FUNNEL instead of
  // trying to encircle a one-wide line (see arteryShield there).
  //
  // DERIVED, NOT HAND-LISTED. A parent is the adjacent Artery hex whose distance
  // from the mouth is exactly one less, and on this shape that is unique for every
  // tile — including all three hexes hanging off the junction, whose only d-1
  // neighbour is THE VALVE. Writing the parents out by hand would be a second
  // description of the same geometry, and the two would drift the first time the
  // path changed. Built once, cached; the path is a constant.
  //
  // The MOUTH has no parent, and that is load-bearing: it is the one hex whose way
  // in is the galaxy itself, so it can never shield and the region can never seal.
  let _artParent = null;
  function arteryParents() {
    if (_artParent) return _artParent;
    const p = {};
    ART_PATH.forEach((a) => {
      const id = tileId(a.q, a.r);
      const up = neighbors(a.q, a.r)
        .map((n) => ART_BY_ID[tileId(n.q, n.r)])
        .filter((n) => n && n.d === a.d - 1);
      p[id] = up.length ? tileId(up[0].q, up[0].r) : null;
    });
    _artParent = p;
    return p;
  }
  function arteryParent(id) { const p = arteryParents(); return p[id] || null; }
  function arteryTile(a) {
    const level = ART_LV0 + a.d * ART_LV_STEP;
    // ×3 THE REAL MAXIMUM OF ITS OWN CLASS. An ordinary Artery system is measured
    // against the best ordinary hex on the map; a FORTRESS against the best natural
    // fortress. Comparing the fortress to the ordinary ceiling instead would have
    // made it ×3000, and comparing an ordinary system to the fortress ceiling would
    // have made every tile on the filament a fortress in all but name.
    //
    // A FORTRESS ALSO SCALES WITH DEPTH — see artCitMult(). Ordinary systems are a
    // flat ×3 the whole way out, because they are income; the fortresses are the
    // prizes, and a prize at the end of an indefensible arm should be worth more
    // than one at the mouth.
    //
    // tileRateOf() then applies deep ×25 and galaxy ×25 to these exactly as it does
    // to the tiles they were measured against — which is why every Artery system is
    // `deep` — so the multiplier is intact in the number the player reads.
    const rate = a.citadel
      ? richestCitadelRate() * artCitMult(a.d)
      : richestOrdinaryRate() * ART_MULT;
    return {
      id: tileId(a.q, a.r), q: a.q, r: a.r, ring: ringOf(a.q, a.r),
      type: a.citadel ? 'citadel' : 'resource',
      home: false, boss: false, citadel: !!a.citadel, deep: true,
      resource: a.res, rarity: 2, alien: false,
      artery: true, arteryD: a.d, xyn: !!a.xyn,
      diff: Math.max(1, Math.round(level * 0.95)), level,
      name: a.name, rate,
    };
  }

  // ---- deterministic tile ----------------------------------------------------
  const HOME = tileId(0, 0);
  const _cache = {};
  function tileAt(id) {
    if (_cache[id]) return _cache[id];
    const p = parseId(id);
    if (!p) return null;
    const ring = ringOf(p.q, p.r);
    // THE ARTERY IS TESTED BEFORE THE RIM BAIL and never draws from `rnd`, so it
    // cannot perturb a single generated tile: its coords are ones tileAt()
    // previously refused outright.
    if (ART_BY_ID[id]) return (_cache[id] = arteryTile(ART_BY_ID[id]));
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
  function tileCount() { let n = 0; for (let r2 = 1; r2 <= RINGS; r2++) n += r2 * 6; return n + ART_PATH.length; }

  window.GALAXYMAP = {
    RES, RES_KEYS, RINGS, DEEP_RING, DEEP_MULT, CITADEL_RATE_MULT, CITADEL_COST_MULT, TILE_VALUE_MULT, HOME,
    CIT_BAND, CIT_PER_BAND, citadelSet, legacyCitadel, grandfather,
    tileId, parseId, ringOf, neighbors, ringCoords, ringTiles, tileAt, tileCount,
    ringLevel, ringDiff, pixel, unpixel, entryCost, XEN, isInvaded, alienChance,
    baseRate, ARTERY, ART_IDS, isArtery, isXyn, artCitMult, arteryParent, arteryParents,
    richestOrdinaryRate, richestCitadelRate, mapMaxima,
  };
})();
