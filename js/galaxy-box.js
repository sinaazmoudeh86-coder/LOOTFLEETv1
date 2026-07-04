/* =============================================================================
   galaxy-box.js — GALAXY BOXES (Command ▸ Galaxy Boxes)
   -----------------------------------------------------------------------------
   A crate / loot-box system that spends the game's real currencies for gear.

   NEW MODEL — "buy the tier you want":
     • ONE guaranteed box per rarity tier (Common → Relic). Opening it hands you
       an item of EXACTLY that tier — no random range, no gambling. You simply
       purchase the level item you want, and that's the level item you gain.
     • ALL boxes are available at ALL player levels. Nothing is gated behind a
       level unlock — the price (and the currency it costs) IS the gate.
     • One premium capstone: the COSMIC CACHE — 10× the price and 15× the value
       of a normal box, and the galaxy's ONLY shot at the rarest gear of all,
       up to and including ARTIFACT tier.

   Items are generated at YOUR current zone level, so the base item scales with
   how far you've pushed — the box only decides its RARITY (and, for the Cosmic
   Cache, a 15× value boost on top).

   Reads the engine only through window.GAME / window.CONFIG / window.ITEMS.
   ========================================================================== */
(function () {
  'use strict';
  const G = () => window.GAME;
  const C = () => window.CONFIG;
  const I = () => window.ITEMS;
  const $ = (id) => document.getElementById(id);
  const UNLOCK = 1; // available at ALL levels

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lvl = () => { try { return (G().state.level | 0) || 1; } catch (e) { return 1; } };
  const hz = () => { try { return Math.max(1, G().state.highestUnlocked || 1); } catch (e) { return 1; } };
  function fmt(n) { try { return G().formatNum(Math.floor(n)); } catch (e) { return Math.floor(n) + ''; } }
  function rar(t) { return C().RARITY[t]; }

  // ---- currencies -----------------------------------------------------------
  const CUR = {
    gold:       { glyph: '●', color: '#f2b24b', name: 'Gold',       get: () => G().state.gold || 0 },
    fuel:       { glyph: '⬢', color: '#5bc0ff', name: 'Fuel',       get: () => (G().state.resources || {}).fuel || 0 },
    iron:       { glyph: '◆', color: '#d0a060', name: 'Iron',       get: () => (G().state.resources || {}).iron || 0 },
    plasma:     { glyph: '✦', color: '#c07bff', name: 'Plasma',     get: () => (G().state.resources || {}).plasma || 0 },
    dreadCores: { glyph: '◇', color: '#ff5a68', name: 'Dread Cores',get: () => G().state.dreadCores || 0 },
    credits:    { glyph: '◈', color: '#ffd66a', name: 'LootCoins',  get: () => G().state.credits || 0 },
  };

  // ---- COSMIC CACHE VALUE BOOST ---------------------------------------------
  const COSMIC_VALUE_MULT = 15;    // items pull 15× the value of a normal box
  const COSMIC_PRICE       = 2500; // premium capstone — the steepest crate in the galaxy
  const MAX_TIER_BOX       = 8;    // guaranteed crates go Common (0) → Cosmic (8)

  // ---- BOX DEFINITIONS ------------------------------------------------------
  // Built lazily so CONFIG.RARITY is guaranteed present. Two kinds of box:
  //   guaranteed tier box  → odds: { tier: 1 }              (100% that tier)
  //   premium cosmic cache → weighted odds incl. Artifact + a 15× value boost
  let _boxes = null, _byId = null;
  function boxes() {
    if (_boxes) return _boxes;
    const R = C().RARITY;
    const TOP = R.length - 1; // Artifact tier index

    // one guaranteed box per rarity tier, Common → Cosmic
    const tierBoxes = [];
    for (let t = 0; t <= MAX_TIER_BOX; t++) {
      tierBoxes.push({
        id: 't' + t, tier: t, guaranteed: true,
        name: R[t].name + ' Crate', accent: R[t].color,
        odds: { [t]: 1 }, valueMult: 1,
      });
    }

    const cosmic = {
      id: 'cosmic', name: 'Cosmic Cache', accent: '#ffd66a', premium: true,
      tagline: 'Premium vault · 10× the price, 15× the value — and the galaxy\u2019s only shot at Artifact-tier relics.',
      // weighted toward the top of the chain, with a rare Artifact pull
      odds: { 8: 300, 9: 300, 10: 200, 11: 120, 12: 60, [TOP]: 8 },
      valueMult: COSMIC_VALUE_MULT,
    };

    _boxes = [cosmic, ...tierBoxes];
    _byId = {}; _boxes.forEach((b) => (_byId[b.id] = b));
    return _boxes;
  }
  function boxById(id) { boxes(); return _byId[id]; }

  function oddsList(box) {
    const total = Object.values(box.odds).reduce((a, b) => a + b, 0) || 1;
    return Object.keys(box.odds).map((k) => ({ tier: +k, p: box.odds[k] / total }))
      .sort((a, b) => a.tier - b.tier);
  }
  function bestTier(box) { return Math.max(...Object.keys(box.odds).map(Number)); }
  function rollTier(box) {
    const total = Object.values(box.odds).reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (const k of Object.keys(box.odds)) { r -= box.odds[k]; if (r <= 0) return +k; }
    return +Object.keys(box.odds)[0];
  }

  // ---- COST -----------------------------------------------------------------
  // Gold tiers scale with the economy so low crates stay meaningful deep in;
  // Dread / LootCoin tiers are flat premium prices.
  const GOLD_MULT = [1, 2.5, 7, 20, 60];          // tiers 0-4 (gold)
  const DREAD_COST = { 5: 3, 6: 9, 7: 26 };       // tiers 5-7 (dread cores)
  const CREDIT_COST = { 8: 35, 9: 90, 10: 240, 11: 650, 12: 1600 }; // tiers 8-12 (loot coins)
  function unitCost(box) {
    if (box.premium) return { credits: COSMIC_PRICE };
    const t = box.tier;
    if (t <= 4) { const s = C().dungeonScale(hz()); return { gold: Math.round((400 * Math.pow(s, 0.7) + 250) * (GOLD_MULT[t] || 1)) }; }
    if (t <= 7) return { dreadCores: DREAD_COST[t] || 3 };
    return { credits: CREDIT_COST[t] || 100 };
  }
  // 10× gets a 10% bulk discount; odds are UNCHANGED and each draw independent.
  const BULK = 10, BULK_MULT = 9;
  function costFor(box, qty) {
    const u = unitCost(box), m = qty === BULK ? BULK_MULT : qty, out = {};
    for (const k in u) out[k] = Math.ceil(u[k] * m);
    return out;
  }
  function costParts(box, qty) {
    const c = costFor(box, qty), parts = [];
    for (const k of ['gold', 'fuel', 'iron', 'plasma', 'dreadCores', 'credits']) {
      if (c[k]) parts.push({ cur: k, amt: c[k] });
    }
    return parts;
  }
  function canAfford(box, qty) { return costParts(box, qty).every((p) => CUR[p.cur].get() >= p.amt); }
  function spend(box, qty) {
    const c = costFor(box, qty), st = G().state;
    if (c.gold) st.gold -= c.gold;
    if (c.fuel || c.iron || c.plasma) { st.resources = st.resources || { fuel: 0, iron: 0, plasma: 0 }; st.resources.fuel -= c.fuel || 0; st.resources.iron -= c.iron || 0; st.resources.plasma -= c.plasma || 0; }
    if (c.dreadCores) st.dreadCores = (st.dreadCores || 0) - c.dreadCores;
    if (c.credits) st.credits = (st.credits || 0) - c.credits;
  }

  // ---- OPEN + DEPOSIT -------------------------------------------------------
  // Cosmic Cache items get a 15× value boost: flat stats ×15, percent stats
  // ×sqrt(15) (specials like life-steal / multi-shot are left untouched).
  function boostItem(it, mult) {
    if (!it || !mult || mult <= 1) return it;
    const sq = Math.sqrt(mult);
    for (const k in it.stats) {
      const def = C().STATS[k];
      if (!def) continue; // skip specials
      if (def.fmt === 'flat') it.stats[k] = Math.max(1, Math.round(it.stats[k] * mult));
      else it.stats[k] = Math.round(it.stats[k] * sq * 10) / 10;
    }
    it.premium = true;
    return it;
  }
  function openBox(box, qty) {
    const items = [];
    for (let i = 0; i < qty; i++) {
      const it = I().generate(hz(), rollTier(box));
      if (box.valueMult > 1) boostItem(it, box.valueMult);
      items.push(it);
    }
    return items;
  }
  function deposit(items) {
    const g = G(), st = g.state, cap = g.invCap();
    if (!st.inventory) st.inventory = [];
    let added = 0, scrapped = 0; const gained = { fuel: 0, iron: 0, plasma: 0 }; let gold = 0;
    items.forEach((it) => {
      if (st.inventory.length < cap) { st.inventory.push(it); added++; st.itemsFound = (st.itemsFound || 0) + 1; }
      else {
        scrapped++;
        try { gold += C().sellValue(it); } catch (e) {}
        try { const sv = C().salvage(it); if (sv) for (const k in sv) gained[k] = (gained[k] || 0) + sv[k]; } catch (e) {}
      }
    });
    if (scrapped) {
      st.gold = (st.gold || 0) + gold;
      st.resources = st.resources || { fuel: 0, iron: 0, plasma: 0 };
      st.resources.fuel += gained.fuel; st.resources.iron += gained.iron; st.resources.plasma += gained.plasma;
    }
    g.save(); if (window.UI && window.UI.refreshAll) window.UI.refreshAll();
    return { added, scrapped, gold, gained };
  }

  // ===========================================================================
  // RENDER — lobby
  // ===========================================================================
  function render() {
    const body = $('boxes-body'); if (!body) return;
    const sub = $('boxes-sub');
    if (sub) sub.textContent = 'Buy the tier you want · Zone ' + hz() + ' gear';
    const all = boxes();
    const cosmic = all.find((b) => b.premium);
    const tiers = all.filter((b) => !b.premium);
    body.innerHTML =
      '<div class="gb-intro">Pick the rarity you want and <b>buy it outright</b> — every crate below is a <b>100% guaranteed</b> drop of that tier, generated at your current zone. Higher tiers cost scarcer currency. The <b style="color:#ffd66a">Cosmic Cache</b> is the one exception: a premium gamble for the rarest gear alive.</div>' +
      heroCard(cosmic) +
      '<div class="gb-tsec-t">Guaranteed Tier Crates</div>' +
      '<div class="gb-tgrid">' + tiers.map(tierCard).join('') + '</div>';
    wire(body);
  }

  function wire(body) {
    body.querySelectorAll('[data-buy]').forEach((b) => b.onclick = () => {
      const [id, qty] = b.dataset.buy.split(':'); attemptBuy(id, +qty);
    });
    body.querySelectorAll('[data-odds]').forEach((b) => b.onclick = () => {
      const card = $('gb-odds-' + b.dataset.odds); if (!card) return;
      const open = card.classList.toggle('open'); b.textContent = open ? 'Hide full odds' : 'View full odds';
    });
  }

  // premium Cosmic Cache — hero card with weighted odds
  function heroCard(box) {
    const list = oddsList(box);
    const stacked = list.map((o) => '<span style="flex:' + Math.max(o.p * 1000, 3) + ';background:' + rar(o.tier).color + '"></span>').join('');
    const rows = list.slice().reverse().map((o) => {
      const R = rar(o.tier);
      return '<div class="gb-orow"><span class="gb-odot" style="background:' + R.color + ';box-shadow:0 0 6px ' + R.color + '"></span>' +
        '<span class="gb-oname" style="color:' + R.color + '">' + R.name + '</span>' +
        '<span class="gb-obar"><i style="width:' + clamp(o.p * 100, 1.5, 100) + '%;background:' + R.color + '"></i></span>' +
        '<span class="gb-opct">' + pct(o.p * 100) + '</span></div>';
    }).join('');
    const afford1 = canAfford(box, 1), afford10 = canAfford(box, BULK);
    return '<div class="gb-card gb-hero" style="--acc:' + box.accent + '">' +
      '<div class="gb-hero-badge">PREMIUM</div>' +
      '<div class="gb-card-head">' +
        '<div class="gb-crate">' + crateSVG(box.accent) + '</div>' +
        '<div class="gb-card-t"><div class="gb-name">' + box.name + '</div>' +
          '<div class="gb-range">Up to ' + rar(bestTier(box)).name + '</div>' +
          '<div class="gb-tag">' + box.tagline + '</div></div>' +
      '</div>' +
      '<div class="gb-hero-chips">' +
        '<span class="gb-hchip">10× price</span><span class="gb-hchip">15× value</span>' +
        '<span class="gb-hchip gb-hchip-art" style="color:' + rar(bestTier(box)).color + '">◈ Artifact chance</span>' +
      '</div>' +
      '<div class="gb-stacked" title="Drop distribution">' + stacked + '</div>' +
      '<button class="gb-odds-toggle" data-odds="' + box.id + '">View full odds</button>' +
      '<div class="gb-odds" id="gb-odds-' + box.id + '">' + rows +
        '<div class="gb-odds-note">Published odds · each draw is independent</div></div>' +
      '<div class="gb-buys">' +
        '<button class="gb-buy" data-buy="' + box.id + ':1"' + (afford1 ? '' : ' disabled') + '>' +
          '<span class="gb-buy-q">Open 1×</span>' + costLine(box, 1) + '</button>' +
        '<button class="gb-buy bulk" data-buy="' + box.id + ':' + BULK + '"' + (afford10 ? '' : ' disabled') + '>' +
          '<span class="gb-buy-q">Open 10×<span class="gb-save">−10%</span></span>' + costLine(box, BULK) + '</button>' +
      '</div>' +
    '</div>';
  }

  // compact guaranteed-tier crate
  function tierCard(box) {
    const R = rar(box.tier);
    const afford1 = canAfford(box, 1), afford10 = canAfford(box, BULK);
    return '<div class="gb-tcard" style="--acc:' + R.color + ';--rg:' + R.glow + '">' +
      '<div class="gb-tc-head">' +
        '<span class="gb-tc-dot"></span>' +
        '<span class="gb-tc-name">' + R.name + '</span>' +
      '</div>' +
      '<div class="gb-tc-guar">100% GUARANTEED</div>' +
      '<div class="gb-tc-buys">' +
        '<button class="gb-buy" data-buy="' + box.id + ':1"' + (afford1 ? '' : ' disabled') + '>' +
          '<span class="gb-buy-q">1×</span>' + costLine(box, 1) + '</button>' +
        '<button class="gb-buy bulk" data-buy="' + box.id + ':' + BULK + '"' + (afford10 ? '' : ' disabled') + '>' +
          '<span class="gb-buy-q">10×<span class="gb-save">−10%</span></span>' + costLine(box, BULK) + '</button>' +
      '</div>' +
    '</div>';
  }

  function costLine(box, qty) {
    return '<span class="gb-cost">' + costParts(box, qty).map((p) =>
      '<span class="gb-c" style="color:' + CUR[p.cur].color + '">' + CUR[p.cur].glyph + ' ' + fmt(p.amt) + '</span>'
    ).join('') + '</span>';
  }
  function pct(p) {
    if (p >= 10) return Math.round(p) + '%';
    if (p >= 1) return p.toFixed(1) + '%';
    if (p >= 0.1) return p.toFixed(1) + '%';
    if (p >= 0.01) return p.toFixed(2) + '%';
    return '<0.01%';
  }
  function crateSVG(c) {
    return '<svg viewBox="0 0 48 48" fill="none">' +
      '<path d="M24 4l17 8.5v23L24 44 7 35.5v-23z" stroke="' + c + '" stroke-width="2.2" fill="rgba(255,255,255,.04)"/>' +
      '<path d="M7 12.5L24 21l17-8.5M24 21v23" stroke="' + c + '" stroke-width="1.6" opacity=".7"/>' +
      '<path d="M17 8.5L34 17M14 27l6 3M28 30l6-3" stroke="' + c + '" stroke-width="1.4" opacity=".45"/>' +
      '<circle cx="24" cy="21" r="3" fill="' + c + '"/></svg>';
  }

  // ===========================================================================
  // BUY → OPEN animation → REVEAL → ACCEPT
  // ===========================================================================
  let pending = null; // { items, box }
  function attemptBuy(id, qty) {
    const box = boxById(id); if (!box) return;
    if (!canAfford(box, qty)) { toast('Not enough ' + curNames(box)); return; }
    spend(box, qty);
    const items = openBox(box, qty);
    pending = { items, box, qty };
    try { G().save(); } catch (e) {}
    if (window.UI && window.UI.refreshAll) window.UI.refreshAll();
    showOpening(box, items);
  }
  function curNames(box) { return costParts(box, 1).map((p) => CUR[p.cur].name).join(' / '); }

  function overlay() {
    let o = $('gb-overlay');
    if (!o) { o = document.createElement('div'); o.id = 'gb-overlay'; ($('screen-boxes') || document.body).appendChild(o); }
    return o;
  }
  function closeOverlay() { const o = $('gb-overlay'); if (o) { o.classList.remove('show'); o.innerHTML = ''; } }

  function showOpening(box, items) {
    const best = Math.max(...items.map((it) => it.rarity));
    const o = overlay(); o.className = 'show';
    o.innerHTML =
      '<div class="gb-open" style="--acc:' + box.accent + ';--best:' + rar(best).color + '">' +
        '<div class="gb-open-crate">' + crateSVG(box.accent) + '<div class="gb-open-glow"></div><div class="gb-open-rays"></div></div>' +
        '<div class="gb-open-t">Opening ' + box.name + '…</div>' +
        '<button class="gb-skip">Skip</button>' +
      '</div>';
    const openEl = o.querySelector('.gb-open');
    const skip = o.querySelector('.gb-skip');
    let done = false;
    const go = () => { if (done) return; done = true; showReveal(box, items); };
    skip.onclick = go;
    setTimeout(() => { if (openEl) openEl.classList.add('burst'); }, 620);
    setTimeout(go, 1250);
  }

  function showReveal(box, items) {
    const sorted = items.slice().sort((a, b) => b.rarity - a.rarity);
    const best = sorted[0];
    const multi = items.length > 1;
    const o = overlay(); o.className = 'show';
    const cards = sorted.map((it, i) => itemCard(it, i)).join('');
    o.innerHTML =
      '<div class="gb-reveal" style="--acc:' + box.accent + '">' +
        '<div class="gb-rev-head">' +
          '<div class="gb-rev-t">' + (multi ? items.length + ' ITEMS RECOVERED' : 'ITEM RECOVERED') + '</div>' +
          '<div class="gb-rev-s">Best pull · <b style="color:' + rar(best.rarity).color + '">' + rar(best.rarity).name + '</b></div>' +
        '</div>' +
        '<div class="gb-rev-grid ' + (multi ? 'multi' : 'single') + '">' + cards + '</div>' +
        '<div class="gb-rev-btns">' +
          '<button class="gb-accept">Accept → Loot Bag</button>' +
        '</div>' +
      '</div>';
    const grid = o.querySelector('.gb-rev-grid');
    [...grid.children].forEach((c, i) => { c.style.animationDelay = (i * (items.length > 5 ? 45 : 80)) + 'ms'; });
    o.querySelector('.gb-accept').onclick = () => acceptPending();
  }

  function itemCard(it, i) {
    const R = rar(it.rarity);
    const slot = (C().SLOTS[it.slot] || {}).name || it.slot;
    const power = Math.round(I().itemPower(it));
    return '<div class="gb-item' + (it.premium ? ' gb-item-prem' : '') + '" style="--rc:' + R.color + ';--rg:' + R.glow + '">' +
      (it.premium ? '<div class="gb-item-boost">15×</div>' : '') +
      '<div class="gb-item-rar">' + R.name + '</div>' +
      '<div class="gb-item-name">' + it.name + '</div>' +
      '<div class="gb-item-slot">' + slot + '</div>' +
      '<div class="gb-item-pw">⚔ ' + fmt(power) + '</div>' +
    '</div>';
  }

  function acceptPending() {
    if (!pending) { closeOverlay(); return; }
    const res = deposit(pending.items);
    let msg = '★ ' + res.added + ' item' + (res.added === 1 ? '' : 's') + ' added to Loot';
    if (res.scrapped) msg += ' · ' + res.scrapped + ' scrapped (bag full)';
    toast(msg);
    pending = null;
    closeOverlay();
    render();
  }

  function toast(m) { try { if (window.UI && window.UI.unlockToast) window.UI.unlockToast(m); } catch (e) {} }

  // ===========================================================================
  // BOOT + CSS
  // ===========================================================================
  function boot() { injectCSS(); }
  function injectCSS() {
    if ($('gb-css')) return;
    const s = document.createElement('style'); s.id = 'gb-css'; s.textContent = CSS; document.head.appendChild(s);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  setTimeout(boot, 1000);

  window.GBOX = { render, UNLOCK };

  const CSS = `
  /* Command card */
  .mega-card.cmd-boxes .mc-ic{ color:#ffd66a; border-color:rgba(255,214,106,.5); background:radial-gradient(120% 120% at 50% 0%,#2a2413,#141017); box-shadow:0 0 14px -3px rgba(255,214,106,.7); }
  .mega-card.cmd-boxes .mc-n{ color:#ffe9b8; }
  .mega-card.cmd-boxes::before{ background:linear-gradient(130deg,#ffd66a,#ff9a5a,#ff5a68,#7fd0ff); background-size:250% 250%; }
  #screen-boxes .scr-title{ color:#ffd66a; }

  #boxes-body{ padding:12px; }
  .gb-intro{ font-size:12px; color:#9fb1c4; line-height:1.55; background:linear-gradient(180deg,#101826,#0c1220); border:1px solid #1e2f44; border-radius:12px; padding:11px 13px; margin-bottom:12px; }
  .gb-intro b{ color:#e7f0fb; }

  .gb-card{ border:1px solid color-mix(in srgb, var(--acc) 40%, #223245); border-radius:16px; padding:14px;
    background:linear-gradient(180deg, color-mix(in srgb, var(--acc) 8%, #0e1725), #0b1220); position:relative; overflow:hidden; }
  .gb-card::after{ content:''; position:absolute; inset:0 0 auto 0; height:2px; background:linear-gradient(90deg,transparent,var(--acc),transparent); opacity:.6; }
  .gb-card-head{ display:flex; gap:12px; align-items:center; }
  .gb-crate{ width:52px; height:52px; flex:none; filter:drop-shadow(0 0 8px color-mix(in srgb,var(--acc) 60%,transparent)); }
  .gb-crate svg{ width:52px; height:52px; }
  .gb-name{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:14px; color:#eaf2fb; letter-spacing:.04em; }
  .gb-range{ font-size:10.5px; font-weight:700; letter-spacing:.05em; color:var(--acc); margin-top:2px; }
  .gb-tag{ font-size:11px; color:#8ba0b5; margin-top:3px; line-height:1.4; }

  /* premium Cosmic Cache hero */
  .gb-hero{ border-width:1.5px; box-shadow:0 0 26px -10px color-mix(in srgb,var(--acc) 80%,transparent); margin-bottom:16px; }
  .gb-hero::before{ content:''; position:absolute; inset:0; border-radius:16px; padding:1.5px; background:linear-gradient(130deg,#ffd66a,#ff9a5a,#ff5a68,#b87bff,#ffd66a); background-size:280% 280%; -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0); -webkit-mask-composite:xor; mask-composite:exclude; opacity:.55; animation:gbPrism 6s linear infinite; pointer-events:none; }
  @keyframes gbPrism{ to{ background-position:280% 50%; } }
  .gb-hero-badge{ position:absolute; top:0; right:0; font-family:'Orbitron',sans-serif; font-weight:800; font-size:8.5px; letter-spacing:.14em; color:#1c1206; background:linear-gradient(180deg,#ffe08a,#f2b24b); padding:4px 10px; border-radius:0 16px 0 12px; }
  .gb-hero-chips{ display:flex; gap:7px; flex-wrap:wrap; margin:11px 0 4px; }
  .gb-hchip{ font-size:10px; font-weight:700; letter-spacing:.03em; color:#dbe8f5; background:rgba(255,255,255,.05); border:1px solid #2b4055; border-radius:8px; padding:4px 9px; }
  .gb-hchip-art{ border-color:currentColor; }

  .gb-stacked{ display:flex; height:9px; border-radius:5px; overflow:hidden; margin:12px 0 8px; background:#0a1119; }
  .gb-stacked span{ display:block; }

  .gb-odds-toggle{ width:100%; background:none; border:1px dashed #2b4055; color:#a9c6da; border-radius:9px; padding:7px; font-family:'Rajdhani',sans-serif; font-weight:700; font-size:11.5px; letter-spacing:.04em; cursor:pointer; }
  .gb-odds-toggle:active{ transform:scale(.98); }
  .gb-odds{ max-height:0; overflow:hidden; transition:max-height .28s ease; }
  .gb-odds.open{ max-height:340px; margin-top:8px; }
  .gb-orow{ display:flex; align-items:center; gap:8px; padding:3px 0; }
  .gb-odot{ width:8px; height:8px; border-radius:50%; flex:none; }
  .gb-oname{ font-size:11px; font-weight:700; width:76px; flex:none; }
  .gb-obar{ flex:1; height:6px; border-radius:4px; background:#0d1520; overflow:hidden; }
  .gb-obar i{ display:block; height:100%; border-radius:4px; }
  .gb-opct{ font-size:11px; font-weight:800; color:#dbe8f5; width:52px; text-align:right; flex:none; font-variant-numeric:tabular-nums; }
  .gb-odds-note{ font-size:9.5px; color:#6f8398; text-align:center; margin-top:7px; letter-spacing:.03em; }

  .gb-buys{ display:flex; gap:9px; margin-top:12px; }
  .gb-buy{ flex:1; border:1px solid color-mix(in srgb,var(--acc) 45%,#25384c); border-radius:11px; padding:9px 6px; cursor:pointer;
    background:color-mix(in srgb,var(--acc) 10%,#0d1622); display:flex; flex-direction:column; align-items:center; gap:4px; transition:transform .08s; }
  .gb-buy:active{ transform:scale(.96); }
  .gb-buy:disabled{ opacity:.4; cursor:default; }
  .gb-buy.bulk{ background:color-mix(in srgb,var(--acc) 18%,#0d1622); border-color:var(--acc); }
  .gb-buy-q{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:12px; color:#f2f7ff; position:relative; }
  .gb-save{ font-size:8px; color:#7ce0a0; margin-left:4px; vertical-align:2px; letter-spacing:.03em; }
  .gb-cost{ display:flex; gap:7px; flex-wrap:wrap; justify-content:center; }
  .gb-c{ font-size:11px; font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap; }

  /* guaranteed tier grid */
  .gb-tsec-t{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:10.5px; letter-spacing:.16em; text-transform:uppercase; color:#8ba0b5; margin:4px 2px 10px; }
  .gb-tgrid{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  @media(min-width:560px){ .gb-tgrid{ grid-template-columns:1fr 1fr 1fr; } }
  .gb-tcard{ border:1px solid color-mix(in srgb,var(--acc) 45%,#223245); border-radius:13px; padding:11px 10px 10px;
    background:linear-gradient(180deg, color-mix(in srgb,var(--acc) 10%,#0e1725), #0b1220); position:relative; overflow:hidden; }
  .gb-tcard::after{ content:''; position:absolute; inset:0 0 auto 0; height:2px; background:linear-gradient(90deg,transparent,var(--acc),transparent); opacity:.7; }
  .gb-tc-head{ display:flex; align-items:center; gap:7px; }
  .gb-tc-dot{ width:11px; height:11px; border-radius:50%; flex:none; background:var(--acc); box-shadow:0 0 9px var(--acc); }
  .gb-tc-name{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:12px; color:var(--acc); letter-spacing:.03em; }
  .gb-tc-guar{ font-size:8.5px; font-weight:700; letter-spacing:.12em; color:#7f92a6; margin:4px 0 9px; }
  .gb-tc-buys{ display:flex; gap:7px; }
  .gb-tc-buys .gb-buy{ padding:7px 4px; border-radius:9px; }
  .gb-tc-buys .gb-buy-q{ font-size:11px; }
  .gb-tc-buys .gb-c{ font-size:10px; }

  /* overlay */
  #gb-overlay{ position:absolute; inset:0; z-index:14; display:none; align-items:center; justify-content:center; padding:18px;
    background:rgba(6,10,17,.82); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); }
  #gb-overlay.show{ display:flex; }

  /* opening */
  .gb-open{ text-align:center; position:relative; }
  .gb-open-crate{ position:relative; width:150px; height:150px; margin:0 auto; display:grid; place-items:center; animation:gbShake .5s .12s ease-in-out 2; }
  .gb-open-crate svg{ width:120px; height:120px; position:relative; z-index:2; filter:drop-shadow(0 0 16px var(--acc)); }
  .gb-open-glow{ position:absolute; inset:0; border-radius:50%; background:radial-gradient(circle, color-mix(in srgb,var(--best) 70%,transparent), transparent 62%); opacity:.55; animation:gbPulse 1s ease-in-out infinite; }
  .gb-open-rays{ position:absolute; inset:-40px; background:conic-gradient(from 0deg, transparent, color-mix(in srgb,var(--best) 55%,transparent), transparent 22%, transparent 50%, color-mix(in srgb,var(--best) 55%,transparent), transparent 72%); opacity:0; animation:gbSpin 6s linear infinite; }
  .gb-open-t{ font-family:'Orbitron',sans-serif; font-weight:700; font-size:13px; color:#dbe8f5; letter-spacing:.08em; margin-top:14px; }
  .gb-skip{ margin-top:16px; background:none; border:1px solid #2b4055; color:#9db6cb; border-radius:9px; padding:7px 16px; font-family:'Rajdhani',sans-serif; font-weight:700; font-size:12px; cursor:pointer; }
  .gb-open.burst .gb-open-crate{ animation:gbBurst .5s cubic-bezier(.2,.8,.2,1) forwards; }
  .gb-open.burst .gb-open-rays{ opacity:1; }
  .gb-open.burst .gb-open-glow{ animation:gbFlash .5s ease-out forwards; }
  @keyframes gbShake{ 0%,100%{ transform:rotate(0) translateX(0);} 25%{ transform:rotate(-6deg) translateX(-4px);} 75%{ transform:rotate(6deg) translateX(4px);} }
  @keyframes gbPulse{ 0%,100%{ transform:scale(.9); opacity:.4;} 50%{ transform:scale(1.08); opacity:.65;} }
  @keyframes gbSpin{ to{ transform:rotate(360deg);} }
  @keyframes gbBurst{ 0%{ transform:scale(1);} 40%{ transform:scale(1.25);} 100%{ transform:scale(1.7); opacity:0;} }
  @keyframes gbFlash{ 0%{ transform:scale(1); opacity:.6;} 100%{ transform:scale(3); opacity:0;} }

  /* reveal */
  .gb-reveal{ width:100%; max-width:520px; text-align:center; }
  .gb-rev-head{ margin-bottom:14px; }
  .gb-rev-t{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:15px; color:#fff; letter-spacing:.08em; }
  .gb-rev-s{ font-size:12px; color:#a0b6c8; margin-top:4px; }
  .gb-rev-grid{ display:grid; gap:10px; justify-content:center; }
  .gb-rev-grid.single{ grid-template-columns:minmax(180px,240px); }
  .gb-rev-grid.multi{ grid-template-columns:repeat(auto-fill,minmax(96px,1fr)); max-height:52vh; overflow-y:auto; padding:2px; }
  .gb-item{ position:relative; border:1px solid var(--rc); border-radius:12px; padding:11px 9px; background:linear-gradient(180deg, color-mix(in srgb,var(--rc) 16%,#0d1420), #0b1119);
    box-shadow:0 0 18px -6px var(--rg); text-align:center; opacity:0; transform:translateY(14px) scale(.9); animation:gbIn .34s cubic-bezier(.22,1,.36,1) forwards; }
  .gb-item-prem{ box-shadow:0 0 22px -4px var(--rg); }
  .gb-item-boost{ position:absolute; top:-6px; right:-6px; font-family:'Orbitron',sans-serif; font-weight:800; font-size:9px; color:#1c1206; background:linear-gradient(180deg,#ffe08a,#f2b24b); border-radius:8px; padding:2px 6px; box-shadow:0 2px 8px rgba(242,178,75,.6); }
  @keyframes gbIn{ to{ opacity:1; transform:none; } }
  .gb-item-rar{ font-size:9px; font-weight:800; letter-spacing:.1em; color:var(--rc); text-transform:uppercase; }
  .gb-item-name{ font-size:11.5px; font-weight:700; color:#eef4fb; margin-top:4px; line-height:1.25; min-height:2.4em; display:flex; align-items:center; justify-content:center; }
  .gb-item-slot{ font-size:9.5px; color:#8ba0b5; }
  .gb-item-pw{ font-size:11px; font-weight:800; color:#ffd88a; margin-top:5px; font-variant-numeric:tabular-nums; }
  .gb-single .gb-item-name{ font-size:14px; }

  .gb-rev-btns{ margin-top:16px; }
  .gb-accept{ border:none; border-radius:12px; padding:13px 30px; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:14px; letter-spacing:.05em; cursor:pointer;
    color:#08111a; background:linear-gradient(180deg,#ffe08a,#f2b24b); box-shadow:0 8px 22px -8px rgba(242,178,75,.7); transition:transform .08s; }
  .gb-accept:active{ transform:scale(.97); }
  @media (prefers-reduced-motion: reduce){ .gb-open-crate,.gb-open-glow,.gb-open-rays,.gb-item,.gb-hero::before{ animation:none !important; opacity:1 !important; transform:none !important; } }
  `;
})();
