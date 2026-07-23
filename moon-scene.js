/* =============================================================================
   missions.js — MISSION BOARDS (Command ▸ Missions) · DAILY / WEEKLY / MONTHLY
   ---------------------------------------------------------------------------
   Three boards on internal tabs, all fed by ONE delta engine (1s poll of
   positive state deltas — no game mechanics touched):
     • DAILY   — 10 orders, local-midnight reset, TIER ladder: clearing the
       board unlocks the next tier same day (targets up steeply, rewards ×2/tier).
     • WEEKLY  — 5 campaign orders, ~8× daily scale, resets Monday 00:00 local.
       Big LootCoin rewards + WAR CHEST crate for the full clear.
     • MONTHLY — 3 grand operations, ~30× daily scale, resets the 1st.
       Huge LC + ◇ Dread Core rewards + CAMPAIGN TROPHY crate.
   Every claim (any board) counts toward the ⌘ VERIDIAN 1,000-mission hull.
============================================================================= */
(function () {
  'use strict';
  let G = null;
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------------------
  // POOLS — id, name, blurb, metric, target(level,zone), reward(level,zone)
  // ---------------------------------------------------------------------------
  const dayScale = (z) => Math.max(1, Math.pow(z, 1.15));
  const POOL = [
    { id: 'kills1',  ic: '⌖', name: 'Clear the Lanes',    blurb: 'Destroy {N} enemy ships',            m: 'kills',  n: (l, z) => 150 + Math.round(l * 6),        rw: (l, z) => ({ gold: Math.round(900 * dayScale(z)) }) },
    { id: 'kills2',  ic: '☄', name: 'Full Sweep',         blurb: 'Destroy {N} enemy ships',            m: 'kills',  n: (l, z) => 400 + Math.round(l * 14),       rw: (l, z) => ({ gold: Math.round(1500 * dayScale(z)), lc: 10 }) },
    { id: 'boss1',   ic: '◈', name: 'Decapitation Strike', blurb: 'Destroy {N} bosses',                m: 'bosses', n: () => 2,                                  rw: (l, z) => ({ iron: Math.round(120 * dayScale(z)), lc: 10 }) },
    { id: 'boss2',   ic: '♛', name: 'Warlord Purge',      blurb: 'Destroy {N} bosses',                 m: 'bosses', n: () => 5,                                  rw: (l, z) => ({ plasma: Math.round(90 * dayScale(z)), lc: 15 }) },
    { id: 'gold1',   ic: '$', name: 'War Chest',          blurb: 'Earn {N} gold from combat',          m: 'gold',   n: (l, z) => Math.round(4000 * dayScale(z)), rw: (l, z) => ({ fuel: Math.round(220 * dayScale(z)) }) },
    { id: 'fuel1',   ic: '⬢', name: 'Fuel Skimmer',       blurb: 'Scavenge {N} fuel',                  m: 'fuel',   n: (l, z) => Math.round(60 * dayScale(z)),   rw: (l, z) => ({ iron: Math.round(80 * dayScale(z)), lc: 5 }) },
    { id: 'iron1',   ic: '◆', name: 'Iron Harvest',       blurb: 'Scavenge {N} iron',                  m: 'iron',   n: (l, z) => Math.round(40 * dayScale(z)),   rw: (l, z) => ({ plasma: Math.round(60 * dayScale(z)), lc: 5 }) },
    { id: 'plas1',   ic: '✦', name: 'Plasma Rush',        blurb: 'Scavenge {N} plasma',                m: 'plasma', n: (l, z) => Math.round(30 * dayScale(z)),   rw: (l, z) => ({ gold: Math.round(1200 * dayScale(z)), lc: 5 }) },
    { id: 'xp1',     ic: '▲', name: 'Flight Hours',       blurb: 'Gain {N} account levels',            m: 'levels', n: (l) => l < 40 ? 2 : 1,                    rw: (l, z) => ({ fuel: Math.round(150 * dayScale(z)), iron: Math.round(60 * dayScale(z)) }) },
    { id: 'zone1',   ic: '⌬', name: 'Push the Frontier',  blurb: 'Deploy into {N} different zones',    m: 'zones',  n: () => 3,                                  rw: (l, z) => ({ gold: Math.round(1100 * dayScale(z)), lc: 5 }) },
    { id: 'time1',   ic: '◷', name: 'On Patrol',          blurb: 'Fly {N} minutes of combat',          m: 'mins',   n: () => 15,                                 rw: (l, z) => ({ fuel: Math.round(180 * dayScale(z)) }) },
    { id: 'loot1',   ic: '⬡', name: 'Salvage Run',        blurb: 'Pick up {N} pieces of loot',         m: 'loot',   n: (l) => 12 + Math.min(18, Math.round(l / 4)), rw: (l, z) => ({ iron: Math.round(70 * dayScale(z)), lc: 5 }) },
    { id: 'kills3',  ic: '⛬', name: 'Ace of the Sector',  blurb: 'Destroy {N} enemy ships',            m: 'kills',  n: (l, z) => 800 + Math.round(l * 20),       rw: (l, z) => ({ gold: Math.round(2600 * dayScale(z)), lc: 15 }) },
    { id: 'boss3',   ic: '⚑', name: 'Super Heavy',        blurb: 'Destroy {N} bosses',                 m: 'bosses', n: () => 8,                                  rw: (l, z) => ({ fuel: Math.round(260 * dayScale(z)), plasma: Math.round(80 * dayScale(z)), lc: 15 }) },
    { id: 'gold2',   ic: '⛁', name: 'Deep Pockets',       blurb: 'Earn {N} gold from combat',          m: 'gold',   n: (l, z) => Math.round(12000 * dayScale(z)), rw: (l, z) => ({ iron: Math.round(140 * dayScale(z)), lc: 10 }) },
    { id: 'zone2',   ic: '✈', name: 'Long Haul',          blurb: 'Deploy into {N} different zones',    m: 'zones',  n: () => 6,                                  rw: (l, z) => ({ plasma: Math.round(110 * dayScale(z)), lc: 10 }) },
    { id: 'time2',   ic: '☉', name: 'Double Shift',       blurb: 'Fly {N} minutes of combat',          m: 'mins',   n: () => 45,                                 rw: (l, z) => ({ gold: Math.round(2000 * dayScale(z)), fuel: Math.round(200 * dayScale(z)) }) },
    { id: 'loot2',   ic: '❖', name: 'Cargo Bay Bulge',    blurb: 'Pick up {N} pieces of loot',         m: 'loot',   n: (l) => 30 + Math.min(30, Math.round(l / 3)), rw: (l, z) => ({ gold: Math.round(1800 * dayScale(z)), lc: 10 }) },
    { id: 'gal1',    ic: '⬢', name: 'Land Grab',          blurb: 'Capture {N} galaxy tiles',           m: 'tiles',  n: () => 2,                                  rw: (l, z) => ({ fuel: Math.round(240 * dayScale(z)), lc: 10 }), req: 25 },
    { id: 'gal2',    ic: '⚑', name: 'Warpath',            blurb: 'Capture {N} galaxy tiles',           m: 'tiles',  n: () => 5,                                  rw: (l, z) => ({ plasma: Math.round(120 * dayScale(z)), lc: 20 }), req: 25 },
    { id: 'moon1',   ic: '🌙', name: 'Colony Shipment',   blurb: 'Collect {N} resources from your Moon Colony', m: 'moon', n: (l, z) => Math.round(1500 * dayScale(z)), rw: (l, z) => ({ gold: Math.round(2000 * dayScale(z)), lc: 10 }), req: 30 },
    { id: 'moon2',   ic: '⛏', name: 'Colony Foreman',     blurb: 'Build or upgrade {N} colony structures', m: 'colony', n: () => 3,                              rw: (l, z) => ({ iron: Math.round(160 * dayScale(z)), lc: 15 }), req: 30 },
  ];
  // WEEKLY — campaign-length orders, ~8× daily scale, chunky LootCoins
  const WPOOL = [
    { id: 'wkills', ic: '⌖', name: 'Sector Purge',       blurb: 'Destroy {N} enemy ships',        m: 'kills',  n: (l, z) => 4000 + Math.round(l * 80),          rw: (l, z) => ({ gold: Math.round(12000 * dayScale(z)), lc: 60 }) },
    { id: 'wboss',  ic: '♛', name: 'Warlord Season',     blurb: 'Destroy {N} bosses',             m: 'bosses', n: () => 30,                                     rw: (l, z) => ({ plasma: Math.round(700 * dayScale(z)), lc: 80 }) },
    { id: 'wgold',  ic: '⛁', name: 'Weekly Ledger',      blurb: 'Earn {N} gold from combat',      m: 'gold',   n: (l, z) => Math.round(80000 * dayScale(z)),    rw: (l, z) => ({ fuel: Math.round(1800 * dayScale(z)), lc: 60 }) },
    { id: 'wfuel',  ic: '⬢', name: 'Fuel Convoy',        blurb: 'Scavenge {N} fuel',              m: 'fuel',   n: (l, z) => Math.round(450 * dayScale(z)),      rw: (l, z) => ({ iron: Math.round(700 * dayScale(z)), lc: 60 }) },
    { id: 'wzone',  ic: '✈', name: 'Grand Tour',         blurb: 'Deploy into {N} different zones', m: 'zones', n: () => 8,                                      rw: (l, z) => ({ gold: Math.round(9000 * dayScale(z)), lc: 60 }) },
    { id: 'wtime',  ic: '☉', name: 'Week on the Wing',   blurb: 'Fly {N} minutes of combat',      m: 'mins',   n: () => 180,                                    rw: (l, z) => ({ gold: Math.round(15000 * dayScale(z)), fuel: Math.round(1500 * dayScale(z)), lc: 80 }) },
    { id: 'wloot',  ic: '❖', name: 'Salvage Fleet',      blurb: 'Pick up {N} pieces of loot',     m: 'loot',   n: (l) => 150 + Math.min(150, l),                rw: (l, z) => ({ plasma: Math.round(500 * dayScale(z)), lc: 60 }) },
    { id: 'wlvl',   ic: '▲', name: 'Rising Commander',   blurb: 'Gain {N} account levels',        m: 'levels', n: (l) => l < 40 ? 8 : l < 150 ? 5 : 3,          rw: (l, z) => ({ fuel: Math.round(1200 * dayScale(z)), iron: Math.round(500 * dayScale(z)), lc: 60 }) },
    { id: 'wtile',  ic: '⚑', name: 'Territory Push',     blurb: 'Capture {N} galaxy tiles',       m: 'tiles',  n: () => 12,                                     rw: (l, z) => ({ plasma: Math.round(800 * dayScale(z)), lc: 100 }), req: 25 },
    { id: 'wcol',   ic: '⛏', name: 'Colonial Charter',   blurb: 'Build or upgrade {N} colony structures', m: 'colony', n: () => 10,                             rw: (l, z) => ({ gold: Math.round(18000 * dayScale(z)), lc: 100 }), req: 30 },
  ];
  // MONTHLY — grand operations, ~30× daily scale, LC + ◇ Dread Cores
  const MPOOL = [
    { id: 'mkills', ic: '☄', name: 'Extermination Order', blurb: 'Destroy {N} enemy ships',        m: 'kills',  n: (l, z) => 20000 + Math.round(l * 300),        rw: (l, z) => ({ gold: Math.round(60000 * dayScale(z)), lc: 300 }) },
    { id: 'mboss',  ic: '◈', name: 'Century of Skulls',   blurb: 'Destroy {N} bosses',             m: 'bosses', n: () => 120,                                    rw: () => ({ lc: 400, cores: 2 }) },
    { id: 'mgold',  ic: '$', name: 'Imperial Treasury',   blurb: 'Earn {N} gold from combat',      m: 'gold',   n: (l, z) => Math.round(400000 * dayScale(z)),   rw: (l, z) => ({ fuel: Math.round(8000 * dayScale(z)), lc: 300 }) },
    { id: 'mtime',  ic: '◷', name: 'Iron Endurance',      blurb: 'Fly {N} minutes of combat',      m: 'mins',   n: () => 600,                                    rw: (l, z) => ({ gold: Math.round(50000 * dayScale(z)), lc: 400 }) },
    { id: 'mzone',  ic: '⌬', name: 'Master of the Map',   blurb: 'Deploy into {N} different zones', m: 'zones', n: () => 12,                                     rw: (l, z) => ({ plasma: Math.round(3000 * dayScale(z)), lc: 300 }) },
    { id: 'mlvl',   ic: '▲', name: 'Meteoric Rise',       blurb: 'Gain {N} account levels',        m: 'levels', n: (l) => l < 40 ? 25 : l < 150 ? 15 : 8,        rw: (l, z) => ({ iron: Math.round(5000 * dayScale(z)), lc: 300 }) },
    { id: 'mloot',  ic: '⬡', name: 'Salvage Empire',      blurb: 'Pick up {N} pieces of loot',     m: 'loot',   n: (l) => 500 + Math.min(500, l * 3),            rw: (l, z) => ({ fuel: Math.round(6000 * dayScale(z)), lc: 300 }) },
    { id: 'mtile',  ic: '⚑', name: 'Empire Builder',      blurb: 'Capture {N} galaxy tiles',       m: 'tiles',  n: () => 40,                                     rw: () => ({ lc: 500, cores: 2 }), req: 25 },
    { id: 'mcol',   ic: '🌙', name: 'Lunar Dominion',     blurb: 'Build or upgrade {N} colony structures', m: 'colony', n: () => 30,                             rw: (l, z) => ({ gold: Math.round(70000 * dayScale(z)), lc: 400 }), req: 30 },
  ];

  // ---- DAILY TIER SCALING ----------------------------------------------------
  const TIER_TARGET = [1, 2.4, 6, 15, 38];
  const targetMult = (t) => (t <= 5 ? TIER_TARGET[t - 1] : 38 * Math.pow(2.5, t - 5));
  const rwMult = (t) => Math.pow(2, t - 1);
  function scaleRw(rw, tier) {
    const m = rwMult(tier), out = {};
    for (const k in rw) out[k] = Math.round(rw[k] * m);
    return out;
  }

  // ---------------------------------------------------------------------------
  // PERIOD KEYS + COUNTDOWNS (all local time)
  // ---------------------------------------------------------------------------
  const dayKey = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  const weekKey = () => { const d = new Date(); const dow = (d.getDay() + 6) % 7; const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow); return 'W' + mon.getFullYear() + '-' + (mon.getMonth() + 1) + '-' + mon.getDate(); };
  const monthKey = () => { const d = new Date(); return 'M' + d.getFullYear() + '-' + (d.getMonth() + 1); };
  const msDay = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1) - d; };
  const msWeek = () => { const d = new Date(); const dow = (d.getDay() + 6) % 7; return new Date(d.getFullYear(), d.getMonth(), d.getDate() + (7 - dow)) - d; };
  const msMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 1) - d; };
  function fmtDur(ms) {
    const t = ms / 1000;
    if (t >= 86400) return Math.floor(t / 86400) + 'd ' + Math.floor((t % 86400) / 3600) + 'h';
    return Math.floor(t / 3600) + 'h ' + Math.floor((t % 3600) / 60) + 'm';
  }

  // ---------------------------------------------------------------------------
  // BOARDS — d(aily) has the tier ladder; w(eekly)/m(onthly) are single boards
  // ---------------------------------------------------------------------------
  const BOARDS = {
    d: { key: 'missions',  count: 10, pool: POOL,  label: 'DAILY',   title: 'DAILY MISSION BOARD',  pk: dayKey,   left: msDay,   resetTxt: 'resets at midnight', tiered: true },
    w: { key: 'missionsW', count: 5,  pool: WPOOL, label: 'WEEKLY',  title: 'WEEKLY CAMPAIGN',      pk: weekKey,  left: msWeek,  resetTxt: 'resets Monday 00:00' },
    m: { key: 'missionsM', count: 3,  pool: MPOOL, label: 'MONTHLY', title: 'MONTHLY OPERATIONS',   pk: monthKey, left: msMonth, resetTxt: 'resets on the 1st' },
  };
  function crateRw(b, tier) {
    const z = Math.max(1, G.state.highestUnlocked || 1), ds = dayScale(z);
    if (b === 'd') return scaleRw({ lc: 100, fuel: Math.round(300 * ds), iron: Math.round(200 * ds), plasma: Math.round(150 * ds) }, tier || 1);
    if (b === 'w') return { lc: 500, fuel: Math.round(2500 * ds), iron: Math.round(1800 * ds), plasma: Math.round(1200 * ds) };
    return { lc: 2000, cores: 3, gold: Math.round(150000 * ds), fuel: Math.round(10000 * ds), iron: Math.round(8000 * ds), plasma: Math.round(6000 * ds) };
  }
  const CRATE_NAME = { d: 'COMMANDER\'S CRATE', w: 'WAR CHEST', m: 'CAMPAIGN TROPHY' };

  function seededShuffle(arr, seed) {
    const a = arr.slice();
    let s = 0; for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
    for (let i = a.length - 1; i > 0; i--) { s = (s * 1664525 + 1013904223) >>> 0; const j = s % (i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  const freshAcc = () => ({ kills: 0, bosses: 0, gold: 0, fuel: 0, iron: 0, plasma: 0, levels: 0, zones: 0, mins: 0, loot: 0, hulls: 0, tiles: 0, moon: 0, colony: 0 });
  function buildList(b, tier) {
    const bd = BOARDS[b], s = G.state, lvl = s.level || 1, z = Math.max(1, s.highestUnlocked || 1);
    const eligible = bd.pool.filter((p) => !p.req || lvl >= p.req);
    const picks = seededShuffle(eligible, bd.pk() + ':t' + (tier || 1) + ':' + (s.playerName || 'cmdr')).slice(0, bd.count);
    const mult = bd.tiered ? targetMult(tier || 1) : 1;
    return picks.map((p) => {
      let n = Math.max(1, Math.round(p.n(lvl, z) * mult));
      if (p.m === 'zones') n = Math.min(n, Math.max(4, s.highestUnlocked || 4));
      return { id: p.id, n, done: 0, claimed: false };
    });
  }
  function ensureBoard(b) {
    const bd = BOARDS[b], s = G.state;
    let ms = s[bd.key];
    if (!ms || ms.day !== bd.pk()) {
      ms = s[bd.key] = { day: bd.pk(), tier: 1, list: buildList(b, 1), acc: freshAcc(), seen: {}, allClaimed: false };
      G.save();
    }
    if (bd.tiered) {
      if (!ms.tier) ms.tier = 1;
      if (ms.allClaimed) advanceTier();  // self-heal: crate claimed, tier never advanced
    }
    return ms;
  }
  // DAILY TIER-UP — fresh board at the next tier: harder targets, all rewards ×2
  function advanceTier() {
    const ms = G.state.missions;
    ms.tier++;
    ms.list = buildList('d', ms.tier);
    ms.acc = freshAcc(); ms.seen = {};
    ms.allClaimed = false;
    G.save();
    const tl = $('toast-layer');
    if (tl) {
      const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#8fc4ff';
      t.innerHTML = '⌁ MISSION TIER ' + ms.tier + ' UNLOCKED<br><span style="font-size:13px">10 new orders · all rewards ×' + G.formatNum(rwMult(ms.tier)) + '</span>';
      tl.appendChild(t); setTimeout(() => t.remove(), 3600);
    }
  }

  // ---------------------------------------------------------------------------
  // PROGRESS — one 1s poll; positive deltas feed EVERY board's accumulator
  // ---------------------------------------------------------------------------
  function snapshot() {
    const s = G.state, r = s.resources || {};
    return { kills: s.totalKills || 0, gold: s.gold || 0, fuel: r.fuel || 0, iron: r.iron || 0, plasma: r.plasma || 0,
             level: s.level || 1, play: s.playTime || 0, items: (s.inventory || []).length + (s.lifetimeLooted || 0), boss: bossCount(),
             hulls: hullLevelSum(), tiles: Object.keys(s.ownedSystems || {}).length, moon: moonLifetimeSum(), colony: colonyLevelSum() };
  }
  function hullLevelSum() {
    const sl = G.state.shipLevels || {}; let t = 0;
    for (const k in sl) t += sl[k] || 0;
    return t;
  }
  function moonLifetimeSum() {
    const lt = (G.state.moon && G.state.moon.lifetime) || {}; let t = 0;
    for (const k in lt) t += lt[k] || 0;
    return t;
  }
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
  function tick() {
    if (!G || !G.state) return;
    const s = G.state;
    const boards = { d: ensureBoard('d'), w: ensureBoard('w'), m: ensureBoard('m') };
    const now = snapshot();
    if (!s.missionsBase) { s.missionsBase = now; return; }
    const b = s.missionsBase;
    const dl = {
      kills: Math.max(0, now.kills - b.kills), gold: Math.max(0, now.gold - b.gold),
      fuel: Math.max(0, now.fuel - b.fuel), iron: Math.max(0, now.iron - b.iron), plasma: Math.max(0, now.plasma - b.plasma),
      levels: Math.max(0, now.level - b.level), bosses: Math.max(0, now.boss - b.boss), loot: Math.max(0, now.items - b.items),
      hulls: Math.max(0, now.hulls - (b.hulls || 0)), tiles: Math.max(0, now.tiles - (b.tiles || 0)),
      moon: Math.max(0, now.moon - (b.moon || 0)), colony: Math.max(0, now.colony - (b.colony || 0)),
    };
    s.missionsBase = now;
    const inZone = s.currentDungeon >= 1, zk = 'z' + s.currentDungeon;
    let changed = false;
    for (const k in boards) {
      const ms = boards[k], a = ms.acc, pool = BOARDS[k].pool;
      for (const mk in dl) if (dl[mk]) a[mk] = (a[mk] || 0) + dl[mk];
      if (inZone) {
        a.mins += 1 / 60;
        if (!ms.seen) ms.seen = {};
        if (!ms.seen[zk]) { ms.seen[zk] = 1; a.zones = (a.zones || 0) + 1; }
      }
      ms.list.forEach((mi) => {
        const def = pool.find((p) => p.id === mi.id); if (!def) return;
        const v = Math.min(mi.n, Math.floor(a[def.m] || 0));
        if (v > mi.done) { mi.done = v; changed = true;
          if (mi.done >= mi.n && !mi._toasted) { mi._toasted = true; missionToast(def, BOARDS[k].label); } }
      });
    }
    if (changed) { syncBadge(); if (document.querySelector('#screen-missions.active')) render(); }
  }
  function missionToast(def, label) {
    const tl = $('toast-layer'); if (!tl) return;
    const t = document.createElement('div');
    t.className = 'msn-toast';
    t.innerHTML = '<span class="mt-ic">' + def.ic + '</span><span><b>' + (label || '') + ' MISSION COMPLETE</b><br>' + def.name + ' — claim your reward</span>';
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
    if (rw.cores) s.dreadCores = (s.dreadCores || 0) + rw.cores;
    if (rw.lc && G.addCredits) G.addCredits(rw.lc); else if (rw.lc) s.credits = (s.credits || 0) + rw.lc;
    G.save(); if (window.UI) window.UI.refreshAll();
  }
  const rwChips = (rw) => [
    rw.gold ? '<span class="mr-chip" style="--c:#f2a93c">$ ' + G.formatNum(rw.gold) + '</span>' : '',
    rw.fuel ? '<span class="mr-chip" style="--c:#5bc0ff">⬢ ' + G.formatNum(rw.fuel) + '</span>' : '',
    rw.iron ? '<span class="mr-chip" style="--c:#d0a060">◆ ' + G.formatNum(rw.iron) + '</span>' : '',
    rw.plasma ? '<span class="mr-chip" style="--c:#c07bff">✦ ' + G.formatNum(rw.plasma) + '</span>' : '',
    rw.cores ? '<span class="mr-chip" style="--c:#ff6b78">◇ ' + rw.cores + ' Core' + (rw.cores > 1 ? 's' : '') + '</span>' : '',
    rw.lc ? '<span class="mr-chip mr-lc" style="--c:#ffd24d">◉ ' + rw.lc + ' LC</span>' : '',
  ].join('');

  // ---------------------------------------------------------------------------
  // RENDER — Command ▸ Missions screen with DAILY / WEEKLY / MONTHLY tabs
  // ---------------------------------------------------------------------------
  let _tab = 'd';
  function missionRw(b, def, tier) {
    const lvl = G.state.level || 1, z = Math.max(1, G.state.highestUnlocked || 1);
    const rw = def.rw(lvl, z);
    return b === 'd' ? scaleRw(rw, tier) : rw;
  }
  function render() {
    const body = $('missions-body'); if (!body) return;
    const bd = BOARDS[_tab], ms = ensureBoard(_tab);
    const tier = ms.tier || 1, N = bd.count;
    const doneN = ms.list.filter((m) => m.done >= m.n).length;
    const claimedN = ms.list.filter((m) => m.claimed).length;
    const dD = ensureBoard('d'), dW = ensureBoard('w'), dM = ensureBoard('m');
    const sub = $('missions-sub');
    if (sub) sub.textContent = 'D ' + dD.list.filter((m) => m.done >= m.n).length + '/10 · W ' + dW.list.filter((m) => m.done >= m.n).length + '/5 · M ' + dM.list.filter((m) => m.done >= m.n).length + '/3 · ' + bd.resetTxt.replace('resets ', '⟳ ');
    const badgeOf = (k) => {
      const b2 = ensureBoard(k);
      const c = b2.list.filter((m) => m.done >= m.n && !m.claimed).length + ((b2.list.every((m) => m.done >= m.n) && !b2.allClaimed) ? 1 : 0);
      return c ? '<i>' + c + '</i>' : '';
    };
    let html = '<div class="msn-tabs">' +
      ['d', 'w', 'm'].map((k) => '<button class="msn-tab ' + (k === _tab ? 'on' : '') + '" data-msntab="' + k + '">' + BOARDS[k].label + badgeOf(k) + '</button>').join('') + '</div>';
    // head card
    html += '<div class="msn-head-card"><div class="mh-l"><div class="mh-t">' + bd.title + (bd.tiered ? ' <span class="mh-tier">TIER ' + tier + '</span>' : '') + '</div>' +
      '<div class="mh-s">' + N + ' orders · ⟳ ' + bd.resetTxt + ' · <b data-msn-cd>' + fmtDur(bd.left()) + '</b> left</div>' +
      (bd.tiered
        ? (tier > 1 ? '<div class="mh-s"><b style="color:#ffd24d">All rewards ×' + G.formatNum(rwMult(tier)) + '</b> this tier · targets up steeply</div>'
                    : '<div class="mh-s">Clear the board to unlock <b>Tier 2</b> — rewards ×2</div>')
        : (_tab === 'w' ? '<div class="mh-s">Campaign-length orders — <b>~8× daily scale</b>, big ◉ LootCoin pay</div>'
                        : '<div class="mh-s">Grand operations — <b>~30× daily scale</b> · ◉ LootCoins + <b style="color:#ff6b78">◇ Dread Cores</b></div>')) +
      '</div><div class="mh-ring" style="--p:' + (doneN / N * 360) + 'deg"><span>' + doneN + '<i>/' + N + '</i></span></div></div>';
    if (_tab === 'd') html += veridianBanner();
    ms.list.forEach((mi, i) => {
      const def = bd.pool.find((p) => p.id === mi.id); if (!def) return;
      const rw = missionRw(_tab, def, tier);
      const pct = Math.min(100, mi.done / mi.n * 100);
      const done = mi.done >= mi.n;
      html += '<div class="msn-card ' + (mi.claimed ? 'claimed' : done ? 'ready' : '') + (_tab === 'm' ? ' epic' : '') + '">' +
        '<div class="msn-ic">' + def.ic + '</div>' +
        '<div class="msn-mid"><div class="msn-n">' + def.name + '</div>' +
        '<div class="msn-b">' + def.blurb.replace('{N}', '<b>' + G.formatNum(mi.n) + '</b>') + '</div>' +
        '<div class="msn-bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="msn-prog">' + G.formatNum(Math.min(mi.done, mi.n)) + ' / ' + G.formatNum(mi.n) + '</div>' +
        '<div class="msn-rw">' + rwChips(rw) + '</div></div>' +
        (mi.claimed ? '<div class="msn-done">✓</div>'
          : done ? '<button class="msn-claim" data-claim="' + i + '">CLAIM</button>'
          : '') + '</div>';
    });
    // crate
    const allDone = doneN >= N;
    const bonusRw = crateRw(_tab, tier);
    html += '<div class="msn-bonus ' + (ms.allClaimed ? 'claimed' : allDone ? 'ready' : '') + '">' +
      '<div class="mb-glow"></div><div class="mb-ic">▣</div>' +
      '<div class="msn-mid"><div class="msn-n">' + CRATE_NAME[_tab] + (bd.tiered ? ' · TIER ' + tier : '') + '</div>' +
      '<div class="msn-b">Clear all ' + N + ' · <b>' + claimedN + '/' + N + ' claimed</b>' +
      (bd.tiered ? ' · claiming unlocks <b>TIER ' + (tier + 1) + '</b> (rewards ×2)' : '') + '</div>' +
      '<div class="msn-rw">' + rwChips(bonusRw) + '</div></div>' +
      (ms.allClaimed ? '<div class="msn-done">✓</div>' : allDone ? '<button class="msn-claim gold" data-bonus="1">CLAIM</button>' : '<div class="msn-lockp">' + doneN + '/' + N + '</div>') + '</div>';
    // preserve scroll through re-renders
    let _sc = body; while (_sc && _sc !== document.documentElement && _sc.scrollHeight <= _sc.clientHeight + 4) _sc = _sc.parentElement;
    const _st = _sc ? _sc.scrollTop : 0;
    if (body._msnHtml === html) return;
    body._msnHtml = html;
    body.innerHTML = html;
    if (_sc) _sc.scrollTop = _st;
    body.querySelectorAll('[data-msntab]').forEach((b) => b.addEventListener('click', () => { _tab = b.dataset.msntab; body._msnHtml = null; render(); }));
    body.querySelectorAll('[data-claim]').forEach((b) => b.addEventListener('click', () => {
      const mi = ms.list[+b.dataset.claim]; if (!mi || mi.claimed || mi.done < mi.n) return;
      const def = bd.pool.find((p) => p.id === mi.id);
      mi.claimed = true; G.state.lifetimeMissions = (G.state.lifetimeMissions | 0) + 1;
      payout(missionRw(_tab, def, tier)); render(); syncBadge();
    }));
    const bb = body.querySelector('[data-bonus]');
    const vb = body.querySelector('[data-veridian-accept]');
    if (vb) vb.addEventListener('click', acceptVeridian);
    if (bb) bb.addEventListener('click', () => {
      if (ms.allClaimed || ms.list.filter((m) => m.done >= m.n).length < N) return;
      // auto-claim anything finished but unclaimed so the crate never eats rewards
      ms.list.forEach((mi) => {
        if (!mi.claimed && mi.done >= mi.n) {
          const d = bd.pool.find((p) => p.id === mi.id);
          mi.claimed = true; G.state.lifetimeMissions = (G.state.lifetimeMissions | 0) + 1;
          if (d) payout(missionRw(_tab, d, tier));
        }
      });
      ms.allClaimed = true; payout(bonusRw);
      const tl = $('toast-layer');
      if (tl) {
        const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#ffd24d';
        t.innerHTML = '▣ ' + CRATE_NAME[_tab] + (bd.tiered ? ' · TIER ' + tier : '') + '<br><span style="font-size:13px">All ' + N + ' cleared · +' + G.formatNum(bonusRw.lc) + ' ◉ LootCoins</span>';
        tl.appendChild(t); setTimeout(() => t.remove(), 3600);
      }
      if (bd.tiered) advanceTier();
      G.save();
      render(); syncBadge();
    });
  }
  // ===========================================================================
  // ⌘ VERIDIAN — the 1,000-lifetime-missions reward hull (ALL boards count)
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
        '<div class="vrd-s">Complete <b>1,000 lifetime missions</b> (daily, weekly & monthly all count) to earn this Battleship-grade hull. Its verdant <b>resonance aura</b> constantly damages everything within a few tiles — scaling with your fleet\u2019s DPS.</div>' +
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
    for (const k of ['d', 'w', 'm']) {
      const ms = G.state[BOARDS[k].key]; if (!ms || !ms.list) continue;
      claimable += ms.list.filter((m) => m.done >= m.n && !m.claimed).length;
      if (ms.list.every((m) => m.done >= m.n) && !ms.allClaimed) claimable++;
    }
    const b = $('cmd-msn-badge');
    if (b) { b.style.display = claimable ? '' : 'none'; b.textContent = claimable; }
  }

  // ---------------------------------------------------------------------------
  function init(game) {
    G = game;
    // migrate pre-tabs saves: the old per-board base is replaced by ONE global baseline
    if (G.state.missions && G.state.missions.base) { G.state.missionsBase = G.state.missionsBase || G.state.missions.base; delete G.state.missions.base; }
    ensureBoard('d'); ensureBoard('w'); ensureBoard('m');
    watchBoss();
    setInterval(tick, 1000);
    setInterval(() => {
      if (!document.querySelector('#screen-missions.active')) return;
      const cd = document.querySelector('#missions-body [data-msn-cd]'); if (cd) cd.textContent = fmtDur(BOARDS[_tab].left());
    }, 30000);
    syncBadge();
  }
  function boot() { if (window.GAME && window.GAME.state) init(window.GAME); else setTimeout(boot, 500); }
  setTimeout(boot, 1000);
  window.MISSIONS = { init, render, syncBadge };

  // ---- CSS (self-injected) ---------------------------------------------------
  const CSS = `
  .msn-tabs{ display:flex; gap:6px; margin-bottom:11px; }
  .msn-tab{ flex:1; position:relative; font-family:'Orbitron',sans-serif; font-weight:800; font-size:10px; letter-spacing:.1em;
    color:#7e93b0; background:linear-gradient(180deg,#121a29,#0d1420); border:1px solid #263650; border-radius:11px; padding:10px 6px; cursor:pointer; }
  .msn-tab.on{ color:#eaf3ff; border-color:#3f8cff; box-shadow:0 0 14px -5px rgba(63,140,255,.8); background:linear-gradient(180deg,#1a2540,#101a2c); }
  .msn-tab i{ font-style:normal; position:absolute; top:-6px; right:-4px; min-width:16px; height:16px; border-radius:8px; padding:0 4px;
    display:grid; place-items:center; font-size:9px; color:#1c0d04; background:linear-gradient(180deg,#ffd24d,#e09a2d); box-shadow:0 0 8px -1px rgba(255,210,77,.9); }
  .msn-card.epic{ border-color:rgba(255,107,120,.35); }
  .msn-card.epic .msn-ic{ color:#ff9aa4; border-color:rgba(255,107,120,.4); }
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
