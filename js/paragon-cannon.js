/* =============================================================================
   paragon-cannon.js — THE EVOLVING PARAGON CANNON · never falls behind
   ---------------------------------------------------------------------------
   A single Paragon-tier cannon, 500,000 LootCoins, bought once and owned
   forever. Its whole identity is that it does not roll: its stats are RECOMPUTED
   from your level every time the game refreshes stats. It is not the strongest
   possible weapon in the game — a lucky max-roll Paragon drop beats it — but it
   is a very strong FLOOR that never goes stale, from the moment you buy it to
   level 500.

   HOW THE SCALING ACTUALLY WORKS
   NOTE ON NAMING: the display name is the Evolving Paragon Cannon; the internal
   key, the AXIOM namespace and the `axiom` item flag are deliberately unchanged.
   They are load-bearing — ownership is `state.purchases.axiom`, the sell guards
   test `it.axiom`, and sync() finds instances by that flag. Renaming them would
   orphan every account that already owns one.

   The item is not "given big numbers at purchase". It carries `axiom: true` and
   sync() rewrites `item.stats` IN PLACE; game-v93's refreshStats() calls sync()
   before every recompute. That choice matters: every existing read site — combat,
   auto-equip, itemPower, the compare tooltip, the bag — sees a perfectly ordinary
   item with ordinary stats. Nothing else in the codebase needs to know this
   weapon is special, so nothing else can get it wrong.

   WHY IT CAN'T BE FARMED OR DUPLICATED
   Ownership is a flag on state.purchases, not the item. Selling or losing the
   instance doesn't revoke it — sync() re-mints one into the bag if the flag is
   set and no copy exists. Buying twice is refused.

   WHY IT SURVIVES ASCENSION — AND WHAT HAPPENS TO IT
   Every other item is surrendered on ascension. This one is not: it is bought
   with LootCoins, and the rule throughout ASC_KEEP is that anything bought with
   LootCoins or real money is permanent. `purchases` already rides across, so the
   flag survives; the instance in your bag does not, and sync() re-mints it on the
   far side.

   It comes back RESCALED TO LEVEL 1. That is the point of the design, not a side
   effect: the cannon is always exactly as strong as the pilot holding it, so a
   fresh Level 1 pilot gets a Level 1 Axiom. You keep the purchase forever and
   re-earn its power every run, the same way you re-earn everything else.

   That fall-off is automatic and needs no ascension-specific code — statsFor()
   scales every stat by edgeFor(state.level), and after an ascension
   state.level is 1, so the whole block drops to its floor. pilotAscend()
   empties the inventory and then calls refreshStats(), which calls sync(), which
   finds the flag set and no instance and mints a Level 1 one.
   ============================================================================= */
