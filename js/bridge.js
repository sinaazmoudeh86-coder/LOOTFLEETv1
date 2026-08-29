/* =============================================================================
   bridge.js — THE BRIDGE · docked readiness bar + the dashboard behind it
   -----------------------------------------------------------------------------
   WHAT THIS SCREEN ACTUALLY IS: a place you pass through constantly and act on
   rarely. You dock, glance, deploy — dozens of times a session. You change
   something maybe once. The first 731 pass built one screen that served both, so
   every common visit paid for the rare one: five stacked blocks and three
   horizontal scrollers under 150px of wallet and HUD.

   So it is two states now.

     GLANCE (default) — the hangar SCENE is the screen, FLY NOW is the one action,
       and this file contributes a single thin bar that is SILENT unless something
       needs doing. Deploy stays one tap. Nothing to read, nothing to scroll.

     MANAGE (one tap) — the dashboard as a sheet over the scene: the active hull
       with its real hardpoints, the formation, and the fleet as comparable cards.
       Dense is fine here, because you came here on purpose.

   WHAT IT DOES NOT OWN, DELIBERATELY
     · DEPLOY belongs to #fly-now, which was already wired and already the loudest
       thing on the screen. A second deploy button bought nothing and collided.
     · THE LOCATION belongs to #top-stack (the ⌂ Hangar chip). The first pass
       printed it a second time and physically overlapped it.
     · SHIP SCORE belongs to the HUD's .power-block.
     · THE FORMATION belongs to UI.fleetSlotsHTML()/wireFleetSlots() — the same
       pair the hero screen uses, so the tiles here open the REAL pickers.
   Anything already stated by another element is read from it or left to it.

   IT WRITES NOTHING TO `state`. No migration, no saveWeight() term, no
   mergeSaves() union, nothing in ASC_KEEP. Hull switching goes through
   GAME.switchShip(); no game rule is duplicated in this file.
   ========================================================================== */
