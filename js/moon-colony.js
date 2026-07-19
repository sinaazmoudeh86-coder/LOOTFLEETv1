/* =============================================================================
   moon-colony.js — MOON COLONY (Command ▸ Moon Colony) · unlocks at Level 20
   ---------------------------------------------------------------------------
   v3 — MULTI-MOON MINING EMPIRE + DEFENSE CONSEQUENCES
   • Card-list management UI with the live diorama panel up top (the view
     zooms out as your colony sprawls wider — see moon-scene.js).
   • MULTIPLE MOONS: fully terraform a moon (all 6 sectors) to unlock the
     next one. Each moon is resource-biased (Ferra=iron, Cryos=fuel, Ion=
     plasma, Prisma=prism) and runs its own colony, raids and events.
   • DEFENSE MATTERS: every raid rolls attack power vs your defense rating.
     Underdefended colonies get structures KNOCKED OFFLINE — damaged
     buildings produce nothing and defend nothing until you pay to repair.
   Reads the engine only via window.GAME — no game mechanics touched.
============================================================================= */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let G = null;

  // ---------------------------------------------------------------------------
  // BALANCE
  // ---------------------------------------------------------------------------
  // ENDLESS UPGRADES: no level cap. Cost grows 1.35×/level forever while output
  // grows only ~lv^1.12 — so each level buys less than the last and deep
  // upgrades become a pure prestige sink. The math itself enforces the
  // diminishing returns; players decide when it stops being worth it.
  const LV_MAX = Infinity;
  const SECTORS = [
    { name: 'Landing Basin',   slots: 3, cost: null },
    { name: 'Mare Ironshade',  slots: 3, cost: { gold: 8000,   fuel: 400,   iron: 250 } },
    { name: 'Crater Fields',   slots: 4, cost: { gold: 30000,  fuel: 1500,  iron: 900,  plasma: 500 } },
    { name: 'The Deep Rille',  slots: 4, cost: { gold: 120000, fuel: 6000,  iron: 3500, plasma: 2200 } },
    { name: 'Farside Reach',   slots: 4, cost: { gold: 500000, fuel: 25000, iron: 15000, plasma: 9000 } },
    { name: 'Umbra Prime',     slots: 4, cost: { gold: 2000000, fuel: 100000, iron: 60000, plasma: 40000 } },
  ];
  // THE MOON CHAIN — terraform all sectors of a moon to unlock the next.
  const MOONCAT = [
    { key: 'luna',   name: 'Luna Prime', hue: 215, bias: {},                          cost: null,
      blurb: 'Your first foothold. Balanced deposits.' },
    { key: 'ferra',  name: 'Ferra',      hue: 28,  bias: { iron: 1.7 },               cost: { gold: 900000,  fuel: 40000,  iron: 25000, plasma: 15000 },
      blurb: 'A rust-red husk laced with ◆ iron veins · +70% iron.' },
    { key: 'cryos',  name: 'Cryos',      hue: 190, bias: { fuel: 1.9 },               cost: { gold: 4000000, fuel: 150000, iron: 90000, plasma: 60000 },
      blurb: 'A frozen shard of ⬢ fuel ice · +90% fuel.' },
    { key: 'ion',    name: 'Ion',        hue: 275, bias: { plasma: 1.9 },             cost: { gold: 15000000, fuel: 600000, iron: 350000, plasma: 220000 },
      blurb: 'A storm-wracked moon crackling with ✦ plasma · +90% plasma.' },
    { key: 'prisma', name: 'Prisma',     hue: 350, bias: { prism: 2.2, gold: 1.4 },   cost: { gold: 80000000, fuel: 2500000, iron: 1500000, plasma: 1000000 },
      blurb: 'The crown jewel — ◈ prism crystal to the core · 2.2× prism, +40% gold.' },
  ];
  const B = {
    oremine:  { name: 'Ore Mine',        ic: '⛏', cat: 'mine',    out: 'iron',   rate: 140, cost: { gold: 1500, fuel: 80 },              desc: 'Extracts ◆ iron from the regolith.' },
    fuelwell: { name: 'Fuel Well',       ic: '⛽', cat: 'mine',    out: 'fuel',   rate: 200, cost: { gold: 1200, iron: 60 },              desc: 'Taps ⬢ fuel ice pockets.' },
    plasmarig:{ name: 'Plasma Rig',      ic: '⚡', cat: 'mine',    out: 'plasma', rate: 90, cost: { gold: 2500, fuel: 150, iron: 100 },  desc: 'Condenses ✦ plasma from solar wind.', minSector: 1 },
    goldrig:  { name: 'Assay Plant',     ic: '⚖', cat: 'mine',    out: 'gold',   rate: 2600,cost: { gold: 4000, iron: 200 },             desc: 'Refines trace metals into $ gold.', minSector: 1 },
    prismex:  { name: 'Prism Extractor', ic: '◈', cat: 'mine',    out: 'prism',  rate: 6,cost: { gold: 400000, fuel: 20000, plasma: 8000 }, desc: 'Late-game: sifts ◈ prism fragments.', minSector: 4 },
    refinery: { name: 'Refinery',        ic: '⚗', cat: 'boost',   pct: 8,  cost: { gold: 6000, iron: 350 },                 desc: '+8%/lv colony-wide production.', minSector: 1 },
    drones:   { name: 'Cargo Drones',    ic: '⬡', cat: 'boost',   pct: 5,  cost: { gold: 3500, fuel: 250 },                 desc: '+5%/lv production · automation swarm.' },
    cargohub: { name: 'Cargo Hub',       ic: '▣', cat: 'storage', hrs: 2,  cost: { gold: 2500, iron: 150 },                 desc: '+2h/lv storage before production idles.' },
    laser:    { name: 'Laser Tower',     ic: '☄', cat: 'defense', def: 12, cost: { gold: 2000, iron: 120 },                 desc: 'Auto-defense · +12 rating/lv.' },
    shield:   { name: 'Shield Generator',ic: '◍', cat: 'defense', def: 20, cost: { gold: 9000, iron: 500, plasma: 250 },    desc: 'Heavy defense · +20 rating/lv.', minSector: 2 },
  };
  const CATS = [['mine','MINING'],['boost','PROCESSING & LOGISTICS'],['storage','STORAGE'],['defense','DEFENSE']];
  window.MOONDEFS = B;          // shared with moon-scene.js
  window.MOONSECTORS = SECTORS;
  window.MOONCAT = MOONCAT;
  const zScale = () => Math.max(1, Math.pow(Math.max(1, G.state.highestUnlocked || 1), 1.12));
  const upCost = (def, lv) => { const o = {}; Object.keys(def.cost).forEach((k) => o[k] = Math.round(def.cost[k] * Math.pow(1.35, lv))); return o; };
  const repairCost = (def, lv) => { const o = upCost(def, Math.max(0, lv - 1)); Object.keys(o).forEach((k) => o[k] = Math.round(o[k] * 0.5)); return o; };
  const tierOf = (lv) => lv >= 60 ? 5 : lv >= 25 ? 4 : lv >= 15 ? 3 : lv >= 8 ? 2 : 1;

  const EVENTS = [
    { id: 'vein',   w: 30, ic: '◆', name: 'Rich Ore Vein',      txt: '2× production for 2h',            mult: 2,    hrs: 2 },
    { id: 'meteor', w: 25, ic: '☄', name: 'Meteor Shower',      txt: 'Rare materials recovered!',       instant: true },
    { id: 'flare',  w: 20, ic: '☉', name: 'Solar Flare',        txt: '−25% production for 1h',          mult: 0.75, hrs: 1 },
    { id: 'prism',  w: 15, ic: '◈', name: 'Prism Deposit',      txt: 'Bonus prism fragments',           instantPrism: true },
    { id: 'ancient',w: 10, ic: '⌬', name: 'Ancient Technology', txt: '+2% permanent production (max +20%)', perm: true },
  ];

  // ---------------------------------------------------------------------------
  // STATE — s.moon = { cur, perm, lifetime, moons:[colony…] }
  // ---------------------------------------------------------------------------
  const raidGap = () => (4 + Math.random() * 4) * 3600e3;
  const newColony = () => ({ sectors: 1, b: {}, lastCollect: Date.now(),
    stored: { gold: 0, fuel: 0, iron: 0, plasma: 0, prism: 0 }, nextRaid: Date.now() + raidGap(), log: [], buff: null });
  function ensure() {
    const s = G.state;
    if (!s.moon) {
      s.moon = { cur: 0, perm: 0, lifetime: { gold: 0, fuel: 0, iron: 0, plasma: 0, prism: 0 }, moons: [newColony()] };
      G.save();
    } else if (!s.moon.moons) {
      // MIGRATE v1/v2 flat colony → multi-moon shape
      const old = s.moon;
      s.moon = { cur: 0, perm: old.perm || 0, lifetime: old.lifetime || { gold: 0, fuel: 0, iron: 0, plasma: 0, prism: 0 },
        moons: [{ sectors: old.sectors || 1, b: old.b || {}, lastCollect: old.lastCollect || Date.now(),
          stored: old.stored || { gold: 0, fuel: 0, iron: 0, plasma: 0, prism: 0 },
          nextRaid: old.nextRaid || Date.now() + raidGap(), log: old.log || [], buff: old.buff || null }] };
      G.save();
    }
    if (s.moon.cur >= s.moon.moons.length) s.moon.cur = 0;
    return s.moon;
  }
  const cm = (root) => root.moons[root.cur];
  function logAdd(mm, txt) { mm.log.unshift({ t: Date.now(), txt }); if (mm.log.length > 12) mm.log.length = 12; }

  // ---------------------------------------------------------------------------
  // PRODUCTION — per-moon; damaged buildings produce & defend NOTHING
  // ---------------------------------------------------------------------------
  function buildings(mm) { return Object.entries(mm.b).map(([k, v]) => ({ key: k, def: B[v.kind], ...v })); }
  const active = (mm) => buildings(mm).filter((x) => x.def && !x.dmg);
  function prodBonus(root, mm) {
    let pct = root.perm || 0;
    active(mm).forEach((x) => { if (x.def.cat === 'boost') pct += x.def.pct * x.lv; });
    return 1 + pct / 100;
  }
  function storageHours(mm) { let h = 8; active(mm).forEach((x) => { if (x.def.cat === 'storage') h += x.def.hrs * x.lv; }); return Math.min(30, h); }
  function defenseRating(mm) { let d = 10; active(mm).forEach((x) => { if (x.def.cat === 'defense') d += x.def.def * x.lv; }); return d; }
  function raidPowerEst(mm) { return 10 + buildings(mm).reduce((a, x) => a + x.lv, 0) * 3 + 8; } // avg roll shown in UI
  function ratesPerHour(root, mi) {
    const mm = root.moons[mi];
    const bias = MOONCAT[mi] ? MOONCAT[mi].bias : {};
    const out = { gold: 0, fuel: 0, iron: 0, plasma: 0, prism: 0 };
    const bonus = prodBonus(root, mm), zs = zScale();
    const buffMult = (mm.buff && Date.now() < mm.buff.until) ? mm.buff.mult : 1;
    active(mm).forEach((x) => {
      if (x.def.cat !== 'mine') return;
      out[x.def.out] += x.def.rate * Math.pow(x.lv, 1.12) * (x.def.out === 'prism' ? 1 : zs) * (bias[x.def.out] || 1);
    });
    Object.keys(out).forEach((k) => out[k] *= bonus * buffMult);
    return out;
  }
  // accrual + raid resolution for ONE moon
  function accrueMoon(root, mi) {
    const mm = root.moons[mi];
    const now = Date.now();
    const dtH = Math.max(0, (now - mm.lastCollect) / 3600e3);
    const capH = storageHours(mm);
    const r = ratesPerHour(root, mi);
    const effH = Math.min(dtH, capH);
    Object.keys(mm.stored).forEach((k) => { mm.stored[k] = (r[k] || 0) * effH; });
    mm._idle = dtH >= capH;
    if (now > mm.nextRaid && buildings(mm).length) {
      const rating = defenseRating(mm);
      const colonyLv = buildings(mm).reduce((a, x) => a + x.lv, 0);
      const power = 10 + colonyLv * 3 + Math.random() * 15;
      const ratio = Math.min(1, rating / power);
      const mname = (MOONCAT[mi] || {}).name || 'your moon';
      if (ratio >= 1) {
        Object.keys(mm.stored).forEach((k) => mm.stored[k] *= 1.15);
        logAdd(mm, '🛡 Raid on ' + mname + ' repelled (' + Math.round(rating) + ' vs ' + Math.round(power) + '). +15% stored output salvaged.');
      } else {
        // PUNISHMENT — the raid breaks through: skim loot AND knock systems offline
        const loss = (1 - ratio) * 0.3;
        Object.keys(mm.stored).forEach((k) => mm.stored[k] *= 1 - loss);
        const targets = buildings(mm).filter((x) => !x.dmg && x.def.cat !== 'defense');
        const nHit = Math.min(targets.length, 1 + Math.floor((1 - ratio) * 3));
        const hit = [];
        for (let i = 0; i < nHit && targets.length; i++) {
          const j = Math.floor(Math.random() * targets.length);
          const tg = targets.splice(j, 1)[0];
          mm.b[tg.key].dmg = 1; hit.push(tg.def.name);
        }
        logAdd(mm, '☠ Raid BREACHED ' + mname + ' (' + Math.round(rating) + ' vs ' + Math.round(power) + '). ' +
          Math.round(loss * 100) + '% of stored output looted' + (hit.length ? ' — ' + hit.join(', ') + ' knocked OFFLINE. Repair required.' : '.'));
      }
      mm.nextRaid = now + raidGap();
      G.save();
    }
  }
  function accrueAll(root) { root.moons.forEach((_, i) => accrueMoon(root, i)); }
  const damagedCount = (mm) => buildings(mm).filter((x) => x.dmg).length;

  // ---------------------------------------------------------------------------
  // ACTIONS
  // ---------------------------------------------------------------------------
  function canAfford(cost) {
    const s = G.state, r = s.resources || {};
    return (!cost.gold || s.gold >= cost.gold) && (!cost.fuel || r.fuel >= cost.fuel) &&
           (!cost.iron || r.iron >= cost.iron) && (!cost.plasma || r.plasma >= cost.plasma);
  }
  function pay(cost) {
    const s = G.state; if (!s.resources) s.resources = { fuel: 0, iron: 0, plasma: 0 };
    if (cost.gold) s.gold -= cost.gold;
    if (cost.fuel) s.resources.fuel -= cost.fuel;
    if (cost.iron) s.resources.iron -= cost.iron;
    if (cost.plasma) s.resources.plasma -= cost.plasma;
  }
  function collectAll() {
    const root = ensure(); accrueAll(root);
    const s = G.state;
    if (!s.resources) s.resources = { fuel: 0, iron: 0, plasma: 0 };
    const got = { gold: 0, fuel: 0, iron: 0, plasma: 0, prism: 0 };
    root.moons.forEach((mm) => {
      Object.keys(got).forEach((k) => got[k] += Math.floor(mm.stored[k] || 0));
      mm.lastCollect = Date.now();
      Object.keys(mm.stored).forEach((k) => mm.stored[k] = 0);
    });
    s.gold += got.gold; s.resources.fuel += got.fuel; s.resources.iron += got.iron; s.resources.plasma += got.plasma;
    if (got.prism > 0 && s.prism) s.prism.ingots = (s.prism.ingots || 0) + got.prism;
    Object.keys(got).forEach((k) => root.lifetime[k] += got[k]);
    // event roll — on the CURRENT moon
    let evHtml = '';
    const mm = cm(root);
    if (got.gold + got.fuel + got.iron + got.plasma > 50 && Math.random() < 0.25) {
      const tot = EVENTS.reduce((a, e) => a + e.w, 0); let roll = Math.random() * tot, ev = EVENTS[0];
      for (const e of EVENTS) { roll -= e.w; if (roll <= 0) { ev = e; break; } }
      if (ev.mult) mm.buff = { mult: ev.mult, until: Date.now() + ev.hrs * 3600e3, name: ev.name, ic: ev.ic };
      else if (ev.instant) { const zs = zScale(); s.resources.iron += Math.round(150 * zs); s.resources.plasma += Math.round(80 * zs); }
      else if (ev.instantPrism && s.prism) s.prism.ingots = (s.prism.ingots || 0) + 3;
      else if (ev.perm && root.perm < 20) root.perm += 2;
      logAdd(mm, ev.ic + ' ' + ev.name + ' — ' + ev.txt);
      evHtml = ev.ic + ' ' + ev.name;
    }
    G.save(); if (window.UI) window.UI.refreshAll();
    return { got, evHtml };
  }
  function build(mm, sec, idx, kind) {
    const def = B[kind]; if (!def) return false;
    const cost = upCost(def, 0);
    if (!canAfford(cost)) return false;
    pay(cost); mm.b[sec + ':' + idx] = { kind, lv: 1 };
    logAdd(mm, def.ic + ' ' + def.name + ' constructed in ' + SECTORS[sec].name + '.');
    G.save(); return true;
  }
  function upgrade(mm, key) {
    const bd = mm.b[key]; if (!bd || bd.dmg || bd.lv >= LV_MAX) return false;
    const cost = upCost(B[bd.kind], bd.lv);
    if (!canAfford(cost)) return false;
    pay(cost); bd.lv++;
    if (bd.lv === 8 || bd.lv === 15 || bd.lv === 25) logAdd(mm, B[bd.kind].ic + ' ' + B[bd.kind].name + ' evolved — Tier ' + tierOf(bd.lv) + '.');
    G.save(); return true;
  }
  function repair(mm, key) {
    const bd = mm.b[key]; if (!bd || !bd.dmg) return false;
    const cost = repairCost(B[bd.kind], bd.lv);
    if (!canAfford(cost)) return false;
    pay(cost); delete bd.dmg;
    logAdd(mm, '🔧 ' + B[bd.kind].name + ' repaired — back online.');
    G.save(); return true;
  }
  // DEMOLISH — tear a structure down to free the slot for a different build.
  // Salvage refunds 40% of everything invested (25% if it's raid-damaged).
  function investedCost(def, lv) {
    const o = {};
    for (let l = 0; l < lv; l++) { const c = upCost(def, l); Object.keys(c).forEach((k) => o[k] = (o[k] || 0) + c[k]); }
    return o;
  }
  function salvageValue(bd) {
    const o = investedCost(B[bd.kind], bd.lv);
    const pct = bd.dmg ? 0.25 : 0.4;
    Object.keys(o).forEach((k) => o[k] = Math.floor(o[k] * pct));
    return o;
  }
  function demolish(mm, key) {
    const bd = mm.b[key]; if (!bd) return false;
    const ref = salvageValue(bd);
    const s = G.state; if (!s.resources) s.resources = { fuel: 0, iron: 0, plasma: 0 };
    s.gold += ref.gold || 0; s.resources.fuel += ref.fuel || 0; s.resources.iron += ref.iron || 0; s.resources.plasma += ref.plasma || 0;
    logAdd(mm, '💥 ' + B[bd.kind].name + ' (Lv ' + bd.lv + ') demolished — slot cleared, salvage recovered.');
    delete mm.b[key];
    G.save(); if (window.UI) window.UI.refreshAll();
    return true;
  }
  function expand(mm) {
    if (mm.sectors >= SECTORS.length) return false;
    const cost = SECTORS[mm.sectors].cost;
    if (!canAfford(cost)) return false;
    pay(cost); mm.sectors++;
    logAdd(mm, '⌬ ' + SECTORS[mm.sectors - 1].name + ' terraformed — ' + SECTORS[mm.sectors - 1].slots + ' new build slots.');
    G.save(); return true;
  }
  function buyMoon() {
    const root = ensure();
    const nx = MOONCAT[root.moons.length]; if (!nx) return false;
    const prev = root.moons[root.moons.length - 1];
    if (prev.sectors < SECTORS.length) return false;
    if (!canAfford(nx.cost)) return false;
    pay(nx.cost);
    root.moons.push(newColony());
    root.cur = root.moons.length - 1;
    logAdd(cm(root), '🌙 ' + nx.name + ' claimed — a new frontier opens.');
    G.save(); return true;
  }

  // ---------------------------------------------------------------------------
  // SMART UPGRADE — plans a balanced wave of work on the CURRENT moon with the
  // resources on hand: repairs first, then defense up to the raid requirement,
  // then spread-the-levels round-robin (lowest level first, cheapest on ties).
  // Returns { steps, agg, total, count } — nothing is spent until applied.
  // ---------------------------------------------------------------------------
  function planSmart(root, mm) {
    const s = G.state, r = s.resources || {};
    const budget = { gold: s.gold || 0, fuel: r.fuel || 0, iron: r.iron || 0, plasma: r.plasma || 0 };
    const fits = (c) => Object.keys(c).every((k) => (budget[k] || 0) >= c[k]);
    const take = (c, total) => Object.keys(c).forEach((k) => { budget[k] -= c[k]; total[k] = (total[k] || 0) + c[k]; });
    const sim = {};   // key → simulated level
    buildings(mm).forEach((x) => sim[x.key] = x.lv);
    const dmg = {};   // key → still damaged in sim
    buildings(mm).forEach((x) => { if (x.dmg) dmg[x.key] = true; });
    const steps = [], total = {};

    // 1 · REPAIRS — offline structures produce & defend nothing
    buildings(mm).forEach((x) => {
      if (!x.dmg) return;
      const c = repairCost(B[x.kind], x.lv);
      if (fits(c)) { take(c, total); steps.push({ type: 'fix', key: x.key, kind: x.kind }); delete dmg[x.key]; }
    });

    // helper — next upgrade candidates (never damaged-in-sim, never past LV_MAX)
    const candidates = (filter) => buildings(mm)
      .filter((x) => !dmg[x.key] && sim[x.key] < LV_MAX && (!filter || filter(x)))
      .map((x) => ({ x, c: upCost(B[x.kind], sim[x.key]) }));

    // 2 · DEFENSE — close the raid gap before anything else
    let defR = defenseRating(mm) ;
    // recompute with repaired defenses back online
    defR = 10 + buildings(mm).filter((x) => x.def.cat === 'defense' && !dmg[x.key]).reduce((a, x) => a + x.def.def * sim[x.key], 0);
    const needR = raidPowerEst(mm);
    let guard = 0;
    while (defR < needR && guard++ < 30) {
      const list = candidates((x) => x.def.cat === 'defense').filter((o) => fits(o.c))
        .sort((a, b) => sim[a.x.key] - sim[b.x.key] || a.c.gold - b.c.gold);
      if (!list.length) break;
      const o = list[0];
      take(o.c, total); steps.push({ type: 'up', key: o.x.key, kind: o.x.kind });
      sim[o.x.key]++; defR += o.x.def.def;
    }

    // 3 · BALANCED SPREAD — lowest simulated level first, cheapest on ties
    guard = 0;
    while (guard++ < 80) {
      const list = candidates().filter((o) => fits(o.c))
        .sort((a, b) => sim[a.x.key] - sim[b.x.key] || (a.c.gold || 0) - (b.c.gold || 0));
      if (!list.length) break;
      const o = list[0];
      take(o.c, total); steps.push({ type: 'up', key: o.x.key, kind: o.x.kind });
      sim[o.x.key]++;
    }

    // aggregate for display: key → { def, from, to, fixed }
    const agg = {};
    steps.forEach((st) => {
      const bd = mm.b[st.key]; if (!bd) return;
      if (!agg[st.key]) agg[st.key] = { def: B[st.kind], from: bd.lv, to: bd.lv, fixed: false };
      if (st.type === 'fix') agg[st.key].fixed = true; else agg[st.key].to++;
    });
    return { steps, agg, total, count: steps.length };
  }
  function applySmart(mm, plan) {
    let done = 0;
    for (const st of plan.steps) {
      const ok = st.type === 'fix' ? repair(mm, st.key) : upgrade(mm, st.key);
      if (ok) done++;
    }
    if (done) logAdd(mm, '⚙ Smart Upgrade — ' + done + ' operations completed across the colony.');
    G.save(); if (window.UI) window.UI.refreshAll();
    return done;
  }

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------
  const fN = (v) => G.formatNum(Math.floor(v));
  const costChips = (cost) => {
    const s = G.state, r = s.resources || {};
    const chip = (glyph, col, need, have) => need ? '<span style="color:' + (have >= need ? col : 'var(--bad,#e23b4e)') + '">' + glyph + ' ' + fN(need) + '</span>' : '';
    return [chip('$', '#f2a93c', cost.gold, s.gold), chip('⬢', '#5bc0ff', cost.fuel, r.fuel || 0),
            chip('◆', '#d0a060', cost.iron, r.iron || 0), chip('✦', '#c07bff', cost.plasma, r.plasma || 0)].filter(Boolean).join(' &nbsp;');
  };
  function colonyTitle(mm, mi) {
    const tot = buildings(mm).reduce((a, x) => a + x.lv, 0);
    const stage = tot >= 120 ? 4 : tot >= 60 ? 3 : tot >= 20 ? 2 : 1;
    const label = ['', 'FRONTIER OUTPOST', 'GROWING COLONY', 'INDUSTRIAL COLONY', 'MINING METROPOLIS'][stage];
    return [(MOONCAT[mi] ? MOONCAT[mi].name.toUpperCase() + ' · ' : '') + label, stage];
  }
  function render() {
    const body = $('moon-body'); if (!body) return;
    body.classList.remove('mn-full');
    const root = ensure(); accrueAll(root);
    const mi = root.cur, mm = cm(root);
    const r = ratesPerHour(root, mi);
    const [title, stage] = colonyTitle(mm, mi);
    const capH = storageHours(mm), defR = defenseRating(mm), needR = raidPowerEst(mm);
    const buffOn = mm.buff && Date.now() < mm.buff.until;
    const dmgN = damagedCount(mm);
    const sub = $('moon-sub'); if (sub) sub.textContent = root.moons.length + '/' + MOONCAT.length + ' moons · ' + mm.sectors + '/' + SECTORS.length + ' sectors';
    // totals across ALL moons for the collect card
    const allStored = { gold: 0, fuel: 0, iron: 0, plasma: 0, prism: 0 };
    root.moons.forEach((m2) => Object.keys(allStored).forEach((k) => allStored[k] += m2.stored[k] || 0));
    const storedTotal = Object.values(allStored).reduce((a, v) => a + v, 0);

    let html = '<div class="mn-stage stage' + stage + '"><canvas id="mn-scene-cv"></canvas>' +
      '<div class="mn-stage-ov"><div class="mn-title">' + title + '</div>' +
      '<div class="mn-stats"><span>⚙ +' + Math.round((prodBonus(root, mm) - 1) * 100) + '%<i>boost</i></span><span style="color:' + (defR >= needR ? '' : '#ff8f9c') + '">🛡 ' + Math.round(defR) + '<i>defense</i></span><span>▣ ' + capH + 'h<i>storage</i></span></div></div>' +
      ((buffOn || root.perm || dmgN) ? '<div class="mn-stage-tags">' +
        (dmgN ? '<span class="mn-dmgtag">⚠ ' + dmgN + ' OFFLINE</span>' : '') +
        (buffOn ? '<span class="mn-buff">' + mm.buff.ic + ' ' + mm.buff.name + '</span>' : '') +
        (root.perm ? '<span class="mn-perm">⌬ +' + root.perm + '%</span>' : '') + '</div>' : '') +
      '</div>';

    // MOON TABS
    html += '<div class="mn-moons">';
    root.moons.forEach((m2, i) => {
      const mc = MOONCAT[i];
      const pend = Object.values(m2.stored).reduce((a, v) => a + v, 0) > 1;
      const dmg2 = damagedCount(m2);
      html += '<button class="mn-mtab ' + (i === mi ? 'on' : '') + '" data-mn-moon="' + i + '" style="--mh:' + mc.hue + '">' +
        '<span class="mn-morb"></span>' + mc.name +
        (dmg2 ? '<i class="mn-mdot bad">⚠</i>' : pend ? '<i class="mn-mdot">●</i>' : '') + '</button>';
    });
    if (root.moons.length < MOONCAT.length) {
      const nx = MOONCAT[root.moons.length];
      const ready = root.moons[root.moons.length - 1].sectors >= SECTORS.length;
      html += '<button class="mn-mtab lock ' + (ready ? 'ready' : '') + '" data-mn-newmoon style="--mh:' + nx.hue + '"><span class="mn-morb"></span>' + (ready ? '+ ' + nx.name : '🔒 ' + nx.name) + '</button>';
    }
    html += '</div>';

    // FIRST-VISIT starter callout — orient the player before the card list
    if (!Object.keys(mm.b).length) {
      html += '<div class="mn-start"><div class="mn-start-t">⛏ ESTABLISH YOUR COLONY</div>' +
        '<div class="mn-start-s">1 · Tap a <b>+ BUILD</b> slot below and place a mine — it produces <b>even while you\'re offline</b>.<br>' +
        '2 · Add a <b>☄ Laser Tower</b> early: pirates raid every few hours and <b>under-defended systems get knocked offline</b>.<br>' +
        '3 · Return, hit <b>COLLECT</b>, upgrade, expand. Fully terraform this moon to unlock the next one.</div></div>';
    }
    // COLLECT (all moons)
    html += '<div class="mn-collect ' + (mm._idle ? 'idle' : '') + '"><div class="mn-c-l">' +
      '<div class="mn-c-t">' + (mm._idle ? '⚠ STORAGE FULL — production idle' : (root.moons.length > 1 ? 'ALL MOONS — ACCUMULATED' : 'ACCUMULATED PRODUCTION')) + '</div>' +
      '<div class="mn-c-rows">' +
      (allStored.gold >= 1 ? '<span style="color:#f2a93c">$ ' + fN(allStored.gold) + '</span>' : '') +
      (allStored.fuel >= 1 ? '<span style="color:#5bc0ff">⬢ ' + fN(allStored.fuel) + '</span>' : '') +
      (allStored.iron >= 1 ? '<span style="color:#d0a060">◆ ' + fN(allStored.iron) + '</span>' : '') +
      (allStored.plasma >= 1 ? '<span style="color:#c07bff">✦ ' + fN(allStored.plasma) + '</span>' : '') +
      (allStored.prism >= 1 ? '<span style="color:#ff5a5a">◈ ' + fN(allStored.prism) + '</span>' : '') +
      (storedTotal < 1 ? '<span style="color:#6c8098">production ticking…</span>' : '') + '</div>' +
      '<div class="mn-c-rate">' + (MOONCAT[mi].name) + ': +' + fN(r.gold) + ' $/h · +' + fN(r.fuel) + ' ⬢/h · +' + fN(r.iron) + ' ◆/h · +' + fN(r.plasma) + ' ✦/h' + (r.prism > 0 ? ' · +' + r.prism.toFixed(1) + ' ◈/h' : '') + '</div>' +
      (function () { // time-to-full readout — tells the player when to come back
        if (mm._idle) return '<div class="mn-c-full" style="color:#ffcf7a">⏳ Storage saturated — collect to restart production</div>';
        const leftH = Math.max(0, capH - (Date.now() - mm.lastCollect) / 3600e3);
        if (leftH > capH - 0.02) return '';
        return '<div class="mn-c-full">▣ Storage full in <b>' + Math.floor(leftH) + 'h ' + Math.round((leftH % 1) * 60) + 'm</b></div>';
      })() + '</div>' +
      '<button class="mn-c-btn" data-mn-collect ' + (storedTotal < 1 ? 'disabled' : '') + '>' + (root.moons.length > 1 ? 'COLLECT ALL' : 'COLLECT') + '</button></div>';

    // RAID / DEFENSE STATUS — shows the requirement explicitly
    const raidIn = Math.max(0, mm.nextRaid - Date.now());
    const under = defR < needR;
    html += '<div class="mn-raid ' + (under ? 'danger' : '') + '"><span>☠ Raid in <b>' + Math.floor(raidIn / 3600e3) + 'h ' + Math.floor((raidIn % 3600e3) / 60e3) + 'm</b></span>' +
      '<span>🛡 <b style="color:' + (under ? '#ff8f9c' : '#7ce0a0') + '">' + Math.round(defR) + '</b> / ~' + Math.round(needR) + ' needed' + (under ? ' — <b style="color:#ff8f9c">systems WILL be knocked offline</b>' : '') + '</span></div>';

    // SMART UPGRADE — one tap plans a balanced wave with what you have
    if (buildings(mm).length) {
      const sp = planSmart(root, mm);
      const on = sp.count > 0;
      html += '<button data-mn-smart ' + (on ? '' : 'disabled') + ' style="width:100%;margin:0 0 10px;display:flex;align-items:center;gap:12px;text-align:left;cursor:' + (on ? 'pointer' : 'default') + ';' +
        'background:linear-gradient(180deg,#0d2418,#0a1710);border:1px solid ' + (on ? 'rgba(124,224,160,.55)' : '#22334a') + ';border-radius:13px;padding:11px 13px;' +
        (on ? 'box-shadow:0 0 18px -8px rgba(124,224,160,.8);' : 'opacity:.55;') + '">' +
        '<span style="flex:none;width:38px;height:38px;display:grid;place-items:center;border-radius:10px;background:rgba(124,224,160,.12);border:1px solid rgba(124,224,160,.4);font-size:17px">⚙</span>' +
        '<span style="flex:1;min-width:0">' +
          '<span style="display:block;font-family:\'Orbitron\',sans-serif;font-weight:800;font-size:12px;letter-spacing:.08em;color:#9df0bb">SMART UPGRADE</span>' +
          '<span style="display:block;font-size:10.5px;font-weight:700;color:#8fa8bd;margin-top:2px">' +
            (on ? sp.count + ' ops · repairs → defense → lowest levels' : 'nothing affordable right now') + '</span>' +
          (on ? '<span style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">' +
            costChips(sp.total).split(' &nbsp;').map((c) => '<span style="background:#0b1119;border:1px solid #26364c;border-radius:7px;padding:3px 8px;font-size:11px;font-weight:800;font-variant-numeric:tabular-nums">' + c + '</span>').join('') +
          '</span>' : '') +
        '</span>' +
        (on ? '<span style="flex:none;font-family:\'Orbitron\',sans-serif;font-weight:800;font-size:10px;letter-spacing:.06em;color:#08131c;background:linear-gradient(180deg,#9df0bb,#5fd68b);border-radius:9px;padding:8px 12px">REVIEW ▸</span>' : '') +
      '</button>';
    }

    // SECTORS of the current moon
    for (let sec = 0; sec < mm.sectors; sec++) {
      const sd = SECTORS[sec];
      const built = Array.from({ length: sd.slots }, (_, j) => mm.b[sec + ':' + j]).filter(Boolean).length;
      html += '<div class="mn-sec"><div class="mn-sec-h"><span class="mn-sec-n">⌬ ' + sd.name + '</span><span class="mn-sec-s"><b>' + built + '/' + sd.slots + '</b> built · sector ' + (sec + 1) + '</span></div><div class="mn-slots">';
      for (let i = 0; i < sd.slots; i++) {
        const key = sec + ':' + i, bd = mm.b[key];
        if (bd) {
          const def = B[bd.kind], tier = tierOf(bd.lv), maxed = bd.lv >= LV_MAX;
          if (bd.dmg) {
            const rc = repairCost(def, bd.lv);
            html += '<div class="mn-b dmg"><div class="mn-b-ic">' + def.ic + '</div>' +
              '<div class="mn-b-m"><div class="mn-b-n">' + def.name + ' <span class="mn-b-lv">Lv ' + bd.lv + '</span><span class="mn-b-off">⚠ OFFLINE</span></div>' +
              '<div class="mn-b-d">Knocked out in a raid — produces &amp; defends nothing until repaired.</div>' +
              '<div class="mn-b-cost">' + costChips(rc) + '</div></div>' +
              '<div class="mn-b-btns"><button class="mn-b-up fix" data-mn-fix="' + key + '" ' + (canAfford(rc) ? '' : 'disabled') + '>🔧</button>' +
              '<button class="mn-b-del" data-mn-del="' + key + '" title="Demolish">✕</button></div></div>';
          } else {
            const cost = maxed ? null : upCost(def, bd.lv);
            const bias = MOONCAT[mi].bias || {};
            html += '<div class="mn-b t' + tier + '"><div class="mn-b-ic">' + def.ic + '</div>' +
              '<div class="mn-b-m"><div class="mn-b-n">' + def.name + ' <span class="mn-b-lv">Lv ' + bd.lv + '</span>' + (tier > 1 ? '<span class="mn-b-tier">T' + tier + '</span>' : '') + '</div>' +
              '<div class="mn-b-d">' + (def.cat === 'mine' ? '+' + fN(def.rate * Math.pow(bd.lv, 1.12) * (def.out === 'prism' ? 1 : zScale()) * (bias[def.out] || 1) * prodBonus(root, mm)) + ' ' + ({ gold: '$', fuel: '⬢', iron: '◆', plasma: '✦', prism: '◈' })[def.out] + '/h' : def.desc) + '</div>' +
              (maxed ? '<div class="mn-b-max">★ MAX — industrial complex</div>' : '<div class="mn-b-cost">' + costChips(cost) + '</div>') + '</div>' +
              '<div class="mn-b-btns">' + (maxed ? '' : '<button class="mn-b-up" data-mn-up="' + key + '" ' + (canAfford(cost) ? '' : 'disabled') + '>▲</button>') +
              '<button class="mn-b-del" data-mn-del="' + key + '" title="Demolish">✕</button></div></div>';
          }
        } else {
          html += '<button class="mn-slot" data-mn-slot="' + key + '">+ BUILD</button>';
        }
      }
      html += '</div></div>';
    }
    // EXPANSION
    if (mm.sectors < SECTORS.length) {
      const nx = SECTORS[mm.sectors];
      html += '<div class="mn-expand"><div class="mn-b-m"><div class="mn-b-n">⌬ Terraform ' + nx.name + '</div>' +
        '<div class="mn-b-d">' + nx.slots + ' new build slots · richer deposits</div><div class="mn-b-cost">' + costChips(nx.cost) + '</div></div>' +
        '<button class="mn-b-up wide" data-mn-expand ' + (canAfford(nx.cost) ? '' : 'disabled') + '>TERRAFORM</button></div>';
    } else if (root.moons.length < MOONCAT.length && mi === root.moons.length - 1) {
      // moon fully terraformed → pitch the next moon
      const nx = MOONCAT[root.moons.length];
      html += '<div class="mn-expand moon"><div class="mn-b-m"><div class="mn-b-n">🌙 Claim ' + nx.name + '</div>' +
        '<div class="mn-b-d">' + nx.blurb + '</div><div class="mn-b-cost">' + costChips(nx.cost) + '</div></div>' +
        '<button class="mn-b-up wide" data-mn-newmoon ' + (canAfford(nx.cost) ? '' : 'disabled') + '>LAUNCH</button></div>';
    }
    // LOG
    if (mm.log.length) {
      html += '<div class="mn-log"><div class="mn-log-t">COLONY LOG — ' + MOONCAT[mi].name.toUpperCase() + '</div>' + mm.log.map((l) => '<div class="mn-log-r"><span>' + new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</span>' + l.txt + '</div>').join('') + '</div>';
    }
    // keep the player's scroll position through re-renders (no jump-to-top "reload" feel)
    let _sc = body; while (_sc && _sc !== document.documentElement && _sc.scrollHeight <= _sc.clientHeight + 4) _sc = _sc.parentElement;
    const _st = _sc ? _sc.scrollTop : 0;
    // FLICKER GUARD — keep the LIVE diorama canvas across re-renders (upgrades
    // re-render the card list; remounting the scene made the whole screen flash).
    const _oldCv = $('mn-scene-cv');
    body.innerHTML = html;
    const _newCv = $('mn-scene-cv');
    if (_oldCv && _newCv && window.MOONSCENE) {
      _newCv.replaceWith(_oldCv);                       // same canvas, same GL/2D context — no restart
      if (window.MOONSCENE.refresh) window.MOONSCENE.refresh();
    } else if (window.MOONSCENE) {
      window.MOONSCENE.mount($('mn-scene-cv'));
    }
    wire(body, root, mm);
    if (_sc) _sc.scrollTop = _st;
  }
  function wire(body, root, mm) {
    const btn = body.querySelector('[data-mn-collect]');
    if (btn) btn.addEventListener('click', () => {
      const { got, evHtml } = collectAll();
      const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#9ecfff';
      t.innerHTML = '🌙 COLONY SHIPMENT<br><span style="font-size:13px;color:#d8e8fa">' +
        [got.gold ? '$ ' + fN(got.gold) : '', got.fuel ? '⬢ ' + fN(got.fuel) : '', got.iron ? '◆ ' + fN(got.iron) : '', got.plasma ? '✦ ' + fN(got.plasma) : '', got.prism ? '◈ ' + fN(got.prism) : ''].filter(Boolean).join(' · ') + '</span>' +
        (evHtml ? '<br><span style="font-size:12px;color:#ffd24d">' + evHtml + '</span>' : '');
      $('toast-layer').appendChild(t); setTimeout(() => t.remove(), 3200);
      render();
    });
    body.querySelectorAll('[data-mn-moon]').forEach((b) => b.addEventListener('click', () => { root.cur = +b.dataset.mnMoon; G.save(); render(); }));
    body.querySelectorAll('[data-mn-newmoon]').forEach((b) => b.addEventListener('click', () => newMoonSheet(root)));
    body.querySelectorAll('[data-mn-up]').forEach((b) => b.addEventListener('click', () => { if (upgrade(mm, b.dataset.mnUp)) render(); }));
    body.querySelectorAll('[data-mn-fix]').forEach((b) => b.addEventListener('click', () => { if (repair(mm, b.dataset.mnFix)) render(); }));
    body.querySelectorAll('[data-mn-del]').forEach((b) => b.addEventListener('click', () => demolishSheet(mm, b.dataset.mnDel)));
    const ex = body.querySelector('[data-mn-expand]');
    if (ex) ex.addEventListener('click', () => { if (expand(mm)) render(); });
    body.querySelectorAll('[data-mn-slot]').forEach((b) => b.addEventListener('click', () => buildSheet(mm, b.dataset.mnSlot)));
    const sm = body.querySelector('[data-mn-smart]');
    if (sm) sm.addEventListener('click', () => smartSheet(root, mm));
  }
  // SMART UPGRADE confirm — itemized plan + total cost before a single coin moves
  function smartSheet(root, mm) {
    const plan = planSmart(root, mm);
    if (!plan.count) return;
    const old = $('mn-sheet'); if (old) old.remove();
    const wrap = document.createElement('div'); wrap.id = 'mn-sheet'; wrap.className = 'mn-sheet-veil';
    const rows = Object.values(plan.agg).map((a) =>
      '<div class="mn-pick" style="pointer-events:none"><span class="mn-b-ic">' + a.def.ic + '</span>' +
      '<span class="mn-pick-m"><b>' + a.def.name + '</b><i>' +
      (a.fixed ? '🔧 repair · back online' + (a.to > a.from ? ' · then ' : '') : '') +
      (a.to > a.from ? 'Lv ' + a.from + ' → <b style="color:#7ce0a0">Lv ' + a.to + '</b>' : '') +
      '</i></span></div>').join('');
    wrap.innerHTML = '<div class="mn-sheet"><div class="mn-sheet-t">⚙ SMART UPGRADE — ' + MOONCAT[root.cur].name.toUpperCase() + '</div>' +
      '<div class="mn-b-d" style="margin:2px 2px 8px">Repairs first, then defense to raid-safe, then the lowest levels — balanced with what you can afford right now.</div>' +
      rows +
      '<div class="mn-pick" style="pointer-events:none;border-color:transparent"><span class="mn-b-ic">Σ</span>' +
      '<span class="mn-pick-m"><b>' + plan.count + ' operations</b><em>' + costChips(plan.total) + '</em></span></div>' +
      '<button class="mn-c-btn" style="width:100%" data-ok>CONFIRM — APPLY WAVE</button>' +
      '<button class="mn-sheet-x">Cancel</button></div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    wrap.querySelector('.mn-sheet-x').addEventListener('click', () => wrap.remove());
    wrap.querySelector('[data-ok]').addEventListener('click', () => {
      const done = applySmart(mm, plan);
      wrap.remove();
      const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#9ecfff';
      t.innerHTML = '⚙ SMART UPGRADE<br><span style="font-size:13px;color:#d8e8fa">' + done + ' operations completed</span>';
      $('toast-layer').appendChild(t); setTimeout(() => t.remove(), 2800);
      if (window.MOONSCENE) window.MOONSCENE.refresh();
      render();
    });
  }
  // next-moon purchase sheet
  function newMoonSheet(root) {
    const nx = MOONCAT[root.moons.length]; if (!nx) return;
    const prev = root.moons[root.moons.length - 1];
    const ready = prev.sectors >= SECTORS.length;
    const old = $('mn-sheet'); if (old) old.remove();
    const wrap = document.createElement('div'); wrap.id = 'mn-sheet'; wrap.className = 'mn-sheet-veil';
    wrap.innerHTML = '<div class="mn-sheet"><div class="mn-sheet-t">🌙 ' + nx.name.toUpperCase() + '</div>' +
      '<div class="mn-pick" style="pointer-events:none;border-color:transparent"><span class="mn-b-ic" style="color:hsl(' + nx.hue + ' 80% 70%)">🌙</span>' +
      '<span class="mn-pick-m"><b>' + nx.name + '</b><i>' + nx.blurb + '</i><em>' + costChips(nx.cost) + '</em></span></div>' +
      (ready ? '' : '<div class="mn-b-d" style="margin:4px 2px 8px;color:#ffcf7a">Fully terraform all ' + SECTORS.length + ' sectors of ' + MOONCAT[root.moons.length - 1].name + ' first (' + prev.sectors + '/' + SECTORS.length + ').</div>') +
      '<button class="mn-c-btn" style="width:100%" data-ok ' + (ready && canAfford(nx.cost) ? '' : 'disabled') + '>LAUNCH COLONY SHIP</button>' +
      '<button class="mn-sheet-x">Cancel</button></div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    wrap.querySelector('.mn-sheet-x').addEventListener('click', () => wrap.remove());
    wrap.querySelector('[data-ok]').addEventListener('click', () => { if (buyMoon()) { wrap.remove(); render(); } });
  }
  // demolish confirm — shows the salvage refund before committing
  function demolishSheet(mm, key) {
    const bd = mm.b[key]; if (!bd) return;
    const def = B[bd.kind];
    const ref = salvageValue(bd);
    const refStr = costChips(ref) || '<span style="color:#6c8098">nothing</span>';
    const old = $('mn-sheet'); if (old) old.remove();
    const wrap = document.createElement('div'); wrap.id = 'mn-sheet'; wrap.className = 'mn-sheet-veil';
    wrap.innerHTML = '<div class="mn-sheet"><div class="mn-sheet-t">💥 DEMOLISH STRUCTURE</div>' +
      '<div class="mn-pick" style="pointer-events:none;border-color:transparent"><span class="mn-b-ic">' + def.ic + '</span>' +
      '<span class="mn-pick-m"><b>' + def.name + ' · Lv ' + bd.lv + (bd.dmg ? ' · ⚠ OFFLINE' : '') + '</b>' +
      '<i>Clears the slot for a different structure — the level is lost.</i>' +
      '<em>Salvage refund (' + (bd.dmg ? '25%' : '40%') + '): ' + refStr + '</em></span></div>' +
      '<button class="mn-c-btn danger" style="width:100%" data-ok>💥 DEMOLISH — FREE THE SLOT</button>' +
      '<button class="mn-sheet-x">Cancel</button></div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    wrap.querySelector('.mn-sheet-x').addEventListener('click', () => wrap.remove());
    wrap.querySelector('[data-ok]').addEventListener('click', () => {
      if (demolish(mm, key)) { wrap.remove(); if (window.MOONSCENE) window.MOONSCENE.refresh(); render(); }
    });
  }
  // build-picker
  function buildSheet(mm, key) {
    const sec = +key.split(':')[0];
    const old = $('mn-sheet'); if (old) old.remove();
    const wrap = document.createElement('div'); wrap.id = 'mn-sheet'; wrap.className = 'mn-sheet-veil';
    let inner = '<div class="mn-sheet"><div class="mn-sheet-t">SELECT STRUCTURE</div>';
    CATS.forEach(([cat, label]) => {
      const list = Object.entries(B).filter(([, d]) => d.cat === cat && (d.minSector || 0) <= sec);
      if (!list.length) return;
      inner += '<div class="mn-sheet-cat">' + label + '</div>';
      list.forEach(([kind, def]) => {
        const cost = upCost(def, 0), ok = canAfford(cost);
        // live level-1 output preview — scaled to THIS moon's bias + your zone
        const root2 = ensure(); const bias2 = (MOONCAT[root2.cur] || {}).bias || {};
        const prev = def.cat === 'mine'
          ? '→ +' + fN(def.rate * (def.out === 'prism' ? 1 : zScale()) * (bias2[def.out] || 1)) + ' ' + ({ gold: '$', fuel: '⬢', iron: '◆', plasma: '✦', prism: '◈' })[def.out] + '/h at Lv 1' +
            (bias2[def.out] ? ' <b style="color:#7ce0a0">(' + Math.round((bias2[def.out] - 1) * 100) + '% moon bonus)</b>' : '')
          : '';
        inner += '<button class="mn-pick" data-kind="' + kind + '" ' + (ok ? '' : 'disabled') + '>' +
          '<span class="mn-b-ic">' + def.ic + '</span><span class="mn-pick-m"><b>' + def.name + '</b><i>' + def.desc + (prev ? '<br>' + prev : '') + '</i><em>' + costChips(cost) + '</em></span></button>';
      });
    });
    const locked = Object.entries(B).filter(([, d]) => (d.minSector || 0) > sec);
    if (locked.length) inner += '<div class="mn-sheet-cat">LOCKED — EXPAND FURTHER</div>' + locked.map(([, d]) => '<div class="mn-pick locked"><span class="mn-b-ic">' + d.ic + '</span><span class="mn-pick-m"><b>' + d.name + '</b><i>unlocks in sector ' + (d.minSector + 1) + '</i></span></div>').join('');
    inner += '<button class="mn-sheet-x">Cancel</button></div>';
    wrap.innerHTML = inner;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    wrap.querySelector('.mn-sheet-x').addEventListener('click', () => wrap.remove());
    wrap.querySelectorAll('.mn-pick[data-kind]').forEach((b) => b.addEventListener('click', () => {
      if (build(mm, +key.split(':')[0], +key.split(':')[1], b.dataset.kind)) { wrap.remove(); if (window.MOONSCENE) window.MOONSCENE.refresh(); render(); }
    }));
  }

  // ---------------------------------------------------------------------------
  function init(game) {
    G = game; ensure();
    setInterval(() => { if (document.querySelector('#screen-moon.active')) render(); }, 15000);
  }
  function boot() { if (window.GAME && window.GAME.state) init(window.GAME); else setTimeout(boot, 500); }
  setTimeout(boot, 1000);
  window.MOON = { init, render };
})();
