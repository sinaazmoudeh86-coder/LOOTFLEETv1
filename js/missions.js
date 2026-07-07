/* =============================================================================
   missions.js — DAILY MISSIONS (Command ▸ Missions)
   ---------------------------------------------------------------------------
   10 missions issued per day (local midnight reset), drawn from a wide pool.
   NON-INVASIVE: progress is measured by polling monotonic accumulators built
   from positive deltas of existing game state — no game mechanics touched.

   Rewards are deliberately mid-power: gold + galaxy resources + small LootCoin
   sums, scaled to the commander's level/zone. Clearing all 10 pays a bonus
   crate: 100 LootCoins + a resource bundle.
============================================================================= */
(function () {
  'use strict';
  let G = null;
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------------------
  // MISSION POOL — id, name, blurb, metric, target(level,zone), reward(level,zone)
  // Metrics are keys of the delta-accumulator (see tick()).
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
    // ---- FEATURE-GATED MISSIONS — only issued once the feature is unlocked (req = min level) ----
    { id: 'hull1',   ic: '⬡', name: 'Refit Order',        blurb: 'Upgrade ship hulls {N} times',       m: 'hulls',  n: () => 1,                                  rw: (l, z) => ({ iron: Math.round(100 * dayScale(z)), lc: 10 }), req: 12 },
    { id: 'hull2',   ic: '⚙', name: 'Yard Overhaul',      blurb: 'Upgrade ship hulls {N} times',       m: 'hulls',  n: () => 3,                                  rw: (l, z) => ({ gold: Math.round(2200 * dayScale(z)), lc: 15 }), req: 12 },
    { id: 'gal1',    ic: '⬢', name: 'Land Grab',          blurb: 'Capture {N} galaxy tiles',           m: 'tiles',  n: () => 2,                                  rw: (l, z) => ({ fuel: Math.round(240 * dayScale(z)), lc: 10 }), req: 25 },
    { id: 'gal2',    ic: '⚑', name: 'Warpath',            blurb: 'Capture {N} galaxy tiles',           m: 'tiles',  n: () => 5,                                  rw: (l, z) => ({ plasma: Math.round(120 * dayScale(z)), lc: 20 }), req: 25 },
    { id: 'moon1',   ic: '🌙', name: 'Colony Shipment',   blurb: 'Collect {N} resources from your Moon Colony', m: 'moon', n: (l, z) => Math.round(1500 * dayScale(z)), rw: (l, z) => ({ gold: Math.round(2000 * dayScale(z)), lc: 10 }), req: 30 },
    { id: 'moon2',   ic: '⛏', name: 'Colony Foreman',     blurb: 'Build or upgrade {N} colony structures', m: 'colony', n: () => 3,                              rw: (l, z) => ({ iron: Math.round(160 * dayScale(z)), lc: 15 }), req: 30 },
  ];
  const ALL_BONUS = { lc: 100 }; // + resource bundle computed at claim time

  // ---------------------------------------------------------------------------
  // STATE — s.missions = { day, list:[{id,n,done,claimed}], acc:{}, base:{}, allClaimed }
  // ---------------------------------------------------------------------------
  const dayKey = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  function seededShuffle(arr, seed) {
    const a = arr.slice();
    let s = 0; for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
    for (let i = a.length - 1; i > 0; i--) { s = (s * 1664525 + 1013904223) >>> 0; const j = s % (i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function ensureDay() {
    const s = G.state;
    if (!s.missions || s.missions.day !== dayKey()) {
      const lvl = s.level || 1, z = Math.max(1, s.highestUnlocked || 1);
      // feature-gated missions only enter the day's draw once unlocked
      const eligible = POOL.filter((p) => !p.req || lvl >= p.req);
      const picks = seededShuffle(eligible, dayKey() + ':' + (s.playerName || 'cmdr')).slice(0, 10);
      s.missions = {
        day: dayKey(),
        list: picks.map((p) => ({ id: p.id, n: p.n(lvl, z), done: 0, claimed: false })),
        acc: { kills: 0, bosses: 0, gold: 0, fuel: 0, iron: 0, plasma: 0, levels: 0, zones: 0, mins: 0, loot: 0, hulls: 0, tiles: 0, moon: 0, colony: 0 },
        seen: {}, // zones deployed today (for the 'zones' metric)
        base: null,
        allClaimed: false,
      };
      G.save();
    }
    return s.missions;
  }

  // ---------------------------------------------------------------------------
  // PROGRESS — 1s poll converts positive state deltas into accumulators
  // ---------------------------------------------------------------------------
  function snapshot() {
    const s = G.state, r = s.resources || {};
    return { kills: s.totalKills || 0, gold: s.gold || 0, fuel: r.fuel || 0, iron: r.iron || 0, plasma: r.plasma || 0,
             level: s.level || 1, play: s.playTime || 0, items: (s.inventory || []).length + (s.lifetimeLooted || 0), boss: bossCount(),
             hulls: hullLevelSum(), tiles: Object.keys(s.ownedSystems || {}).length, moon: moonLifetimeSum(), colony: colonyLevelSum() };
  }
  // sum of all per-ship hull levels (positive deltas = upgrades bought;
  // death resets go DOWN and are ignored by the delta accumulator)
  function hullLevelSum() {
    const sl = G.state.shipLevels || {}; let t = 0;
    for (const k in sl) t += sl[k] || 0;
    return t;
  }
  // lifetime resources shipped home from all moon colonies
  function moonLifetimeSum() {
    const lt = (G.state.moon && G.state.moon.lifetime) || {}; let t = 0;
    for (const k in lt) t += lt[k] || 0;
    return t;
  }
  // total structure levels across all moons (build = +1, upgrade = +1)
  function colonyLevelSum() {
    const root = G.state.moon; if (!root || !root.moons) return 0;
    let t = 0;
    root.moons.forEach((mm) => { const b = mm.b || {}; for (const k in b) t += (b[k] && b[k].lv) || 0; });
    return t;
  }
  function bossCount() {
    // bossKillsByZone exists per-save in some versions; fall back to a UI counter
    const s = G.state;
    if (s.stats && typeof s.stats.bossKills === 'number') return s.stats.bossKills;
    return M._bossLocal;
  }
  const M = { _bossLocal: 0, _timer: null };
  // count boss deaths by watching the boss bar disappear (no engine hooks)
  function watchBoss() {
    const bar = $('boss-bar'); let was = false;
    setInterval(() => {
      const on = bar && bar.classList.contains('active'); // 'active' = boss alive (bar uses show/active, not 'on')
      if (was && !on) M._bossLocal++;
      was = on;
    }, 500);
  }
  function tick() {
    if (!G || !G.state) return;
    const ms = ensureDay();
    const now = snapshot();
    if (!ms.base) { ms.base = now; return; }
    const b = ms.base, a = ms.acc;
    if (now.kills > b.kills) a.kills += now.kills - b.kills;
    if (now.gold > b.gold) a.gold += now.gold - b.gold;
    if (now.fuel > b.fuel) a.fuel += now.fuel - b.fuel;
    if (now.iron > b.iron) a.iron += now.iron - b.iron;
    if (now.plasma > b.plasma) a.plasma += now.plasma - b.plasma;
    if (now.level > b.level) a.levels += now.level - b.level;
    if (now.boss > b.boss) a.bosses += now.boss - b.boss;
    if (now.items > b.items) a.loot += now.items - b.items;
    // feature metrics (guard with ||0 so saves from before these existed keep working)
    if (now.hulls > (b.hulls || 0)) a.hulls = (a.hulls || 0) + (now.hulls - (b.hulls || 0));
    if (now.tiles > (b.tiles || 0)) a.tiles = (a.tiles || 0) + (now.tiles - (b.tiles || 0));
    if (now.moon > (b.moon || 0)) a.moon = (a.moon || 0) + (now.moon - (b.moon || 0));
    if (now.colony > (b.colony || 0)) a.colony = (a.colony || 0) + (now.colony - (b.colony || 0));
    if (G.state.currentDungeon >= 1) {
      a.mins += 1 / 60;
      const zk = 'z' + G.state.currentDungeon;
      if (!ms.seen[zk]) { ms.seen[zk] = 1; a.zones++; }
    }
    ms.base = now;
    // progress + completion toasts
    let changed = false;
    ms.list.forEach((mi) => {
      const def = POOL.find((p) => p.id === mi.id); if (!def) return;
      const v = Math.min(mi.n, Math.floor(a[def.m] || 0));
      if (v > mi.done) { mi.done = v; changed = true;
        if (mi.done >= mi.n && !mi._toasted) { mi._toasted = true; missionToast(def); } }
    });
    if (changed) { syncBadge(); if (document.querySelector('#screen-missions.active')) render(); }
  }
  function missionToast(def) {
    const tl = $('toast-layer'); if (!tl) return;
    const t = document.createElement('div');
    t.className = 'msn-toast';
    t.innerHTML = '<span class="mt-ic">' + def.ic + '</span><span><b>MISSION COMPLETE</b><br>' + def.name + ' — claim your reward</span>';
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
    rw.lc ? '<span class="mr-chip mr-lc" style="--c:#ffd24d">◉ ' + rw.lc + ' LC</span>' : '',
  ].join('');

  // ---------------------------------------------------------------------------
  // RENDER — Command ▸ Missions screen
  // ---------------------------------------------------------------------------
  function msLeft() { const d = new Date(); const nx = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); return nx - d; }
  function fmtLeft() { const t = msLeft() / 1000; return Math.floor(t / 3600) + 'h ' + Math.floor((t % 3600) / 60) + 'm'; }
  function render() {
    const body = $('missions-body'); if (!body) return;
    const ms = ensureDay();
    const lvl = G.state.level || 1, z = Math.max(1, G.state.highestUnlocked || 1);
    const doneN = ms.list.filter((m) => m.done >= m.n).length;
    const claimedN = ms.list.filter((m) => m.claimed).length;
    const sub = $('missions-sub'); if (sub) sub.textContent = doneN + '/10 complete · resets ' + fmtLeft();
    let html = '<div class="msn-head-card"><div class="mh-l"><div class="mh-t">DAILY MISSION BOARD</div>' +
      '<div class="mh-s">10 fresh orders every day · ⟳ resets in <b>' + fmtLeft() + '</b></div></div>' +
      '<div class="mh-ring" style="--p:' + (doneN / 10 * 360) + 'deg"><span>' + doneN + '<i>/10</i></span></div></div>';
    ms.list.forEach((mi, i) => {
      const def = POOL.find((p) => p.id === mi.id); if (!def) return;
      const rw = def.rw(lvl, z);
      const pct = Math.min(100, mi.done / mi.n * 100);
      const done = mi.done >= mi.n;
      html += '<div class="msn-card ' + (mi.claimed ? 'claimed' : done ? 'ready' : '') + '">' +
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
    // ALL-CLEAR bonus crate
    const allDone = doneN >= 10;
    const bonusRw = { lc: ALL_BONUS.lc, fuel: Math.round(300 * dayScale(z)), iron: Math.round(200 * dayScale(z)), plasma: Math.round(150 * dayScale(z)) };
    html += '<div class="msn-bonus ' + (ms.allClaimed ? 'claimed' : allDone ? 'ready' : '') + '">' +
      '<div class="mb-glow"></div><div class="mb-ic">▣</div>' +
      '<div class="msn-mid"><div class="msn-n">COMMANDER\'S CRATE</div>' +
      '<div class="msn-b">Clear all 10 missions · <b>' + claimedN + '/10 claimed</b></div>' +
      '<div class="msn-rw">' + rwChips(bonusRw) + '</div></div>' +
      (ms.allClaimed ? '<div class="msn-done">✓</div>' : allDone ? '<button class="msn-claim gold" data-bonus="1">CLAIM</button>' : '<div class="msn-lockp">' + doneN + '/10</div>') + '</div>';
    // preserve scroll through re-renders
    let _sc = body; while (_sc && _sc !== document.documentElement && _sc.scrollHeight <= _sc.clientHeight + 4) _sc = _sc.parentElement;
    const _st = _sc ? _sc.scrollTop : 0;
    body.innerHTML = html;
    if (_sc) _sc.scrollTop = _st;
    body.querySelectorAll('[data-claim]').forEach((b) => b.addEventListener('click', () => {
      const mi = ms.list[+b.dataset.claim]; if (!mi || mi.claimed || mi.done < mi.n) return;
      const def = POOL.find((p) => p.id === mi.id);
      mi.claimed = true; payout(def.rw(lvl, z)); render(); syncBadge();
    }));
    const bb = body.querySelector('[data-bonus]');
    if (bb) bb.addEventListener('click', () => {
      if (ms.allClaimed || doneN < 10) return;
      ms.allClaimed = true; payout(bonusRw);
      const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#ffd24d';
      t.innerHTML = '▣ COMMANDER\'S CRATE<br><span style="font-size:13px">All 10 missions cleared · +100 ◉ LootCoins</span>';
      $('toast-layer').appendChild(t); setTimeout(() => t.remove(), 3600);
      render(); syncBadge();
    });
  }
  function syncBadge() {
    const ms = G.state.missions; if (!ms) return;
    const claimable = ms.list.filter((m) => m.done >= m.n && !m.claimed).length + ((ms.list.every((m) => m.done >= m.n) && !ms.allClaimed) ? 1 : 0);
    const b = $('cmd-msn-badge');
    if (b) { b.style.display = claimable ? '' : 'none'; b.textContent = claimable; }
  }

  // ---------------------------------------------------------------------------
  function init(game) {
    G = game;
    ensureDay();
    watchBoss();
    setInterval(tick, 1000);
    setInterval(() => { if (document.querySelector('#screen-missions.active')) render(); }, 30000); // countdown refresh
    syncBadge();
  }
  // self-boot: wait for the engine, mirroring galaxy-box.js
  function boot() { if (window.GAME && window.GAME.state) init(window.GAME); else setTimeout(boot, 500); }
  setTimeout(boot, 1000);
  window.MISSIONS = { init, render, syncBadge };

  // ---- CSS (self-injected, mirrors galaxy-box.js pattern) -------------------
  const CSS = `
  .msn-head-card{ position:relative; display:flex; align-items:center; justify-content:space-between; gap:12px;
    background:radial-gradient(140% 180% at 10% -20%, rgba(95,160,255,.16), transparent 55%), linear-gradient(180deg,#131c2c,#0c1220);
    border:1px solid #2c3b56; border-radius:14px; padding:13px 15px; margin-bottom:12px; }
  .mh-t{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:13px; letter-spacing:.1em; color:#dbe8fa; }
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
  `;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
})();
