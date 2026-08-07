/* =============================================================================
   prism.js — Prism Mining  (Command → Prism Mining)
   ---------------------------------------------------------------------------
   Deploy into the SAME combat arena as Zone Grind — your ship, joystick,
   auto-fire, enemy waves. The twist: a huge PRISM ORE FIELD sits at the centre
   of the map and your MINERS dig it for ◈ Prism Ingots. Raiders peel off to
   wreck your miners, so you fly around killing things to PROTECT THE DIG. Send
   in more (and stronger) miners as you go; lose them if you don't defend.

   The combat runs on the real engine. Two tiny hooks in game-v91.js drive this:
     • update(): window.PRISM.tick(dt, rt)   — ore/miner/raider sim
     • draw():   window.PRISM.render(ctx,t,rt)— ore field + miners in world space
   Mined prism banks continuously (safe even if you die); the risk is your rigs.
   ============================================================================= */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const G = () => window.GAME;
  const EN = () => window.ENTITIES;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const TAU = Math.PI * 2;
  const PRISM = '#c9a0ff';
  const ORE = '#ff2a2f';         // glowing red prism ore — the mined currency
  const ORE_HOT = '#ff7a52';     // hot inner facet

  const FIELDS = [
    { tier: 1, name: 'Azure Prism Field',    unlock: 1,   enemyLv: 30,  col: '#5fd1ff' },
    { tier: 2, name: 'Verdant Prism Field',  unlock: 25,  enemyLv: 60,  col: '#46d27a' },
    { tier: 3, name: 'Violet Prism Field',   unlock: 50,  enemyLv: 90,  col: '#b87bff' },
    { tier: 4, name: 'Crimson Prism Field',  unlock: 80,  enemyLv: 120, col: '#ff5168' },
    { tier: 5, name: 'Prismatic Core Field', unlock: 120, enemyLv: 150, col: '#ffd450' },
  ];
  // base prism/sec per miner, hull HP, sprite + colour. `grow` = cost multiplier
  // per extra unit owned. Rigs are TANKY now (deep-zone fields would melt them) —
  // see spawnMinerEntity for level scaling + the per-raider damage cap in tick().
  const MINERS = {
    scout:     { name: 'Scout Miner',     cost: 8e8,  rate: 1.6, hp: 320,  grow: 1.4, sprite: 'interceptor',  col: '#9aa7b8', blurb: 'Cheap, low yield.' },
    hauler:    { name: 'Hauler Rig',      cost: 10e9,   rate: 3.6, hp: 900,  grow: 1.4, sprite: 'cruiser',      col: '#5fd1ff', blurb: 'Balanced workhorse.' },
    heavy:     { name: 'Heavy Excavator', cost: 500e9,  rate: 7.5, hp: 2600, grow: 1.4, sprite: 'heavycruiser', col: '#d0a060', blurb: 'Armoured, strong output.' },
    harvester: { name: 'Prism Harvester', cost: 20e12, rate: 15,  hp: 7200, grow: 3.0, sprite: 'carrier',      col: '#ffd450', blurb: 'Endgame rig. Huge yield.' },
  };
  const MINER_ORDER = ['scout', 'hauler', 'heavy', 'harvester'];
  const MAX_MINERS = 10;       // hard cap on how many of EACH miner type you can own
  const REFINERY = { base: 1500, grow: 1.6, max: 25, k: 0.12 };   // +12% prism/sec per lvl (Gold)
  const CORE_BASE = 2500, CORE_GROW = 10, CORE_BONUS = 0.08;      // +8% prism/sec per lvl (Ingots) — 10x base, 10x exponential
  const RAID_FRAC = 0.5;     // share of raiders that dive for your miners
  const MINE_SPEED = 0.15;   // global dig-speed (Jul 2026: 0.02→0.15 — the old crush made a 37/s fleet mine ~1/s; T5 runs were 30+ min)
  const RAID_DPS = 0.55;     // multiplier on enemy damage vs miners
  const RAID_HP_CAP = 0.045; // one raider removes at most this frac of a rig's max HP per second (no one-shots)
  const DAILY_FIELDS = 4;    // each tier yields ~this many field-fulls of ore per day, then locks

  // ---- STATE ----------------------------------------------------------------
  function P() {
    const g = G(); if (!g) return null;
    if (!g.state.prism) g.state.prism = { ingots: 0, best: 0, core: 0, refinery: 0, _frac: 0, miners: [], entered: false };
    const p = g.state.prism;
    if (p.ingots == null) p.ingots = 0; if (p.core == null) p.core = 0; if (p.refinery == null) p.refinery = 0;
    if (p._frac == null) p._frac = 0; if (p.best == null) p.best = 0;
    if (!Array.isArray(p.miners)) p.miners = [];
    return p;
  }
  const lvl = () => { try { return (G().state.level | 0) || 1; } catch (e) { return 1; } };
  const gold = () => { try { return G().state.gold || 0; } catch (e) { return 0; } };
  const hu = () => { try { return G().state.highestUnlocked || 1; } catch (e) { return 1; } };
  const coreMult = () => 1 + CORE_BONUS * (P().core || 0);
  const refMult = () => 1;   // Refinery upgrade removed
  const refCost = () => Math.floor(REFINERY.base * Math.pow(REFINERY.grow, P().refinery || 0));
  const coreCost = () => Math.floor(CORE_BASE * Math.pow(CORE_GROW, P().core || 0));
  const tierMult = (t) => 1 + 0.55 * (t - 1);
  const minerCount = (type) => P().miners.filter((m) => m.type === type).length;
  const minerCost = (type) => Math.floor(MINERS[type].cost * Math.pow(MINERS[type].grow || 1.4, minerCount(type)));
  const fieldUnlocked = (f) => lvl() >= f.unlock;
  const oreFor = (tier) => Math.round(1800 * Math.pow(1.7, tier - 1));
  function fmt(n) { try { return G().formatNum(Math.floor(n)); } catch (e) { return Math.floor(n) + ''; } }
  function zoneForTier(tier) { const u = hu(); return clamp(Math.max(1, Math.round(u * tier / 5)), 1, u); }
  // ---- daily ore caps + per-tier cooldown -----------------------------------
  function nextMidnight() { const d = new Date(); d.setHours(24, 0, 0, 0); return d.getTime(); }
  function ensureDaily(p) {
    const now = Date.now();
    if (!p.daily || !p.daily.resetAt || now >= p.daily.resetAt) { p.daily = { resetAt: nextMidnight(), used: {} }; p.lock = {}; }
    if (!p.lock) p.lock = {};
    return p.daily;
  }
  const dailyCap = (tier) => Math.round(oreFor(tier) * DAILY_FIELDS);
  function dailyUsed(tier) { const p = P(); ensureDaily(p); return p.daily.used[tier] || 0; }
  function dailyLeft(tier) { return Math.max(0, dailyCap(tier) - dailyUsed(tier)); }
  function lockedLeft(tier) { const p = P(); ensureDaily(p); const u = p.lock && p.lock[tier]; return u ? Math.max(0, u - Date.now()) : 0; }
  function fmtTime(ms) { let s = Math.ceil(ms / 1000); const h = Math.floor(s / 3600); s -= h * 3600; const m = Math.floor(s / 60); s -= m * 60; const z = (n) => (n < 10 ? '0' + n : '' + n); return h > 0 ? (h + ':' + z(m) + ':' + z(s)) : (z(m) + ':' + z(s)); }
  // VIP perk: +2% prism yield per VIP level past 7 (VIP 8 = +2% … VIP 15 = +16%)
  function vipPrism() { const lv = window.VIP ? window.VIP.level() : 0; return 1 + Math.max(0, lv - 7) * 0.02; }
  // ASCENSION perk: Deep Core Drills — permanent mining speed
  function ascMine() { return window.PASCEND ? window.PASCEND.mult('mine') : 1; }
  function ratePerSec(tier) { let r = 0; P().miners.forEach((m) => r += MINERS[m.type].rate); return r * tierMult(tier) * coreMult() * refMult() * MINE_SPEED * vipPrism() * ascMine(); }

  // per-kill refine bonus (secondary faucet; mining is primary)
  function killYield(dungeon, isBoss) {
    const tier = (G().state.prismRun && G().state.prismRun.tier) || 1;
    let y = 0.25 * tier * coreMult() * refMult();
    if (isBoss) y *= 30;
    return y;
  }
  // Prism comes ONLY from mining the ore field — kills are for defending your
  // rigs, not a currency faucet. (Returns 0 = no kill-loot, no float.)
  function onKill(dungeon, isBoss) { return 0; }

  // ---- RUNTIME (live field) -------------------------------------------------
  const RUN = { active: false, runId: 0, tier: 1, cx: 0, cy: 0, ore: 0, oreMax: 1, miners: [], depleted: false, hudT: 0, floatT: 0, floatAcc: 0 };
  const fieldR = (tier) => 40 + tier * 7;

  function bank(amount) {
    const p = P(); if (!p) return 0; p._frac += amount; let whole = 0;
    if (p._frac >= 1) { whole = Math.floor(p._frac); p._frac -= whole; p.ingots += whole; p.best += whole; if (RUN.active) p.runEarned = (p.runEarned || 0) + whole; dirty(); }
    return whole;
  }
  let _saveT = 0, _hudT = 0;
  function dirty() { if (!_hudT) _hudT = setTimeout(() => { _hudT = 0; updateHud(); }, 200); if (_saveT) return; _saveT = setTimeout(() => { _saveT = 0; try { G().save(); } catch (e) {} }, 4000); }

  function initRun(rt, run) {
    RUN.active = true; RUN.runId = run.started; RUN.tier = run.tier || 1;
    RUN.cx = rt.worldW / 2; RUN.cy = rt.worldH / 2;
    RUN.oreMax = oreFor(RUN.tier); RUN.ore = RUN.oreMax; RUN.depleted = false;
    RUN.miners = []; RUN.floatT = 0; RUN.floatAcc = 0; RUN.hudT = 0;
    P().miners.forEach((m, i) => spawnMinerEntity(m.type, i, false));
  }
  function spawnMinerEntity(type, index, flyIn) {
    const fR = fieldR(RUN.tier);
    const ring = index % 2, orbR = fR + 34 + ring * 30 + (MINERS[type].hp > 400 ? 8 : 0);
    const orbA = index * 2.39996; // golden angle spacing
    const def = MINERS[type];
    // rigs are industrial — hull scales with your level so they survive the deep
    // zones a high-tier field deploys into (but can still be lost if swarmed).
    const maxhp = Math.round(def.hp * (1 + lvl() * 0.07));
    const m = { type, orbR, orbA, orbSpd: (ring ? -1 : 1) * (0.22 + Math.random() * 0.06), x: RUN.cx + Math.cos(orbA) * orbR, y: RUN.cy + Math.sin(orbA) * orbR, ang: 0, hp: maxhp, maxhp: maxhp, hitFlash: 0, regenT: 0, warpT: flyIn ? 0.5 : 0, spr: spr(def.sprite), dead: false };
    RUN.miners.push(m); return m;
  }
  function aliveMiners() { return RUN.miners.filter((m) => !m.dead); }
  function nearestAliveMiner(x, y) { let best = null, bd = Infinity; for (const m of RUN.miners) { if (m.dead) continue; const d = (m.x - x) ** 2 + (m.y - y) ** 2; if (d < bd) { bd = d; best = m; } } return best; }
  function killMiner(m, rt) {
    m.dead = true;
    const col = MINERS[m.type].col;
    for (let i = 0; i < 22; i++) { const a = Math.random() * TAU, s = 80 + Math.random() * 200; rt.particles.push(new (EN().Particle)(m.x, m.y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.4 + Math.random() * 0.5, size: 1.6 + Math.random() * 3, color: Math.random() < 0.5 ? col : '#ffd0d0', glow: true, drag: 0.9 })); }
    rt.floats.push(new (EN().FloatText)(m.x, m.y - 14, '✖ ' + MINERS[m.type].name + ' lost', { color: '#ff5168', size: 13, vy: -46, life: 1.1 }));
    const p = P(); const j = p.miners.findIndex((r) => r.type === m.type); if (j >= 0) p.miners.splice(j, 1);
    toast('✖ ' + MINERS[m.type].name + ' destroyed — protect your rigs!');
    rt.shake = Math.min(9, (rt.shake || 0) + 5); refreshPanel(); saveSoon();
  }

  // ---- SIM (called by engine each frame during a run) -----------------------
  function tick(dt, rt) {
    const g = G(); if (!g) return; const run = g.state.prismRun; if (!run || !run.active) { RUN.active = false; return; }
    // ORPHAN GUARD — if the zone changed under the run through any path that
    // skipped resetZone (death respawn race, event deploy, galaxy warp), the
    // run is dead: end it cleanly instead of mining an invisible field in the
    // wrong zone with a frozen HUD pill.
    if (g.state.currentDungeon !== run.d) {
      g.state.prismRun = null;
      RUN.active = false;
      try { g.save(); } catch (e) {}
      updateHud(); syncChrome();
      return;
    }
    if (!RUN.active || RUN.runId !== run.started) initRun(rt, run);
    RUN.cx = rt.worldW / 2; RUN.cy = rt.worldH / 2;
    const fR = fieldR(RUN.tier);

    // miners: orbit the dig, mine, slow self-repair
    let rate = 0;
    for (const m of RUN.miners) {
      if (m.dead) continue;
      if (m.warpT > 0) m.warpT -= dt;
      m.orbA += m.orbSpd * dt;
      m.x = RUN.cx + Math.cos(m.orbA) * m.orbR; m.y = RUN.cy + Math.sin(m.orbA) * m.orbR;
      m.ang = m.orbA + Math.PI / 2 + Math.sin(performance.now() / 600 + m.orbR) * 0.05;
      if (m.hitFlash > 0) m.hitFlash -= dt * 3;
      m.regenT -= dt;
      if (m.regenT <= 0 && m.hp < m.maxhp) m.hp = Math.min(m.maxhp, m.hp + m.maxhp * 0.05 * dt);
      if (RUN.ore > 0) rate += MINERS[m.type].rate;
    }
    // production
    if (RUN.ore > 0 && rate > 0) {
      const prod = Math.min(RUN.ore, rate * tierMult(RUN.tier) * coreMult() * refMult() * MINE_SPEED * vipPrism() * ascMine() * dt);
      RUN.ore -= prod; bank(prod);
      const pp = P(); ensureDaily(pp); pp.daily.used[RUN.tier] = (pp.daily.used[RUN.tier] || 0) + prod;
      RUN.floatAcc += prod; RUN.floatT -= dt;
      if (RUN.floatT <= 0 && RUN.floatAcc >= 1) { rt.floats.push(new (EN().FloatText)(RUN.cx, RUN.cy - fR - 8, '◈ +' + fmt(RUN.floatAcc), { color: ORE, size: 14, vy: -40, life: 0.9 })); RUN.floatAcc = 0; RUN.floatT = 0.7; }
      if (RUN.ore <= 0 || pp.daily.used[RUN.tier] >= dailyCap(RUN.tier)) { fieldDone(RUN.tier); return; }
    }

    // raiders peel off to wreck the dig
    for (const e of rt.enemies) {
      if (e.dead || e.dying || e.isBoss) continue;
      if (e._praid === undefined) e._praid = Math.random() < RAID_FRAC;
      if (!e._praid) continue;
      const m = nearestAliveMiner(e.x, e.y);
      const tx = m ? m.x : RUN.cx, ty = m ? m.y : RUN.cy;
      const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy) || 1;
      const reach = (m ? 16 : fR) + (e.size || 10) + 4;
      if (d > reach) { const sp = (e.speed || 40); e.x += dx / d * sp * dt; e.y += dy / d * sp * dt; }
      else if (m) {
        const dps = Math.min((e.damage || 6) * RAID_DPS, m.maxhp * RAID_HP_CAP); m.hp -= dps * dt; m.hitFlash = 1; m.regenT = 3;
        if (Math.random() < dt * 4) { const a = Math.random() * TAU; rt.particles.push(new (EN().Particle)(m.x, m.y, { vx: Math.cos(a) * 90, vy: Math.sin(a) * 90, life: 0.3, size: 1.6 + Math.random() * 2, color: e.tint || '#ff6a78', glow: true, drag: 0.9 })); }
        if (m.hp <= 0) killMiner(m, rt);
      }
    }
    RUN.hudT -= dt; if (RUN.hudT <= 0) { RUN.hudT = 0.25; updateRunHud(); }
  }

  // ---- RENDER (world space) -------------------------------------------------
  const IMGS = {};
  function spr(name) { const k = 'ships/ship-' + name + '.png'; if (!IMGS[k]) { const i = new Image(); i.src = k; IMGS[k] = i; } return IMGS[k]; }
  function hexA(hex, a) { if (hex[0] !== '#' || hex.length < 7) return hex; const n = parseInt(hex.slice(1), 16); return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }

  function render(ctx, t, rt) {
    if (!RUN.active) return;
    const fR = fieldR(RUN.tier), frac = clamp(RUN.ore / RUN.oreMax, 0, 1);
    ctx.save();
    // ground scorch wash (red), pooling under the gem
    const g = ctx.createRadialGradient(RUN.cx, RUN.cy, 4, RUN.cx, RUN.cy, fR * 3.0);
    g.addColorStop(0, 'rgba(255,40,44,' + (0.22 + 0.12 * frac) + ')'); g.addColorStop(0.5, 'rgba(150,10,20,.12)'); g.addColorStop(1, 'rgba(120,0,16,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(RUN.cx, RUN.cy, fR * 3.0, 0, TAU); ctx.fill();
    // defend ring
    ctx.strokeStyle = 'rgba(255,64,64,.24)'; ctx.lineWidth = 2; ctx.setLineDash([9, 11]); ctx.lineDashOffset = -t * 14;
    ctx.beginPath(); ctx.arc(RUN.cx, RUN.cy, fR + 46, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
    // ore crystal cluster
    drawOre(ctx, RUN.cx, RUN.cy, fR, t, frac);
    // ore bar
    drawOreBar(ctx, RUN.cx, RUN.cy - fR - 26, frac, fR * 1.6);
    // miners + beams
    for (const m of aliveMiners()) {
      if (RUN.ore > 0 && !m.warpT) {
        ctx.strokeStyle = hexA(MINERS[m.type].col, 0.28 + 0.22 * (0.5 + 0.5 * Math.sin(t * 7 + m.orbA)));
        ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(RUN.cx + Math.cos(m.orbA) * fR * 0.55, RUN.cy + Math.sin(m.orbA) * fR * 0.55); ctx.stroke();
      }
      drawMiner(ctx, m, t);
    }
    ctx.restore();
  }
  // A massive, radiant red diamond the miners are cracking open. Layered additive
  // glows + light rays + faceted gem + orbiting shards + sparkles.
  function drawOre(ctx, cx, cy, R, t, frac) {
    const live = frac > 0;
    const hot = live ? ORE_HOT : '#7a4a4a';
    const body = live ? '#ff1322' : '#5a4045';
    const deep = live ? '#a8001c' : '#34262a';
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    const D = R * 1.7;                       // gem is bigger than the gameplay reach
    ctx.save(); ctx.translate(cx, cy);

    // ---- massive radiant halo (additive) ----
    ctx.globalCompositeOperation = 'lighter';
    const gR = D * (2.7 + 0.5 * pulse);
    const halo = ctx.createRadialGradient(0, 0, D * 0.18, 0, 0, gR);
    halo.addColorStop(0, 'rgba(255,72,58,' + (0.6 * (live ? 1 : 0.4)) + ')');
    halo.addColorStop(0.32, 'rgba(255,26,40,' + (0.32 * (live ? 1 : 0.4)) + ')');
    halo.addColorStop(1, 'rgba(168,0,28,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, 0, gR, 0, TAU); ctx.fill();

    // ---- rotating volumetric light rays ----
    if (live) {
      ctx.save(); ctx.rotate(t * 0.22);
      for (let i = 0; i < 12; i++) {
        ctx.rotate(TAU / 12);
        const len = D * (2.0 + (i % 3) * 0.45 + pulse * 0.6);
        const rg = ctx.createLinearGradient(0, 0, 0, -len);
        rg.addColorStop(0, 'rgba(255,96,72,0.20)'); rg.addColorStop(1, 'rgba(255,40,40,0)');
        ctx.fillStyle = rg; ctx.beginPath(); ctx.moveTo(-D * 0.1, 0); ctx.lineTo(D * 0.1, 0); ctx.lineTo(0, -len); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';

    // ---- the big faceted diamond ----
    ctx.save(); ctx.rotate(Math.sin(t * 0.3) * 0.05);
    ctx.shadowColor = live ? ORE : '#000'; ctx.shadowBlur = live ? 46 + 24 * pulse : 8;
    const top = -D, girdle = -D * 0.16, bot = D, halfW = D * 0.62;
    const dg = ctx.createLinearGradient(-halfW, top, halfW, bot);
    dg.addColorStop(0, '#fff'); dg.addColorStop(0.16, hot); dg.addColorStop(0.5, body); dg.addColorStop(1, deep);
    ctx.fillStyle = dg;
    ctx.beginPath(); ctx.moveTo(0, top); ctx.lineTo(halfW, girdle); ctx.lineTo(halfW * 0.5, bot * 0.6); ctx.lineTo(0, bot); ctx.lineTo(-halfW * 0.5, bot * 0.6); ctx.lineTo(-halfW, girdle); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    // facet edges
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.3; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-halfW, girdle); ctx.lineTo(halfW, girdle);
    ctx.moveTo(0, top); ctx.lineTo(-halfW * 0.5, girdle); ctx.moveTo(0, top); ctx.lineTo(halfW * 0.5, girdle); ctx.moveTo(0, top); ctx.lineTo(0, girdle);
    ctx.moveTo(-halfW, girdle); ctx.lineTo(0, bot); ctx.moveTo(halfW, girdle); ctx.lineTo(0, bot);
    ctx.moveTo(-halfW * 0.5, girdle); ctx.lineTo(0, bot); ctx.moveTo(halfW * 0.5, girdle); ctx.lineTo(0, bot); ctx.moveTo(0, girdle); ctx.lineTo(0, bot);
    ctx.stroke();
    // molten inner core
    ctx.globalCompositeOperation = 'lighter';
    const cg = ctx.createRadialGradient(0, girdle, 1, 0, girdle, D * 0.72);
    cg.addColorStop(0, 'rgba(255,232,222,' + (0.6 + 0.32 * pulse) + ')'); cg.addColorStop(0.4, 'rgba(255,84,66,0.32)'); cg.addColorStop(1, 'rgba(255,40,40,0)');
    ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(0, girdle, D * 0.72, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();

    // ---- orbiting ore shards ----
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU + t * 0.4, orb = D * (1.24 + 0.12 * Math.sin(t * 1.5 + i));
      const sz = D * 0.17 * (0.7 + 0.3 * Math.sin(t * 2 + i * 1.3));
      crystal(ctx, Math.cos(a) * orb, Math.sin(a) * orb * 0.9, sz, live ? '#ff3a30' : '#6a4a4d', t * 0.6 + i, live);
    }
    // ---- drifting sparkles ----
    if (live) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 5; i++) {
        const sp = (t * 0.55 + i * 1.7) % 4, a = i * 1.9 + t * 0.3, orb = D * (0.4 + sp * 0.42);
        const sx = Math.cos(a) * orb, sy = Math.sin(a) * orb * 0.8 - D * 0.2;
        const al = Math.max(0, 1 - sp / 4) * (0.6 + 0.4 * pulse);
        sparkle(ctx, sx, sy, D * 0.13, 'rgba(255,222,210,' + al + ')');
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }
  function sparkle(ctx, x, y, r, col) {
    ctx.save(); ctx.translate(x, y); ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = r * 1.4;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU - Math.PI / 2, rad = i % 2 ? r * 0.22 : r, px = Math.cos(a) * rad, py = Math.sin(a) * rad; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function crystal(ctx, x, y, r, col, rot, glow) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    const sh = ctx.createLinearGradient(-r, -r, r, r); sh.addColorStop(0, '#fff'); sh.addColorStop(0.4, col); sh.addColorStop(1, hexA(col, 0.5));
    ctx.fillStyle = sh; if (glow) { ctx.shadowColor = col; ctx.shadowBlur = 14; }
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.66, -r * 0.18); ctx.lineTo(r * 0.42, r); ctx.lineTo(-r * 0.42, r); ctx.lineTo(-r * 0.66, -r * 0.18); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.moveTo(-r * 0.66, -r * 0.18); ctx.lineTo(r * 0.66, -r * 0.18); ctx.stroke();
    ctx.restore();
  }
  function drawOreBar(ctx, cx, cy, frac, w) {
    const h = 6; ctx.save();
    ctx.fillStyle = 'rgba(8,8,18,.7)'; rr(ctx, cx - w / 2, cy, w, h, 3); ctx.fill();
    const gg = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0); gg.addColorStop(0, '#8a0014'); gg.addColorStop(1, ORE);
    ctx.fillStyle = gg; rr(ctx, cx - w / 2, cy, Math.max(0, w * frac), h, 3); ctx.fill();
    ctx.font = '700 11px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineJoin = 'round';
    const label = 'PRISM ORE ' + Math.round(frac * 100) + '%';
    ctx.strokeText(label, cx, cy - 3); ctx.fillStyle = '#ffd0cf'; ctx.fillText(label, cx, cy - 3);
    ctx.restore();
  }
  function rr(ctx, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function drawMiner(ctx, m, t) {
    const def = MINERS[m.type], im = m.spr;
    const sz = 26 + (def.hp > 600 ? 8 : def.hp > 200 ? 4 : 0);
    if (m.warpT > 0) { ctx.save(); ctx.globalAlpha = clamp(1 - m.warpT / 0.5, 0, 1); }
    ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.ang);
    if (im && im.complete && im.naturalWidth) ctx.drawImage(im, -sz / 2, -sz / 2, sz, sz);
    else { ctx.fillStyle = def.col; ctx.beginPath(); ctx.moveTo(0, -sz * 0.5); ctx.lineTo(sz * 0.34, sz * 0.4); ctx.lineTo(-sz * 0.34, sz * 0.4); ctx.closePath(); ctx.fill(); }
    if (m.hitFlash > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = m.hitFlash * 0.6; ctx.fillStyle = '#ffd0d0'; ctx.beginPath(); ctx.arc(0, 0, sz * 0.6, 0, TAU); ctx.fill(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
    ctx.restore();
    // hp bar
    const f = m.hp / m.maxhp; if (f < 1) { ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(m.x - 13, m.y - sz * 0.7 - 5, 26, 3); ctx.fillStyle = f > 0.4 ? '#46d27a' : '#ff5168'; ctx.fillRect(m.x - 13, m.y - sz * 0.7 - 5, 26 * clamp(f, 0, 1), 3); }
    if (m.warpT > 0) ctx.restore();
  }

  // ---- DEPLOY ---------------------------------------------------------------
  function deploy(tier) {
    const g = G(); if (!g) return;
    const f = FIELDS[tier - 1]; if (!fieldUnlocked(f)) { toast('Locked — reach Level ' + f.unlock); return; }
    if (!P().miners.length) { toast('Buy at least one miner first'); flashRoster(); return; }
    ensureDaily(P());
    if (lockedLeft(tier) > 0 || dailyLeft(tier) <= 0) {
      const p = P(); if (!(p.lock && p.lock[tier])) p.lock[tier] = p.daily.resetAt;
      showPrompt('⏱ Field on cooldown', '<b>' + f.name + '</b> hit its daily ore limit.<br><br>Refills in <b data-modaltimer="' + tier + '">' + fmtTime(lockedLeft(tier)) + '</b>. Try another tier in the meantime.', 'Back to hub');
      return;
    }
    const d = zoneForTier(tier);
    RUN.active = false;                 // force a fresh field on (re)deploy
    g.selectDungeon(d);                 // real combat deploy (clears prismRun via resetZone)
    g.state.prismRun = { active: true, tier: tier, d: d, started: Date.now() };
    const p = P(); p.entered = true; p.runEarned = 0;
    try { g.save(); } catch (e) {}
    const b = document.querySelector('.nav-btn[data-screen="battle"]'); if (b) b.click();
    updateHud();
  }
  function inRun() { try { return !!(G().state.prismRun && G().state.prismRun.active); } catch (e) { return false; } }
  // Called the instant the field's ore is exhausted OR the daily cap is hit —
  // either way you've maxed this zone, so you're kicked out immediately (no
  // lingering for free loot). If the daily cap was reached, the tier locks.
  function fieldDone(tier) {
    const p = P(); ensureDaily(p);
    const capped = (p.daily.used[tier] || 0) >= dailyCap(tier);
    const earned = p.runEarned || 0;
    if (capped) p.lock[tier] = p.daily.resetAt;
    kickOut();
    if (capped) showPrompt('◈ Daily limit reached', 'You have mined <b>' + FIELDS[tier - 1].name + '</b> dry for today — ◈ <b>' + fmt(dailyCap(tier)) + '</b> banked.<br><br>It refills in <b data-modaltimer="' + tier + '">' + fmtTime(lockedLeft(tier)) + '</b>. Try another tier meanwhile.', 'Back to hub');
    else showPrompt('◈ Field mined out', 'You cleared <b>' + FIELDS[tier - 1].name + '</b> — ◈ <b>' + fmt(earned) + '</b> banked this run.<br><br>Redeploy for a fresh field (◈ ' + fmt(dailyLeft(tier)) + ' left today) or try another tier.', 'Back to hub');
  }
  function kickOut() {
    const g = G(); try { g.state.prismRun = null; } catch (e) {}
    RUN.active = false;
    try { g.selectDungeon(0); } catch (e) {}   // dock the ship — leaves combat
    try { g.save(); } catch (e) {}
    updateHud(); syncChrome();
  }
  function buyMiner(type, sendNow) {
    if (minerCount(type) >= MAX_MINERS) { toast('Max ' + MAX_MINERS + ' ' + MINERS[type].name + 's reached'); return false; }
    const c = minerCost(type);
    if (gold() < c) { toast('Need ' + fmt(c) + ' gold'); return false; }
    G().state.gold -= c; P().miners.push({ type });
    if (sendNow && RUN.active && inRun()) spawnMinerEntity(type, RUN.miners.length, true);
    if (window.UI) window.UI.refreshAll(); toast('✚ ' + MINERS[type].name + (sendNow && inRun() ? ' deployed to the field' : ' added to your roster'));
    saveSoon(); updateHud(); refreshPanel(); renderHub(); return true;
  }
  function saveSoon() { if (_saveT) return; _saveT = setTimeout(() => { _saveT = 0; try { G().save(); } catch (e) {} }, 1500); }

  // ---- HUB (screen-prism) ---------------------------------------------------
  function renderHub() {
    const body = $('prism-body'); if (!body) return; const p = P(); if (!p) return;
    const sub = $('prism-sub'); if (sub) sub.textContent = '◈ ' + fmt(p.ingots) + ' banked';
    const running = inRun();
    const runBar = running ? ('<div class="pm-run"><div><div class="pm-run-t">Prism Field active · Tier ' + G().state.prismRun.tier + '</div><div class="pm-run-s">◈ ' + fmt(p.runEarned || 0) + ' mined · ' + aliveMiners().length + ' rigs digging</div></div><button class="pm-run-go" data-resume>Return to combat ▸</button></div>') : '';

    ensureDaily(p);
    const fields = FIELDS.map((f) => {
      const open = fieldUnlocked(f), d = zoneForTier(f.tier);
      const lk = open ? lockedLeft(f.tier) : 0, left = open ? dailyLeft(f.tier) : 0, cap = dailyCap(f.tier);
      let sub, action;
      if (!open) { sub = 'Unlocks at Level ' + f.unlock; action = '<span class="pm-lock">🔒 ' + f.unlock + '</span>'; }
      else if (lk > 0) { sub = '<span class="pm-cool">Daily limit reached · refills in <b data-locktimer="' + f.tier + '">' + fmtTime(lk) + '</b></span>'; action = '<span class="pm-lock">⏱</span>'; }
      else { sub = 'Zone ' + d + ' · ~Lv ' + f.enemyLv + ' · today ◈' + fmt(left) + '/' + fmt(cap); action = '<button class="pm-deploy" data-deploy="' + f.tier + '">Deploy</button>'; }
      return '<div class="pm-field ' + (open && lk <= 0 ? '' : 'locked') + '" style="--fc:' + f.col + '"><span class="pm-tier">T' + f.tier + '</span>' +
        '<div class="pm-field-m"><div class="pm-field-n">' + f.name + '</div><div class="pm-field-s">' + sub + '</div></div>' + action + '</div>';
    }).join('');

    const roster = MINER_ORDER.map((type) => {
      const def = MINERS[type], have = minerCount(type);
      const capped = have >= MAX_MINERS;
      const c = minerCost(type), afford = gold() >= c;
      const haveLbl = '×' + have + '/' + MAX_MINERS;
      const btn = capped ? '<span class="pm-maxed">MAX</span>' : '<button class="pm-buy ' + (afford ? '' : 'dis') + '" data-buy="' + type + '">$ ' + fmt(c) + '</button>';
      return '<div class="pm-mrow"><div class="pm-mrow-l"><div class="pm-mrow-n" style="color:' + def.col + '">' + def.name + ' <span class="pm-have">' + haveLbl + '</span></div>' +
        '<div class="pm-mrow-d">' + def.blurb + ' · ⛏ power ' + def.rate.toFixed(1) + ' · ' + fmt(Math.round(def.hp * (1 + lvl() * 0.07))) + ' HP</div></div>' + btn + '</div>';
    }).join('');
    const totalRate = ratePerSec(1);

    const cc = coreCost(), coreAf = p.ingots >= cc;
    const upg = '<div class="pm-core"><div class="pm-core-h">◈ Prismatic Core <span>Lv ' + (p.core || 0) + '</span></div><div class="pm-core-d">Permanent <b>+' + Math.round(CORE_BONUS * 100) + '%</b> mining rate per level — the endgame Prism sink.</div><button class="pm-core-buy ' + (coreAf ? '' : 'dis') + '" data-core>◈ ' + fmt(cc) + ' — Upgrade Core</button></div>';

    body.innerHTML =
      '<div class="pm-hero"><div class="pm-hero-ic">◈</div><div><div class="pm-hero-amt">' + fmt(p.ingots) + '</div><div class="pm-hero-lab">PRISM INGOTS · lifetime ' + fmt(p.best) + '</div></div></div>' + runBar +
      '<div class="pm-note">Deploy into a Prism Field — real combat. A huge ore field sits at the centre; your miners dig it for ◈ Prism. Raiders will hunt your rigs, so <b>fly around and protect the dig.</b> Mined prism banks instantly; only your miners are at risk.</div>' +
      '<div class="pm-lab">Your Mining Fleet <span class="pm-lab-r">' + P().miners.length + ' rigs · ◈' + totalRate.toFixed(1) + '/s at T1</span></div><div id="pm-roster">' + roster + '</div>' +
      '<div class="pm-lab">Prism Fields</div>' + fields +
      '<div class="pm-lab">Upgrades</div>' + upg;

    body.querySelectorAll('[data-deploy]').forEach((b) => b.addEventListener('click', () => deploy(+b.dataset.deploy)));
    body.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => buyMiner(b.dataset.buy, false)));
    const res = body.querySelector('[data-resume]'); if (res) res.addEventListener('click', () => { const b = document.querySelector('.nav-btn[data-screen="battle"]'); if (b) b.click(); });
    const cb = body.querySelector('[data-core]'); if (cb) cb.addEventListener('click', buyCore);
  }
  function flashRoster() { const r = $('pm-roster'); if (r) { r.style.transition = 'box-shadow .2s'; r.style.boxShadow = '0 0 0 2px ' + PRISM; setTimeout(() => r.style.boxShadow = '', 700); } }
  function buyCore() { const p = P(), c = coreCost(); if (p.ingots < c) { toast('Need ◈ ' + fmt(c) + ' Prism Ingots'); return; } p.ingots -= c; p.core = (p.core || 0) + 1; toast('◈ Prismatic Core → Lv ' + p.core); try { G().save(); } catch (e) {} updateHud(); renderHub(); }
  function buyRef() { const p = P(), c = refCost(); if ((p.refinery || 0) >= REFINERY.max) return; if (gold() < c) { toast('Need ' + fmt(c) + ' gold'); return; } G().state.gold -= c; p.refinery = (p.refinery || 0) + 1; if (window.UI) window.UI.refreshAll(); try { G().save(); } catch (e) {} renderHub(); }

  // ---- IN-COMBAT HUD: badge + deploy FAB + panel ----------------------------
  function updateHud() { const p = P(); if (!p) return; const chip = $('hud-prism'); if (chip) chip.textContent = fmt(p.ingots); const wrap = $('prism-chip'); if (wrap) wrap.style.display = (p.ingots > 0 || p.entered) ? '' : 'none'; }
  let _badge, _fab;
  function ensureChrome() {
    const app = $('app') || document.body;
    if (!_badge) { _badge = document.createElement('div'); _badge.id = 'prism-badge'; app.appendChild(_badge); }
    if (!_fab) { _fab = document.createElement('button'); _fab.id = 'prism-fab'; _fab.type = 'button'; _fab.innerHTML = '⛏'; _fab.title = 'Deploy miners'; _fab.addEventListener('click', openPanel); app.appendChild(_fab); }
  }
  // Battle is the BASE view — it has no `.active` class; it's simply whatever
  // shows when no `.screen.overlay` is active. So "on battle" == no overlay open.
  function onBattleNoOverlay() { return !document.querySelector('.screen.overlay.active'); }
  function syncChrome() {
    ensureChrome(); const show = inRun() && onBattleNoOverlay();
    _badge.classList.toggle('show', show); _fab.classList.toggle('show', show);
    if (!show && _panel) closePanel();
    if (show) updateRunHud();
  }
  function updateRunHud() {
    if (!_badge) return; const p = P(); const t = G().state.prismRun ? G().state.prismRun.tier : 1;
    const alive = aliveMiners().length, tot = P().miners.length;
    const ore = RUN.active ? Math.round(clamp(RUN.ore / RUN.oreMax, 0, 1) * 100) : 0;
    _badge.innerHTML = '<span class="pb-dot"></span>PRISM T' + t + ' · ◈ ' + fmt((p && p.runEarned) || 0) + ' · ⛏ ' + alive + '/' + tot + ' · ORE ' + ore + '%';
    if (_panel) refreshPanel();
  }

  let _panel;
  function openPanel() {
    if (_panel) { closePanel(); return; }
    _panel = document.createElement('div'); _panel.id = 'prism-panel';
    ($('app') || document.body).appendChild(_panel); buildPanel();
  }
  function closePanel() { if (_panel) { _panel.remove(); _panel = null; } }
  // Build the panel's STRUCTURE once (buttons + listeners). The live numbers are
  // updated in place by refreshPanel() — we must NOT rebuild innerHTML on every
  // HUD tick or taps (incl. the ✕) get eaten when their node is replaced mid-press.
  function buildPanel() {
    if (!_panel) return;
    const rows = MINER_ORDER.map((type) => {
      const def = MINERS[type];
      return '<div class="pp-row"><div class="pp-l"><div class="pp-n" style="color:' + def.col + '">' + def.name + ' <span class="pp-have" data-cnt="' + type + '">0/0</span></div><div class="pp-d">◈' + def.rate.toFixed(1) + '/s · ' + fmt(Math.round(def.hp * (1 + lvl() * 0.07))) + ' HP</div></div><button class="pp-buy" data-pbuy="' + type + '">＋</button></div>';
    }).join('');
    _panel.innerHTML = '<div class="pp-head"><div><div class="pp-title">⛏ Mining Field</div><div class="pp-sub"></div></div><button class="pp-x" data-px>✕</button></div>' +
      '<div class="pp-orebar"><i></i></div><div class="pp-orelab"></div>' +
      '<div class="pp-rows">' + rows + '</div>' +
      '<div class="pp-tip">Buy a rig to send it straight into the field. Keep raiders off them!</div>';
    _panel.querySelector('[data-px]').addEventListener('click', closePanel);
    _panel.querySelectorAll('[data-pbuy]').forEach((b) => b.addEventListener('click', () => buyMiner(b.dataset.pbuy, true)));
    refreshPanel();
  }
  function refreshPanel() {
    if (!_panel) return; const p = P();
    const oreF = RUN.active ? clamp(RUN.ore / RUN.oreMax, 0, 1) : 0;
    const bar = _panel.querySelector('.pp-orebar i'); if (bar) bar.style.width = (oreF * 100) + '%';
    const ol = _panel.querySelector('.pp-orelab'); if (ol) ol.textContent = 'PRISM ORE ' + Math.round(oreF * 100) + '%';
    const sub = _panel.querySelector('.pp-sub'); if (sub) sub.textContent = '◈ ' + fmt(p.runEarned || 0) + ' mined this run · ' + aliveMiners().length + ' rigs alive';
    MINER_ORDER.forEach((type) => {
      const live = RUN.miners.filter((m) => m.type === type && !m.dead).length, have = minerCount(type);
      const cnt = _panel.querySelector('[data-cnt="' + type + '"]'); if (cnt) cnt.textContent = live + '/' + have;
      const btn = _panel.querySelector('[data-pbuy="' + type + '"]'); if (!btn) return;
      if (have >= MAX_MINERS) { btn.textContent = 'MAX'; btn.classList.add('maxed'); btn.classList.remove('dis'); btn.disabled = true; }
      else { btn.textContent = '＋ $' + fmt(minerCost(type)); btn.classList.remove('maxed'); btn.disabled = false; btn.classList.toggle('dis', gold() < minerCost(type)); }
    });
  }

  let _toastT;
  function toast(text) { let t = $('prism-toast-g'); if (!t) { t = document.createElement('div'); t.id = 'prism-toast-g'; ($('app') || document.body).appendChild(t); } t.textContent = text; t.classList.add('show'); clearTimeout(_toastT); _toastT = setTimeout(() => t.classList.remove('show'), 2200); }
  let _bannerT;
  function banner(text, col) { let b = $('prism-banner-g'); if (!b) { b = document.createElement('div'); b.id = 'prism-banner-g'; ($('app') || document.body).appendChild(b); } b.textContent = text; b.style.color = col || PRISM; b.style.borderColor = hexA(col || PRISM, 0.5); b.classList.add('show'); clearTimeout(_bannerT); _bannerT = setTimeout(() => b.classList.remove('show'), 3600); }
  let _modal;
  function showPrompt(title, html, btn, onOk) {
    closePrompt();
    _modal = document.createElement('div'); _modal.id = 'prism-modal';
    _modal.innerHTML = '<div class="pmod-back"></div><div class="pmod-card"><div class="pmod-t">' + title + '</div><div class="pmod-b">' + html + '</div><button class="pmod-ok">' + (btn || 'OK') + '</button></div>';
    ($('app') || document.body).appendChild(_modal);
    const go = () => { closePrompt(); if (onOk) onOk(); else window.PRISM.open(); };
    _modal.querySelector('.pmod-ok').addEventListener('click', go);
    _modal.querySelector('.pmod-back').addEventListener('click', go);
  }
  function closePrompt() { if (_modal) { _modal.remove(); _modal = null; } }
  function updateLockTimers() {
    document.querySelectorAll('[data-locktimer]').forEach((el) => { const tier = +el.getAttribute('data-locktimer'); const lk = lockedLeft(tier); if (lk <= 0) renderHub(); else el.textContent = fmtTime(lk); });
    if (_modal) { const mt = _modal.querySelector('[data-modaltimer]'); if (mt) { const lk = lockedLeft(+mt.getAttribute('data-modaltimer')); mt.textContent = lk > 0 ? fmtTime(lk) : 'now — ready!'; } }
  }

  // ---- CSS ------------------------------------------------------------------
  function injectCss() {
    if ($('prism-css')) return; const s = document.createElement('style'); s.id = 'prism-css';
    s.textContent = `
#prism-body{padding:14px;}
.pm-hero{display:flex;align-items:center;gap:13px;background:radial-gradient(120% 120% at 0 0,rgba(123,95,255,.18),transparent),linear-gradient(180deg,#1a1430,#120e22);border:1px solid #2e2750;border-radius:16px;padding:15px 16px;}
.pm-hero-ic{font-size:30px;color:${ORE};filter:drop-shadow(0 0 10px ${ORE});}
.pm-hero-amt{font-family:'Orbitron',sans-serif;font-weight:800;font-size:26px;color:#fff;line-height:1;font-variant-numeric:tabular-nums;}
.pm-hero-lab{font-size:10px;font-weight:700;letter-spacing:.12em;color:#9a8fc0;margin-top:5px;}
.pm-run{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:11px;background:linear-gradient(180deg,rgba(95,209,255,.12),rgba(95,209,255,.04));border:1px solid rgba(95,209,255,.4);border-radius:13px;padding:11px 13px;}
.pm-run-t{font-family:'Rajdhani',sans-serif;font-weight:800;font-size:13px;color:#bfe6ff;}
.pm-run-s{font-size:11px;color:#9ec9e0;margin-top:2px;}
.pm-run-go{flex:none;border:0;border-radius:10px;padding:9px 13px;font-family:'Rajdhani',sans-serif;font-weight:800;font-size:12.5px;color:#04121c;background:linear-gradient(180deg,#9fe6ff,#5fd1ff);cursor:pointer;}
.pm-note{font-size:11.5px;line-height:1.55;color:#9a8fc0;margin:13px 2px;}
.pm-note b{color:#cdb8ff;}
.pm-lab{display:flex;justify-content:space-between;align-items:baseline;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#7d72a6;margin:16px 2px 9px;}
.pm-lab-r{letter-spacing:.02em;text-transform:none;color:#9a8fc0;font-weight:700;}
.pm-mrow{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.03);border:1px solid #271f44;border-radius:12px;padding:10px 12px;margin-bottom:7px;}
.pm-mrow-l{flex:1;min-width:0;}
.pm-mrow-n{font-family:'Rajdhani',sans-serif;font-weight:800;font-size:13.5px;}
.pm-have{color:#8b7fb0;font-size:11px;margin-left:3px;}
.pm-mrow-d{font-size:11px;color:#93a2ba;margin-top:2px;}
.pm-buy{flex:none;border:0;border-radius:10px;padding:9px 13px;font-family:'Rajdhani',sans-serif;font-weight:800;font-size:12.5px;color:#1c1206;background:linear-gradient(180deg,#ffd07a,#f2b24b);cursor:pointer;}
.pm-buy.dis{opacity:.45;filter:saturate(.4);}
.pm-field{display:flex;align-items:center;gap:11px;background:linear-gradient(180deg,#171028,#100c1e);border:1px solid #271f44;border-left:3px solid var(--fc);border-radius:13px;padding:11px 12px;margin-bottom:9px;}
.pm-field.locked{opacity:.55;}
.pm-tier{font-family:'Orbitron',sans-serif;font-weight:800;font-size:14px;color:var(--fc);width:30px;text-align:center;}
.pm-field-m{flex:1;min-width:0;}
.pm-field-n{font-family:'Rajdhani',sans-serif;font-weight:800;font-size:14px;color:#eaf0fa;}
.pm-field-s{font-size:11px;color:#93a2ba;margin-top:2px;}
.pm-deploy{flex:none;border:0;border-radius:10px;padding:10px 15px;font-family:'Rajdhani',sans-serif;font-weight:800;font-size:13px;color:#04121c;background:linear-gradient(180deg,#9fe6ff,#5fd1ff);cursor:pointer;box-shadow:0 5px 14px rgba(95,209,255,.28);}
.pm-deploy:active{transform:scale(.96);}
.pm-lock{flex:none;font-size:11px;font-weight:700;color:#7d72a6;}
.pm-core{background:radial-gradient(120% 120% at 50% 0,rgba(255,212,80,.14),transparent),linear-gradient(180deg,#1d1633,#140f24);border:1px solid rgba(255,212,80,.34);border-radius:14px;padding:13px;margin-bottom:9px;}
.pm-core-h{font-family:'Orbitron',sans-serif;font-weight:800;font-size:14px;color:#ffd450;display:flex;justify-content:space-between;}
.pm-core-d{font-size:11.5px;color:#bdb0d8;margin:6px 0 11px;line-height:1.5;}
.pm-core-buy{width:100%;border:0;border-radius:11px;padding:11px;font-family:'Rajdhani',sans-serif;font-weight:800;font-size:13.5px;color:#1c1206;background:linear-gradient(180deg,#ffe27a,#f2b24b);cursor:pointer;}
.pm-core-buy.dis{opacity:.5;filter:saturate(.5);}
.pm-ref{display:flex;align-items:center;justify-content:space-between;gap:10px;background:rgba(255,255,255,.03);border:1px solid #271f44;border-radius:12px;padding:11px 13px;}
.pm-ref-n{font-family:'Rajdhani',sans-serif;font-weight:800;font-size:13.5px;color:#eaf0fa;}
.pm-ref-lv{font-size:10px;color:#8b7fb0;font-weight:700;margin-left:4px;}
.pm-ref-d{font-size:11px;color:#93a2ba;margin-top:2px;}
.pm-ref-buy{flex:none;border:0;border-radius:10px;padding:9px 13px;font-family:'Rajdhani',sans-serif;font-weight:800;font-size:12.5px;color:#1c1206;background:linear-gradient(180deg,#ffd07a,#f2b24b);cursor:pointer;}
.pm-ref-buy.dis{opacity:.45;filter:saturate(.4);}
.pm-ref-max{flex:none;font-size:11px;font-weight:800;color:#46d27a;}
#prism-badge{position:absolute;top:118px;left:50%;transform:translateX(-50%) translateY(-6px);z-index:7;display:none;align-items:center;gap:7px;background:rgba(20,14,34,.92);border:1px solid ${PRISM};border-radius:20px;padding:5px 13px;font-family:'Rajdhani',sans-serif;font-weight:800;font-size:11.5px;letter-spacing:.03em;color:${PRISM};white-space:nowrap;box-shadow:0 8px 22px rgba(0,0,0,.5);opacity:0;transition:opacity .25s;pointer-events:none;}
#prism-badge.show{display:flex;opacity:1;}
#prism-badge .pb-dot{width:7px;height:7px;border-radius:50%;background:${PRISM};box-shadow:0 0 8px ${PRISM};animation:pbP 1.4s infinite;}
@keyframes pbP{0%,100%{opacity:1;}50%{opacity:.4;}}
#prism-fab{position:absolute;right:14px;bottom:150px;z-index:8;display:none;align-items:center;justify-content:center;width:52px;height:52px;border-radius:50%;border:1px solid ${PRISM};background:radial-gradient(circle at 50% 35%,#2a1f48,#160f28);color:${PRISM};font-size:22px;cursor:pointer;box-shadow:0 8px 22px rgba(0,0,0,.55),0 0 0 4px rgba(201,160,255,.12);}
#prism-fab.show{display:flex;}
#prism-fab:active{transform:scale(.94);}
#prism-panel{position:absolute;left:12px;right:12px;bottom:118px;z-index:9;background:linear-gradient(180deg,#1b1430,#100b1e);border:1px solid #322a52;border-radius:16px;padding:12px;box-shadow:0 16px 44px rgba(0,0,0,.6);animation:ppUp .22s cubic-bezier(.22,1,.36,1);}
@keyframes ppUp{from{transform:translateY(20px);opacity:0;}to{transform:none;opacity:1;}}
.pp-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:9px;}
.pp-title{font-family:'Orbitron',sans-serif;font-weight:800;font-size:14px;color:#eaf0fa;}
.pp-sub{font-size:11px;color:#9ec9e0;margin-top:3px;}
.pp-x{flex:none;width:28px;height:28px;border-radius:8px;border:1px solid #322a52;background:rgba(255,255,255,.04);color:#cdb8ff;font-size:13px;cursor:pointer;}
.pp-orebar{height:7px;border-radius:4px;background:#241b3a;overflow:hidden;}
.pp-orebar i{display:block;height:100%;background:linear-gradient(90deg,#8a0014,${ORE});border-radius:4px;transition:width .25s;}
.pp-orelab{font-size:9.5px;font-weight:800;letter-spacing:.12em;color:#9a8fc0;margin:5px 0 10px;}
.pp-rows{display:flex;flex-direction:column;gap:6px;}
.pp-row{display:flex;align-items:center;gap:9px;background:rgba(255,255,255,.03);border:1px solid #271f44;border-radius:10px;padding:8px 10px;}
.pp-l{flex:1;min-width:0;}
.pp-n{font-family:'Rajdhani',sans-serif;font-weight:800;font-size:13px;}
.pp-have{color:#8b7fb0;font-size:11px;margin-left:3px;}
.pp-d{font-size:10.5px;color:#93a2ba;margin-top:1px;}
.pp-buy{flex:none;border:0;border-radius:9px;padding:8px 11px;font-family:'Rajdhani',sans-serif;font-weight:800;font-size:12px;color:#1c1206;background:linear-gradient(180deg,#ffd07a,#f2b24b);cursor:pointer;}
.pp-buy.dis{opacity:.45;filter:saturate(.4);}
.pp-buy.maxed{background:none;box-shadow:none;color:#46d27a;cursor:default;}
.pp-buy:disabled{cursor:default;}
.pp-tip{font-size:10.5px;color:#7d72a6;margin-top:9px;text-align:center;}
#prism-toast-g{position:absolute;bottom:120px;left:50%;transform:translateX(-50%) translateY(8px);z-index:40;background:rgba(20,18,34,.96);border:1px solid #3a3360;border-radius:10px;padding:8px 15px;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:12.5px;color:#eaf0fa;white-space:nowrap;max-width:88%;overflow:hidden;text-overflow:ellipsis;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;}
#prism-toast-g.show{opacity:1;transform:translateX(-50%) translateY(0);}
#prism-banner-g{position:absolute;top:150px;left:50%;transform:translateX(-50%) translateY(-10px);z-index:41;background:rgba(10,8,20,.94);border:1px solid ${PRISM};border-radius:12px;padding:9px 15px;font-family:'Rajdhani',sans-serif;font-weight:800;font-size:12.5px;color:${PRISM};white-space:nowrap;max-width:90%;overflow:hidden;text-overflow:ellipsis;opacity:0;pointer-events:none;transition:opacity .3s,transform .3s;box-shadow:0 12px 34px rgba(0,0,0,.6);}
#prism-banner-g.show{opacity:1;transform:translateX(-50%) translateY(0);}
.pm-cool{color:#ff8a8a;}
.pm-maxed,.pp-maxed{flex:none;font-size:11px;font-weight:800;color:#46d27a;letter-spacing:.06em;padding:8px 6px;}
#prism-modal{position:absolute;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;}
.pmod-back{position:absolute;inset:0;background:rgba(4,4,10,.72);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);}
.pmod-card{position:relative;width:84%;max-width:340px;background:linear-gradient(180deg,#1c1024,#120a18);border:1px solid #50263a;border-radius:18px;padding:20px 18px;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,.65),0 0 0 1px rgba(255,42,47,.15);animation:pmodIn .24s cubic-bezier(.22,1,.36,1);}
@keyframes pmodIn{from{transform:scale(.92);opacity:0;}to{transform:none;opacity:1;}}
.pmod-t{font-family:'Orbitron',sans-serif;font-weight:800;font-size:15.5px;color:#ff5a4d;text-shadow:0 0 16px rgba(255,42,47,.5);margin-bottom:10px;}
.pmod-b{font-family:'Rajdhani',sans-serif;font-size:13.5px;line-height:1.6;color:#e7d6dc;}
.pmod-b b{color:#ffd0cf;}
.pmod-ok{margin-top:16px;width:100%;border:0;border-radius:12px;padding:12px;font-family:'Rajdhani',sans-serif;font-weight:800;font-size:14px;color:#1c0608;background:linear-gradient(180deg,#ff9a6a,#ff4d4d);cursor:pointer;box-shadow:0 8px 20px rgba(255,60,60,.3);}
.pmod-ok:active{transform:scale(.97);}
`;
    document.head.appendChild(s);
  }

  // ---- BOOT -----------------------------------------------------------------
  let _booted = false;
  function boot() {
    if (_booted) return; const screen = $('screen-prism'); if (!screen) return; _booted = true;
    injectCss(); ensureChrome();
    const mo = new MutationObserver(() => { if (screen.classList.contains('active')) renderHub(); });
    mo.observe(screen, { attributes: true, attributeFilter: ['class'] });
    if (screen.classList.contains('active')) renderHub();
    const chip = $('prism-chip'); if (chip) chip.addEventListener('click', () => window.PRISM.open());
    setInterval(() => { if (document.hidden) return; try { if (G() && G().state.prism) { updateHud(); syncChrome(); if (screen.classList.contains('active') || _modal) updateLockTimers(); } } catch (e) {} }, 700);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  setTimeout(boot, 1200);

  window.PRISM = { tick, render, onKill, deploy, open: () => { const b = document.querySelector('.nav-btn[data-screen="prism"]'); if (b) b.click(); }, updateHud, P, __dbg: { RUN, fieldR, aliveMiners, initRun } };
})();
