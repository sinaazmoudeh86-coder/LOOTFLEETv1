/* =============================================================================
   dreadnaught.js — LOOTFLEET · Pilot Progression + Dreadnaught Hunt
   ---------------------------------------------------------------------------
   A permanent, account-wide progression system unlocked at Level 30.

     • DREADNAUGHT HUNT (Command) — a weekly raid: 30 escalating waves on the
       REAL battle engine, then a multi-phase Dreadnaught raid boss that drops
       the rare DREAD CORE currency.
     • PILOT TREE (Hangar ▸ Pilot) — an endless hexagonal talent network with
       fog of discovery. Spend Dread Cores to unlock nodes outward from the
       core. Every node permanently buffs EVERY ship you fly.

   Combat runs on the real engine. Tiny hooks in game-v93.js drive this:
     • computeStats(): window.DREAD.combatMods()        — fold pilot stat buffs
     • gainXp / onKill / lootQ / pickup: window.DREAD.mult(key) — utility buffs
     • resolveHit(): window.DREAD.dmgVs(e)              — boss/elite damage
     • update(): window.DREAD.tick(dt, rt)             — raid-boss phases
     • draw():   window.DREAD.render(ctx,t,rt)         — phase telegraphs
     • startDreadHunt(tier) deploys the gauntlet; updateWaveZone calls
       window.DREAD.onHuntCleared(tier) when the Dreadnaught falls.
   ============================================================================= */