(function () {
  'use strict';

  const PRICE = 500000;
  const KEY = 'axiom';
  const G = () => window.GAME;
  const C = () => window.CONFIG;

  function paragonIdx() {
    try {
      const R = C().RARITY;
      for (let i = R.length - 1; i >= 0; i--) if (R[i].key === 'paragon') return i;
      return R.length - 1;
    } catch (e) { return 16; }
  }

  const owned = () => { try { return !!(G().state.purchases || {})[KEY]; } catch (e) { return false; } };

  // ---- THE SCALING CURVE -------------------------------------------------------
  // MIRRORS items.js generate() EXACTLY, at maximum variance, times EDGE.
  //
  // The first version invented its own curve — geometric in LEVEL — while real
  // drops are geometric in ZONE via C.dungeonScale (1.18^(zone-1)). Level is
  // capped at 150 + 50×stars while zone runs past 500, so a deep-zone pilot could
  // roll a Paragon that beat it outright and the "best-in-slot" promise on a
  // 500,000-coin purchase would simply be false.
  //
  // Now every stat is computed with the same branch generate() uses, reading the
  // same C.STATS definitions, so its strength is arithmetic rather than asserted:
  // identical formula, variance pinned to its ceiling, then EDGE applied.
  const MAXVAR = 1.18;          // 0.82 + 0.36 — the top of generate()'s roll
  // EDGE was 1.15 (a provable margin OVER the best possible Paragon roll), which
  // made the cannon strictly dominant and every weapon drop pointless. Halved to
  // 0.575: it now lands at ~58% of a max-roll Paragon, so it is a very strong
  // reliable floor rather than an unbeatable ceiling — a lucky top-tier drop can
  // and should beat it. This is the ONLY thing changed; natural Paragon drops
  // are untouched, since they roll through items.js generate() and never read
  // this constant.
  //
  // LEVEL IS A REAL TERM. An earlier pass moved every stat onto zone and left
  // statsFor()'s `level` argument unread — while the market card printed YOUR
  // LEVEL as a headline number and promised the stats recompute on level-up.
  // The displayed driver drove nothing. Rather than retire the level framing
  // (depth alone would have been defensible), EDGE now RAMPS with level, which
  // is what the item was sold as: it levels with you.
  //
  //   EDGE(level) = EDGE_MIN + (EDGE_MAX - EDGE_MIN) * min(level / EDGE_FULL, 1)
  //
  // Level 1 → 0.40 of a max-roll Paragon. Level 150 and beyond → 0.575, the
  // reduced ceiling. Every one of the eight stats reads it, so the whole block
  // moves together on level-up and none of them can drift out of band the way
  // the specials did when a level term was bolted onto them individually.
  //
  // It also makes the ascension reset mean something. Level → 1 drops the
  // cannon to 0.40 and you climb it back, exactly as the header describes.
  const EDGE_MIN = 0.40, EDGE_MAX = 0.575, EDGE_FULL = 150;
  function edgeFor(lv) {
    return EDGE_MIN + (EDGE_MAX - EDGE_MIN) * Math.min(1, Math.max(1, lv | 0) / EDGE_FULL);
  }
  function statsFor(level, zone) {
    const c = C(), R = c.RARITY, ri = paragonIdx(), P = R[ri] || { mult: 125 };
    const zn = Math.max(1, zone | 0);
    const lv = Math.max(1, level | 0);
    const EDGE = edgeFor(lv);
    const scale = c.dungeonScale ? c.dungeonScale(zn) : Math.pow(1.18, zn - 1);
    const depthBonus = 1 + Math.log10(zn + 0.5) * 0.4;
    const out = {};
    (c.STAT_KEYS || []).forEach((k) => {
      const def = (c.STATS || {})[k]; if (!def) return;
      if (k === 'critChance') {
        // crit is a rarity ladder in this game, not a scaled stat — a Paragon
        // drop tops out near 0.19%, so anything in the tens of percent would be
        // off by three orders of magnitude
        out[k] = Math.min(1, Math.round((0.005 + ri * 0.01) * MAXVAR * EDGE * 1000) / 1000);
      } else if (def.fmt === 'flat') {
        out[k] = Math.max(1, Math.round(def.base * scale * P.mult * MAXVAR * EDGE));
      } else {
        out[k] = Math.max(0.1, Math.round(def.base * P.mult * MAXVAR * depthBonus * EDGE * 10) / 10);
      }
    });
    // SPECIALS sit outside STAT_KEYS, so they never entered the loop above and
    // never took EDGE — the 50% reduction missed them entirely.
    //
    // Both are derived the SAME way as the six scaled stats: the stat's natural
    // ceiling times EDGE. Neither scales with zone in generate() (items.js calls
    // them "flat, non-scaling"), so zone is absent here — but EDGE carries the
    // level term, so they rise with level like everything else, and by the same
    // proportion. That shared factor is the point: an earlier attempt gave each
    // special its own bespoke level curve and pushed one above its natural
    // ceiling and the other below its floor at the same time.
    //
    // lifeSteal ceiling is 1% (rollLifeSteal → 0.2–1%, on 7% of drops). The
    // balance note above that definition records every lifesteal source being cut
    // by 80% because sustain had become dominant and made PvP fleets unkillable,
    // so a guaranteed figure above the natural ceiling is exactly what not to ship.
    out.lifeSteal = Math.round(1.0 * EDGE * 10) / 10;
    // multiShot is a PERCENT CHANCE on items (rollMultiShot → 10–25), not a
    // target count — it had been clamped to MULTISHOT_MAX_TARGETS (extra targets
    // per proc), which capped the Paragon below what a common weapon rolls.
    out.multiShot = Math.round(25 * EDGE);
    return out;
  }

  function mint() {
    const s = G().state;
    return {
      id: 'axiom-' + Date.now(),
      axiom: true,                       // the flag sync() looks for
      name: 'Evolving Paragon Cannon',
      wclass: 'rail',                    // a cannon — rail is the game's cannon class
      slot: 'bow',
      rarity: paragonIdx(),
      dungeon: s.highestDungeonReached || 1,
      ilvl: s.level || 1,
      stats: statsFor(s.level, s.highestDungeonReached),
      icon: '\u229b',
      noSell: true,
    };
  }

  // Every place an Axiom might sit: equipped, in the bag, or in a saved per-hull
  // fitting. Same object shape in all three, so all three get synced.
  function each(fn) {
    const s = G().state;
    try { for (const k in (s.equipped || {})) { const it = s.equipped[k]; if (it && it.axiom) fn(it); } } catch (e) {}
    try { (s.inventory || []).forEach((it) => { if (it && it.axiom) fn(it); }); } catch (e) {}
    try {
      for (const sh in (s.fittings || {})) {
        const f = s.fittings[sh] || {};
        for (const sl in f) { const it = f[sl]; if (it && it.axiom) fn(it); }
      }
    } catch (e) {}
  }

  function count() { let n = 0; each(() => n++); return n; }

  // Called from refreshStats() — cheap, idempotent, and the only thing that makes
  // the weapon scale. Also re-mints if the owner has none (sold, or a fresh
  // post-ascension save).
  function sync() {
    try {
      const g = G(), s = g && g.state;
      if (!s || !owned()) return;
      const st = statsFor(s.level, s.highestDungeonReached);
      let found = 0;
      // `dungeon` MUST be rewritten too. It is not decoration: three UI surfaces
      // print it as the item's zone, and it was only ever set in mint(). A pilot
      // who bought the cannon at zone 32 and pushed to 400 saw stats costed at
      // 400 under a label that still read Z32 — the numbers were right and the
      // card was lying about them.
      each((it) => {
        found++;
        it.stats = Object.assign({}, st);
        it.ilvl = s.level || 1;
        it.dungeon = s.highestDungeonReached || 1;
        it.rarity = paragonIdx();
      });
      if (!found) {
        if (!Array.isArray(s.inventory)) s.inventory = [];
        s.inventory.push(mint());
      }
    } catch (e) {}
  }

  function buy() {
    const g = G(), s = g.state;
    if (owned()) return { ok: false, reason: 'owned' };
    // NEVER `| 0` A BALANCE — it wraps past 2.1 billion and locks out exactly the
    // players who can afford this. Same bug class as the Fleet Exploration fuel gate.
    if ((Number(s.credits) || 0) < PRICE) return { ok: false, reason: 'credits' };
    if (s.inventory.length >= (g.invCap ? g.invCap() : 100)) return { ok: false, reason: 'full' };
    s.credits -= PRICE;
    s.purchases = s.purchases || {};
    s.purchases[KEY] = { at: Date.now(), price: PRICE };
    s.inventory.push(mint());
    try { if (s.autoEquipAlways && g.autoEquip) g.autoEquip(true); } catch (e) {}
    g.refreshStats(); g.save();
    return { ok: true };
  }

  window.AXIOM = { KEY, PRICE, buy, sync, owned, statsFor, count, mint };
})();
