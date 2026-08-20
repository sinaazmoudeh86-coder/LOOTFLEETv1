/* =============================================================================
   shipworks.js — SHIPWORKS (Command ▸ Shipworks)
   -----------------------------------------------------------------------------
   Ship MANUFACTURING via part crates — the gacha route to every hull.

     • FIVE crate levels, each covering a BAND of the hull chain and costing an
       escalating currency: gold → gold+iron → fuel+plasma → LootCoins →
       LootCoins + Dread Cores.
     • Every open drops PARTS for a random hull in the crate's band that you
       don't own yet — weighted toward your next hull, published live odds.
     • Parts live in the Shipworks' OWN inventory. Collect a hull's full part
       count (e.g. 25 Battleship parts) and ASSEMBLE it — the ship unlocks
       outright, blueprint and kill gates bypassed.
     • Scales from the very first hull all the way to the TITAN SINA (200 parts).
     • Spare parts of hulls you already own can be salvaged for gold.

   Reads the engine only through window.GAME / window.CONFIG.
   State lives on GAME.state.shipParts → persisted with the normal save.
   ========================================================================== */
(function () {
  'use strict';
  const G = () => window.GAME;
  const C = () => window.CONFIG;
  const $ = (id) => document.getElementById(id);

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const hz = () => { try { return Math.max(1, G().state.highestUnlocked || 1); } catch (e) { return 1; } };
  function fmt(n) { try { return G().formatNum(Math.floor(n)); } catch (e) { return Math.floor(n) + ''; } }
  function owned(key) { try { return !!G().state.ownedShips[key]; } catch (e) { return false; } }
  function partsOf(key) { const st = G().state; return (st.shipParts && st.shipParts[key]) | 0; }
  function addParts(key, n) { const st = G().state; if (!st.shipParts) st.shipParts = {}; st.shipParts[key] = (st.shipParts[key] | 0) + n; }
  function shipImg(key) { return 'ships/ship-' + key + '.png'; }

  // ---- currencies -----------------------------------------------------------
  const CUR = {
    gold:       { glyph: '●', color: '#f2b24b', name: 'Gold',        get: () => G().state.gold || 0 },
    fuel:       { glyph: '⬢', color: '#5bc0ff', name: 'Fuel',        get: () => (G().state.resources || {}).fuel || 0 },
    iron:       { glyph: '◆', color: '#d0a060', name: 'Iron',        get: () => (G().state.resources || {}).iron || 0 },
    plasma:     { glyph: '✦', color: '#c07bff', name: 'Plasma',      get: () => (G().state.resources || {}).plasma || 0 },
    dreadCores: { glyph: '◇', color: '#ff5a68', name: 'Dread Cores', get: () => G().state.dreadCores || 0 },
    credits:    { glyph: '◈', color: '#ffd66a', name: 'LootCoins',   get: () => G().state.credits || 0 },
  };

  // ---- PARTS REQUIRED per hull (Battleship = 25, scaling both ways) ---------
  const PARTS_NEED = {
    frigate: 10, interceptor: 12, cruiser: 15, heavycruiser: 18, destroyer: 21,
    battleship: 25, dreadnought: 30, carrier: 34, aegis: 34, supercarrier: 38,
    titan: 45, mothership: 550, oblivionspear: 650, oblivionspearalpha: 750,
    oblivionfinal: 850, dread1: 950, dread2: 1050, dread3: 1150, dread4: 1250,
    dread5: 1350, dread6: 1500, titansina: 2000,
  };
  function needOf(key) { return PARTS_NEED[key] || 25; }
  // gold value of ONE salvaged spare part (owned hulls only)
  const SALVAGE_FLAT = {
    mothership: 40000, oblivionspear: 100000, oblivionspearalpha: 150000,
    oblivionfinal: 200000, dread1: 250000, dread2: 300000, dread3: 350000,
    dread4: 400000, dread5: 450000, dread6: 550000, titansina: 1000000,
  };
  function salvageValue(key) {
    const s = C().SHIP_BY_KEY[key];
    if (s && s.price) return Math.max(500, Math.round(s.price * 0.02 / 10) * 10);
    return SALVAGE_FLAT[key] || 500;
  }

  // every hull the Shipworks can build, in chain order
  function buildable() { return C().SHIPS.filter((s) => PARTS_NEED[s.key] != null); }

  // ---- CRATE LEVELS ---------------------------------------------------------
  // Built lazily so CONFIG is guaranteed present.
  let _crates = null, _byId = null;
  function crates() {
    if (_crates) return _crates;
    _crates = [
      { id: 'c1', lvl: 1, name: 'Dock Crate', accent: '#8fb7d6',
        keys: ['frigate', 'interceptor', 'cruiser', 'heavycruiser', 'destroyer', 'battleship'],
        tag: 'Line hulls · Frigate → Battleship' },
      { id: 'c2', lvl: 2, name: 'Forge Crate', accent: '#d0a060',
        keys: ['cruiser', 'heavycruiser', 'destroyer', 'battleship', 'dreadnought', 'carrier', 'aegis'],
        tag: 'Heavy hulls · Cruiser → Aegis' },
      { id: 'c3', lvl: 3, name: 'Assembly Vault', accent: '#c07bff',
        keys: ['dreadnought', 'carrier', 'aegis', 'supercarrier', 'titan', 'mothership'],
        tag: 'Capital hulls · Dreadnought → Mothership' },
      { id: 'c4', lvl: 4, name: 'Oblivion Cache', accent: '#7cff9b',
        keys: ['mothership', 'oblivionspear', 'oblivionspearalpha', 'oblivionfinal'],
        tag: 'Forbidden hulls · Mothership → Oblivion Final' },
      { id: 'c5', lvl: 5, name: 'Titan Reliquary', accent: '#ff5a68',
        keys: ['dread1', 'dread2', 'dread3', 'dread4', 'dread5', 'dread6', 'titansina'],
        tag: 'Final class · Dread Reaver → TITAN SINA' },
    ];
    _byId = {}; _crates.forEach((c) => (_byId[c.id] = c));
    return _crates;
  }
  function crateById(id) { crates(); return _byId[id]; }

  // ---- COST -----------------------------------------------------------------
  // L1/L2 gold scales with your deepest zone (like Galaxy Supply) so the entry
  // crates stay meaningful; upper levels are flat premium prices.
  // Economy pass: L1–L3 are ×50 the original tuning.
  function unitCost(cr) {
    if (cr.lvl === 1) { const s = C().dungeonScale(hz()); return { gold: Math.round(11000000 * Math.pow(s, 0.7) + 6000000) }; }
    if (cr.lvl === 2) { const s = C().dungeonScale(hz()); return { gold: Math.round(45000000 * Math.pow(s, 0.7) + 25000000), iron: 12500000 }; }
    if (cr.lvl === 3) return { fuel: 45000000, plasma: 22500000 };
    if (cr.lvl === 4) return { credits: 15000 };
    return { credits: 60000, dreadCores: 500 };
  }
  const BULK = 10, BULK_MULT = 9; // 10× opens for the price of 9 — odds unchanged
  function costFor(cr, qty) {
    const u = unitCost(cr), m = qty === BULK ? BULK_MULT : qty, out = {};
    for (const k in u) out[k] = Math.ceil(u[k] * m);
    return out;
  }
  function costParts(cr, qty) {
    const c = costFor(cr, qty), parts = [];
    for (const k of ['gold', 'fuel', 'iron', 'plasma', 'dreadCores', 'credits']) if (c[k]) parts.push({ cur: k, amt: c[k] });
    return parts;
  }
  function canAfford(cr, qty) { return costParts(cr, qty).every((p) => CUR[p.cur].get() >= p.amt); }
  function spend(cr, qty) {
    const c = costFor(cr, qty), st = G().state;
    if (c.gold) st.gold -= c.gold;
    if (c.fuel || c.iron || c.plasma) { st.resources = st.resources || { fuel: 0, iron: 0, plasma: 0 }; st.resources.fuel -= c.fuel || 0; st.resources.iron -= c.iron || 0; st.resources.plasma -= c.plasma || 0; }
    if (c.dreadCores) st.dreadCores = (st.dreadCores || 0) - c.dreadCores;
    if (c.credits) st.credits = (st.credits || 0) - c.credits;
  }

  // ---- ROLLS ----------------------------------------------------------------
  // Part quantity per open — published, fixed odds. 2% MEGA DROP of 25.
  const QTY_ODDS = [
    { n: 3, w: 34 }, { n: 4, w: 30 }, { n: 5, w: 20 },
    { n: 6, w: 10 }, { n: 8, w: 4 }, { n: 25, w: 2 },
  ];
  function rollQty() {
    const total = QTY_ODDS.reduce((a, o) => a + o.w, 0);
    let r = Math.random() * total;
    for (const o of QTY_ODDS) { r -= o.w; if (r <= 0) return o.n; }
    return 3;
  }
  // Hulls you own never drop; remaining hulls are weighted toward the EARLIEST
  // in the band, so each crate mostly feeds your next ship.
  function eligible(cr) { return cr.keys.filter((k) => !owned(k)); }
  function shipWeights(cr) {
    const el = eligible(cr);
    const ws = el.map((k, i) => ({ key: k, w: 1 / (1 + i * 0.85) }));
    const total = ws.reduce((a, o) => a + o.w, 0) || 1;
    ws.forEach((o) => (o.p = o.w / total));
    return ws;
  }
  function rollShip(cr) {
    const ws = shipWeights(cr);
    if (!ws.length) return null;
    let r = Math.random();
    for (const o of ws) { r -= o.p; if (r <= 0) return o.key; }
    return ws[ws.length - 1].key;
  }

  // ---- OPEN -----------------------------------------------------------------
  // Parts deposit straight into the Shipworks inventory (no cap) at open time;
  // the reveal is informational. Returns aggregated results per hull.
  function openCrate(cr, qty) {
    const agg = {}; let mega = 0;
    for (let i = 0; i < qty; i++) {
      const key = rollShip(cr); if (!key) break;
      const n = rollQty(); if (n === 25) mega++;
      agg[key] = (agg[key] || 0) + n;
      addParts(key, n);
    }
    return { agg, mega };
  }

  // ===========================================================================
  // RENDER
  // ===========================================================================
  let tab = 'crates';
  function readyCount() { return buildable().filter((s) => !owned(s.key) && partsOf(s.key) >= needOf(s.key)).length; }

  function render() {
    const body = $('shipworks-body'); if (!body) return;
    const all = buildable();
    const built = all.filter((s) => owned(s.key)).length;
    const sub = $('shipworks-sub');
    if (sub) sub.textContent = built + ' / ' + all.length + ' hulls built';
    const ready = readyCount();
    body.innerHTML =
      '<div class="sw-tabs">' +
        '<button class="sw-tab' + (tab === 'crates' ? ' on' : '') + '" data-swtab="crates">Crates</button>' +
        '<button class="sw-tab' + (tab === 'inv' ? ' on' : '') + '" data-swtab="inv">Inventory' +
          (ready ? '<span class="sw-tab-badge">' + ready + '</span>' : '') + '</button>' +
        '<button class="sw-tab' + (tab === 'ex' ? ' on' : '') + '" data-swtab="ex">⇄ Exchange</button>' +
      '</div>' +
      (tab === 'crates' ? crateTab() : tab === 'ex' ? exTab() : invTab());
    wire(body);
    updateBadge();
  }

  // ---- CRATES tab -----------------------------------------------------------
  function crateTab() {
    return '<div class="sw-intro">Open crates for random <b>ship parts</b> from that level\u2019s band — hulls you already own never drop. Collect a hull\u2019s full part count in the <b>Parts Inventory</b> and assemble it to <b>unlock the ship outright</b> — no blueprint, no kill grind.</div>' +
      crates().map(crateCard).join('');
  }

  function crateCard(cr) {
    const el = eligible(cr);
    const done = !el.length;
    const afford1 = canAfford(cr, 1), afford10 = canAfford(cr, BULK);
    const thumbs = cr.keys.map((k) =>
      '<span class="sw-thumb' + (owned(k) ? ' own' : '') + '" title="' + C().SHIP_BY_KEY[k].name + (owned(k) ? ' · owned' : '') + '">' +
        '<img src="' + shipImg(k) + '" alt="">' + (owned(k) ? '<i>✓</i>' : '') + '</span>').join('');
    return '<div class="sw-card' + (done ? ' done' : '') + '" style="--acc:' + cr.accent + '">' +
      '<div class="sw-lvl">LEVEL ' + cr.lvl + '</div>' +
      '<div class="sw-card-head">' +
        '<div class="sw-crate">' + crateSVG(cr.accent, cr.lvl) + '</div>' +
        '<div class="sw-card-t">' +
          '<div class="sw-name">' + cr.name + '</div>' +
          '<div class="sw-band">' + cr.tag + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="sw-thumbs">' + thumbs + '</div>' +
      (done
        ? '<div class="sw-done-note">✓ Every hull in this band is already built</div>'
        : '<button class="sw-odds-toggle" data-odds="' + cr.id + '">View live drop odds</button>' +
          '<div class="sw-odds" id="sw-odds-' + cr.id + '">' + oddsRows(cr) + '</div>' +
          '<div class="sw-buys">' +
            '<button class="sw-buy" data-open="' + cr.id + ':1"' + (afford1 ? '' : ' disabled') + '>' +
              '<span class="sw-buy-q">Open 1×</span>' + costLine(cr, 1) + '</button>' +
            '<button class="sw-buy bulk" data-open="' + cr.id + ':' + BULK + '"' + (afford10 ? '' : ' disabled') + '>' +
              '<span class="sw-buy-q">Open 10×<span class="sw-save">−10%</span></span>' + costLine(cr, BULK) + '</button>' +
          '</div>') +
    '</div>';
  }

  function oddsRows(cr) {
    const ws = shipWeights(cr);
    const ships = ws.map((o) => {
      const s = C().SHIP_BY_KEY[o.key];
      return '<div class="sw-orow">' +
        '<img class="sw-oimg" src="' + shipImg(o.key) + '" alt="">' +
        '<span class="sw-oname">' + s.name + '</span>' +
        '<span class="sw-obar"><i style="width:' + clamp(o.p * 100, 2, 100) + '%"></i></span>' +
        '<span class="sw-opct">' + pct(o.p * 100) + '</span></div>';
    }).join('');
    const qtyTotal = QTY_ODDS.reduce((a, o) => a + o.w, 0);
    const qty = QTY_ODDS.map((o) =>
      '<span class="sw-qchip' + (o.n === 25 ? ' mega' : '') + '">' + (o.n === 25 ? '★ 25' : o.n) + ' <i>' + pct(o.w / qtyTotal * 100) + '</i></span>').join('');
    return '<div class="sw-odds-sec">Which hull — excludes hulls you own</div>' + ships +
      '<div class="sw-odds-sec">How many parts per open</div>' +
      '<div class="sw-qrow">' + qty + '</div>' +
      '<div class="sw-odds-note">Published odds · every open is independent</div>';
  }

  function costLine(cr, qty) {
    return '<span class="sw-cost">' + costParts(cr, qty).map((p) =>
      '<span class="sw-c" style="color:' + CUR[p.cur].color + '">' + CUR[p.cur].glyph + ' ' + fmt(p.amt) + '</span>'
    ).join('') + '</span>';
  }

  // ---- INVENTORY tab --------------------------------------------------------
  function invTab() {
    const rows = buildable().map(invRow).join('');
    return '<div class="sw-intro">Every part you\u2019ve pulled, hull by hull. Reach the full count and hit <b>ASSEMBLE</b> to unlock the ship. Spare parts of hulls you own salvage for gold.</div>' +
      '<div class="sw-inv">' + rows + '</div>';
  }

  function invRow(s) {
    const key = s.key, have = partsOf(key), need = needOf(key), isOwned = owned(key);
    const ready = !isOwned && have >= need;
    const p = clamp(have / need * 100, 0, 100);
    let action = '';
    if (ready) action = '<button class="sw-asm" data-asm="' + key + '">ASSEMBLE</button>';
    else if (isOwned && have > 0) action = (have >= EX_RATE && nextKey(key) ? '<button class="sw-salv" data-extrade="' + key + '" title="Shard Exchange" style="margin-right:6px">⇄</button>' : '') + '<button class="sw-salv" data-salv="' + key + '">Salvage ' + have + ' → <span style="color:#f2b24b">● ' + fmt(have * salvageValue(key)) + '</span></button>';
    else if (isOwned) action = '<span class="sw-ownchip">OWNED</span>';
    return '<div class="sw-row' + (ready ? ' ready' : '') + (isOwned ? ' own' : '') + '" data-comment-anchor="sw-row-' + key + '">' +
      '<img class="sw-row-img" src="' + shipImg(key) + '" alt="">' +
      '<div class="sw-row-mid">' +
        '<div class="sw-row-top"><span class="sw-row-name">' + s.name + '</span>' +
          (ready ? '<span class="sw-readychip">READY</span>' : isOwned ? '' : '<span class="sw-row-cnt">' + have + ' / ' + need + '</span>') +
        '</div>' +
        (isOwned
          ? '<div class="sw-row-sub">In your hangar</div>'
          : '<div class="sw-pbar"><i style="width:' + p + '%"></i></div>') +
      '</div>' +
      (action ? '<div class="sw-row-act">' + action + '</div>' : '') +
    '</div>';
  }

  // ===========================================================================
  // ⇄ SHARD EXCHANGE — trade parts UP the chain, 10 : 1 per step
  // ===========================================================================
  const EX_RATE = 10;   // 10 parts of a hull → 1 part of the NEXT hull in the chain
  function nextKey(key) { const b = buildable(); const i = b.findIndex((s) => s.key === key); return i >= 0 && i < b.length - 1 ? b[i + 1].key : null; }

  function exTab() {
    const rows = buildable().filter((s) => partsOf(s.key) > 0 && nextKey(s.key)).map((s) => {
      const key = s.key, have = partsOf(key), nk = nextKey(key), ns = C().SHIP_BY_KEY[nk];
      const can = have >= EX_RATE;
      return '<div class="sw-exrow' + (can ? '' : ' dim') + '">' +
        '<img src="' + shipImg(key) + '" alt="">' +
        '<div class="sw-exmid">' +
          '<div class="sw-exname">' + s.name + (owned(key) ? ' <i class="sw-exspare">SPARES</i>' : '') + '</div>' +
          '<div class="sw-exsub">× ' + fmt(have) + ' parts → <img src="' + shipImg(nk) + '" alt=""> ' + ns.name + '</div>' +
        '</div>' +
        '<button class="sw-exbtn" data-extrade="' + key + '"' + (can ? '' : ' disabled') + '>⇄ TRADE</button>' +
      '</div>';
    }).join('');
    return '<div class="sw-intro"><b>Shard Exchange</b> — trade <b>' + EX_RATE + ' parts</b> of any hull for <b>1 part of the next hull up the chain</b>. Spare parts from hulls you already own climb too — all the way to the <b>TITAN SINA</b>.</div>' +
      (rows || '<div class="sw-exempty">No parts to trade yet — open crates first. Spares from hulls you own can climb instead of being salvaged.</div>');
  }

  function openExchange(key) {
    const s = C().SHIP_BY_KEY[key], nk = nextKey(key); if (!s || !nk) return;
    const ns = C().SHIP_BY_KEY[nk];
    const o = overlay(); o.className = 'show';
    let t = 1;   // number of trades (×10 parts each)
    const maxT = () => Math.floor(partsOf(key) / EX_RATE);
    o.innerHTML =
      '<div class="sw-exch">' +
        '<div class="sw-rev-t">SHARD EXCHANGE</div>' +
        '<div class="sw-exflow">' +
          '<div class="sw-excard"><img src="' + shipImg(key) + '" alt=""><b id="sw-exgive"></b><span>' + s.name + '</span></div>' +
          '<div class="sw-exarr">⇄</div>' +
          '<div class="sw-excard get"><img src="' + shipImg(nk) + '" alt=""><b id="sw-exget"></b><span>' + ns.name + '</span></div>' +
        '</div>' +
        '<div class="sw-exrate">' + EX_RATE + ' : 1 · you hold ' + fmt(partsOf(key)) + ' ' + s.name + ' parts</div>' +
        '<div class="sw-exq">' +
          '<button data-exq="-1">−</button><button data-exq="1">+</button><button data-exq="max">MAX</button>' +
        '</div>' +
        '<div class="sw-rev-btns">' +
          '<button class="sw-accept" id="sw-exgo"></button>' +
          '<button class="sw-skip" id="sw-excancel" style="margin-top:0">Cancel</button>' +
        '</div>' +
      '</div>';
    const give = o.querySelector('#sw-exgive'), get = o.querySelector('#sw-exget'), go = o.querySelector('#sw-exgo');
    const paint = () => {
      t = clamp(t, 1, Math.max(1, maxT()));
      give.textContent = '−' + fmt(t * EX_RATE);
      get.textContent = '+' + fmt(t);
      go.textContent = 'EXCHANGE → +' + fmt(t) + ' ' + ns.name.toUpperCase() + (t > 1 ? ' PARTS' : ' PART');
      go.disabled = maxT() < 1;
    };
    o.querySelectorAll('[data-exq]').forEach((b) => b.onclick = () => {
      const v = b.dataset.exq;
      if (v === 'max') t = maxT(); else t += +v;
      paint();
    });
    o.querySelector('#sw-excancel').onclick = () => { closeOverlay(); render(); };
    go.onclick = () => {
      const n = Math.min(t, maxT()); if (n < 1) return;
      addParts(key, -n * EX_RATE); addParts(nk, n);
      try { G().save(); } catch (e) {}
      if (window.UI && window.UI.refreshAll) window.UI.refreshAll();
      toast('⇄ ' + fmt(n * EX_RATE) + ' ' + s.name + ' parts → ' + fmt(n) + ' ' + ns.name + ' part' + (n > 1 ? 's' : ''));
      closeOverlay(); tab = 'ex'; render();
    };
    paint();
  }

  // ---- wiring ---------------------------------------------------------------
  function wire(body) {
    body.querySelectorAll('[data-swtab]').forEach((b) => b.onclick = () => { tab = b.dataset.swtab; render(); });
    body.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => {
      const [id, qty] = b.dataset.open.split(':'); attemptOpen(id, +qty);
    });
    body.querySelectorAll('[data-odds]').forEach((b) => b.onclick = () => {
      const card = $('sw-odds-' + b.dataset.odds); if (!card) return;
      const open = card.classList.toggle('open'); b.textContent = open ? 'Hide drop odds' : 'View live drop odds';
    });
    body.querySelectorAll('[data-asm]').forEach((b) => b.onclick = () => assemble(b.dataset.asm));
    body.querySelectorAll('[data-extrade]').forEach((b) => b.onclick = () => openExchange(b.dataset.extrade));
    body.querySelectorAll('[data-salv]').forEach((b) => b.onclick = () => salvage(b.dataset.salv));
  }

  // ===========================================================================
  // OPEN FLOW — spend → crate burst → parts reveal
  // ===========================================================================
  function attemptOpen(id, qty) {
    const cr = crateById(id); if (!cr) return;
    if (!eligible(cr).length) return;
    if (!canAfford(cr, qty)) { toast('Not enough ' + costParts(cr, 1).map((p) => CUR[p.cur].name).join(' / ')); return; }
    spend(cr, qty);
    const res = openCrate(cr, qty);
    try { G().save(); } catch (e) {}
    if (window.UI && window.UI.refreshAll) window.UI.refreshAll();
    showOpening(cr, res);
  }

  function overlay() {
    let o = $('sw-overlay');
    if (!o) { o = document.createElement('div'); o.id = 'sw-overlay'; ($('screen-shipworks') || document.body).appendChild(o); }
    return o;
  }
  function closeOverlay() { const o = $('sw-overlay'); if (o) { o.classList.remove('show'); o.innerHTML = ''; } }

  function showOpening(cr, res) {
    const o = overlay(); o.className = 'show';
    o.innerHTML =
      '<div class="sw-open" style="--acc:' + cr.accent + '">' +
        '<div class="sw-open-crate">' + crateSVG(cr.accent, cr.lvl) + '<div class="sw-open-glow"></div></div>' +
        '<div class="sw-open-t">Opening ' + cr.name + '…</div>' +
        '<button class="sw-skip">Skip</button>' +
      '</div>';
    const openEl = o.querySelector('.sw-open');
    let done = false;
    const go = () => { if (done) return; done = true; showReveal(cr, res); };
    o.querySelector('.sw-skip').onclick = go;
    setTimeout(() => { if (openEl) openEl.classList.add('burst'); }, 620);
    setTimeout(go, 1250);
  }

  function showReveal(cr, res) {
    const keys = Object.keys(res.agg).sort((a, b) => C().SHIP_BY_KEY[b].tier - C().SHIP_BY_KEY[a].tier);
    const nReady = readyCount();
    const o = overlay(); o.className = 'show';
    const cards = keys.map((k) => {
      const s = C().SHIP_BY_KEY[k], have = partsOf(k), need = needOf(k);
      const ready = !owned(k) && have >= need;
      return '<div class="sw-drop' + (ready ? ' ready' : '') + '" style="--acc:' + cr.accent + '">' +
        '<img src="' + shipImg(k) + '" alt="">' +
        '<div class="sw-drop-n">+' + res.agg[k] + ' <i>PARTS</i></div>' +
        '<div class="sw-drop-name">' + s.name + '</div>' +
        '<div class="sw-drop-prog">' + Math.min(have, need) + ' / ' + need + (ready ? ' · <b>READY</b>' : '') + '</div>' +
      '</div>';
    }).join('');
    o.innerHTML =
      '<div class="sw-reveal" style="--acc:' + cr.accent + '">' +
        '<div class="sw-rev-t">PARTS RECOVERED</div>' +
        (res.mega ? '<div class="sw-mega">★ MEGA DROP' + (res.mega > 1 ? ' ×' + res.mega : '') + ' — 25 parts!</div>' : '') +
        '<div class="sw-rev-grid">' + cards + '</div>' +
        '<div class="sw-rev-btns">' +
          (nReady ? '<button class="sw-toinv">Assemble now (' + nReady + ' ready) →</button>' : '') +
          '<button class="sw-accept">Store parts</button>' +
        '</div>' +
      '</div>';
    [...o.querySelectorAll('.sw-drop')].forEach((c, i) => { c.style.animationDelay = (i * 80) + 'ms'; });
    o.querySelector('.sw-accept').onclick = () => { closeOverlay(); render(); };
    const ti = o.querySelector('.sw-toinv');
    if (ti) ti.onclick = () => { closeOverlay(); tab = 'inv'; render(); };
  }

  // ===========================================================================
  // ASSEMBLE + SALVAGE
  // ===========================================================================
  function assemble(key) {
    const g = G(), s = C().SHIP_BY_KEY[key];
    if (!s || owned(key)) return;
    const need = needOf(key);
    if (partsOf(key) < need) return;
    g.state.shipParts[key] -= need;
    if (!g.grantShip(key)) { g.state.shipParts[key] += need; return; }
    if (window.UI && window.UI.refreshAll) window.UI.refreshAll();
    showAssembled(s);
  }

  function showAssembled(s) {
    const o = overlay(); o.className = 'show';
    o.innerHTML =
      '<div class="sw-built">' +
        '<div class="sw-built-halo"><img src="' + shipImg(s.key) + '" alt=""></div>' +
        '<div class="sw-built-k">HULL ASSEMBLED</div>' +
        '<div class="sw-built-name">' + s.name + '</div>' +
        '<div class="sw-built-tag">' + (s.tag || '') + '</div>' +
        '<div class="sw-rev-btns">' +
          '<button class="sw-toinv" data-fly>Fly it now</button>' +
          '<button class="sw-accept" data-later>To the hangar</button>' +
        '</div>' +
      '</div>';
    o.querySelector('[data-later]').onclick = () => { closeOverlay(); render(); };
    o.querySelector('[data-fly]').onclick = () => {
      try { G().switchShip(s.key); } catch (e) {}
      closeOverlay(); render();
      toast('🚀 Now flying the ' + s.name);
    };
  }

  function salvage(key) {
    const g = G(), n = partsOf(key);
    if (!n || !owned(key)) return;
    const val = n * salvageValue(key);
    g.state.shipParts[key] = 0;
    g.state.gold = (g.state.gold || 0) + val;
    g.save();
    if (window.UI && window.UI.refreshAll) window.UI.refreshAll();
    toast('♻ Salvaged ' + n + ' spare parts → ● ' + fmt(val) + ' gold');
    render();
  }

  function toast(m) { try { if (window.UI && window.UI.unlockToast) window.UI.unlockToast(m); } catch (e) {} }

  // ---- Command-card badge: hulls ready to assemble --------------------------
  function updateBadge() {
    const b = $('cmd-works-badge'); if (!b) return;
    let n = 0; try { n = readyCount(); } catch (e) { n = 0; }
    b.style.display = n ? '' : 'none'; b.textContent = n;
  }

  // ---- crate glyph — hex crate with a part-gear core ------------------------
  function crateSVG(c, lvl) {
    let pips = '';
    for (let i = 0; i < lvl; i++) pips += '<circle cx="' + (14 + i * 5) + '" cy="42" r="1.6" fill="' + c + '"/>';
    return '<svg viewBox="0 0 48 48" fill="none">' +
      '<path d="M24 3l18 9v22l-18 9-18-9V12z" stroke="' + c + '" stroke-width="2.2" fill="rgba(255,255,255,.04)"/>' +
      '<path d="M6 12l18 9 18-9M24 21v22" stroke="' + c + '" stroke-width="1.5" opacity=".65"/>' +
      '<circle cx="24" cy="21" r="5.2" stroke="' + c + '" stroke-width="1.8" fill="rgba(255,255,255,.05)"/>' +
      '<path d="M24 13.4v3.2M24 25.4v3.2M17.5 17.2l2.8 1.6M27.7 23l2.8 1.6M30.5 17.2l-2.8 1.6M20.3 23l-2.8 1.6" stroke="' + c + '" stroke-width="1.8" stroke-linecap="round"/>' +
      pips + '</svg>';
  }

  function pct(p) {
    if (p >= 10) return Math.round(p) + '%';
    if (p >= 1) return p.toFixed(1) + '%';
    return p.toFixed(2) + '%';
  }

  // ===========================================================================
  // BOOT + CSS
  // ===========================================================================
  // ===========================================================================
  // ORPHANED SHARD RECOVERY — one time, on the build that narrowed the pool
  // ===========================================================================
  // Between builds 660 and 666 the Tour of Duty paid shards from a pool that was
  // wider than this roster, so players banked parts toward hulls that have no
  // PARTS_NEED entry: no Inventory row, no Exchange row, no ASSEMBLE, no salvage.
  // Narrowing the pool stopped new ones, but the balances already earned would
  // have gone silently unreachable. Every orphan is bought back at the hull's own
  // salvage rate — the same figure a spare part is worth anywhere else — and the
  // key is cleared so the entry cannot rot in the save.
  //
  // ---------------------------------------------------------------------------
  // WHAT "UNREACHABLE" ACTUALLY MEANS (Aug 2026 — the Voidmaw shard wipe)
  // ---------------------------------------------------------------------------
  // The sweep defined it as "not in PARTS_NEED", i.e. not buildable HERE. That is
  // not the same thing, and the difference cost every event player their season:
  // ❖ VOIDMAW PARTS are redeemed by server-dreadnaught.js at 150, not by the
  // Shipworks, and `voidmaw` has no PARTS_NEED entry — so on the first load after
  // the patch the sweep deleted the entire Voidmaw grind and paid out salvage gold
  // for it. Six weeks of daily first-fight bonuses, daily rank claims and 1,500-✦
  // store buys, gone, with a toast calling them "unusable shards".
  //
  // The rule is now the honest one: a shard is only an orphan if its key names NO
  // HULL IN THE GAME. A real hull's shards are never touched here — the Shipworks
  // is not the only thing in the galaxy that redeems them, and a balance sitting
  // in the save costs nothing while a deleted one cannot be recovered.
  //
  // Anything the sweep does buy back is now written to `shardSweepLog` first, so a
  // future repair has a receipt to work from rather than guesswork.
  function knownHullKeys() {
    const k = {};
    try { C().SHIPS.forEach((s) => { k[s.key] = 1; }); } catch (e) {}
    return k;
  }
  function recoverOrphanShards() {
    const g = G(); if (!g || !g.state) return;
    const st = g.state;
    if (st.shardOrphanFix === 2 || !st.shipParts) return;
    st.shardOrphanFix = 2;   // 2 = swept under the key-names-a-real-hull rule
    const known = knownHullKeys();
    if (!Object.keys(known).length) { st.shardOrphanFix = 1; return; }   // CONFIG not up — try again next boot
    let gold = 0, parts = 0;
    const log = [];
    for (const k in st.shipParts) {
      const n = st.shipParts[k] | 0;
      if (n <= 0) { if (!known[k]) delete st.shipParts[k]; continue; }
      if (known[k]) continue;                       // a real hull — never swept
      gold += n * salvageValue(k);
      parts += n;
      log.push({ k, n, at: Date.now() });
      delete st.shipParts[k];
    }
    if (parts > 0) {
      st.shardSweepLog = (st.shardSweepLog || []).concat(log).slice(-50);
      st.gold = (st.gold || 0) + gold;
      toast('\u25c8 ' + parts + ' shard' + (parts === 1 ? '' : 's') + ' for retired hulls bought back \u00b7 \u25cf ' + fmt(gold) + ' gold');
    }
    try { g.save(); } catch (e) {}
    try { if (window.UI && window.UI.refreshAll) window.UI.refreshAll(); } catch (e) {}
  }

  // ===========================================================================
  // ❖ VOIDMAW SHARD RESTITUTION — undo what the old sweep took
  // ===========================================================================
  // Same two-tier rule the moon-colony repair uses, and for the same reason:
  // where the player's own pre-sweep data survives we restore the REAL number,
  // and where it does not we do not invent one.
  //
  // account.js keeps three snapshots of a whole save on the device — the untouched
  // cloud copy stashed before every merge (`lf-backup`), the losing side of a save
  // conflict (`lf-conflict`) and the heaviest save this account has ever had here
  // (`lf-best`). Any of them predating the sweep still holds the true shard count.
  // Per-key MAX across all three, then max against what is in the save now.
  //
  // Deliberately narrow, because a snapshot is old data and old data is dangerous:
  //   • only keys with NO PARTS_NEED entry — exactly the set the old sweep could
  //     delete. Buildable hulls are untouched, so their balances are current and
  //     restoring an old max would refund parts already spent on an assembly.
  //   • only hulls NOT owned. Assembling a Voidmaw spends its 150 parts; if the
  //     hull is in the hangar the low balance is correct, not damage.
  //   • the salvage gold is NOT clawed back. It was paid weeks ago and has been
  //     spent; taking it back now would be a second silent loss.
  // Runs once per account, and only where the old sweep actually ran.
  function restoreSweptShards() {
    const g = G(); if (!g || !g.state) return;
    const st = g.state;
    if (st.vmShardRestore || !st.shardOrphanFix) return;
    let uid = null;
    try { uid = window.ACCOUNT && window.ACCOUNT.uid && window.ACCOUNT.uid(); } catch (e) {}
    if (!uid) return;   // signed out: wait for a session rather than banking "nothing survived"
    const best = {};
    ['lf-backup::', 'lf-conflict::', 'lf-best::'].forEach((p) => {
      let snap = null;
      try { const raw = localStorage.getItem(p + uid); if (raw) snap = JSON.parse(raw); } catch (e) {}
      const sp = snap && snap.shipParts;
      if (!sp) return;
      for (const k in sp) { const n = sp[k] | 0; if (n > (best[k] | 0)) best[k] = n; }
    });
    const restored = [];
    for (const k in best) {
      if (PARTS_NEED[k] != null) continue;          // never swept — balance is current
      if (owned(k)) continue;                      // already assembled: spending it was legitimate
      const have = partsOf(k), want = best[k] | 0;
      if (want <= have) continue;
      addParts(k, want - have);
      restored.push({ k, n: want - have });
    }
    st.vmShardRestore = { at: Date.now(), n: restored.reduce((a, r) => a + r.n, 0), keys: restored.map((r) => r.k) };
    if (restored.length) {
      const total = st.vmShardRestore.n;
      const nm = (k) => { try { return (C().SHIP_BY_KEY[k] || {}).name || k; } catch (e) { return k; } };
      const list = restored.map((r) => r.n + '\u00d7 ' + nm(r.k)).join(', ');
      try {
        if (window.MAIL) window.MAIL.push({
          ic: '\u2756', title: 'Your shards are back',
          body: '<b>' + total + ' ship shard' + (total === 1 ? '' : 's') + '</b> have been returned to your parts inventory: ' + list + '.' +
            '<div style="margin-top:8px;opacity:.8">A cleanup patch treated them as shards for hulls that cannot be built. \u2756 Voidmaw Parts are assembled at the Server Dreadnaught event, not the Shipworks, so they should never have been swept. ' +
            'The salvage gold you were paid is yours to keep.</div>',
        });
      } catch (e) {}
      toast('\u2756 ' + total + ' shard' + (total === 1 ? '' : 's') + ' restored \u2014 see your mail');
    }
    try { g.save(); } catch (e) {}
    try { if (window.UI && window.UI.refreshAll) window.UI.refreshAll(); } catch (e) {}
  }

  function boot() {
    injectCSS();
    // deferred: CONFIG and the save both have to be up before the sweep can run.
    // Restitution goes FIRST — it reads the pre-sweep snapshots, and the sweep
    // under the new rule must not see a half-restored inventory.
    setTimeout(() => { try { restoreSweptShards(); } catch (e) {} try { recoverOrphanShards(); } catch (e) {} }, 2500);
    setInterval(() => { if (document.hidden) return; try { if (window.GAME && GAME.state) updateBadge(); } catch (e) {} }, 2500);
  }
  function injectCSS() {
    if ($('sw-css')) return;
    const s = document.createElement('style'); s.id = 'sw-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  // THE CANONICAL BUILDABLE ROSTER, in chain order. Any hull NOT on this list has
  // no part requirement, no Exchange row and no way to be assembled — so nothing
  // may hand out shards toward it. season-pass.js reads this to build its crate
  // pool; the two lists drifting is what let the Tour pay shards for hulls the
  // Shipworks could not redeem.
  window.SHIPWORKS = { render, buildableKeys: () => buildable().map((s) => s.key) };

  const CSS = `
  /* Command card */
  .mega-card.cmd-works .mc-ic{ color:#6ee7ff; border-color:rgba(110,231,255,.5); background:radial-gradient(120% 120% at 50% 0%,#12283a,#0e1420); box-shadow:0 0 14px -3px rgba(110,231,255,.7); }
  .mega-card.cmd-works .mc-n{ color:#c9f2ff; }
  .mega-card.cmd-works::before{ background:linear-gradient(130deg,#6ee7ff,#5b9cff,#c07bff,#6ee7ff); background-size:250% 250%; }
  #screen-shipworks .scr-title{ color:#6ee7ff; }

  #shipworks-body{ padding:12px; }
  .sw-intro{ font-size:12px; color:#9fb1c4; line-height:1.55; background:linear-gradient(180deg,#101826,#0c1220); border:1px solid #1e2f44; border-radius:12px; padding:11px 13px; margin-bottom:12px; }
  .sw-intro b{ color:#e7f0fb; }

  /* tabs */
  .sw-tabs{ display:grid; grid-template-columns:repeat(3,1fr); gap:6px; padding:4px; background:rgba(8,12,20,.72); border:1px solid #26324a; border-radius:13px; margin-bottom:12px; }
  .sw-tab{ position:relative; appearance:none; border:0; cursor:pointer; padding:10px 4px; border-radius:9px; font-family:'Rajdhani',sans-serif; font-weight:700; font-size:12.5px; letter-spacing:.02em; color:#93a2ba; background:transparent; transition:color .18s, background .18s; }
  .sw-tab.on{ color:#08131c; background:linear-gradient(180deg,#8ff0ff,#4fc3ef); box-shadow:0 6px 16px rgba(95,209,255,.25); }
  .sw-tab-badge{ position:absolute; top:2px; right:6px; min-width:16px; height:16px; padding:0 4px; border-radius:8px; background:#ff495f; color:#fff; font-size:10px; font-weight:800; line-height:16px; box-shadow:0 0 0 2px #0b1019; }

  /* crate cards */
  .sw-card{ border:1px solid color-mix(in srgb, var(--acc) 40%, #223245); border-radius:16px; padding:14px; margin-bottom:12px; position:relative; overflow:hidden;
    background:linear-gradient(180deg, color-mix(in srgb, var(--acc) 8%, #0e1725), #0b1220); }
  .sw-card::after{ content:''; position:absolute; inset:0 0 auto 0; height:2px; background:linear-gradient(90deg,transparent,var(--acc),transparent); opacity:.6; }
  .sw-card.done{ opacity:.62; }
  .sw-lvl{ position:absolute; top:0; right:0; font-family:'Orbitron',sans-serif; font-weight:800; font-size:8.5px; letter-spacing:.14em; color:#08131c; background:linear-gradient(180deg, color-mix(in srgb,var(--acc) 85%, #fff), var(--acc)); padding:4px 10px; border-radius:0 16px 0 12px; }
  .sw-card-head{ display:flex; gap:12px; align-items:center; }
  .sw-crate{ width:52px; height:52px; flex:none; filter:drop-shadow(0 0 8px color-mix(in srgb,var(--acc) 60%,transparent)); }
  .sw-crate svg{ width:52px; height:52px; }
  .sw-name{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:14px; color:#eaf2fb; letter-spacing:.04em; }
  .sw-band{ font-size:10.5px; font-weight:700; letter-spacing:.05em; color:var(--acc); margin-top:3px; }

  .sw-thumbs{ display:flex; gap:6px; flex-wrap:wrap; margin:11px 0 2px; }
  .sw-thumb{ position:relative; width:34px; height:34px; border-radius:9px; background:#0a1119; border:1px solid #22334a; display:grid; place-items:center; }
  .sw-thumb img{ width:26px; height:26px; object-fit:contain; }
  .sw-thumb.own{ opacity:.45; }
  .sw-thumb.own i{ position:absolute; right:-3px; top:-4px; font-style:normal; font-size:9px; color:#7ce0a0; text-shadow:0 0 4px #000; }
  .sw-done-note{ margin-top:10px; font-size:11.5px; font-weight:700; color:#7ce0a0; letter-spacing:.04em; }

  .sw-odds-toggle{ width:100%; margin-top:10px; background:none; border:1px dashed #2b4055; color:#a9c6da; border-radius:9px; padding:7px; font-family:'Rajdhani',sans-serif; font-weight:700; font-size:11.5px; letter-spacing:.04em; cursor:pointer; }
  .sw-odds-toggle:active{ transform:scale(.98); }
  .sw-odds{ max-height:0; overflow:hidden; transition:max-height .28s ease; }
  .sw-odds.open{ max-height:560px; margin-top:8px; }
  .sw-odds-sec{ font-size:9.5px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; color:#7f92a6; margin:8px 0 5px; }
  .sw-orow{ display:flex; align-items:center; gap:8px; padding:3px 0; }
  .sw-oimg{ width:20px; height:20px; object-fit:contain; flex:none; }
  .sw-oname{ font-size:11px; font-weight:700; color:#dbe8f5; width:104px; flex:none; }
  .sw-obar{ flex:1; height:6px; border-radius:4px; background:#0d1520; overflow:hidden; }
  .sw-obar i{ display:block; height:100%; border-radius:4px; background:var(--acc); }
  .sw-opct{ font-size:11px; font-weight:800; color:#dbe8f5; width:46px; text-align:right; flex:none; font-variant-numeric:tabular-nums; }
  .sw-qrow{ display:flex; gap:6px; flex-wrap:wrap; }
  .sw-qchip{ font-size:10.5px; font-weight:800; color:#dbe8f5; background:rgba(255,255,255,.05); border:1px solid #2b4055; border-radius:8px; padding:4px 8px; }
  .sw-qchip i{ font-style:normal; color:#8ba0b5; font-weight:700; margin-left:3px; }
  .sw-qchip.mega{ color:#ffd66a; border-color:rgba(255,214,106,.55); }
  .sw-odds-note{ font-size:9.5px; color:#6f8398; text-align:center; margin-top:8px; letter-spacing:.03em; }

  .sw-buys{ display:flex; gap:9px; margin-top:12px; }
  .sw-buy{ flex:1; border:1px solid color-mix(in srgb,var(--acc) 45%,#25384c); border-radius:11px; padding:9px 6px; cursor:pointer;
    background:color-mix(in srgb,var(--acc) 10%,#0d1622); display:flex; flex-direction:column; align-items:center; gap:4px; transition:transform .08s; }
  .sw-buy:active{ transform:scale(.96); }
  .sw-buy:disabled{ opacity:.4; cursor:default; }
  .sw-buy.bulk{ background:color-mix(in srgb,var(--acc) 18%,#0d1622); border-color:var(--acc); }
  .sw-buy-q{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:12px; color:#f2f7ff; }
  .sw-save{ font-size:8px; color:#7ce0a0; margin-left:4px; vertical-align:2px; letter-spacing:.03em; }
  .sw-cost{ display:flex; gap:7px; flex-wrap:wrap; justify-content:center; }
  .sw-c{ font-size:11px; font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap; }

  /* inventory */
  .sw-inv{ display:flex; flex-direction:column; gap:8px; }
  .sw-row{ display:flex; align-items:center; gap:11px; border:1px solid #223245; border-radius:13px; padding:9px 11px;
    background:linear-gradient(180deg,#0e1725,#0b1220); }
  .sw-row.own{ opacity:.66; }
  .sw-row.ready{ border-color:rgba(124,224,160,.65); box-shadow:0 0 16px -6px rgba(124,224,160,.7); animation:swReadyPulse 2s ease-in-out infinite; }
  @keyframes swReadyPulse{ 0%,100%{ box-shadow:0 0 12px -6px rgba(124,224,160,.55);} 50%{ box-shadow:0 0 20px -4px rgba(124,224,160,.9);} }
  .sw-row-img{ width:40px; height:40px; object-fit:contain; flex:none; filter:drop-shadow(0 2px 6px rgba(0,0,0,.6)); }
  .sw-row-mid{ flex:1; min-width:0; }
  .sw-row-top{ display:flex; align-items:center; gap:8px; }
  .sw-row-name{ font-family:'Orbitron',sans-serif; font-weight:700; font-size:11.5px; color:#eaf2fb; letter-spacing:.02em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .sw-row-cnt{ margin-left:auto; font-size:11px; font-weight:800; color:#9fc2dd; font-variant-numeric:tabular-nums; flex:none; }
  .sw-readychip{ margin-left:auto; flex:none; font-size:9px; font-weight:800; letter-spacing:.1em; color:#08131c; background:linear-gradient(180deg,#9df0bb,#5fd68b); border-radius:7px; padding:2px 7px; }
  .sw-row-sub{ font-size:10px; color:#7f92a6; margin-top:3px; }
  .sw-pbar{ height:7px; border-radius:4px; background:#0a1119; overflow:hidden; margin-top:6px; }
  .sw-pbar i{ display:block; height:100%; border-radius:4px; background:linear-gradient(90deg,#4fc3ef,#8ff0ff); }
  .sw-row.ready .sw-pbar i{ background:linear-gradient(90deg,#5fd68b,#9df0bb); }
  .sw-row-act{ flex:none; display:flex; }
  .sw-asm{ border:none; border-radius:10px; padding:9px 13px; cursor:pointer; font-family:'Orbitron',sans-serif; font-weight:800; font-size:10.5px; letter-spacing:.06em;
    color:#08131c; background:linear-gradient(180deg,#9df0bb,#5fd68b); box-shadow:0 6px 16px -6px rgba(124,224,160,.8); transition:transform .08s; }
  .sw-asm:active{ transform:scale(.95); }
  .sw-salv{ border:1px solid #2b4055; background:rgba(255,255,255,.04); border-radius:9px; padding:7px 9px; cursor:pointer;
    font-family:'Rajdhani',sans-serif; font-weight:700; font-size:10.5px; color:#a9c6da; }
  .sw-salv:active{ transform:scale(.96); }
  .sw-ownchip{ font-size:9px; font-weight:800; letter-spacing:.1em; color:#7f92a6; border:1px solid #2b4055; border-radius:7px; padding:3px 8px; }

  /* ⇄ shard exchange */
  .sw-exrow{ display:flex; align-items:center; gap:11px; border:1px solid #223245; border-radius:13px; padding:9px 11px; margin-bottom:8px; background:linear-gradient(180deg,#0e1725,#0b1220); }
  .sw-exrow.dim{ opacity:.55; }
  .sw-exrow > img{ width:38px; height:38px; object-fit:contain; flex:none; filter:drop-shadow(0 2px 6px rgba(0,0,0,.6)); }
  .sw-exmid{ flex:1; min-width:0; }
  .sw-exname{ font-family:'Orbitron',sans-serif; font-weight:700; font-size:11.5px; color:#eaf2fb; letter-spacing:.02em; }
  .sw-exspare{ font-style:normal; font-size:8px; font-weight:800; letter-spacing:.1em; color:#7f92a6; border:1px solid #2b4055; border-radius:6px; padding:1px 5px; vertical-align:2px; margin-left:5px; }
  .sw-exsub{ display:flex; align-items:center; gap:5px; font-size:10.5px; color:#9fb1c4; margin-top:4px; font-weight:700; }
  .sw-exsub img{ width:16px; height:16px; object-fit:contain; }
  .sw-exbtn{ flex:none; border:1px solid rgba(110,231,255,.55); border-radius:10px; padding:9px 12px; cursor:pointer; font-family:'Orbitron',sans-serif; font-weight:800; font-size:10px; letter-spacing:.06em; color:#8ff0ff; background:rgba(110,231,255,.08); transition:transform .08s; }
  .sw-exbtn:active{ transform:scale(.95); }
  .sw-exbtn:disabled{ opacity:.35; cursor:default; }
  .sw-exempty{ font-size:12px; color:#7f92a6; text-align:center; padding:26px 12px; border:1px dashed #2b4055; border-radius:12px; }
  .sw-exch{ width:100%; max-width:360px; text-align:center; }
  .sw-exflow{ display:flex; align-items:center; justify-content:center; gap:10px; margin-top:6px; }
  .sw-excard{ flex:1; max-width:130px; border:1px solid #2b4055; border-radius:13px; padding:12px 8px; background:linear-gradient(180deg,#0e1725,#0b1220); }
  .sw-excard.get{ border-color:rgba(124,224,160,.6); box-shadow:0 0 16px -7px rgba(124,224,160,.8); }
  .sw-excard img{ width:46px; height:46px; object-fit:contain; }
  .sw-excard b{ display:block; font-family:'Orbitron',sans-serif; font-size:15px; color:#fff; margin-top:4px; }
  .sw-excard.get b{ color:#9df0bb; }
  .sw-excard span{ display:block; font-size:10px; font-weight:700; color:#8ba0b5; margin-top:3px; }
  .sw-exarr{ font-size:20px; font-weight:800; color:#6ee7ff; flex:none; }
  .sw-exrate{ font-size:10.5px; color:#8ba0b5; font-weight:700; margin-top:10px; letter-spacing:.03em; }
  .sw-exq{ display:flex; gap:8px; justify-content:center; margin-top:12px; }
  .sw-exq button{ min-width:46px; padding:9px 12px; border:1px solid #2b4055; border-radius:10px; background:rgba(255,255,255,.05); color:#dbe8f5; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:15px; cursor:pointer; }
  .sw-exq button:active{ transform:scale(.94); }
  .sw-accept:disabled{ opacity:.4; cursor:default; }

  /* overlay */
  #sw-overlay{ position:absolute; inset:0; z-index:14; display:none; align-items:center; justify-content:center; padding:18px;
    background:rgba(6,10,17,.84); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); }
  #sw-overlay.show{ display:flex; }

  .sw-open{ text-align:center; position:relative; }
  .sw-open-crate{ position:relative; width:150px; height:150px; margin:0 auto; display:grid; place-items:center; animation:swShake .5s .12s ease-in-out 2; }
  .sw-open-crate svg{ width:120px; height:120px; position:relative; z-index:2; filter:drop-shadow(0 0 16px var(--acc)); }
  .sw-open-glow{ position:absolute; inset:0; border-radius:50%; background:radial-gradient(circle, color-mix(in srgb,var(--acc) 70%,transparent), transparent 62%); opacity:.55; animation:swPulse 1s ease-in-out infinite; }
  .sw-open-t{ font-family:'Orbitron',sans-serif; font-weight:700; font-size:13px; color:#dbe8f5; letter-spacing:.08em; margin-top:14px; }
  .sw-skip{ margin-top:16px; background:none; border:1px solid #2b4055; color:#9db6cb; border-radius:9px; padding:7px 16px; font-family:'Rajdhani',sans-serif; font-weight:700; font-size:12px; cursor:pointer; }
  .sw-open.burst .sw-open-crate{ animation:swBurst .5s cubic-bezier(.2,.8,.2,1) forwards; }
  .sw-open.burst .sw-open-glow{ animation:swFlash .5s ease-out forwards; }
  @keyframes swShake{ 0%,100%{ transform:rotate(0) translateX(0);} 25%{ transform:rotate(-6deg) translateX(-4px);} 75%{ transform:rotate(6deg) translateX(4px);} }
  @keyframes swPulse{ 0%,100%{ transform:scale(.9); opacity:.4;} 50%{ transform:scale(1.08); opacity:.65;} }
  @keyframes swBurst{ 0%{ transform:scale(1);} 40%{ transform:scale(1.25);} 100%{ transform:scale(1.7); opacity:0;} }
  @keyframes swFlash{ 0%{ transform:scale(1); opacity:.6;} 100%{ transform:scale(3); opacity:0;} }

  .sw-reveal{ width:100%; max-width:520px; text-align:center; }
  .sw-rev-t{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:15px; color:#fff; letter-spacing:.08em; margin-bottom:10px; }
  .sw-mega{ display:inline-block; font-family:'Orbitron',sans-serif; font-weight:800; font-size:11px; letter-spacing:.08em; color:#1c1206;
    background:linear-gradient(180deg,#ffe08a,#f2b24b); border-radius:9px; padding:5px 12px; margin-bottom:12px; box-shadow:0 0 18px rgba(242,178,75,.55); }
  .sw-rev-grid{ display:grid; gap:10px; grid-template-columns:repeat(auto-fill,minmax(112px,1fr)); max-height:52vh; overflow-y:auto; padding:2px; }
  .sw-rev-grid:has(> :only-child){ grid-template-columns:minmax(180px,240px); justify-content:center; }
  .sw-drop{ border:1px solid color-mix(in srgb,var(--acc) 55%,#223245); border-radius:12px; padding:11px 9px; text-align:center;
    background:linear-gradient(180deg, color-mix(in srgb,var(--acc) 13%,#0d1420), #0b1119); box-shadow:0 0 18px -8px var(--acc);
    opacity:0; transform:translateY(14px) scale(.9); animation:swIn .34s cubic-bezier(.22,1,.36,1) forwards; }
  .sw-drop.ready{ border-color:rgba(124,224,160,.8); box-shadow:0 0 20px -6px rgba(124,224,160,.9); }
  @keyframes swIn{ to{ opacity:1; transform:none; } }
  .sw-drop img{ width:52px; height:52px; object-fit:contain; filter:drop-shadow(0 3px 8px rgba(0,0,0,.65)); }
  .sw-drop-n{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:14px; color:#fff; margin-top:4px; }
  .sw-drop-n i{ font-style:normal; font-size:8.5px; letter-spacing:.12em; color:#9fc2dd; }
  .sw-drop-name{ font-size:11px; font-weight:700; color:#dbe8f5; margin-top:3px; line-height:1.25; }
  .sw-drop-prog{ font-size:10px; color:#8ba0b5; margin-top:4px; font-variant-numeric:tabular-nums; }
  .sw-drop-prog b{ color:#7ce0a0; }
  .sw-rev-btns{ margin-top:16px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap; }
  .sw-accept{ border:none; border-radius:12px; padding:13px 26px; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:14px; letter-spacing:.05em; cursor:pointer;
    color:#08111a; background:linear-gradient(180deg,#8ff0ff,#4fc3ef); box-shadow:0 8px 22px -8px rgba(95,209,255,.7); transition:transform .08s; }
  .sw-accept:active{ transform:scale(.97); }
  .sw-toinv{ border:1px solid rgba(124,224,160,.7); border-radius:12px; padding:13px 22px; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:14px; letter-spacing:.05em; cursor:pointer;
    color:#9df0bb; background:rgba(124,224,160,.1); transition:transform .08s; }
  .sw-toinv:active{ transform:scale(.97); }

  /* hull-assembled celebration */
  .sw-built{ text-align:center; max-width:320px; }
  .sw-built-halo{ position:relative; width:170px; height:170px; margin:0 auto 8px; display:grid; place-items:center; }
  .sw-built-halo::before{ content:''; position:absolute; inset:0; border-radius:50%; background:radial-gradient(circle, rgba(124,224,160,.4), transparent 65%); animation:swPulse 1.6s ease-in-out infinite; }
  .sw-built-halo img{ width:130px; height:130px; object-fit:contain; position:relative; filter:drop-shadow(0 0 22px rgba(124,224,160,.65)); animation:swBuiltIn .6s cubic-bezier(.18,1.4,.4,1); }
  @keyframes swBuiltIn{ 0%{ transform:scale(.5); opacity:0; } 100%{ transform:scale(1); opacity:1; } }
  .sw-built-k{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:11px; letter-spacing:.22em; color:#9df0bb; }
  .sw-built-name{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:20px; color:#fff; letter-spacing:.04em; margin-top:6px; }
  .sw-built-tag{ font-size:11px; font-weight:700; color:#8ba0b5; letter-spacing:.06em; margin-top:4px; }

  @media (prefers-reduced-motion: reduce){
    .sw-open-crate,.sw-open-glow,.sw-drop,.sw-row.ready,.sw-built-halo::before,.sw-built-halo img{ animation:none !important; opacity:1 !important; transform:none !important; }
  }
  `;

  // ---- BOOT (must stay LAST) ------------------------------------------------
  // boot() reads the CSS const declared above it; calling it from the module body
  // hit the temporal dead zone and aborted the script before window exports ran,
  // so the screen silently painted nothing on a late parse. Keep this at the end.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
