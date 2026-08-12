/* =============================================================================
   nanocores.js — NANOCORES: system logic + every balance number
   ---------------------------------------------------------------------------
   Equippable per-hull cores. Rarity gives a GUARANTEED base bonus; Blue/Purple/
   Gold also carry EXTRA BUFF SLOTS that are unlocked with ◈ Prism Ingots and
   then rerolled for random buffs.

   BALANCE LIVES IN CFG AND NOWHERE ELSE. Every percentage, price, probability,
   drop rate and ratio below is a CFG field — tuning the system never means
   touching its logic. The UI reads CFG too, so a changed number is a changed
   screen with no further edits.

   ONE core is equipped per hull (the player picks). Its bonuses apply while
   FLYING that hull — computeStats() folds them in exactly where the per-ship
   Ascension modules already land, and the XP buff rides the additive fleet-XP
   pipeline like every other XP source.

   Cores drop for ANY ship in the game, owned or not: an unflyable hull's core
   is real progress you bank for the hull you're working toward.
   -------------------------------------------------------------------------- */
(function () {
  'use strict';
  const G = () => window.GAME;
  const C = () => window.CONFIG;

  const CFG = {
    // NANOCORES OPENS AT LEVEL 50 — a flat level gate, independent of Prism
    // Mining. Ingots are the currency, but the system does not wait on the
    // mining screen: a pilot who has banked ingots any other way (events,
    // alliance store, moon colony) can use them here the moment they hit 50.
    gate: { level: 50 },
    // ---- RARITIES ---------------------------------------------------------
    // THE GAME'S OWN LOOT SCALE, first five tiers, with the loot colours — a
    // Rare core reads Rare-blue exactly like a Rare fitting, so nobody has to
    // learn a second rarity language. dmg/hp/spd are the GUARANTEED base
    // bonuses (%), stepping evenly up the ladder. slots = Extra Buff Slots.
    rarities: [
      { k: 'common',    name: 'Common',    col: '#9aa0a6', dmg: 5,  hp: 5,  spd: 10, slots: 0 },
      { k: 'uncommon',  name: 'Uncommon',  col: '#5bc06b', dmg: 10, hp: 10, spd: 20, slots: 2 },
      { k: 'rare',      name: 'Rare',      col: '#4a90e2', dmg: 15, hp: 15, spd: 30, slots: 3 },
      { k: 'epic',      name: 'Epic',      col: '#b15cff', dmg: 20, hp: 20, spd: 40, slots: 4 },
      { k: 'legendary', name: 'Legendary', col: '#f0972a', dmg: 25, hp: 25, spd: 50, slots: 5 },
    ],
    // ---- EXTRA BUFF POOL --------------------------------------------------
    // `mod` is the computeStats() modifier the buff feeds. 'xp' is special: it
    // rides the fleet-XP pipeline instead of the combat stat block.
    buffs: [
      { k: 'dmg',   name: 'Damage',           min: 1,   max: 8,   mod: 'dmgPct' },
      { k: 'hp',    name: 'Health',           min: 1,   max: 8,   mod: 'hpPct' },
      { k: 'regen', name: 'Health Regen',     min: 0.1, max: 0.5, mod: 'regen' },
      { k: 'spd',   name: 'Ship Speed',       min: 10,  max: 50,  mod: 'moveSpeed' },
      { k: 'cdmg',  name: 'Crit Damage',      min: 10,  max: 100, mod: 'critDamage' },
      { k: 'cchn',  name: 'Crit Chance',      min: 1,   max: 5,   mod: 'critChance' },
      { k: 'rate',  name: 'Fire Rate',        min: 1,   max: 5,   mod: 'atkSpeedPct' },
      { k: 'multi', name: 'Multi Shot',       min: 1,   max: 5,   mod: 'multiShot' },
      { k: 'dr',    name: 'Damage Reduction', min: 1,   max: 5,   mod: 'dmgReduce' },
      { k: 'xp',    name: 'XP Gain',          min: 3,   max: 10,  mod: 'xp' },
    ],
    // Values step in 0.1 and are WEIGHTED toward the floor: v = min + range·rᵏ.
    // k = 2.6 puts ~70% of rolls in the bottom third of the range and makes the
    // last 5% genuinely rare, which is what makes a good roll worth locking.
    rollBias: 2.6,
    step: 0.1,
    // ---- UNLOCKING SLOTS --------------------------------------------------
    upgrade: {
      perSlot: 5,                          // successful upgrades per slot
      base: [100, 80, 60, 40, 20],         // success % by upgrade stage
      failBonus: 5,                        // +pp to THAT stage on each failure
      costBase: 1000,                      // × stage × slotMult^(slot-1)
      slotMult: 2,
    },
    // ---- REROLLING --------------------------------------------------------
    roll: { base: 1000, lockMult: 2 },     // cost = base × lockMult^locked
    // ---- CRATES -----------------------------------------------------------
    // Drop table keeps the spec's shape across the five-tier scale: the floor
    // dominates, the ceiling is genuinely rare.
    crate: {
      single: 30000, ten: 270000, tenList: 300000,   // tenList = pre-discount
      drops: [['common', 70], ['uncommon', 17], ['rare', 8], ['epic', 3.5], ['legendary', 1.5]],
    },
    exchange: { ratio: 10 },
  };

  const RAR = CFG.rarities, BY_R = {}; RAR.forEach((r, i) => { BY_R[r.k] = r; r.i = i; });
  const BUF = CFG.buffs, BY_B = {}; BUF.forEach((b) => { BY_B[b.k] = b; });
  const RKEYS = RAR.map((r) => r.k);

  // ---- state ---------------------------------------------------------------
  function ensure() {
    const g = G(); if (!g || !g.state) return null;
    const s = g.state;
    if (!s.nano) s.nano = {};
    const n = s.nano;
    if (!n.cores || typeof n.cores !== 'object') n.cores = {};
    if (!n.dupes || typeof n.dupes !== 'object') n.dupes = {};
    if (!n.equip || typeof n.equip !== 'object') n.equip = {};
    RKEYS.forEach((k) => { if (!(n.dupes[k] >= 0)) n.dupes[k] = 0; });
    if (!(n.opened >= 0)) n.opened = 0;
    return n;
  }
  const idOf = (ship, r) => ship + '|' + r;
  function coreAt(ship, r) { const n = ensure(); return n ? n.cores[idOf(ship, r)] || null : null; }
  const has = (ship, r) => !!coreAt(ship, r);
  function newCore(ship, r) { return { ship, r, stage: 0, slots: 0, fail: {}, buffs: [] }; }

  const ships = () => { try { return C().SHIPS || []; } catch (e) { return []; } };
  const shipName = (k) => { try { return (C().SHIP_BY_KEY[k] || {}).name || k; } catch (e) { return k; } };
  const ownsHull = (k) => { try { return !!G().shipUnlocked(k); } catch (e) { return false; } };
  const prism = () => { const p = bag(); return p ? (p.ingots || 0) : 0; };
  // ---- THE INGOT BAG -------------------------------------------------------
  // state.prism is created by the Prism Mining screen, so an account that never
  // opened that screen has NO BAG AT ALL — and every ingot grant in the game is
  // written `if (state.prism) state.prism.ingots += n`, which silently skips those
  // players (a Level 104 pilot holding 1Qa of every other currency and exactly 0
  // ingots is how this surfaced). Nanocores is level-gated independently of Prism
  // Mining, so it cannot assume the bag exists: it makes one on demand, in the
  // shape prism-v5.js expects, so opening Prism Mining later just adopts it.
  function bag() {
    const g = G(); if (!g || !g.state) return null;
    if (!g.state.prism) g.state.prism = { ingots: 0, best: 0, core: 0, refinery: 0, _frac: 0, miners: [], entered: false };
    const p = g.state.prism;
    if (!(p.ingots >= 0)) p.ingots = 0;
    return p;
  }
  function spend(nIngots) {
    const p = bag(); if (!p) return false;
    if ((p.ingots || 0) < nIngots) return false;
    p.ingots -= nIngots;
    return true;
  }
  function unlocked() {
    try { return (G().state.level | 0) >= CFG.gate.level; } catch (e) { return false; }
  }
  function dirty() { try { G().save(); } catch (e) {} }
  // ---- CAREER COUNTERS -----------------------------------------------------
  // Badges, missions and the Discord feed all read lifetime figures, and they
  // must come from ONE place or they disagree. These ride state.lifeStats, the
  // same bag the Starforge and loot chains use, so they survive ascension with
  // everything else and need no migration.
  function bumpLife(k, by) {
    try { const s = G().state; if (!s.lifeStats) s.lifeStats = {}; s.lifeStats[k] = (s.lifeStats[k] || 0) + (by == null ? 1 : by); } catch (e) {}
  }
  function peakLife(k, v) {
    try { const s = G().state; if (!s.lifeStats) s.lifeStats = {}; if ((s.lifeStats[k] || 0) < v) s.lifeStats[k] = v; } catch (e) {}
  }
  const lifeOf = (k) => { try { return (G().state.lifeStats && G().state.lifeStats[k]) | 0; } catch (e) { return 0; } };
  // A roll in the TOP 5% of its own range. This is the "god roll" every feed
  // post and badge is about, and it is only counted on LEGENDARY cores — the
  // top of the scale is the only place the flex means anything.
  const TOP_FRAC = 0.95;
  // ---- ROLL QUALITY, ON THE LOOT SCALE -------------------------------------
  // Every rolled value is graded by WHERE IT LANDS INSIDE ITS OWN RANGE and
  // painted in the matching loot colour — a near-max roll reads Legendary-orange,
  // a floor roll reads Common-grey. Same five colours as gear, so nobody has to
  // learn a second scale to know whether a roll was worth the ingots.
  //
  // The Legendary band IS the god-roll bar (TOP_FRAC), so one number drives the
  // colour, the Perfect Resonance badge and the Discord feed — an orange value on
  // a Legendary core is exactly the thing that posts.
  //
  // Bands sit on range position, not percentile, and the roll curve is weighted
  // toward the floor, so the colours stay honest about how good a roll is:
  //   Common ~59% of rolls · Uncommon ~18% · Rare ~13% · Epic ~9% · Legendary ~2%.
  const GRADE_AT = [TOP_FRAC, 0.75, 0.5, 0.25];   // legendary · epic · rare · uncommon
  function rollPos(b) {
    const d = b && BY_B[b.k]; if (!d || d.max <= d.min) return 0;
    const p = (b.v - d.min) / (d.max - d.min);
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }
  function grade(b) {
    const p = rollPos(b);
    return RAR[p >= GRADE_AT[0] ? 4 : p >= GRADE_AT[1] ? 3 : p >= GRADE_AT[2] ? 2 : p >= GRADE_AT[3] ? 1 : 0];
  }
  const isGod = (b) => rollPos(b) >= TOP_FRAC;
  const toast = (m, c) => { try { window.SOCIAL.toast(m, c || '#c9a0ff'); } catch (e) {} };

  // ---- naming --------------------------------------------------------------
  const coreName = (ship, r) => shipName(ship) + ' Nanocore';

  // ===========================================================================
  // COSTS + ODDS  (pure functions of CFG — the UI quotes these directly)
  // ===========================================================================
  // Slot S, upgrade stage U (both 1-based).
  const upCost = (slot, stage) => Math.round(CFG.upgrade.costBase * stage * Math.pow(CFG.upgrade.slotMult, slot - 1));
  function upChance(c, slot, stage) {
    const base = CFG.upgrade.base[stage - 1] || 0;
    const f = (c.fail && c.fail[slot + ':' + stage]) || 0;
    return Math.min(100, base + f * CFG.upgrade.failBonus);
  }
  const lockedCount = (c) => (c.buffs || []).reduce((a, b) => a + (b && b.lock ? 1 : 0), 0);
  const rollCost = (c) => Math.round(CFG.roll.base * Math.pow(CFG.roll.lockMult, lockedCount(c)));
  // The slot currently being worked on (1-based), or 0 when the rarity is full.
  function workSlot(c) { const max = BY_R[c.r].slots; return c.slots >= max ? 0 : c.slots + 1; }

  // ---- a single weighted value ---------------------------------------------
  function rollValue(b) {
    const v = b.min + (b.max - b.min) * Math.pow(Math.random(), CFG.rollBias);
    const q = Math.round(v / CFG.step) * CFG.step;
    return Math.round(q * 10) / 10;
  }
  function rollBuff() {
    const b = BUF[(Math.random() * BUF.length) | 0];
    return { k: b.k, v: rollValue(b), lock: false };
  }

  // ===========================================================================
  // ACTIONS
  // ===========================================================================
  // ---- upgrade one stage toward the next slot ------------------------------
  function upgrade(ship, r) {
    const c = coreAt(ship, r); if (!c) return null;
    const slot = workSlot(c); if (!slot) return null;
    const stage = c.stage + 1;
    const cost = upCost(slot, stage);
    if (!spend(cost)) { toast('Need ◈ ' + fmt(cost) + ' Prism Ingots'); return null; }
    const chance = upChance(c, slot, stage);
    const win = Math.random() * 100 < chance;
    const out = { win, slot, stage, cost, chance, slotUnlocked: false };
    if (win) {
      if (c.fail) delete c.fail[slot + ':' + stage];
      c.stage = stage;
      bumpLife('nanoUps', 1);
      if (c.stage >= CFG.upgrade.perSlot) {
        c.stage = 0; c.slots++;
        bumpLife('nanoSlots', 1);
        // Depth on a LEGENDARY core is the endgame signal: five slots means 25
        // successful upgrades on one core.
        if (c.r === 'legendary') peakLife('nanoLegendSlots', c.slots);
        // A freshly unlocked slot starts EMPTY — the first reroll fills it.
        c.buffs[c.slots - 1] = null;
        out.slotUnlocked = true;
      }
    } else {
      if (!c.fail) c.fail = {};
      c.fail[slot + ':' + stage] = ((c.fail[slot + ':' + stage]) || 0) + 1;
    }
    dirty(); restat();
    return out;
  }

  // ---- roll every unlocked, unlocked-for-reroll slot at once ---------------
  function roll(ship, r) {
    const c = coreAt(ship, r); if (!c || !c.slots) return null;
    const open = [];
    for (let i = 0; i < c.slots; i++) if (!(c.buffs[i] && c.buffs[i].lock)) open.push(i);
    if (!open.length) { toast('Every slot is locked — unlock one to reroll'); return null; }
    const cost = rollCost(c);
    if (!spend(cost)) { toast('Need ◈ ' + fmt(cost) + ' Prism Ingots'); return null; }
    const before = open.map((i) => c.buffs[i]);
    open.forEach((i) => { c.buffs[i] = rollBuff(); });
    bumpLife('nanoRolls', 1);
    let gods = 0;
    if (c.r === 'legendary') open.forEach((i) => { if (isGod(c.buffs[i])) gods++; });
    if (gods) bumpLife('nanoGod', gods);
    dirty(); restat();
    return { cost, slots: open, before, after: open.map((i) => c.buffs[i]), gods };
  }

  function toggleLock(ship, r, i) {
    const c = coreAt(ship, r); if (!c || !c.buffs[i]) return false;
    c.buffs[i].lock = !c.buffs[i].lock;
    dirty();
    return c.buffs[i].lock;
  }

  // ---- equip: exactly one core per hull ------------------------------------
  function equipped(ship) {
    const n = ensure(); if (!n) return null;
    const r = n.equip[ship];
    return (r && has(ship, r)) ? r : null;
  }
  function equip(ship, r) {
    const n = ensure(); if (!n) return false;
    if (r && !has(ship, r)) return false;
    if (r) n.equip[ship] = r; else delete n.equip[ship];
    dirty(); restat();
    return true;
  }
  function restat() {
    try { G().refreshStats(); } catch (e) {}
    try { if (window.UI && window.UI.refreshAll) window.UI.refreshAll(); } catch (e) {}
  }

  // ===========================================================================
  // CRATES — one core per open, ANY ship in the game, owned or not
  // ===========================================================================
  function rollRarity() {
    const total = CFG.crate.drops.reduce((a, d) => a + d[1], 0);
    let x = Math.random() * total;
    for (const d of CFG.crate.drops) { x -= d[1]; if (x <= 0) return d[0]; }
    return CFG.crate.drops[0][0];
  }
  function grant(ship, r) {
    const n = ensure(); const key = idOf(ship, r);
    if (n.cores[key]) { n.dupes[r]++; return { ship, r, dupe: true }; }
    n.cores[key] = newCore(ship, r);
    if (r === 'legendary') bumpLife('nanoLegend', 1);
    // First core for a hull equips itself — nobody wants a stat bonus that
    // needs a second tap to switch on.
    if (!equipped(ship)) n.equip[ship] = r;
    return { ship, r, dupe: false };
  }
  function openCrates(qty) {
    const n = ensure(); if (!n) return null;
    const list = ships(); if (!list.length) return null;
    qty = Math.max(1, qty | 0);
    // Price by BUNDLES, not by "is it ten or more": the old form charged the
    // 10-crate bundle price for any qty >= 10, so a hypothetical 20-open would
    // have cost 270k for twenty crates. Only 1 and 10 ship today, but the price
    // should not depend on that staying true.
    const cost = Math.floor(qty / 10) * CFG.crate.ten + (qty % 10) * CFG.crate.single;
    if (!spend(cost)) { toast('Need ◈ ' + fmt(cost) + ' Prism Ingots'); return null; }
    const out = [];
    for (let i = 0; i < qty; i++) {
      const r = rollRarity();
      const ship = list[(Math.random() * list.length) | 0].key;
      out.push(grant(ship, r));
    }
    n.opened += qty;
    bumpLife('nanoOpened', qty);
    dirty(); restat();
    return { cost, results: out };
  }

  // ---- duplicate exchange, 10 : 1 -----------------------------------------
  // Eligible duplicates are counted automatically — a dupe is any core the
  // crate handed you that you already owned, so there is nothing to select.
  function nextRarity(r) { const i = BY_R[r].i; return RAR[i + 1] ? RAR[i + 1].k : null; }
  function canExchange(r) {
    const n = ensure(); if (!n) return false;
    return !!nextRarity(r) && n.dupes[r] >= CFG.exchange.ratio;
  }
  function exchange(r) {
    const n = ensure(); const up = nextRarity(r);
    if (!up || !canExchange(r)) return null;
    n.dupes[r] -= CFG.exchange.ratio;
    // Prefer a core you do NOT own yet; if the whole rarity is complete the
    // exchange banks a duplicate at the higher tier instead of being refused.
    const list = ships().map((s) => s.key);
    const missing = list.filter((k) => !has(k, up));
    const pick = (missing.length ? missing : list)[(Math.random() * (missing.length ? missing.length : list.length)) | 0];
    const res = grant(pick, up);
    dirty(); restat();
    return res;
  }

  // ===========================================================================
  // STAT APPLICATION — the equipped core of the hull being flown
  // ===========================================================================
  function modsFor(ship) {
    const out = { dmgPct: 0, hpPct: 0, moveSpeed: 0, critChance: 0, critDamage: 0, atkSpeedPct: 0, multiShot: 0, dmgReduce: 0, regen: 0, xp: 0 };
    const r = equipped(ship); if (!r) return out;
    const rc = BY_R[r], c = coreAt(ship, r);
    out.dmgPct += rc.dmg; out.hpPct += rc.hp; out.moveSpeed += rc.spd;
    for (let i = 0; i < (c.slots || 0); i++) {
      const b = c.buffs[i]; if (!b) continue;
      const def = BY_B[b.k]; if (!def) continue;
      out[def.mod] += b.v;
    }
    return out;
  }
  function combatMods(ship) { return unlocked() ? modsFor(ship || (G().state.ship)) : {}; }
  // ---- CORES FLYING AS ESCORTS ---------------------------------------------
  // A core equipped on a hull in the FLEET pays too. This returns the raw SUM
  // across those hulls; the caller applies CONFIG.FLEET.statShare, exactly as it
  // already does for an escort's own hull mods and its stowed fittings — so a
  // core built for a wingman is never dead weight, and the flagship's own core
  // stays the one that pays in full.
  function fleetMods(list) {
    const out = {};
    if (!unlocked() || !list || !list.length) return out;
    list.forEach((f) => {
      const key = (f && f.key) ? f.key : f; if (!key) return;
      const m = modsFor(key);
      for (const k in m) if (m[k]) out[k] = (out[k] || 0) + m[k];
    });
    return out;
  }
  const share = () => { try { return C().FLEET.statShare; } catch (e) { return 0.3; } };
  function fleetKeys() {
    try { return (G().fleetShips() || []).map((f) => f.key).filter(Boolean); } catch (e) { return []; }
  }
  // Fleet-XP hook: reports a multiplier like every other XP source. The flagship's
  // core pays in full, escort cores at the fleet share.
  function mult(what) {
    if (what !== 'xp' || !unlocked()) return 1;
    try {
      const own = modsFor(G().state.ship).xp || 0;
      const wing = (fleetMods(fleetKeys()).xp || 0) * share();
      return 1 + (own + wing) / 100;
    } catch (e) { return 1; }
  }

  // ---- counts for badges / headers ----------------------------------------
  function tally() {
    const n = ensure(); if (!n) return { owned: 0, total: 0, dupes: 0, ready: 0 };
    const keys = Object.keys(n.cores);
    let dupes = 0, ready = 0;
    RKEYS.forEach((k) => { dupes += n.dupes[k] || 0; if (canExchange(k)) ready++; });
    return { owned: keys.length, total: ships().length * RAR.length, dupes, ready };
  }
  // ---- WHAT THIS ACCOUNT PUBLISHES ----------------------------------------
  // Legendary-only, by design: the feed announces the top of the scale, so
  // nothing here reports a Common core anyone can buy on their first crate.
  function feedFields() {
    return {
      nano_legend: lifeOf('nanoLegend'),
      nano_slots: Math.min(BY_R.legendary.slots, lifeOf('nanoLegendSlots')),
      nano_god: lifeOf('nanoGod'),
    };
  }
  const fmt = (v) => { try { return G().formatNum(v); } catch (e) { return String(Math.round(v || 0)); } };

  window.NANO = {
    CFG, RAR, BY_R, BUF, BY_B, RKEYS,
    ensure, idOf, coreAt, has, coreName, shipName, ships, ownsHull, prism, unlocked, fmt,
    upCost, upChance, rollCost, lockedCount, workSlot,
    upgrade, roll, toggleLock, equip, equipped,
    openCrates, exchange, canExchange, nextRarity,
    combatMods, fleetMods, fleetKeys, share, mult, tally, bag,
    bumpLife, peakLife, lifeOf, isGod, grade, rollPos, feedFields,
  };
})();
