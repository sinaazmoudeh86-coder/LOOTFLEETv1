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
    { key: 'primordial',name: 'Primordial',color: '#ffe6a8', glow: 'rgba(255,230,168,1)',   minStats: 6, maxStats: 6, mult: 28.5, weight: 0.00004, particles: 22 },
    { key: 'relic',     name: 'Relic',     color: '#c061ff', glow: 'rgba(192,97,255,1)',    minStats: 6, maxStats: 6, mult: 38.0, weight: 0.0000016,  particles: 26 },
    { key: 'artifact',  name: 'Artifact',  color: '#ff2330', glow: 'rgba(255,35,48,1)',     minStats: 6, maxStats: 6, mult: 50.0, weight: 0.00000006, particles: 30 },
  ];
  // Post-mythic tiers (Ancient and beyond) are ~10× rarer across the board.
  RARITY.forEach((r, i) => { if (i >= 6) r.weight *= 0.1; });
  const RARITY_BY_KEY = {};
  RARITY.forEach((r, i) => { r.tier = i; RARITY_BY_KEY[r.key] = r; });

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
    // line (see items.js). Value is a flat 1–5% and does NOT scale with zone.
    lifeSteal:     { key: 'lifeSteal',     name: 'Life Steal',   short: 'LS',    fmt: 'pctint', base: 0, icon: '', special: true },
  };
  // Core rollable stats (excludes specials like life steal).
  const STAT_KEYS = Object.keys(STATS).filter((k) => !STATS[k].special);

  // ---------------------------------------------------------------------------
  // GEAR SLOTS  (internal keys kept stable; theme is firearms/tactical gear)
  // Each slot favors certain stats (weighted) so gear feels distinct.
  // Icons are inline SVG strings injected into the DOM.
  // ---------------------------------------------------------------------------
  const ICON = {
    weapon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h16l-1.5 4H13l-2 4H8v-4H3z"/><path d="M7 12v2"/><path d="M19 8V6"/></svg>',
    ammo:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="3" width="4" height="11" rx="1"/><path d="M8 3.5l2-1.5 2 1.5"/><path d="M8 14h4l-.6 6h-2.8z"/><rect x="14" y="6" width="4" height="9" rx="1"/></svg>',
    vest:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3l4 2.5L16 3v8a6 6 0 0 1-4 5.5A6 6 0 0 1 8 11z"/><path d="M12 6v9"/></svg>',
    boots:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v9l5 2 4 2v3H9a4 4 0 0 1-4-4V3z"/><path d="M9 12h3"/></svg>',
    gloves: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 12V7a1 1 0 0 1 2 0v3m0 0V5a1 1 0 0 1 2 0v5m0 0V5a1 1 0 0 1 2 0v5m0-2a1 1 0 0 1 2 0v6a5 5 0 0 1-5 5 5 5 0 0 1-4-2l-3-4 1.5-1.5z"/></svg>',
    optic:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>',
  };
  const SLOTS = {
    bow:    { key: 'bow',    name: 'Cannon',     primary: ['attackDamage', 'critDamage'],   icon: ICON.weapon },
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
  // SCALING FORMULAS — the heart of infinite progression
  //
  // Difficulty grows GEOMETRICALLY per dungeon (~1.55x). Crucially, item power
  // scales at the SAME rate (see items.js), so gear farmed in dungeon D lets you
  // clear D and push to D+1. Flat stats (damage/health) carry the scaling;
  // percent stats (speed/crit) stay modest so they never explode.
  // ---------------------------------------------------------------------------

  // XP required to advance FROM `level` to level+1.
  // Hybrid linear*exponential: L1->2 = 100, L2->3 ≈ 165, scales forever.
  // BAND WALLS: every 100 levels the whole curve steps up another ×5 — so the
  // 100→200 journey costs ~5× the XP of 1→100, 200→300 ~5× that again, and the
  // trend continues through 400→500. Levels are meant to be EARNED out there.
  function xpToNext(level) {
    const band = Math.min(5, Math.floor(level / 100)); // ×1, ×5, ×25, ×125, ×625
    let xp = (120 + 120 * level) * Math.pow(1.11, level - 1) * Math.pow(5, band);
    xp *= 3;                      // global 3× leveling cost
    if (level >= 100) xp *= 20;   // 20× steeper past level 100
    return Math.floor(xp);
  }

  // Cosmetic "enemy level" shown to the player. D1=1, D5=25, D20=400, D100=10000.
  function dungeonEnemyLevel(dungeon) {
    return dungeon * dungeon;
  }

  // The master geometric difficulty/reward multiplier for a dungeon.
  // D1 = 1, and every dungeon is ~1.18x the previous. Kept gentle on purpose:
  // because ENEMY hp/damage and ITEM power both ride this same curve, the
  // per-zone balance is identical to a steeper curve — but absolute numbers
  // grow far slower, so reaching a "trillion" of anything is a long journey.
  const SCALE_BASE = 1.18, OLD_SCALE_BASE = 1.55;  // OLD kept for save migration
  function dungeonScale(dungeon) {
    return Math.pow(SCALE_BASE, dungeon - 1);
  }

  // Enemy max HP for a dungeon.
  // Enemy max HP for a dungeon. Tuned HIGH on purpose: combat is about
  // GRINDING units down over several volleys, not one-shotting the screen —
  // an on-level enemy should soak a good handful of hits before breaking.
  function enemyHp(dungeon) {
    // zones 1–25 are the FAST lane — geared pilots nearly one-shot everything.
    // HP climbs very gently across this band, then catches up to full HP over
    // zones 26–31 so there's no brutal cliff. Real grind HP arrives at zone 32.
    let ramp;
    if (dungeon <= 25) {
      ramp = 0.04 + (dungeon - 1) * (0.12 / 24);   // 0.04 → 0.16 across 1–25
    } else if (dungeon <= 31) {
      ramp = 0.16 + (dungeon - 25) * ((1 - 0.16) / 6); // 0.16 → 1 across 26–31
    } else {
      ramp = 1;
    }
    return Math.max(8, Math.floor((252 * dungeonScale(dungeon) + 30) * ramp));
  }

  // Contact damage an enemy deals per hit. Kept low relative to player HP so a
  // small swarm is survivable WITH appropriate gear; over-pushing still kills,
  // because enemy damage scales geometrically while your HP lags if under-geared.
  // (Also see the per-hit cap in entities.js — no single hit can one-shot you.)
  function enemyDamage(dungeon) {
    // zones 1–25 hit soft — the easy-grind band stays forgiving, then damage
    // ramps back to full over zones 26–31 alongside the HP catch-up.
    let ramp;
    if (dungeon <= 25) {
      ramp = 0.35 + (dungeon - 1) * (0.20 / 24);   // 0.35 → 0.55 across 1–25
    } else if (dungeon <= 31) {
      ramp = 0.55 + (dungeon - 25) * ((1 - 0.55) / 6); // 0.55 → 1 across 26–31
    } else {
      ramp = 1;
    }
    return Math.max(1, Math.floor((2.1 * dungeonScale(dungeon) + 1) * ramp));
  }

  // XP granted for a kill — rises with dungeon to reward pushing deeper.
  function enemyXp(dungeon) {
    // XP curve deliberately FLAT vs zone depth — deep-zone / over-level kills
    // were paying out far too much. exp 0.82 → 0.42 crushes the high end while
    // leaving early zones roughly intact.
    return Math.floor(11 * Math.pow(dungeonScale(dungeon), 0.42) + 9);
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
    // Every tier — up to Artifact — is reachable by zone 100; the roll weights
    // (items.js) keep the top end a real grind. Bosses/citadels beat this by +1.
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
  // Life Steal: heal a % of damage dealt. 1–5%, with 5% extremely rare.
  function rollLifeSteal() {
    const r = Math.random();
    if (r < 0.50) return 1;
    if (r < 0.78) return 2;
    if (r < 0.92) return 3;
    if (r < 0.985) return 4;
    return 5; // very rare
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
  const SPEED_TIERS = [
    { mult: 1, label: '1×', price: 0, priceLabel: 'Free', sku: null },
    { mult: 2, label: '2×', price: 0, priceLabel: 'Free', sku: 'speed2' },
    { mult: 3, label: '3×', price: 0, priceLabel: 'Free', sku: 'speed3' },
    // PREMIUM — unlocked ONLY by spending 500 LootCoins (see ui.js + game.js)
    { mult: 4, label: '4×', price: 0, priceLabel: '500 LootCoins', sku: 'speed4lc', lootcoins: 500 },
    // PRO — exclusive to the LootFleet Pro subscription ($20/mo)
    { mult: 5, label: '5×', price: 0, priceLabel: 'PRO', sku: 'pro5', pro: true },
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
    { key:'dreadnought', name:'Dreadnought',    cls:'Battleship', price:50000000,    reqKills:15000, weapons:4, ammo:2, hull:3, drones:0, mods:{dmgPct:30,hpPct:45,critChance:8},            tag:'Capital Ship',   desc:'Four weapons, fortress plating. The line-breaker.' },
    { key:'carrier',     name:'Carrier',        cls:'Carrier',    price:200000000,   reqKills:24000, weapons:2, ammo:2, hull:2, drones:2, mods:{hpPct:25,dmgPct:12},                          tag:'Drone Bay ×2',   desc:'Launches drones that swarm and fire on their own. 2 drone bays.' },
    // AEGIS — carrier-tier FLEET SUPPORT hull. A side-branch (not required for
    // the upgrade chain): its unique role is hosting Warden support arrays —
    // their fleet-wide heal/buff aura is DOUBLED while you fly an Aegis.
    { key:'aegis',       name:'Aegis',          cls:'Aegis',      price:350000000,   reqKills:26000, weapons:3, ammo:2, hull:3, drones:2, side:true, mods:{hpPct:55,dmgPct:8,critChance:4,rangePct:12}, tag:'FLEET SUPPORT', desc:'Guardian hull built around Warden support arrays — their fleet heal/buff aura is DOUBLED while you fly the Aegis.' },
    { key:'supercarrier',name:'Super Carrier',  cls:'Carrier',    price:900000000,   reqKills:39000, weapons:3, ammo:2, hull:3, drones:4, mods:{hpPct:40,dmgPct:24,critChance:8},            tag:'Drone Bay ×4',   desc:'3 weapons, heavy plating, 4 drone bays.' },
    { key:'titan',       name:'Titan Carrier',  cls:'Carrier',    price:4000000000,  reqKills:60000, weapons:4, ammo:3, hull:3, drones:8, mods:{hpPct:70,dmgPct:40,multiShot:14,critChance:12}, tag:'FLAGSHIP',      desc:'The apex hull. 4 weapons, 3 ammo, and 8 drone bays.' },
    // MOTHERSHIP — the endgame faction Titan Carrier. Bought ONLY with Galaxy
    // Resources (no gold), priced to be a weeks-long goal. Three extra weapon
    // hardpoints (7 total), increased natural weapon range, top-tier built-in
    // modifiers and superior base stats.
    { key:'mothership',  name:'Mothership',     cls:'Carrier',    price:0, resPrice:{ fuel:500000, iron:200000, plasma:120000 }, reqKills:90000, weapons:7, ammo:3, hull:3, drones:12, mods:{hpPct:140,dmgPct:80,multiShot:24,critChance:20,critDamage:60,moveSpeed:24,atkSpeedPct:24,rangePct:45,lifeSteal:4}, tag:'MOTHERSHIP', desc:'The ultimate faction vessel — 7 weapons, extended weapon range, 12 drone bays and superior base stats. Acquired exclusively with Galaxy Resources.' },
    // VOIDMAW — the Season 1 Server Dreadnaught event exclusive. Mothership-grade
    // stats. NEVER purchasable: assembled from 100 Voidmaw Parts earned only in
    // the event (stage drops, leaderboard ranks, Voidmaw Store).
    { key:'voidmaw', name:'Voidmaw', cls:'Carrier', price:0, reqKills:0, weapons:7, ammo:3, hull:3, drones:12, mods:{hpPct:140,dmgPct:80,multiShot:24,critChance:20,critDamage:60,moveSpeed:24,atkSpeedPct:24,rangePct:45,lifeSteal:4}, tag:'SEASON 1 EXCLUSIVE', event:'sdread', desc:'The Server Dreadnaught itself, refit for your fleet — Mothership-grade performance with a void-light hull. Assembled ONLY from Voidmaw Parts earned in the Season 1: Voidmaw event. When the season ends, so does the chance.' },
    // CHROMA REGENT — LootCoin mothership at Titan Carrier performance, firing
    // the same full-spectrum rainbow cannons as the Chroma Fang.
    { key:'chromaregent', name:'Chroma Regent', cls:'Carrier', price:0, reqKills:0, weapons:4, ammo:3, hull:3, drones:8, mods:{hpPct:70,dmgPct:40,multiShot:14,critChance:12}, tag:'SPECTRUM MOTHERSHIP', purchase:{ lc:75000 },
      desc:'The Chroma line\u2019s crown — a rose-quartz mothership tuned to Titan Carrier performance. Every cannon fires streaks of vibrant rainbow light.' },
    // FROSTYFROST — LootCoin cryo hull at Titan Carrier performance. Its cannons
    // CHILL targets (slow) and sometimes flash-freeze them into an ice cube.
    // Bosses shrug the cryo effect off entirely.
    { key:'frostyfrost', name:'FrostyFrost', cls:'Carrier', price:0, reqKills:0, weapons:4, ammo:3, hull:3, drones:8, mods:{hpPct:70,dmgPct:40,multiShot:14,critChance:12}, tag:'CRYO TECH', purchase:{ lc:50000 }, frost:true,
      desc:'A crystalline glacier of a hull at Titan Carrier performance. Every hit chills its target — slowing them — and sometimes flash-freezes them solid in an ice cube. Bosses are immune to the cryo field.' },
    // OBLIVION SPEAR T1 — a forbidden new class one tier ABOVE the Mothership,
    // with roughly DOUBLE its combat performance. It can't be bought: you must
    // recover its blueprint (a 1% drop from a Lv300+ Void Citadel explosion in
    // the Zone Grind), prove yourself with 1,000,000 Mothership kills, pay a
    // staggering resource fortune, then WAIT 2 weeks for the hull to be built.
    { key:'oblivionspear', name:'Oblivion Spear', cls:'Carrier', price:0, reqKills:0, weapons:7, ammo:3, hull:3, drones:16,
      mods:{ hpPct:320, dmgPct:180, multiShot:48, critChance:40, critDamage:140, moveSpeed:30, atkSpeedPct:60, rangePct:95, lifeSteal:9 },
      tag:'OBLIVION SPEAR T1',
      desc:'A forbidden tier above the Mothership — twice the firepower, twice the plating, 16 drone bays. Forged only from a stolen blueprint, a million kills, and a fortune in resources.',
      bpDrop:{ minCitLevel:300, chance:0.01 },
      build:{ days:14, reqShip:'mothership', reqShipKills:1000000, cost:{ fuel:120000000, iron:60000000, plasma:40000000, prism:5000 } } },
    // OBLIVION SPEAR ALPHA — the apex prototype, TWICE as hard to earn as the T1
    // and twice the hull again (≈4× a Mothership). Its blueprint only drops from
    // the very deepest Lv500+ citadels (half the odds), it demands you already
    // own the T1 and have ground 2,000,000 kills in it, costs a king's ransom,
    // and takes a full MONTH to build.
    { key:'oblivionspearalpha', name:'Oblivion Spear Alpha', cls:'Carrier', price:0, reqKills:0, weapons:7, ammo:3, hull:3, drones:24,
      mods:{ hpPct:640, dmgPct:360, multiShot:96, critChance:60, critDamage:280, moveSpeed:40, atkSpeedPct:120, rangePct:150, lifeSteal:16 },
      tag:'OBLIVION SPEAR · ALPHA',
      desc:'The apex prototype — double the Oblivion Spear again, 24 drone bays, reality-bending output. The single hardest vessel in the galaxy to forge.',
      bpDrop:{ minCitLevel:500, chance:0.005, reqOwn:'oblivionspear' },
      build:{ days:28, reqShip:'oblivionspear', reqShipKills:2000000, cost:{ fuel:400000000, iron:200000000, plasma:140000000, prism:20000 } } },
    // OBLIVION FINAL — the ultimate hull, sold for LootCoins only (Lv200+). It is
    // 2.5× the original Oblivion Spear in every stat, renders at colossal scale,
    // and projects a unique GREEN reactor aura.
    { key:'oblivionfinal', name:'Oblivion Final', cls:'Carrier', price:0, reqKills:0, weapons:7, ammo:3, hull:3, drones:40,
      mods:{ hpPct:800, dmgPct:450, multiShot:120, critChance:100, critDamage:350, moveSpeed:75, atkSpeedPct:150, rangePct:240, lifeSteal:22 },
      tag:'OBLIVION FINAL',
      desc:'The final hull. 2.5× the Oblivion Spear in every dimension, wreathed in a green reactor aura. Sold outright for LootCoins — no level gate, no blueprint.',
      greenAura:true,
      purchase:{ lc:1000000 } },
    // DREAD-CLASS — six recovered Dreadnaught hulls, sold directly for a MIX of
    // every currency at a steeper price than the Oblivion Final, each one a step
    // beyond it in raw performance. Gated by account level, not the blueprint chain.
    { key:'dread1', name:'Dread Reaver', cls:'Carrier', price:0, reqKills:0, weapons:7, ammo:3, hull:3, drones:44,
      mods:{ hpPct:1040, dmgPct:585, multiShot:156, critChance:130, critDamage:455, moveSpeed:98, atkSpeedPct:195, rangePct:312, lifeSteal:29 },
      tag:'DREAD-CLASS I', dreadAura:true, reqLevel:100,
      desc:'First of the recovered Dreadnaughts — already a tier beyond the Oblivion Final. Bought with a mix of every currency.',
      megaCost:{ gold:5e9, fuel:60e6, iron:40e6, plasma:25e6, prism:4000, credits:1500000, dreadCores:6 } },
    { key:'dread2', name:'Dread Sovereign', cls:'Carrier', price:0, reqKills:0, weapons:7, ammo:3, hull:3, drones:52,
      mods:{ hpPct:1280, dmgPct:720, multiShot:192, critChance:160, critDamage:560, moveSpeed:120, atkSpeedPct:240, rangePct:384, lifeSteal:35 },
      tag:'DREAD-CLASS II', dreadAura:true, reqLevel:120,
      desc:'A command Dreadnaught bristling with hardpoints. Strictly superior to the Reaver.',
      megaCost:{ gold:10e9, fuel:120e6, iron:80e6, plasma:50e6, prism:8000, credits:3000000, dreadCores:12 } },
    { key:'dread3', name:'Dread Leviathan', cls:'Carrier', price:0, reqKills:0, weapons:7, ammo:3, hull:3, drones:60,
      mods:{ hpPct:1560, dmgPct:878, multiShot:234, critChance:195, critDamage:683, moveSpeed:146, atkSpeedPct:293, rangePct:468, lifeSteal:43 },
      tag:'DREAD-CLASS III', dreadAura:true, reqLevel:140,
      desc:'A leviathan-scale hull whose reactor output dwarfs the lesser Dreads.',
      megaCost:{ gold:15e9, fuel:180e6, iron:120e6, plasma:75e6, prism:12000, credits:4500000, dreadCores:18 } },
    { key:'dread4', name:'Dread Harbinger', cls:'Carrier', price:0, reqKills:0, weapons:7, ammo:3, hull:3, drones:72,
      mods:{ hpPct:1880, dmgPct:1058, multiShot:282, critChance:235, critDamage:823, moveSpeed:176, atkSpeedPct:353, rangePct:564, lifeSteal:52 },
      tag:'DREAD-CLASS IV', dreadAura:true, reqLevel:160,
      desc:'A harbinger of the apex Dreads — overwhelming firepower across 72 drone bays.',
      megaCost:{ gold:20e9, fuel:240e6, iron:160e6, plasma:100e6, prism:16000, credits:6000000, dreadCores:24 } },
    { key:'dread5', name:'Dread Tyrant', cls:'Carrier', price:0, reqKills:0, weapons:7, ammo:3, hull:3, drones:84,
      mods:{ hpPct:2240, dmgPct:1260, multiShot:336, critChance:280, critDamage:980, moveSpeed:210, atkSpeedPct:420, rangePct:672, lifeSteal:62 },
      tag:'DREAD-CLASS V', dreadAura:true, reqLevel:180,
      desc:'A tyrant hull that rewrites the battlefield — second only to the Omega.',
      megaCost:{ gold:30e9, fuel:360e6, iron:240e6, plasma:150e6, prism:24000, credits:9000000, dreadCores:36 } },
    { key:'dread6', name:'Dread Omega', cls:'Carrier', price:0, reqKills:0, weapons:7, ammo:3, hull:3, drones:96,
      mods:{ hpPct:2640, dmgPct:1485, multiShot:396, critChance:330, critDamage:1155, moveSpeed:248, atkSpeedPct:495, rangePct:792, lifeSteal:73 },
      tag:'DREAD-CLASS · OMEGA', dreadAura:true, reqLevel:200,
      desc:'The apex Dreadnaught — the single most powerful vessel in the galaxy, forged from a fortune in every currency.',
      megaCost:{ gold:50e9, fuel:600e6, iron:400e6, plasma:250e6, prism:40000, credits:15000000, dreadCores:60 } },
    // TITAN SINA — the FINAL-CLASS hero ship. Double the Dread Omega in every
    // stat, with weapon range that effectively covers the entire battle zone.
    // Its fire renders as full-spectrum gatling tracers — lasers of all colors.
    // Cost: 1T gold + 1B of each galaxy resource + 1,000 Void Credits (Dread
    // Cores) + 100,000 LootCoins.
    { key:'titansina', name:'Titan Sina', cls:'Carrier', price:0, reqKills:0, weapons:7, ammo:3, hull:3, drones:128,
      mods:{ hpPct:5280, dmgPct:2970, multiShot:792, critChance:660, critDamage:2310, moveSpeed:496, atkSpeedPct:990, rangePct:4000, lifeSteal:146 },
      tag:'FINAL CLASS · TITAN SINA', sinaTracers:true, reqLevel:200,
      desc:'The final-class hero ship — twice the Dread Omega in every dimension. Its guns reach across the entire battle zone, spraying full-spectrum tracer fire.',
      megaCost:{ gold:1e12, fuel:1e9, iron:1e9, plasma:1e9, credits:100000, dreadCores:1000 } },
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
  function shipPrevKey(key) {
    let i = SHIPS.findIndex((s) => s.key === key);
    if (i <= 0) return null;
    i--;
    while (i > 0 && SHIPS[i].side) i--;
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
  const FLEET = { slotLevels: [100, 200, 300, 400], maxShips: 5, escortDmgFrac: 0.25, escortFireRate: 1.1, statShare: 0.30 };

  // The ordered equipment slots a ship exposes. Extra weapon/ammo/hull slots
  // reuse the base item types (a 'bow' item fits bow2/bow3/bow4, etc.).
  const WEAP_SLOTS = ['bow','bow2','bow3','bow4','bow5','bow6','bow7'];
  const AMMO_SLOTS = ['arrows','arrows2','arrows3'];
  const HULL_SLOTS = ['armor','armor2','armor3'];
  function shipSlots(shipKey) {
    const s = SHIP_BY_KEY[shipKey] || SHIPS[0];
    return [].concat(WEAP_SLOTS.slice(0, s.weapons), AMMO_SLOTS.slice(0, s.ammo), HULL_SLOTS.slice(0, s.hull), ['boots','gloves','amulet']);
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
        nodes.push({ id: key + '_c' + t, br: key, name, mod: p.mod, per, max, cost, reqBranch, cap: true, desc: `+${per}${p.unit} ${p.label} per rank` });
        cum += cost * max;
      } else {
        const count = 2 + (t % 2); // 2–3 nodes per tier
        for (let i = 0; i < count; i++) {
          const p = pools[(t + i) % pools.length];
          const capped = p.mod === 'lifeSteal' || p.mod === 'multiShot';
          const per = capped ? p.per : Math.max(1, Math.round(p.per * (1 + t * 0.18)));
          const max = capped ? 3 : 5;
          seen[p.label] = (seen[p.label] || 0) + 1;
          nodes.push({ id: key + '_' + t + '_' + i, br: key, name: `${p.label} ${romanNum(seen[p.label])}`, mod: p.mod, per, max, cost, reqBranch, desc: `+${per}${p.unit} ${p.label} per rank` });
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
          { mod:'lifeSteal', label:'Life Steal', per:1, unit:'%' },
          { mod:'hpPct', label:'Plating', per:7, unit:'%' },
          { mod:'critChance', label:'Resolve', per:1, unit:'%' } ],
        { mod:'hpPct', label:'Max HP', per:18, unit:'%' },
        ['Bulwark','Juggernaut','Fortress','Immortal']),
      buildBranch('tactics',
        [ { mod:'moveSpeed', label:'Move Speed', per:4, unit:'%' },
          { mod:'multiShot', label:'Multi-Shot', per:2, unit:'%' },
          { mod:'atkSpeedPct', label:'Tempo', per:3, unit:'%' },
          { mod:'critChance', label:'Focus', per:2, unit:'%' } ],
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
    SPECIALS, MULTISHOT_MAX_TARGETS, SPEED_TIERS, STORE,
    SHIPS, SHIP_BY_KEY, DRONE, FLEET, shipSlots, slotBase, shipPrevKey, blueprintForZone,
    xpToNext, dungeonEnemyLevel, dungeonScale, enemyHp, enemyDamage, enemyXp, enemyGold,
    dropChance, playerBaseStat, sellValue, salvage, rollLifeSteal, rollMultiShot, rollShopRarity, shopPrice, rarityCap, COSMETICS,
  };
})();
