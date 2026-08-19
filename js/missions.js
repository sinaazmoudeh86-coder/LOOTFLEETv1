/* =============================================================================
   missions.js — MISSION BOARDS (Command ▸ Missions)
   ---------------------------------------------------------------------------
   THREE tiered boards — DAILY (midnight reset) · WEEKLY (Sunday 00:00) ·
   MONTHLY (1st of month) — plus the LIFETIME badge board (achievements.js).
   Each board issues 10 missions from the shared pool; weekly/monthly targets
   and rewards are scaled up (×5/×6, ×18/×22). Clearing a board pays a
   Commander's Crate and unlocks the next TIER of that board the same period:
   steeply higher targets, all rewards ×2 per tier, endlessly. NON-INVASIVE:
   progress is polled from positive deltas of existing game state.
============================================================================= */
(function () {
  'use strict';
  let G = null;
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------------------
  // MISSION POOL — id, name, blurb, metric, target(level,zone), reward(level,zone)
  // ---------------------------------------------------------------------------
  const dayScale = (z) => Math.max(1, Math.pow(z, 1.15));

  // ---- LOOTCOIN PAYOUT PASS · Aug 2026 -------------------------------------
  // Every LootCoin REWARD in the game was halved in one pass (build 614). Mission board payouts halved at the POOL definition, so daily,
  // weekly and monthly all follow — scaleRw() multiplies these, it does not replace
  // them. The two “all boards clear” bonuses went 100 → 50 with them.
  // Prices, costs and pack sizes were NOT touched — only what the game HANDS OUT.
  // ---------------------------------------------------------------------------
  const POOL = [
    { id: 'kills1',  ic: '⌖', name: 'Clear the Lanes',    blurb: 'Destroy {N} enemy ships',            m: 'kills',  n: (l, z) => 150 + Math.round(l * 6),        rw: (l, z) => ({ gold: Math.round(900 * dayScale(z)) }) },
    { id: 'kills2',  ic: '☄', name: 'Full Sweep',         blurb: 'Destroy {N} enemy ships',            m: 'kills',  n: (l, z) => 400 + Math.round(l * 14),       rw: (l, z) => ({ gold: Math.round(1500 * dayScale(z)), lc: 5 }) },
    { id: 'boss1',   ic: '◈', name: 'Decapitation Strike', blurb: 'Destroy {N} bosses',                m: 'bosses', n: () => 2,                                  rw: (l, z) => ({ iron: Math.round(120 * dayScale(z)), lc: 5 }) },
    { id: 'boss2',   ic: '♛', name: 'Warlord Purge',      blurb: 'Destroy {N} bosses',                 m: 'bosses', n: () => 5,                                  rw: (l, z) => ({ plasma: Math.round(90 * dayScale(z)), lc: 8 }) },
    { id: 'gold1',   ic: '$', name: 'War Chest',          blurb: 'Earn {N} gold from combat',          m: 'gold',   n: (l, z) => Math.round(4000 * dayScale(z)), rw: (l, z) => ({ fuel: Math.round(220 * dayScale(z)) }) },
    { id: 'fuel1',   ic: '⬢', name: 'Fuel Skimmer',       blurb: 'Scavenge {N} fuel',                  m: 'fuel',   n: (l, z) => Math.round(60 * dayScale(z)),   rw: (l, z) => ({ iron: Math.round(80 * dayScale(z)), lc: 3 }) },
    { id: 'iron1',   ic: '◆', name: 'Iron Harvest',       blurb: 'Scavenge {N} iron',                  m: 'iron',   n: (l, z) => Math.round(40 * dayScale(z)),   rw: (l, z) => ({ plasma: Math.round(60 * dayScale(z)), lc: 3 }) },
    { id: 'plas1',   ic: '✦', name: 'Plasma Rush',        blurb: 'Scavenge {N} plasma',                m: 'plasma', n: (l, z) => Math.round(30 * dayScale(z)),   rw: (l, z) => ({ gold: Math.round(1200 * dayScale(z)), lc: 3 }) },
    { id: 'xp1',     ic: '▲', name: 'Flight Hours',       blurb: 'Gain {N} account levels',            m: 'levels', n: (l) => l < 40 ? 2 : 1,                    rw: (l, z) => ({ fuel: Math.round(150 * dayScale(z)), iron: Math.round(60 * dayScale(z)) }) },
    { id: 'zone1',   ic: '⌬', name: 'Push the Frontier',  blurb: 'Deploy into {N} different zones',    m: 'zones',  n: () => 3,                                  rw: (l, z) => ({ gold: Math.round(1100 * dayScale(z)), lc: 3 }) },
    { id: 'time1',   ic: '◷', name: 'On Patrol',          blurb: 'Fly {N} minutes of combat',          m: 'mins',   n: () => 15,                                 rw: (l, z) => ({ fuel: Math.round(180 * dayScale(z)) }) },
    { id: 'loot1',   ic: '⬡', name: 'Salvage Run',        blurb: 'Pick up {N} pieces of loot',         m: 'loot',   n: (l) => 12 + Math.min(18, Math.round(l / 4)), rw: (l, z) => ({ iron: Math.round(70 * dayScale(z)), lc: 3 }) },
    { id: 'kills3',  ic: '⛬', name: 'Ace of the Sector',  blurb: 'Destroy {N} enemy ships',            m: 'kills',  n: (l, z) => 800 + Math.round(l * 20),       rw: (l, z) => ({ gold: Math.round(2600 * dayScale(z)), lc: 8 }) },
    { id: 'boss3',   ic: '⚑', name: 'Super Heavy',        blurb: 'Destroy {N} bosses',                 m: 'bosses', n: () => 8,                                  rw: (l, z) => ({ fuel: Math.round(260 * dayScale(z)), plasma: Math.round(80 * dayScale(z)), lc: 8 }) },
    { id: 'gold2',   ic: '⛁', name: 'Deep Pockets',       blurb: 'Earn {N} gold from combat',          m: 'gold',   n: (l, z) => Math.round(12000 * dayScale(z)), rw: (l, z) => ({ iron: Math.round(140 * dayScale(z)), lc: 5 }) },
    { id: 'zone2',   ic: '✈', name: 'Long Haul',          blurb: 'Deploy into {N} different zones',    m: 'zones',  n: () => 6,                                  rw: (l, z) => ({ plasma: Math.round(110 * dayScale(z)), lc: 5 }) },
    { id: 'time2',   ic: '☉', name: 'Double Shift',       blurb: 'Fly {N} minutes of combat',          m: 'mins',   n: () => 45,                                 rw: (l, z) => ({ gold: Math.round(2000 * dayScale(z)), fuel: Math.round(200 * dayScale(z)) }) },
    { id: 'loot2',   ic: '❖', name: 'Cargo Bay Bulge',    blurb: 'Pick up {N} pieces of loot',         m: 'loot',   n: (l) => 30 + Math.min(30, Math.round(l / 3)), rw: (l, z) => ({ gold: Math.round(1800 * dayScale(z)), lc: 5 }) },
    // ---- FEATURE-GATED MISSIONS — only issued once the feature is unlocked (req = min level) ----
    { id: 'gal1',    ic: '⬢', name: 'Land Grab',          blurb: 'Capture {N} galaxy tiles',           m: 'tiles',  n: () => 2,                                  rw: (l, z) => ({ fuel: Math.round(240 * dayScale(z)), lc: 5 }), req: 25 },
    { id: 'gal2',    ic: '⚑', name: 'Warpath',            blurb: 'Capture {N} galaxy tiles',           m: 'tiles',  n: () => 5,                                  rw: (l, z) => ({ plasma: Math.round(120 * dayScale(z)), lc: 10 }), req: 25 },
    { id: 'moon1',   ic: '☾', name: 'Colony Shipment',    blurb: 'Collect {N} resources from your Moon Colony', m: 'moon', n: (l, z) => Math.round(1500 * dayScale(z)), rw: (l, z) => ({ gold: Math.round(2000 * dayScale(z)), lc: 5 }), req: 30 },
    { id: 'moon2',   ic: '⛏', name: 'Colony Foreman',     blurb: 'Build or upgrade {N} colony structures', m: 'colony', n: () => 3,                              rw: (l, z) => ({ iron: Math.round(160 * dayScale(z)), lc: 8 }), req: 30 },
    // ---- SPACE CARGO DEFENSE — gated on the event itself (★3), not a level.
    // Deliveries are capped at 2/day base, so targets are counted in RUNS, not
    // the usual ×38 tier ladder (see the clamp in buildList).
    { id: 'cargo1',  ic: '⛟', name: 'Escort Contract',    blurb: 'Deliver {N} cargo shipment(s) to the Citadel', m: 'cargo', n: () => 1,             rw: (l, z) => ({ gold: Math.round(4000 * dayScale(z)), lc: 15 }), gate: () => cargoOpen() },
    // ---- NANOCORES — gated on the system itself (Lv 50), not a board level.
    { id: 'nano1',   ic: '◈', name: 'Core Requisition',   blurb: 'Open {N} Nanocore Crate(s)',                   m: 'nanoOpen', n: () => 1,   rw: (l, z) => ({ gold: Math.round(5000 * dayScale(z)), lc: 13 }), gate: () => nanoOpen() },
    { id: 'nano2',   ic: '⬢', name: 'Bench Time',         blurb: 'Land {N} successful core upgrade(s)',          m: 'nanoUp',   n: () => 2,   rw: (l, z) => ({ plasma: Math.round(150 * dayScale(z)), lc: 10 }), gate: () => nanoOpen() },
    { id: 'nano3',   ic: '✧', name: 'Spin the Lattice',   blurb: 'Reroll extra buffs {N} time(s)',               m: 'nanoRoll', n: () => 2,   rw: (l, z) => ({ iron: Math.round(180 * dayScale(z)), lc: 10 }), gate: () => nanoOpen() },
    { id: 'cargo2',  ic: '✦', name: 'Pristine Manifest',  blurb: 'Deliver {N} shipment(s) at 90%+ integrity',    m: 'cargoClean', n: () => 1,        rw: (l, z) => ({ plasma: Math.round(200 * dayScale(z)), lc: 23 }), gate: () => cargoOpen() },
  ];
  // the event unlocks at Pilot Ascension ★3 — no level ever opens it
  function cargoOpen() { try { return !!(window.CARGO && window.CARGO.unlocked && window.CARGO.unlocked()); } catch (e) { return false; } }
  // Nanocores opens at Level 50 — asked through the module so the gate lives in
  // exactly one place (NANO.CFG.gate).
  function nanoOpen() { try { return !!(window.NANO && window.NANO.unlocked()); } catch (e) { return false; } }

  // ---- PHYSICAL CEILINGS ----------------------------------------------------
  // Some metrics are gated by REAL TIME or by a currency, not by the pilot's
  // power. Kills scale with damage — a stronger fleet clears a zone faster, so a
  // bigger kill target is fair. A TILE CAPTURE costs travel plus a fight plus a
  // cooldown no amount of power removes; a CORE UPGRADE costs tens of thousands
  // of Prism Ingots and can fail four times out of five. Multiplying those by the
  // tier ladder produced orders that could not be filled inside the period at
  // any power level, which is exactly what was reported: 1,370 tile captures in a
  // month (measured at roughly 50/hour — 27 hours of unbroken play) and 36
  // successful upgrades on cores whose last slot costs 80,000 ingots an attempt.
  //
  // These are hard ceilings per period, applied AFTER tier scaling. They are set
  // from observed rates, not from what looks tidy on a card.
  const RATE_CAP = {
    tiles:     { d: 10, w: 45,  m: 150 },   // ~50/hr flat out → monthly ≈ 3 hours
    colony:    { d: 3,  w: 12,  m: 30  },   // build costs, not time, are the wall
    nanoOpen:  { d: 1,  w: 4,   m: 10  },   // 30,000 ingots a crate
    nanoUp:    { d: 2,  w: 6,   m: 14  },   // up to 80,000 an attempt, 20% to land
    nanoRoll:  { d: 2,  w: 6,   m: 15  },   // rerolls double in price per lock
    cargo:     { d: 2,  w: 10,  m: 40  },   // 2 runs/day base ration
    cargoClean:{ d: 1,  w: 6,   m: 24  },
  };

  // ---- BOARDS ---------------------------------------------------------------
  // tm = target multiplier vs daily · rm = reward multiplier vs daily
  const BOARDS = [
    { id: 'd', key: 'missions',  label: 'DAILY',   word: 'day',   tm: 1,  rm: 1,  msnCredit: 1,
      pk: () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); },
      left: () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1) - d; } },
    { id: 'w', key: 'missionsW', label: 'WEEKLY',  word: 'week',  tm: 5,  rm: 6,  msnCredit: 3,
      pk: () => { const d = new Date(); const s = new Date(d); s.setDate(d.getDate() - d.getDay()); s.setHours(0, 0, 0, 0); return 'w' + s.getTime(); },
      left: () => { const d = new Date(); const add = (7 - d.getDay()) % 7 || 7; const s = new Date(d); s.setDate(d.getDate() + add); s.setHours(0, 0, 0, 0); return s - d; } },
    { id: 'm', key: 'missionsM', label: 'MONTHLY', word: 'month', tm: 18, rm: 22, msnCredit: 5,
      pk: () => { const d = new Date(); return 'm' + d.getFullYear() + '-' + (d.getMonth() + 1); },
      left: () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 1) - d; } },
  ];
  const boardCfg = (id) => BOARDS.find((c) => c.id === id);
  // LIFETIME MISSION CREDIT — what one claimed order is worth on the career
  // counter. It scales with the BOARD, not the board's tier: daily 1, weekly 3,
  // monthly 5. Deliberately capped at 5 so the counter stays a readable count of
  // work done rather than a number that runs away with the reward multiplier.
  const msnCredit = (cfg) => Math.max(1, Math.min(5, (cfg && cfg.msnCredit) || 1));
  function creditMissions(cfg, n) {
    G.state.lifetimeMissions = (G.state.lifetimeMissions | 0) + msnCredit(cfg) * (n || 1);
  }

  // ---- TIER SCALING (within a board) ---------------------------------------
  // Targets: T1 ×1 · T2 ×2.4 · T3 ×6 · T4 ×15 · T5 ×38 · T6+ ×2.5 each.
  // Rewards double every tier.
  const TIER_TARGET = [1, 2.4, 6, 15, 38];
  // TIER SCALING IS BOUNDED. This was `38 * 2.5^(t-5)` — an unbounded exponential
  // with nothing above it, so the board's demands grew forever while a day stayed
  // 24 hours long. It is the reason a monthly order read "Capture 1.37k galaxy
  // tiles" (tier 5 monthly: base 2 × 38 × 18). Growth past tier 5 is gentler and
  // stops at ×300; REWARDS still double every tier without a ceiling, so climbing
  // tiers keeps paying — the targets just stop outrunning the clock.
  const targetMult = (t) => (t <= 5 ? TIER_TARGET[t - 1] : Math.min(300, 38 * Math.pow(1.6, t - 5)));
  const rwMult = (t) => Math.pow(2, t - 1);
  function scaleRw(rw, tier, cfg) {
    const m = rwMult(tier) * cfg.rm, out = {};
    for (const k in rw) out[k] = Math.round(rw[k] * m);
    return out;
  }

  // ---------------------------------------------------------------------------
  // STATE — per board: s[cfg.key] = { day, tier, list:[{id,n,done,claimed}], acc, seen, allClaimed }
  // Shared: s.msnBase (delta baseline) · s.lifeStats (lifetime accumulators)
  // ---------------------------------------------------------------------------
  function seededShuffle(arr, seed) {
    const a = arr.slice();
    let s = 0; for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
    for (let i = a.length - 1; i > 0; i--) { s = (s * 1664525 + 1013904223) >>> 0; const j = s % (i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  const freshAcc = () => ({ kills: 0, bosses: 0, gold: 0, fuel: 0, iron: 0, plasma: 0, levels: 0, zones: 0, mins: 0, loot: 0, hulls: 0, tiles: 0, moon: 0, colony: 0, cargo: 0, cargoClean: 0, nanoOpen: 0, nanoUp: 0, nanoRoll: 0 });
  function buildList(cfg, tier) {
    const s = G.state, lvl = s.level || 1, z = Math.max(1, s.highestUnlocked || 1);
    const eligible = POOL.filter((p) => (!p.req || lvl >= p.req) && (!p.gate || p.gate()));
    const picks = seededShuffle(eligible, cfg.pk() + ':t' + tier + ':' + (s.playerName || 'cmdr')).slice(0, 10);
    const mult = targetMult(tier) * cfg.tm;
    return picks.map((p) => {
      let n = Math.max(1, Math.round(p.n(lvl, z) * mult));
      if (p.m === 'zones') n = Math.min(n, Math.max(4, s.highestUnlocked || 4));
      // RATE-LIMITED METRICS — clamped to what the period can physically hold.
      // This replaces the two hand-rolled clamps that used to live here (one for
      // cargo, one for nanocores) and covers tile capture and colony work, which
      // had none and so rode the full tier ladder.
      const cap = RATE_CAP[p.m];
      if (cap) n = Math.min(n, Math.max(1, cap[cfg.id] || cap.d));
      return { id: p.id, n, done: 0, claimed: false };
    });
  }
  // shared delta baseline + lifetime accumulators (seeded once from current state)
  function ensureShared() {
    const s = G.state;
    if (!s.msnBase && s.missions && s.missions.base) { s.msnBase = s.missions.base; s.missions.base = null; } // pre-boards saves
    if (!s.lifeStats) {
      const r = s.resources || {};
      s.lifeStats = { gold: s.gold || 0, res: (r.fuel || 0) + (r.iron || 0) + (r.plasma || 0),
                      fuel: r.fuel || 0, iron: r.iron || 0, plasma: r.plasma || 0,
                      tiles: Object.keys(s.ownedSystems || {}).length, boss: (s.stats && s.stats.bossKills) || 0 };
    }
    if (s.lifeStats.fuel == null) { const r = s.resources || {}; s.lifeStats.fuel = r.fuel || 0; s.lifeStats.iron = r.iron || 0; s.lifeStats.plasma = r.plasma || 0; } // pre-split saves
  }
  // RE-CLAMP A STORED BOARD. Targets are generated once and then live in the save
  // for the rest of the period, so a monthly board issued before these ceilings
  // existed would keep asking for 1,370 tile captures until the month rolled
  // over. This lowers an over-cap target in place on load, leaving `done` and
  // `claimed` untouched — progress already earned still counts, and an order that
  // is now inside its ceiling may already be complete.
  function reclamp(b, cfg) {
    if (!b || !b.list) return;
    let changed = false;
    for (const it of b.list) {
      const p = POOL.find((q) => q.id === it.id);
      const cap = p && RATE_CAP[p.m];
      if (!cap) continue;
      const lim = Math.max(1, cap[cfg.id] || cap.d);
      if (it.n > lim) { it.n = lim; changed = true; }
    }
    if (changed) G.save();
  }
  function ensureBoard(cfg) {
    const s = G.state;
    let b = s[cfg.key];
    if (!b || b.day !== cfg.pk()) {
      b = s[cfg.key] = { day: cfg.pk(), tier: 1, list: null, acc: freshAcc(), seen: {}, allClaimed: false };
      b.list = buildList(cfg, 1);
      G.save();
    }
    if (!b.tier) b.tier = 1;
    if (!b.list) b.list = buildList(cfg, b.tier);
    reclamp(b, cfg);
    if (b.allClaimed) advanceTier(cfg); // self-heal: crate claimed but tier never advanced
    return b;
  }
  // TIER-UP — fresh board at the next tier: harder targets, all rewards ×2
  function advanceTier(cfg) {
    const b = G.state[cfg.key];
    b.tier++;
    b.list = buildList(cfg, b.tier);
    b.acc = freshAcc(); b.seen = {};
    b.allClaimed = false;
    G.save();
    const tl = $('toast-layer');
    if (tl) {
      const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#8fc4ff';
      t.innerHTML = '⌁ ' + cfg.label + ' TIER ' + b.tier + ' UNLOCKED<br><span style="font-size:13px">10 new orders · all rewards ×' + G.formatNum(rwMult(b.tier)) + '</span>';
      tl.appendChild(t); setTimeout(() => t.remove(), 3600);
    }
  }

  // ---------------------------------------------------------------------------
  // PROGRESS — 1s poll converts positive state deltas into per-board accumulators
  // ---------------------------------------------------------------------------
  function snapshot() {
    const s = G.state, r = s.resources || {};
    return { kills: s.totalKills || 0, gold: s.gold || 0, fuel: r.fuel || 0, iron: r.iron || 0, plasma: r.plasma || 0,
    // LOOT COLLECTED IS A CAREER COUNT (see game-v93 collect()). It used to add
    // the hold's length to a counter nothing incremented, so "pick up N pieces of
    // loot" ignored anything sold or scrapped on pickup and went backwards when
    // the hold was sold. The max protects a save that predates the one-time seed.
             level: s.level || 1, play: s.playTime || 0, items: Math.max(s.lifetimeLooted || 0, (s.inventory || []).length), boss: bossCount(),
             hulls: hullLevelSum(), tiles: Object.keys(s.ownedSystems || {}).length, moon: moonLifetimeSum(), colony: colonyLevelSum(),
             cargo: (s.cargo && s.cargo.wins) | 0, cargoClean: (s.cargo && s.cargo.clean) | 0,
             nanoOpen: lifeStat('nanoOpened'), nanoUp: lifeStat('nanoUps'), nanoRoll: lifeStat('nanoRolls') };
  }
  function hullLevelSum() { const sl = G.state.shipLevels || {}; let t = 0; for (const k in sl) t += sl[k] || 0; return t; }
  // Nanocore progress is already counted for life once, in nanocores.js — the
  // boards read those same monotonic counters rather than keeping a second tally.
  function lifeStat(k) { const L = G.state.lifeStats; return (L && L[k]) | 0; }
  function moonLifetimeSum() { const lt = (G.state.moon && G.state.moon.lifetime) || {}; let t = 0; for (const k in lt) t += lt[k] || 0; return t; }
  function colonyLevelSum() {
    const root = G.state.moon; if (!root || !root.moons) return 0;
    let t = 0;
    root.moons.forEach((mm) => { const b = mm.b || {}; for (const k in b) t += (b[k] && b[k].lv) || 0; });
    return t;
  }
  function bossCount() {
    const s = G.state;
    if (s.stats && typeof s.stats.bossKills === 'number') return s.stats.bossKills;
    return M._bossLocal;
  }
  const M = { _bossLocal: 0 };
  function watchBoss() {
    const bar = $('boss-bar'); let was = false;
    setInterval(() => {
      const on = bar && bar.classList.contains('active');
      if (was && !on) M._bossLocal++;
      was = on;
    }, 500);
  }
  const pos = (x) => (x > 0 ? x : 0);
  function tick() {
    if (!G || !G.state) return;
    const s = G.state;
    ensureShared();
    const boards = BOARDS.map((c) => ({ c, b: ensureBoard(c) }));
    const now = snapshot();
    if (!s.msnBase) { s.msnBase = now; return; }
    const o = s.msnBase;
    // SAVE-SWAP GUARD — a login/account switch replaces GAME.state but the old
    // baseline survives, so deltas would equal the account's whole lifetime and
    // auto-complete every board. playTime moves ≤ ~10s per 1s tick even at 10×;
    // any bigger jump (or a rewind) means a different save → re-baseline, and
    // floor the lifetime seeds so veterans keep their credit.
    if (now.play < o.play - 1 || now.play - o.play > 120) {
      s.msnBase = now;
      const r2 = s.resources || {}, L2 = s.lifeStats;
      L2.gold = Math.max(L2.gold, s.gold || 0);
      L2.res = Math.max(L2.res, (r2.fuel || 0) + (r2.iron || 0) + (r2.plasma || 0));
      L2.fuel = Math.max(L2.fuel || 0, r2.fuel || 0); L2.iron = Math.max(L2.iron || 0, r2.iron || 0); L2.plasma = Math.max(L2.plasma || 0, r2.plasma || 0);
      L2.tiles = Math.max(L2.tiles, Object.keys(s.ownedSystems || {}).length);
      L2.boss = Math.max(L2.boss, (s.stats && s.stats.bossKills) || 0);
      return;
    }
    const D = { kills: pos(now.kills - o.kills), gold: pos(now.gold - o.gold), fuel: pos(now.fuel - o.fuel),
                iron: pos(now.iron - o.iron), plasma: pos(now.plasma - o.plasma), levels: pos(now.level - o.level),
                bosses: pos(now.boss - o.boss), loot: pos(now.items - o.items), hulls: pos(now.hulls - (o.hulls || 0)),
                tiles: pos(now.tiles - (o.tiles || 0)), moon: pos(now.moon - (o.moon || 0)), colony: pos(now.colony - (o.colony || 0)),
                cargo: pos(now.cargo - (o.cargo || 0)), cargoClean: pos(now.cargoClean - (o.cargoClean || 0)),
                nanoOpen: pos(now.nanoOpen - (o.nanoOpen || 0)), nanoUp: pos(now.nanoUp - (o.nanoUp || 0)), nanoRoll: pos(now.nanoRoll - (o.nanoRoll || 0)) };
    s.msnBase = now;
    // lifetime accumulators for non-monotonic metrics (achievements)
    const L = s.lifeStats;
    L.gold += D.gold; L.res += D.fuel + D.iron + D.plasma; L.tiles += D.tiles; L.boss += D.bosses;
    L.fuel = (L.fuel || 0) + D.fuel; L.iron = (L.iron || 0) + D.iron; L.plasma = (L.plasma || 0) + D.plasma;
    let changed = false;
    boards.forEach(({ c, b }) => {
      const a = b.acc;
      for (const k in D) a[k] = (a[k] || 0) + D[k];
      if (s.currentDungeon >= 1) {
        a.mins += 1 / 60;
        const zk = 'z' + s.currentDungeon;
        if (!b.seen[zk]) { b.seen[zk] = 1; a.zones = (a.zones || 0) + 1; }
      }
      b.list.forEach((mi) => {
        const def = POOL.find((p) => p.id === mi.id); if (!def) return;
        const v = Math.min(mi.n, Math.floor(a[def.m] || 0));
        if (v > mi.done) { mi.done = v; changed = true;
          if (mi.done >= mi.n && !mi._toasted) { mi._toasted = true; missionToast(def, c); } }
      });
    });
    if (window.ACHIEVE && window.ACHIEVE.tick) window.ACHIEVE.tick();
    if (changed) { syncBadge(); if (document.querySelector('#screen-missions.active')) render(); }
  }
  function missionToast(def, cfg) {
    const tl = $('toast-layer'); if (!tl) return;
    const t = document.createElement('div');
    t.className = 'msn-toast';
    t.innerHTML = '<span class="mt-ic">' + def.ic + '</span><span><b>' + cfg.label + ' MISSION COMPLETE</b><br>' + def.name + ' — claim your reward</span>';
    tl.appendChild(t); setTimeout(() => t.remove(), 3400);
  }

  // ---------------------------------------------------------------------------
  // REWARDS
  // ---------------------------------------------------------------------------
  function payout(rw) {
    const s = G.state;
    if (!s.resources) s.resources = { fuel: 0, iron: 0, plasma: 0 };
    if (rw.gold) s.gold += rw.gold;
    if (rw.fuel) s.resources.fuel += rw.fuel;
    if (rw.iron) s.resources.iron += rw.iron;
    if (rw.plasma) s.resources.plasma += rw.plasma;
    if (rw.lc && G.addCredits) G.addCredits(rw.lc); else if (rw.lc) s.credits = (s.credits || 0) + rw.lc;
    G.save(); if (window.UI) window.UI.refreshAll();
  }
  const rwChips = (rw) => [
    rw.gold ? '<span class="mr-chip" style="--c:#f2a93c">$ ' + G.formatNum(rw.gold) + '</span>' : '',
    rw.fuel ? '<span class="mr-chip" style="--c:#5bc0ff">⬢ ' + G.formatNum(rw.fuel) + '</span>' : '',
    rw.iron ? '<span class="mr-chip" style="--c:#d0a060">◆ ' + G.formatNum(rw.iron) + '</span>' : '',
    rw.plasma ? '<span class="mr-chip" style="--c:#c07bff">✦ ' + G.formatNum(rw.plasma) + '</span>' : '',
    rw.lc ? '<span class="mr-chip mr-lc" style="--c:#ffd24d">◉ ' + G.formatNum(rw.lc) + ' LC</span>' : '',
  ].join('');

  // ---------------------------------------------------------------------------
  // RENDER — tabbed screen: DAILY · WEEKLY · MONTHLY · BADGES
  // ---------------------------------------------------------------------------
  let TAB = 'd';
  function fmtLeft(ms) {
    let t = ms / 1000;
    const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), mn = Math.floor((t % 3600) / 60);
    return d > 0 ? d + 'd ' + h + 'h' : h + 'h ' + mn + 'm';
  }
  const boardClaimable = (cfg) => {
    const b = G.state[cfg.key]; if (!b || !b.list) return 0;
    return b.list.filter((m) => m.done >= m.n && !m.claimed).length + ((b.list.every((m) => m.done >= m.n) && !b.allClaimed) ? 1 : 0);
  };
  function tabsHtml() {
    const t = (id, lab) => {
      const n = id === 'life' ? (window.ACHIEVE ? window.ACHIEVE.claimable() : 0) : boardClaimable(boardCfg(id));
      return '<button class="msn-tab' + (TAB === id ? ' on' : '') + '" data-tab="' + id + '">' + lab + (n ? '<i class="msn-td">' + n + '</i>' : '') + '</button>';
    };
    return '<div class="msn-tabs">' + t('d', 'DAILY') + t('w', 'WEEKLY') + t('m', 'MONTHLY') + t('life', '⬡ BADGES') + '</div>';
  }
  // ---------------------------------------------------------------------------
  // TAB DOTS ARE PATCHED, NOT REBUILT. The red count on DAILY / WEEKLY / MONTHLY /
  // BADGES was written only by tabsHtml(), i.e. only when the VISIBLE board's own
  // structure changed — so a weekly order completing while you stood on the daily
  // board, or a new badge rank landing, left that tab's dot missing until you
  // tapped it (tapping forces a rebuild). Every tick writes all four in place now.
  // ---------------------------------------------------------------------------
  function patchTabs(body) {
    const btns = body.querySelectorAll('[data-tab]');
    if (!btns.length) return;
    btns.forEach((btn) => {
      const id = btn.dataset.tab;
      const n = id === 'life' ? (window.ACHIEVE ? window.ACHIEVE.claimable() : 0) : boardClaimable(boardCfg(id));
      let dot = btn.querySelector('.msn-td');
      if (!n) { if (dot) dot.remove(); return; }
      if (!dot) { dot = document.createElement('i'); dot.className = 'msn-td'; btn.appendChild(dot); }
      const t = String(n);
      if (dot.textContent !== t) dot.textContent = t;
    });
  }
  function boardHtml(cfg, b) {
    const lvl = G.state.level || 1, z = Math.max(1, G.state.highestUnlocked || 1);
    const tier = b.tier || 1, rm = rwMult(tier) * cfg.rm;
    const doneN = b.list.filter((m) => m.done >= m.n).length;
    const claimedN = b.list.filter((m) => m.claimed).length;
    let html = '<div class="msn-head-card"><div class="mh-l"><div class="mh-t">' + cfg.label + ' MISSION BOARD <span class="mh-tier">TIER ' + tier + '</span></div>' +
      '<div class="mh-s">10 fresh orders every ' + cfg.word + ' · ⟳ resets in <b data-msn-cd>' + fmtLeft(cfg.left()) + '</b></div>' +
      (tier > 1 ? '<div class="mh-s"><b style="color:#ffd24d">All rewards ×' + G.formatNum(rwMult(tier)) + '</b> this tier · targets up steeply</div>'
                : '<div class="mh-s">Clear the board to unlock <b>Tier 2</b> — rewards ×2</div>') +
      '</div><div class="mh-ring" data-msn-ring style="--p:' + (doneN / 10 * 360) + 'deg"><span data-msn-ringn>' + doneN + '<i>/10</i></span></div></div>';
    const readyN = b.list.filter((m) => m.done >= m.n && !m.claimed).length;
    if (readyN > 0) html += '<button class="msn-claimall" data-claimall="1">✓ CLAIM ALL COMPLETED <i>' + readyN + '</i></button>';
    if (cfg.id === 'd') html += veridianBanner(); // ⌘ VERIDIAN — 1,000-lifetime-missions reward hull
    b.list.forEach((mi, i) => {
      const def = POOL.find((p) => p.id === mi.id); if (!def) return;
      const rw = scaleRw(def.rw(lvl, z), tier, cfg);
      const pct = Math.min(100, mi.done / mi.n * 100);
      const done = mi.done >= mi.n;
      html += '<div class="msn-card ' + (mi.claimed ? 'claimed' : done ? 'ready' : '') + '" data-msn-row="' + i + '">' +
        '<div class="msn-ic">' + def.ic + '</div>' +
        '<div class="msn-mid"><div class="msn-n">' + def.name + '</div>' +
        '<div class="msn-b">' + def.blurb.replace('{N}', '<b>' + G.formatNum(mi.n) + '</b>') + '</div>' +
        '<div class="msn-bar"><i data-msn-fill style="width:' + pct + '%"></i></div>' +
        '<div class="msn-prog" data-msn-prog>' + G.formatNum(Math.min(mi.done, mi.n)) + ' / ' + G.formatNum(mi.n) + '</div>' +
        '<div class="msn-rw">' + rwChips(rw) + '</div></div>' +
        (mi.claimed ? '<div class="msn-done">✓</div>'
          : done ? '<button class="msn-claim" data-claim="' + i + '">CLAIM</button>'
          : '') + '</div>';
    });
    const allDone = doneN >= 10;
    const bonusRw = scaleRw({ lc: 50, fuel: Math.round(300 * dayScale(z)), iron: Math.round(200 * dayScale(z)), plasma: Math.round(150 * dayScale(z)) }, tier, cfg);
    html += '<div class="msn-bonus ' + (b.allClaimed ? 'claimed' : allDone ? 'ready' : '') + '">' +
      '<div class="mb-glow"></div><div class="mb-ic">▣</div>' +
      '<div class="msn-mid"><div class="msn-n">COMMANDER\'S CRATE · ' + cfg.label + ' TIER ' + tier + '</div>' +
      '<div class="msn-b">Clear all 10 · <b>' + claimedN + '/10 claimed</b> · claiming unlocks <b>TIER ' + (tier + 1) + '</b> (rewards ×2)</div>' +
      '<div class="msn-rw">' + rwChips(bonusRw) + '</div></div>' +
      (b.allClaimed ? '<div class="msn-done">✓</div>' : allDone ? '<button class="msn-claim gold" data-bonus="1">CLAIM</button>' : '<div class="msn-lockp" data-msn-lockp>' + doneN + '/10</div>') + '</div>';
    return html;
  }
  // ---------------------------------------------------------------------------
  // IN-PLACE PROGRESS PATCH — the 1s tick moves counters CONSTANTLY while you fly.
  // Rebuilding the board's innerHTML on every one of those ticks is what made the
  // numbers strobe: each swap threw away the live nodes, so the bars could not
  // animate (a brand-new element with an inline width has nothing to transition
  // FROM), the scroll position had to be restored by hand a frame later, and a
  // claim button could be replaced under a thumb mid-tap. Counters now write
  // straight into the existing nodes, and the DOM is only rebuilt when the board
  // STRUCTURE changes — a mission completing, a claim, a tier-up, a reset.
  // ---------------------------------------------------------------------------
  function structSig(cfg, b) {
    return TAB + '|' + (b.tier || 1) + '|' + (b.allClaimed ? 1 : 0) + '|' +
      b.list.map((m) => m.id + (m.done >= m.n ? 'D' : '') + (m.claimed ? 'C' : '')).join(',');
  }
  function patchBoard(body, cfg, b) {
    const rows = body.querySelectorAll('[data-msn-row]');
    if (rows.length !== b.list.length) return false;
    rows.forEach((row) => {
      const mi = b.list[+row.dataset.msnRow]; if (!mi) return;
      const fill = row.querySelector('[data-msn-fill]');
      const prog = row.querySelector('[data-msn-prog]');
      const w = Math.min(100, mi.done / mi.n * 100).toFixed(2) + '%';
      if (fill && fill.style.width !== w) fill.style.width = w;
      const txt = G.formatNum(Math.min(mi.done, mi.n)) + ' / ' + G.formatNum(mi.n);
      if (prog && prog.textContent !== txt) prog.textContent = txt;
    });
    const doneN = b.list.filter((m) => m.done >= m.n).length;
    const ring = body.querySelector('[data-msn-ring]');
    if (ring) ring.style.setProperty('--p', (doneN / 10 * 360) + 'deg');
    const rn = body.querySelector('[data-msn-ringn]');
    if (rn && rn.firstChild) rn.firstChild.nodeValue = doneN;
    const lp = body.querySelector('[data-msn-lockp]');
    if (lp) lp.textContent = doneN + '/10';
    const cd = body.querySelector('[data-msn-cd]');
    if (cd) cd.textContent = fmtLeft(cfg.left());
    return true;
  }
  function render() {
    const body = $('missions-body'); if (!body) return;
    ensureShared();
    const sub = $('missions-sub');
    let html = tabsHtml();
    let cfg = null, b = null;
    if (TAB === 'life') {
      html += window.ACHIEVE ? window.ACHIEVE.html() : '';
      if (sub && window.ACHIEVE) sub.textContent = 'Lifetime badges';
    } else {
      cfg = boardCfg(TAB); b = ensureBoard(cfg);
      html += boardHtml(cfg, b);
      if (sub) sub.textContent = cfg.label.charAt(0) + cfg.label.slice(1).toLowerCase() + ' · Tier ' + (b.tier || 1) + ' · ' + b.list.filter((m) => m.done >= m.n).length + '/10 · resets ' + fmtLeft(cfg.left());
    }
    // FLICKER GUARD 1 — a board whose STRUCTURE is unchanged never swaps DOM.
    // Only the moving numbers are written into the live nodes (see patchBoard).
    if (cfg && b) {
      const sig = structSig(cfg, b);
      if (body._msnSig === sig && body._msnHtml && patchBoard(body, cfg, b)) {
        patchTabs(body);
        if (sub) sub.textContent = cfg.label.charAt(0) + cfg.label.slice(1).toLowerCase() + ' · Tier ' + (b.tier || 1) + ' · ' + b.list.filter((m) => m.done >= m.n).length + '/10 · resets ' + fmtLeft(cfg.left());
        return;
      }
      body._msnSig = sig;
    } else if (TAB === 'life' && window.ACHIEVE && window.ACHIEVE.sig) {
      // THE BADGES TAB GETS THE SAME CONTRACT as a board: patch the live numbers,
      // rebuild only when the ladder's structure moves. Re-innerHTML'ing 1,110
      // badge cards plus the Titan Sina hero image every second is what made this
      // tab flicker. See ACHIEVE.sig()/patch().
      const asig = 'life|' + window.ACHIEVE.sig();
      if (body._msnSig === asig && body._msnHtml && window.ACHIEVE.patch(body)) { patchTabs(body); return; }
      body._msnSig = asig;
    } else body._msnSig = null;
    // preserve scroll through re-renders
    let _sc = body; while (_sc && _sc !== document.documentElement && _sc.scrollHeight <= _sc.clientHeight + 4) _sc = _sc.parentElement;
    const _st = _sc ? _sc.scrollTop : 0;
    // FLICKER GUARD 2 — identical content (timers aside) skips the DOM swap
    if (body._msnHtml === html) return;
    body._msnHtml = html;
    body.innerHTML = html;
    if (_sc) _sc.scrollTop = _st;
    body.querySelectorAll('[data-tab]').forEach((t) => t.addEventListener('click', () => { TAB = t.dataset.tab; body._msnHtml = null; render(); }));
    if (TAB === 'life') { if (window.ACHIEVE) window.ACHIEVE.bind(body); return; }
    const lvl = G.state.level || 1, z = Math.max(1, G.state.highestUnlocked || 1), tier = b.tier || 1;
    body.querySelectorAll('[data-claim]').forEach((btn) => btn.addEventListener('click', () => {
      const mi = b.list[+btn.dataset.claim]; if (!mi || mi.claimed || mi.done < mi.n) return;
      const def = POOL.find((p) => p.id === mi.id);
      mi.claimed = true; creditMissions(cfg, 1);
      payout(scaleRw(def.rw(lvl, z), tier, cfg)); render(); syncBadge();
    }));
    const vb = body.querySelector('[data-veridian-accept]');
    if (vb) vb.addEventListener('click', acceptVeridian);
    const ca = body.querySelector('[data-claimall]');
    if (ca) ca.addEventListener('click', () => {
      // one payout for the whole sweep — rewards are summed so a ten-mission claim
      // doesn't fire ten separate toasts
      const total = {};
      let n = 0;
      b.list.forEach((mi) => {
        if (mi.claimed || mi.done < mi.n) return;
        const def = POOL.find((p) => p.id === mi.id); if (!def) return;
        mi.claimed = true; n++;
        creditMissions(cfg, 1);
        const rw = scaleRw(def.rw(lvl, z), tier, cfg);
        for (const k in rw) total[k] = (total[k] || 0) + rw[k];
      });
      if (!n) return;
      payout(total);
      const tl = $('toast-layer');
      if (tl) {
        const t = document.createElement('div');
        t.className = 'msn-toast';
        t.innerHTML = '<span class="mt-ic">✓</span><span><b>' + n + ' MISSION' + (n > 1 ? 'S' : '') + ' CLAIMED</b><br>' + cfg.label + ' board · rewards banked</span>';
        tl.appendChild(t); setTimeout(() => t.remove(), 3400);
      }
      render(); syncBadge();
    });
    const bb = body.querySelector('[data-bonus]');
    if (bb) bb.addEventListener('click', () => {
      const doneN = b.list.filter((m) => m.done >= m.n).length;
      if (b.allClaimed || doneN < 10) return;
      // auto-claim anything finished but unclaimed so the tier-up never eats rewards
      b.list.forEach((mi) => {
        if (!mi.claimed && mi.done >= mi.n) {
          const d = POOL.find((p) => p.id === mi.id);
          mi.claimed = true; creditMissions(cfg, 1);
          if (d) payout(scaleRw(d.rw(lvl, z), tier, cfg));
        }
      });
      const bonusRw = scaleRw({ lc: 50, fuel: Math.round(300 * dayScale(z)), iron: Math.round(200 * dayScale(z)), plasma: Math.round(150 * dayScale(z)) }, tier, cfg);
      b.allClaimed = true; payout(bonusRw);
      // TOUR OF DUTY no longer takes XP from THIS board (634). The season has its own
      // daily and weekly missions on its own screen, and paying from both would double
      // its budget. The calls are left in place because TOUR.dailyDone/weeklyDone are
      // now deliberate no-ops — a browser serving a cached copy of either file still
      // cannot pay twice.
      try {
        if (window.TOUR) {
          if (cfg.id === 'd') window.TOUR.dailyDone();
          else if (cfg.id === 'w') window.TOUR.weeklyDone();
        }
      } catch (e) {}
      const tl = $('toast-layer');
      if (tl) {
        const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#ffd24d';
        t.innerHTML = '▣ COMMANDER\'S CRATE · ' + cfg.label + ' TIER ' + tier + '<br><span style="font-size:13px">All 10 cleared · +' + G.formatNum(bonusRw.lc) + ' ◉ LootCoins</span>';
        tl.appendChild(t); setTimeout(() => t.remove(), 3600);
      }
      advanceTier(cfg);
      render(); syncBadge();
    });
  }
  // ===========================================================================
  // ⌘ VERIDIAN — the 1,000-lifetime-missions reward hull (daily tab hero)
  // ===========================================================================
  const VERIDIAN_NEED = 1000;
  function veridianBanner() {
    const owned = !!(G.state.ownedShips && G.state.ownedShips.veridian);
    const have = Math.min(VERIDIAN_NEED, G.state.lifetimeMissions | 0);
    const left = VERIDIAN_NEED - have;
    const ready = !owned && left <= 0;
    let right;
    if (owned) right = '<div class="vrd-owned">✓ IN YOUR HANGAR</div>';
    else if (ready) right = '<button class="msn-claim gold vrd-accept" data-veridian-accept="1">⌘ ACCEPT SHIP</button>';
    else right = '<div class="vrd-count"><b>' + left.toLocaleString() + '</b><span>missions to go</span></div>';
    return '<div class="vrd-hero' + (ready ? ' ready' : '') + (owned ? ' owned' : '') + '">' +
      '<div class="vrd-art"><img src="ships/ship-veridian.png" alt="Veridian" decoding="async"></div>' +
      '<div class="vrd-mid">' +
        '<div class="vrd-t">THE VERIDIAN <em>MISSION REWARD</em></div>' +
        '<div class="vrd-s">Complete <b>1,000 lifetime missions</b> (any board) to earn this Battleship-grade hull. Its verdant <b>resonance aura</b> constantly damages everything within a few tiles — scaling with your fleet\u2019s DPS.</div>' +
        '<div class="vrd-bar"><i style="width:' + (have / VERIDIAN_NEED * 100) + '%"></i><span>⌘ ' + have.toLocaleString() + ' / ' + VERIDIAN_NEED.toLocaleString() + ' lifetime missions</span></div>' +
      '</div>' + right + '</div>';
  }
  function acceptVeridian() {
    if (G.state.ownedShips && G.state.ownedShips.veridian) return;
    if ((G.state.lifetimeMissions | 0) < VERIDIAN_NEED) return;
    if (G.grantShip) G.grantShip('veridian');
    G.save();
    const tl = $('toast-layer');
    if (tl) {
      const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#7dff9e'; t.style.fontSize = '24px';
      t.innerHTML = '⌘ VERIDIAN ACCEPTED<br><span style="font-size:12px;color:#c9f5da">1,000 missions — the veteran\u2019s hull is yours. Equip it in the Hangar.</span>';
      tl.appendChild(t); setTimeout(() => t.remove(), 4600);
    }
    if (window.UI) window.UI.refreshAll();
    render();
  }

  function syncBadge() {
    if (!G || !G.state) return;
    let claimable = 0;
    BOARDS.forEach((c) => { claimable += boardClaimable(c); });
    if (window.ACHIEVE) claimable += window.ACHIEVE.claimable();
    const b = $('cmd-msn-badge');
    if (b) { b.style.display = claimable ? '' : 'none'; b.textContent = claimable; }
    // the per-tab dots ride the same beat, so a badge rank landing while you are
    // looking at a mission board lights the BADGES tab immediately
    const body = $('missions-body');
    if (body && document.querySelector('#screen-missions.active')) patchTabs(body);
  }

  // ---------------------------------------------------------------------------
  function init(game) {
    G = game;
    ensureShared();
    BOARDS.forEach(ensureBoard);
    watchBoss();
    setInterval(tick, 1000);
    // countdown refresh — patch ticking text IN PLACE (no innerHTML rebuild)
    setInterval(() => {
      if (!document.querySelector('#screen-missions.active') || TAB === 'life') return;
      const cfg = boardCfg(TAB); if (!cfg) return;
      const cd = document.querySelector('#missions-body [data-msn-cd]'); if (cd) cd.textContent = fmtLeft(cfg.left());
      const sub = $('missions-sub'); const b = G.state[cfg.key];
      if (sub && b && b.list) sub.textContent = cfg.label.charAt(0) + cfg.label.slice(1).toLowerCase() + ' · Tier ' + (b.tier || 1) + ' · ' + b.list.filter((m) => m.done >= m.n).length + '/10 · resets ' + fmtLeft(cfg.left());
    }, 30000);
    syncBadge();
  }
  function boot() { if (window.GAME && window.GAME.state) init(window.GAME); else setTimeout(boot, 500); }
  setTimeout(boot, 1000);
  window.MISSIONS = { init, render, syncBadge };

  // ---- CSS (self-injected) ---------------------------------------------------
  const CSS = `
  .msn-tabs{ display:flex; gap:6px; margin-bottom:12px; position:sticky; top:0; z-index:3; background:linear-gradient(180deg,var(--bg,#0a0f1a) 70%,transparent); padding:2px 0 6px; }
  .msn-tab{ flex:1; position:relative; font-family:'Orbitron',sans-serif; font-weight:800; font-size:9.5px; letter-spacing:.08em;
    color:#8fa2bd; background:linear-gradient(180deg,#131c2c,#0c1220); border:1px solid #2c3b56; border-radius:10px; padding:9px 4px; cursor:pointer; }
  .msn-tab.on{ color:#dbe8fa; border-color:#59d98c; box-shadow:0 0 10px -3px rgba(89,217,140,.5); }
  .msn-td{ position:absolute; top:-5px; right:-4px; min-width:15px; height:15px; border-radius:8px; font-style:normal; font-family:'Rajdhani',sans-serif;
    font-size:9.5px; font-weight:800; color:#04140a; background:#59d98c; display:grid; place-items:center; padding:0 3px; box-shadow:0 0 8px -1px rgba(89,217,140,.8); }
  .msn-head-card{ position:relative; display:flex; align-items:center; justify-content:space-between; gap:12px;
    background:radial-gradient(140% 180% at 10% -20%, rgba(95,160,255,.16), transparent 55%), linear-gradient(180deg,#131c2c,#0c1220);
    border:1px solid #2c3b56; border-radius:14px; padding:13px 15px; margin-bottom:12px; }
  .mh-t{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:13px; letter-spacing:.1em; color:#dbe8fa; }
  .mh-tier{ display:inline-block; margin-left:7px; padding:2px 8px; border-radius:8px; font-size:10px; letter-spacing:.08em;
    color:#ffd24d; background:rgba(255,210,77,.1); border:1px solid rgba(255,210,77,.4); vertical-align:1px; }
  .mh-s{ font-size:10.5px; color:#8fa2bd; margin-top:4px; } .mh-s b{ color:#cfe0f5; }
  .mh-ring{ width:54px; height:54px; flex:none; border-radius:50%; display:grid; place-items:center;
    background:conic-gradient(#59d98c var(--p,0deg), rgba(89,217,140,.12) 0); position:relative; }
  .mh-ring::before{ content:''; position:absolute; inset:5px; border-radius:50%; background:#0d1524; }
  .mh-ring span{ position:relative; font-family:'Orbitron',sans-serif; font-weight:800; font-size:14px; color:#7ce0a0; }
  .mh-ring span i{ font-style:normal; font-size:9px; color:#5f7590; }
  .msn-card{ display:flex; align-items:center; gap:11px; background:linear-gradient(180deg,#141d2d,#0e1522);
    border:1px solid #263650; border-radius:13px; padding:11px 12px; margin-bottom:9px; position:relative; }
  .msn-card.ready{ border-color:rgba(89,217,140,.55); box-shadow:0 0 14px -4px rgba(89,217,140,.4); }
  .msn-card.claimed{ opacity:.5; }
  .msn-ic{ width:36px; height:36px; flex:none; border-radius:10px; display:grid; place-items:center;
    font-size:17px; color:#8fc4ff; background:radial-gradient(120% 120% at 50% 0%,#1e2a3f,#111827); border:1px solid #33445f; }
  .msn-card.ready .msn-ic{ color:#7ce0a0; border-color:rgba(89,217,140,.5); }
  .msn-mid{ flex:1; min-width:0; }
  .msn-n{ font-family:'Orbitron',sans-serif; font-weight:700; font-size:11.5px; color:#e8f0fb; letter-spacing:.03em; }
  .msn-b{ font-size:10.5px; color:#93a5bd; margin-top:2px; } .msn-b b{ color:#ffd24d; }
  .msn-bar{ height:5px; border-radius:3px; background:rgba(120,150,200,.14); margin-top:6px; overflow:hidden; }
  .msn-bar i{ display:block; height:100%; border-radius:3px; background:linear-gradient(90deg,#3f8cff,#59d98c); transition:width .4s; }
  .msn-card.ready .msn-bar i{ background:linear-gradient(90deg,#59d98c,#a4f0c0); }
  .msn-prog{ font-size:9.5px; color:#6c8098; margin-top:3px; font-variant-numeric:tabular-nums; }
  .msn-rw{ display:flex; flex-wrap:wrap; gap:5px; margin-top:6px; }
  .mr-chip{ font-size:9.5px; font-weight:700; padding:2px 7px; border-radius:8px; color:var(--c);
    background:color-mix(in srgb, var(--c) 12%, transparent); border:1px solid color-mix(in srgb, var(--c) 35%, transparent); }
  .mr-chip.mr-lc{ box-shadow:0 0 8px -2px rgba(255,210,77,.6); }
  .msn-claim{ flex:none; font-family:'Orbitron',sans-serif; font-weight:800; font-size:10px; letter-spacing:.08em;
    color:#04140a; background:linear-gradient(180deg,#7ce0a0,#3fae6c); border:none; border-radius:9px; padding:9px 13px; cursor:pointer;
    box-shadow:0 0 12px -2px rgba(89,217,140,.7); animation:msnClaimPulse 1.6s ease-in-out infinite; }
  .msn-claim.gold{ color:#231302; background:linear-gradient(180deg,#ffd24d,#e09a2d); box-shadow:0 0 14px -2px rgba(255,210,77,.8); }
  .msn-claimall{ display:flex; align-items:center; justify-content:center; gap:8px; width:100%; margin:0 0 9px; cursor:pointer;
    font-family:'Orbitron',sans-serif; font-weight:800; font-size:11px; letter-spacing:.1em; color:#04140a; border:none; border-radius:11px; padding:12px;
    background:linear-gradient(180deg,#9df0bb,#3fae6c); box-shadow:0 0 16px -4px rgba(89,217,140,.8); animation:msnClaimPulse 1.6s ease-in-out infinite; }
  .msn-claimall i{ font-style:normal; font-size:10px; padding:2px 7px; border-radius:99px; background:rgba(4,20,10,.28); }
  .msn-claimall:active{ transform:scale(.98); }
  .msn-claim:active{ transform:scale(.94); }
  @keyframes msnClaimPulse{ 0%,100%{ filter:brightness(1);} 50%{ filter:brightness(1.18);} }
  .msn-done{ flex:none; width:26px; height:26px; border-radius:50%; display:grid; place-items:center;
    color:#7ce0a0; border:1.5px solid rgba(89,217,140,.55); font-weight:800; }
  .msn-lockp{ flex:none; font-family:'Orbitron',sans-serif; font-size:11px; font-weight:800; color:#5f7590; }
  .msn-bonus{ display:flex; align-items:center; gap:11px; position:relative; overflow:hidden;
    background:radial-gradient(150% 200% at 8% -30%, rgba(255,210,77,.14), transparent 55%), linear-gradient(180deg,#1a1707,#100d05);
    border:1.5px solid rgba(255,210,77,.4); border-radius:14px; padding:13px 12px; margin:14px 0 6px; }
  .msn-bonus.ready{ border-color:rgba(255,210,77,.85); box-shadow:0 0 20px -5px rgba(255,210,77,.6); }
  .msn-bonus.claimed{ opacity:.55; }
  .msn-bonus .msn-n{ color:#ffd24d; }
  .mb-ic{ width:40px; height:40px; flex:none; border-radius:11px; display:grid; place-items:center; font-size:20px; color:#ffd24d;
    background:radial-gradient(120% 120% at 50% 0%,#2c2410,#151005); border:1px solid rgba(255,210,77,.45);
    box-shadow:0 0 12px -3px rgba(255,210,77,.7); }
  .mb-glow{ position:absolute; inset:-40%; background:conic-gradient(from 0deg, transparent, rgba(255,210,77,.12), transparent 30%);
    animation:msnRays 7s linear infinite; pointer-events:none; }
  @keyframes msnRays{ to{ transform:rotate(1turn);} }
  .msn-toast{ display:flex; align-items:center; gap:10px; background:linear-gradient(180deg,#12241a,#0b1a12);
    border:1px solid rgba(89,217,140,.55); border-radius:12px; padding:10px 14px; color:#d5f5e2; font-size:11.5px;
    box-shadow:0 8px 24px rgba(0,0,0,.5), 0 0 16px -4px rgba(89,217,140,.5); animation:msnToastIn .35s cubic-bezier(.2,1.4,.4,1); }
  .msn-toast b{ color:#7ce0a0; font-family:'Orbitron',sans-serif; font-size:10px; letter-spacing:.1em; }
  .msn-toast .mt-ic{ font-size:18px; color:#7ce0a0; }
  @keyframes msnToastIn{ from{ transform:translateY(14px) scale(.92); opacity:0; } }
  @media (prefers-reduced-motion: reduce){ .msn-claim,.mb-glow{ animation:none; } }
  /* ⌘ VERIDIAN hero banner */
  .vrd-hero{ display:flex; align-items:center; gap:12px; background:linear-gradient(115deg,#0d1f14,#0b1611 60%,#101d24); border:1.5px solid rgba(89,217,140,.4);
    border-radius:14px; padding:12px; margin:0 0 12px; position:relative; overflow:hidden; }
  .vrd-hero.ready{ border-color:rgba(165,242,196,.9); box-shadow:0 0 22px -5px rgba(89,217,140,.65); }
  .vrd-hero.owned{ opacity:.78; }
  .vrd-art{ flex:none; width:86px; height:64px; display:grid; place-items:center; }
  .vrd-art img{ width:100%; height:100%; object-fit:contain; filter:drop-shadow(0 0 12px rgba(89,217,140,.75)); }
  .vrd-mid{ flex:1; min-width:0; }
  .vrd-t{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:12px; letter-spacing:.1em; color:#c9f5da; }
  .vrd-t em{ font-style:normal; font-family:'Rajdhani',sans-serif; font-size:8.5px; font-weight:800; letter-spacing:.12em; color:#04240f;
    background:linear-gradient(90deg,#a5f2c4,#59d98c); border-radius:5px; padding:2px 5px; margin-left:5px; vertical-align:2px; }
  .vrd-s{ font-family:'Rajdhani',sans-serif; font-weight:600; font-size:11px; color:#9cc4ab; line-height:1.4; margin:3px 0 7px; }
  .vrd-s b{ color:#d6ffe6; }
  .vrd-bar{ position:relative; height:16px; border-radius:9px; background:#0e1a13; border:1px solid rgba(89,217,140,.3); overflow:hidden; }
  .vrd-bar i{ display:block; height:100%; background:linear-gradient(90deg,#2f7d4f,#59d98c); box-shadow:0 0 10px rgba(89,217,140,.6); transition:width .3s; }
  .vrd-bar span{ position:absolute; inset:0; display:grid; place-items:center; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:10px; color:#eafff2; text-shadow:0 1px 3px #000; }
  .vrd-count{ flex:none; text-align:center; font-family:'Orbitron',sans-serif; color:#a5f2c4; padding:0 4px; }
  .vrd-count b{ display:block; font-size:16px; }
  .vrd-count span{ font-family:'Rajdhani',sans-serif; font-size:9px; font-weight:700; color:#7ba98d; letter-spacing:.06em; }
  .vrd-owned{ flex:none; font-family:'Orbitron',sans-serif; font-weight:800; font-size:10px; letter-spacing:.08em; color:#7ce0a0; border:1.5px solid rgba(89,217,140,.5); border-radius:9px; padding:8px 10px; }
  .vrd-accept{ font-size:11px !important; padding:11px 14px !important; }
  `;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
})();
