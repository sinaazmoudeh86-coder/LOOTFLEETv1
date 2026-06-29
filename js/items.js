/* =============================================================================
   items.js — GrabAGun Idle Operator
   Procedural loot: rarity rolls, real-firearm naming (GrabAGun-style catalog),
   normal + rare SPECIAL stats (Life Steal, Multi-Shot), comparison & power.
   ============================================================================= */
(function () {
  'use strict';
  const C = window.CONFIG;

  let _idSeq = 1;

  // Weighted rarity roll. Deeper zones apply a GENTLE upward "luck" pressure so
  // the rare tiers stay genuinely rare; a per-tier dampener makes each step up
  // the chain progressively harder to reach.
  function rollRarity(dungeon) {
    const luck = 1 + dungeon * 0.004;             // gentle depth pressure
    const cap = C.rarityCap ? C.rarityCap(dungeon) : 11;   // zone-gated ceiling
    // Steeper per-tier dampener (1.30) — each rarity step is markedly rarer than
    // the last, so top-end drops are a genuine grind even once unlocked.
    const weights = C.RARITY.map((r) =>
      r.tier > cap ? 0 : (r.tier === 0 ? r.weight : r.weight * Math.pow(luck, r.tier) / Math.pow(1.30, r.tier))
    );
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return i;
    }
    return 0;
  }

  // ---------------------------------------------------------------------------
  // REAL-FIREARM NAMING (GrabAGun catalog flavor).
  // Each slot has tiered name pools; higher rarity pulls from higher-end gear.
  // Rarity tier (0–10) → bucket 0 budget / 1 mid / 2 high / 3 elite.
  // ---------------------------------------------------------------------------
  const NAMES = {
    bow: [ // primary firearm
      ['Hi-Point C9', 'Taurus G3', 'SCCY CPX-2', 'Ruger EC9s', 'S&W SD9 VE', 'Canik TP9 SF'],
      ['Glock 19 Gen5', 'SIG Sauer P320', 'S&W M&P Shield', 'Springfield Hellcat', 'Ruger 10/22', 'Mossberg 500'],
      ['Daniel Defense DDM4', 'SIG P365 XL', 'Benelli M4', 'CZ Shadow 2', 'FN 509 Tactical', 'HK VP9'],
      ['Barrett M82A1', 'Desert Eagle .50', 'FN SCAR 17S', 'Staccato 2011 XC', 'Wilson Combat EDC X9', 'Nighthawk Custom'],
    ],
    arrows: [ // ammunition
      ['PMC Bronze 9mm', 'Magtech FMJ', 'Blazer Brass', 'Wolf Steel-Case', 'Tula 7.62', 'Aguila Mini'],
      ['Federal HST 9mm', 'CCI Blazer', 'Winchester USA', 'Remington UMC', 'Fiocchi Range', 'PMC X-TAC 5.56'],
      ['Hornady Critical Duty', 'Speer Gold Dot', 'Federal Premium', 'Sig Elite V-Crown', 'Winchester PDX1'],
      ['Hornady A-MAX Match', 'Federal Gold Medal', 'Barnes TAC-XPD', 'Black Hills MK262', 'Norma Match .308'],
    ],
    armor: [ // body armor / plate carrier
      ['Surplus Flak Vest', 'Condor Sentry', 'Rothco MOLLE Rig', 'NcStar Carrier', 'VISM Plate Rig'],
      ['5.11 TacTec', 'Condor MOPC', 'Blackhawk Carrier', 'AR500 Testudo', 'Spartan Plate Rig'],
      ['Crye Precision JPC', 'Shellback Banshee', 'Ferro Slickster', 'AR500 Veritas', 'LBT Carrier'],
      ['Crye Precision AVS', 'Eagle Ind. Plate', 'Velocity Systems SCARAB', 'S&S PreCURsor', 'Hoplite Composite'],
    ],
    boots: [ // tactical boots
      ['Rothco Combat Boots', 'NcStar Boots', 'Surplus Jungle Boots', 'Generic Tac Boots'],
      ['5.11 ATAC 2.0', 'Original SWAT Chase', 'Bates GX-8', 'Rocky S2V'],
      ['Salomon Forces Quest', 'Belleville TR960', 'LOWA Zephyr GTX', 'Garmont T8'],
      ['Salomon Forces Pro', 'Crispi Nevada Legend', 'Danner Acadia', 'LOWA Elite Mountain'],
    ],
    gloves: [ // tactical gloves
      ['Rothco Duty Gloves', 'NcStar Gloves', 'Surplus Work Gloves', 'Generic Shooters'],
      ['Mechanix M-Pact', '5.11 Hard Times', 'Magpul Technical', 'Hatch Operator'],
      ['Oakley SI Assault', 'PIG FDT Alpha', 'Mechanix Element', 'Outdoor Research'],
      ['Crye Precision Combat', 'PIG FDT Delta', 'Arc\'teryx Assault', 'SKD PIG Charlie'],
    ],
    amulet: [ // optic / sight
      ['Bushnell TRS-25', 'NcStar Red Dot', 'UTG Reflex', 'Sightmark Ultra'],
      ['Vortex Strikefire II', 'Holosun 403B', 'Sig Romeo5', 'Bushnell AR Optics'],
      ['Holosun 507C X2', 'Vortex Venom', 'Trijicon RMR', 'EOTech 512'],
      ['EOTech EXPS3', 'Trijicon ACOG', 'Aimpoint CompM5', 'Nightforce ATACR'],
    ],
  };
  // ---------------------------------------------------------------------------
  // WEAPON CLASSES — every primary weapon belongs to one of five classes. Each
  // class has its own arsenal of names, a guaranteed signature benefit, and a
  // distinct projectile visual (see render.js). Tooltips explain the benefit.
  // ---------------------------------------------------------------------------
  const WEAPON_CLASSES = [
    { key: 'laser',   name: 'Pulse Laser',      glyph: '⌶', color: '#5fd1ff',
      bonus: '+Attack Speed',
      blurb: 'Coherent-beam energy weapon. Light has no recoil — beams cycle faster than any slug-thrower.' },
    { key: 'gatling', name: 'Gatling Cannon',   glyph: '✢', color: '#ffd24d',
      bonus: '+1 Multi-Shot',
      blurb: 'Rotary kinetic cannon. The wall of tracers naturally sprays into extra targets.' },
    { key: 'missile', name: 'Missile Rack',     glyph: '➳', color: '#ff8a5c',
      bonus: '+20% Damage',
      blurb: 'Self-propelled heavy ordnance. Each warhead hits far harder than an energy bolt.' },
    { key: 'rail',    name: 'Railgun',          glyph: '⫷', color: '#b87bff',
      bonus: '+Crit Damage',
      blurb: 'Electromagnetic mass driver. Hypervelocity slugs turn critical hits devastating.' },
    { key: 'plasma',  name: 'Plasma Projector', glyph: '✺', color: '#46d27a',
      bonus: '+Life Steal',
      blurb: 'Magnetically-bottled starfire. Ionized impacts siphon energy back to your hull.' },
    { key: 'support', name: 'Warden Array',     glyph: '✚', color: '#7ce0a0',
      bonus: 'Fleet Heal & Buffs',
      blurb: 'Support emitter array. Projects a fleet-wide aura: extra Multi-Shot, hull recovery, damage reduction and weapon range. Mounts ONLY on the Aegis support hull.' },
  ];
  const WCLASS_BY_KEY = {}; WEAPON_CLASSES.forEach((w) => WCLASS_BY_KEY[w.key] = w);
  // class arsenals: name pools per quality bucket (budget → mid → high → elite)
  const WCLASS_NAMES = {
    laser: [
      ['VX-1 Pulse Emitter', 'Photon Sidearm', 'Glimmer Lance', 'Arc-Beam Mk I'],
      ['Helios Beamcaster', 'Prism Lance Mk II', 'Aurora Pulse Array', 'Star Cutter'],
      ['Solaris Beam X', 'Gamma Lance Prime', 'Spectral Cutter', 'Radiant Phase Lance'],
      ['Nova Coherence Engine', 'Dawnbreaker Beam', 'Archlight Prime', 'Quasar Lance Omega'],
    ],
    gatling: [
      ['Scrap Rotary Gun', 'Twin-Barrel Pepperbox', 'Junker Gatling', 'RT-4 Spinner'],
      ['Vulcan Rotary Mk II', 'Hailstorm Gatling', 'Cyclone Repeater', 'Storm-6 Rotary'],
      ['Tempest Minigun X', 'Maelstrom Rotary', 'Hurricane Suppressor', 'Vortex Chaingun'],
      ['Galehammer Shredder', 'Omega Cyclone Array', 'Supercell Rotary', 'Tempest Engine Zero'],
    ],
    missile: [
      ['Surplus Rocket Pod', 'Mule Missile Rack', 'SR-2 Launcher', 'Bottle Battery'],
      ['Javelin Missile Rack', 'Hammerfall Pod', 'Comet Battery Mk II', 'Striker Salvo'],
      ['Starfall Ordnance Rack', 'Meteor Storm Battery', 'Devastator Pod', 'Longbow Cruise Rack'],
      ['Extinction Salvo Array', 'Nova Rain Skyburier', 'Apocalypse Ordnance', 'Cataclysm Omega'],
    ],
    rail: [
      ['Scrap Coil Slugger', 'Gauss Pipe', 'Magnet Rifle', 'RG-1 Slinger'],
      ['Gauss Driver Mk II', 'Ion Rail Carbine', 'Hypervel Slugcaster', 'Linear Driver-7'],
      ['Hypervelocity Rail X', 'Quake Driver Prime', 'Penetrator Gauss', 'Stormrail Lance'],
      ['Starpiercer Driver', 'Relativistic Omega', 'Singular Rail Prime', 'Event Horizon Driver'],
    ],
    plasma: [
      ['Leaky Plasma Torch', 'Ember Projector', 'Slagcaster', 'PL-3 Spitter'],
      ['Plasma Projector Mk II', 'Sunspot Caster', 'Fusion Lobber', 'Starfire Projector'],
      ['Solar Flare X', 'Corona Caster Prime', 'Fusion Storm Array', 'Helion Projector'],
      ['Starcore Annihilator', 'Heart-of-Star', 'Helion Prime Array', 'Supergiant Omega'],
    ],
    support: [
      ['Field Mender Rig', 'Patchbeam Emitter', 'WD-1 Warden Coil', 'Tinker Aura Pod'],
      ['Warden Array Mk II', 'Guardian Halo Rig', 'Aegis Lattice', 'Bulwark Emitter'],
      ['Sanctuary Array X', 'Warden Prime Lattice', 'Bastion Halo', 'Custodian Field Rig'],
      ['Archangel Lattice', 'Eternal Warden Array', 'Sovereign Halo Prime', 'Pantheon Field Omega'],
    ],
  };
  // Resolve an item's weapon class. New drops carry `wclass`; legacy weapons
  // (incl. old firearm-named saves) map deterministically from their id so the
  // same item always shows — and fires — the same class.
  function weaponClassOf(item) {
    if (item && item.wclass && WCLASS_BY_KEY[item.wclass]) return WCLASS_BY_KEY[item.wclass];
    const h = item ? ((item.id || 0) * 7 + (item.name ? item.name.length : 0)) : 0;
    // floor + abs the hash so a non-integer/negative id can never index out of the
    // array (which would yield undefined and crash any tooltip reading wc.color).
    const idx = Math.abs(Math.floor(h)) % WEAPON_CLASSES.length;
    return WEAPON_CLASSES[idx] || WEAPON_CLASSES[0];
  }

  // Fleet-support aura projected by an equipped Warden Array, scaled by rarity.
  // Read at stat-compute time (game.js); DOUBLED while flying an Aegis hull.
  function supportAura(item) {
    if (!item || item.slot !== 'bow') return null;
    if (weaponClassOf(item).key !== 'support') return null;
    const r = item.rarity || 0;
    return {
      multiShot: 1,                                        // extra fleet volley
      regen: Math.round((0.4 + 0.12 * r) * 10) / 10,       // % max hull / sec
      reduce: Math.min(30, 3 + r),                         // % damage reduction
      rangePct: Math.round(5 + r * 1.5),                   // % weapon range
    };
  }

  // Weighted class roll — near-even odds, with Plasma Projectors slightly rarer.
  const WCLASS_WEIGHTS = { laser: 1, gatling: 1, missile: 1, rail: 1, plasma: 0.75, support: 1 };
  function pickWeaponClass() {
    const total = WEAPON_CLASSES.reduce((a, w) => a + (WCLASS_WEIGHTS[w.key] || 1), 0);
    let roll = Math.random() * total;
    for (const w of WEAPON_CLASSES) { roll -= (WCLASS_WEIGHTS[w.key] || 1); if (roll <= 0) return w; }
    return WEAPON_CLASSES[0];
  }

  function bucketFor(tier) { return tier <= 1 ? 0 : tier <= 3 ? 1 : tier <= 5 ? 2 : 3; }
  function pickName(slotKey, tier) {
    const buckets = NAMES[slotKey];
    const b = buckets[Math.min(buckets.length - 1, bucketFor(tier))];
    return b[(Math.random() * b.length) | 0];
  }
  function pickWeaponName(wkey, tier) {
    const buckets = WCLASS_NAMES[wkey];
    const b = buckets[Math.min(buckets.length - 1, bucketFor(tier))];
    return b[(Math.random() * b.length) | 0];
  }

  // ---------------------------------------------------------------------------
  // GENERATE a single item dropped in `dungeon`.
  // ---------------------------------------------------------------------------
  function generate(dungeon, forceRarity) {
    const rarityIdx = forceRarity != null ? forceRarity : rollRarity(dungeon);
    const rar = C.RARITY[rarityIdx];
    const slotKey = C.SLOT_KEYS[(Math.random() * C.SLOT_KEYS.length) | 0];
    const slot = C.SLOTS[slotKey];

    const scale = C.dungeonScale(dungeon);   // geometric power of this zone
    const ilvl = C.dungeonEnemyLevel(dungeon);

    // ---- normal stats (from the 6 core stats) ----
    const nStats = rar.minStats + ((Math.random() * (rar.maxStats - rar.minStats + 1)) | 0);
    const pool = [...C.STAT_KEYS];
    const chosen = [];
    chosen.push(slot.primary[(Math.random() * slot.primary.length) | 0]);
    while (chosen.length < nStats) {
      const pick = pool[(Math.random() * pool.length) | 0];
      if (!chosen.includes(pick)) chosen.push(pick);
    }
    const stats = {};
    chosen.forEach((statKey) => {
      const def = C.STATS[statKey];
      const variance = 0.82 + Math.random() * 0.36;
      let val;
      if (def.fmt === 'flat') {
        val = Math.max(1, Math.round(def.base * scale * rar.mult * variance));
      } else {
        const depthBonus = 1 + Math.log10(dungeon + 0.5) * 0.4;
        val = Math.max(0.1, Math.round(def.base * rar.mult * variance * depthBonus * 10) / 10);
      }
      stats[statKey] = val;
    });

    // ---- rare SPECIAL stats (life steal, multi-shot) — flat, non-scaling ----
    C.SPECIALS.forEach((sp) => {
      // higher-rarity items get a small bump to the appearance odds
      const chance = sp.chance * (1 + rarityIdx * 0.06);
      if (Math.random() < chance) stats[sp.key] = sp.roll();
    });

    // ---- WEAPON CLASS: primaries get a class, class name + signature bonus ----
    let wclass = null, name;
    if (slotKey === 'bow') {
      const wc = pickWeaponClass();
      wclass = wc.key;
      name = pickWeaponName(wc.key, rarityIdx);
      if (wc.key === 'laser')        stats.attackSpeed = Math.round((((stats.attackSpeed || 0)) + 2 + rarityIdx * 0.8) * 10) / 10;
      else if (wc.key === 'gatling') stats.multiShot = (stats.multiShot || 0) + 1;
      else if (wc.key === 'missile') { if (stats.attackDamage) stats.attackDamage = Math.round(stats.attackDamage * 1.2); }
      else if (wc.key === 'rail')    stats.critDamage = Math.round(((stats.critDamage || 0) + 15 + rarityIdx * 3) * 10) / 10;
      else if (wc.key === 'plasma')  stats.lifeSteal = Math.round((((stats.lifeSteal || 0)) + 1 + (rarityIdx >= 4 ? 1 : 0)) * 10) / 10;
      // 'support' (Warden Array) carries no extra item stat — its power is the
      // fleet aura, computed at runtime from rarity (see supportAura).
    } else {
      name = pickName(slotKey, rarityIdx);
    }

    return {
      id: _idSeq++,
      name,
      wclass,
      slot: slotKey,
      rarity: rarityIdx,
      dungeon,
      ilvl,
      stats,
      icon: slot.icon,
    };
  }

  // Power score for sorting, upgrade hints, and auto-equip. Built so that the
  // zone-scaled flat stats (damage / health) dominate ranking, with offense and
  // specials valued in sensible, comparable units (not so heavy that a single
  // special line makes a weak item outrank a strong one).
  // CLASS-FAIR RANKING — weapon classes are SIDE-grades by design (a missile
  // really hits harder, a laser really cycles faster). But auto-equip and
  // sorting rank by this power score, so if a class's signature bonus inflates
  // it, that class crowds out every hardpoint. Strip the known class-bonus
  // contribution from the score (new-format weapons only — legacy items never
  // received bonuses), and credit Warden arrays for their uncounted aura.
  function classAdjustPower(item, p) {
    if (item.slot !== 'bow' || !item.wclass) return p;
    const r = item.rarity || 0;
    switch (item.wclass) {
      case 'laser':   return p - 0.9 * (2 + 0.8 * r);                 // attackSpeed bonus
      case 'gatling': return p - 0.8;                                  // +1 multiShot
      case 'rail':    return p - 0.28 * (15 + 3 * r);                  // critDamage bonus
      case 'plasma':  return p - 1.4 * (1 + (r >= 4 ? 1 : 0));         // lifeSteal bonus
      case 'missile': {                                                // ×1.2 attackDamage
        const ad = item.stats.attackDamage || 0;
        const base = (C.STATS.attackDamage && C.STATS.attackDamage.base) || 14;
        return p - (ad * (0.2 / 1.2) / base) * 2.2;
      }
      case 'support': return p + 2 + r;                                // fleet aura credit
    }
    return p;
  }

  function itemPower(item) {
    let p = 0;
    for (const k in item.stats) {
      const def = C.STATS[k];
      const v = item.stats[k];
      if (!def) continue;
      switch (k) {
        case 'attackDamage': p += (v / def.base) * 2.2; break; // primary DPS driver
        case 'health':       p += (v / def.base) * 1.1; break; // EHP
        case 'attackSpeed':  p += v * 0.9;  break;
        case 'critChance':   p += v * 0.8;  break;
        case 'critDamage':   p += v * 0.28; break;
        case 'moveSpeed':    p += v * 0.3;  break;
        case 'lifeSteal':    p += v * 1.4;  break;  // strong but not dominant
        case 'multiShot':    p += v * 0.8;  break;
        default:             p += v * 0.5;
      }
    }
    p = classAdjustPower(item, p);
    p *= 1 + item.rarity * 0.05; // mild rarity nudge for ties
    return p;
  }

  // Per-stat delta of candidate vs equipped (for the compare view).
  function compare(candidate, equipped) {
    const delta = {};
    const keys = new Set([
      ...Object.keys(candidate.stats),
      ...(equipped ? Object.keys(equipped.stats) : []),
    ]);
    keys.forEach((k) => {
      const a = candidate.stats[k] || 0;
      const b = equipped ? equipped.stats[k] || 0 : 0;
      delta[k] = Math.round((a - b) * 10) / 10;
    });
    return delta;
  }

  // Per-tier drop probabilities for a given zone — mirrors rollRarity's exact
  // weighting so the Bag legend can show a player their real odds. Returns an
  // array of probabilities (0..1) indexed by rarity tier, summing to 1.
  function rarityChances(dungeon) {
    const luck = 1 + dungeon * 0.0045;
    const cap = C.rarityCap ? C.rarityCap(dungeon) : 11;
    const weights = C.RARITY.map((r) =>
      r.tier > cap ? 0 : (r.tier === 0 ? r.weight : r.weight * Math.pow(luck, r.tier) / Math.pow(1.18, r.tier))
    );
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    return weights.map((w) => w / total);
  }

  window.ITEMS = { generate, rollRarity, rarityChances, itemPower, compare, weaponClassOf, supportAura, WEAPON_CLASSES };
})();
