/* =============================================================================
   commanders.js — LOOTFLEET · COMMANDERS (the Mech Foundry chase economy)
   -----------------------------------------------------------------------------
   Collectible officers pulled from the Mech Foundry and nowhere else. One rides
   in the fleet at a time, in a sixth slot beside the five hulls, and lends its
   bonus to the whole fleet.

   ---------------------------------------------------------------------------
   THERE IS ONE RARITY LADDER IN THIS GAME AND COMMANDERS USE IT.

   The design doc's own rule, and the most important line in it: a Commander pull
   is TWO rolls —

       ROLL 1  did a Commander drop at all?      (this file)
       ROLL 2  what rarity is it?                (C.RARITY — the item engine)

   Roll 2 reads C.RARITY's existing weights directly. There is no second table of
   Commander percentages, so retuning Mythic or Primordial retunes Commanders for
   free and the two can never drift into disagreeing about what "rare" means.
   Crates bias the roll with a FLOOR (a minimum tier) rather than by defining
   their own odds, which is the only kind of modifier that cannot fork the ladder.

   ---------------------------------------------------------------------------
   SAVE SHAPE — state.cmdr

     own    { [id]: { r, n } }   best rarity ever pulled for that officer, and
                                 how many times pulled. Both MONOTONIC.
     slot   id | null            who is flying with you
     dust   number               spendable — duplicates convert
     pulls  number               lifetime pulls (a record)

   `own` and `pulls` are RECORDS: a card cannot be un-found and a pull cannot be
   un-made, so they are max-unioned in mergeSaves(). `dust` is a WALLET and is
   deliberately NOT unioned — the same rule that keeps gold, credits and Mech
   Cores out of it. `slot` is a preference and follows the base pick.

   Everything is in ASC_KEEP: an ascension resets the fleet, not the collection.

   window.COMMANDERS
     unlocked() / gate()        \u26055 ascension gate
     onFoundryKill(e, isBoss)   ROLL 1, from the Foundry kill path only
     open(tier)                 buy and open a crate
     equip(id) / equipped()     the fleet slot
     mods()                     fleet-wide bonus, read by refreshStats
     albumHTML() / vaultHTML()  the Foundry's COLLECTION and VAULT sections
   ========================================================================== */
