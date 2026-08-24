/* =============================================================================
   config.js — Infinite Archer
   All tunable game constants, scaling formulas, and data tables live here.
   Everything is attached to window.CONFIG so other modules can read it.
   ============================================================================= */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // RARITY TIERS
  // Each tier defines: color, glow color, how many stats items can roll,
  // a multiplier applied to stat rolls, and a relative drop weight.
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // RARITY TIERS (11 tiers). Weights drop steeply and geometrically, so each
  // step up the chain is dramatically rarer than the last — only deep zones
  // (which apply a luck multiplier) make the top tiers realistically attainable.
  // ---------------------------------------------------------------------------
  const RARITY = [
    { key: 'common',    name: 'Common',    color: '#9aa0a6', glow: 'rgba(154,160,166,0)',   minStats: 1, maxStats: 1, mult: 1.0,  weight: 1000,    particles: 0 },
    { key: 'uncommon',  name: 'Uncommon',  color: '#5bc06b', glow: 'rgba(91,192,107,0.5)',  minStats: 1, maxStats: 2, mult: 1.35, weight: 400,     particles: 0 },
    { key: 'rare',      name: 'Rare',      color: '#4a90e2', glow: 'rgba(74,144,226,0.6)',  minStats: 2, maxStats: 3, mult: 1.8,  weight: 140,     particles: 1 },
    { key: 'epic',      name: 'Epic',      color: '#b15cff', glow: 'rgba(177,92,255,0.7)',  minStats: 3, maxStats: 3, mult: 2.4,  weight: 42,      particles: 2 },
    { key: 'legendary', name: 'Legendary', color: '#f0972a', glow: 'rgba(240,151,42,0.85)', minStats: 3, maxStats: 4, mult: 3.2,  weight: 10,      particles: 3 },
    { key: 'mythic',    name: 'Mythic',    color: '#ff3b4e', glow: 'rgba(255,59,78,0.95)',  minStats: 4, maxStats: 5, mult: 4.5,  weight: 2.2,     particles: 5 },
    { key: 'ancient',   name: 'Ancient',   color: '#21d4c4', glow: 'rgba(33,212,196,0.95)', minStats: 5, maxStats: 6, mult: 6.2,  weight: 0.45,    particles: 6 },
    { key: 'divine',    name: 'Divine',    color: '#ffe27a', glow: 'rgba(255,226,122,1)',   minStats: 6, maxStats: 6, mult: 8.5,  weight: 0.09,    particles: 8 },
    { key: 'cosmic',    name: 'Cosmic',    color: '#ff6ad5', glow: 'rgba(255,106,213,1)',   minStats: 6, maxStats: 6, mult: 11.5, weight: 0.017,   particles: 10 },
    { key: 'void',      name: 'Void',      color: '#9a5bff', glow: 'rgba(154,91,255,1)',    minStats: 6, maxStats: 6, mult: 15.5, weight: 0.003,   particles: 12 },
    { key: 'eternal',   name: 'Eternal',   color: '#eae6ff', glow: 'rgba(234,230,255,1)',   minStats: 6, maxStats: 6, mult: 21.0, weight: 0.0005,  particles: 16 },
    { key: 'primordial',name: 'Primordial',color: '#ffe6a8', glow: 'rgba(255,230,168,1)',   minStats: 6, maxStats: 6, mult: 28.5, weight: 0.0040, particles: 22 },
    { key: 'relic',     name: 'Relic',     color: '#c061ff', glow: 'rgba(192,97,255,1)',    minStats: 6, maxStats: 6, mult: 38.0, weight: 0.00075,  particles: 26 },
    { key: 'artifact',  name: 'Artifact',  color: '#ff2330', glow: 'rgba(255,35,48,1)',     minStats: 6, maxStats: 6, mult: 50.0, weight: 0.00013, particles: 30 },
    // ---- ASCENSION-EXCLUSIVE TIERS ----------------------------------------
    // These three CANNOT drop until the pilot has ascended. No zone, boss or
    // crate produces them below the required star count — the gate is the
    // Ascension itself, which is what makes prestige feel like real access
    // rather than a stat bump. `ascReq` = Ascension Stars needed.
    { key: 'ascendant', name: 'Ascendant', color: '#5cffbe', glow: 'rgba(92,255,190,1)',    minStats: 6, maxStats: 6, mult: 68.0,  weight: 8e-7,  particles: 34, ascReq: 1 },
    { key: 'celestial', name: 'Celestial', color: '#5b7cff', glow: 'rgba(91,124,255,1)',    minStats: 6, maxStats: 6, mult: 92.0,  weight: 1.2e-7, particles: 38, ascReq: 12 },
    { key: 'paragon',   name: 'Paragon',   color: '#ffffff', glow: 'rgba(255,255,255,1)',   minStats: 6, maxStats: 6, mult: 125.0, weight: 2e-8, particles: 44, ascReq: 25, prismatic: true },
    // ---- TIER 17 · DORMANT — DEFINED, NOT LIVE -----------------------------
    // Reserved for a later release. It exists so the ladder has somewhere to go
    // and so save data written against it later lines up with what ships today.
    //
    // WHY APPENDING IS SAFE AND INSERTING WOULD NOT BE: an item's `rarity` is
    // stored in the save as an INDEX into this array. Adding to the END renumbers
    // nothing, so every fitting already in every hold keeps meaning exactly what
    // it meant. Inserting anywhere above would silently re-grade the entire
    // economy — never do that.
    //
    // IT CANNOT DROP. Three independent locks, any one of which is sufficient:
    //   · `dormant: true`  — rollRarity() and both caps refuse it outright
    //   · `weight: 0`      — zero share of the weighted roll even if reached
    //   · `ascReq: 9999`   — an ascension ceiling no live account can meet
    // Deleting any ONE of them must still leave it unobtainable. When it goes
    // live, remove `dormant`, give it a real weight and set a reachable ascReq.
    { key: 'eclipse',   name: 'Eclipse',   color: '#ff9d00', glow: 'rgba(255,157,0,1)',     minStats: 6, maxStats: 6, mult: 170.0, weight: 0, particles: 50, ascReq: 9999, prismatic: true, dormant: true },
  ];
  // Post-mythic tiers (Ancient and beyond) are ~10× rarer across the board.
  // NOTE: weights above are PRE-multiplier — the ×0.1 below is applied to tier 6+.
  RARITY.forEach((r, i) => { if (i >= 6) r.weight *= 0.1; });
  const RARITY_BY_KEY = {};
  RARITY.forEach((r, i) => { r.tier = i; RARITY_BY_KEY[r.key] = r; if (r.ascReq == null) r.ascReq = 0; });

  // Highest rarity tier the pilot's ASCENSION rank permits, regardless of zone.
  // Reads the live star count so every drop path (kills, bosses, crates, shop,
  // offline sim) is gated identically from one place.
  function ascStars() { try { return (window.PASCEND && window.PASCEND.stars()) | 0; } catch (e) { return 0; } }
  function ascRarityCap(stars) {
    const s = stars == null ? ascStars() : stars | 0;
    let cap = 13;   // Artifact — the ceiling for an un-ascended pilot
    // A DORMANT TIER IS NEVER A CAP. Stopping at the first one keeps the ceiling
    // at the last LIVE tier however many reserved entries sit above it.
    for (let i = 14; i < RARITY.length; i++) {
      if (RARITY[i].dormant) break;
      if (s >= RARITY[i].ascReq) cap = i;
    }
    return cap;
  }
  // The highest tier that is actually obtainable — the array length minus any
  // reserved entries parked on the end. Anything that wants "the top of the
  // ladder" asks this rather than RARITY.length - 1.
  function liveRarityMax() {
    let i = RARITY.length - 1;
    while (i > 0 && RARITY[i].dormant) i--;
    return i;
  }
  // Each ascension also sharpens the TOP of the table — a flat, legible bonus to
  // the drop weight of Primordial and above (tier 11+). +25% per star, capped at
  // 5× so it stays a real edge without trivialising the rarest gear.
  const TOP_TIER = 11;   // Primordial
  function ascTopBoost(stars) { const s = stars == null ? ascStars() : stars | 0; return 1 + Math.min(4, s * 0.25); }

  // ---------------------------------------------------------------------------
  // STATS
  // The six stat types items can roll. `base` is the per-item-level value
  // before rarity multiplier. `fmt` controls display (flat vs percent).
  // ---------------------------------------------------------------------------
  const STATS = {
    attackDamage:  { key: 'attackDamage',  name: 'Damage',       short: 'DMG',   fmt: 'flat', base: 4.0,  icon: '' },
    attackSpeed:   { key: 'attackSpeed',   name: 'Fire Rate',    short: 'RATE',  fmt: 'pct',  base: 0.9,  icon: '' },
    critChance:    { key: 'critChance',    name: 'Crit Chance',  short: 'CRIT',  fmt: 'pct',  base: 0.6,  icon: '' },
    critDamage:    { key: 'critDamage',    name: 'Crit Damage',  short: 'CDMG',  fmt: 'pct',  base: 2.2,  icon: '' },
    health:        { key: 'health',        name: 'Health',       short: 'HP',    fmt: 'flat', base: 22.0, icon: '' },
    moveSpeed:     { key: 'moveSpeed',     name: 'Move Speed',   short: 'MOVE',  fmt: 'pct',  base: 0.7,  icon: '' },
    // SPECIAL: never rolled by the normal stat picker. Added rarely as a bonus
    // line (see items.js). Value is a flat 0.2–1% and does NOT scale with zone.
    // (Jul 2026: every lifesteal source in the game was cut by 80% — sustain had
    // become the dominant stat, and in PvP it made both fleets unkillable.)
    lifeSteal:     { key: 'lifeSteal',     name: 'Life Steal',   short: 'LS',    fmt: 'pct', base: 0, icon: '', special: true },
  };
  // Core rollable stats (excludes specials like life steal).
  const STAT_KEYS = Object.keys(STATS).filter((k) => !STATS[k].special);

  // ---------------------------------------------------------------------------
  // GEAR SLOTS  (internal keys kept stable; theme is firearms/tactical gear)
  // Each slot favors certain stats (weighted) so gear feels distinct.
  // Icons are inline SVG strings injected into the DOM.
  // ---------------------------------------------------------------------------
  const ICON = {
    fighter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l1.8 6.6L20 12.4v1.8l-6-1.6V18l2.2 2.2h-8.4L10 18v-5.4l-6 1.6v-1.8l6.2-3.8z"/></svg>',
    weapon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h16l-1.5 4H13l-2 4H8v-4H3z"/><path d="M7 12v2"/><path d="M19 8V6"/></svg>',
    ammo:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="3" width="4" height="11" rx="1"/><path d="M8 3.5l2-1.5 2 1.5"/><path d="M8 14h4l-.6 6h-2.8z"/><rect x="14" y="6" width="4" height="9" rx="1"/></svg>',
    vest:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3l4 2.5L16 3v8a6 6 0 0 1-4 5.5A6 6 0 0 1 8 11z"/><path d="M12 6v9"/></svg>',
    boots:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v9l5 2 4 2v3H9a4 4 0 0 1-4-4V3z"/><path d="M9 12h3"/></svg>',
    gloves: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 12V7a1 1 0 0 1 2 0v3m0 0V5a1 1 0 0 1 2 0v5m0 0V5a1 1 0 0 1 2 0v5m0-2a1 1 0 0 1 2 0v6a5 5 0 0 1-5 5 5 5 0 0 1-4-2l-3-4 1.5-1.5z"/></svg>',
    optic:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>',
  };
  const SLOTS = {
    bow:    { key: 'bow',    name: 'Cannon',     primary: ['attackDamage', 'critDamage'],   icon: ICON.weapon },
    // FIGHTER BAY — a first-class slot, not a cannon in disguise. Each bay holds
    // ONE Heavy Fighter, so a hull with `fighterCapacity: 4` exposes four of
    // them and flies four craft. Being in SLOTS is also what puts fighters on the
    // NORMAL LOOT TABLE: generate() picks a slot at random from SLOT_KEYS, so
    // bays drop, roll rarity and carry stat lines like any other fitting.
    fighter:{ key: 'fighter',name: 'Fighter Bay',primary: ['attackDamage', 'critDamage'],   icon: ICON.fighter },
    arrows: { key: 'arrows', name: 'Munitions',  primary: ['attackSpeed', 'critChance'],    icon: ICON.ammo },
    armor:  { key: 'armor',  name: 'Hull',       primary: ['health', 'attackDamage'],       icon: ICON.vest },
    boots:  { key: 'boots',  name: 'Thrusters',  primary: ['moveSpeed', 'health'],          icon: ICON.boots },
    gloves: { key: 'gloves', name: 'Targeting',  primary: ['attackSpeed', 'critDamage'],    icon: ICON.gloves },
    amulet: { key: 'amulet', name: 'Shield Core',primary: ['critChance', 'critDamage'],     icon: ICON.optic },
  };
  const SLOT_KEYS = Object.keys(SLOTS);

  // ---------------------------------------------------------------------------
  // ENEMY TYPES  (combat-zone creatures — PG monsters, no humans)
  // Unlocked progressively by zone. `hpMod`/`dmgMod`/`spd` tune feel.
  // `size` is the draw radius. `tint` is the body color. Keys drive which
  // sprite drawer render.js uses.
  // ---------------------------------------------------------------------------
  const ENEMIES = [
    { key: 'zombie',   name: 'Zombie',   minDungeon: 1,  hpMod: 0.85, dmgMod: 0.8,  spd: 56, size: 17, tint: '#80975a', xp: 1.0 },
    { key: 'skeleton', name: 'Skeleton', minDungeon: 3,  hpMod: 1.0,  dmgMod: 1.0,  spd: 72, size: 17, tint: '#d8d2c2', xp: 1.15 },
    { key: 'mutant',   name: 'Mutant',   minDungeon: 7,  hpMod: 1.6,  dmgMod: 1.3,  spd: 52, size: 22, tint: '#a8616f', xp: 1.4 },
    { key: 'alien',    name: 'Alien',    minDungeon: 15, hpMod: 2.2,  dmgMod: 1.7,  spd: 84, size: 19, tint: '#5fae84', xp: 1.8 },
    { key: 'dragon',   name: 'Dragon',   minDungeon: 30, hpMod: 4.0,  dmgMod: 2.4,  spd: 64, size: 27, tint: '#7d5bd6', xp: 2.6 },
  ];

  // ---------------------------------------------------------------------------
  // THE MECH FACTION — deliberately NOT in ENEMIES.
  //
  // allowedEnemies() in game-v93 is `C.ENEMIES.filter(e => currentDungeon >= e.minDungeon)`,
  // and the zone list in ui-v94 uses the SAME filter to decide which creature to
  // print on every zone card. Putting Mechs in that array would have dropped a new
  // enemy line into the normal rotation of every deep zone in the game and rewritten
  // the zone board, on live accounts, as a side effect of shipping a faction that is
  // supposed to be opt-in. A separate table cannot do that: nothing reads it except
  // the Mech region's own spawner.
  //
  // `mech` is the key into MECHCORR.HOSTILE — the corruption class this unit applies.
  // Ceilings there hold a 1:2:4:6:10 ratio, so the ladder reads as a real escalation
  // rather than five units with the same debuff at different sizes.
  //
  // `world` is the CORRUPTED PLANET this class holds. The Foundry does not fight in
  // space — each tier is a landing on a world the Mechs have taken, and `stage` is
  // how far gone it is. One table so the tier card and the battlefield can never
  // disagree about what colour a planet is: render.js paints the surface from these
  // exact values and mech-foundry.js draws the card disc from them.
  //
  // THE PALETTE IS MARS, NOT VOID. Rusted iron-oxide ground with the corruption
  // burning red through it — a lit world you have landed on, rather than a black
  // plate. It also has to stay a MID tone: the arena draws white damage numbers
  // and white health bars straight onto this ground, so a genuinely pale surface
  // would wash the combat readout out. Each world darkens and reddens as its
  // corruption stage advances, so the ladder is legible at a glance.
  const MECHS = [
    { key: 'mspawn',   name: 'Mech Spawn',   mech: 'mspawn',   hpMod: 1.1, dmgMod: 0.9, spd: 78, size: 15, tint: '#c2323f', xp: 1.2,
      world: { name: 'Verath',   stage: 'SEEDED',      sky: '#3d2720', ground: '#7d5639', rock: '#6a442c', vein: '#d4462f' } },
    { key: 'mgremlin', name: 'Mech Gremlin', mech: 'mgremlin', hpMod: 1.7, dmgMod: 1.2, spd: 88, size: 18, tint: '#d13645', xp: 1.6,
      world: { name: 'Korrus',   stage: 'OVERRUN',     sky: '#3a2019', ground: '#764a2e', rock: '#603923', vein: '#e04a2d' } },
    { key: 'mbeast',   name: 'Mech Beast',   mech: 'mbeast',   hpMod: 3.2, dmgMod: 1.8, spd: 62, size: 24, tint: '#e03a4c', xp: 2.4,
      world: { name: 'Dravok',   stage: 'CONSUMED',    sky: '#341b17', ground: '#6d4028', rock: '#57301d', vein: '#ef4a34' } },
    { key: 'marchon',  name: 'Mech Archon',  mech: 'marchon',  hpMod: 6.0, dmgMod: 2.6, spd: 54, size: 30, tint: '#f04455', xp: 3.6,
      world: { name: 'Sethyr',   stage: 'ENTHRONED',   sky: '#2e1712', ground: '#643723', rock: '#4e2819', vein: '#ff4a3a' } },
    { key: 'mtitan',   name: 'Mech Titan',   mech: 'mtitan',   hpMod: 11.0, dmgMod: 3.4, spd: 40, size: 38, tint: '#ff4d5e', xp: 5.2,
      world: { name: 'Malgrave', stage: 'FORGE WORLD', sky: '#29120e', ground: '#5c301d', rock: '#462115', vein: '#ff5a3c' } },
  ];
  const MECH_BY_KEY = {};
  MECHS.forEach((m) => { MECH_BY_KEY[m.key] = m; });

  // ---------------------------------------------------------------------------
  // SCALING FORMULAS — the heart of infinite progression
  //
  // Difficulty grows GEOMETRICALLY per dungeon (~1.55x). Crucially, item power
  // scales at the SAME rate (see items.js), so gear farmed in dungeon D lets you
  // clear D and push to D+1. Flat stats (damage/health) carry the scaling;
  // percent stats (speed/crit) stay modest so they never explode.
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // PILOT LEVEL CAP — the wall that makes ascension mandatory rather than
  // optional. Lv 150 with no stars, +50 per Ascension Star: ★1 → 200, ★2 → 250,
  // ★3 → 300, and onward forever. At the cap XP stops accruing entirely, so the
  // only route to a higher level is to ascend. That IS the prestige loop.
  // ---------------------------------------------------------------------------
  const LEVEL_CAP_BASE = 150, LEVEL_CAP_PER_STAR = 50;
  function levelCap(stars) {
    const s = stars == null ? ascStars() : Math.max(0, stars | 0);
    return LEVEL_CAP_BASE + LEVEL_CAP_PER_STAR * s;
  }
  // XP required to advance FROM `level` to level+1.
  // Hybrid linear*exponential: L1->2 = 100, L2->3 ≈ 165, scales forever.
  // BAND WALLS (Jul 2026 pass — much steeper): every 100 levels the whole curve
  // steps up another ×12 (was ×5), AND the per-100 surcharge escalates: ×20
  // past 100, ×60 past 200, ×180 past 300… (×3 per band). Levels past 100 are
  // meant to be EARNED — each century is a whole new career.
  //
  // CENTURY STEEPENING (Aug 2026). The walls above are STEPS — they jump once at
  // each century line and then the curve climbs at the same 1.11/level it used at
  // level 3. So the gap between consecutive levels barely widened inside a
  // century, and 140→141 felt like 40→41 with a bigger number on it. Every level
  // ABOVE 100 now compounds an extra per-level rate, and that rate itself steps up
  // each century, so the gap between neighbouring levels keeps opening the deeper
  // you go. Levels 1–99 are untouched — the early game is not the problem.
  //
  // THE RATES ARE MEASURED, NOT GUESSED. The first pass used 1.2%–2.8% and did
  // nothing: the linear term (120 + 120*level) decays as level grows — its own
  // ratio falls from 1.0196 at L50 to 1.0066 at L150 — and it ate the whole
  // increment. L150 came out at 1.1308× per level, BELOW L50's 1.1318×. These
  // values are set against the real ratio xpToNext(l+1)/xpToNext(l):
  //
  //     L50 (pre-100, unchanged) 1.132   L150 1.168   L250 1.176
  //     L350 1.186                       L450 1.196   L550 1.206
  //
  // Each century's gap is now genuinely wider than the last — about a point of
  // growth per century — which is the whole point. The flat [1,2,3,6,10,10] band
  // pass below is REMOVED in the same step: it was a blunt version of this, and
  // keeping both stacked two band taxes on top of each other. Level caps are
  // 150 + 50/star, so the 100s band is where most pilots live and the deep bands
  // are already gated behind ascension stars.
  const LVL_STEEP = [0, 0.045, 0.055, 0.065, 0.075, 0.085];   // extra growth PER LEVEL, by century
  function centuryGrowth(level) {
    if (level < 100) return 1;
    let m = 1;
    const top = Math.min(5, Math.floor(level / 100));
    for (let b = 1; b <= top; b++) {
      const from = b * 100;
      const to = b === 5 ? level : Math.min(level, (b + 1) * 100 - 1);
      m *= Math.pow(1 + LVL_STEEP[b], Math.max(0, to - from + 1));
    }
    return m;
  }
  function xpToNext(level) {
    const band = Math.min(5, Math.floor(level / 100)); // ×1, ×12, ×144, ×1728, …
    let xp = (120 + 120 * level) * Math.pow(1.11, level - 1) * Math.pow(12, band);
    xp *= 3;                      // global 3× leveling cost
    if (level >= 100) xp *= 20 * Math.pow(3, band - 1);   // 20× past 100, 60× past 200, 180× past 300…
    xp *= centuryGrowth(level);         // Aug 2026: the gap widens EVERY level past 100
                                        // (supersedes the old flat [1,2,3,6,10,10] band pass)
    return Math.floor(xp);
  }

  // ITEM LEVEL of a zone — zone², the geometric curve gear generation and
  // blueprint gates are built on. NOT a player-facing number: it climbs
  // quadratically, so Zone 264 reads "69,696" and cannot be compared to a pilot
  // level. items.js and the blueprint drops use it; nothing shown to a player
  // should. Kept under its historical name so those call sites are untouched.
  function dungeonEnemyLevel(dungeon) {
    return dungeon * dungeon;
  }
  // ===========================================================================
  // THE ONE CONVERSION: ZONE → PILOT LEVEL
  // ---------------------------------------------------------------------------
  // A player knows exactly one number about their own strength: their level. So
  // every difficulty statement in the game — grind zones, the high-risk warning,
  // cargo shipments — states the level of PILOT the content is built for, and
  // lets them compare it to their own.
  //
  // The conversion already exists implicitly: unlockCeil() decides how far past
  // your level you may fly, so its inverse — the lowest level that unlocks a
  // zone — IS that zone's pilot level. Zone 156 ↔ Lv 128. Zone 264 ↔ Lv 250.
  // game-v93's zoneReqLevel() now delegates here, so the number that gates a
  // zone and the number that describes it can never drift apart.
  const LVL_BANDS = [[1, 100, 35], [100, 200, 28], [200, 300, 14], [300, 400, 7], [400, 500, 4], [500, Infinity, 0]];
  function zoneCombatLevel(zone) {
    const d = Math.max(1, zone | 0);
    for (const [lo, hi, ahead] of LVL_BANDS) {
      const L = Math.max(1, d - ahead);
      if (L >= lo && L < hi) return L;
    }
    return d;
  }

  // The master geometric difficulty/reward multiplier for a dungeon.
  // REBALANCE (Aug 2026): pure 1.18^zone spun out of control — zone 400 accounts
  // hit 1e29 HP/damage, numbers no human reads and float maths near its ceiling.
  // The curve now TAPERS: identical through zone 100 (early/mid game untouched),
  // then +2%/zone to 300 and +1%/zone beyond. Ultimate endgame lands in the
  // billions–trillions. Because ENEMY hp/damage and ITEM power both ride this one
  // function, per-zone balance is bit-for-bit identical — only magnitudes shrink.
  // XP is deliberately NOT on this curve (see enemyXp) so leveling pace is
  // unchanged. LEGACY curve kept for the scaleVer-4 save migration.
  const SCALE_BASE = 1.18, OLD_SCALE_BASE = 1.55;  // OLD kept for save migration
  const S100 = Math.pow(SCALE_BASE, 99);           // ≈1.31e7 — the taper anchor
  const S300 = S100 * Math.pow(1.02, 200);         // ≈6.9e8
  function dungeonScale(dungeon) {
    const z = Math.max(1, dungeon);
    if (z <= 100) return Math.pow(SCALE_BASE, z - 1);
    if (z <= 300) return S100 * Math.pow(1.02, z - 100);
    return S300 * Math.pow(1.01, z - 300);
  }
  // the retired un-tapered curve — migration maths only, never balance
  function dungeonScaleLegacy(dungeon) { return Math.pow(SCALE_BASE, Math.max(1, dungeon) - 1); }

  // Enemy max HP for a dungeon.
  // ---- CENTURY DIFFICULTY BANDS (Aug 2026) ---------------------------------
  // dungeonScale() TAPERS past zone 100 (+2%/zone, then +1%) to keep the numbers
  // readable, and both enemy ramps below used to FLATTEN around zone 81–91. The
  // combined effect was that deep zones got easier relative to a levelling fleet
  // — exactly backwards. These multipliers step the enemy up once per century so
  // each 100-zone band is a real difficulty tier.
  //
  // Applied to the enemy RAMPS only, never to dungeonScale itself: item power
  // rides that curve and rescaling it would desync every item already rolled
  // (that is what the scaleVer-4 migration exists to repair — not a thing to
  // trigger twice). HP leads, damage follows at a gentler rate so depth is a
  // grind-and-survive problem rather than a one-shot wall.
  const HP_BAND  = [1, 1.40, 1.80, 2.20, 2.60, 3.00];
  const DMG_BAND = [1, 1.25, 1.50, 1.75, 2.00, 2.25];
  const century = (zone) => Math.min(5, Math.floor(Math.max(1, zone) / 100));

  // Enemy max HP for a dungeon. Tuned HIGH on purpose: combat is about
  // GRINDING units down over several volleys, not one-shotting the screen —
  // an on-level enemy should soak a good handful of hits before breaking.
  function enemyHp(dungeon) {
    // REBALANCE (Jul 2026): the old fast-lane ramp (0.04→0.16) + flat deep ramp
    // let player DPS creep one-shot whole zones. Baseline +27%, the 1–25 band
    // roughly doubled, and 32+ now keeps climbing (up to 2.5×) so a fixed fleet
    // stops deleting everything a few zones past its gear tier.
    let ramp;
    if (dungeon <= 25) {
      ramp = 0.08 + (dungeon - 1) * (0.27 / 24);   // 0.08 → 0.35 across 1–25
    } else if (dungeon <= 31) {
      ramp = 0.35 + (dungeon - 25) * ((1 - 0.35) / 6); // 0.35 → 1 across 26–31
    } else {
      ramp = 1 + Math.min(1.5, (dungeon - 31) * 0.025); // 1 → 2.5× by zone ~91
    }
    ramp *= HP_BAND[century(dungeon)];                  // century tier on top
    return Math.max(10, Math.floor((320 * dungeonScale(dungeon) + 38) * ramp));
  }

  // Contact damage an enemy deals per hit. Kept low relative to player HP so a
  // small swarm is survivable WITH appropriate gear; over-pushing still kills,
  // because enemy damage scales geometrically while your HP lags if under-geared.
  // (Also see the per-hit cap in entities.js — no single hit can one-shot you.)
  function enemyDamage(dungeon) {
    // zones 1–25 hit soft — the easy-grind band stays forgiving (slightly less
    // so after the Jul 2026 rebalance), then damage ramps to full over 26–31
    // and keeps a mild climb at depth so pushing always carries risk.
    let ramp;
    if (dungeon <= 25) {
      ramp = 0.42 + (dungeon - 1) * (0.20 / 24);   // 0.42 → 0.62 across 1–25
    } else if (dungeon <= 31) {
      ramp = 0.62 + (dungeon - 25) * ((1 - 0.62) / 6); // 0.62 → 1 across 26–31
    } else {
      ramp = 1 + Math.min(0.5, (dungeon - 31) * 0.01); // 1 → 1.5× by zone ~81
    }
    ramp *= DMG_BAND[century(dungeon)];                 // century tier on top
    return Math.max(1, Math.floor((2.1 * dungeonScale(dungeon) + 1) * ramp));
  }

  // XP granted for a kill — rises with dungeon to reward pushing deeper.
  function enemyXp(dungeon) {
    // XP curve deliberately FLAT vs zone depth — deep-zone / over-level kills
    // were paying out far too much. exp 0.82 → 0.42 crushes the high end while
    // leaving early zones roughly intact.
    // XP rides the LEGACY curve on purpose: xpToNext() is unchanged, so putting
    // XP on the tapered combat curve would silently freeze leveling past ~z100.
    // XP is not an HP/damage readout — the Aug 2026 rescale does not apply.
    return Math.floor(11 * Math.pow(dungeonScaleLegacy(dungeon), 0.42) + 9);
  }

  // Gold granted for a kill.
  function enemyGold(dungeon) {
    return Math.floor(6 * Math.pow(dungeonScale(dungeon), 0.7) + 3);
  }

  // Chance an enemy drops loot at all (before rarity roll).
  // Zones 1–5: EVERY kill drops — the opening minutes shower (rarity-capped) loot.
  function dropChance(dungeon) {
    if (dungeon >= 1 && dungeon <= 5) return 1;
    return Math.min(0.55, 0.32 + dungeon * 0.004);
  }

  // ---------------------------------------------------------------------------
  // RARITY CAP — loot quality is progression-gated. Each zone band has a hard
  // ceiling on what can DROP there: no Divine/Cosmic raining on Zone 1. Bosses
  // and citadels may beat the cap by exactly ONE tier (their flat bonuses are
  // clamped in game.js). Tier index → see RARITY above.
  // ---------------------------------------------------------------------------
  function rarityCap(zone) {
    // ZONE half of the rarity gate. The ASCENSION half is ascRarityCap(); the roll
    // takes min(both), so BOTH have to reach a tier for it to drop.
    //
    // This function used to stop at 13 (Artifact) for every zone, which silently
    // made the three ascension-exclusive tiers unobtainable at any zone, at any
    // star count — ascReq was gating a tier that the zone cap had already
    // excluded. The top three now open with depth as well, so reaching them takes
    // ascensions AND the zones to match.
    if (zone >= 170) return 16;  // Paragon
    if (zone >= 140) return 15;  // Celestial
    if (zone >= 115) return 14;  // Ascendant
    if (zone >= 100) return 13;  // Artifact
    if (zone >= 90)  return 12;  // Relic
    if (zone >= 78)  return 11;  // Primordial
    if (zone >= 66)  return 10;  // Eternal
    if (zone >= 55)  return 9;   // Void
    if (zone >= 44)  return 8;   // Cosmic
    if (zone >= 34)  return 7;   // Divine
    if (zone >= 25)  return 6;   // Ancient
    if (zone >= 17)  return 5;   // Mythic
    if (zone >= 10)  return 4;   // Legendary
    if (zone >= 5)   return 3;   // Epic
    return 2;                    // Rare (zones 1–4)
  }

  // Per-level player base stats (before gear).
  const PLAYER_BASE = {
    attackDamage: 14,   // flat, +2 per level
    attackSpeed:  1.3,  // attacks per second
    critChance:   5,    // %
    critDamage:   50,   // % bonus on crit (so crit = 1.5x at start)
    health:       200,  // +18 per level
    moveSpeed:    100,  // %
  };
  function playerBaseStat(key, level) {
    switch (key) {
      case 'attackDamage': return PLAYER_BASE.attackDamage + (level - 1) * 2;
      case 'health':       return PLAYER_BASE.health + (level - 1) * 18;
      case 'attackSpeed':  return PLAYER_BASE.attackSpeed;
      case 'critChance':   return PLAYER_BASE.critChance;
      case 'critDamage':   return PLAYER_BASE.critDamage;
      case 'moveSpeed':    return PLAYER_BASE.moveSpeed;
      default: return 0;
    }
  }

  // Sell value of an item, based on the dungeon it dropped from and rarity.
  function sellValue(item) {
    const r = RARITY[item.rarity];
    const d = item.dungeon || 1;
    return Math.floor(10 * Math.pow(dungeonScale(d), 0.7) * (r.tier + 1) * 0.8 + 6);
  }

  // ---------------------------------------------------------------------------
  // SALVAGE — scrapping an item also has a CHANCE to recover "My Galaxy"
  // resources (fuel / iron / plasma). Both the odds and the amount scale with
  // rarity, and the scarcer resources only salvage off rarer gear — mirroring
  // how the galaxy gates iron (ring 2+) and plasma (ring 4+). Returns a
  // { fuel|iron|plasma: amount } object, or null when nothing was recovered.
  // ---------------------------------------------------------------------------
  function salvage(item) {
    const tier = RARITY[item.rarity] ? RARITY[item.rarity].tier : 0;
    const chance = Math.min(0.9, 0.18 + tier * 0.08);
    if (Math.random() >= chance) return null;
    // which resource: fuel is the workhorse, but iron & plasma salvage off ANY
    // gear now — just with weights (and amounts) that climb with rarity, so
    // scrapping your grind loot is a real iron/plasma faucet.
    const w = {
      fuel: 10,
      iron: 3.5 + tier * 1.1,
      plasma: 2.2 + tier * 1.0,
    };
    const total = w.fuel + w.iron + w.plasma;
    let roll = Math.random() * total, kind = 'fuel';
    for (const k of ['fuel', 'iron', 'plasma']) { if (roll < w[k]) { kind = k; break; } roll -= w[k]; }
    // amount: scales with rarity; iron/plasma salvage nearly as much as fuel
    const km = kind === 'fuel' ? 1 : 0.8;
    const amt = Math.max(1, Math.round((1.4 + tier * 0.9) * km * (0.6 + Math.random() * 0.8)));
    return { [kind]: amt };
  }

  // ---------------------------------------------------------------------------
  // SPECIAL STATS — rare bonus lines that can appear on ANY item, independent
  // of the normal stat roll. They do NOT scale with zone (they'd break the
  // game), and they appear infrequently, which makes finding one exciting.
  // ---------------------------------------------------------------------------
  // Life Steal: heal a % of damage dealt. 0.2–1%, with 1% extremely rare.
  function rollLifeSteal() {
    const r = Math.random();
    if (r < 0.50) return 0.2;
    if (r < 0.78) return 0.4;
    if (r < 0.92) return 0.6;
    if (r < 0.985) return 0.8;
    return 1; // very rare
  }
  // Multi-Shot: % chance per attack to also fire at up to MULTISHOT_MAX_TARGETS
  // additional nearby enemies. 10–25%, higher values rarer.
  function rollMultiShot() {
    const r = Math.random();
    if (r < 0.45) return 10 + ((Math.random() * 3) | 0); // 10–12
    if (r < 0.75) return 13 + ((Math.random() * 3) | 0); // 13–15
    if (r < 0.90) return 16 + ((Math.random() * 4) | 0); // 16–19
    if (r < 0.98) return 20 + ((Math.random() * 3) | 0); // 20–22
    return 23 + ((Math.random() * 3) | 0);               // 23–25 (rare)
  }
  const SPECIALS = [
    { key: 'lifeSteal', chance: 0.07, roll: rollLifeSteal },
    { key: 'multiShot', chance: 0.06, roll: rollMultiShot },
  ];
  const MULTISHOT_MAX_TARGETS = 10;

  // ---------------------------------------------------------------------------
  // COSMETICS — premium hull skins & auras (Market → Cosmetics). Purely visual,
  // never affect power. Priced in CREDITS (premium currency — see payments.js).
  // `sw` is the CSS preview swatch used by the store cards.
  // ---------------------------------------------------------------------------
  const COSMETICS = {
    skins: [
      { key: 'stock',     name: 'Factory Stock', credits: 0,   desc: 'Original hull finish', sw: 'linear-gradient(135deg,#8a97ad,#4a5468)' },
      { key: 'crimson',   name: 'Crimson Fang',  credits: 240, desc: 'Blood-red raider plating', sw: 'linear-gradient(135deg,#e84a5f,#8a1626)' },
      { key: 'arctic',    name: 'Arctic Ghost',  credits: 240, desc: 'Polar-white stealth finish', sw: 'linear-gradient(135deg,#eef7ff,#9cc4e0)' },
      { key: 'tiger',     name: 'Tiger Strike',  credits: 320, desc: 'Predator stripes — fear travels faster than lasers', sw: 'repeating-linear-gradient(115deg,#e8801e 0 7px,#1a1208 7px 13px)' },
      { key: 'void',      name: 'Voidplate',     credits: 320, desc: 'Hull forged in deep-space shadow', sw: 'linear-gradient(135deg,#3c146e,#120826)' },
      { key: 'gilded',    name: 'Gilded',        credits: 560, desc: 'Solid-gold flex for the top of the board', sw: 'linear-gradient(135deg,#ffe27a,#c89020 60%,#ffeebc)' },
      { key: 'prismatic', name: 'Prismatic',     credits: 720, desc: 'Animated rainbow chrome — the rarest finish in the galaxy', sw: 'linear-gradient(115deg,#ff5168,#ffa838,#46d27a,#4fa6ff,#b87bff)' },
    ],
    auras: [
      { key: 'none',      name: 'No Aura',        credits: 0,   desc: 'Clean space around your hull', sw: 'radial-gradient(circle,#1c2433 40%,#0c111b)' },
      { key: 'sentinel',  name: 'Sentinel Rings', credits: 300, desc: 'Twin counter-rotating guardian rings', sw: 'radial-gradient(circle,#0c111b 42%,#f2b24b 46%,#0c111b 52%,rgba(242,178,75,.5) 60%,#0c111b 66%)' },
      { key: 'frost',     name: 'Cryo Field',     credits: 380, desc: 'A crystalline frost lattice orbits your ship', sw: 'radial-gradient(circle,#0c111b 40%,#9ad4ff 55%,#0c111b 70%)' },
      { key: 'flame',     name: 'Solar Flare',    credits: 380, desc: 'Licks of starfire ring the hull', sw: 'radial-gradient(circle,#0c111b 35%,#ff9a3c 55%,#0c111b 75%)' },
      { key: 'voidstorm', name: 'Void Storm',     credits: 520, desc: 'Captive void motes swarm in orbit', sw: 'radial-gradient(circle,#0c111b 40%,#9a5bff 58%,#0c111b 75%)' },
      { key: 'prism',     name: 'Prismatic Halo', credits: 720, desc: 'A rotating rainbow halo — pairs with the Prismatic skin', sw: 'conic-gradient(#ff5168,#ffa838,#46d27a,#4fa6ff,#b87bff,#ff5168)' },
    ],
  };

  // ---------------------------------------------------------------------------
  // STORE — speed + offline play are FREE (no real-money purchases in this game)
  // ---------------------------------------------------------------------------
  // THREE TIERS (build 712). 4× and 5× are GONE — the ladder was six rungs deep
  // with three of them free, which made the paid one a small step and the whole
  // row a wall of pills. It is now one clear line: 1× is the game, 2× is bought
  // once with LootCoins, 3× is what Pro gives you.
  //
  // The LootCoin tier keeps the sku 'speed4lc'. It reads wrong and it is
  // deliberate: that string is written into every existing save that bought the
  // old 4×, and renaming it would revoke a paid unlock from everyone who owns
  // it. The sku is a receipt, not a label.
  const SPEED_TIERS = [
    { mult: 1, label: '1×', price: 0, priceLabel: 'Default', sku: null },
    // PREMIUM — unlocked ONLY by spending 500 LootCoins (see ui.js + game.js)
    { mult: 2, label: '2×', price: 0, priceLabel: '500 LootCoins', sku: 'speed4lc', lootcoins: 500 },
    // PRO — exclusive to the LootFleet Pro subscription ($20/mo)
    { mult: 3, label: '3×', price: 0, priceLabel: 'PRO', sku: 'pro3', pro: true },
    // SECRET — never shown or settable until the Mothership easter egg fires
    { mult: 10, label: '10×', price: 0, priceLabel: 'Secret', sku: null, secret: true },
  ];
  const STORE = {
    afk: { sku: 'afk', name: 'AFK Combat Mode', price: 0, priceLabel: 'Free',
           blurb: 'Your operator keeps fighting while you\'re offline — real kills, loot, XP and gold. They can also be killed and lose gear, just like live play.' },
  };

  // ---------------------------------------------------------------------------
  // SHIPS — 10 purchasable hulls forming a single upgrade chain. Each is bought
  // with GOLD, and unlocks only after you've scored `reqKills` kills while
  // piloting the PREVIOUS hull. Hulls grant slot layouts (weapons / ammo /
  // plating), passive stat mods, and — for carrier classes — DRONE BAYS. While
  // flying a carrier, kills have a chance to drop a drone that fills an empty
  // bay; drones orbit your ship, fire their own weapons, and swarm enemies.
  // Every hull keeps its own saved fitting, so you can swap freely.
  // ---------------------------------------------------------------------------
  const SHIPS = [
    { key:'frigate',     name:'Frigate',        cls:'Frigate',    price:0,           reqKills:0,     weapons:1, ammo:1, hull:1, drones:0, mods:{moveSpeed:18},                                  tag:'Starter · Fast', desc:'Nimble starter hull. Quick thrusters, one of everything.' },
    { key:'interceptor', name:'Interceptor',    cls:'Frigate',    price:25000,       reqKills:600,   weapons:1, ammo:1, hull:1, drones:0, mods:{moveSpeed:34,critChance:6,dmgPct:6},            tag:'Fast Attack',    desc:'Even faster strike hull. +34% Move, +6% Crit & Damage.' },
    { key:'cruiser',     name:'Cruiser',        cls:'Cruiser',    price:150000,      reqKills:1500,  weapons:2, ammo:1, hull:1, drones:0, mods:{dmgPct:14},                                    tag:'Twin Cannons',   desc:'Second weapon hardpoint. +14% Damage.' },
    // CHROMA FANG — LootCoin cruiser with SPECTRUM cannons: every bolt fires as
    // a vibrant rainbow streak (same tracer tech as the Titan Sina).
    { key:'chromafang', name:'Chroma Fang', cls:'Cruiser', price:0, reqKills:0, weapons:2, ammo:1, hull:1, drones:0, mods:{dmgPct:14}, tag:'SPECTRUM TECH', purchase:{ lc:500 },
      desc:'A crystalline pink raider tuned to cruiser performance — its cannons fire pure spectrum: vibrant rainbow lasers streak from every hardpoint.' },
    { key:'heavycruiser',name:'Heavy Cruiser',  cls:'Cruiser',    price:750000,      reqKills:3000,  weapons:2, ammo:2, hull:2, drones:0, mods:{dmgPct:18,hpPct:18},                          tag:'Armored',        desc:'Twin ammo + plating. +18% Damage, +18% HP.' },
    { key:'destroyer',   name:'Destroyer',      cls:'Battleship', price:3000000,     reqKills:5400,  weapons:3, ammo:1, hull:1, drones:0, mods:{dmgPct:34,critChance:10},                     tag:'Glass Cannon',   desc:'Three weapons. Huge damage, light armor.' },
    { key:'battleship',  name:'Battleship',     cls:'Battleship', price:12000000,    reqKills:9000,  weapons:3, ammo:2, hull:2, drones:0, mods:{hpPct:45,dmgPct:18},                          tag:'Bruiser',        desc:'Three weapons, heavy plating. +45% HP, +18% Damage.' },
    // VERIDIAN — the MISSION VETERAN hull. Battleship-grade in every stat, plus
    // a verdant RESONANCE AURA that continuously burns everything near the ship,
    // scaling with your DPS. Earned ONLY by completing 1,000 lifetime missions
    // (accept it from the Mission Board banner) — never sold.
    { key:'veridian', name:'Veridian', cls:'Battleship', price:0, reqKills:0, weapons:3, ammo:2, hull:2, drones:0, mods:{hpPct:45,dmgPct:18}, tag:'MISSION VETERAN', missionShip:1000, dpsAura:true,
      desc:'The mission veteran\u2019s hull — Battleship-grade plating and firepower wrapped in a verdant resonance aura that constantly burns everything near the ship, scaling with your fleet\u2019s DPS. Awarded for 1,000 lifetime missions. Cannot be bought.' },
    { key:'dreadnought', name:'Dreadnought',    cls:'Battleship', price:50000000,    reqKills:15000, weapons:4, ammo:2, hull:3, drones:0, mods:{dmgPct:30,hpPct:45,critChance:8},            tag:'Capital Ship',   desc:'Four weapons, fortress plating. The line-breaker.' },
    { key:'carrier',     name:'Carrier',        cls:'Carrier',    price:200000000,   reqKills:24000, weapons:2, ammo:2, hull:2, drones:2, mods:{hpPct:25,dmgPct:12},                          tag:'Drone Bay ×2',   desc:'Launches drones that swarm and fire on their own. 2 drone bays.' },
    // AEGIS — carrier-tier FLEET SUPPORT hull. A side-branch (not required for
    // the upgrade chain): its unique role is hosting Warden support arrays —
    // their fleet-wide heal/buff aura is DOUBLED while you fly an Aegis.
    { key:'aegis',       name:'Aegis',          cls:'Aegis',      price:350000000,   reqKills:26000, weapons:3, ammo:2, hull:3, drones:2, side:true, mods:{hpPct:55,dmgPct:8,critChance:4,rangePct:12}, tag:'FLEET SUPPORT', desc:'Guardian hull built around Warden support arrays — their fleet heal/buff aura is DOUBLED while you fly the Aegis.' },
    // VANGUARD — the first FIGHTER CARRIER, and the entry point of a new hull
    // family. A SIDE-BRANCH, like the Aegis: not a rung on the upgrade ladder but
    // a different way to fight. One Fighter Bay, no cannon, no munitions and no
    // utility slots — every point of damage it deals leaves the ship. It flies at
    // a quarter of the reference hull's speed (`speedMult`), so the entire skill
    // is parking it where the fight will be before the fight arrives.
    // cls stays 'Carrier' — the hangar files by cls, and cls also drives escort
    // weapon type and accent. What makes this a FIGHTER carrier is
    // `fighterCapacity`, which is what every fighter rule actually tests. Same
    // convention the Dread hulls use to stay in the Carrier bucket.
    { key:'vanguard', name:'Vanguard', cls:'Carrier', price:0, reqKills:0,
      weapons:0, ammo:0, hull:2, drones:0, side:true, noUtility:true,
      fighterCapacity:4, speedMult:0.25,
      mods:{ hpPct:130, dmgPct:35, critChance:8 },
      tag:'FIGHTER CARRIER I',
      desc:'The first Heavy Fighter Carrier. It mounts no cannon at all — instead it carries FOUR FIGHTER BAYS, each holding one autonomous Heavy Fighter that launches on its own, picks its own target and swarms it. Fit a better fighter in a bay and that craft hits harder. Barely a quarter the speed of a normal hull, and the wing reaches only a short way out: position the carrier, and let the fighters do the killing.',
      // EARNED ON THE TOUR OF DUTY LADDER — Enlisted (free) track, level 40, which
      // is about three weeks of daily play. The blueprint drop and build order were
      // pulled in 607 and this replaced them in 619.
      //
      // `tour` REPLACES `unreleased` rather than joining it: `unreleased` means "no
      // route exists" and drives copy that says so outright, which became a lie the
      // moment the ladder started handing this hull out. It still needs the
      // sale guard — a price:0 hull otherwise reads as unlocked and affordable and
      // hands itself over free — so `tour` is in awardOnly() beside `missionShip`
      // and `event`, which are award-only for the same reason.
      tour:{ lv:40, track:'Enlisted' } },
    { key:'supercarrier',name:'Super Carrier',  cls:'Carrier',    price:900000000,   reqKills:39000, weapons:3, ammo:2, hull:3, drones:4, mods:{hpPct:40,dmgPct:24,critChance:8},            tag:'Drone Bay ×4',   desc:'3 weapons, heavy plating, 4 drone bays.' },
    { key:'titan',       name:'Titan Carrier',  cls:'Carrier',    price:4000000000,  reqKills:60000, weapons:4, ammo:3, hull:3, drones:8, mods:{hpPct:70,dmgPct:40,multiShot:14,critChance:12}, tag:'FLAGSHIP',      desc:'The apex hull. 4 weapons, 3 ammo, and 8 drone bays.' },
    // MOTHERSHIP — the endgame faction Titan Carrier. Bought ONLY with Galaxy
    // Resources (no gold), priced to be a weeks-long goal. Three extra weapon
    // hardpoints (7 total), increased natural weapon range, top-tier built-in
    // modifiers and superior base stats.
    { key:'mothership',  name:'Mothership',     cls:'Carrier',    price:0, resPrice:{ fuel:500000, iron:200000, plasma:120000 }, reqKills:90000, weapons:7, ammo:3, hull:3, drones:12, mods:{hpPct:140,dmgPct:80,multiShot:24,critChance:20,critDamage:60,moveSpeed:24,atkSpeedPct:24,rangePct:45,lifeSteal:0.8}, tag:'MOTHERSHIP', desc:'The ultimate faction vessel — 7 weapons, extended weapon range, 12 drone bays and superior base stats. Acquired exclusively with Galaxy Resources.' },
    // VOIDMAW — the Server Dreadnaught event exclusive, and the most
    // expensive hull in the game. Above Mothership-grade, with the SINGULARITY
    // proc: 12% per bolt to stun a target and tear open a black hole beneath it.
    // NEVER purchasable: assembled from 150 Voidmaw Parts earned only in the
    // event (stage drops, leaderboard ranks, Voidmaw Store).
    { key:'voidmaw', name:'Voidmaw', cls:'Carrier', price:0, reqKills:0, weapons:8, ammo:3, hull:3, drones:14, mods:{hpPct:170,dmgPct:105,multiShot:28,critChance:24,critDamage:75,moveSpeed:28,atkSpeedPct:30,rangePct:55,lifeSteal:1}, tag:'EVENT EXCLUSIVE', event:'sdread', perk:'● SINGULARITY — 12% per shot: stuns the target 1.6s and collapses a black hole beneath it. Everything caught inside is dragged to the core and ground for 22% of your attack damage per second over 3s. Bosses resist the stun but still burn in the well.', desc:'The Server Dreadnaught itself, refit for your fleet — the apex hull of the event. Its cannons punch holes in spacetime: targets are stunned and a singularity opens beneath them, dragging every nearby ship into the crush. Assembled ONLY from Voidmaw Parts earned in the Voidmaw world-boss event.' },
    // ---- THE MECH LINE ------------------------------------------------------
    // Five hulls, one per Mech class, each recovered from that class's own Foundry
    // tier. All are AWARD-ONLY (`event`), which is what keeps a price:0 hull out of
    // buyShip() — the same guard the Voidmaw, the Tour hulls and the build hulls
    // sit behind.
    //
    // NONE of them is the best hull at its weight, on purpose. The Mech line's
    // reason to fly is ARMOR CORRUPTION: it makes the other four ships in your
    // fleet hit harder. Stats are deliberately a notch under the gold-bought hull
    // a pilot could field at the same level, because the corruption is the payment.
    // See mech-corruption.js — the perk copy below is the only player-facing
    // statement of the numbers and it reads them off that table.
    { key: 'mechspawn', name: 'Mech Spawn', cls: 'Frigate', price: 0, reqKills: 0, weapons: 1, ammo: 1, hull: 2, drones: 0,
      mods: { hpPct: 22, dmgPct: 12, moveSpeed: 14, critChance: 5 },
      tag: 'MECH LINE', event: 'mech',
      perk: '⚙ MECH CORRUPTION — the entry-tier corruption field. Every hit from your fleet strips the target’s armor, to a small ceiling. Weak on its own, and the cheapest way to learn what the line does.',
      desc: 'The smallest Mech hull, cut down from a captured Spawn. It barely fights — but it corrupts, and everything else you own fires into the hole it opens.' },
    { key: 'mechgremlin', name: 'Mech Gremlin', cls: 'Cruiser', price: 0, reqKills: 0, weapons: 2, ammo: 1, hull: 2, drones: 1,
      mods: { hpPct: 40, dmgPct: 22, moveSpeed: 10, critChance: 8, atkSpeedPct: 10 },
      tag: 'MECH LINE', event: 'mech',
      perk: '⚙ MECH CORRUPTION — a faster, deeper corruption field than the Spawn’s, on a hull that can hold a lane.',
      desc: 'Gremlin plating on a cruiser frame. Quick to stack corruption and quick to reposition — the mid-game workhorse of the Mech line.' },
    { key: 'mechbeast', name: 'Mech Beast', cls: 'Battleship', price: 0, reqKills: 0, weapons: 3, ammo: 2, hull: 3, drones: 2,
      mods: { hpPct: 62, dmgPct: 32, critChance: 10, critDamage: 25, rangePct: 18 },
      tag: 'MECH LINE', event: 'mech',
      perk: '⚙ MECH CORRUPTION — heavy plating and a corruption field deep enough to matter against a boss.',
      desc: 'The first Mech hull that can take a hit as well as give one. Where the line stops being a curiosity and starts being a fleet decision.' },
    { key: 'mecharchon', name: 'Mech Archon', cls: 'Battleship', price: 0, reqKills: 0, weapons: 4, ammo: 3, hull: 3, drones: 4,
      mods: { hpPct: 95, dmgPct: 45, critChance: 14, critDamage: 40, atkSpeedPct: 18, rangePct: 30 },
      tag: 'MECH LINE', event: 'mech',
      perk: '⚙ MECH CORRUPTION — every hit from your fleet strips the target’s armor: −1% damage resistance a stack, to a maximum of −20%, lasting 5s. The target takes that much more damage from EVERY ship you own, not just this one.',
      desc: 'Captured Archon plating, refit and turned outward. The Archon is not your heaviest gun — it is the reason your heaviest gun lands harder. Its corruption field eats through hostile armor and every hull in your fleet fires into the hole.' },
    { key: 'mechtitan', name: 'Mech Titan', cls: 'Carrier', price: 0, reqKills: 0, weapons: 6, ammo: 3, hull: 3, drones: 10, speedMult: 0.7,
      mods: { hpPct: 155, dmgPct: 70, multiShot: 20, critChance: 18, critDamage: 60, rangePct: 40, lifeSteal: 0.6 },
      tag: 'MECH APEX', event: 'mech',
      perk: '⚙ TITAN CORRUPTION — −2% damage resistance a stack to a maximum of −40%, lasting 7s. The Titan builds its stacks slowly, so it is at its best against targets that live a long time: bosses, Dreadnaughts, alliance bosses and deep-wave hostiles. Flown alongside a Mech Archon both feed ONE corruption pool, to −60%.',
      desc: 'The apex of the Mech line and the heaviest amplifier in the game. Slow to move, slow to corrupt, and devastating against anything that survives long enough to be fully stripped. A fleet built around a Titan does not out-damage other fleets — it makes the target softer for all of them.' },
    // MECH SOVEREIGN — the Mech line's CAPSTONE, and the only Dread-class hull in
    // it. Not a sixth world: it is assembled once you own all five Mech hulls, so
    // it caps the ladder instead of extending it. Two cannons and SIX fighter bays
    // — the line's identity taken to its end, where the Sovereign itself barely
    // shoots and the wing plus the corruption field do the work.
    //
    // `tag` opens with DREAD-CLASS because the Hangar's class grouping picks on
    // exactly that prefix; without it this lands in the plain Carrier bucket.
    { key: 'mechsovereign', name: 'Mech Sovereign', cls: 'Carrier', price: 0, reqKills: 0,
      weapons: 2, ammo: 3, hull: 3, drones: 12, fighterCapacity: 6, speedMult: 0.6,
      mods: { hpPct: 210, dmgPct: 95, multiShot: 26, critChance: 22, critDamage: 85, rangePct: 50, lifeSteal: 1.2 },
      tag: 'DREAD-CLASS MECH', event: 'mech',
      perk: '⚙ SOVEREIGN CORRUPTION — the deepest corruption field in the game, and it feeds the same single pool every other Mech hull does. Two cannons only: the Sovereign is a CARRIER, and its six fighter bays plus the stripped armour of everything it looks at are the damage.',
      desc: 'The Mech line ends here. Six fighter bays launch a full wing while the Sovereign itself carries barely any guns — it does not need them. Everything it corrupts is softer for every ship you own, and the wing is what collects. Assembled only after all five Mech hulls are in your hangar.' },
    // CHROMA REGENT — LootCoin mothership at Titan Carrier performance, firing
    // the same full-spectrum rainbow cannons as the Chroma Fang.
    { key:'chromaregent', name:'Chroma Regent', cls:'Carrier', price:0, reqKills:0, weapons:4, ammo:3, hull:3, drones:8, mods:{hpPct:70,dmgPct:40,multiShot:14,critChance:12}, tag:'SPECTRUM MOTHERSHIP', purchase:{ lc:75000 },
      desc:'The Chroma line\u2019s crown — a rose-quartz mothership tuned to Titan Carrier performance. Every cannon fires streaks of vibrant rainbow light.' },
    // FROSTYFROST — LootCoin cryo hull at Titan Carrier performance. Its cannons
    // CHILL targets (slow) and sometimes flash-freeze them into an ice cube.
    // Bosses shrug the cryo effect off entirely.
    { key:'frostyfrost', name:'FrostyFrost', cls:'Carrier', price:0, reqKills:0, weapons:4, ammo:3, hull:3, drones:8, mods:{hpPct:70,dmgPct:40,multiShot:14,critChance:12}, tag:'CRYO TECH', purchase:{ lc:50000 }, frost:true,
      desc:'A crystalline glacier of a hull at Titan Carrier performance. Every hit chills its target — slowing them — and sometimes flash-freezes them solid in an ice cube. Bosses are immune to the cryo field.' },
    // MONOLITH LINE — ALLIANCE-EXCLUSIVE siege hulls carved from Hollow Armada
    // wreckage. Sold ONLY for ⬡ Alliance Coins in the Alliance Store. siegeBonus
    // = bonus damage vs boss-class targets (Zone Bosses, Citadels, Event Bosses)
    // AND vs the Hollow Armada alliance boss — +75% at the Apex.
    { key:'monolith1', name:'Monolith Shard', cls:'Cruiser', price:0, reqKills:0, weapons:2, ammo:1, hull:1, drones:0, mods:{dmgPct:25,hpPct:20}, tag:'ALLIANCE ⬡ I', alliance:true, acPrice:500, siegeBonus:0.20,
      desc:'A splinter of Hollow Armada hullstone wrapped around a teal reactor core — the first hull the Monolith Shipyard will cut for a new ally. Deals +20% damage to Zone Bosses, Citadels, Event Bosses and the Hollow Armada.' },
    { key:'monolith2', name:'Monolith Bastion', cls:'Battleship', price:0, reqKills:0, weapons:4, ammo:2, hull:2, drones:0, mods:{dmgPct:90,hpPct:120,multiShot:15}, tag:'ALLIANCE ⬡ II', alliance:true, acPrice:4500, siegeBonus:0.35, monoReq:'monolith1',
      desc:'Layered wreck-plate over triple hardpoints — a battleship that shrugs off return fire while it cracks fortifications. +35% damage to Zone Bosses, Citadels, Event Bosses and the Hollow Armada.' },
    { key:'monolith3', name:'Monolith Siegebreaker', cls:'Carrier', price:0, reqKills:0, weapons:5, ammo:2, hull:3, drones:10, mods:{dmgPct:260,hpPct:380,multiShot:55,critChance:35,critDamage:110,atkSpeedPct:55,rangePct:75}, tag:'ALLIANCE ⬡ III', alliance:true, acPrice:9000, siegeBonus:0.50, monoReq:'monolith2',
      desc:'A carrier-grade wall-breaker — five cannons and a drone screen tuned to one job: bringing down fortifications. +50% damage to Zone Bosses, Citadels, Event Bosses and the Hollow Armada.' },
    { key:'monolith4', name:'Monolith Apex', cls:'Carrier', price:0, reqKills:0, weapons:7, ammo:3, hull:3, drones:44, mods:{hpPct:1000,dmgPct:560,multiShot:150,critChance:55,critDamage:440,moveSpeed:95,atkSpeedPct:190,rangePct:300,lifeSteal:5.6}, tag:'ALLIANCE ⬡ APEX', alliance:true, acPrice:15000, siegeBonus:0.75, monoReq:'monolith3',
      desc:'The shipyard\u2019s final cut — Dread Reaver-grade performance whose entire mass is a siege weapon. +75% damage to Zone Bosses, Citadels, Event Bosses and the Hollow Armada itself.' },
    // OBLIVION SPEAR T1 — a forbidden new class one tier ABOVE the Mothership,
    // with roughly DOUBLE its combat performance. It can't be bought: you must
    // recover its blueprint (a 1% drop from a Lv300+ Void Citadel explosion in
    // the Zone Grind), prove yourself with 1,000,000 Mothership kills, pay a
    // staggering resource fortune, then WAIT 2 weeks for the hull to be built.
    { key:'oblivionspear', name:'Oblivion Spear', cls:'Carrier', price:0, reqKills:0, weapons:7, ammo:3, hull:3, drones:16,
      mods:{ hpPct:320, dmgPct:180, multiShot:48, critChance:40, critDamage:140, moveSpeed:30, atkSpeedPct:60, rangePct:95, lifeSteal:1.8 },
      tag:'OBLIVION SPEAR T1',
      desc:'A forbidden tier above the Mothership — twice the firepower, twice the plating, 16 drone bays. Forged only from a stolen blueprint, a million kills, and a fortune in resources.',
      bpDrop:{ minCitLevel:300, chance:0.01 },
      build:{ reqShip:'mothership', reqShipKills:1000000, cost:{ fuel:120000000, iron:60000000, plasma:40000000, prism:5000 } } },
    // OBLIVION SPEAR ALPHA — the apex prototype, TWICE as hard to earn as the T1
    // and twice the hull again (≈4× a Mothership). Its blueprint only drops from
    // the very deepest Lv500+ citadels (half the odds), it demands you already
    // own the T1 and have ground 2,000,000 kills in it, costs a king's ransom,
    // and takes a full MONTH to build.
    { key:'oblivionspearalpha', name:'Oblivion Spear Alpha', cls:'Carrier', price:0, reqKills:0, weapons:7, ammo:3, hull:3, drones:24,
      mods:{ hpPct:640, dmgPct:360, multiShot:96, critChance:50, critDamage:280, moveSpeed:40, atkSpeedPct:120, rangePct:150, lifeSteal:3.2 },
      tag:'OBLIVION SPEAR · ALPHA',
      desc:'The apex prototype — double the Oblivion Spear again, 24 drone bays, reality-bending output. The single hardest vessel in the galaxy to forge.',
      bpDrop:{ minCitLevel:500, chance:0.005, reqOwn:'oblivionspear' },
      build:{ reqShip:'oblivionspear', reqShipKills:2000000, cost:{ fuel:400000000, iron:200000000, plasma:140000000, prism:20000 } } },
    // OBLIVION FINAL — the ultimate hull, sold for LootCoins only (Lv200+). It is
    // 2.5× the original Oblivion Spear in every stat, renders at colossal scale,
    // and projects a unique GREEN reactor aura.
    { key:'oblivionfinal', name:'Oblivion Final', cls:'Carrier', price:0, reqKills:0, weapons:7, ammo:3, hull:3, drones:40,
      mods:{ hpPct:800, dmgPct:450, multiShot:120, critChance:55, critDamage:350, moveSpeed:75, atkSpeedPct:150, rangePct:240, lifeSteal:4.4 },
      tag:'OBLIVION FINAL',
      desc:'The final hull. 2.5× the Oblivion Spear in every dimension, wreathed in a green reactor aura. Sold outright for LootCoins — no level gate, no blueprint.',
      greenAura:true,
      purchase:{ lc:300000 } },
    // DREAD-CLASS — six recovered Dreadnaught hulls, sold directly for a MIX of
    // every currency at a steeper price than the Oblivion Final, each one a step
    // beyond it in raw performance. Gated by account level, not the blueprint chain.
    { key:'dread1', name:'Dread Reaver', cls:'Carrier', price:0, reqKills:0, weapons:7, ammo:3, hull:3, drones:44,
      mods:{ hpPct:1040, dmgPct:585, multiShot:156, critChance:60, critDamage:455, moveSpeed:98, atkSpeedPct:195, rangePct:312, lifeSteal:5.8 },
      tag:'DREAD-CLASS I', dreadAura:true, reqLevel:100,
      desc:'First of the recovered Dreadnaughts — already a tier beyond the Oblivion Final. Bought with a mix of every currency.',
      megaCost:{ gold:5e9, fuel:60e6, iron:40e6, plasma:25e6, prism:4000, credits:35000, dreadCores:6 } },
    { key:'dread2', name:'Dread Sovereign', cls:'Carrier', price:0, reqKills:0, weapons:7, ammo:3, hull:3, drones:52,
      mods:{ hpPct:1280, dmgPct:720, multiShot:192, critChance:65, critDamage:560, moveSpeed:120, atkSpeedPct:240, rangePct:384, lifeSteal:7 },
      tag:'DREAD-CLASS II', dreadAura:true, reqLevel:120,
      desc:'A command Dreadnaught bristling with hardpoints. Strictly superior to the Reaver.',
      megaCost:{ gold:10e9, fuel:120e6, iron:80e6, plasma:50e6, prism:8000, credits:45000, dreadCores:12 } },
    { key:'dread3', name:'Dread Leviathan', cls:'Carrier', price:0, reqKills:0, weapons:7, ammo:3, hull:3, drones:60,
      mods:{ hpPct:1560, dmgPct:878, multiShot:234, critChance:70, critDamage:683, moveSpeed:146, atkSpeedPct:293, rangePct:468, lifeSteal:8.6 },
      tag:'DREAD-CLASS III', dreadAura:true, reqLevel:140,
      desc:'A leviathan-scale hull whose reactor output dwarfs the lesser Dreads.',
      megaCost:{ gold:15e9, fuel:180e6, iron:120e6, plasma:75e6, prism:12000, credits:55000, dreadCores:18 } },
    { key:'dread4', name:'Dread Harbinger', cls:'Carrier', price:0, reqKills:0, weapons:7, ammo:3, hull:3, drones:72,
      mods:{ hpPct:1880, dmgPct:1058, multiShot:282, critChance:75, critDamage:823, moveSpeed:176, atkSpeedPct:353, rangePct:564, lifeSteal:10.4 },
      tag:'DREAD-CLASS IV', dreadAura:true, reqLevel:160,
      desc:'A harbinger of the apex Dreads — overwhelming firepower across 72 drone bays.',
      megaCost:{ gold:20e9, fuel:240e6, iron:160e6, plasma:100e6, prism:16000, credits:65000, dreadCores:24 } },
    { key:'dread5', name:'Dread Tyrant', cls:'Carrier', price:0, reqKills:0, weapons:7, ammo:3, hull:3, drones:84,
      mods:{ hpPct:2240, dmgPct:1260, multiShot:336, critChance:80, critDamage:980, moveSpeed:210, atkSpeedPct:420, rangePct:672, lifeSteal:12.4 },
      tag:'DREAD-CLASS V', dreadAura:true, reqLevel:180,
      desc:'A tyrant hull that rewrites the battlefield — second only to the Omega.',
      megaCost:{ gold:30e9, fuel:360e6, iron:240e6, plasma:150e6, prism:24000, credits:78000, dreadCores:36 } },
    { key:'dread6', name:'Dread Omega', cls:'Carrier', price:0, reqKills:0, weapons:7, ammo:3, hull:3, drones:96,
      mods:{ hpPct:2640, dmgPct:1485, multiShot:396, critChance:85, critDamage:1155, moveSpeed:248, atkSpeedPct:495, rangePct:792, lifeSteal:14.6 },
      tag:'DREAD-CLASS · OMEGA', dreadAura:true, reqLevel:200,
      desc:'The apex Dreadnaught — the single most powerful vessel in the galaxy, forged from a fortune in every currency.',
      megaCost:{ gold:50e9, fuel:600e6, iron:400e6, plasma:250e6, prism:40000, credits:92000, dreadCores:60 } },
    // ---- DREAD PRAETORIAN · DREAD-CLASS FIGHTER CARRIER ---------------------
    // The highest-performing Dread hull in the game, and the only one that is BOTH
    // a gunship and a carrier: FOUR cannon hardpoints AND SIX fighter bays, on top
    // of full Dread-class munitions, hull and utility slots. 19 fitted slots is
    // more than anything else flies.
    //
    // This is the hull the Fighter Bay system was built to make possible. The
    // Vanguard trades every cannon away for four bays; the Praetorian gives up
    // nothing — which is why it sits at the very top of the ladder rather than
    // beside the Omega. Every line is 1.15× the Dread Omega.
    //
    // It keeps cls:'Carrier' (the hangar files by cls, and cls picks escort weapon
    // type and accent) and reaches the Dread tab through `megaCost`— except it has
    // none yet: NOT OBTAINABLE, by request. See `unreleased` on the Vanguard above.
    { key:'praetorian', name:'Dread Praetorian', cls:'Carrier', price:0, reqKills:0,
      weapons:4, ammo:3, hull:3, drones:96, fighterCapacity:6,
      mods:{ hpPct:3040, dmgPct:1710, multiShot:456, critChance:90, critDamage:1330, moveSpeed:285, atkSpeedPct:570, rangePct:910, lifeSteal:16.8 },
      // Earned on the TOUR OF DUTY ladder — Admiralty track, level 100. It is the
      // entire stated reason to buy that track, so it must not read as unobtainable.
      tag:'DREAD-CLASS · PRAETORIAN', dreadAura:true, reqLevel:200, tour:{ lv:100, track:'Admiralty' },
      desc:'The apex Dreadnaught, and the only hull in the galaxy that is both gunship and carrier. FOUR cannon hardpoints fire while SIX FIGHTER BAYS launch six autonomous Heavy Fighters that pick their own targets and swarm them — on top of full Dread-class munitions, plating and utility fittings. Nineteen fitted slots. Every line on its sheet is above the Dread Omega.' },
    // ---- KAEVITH ALIEN TECHNOLOGY · THE INCURSION EVENT ---------------------
    // Five recovered hulls, never sold and never blueprinted: the ONLY way to
    // get one is to clear an invaded zone in My Galaxy and win the salvage roll
    // (1% on ring 1 → 10% at the rim; deeper rings favour the bigger hulls).
    // Their real value is the RESONANCE FIELD: any Kaevith hull in the fleet
    // (flagship or escort) raises EVERY kill's XP for the whole fleet — xpBonus
    // is a percentage and they add together.
    //
    // PROGRESSION NOTE (Aug 2026) — cut from 10/25/45/70/100 (+250% for the full
    // roster) to 8/16/28/44/64 (+160%). Part of the game-wide XP reduction; see the
    // FLEET XP RATE block in game-v93.js. The full set is still the biggest single
    // swing in the game and is still worth chasing every hull for.
    // Performance runs entry-level (Splinter) → Dreadnaught-class (Godshard).
    { key:'xen1', name:'Kaevith Splinter', cls:'Frigate', price:0, reqKills:0, weapons:1, ammo:1, hull:1, drones:0,
      mods:{ moveSpeed:30, dmgPct:10, critChance:5 },
      tag:'KAEVITH I · SPLINTER', xen:1, xpBonus:8, alienTech:true,
      desc:'A single shard of Kaevith hullstone flying on a stolen drive — entry-level performance, but the resonance core alone lifts your whole fleet\u2019s XP by 8% per kill.' },
    { key:'xen2', name:'Kaevith Shard', cls:'Cruiser', price:0, reqKills:0, weapons:2, ammo:1, hull:1, drones:0,
      mods:{ dmgPct:20, hpPct:14, critChance:6 },
      tag:'KAEVITH II · SHARD', xen:2, xpBonus:16, alienTech:true,
      desc:'Cruiser-grade alien plate around a wider resonance lattice. +16% fleet XP per kill.' },
    { key:'xen3', name:'Kaevith Glaive', cls:'Battleship', price:0, reqKills:0, weapons:3, ammo:2, hull:2, drones:0,
      mods:{ dmgPct:40, hpPct:55, critChance:10, multiShot:8 },
      tag:'KAEVITH III · GLAIVE', xen:3, xpBonus:28, alienTech:true,
      desc:'A battleship-weight blade of crystal with three void hardpoints. +28% fleet XP per kill.' },
    { key:'xen4', name:'Kaevith Sovereign', cls:'Carrier', price:0, reqKills:0, weapons:4, ammo:3, hull:3, drones:8,
      mods:{ hpPct:120, dmgPct:75, multiShot:22, critChance:16, critDamage:60, atkSpeedPct:25, rangePct:30 },
      tag:'KAEVITH IV · SOVEREIGN', xen:4, xpBonus:44, alienTech:true,
      desc:'A carrier-class Kaevith command hull with eight drone spines. +44% fleet XP per kill.' },
    { key:'xen5', name:'Kaevith Godshard', cls:'Carrier', price:0, reqKills:0, weapons:7, ammo:3, hull:3, drones:30,
      mods:{ hpPct:700, dmgPct:400, multiShot:110, critChance:50, critDamage:320, moveSpeed:60, atkSpeedPct:135, rangePct:210, lifeSteal:3.8 },
      tag:'KAEVITH V · GODSHARD', xen:5, xpBonus:64, alienTech:true,
      desc:'The Incursion\u2019s flagship — a Dreadnaught-class monolith of living crystal. Its resonance field alone lifts every kill\u2019s XP by 64% for the whole fleet.' },
    // ---- THE EMBER CHOIR · ZONE GRIND INCURSION ------------------------------
    // Sister event to the Kaevith Incursion, on the other axis. Kaevith pays XP;
    // the Choir pays BEACON. Every hull carries a `beacon` block — percentages,
    // summed across the fleet and clamped in game-v93 (emberBeaconBonus):
    //   cdCut = % off the recharge · life = % longer swarm window
    //   size  = % bigger swarm     · loot = % more from every beacon-summoned kill
    // Recovered ONLY by killing the hull that ends a Choir-claimed zone (~1 zone
    // in 30, Zone Grind). Never sold, never crated. Stat lines track the Kaevith
    // ladder tier for tier, so neither event is the strictly better one to chase.
    { key:'emb1', name:'Ember Mote', cls:'Frigate', price:0, reqKills:0, weapons:1, ammo:1, hull:1, drones:0,
      mods:{ dmgPct:10, hpPct:8 },
      tag:'CHOIR I · MOTE', ember:1, beacon:{ cdCut:4, life:8, size:5, loot:6 }, emberTech:true,
      desc:'A single obsidian husk with a molten seam down its spine. Cuts your beacon\u2019s recharge by 4% and holds the swarm 8% longer.' },
    { key:'emb2', name:'Cinder Acolyte', cls:'Cruiser', price:0, reqKills:0, weapons:2, ammo:1, hull:1, drones:0,
      mods:{ dmgPct:20, hpPct:14, critChance:6 },
      tag:'CHOIR II · ACOLYTE', ember:2, beacon:{ cdCut:7, life:15, size:10, loot:12 }, emberTech:true,
      desc:'Cruiser-weight plate around a wider resonator. \u22127% recharge, +15% swarm window, +12% loot from every kill it calls in.' },
    { key:'emb3', name:'Ashen Cantor', cls:'Battleship', price:0, reqKills:0, weapons:3, ammo:2, hull:2, drones:0,
      mods:{ dmgPct:40, hpPct:55, critChance:10, multiShot:8 },
      tag:'CHOIR III · CANTOR', ember:3, beacon:{ cdCut:11, life:25, size:18, loot:22 }, emberTech:true,
      desc:'A battleship built around a choir-stone that answers signals on its own. \u221211% recharge, +25% duration, +22% beacon loot.' },
    { key:'emb4', name:'Molten Herald', cls:'Carrier', price:0, reqKills:0, weapons:4, ammo:3, hull:3, drones:8,
      mods:{ hpPct:120, dmgPct:75, multiShot:22, critChance:16, critDamage:60, atkSpeedPct:25, rangePct:30 },
      tag:'CHOIR IV · HERALD', ember:4, beacon:{ cdCut:15, life:40, size:28, loot:35 }, emberTech:true,
      desc:'A carrier whose eight spines each carry a resonator. \u221215% recharge, +40% duration, +28% swarm size, +35% beacon loot.' },
    { key:'emb5', name:'Choirmaster Vhorn', cls:'Carrier', price:0, reqKills:0, weapons:7, ammo:3, hull:3, drones:30,
      mods:{ hpPct:700, dmgPct:400, multiShot:110, critChance:50, critDamage:320, moveSpeed:60, atkSpeedPct:135, rangePct:210, lifeSteal:3.8 },
      tag:'CHOIR V · VHORN', ember:5, beacon:{ cdCut:22, life:65, size:45, loot:60 }, emberTech:true,
      desc:'The Choir\u2019s flagship — a Dreadnaught-class husk that IS a beacon. \u221222% recharge, +65% duration, +45% swarm and +60% loot on every kill it calls in.' },
    // ---- THE AETERNUM · ASCENSION-CLASS PLANETBREAKER -----------------------
    // Not a ship. An artificial world, forged by an extinct civilisation to erase
    // star systems, and the single hardest thing in LOOTFLEET to obtain:
    //   • ASCENSION ★5 — no amount of currency substitutes for prestige
    //   • 5 TRILLION of all four primaries (gold, fuel, iron, plasma)
    //   • a 3-DAY forge you cannot rush
    // It is NOT a stat upgrade: every hull line sits at 80% of the Titan Sina. You
    // fly it for the LANCE, not the sheet.
    // Its EVENT HORIZON LANCE aligns for 15 seconds, then fires a beam that does
    // not stop at its target: it crosses the ENTIRE zone, hits everything in the
    // lane, and leaves a FRACTURE ZONE behind that turns the wreckage into the
    // richest ground on the map. One shot a minute, forever.
    { key:'aeternum', name:'The Aeternum', cls:'Carrier', price:0, reqKills:0, weapons:7, ammo:3, hull:3, drones:102,
      mods:{ hpPct:4224, dmgPct:2376, multiShot:634, critChance:90, critDamage:1848, moveSpeed:397, atkSpeedPct:792, rangePct:3200, lifeSteal:23.4 },
      tag:'ASCENSION CLASS · PLANETBREAKER', lance:true, sinaTracers:true,
      desc:'The first Ascension-Class Planetbreaker — an artificial world built to erase star systems. The Event Horizon Lance charges for 15 seconds in full view of the galaxy, then carves a beam clean across the zone: every hull in the lane is vaporised, and the rift it leaves behind pays out on everything that dies in it. Requires Ascension ★5, five trillion of every primary resource, and three days in the forge.',
      build:{ reqAsc:5, noBlueprint:true,
              cost:{ gold:5e12, fuel:5e12, iron:5e12, plasma:5e12 } } },
    // TITAN SINA — the FINAL-CLASS hero ship. Double the Dread Omega in every
    // stat, with weapon range that effectively covers the entire battle zone.
    // Its fire renders as full-spectrum gatling tracers — lasers of all colors.
    // Cost: 1,000,000 LootCoins FLAT — no level gate, no other currencies.
    { key:'titansina', name:'Titan Sina', cls:'Carrier', price:0, reqKills:0, weapons:7, ammo:3, hull:3, drones:128,
      mods:{ hpPct:5280, dmgPct:2970, multiShot:792, critChance:95, critDamage:2310, moveSpeed:496, atkSpeedPct:990, rangePct:4000, lifeSteal:29.2 },
      tag:'FINAL CLASS · TITAN SINA', sinaTracers:true,
      desc:'The final-class hero ship — twice the Dread Omega in every dimension. Its guns reach across the entire battle zone, spraying full-spectrum tracer fire. Sold outright for 1,000,000 LootCoins.',
      megaCost:{ credits:1000000 } },
    // ---- TITAN AQUILA · TITAN-CLASS FIGHTER CARRIER -------------------------
    // The apex of the fighter line and the second Titan-class hull. One more cannon
    // and one more fighter bay than the Dread Praetorian: FIVE cannons, SEVEN bays.
    //
    // The ladder the Fighter Bay system now describes, in one place:
    //   Vanguard      — Carrier-class  · 0 cannon · 4 bays · quarter speed
    //   Dread Praetorian — Dread-class · 4 cannon · 6 bays
    //   Titan Aquila  — Titan-class   · 5 cannon · 7 bays
    // Each rung adds a bay AND a gun, so the wing grows with the hull rather than
    // replacing it — and `fighterCapacity` is the only thing that had to change to
    // fly seven craft, because bay count and slot count are the same number by
    // construction (see BAY_SLOTS / shipSlots below).
    //
    // Twenty-one fitted slots, the most in the game. Every stat line is 1.2× the
    // Titan Sina, which makes it the strongest hull in the galaxy on paper — and
    // like both hulls below it, NOT OBTAINABLE yet (see `unreleased` on the
    // Vanguard). It keeps cls:'Carrier' for the hangar and escort rules; the Titan
    // tier is matched from the TITAN- tag.
    { key:'titanaquila', name:'Titan Aquila', cls:'Carrier', price:0, reqKills:0,
      weapons:5, ammo:3, hull:3, drones:128, fighterCapacity:7,
      mods:{ hpPct:6336, dmgPct:3564, multiShot:950, critChance:96, critDamage:2772, moveSpeed:595, atkSpeedPct:1188, rangePct:4000, lifeSteal:35 },
      tag:'TITAN CLASS · AQUILA', sinaTracers:true, dreadAura:true, reqLevel:200,
      // EARNED ON THE KING OF THE HILL LADDER — 25 crowns unlock the blueprint,
      // then the hull is BUILT. `unreleased:true` came off here: it means "no route
      // exists" and drives copy that says so outright, which stopped being true the
      // moment the crown count started handing the schematic out.
      build:{ reqCrowns:25, cost:{ fuel:25e12, iron:25e12, plasma:25e12, credits:1000000 } },
      desc:'Titan-class, and the apex of the carrier line. FIVE cannon hardpoints fire full-spectrum tracers while SEVEN FIGHTER BAYS put seven autonomous Heavy Fighters on the field — each picking its own target and swarming it — over full Dread-class munitions, plating and utility fittings and 128 drone bays. Twenty-one fitted slots: nothing else in the galaxy carries more.' },
    // ---- CELESTIAL CORVUS · CELESTIAL-CLASS FIGHTER CARRIER -----------------
    // The end of the fighter line: ELEVEN fighter bays and no more guns than the
    // Aquila. Four extra bays and the same five cannons — the hull stops being a
    // gunship that carries fighters and becomes a mobile airfield.
    //
    // AND IT IS SLOW. `speedMult: 0.45` — less than half the speed of a normal
    // hull, the only line on its sheet that goes DOWN. It is the largest vessel in
    // the game and moves like it. Note this is a MULTIPLIER on the hull's own
    // movement, applied after the moveSpeed mod, so a movement build still helps;
    // it just never makes the Corvus quick. Same mechanism as the Vanguard's 0.25.
    //
    // The full fighter ladder:
    //   Vanguard          Carrier    ·  0 cannon ·  4 bays · ×0.25 speed
    //   Dread Praetorian  Dread      ·  4 cannon ·  6 bays · full speed
    //   Titan Aquila      Titan      ·  5 cannon ·  7 bays · full speed
    //   Celestial Corvus  Celestial  ·  5 cannon · 11 bays · ×0.45 speed
    // Twenty-five fitted slots. It required no engine work: `fighterCapacity` is a
    // ship stat and bay count IS slot count (BAY_SLOTS, widened to 12 above).
    { key:'corvus', name:'Celestial Corvus', cls:'Carrier', price:0, reqKills:0,
      weapons:5, ammo:3, hull:3, drones:192, fighterCapacity:11, speedMult:0.45,
      mods:{ hpPct:9500, dmgPct:5350, multiShot:1425, critChance:96, critDamage:4160, moveSpeed:300, atkSpeedPct:1780, rangePct:6000, lifeSteal:52 },
      tag:'CELESTIAL CLASS · CORVUS', celestial:true, dreadAura:true, dpsAura:0.9, reqLevel:200,
      // ONE HUNDRED CROWNS. Four times the Aquila's gate for four times its build
      // cost — the last rung of the carrier line and the deepest single-ladder
      // requirement in the game. Same route, same screen, four times the wait.
      build:{ reqCrowns:100, cost:{ fuel:100e12, iron:100e12, plasma:100e12, credits:10000000 } },
      desc:'Celestial-class, and the last word in carrier design — a mobile airfield rather than a warship. ELEVEN FIGHTER BAYS put eleven autonomous Heavy Fighters in the air at once, each choosing its own target, over five cannon hardpoints, 192 drone bays and full Celestial plating. Twenty-five fitted slots. It is the largest vessel ever built and it moves at under half the speed of a normal hull: the wing is how it reaches anything.' },
    // ETERNUM — CELESTIAL CLASS. The hull that comes after Titan. Every line on
    // its sheet is 1.5× the Titan Sina, but the reason to fly it is the armament:
    //   • DEATH BEAMS — five continuous lances that lock the five nearest hostiles
    //     and burn them for as long as they stay in range. No cooldown, no aim.
    //   • CELESTIAL AURA — a standing field that cooks everything near the hull.
    // NEVER SOLD, in any currency. It is the apex prize of Space Cargo Defense —
    // and it does not fly for anyone who has not put the years in:
    //   1,000 CARGO RUNS SECURED  AND  Pilot Ascension ★100  AND a
    //   TITAN SINA in the hangar — the Celestial hull is crewed off a Titan Sina,
    //   so the Titan line is the licence to fly it.
    // The haulage line counts DELIVERIES (state.cargo.wins). It used to count the
    // general mission tally, so the capstone of an event could be earned without
    // flying the event.
    // All three are checked at SWITCH time, not just at grant time (see canFlyShip).
    { key:'eternum', name:'Eternum', cls:'Carrier', price:0, reqKills:0, weapons:7, ammo:3, hull:3, drones:192,
      mods:{ hpPct:7920, dmgPct:4455, multiShot:1188, critChance:95, critDamage:3465, moveSpeed:744, atkSpeedPct:1485, rangePct:6000, lifeSteal:43.8 },
      tag:'CELESTIAL CLASS · ETERNUM', celestial:true, sinaTracers:true, deathBeams:5, dpsAura:0.9,
      flyReq:{ cargo:1000, stars:100, ship:'titansina' },
      // COMMISSIONING COST. The 2% Omega Cargo V roll recovers an ETERNUM CORE,
      // not the hull — the hull is then built around it, and the yard wants
      // 10 TRILLION gold, and — since the non-gold economy came down 10× — one
      // trillion of each resource and 10,000 LootCoins.
      claimCost:{ gold:1e13, fuel:1e12, iron:1e12, plasma:1e12, credits:10000 },
      motto:'Built not to conquer worlds, but to outlive them.',
      desc:'The Celestial Class — one and a half times the Titan Sina on every line, wrapped in a standing celestial field that burns anything that drifts near the hull. Five death beams lock the nearest hostiles and never let go. Its core is recovered only from the deepest Space Cargo Defense manifest, commissioned for 10T of every primary and 100,000 LootCoins, and flyable only by a pilot with 1,000 successful missions, ★50 and a Titan Sina behind them.' },
  ];
  // Economy tuning: hulls cost 3× gold and demand 5× the kills to unlock.
  SHIPS.forEach((s) => {
    if (s.price) s.price = Math.round(s.price * 3);
    if (s.reqKills) s.reqKills = Math.round(s.reqKills * 5);
    if (s.resPrice) for (const k in s.resPrice) s.resPrice[k] = Math.round(s.resPrice[k] * 3);
  });
  const SHIP_BY_KEY = {}; SHIPS.forEach((s, i) => { s.tier = i; SHIP_BY_KEY[s.key] = s; });
  // BLUEPRINTS — a hull's buy option stays locked until you recover its
  // blueprint by defeating the BOSS in a specific zone. Staggered ever deeper
  // so each hull is a real expedition to find.
  const SHIP_BP_ZONE = { interceptor:9, cruiser:18, heavycruiser:30, destroyer:42, battleship:55, dreadnought:68, carrier:80, aegis:84, supercarrier:90, titan:98 };
  SHIPS.forEach((s) => { s.bpZone = SHIP_BP_ZONE[s.key] || 0; });
  // Previous hull in the upgrade chain. `side` hulls (Aegis) are optional
  // branches: they hang off the chain but are never required by later hulls.
  // Previous hull in the upgrade chain. `side` hulls (Aegis) are optional
  // branches, and `alienTech` hulls (Kaevith event drops) sit outside the chain
  // entirely — both hang off it but are never anyone's predecessor.
  function shipPrevKey(key) {
    let i = SHIPS.findIndex((s) => s.key === key);
    if (i <= 0) return null;
    i--;
    while (i > 0 && (SHIPS[i].side || SHIPS[i].alienTech)) i--;
    return SHIPS[i].key;
  }
  // Which hull blueprint (if any) drops from the boss of a given zone.
  function blueprintForZone(zone) { const s = SHIPS.find((x) => x.bpZone === zone); return s ? s.key : null; }
  // Drone bays: while flying a carrier, each kill has `dropChance` to drop a
  // drone into an empty bay. Drones deal `dmgFrac` of your damage per shot.
  const DRONE = { dmgFrac: 0.45, fireRate: 1.5, range: 235, orbit: 52, spin: 1.0, dropChance: 0.16, projSpeed: 560 };

  // ---------------------------------------------------------------------------
  // FLEET — from Lv 100 you unlock an escort slot every 100 levels (4 max).
  // Flagship + 4 escorts = 5 ships. Hulls are unique, so no duplicate ships.
  // Escorts fly in formation, fire real shots (escortDmgFrac of your damage)
  // and contribute statShare of their hull mods to your fleet score.
  // ---------------------------------------------------------------------------
  // FIGHTER CLASS — the Vanguard's bay and every carrier bay after it. CAPACITY
  // IS NOT HERE: it is a ship stat (`fighterCapacity`), so an 8- or 12-bay hull
  // is a config line and no code. These are per-craft values; the equipped bay's
  // rarity scales them through ITEMS.fighterSpec().
  const FIGHTER = {
    // ---- FIGHTER DPS IS ANCHORED TO CANNON DPS -----------------------------
    // `dpsVsCannon` is the ONLY balance number here, and it is a ratio, not a share:
    // a REFERENCE carrier's full wing does this much of what a cannon hull's base fire
    // does. 1.10 = ten per cent more.
    //
    // WHY A RATIO. `dmgFrac` alone was 0.95, which sounds modest and was not: the wing's
    // multiple of cannon DPS works out to
    //
    //     bays × dmgFrac × attackRate / PLAYER_BASE.attackSpeed
    //     4    × 0.95    × 2.6         / 1.3                    = 7.6×
    //
    // Four craft each firing twice as often as the hull, at 95% of its damage, is eight
    // times the hull's output before anything else is counted. Measured live on a real
    // account: 302T/sec from cannons against 2,297T/sec from the wing.
    //
    // Note the ratio is ACCOUNT-INDEPENDENT: attack speed folds into fighter damage via
    // `spdMul`, so `attacksPerSec` cancels out of the division entirely. One number
    // balances the class at every level of progression.
    //
    // `dmgFrac` is DERIVED from the ratio in fighters.js rather than written here, so
    // changing attackRate or the player's base fire rate cannot silently rebalance the
    // whole class. Bigger carriers still hit harder — more bays is the progression — the
    // ratio pins the ENTRY hull.
    // BUILD 712 — 1.10 → 1.32, a flat +20% to the whole class. Carriers were
    // paying a real cost for their shape (the wing has travel time, it can be
    // out of position, and a half-fitted carrier flies a half-strength wing)
    // without being paid for it — a 4-bay wing at 110% of a cannon was parity on
    // paper and behind it in the arena. This is the ONE number that moves the
    // class: dmgFrac is derived from it, and the Ship Score ratio reduces to it.
    dpsVsCannon: 1.32, // the Vanguard's 4-bay wing = 132% of a cannon hull's base DPS
    refBays: 4,        // the hull that ratio is measured against (the Vanguard)
    attackRate: 2.6,   // attacks/sec, per craft — feel, not power; dmgFrac absorbs it
    range: 620,         // OPERATIONAL ENVELOPE, measured from the carrier, not the craft
    speed: 520,         // px/sec — against a Vanguard's 23, deliberately extreme
    orbitRadius: 44,    // ring flown around a target while attacking
    dockDist: 26,       // close enough to stow
    launchTime: 0.22,   // clear of the hull before steering
    launchStagger: 0.1, // the wing leaves in sequence, not as a block
    // HOW MUCH HULL RANGE THE WING INHERITS — a damped share, hard-capped.
    // Weapon Range has to mean something for the class (a range build reaching a
    // cannon and nothing else was the gap the audit found), but it cannot be
    // passed through raw: endgame fireRange runs 15,000+ against a 250 base, so
    // a rangeMul of 61 turned a 620-unit envelope into 37,000 — twenty times the
    // whole map. That deletes the pillar the class is balanced on (short reach,
    // slow hull, position or contribute nothing), makes speedMult:0.25 free, and
    // makes the Lance marque's entire identity meaningless because +55% of a
    // map-covering number is still map-covering.
    //
    // At share 0.12 / cap 1.35 a maxed range build widens a plain bay from 620 to
    // 837 — a real reward — while the deepest possible reach (Legendary Lance on
    // a maxed range build) lands just under the map diagonal instead of dwarfing
    // it. Positioning stays a decision at every point on the curve.
    rangeShare: 0.12,   // fraction of the hull's range multiplier that carries over
    rangeMulCap: 1.35,  // ceiling on that carry-over, whatever the build
    trailEvery: 0.06,   // seconds of GAME time between trail motes, per craft —
                        // a fixed cadence, because a per-frame random saturates
                        // to one mote per craft per frame at 5–10× speed
    drawSize: 52,       // sprite width in world units (2× the first cut)
  };

  const FLEET = { slotLevels: [100, 200, 300, 400], maxShips: 5, escortDmgFrac: 0.25, escortFireRate: 1.1, statShare: 0.30 };

  // The ordered equipment slots a ship exposes. Extra weapon/ammo/hull slots
  // reuse the base item types (a 'bow' item fits bow2/bow3/bow4, etc.).
  const WEAP_SLOTS = ['bow','bow2','bow3','bow4','bow5','bow6','bow7'];
  const AMMO_SLOTS = ['arrows','arrows2','arrows3'];
  const HULL_SLOTS = ['armor','armor2','armor3'];
  // One key per bay. A hull exposes `fighterCapacity` of them, so capacity and
  // slot count are the same number by construction — an 8-bay carrier is a config
  // line, exactly as intended.
  const BAY_SLOTS = ['fighter','fighter2','fighter3','fighter4','fighter5','fighter6',
    'fighter7','fighter8','fighter9','fighter10','fighter11','fighter12'];
  function shipSlots(shipKey) {
    const s = SHIP_BY_KEY[shipKey] || SHIPS[0];
    // `noUtility` hulls expose NO boots/gloves/shield-core slots. The Vanguard is
    // the first: a Fighter Carrier is a launch platform rather than a fitted
    // warship, and giving up the utility trio is most of what pays for a bay that
    // hits like a full cannon battery.
    const util = s.noUtility ? [] : ['boots','gloves','amulet'];
    return [].concat(WEAP_SLOTS.slice(0, s.weapons), BAY_SLOTS.slice(0, s.fighterCapacity | 0),
      AMMO_SLOTS.slice(0, s.ammo), HULL_SLOTS.slice(0, s.hull), util);
  }
  // base item type accepted by a slot key (strips trailing digit)
  function slotBase(slotKey) { return slotKey.replace(/\d+$/, ''); }

  // ---------------------------------------------------------------------------
  // ARENA / SPAWN tuning
  // ---------------------------------------------------------------------------
  const ARENA = {
    w: 760, h: 560,          // logical arena play-field inside the canvas
    maxEnemies: 7,
    spawnInterval: 0.9,      // seconds between spawn attempts
    arrowSpeed: 620,
    contactCooldown: 1.0,    // seconds between an enemy's contact hits
    regenPerSec: 0.03,       // % of max HP regenerated per second
  };

  const TOTAL_DUNGEONS = 100;   // size of one zone "block"
  const ZONE_BLOCK = 100;
  // Zones reveal in blocks of 100: you can reach up to the end of the next block
  // only once you've pushed into the current one. Clearing zone 100 opens
  // 101–200, clearing 200 opens 201–300, and so on — endlessly.
  function zoneCap(highestReached) { return (Math.floor(Math.max(1, highestReached || 1) / ZONE_BLOCK) + 1) * ZONE_BLOCK; }

  // ---------------------------------------------------------------------------
  // SKILL TREE — spend level points to deepen a build. Three branches, each a
  // chain ending in a powerful capstone. Bonuses are intentionally strong so
  // leveling matters a lot. `mod` names map to modifiers applied in game.js.
  // reqBranch = points spent in this branch before unlocking; reqNode = a prior
  // node's rank requirement.
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // SKILL TREE — a deep, tiered tree designed to stay meaningful all the way to
  // Level 1000. 1 point per level. Each branch is a long chain of tiers; deeper
  // tiers gate behind points already spent in the branch (reqBranch) and cost
  // MORE points per rank (1 → 2 → 3 → 5 → 10), so late levels carry real weight.
  // Capstones every 4th tier give large per-rank bonuses. Generated below so the
  // tree is consistent and easy to tune. Fully maxing all three branches takes
  // well over 1000 points, so a level-1000 build still makes real choices.
  // ---------------------------------------------------------------------------
  function romanNum(n) {
    const map = [[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
    let r = ''; for (const [v, s] of map) { while (n >= v) { r += s; n -= v; } } return r || 'I';
  }
  function tierCost(t) { return (t < 3 ? 1 : t < 6 ? 2 : t < 9 ? 3 : t < 12 ? 5 : 10) * 3; }  // pilot-skill costs ×3
  function buildBranch(key, pools, capPool, capNames) {
    const TIERS = 16, nodes = [];
    const seen = {}; // per-label occurrence → roman numeral
    let cum = 0;
    for (let t = 0; t < TIERS; t++) {
      const cost = tierCost(t);
      const reqBranch = Math.floor(cum * 0.55);
      if (t % 4 === 3) {
        // capstone: boosts the branch's signature stat, big per-rank value
        const p = capPool, max = 5;
        const per = Math.round(p.per * (1 + t * 0.5));
        const name = capNames[Math.min(capNames.length - 1, (t / 4) | 0)];
        nodes.push({ id: key + '_c' + t, br: key, name, mod: p.mod, per, max, cost, reqBranch, cap: true, unit: p.unit, desc: `+${per}${p.unit} ${p.label} per rank` });
        cum += cost * max;
      } else {
        const count = 2 + (t % 2); // 2–3 nodes per tier
        for (let i = 0; i < count; i++) {
          const p = pools[(t + i) % pools.length];
          const capped = p.mod === 'lifeSteal' || p.mod === 'multiShot'
                      || p.mod === 'regen' || p.mod === 'dmgReduce';
          const per = capped ? p.per : Math.max(1, Math.round(p.per * (1 + t * 0.18)));
          const max = capped ? 3 : 5;
          seen[p.label] = (seen[p.label] || 0) + 1;
          nodes.push({ id: key + '_' + t + '_' + i, br: key, name: `${p.label} ${romanNum(seen[p.label])}`, mod: p.mod, per, max, cost, reqBranch, unit: p.unit, desc: `+${per}${p.unit} ${p.label} per rank` });
          cum += cost * max;
        }
      }
    }
    return nodes;
  }
  const SKILLS = {
    pointsPerLevel: 1,
    branches: [
      { key: 'offense', name: 'Offense', color: '#e23b4e' },
      { key: 'defense', name: 'Defense', color: '#2f6fed' },
      { key: 'tactics', name: 'Tactics', color: '#2f9e4f' },
    ],
    nodes: [].concat(
      buildBranch('offense',
        [ { mod:'dmgPct', label:'Damage', per:4, unit:'%' },
          { mod:'critChance', label:'Crit Chance', per:2, unit:'%' },
          { mod:'critDamage', label:'Crit Damage', per:9, unit:'%' },
          { mod:'atkSpeedPct', label:'Fire Rate', per:3, unit:'%' } ],
        { mod:'dmgPct', label:'Damage', per:16, unit:'%' },
        ['Overcharge','Devastation','Annihilation','Apex Predator']),
      buildBranch('defense',
        [ { mod:'hpPct', label:'Max HP', per:5, unit:'%' },
          { mod:'lifeSteal', label:'Life Steal', per:0.2, unit:'%' },
          { mod:'hpPct', label:'Plating', per:7, unit:'%' },
          { mod:'dmgReduce', label:'Resolve', per:0.5, unit:'%' } ],
        { mod:'hpPct', label:'Max HP', per:18, unit:'%' },
        ['Bulwark','Juggernaut','Fortress','Immortal']),
      buildBranch('tactics',
        [ { mod:'moveSpeed', label:'Move Speed', per:4, unit:'%' },
          { mod:'multiShot', label:'Multi-Shot', per:2, unit:'%' },
          { mod:'rangePct', label:'Standoff', per:1, unit:'%' },
          { mod:'regen', label:'Repair Loop', per:0.1, unit:'%/s' } ],
        { mod:'multiShot', label:'Multi-Shot', per:5, unit:'%' },
        ['Split Fire','Bullet Storm','Hailfire','Singularity']),
    ),
  };

  // ---------------------------------------------------------------------------
  // GOLD SHOP — 3 rotating items (Legendary..Void, never Eternal), refreshing
  // every 15 minutes. Bought with gold, intentionally expensive.
  // ---------------------------------------------------------------------------
  const SHOP = { count: 3, refreshMin: 15, minRarity: 4, maxRarity: 9 };
  function rollShopRarity() {
    const w = [[4, 50], [5, 26], [6, 12], [7, 6], [8, 3], [9, 1.6]];
    const total = w.reduce((a, b) => a + b[1], 0);
    let r = Math.random() * total;
    for (const [tier, wt] of w) { r -= wt; if (r <= 0) return tier; }
    return 4;
  }
  function shopPrice(item) {
    const r = RARITY[item.rarity];
    return Math.floor((300 + (r.tier - 3) * (r.tier - 3) * 480) * Math.pow(dungeonScale(item.dungeon || 1), 0.6));
  }

  window.CONFIG = {
    RARITY, RARITY_BY_KEY, STATS, STAT_KEYS, SLOTS, SLOT_KEYS, ENEMIES,
    PLAYER_BASE, ARENA, TOTAL_DUNGEONS, ZONE_BLOCK, zoneCap, SCALE_BASE, OLD_SCALE_BASE, SKILLS, SHOP,
    SPECIALS, MULTISHOT_MAX_TARGETS, SPEED_TIERS, STORE, liveRarityMax,
    SHIPS, SHIP_BY_KEY, MECHS, MECH_BY_KEY, DRONE, FIGHTER, FLEET, shipSlots, slotBase, shipPrevKey, blueprintForZone,
    xpToNext, dungeonEnemyLevel, zoneCombatLevel, dungeonScale, dungeonScaleLegacy, enemyHp, enemyDamage, enemyXp, enemyGold,
    dropChance, playerBaseStat, sellValue, salvage, rollLifeSteal, rollMultiShot, rollShopRarity, shopPrice, rarityCap, COSMETICS,
    levelCap, LEVEL_CAP_BASE, LEVEL_CAP_PER_STAR,
    ascRarityCap, ascTopBoost, TOP_TIER,
  };
})();
