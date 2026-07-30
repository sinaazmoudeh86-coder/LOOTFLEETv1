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
    if (!st.homecit) st.homecit = { v: 1, wave: 0, cit: 0, last: Date.now(), b: { mine: 0, silo: 0, turret: 0, repair: 0 }, dmg: 0, seen: 0, tw: [] };
    if (!Array.isArray(st.homecit.tw)) st.homecit.tw = [];
    while (st.homecit.tw.length < 8) st.homecit.tw.push(null);
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

  // ---- DEFENSE TOWERS — bought & upgraded INSIDE the defense ---------------
  // 8 hex pads ring the citadel. Costs anchor to CURRENT hourly production
  // (progression-true, deliberately expensive); each standing tower makes the
  // next one pricier. Damage scales off YOUR fleet DPS so value tracks cost.
  const PADS = [[-70, -218], [92, -200], [-248, -62], [268, -44], [-300, 122], [305, 118], [-52, 262], [186, 232]];
  const TOWERS = {
    laser:   { ic: '⚡', name: 'Pulse Laser',      col: '#7ce0ff', hrs: 1.5, mix: { plasma: 30 },                     range: 540, desc: 'Sustained single-target beam. Instant retarget, never misses.', dmgTxt: (l) => Math.round(12 * l) + '% fleet DPS, sustained beam' },
    cryo:    { ic: '❄', name: 'Cryo Spire',       col: '#9fd6ff', hrs: 3.2, mix: { fuel: 22 },                       range: 300, unlockW: 5,  desc: 'Chill field — every raider inside crawls at 42% speed and fires slower.', dmgTxt: (l) => 'chills ALL raiders in field · +' + Math.round(3 * l) + '% fleet DPS' },
    missile: { ic: '☄', name: 'Missile Battery',  col: '#ffb84d', hrs: 6.5, mix: { iron: 18, plasma: 30 },           range: 660, unlockW: 12, desc: 'Slow heavy salvos with wide splash. Shreds clustered raids.', dmgTxt: (l) => Math.round(55 * l) + '% fleet DPS per salvo, AoE splash' },
    rail:    { ic: '✦', name: 'Annihilator Rail', col: '#ff5a68', hrs: 16,  mix: { iron: 14, fuel: 14, plasma: 20 }, range: 980, unlockW: 25, desc: 'Orbital-grade railgun. One shot pierces the entire raid line.', dmgTxt: (l) => Math.round(160 * l) + '% fleet DPS per shot, pierces' },
  };
  function twHourly() { const s = hc(); return Math.max(60000, rates({ ...s, wave: Math.max(1, s.wave) }).gold); }
  function twMaxLv(s) { return 10 + (s.cit | 0) * 10; }
  function twBuildCost(k) {
    const s = hc(), t = TOWERS[k];
    const owned = s.tw.filter(Boolean).length;
    const gold = Math.round(twHourly() * t.hrs * (1 + owned * 0.45));
    const o = { gold };
    for (const r in t.mix) o[r] = Math.round(gold / t.mix[r]);
    return o;
  }
  function twUpCost(k, lv) {
    // FIXED upgrade price: every level costs the same (anchored to hourly
    // production at purchase time) — no per-level exponent.
    const t = TOWERS[k];
    const gold = Math.round(twHourly() * t.hrs * 0.65);
    const o = { gold };
    for (const r in t.mix) o[r] = Math.round(gold / t.mix[r]);
    return o;
  }
  function buyTower(slot, k) {
    const s = hc(); if (!s || slot < 0 || s.tw[slot]) return false;
    const t = TOWERS[k]; if (!t) return false;
    if (t.unlockW && s.wave < t.unlockW) { toast(t.name + ' unlocks at Wave ' + t.unlockW); return false; }
    const c = twBuildCost(k);
    if (!canAfford(c)) { toast('Need ' + costTxt(c) + ' for the ' + t.name); return false; }
    pay(c); s.tw[slot] = { k, lv: 1, sp: { ...c } };
    try { G().save(); } catch (e) {}
    toast(t.ic + ' ' + t.name + ' online — pad ' + (slot + 1));
    syncTowers(); render(); if (window.UI) window.UI.refreshAll();
    return true;
  }
  function upTower(slot) {
    const s = hc(); const tw = s && s.tw[slot]; if (!tw) return;
    if (tw.lv >= twMaxLv(s)) { toast('Max level — a Citadel ascension raises the cap'); return; }
    const c = twUpCost(tw.k, tw.lv);
    if (!canAfford(c)) { toast('Need ' + costTxt(c) + ' to upgrade'); return; }
    pay(c); tw.lv++;
    tw.sp = tw.sp || {}; for (const r in c) tw.sp[r] = (tw.sp[r] || 0) + c[r];
    try { G().save(); } catch (e) {}
    toast(TOWERS[tw.k].ic + ' ' + TOWERS[tw.k].name + ' → Lv ' + tw.lv);
    syncTowers(); render(); if (window.UI) window.UI.refreshAll();
  }
  // total invested in a tower — recorded spend, or reconstructed at current
  // rates for towers built before spend tracking existed
  function twSpent(tw) {
    if (tw.sp && tw.sp.gold) return tw.sp;
    const o = { ...twBuildCost(tw.k) };
    for (let l = 1; l < tw.lv; l++) { const c = twUpCost(tw.k, l); for (const r in c) o[r] = (o[r] || 0) + c[r]; }
    return o;
  }
  function refund(c, frac) {
    const st = G().state, o = {};
    for (const r in c) { o[r] = Math.floor((c[r] || 0) * frac); if (!o[r]) continue; if (r === 'gold') st.gold += o[r]; else st.resources[r] = (st.resources[r] || 0) + o[r]; }
    return o;
  }
  function scrapTower(slot) {
    const s = hc(); const tw = s && s.tw[slot]; if (!tw) return;
    const def = TOWERS[tw.k];
    confirmScrap(def, tw, slot);
  }
  function confirmScrap(def, tw, slot) {
    const old = $('hc-scrap-cf'); if (old) old.remove();
    const sp = twSpent(tw), prev = {}; for (const r in sp) prev[r] = Math.floor((sp[r] || 0) * 0.9);
    const d = document.createElement('div'); d.id = 'hc-scrap-cf';
    d.innerHTML = '<div class="hc-sc-back"></div><div class="hc-sc-card" style="--tc:' + def.col + '"><div class="hc-sc-ic">⚒</div>' +
      '<b>SCRAP ' + def.name.toUpperCase() + '?</b><em>' + def.ic + ' Lv ' + tw.lv + ' · Pad ' + (slot + 1) + '</em>' +
      '<p>Salvage crews strip the tower and recover <b>90%</b> of everything invested:</p>' +
      '<div class="hc-sc-sal">' + costTxt(prev) + '</div>' +
      '<div class="hc-sc-btns"><button id="hc-sc-no">KEEP IT</button><button id="hc-sc-yes">⚒ SCRAP</button></div></div>';
    ($('arena-wrap') || $('app') || document.body).appendChild(d);
    const close = () => d.remove();
    d.querySelector('.hc-sc-back').addEventListener('click', close);
    d.querySelector('#hc-sc-no').addEventListener('click', close);
    d.querySelector('#hc-sc-yes').addEventListener('click', () => { close(); doScrap(slot); });
  }
  function doScrap(slot) {
    const s = hc(); const tw = s && s.tw[slot]; if (!tw) return;
    const def = TOWERS[tw.k];
    const got = refund(twSpent(tw), 0.9);
    s.tw[slot] = null;
    try { G().save(); } catch (e) {}
    toast('⚒ ' + def.name + ' scrapped — recovered ' + costTxt(got));
    syncTowers(); render(); if (window.UI) window.UI.refreshAll();
    if (_panel) renderPanel();
  }
  // runtime tower list rebuilt from state (on deploy, buy, upgrade)
  function syncTowers() {
    if (!run) return;
    const s = hc(), f = run.fort;
    run.tws = [];
    s.tw.forEach((tw, i) => {
      if (!tw) return;
      run.tws.push({ i, k: tw.k, lv: tw.lv, x: f.x + PADS[i][0], y: f.y + PADS[i][1], cd: Math.random() * 1.5, rt: 0, tgt: null, ang: -Math.PI / 2, heat: 0 });
    });
    _city.key = '';   // re-bake pad plates
  }
  // ore rock field — deterministic positions, count scales with the Mining Array
  function rockList(mineLv) {
    const n = Math.min(10, 3 + Math.floor(mineLv / 2));
    const R = (i) => (((Math.sin(i * 91.7) * 24634.63) % 1) + 1) % 1;
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = 0.55 + (i / n) * 2.05 + R(i) * 0.22;
      const r = 350 + R(i + 40) * 120;
      out.push({ x: Math.cos(a) * r, y: 60 + Math.sin(a) * r * 0.62, s: 16 + R(i + 80) * 16, seed: i });
    }
    return out;
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
    [1, 'Gold flows'], [5, '+Ore & Fuel · ❄ Cryo Spire tower'], [10, 'Part crate every 10th wave'], [12, '☄ Missile Battery tower'], [15, '+Plasma'],
    [20, 'RARE raiders · richer tables'], [25, '✦ Annihilator Rail tower'], [40, '+◈ Prism trickle'], [50, 'EPIC era · +◇ Cores on crates'],
    [100, 'LEGENDARY era · ×2 ALL production'], [250, 'MYTHIC era — endgame tables'],
  ];

  // ---- production -----------------------------------------------------------
  function capHours(s) { return BASE_CAP_H + (s.b.silo | 0) * 2; }
  function rates(s) {
    const w = s.wave | 0;
    if (w < 1) return { gold: 0, iron: 0, fuel: 0, plasma: 0, prism: 0 };
    const mult = Math.pow(w, 1.45) * zScale() * (1 + (s.b.mine | 0) * 0.10) * (w >= 100 ? 2 : 1) * (window.VIP ? window.VIP.mult('afk') : 1);
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
    const fortMax = ps.maxHp * 12 * (1 + (s.b.turret | 0) * 0.05);
    // every deploy opens in a safe BUILD PHASE — fortify, then launch the wave
    run = { phase: 'build', next, N: 0, spawned: 0, refs: [], spawnT: 1.8, spawnIv: 1,
            unitHp: 1, dps: ps.dps, turretDps: ps.dps * (s.b.turret | 0) * 0.08, turretTarget: null,
            fort: { x: dep.worldW / 2, y: dep.worldH * 0.42, size: 100, hp: fortMax, max: fortMax, dead: false, hitT: 0 },
            auto: !!auto, session: { waves: 0, gold: 0, crates: 0 }, between: null,
            prevSpeed, uiT: 0, zone: dep.zone, fx: [], tws: [],
            b: { mine: s.b.mine | 0, silo: s.b.silo | 0, turret: s.b.turret | 0, repair: s.b.repair | 0 } };
    syncTowers();
    ensureWarbar();
    const nav = document.querySelector('.nav-btn[data-screen="battle"]'); if (nav) nav.click();
    bbanner('BUILD PHASE — FORTIFY YOUR CITADEL', 'Buy towers & upgrades with 🔨 BUILD · launch WAVE ' + next + ' when ready');
    render(); updateHud();
  }
  // driven by the engine's update() every frame while rt.hcrun is active
  function engineTick(dt, rt) {
    if (!run) { rt.hcrun = null; return; }
    if (run.zone !== (G().state.currentDungeon | 0)) return endWave(false, true);   // bailed to hangar / warped = abandon
    if (run.between != null) {   // auto-defense intermission — next wave spinning up
      run.between -= dt; fxTick(dt);
      if (run.between <= 0) { run.between = null; rollNext(); }
      return;
    }
    const f = run.fort;
    // EXTENDED ENGAGEMENT RANGE — defending a fixed fort needs reach: 2.5× while
    // the defense is live, re-applied after any stat refresh, dropped at wave end.
    if (rt.stats && !rt.stats._hcRange) { rt.stats.fireRange = (rt.stats.fireRange || 250) * 2.5; rt.stats._hcRange = 1; }
    // BUILD PHASE — no raiders, no fort damage: walk the grounds, buy towers,
    // launch when ready (▶). Towers idle-animate; silo/beam caches stay live.
    if (run.phase === 'build') {
      f.hp = f.max;
      run.uiT -= dt;
      if (run.uiT <= 0) {
        run.uiT = 0.12; syncWarbar(0); run.beamTargets = [];
        try { const s2 = hc(); run.siloFrac = Math.min(1, accrued(s2).h / capHours(s2)); } catch (e) { run.siloFrac = 0; }
      }
      towersTick(dt);
      return;
    }
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
    towersTick(dt);
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
    drawTowers(ctx, t);
    drawHomeDrones(ctx, t, f);
    drawPatrolFleet(ctx, t, f);
    drawFx(ctx);
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
  // ---- tower combat + projectile fx -----------------------------------------
  function twAlive(e) { return e && !(e.dead || e.dying || e.hp <= 0); }
  function towersTick(dt) {
    const tws = run.tws;
    if (!tws || !tws.length) { fxTick(dt); return; }
    const live = run.phase === 'fight' ? run.refs.filter(twAlive) : [];
    for (const tw of tws) {
      const def = TOWERS[tw.k];
      tw.heat = Math.max(0, tw.heat - dt);
      tw.rt -= dt;
      if (tw.rt <= 0) {   // retarget at ~8Hz
        tw.rt = 0.12;
        if (tw.k === 'rail') { let best = null, bh = -1; for (const e of live) { if (Math.hypot(e.x - tw.x, e.y - tw.y) <= def.range && e.maxHp > bh) { bh = e.maxHp; best = e; } } tw.tgt = best; }
        else { let best = null, bd = 1e9; for (const e of live) { const d = Math.hypot(e.x - tw.x, e.y - tw.y); if (d <= def.range && d < bd) { bd = d; best = e; } } tw.tgt = best; }
      }
      if (tw.tgt && !twAlive(tw.tgt)) tw.tgt = null;
      if (tw.tgt) { const ta = Math.atan2(tw.tgt.y - tw.y, tw.tgt.x - tw.x); let da = ta - tw.ang; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2; tw.ang += da * Math.min(1, dt * 10); }
      const dps = run.dps;
      if (tw.k === 'laser') {
        if (tw.tgt) { const dm = dps * 0.12 * tw.lv * dt; try { tw.tgt.takeDamage(dm); } catch (e2) { tw.tgt.hp -= dm; } tw.heat = 0.2; }
      } else if (tw.k === 'cryo') {
        let hit = 0;
        for (const e of live) {
          if (Math.hypot(e.x - tw.x, e.y - tw.y) <= def.range) {
            e.chillT = Math.max(e.chillT || 0, 0.5);   // engine-native slow: 42% speed + slow guns
            const dm = dps * 0.03 * tw.lv * dt; try { e.takeDamage(dm); } catch (e2) { e.hp -= dm; }
            if (++hit >= 10) break;
          }
        }
        if (hit) tw.heat = 0.2;
      } else if (tw.k === 'missile') {
        tw.cd -= dt;
        if (tw.cd <= 0 && tw.tgt) {
          tw.cd = 2.8; tw.heat = 0.35;
          const d = Math.hypot(tw.tgt.x - tw.x, tw.tgt.y - tw.y);
          fxAdd({ type: 'mis', sx: tw.x, sy: tw.y - 14, x: tw.x, y: tw.y - 14, tgt: tw.tgt, tx: tw.tgt.x, ty: tw.tgt.y, t: 0, dur: Math.max(0.35, d / 520), dmg: dps * 0.55 * tw.lv, col: def.col });
        }
      } else if (tw.k === 'rail') {
        tw.cd -= dt;
        if (tw.cd <= 0 && tw.tgt) {
          tw.cd = 4.5; tw.heat = 0.5;
          const a = Math.atan2(tw.tgt.y - tw.y, tw.tgt.x - tw.x); tw.ang = a;
          const ex = tw.x + Math.cos(a) * 1300, ey = tw.y + Math.sin(a) * 1300;
          const dmg = dps * 1.6 * tw.lv;
          let hits = 0;
          for (const e of live) {   // pierce: damage everything near the firing line
            const vx = ex - tw.x, vy = ey - tw.y, wx = e.x - tw.x, wy = e.y - tw.y;
            const c1 = vx * wx + vy * wy; if (c1 <= 0) continue;
            const u = Math.min(1, c1 / (vx * vx + vy * vy));
            if (Math.hypot(e.x - (tw.x + vx * u), e.y - (tw.y + vy * u)) <= 26 + (e.size || 12)) {
              try { e.takeDamage(dmg); } catch (e2) { e.hp -= dmg; }
              hits++; fxAdd({ type: 'hit', x: e.x, y: e.y, t: 0, dur: 0.3, col: '#ff8a95' });
            }
          }
          fxAdd({ type: 'rail', x: tw.x, y: tw.y - 16, ex, ey, t: 0, dur: 0.35 });
          try { const grt = G().rt; if (grt) grt.shake = Math.min(6, (grt.shake || 0) + (hits ? 2.4 : 1.2)); } catch (e) {}
        }
      }
    }
    fxTick(dt);
  }
  function fxAdd(o) { if (run && run.fx.length < 48) run.fx.push(o); }
  function fxTick(dt) {
    const fx = run.fx; if (!fx) return;
    for (let i = fx.length - 1; i >= 0; i--) {
      const p = fx[i]; p.t += dt;
      if (p.type === 'mis') {
        if (twAlive(p.tgt)) { p.tx = p.tgt.x; p.ty = p.tgt.y; }
        const u = Math.min(1, p.t / p.dur), k = u * u * (3 - 2 * u);
        p.x = p.sx + (p.tx - p.sx) * k; p.y = p.sy + (p.ty - p.sy) * k - Math.sin(u * Math.PI) * 46;
        if (u >= 1) {
          fx.splice(i, 1);
          fxAdd({ type: 'boom', x: p.tx, y: p.ty, t: 0, dur: 0.38, col: p.col });
          if (run.phase === 'fight') for (const e of run.refs) { if (!twAlive(e)) continue; if (Math.hypot(e.x - p.tx, e.y - p.ty) <= 95) { try { e.takeDamage(p.dmg); } catch (e2) { e.hp -= p.dmg; } } }
          try { const grt = G().rt; if (grt) grt.shake = Math.min(5, (grt.shake || 0) + 1); } catch (e) {}
        }
      } else if (p.t >= p.dur) fx.splice(i, 1);
    }
  }
  // per-type vector turrets (they aim — drawn live, bases baked)
  function drawTowers(ctx, t) {
    if (!run.tws) return;
    for (const tw of run.tws) {
      const def = TOWERS[tw.k];
      ctx.save(); ctx.translate(tw.x, tw.y);
      if (tw.k === 'cryo') {
        ctx.globalAlpha = 0.08 + 0.04 * Math.sin(t * 2 + tw.i);
        ctx.fillStyle = def.col; ctx.beginPath(); ctx.arc(0, 0, def.range, 0, 7); ctx.fill();
        ctx.globalAlpha = 0.3; ctx.strokeStyle = def.col; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(0, 0, def.range, 0, 7); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const hot = tw.heat > 0;
      if (tw.k === 'cryo') {
        ctx.fillStyle = '#1c2c3d';
        ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(8, 0); ctx.lineTo(-8, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = def.col; ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 3 + tw.i);
        ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(4.5, -2); ctx.lineTo(-4.5, -2); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.rotate(tw.ang + Math.PI / 2);
        if (tw.k === 'laser') {
          ctx.fillStyle = '#22313d'; ctx.fillRect(-6, -4, 12, 12);
          ctx.fillStyle = hot ? '#dff6ff' : def.col;
          ctx.fillRect(-5.5, -15, 3.4, 13); ctx.fillRect(2.1, -15, 3.4, 13);
        } else if (tw.k === 'missile') {
          ctx.fillStyle = '#332714'; ctx.fillRect(-9, -7, 18, 15);
          ctx.fillStyle = hot ? '#ffe6bf' : def.col;
          for (let r2 = 0; r2 < 2; r2++) for (let c2 = 0; c2 < 2; c2++) { ctx.beginPath(); ctx.arc(-4 + c2 * 8, -10 + r2 * 7, 2.6, 0, 7); ctx.fill(); }
        } else {
          ctx.fillStyle = '#3a1c22'; ctx.fillRect(-7, -5, 14, 13);
          ctx.fillStyle = hot ? '#ffd9dd' : def.col; ctx.fillRect(-2.2, -30, 4.4, 27);
          ctx.fillStyle = '#141019'; ctx.fillRect(-4, -12, 8, 5);
        }
      }
      ctx.restore();
      if (tw.k === 'laser' && tw.tgt && twAlive(tw.tgt)) {
        ctx.strokeStyle = 'rgba(124,224,255,.75)'; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.moveTo(tw.x + Math.cos(tw.ang) * 14, tw.y + Math.sin(tw.ang) * 14); ctx.lineTo(tw.tgt.x, tw.tgt.y); ctx.stroke();
        ctx.fillStyle = '#dff6ff'; ctx.beginPath(); ctx.arc(tw.tgt.x, tw.tgt.y, 2.6, 0, 7); ctx.fill();
      }
      ctx.fillStyle = def.col; ctx.font = '800 9px Rajdhani,sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('L' + tw.lv, tw.x, tw.y + 26);
    }
  }
  function drawFx(ctx) {
    if (!run.fx) return;
    for (const p of run.fx) {
      const u = Math.min(1, p.t / p.dur);
      if (p.type === 'mis') {
        ctx.save(); ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(p.ty - p.y + 0.001, p.tx - p.x + 0.001));
        ctx.fillStyle = '#ffe1a6'; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -2.6); ctx.lineTo(-4, 2.6); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 0.45; ctx.fillStyle = '#ffb84d'; ctx.fillRect(-9, -1, 4, 2); ctx.globalAlpha = 1;
        ctx.restore();
      } else if (p.type === 'boom') {
        ctx.globalAlpha = 1 - u; ctx.strokeStyle = p.col || '#ffb84d'; ctx.lineWidth = 3 * (1 - u) + 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, 10 + u * 85, 0, 7); ctx.stroke();
        ctx.globalAlpha = (1 - u) * 0.35; ctx.fillStyle = '#ffd9a0';
        ctx.beginPath(); ctx.arc(p.x, p.y, 6 + u * 60, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      } else if (p.type === 'rail') {
        ctx.globalAlpha = 1 - u; ctx.strokeStyle = '#ff5a68'; ctx.lineWidth = 5 * (1 - u) + 1;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.ex, p.ey); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(0.4, 1.6 * (1 - u));
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.ex, p.ey); ctx.stroke(); ctx.globalAlpha = 1;
      } else if (p.type === 'hit') {
        ctx.globalAlpha = 1 - u; ctx.fillStyle = p.col || '#fff';
        ctx.beginPath(); ctx.arc(p.x, p.y, 3 + u * 14, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      }
    }
  }
  // launch the armed wave from the build phase
  function beginFight() {
    if (!run) return;
    if (run.phase !== 'build') return;
    run.phase = 'fight';
    const lb = $('hc-launch'); if (lb) lb.remove();
    closePanel();
    rollNext();
  }
  // leave the build phase — NO breach, nothing lost
  function exitBuild(engineHandled) {
    if (!run) return;
    const prevSpeed = run.prevSpeed;
    run = null;
    removeWarbar(); closePanel();
    try { if (!engineHandled) G().endHomeDefense(); else { const grt = G().rt; if (grt) grt.hcrun = null; } } catch (e) {}
    try { if (prevSpeed && prevSpeed !== 1) G().setGameSpeed(prevSpeed); } catch (e) {}
    try { G().refreshStats(); } catch (e) {}
    toast('🏰 Returned to base — nothing lost');
    setTimeout(() => { const nav = document.querySelector('.nav-btn[data-screen="homecit"]'); if (nav) nav.click(); else render(); }, 80);
    render(); updateHud();
  }
  // ---- IN-BATTLE BUILD PANEL — the Citadel Works ---------------------------
  let _panel = null, _panelPad = -1, _panelIv = null;
  function openPanel() { if (!run) return; _panelPad = -1; renderPanel(); }
  function closePanel() { if (_panel) { _panel.remove(); _panel = null; } if (_panelIv) { clearInterval(_panelIv); _panelIv = null; } }
  function resRow() {
    const st = G().state;
    return '<b>$' + fmt(st.gold || 0) + '</b><i>◆' + fmt(st.resources.iron || 0) + '</i><i>⬢' + fmt(st.resources.fuel || 0) + '</i><i>✦' + fmt(st.resources.plasma || 0) + '</i>';
  }
  function renderPanel() {
    if (!run) { closePanel(); return; }
    if (!_panel) {
      _panel = document.createElement('div'); _panel.id = 'hc-bp';
      _panel.innerHTML = '<div class="hc-bp-back"></div><div class="hc-bp-card"><div class="hc-bp-h"><b>🔨 CITADEL WORKS</b><span class="hc-bp-res" id="hc-bp-res"></span><button class="hc-bp-x" id="hc-bp-x">✕</button></div><div class="hc-bp-body" id="hc-bp-body"></div></div>';
      ($('arena-wrap') || $('app') || document.body).appendChild(_panel);
      _panel.querySelector('.hc-bp-back').addEventListener('click', closePanel);
      _panel.querySelector('#hc-bp-x').addEventListener('click', closePanel);
      _panelIv = setInterval(() => { const r = $('hc-bp-res'); if (r) r.innerHTML = resRow(); }, 900);
    }
    const s = hc(); if (!s) return;
    $('hc-bp-res').innerHTML = resRow();
    const body = $('hc-bp-body');
    body.innerHTML = _panelPad >= 0 ? chooserHtml(s) : worksHtml(s);
    wirePanel(body);
  }
  function worksHtml(s) {
    const built = s.tw.filter(Boolean).length;
    let slots = '';
    s.tw.forEach((tw, i) => {
      if (tw) {
        const def = TOWERS[tw.k], mx = twMaxLv(s), maxed = tw.lv >= mx, c = maxed ? null : twUpCost(tw.k, tw.lv);
        slots += '<div class="hc-tw" style="--tc:' + def.col + '"><div class="hc-tw-h"><span>' + def.ic + '</span><b>' + def.name + '</b><em>Lv ' + tw.lv + '<i>/' + mx + '</i></em></div><div class="hc-tw-eff">' + def.dmgTxt(tw.lv) + '</div>' +
          (maxed ? '<div class="hc-tw-max">MAX — ascend the Citadel to raise the cap</div>' : '<button class="hc-tw-buy" data-twup="' + i + '"' + (canAfford(c) ? '' : ' disabled') + '>▲ UPGRADE · ' + costTxt(c) + '</button>') +
          '<button class="hc-tw-scrap" data-twscrap="' + i + '" title="Scrap — recover 90% of everything invested">⚒ SCRAP · 90% back</button></div>';
      } else {
        slots += '<button class="hc-tw empty" data-twadd="' + i + '"><span>＋</span>BUILD ON PAD ' + (i + 1) + '</button>';
      }
    });
    let blds = '';
    for (const key in BLD) {
      const b = BLD[key], cur = s.b[key] | 0, mx = bldMax(s, key), maxed = cur >= mx, c = maxed ? null : bldCost(key, cur);
      blds += '<div class="hc-tw bld"><div class="hc-tw-h"><span>' + b.ic + '</span><b>' + b.name + '</b><em>Lv ' + cur + '<i>/' + mx + '</i></em></div><div class="hc-tw-eff">' + b.eff(cur) + (maxed ? ' · MAX' : ' · next: ' + b.next(cur)) + '</div>' +
        (maxed ? '' : '<button class="hc-tw-buy" data-bld="' + key + '"' + (canAfford(c) ? '' : ' disabled') + '>▲ ' + costTxt(c) + '</button>') + '</div>';
    }
    const cc = citCost(s);
    return '<div class="hc-bp-sec">DEFENSE TOWERS <i>' + built + '/8 pads</i></div><div class="hc-bp-grid">' + slots + '</div>' +
      '<div class="hc-bp-sec">STRUCTURES</div><div class="hc-bp-grid">' + blds + '</div>' +
      '<div class="hc-bp-cit"><div><b>🏰 CITADEL LEVEL ' + (s.cit | 0) + '</b><span>+10 max levels on every structure & tower</span></div><button class="hc-tw-buy" data-cit' + (canAfford(cc) ? '' : ' disabled') + '>⬆ ' + costTxt(cc) + '</button></div>';
  }
  function chooserHtml(s) {
    let rows = '';
    for (const k in TOWERS) {
      const t = TOWERS[k], locked = t.unlockW && s.wave < t.unlockW, c = twBuildCost(k);
      rows += '<div class="hc-tc' + (locked ? ' locked' : '') + '" style="--tc:' + t.col + '"><div class="hc-tc-h"><span>' + t.ic + '</span><b>' + t.name + '</b>' + (locked ? '<em>🔒 Wave ' + t.unlockW + '</em>' : '<em>range ' + t.range + '</em>') + '</div>' +
        '<p>' + t.desc + '</p><div class="hc-tw-eff">' + t.dmgTxt(1) + '</div>' +
        (locked ? '' : '<button class="hc-tw-buy" data-twbuy="' + k + '"' + (canAfford(c) ? '' : ' disabled') + '>⚒ BUILD · ' + costTxt(c) + '</button>') + '</div>';
    }
    return '<button class="hc-bp-back-btn" id="hc-bp-bk">← ALL WORKS</button><div class="hc-bp-sec">PAD ' + (_panelPad + 1) + ' — CHOOSE A TOWER</div><div class="hc-bp-grid one">' + rows + '</div>';
  }
  function wirePanel(body) {
    body.querySelectorAll('[data-twadd]').forEach((b) => b.addEventListener('click', () => { _panelPad = +b.dataset.twadd; renderPanel(); }));
    body.querySelectorAll('[data-twup]').forEach((b) => b.addEventListener('click', () => { upTower(+b.dataset.twup); renderPanel(); }));
    body.querySelectorAll('[data-twscrap]').forEach((b) => b.addEventListener('click', () => { scrapTower(+b.dataset.twscrap); renderPanel(); }));
    body.querySelectorAll('[data-twbuy]').forEach((b) => b.addEventListener('click', () => { if (buyTower(_panelPad, b.dataset.twbuy)) _panelPad = -1; renderPanel(); }));
    body.querySelectorAll('[data-bld]').forEach((b) => b.addEventListener('click', () => { buyBld(b.dataset.bld); renderPanel(); }));
    const ct = body.querySelector('[data-cit]'); if (ct) ct.addEventListener('click', () => { buyCit(); renderPanel(); });
    const bk = body.querySelector('#hc-bp-bk'); if (bk) bk.addEventListener('click', () => { _panelPad = -1; renderPanel(); });
  }
  function twSumTxt(s) {
    const counts = {};
    s.tw.forEach((t) => { if (t) counts[t.k] = (counts[t.k] || 0) + 1; });
    const bits = Object.keys(counts).map((k) => TOWERS[k].ic + '×' + counts[k]).join(' · ');
    const n = s.tw.filter(Boolean).length;
    return '🔨 <b>DEFENSE WORKS — ' + n + '/8 tower pads</b>' + (n ? ' · ' + bits : '') + '<br><i>Towers, structures & ascensions are built INSIDE the defense — deploy, then hit 🔨 BUILD.</i>';
  }
  // ---- baked city canvas ----------------------------------------------------
  const CITY_W = 1040, CITY_H = 800, CITY_TOP = 350;   // world px, origin = fort center
  const _hcImgs = {};
  function hcImg(n) { if (!_hcImgs[n]) { const im = new Image(); im.src = 'ships/hc-' + n + '.png'; _hcImgs[n] = im; } return _hcImgs[n]; }
  let _city = { cv: null, key: '' };
  function cityKey() {
    const b = run.b;
    const imgs = ['citadel', 'mine', 'silo', 'turret', 'repair'].map((n) => (hcImg(n).complete && hcImg(n).naturalWidth) ? 1 : 0).join('');
    let twSig = ''; try { twSig = hc().tw.map((t2) => t2 ? t2.k[0] : '-').join(''); } catch (e) {}
    return b.mine + '·' + b.silo + '·' + b.turret + '·' + b.repair + '·' + imgs + '·' + twSig;
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
    // ORE FIELD — real rock bases the cargo drones fly out to (count = Mining Array)
    const rocks = rockList(run.b.mine | 0);
    for (const rk of rocks) {
      c2.save(); c2.translate(rk.x, rk.y);
      const R2 = (j) => (((Math.sin((rk.seed * 17 + j) * 57.3) * 8887.7) % 1) + 1) % 1;
      c2.beginPath();
      for (let j = 0; j < 8; j++) { const a2 = j / 8 * Math.PI * 2; const rr = rk.s * (0.72 + R2(j) * 0.5); const px = Math.cos(a2) * rr, py = Math.sin(a2) * rr * 0.78; j ? c2.lineTo(px, py) : c2.moveTo(px, py); }
      c2.closePath();
      c2.fillStyle = '#2a2620'; c2.fill();
      c2.strokeStyle = 'rgba(200,190,160,.28)'; c2.lineWidth = 1; c2.stroke();
      c2.fillStyle = 'rgba(0,0,0,.3)';
      for (let j = 0; j < 3; j++) { c2.beginPath(); c2.arc((R2(j + 9) - 0.5) * rk.s, (R2(j + 14) - 0.5) * rk.s * 0.6, 1.5 + R2(j + 20) * 2.5, 0, 7); c2.fill(); }
      c2.fillStyle = 'rgba(255,210,77,.85)';   // glowing ore veins
      for (let j = 0; j < 4; j++) { const px = (R2(j + 30) - 0.5) * rk.s * 1.1, py = (R2(j + 40) - 0.5) * rk.s * 0.7; c2.fillRect(px, py, 2, 1.2); c2.fillRect(px + 1, py + 1.2, 1.4, 1); }
      c2.restore();
    }
    // tower pads — solid plates under built towers, dashed ＋ ghosts on empties
    let twState = []; try { twState = hc().tw; } catch (e) {}
    PADS.forEach(([px, py], i) => {
      const built = twState[i];
      c2.save(); c2.translate(px, py);
      if (built) {
        const col = TOWERS[built.k].col;
        c2.fillStyle = 'rgba(10,16,20,.9)'; hexPath(c2, 17, Math.PI / 6); c2.fill();
        c2.strokeStyle = col; c2.globalAlpha = 0.65; c2.lineWidth = 1.6; hexPath(c2, 17, Math.PI / 6); c2.stroke(); c2.globalAlpha = 1;
      } else {
        c2.globalAlpha = 0.4; c2.strokeStyle = 'rgba(120,255,96,.5)'; c2.setLineDash([4, 5]); c2.lineWidth = 1.2;
        hexPath(c2, 15, Math.PI / 6); c2.stroke(); c2.setLineDash([]);
        c2.fillStyle = 'rgba(160,255,140,.55)'; c2.font = '800 13px Rajdhani,sans-serif'; c2.textAlign = 'center'; c2.fillText('+', 0, 4.5);
        c2.globalAlpha = 1;
      }
      c2.restore();
    });
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
  // CARGO DRONES — launch from the Mining Array, fly OUT to a real ore rock,
  // beam-mine it, haul the glowing payload back to the Deep Silo, deposit,
  // repeat. Mining Array levels add BOTH drones and rocks; each drone flies its
  // own bowed route at its own pace so the yard never looks like a loop.
  function drawHomeDrones(ctx, t, f) {
    const mineLv = run.b.mine | 0;
    if (!run._rocks || run._rockLv !== mineLv) { run._rocks = rockList(mineLv); run._rockLv = mineLv; }
    const rocks = run._rocks; if (!rocks.length) return;
    const n = Math.min(9, 2 + Math.ceil(mineLv / 2));
    const mine = { x: f.x - 205, y: f.y + 55 }, silo = { x: f.x + 205, y: f.y + 50 };
    const qp = (A, B, k, bw) => {
      const d = Math.max(60, Math.hypot(B.x - A.x, B.y - A.y));
      const mx = (A.x + B.x) / 2 - (B.y - A.y) / d * bw, my = (A.y + B.y) / 2 + (B.x - A.x) / d * bw;
      const q = 1 - k;
      return { x: q * q * A.x + 2 * q * k * mx + k * k * B.x, y: q * q * A.y + 2 * q * k * my + k * k * B.y };
    };
    for (let i = 0; i < n; i++) {
      const rk = rocks[(i * 5 + 2) % rocks.length];
      const node = { x: f.x + rk.x, y: f.y + rk.y - rk.s * 0.4 };
      const cycle = 8 + (i % 4) * 1.3, u = ((t * 0.85 + i * 2.63) % cycle) / cycle;
      const bow = (i % 2 ? -1 : 1) * (36 + (i % 3) * 22);
      let x, y, px2, py2, mining = false, hauling = false, depositing = false;
      if (u < 0.3) { const k = u / 0.3, p = qp(mine, node, k, bow), p2 = qp(mine, node, Math.min(1, k + 0.02), bow); x = p.x; y = p.y; px2 = p2.x; py2 = p2.y; }
      else if (u < 0.46) { x = node.x; y = node.y; px2 = x + 1; py2 = y; mining = true; }
      else if (u < 0.82) { const k = (u - 0.46) / 0.36, p = qp(node, silo, k, -bow), p2 = qp(node, silo, Math.min(1, k + 0.02), -bow); x = p.x; y = p.y; px2 = p2.x; py2 = p2.y; hauling = true; }
      else { x = silo.x; y = silo.y - 6; px2 = x + 1; py2 = y; depositing = true; }
      y += Math.sin(t * 4 + i) * 2.5;
      const hd = Math.atan2(py2 - y, px2 - x);
      ctx.save(); ctx.translate(x, y); ctx.rotate(hd);
      ctx.fillStyle = hauling ? '#ffe1a6' : '#c8ffb0';
      ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4.5, -3.6); ctx.lineTo(-2.2, 0); ctx.lineTo(-4.5, 3.6); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.4; ctx.fillRect(-10, -0.9, 5, 1.8); ctx.globalAlpha = 1;
      if (hauling) { ctx.fillStyle = 'rgba(255,210,77,.95)'; ctx.beginPath(); ctx.arc(-7.5, 0, 2.2, 0, 7); ctx.fill(); }   // glowing ore payload
      ctx.restore();
      if (mining) {   // mining beam chewing the rock + sparks
        const rx = node.x + Math.sin(t * 11 + i) * 2, ry = node.y + rk.s * 0.42;
        ctx.strokeStyle = 'rgba(255,210,77,.8)'; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(x, y + 3); ctx.lineTo(rx, ry); ctx.stroke();
        if (Math.sin(t * 9 + i * 2.2) > 0.2) { ctx.fillStyle = '#ffd24d'; ctx.fillRect(rx - 1.5 + Math.sin(t * 13 + i) * 3, ry - 1, 2, 2); ctx.fillRect(rx + Math.cos(t * 17 + i) * 4, ry + 1, 1.6, 1.6); }
      }
      if (depositing && Math.sin(t * 8 + i * 1.7) > 0.1) {   // deposit flash into the silo
        ctx.strokeStyle = 'rgba(124,224,160,.85)'; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.lineTo(x, y + 10); ctx.stroke();
        ctx.fillStyle = '#a5f2c4'; ctx.fillRect(x - 1.5, y + 10, 3, 3);
      }
    }
  }
  // tap-safe binding for buttons overlaid on the arena: the canvas' pointer/
  // touch handlers (tap-to-target, pan) swallow synthetic clicks on mobile, so
  // fire on pointerup ourselves and stop the arena from hijacking the gesture.
  function tapBind(el, fn) {
    let armed = false, fired = 0;
    const go = (e) => { e.preventDefault(); e.stopPropagation(); const now = Date.now(); if (now - fired < 350) return; fired = now; fn(); };
    el.addEventListener('pointerdown', (e) => { armed = true; e.stopPropagation(); });
    el.addEventListener('pointerup', (e) => { if (armed) { armed = false; go(e); } });
    el.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: false });
    el.addEventListener('touchend', (e) => { e.stopPropagation(); }, { passive: false });
    el.addEventListener('click', go);   // keyboard / non-pointer fallback (deduped)
  }
  // ---- in-battle HUD strip + big banner (arena overlays) --------------------
  function ensureWarbar() {
    removeWarbar();
    const host = $('top-stack'); if (!host) return;
    const w = document.createElement('div'); w.id = 'hc-warbar';
    w.innerHTML = '<span class="hcw-wave" id="hcw-wave">W' + run.next + '</span>' +
      '<div class="hcw-mid"><div class="hcw-bar"><i id="hcw-fill" style="width:100%"></i></div><span class="hcw-lbl">CITADEL HULL</span></div>' +
      '<span class="hcw-left" id="hcw-left">—</span>' +
      '<button id="hcw-build" title="Citadel Works — buy & upgrade towers and structures">🔨</button>' +
      '<button id="hcw-start" title="Launch the wave">▶ W' + run.next + '</button>' +
      '<button id="hcw-bail" title="Leave / abandon">⏏</button>';
    host.appendChild(w);
    tapBind(w.querySelector('#hcw-bail'), () => { if (run && run.phase === 'build') exitBuild(); else endWave(false); });
    tapBind(w.querySelector('#hcw-build'), openPanel);
    tapBind(w.querySelector('#hcw-start'), beginFight);
    syncLaunch();
  }
  function removeWarbar() { const w = $('hc-warbar'); if (w) w.remove(); const lb = $('hc-launch'); if (lb) lb.remove(); }
  function syncLaunch() {
    const build = run && run.phase === 'build';
    let b = $('hc-launch');
    if (build) {
      if (!b) { b = document.createElement('button'); b.id = 'hc-launch'; tapBind(b, beginFight); ($('arena-wrap') || $('app') || document.body).appendChild(b); }
      b.innerHTML = '▶ LAUNCH WAVE ' + run.next + '<span>' + band(run.next).name + ' raiders · fortify first — 🔨 BUILD</span>';
    } else if (b) b.remove();
  }
  function syncWarbar(alive) {
    if (!run) return;
    const f = run.fort;
    const fill = $('hcw-fill'); if (fill) { const p = Math.max(0, f.hp / f.max * 100); fill.style.width = p + '%'; fill.classList.toggle('low', p < 35); }
    const build = run.phase === 'build';
    const st = $('hcw-start'); if (st) { st.style.display = build ? '' : 'none'; st.textContent = '▶ W' + run.next; }
    const wv = $('hcw-wave'); if (wv) wv.textContent = build ? '🔨' : 'W' + run.next;
    const l = $('hcw-left'); if (l) l.textContent = build ? 'BUILD PHASE' : '⚔ ' + alive + ' live · ' + (run.N - run.spawned) + ' inbound';
    syncLaunch();
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
    removeWarbar(); closePanel();
    try { const grt = G().rt; if (grt) grt.hcrun = null; } catch (e) {}
    try { if (prevSpeed && prevSpeed !== 1) G().setGameSpeed(prevSpeed); } catch (e) {}
    if (msg) toast('🏰 ' + msg);
    render(); updateHud();
  }
  // grant the rewards for clearing wave `next` — shared by solo + auto runs
  function grantWaveRewards(s, next) {
    s.wave = next;
    const st = G().state, r = rates(s), lines = [];
    const gold = Math.max(5000, Math.round(r.gold * 2.2 * (window.VIP ? window.VIP.mult('gold') : 1)));
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
    run.dps = ps.dps; run.turretDps = ps.dps * turretPct * (window.PASCEND ? window.PASCEND.mult('tower') : 1);   // ASCENSION: Bastion Command
    run.fort.max = ps.maxHp * 12 * (1 + (s.b.turret | 0) * 0.05);
    run.fort.hp = run.fort.max;                       // field crews repair between waves
    ensureWarbar();
    bbanner('WAVE ' + next + ' — INBOUND', band(next).name.toUpperCase() + ' raiders · ' + (run.auto ? 'auto-defense continues until you fall' : 'they burn the FORT — cut them down'));
    updateHud();
  }
  function endWave(won, engineHandled) {
    if (!run) return;
    const s = hc();
    const next = run.next;
    // leaving (or being kicked) during the BUILD PHASE is not a defeat — no breach
    if (!won && run.phase === 'build') return exitBuild(engineHandled);
    // ---- SOLO VICTORY: stay deployed — rewards banked, back to the build phase
    if (won && !run.auto && !engineHandled && s) {
      const got = grantWaveRewards(s, next);
      run.session.waves++; run.session.gold += got.gold; if (next % 10 === 0) run.session.crates++;
      run.phase = 'build'; run.next = next + 1; run.refs = []; run.between = null;
      run.fort.hp = run.fort.max;
      bbanner('WAVE ' + next + ' DEFENDED — EMPIRE UPGRADED', got.lines.slice(0, 3).map((x) => x.t).join(' · ') + ' · fortify, then launch Wave ' + (next + 1));
      syncWarbar(0); updateHud(); render();
      try { if (window.UI) window.UI.refreshAll(); } catch (e) {}
      if (_panel) renderPanel();
      return;
    }
    // ---- AUTO-CHAIN: victory rolls straight into the next wave -------------
    if (won && run.auto && !engineHandled && s) {
      const got = grantWaveRewards(s, next);
      run.session.waves++; run.session.gold += got.gold; if (next % 10 === 0) run.session.crates++;
      bbanner('WAVE ' + next + ' DEFENDED', got.lines.slice(0, 3).map((x) => x.t).join(' · ') + ' · next wave inbound…');
      run.between = 2.2;
      syncWarbar(0); updateHud();
      return;
    }
    const prevSpeed = run.prevSpeed, session = run.session;
    run = null;
    removeWarbar(); closePanel();
    try { if (!engineHandled) G().endHomeDefense(); else { const grt = G().rt; if (grt) grt.hcrun = null; } } catch (e) {}
    try { if (prevSpeed && prevSpeed !== 1) G().setGameSpeed(prevSpeed); } catch (e) {}
    try { G().refreshStats(); } catch (e) {}   // drop the 2.5× defense fire range
    try { if (window.UI) window.UI.refreshAll(); } catch (e) {}
    if (!s) return;
    const recap = (session && session.waves > 0)
      ? '<div class="hcm-next">⚔ Defense run: <b>' + session.waves + '</b> wave' + (session.waves > 1 ? 's' : '') + ' cleared · $' + fmt(session.gold) + (session.crates ? ' · ' + session.crates + ' crate' + (session.crates > 1 ? 's' : '') : '') + '</div>'
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
      rule('⚔', 'Waves auto-continue', 'You deploy into a build phase — hit ▶ to launch. From then on every victory rolls straight into the next wave, rewards granted instantly; the fort repairs between waves.') +
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
      rule('🔨', 'Build INSIDE the fight', 'Every deploy opens in a BUILD PHASE: raise laser, cryo, missile and rail towers on the 8 pads around your citadel, upgrade structures, then launch the wave. Towers are pricey — and permanent.') +
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
      bldHtml += '<div class="hc-bld" title="' + b.name + ' — ' + b.eff(cur) + (maxed ? ' · MAX (raise the cap with a Citadel ascension)' : ' · next: ' + b.next(cur)) + ' · 🔨 upgraded from INSIDE the defense"><div class="hc-bld-h"><span class="hc-bld-ic">' + b.ic + '</span><b>' + b.name + '</b><em>Lv ' + cur + '<i>/' + mx + '</i></em></div>' +
        '<div class="hc-bld-eff">' + b.eff(cur) + (maxed ? ' · MAX' : '') + '</div></div>';
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
      '<button class="hc-fight" id="hc-fight" title="Deploys your fleet to the citadel grounds in a safe BUILD PHASE — place towers, upgrade structures, then launch the wave. Raider strength scales to YOUR fleet."' + (dmg ? ' disabled' : '') + '>⚔ DEPLOY — WAVE ' + ((s.wave | 0) + 1) +
        '<span>' + band((s.wave | 0) + 1).name + ' raiders · build phase first — fortify, then launch</span></button>' +
      '<button class="hc-fight auto" id="hc-auto" title="Chains waves back-to-back until you fall. The fort repairs between waves — but dying carries NORMAL death penalties (gear drop, hull reset)."' + (dmg ? ' disabled' : '') + '>⚔∞ AUTO-DEFENSE<span>chain waves till you fall · normal death penalties apply</span></button>' +
      '<div class="hc-cit-card" title="Citadel Level ' + (s.cit | 0) + ' — each ASCEND permanently adds +10 max levels to EVERY structure and tower. Bought inside the defense (🔨 BUILD)."><div class="hc-cit-l"><b>🏰 CITADEL LEVEL ' + (s.cit | 0) + '</b><span>Each level unlocks <b>+10 levels on every structure & tower</b> — ascend from inside the defense.</span><span class="hc-cit-cost">' + costTxt(citCost(s)) + '</span></div></div>' +
      '<div class="hc-twsum">' + twSumTxt(s) + '</div>' +
      '<div class="hc-blds">' + bldHtml + '</div>' +
      '<div class="hc-miles"><div class="hc-miles-h">WAVE MILESTONES</div>' +
        MILES.map(([w, txt]) => '<div class="hc-mile' + (s.wave >= w ? ' done' : '') + '"><b>W' + w + '</b><span>' + txt + '</span>' + (s.wave >= w ? '<i>✓</i>' : '') + '</div>').join('') +
      '</div>' +
      '<button class="hc-how" id="hc-how">❔ How it works</button>';
  }
  function runView() {
    return '<div class="hc-live"><div class="hc-live-t">⚔ WAVE ' + run.next + ' — DEFENSE IN PROGRESS</div>' +
      '<div class="hc-live-s">Deployment active in the battle arena — build towers with 🔨, launch waves with ▶, and cut the raiders down before they burn the fort.</div>' +
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
  #hcw-build{ border:1px solid #4d3c14; background:#1d1608; color:#ffd9a0; border-radius:8px; padding:4px 9px; font-size:13px; cursor:pointer; }
  #hcw-start{ border:none; background:linear-gradient(180deg,#8ce7ab,#3da368); color:#04240f; border-radius:8px; padding:4px 10px; font-family:'Orbitron',sans-serif; font-weight:800; font-size:11px; cursor:pointer; white-space:nowrap; }
  #hc-launch{ position:absolute; left:50%; transform:translateX(-50%); bottom:calc(96px + env(safe-area-inset-bottom,0px)); z-index:56; touch-action:manipulation; border:none; border-radius:14px; padding:11px 22px; cursor:pointer; font-family:'Orbitron',sans-serif; font-weight:800; font-size:14px; letter-spacing:.06em; color:#04240f; background:linear-gradient(180deg,#8ce7ab,#3da368); box-shadow:0 10px 30px -8px rgba(124,224,160,.8), 0 0 0 1px rgba(255,255,255,.2) inset; display:flex; flex-direction:column; align-items:center; gap:2px; animation:hcFullPulse 1.6s ease-in-out infinite; }
  #hc-launch span{ font-family:'Rajdhani',sans-serif; font-weight:700; font-size:10.5px; color:#0c3a1f; text-transform:none; }
  #hc-launch:active{ transform:translateX(-50%) scale(.97); }
  /* in-battle build panel — the Citadel Works */
  #hc-bp{ position:absolute; inset:0; z-index:58; display:flex; align-items:flex-end; justify-content:center; }
  .hc-bp-back{ position:absolute; inset:0; background:rgba(8,6,3,.45); }
  .hc-bp-card{ position:relative; width:100%; max-width:560px; max-height:64%; display:flex; flex-direction:column; background:linear-gradient(180deg,#1c1509,#100d08); border:1px solid #6b5320; border-radius:18px 18px 0 0; box-shadow:0 -18px 50px rgba(0,0,0,.6); animation:hcmUp .25s cubic-bezier(.22,1,.36,1); }
  .hc-bp-h{ display:flex; align-items:center; gap:10px; padding:10px 12px; border-bottom:1px solid #33280f; }
  .hc-bp-h > b{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:12px; color:#ffe1a6; letter-spacing:.06em; white-space:nowrap; }
  .hc-bp-res{ margin-left:auto; display:flex; gap:8px; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:11.5px; color:#c9b898; white-space:nowrap; overflow:hidden; }
  .hc-bp-res b{ color:#ffd24d; } .hc-bp-res i{ font-style:normal; }
  .hc-bp-x{ border:1px solid #4d3c14; background:none; color:#b89d6e; border-radius:8px; padding:3px 8px; font-size:12px; cursor:pointer; }
  .hc-bp-body{ overflow-y:auto; padding:10px 12px calc(14px + env(safe-area-inset-bottom,0px)); display:flex; flex-direction:column; gap:8px; }
  .hc-bp-sec{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:9.5px; letter-spacing:.14em; color:#b89d6e; margin-top:4px; }
  .hc-bp-sec i{ font-style:normal; color:#7a6a4e; }
  .hc-bp-grid{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .hc-bp-grid.one{ grid-template-columns:1fr; }
  .hc-tw{ background:linear-gradient(180deg,#171307,#100d08); border:1px solid #33280f; border-left:3px solid var(--tc,#4d3c14); border-radius:11px; padding:9px 10px; display:flex; flex-direction:column; gap:5px; }
  .hc-tw.bld{ border-left-color:#4d3c14; }
  .hc-tw.empty{ border:1.5px dashed #4d3c14; background:none; color:#b89d6e; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:11.5px; letter-spacing:.06em; cursor:pointer; align-items:center; justify-content:center; gap:2px; min-height:74px; }
  .hc-tw.empty span{ font-size:19px; color:#7ce0a0; }
  .hc-tw-h{ display:flex; align-items:center; gap:6px; }
  .hc-tw-h span{ font-size:14px; }
  .hc-tw-h b{ font-family:'Rajdhani',sans-serif; font-weight:800; font-size:12.5px; color:#f2d9ac; flex:1; min-width:0; }
  .hc-tw-h em{ font-style:normal; font-family:'Orbitron',sans-serif; font-weight:700; font-size:9px; color:var(--tc,#ffb84d); }
  .hc-tw-h em i{ font-style:normal; font-size:8px; color:#8a7a5c; }
  .hc-tw-eff{ font-family:'Rajdhani',sans-serif; font-weight:700; font-size:11.5px; color:#a89468; }
  .hc-tw-max{ font-family:'Rajdhani',sans-serif; font-weight:800; font-size:11px; color:#7a6a4e; }
  .hc-tw-buy{ border:1px solid #4d3c14; border-radius:9px; background:#1d1608; color:#ffd9a0; padding:8px; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:11px; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .hc-tw-buy:disabled{ opacity:.45; }
  .hc-tw-buy:active:not(:disabled){ transform:scale(.96); }
  .hc-tw-scrap{ border:1px solid #4d2020; border-radius:9px; background:none; color:#d98a8a; padding:5px 8px; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:10px; cursor:pointer; }
  .hc-tw-scrap:active{ transform:scale(.96); }
  #hc-scrap-cf{ position:absolute; inset:0; z-index:62; display:flex; align-items:center; justify-content:center; padding:20px; }
  .hc-sc-back{ position:absolute; inset:0; background:rgba(8,6,3,.6); backdrop-filter:blur(2px); }
  .hc-sc-card{ position:relative; width:100%; max-width:320px; background:linear-gradient(180deg,#1c1509,#100d08); border:1px solid #6b5320; border-top:3px solid var(--tc,#ff5a68); border-radius:16px; padding:18px 16px 14px; text-align:center; display:flex; flex-direction:column; gap:7px; box-shadow:0 24px 60px rgba(0,0,0,.7); animation:hcmUp .22s cubic-bezier(.22,1,.36,1); }
  .hc-sc-ic{ font-size:26px; line-height:1; }
  .hc-sc-card > b{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:13px; letter-spacing:.08em; color:#ffe1a6; }
  .hc-sc-card > em{ font-style:normal; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:11.5px; color:var(--tc,#ffb84d); }
  .hc-sc-card > p{ margin:0; font-family:'Rajdhani',sans-serif; font-weight:600; font-size:12.5px; color:#b8a887; line-height:1.45; }
  .hc-sc-card > p b{ color:#7ce0a0; }
  .hc-sc-sal{ font-family:'Rajdhani',sans-serif; font-weight:800; font-size:13px; color:#ffd24d; background:rgba(255,210,77,.07); border:1px solid #33280f; border-radius:10px; padding:8px; }
  .hc-sc-btns{ display:flex; gap:8px; margin-top:4px; }
  .hc-sc-btns button{ flex:1; border-radius:10px; padding:10px; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:12px; letter-spacing:.04em; cursor:pointer; }
  #hc-sc-no{ border:1px solid #4d3c14; background:none; color:#b89d6e; }
  #hc-sc-yes{ border:1px solid #6b2a2a; background:linear-gradient(180deg,#4a1d1d,#2c1010); color:#ff9d9d; }
  #hc-sc-yes:active,#hc-sc-no:active{ transform:scale(.96); }
  .hc-tc{ background:linear-gradient(180deg,#171307,#100d08); border:1px solid #33280f; border-left:3px solid var(--tc); border-radius:11px; padding:10px 11px; display:flex; flex-direction:column; gap:5px; }
  .hc-tc.locked{ opacity:.55; }
  .hc-tc-h{ display:flex; align-items:center; gap:7px; }
  .hc-tc-h span{ font-size:15px; }
  .hc-tc-h b{ font-family:'Rajdhani',sans-serif; font-weight:800; font-size:13.5px; color:#f2d9ac; flex:1; }
  .hc-tc-h em{ font-style:normal; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:10.5px; color:var(--tc); }
  .hc-tc p{ font-family:'Rajdhani',sans-serif; font-weight:600; font-size:12px; color:#b8a887; line-height:1.4; margin:0; }
  .hc-bp-back-btn{ align-self:flex-start; border:1px solid #4d3c14; background:none; color:#b89d6e; border-radius:8px; padding:6px 10px; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:11px; cursor:pointer; }
  .hc-bp-cit{ display:flex; align-items:center; gap:10px; background:linear-gradient(115deg,#2a1e0a,#171008 70%); border:1px solid rgba(255,209,140,.5); border-radius:11px; padding:9px 11px; }
  .hc-bp-cit > div{ flex:1; min-width:0; }
  .hc-bp-cit b{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:11px; color:#ffe1a6; display:block; }
  .hc-bp-cit span{ font-family:'Rajdhani',sans-serif; font-weight:600; font-size:11px; color:#c9b898; }
  .hc-twsum{ font-family:'Rajdhani',sans-serif; font-weight:700; font-size:12.5px; color:#c9b898; background:linear-gradient(180deg,#171307,#100d08); border:1px solid #33280f; border-radius:11px; padding:9px 11px; line-height:1.45; }
  .hc-twsum b{ color:#ffe1a6; } .hc-twsum i{ color:#b89d6e; font-size:11.5px; }
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

  // ---- BOOT (must stay LAST) ------------------------------------------------
  // boot() reads the CSS const declared above it; calling it from the module body
  // hit the temporal dead zone and aborted the script before window exports ran,
  // so the screen silently painted nothing on a late parse. Keep this at the end.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  setTimeout(boot, 1200);
})();