(function () {
  'use strict';
  const G = () => window.GAME;
  const CFG = () => window.CONFIG || {};
  const st = () => G().state;
  const num = (x) => Math.floor(Number(x) || 0);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => { try { return G().formatNum(n); } catch (e) { return String(num(n)); } };

  // ---- THE GATE -------------------------------------------------------------
  // ★5 Pilot Ascension. Deliberately above the Foundry's own Level 120 door: the
  // chase is endgame content, and a pilot who has ascended five times has both a
  // core income and a reason to spend it on something other than hulls.
  const GATE_STARS = 5;
  function stars() { try { const p = st().pasc; return Math.max(0, (p && p.stars) | 0); } catch (e) { return 0; } }
  function unlocked() { return stars() >= GATE_STARS; }
  function gate() { return { stars: GATE_STARS, have: stars(), ok: unlocked() }; }

  // ---- THE ROSTER -----------------------------------------------------------
  // Identity and rarity are INDEPENDENT: who you pulled is one roll, how good the
  // card is is another. That is what makes a Common Vex and a Paragon Vex two
  // different cards in the same album slot, exactly like a chase card's variants.
  //
  // `t` is the stat the officer lends the fleet. Kept to the same keys
  // computeStats() already folds, so a Commander is one more source in a sum that
  // already exists rather than a new combat path.
  // SPECIALISTS HIT HARDER, BUT ONLY IN THE RIGHT SEAT.
  //   (no tag)        generalist — works in any fleet, baseline value
  //   cls: 'Carrier'  class specialist — ×2.2, dead in any other class
  //   ship: 'key'     hull specialist — ×3.6, dead on any other hull
  //
  // The multiplier is the whole design: a Rare specialist in its own class beats
  // a Legendary generalist, so a collection is not just a rarity ladder — it is a
  // set of answers to "what am I flying?". A restriction that is not MET pays
  // nothing at all, which is why the card states the requirement on its face and
  // greys itself out when the requirement is unmet.
  const ROSTER = [
    { id: 'vex',    name: 'Vex',        t: 'dmgPct',      title: 'The Ledger' },
    { id: 'karo',   name: 'Karo',       t: 'hpPct',       title: 'Ironside' },
    { id: 'sable',  name: 'Sable',      t: 'critChance',  title: 'The Quiet Knife' },
    { id: 'rhen',   name: 'Rhen',       t: 'critDamage',  title: 'Overkill' },
    { id: 'juno',   name: 'Juno',       t: 'atkSpeedPct', title: 'Cadence' },
    { id: 'orik',   name: 'Orik',       t: 'dmgPct',      title: 'The Hammer' },
    { id: 'mira',   name: 'Mira',       t: 'lifeSteal',   title: 'Field Surgeon',   cls: 'Aegis' },
    { id: 'thane',  name: 'Thane',      t: 'hpPct',       title: 'The Wall',        cls: 'Battleship' },
    { id: 'lyss',   name: 'Lyss',       t: 'multiShot',   title: 'Scattergun',      cls: 'Carrier' },
    { id: 'corvin', name: 'Corvin',     t: 'rangePct',    title: 'Long Sight',      cls: 'Battleship' },
    { id: 'ashe',   name: 'Ashe',       t: 'dmgPct',      title: 'Cinderborn' },
    { id: 'noor',   name: 'Noor',       t: 'moveSpeed',   title: 'Slipstream',      cls: 'Frigate' },
    { id: 'gaskin', name: 'Gaskin',     t: 'hpPct',       title: 'Deadweight' },
    { id: 'sy',     name: 'Sy',         t: 'critChance',  title: 'The Gambler',     cls: 'Cruiser' },
    { id: 'harrow', name: 'Harrow',     t: 'dmgPct',      title: 'Blackfleet',      ship: 'mechsovereign' },
    { id: 'iven',   name: 'Iven',       t: 'atkSpeedPct', title: 'Redline',         cls: 'Cruiser' },
    { id: 'wren',   name: 'Wren',       t: 'multiShot',   title: 'Splitfire' },
    { id: 'dax',    name: 'Dax',        t: 'critDamage',  title: 'The Anvil',       ship: 'titan' },
    { id: 'sera',   name: 'Sera',       t: 'lifeSteal',   title: 'Bloodwork' },
    { id: 'kolt',   name: 'Kolt',       t: 'rangePct',    title: 'Horizon' },
    { id: 'brann',  name: 'Brann',      t: 'hpPct',       title: 'Bulwark',         cls: 'Aegis' },
    { id: 'nyx',    name: 'Nyx',        t: 'dmgPct',      title: 'The Void Hand',   ship: 'voidmaw' },
    { id: 'ovid',   name: 'Ovid',       t: 'moveSpeed',   title: 'Ghostline' },
    { id: 'zaria',  name: 'Zaria',      t: 'critDamage',  title: 'Last Word',       ship: 'mechtitan' },
    // ---- SECOND WAVE ---------------------------------------------------------
    // Six more officers, added with the third portrait sheet. New ids only — never
    // a rename of an existing one: a Commander id is written into every save that
    // holds that card, so renaming one revokes a pull.
    { id: 'roxa',   name: 'Roxa',       t: 'critChance',  title: 'The Corsair' },
    { id: 'sylle',  name: 'Sylle',      t: 'critDamage',  title: 'Starweaver',      cls: 'Carrier' },
    { id: 'crane',  name: 'Crane',      t: 'dmgPct',      title: 'Deadeye' },
    { id: 'pip',    name: 'Pip',        t: 'atkSpeedPct', title: 'Wrenchrat' },
    { id: 'vespa',  name: 'Vespa',      t: 'lifeSteal',   title: 'The Vintage' },
    { id: 'xarn',   name: 'Xarn',       t: 'multiShot',   title: 'The Chorus',      cls: 'Aegis' },
    // ---- THE WING COMMANDER --------------------------------------------------
    // The rarest card in the game and the only one that touches the FIGHTER wing.
    //
    // `elite` is what makes her rare: she can only be SELECTED by a pull that
    // already rolled Ancient or above, so no capped resource crate can ever
    // produce her at any price — she exists behind the uncapped LootCoin vaults
    // and the 1-in-500 Foundry boss drop, and nowhere else.
    //
    // Carrier-locked, and that is not an arbitrary restriction: fighter bays only
    // exist on carriers, so a wing bonus in any other seat would be a dead line.
    // Her multiplier is the highest in the game (×4.6) because the seat is the
    // narrowest in the game — the right hull, at the right rarity, or nothing.
    { id: 'kessia', name: 'Kessia',     t: 'fighterDmg', title: 'The Wingmother', cls: 'Carrier', elite: true },
  ];
  const BY_ID = {};
  ROSTER.forEach((c) => { BY_ID[c.id] = c; });

  const STAT_LABEL = {
    dmgPct: 'Fleet Damage', hpPct: 'Fleet Hull', critChance: 'Crit Chance',
    critDamage: 'Crit Damage', atkSpeedPct: 'Fire Rate', multiShot: 'Multi-Fire',
    rangePct: 'Weapon Range', moveSpeed: 'Move Speed', lifeSteal: 'Life Steal',
    fighterDmg: 'Fighter Damage',
  };
  // What a card is worth, by rarity index. One curve for every officer — the
  // OFFICER decides which stat, the RARITY decides how much.
  const SPEC_MULT = { none: 1, cls: 2.2, ship: 3.6, elite: 4.6 };
  const specKind = (w) => (w && w.elite ? 'elite' : w && w.ship ? 'ship' : w && w.cls ? 'cls' : 'none');
  // An elite officer is only in the draw once the rarity roll has already landed
  // Ancient or better — the rarity decides whether she is reachable at all, so a
  // capped crate cannot reach her by luck.
  const ELITE_AT = 6;              // Ancient
  // Is this officer's seat requirement met by the CURRENT flagship?
  function specOk(w) {
    if (!w || (!w.cls && !w.ship)) return true;
    let key = '', cls = '';
    try { key = st().ship || ''; cls = ((CFG().SHIP_BY_KEY || {})[key] || {}).cls || ''; } catch (e) {}
    if (w.ship) return key === w.ship;
    return cls === w.cls;
  }
  // The card chip gets a SHORT label. The full one ("MECH SOVEREIGN ONLY") was
  // already ellipsising at 9px inside a 62%-of-168px overlay, so raising the font
  // to the 11px floor would have truncated it further. The detail panel prints the
  // full requirement at 13px, so the chip only has to identify the seat — not
  // restate it.
  function specShort(w) {
    if (!w) return '';
    if (w.ship) {
      const nm = ((CFG().SHIP_BY_KEY || {})[w.ship] || {}).name || w.ship;
      const parts = String(nm).split(/\s+/);
      return (parts[parts.length - 1] || nm).toUpperCase();
    }
    return w.cls ? w.cls.toUpperCase() : '';
  }
  function specLabel(w) {
    if (!w) return '';
    if (w.ship) { const s2 = (CFG().SHIP_BY_KEY || {})[w.ship]; return ((s2 && s2.name) || w.ship).toUpperCase() + ' ONLY'; }
    if (w.cls) return w.cls.toUpperCase() + ' ONLY';
    return '';
  }
  function bonusFor(rIdx, statKey, who) {
    const r = Math.max(0, Math.min(11, rIdx | 0));
    const mult = SPEC_MULT[specKind(who)] || 1;
    const scale = Math.pow(1.55, r) * mult;           // Common 1 → Paragon ~180
    if (statKey === 'fighterDmg') return Math.round(Math.min(400, 2.6 * scale));
    if (statKey === 'lifeSteal') return Math.round(Math.min(4, 0.15 * scale) * 100) / 100;
    if (statKey === 'multiShot') return Math.round(Math.min(40, 1.2 * scale));
    if (statKey === 'critChance') return Math.round(Math.min(35, 1.0 * scale));
    if (statKey === 'moveSpeed') return Math.round(Math.min(60, 1.6 * scale));
    return Math.round(Math.min(300, 2.2 * scale));    // dmg / hull / crit dmg / rate / range
  }

  // ---- STATE ----------------------------------------------------------------
  function rec() {
    const s = st();
    if (!s.cmdr || typeof s.cmdr !== 'object') s.cmdr = { own: {}, slots: [], dust: 0, pulls: 0 };
    if (!s.cmdr.own || typeof s.cmdr.own !== 'object') s.cmdr.own = {};
    if (s.cmdr.dust == null) s.cmdr.dust = 0;
    if (s.cmdr.pulls == null) s.cmdr.pulls = 0;
    // MIGRATE, NEVER RESET. The first build shipped a single `slot`; a save that
    // has one keeps that officer as its first assignment rather than being handed
    // an empty bench. `slot` is left in place — an unrecognised key is never
    // deleted, and an old client reading this save still finds what it expects.
    if (!Array.isArray(s.cmdr.slots)) s.cmdr.slots = s.cmdr.slot ? [s.cmdr.slot] : [];
    return s.cmdr;
  }
  // ONE COMMANDER PER ACTIVE SHIP. The bench is the size of the fleet actually
  // flying: the flagship plus every filled escort slot. Fewer ships, fewer
  // officers — so growing the fleet grows the bench, and it can never exceed it.
  function capacity() {
    let n = 1;
    try { if (typeof G().fleetShips === 'function') n += G().fleetShips().length; } catch (e) {}
    return Math.max(1, Math.min(ROSTER.length, n));
  }
  // Assignments the pilot can actually field right now: owned, and inside capacity.
  function slots() {
    const c = rec();
    return (c.slots || []).filter((id) => BY_ID[id] && c.own[id]).slice(0, capacity());
  }
  const owned = () => Object.keys(rec().own).length;
  const dust = () => num(rec().dust);
  const isEquipped = (id) => slots().indexOf(id) !== -1;
  function equipped() { return slots()[0] || null; }   // kept for callers wanting "the first"

  // ---- THE COMMANDER RARITY TABLE -------------------------------------------
  // ITS OWN TABLE, AND DELIBERATELY SO. Commanders used to roll on C.RARITY, the
  // item ladder — which meant every loot-luck source in the game (zone quality,
  // Treasure Sense, crate luck, ascension rarity caps) silently inflated card
  // pulls too. A collection's odds should be a fixed, publishable fact, not a
  // function of how much loot gear a pilot happens to be wearing.
  //
  // So: same twelve TIER NAMES and colours as the item ladder — read off C.RARITY
  // so a retune of a colour or a rename carries — but its own WEIGHTS, and nothing
  // multiplies them. No luck, no loot bonus, no rarity cap. What the crate card
  // prints is what the roll does, for every pilot, forever.
  //
  // Loosened through the mid-table so a collection actually fills: Eternal lands
  // at 3%, and the top three stay genuinely brutal because that is the chase.
  // Indices are THIS game's ladder, which is not the reference sheet's:
  //   0 Common · 1 Uncommon · 2 Rare · 3 Epic · 4 Legendary · 5 Mythic
  //   6 Ancient · 7 Divine · 8 Cosmic · 9 Void · 10 Eternal · 11 Primordial
  // Eternal is index TEN, so "Eternal ~3%" means loosening the whole tail, not
  // just the middle — the first pass put 3% on Cosmic and left Eternal at 0.4%.
  const CMDR_W = [200, 172, 142, 115, 92, 73, 57, 46, 37, 31, 30, 5];   // /1000
  const W_TOTAL = CMDR_W.reduce((a, b) => a + b, 0);

  // ---- ROLL 2 — THE COMMANDER LADDER ----------------------------------------
  // Weighted exactly as C.RARITY declares. A crate shapes the draw with a WINDOW
  // — a floor and a CEILING — rather than by declaring its own percentages, which
  // is the only kind of modifier that cannot fork the ladder. Inside the window
  // the game's weights are untouched, so the shape of rarity is always the same
  // shape; a crate only decides which part of it you are rolling on.
  function rollRarity(floor, cap) {
    const n = CMDR_W.length;
    const hi = Math.max(0, Math.min(n - 1, cap == null ? n - 1 : cap | 0));
    const lo = Math.max(0, Math.min(hi, floor | 0));
    let total = 0;
    for (let i = lo; i <= hi; i++) total += CMDR_W[i];
    if (total <= 0) return lo;
    let x = Math.random() * total;
    for (let i = lo; i <= hi; i++) { x -= CMDR_W[i]; if (x <= 0) return i; }
    return lo;
  }
  // Published odds come from the SAME array the roll walks, so the table on the
  // crate card cannot drift from the draw.
  function oddsOf(floor, cap) {
    const n = CMDR_W.length;
    const hi = Math.max(0, Math.min(n - 1, cap == null ? n - 1 : cap | 0));
    const lo = Math.max(0, Math.min(hi, floor | 0));
    let total = 0;
    for (let i = lo; i <= hi; i++) total += CMDR_W[i];
    const rows = [];
    for (let i = lo; i <= hi; i++) rows.push({ i, name: rarityOf(i).name, color: rarityOf(i).color, p: total ? CMDR_W[i] / total : 0 });
    const excluded = [];
    for (let i = 0; i < n; i++) if (i < lo || i > hi) excluded.push({ i, name: rarityOf(i).name, below: i < lo });
    return { rows, excluded };
  }
  const rarityOf = (i) => (CFG().RARITY || [])[Math.max(0, Math.min(11, i | 0))] || { name: '?', color: '#9aa0a6' };

  // ---- A PULL ---------------------------------------------------------------
  // The one place a Commander is created. Records the best rarity ever seen for
  // that officer and counts the duplicate; a lesser copy never overwrites a
  // better one, and a duplicate pays dust instead of vanishing.
  function grant(rIdx, src) {
    const c = rec();
    // The draw pool depends on the rarity that was already rolled: elites are out
    // of it entirely below Ancient.
    const pool = ROSTER.filter((w) => !w.elite || rIdx >= ELITE_AT);
    const who = pool[Math.floor(Math.random() * pool.length)];
    const cur = c.own[who.id];
    const isNew = !cur;
    const better = !cur || rIdx > (cur.r | 0);
    if (!cur) c.own[who.id] = { r: rIdx, n: 1 };
    else { cur.n = num(cur.n) + 1; if (better) cur.r = rIdx; }
    c.pulls = num(c.pulls) + 1;
    let gained = 0;
    if (!isNew && !better) { gained = dustFor(rIdx); c.dust = dust() + gained; }
    return { who, r: rIdx, isNew, better, dust: gained, src: src || 'crate' };
  }

  // ---- ROLL 1 — THE DROP ----------------------------------------------------
  // Foundry kills only, and vanishingly rare on purpose. These are the design
  // doc's own numbers; the boss figure is what makes a tier clear worth finishing
  // rather than farming trash.
  const DROP = { mob: 1 / 25000, elite: 1 / 5000, boss: 1 / 500 };
  function onFoundryKill(e, isBoss) {
    if (!unlocked()) return null;
    const p = isBoss ? DROP.boss : (e && (e.isSuper || e.isElite)) ? DROP.elite : DROP.mob;
    if (Math.random() >= p) return null;
    const g = grant(rollRarity(0), 'drop');
    try { G().save(); } catch (x) {}
    announce(g);
    return g;
  }

  // ---- THE VAULT ------------------------------------------------------------
  // PRICED AGAINST THE REAL FOUNDRY ECONOMY. The design doc quoted 25B Alloy /
  // 10B Mech Cores; a tier pays 12–380 cores a run, so 10B is about 26 million
  // runs and no currency called Alloy exists. Cores are the Foundry's only
  // output, so cores are the price.
  //
  // THE FIRST THREE COST GALAXY RESOURCES, not Mech Cores. Fuel, iron and plasma
  // are the game's broad economy — every held system, every salvage and every
  // colony feeds them — so the free path into Commanders is open to anyone with
  // territory rather than gated behind the Foundry's own narrow output. It also
  // stops the two systems fighting: cores stay the Foundry's currency and buy
  // HULLS, resources buy CARDS, and a pilot never has to choose between the two
  // with one pile.
  //
  // RESOURCE CRATES ARE CAPPED. They buy a wide, reliable ladder up the middle of
  // the table — Common through Mythic across three tiers — and stop there.
  // LootCoins are the ONLY route that can roll Ancient and above.
  //
  // Worth being clear about what that means, because it is a monetisation change
  // rather than a tuning one: the top four tiers are now behind a paid crate, so
  // the free path can complete a collection but cannot finish it at the top. The
  // ceilings overlap deliberately (cores reach Mythic, the cheap LootCoin vault
  // starts at Epic) so the paid route is a continuation of the free one rather
  // than a separate game.
  const CRATES = [
    { t: 1, key: 'salvaged', ic: '🔧', name: 'Salvaged Crate',   res: { fuel: 40000000,  iron: 15000000,  plasma: 7500000 },  pulls: 1, floor: 0, cap: 2,
      blurb: 'One pull, bought with Galaxy Resources. The grind box — no boosted odds, and it will never roll above Rare.' },
    { t: 2, key: 'advanced', ic: '⚙',  name: 'Advanced Crate',   res: { fuel: 150000000, iron: 60000000,  plasma: 35000000 }, pulls: 3, floor: 2, cap: 4,
      blurb: 'Three pulls, none below Rare. The everyday resource sink.' },
    { t: 3, key: 'vanguard', ic: '◈',  name: 'Vanguard Crate',   res: { fuel: 600000000, iron: 250000000, plasma: 150000000 }, pulls: 5, floor: 3, cap: 5,
      blurb: 'Five pulls, none below Epic. The deepest a resource-bought crate reaches.' },
    { t: 4, key: 'elite',    ic: '🌌', name: 'Elite Vault',      lc: 10000,     pulls: 5, floor: 3, cap: null, epicOne: true,
      blurb: 'Five pulls from Epic upward with NO ceiling — the first crate that can reach Ancient and beyond.' },
    { t: 5, key: 'paragon',  ic: '👑', name: 'Paragon Vault',    lc: 20000,     pulls: 10, floor: 4, cap: null, epicOne: true,
      blurb: 'Ten pulls, none below Legendary, no ceiling. The most attempts at the top of the table money can buy — the odds up there are still the odds.' },
  ];
  const CRATE_BY = {};
  CRATES.forEach((c) => { CRATE_BY[c.key] = c; });

  // The exact odds of a crate, computed from C.RARITY's weights over that crate's
  // own window — the SAME arithmetic rollRarity() performs, so the published
  // number cannot drift from the roll. Never a hand-written percentage: that is
  // how a drop-rate table starts lying.
  const oddsFor = (c) => oddsOf(c.floor, c.cap);
  // A percentage while it is readable, then odds — "0.0004%" tells a player
  // nothing and "1 in 240,000" tells them exactly what they are chasing.
  function pctTxt(p) {
    if (p <= 0) return '—';
    if (p >= 0.001) return (p * 100 >= 10 ? (p * 100).toFixed(1) : (p * 100).toFixed(2)) + '%';
    return '1 in ' + fmt(Math.round(1 / p));
  }

  function canOpen(key) {
    const c = CRATE_BY[key]; if (!c) return { ok: false, why: 'no crate' };
    if (!unlocked()) return { ok: false, why: 'gate' };
    const need = [];
    if (c.res) {
      const have = st().resources || {};
      for (const k in c.res) { const h = num(have[k]); if (h < c.res[k]) need.push(fmt(c.res[k] - h) + ' ' + k); }
    }
    if (c.lc && num(st().credits) < c.lc) need.push(fmt(c.lc - num(st().credits)) + ' LootCoins');
    return need.length ? { ok: false, why: 'short', need: need.join(' \u00b7 ') } : { ok: true };
  }
  // Order the write so a throw cannot strand the player: validate, then debit and
  // grant in ONE synchronous block with no awaits between payment and goods.
  let _busy = false;
  function open(key) {
    if (_busy) return null;
    _busy = true;
    try {
      const c = CRATE_BY[key]; if (!c) return null;
      const chk = canOpen(key);                  // re-checked AT THE WRITE, not when drawn
      if (!chk.ok) { toast(chk.why === 'short' ? 'Not enough: ' + chk.need : 'Locked'); return null; }
      const s = st();
      if (c.res) {
        if (!s.resources) s.resources = { fuel: 0, iron: 0, plasma: 0 };
        for (const k in c.res) s.resources[k] = Math.max(0, num(s.resources[k]) - c.res[k]);
      }
      if (c.lc) s.credits = Math.max(0, num(s.credits) - c.lc);
      const out = [];
      for (let i = 0; i < c.pulls; i++) {
        // the guaranteed Epic lands on the LAST pull so the reveal builds
        const floor = (c.epicOne && i === c.pulls - 1) ? Math.max(c.floor, 3) : c.floor;
        out.push(grant(rollRarity(floor, c.cap), 'crate'));
      }
      try { G().save(); } catch (e) {}
      out.forEach(announce);
      return out;
    } finally { _busy = false; }
  }

  // ---- THE EXCHANGE ---------------------------------------------------------
  // Duplicates are the whole reason a chase economy needs an outlet. Two of them:
  //
  //   PROMOTE  three spare copies of an officer raise that card one tier. It is
  //            the only route that is not a roll, so a player grinding one card
  //            can always climb — slowly, and never past the top.
  //   SCRAP    one spare copy becomes dust. Dust buys a pull, so a card you will
  //            never seat still feeds the hunt.
  //
  // Both consume from `n` and neither can touch the LAST copy: the card itself is
  // never destroyed, only its spares.
  const persist = () => { try { G().save(); } catch (e) {} };
  // FUSION AND DUST BOTH SCALED UP. Four spares to fuse rather than three, and the
  // dust economy tightened from both ends: a scrap PAYS LESS and every sink COSTS
  // MORE, so dust is a long-term reserve rather than a fast second currency.
  //
  // Net effect on a Legendary promotion: it was ~48 spare Legendary copies of dust,
  // it is now ~225. That is a deliberate order-of-magnitude move, not a trim —
  // duplicates are meant to accumulate into something rare, and at the old rates a
  // week of pulls converted straight into a tier.
  // spares to raise a card ONE tier, priced by the tier being left:
  //   Common 3 · Rare 11 · Epic 21 · Legendary 39 · Mythic 74 · Ancient 141 · …
  // Reaching Primordial by fusion alone now costs thousands of duplicates rather
  // than 44, which is the point: the LootCoin vaults remain the real route to the
  // top of the table and the grind can still climb the part of it it is meant to.
  const promoCost = (r) => Math.max(3, Math.round(3 * Math.pow(1.9, Math.max(0, r | 0))));
  const PROMO_COST = promoCost(0);       // legacy export — the entry-tier figure
  const dustFor = (r) => 2 * Math.pow(2, Math.min(9, r | 0));
  const DUST_PULL = 2400;                      // dust for one Mythic-capped pull
  // TARGETED PROMOTION is the sink that makes dust make sense. Scrapping spares
  // for a random pull is a lottery ticket; spending them to raise a card the
  // player has ALREADY CHOSEN is a decision. Priced off the tier being left, so
  // climbing the top of the ladder costs what the top of the ladder is worth.
  const dustPromo = (r) => 900 * Math.pow(2, Math.min(9, r | 0));
  function spare(id) { const o = rec().own[id]; return o ? Math.max(0, num(o.n) - 1) : 0; }
  function canPromote(id) {
    const o = rec().own[id]; if (!o) return { ok: false, why: 'unowned' };
    if (o.r >= CMDR_W.length - 1) return { ok: false, why: 'max' };
    const cost = promoCost(o.r);
    if (spare(id) < cost) return { ok: false, why: 'short', cost, need: (cost - spare(id)) + ' more spare' };
    return { ok: true, cost };
  }
  // What a bulk fuse would actually do, computed before anything is spent so the
  // button can state it rather than surprise with it.
  function promoteAllPlan() {
    const own = rec().own;
    const ids = Object.keys(own).filter((id) => BY_ID[id] && canPromote(id).ok);
    // deepest-first, so the tier that matters most lands even if something below
    // it turns out to be ineligible
    ids.sort((a, b) => (own[b].r | 0) - (own[a].r | 0));
    return { ids, spares: ids.reduce((n, id) => n + promoCost(own[id].r), 0) };
  }
  function promoteAll() {
    if (_ex) return 0;
    _ex = true;
    try {
      const { ids } = promoteAllPlan();
      if (!ids.length) { toast('Nothing can fuse \u2014 a step costs ' + promoCost(0) + ' spares at Common and more at every tier above'); return 0; }
      let n = 0; const named = [];
      for (const id of ids) {
        // RE-CHECKED PER CARD AT ITS OWN WRITE, not once for the batch.
        const chk = canPromote(id);
        if (!chk.ok) continue;
        const o = rec().own[id];
        o.n = num(o.n) - chk.cost;           // priced at THIS card's tier
        o.r = Math.min(CMDR_W.length - 1, (o.r | 0) + 1);
        named.push(BY_ID[id].name + ' \u2192 ' + rarityOf(o.r).name);
        n++;
      }
      if (!n) return 0;
      persist();
      toast('\u2726 ' + n + ' PROMOTED \u2014 ' + named.slice(0, 3).join(', ') + (n > 3 ? ' +' + (n - 3) + ' more' : ''));
      return n;
    } finally { _ex = false; }
  }
  let _ex = false;
  function promote(id) {
    if (_ex) return false;
    _ex = true;
    try {
      const c = canPromote(id);
      if (!c.ok) { toast(c.why === 'max' ? 'Already at the top tier' : 'Needs ' + promoCost((rec().own[id] || {}).r | 0) + ' spare copies at this tier'); return false; }
      const o = rec().own[id];
      o.n = num(o.n) - c.cost;                 // spares consumed, priced at its tier
      o.r = Math.min(CMDR_W.length - 1, (o.r | 0) + 1);
      persist();
      toast('\u2726 ' + BY_ID[id].name.toUpperCase() + ' PROMOTED \u2014 now ' + rarityOf(o.r).name);
      return true;
    } finally { _ex = false; }
  }
  function scrap(id, all) {
    if (_ex) return 0;
    _ex = true;
    try {
      const o = rec().own[id]; if (!o) return 0;
      const nSp = spare(id); if (nSp <= 0) { toast('No spare copies to scrap'); return 0; }
      const take = all ? nSp : 1;
      o.n = num(o.n) - take;
      const gain = dustFor(o.r) * take;
      rec().dust = dust() + gain;
      persist();
      toast('\u2726 +' + fmt(gain) + ' dust \u2014 ' + take + ' spare ' + BY_ID[id].name + (take > 1 ? ' copies' : ' copy') + ' scrapped');
      return gain;
    } finally { _ex = false; }
  }
  // Dust back into the hunt. Uncapped floor, capped ceiling — it is a consolation
  // pull, not a route past the paid vaults.
  // Spend dust to raise one card a tier. No spares required — this is the route
  // for an officer you hold exactly one of, which is precisely the card a spares
  // requirement can never help.
  function canDustPromote(id) {
    const o = rec().own[id]; if (!o) return { ok: false, why: 'unowned' };
    if (o.r >= CMDR_W.length - 1) return { ok: false, why: 'max' };
    const cost = dustPromo(o.r);
    if (dust() < cost) return { ok: false, why: 'short', cost, need: cost - dust() };
    return { ok: true, cost };
  }
  function dustPromote(id) {
    if (_ex) return false;
    _ex = true;
    try {
      // RE-CHECKED AT THE WRITE, not when the button was drawn — a sheet can sit
      // open while dust is spent elsewhere.
      const c = canDustPromote(id);
      if (!c.ok) { toast(c.why === 'max' ? 'Already at the top tier' : 'Need \u2726 ' + fmt(c.need) + ' more dust'); return false; }
      const o = rec().own[id];
      rec().dust = dust() - c.cost;
      o.r = Math.min(CMDR_W.length - 1, (o.r | 0) + 1);
      persist();
      toast('\u2726 ' + BY_ID[id].name.toUpperCase() + ' PROMOTED \u2014 now ' + rarityOf(o.r).name);
      return true;
    } finally { _ex = false; }
  }
  // BULK CONVERT. Scrapping thirty spares one tap at a time is the kind of chore
  // that makes a player stop using a system. Ceilinged by rarity so nobody can
  // fat-finger their Eternal spares into dust.
  function scrapUpTo(maxR) {
    if (_ex) return 0;
    _ex = true;
    try {
      const own = rec().own;
      let gain = 0, n = 0;
      for (const id in own) {
        const o = own[id];
        if (!o || (o.r | 0) > maxR) continue;
        const sp = Math.max(0, num(o.n) - 1);
        if (!sp) continue;
        o.n = num(o.n) - sp;
        gain += dustFor(o.r) * sp;
        n += sp;
      }
      if (!n) { toast('No spare copies at or below ' + rarityOf(maxR).name); return 0; }
      rec().dust = dust() + gain;
      persist();
      toast('\u2726 +' + fmt(gain) + ' dust \u2014 ' + n + ' spare copies scrapped');
      return gain;
    } finally { _ex = false; }
  }
  function dustPull() {
    if (_ex) return null;
    _ex = true;
    try {
      if (dust() < DUST_PULL) { toast('Need \u2726 ' + fmt(DUST_PULL - dust()) + ' more dust'); return null; }
      rec().dust = dust() - DUST_PULL;
      const g = grant(rollRarity(0, 5), 'dust');
      persist();
      return [g];
    } finally { _ex = false; }
  }

  // ---- WHY THAT SEAT IS EMPTY ----------------------------------------------
  // A sheet, not a toast. The rule has three moving parts (which officer, which
  // hull, what you are flying now) and a two-second toast cannot carry them — the
  // same reason a rule never belongs in a title attribute. It names what is
  // required, what is flying, and the one action that fixes it.
  function seatBlocked(id) {
    const w = BY_ID[id]; if (!w) return;
    const flying = (CFG().SHIP_BY_KEY || {})[st().ship || ''] || null;
    const flyName = flying ? flying.name : (st().ship || 'your current hull');
    const flyCls = flying ? (flying.cls || '') : '';
    const owned = !!(st().ownedShips || {})[w.ship];
    const o2 = rec().own[id] || {};
    const R = rarityOf(o2.r | 0);
    const b = bonusFor(o2.r | 0, w.t, w);
    const hullNm = esc(((CFG().SHIP_BY_KEY || {})[w.ship] || {}).name || w.ship || '');
    // The fix line is the point of the sheet: a player who reads this should know
    // their next tap, not merely what went wrong.
    const fix = w.ship
      ? (owned ? 'Switch your flagship to the <b>' + hullNm + '</b> in <b>My Fleet</b>.'
               : 'You do not own the <b>' + hullNm + '</b> yet. This card waits on the bench until you do.')
      : 'Fly any <b>' + esc(w.cls) + '</b>-class hull as your flagship. Escorts do not count — the seat reads your <b>flagship</b>.';
    document.querySelectorAll('.cm-blockveil').forEach((n) => n.remove());
    const o = document.createElement('div');
    o.className = 'cm-veil cm-blockveil';
    o.innerHTML = '<div class="cm-bk">'
      + '<div class="cm-bk-k">○ SEAT REQUIREMENT NOT MET</div>'
      + '<div class="cm-bk-t">' + esc(w.name) + ' <em style="color:' + R.color + '">' + esc(R.name) + '</em></div>'
      + '<div class="cm-bk-req"><span>REQUIRES</span><b>' + esc(specLabel(w)) + '</b></div>'
      + '<div class="cm-bk-now"><span>YOU ARE FLYING</span><b>' + esc(flyName) + (flyCls ? ' · ' + esc(flyCls) : '') + '</b></div>'
      + '<div class="cm-bk-b">' + fix + '</div>'
      + '<div class="cm-bk-n">In the right hull this card pays <b>+' + b + (w.t === 'multiShot' ? '×' : '%') + ' '
      + esc(STAT_LABEL[w.t] || w.t) + '</b> to your whole fleet. In the wrong one it pays <b>nothing</b> — which is why it cannot be benched.</div>'
      + '<div class="cm-bk-n dim">An ascension resets your flagship to the <b>Frigate</b>, so class and hull specialists go quiet until you switch back. Nothing was lost.</div>'
      + '<button class="cm-rv-x" data-x>GOT IT</button></div>';
    document.body.appendChild(o);
    const close = () => o.remove();
    o.querySelector('[data-x]').addEventListener('click', close);
    o.addEventListener('click', (e) => { if (e.target === o) close(); });
  }

  // ---- THE FLEET SLOT -------------------------------------------------------
  // A TOGGLE, not an assignment. Tapping an equipped officer stands them down;
  // tapping a new one seats them if there is room and refuses if there is not —
  // silently dropping someone else to make space is the kind of thing a player
  // discovers in the middle of a fight.
  function equip(id) {
    const c = rec();
    if (!Array.isArray(c.slots)) c.slots = [];
    if (!id) { c.slots = []; }
    else {
      if (!(BY_ID[id] && c.own[id])) return false;
      const i = c.slots.indexOf(id);
      if (i !== -1) c.slots.splice(i, 1);       // standing down is always allowed
      else {
        // THE SEAT IS CHECKED BEFORE THE BENCH IS. A card that would pay nothing is
        // refused with the requirement stated, not seated into silence.
        if (!specOk(BY_ID[id])) { seatBlocked(id); return false; }
        if (slots().length >= capacity()) { toast('Bench full \u2014 ' + capacity() + ' ship' + (capacity() === 1 ? '' : 's') + ', ' + capacity() + ' commander' + (capacity() === 1 ? '' : 's')); return false; }
        c.slots.push(id);
      }
    }
    c.slot = c.slots[0] || null;          // keep the legacy key honest for old clients
    try { G().save(); } catch (e) {}
    try { if (window.GAME && G().refreshStats) G().refreshStats(); } catch (e) {}
    // NOTE: no UI.refreshAll() here. It repaints the whole shell, which re-entered
    // this screen's render on top of the caller's own — two rebuilds per tap, and
    // the visible flicker that came with them. The caller repaints what it owns.
    return true;
  }
  // Read by refreshStats(), folded in with every other source. One officer, one
  // stat — a Commander is a bonus in a sum that already exists, not a new path.
  // FIGHTER DAMAGE IS NOT A computeStats KEY. The wing prices its damage off
  // rt.stats.attackDamage and then applies its own multipliers, so this is handed
  // to fighters.js at the one point Wing Tactics is applied — the same seam, so a
  // fighter bonus behaves like every other fleet bonus the wing already honours.
  function fighterMult() {
    const own = rec().own;
    let pct = 0;
    slots().forEach((id) => {
      const c = own[id], who = BY_ID[id];
      if (c && who && who.t === 'fighterDmg' && specOk(who)) pct += bonusFor(c.r, 'fighterDmg', who);
    });
    return 1 + pct / 100;
  }
  // EVERY SEATED OFFICER CONTRIBUTES, summed per stat. A seat requirement that is
  // not met pays nothing — half-crediting a specialist would make every card a
  // generalist with extra words.
  function mods() {
    const out = {};
    const own = rec().own;
    slots().forEach((id) => {
      const c = own[id], who = BY_ID[id];
      if (!c || !who) return;
      if (who.t === 'fighterDmg') return;          // delivered via fighterMult()
      if (!specOk(who)) return;
      const b = bonusFor(c.r, who.t, who);
      out[who.t] = (out[who.t] || 0) + b;
      // THE SECOND STAT WAS PRINTED BUT NEVER PAID. Legendary and above earn a
      // second line (secondOf), and every surface that draws a card renders it —
      // the album, the bench and the picker all promise "+18% Crit Damage" on a
      // Legendary Sylle. mods() only ever emitted the PRIMARY, so that line was
      // decoration: the stat never reached refreshStats and the player was right
      // that it was not being calculated.
      //
      // Paid at the same 45% of the primary the cards state, so the number the
      // fleet gets is the number on the card rather than a second opinion.
      const s2 = secondOf(who, c.r);
      if (s2) out[s2] = (out[s2] || 0) + Math.max(1, Math.round(b * 0.45));
    });
    return out;
  }

  // ---- ANNOUNCEMENTS --------------------------------------------------------
  // An ultra-rare pull is an event, not a line. Ancient+ (index 6) posts to the
  // channel through the Foundry's own RPC — fire and forget, never blocking the
  // grant.
  const LOUD_AT = 6;
  function announce(g) {
    if (!g || g.r < LOUD_AT) return;
    try {
      const cl = window.CLOUD && window.CLOUD.client && window.CLOUD.client();
      if (!cl) return;
      cl.rpc('log_mech', { p_kind: 'mechCmdr', p_meta: {
        cmdr: g.who.name, title: g.who.title, rarity: rarityOf(g.r).name, tier: g.r, src: g.src,
      } }).then(() => {}, () => {});
    } catch (e) {}
  }
  function toast(m) { try { if (window.UI && window.UI.unlockToast) window.UI.unlockToast(m); } catch (e) {} }

  // ===========================================================================
  // THE SCREENS — rendered into the Mech Foundry, because that is the only place
  // Commanders come from and a chase economy should live where the hunt is.
  // ===========================================================================
  // ---- THE CARD FACE --------------------------------------------------------
  // ONE builder, shared by the album and the reveal, so a card can never look
  // like two different things in two places.
  //
  // The art is a real PORTRAIT if one exists at commanders/<id>.png and a framed
  // silhouette plate if it does not — the <img> hides itself on error, so dropping
  // artwork into that folder upgrades every card with no code change and a missing
  // file never leaves a broken image on screen.
  const PIPS = (r) => Math.max(1, Math.min(8, Math.round((r + 1) * 8 / 12)));
  // ---- THE PORTRAIT PROBE ---------------------------------------------------
  // THIS IS WHAT CAUSED THE FLICKER. Every card used to emit
  //     <img src="commanders/<id>.png" onerror="this.remove()">
  // so each render created 24 image elements, each fired a request that 404s, and
  // each then deleted itself — a full DOM churn and 24 failed requests on every
  // single interaction, which is exactly what a flicker looks like.
  //
  // The existence check now happens ONCE per id, off-DOM, against a cached result.
  // A card only ever emits an <img> for a portrait already known to load, so the
  // markup is stable between renders and nothing appears then vanishes.
  const _port = {};                       // id -> true | false (undefined = unprobed)
  let _probedAll = false;
  // PROBE THE WHOLE ROSTER, ONCE. Probing only OWNED ids meant a reveal of a
  // brand-new officer had nothing cached yet, so the card that mattered most —
  // the one just pulled — was the one that showed a silhouette. Thirty images
  // loaded once at open, cached by the browser thereafter.
  function probeAll() {
    if (_probedAll || typeof ROSTER === 'undefined' || !ROSTER.length) return;
    _probedAll = true;
    ROSTER.forEach((w) => probePortrait(w.id));
  }
  function probePortrait(id) {
    if (_port[id] !== undefined) return;
    _port[id] = false;
    const im = new Image();
    im.onload = () => {
      if (_port[id]) return;
      _port[id] = true;
      // If a reveal is on screen, swap the art in underneath it rather than
      // leaving the just-pulled card as a silhouette until it is dismissed.
      document.querySelectorAll('.cm-veil .cm-rv-face').forEach((face) => {
        if (face.querySelector('.cmf-port')) return;
        const art = face.querySelector('.cmf-art');
        const fig = face.querySelector('.cmf-fig');
        if (!art || !fig || face._pid !== id) return;
        const im2 = document.createElement('img');
        im2.className = 'cmf-port'; im2.src = 'commanders/' + id + '.png';
        art.insertBefore(im2, fig.nextSibling);
      });
      scheduleRender();
    };
    im.src = 'commanders/' + id + '.png';
  }
  // One coalesced repaint if a probe lands late, so art appearing does not cause a
  // burst of renders on first open.
  let _rq = null;
  function scheduleRender() {
    if (_rq) return;
    _rq = setTimeout(() => {
      _rq = null;
      try { render(); } catch (e) {}
      // scheduleRender() used to repaint #cmdr-body only, so a probe resolving
      // while My Fleet was on screen left that row stale. Patch the row in place
      // wherever it is mounted — cheap, and it keeps the two surfaces in step
      // without reaching for a whole-shell refresh.
      try {
        document.querySelectorAll('.cmr').forEach((row) => {
          const tmp = document.createElement('div');
          tmp.innerHTML = fleetRowHTML();
          const next = tmp.firstElementChild;
          if (next) { const host = row.parentNode; row.replaceWith(next); bindFleetRow(host); }
        });
      } catch (e) {}
    }, 120);
  }
  // A SECOND LINE IS EARNED, NOT DECORATION. Legendary and above carry a support
  // stat at 45% of the primary, which is why a high-rarity card reads as denser on
  // the sheet as well as bigger — the extra line IS the upgrade, not a reprint of
  // the same number. Derived from the primary so it is stable per officer forever.
  const SECOND = { dmgPct: 'critDamage', hpPct: 'dmgPct', critChance: 'dmgPct',
    critDamage: 'critChance', atkSpeedPct: 'dmgPct', multiShot: 'dmgPct',
    rangePct: 'critChance', moveSpeed: 'hpPct', lifeSteal: 'hpPct' };
  const SECOND_AT = 4;                                  // Legendary
  const secondOf = (w, r) => (r >= SECOND_AT ? (SECOND[w.t] || null) : null);
  // multiShot is a COUNT, not a percentage. Printing "+40" bare read as a broken
  // number next to every other card's "+73%", so it carries its own unit.
  const unitOf = (k) => (k === 'multiShot' ? '\u00d7' : '%');
  function statLine(k, v) {
    return '<span class="cmf-s">+' + v + unitOf(k) + ' <i>' + esc(STAT_LABEL[k] || k) + '</i></span>';
  }
  function faceHTML(id, o) {
    const who = BY_ID[id]; if (!who) return '';
    const R = rarityOf(o.r);
    const b = bonusFor(o.r, who.t, who);
    const kind = specKind(who), ok = specOk(who);
    const s2k = secondOf(who, o.r);
    const s2v = s2k ? Math.max(1, Math.round(b * 0.45)) : 0;
    // Built to the reference sheet: a rarity HEADER BAR inside the frame, the art
    // full-bleed beneath it with a crest badge over the corner, a pip band, then a
    // footer carrying the name in the rarity colour and one or two stat lines.
    return '<div class="cmf-hd">' + esc(R.name) + '</div>'
      + '<div class="cmf-art">'
      + '<div class="cmf-neb"></div>'
      + '<div class="cmf-glow"></div>'
      + '<div class="cmf-fig' + (who.elite ? ' elite' : '') + '"><i></i><b></b></div>'
      + (_port[id] === true ? '<img class="cmf-port" src="commanders/' + esc(id) + '.png" alt="">' : '')
      + '<div class="cmf-crest"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l8 3.4v6.2c0 4.3-3.2 8.2-8 10.4-4.8-2.2-8-6.1-8-10.4V5.4z"/></svg></div>'
      + (kind !== 'none' ? '<div class="cmf-spec' + (ok ? ' on' : '') + '">' + esc(specShort(who)) + '</div>' : '')
      + '<div class="cmf-pips">' + '\u2605'.repeat(PIPS(o.r)) + '</div>'
      + '</div>'
      + '<div class="cmf-cap">'
      + '<b>' + esc(who.name) + '</b>'
      + '<div class="cmf-stats' + (kind !== 'none' && !ok ? ' off' : '') + '">'
      + statLine(who.t, b) + (s2k ? statLine(s2k, s2v) : '')
      + '</div>'
      + (kind !== 'none' ? '<em class="cmf-req' + (ok ? ' on' : '') + '">' + (ok ? '\u25c9 ACTIVE' : '\u25cb ' + esc(specLabel(who))) + '</em>' : '')
      + '</div>';
  }
  function card(id, o, big) {
    const R = rarityOf(o.r);
    return '<div class="cm-card' + (big ? ' big' : '') + '" style="--cc:' + R.color + '">'
      + faceHTML(id, o)
      + (o.n > 1 ? '<span class="cm-dup">\u00d7' + o.n + '</span>' : '')
      + '</div>';
  }
  // ---- THE EXCHANGE ---------------------------------------------------------
  // Its own section, because "what do I do with 1.24K dust?" had no answer on
  // screen — the number sat in a bar with one hidden button in the crate list.
  // Everything dust and duplicates can do is stated here, in one place, with the
  // costs printed next to the actions rather than discovered by tapping.
  function exchangeHTML() {
    if (!unlocked()) return '';
    const own = rec().own;
    const dupes = Object.keys(own).filter((id) => BY_ID[id] && spare(id) > 0);
    dupes.sort((a, b) => (own[b].r - own[a].r) || (spare(b) - spare(a)));
    const totalSp = dupes.reduce((n, id) => n + spare(id), 0);
    const row = (id) => {
      const o = own[id], w = BY_ID[id], R = rarityOf(o.r), sp = spare(id);
      const pr = canPromote(id), dp = canDustPromote(id);
      const nextR = rarityOf(Math.min(CMDR_W.length - 1, o.r + 1));
      return '<div class="cmx-row">'
        + (_port[id] === true
            ? '<img class="cmp-img" src="commanders/' + esc(id) + '.png" alt="">'
            : '<span class="cmp-mono" style="color:' + R.color + '">' + esc(w.name.slice(0, 2).toUpperCase()) + '</span>')
        + '<span class="cmx-x"><span class="cmp-n">' + esc(w.name)
        + '<em style="color:' + R.color + '">' + esc(R.name) + '</em></span>'
        + '<span class="cmx-sp">\u00d7' + sp + ' spare ' + (sp === 1 ? 'copy' : 'copies') + '</span></span>'
        + '<span class="cmx-acts">'
        + (o.r >= CMDR_W.length - 1
          ? '<span class="cmx-max">TOP TIER</span>'
          : '<button class="cm-ex-btn' + (pr.ok ? ' go' : '') + '" data-cm-promo="' + esc(id) + '"' + (pr.ok ? '' : ' disabled') + '>'
            + 'FUSE \u2192 ' + esc(nextR.name) + '<i>' + promoCost(o.r) + ' spares \u00b7 have ' + sp + '</i></button>')
        + '<button class="cm-ex-btn" data-cm-scrapall="' + esc(id) + '">SCRAP \u00d7' + sp
        + '<i>+' + fmt(dustFor(o.r) * sp) + ' dust</i></button>'
        + '</span></div>';
    };
    // every owned card can be dust-promoted, spares or not
    const promoTargets = Object.keys(own).filter((id) => BY_ID[id] && own[id].r < CMDR_W.length - 1);
    promoTargets.sort((a, b) => own[b].r - own[a].r);
    return '<div class="mf-sec">EXCHANGE</div>'
      + '<div class="cm-dustbar"><span class="cm-db-k">\u2726 ' + fmt(dust()) + ' DUST</span>'
      + '<span class="cm-db-s">Dust comes from <b>scrapping spare copies</b>. Spend it to <b>promote a card you already hold</b> one rarity tier, or on a pull capped at Mythic.</span></div>'
      + '<div class="cmx-grid">'
      + '<div class="cmx-card"><div class="cmx-h">FUSE DUPLICATES</div>'
      + '<div class="cmx-note">Spare copies of one officer raise that card <b>one tier</b> \u2014 the only route up that is not a roll. '
      + 'A step is priced by the tier it leaves: <b>' + promoCost(0) + '</b> at ' + esc(rarityOf(0).name)
      + ', <b>' + promoCost(4) + '</b> at ' + esc(rarityOf(4).name)
      + ', <b>' + promoCost(7) + '</b> at ' + esc(rarityOf(7).name) + '.</div>'
      + (dupes.length ? '<div class="cmx-list">' + dupes.map(row).join('') + '</div>'
         : '<div class="cmx-empty">No duplicates yet. Pull the same officer twice and the spare shows up here.</div>')
      + (() => {
          const pl = promoteAllPlan();
          if (!pl.ids.length) return '';
          return '<div class="cmx-bulk"><span>All at once:</span>'
            + '<button class="cm-ex-btn go wide" data-cm-promoall>FUSE ALL \u00b7 ' + pl.ids.length + ' card' + (pl.ids.length === 1 ? '' : 's')
            + '<i>' + pl.spares + ' spares \u00b7 one tier each</i></button></div>';
        })()
      + (totalSp > 1 ? '<div class="cmx-bulk"><span>Clear out the low end:</span>'
          + '<button class="cm-ex-btn" data-cm-bulk="2">SCRAP ALL \u2264 RARE</button>'
          + '<button class="cm-ex-btn" data-cm-bulk="4">SCRAP ALL \u2264 LEGENDARY</button></div>' : '')
      + '</div>'
      + '<div class="cmx-card"><div class="cmx-h">SPEND DUST</div>'
      + '<div class="cmx-note">Promote any card you hold \u2014 <b>no spares needed</b>. This is the route for an officer you only have one of.</div>'
      + (promoTargets.length ? '<div class="cmx-list">' + promoTargets.slice(0, 8).map((id) => {
          const o = own[id], w = BY_ID[id], R = rarityOf(o.r), dp = canDustPromote(id);
          const nextR = rarityOf(Math.min(CMDR_W.length - 1, o.r + 1));
          return '<div class="cmx-row slim">'
            + '<span class="cmx-x"><span class="cmp-n">' + esc(w.name)
            + '<em style="color:' + R.color + '">' + esc(R.name) + '</em></span>'
            + '<span class="cmx-sp">\u2192 ' + esc(nextR.name) + '</span></span>'
            + '<button class="cm-ex-btn' + (dp.ok ? ' go' : '') + '" data-cm-dpromo="' + esc(id) + '"' + (dp.ok ? '' : ' disabled') + '>'
            + '\u2726 ' + fmt(dustPromo(o.r)) + '<i>' + (dp.ok ? 'promote' : 'need ' + fmt(dp.need || 0)) + '</i></button>'
            + '</div>';
        }).join('') + '</div>'
        : '<div class="cmx-empty">Nothing to promote \u2014 pull a Commander first.</div>')
      + '<div class="cmx-bulk"><span>Or gamble it:</span>'
      + '<button class="cm-ex-btn' + (dust() >= DUST_PULL ? ' go' : '') + '" data-cm-dust' + (dust() >= DUST_PULL ? '' : ' disabled') + '>'
      + '\u2726 ' + fmt(DUST_PULL) + '<i>one pull, Mythic cap</i></button></div>'
      + '</div></div>';
  }

  function vaultHTML() {
    const g = gate();
    if (!g.ok) {
      return '<div class="mf-sec">COMMANDER VAULT</div>'
        + '<div class="cm-lock">🔒 Commanders unlock at <b>Ascension ★' + g.stars + '</b> — you are at <b>★' + g.have + '</b>.</div>';
    }
    const lc = num(st().credits);
    const res = st().resources || {};
    // CMDR_W IS THE LADDER, not CFG().RARITY. The item table is longer (it ends
    // at Eclipse); a Commander cannot roll past Primordial, and the card must not
    // say otherwise.
    const top = CMDR_W.length - 1;
    const R = Array.from({ length: CMDR_W.length }, (_, i) => rarityOf(i));
    return '<div class="mf-sec">COMMANDER VAULT</div>'
      + '<div class="mf-note">Every pull rolls the game\u2019s own rarity table — a crate only decides <b>which part of it</b> you roll on. The first three are bought with <b>Galaxy Resources</b> and ladder up the middle; <b>LootCoin vaults are the only crates with no ceiling</b>, and the only route to Ancient and above.</div>'
      + '<div class="mf-grid mf-shop">' + CRATES.map((c) => {
        const afford = canOpen(c.key).ok;
        const hi = c.cap == null ? top : c.cap;
        const loR = R[c.floor] || { name: '?', color: '#888' };
        const hiR = R[hi] || { name: '?', color: '#888' };
        const paid = !!c.lc;
        // THE WINDOW IS PRINTED, never implied. A ceiling a player only discovers
        // after spending 60,000 cores reads as a bug, not as a design.
        const od = oddsFor(c);
        const above = od.excluded.filter((x) => !x.below);
        const below = od.excluded.filter((x) => x.below);
        const win = '<div class="cm-win"><span class="cm-w-k">CAN ROLL</span>'
          + '<span class="cm-w-r"><b style="color:' + loR.color + '">' + esc(loR.name) + '</b> \u2192 '
          + '<b style="color:' + hiR.color + '">' + esc(hiR.name) + '</b></span>'
          + (c.cap == null ? '<span class="cm-w-no">NO CEILING</span>' : '<span class="cm-w-cap">CAPPED</span>')
          + '</div>'
          // EVERY TIER IN THE WINDOW, WITH ITS REAL CHANCE. A stacked bar so the
          // shape of the odds is visible at a glance, then the numbers under it.
          + '<div class="cm-od">'
          + '<div class="cm-od-bar">' + od.rows.map((r) => '<i style="flex:' + Math.max(0.004, r.p)
              + ';background:' + r.color + '" title=""></i>').join('') + '</div>'
          + '<div class="cm-od-rows">' + od.rows.map((r) => '<span class="cm-od-r">'
              + '<b style="color:' + r.color + '">' + esc(r.name) + '</b><em>' + pctTxt(r.p) + '</em></span>').join('')
            + '</div>'
          + (above.length
            ? '<div class="cm-od-no"><b>CANNOT ROLL</b> ' + esc(above.map((x) => x.name).join(', ')) + '</div>'
            : '<div class="cm-od-no ok"><b>NO CEILING</b> every tier in the game is reachable</div>')
          + (below.length
            ? '<div class="cm-od-fl"><b>FLOOR</b> never rolls ' + esc(below.map((x) => x.name).join(', ')) + '</div>' : '')
          + '</div>';
        return '<div class="mf-card cm-crate' + (paid ? ' paid' : '') + '" style="--mfc:'
          + (paid ? '#c07bff' : c.t === 3 ? '#ff8a3d' : c.t === 2 ? '#5bc0ff' : '#8fb7d9') + '">'
          + '<div class="mf-c-h"><span class="mf-s-ic">' + c.ic + '</span><span class="mf-c-n">' + esc(c.name) + '</span>'
          + (c.cap == null ? '<span class="cm-tag">UNCAPPED</span>' : '') + '</div>'
          + '<div class="mf-c-s">' + esc(c.blurb) + '</div>'
          + win
          + '<div class="mf-cost">'
          + (c.res ? Object.keys(c.res).map((k) => '<span class="' + (num(res[k]) >= c.res[k] ? 'ok' : 'no') + '">'
              + fmt(c.res[k]) + ' ' + k + '</span>').join('') : '')
          + (c.lc ? '<span class="lc ' + (lc >= c.lc ? 'ok' : 'no') + '">\u25c8 ' + fmt(c.lc) + ' LootCoins</span>' : '')
          + '<span class="ok">' + c.pulls + ' pull' + (c.pulls > 1 ? 's' : '') + '</span></div>'
          + '<button class="mf-go" data-cm-open="' + c.key + '"' + (afford ? '' : ' disabled') + '>'
          + (afford ? 'OPEN' : 'NOT ENOUGH') + '</button></div>';
      }).join('') + '</div>';
  }
  // Which card the player is INSPECTING. Separate from what is equipped, so
  // browsing the album never changes the fleet by accident.
  let _sel = null;
  let _filter = 'all';
  function detailHTML() {
    const c = rec();
    const id = _sel && c.own[_sel] ? _sel : equipped();
    if (!id) {
      return '<div class="cm-det empty"><div class="cm-det-h">SELECT A COMMANDER</div>'
        + '<p>Tap any discovered card to inspect it, then assign it to your fleet.</p></div>';
    }
    const o = c.own[id], who = BY_ID[id], on = isEquipped(id);
    const kind = specKind(who), ok = specOk(who);
    return '<div class="cm-det">'
      + '<div class="cm-det-card cm-card" style="--cc:' + rarityOf(o.r).color + '">' + faceHTML(id, o) + '</div>'
      + '<div class="cm-det-x">'
      + '<div class="cm-det-h">' + esc(who.name.toUpperCase()) + ' <em>' + esc(who.title) + '</em></div>'
      + '<div class="cm-det-r" style="color:' + rarityOf(o.r).color + '">' + esc(rarityOf(o.r).name)
      + (o.n > 1 ? ' \u00b7 \u00d7' + o.n + ' held' : '') + '</div>'
      + (kind !== 'none'
        ? '<div class="cm-det-s' + (ok ? ' ok' : '') + '">' + (ok
            ? '\u25c9 Seat requirement met \u2014 ' + esc(specLabel(who))
            : '\u25cb Pays nothing until you fly a ' + esc(specLabel(who).replace(' ONLY', ''))) + '</div>'
        : '<div class="cm-det-s ok">\u25c9 Generalist \u2014 works in any fleet</div>')
      + '<div class="cm-det-b">'
      + (on ? '<button class="mf-info" data-cm-eq="' + esc(id) + '">STAND DOWN</button>'
            : '<button class="mf-go" data-cm-eq="' + esc(id) + '"' + (slots().length >= capacity() ? ' disabled' : '') + '>'
              + (slots().length >= capacity() ? 'BENCH FULL' : 'ASSIGN TO FLEET') + '</button>')
      + '</div></div></div>';
  }
  function albumHTML() {
    if (!unlocked()) return '';
    probeAll();
    const c = rec(), have = Object.keys(c.own);
    // UNIFORM WITH MY FLEET. The album used to have its own detail rail and its own
    // card grid — a second way to do the one thing the fleet row already does. It
    // now renders the SAME bench component and the SAME cell shape, and every tap
    // opens the SAME picker, so assigning a Commander looks and behaves identically
    // wherever the player happens to be standing.
    const list = ROSTER.filter((w) => (_filter === 'owned' ? !!c.own[w.id]
      : _filter === 'missing' ? !c.own[w.id] : true));
    list.sort((a, b) => {
      const oa = c.own[a.id], ob = c.own[b.id];
      if (!!oa !== !!ob) return oa ? -1 : 1;
      if (oa && ob) {
        const ma = specOk(a) ? 1 : 0, mb = specOk(b) ? 1 : 0;
        if (ma !== mb) return mb - ma;
        if (oa.r !== ob.r) return ob.r - oa.r;
      }
      return a.name.localeCompare(b.name);
    });
    const chip = (k, lbl, n) => '<button class="cm-chip' + (_filter === k ? ' on' : '') + '" data-cm-f="' + k + '">'
      + lbl + ' <i>' + n + '</i></button>';
    const cell = (w) => {
      const o = c.own[w.id];
      if (!o) {
        return '<div class="cmr-c empty locked"><span class="cmr-p">?</span>'
          + '<span class="cmr-n">Undiscovered</span></div>';
      }
      const R = rarityOf(o.r), ok = specOk(w), on = isEquipped(w.id);
      const b = bonusFor(o.r, w.t, w), u = w.t === 'multiShot' ? '' : '%';
      const s2k = secondOf(w, o.r), s2v = s2k ? Math.max(1, Math.round(b * 0.45)) : 0;
      // ART LEADS, then name + tier on ONE line, then a stat block along the base
      // that names what the card actually pays. The old cell stacked five short
      // lines of equal weight, so the portrait was a thumbnail and the value the
      // player chooses on was the same size as everything around it.
      return '<button class="cmr-c tall' + (on ? ' seated' : '') + '" data-cmr="' + esc(w.id) + '" style="--cc:' + R.color + '">'
        + '<span class="cmr-art">'
        + (_port[w.id] === true
            ? '<img class="cmr-img" src="commanders/' + esc(w.id) + '.png" alt="">'
            : '<span class="cmr-p">' + esc(w.name.slice(0, 2).toUpperCase()) + '</span>')
        + (o.n > 1 ? '<span class="cmr-dup">\u00d7' + o.n + '</span>' : '')
        + '</span>'
        + '<span class="cmr-id"><b>' + esc(w.name) + '</b>'
        + '<em style="color:' + R.color + '">' + esc(R.name) + '</em></span>'
        + '<span class="cmr-stats' + (ok ? '' : ' off') + '">'
        + (ok
          ? '<span class="cmr-line"><b>+' + b + u + '</b><i>' + esc(STAT_LABEL[w.t] || w.t) + '</i></span>'
            + (s2k ? '<span class="cmr-line sm"><b>+' + s2v + (s2k === 'multiShot' ? '' : '%') + '</b><i>' + esc(STAT_LABEL[s2k] || s2k) + '</i></span>' : '')
          : '<span class="cmr-unmet">\u25cb ' + esc(specLabel(w)) + '</span>'
            + '<span class="cmr-line sm dim"><b>+' + b + u + '</b><i>' + esc(STAT_LABEL[w.t] || w.t) + '</i></span>')
        + '</span>'
        + (on ? '<span class="cmr-on">SEATED</span>' : '')
        + '</button>';
    };
    return '<div class="mf-sec">COMMANDER BENCH</div>'
      + fleetRowHTML()
      + '<div class="mf-sec">COMMANDER ALBUM</div>'
      + '<div class="cm-bar">' + chip('all', 'ALL', ROSTER.length)
      + chip('owned', 'OWNED', have.length) + chip('missing', 'MISSING', ROSTER.length - have.length)
      + '<span class="cm-bar-d">\u2726 ' + fmt(dust()) + ' dust</span></div>'
      + '<div class="cmr-slots album">' + list.map(cell).join('') + '</div>';
  }
  // EVERY ACTION ON THE SCREEN IS BOUND HERE, IN ONE TABLE.
  //
  // The Exchange shipped completely inert: none of its five actions had a click
  // handler, because the edits that were supposed to add them landed against
  // anchor text that no longer existed and the misses were not caught. Worse, the
  // check that was supposed to catch it counted ELEMENTS CARRYING THE ATTRIBUTE
  // (`querySelectorAll('[data-cm-dpromo]').length`) rather than listeners, so it
  // reported five bound buttons on a menu where nothing was bound at all.
  //
  // A declarative table cannot drift the same way: an action with no entry is
  // visible as a missing row, and the count below is asserted at bind time.
  const ACTIONS = [
    ['data-cm-open',     'cmOpen',     (v) => { const r = open(v); if (r && r.length) reveal(r, CRATE_BY[v]); try { if (window.MECHF) window.MECHF.render(); } catch (e) {} }],
    ['data-cmr',         'cmr',        (v) => openPicker(v || '')],
    ['data-cm-eq',       'cmEq',       (v) => { equip(v || null); render(); }],
    ['data-cm-f',        'cmF',        (v) => { _filter = v; render(); }],
    ['data-cm-promo',    'cmPromo',    (v) => { if (promote(v)) render(); }],
    ['data-cm-scrap',    'cmScrap',    (v) => { if (scrap(v, false)) render(); }],
    ['data-cm-scrapall', 'cmScrapall', (v) => { if (scrap(v, true)) render(); }],
    ['data-cm-dpromo',   'cmDpromo',   (v) => { if (dustPromote(v)) render(); }],
    ['data-cm-bulk',     'cmBulk',     (v) => { if (scrapUpTo(+v)) render(); }],
    ['data-cm-promoall',  null,         () => { if (promoteAll()) render(); }],
    ['data-cm-dust',     null,         () => { const r = dustPull(); if (r) { reveal(r, { name: 'DUST EXCHANGE' }); render(); } }],
  ];
  function bind(root) {
    if (!root) return 0;
    let n = 0;
    ACTIONS.forEach(([attr, key, fn]) => {
      root.querySelectorAll('[' + attr + ']').forEach((b) => {
        if (b._cmb) return;                      // render() replaces nodes; never double-bind
        b._cmb = 1;
        b.addEventListener('click', (ev) => { ev.stopPropagation(); fn(key ? b.dataset[key] : null); });
        n++;
      });
    });
    return n;
  }

  // ---- THE OPENING ----------------------------------------------------------
  // The pull is already decided before a single pixel moves — this reveals a
  // result, it never influences one. That ordering matters: an animation that
  // decides anything is a second source of truth for the rarity table.
  //
  // Cards land face-down and flip one at a time so a five-pull crate has a build
  // to it, and the LAST card is the one the Elite Vault guarantees, so the best
  // pull is usually the final flip. Tapping reveals everything at once — a player
  // who has seen it a hundred times should never be made to sit through it.
  const LOUD_LABEL = { 6: 'RARE DISCOVERY', 7: 'RARE DISCOVERY', 8: 'GALACTIC DISCOVERY', 9: 'GALACTIC DISCOVERY', 10: 'GALACTIC DISCOVERY', 11: 'GALACTIC DISCOVERY' };
  function reveal(pulls, crate) {
    if (!pulls || !pulls.length) return;
    probeAll();
    // ONE VEIL, EVER — the same guard the Choir result card needed. Opening two
    // crates quickly must not stack reveals the player has to dismiss in order.
    document.querySelectorAll('.cm-veil').forEach((n) => { if (n._t) clearTimeout(n._t); n.remove(); });
    const best = pulls.reduce((a, x) => (x.r > a.r ? x : a), pulls[0]);
    const o = document.createElement('div');
    o.className = 'cm-veil';
    o.innerHTML =
      '<div class="cm-rv">'
      + '<div class="cm-rv-k">' + esc((crate && crate.name) || 'COMMANDER CRATE') + '</div>'
      + '<div class="cm-rv-row' + (pulls.length > 5 ? ' many' : '') + '">' + pulls.map((p, i) => {
        const R = rarityOf(p.r), w = p.who;
        return '<div class="cm-rv-c" data-i="' + i + '" data-pid="' + esc(w.id) + '" style="--cc:' + R.color + '">'
          + '<div class="cm-rv-in">'
          + '<div class="cm-rv-back"><span>\u2726</span></div>'
          + '<div class="cm-rv-face">'
          + faceHTML(w.id, { r: p.r, n: 1 })
          + (p.isNew ? '<span class="cm-rv-new">NEW</span>'
             : p.better ? '<span class="cm-rv-new up">UPGRADE</span>'
             : p.dust ? '<span class="cm-rv-dup">\u2726 ' + fmt(p.dust) + '</span>' : '')
          + '</div></div></div>';
      }).join('') + '</div>'
      + '<div class="cm-rv-foot"><button class="cm-rv-x" data-x>SKIP</button>'
      + '<div class="cm-rv-hint">tap to reveal all</div></div>'
      + '</div>';
    document.body.appendChild(o);

    const cards = Array.from(o.querySelectorAll('.cm-rv-c'));
    cards.forEach((el) => { const fa = el.querySelector('.cm-rv-face'); if (fa) fa._pid = el.dataset.pid; });
    const btn = o.querySelector('[data-x]');
    const hint = o.querySelector('.cm-rv-hint');
    let n = 0;
    // The cadence SHRINKS as the pull gets bigger, so a ten-card vault takes about
    // as long as a five-card one instead of twice as long. A reveal is a beat, not
    // a wait.
    const GAP = Math.max(190, Math.round(2600 / Math.max(1, cards.length)));
    const flip = (i) => {
      const el = cards[i]; if (!el || el.classList.contains('flip')) return;
      el.classList.add('flip');
      const r = pulls[i].r;
      if (r >= LOUD_AT) {
        o.classList.add('loud');
        if (!o.querySelector('.cm-rv-banner')) {
          const bn = document.createElement('div');
          bn.className = 'cm-rv-banner';
          bn.innerHTML = '<b>' + esc(LOUD_LABEL[Math.min(11, r)] || 'RARE DISCOVERY') + '</b><i>'
            + esc(rarityOf(r).name.toUpperCase()) + ' \u00b7 ' + esc(pulls[i].who.name.toUpperCase()) + '</i>';
          o.querySelector('.cm-rv').prepend(bn);
        }
        try { if (window.FX && FX.flash) FX.flash(rarityOf(r).color); } catch (e) {}
      }
    };
    const finish = () => {
      cards.forEach((_, i) => flip(i));
      if (btn) btn.textContent = 'CONTINUE';
      if (hint) hint.remove();
      if (o._t) { clearTimeout(o._t); o._t = null; }
    };
    const step = () => {
      flip(n++);
      if (n < cards.length) o._t = setTimeout(step, GAP);
      else { o._t = null; if (btn) btn.textContent = 'CONTINUE'; if (hint) hint.remove(); }
    };
    o._t = setTimeout(step, 260);

    const close = () => { if (o._t) { clearTimeout(o._t); o._t = null; } o.remove(); try { render(); } catch (e) {} };
    if (btn) btn.addEventListener('click', () => {
      // SKIP reveals; CONTINUE closes. One button, and it is never a dead end.
      if (n < cards.length) { finish(); n = cards.length; return; }
      close();
    });
    // A tap SKIPS AHEAD rather than closing, so an impatient player is never shown
    // a result they did not get to read.
    o.addEventListener('click', (ev) => {
      if (ev.target === btn) return;
      if (n < cards.length) { finish(); n = cards.length; return; }
      if (ev.target === o) close();
    });
    toast('\u2726 ' + rarityOf(best.r).name.toUpperCase() + ' \u2014 Commander ' + best.who.name
      + (pulls.length > 1 ? ' (best of ' + pulls.length + ')' : ''));
  }

  (function css() {
    if (document.getElementById('cm-css')) return;
    const s = document.createElement('style'); s.id = 'cm-css';
    s.textContent = [
      '.cm-lock{font:700 14px/1.5 Rajdhani,sans-serif;color:#9fb0c4;background:#141a24;border:1px solid #2a3546;border-radius:10px;padding:16px}',
      '.cm-count{color:#ff8a3d;margin-left:6px}',
      '.cm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(156px,1fr));gap:12px}',
      '.cm-pick{border:0;background:none;padding:0;cursor:pointer;display:block;width:100%;text-align:left}',
      // ---- published odds -----------------------------------------------------
      '.cm-od{display:flex;flex-direction:column;gap:7px}',
      '.cm-od-bar{display:flex;height:8px;border-radius:4px;overflow:hidden;background:#0b0f16;border:1px solid #2a3546}',
      '.cm-od-bar i{display:block;min-width:2px}',
      '.cm-od-rows{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:2px 10px}',
      '.cm-od-r{display:flex;justify-content:space-between;gap:6px;font:700 12px/1.5 Rajdhani,sans-serif}',
      '.cm-od-r em{color:#e6edf7;font-style:normal}',
      '.cm-od-no{font:700 11.5px/1.45 Rajdhani,sans-serif;color:#ff8a9a;background:#ff4d5e12;border:1px solid #ff4d5e33;border-radius:6px;padding:7px 9px}',
      '.cm-od-no b{letter-spacing:.1em;margin-right:4px}',
      '.cm-od-no.ok{color:#c9a2ff;background:#c07bff14;border-color:#c07bff40}',
      '.cm-od-fl{font:700 11.5px/1.45 Rajdhani,sans-serif;color:#7d8ba0}',
      '.cm-od-fl b{letter-spacing:.1em;margin-right:4px;color:#9fb0c4}',
      '.cm-win{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#0f141c;border:1px solid #2a3546;border-radius:7px;padding:8px 10px}',
      '.cm-w-k{font:800 11px/1 Rajdhani,sans-serif;letter-spacing:.14em;color:#7d8ba0}',
      '.cm-w-r{font:800 13px/1.2 Rajdhani,sans-serif;color:#e6edf7}',
      '.cm-w-no{margin-left:auto;font:800 11px/1 Rajdhani,sans-serif;letter-spacing:.1em;color:#0f141c;background:#c07bff;border-radius:4px;padding:4px 6px}',
      '.cm-w-cap{margin-left:auto;font:800 11px/1 Rajdhani,sans-serif;letter-spacing:.1em;color:#7d8ba0;border:1px solid #2a3546;border-radius:4px;padding:4px 6px}',
      '.cm-tag{font:800 11px/1 Rajdhani,sans-serif;letter-spacing:.1em;color:#0f141c;background:#c07bff;border-radius:4px;padding:4px 6px;flex:0 0 auto}',
      '.cm-crate.paid{background:linear-gradient(180deg,#1d1430,#141a24)}',
      // ---- album: filter bar, detail rail, selection --------------------------
      '.cm-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.cm-chip{border:1px solid #2a3546;background:#141a24;color:#9fb0c4;border-radius:7px;padding:9px 12px;font:800 12px/1 Rajdhani,sans-serif;letter-spacing:.1em;cursor:pointer;min-height:42px}',
      '.cm-chip.on{border-color:#c07bff;color:#fff;background:#1d1430}',
      '.cm-chip i{color:#7d8ba0;font-style:normal;margin-left:4px}',
      '.cm-chip.on i{color:#c9a2ff}',
      '.cm-bar-d{margin-left:auto;font:800 13px/1 Rajdhani,sans-serif;color:#c9a2ff}',
      '.cm-det{display:flex;gap:16px;align-items:center;background:#121821;border:1px solid #2a3546;border-left:4px solid #c07bff;border-radius:12px;padding:14px;flex-wrap:wrap}',
      '.cm-det.empty{color:#9fb0c4;flex-direction:column;align-items:flex-start;gap:4px}',
      '.cm-det.empty p{font:700 13.5px/1.5 Rajdhani,sans-serif;margin:0;color:#9fb0c4}',
      '.cm-det-card{flex:0 0 172px;max-width:172px}',
      '.cm-det-x{flex:1 1 220px;min-width:0;display:flex;flex-direction:column;gap:6px}',
      '.cm-det-h{font:800 19px/1.15 Rajdhani,sans-serif;color:#fff;letter-spacing:.05em}',
      '.cm-det-h em{font:700 13px/1 Rajdhani,sans-serif;color:#9fb0c4;font-style:normal;display:block;margin-top:3px;letter-spacing:0}',
      '.cm-det-r{font:800 14px/1 Rajdhani,sans-serif;letter-spacing:.1em}',
      '.cm-det-s{font:700 13px/1.45 Rajdhani,sans-serif;color:#7d8ba0}',
      '.cm-det-s.ok{color:#8fe0ac}',
      '.cm-det-b{display:flex;gap:8px;margin-top:2px}',
      '.cm-det-b .mf-go{flex:1 1 auto}',
      '.cm-pick .cm-card{transition:transform .12s ease-out}',
      '.cm-pick.sel .cm-card{transform:translateY(-3px);box-shadow:0 0 0 2px #c07bff,0 8px 22px -8px #c07bff}',
      '.cm-pick.eq .cm-card{box-shadow:0 0 0 2px #ffd24d}',
      '.cm-eqf{position:absolute;left:0;right:0;bottom:0;text-align:center;font:800 11px/1 Rajdhani,sans-serif;letter-spacing:.12em;color:#1a1206;background:#ffd24d;padding:4px 0;z-index:3}',

      // NOTCHED SCI-FI FRAME, cut with one clip-path so the bevel is real geometry
      // rather than four stacked corner elements.
      '.cm-card{position:relative;display:flex;flex-direction:column;min-height:0;border-radius:4px;padding:2px;background:linear-gradient(160deg,color-mix(in srgb,var(--cc,#555) 75%,#0b0f16),#0b0f16 62%);clip-path:polygon(11px 0,calc(100% - 11px) 0,100% 11px,100% calc(100% - 11px),calc(100% - 11px) 100%,11px 100%,0 calc(100% - 11px),0 11px);box-shadow:0 0 22px -9px var(--cc,#555)}',
      '.cm-card.big{flex:0 0 214px}',
      '.cm-card.empty{opacity:.28;align-items:center;justify-content:center;min-height:250px;color:#7d8ba0;font:800 30px/1 Rajdhani,sans-serif;background:#11161f}',
      // rarity header bar, INSIDE the frame
      '.cmf-hd{font:800 12px/1 Rajdhani,sans-serif;letter-spacing:.2em;color:var(--cc,#9aa0a6);text-align:center;text-transform:uppercase;padding:7px 4px 6px;background:#080b11;text-shadow:0 0 9px color-mix(in srgb,var(--cc,#555) 70%,transparent)}',
      '.cmf-art{position:relative;aspect-ratio:1/1.18;overflow:hidden;background:#05070c;border-top:1px solid color-mix(in srgb,var(--cc,#555) 45%,transparent);border-bottom:1px solid color-mix(in srgb,var(--cc,#555) 45%,transparent)}',
      '.cmf-neb{position:absolute;inset:0;opacity:.95;background:radial-gradient(56% 40% at 50% 28%,color-mix(in srgb,var(--cc,#555) 92%,transparent),transparent 74%),radial-gradient(44% 34% at 20% 68%,color-mix(in srgb,var(--cc,#555) 62%,transparent),transparent 72%),radial-gradient(40% 30% at 82% 74%,color-mix(in srgb,var(--cc,#555) 52%,transparent),transparent 70%),linear-gradient(180deg,#0a0d14,#05070c 84%)}',
      '.cmf-glow{position:absolute;left:50%;top:42%;width:76%;height:58%;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--cc,#fff) 88%,transparent),transparent 68%);filter:blur(2px);opacity:.82}',
      // crest in its own shield badge, top-left over the art
      '.cmf-crest{position:absolute;top:6px;left:6px;width:24px;height:24px;color:var(--cc,#fff);opacity:.95;filter:drop-shadow(0 1px 3px #000)}',
      '.cmf-crest svg{width:100%;height:100%;display:block}',
      '.cmf-fig{position:absolute;left:50%;bottom:0;transform:translateX(-50%);width:64%;height:76%;display:flex;flex-direction:column;align-items:center}',
      '.cmf-fig i{width:27%;aspect-ratio:1;border-radius:50%;background:#04060a;flex:0 0 auto}',
      // An elite officer with no portrait yet gets a distinct rimlit plate rather
      // than the same grey silhouette as everyone else — it reads as art pending,
      // not as a missing asset.
      '.cmf-fig.elite i{background:#04060a;box-shadow:0 0 0 2px var(--cc,#fff),0 0 16px -2px var(--cc,#fff)}',
      '.cmf-fig.elite b{background:linear-gradient(180deg,#0a0d14,#04060a);box-shadow:inset 0 0 24px -6px var(--cc,#fff)}',
      '.cmf-fig b{width:100%;flex:1 1 auto;margin-top:-4%;background:#04060a;clip-path:polygon(50% 0,72% 7%,84% 26%,90% 62%,94% 100%,6% 100%,10% 62%,16% 26%,28% 7%)}',
      '.cmf-port{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 18%}',
      // pip band along the base of the art
      '.cmf-pips{position:absolute;left:0;right:0;bottom:0;text-align:center;font-size:11px;letter-spacing:3px;color:var(--cc,#fff);padding:4px 0 5px;background:linear-gradient(180deg,transparent,rgba(4,6,10,.92));text-shadow:0 1px 3px #000,0 0 9px var(--cc,#555)}',
      '.cmf-cap{display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 9px 10px;background:#080b11}',
      '.cmf-cap b{font:800 14px/1.15 Rajdhani,sans-serif;letter-spacing:.06em;color:var(--cc,#fff);text-transform:uppercase;text-align:center}',
      '.cmf-stats{display:flex;flex-direction:column;align-items:center;gap:1px}',
      '.cmf-stats.off{opacity:.45}',
      '.cmf-stats.off .cmf-s{text-decoration:line-through}',
      '.cmf-s{font:700 11.5px/1.35 Rajdhani,sans-serif;color:#e6edf7;letter-spacing:.03em}',
      '.cmf-s i{color:#9fb0c4;font-style:normal}',
      // 11px FLOOR. This line is the difference between a Commander paying +46%
      // and paying nothing at all — it cannot be the smallest text on the screen.
      '.cmf-req{font:800 11px/1.25 Rajdhani,sans-serif;letter-spacing:.08em;color:#8a99ad;font-style:normal;margin-top:3px;text-align:center}',
      '.cmf-req.on{color:#59d98c}',
      // Re-fitted for the larger type: a short label, a wider allowance and two
      // lines permitted, so the seat is legible instead of ellipsised.
      '.cmf-spec{position:absolute;top:6px;right:6px;font:800 11px/1.15 Rajdhani,sans-serif;letter-spacing:.05em;color:#0f141c;background:#8a99ad;border-radius:4px;padding:4px 6px;max-width:76%;text-align:right;word-break:break-word;z-index:2}',
      '.cmf-spec.on{background:#ffd24d}',
      '.cm-dup{position:absolute;top:8px;right:9px;font:800 11px/1 Rajdhani,sans-serif;color:#0f141c;background:var(--cc,#9aa0a6);border-radius:4px;padding:3px 5px}',
      '.cm-slot{display:flex;gap:14px;align-items:center;background:#141a24;border:1px solid #2a3546;border-left:4px solid #ffd24d;border-radius:12px;padding:14px;flex-wrap:wrap}',
      '.cm-slot-x{flex:1 1 160px;min-width:0;display:flex;flex-direction:column;gap:8px}',
      '.cm-slot-k{font:800 12px/1 Rajdhani,sans-serif;letter-spacing:.16em;color:#ffd24d}',
      '#cmdr-body{display:flex;flex-direction:column;gap:15px}',
      '.cm-hero{background:radial-gradient(120% 140% at 12% 0%,#2a1c3a 0%,#141020 60%,#0f0d16 100%);border:1px solid #c07bff55;border-left:4px solid #c07bff;border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:6px}',
      '.cm-hero-k{font:800 13px/1 Rajdhani,sans-serif;letter-spacing:.18em;color:#c07bff}',
      '.cm-hero-q{font:700 21px/1.3 Rajdhani,sans-serif;color:#fff;text-wrap:pretty}',
      '.cm-hero-b{font-size:15px;line-height:1.55;color:#c4cfe0;text-wrap:pretty}',
      '.cm-hero-b b{color:#e0b3ff}',
      '.cm-poolnote{font:700 13px/1.5 Rajdhani,sans-serif;color:#9fb0c4;background:#121821;border:1px solid #2a3546;border-left:3px solid #7d8ba0;border-radius:9px;padding:11px 13px}',
      '.cm-poolnote b{color:#e6edf7}',
      '.cm-bk{display:flex;flex-direction:column;gap:10px;max-width:440px;width:100%;background:#121821;border:1px solid #2a3546;border-left:4px solid #ffb0ba;border-radius:14px;padding:20px}',
      '.cm-bk-k{font:800 12px/1 Rajdhani,sans-serif;letter-spacing:.16em;color:#ffb0ba}',
      '.cm-bk-t{font:800 24px/1.15 Rajdhani,sans-serif;color:#fff}',
      '.cm-bk-t em{font:800 13px/1 Rajdhani,sans-serif;letter-spacing:.1em;font-style:normal;margin-left:6px}',
      '.cm-bk-req,.cm-bk-now{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;background:#0f141c;border:1px solid #2a3546;border-radius:8px;padding:10px 12px}',
      '.cm-bk-req span,.cm-bk-now span{font:800 11px/1 Rajdhani,sans-serif;letter-spacing:.12em;color:#7d8ba0;flex:0 0 auto}',
      '.cm-bk-req b{font:800 16px/1.15 Rajdhani,sans-serif;color:#ffd24d}',
      '.cm-bk-now b{font:800 16px/1.15 Rajdhani,sans-serif;color:#e6edf7}',
      '.cm-bk-b{font:700 15px/1.5 Rajdhani,sans-serif;color:#e6edf7}',
      '.cm-bk-b b{color:#8fe0ac}',
      '.cm-bk-n{font:700 13px/1.5 Rajdhani,sans-serif;color:#9fb0c4}',
      '.cm-bk-n b{color:#e6edf7}',
      '.cm-bk-n.dim{color:#7d8ba0;border-top:1px solid #1f2836;padding-top:9px}',
      // ---- the My Fleet row ---------------------------------------------------
      '.cmr{margin-top:12px;background:#121821;border:1px solid #2a3546;border-left:3px solid #c07bff;border-radius:11px;padding:11px 12px}',
      '.cmr-h{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;margin-bottom:9px}',
      '.cmr-t{font:800 14px/1 Rajdhani,sans-serif;letter-spacing:.06em;color:#e0b3ff}',
      '.cmr-s{font:700 12px/1.3 Rajdhani,sans-serif;color:#9fb0c4}',
      // MATCH THE SHIP CELLS ABOVE. The bench sat directly under five tall ship
      // cards and rendered 46px circles with 11px labels — the same decision
      // (which unit goes in this slot) presented two completely different ways on
      // one screen. Same footprint, same proportions, same reading order.
      '.cmr-slots{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px}',
      '@media (max-width:420px){.cmr-slots{gap:6px}}',
      '.cmr-c{position:relative;min-width:0;display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 6px;min-height:104px;border:1px solid var(--cc,#2a3546);border-radius:9px;background:linear-gradient(180deg,color-mix(in srgb,var(--cc,#2a3546) 20%,#0f141c),#0f141c);cursor:pointer}',
      '.cmr-c.empty{border-style:dashed;border-color:#2a3546;background:#0f141c}',
      '.cmr-c.empty.locked{border-style:solid;opacity:.62;cursor:default}',
      '.cmr-c.empty.locked .cmr-p{font-size:19px;opacity:.75}',
      '.cmr-sub{font:800 9.5px/1 Rajdhani,sans-serif;letter-spacing:.14em;color:#5d6b84;margin-top:2px}',
      '.cmr-img{display:block;width:46px;height:46px;border-radius:50%;object-fit:cover;object-position:50% 16%;border:1px solid var(--cc,#2a3546)}',
      '.cmr-p{width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:800 17px/1 Rajdhani,sans-serif;color:var(--cc,#7d8ba0);background:#0b0f16;border:1px solid var(--cc,#2a3546)}',
      '.cmr-c.empty .cmr-p{color:#5d6b84;border-color:#2a3546;font-size:22px}',
      '.cmr-n{font:800 12px/1.1 Rajdhani,sans-serif;color:#fff;text-align:center;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.cmr-c.empty .cmr-n{color:#7d8ba0}',
      '.cmr-b{font:800 11px/1 Rajdhani,sans-serif;color:#8fe0ac}',
      '.cmr-b.off{color:#7d8ba0}',
      // a real portrait, not a thumbnail
      '.cmr-c.tall{min-height:0;padding:0;overflow:visible;gap:0;justify-content:flex-start;border-radius:9px}',
      // the ART clips (a portrait must not spill); the CARD does not.
      '.cmr-art{position:relative;width:100%;aspect-ratio:1/1.12;overflow:hidden;border-radius:8px 8px 0 0;background:radial-gradient(64% 56% at 50% 32%,color-mix(in srgb,var(--cc,#555) 66%,transparent),#0b0f16 80%)}',
      '.cmr-art .cmr-img{display:block;vertical-align:middle;width:100%;height:100%;border:0;border-radius:0;object-fit:cover;object-position:50% 16%}',
      '.cmr-art .cmr-p{width:100%;height:100%;border:0;border-radius:0;background:transparent;font-size:30px}',
      '.cmr-id{display:flex;align-items:baseline;justify-content:center;gap:6px;flex-wrap:wrap;padding:7px 8px 0;width:100%}',
      '.cmr-id b{font:800 13px/1.1 Rajdhani,sans-serif;color:#fff}',
      '.cmr-id em{font:800 11px/1 Rajdhani,sans-serif;letter-spacing:.08em;font-style:normal}',
      '.cmr-stats{display:flex;flex-direction:column;gap:1px;width:100%;padding:5px 8px 9px;border-top:1px solid #1f2836;margin-top:6px;background:#0b0f16;flex:0 0 auto}',
      '.cmr-stats.off{opacity:.72}',
      '.cmr-line{display:flex;align-items:baseline;justify-content:center;gap:5px}',
      '.cmr-line{flex-direction:column;gap:0}',
      '.cmr-line b{font:800 24px/1 Rajdhani,sans-serif;color:#8fe0ac;letter-spacing:-.01em}',
      '.cmr-line i{font:700 11px/1.15 Rajdhani,sans-serif;color:#9fb0c4;font-style:normal;text-transform:uppercase;letter-spacing:.05em;text-align:center}',
      '.cmr-line.sm b{font-size:15px;color:#7fd0b0}',
      '.cmr-line.sm i{font-size:11px}',
      '.cmr-line.dim b{color:#5d6b84}',
      '.cmr-line.dim i{color:#6d7b90}',
      '.cmr-unmet{font:800 11px/1.25 Rajdhani,sans-serif;color:#ffb0ba;text-align:center}',
      '.cmr-need{font:700 10px/1.2 Rajdhani,sans-serif;color:#7d8ba0;text-align:center}',
      // ---- the exchange -------------------------------------------------------
      '.cm-dustbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#121821;border:1px solid #2a3546;border-left:3px solid #c07bff;border-radius:10px;padding:12px 13px}',
      '.cm-db-k{font:800 15px/1 Rajdhani,sans-serif;letter-spacing:.1em;color:#c9a2ff;flex:0 0 auto}',
      '.cm-db-s{flex:1 1 240px;min-width:0;font:700 13px/1.45 Rajdhani,sans-serif;color:#9fb0c4}',
      '.cm-db-s b{color:#e6edf7}',
      '.cmx-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}',
      '.cmx-card{background:#121821;border:1px solid #2a3546;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;min-height:0}',
      '.cmx-h{font:800 13px/1 Rajdhani,sans-serif;letter-spacing:.16em;color:#c07bff}',
      '.cmx-note{font:700 13px/1.5 Rajdhani,sans-serif;color:#9fb0c4}',
      '.cmx-note b{color:#e6edf7}',
      '.cmx-list{display:flex;flex-direction:column;gap:7px;min-height:0;max-height:340px;overflow-y:auto}',
      '.cmx-row{display:flex;align-items:center;gap:10px;background:#0f141c;border:1px solid #2a3546;border-radius:8px;padding:9px 10px;flex-wrap:wrap}',
      '.cmx-x{flex:1 1 130px;min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.cmx-sp{font:700 11.5px/1.2 Rajdhani,sans-serif;color:#9fb0c4}',
      '.cmx-acts{display:flex;gap:6px;flex-wrap:wrap;flex:1 1 190px}',
      '.cmx-max{font:800 11px/1 Rajdhani,sans-serif;letter-spacing:.1em;color:#ffd24d;align-self:center}',
      '.cmx-empty{font:700 12.5px/1.5 Rajdhani,sans-serif;color:#7d8ba0;background:#0f141c;border:1px dashed #2a3546;border-radius:8px;padding:12px}',
      '.cmx-bulk{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:auto;padding-top:4px}',
      '.cmx-bulk span{font:700 12px/1 Rajdhani,sans-serif;color:#7d8ba0;flex:0 0 auto}',
      '.cmx-bulk .cm-ex-btn{flex:1 1 128px}',
      '.cm-ex-btn.wide{flex:1 1 100%}',
      '.cm-ex-btn{min-height:46px;border:1px solid #2a3546;border-radius:7px;background:#141a24;color:#9fb0c4;font:800 12px/1.2 Rajdhani,sans-serif;letter-spacing:.05em;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:6px 9px}',
      '.cm-ex-btn i{font:700 11px/1 Rajdhani,sans-serif;color:#7d8ba0;font-style:normal}',
      '.cm-ex-btn.go{border-color:#c07bff;color:#fff;background:#1d1430}',
      '.cm-ex-btn.go i{color:#c9a2ff}',
      '.cm-ex-btn:disabled{opacity:.45;cursor:not-allowed}',
      '.cmr-c.tall .cmr-dup{top:6px;right:6px}',
      '.cmr-slots.album{grid-template-columns:repeat(auto-fill,minmax(132px,176px))}',
      '.cmr-slots.album{gap:11px}',
      '.cmr-big{font:800 26px/1 Rajdhani,sans-serif;color:#8fe0ac;letter-spacing:-.01em;margin-top:1px}',
      '.cmr-big.off{color:#5d6b84}',
      '.cmr-stat{font:700 11px/1.15 Rajdhani,sans-serif;letter-spacing:.06em;color:#9fb0c4;text-align:center;text-transform:uppercase}',
      '.cmp-big{display:flex;flex-direction:column;gap:1px;font:700 12.5px/1.25 Rajdhani,sans-serif;color:#9fb0c4}',
      '.cmp-big b{font:800 22px/1 Rajdhani,sans-serif;color:#8fe0ac;letter-spacing:-.01em}',
      '.cmp-big.off b{color:#5d6b84}',
      '.cmp-big i{font:700 11.5px/1.3 Rajdhani,sans-serif;color:#7d8ba0;font-style:normal}',
      '.cmr-slots.album{grid-template-columns:repeat(auto-fill,minmax(104px,1fr))}',
      '.cmr-c.locked{opacity:.35;cursor:default}',
      '.cmr-c.seated{border-color:#ffd24d}',
      '.cmr-r{font:800 11px/1 Rajdhani,sans-serif;letter-spacing:.08em}',
      '.cmr-dup{position:absolute;top:5px;right:6px;font:800 11px/1 Rajdhani,sans-serif;color:#0f141c;background:var(--cc,#9aa0a6);border-radius:3px;padding:3px 4px}',
      '.cmr-on{width:100%;text-align:center;font:800 11px/1 Rajdhani,sans-serif;letter-spacing:.1em;color:#1a1206;background:#ffd24d;padding:4px 0;flex:0 0 auto}',
      // ---- the picker ---------------------------------------------------------
      '.cmp-veil{align-items:flex-start;padding:24px 16px}',
      '.cmp{width:100%;max-width:620px;margin:auto;background:#121821;border:1px solid #2a3546;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;max-height:86vh}',
      '.cmp-h{padding:14px 16px;background:#0f141c;border-bottom:1px solid #2a3546;display:flex;flex-direction:column;gap:3px}',
      '.cmp-h b{font:800 17px/1 Rajdhani,sans-serif;letter-spacing:.1em;color:#e0b3ff}',
      '.cmp-h span{font:700 12.5px/1 Rajdhani,sans-serif;color:#9fb0c4}',
      '.cmp-list{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:1px;background:#1a2230}',
      '.cmp-row{display:flex;align-items:center;gap:12px;padding:12px 14px;background:#121821;border:0;border-left:3px solid transparent;cursor:pointer;text-align:left;width:100%;min-height:78px;flex:0 0 auto}',
      '.cmp-row.on{border-left-color:#ffd24d;background:#1a1608}',
      '.cmp-row.dim{opacity:.62}',
      '.cmp-img{display:block;width:50px;height:50px;flex:0 0 50px;border-radius:50%;object-fit:cover;object-position:50% 16%;border:1px solid #2a3546}',
      '.cmp-mono{width:50px;height:50px;flex:0 0 50px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:800 18px/1 Rajdhani,sans-serif;background:#0b0f16;border:1px solid #2a3546}',
      '.cmp-x{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px;overflow:visible}',
      '.cmp-n{font:800 15px/1.15 Rajdhani,sans-serif;color:#fff;display:flex;align-items:baseline;gap:7px;flex-wrap:wrap}',
      '.cmp-n em{font:800 11px/1 Rajdhani,sans-serif;letter-spacing:.1em;font-style:normal}',
      '.cmp-b{font:700 12.5px/1.35 Rajdhani,sans-serif;color:#e6edf7}',
      '.cmp-s{font:700 11.5px/1.3 Rajdhani,sans-serif;color:#7d8ba0}',
      '.cmp-s.ok{color:#8fe0ac}',
      '.cmp-act{flex:0 0 auto;font:800 11.5px/1 Rajdhani,sans-serif;letter-spacing:.1em;color:#c9a2ff;border:1px solid #c07bff55;border-radius:6px;padding:9px 11px}',
      '.cmp-row.on .cmp-act{color:#ffd24d;border-color:#ffd24d55}',
      '.cmp-none{padding:22px 16px;font:700 13.5px/1.55 Rajdhani,sans-serif;color:#9fb0c4}',
      '.cmp-f{display:flex;gap:9px;padding:12px 14px;border-top:1px solid #2a3546;background:#0f141c}',
      '.cmp-f button{flex:1 1 auto}',
      // ---- THE REVEAL ---------------------------------------------------------
      '.cm-veil{position:fixed;inset:0;z-index:9000;background:radial-gradient(70% 70% at 50% 45%,rgba(24,14,34,.94),rgba(4,6,11,.97));display:flex;align-items:center;justify-content:center;padding:20px;animation:cmv .18s ease-out}',
      '.cm-veil.loud{background:radial-gradient(70% 70% at 50% 45%,rgba(52,20,60,.95),rgba(6,4,12,.98))}',
      '@keyframes cmv{from{opacity:0}to{opacity:1}}',
      '.cm-rv{display:flex;flex-direction:column;align-items:center;gap:16px;max-width:900px;width:100%}',
      '.cm-rv-k{font:800 13px/1 Rajdhani,sans-serif;letter-spacing:.2em;color:#c07bff}',
      '.cm-rv-banner{display:flex;flex-direction:column;align-items:center;gap:3px;animation:cmpop .4s cubic-bezier(.2,1.5,.4,1)}',
      '.cm-rv-banner b{font:800 26px/1.1 Rajdhani,sans-serif;letter-spacing:.1em;color:#fff;text-align:center}',
      '.cm-rv-banner i{font:800 14px/1 Rajdhani,sans-serif;letter-spacing:.16em;color:#ffd24d;font-style:normal}',
      '.cm-rv-row{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;max-height:62vh;overflow-y:auto;padding:2px}',
      '.cm-rv-row.many .cm-rv-c{width:132px;height:224px}',
      '@media (max-width:560px){.cm-rv-row.many .cm-rv-c{width:104px;height:172px}}',
      '.cm-rv-c{width:184px;height:306px;perspective:900px}',
      '.cm-rv-in{position:relative;width:100%;height:100%;transform-style:preserve-3d;transition:transform .5s cubic-bezier(.3,1.2,.4,1)}',
      '.cm-rv-c.flip .cm-rv-in{transform:rotateY(180deg)}',
      '.cm-rv-back,.cm-rv-face{position:absolute;inset:0;backface-visibility:hidden;border-radius:12px;overflow:hidden;display:flex;flex-direction:column}',
      '.cm-rv-back{background:linear-gradient(150deg,#2a2140,#141020);border:1px solid #4a3a6a;align-items:center;justify-content:center}',
      '.cm-rv-back span{font-size:34px;color:#c07bff;opacity:.8}',
      '.cm-rv-face{transform:rotateY(180deg);border:0;background:none;box-shadow:none;padding:0}',
      '.cm-rv-face .cmf-art{aspect-ratio:auto;flex:1 1 auto}',
      '@media (max-width:560px){.cm-rv-c{width:132px;height:216px}.cm-rv-banner b{font-size:20px}}',
      '.cm-rv-c.flip .cm-rv-face{animation:cmpop .45s cubic-bezier(.2,1.5,.4,1)}',
      '@keyframes cmpop{from{transform:rotateY(180deg) scale(.82)}to{transform:rotateY(180deg) scale(1)}}',
      '.cm-rv-new{position:absolute;top:9px;right:9px;font:800 11px/1 Rajdhani,sans-serif;letter-spacing:.09em;color:#0f141c;background:#59d98c;border-radius:4px;padding:4px 6px}',
      '.cm-rv-new.up{background:#ffd24d}',
      '.cm-rv-dup{position:absolute;top:9px;right:9px;font:800 11px/1 Rajdhani,sans-serif;color:#c07bff}',
      '.cm-rv-foot{display:flex;flex-direction:column;align-items:center;gap:8px;min-height:52px}',
      '.cm-rv-x{min-height:50px;padding:0 34px;border:0;border-radius:9px;background:linear-gradient(180deg,#c07bff,#7a3fb0);color:#fff;font:800 16px/1 Rajdhani,sans-serif;letter-spacing:.1em;cursor:pointer}',
      '.cm-rv-hint{font:700 12px/1 Rajdhani,sans-serif;letter-spacing:.14em;color:#7d8ba0}',
      '@media (max-width:560px){.cm-rv-banner b{font-size:20px}}',
    ].join('');
    document.head.appendChild(s);
  })();

  // THE SELL COPY, DERIVED. Never a sentence a retune can falsify: the top tier's
  // real chance and the uncapped crates' names both come from the live tables.
  function chaseCopy() {
    const top = CMDR_W.length - 1;
    const o = oddsOf(0, null).rows;
    const topRow = o[o.length - 1] || { p: 0 };
    const uncapped = CRATES.filter((c) => c.cap == null);
    const capped = CRATES.filter((c) => c.cap != null);
    const hiCap = capped.reduce((m, c) => Math.max(m, c.cap), 0);
    return 'Commanders roll on <b>their own fixed table</b> \u2014 no loot luck, no rarity buffs, '
      + 'the same odds for every pilot. <b>' + esc(rarityOf(top).name) + '</b> sits at <b>'
      + pctTxt(topRow.p) + '</b> on an open roll. A crate does not change those odds; it changes '
      + '<b>which part of the table</b> you roll on \u2014 and resource crates stop at <b>'
      + esc(rarityOf(hiCap).name) + '</b>, so the '
      + uncapped.map((c) => '<b>' + esc(c.name) + '</b>').join(' and the ')
      + ' are the only route past it. They drop in the <b>Mech Foundry</b> and nowhere else.';
  }

  // ---- THE SCREEN -----------------------------------------------------------
  // Its own Command pill, not a section of the Foundry. The Foundry is where
  // Commanders are HUNTED; the album is where a collection is kept, and burying
  // 24 cards under a shop meant the thing the system is actually about was three
  // scrolls below a hull price list.
  function render() {
    const body = document.getElementById('cmdr-body'); if (!body) return;
    const sub = document.getElementById('cmdr-sub');
    const g = gate();
    if (sub) sub.textContent = g.ok ? (owned() + ' / ' + ROSTER.length + ' discovered') : 'Locked';
    if (!g.ok) {
      const pct = Math.min(100, g.have / g.stars * 100);
      body.innerHTML = '<div class="mf-lock"><div class="mf-lock-ic">★</div>'
        + '<div class="mf-lock-t">COMMANDERS</div>'
        + '<div class="mf-lock-s">Opens at <b>Ascension ★' + g.stars + '</b> — you are at <b>★' + g.have + '</b>.</div>'
        + '<div class="mf-bar"><i style="width:' + pct + '%"></i></div></div>';
      return;
    }
    const c = rec();
    body.innerHTML =
      '<div class="cm-hero"><div class="cm-hero-k">\u2726 THE CHASE</div>'
      + '<div class="cm-hero-q">Commanders are not earned. They are hunted.</div>'
      + '<div class="cm-hero-b">' + chaseCopy() + '</div></div>'
      + '<div class="cm-poolnote">Commander percentages join the <b>same pool</b> as your gear, skills, perks, hull levels and nanocores — they add to that total, then it multiplies your base once. On a deep account <b>+176% hull is +176 points on top of everything else</b>, not a 176% jump in the number on your HUD.</div>'
      + '<div class="mf-wallet"><span class="mf-w-ic">✦</span><span class="mf-w-n">' + fmt(dust()) + '</span>'
      + '<span class="mf-w-l">DUST</span>'
      + '<span class="mf-w-r">from scrapped spares \u00b7 promotes a card or buys a pull<br>' + fmt(num(c.pulls)) + ' lifetime pulls</span></div>'
      + vaultHTML() + exchangeHTML() + albumHTML();
    bind(body);
  }

  // ---- THE FLEET ROW --------------------------------------------------------
  // Rendered under the ship slots on My Fleet, one cell per hull, so the bench sits
  // beside the thing it is sized against. Tapping a cell opens the Commanders
  // screen rather than duplicating the album here — one place owns assignment.
  function fleetRowHTML() {
    // WARM THE CACHE HERE TOO. This read `_port` but never filled it, and only the
    // album ever probed — so on a fresh load My Fleet drew monogram plates and the
    // real art appeared only after visiting the Commanders screen and coming back.
    // Path-dependent rendering of the same card in two places.
    probeAll();
    const g = gate(), open = unlocked();
    const cap = capacity(), seated = open ? slots() : [], own = rec().own;
    // FIVE ALWAYS. `capacity()` is how many you may SEAT; the row is how many you
    // will EVER have, so the shape of the system is legible before you own any of it.
    const MAX = 5;
    let cells = '';
    for (let i = 0; i < MAX; i++) {
      const id = seated[i];
      if (!id) {
        // Three different kinds of empty, each saying what it is waiting on rather
        // than all reading "Empty":
        //   locked   — the whole system is not open yet (★5)
        //   pending  — open, but this seat needs another active hull
        //   free     — open and unlocked, tap to seat someone
        if (!open) {
          cells += '<div class="cmr-c empty locked"><span class="cmr-p">🔒</span>'
            + '<span class="cmr-n">★' + g.stars + '</span>'
            + '<span class="cmr-sub">ASCEND</span></div>';
        } else if (i >= cap) {
          cells += '<div class="cmr-c empty locked"><span class="cmr-p">🔒</span>'
            + '<span class="cmr-n">Ship ' + (i + 1) + '</span>'
            + '<span class="cmr-sub">LOCKED</span></div>';
        } else {
          cells += '<button class="cmr-c empty" data-cmr=""><span class="cmr-p">+</span>'
            + '<span class="cmr-n">Empty</span>'
            + '<span class="cmr-sub">TAP TO SEAT</span></button>';
        }
        continue;
      }
      const o = own[id], who = BY_ID[id], R = rarityOf(o.r), ok = specOk(who);
      const b = bonusFor(o.r, who.t, who);
      cells += '<button class="cmr-c tall" data-cmr="' + esc(id) + '" style="--cc:' + R.color + '">'
        + '<span class="cmr-art">'
        + (_port[id] === true
            ? '<img class="cmr-img" src="commanders/' + esc(id) + '.png" alt="">'
            : '<span class="cmr-p">' + esc(who.name.slice(0, 2).toUpperCase()) + '</span>')
        + '</span>'
        + '<span class="cmr-id"><b>' + esc(who.name) + '</b>'
        + '<em style="color:' + R.color + '">' + esc(R.name) + '</em></span>'
        + '<span class="cmr-stats' + (ok ? '' : ' off') + '">'
        + (ok ? '<span class="cmr-line"><b>+' + b + (who.t === 'multiShot' ? '' : '%') + '</b><i>' + esc(STAT_LABEL[who.t] || who.t) + '</i></span>'
              : '<span class="cmr-unmet">\u25cb ' + esc(specLabel(who)) + '</span>')
        + '</span></button>';
    }
    const sub = !open
      ? 'Officers who buff your whole fleet · unlocks at Ascension ★' + g.stars + ' (you are ★' + g.have + ')'
      : cap < MAX
        ? seated.length + '/' + cap + ' seated · one per active hull — grow your fleet to open the rest'
        : seated.length + '/' + cap + ' seated · one per active hull';
    return '<div class="cmr"><div class="cmr-h"><span class="cmr-t">✦ Commanders</span>'
      + '<span class="cmr-s">' + sub + '</span></div>'
      + '<div class="cmr-slots">' + cells + '</div></div>';
  }
  function bindFleetRow(root) {
    if (!root) return;
    root.querySelectorAll('[data-cmr]').forEach((b) => b.addEventListener('click', () => openPicker(b.dataset.cmr || '')));
  }

  // ---- THE PICKER -----------------------------------------------------------
  // Tapping a bench cell on My Fleet chooses a Commander RIGHT THERE, the same way
  // tapping a ship slot picks a hull — leaving the screen to assign an officer and
  // coming back was the wrong shape for a fleet decision.
  //
  // Every row states the whole benefit: the stat and its exact value, whether the
  // seat requirement is met, and what a mismatched seat actually costs (nothing).
  // A player should never have to open a second screen to learn which card is
  // worth seating.
  function openPicker(seatedId) {
    probeAll();
    document.querySelectorAll('.cm-veil').forEach((n) => { if (n._t) clearTimeout(n._t); n.remove(); });
    const c = rec(), own = c.own;
    const ids = Object.keys(own).filter((id) => BY_ID[id]);
    // best first: seat met, then rarity, then raw value
    ids.sort((a, b) => {
      const wa = BY_ID[a], wb = BY_ID[b], oa = own[a], ob = own[b];
      const ma = specOk(wa) ? 1 : 0, mb = specOk(wb) ? 1 : 0;
      if (ma !== mb) return mb - ma;
      if (oa.r !== ob.r) return ob.r - oa.r;
      return bonusFor(ob.r, wb.t, wb) - bonusFor(oa.r, wa.t, wa);
    });
    const cap = capacity(), seated = slots();
    const row = (id) => {
      const o = own[id], w = BY_ID[id], R = rarityOf(o.r), ok = specOk(w), on = isEquipped(id);
      const b = bonusFor(o.r, w.t, w), u = w.t === 'multiShot' ? '' : '%';
      const s2k = secondOf(w, o.r), s2v = s2k ? Math.max(1, Math.round(b * 0.45)) : 0;
      return '<button class="cmp-row' + (on ? ' on' : '') + (ok ? '' : ' dim') + '" data-cmp="' + esc(id) + '">'
        + (_port[id] === true
            ? '<img class="cmp-img" src="commanders/' + esc(id) + '.png" alt="">'
            : '<span class="cmp-mono" style="color:' + R.color + '">' + esc(w.name.slice(0, 2).toUpperCase()) + '</span>')
        + '<span class="cmp-x">'
        + '<span class="cmp-n">' + esc(w.name) + '<em style="color:' + R.color + '">' + esc(R.name) + '</em></span>'
        + '<span class="cmp-big' + (ok ? '' : ' off') + '"><b>+' + b + u + '</b> ' + esc(STAT_LABEL[w.t] || w.t)
        + (s2k ? '<i>+' + s2v + (s2k === 'multiShot' ? '' : '%') + ' ' + esc(STAT_LABEL[s2k] || s2k) + '</i>' : '') + '</span>'
        + '<span class="cmp-s' + (ok ? ' ok' : '') + '">'
        + (specKind(w) === 'none' ? '\u25c9 Works in any fleet'
           : ok ? '\u25c9 ' + esc(specLabel(w)) + ' \u2014 requirement met'
                : '\u25cb ' + esc(specLabel(w)) + ' \u2014 pays nothing in this seat') + '</span>'
        + '</span>'
        + '<span class="cmp-act">' + (on ? 'SEATED' : 'ASSIGN') + '</span>'
        + '</button>';
    };
    const o2 = document.createElement('div');
    o2.className = 'cm-veil cmp-veil';
    o2.innerHTML = '<div class="cmp">'
      + '<div class="cmp-h"><b>ASSIGN A COMMANDER</b>'
      + '<span>' + seated.length + ' / ' + cap + ' seated \u00b7 one per active hull</span></div>'
      + (ids.length
        ? '<div class="cmp-list">' + ids.map(row).join('') + '</div>'
        : '<div class="cmp-none">No Commanders yet \u2014 they drop in the <b>Mech Foundry</b> and from its Commander Vault.</div>')
      + '<div class="cmp-f">'
      + '<button class="mf-info" data-cmp-more>OPEN COMMANDERS</button>'
      + '<button class="mf-go" data-cmp-x>DONE</button></div></div>';
    document.body.appendChild(o2);
    const close = () => { o2.remove(); };
    const repaintRow = () => {
      document.querySelectorAll('.cmr').forEach((r2) => {
        const tmp = document.createElement('div'); tmp.innerHTML = fleetRowHTML();
        const nx = tmp.firstElementChild;
        if (nx) { const host = r2.parentNode; r2.replaceWith(nx); bindFleetRow(host); }
      });
    };
    o2.querySelectorAll('[data-cmp]').forEach((b) => b.addEventListener('click', () => {
      equip(b.dataset.cmp);
      repaintRow();
      close(); openPicker();
    }));
    o2.querySelector('[data-cmp-x]').addEventListener('click', () => { repaintRow(); close(); });
    o2.querySelector('[data-cmp-more]').addEventListener('click', () => {
      close(); try { if (window.UI && window.UI.showScreen) window.UI.showScreen('cmdr'); } catch (e) {}
    });
    o2.addEventListener('click', (ev) => { if (ev.target === o2) { repaintRow(); close(); } });
  }

  window.COMMANDERS = {
    ROSTER, CRATES, GATE_STARS, DROP, STAT_LABEL, render,
    unlocked, gate, rec, owned, dust, equipped, equip, mods,
    onFoundryKill, open, canOpen, rollRarity, rarityOf, bonusFor, BY_ID,
    CMDR_W, oddsOf, promote, scrap, canPromote, spare, dustPull, PROMO_COST, promoCost, DUST_PULL,
    dustPromote, canDustPromote, dustPromo, scrapUpTo, exchangeHTML, promoteAll, promoteAllPlan,
    fighterMult, capacity, slots, isEquipped, specOk, specLabel, specShort,
    vaultHTML, albumHTML, bind, fleetRowHTML, bindFleetRow, openPicker,
  };
})();