(function () {
  'use strict';
  const G = () => window.GAME;
  const $ = (id) => document.getElementById(id);
  const UNLOCK_LEVEL = 30;
  const ACCENT = '#ff3a4a';

  // ---- small utils ----------------------------------------------------------
  function fmt(n) { try { return G().formatNum(Math.floor(n)); } catch (e) { return Math.floor(n) + ''; } }
  function lvl() { try { return (G().state.level | 0) || 1; } catch (e) { return 1; } }
  // `| 0` COERCES TO A SIGNED 32-BIT INT, so any balance over ~2.1 billion wraps
  // NEGATIVE: a vault payout of 1e15 Dread Cores rendered as -1,530,494,976 in the
  // wallet and read as a negative balance everywhere this is called. Math.floor
  // has the same intent (whole cores) with no ceiling.
  function cores() { try { return Math.max(0, Math.floor(G().state.dreadCores || 0)); } catch (e) { return 0; } }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function toast(m, c) { try { if (window.UI && window.UI.unlockToast) window.UI.unlockToast(m); } catch (e) {} }

  // =========================================================================
  // HEX SKILL TREE — deterministic, infinite, fog-of-discovery
  // =========================================================================
  const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  function axialDist(q, r) { return (Math.abs(q) + Math.abs(q + r) + Math.abs(r)) / 2; }
  function key(q, r) { return q + ',' + r; }
  function parseKey(k) { const p = k.split(','); return [parseInt(p[0], 10), parseInt(p[1], 10)]; }

  // hash (q,r) → uint32, then a seeded RNG for stable per-node properties
  function hash(q, r) {
    let h = ((q * 73856093) ^ (r * 19349663) ^ 0x9e3779b9) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }
  function rngFor(q, r) { let s = hash(q, r) || 1; return () => { s = Math.imul(s ^ (s >>> 15), 2246822519) >>> 0; s = (s + 0x6d2b79f5) >>> 0; return ((s >>> 8) & 0xffffff) / 0x1000000; }; }

  // bonus catalogs by category. key → which engine mod it feeds.
  const OFFENSE = [
    { key: 'dmgPct', label: 'Weapon Damage', unit: '%', lo: 3, hi: 6 },
    { key: 'atkSpeedPct', label: 'Fire Rate', unit: '%', lo: 2, hi: 4 },
    { key: 'critChance', label: 'Critical Chance', unit: '%', lo: 1.5, hi: 3 },
    { key: 'critDamage', label: 'Critical Damage', unit: '%', lo: 6, hi: 12 },
    { key: 'multiShot', label: 'Multi-Fire', unit: '%', lo: 1.5, hi: 3 },
    { key: 'bossDamage', label: 'Boss Damage', unit: '%', lo: 4, hi: 8 },
    { key: 'eliteDamage', label: 'Elite Damage', unit: '%', lo: 4, hi: 8 },
    { key: 'rangePct', label: 'Projectile Speed', unit: '%', lo: 4, hi: 8 },
  ];
  const DEFENSE = [
    { key: 'hpPct', label: 'Hull Strength', unit: '%', lo: 4, hi: 7 },
    { key: 'hpPct', label: 'Shield Capacity', unit: '%', lo: 4, hi: 7 },
    { key: 'regen', label: 'Shield Regen', unit: '%/s', lo: 0.4, hi: 1.0 },
    { key: 'dmgReduce', label: 'Armor', unit: '%', lo: 0.5, hi: 0.5 },
    { key: 'dmgReduce', label: 'Damage Reduction', unit: '%', lo: 0.5, hi: 0.5 },
    { key: 'lifeSteal', label: 'Life Steal', unit: '%', lo: 0.12, hi: 0.28 },
  ];
  const UTILITY = [
    { key: 'lootQuality', label: 'Loot Quality', unit: '%', lo: 4, hi: 8, util: true },
    { key: 'goldFind', label: 'Gold Find', unit: '%', lo: 5, hi: 10, util: true },
    // PROGRESSION NOTE (Aug 2026) — 4–8 → 3–5 per node, part of the game-wide XP
    // reduction (see the FLEET XP RATE block in game-v93.js).
    { key: 'xpGain', label: 'XP Gain', unit: '%', lo: 3, hi: 5, util: true },
    { key: 'pickupRadius', label: 'Loot Pickup Radius', unit: '%', lo: 6, hi: 12, util: true },
  ];
  // rare / legendary nodes — strong combat combos + flavour; some carry a flag.
  const RARES = [
    { label: 'Twin-Link Array', bonus: { multiShot: 6, dmgPct: 6 }, special: null },
    { label: 'Apex Predator', bonus: { bossDamage: 16, eliteDamage: 16 }, special: null },
    { label: 'Core Resonance', bonus: { dmgPct: 8, critDamage: 18 }, special: 'coreLuck' },
    { label: 'Aegis Lattice', bonus: { hpPct: 14, dmgReduce: 0.5 }, special: null },
    { label: 'Vampiric Engine', bonus: { lifeSteal: 0.8, dmgPct: 6 }, special: null },
    { label: 'Treasure Sense', bonus: { lootQuality: 14 }, util: true, special: null },
    { label: 'Overclocked Reactor', bonus: { atkSpeedPct: 10, moveSpeed: 8 }, special: null },
    { label: 'Dread Harvester', bonus: { bossDamage: 12 }, special: 'coreLuck' },
  ];

  // ring-1 opening: a curated, balanced first choice in every direction
  const RING1 = [
    { cat: 'offense', i: 0 }, // dmg
    { cat: 'defense', i: 0 }, // hull
    { cat: 'offense', i: 2 }, // crit chance
    { cat: 'utility', i: 1 }, // gold
    { cat: 'defense', i: 5 }, // lifesteal
    { cat: 'offense', i: 1 }, // fire rate
  ];

  function nodeDef(q, r) {
    if (q === 0 && r === 0) {
      return { q, r, core: true, cat: 'core', label: 'Pilot Core', desc: 'The seat of your command. Expand outward.', cost: 0, score: 0, bonus: {} };
    }
    const ring = axialDist(q, r);
    const rnd = rngFor(q, r);
    let cat, pick, special = null, util = false;

    // legendary nodes appear only ring 3+, ~7%
    if (ring >= 3 && rnd() < 0.07) {
      cat = 'rare';
      const ra = RARES[(rnd() * RARES.length) | 0];
      const bonus = {}; for (const k in ra.bonus) bonus[k] = ra.bonus[k];
      special = ra.special; util = !!ra.util;
      const score = 60 + Math.round(ring * 6);
      return { q, r, cat, label: ra.label, bonus, util, special, cost: 3, score, rare: true, ring };
    }

    if (ring === 1) {
      const o = RING1[((q * 2 + r * 5) % 6 + 6) % 6];
      cat = o.cat; pick = (cat === 'offense' ? OFFENSE : cat === 'defense' ? DEFENSE : UTILITY)[o.i];
    } else {
      const roll = rnd();
      cat = roll < 0.40 ? 'offense' : roll < 0.70 ? 'defense' : 'utility';
      const pool = cat === 'offense' ? OFFENSE : cat === 'defense' ? DEFENSE : UTILITY;
      pick = pool[(rnd() * pool.length) | 0];
    }
    // CRIT CHANCE THROTTLE. critChance was one of eight equally-likely offense
    // rolls paying 1.5–3% a node, while a whole Primordial fitting's crit line is
    // ~0.1% — so the tree was where crit came from, and it read as nothing but
    // crit tiles. Three in four crit rolls now become another offense stat
    // instead. Ring 1 is exempt: those six nodes are the curated opening.
    if (ring > 1 && pick.key === 'critChance' && rnd() >= 0.25) {
      const alt = OFFENSE.filter((o) => o.key !== 'critChance');
      pick = alt[(rnd() * alt.length) | 0];
    }
    util = !!pick.util;
    // magnitude: rolled in range, gently scaled by ring depth (deeper = stronger)
    const depth = 1 + Math.min(0.8, (ring - 1) * 0.06);
    let mag = (pick.lo + rnd() * (pick.hi - pick.lo)) * depth;
    mag = pick.unit === '%/s' ? Math.round(mag * 10) / 10 : Math.round(mag * 10) / 10;
    const bonus = {}; bonus[pick.key] = mag;
    const score = Math.round(mag * (pick.unit === '%/s' ? 14 : pick.key === 'critDamage' ? 1.1 : pick.key === 'pickupRadius' ? 1.2 : 2.2)) + 4;
    return { q, r, cat, label: pick.label, unit: pick.unit, bonus, util, special, cost: 1, score, ring };
  }

  // ---- tree state ----------------------------------------------------------
  function nodes() {
    const s = G() && G().state; if (!s) return {};
    // SELF-HEAL — pilot ascension (or a stale save) can leave state.pilot null;
    // without the origin seed the tree canvas drew ZERO tiles until a relog.
    if (!s.pilot) s.pilot = { nodes: { '0,0': 1 } };
    if (!s.pilot.nodes) s.pilot.nodes = { '0,0': 1 };
    if (!s.pilot.nodes['0,0']) s.pilot.nodes['0,0'] = 1;
    return s.pilot.nodes;
  }
  function isUnlocked(k) { return !!nodes()[k]; }
  function unlockedKeys() { return Object.keys(nodes()); }
  function neighbors(q, r) { return DIRS.map((d) => [q + d[0], r + d[1]]); }
  function isUnlockable(q, r) {
    if (isUnlocked(key(q, r))) return false;
    return neighbors(q, r).some(([nq, nr]) => isUnlocked(key(nq, nr)));
  }
  // fog: unlocked nodes + their direct neighbors are visible (discovered).
  function visibleSet() {
    const vis = {};
    unlockedKeys().forEach((k) => {
      const [q, r] = parseKey(k); vis[k] = true;
      neighbors(q, r).forEach(([nq, nr]) => { vis[key(nq, nr)] = true; });
    });
    return vis;
  }

  // ---- THE DRAW SCENE — built once per tree, not once per frame -------------
  // What made the map stutter as the tree grew was never the painting: it was
  // that every frame REDERIVED THE WHOLE TREE. drawTree() called visibleSet()
  // (N x 6 string keys), then per visible node parseKey() (split + two parseInt),
  // nodeDef() (closure + seeded rng + fresh object) and isUnlockable() (six more
  // string keys), then walked six neighbours again for the edges. A drag fires a
  // pointer event per frame or more, so all of it ran 60-120 times a second and
  // the cost grew with every node unlocked. Exactly the reported symptom.
  //
  // nodeDef() is PURE and deterministic (hash -> seeded rng), so its answer for a
  // coordinate never changes for the life of the tab. Memoised for good.
  const _defs = new Map();
  function defFor(q, r) {
    const k = key(q, r); let d = _defs.get(k);
    if (!d) { d = nodeDef(q, r); d.key = k; _defs.set(k, d); }
    return d;
  }
  // Every visible node with its coordinate, tree-space centre, definition and
  // unlocked/available state resolved ONCE, plus a de-duplicated edge list.
  // Rebuilt only when the unlocked set actually moves — keyed on object identity
  // AND count, the same self-healing signal ensureAgg() uses, so a cloud pull,
  // an account switch or an ascension that swaps state.pilot under the module
  // cannot leave a stale tree on screen.
  let _scene = null, _sceneRef = null, _sceneN = -1;
  function scene() {
    const src = nodes(), n = Object.keys(src).length;
    if (_scene && src === _sceneRef && n === _sceneN) return _scene;
    const vis = visibleSet(), list = [], byKey = new Map();
    Object.keys(vis).forEach((k) => {
      const [q, r] = parseKey(k), c = hexCenter(q, r);
      const rec = { k, q, r, cx: c.x, cy: c.y, d: defFor(q, r), unlocked: !!src[k], avail: false };
      list.push(rec); byKey.set(k, rec);
    });
    for (let i = 0; i < list.length; i++) {
      const rec = list[i]; if (rec.unlocked) continue;
      for (let j = 0; j < 6; j++) {
        const nb = byKey.get(key(rec.q + DIRS[j][0], rec.r + DIRS[j][1]));
        if (nb && nb.unlocked) { rec.avail = true; break; }
      }
    }
    const edges = [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = 0; j < 6; j++) {
        const bk = key(a.q + DIRS[j][0], a.r + DIRS[j][1]);
        if (a.k > bk) continue;                       // draw each edge once
        const b = byKey.get(bk); if (!b) continue;
        edges.push({ ax: a.cx, ay: a.cy, bx: b.cx, by: b.cy, own: a.unlocked && b.unlocked });
      }
    }
    _scene = { list, byKey, edges }; _sceneRef = src; _sceneN = n;
    return _scene;
  }
  // Gradients are the most expensive thing a hex asks for, and drawTree() built
  // TWO PER NODE PER FRAME. They only ever differ by category colour and radius,
  // so they are cached in NODE-LOCAL space (centred on 0,0) and painted under a
  // translate. Cleared when the radius changes (zoom) or the cache gets silly.
  const _grad = new Map();
  function gradFor(ctx, kind, col, rad, alpha) {
    const k = kind + '|' + col + '|' + rad.toFixed(1) + '|' + (alpha || 0).toFixed(2);
    let g = _grad.get(k);
    if (!g) {
      if (_grad.size > 90) _grad.clear();
      if (kind === 'fill') {
        g = ctx.createLinearGradient(-rad, -rad, rad, rad);
        g.addColorStop(0, shade(col, 1.25)); g.addColorStop(1, shade(col, 0.55));
      } else {
        g = ctx.createRadialGradient(0, 0, rad * 0.2, 0, 0, rad * 2.0);
        g.addColorStop(0, rgba(col, alpha)); g.addColorStop(0.6, rgba(col, alpha * 0.37)); g.addColorStop(1, rgba(col, 0));
      }
      _grad.set(k, g);
    }
    return g;
  }
  // Graphics tier is a FLOOR, never a second opinion — see js/perf-tier.js. All
  // it costs here is paint: auras and glows, never what a node is or costs.
  function _gfxLow() { try { return !!(window.PERF && window.PERF.lodFloor && window.PERF.lodFloor() >= 2); } catch (e) { return false; } }
  function canUnlock(q, r) { return lvl() >= UNLOCK_LEVEL && isUnlockable(q, r) && cores() >= nodeDef(q, r).cost; }
  function unlock(q, r) {
    if (!canUnlock(q, r)) return false;
    const def = nodeDef(q, r);
    G().state.dreadCores -= def.cost;
    nodes()[key(q, r)] = 1;
    _aggDirty = true;
    // Fold the new node's bonuses into live combat stats immediately — otherwise
    // the pilot buffs (and the Ship/Fleet Score) don't update until some other
    // event happens to recompute stats.
    try { G().refreshStats && G().refreshStats(); } catch (e) {}
    try { G().save(); } catch (e) {}
    if (window.UI) window.UI.refreshAll();
    return true;
  }

  // ---- bonus aggregation (cached; recomputed only when nodes change) -------
  // SELF-HEALING CACHE. The dirty flag alone was not enough: it was raised on
  // unlock, on boot and on ascension, and nowhere else — so ANY other path that
  // swapped the save under the module (cloud pull on login, account switch,
  // admin grant, a migration rewriting state.pilot) kept serving the PREVIOUS
  // tree's bonuses for the rest of the session, which is exactly what "the tree
  // isn't doing anything" looks like from the cockpit. Re-derive whenever the
  // node object identity or its node count moves, not just when we were told to.
  let _aggDirty = true, _agg = null, _aggRef = null, _aggN = -1;
  function ensureAgg() {
    const src = nodes(), n = Object.keys(src).length;
    if (!_aggDirty && _agg && src === _aggRef && n === _aggN) return _agg;
    const combat = {}; const util = {}; const special = {};
    unlockedKeys().forEach((k) => {
      const [q, r] = parseKey(k); const d = nodeDef(q, r);
      if (d.special) special[d.special] = (special[d.special] || 0) + 1;
      if (!d.bonus) return;
      for (const bk in d.bonus) {
        // util rares may carry combat keys too; route by node-level util flag
        const u = d.util && (bk === 'lootQuality' || bk === 'goldFind' || bk === 'xpGain' || bk === 'pickupRadius');
        (u ? util : combat)[bk] = ((u ? util : combat)[bk] || 0) + d.bonus[bk];
      }
    });
    _agg = { combat, util, special }; _aggDirty = false; _aggRef = src; _aggN = n;
    return _agg;
  }
  // Every active bonus as one sorted, labelled list. ONE source of truth for the
  // pill rows on both the Pilot screen and the Pilot Skills screen.
  const BONUS_LABELS = {
    dmgPct: 'DMG', atkSpeedPct: 'Fire Rate', critChance: 'Crit', critDamage: 'Crit DMG', multiShot: 'Multi-Fire',
    bossDamage: 'Boss DMG', eliteDamage: 'Elite DMG', rangePct: 'Weapon Range', hpPct: 'Hull', regen: 'Regen',
    dmgReduce: 'Armor', lifeSteal: 'Life Steal', moveSpeed: 'Move',
    lootQuality: 'Loot', goldFind: 'Gold', xpGain: 'XP', pickupRadius: 'Pickup',
  };
  function bonusList() {
    const a = ensureAgg(), out = [];
    const push = (src, u) => { for (const k in src) if (src[k]) out.push({ key: k, label: BONUS_LABELS[k] || k, value: src[k], unit: k === 'regen' ? '%/s' : '%', util: u }); };
    push(a.combat, false); push(a.util, true);
    out.sort((x, y) => y.value - x.value);
    return out;
  }
  // Unlocked nodes, not counting the free origin core.
  function nodeCount() { return Math.max(0, unlockedKeys().length - 1); }
  function combatMods() { return ensureAgg().combat; }
  function mult(k) { const v = ensureAgg().util[k] || 0; return 1 + v / 100; }
  // BOSS AND ELITE DAMAGE DO NOT APPLY TO ANOTHER PILOT'S DEFENCE.
  //
  // A rival's My Galaxy tile and a held Void spire are fought as a CLONE of that
  // pilot's own fleet (isClone, spawned with isBoss + isSuper) or as their
  // citadel. Both flags are read here, so the attacker was landing bossDamage AND
  // eliteDamage on a defence built out of another player's ships — perks meant for
  // PvE monsters silently became a PvP damage multiplier, and the defender has no
  // equivalent because they are not present for the fight.
  //
  // The clone matchup is already calibrated against the defender's TRUE power, so
  // a perk stacked on top of that is not a difficulty knob; it is a thumb on the
  // scale of a contest between two accounts.
  //
  // This also closes a second fault in the same line: bossDamage was added
  // UNCONDITIONALLY — there was no isBoss test at all — so the boss-damage perk
  // was multiplying every ordinary hostile in the game.
  function isPlayerDefence(e) {
    if (!e) return false;
    if (e.isClone) return true;                 // a rival's fleet, fought as a clone
    if (e.isCitadel && e.rivalOwned) return true;   // their fortress, on their tile
    return false;
  }
  function dmgVs(e) {
    const c = ensureAgg().combat;
    if (!e) return 1;
    if (isPlayerDefence(e)) return 1;           // PvP: no perk multiplier, either way
    let b = e.isBoss ? (c.bossDamage || 0) : 0;
    const elite = e.isSuper || e.isDread || e.isCitadel || e.isClone;
    if (elite) b += (c.eliteDamage || 0);
    return 1 + b / 100;
  }
  function hasSpecial(name) { return !!ensureAgg().special[name]; }
  function playerDefence(e) { return isPlayerDefence(e); }

  // pilot score + rank
  function pilotScore() {
    let s = 0; unlockedKeys().forEach((k) => { const [q, r] = parseKey(k); s += nodeDef(q, r).score || 0; });
    return s;
  }
  const RANKS = [[4000, 'Legendary Pilot'], [1800, 'Master Pilot'], [750, 'Elite Pilot'], [250, 'Veteran Pilot'], [0, 'Pilot Recruit']];
  function rankFor(score) { for (const [t, n] of RANKS) if (score >= t) return n; return 'Pilot Recruit'; }

  // =========================================================================
  // DREADNAUGHT HUNT — tiers, weekly lockout, drop chance, rewards
  // =========================================================================
  function levelForTier(t) { try { return G().dreadLevelFor(t); } catch (e) { return 5 + t * 25; } }
  function maxTier() { return Math.max(0, Math.floor((lvl() - 5) / 25)); }            // tiers unlocked by level
  // CORE SCARCITY IS APPLIED HERE, INSIDE THE ODDS (build 729), not at the grant.
  // The hunt card prints `dropChance(t) * 100` as the tier's advertised percentage,
  // so scaling the chance is what keeps the number on the card and the number in
  // the roll the same statement. Scaling the payout instead would have left every
  // card advertising the old odds.
  // 40% base / +2% a tier becomes 12% / +0.6% at CONFIG.DREAD_CORE_RATE 0.30.
  function coreRate() { try { const r = window.CONFIG.DREAD_CORE_RATE; return r > 0 ? r : 1; } catch (e) { return 1; } }
  function dropChance(t) { return Math.min(0.95, 0.40 + (t - 1) * 0.02) * coreRate(); }
  // ISO-ish week index (weeks since a fixed Monday epoch, UTC)
  const WEEK_MS = 7 * 864e5;
  const EPOCH = Date.UTC(2024, 0, 1);                                                 // a Monday
  function weekIndex() { return Math.floor((Date.now() - EPOCH) / WEEK_MS); }
  function weekResetMs() { return EPOCH + (weekIndex() + 1) * WEEK_MS - Date.now(); }
  function lockOf(t) { try { return G().state.dreadLock || {}; } catch (e) { return {}; } }
  // ---- LOOTFLEET PRO: one extra hunt per tier, per week ---------------------
  // PRO_PERKS.dreadAttempts was declared and SOLD on the purchase sheet but
  // never implemented — subscribers were paying for an attempt that did not
  // exist. It is a real second run at each tier now, refreshed weekly with the
  // rest of the hunt, consumed only when the tier was genuinely locked.
  function proFree() {
    const st = G().state;
    if (!st.dreadProFree || st.dreadProFree.week !== weekIndex()) st.dreadProFree = { week: weekIndex(), used: {} };
    return st.dreadProFree;
  }
  function isPro() { try { return !!(G().isPro && G().isPro()); } catch (e) { return false; } }
  function proAttempt(t) { return isPro() && !proFree().used[t]; }
  function isLocked(t) { return lockOf(t)[t] === weekIndex() && !proAttempt(t); }
  function canHunt(t) { return lvl() >= levelForTier(t) && !isLocked(t); }

  // ---- PURCHASED RESPAWNS -------------------------------------------------
  // Buy back a locked tier's attempt at a brutally escalating gold price:
  // 1st respawn 100M → 2nd 100B → 3rd 100T → ×1000 each, PER TIER, resets weekly.
  function respawnState() {
    const st = G().state;
    if (!st.dreadRespawn || st.dreadRespawn.week !== weekIndex()) st.dreadRespawn = { week: weekIndex(), n: {} };
    return st.dreadRespawn;
  }
  function respawnCost(t) { return 100e6 * Math.pow(1000, (respawnState().n[t] || 0)); }
  function buyRespawn(t) {
    if (!isLocked(t)) return;
    const cost = respawnCost(t), g = G();
    if ((g.state.gold || 0) < cost) { toast('Need ' + fmt(cost) + ' gold to respawn this Dreadnaught'); return; }
    g.state.gold -= cost;
    const rs = respawnState(); rs.n[t] = (rs.n[t] || 0) + 1;
    delete g.state.dreadLock[t];
    g.save(); if (window.UI) window.UI.refreshAll();
    toast('⟳ Dreadnaught T' + t + ' respawned — deploy when ready');
    renderHunt();
  }
  function fmt(n) { try { return G().formatNum(Math.floor(n)); } catch (e) { return Math.floor(n) + ''; } }

  function deploy(t) {
    if (lvl() < UNLOCK_LEVEL) { toast('Dreadnaught Hunt unlocks at Level ' + UNLOCK_LEVEL); return; }
    if (lvl() < levelForTier(t)) { toast('Reach Level ' + levelForTier(t) + ' to challenge this Dreadnaught'); return; }
    if (isLocked(t)) { toast('This Dreadnaught is on weekly cooldown'); try { window.PROOFFER && PROOFFER.maybe('dreadlock'); } catch (e) {} return; }
    closeAllSheets();
    // Burn the Pro extra BEFORE the lock is re-stamped, so it is spent only on a
    // tier that was actually used up this week.
    const _wasLocked = lockOf(t)[t] === weekIndex();
    if (_wasLocked && proAttempt(t)) proFree().used[t] = 1;
    try { G().startDreadHunt(t); } catch (e) { return; }
    // ONE HUNT PER TIER PER WEEK — the attempt is CONSUMED ON LAUNCH, win or
    // lose. Bailing mid-hunt no longer refunds it (that loophole let players
    // farm the 30-wave gauntlet endlessly). Gold respawns still buy it back.
    const st = G().state;
    if (!st.dreadLock) st.dreadLock = {};
    st.dreadLock[t] = weekIndex();
    try { G().save(); } catch (e) {}
    updateHud();
    // jump to the live battle view
    const b = document.querySelector('.nav-btn[data-screen="battle"]'); if (b) b.click();
    banner('DREADNAUGHT HUNT · TIER ' + t, 'Survive 30 waves — then break the Dreadnaught · your weekly attempt is live', ACCENT);
  }

  // called by the engine the instant the Dreadnaught is destroyed
  function onHuntCleared(t) {
    const st = G().state;
    if (!st.dreadLock) st.dreadLock = {};
    st.dreadLock[t] = weekIndex();   // (already consumed at launch — kept for safety)
    const firstEver = !st.dreadFirstKill;
    st.dreadFirstKill = true;
    let got = Math.random() < dropChance(t) ? 1 : 0;
    if (firstEver) got = Math.max(1, got);                       // guarantee the very first core (onboarding)
    if (got > 0 && hasSpecial('coreLuck') && Math.random() < 0.5) got += 1;  // legendary: double-core
    st.dreadCores = (st.dreadCores || 0) + got;
    try { G().save(); } catch (e) {}
    if (window.UI) window.UI.refreshAll();
    updateHud();
    victory(t, got, firstEver);
  }

  // =========================================================================
  // RAID-BOSS PHASES (engine tick) + telegraphs (engine render)
  // =========================================================================
  let _lastBoss = null, _phase = 0, _novaT = 0;
  function tick(dt, rt) {
    const b = rt.boss;
    if (!b || !b.isDread) { _lastBoss = null; _phase = 0; return; }
    if (b !== _lastBoss) { _lastBoss = b; _phase = 1; _novaT = 3.0; banner('DREADNAUGHT INBOUND', 'Raid boss — multiple combat phases', ACCENT); }
    const frac = b.maxHp > 0 ? b.hp / b.maxHp : 1;
    const ph = frac > 0.66 ? 1 : frac > 0.33 ? 2 : 3;
    if (ph > _phase) {
      _phase = ph;
      b.fireCd = Math.max(0.5, b.fireCd * 0.78);                 // enrage: fire faster
      b.damage *= 1.12;
      rt.shake = Math.min(5, (rt.shake || 0) + 2);
      nova(b, rt, ph);
      banner(ph === 2 ? 'PHASE II · ENRAGED' : 'PHASE III · OVERLOAD', ph === 3 ? 'Maximum aggression — stay mobile' : 'Heavier fire incoming', ACCENT);
    }
    if (ph >= 2) { _novaT -= dt; if (_novaT <= 0) { _novaT = ph >= 3 ? 2.0 : 3.4; nova(b, rt, ph); } }
  }
  function nova(b, rt, ph) {
    if (!rt.ebolts || rt.ebolts.length > 110) return;
    const n = ph >= 3 ? 22 : 14, sp = 168, off = rt.time * 0.7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + off;
      rt.ebolts.push({ x: b.x, y: b.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ang: a, dmg: b.damage * 0.42, tint: '#ff4a5a', src: b, life: 3.0 });
    }
  }
  function render(ctx, t, rt) {
    const b = rt.boss; if (!b || !b.isDread || b.dying) return;
    // danger aura that tightens as the fight escalates
    const frac = b.maxHp > 0 ? b.hp / b.maxHp : 1;
    const sev = 1 - frac;
    const pulse = 0.5 + 0.5 * Math.sin(t * (3 + sev * 4));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const R = b.size * (2.2 + sev * 0.8);
    const g = ctx.createRadialGradient(b.x, b.y, b.size * 0.6, b.x, b.y, R);
    g.addColorStop(0, 'rgba(255,42,58,0)');
    g.addColorStop(0.7, 'rgba(255,42,58,' + (0.05 + 0.10 * pulse * (0.4 + sev)).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,42,58,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, R, 0, 7); ctx.fill();
    ctx.restore();
  }

  // =========================================================================
  // IN-WORLD BANNER (spawn / phase / deploy callouts)
  // =========================================================================
  let _banner, _bannerT;
  function banner(title, sub, col) {
    if (!_banner) {
      _banner = document.createElement('div'); _banner.id = 'dread-banner';
      _banner.innerHTML = '<div class="db-t"></div><div class="db-s"></div>';
      ($('app') || document.body).appendChild(_banner);
    }
    _banner.querySelector('.db-t').textContent = title;
    _banner.querySelector('.db-s').textContent = sub || '';
    _banner.style.setProperty('--dbc', col || ACCENT);
    _banner.classList.remove('show'); void _banner.offsetWidth; _banner.classList.add('show');
    clearTimeout(_bannerT); _bannerT = setTimeout(() => _banner.classList.remove('show'), 2600);
  }

  // =========================================================================
  // WALLET CHIP
  // =========================================================================
  function updateHud() {
    const chip = $('hud-dread'); const val = $('hud-dread-v');
    if (val) val.textContent = fmt(cores());
    if (chip) chip.style.display = (cores() > 0 || lvl() >= UNLOCK_LEVEL) ? '' : 'none';
    const cb = $('cmd-dread-badge');
    const dreadReady = huntsReady();
    if (cb) { cb.style.display = dreadReady > 0 ? 'flex' : 'none'; cb.textContent = dreadReady; }
    // ---- COMMAND-menu notifications: light up cards with pending actions ----
    const setBadge = (id, n) => {
      const e = $(id); if (!e) return;
      e.style.display = n > 0 ? 'flex' : 'none';
      e.textContent = n > 99 ? '99+' : n;
    };
    // Pilot Skills — unspent skill points to allocate
    let skillPts = 0; try { skillPts = (G().state.skillPoints | 0) || 0; } catch (e) {}
    setBadge('cmd-skills-badge', skillPts);
    // Pilot Tree — Dread Cores ready to spend on an unlockable node
    const pilotReady = (lvl() >= UNLOCK_LEVEL && cores() >= 1) ? cores() : 0;
    setBadge('cmd-pilot-badge', pilotReady);
    // Command nav button — aggregate count of sections that need attention.
    // Fleet Exploration counts as one: a landed expedition is rewards the pilot
    // has already earned sitting behind two taps, so the nav has to say so.
    let expoReady = 0; try { expoReady = (window.EXPO && window.EXPO.badge()) | 0; } catch (e) {}
    const sections = (skillPts > 0 ? 1 : 0) + (pilotReady > 0 ? 1 : 0) + (dreadReady > 0 ? 1 : 0) + (expoReady > 0 ? 1 : 0);
    const navB = $('cmd-badge');
    if (navB) { navB.style.display = sections > 0 ? 'block' : 'none'; navB.textContent = sections; }
  }
  // number of tiers available to run right now (unlocked + off cooldown)
  function huntsReady() { let n = 0; for (let t = 1; t <= maxTier(); t++) if (canHunt(t)) n++; return n; }

  // =========================================================================
  // UI — PILOT SCREEN (hex tree) + DREADNAUGHT HUNT SCREEN
  // =========================================================================
  // (rendered into #pilot-body / #dread-body — see ui.js wiring)
  let _filter = null;                       // category highlight filter
  let _selected = null;                     // selected node key on the tree
  // ---- MAP OR LIST ---------------------------------------------------------
  // The tree is an INFINITE procedural hex grid with fog: visibleSet() shows the
  // unlocked nodes plus one ring out, and everything else is a `?` on a dark
  // field. That makes the canvas a genuinely poor way to SPEND CORES — to find
  // the node you want you drag an unbounded plane around a small viewport,
  // squinting at hexes, with no search, no sort by cost, and no way to see what
  // you already own. It is worse with a mouse than with a thumb.
  //
  // So the canvas is no longer the only way in. The same node set is available as
  // a LIST: searchable, filterable, affordable-first, with the unlock button on
  // the row. The map stays — it is how the shape of the tree reads, and it is the
  // better view for planning a route — but nobody has to navigate a plane to
  // spend a currency. The choice is remembered, because it is a preference about
  // how someone reads, not a mode they are toggling per visit.
  let _view = 'map';                        // 'map' | 'list'
  let _listTab = 'avail';                   // 'avail' | 'owned'
  let _q = '';                              // list search text
  try { const v = localStorage.getItem('lf_pltree_view'); if (v === 'list' || v === 'map') _view = v; } catch (e) {}
  function setView(v) {
    _view = v;
    try { localStorage.setItem('lf_pltree_view', v); } catch (e) {}
    try { localStorage.setItem('lf_pltree_viewseen', '1'); } catch (e) {}
    renderPilot();
  }
  function plViewSeen() { try { return localStorage.getItem('lf_pltree_viewseen') === '1'; } catch (e) { return true; } }
  // ONE BUTTON THAT NAMES ITS DESTINATION.
  //
  // The old control was a two-state segment wedged into a bar beside four category
  // chips and two zoom buttons — seven small pills at the same weight — so the one
  // control that changes how the entire screen works read as a fifth filter. And a
  // segment with one side already lit is a STATUS, not an invitation: "⬡ Map"
  // filled next to a grey "☰ List" looks like a label with a disabled sibling.
  // Its only explanation was a `title` tooltip, which never reaches a touch
  // device. That is the whole of "people don't know it exists".
  //
  // The AFFORDABLE COUNT is the reason to press it. Answering "what can I actually
  // buy right now" is the list's entire purpose, and listNodes() only walks the
  // visible set (unlocked plus one ring), so it is cheap enough to read here.
  function viewBtnHTML() {
    const onMap = _view === 'map';
    let aff = 0;
    if (onMap) { try { aff = listNodes().avail.filter((d) => cores() >= d.cost).length; } catch (e) {} }
    const fresh = !plViewSeen();
    return '<div class="pl-viewsw' + (fresh ? ' fresh' : '') + '" role="group" aria-label="Tree view">' +
      '<div class="plv-row">' +
        '<button class="plv-b' + (onMap ? ' on' : '') + '" data-view="map">\u2b21 Map</button>' +
        '<button class="plv-b' + (onMap ? '' : ' on') + '" data-view="list">\u2630 List</button>' +
      '</div>' +
      '<span class="plv-s">' + (onMap
        ? (aff ? 'Tap <b>List</b> \u2014 <b>' + aff + '</b> node' + (aff === 1 ? '' : 's') + ' you can afford now'
               : 'Tap <b>List</b> to search, sort and unlock')
        : 'Tap <b>Map</b> to see the shape of the tree') + '</span>' +
      (fresh ? '<i class="plv-new">NEW</i>' : '') +
      '</div>';
  }
  let pan = { x: 0, y: 0 };                  // tree pan offset (px)
  let zoom = 1;                              // tree zoom (0.35–1.8)
  const HEX = 26;                            // hex radius (px) in tree space (zoomed out a touch)
  let _treeCanvas, _treeCtx, _hitNodes = [], _panActive = false, _panMoved = false, _panStart = null;

  function hexCenter(q, r) { return { x: HEX * 1.5 * q, y: HEX * Math.sqrt(3) * (r + q / 2) }; }
  const CAT_COL = { offense: '#ff5a4d', defense: '#4db4ff', utility: '#4dd886', rare: '#ffcf4d', core: '#c9a0ff' };

  function lockedVeil(title, body) {
    return '<div class="dr-veil"><div class="dr-veil-card"><div class="dr-veil-ic">🔒</div><h3>' + title + '</h3><p>' + body + '</p>' +
      '<div class="dr-veil-lv">Level ' + lvl() + ' / ' + UNLOCK_LEVEL + '</div>' +
      '<div class="dr-veil-bar"><i style="width:' + clamp(lvl() / UNLOCK_LEVEL * 100, 0, 100) + '%"></i></div></div></div>';
  }

  // ---------- PILOT SCREEN ----------
  function renderPilot() {
    const body = $('pilot-body'); if (!body) return;
    const sub = $('pilot-sub'); if (sub) sub.textContent = lvl() >= UNLOCK_LEVEL ? ('◇ ' + fmt(cores()) + ' Dread Cores') : ('Unlocks at Lv ' + UNLOCK_LEVEL);
    if (lvl() < UNLOCK_LEVEL) {
      body.innerHTML = lockedVeil('Pilot Progression', 'Reach <b>Level ' + UNLOCK_LEVEL + '</b> to attain elite status. Dreadnaughts will begin appearing across the galaxy, and the Pilot Tree will open.');
      return;
    }
    maybeTutorial();
    const score = pilotScore(), rank = rankFor(score);
    const affN = _view === 'map' ? affordableNodes().length : 0;

    body.innerHTML =
      '<div class="pl-hero">' +
        '<span class="pl-hero-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11a7 7 0 0 1 14 0v1.5a3.5 3.5 0 0 1-3.5 3.5h-7A3.5 3.5 0 0 1 5 12.5z"/><rect x="8" y="8.5" width="8" height="5.5" rx="2.75" fill="currentColor" fill-opacity="0.18"/><path d="M19 10.5h1.4a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H19"/><path d="M9.5 17.2 9 21h6l-.5-3.8"/></svg></span>' +
        '<span class="pl-hero-rank">' + rank + '</span>' +
        '<span class="pl-hero-score"><b>' + fmt(score) + '</b> Score</span>' +
        '<button class="pl-hunt-mini" id="pl-hunt-btn">☄ Hunt</button>' +
      '</div>' +
      bonusStrip() +
      '<div class="pl-treewrap' + (_view === 'list' ? ' listing' : '') + '">' +
        '<div class="pl-treebar">' +
          '<span class="pl-treetitle">⬡ Pilot Tree</span>' +
          '<div class="pl-filters">' + ['offense', 'defense', 'utility', 'rare'].map((c) =>
            '<button class="pl-fchip ' + c + (_filter === c ? ' on' : '') + '" data-filter="' + c + '"><i style="background:' + CAT_COL[c] + '"></i>' + c[0].toUpperCase() + c.slice(1) + '</button>').join('') +
          '</div>' +
          viewBtnHTML() +
        '</div>' +
        (_view === 'map'
          ? '<div class="pl-mapwrap">' +
              '<canvas id="pl-tree" class="pl-tree"></canvas>' +
              // ON-CANVAS CONTROLS. These used to be three 28px pills at the far
              // end of the filter bar — seven controls of equal weight in one row,
              // where the two that MOVE THE MAP read as two more filters. They
              // belong on the thing they move, at a size a thumb can hit.
              //
              // ⌘ FRONTIER is new and is the one that matters: the map's job is
              // spending cores, and the nodes you can afford are routinely off
              // screen with nothing to say which way to drag. It carries the count
              // and walks them, nearest first.
              '<div class="pl-mapctl">' +
                '<button id="pl-zin" aria-label="Zoom in">+</button>' +
                '<button id="pl-zout" aria-label="Zoom out">−</button>' +
                '<button id="pl-frontier" class="pl-frontier' + (affN ? ' hot' : '') + '" aria-label="Go to the next node you can afford">⌖' + (affN ? '<i>' + affN + '</i>' : '') + '</button>' +
                '<button id="pl-recenter" aria-label="Back to Pilot Core">⊙</button>' +
              '</div>' +
            '</div>' +
            '<div class="pl-hint">Drag to explore · pinch or scroll to zoom · tap a node to inspect</div>'
          : listHTML()) +
      '</div>' +
      // NO DETAIL CARD IN LIST VIEW. Every row already carries the node's name,
      // its effects, ring depth, Pilot Score and its own working unlock button —
      // the card would repeat all of it. It also cost the list the vertical space
      // it exists to use: .scr-body on this screen does not scroll, so a pinned
      // card below a fill pane pushes itself off the bottom of the clip box.
      (_view === 'map' ? '<div class="pl-detail" id="pl-detail"></div>' : '') +
      coachBlock();

    // wire
    $('pl-hunt-btn').addEventListener('click', openHuntScreen);
    body.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    if (_view === 'map') {
      $('pl-recenter').addEventListener('click', () => { stopFling(); pan = { x: 0, y: 0 }; zoom = 1; _grad.clear(); fitTree(); requestDraw(); });
      const zBtn = (f) => { stopFling(); const nz = Math.max(0.35, Math.min(1.8, zoom * f)); pan.x *= nz / zoom; pan.y *= nz / zoom; zoom = nz; _grad.clear(); _motion = Date.now(); requestDraw(); };
      $('pl-zout').addEventListener('click', () => zBtn(1 / 1.3));
      $('pl-zin').addEventListener('click', () => zBtn(1.3));
      $('pl-frontier').addEventListener('click', gotoFrontier);
    }
    body.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { _filter = _filter === b.dataset.filter ? null : b.dataset.filter; renderPilot(); }));
    body.querySelectorAll('[data-coach]').forEach((b) => b.addEventListener('click', () => { _coachOpen = !_coachOpen; renderPilot(); }));
    if (_view === 'map') { setupTree(); renderDetail(); } else wireList();
  }

  function bonusStrip() {
    const chips = bonusList();
    if (!chips.length) return '<div class="pl-bonuses empty">No bonuses yet — unlock your first node below.</div>';
    return '<div class="pl-bonuses">' + chips.map((c) =>
      '<span class="pl-bchip"><b>+' + (Math.round(c.value * 10) / 10) + c.unit + '</b> ' + c.label + '</span>').join('') + '</div>';
  }

  // ---- LIST VIEW -----------------------------------------------------------
  // The same nodes the canvas draws, as rows you can search and sort. Two tabs,
  // because they answer two different questions: AVAILABLE is "what can I buy"
  // (the only actionable set, affordable ones first), OWNED is "what am I already
  // running". Undiscovered nodes are deliberately absent — the fog is a real rule
  // of the tree, and a list that showed `?` rows would just be the canvas again
  // with worse spatial information.
  const escA = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  function listNodes() {
    const vis = visibleSet(), avail = [], owned = [];
    Object.keys(vis).forEach((k) => {
      const [q, r] = parseKey(k);
      const d = nodeDef(q, r);
      d.key = k;
      if (isUnlocked(k)) { if (!d.core) owned.push(d); }
      else if (isUnlockable(q, r)) avail.push(d);
    });
    const afford = (d) => cores() >= d.cost;
    avail.sort((a, b) => (afford(b) - afford(a)) || (a.cost - b.cost) || (b.score - a.score));
    owned.sort((a, b) => ((a.ring | 0) - (b.ring | 0)) || a.label.localeCompare(b.label));
    return { avail, owned };
  }
  function effSummary(d) {
    const parts = [];
    if (d.bonus) for (const k in d.bonus) parts.push('+' + (Math.round(d.bonus[k] * 10) / 10) + (k === 'regen' ? '%/s' : '%') + ' ' + effLabel(k));
    if (d.special === 'coreLuck') parts.push('✦ bonus Dread Core chance');
    return parts.join(' · ') || '—';
  }
  function matches(d) {
    // THE RARE CHIP FILTERS ON THE FLAG, NOT THE CATEGORY. A legendary node keeps
    // its own combat category (offense/defense/utility) and carries `rare: true`
    // separately — so `cat === 'rare'` matched almost nothing, and the one chip a
    // player taps to find their legendaries returned an empty list.
    if (_filter === 'rare') { if (!d.rare && d.cat !== 'rare') return false; }
    else if (_filter && d.cat !== _filter) return false;
    if (!_q) return true;
    // THE SEARCHABLE TEXT MUST INCLUDE WHAT THE ROW ACTUALLY SAYS. A legendary
    // node renders a LEGENDARY badge, so "legendary" is the obvious thing to
    // type — and it matched nothing, because the haystack was only the label,
    // the category and the stat line. Anything printed on the row is searchable.
    const hay = (d.label + ' ' + d.cat + ' ' + (d.rare ? 'legendary rare ' : '') + effSummary(d)).toLowerCase();
    return hay.indexOf(_q.toLowerCase()) !== -1;
  }
  const LIST_CAP = 80;
  function listRowsHTML() {
    const sets = listNodes();
    const all = _listTab === 'owned' ? sets.owned : sets.avail;
    const rows = all.filter(matches);
    if (!rows.length) {
      const why = _q ? 'Nothing matches “' + escA(_q) + '”.'
        : _filter ? 'No ' + _filter + ' nodes in this list.'
        : _listTab === 'owned' ? 'No nodes unlocked yet — your first one is waiting on the Available tab.'
        : 'Nothing available. Unlock an adjacent node to open the next ring.';
      return '<div class="pl-lempty">' + why + '</div>';
    }
    const shown = rows.slice(0, LIST_CAP);
    let out = shown.map((d) => {
      const col = CAT_COL[d.cat] || '#8aa';
      const own = _listTab === 'owned';
      const can = !own && cores() >= d.cost;
      const act = own
        ? '<span class="pl-ldone">✓</span>'
        : '<button class="pl-lgo' + (can ? '' : ' cant') + '" data-unlock="' + d.key + '">◇ ' + d.cost + '</button>';
      return '<div class="pl-lrow' + (_selected === d.key ? ' on' : '') + (own ? ' own' : '') + '" data-node="' + d.key + '" tabindex="0" role="button" style="--c:' + col + '">' +
        '<span class="pl-lic">' + catGlyph(d) + '</span>' +
        '<span class="pl-lmain">' +
          '<span class="pl-ln">' + escA(d.label) + (d.rare ? ' <em>LEGENDARY</em>' : '') + '</span>' +
          '<span class="pl-lb">' + escA(effSummary(d)) + '</span>' +
        '</span>' +
        '<span class="pl-lmeta"><i>RING ' + (d.ring | 0) + '</i><b>+' + (d.score | 0) + '</b></span>' +
        act +
      '</div>';
    }).join('');
    if (rows.length > shown.length) out += '<div class="pl-lmore">Showing ' + shown.length + ' of ' + rows.length + ' — search or filter to narrow.</div>';
    return out;
  }
  function listHTML() {
    const sets = listNodes();
    const nAv = sets.avail.filter(matches).length, nOw = sets.owned.length;
    const affordable = sets.avail.filter((d) => cores() >= d.cost).length;
    return '<div class="pl-list">' +
      '<div class="pl-lbar">' +
        '<input id="pl-search" class="pl-search" type="search" autocomplete="off" placeholder="Search nodes, stats…" value="' + escA(_q) + '">' +
        '<div class="pl-ltabs">' +
          '<button class="pl-lt' + (_listTab === 'avail' ? ' on' : '') + '" data-ltab="avail">Available · ' + nAv + '</button>' +
          '<button class="pl-lt' + (_listTab === 'owned' ? ' on' : '') + '" data-ltab="owned">Owned · ' + nOw + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="pl-lnote">◇ <b>' + fmt(cores()) + '</b> Dread Cores · ' + (affordable
          ? '<b>' + affordable + '</b> node' + (affordable === 1 ? '' : 's') + ' you can afford right now'
          : 'not enough for anything on the frontier — clear a Dreadnaught') + '</div>' +
      '<div class="pl-lrows" id="pl-lrows">' + listRowsHTML() + '</div>' +
    '</div>';
  }
  function repaintRows() { const h = $('pl-lrows'); if (h) h.innerHTML = listRowsHTML(); wireRows(); }
  function wireRows() {
    const h = $('pl-lrows'); if (!h) return;
    h.querySelectorAll('[data-unlock]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const [q, r] = parseKey(b.dataset.unlock);
      const d = nodeDef(q, r);
      if (unlock(q, r)) { _aggDirty = true; _selected = b.dataset.unlock; banner('NODE UNLOCKED', d.label, CAT_COL[d.cat]); renderPilot(); }
      else toast('Need ◇ ' + (d.cost - cores()) + ' more Dread Cores');
    }));
    const sel = (el) => { _selected = el.dataset.node; repaintRows(); };
    h.querySelectorAll('[data-node]').forEach((el) => {
      el.addEventListener('click', () => sel(el));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sel(el); } });
    });
  }
  function wireList() {
    // The search repaints ONLY the rows. Re-rendering the whole screen on every
    // keystroke would rebuild the input and throw away focus and caret position.
    const s = $('pl-search');
    if (s) s.addEventListener('input', () => {
      _q = s.value || '';
      repaintRows();
      const t = document.querySelector('[data-ltab="avail"]');
      if (t) t.textContent = 'Available · ' + listNodes().avail.filter(matches).length;
    });
    document.querySelectorAll('[data-ltab]').forEach((b) => b.addEventListener('click', () => {
      _listTab = b.dataset.ltab;
      document.querySelectorAll('[data-ltab]').forEach((x) => x.classList.toggle('on', x === b));
      repaintRows();
    }));
    wireRows();
  }

  // ---- tree canvas ----
  function setupTree() {
    _treeCanvas = $('pl-tree'); if (!_treeCanvas) return;
    _treeCtx = _treeCanvas.getContext('2d');
    fitTree();
    // ---- pointer pan + tap --------------------------------------------------
    // ONE PAINT PER FRAME. Every one of these handlers used to call drawTree()
    // synchronously, so a 120Hz trackpad or a fast thumb drew the whole tree two
    // or three times per displayed frame — work thrown away before the compositor
    // ever saw it. Everything now marks the map dirty and the rAF coalesces it.
    const dn = (x, y) => { stopFling(); _panActive = true; _panMoved = false; _vel = { x: 0, y: 0 }; _velT = 0; _panStart = { x, y, px: pan.x, py: pan.y }; };
    const mv = (x, y) => {
      if (!_panActive) return;
      const dx = x - _panStart.x, dy = y - _panStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 5) _panMoved = true;
      const nx = _panStart.px + dx, ny = _panStart.py + dy, t = (window.performance && performance.now()) || Date.now();
      if (_velT) { const dt = Math.max(8, t - _velT); _vel.x = (nx - pan.x) / dt; _vel.y = (ny - pan.y) / dt; }
      _velT = t; pan.x = nx; pan.y = ny; _motion = Date.now(); requestDraw();
    };
    const up = (x, y) => {
      if (!_panActive) return;
      _panActive = false;
      if (!_panMoved) { tapTree(x, y); return; }
      // INERTIA. A drag that ended mid-flick used to stop dead on the pixel the
      // finger left, which is most of what "doesn't feel smooth" is.
      if (Math.hypot(_vel.x, _vel.y) > 0.05) fling();
      else requestDraw();                       // one full-quality frame back
    };
    // ZOOM — wheel (desktop) + pinch (touch), anchored on the cursor / pinch midpoint
    const applyZoom = (nz, cx, cy) => {
      nz = Math.max(0.35, Math.min(1.8, nz));
      if (nz === zoom) return;
      const W = _treeCanvas._w, H = _treeCanvas._h;
      const wx = (cx - W / 2 - pan.x) / zoom, wy = (cy - H / 2 - pan.y) / zoom;
      zoom = nz; pan.x = cx - W / 2 - wx * zoom; pan.y = cy - H / 2 - wy * zoom;
      _grad.clear();                            // hex radius moved: cached gradients are stale
      _motion = Date.now(); requestDraw();
    };
    _treeCanvas.addEventListener('mousedown', (e) => dn(e.offsetX, e.offsetY));
    // HOVER — desktop only, and only ever a rim highlight + a cursor. A node the
    // pointer is over is the one thing the map could never tell you without a tap.
    _treeCanvas.addEventListener('mousemove', (e) => {
      if (_panActive) return;
      const h = nodeAt(e.offsetX, e.offsetY);
      const k = h ? h.k : null;
      if (k !== _hover) { _hover = k; _treeCanvas.style.cursor = k ? 'pointer' : 'grab'; requestDraw(); }
    });
    _treeCanvas.addEventListener('mouseleave', () => { if (_hover) { _hover = null; requestDraw(); } });
    _treeCanvas.addEventListener('touchstart', (e) => { const t = e.touches[0], r = rect(); dn(t.clientX - r.left, t.clientY - r.top); }, { passive: true });
    _treeCanvas.addEventListener('touchmove', (e) => { const t = e.touches[0], r = rect(); mv(t.clientX - r.left, t.clientY - r.top); e.preventDefault(); }, { passive: false });
    _treeCanvas.addEventListener('touchend', (e) => { const t = (e.changedTouches && e.changedTouches[0]) || {}, r = rect(); up((t.clientX || 0) - r.left, (t.clientY || 0) - r.top); });
    _treeCanvas.addEventListener('wheel', (e) => { e.preventDefault(); const r = rect(); applyZoom(zoom * (e.deltaY < 0 ? 1.12 : 0.89), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    let _pinch = null;
    const pinchInfo = (e, r) => { const a = e.touches[0], b = e.touches[1]; return { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), x: (a.clientX + b.clientX) / 2 - r.left, y: (a.clientY + b.clientY) / 2 - r.top }; };
    _treeCanvas.addEventListener('touchstart', (e) => { if (e.touches.length === 2) { _panActive = false; stopFling(); _pinch = pinchInfo(e, rect()); _pinch.z0 = zoom; } }, { passive: true });
    _treeCanvas.addEventListener('touchmove', (e) => { if (_pinch && e.touches.length === 2) { const p = pinchInfo(e, rect()); applyZoom(_pinch.z0 * (p.d / _pinch.d), p.x, p.y); e.preventDefault(); } }, { passive: false });
    _treeCanvas.addEventListener('touchend', (e) => { if (e.touches.length < 2) { _pinch = null; requestDraw(); } });
    // WINDOW-LEVEL LISTENERS ARE BOUND ONCE, EVER. setupTree() runs on every
    // render of the Pilot screen, and a mousemove/mouseup pair was being added to
    // `window` each time — so the twentieth visit had twenty handlers, each doing
    // a forced-layout getBoundingClientRect on drag. The canvas ones go with the
    // canvas (innerHTML replaces it); these do not.
    if (!setupTree._winBound) {
      setupTree._winBound = true;
      window.addEventListener('mousemove', (e) => { if (_panActive) { const r = rect(); mv(e.clientX - r.left, e.clientY - r.top); } });
      window.addEventListener('mouseup', (e) => { if (_panActive) { const r = rect(); up(e.clientX - r.left, e.clientY - r.top); } });
      window.addEventListener('resize', () => { _rect = null; if (_treeCanvas && document.getElementById('pl-tree') === _treeCanvas) { fitTree(); requestDraw(); } });
    }
    setupTree._mv = mv; setupTree._up = up;
    // re-fit once flex layout settles so the canvas always fills the space left
    // by the pinned hero/detail rows (no scroll).
    requestAnimationFrame(() => { fitTree(); requestDraw(); });
    requestDraw();
  }
  // The canvas cannot move during a drag (it is an overlay screen), so its rect
  // is measured once per gesture instead of on every pointer event — each of
  // those reads forced a layout flush mid-drag.
  let _rect = null;
  function rect() {
    if (!_rect && _treeCanvas) _rect = _treeCanvas.getBoundingClientRect();
    return _rect || { left: 0, top: 0 };
  }
  let _drawRAF = 0, _motion = 0, _hover = null;
  let _vel = { x: 0, y: 0 }, _velT = 0, _flingRAF = 0;
  function requestDraw() { if (_drawRAF) return; _drawRAF = requestAnimationFrame(() => { _drawRAF = 0; drawTree(); }); }
  function stopFling() { if (_flingRAF) { cancelAnimationFrame(_flingRAF); _flingRAF = 0; } }
  function fling() {
    stopFling();
    const step = () => {
      _flingRAF = 0;
      if (!treeLive()) return;
      pan.x += _vel.x * 16; pan.y += _vel.y * 16;
      _vel.x *= 0.92; _vel.y *= 0.92;
      _motion = Date.now(); requestDraw();
      if (Math.hypot(_vel.x, _vel.y) > 0.02) _flingRAF = requestAnimationFrame(step);
      else requestDraw();                       // settle at full quality
    };
    _flingRAF = requestAnimationFrame(step);
  }
  function treeLive() {
    const sp = document.getElementById('screen-pilot');
    return !!(_treeCanvas && document.getElementById('pl-tree') === _treeCanvas && sp && sp.classList.contains('active'));
  }
  // ⌘ FRONTIER — pan to the next node the pilot can actually afford, nearest to
  // the core first, cycling on repeat taps. Answering "where do I spend this"
  // was the map's worst failure: the affordable nodes are usually off screen and
  // nothing pointed at them.
  let _frontierI = 0;
  let _affCache = null, _affRef = null, _affC = -1;
  function affordableNodes() {
    const sc = scene(), c = cores();
    if (_affCache && _affRef === sc && _affC === c) return _affCache;
    _affCache = sc.list.filter((n) => n.avail && !n.d.core && c >= n.d.cost)
      .sort((a, b) => (axialDist(a.q, a.r) - axialDist(b.q, b.r)) || (a.d.cost - b.d.cost));
    _affRef = sc; _affC = c;
    return _affCache;
  }
  function gotoFrontier() {
    const list = affordableNodes();
    if (!list.length) { toast('No node you can afford yet — clear a Dreadnaught for cores'); return; }
    stopFling();
    const n = list[_frontierI % list.length]; _frontierI++;
    if (zoom < 0.9) { zoom = 1; _grad.clear(); }
    pan.x = -n.cx * zoom; pan.y = -n.cy * zoom;
    _selected = n.k; renderDetail();
    requestAnimationFrame(() => { fitTree(); requestDraw(); });
    requestDraw();
  }
  function fitTree() {
    if (!_treeCanvas) return;
    _rect = null;
    const w = _treeCanvas.clientWidth || 320;
    let h = _treeCanvas.clientHeight;
    if (!h || h < 120) h = 260;                 // fallback before flex layout settles
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    _treeCanvas.width = Math.round(w * dpr); _treeCanvas.height = Math.round(h * dpr);
    _treeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    _treeCanvas._w = w; _treeCanvas._h = h;
  }
  function hexPath(ctx, cx, cy, rad) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 180 * (60 * i); const x = cx + rad * Math.cos(a), y = cy + rad * Math.sin(a); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.closePath();
  }
  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y); ctx.lineTo(x + w - rr, y); ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr); ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr); ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }
  // A chip pinned to the viewport edge, pointing at something off screen.
  function edgeMarker(ctx, W, H, tx, ty, col, glyph) {
    const cx = W / 2, cy = H / 2;
    let dx = tx - cx, dy = ty - cy;
    const L = Math.hypot(dx, dy); if (L < 1) return;
    dx /= L; dy /= L;
    const hw = Math.max(12, W / 2 - 24), hh = Math.max(12, H / 2 - 24);
    const t = Math.min(Math.abs(dx) > 1e-4 ? hw / Math.abs(dx) : 1e9, Math.abs(dy) > 1e-4 ? hh / Math.abs(dy) : 1e9);
    const mx = cx + dx * t, my = cy + dy * t, ang = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(mx, my);
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, 7);
    ctx.fillStyle = 'rgba(11,15,24,0.92)'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = col; ctx.stroke();
    ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(14.5, 0); ctx.lineTo(8, -4.5); ctx.lineTo(8, 4.5); ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
    ctx.rotate(-ang);
    ctx.font = '700 12px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = col; ctx.fillText(glyph, 0, 0.5);
    ctx.restore();
  }
  function drawTree() {
    if (!_treeCtx) return;
    const ctx = _treeCtx, W = _treeCanvas._w, H = _treeCanvas._h;
    const sc = scene(), now = Date.now();
    const ox = W / 2 + pan.x, oy = H / 2 + pan.y, z = zoom;
    const rad = HEX * 0.82 * z;
    // MOTION LOD — PAINT ONLY. While the map is sliding under a thumb, the auras,
    // glows, labels and edge cues are dropped: they are the expensive half of a
    // hex and none of them can be read mid-drag. Full quality comes back on the
    // settling frame. Nothing here touches what a node is, costs or does — same
    // guarantee js/perf-tier.js makes.
    const moving = _panActive || !!_flingRAF || now - _motion < 80;
    const rich = !moving && !_gfxLow() && z > 0.45;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b0f18'; ctx.fillRect(0, 0, W, H);
    // EDGES — two batched paths (owned / not), one stroke each, instead of a
    // beginPath+stroke per edge. A 400-node tree strokes twice, not 1,200 times.
    ctx.lineWidth = 2;
    for (let pass = 0; pass < 2; pass++) {
      let any = false;
      ctx.beginPath();
      for (let i = 0; i < sc.edges.length; i++) {
        const e = sc.edges[i];
        if (e.own !== (pass === 0)) continue;
        const ax = ox + e.ax * z, ay = oy + e.ay * z, bx = ox + e.bx * z, by = oy + e.by * z;
        if ((ax < -40 && bx < -40) || (ax > W + 40 && bx > W + 40) || (ay < -40 && by < -40) || (ay > H + 40 && by > H + 40)) continue;
        ctx.moveTo(ax, ay); ctx.lineTo(bx, by); any = true;
      }
      if (any) { ctx.strokeStyle = pass === 0 ? 'rgba(255,160,90,0.5)' : 'rgba(120,140,170,0.14)'; ctx.stroke(); }
    }
    // NODES
    _hitNodes = [];
    const onAvail = [];                       // on-screen available: cost pills + names
    let coreOn = false, affOn = false;
    const wallet = cores();
    const glyphFont = '800 ' + Math.max(7, Math.round(14 * z)) + 'px Orbitron, Rajdhani, sans-serif';
    const coreFont = '800 ' + Math.max(7, Math.round(18 * z)) + 'px Orbitron, Rajdhani, sans-serif';
    let curFont = '';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < sc.list.length; i++) {
      const rec = sc.list[i];
      const x = ox + rec.cx * z, y = oy + rec.cy * z;
      if (x < -36 || x > W + 36 || y < -36 || y > H + 36) continue;
      const k = rec.k, q = rec.q, r = rec.r, d = rec.d;
      const unlocked = rec.unlocked, avail = rec.avail;
      const col = CAT_COL[d.cat] || '#8aa';
      const dim = !!_filter && (_filter === 'rare' ? !(d.rare || d.cat === 'rare') : d.cat !== _filter);
      _hitNodes.push({ k, x, y });
      if (d.core) coreOn = true;
      if (avail && !dim) {
        const afford = wallet >= d.cost;
        if (afford) affOn = true;
        onAvail.push({ d, x, y, afford });
      }
      const font = d.core ? coreFont : glyphFont;
      if (font !== curFont) { ctx.font = font; curFont = font; }
      ctx.save(); ctx.translate(x, y);

      // AURA — unlocked (filled) nodes glow in their category colour so they read
      // instantly as "owned", just like a lit galaxy tile. Empty nodes stay dark.
      // The gradient is cached and painted in node-local space: this used to build
      // a fresh radial gradient PER NODE PER FRAME, which on a large tree is most
      // of the frame. The pulse is quantised to 0.05 so the cache still hits.
      if (unlocked && !dim && rich) {
        const pul = 0.82 + 0.18 * Math.sin(now / 600 + (q * 1.7 + r));
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = gradFor(ctx, 'aura', col, rad, Math.round((d.rare ? 0.55 : 0.36) * pul * 20) / 20);
        ctx.beginPath(); ctx.arc(0, 0, rad * 2.0, 0, 7); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
      // SELECTION + HOVER. shadowBlur is the most expensive per-hex op there is,
      // so it is spent here (one or two hexes) and on legendaries, never on every
      // owned node every frame the way it was.
      if (_selected === k || _hover === k) {
        hexPath(ctx, 0, 0, HEX * 0.98 * z);
        ctx.strokeStyle = _selected === k ? '#fff' : 'rgba(255,255,255,0.6)';
        ctx.lineWidth = _selected === k ? 2.5 : 1.5;
        if (rich) { ctx.shadowColor = '#fff'; ctx.shadowBlur = 8; }
        ctx.stroke(); ctx.shadowBlur = 0;
      }
      hexPath(ctx, 0, 0, rad);
      if (unlocked) {
        ctx.fillStyle = gradFor(ctx, 'fill', col, rad, 0);
        ctx.globalAlpha = dim ? 0.35 : 1; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = shade(col, 1.5);
        if (rich && d.rare && !dim) { ctx.shadowColor = col; ctx.shadowBlur = 14; }
        ctx.stroke(); ctx.shadowBlur = 0;
      } else if (avail) {
        // empty but ready to unlock: hollow dark fill + pulsing coloured rim
        ctx.fillStyle = 'rgba(14,19,28,0.96)'; ctx.globalAlpha = dim ? 0.3 : 1; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = col;
        ctx.globalAlpha = dim ? 0.3 : (0.55 + 0.45 * (0.5 + 0.5 * Math.sin(now / 340)));
        ctx.stroke();
      } else {
        // undiscovered: barely-there dashed outline
        ctx.fillStyle = 'rgba(14,18,26,0.6)'; ctx.globalAlpha = 0.5; ctx.fill();
        ctx.setLineDash([3, 4]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(150,165,190,0.28)'; ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
      // glyph (cached on the memoised def — catGlyph() walks Object.keys)
      const glyph = d.core ? '★' : (avail || unlocked) ? (d._g || (d._g = catGlyph(d))) : '?';
      ctx.fillStyle = unlocked ? '#0b0f18' : avail ? col : 'rgba(180,195,215,0.5)';
      ctx.fillText(glyph, 0, 0.5);
      ctx.restore();
    }
    // WHAT IT IS AND WHAT IT COSTS, ON THE MAP ITSELF. Every hex was a bare glyph,
    // so the only way to learn a node was to tap it one at a time — and a node you
    // could afford looked exactly like one you could not. Available nodes now
    // carry their cost, tinted by affordability, and their name when there is room.
    // Bounded by design: only AVAILABLE nodes, only on screen, only when legible.
    if (onAvail.length && onAvail.length <= 60 && z >= 0.62 && !moving) {
      const showName = z >= 1.02 && onAvail.length <= 30;
      ctx.font = '700 ' + Math.max(9, Math.round(10.5 * Math.min(1.35, z))) + 'px Rajdhani, sans-serif';
      for (let i = 0; i < onAvail.length; i++) {
        const a = onAvail[i], py = a.y + rad + 10;
        const label = '◇ ' + a.d.cost;
        const w = ctx.measureText(label).width + 12;
        ctx.fillStyle = a.afford ? 'rgba(255,207,77,0.18)' : 'rgba(16,22,32,0.88)';
        roundRect(ctx, a.x - w / 2, py - 8, w, 16, 8); ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = a.afford ? 'rgba(255,207,77,0.8)' : 'rgba(120,135,160,0.38)'; ctx.stroke();
        ctx.fillStyle = a.afford ? '#ffe08a' : 'rgba(168,183,203,0.8)';
        ctx.fillText(label, a.x, py + 0.5);
        if (showName) { ctx.fillStyle = 'rgba(202,216,235,0.92)'; ctx.fillText(a.d.label, a.x, py + 18); }
      }
    }
    // OFF-SCREEN ORIENTATION. Two cues, each only when it is needed: which way
    // the core is, and which way the nearest node you can afford is. An unbounded
    // plane with nothing to steer by is how people got lost out in the fog.
    if (!moving) {
      if (!coreOn) edgeMarker(ctx, W, H, ox, oy, 'rgba(201,160,255,0.92)', '⊙');
      if (!affOn) {
        const aff = affordableNodes();
        if (aff.length) edgeMarker(ctx, W, H, ox + aff[0].cx * z, oy + aff[0].cy * z, '#ffcf4d', '◇');
      }
    }
    // re-draw on availability pulse
    _pulse(sc.list.length);
  }
  let _pulseRAF = 0, _pulseT = 0, _pulseIv = 66;
  // Idle "available node" pulse. Self-sustaining rAF loop, but it (a) STOPS when
  // the Pilot screen isn't the active overlay — so it never burns frames redrawing
  // an off-screen canvas — (b) throttles to the SIZE of the tree instead of a flat
  // 15fps, because a 400-node tree costs several times what a 40-node one does for
  // the same barely-visible rim pulse, and (c) goes through requestDraw() so a
  // pulse frame and a pan frame can never both paint inside one frame.
  function _pulse(n) {
    if (n != null) _pulseIv = n > 260 ? 150 : n > 120 ? 100 : 66;
    if (_pulseRAF || _panActive || _flingRAF) return;   // motion is already drawing
    _pulseRAF = requestAnimationFrame((now) => {
      _pulseRAF = 0;
      if (!treeLive()) return;                          // leave the loop until the screen re-opens
      if (now - _pulseT < _pulseIv) { _pulse(); return; }
      _pulseT = now; requestDraw();
    });
  }
  function catGlyph(d) {
    if (d.rare) return '✦';
    const k = Object.keys(d.bonus || {})[0] || '';
    const M = { dmgPct: '⚔', atkSpeedPct: '⟫', critChance: '✸', critDamage: '✸', multiShot: '≡', bossDamage: '☠', eliteDamage: '★', rangePct: '➤', hpPct: '❤', regen: '✚', dmgReduce: '⛊', lifeSteal: '⚕', lootQuality: '◈', goldFind: '$', xpGain: '▲', pickupRadius: '◎' };
    return M[k] || '◆';
  }
  // MINIMUM 22px HIT RADIUS. The old test was HEX*zoom, which at the 0.35 zoom
  // floor is a 9px target — smaller than a fingertip, so zoomed-out taps simply
  // missed and the map felt broken rather than imprecise.
  function nodeAt(x, y) {
    const R = Math.max(22, HEX * zoom * 0.95);
    let best = null, bd = R * R;
    for (let i = 0; i < _hitNodes.length; i++) {
      const n = _hitNodes[i], dx = n.x - x, dy = n.y - y, d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = n; }
    }
    return best;
  }
  function tapTree(x, y) {
    const best = nodeAt(x, y);
    if (best) {
      _selected = best.k; renderDetail();
      // the detail card can resize the flex layout → re-measure the canvas so the
      // hexes never get squished by a stale backing-store size.
      requestAnimationFrame(() => { fitTree(); requestDraw(); });
    }
  }
  function renderDetail() {
    const el = $('pl-detail'); if (!el) return;
    if (!_selected) { el.innerHTML = '<div class="pl-detail-empty">Tap a node to inspect it.</div>'; return; }
    const [q, r] = parseKey(_selected); const d = nodeDef(q, r);
    const unlocked = isUnlocked(_selected), avail = !unlocked && isUnlockable(q, r);
    const col = CAT_COL[d.cat];
    let effects = '';
    if (d.bonus) for (const k in d.bonus) effects += '<div class="pl-eff">+' + (Math.round(d.bonus[k] * 10) / 10) + (k === 'regen' ? '%/s' : '%') + ' <span>' + effLabel(k) + '</span></div>';
    if (d.special === 'coreLuck') effects += '<div class="pl-eff legendary">✦ <span>Chance for a bonus Dread Core on every hunt</span></div>';
    let action;
    if (d.core) action = '<div class="pl-act done">★ Pilot Core — always active</div>';
    else if (unlocked) action = '<div class="pl-act done">✓ Unlocked</div>';
    else if (avail) {
      const afford = cores() >= d.cost;
      action = '<button class="pl-act unlock' + (afford ? '' : ' cant') + '" id="pl-unlock">Unlock · ◇ ' + d.cost + ' Core' + (d.cost > 1 ? 's' : '') + '</button>' +
        (afford ? '' : '<div class="pl-need">Need ◇ ' + (d.cost - cores()) + ' more — clear Dreadnaughts to earn cores</div>');
    } else action = '<div class="pl-act locked">🔒 Unlock an adjacent node first</div>';
    el.innerHTML =
      '<div class="pl-detail-card" style="--nc:' + col + '">' +
        '<div class="pl-detail-h"><span class="pl-cat-dot" style="background:' + col + '"></span>' +
          '<span class="pl-detail-name">' + d.label + (d.rare ? ' <em class="pl-leg">LEGENDARY</em>' : '') + '</span>' +
          '<span class="pl-detail-cat">' + d.cat + '</span></div>' +
        '<div class="pl-effs">' + (effects || '<div class="pl-eff">—</div>') + '</div>' +
        '<div class="pl-detail-foot"><span class="pl-detail-score">+' + (d.score || 0) + ' Pilot Score</span>' + action + '</div>' +
      '</div>';
    const ub = $('pl-unlock');
    if (ub) ub.addEventListener('click', () => {
      if (unlock(q, r)) { _aggDirty = true; banner('NODE UNLOCKED', d.label, col); renderPilot(); }
      else toast('Not enough Dread Cores');
    });
  }
  function effLabel(k) {
    const M = { dmgPct: 'Weapon Damage', atkSpeedPct: 'Fire Rate', critChance: 'Critical Chance', critDamage: 'Critical Damage', multiShot: 'Multi-Fire', bossDamage: 'Boss Damage', eliteDamage: 'Elite Damage', rangePct: 'Projectile Speed', hpPct: 'Hull / Shield', regen: 'Shield Regen', dmgReduce: 'Damage Reduction', lifeSteal: 'Life Steal', moveSpeed: 'Move Speed', lootQuality: 'Loot Quality', goldFind: 'Gold Find', xpGain: 'XP Gain', pickupRadius: 'Pickup Radius' };
    return M[k] || k;
  }

  // ---- coaching ----
  const TIPS = [
    'Focus Weapon Damage and Critical Chance early to lift overall combat power.',
    'Life Steal and Shield Regen greatly boost survivability in boss fights.',
    'Utility nodes seem weak at first but compound your long-term economy.',
    'Higher-tier Dreadnaughts have better Dread Core odds — push when ready.',
    'You can plan any route — aim toward the legendary ✦ nodes that fit your build.',
    'Every Dread Core counts. Spend them to shape an elite commander.',
  ];
  let _coachOpen = false;
  function coachBlock() {
    return '<div class="pl-coach"><button class="pl-coach-h" data-coach>💡 Pilot Tips <span>' + (_coachOpen ? '▾' : '▸') + '</span></button>' +
      (_coachOpen ? '<ul class="pl-coach-l">' + TIPS.map((t) => '<li>' + t + '</li>').join('') + '</ul>' : '') + '</div>';
  }

  // ---------- DREADNAUGHT HUNT SCREEN ----------
  function openHuntScreen() { const b = document.querySelector('.nav-btn[data-screen="dread"]'); if (b) b.click(); else renderHunt(); }
  function renderHunt() {
    const body = $('dread-body'); if (!body) return;
    const sub = $('dread-sub'); if (sub) sub.textContent = lvl() >= UNLOCK_LEVEL ? ('◇ ' + fmt(cores()) + ' Dread Cores') : ('Unlocks at Lv ' + UNLOCK_LEVEL);
    if (lvl() < UNLOCK_LEVEL) {
      body.innerHTML = lockedVeil('Dreadnaught Hunt', 'Reach <b>Level ' + UNLOCK_LEVEL + '</b>. Ancient Dreadnaughts will surface across the galaxy, each holding a <b>Dread Core</b> — the only resource that upgrades your Pilot.');
      return;
    }
    const reset = weekResetMs();
    let cards = '';
    const top = Math.max(1, maxTier()) + 2;
    for (let t = 1; t <= top; t++) {
      const need = levelForTier(t);
      const open = lvl() >= need;
      const locked = isLocked(t);
      const chance = Math.round(dropChance(t) * 100);
      const spr = ((t - 1) % 6) + 1;
      let action, statusCls = '';
      if (!open) { action = '<span class="dh-lock">🔒 Lv ' + need + '</span>'; statusCls = 'soon'; }
      else if (locked) {
        const rc = respawnCost(t), afford = (G().state.gold || 0) >= rc;
        action = '<span class="dh-cd">⏱ <b data-reset="1">' + fmtDur(reset) + '</b></span>' +
          '<button class="dh-respawn" data-respawn="' + t + '"' + (afford ? '' : ' disabled') + '>⟳ Respawn · <b>$' + fmt(rc) + '</b></button>';
        statusCls = 'cooldown';
      }
      else { action = '<button class="dh-go" data-tier="' + t + '">Deploy</button>'; statusCls = 'ready'; }
      cards +=
        '<div class="dh-card ' + statusCls + '">' +
          '<div class="dh-art"><img src="ships/dread-' + spr + '.png" alt=""></div>' +
          '<div class="dh-info">' +
            '<div class="dh-name">Dreadnaught <span class="dh-tier">T' + t + '</span></div>' +
            '<div class="dh-meta">Level ' + need + ' · 30 waves → raid boss</div>' +
            '<div class="dh-drop"><i></i>◇ ' + chance + '% Dread Core drop</div>' +
          '</div>' +
          '<div class="dh-action">' + action + '</div>' +
        '</div>';
    }
    body.innerHTML =
      '<div class="dh-banner">' +
        '<div class="dh-banner-t">☄ DREADNAUGHT HUNT</div>' +
        '<div class="dh-banner-s">Weekly raids · 30 waves then a multi-phase raid boss · ONE attempt per tier per week, consumed on launch — win or lose</div>' +
        '<div class="dh-week">Weekly reset in <b data-reset="1">' + fmtDur(reset) + '</b></div>' +
      '</div>' +
      '<div class="dh-list">' + cards + '</div>' +
      '<div class="dh-foot">Dread Cores forge your <b>Pilot Tree</b> — permanent bonuses for every ship. Higher tiers drop cores more often.</div>';
    body.querySelectorAll('[data-tier]').forEach((b) => b.addEventListener('click', () => deploy(+b.dataset.tier)));
    body.querySelectorAll('[data-respawn]').forEach((b) => b.addEventListener('click', () => buyRespawn(+b.dataset.respawn)));
  }

  function fmtDur(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm';
  }

  // ---------- victory / tutorial modals ----------
  let _modal;
  function closeAllSheets() { if (_modal) { _modal.remove(); _modal = null; } }
  function showModal(html) {
    closeAllSheets();
    _modal = document.createElement('div'); _modal.className = 'dr-modal';
    _modal.innerHTML = '<div class="dr-modal-back"></div><div class="dr-modal-card">' + html + '</div>';
    ($('app') || document.body).appendChild(_modal);
    _modal.querySelector('.dr-modal-back').addEventListener('click', closeAllSheets);
    return _modal;
  }
  function maybeTutorial() {
    if (lvl() < UNLOCK_LEVEL) return;
    const st = G().state; if (st.pilotSeen) return; st.pilotSeen = true; try { G().save(); } catch (e) {}
    showModal(
      '<div class="drm-ic">☄</div>' +
      '<h2 class="drm-h">Your Pilot has reached elite status</h2>' +
      '<p class="drm-p">Dreadnaughts have begun appearing throughout the galaxy. These ancient warships hold powerful <b>Dread Cores</b> — the only resource that permanently improves your Pilot.</p>' +
      '<p class="drm-p">Defeat Dreadnaughts, collect Dread Cores, and forge your own path through the <b>Pilot Tree</b>.</p>' +
      '<p class="drm-note">Pilot upgrades apply to <b>every ship you own</b> — past, present and future.</p>' +
      '<button class="drm-ok" id="drm-ok">Begin</button>'
    );
    const ok = $('drm-ok'); if (ok) ok.addEventListener('click', closeAllSheets);
  }
  function victory(t, got, firstEver) {
    const spr = ((t - 1) % 6) + 1;
    showModal(
      '<div class="drm-victory">' +
      '<div class="drm-vart"><img src="ships/dread-' + spr + '.png" alt=""></div>' +
      '<div class="drm-vkill">DREADNAUGHT DESTROYED</div>' +
      '<div class="drm-vtier">Tier ' + t + ' · Level ' + levelForTier(t) + '</div>' +
      (got > 0
        ? '<div class="drm-core ' + (got > 1 ? 'dbl' : '') + '">◇ +' + got + ' Dread Core' + (got > 1 ? 's' : '') + (firstEver ? ' <em>· first kill bonus</em>' : '') + '</div>'
        : '<div class="drm-nocore">No Dread Core this run — better odds at higher tiers</div>') +
      '<div class="drm-vsub">This tier is now on weekly cooldown. Spend cores in the <b>Pilot Tree</b>.</div>' +
      '<div class="drm-vbtns"><button class="drm-ok" id="drm-tree">Open Pilot Tree</button><button class="drm-ghost" id="drm-close">Close</button></div>' +
      '</div>'
    );
    const tb = $('drm-tree'); if (tb) tb.addEventListener('click', () => { closeAllSheets(); const b = document.querySelector('.nav-btn[data-screen="pilot"]'); if (b) b.click(); else { const h = document.querySelector('.nav-btn[data-screen="hero"]'); if (h) h.click(); } });
    const cb = $('drm-close'); if (cb) cb.addEventListener('click', () => { closeAllSheets(); const b = document.querySelector('.nav-btn[data-screen="dread"]'); if (b) b.click(); });
  }

  // =========================================================================
  // STYLES
  // =========================================================================
  function injectCSS() {
    if ($('dread-css')) return;
    const s = document.createElement('style'); s.id = 'dread-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  // =========================================================================
  // BOOT
  // =========================================================================
  function boot() {
    injectCSS();
    // live timers + hud refresh
    setInterval(() => {
      try {
        updateHud();
        const onDread = $('screen-dread') && $('screen-dread').classList.contains('active');
        if (onDread) document.querySelectorAll('[data-reset]').forEach((e) => { e.textContent = fmtDur(weekResetMs()); });
      } catch (e) {}
    }, 1000);
    // recompute aggregate if a save loaded fresh nodes
    _aggDirty = true;
    // Fold saved pilot nodes into combat stats once the engine is ready — the
    // DREAD module boots after GAME.init(), so the first score render otherwise
    // omits the pilot bonuses until the next stat recompute.
    setTimeout(() => { try { if (window.GAME && window.GAME.refreshStats && Object.keys(nodes()).length) { window.GAME.refreshStats(); if (window.UI) window.UI.refreshAll(); } } catch (e) {} }, 700);
    setTimeout(updateHud, 600);
  }

  // shade helper (hex → lighter/darker)
  function rgba(hex, a) {
    if (hex[0] !== '#' || hex.length < 7) return hex;
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function shade(hex, f) {
    if (hex[0] !== '#' || hex.length < 7) return hex;
    let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    r = clamp(Math.round(r * f), 0, 255); g = clamp(Math.round(g * f), 0, 255); b = clamp(Math.round(b * f), 0, 255);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  window.DREAD = {
    // MERGE PRICING (js/account.js). A charged union has to know what a node
    // cost, and nodeDef() is pure and deterministic — hash to seeded rng — so
    // this is a safe public read with no state behind it.
    nodeCost: (k) => { try { const p = parseKey(k); return nodeDef(p[0], p[1]).cost | 0; } catch (e) { return 1; } },
    // engine hooks
    combatMods, mult, dmgVs, tick, render, onHuntCleared, proAttempt,
    // ui
    renderPilot, renderHunt, updateHud, deploy,
    // cache control — any caller that swaps state.pilot wholesale calls this.
    // Dropping the ref too forces a genuine rebuild, and the stat recompute
    // means the new tree is folded into live combat numbers immediately.
    refresh: () => {
      _aggDirty = true; _aggRef = null; _aggN = -1;
      try { G() && G().refreshStats && G().refreshStats(); } catch (e) {}
    },
    // bonus readout — shared by the Pilot screen strip and the Pilot Skills page
    bonuses: ensureAgg, bonusList, nodeCount, unlockLevel: UNLOCK_LEVEL,
    // helpers / debug
    pilotScore, rankFor, canHunt, levelForTier, _dbg: { nodeDef, ensureAgg, unlock },
  };

  // ---- CSS string ----------------------------------------------------------
  const CSS = `
  /* Dread Core wallet chip */
  #hud-dread .rg{ color:${ACCENT}; }
  /* Command cards */
  .mega-card.cmd-dread{ background:linear-gradient(180deg,#1d0e13,#140a0e); }
  .mega-card.cmd-dread .mc-ic{ color:#ff5a68; border-color:rgba(255,58,74,.45); background:radial-gradient(120% 120% at 50% 0%,#2a1218,#140a0e); box-shadow:0 0 14px -3px rgba(255,58,74,.7); }
  .mega-card.cmd-dread .mc-n{ color:#ffd0d4; }
  .mega-card.cmd-dread::before{ background:linear-gradient(130deg,#ff5168,#ff8a3c,#ffd450,#ff5168); background-size:250% 250%; }
  .mega-card.cmd-pilot .mc-ic{ color:#ff8a94; border-color:rgba(255,58,74,.35); }
  /* My Galaxy — the flagship Command card: always top, larger, with a live aura */
  .mega-card.cmd-galaxy{ grid-column:1 / -1; background:linear-gradient(180deg,#13263a,#0c1726); padding:16px 16px; min-height:84px; border-color:rgba(95,209,255,.6); box-shadow:0 0 26px -4px rgba(95,209,255,.5), 0 0 0 1px rgba(95,209,255,.25) inset; animation:galaxyAura 3.2s ease-in-out infinite; }
  @keyframes galaxyAura{ 0%,100%{ box-shadow:0 0 22px -6px rgba(95,209,255,.42), 0 0 0 1px rgba(95,209,255,.22) inset; } 50%{ box-shadow:0 0 38px 0 rgba(95,209,255,.78), 0 0 0 1px rgba(95,209,255,.4) inset; } }
  .mega-card.cmd-galaxy .mc-ic{ width:50px; height:50px; color:#7fe0ff; border-color:rgba(95,209,255,.6); background:radial-gradient(120% 120% at 50% 0%,#1a3450,#0c1726); box-shadow:0 0 22px -2px rgba(95,209,255,.85); }
  .mega-card.cmd-galaxy .mc-ic svg{ width:26px; height:26px; }
  .mega-card.cmd-galaxy .mc-n{ color:#dff3ff; font-size:17px; }
  .mega-card.cmd-galaxy .mc-s{ color:#9fcbe6; }
  .mega-card.cmd-galaxy::before{ background:linear-gradient(130deg,#5fd1ff,#7b9bff,#46d27a,#5fd1ff); background-size:260% 260%; opacity:.5; }
  @media (prefers-reduced-motion:reduce){ .mega-card.cmd-galaxy{ animation:none; } }
  /* DREAD-class ship cards (Hangar ▸ Ships) */
  .apex-chip.dread{ background:linear-gradient(90deg,#ff3a4a,#ff8a3c); color:#fff; }
  .ship-card.dread{ border-color:rgba(255,58,74,.4)!important; box-shadow:0 0 22px -10px rgba(255,58,74,.6); }
  .ship-btn.dreadbuy{ background:linear-gradient(180deg,#ff4a5a,#d8202f)!important; color:#fff!important; border:none!important; box-shadow:0 5px 14px -6px ${ACCENT}; }
  .ship-btn.dreadbuy:active{ transform:scale(.95); }
  .mega-cost{ display:inline-flex; flex-wrap:wrap; gap:5px 8px; align-items:center; }
  .mega-cost.big{ font-size:13px; }
  .mega-c{ font-variant-numeric:tabular-nums; font-weight:800; color:#dbe5f2; white-space:nowrap; }
  #cmd-dread-badge{ position:absolute; top:6px; right:8px; min-width:16px; height:16px; padding:0 4px; border-radius:8px; background:${ACCENT}; color:#fff; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:10px; line-height:16px; text-align:center; box-shadow:0 0 8px ${ACCENT}; z-index:2; }
  /* in-world banner */
  #dread-banner{ position:absolute; left:0; right:0; top:30%; z-index:14; display:flex; flex-direction:column; align-items:center; pointer-events:none; opacity:0; transform:translateY(-8px); }
  #dread-banner.show{ animation:dbIn 2.6s ease forwards; }
  @keyframes dbIn{ 0%{opacity:0;transform:translateY(-8px) scale(.96);} 10%{opacity:1;transform:none;} 80%{opacity:1;} 100%{opacity:0;} }
  #dread-banner .db-t{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:22px; letter-spacing:.14em; color:#fff; text-shadow:0 0 18px var(--dbc), 0 2px 10px #000; }
  #dread-banner .db-s{ font-family:'Rajdhani',sans-serif; font-weight:600; font-size:12.5px; letter-spacing:.05em; color:var(--dbc); margin-top:4px; text-shadow:0 1px 6px #000; }

  /* ===== PILOT SCREEN ===== */
  /* THIS BODY SCROLLS. It used to declare height:100% + overflow:hidden, which
     overrode the base .scr-body overflow-y:auto every other screen uses — so on
     a short window (a ~450px-tall landscape browser, a split-screen tablet) the
     fill pane below took the remaining height and pushed .pl-detail and
     .pl-coach past the clip edge with NO WAY TO SCROLL TO THEM. .pl-detail
     carries the Unlock button, so tapping a node on the canvas produced an
     action the player could not reach. That is exactly what the fit contract in
     CLAUDE.md forbids: a short viewport must SCROLL, never crush.
     min-height:0 stays — it is what lets this flex child shrink so the scroll
     actually engages. */
  #pilot-body{ padding:10px 12px; display:flex; flex-direction:column; gap:9px; min-height:0; overflow-y:auto; overflow-x:hidden; }
  #dread-body{ padding:12px; }
  /* thin pilot bar */
  .pl-hero{ display:flex; align-items:center; gap:10px; flex:none; background:linear-gradient(90deg,#1a1016,#140b12);
    border:1px solid #3a2030; border-radius:11px; padding:6px 10px; box-shadow:0 0 18px -10px rgba(255,58,74,.6); }
  .pl-hero-ic{ width:28px; height:28px; flex:none; border-radius:8px; color:#ff9aa2;
    background:radial-gradient(120% 120% at 50% 0%,#241626,#120b14); border:1px solid #ff3a4a55; display:grid; place-items:center; }
  .pl-hero-ic svg{ width:19px; height:19px; }
  .pl-hero-rank{ font-family:'Orbitron',sans-serif; font-weight:700; font-size:11.5px; letter-spacing:.06em; color:#ffd0d4; text-transform:uppercase; white-space:nowrap; }
  .pl-hero-score{ font-size:12px; color:#9fb0c4; white-space:nowrap; }
  .pl-hero-score b{ color:#fff; font-family:'Orbitron',sans-serif; font-weight:800; font-size:14px; margin-right:2px; }
  .pl-hunt-mini{ margin-left:auto; flex:none; display:inline-flex; align-items:center; gap:6px; white-space:nowrap;
    border:1px solid #ff3a4a66; border-radius:9px; background:linear-gradient(180deg,#2a0f16,#1a0a10); color:#ff8a94;
    font-family:'Rajdhani',sans-serif; font-weight:700; font-size:12px; padding:6px 11px; cursor:pointer; }
  .pl-hunt-mini:active{ transform:scale(.96); }

  .pl-bonuses{ display:flex; flex-wrap:nowrap; gap:5px; margin:0; flex:none; overflow-x:auto; overflow-y:hidden; padding-bottom:2px; scrollbar-width:none; -webkit-overflow-scrolling:touch; }
  .pl-bonuses::-webkit-scrollbar{ display:none; }
  .pl-bchip{ flex:none; }
  .pl-bonuses.empty{ font-size:12px; color:#8a93a6; padding:8px 2px; }
  .pl-bchip{ font-size:11px; color:#cdd7e6; background:#141b27; border:1px solid #25303f; border-radius:8px; padding:3px 8px; }
  .pl-bchip b{ color:#ffd24d; font-weight:800; }

  .pl-treewrap{ background:#0b0f18; border:1px solid #222c3a; border-radius:14px; overflow:hidden; flex:1 1 auto; min-height:150px; display:flex; flex-direction:column; }
  .pl-treebar{ display:flex; align-items:center; gap:8px; padding:9px 10px; border-bottom:1px solid #1c2530; background:linear-gradient(180deg,#131a26,#0e131d); flex-wrap:wrap; }
  .pl-treetitle{ font-family:'Orbitron',sans-serif; font-weight:700; font-size:11px; letter-spacing:.1em; color:#ffd0d4; text-transform:uppercase; }
  .pl-filters{ display:flex; gap:4px; flex:1; flex-wrap:wrap; }
  .pl-fchip{ display:inline-flex; align-items:center; gap:4px; font-size:10px; font-weight:700; color:#9fb0c4; background:#121a26; border:1px solid #25303f; border-radius:20px; padding:3px 8px; cursor:pointer; text-transform:capitalize; }
  .pl-fchip i{ width:7px; height:7px; border-radius:50%; display:block; }
  .pl-fchip.on{ color:#fff; border-color:#4a5a70; box-shadow:0 0 0 1px rgba(255,255,255,.1) inset; }
  .pl-recenter{ width:28px; height:28px; flex:none; border-radius:8px; border:1px solid #2a3545; background:#121a26; color:#bcd; font-size:15px; cursor:pointer; }
  .pl-recenter:active{ transform:scale(.92); }
  .pl-tree{ display:block; width:100%; flex:1 1 auto; min-height:0; touch-action:none; cursor:grab; }
  .pl-tree:active{ cursor:grabbing; }
  .pl-mapwrap{ position:relative; display:flex; flex:1 1 auto; min-height:0; }
  /* The controls that MOVE the map live ON the map, at a size a thumb can hit —
     not as three 28px pills at the end of a row of category filters. */
  .pl-mapctl{ position:absolute; right:8px; bottom:8px; z-index:2; display:flex; flex-direction:column; gap:6px; }
  .pl-mapctl button{ min-width:40px; height:40px; padding:0 9px; border-radius:11px; border:1px solid #2a3545;
    background:rgba(13,19,29,.88); color:#cfe0f2; font:700 16px/1 Rajdhani, sans-serif; cursor:pointer;
    display:flex; align-items:center; justify-content:center; gap:4px; touch-action:manipulation; }
  .pl-mapctl button:active{ transform:scale(.92); }
  .pl-mapctl .pl-frontier i{ font-style:normal; font-size:12px; font-weight:800; color:#0b0f18; background:#8ba0b5;
    border-radius:6px; padding:1px 4px; min-width:14px; text-align:center; }
  .pl-mapctl .pl-frontier.hot{ border-color:#ffcf4d; color:#ffe08a; box-shadow:0 0 16px -5px #ffcf4d; }
  .pl-mapctl .pl-frontier.hot i{ background:#ffcf4d; }
  .pl-hint{ font-size:10.5px; color:#7e8aa0; text-align:center; padding:7px 8px; border-top:1px solid #1c2530; }

  /* ---- MAP / LIST switch + the list itself -------------------------------- */
  /* BOTH OPTIONS VISIBLE, treated loudly enough to find. The original segment was
     the same size and weight as the four category chips beside it, so the one
     control that changes the whole screen read as a fifth filter — and its only
     explanation was a "title" tooltip, which never reaches a phone. Discoverability
     is carried by the treatment: accent frame, breathing glow, a sheen sweep and a
     pulse on the option you are NOT on. Everything is gated on .fresh and stops for
     good once the switch has been used — an effect that never ends is just noise. */
  .pl-viewsw{ position:relative; display:flex; flex-direction:column; gap:5px; flex:1 1 190px; min-width:0;
    padding:7px 8px; border-radius:11px; overflow:hidden;
    background:linear-gradient(180deg,rgba(255,208,212,.15),rgba(255,208,212,.04));
    border:1px solid rgba(255,208,212,.55);
    box-shadow:0 0 16px -7px rgba(255,208,212,.55), inset 0 0 20px -14px rgba(255,208,212,.9); }
  .plv-row{ display:flex; gap:5px; }
  .plv-b{ flex:1 1 0; min-width:0; min-height:36px; padding:7px 10px; cursor:pointer; border-radius:8px;
    font:800 11.5px/1 'Rajdhani',sans-serif; letter-spacing:.08em;
    color:#ffd7db; background:rgba(12,8,12,.55); border:1px solid rgba(255,208,212,.35); }
  .plv-b.on{ color:#1a0b0e; background:linear-gradient(180deg,#ffe3e6,#ffd0d4); border-color:#ffe3e6;
    box-shadow:0 0 14px -3px rgba(255,208,212,.9); }
  .plv-b:active{ transform:scale(.98); }
  .plv-s{ font:600 9.5px/1.25 'Rajdhani',sans-serif; letter-spacing:.02em; color:#c39aa0; }
  .plv-s b{ color:#ffd7db; font-weight:800; }
  .plv-new{ position:absolute; top:6px; right:7px; font:800 8px/1 'Rajdhani',sans-serif; letter-spacing:.1em; font-style:normal;
    color:#1a0b0e; background:#ffd0d4; border-radius:5px; padding:3px 4px; box-shadow:0 0 10px -1px rgba(255,208,212,.95); }
  .pl-viewsw.fresh::after{ content:''; position:absolute; inset:0; pointer-events:none;
    background:linear-gradient(105deg,transparent 32%,rgba(255,227,230,.22) 49%,transparent 66%);
    transform:translateX(-120%); animation:plvSheen 3.6s ease-in-out infinite; }
  @keyframes plvSheen{ 0%,58%{ transform:translateX(-120%) } 100%{ transform:translateX(120%) } }
  .pl-viewsw.fresh{ animation:plvBreathe 3.6s ease-in-out infinite; }
  @keyframes plvBreathe{
    0%,100%{ box-shadow:0 0 15px -9px rgba(255,208,212,.5), inset 0 0 20px -14px rgba(255,208,212,.9) }
    50%{ box-shadow:0 0 26px -4px rgba(255,208,212,.85), inset 0 0 20px -11px rgba(255,208,212,1) } }
  .pl-viewsw.fresh .plv-b:not(.on){ animation:plvBeckon 3.6s ease-in-out infinite; }
  @keyframes plvBeckon{
    0%,100%{ border-color:rgba(255,208,212,.35); color:#ffd7db }
    50%{ border-color:rgba(255,227,230,.95); color:#fff3f4 } }
  @media (prefers-reduced-motion: reduce){
    .pl-viewsw.fresh, .pl-viewsw.fresh .plv-b:not(.on){ animation:none; }
    .pl-viewsw.fresh::after{ display:none; }
    .pl-viewsw.fresh{ box-shadow:0 0 22px -5px rgba(255,208,212,.8), inset 0 0 20px -11px rgba(255,208,212,1); }
    .pl-viewsw.fresh .plv-b:not(.on){ border-color:rgba(255,227,230,.9); color:#fff3f4; } }
  @media (pointer: coarse){ .plv-b{ min-height:44px; } }
  /* NO min-height OVERRIDE HERE. .scr-body on the Pilot screen does not scroll,
     so this pane must shrink to whatever room is left exactly like the canvas
     does — pinning it taller pushes it and every sibling past the clip edge.
     The list gets its room from the detail card not being rendered in this view. */
  .pl-list{ display:flex; flex-direction:column; flex:1 1 auto; min-height:0; }
  .pl-lbar{ display:flex; align-items:center; gap:7px; padding:8px 9px; border-bottom:1px solid #1c2530; flex-wrap:wrap; }
  .pl-search{ flex:1 1 130px; min-width:0; background:#0d141e; border:1px solid #25303f; border-radius:9px; color:#e7f0fa;
    font:600 12px/1 'Rajdhani',sans-serif; padding:8px 10px; min-height:34px; }
  .pl-search:focus{ outline:none; border-color:#4a5a70; box-shadow:0 0 0 1px rgba(255,255,255,.08) inset; }
  .pl-search::placeholder{ color:#6d7d92; }
  .pl-ltabs{ display:inline-flex; flex:none; border:1px solid #25303f; border-radius:9px; overflow:hidden; }
  .pl-lt{ font:800 10px/1 'Rajdhani',sans-serif; letter-spacing:.06em; color:#8b9bb0; background:#0d141e; border:none; padding:8px 10px; cursor:pointer; min-height:34px; }
  .pl-lt.on{ color:#0b0f18; background:#9fb3c9; }
  .pl-lnote{ font-size:11px; color:#8ba0b5; padding:7px 10px; border-bottom:1px solid #1c2530; background:#0d131c; }
  .pl-lnote b{ color:#ffd24d; }
  .pl-lrows{ flex:1 1 auto; min-height:0; overflow-y:auto; -webkit-overflow-scrolling:touch; display:flex; flex-direction:column; gap:1px; padding:1px; }
  .pl-lrow{ display:grid; grid-template-columns:34px minmax(0,1fr) auto auto; align-items:center; gap:10px;
    padding:9px 10px; min-height:52px; background:#0d141e; border-left:3px solid var(--c); cursor:pointer; text-align:left; }
  .pl-lrow:hover{ background:#111a26; }
  .pl-lrow.on{ background:#152030; box-shadow:0 0 0 1px rgba(255,255,255,.12) inset; }
  .pl-lrow.own{ opacity:.72; }
  .pl-lrow:focus-visible{ outline:2px solid #7fb2ff; outline-offset:-2px; }
  .pl-lic{ width:34px; height:34px; display:grid; place-items:center; border-radius:9px; font-family:'Orbitron',sans-serif; font-size:14px; font-weight:800;
    color:var(--c); background:color-mix(in srgb,var(--c) 16%,#0b0f18); border:1px solid color-mix(in srgb,var(--c) 55%,#0b0f18); }
  .pl-lmain{ display:flex; flex-direction:column; gap:2px; min-width:0; }
  .pl-ln{ font-family:'Orbitron',sans-serif; font-size:12.5px; font-weight:800; color:#e7f0fa; line-height:1.2; }
  .pl-ln em{ font-style:normal; font-family:'Rajdhani',sans-serif; font-size:8.5px; font-weight:800; letter-spacing:.14em; color:#0b0f18; background:#ffcf4d; border-radius:4px; padding:2px 4px; vertical-align:middle; }
  .pl-lb{ font-size:11px; color:#9fb0c4; line-height:1.35; text-wrap:pretty; }
  .pl-lmeta{ display:flex; flex-direction:column; align-items:flex-end; gap:2px; flex:none; }
  .pl-lmeta i{ font-style:normal; font:800 8.5px/1 'Rajdhani',sans-serif; letter-spacing:.12em; color:#6d7f95; }
  .pl-lmeta b{ font-family:'Orbitron',sans-serif; font-size:11px; font-weight:800; color:#8ba0b5; }
  .pl-lgo{ flex:none; min-height:44px; min-width:56px; font:800 11.5px/1 'Orbitron',sans-serif; color:#0b0f18; background:#ffd24d;
    border:none; border-radius:9px; padding:9px 10px; cursor:pointer; }
  .pl-lgo.cant{ color:#8ba0b5; background:#141c28; border:1px solid #2a3648; }
  .pl-ldone{ flex:none; width:56px; text-align:center; color:#7ce0a0; font-weight:800; font-size:14px; }
  .pl-lempty,.pl-lmore{ padding:16px 12px; text-align:center; font-size:11.5px; color:#8ba0b5; line-height:1.5; text-wrap:pretty; }
  @media (max-width:400px){
    .pl-lrow{ grid-template-columns:30px minmax(0,1fr) auto; gap:8px; padding:8px; }
    .pl-lmeta{ display:none; }
    .pl-lic{ width:30px; height:30px; font-size:12.5px; }
  }

  /* ===== PHONE / SHORT WINDOW =============================================
     MEASURED, NOT GUESSED (audit/pilot-frame.html). At 360x640 this screen
     spent 139px of a 442px body on the tree BAR and handed the list 63px -
     one row, in a scroll box, inside a body that also scrolls. Three fixes,
     all of them the same idea: on a phone the PAGE is the scroll surface and
     the chrome is one row.

     1. ONE ROW OF CHROME. The title is already in the screen header, the four
        category chips scroll sideways instead of wrapping to a second row,
        and the Map/List switch collapses from a bordered promo card (two 44px
        buttons stacked over a sub-line) to the segmented pair it always was.
        The 44px touch target stays - only the packaging goes.
     2. ONE SCROLL SURFACE. .pl-lrows stops being a scroll root and flows into
        #pilot-body, which already scrolls. A list nested inside a scroller
        inside a scroller is the "display is broken" report: you drag and the
        wrong thing moves. The search/tabs bar sticks so it stays reachable.
     3. THE MAP CANNOT FLOW - it is a drag surface - so instead of shrinking
        to whatever is left it gets a real box and lets the body scroll past
        it. .pl-treewrap goes flex:none here so its height is its content and
        nothing can be clipped behind its overflow:hidden. */
  @media (max-width:620px), (max-height:560px){
    .pl-treebar{ flex-wrap:nowrap; gap:6px; padding:6px 7px; }
    .pl-treetitle{ display:none; }
    .pl-filters{ order:2; flex:1 1 auto; flex-wrap:nowrap; min-width:0; overflow-x:auto; overflow-y:hidden;
      scrollbar-width:none; -webkit-overflow-scrolling:touch; }
    .pl-filters::-webkit-scrollbar{ display:none; }
    .pl-fchip{ flex:none; padding:5px 9px; }
    .pl-viewsw{ order:1; flex:0 0 auto; flex-direction:row; align-items:center; gap:0; padding:3px; border-radius:10px; }
    .pl-viewsw .plv-s, .pl-viewsw .plv-new{ display:none; }
    .plv-row{ gap:3px; }
    .plv-b{ flex:0 0 auto; padding:6px 11px; white-space:nowrap; }

    .pl-treewrap{ flex:0 0 auto; min-height:0; }
    .pl-mapwrap{ flex:0 0 auto; height:min(46vh,320px); min-height:190px; }
    .pl-treewrap.listing .pl-list{ flex:0 0 auto; }
    .pl-lrows{ flex:0 0 auto; min-height:0; overflow:visible; }
    .pl-treewrap.listing .pl-lbar{ position:sticky; top:0; z-index:2; background:#0e131d; }
  }

  /* RESERVED HEIGHT. Selecting a node swapped a one-line placeholder for a card,
     which resized the flex column and forced the canvas to re-measure — the map
     visibly jumped on every tap. min-height, never height: a taller card still
     grows (see the layout fit contract in CLAUDE.md). */
  .pl-detail{ margin-top:0; flex:none; min-height:104px; }
  .pl-detail-empty{ font-size:12px; color:#8a93a6; text-align:center; padding:14px; background:#101725; border:1px dashed #26303f; border-radius:12px; min-height:76px; display:flex; align-items:center; justify-content:center; }
  .pl-detail-card{ background:linear-gradient(180deg,#121a27,#0e1320); border:1px solid var(--nc); border-radius:13px; padding:12px; box-shadow:0 0 22px -10px var(--nc); }
  .pl-detail-h{ display:flex; align-items:center; gap:8px; }
  .pl-cat-dot{ width:9px; height:9px; border-radius:50%; flex:none; }
  .pl-detail-name{ font-family:'Orbitron',sans-serif; font-weight:700; font-size:14px; color:#eef3fb; flex:1; }
  .pl-leg{ font-style:normal; font-size:8.5px; letter-spacing:.1em; color:#ffcf4d; border:1px solid #ffcf4d66; border-radius:5px; padding:1px 4px; vertical-align:middle; }
  .pl-detail-cat{ font-size:10px; color:#9fb0c4; text-transform:uppercase; letter-spacing:.06em; }
  .pl-effs{ margin:9px 0; display:flex; flex-direction:column; gap:5px; }
  .pl-eff{ font-family:'Rajdhani',sans-serif; font-weight:700; font-size:15px; color:#46d27a; }
  .pl-eff span{ font-weight:600; font-size:12px; color:#aeb9c9; }
  .pl-eff.legendary{ color:#ffcf4d; }
  .pl-detail-foot{ display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:4px; }
  .pl-detail-score{ font-size:11px; color:#ffd24d; font-weight:700; }
  .pl-act{ font-size:12px; font-weight:700; }
  .pl-act.done{ color:#46d27a; } .pl-act.locked{ color:#8a93a6; }
  button.pl-act.unlock{ background:linear-gradient(180deg,#ff4a5a,#d8202f); color:#fff; border:none; border-radius:10px; padding:9px 14px; font-family:'Rajdhani',sans-serif; font-weight:800; letter-spacing:.03em; cursor:pointer; box-shadow:0 6px 18px -6px ${ACCENT}; }
  button.pl-act.unlock:active{ transform:scale(.96); }
  button.pl-act.unlock.cant{ background:#2a2030; color:#8a7a82; box-shadow:none; }
  .pl-need{ font-size:10.5px; color:#e08a92; margin-top:5px; text-align:right; }

  .pl-coach{ margin-top:0; flex:none; background:#101725; border:1px solid #26303f; border-radius:12px; overflow:hidden; }
  .pl-coach-h{ width:100%; text-align:left; background:none; border:none; color:#cdd7e6; font-family:'Rajdhani',sans-serif; font-weight:700; font-size:13px; padding:11px 13px; cursor:pointer; display:flex; justify-content:space-between; }
  .pl-coach-l{ margin:0; padding:2px 16px 13px 26px; display:flex; flex-direction:column; gap:7px; }
  .pl-coach-l li{ font-size:12px; color:#aeb9c9; line-height:1.4; }

  /* ===== DREADNAUGHT HUNT SCREEN ===== */
  .dh-banner{ background:linear-gradient(180deg,#1d0c12,#140a0e); border:1px solid #4a1e28; border-radius:16px; padding:14px; text-align:center; box-shadow:0 0 28px -10px ${ACCENT}; }
  .dh-banner-t{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:17px; letter-spacing:.12em; color:#fff; text-shadow:0 0 16px rgba(255,58,74,.6); }
  .dh-banner-s{ font-size:11.5px; color:#e0a7ae; margin-top:5px; line-height:1.4; }
  .dh-week{ font-size:11px; color:#9fb0c4; margin-top:8px; } .dh-week b{ color:#ffd24d; }
  .dh-list{ display:flex; flex-direction:column; gap:9px; margin-top:12px; }
  .dh-card{ display:flex; align-items:center; gap:11px; background:linear-gradient(180deg,#141b27,#0f141e); border:1px solid #25303f; border-radius:14px; padding:10px 11px; position:relative; overflow:hidden; }
  .dh-card.ready{ border-color:#ff3a4a66; box-shadow:0 0 18px -10px ${ACCENT}; }
  .dh-card.cooldown{ opacity:.72; } .dh-card.soon{ opacity:.6; }
  .dh-action{ display:flex; flex-direction:column; align-items:flex-end; gap:5px; }
  .dh-respawn{ border:1px solid rgba(255,58,74,.55); background:rgba(255,58,74,.1); color:#ff98a2; border-radius:8px; padding:5px 9px;
    font-family:'Rajdhani',sans-serif; font-weight:800; font-size:10px; letter-spacing:.03em; cursor:pointer; white-space:nowrap; }
  .dh-respawn b{ color:#ffd24d; font-variant-numeric:tabular-nums; }
  .dh-respawn:active{ transform:scale(.95); }
  .dh-respawn:disabled{ opacity:.45; cursor:default; }
  .dh-art{ width:64px; height:48px; flex:none; display:grid; place-items:center; background:radial-gradient(120% 120% at 50% 30%,#241016,#0e0a0e); border:1px solid #3a1a22; border-radius:10px; }
  .dh-art img{ width:62px; height:46px; object-fit:contain; filter:drop-shadow(0 2px 4px rgba(0,0,0,.6)); }
  .dh-info{ flex:1; min-width:0; }
  .dh-name{ font-family:'Orbitron',sans-serif; font-weight:700; font-size:13px; color:#eef3fb; }
  .dh-tier{ font-size:10px; color:#ff8a94; margin-left:3px; }
  .dh-meta{ font-size:10.5px; color:#9fb0c4; margin-top:2px; }
  .dh-drop{ font-size:10.5px; color:#ffd0d4; margin-top:4px; display:flex; align-items:center; gap:5px; }
  .dh-drop i{ width:6px; height:6px; border-radius:50%; background:${ACCENT}; box-shadow:0 0 6px ${ACCENT}; }
  .dh-action{ flex:none; }
  .dh-go{ background:linear-gradient(180deg,#ff4a5a,#d8202f); color:#fff; border:none; border-radius:10px; padding:9px 15px; font-family:'Rajdhani',sans-serif; font-weight:800; letter-spacing:.04em; cursor:pointer; box-shadow:0 6px 16px -6px ${ACCENT}; }
  .dh-go:active{ transform:scale(.95); }
  .dh-lock, .dh-cd{ font-size:11px; font-weight:700; color:#8a93a6; white-space:nowrap; } .dh-cd{ color:#e8a13b; } .dh-cd b{ color:#ffd24d; }
  .dh-foot{ font-size:11px; color:#8a93a6; text-align:center; margin-top:12px; line-height:1.45; } .dh-foot b{ color:#ffd0d4; }

  /* ===== veil + modals ===== */
  .dr-veil{ padding:30px 18px; display:grid; place-items:center; }
  .dr-veil-card{ max-width:300px; text-align:center; background:linear-gradient(180deg,#161019,#100b14); border:1px solid #3a2030; border-radius:16px; padding:22px; }
  .dr-veil-ic{ font-size:34px; } .dr-veil-card h3{ font-family:'Orbitron',sans-serif; color:#ffd0d4; margin:8px 0 6px; font-size:16px; }
  .dr-veil-card p{ font-size:12.5px; color:#b9c2d2; line-height:1.5; } .dr-veil-card p b{ color:#fff; }
  .dr-veil-lv{ margin-top:12px; font-size:11px; color:#9fb0c4; }
  .dr-veil-bar{ height:6px; border-radius:4px; background:#221820; overflow:hidden; margin-top:6px; }
  .dr-veil-bar i{ display:block; height:100%; background:linear-gradient(90deg,#ff4a5a,#ffcf4d); }

  .dr-modal{ position:absolute; inset:0; z-index:60; display:grid; place-items:center; padding:22px; }
  .dr-modal-back{ position:absolute; inset:0; background:rgba(6,7,12,.72); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); }
  .dr-modal-card{ position:relative; max-width:320px; width:100%; background:linear-gradient(180deg,#1a1018,#120b12); border:1px solid #4a2030; border-radius:18px; padding:22px; text-align:center; box-shadow:0 24px 60px rgba(0,0,0,.6), 0 0 40px -16px ${ACCENT}; animation:drmUp .3s cubic-bezier(.22,1,.36,1); }
  @keyframes drmUp{ from{ transform:translateY(18px); opacity:0; } to{ transform:none; opacity:1; } }
  .drm-ic{ font-size:40px; filter:drop-shadow(0 0 14px ${ACCENT}); }
  .drm-h{ font-family:'Orbitron',sans-serif; font-size:16px; color:#fff; margin:8px 0 10px; line-height:1.3; }
  .drm-p{ font-size:12.5px; color:#c5cad6; line-height:1.5; margin:0 0 9px; } .drm-p b{ color:#ffd0d4; }
  .drm-note{ font-size:11.5px; color:#ff9aa2; background:rgba(255,58,74,.08); border:1px solid rgba(255,58,74,.3); border-radius:10px; padding:8px 10px; margin:4px 0 14px; }
  .drm-ok{ background:linear-gradient(180deg,#ff4a5a,#d8202f); color:#fff; border:none; border-radius:11px; padding:11px 20px; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:14px; letter-spacing:.04em; cursor:pointer; width:100%; box-shadow:0 8px 22px -8px ${ACCENT}; }
  .drm-ok:active{ transform:scale(.97); }
  .drm-ghost{ background:none; border:1px solid #3a2632; color:#c5b0b6; border-radius:11px; padding:10px 16px; font-family:'Rajdhani',sans-serif; font-weight:700; font-size:13px; cursor:pointer; margin-top:8px; width:100%; }
  .drm-victory .drm-vart{ width:140px; height:96px; margin:0 auto 6px; display:grid; place-items:center; }
  .drm-victory .drm-vart img{ width:140px; height:96px; object-fit:contain; filter:drop-shadow(0 0 18px rgba(255,58,74,.5)); animation:drFloat 3s ease-in-out infinite; }
  @keyframes drFloat{ 0%,100%{ transform:translateY(0); } 50%{ transform:translateY(-6px); } }
  .drm-vkill{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:16px; letter-spacing:.08em; color:#fff; text-shadow:0 0 16px rgba(255,58,74,.6); }
  .drm-vtier{ font-size:11.5px; color:#9fb0c4; margin:3px 0 12px; }
  .drm-core{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:20px; color:#ffcf4d; text-shadow:0 0 16px rgba(255,207,77,.5); margin-bottom:6px; }
  .drm-core em{ font-style:normal; font-size:10px; color:#9fb0c4; letter-spacing:.04em; }
  .drm-core.dbl{ animation:drmPulse 1.2s ease-in-out infinite; }
  @keyframes drmPulse{ 0%,100%{ filter:brightness(1); } 50%{ filter:brightness(1.4); } }
  .drm-nocore{ font-size:12px; color:#c5b0b6; margin-bottom:8px; }
  .drm-vsub{ font-size:11.5px; color:#a8b2c2; line-height:1.45; margin-bottom:14px; } .drm-vsub b{ color:#ffd0d4; }
  .drm-vbtns{ display:flex; flex-direction:column; gap:0; }
  `;

  // ---- BOOT (must stay LAST) ------------------------------------------------
  // boot() reads the CSS const declared above it; calling it from the module body
  // hit the temporal dead zone and aborted the script before window exports ran,
  // so the screen silently painted nothing on a late parse. Keep this at the end.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  setTimeout(boot, 1200);
})();
