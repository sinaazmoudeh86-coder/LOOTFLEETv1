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
    const luck = 1 + dungeon * 0.0045;            // much gentler depth scaling
    const weights = C.RARITY.map((r) =>
      r.tier === 0 ? r.weight : r.weight * Math.pow(luck, r.tier) / Math.pow(1.18, r.tier)
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
  function bucketFor(tier) { return tier <= 1 ? 0 : tier <= 3 ? 1 : tier <= 5 ? 2 : 3; }
  function pickName(slotKey, tier) {
    const buckets = NAMES[slotKey];
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

    return {
      id: _idSeq++,
      name: pickName(slotKey, rarityIdx),
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
    const weights = C.RARITY.map((r) =>
      r.tier === 0 ? r.weight : r.weight * Math.pow(luck, r.tier) / Math.pow(1.18, r.tier)
    );
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    return weights.map((w) => w / total);
  }

  window.ITEMS = { generate, rollRarity, rarityChances, itemPower, compare };
})();