(function () {
  'use strict';
  const G = () => window.GAME;
  const C = () => window.CONFIG;
  const $ = (id) => document.getElementById(id);
  let _on = false, _open = false, _sig = '';

  function host() {
    let h = $('bridge');
    if (h) return h;
    const wrap = $('arena-wrap'); if (!wrap) return null;
    h = document.createElement('div'); h.id = 'bridge';
    wrap.appendChild(h);
    return h;
  }
  const num = (v) => Math.floor(Number(v) || 0);
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function stars(n) { let h = ''; for (let i = 0; i < 5; i++) h += '<i class="' + (i < n ? 'on' : '') + '">★</i>'; return h; }

  function starsOf(k) {
    try {
      const m = (G().state.ascension || {})[k] || {};
      let best = 0; for (const id in m) best = Math.max(best, num(m[id] && m[id].s));
      return Math.min(5, best);
    } catch (e) { return 0; }
  }
  function hullLevel(k) { try { const i = G().shipUpInfo ? G().shipUpInfo(k) : null; return i ? num(i.level) : 1; } catch (e) { return 1; } }
  function fitOf(k) { const s = G().state; return k === s.ship ? (s.equipped || {}) : ((s.fittings || {})[k] || {}); }

  // ---- THE ACTIVE HULL'S SLOTS, FROM THE SCREEN THAT ALREADY DESCRIBES THEM.
  // equipLayout() is what the hero screen's equip grid is built from, so it
  // carries the real per-slot LABEL and ICON. An earlier pass derived a glyph as
  // base.slice(0,1).toUpperCase(), which collided: bow and boots both became "B",
  // and arrows/armor/amulet were all "A" — so a panel whose whole job is telling
  // you WHICH bay is empty could not tell you which bay was empty.
  function activeSlots() {
    const out = [];
    try {
      G().equipLayout().forEach(({ key, label, icon, item }) => out.push({ key, label, icon, item }));
    } catch (e) {}
    const filled = out.filter((x) => x.item).length;
    // name the empty ones, deduped, so "2 empty" says WHAT is empty
    const emptyNames = [];
    out.forEach((x) => { if (!x.item && emptyNames.indexOf(x.label) === -1) emptyNames.push(x.label); });
    return { list: out, filled, total: out.length, empty: out.length - filled, emptyNames };
  }
  function slotCount(k) {
    try { const fit = fitOf(k), sl = C().shipSlots(k); let f = 0; sl.forEach((sk) => { if (fit[sk]) f++; }); return { filled: f, total: sl.length, empty: sl.length - f }; }
    catch (e) { return { filled: 0, total: 0, empty: 0 }; }
  }

  function fleetList() {
    const s = G().state, owned = s.ownedShips || {}, out = [];
    const flying = (() => { try { return G().getFleet() || []; } catch (e) { return []; } })();
    for (const k in owned) {
      if (!owned[k]) continue;
      const def = C().SHIP_BY_KEY[k]; if (!def) continue;
      const sc = slotCount(k);
      out.push({ k, name: def.name || k, lv: hullLevel(k), st: starsOf(k), empty: sc.empty, total: sc.total,
        cur: k === s.ship, wing: flying.indexOf(k) !== -1 && k !== s.ship });
    }
    out.sort((a, b) => (b.lv - a.lv) || (b.st - a.st) || String(a.name).localeCompare(String(b.name)));
    return out;
  }

  // ---- WHAT NEEDS DOING. The bar is silent when this is empty, which is the
  // point: on most visits there is nothing to say and the screen stays the scene.
  function todos() {
    const g = G(), s = g.state, out = [];
    const sl = activeSlots();
    if (sl.empty) out.push({ c: '#ff8a96', ic: '⚠', k: 'ship',
      t: sl.empty + ' EMPTY ' + (sl.empty > 1 ? 'HARDPOINTS' : 'HARDPOINT'),
      s: sl.emptyNames.slice(0, 3).join(' · ') + (sl.emptyNames.length > 3 ? ' +' + (sl.emptyNames.length - 3) : '') });
    const sp = num(s.skillPoints);
    if (sp > 0) out.push({ c: 'var(--gold)', ic: '✦', k: 'skills', t: sp + ' SKILL POINT' + (sp > 1 ? 'S' : ''), s: 'Unspent' });
    const hold = (s.inventory || []).length, cap = (() => { try { return g.invCap(); } catch (e) { return 0; } })();
    if (cap && hold >= cap) out.push({ c: '#ffcf9a', ic: '▣', k: 'bag', t: 'HOLD FULL', s: hold + ' / ' + cap + ' — loot is being scrapped' });
    return out;
  }

  // ---- GLANCE: NOTHING OVER THE PAD ----------------------------------------
  // The entry point is a fifth button in #hangar-dock, not an overlay. The pad's
  // hull slots are hit-tested by GEOMETRY against the whole canvas (the click
  // listener lives on #game-canvas itself), so ANY pointer-events:auto element
  // placed over the arena does not merely overlap a hull — it consumes the tap
  // and that hull stops being flyable. Two rounds were spent narrowing a chip
  // that could not be placed safely: the chip only exists when there is a todo,
  // its width follows the todo text, and the pad layout differs per account, so
  // WHICH hull went dead differed per player and per session.
  //
  // So the glance state adds no DOM to the arena at all. That is also what the
  // rework set out to do — "the scene is the screen" — and a readiness bar over
  // the scene contradicted it. Readiness moves to a badge on the dock button and
  // the detail moves inside the sheet.
  function ensureDockBtn() {
    let btn = $('hd-bridge');
    if (btn) return btn;
    const dock = $('hangar-dock'); if (!dock) return null;
    btn = document.createElement('button');
    btn.className = 'hd-btn'; btn.id = 'hd-bridge'; btn.type = 'button';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/></svg>'
      + '<span>Bridge</span><i class="hd-dot" id="hd-bridge-dot" style="display:none"></i>';
    btn.addEventListener('click', () => { _open = !_open; _sig = ''; sync(_on); });
    dock.appendChild(btn);
    return btn;
  }
  function syncDockBtn() {
    const btn = ensureDockBtn(); if (!btn) return;
    btn.style.display = _on ? '' : 'none';
    btn.classList.toggle('on', _open);
    const dot = $('hd-bridge-dot');
    if (dot) { const n = _on ? todos().length : 0; dot.style.display = n ? '' : 'none'; }
  }

  // ---- MANAGE: the dashboard, over the scene --------------------------------
  function sheetHTML() {
    const g = G(), s = g.state, cfg = C();
    const def = cfg.SHIP_BY_KEY[s.ship] || cfg.SHIPS[0];
    const sl = activeSlots();
    const list = fleetList();
    const wing = list.filter((x) => x.wing);
    const others = list.filter((x) => !x.cur);
    const nFly = (() => { try { return g.fleetShips().length; } catch (e) { return 0; } })();
    const cap = (() => { try { return g.fleetSlots(); } catch (e) { return 0; } })();

    let h = '<div class="br-sheet"><div class="br-sh-head"><span class="br-sh-t">◧ BRIDGE</span>'
      + '<span class="br-sh-s">' + list.length + ' hulls · ' + (nFly + 1) + '/' + (1 + cap) + ' flying</span>'
      + '<button class="br-x" data-br="close">✕</button></div><div class="br-sh-body">';

    // what needs doing, first — and rendered only when there IS something
    const td = todos();
    if (td.length) h += '<div class="br-att">' + td.map((x) =>
      '<div class="br-a" style="--ac:' + x.c + '" data-br="' + x.k + '"><i>' + x.ic + '</i>'
      + '<div><b>' + esc(x.t) + '</b><span>' + esc(x.s) + '</span></div></div>').join('') + '</div>';

    // active hull — no Ship Score (the HUD power block owns it)
    h += '<div class="br-hero"><div class="br-hero-in">'
      + '<div class="br-art"><img src="ships/ship-' + esc(s.ship) + '.png" alt="" onerror="this.style.display=\'none\'"></div>'
      + '<div class="br-hm">'
      + '<div class="br-hk"><span class="br-dot"></span>ACTIVE HULL</div>'
      + '<div class="br-hn">' + esc(def.name || s.ship) + '</div>'
      + '<div class="br-hc">' + esc(def.cls || 'Hull') + ' · <em>Hull Lv ' + hullLevel(s.ship) + '</em></div>'
      + '<div class="br-row"><span class="br-lab">SHIP<br>ASCENSION</span><span class="br-stars">' + stars(starsOf(s.ship)) + '</span></div>'
      // WING IS LABELLED. Unlabelled next to five stars it read as the ascension's name.
      + (wing.length ? '<div class="br-row"><span class="br-chip wing">◆ WING · ' + esc(wing.map((w) => w.name).join(' · ')) + '</span></div>' : '')
      + '<div class="br-hp">' + sl.list.map((x) => {
          if (!x.item) return '<span class="br-s e" aria-label="' + esc(x.label) + ' empty">' + (x.icon || '·') + '</span>';
          const col = (cfg.RARITY[x.item.rarity] || {}).color || '#5fd1ff';
          return '<span class="br-s f" style="--rc:' + col + '" aria-label="' + esc(x.label) + '">' + (x.icon || '◆') + '</span>';
        }).join('') + '</div>'
      + '<div class="br-hpl"><span><b>' + sl.filled + ' / ' + sl.total + '</b> hardpoints mounted</span>'
      + (sl.empty ? '<span class="bad">' + sl.empty + ' empty · ' + esc(sl.emptyNames.join(' · ')) + '</span>'
                  : '<span style="color:#8effc0;font-weight:800">full</span>') + '</div>'
      + '</div></div></div>';

    // formation — the flying slots, from the screen that owns them
    try {
      if (window.UI && window.UI.fleetSlotsHTML) {
        h += '<div class="br-form"><div class="fp-head"><span class="fp-title">⬡ FORMATION</span>'
          + '<span class="fp-sub">who deploys with you</span></div>'
          + '<div class="fp-slots">' + window.UI.fleetSlotsHTML() + '</div>'
          + (window.COMMANDERS && window.COMMANDERS.fleetRowHTML ? window.COMMANDERS.fleetRowHTML() : '')
          + '</div>';
      }
    } catch (e) { try { console.warn('[bridge] formation unavailable', e); } catch (x) {} }

    // fleet — comparable cards, tap to fly
    h += '<div class="br-fl"><div class="br-fl-h"><span class="br-fl-t">SWITCH HULL · <b>' + others.length + '</b> OTHER' + (others.length === 1 ? '' : 'S') + '</span></div>'
      + '<div class="br-rail">'
      + others.map((x) => {
          const tag = x.wing ? ['wing', '◆ IN YOUR WING'] : x.empty ? ['unfit', '⚠ ' + x.empty + ' UNFITTED'] : ['ready', '✓ READY'];
          const col = (window.shipLvlColor ? window.shipLvlColor(x.lv) : 'var(--gold)');
          return '<div class="br-c" data-brship="' + esc(x.k) + '">'
            + '<div class="br-c-top"><span class="br-c-art"><img src="ships/ship-' + esc(x.k) + '.png" alt="" onerror="this.style.display=\'none\'"></span>'
            + '<span class="br-c-lv"><b style="color:' + col + '">' + x.lv + '</b><i>HULL LV</i></span></div>'
            + '<div class="br-c-n">' + esc(x.name) + '</div>'
            + '<div class="br-c-m"><span>' + x.total + ' slots</span>'
            + (x.st ? '<span class="br-c-st">' + new Array(x.st + 1).join('<i>★</i>') + '</span>' : '') + '</div>'
            + '<div class="br-c-tag ' + tag[0] + '">' + tag[1] + '</div></div>';
        }).join('')
      + '</div></div>';
    return h + '</div></div>';
  }

  function render(h) {
    h.innerHTML = _open ? sheetHTML() : '';
    // formation tiles are wired by the screen that owns them
    try { if (_open && window.UI && window.UI.wireFleetSlots) window.UI.wireFleetSlots(h.querySelector('.br-form')); } catch (e) {}
    h.querySelectorAll('[data-brship]').forEach((c) => c.addEventListener('click', () => {
      const k = c.dataset.brship;
      try {
        if (G().switchShip(k)) {
          const nm = (C().SHIP_BY_KEY[k] || {}).name || k;
          if (window.UI && window.UI.toast) window.UI.toast('⬡ Now flying ' + nm, '#f2b24b');
          _sig = ''; sync(_on);
        }
      } catch (e) {}
    }));
    h.querySelectorAll('[data-br]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.br;
      if (a === 'open') { _open = true; _sig = ''; sync(_on); return; }
      if (a === 'close') { _open = false; _sig = ''; sync(_on); return; }
      try {
        if (window.UI && window.UI.showScreen) window.UI.showScreen(a === 'bag' ? 'bag' : 'hero');
      } catch (e) {}
    }));
  }

  function sigOf() {
    try {
      const s = G().state, sl = activeSlots();
      return [_open ? 1 : 0, s.ship, hullLevel(s.ship), starsOf(s.ship), sl.filled, sl.total,
        Object.keys(s.ownedShips || {}).length, num(s.skillPoints), (s.inventory || []).length,
        (G().getFleet() || []).join(','), (() => { try { return G().fleetSlots(); } catch (e) { return 0; } })()].join('|');
    } catch (e) { return 'x'; }
  }

  // `safe` is the caller's docked flag — ui-v94 already computes it for the zone
  // chip, so this file never gets a second opinion on where the pilot is.
  function sync(safe) {
    const h = host(); if (!h) return;
    _on = !!safe;
    if (!_on) { _open = false; _sig = ''; h.classList.remove('show'); h.classList.remove('open'); h.innerHTML = ''; syncDockBtn(); return; }
    h.classList.toggle('show', _open);
    h.classList.toggle('open', _open);
    syncDockBtn();
    const sg = sigOf();
    if (sg === _sig) return;
    _sig = sg;
    try { render(h); }
    catch (e) { try { console.warn('[bridge] render failed', e); } catch (x) {} h.classList.remove('show'); h.innerHTML = ''; _on = false; _open = false; }
  }

  window.BRIDGE = { sync, active: () => _on, isOpen: () => _open, refresh: () => { _sig = ''; sync(_on); } };
})();
