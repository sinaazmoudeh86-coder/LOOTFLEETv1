/* =============================================================================
   ui.js — GrabAGun Idle Operator (mobile)
   Top HUD, bottom-nav screens (Battle / Zones / Bag / Hero / Store / Rank),
   joystick + auto toggle + speed pills, store purchases, leaderboard with
   viewable loadouts, rarity legend, item detail sheets, death/offline modals.
   ============================================================================= */
(function () {
  'use strict';
  const C = window.CONFIG, LB = window.LEADERBOARD, R = window.RENDER, GM = window.GALAXYMAP;
  let G = null;
  let _inited = false; // true once init() has populated `el`; UI feedback before
                       // then (e.g. offline-sim level-ups) safely no-ops.
  const $ = (id) => document.getElementById(id);
  const el = {};
  let screen = 'battle', sortMode = 'power', lbTab = 'heat', storeCat = 'ships', skillBranch = 'offense';
  const skillOpen = {}; // skill-tree accordion open-state, keyed by branch:tier
  let _galaxyTimer = null; // re-render galaxy while a region cooldown ticks
  let _boardTimer = null;  // live leaderboard refresh while the board is open
  // HTML-escape for interpolated server text. Every other module defines its own
  // inside its IIFE and none export it, so ui-v94 needs its own copy — without
  // it the Ranks error path threw mid-build, leaving the board unpainted and its
  // tab handlers unbound.
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  let _lbTab = 'power';    // which of the eleven Ranks ladders is showing
  let _lbView = null;      // sub-view within a tab that has them (King of the Hill)
  let _lbPage = 0;         // 60 rows a page; the roster runs to several hundred
  let _lcmTimer = null;    // LootCoin market countdowns (Cosmic Cache / Primordial Vault)
  let _buildTick = null;   // live countdown refresh while an Oblivion hull is under construction
  let _msTaps = 0;          // SECRET Mothership unlock: CONSECUTIVE "My Ship" click streak
  let _fleetTaps = 0;       // SECRET full-armada unlock: CONSECUTIVE "My Fleet" (HUD) click streak
  let _lbTaps = 0;          // SECRET Chroma Regent unlock: CONSECUTIVE "Leaderboard" tab click streak
  let _mkTaps = 0;          // SECRET FrostyFrost unlock: CONSECUTIVE "Market" tab click streak

  const ZONE_NAMES = ['The Backyard','Main Street','Riverside Mall','Gas Station','Highway Pileup','Quarantine Zone','Subway Tunnels','Research Lab','Military Depot','Containment Site'];
  function zoneName(d) { return d <= ZONE_NAMES.length ? ZONE_NAMES[d-1] : (d <= 16 ? 'Outer Sector ' + d : 'Hive Sector ' + d); }
  const rc = (i) => 'r-' + C.RARITY[i].key;
  const bl = (i) => 'bl-' + C.RARITY[i].key;
  // Format a drop probability (0..1) for the rarity legend: readable percentages
  // down to 0.1%, then switches to "1 in N" odds for the ultra-rare tiers.
  function fmtChance(p) {
    if (!p || p <= 0) return '—';
    const pct = p * 100;
    if (pct >= 10) return Math.round(pct) + '%';
    if (pct >= 1) return pct.toFixed(1) + '%';
    if (pct >= 0.1) return pct.toFixed(2) + '%';
    return '1 in ' + G.formatNum(Math.round(1 / p));
  }

  function fmtStat(key, val) {
    const d = C.STATS[key]; if (!d) return val;
    if (d.fmt === 'flat') return '+' + G.formatNum(val);
    if (d.fmt === 'pctint') return '+' + Math.round(val) + '%';
    return '+' + (Math.round(val * 10) / 10) + '%';
  }

  // ==========================================================================
  function init(game) {
    G = game;
    ['hud-level','xp-fill','xp-label','hp-fill','hp-label','hud-gold','hud-dps','hud-kills',
     'zb-name','zb-sub','advice','loot-feed','cargo-full','toast-layer','joystick','speed-row','auto-btn','auto-lbl','beacon-btn','beacon-lbl','beacon-arc',
     'hero-sub','char-power','equip-grid','stat-list','bag-sub','bag-body','zones-sub','zones-body','galaxy-sub','galaxy-body',
     'store-body','board-sub','board-body','modal-root','bag-badge',
     'boss-bar','bb-fill','bb-label','hero-badge','skills-sub','skills-body','hud-power','pb-ship','hud-fuel','hud-iron','hud-plasma','hud-lc','hud-fuel-rate','hud-iron-rate','hud-plasma-rate',
     'siege-bar','sg-fill','sg-label'].forEach((id) => el[id] = $(id));
    if (el['cargo-full']) el['cargo-full'].addEventListener('click', () => showScreen('bag'));
    { const lcChip = document.querySelector('#statusbar .lc-chip.chip-glow'); if (lcChip) { lcChip.style.cursor = 'pointer'; lcChip.addEventListener('click', () => openCredits()); } }

    // NOTE: #nav-command has NO data-screen — it opens the Command mega-menu, it
    // does not navigate. Only bind real screen buttons here, or showScreen(undefined)
    // would dereference a non-existent #screen-undefined and throw.
    document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => { if (b.dataset.screen) showScreen(b.dataset.screen); }));
    // GIVE THE TAP A RUNWAY, BEFORE THE CLICK EVEN FIRES.
    //
    // The finger going down on a nav control is all the notice we need that a
    // screen change is coming, and pointerdown lands a good 100ms ahead of the
    // click on a phone. G.uiYield() spends that head start stepping the sim out
    // of the way (hard-capped, no sim time lost — see the loop) so the click
    // handler and the screen's first paint get a clear main thread instead of
    // queueing behind an update() pass. Capture phase, one listener, everything
    // that navigates: the bottom nav, the hangar dock, the Command sheet, the
    // hangar tab strip and any screen header button.
    //
    // IT WAS ONLY WATCHING TOP-LEVEL NAVIGATION (729 stability pass), and that is
    // not where the expensive rebuilds are. Moving BETWEEN screens yielded; doing
    // anything INSIDE one did not — so a galaxy filter chip, a search keystroke, a
    // sort change, a page turn, a store card, a Pilot Tree row and every sheet
    // action all landed their re-render directly on top of an update() pass. Those
    // are exactly the taps a player describes as menu lag, because they are the
    // ones that rebuild a list of sixty rows while the sim is mid-frame.
    //
    // The rule is now the SURFACE, not a list of ids that has to be maintained:
    // any control inside a screen body, a sheet, or the galaxy list bar. Two
    // deliberate exclusions — #battle-controls and the joystick are combat inputs,
    // and deferring the sim on those would make the fight itself feel late, which
    // is the opposite trade. The arena canvas is untouched for the same reason.
    //
    // uiYield() is hard-capped at 140ms measured from the last frame the sim
    // actually ran, so widening what triggers it cannot lose sim time or chain
    // windows — see the ceiling in uiYield().
    const YIELD_ON = '#nav, #hangar-dock, #mega, .scr-head, [data-hangtab], [data-screen],'
      + '.scr-body button, .scr-body select, .sheet button, .sheet select,'
      + '.gxl-bar select, .gxl-q, .gxlf, .mega-card';
    const YIELD_NEVER = '#battle-controls, #joystick, #battle-canvas, canvas';
    document.addEventListener('pointerdown', (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      if (t.closest(YIELD_NEVER)) return;
      if (t.closest(YIELD_ON)) { try { G.uiYield(120); } catch (x) {} }
    }, true);
    buildSpeedRow();
    // WHICH SCREEN WAS SHOWING WHEN THE FINGER WENT DOWN.
    //
    // The pill floats over menus, and `screen` is reassigned SYNCHRONOUSLY at the
    // top of showScreen() — so a single tap that overlapped both a Zone Grind row
    // and this pill fired the row first (switching to battle and arming autopilot)
    // and then the pill, which by that point saw screen === 'battle' and toggled
    // autopilot straight back off, latching autoManual for good. The guard read
    // the state the earlier handler had already changed.
    //
    // Judging by where the press STARTED closes that: a press that began on
    // another screen can never toggle the arena's autopilot.
    let _autoDownScreen = null;
    el['auto-btn'].addEventListener('pointerdown', () => { _autoDownScreen = screen; });
    // A PRESS THAT NEVER BECOMES A CLICK MUST NOT LEAVE ITS SCREEN LATCHED.
    // Only the click handler cleared this, so a finger that slid off the pill (or a
    // cancelled pointer) left 'battle' recorded — and the next click that arrived
    // without a pointerdown of its own inherited it and passed the guard.
    el['auto-btn'].addEventListener('pointercancel', () => { _autoDownScreen = null; });
    el['auto-btn'].addEventListener('click', () => {
      const from = _autoDownScreen; _autoDownScreen = null;
      if (screen !== 'battle') return;   // the pill floats over menus too — dead unless the arena is showing
      if (from !== null && from !== 'battle') return;   // …and the press has to have STARTED in the arena
      G.setAuto(!G.getAuto());
      // REMEMBER THE PLAYER'S OWN CHOICE, FOR THIS DEPLOYMENT. Turning autopilot
      // off by hand is a decision, and returning to the arena from any menu used
      // to overwrite it (see showScreen('battle') below) — so a manual pilot who
      // opened a tab came back on autopilot. Only a HAND toggle writes this flag;
      // the event systems that force auto off for their own duration never touch
      // it, so the post-event restore still works.
      //
      // IT IS NO LONGER PERMANENT. armAuto() clears it on every deploy, because a
      // save-persisted flag meant one tap here silently disabled the arena's
      // auto-default for the rest of the account's life.
      G.state.autoManual = !G.getAuto();
      try { G.save(); } catch (e) {}
      syncAuto();
    });
    // ◉ BEACON — HUMAN-PRESS ONLY. Nothing else calls fireBeacon and autopilot has
    // no path to it: inviting a 20× swarm is a decision, not a behaviour. Zone
    // Grind only — the engine refuses everywhere else.
    if (el['beacon-btn']) {
      el['beacon-btn'].addEventListener('click', () => {
        const st = G.beaconState();
        if (!st.visible) { toast('◉ The beacon only answers in Zone Grind', '#e8a34a'); return; }
        if (st.blocked) { toast('◉ Not while a boss is on the field', '#e8a34a'); return; }
        if (!st.ready) { toast('◉ Beacon recharging — ' + Math.ceil(st.left) + 's', '#e8a34a'); return; }
        const r = G.fireBeacon();
        if (r && r.ok) toast('◉ BEACON — ' + r.spawned + ' hostiles inbound for ' + Math.round(r.life) + 's', '#ff8a3d');
        syncBeacon();
      });
      setInterval(() => { if (document.hidden) return; syncBeacon(); }, 250);
    }
    const bailBtn = $('bail-btn');
    if (bailBtn) bailBtn.addEventListener('click', () => {
      G.selectDungeon(0);            // drop into the safe Hangar bay, leaving combat
      showScreen('battle');
      toast('⏏ Bailed to Hangar — combat ended', '#5b9cff');
    });
    const zbBtn = $('zone-banner'); if (zbBtn) zbBtn.addEventListener('click', () => showScreen('zones'));
    // SECRET: click "My Ship" 20 times IN A ROW to unlock the Mothership.
    // Any click that isn't a "My Ship" trigger breaks the streak (capture phase
    // runs before the trigger's own handler, so a real My Ship click re-counts).
    document.addEventListener('click', (e) => {
      const onMyShip = e.target.closest && e.target.closest('[data-hangtab="ship"], [data-hangtab="ships"], #hangar-dock .hd-btn[data-screen="hero"]');
      if (!onMyShip && _msTaps > 0) _msTaps = 0;
      // SECRET: tap your fleet (HUD power block) 20× in a row — any other click breaks the streak
      const onFleet = e.target.closest && e.target.closest('#pb-fleet');
      if (!onFleet && _fleetTaps > 0) _fleetTaps = 0;
      // SECRET: tap Leaderboard 20× in a row — any other click breaks the streak
      const onBoard = e.target.closest && e.target.closest('[data-hangtab="board"]');
      if (!onBoard && _lbTaps > 0) _lbTaps = 0;
      // SECRET: tap Market 20× in a row — any other click breaks the streak
      const onMarket = e.target.closest && e.target.closest('[data-hangtab="market"]');
      if (!onMarket && _mkTaps > 0) _mkTaps = 0;
    }, true);
    {
      const pbf = document.getElementById('pb-fleet');
      if (pbf) { pbf.style.cursor = 'pointer'; pbf.addEventListener('click', tapMyFleet); }
      const lcb = document.getElementById('hud-lcbuy');
      if (lcb) lcb.addEventListener('click', openCredits);
      const prb = document.getElementById('hud-probuy');
      // THE PILL ALWAYS OPENS THE PRO SHEET. It used to route members to the
      // Account sheet, which lists a status line and a cancel button and says
      // nothing about what the subscription actually does — so the one surface a
      // paying member taps was the only one that never showed them what they are
      // paying for. The sheet carries the benefits AND the manage link now.
      if (prb) prb.addEventListener('click', openProSheet);
      syncProCta();
      const fnb = document.getElementById('fly-now');
      if (fnb) fnb.addEventListener('click', () => {
        const rec = +fnb.dataset.rec || 1;
        G.selectDungeon(rec);
        toast('⚔ Deployed to Zone ' + rec + ' — ' + zoneName(rec), '#ffd24d');
        fnb.classList.remove('show');
      });
      const lcc = document.getElementById('hud-lc-chip');
      if (lcc) lcc.addEventListener('click', openCredits);
    }
    document.querySelectorAll('#hangar-dock .hd-btn').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.screen === 'hero') tapMyShip();
      showScreen(b.dataset.screen);
    }));
    initJoystick();
    syncAuto();
    _inited = true;
  }

  // ==========================================================================
  // SCREENS
  // ==========================================================================
  // Declared above showScreen, which is the only writer — a builder below its
  // first reader is the temporal-dead-zone trap that cost us twenty builds of
  // leaderboard publishes (see cloud.js in CLAUDE.md).
  let _pendScreen = null, _pendRAF = 0;
  function showScreen(name) {
    // Defense-in-depth: ignore unknown screens (e.g. a nav button with no
    // data-screen) BEFORE mutating any state, so a bad name can never crash.
    const sc = (name && name !== 'battle') ? $('screen-' + name) : null;
    if (name !== 'battle' && !sc) return;
    // UNLAUNCHED FEATURES CANNOT BE REACHED, not even by a stale deep link, a
    // mail button or a bookmarked route. Tour of Duty is built and shipped but
    // hidden until an admin redeems the beta code in ⚙ Settings (js/redeem.js);
    // the Command card hides itself, and this is the door behind it.
    // Tour of Duty LAUNCHED (build 659) — the screen opens for everyone.
    screen = name;
    // A Pro offer that fired mid-combat waits here for a quiet screen.
    if (name !== 'battle') { try { window.PROOFFER && PROOFFER.flush(); } catch (e) {} }
    document.querySelectorAll('.screen.overlay').forEach((s) => s.classList.remove('active'));
    if (sc) sc.classList.add('active');
    // STOP PAINTING THE ARENA ON THIS FRAME, not up to 140ms from now.
    //
    // draw() and update()'s render gate both cache "is an overlay covering me" on a
    // ~7Hz poll of the DOM (rt._avT / rt._ovT). That is the right cadence for a
    // steady state and the wrong one for the instant a menu opens: the arena kept
    // compositing at full device resolution for several more frames — exactly while
    // the player is waiting to see the screen they tapped. Harmless on a desktop,
    // very visible on a phone at DPR 2–3.
    //
    // The class changes above have already landed, so invalidating both stamps here
    // makes the very next frame re-read the DOM and skip the paint. Nothing about
    // the SIMULATION is touched — it keeps real wall-clock time either way.
    try { const _rt = G.rt; if (_rt) { _rt._avT = 0; _rt._ovT = 0; } } catch (e) {}
    const navName = (name === 'hero' || name === 'social' || name === 'mail') ? 'store' : name;
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.screen === navName));
    // Autopilot and the joystick are STATE, not paint — they resolve on the tap.
    if (name === 'battle') {
      try {
        const rt = G.rt || {};
        const evt = document.getElementById('app').classList.contains('sd-noauto') ||   // Voidmaw / alliance raid
                    (rt.cgrun && rt.cgrun.active);                                      // cargo escort
        if (!evt && !G.state.autoManual && (G.state.currentDungeon | 0) >= 1 && !G.getAuto()) { G.setAuto(true); syncAuto(); }
      } catch (e) {}
    }
    syncJoystickVisible();
    // ---- PAINT THE SWITCH, THEN BUILD ITS CONTENTS -------------------------
    //
    // Everything above is a handful of class flips: by itself it is a complete,
    // instantly visible screen change. Everything below is the screen BUILDING
    // itself — hundreds of item cards, forty hull tiles, a canvas re-measure —
    // and it used to run in the same task, so the browser could not paint the
    // switch until the contents were finished. On a phone that is the whole of
    // the reported tap-to-menu delay: the screen was not slow to change, it was
    // never allowed to change until it was also slow to fill.
    //
    // One frame of separation fixes it. The shell appears on the very next
    // paint; the body fills on the frame after. Coalesced, so a burst of
    // navigation renders the destination once and never an abandoned screen.
    _pendScreen = name;
    if (!_pendRAF) {
      _pendRAF = requestAnimationFrame(() => {
        _pendRAF = 0;
        const n = _pendScreen; _pendScreen = null;
        if (n != null) renderScreen(n);
      });
    }
  }

  // What a screen has to BUILD. Never call this directly to navigate — go
  // through showScreen so the shell paints first.
  function renderScreen(name) {
    if (name === 'hero') renderHero();
    else if (name === 'bag') renderBag();
    else if (name === 'zones') { _zWin = 0; renderZones(); }   // a fresh open lands on the anchor window
    else if (name === 'galaxy') renderGalaxy();
    else if (name === 'store') renderStore();
    else if (name === 'board') renderBoard();
    else if (name === 'skills') renderSkills();
    else if (name === 'pilot') { if (window.DREAD) window.DREAD.renderPilot(); }
    else if (name === 'social') { if (window.SOCIAL) window.SOCIAL.open(); }
    else if (name === 'mail') { if (window.MAIL) window.MAIL.render(); }
    else if (name === 'voidzone') { if (window.VOIDZ) window.VOIDZ.render(); }
    else if (name === 'cargo') { if (window.CARGO) window.CARGO.render(); }
    else if (name === 'mech') { if (window.MECHF) window.MECHF.render(); }
    else if (name === 'cmdr') { if (window.COMMANDERS) window.COMMANDERS.render(); }
    else if (name === 'tour') { if (window.TOUR) window.TOUR.render(); }
    else if (name === 'forge') { if (window.STARFORGE) window.STARFORGE.render(); }
    else if (name === 'pasc') { if (window.PASCEND) window.PASCEND.render(); }
    else if (name === 'dread') { if (window.DREAD) window.DREAD.renderHunt(); }
    else if (name === 'sdread') { if (window.SDREAD) window.SDREAD.render(); }
    // CRATES — three crate systems reading as one screen. Each still renders
    // itself; the hub only marks the shared sub-tab strip in the head.
    else if (name === 'boxes') { if (window.GBOX) window.GBOX.render(); if (window.CRATES) window.CRATES.sync('boxes'); }
    else if (name === 'shipworks') { if (window.SHIPWORKS) window.SHIPWORKS.render(); if (window.CRATES) window.CRATES.sync('shipworks'); }
    else if (name === 'crates') { if (window.CRATES) window.CRATES.render(); }
    else if (name === 'nano') { if (window.NANOUI) window.NANOUI.render(); }
    else if (name === 'ascend') { if (window.ASCEND) window.ASCEND.render(); }
    else if (name === 'fasc') { if (window.FASCUI) window.FASCUI.render(); }
    else if (name === 'casino') { if (window.CASINO) window.CASINO.render(); }
    else if (name === 'missions') { if (window.MISSIONS) window.MISSIONS.render(); }
    else if (name === 'moon') { if (window.MOON) window.MOON.render(); }
    else if (name === 'expo') { if (window.EXPOUI) window.EXPOUI.render(); }
    else if (name === 'koth') { if (window.KOTHUI) window.KOTHUI.render(); }
  }

  // ==========================================================================
  // HUD (every frame)
  // ==========================================================================
  function syncHUD() {
    if (!_inited) return;
    const s = G.state;
    el['hud-level'].textContent = s.level;
    // LEVEL CAP — at the ceiling the XP bar stops being a progress bar and says
    // what the wall is, because XP genuinely stops accruing there.
    const lvCap = C.levelCap ? C.levelCap() : Infinity;
    if (s.level >= lvCap) {
      el['xp-fill'].style.width = '100%';
      el['xp-label'].textContent = '✦ LEVEL CAP ' + lvCap + ' — ASCEND TO RAISE';
      el['xp-label'].style.color = '#f2d4ff';
    } else {
      const need = C.xpToNext(s.level);
      const xpPct = Math.max(0, Math.min(100, s.xp / need * 100));
      el['xp-fill'].style.width = xpPct + '%';
      el['xp-label'].textContent = (xpPct >= 99.5 && xpPct < 100 ? 99.9 : Math.round(xpPct * 10) / 10) + '% XP';
      el['xp-label'].style.color = '';
    }
    const hp = G.getHp();
    el['hp-fill'].style.width = (hp.max > 0 ? Math.max(0, hp.cur / hp.max * 100) : 0) + '%';
    el['hp-label'].textContent = hp.dead ? 'DOWN' : `${G.formatNum(hp.cur)} / ${G.formatNum(hp.max)}`;
    el['hud-gold'].textContent = (G.formatNumRaw || G.formatNum)(s.gold);
    // wallet: live Galaxy Resources next to gold (+ hourly farm rate, cached 5s)
    {
      const res = G.getResources ? G.getResources() : null;
      if (res) {
        if (el['hud-fuel']) el['hud-fuel'].textContent = G.formatNum(res.fuel || 0);
        if (el['hud-iron']) el['hud-iron'].textContent = G.formatNum(res.iron || 0);
        if (el['hud-plasma']) el['hud-plasma'].textContent = G.formatNum(res.plasma || 0);
        if (!syncHUD._rT || Date.now() - syncHUD._rT > 5000) { syncHUD._rT = Date.now(); syncHUD._rates = G.resourceRates(); }
        const rr = syncHUD._rates || {};
        const setR = (id2, v2) => { if (el[id2]) { const s2 = v2 > 0 ? '+' + G.formatNum(v2) + '/h' : ''; if (el[id2].textContent !== s2) el[id2].textContent = s2; } };
        setR('hud-fuel-rate', rr.fuel || 0);
        setR('hud-iron-rate', rr.iron || 0);
        setR('hud-plasma-rate', rr.plasma || 0);
      }
    }
    // LootCoins balance in the top bar
    // FULL NUMBER, NOT AN ABBREVIATION. Every other chip is a bulk resource where
    // "12.4M" is the readable form; LootCoins are spent in exact amounts against
    // exact prices, so the balance is printed in full with thousands separators.
    if (el['hud-lc'] && G.getCredits) {
      const v = Math.floor(G.getCredits() || 0).toLocaleString('en-US');
      if (el['hud-lc'].textContent !== v) el['hud-lc'].textContent = v;
    }
    // WALLET FIT GUARD — when balances grow long, drop the /h rates first, then
    // compress the chips, and finally SCALE the whole row down — it is always
    // exactly one row, at any width, and nothing clips or overlaps.
    {
      const w = document.querySelector('#statusbar .wallet');
      if (w) {
        const _pc = $('prism-chip');
        const sig = [el['hud-gold'], el['hud-fuel'], el['hud-iron'], el['hud-plasma'], el['hud-prism'], el['hud-lc'], el['hud-fuel-rate'], el['hud-iron-rate'], el['hud-plasma-rate']]
          .map((e2) => (e2 ? e2.textContent : '')).join('|')
          + '|' + (_pc && _pc.style.display !== 'none' ? '◈' : '')   // re-fit when the Prism chip toggles on/off
          + '|' + w.clientWidth;                                     // re-fit on any resize / rotation
        if (syncHUD._wsig !== sig) {
          syncHUD._wsig = sig;
          w.classList.remove('tight', 'tighter', 'tightest', 'fitscale');
          w.style.removeProperty('--ws');
          if (w.scrollWidth > w.clientWidth + 1) w.classList.add('tight');
          if (w.scrollWidth > w.clientWidth + 1) w.classList.add('tighter');
          if (w.scrollWidth > w.clientWidth + 1) w.classList.add('tightest');
          // FINAL STAGE — SCALE, NEVER STACK. This used to add .wrap and let the
          // chips fall onto a second row. The resource row is one row at every
          // width: measure how much too wide it still is and shrink the whole
          // row by that ratio instead.
          if (w.scrollWidth > w.clientWidth + 1) {
            w.classList.add('fitscale');
            const ws = Math.max(0.5, Math.min(1, (w.clientWidth - 2) / Math.max(1, w.scrollWidth)));
            w.style.setProperty('--ws', ws.toFixed(3));
          }
        }
      }
    }
    // HOLD FULL — persistent badge beside the loot feed while drops are scrapped
    if (el['cargo-full']) {
      const cfFull = !!(G.invCap && G.state.inventory.length >= G.invCap() && G.state.currentDungeon >= 1);
      el['cargo-full'].classList.toggle('show', cfFull);
      if (el['loot-feed']) el['loot-feed'].style.bottom = cfFull ? '130px' : '';
    }
    el['hud-dps'].textContent = G.formatNum(G.getDps());
    const st0 = G.getStats(); if (st0) el['hud-power'].textContent = (G.formatNumRaw || G.formatNum)(G.score ? G.score() : Math.floor(st0.theoryDps + st0.maxHp * 0.5));
    // power block shows your WHOLE fleet — flagship + every flying escort
    {
      const wrap = document.getElementById('pb-fleet');
      if (wrap) {
        const keys = [s.ship || 'frigate'].concat((G.fleetShips ? G.fleetShips() : []).map((x) => x.key));
        const sig = keys.join(',');
        if (wrap.dataset.sig !== sig) {
          wrap.dataset.sig = sig;
          wrap.innerHTML = keys.map((k, i) => '<img ' + (i === 0 ? 'id="pb-ship" class="flag"' : 'class="esc"') + ' src="ships/ship-' + k + '.png" alt="">').join('');
        }
      }
    }
    // SHIP SCORE → FLEET SCORE once escorts are flying
    {
      const pbl = document.querySelector('.pb-label');
      if (pbl) {
        const want = (G.fleetShips && G.fleetShips().length > 0) ? '⚡ FLEET SCORE' : '⚡ SHIP SCORE';
        if (pbl.textContent !== want) pbl.textContent = want;
      }
    }
    // PILOT ASCENSION rank, beside the score. Compact by design (✦ + star count):
    // the full five-star badge is too wide for a phone HUD, and this sits in the
    // grid's flexible track so it can never push or overlap the label / VIP chip.
    {
      const ab = document.getElementById('pb-asc');
      if (ab) {
        let n = 0, t = null;
        try { if (window.PASCEND) { n = window.PASCEND.stars() | 0; if (n) t = window.PASCEND.tierDef(n); } } catch (e) {}
        if (!n) { if (ab.style.display !== 'none') { ab.style.display = 'none'; ab.dataset.sig = ''; } }
        else {
          const star = window.PASCEND.starOf(n);
          const sig = n + '|' + (t && t.name);
          if (!ab.dataset.bound) {
            ab.dataset.bound = '1';
            ab.addEventListener('click', (e) => { e.stopPropagation(); try { showScreen('pasc'); if (window.PASCEND) window.PASCEND.render(); } catch (x) {} });
          }
          if (ab.dataset.sig !== sig) {
            ab.dataset.sig = sig;
            ab.style.display = '';
            ab.style.setProperty('--ac', (t && t.color) || '#e05bff');
            ab.classList.toggle('prism', !!(t && t.prismatic));
            ab.innerHTML = '✦<b>' + n + '</b>';
            ab.title = 'Pilot Ascension ' + n + ' · ' + ((t && t.name) || '') + ' ★' + star;
          }
        }
      }
    }
    el['hud-kills'].textContent = G.formatNum(s.totalKills) + ' kills';
    const safe = s.currentDungeon < 1;
    const aw = el['arena-wrap'] || (el['arena-wrap'] = document.getElementById('arena-wrap'));
    if (aw) aw.classList.toggle('in-hangar', safe);
    const sys = (G.sysAt && s.currentSystem) ? G.sysAt(s.currentSystem) : null;
    const sysName = sys ? sys.name : ('Zone ' + s.currentDungeon);
    // EVENT DEPLOYMENTS — the zone chip + advice + boss meter belong to the zone
    // grind; Home Citadel / Voidmaw runs own the arena and show their own HUD.
    const evRun = G.rt && (G.rt.hcrun || G.rt.sdrun);
    el['zb-name'].textContent = evRun ? (G.rt.hcrun ? '🏰 Home Zone' : '❖ Progenitor') : (safe ? '⌂ Hangar' : sysName);
    el['zb-sub'].textContent = evRun ? (G.rt.hcrun ? 'Citadel defense' : 'World boss') : (safe ? 'Home bay' : ('Lv ' + s.currentDungeon + (sys && G.isOwned && G.isOwned(s.currentSystem) ? ' · owned' : '')));
    const adv = G.zoneAdvice();
    // advice shows only when it adds info: deploy prompt in safe zone, or a
    // push-up / back-off recommendation. Hidden when the current zone is fine.
    const a2 = el['advice'];
    const msg = safe ? 'Tap above to open the Galaxy Map →' : adv.msg;
    const show = !evRun && (safe || adv.kind === 'up' || adv.kind === 'down');
    if (a2.textContent !== msg) a2.textContent = msg;
    a2.className = (safe ? 'safe' : adv.kind) + (show ? ' show' : '');
    // FLY NOW — big deploy CTA while docked in the hangar, straight to the
    // recommended zone (clearly named)
    // THE BRIDGE — the docked dashboard (js/bridge.js). It is handed the SAME
    // `safe` flag the zone chip above uses, so the two can never disagree about
    // whether the pilot is docked. It renders nothing when not docked.
    try { if (window.BRIDGE) window.BRIDGE.sync(safe && !evRun); } catch (e) {}
    const fn = el['fly-now'] || (el['fly-now'] = document.getElementById('fly-now'));
    if (fn) {
      const rec = Math.max(1, adv.rec || 1);
      fn.classList.toggle('show', !!(safe && !evRun));
      if (safe && !evRun) {
        const fz = document.getElementById('fly-now-zone');
        if (fz) fz.textContent = 'ZONE ' + rec + ' — ' + zoneName(rec).toUpperCase();
        fn.dataset.rec = rec;
        // Measure the nav rather than restate its height — the button sits in one
        // fixed dock above it (see the #fly-now rule in game.html), and #nav
        // changes height at four breakpoints plus the safe-area inset.
        try {
          const nv = document.getElementById('nav');
          fn.style.setProperty('--fly-nav', ((nv && nv.offsetHeight) || 60) + 'px');
        } catch (e) {}
      }
    }
    // siege/wave bar takes priority over the boss meter while a gauntlet is active
    const siege = G.getSiege ? G.getSiege() : null;
    const waves = G.getWaves ? G.getWaves() : null;
    const wz = (siege && siege.active) ? siege : (waves && waves.active ? waves : null);
    const sgb = el['siege-bar'], bb = el['boss-bar'];
    if (wz && !safe) {
      sgb.classList.add('show');
      const isSuper = wz.bossSpawned && wz.super;
      const cit = wz.citadel;
      const citE = cit && wz.bossSpawned && G.getCitadel ? G.getCitadel() : null;
      const wv = wz.bossSpawned ? (wz.clone ? '⚔ ENEMY CLONE FLEET' : isSuper ? 'SUPER BOSS' : cit ? (wz.playerCit ? '⛴ TAKE THE CITADEL' : '⛴ RAZE THE CITADEL') : 'BOSS') : (cit ? 'ASSAULT ' : 'WAVE ') + Math.min(wz.wave, wz.total) + ' / ' + wz.total;
      el['sg-fill'].style.width = (citE ? Math.max(0, citE.hp / citE.maxHp * 100) : Math.min(100, ((wz.bossSpawned ? wz.total : wz.wave - 1) / wz.total) * 100)) + '%';
      // SIEGE CLOCK — only shown once the final defender is up and the clock runs
      const clk = (wz.timed && wz.bossSpawned && wz.limitT != null) ? Math.max(0, Math.ceil(wz.limitT)) : null;
      el['sg-label'].textContent = '⚔ ' + wv + (clk != null ? '  ·  ' + clk + 's' : '');
      el['sg-fill'].style.background = (clk != null && clk <= 10) ? '#ff4d5e' : '';
      bb.classList.remove('show', 'active');
    } else {
      sgb.classList.remove('show');
      if (safe || evRun) { bb.classList.remove('show', 'active'); }
      else {
        const bi = G.getBossInfo();
        // a 1e9 timer means "suppressed" (event arenas) — never show the meter
        if (!bi.alive && bi.timeLeft > 86400) { bb.classList.remove('show', 'active'); }
        else {
        bb.classList.add('show');
        if (bi.alive) { bb.classList.add('active'); el['bb-fill'].style.width = Math.max(0, bi.hp / bi.max * 100) + '%'; el['bb-label'].textContent = '☠ ' + (bi.name || 'BOSS'); }
        else { bb.classList.remove('active'); el['bb-fill'].style.width = (bi.progress * 100) + '%'; const m = Math.floor(bi.timeLeft/60), sec = bi.timeLeft%60; el['bb-label'].textContent = bi.progress > 0.985 ? 'BOSS INCOMING' : `Boss in ~${m}:${sec<10?'0':''}${sec}`; }
        }
      }
    }
  }

  // top-bar Pro CTA ↔ member badge (swaps once the subscription is active)
  function syncProCta() {
    const b = document.getElementById('hud-probuy'); if (!b) return;
    const pro = !!(G.isPro && G.isPro());
    b.classList.toggle('is-pro', pro);
    const sub = document.getElementById('hud-pro-sub');
    // Read the multipliers from the ENGINE, never a retyped literal — build 488
    // raised XP to 5× and these two strings kept selling 2× on the HUD while the
    // purchase sheet three taps away sold 5×.
    const pk = (G.proMods ? G.proMods().perks : null) || { xpMult: 5, speed: 3 };
    if (sub) sub.textContent = pro ? 'ACTIVE · MEMBER' : pk.speed + '× SPEED · ' + pk.xpMult + '× XP';
    b.title = pro ? 'LootFleet Pro — active · manage' : 'LootFleet Pro — ' + pk.speed + '× speed · ' + pk.xpMult + '× XP · ' + pk.gold + '× gold · +' + Math.round((pk.loot - 1) * 100) + '% loot';
  }
  function refreshAll() {
    try { syncJoystickVisible(); } catch (e) {}
    if (!_inited) return;
    syncProCta();
    if (screen === 'hero') renderHero();
    else if (screen === 'bag') renderBag();
    else if (screen === 'zones') renderZones();
    else if (screen === 'galaxy') renderGalaxy();
    else if (screen === 'store') renderStore();
    else if (screen === 'board') renderBoard();
    syncSpeed(); syncAuto();
    const n = G.state.inventory.length;
    el['bag-badge'].style.display = n > 0 ? 'block' : 'none';
    el['bag-badge'].textContent = n;
    const sp = G.state.skillPoints || 0;
    el['hero-badge'].style.display = sp > 0 ? 'block' : 'none';
    el['hero-badge'].textContent = sp;
  }
  function syncStatsTab() { if (_inited && screen === 'hero') renderHeroStats(); }

  // ==========================================================================
  // BATTLE controls
  // ==========================================================================
  function visibleSpeedTiers() { return C.SPEED_TIERS.filter((t2) => !t2.secret || (G.state && G.state.secretSpeed)); }
  function speedOwned(tier) {
    if (tier.pro) return !!(G.isPro && G.isPro());
    if (tier.lootcoins) return !!(G.state.purchases && G.state.purchases[tier.sku]);
    if (tier.secret) return !!G.state.secretSpeed;
    return true;
  }
  function buildSpeedRow() {
    el['speed-row'].innerHTML = '';
    visibleSpeedTiers().forEach((tier) => {
      const b = document.createElement('button');
      b.className = 'spd' + (tier.secret ? ' secret' : '');
      b.innerHTML = `<span>${tier.label}</span>`;
      b.addEventListener('click', () => {
        if (tier.pro && !speedOwned(tier)) { openProSheet(); return; }
        if (tier.lootcoins && !speedOwned(tier)) { openSpeedBuy(tier); return; }
        G.setGameSpeed(tier.mult); syncSpeed();
      });
      el['speed-row'].appendChild(b);
    });
    syncSpeed();
  }
  function syncSpeed() {
    const pills = el['speed-row'].querySelectorAll('.spd');
    visibleSpeedTiers().forEach((tier, i) => {
      if (!pills[i]) return;
      const locked = (tier.lootcoins || tier.pro) && !speedOwned(tier);
      pills[i].classList.toggle('active', G.state.gameSpeed === tier.mult);
      pills[i].classList.toggle('lc-lock', !!(locked && tier.lootcoins));
      pills[i].classList.toggle('pro-lock', !!(locked && tier.pro));
      pills[i].innerHTML = `<span>${tier.label}</span>` + (locked ? (tier.pro ? '<span class="spd-pro">PRO</span>' : window._lcIcon()) : '');
    });
  }
  // ==========================================================================
  // ACCOUNT SHEET — opened from the top-bar name chip: profile, Pro manage,
  // password reset, text-alert signup, sign out.
  // ==========================================================================
  // ---- GRAPHICS QUALITY -----------------------------------------------------
  // Three tiers for players whose device cannot hold a frame rate on the full
  // render. The copy for each is read from PERF.TIERS so the settings screen and
  // the engine can never describe different things.
  //
  // The last line is the important one and it is not filler: every knob behind
  // this control is PAINT ONLY. If a player thinks Low might slow their fleet
  // down or cost them progress, they will suffer at High instead — so the
  // guarantee has to be on the screen where they choose.
  function gfxSectionHTML() {
    const P = window.PERF;
    if (!P) return '<p class="acct-hint">Graphics settings are unavailable.</p>';
    const cur = P.tier();
    const opts = P.ORDER.map((k) => {
      const t = P.TIERS[k];
      return '<button class="gfx-opt' + (k === cur ? ' on' : '') + '" data-gfx="' + k + '" type="button">' + t.label + '</button>';
    }).join('');
    return '<div class="gfx-seg" role="group" aria-label="Graphics quality">' + opts + '</div>' +
      '<p class="acct-hint gfx-note" id="ac-gfx-note" style="margin:7px 0 0">' + P.def().note + '</p>' +
      '<p class="acct-hint" style="margin:7px 0 0;color:#7ce0a0">Visual only — your fleet fights, earns and levels exactly the same on every setting.</p>';
  }
  function wireGfx(root) {
    const P = window.PERF; if (!P || !root) return;
    root.querySelectorAll('[data-gfx]').forEach((b) => b.addEventListener('click', () => {
      if (!P.setTier(b.dataset.gfx)) return;
      root.querySelectorAll('[data-gfx]').forEach((x) => x.classList.toggle('on', x === b));
      const n = root.querySelector('#ac-gfx-note'); if (n) n.textContent = P.def().note;
      toast('◧ Graphics: ' + P.label(), '#8fc4ff');
    }));
  }

  function openAccountSheet() {
    // ⚙ THE COG PING STANDS DOWN ON FIRST OPEN. The dot was drawn unconditionally,
    // so it hailed every player from install and never cleared no matter how often
    // they answered it — a notification that means nothing teaches people to ignore
    // the ones that do.
    try { if (window.ACCOUNT && window.ACCOUNT.clearCogDot) window.ACCOUNT.clearCogDot(); } catch (e) {}
    const s = (window.AUTH && window.AUTH.session && window.AUTH.session()) || {};
    const cloud = s.method === 'Supabase';
    const pro = G.isPro && G.isPro();
    const sheet = showSheet(`<div class="sheet-head">⚙ Account</div><div class="sheet-body">
      <div class="ip-stat"><span class="ip-sname">Pilot</span><span class="v">${s.name || 'Operator'}</span></div>
      <div class="ip-stat"><span class="ip-sname">Account</span><span class="v">${cloud ? (s.email || 'Cloud') : (s.method || 'Local')}</span></div>
      <div class="lo-sect" style="margin-top:11px">Profile</div>
      <div class="acct-row"><input id="ac-name" class="acct-in" maxlength="18" placeholder="New pilot name"><button class="btn" id="ac-rename">Rename</button></div>
      <div class="acct-build"><button type="button" id="ac-build" class="acct-build-pill" title="What’s new in this build">
        <span class="abp-n">BUILD ${(window.LF_BUILD | 0) || '—'}</span><span class="abp-a">PATCH NOTES ›</span>
      </button><div class="acct-build-s">LOOT FLEET V1.0 BETA</div></div>
      <div class="lo-sect" style="margin-top:11px">★ LootFleet Pro</div>
      <div class="ip-stat"><span class="ip-sname">Status</span><span class="v" style="color:${pro ? '#7ce0a0' : 'var(--muted)'}">${pro ? 'ACTIVE · renews ' + new Date(G.state.proUntil).toLocaleDateString() : 'Not subscribed'}</span></div>
      <div class="acct-row">${pro ? '<button class="btn" id="ac-manage">Manage / cancel subscription</button>' : '<button class="btn gold" id="ac-gopro">★ Go Pro — $19.99/mo</button>'}</div>
      <div class="lo-sect" style="margin-top:11px">◧ Graphics</div>
      ${gfxSectionHTML()}
      <div class="lo-sect" style="margin-top:11px">🎟 Coupon code</div>
      <div class="acct-row"><input id="ac-code" class="acct-in" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="LF-XXXX-XXXX-XXXX"><button class="btn gold" id="ac-redeem">Redeem</button></div>
      <p class="acct-hint" id="ac-code-msg" style="margin:4px 0 0;display:none"></p>
      <div class="lo-sect" style="margin-top:11px">Security</div>
      <div class="acct-row">${cloud && s.email ? '<button class="btn" id="ac-reset">Send password-reset email</button>' : '<span class="acct-hint">Password reset needs a cloud account — sign up with email to enable it.</span>'}</div>
      ${(window.LOOTFLEET || {}).fleetReport ? `<div class="lo-sect" style="margin-top:11px">✉ Fleet report</div>
      ${cloud && s.email
        ? `<p class="acct-hint" style="margin-bottom:7px">A short daily email — what your fleet did, what happened in the galaxy while you were away. No spam, unsubscribe in one tap.</p>
           <div class="acct-row" style="gap:9px;align-items:center">
             <label class="acct-tog"><input type="checkbox" id="ac-brief"><span></span></label>
             <span class="acct-hint" id="ac-brief-lbl" style="flex:1;margin:0">Loading…</span>
           </div>
           <div class="acct-row" id="ac-brief-when" style="display:none;gap:9px;align-items:center;margin-top:7px">
             <select class="acct-in" id="ac-brief-freq" style="flex:1"><option value="daily">Every day</option><option value="weekly">Weekly (Mondays)</option></select>
             <select class="acct-in" id="ac-brief-hour" style="flex:1"></select>
           </div>
           <p class="acct-hint" id="ac-brief-msg" style="margin:6px 0 0;display:none"></p>
           <p class="acct-hint" style="margin:6px 0 0;font-size:9.5px;color:#66798d">Sent to ${s.email}</p>`
        : `<p class="acct-hint">The daily fleet report needs a cloud account — sign up with email to enable it.</p>`}` : ''}
      <div class="lo-sect" style="margin-top:11px">🛠 Support</div>
      <div class="acct-row"><a class="btn" href="https://discord.gg/4F6cYmP4f" target="_blank" rel="noopener noreferrer" style="text-decoration:none;text-align:center;flex:1">Help &amp; Support on Discord</a></div>
      ${(window.LF_FS && window.LF_FS.supported) ? `<div class="lo-sect" style="margin-top:11px">Display</div>
      <div class="acct-row"><button class="btn" id="ac-fs" style="flex:1">⛶ ${(window.LF_FS.on && window.LF_FS.on()) ? 'Exit full screen' : 'Enter full screen'}</button></div>` : ''}
      <div class="lo-sect" style="margin-top:11px;color:#ff8a96">Danger zone</div>
      <p class="acct-hint" style="margin-bottom:6px">Permanently delete your account, save data and leaderboard entry. This cannot be undone.</p>
      <div class="acct-row"><button class="btn" id="ac-delete" style="border-color:rgba(255,73,95,.5);color:#ff8a96">Delete account…</button></div>
      <div class="sheet-actions" style="margin-top:14px"><button class="btn" data-x>Close</button><button class="btn" id="ac-signout" style="border-color:rgba(255,73,95,.5);color:#ff8a96">⏻ Sign out</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    const $s = (id) => sheet.querySelector('#' + id);
    wireGfx(sheet);
    const rn = $s('ac-rename');
    // THE BUILD PILL READS window.LF_BUILD, never a literal — the same rule the
    // login stamp follows, so the number on screen can never drift from the code
    // that is running. It opens the patch card in FORCED mode: show(true) bypasses
    // the once-per-build seen check, so a player can re-read the notes whenever
    // they like instead of only in the first seconds after an update.
    const bp = $s('ac-build');
    if (bp) bp.addEventListener('click', () => {
      try {
        if (window.PATCHNOTES && window.PATCHNOTES.show) window.PATCHNOTES.show(true);
        else toast('Patch notes unavailable');
      } catch (e) { toast('Patch notes unavailable'); }
    });
    if (rn) rn.addEventListener('click', () => {
      const v = ($s('ac-name').value || '').trim();
      if (v.length < 3) { toast('Name needs 3+ characters', '#e23b4e'); return; }
      if (window.ACCOUNT && window.ACCOUNT.setName && window.ACCOUNT.setName(v)) { toast('✓ Pilot name updated', '#7ce0a0'); closeSheet(); refreshAll(); }
    });
    const rd = $s('ac-redeem'); if (rd) rd.addEventListener('click', async () => {
      const inp = $s('ac-code'), msg = $s('ac-code-msg');
      const show = (ok, t) => { if (msg) { msg.style.display = ''; msg.style.color = ok ? '#7ce0a0' : '#ff8a96'; msg.textContent = t; } toast(t, ok ? '#7ce0a0' : '#e23b4e'); };
      if (!window.REDEEM) { show(false, 'Redeem unavailable — refresh the game'); return; }
      rd.disabled = true; rd.textContent = '…';
      await window.REDEEM.redeem(inp ? inp.value : '', (ok, t) => show(ok, ok ? '✓ ' + t : t));
      rd.disabled = false; rd.textContent = 'Redeem';
    });
    const gp = $s('ac-gopro'); if (gp) gp.addEventListener('click', () => { closeSheet(); openProSheet(); });
    const mg = $s('ac-manage'); if (mg) mg.addEventListener('click', () => {
      const portal = (window.LOOTFLEET && window.LOOTFLEET.stripePortal) || null;
      if (portal) window.open(portal, '_blank');
      else toast('Manage billing via your Stripe receipt email — portal link coming soon', '#ffcf7a');
    });
    const rs = $s('ac-reset'); if (rs) rs.addEventListener('click', () => {
      rs.disabled = true; rs.textContent = 'Sending…';
      try {
        window.CLOUD.client.auth.resetPasswordForEmail(s.email, { redirectTo: location.origin + location.pathname })
          .then(() => { toast('✓ Reset email sent to ' + s.email, '#7ce0a0'); rs.textContent = 'Sent ✓'; })
          .catch(() => { toast('Could not send — try again later', '#e23b4e'); rs.disabled = false; rs.textContent = 'Send password-reset email'; });
      } catch (e) { toast('Could not send — try again later', '#e23b4e'); rs.disabled = false; }
    });
    // ---- FLEET REPORT (daily brief) ----------------------------------------
    // Prefs live SERVER-side in notify_prefs — never in the save, so they can't
    // be lost to a save merge and the consent record survives independently.
    const bt = $s('ac-brief');
    if (bt) {
      const lbl = $s('ac-brief-lbl'), when = $s('ac-brief-when'),
            freq = $s('ac-brief-freq'), hour = $s('ac-brief-hour'), msg = $s('ac-brief-msg');
      const CONSENT = 'Daily fleet report by email — opted in from Account & Settings';
      for (let h = 0; h < 24; h++) {
        const o = document.createElement('option');
        o.value = h; o.textContent = (h % 12 || 12) + (h < 12 ? ' AM' : ' PM');
        hour.appendChild(o);
      }
      const paint = (on) => {
        bt.checked = !!on;
        lbl.textContent = on ? 'On — you’ll get the report' : 'Off — no emails';
        lbl.style.color = on ? '#7ce0a0' : '';
        when.style.display = on ? 'flex' : 'none';
      };
      let busy = false;
      const save = async () => {
        if (busy) return; busy = true;
        const on = bt.checked;
        msg.style.display = 'none';
        try {
          const { error } = await window.CLOUD.client.rpc('notify_save_prefs', {
            p_email_ok: on, p_digest: freq.value, p_hour: +hour.value,
            p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
            p_consent: on ? CONSENT : null,
          });
          if (error) throw error;
          paint(on);
          toast(on ? '✓ Fleet report on' : 'Fleet report off', on ? '#7ce0a0' : '#93a2ba');
        } catch (e) {
          bt.checked = !on; paint(!on);
          msg.style.display = 'block'; msg.style.color = '#ff8a96';
          msg.textContent = /function|schema|does not exist/i.test(e.message || '')
            ? 'Email reports aren’t switched on for this server yet.'
            : 'Could not save — try again.';
        }
        busy = false;
      };
      bt.addEventListener('change', save);
      freq.addEventListener('change', () => { if (bt.checked) save(); });
      hour.addEventListener('change', () => { if (bt.checked) save(); });
      (async () => {
        try {
          const { data, error } = await window.CLOUD.client.rpc('notify_get_prefs');
          if (error) throw error;
          const p = data || {};
          freq.value = p.digest === 'weekly' ? 'weekly' : 'daily';
          hour.value = p.send_hour != null ? p.send_hour : 8;
          paint(!!p.email_ok);
        } catch (e) { paint(false); lbl.textContent = 'Off — no emails'; }
      })();
    }
    const so = $s('ac-signout'); if (so) so.addEventListener('click', () => {
      if (confirm('Sign out of ' + (s.name || 'this account') + '?')) { if (window.AUTH && window.AUTH.signOut) window.AUTH.signOut(); }
    });
    const del = $s('ac-delete'); if (del) del.addEventListener('click', () => { closeSheet(); openDeleteAccountSheet(s); });
    const fs = $s('ac-fs'); if (fs) fs.addEventListener('click', () => { window.LF_FS.toggle(); closeSheet(); });
  }
  // ==========================================================================
  // ACCOUNT DELETION (App Review 5.1.1(v)) — typed confirmation, then wipes
  // cloud rows + local save + credentials and signs out. Fully in-app.
  // ==========================================================================
  function openDeleteAccountSheet(s) {
    const sheet = showSheet(`<div class="sheet-head" style="color:#ff8a96">Delete account</div><div class="sheet-body">
      <p style="font-size:12px;line-height:1.55;color:var(--muted)">This permanently deletes <b style="color:#fff">${s.name || 'this account'}</b>${s.email ? ' (' + s.email + ')' : ''} — your fleet, progress, LootCoins balance, cloud save and leaderboard entry. <b style="color:#ff8a96">This cannot be undone.</b></p>
      <p style="font-size:11.5px;margin:10px 0 6px;color:var(--muted)">Type <b style="color:#ff8a96">DELETE</b> to confirm:</p>
      <div class="acct-row"><input id="del-confirm" class="acct-in" autocomplete="off" placeholder="DELETE"></div>
      <div class="sheet-actions" style="margin-top:14px"><button class="btn" data-x>Cancel</button><button class="btn" id="del-go" disabled style="border-color:rgba(255,73,95,.5);color:#ff8a96;opacity:.5">Delete permanently</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    const inp = sheet.querySelector('#del-confirm'), go = sheet.querySelector('#del-go');
    inp.addEventListener('input', () => { const ok = inp.value.trim().toUpperCase() === 'DELETE'; go.disabled = !ok; go.style.opacity = ok ? '1' : '.5'; });
    go.addEventListener('click', async () => {
      if (go.disabled) return;
      go.disabled = true; go.textContent = 'Deleting…';
      // THE SERVER DECIDES, NOT THE BUTTON (741). deleteAccount() now returns
      // { ok, failed } and only wipes the device once the identity was actually
      // erased — so a failure here means the account is INTACT, and saying so is
      // the whole point. It used to report success unconditionally and the pilot
      // could sign straight back in.
      let res = null;
      try { res = (window.AUTH && window.AUTH.deleteAccount) ? await window.AUTH.deleteAccount() : { ok: false, failed: ['unavailable'] }; }
      catch (e) { res = { ok: false, failed: [String((e && e.message) || e)] }; }
      // A success reloads the page out from under us; anything still running here
      // did not delete. `undefined` from an older auth.js counts as success, since
      // that build's wipe-and-reload has already happened.
      if (res && res.ok === false) {
        const why = (res.failed && res.failed[0]) ? ' (' + String(res.failed[0]).slice(0, 90) + ')' : '';
        toast('Account NOT deleted — your data is untouched. Try again, or email support@lootfleet.com' + why, '#e23b4e');
        go.disabled = false; go.textContent = 'Delete permanently';
      }
    });
  }
  function openProSheet() {
    const pro = G.isPro && G.isPro();
    const conf = window.PAYMENTS && window.PAYMENTS.linkFor && !!window.PAYMENTS.linkFor('pro_monthly');
    // EVERY FIGURE HERE IS READ OFF PRO_PERKS, never restated. The table in
    // game-v93 is the single statement of what the subscription does; a hardcoded
    // "5× XP" in the sell copy is a number that goes stale the day the table is
    // retuned, on the one screen where being wrong costs money.
    const k = (G.proMods ? G.proMods().perks : null) || { xpMult: 5, gold: 2, loot: 1.5, beaconCdCut: 0.25, tiles: 10, dreadAttempts: 1, speed: 5 };
    const benefits = [
      ['✨ Experience', k.xpMult + '× XP on every kill, account-wide'],
      ['⚡ Battle speed', 'Exclusive ' + k.speed + '× tier — Pro only'],
      ['$ Gold', k.gold + '× gold from every kill'],
      ['❖ Loot', '+' + Math.round((k.loot - 1) * 100) + '% drop chance on every wreck'],
      ['◉ Beacon', 'Recharges ' + Math.round(k.beaconCdCut * 100) + '% faster'],
      ['⬡ Empire', '+' + k.tiles + ' galaxy tiles you can hold'],
      ['☠ Dreadnaught hunt', '+' + k.dreadAttempts + ' hunt per tier, every week'],
    ].map(([n, v]) => '<div class="ip-stat"><span class="ip-sname">' + n + '</span><span class="v">' + v + '</span></div>').join('');
    // Apple Guideline 3.1.2 — the purchase sheet must state the subscription
    // title, duration, price, what the user gets, and link Privacy + Terms.
    const sheet = showSheet(`<div class="sheet-head">★ LootFleet Pro</div><div class="sheet-body">
      ${pro ? `<div class="pro-active"><b>✓ ACTIVE MEMBER</b><span>Renews ${new Date(G.state.proUntil).toLocaleDateString()} · everything below is switched on right now.</span></div>` : `
      <div class="ip-stat"><span class="ip-sname">Subscription</span><span class="v">LootFleet Pro</span></div>
      <div class="ip-stat"><span class="ip-sname">Duration</span><span class="v">Monthly · auto-renews</span></div>
      <div class="ip-stat"><span class="ip-sname">Price</span><span class="v">$19.99 / month</span></div>`}
      <div class="lo-sect" style="margin-top:10px">${pro ? 'Your unlocked benefits' : 'What you get'}</div>
      ${benefits}
      <p style="font-size:10.5px;line-height:1.5;color:var(--muted);margin-top:8px">Every XP bonus you already own — VIP, Pilot Tree, Neural Uplink, Kaevith hulls — is a percentage of your base rate, so Pro multiplies all of them at once.</p>
      <p style="font-size:10.5px;line-height:1.55;color:var(--muted);margin-top:10px">Payment is charged to your account at confirmation of purchase. The subscription renews automatically each month at $19.99 unless cancelled at least 24 hours before the end of the current period. Manage or cancel anytime in your account settings.</p>
      <p style="font-size:11px;margin-top:8px"><a href="privacy.html" target="_blank" rel="noopener" style="color:#5fa8ff">Privacy Policy</a> · <a href="terms.html" target="_blank" rel="noopener" style="color:#5fa8ff">Terms of Use</a></p>
      ${conf ? '' : '<p style="font-size:10.5px;color:#ffcf7a;margin-top:8px">⚒ Subscriptions are not live yet — payments are being wired up.</p>'}
      <div class="sheet-actions"><button class="btn" data-x>Close</button>
        ${pro ? '<button class="btn" data-manage>Manage / cancel</button>' : '<button class="btn gold" data-ok>★ Buy Subscription — $19.99/mo</button>'}</div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    const mg = sheet.querySelector('[data-manage]');
    if (mg) mg.addEventListener('click', () => {
      const portal = (window.LOOTFLEET && window.LOOTFLEET.stripePortal) || null;
      if (portal) window.open(portal, '_blank', 'noopener');
      else toast('Manage your subscription from your account settings', '#ffcf7a');
    });
    const ok = sheet.querySelector('[data-ok]');
    if (ok) ok.addEventListener('click', () => {
      const r = window.PAYMENTS && window.PAYMENTS.subscribe ? window.PAYMENTS.subscribe() : { ok: false };
      if (!r.ok) toast('⚒ Subscriptions coming soon', '#ffcf7a');
      else toast('Complete checkout in the new tab', '#7ce0a0');
    });
  }
  function openShipLCBuy(key, price) {
    const sh = C.SHIP_BY_KEY[key];
    const have = G.getCredits ? G.getCredits() : 0;
    const afford = have >= price;
    const sheet = showSheet(`<div class="sheet-head">${window._lcIcon()} Unlock ${sh.name}</div><div class="sheet-body">
      <p style="font-size:11.5px;color:var(--muted);line-height:1.5;margin-bottom:9px">${sh.desc}</p>
      <div class="ip-stat"><span class="ip-sname">Fast-track</span><span class="v">No blueprint · no kill requirement · yours instantly</span></div>
      <div class="ip-stat"><span class="ip-sname">Price</span><span class="v">${window._lcIcon()} ${price.toLocaleString()} LootCoins</span></div>
      <div class="ip-stat"><span class="ip-sname">Your balance</span><span class="v" style="color:${afford ? '#7ce0a0' : 'var(--bad)'}">${window._lcIcon()} ${Math.floor(have).toLocaleString()}</span></div>
      ${afford ? '' : '<p style="font-size:10.5px;color:#ffcf7a;margin-top:6px">Not enough LootCoins — grab a pack and come back.</p>'}
      <div class="sheet-actions"><button class="btn" data-x>Cancel</button>
        <button class="btn gold" data-ok>${afford ? 'Unlock ' + sh.name : 'Get LootCoins'}</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    sheet.querySelector('[data-ok]').addEventListener('click', () => {
      if (!afford) { closeSheet(); openCredits(); return; }
      const r = G.buyShipLC(key);
      if (r.ok) { closeSheet(); toast('★ ' + sh.name + ' unlocked!', '#ffd24d'); renderStore(); }
      else { closeSheet(); toast('Cannot unlock', '#e23b4e'); }
    });
  }
  function openSpeedBuy(tier) {
    const have = G.getCredits ? G.getCredits() : 0;
    const afford = have >= tier.lootcoins;
    const sheet = showSheet(`<div class="sheet-head">${window._lcIcon()} Unlock ${tier.label} Speed</div><div class="sheet-body">
      <p style="font-size:11.5px;color:var(--muted);line-height:1.5;margin-bottom:9px">Permanent ${tier.label} battle speed, on every fight from here on. One purchase, never again. ${(G.proMods ? G.proMods().perks.speed : 3)}× is higher still and comes with LootFleet Pro.</p>
      <div class="ip-stat"><span class="ip-sname">Price</span><span class="v">${window._lcIcon()} ${tier.lootcoins} LootCoins</span></div>
      <div class="ip-stat"><span class="ip-sname">Your balance</span><span class="v" style="color:${afford ? '#7ce0a0' : 'var(--bad)'}">${window._lcIcon()} ${(G.formatNumRaw || G.formatNum)(have)}</span></div>
      ${afford ? '' : '<p style="font-size:10.5px;color:#ffcf7a;margin-top:6px">Not enough LootCoins — grab a pack and come back.</p>'}
      <div class="sheet-actions"><button class="btn" data-x>Cancel</button>
        <button class="btn gold" data-ok>${afford ? 'Unlock ' + tier.label : 'Get LootCoins'}</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    sheet.querySelector('[data-ok]').addEventListener('click', () => {
      if (!afford) { closeSheet(); openCredits(); return; }
      const r = G.buySpeed4();
      if (r.ok) { closeSheet(); G.setGameSpeed(tier.mult); buildSpeedRow(); toast('⚡ ' + tier.label + ' speed unlocked — permanently!', '#ffd24d'); }
      else { closeSheet(); toast('Cannot unlock', '#e23b4e'); }
    });
  }
  // ◉ BEACON button state — hidden outside Zone Grind, arc drains on cooldown,
  // pulses red while the swarm is live.
  const BC_CIRC = 106.8;   // 2πr for r=17, matches the CSS stroke-dasharray
  function syncBeacon() {
    const b = el['beacon-btn']; if (!b || !G || !G.beaconState) return;
    const st = G.beaconState();
    // stay visible for the whole grind; grey out rather than vanish
    if (!st.visible) { if (b.style.display !== 'none') b.style.display = 'none'; return; }
    if (b.style.display !== 'flex') b.style.display = 'flex';
    const arc = el['beacon-arc'], lbl = el['beacon-lbl'];
    let cls = 'beacon-btn ', frac = 1, text = 'BEACON';
    if (st.active) {
      cls += 'live'; frac = st.life > 0 ? st.activeLeft / st.life : 0;
      text = Math.ceil(st.activeLeft) + 's';
    } else if (st.blocked) {
      cls += 'cool'; frac = 1; text = 'BOSS';
    } else if (!st.ready) {
      cls += 'cool'; frac = st.cd > 0 ? 1 - (st.left / st.cd) : 1;
      const mm = Math.floor(st.left / 60), ss = Math.ceil(st.left % 60);
      text = mm > 0 ? mm + ':' + String(Math.min(59, ss)).padStart(2, '0') : Math.ceil(st.left) + 's';
    } else {
      cls += 'ready';
    }
    if (b.className !== cls) b.className = cls;
    if (arc) arc.style.strokeDashoffset = (BC_CIRC * (1 - Math.max(0, Math.min(1, frac)))).toFixed(1);
    if (lbl && lbl.textContent !== text) lbl.textContent = text;
    const tip = st.active ? 'Beacon live — swarm inbound'
      : st.blocked ? 'Beacon locked out while a boss is on the field'
      : st.ready ? 'Beacon — summon a ×' + st.mult + ' swarm for ' + st.life + 's (' + st.cd + 's cooldown)'
      : 'Beacon recharging';
    if (b.title !== tip) b.title = tip;
  }

  function syncAuto() {
    const on = G.getAuto();
    el['auto-btn'].classList.toggle('on', on);
    el['auto-lbl'].textContent = on ? 'Auto' : 'Manual';
    const w = $('auto-warn'); if (w) w.classList.toggle('show', on);
    syncJoystickVisible();
  }
  function syncJoystickVisible() {
    el['joystick'].classList.toggle('show', !G.getAuto() && screen === 'battle');
  }

  // joystick (manual movement)
  function initJoystick() {
    const j = el['joystick'], knob = j.querySelector('.knob');
    let active = false, cx = 0, cy = 0; const R = 36;
    function start(e) { active = true; const r = j.getBoundingClientRect(); cx = r.left + r.width/2; cy = r.top + r.height/2; move(e); }
    function move(e) {
      if (!active) return;
      const p = e.touches ? e.touches[0] : e;
      let dx = p.clientX - cx, dy = p.clientY - cy;
      const d = Math.hypot(dx, dy) || 1; const cl = Math.min(d, R);
      const nx = dx/d, ny = dy/d;
      knob.style.transform = `translate(${nx*cl}px,${ny*cl}px)`;
      G.setJoystick(nx * (cl/R), ny * (cl/R), true);
      if (e.cancelable) e.preventDefault();
    }
    function end() { active = false; knob.style.transform = ''; G.setJoystick(0,0,false); }
    j.addEventListener('mousedown', start); window.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
    j.addEventListener('touchstart', start, {passive:false}); j.addEventListener('touchmove', move, {passive:false}); j.addEventListener('touchend', end);
    initWASD();
  }

  // WASD / arrow-key movement (desktop browsers with a keyboard). Holding any
  // movement key drives the same joystick vector the thumb-stick uses — auto
  // stays in charge until a key is pressed, then manual flight takes over.
  function initWASD() {
    const held = new Set();
    const KEYMAP = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
    function typingTarget(e) {
      const t = e.target;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    }
    function sync() {
      let x = 0, y = 0;
      if (held.has('left')) x -= 1;
      if (held.has('right')) x += 1;
      if (held.has('up')) y -= 1;
      if (held.has('down')) y += 1;
      if (x || y) {
        const d = Math.hypot(x, y);
        G.setJoystick(x / d, y / d, true);
      } else {
        G.setJoystick(0, 0, false);
      }
    }
    window.addEventListener('keydown', (e) => {
      const dir = KEYMAP[e.code];
      if (!dir || typingTarget(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      // ignore when the battle canvas isn't the active screen (menus, sheets)
      if (screen !== 'battle') { if (held.size) { held.clear(); sync(); } return; }
      // grabbing the keys takes over from auto-pilot, same as grabbing the stick would
      if (G.state.auto) { G.setAuto(false); G.state.autoManual = true; try { G.save(); } catch (e) {} syncAuto(); toast('⌨ Manual flight — WASD / arrows', '#5b9cff'); }
      if (!held.has(dir)) { held.add(dir); sync(); }
      e.preventDefault();                       // stop arrow keys scrolling the page
    });
    window.addEventListener('keyup', (e) => {
      const dir = KEYMAP[e.code];
      if (!dir) return;
      if (held.delete(dir)) sync();
    });
    // dropping focus (tab switch, modal) releases all keys — no stuck movement
    window.addEventListener('blur', () => { if (held.size) { held.clear(); sync(); } });
    document.addEventListener('visibilitychange', () => { if (document.hidden && held.size) { held.clear(); sync(); } });
  }

  // ==========================================================================
  // HERO
  // SECRET: click the "Leaderboard" tab 20 times IN A ROW — password gate
  // (code: a certain someone's name) → Chroma Regent free + 100B of everything.
  function tapBoard() {
    _lbTaps++;
    const left = 20 - _lbTaps;
    if (left <= 0) {
      _lbTaps = 0;
      promptBoardPassword();
    } else if (_lbTaps >= 8) {
      toast('✦ ' + left + ' more…', '#ff7bd5');
    }
  }
  function promptBoardPassword() {
    const sheet = showSheet(`<div class="sheet-head">✦ Access Restricted</div><div class="sheet-body">
      <p style="font-size:12.5px;color:#cbb8e6;line-height:1.5;margin-bottom:10px">You've triggered a classified spectrum override. Enter the authorization code to unlock the vault.</p>
      <input id="board-pass" type="password" autocomplete="off" placeholder="Authorization code"
        style="width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #3a3160;background:#120c1e;color:#eaf0fa;font-family:'Rajdhani',sans-serif;font-size:16px;letter-spacing:.18em;text-align:center;font-weight:700">
      <div id="board-err" style="display:none;color:var(--bad);font-size:11px;margin-top:7px;text-align:center">Incorrect code — access denied.</div>
      <div class="sheet-actions" style="margin-top:12px"><button class="btn" data-x>Cancel</button>
        <button class="btn primary" data-ok>Authorize</button></div></div>`);
    const input = sheet.querySelector('#board-pass');
    const err = sheet.querySelector('#board-err');
    if (input) setTimeout(() => { try { input.focus(); } catch (e) {} }, 60);
    const submit = () => {
      if ((input.value || '').trim().toLowerCase() === 'sophie') { closeSheet(); grantBoardJackpot(); }
      else { err.style.display = 'block'; input.value = ''; try { input.focus(); } catch (e) {} }
    };
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    sheet.querySelector('[data-ok]').addEventListener('click', submit);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }
  // The prize: the Chroma Regent, free — plus 100 BILLION of every currency.
  function grantBoardJackpot() {
    const HUNDRED_B = 100000000000;
    const haveShip = G.state.ownedShips && G.state.ownedShips.chromaregent;
    const gotShip = !haveShip && G.grantShip('chromaregent');
    // FULL ACCESS: the vault also promotes the pilot to Lv 500 (same as the
    // other easter eggs) — unlocking every gated system: Fleet Command @100
    // with all 4 escort slots, Pilot Tree, My Galaxy, Dreadnaught, Voidmaw
    // event, Moon Colony, Casino, Prism Fleet @200 … plus the skill points to
    // match. setLevel routes through onLevelUp so every veil/badge refreshes.
    const wasLv = G.state.level | 0;
    const promoted = wasLv < 500 && G.setLevel && (G.setLevel(500), true);
    G.state.gold = (G.state.gold || 0) + HUNDRED_B;
    G.state.dreadCores = (G.state.dreadCores || 0) + HUNDRED_B;
    if (!G.state.resources) G.state.resources = { fuel: 0, iron: 0, plasma: 0 };
    G.state.resources.fuel = (G.state.resources.fuel || 0) + HUNDRED_B;
    G.state.resources.iron = (G.state.resources.iron || 0) + HUNDRED_B;
    G.state.resources.plasma = (G.state.resources.plasma || 0) + HUNDRED_B;
    if (G.state.prism) G.state.prism.ingots = (G.state.prism.ingots || 0) + HUNDRED_B;
    G.addCredits(HUNDRED_B);   // LootCoins (also saves + refreshes)
    if (gotShip && G.switchShip) G.switchShip('chromaregent');
    refreshAll();
    const sheet2 = showSheet(`<div class="sheet-head" style="color:#ff7bd5">✦ SPECTRUM VAULT OPEN</div><div class="sheet-body" style="text-align:center">
      <div style="display:grid;place-items:center;margin:6px 0 10px"><img src="ships/ship-chromaregent.png" alt="" style="width:150px;height:104px;object-fit:contain;filter:drop-shadow(0 0 18px #ff7bd5)"></div>
      <p style="font-size:15px;font-weight:800;margin-bottom:6px">${gotShip ? 'CHROMA REGENT — yours, free.' : 'Chroma Regent already owned — vault pays out anyway.'}</p>
      <p style="font-size:12px;color:var(--muted);line-height:1.6">+100B Gold · +100B LootCoins · +100B Fuel · +100B Ore · +100B Plasma · +100B Dread Cores${G.state.prism ? ' · +100B Prism Ingots' : ''}${promoted ? '<br><b style="color:#ffd24d">★ PROMOTED TO LEVEL 500</b> — Fleet Command (4 escort slots), Pilot Tree, Prism Fleet… everything is unlocked.' : ''}</p>
      <div class="sheet-actions" style="margin-top:14px"><button class="btn gold" data-x>Magnificent</button></div></div>`);
    sheet2.querySelector('[data-x]').addEventListener('click', closeSheet);
    toast('✦ Spectrum vault — Chroma Regent + 100B everything', '#ff7bd5');
  }

  // ==========================================================================
  // SECRET: click the "Market" tab 20 times IN A ROW — password gate
  // (code: frostylikesmen) → FrostyFrost free.
  function tapMarket() {
    _mkTaps++;
    const left = 20 - _mkTaps;
    if (left <= 0) {
      _mkTaps = 0;
      promptMarketPassword();
    } else if (_mkTaps >= 8) {
      toast('❄ ' + left + ' more…', '#8cd2ff');
    }
  }
  function promptMarketPassword() {
    const sheet = showSheet(`<div class="sheet-head">❄ Access Restricted</div><div class="sheet-body">
      <p style="font-size:12.5px;color:#b8d4e6;line-height:1.5;margin-bottom:10px">You've triggered a classified cryo override. Enter the authorization code to unlock the vault.</p>
      <input id="market-pass" type="password" autocomplete="off" placeholder="Authorization code"
        style="width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #31506a;background:#0c161e;color:#eaf6fa;font-family:'Rajdhani',sans-serif;font-size:16px;letter-spacing:.18em;text-align:center;font-weight:700">
      <div id="market-err" style="display:none;color:var(--bad);font-size:11px;margin-top:7px;text-align:center">Incorrect code — access denied.</div>
      <div class="sheet-actions" style="margin-top:12px"><button class="btn" data-x>Cancel</button>
        <button class="btn primary" data-ok>Authorize</button></div></div>`);
    const input = sheet.querySelector('#market-pass');
    const err = sheet.querySelector('#market-err');
    if (input) setTimeout(() => { try { input.focus(); } catch (e) {} }, 60);
    const submit = () => {
      if ((input.value || '').trim().toLowerCase() === 'frostylikesmen') { closeSheet(); grantMarketJackpot(); }
      else { err.style.display = 'block'; input.value = ''; try { input.focus(); } catch (e) {} }
    };
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    sheet.querySelector('[data-ok]').addEventListener('click', submit);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }
  // The prize: FrostyFrost, free.
  function grantMarketJackpot() {
    const haveShip = G.state.ownedShips && G.state.ownedShips.frostyfrost;
    const gotShip = !haveShip && G.grantShip('frostyfrost');
    if (gotShip && G.switchShip) G.switchShip('frostyfrost');
    G.save();
    refreshAll();
    const sheet2 = showSheet(`<div class="sheet-head" style="color:#8cd2ff">❄ CRYO VAULT OPEN</div><div class="sheet-body" style="text-align:center">
      <div style="display:grid;place-items:center;margin:6px 0 10px"><img src="ships/ship-frostyfrost.png" alt="" style="width:150px;height:104px;object-fit:contain;filter:drop-shadow(0 0 18px #8cd2ff)"></div>
      <p style="font-size:15px;font-weight:800;margin-bottom:6px">${gotShip ? 'FROSTYFROST — yours, free.' : 'FrostyFrost already owned — nothing new in the vault.'}</p>
      <p style="font-size:12px;color:var(--muted);line-height:1.6">Titan Carrier power · chills every target · flash-freezes them into ice cubes. Bosses are immune.</p>
      <div class="sheet-actions" style="margin-top:14px"><button class="btn gold" data-x>Chilling</button></div></div>`);
    sheet2.querySelector('[data-x]').addEventListener('click', closeSheet);
    toast('❄ Cryo vault — FrostyFrost unlocked', '#8cd2ff');
  }

  // ==========================================================================
  // SECRET: click "My Ship" 20 times IN A ROW in the Hangar to unlock the
  // Mothership + 10× speed (first time) AND bank 1,000,000 LootCoins. Repeatable
  // — run the trick as many times as you like; each completion pays 1M coins.
  // The streak resets on any other click (see the capture-phase listener in init).
  function tapMyShip() {
    _msTaps++;
    const left = 20 - _msTaps;
    if (left <= 0) {
      _msTaps = 0;
      promptSecretPassword();   // gate the prize behind a password
    } else if (_msTaps >= 8) {
      toast('✦ ' + left + ' more…', '#c77bff'); // whisper only once the streak is well underway
    }
  }
  // Password gate for the Ships-tab easter egg. Correct code → full jackpot.
  function promptSecretPassword() {
    const sheet = showSheet(`<div class="sheet-head">✦ Access Restricted</div><div class="sheet-body">
      <p style="font-size:12.5px;color:#cbb8e6;line-height:1.5;margin-bottom:10px">You've triggered a classified fleet override. Enter the authorization code to unlock the vault.</p>
      <input id="secret-pass" type="password" inputmode="numeric" autocomplete="off" placeholder="Authorization code"
        style="width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #3a3160;background:#120c1e;color:#eaf0fa;font-family:'Rajdhani',sans-serif;font-size:16px;letter-spacing:.18em;text-align:center;font-weight:700">
      <div id="secret-err" style="display:none;color:var(--bad);font-size:11px;margin-top:7px;text-align:center">Incorrect code — access denied.</div>
      <div class="sheet-actions" style="margin-top:12px"><button class="btn" data-x>Cancel</button>
        <button class="btn primary" data-ok>Authorize</button></div></div>`);
    const input = sheet.querySelector('#secret-pass');
    const err = sheet.querySelector('#secret-err');
    if (input) setTimeout(() => { try { input.focus(); } catch (e) {} }, 60);
    const submit = () => {
      if ((input.value || '').trim() === '20042004') { closeSheet(); grantSecretJackpot(); }
      else { err.style.display = 'block'; input.value = ''; try { input.focus(); } catch (e) {} }
    };
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    sheet.querySelector('[data-ok]').addEventListener('click', submit);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }
  // The prize: current reward (Mothership + 10× speed + Level 500) PLUS one
  // billion of EVERY resource — gold, LootCoins, Dread Cores, fuel, iron,
  // plasma, and Prism Ingots.
  function grantSecretJackpot() {
    const BILLION = 1000000000;
    const haveShip = G.state.ownedShips && G.state.ownedShips.mothership;
    const gotShip = !haveShip && G.grantShip('mothership');
    const gotSpeed = !G.state.secretSpeed;
    if (gotSpeed) { G.state.secretSpeed = true; G.setGameSpeed(10); buildSpeedRow(); }
    if (G.setLevel) G.setLevel(500);
    // 1,000,000,000 of every resource
    G.state.gold = (G.state.gold || 0) + BILLION;
    G.state.dreadCores = (G.state.dreadCores || 0) + BILLION;
    if (!G.state.resources) G.state.resources = { fuel: 0, iron: 0, plasma: 0 };
    G.state.resources.fuel = (G.state.resources.fuel || 0) + BILLION;
    G.state.resources.iron = (G.state.resources.iron || 0) + BILLION;
    G.state.resources.plasma = (G.state.resources.plasma || 0) + BILLION;
    if (G.state.prism) G.state.prism.ingots = (G.state.prism.ingots || 0) + BILLION;
    try { const pf = window.PRISMFLEET && window.PRISMFLEET.P && window.PRISMFLEET.P(); if (pf) pf.cores = (pf.cores || 0) + 10; } catch (e) {}
    G.addCredits(BILLION);   // LootCoins (also saves + refreshes)
    G.save();
    const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#ff6ad5'; t.style.fontSize = '24px';
    t.innerHTML = (gotShip ? '✦ MOTHERSHIP UNLOCKED<br>' : '') +
      (gotSpeed ? '<span style="color:#ffd24d">⚡ 10× SPEED UNLOCKED</span><br>' : '') +
      '<span style="color:#7cff9b">💰 +1 BILLION OF EVERY RESOURCE</span><br>' +
      '<span style="font-size:12px;color:#ffd7f3">Gold · LootCoins · Dread Cores · Fuel · Iron · Plasma · Prism &nbsp;·&nbsp; <b style="color:#7cff9b">Level 500</b></span>';
    el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 4200);
    if (window.DREAD && window.DREAD.updateHud) try { window.DREAD.updateHud(); } catch (e) {}
    refreshAll();
    if (screen === 'hero') renderHero();
  }
  function tapMyFleet() {
    // SECRET: tap your fleet in the HUD 20 times IN A ROW to unlock EVERY hull
    // and bank 1,000,000 LootCoins. Repeatable — fire it as many times as you like.
    // The streak resets on any other click (see the capture-phase listener in init).
    _fleetTaps++;
    const left = 20 - _fleetTaps;
    if (left <= 0) {
      _fleetTaps = 0;
      (C.SHIPS || []).forEach((s) => { if (!(G.state.ownedShips && G.state.ownedShips[s.key])) G.grantShip(s.key); });
      G.addCredits(1000000);
      if (G.setLevel) G.setLevel(500);   // secret: instantly jump to Level 500
      // +10 Prism Cores (ready to apply for the Prism Aura)
      try { const pf = window.PRISMFLEET && window.PRISMFLEET.P && window.PRISMFLEET.P(); if (pf) { pf.cores = (pf.cores || 0) + 10; } } catch (e) {}
      G.save();
      const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#ffd24d'; t.style.fontSize = '24px';
      t.innerHTML = '🚀 FULL ARMADA UNLOCKED<br>' +
        '<span style="font-size:13px;color:#bfe0ff">Every hull is yours &nbsp;·&nbsp; <b style="color:#ffd24d">+1,000,000</b> LootCoins &nbsp;·&nbsp; <b style="color:#c9a0ff">+10 ◈ Prism Cores</b> &nbsp;·&nbsp; <b style="color:#7cff9b">Level 500</b></span>';
      el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 3600);
      refreshAll();
    } else if (_fleetTaps >= 8) {
      toast('✦ ' + left + ' more…', '#ffd24d');
    }
  }
  function renderHero() {
    const st = G.getStats();
    // unified Hangar segment header (My Ship active) so Ship + Store share a tab
    const heroBody = document.getElementById('char-portrait').parentNode;
    const oldTabs = heroBody.querySelector('.store-cats'); if (oldTabs) oldTabs.remove();
    heroBody.insertAdjacentHTML('afterbegin', hangarTabsHTML('ship'));
    wireHangarTabs(heroBody);
    el['hero-sub'].textContent = (window.AUTH ? window.AUTH.name() : 'Operator') + ' · Lv ' + G.state.level;
    // LOOTFLEET PRO hero offering — purchase pill for non-members ONLY; members
    // wear the ACTIVE badge in the top bar instead (no pill in the Hangar)
    {
      const pb = $('pro-banner');
      if (pb) {
        const pro = G.isPro && G.isPro();
        const ppk = (G.proMods ? G.proMods().perks : null) || { xpMult: 5, speed: 3, gold: 2 };
        pb.innerHTML = pro
          ? ''
          : `<div class="pro-offer" id="pro-offer-cta"><div class="po-tag">PRO</div><div class="po-main"><div class="po-name">LootFleet Pro</div><div class="po-desc">✨ ${ppk.xpMult}× XP · ⚡ exclusive ${ppk.speed}× speed · $ ${ppk.gold}× gold · +5 more</div><button class="po-buy">$19.99 / month — Go Pro</button></div></div>`;
        const cta = pb.querySelector('#pro-offer-cta');
        if (cta) cta.addEventListener('click', openProSheet);
      }
    }
    // XP rate — from the one source of truth (GAME.xpFleetInfo): ONE SUM.
    //   100 + 400 (Pro) + every other bonus added, bonuses capped at +500,
    //   total capped at 1000. Nothing multiplies anything else.
    // The chip names WHICH ceiling is biting (bonus vs total), so the hero screen
    // and the My Ship pill can never tell different stories — and so a pilot past
    // the bonus ceiling is told, rather than silently losing the overflow.
    {
      const xi = (() => { try { return G.xpFleetInfo ? G.xpFleetInfo() : null; } catch (e) { return null; } })();
      // THE CAP IS STATED PLAINLY, AND IT IS THE PILOT'S OWN CAP.
      // This used to quote the global 1000% to everyone. Only a Pro account can
      // reach that (base 500 + 500 bonus); a free pilot tops out at 600, so the
      // old text promised 400 points of headroom that do not exist and then said
      // CAPPED at 600 — which reads as a broken number rather than a rule.
      // When the stack overflows, the wasted amount is named outright: a bonus
      // that pays nothing must never look like a bonus that pays.
      const xpChip = xi
        ? ' <span class="hero-xp-chip' + (xi.capped ? ' capped' : xi.buffPct > 0 ? '' : ' zero') + '" title="' + (xi.capped
            ? 'CAPPED AT ' + xi.myCap + '% — your bonuses add up to ' + xi.rawPct + '%, so ' + xi.wastedPct + '% is being discarded and pays you nothing. '
              + (xi.pro ? 'This is the hard ceiling.' : 'Without Pro the ceiling is ' + xi.myCap + '% (base ' + xi.basePct + '% + ' + xi.bonusCap + '% bonuses); Pro raises the base to 500% for a ' + xi.cap + '% ceiling.')
              + ' More XP bonuses add nothing until something drops off.'
            : xi.buffPct > 0
            ? 'Your XP rate: base ' + xi.basePct + '%' + (xi.pro ? ' (5× by Pro)' : '') + ' + ' + xi.buffPct + '% in bonuses \u2014 VIP, Pilot Tree, ascension perks and Kaevith hulls. Bonuses add together, then multiply the base. Your ceiling is ' + xi.myCap + '% (' + xi.headroom + '% of bonus headroom left).'
            : 'Base XP rate \u2014 no bonuses active. VIP, Pilot Tree XP nodes, Neural Uplink, Combat Computer and Kaevith hulls each add a flat % of base, up to a ' + xi.myCap + '% ceiling.')
          + '">\u2726 XP ' + xi.pct + '%' + (xi.capped ? ' · MAX ' + xi.myCap + '%' : '') + '</span>'
        : '';
      el['char-power'].innerHTML = 'Power <b>' + (G.formatNumRaw || G.formatNum)(G.score ? G.score() : Math.floor(st.theoryDps + st.maxHp * 0.5)) + '</b>' + xpChip;
    }
    // equipment — driven by the current ship's actual slot layout
    el['equip-grid'].innerHTML = '';
    G.equipLayout().forEach(({ key, label, icon, item: it }) => {
      const d = document.createElement('div');
      d.className = 'equip-slot' + (it ? '' : ' empty');
      d.innerHTML = `<div class="slot-icon ${it ? rc(it.rarity) : ''}" style="${it ? 'border-color:' + C.RARITY[it.rarity].color : ''}">${it ? itemIcon(it) : icon}</div>
        <div class="slot-meta"><div class="slot-label">${label}</div><div class="slot-item ${it ? rc(it.rarity) : ''}">${it ? it.name : 'Empty'}</div></div>`;
      if (it) d.addEventListener('click', () => openItem(it, 'equipped', key));
      el['equip-grid'].appendChild(d);
    });
    // PRISM CORE — a permanent prismatic loadout slot shown when the active hull carries an aura
    if (G.state.shipAura && G.state.shipAura[G.state.ship]) {
      const pd = document.createElement('div');
      pd.className = 'equip-slot prism-slot';
      pd.innerHTML = `<div class="slot-icon prism-ic">◈</div>
        <div class="slot-meta"><div class="slot-label">Prism Core</div><div class="slot-item prism-name">Prism Aura · active</div></div>`;
      pd.addEventListener('click', () => {
        const sh = showSheet(`<div class="sheet-head">◈ Prism Core</div><div class="sheet-body">
          <p style="margin:0 0 10px">This hull is fused with a <b style="color:#c9a0ff">Prism Core</b>, projecting the <b>Prism Aura</b>:</p>
          <div class="stat-block"><span class="sb-name">Deflect</span><span class="sb-val">1% chance to reflect a hit back</span></div>
          <div class="stat-block"><span class="sb-name">Splash</span><span class="sb-val">10% of your damage as AOE</span></div>
          <p style="font-size:11px;color:var(--muted);margin:10px 0 0">Permanent &amp; bound to this hull. Forge more cores in <b>Prism Fleet</b>.</p>
          <div class="sheet-actions" style="margin-top:12px"><button class="btn primary" data-x>Close</button></div></div>`);
        const x = sh.querySelector('[data-x]'); if (x) x.addEventListener('click', closeSheet);
      });
      el['equip-grid'].prepend(pd);
    }
    renderFleet();
    renderShipUpgrade();
    renderHeroStats();
  }
  // Hull-level color ramp — the hull climbs the SAME colour ladder as loot
  // rarity as you level it up (grey → blue → purple → orange → red → teal →
  // gold → pink → violet → primordial gold). Names/colours mirror CONFIG.RARITY.
  const SHIP_LVL_TIERS = [
    { min:1,  color:'#9aa0a6', name:'Common' },
    { min:3,  color:'#4a90e2', name:'Rare' },
    { min:5,  color:'#b15cff', name:'Epic' },
    { min:7,  color:'#f0972a', name:'Legendary' },
    { min:9,  color:'#ff3b4e', name:'Mythic' },
    { min:11, color:'#21d4c4', name:'Ancient' },
    { min:13, color:'#ffe27a', name:'Divine' },
    { min:15, color:'#ff6ad5', name:'Cosmic' },
    { min:17, color:'#9a5bff', name:'Void' },
    { min:20, color:'#ffe6a8', name:'Primordial' },
  ];
  function shipLvlTier(L){ let t=SHIP_LVL_TIERS[0]; for(const x of SHIP_LVL_TIERS) if(L>=x.min) t=x; return t; }
  window.shipLvlColor = (L) => shipLvlTier(L).color; // read by render.js for the in-battle tint
  // Coloured hull-upgrade cost — gold ● and plasma ✦ in their real resource
  // Coloured hull-upgrade cost — glyphs + colours mirror the wallet chips so the
  // cost reads as the SAME currencies: $ gold and ✦ plasma.
  function hullCostHTML(inf){
    return `<span style="display:inline-flex;align-items:center;gap:6px;background:rgba(6,10,18,.5);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:3px 10px;font-variant-numeric:tabular-nums;font-weight:800">`+
      `<span style="color:#f2a93c">$</span><span style="color:#ffe6b0">${G.formatNum(inf.cost.gold)}</span>`+
      `<span style="color:#c07bff;margin-left:4px">✦</span><span style="color:#e4d2ff">${G.formatNum(inf.cost.plasma)}</span></span>`;
  }
  // Confirm + WARN before every hull upgrade: an upgraded hull is reset to Lv 1
  // (and its invested resources lost) if the ship is destroyed.
  function confirmHullUpgrade(key, after){
    if (!G.shipUpInfo) return;
    const ship = C.SHIP_BY_KEY[key]; const inf = G.shipUpInfo(key); if (!inf || inf.maxed) return;
    const col = (window.shipLvlColor ? window.shipLvlColor(inf.level) : '#f2b24b');
    const sheet = showSheet(`<div class="sheet-head">Upgrade Hull → Lv ${inf.level+1}</div><div class="sheet-body">
      <p>Upgrade the <b>${ship?ship.name:'hull'}</b> to <b style="color:${col}">Hull Lv ${inf.level+1}</b>?<br><span style="color:#46d27a;font-size:12px">+10% DMG · +12% HP · +5% Rate</span></p>
      <div style="background:rgba(255,80,80,.08);border:1px solid rgba(255,120,120,.35);border-radius:9px;padding:10px 12px;color:#ff9a64;font-size:12px;line-height:1.45;margin:4px 0 10px">⚠ <b>If your hull is destroyed, it resets to Lv 1</b> and every resource you spent leveling it is lost for good. Upgrade at your own risk.</div>
      <div class="stat-block"><span class="sb-name">Cost</span><span class="sb-val">${hullCostHTML(inf)}</span></div>
      <div class="sheet-actions" style="margin-top:12px"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok ${inf.afford?'':'disabled'}>Upgrade Hull</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    const ok = sheet.querySelector('[data-ok]');
    if (ok) ok.addEventListener('click', () => { const r = G.upgradeShip(key); closeSheet();
      if (r.ok) { toast('⬆ ' + (ship?ship.name:'Hull') + ' → Hull Lv ' + r.level, col); (after||refreshAll)(); }
      else { toast(r.reason==='plasma' ? 'Need more Plasma (✦)' : r.reason==='gold' ? 'Need more gold' : 'Cannot upgrade', '#e23b4e'); }
    });
  }
  function renderShipUpgrade(){
    if (!G.shipUpInfo) return;
    const key = G.state.ship; const ship = C.SHIP_BY_KEY[key]; const inf = G.shipUpInfo(key);
    const tier = shipLvlTier(inf.level); const col = tier.color;
    let host = document.getElementById('ship-upgrade');
    if (!host){ host = document.createElement('div'); host.id = 'ship-upgrade'; const anchor = $('pro-banner') || document.getElementById('char-portrait'); if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(host, anchor); else return; }
    const body = inf.maxed
      ? `<div style="text-align:center;font-family:Orbitron,sans-serif;font-weight:800;font-size:12px;color:${col};letter-spacing:.06em">★ MAX HULL · APEX</div>`
      : `<button class="btn primary" id="ship-up-btn" ${inf.afford?'':'disabled'} style="width:100%;display:flex;align-items:center;justify-content:center;gap:9px;padding:7px 10px;${inf.afford?'':'opacity:.5;filter:grayscale(.5);cursor:not-allowed'}">
           <span>⬆ Upgrade Hull</span>
           ${hullCostHTML(inf)}
         </button>
         <div style="font-size:8.5px;color:#ff9a64;margin-top:5px;text-align:center;line-height:1.3">⚠ Destroyed hull resets to Lv 1 — upgrade resources are lost on death</div>`;
    host.innerHTML =
      `<div style="background:linear-gradient(180deg,#172030,#131a28);border:1px solid ${col}55;border-radius:11px;padding:8px 10px;margin:0 12px 8px;box-shadow:0 0 14px ${col}1c">
         <div style="display:flex;align-items:center;gap:8px;margin-bottom:${inf.maxed?'0':'7px'}">
           <div style="width:24px;height:24px;border-radius:7px;background:${col}22;border:1px solid ${col};display:grid;place-items:center;font-family:Orbitron,sans-serif;font-weight:800;font-size:11px;color:${col};flex:none">${inf.level}</div>
           <div style="flex:1;min-width:0;display:flex;align-items:baseline;gap:7px;flex-wrap:wrap">
             <span style="font-family:Orbitron,sans-serif;font-weight:700;font-size:12px;color:#eaf0fa;white-space:nowrap">${ship?ship.name:'Hull'} <span style="color:${col};font-size:9px;letter-spacing:.08em">· ${tier.name}</span></span>
             <span style="font-size:9.5px;color:#46d27a;font-weight:700;white-space:nowrap">+${inf.bonus.dmg}% DMG · +${inf.bonus.hp}% HP · +${inf.bonus.rate}% Rate</span>
           </div>
           ${inf.maxed?'':'<span style="font-size:9px;color:#93a2ba;white-space:nowrap">next: <b style="color:#46d27a">+10/+12/+5%</b></span>'}
         </div>
         ${body}
       </div>`;
    const btn = host.querySelector('#ship-up-btn');
    if (btn) btn.addEventListener('click', () => confirmHullUpgrade(key, renderHero));
  }
  // ==========================================================================
  // FLEET PANEL — flagship + escort slots; matches the hangar-bay visual
  // ==========================================================================
  // THE FORMATION STRIP, ONE STATEMENT OF IT. Flagship tile, escort slots, and
  // locked slots with the level that opens them. Extracted from renderFleet()
  // (build 731) so the Bridge shows the same strip wired to the SAME pickers —
  // a formation UI that exists twice drifts twice.
  function fleetSlotsHTML() {
    const slots = G.fleetSlots();
    const fleet = G.getFleet();
    const flag = C.SHIP_BY_KEY[G.state.ship];
    let cells = `<div class="fp-slot flag" data-fpflag="1" title="Tap to change flagship"><img src="ships/ship-${flag.key}.png" alt=""><div class="fps-n">${flag.name}</div><div class="fps-tag star">★ FLAGSHIP · ⇄</div></div>`;
    C.FLEET.slotLevels.forEach((lv, i) => {
      if (i < slots) {
        const k = fleet[i];
        if (k && G.state.ownedShips[k] && k !== G.state.ship) {
          const sh = C.SHIP_BY_KEY[k];
          cells += `<div class="fp-slot filled" data-fp="${i}"><img src="ships/ship-${k}.png" alt=""><div class="fps-n">${sh.name}</div><div class="fps-tag on">● ESCORT</div></div>`;
        } else {
          cells += `<div class="fp-slot empty" data-fp="${i}"><div class="fps-add">+</div><div class="fps-n">Add ship</div><div class="fps-tag">OPEN</div></div>`;
        }
      } else {
        cells += `<div class="fp-slot locked"><div class="fps-add">🔒</div><div class="fps-n">Lv ${lv}</div><div class="fps-tag">LOCKED</div></div>`;
      }
    });
    return cells;
  }
  function wireFleetSlots(root) {
    if (!root) return;
    root.querySelectorAll('[data-fp]').forEach((d) => d.addEventListener('click', () => openFleetPicker(+d.dataset.fp)));
    const fb = root.querySelector('[data-fpflag]'); if (fb) fb.addEventListener('click', openFlagshipPicker);
    try { if (window.COMMANDERS) window.COMMANDERS.bindFleetRow(root); } catch (e) {}
  }
  function renderFleet() {
    const panel = $('fleet-panel'); if (!panel) return;
    const lvl = G.state.level, slots = G.fleetSlots();
    const fleet = G.getFleet();
    const flag = C.SHIP_BY_KEY[G.state.ship];
    if (lvl < 100) {
      panel.innerHTML = `<div class="fp-head"><span class="fp-title">⬡ Fleet</span><span class="fp-sub">5 ships max</span></div>
        <div class="fp-locked">🔒 Fleet command unlocks at <b>Lv 100</b> — then +1 escort slot every 100 levels. Your other hulls fly <b>with</b> you in battle and add their strength to your Fleet Score.</div>`;
      return;
    }
    const cells = fleetSlotsHTML();
    const n = G.fleetShips().length;
    panel.innerHTML = `<div class="fp-head"><span class="fp-title">⬡ Fleet</span><span class="fp-sub">${n + 1}/${1 + slots} flying · ${n > 0 ? 'Fleet Score active' : 'deploy escorts to boost your score'}</span></div><div class="fp-slots">${cells}</div>${window.COMMANDERS ? window.COMMANDERS.fleetRowHTML() : ''}${fleetLoadoutsHTML()}`;
    wireFleetSlots(panel);
    // loadout chips open the item card
    panel.querySelectorAll('[data-fli]').forEach((d) => d.addEventListener('click', () => {
      const [k, sk] = d.dataset.fli.split(':');
      const fit = k === G.state.ship ? G.state.equipped : (G.state.fittings ? G.state.fittings[k] : null);
      const it = fit && fit[sk];
      if (it) openItem(it, 'equipped');
    }));
  }
  // Per-ship LOADOUTS — every flying hull with its icon and exactly what it has
  // equipped, so you can tell at a glance which ship is running which items.
  function fleetLoadoutsHTML() {
    const ships = [{ key: G.state.ship, role: '★ FLAGSHIP', fit: G.state.equipped }]
      .concat(G.fleetShips().map((s) => ({ key: s.key, role: '● ESCORT', fit: (G.state.fittings || {})[s.key] || null })));
    if (ships.length < 2) return ''; // solo flagship — the equip grid below covers it
    let html = '<div class="fl-title">Loadouts</div>';
    ships.forEach(({ key, role, fit }) => {
      const sh = C.SHIP_BY_KEY[key]; if (!sh) return;
      let chips = '', fitted = 0;
      C.shipSlots(key).forEach((sk) => {
        const slotDef = C.SLOTS[C.slotBase(sk)];
        const it = fit ? fit[sk] : null;
        if (it) {
          fitted++;
          const col = C.RARITY[it.rarity].color;
          // THE CHIP'S LIGHTNING FOLLOWS THE ICONS (build 712): >= 14, the three
          // ascension-exclusive tiers, not >= 11. rc() still tags the tier class
          // so the effect and the border colour come from the same source.
          const pc = it.rarity >= 14 ? ' flc-arc ' + rc(it.rarity) : '';
          chips += `<div class="flc${pc}" data-fli="${key}:${sk}" style="border-color:${col}55"><span class="flc-ic">${itemIcon(it)}</span><span class="flc-n" style="color:${col}">${it.name}</span></div>`;
        } else {
          chips += `<div class="flc empty"><span class="flc-ic">${slotDef.icon}</span><span class="flc-n">empty</span></div>`;
        }
      });
      const isFlag = key === G.state.ship;
      html += `<div class="fl-card ${isFlag ? 'flag' : ''}">
        <div class="fl-head"><img src="ships/ship-${key}.png" alt="">
          <div class="fl-meta"><div class="fl-name">${sh.name}</div><div class="fl-role ${isFlag ? 'flag' : ''}">${role} · ${fitted}/${C.shipSlots(key).length} fitted</div></div></div>
        <div class="fl-chips">${chips}</div>
        ${(!fit || !fitted) && !isFlag ? '<div class="fl-hint">No gear stowed — switch to this hull once to fit it out.</div>' : ''}</div>`;
    });
    return html;
  }
  // FLAGSHIP PICKER — switch the hull YOU fly straight from the fleet panel.
  // Escorts flying a hull can't take the helm until pulled from their slot.
  function openFlagshipPicker() {
    const fleet = G.getFleet();
    const avail = C.SHIPS.filter((s) => G.state.ownedShips[s.key] && s.key !== G.state.ship);
    let rows = avail.map((s) => {
      const inFleet = fleet.includes(s.key);
      return `<div class="fp-pick" data-fk="${s.key}" ${inFleet ? 'data-esc="1"' : ''}><img src="ships/ship-${s.key}.png" alt=""><div class="fpp-m"><div class="fpp-n">${s.name}</div><div class="fpp-d">${inFleet ? '● currently an escort — tap to promote' : (s.tag || s.cls)}</div></div><span class="fpp-go">${inFleet ? 'PROMOTE' : 'TAKE HELM'}</span></div>`;
    }).join('');
    if (!rows) rows = '<p style="color:var(--muted);font-size:11.5px;line-height:1.5">No other hulls owned — buy ships in Hangar → Ships first.</p>';
    const cur = C.SHIP_BY_KEY[G.state.ship];
    const sheet = showSheet(`<div class="sheet-head">Change Flagship</div><div class="sheet-body">
      <p style="font-size:11.5px;color:var(--muted);margin-bottom:8px">Flying: <b style="color:#ffd24d">${cur ? cur.name : G.state.ship}</b> — pick the hull to take the helm. Its equipped loadout stays with your pilot.</p>
      ${rows}
      <div class="sheet-actions"><button class="btn" data-x>Close</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    sheet.querySelectorAll('[data-fk]').forEach((d) => d.addEventListener('click', () => {
      const k = d.dataset.fk;
      if (d.dataset.esc) {
        const idx = G.getFleet().indexOf(k);
        if (idx >= 0) G.setFleetSlot(idx, null);   // pull from escort duty first
      }
      if (G.switchShip(k)) { toast('★ ' + C.SHIP_BY_KEY[k].name + ' is now your flagship', '#ffd24d'); closeSheet(); renderHero(); }
      else switchFailToast(k);
    }));
  }
  function openFleetPicker(i) {
    const fleet = G.getFleet();
    const cur = fleet[i];
    const avail = C.SHIPS.filter((s) => G.state.ownedShips[s.key] && s.key !== G.state.ship && !fleet.includes(s.key));
    let rows = avail.map((s) => `<div class="fp-pick" data-k="${s.key}"><img src="ships/ship-${s.key}.png" alt=""><div class="fpp-m"><div class="fpp-n">${s.name}</div><div class="fpp-d">${s.tag || s.cls}</div></div><span class="fpp-go">DEPLOY</span></div>`).join('');
    if (!rows && !cur) rows = '<p style="color:var(--muted);font-size:11.5px;line-height:1.5">No other hulls owned yet — buy ships in Hangar → Ships, then deploy them here as escorts.</p>';
    const sheet = showSheet(`<div class="sheet-head">Escort Slot</div><div class="sheet-body">
      ${cur ? `<div class="fp-pick rm" data-rm><div class="fpp-m"><div class="fpp-n">Remove ${C.SHIP_BY_KEY[cur] ? C.SHIP_BY_KEY[cur].name : cur}</div><div class="fpp-d">free this slot</div></div><span class="fpp-go" style="color:var(--bad)">✕</span></div>` : ''}
      ${rows}
      <div class="sheet-actions"><button class="btn" data-x>Close</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    const rm = sheet.querySelector('[data-rm]'); if (rm) rm.addEventListener('click', () => { G.setFleetSlot(i, null); closeSheet(); renderHero(); });
    sheet.querySelectorAll('[data-k]').forEach((d) => d.addEventListener('click', () => {
      const r = G.setFleetSlot(i, d.dataset.k);
      if (r.ok) { toast('✓ ' + C.SHIP_BY_KEY[d.dataset.k].name + ' joins the fleet', '#7ce0a0'); closeSheet(); renderHero(); }
      else toast('Cannot deploy (' + r.reason + ')', '#e23b4e');
    }));
  }
  function renderHeroStats() {
    const st = G.getStats();
    const rows = [
      ['Damage', G.formatNum(st.attackDamage)],
      ['Fire Rate', st.attacksPerSec.toFixed(2) + '/s'],
      ['Crit Chance', st.critChance.toFixed(1) + '%'],
      ['Crit Damage', '+' + st.critDamage.toFixed(0) + '%'],
      ['Max Health', G.formatNum(st.maxHp)],
      ['Move Speed', st.moveSpeed.toFixed(0) + '%'],
    ];
    let html = rows.map(([n, v]) => `<div class="stat-row"><span class="s-name">${n}</span><span class="s-val">${v}</span></div>`).join('');
    if (st.lifeSteal > 0) html += `<div class="stat-row special"><span class="s-name">Life Steal</span><span class="s-val">${Math.round(st.lifeSteal * 10) / 10}%</span></div>`;
    if (st.multiShot > 0) html += `<div class="stat-row special"><span class="s-name">Multi-Shot</span><span class="s-val">${Math.round(st.multiShot)}% · 10 tgt</span></div>`;
    html += `<button class="signout-btn" id="signout-btn">Sign Out</button>`;
    el['stat-list'].innerHTML = html;
    const so = $('signout-btn'); if (so) so.addEventListener('click', () => { if (window.AUTH) window.AUTH.signOut(); });
    // Multiplier pills above the stat list, and the empire-income hero block at
    // the bottom of the scroll. Both live in ship-panels.js and rebuild in place.
    try { if (window.SHIPPANELS) window.SHIPPANELS.mount(); } catch (e) {}
  }

  // ==========================================================================
  // BAG
  // ==========================================================================
  function renderBag() {
    bagCacheReset();
    const inv = G.state.inventory.slice();
    sortInv(inv);
    el['bag-sub'].textContent = inv.length + ' / ' + (G.invCap ? G.invCap() : 100) + ' slots';
    const recZone = Math.max(1, G.recommendedZone());
    const chances = G.rarityChances(recZone);
    // CARGO HOLD — capacity meter + exponentially-priced expansion
    const cap = G.invCap ? G.invCap() : 100;
    const cost = G.invSlotCost ? G.invSlotCost() : 0;
    const pct = Math.min(100, inv.length / cap * 100);
    const afford = G.state.gold >= cost;
    let html = `<div class="cargo-row ${inv.length >= cap ? 'full' : ''}">
      <div class="cargo-l"><div class="cargo-t">▤ Cargo Hold <b>${inv.length} / ${cap}</b>${inv.length >= cap ? ' · <span class="cargo-warn">FULL — new loot auto-scraps</span>' : ''}</div>
        <div class="cargo-bar"><div class="cargo-fill" style="width:${pct}%"></div></div></div>
      <button class="cargo-buy ${afford ? '' : 'cant'}" id="cargo-buy">+100 slots<span class="cargo-cost">$ ${(G.formatNumRaw || G.formatNum)(cost)}</span></button></div>`;
    // pickup filter + auto-sell-on-pickup controls
    {
      const PF = G.state.pickupFilter || 0;
      const AST = G.state.autoSellTier == null ? -1 : G.state.autoSellTier;
      html += `<div class="filter-row">
        <div class="fr-item"><span class="fr-l">▼ Pick up</span><select id="pickup-sel">${C.RARITY.slice(0, 7).map((r, i) => `<option value="${i}" ${i === PF ? 'selected' : ''}>${i === 0 ? 'Everything' : r.name + ' +'}</option>`).join('')}</select></div>
        <div class="fr-item"><span class="fr-l">$ Sell on pickup</span><select id="autosell-pickup-sel"><option value="-1" ${AST < 0 ? 'selected' : ''}>Off</option>${C.RARITY.map((r, i) => `<option value="${i}" ${i === AST ? 'selected' : ''}>≤ ${r.name}</option>`).join('')}</select></div>
      </div>
      <div class="fr-hint">Pick up: anything below is scrapped to resources on contact · Sell on pickup: drops at/below this rarity are sold for gold as you grab them (upgrades always kept)</div>`;
    }
    html += `<div class="legend"><div class="legend-title">Rarity <span class="legend-note">· drop odds at Zone ${recZone}</span></div><div class="legend-grid">`;
    C.RARITY.forEach((r) => {
      html += `<div class="legend-chip ${rc(r.tier)}"><span class="legend-dot" style="background:${r.color};color:${r.color}"></span><span class="legend-nm">${r.name}</span><span class="legend-pct">${fmtChance(chances[r.tier])}</span></div>`;
    });
    html += '</div></div>';
    // optimize row: auto-equip + auto-sell filter
    const tierOpts = C.RARITY.map((r) => `<option value="${r.tier}" ${r.tier === G.state.sellTier ? 'selected' : ''}>${r.name}</option>`).join('');
    html += `<div class="bag-actions">
        <div class="equip-row">
          <button class="opt-btn equip" id="auto-equip">⚙ Auto-Equip Best</button>
          <button class="auto-toggle ${G.state.autoEquipAlways?'on':''}" id="auto-always"><span class="at-led"></span>Always</button>
        </div>
        <div class="autosell">
          <span class="as-lbl">Bulk-sell hold ≤</span>
          <select id="sell-tier">${tierOpts}</select>
          <label class="as-keep"><input type="checkbox" id="keep-up" ${G.state.keepUpgrades ? 'checked' : ''}><span>Keep upgrades</span></label>
          <button class="opt-btn sell" id="auto-sell">Sell</button>
        </div>
      </div>`;
    html += `<div class="inv-controls">
      <select id="sort-sel">
        <option value="power">Sort: Power</option><option value="rarity">Sort: Rarity</option>
        <option value="slot">Sort: Slot</option><option value="ilvl">Sort: Zone</option>
      </select></div>`;
    if (!inv.length) html += '<div id="bag-items"><div class="empty-note">No loot in your bag.<br>Run over drops to collect them.</div></div>';
    else html += '<div id="bag-items">' + bagRows(inv).map(itemCard).join('') + bagMoreBtn(inv) + '</div>';
    el['bag-body'].innerHTML = html;
    const cb = $('cargo-buy'); if (cb) cb.addEventListener('click', () => {
      const r = G.buyInvSlots();
      if (r.ok) { toast('▦ Cargo hold expanded to ' + r.cap + ' slots', '#5bc06b'); renderBag(); }
      else toast('Not enough gold — next expansion costs $' + (G.formatNumRaw || G.formatNum)(G.invSlotCost()), '#e23b4e');
    });
    const ps = $('pickup-sel'); if (ps) ps.addEventListener('change', () => {
      G.setPickupFilter(+ps.value);
      toast(+ps.value === 0 ? 'Picking up everything' : '▼ Picking up ' + C.RARITY[+ps.value].name + ' and better — rest is scrapped', '#9ec5ff');
    });
    const asp = $('autosell-pickup-sel'); if (asp) asp.addEventListener('change', () => {
      // setAutoSellTier now sweeps the hold ON THE SPOT and reports what went, so
      // the toggle's own toast can say it. Before, the hold was swept at the next
      // pickup flush and the player watched a stale count for a second or more.
      const r = G.setAutoSellTier(+asp.value) || {};
      toast(+asp.value < 0 ? 'Auto-sell off' : '$ Auto-selling ' + C.RARITY[+asp.value].name + ' and below on pickup', '#e6b566');
      if (r.n) toast('$ Hold swept — sold ' + r.n + ' for ' + G.formatNum(r.gold), '#e6b566');
      refreshAll();
    });
    const sel = $('sort-sel'); sel.value = sortMode; sel.addEventListener('change', () => { sortMode = sel.value; renderBag(); });
    $('auto-equip').addEventListener('click', () => { const n = G.autoEquip(); toast(n ? 'Equipped best gear' : 'Already optimal', n ? '#2f9e4f' : '#9c8d78'); });
    $('auto-always').addEventListener('click', () => { G.state.autoEquipAlways = !G.state.autoEquipAlways; if (G.state.autoEquipAlways) G.autoEquip(); G.save(); renderBag(); });
    const tierSel = $('sell-tier'), keep = $('keep-up');
    tierSel.addEventListener('change', () => { G.state.sellTier = +tierSel.value; G.save(); });
    keep.addEventListener('change', () => { G.state.keepUpgrades = keep.checked; G.save(); });
    $('auto-sell').addEventListener('click', () => openAutoSell(+tierSel.value, keep.checked));
    const bm = $('bag-more'); if (bm) bm.addEventListener('click', () => { _bagAll = true; renderBag(); });
    bindBagItems();
  }
  // Bind click-to-open on the item cards. Used by both the full renderBag and the
  // lightweight live refresh below.
  function bindBagItems() {
    const host = document.getElementById('bag-items'); if (!host || host._lfDeleg) return;
    // ONE DELEGATED LISTENER, not one per card. This used to attach a handler to
    // every row, so a 1,000-item hold registered 1,000 of them — and did it again on
    // every live refresh while farming. The container survives an innerHTML swap of
    // its children, so the flag holds it to exactly one for the life of the panel.
    host._lfDeleg = 1;
    host.addEventListener('click', (e) => {
      const node = e.target.closest('[data-id]');
      if (!node || !host.contains(node)) return;
      const it = G.state.inventory.find((x) => x.id === +node.dataset.id);
      if (it) openItem(it, 'inventory');
    });
  }
  // LIVE bag refresh while farming with the Loot tab open. Rebuilds ONLY the
  // item-list container (not the whole panel) so the cargo meter, filters and
  // legend don't replay their staggered fade-in — which was the "flashing".
  function renderBagItems() {
    const host = document.getElementById('bag-items');
    if (!host) { renderBag(); return; }
    bagCacheReset();
    const inv = G.state.inventory.slice();
    sortInv(inv);
    const cap = G.invCap ? G.invCap() : 100;
    el['bag-sub'].textContent = inv.length + ' / ' + cap + ' slots';
    // keep the cargo-hold count + fill bar live without touching the rest of the panel
    const cf = el['bag-body'].querySelector('.cargo-fill');
    if (cf) cf.style.width = Math.min(100, inv.length / cap * 100) + '%';
    host.innerHTML = inv.length
      ? bagRows(inv).map(itemCard).join('') + bagMoreBtn(inv)
      : '<div class="empty-note">No loot in your bag.<br>Run over drops to collect them.</div>';
    const bm2 = document.getElementById('bag-more');
    if (bm2) bm2.addEventListener('click', () => { _bagAll = true; renderBag(); });
    bindBagItems();
  }
  function sortInv(inv) {
    // POWER WAS RECOMPUTED INSIDE THE COMPARATOR. itemPower() walks the item's stat
    // map and runs classAdjustPower, and a comparator calls it twice per
    // comparison — so sorting a 1,000-item hold cost roughly 20,000 of them, and
    // the hold re-renders up to 3×/sec while farming with the Loot tab open.
    // Decorated once and sorted on the number instead: 1,000 calls, not 20,000.
    if (sortMode === 'power' || sortMode === 'rarity') {
      const p = new Map();
      for (let i = 0; i < inv.length; i++) p.set(inv[i], G.itemPower(inv[i]));
      if (sortMode === 'power') inv.sort((a, b) => p.get(b) - p.get(a));
      else inv.sort((a, b) => (b.rarity - a.rarity) || (p.get(b) - p.get(a)));
      return;
    }
    if (sortMode === 'slot') inv.sort((a, b) => a.slot.localeCompare(b.slot) || b.rarity - a.rarity);
    else inv.sort((a, b) => b.ilvl - a.ilvl);
  }
  function specialTags(it) {
    let t = '';
    if (it.stats.lifeSteal) t += '<span class="ic-tag" style="color:var(--c-uncommon);border-color:var(--c-uncommon)">LS</span>';
    if (it.stats.multiShot) t += '<span class="ic-tag" style="color:var(--c-rare);border-color:var(--c-rare)">MULTI</span>';
    return t;
  }
  function itemCard(it) {
    const r = C.RARITY[it.rarity];
    const up = isUpgrade(it);
    return `<div class="item-card ${bl(it.rarity)}" data-id="${it.id}">
      <div class="ic-icon ${rc(it.rarity)}" style="box-shadow:0 0 10px ${r.glow}">${itemIcon(it)}</div>
      <div class="ic-main"><div class="ic-name ${rc(it.rarity)}">${it.name}</div>
      <div class="ic-sub">${r.name} · ${C.SLOTS[it.slot].name} · Z${it.dungeon}</div></div>
      <div style="display:flex;gap:4px;align-items:center">${specialTags(it)}${up ? '<span class="ic-tag up">▲</span>' : ''}</div></div>`;
  }
  // THE EQUIPPED ITEM'S POWER IS THE SAME NUMBER FOR EVERY ROW IN ITS SLOT, and it
  // was recomputed once per card — N extra itemPower() calls per render to answer
  // eight distinct questions. Cached per render pass instead. bagCacheReset() runs
  // at the top of BOTH bag renders, so it can never serve a stale figure across a
  // re-equip, a sell or a pickup.
  let _eqPow = null;
  function bagCacheReset() { _eqPow = new Map(); }
  function eqPower(slot) {
    if (!_eqPow) _eqPow = new Map();
    if (!_eqPow.has(slot)) { const cur = G.state.equipped[slot]; _eqPow.set(slot, cur ? G.itemPower(cur) : -Infinity); }
    return _eqPow.get(slot);
  }
  function isUpgrade(it) { return G.itemPower(it) > eqPower(it.slot); }
  // ---- ROW CAP -------------------------------------------------------------
  // Every other long list in this file is paginated, and the galaxy one says why
  // in as many words: 1,950 rows is a browser-killer on a phone. The hold was the
  // one list that rendered ALL of it — one card per item, each carrying an inline
  // SVG icon, rebuilt up to 3×/sec while farming. That is main-thread work a phone
  // cannot hide, so the next menu tap queues behind it. It never showed on desktop
  // because a desktop simply absorbs it.
  //
  // The cap is deliberately generous: an ordinary hold renders exactly as it did
  // and nobody sees a change. Only a hoard is bounded, the count says so plainly,
  // and one tap opts back into the full list.
  const BAG_CAP = 200;
  let _bagAll = false;
  function bagRows(inv) { return (!_bagAll && inv.length > BAG_CAP) ? inv.slice(0, BAG_CAP) : inv; }
  function bagMoreBtn(inv) {
    if (_bagAll || inv.length <= BAG_CAP) return '';
    return `<button class="bag-more" id="bag-more">Showing the top ${BAG_CAP} of ${inv.length} — show all</button>`;
  }
  // A MEASUREMENT, NOT A GUESS. Reported mobile lag on the battle → zones → loot
  // path is main-thread render cost; this is how to confirm it on the device that
  // actually has the problem instead of inferring it from a desktop. Same idea as
  // CARGORUN.trace(). Call UI.bagTrace() in the console.
  function bagTrace() {
    const inv = (G.state.inventory || []).slice();
    const t0 = performance.now();
    bagCacheReset();
    sortInv(inv);
    const t1 = performance.now();
    const rows = bagRows(inv);
    const html = rows.map(itemCard).join('');
    const t2 = performance.now();
    const probe = document.createElement('div');
    probe.innerHTML = html;
    const t3 = performance.now();
    const nodes = probe.querySelectorAll('*').length;
    return { items: inv.length, rendered: rows.length, cap: _bagAll ? 'off' : BAG_CAP, sort: sortMode,
      sortMs: +(t1 - t0).toFixed(1), buildMs: +(t2 - t1).toFixed(1), parseMs: +(t3 - t2).toFixed(1),
      totalMs: +(t3 - t0).toFixed(1), domNodes: nodes };
  }

  // confirm auto-sell with the chosen filter
  function openAutoSell(maxTier, keepUpgrades) {
    const prev = G.autoSellPreview(maxTier, keepUpgrades);
    const rname = C.RARITY[maxTier].name;
    if (!prev.n) { toast('Nothing matches that filter', '#9c8d78'); return; }
    const sheet = showSheet(`<div class="sheet-head">Auto-Sell</div><div class="sheet-body">
      <p>Sell every <b class="${rc(maxTier)}">${rname}</b> and lower item${keepUpgrades ? ' <b>except slot upgrades</b>' : ''}?</p>
      <div class="stat-block"><span class="sb-name">Items</span><span class="sb-val">${prev.n}</span></div>
      <div class="stat-block"><span class="sb-name">You receive</span><span class="sb-val" style="color:var(--gold)"><span class="coin">$</span> ${G.formatNum(prev.earned)}</span></div>
      <p class="as-salvage">Plus a chance to salvage <span style="color:${GM.RES.fuel.color}">${GM.RES.fuel.glyph} Fuel</span>, <span style="color:${GM.RES.iron.color}">${GM.RES.iron.glyph} Iron</span> &amp; <span style="color:${GM.RES.plasma.color}">${GM.RES.plasma.glyph} Plasma</span> for My Galaxy — rarer gear yields more.</p>
      <div class="sheet-actions"><button class="btn" data-x>Cancel</button><button class="btn gold" data-ok>Sell ${prev.n}</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    sheet.querySelector('[data-ok]').addEventListener('click', () => { const r = G.autoSell(maxTier, keepUpgrades); closeSheet(); const sv = salvageStr(r.salvage); toast(`Sold ${r.n} for ${G.formatNum(r.earned)}g${sv ? '  ·  ' + sv : ''}`, '#e6b566'); });
  }

  // ==========================================================================
  // ZONES
  // ==========================================================================
  // ==========================================================================
  // GALAXY MAP (replaces the old zone list)
  // ==========================================================================
  function hexPts(cx, cy, r) {
    let p = [];
    for (let i = 0; i < 6; i++) { const a = (60 * i - 90) * Math.PI / 180; p.push((cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1)); }
    return p.join(' ');
  }
  function fmtCd(sec) { const m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  // ==========================================================================
  // THE GALAXY — one massive unified hex grid (~25 rings ≈ 1,950 tiles).
  // Canvas-rendered with pan / pinchless zoom (buttons + wheel) / tap tiles.
  // Center = neutral HOME CITADEL. Color code: blue available · red rival ·
  // gold yours · gray locked · ⛴ citadel siege zone · ◷ cooldown.
  // ==========================================================================
  const gxCam = { x: 0, y: 0, z: 1 };       // persistent across re-renders
  let _gxCv = null, _gxNeedsDraw = false;
  const gxCitImg = new Image(); gxCitImg.src = 'ships/ship-citadel.png';
  // THE XYN sits on its tile the same way a fortress does — real art seated in the
  // hex, not a glyph. It is the only ship on the galaxy map.
  const gxXynImg = new Image(); gxXynImg.src = 'ships/ship-xyn.png';
  let _citTint = {};   // color → tinted <canvas> of the citadel sprite (built once it loads)
  function tintedCitadel(color) {
    if (!gxCitImg.complete || !gxCitImg.naturalWidth) return null;
    if (_citTint[color]) return _citTint[color];
    const cv = document.createElement('canvas'); cv.width = gxCitImg.naturalWidth; cv.height = gxCitImg.naturalHeight;
    const cx = cv.getContext('2d'); cx.drawImage(gxCitImg, 0, 0);
    cx.globalCompositeOperation = 'source-atop'; cx.globalAlpha = 0.6; cx.fillStyle = color; cx.fillRect(0, 0, cv.width, cv.height);
    cx.globalAlpha = 1; cx.globalCompositeOperation = 'source-over';
    _citTint[color] = cv; return cv;
  }
  const GX_HEX = 26;                         // base hex size at zoom 1
  // ---- XYN PRIME DRAWS DOUBLE SIZE -----------------------------------------
  // It is the arena for the rarest prize in the game and should read as a
  // landmark rather than the fourteenth hex of a chain — but only just. It shipped
  // at ×4 and that was too much: it dwarfed the filament it belongs to.
  //
  // IT GROWS EASTWARD, NOT OUT FROM ITS CENTRE. A scaled hex centred on (33,0)
  // reaches back over Embolus and Thrombus and swallows the stem that leads to it,
  // which destroys the one thing that geometry is for. Xyn Prime is a dead end
  // pointing into empty space with no on-map neighbour at all, so the drawn centre
  // is pushed east — it expands into nothing and covers no tile.
  //
  // THE SHIFT IS DERIVED SO THE HEX TOUCHES ITS NEIGHBOUR. These are POINTY-TOP
  // hexes, so a hex of circumradius R is √3·R wide and its half-width is √3·R/2.
  // For the scaled hex's west edge to land exactly on Embolus's east edge, the
  // centre has to move by the extra half-width it gained: (S−1)·(√3/2)·GX_HEX.
  // The first cut used a hand-picked 1.05× fudge instead, which pushed it too far
  // and left a visible GAP — the reported "not connected". Derived, it is flush at
  // any scale, so changing XYN_HEX_SCALE alone can never disconnect it again.
  //
  // THE TAP FOLLOWS THE DRAWING, which is why _xynHit exists. pointerup maps a
  // pixel back to a coordinate with unpixel(), which knows nothing about a visual
  // offset — so a shifted hex would have been UN-TAPPABLE, and the biggest landmark
  // on the map would have been the one tile a player could not open. The draw pass
  // records where it actually put the hex and the tap reads that record, so the
  // geometry is stated once instead of twice.
  const XYN_HEX_SCALE = 2;
  const XYN_HEX_SHIFT = GX_HEX * (XYN_HEX_SCALE - 1) * Math.sqrt(3) / 2;
  let _xynHit = null;
  // The tile outline, as a path. Extracted because the canvas current path is NOT
  // part of the drawing state: any beginPath() between building the hex and
  // stroking it silently replaces it, and save()/restore() will not restore it.
  // Call this again after any such interruption rather than assuming the hex
  // survived. Radius matches the original inline loop exactly.
  function gxHexPath(ctx, cx, cy, scale) {
    const r = GX_HEX * (scale || 1) - 1.5;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 3 * i + Math.PI / 6;
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  }
  // THE CONTIGUITY HERO PILL — sits directly under the ◈ Systems / MANAGE pill.
  // Every figure comes off G.clusterSummary(); the tier names, thresholds and
  // percentages are read from CLUSTER_TIERS in game-v93 rather than restated, so
  // retuning the ladder moves this card with it.
  function clusterPillHTML() {
    if (!G.clusterSummary) return '';
    const s = G.clusterSummary();
    const tiers = s.tiers || [];
    const plural = (n) => n === 1 ? '1 system' : n + ' systems';
    const rungs = tiers.slice().reverse().map((t) => {
      const on = s.biggest >= t.need;
      const live = s.tier && s.tier.need === t.need;
      return `<span class="ctg-r${on ? ' on' : ''}${live ? ' live' : ''}" style="--c:${t.color}">`
        + `<b>${t.need}+</b><i>+${t.add}%</i></span>`;
    }).join('');
    const head = s.tier
      ? `<span class="ctg-badge" style="--c:${s.tier.color}">${s.tier.name} · +${s.tier.add}%</span>`
      : '<span class="ctg-badge off">NO BLOCK YET</span>';
    const lead = s.tier
      ? `Your largest block is <b>${plural(s.biggest)}</b> touching, and <b>every tile in it</b> pays <b style="color:${s.tier.color}">+${s.tier.add}%</b> an hour.`
        + (s.blocks > 1 ? ` You hold <b>${s.blocks}</b> qualifying blocks — <b>${plural(s.boosted)}</b> boosted in total.` : '')
      : s.biggest > 0
        ? `Your largest block is <b>${plural(s.biggest)}</b> touching. <b>${s.toNext} more</b> joined onto it starts the bonus at <b>+${(tiers[tiers.length - 1] || {}).add}%</b>.`
        : 'Take systems that <b>share an edge</b> with one you already hold. Four touching starts the bonus.';
    const next = s.tier && s.next
      ? `<div class="ctg-next"><b>${s.toNext}</b> more touching → <b style="color:${s.next.color}">+${s.next.add}%</b> (${s.next.name})</div>` : '';
    return `<div class="ctg" style="--ctg-c:${s.tier ? s.tier.color : '#3c4a60'}">
      <div class="ctg-h"><span class="ctg-ic">⬡</span><span class="ctg-t">CONTIGUITY BONUS</span>${head}</div>
      <div class="ctg-lead">${lead}</div>
      <div class="ctg-rungs">${rungs}</div>
      ${next}
      <div class="ctg-foot">Counts systems you fully own that <b>share an edge</b>. Each block is scored on its own size, and the bonus applies per tile — so it multiplies the whole block, not one system.</div>
      <div class="ctg-foot seal">🛡 A block defends itself too: a system with <b>no exposed border</b> cannot be sieged at all. Enemies have to take the outer ring first — except on the galaxy's outer rim, where a border faces the edge of the map and can never be closed.</div>
    </div>`;
  }
  // ONLY THE EDGES THAT FACE OUT. Outlining every tile in a block draws its
  // internal seams too, which reads as "N outlined tiles"; stroking only the
  // sides whose neighbour is outside the block draws ONE territory with a hard
  // border, which is the thing the bonus is actually about.
  //
  // Edge i of gxHexPath() runs from vertex (30+60i)° to (90+60i)°, so its midpoint
  // sits at (60+60i)° — and GM.neighbors() returns that direction at index 5-i.
  function gxBlockBorder(ctx, cx, cy, q, r, sameBlock, inset) {
    const rad = GX_HEX - 1.5 - (inset || 0), nb = GM.neighbors(q, r);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const n = nb[(5 - i + 6) % 6];
      if (sameBlock(GM.tileId(n.q, n.r))) continue;
      const a0 = Math.PI / 3 * i + Math.PI / 6, a1 = Math.PI / 3 * (i + 1) + Math.PI / 6;
      ctx.moveTo(cx + Math.cos(a0) * rad, cy + Math.sin(a0) * rad);
      ctx.lineTo(cx + Math.cos(a1) * rad, cy + Math.sin(a1) * rad);
    }
  }
  // ONE STABLE COLOUR PER FACTION, AND MINE IS ALWAYS THE SAME ONE.
  //
  // Every rival first painted the same orange, which merged two neighbouring
  // empires' walls into one apparent territory — the map said "twenty tiles to
  // break through" where the truth was two separate blocs with a seam between
  // them. Rivals now take a hue hashed off their faction id (stable across
  // sessions because the id is), and MY wall is always the same ice white, so
  // "is that mine" never depends on remembering a colour.
  //
  // The hue avoids two bands on purpose: the blues that already mean YOUR tiles
  // and deep space, and the greens that mean an ALLY. That leaves purple → red
  // → orange → yellow → lime, ~220° across roughly a dozen live rival names.
  const GX_MY_WALL = '215,238,255';
  const _gxFacCol = {};
  function factionWallRGB(fac) {
    if (!fac || fac === 'me') return GX_MY_WALL;
    const hit = _gxFacCol[fac]; if (hit) return hit;
    let h = 2166136261 >>> 0;
    for (let i = 0; i < fac.length; i++) { h ^= fac.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    const hue = (240 + (h % 220)) % 360;
    // HSL → RGB at a fixed saturation/lightness so no faction reads dimmer than
    // another: the colour carries identity only, never importance.
    const s = 0.78, l = 0.66;
    const k = (n) => (n + hue / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(Math.min(k(n) - 3, 9 - k(n)), 1))));
    return (_gxFacCol[fac] = f(0) + ',' + f(8) + ',' + f(4));
  }
  // PERF — THE KAEVITH VOID VEIL. Painting the invasion originally built two
  // radial gradients per invaded tile per world bake. At ~20% of the map that is
  // 80–160 gradient objects and fills every rebake (~2/s idle, every zoom step),
  // for an effect that is identical on every tile. Both layers are now baked ONCE
  // into offscreen sprites and blitted — zero per-tile allocation.
  //
  // The two layers MUST stay separate, because they composite differently:
  //   · core  — clipped to the hex, drawn source-over: the dark void hole.
  //   · bloom — UNCLIPPED at radius GX_HEX×1.5 (39px vs the hex's 24.5px
  //             circumradius) and drawn with 'lighter' AGAINST THE MAP, so it
  //             bleeds ~14.5px past every edge and pools additively across
  //             adjacent invaded tiles. That bleed is what makes the invasion
  //             read as one continuous void field instead of discrete cells;
  //             pre-compositing it into a single sprite loses it entirely.
  // Four phase frames preserve the per-tile shimmer the old Date.now() term gave.
  const XEN_PHASES = 4;
  let _xenVeil = null;
  function xenVeil(phase) {
    if (!_xenVeil) {
      _xenVeil = [];
      const CR = Math.ceil(GX_HEX), BR = Math.ceil(GX_HEX * 1.5);
      for (let i = 0; i < XEN_PHASES; i++) {
        const vp = 0.55 + 0.45 * Math.sin((i / XEN_PHASES) * Math.PI * 2);
        // ---- core: dark void hole bleeding purple ----
        const cc = document.createElement('canvas');
        cc.width = cc.height = CR * 2;
        const cx2 = cc.getContext('2d');
        const vg = cx2.createRadialGradient(CR, CR, 0, CR, CR, GX_HEX);
        vg.addColorStop(0, 'rgba(6,0,14,0.92)');
        vg.addColorStop(0.52, 'rgba(58,10,110,0.78)');
        vg.addColorStop(1, 'rgba(194,107,255,0.30)');
        cx2.fillStyle = vg;
        cx2.beginPath(); cx2.arc(CR, CR, GX_HEX, 0, 7); cx2.fill();
        // ---- bloom: wide falloff, blitted additively against the live map ----
        const bc = document.createElement('canvas');
        bc.width = bc.height = BR * 2;
        const bx = bc.getContext('2d');
        const vr = bx.createRadialGradient(BR, BR, GX_HEX * 0.25, BR, BR, BR);
        vr.addColorStop(0, 'rgba(160,70,255,' + (0.16 + 0.14 * vp).toFixed(3) + ')');
        vr.addColorStop(1, 'rgba(160,70,255,0)');
        bx.fillStyle = vr;
        bx.beginPath(); bx.arc(BR, BR, BR, 0, 7); bx.fill();
        _xenVeil.push({ core: cc, cr: CR, bloom: bc, br: BR });
      }
    }
    return _xenVeil[phase % XEN_PHASES];
  }
  function renderGalaxy() {
    const res = G.getResources(), rates = G.resourceRates();
    el['galaxy-sub'].textContent = 'one galaxy · ' + GM.tileCount() + ' tiles · conquer & hold';
    let html = '<div class="res-hud">';
    GM.RES_KEYS.forEach((k) => {
      const d = GM.RES[k];
      html += `<div class="res-pill" style="--rc:${d.color}"><span class="res-g">${d.glyph}</span><span class="res-txt"><b>${G.formatNum(res[k] || 0)}</b><span class="res-rate">+${G.formatNum(rates[k] || 0)}/h</span></span></div>`;
    });
    html += '</div>';
    // —— THE KAEVITH INCURSION —— live event banner, always tappable for the full briefing
    {
      const bonus = G.xenXpBonus ? G.xenXpBonus() : 0;
      html += `<button class="xen-banner" id="xen-open">
        <span class="xb-glyph">◈</span>
        <span class="xb-txt"><b>THE KAEVITH INCURSION</b><i>~20% of the galaxy is alien-held · clear a void zone for a chance to earn their ship technology</i></span>
        <span class="xb-cta">${bonus ? '+' + bonus + '% XP' : 'BRIEFING'}</span>
      </button>`;
    }
    const feed = G.getGalaxyFeed ? G.getGalaxyFeed() : [];
    if (feed.length) {
      html += '<div class="gx-feed"><div class="gxf-h">⚔ Contested Space · live</div>';
      feed.slice(0, 3).forEach((f) => { html += `<div class="gxf-row ${f.mine ? 'mine' : ''}">${f.msg}</div>`; });
      html += '</div>';
    }
    // BOTH OPTIONS, ALWAYS VISIBLE — AND LOUD.
    //
    // A single destination-naming button was clearer per-word but hid the fact that
    // TWO views exist at all, which is the thing players need to see. So it is a
    // segment again: both options on screen, the active one filled, the other one
    // plainly tappable rather than greyed like a disabled sibling.
    //
    // Discoverability comes from the treatment instead of the wording: an accent
    // frame, a breathing glow, a sheen that sweeps across it and a pulse on the
    // option you are NOT on — all of which stop for good the first time the control
    // is used. The caption says what the other view gives you, so the payoff is
    // stated rather than guessed at.
    {
      const fresh = !gxViewSeen();
      html += `<div class="gx-viewsw${fresh ? ' fresh' : ''}" role="group" aria-label="Galaxy view">`
        + `<div class="gxv-row">`
          + `<button class="gxv-b${_gxView === 'map' ? ' on' : ''}" data-gxv="map">\u2b21 Map</button>`
          + `<button class="gxv-b${_gxView === 'list' ? ' on' : ''}" data-gxv="list">\u2630 List</button>`
        + `</div>`
        + `<span class="gxv-s">${_gxView === 'map'
            ? 'Tap <b>List</b> to search, sort and filter every system'
            : 'Tap <b>Map</b> to go back to the galaxy'}</span>`
        + (fresh ? '<i class="gxv-new">NEW</i>' : '')
        + `</div>`;
    }
    if (_gxView === 'list') {
      html += gxListHTML();
      el['galaxy-body'].innerHTML = html;
      const xb0 = document.getElementById('xen-open');
      if (xb0) xb0.addEventListener('click', () => openXenBriefing());
      el['galaxy-body'].querySelectorAll('[data-gxv]').forEach((b) => b.addEventListener('click', () => setGxView(b.dataset.gxv)));
      wireGxList();
      clearInterval(_galaxyTimer);
      maybeAnnounceXen();
      return;
    }
    html += `<div class="gx-map-wrap">
      <canvas id="gx-canvas"></canvas>
      <div class="gx-ctl">
        <button class="gxc" data-gx="in">+</button>
        <button class="gxc" data-gx="out">−</button>
        <button class="gxc" data-gx="home">⌂</button>
      </div>
      <div class="gx-hud" id="gx-ringlab"></div>
    </div>`;
    html += `<div class="gx-legend"><button class="gxl gxl-cit gxl-btn ${(G.atTileCap && G.atTileCap()) ? 'gxl-full' : ''}" id="gx-mysys" style="font-weight:800"><span class="gxl-glow"></span>◈ <b>${(G.tileCount ? G.tileCount() : 0)}</b>/${(G.tileCap ? G.tileCap() : 50)} Systems${(G.atTileCap && G.atTileCap()) ? '<em class="gxl-warn">FULL</em>' : ''}<em class="gxl-cta">MANAGE <i>›</i></em></button>${clusterPillHTML()}<span class="gxl gxl-cit" style="color:#ffd24d;font-weight:800">⛓ ${(G.citadelCount ? G.citadelCount() : 0)} Citadels</span><span class="gxl"><i style="background:#2d78eb"></i>Yours</span><span class="gxl"><i style="background:#d23b4e"></i>Rival</span><span class="gxl"><i style="background:#6c7e9c"></i>Available</span><span class="gxl"><i style="background:#4a5160"></i>Locked</span><span class="gxl"><i style="background:#7a2ac4"></i>◈ Kaevith</span><span class="gxl"><i style="background:#ffbe6e"></i>⛴ Citadel</span><span class="gxl">☠ Boss</span><span class="gxl">◷ Cooldown</span></div>`;
    el['galaxy-body'].innerHTML = html;
    el['galaxy-body'].querySelectorAll('[data-gxv]').forEach((b) => b.addEventListener('click', () => setGxView(b.dataset.gxv)));
    const xb = document.getElementById('xen-open');
    if (xb) xb.addEventListener('click', () => openXenBriefing());
    const msb = document.getElementById('gx-mysys');
    if (msb) msb.addEventListener('click', () => openMySystems());
    bindGalaxyMap();
    drawGalaxyMap();
    clearInterval(_galaxyTimer);
    _galaxyTimer = setInterval(() => { if (screen === 'galaxy') drawGalaxyMap(); else clearInterval(_galaxyTimer); }, 1000);
    maybeAnnounceXen();
  }
  // ==========================================================================
  // MY GALAXY — LIST VIEW
  // --------------------------------------------------------------------------
  // The map is the right way to read the SHAPE of the galaxy — who is next to
  // whom, where a front line runs — and the wrong way to answer "which citadel
  // should I hit" or "where is my best plasma". There are 1,950 tiles across 25
  // rings; finding the good ones by dragging a hex canvas is not a search, it is
  // a scavenger hunt.
  //
  // So the same tiles are available as a sortable, filterable, PAGINATED list.
  // It deliberately does NOT reimplement any tile action: a row opens the exact
  // same openTileAction() sheet the map opens, so there is one place that owns
  // what you can do with a tile and the two views can never disagree.
  //
  // PAGINATION IS NOT OPTIONAL HERE. 1,950 rows is a browser-killer on a phone
  // and unreadable anywhere; the list renders one page of GX_PAGE rows and the
  // filter/sort pass runs over cached tiles (GALAXYMAP.tileAt memoises), so
  // paging is cheap.
  // ==========================================================================
  const GX_PAGE = 24;
  let _gxView = 'map', _gxFilter = 'all', _gxSort = 'value', _gxPage = 0, _gxQ = '';
  try { const v = localStorage.getItem('lf_gx_view'); if (v === 'list' || v === 'map') _gxView = v; } catch (e) {}
  const GX_FILTERS = [
    { id: 'all',    label: 'All' },
    { id: 'mine',   label: '◈ Mine' },
    { id: 'free',   label: 'Available' },
    { id: 'cit',    label: '⛓ Citadels' },
    { id: 'rival',  label: 'Rival' },
    { id: 'alien',  label: '◈ Kaevith' },
    { id: 'boss',   label: '☠ Boss' },
  ];
  const GX_SORTS = [
    { id: 'value',  label: 'Value — highest first' },
    { id: 'near',   label: 'Closest ring first' },
    { id: 'deep',   label: 'Deepest ring first' },
    { id: 'level',  label: 'Lowest level first' },
    { id: 'res',    label: 'Resource type' },
    { id: 'name',   label: 'Name (A–Z)' },
  ];
  // One tile, classified once. Every filter, sort and row reads this shape so a
  // rule cannot drift between the three.
  function gxRow(id) {
    const t = GM.tileAt(id); if (!t || t.home) return null;
    const lvl = G.state.level | 0;
    const owned = !!G.isOwned(id);
    const rivalName = !owned ? G.rivalOf(id) : null;
    const rival = !!rivalName;
    const ally  = !owned && !!(G.isAllyTile && G.isAllyTile(id));
    const locked = !owned && t.level > lvl + 10;
    // SECONDS, not milliseconds — tileCooldownLeft() returns seconds. Getting
    // this wrong printed a 24-hour shield as "86s".
    const cd = G.tileCooldownLeft ? G.tileCooldownLeft(id) : 0;
    const citLv = (G.state.rivalCitadels && G.state.rivalCitadels[id]) || 0;
    // THREE DIFFERENT THINGS, CLASSIFIED APART.
    //
    // There used to be two flags with a gap between them: `myCit` for a fortress
    // the pilot BUILT, `attackCit` for one they can go and hit — and the second was
    // gated on `!owned`. So a NATURAL citadel sitting on a tile the pilot already
    // owns matched neither, and dropped straight out of the ⛓ Citadels filter. It
    // is the same blind spot the My Systems header had: the code knew "mine" and
    // "theirs" but had no word for "the one that came with the ground".
    //
    // `t.citadel` is the natural fortress and is already correct for razed tiles —
    // razeCitadelTile() clears the flag and the razings are re-applied on load.
    const myLv = (owned && G.citadelLevel) ? (G.citadelLevel(id) | 0) : 0;
    const myCit = myLv > 0;
    const natCit = !!t.citadel;
    const anyCit = myCit || natCit || citLv > 0;
    const attackCit = !owned && (natCit || citLv > 0);
    // WHAT IT PAYS, FROM THE ONE FUNCTION THAT DECIDES WHAT IT PAYS.
    // `t.rate | 0` was wrong twice over: it is the tile's RAW generation figure
    // before the ×25 galaxy yield, deep space and any citadel rank — and `| 0`
    // wraps signed 32-bit, which a real fortress rate clears easily.
    const q = G.tileRateOf ? G.tileRateOf(id) : null;
    // ONE RESOLVER FOR CITADEL RANK. It already knows all three cases (yours, a
    // rival's, a natural fortress at full strength) — the row must not re-derive.
    const cr = G.citadelRankOf ? G.citadelRankOf(id) : null;
    return { t, id, owned, rival, rivalName, ally, locked, cd, citLv, myLv, myCit, natCit, anyCit, attackCit, q, cr,
             // NO EXPOSED BORDER, NO SIEGE — the list says SEALED rather than
             // offering a target the sheet will refuse. One statement of it, in
             // game-v93; the row never re-derives adjacency.
             shield: G.tileShield ? G.tileShield(id) : null,
             rate: q ? Math.floor(q.perHour) : Math.floor(Number(t.rate) || 0),
             res: t.resource || '', ring: t.ring | 0, level: t.level | 0 };
  }
  function gxCandidates() {
    const out = [];
    for (let ring = 1; ring <= GM.RINGS; ring++) {
      const cs = GM.ringCoords(ring);
      for (let i = 0; i < cs.length; i++) {
        const r = gxRow(GM.tileId(cs[i].q, cs[i].r));
        if (r) out.push(r);
      }
    }
    // THE ARTERY sits past the rim, off the ring walk — without this the list
    // would never show the eleven richest tiles in the game.
    if (GM.ARTERY) GM.ARTERY.path.forEach((a) => {
      const r = gxRow(GM.tileId(a.q, a.r));
      if (r) out.push(r);
    });
    return out;
  }
  function gxFilterFn(r) {
    switch (_gxFilter) {
      case 'mine':  return r.owned;
      // AVAILABLE means genuinely takeable right now: nobody holds it, it is not
      // above your level band, and it is not inside a contest lockout. A list
      // that shows a tile you cannot act on is the map's problem repeated.
      case 'free':  return !r.owned && !r.rival && !r.ally && !r.locked && r.cd <= 0;
      case 'cit':   return r.anyCit;
      case 'rival': return r.rival;
      case 'alien': return !!r.t.alien;
      case 'boss':  return !!r.t.boss;
      default:      return true;
    }
  }
  function gxSortFn(a, b) {
    switch (_gxSort) {
      case 'near':  return (a.ring - b.ring) || (b.rate - a.rate);
      case 'deep':  return (b.ring - a.ring) || (b.rate - a.rate);
      case 'level': return (a.level - b.level) || (b.rate - a.rate);
      case 'res':   return a.res.localeCompare(b.res) || (b.rate - a.rate);
      case 'name':  return String(a.t.name).localeCompare(String(b.t.name));
      default:      return (b.rate - a.rate) || (a.ring - b.ring);
    }
  }
  function gxListHTML() {
    const all = gxCandidates().filter(gxFilterFn)
      .filter((r) => !_gxQ || String(r.t.name).toLowerCase().indexOf(_gxQ.toLowerCase()) !== -1)
      .sort(gxSortFn);
    const pages = Math.max(1, Math.ceil(all.length / GX_PAGE));
    if (_gxPage >= pages) _gxPage = pages - 1;
    if (_gxPage < 0) _gxPage = 0;
    const page = all.slice(_gxPage * GX_PAGE, _gxPage * GX_PAGE + GX_PAGE);

    const chips = GX_FILTERS.map((f) =>
      `<button class="gxlf${f.id === _gxFilter ? ' on' : ''}" data-gxf="${f.id}">${f.label}</button>`).join('');
    const sorts = GX_SORTS.map((s) =>
      `<option value="${s.id}"${s.id === _gxSort ? ' selected' : ''}>${s.label}</option>`).join('');

    let rows = page.map((r) => {
      const t = r.t;
      const rd = GM.RES[r.res] || { glyph: '', color: '#8ba0b5', name: '' };
      // ICONOGRAPHY. ⛓ is a citadel a PLAYER built — gold when it is yours, amber
      // when it is someone else's and therefore a target — and ⛴ is the natural
      // fortress that came with the tile. These are the same two glyphs the My
      // Systems rows use, so there is one vocabulary across both screens rather
      // than one ⛓ standing for three unrelated things, which is what it did.
      //
      // No `title` on any mark: a mark that needs a tooltip to be understood does
      // not communicate on a phone. The legend under the count carries it instead.
      const marks = (r.myCit ? '<i class="gxr-m cit mine">⛓</i>' : '')
        + (r.citLv ? '<i class="gxr-m cit rival">⛓</i>' : '')
        + (r.natCit ? '<i class="gxr-m nat">⛴</i>' : '')
        + (t.boss ? '<i class="gxr-m boss">☠</i>' : '')
        + (t.alien ? '<i class="gxr-m xen">◈</i>' : '')
        + (t.deep ? '<i class="gxr-m deep">◆</i>' : '');
      // WHO HOLDS IT, WHAT IS ON IT, AND WHAT RANK IT IS — AS PILLS, NOT A RUN OF
      // DOT-SEPARATED PROSE. The old sub-line said "Lv 390 · Citadel · Natural
      // Fortress · Held By Alcyone", which buried the two facts that decide
      // whether to attack, and used the word "Lv" for the SYSTEM's combat level
      // on a screen where the reader is thinking about citadel RANK. Each fact is
      // now its own labelled chip and the two levels are named apart.
      const pills = [];
      pills.push('<span class="gxr-p sys"><b>SYS</b>' + r.level + '</span>');
      if (r.cr && r.cr.lv) {
        const kind = r.cr.kind === 'natural' ? { c: 'nat', g: '⛴', l: 'FORTRESS' }
                   : r.cr.kind === 'mine'    ? { c: 'mine', g: '⛓', l: 'CITADEL' }
                   :                           { c: 'rival', g: '⛓', l: 'RIVAL FORT' };
        pills.push('<span class="gxr-p ' + kind.c + '"><b>' + kind.g + ' ' + kind.l + '</b>R' + r.cr.lv + '/' + (r.cr.max || 5) + '</span>');
      }
      if (t.deep) pills.push('<span class="gxr-p deep"><b>☢ DEEP</b>×' + GM.DEEP_MULT.resource + '</span>');
      // OWNER. "Yours" is already the state tag on the right, so printing it here
      // twice is noise — every other case names somebody or says nobody.
      if (r.rivalName) pills.push('<span class="gxr-p who"><b>HELD BY</b>' + esc(r.rivalName) + '</span>');
      else if (r.ally) pills.push('<span class="gxr-p ally"><b>ALLIED</b></span>');
      else if (!r.owned) pills.push('<span class="gxr-p open"><b>UNCLAIMED</b></span>');
      const state = r.owned ? '<em class="gxr-s mine">YOURS</em>'
        : r.ally ? '<em class="gxr-s ally">ALLIED</em>'
        : (r.shield && r.shield.shielded) ? '<em class="gxr-s seal">🛡 SEALED</em>'
        : r.cd > 0 ? '<em class="gxr-s cd" title="Contest shield — cannot be attacked yet">▷ SHIELDED ' + fmtLeft(r.cd) + '</em>'
        : r.rival ? '<em class="gxr-s rival">RIVAL</em>'
        : r.locked ? '<em class="gxr-s lock">Lv ' + r.level + '</em>'
        : '<em class="gxr-s open">OPEN</em>';
      return `<button class="gxr${r.owned ? ' mine' : ''}${r.attackCit ? ' target' : ''}" data-gxrow="${r.id}">`
        + `<span class="gxr-ring">R${r.ring}</span>`
        + `<span class="gxr-main"><span class="gxr-n">${esc(t.name)}${marks}</span>`
        + `<span class="gxr-pills">${pills.join('')}</span></span>`
        + `<span class="gxr-rate" style="color:${rd.color}">${rd.glyph} ${G.formatNum(r.rate)}<i>/h</i></span>`
        + state + '</button>';
    }).join('');
    if (!rows) {
      // AN EMPTY FILTER MUST SAY WHY. "Available" legitimately returns nothing on
      // a busy map, and a bare "no matches" reads as a broken screen — so count
      // what is actually blocking and name it.
      let why;
      if (_gxQ) why = 'No system matches “' + esc(_gxQ) + '”.';
      else if (_gxFilter === 'free') {
        const all2 = gxCandidates();
        let held = 0, lock = 0, shield = 0;
        all2.forEach((r) => { if (r.owned || r.rival || r.ally) held++; else if (r.locked) lock++; else if (r.cd > 0) shield++; });
        why = '<b>Nothing is open to you right now.</b><br>'
          + G.formatNum(held) + ' already held · ' + G.formatNum(lock) + ' above your level band'
          + (shield ? ' · ' + G.formatNum(shield) + ' under a contest shield' : '')
          + '.<br><span class="gxl-hint">Level up to widen the band, or take one from a rival.</span>';
      }
      else if (_gxFilter === 'cit') why = 'No citadels in range yet. Natural fortresses are rare — about one tile in thirty, ring 2 and deeper — and you can raise your own on any system you already hold.';
      else if (_gxFilter === 'mine') why = 'You hold nothing yet. Claim a tile from the map or the Available filter.';
      else why = 'Nothing matches this filter.';
      rows = '<div class="gxl-empty">' + why + '</div>';
    }
    const from = all.length ? _gxPage * GX_PAGE + 1 : 0;
    const to = Math.min(all.length, (_gxPage + 1) * GX_PAGE);
    return '<div class="gxlist">'
      + '<div class="gxl-bar">'
        + `<input id="gxl-q" class="gxl-q" type="search" autocomplete="off" placeholder="Search systems…" value="${esc(_gxQ)}">`
        + `<select id="gxl-sort" class="gxl-sort">${sorts}</select>`
      + '</div>'
      + `<div class="gxl-chips">${chips}</div>`
      + `<div class="gxl-count">${all.length ? from + '–' + to + ' of ' + G.formatNum(all.length) : '0'} systems</div>`
      // THE LEGEND, ONLY WHERE THE MARKS ARE THE POINT. Three citadel glyphs need
      // saying once in words — and this is the filter a pilot opens to compare them,
      // so it is the one place the key earns its space. It replaces the `title`
      // tooltip that used to be the only explanation and never reached a phone.
      + (_gxFilter === 'cit' ? '<div class="gxl-key">'
          + '<span><i class="gxr-m cit mine">\u26d3</i> yours</span>'
          + '<span><i class="gxr-m cit rival">\u26d3</i> another pilot\u2019s</span>'
          + '<span><i class="gxr-m nat">\u26f4</i> natural fortress</span>'
        + '</div>' : '')
      + `<div class="gxl-rows" id="gxl-rows">${rows}</div>`
      + (pages > 1 ? '<div class="gxl-page">'
          + `<button class="gxl-pg" data-gxp="prev"${_gxPage <= 0 ? ' disabled' : ''}>‹ Prev</button>`
          + `<span class="gxl-pgn">Page ${_gxPage + 1} / ${pages}</span>`
          + `<button class="gxl-pg" data-gxp="next"${_gxPage >= pages - 1 ? ' disabled' : ''}>Next ›</button>`
        + '</div>' : '')
      + '</div>';
  }
  // SECONDS in, human out. tileCooldownLeft() is seconds — a shield runs 24h, so
  // days and hours are the units that matter, not a raw count.
  function fmtLeft(sec) {
    const s = Math.max(0, Math.round(sec || 0));
    if (s >= 86400) return Math.floor(s / 86400) + 'd ' + Math.floor((s % 86400) / 3600) + 'h';
    if (s >= 3600) return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
    if (s >= 60) return Math.floor(s / 60) + 'm';
    return s + 's';
  }
  function repaintGxList() {
    const host = document.getElementById('gxl-rows'); if (!host) return renderGalaxy();
    const wrap = host.closest('.gxlist'); if (!wrap) return renderGalaxy();
    wrap.outerHTML = gxListHTML();
    wireGxList();
  }
  function wireGxList() {
    const body = el['galaxy-body']; if (!body) return;
    body.querySelectorAll('[data-gxf]').forEach((b) => b.addEventListener('click', () => {
      _gxFilter = b.dataset.gxf; _gxPage = 0; repaintGxList();
    }));
    body.querySelectorAll('[data-gxp]').forEach((b) => b.addEventListener('click', () => {
      _gxPage += b.dataset.gxp === 'next' ? 1 : -1; repaintGxList();
      const r = document.getElementById('gxl-rows'); if (r) r.scrollTop = 0;
    }));
    body.querySelectorAll('[data-gxrow]').forEach((b) => b.addEventListener('click', () => openTileAction(b.dataset.gxrow)));
    const s = document.getElementById('gxl-sort');
    if (s) s.addEventListener('change', () => { _gxSort = s.value; _gxPage = 0; repaintGxList(); });
    // Search repaints ONLY the list, so the input keeps focus and caret between
    // keystrokes — a full renderGalaxy() would rebuild the field and lose both.
    const q = document.getElementById('gxl-q');
    if (q) q.addEventListener('input', () => {
      _gxQ = q.value || ''; _gxPage = 0;
      const host = document.getElementById('gxl-rows');
      const wrap = host && host.closest('.gxlist');
      if (!wrap) return;
      const at = q.selectionStart;
      wrap.outerHTML = gxListHTML();
      wireGxList();
      const q2 = document.getElementById('gxl-q');
      if (q2) { q2.focus(); try { q2.setSelectionRange(at, at); } catch (e) {} }
    });
  }
  // THE NUDGE IS A DEVICE FACT, like the view choice itself. Shown until the pilot
  // uses the control once, then never again — re-offering something someone has
  // already found is nagging.
  function gxViewSeen() { try { return localStorage.getItem('lf_gx_viewseen') === '1'; } catch (e) { return true; } }
  function setGxView(v) {
    _gxView = v;
    try { localStorage.setItem('lf_gx_view', v); } catch (e) {}
    try { localStorage.setItem('lf_gx_viewseen', '1'); } catch (e) {}
    renderGalaxy();
  }

  // ==========================================================================
  // MY SYSTEMS — every hold you own: revenue, citadel rank, one-tap abandon.
  // Opened from the ◈ N/M Systems pill on the My Galaxy legend.
  // ==========================================================================
  // Colours mirror GALAXYMAP.RES exactly — iron is amber (#d0a060), not the
  // silver-grey it was drawn with here, which read as a different resource.
  const MS_RES = { gold: ['$', '#e6b566'], fuel: ['⬢', '#5bc0ff'], iron: ['◆', '#d0a060'], plasma: ['✦', '#c07bff'] };
  // SORT + FILTER ARE DEVICE PREFERENCES, not save state — the same reason the
  // Pilot Tree's map/list toggle lives in localStorage. A phone and a desktop want
  // different defaults and neither should ride the cloud save onto the other.
  let _msSort = 'rev', _msCitOnly = false;
  try { _msSort = localStorage.getItem('lf_ms_sort') || 'rev'; } catch (e) {}
  try { _msCitOnly = localStorage.getItem('lf_ms_citonly') === '1'; } catch (e) {}
  const MS_SORTS = { rev: 'Revenue', ring: 'Ring', rank: 'Citadel rank', name: 'Name' };
  function msArrange(list) {
    // `rate` is the figure ownedSystemList() already computes for this purpose and
    // is comparable across resources; the raw `pays` map is not (gold sits on a
    // ×1000 scale, so summing it would rank every Void tile first by accident).
    let arr = list.slice();
    if (_msCitOnly) arr = arr.filter((s) => s.citadelLv > 0 || s.naturalCitadel);
    if (_msSort === 'ring') arr.sort((a, b) => (a.ring - b.ring) || (b.rate - a.rate));
    else if (_msSort === 'rank') arr.sort((a, b) => (b.citadelLv - a.citadelLv) || (b.naturalCitadel - a.naturalCitadel) || (b.rate - a.rate));
    else if (_msSort === 'name') arr.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    else arr.sort((a, b) => (b.voidTile - a.voidTile) || (b.rate - a.rate));
    return arr;
  }
  // A citadel price is three resources. Rendered as glyph chips that go red when
  // the wallet is short, so "can I afford this" is answered on the button itself
  // rather than behind a tap that fails.
  // Read ONCE per render rather than twice per row — msCostChips and msCanAfford
  // both need the wallet and there can be 85 rows.
  let _msRes = null;
  function msCostChips(cost) {
    if (!cost) return '';
    const res = _msRes || (G.getResources && G.getResources()) || {};
    return ['fuel', 'iron', 'plasma'].filter((k) => (cost[k] | 0) > 0).map((k) => {
      const short = (Number(res[k]) || 0) < cost[k];
      return `<i class="ms-cc${short ? ' short' : ''}" style="--pc:${MS_RES[k][1]}">${MS_RES[k][0]} ${G.formatNum(cost[k])}</i>`;
    }).join('');
  }
  function msCanAfford(cost) {
    if (!cost) return false;
    const res = _msRes || (G.getResources && G.getResources()) || {};
    return ['fuel', 'iron', 'plasma'].every((k) => (Number(res[k]) || 0) >= (cost[k] | 0));
  }
  function mySystemsHtml() {
    _msRes = (G.getResources && G.getResources()) || {};
    const list = (G.ownedSystemList ? G.ownedSystemList() : []);
    const cap = G.tileCap ? G.tileCap() : 50;
    // TWO DIFFERENT THINGS GET TWO DIFFERENT NUMBERS. This was ONE figure captioned
    // "citadels" that counted systems holding a citadel of EITHER kind — while the
    // rows below have always labelled them apart: ⛓ Rank N for a fortress the pilot
    // BUILT and paid to rank up, ⛴ Citadel for the NPC one that came with the tile.
    // So a player adding up the rows could never reproduce the header, and neither
    // figure was wrong on its own terms. Built and natural are now stated
    // separately, which is also the only version that answers "how many have I
    // actually built" — the one a pilot is spending resources against.
    //
    // A system can hold both, and is counted in both, exactly as its row reads.
    // Razed naturals are already excluded upstream: razeCitadelTile() clears the
    // tile's own `citadel` flag and the razings are re-applied on every load.
    const built = list.filter((s) => s.citadelLv > 0).length;
    const natural = list.filter((s) => s.naturalCitadel).length;
    const tot = {};
    list.forEach((s) => { for (const k in s.pays) tot[k] = (tot[k] || 0) + s.pays[k]; });
    const totTxt = Object.keys(MS_RES).filter((k) => tot[k] > 0)
      .map((k) => `<span style="color:${MS_RES[k][1]}">${MS_RES[k][0]} ${G.formatNum(Math.round(tot[k]))}</span>`).join('') || '<span class="ms-none">nothing yet</span>';

    let h = `<div class="ms-top"><div class="ms-top-l"><b>${list.length}</b><span>/ ${cap} systems</span></div>`
      + `<div class="ms-top-l"><b style="color:#ffd24d">${built}</b><span>built</span></div>`
      + `<div class="ms-top-l"><b style="color:#9ad4ff">${natural}</b><span>natural</span></div></div>`
      + `<div class="ms-tot"><span class="ms-tot-h">TOTAL PER HOUR</span><div class="ms-tot-v">${totTxt}</div></div>`;

    if (!list.length) {
      return h + '<div class="ms-empty">You hold nothing yet.<span>Claim a system in <b>My Galaxy</b> and it starts producing immediately — online or off.</span></div>';
    }
    // CONTROL BAR. At 85 holds a flat list is a scroll hunt, so the sheet gets a
    // sort and a citadels-only filter. Both are one tap and both persist.
    h += '<div class="ms-bar">'
      + '<label class="ms-sortw"><span>Sort</span><select id="ms-sort">'
      + Object.keys(MS_SORTS).map((k) => `<option value="${k}"${k === _msSort ? ' selected' : ''}>${MS_SORTS[k]}</option>`).join('')
      + '</select></label>'
      + `<button class="ms-filt${_msCitOnly ? ' on' : ''}" id="ms-citonly">⛓ Citadels only</button>`
      + '</div>';
    const shown = msArrange(list);
    if (!shown.length) {
      return h + '<div class="ms-empty">No system matches that filter.<span>You hold ' + list.length + ', none of them with a citadel.</span></div>';
    }
    h += '<div class="ms-list">' + shown.map((s) => {
      const pay = Object.keys(s.pays).filter((k) => MS_RES[k] && s.pays[k] > 0)
        .map((k) => `<span class="ms-c" style="--pc:${MS_RES[k][1]}">${MS_RES[k][0]} ${G.formatNum(Math.round(s.pays[k]))}</span>`).join('');
      const tags = [];
      if (s.home) tags.push('<em class="ms-tag home">HOME</em>');
      if (s.voidTile) tags.push('<em class="ms-tag void">VOID</em>');
      if (s.xen) tags.push('<em class="ms-tag xen">KAEVITH</em>');
      if (s.deep) tags.push('<em class="ms-tag deep">DEEP</em>');
      if (s.active) tags.push('<em class="ms-tag on">HERE</em>');
      // WHICH OF MY SYSTEMS ARE SAFE, AND WHICH ARE THE WALL. The map shows the
      // shape; this list is where a pilot decides what to reinforce next, so it
      // states the same answer per row. A lone system gets no tag — "6 open" is
      // not advice until it has a neighbour.
      {
        const shd = G.tileShield ? G.tileShield(s.id) : null;
        if (shd && shd.faction && !s.home) {
          if (shd.shielded) tags.push('<em class="ms-tag seal">⛨ SEALED</em>');
          else if (shd.ring.length) tags.push('<em class="ms-tag front">⚔ ' + shd.open + ' OPEN</em>');
        }
      }
      const cit = s.citadelLv > 0
        ? `<span class="ms-cit">⛓ Rank ${s.citadelLv}</span>`
        : s.naturalCitadel ? '<span class="ms-cit nat">⛴ Citadel</span>' : '<span class="ms-cit none">No citadel</span>';
      // ---- ROW ACTIONS -----------------------------------------------------
      // Everything a pilot used to leave this sheet to do. The citadel button is
      // the only one that spends, and it states its own price: the label names the
      // rank it buys and the chips name what it costs, so a one-tap purchase with
      // no confirm is still a purchase the player agreed to. The list re-renders
      // after every buy, so a second tap is always against the NEW price.
      let citBtn = '';
      if (s.voidTile) citBtn = '<span class="ms-act flat">◇ Void spire — fixed</span>';
      else if (s.citadelLv > 0) {
        const c = G.citadelUpgradeCost ? G.citadelUpgradeCost(s.id) : null;
        citBtn = c
          ? `<button class="ms-act buy${msCanAfford(c) ? '' : ' poor'}" data-ms-upg="${s.id}">⛓ Rank ${s.citadelLv + 1}<span class="ms-cost">${msCostChips(c)}</span></button>`
          : '<span class="ms-act flat">⛓ Max rank</span>';
      } else if (G.canBuildCitadel && G.canBuildCitadel(s.id)) {
        const c = G.citadelBuildCost ? G.citadelBuildCost(s.id) : null;
        citBtn = `<button class="ms-act buy${msCanAfford(c) ? '' : ' poor'}" data-ms-build="${s.id}">⛓ Build<span class="ms-cost">${msCostChips(c)}</span></button>`;
      }
      const acts = '<div class="ms-acts">' + citBtn
        + `<button class="ms-act" data-ms-view="${s.id}">◎ View tile</button>`
        + (s.active ? '<span class="ms-act flat">▸ You are here</span>' : `<button class="ms-act" data-ms-dep="${s.id}">▸ Deploy</button>`)
        + '</div>';
      return `<div class="ms-row">
        <div class="ms-n">${s.name}</div>
        ${s.home ? '<span class="ms-x lock">—</span>' : `<button class="ms-x" data-ms-ab="${s.id}" aria-label="Abandon ${s.name}">✕</button>`}
        <div class="ms-s"><span>Ring ${s.ring}</span><span>Lv ${s.level}</span>${cit}${tags.join('')}</div>
        <div class="ms-pay">${pay}<span class="ms-per">/hr</span></div>
        ${acts}
      </div>`;
    }).join('') + '</div>'
      + (shown.length !== list.length ? `<div class="ms-note">Showing ${shown.length} of ${list.length} systems.</div>` : '')
      + '<div class="ms-note">Abandoning releases the system, its citadel and all of its production. It goes neutral immediately and anyone can take it.</div>';
    return h;
  }
  function openMySystems() {
    const FOOT = '<div class="sheet-actions"><button class="btn" data-x>Close</button></div>';
    const sheet = showSheet('<div class="sheet-head">◈ MY SYSTEMS</div><div class="sheet-body ms-sheet" id="ms-body">'
      + mySystemsHtml() + FOOT + '</div>');
    // REPAINT KEEPS YOUR PLACE. Ranking up the 60th of 85 systems would otherwise
    // be impossible to do twice — any re-render threw the list back to the top — so
    // the scroll offset is captured and restored around the swap.
    const repaint = () => {
      const body = document.getElementById('ms-body');
      if (!body) return;
      const top = body.scrollTop;
      body.innerHTML = mySystemsHtml() + FOOT;
      body.scrollTop = top;
      wire();
    };
    const nameOf = (id) => {
      const row = (G.ownedSystemList ? G.ownedSystemList() : []).find((s) => s.id === id);
      return row ? row.name : id;
    };
    // ONE TAP IS ONE PURCHASE. The button is disabled synchronously BEFORE the
    // spend, so a double-tap — or the touch+click pair a phone can fire for a
    // single press — cannot pay twice for the same rank. The model re-checks
    // affordability at the moment of the write (upgradeCitadel and buildCitadel
    // both call canAfford immediately before deducting), so a second tab cannot
    // overdraw the wallet either, and the repaint re-prices every button: the next
    // tap is always against the NEW rank's cost, never the one just paid.
    const spend = (b, fn, okMsg) => {
      if (b.disabled) return;
      b.disabled = true;
      const r = fn() || {};
      if (r.ok) { toast(okMsg(r), '#ffd24d'); if (screen === 'galaxy') renderGalaxy(); }
      else toast(r.reason === 'resources' ? 'Not enough Galaxy Resources'
        : r.reason === 'max' ? 'Already at max rank' : 'Could not build there', '#e23b4e');
      repaint();
    };
    function wire() {
      const body = document.getElementById('ms-body'); if (!body) return;
      const x = body.querySelector('[data-x]'); if (x) x.addEventListener('click', closeSheet);
      const sel = document.getElementById('ms-sort');
      if (sel) sel.addEventListener('change', () => {
        _msSort = sel.value;
        try { localStorage.setItem('lf_ms_sort', _msSort); } catch (e) {}
        repaint();
      });
      const filt = document.getElementById('ms-citonly');
      if (filt) filt.addEventListener('click', () => {
        _msCitOnly = !_msCitOnly;
        try { localStorage.setItem('lf_ms_citonly', _msCitOnly ? '1' : '0'); } catch (e) {}
        repaint();
      });
      body.querySelectorAll('[data-ms-upg]').forEach((b) => b.addEventListener('click', () => {
        const id = b.dataset.msUpg;
        spend(b, () => G.upgradeCitadel(id), (r) => '⬆ ' + nameOf(id) + ' — Citadel Rank ' + r.lv);
      }));
      body.querySelectorAll('[data-ms-build]').forEach((b) => b.addEventListener('click', () => {
        const id = b.dataset.msBuild;
        spend(b, () => G.buildCitadel(id), () => '⛓ Citadel raised on ' + nameOf(id));
      }));
      // VIEW TILE — reuses the same glide the mail war reports use, with the tile
      // panel suppressed: the ask was to land on the map looking at the system, and
      // the ping is what makes it findable among 1,900 hexes.
      body.querySelectorAll('[data-ms-view]').forEach((b) => b.addEventListener('click', () => {
        const id = b.dataset.msView;
        closeSheet();
        focusGalaxyTile(id, { open: false });
      }));
      body.querySelectorAll('[data-ms-dep]').forEach((b) => b.addEventListener('click', () => {
        if (b.disabled) return;
        b.disabled = true;
        const id = b.dataset.msDep;
        const r = (G.warp ? G.warp(id) : { ok: false }) || {};
        if (r.ok) { closeSheet(); toast('▸ Deploying to ' + nameOf(id), '#5b9cff'); showScreen('battle'); return; }
        toast(r.reason === 'resources' ? 'Not enough Galaxy Resources to warp there'
          : r.reason === 'locked' ? 'Too high level — max +10 above you'
          : r.reason === 'cooldown' ? 'That system is on cooldown'
          : r.reason === 'abandoned' ? '✕ You abandoned this system — re-claim in ' + abandHms(r.secs || 0)
          : r.reason === 'artery-chain' ? '◈ Take ' + nameOf((r.doors || [])[0]) + ' first — the Artery is taken one system at a time'
          : 'Could not deploy there', '#e23b4e');
        b.disabled = false;
      }));
      body.querySelectorAll('[data-ms-ab]').forEach((b) => b.addEventListener('click', () => {
        const id = b.getAttribute('data-ms-ab');
        confirmAbandon(id, nameOf(id), true);
      }));
    }
    wire();
  }
  // Short duration label for the abandon lockout — "7h 12m", "41m".
  function abandHms(s) {
    s = Math.max(0, s | 0);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? h + 'h ' + m + 'm' : (m || 1) + 'm';
  }
  // Abandon confirmation — destructive, so it always asks first.
  function confirmAbandon(id, name, after) {
    const c = showSheet(`<div class="sheet-head" style="color:var(--bad)">✕ ABANDON SYSTEM</div><div class="sheet-body">
      <p>Release <b>${name || id}</b>?</p>
      <p style="font-size:12px">Its citadel and hourly production are lost, and the system goes <b>neutral immediately</b>.</p>
      <p style="font-size:12px;color:var(--bad)"><b>You cannot re-claim it for 24 hours.</b> Everyone else can move in straight away.</p>
      <div class="sheet-actions"><button class="btn" data-no>Keep it</button><button class="btn danger" data-yes>Abandon</button></div></div>`);
    c.querySelector('[data-no]').addEventListener('click', () => { closeSheet(); if (after) setTimeout(() => openMySystems(), 60); });
    c.querySelector('[data-yes]').addEventListener('click', () => {
      const r = G.abandonTile ? G.abandonTile(id) : { ok: false };
      closeSheet();
      if (r && r.ok) {
        toast('✕ ' + (name || id) + ' released — locked to you for ' + (r.lockH || 24) + 'h', '#8fa3bd');
        refreshAll();
        if (screen === 'galaxy') renderGalaxy();
        setTimeout(() => openMySystems(), 80);
      } else {
        toast(r && r.reason === 'home' ? 'Your home citadel can never be abandoned' : 'Could not release that system', '#e23b4e');
        setTimeout(() => openMySystems(), 80);
      }
    });
  }

  function bindGalaxyMap() {
    const cv = document.getElementById('gx-canvas'); if (!cv) return;
    _gxCv = cv; _gxBake = null;   // fresh render = fresh bake (data may have changed)
    const wrap = cv.parentElement;
    const fit = () => {
      const r = wrap.getBoundingClientRect();
      const dpr2 = Math.min(2, window.devicePixelRatio || 1);
      cv.width = r.width * dpr2; cv.height = r.height * dpr2;
      cv._dpr = dpr2; cv._w = r.width; cv._h = r.height;
      drawGalaxyMap();
    };
    fit(); requestAnimationFrame(fit);   // immediate size + a settle pass
    // pan + tap
    let down = null, moved = false;
    cv.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, cx: gxCam.x, cy: gxCam.y }; moved = false; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      gxCam.x = down.cx - dx / gxCam.z; gxCam.y = down.cy - dy / gxCam.z;
      _gxPanning = true;
      if (!_gxRaf) _gxRaf = requestAnimationFrame(() => { _gxRaf = 0; drawGalaxyMap(); });   // one draw per frame, not per event
    });
    cv.addEventListener('pointerup', (e) => {
      _gxPanning = false;
      if (down && !moved) {
        const r = cv.getBoundingClientRect();
        const wx = (e.clientX - r.left - cv._w / 2) / gxCam.z + gxCam.x;
        const wy = (e.clientY - r.top - cv._h / 2) / gxCam.z + gxCam.y;
        // XYN PRIME FIRST — it draws ×4 and offset east, so unpixel() would map a tap
        // on it to whatever empty coordinate sits under the enlargement. Its own
        // drawn footprint is the authority (see _xynHit).
        if (_xynHit && Math.hypot(wx - _xynHit.x, wy - _xynHit.y) <= _xynHit.r) { openTileAction(_xynHit.id); down = null; return; }
        const c = GM.unpixel(wx, wy, GX_HEX);
        const id = GM.tileId(c.q, c.r);
        if (GM.tileAt(id)) openTileAction(id);
      }
      down = null;
    });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); zoomGalaxy(e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
    el['galaxy-body'].querySelectorAll('[data-gx]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.gx;
      if (k === 'in') zoomGalaxy(1.3);
      else if (k === 'out') zoomGalaxy(1 / 1.3);
      else { gxCam.x = 0; gxCam.y = 0; gxCam.z = 1; drawGalaxyMap(); }
    }));
  }
  function zoomGalaxy(f) { gxCam.z = Math.max(0.16, Math.min(2.6, gxCam.z * f)); drawGalaxyMap(); }
  // ◎ FOCUS A TILE — called from a mail war report. Opens My Galaxy, glides the
  // camera onto the hex, pings it, then opens its panel so the next tap is the
  // action (attack / deploy) rather than a hunt across 1,900 tiles.
  let _gxPing = null;
  function focusGalaxyTile(id, opts) {
    if (!id) return;
    opts = opts || {};
    const c = GM.parseId ? GM.parseId(id) : (() => { const p = String(id).split(','); return { q: +p[0], r: +p[1] }; })();
    if (!c || !isFinite(c.q) || !isFinite(c.r)) {   // VOID / CC ids have no hex coords
      showScreen('galaxy');
      if (window.VOIDZ && /^VZ/.test(String(id))) { setTimeout(() => showScreen('voidzone'), 120); return; }
      setTimeout(() => openTileAction(id), 160);
      return;
    }
    const p = GM.pixel(c.q, c.r, GX_HEX);
    showScreen('galaxy');
    setTimeout(() => {
      gxCam.x = p.x; gxCam.y = p.y;
      gxCam.z = Math.max(gxCam.z, 1.15);
      _gxPing = { id, until: Date.now() + 2600 };
      drawGalaxyMap(true);
      if (opts.open !== false) setTimeout(() => openTileAction(id), 240);
    }, 90);
  }
  // PERF (Jul 2026): panning repainted ~1,900 hexes + glows on every pointermove
  // — molasses on iPad. The world now bakes into an offscreen canvas with a
  // 220px margin; panning is ONE blit. Rebake on zoom/data/margin-exit, and at
  // ~2Hz while idle so the citadel pulses stay alive.
  let _gxBake = null, _gxPanning = false, _gxRaf = 0;
  function drawGalaxyMap(force) {
    const cv = _gxCv; if (!cv || !cv._w || screen !== 'galaxy') return;
    const M = 220;
    const now = performance.now();
    let b = _gxBake;
    const stale = force || !b || b.z !== gxCam.z || b.vw !== cv._w || b.vh !== cv._h ||
      Math.abs((b.cx - gxCam.x) * gxCam.z) > M - 12 || Math.abs((b.cy - gxCam.y) * gxCam.z) > M - 12 ||
      (!_gxPanning && now - b.at > 450);
    if (stale) {
      if (!b || b.vw !== cv._w || b.vh !== cv._h) { b = _gxBake = { cv: document.createElement('canvas') }; }
      const dpr = Math.min(1.5, cv._dpr || 1);
      b.vw = cv._w; b.vh = cv._h; b.z = gxCam.z; b.cx = gxCam.x; b.cy = gxCam.y; b.at = now;
      b._w = cv._w + M * 2; b._h = cv._h + M * 2;
      const pw = Math.round(b._w * dpr), ph = Math.round(b._h * dpr);
      if (b.cv.width !== pw || b.cv.height !== ph) { b.cv.width = pw; b.cv.height = ph; }
      b.cv._dpr = dpr; b.cv._w = b._w; b.cv._h = b._h;
      gxPaintWorld(b.cv);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(cv._dpr, 0, 0, cv._dpr, 0, 0);
    ctx.clearRect(0, 0, cv._w, cv._h);
    const ox = (b.cx - gxCam.x) * gxCam.z - M, oy = (b.cy - gxCam.y) * gxCam.z - M;
    ctx.drawImage(b.cv, 0, 0, b.cv.width, b.cv.height, ox, oy, b._w, b._h);
    // ◎ TILE PING — an expanding ring over a tile we were sent to from mail.
    // Composited over the bake (never into it) so it costs no re-bake, and it
    // self-animates for its lifetime instead of waiting on the 1s idle redraw.
    if (_gxPing) {
      const left = _gxPing.until - Date.now();
      if (left <= 0) { _gxPing = null; }
      else {
        const c = GM.parseId(_gxPing.id);
        if (c) {
          const p = GM.pixel(c.q, c.r, GX_HEX);
          const sx = cv._w / 2 + (p.x - gxCam.x) * gxCam.z, sy = cv._h / 2 + (p.y - gxCam.y) * gxCam.z;
          const cycle = (2600 - left) % 900 / 900;
          ctx.save();
          ctx.strokeStyle = 'rgba(255,210,77,' + (0.95 * (1 - cycle)).toFixed(3) + ')';
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(sx, sy, (GX_HEX * 0.9 + cycle * GX_HEX * 2.2) * gxCam.z, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,210,77,.9)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(sx, sy, GX_HEX * 0.86 * gxCam.z, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
        if (!_gxRaf) _gxRaf = requestAnimationFrame(() => { _gxRaf = 0; drawGalaxyMap(); });
      }
    }
  }
  function gxPaintWorld(cv) {
    const ctx = cv.getContext('2d');
    ctx.setTransform(cv._dpr, 0, 0, cv._dpr, 0, 0);
    const w = cv._w, h = cv._h, z = gxCam.z;
    // deep-space backdrop
    const bg = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, Math.max(w, h) * 0.8);
    bg.addColorStop(0, '#101a2c'); bg.addColorStop(1, '#070b14');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2); ctx.scale(z, z); ctx.translate(-gxCam.x, -gxCam.y);
    // visible ring bound (cull cheaply by distance)
    const half = Math.hypot(w, h) / 2 / z;
    const maxPix = Math.hypot(gxCam.x, gxCam.y) + half + GX_HEX * 2;
    const maxRing = Math.min(GM.RINGS, Math.ceil(maxPix / (GX_HEX * 1.5)));
    const myUid = null;
    const lvl = G.state.level;
    const showText = z >= 0.55;
    const sq3 = Math.sqrt(3);
    let homeDraw = null;
    // THE ARTERY RIDES THE SAME DRAW PASS AS THE RINGS. It is built from ordinary
    // hex tiles, so every fill, edge, shield, citadel and label rule below applies
    // to it with no second copy of the drawing code. Its coords sit past the rim,
    // which is the only reason they have to be appended — the ring walk stops at
    // RINGS and always will (citadelSet() depends on that).
    const passes = [];
    for (let ring = 0; ring <= maxRing; ring++) passes.push(GM.ringCoords(ring));
    if (GM.ARTERY) passes.push(GM.ARTERY.path);
    for (const coords of passes) {
      for (const c of coords) {
        const p = GM.pixel(c.q, c.r, GX_HEX);
        const id0 = GM.tileId(c.q, c.r);
        // XYN PRIME · ×4. Resolved BEFORE the cull so the wider footprint is not
        // culled on its own centre and popped off screen while still visible.
        const hexS = (GM.isXyn && GM.isXyn(id0)) ? XYN_HEX_SCALE : 1;
        if (hexS > 1) { p.x += XYN_HEX_SHIFT; _xynHit = { x: p.x, y: p.y, r: GX_HEX * hexS, id: id0 }; }
        // viewport cull
        if (Math.abs(p.x - gxCam.x) > half + GX_HEX * hexS || Math.abs(p.y - gxCam.y) > half + GX_HEX * hexS) continue;
        const id = id0;
        const t = GM.tileAt(id); if (!t) continue;
        const owned = G.isOwned(id), rival = !owned && G.rivalOf(id);
        const ally = !owned && G.isAllyTile && G.isAllyTile(id);
        const locked = !owned && !t.home && t.level > lvl + 10;
        const active = G.state.currentSystem === id;
        const cd = t.home ? 0 : G.tileCooldownLeft(id);
        // fill by state
        let fill, edge;
        if (t.home) { fill = '#2a2438'; edge = '#f2b24b'; }
        else if (owned) { fill = 'rgba(45,120,235,0.82)'; edge = '#9fccff'; }   // YOURS — solid blue, clearly held
        else if (ally) { fill = 'rgba(46,180,102,0.55)'; edge = '#46d27a'; }     // ALLIED — green, protected
        else if (rival) {
          // A TERRITORY GETS ITS HOLDER'S COLOUR; A STRAY CLAIM STAYS RED.
          //
          // Every rival tile used to be the same red, so on a live shared map — 92%
          // claimed across 85 owners — the galaxy was one undifferentiated red mass
          // and no amount of boundary line could separate one empire from the next
          // (a border between two identical reds is a hairline, and at low zoom it
          // is nothing at all). That is the whole of "I don't see any clusters
          // besides my own".
          //
          // A tile in a bloc of BLOC_MIN+ is now FILLED in its holder's own hue —
          // the same hue its wall is drawn in — so territories separate at a glance
          // before a single line is read. Isolated claims and pairs keep the generic
          // red: 1,065 of the claims on that map were single tiles, and giving each
          // of those its own colour would be the confetti again.
          // A TILE'S OWN OUTLINE IS STRUCTURE, NOT A STATEMENT.
          //
          // Every rival tile carried a saturated #ff5468 ring, so a screen of them
          // was a uniform lattice of bright outlines with no hierarchy at all — and
          // a territory boundary drawn into that field is just one more line. The
          // per-tile edge is quiet now and OWNERSHIP READS FROM THE FILL, which
          // leaves the bloc boundary as the loudest thing on the map. That is the
          // inversion the map needed: tiles are texture, territories are shape.
          const bl = G.blocOf ? G.blocOf(id) : null;
          if (bl && bl.size >= (G.BLOC_MIN || 3)) {
            const frgb = factionWallRGB(G.factionOf ? G.factionOf(id) : null);
            fill = 'rgba(' + frgb + ',0.34)';
            edge = 'rgba(' + frgb + ',0.34)';
          } else { fill = 'rgba(210,59,78,0.30)'; edge = 'rgba(255,84,104,0.34)'; }
        }
        else if (locked) { fill = 'rgba(74,81,96,0.25)'; edge = '#3a4150'; }
        else { fill = 'rgba(120,134,158,0.14)'; edge = '#566884'; }              // unclaimed — neutral slate
        // THE ARTERY'S COLOUR IS ITS EDGE, NOT ITS FILL.
        //
        // The region used to tint its unclaimed hexes crimson — rgba(255,45,107,0.20)
        // — and the rest of the map's ownership palette was designed against the
        // neutral slate rgba(120,134,158,0.14). A stray rival claim anywhere in My
        // Galaxy is a deliberately quiet rgba(210,59,78,0.30), which reads clearly
        // on slate and is nearly INVISIBLE on crimson: same hue family, 10 points
        // of alpha apart. So a captured Artery system looked like an empty one and
        // only the owner's name gave it away.
        //
        // The fill is now the map's own, in every state — slate unclaimed, blue
        // yours, green allied, red or the holder's bloc hue for a rival — and the
        // region keeps its identity in the EDGE, on hexes nobody holds. Held
        // ground is painted exactly like held ground anywhere else.
        if (t.artery && !owned && !rival && !ally) edge = GM.ARTERY.edge;
        // hex path (see gxHexPath — the current path is NOT part of canvas drawing
        // state, so anything that calls beginPath() below must re-establish it)
        gxHexPath(ctx, p.x, p.y, hexS);
        ctx.fillStyle = fill; ctx.fill();
        // —— KAEVITH INCURSION —— an invaded tile reads as a hole in the map:
        // a dark void core bleeding purple, over whatever the ownership fill is.
        // (Ownership, citadels and cooldowns are untouched — this is a veil.)
        let xenBloom = null;
        if (t.alien && !t.home) {
          // Phase varies per tile by coordinate — what the old per-tile Date.now()
          // term was really doing.
          const veil = xenVeil((((c.q * 3 + c.r * 5) % XEN_PHASES) + XEN_PHASES) % XEN_PHASES);
          ctx.save();
          ctx.clip();                                    // core stays inside the hex
          ctx.drawImage(veil.core, p.x - veil.cr, p.y - veil.cr, veil.cr * 2, veil.cr * 2);
          ctx.restore();
          xenBloom = veil;                               // blitted below, unclipped
          // quiet, for the same reason the ownership edges are: the veil itself
          // already says "invaded" far louder than an outline can.
          edge = 'rgba(194,107,255,0.42)';
        }
        // contested lockout — dim the hex so "can't take this yet" reads at a glance.
        // MUST run while the hex path is still current — the bloom blit below is
        // deliberately after it, and drawImage does not disturb the path.
        if (cd > 0 && !owned) { ctx.fillStyle = 'rgba(5,8,14,0.48)'; ctx.fill(); }
        // Kaevith bloom: unclipped and ADDITIVE against the map, so it spills past
        // the hex edge and pools across neighbouring invaded tiles.
        if (xenBloom) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(xenBloom.bloom, p.x - xenBloom.br, p.y - xenBloom.br, xenBloom.br * 2, xenBloom.br * 2);
          ctx.restore();
        }
        // CITADEL FORTRESS — themed: BLUE yours · RED a rival's · AMBER unclaimed.
        //
        // CONSISTENCY BUG (fixed): whether the fortress was drawn at all came only
        // from per-account state — hasMyCitadel() reads YOUR save's state.citadels,
        // and rivalCitadelScore() reads the server claim. captureSystem() writes a
        // state.citadels entry only for VOID tiles, so a NATURAL citadel you had
        // taken produced neither: it rendered as a bare prismatic hex to you, while
        // every other account — reading your published claim, which does carry
        // citadel:true — saw a full red fortress on the same tile. Same coordinate,
        // two different maps.
        //
        // A natural citadel is part of the seeded terrain (galaxy.js, identical on
        // every account), so its fortress is now drawn from t.citadel. Ownership
        // only picks the TINT, never whether the structure exists.
        {
          const natural = !!t.citadel && !t.home;
          const myCit = owned && (natural || (G.hasMyCitadel && G.hasMyCitadel(id)));
          const rivCit = !myCit && ((natural && (rival || ally)) || (G.rivalCitadelScore && G.rivalCitadelScore(id) != null));
          const freeCit = !myCit && !rivCit && natural;
          if (myCit || rivCit || freeCit) {
            const cc = myCit ? [70, 150, 255] : rivCit ? [240, 60, 70] : [255, 190, 110];
            const tint = myCit ? '#2f7dff' : rivCit ? '#e23b3b' : '#ffbe6e';
            const pp = 0.55 + 0.45 * Math.sin(Date.now() / 380 + t.ring);
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            const ag = ctx.createRadialGradient(p.x, p.y, GX_HEX * 0.2, p.x, p.y, GX_HEX * 1.7);
            ag.addColorStop(0, 'rgba(' + cc[0] + ',' + cc[1] + ',' + cc[2] + ',' + (0.4 * pp).toFixed(3) + ')');
            ag.addColorStop(1, 'rgba(' + cc[0] + ',' + cc[1] + ',' + cc[2] + ',0)');
            ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(p.x, p.y, GX_HEX * 1.7, 0, 7); ctx.fill();
            ctx.restore();
            const cimg = tintedCitadel(tint);
            if (cimg) {
              const dw = GX_HEX * 1.6, dh = dw * (cimg.height / cimg.width);
              ctx.save(); ctx.shadowColor = 'rgb(' + cc[0] + ',' + cc[1] + ',' + cc[2] + ')'; ctx.shadowBlur = 10;
              ctx.drawImage(cimg, p.x - dw / 2, p.y - dh / 2 - 2, dw, dh); ctx.restore();
            } else {
              const csv = 'rgb(' + cc[0] + ',' + cc[1] + ',' + cc[2] + ')';
              ctx.save(); ctx.lineWidth = 2 + pp; ctx.strokeStyle = csv; ctx.shadowColor = csv; ctx.shadowBlur = 9;
              ctx.beginPath(); ctx.arc(p.x, p.y, GX_HEX * 0.92, 0, 7); ctx.stroke(); ctx.restore();
              ctx.fillStyle = csv; ctx.font = '800 10px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('♛', p.x, p.y - GX_HEX * 0.5);
            }
          }
        }
        // The fortress block above calls beginPath()+arc() for its glow, which
        // REPLACES the hex path with a radius-44.2 circle. The current path is not
        // part of the drawing state, so its ctx.save()/restore() does not bring the
        // hex back — the prismatic stroke below was painting that circle, a rainbow
        // ring ~1.8× the tile radius bleeding over all six neighbours. Rebuild the
        // hex here so the stroke always outlines the tile.
        gxHexPath(ctx, p.x, p.y);
        if (t.citadel) {
          // PRISMATIC edge — slow color-cycling sheen, phase-offset per tile
          const hue = (Date.now() / 30 + (c.q * 47 + c.r * 31)) % 360;
          const pg = ctx.createLinearGradient(p.x - GX_HEX, p.y - GX_HEX, p.x + GX_HEX, p.y + GX_HEX);
          pg.addColorStop(0, 'hsl(' + hue + ',90%,62%)');
          pg.addColorStop(0.5, 'hsl(' + ((hue + 90) % 360) + ',90%,68%)');
          pg.addColorStop(1, 'hsl(' + ((hue + 180) % 360) + ',90%,62%)');
          ctx.lineWidth = active ? 3.2 : 2.4;
          ctx.strokeStyle = pg; ctx.stroke();
        } else {
          ctx.lineWidth = active ? 3 : 1.1;
          ctx.strokeStyle = active ? '#ffffff' : edge;
          ctx.stroke();
        }
        // —— CONTIGUITY BORDER —— a qualifying block gets one loud outline around
        // the WHOLE shape, in its tier's colour, drawn as a wide dark casing plus
        // a bright core so it reads as a glow without a shadowBlur in the loop.
        // This is baked world paint, not per-frame paint: it changes only when
        // ownership does.
        if (owned && !t.home && G.clusterOf) {
          const clu = G.clusterOf(id);
          if (clu && clu.mult > 1) {
            const same = (nid) => G.isOwned(nid) && G.clusterOf(nid).cid === clu.cid;
            ctx.save();
            ctx.lineCap = 'round';
            gxBlockBorder(ctx, p.x, p.y, c.q, c.r, same);
            ctx.strokeStyle = 'rgba(4,7,13,.85)'; ctx.lineWidth = 7; ctx.stroke();
            gxBlockBorder(ctx, p.x, p.y, c.q, c.r, same);
            ctx.strokeStyle = clu.color; ctx.lineWidth = 3.4; ctx.stroke();
            gxBlockBorder(ctx, p.x, p.y, c.q, c.r, same);
            ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1.1; ctx.stroke();
            ctx.restore();
          }
        }
        // —— SIEGE SHIELD —— no exposed border, no siege (G.tileShield).
        //
        // Two marks, and between them they draw the whole rule without a word:
        // a PROTECTED CORE breathes inside its hex, and the SHELL around it — the
        // exposed tiles of the same faction that an attacker has to break first —
        // gets a DASHED wall on its outward edges only, so the boundary reads as
        // one barrier around the territory rather than as N outlined tiles.
        //
        // THE WALL IS DASHED FOR A REASON. The contiguity border above is a SOLID
        // thick line in its tier's colour, and that palette is orange / purple /
        // cyan / green — so a solid shield line would have been the same colour as
        // the income border on the same tiles at two of the four tiers, with two
        // different meanings. Dashes make the two unmistakable at a glance no
        // matter which hue either lands on: solid = what this block PAYS, dashed =
        // what an attacker has to BREAK.
        //
        // Both read the same function the tile sheet and warp() read, so the map
        // can never promise a siege the button refuses. The breathing rides the
        // same Date.now() phase the citadel glow uses and therefore steps at the
        // world bake's ~2Hz — deliberately: this is baked paint, and a shield that
        // changes only when ownership does has nothing to gain from 60fps. (The
        // dash phase is fixed for the same reason — marching dashes at 2Hz read as
        // a flicker, not as motion.)
        if (!t.home && G.tileShield) {
          const shd = G.tileShield(id);
          if (shd.faction) {
            const sc = factionWallRGB(shd.faction);
            const ph = 0.5 + 0.5 * Math.sin(Date.now() / 520 + (c.q * 0.7 + c.r * 1.3));
            if (shd.shielded) {
              ctx.save();
              gxHexPath(ctx, p.x, p.y);
              ctx.fillStyle = 'rgba(' + sc + ',' + (0.09 + 0.13 * ph).toFixed(3) + ')';
              ctx.fill();
              ctx.lineWidth = 1.8 + 1.3 * ph;
              ctx.strokeStyle = 'rgba(' + sc + ',' + (0.55 + 0.4 * ph).toFixed(3) + ')';
              ctx.stroke();
              ctx.restore();
            } else if (shd.open > 0 && shd.ring.length) {
              // A TERRITORY IS WORTH DRAWING BECAUSE IT IS A TERRITORY.
              //
              // This used to require the bloc to contain a SEALED core before it
              // drew anything, which on a live shared map meant nothing was ever
              // outlined: 1,793 claimed tiles across 85 owners produced 531
              // same-owner adjacencies and zero sealed cores, so another pilot's
              // holdings were invisible — the reported "I only see my own".
              //
              // Any bloc of BLOC_MIN+ touching tiles now gets its boundary. A bloc
              // that actually holds a protected core gets the heavier, breathing
              // line, so "somebody holds this ground" and "there is something
              // sealed inside" stay two different marks.
              // —— THE TERRITORY BOUNDARY —— the loudest mark on the map.
              //
              // Three passes, the same construction the contiguity border uses
              // because it is the one thing on this canvas that was always legible:
              // a dark casing so it reads over any fill, the faction's own hue as
              // the body, and a fine white core so the line has an edge. SOLID, at
              // the hex radius — this is "whose ground is this".
              //
              // A bloc that holds a SEALED CORE gets a second, dashed, breathing
              // line inset inside it: "and something in here cannot be reached".
              // Two marks, two facts, and neither is a hairline.
              //
              // MY OWN BLOC IS SKIPPED WHEN THE CONTIGUITY BORDER IS ALREADY
              // DRAWING IT. That border traces the same outward edges of the same
              // shape, so both would sit on the same pixels — one territory, one
              // outline.
              const bl = G.blocOf ? G.blocOf(id) : null;
              const min = (G.BLOC_MIN || 3);
              const ownDrawn = shd.mine && owned && G.clusterOf && G.clusterOf(id).mult > 1;
              if (bl && bl.size >= min && !ownDrawn) {
                const fac = shd.faction;
                const sameFac = (nid) => G.factionOf(nid) === fac;
                // ZOOM COMPENSATION. Widths are WORLD units under ctx.scale(z,z),
                // so at z=0.4 a 6px casing rendered 2.4px and the body under one
                // pixel — the boundary vanished at exactly the zoom where a player
                // is reading the shape of the map.
                const zw = 1 / Math.max(0.4, Math.min(1.3, z));
                ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
                gxBlockBorder(ctx, p.x, p.y, c.q, c.r, sameFac);
                ctx.strokeStyle = 'rgba(3,6,11,.92)'; ctx.lineWidth = 7.5 * zw; ctx.stroke();
                gxBlockBorder(ctx, p.x, p.y, c.q, c.r, sameFac);
                ctx.strokeStyle = 'rgb(' + sc + ')'; ctx.lineWidth = 3.6 * zw; ctx.stroke();
                gxBlockBorder(ctx, p.x, p.y, c.q, c.r, sameFac);
                ctx.strokeStyle = 'rgba(255,255,255,.72)'; ctx.lineWidth = 1.15 * zw; ctx.stroke();
                ctx.restore();
                // the sealed-core wall, inside the boundary
                if (bl.cores > 0) {
                  ctx.save();
                  ctx.setLineDash([7 * zw, 4 * zw]); ctx.lineCap = 'butt';
                  gxBlockBorder(ctx, p.x, p.y, c.q, c.r, sameFac, 6);
                  ctx.strokeStyle = 'rgba(3,6,11,.8)'; ctx.lineWidth = 4.5 * zw; ctx.stroke();
                  gxBlockBorder(ctx, p.x, p.y, c.q, c.r, sameFac, 6);
                  ctx.strokeStyle = 'rgba(' + sc + ',' + (0.6 + 0.4 * ph).toFixed(3) + ')';
                  ctx.lineWidth = (2 + 0.9 * ph) * zw; ctx.stroke();
                  ctx.restore();
                }
              }
            }
          }
        }
        if (t.home) { homeDraw = p; continue; }   // the hub is drawn LAST, on top
        if (!showText) {
          // zoomed out: just mark specials
          if (t.citadel) {
            const hue2 = (Date.now() / 25 + t.ring * 30) % 360;
            ctx.fillStyle = 'hsl(' + hue2 + ',90%,65%)';
            ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, 7); ctx.fill();
          } else if (t.alien) {
            ctx.fillStyle = '#c26bff';
            ctx.beginPath(); ctx.arc(p.x, p.y, 3.2, 0, 7); ctx.fill();
          }
          continue;
        }
        // icon + level
        ctx.textAlign = 'center';
        {
          if (t.xyn && gxXynImg.complete && gxXynImg.naturalWidth) {
            // THE XYN, seated in its hex. Drawn a touch larger than a fortress
            // because it is the thing the whole stem exists for — and because it
            // is the largest hull in the game, which should read at map scale too.
            const dw = GX_HEX * 1.72 * hexS, dh = dw * (gxXynImg.naturalHeight / gxXynImg.naturalWidth);
            ctx.drawImage(gxXynImg, p.x - dw / 2, p.y - dh / 2 - 2 * hexS, dw, dh);
          } else if (t.citadel && gxCitImg.complete && gxCitImg.naturalWidth) {
            // real citadel art seated in the hex
            const dw = GX_HEX * 1.5, dh = dw * (gxCitImg.naturalHeight / gxCitImg.naturalWidth);
            ctx.drawImage(gxCitImg, p.x - dw / 2, p.y - dh / 2 - 3, dw, dh);
          } else {
            // The citadel's own '⛴' is omitted — the tinted fortress sprite above is
          // now drawn on EVERY natural citadel (not just owned/rival ones), so the
          // glyph was a third centred mark stacked on the art and the level label.
          const icon = t.citadel ? '' : t.boss ? '☠' : (t.resource ? GM.RES[t.resource].glyph : '');
            if (icon) { ctx.font = '800 10px Rajdhani, sans-serif'; ctx.fillStyle = t.citadel ? '#ffb088' : t.boss ? '#ff6a78' : (t.resource ? GM.RES[t.resource].color : '#9fb2d0'); ctx.fillText(icon, p.x, p.y - 3); }
          }
          if (t.alien && !t.home) { ctx.font = '800 11px Rajdhani, sans-serif'; ctx.fillStyle = '#e0b3ff'; ctx.fillText('◈', p.x, p.y - GX_HEX * 0.42); }
          ctx.font = '800 8px Rajdhani, sans-serif';
          ctx.fillStyle = locked ? '#5a6270' : t.alien ? '#e6c8ff' : '#dfe9ff';
          ctx.fillText('L' + t.level, p.x, p.y + (t.citadel ? GX_HEX * 0.62 : (t.boss || t.resource) ? 9 : 3));
          if (cd > 0 && !owned && showText) {
            // CLEAR COUNTDOWN — dark pill + live ticking clock (h for citadels)
            const txt = '◷ ' + (cd >= 3600 ? Math.floor(cd / 3600) + 'h' + Math.ceil((cd % 3600) / 60) + 'm' : Math.floor(cd / 60) + ':' + ((cd % 60) < 10 ? '0' : '') + (cd % 60));
            ctx.font = '800 8.5px Rajdhani, sans-serif';
            const tw = ctx.measureText(txt).width + 10;
            const py = p.y + GX_HEX * 0.42;
            ctx.fillStyle = 'rgba(8,11,18,0.92)';
            ctx.beginPath(); ctx.roundRect(p.x - tw / 2, py, tw, 13, 6.5); ctx.fill();
            ctx.strokeStyle = 'rgba(255,207,122,0.7)'; ctx.lineWidth = 1; ctx.stroke();
            ctx.fillStyle = '#ffcf7a'; ctx.textAlign = 'center';
            ctx.fillText(txt, p.x, py + 9.5);
          } else if (cd > 0) { ctx.font = '800 8px Rajdhani, sans-serif'; ctx.fillStyle = '#ffcf7a'; ctx.fillText('◷', p.x + GX_HEX * 0.45, p.y - GX_HEX * 0.4); }
          if (owned) { ctx.fillStyle = '#eaf3ff'; ctx.font = '800 7px Rajdhani, sans-serif'; ctx.fillText('★', p.x - GX_HEX * 0.45, p.y - GX_HEX * 0.4); }
        }
      }
    }
    // —— the HOME CITADEL hub: real fortress art + breathing golden halo ——
    if (homeDraw) {
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 600);
      const ag = ctx.createRadialGradient(homeDraw.x, homeDraw.y, 4, homeDraw.x, homeDraw.y, GX_HEX * 3.2);
      ag.addColorStop(0, 'rgba(255,200,110,' + (0.30 + 0.16 * pulse).toFixed(3) + ')');
      ag.addColorStop(0.6, 'rgba(255,170,70,' + (0.10 + 0.08 * pulse).toFixed(3) + ')');
      ag.addColorStop(1, 'rgba(255,170,70,0)');
      ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(homeDraw.x, homeDraw.y, GX_HEX * 3.2, 0, 7); ctx.fill();
      if (gxCitImg.complete && gxCitImg.naturalWidth) {
        const dw = GX_HEX * 2.8, dh = dw * (gxCitImg.naturalHeight / gxCitImg.naturalWidth);
        ctx.drawImage(gxCitImg, homeDraw.x - dw / 2, homeDraw.y - dh / 2, dw, dh);
      } else {
        ctx.font = '800 18px Rajdhani, sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = '#ffd9a0'; ctx.fillText('⌂', homeDraw.x, homeDraw.y + 4);
      }
      if (showText) {
        ctx.font = '800 8px Rajdhani, sans-serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 2.4; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.strokeText('HOME CITADEL', homeDraw.x, homeDraw.y + GX_HEX * 1.5);
        ctx.fillStyle = '#ffd9a0'; ctx.fillText('HOME CITADEL', homeDraw.x, homeDraw.y + GX_HEX * 1.5);
      }
    }
    ctx.restore();
    // ring label — which ring band is at the center of the view?
    const cring = Math.round(Math.hypot(gxCam.x, gxCam.y) / (GX_HEX * 1.55));
    const lab = document.getElementById('gx-ringlab');
    // PAST THE RIM TO THE EAST IS THE ARTERY, not "RING 25". Clamping the label at
    // RINGS the way the ring readout does would name the filament after the map it
    // hangs off, and its levels start where the rings stop.
    let inArt = false;
    if (GM.ARTERY && GM.unpixel) {
      try {
        const a = GM.unpixel(gxCam.x, gxCam.y, GX_HEX);
        inArt = !!a && GM.ringOf(a.q, a.r) > GM.RINGS && a.q > 0;
      } catch (e) { inArt = false; }
    }
    if (lab) lab.textContent = inArt ? GM.ARTERY.name + ' · Lv ' + GM.ARTERY.minLevel + '+'
      : cring <= 0 ? 'CORE · Home Citadel'
      : 'RING ' + Math.min(GM.RINGS, cring) + ' · Lv ' + GM.ringLevel(Math.min(GM.RINGS, Math.max(1, cring)));
  }
  // DREAD-class confirm sheet — was dropped in the dead-code cleanup while the
  // unified ship card still emitted data-mega-buy, so Acquire silently threw.
  function openMegaBuy(key) {
    const ship = C.SHIP_BY_KEY[key]; if (!ship || !ship.megaCost) return;
    const st = G.shipBuyState(key);
    const sheet = showSheet(`<div class="sheet-head">${ship.name}</div><div class="sheet-body">
      <div style="display:flex;align-items:center;gap:12px"><img src="ships/ship-${key}.png" alt="" style="width:74px;height:52px;object-fit:contain;filter:drop-shadow(0 0 10px rgba(255,90,104,.5))">
      <div style="flex:1;min-width:0"><div style="font-family:var(--font-display);font-weight:800;font-size:15px;color:#fff">${ship.name}</div>
      <div style="font-size:11px;color:#9fb0c4;margin-top:2px">${ship.tag || ship.cls}</div></div></div>
      <div class="ip-stat" style="margin-top:10px"><span class="ip-sname">Price</span><span class="v">${megaCostHTML(ship.megaCost, true)}</span></div>
      <p style="font-size:12px;color:#b8c4d8;line-height:1.5;margin-top:8px">One-time purchase — the hull is yours permanently and switching to it is free.</p>
      <div class="sheet-actions"><button class="btn" data-x>Cancel</button><button class="btn gold" data-ok ${st.affordable ? '' : 'disabled'}>${st.affordable ? '✦ Acquire ' + ship.name : 'Not enough funds'}</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    const ok = sheet.querySelector('[data-ok]');
    if (ok) ok.addEventListener('click', () => {
      const r = G.buyShip(key);
      if (r.ok) { closeSheet(); toast('✦ ' + ship.name + ' acquired — she\u2019s in your hangar!', '#ffd24d'); renderStore(); renderHero(); }
      else toast(r.reason === 'locked' ? 'Reach Level ' + (ship.reqLevel || 1) + ' first' : 'Not enough funds for the ' + ship.name, '#e23b4e');
    });
  }
  // NO EXPOSED BORDER, NO SIEGE — stated on the tile the player is looking at.
  //
  // A rule that decides whether an attack is even possible must be readable
  // BEFORE the button is tapped, and it must not live in a `title` attribute or
  // a toast. So the sheet says which of the four situations this tile is in, and
  // — for a sealed enemy core — NAMES THE WAY IN and offers to fly the camera
  // there, which turns "you can't attack this" into an instruction.
  //
  // Every answer comes from G.tileShield()/G.shieldDoors(), the same functions
  // warp() refuses on and the map paints from. Nothing here re-derives adjacency.
  // THE XYN EVENT · XYN PRIME. Every figure and every gate comes from XYN.status()
  // — the same module onKill() rolls through — so the card cannot advertise odds or
  // a requirement the engine does not actually enforce.
  function gxXynCard(t) {
    if (!t || !t.xyn) return '';
    const S = (window.XYN && window.XYN.status) ? window.XYN.status() : null;
    if (!S) return '';
    const odds = '1 in ' + S.odds.toLocaleString();
    const gate = S.gate === 'owned'
      ? '<b class="gx-xyn-ok">✓ The Xyn is in your hangar.</b> It still spawns here — holding this system is what stops anyone else rolling for it.'
      : S.gate === 'need-tile'
        ? '<b class="gx-xyn-no">⚠ You must OWN this system for a defeat to pay.</b> Take it first — there is no other way in.'
        : '<b class="gx-xyn-ok">✓ You hold this system.</b> Every Xyn defeat here rolls.';
    return '<div class="gx-xyn">'
      + '<div class="gx-xyn-h">◈ THE XYN<em>Super Fighter class · 22 fighter bays</em></div>'
      + '<div class="gx-xyn-b">The <b>Xyn</b> itself is the <b>boss</b> of this system, and it spawns whether or not you already own the hull. Every defeat rolls a '
      + '<b>' + odds + '</b> chance the hull is recovered — no escalator, no pity timer — and you are told the outcome every time. '
      + 'It is the first hull <b>above Celestial</b>: the Celestial Corvus’s combat sheet with '
      + '<b>twenty-two</b> fighter bays instead of eleven.</div>'
      + '<div class="gx-xyn-g">' + gate + '</div>'
      + (S.kills ? '<div class="gx-xyn-r"><span>Xyn defeats logged here</span><b>' + G.formatNum(S.kills) + '</b></div>' : '')
      + '<div class="gx-xyn-n">Hold the chain behind it and this hex is <b>shielded</b> — attackers have to grind the filament up from the <b>mouth</b> to reach it. There is no other way in.</div>'
      + '</div>';
  }
  // THE ARTERY · EXSANGUINATION. Both numbers come from the engine (G.arteryHeld,
  // G.shieldHoursFor) — the same functions the capture path writes the shield
  // from — so the card cannot quote a window the game does not actually give.
  // A card that states a figure a player cannot convert into an outcome is
  // decoration; this one states the exact hours their next capture will hold.
  function gxArteryCard(t) {
    if (!t || !t.artery) return '';
    const A = GM.ARTERY || {};
    const held = G.arteryHeld ? G.arteryHeld() : 0;
    const total = (A.path || []).length;
    const hrs = G.shieldHoursFor ? G.shieldHoursFor(t.id) : 24;
    const hTxt = hrs >= 1 ? (Math.round(hrs * 10) / 10) + ' h' : Math.round(hrs * 60) + ' min';
    // THE ×3 IS STATED AGAINST THE RIGHT COMPARAND. A fortress here is ×3 the best
    // natural fortress on the map; an ordinary system is ×3 the best ordinary hex.
    // Saying "the richest tile in the galaxy" for both would be false for one of
    // them, and a card that overstates a number is worse than one that omits it.
    const vs = t.citadel ? 'the richest natural fortress on the map' : 'the richest ordinary system on the map';
    // NO "24 h instead of 24 h". At nothing held there is no reduction yet, so the
    // line states the rule that is about to bite instead of a comparison to itself.
    const fx = held < 2
      ? 'Every Artery system you hold bleeds the attack shield off all of them. Your first shields for the full '
        + '<b>24 h</b> — the second cuts both to <b>12 h</b>, and all ' + total + ' would leave each on <b>'
        + (Math.round(24 / total * 10) / 10) + ' h</b>.'
      : 'Every Artery system you hold bleeds the attack shield off all of them. You hold <b>' + held + ' of '
        + total + '</b>, so a capture here shields for <b>' + hTxt + '</b> instead of 24 h.';
    return '<div class="gx-art">'
      + '<div class="gx-art-h">◈ ' + (A.name || 'THE ARTERY') + '<em>Lv ' + (A.minLevel || 500) + '+ · ' + total + ' systems, one tile wide</em></div>'
      + '<div class="gx-art-b">Pays <b>×' + (A.mult || 3) + '</b> ' + vs + '. The filament is <b>one tile wide with a '
      + 'single entrance</b>, and it is taken <b>one system at a time</b>: you can only assault a system whose '
      + 'neighbour toward the mouth you already hold. The way in is <b>Lancet</b> — for you and for anyone coming '
      + 'after you. Hold the chain and only the hex at the <b>mouth</b> can be attacked; everything behind it is '
      + 'shielded until that one falls.</div>'
      + '<div class="gx-art-fx"><b>' + (A.effect || 'EXSANGUINATION') + '</b><span>' + fx + '</span></div>'
      + '<div class="gx-art-n">Hold the whole branch and you own the best ground in the game with almost no shield on any of it.</div>'
      + '</div>';
  }
  function gxShieldCard(t) {
    const s = t && t.shield;
    if (!s || !s.faction) return '';          // neutral ground has no border to speak of
    const doors = t.shieldDoors || [];
    const who = t.rival || 'the holder';
    if (s.shielded) {
      if (s.mine || t.ally) {
        return '<div class="gx-shield core">🛡 <b>PROTECTED CORE</b> — all six borders face '
          + (t.ally ? 'allied space' : 'your own space') + '. Nobody can siege this system until one of the border systems around it falls.</div>';
      }
      const jump = doors.slice(0, 3).map((nid) => {
        const nt = G.tileInfo ? G.tileInfo(nid) : null;
        return '<button class="gxs-door" data-gxdoor="' + nid + '">◎ ' + esc((nt && nt.name) || nid) + '</button>';
      }).join('');
      return '<div class="gx-shield core foe">🛡 <b>PROTECTED CORE — CANNOT BE SIEGED</b> — every border of this system faces <b>' + esc(who)
        + '</b>’s own space, so there is no way in yet. Take one of the outer systems first and the path opens.'
        + (jump ? '<div class="gxs-doors">' + jump + '</div>' : '') + '</div>';
    }
    // EXPOSED. Two things are worth saying, and only when they are actionable.
    let behind = 0;
    for (let i = 0; i < s.ring.length; i++) if (G.tileShield(s.ring[i]).shielded) behind++;
    // WHOSE TERRITORY THIS IS. On a shared map most systems have an owner and few
    // have a sealed core, so the size of the bloc is the fact that tells a pilot
    // whether they are looking at somebody's empire or at a stray claim.
    const bl = t.bloc;
    const min = (G.BLOC_MIN || 3);
    const terr = (bl && bl.size >= min && !s.mine && !t.ally)
      ? '<div class="gx-shield way">◬ <b>' + esc(who.toUpperCase()) + '’S TERRITORY</b> — this system is one of <b>' + bl.size
        + '</b> touching systems they hold' + (bl.cores ? ', <b>' + bl.cores + '</b> of them sealed behind the border' : ' — none of it sealed, so any of it can be attacked') + '.</div>'
      : '';
    if (s.mine || t.ally) {
      if (!s.ring.length) return '';           // a lone system: "fill the borders" is not yet advice
      const shell = behind ? ' It is also the shell keeping <b>' + behind + '</b> of your systems sealed.' : '';
      // THE MAP'S EDGE IS AN OPEN BORDER YOU CANNOT CLOSE. Telling a pilot on the
      // rim to "hold the tiles around it and it seals itself" is advice they can
      // follow to completion and still be refused — there is no tile out there to
      // take. So a rim system says what it is instead of what to do.
      const edge = s.edge | 0;
      if (edge >= s.open) {
        return '<div class="gx-shield">⚠ <b>RIM SYSTEM</b> — <b>' + edge + '</b> of six borders face the edge of the galaxy, and there is no ground out there to take. The rim can never be closed, so this system stays open to attack however much space you hold around it.' + shell + '</div>';
      }
      return '<div class="gx-shield">⚠ <b>FRONT LINE</b> — <b>' + s.open + '</b> of six borders are open, so this system can be attacked. '
        + (edge ? '<b>' + edge + '</b> of them face the edge of the galaxy and can never be closed — hold the rest and it is as sealed as the rim allows.' : 'Hold the tiles around it and it seals itself.')
        + shell + '</div>';
    }
    if (!behind) return terr;                  // no core behind it — but say whose ground it is
    return terr + '<div class="gx-shield way">⚔ <b>THE WAY IN</b> — this system’s border is open, and taking it exposes <b>' + behind
      + '</b> sealed system' + (behind === 1 ? '' : 's') + ' behind it.</div>';
  }
  function openTileAction(id) {
    const t = G.tileInfo(id); if (!t) return;
    if (t.home) {
      // YOUR GATHERING OPERATION — everything the galaxy is paying you
      const rates = G.resourceRates();
      const owned = Object.keys(G.state.ownedSystems || {});
      let citN = 0, deepN = 0, bossN = 0;
      owned.forEach((k2) => { const tt = GM.tileAt(k2); if (!tt) return; if (tt.citadel) citN++; if (tt.deep) deepN++; if (tt.boss) bossN++; });
      const rows = GM.RES_KEYS.map((k2) => {
        const d = GM.RES[k2];
        return `<div class="ip-stat big"><span class="ip-sname" style="color:${d.color}">${d.glyph} ${d.name}</span><span class="v" style="color:${d.color}">+${G.formatNum(rates[k2] || 0)}<i class="perh">/hour</i></span></div>`;
      }).join('');
      const sheet = showSheet(`<div class="sheet-head">⌂ Home Citadel</div><div class="sheet-body">
        <p style="margin-bottom:8px">The neutral heart of the Galaxy — every operator's safe harbor. It cannot be conquered.</p>
        <div class="lo-sect">Your gathering operation</div>
        ${rows}
        <div class="ip-stat"><span class="ip-sname">Territory held</span><span class="v">${owned.length} tile${owned.length === 1 ? '' : 's'}${citN ? ` · ⛴ ${citN} citadel${citN > 1 ? 's' : ''}` : ''}${bossN ? ` · ☠ ${bossN}` : ''}${deepN ? ` · ☢ ${deepN} deep` : ''}</span></div>
        ${owned.length === 0 ? '<p style="font-size:12px;color:var(--muted);margin-top:6px">Claim tiles on the map to start generating Galaxy Resources every hour — citadels pay ' + GM.CITADEL_RATE_MULT + '×.</p>' : ''}
        <div class="sheet-actions"><button class="btn" data-x>Close</button><button class="btn primary" data-ok>⌂ Dock</button></div></div>`);
      sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
      sheet.querySelector('[data-ok]').addEventListener('click', () => { closeSheet(); G.selectDungeon(0); showScreen('battle'); });
      return;
    }
    const typeName = t.citadel ? '⛴ CITADEL SIEGE ZONE' : t.boss ? '☠ Boss Tile' : t.resource ? (GM.RES[t.resource].glyph + ' Resource Field') : 'Combat Sector';
    // KAEVITH INCURSION — an invaded zone fights differently. Ownership does not change.
    // Rendered to 2dp, not rounded to whole percent: the rate starts at 0.8% on
    // ring 1, and Math.round() turned every inner-ring tile into "0%". Read through
    // GAME.xenChanceNow so the tile sheet shows the odds the roll will actually
    // use, dry-streak escalator included (see xenChanceNow in game-v93).
    const xenBase = (t.alien && !t.void) ? (G.xenChanceNow ? G.xenChanceNow(t.ring) : (GM.alienChance ? GM.alienChance(t.ring) : 0)) : 0;
    const xenPct = xenBase * 100;
    const xenChance = xenPct ? (xenPct >= 1 ? (Math.round(xenPct * 10) / 10) : (Math.round(xenPct * 100) / 100)) : 0;
    // EMPIRE AT CAPACITY — explain the block BEFORE the pilot taps a dead button.
    // Only relevant on a tile you don't already hold; redeploying to your own is
    // never capped.
    const atCap = !t.owned && G.atTileCap && G.atTileCap();
    const capNow = G.tileCap ? G.tileCap() : 50;
    // THE LEVEL BAND, read from the same place warp() reads it. `t.locked` is the
    // map's colour rule and lets an OWNED tile through; warp() does not. That gap
    // is exactly what an ascension opens up — Lv 1 pilot, Lv 370 systems still
    // held — and it was showing a live button that silently refused.
    const tooHigh = t.deployLocked != null ? !!t.deployLocked : !!t.locked;
    const needLv = t.deployNeedLv || Math.max(1, t.level - 10);
    const myLv = (G.state.level | 0) || 1;
    const capBlock = atCap ? `<div class="cap-warn">
      <div class="cw-h"><span>◈</span> EMPIRE AT CAPACITY — ${capNow}/${capNow} SYSTEMS</div>
      <div class="cw-b">You hold every system you have room for, so you can't claim <b>${t.name}</b> yet. This is a hard cap on how many systems one pilot can own — not a cooldown, and not a level gate. It won't clear on its own.</div>
      <div class="cw-b">Free a slot by <b>abandoning</b> a system you already hold: open it from the map and tap <b>⏏ Abandon tile</b>. You keep everything it has already paid you — you give up its hourly production, its citadel if it has one, and it returns to neutral for anyone to claim.</div>
      <button class="cw-btn" data-cap-help>⏏ Free up a slot — show my systems</button>
    </div>` : '';const xenBlock = (t.alien && !t.void) ? `<div class="xen-tile">
      <div class="xt-h"><span class="xt-g">◈</span> KAEVITH-HELD ZONE</div>
      <div class="xt-b">Every hostile here flies a Kaevith hull — <b>+35% hull, +22% damage</b> over this ring's normal garrison. Ownership, citadels and cooldowns work exactly as anywhere else.</div>
      <div class="xt-r"><span>◈ Chance to earn a hull on clear</span><b>${xenChance}%</b></div>
      <div class="xt-r"><span>◈ Which hull</span><b>${xenPick(t.ring)}</b></div>
    </div>` : '';
    const owner = t.owned ? 'You' : (t.rival || 'Unclaimed');
    const ownerCol = t.owned ? '#5fa8ff' : (t.rival ? '#e8a34a' : '#7fb4ff');
    let ratePerH = t.rate ? t.rate * (t.deep ? GM.DEEP_MULT.resource : 1) : 0;
    // MIRROR resourceRates(): your citadel multiplies the tile, then the global
    // ×25 galaxy yield — EARNING NOW always matches what actually deposits
    // (and updates live after a citadel build or rank-up)
    const _cit = (G.state.citadels && G.state.citadels[id]) || null;
    if (ratePerH && _cit && !t.void) ratePerH *= 10 * (_cit.lv || 1);   // PLAYER CITADEL — 10× per rank (matches CITADEL_MULT; VOID premium is baked into t.rate)
    if (ratePerH) ratePerH *= 25;
    const cdTxt = t.cooldown > 0 ? (t.cooldown >= 3600 ? Math.floor(t.cooldown / 3600) + 'h ' + Math.floor((t.cooldown % 3600) / 60) + 'm' : fmtCd(t.cooldown)) : null;
    const blocked = !t.owned && t.cooldown > 0;
    // NO EXPOSED BORDER, NO SIEGE. An enabled button that always refuses is the
    // dead-button trap this sheet has been bitten by before, so a sealed system
    // says so ON the button and does not offer the tap. Allied space is excluded:
    // it has its own banner and its own reason.
    const sealed = !t.owned && !t.ally && !!(t.shield && t.shield.shielded);
    const action = t.ally ? '⬡ Allied' : t.owned ? 'Deploy' : t.rival ? (t.citadel ? 'Siege' : 'Attack') : (t.citadel ? 'Siege' : 'Capture');
    const obj = t.ally ? '<b style="color:#7ce0a0">⬡ ALLIED TERRITORY</b> — ' + (t.rival || 'a pilot') + ' is in your alliance. Allied systems can never be attacked.'
      : t.owned ? (t.boss || t.citadel ? 'Farm endless boss waves on your tile' : 'Farm your territory')
      : (t.defense && t.rivalCitadelScore != null) ? 'Break the escort, defeat <b style="color:#ffce8a">' + t.defense.name + "'s clone fleet</b>, then <b style='color:#ff8a64'>raze their citadel</b> to take the zone"
      : t.defense ? 'Break the escort, then defeat <b style="color:#ffce8a">' + t.defense.name + "'s clone fleet</b> to take the zone"
      : t.citadel ? 'Fight up through the garrison — the Void Citadel <b style="color:#ffd24d">surrenders intact</b>: fortress, output and all become yours (no builds needed here)'
      : t.boss ? 'Clear 10 waves, then defeat the <b style="color:var(--hp)">BOSS</b>' : 'Clear 10 waves to capture';
    const ec = G.entryCostFor ? G.entryCostFor(id) : null;
    // BIG VALUE HERO — what this tile pays per hour, with every multiplier spelled out
    const valChips = [];
    if (t.citadel) valChips.push('⛴ CITADEL ×' + GM.CITADEL_RATE_MULT + ' vs a resource field');
    if (t.deep) valChips.push('☢ DEEP SPACE ×' + GM.DEEP_MULT.resource);
    if (t.rarity) valChips.push(t.rarity === 2 ? '★★ RARE' : '★ UNCOMMON');
    if (_cit && !t.void) valChips.push('⛓ YOUR CITADEL ×' + (10 * (_cit.lv || 1)));
    const valueBlock = ratePerH ? `<div class="gx-value" style="--vc:${GM.RES[t.resource].color}">
      <div class="gxv-k">${t.owned ? '▸ EARNING NOW' : 'VALUE IF HELD'}</div>
      <div class="gxv-n">${GM.RES[t.resource].glyph} ${G.formatNum(ratePerH)}<i>${GM.RES[t.resource].name} / hour</i></div>
      ${valChips.length ? '<div class="gxv-chips">' + valChips.map((c) => '<span>' + c + '</span>').join('') + '</div>' : ''}
      <div class="gxv-sub">${t.owned ? 'auto-deposited to your Galaxy Resources every hour you hold it' : 'capture &amp; hold — pays automatically every hour'}</div>
    </div>` : '';
    const myRes = G.getResources ? G.getResources() : {};
    const ecAfford = !ec || GM.RES_KEYS.every((k2) => (myRes[k2] || 0) >= (ec[k2] || 0));
    const ecRow = ec ? `<div class="ip-stat"><span class="ip-sname">Entry cost</span><span class="v">${GM.RES_KEYS.filter((k2) => ec[k2]).map((k2) => `<span style="color:${(myRes[k2] || 0) >= ec[k2] ? GM.RES[k2].color : 'var(--bad)'}">${GM.RES[k2].glyph} ${G.formatNum(ec[k2])}</span>`).join(' ')}${t.owned ? ' <span style="color:var(--muted-2)">(½ — your territory)</span>' : ''}</span></div>` : '';
    let actionLabel = action;
    // Compact cost for the above-the-fold decision bar: glyphs only, no labels.
    const ecBrief = ec
      ? GM.RES_KEYS.filter((k2) => ec[k2]).map((k2) =>
          `<span style="color:${(myRes[k2] || 0) >= ec[k2] ? GM.RES[k2].color : '#ff8a96'}">${GM.RES[k2].glyph}${G.formatNum(ec[k2])}</span>`).join(' ') || 'Free'
      : 'Free';
    if (t.rivalCitadelScore != null && !t.owned) actionLabel = '⚔ Siege Citadel';
    let citBlock = '';
    if (t.myCitadel) {
      const clv = G.citadelLevel ? G.citadelLevel(id) : 1;
      const cmax = 5, cmult = 10 * clv;
      const uc = G.citadelUpgradeCost ? G.citadelUpgradeCost(id) : null;
      const pips = Array.from({ length: cmax }, (_, i) => '<span style="width:14px;height:5px;border-radius:3px;background:' + (i < clv ? '#ffd24d' : 'rgba(255,210,77,.18)') + '"></span>').join('');
      let upgRow = '';
      if (uc) {
        const uaf = GM.RES_KEYS.every((k2) => (myRes[k2] || 0) >= (uc[k2] || 0));
        const uchips = GM.RES_KEYS.filter((k2) => uc[k2]).map((k2) => '<span style="color:' + ((myRes[k2] || 0) >= uc[k2] ? GM.RES[k2].color : 'var(--bad)') + '">' + GM.RES[k2].glyph + ' ' + G.formatNum(uc[k2]) + '</span>').join(' &nbsp; ');
        upgRow = '<div style="font-size:12.5px;font-variant-numeric:tabular-nums;margin:7px 0;font-weight:700">' + uchips + '</div>' +
          '<button class="btn gold" data-upg-cit="' + id + '" ' + (uaf ? '' : 'disabled') + ' style="width:100%">⬆ Rank Up → ' + (clv + 1) + ' · ' + (10 * (clv + 1)) + '× output</button>';
      } else {
        upgRow = '<div style="font-size:11px;color:#7ce0a0;margin-top:6px;text-align:center;font-weight:700">★ MAX RANK — fully fortified</div>';
      }
      citBlock = '<div style="background:rgba(255,210,77,.06);border:1px solid rgba(255,210,77,.3);border-radius:10px;padding:9px 11px;margin-top:8px">' +
        '<div style="font-size:12px;font-weight:700;color:#ffd24d;display:flex;justify-content:space-between;align-items:center;gap:8px">⛓ Your Citadel · Rank ' + clv + '/' + cmax + '<span style="display:inline-flex;gap:3px">' + pips + '</span></div>' +
        '<div style="font-size:11px;color:#9fb0c4;margin-top:5px">' + cmult + '× resource output · +' + (25 * (clv - 1)) + '% defense fleet' + (clv < cmax ? ' · each rank makes it costlier for rivals to raze' : '') + '</div>' +
        upgRow +
      '</div>';
    } else if (t.defense) {
      // ⛨ DEFENDING FLEET — the owner's clone garrison, shown BEFORE you attack
      const d = t.defense, sn = d.snap || {};
      const shipImg = sn.ship ? '<img src="ships/ship-' + sn.ship + '.png" alt="" style="width:56px;height:40px;object-fit:contain;flex:none;filter:drop-shadow(0 0 8px rgba(255,206,138,.6))">' : '';
      const statBits = [];
      if (sn.lvl) statBits.push('Lv ' + sn.lvl);
      statBits.push('⚡ ' + G.formatNum(d.score) + ' fleet score');
      if (sn.hp) statBits.push('~' + G.formatNum(sn.hp) + ' hull');
      if (sn.dps) statBits.push('~' + G.formatNum(sn.dps) + ' DPS');
      if (sn.esc) statBits.push(sn.esc + ' escort' + (sn.esc > 1 ? 's' : ''));
      // MATCHUP FORECAST — true-power odds, published before you commit
      let odds = '';
      try {
        const mu = G.cloneMatchup(d.score);
        const r = mu.ratio, mult = r >= 2 ? Math.round(r) + '×' : Math.round(r * 100) + '%';
        const col = mu.outmatched ? '#ff6b78' : r < 0.75 ? '#7ce0a0' : '#ffd24d';
        const verdict = mu.outmatched
          ? 'They out-power you (' + mult + ') — <b>you will lose this fight</b>'
          : r < 0.75 ? 'You out-power them (' + mult + ' of yours) — <b>you should win</b>'
          : 'Evenly matched (' + mult + ') — <b>decided by flying</b>';
        odds = '<div style="margin-top:8px;font-size:11px;line-height:1.5;color:' + col + '">⚔ ' + verdict + '</div>';
      } catch (e) {}
      const dAsc = (d.snap && (d.snap.asc | 0)) || (d.asc | 0);
      const dBadge = (dAsc && window.PASCEND) ? ' ' + window.PASCEND.badge(null, dAsc) : '';
      citBlock = '<div style="background:rgba(255,140,90,.07);border:1px solid rgba(255,140,90,.35);border-radius:10px;padding:9px 11px;margin-top:8px">' +
        '<div style="font-size:11px;font-weight:800;letter-spacing:.08em;color:#ff9a70">⛨ DEFENDING FLEET — ' + d.name.toUpperCase() + dBadge + '</div>' +
        '<div style="display:flex;align-items:center;gap:10px;margin-top:7px">' + shipImg +
          '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:800;color:#ffce8a">' + (sn.nm || 'Clone Fleet') + (sn.approx ? ' <span style="opacity:.55;font-size:10px;font-weight:700">· scouted fleet</span>' : '') + '</div>' +
          '<div style="font-size:11px;color:#c9b39a;line-height:1.45">' + statBits.join(' · ') + '</div></div></div>' +
        '<div style="font-size:11px;color:#9fb0c4;margin-top:7px">A <b style="color:#ffce8a">clone of their fleet</b> garrisons this zone — beat it' + (d.citadel ? ', <b style="color:#ff8a64">then raze their citadel (Rank-hardened)</b>,' : '') + ' to take the tile.</div>' +
      '</div>';
    } else if (t.owned && t.citadel) {
      citBlock = '<div style="background:rgba(255,210,77,.06);border:1px solid rgba(255,210,77,.3);border-radius:10px;padding:9px 11px;margin-top:8px">' +
        '<div style="font-size:12px;font-weight:700;color:#ffd24d">⛴ Natural Citadel — captured intact</div>' +
        '<div style="font-size:11px;color:#9fb0c4;margin-top:5px">Its ×' + GM.CITADEL_RATE_MULT + ' output — measured against a resource field on this ring — is built into the fortress. Nothing to build or rank up here, and the figure above is what actually deposits.</div>' +
      '</div>';
    } else if (t.owned && G.citadelBuildCost) {
      const bc = G.citadelBuildCost(id), cn = G.citadelCount ? G.citadelCount() : 0;
      const af = bc && GM.RES_KEYS.every((k2) => (myRes[k2] || 0) >= (bc[k2] || 0));
      const can = G.canBuildCitadel && G.canBuildCitadel(id);
      const chips = GM.RES_KEYS.filter((k2) => bc && bc[k2]).map((k2) => '<span style="color:' + ((myRes[k2] || 0) >= bc[k2] ? GM.RES[k2].color : 'var(--bad)') + '">' + GM.RES[k2].glyph + ' ' + G.formatNum(bc[k2]) + '</span>').join(' &nbsp; ');
      citBlock = '<div style="background:rgba(255,210,77,.06);border:1px solid rgba(255,210,77,.3);border-radius:10px;padding:9px 11px;margin-top:8px">' +
        '<div style="font-size:12px;font-weight:700;color:#ffd24d;display:flex;justify-content:space-between;gap:8px">⛓ Build Citadel <span style="color:#9fb0c4;font-weight:600">10× output · ' + cn + ' built</span></div>' +
        '<div style="font-size:12.5px;font-variant-numeric:tabular-nums;margin:7px 0;font-weight:700">' + chips + '</div>' +
        '<button class="btn gold" data-build-cit="' + id + '" ' + (can && af ? '' : 'disabled') + ' style="width:100%">Build Citadel</button>' +
      '</div>';
    }
    // —— CITADEL RANK BANNER —— the loudest thing in the sheet. A fortress and
    // its RANK change every number below it (output ×10/rank, defence +25%/rank,
    // 100× warp cost), and the rank used to appear nowhere at all on a rival's
    // tile. Big numeral, five pips, one line on what the rank buys.
    const cr = t.cit;
    let citHero = '';
    if (cr) {
      const known = cr.lv > 0;
      const kindTxt = cr.kind === 'mine' ? 'YOUR CITADEL' : cr.kind === 'rival' ? 'ENEMY CITADEL' : cr.owned ? 'NATURAL CITADEL · YOURS' : 'UNCLAIMED FORTRESS';
      const pips = Array.from({ length: cr.max }, (_, i) =>
        `<i class="${known && i < cr.lv ? 'on' : ''}"></i>`).join('');
      const meta = cr.kind === 'natural'
        ? `Full-strength fortress — pays <b>×${G.formatNum(cr.mult)}</b> a resource field, included with the tile`
        : known
          ? `Output <b>×${cr.mult}</b> · defence <b>+${cr.def}%</b>${cr.kind === 'rival' ? ' for ' + cr.owner : ''}`
          : `Rank unknown — <b>${cr.owner || 'the holder'}</b> has not reported it. Expect Rank 1–${cr.max}.`;
      citHero = `<div class="cit-hero ${cr.kind}">
        <div class="ch-badge"><span class="ch-ic">⛓</span><span class="ch-lv">${known ? cr.lv : '?'}</span><span class="ch-of">/ ${cr.max}</span></div>
        <div class="ch-m"><div class="ch-k">${kindTxt}</div>
          <div class="ch-t">${known ? 'RANK ' + cr.lv : 'RANK UNKNOWN'}</div>
          <div class="ch-pips">${pips}</div>
          <div class="ch-s">${meta}</div></div>
      </div>`;
    }
    const sheet = showSheet(`<div class="sheet-head">${t.rival ? 'Contest' : t.owned ? 'Your Tile' : 'Claim'} · ${t.name}</div><div class="sheet-body">
      ${citHero}
      <div class="tile-brief">
        <div class="tb-cell cost${!ecAfford ? ' bad' : ''}"><div class="tb-k">WARP COST</div><div class="tb-v">${ecBrief}</div></div>
        <div class="tb-cell${t.deep ? ' warn' : ''}"><div class="tb-k">GARRISON</div><div class="tb-v">Zone Lv ${t.diff}</div></div>
        ${atCap
          ? `<div class="tb-cell bad full"><div class="tb-k">BLOCKED</div><div class="tb-v">Empire full — ${capNow}/${capNow} systems</div></div>`
          : blocked
            ? `<div class="tb-cell warn full"><div class="tb-k">SHIELDED</div><div class="tb-v">Opens in ${cdTxt}</div></div>`
            : tooHigh
              ? `<div class="tb-cell bad full"><div class="tb-k">${t.owned ? 'OUT OF RANGE' : 'LOCKED'}</div><div class="tb-v">Needs Lv ${needLv}</div></div>`
              : t.alien && !t.void
                ? `<div class="tb-cell xen full"><div class="tb-k">◈ KAEVITH-HELD</div><div class="tb-v">${xenChance}% chance to earn a hull</div></div>`
                : ''}
      </div>
      ${valueBlock}
      ${xenBlock}
      <div class="ip-stat"><span class="ip-sname">Ring · Level</span><span class="v">Ring ${t.ring} · Lv ${t.level}${t.deep ? ' · ☢ DEEP SPACE' : ''}</span></div>
      <div class="ip-stat"><span class="ip-sname">Type</span><span class="v">${typeName}${t.rarity ? ' · ' + (t.rarity === 2 ? '★★ Rare' : '★ Uncommon') : ''}</span></div>
      <div class="ip-stat"><span class="ip-sname">Owner</span><span class="v" style="color:${ownerCol}">${owner}</span></div>
      <div class="ip-stat"><span class="ip-sname">Enemy difficulty</span><span class="v">Zone Lv ${t.diff}</span></div>
      <div class="ip-stat"><span class="ip-sname">Loot quality</span><span class="v">×${t.lootQ}${t.deep ? ' (deep space)' : ''}</span></div>
      ${ecRow}
      ${cdTxt && !t.owned ? `<div class="gx-shield">🛡 <b>ATTACK SHIELD</b> — this tile was attacked recently. Nobody can attack it again for <b>${cdTxt}</b>.</div>` : ''}
      ${cdTxt && t.owned ? `<div class="gx-shield mine">🛡 <b>PROTECTED</b> — your tile can't be attacked for <b>${cdTxt}</b>.</div>` : ''}
      ${gxXynCard(t)}
      ${gxArteryCard(t)}
      ${gxShieldCard(t)}
      <div class="ip-stat"><span class="ip-sname">Status</span><span class="v">${cdTxt ? '◷ ' + (t.citadel ? 'Siege lockout ' : 'Attack shield ') + cdTxt : (tooHigh ? '🔒 Lv ' + needLv + ' required' : '⚔ Open to attack')}</span></div>
      <div class="ip-stat"><span class="ip-sname">Objective</span><span class="v">${obj}</span></div>
      ${citBlock}
      ${t.citadel && !t.owned ? '<p style="font-size:12px;margin-top:6px;color:#ffb088">⛴ Citadels pay <b>' + GM.CITADEL_RATE_MULT + '×</b> a normal tile — but warping in costs <b>' + GM.CITADEL_COST_MULT + '×</b> and sieges are limited to <b>once per day</b>.</p>' : ''}
      ${t.deep ? '<p style="color:var(--hp);font-size:11px;margin-top:6px">⚠ Deep space — you lose <b>2 items</b> on death, but loot & resources are vastly richer.</p>' : ''}
      ${!ecAfford ? '<p style="color:var(--bad);font-size:11px;margin-top:6px">Not enough Galaxy Resources to warp this deep — farm or capture closer rings first.</p>' : ''}
      ${t.owned ? '<div style="background:rgba(255,73,95,.05);border:1px solid rgba(255,73,95,.28);border-radius:10px;padding:8px 11px;margin-top:8px"><div style="font-size:11px;font-weight:800;letter-spacing:.06em;color:#ff8a96">⏏ ABANDON THIS ZONE</div><div style="font-size:11px;color:#b08f96;line-height:1.45;margin-top:3px">Releases the tile back to neutral — you lose its hourly production' + (t.myCitadel ? ', <b style="color:#ff8a96">and your CITADEL here is scrapped</b> (no refund)' : '') + '. Anyone may claim it again.</div><button class="btn" data-abandon style="width:100%;margin-top:7px;border-color:rgba(255,73,95,.45);color:#ff8a96">⏏ Abandon tile' + (t.myCitadel ? ' + citadel' : '') + '</button></div>' : ''}
      ${capBlock}
      ${tooHigh ? `<div class="gx-lvgate">🔒 <b>${t.owned ? 'OUTSIDE YOUR LEVEL BAND' : 'TOO DEEP FOR YOU'}</b> — this system is <b>Lv ${t.level}</b> and you are <b>Lv ${myLv}</b>. A pilot can fly up to <b>10</b> levels above themselves, so it opens again at <b>Lv ${needLv}</b>.${t.owned ? ' You keep it and it keeps paying its hourly production the whole time — nothing is lost by waiting.' : ''}</div>` : ''}
      <div class="sheet-actions"><button class="btn" data-x>Close</button><button class="btn ${t.owned ? 'primary' : 'gold'}" data-ok ${(sealed || blocked || tooHigh || !ecAfford || atCap) ? 'disabled' : ''}>${sealed ? '🛡 SEALED' : atCap ? '◈ At capacity — ' + capNow + '/' + capNow : blocked ? '◷ ' + cdTxt : tooHigh ? '🔒 Needs Lv ' + needLv : actionLabel}</button></div></div>`);
    const ch = sheet.querySelector('[data-cap-help]');
    if (ch) ch.addEventListener('click', () => { closeSheet(); openTileCapSheet(id); });
    const ab = sheet.querySelector('[data-abandon]');
    if (ab) ab.addEventListener('click', () => {
      if (!ab.dataset.arm) { ab.dataset.arm = '1'; ab.textContent = '⚠ TAP AGAIN TO CONFIRM — this cannot be undone'; ab.style.background = 'rgba(255,73,95,.15)'; return; }
      const r = G.abandonTile(id);
      if (r.ok) { closeSheet(); toast('⏏ ' + t.name + ' abandoned — the zone is neutral again', '#e8a34a'); renderGalaxy(); }
      else toast('This zone cannot be abandoned', '#e23b4e');
    });
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    // ◎ THE WAY IN — fly the camera to a border system of the sealed core and open
    // it, so the next tap is the attack that opens the path.
    sheet.querySelectorAll('[data-gxdoor]').forEach((b) => b.addEventListener('click', () => {
      const nid = b.dataset.gxdoor;
      closeSheet();
      focusGalaxyTile(nid);
    }));
    sheet.querySelectorAll('[data-build-cit]').forEach((b) => b.addEventListener('click', () => {
      const r = G.buildCitadel(b.dataset.buildCit);
      if (r.ok) { toast('⛓ Citadel raised — this tile now pays 10×!', '#ffd24d'); renderGalaxy(); openTileAction(b.dataset.buildCit); }
      else toast(r.reason === 'resources' ? 'Not enough Galaxy Resources' : 'Cannot build here', '#e23b4e');
    }));
    sheet.querySelectorAll('[data-upg-cit]').forEach((b) => b.addEventListener('click', () => {
      const r = G.upgradeCitadel(b.dataset.upgCit);
      if (r.ok) { toast('⬆ Citadel Rank ' + r.lv + ' — now paying ' + (10 * r.lv) + '×!', '#ffd24d'); renderGalaxy(); openTileAction(b.dataset.upgCit); }
      else toast(r.reason === 'max' ? 'Already max rank' : r.reason === 'resources' ? 'Not enough Galaxy Resources' : 'Cannot rank up', '#e23b4e');
    }));
    const ok = sheet.querySelector('[data-ok]');
    if (ok) ok.addEventListener('click', () => {
      const r = G.warp(id);
      if (r.ok) { closeSheet(); toast((t.rival ? 'Attacking ' : t.owned ? 'Deploying to ' : 'Claiming ') + t.name, '#5b9cff'); showScreen('battle'); }
      else if (r.reason === 'tilecap') { closeSheet(); openTileCapSheet(id); }
      // THE REASON GOES IN THE SHEET, NOT INTO A TOAST UNDER IT. This branch used
      // to toast() — z-index 4, behind a z-index 50 backdrop — so a refused siege
      // looked like a dead button. Reported as "siege citadel not working", and it
      // was every action button on every sheet.
      else sheetNotice(sheet,
        r.reason === 'ally' ? '⬡ <b>Allied territory</b> — you can’t attack your own alliance.'
        : r.reason === 'abandoned' ? '✕ <b>You abandoned this system.</b> You can re-claim it in <b>' + abandHms(r.secs || 0) + '</b>.'
        : r.reason === 'cooldown' ? '🛡 <b>Attack shield</b> — this tile was contested recently. It opens in <b>' + (cdTxt || 'a little while') + '</b>.'
        : r.reason === 'interior' ? '🛡 <b>Protected core — no exposed border.</b> Every side of this system faces <b>' + esc(t.rival || 'its holder') + '</b>’s own space. Take one of the outer systems first'
            + ((r.doors && r.doors.length) ? ' — try <b>' + esc(((G.tileInfo(r.doors[0]) || {}).name) || r.doors[0]) + '</b>' : '') + '.'
        : r.reason === 'artery-chain' ? '◈ <b>The Artery is taken one system at a time.</b> You can only assault a system whose neighbour toward the mouth you already hold'
            + ((r.doors && r.doors.length) ? ' — take <b>' + esc(((G.tileInfo(r.doors[0]) || {}).name) || r.doors[0]) + '</b> first' : '')
            + '. The chain opens at <b>Lancet</b> and works inward.'
        : r.reason === 'locked' ? '🔒 <b>Lv ' + t.level + ' system — you are Lv ' + ((G.state.level | 0) || 1) + '.</b> A pilot can fly up to <b>10</b> levels above themselves, so this one opens at <b>Lv ' + needLv + '</b>.' + (t.owned ? ' It stays yours and keeps paying while you climb.' : '')
        : r.reason === 'resources' ? '⬢ <b>Not enough Galaxy Resources</b> to warp this deep — farm or capture closer rings first.'
        : r.reason === 'home' ? '⌂ The Home Citadel is neutral ground — there is nothing to fight here.'
        : '✕ <b>Cannot deploy here.</b>', '#ff8a96');
    });
  }
  // ==========================================================================
  // EMPIRE AT CAPACITY — the full explainer. A toast was too easy to miss for a
  // block that never clears on its own, so this is a sheet: what the cap is, how
  // to raise it, and a live list of your systems sorted cheapest-to-lose first,
  // each abandonable right here. `target` is the tile you were trying to take.
  // ==========================================================================
  function openTileCapSheet(target) {
    const cap = G.tileCap ? G.tileCap() : 50, held = G.tileCount ? G.tileCount() : 0;
    const tgt = target ? G.tileInfo(target) : null;
    const rows = Object.keys(G.state.ownedSystems || {})
      .map((k) => G.tileInfo(k)).filter((x) => x && !x.home)
      .sort((a, b) => (a.rate * (a.myCitadel ? 10 : 1)) - (b.rate * (b.myCitadel ? 10 : 1)))
      .slice(0, 12);
    const list = rows.map((x) => `<div class="cap-row" data-cap-tile="${x.id}">
      <div class="cr-m"><div class="cr-n">${x.name}${x.myCitadel ? ' <i>⛓ citadel</i>' : ''}</div>
      <div class="cr-s">Ring ${x.ring} · Lv ${x.level} · ${GM.RES[x.resource] ? GM.RES[x.resource].glyph + ' ' + G.formatNum(Math.round(x.rate * (x.myCitadel ? 10 : 1))) + '/hr' : 'no yield'}</div></div>
      <button class="cr-b">⏏ Abandon</button></div>`).join('');
    const sheet = showSheet(`<div class="sheet-head">◈ Empire at capacity</div><div class="sheet-body">
      <div class="cap-hero">
        <div class="ch-n">${held}<i>/${cap}</i></div>
        <div class="ch-l">SYSTEMS HELD · CAP REACHED</div>
      </div>
      <div class="cap-why">${tgt ? `You can't claim <b>${tgt.name}</b> because your empire is full.` : 'Your empire is full.'} A pilot can hold <b>${cap}</b> systems at once, and the cap never expires on its own.</div>
      <div class="lo-sect">Two ways to make room</div>
      <div class="cap-opt"><span class="co-n">1</span><div><b>Abandon a system you hold.</b> Frees a slot at once. You keep what it has produced; its citadel is scrapped.</div></div>
      <div class="cap-opt"><span class="co-n">2</span><div><b>Raise the cap with VIP.</b> Every VIP level adds <b>+5</b> permanent slots.</div></div>
      <div class="lo-sect">Your systems · lowest earners first</div>
      <p class="cap-hint">Each Abandon needs a second tap to confirm.</p>
      <div class="cap-list">${list || '<div class="cap-none">You hold no abandonable systems.</div>'}</div>
      <div class="sheet-actions"><button class="btn" data-x>Close</button>${tgt ? `<button class="btn gold" data-back>← Back to ${tgt.name}</button>` : ''}</div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    const bk = sheet.querySelector('[data-back]');
    if (bk) bk.addEventListener('click', () => { closeSheet(); openTileAction(target); });
    sheet.querySelectorAll('[data-cap-tile]').forEach((row) => {
      const btn = row.querySelector('.cr-b');
      btn.addEventListener('click', () => {
        if (!btn.dataset.arm) { btn.dataset.arm = '1'; btn.textContent = '⚠ Tap to confirm'; btn.classList.add('arm'); return; }
        const r = G.abandonTile(row.dataset.capTile);
        if (!r.ok) { toast('This system cannot be abandoned', '#e23b4e'); return; }
        toast('⏏ Slot freed — ' + (G.tileCount ? G.tileCount() : 0) + '/' + cap + ' systems', '#e8a34a');
        renderGalaxy();
        closeSheet();
        if (target) openTileAction(target); else openTileCapSheet(null);
      });
    });
  }

  // ---- classic ZONES list (free-play / farming any unlocked zone) ----------
  //
  // THIS LIST IS WINDOWED, AND THAT IS THE FIX FOR "the page goes unresponsive".
  // It used to build one row per zone from 1 to the frontier, in one HTML string,
  // on every render — and each row is a CSS-painted planet with four gradient
  // layers, a per-row scan of C.ENEMIES and a zoneBonuses() call. A pilot deep in
  // the game is at zone 700+, so that is ~750 heavy rows and roughly a megabyte
  // of markup rebuilt every time the screen is opened or refreshAll() fires while
  // it is open. The cost grows for ever with progress, which is exactly the shape
  // of the report: it gets worse the further you get, until the tab stops
  // answering. Nothing about the list needed all of it on screen at once.
  //
  // The window is anchored on where the pilot actually PLAYS (the recommended
  // zone and the zone they are standing in) and is never larger than Z_WINDOW
  // rows, whatever the shape of the save — an ascended pilot is Level 1 with a
  // frontier hundreds of zones deep, and that gap must not turn back into a
  // thousand-row list. ⏶ EARLIER and DEEPER › page it a chunk at a time, holding
  // the scroll position, and re-opening the screen lands back on the anchor.
  const Z_WINDOW = 120;
  let _zWin = 0, _zAnchor = 0;
  function renderZones() {
    const s = G.state, rec = G.recommendedZone();
    el['zones-sub'].textContent = 'Recommended: Zone ' + rec;
    const blockCap = C.zoneCap(s.highestDungeonReached);
    const top = Math.max(12, s.highestUnlocked + 3);
    // —— GALACTIC JOURNEY —— zones group into named GALAXIES (one per 10-zone
    // block, matching the gate cadence); each zone is a planet on a warp route
    // that stretches further and further from home.
    const GAL_NAMES = ['Azure Reach', 'Verdant Expanse', 'Ember Wastes', 'Violet Deep', 'Umbral Rift', 'Void Frontier', 'Primeval Drift', 'Eventide Abyss'];
    const GAL_HUES = [212, 152, 26, 276, 322, 196, 46, 258];
    const ROMAN = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
    const galInfo = (b) => {
      const i = b % GAL_NAMES.length, cyc = Math.floor(b / GAL_NAMES.length);
      return { name: GAL_NAMES[i] + (cyc ? ' ' + (ROMAN[cyc - 1] || (cyc + 1)) : ''), hue: GAL_HUES[i] };
    };
    const lyOf = (d) => Math.round(Math.pow(d, 1.6) * 3.2);
    // the window: anchored where you play, capped at Z_WINDOW rows, paged by hand
    const lowNeed = Math.min(rec > 0 ? rec : top, (s.currentDungeon | 0) > 0 ? s.currentDungeon : top, top);
    const autoFrom = Math.max(1, Math.min(lowNeed - 20, top - Z_WINDOW + 1));
    const from = Math.max(1, Math.min(_zWin || autoFrom, top));
    const to = Math.min(top, from + Z_WINDOW - 1);
    let html = '<div class="zj">';
    // ✦ THE EMBER CHOIR — event entry point, in the same slot the Kaevith banner
    // occupies on the galaxy map. Always tappable for the full briefing, and it
    // reports live resonance once a Choir hull is in the fleet.
    {
      const eb = G.emberBeaconBonus ? G.emberBeaconBonus() : null;
      const rate = G.emberRate ? G.emberRate() : 30;
      const cta = eb && eb.hulls ? '−' + Math.round(eb.cdCut * 100) + '% CD' : 'BRIEFING';
      html += `<button class="emb-banner" id="emb-open">
        <span class="eb-glyph">✦</span>
        <span class="eb-txt"><b>THE EMBER CHOIR</b><i>1 zone in ${rate} ends on a Choir hull · kill it for a chance to recover it and supercharge your ◉ beacon</i></span>
        <span class="eb-cta">${cta}</span>
      </button>`;
    }
    const safe = s.currentDungeon < 1;
    html += `<div class="zone-row safe ${safe?'active':''}" data-d="0">
        <div class="z-num" style="color:var(--hp)">⌂</div>
        <div class="z-meta"><div class="z-name" style="color:var(--hp)">Home Station</div>
          <div class="z-sub">Safe harbor · 0 ly · review &amp; refit your ship</div></div>
        <div class="z-go">${safe?'● DOCKED':'RETURN'}</div></div>`;
    let lastBlock = -1;
    if (from > 1) {
      html += `<button class="zj-earlier" id="z-earlier">⏶ EARLIER ZONES<i>Zones 1–${from - 1} are behind you · load ${Math.min(Z_WINDOW, from - 1)} more</i></button>`;
    }
    for (let d = from; d <= to; d++) {
      const gb = Math.floor((d - 1) / 10);
      if (gb !== lastBlock) {
        const gi = galInfo(gb);
        if (gb > 0 && lastBlock >= 0) {
          const delta = lyOf(gb * 10 + 1) - lyOf(gb * 10);
          html += `<div class="zj-warp">⟱ warp ${G.formatNum(delta)} ly deeper</div>`;
        }
        html += `<div class="zj-gal" style="--gh:${gi.hue}">
          <div class="zj-gal-name">✦ ${gi.name}</div>
          <div class="zj-gal-meta">Zones ${gb * 10 + 1}–${(gb + 1) * 10} · ≈ ${G.formatNum(lyOf(gb * 10 + 1))} light-years out${gb >= 5 ? ' · ☢ DEEP SPACE' : ''}</div>
        </div>`;
        lastBlock = gb;
      }
      const ghue = galInfo(gb).hue + (((d * 37) % 29) - 14); // per-planet hue drift
      // seeded surface-texture vars so every planet looks distinct
      const px1 = 18 + (d * 13) % 58, py1 = 22 + (d * 29) % 52;
      const px2 = 30 + (d * 41) % 50, py2 = 30 + (d * 17) % 55;
      const pba = -25 + (d * 47) % 50;
      const ptype = ['gas', 'rock', 'ice'][d % 3];
      const pvars = `--gh:${ghue};--ba:${pba}deg;--x1:${px1}%;--y1:${py1}%;--x2:${px2}%;--y2:${py2}%`;
      const locked = d > s.highestUnlocked, active = d === s.currentDungeon;
      const types = C.ENEMIES.filter((e) => d >= e.minDungeon), topType = types[types.length-1];
      const blocked = d > blockCap;
      const reqLv = G.zoneReqLevel ? G.zoneReqLevel(d) : Math.max(1, d - 20);
      const lockLabel = blocked ? '🔒 Clear Zone ' + (Math.floor((d - 1) / C.ZONE_BLOCK) * C.ZONE_BLOCK) : '🔒 Lv ' + reqLv;
      const bz = G.zoneBonuses(d);
      const wave = d % 11 === 0;
      const cit = G.isCitadelZone && G.isCitadelZone(d);
      const citCd = cit ? G.citadelCooldownLeft(d) : 0;
      // EMBER CHOIR — a Choir-claimed zone reads as its own encounter type, in the
      // same vocabulary as WAVE ZONE and CITADEL SIEGE. It names the hull, because
      // which hull garrisons a zone is fixed by depth and worth travelling for.
      const emb = G.isEmberZone && G.isEmberZone(d);
      const embT = emb ? (G.emberTierFor ? G.emberTierFor(d) : 1) : 0;
      const embName = emb ? ((C.SHIP_BY_KEY[(G.emberKeys ? G.emberKeys() : [])[embT - 1]] || {}).name || 'Choir hull') : '';
      const embPct = emb && G.emberChance ? (G.emberChance(d) * 100).toFixed(1) : '0';
      const bonus = (wave?`<span class="z-bon wave">◎ WAVE ZONE · 25 waves → boss</span>`:'') +
                    (emb?`<span class="z-bon emb">✦ EMBER CHOIR · ${embName} ends this zone · ${embPct}% to recover it</span>`:'') +
                    (cit?`<span class="z-bon cit">⛴ CITADEL SIEGE · raze the fortress</span>`:'') +
                    (citCd>0?`<span class="z-bon citcd">◷ rebuilds in ${fmtCd(citCd)}</span>`:'') +
                    (bz.density>1?`<span class="z-bon dens">☣ SWARM · ${bz.density}× density · endless waves · ⚠ junk loot</span>`:'') +
                    (bz.quality>1?`<span class="z-bon qual">✦ ${bz.quality}× loot quality</span>`:'');
      html += `<div class="zone-row ${active?'active':''} ${locked||citCd>0?'locked':''} ${d===rec?'rec':''} ${bz.prismatic||wave?'prismatic':''} ${wave?'wavezone':''} ${cit?'citzone':''} ${emb?'embzone':''}" data-d="${d}" data-cit-cd="${citCd>0?1:0}" style="${pvars}">
        <div class="z-orb ${ptype}${d % 5 === 0 ? ' ringed' : ''}${cit ? ' cit' : ''}${wave ? ' wav' : ''}${emb ? ' emb' : ''}"><span>${d}</span></div>
        <div class="z-meta"><div class="z-name">${zoneName(d)}${wave?' <span class="z-wtag">WAVE</span>':''}${bz.density>1?' <span class="z-wtag" style="background:rgba(226,59,78,.16);color:#ff8090;border-color:rgba(226,59,78,.5)">SWARM</span>':''}${cit?' <span class="z-ctag">CITADEL</span>':''}${emb?' <span class="z-etag">CHOIR</span>':''}</div>
          <div class="z-sub">${G.formatNum(lyOf(d))} ly · Lv ${G.formatNum(C.zoneCombatLevel(d))} mobs · ${topType.name}s</div>
          ${bonus?`<div class="z-bons">${bonus}</div>`:''}
          ${d===rec && !active ? '<span class="z-rec">★ RECOMMENDED</span>' : ''}</div>
        <div class="z-go">${locked ? lockLabel : citCd>0 ? '◷ ' + fmtCd(citCd) : active ? '● HERE' : (cit ? '⛴ BREACH' : wave ? '◎ ENTER' : (d===rec ? '★ DEPLOY' : 'DEPLOY'))}</div></div>`;
    }
    if (to < top) {
      const nxt = Math.min(top, to + Z_WINDOW);
      html += `<button class="zj-earlier zj-later" id="z-deeper">DEEPER ZONES ›<i>Zones ${to + 1}–${nxt}${nxt >= top ? ' · your frontier' : ''}</i></button>`;
    }
    html += '</div>';
    el['zones-body'].innerHTML = html;
    { const zb = document.getElementById('z-earlier'); if (zb) zb.addEventListener('click', () => { _zAnchor = from; _zWin = Math.max(1, from - Z_WINDOW); renderZones(); }); }
    { const zd = document.getElementById('z-deeper'); if (zd) zd.addEventListener('click', () => { _zAnchor = 0; _zWin = Math.min(top, to + 1); renderZones(); }); }
    { const ebtn = document.getElementById('emb-open'); if (ebtn) ebtn.addEventListener('click', () => openEmberBriefing()); }
    el['zones-body'].querySelectorAll('.zone-row:not(.locked)').forEach((row) => row.addEventListener('click', () => {
      const d = +row.dataset.d;
      const deploy = () => { G.selectDungeon(d); showScreen('battle'); };
      // HIGH-RISK WARNING — hostiles more than 5 PILOT LEVELS above you. This
      // used to compare zone² against the pilot's level, so the gap was always
      // thousands and the sheet interrupted every deploy past ~Zone 12.
      const eLv = C.zoneCombatLevel(d), pLv = G.state.level, gap = eLv - pLv;
      if (gap > 5) {
        const sheet = showSheet(`<div class="sheet-head">⚠ High-Risk Zone</div><div class="sheet-body">
          <p style="font-size:12.5px;line-height:1.6;margin:0 0 8px">Enemies in <b>${zoneName(d)}</b> are <b>Lv ${G.formatNum(eLv)}</b> — <b style="color:#ff6a78">${G.formatNum(gap)} levels above you</b> (you're Lv ${G.formatNum(pLv)}).</p>
          <p style="font-size:12px;line-height:1.6;color:#ffcf7a;margin:0">If you die out there you can <b>lose items forever</b>, and your active ship's <b>hull upgrades reset to Lv 1</b> — every resource spent on them is forfeit.</p>
          <div class="sheet-actions"><button class="btn" data-x>Stay Safe</button><button class="btn gold" data-ok>⚔ Deploy Anyway</button></div></div>`);
        sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
        sheet.querySelector('[data-ok]').addEventListener('click', () => { closeSheet(); deploy(); });
        return;
      }
      deploy();
    }));
    const recRow = el['zones-body'].querySelector('.zone-row.rec');
    // Expanding backwards must not throw the player back to ★ — hold the row that
    // was at the top of the window before the expansion.
    let held = null;
    if (_zAnchor) {
      held = el['zones-body'].querySelector('.zone-row[data-d="' + _zAnchor + '"]');
      _zAnchor = 0;
      if (held) el['zones-body'].scrollTop = Math.max(0, held.offsetTop - 8);
    }
    // always land CENTERED on the recommended zone, with a brief landing flash
    if (recRow && !held) {
      const zb0 = el['zones-body'];
      zb0.scrollTop = Math.max(0, recRow.offsetTop - Math.max(90, zb0.clientHeight * 0.38));
      recRow.classList.add('rec-land');
      setTimeout(() => recRow.classList.remove('rec-land'), 2000);
    }
    // floating "jump to ★" chip — appears whenever the recommended zone is off-screen
    if (recRow) {
      const jump = document.createElement('button');
      jump.className = 'zj-jump';
      jump.innerHTML = '★ RECOMMENDED';
      el['zones-body'].appendChild(jump);
      const zb = el['zones-body'];
      const syncJump = () => {
        const vis = recRow.offsetTop > zb.scrollTop - 20 && recRow.offsetTop < zb.scrollTop + zb.clientHeight - 60;
        jump.classList.toggle('show', !vis);
        jump.classList.toggle('up', recRow.offsetTop < zb.scrollTop);
      };
      zb.addEventListener('scroll', syncJump, { passive: true });
      jump.addEventListener('click', () => { zb.scrollTo({ top: Math.max(0, recRow.offsetTop - 90), behavior: 'smooth' }); });
      syncJump();
    }
  }

  // ==========================================================================
  // STORE
  // ==========================================================================
  const STORE_ICONS = {
    ship:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l5 6v7l-5 4-5-4V9z"/><path d="M12 3v18M7 9l-3 2 3 2M17 9l3 2-3 2"/></svg>',
    market:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-6 9 6-9 6z"/><path d="M3 9v7l9 5 9-5V9"/></svg>',
    speed:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></svg>',
    offline:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14a8 8 0 1 1-9.5-9.8A6.5 6.5 0 0 0 20 14z"/></svg>',
    cosmetics:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/></svg>',
  };
  // distinct top-down silhouettes per hull class (nose-up)
  const SHIP_ICONS = {
    Frigate:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c1.7 2.2 2.6 5.2 2.6 9.2l-.5 8.8h-4.2l-.5-8.8c0-4 .9-7 2.6-9.2z"/><path d="M9.5 12.5l-4.2 3 .7 2.6 3.6-2.1"/><path d="M14.5 12.5l4.2 3-.7 2.6-3.6-2.1"/></svg>',
    Cruiser:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5c1.9 1.6 2.9 4 2.9 7.6V19l-2.9-1.4L9.1 19v-6.4C9.1 9 10.1 6.6 12 5z"/><path d="M9.4 8.5V3.4"/><path d="M14.6 8.5V3.4"/><path d="M9.1 13.2l-4 2 .9 2.2 3.1-1.6"/><path d="M14.9 13.2l4 2-.9 2.2-3.1-1.6"/></svg>',
    Battleship:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l3.6 3.2v11.6L12 21l-3.6-3.2V6.2z"/><path d="M8.4 7.4H5.6v4.2h2.8"/><path d="M15.6 7.4h2.8v4.2h-2.8"/><path d="M10 4.4V2.2M12 4V2M14 4.4V2.2"/></svg>',
    Carrier:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c2.6 2 4.1 5.2 4.1 9.2V18l-4.1 2-4.1-2v-5.8C7.9 8.2 9.4 5 12 3z"/><path d="M12 8.5v8"/><circle cx="6.2" cy="13" r="1.1"/><circle cx="17.8" cy="13" r="1.1"/><circle cx="7.6" cy="18.2" r="1"/><circle cx="16.4" cy="18.2" r="1"/></svg>',
  };
  const MOD_LABEL = { dmgPct:'DMG', hpPct:'HP', critChance:'Crit', critDamage:'Crit Dmg', moveSpeed:'Move', atkSpeedPct:'Rate', multiShot:'Multi-Shot', lifeSteal:'Lifesteal', rangePct:'Range', regen:'Regen', dodge:'Dodge', armorPct:'Armor' };
  function storeHead(ico, title, right) { return `<div class="sec-head"><span class="sec-ic">${ico}</span><h3>${title}</h3>${right?`<span class="sec-right">${right}</span>`:''}</div>`; }
  // Unified Hangar segment header — shared by the "My Ship" (hero) view and the
  // store categories, so Ship + Store live under one tab.
  const HANGAR_TABS = [['ship','My Ship'],['ships','Ships'],['market','Market'],['pilot','Pilot'],['friends','Friends'],['alliance','Alliance'],['mail','Mail'],['board','Ranks']];
  const HT_ICON = {
    ship: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c3 2.5 4.5 6 4.5 10l2.5 3.5-3.5-.5c-1 1.6-2.2 2.8-3.5 4-1.3-1.2-2.5-2.4-3.5-4l-3.5.5L7.5 12C7.5 8 9 4.5 12 2z"/><circle cx="12" cy="10" r="1.6"/></svg>',
    ships: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l8 4 8-4"/><path d="M4 12l8 4 8-4"/><path d="M12 3l8 4-8 4-8-4z"/></svg>',
    market: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6h15l-1.5 9h-12z"/><path d="M6 6L5 3H2"/><circle cx="9" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/></svg>',
    pilot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c1.5-3.5 4.2-5 7.5-5s6 1.5 7.5 5"/></svg>',
    social: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8.5" r="3"/><path d="M2.8 19.5c1.2-3 3.5-4.5 6.2-4.5s5 1.5 6.2 4.5"/><circle cx="17" cy="9.5" r="2.4"/><path d="M16.4 15.2c2.3.3 4 1.7 4.9 4"/></svg>',
    friends: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8.5" r="3"/><path d="M2.8 19.5c1.2-3 3.5-4.5 6.2-4.5s5 1.5 6.2 4.5"/><circle cx="17" cy="9.5" r="2.4"/><path d="M16.4 15.2c2.3.3 4 1.7 4.9 4"/></svg>',
    alliance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4.5v9L12 20l-8-4.5v-9z"/><path d="M12 8.5l3.5 2v3.5L12 16l-3.5-2v-3.5z"/></svg>',
    board: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M8 21h8M12 17v4M6 4h12v5a6 6 0 0 1-12 0z"/><path d="M6 6H3v2a3 3 0 0 0 3 3M18 6h3v2a3 3 0 0 1-3 3"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  };
  function hangarTabsHTML(active) {
    const fleetMode = G && G.fleetShips && G.fleetShips().length > 0;
    return `<div class="store-cats">${HANGAR_TABS.map(([k,l]) => {
      const label = (k === 'ship' && fleetMode) ? 'My Fleet' : l;
      return `<button class="store-cat ${active===k?'active':''}" data-hangtab="${k}" aria-label="${label}"><span class="ht-ic">${HT_ICON[k]||''}</span><span class="ht-lbl">${label}</span></button>`;
    }).join('')}</div>`;
  }
  function wireHangarTabs(root) {
    root.querySelectorAll('[data-hangtab]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.hangtab;
      if (k === 'ship') { tapMyShip(); showScreen('hero'); }
      else if (k === 'board') { tapBoard(); showScreen('board'); }
      else if (k === 'market') { tapMarket(); storeCat = k; showScreen('store'); }
      else if (k === 'pilot') showScreen('pilot');
      else if (k === 'friends' || k === 'alliance') { if (window.SOCIAL && window.SOCIAL.setTab) window.SOCIAL.setTab(k); showScreen('social'); }
      else if (k === 'mail') showScreen('mail');
      else { if (k === 'ships') tapMyShip(); storeCat = k; showScreen('store'); }
    }));
  }
  function modSummary(m) {
    if (!m) return '';
    return Object.keys(m).map((k) => `<span class="mod-chip">+${m[k]}% ${MOD_LABEL[k] || k}</span>`).join('');
  }
  function resCostChips(rp) {
    return GM.RES_KEYS.filter((k) => rp[k]).map((k) => {
      const r = GM.RES[k];
      return `<span style="color:${r.color}">${r.glyph} ${G.formatNum(rp[k])}</span>`;
    }).join(' ');
  }
  // LootCoins join the build ledger — the two carrier apexes cost them alongside
  // the three raw resources. Same glyph and colour the rest of the game uses.
  const BUILD_RES = [['gold','●','#f2b24b'],['fuel','⬢','#5bc0ff'],['iron','◆','#d0a060'],['plasma','✦','#c07bff'],['prism','◭','#1fe3b2'],['credits','◈','#ffd66a']];
  function buildCostChips(cost, have) {
    return BUILD_RES.filter(([k]) => cost[k]).map(([k, g, c]) => {
      const ok = (have[k] || 0) >= cost[k];
      return `<span class="bc-chip ${ok ? '' : 'short'}" style="--cc:${c}"><span class="bc-g">${g}</span>${G.formatNum(cost[k])}</span>`;
    }).join('');
  }
  function megaCostHTML(c, big) {
    const row = [];
    const add = (col, gly, v) => { if (v) row.push('<span class="mega-c"><span style="color:' + col + '">' + gly + '</span> ' + G.formatNum(v) + '</span>'); };
    add('#f2a93c', '$', c.gold); add('#5bc0ff', '⬢', c.fuel); add('#d0a060', '◆', c.iron);
    add('#c07bff', '✦', c.plasma); add('#1fe3b2', '◭', c.prism);
    // LootCoins must wear the REAL coin mark here too. This row used to draw a
    // plain orange disc (◉), which reads as "some resource" and matches nothing
    // else in the game — every other price uses the hex-coin SVG.
    if (c.credits) row.push('<span class="mega-c">' + (window.lootCoinSVG ? lootCoinSVG(13) : window._lcIcon()) + ' ' + c.credits.toLocaleString() + '</span>');
    add('#ff5a6a', '◇', c.dreadCores);
    return '<span class="mega-cost' + (big ? ' big' : '') + '">' + row.join('') + '</span>';
  }
  // (unused since the unified shipCard — kept only because its span borders live grid code)
  // HARDPOINT CHIPS — only the mounts a hull actually HAS.
  // ⚔ cannons · ▲ fighter bays · ⊕ munitions · ⛨ hull · ◎ drone bays
  // A zero is never printed: "⚔0 ⊕0 ⛨2" on the Vanguard read as a broken ship
  // rather than a carrier that trades every gun for four launch bays. Fighter bays
  // had no chip at all, so the one thing that defines the class was invisible.
  // `hull` is the only mount every hull in the game has, so it always shows.
  const HP_MOUNTS = [
    ['weapons',         '⚔', 'cannon hardpoint'],
    ['fighterCapacity', '▲', 'fighter bay'],
    ['ammo',            '⊕', 'munitions slot'],
    ['hull',            '⛨', 'hull slot', true],
    ['drones',          '◎', 'drone bay'],
  ];
  function hardpointChips(ship, mode) {
    return HP_MOUNTS.map(([k, ic, label, always]) => {
      const n = ship[k] | 0;
      if (!n && !always) return '';
      const t = n + ' ' + label + (n === 1 ? '' : 's');
      if (mode === 'chip') return '<span class="lo-chip' + (k === 'drones' ? ' drone' : '') + '" title="' + t + '">' + ic + ' ' + n + (k === 'drones' ? ' bay' + (n === 1 ? '' : 's') : '') + '</span>';
      if (mode === 'tile') return '<span' + (k === 'drones' ? ' class="dr"' : '') + ' title="' + t + '">' + ic + n + '</span>';
      return ic + ' ' + n;
    }).filter(Boolean).join(mode === 'text' ? ' · ' : '');
  }
  function purchaseShipCard(key) {const ship = C.SHIP_BY_KEY[key];
    const cls = 'sc-' + ship.cls.toLowerCase();
    const layout = hardpointChips(ship, 'chip');
    const mods = modSummary(ship.mods);
    const owned = !!(G.state.ownedShips && G.state.ownedShips[key]);
    const active = G.state.ship === key;
    const lvl = G.state.level || 1, reqL = ship.purchase.reqLevel, price = ship.purchase.lc;
    let action = '', body = '';
    if (active) action = `<span class="ship-badge active">● ACTIVE</span>`;
    else if (owned) action = `<button class="ship-btn switch" data-ship-switch="${key}">Switch</button>`;
    else if (lvl < reqL) { action = `<span class="ship-badge locked">🔒</span>`; body = `<div class="ship-lock"><span class="lk-ic">🔒</span><span>Reach <b>account Level ${reqL}</b> to purchase — you're Level <b>${lvl}</b></span></div>`; }
    else { action = `<button class="ship-btn buy lcbuy" data-lc-final="${key}">${window._lcIcon()} ${price.toLocaleString()}</button>`; body = `<div class="ship-lock ready"><span class="lk-ic">◈</span><span>Available now · <b>${price.toLocaleString()} LootCoins</b></span></div>`; }
    let upg = '';
    if (owned && G.shipUpInfo) {
      const u = G.shipUpInfo(key); const tcol = (window.shipLvlColor ? window.shipLvlColor(u.level) : '#9aa7b8');
      upg = `<div class="ship-upg" style="display:flex;align-items:center;gap:9px;margin-top:9px;padding:9px 10px;background:#0f1623;border:1px solid ${tcol}55;border-radius:9px">
        <div style="width:24px;height:24px;flex:none;border-radius:6px;background:${tcol}22;border:1px solid ${tcol};display:grid;place-items:center;font-family:Orbitron,sans-serif;font-weight:800;font-size:11px;color:${tcol}">${u.level}</div>
        <div style="flex:1;min-width:0;font-size:10px;color:#46d27a;font-weight:700">+${u.bonus.dmg}% DMG · +${u.bonus.hp}% HP · +${u.bonus.rate}% Rate</div>
        ${u.maxed ? `<span style="font-family:Orbitron,sans-serif;font-weight:800;font-size:10px;color:${tcol}">MAX</span>` : `<button class="ship-btn" data-ship-upg="${key}" ${u.afford ? '' : 'disabled'} style="white-space:nowrap">⬆ <span style="color:#ffd24d">●</span> ${G.formatNum(u.cost.gold)} <span style="color:#c79bff">✦</span> ${G.formatNum(u.cost.plasma)}</button>`}
      </div>`;
    }
    return `<div class="ship-card ${cls} apex final ${active ? 'is-active' : ''}">
      <div class="ship-top">
        <div class="ship-ic ${cls}"><img class="ship-img" src="ships/ship-${key}.png" alt="" loading="lazy"></div>
        <div class="ship-meta"><div class="ship-name">${ship.name} <span class="apex-chip final">FINAL</span></div>
          <div class="ship-tag">${ship.cls} class · ${ship.tag}</div>
          <div class="ship-layout">${layout}</div></div>
        <div class="ship-act">${action}</div>
      </div>
      <div class="ship-desc">${ship.desc}</div>
      ${ship.perk ? `<div class="ship-perk">${ship.perk}</div>` : ''}
      ${mods ? `<div class="ship-mods">${mods}</div>` : ''}
      ${upg}
      ${body}
    </div>`;
  }
  // Compact ship-grid tile — thumbnail + light stats. Owned lights up blue,
  // unowned reads grey; tap opens the full detail sheet. Cuts the Ships tab
  // from a long scroll of big cards to a scannable grid.
  function tileState(key, ship) {
    const owned = !!(G.state.ownedShips && G.state.ownedShips[key]);
    if (G.state.ship === key) return 'active';
    return owned ? 'owned' : 'locked';
  }
  // A hull with a FLIGHT LICENCE (the Eternum) can be OWNED and still refuse to
  // launch. switchShip() returns false for both "not owned" and "not licensed",
  // so every switch site asks this what to say rather than shrugging.
  function flyBlockMsg(k) {
    const r = (G.canFlyShip ? G.canFlyShip(k) : { ok: true });
    if (r.ok || !r.need) return null;
    return r.need.map((n) => n.k === 'missions' ? (G.formatNum(n.want - n.have) + ' more successful missions')
      : n.k === 'cargo' ? (G.formatNum(n.want - n.have) + ' more cargo runs secured')
      : n.k === 'stars' ? ((n.want - n.have) + ' more ascension' + (n.want - n.have === 1 ? '' : 's'))
      : 'a Titan Sina in your hangar').join(' · ');
  }
  function switchFailToast(k) {
    const m = flyBlockMsg(k);
    toast(m ? '🔒 ' + C.SHIP_BY_KEY[k].name + ' needs ' + m : 'Cannot switch to that hull', '#e23b4e');
  }
  function tileBadge(key, ship) {
    const owned = !!(G.state.ownedShips && G.state.ownedShips[key]);
    if (owned) return '';
    // `unreleased` FIRST, ahead of every route-describing flag. Every line below
    // this one names a way to GET the hull; `unreleased` is the statement that no
    // way exists, so it has to win outright — a hull can legitimately carry both
    // (the Corvus is `celestial: true` because that drives its tier, aura and
    // plating, and `celestial` sat two checks above `unreleased`, so its tile
    // advertised "✦ Cargo Defense" and sent players to grind an event for a hull
    // that cannot drop). Ordering it last only worked for hulls whose sole route
    // flags were `build`/`megaCost`; first is the rule that keeps holding.
    if (ship.unreleased) return '◈ SOON';
    // A ROUTE, so it is named — same position as `unreleased` (ahead of every other
    // route flag) because a Tour hull can also be Dread- or Titan-class and would
    // otherwise be described by whichever generic flag came first.
    if (ship.tour) return '✦ Tour of Duty';
    if (ship.event === 'mech') return '⚙ Mech Foundry';
    // THE XYN — named before the generic `event` line, which would otherwise send
    // players to the Progenitor for a hull that only drops on Xyn Prime.
    if (ship.event === 'xyn') return '◈ Xyn Prime';
    if (ship.retired) return '◈ RETIRED';
    if (ship.event) return '❖ Progenitor';
    if (ship.celestial) return '✦ Cargo Defense';
    if (ship.alienTech) return '◈ Kaevith';
    if (ship.emberTech) return '✦ Choir';
    if (ship.missionShip) return '⌘ 1,000 Missions';
    if (ship.purchase) return `${window._lcIcon()}${(ship.purchase.lc || 0).toLocaleString()}`;
    // NAME THE ROUTE, not the verb. Two of the build hulls are gated on King of
    // the Hill crowns, and "⚒ Build" told a player nothing about where to go.
    if (ship.build) return ship.build.reqCrowns ? `👑 ${ship.build.reqCrowns} Crowns` : '⚒ Build';
    if (ship.megaCost) { const lv = G.state.level || 1; return lv >= (ship.reqLevel || 1) ? '◇ Acquire' : '🔒 Lv' + ship.reqLevel; }
    const st = G.shipBuyState ? G.shipBuyState(key) : {};
    if (st.unlocked) return ship.resPrice ? '✦ ' + G.formatNum(Object.values(ship.resPrice)[0] || 0) : '$ ' + G.formatNum(ship.price || 0);
    return '🔒 Z' + (ship.bpZone || '?');
  }
  function shipTile(key) {
    const ship = C.SHIP_BY_KEY[key];
    const stateCls = tileState(key, ship);
    const owned = stateCls !== 'locked';
    const active = stateCls === 'active';
    const lvl = (owned && G.shipUpInfo) ? G.shipUpInfo(key).level : 0;
    const badge = tileBadge(key, ship);
    // FULL-ROW SHOWCASE TILES — the apex hulls get the whole grid width.
    // The Aeternum sits ABOVE the Titan Sina (its config entry precedes it) and
    // wears the same pill with a lance-green identity instead of rainbow; the
    // Eternum sits ABOVE both in celestial blue and, uniquely, can be OWNED
    // while still un-flyable — so its tile states the licence.
    // The Titan Aquila joins them (609) — a Titan-class hull in a 3-up thumbnail
    // grid read as a mid-tier purchase. It reuses the Sina's tracer beams (it fires
    // the same full-spectrum tracers) with its own chip and callout.
    if (key === 'titansina' || key === 'aeternum' || key === 'eternum' || key === 'titanaquila' || key === 'corvus') {
      const aet = key === 'aeternum', etr = key === 'eternum';
      // The two fighter apexes share the portrait-art treatment (st-aql).
      const aql = key === 'titanaquila' || key === 'corvus', crv = key === 'corvus';
      const fly = (etr && G.canFlyShip) ? G.canFlyShip('eternum') : { ok: true };
      const beams = etr
        ? '<i class="etr-beam"></i><i class="etr-beam b2"></i><i class="etr-beam b3"></i><i class="etr-beam b4"></i><i class="etr-beam b5"></i><i class="etr-aura"></i>'
        : aet
        ? '<i class="aet-lance"></i><i class="aet-ring"></i><i class="aet-ring r2"></i>'
        : aql
        ? ''
        : '<i class="sina-beam"></i><i class="sina-beam b2"></i><i class="sina-beam b3"></i><i class="sina-beam b4"></i>';
      const chip = etr ? '<span class="apex-chip etr">CELESTIAL CLASS</span>'
        : aet ? '<span class="apex-chip aet">ASCENSION CLASS</span>'
        : crv ? '<span class="apex-chip etr">CELESTIAL CLASS · CARRIER</span>'
        : aql ? '<span class="apex-chip sina">TITAN CLASS · CARRIER</span>' : '<span class="apex-chip sina">FINAL CLASS</span>';
      const callout = etr
        ? '1.5× THE TITAN SINA · FIVE DEATH BEAMS · CELESTIAL AURA'
        : aet
        ? 'AN ARTIFICIAL WORLD · THE LANCE ALIGNS · THE LANE IS ERASED'
        : crv
        ? 'ELEVEN FIGHTER BAYS · 25 FITTED SLOTS · HALF SPEED'
        : aql
        ? 'FIVE CANNONS · SEVEN FIGHTER BAYS · 21 FITTED SLOTS'
        : '2× THE DREAD OMEGA · FULL-ZONE RANGE · RAINBOW TRACERS';
      // EVERY FIGURE HERE COMES OFF fly.need[].want, which canFlyShip reads from
      // the hull's own flyReq. These were literals ('/ 1,000', '/ 50') and the
      // star count disagreed with the gate by a factor of two, so the tile told
      // pilots ★50 while the licence wanted ★100.
      const lic = (etr && owned && !fly.ok)
        ? '<div class="etr-lic">🔒 LICENCE INCOMPLETE — ' + fly.need.map((n) => n.k === 'cargo' ? (G.formatNum(n.have) + ' / ' + G.formatNum(n.want) + ' cargo runs secured') : n.k === 'missions' ? (G.formatNum(n.have) + ' / ' + G.formatNum(n.want) + ' successful missions') : n.k === 'stars' ? ('★' + n.have + ' / ' + n.want) : 'Titan Sina required').join(' · ') + '</div>'
        : (etr && !owned ? '<div class="etr-lic">✦ Recovered only from an OMEGA CARGO V manifest — Cargo Defense</div>' : '');
      return `<button class="ship-tile st-sina ${etr ? 'st-etr ' : ''}${aet ? 'st-aet ' : ''}${aql ? 'st-aql ' : ''}${stateCls}" data-ship-tile="${key}">
        <div class="sts-art">
          ${beams}
          <img src="ships/ship-${key}.png" alt="" loading="lazy" decoding="async">
          ${active ? '<span class="st-flag">● ACTIVE</span>' : (owned && lvl ? `<span class="st-lvl">Lv ${lvl}</span>` : '')}
        </div>
        <div class="sts-meta">
          <div class="st-name">${ship.name} ${chip}</div>
          <div class="sts-callout">${callout}</div>
          ${lic}
          <div class="st-stats">${hardpointChips(ship, 'tile')}</div>
          ${owned ? '' : `<div class="st-badge">${badge}</div>`}
        </div>
      </button>`;
    }
    return `<button class="ship-tile ${stateCls}" data-ship-tile="${key}">
      <div class="st-thumb"><img src="ships/ship-${key}.png" alt="" loading="lazy">
        ${active ? '<span class="st-flag">● ACTIVE</span>' : (owned && lvl ? `<span class="st-lvl">Lv ${lvl}</span>` : '')}</div>
      <div class="st-name">${ship.name}</div>
      <div class="st-cls">${ship.cls}</div>
      <div class="st-stats">${hardpointChips(ship, 'tile')}</div>
      ${owned ? '' : `<div class="st-badge">${badge}</div>`}
    </button>`;
  }
  // ==========================================================================
  // HANGAR ▸ SHIPS — grouped by HULL CLASS.
  //
  // The tab used to be 42 tiles in one undifferentiated 3-up grid, which made a
  // Frigate and a Titan Sina look like the same kind of purchase and gave the
  // player no way to answer "what should I be flying?".
  //
  // `cls` is NOT cosmetic — it drives the escort weapon an escort fires
  // (ESCORT_WTYPE), the Aegis Warden-array multiplier, weapon mounting rules and
  // the in-game icon accent. So the grouping uses the REAL class, and the hero
  // band finally states what each class does, including the escort weapon, which
  // was previously undocumented anywhere in the game.
  //
  // Dread-class and Titan Sina are their own tiers here rather than being buried in
  // Carrier, which is where the player looks for them.
  // ==========================================================================
  // Seven DISPLAY TIERS. Dread and Titan are derived, not stored: `cls` drives real
  // gameplay (ESCORT_WTYPE, SHIP_ACCENT, Aegis Warden doubling, weapon mounting),
  // so a Dread hull stays cls:'Carrier' in CONFIG and fires railguns as an escort
  // exactly as before — only where it FILES in the hangar changes. `pick` runs in
  // order, first match wins, so Titan is tested before Dread and Dread before the
  // plain Carrier bucket.
  const SHIP_CLASSES = [
    { cls: 'Frigate', accent: '#5b9cff', pick: (s) => s.cls === 'Frigate',
      role: 'Fast, cheap, fragile — the hulls you learn the game in.',
      benefit: 'Highest speed per credit and the lowest upgrade costs. As an escort a Frigate fires <b>lasers</b>: fast, accurate, single-target.' },
    { cls: 'Cruiser', accent: '#46d07a', pick: (s) => s.cls === 'Cruiser',
      role: 'The all-rounder — real plating without losing manoeuvrability.',
      benefit: 'The first hulls that survive a boss without perfect play. As an escort a Cruiser fires <b>gatlings</b>: high rate of fire, best against packs.' },
    { cls: 'Battleship', accent: '#f0972a', pick: (s) => s.cls === 'Battleship',
      role: 'Heavy line hulls — built to trade hits and win.',
      benefit: 'Large hull pools and multi-weapon mounts, at the cost of speed. As an escort a Battleship fires <b>missiles</b>: slow, heavy, splash damage.' },
    { cls: 'Aegis', accent: '#7ce0a0', pick: (s) => s.cls === 'Aegis',
      role: 'The support hull — it keeps the rest of the fleet alive.',
      benefit: 'The <b>only</b> hull that mounts Warden arrays, at <b>double</b> their listed regen and damage reduction. As an escort an Aegis fires nothing — it pulses <b>repairs</b> instead.' },
    { cls: 'Super Fighter', accent: '#7cd4ff', pick: (s) => /^SUPER FIGHTER/.test(s.tag || ''),
      role: 'A class of one — above Celestial.',
      benefit: '<b>Twenty-two fighter bays</b>, double the Celestial Corvus, on the same combat sheet. The largest hull that flies and very nearly the slowest.' },
    // Key OR the CELESTIAL tag — the Corvus joined the tier in 611, and a hardcoded
    // key had already dropped the Aquila into plain Carrier once (609).
    { cls: 'Celestial', accent: '#5b7cff', pick: (s) => s.key === 'eternum' || /^CELESTIAL/.test(s.tag || ''),
      role: 'Celestial Class — the hulls that come after Titan.',
      benefit: 'One and a half times the Titan Sina on every line, five continuous <b>death beams</b> and a standing <b>celestial aura</b>. Recovered only from Space Cargo Defense, and it will not launch without the licence: 1,000 missions, ★50, and a Titan Sina in the hangar.' },
    // Matched from the TITAN- tag, not a single key: the Titan Aquila joined the
    // tier in 609 and a hardcoded key silently dropped it into plain Carrier.
    { cls: 'Titan', accent: '#ffd24d', pick: (s) => s.key === 'titansina' || /^TITAN/.test(s.tag || ''),
      role: 'Built to a scale nothing else in the game approaches.',
      benefit: 'Every stat line is an order above Dread-class. The <b>Sina</b> is pure gunship — full-zone range, full-spectrum tracers. The <b>Aquila</b> is the apex carrier: five cannons and seven fighter bays, twenty-one fitted slots. There is no upgrade path beyond either.' },
    // `megaCost` OR an explicit Dread tag — the Praetorian is Dread-class but has
    // no cost yet (unreleased), and picking on megaCost alone dropped it into the
    // plain Carrier bucket beside the Super Carrier.
    { cls: 'Dread', accent: '#ff4d6d', pick: (s) => !!s.megaCost || /^DREAD-CLASS/.test(s.tag || ''),
      role: 'Dread-class — the apex hulls, priced in Dread Cores rather than gold.',
      benefit: 'The heaviest weapon mounts and drone bays in the game. Every one is an endgame commitment: you buy these instead of upgrading, not as well as. As an escort a Dread fires <b>railguns</b>.' },
    { cls: 'Carrier', accent: '#b15cff', pick: (s) => s.cls === 'Carrier',
      role: 'Capital hulls with drone bays — they fight with a fleet of their own.',
      benefit: 'Drone bays add damage that needs no aiming and never stops. As an escort a Carrier fires <b>railguns</b>: piercing shots that punch through a whole line.' },
  ];
  // Display order on screen: the progression ladder, with the two specialist tiers
  // last. (SHIP_CLASSES order is MATCH priority, which is a different thing.)
  const SHIP_TIER_ORDER = ['Frigate', 'Cruiser', 'Battleship', 'Aegis', 'Carrier', 'Dread', 'Titan', 'Celestial', 'Super Fighter'];
  // AND NOTHING MAY BE DROPPED BY OMISSION FROM THAT LIST.
  //
  // SHIP_TIER_ORDER is display order; SHIP_CLASSES order is MATCH priority. They
  // are genuinely different orderings, so they cannot be one array — but that made
  // the second list a hand-maintained copy of the first list's names, and the Xyn
  // proved the failure: 'Super Fighter' was added to SHIP_CLASSES, its bucket was
  // built and filled, and then `SHIP_TIER_ORDER.map()` never asked for it. The
  // hull was in CONFIG, correctly classified, and simply absent from the Hangar.
  //
  // The orphan check below only catches a hull no class row PICKS. This catches a
  // class row the display order FORGETS — any tier missing from the order is
  // appended rather than lost, so adding a class can never again make hulls vanish.
  const SHIP_TIER_VIEW = SHIP_TIER_ORDER.concat(
    SHIP_CLASSES.map((m) => m.cls).filter((c) => SHIP_TIER_ORDER.indexOf(c) < 0));

  function shipRoster() {
    const owned = G.state.ownedShips || {};
    const flying = G.state.ship;
    // One pass, first match wins, so no hull can land in two tiers and none can be
    // silently dropped when a hull is added to CONFIG.
    const bucket = {};
    SHIP_CLASSES.forEach((m) => { bucket[m.cls] = { meta: m, list: [] }; });
    const orphans = [];
    C.SHIPS.forEach((s) => {
      const m = SHIP_CLASSES.find((x) => x.pick(s));
      if (m) bucket[m.cls].list.push(s); else orphans.push(s);
    });
    const groups = SHIP_TIER_VIEW.map((k) => bucket[k]).filter(Boolean);
    if (orphans.length) groups.push({ meta: { cls: 'Other', accent: '#8fa3bd', role: 'Hulls outside the standard class ladder.', benefit: 'These fall back to gatling escort fire.' }, list: orphans });

    // Sticky jump bar — one chip per tier. Every heading below is reachable, so no
    // second row is needed now that Dread and Titan are tiers in their own right.
    const live = groups.filter((g) => g.list.length);
    let out = '<div class="sc-jump">' + live.map((g) => {
      const have = g.list.filter((s) => owned[s.key]).length;
      const mine = g.list.some((s) => s.key === flying);
      return `<button class="scj ${mine ? 'flying' : ''}" data-scj="${g.meta.cls}" style="--ca:${g.meta.accent}">
        <b>${g.meta.cls}</b><span>${have}/${g.list.length}</span></button>`;
    }).join('') + '</div>';

    live.forEach((g) => {
      const have = g.list.filter((s) => owned[s.key]).length;
      const pct = Math.round(have / g.list.length * 100);
      const flyingHere = g.list.some((s) => s.key === flying);
      out += `<div class="sc-class" id="sc-${g.meta.cls}" style="--ca:${g.meta.accent}">
        <div class="sc-hero">
          <div class="sc-h-top">
            <div class="sc-h-name">${g.meta.cls}<em>class</em></div>
            <div class="sc-h-count"><b>${have}</b>/${g.list.length}${flyingHere ? '<i>● flying</i>' : ''}</div>
          </div>
          <div class="sc-h-role">${g.meta.role}</div>
          <div class="sc-h-benefit">${g.meta.benefit}</div>
          <div class="sc-h-bar"><i style="width:${pct}%"></i></div>
        </div>
        <div class="ship-grid">${g.list.map((s) => shipTile(s.key)).join('')}</div>
      </div>`;
    });
    return out;
  }

  function openShipDetail(key) {
    const sheet = showSheet(`<div class="sheet-head">${C.SHIP_BY_KEY[key].name}</div><div class="sheet-body ship-detail-sheet">${shipCard(key)}<div class="sheet-actions" style="margin-top:12px"><button class="btn" data-x>Close</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    sheet.querySelectorAll('[data-ship-switch]').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.shipSwitch; if (G.switchShip(k)) { toast('Now flying the ' + C.SHIP_BY_KEY[k].name, '#5bc06b'); closeSheet(); renderStore(); } else switchFailToast(k); }));
    sheet.querySelectorAll('[data-ship-buy]').forEach((b) => b.addEventListener('click', () => { closeSheet(); openShipBuy(b.dataset.shipBuy); }));
    sheet.querySelectorAll('[data-ship-upg]').forEach((b) => b.addEventListener('click', () => confirmHullUpgrade(b.dataset.shipUpg, () => { closeSheet(); renderStore(); })));
    sheet.querySelectorAll('[data-build-start]').forEach((b) => b.addEventListener('click', () => { closeSheet(); openBuildConfirm(b.dataset.buildStart); }));
    sheet.querySelectorAll('[data-lc-final]').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.lcFinal; closeSheet(); openShipLCBuy(k, (C.SHIP_BY_KEY[k].purchase || {}).lc); }));
    sheet.querySelectorAll('[data-mega-buy]').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.megaBuy; closeSheet(); openMegaBuy(k); }));
    sheet.querySelectorAll('[data-bp-hunt]').forEach((b) => b.addEventListener('click', () => { G.selectDungeon(+b.dataset.bpHunt); closeSheet(); showScreen('battle'); }));
    sheet.querySelectorAll('[data-go-sdread]').forEach((b) => b.addEventListener('click', () => { closeSheet(); showScreen('sdread'); }));
    sheet.querySelectorAll('[data-go-mech]').forEach((b) => b.addEventListener('click', () => { closeSheet(); showScreen('mech'); }));
    sheet.querySelectorAll('[data-go-galaxy]').forEach((b) => b.addEventListener('click', () => { closeSheet(); showScreen('galaxy'); }));
    sheet.querySelectorAll('[data-go-zones]').forEach((b) => b.addEventListener('click', () => { closeSheet(); showScreen('zones'); }));
    sheet.querySelectorAll('[data-go-tour]').forEach((b) => b.addEventListener('click', () => { closeSheet(); showScreen('tour'); }));
    sheet.querySelectorAll('[data-go-missions]').forEach((b) => b.addEventListener('click', () => { closeSheet(); showScreen('missions'); }));
    sheet.querySelectorAll('[data-go-alliance]').forEach((b) => b.addEventListener('click', () => { closeSheet(); if (window.SOCIAL && window.SOCIAL.setTab) window.SOCIAL.setTab('alliance'); showScreen('social'); toast('⬡ Monolith Shipyard is in the store below', '#7ff2e0'); }));
  }
  // ONE unified detail-sheet card for EVERY hull (Jul 2026): identical frame —
  // icon · name+chip · class line · layout chips · desc · mod chips · ONE status
  // strip · action. Only the status strip varies by acquisition (gold / LootCoin
  // / Dread-class / construction / event hull / mission reward).
  function shipCard(key) {
    const ship = C.SHIP_BY_KEY[key];
    const st = G.shipBuyState(key);
    const cls = 'sc-' + ship.cls.toLowerCase();
    const layout = hardpointChips(ship, 'chip');
    const mods = modSummary(ship.mods);
    let action = '', lock = '';
    if (st.active) action = `<span class="ship-badge active">● ACTIVE</span>`;
    else if (st.owned) action = `<button class="ship-btn switch" data-ship-switch="${key}">Switch</button>`;
    // UNRELEASED WINS THE WHOLE CHAIN, right after owned/active. Every branch below
    // describes a way to GET the hull — event parts, a Cargo manifest, a Kaevith
    // clear, a LootCoin price, a build order. `unreleased` says no way exists, so it
    // cannot sit in the middle: the Corvus carries `celestial: true` for its tier
    // and aura, and a later position let the Cargo Defense copy win. It also has to
    // precede the price fallthrough at the end, which would otherwise render a
    // "$ 0" buy button for a hull with no price at all.
    else if (ship.tour) {
      // The ladder that awards this hull is itself unlaunched (see the beta code
      // in js/redeem.js). Until it opens, the hull reads exactly like any other
      // unreleased one — no route, no button pointing at a screen that refuses to
      // open — and switches back to the real Tour copy the moment it does.
      const _tourOn = true;   // Tour of Duty LAUNCHED (build 659)
      if (_tourOn) {
        action = `<button class="ship-btn buy" data-go-tour="1">✦ Tour</button>`;
        lock = `<div class="ship-lock ready"><span class="lk-ic">✦</span><span>Earned on the <b>Tour of Duty</b> ladder — <b>level ${ship.tour.lv}</b> of the <b>${ship.tour.track}</b> track. Never sold, and no blueprint.</span></div>`;
      } else {
        action = `<span class="ship-badge locked">◈</span>`;
        lock = `<div class="ship-lock"><span class="lk-ic">◈</span><span><b>Not yet available.</b> This hull is finished and flight-ready — how you earn it is still being decided. It cannot be bought, built or earned at any price yet.</span></div>`;
      }
    }
    else if (ship.unreleased) {
      action = `<span class="ship-badge locked">◈</span>`;
      lock = `<div class="ship-lock"><span class="lk-ic">◈</span><span><b>Not yet available.</b> This hull is finished and flight-ready — how you earn it is still being decided. It cannot be bought, built or earned at any price yet.</span></div>`;
    }
    else if (ship.event === 'mech') {
      // THE MECH LINE — assembled in the Foundry from ⚙ Mech Cores + Galaxy
      // Resources, gated by a blueprint recovered on that hull's own tier.
      const M = window.MECHF;
      const src = (M && M.tiers) ? M.tiers().find((t) => t.bp === key) : null;
      const b = (M && M.BUILD) ? M.BUILD[key] : null;
      const bpHave = !!(G.state.blueprints && G.state.blueprints[key]);
      const haveC = Math.floor(Number(G.state.mechCores) || 0);
      const res = G.state.resources || {};
      const chips = b ? '<div class="bc-row">'
        + `<span class="bc-chip ${haveC >= b.cores ? 'ok' : ''}">⚙ ${G.formatNum(b.cores)}</span>`
        + Object.keys(b.res).map((r) => `<span class="bc-chip ${Math.floor(Number(res[r]) || 0) >= b.res[r] ? 'ok' : ''}">${G.formatNum(b.res[r])} ${r}</span>`).join('')
        + (b.lc ? `<span class="bc-chip ${Math.floor(Number(G.state.credits) || 0) >= b.lc ? 'ok' : ''}">◈ ${G.formatNum(b.lc)} LootCoins</span>` : '')
        + '</div>' : '';
      action = `<button class="ship-btn buy" data-go-mech="1">⚙ Foundry</button>`;
      lock = `<div class="ship-lock ${bpHave ? 'ready' : ''}"><span class="lk-ic">⚙</span><span>${bpHave
        ? 'Blueprint recovered — assemble it in the <b>Mech Foundry</b>.'
        : `Mech Foundry — the blueprint is yours on your <b>first clear</b> of the <b>${src ? src.name : 'top tier'}</b>${src ? ` (T${src.t}, Level ${src.lv})` : ''}.`}</span>${chips}</div>`;
    }
    else if (ship.retired) {
      // A CLOSED SEASON IS NOT A LOCKED ONE. Never show a part bar for a hull
      // that can no longer be assembled — the bar is a promise the event cannot
      // keep. Owners keep it; everyone else is told plainly that it is gone.
      action = '<span class="ship-badge locked">◈</span>';
      lock = '<div class="ship-lock"><span class="lk-ic">◈</span><span><b>Retired.</b> This hull was the grand prize of a closed season and can no longer be earned. Pilots who assembled one keep it.</span></div>';
    }
    else if (ship.event === 'sdread') {
      // THE PROGENITOR — assembled from event parts, never sold. The part count is
      // READ OFF THE EVENT, never restated: this card printed a hardcoded 100
      // while server-dreadnaught.js has required 150 since July, so a player could
      // fill the bar and still not own the hull.
      const need = (window.SDREAD && window.SDREAD.partsNeed) || 1000;
      // THE POOL KEY IS NOT THE HULL KEY. This read `shipParts[key]` — i.e.
      // shipParts['progenitor'], a pool nothing has ever written — so the card sat
      // at 0 / 1,000 no matter how many parts the pilot was actually holding. The
      // pool is the season-1 key, because that is the receipt every banked part
      // was written under. Requirement AND pool both come off the event now.
      const pk = (window.SDREAD && window.SDREAD.partsKey) || key;
      const have = Math.min(need, Math.floor(Number(G.state.shipParts && G.state.shipParts[pk]) || 0));
      action = `<button class="ship-btn buy" data-go-sdread="1">❖ Earn</button>`;
      lock = `<div class="ship-lock ready"><span class="lk-ic">❖</span><span>Event exclusive — <b>${have} / ${need}</b> Progenitor Parts, earned in the <b>Progenitor</b> world-boss event</span>
        <div class="lk-bar"><div class="lk-fill" style="width:${have / need * 100}%"></div></div></div>`;
    }
    else if (ship.event) {
      // AN EVENT HULL WITH NO CARD OF ITS OWN YET. This branch used to be the
      // BARE `ship.event` test that owned the Season 1 copy above, so every hull
      // carrying any `event` value advertised Voidmaw Parts, an Aug 31 deadline
      // and a button to the Server Dreadnaught screen — four wrong statements and
      // a wrong destination the moment a second event shipped. Name the route or
      // say nothing; never inherit another event's facts.
      action = `<span class="ship-badge locked">❖</span>`;
      lock = `<div class="ship-lock"><span class="lk-ic">❖</span><span>Event exclusive — earned only while its event is running.</span></div>`;
    } else if (ship.missionShip) {
      const need = ship.missionShip, have = Math.min(need, G.state.lifetimeMissions | 0);
      action = `<button class="ship-btn buy" data-go-missions="1">⌘ Missions</button>`;
      lock = `<div class="ship-lock ready"><span class="lk-ic">⌘</span><span>Mission reward — <b>${have.toLocaleString()} / ${need.toLocaleString()}</b> lifetime missions${have >= need ? ' · <b>accept it on the Mission Board</b>' : ''}</span>
        <div class="lk-bar"><div class="lk-fill" style="width:${Math.min(100, have / need * 100)}%"></div></div></div>`;
    } else if (ship.purchase && ship.purchase.lc) {
      action = `<button class="ship-btn buy" data-lc-final="${key}">${window.lootCoinSVG ? lootCoinSVG(13) : '◈'} ${ship.purchase.lc.toLocaleString()}</button>`;
      lock = `<div class="ship-lock ready"><span class="lk-ic">◈</span><span><b>${ship.purchase.lc.toLocaleString()} LootCoins</b> — instant unlock, no level gate</span></div>`;
    } else if (ship.megaCost) {
      action = st.unlocked ? `<button class="ship-btn buy" data-mega-buy="${key}">Acquire</button>` : `<span class="ship-badge locked">🔒</span>`;
      lock = `<div class="ship-lock ${st.unlocked ? 'ready' : ''}"><span class="lk-ic">◇</span><span>${st.unlocked ? 'Dread-class — paid in a mix of every currency' : `Dread-class · unlocks at <b>Level ${st.reqLevel}</b>`}</span></div>
        <div class="ship-lock" style="margin-top:6px">${megaCostHTML(ship.megaCost, true)}</div>`;
    } else if (ship.build) {
      const inf = G.buildShipInfo(key) || {};
      if (inf.status === 'needasc') {
        action = `<span class="ship-badge locked">🔒</span>`;
        lock = `<div class="ship-lock"><span class="lk-ic">✦</span><span>Requires <b>Ascension ★${inf.reqAsc}</b> — you are at <b>★${inf.ascHave | 0}</b>. No currency substitutes for prestige.</span><div class="bc-row">${buildCostChips(inf.cost, inf.have)}</div></div>`;
      } else if (inf.status === 'needcrowns') {
        // THE COUNT THE PLAYER CAN CHECK IS THE COUNT PRINTED HERE — lifetime
        // crowns from the server ledger, against the hull's own threshold.
        const pct = Math.min(100, (inf.crownsHave || 0) / (inf.reqCrowns || 1) * 100);
        action = `<span class="ship-badge locked">👑</span>`;
        lock = `<div class="ship-lock"><span class="lk-ic">👑</span><span>Win <b>King of the Hill</b> — <b>${inf.crownsHave | 0} / ${inf.reqCrowns | 0}</b> crowns taken. The blueprint is yours at ${inf.reqCrowns | 0}.</span><div class="lk-bar"><div class="lk-fill" style="width:${pct}%"></div></div><div class="bc-row">${buildCostChips(inf.cost, inf.have)}</div></div>`;
      } else if (inf.status === 'noblueprint') {
        const bd = ship.bpDrop || {}; const pctTxt = ((bd.chance || 0) * 100).toFixed((bd.chance || 0) < 0.01 ? 1 : 0);
        action = `<span class="ship-badge locked">🔒</span>`;
        lock = `<div class="ship-lock"><span class="lk-ic">◈</span><span>Recover the <b>Blueprint</b> — a <b>${pctTxt}%</b> drop from a <b>Lv${bd.minCitLevel}+ Void Citadel</b> in Zone Grind</span></div>`;
      } else if (inf.status === 'needkills') {
        const pct = Math.min(100, inf.killsHave / inf.reqKills * 100);
        action = `<span class="ship-badge bp">✦ BP</span>`;
        lock = `<div class="ship-lock ready"><span class="lk-ic">✦</span><span>Blueprint secured · <b>${G.formatNum(inf.killsHave)} / ${G.formatNum(inf.reqKills)}</b> total kills — any ship</span><div class="lk-bar"><div class="lk-fill" style="width:${pct}%"></div></div></div>`;
      } else {
        const can = inf.status === 'buildable';
        action = can ? `<button class="ship-btn buy res" data-build-start="${key}">⚒ Construct</button>` : `<span class="ship-badge locked">⚒</span>`;
        lock = `<div class="ship-lock ${can ? 'ready' : ''}"><span class="lk-ic">⚒</span><span>${can ? 'Ready to build — <b>delivered instantly</b>' : 'Need more resources'}</span><div class="bc-row">${buildCostChips(inf.cost, inf.have)}</div></div>`;
      }
    }
    else if (ship.emberTech) {
      const b = ship.beacon || {};
      action = `<button class="ship-btn buy" data-go-zones="1">✦ Hunt</button>`;
      lock = `<div class="ship-lock ready"><span class="lk-ic">✦</span><span>Ember Choir — recovered <b>only</b> by killing the hull that ends a <b>Choir zone</b> in Zone Grind. Never sold. <b style="color:#ffd98a">−${b.cdCut}% beacon recharge · +${b.life}% duration · +${b.size}% swarm · +${b.loot}% loot</b></span></div>`;
    }
    else if (ship.alienTech) {
      action = `<button class="ship-btn buy" data-go-galaxy="1">◈ Hunt</button>`;
      lock = `<div class="ship-lock ready"><span class="lk-ic">◈</span><span>Kaevith Incursion — earned <b>only</b> by clearing an alien-held zone in <b>My Galaxy</b>. Never sold. <b style="color:#d9a0ff">+${ship.xpBonus}% fleet XP per kill</b> while it flies with you.</span></div>`;
    }
    else if (ship.alliance) {
      const prev = ship.monoReq && C.SHIP_BY_KEY[ship.monoReq];
      action = `<button class="ship-btn buy" data-go-alliance="1">⬡ ${ship.acPrice.toLocaleString()}</button>`;
      lock = `<div class="ship-lock ready"><span class="lk-ic">⬡</span><span>Alliance exclusive — <b>⬡ ${ship.acPrice.toLocaleString()} Alliance Coins</b> in the <b>Alliance Store</b> (Hangar ▸ Social ▸ Alliance)${prev ? ` · requires the <b>${prev.name}</b>` : ''} · deals <b>+${Math.round(ship.siegeBonus * 100)}%</b> damage to Zone Bosses, Citadels, Event Bosses <b>and the Hollow Armada</b></span></div>`;
    }
    else if (st.unlocked) action = ship.resPrice
      ? `<button class="ship-btn buy res" data-ship-buy="${key}">${resCostChips(ship.resPrice)}</button>`
      : `<button class="ship-btn buy" data-ship-buy="${key}"><span class="coin">$</span> ${G.formatNum(ship.price)}</button>`;
    else action = `<span class="ship-badge locked">🔒</span>`;
    if (!lock && !st.owned && !st.unlocked && !ship.event && !ship.missionShip && !ship.purchase && !ship.megaCost && !ship.build && !ship.alliance && !ship.alienTech && !ship.unreleased && !ship.tour) {
      if (!st.hasBlueprint) {
        const z = st.bpZone, reach = z <= G.state.highestUnlocked;
        lock = `<div class="ship-lock"><span class="lk-ic">◷</span><span>Recover the <b>Blueprint</b> — defeat the <b>boss</b> in <b>${zoneName(z)}</b> (Zone ${z})</span>` +
          (reach ? `<button class="lk-go" data-bp-hunt="${z}">Hunt ›</button>` : `<span class="lk-soft">reach Z${z}</span>`) + `</div>`;
      } else if (!st.killsMet) {
        const pct = Math.min(100, st.killsHave / st.killsNeed * 100);
        lock = `<div class="ship-lock ready"><span class="lk-ic">✦</span><span>Blueprint ready · <b>${G.formatNum(st.killsHave)}/${G.formatNum(st.killsNeed)}</b> total kills — any ship</span>
          <div class="lk-bar"><div class="lk-fill" style="width:${pct}%"></div></div></div>`;
      }
    }
    const bpChip = st.active ? ''
      : ship.event === 'mech' ? `<span class="bp-chip have" style="border-color:#ff4d5e88;color:#ffb0ba">⚙ FOUNDRY</span>`
      : ship.event ? `<span class="bp-chip have" style="border-color:#b04dff88;color:#d9a0ff">❖ PROGENITOR</span>`
      : ship.missionShip ? `<span class="bp-chip have" style="border-color:#59d98c88;color:#a5f2c4">⌘ MISSIONS</span>`
      : ship.purchase ? `<span class="bp-chip have" style="border-color:#f2a93c88;color:#ffd9a0">◈ LOOTCOIN</span>`
      : ship.megaCost ? `<span class="bp-chip have" style="border-color:#ff5a6888;color:#ff9aa6">◇ DREAD</span>`
      : ship.alienTech ? `<span class="bp-chip have" style="border-color:#c26bff88;color:#e0b3ff">◈ KAEVITH</span>`
      : ship.emberTech ? `<span class="bp-chip have emb">✦ CHOIR</span>`
      : ship.alliance ? `<span class="bp-chip have" style="border-color:#2ee6c988;color:#8ff2e0">⬡ ALLIANCE</span>`
      : ship.build ? (st.owned ? '' : ((G.state.blueprints && G.state.blueprints[key]) ? `<span class="bp-chip have">✔ BP</span>` : (ship.build.reqCrowns ? `<span class="bp-chip">👑 ${ship.build.reqCrowns}</span>` : `<span class="bp-chip">◈ CITADEL</span>`)))
      : ship.tier > 0 ? (st.hasBlueprint ? `<span class="bp-chip have">✔ BP</span>` : `<span class="bp-chip">◷ Z${ship.bpZone}</span>`) : '';
    // hull-upgrade row for any owned ship (same options as My Ship)
    let upg = '';
    if (st.owned && G.shipUpInfo) {
      const inf = G.shipUpInfo(key); const tcol = (window.shipLvlColor ? window.shipLvlColor(inf.level) : '#9aa7b8');
      upg = `<div class="ship-upg" style="display:flex;align-items:center;gap:9px;margin-top:9px;padding:9px 10px;background:#0f1623;border:1px solid ${tcol}55;border-radius:9px">
        <div style="width:24px;height:24px;flex:none;border-radius:6px;background:${tcol}22;border:1px solid ${tcol};display:grid;place-items:center;font-family:Orbitron,sans-serif;font-weight:800;font-size:11px;color:${tcol}">${inf.level}</div>
        <div style="flex:1;min-width:0;font-size:10px;color:#46d27a;font-weight:700;letter-spacing:.02em">+${inf.bonus.dmg}% DMG · +${inf.bonus.hp}% HP · +${inf.bonus.rate}% Rate<div style="font-size:8.5px;color:#6f7f99;letter-spacing:.12em;text-transform:uppercase">Hull Lv ${inf.level}</div>${inf.level>1?'<div style="font-size:8px;color:#ff9a64;letter-spacing:.02em;margin-top:1px">⚠ resets to Lv 1 on death</div>':''}</div>
        ${inf.maxed
          ? `<span style="font-family:Orbitron,sans-serif;font-weight:800;font-size:10px;color:${tcol}">MAX</span>`
          : `<button class="ship-btn" data-ship-upg="${key}" ${inf.afford?'':'disabled'} style="white-space:nowrap;font-variant-numeric:tabular-nums">⬆ <span style="color:#ffd24d">●</span> ${G.formatNum(inf.cost.gold)} <span style="color:#c79bff">✦</span> ${G.formatNum(inf.cost.plasma)}</button>`}
      </div>`;
    }
    return `<div class="ship-card ${cls} ${st.active?'is-active':''}">
      <div class="ship-top">
        <div class="ship-ic ${cls}"><img class="ship-img" src="ships/ship-${key}.png" alt="" loading="lazy"></div>
        <div class="ship-meta"><div class="ship-name">${ship.name} ${bpChip}</div>
          <div class="ship-tag">${ship.cls} class · ${ship.tag}</div>
          <div class="ship-layout">${layout}</div></div>
        <div class="ship-act">${action}</div>
      </div>
      <div class="ship-desc">${ship.desc}</div>
      ${ship.perk ? `<div class="ship-perk">${ship.perk}</div>` : ''}
      ${mods?`<div class="ship-mods">${mods}</div>`:''}
      ${upg}
      ${lock}
      ${window.NANOUI ? window.NANOUI.shipStrip(key) : ''}
    </div>`;
  }
  // ==========================================================================
  // ITEM ICONOGRAPHY — each gear slot has a fleet-themed glyph + signature colour
  // (Munitions amber, Hull steel, Thrusters teal, Targeting green, Shield violet)
  // rendered with a matching glow. Weapons show their CLASS glyph & colour.
  // ==========================================================================
  const SLOT_META = {
    arrows: { color: '#ffc24d', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6.5" y="4" width="11" height="16" rx="2"/><path d="M9.5 2.5h5"/><path d="M12.8 8l-2.6 4.2H13l-2 3.8"/></svg>' },
    armor:  { color: '#8fb4d8', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4.5v9L12 22l-8-6.5v-9z"/><path d="M12 6.5l4 2.3v4.6L12 17l-4-3.6V8.8z"/></svg>' },
    boots:  { color: '#4fd0e0', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6l1 8H8z"/><path d="M8 11h8l-1 4H9z"/><path d="M11.2 15l-1.5 6M12.8 15l1.5 6M12 15v6"/></svg>' },
    gloves: { color: '#7ce06a', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>' },
    amulet: { color: '#9d8bff', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8.7 5v10L12 22l-8.7-5V7z"/><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="0.8" fill="currentColor"/></svg>' },
  };
  // Weapon-class icons — crisp inline SVGs (the old Unicode glyphs ⌶/⫷/✺
  // are missing from many device fonts, so weapons often showed NO icon).
  const WCLASS_ICONS = {
    laser:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="12" r="2.6"/><path d="M8.1 12H17"/><path d="M17 9.6l4.5 2.4L17 14.4z"/><path d="M10.5 9.2l1.6 1.6M10.5 14.8l1.6-1.6"/></svg>',
    gatling: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6.5" cy="12" r="3.4"/><path d="M9.9 9.6h8.6M9.9 12h10.6M9.9 14.4h8.6"/><path d="M21.5 9.6v4.8"/></svg>',
    missile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5c2.2 2.3 3.2 5.3 3.2 8.7l-1 5.8h-4.4l-1-5.8c0-3.4 1-6.4 3.2-8.7z"/><circle cx="12" cy="9" r="1.5"/><path d="M9.3 13.5L6.5 17M14.7 13.5L17.5 17M12 17v4"/></svg>',
    rail:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5h15M3 15.5h15"/><rect x="8" y="10.4" width="7" height="3.2" rx="1.6"/><path d="M18.5 12h3"/></svg>',
    plasma:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.1"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M6.2 6.2l2.1 2.1M15.7 15.7l2.1 2.1M17.8 6.2l-2.1 2.1M8.3 15.7l-2.1 2.1"/></svg>',
    support: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 8.4v7.2M8.4 12h7.2"/></svg>',
    // AEGIS FIELD PROJECTORS. These had no entry at all, so they fell through to
    // the Unicode glyph fallback (☣ ❄ ➤ ☠) — which is the very problem this
    // table exists to solve: those code points are missing from a lot of device
    // fonts, so the four rarest hull-locked items in the game showed NO icon on
    // the chip, the tooltip and the hardpoint.
    //
    // All four share a DASHED RING, because what they have in common is the thing
    // a player needs to read first: this is a field, not a gun. The mark inside
    // says which field.
    venom:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8" stroke-dasharray="2.4 2.6"/><path d="M8.5 9.5l7 5M15.5 9.5l-7 5"/></svg>',
    cryo:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/><path d="M9.6 5.2L12 7.6l2.4-2.4M9.6 18.8L12 16.4l2.4 2.4"/></svg>',
    banner:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8" stroke-dasharray="2.4 2.6"/><path d="M12 16.4V9.8"/><path d="M9.4 12.4L12 9.6l2.6 2.8"/></svg>',
    plague:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8" stroke-dasharray="2.4 2.6"/><circle cx="12" cy="9.5" r="1.1"/><circle cx="9.5" cy="14" r="1.1"/><circle cx="14.5" cy="14" r="1.1"/></svg>',
  };
  function wclassIcon(wc) { return WCLASS_ICONS[wc.key] || ('<span class="wci">' + wc.glyph + '</span>'); }
  function itemIcon(it) {
    if (it && (it.slot === 'bow' || it.slot === 'fighter') && window.ITEMS && window.ITEMS.weaponClassOf) {
      const wc = window.ITEMS.weaponClassOf(it);
      return `<span class="sci" style="color:${wc.color};filter:drop-shadow(0 0 5px ${wc.color}88)">${wclassIcon(wc)}</span>`;
    }
    const m = it && SLOT_META[it.slot];
    if (m) return `<span class="sci" style="color:${m.color};filter:drop-shadow(0 0 5px ${m.color}88)">${m.svg}</span>`;
    return (it && it.icon) || '';
  }
  // —— LOOTCOIN —— the premium micro-transaction currency. One unique mark used
  // everywhere it appears: a hex coin, gold → violet, with a loot-gem facet cut
  // into the center (echoes the loot-drop gems players chase in combat).
  // THE LOOTCOIN ICON HAS ONE SOURCE: the chip in the top bar (game.html), which
  // declares <linearGradient id="lf-lcg"> in the initial HTML. Every other coin in the
  // game references that one def.
  //
  // Two earlier attempts were worse. Each icon carrying its own <defs id="lcg"> put
  // dozens of duplicate ids in the document, and browsers resolve url(#lcg) against the
  // FIRST match — so every coin silently shared one definition anyway. Minting a unique
  // id per call then broke whenever a caller stored the string and printed it twice.
  // Pointing at a def that is already in the markup removes the whole class: nothing to
  // duplicate, nothing to inject, and it exists before the first paint rather than after
  // DOMContentLoaded.
  const LC_GRAD_ID = 'lf-lcg';
  const LC_ICON_RAW = '<svg class="lc" viewBox="0 0 24 24">' +
    '<path d="M12 1.5l9 5.25v10.5L12 22.5l-9-5.25V6.75z" fill="url(#' + LC_GRAD_ID + ')" stroke="#2a1808" stroke-width="1.1"/>' +
    '<path d="M12 5.6l5.6 3.25v6.3L12 18.4l-5.6-3.25v-6.3z" fill="rgba(22,12,32,.88)"/>' +
    '<path d="M12 8.4l3.1 1.85v3.5L12 15.6l-3.1-1.85v-3.5z" fill="url(#' + LC_GRAD_ID + ')"/>' +
    '<path d="M12 8.4l3.1 1.85-3.1 1.8-3.1-1.8z" fill="#fff3c9" opacity=".75"/></svg>';
  Object.defineProperty(window, '_lcIcon', { value: () => LC_ICON_RAW, configurable: true });
  // THE ONE PUBLIC ACCESSOR. `window.lootCoinSVG(px)` was already being called in three
  // places in this file and was never defined anywhere — every one of those calls fell
  // through to a ◈ text glyph. Now it exists, so any module can render the real coin at
  // any size without copying markup.
  Object.defineProperty(window, 'lootCoinSVG', {
    value: (px) => px ? LC_ICON_RAW.replace('class="lc"', 'class="lc" style="width:' + px + 'px;height:' + px + 'px"') : LC_ICON_RAW,
    configurable: true,
  });
  function renderStore() {
    let html = hangarTabsHTML(storeCat);
    // ALWAYS-VISIBLE LootCoins storefront entry (App Review 2.1(b): IAPs must be
    // locatable in-app — Hangar ▸ top banner ▸ pack sheet).
    // PACK SIZES ARE READ FROM PAYMENTS.PACKS, NEVER RESTATED. payments-v91's own
    // header says the amounts must stay in step with the App Store products, and a
    // fourth hand-typed copy in a UI string is exactly what nobody editing PACKS
    // would think to grep for.
    const packTxt = (() => {
      try {
        const p = (window.PAYMENTS && window.PAYMENTS.PACKS) || [];
        if (p.length) return 'Packs: ' + p.map((x) => Number(x.credits || 0).toLocaleString('en-US')).join(' · ');
      } catch (e) {}
      return 'Top up your balance';
    })();
    html += `<button class="lc-store-cta" data-getlc>${window._lcIcon()}<span><b>Get LootCoins</b><i>${packTxt}</i></span><em>SHOP ›</em></button>`;
    const cur = C.SHIP_BY_KEY[G.state.ship];

    if (storeCat === 'ships') {
      html += `<div class="store-sec">${storeHead(STORE_ICONS.ship, 'Hangar · Ships', 'Flying: ' + (cur?cur.name:'—'))}`;
      // FEATURED hero banner — LootCoin fast-track: Carrier first, then Mothership
      {
        const offer = !G.state.ownedShips.carrier ? { key: 'carrier', lc: 25000 }
          : (!G.state.ownedShips.mothership ? { key: 'mothership', lc: 100000 } : null);
        if (offer && G.buyShipLC) {
          const sh = C.SHIP_BY_KEY[offer.key];
          html += `<div class="hero-offer" data-lcship="${offer.key}" data-lcprice="${offer.lc}">
            <div class="ho-tag">★ FEATURED</div>
            <div class="ho-main">
              <div class="ho-name">${sh.name}</div>
              <div class="ho-desc">${offer.key === 'carrier' ? 'Skip the grind — instant drone-bay command.' : 'The ultimate hull. Skip the entire chain.'}</div>
              <button class="ho-buy">${window._lcIcon()}${offer.lc.toLocaleString()} · Unlock now</button>
            </div>
            <img class="ho-ship" src="ships/ship-${offer.key}.png" alt="">
          </div>`;
        }
      }
      html += `<div class="sec-blurb-anchor"></div><div class="sec-blurb">Buy hulls with gold. Each unlocks only after you recover its <b>blueprint</b> from a zone boss and prove yourself in the previous hull. <b style="color:#5fa8ff">Tap any hull</b> for full stats.</div>`;
      // GUARDED. The roster walks all 44 hulls and every one of them reads live
      // account state (owned, blueprints, upgrade level, build progress, licence).
      // A throw anywhere in that walk used to take the entire Hangar down with it,
      // which is indistinguishable from a crash to the player — and it left them
      // with no route back. Now the tab still renders and says so.
      try { html += shipRoster(); }
      catch (e) {
        try { console.error('shipRoster failed', e); } catch (e2) {}
        html += '<div class="sec-blurb" style="border-color:#ff6b78;color:#ffb0b8">'
          + 'The hull roster could not be drawn on this account. Everything else works — '
          + 'please report this so it can be fixed.</div>';
      }
      html += '</div>';
    }

    if (storeCat === 'market') {
      // —— LOOTCOIN FLEET — hero banners for the 3 direct-purchase hulls ——
      {
        const LC_FLEET = [
          { key: 'chromafang',   lc: 500,     tag: '✼ SPECTRUM', desc: 'Cruiser-grade raider — fires vibrant rainbow lasers.' },
          { key: 'frostyfrost',  lc: 50000,   tag: '❄ CRYO',     desc: 'Titan Carrier power — chills targets and flash-freezes them into ice cubes. Bosses are immune.' },
          { key: 'chromaregent', lc: 75000,   tag: '✼ SPECTRUM', desc: 'Titan Carrier power — every cannon streaks the full spectrum.' },
          { key: 'oblivionfinal', lc: 300000, tag: '★ APEX',    desc: 'The final hull. 2.5× the Oblivion Spear in every dimension.' },
          { key: 'titansina', lc: 1000000, tag: '✦ FINAL CLASS', desc: 'The hero ship — 2× the Dread Omega, zone-wide range, full-spectrum rainbow tracers.' },
        ];
        html += `<div class="store-sec">${storeHead(STORE_ICONS.ship, 'LootCoin Fleet', 'Direct purchase · no blueprint')}`;
        html += `<div class="sec-blurb-anchor"></div><div class="sec-blurb">Bought outright with ${window._lcIcon()} LootCoins — no blueprint, no kill chain, no level gate. Yours instantly.</div>`;
        LC_FLEET.forEach((offer) => {
          const sh = C.SHIP_BY_KEY[offer.key]; if (!sh) return;
          const owned = !!(G.state.ownedShips && G.state.ownedShips[offer.key]);
          const btn = owned ? '<span class="ho-buy owned">✓ OWNED</span>'
            : `<button class="ho-buy">${window._lcIcon()}${offer.lc.toLocaleString()} · Unlock now</button>`;
          html += `<div class="hero-offer lcf ${owned ? 'lcf-flat' : ''} ${offer.key === 'titansina' ? 'ho-sina' : ''}" ${owned ? '' : `data-lcship="${offer.key}" data-lcprice="${offer.lc}"`}>
            <div class="ho-tag">${offer.tag}</div>
            <div class="ho-main">
              <div class="ho-name">${sh.name}</div>
              <div class="ho-desc">${offer.desc}</div>
              ${btn}
            </div>
            <img class="ho-ship" src="ships/ship-${offer.key}.png" alt="">
          </div>`;
        });
        html += '</div>';
      }
      // —— PRIMORDIAL VAULT + COSMIC CACHE (LootCoins) ——
      const lm = G.getLCMarket(), lcHave = G.getCredits();
      const C2 = G.LC_PRICES || { cosmic: 10000, prim: 115000 };
      const fmtT = (sec) => { const h = Math.floor(sec/3600), m = Math.floor(sec%3600/60), s2 = sec%60; return (h>0? h+':' : '') + (m<10&&h>0?'0':'')+m+':'+(s2<10?'0':'')+s2; };
      // —— EVOLVING PARAGON CANNON — permanent, top of the market ————————
      // Sits above the rotating vaults deliberately: everything below is a roll
      // that goes stale, this is the one purchase that never does.
      if (window.AXIOM) {
        const ax = window.AXIOM, has = ax.owned(), afford2 = lcHave >= ax.PRICE;
        const st = ax.statsFor(G.state.level, G.state.highestDungeonReached);
        const eq = G.state.equipped.bow;
        const cur = eq ? (eq.stats.attackDamage || 0) : 0;
        const gain = cur > 0 ? Math.round((st.attackDamage / cur - 1) * 100) : null;
        const pc = (C.RARITY[C.RARITY.length - 1] || {}).color || '#ffffff';
        // EVERY stat, rendered from the computed block using the game's own
        // labels and fmt. The previous version hardcoded four keys and read
        // `maxHp`, which is not a stat in this game — the key is `health`, so the
        // Hull tile printed NaN. Driving off Object.keys also means the Paragon
        // card automatically lists more lines than any Primordial roll, which is
        // what a top-tier item should look like.
        const order = ['attackDamage', 'health', 'attackSpeed', 'critChance', 'critDamage', 'moveSpeed', 'multiShot', 'lifeSteal'];
        const keys = order.filter((k) => st[k] != null && !isNaN(st[k]));
        // multiShot is NOT in C.STATS — it lives in C.SPECIALS, so the generic
        // lookup fell through to the raw camelCase key and printed "MULTISHOT".
        // Overridden locally rather than added to C.STATS, because STAT_KEYS is
        // derived from that object and feeds generate()'s stat picker: adding it
        // there would make multi-shot a rollable core stat on every drop.
        const LBL = { multiShot: 'Multi-Shot' };
        const tile = (k) => {
          const d = C.STATS[k] || {};
          const lbl = (LBL[k] || d.name || k).toUpperCase();
          const v = d.fmt === 'flat' ? G.formatNum(st[k])
                  : k === 'multiShot' ? String(st[k])
                  : '+' + (Math.round(st[k] * 10) / 10) + '%';
          return `<div><span>${lbl}</span><b>${v}</b></div>`;
        };
        html += `<div class="store-sec"><div class="ax-hero${has ? ' owned' : ''}" style="--pc:${pc}">
          <div class="ax-glow"></div>
          <div class="ax-rank">PARAGON</div>
          <div class="ax-tag">THE HIGHEST TIER IN THE GAME · ONE PER ACCOUNT · NEVER ROTATES</div>
          <div class="ax-top">
            <div class="ax-sigil">⊛</div>
            <div class="ax-id"><div class="ax-name">EVOLVING<br>PARAGON CANNON</div>
              <div class="ax-sub">Rail Cannon · ${keys.length} stats · <b>every one of them scales with you</b></div></div>
          </div>
          <div class="ax-lv"><span class="ax-lvp"><span>YOUR LEVEL</span><b>${G.state.level}</b></span><span class="ax-lvp"><span>DEEPEST ZONE</span><b>${G.state.highestDungeonReached || 1}</b></span><em>→ recomputed from both, every time either one moves. Never rolled, never stale, never needs replacing — a weapon this good on your worst day of luck.</em></div>
          <div class="ax-stats">${keys.map(tile).join('')}</div>
          ${gain !== null && !has ? `<div class="ax-delta ${gain >= 0 ? 'up' : 'dn'}">${gain >= 0 ? '▲ +' + G.formatNum(gain) + '%' : '▼ ' + gain + '%'} damage vs your equipped weapon</div>` : ''}
          ${has
            ? `<div class="ax-owned">✓ OWNED — the only item you keep through an ascension<span>It rescales to Level 1 with you, then climbs again</span></div>`
            : `<button class="ax-buy${afford2 ? '' : ' cant'}" id="ax-buy">${window._lcIcon()} ${G.formatNum(ax.PRICE)} — CLAIM IT</button>
               ${afford2 ? '' : `<div class="ax-short">You have ${window._lcIcon()} ${G.formatNum(lcHave)}</div>`}`}
        </div></div>`;
      }
      // —— COSMIC JACKPOT CACHE removed from the market (July 2026) ——
      //     Backend roll/purchase logic in game-v93.js is untouched.
      {
        const pit = lm.prim.item, pr = C.RARITY[pit.rarity];
        const sold = lm.prim.bought, afford = lcHave >= C2.prim;
        html += `<div class="store-sec"><div class="lcv-hero">
          <div class="lcv-tag">✧ DAILY · resets 12 AM CST · <span id="lc-prim-cd">${fmtT(G.lcPrimTimeLeft())}</span></div>
          <div class="lcv-title">PRIMORDIAL VAULT</div>
          <div class="store-card shop-card lcm-card ${bl(pit.rarity)}" data-lcmcard="prim:0" style="border-left-width:3px;margin-top:8px;cursor:pointer">
            <div class="sc-ico ${rc(pit.rarity)}" style="border-color:${pr.color}">${itemIcon(pit)}</div>
            <div class="sc-main"><div class="sc-name ${rc(pit.rarity)}">${pit.name} ${G.shopIsUpgrade(pit)?'<span class="ic-tag up" style="vertical-align:2px">▲ UP</span>':''}</div>
              <div class="sc-desc">${pr.name} · ${C.SLOTS[pit.slot].name} · matched to your level</div></div>
            <button class="sc-buy lc" data-lcm="prim:0" ${sold?'disabled':''}>${sold?'CLAIMED':window._lcIcon()+G.formatNum(C2.prim)}</button></div>
          <div class="lcv-hint">Tap the item for full stats</div>
        </div></div>`;
      }
      {
        html += `<div class="store-sec">${storeHead(STORE_ICONS.cosmetics, 'Cosmic Cache · LootCoins', `⟳ <span id="lc-cos-cd">${fmtT(G.lcCosmicTimeLeft())}</span>`)}`;
        html += `<div class="sec-blurb-anchor"></div><div class="sec-blurb">Guaranteed <b style="color:#ff6ad5">Cosmic</b> gear rolled for your level · new stock every hour.</div>`;
        lm.cosmic.items.forEach((it, i) => {
          if (!it) return;
          const bought = lm.cosmic.bought.includes(i), r = C.RARITY[it.rarity];
          html += `<div class="store-card shop-card lcm-card ${bl(it.rarity)}" data-lcmcard="cosmic:${i}" style="border-left-width:3px;cursor:pointer">
            <div class="sc-ico ${rc(it.rarity)}" style="border-color:${r.color}">${itemIcon(it)}</div>
            <div class="sc-main"><div class="sc-name ${rc(it.rarity)}">${it.name} ${G.shopIsUpgrade(it)?'<span class="ic-tag up" style="vertical-align:2px">▲ UP</span>':''}</div>
              <div class="sc-desc">${r.name} · ${C.SLOTS[it.slot].name}</div></div>
            <button class="sc-buy lc" data-lcm="cosmic:${i}" ${bought?'disabled':''}>${bought?'Sold':window._lcIcon()+G.formatNum(C2.cosmic)}</button></div>`;
        });
        html += '</div>';
      }
      // —— OPERATIONS · ONE-TIME UNLOCKS ——
      // ONE CARD, THREE STATES: level-gated, for sale, or owned with its arm /
      // disarm switch. Price, gate and recharge are all read from GAME, so this
      // card cannot drift from the purchase it triggers or the beacon it arms.
      {
        const bs = G.beaconState ? G.beaconState() : null;
        const price = G.AUTO_BEACON_LC || 25000;
        const bal = Math.floor(Number(G.state.credits) || 0);
        const own = G.hasAutoBeacon ? G.hasAutoBeacon() : false;
        const armed = G.autoBeaconOn ? G.autoBeaconOn() : false;
        const needLv = bs ? bs.needLv : 30;
        const lvOk = (G.state.level | 0) >= needLv;
        const afford = bal >= price;
        html += `<div class="store-sec">${storeHead('◉', 'Operations · one-time unlocks', own ? 'AUTO BEACON OWNED' : '')}`;
        html += `<div class="sec-blurb-anchor"></div><div class="sec-blurb">Permanent account unlocks. Bought once, never again.</div>`;
        // The three facts this card owes the player are the recharge, where it
        // applies, and the boss exclusion. They were a 45-word paragraph; they are
        // chips now, so the state row below is the only prose left to read.
        //
        // EVERY LOOK IS IN web-v89.css (.ab-*), NOT HERE. The price button used to
        // be a `.sc-buy` on a plain `.store-card`, and every rule that makes that
        // element look like a button — fill, border, radius, height, and the one
        // that sizes the LootCoin mark inside it — is scoped `.shop-card .sc-buy`.
        // None of them reached this card, so the price rendered as a bare browser
        // button. The arm row was a corner label and a small text button, which is
        // why it read as missable; it is a full-width switch band now.
        const abChip = (l, v, c) => `<div class="ab-chip${c ? ' ' + c : ''}"><i>${l}</i><b>${v}</b></div>`;
        const live = own && armed;
        html += `<div class="store-card ab-card${live ? ' live' : ''}">
          <div class="ab-top">
            <div class="sc-ico">◉</div>
            <div class="sc-main" style="min-width:0"><div class="sc-name">Auto Beacon</div>
              <div class="sc-desc">Your distress beacon pulls its own trigger</div></div>
            ${own ? '<span class="ic-tag up" style="flex:0 0 auto">OWNED</span>' : ''}
          </div>
          <div class="ab-chips">
            ${abChip('RECHARGE', bs ? bs.cd + 's' : '—', 'hot')}
            ${abChip('FIRES IN', 'Zone grinds')}
            ${abChip('BOSSES', 'Never', 'off')}
          </div>
          <div class="ab-note">Nothing else changes — same recharge, same swarm, same kill value.</div>
          ${own
            ? `<button class="ab-trig ${armed ? 'on' : 'off'}" data-abtoggle="1" role="switch" aria-checked="${armed ? 'true' : 'false'}">
                 <span class="ab-led"></span>
                 <span class="ab-tx">
                   <span class="ab-tk">TRIGGER</span>
                   <span class="ab-tv">${armed ? 'ARMED' : 'DISARMED'}</span>
                   <span class="ab-ts">${armed ? 'Fires on every recharge' : 'The button is yours again'}</span>
                 </span>
                 <span class="ab-sw"></span>
               </button>`
            : `<div class="ab-pay"><button class="ab-cta" data-abbuy="1" ${(!lvOk || !afford) ? 'disabled' : ''}>${window._lcIcon()}${price.toLocaleString()} · UNLOCK</button>
               ${!lvOk ? `<div class="ab-short lock">Opens at <b>Level ${needLv}</b></div>`
                       : !afford ? `<div class="ab-short">You hold ${window._lcIcon()}<b>${bal.toLocaleString()}</b> — ${(price - bal).toLocaleString()} short</div>` : ''}</div>`}
        </div></div>`;
      }
      const sh = G.getShop(); const tl = G.shopTimeLeft(); const mm = Math.floor(tl/60), ss = tl%60;
      const price = sh.price != null ? sh.price : G.shopItemPrice();
      html += `<div class="store-sec">${storeHead(STORE_ICONS.market, 'Black Market · Gold', `${mm}:${ss<10?'0':''}${ss}`)}`;
      html += `<div class="sec-blurb-anchor"></div><div class="sec-blurb">Gear upgrades · fixed price this rotation.</div>`;
      sh.items.forEach((it, i) => {
        if (!it) return;
        const bought = sh.bought.includes(i), r = C.RARITY[it.rarity];
        const afford = G.state.gold >= price, up = G.shopIsUpgrade(it);
        html += `<div class="store-card shop-card lcm-card ${bl(it.rarity)}" data-shopcard="${i}" style="border-left-width:3px;cursor:pointer">
          <div class="sc-ico ${rc(it.rarity)}" style="border-color:${r.color}">${itemIcon(it)}</div>
          <div class="sc-main"><div class="sc-name ${rc(it.rarity)}">${it.name} ${up?'<span class="ic-tag up" style="vertical-align:2px">▲ UP</span>':''}</div>
            <div class="sc-desc">${r.name} · ${C.SLOTS[it.slot].name} · Z${it.dungeon}</div></div>
          <button class="sc-buy" data-shop="${i}" ${bought||!afford?'disabled':''}>${bought?'Sold':'<span class="coin">$</span> '+G.formatNum(price)}</button></div>`;
      });
      html += '</div>';
    }

    {
      // preserve scroll through re-renders (buying/upgrading shouldn't jump to top)
      const sb = el['store-body'];
      let _sc = sb; while (_sc && _sc !== document.documentElement && _sc.scrollHeight <= _sc.clientHeight + 4) _sc = _sc.parentElement;
      const _st = _sc ? _sc.scrollTop : 0;
      sb.innerHTML = html;
      if (_sc) _sc.scrollTop = _st;
    }
    // featured LootCoin ship offer
    el['store-body'].querySelectorAll('[data-lcship]').forEach((b) => b.addEventListener('click', () => openShipLCBuy(b.dataset.lcship, +b.dataset.lcprice)));
    // AUTO BEACON — buy, then arm / disarm. Both re-render the tab so the card's
    // state and the wallet chip agree with the write that just happened.
    el['store-body'].querySelectorAll('[data-abbuy]').forEach((b) => b.addEventListener('click', () => {
      const r = G.buyAutoBeacon();
      if (r.ok) { toast('◉ Auto Beacon unlocked — it fires itself from now on', '#ff8a3d'); renderStore(); }
      else if (r.reason === 'credits') { toast('Need ◈ ' + (r.short || 0).toLocaleString() + ' more LootCoins', '#e23b4e'); openCredits(); }
      else if (r.reason === 'level') toast('Your beacon opens at Level ' + r.need, '#e23b4e');
      else renderStore();
    }));
    el['store-body'].querySelectorAll('[data-abtoggle]').forEach((b) => b.addEventListener('click', () => {
      const on = G.autoBeaconOn();
      G.setAutoBeacon(!on);
      toast(on ? '○ Auto Beacon disarmed — the button is yours again' : '◉ Auto Beacon armed', on ? '#8b95a6' : '#ff8a3d');
      renderStore();
    }));
    // render each card's icon as the ACTUAL battle hull (same renderer as combat)
    el['store-body'].querySelectorAll('canvas[data-shipic]').forEach((cv) => {
      const key = cv.dataset.shipic; if (!C.SHIP_BY_KEY[key]) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1), W = 50, H = 50;
      cv.width = W * dpr; cv.height = H * dpr;
      const cx = cv.getContext('2d'); cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const gear = key === G.state.ship ? G.state.equipped : (G.state.fittings[key] || {});
      R.drawHullPortrait(cx, key, gear, W, H);
    });
    // LootCoin market (Cosmic Cache + Primordial Vault) — tap ANYWHERE on the
    // card for the full stats tooltip + buy. Rich detail mirrors the bag view:
    // weapon class, every stat with vs-equipped deltas, upgrade verdict.
    const marketDetailHTML = (it) => {
      const r = C.RARITY[it.rarity];
      const equipped = G.state.equipped[it.slot];
      const cmp = equipped ? G.compare(it, equipped) : null;
      let statHTML = '';
      Object.keys(it.stats).forEach((k) => {
        const d = C.STATS[k]; if (!d) return;
        let cmpStr = '';
        if (cmp && cmp[k]) { const up = cmp[k] > 0; const mag = Math.abs(cmp[k]); const vs = d.fmt === 'flat' ? G.formatNum(mag) : (Math.round(mag * 100) / 100); cmpStr = ` <span style="font-size:11px;color:${up?'var(--good)':'var(--bad)'}">(${up?'+':'−'}${vs}${d.fmt==='flat'?'':'%'})</span>`; }
        statHTML += `<div class="ip-stat ${d.special?'special':''}"><span class="ip-sname">${d.name}</span><span class="v">${fmtStat(k, it.stats[k])}${cmpStr}</span></div>`;
      });
      let cmpNote = '';
      if (equipped) { const better = G.itemPower(it) > G.itemPower(equipped); cmpNote = `<div class="ip-cmp">vs equipped: <span style="color:${better?'var(--good)':'var(--bad)'}">${better?'Upgrade ▲':'Not an upgrade ▼'}</span></div>`; }
      let wcHTML = '';
      if ((it.slot === 'bow' || it.slot === 'fighter') && window.ITEMS.weaponClassOf) {
        const wc = window.ITEMS.weaponClassOf(it);
        let extra = '';
        if (wc.key === 'support' && window.ITEMS.supportAura) {
          const au = window.ITEMS.supportAura(it);
          if (au) extra = `<div class="ip-waura">Fleet aura: <b>+${au.multiShot * 2} Multi-Shot</b> · <b>+${au.regen * 2}%/s</b> hull recovery · <b>−${Math.min(20, au.reduce * 2)}%</b> damage taken · <b>+${au.rangePct * 2}%</b> range <span class="ip-waura-x2">⚠ AEGIS HULLS ONLY</span></div>`;
        }
        wcHTML = `<div class="ip-wclass" style="color:${wc.color}"><span class="wcx">${wclassIcon(wc)}</span> ${wc.name} · <b>${wc.bonus}</b></div><div class="ip-wdesc">${wc.blurb}</div>${extra}`;
      }
      return `<div class="ip-name ${rc(it.rarity)}">${it.name}</div>
        <div class="ip-type">${r.name} · ${C.SLOTS[it.slot].name} · matched to your level</div>
        ${wcHTML}${statHTML}${cmpNote}`;
    };
    const axb = $('ax-buy');
    if (axb) axb.addEventListener('click', () => {
      const r = window.AXIOM.buy();
      if (r.ok) { toast('⊛ EVOLVING PARAGON CANNON claimed — it grows with you from here', '#ffd24d'); refreshAll(); renderStore(); }
      else toast(r.reason === 'credits' ? 'Not enough LootCoins' : r.reason === 'full' ? 'Cargo hold is full' : 'Already owned', '#e23b4e');
    });
    el['store-body'].querySelectorAll('[data-lcmcard]').forEach((card) => card.addEventListener('click', () => {
      const [kind, iStr] = card.dataset.lcmcard.split(':'); const idx = +iStr;
      const lm = G.getLCMarket();
      const it = kind === 'cosmic' ? lm.cosmic.items[idx] : lm.prim.item;
      const price = (G.LC_PRICES || { cosmic: 10000, prim: 115000 })[kind];
      if (!it) return;
      const sold = kind === 'cosmic' ? lm.cosmic.bought.includes(idx) : lm.prim.bought;
      const have = G.getCredits(), afford = have >= price;
      const r = C.RARITY[it.rarity];
      const sheet = showSheet(`<div class="sheet-head">${window._lcIcon()} ${kind === 'cosmic' ? 'Cosmic Cache' : 'Primordial Vault'}</div><div class="sheet-body">
        ${marketDetailHTML(it)}
        <div class="ip-stat" style="margin-top:8px"><span class="ip-sname">Price</span><span class="v">${sold ? '✓ Already claimed this rotation' : window._lcIcon() + ' ' + G.formatNum(price) + ' LootCoins'}</span></div>
        ${sold ? '' : `<div class="ip-stat"><span class="ip-sname">Your balance</span><span class="v" style="color:${afford ? '#7ce0a0' : 'var(--bad)'}">${window._lcIcon()} ${(G.formatNumRaw || G.formatNum)(have)}</span></div>`}
        ${sold || afford ? '' : '<p style="font-size:10.5px;color:#ffcf7a;margin-top:6px">Not enough LootCoins — grab a pack and come back.</p>'}
        <div class="sheet-actions"><button class="btn" data-x>${sold ? 'Close' : 'Cancel'}</button>
          ${sold ? '' : `<button class="btn gold" data-ok>${afford ? 'Buy — to Loot hold' : 'Get LootCoins'}</button>`}</div></div>`);
      sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
      const okB = sheet.querySelector('[data-ok]');
      if (okB) okB.addEventListener('click', () => {
        if (!afford) { closeSheet(); openCredits(); return; }
        const res = G.buyLCMarket(kind, idx);
        closeSheet();
        if (res.ok) { toast('✧ ' + it.name + ' — in your Loot hold', r.color); renderStore(); }
        else if (res.reason === 'full') toast('Loot hold is FULL — clear space first', '#e23b4e');
        else toast('Cannot buy', '#e23b4e');
      });
    }));
    // —— COSMIC JACKPOT CACHE — dramatic confirm → reveal ——
    (function () {
      const openJackpot = () => {
        const lm = G.getLCMarket();
        if (lm.jackpot && lm.jackpot.bought) { toast('Jackpot already pulled this rotation', '#c77bff'); return; }
        const price = (G.LC_PRICES || {}).jackpot || 1000000;
        const have = G.getCredits(), afford = have >= price;
        const sheet = showSheet(`<div class="sheet-head">${window._lcIcon()} Cosmic Jackpot</div><div class="sheet-body">
          <div class="jkpt-confirm">
            <div class="jkpt-chest big"><div class="jkpt-chest-glow"></div><span class="jkpt-chest-ic">🎁</span></div>
            <p class="jkpt-cline">One high-roll pull. Value lands <b>between Cosmic and Eternal</b> — with a <b style="color:#ffd24d">0.2%</b> shot at the final two tiers (<b style="color:#c061ff">Relic</b> / <b style="color:#ff2330">Artifact</b>).</p>
          </div>
          <div class="ip-stat" style="margin-top:8px"><span class="ip-sname">Price</span><span class="v">${window._lcIcon()} ${G.formatNum(price)} LootCoins</span></div>
          <div class="ip-stat"><span class="ip-sname">Your balance</span><span class="v" style="color:${afford ? '#7ce0a0' : 'var(--bad)'}">${window._lcIcon()} ${(G.formatNumRaw || G.formatNum)(have)}</span></div>
          ${afford ? '' : '<p style="font-size:10.5px;color:#ffcf7a;margin-top:6px">Not enough LootCoins — grab a pack and come back.</p>'}
          <div class="sheet-actions"><button class="btn" data-x>Cancel</button>
            <button class="btn gold" data-ok>${afford ? 'Pull the Jackpot' : 'Get LootCoins'}</button></div></div>`);
        sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
        sheet.querySelector('[data-ok]').addEventListener('click', () => {
          if (!afford) { closeSheet(); openCredits(); return; }
          const res = G.buyLCMarket('jackpot');
          if (!res.ok) {
            closeSheet();
            if (res.reason === 'full') toast('Loot hold is FULL — clear space first', '#e23b4e');
            else if (res.reason === 'credits') { openCredits(); }
            else toast('Cannot buy', '#e23b4e');
            return;
          }
          revealJackpot(res.item);
        });
      };
      // spin-up → reveal the pulled item with rarity flair
      const revealJackpot = (it) => {
        const r = C.RARITY[it.rarity];
        const top = it.rarity >= 12; // Relic / Artifact — the jackpot tiers
        const sheet = showSheet(`<div class="sheet-body jkpt-reveal">
          <div class="jkr-stage" style="--rcol:${r.color};--rglow:${r.glow}">
            <div class="jkr-burst"></div>
            <div class="jkr-ring"></div>
            <div class="jkr-ic ${rc(it.rarity)}">${itemIcon(it)}</div>
          </div>
          <div class="jkr-rarity" style="color:${r.color}">${top ? '★ JACKPOT ★ ' : ''}${r.name}</div>
          <div class="jkr-name ${rc(it.rarity)}">${it.name}</div>
          <div class="jkr-type">${C.SLOTS[it.slot].name} · matched to your level</div>
          <div class="sheet-actions" style="margin-top:14px"><button class="btn primary" data-x>${top ? 'Incredible!' : 'To Loot hold'}</button></div></div>`);
        sheet.classList.add('jkr-sheet');
        if (top) sheet.classList.add('jkr-top');
        // celebratory toast + confetti-ish flash
        setTimeout(() => { try { toast((top ? '★ JACKPOT — ' : '✧ ') + r.name + ' ' + it.name, r.color); } catch (e) {} }, 250);
        sheet.querySelector('[data-x]').addEventListener('click', () => { closeSheet(); renderStore(); });
      };
      const jc = el['store-body'].querySelector('[data-jackpot], [data-jackpot-buy]');
      el['store-body'].querySelectorAll('[data-jackpot], [data-jackpot-buy]').forEach((n) =>
        n.addEventListener('click', (e) => { e.stopPropagation(); openJackpot(); }));
    })();
    if (storeCat === 'market') {
      clearInterval(_lcmTimer);
      _lcmTimer = setInterval(() => {
        if (screen !== 'store' || storeCat !== 'market') { clearInterval(_lcmTimer); return; }
        const fmtT = (sec) => { const h = Math.floor(sec/3600), m = Math.floor(sec%3600/60), s2 = sec%60; return (h>0? h+':' : '') + (m<10&&h>0?'0':'')+m+':'+(s2<10?'0':'')+s2; };
        const cc = $('lc-cos-cd'); if (cc) cc.textContent = fmtT(G.lcCosmicTimeLeft());
        const jc = $('lc-jkpt-cd'); if (jc) jc.textContent = fmtT(G.lcCosmicTimeLeft());
        const pc = $('lc-prim-cd'); if (pc) pc.textContent = fmtT(G.lcPrimTimeLeft());
        // rotation flipped → re-render with fresh stock
        if (G.lcCosmicTimeLeft() <= 0 || G.lcPrimTimeLeft() <= 0) renderStore();
      }, 1000);
    }
    // black-market gold buys — button buys directly; tapping the CARD opens the
    // same full stats tooltip with a buy action
    el['store-body'].querySelectorAll('[data-shop]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = +b.dataset.shop; const it = G.getShop().items[i];
      if (G.buyShopItem(i)) { toast('Bought ' + it.name, C.RARITY[it.rarity].color); renderStore(); }
    }));
    el['store-body'].querySelectorAll('[data-shopcard]').forEach((card) => card.addEventListener('click', () => {
      const i = +card.dataset.shopcard;
      const sh = G.getShop(); const it = sh.items[i];
      if (!it) return;
      const price = sh.price != null ? sh.price : G.shopItemPrice();
      const sold = sh.bought.includes(i), afford = G.state.gold >= price;
      const sheet = showSheet(`<div class="sheet-head">Black Market</div><div class="sheet-body">
        ${marketDetailHTML(it)}
        <div class="ip-stat" style="margin-top:8px"><span class="ip-sname">Price</span><span class="v">${sold ? '✓ Sold this rotation' : '<span class="coin">$</span> ' + G.formatNum(price)}</span></div>
        <div class="sheet-actions"><button class="btn" data-x>${sold ? 'Close' : 'Cancel'}</button>
          ${sold || !afford ? '' : '<button class="btn gold" data-ok>Buy</button>'}</div></div>`);
      sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
      const okB = sheet.querySelector('[data-ok]');
      if (okB) okB.addEventListener('click', () => {
        closeSheet();
        if (G.buyShopItem(i)) { toast('Bought ' + it.name, C.RARITY[it.rarity].color); renderStore(); }
      });
    }));
    // ship buy / switch / blueprint-hunt
    el['store-body'].querySelectorAll('[data-ship-tile]').forEach((b) => b.addEventListener('click', () => openShipDetail(b.dataset.shipTile)));
    // class jump bar. Scrolls the tab's own scroller \u2014 never scrollIntoView, which
    // pans the whole app shell on this layout.
    el['store-body'].querySelectorAll('[data-scj]').forEach((b) => b.addEventListener('click', () => {
      const sec = el['store-body'].querySelector('#sc-' + b.dataset.scj);
      if (!sec) return;
      let sc = sec.parentElement;
      while (sc && sc !== document.documentElement && sc.scrollHeight <= sc.clientHeight + 4) sc = sc.parentElement;
      if (!sc) return;
      const top = sec.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
      sc.scrollTo({ top: Math.max(0, top - 8), behavior: 'smooth' });
      el['store-body'].querySelectorAll('[data-scj]').forEach((x) => x.classList.toggle('on', x === b));
    }));
    el['store-body'].querySelectorAll('[data-ship-buy]').forEach((b) => b.addEventListener('click', () => openShipBuy(b.dataset.shipBuy)));
    el['store-body'].querySelectorAll('[data-ship-switch]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.shipSwitch; if (G.switchShip(k)) { toast('Now flying the ' + C.SHIP_BY_KEY[k].name, '#5bc06b'); renderStore(); } else switchFailToast(k);
    }));
    el['store-body'].querySelectorAll('[data-go-sdread]').forEach((b) => b.addEventListener('click', () => showScreen('sdread')));
    el['store-body'].querySelectorAll('[data-go-missions]').forEach((b) => b.addEventListener('click', () => showScreen('missions')));
    el['store-body'].querySelectorAll('[data-ship-upg]').forEach((b) => b.addEventListener('click', () => confirmHullUpgrade(b.dataset.shipUpg, renderStore)));
    el['store-body'].querySelectorAll('[data-build-start]').forEach((b) => b.addEventListener('click', () => openBuildConfirm(b.dataset.buildStart)));
    el['store-body'].querySelectorAll('[data-lc-final]').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.lcFinal; openShipLCBuy(k, (C.SHIP_BY_KEY[k].purchase || {}).lc); }));
    el['store-body'].querySelectorAll('[data-mega-buy]').forEach((b) => b.addEventListener('click', () => openMegaBuy(b.dataset.megaBuy)));
    el['store-body'].querySelectorAll('[data-bp-hunt]').forEach((b) => b.addEventListener('click', () => {
      G.selectDungeon(+b.dataset.bpHunt); showScreen('battle');
      toast('Deploying — defeat the boss for the blueprint', '#e6b566');
    }));
    // hangar segment tabs (My Ship / store categories)
    wireHangarTabs(el['store-body']);
    const glc = el['store-body'].querySelector('[data-getlc]');
    if (glc) glc.addEventListener('click', openCredits);
    // no build countdown to refresh — hulls are delivered instantly
    clearInterval(_buildTick); _buildTick = null;
  }
  // CONSTRUCT confirm — the cost is the whole commitment now; the build is instant.
  function openBuildConfirm(key) {
    const inf = G.buildShipInfo(key); if (!inf) return;
    const ship = C.SHIP_BY_KEY[key];
    const sheet = showSheet(`<div class="sheet-head">⚒ Construct ${ship.name}</div><div class="sheet-body">
      <p style="margin:0 0 10px;font-size:12.5px;line-height:1.55;color:#cbd6e6">Commit the resources below and the yard delivers the hull <b style="color:#c9a0ff">immediately</b> — straight into your hangar.</p>
      <div class="bc-row" style="margin-bottom:10px">${buildCostChips(inf.cost, inf.have)}</div>
      <div style="background:rgba(255,80,80,.08);border:1px solid rgba(255,120,120,.35);border-radius:9px;padding:9px 11px;color:#ff9a64;font-size:11.5px;line-height:1.45;margin-bottom:6px">⚠ Resources are spent immediately and are <b>non-refundable</b>.</div>
      <div class="sheet-actions" style="margin-top:12px"><button class="btn" data-x>Cancel</button><button class="btn gold" data-ok ${inf.affordable ? '' : 'disabled'}>⚒ Build it now</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    const ok = sheet.querySelector('[data-ok]');
    if (ok) ok.addEventListener('click', () => {
      const r = G.startBuildShip(key); closeSheet();
      if (r.ok) { toast('⚒ ' + ship.name + ' delivered — board it in Hangar ▸ Ships', '#c9a0ff'); renderStore(); }
      else { toast(r.reason === 'resources' ? 'Not enough resources' : r.reason === 'ascension' ? '✦ Requires a higher Ascension rank' : 'Cannot build yet', '#e23b4e'); }
    });
  }
  function openCredits() {
    const packs = window.PAYMENTS ? window.PAYMENTS.PACKS : [];
    const conf = window.PAYMENTS && window.PAYMENTS.configured();
    const rows = packs.map((p) => `<div class="fp-pick" data-sku="${p.sku}"><div class="fpp-m"><div class="fpp-n">${window._lcIcon()}${p.credits.toLocaleString()} LootCoins${p.bonus ? ` <span class="pk-tag">+${p.bonus}% BONUS</span>` : ''}${p.tag ? ` <span class="pk-tag hot">${p.tag}</span>` : ''}</div><div class="fpp-d">one-time purchase · Apple Pay / Google Pay / card</div></div><span class="fpp-go">$${p.usd}</span></div>`).join('');
    const heroCoin = window._lcIcon().replace('class="lc"', 'class="lc lch-coin"');
    const sheet = showSheet(`<div class="sheet-head">${window._lcIcon()} Get LootCoins</div><div class="sheet-body">
      <div class="lc-hero">
        <div class="lch-glow"></div>
        <i class="lch-sp s1"></i><i class="lch-sp s2"></i><i class="lch-sp s3"></i><i class="lch-sp s4"></i><i class="lch-sp s5"></i>
        ${heroCoin}
        <div class="lch-title">LOOTCOINS</div>
        <div class="lch-sub">Hulls, gear &amp; cosmetics — a shortcut, not a secret tier</div>
        <div class="lch-shine"></div>
      </div>
      <div style="border:1px solid var(--line-2,#37475f);border-radius:11px;padding:10px 12px;margin-bottom:10px;background:rgba(255,207,122,.05)">
        <div style="font-size:11px;letter-spacing:.08em;color:#ffcf7a;font-weight:700;margin-bottom:7px">WHAT THEY BUY</div>
        <div style="display:grid;gap:5px;font-size:11.5px;line-height:1.45;color:#cbd6e6">
          <div>⛴ <b>Hulls</b> — Carrier, Mothership, Oblivion and event ships</div>
          <div>◈ <b>Black Market</b> — cosmic &amp; primordial gear rolls</div>
          <div>☠ <b>Dread-class</b> — part of every Dread hull's price</div>
          <div>⚡ <b>2× battle speed</b> — permanent, one purchase</div>
          <div>✦ <b>Skins &amp; auras</b> — pure cosmetic</div>
        </div>
        <p style="font-size:10.5px;line-height:1.5;color:var(--muted);margin:8px 0 0">Some of that is power, and we would rather say so than pretend otherwise. What LootCoins do not buy is a stat no one else can reach — nothing here is locked behind payment, and every buff you own is listed in Hangar ▸ My Ship where anyone can read it.</p>
      </div>
      <p style="margin-bottom:9px;font-size:11.5px;color:var(--muted);line-height:1.5">Checkout remembers your payment method — repeat purchases are one tap.</p>
      ${rows}
      ${conf ? '<p style="font-size:10.5px;color:var(--muted);margin-top:8px">Checkout opens in a new tab. LootCoins arrive on your next login after payment.</p>' : '<p style="font-size:10.5px;color:#ffcf7a;margin-top:8px">⚒ Checkout is not live yet — payments are being wired up. Enjoy the 500 founder LootCoins on the house.</p>'}
      <div class="sheet-actions"><button class="btn" data-x>Close</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    sheet.querySelectorAll('[data-sku]').forEach((d) => d.addEventListener('click', () => {
      const r = window.PAYMENTS ? window.PAYMENTS.buy(d.dataset.sku) : { ok: false };
      if (!r.ok) toast('⚒ Checkout coming soon', '#ffcf7a');
      else toast('Complete checkout in the new tab', '#7ce0a0');
    }));
  }
  function openShipBuy(key) {
    const ship = C.SHIP_BY_KEY[key], st = G.shipBuyState(key);
    const afford = st.affordable;
    let priceRows;
    if (st.resPrice) {
      const res = G.getResources();
      priceRows = `<div class="ip-stat"><span class="ip-sname">Cost</span><span class="v">${resCostChips(st.resPrice)}</span></div>
        <div class="ip-stat"><span class="ip-sname">Your resources</span><span class="v">${GM.RES_KEYS.filter((k)=>st.resPrice[k]).map((k)=>`<span style="color:${GM.RES[k].color}">${GM.RES[k].glyph} ${G.formatNum(res[k]||0)}</span>`).join(' ')}</span></div>`;
    } else {
      priceRows = `<div class="ip-stat"><span class="ip-sname">Price</span><span class="v" style="color:${afford?'var(--gold)':'var(--bad)'}"><span class="coin">$</span> ${G.formatNum(ship.price)}</span></div>
        <div class="ip-stat"><span class="ip-sname">Your gold</span><span class="v">${G.formatNum(G.state.gold)}</span></div>`;
    }
    const sheet = showSheet(`<div class="sheet-head">Acquire ${ship.name}</div><div class="sheet-body">
      <p style="margin-bottom:8px">${ship.desc}</p>
      ${ship.perk ? `<div class="ship-perk" style="margin-bottom:9px">${ship.perk}</div>` : ''}
      <div class="ip-stat"><span class="ip-sname">Hardpoints</span><span class="v">${hardpointChips(ship, 'text')}</span></div>
      ${priceRows}
      ${afford?'':`<p style="font-size:11px;color:var(--bad);margin-top:6px">Not enough ${st.resPrice?'Galaxy Resources':'gold'} yet.</p>`}
      <div class="sheet-actions"><button class="btn" data-x>Cancel</button>
        <button class="btn gold" data-ok ${afford?'':'disabled'}>Buy</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    const ok = sheet.querySelector('[data-ok]');
    if (ok) ok.addEventListener('click', () => {
      const res = G.buyShip(key);
      if (res.ok) { closeSheet(); toast('Acquired ' + ship.name + '!', '#5bc06b'); renderStore(); }
      else { toast(res.reason === 'resources' ? 'Not enough Galaxy Resources' : res.reason === 'gold' ? 'Not enough gold' : 'Locked', '#e23b4e'); }
    });
  }
  // ==========================================================================
  // LEADERBOARD
  // ==========================================================================
  function renderBoard() {
    if (window.LEADERBOARD && LEADERBOARD.ensureReal) LEADERBOARD.ensureReal(() => { if (screen === 'board') renderBoard(); });
    el['board-sub'].textContent = 'All-Time';
    let signedIn = false; try { signedIn = !!(window.ACCOUNT && ACCOUNT.current && ACCOUNT.current()); } catch (e) {}
    let html = hangarTabsHTML('board');

    // ---- NINE LADDERS ------------------------------------------------------
    // The power board is unchanged and still the default. The other eight re-sort
    // the same pool (or read their own table) through RANKBOARDS.
    const RB = window.RANKBOARDS;
    if (!RB) { renderBoardLegacy(html, signedIn); return; }
    const data = RB.board(_lbTab, () => { if (screen === 'board') renderBoard(); }, _lbView);
    const tab = data.tab;
    el['board-sub'].textContent = tab.sub;

    // A tab the build no longer ships (or one gated off) must not leave the board
    // pointed at nothing — fall back to POWER.
    const _tabs = RB.TABS;
    if (!_tabs.some((t) => t.id === _lbTab)) _lbTab = 'power';
    html += '<div class="lbx-tabs">' + _tabs.map((t) =>
      `<button class="lbx-tab${t.id === _lbTab ? ' on' : ''}" data-lbtab="${t.id}" style="--c:${t.col || '#5fd1ff'}"><i class="lbx-ic">${t.ic || ''}</i>${t.label}</button>`).join('') + '</div>';
    // SUB-VIEWS — only King of the Hill has them. Two boards answering the same
    // question on different clocks belong under one tab, not as two more entries
    // in a strip that is already eleven wide.
    const views = tab.views || null;
    const curView = views ? (views.some((v) => v.id === _lbView) ? _lbView : views[0].id) : null;
    if (views) {
      html += '<div class="lbx-views">' + views.map((v) =>
        `<button class="lbx-view${v.id === curView ? ' on' : ''}" data-lbview="${v.id}" style="--c:${tab.col}">${v.label}</button>`).join('') + '</div>';
    }
    html += `<div class="lb-info">${tab.info}</div>`;

    if (data.pending) {
      html += `<div class="lbx-note">Loading…</div>`;
    } else if (data.needsSql) {
      // NO SQL FILENAMES IN FRONT OF PLAYERS. This used to read "waiting on a
      // database migration" and name the .sql file — a sentence only the developer
      // can act on. The player-facing fact is that the board has nothing real on
      // it yet; the diagnostic goes to the console, where it belongs.
      try { console.warn('[ranks] ' + _lbTab + ' board hidden — ' + (tab.sql || 'ranks-ladders.sql') + ' has not run'); } catch (e) {}
      html += `<div class="lbx-note">This board isn’t live yet — no operator has published to it.</div>`;
    } else if (data.err) {
      html += `<div class="lbx-note err">This board couldn’t load — ${esc(data.err.message || 'request failed')}</div>`;
    } else if (!data.rows.length) {
      html += `<div class="lbx-note">${(curView === 'hall' && tab.emptyHall) || tab.empty || 'Nothing on this board yet.'}</div>`;
    } else if (_lbTab === 'power' && (data.real || 0) === 0) {
      html += `<div style="text-align:center;padding:26px 18px;border:1px dashed var(--line-2,#37475f);border-radius:14px;margin:4px 0 12px;background:rgba(95,209,255,.04);">
        <div style="font-size:30px;line-height:1;margin-bottom:8px;">🛰️</div>
        <div style="font-family:var(--font-display,'Orbitron');font-weight:800;font-size:14px;color:var(--text,#eaf0fa);letter-spacing:.02em;">${signedIn ? "You're the first ranked operator" : 'No rivals on the board yet'}</div>
        <div style="font-size:12px;line-height:1.5;color:var(--muted,#93a2ba);margin:6px auto 0;max-width:34ch;">${signedIn ? 'Real operators appear here as they sign in and play. Climb while it’s wide open — every rank is live.' : 'Sign in to publish your fleet to the live board and compete against real operators worldwide.'}</div>
      </div>`;
    }

    const showFleet = _lbTab === 'power';
    const PER = 60;
    const pages = Math.max(1, Math.ceil(data.rows.length / PER));
    if (_lbPage >= pages) _lbPage = pages - 1;
    const from = _lbPage * PER;
    const page = data.rows.slice(from, from + PER);

    html += page.map((p, i) => `
      <div class="lb-row ${p.isMe ? 'me' : ''}" data-rank="${from + i}">
        <div class="lb-rank ${p.rank <= 3 ? 'top' : ''}">${p.rank}</div>
        <div class="lb-nm">
          <div class="lb-topline"><span class="lb-name">${p.isMe ? '★ ' : ''}${esc(p.name)}</span>${ascBadge(p)}${simChip(p)}
            ${showFleet ? `<span class="lb-fleet">${fleetThumbs(p.isMe ? (p.fleet || [G.state.ship]) : (LB.fleetFor ? LB.fleetFor(p, p.rank, data.rows.length) : []))}</span>` : ''}</div>
          <div class="lb-meta">${tab.meta(p)}</div></div>
        <div class="lb-pow"><span class="pl">${((views && views.find((v) => v.id === curView)) || tab).unit}</span>${tab.fmt(tab.metric(p), p)}</div></div>`).join('');

    if (pages > 1) {
      const mine = data.rows.findIndex((p) => p.isMe);
      const myPage = mine >= 0 ? Math.floor(mine / PER) : -1;
      html += `<div class="lbx-pager">
        <button class="lbx-pg" data-pg="${_lbPage - 1}"${_lbPage === 0 ? ' disabled' : ''}>‹ PREV</button>
        <span class="lbx-pgn">${from + 1}–${Math.min(from + PER, data.rows.length)} of ${data.rows.length}</span>
        <button class="lbx-pg" data-pg="${_lbPage + 1}"${_lbPage >= pages - 1 ? ' disabled' : ''}>NEXT ›</button>
      </div>`;
      if (myPage >= 0 && myPage !== _lbPage) {
        html += `<button class="lbx-jump" data-pg="${myPage}">★ JUMP TO YOUR RANK — #${data.rows[mine].rank}</button>`;
      }
    }

    const _sc = el['board-body'].scrollTop;
    // FLICKER GUARD — the 4s auto-refresh only touches the DOM when the board
    // actually changed (rebuilding identical rows made the ship icons flash).
    if (el['board-body']._lbHtml === html) return;
    el['board-body']._lbHtml = html;
    el['board-body'].innerHTML = html;
    el['board-body'].scrollTop = _sc;
    wireHangarTabs(el['board-body']);
    el['board-body'].querySelectorAll('[data-lbtab]').forEach((b) => b.addEventListener('click', () => {
      _lbTab = b.dataset.lbtab; _lbPage = 0;
      // a tab change resets the sub-view, so leaving King of the Hill and coming
      // back never lands on CROWNS unannounced
      _lbView = null;
      el['board-body']._lbHtml = null;      // force a repaint past the flicker guard
      el['board-body'].scrollTop = 0;
      renderBoard();
    }));
    el['board-body'].querySelectorAll('[data-lbview]').forEach((b) => b.addEventListener('click', () => {
      _lbView = b.dataset.lbview; _lbPage = 0;
      el['board-body']._lbHtml = null;
      renderBoard();
    }));
    el['board-body'].querySelectorAll('[data-pg]').forEach((b) => b.addEventListener('click', () => {
      if (b.disabled) return;
      _lbPage = Math.max(0, +b.dataset.pg);
      el['board-body']._lbHtml = null;
      el['board-body'].scrollTop = 0;
      renderBoard();
    }));
    // Only the power board has loadouts to open — the others rank pilots on
    // records, and their rows carry no fleet to show.
    if (showFleet) {
      el['board-body'].querySelectorAll('.lb-row').forEach((row) =>
        row.addEventListener('click', () => openLoadout(data.rows[+row.dataset.rank], data.rows.length)));
    }
    clearInterval(_boardTimer);
    _boardTimer = setInterval(() => { if (screen === 'board') renderBoard(); else clearInterval(_boardTimer); }, 4000);
  }

  // Pre-ladder rendering, kept as a fallback for the case where ranks-boards.js
  // fails to load. Power only, exactly as it shipped.
  function renderBoardLegacy(html, signedIn) {
    const data = LB.allTimeBoard(G);
    html += `<div class="lb-info">All-time ranking of every operator, by fleet power.</div>`;
    if ((data.real || 0) === 0) {
      html += `<div style="text-align:center;padding:26px 18px;border:1px dashed var(--line-2,#37475f);border-radius:14px;margin:4px 0 12px;background:rgba(95,209,255,.04);">
        <div style="font-size:30px;line-height:1;margin-bottom:8px;">🛰️</div>
        <div style="font-family:var(--font-display,'Orbitron');font-weight:800;font-size:14px;color:var(--text,#eaf0fa);letter-spacing:.02em;">${signedIn ? "You're the first ranked operator" : 'No rivals on the board yet'}</div>
        <div style="font-size:12px;line-height:1.5;color:var(--muted,#93a2ba);margin:6px auto 0;max-width:34ch;">${signedIn ? 'Real operators appear here as they sign in and play. Climb while it’s wide open — every rank is live.' : 'Sign in to publish your fleet to the live board and compete against real operators worldwide.'}</div>
      </div>`;
    }
    html += data.board.slice(0, 60).map((p, i) => `
      <div class="lb-row ${p.isMe?'me':''}" data-rank="${i}">
        <div class="lb-rank ${p.rank<=3?'top':''}">${p.rank}</div>
        <div class="lb-nm">
          <div class="lb-topline"><span class="lb-name">${p.isMe?'★ ':''}${esc(p.name)}</span>${ascBadge(p)}${simChip(p)}
            <span class="lb-fleet">${fleetThumbs(p.isMe ? (p.fleet || [G.state.ship]) : (LB.fleetFor ? LB.fleetFor(p, p.rank, data.board.length) : []))}</span></div>
          <div class="lb-meta">Zone ${p.zone} · Lv ${p.level} · ${G.formatNum(p.kills)} kills</div></div>
        <div class="lb-pow"><span class="pl">PWR</span>${(G.formatNumRaw || G.formatNum)(p.power)}</div></div>`).join('');
    const _sc = el['board-body'].scrollTop;
    // FLICKER GUARD — the 4s auto-refresh only touches the DOM when the board
    // actually changed (rebuilding identical rows made the ship icons flash).
    if (el['board-body']._lbHtml === html) return;
    el['board-body']._lbHtml = html;
    el['board-body'].innerHTML = html;
    el['board-body'].scrollTop = _sc;
    wireHangarTabs(el['board-body']);
    el['board-body'].querySelectorAll('.lb-row').forEach((row) => row.addEventListener('click', () => openLoadout(data.board[+row.dataset.rank], data.board.length)));
    // auto-refresh every few seconds while the board is open
    clearInterval(_boardTimer);
    _boardTimer = setInterval(() => { if (screen === 'board') renderBoard(); else clearInterval(_boardTimer); }, 4000);
  }
  function openLoadout(p, total) {
    const fl = p.isMe
      ? [G.state.ship].concat(G.fleetShips ? G.fleetShips().map((x) => x.key) : [])
      : (LB.fleetFor ? LB.fleetFor(p, p.rank, total) : []);
    const fleetHtml = fl.map((fk, i) => {
      const sh = C.SHIP_BY_KEY[fk];
      return `<div class="lo-ship ${i === 0 ? 'flag' : ''}"><img src="ships/ship-${fk}.png" alt=""><div class="lo-sn">${sh ? sh.name : fk}</div><div class="lo-st">${i === 0 ? '★ FLAGSHIP' : 'ESCORT'}</div></div>`;
    }).join('');
    // ---- A REAL PILOT'S SHEET STATES ONLY WHAT THEY PUBLISHED ---------------
    // The leaderboard row carries a hull list and nothing else — there is no gear
    // column and never has been. So `loadoutFor()` INVENTED a full six-slot
    // fitting, with item names, rarities and colours, and this sheet printed it
    // under the pilot's real name beside their real rank, zone, level and power,
    // formatted identically to the player's own loadout. Nothing on screen said it
    // was generated. That is fabricated kit attributed to a named account, which is
    // the fleet-strip bug again with more detail to be wrong about.
    //
    // Sims and filler keep the generated fitting: they are labelled as sims and
    // there is no real loadout to misreport. A real pilot gets the truth instead.
    const generated = !p.isMe && !p.isReal;
    const eq = p.isMe ? G.state.equipped : (generated ? LB.loadoutFor(p, p.rank, total) : null);
    let grid = '';
    // Only the slots this loadout MODELS. SLOT_KEYS grew a `fighter` entry, and a
    // rival loadout has no launch bay — rendering one printed a permanently empty
    // Fighter Bay row on every pilot on the board.
    if (eq) C.SLOT_KEYS.filter((s) => s in eq).forEach((slot) => {
      const it = eq[slot], def = C.SLOTS[slot];
      grid += `<div class="lo-slot ${it?bl(it.rarity):''}"><div class="lo-ic ${it?rc(it.rarity):''}">${it?itemIcon(it):def.icon}</div>
        <div style="min-width:0"><div class="lo-nm ${it?rc(it.rarity):''}">${it?it.name:'—'}</div><div class="lo-r">${it?C.RARITY[it.rarity].name:'empty'}</div></div></div>`;
    });
    const noteStyle = 'font-size:11.5px;line-height:1.5;color:var(--muted);padding:10px 12px;border:1px dashed var(--line-2,#37475f);border-radius:10px';
    const sheet = showSheet(`<div class="sheet-head">${p.isMe?'Your Loadout':esc(p.name)}${ascBadge(p)}${simChip(p)}</div><div class="sheet-body">
      <p style="margin-bottom:10px">Rank <b>#${p.rank}</b> · Zone <b>${p.zone}</b> · Level <b>${p.level}</b> · Power <b style="color:var(--gold)">${G.formatNum(p.power)}</b>${ascLine(p)}</p>
      ${fleetHtml
        ? `<div class="lo-fleet">${fleetHtml}</div>`
        : `<div style="${noteStyle}">No hulls published yet — this pilot’s fleet appears here once their client next reports in.</div>`}
      ${eq ? `<div class="lo-sect">Flagship loadout</div><div class="loadout-grid">${grid}</div>` : ''}
      <div class="sheet-actions" style="margin-top:14px"><button class="btn" data-x>Close</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
  }

  // ==========================================================================
  // ITEM DETAIL SHEET
  // ==========================================================================
  // Render a salvage result ({fuel|iron|plasma: n}) as colored glyph chips.
  function salvageStr(salv) {
    if (!salv) return '';
    return GM.RES_KEYS.filter((k) => salv[k]).map((k) =>
      `<span style="color:${GM.RES[k].color}">${GM.RES[k].glyph}\u202F${G.formatNum(salv[k])}</span>`).join('  ');
  }
  function openItem(item, mode, slotKey) {
    const r = C.RARITY[item.rarity];
    const equipped = G.state.equipped[item.slot];
    const cmp = (mode === 'inventory' && equipped) ? G.compare(item, equipped) : null;
    let statHTML = '';
    Object.keys(item.stats).forEach((k) => {
      const d = C.STATS[k]; if (!d) return;
      let cmpStr = '';
      if (cmp && cmp[k]) { const up = cmp[k] > 0; const mag = Math.abs(cmp[k]); const vs = d.fmt === 'flat' ? G.formatNum(mag) : (Math.round(mag * 100) / 100); cmpStr = ` <span style="font-size:11px;color:${up?'var(--good)':'var(--bad)'}">(${up?'+':'−'}${vs}${d.fmt==='flat'?'':'%'})</span>`; }
      statHTML += `<div class="ip-stat ${d.special?'special':''}"><span class="ip-sname">${d.name}</span><span class="v">${fmtStat(k, item.stats[k])}${cmpStr}</span></div>`;
    });
    let cmpNote = '';
    if (cmp && equipped) { const better = G.itemPower(item) > G.itemPower(equipped); cmpNote = `<div class="ip-cmp">vs equipped: <span style="color:${better?'var(--good)':'var(--bad)'}">${better?'Upgrade ▲':'Not an upgrade ▼'}</span></div>`; }
    let actions = '';
    // EVERY hardpoint this hull exposes for the item's type gets its own button —
    // hulls with 3 or 4 mounts of a kind were previously stuck at "Equip 2nd".
    const hardpoints = (G.equipLayout ? G.equipLayout() : []).filter((s) => s.base === item.slot);
    if (mode === 'inventory') {
      const eqBlock = hardpoints.length > 1
        ? `<div class="ip-hps"><div class="ip-hps-t">Mount to hardpoint</div><div class="ip-hps-g">` +
            hardpoints.map((s, i) => `<button class="ip-hpb ${s.item ? '' : 'free'}" data-eqs="${s.key}">` +
              `<span class="ip-hpn">${s.label}</span>` +
              `<span class="ip-hpc ${s.item ? rc(s.item.rarity) : ''}">${s.item ? s.item.name : '— empty —'}</span></button>`).join('') +
          `</div></div>`
        : `<div class="sheet-actions"><button class="btn primary" data-eq>Equip</button></div>`;
      actions = eqBlock +
        // The Evolving Paragon Cannon cannot be sold, so it must not offer a Sell
        // button. sell()
        // returns null for it and the handler's `if (r)` swallows that silently —
        // the sheet would just close and nothing would happen, which reads as
        // "it sold" until the player finds it still in the bag. The line that
        // replaces the button also states the item's value at the exact moment
        // someone is thinking about getting rid of it.
        ((item.axiom || item.noSell)
          ? `<div class="ip-nosell">⊛ Cannot be sold, scrapped or lost<span>It survives ship destruction and catastrophic loss, and it is the one item you keep through an ascension.</span></div>`
          : `<div class="sheet-actions"><button class="btn" data-sell>Sell <span class="coin">$</span> ${G.formatNum(C.sellValue(item))}</button></div>` +
            `<div class="ip-salvage">Scrapping may salvage <span style="color:${GM.RES.fuel.color}">${GM.RES.fuel.glyph}</span> <span style="color:${GM.RES.iron.color}">${GM.RES.iron.glyph}</span> <span style="color:${GM.RES.plasma.color}">${GM.RES.plasma.glyph}</span> for My Galaxy</div>`);
    } else if (mode === 'equipped') actions = `<div class="sheet-actions"><button class="btn" data-x>Close</button><button class="btn gold" data-uneq>⬆ Unequip</button></div>`;
    const sheet = showSheet(`<div id="item-pop"><div class="sheet-body">
      <div class="ip-name ${rc(item.rarity)}">${item.name}</div>
      <div class="ip-type">${r.name} · ${C.SLOTS[item.slot].name} · ${item.axiom ? `Zone ${item.dungeon} <b class="ip-evo">· grows as you push deeper</b>` : `Zone ${item.dungeon}`}</div>
      ${(function(){ if ((item.slot !== 'bow' && item.slot !== 'fighter') || !window.ITEMS.weaponClassOf) return '';
        const wc = window.ITEMS.weaponClassOf(item);
        let extra = '';
        if (wc.key === 'support' && window.ITEMS.supportAura) {
          const au = window.ITEMS.supportAura(item);
          if (au) extra = `<div class="ip-waura">Fleet aura: <b>+${au.multiShot * 2} Multi-Shot</b> · <b>+${au.regen * 2}%/s</b> hull recovery · <b>−${Math.min(20, au.reduce * 2)}%</b> damage taken · <b>+${au.rangePct * 2}%</b> range <span class="ip-waura-x2">⚠ AEGIS HULLS ONLY</span></div>`;
        }
        return `<div class="ip-wclass" style="color:${wc.color}"><span class="wcx">${wclassIcon(wc)}</span> ${wc.name} · <b>${wc.bonus}</b></div><div class="ip-wdesc">${wc.blurb}</div>${extra}`; })()}
      ${statHTML}${cmpNote}${actions||'<div class="sheet-actions"><button class="btn" data-x>Close</button></div>'}</div></div>`);
    const eq = sheet.querySelector('[data-eq]'); if (eq) eq.addEventListener('click', () => { G.equip(item, 'primary'); closeSheet(); });
    sheet.querySelectorAll('[data-eqs]').forEach((b) => b.addEventListener('click', () => { G.equip(item, b.dataset.eqs); closeSheet(); }));
    const sl = sheet.querySelector('[data-sell]'); if (sl) sl.addEventListener('click', () => {
      const r = G.sell(item); closeSheet();
      if (r) { const sv = salvageStr(r.salvage);
        toast(`Sold for <b style="color:var(--gold)">${G.formatNum(r.gold)}g</b>${sv ? '  ·  ' + sv : ''}`, sv ? '#5bc0ff' : '#e6b566'); }
    });
    const x = sheet.querySelector('[data-x]'); if (x) x.addEventListener('click', closeSheet);
    const uq = sheet.querySelector('[data-uneq]'); if (uq) uq.addEventListener('click', () => {
      G.unequip(slotKey || item.slot); closeSheet();
      toast('Unequipped — moved to your bag', '#9fc2dd');
    });
  }

  // ==========================================================================
  // SKILL TREE
  // ==========================================================================

  // What each skill mod DOES, in words a player can act on. Keyed by mod so a
  // node can never describe a stat it doesn't grant — the Tempo/Focus problem
  // (two nodes wearing another node's stat) is structurally impossible now.
  const SKILL_HELP = {
    dmgPct:      ['Damage',           'Raises every shell you fire. The biggest single lever on kill speed.'],
    atkSpeedPct: ['Fire Rate',        'Shots per second. Past 2.2/s the surplus folds into damage instead.'],
    critChance:  ['Crit Chance',      'How often a shot crits. Worth little on its own \u2014 pair it with Crit Damage.'],
    critDamage:  ['Crit Damage',      'How hard a crit lands. Multiplies against Crit Chance.'],
    hpPct:       ['Max Hull',         'Hull integrity. Also lifts Fleet Score and how long you last in a raid.'],
    lifeSteal:   ['Life Steal',       'Heals a share of the damage you deal. Hard cap of 19% from all sources.'],
    moveSpeed:   ['Move Speed',       'Reposition and sweep loot faster. Autopilot uses it to kite.'],
    multiShot:   ['Multi-Shot',       'Chance to fire on nearby enemies too. Caps at 100%.'],
    rangePct:    ['Weapon Range',     'You open fire before they close \u2014 approach time becomes free damage.'],
    regen:       ['Hull Repair',      'Repairs a share of max hull every second, in combat and out.'],
    dmgReduce:   ['Damage Reduction', 'Cuts every hit you take. Compounds with Max Hull for effective HP.'],
  };
  const BRANCH_HELP = {
    offense: 'Output. Every node here makes your shots hit harder or land more often.',
    defense: 'Survival. Hull, mitigation and sustain \u2014 plus the Beacon they pay for.',
    tactics: 'Control of the fight. Reach, mobility, extra targets and field repair.',
  };
  const skFmt = (v, unit) => '+' + (Math.round(v * 100) / 100) + (unit || '%');
  // id -> node, filled as the tree renders. The in-place updater below needs the
  // node definition (max, per, unit) without re-walking the tree.
  const skNodeById = {};

  // SPENDING A POINT NO LONGER REBUILDS THE SCREEN.
  //
  // Every `+` used to call renderSkills(), which assigns a fresh innerHTML to
  // the whole body. That tears down and recreates every node in the tree, so
  // each click replayed every entry transition at once and reset the scroll
  // position — read as a hard full-screen flicker, and it got worse the deeper
  // the tree grew. Nothing about spending one point requires rebuilding the
  // other forty nodes.
  //
  // This updates only what actually changed: the point counter, the node that
  // was bought, and the affordability state of every other node (spending can
  // make a neighbour unaffordable). Returns false when the change is STRUCTURAL
  // — a tier just unlocked, so new nodes have to exist — and the caller falls
  // back to a full render for that one click.
  function skillsInPlace(id) {
    const body = el['skills-body']; if (!body) return false;
    if (el['skills-sub']) el['skills-sub'].textContent = (G.state.skillPoints || 0) + ' pts';

    // A locked tier whose requirement is now met needs real new markup.
    //
    // THE COUNTDOWN MOVES BY THE NODE'S COST, NOT BY ONE. This decremented the
    // displayed number by a hardcoded 1 on every purchase, so buying a 3-point
    // node showed "still 8 more points" when the real figure was 6. The value was
    // never wrong in the save — `branchSpent()` counts ranks × cost correctly —
    // it was this in-place updater GUESSING at the delta instead of reading it,
    // which is why re-opening the tab showed the right number.
    //
    // Derived from the node actually bought, so it can never drift from what
    // branchSpent() will report on the next full render.
    const bought = skNodeById[id] || null;
    const step = Math.max(1, (bought && bought.cost) | 0);
    let structural = false;
    body.querySelectorAll('.skt-locked b').forEach((b) => {
      const left = Math.max(0, (parseInt(b.textContent, 10) || 0) - step);
      if (left <= 0) { structural = true; return; }
      b.textContent = String(left);
      // keep the singular/plural honest as the number ticks down
      const host = b.parentElement;
      if (host) host.innerHTML = host.innerHTML.replace(/more points?/, 'more point' + (left > 1 ? 's' : ''));
    });
    if (structural) return false;

    let ok = true;
    body.querySelectorAll('[data-node]').forEach((card) => {
      const n = skNodeById[card.dataset.node];
      if (!n) { ok = false; return; }
      const rank = G.skillRank(n.id), maxed = rank >= n.max, able = !maxed && G.canInvest(n);
      card.classList.toggle('done', maxed);
      const pips = card.querySelectorAll('.sn-pip');
      for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('on', i < rank);
      const rk = card.querySelector('.sn-rk'); if (rk) rk.textContent = rank + '/' + n.max;
      const nowEl = card.querySelector('.sn-now'); if (nowEl) nowEl.textContent = skFmt(rank * n.per, n.unit);
      const nextEl = card.querySelector('.sn-next'); if (nextEl) nextEl.textContent = skFmt((rank + 1) * n.per, n.unit);
      const btn = card.querySelector('.sn-buy');
      if (btn) {
        if (maxed) {
          // MAX is a different button; swap its face, never its identity — the
          // click handler is delegated on the body so replacing text is safe.
          btn.textContent = 'MAX'; btn.disabled = true;
          btn.classList.add('maxed'); btn.classList.remove('able');
          btn.removeAttribute('data-sk');
        } else {
          btn.classList.toggle('able', able); btn.disabled = !able;
        }
      }
      // maxed hides the "-> next" pair; mirror what the renderer would emit
      const arw = card.querySelector('.sn-arw');
      if (arw) arw.style.display = maxed ? 'none' : '';
      if (nextEl) nextEl.style.display = maxed ? 'none' : '';
    });
    return ok;
  }
  function renderSkills() {
    const sp = G.state.skillPoints || 0;
    el['skills-sub'].textContent = sp + ' pts';
    const branches = C.SKILLS.branches;
    if (!branches.find((b) => b.key === skillBranch)) skillBranch = branches[0].key;
    const br = branches.find((b) => b.key === skillBranch);
    const spent = G.branchSpent(br.key);

    let html = `<div class="skill-top"><span class="pts">Skill Points <b>${sp}</b></span><button class="reset" id="sk-reset">\u21ba Reset</button></div>`;

    // ---- branch selector (segmented) ----------------------------------------
    html += '<div class="skill-tabs">';
    branches.forEach((b) => {
      const investable = C.SKILLS.nodes.some((n) => n.br === b.key && G.canInvest(n));
      html += `<button class="sk-tab ${b.key===skillBranch?'on':''}" data-br="${b.key}" style="--bc:${b.color}">
        <span class="skt-name">${b.name}</span><span class="skt-sub">${G.branchSpent(b.key)} pts</span>
        ${investable?'<span class="skt-dot"></span>':''}</button>`;
    });
    html += '</div>';

    // Branch identity, then what the branch has actually bought you so far. The
    // tree used to state cost and rank but never the running total, so there was
    // no way to tell what your points had produced.
    html += `<p class="sk-brief">${BRANCH_HELP[br.key] || ''}</p>`;
    const totals = {};
    C.SKILLS.nodes.filter((n) => n.br === br.key).forEach((n) => {
      const r = G.skillRank(n.id); if (r) totals[n.mod] = (totals[n.mod] || 0) + n.per * r;
    });
    const totKeys = Object.keys(totals).filter((k) => totals[k] > 0);
    html += '<div class="sk-tot" style="--bc:' + br.color + '">';
    if (!totKeys.length) {
      html += '<span class="sk-tot-none">No points invested in ' + br.name + ' yet</span>';
    } else {
      html += '<span class="sk-tot-h">Active from ' + br.name + '</span><div class="sk-tot-g">';
      totKeys.forEach((k) => {
        const h = SKILL_HELP[k] || [k, ''];
        const unit = (C.SKILLS.nodes.find((n) => n.mod === k) || {}).unit;
        html += '<span class="sk-chip"><b>' + skFmt(totals[k], unit) + '</b>' + h[0] + '</span>';
      });
      html += '</div>';
    }
    html += '</div>';

    // ---- ◇ PILOT TREE — the OTHER half of pilot power ----------------------
    // Dread Core nodes buff every hull you fly, stacking on top of the branches
    // above, but their running total lived only on the tree canvas itself —
    // so from this page it was impossible to tell the tree did anything at all.
    // computeStats() folds these into damage, hull, crit, rate, move, lifesteal,
    // multi-fire, armor, regen and range; resolveHit() applies boss/elite; the
    // util keys feed XP, gold, loot quality and pickup radius.
    if (window.DREAD && DREAD.bonusList) {
      const ptLvl = DREAD.unlockLevel || 30;
      const ptList = DREAD.bonusList();
      if (ptList.length || (G.state.level | 0) >= ptLvl) {
        const ptN = DREAD.nodeCount ? DREAD.nodeCount() : 0;
        html += '<div class="sk-tot sk-pt" style="--bc:#ff5a68">';
        html += '<span class="sk-tot-h">◇ Active from Pilot Tree · ' + ptN + ' node' + (ptN === 1 ? '' : 's') + '</span>';
        if (!ptList.length) {
          html += '<span class="sk-tot-none">No nodes unlocked yet — spend ◇ Dread Cores in Command ▸ Pilot Tree.</span>';
        } else {
          html += '<div class="sk-tot-g">' + ptList.map((b) =>
            '<span class="sk-chip"><b>+' + (Math.round(b.value * 10) / 10) + b.unit + '</b>' + b.label + '</span>').join('') + '</div>';
          html += '<p class="sk-pt-note">Applies to <b>every hull you fly</b>, on top of the branches above — and <b>survives Ascension</b>.</p>';
        }
        html += '</div>';
      }
    }

    // ---- ◉ BEACON — the Defense branch's shared payoff ---------------------
    // Shown on the Defense tab so the link between "tank ranks" and "bigger, more
    // frequent swarms" is legible while you are spending points.
    if (skillBranch === 'defense' && G.beaconState) {
      const bs = G.beaconState();
      const cdPct = Math.round((1 - bs.cd / 300) * 100);
      const lifePct = Math.round((bs.life / 30 - 1) * 100);
      html += `<div class="sk-beacon${bs.locked ? ' locked' : ''}">
        <div class="skb-h"><span class="skb-ic">◉</span><b>BEACON</b><em>${bs.locked ? '🔒 Unlocks at Lv ' + bs.needLv : 'Defense payoff'}</em></div>
        <p class="skb-p">Fire it from the battle screen to flood a <b>Zone Grind</b> sector with a swarm. Every <b>Defense</b> rank shortens the recharge and lengthens the call — tanks farm the most from one beacon.</p>
        <div class="skb-row">
          <div><span>RECHARGE</span><b>${bs.cd}s</b><em>${cdPct > 0 ? '−' + cdPct + '%' : 'base'}</em></div>
          <div><span>SWARM RUNS</span><b>${bs.life}s</b><em>${lifePct > 0 ? '+' + lifePct + '%' : 'base'}</em></div>
          <div><span>SIZE</span><b>×${bs.mult}</b><em>${bs.ranks} ranks</em></div>
        </div>
        <div class="skb-note">Caps at −40% recharge and +150% duration · never fires on autopilot · Zone Grind only</div>
      </div>`;
    }

    // ---- active-branch progress --------------------------------------------
    const caps = C.SKILLS.nodes.filter((n) => n.br === br.key && n.cap);
    const capsUnlocked = caps.filter((n) => G.skillReqMet(n)).length;
    html += `<div class="sk-prog" style="--bc:${br.color}">
      <div class="skp-row"><span class="skp-name">${br.name}</span><span class="skp-meta">${spent} invested \u00b7 ${capsUnlocked}/${caps.length} capstones</span></div>
      <div class="skp-bar"><div class="skp-fill" style="width:${caps.length?Math.min(100,capsUnlocked/caps.length*100):0}%"></div></div></div>`;

    // ---- group nodes into tiers (by reqBranch) ------------------------------
    const tiers = [], byReq = {};
    C.SKILLS.nodes.filter((n) => n.br === br.key).forEach((n) => {
      const r = n.reqBranch || 0;
      if (!byReq[r]) { byReq[r] = { req: r, cost: n.cost, nodes: [] }; tiers.push(byReq[r]); }
      byReq[r].nodes.push(n);
    });
    tiers.sort((a, b2) => a.req - b2.req);

    // Only surface tiers that are UNLOCKED, plus the single next-unlockable one.
    let shownNext = false, hiddenTiers = 0;
    tiers.forEach((tier, idx) => {
      const unlocked = spent >= tier.req;
      const isNext = !unlocked && !shownNext;
      if (!unlocked && !isNext) { hiddenTiers++; return; }
      if (isNext) shownNext = true;
      const tnum = idx + 1;
      const investable = tier.nodes.some((n) => G.canInvest(n));
      const allMax = tier.nodes.every((n) => G.skillRank(n.id) >= n.max);
      const isCap = tier.nodes.some((n) => n.cap);
      const okey = br.key + ':' + tier.req;
      let open = skillOpen[okey]; if (open == null) open = unlocked && investable;
      let status, scls;
      if (allMax) { status = '\u2713 Maxed'; scls = 'max'; }
      else if (isNext) { status = `\u25cb ${tier.req - spent} more pts`; scls = 'lock'; }
      else if (investable) { status = 'Points available'; scls = 'avail'; }
      else { status = 'Owned'; scls = ''; }
      const ranks = tier.nodes.reduce((a, n) => a + G.skillRank(n.id), 0);
      const maxR = tier.nodes.reduce((a, n) => a + n.max, 0);
      html += `<div class="sk-tier ${open&&!isNext?'open':''} ${isNext?'next':''} ${isCap?'iscap':''}" data-tk="${okey}" style="--bc:${br.color}">
        <button class="skt-head" data-acc="${okey}" ${isNext?'disabled':''}>
          <span class="skt-hl"><span class="skt-no">${isCap?'\u2605':'T'+tnum}</span>
            <span class="skt-hn">${isCap?'Capstone Tier':'Tier '+tnum}<span class="skt-cost">${tier.cost} pt${tier.cost>1?'s':''}/rank</span></span></span>
          <span class="skt-hr"><span class="skt-status ${scls}">${status}</span><span class="skt-ct">${ranks}/${maxR}</span><span class="skt-caret">\u203a</span></span>
        </button>`;
      if (open && !isNext) {
        html += '<div class="skt-body">';
        tier.nodes.forEach((n) => {
          skNodeById[n.id] = n;
          const rank = G.skillRank(n.id), able = G.canInvest(n), maxed = rank >= n.max;
          let pips = ''; for (let i = 0; i < n.max; i++) pips += `<div class="sn-pip ${i < rank ? 'on' : ''}"></div>`;
          const btn = maxed ? `<button class="sn-buy maxed" disabled>MAX</button>` : `<button class="sn-buy ${able?'able':''}" data-sk="${n.id}" ${able?'':'disabled'}>+</button>`;
          const h = SKILL_HELP[n.mod] || [n.mod, ''];
          const now = rank * n.per, next = (rank + 1) * n.per;
          const numRow = maxed
            ? `<span class="sn-now">${skFmt(now, n.unit)}</span><em class="sn-lab">${h[0]} · maxed</em>`
            : `<span class="sn-now">${skFmt(now, n.unit)}</span><i class="sn-arw">→</i><span class="sn-next">${skFmt(next, n.unit)}</span><em class="sn-lab">${h[0]}</em>`;
          html += `<div class="skill-node ${maxed?'done':''} ${n.cap?'cap':''}" data-node="${n.id}" style="border-left-color:${br.color};--bc:${br.color}">
            <div class="sn-main"><div class="sn-name">${n.name}${n.cap?'<span class="capm">CAPSTONE</span>':''}</div>
              <div class="sn-desc">${h[1]}</div>
              <div class="sn-num">${numRow}</div>
              <div class="sn-pips">${pips}<span class="sn-rk">${rank}/${n.max}</span><span class="sn-per">${skFmt(n.per, n.unit)}/rank</span></div></div>${btn}</div>`;
        });
        html += '</div>';
      } else if (isNext) {
        html += `<div class="skt-locked">Invest <b>${tier.req - spent}</b> more point${tier.req-spent>1?'s':''} in ${br.name} to unlock ${tier.nodes.length} ${isCap?'capstone ':''}skill${tier.nodes.length>1?'s':''}.</div>`;
      }
      html += '</div>';
    });
    if (hiddenTiers > 0) html += `<div class="sk-more">\u25be ${hiddenTiers} deeper tier${hiddenTiers>1?'s':''} reveal as you invest in ${br.name}</div>`;

    // SCROLL SURVIVES A FULL RENDER. Structural rebuilds are rare now, but when
    // one does happen it must not throw the player back to the top of the tree.
    const keepScroll = el['skills-body'].scrollTop || 0;
    el['skills-body'].innerHTML = html;
    if (keepScroll) el['skills-body'].scrollTop = keepScroll;
    const rb = $('sk-reset'); if (rb) rb.addEventListener('click', openReset);
    el['skills-body'].querySelectorAll('.sk-tab').forEach((b) => b.addEventListener('click', () => { skillBranch = b.dataset.br; renderSkills(); }));
    el['skills-body'].querySelectorAll('[data-acc]').forEach((b) => b.addEventListener('click', () => {
      const tier = b.closest('.sk-tier');
      skillOpen[b.dataset.acc] = !(tier && tier.classList.contains('open'));
      renderSkills();
    }));
    // DELEGATED, not one listener per button — the in-place updater rewrites
    // button faces, and per-element listeners would not survive that.
    if (!el['skills-body'].dataset.skWired) {
      el['skills-body'].dataset.skWired = '1';
      el['skills-body'].addEventListener('click', (ev) => {
        const b = ev.target.closest && ev.target.closest('[data-sk]');
        if (!b || b.disabled) return;
        if (!G.investSkill(b.dataset.sk)) return;
        if (!skillsInPlace(b.dataset.sk)) renderSkills();
      });
      // DOUBLE-CLICK A NODE TO INVEST — DESKTOP ONLY (741). On a mouse the only
      // way to buy a rank was the 24px `+`; the whole card is now a target.
      //
      // Bound behind `pointer:fine` so TOUCH IS UNTOUCHED: a double-tap while
      // flicking through the tree would otherwise spend a point nobody meant to
      // spend. And it deliberately ignores double-clicks that land ON the `+`,
      // because those already delivered two ordinary clicks — two ranks, which is
      // what clicking `+` twice should do — and buying a third here would be a
      // phantom purchase.
      //
      // When the node cannot be bought it SAYS WHY rather than doing nothing. The
      // three reasons are exactly canInvest()'s three clauses, in its order.
      let fine = false;
      try { fine = !!(window.matchMedia && window.matchMedia('(hover:hover) and (pointer:fine)').matches); } catch (e) {}
      if (fine) el['skills-body'].addEventListener('dblclick', (ev) => {
        if (!ev.target.closest) return;
        if (ev.target.closest('[data-sk]')) return;              // the + button already handled it
        if (ev.target.closest('.sk-tab') || ev.target.closest('[data-acc]')) return;
        const card = ev.target.closest('.skill-node');
        if (!card) return;
        const id = card.dataset.node; if (!id) return;
        const node = ((window.CONFIG && window.CONFIG.SKILLS && window.CONFIG.SKILLS.nodes) || []).find((n) => n.id === id);
        if (!node) return;
        if (G.skillRank(id) >= node.max) { unlockToast('✓ ' + node.name + ' is already at max rank'); return; }
        if (G.skillReqMet && !G.skillReqMet(node)) { unlockToast('🔒 ' + node.name + ' — invest more points in this branch first'); return; }
        if (!G.investSkill(id)) { unlockToast('⚠ Need ' + node.cost + ' skill point' + (node.cost > 1 ? 's' : '') + ' for ' + node.name); return; }
        if (!skillsInPlace(id)) renderSkills();
      });
    }
  }
  function openReset() {
    const sheet = showSheet(`<div class="sheet-head">Reset Skills</div><div class="sheet-body">
      <p>Refund <b>all</b> spent skill points so you can rebuild from scratch?</p>
      <div class="sheet-actions"><button class="btn" data-x>Cancel</button><button class="btn danger" data-ok>Reset All</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    sheet.querySelector('[data-ok]').addEventListener('click', () => { const r = G.resetSkills(); closeSheet(); toast(`Refunded ${r} points`, '#2f6fed'); renderSkills(); });
  }

  // ==========================================================================
  // MODAL PRIMITIVES
  // ==========================================================================
  function showSheet(inner) {
    closeSheet();
    const back = document.createElement('div'); back.className = 'backdrop';
    const sheet = document.createElement('div'); sheet.className = 'sheet'; sheet.innerHTML = inner;
    back.appendChild(sheet); el['modal-root'].appendChild(back);
    back.addEventListener('click', (e) => { if (e.target === back) closeSheet(); });
    return sheet;
  }
  function closeSheet() { el['modal-root'].innerHTML = ''; }

  // ---- A REFUSAL MUST LAND WHERE THE PLAYER IS LOOKING ----------------------
  // Every "you can't do that" in this file went to toast(), which renders into
  // #loot-feed at z-index 4. A sheet's backdrop is z-index 50 — so the reason a
  // sheet's own button refused was painted UNDERNEATH the sheet, and the button
  // read as dead. That is the whole of "siege citadel not working": the siege was
  // fine, the level-band refusal was invisible.
  //
  // The message goes INSIDE the sheet, directly above the pinned action row, and
  // clears itself so a stale reason can't sit there through the next tap.
  function sheetNotice(sheet, msg, color) {
    const host = sheet && sheet.querySelector('.sheet-body');
    if (!host) return false;
    let n = host.querySelector('.sheet-note');
    if (!n) {
      n = document.createElement('div'); n.className = 'sheet-note';
      const acts = host.querySelector('.sheet-actions');
      if (acts) host.insertBefore(n, acts); else host.appendChild(n);
    }
    n.style.setProperty('--nc', color || '#ff8a96');
    n.innerHTML = msg;
    // restart the attention pulse even when the same message repeats
    n.classList.remove('pulse'); void n.offsetWidth; n.classList.add('pulse');
    clearTimeout(n._t); n._t = setTimeout(() => { if (n.parentNode) n.remove(); }, 7000);
    return true;
  }
  function openSheetEl() { try { return el['modal-root'] && el['modal-root'].querySelector('.sheet'); } catch (e) { return null; } }

  // ==========================================================================
  // FEEDBACK
  // ==========================================================================
  function onLoot(item) { /* dropped on ground — pickup toast happens on collect */ }
  // An item was auto-scrapped because the hold is full — gray line in the feed.
  let _scrapT = 0;
  function lootScrapped(item) {
    if (!_inited || !item) return;
    if (window.COACH) window.COACH.notify('bagfull');
    const now = Date.now();
    if (now - _scrapT < 1500) return;
    _scrapT = now;
    const t = document.createElement('div'); t.className = 'loot-toast scrapped';
    t.innerHTML = `<span class="${rc(item.rarity)}">${item.name}</span><span class="lt-scrap">⚒ scrapped · hold full</span>`;
    el['loot-feed'].appendChild(t); setTimeout(() => t.remove(), 2100);
    while (el['loot-feed'].children.length > 3) el['loot-feed'].removeChild(el['loot-feed'].firstChild);
  }
  let _lastLootToast = 0, _bagDirty = false, _bagTimer = 0;
  function onCollect(item) {
    if (!_inited) return;
    const now = performance.now();
    // rate-limit loot toasts (10x pickups would otherwise flood the DOM)
    if (now - _lastLootToast > 220) {
      _lastLootToast = now;
      const feed = el['loot-feed'];
      // repeat pickup of the same item → bump a ×n counter on the last toast
      const last = feed.lastElementChild;
      if (last && last.dataset.loot === item.name) {
        const n = (+last.dataset.n || 1) + 1; last.dataset.n = n;
        let x = last.querySelector('.lt-x');
        if (!x) { x = document.createElement('span'); x.className = 'lt-x'; last.appendChild(x); }
        x.textContent = '×' + n;
        clearTimeout(last._lootTimer);
        last._lootTimer = setTimeout(() => last.remove(), 2100);
        last.style.animation = 'none'; last.offsetHeight; // restart fade-out clock
        last.style.animation = 'lootin .01s ease forwards,lootout .35s ease forwards 1.7s';
      } else {
        const t = document.createElement('div');
        t.className = 'loot-toast ' + bl(item.rarity);
        t.dataset.loot = item.name; t.dataset.n = 1;
        t.innerHTML = `<span class="${rc(item.rarity)}">${item.name}</span>`;
        feed.appendChild(t);
        t._lootTimer = setTimeout(() => t.remove(), 2100);
        while (feed.children.length > 3) feed.removeChild(feed.firstChild);
      }
    }
    syncBag();
  }
  // THE HOLD COUNT IS A VIEW OF state.inventory, AND EVERY MUTATION MUST SAY SO.
  // The badge used to be written only here (on pickup) and in refreshAll, so the
  // batched equip/sell flush — which runs a beat LATER and can empty the hold —
  // left the last pickup's number on screen: "386 items" in a hold auto-sell had
  // already cleared, and "2 items" that had been auto-equipped as upgrades. Both
  // reads were stale, not wrong. G.js calls this after every batched mutation.
  function syncBag() {
    if (!_inited || !el['bag-badge']) return;
    const n = G.state.inventory.length;
    el['bag-badge'].style.display = n > 0 ? 'block' : 'none'; el['bag-badge'].textContent = n;
    // debounce bag re-render to at most ~3/sec while the bag is open
    if (screen === 'bag') {
      _bagDirty = true;
      if (!_bagTimer) _bagTimer = setTimeout(() => { _bagTimer = 0; if (_bagDirty && screen === 'bag') { _bagDirty = false; renderBagItems(); } }, 350);
    }
  }
  function toast(text, color) {
    if (!_inited) return;
    // A SHEET COVERS THE FEED. The backdrop is z-index 50 and #loot-feed is 4, so
    // anything said while a sheet is open is said behind it. Mirror it into the
    // sheet so no message can be swallowed by a modal — one place, every caller.
    { const sh = openSheetEl(); if (sh) sheetNotice(sh, text, color); }
    const t = document.createElement('div'); t.className = 'loot-toast'; t.style.borderLeftColor = color;
    t.innerHTML = `<span style="color:${color}">${text}</span>`;
    el['loot-feed'].appendChild(t); setTimeout(() => t.remove(), 2100);
    while (el['loot-feed'].children.length > 3) el['loot-feed'].removeChild(el['loot-feed'].firstChild);
  }
  function onLevelUp(level) {
    if (!_inited) return;
    const t = document.createElement('div'); t.className = 'lvl-toast'; t.textContent = 'LEVEL ' + level;
    el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 1700);
  }
  function unlockToast(msg) { toast('★ ' + msg, '#e6b566'); }
  // ==========================================================================
  // THE KAEVITH INCURSION — event briefing, first-entry announcement, and the
  // earn-a-hull payoff. The event is a VEIL over My Galaxy: roughly a fifth of
  // the map is alien-held, those zones fight harder, and clearing one is a
  // chance to earn a hull no amount of money can buy.
  // ==========================================================================
  const XEN_SHIPS = ['xen1', 'xen2', 'xen3', 'xen4', 'xen5'];
  // One-line "which hull" summary for a tile tooltip: the most likely hull at
  // this ring plus the top hull's share, so scarcity is visible before the fight.
  function xenPick(ring) {
    const split = G.xenSplit ? G.xenSplit(ring || 1) : null;
    if (!split) return 'any of the five';
    const live = split.filter((r) => !r.owned && !r.gated);
    if (!live.length) return split.some((r) => !r.owned) ? 'nothing at this depth' : 'all five earned';
    const best = live.reduce((a, b) => (b.share > a.share ? b : a));
    const top = split[4];
    const nm = (k) => ((C.SHIP_BY_KEY[k] || {}).name || k).replace(/^Kaevith\s+/, '');
    const topTxt = (top && !top.owned && !top.gated) ? ` · Sovereign ${(top.share * 100).toFixed(2)}%` : '';
    return `mostly ${nm(best.key)}${topTxt}`;
  }
  // Relative scarcity, stated plainly. The roll's per-hull weights live in
  // game-v93 (XEN_BASE_W); xenSplit() reports the real shares so this roster
  // shows what the table actually does instead of a hand-written guess.
  // The roster prints the REAL share from xenSplit(), so these labels are only the
  // headline. xen4 was '5× rarer' until the Aug 2026 Sovereign pass took it another
  // 5× down — it is now the rarest hull in the line.
  const XEN_RARITY_NOTE = { xen3: '5× rarer', xen4: '25× rarer', xen5: '10× rarer' };
  function xenRoster(ring) {
    const split = G.xenSplit ? G.xenSplit(ring || 1) : null;
    return XEN_SHIPS.map((k, i) => {
      const s = C.SHIP_BY_KEY[k]; if (!s) return '';
      const owned = !!(G.state.ownedShips && G.state.ownedShips[k]);
      const row = split ? split[i] : null;
      const gated = !!(row && row.gated && !owned);
      const pct = row && !owned ? (row.share * 100) : 0;
      const pctTxt = !row || owned ? '' : pct >= 10 ? Math.round(pct) + '%' : pct >= 1 ? pct.toFixed(1) + '%' : pct.toFixed(2) + '%';
      const note = XEN_RARITY_NOTE[k];
      return `<div class="xr-row ${owned ? 'have' : ''}">
        <img src="ships/ship-${k}.png" alt="">
        <div class="xr-m"><div class="xr-n">${s.name}${owned ? ' <i>✔ earned</i>' : ''}</div>
        <div class="xr-c">${s.cls}${k === 'xen1' ? ' · entry class' : k === 'xen5' ? ' · Dreadnaught class' : ''}${note && !owned ? ` · <b class="xr-rare">${note}</b>` : ''}</div>
        ${owned ? '' : gated ? `<div class="xr-odds">Lv ${row.minLv}+ systems only — nothing shallower can drop it</div>` : `<div class="xr-odds">${pctTxt} of a winning roll</div>`}</div>
        <div class="xr-xp">+${s.xpBonus}%<i>fleet XP</i></div>
      </div>`;
    }).join('');
  }
  // Every Kaevith hull recovered — the event is finished for this account.
  const XEN_KEYS = ['xen1', 'xen2', 'xen3', 'xen4', 'xen5'];
  function xenAllOwned() {
    try { const o = G.state.ownedShips || {}; return XEN_KEYS.every((k) => !!o[k]); } catch (e) { return false; }
  }
  function openXenBriefing() {
    const lo = GM.XEN ? Math.round(GM.XEN.minChance * 100) : 1;
    const hi = GM.XEN ? Math.round(GM.XEN.maxChance * 100) : 10;
    const bonus = G.xenXpBonus ? G.xenXpBonus() : 0;
    const sheet = showSheet(`<div class="sheet-head">◈ THE KAEVITH INCURSION</div><div class="sheet-body xen-sheet">
      <div class="xen-hero">
        <div class="xh-tag">LIVE EVENT · MY GALAXY</div>
        <div class="xh-t">THE KAEVITH INCURSION</div>
        <div class="xh-s">One zone in five is alien-held — the <b>purple voids</b> on your map.</div>
      </div>
      <div class="xen-steps">
        <div class="xs-row"><span class="xs-n">1</span><div><b>They hit harder.</b> <b>+35% hull</b>, <b>+22% damage</b>, and a Kaevith command ship for a boss.</div></div>
        <div class="xs-row"><span class="xs-n">2</span><div><b>Clear one to earn their tech.</b> <b>${lo}%</b> on ring 1 → <b>${hi}%</b> at the rim. Deeper rings pay better odds and bigger hulls.</div></div>
        <div class="xs-row"><span class="xs-n">3</span><div><b>The reward is fleet-wide XP.</b> Any Kaevith hull lifts every kill’s XP for the whole fleet. All five stack to <b>+${XEN_KEYS.reduce((a, k) => a + ((C.SHIP_BY_KEY[k] || {}).xpBonus || 0), 0)}%</b>, no cap.</div></div>
      </div>
      <div class="lo-sect">The five hulls · entry → Dreadnaught</div>
      <div class="xen-note-rare">Scarcity is in <b>which</b> hull the wreck gives up, not in your chance of a drop. Shares below are for the <b>rim</b>.</div>
      <div class="xen-roster">${xenRoster(GM.RINGS || 25)}</div>
      <div class="xen-now"><span>Your resonance field right now</span><b>${bonus ? '+' + bonus + '% XP per kill' : 'none — no Kaevith hull in the fleet'}</b></div>
      <div class="sheet-actions"><button class="btn" data-x>Close</button><button class="btn gold" data-ok>◈ Hunt a void zone</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    sheet.querySelector('[data-ok]').addEventListener('click', closeSheet);
    try { localStorage.setItem('lf_xen_seen', new Date().toDateString()); } catch (e) {}
  }
  // Auto-announce on entering My Galaxy — once a day, so it lands as an event
  // rather than a nag. The banner keeps it one tap away the rest of the time.
  function maybeAnnounceXen() {
    // ALL FIVE HULLS RECOVERED — nothing left to announce. The event is over for
    // this account, so the daily popup stops for good; the banner stays tappable
    // for the roster and the resonance total.
    if (xenAllOwned()) return;
    let seen = null;
    try { seen = localStorage.getItem('lf_xen_seen'); } catch (e) {}
    if (seen === new Date().toDateString()) return;
    setTimeout(() => { if (screen === 'galaxy') openXenBriefing(); }, 420);
  }
  // End-of-battle result for an alien-held zone. Fires on EVERY invaded-zone
  // clear so the roll is never silent — you either earned a hull or you didn't.
  function xenTechResult(r, tile) {
    if (!_inited || !r) return;
    const zone = tile && tile.name ? tile.name : 'the zone';
    if (r.won && r.ship) {
      const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.fontSize = '24px';
      t.innerHTML = `<span style="color:#d9a0ff;text-shadow:0 0 20px #b04dff">◈ ALIEN SHIP TECHNOLOGY</span><br><span style="font-size:14px;color:#efe2ff">${r.ship.name} earned</span>`;
      el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 4600);
    }
    const sheet = showSheet(`<div class="sheet-head">◈ ${zone} · zone cleared</div><div class="sheet-body">
      ${r.won && r.ship ? `<div class="xres won">
        <div class="xres-tag">ALIEN SHIP TECHNOLOGY EARNED</div>
        <img class="xres-img" src="ships/ship-${r.key}.png" alt="">
        <div class="xres-t">${r.ship.name}</div>
        <div class="xres-c">${r.ship.cls}${r.key === 'xen1' ? ' · entry class' : r.key === 'xen5' ? ' · Dreadnaught class' : ''}</div>
        <div class="xres-xp">+${r.ship.xpBonus}% fleet XP per kill<i>while it flies in your fleet — flagship or escort</i></div>
        <div class="xres-note">It's in your hangar now. Put it in the fleet to switch the bonus on.</div>
      </div>` : `<div class="xres miss">
        <div class="xres-tag">NO ALIEN TECHNOLOGY THIS TIME</div>
        <div class="xres-g">◈</div>
        <div class="xres-t2">The Kaevith wreckage gave up nothing</div>
        <div class="xres-c">This zone rolled a <b>${r.pct}%</b> chance to earn a hull. The zone is still yours, and the fight still paid gold, XP and loot.</div>
        <div class="xres-note">Deeper rings carry better odds — up to <b>10%</b> at the rim. The two entry chassis are the common drops; the <b>Glaive</b> is <b>5× rarer</b>, the <b>Godshard</b> <b>10× rarer</b>, and the <b>Sovereign</b> is the scarcest hull in the line at well under <b>1%</b> of a winning roll.</div>
      </div>`}
      <div class="sheet-actions"><button class="btn" data-x>Close</button>${r.won ? '<button class="btn gold" data-fleet>Open Hangar</button>' : '<button class="btn gold" data-galaxy>Find another void zone</button>'}</div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    const f = sheet.querySelector('[data-fleet]'); if (f) f.addEventListener('click', () => { closeSheet(); tapMyShip(); storeCat = 'ships'; showScreen('store'); });
    const g2 = sheet.querySelector('[data-galaxy]'); if (g2) g2.addEventListener('click', () => { closeSheet(); showScreen('galaxy'); });
    refreshAll();
  }
  // THE XYN · EVERY DEFEAT REPORTS ITS OUTCOME.
  //
  // A lottery the player cannot see resolve is indistinguishable from one that
  // does not exist — so this fires on EVERY Xyn defeat, win or lose, and always
  // states the odds. The player who has just been told “no” is exactly the one who
  // needs to know what they were rolling against.
  //
  // Four outcomes, because four honest things can have happened:
  //   win      — the one in a million landed
  //   miss     — it did not
  //   have     — already flying it, so it cannot pay a second hull
  //   no-tile  — the system changed hands mid-fight, so the roll paid nothing
  // Every figure comes from XYN's payload; nothing here re-derives an odds number.
  function xynResult(r) {
    if (!_inited || !r) return;
    const odds = '1 in ' + (r.odds || 1000000).toLocaleString();
    if (r.result === 'win') {
      const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.fontSize = '24px';
      t.innerHTML = '<span style="color:#7cd4ff;text-shadow:0 0 22px #2b8fd0">◈ SUPER FIGHTER RECOVERED</span><br><span style="font-size:14px;color:#dff0ff">THE XYN · one in a million</span>';
      el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 4800);
    }
    const body = r.result === 'win'
      ? '<div class="xres won">'
        + '<div class="xres-tag">SUPER FIGHTER CLASS RECOVERED</div>'
        + '<img class="xres-img" src="ships/ship-xyn.png" alt="">'
        + '<div class="xres-t">The Xyn</div>'
        + '<div class="xres-c">Super Fighter · the first class above Celestial</div>'
        + '<div class="xres-xp">22 fighter bays<i>double the Celestial Corvus, on the same combat sheet</i></div>'
        + '<div class="xres-note">You hit a <b>' + odds + '</b> chance. It is in your hangar now — nothing was spent.</div>'
        + '</div>'
      : r.result === 'have'
      ? '<div class="xres miss">'
        + '<div class="xres-tag">THE XYN IS DOWN</div><div class="xres-g">◈</div>'
        + '<div class="xres-t2">You already fly the Xyn</div>'
        + '<div class="xres-c">No second hull drops — but the fight still paid gold, XP and loot, and the defeat is on your record.</div>'
        + '<div class="xres-note">The Xyn keeps spawning here whether you own it or not. Holding this system is what stops anyone else rolling for it.</div>'
        + '</div>'
      : r.result === 'no-tile'
      ? '<div class="xres miss">'
        + '<div class="xres-tag">NO HULL — SYSTEM NOT HELD</div><div class="xres-g">⚠</div>'
        + '<div class="xres-t2">You do not hold Xyn Prime</div>'
        + '<div class="xres-c">The roll only pays the pilot who <b>owns the system</b>, and this one is not yours right now. The fight still paid gold, XP and loot.</div>'
        + '<div class="xres-note">Take Xyn Prime and every defeat here rolls a <b>' + odds + '</b> chance at the Super Fighter.</div>'
        + '</div>'
      : '<div class="xres miss">'
        + '<div class="xres-tag">NO SUPER FIGHTER THIS TIME</div><div class="xres-g">◈</div>'
        + '<div class="xres-t2">The Xyn gave up nothing</div>'
        + '<div class="xres-c">Every defeat here rolls a <b>' + odds + '</b> chance at the hull — <b>no escalator and no pity timer</b>, so this roll was exactly the same as your first.</div>'
        + '<div class="xres-note">The run is over and you are docked — deploy to Xyn Prime again to fight it again. The fight still paid gold, XP and loot. Xyn defeats logged: <b>' + G.formatNum(r.kills || 0) + '</b>.</div>'
        + '</div>';
    const sheet = showSheet('<div class="sheet-head">◈ THE XYN · defeated</div><div class="sheet-body">'
      + body
      + '<div class="sheet-actions"><button class="btn" data-x>Close</button>'
      + (r.result === 'win' ? '<button class="btn gold" data-fleet>Open Hangar</button>' : '<button class="btn gold" data-again>Back to My Galaxy</button>')
      + '</div></div>');
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    const f = sheet.querySelector('[data-fleet]');
    if (f) f.addEventListener('click', () => { closeSheet(); tapMyShip(); storeCat = 'ships'; showScreen('store'); });
    const a = sheet.querySelector('[data-again]');
    if (a) a.addEventListener('click', closeSheet);
    refreshAll();
  }
  function blueprintEvent(ship) {
    if (!_inited || !ship) return;
    if (ship.build) {
      // OBLIVION-class — an ultra-rare, screen-filling prismatic announcement
      const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.fontSize = '24px';
      t.innerHTML = `<span style="color:#c9a0ff;text-shadow:0 0 18px #c9a0ff">◈ OBLIVION BLUEPRINT</span><br><span style="font-size:14px;color:#e6dcff">${ship.name} schematics recovered — build it in Hangar › Ships</span>`;
      el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 4200);
      toast('◈ ' + ship.name + ' BLUEPRINT recovered!', '#c9a0ff');
      return;
    }
    const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#7fe0ff'; t.style.fontSize = '20px';
    t.innerHTML = `◷ BLUEPRINT<br><span style="font-size:13px;color:#cfe9ff">${ship.name} unlocked in the Store</span>`;
    el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 2600);
    toast('Blueprint recovered: ' + ship.name, '#7fe0ff');
  }
  function shipBuilt(ship) {
    if (!_inited || !ship) return;
    const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.fontSize = '26px';
    t.innerHTML = `<span style="color:#ffd24d;text-shadow:0 0 18px #ffd24d">🚀 ${ship.name.toUpperCase()}</span><br><span style="font-size:14px;color:#e6dcff">Construction complete — board it in Hangar › Ships</span>`;
    el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 4600);
    toast('★ ' + ship.name + ' has arrived!', '#ffd24d');
    refreshAll();
  }
  function bossEvent(kind) {
    if (!_inited) return;
    if (kind === 'spawn') {
      const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#e23b4e'; t.style.fontSize = '24px';
      t.textContent = '☠ BOSS INCOMING'; el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 1700);
    } else if (kind === 'super') {
      const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#ff2a4a'; t.style.fontSize = '26px';
      t.innerHTML = '⚠ SUPER BOSS<br><span style="font-size:12px;color:#ffd0d6">Premium loot · clear it for the big drops</span>';
      el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 2400);
    } else if (kind === 'superdown') {
      toast('⚠ SUPER BOSS DOWN — premium loot dropped!', '#ff6a78');
    } else { toast('☠ Boss down — elite loot dropped!', '#e07c12'); }
  }
  function galaxyChanged() { if (_inited && screen === 'galaxy') renderGalaxy(); }
  function galaxyContestToast(name, tile) { if (_inited) toast('⚔ ' + name + ' captured your ' + tile + ' — retake it!', '#e8a34a'); }
  // ---- PILOT ASCENSION rank badge -----------------------------------------
  // One helper used everywhere a pilot name appears: boards, profiles, galaxy
  // tooltips, war reports. Stars are coloured by the loot-rarity tier the pilot
  // has climbed to (5 stars per rarity), matching Ship Ascension's model.
  function ascOf(p) {
    if (!p) return 0;
    if (p.isMe) { try { return window.PASCEND ? window.PASCEND.stars() : 0; } catch (e) { return 0; } }
    return (p.asc | 0) || 0;
  }
  function ascBadge(p, opts) {
    const n = ascOf(p);
    if (!n || !window.PASCEND) return '';
    return window.PASCEND.badge(null, n, opts || {});
  }
  // SIM designation — never inferred from a name; comes from the protected
  // is_simulated column via SIMPILOTS.
  function simChip(p) { try { return window.SIMPILOTS ? window.SIMPILOTS.chip(p) : ''; } catch (e) { return ''; } }
  // FLEET THUMBNAILS on a leaderboard row. A published fleet can name a hull
  // this build has no art for — a renamed key, an event hull added ahead of its
  // sprite — and the row then rendered the browser's broken-image glyph in the
  // flagship slot. Unknown keys are dropped before the tag is written, and a
  // 404 on a known key removes its own <img> the way every other ship thumbnail
  // in the game already does.
  function fleetThumbs(keys) {
    return (keys || [])
      .filter((fk) => fk && C.SHIP_BY_KEY[fk])
      .map((fk) => `<img class="lbf" src="ships/ship-${fk}.png" alt="" loading="lazy" onerror="this.remove()" title="${C.SHIP_BY_KEY[fk].name}">`)
      .join('');
  }
  function ascLine(p) {
    const n = ascOf(p);
    if (!n || !window.PASCEND) return '';
    const t = window.PASCEND.tierDef(n);
    return ` · Ascension <b style="color:${t.color}">${n}</b> <span style="font-size:11px;color:var(--muted)">(${t.name} ★${window.PASCEND.starOf(n)})</span>`;
  }

  function siegeEvent(kind, s) {
    if (!_inited) return;
    if (kind === 'timeout') { toast('🛡 DEFENCE HELD — their fleet survived 60s. Towing you out · tile shielded 15 min.', '#8fb7d9'); return; }
    if (kind === 'start') { toast('⚔ Siege begun — clear 10 waves', '#5b9cff'); }
    else if (kind === 'wavezone') { toast('★ Wave Zone cleared — the gauntlet resets', '#5bc06b'); }
    else if (kind === 'citadel') { const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#ff9a50'; t.style.fontSize = '22px'; t.innerHTML = '⛴ THE VOID CITADEL<br><span style="font-size:12px;color:#ffd9c4">Burn it down — 75% · 50% · 25% · boom</span>'; el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 2400); }
    else if (kind === 'citadeldown') { const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#ffd24d'; t.style.fontSize = '24px'; t.innerHTML = '☀ SUPERNOVA<br><span style="font-size:12px;color:#ffe9b0">Citadel razed — grab the loot!</span>'; el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 2600); }
    else if (kind === 'citadelhome') { toast('⌂ Siege complete — towed home. Citadel rebuilds in 15 min.', '#9ec5ff'); }
    else if (kind === 'towhome') { toast('⌂ Territory secured — towed back to your hangar', '#9ec5ff'); showScreen(s && s.casino ? 'casino' : s && s.voidzone ? 'voidzone' : 'galaxy'); }
    else if (kind === 'wave') { toast('Wave ' + s.wave + ' / ' + s.total, '#9ec5ff'); }
    else if (kind === 'boss') { const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#e23b4e'; t.style.fontSize = '22px'; t.textContent = '☠ BOSS WAVE'; el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 1700); }
    else if (kind === 'clone') {
      // MATCHUP FORECAST — the clone fight is decided by true fleet power, so say
      // so out loud before the shooting starts.
      const o = (s && s.odds) || 'even';
      const col = o === 'outmatched' ? '#ff5a68' : o === 'favoured' ? '#7ce0a0' : '#ffd24d';
      const t = document.createElement('div'); t.className = 'lvl-toast';
      t.style.color = col; t.style.fontSize = '19px';
      t.innerHTML = '⚔ ' + ((s && s.name) ? String(s.name).toUpperCase() : 'ENEMY') + "'S FLEET" +
        '<br><span style="font-size:11.5px;color:#dbe8f5;letter-spacing:.04em">' + ((s && s.text) || '') + '</span>';
      el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 3200);
    }
    else if (kind === 'captured') { const sys = s.sys || {}; const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#5bc06b'; t.style.fontSize = '20px'; const _capRate = (sys.rate || 0) * (sys.deep ? GM.DEEP_MULT.resource : 1) * 25; /* mirror resourceRates(): deep ×25 + global ×25 galaxy yield */ t.innerHTML = '★ SYSTEM CAPTURED<br><span style="font-size:13px;color:#cfe9ff">' + (sys.name || '') + (sys.resource ? ' · +' + GM.RES[sys.resource].glyph + ' ' + G.formatNum(_capRate) + '/h' : '') + '</span>'; el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 2600); }
  }
  // Small wreck notice — the ship has already been auto-towed to the hangar.
  function onDeathReturn(lostItem, killerName, zone, hullReset, lostList) {
    if (!_inited) return;
    refreshAll();
    G.state.deathExplained = true; G.save();
    const multi = lostList && lostList.length > 1;
    const lostHtml = multi
      ? `Lost <b style="color:var(--hp)">${lostList.length} items</b> in the wreck<br><span style="color:var(--muted);font-size:11px">${lostList.slice(0,4).map((it)=>`<span class="${rc(it.rarity)}">${it.name}</span>`).join(', ')}${lostList.length>4?` +${lostList.length-4} more`:''} · gone for good</span>`
      : lostItem
        ? `Lost <b class="${rc(lostItem.rarity)}">${lostItem.name}</b><br><span style="color:var(--muted);font-size:11px">${C.RARITY[lostItem.rarity].name} · ${C.SLOTS[lostItem.slot].name} · gone for good</span>`
        : 'No gear was lost this time.';
    const hullHtml = (hullReset && hullReset.from > 1)
      ? `<div class="wreck-loss" style="margin-top:9px;color:#ff9a64;background:rgba(255,80,80,.08);border:1px solid rgba(255,120,120,.3);border-radius:9px;padding:9px 11px">⬇ <b>${hullReset.name}</b> hull reset to <b>Lv 1</b><br><span style="color:var(--muted);font-size:11px">Was Hull Lv ${hullReset.from} · upgrade resources forfeit</span></div>`
      : '';
    const sheet = showSheet(`<div id="wreck-pop">
      <div class="wreck-skull">☠</div>
      <div class="wreck-title">SHIP WRECKED</div>
      <div class="wreck-by">Downed by a <b>${killerName || 'hostile'}</b>${zone >= 1 ? ' in ' + zoneName(zone) : ''}</div>
      <div class="wreck-loss"${multi?' style="color:var(--hp)"':''}>${lostHtml}</div>
      ${hullHtml}
      <div class="wreck-foot">⌂ Towed back to your hangar.</div>
      <div class="sheet-actions" style="margin-top:14px"><button class="btn primary" data-x>Continue</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
  }
  // One-time pop-up when a pilot reaches Lv 100 — the endgame death stakes.
  function showCatastropheWarning() {
    const sheet = showSheet(`<div id="wreck-pop">
      <div class="wreck-skull" style="color:#ff8a4c">⚠</div>
      <div class="wreck-title" style="color:#ff8a4c">LEVEL 100 · HIGH STAKES</div>
      <div class="wreck-by">You've reached the deep endgame, Operator.</div>
      <div class="wreck-loss" style="margin-top:10px;color:#ff9a64;background:rgba(255,80,80,.08);border:1px solid rgba(255,120,120,.3);border-radius:10px;padding:11px 13px;line-height:1.5">
        <b>If your ship explodes, you can lose your ENTIRE hold.</b><br>
        <span style="color:var(--muted);font-size:11.5px">On death your items are rolled one by one — the 1st is lost for certain, the 2nd at 50%, the 3rd at 25%, and so on. Your best gear is rolled first. Don't fly anything you can't afford to lose.</span></div>
      <div class="sheet-actions" style="margin-top:14px"><button class="btn primary" data-x>Understood</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
  }
  // The moment a pilot hits the ceiling — explains the wall and the way through it.
  function showLevelCap(cap) {
    const stars = (() => { try { return window.PASCEND ? window.PASCEND.stars() | 0 : 0; } catch (e) { return 0; } })();
    const next = cap + 50;
    const sheet = showSheet(`<div id="wreck-pop">
      <div class="wreck-skull" style="color:#e05bff">✦</div>
      <div class="wreck-title" style="color:#e05bff">LEVEL ${cap} · CAP REACHED</div>
      <div class="wreck-by">This is as far as this life goes, Operator.</div>
      <div class="wreck-loss" style="margin-top:10px;color:#f2d4ff;background:rgba(224,91,255,.08);border:1px solid rgba(224,91,255,.32);border-radius:10px;padding:11px 13px;line-height:1.5">
        <b>XP no longer accrues.</b> Every kill still pays gold, resources and loot — but your pilot record is full at <b>Level ${cap}</b>, and nothing will move it.
        <div style="margin-top:8px;color:var(--muted);font-size:11.5px;line-height:1.55">The cap is <b style="color:#f2d4ff">150</b> for an un-ascended pilot and rises <b style="color:#f2d4ff">+50 per Ascension Star</b> — ★1 is 200, ★2 is 250, and it keeps climbing. You are at <b style="color:#f2d4ff">★${stars}</b>, so <b style="color:#f2d4ff">ascending once takes you to Level ${next}</b> along with permanent perks and a higher loot ceiling.</div></div>
      <div class="sheet-actions" style="margin-top:14px"><button class="btn" data-x>Later</button><button class="btn primary" data-asc>✦ Open Pilot Ascension</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    const go = sheet.querySelector('[data-asc]');
    if (go) go.addEventListener('click', () => { closeSheet(); try { showScreen('pasc'); if (window.PASCEND) window.PASCEND.render(); } catch (e) {} });
  }
  // THE GATE IS OPEN — fired once per star, the moment the pilot reaches their
  // level cap. It is an OPTION, not an instruction: the two roads get equal weight
  // and equal space, and nothing here is styled as the recommended one.
  function showAscendGate(gate, cap) {
    const s = G.state || {};
    const stars = (() => { try { return window.PASCEND ? window.PASCEND.stars() | 0 : 0; } catch (e) { return 0; } })();
    const pts = (() => { try { return (window.PASCEND.preview() || {}).total | 0; } catch (e) { return 0; } })();
    const toCap = Math.max(0, (cap | 0) - (s.level | 0));
    const sheet = showSheet(`<div id="asc-gate-pop">
      <div class="wreck-skull" style="color:#e05bff">✦</div>
      <div class="wreck-title" style="color:#e05bff">ASCENSION UNLOCKED</div>
      <div class="wreck-by">You reached <b>Level ${G.formatNum(gate)}</b> — the ceiling for ★${stars}. The pilot run can now be traded in.</div>
      <div style="margin-top:12px;display:grid;gap:9px">
        <div style="border:1px solid rgba(224,91,255,.32);background:rgba(224,91,255,.07);border-radius:11px;padding:11px 13px">
          <div style="font:800 10px/1 'Rajdhani',sans-serif;letter-spacing:.14em;color:#e05bff;margin-bottom:6px">✦ ASCEND NOW</div>
          <div style="font-size:12.5px;line-height:1.55;color:#f2d4ff">Bank <b>+${pts} ascension point${pts === 1 ? '' : 's'}</b> and <b>+1 ★</b>. Your ceiling rises to <b>Lv ${G.formatNum((cap | 0) + 50)}</b>. The pilot run restarts at Level 1 — <b>your whole fleet comes with you</b>.</div>
        </div>
        <div style="border:1px solid var(--line-2,#37475f);border-radius:11px;padding:11px 13px">
          <div style="font:800 10px/1 'Rajdhani',sans-serif;letter-spacing:.14em;color:#8fa3bd;margin-bottom:6px">△ KEEP PLAYING</div>
          <div style="font-size:12.5px;line-height:1.55;color:var(--muted,#93a2ba)">${toCap > 0
            ? `<b style="color:#cfe0f5">${toCap} more level${toCap === 1 ? '' : 's'}</b> to the Lv ${G.formatNum(cap)} cap. Nothing expires, and every level you add makes the ascension payout bigger.`
            : `You are at the Lv ${G.formatNum(cap)} cap. Kills still pay gold, resources, loot and events — but <b style="color:#cfe0f5">XP has stopped accruing</b>, so your level will not move again until you ascend.`}</div>
        </div>
      </div>
      <div class="sheet-actions" style="margin-top:14px"><button class="btn" data-x>Later</button><button class="btn primary" data-asc>✦ Review ascension</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    const go = sheet.querySelector('[data-asc]');
    if (go) go.addEventListener('click', () => { closeSheet(); try { showScreen('pasc'); if (window.PASCEND) window.PASCEND.render(); } catch (e) {} });
  }
  function showOffline(sum) {
    const sheet = showSheet(`<div class="sheet-head">Welcome Back, Operator</div><div class="sheet-body">
      <p>Your operator held the line for <b style="color:var(--gold)">${G.formatTime(sum.elapsed)}</b> while you were away.</p>
      <div class="stat-block"><span class="sb-name">⚔ Enemies Down</span><span class="sb-val">${G.formatNum(sum.kills)}</span></div>
      <div class="stat-block"><span class="sb-name">★ XP</span><span class="sb-val">${G.formatNum(sum.xp)}</span></div>
      <div class="stat-block"><span class="sb-name"><span class="coin">$</span> Gold</span><span class="sb-val">${G.formatNum(sum.gold)}</span></div>
      <div class="stat-block"><span class="sb-name">▼ Loot Found</span><span class="sb-val">${G.formatNum(sum.found)}</span></div>
      ${sum.lost ? `<div class="stat-block"><span class="sb-name" style="color:var(--hp)">✖ Items Lost</span><span class="sb-val" style="color:var(--hp)">${sum.lost}</span></div>` : ''}
      <div class="sheet-actions" style="margin-top:14px"><button class="btn primary" data-x>Claim</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', () => { closeSheet(); refreshAll(); });
  }

  // ==========================================================================
  // PURCHASE RESULT (all platforms — web/Stripe, iOS, Android): explicit
  // confirmation screen after checkout. ok=true → thank-you; ok=false → sorry
  // + retry/support. Called by js/payments-v91.js.
  // ==========================================================================
  function purchaseResult(ok, info) {
    info = info || {};
    const what = info.label || (info.credits ? info.credits.toLocaleString() + ' LootCoins' : 'your purchase');
    if (ok) {
      const sheet = showSheet(`<div class="sheet-head" style="color:#7ce0a0">✓ Purchase complete</div><div class="sheet-body" style="text-align:center">
        <div style="font-size:44px;line-height:1;margin:6px 0 10px">🎉</div>
        <p style="font-size:15px;font-weight:700;margin-bottom:6px">Thanks for purchasing ${what}!</p>
        <p style="font-size:12px;color:var(--muted);line-height:1.55">${info.credits ? 'The coins are in your balance now — check the top bar.' : 'It\u2019s active on your account now.'} A receipt was sent to your payment email.</p>
        <div class="sheet-actions" style="margin-top:14px;justify-content:center"><button class="btn gold" data-x>Awesome</button></div></div>`);
      sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    } else {
      const sheet = showSheet(`<div class="sheet-head" style="color:#ff8a96">Purchase not completed</div><div class="sheet-body">
        <p style="font-size:14px;font-weight:700;margin-bottom:6px">Sorry — we couldn\u2019t confirm ${what}.</p>
        <p style="font-size:12px;color:var(--muted);line-height:1.55">If you cancelled checkout, nothing was charged. If you <b>did</b> complete payment, don\u2019t worry — delivery can take a couple of minutes and will land automatically. You can also re-check now, or contact support with your receipt and we\u2019ll credit it manually.</p>
        <div class="sheet-actions" style="margin-top:14px"><button class="btn" data-x>Close</button><button class="btn" data-retry>Check again</button><a class="btn" href="mailto:support@lootfleet.com?subject=Purchase%20issue" style="text-decoration:none;text-align:center">Contact support</a></div></div>`);
      sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
      sheet.querySelector('[data-retry]').addEventListener('click', () => {
        const b = sheet.querySelector('[data-retry]'); b.disabled = true; b.textContent = 'Checking…';
        Promise.resolve(window.PAYMENTS && window.PAYMENTS.claimWallet && window.PAYMENTS.claimWallet()).then((row) => {
          if (row && (row.credits > 0 || row.pro_until)) closeSheet();
          else { b.disabled = false; b.textContent = 'Check again'; toast('No new purchase found yet — try again in a minute', '#ffcf7a'); }
        });
      });
    }
  }

  // ==========================================================================
  // THE EMBER CHOIR — Zone Grind incursion. Briefing, roster and the recovery
  // payoff. Kaevith is the galaxy-map event and pays XP; the Choir is the Zone
  // Grind event and pays BEACON. Deliberately the same shape of UI as the
  // Kaevith sheet so the two read as siblings, with its own palette (obsidian
  // and molten gold) so they are never confused.
  // ==========================================================================
  const EMB_SHIPS = ['emb1', 'emb2', 'emb3', 'emb4', 'emb5'];
  const EMB_ZONEBAND = { emb1: '10–49', emb2: '50–119', emb3: '120–249', emb4: '250–399', emb5: '400+' };
  function embRoster() {
    return EMB_SHIPS.map((k, i) => {
      const s = C.SHIP_BY_KEY[k]; if (!s) return '';
      const owned = !!(G.state.ownedShips && G.state.ownedShips[k]);
      const b = s.beacon || {};
      return `<div class="er-row ${owned ? 'have' : ''}">
        <img src="ships/ship-${k}.png" alt="">
        <div class="er-m"><div class="er-n">${s.name}${owned ? ' <i>✔ recovered</i>' : ''}</div>
          <div class="er-c">${s.cls} · garrisons zones <b>${EMB_ZONEBAND[k]}</b></div>
          <div class="er-b">
            <span class="erb cd">−${b.cdCut}% recharge</span>
            <span class="erb life">+${b.life}% duration</span>
            <span class="erb size">+${b.size}% swarm</span>
            <span class="erb loot">+${b.loot}% loot</span>
          </div>
        </div>
      </div>`;
    }).join('');
  }
  function openEmberBriefing() {
    const eb = G.emberBeaconBonus ? G.emberBeaconBonus() : null;
    const rate = G.emberRate ? G.emberRate() : 30;
    const minZ = G.emberMinZone ? G.emberMinZone() : 10;
    const bs = G.beaconState ? G.beaconState() : null;
    const have = EMB_SHIPS.filter((k) => G.state.ownedShips && G.state.ownedShips[k]).length;
    const sheet = showSheet(`<div class="sheet-head">✦ THE EMBER CHOIR</div><div class="sheet-body emb-sheet">
      <div class="emb-hero">
        <img class="emb-hero-art" src="ships/ship-emb5.png" alt="">
        <div class="eh-tag">LIVE EVENT · ZONE GRIND</div>
        <div class="eh-t">THE EMBER CHOIR</div>
        <div class="eh-s">They hunt by <b>signal</b>. Obsidian husks lit from within, drifting toward every distress call ever broadcast — and roughly <b>one zone in ${rate}</b> already answers to them.</div>
      </div>
      <div class="emb-steps">
        <div class="es-row"><span class="es-n">1</span><div><b>One zone in ${rate} is Choir-claimed.</b> Fixed zones, the same for every commander, from <b>Zone ${minZ}</b> up. The zone list marks them <b class="es-hl">CHOIR</b> — nothing else about the zone changes.</div></div>
        <div class="es-row"><span class="es-n">2</span><div><b>They take over the ending.</b> The encounter that closes the zone — the roaming boss, or the boss after a wave zone's final wave — is replaced by a Choir hull: <b>+55% hull, +28% damage</b>. Citadel sieges are never touched.</div></div>
        <div class="es-row"><span class="es-n">3</span><div><b>Kill it for a chance to keep it.</b> <b>0.9%</b> in the shallows, rising to <b>5%</b> deep. Which hull is fixed by depth, so a specific hull means travelling for it.</div></div>
        <div class="es-row"><span class="es-n">4</span><div><b>The reward is your ◉ BEACON.</b> Choir hulls in your fleet — flagship or escort — cut its <b>recharge</b>, stretch its <b>swarm window</b>, widen the <b>swarm</b> and raise the <b>loot every summoned kill drops</b>. Bonuses add across hulls.</div></div>
      </div>
      ${eb && eb.hulls ? `<div class="emb-now">
        <div class="en-h">YOUR RESONANCE RIGHT NOW · ${eb.hulls} hull${eb.hulls === 1 ? '' : 's'} in the fleet</div>
        <div class="en-grid">
          <div class="en-c"><b>−${Math.round(eb.cdCut * 100)}%</b><span>recharge</span></div>
          <div class="en-c"><b>+${Math.round(eb.life * 100)}%</b><span>duration</span></div>
          <div class="en-c"><b>+${Math.round(eb.size * 100)}%</b><span>swarm size</span></div>
          <div class="en-c"><b>+${Math.round(eb.loot * 100)}%</b><span>beacon loot</span></div>
        </div>
        ${bs ? `<div class="en-live">Your beacon: <b>${bs.cd}s</b> recharge · <b>${bs.life}s</b> window · <b>×${bs.mult}</b> swarm</div>` : ''}
        ${eb.capped ? '<div class="en-cap">⚠ One or more bonuses are at their ceiling — the extra is doing nothing.</div>' : ''}
      </div>` : '<div class="emb-now empty">No Choir hull in your fleet — your beacon is running on the Defense tree and ascension perks alone.</div>'}
      <div class="lo-sect">Where they sing next</div>
      <div class="emb-next">${(() => {
        const hi = G.state.highestUnlocked || 1, out = [];
        for (let z = 10; z <= hi + 900 && out.length < 12; z++) {
          if (!(G.isEmberZone && G.isEmberZone(z))) continue;
          const t = G.emberTierFor ? G.emberTierFor(z) : 1;
          out.push('<span class="emb-nz ' + (z <= hi ? 'open' : 'deep') + '">Z' + z + ' <i>' + ['I','II','III','IV','V'][t - 1] + '</i></span>');
        }
        return out.join('');
      })()}</div>
      <div class="emb-next-note">…and on forever — one zone in ${rate}, at every depth. Dimmed zones are past your current front line.</div>
      <div class="lo-sect">The five hulls · ${have}/5 recovered</div>
      <div class="emb-roster">${embRoster()}</div>
      <div class="sheet-actions"><button class="btn" data-x>Close</button><button class="btn gold" data-ok>✦ Find a Choir zone</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    const ok = sheet.querySelector('[data-ok]');
    if (ok) ok.addEventListener('click', () => { closeSheet(); const n = document.querySelector('.nav-btn[data-screen="dungeon"]'); if (n) n.click(); });
  }
  // Fires on killing the hull that ends a Choir zone — win or lose, so the roll is
  // never silent (the same contract as the Kaevith result popup).
  function emberTechResult(r) {
    if (!_inited || !r) return;
    // ONE VEIL, EVER. This appended straight to <body> with no check for one
    // already up, so clearing several Choir zones in a row stacked popups on top
    // of each other and the player had to dismiss them one at a time — with the
    // oldest, least relevant result on top of the pile. A newer result supersedes
    // an older one instead. (Same guard covers the Kaevith veil, which is built
    // to the same contract and stacked the same way.)
    document.querySelectorAll('.emb-veil, .xen-veil').forEach((n) => {
      if (n._cdT) clearTimeout(n._cdT);
      n.remove();
    });
    const o = document.createElement('div');
    o.className = 'emb-veil';
    const b = r.won && r.ship ? (r.ship.beacon || {}) : {};
    o.innerHTML = r.won
      ? `<div class="embres win">
        <div class="embres-tag">CHOIR HULL RECOVERED</div>
        <img class="embres-art" src="ships/ship-${r.key}.png" alt="">
        <div class="embres-t">${r.ship.name}</div>
        <div class="embres-c">${r.ship.cls} · Choir ${['I','II','III','IV','V'][r.tier - 1]}</div>
        <div class="embres-b">
          <span class="erb cd">−${b.cdCut}% recharge</span>
          <span class="erb life">+${b.life}% duration</span>
          <span class="erb size">+${b.size}% swarm</span>
          <span class="erb loot">+${b.loot}% loot</span>
        </div>
        <div class="embres-note">A <b>${r.pct}%</b> roll — the <b>${ord(r.nth)}</b> you have recovered. It's in your hangar; put it in the fleet to switch the bonus on.</div>
        <button class="embres-x" data-x>Continue</button>
      </div>`
      : `<div class="embres miss">
        <div class="embres-tag">THE HUSK GAVE UP NOTHING</div>
        <div class="embres-g">✦</div>
        <div class="embres-t2">${(C.SHIP_BY_KEY[r.key] || {}).name || 'The Choir hull'} broke apart</div>
        <div class="embres-c2">${r.owned
          ? (r.complete ? 'You already hold all five Choir hulls — there is nothing left to recover here.' : 'You already hold this hull. Deeper Choir zones garrison the ones you don\u2019t.')
          : 'This zone rolled a <b>' + r.pct + '%</b> chance to recover it. The kill still paid its full boss loot.'}</div>
        <button class="embres-x" data-x>Continue</button>
      </div>`;
    document.body.appendChild(o);
    // AND IT CLOSES ITSELF. A result card the player has read is an obstacle; one
    // they walked away from mid-fight is a blocked screen. The win card holds
    // longer because it has a stat block worth reading — the miss card says one
    // thing. Tapping Continue or the backdrop still closes it immediately.
    const LIFE = r.won ? 14000 : 7000;
    const close = () => { if (o._cdT) { clearTimeout(o._cdT); o._cdT = null; } o.remove(); };
    o._cdT = setTimeout(close, LIFE);
    {
      const card = o.querySelector('.embres');
      if (card) {
        card.style.position = card.style.position || 'relative';
        card.style.overflow = 'hidden';
        const bar = document.createElement('i');
        bar.style.cssText = 'position:absolute;left:0;bottom:0;height:3px;width:100%;transform-origin:left center;'
          + 'background:' + (r.won ? '#ffb347' : '#6d7b90') + ';opacity:.65;'
          + 'animation:embcd ' + LIFE + 'ms linear forwards';
        card.appendChild(bar);
      }
    }
    o.querySelector('[data-x]').addEventListener('click', close);
    o.addEventListener('click', (e) => { if (e.target === o) close(); });
    if (r.won) { try { if (window.FX && FX.flash) FX.flash('#ffb347'); } catch (e) {} }
  }
  // the countdown bar's one keyframe, injected once
  (function embCd() {
    if (document.getElementById('emb-cd-css')) return;
    const s = document.createElement('style');
    s.id = 'emb-cd-css';
    s.textContent = '@keyframes embcd{from{transform:scaleX(1)}to{transform:scaleX(0)}}';
    document.head.appendChild(s);
  })();
  function ord(n) {
    const v = n | 0; if (!v) return '1st';
    const s = ['th', 'st', 'nd', 'rd'][(v % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][v % 100] || 'th';
    return v + s;
  }

  window.UI = { xynResult, fleetSlotsHTML, wireFleetSlots, syncJoystick: () => { try { syncJoystickVisible(); } catch (e) {} }, bagTrace, focusGalaxyTile, openMySystems, openEmberBriefing, emberTechResult, openAccountSheet, init, syncHUD, syncAuto, refreshAll, syncStatsTab, syncBag, onLoot, lootScrapped, onCollect, onLevelUp, onDeathReturn, showCatastropheWarning, showLevelCap, showAscendGate, showOffline, unlockToast, bossEvent, blueprintEvent, xenTechResult, openXenBriefing, shipBuilt, siegeEvent, galaxyChanged, galaxyContestToast, openAccountSheet, purchaseResult, showScreen, openProSheet, openShipDetail };
})();
