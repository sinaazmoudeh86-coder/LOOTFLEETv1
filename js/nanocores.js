/* =============================================================================
   nanocores.js — NANOCORES: system logic + every balance number
   ---------------------------------------------------------------------------
   Equippable per-hull cores. Rarity gives a GUARANTEED base bonus; Blue/Purple/
   Gold also carry EXTRA BUFF SLOTS that are unlocked with ◭ Prism Ingots and
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
    // NANOCORES HAS NO LEVEL GATE — open from Level 1. Ingots are the only
    // cost, and they were never tied to the mining screen: a pilot who banks
    // them any other way (events, alliance store, moon colony) can spend them
    // here immediately. `gate.level` is kept at 0 so anything that displays the
    // requirement reads a truthful zero rather than a stale 50.
    gate: { level: 0 },
    // ---- RARITIES ---------------------------------------------------------
    // THE GAME'S OWN LOOT SCALE, first SEVEN tiers, with the loot colours — a
    // Rare core reads Rare-blue exactly like a Rare fitting, so nobody has to
    // learn a second rarity language. dmg/hp/spd are the GUARANTEED base
    // bonuses (%), stepping up the ladder. slots = Extra Buff Slots.
    //
    // MYTHIC AND ANCIENT (743). Two tiers above Legendary, continuing the game's
    // own rarity chain rather than inventing names — #ff3b4e and #21d4c4 are
    // lifted verbatim from CONFIG.RARITY, which is the whole point of the "one
    // rarity language" rule above.
    //
    // WHERE THE POWER ACTUALLY IS: THE SLOTS, not the guaranteed lines. Every
    // fleet percentage is additive into one pool per stat and those pools run in
    // the thousands of percent late-game, so +35 dmg over a Legendary reads far
    // bigger than it plays. A buff slot is a whole extra rolled line, and that is
    // real. Slots therefore step at the cadence the ladder already uses (+1 a
    // tier: 2/3/4/5 → 6/7) while the guaranteed lines take a deliberate leap, so
    // the tier reads like a jump on the card and is still honest in the maths.
    //
    // WHY SLOTS WERE NOT PUSHED HARDER: a slot can roll ANY line in the pool and
    // rollBuff() does NOT pick distinct keys, so N slots of `cdmg` is a reachable
    // outcome — 7 slots puts the crit-damage ceiling at +700%, and 12 would put it
    // past +1,200%. The CEILING is the constraint, not the average roll. It is
    // also why `dr` was cut 10× in Aug 2026; see the buff pool below.
    //
    // `costMult` MULTIPLIES BOTH UPGRADE AND REROLL COST FOR THAT TIER ONLY. The
    // first five rows deliberately carry none, so `|| 1` leaves every existing
    // price byte-identical — nobody's Legendary got more expensive to finish
    // because two tiers were added above it. Raising `upgrade.costBase` would have
    // been the lazy way to price the new tiers and would have silently re-priced
    // every core in the population.
    rarities: [
      { k: 'common',    name: 'Common',    col: '#9aa0a6', dmg: 5,  hp: 5,  spd: 10,  slots: 0 },
      { k: 'uncommon',  name: 'Uncommon',  col: '#5bc06b', dmg: 10, hp: 10, spd: 20,  slots: 2 },
      { k: 'rare',      name: 'Rare',      col: '#4a90e2', dmg: 15, hp: 15, spd: 30,  slots: 3 },
      { k: 'epic',      name: 'Epic',      col: '#b15cff', dmg: 20, hp: 20, spd: 40,  slots: 4 },
      { k: 'legendary', name: 'Legendary', col: '#f0972a', dmg: 25, hp: 25, spd: 50,  slots: 5 },
      { k: 'mythic',    name: 'Mythic',    col: '#ff3b4e', dmg: 40, hp: 40, spd: 80,  slots: 6, costMult: 3 },
      { k: 'ancient',   name: 'Ancient',   col: '#21d4c4', dmg: 60, hp: 60, spd: 120, slots: 7, costMult: 8 },
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
      // BALANCE (Aug 2026) — 1–5% → 0.1–0.5%. Damage reduction is the strongest
      // line in the pool (it is a divisor on every hit taken, and it stacks with
      // Armor from the Pilot Tree, which itself pays 0.5% a node), so a five-slot
      // Legendary core was handing out up to 25% flat mitigation.
      { k: 'dr',    name: 'Damage Reduction', min: 0.1, max: 0.5, mod: 'dmgReduce' },
      // PROGRESSION NOTE (Aug 2026) — 3–10 → 2–6, part of the game-wide XP
      // reduction (see the FLEET XP RATE block in game-v93.js); floor then
      // lowered 2 → 1 so the range has room for a genuinely bad roll.
      { k: 'xp',    name: 'XP Gain',          min: 1,   max: 6,   mod: 'xp' },
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
    // Drop table keeps the spec's shape across the scale: the floor dominates,
    // the ceiling is genuinely rare. rollRarity() NORMALISES by the column total,
    // so these are WEIGHTS and need not sum to 100 — which is what makes adding a
    // tier a one-line change instead of a rebalance.
    //
    // MYTHIC 0.3 AND ANCIENT 0.06 (743) follow the ratios the game's own rarity
    // chain already uses: CONFIG.RARITY steps legendary 10 → mythic 2.2 → ancient
    // 0.45, i.e. roughly ÷4.5 then ÷4.9. Applied to legendary's 1.5 that gives
    // 0.33 and 0.068, rounded to 0.3 and 0.06. So an Ancient is about ONE CRATE IN
    // 1,700 — at 60,000 ingots a crate that is ~100M ingots of expectation before
    // the first one, before a single upgrade is paid for.
    //
    // The existing five are UNCHANGED in absolute weight. Adding 0.36 to a total
    // of 100 dilutes their real odds by ~0.36%, the unavoidable cost of there
    // being more tiers and far too small to read as a nerf.
    crate: {
      single: 60000, ten: 540000, tenList: 600000,   // tenList = pre-discount
      drops: [['common', 70], ['uncommon', 17], ['rare', 8], ['epic', 3.5], ['legendary', 1.5],
        ['mythic', 0.3], ['ancient', 0.06]],
    },
    exchange: { ratio: 10, same: 5 },
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
    // ---- ONE-TIME: DAMAGE REDUCTION RESCALE --------------------------------
    // dr rolled 1–5% and now rolls 0.1–0.5%. Live rolls are divided by the same
    // 10 so a core keeps its RELATIVE quality (a god 5% roll is still a god 0.5%
    // roll) instead of sitting ten times above anything obtainable — and so the
    // roll-position/grade readouts, which scale to min..max, stay truthful.
    if (!n.drFix) {
      const dmax = (BY_B.dr && BY_B.dr.max) || 0.5;
      Object.keys(n.cores).forEach((id) => {
        const c = n.cores[id]; if (!c || !Array.isArray(c.buffs)) return;
        c.buffs.forEach((b) => { if (b && b.k === 'dr' && b.v > dmax) b.v = Math.max(0.1, Math.round(b.v) / 10); });
      });
      n.drFix = 1;
    }
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
  // Always open. Every consumer (the screen, the Crates sub-tab, missions, the
  // combat/fleet stat feeds) asks through here, so this one line is the gate.
  function unlocked() { return true; }
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
  // LEGENDARY OR ABOVE (743). Every one of these tests used to read `=== 'legendary'`
  // because Legendary WAS the top of the scale. With Mythic and Ancient above it,
  // that literal quietly meant "the two rarest cores in the game are the only ones
  // that do not count" — no badge, no depth record, no god-roll tally and no
  // Discord feed post for the hardest thing to get. Compared by INDEX so the next
  // tier added is correct by construction rather than by remembering this comment.
  const APEX_I = BY_R.legendary.i;
  const isApex = (r) => !!(BY_R[r] && BY_R[r].i >= APEX_I);
  const isGod = (b) => rollPos(b) >= TOP_FRAC;
  const toast = (m, c) => { try { window.SOCIAL.toast(m, c || '#c9a0ff'); } catch (e) {} };

  // ---- naming --------------------------------------------------------------
  const coreName = (ship, r) => shipName(ship) + ' Nanocore';

  // ===========================================================================
  // COSTS + ODDS  (pure functions of CFG — the UI quotes these directly)
  // ===========================================================================
  // Slot S, upgrade stage U (both 1-based).
  // `costMult` is the TIER's own multiplier and defaults to 1, so the five
  // original rarities price exactly as they always did (743). BOTH cost paths read
  // it — upgrades and rerolls — because a tier that is expensive to unlock and
  // cheap to re-roll is not an expensive tier.
  const costMultOf = (r) => ((BY_R[r] && BY_R[r].costMult) || 1);
  const upCost = (slot, stage, r) => Math.round(CFG.upgrade.costBase * stage * Math.pow(CFG.upgrade.slotMult, slot - 1) * costMultOf(r));
  function upChance(c, slot, stage) {
    const base = CFG.upgrade.base[stage - 1] || 0;
    const f = (c.fail && c.fail[slot + ':' + stage]) || 0;
    return Math.min(100, base + f * CFG.upgrade.failBonus);
  }
  const lockedCount = (c) => (c.buffs || []).reduce((a, b) => a + (b && b.lock ? 1 : 0), 0);
  const rollCost = (c) => Math.round(CFG.roll.base * Math.pow(CFG.roll.lockMult, lockedCount(c)) * costMultOf(c.r));
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
    const cost = upCost(slot, stage, r);
    if (!spend(cost)) { toast('Need ◭ ' + fmt(cost) + ' Prism Ingots'); return null; }
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
        if (isApex(c.r)) peakLife('nanoLegendSlots', c.slots);
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
    if (!spend(cost)) { toast('Need ◭ ' + fmt(cost) + ' Prism Ingots'); return null; }
    const before = open.map((i) => c.buffs[i]);
    open.forEach((i) => { c.buffs[i] = rollBuff(); });
    bumpLife('nanoRolls', 1);
    let gods = 0;
    if (isApex(c.r)) open.forEach((i) => { if (isGod(c.buffs[i])) gods++; });
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
    // WHICH HULL THE LEGENDARY WAS FOR. A core belongs to a specific hull, so the
    // Discord feed can post that hull's real sprite — but only if the key is
    // published. Stamped here, on the recovery itself.
    if (isApex(r)) { bumpLife('nanoLegend', 1); try { G().state.lastNano = { ship, at: Date.now() }; } catch (e) {} }
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
    if (!spend(cost)) { toast('Need ◭ ' + fmt(cost) + ' Prism Ingots'); return null; }
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

  // ---- duplicate exchange, 10 : 1 (and 5 : 1 at the top of the scale) -------
  // Eligible duplicates are counted automatically — a dupe is any core the
  // crate handed you that you already owned, so there is nothing to select.
  //
  // THE TOP RARITY HAD NO EXCHANGE AT ALL, and that is the reported "still no way
  // to turn legendary dupes into another legendary core". `nextRarity('legendary')`
  // is null, so canExchange() refused it and the UI did not even draw the row:
  // the rarest thing in the crate table was the only one whose duplicates were
  // worth nothing. At the top of the scale the trade is a SIDEGRADE — dupes of
  // hulls you have buy the legendary of a hull you do not — which is not a tier
  // jump, so it is priced at 5 rather than 10. It can only ever hand over a core
  // for a MISSING hull: once the tier is complete there is nothing to buy and the
  // trade is refused out loud instead of eating five dupes for another dupe.
  function nextRarity(r) { const i = BY_R[r].i; return RAR[i + 1] ? RAR[i + 1].k : null; }
  const topTier = (r) => !nextRarity(r);
  const exRatio = (r) => (topTier(r) ? CFG.exchange.same : CFG.exchange.ratio);
  function exTarget(r) {
    // the tier this trade pays out in, and the hulls still missing a core there
    const up = nextRarity(r) || r;
    const missing = ships().map((s) => s.key).filter((k) => !has(k, up));
    return { up, missing };
  }
  function canExchange(r) {
    const n = ensure(); if (!n) return false;
    if ((n.dupes[r] || 0) < exRatio(r)) return false;
    if (!topTier(r)) return true;
    return exTarget(r).missing.length > 0;   // nothing left to buy at the top
  }
  function exchange(r) {
    const n = ensure();
    if (!canExchange(r)) return null;
    const { up, missing } = exTarget(r);
    // Prefer a core you do NOT own yet; below the top tier, a complete rarity
    // banks a duplicate at the higher tier instead of being refused.
    const list = ships().map((s) => s.key);
    const pool = missing.length ? missing : list;
    const pick = pool[(Math.random() * pool.length) | 0];
    if (!pick) return null;
    // PAY, THEN DELIVER, synchronously — the target is chosen before a single
    // dupe is spent, so nothing can throw between the debit and the grant.
    n.dupes[r] = Math.max(0, (n.dupes[r] | 0) - exRatio(r));
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
    let last = '';
    try { last = (G().state.lastNano && G().state.lastNano.ship) || ''; } catch (e) {}
    return {
      nano_legend: lifeOf('nanoLegend'),
      nano_slots: Math.min(RAR[RAR.length - 1].slots, lifeOf('nanoLegendSlots')),
      nano_god: lifeOf('nanoGod'),
      nano_last: String(last || '').slice(0, 32),
    };
  }
  const fmt = (v) => { try { return G().formatNum(v); } catch (e) { return String(Math.round(v || 0)); } };

  window.NANO = {
    CFG, RAR, BY_R, BUF, BY_B, RKEYS,
    ensure, idOf, coreAt, has, coreName, shipName, ships, ownsHull, prism, unlocked, fmt,
    upCost, upChance, rollCost, lockedCount, workSlot,
    upgrade, roll, toggleLock, equip, equipped,
    openCrates, exchange, canExchange, nextRarity, exRatio, exTarget, topTier,
    combatMods, fleetMods, fleetKeys, share, mult, tally, bag,
    bumpLife, peakLife, lifeOf, isGod, grade, rollPos, feedFields,
  };
})();
