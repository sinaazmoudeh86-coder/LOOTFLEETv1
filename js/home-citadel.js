/* =============================================================================
   home-citadel.js — LOOTFLEET · HOME CITADEL (Command ▸ Lv 35)
   ---------------------------------------------------------------------------
   Your personal industrial empire: an ACTIVE tower-defense that permanently
   raises PASSIVE production. Clear Wave N → your Home Zone mines richer,
   forever. Fail → nothing is lost, but the base is damaged and mining halts
   until repairs finish. Pays ONLY existing currencies (gold, ore, fuel,
   plasma, prism, ◇ cores, real Shipworks parts) — no new economy.
     · Production/hr = wave^1.45 × zone-scale × buildings (×2 past Wave 100)
     · Storage-capped (8h base → 24h) — collect on return, like Moon Colony
     · Wave strength scales off YOUR fleet DPS: always a fight, never a chore
     · Defense: citadel on the left, raiders stream in; turrets + your fleet
       auto-fire; TAP a raider to call a fleet strike (the active skill).
   Wiring: #screen-homecit / #homecit-body · showScreen('homecit') ·
   command card .cmd-homecit · LOCKS homecit:35 · window.HOMECIT.
   ============================================================================= */
(function () {
  'use strict';
  const G = () => window.GAME;
  const $ = (id) => document.getElementById(id);
  const ACCENT = '#ffb84d';
  const UNLOCK = 150;
  const BASE_CAP_H = 8;

  function fmt(n) { try { return G().formatNum(Math.floor(n)); } catch (e) { return Math.floor(n) + ''; } }
  function lvl() { try { return (G().state.level | 0) || 1; } catch (e) { return 1; } }
  function toast(m) { try { if (window.UI && window.UI.unlockToast) window.UI.unlockToast(m); } catch (e) {} }
  function zScale() { try { return Math.max(1, Math.pow(Math.max(1, G().state.highestUnlocked || 1), 1.12)); } catch (e) { return 1; } }
  function shipName(k) { try { return window.CONFIG.SHIP_BY_KEY[k].name; } catch (e) { return k; } }

  // ---- state ----------------------------------------------------------------
  function hc() {
    const g = G(); if (!g || !g.state) return null;
    const st = g.state;
    if (!st.homecit) st.homecit = { v: 1, wave: 0, cit: 0, last: Date.now(), b: { mine: 0, silo: 0, turret: 0, repair: 0 }, dmg: 0, seen: 0 };
    return st.homecit;
  }
  const damaged = (s) => s && s.dmg > Date.now();

  // ---- buildings --------------------------------------------------------
  const BLD = {
    mine:   { ic: '⛏', name: 'Mining Array', bmax: 10, eff: (l) => '+' + l * 10 + '% production',      next: (l) => '+10% production',    base: { gold: 25000, iron: 1200 } },
    silo:   { ic: '▣', name: 'Deep Silo',    bmax: 8,  eff: (l) => (BASE_CAP_H + l * 2) + 'h storage', next: (l) => '+2h storage',        base: { gold: 40000, fuel: 2000 } },
    turret: { ic: '☄', name: 'Defense Grid', bmax: 10, eff: (l) => '+' + l * 8 + '% turret fire',      next: (l) => '+8% turret fire',    base: { gold: 30000, plasma: 800 } },
    repair: { ic: '🔧', name: 'Repair Bay',  bmax: 5,  eff: (l) => '−' + l * 12 + '% repair time',     next: (l) => '−12% repair time',   base: { gold: 20000, iron: 800 } },
  };
  // CITADEL LEVEL: +10 max levels on EVERY structure, forever. Cost anchors to
  // CURRENT hourly production (progression-true) and TRIPLES per level.
  function bldMax(s, key) { return BLD[key].bmax + (s.cit | 0) * 10; }
  function citCost(s) {
    const lv = s.cit | 0;
    const hourly = Math.max(100000, rates(s).gold);
    const gold = Math.round(Math.max(2e6, hourly * 20) * Math.pow(3, lv));
    return { gold, iron: Math.round(gold / 25), fuel: Math.round(gold / 25), plasma: Math.round(gold / 40) };
  }
  function buyCit() {
    const s = hc(); if (!s) return;
    const c = citCost(s);
    if (!canAfford(c)) { toast('The Citadel demands more — ' + costTxt(c)); return; }
    pay(c); s.cit = (s.cit | 0) + 1;
    try { G().save(); } catch (e) {}
    toast('🏰 CITADEL LEVEL ' + s.cit + ' — every structure can now reach +' + (s.cit * 10) + ' levels');
    render(); if (window.UI) window.UI.refreshAll();
  }
  function bldCost(key, curLv) {
    const s = hc(), b = BLD[key], o = {};
    const f = Math.pow(1.9, curLv) * (1 + s.wave * 0.12);
    for (const k in b.base) o[k] = Math.round(b.base[k] * f);
    return o;
  }
  function canAfford(c) {
    const st = G().state;
    if ((st.gold || 0) < (c.gold || 0)) return false;
    if ((st.resources.fuel || 0) < (c.fuel || 0)) return false;
    if ((st.resources.iron || 0) < (c.iron || 0)) return false;
    if ((st.resources.plasma || 0) < (c.plasma || 0)) return false;
    return true;
  }
  function pay(c) {
    const st = G().state;
    st.gold -= c.gold || 0; st.resources.fuel -= c.fuel || 0; st.resources.iron -= c.iron || 0; st.resources.plasma -= c.plasma || 0;
  }
  function buyBld(key) {
    const s = hc(), b = BLD[key], cur = s.b[key] | 0;
    if (cur >= bldMax(s, key)) return;
    const c = bldCost(key, cur);
    if (!canAfford(c)) { toast('Need more resources for the ' + b.name); return; }
    pay(c); s.b[key] = cur + 1;
    if (run && run.b) run.b[key] = s.b[key];   // live run sees the new level (city canvas re-bakes via key)
    try { G().save(); } catch (e) {}
    toast(b.ic + ' ' + b.name + ' → Lv ' + s.b[key]);
    render(); if (window.UI) window.UI.refreshAll();
  }

  // ---- rarity bands + milestones ------------------------------------------
  function band(w) {
    if (w >= 250) return { name: 'Mythic',    c: '#ff5a68' };
    if (w >= 100) return { name: 'Legendary', c: '#ffd24d' };
    if (w >= 50)  return { name: 'Epic',      c: '#c07bff' };
    if (w >= 20)  return { name: 'Rare',      c: '#5bc0ff' };
    return { name: 'Common', c: '#9fb0c4' };
  }
  function crateKeys(w) {
    if (w > 90) return ['dread1', 'dread2', 'dread3', 'dread4', 'dread5', 'dread6'];
    if (w > 50) return ['oblivionspear', 'oblivionspearalpha', 'oblivionfinal'];
    if (w > 25) return ['supercarrier', 'titan', 'mothership'];
    return ['dreadnought', 'carrier', 'aegis'];
  }
  const MILES = [
    [1, 'Gold flows'], [5, '+Ore & Fuel'], [10, 'Part crate every 10th wave'], [15, '+Plasma'],
    [20, 'RARE raiders · richer tables'], [40, '+◈ Prism trickle'], [50, 'EPIC era · +◇ Cores on crates'],
    [100, 'LEGENDARY era · ×2 ALL production'], [250, 'MYTHIC era — endgame tables'],
  ];

  // ---- production -----------------------------------------------------------
  function capHours(s) { return BASE_CAP_H + (s.b.silo | 0) * 2; }
  function rates(s) {
    const w = s.wave | 0;
    if (w < 1) return { gold: 0, iron: 0, fuel: 0, plasma: 0, prism: 0 };
    const mult = Math.pow(w, 1.45) * zScale() * (1 + (s.b.mine | 0) * 0.10) * (w >= 100 ? 2 : 1);
    return {
      gold: 1500 * mult,
      iron: w >= 5 ? 55 * mult : 0,
      fuel: w >= 5 ? 45 * mult : 0,
      plasma: w >= 15 ? 28 * mult : 0,
      prism: w >= 40 ? 0.4 * Math.pow(w, 1.15) : 0,
    };
  }
  function accrued(s) {
    if (damaged(s) || s.wave < 1) return { h: 0, out: rates(s), tot: 0 };
    // production resumes when repairs FINISH — the damaged window is never
    // retro-credited (s.dmg is the floor; collect/repair push s.last past it)
    const from = Math.max(s.last || 0, s.dmg || 0);
    const h = Math.min(capHours(s), Math.max(0, (Date.now() - from) / 3600e3));
    const r = rates(s), out = {};
    let tot = 0;
    for (const k in r) { out[k] = r[k] * h; tot += out[k]; }
    return { h, out, tot };
  }
  function collect() {
    const s = hc(); if (!s) return;
    const a = accrued(s);
    if (a.tot < 1) { toast('Nothing stored yet — production is ticking'); return; }
    const st = G().state;
    st.gold += a.out.gold; st.resources.iron += a.out.iron; st.resources.fuel += a.out.fuel; st.resources.plasma += a.out.plasma;
    if (a.out.prism >= 1 && G().addPrism) G().addPrism(Math.floor(a.out.prism));
    else if (a.out.prism >= 1) st.prismIngots = (st.prismIngots || 0) + Math.floor(a.out.prism);
    s.last = Date.now();
    try { G().save(); } catch (e) {}
    toast('⛏ Collected ' + fmt(a.out.gold) + ' gold' + (a.out.iron >= 1 ? ' +resources' : ''));
    render(); if (window.UI) window.UI.refreshAll();
  }

  // ---- repair ---------------------------------------------------------------
  function repairLockMs(s) { return Math.max(6, 30 * (1 - (s.b.repair | 0) * 0.12)) * 60000; }
  function repairCost(s) { return Math.max(2000, Math.round(rates({ ...s, wave: Math.max(1, s.wave) }).gold)); }
  function repairNow() {
    const s = hc(); if (!s || !damaged(s)) return;
    const c = repairCost(s);
    if ((G().state.gold || 0) < c) { toast('Need $' + fmt(c) + ' for emergency repairs'); return; }
    G().state.gold -= c; s.dmg = 0; s.last = Date.now();
    try { G().save(); } catch (e) {}
    toast('🔧 Citadel repaired — mining resumed');
    render(); if (window.UI) window.UI.refreshAll();
  }

  // =========================================================================
  // WAVE DEFENSE — canvas tower-defense vs your own DPS curve
  // =========================================================================
  let run = null;
  function fleetStats() {
    let st = {}; try { st = G().getStats() || {}; } catch (e) {}
    const ad = st.attackDamage || 50, aps = st.attacksPerSec || 1.2;
    const cc = Math.min(100, st.critChance || 0), cd = Math.max(100, st.critDamage || 150);
    const ms = st.multiShot || 0;
    return { dps: Math.max(10, ad * aps * (1 + cc / 100 * (cd / 100 - 1)) * (1 + ms / 100)), maxHp: Math.max(50, st.maxHp || 500) };
  }
  function startWave(auto) {
    const s = hc(); if (!s) return;
    if (run) {
      // a run object without a live deployment is a stranded run — clear it
      let live = false; try { live = !!(G().rt && G().rt.hcrun); } catch (e) {}
      if (live) { toast('Defense already underway — return to the battle'); return; }
      abortRun('Previous defense was interrupted — re-deploying');
    }
    if (damaged(s)) { toast('Repair the citadel first'); return; }
    if (lvl() < UNLOCK) return;
    try { const grt = G().rt; if (grt && grt.sdrun) { toast('Finish the Voidmaw run first'); return; } } catch (e) {}
    try { const dr = G().state.dreadRun; if (dr && dr.active) { toast('Finish the Dreadnaught hunt first'); return; } } catch (e) {}
    if (accrued(s).tot >= 1) collect();               // bank stored production first
    let prevSpeed = 1;
    try { prevSpeed = G().state.gameSpeed || 1; G().setGameSpeed(1); } catch (e) {}   // defense runs at 1× — restored at wave end
    let dep = null;
    try { dep = G().startHomeDefense(); } catch (e) {}
    if (!dep) { toast('Deploy failed — try again'); try { if (prevSpeed !== 1) G().setGameSpeed(prevSpeed); } catch (e) {} return; }
    const ps = fleetStats();
    const next = (s.wave | 0) + 1;
    const turretPct = (s.b.turret | 0) * 0.08;
    const N = Math.min(40, 10 + Math.ceil(next * 1.6));
    const fortMax = ps.maxHp * 12 * (1 + (s.b.turret | 0) * 0.05);
    run = { next, N, spawned: 0, refs: [], spawnT: 1.8, spawnIv: Math.max(0.55, 42 / N),
            unitHp: ps.dps * (1 + turretPct) * (55 + next * 4.5) / N,
            dps: ps.dps, turretDps: ps.dps * turretPct, turretTarget: null,
            fort: { x: dep.worldW / 2, y: dep.worldH * 0.42, size: 100, hp: fortMax, max: fortMax, dead: false, hitT: 0 },
            auto: !!auto, session: { waves: 0, gold: 0, crates: 0 }, between: null,
            prevSpeed, uiT: 0, zone: dep.zone, b: { mine: s.b.mine | 0, silo: s.b.silo | 0, turret: s.b.turret | 0, repair: s.b.repair | 0 } };
    ensureWarbar();
    const nav = document.querySelector('.nav-btn[data-screen="battle"]'); if (nav) nav.click();
    bbanner('WAVE ' + next + ' — DEFEND THE CITADEL', band(next).name.toUpperCase() + ' raiders inbound · they burn the FORT, not you — intercept them');
    render(); updateHud();
  }
  // driven by the engine's update() every frame while rt.hcrun is active
  function engineTick(dt, rt) {
    if (!run) { rt.hcrun = null; return; }
    if (run.zone !== (G().state.currentDungeon | 0)) return endWave(false, true);   // bailed to hangar / warped = abandon
    if (run.between != null) {   // auto-defense intermission — next wave spinning up
      run.between -= dt;
      if (run.between <= 0) { run.between = null; rollNext(); }
      return;
    }
    const f = run.fort;
    // EXTENDED ENGAGEMENT RANGE — defending a fixed fort needs reach: 2.5× while
    // the defense is live, re-applied after any stat refresh, dropped at wave end.
    if (rt.stats && !rt.stats._hcRange) { rt.stats.fireRange = (rt.stats.fireRange || 250) * 2.5; rt.stats._hcRange = 1; }
    // stream raiders in from the edges, aimed at the fort (pressure valve: the
    // stream holds while 26+ are already alive — denser is laggier AND unfair)
    const aliveNow = run.refs.reduce((a, e) => a + ((e.dead || e.dying || e.hp <= 0) ? 0 : 1), 0);
    run.spawnT -= dt;
    if (run.spawnT <= 0 && run.spawned < run.N && aliveNow < 26) {
      run.spawnT = run.spawnIv * (0.7 + Math.random() * 0.6);
      run.spawned++;
      const side = Math.random();
      const x = side < 0.38 ? -30 : side < 0.76 ? rt.worldW + 30 : Math.random() * rt.worldW;
      const y = side < 0.76 ? Math.random() * rt.worldH * 0.55 : rt.worldH + 30;
      const e = G().spawnHomeRaider(x, y);
      if (e) {
        e.maxHp = e.hp = Math.max(20, Math.round(run.unitHp * (0.8 + Math.random() * 0.4)));
        e.raidTarget = { x: f.x + (Math.random() - 0.5) * 90, y: f.y + (Math.random() - 0.5) * 56, size: f.size * 0.72, dead: false };
        e.isRaider = true;
        run.refs.push(e);
      }
    }
    // latched raiders chew the fort (~15s with 6 latched, unopposed)
    let latched = 0;
    for (const e of run.refs) {
      if (e.dead || e.dying || e.hp <= 0) continue;
      if (Math.hypot(e.x - f.x, e.y - f.y) <= f.size + (e.size || 14) + 12) latched++;
    }
    if (latched) { f.hp -= f.max * 0.016 * latched * dt; f.hitT = 0.35; if (Math.random() < dt * 2.5) rt.shake = Math.min(5, (rt.shake || 0) + 1.2); }
    f.hitT = Math.max(0, f.hitT - dt);
    // Defense Grid — turret fire from the fort at the nearest live raider
    run.turretTarget = null;
    if (run.turretDps > 0) {
      let best = null, bd = 1e9;
      for (const e of run.refs) { if (e.dead || e.dying || e.hp <= 0) continue; const d = Math.hypot(e.x - f.x, e.y - f.y); if (d < bd) { bd = d; best = e; } }
      if (best && bd < 640) { try { best.takeDamage(run.turretDps * dt); } catch (e2) { best.hp -= run.turretDps * dt; } run.turretTarget = best; }
    }
    const alive = aliveNow;
    run.uiT -= dt;
    if (run.uiT <= 0) {
      run.uiT = 0.12; syncWarbar(alive);
      // cache beam targets + silo fill at 8Hz — the renderer just draws them
      const gx = f.x + 150, muzY = f.y - 164;
      const live = run.refs.filter((e) => !(e.dead || e.dying || e.hp <= 0));
      live.sort((a2, b2) => Math.hypot(a2.x - gx, a2.y - muzY) - Math.hypot(b2.x - gx, b2.y - muzY));
      run.beamTargets = ((run.b.turret | 0) > 0) ? live.slice(0, Math.min(3, Math.ceil((run.b.turret | 0) / 3))).filter((e) => Math.hypot(e.x - gx, e.y - muzY) <= 660) : [];
      try { const s2 = hc(); run.siloFrac = Math.min(1, accrued(s2).h / capHours(s2)); } catch (e) { run.siloFrac = 0; }
    }
    if (f.hp <= 0) { f.hp = 0; return endWave(false); }
    if (run.spawned >= run.N && alive === 0) return endWave(true);
  }
  // the FORT + the EMPIRE — drawn in-world. PERF: every static (halo, roads,
  // districts, citadel + structure art, labels, ghost pads) is baked into ONE
  // offscreen canvas, rebuilt only when buildings/art change; per-frame work is
  // a single blit + the live bits (shield, HP arc, beams, drones, patrol).
  function engineRender(ctx, t, rt) {
    if (!run) return;
    ctx.save();
    ctx.scale(rt.zoom || 1, rt.zoom || 1);
    ctx.translate(-rt.cam.x, -rt.cam.y);
    const f = run.fort;
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.6);
    const hurt = f.hitT > 0;
    ensureCity(f);
    if (_city.cv) ctx.drawImage(_city.cv, f.x - CITY_W / 2, f.y - CITY_TOP);
    // dynamics over the baked city
    drawCityDynamics(ctx, t, f, pulse, hurt);
    drawHomeDrones(ctx, t, f);
    drawPatrolFleet(ctx, t, f);
    // DEFENSE GRID fire — targets cached in the tick
    const bt = run.beamTargets || [];
    for (let i = 0; i < bt.length; i++) {
      const tt2 = bt[i]; if (!tt2 || tt2.dead || tt2.dying || tt2.hp <= 0) continue;
      ctx.strokeStyle = 'rgba(140,255,110,' + (0.5 + pulse * 0.35) + ')'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(f.x + 138 + i * 12, f.y - 164); ctx.lineTo(tt2.x, tt2.y); ctx.stroke();
      ctx.fillStyle = '#d6ffc2'; ctx.beginPath(); ctx.arc(tt2.x, tt2.y, 3, 0, 7); ctx.fill();
    }
    ctx.restore();   // pop the re-applied camera transform
  }
  function hexPath(ctx, r, rot) { ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + rot; const px = Math.cos(a) * r, py = Math.sin(a) * r; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); }
  // ---- baked city canvas ----------------------------------------------------
  const CITY_W = 680, CITY_H = 600, CITY_TOP = 280;   // world px, origin = fort center
  const _hcImgs = {};
  function hcImg(n) { if (!_hcImgs[n]) { const im = new Image(); im.src = 'ships/hc-' + n + '.png'; _hcImgs[n] = im; } return _hcImgs[n]; }
  let _city = { cv: null, key: '' };
  function cityKey() {
    const b = run.b;
    const imgs = ['citadel', 'mine', 'silo', 'turret', 'repair'].map((n) => (hcImg(n).complete && hcImg(n).naturalWidth) ? 1 : 0).join('');
    return b.mine + '·' + b.silo + '·' + b.turret + '·' + b.repair + '·' + imgs;
  }
  function ensureCity(f) {
    const key = cityKey();
    if (_city.cv && _city.key === key) return;
    _city.key = key;
    const cv = _city.cv || document.createElement('canvas');
    cv.width = CITY_W; cv.height = CITY_H;
    const c2 = cv.getContext('2d');
    c2.clearRect(0, 0, CITY_W, CITY_H);
    c2.save(); c2.translate(CITY_W / 2, CITY_TOP);
    // ground halo (the one gradient — baked)
    const g = c2.createRadialGradient(0, 0, f.size * 0.3, 0, 0, f.size * 2.4);
    g.addColorStop(0, 'rgba(120,255,96,0.15)'); g.addColorStop(1, 'rgba(120,255,96,0)');
    c2.fillStyle = g; c2.beginPath(); c2.arc(0, 0, f.size * 2.4, 0, 7); c2.fill();
    // roads
    c2.strokeStyle = 'rgba(120,255,96,.24)'; c2.lineWidth = 3; c2.setLineDash([2, 10]);
    [[-205, 55], [205, 50], [-130, 175], [150, -120]].forEach(([dx, dy]) => { c2.beginPath(); c2.moveTo(0, 0); c2.lineTo(dx, dy); c2.stroke(); });
    c2.setLineDash([]);
    // districts (lit windows baked)
    const RND = (i) => (((Math.sin(i * 127.1) * 43758.5453) % 1) + 1) % 1;
    for (let c = 0; c < 6; c++) {
      const ca = c * 1.047 + 0.5, cr = f.size + 46 + (c % 2) * 26;
      const cx = Math.cos(ca) * cr, cy = Math.sin(ca) * cr * 0.72 + 8;
      for (let bi = 0; bi < 4; bi++) {
        const bx = cx + (RND(c * 7 + bi) - 0.5) * 34, by = cy + (RND(c * 13 + bi + 3) - 0.5) * 22;
        const bw = 5 + RND(c + bi) * 7, bh = 4 + RND(c * 3 + bi) * 6;
        c2.fillStyle = 'rgba(22,34,18,.9)'; c2.fillRect(bx - bw / 2, by - bh / 2, bw, bh);
        c2.strokeStyle = 'rgba(120,255,96,.32)'; c2.lineWidth = 1; c2.strokeRect(bx - bw / 2, by - bh / 2, bw, bh);
        if (RND(c * 5 + bi) > 0.3) { c2.fillStyle = 'rgba(200,255,176,.85)'; c2.fillRect(bx - 1, by - 1, 2, 2); }
      }
    }
    // structures (art or ghost pads) + labels
    const b = run.b;
    const struct = (x, y, name, built, lv, label, w) => {
      c2.save(); c2.translate(x, y);
      if (built) {
        const im = hcImg(name);
        const s = w * (1 + Math.min(0.25, lv * 0.03));
        if (im.complete && im.naturalWidth) { const h = s * im.naturalHeight / im.naturalWidth; c2.drawImage(im, -s / 2, -h * 0.78, s, h); }
      } else {
        c2.globalAlpha = 0.3;
        c2.strokeStyle = 'rgba(120,255,96,.45)'; c2.setLineDash([5, 6]); c2.lineWidth = 1.4;
        c2.beginPath();
        for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; const px = Math.cos(a) * w * 0.42, py = Math.sin(a) * w * 0.26; i ? c2.lineTo(px, py) : c2.moveTo(px, py); }
        c2.closePath(); c2.stroke(); c2.setLineDash([]);
        c2.globalAlpha = 1;
      }
      c2.font = '800 10px Rajdhani,sans-serif'; c2.textAlign = 'center';
      c2.fillStyle = built ? '#c8ffb0' : '#6a8a5c';
      c2.fillText(label + (built ? ' · L' + lv : ''), 0, w * 0.3 + 16);
      c2.restore();
    };
    struct(-205, 55, 'mine', b.mine > 0, b.mine, 'MINING ARRAY', 104);
    struct(205, 50, 'silo', true, Math.max(1, b.silo), 'DEEP SILO', 92);
    struct(150, -120, 'turret', b.turret > 0, b.turret, 'DEFENSE GRID', 96);
    struct(-130, 175, 'repair', b.repair > 0, b.repair, 'REPAIR BAY', 94);
    // THE CITADEL
    const im = hcImg('citadel');
    const cw = f.size * 2.35;
    if (im.complete && im.naturalWidth) { const chh = cw * im.naturalHeight / im.naturalWidth; c2.drawImage(im, -cw / 2, -chh * 0.66, cw, chh); }
    else { c2.fillStyle = 'rgba(140,255,120,.3)'; c2.beginPath(); c2.arc(0, 0, f.size * 0.8, 0, 7); c2.fill(); }
    // silo gauge frame
    c2.fillStyle = 'rgba(12,20,10,.85)'; c2.strokeStyle = 'rgba(160,255,140,.6)'; c2.lineWidth = 1.2;
    c2.fillRect(205 + 58 - 4, 50 - 20 - 21, 8, 42); c2.strokeRect(205 + 58 - 4, 50 - 20 - 21, 8, 42);
    c2.restore();
    _city.cv = cv;
  }
  // ---- per-frame dynamics (cheap strokes only) ------------------------------
  function drawCityDynamics(ctx, t, f, pulse, hurt) {
    ctx.save(); ctx.translate(f.x, f.y);
    if (hurt) { ctx.globalAlpha = 0.20 + pulse * 0.08; ctx.fillStyle = '#ff4a4a'; ctx.beginPath(); ctx.arc(0, -30, f.size * 1.25, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
    // rotating shield wall
    ctx.strokeStyle = hurt ? 'rgba(255,110,110,.85)' : 'rgba(120,255,96,' + (0.35 + pulse * 0.3) + ')';
    ctx.lineWidth = 1.6; hexPath(ctx, f.size, t * 0.1); ctx.stroke();
    // hull arc + labels
    const frac = Math.max(0, f.hp / f.max);
    ctx.beginPath(); ctx.arc(0, 0, f.size + 18, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.strokeStyle = frac > 0.35 ? 'rgba(124,224,160,.9)' : 'rgba(255,90,104,.95)'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.stroke();
    ctx.font = '800 15px Rajdhani,sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = hurt ? '#ffb1b1' : '#c8ffb0';
    ctx.fillText('HOME CITADEL', 0, -f.size - 34);
    ctx.font = '700 13px Rajdhani,sans-serif';
    ctx.fillText(Math.ceil(frac * 100) + '%', 0, -f.size - 18);
    // live silo fill (frame is baked)
    const fillFrac = run.siloFrac || 0, fh = 38 * fillFrac;
    ctx.fillStyle = 'rgba(124,224,160,' + (0.55 + pulse * 0.25) + ')';
    ctx.fillRect(205 + 58 - 2.5, 50 - 20 + 19 - fh, 5, fh);
    // mine sparks
    if (run.b.mine > 0 && Math.sin(t * 6.4) > 0.55) {
      ctx.fillStyle = '#b8ffd0';
      for (let i = 0; i < 3; i++) ctx.fillRect(-205 - 26 + i * 20 + Math.sin(t * 9 + i) * 3, 55 - 34 + Math.cos(t * 7 + i) * 4, 2, 2);
    }
    // repair pulse ring
    if (run.b.repair > 0) {
      const rr2 = 12 + ((t * 14) % 18);
      ctx.strokeStyle = 'rgba(124,224,160,' + Math.max(0, 0.6 - rr2 / 32) + ')'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(-130, 175 - 14, rr2, 0, 7); ctx.stroke();
    }
    ctx.restore();
  }
  // YOUR FLEET on patrol — pre-scaled sprite blits, targets scanned at 8Hz via beam cache
  const _patCv = {};
  function patrolSprite(k) {
    if (_patCv[k]) return _patCv[k];
    const im = _patrolImgs[k] || (function () { const i2 = new Image(); i2.src = 'ships/ship-' + k + '.png'; _patrolImgs[k] = i2; return i2; })();
    if (!(im.complete && im.naturalWidth)) return null;
    const cv = document.createElement('canvas'); cv.width = 32; cv.height = 24;
    const c2 = cv.getContext('2d'); c2.imageSmoothingQuality = 'high';
    c2.drawImage(im, 0, 0, 32, 24);
    _patCv[k] = cv; return cv;
  }
  const _patrolImgs = {};
  function drawPatrolFleet(ctx, t, f) {
    let keys = run._patKeys;
    if (!keys) {
      try { keys = ((G().fleetShips && G().fleetShips()) || []).map((x) => x.key); } catch (e) { keys = []; }
      if (!keys.length) keys = ['frigate', 'interceptor'];
      keys = run._patKeys = keys.slice(0, 4);
    }
    const n = keys.length;
    for (let i = 0; i < n; i++) {
      const a = t * 0.55 + i * Math.PI * 2 / n;
      const rx = f.size + 88, ry = (f.size + 88) * 0.66;
      const x = f.x + Math.cos(a) * rx, y = f.y + Math.sin(a) * ry;
      const hd = Math.atan2(Math.cos(a) * ry, -Math.sin(a) * rx);
      const spr = patrolSprite(keys[i]);
      ctx.save(); ctx.translate(x, y); ctx.rotate(hd + Math.PI / 2);
      if (spr) ctx.drawImage(spr, -16, -12);
      else { ctx.fillStyle = '#9fd6ff'; ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill(); }
      ctx.restore();
      // occasional snap-fire at the nearest cached beam target (no per-frame scans)
      const bt = run.beamTargets && run.beamTargets[0];
      if (bt && !(bt.dead || bt.dying || bt.hp <= 0) && Math.sin(t * 7 + i * 2.4) > 0.65 && Math.hypot(bt.x - x, bt.y - y) < 380) {
        ctx.strokeStyle = 'rgba(124,214,255,.7)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(bt.x, bt.y); ctx.stroke();
      }
    }
  }
  // CARGO DRONES — fly out from the Mining Array to ore nodes, mine, haul back
  // to the Deep Silo, deposit, repeat. Count scales with the Mining Array.
  function drawHomeDrones(ctx, t, f) {
    const n = Math.min(6, 2 + Math.floor((run.b.mine | 0) / 2));
    const mine = { x: f.x - 205, y: f.y + 55 }, silo = { x: f.x + 205, y: f.y + 50 };
    for (let i = 0; i < n; i++) {
      const node = { x: f.x + Math.cos(i * 2.39 + 1.1) * (240 + (i % 3) * 55), y: f.y + 190 + Math.sin(i * 1.7) * 70 };
      const cycle = 7.2, u = ((t * 0.9 + i * 1.83) % cycle);
      let x, y, working = false;
      const lerp = (a2, b2, k) => ({ x: a2.x + (b2.x - a2.x) * k, y: a2.y + (b2.y - a2.y) * k });
      if (u < 2.2) ({ x, y } = lerp(mine, node, u / 2.2));
      else if (u < 3.4) { ({ x, y } = node); working = true; }
      else if (u < 5.8) ({ x, y } = lerp(node, silo, (u - 3.4) / 2.4));
      else { ({ x, y } = silo); working = true; }
      y += Math.sin(t * 4 + i) * 3;
      ctx.save(); ctx.translate(x, y);
      ctx.fillStyle = '#c8ffb0';
      ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-4, -3.4); ctx.lineTo(-2, 0); ctx.lineTo(-4, 3.4); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.4; ctx.fillRect(-9, -0.8, 5, 1.6); ctx.globalAlpha = 1;
      if (working && Math.sin(t * 8 + i * 2) > 0.3) {
        ctx.strokeStyle = 'rgba(124,224,160,.8)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(0, 9); ctx.stroke();
        ctx.fillStyle = '#a5f2c4'; ctx.fillRect(-1.5, 9, 3, 3);
      }
      ctx.restore();
    }
  }
  // ---- in-battle HUD strip + big banner (arena overlays) --------------------
  function ensureWarbar() {
    removeWarbar();
    const host = $('top-stack'); if (!host) return;
    const w = document.createElement('div'); w.id = 'hc-warbar';
    w.innerHTML = '<span class="hcw-wave">W' + run.next + '</span>' +
      '<div class="hcw-mid"><div class="hcw-bar"><i id="hcw-fill" style="width:100%"></i></div><span class="hcw-lbl">CITADEL HULL</span></div>' +
      '<span class="hcw-left" id="hcw-left">—</span><button id="hcw-bail" title="Abandon defense">⏏</button>';
    host.appendChild(w);
    w.querySelector('#hcw-bail').addEventListener('click', () => endWave(false));
  }
  function removeWarbar() { const w = $('hc-warbar'); if (w) w.remove(); }
  function syncWarbar(alive) {
    if (!run) return;
    const f = run.fort;
    const fill = $('hcw-fill'); if (fill) { const p = Math.max(0, f.hp / f.max * 100); fill.style.width = p + '%'; fill.classList.toggle('low', p < 35); }
    const l = $('hcw-left'); if (l) l.textContent = '⚔ ' + alive + ' live · ' + (run.N - run.spawned) + ' inbound';
  }
  let _bb, _bbT;
  function bbanner(title, sub) {
    if (!_bb || !_bb.isConnected) {
      _bb = document.createElement('div'); _bb.id = 'hc-bbanner';
      ($('arena-wrap') || $('app') || document.body).appendChild(_bb);
    }
    _bb.innerHTML = '<div class="hcb-t">' + title + '</div><div class="hcb-s">' + sub + '</div>';
    _bb.classList.remove('show'); void _bb.offsetWidth; _bb.classList.add('show');
    clearTimeout(_bbT); _bbT = setTimeout(() => _bb.classList.remove('show'), 3600);
  }
  function onDeath() { endWave(false, true); }   // engine already towed us home (normal death penalties applied)
  // teardown WITHOUT breach damage — for external interruptions (zone kicked
  // out from under us, citadel tow, galaxy warp). Wave progress untouched.
  function abortRun(msg) {
    if (!run) return;
    const prevSpeed = run.prevSpeed;
    run = null;
    removeWarbar();
    try { const grt = G().rt; if (grt) grt.hcrun = null; } catch (e) {}
    try { if (prevSpeed && prevSpeed !== 1) G().setGameSpeed(prevSpeed); } catch (e) {}
    if (msg) toast('🏰 ' + msg);
    render(); updateHud();
  }
  // grant the rewards for clearing wave `next` — shared by solo + auto runs
  function grantWaveRewards(s, next) {
    s.wave = next;
    const st = G().state, r = rates(s), lines = [];
    const gold = Math.max(5000, Math.round(r.gold * 2.2));
    st.gold += gold; lines.push({ t: '$' + fmt(gold) + ' Gold', c: '#e6b566' });
    if (r.iron > 0) { const a = Math.round(r.iron * 1.5); st.resources.iron += a; lines.push({ t: '+' + fmt(a) + ' Ore', c: '#d0a060' }); }
    if (r.fuel > 0) { const a = Math.round(r.fuel * 1.5); st.resources.fuel += a; lines.push({ t: '+' + fmt(a) + ' Fuel', c: '#5bc0ff' }); }
    if (r.plasma > 0) { const a = Math.round(r.plasma * 1.5); st.resources.plasma += a; lines.push({ t: '+' + fmt(a) + ' Plasma', c: '#c07bff' }); }
    if (next % 10 === 0) {
      const keys = crateKeys(next), k = keys[(Math.random() * keys.length) | 0];
      if (!st.shipParts) st.shipParts = {};
      st.shipParts[k] = (st.shipParts[k] | 0) + 1;
      lines.push({ t: '⬡ Part Crate — 1× ' + shipName(k), c: band(next).c, big: 1 });
      if (next >= 50) { st.dreadCores = (st.dreadCores || 0) + 2; lines.push({ t: '◇ 2 Dread Cores', c: '#ff5a68' }); }
    }
    try { G().save(); } catch (e) {}
    return { lines, gold };
  }
  // AUTO-DEFENSE: roll straight into the next wave without leaving the arena
  function rollNext() {
    const s = hc(); if (!s || !run) return;
    const ps = fleetStats();
    const next = (s.wave | 0) + 1;
    const turretPct = (s.b.turret | 0) * 0.08;
    run.next = next;
    run.N = Math.min(40, 10 + Math.ceil(next * 1.6));
    run.spawned = 0; run.refs = []; run.spawnT = 1.8; run.spawnIv = Math.max(0.55, 42 / run.N);
    run.unitHp = ps.dps * (1 + turretPct) * (55 + next * 4.5) / run.N;
    run.dps = ps.dps; run.turretDps = ps.dps * turretPct;
    run.fort.max = ps.maxHp * 12 * (1 + (s.b.turret | 0) * 0.05);
    run.fort.hp = run.fort.max;                       // field crews repair between waves
    ensureWarbar();
    bbanner('WAVE ' + next + ' — INBOUND', band(next).name.toUpperCase() + ' raiders · auto-defense continues until you fall');
    updateHud();
  }
  function endWave(won, engineHandled) {
    if (!run) return;
    const s = hc();
    const next = run.next;
    // ---- AUTO-CHAIN: victory rolls straight into the next wave -------------
    if (won && run.auto && !engineHandled && s) {
      const got = grantWaveRewards(s, next);
      run.session.waves++; run.session.gold += got.gold; if (next % 10 === 0) run.session.crates++;
      bbanner('WAVE ' + next + ' DEFENDED', got.lines.slice(0, 3).map((x) => x.t).join(' · ') + ' · next wave inbound…');
      run.between = 2.2;
      syncWarbar(0); updateHud();
      return;
    }
    const prevSpeed = run.prevSpeed, session = run.auto ? run.session : null;
    run = null;
    removeWarbar();
    try { if (!engineHandled) G().endHomeDefense(); else { const grt = G().rt; if (grt) grt.hcrun = null; } } catch (e) {}
    try { if (prevSpeed && prevSpeed !== 1) G().setGameSpeed(prevSpeed); } catch (e) {}
    try { G().refreshStats(); } catch (e) {}   // drop the 2.5× defense fire range
    try { if (window.UI) window.UI.refreshAll(); } catch (e) {}
    if (!s) return;
    const recap = (session && session.waves > 0)
      ? '<div class="hcm-next">⚔ Auto-defense run: <b>' + session.waves + '</b> wave' + (session.waves > 1 ? 's' : '') + ' cleared · $' + fmt(session.gold) + (session.crates ? ' · ' + session.crates + ' crate' + (session.crates > 1 ? 's' : '') : '') + '</div>'
      : '';
    if (won) {
      const got = grantWaveRewards(s, next);
      sheet(
        '<div class="hcm-kicker">WAVE ' + next + ' DEFENDED</div>' +
        '<div class="hcm-title">EMPIRE UPGRADED</div>' +
        '<div class="hcm-sub">Production is now <b>' + fmt(rates(s).gold) + ' $/h</b>' + (rates(s).iron ? ' + resources' : '') + ' — permanently.</div>' +
        '<div class="hcm-drops">' + got.lines.map((l) => '<span style="color:' + l.c + (l.big ? ';font-size:14px' : '') + '">' + l.t + '</span>').join('') + '</div>' +
        (nextMilestone(s) ? '<div class="hcm-next">NEXT: ' + nextMilestone(s) + '</div>' : '') +
        '<button class="hcm-ok" id="hcm-ok">Collect & Continue</button>'
      );
    } else {
      s.dmg = Date.now() + repairLockMs(s);
      try { G().save(); } catch (e) {}
      sheet(
        '<div class="hcm-kicker" style="color:#ff8f9c">CITADEL BREACHED</div>' +
        '<div class="hcm-title">WAVE ' + next + ' FAILED</div>' +
        '<div class="hcm-sub">Structures damaged — <b>mining is offline</b> until repairs finish. Your empire keeps <b>Wave ' + s.wave + '</b> production; nothing earned was lost.</div>' +
        recap +
        '<div class="hcm-next">🔧 Auto-repair ' + Math.round(repairLockMs(s) / 60000) + 'm · or pay $' + fmt(repairCost(s)) + ' to fix instantly</div>' +
        '<button class="hcm-ok" id="hcm-ok">Understood</button>'
      );
    }
    const ok = _modal && _modal.querySelector('#hcm-ok');
    if (ok) ok.addEventListener('click', () => { closeModal(); render(); updateHud(); });
    setTimeout(() => { const nav = document.querySelector('.nav-btn[data-screen="homecit"]'); if (nav) nav.click(); else render(); }, 80);
    updateHud();
  }
  // ---- AUTO-DEFENSE confirm: death is REAL — same penalties as anywhere ----
  function openAutoConfirm() {
    const s = hc(); if (!s || run || damaged(s)) { if (s && damaged(s)) toast('Repair the citadel first'); return; }
    const m = sheet(
      '<div class="hcm-kicker" style="color:#ff8f9c">AUTO-DEFENSE</div>' +
      '<div class="hcm-title">CHAIN WAVES UNTIL YOU FALL</div>' +
      '<div class="hcm-rules">' +
      rule('⚔', 'Waves auto-continue', 'Each victory rolls straight into the next wave — no breaks, rewards granted instantly. The fort is repaired between waves.') +
      rule('☠', 'DEATH IS REAL', 'Dying out there carries the <b>normal death penalties</b>: you can <b>drop a piece of equipped gear</b> and your <b>hull upgrade level resets</b> — exactly like dying in the zone grind.') +
      rule('🏰', 'Fort loss = breach', 'If the citadel falls instead, it\u2019s a normal breach — mining offline until repairs, your wave progress stays.') +
      '</div>' +
      '<button class="hcm-ok" id="hca-go">⚔ I understand — engage</button>' +
      '<button class="hc-abandon" id="hca-x" style="width:100%;margin-top:8px">Cancel</button>'
    );
    m.querySelector('#hca-go').addEventListener('click', () => { closeModal(); startWave(true); });
    m.querySelector('#hca-x').addEventListener('click', closeModal);
  }
  function nextMilestone(s) {
    for (const [w, txt] of MILES) if (w > s.wave) return 'Wave ' + w + ' — ' + txt;
    return '';
  }

  // ---- modal ------------------------------------------------------------
  let _modal;
  function closeModal() { if (_modal) { _modal.remove(); _modal = null; } }
  function sheet(html) {
    closeModal();
    _modal = document.createElement('div'); _modal.className = 'hc-modal';
    _modal.innerHTML = '<div class="hc-modal-back"></div><div class="hc-modal-card">' + html + '</div>';
    ($('app') || document.body).appendChild(_modal);
    _modal.querySelector('.hc-modal-back').addEventListener('click', closeModal);
    return _modal;
  }
  function openHowTo() {
    const m = sheet(
      '<div class="hcm-kicker">HOME CITADEL</div>' +
      '<div class="hcm-title">YOUR INDUSTRIAL EMPIRE</div>' +
      '<div class="hcm-rules">' +
      rule('⛏', 'It mines while you play', 'Gold, ore, fuel, plasma — even ◈ prism at high waves. Storage caps at ' + capHours(hc() || { b: { silo: 0 } }) + 'h; return and COLLECT.') +
      rule('⚔', 'Waves make it richer, forever', 'Each defended wave permanently raises production and unlocks better tables. Wave strength scales with YOUR fleet.') +
      rule('⚔', 'Real battles, in your zone', 'Waves deploy you into the live arena. Raiders besiege the FORT — your fleet, guns and Defense Grid turrets must cut them down first.') +
      rule('🔧', 'Failing costs time, not progress', 'A breach knocks mining offline until repairs — your wave and everything earned stay yours.') +
      rule('⬡', 'Every 10th wave: a part crate', 'Real Shipworks parts — Rare → Epic → Legendary → Dread-class as you climb. ◇ Cores from Wave 50.') +
      '</div><button class="hcm-ok" id="hcm-ok">⛏ Build my empire</button>'
    );
    m.querySelector('#hcm-ok').addEventListener('click', closeModal);
  }
  function rule(ic, t, p) { return '<div class="hcm-rule"><span>' + ic + '</span><div><b>' + t + '</b><p>' + p + '</p></div></div>'; }

  // =========================================================================
  // RENDER
  // =========================================================================
  function render() {
    const body = $('homecit-body'); if (!body) return;
    const sub = $('homecit-sub');
    const s = hc(); if (!s) return;
    if (sub) sub.textContent = lvl() >= UNLOCK ? (s.wave ? 'Wave ' + s.wave + ' · ' + band(s.wave).name + ' era' : 'Defend Wave 1 to begin') : ('Unlocks at Lv ' + UNLOCK);
    if (lvl() < UNLOCK) {
      body.innerHTML = '<div class="hc-lock"><div class="hc-lock-ic">🏰</div><h3>Home Citadel</h3>' +
        '<p>An empire that pays you while you play everything else. Defend waves to permanently raise its output.</p>' +
        '<div class="hc-lock-lv">Unlocks at Level <b>' + UNLOCK + '</b> · you are Level <b>' + lvl() + '</b></div></div>';
      return;
    }
    if (!s.seen) { s.seen = 1; try { G().save(); } catch (e) {} setTimeout(openHowTo, 350); }
    body.innerHTML = run ? runView() : baseView(s);
    wire(body);
  }
  function baseView(s) {
    const a = accrued(s), r = rates(s), capH = capHours(s);
    const dmg = damaged(s);
    const bd = band(Math.max(1, s.wave));
    const fullPct = Math.min(100, a.h / capH * 100);
    let bldHtml = '';
    for (const key in BLD) {
      const b = BLD[key], cur = s.b[key] | 0, mx = bldMax(s, key), maxed = cur >= mx;
      const c = maxed ? null : bldCost(key, cur);
      bldHtml += '<div class="hc-bld" title="' + b.name + ' — ' + b.eff(cur) + (maxed ? ' · MAX (raise the cap with Citadel Level)' : ' · next level: ' + b.next(cur) + ' · cost ' + costTxt(c)) + '"><div class="hc-bld-h"><span class="hc-bld-ic">' + b.ic + '</span><b>' + b.name + '</b><em>Lv ' + cur + '<i>/' + mx + '</i></em></div>' +
        '<div class="hc-bld-eff">' + b.eff(cur) + (maxed ? ' · MAX' : '') + '</div>' +
        (maxed ? '' : '<button class="hc-bld-buy" data-bld="' + key + '"' + (canAfford(c) ? '' : ' disabled') + '>▲ ' + costTxt(c) + '</button>') +
        '</div>';
    }
    return '' +
      '<div class="hc-head" style="--bc:' + bd.c + '">' +
        '<div class="hc-head-l"><div class="hc-wave">WAVE ' + (s.wave || '—') + '</div><div class="hc-era">' + (s.wave ? bd.name + ' era' : 'UNPROVEN') + '</div></div>' +
        '<div class="hc-head-r"><div class="hc-rate-big">' + (s.wave ? fmt(r.gold) + ' <i>$/h</i>' : 'NO INCOME') + '</div>' +
        '<div class="hc-rate-sub">' + (s.wave ? [r.iron && '+' + fmt(r.iron) + ' ◆', r.fuel && '+' + fmt(r.fuel) + ' ⬢', r.plasma && '+' + fmt(r.plasma) + ' ✦', r.prism >= 0.5 && '+' + fmt(r.prism) + ' ◈'].filter(Boolean).join(' · ') || 'resources unlock at Wave 5' : 'clear Wave 1 to switch the mines on') + '</div></div>' +
      '</div>' +
      (dmg
        ? '<div class="hc-dmg"><b>⚠ STRUCTURES DAMAGED — MINING OFFLINE</b><span>Auto-repair in <b data-hc-rep>' + repLeft(s) + '</b></span>' +
          '<button class="hc-repair" id="hc-repair">🔧 Repair now · $' + fmt(repairCost(s)) + '</button></div>'
        : '<div class="hc-collect' + (fullPct >= 100 ? ' full' : '') + '" id="hc-collect" title="Your empire produces while you play anything else — up to ' + capH + 'h of storage (Deep Silo extends it). Tap to collect.">' +
          '<div class="hc-c-l"><div class="hc-c-t">' + (fullPct >= 100 ? '⚠ STORAGE FULL — COLLECT' : 'STORED PRODUCTION') + '</div>' +
          '<div class="hc-c-v">' + (s.wave ? '$' + fmt(a.out.gold) + (a.out.iron >= 1 ? ' · ◆' + fmt(a.out.iron) + ' · ⬢' + fmt(a.out.fuel) : '') + (a.out.plasma >= 1 ? ' · ✦' + fmt(a.out.plasma) : '') + (a.out.prism >= 1 ? ' · ◈' + fmt(a.out.prism) : '') : 'Mines offline — defend Wave 1') + '</div>' +
          '<div class="hc-c-bar"><i style="width:' + fullPct + '%"></i><span>' + a.h.toFixed(1) + 'h / ' + capH + 'h</span></div></div>' +
          '<button class="hc-c-btn"' + (a.tot >= 1 ? '' : ' disabled') + '>COLLECT</button></div>') +
      '<button class="hc-fight" id="hc-fight" title="Deploys your fleet into the Home Zone arena. Raider strength scales to YOUR fleet — every wave defended permanently raises production."' + (dmg ? ' disabled' : '') + '>⚔ DEFEND WAVE ' + ((s.wave | 0) + 1) +
        '<span>' + band((s.wave | 0) + 1).name + ' raiders · live arena battle · win = permanent production boost</span></button>' +
      '<button class="hc-fight auto" id="hc-auto" title="Chains waves back-to-back until you fall. The fort repairs between waves — but dying carries NORMAL death penalties (gear drop, hull reset)."' + (dmg ? ' disabled' : '') + '>⚔∞ AUTO-DEFENSE<span>chain waves till you fall · normal death penalties apply</span></button>' +
      '<div class="hc-cit-card" title="Citadel Level ' + (s.cit | 0) + ' — each ASCEND permanently adds +10 max levels to EVERY structure. Cost anchors to your hourly production and TRIPLES per level."><div class="hc-cit-l"><b>🏰 CITADEL LEVEL ' + (s.cit | 0) + '</b><span>Each level unlocks <b>+10 levels on every structure</b> — scale without limit.</span><span class="hc-cit-cost">' + costTxt(citCost(s)) + '</span></div>' +
        '<button class="hc-cit-up" id="hc-citup"' + (canAfford(citCost(s)) ? '' : ' disabled') + '>⬆ ASCEND</button></div>' +
      '<div class="hc-blds">' + bldHtml + '</div>' +
      '<div class="hc-miles"><div class="hc-miles-h">WAVE MILESTONES</div>' +
        MILES.map(([w, txt]) => '<div class="hc-mile' + (s.wave >= w ? ' done' : '') + '"><b>W' + w + '</b><span>' + txt + '</span>' + (s.wave >= w ? '<i>✓</i>' : '') + '</div>').join('') +
      '</div>' +
      '<button class="hc-how" id="hc-how">❔ How it works</button>';
  }
  function runView() {
    return '<div class="hc-live"><div class="hc-live-t">⚔ WAVE ' + run.next + ' — DEFENSE IN PROGRESS</div>' +
      '<div class="hc-live-s">Your citadel is under siege in the battle arena. Intercept the raiders before they burn it down — the fort takes the damage, not your fleet.</div>' +
      '<button class="hc-fight" id="hc-return">⚔ RETURN TO THE FIGHT</button>' +
      '<button class="hc-abandon" id="hc-abandon">⏏ Abandon defense</button></div>';
  }
  function costTxt(c) {
    const bits = [];
    if (c.gold) bits.push('$' + fmt(c.gold));
    if (c.iron) bits.push('◆' + fmt(c.iron));
    if (c.fuel) bits.push('⬢' + fmt(c.fuel));
    if (c.plasma) bits.push('✦' + fmt(c.plasma));
    return bits.join(' ');
  }
  function repLeft(s) {
    const ms = Math.max(0, s.dmg - Date.now());
    const m = Math.floor(ms / 60000), sec = Math.floor(ms % 60000 / 1000);
    return m + 'm ' + sec + 's';
  }
  function fitCanvas() {
    const cv = $('hc-cv'); if (!cv) return;
    const r = cv.parentElement.getBoundingClientRect();
    cv.width = Math.max(300, r.width); cv.height = Math.max(200, r.height);
  }
  function wire(body) {
    const on = (id, fn) => { const e = body.querySelector('#' + id); if (e) e.addEventListener('click', fn); };
    on('hc-fight', () => startWave(false));
    on('hc-auto', openAutoConfirm);
    on('hc-citup', buyCit);
    on('hc-how', openHowTo);
    on('hc-repair', repairNow);
    on('hc-abandon', () => endWave(false));
    on('hc-return', () => { const nav = document.querySelector('.nav-btn[data-screen="battle"]'); if (nav) nav.click(); });
    const col = body.querySelector('#hc-collect'); if (col) col.addEventListener('click', collect);
    body.querySelectorAll('[data-bld]').forEach((b) => b.addEventListener('click', (ev) => { ev.stopPropagation(); buyBld(b.dataset.bld); }));
  }

  // ---- HUD badge + countdown tick -------------------------------------------
  function updateHud() {
    const g = G(); if (!g || !g.state) return;
    const s = hc(); if (!s) return;
    if (run) {   // WATCHDOG — leaving the arena mid-wave (dock, warp, tow) = ABANDONING the defense: normal breach
      let live = false; try { live = !!(g.rt && g.rt.hcrun) && (g.state.currentDungeon | 0) === run.zone; } catch (e) {}
      if (!live) { endWave(false, true); return; }
    }
    const b = $('cmd-homecit-badge');
    if (b) {
      if (lvl() < UNLOCK) { b.style.display = 'none'; }
      else if (damaged(s)) { b.style.display = 'flex'; b.textContent = '⚠'; }
      else if (s.wave >= 1 && accrued(s).h >= capHours(s) - 0.01) { b.style.display = 'flex'; b.textContent = '⛏'; }
      else b.style.display = 'none';
    }
    const scr = $('screen-homecit');
    if (scr && scr.classList.contains('active') && !run) {
      const rep = document.querySelector('[data-hc-rep]');
      if (rep) { rep.textContent = repLeft(s); if (!damaged(s)) render(); }
      const bar = document.querySelector('.hc-c-bar i');
      if (bar) bar.style.width = Math.min(100, accrued(s).h / capHours(s) * 100) + '%';
    }
  }

  function boot() {
    injectCSS();
    setInterval(() => { try { updateHud(); } catch (e) {} }, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  setTimeout(boot, 1200);
  window.HOMECIT = { render, updateHud, openHowTo, engineTick, engineRender, onDeath };

  function injectCSS() {
    if ($('homecit-css')) return;
    const el = document.createElement('style'); el.id = 'homecit-css'; el.textContent = CSS; document.head.appendChild(el);
  }
  const CSS = `
  #homecit-body{ padding:12px 12px calc(130px + env(safe-area-inset-bottom,0px)); display:flex; flex-direction:column; gap:10px; max-width:820px; width:100%; margin:0 auto; }
  .hc-head{ display:flex; align-items:center; gap:12px; background:linear-gradient(115deg,#241a0c,#171008 60%,#12141f); border:1px solid rgba(255,184,77,.4); border-radius:14px; padding:12px 14px; }
  .hc-head-l{ flex:none; }
  .hc-wave{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:20px; color:#ffe1a6; text-shadow:0 0 14px rgba(255,184,77,.6); }
  .hc-era{ font-family:'Rajdhani',sans-serif; font-weight:800; font-size:11px; letter-spacing:.1em; color:var(--bc,#9fb0c4); }
  .hc-head-r{ margin-left:auto; text-align:right; min-width:0; }
  .hc-rate-big{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:17px; color:#f2d9ac; }
  .hc-rate-big i{ font-style:normal; font-size:11px; color:#a08e6e; }
  .hc-rate-sub{ font-family:'Rajdhani',sans-serif; font-weight:700; font-size:12px; color:#b8a887; margin-top:2px; }
  .hc-collect{ display:flex; align-items:center; gap:11px; background:linear-gradient(180deg,#161d14,#101710); border:1px solid rgba(124,224,160,.35); border-radius:13px; padding:11px 12px; cursor:pointer; }
  .hc-collect.full{ border-color:#ffcf7a; box-shadow:0 0 18px -6px rgba(255,207,122,.6); animation:hcFullPulse 1.6s ease-in-out infinite; }
  @keyframes hcFullPulse{ 0%,100%{ box-shadow:0 0 12px -6px rgba(255,207,122,.4);} 50%{ box-shadow:0 0 22px -4px rgba(255,207,122,.8);} }
  .hc-c-l{ flex:1; min-width:0; }
  .hc-c-t{ font-family:'Rajdhani',sans-serif; font-weight:800; font-size:10.5px; letter-spacing:.1em; color:#8fb89c; }
  .hc-collect.full .hc-c-t{ color:#ffcf7a; }
  .hc-c-v{ font-family:'Rajdhani',sans-serif; font-weight:800; font-size:14.5px; color:#d9f2e2; margin:3px 0 6px; }
  .hc-c-bar{ position:relative; height:12px; border-radius:7px; background:#0c120d; border:1px solid #23402c; overflow:hidden; }
  .hc-c-bar i{ display:block; height:100%; background:linear-gradient(90deg,#2f7d4f,#7ce0a0); transition:width 1s linear; }
  .hc-c-bar span{ position:absolute; inset:0; display:grid; place-items:center; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:9.5px; color:#eafff2; text-shadow:0 1px 3px #000; }
  .hc-c-btn{ flex:none; border:none; border-radius:11px; padding:12px 15px; font-family:'Orbitron',sans-serif; font-weight:800; font-size:12px; color:#04240f; background:linear-gradient(180deg,#8ce7ab,#3da368); cursor:pointer; }
  .hc-c-btn:disabled{ background:#1c2a20; color:#597a64; }
  .hc-dmg{ display:flex; flex-direction:column; gap:7px; background:rgba(255,73,95,.08); border:1px solid rgba(255,73,95,.4); border-radius:13px; padding:12px; text-align:center; }
  .hc-dmg b{ font-family:'Orbitron',sans-serif; font-size:11.5px; letter-spacing:.06em; color:#ff8f9c; }
  .hc-dmg span{ font-family:'Rajdhani',sans-serif; font-weight:700; font-size:12.5px; color:#e2b8bd; }
  .hc-dmg span b{ color:#ffd24d; font-family:'Rajdhani',sans-serif; font-size:12.5px; }
  .hc-repair{ border:none; border-radius:10px; padding:11px; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:13px; color:#2a1206; background:linear-gradient(180deg,#ffd24d,#e8960f); cursor:pointer; }
  .hc-fight{ width:100%; border:none; border-radius:14px; padding:14px; cursor:pointer; font-family:'Orbitron',sans-serif; font-weight:800; font-size:16px; letter-spacing:.06em; color:#2a1206;
    background:linear-gradient(180deg,#ffcf7a,#e8960f); box-shadow:0 10px 26px -8px rgba(255,184,77,.7), 0 0 0 1px rgba(255,255,255,.18) inset; display:flex; flex-direction:column; align-items:center; gap:3px; }
  .hc-fight span{ font-family:'Rajdhani',sans-serif; font-weight:700; font-size:11.5px; text-transform:none; color:#5a3410; }
  .hc-fight:active{ transform:scale(.98); }
  .hc-fight:disabled{ background:#241d12; color:#7a6a4e; box-shadow:none; }
  .hc-fight.auto{ background:linear-gradient(180deg,#ff9a5a,#c2410c); padding:11px; font-size:13px; box-shadow:0 8px 20px -8px rgba(255,120,60,.6), 0 0 0 1px rgba(255,255,255,.14) inset; }
  .hc-fight.auto span{ color:#ffd9c2; }
  .hc-cit-card{ display:flex; align-items:center; gap:10px; background:linear-gradient(115deg,#2a1e0a,#171008 70%); border:1.5px solid rgba(255,209,140,.55); border-radius:13px; padding:11px 12px; box-shadow:0 0 18px -8px rgba(255,184,77,.7); }
  .hc-cit-l{ flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
  .hc-cit-l b{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:12.5px; color:#ffe1a6; letter-spacing:.06em; }
  .hc-cit-l span{ font-family:'Rajdhani',sans-serif; font-weight:600; font-size:12px; color:#c9b898; line-height:1.35; }
  .hc-cit-l span b{ font-size:12px; color:#ffd9a0; }
  .hc-cit-cost{ font-weight:800 !important; color:#ffd24d !important; }
  .hc-cit-up{ flex:none; border:none; border-radius:11px; padding:12px 14px; font-family:'Orbitron',sans-serif; font-weight:800; font-size:12px; color:#2a1206; background:linear-gradient(180deg,#ffe1a6,#e8960f); cursor:pointer; box-shadow:0 6px 16px -6px rgba(255,184,77,.8); }
  .hc-cit-up:disabled{ background:#241d12; color:#7a6a4e; box-shadow:none; }
  .hc-cit-up:active:not(:disabled){ transform:scale(.96); }
  .hc-bld-h em i{ font-style:normal; font-size:8.5px; color:#8a7a5c; }
  .hc-blds{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .hc-bld{ background:linear-gradient(180deg,#171307,#100d08); border:1px solid #33280f; border-radius:12px; padding:10px 11px; display:flex; flex-direction:column; gap:6px; }
  .hc-bld-h{ display:flex; align-items:center; gap:7px; }
  .hc-bld-ic{ font-size:15px; }
  .hc-bld-h b{ font-family:'Rajdhani',sans-serif; font-weight:800; font-size:13px; color:#f2d9ac; flex:1; min-width:0; }
  .hc-bld-h em{ font-style:normal; font-family:'Orbitron',sans-serif; font-weight:700; font-size:9.5px; color:#ffb84d; }
  .hc-bld-eff{ font-family:'Rajdhani',sans-serif; font-weight:700; font-size:12px; color:#a89468; }
  .hc-bld-buy{ border:1px solid #4d3c14; border-radius:9px; background:#1d1608; color:#ffd9a0; padding:8px; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:11.5px; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .hc-bld-buy:disabled{ opacity:.45; }
  .hc-bld-buy:active:not(:disabled){ transform:scale(.96); }
  .hc-miles{ background:#12101d00; border:1px solid #2c2314; border-radius:12px; padding:10px 12px; background:linear-gradient(180deg,#14100a,#0e0b07); }
  .hc-miles-h{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:9.5px; letter-spacing:.14em; color:#b89d6e; margin-bottom:7px; }
  .hc-mile{ display:flex; gap:9px; align-items:baseline; padding:4px 0; border-top:1px solid #1e1810; font-family:'Rajdhani',sans-serif; }
  .hc-mile:first-of-type{ border-top:none; }
  .hc-mile b{ flex:none; width:42px; font-size:12px; color:#ffb84d; }
  .hc-mile span{ flex:1; font-weight:700; font-size:12.5px; color:#c9b898; }
  .hc-mile i{ font-style:normal; color:#7ce0a0; font-weight:800; }
  .hc-mile.done b, .hc-mile.done span{ color:#7a6a4e; text-decoration:line-through; text-decoration-color:#7ce0a066; }
  .hc-how{ border:1px dashed #4d3c14; border-radius:11px; background:none; color:#b89d6e; padding:10px; font-family:'Rajdhani',sans-serif; font-weight:700; font-size:12.5px; cursor:pointer; }
  /* fight */
  .hc-fhud{ display:flex; align-items:center; gap:10px; font-family:'Orbitron',sans-serif; font-weight:800; }
  .hc-f-wave{ font-size:15px; color:#ffe1a6; }
  .hc-f-left{ font-size:13px; color:#ff9aa6; }
  .hc-burst{ margin-left:auto; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:11px; color:#ffd24d; transition:opacity .2s; }
  .hc-citbar{ position:relative; height:18px; border-radius:9px; background:#241733; background:#221407; border:1px solid #4d3c14; overflow:hidden; }
  .hc-cit-fill{ height:100%; background:linear-gradient(90deg,#ffb84d,#ffe1a6); transition:width .15s linear; }
  .hc-cit-fill.low{ background:linear-gradient(90deg,#ff495f,#ff8a3c); animation:hcHpLow .7s ease-in-out infinite; }
  @keyframes hcHpLow{ 0%,100%{ filter:brightness(1);} 50%{ filter:brightness(1.5);} }
  .hc-citbar span{ position:absolute; inset:0; display:grid; place-items:center; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:9.5px; letter-spacing:.1em; color:#2a1206; }
  .hc-arena{ position:relative; height:290px; border:1px solid #4d3c14; border-radius:14px; overflow:hidden; background:radial-gradient(130% 120% at 12% 50%, #241a0c 0%, #0e0b07 60%, #090705 100%); }
  .hc-arena canvas{ position:absolute; inset:0; width:100%; height:100%; touch-action:none; }
  .hc-abandon{ border:1px solid #4d3c14; background:none; color:#b89d6e; border-radius:10px; padding:9px; font-family:'Rajdhani',sans-serif; font-weight:700; font-size:12px; cursor:pointer; }
  /* lock */
  .hc-lock{ background:linear-gradient(180deg,#171307,#100d08); border:1px solid #33280f; border-radius:16px; padding:22px 16px; text-align:center; margin:12px; }
  .hc-lock-ic{ font-size:36px; filter:drop-shadow(0 0 14px ${ACCENT}); }
  .hc-lock h3{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:17px; color:#ffe1a6; margin:10px 0 6px; }
  .hc-lock p{ font-family:'Rajdhani',sans-serif; font-weight:600; font-size:13px; color:#c9b898; line-height:1.5; margin:0 0 12px; }
  .hc-lock-lv{ font-family:'Rajdhani',sans-serif; font-size:12.5px; font-weight:700; color:#f2d9ac; background:#1d1608; border:1px solid #4d3c14; border-radius:10px; padding:8px 12px; display:inline-block; }
  .hc-lock-lv b{ color:#ffd24d; }
  /* modal */
  .hc-modal{ position:absolute; inset:0; z-index:62; display:grid; place-items:center; padding:18px; }
  .hc-modal-back{ position:absolute; inset:0; background:rgba(8,6,3,.78); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); }
  .hc-modal-card{ position:relative; max-width:340px; width:100%; max-height:calc(100% - 30px); overflow-y:auto; background:linear-gradient(180deg,#241a0c,#14100a);
    border:1px solid #6b5320; border-radius:18px; padding:20px 18px; box-shadow:0 24px 60px rgba(0,0,0,.65), 0 0 44px -14px ${ACCENT}; animation:hcmUp .3s cubic-bezier(.22,1,.36,1); }
  @keyframes hcmUp{ from{ transform:translateY(18px); opacity:0; } to{ transform:none; opacity:1; } }
  .hcm-kicker{ font-family:'Rajdhani',sans-serif; font-weight:800; font-size:10px; letter-spacing:.16em; color:${ACCENT}; text-align:center; }
  .hcm-title{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:19px; letter-spacing:.05em; color:#fff; text-align:center; margin:5px 0 4px; text-shadow:0 0 18px ${ACCENT}; }
  .hcm-sub{ font-family:'Rajdhani',sans-serif; font-weight:700; font-size:13px; color:#c9b898; text-align:center; line-height:1.5; margin-bottom:8px; }
  .hcm-sub b{ color:#ffe1a6; }
  .hcm-drops{ display:flex; flex-wrap:wrap; gap:5px 12px; justify-content:center; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:12.5px; background:#14100a; border:1px solid #33280f; border-radius:10px; padding:10px; margin:6px 0; }
  .hcm-next{ font-family:'Rajdhani',sans-serif; font-weight:800; font-size:12px; color:#ffd24d; text-align:center; margin-top:8px; }
  .hcm-rules{ display:flex; flex-direction:column; gap:10px; margin-top:10px; }
  .hcm-rule{ display:flex; gap:10px; align-items:flex-start; }
  .hcm-rule > span{ flex:none; width:26px; height:26px; display:grid; place-items:center; border-radius:8px; background:#1d1608; border:1px solid #4d3c14; font-size:13px; }
  .hcm-rule b{ font-family:'Rajdhani',sans-serif; font-weight:800; font-size:13px; color:#ffe1a6; display:block; }
  .hcm-rule p{ font-family:'Rajdhani',sans-serif; font-weight:600; font-size:12.5px; color:#b8a887; line-height:1.45; margin:2px 0 0; }
  .hcm-ok{ width:100%; margin-top:14px; background:linear-gradient(180deg,#ffcf7a,#e8960f); color:#2a1206; border:none; border-radius:12px; padding:12px;
    font-family:'Rajdhani',sans-serif; font-weight:800; font-size:14px; cursor:pointer; box-shadow:0 8px 22px -8px ${ACCENT}; }
  .hcm-ok:active{ transform:scale(.97); }
  /* arena warbar + banner */
  #hc-warbar{ display:flex; align-items:center; gap:9px; background:linear-gradient(180deg,rgba(36,26,12,.94),rgba(20,16,10,.94)); border:1px solid #6b5320; border-radius:11px; padding:7px 10px; margin-top:6px; pointer-events:auto; }
  .hcw-wave{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:13px; color:#ffe1a6; text-shadow:0 0 10px #ffb84d; }
  .hcw-mid{ flex:1; min-width:0; }
  .hcw-bar{ height:10px; border-radius:6px; background:#221407; border:1px solid #4d3c14; overflow:hidden; }
  .hcw-bar i{ display:block; height:100%; background:linear-gradient(90deg,#ffb84d,#ffe1a6); transition:width .15s linear; }
  .hcw-bar i.low{ background:linear-gradient(90deg,#ff495f,#ff8a3c); animation:hcHpLow .7s ease-in-out infinite; }
  .hcw-lbl{ display:block; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:8.5px; letter-spacing:.14em; color:#b89d6e; margin-top:2px; }
  .hcw-left{ font-family:'Rajdhani',sans-serif; font-weight:800; font-size:12px; color:#ffd9a0; white-space:nowrap; }
  #hcw-bail{ border:1px solid #4d3c14; background:none; color:#b89d6e; border-radius:8px; padding:4px 8px; font-size:12px; cursor:pointer; }
  #hc-bbanner{ position:absolute; left:0; right:0; top:16%; z-index:40; text-align:center; pointer-events:none; opacity:0; }
  #hc-bbanner.show{ animation:hcBb 3.6s ease forwards; }
  @keyframes hcBb{ 0%{ opacity:0; transform:translateY(-8px); } 8%{ opacity:1; transform:none; } 82%{ opacity:1; } 100%{ opacity:0; } }
  .hcb-t{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:19px; letter-spacing:.1em; color:#ffe1a6; text-shadow:0 0 18px #ffb84d, 0 2px 8px #000; }
  .hcb-s{ font-family:'Rajdhani',sans-serif; font-weight:700; font-size:12.5px; color:#f2d9ac; margin-top:4px; padding:0 22px; text-shadow:0 1px 6px #000; }
  /* defense-in-progress view */
  .hc-live{ background:linear-gradient(180deg,#241a0c,#14100a); border:1px solid #6b5320; border-radius:16px; padding:18px 14px; text-align:center; display:flex; flex-direction:column; gap:10px; }
  .hc-live-t{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:15px; color:#ffe1a6; text-shadow:0 0 14px #ffb84d; }
  .hc-live-s{ font-family:'Rajdhani',sans-serif; font-weight:600; font-size:13px; color:#c9b898; line-height:1.5; }
  /* command card */
  .mega-grid .mega-card.cmd-homecit{ background:linear-gradient(180deg,#241a0c,#14100a); }
  .mega-grid .mega-card.cmd-homecit .mc-ic{ color:#ffe1a6; border-color:rgba(255,184,77,.5); background:radial-gradient(120% 120% at 50% 0%,#33250e,#14100a); box-shadow:0 0 14px -3px rgba(255,184,77,.6); }
  .mega-grid .mega-card.cmd-homecit .mc-n{ color:#ffe9c4; }
  .mega-grid .mega-card.cmd-homecit::before{ background:linear-gradient(130deg,#ffb84d,#e8960f,#ffe1a6,#ffb84d); background-size:250% 250%; }
  #cmd-homecit-badge{ position:absolute; top:6px; right:8px; min-width:16px; height:16px; padding:0 4px; border-radius:8px; background:${ACCENT}; color:#2a1206;
    font-family:'Rajdhani',sans-serif; font-weight:800; font-size:10px; line-height:16px; text-align:center; box-shadow:0 0 8px ${ACCENT}; z-index:2; }
  `;
})();
