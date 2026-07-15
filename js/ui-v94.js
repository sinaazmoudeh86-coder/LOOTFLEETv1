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
  let _lcmTimer = null;    // LootCoin market countdowns (Cosmic Cache / Primordial Vault)
  let _buildTick = null;   // live countdown refresh while an Oblivion hull is under construction
  let _msTaps = 0;          // SECRET Mothership unlock: CONSECUTIVE "My Ship" click streak
  let _fleetTaps = 0;       // SECRET full-armada unlock: CONSECUTIVE "My Fleet" (HUD) click streak
  let _lbTaps = 0;          // SECRET Chroma Regent unlock: CONSECUTIVE "Leaderboard" tab click streak

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
     'zb-name','zb-sub','advice','loot-feed','cargo-full','toast-layer','joystick','speed-row','auto-btn','auto-lbl',
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
    buildSpeedRow();
    el['auto-btn'].addEventListener('click', () => { G.setAuto(!G.getAuto()); syncAuto(); });
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
    }, true);
    {
      const pbf = document.getElementById('pb-fleet');
      if (pbf) { pbf.style.cursor = 'pointer'; pbf.addEventListener('click', tapMyFleet); }
      const lcb = document.getElementById('hud-lcbuy');
      if (lcb) lcb.addEventListener('click', openCredits);
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
  function showScreen(name) {
    // Defense-in-depth: ignore unknown screens (e.g. a nav button with no
    // data-screen) BEFORE mutating any state, so a bad name can never crash.
    const sc = (name && name !== 'battle') ? $('screen-' + name) : null;
    if (name !== 'battle' && !sc) return;
    screen = name;
    document.querySelectorAll('.screen.overlay').forEach((s) => s.classList.remove('active'));
    if (sc) sc.classList.add('active');
    const navName = (name === 'hero') ? 'store' : name;
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.screen === navName));
    if (name === 'hero') renderHero();
    else if (name === 'bag') renderBag();
    else if (name === 'zones') renderZones();
    else if (name === 'galaxy') renderGalaxy();
    else if (name === 'store') renderStore();
    else if (name === 'board') renderBoard();
    else if (name === 'skills') renderSkills();
    else if (name === 'pilot') { if (window.DREAD) window.DREAD.renderPilot(); }
    else if (name === 'dread') { if (window.DREAD) window.DREAD.renderHunt(); }
    else if (name === 'sdread') { if (window.SDREAD) window.SDREAD.render(); }
    else if (name === 'boxes') { if (window.GBOX) window.GBOX.render(); }
    else if (name === 'shipworks') { if (window.SHIPWORKS) window.SHIPWORKS.render(); }
    else if (name === 'ascend') { if (window.ASCEND) window.ASCEND.render(); }
    else if (name === 'casino') { if (window.CASINO) window.CASINO.render(); }
    else if (name === 'missions') { if (window.MISSIONS) window.MISSIONS.render(); }
    else if (name === 'moon') { if (window.MOON) window.MOON.render(); }
    syncJoystickVisible();
  }

  // ==========================================================================
  // HUD (every frame)
  // ==========================================================================
  function syncHUD() {
    if (!_inited) return;
    const s = G.state;
    el['hud-level'].textContent = s.level;
    const need = C.xpToNext(s.level);
    el['xp-fill'].style.width = Math.max(0, Math.min(100, s.xp / need * 100)) + '%';
    el['xp-label'].textContent = `${G.formatNum(s.xp)} / ${G.formatNum(need)} XP`;
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
    if (el['hud-lc'] && G.getCredits) {
      const v = (G.formatNumRaw || G.formatNum)(G.getCredits());
      if (el['hud-lc'].textContent !== v) el['hud-lc'].textContent = v;
    }
    // WALLET FIT GUARD — when balances grow long, drop the /h rates first, then
    // compress the chips, and as a last resort WRAP to a second row — every
    // currency is always fully visible, nothing clips or overlaps.
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
          w.classList.remove('tight', 'tighter', 'tightest', 'wrap');
          if (w.scrollWidth > w.clientWidth + 1) w.classList.add('tight');
          if (w.scrollWidth > w.clientWidth + 1) w.classList.add('tighter');
          if (w.scrollWidth > w.clientWidth + 1) w.classList.add('tightest');
          if (w.scrollWidth > w.clientWidth + 1) w.classList.add('wrap');   // final stage: 2 rows, all chips visible
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
    el['hud-kills'].textContent = G.formatNum(s.totalKills) + ' kills';
    const safe = s.currentDungeon < 1;
    const aw = el['arena-wrap'] || (el['arena-wrap'] = document.getElementById('arena-wrap'));
    if (aw) aw.classList.toggle('in-hangar', safe);
    const sys = (G.sysAt && s.currentSystem) ? G.sysAt(s.currentSystem) : null;
    const sysName = sys ? sys.name : ('Zone ' + s.currentDungeon);
    el['zb-name'].textContent = safe ? '⌂ Hangar' : sysName;
    el['zb-sub'].textContent = safe ? 'Home bay' : ('Lv ' + s.currentDungeon + (sys && G.isOwned && G.isOwned(s.currentSystem) ? ' · owned' : ''));
    const adv = G.zoneAdvice();
    // advice shows only when it adds info: deploy prompt in safe zone, or a
    // push-up / back-off recommendation. Hidden when the current zone is fine.
    const a2 = el['advice'];
    const msg = safe ? 'Tap above to open the Galaxy Map →' : adv.msg;
    const show = safe || adv.kind === 'up' || adv.kind === 'down';
    if (a2.textContent !== msg) a2.textContent = msg;
    a2.className = (safe ? 'safe' : adv.kind) + (show ? ' show' : '');
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
      const wv = wz.bossSpawned ? (wz.clone ? '⚔ ENEMY CLONE FLEET' : isSuper ? 'SUPER BOSS' : cit ? '⛴ RAZE THE CITADEL' : 'BOSS') : (cit ? 'ASSAULT ' : 'WAVE ') + Math.min(wz.wave, wz.total) + ' / ' + wz.total;
      el['sg-fill'].style.width = (citE ? Math.max(0, citE.hp / citE.maxHp * 100) : Math.min(100, ((wz.bossSpawned ? wz.total : wz.wave - 1) / wz.total) * 100)) + '%';
      el['sg-label'].textContent = '⚔ ' + wv;
      bb.classList.remove('show', 'active');
    } else {
      sgb.classList.remove('show');
      if (safe) { bb.classList.remove('show', 'active'); }
      else {
        const bi = G.getBossInfo();
        bb.classList.add('show');
        if (bi.alive) { bb.classList.add('active'); el['bb-fill'].style.width = Math.max(0, bi.hp / bi.max * 100) + '%'; el['bb-label'].textContent = '☠ ' + (bi.name || 'BOSS'); }
        else { bb.classList.remove('active'); el['bb-fill'].style.width = (bi.progress * 100) + '%'; const m = Math.floor(bi.timeLeft/60), sec = bi.timeLeft%60; el['bb-label'].textContent = bi.progress > 0.985 ? 'BOSS INCOMING' : `Boss in ~${m}:${sec<10?'0':''}${sec}`; }
      }
    }
  }

  function refreshAll() {
    if (!_inited) return;
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
      pills[i].innerHTML = `<span>${tier.label}</span>` + (locked ? (tier.pro ? '<span class="spd-pro">PRO</span>' : LC_ICON) : '');
    });
  }
  // ==========================================================================
  // ACCOUNT SHEET — opened from the top-bar name chip: profile, Pro manage,
  // password reset, text-alert signup, sign out.
  // ==========================================================================
  function openAccountSheet() {
    const s = (window.AUTH && window.AUTH.session && window.AUTH.session()) || {};
    const cloud = s.method === 'Supabase';
    const pro = G.isPro && G.isPro();
    const sheet = showSheet(`<div class="sheet-head">⚙ Account</div><div class="sheet-body">
      <div class="ip-stat"><span class="ip-sname">Pilot</span><span class="v">${s.name || 'Operator'}</span></div>
      <div class="ip-stat"><span class="ip-sname">Account</span><span class="v">${cloud ? (s.email || 'Cloud') : (s.method || 'Local')}</span></div>
      <div class="lo-sect" style="margin-top:11px">Profile</div>
      <div class="acct-row"><input id="ac-name" class="acct-in" maxlength="18" placeholder="New pilot name"><button class="btn" id="ac-rename">Rename</button></div>
      <div class="lo-sect" style="margin-top:11px">★ LootFleet Pro</div>
      <div class="ip-stat"><span class="ip-sname">Status</span><span class="v" style="color:${pro ? '#7ce0a0' : 'var(--muted)'}">${pro ? 'ACTIVE · renews ' + new Date(G.state.proUntil).toLocaleDateString() : 'Not subscribed'}</span></div>
      <div class="acct-row">${pro ? '<button class="btn" id="ac-manage">Manage / cancel subscription</button>' : '<button class="btn gold" id="ac-gopro">★ Go Pro — $19.99/mo</button>'}</div>
      <div class="lo-sect" style="margin-top:11px">Security</div>
      <div class="acct-row">${cloud && s.email ? '<button class="btn" id="ac-reset">Send password-reset email</button>' : '<span class="acct-hint">Password reset needs a cloud account — sign up with email to enable it.</span>'}</div>
      <div class="lo-sect" style="margin-top:11px">📱 Text alerts</div>
      <p class="acct-hint" style="margin-bottom:6px">Get a text for big updates, heat resets &amp; exclusive drops.</p>
      <div class="acct-row"><input id="ac-phone" class="acct-in" type="tel" placeholder="+1 555 123 4567" value="${G.state.smsPhone || ''}"><button class="btn" id="ac-sms">${G.state.smsOptIn ? 'Update' : 'Sign up'}</button></div>
      ${G.state.smsOptIn ? '<p class="acct-hint" style="color:#7ce0a0">✓ Signed up — you can opt out anytime here.</p>' : ''}
      <div class="lo-sect" style="margin-top:11px">🛠 Support</div>
      <div class="acct-row"><a class="btn" href="support.html" target="_blank" rel="noopener" style="text-decoration:none;text-align:center;flex:1">Help &amp; Support</a></div>
      ${(window.LF_FS && window.LF_FS.supported) ? `<div class="lo-sect" style="margin-top:11px">Display</div>
      <div class="acct-row"><button class="btn" id="ac-fs" style="flex:1">⛶ ${(window.LF_FS.on && window.LF_FS.on()) ? 'Exit full screen' : 'Enter full screen'}</button></div>` : ''}
      <div class="lo-sect" style="margin-top:11px;color:#ff8a96">Danger zone</div>
      <p class="acct-hint" style="margin-bottom:6px">Permanently delete your account, save data and leaderboard entry. This cannot be undone.</p>
      <div class="acct-row"><button class="btn" id="ac-delete" style="border-color:rgba(255,73,95,.5);color:#ff8a96">Delete account…</button></div>
      <div class="sheet-actions" style="margin-top:14px"><button class="btn" data-x>Close</button><button class="btn" id="ac-signout" style="border-color:rgba(255,73,95,.5);color:#ff8a96">⏻ Sign out</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    const $s = (id) => sheet.querySelector('#' + id);
    const rn = $s('ac-rename');
    if (rn) rn.addEventListener('click', () => {
      const v = ($s('ac-name').value || '').trim();
      if (v.length < 3) { toast('Name needs 3+ characters', '#e23b4e'); return; }
      if (window.ACCOUNT && window.ACCOUNT.setName && window.ACCOUNT.setName(v)) { toast('✓ Pilot name updated', '#7ce0a0'); closeSheet(); refreshAll(); }
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
    const sm = $s('ac-sms'); if (sm) sm.addEventListener('click', () => {
      const v = ($s('ac-phone').value || '').trim();
      if (!/^[+0-9][0-9 ()\-]{6,18}$/.test(v)) { toast('Enter a valid phone number (with country code)', '#e23b4e'); return; }
      G.state.smsPhone = v; G.state.smsOptIn = true; G.save();
      toast('✓ Text alerts on — ' + v, '#7ce0a0'); closeSheet();
    });
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
      try { if (window.AUTH && window.AUTH.deleteAccount) await window.AUTH.deleteAccount(); }
      catch (e) { toast('Could not delete — try again or email support@lootfleet.com', '#e23b4e'); go.disabled = false; go.textContent = 'Delete permanently'; }
    });
  }
  function openProSheet() {
    const pro = G.isPro && G.isPro();
    const conf = window.PAYMENTS && window.PAYMENTS.linkFor && !!window.PAYMENTS.linkFor('pro_monthly');
    // Apple Guideline 3.1.2 — the purchase sheet must state the subscription
    // title, duration, price, what the user gets, and link Privacy + Terms.
    const sheet = showSheet(`<div class="sheet-head">★ LootFleet Pro</div><div class="sheet-body">
      <div class="ip-stat"><span class="ip-sname">Subscription</span><span class="v">LootFleet Pro</span></div>
      <div class="ip-stat"><span class="ip-sname">Duration</span><span class="v">Monthly · auto-renews</span></div>
      <div class="ip-stat"><span class="ip-sname">Price</span><span class="v">$19.99 / month</span></div>
      <div class="lo-sect" style="margin-top:10px">What you get</div>
      <div class="ip-stat"><span class="ip-sname">⚡ Battle speed</span><span class="v">Exclusive 5× tier — Pro only</span></div>
      <div class="ip-stat"><span class="ip-sname">✨ Experience</span><span class="v">2× XP on every kill, account-wide</span></div>
      <p style="font-size:10.5px;line-height:1.55;color:var(--muted);margin-top:10px">Payment is charged to your account at confirmation of purchase. The subscription renews automatically each month at $19.99 unless cancelled at least 24 hours before the end of the current period. Manage or cancel anytime in your account settings.</p>
      <p style="font-size:11px;margin-top:8px"><a href="privacy.html" target="_blank" rel="noopener" style="color:#5fa8ff">Privacy Policy</a> · <a href="terms.html" target="_blank" rel="noopener" style="color:#5fa8ff">Terms of Use</a></p>
      ${pro ? `<p style="font-size:11px;color:#7ce0a0;margin-top:8px">✓ Active — renews ${new Date(G.state.proUntil).toLocaleDateString()}</p>` : ''}
      ${conf ? '' : '<p style="font-size:10.5px;color:#ffcf7a;margin-top:8px">⚒ Subscriptions are not live yet — payments are being wired up.</p>'}
      <div class="sheet-actions"><button class="btn" data-x>Close</button>
        ${pro ? '' : '<button class="btn gold" data-ok>★ Buy Subscription — $19.99/mo</button>'}</div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
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
    const sheet = showSheet(`<div class="sheet-head">${LC_ICON} Unlock ${sh.name}</div><div class="sheet-body">
      <p style="font-size:11.5px;color:var(--muted);line-height:1.5;margin-bottom:9px">${sh.desc}</p>
      <div class="ip-stat"><span class="ip-sname">Fast-track</span><span class="v">No blueprint · no kill requirement · yours instantly</span></div>
      <div class="ip-stat"><span class="ip-sname">Price</span><span class="v">${LC_ICON} ${price.toLocaleString()} LootCoins</span></div>
      <div class="ip-stat"><span class="ip-sname">Your balance</span><span class="v" style="color:${afford ? '#7ce0a0' : 'var(--bad)'}">${LC_ICON} ${Math.floor(have).toLocaleString()}</span></div>
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
    const sheet = showSheet(`<div class="sheet-head">${LC_ICON} Unlock ${tier.label} Speed</div><div class="sheet-body">
      <p style="font-size:11.5px;color:var(--muted);line-height:1.5;margin-bottom:9px">Permanent ${tier.label} battle speed — the fastest tier LootCoins can buy. One-time unlock.</p>
      <div class="ip-stat"><span class="ip-sname">Price</span><span class="v">${LC_ICON} ${tier.lootcoins} LootCoins</span></div>
      <div class="ip-stat"><span class="ip-sname">Your balance</span><span class="v" style="color:${afford ? '#7ce0a0' : 'var(--bad)'}">${LC_ICON} ${(G.formatNumRaw || G.formatNum)(have)}</span></div>
      ${afford ? '' : '<p style="font-size:10.5px;color:#ffcf7a;margin-top:6px">Not enough LootCoins — grab a pack and come back.</p>'}
      <div class="sheet-actions"><button class="btn" data-x>Cancel</button>
        <button class="btn gold" data-ok>${afford ? 'Unlock ' + tier.label : 'Get LootCoins'}</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    sheet.querySelector('[data-ok]').addEventListener('click', () => {
      if (!afford) { closeSheet(); openCredits(); return; }
      const r = G.buySpeed4();
      if (r.ok) { closeSheet(); G.setGameSpeed(4); buildSpeedRow(); toast('⚡ 4× speed unlocked — permanently!', '#ffd24d'); }
      else { closeSheet(); toast('Cannot unlock', '#e23b4e'); }
    });
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
      if (G.state.auto) { G.setAuto(false); syncAuto(); toast('⌨ Manual flight — WASD / arrows', '#5b9cff'); }
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
      <p style="font-size:12px;color:var(--muted);line-height:1.6">+100B Gold · +100B LootCoins · +100B Fuel · +100B Ore · +100B Plasma · +100B Dread Cores${G.state.prism ? ' · +100B Prism Ingots' : ''}</p>
      <div class="sheet-actions" style="margin-top:14px"><button class="btn gold" data-x>Magnificent</button></div></div>`);
    sheet2.querySelector('[data-x]').addEventListener('click', closeSheet);
    toast('✦ Spectrum vault — Chroma Regent + 100B everything', '#ff7bd5');
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
    // LOOTFLEET PRO hero offering — sits just above the ship portrait
    {
      const pb = $('pro-banner');
      if (pb) {
        const pro = G.isPro && G.isPro();
        pb.innerHTML = pro
          ? `<div class="pro-offer active"><div class="po-tag">PRO</div><div class="po-main"><div class="po-name">LootFleet Pro · ACTIVE</div><div class="po-desc">⚡ 5× speed + ✨ 2× XP · renews ${new Date(G.state.proUntil).toLocaleDateString()}</div></div></div>`
          : `<div class="pro-offer" id="pro-offer-cta"><div class="po-tag">PRO</div><div class="po-main"><div class="po-name">LootFleet Pro</div><div class="po-desc">⚡ Exclusive 5× battle speed · ✨ 2× XP on every kill</div><button class="po-buy">$19.99 / month — Go Pro</button></div></div>`;
        const cta = pb.querySelector('#pro-offer-cta');
        if (cta) cta.addEventListener('click', openProSheet);
      }
    }
    el['char-power'].innerHTML = 'Power <b>' + (G.formatNumRaw || G.formatNum)(G.score ? G.score() : Math.floor(st.theoryDps + st.maxHp * 0.5)) + '</b>';
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
    let cells = `<div class="fp-slot flag"><img src="ships/ship-${flag.key}.png" alt=""><div class="fps-n">${flag.name}</div><div class="fps-tag star">★ FLAGSHIP</div></div>`;
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
    const n = G.fleetShips().length;
    panel.innerHTML = `<div class="fp-head"><span class="fp-title">⬡ Fleet</span><span class="fp-sub">${n + 1}/${1 + slots} flying · ${n > 0 ? 'Fleet Score active' : 'deploy escorts to boost your score'}</span></div><div class="fp-slots">${cells}</div>${fleetLoadoutsHTML()}`;
    panel.querySelectorAll('[data-fp]').forEach((d) => d.addEventListener('click', () => openFleetPicker(+d.dataset.fp)));
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
          const pc = it.rarity >= 11 ? ' flc-arc ' + rc(it.rarity) : '';
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
    if (st.lifeSteal > 0) html += `<div class="stat-row special"><span class="s-name">Life Steal</span><span class="s-val">${Math.round(st.lifeSteal)}%</span></div>`;
    if (st.multiShot > 0) html += `<div class="stat-row special"><span class="s-name">Multi-Shot</span><span class="s-val">${Math.round(st.multiShot)}% · 10 tgt</span></div>`;
    html += `<button class="signout-btn" id="signout-btn">Sign Out</button>`;
    el['stat-list'].innerHTML = html;
    const so = $('signout-btn'); if (so) so.addEventListener('click', () => { if (window.AUTH) window.AUTH.signOut(); });
  }

  // ==========================================================================
  // BAG
  // ==========================================================================
  function renderBag() {
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
        <div class="fr-item"><span class="fr-l">$ Sell on pickup</span><select id="autosell-pickup-sel"><option value="-1" ${AST < 0 ? 'selected' : ''}>Off</option>${C.RARITY.slice(0, 7).map((r, i) => `<option value="${i}" ${i === AST ? 'selected' : ''}>≤ ${r.name}</option>`).join('')}</select></div>
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
    else html += '<div id="bag-items">' + inv.map(itemCard).join('') + '</div>';
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
      G.setAutoSellTier(+asp.value);
      toast(+asp.value < 0 ? 'Auto-sell off' : '$ Auto-selling ' + C.RARITY[+asp.value].name + ' and below on pickup', '#e6b566');
    });
    const sel = $('sort-sel'); sel.value = sortMode; sel.addEventListener('change', () => { sortMode = sel.value; renderBag(); });
    $('auto-equip').addEventListener('click', () => { const n = G.autoEquip(); toast(n ? 'Equipped best gear' : 'Already optimal', n ? '#2f9e4f' : '#9c8d78'); });
    $('auto-always').addEventListener('click', () => { G.state.autoEquipAlways = !G.state.autoEquipAlways; if (G.state.autoEquipAlways) G.autoEquip(); G.save(); renderBag(); });
    const tierSel = $('sell-tier'), keep = $('keep-up');
    tierSel.addEventListener('change', () => { G.state.sellTier = +tierSel.value; G.save(); });
    keep.addEventListener('change', () => { G.state.keepUpgrades = keep.checked; G.save(); });
    $('auto-sell').addEventListener('click', () => openAutoSell(+tierSel.value, keep.checked));
    bindBagItems();
  }
  // Bind click-to-open on the item cards. Used by both the full renderBag and the
  // lightweight live refresh below.
  function bindBagItems() {
    const host = document.getElementById('bag-items'); if (!host) return;
    host.querySelectorAll('[data-id]').forEach((node) => node.addEventListener('click', () => {
      const it = G.state.inventory.find((x) => x.id === +node.dataset.id); if (it) openItem(it, 'inventory');
    }));
  }
  // LIVE bag refresh while farming with the Loot tab open. Rebuilds ONLY the
  // item-list container (not the whole panel) so the cargo meter, filters and
  // legend don't replay their staggered fade-in — which was the "flashing".
  function renderBagItems() {
    const host = document.getElementById('bag-items');
    if (!host) { renderBag(); return; }
    const inv = G.state.inventory.slice();
    sortInv(inv);
    const cap = G.invCap ? G.invCap() : 100;
    el['bag-sub'].textContent = inv.length + ' / ' + cap + ' slots';
    // keep the cargo-hold count + fill bar live without touching the rest of the panel
    const cf = el['bag-body'].querySelector('.cargo-fill');
    if (cf) cf.style.width = Math.min(100, inv.length / cap * 100) + '%';
    host.innerHTML = inv.length
      ? inv.map(itemCard).join('')
      : '<div class="empty-note">No loot in your bag.<br>Run over drops to collect them.</div>';
    bindBagItems();
  }
  function sortInv(inv) {
    if (sortMode === 'power') inv.sort((a,b) => G.itemPower(b) - G.itemPower(a));
    else if (sortMode === 'rarity') inv.sort((a,b) => b.rarity - a.rarity || G.itemPower(b) - G.itemPower(a));
    else if (sortMode === 'slot') inv.sort((a,b) => a.slot.localeCompare(b.slot) || b.rarity - a.rarity);
    else inv.sort((a,b) => b.ilvl - a.ilvl);
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
  function isUpgrade(it) { const cur = G.state.equipped[it.slot]; return !cur || G.itemPower(it) > G.itemPower(cur); }

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
  function renderGalaxy() {
    const res = G.getResources(), rates = G.resourceRates();
    el['galaxy-sub'].textContent = 'one galaxy · ' + GM.tileCount() + ' tiles · conquer & hold';
    let html = '<div class="res-hud">';
    GM.RES_KEYS.forEach((k) => {
      const d = GM.RES[k];
      html += `<div class="res-pill" style="--rc:${d.color}"><span class="res-g">${d.glyph}</span><span class="res-txt"><b>${G.formatNum(res[k] || 0)}</b><span class="res-rate">+${G.formatNum(rates[k] || 0)}/h</span></span></div>`;
    });
    html += '</div>';
    const feed = G.getGalaxyFeed ? G.getGalaxyFeed() : [];
    if (feed.length) {
      html += '<div class="gx-feed"><div class="gxf-h">⚔ Contested Space · live</div>';
      feed.slice(0, 3).forEach((f) => { html += `<div class="gxf-row ${f.mine ? 'mine' : ''}">${f.msg}</div>`; });
      html += '</div>';
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
    html += `<div class="gx-legend"><span class="gxl"><i style="background:#2d78eb"></i>Yours</span><span class="gxl"><i style="background:#d23b4e"></i>Rival</span><span class="gxl"><i style="background:#6c7e9c"></i>Available</span><span class="gxl"><i style="background:#4a5160"></i>Locked</span><span class="gxl">⛴ Citadel</span><span class="gxl">☠ Boss</span><span class="gxl">◷ Cooldown</span></div>`;
    el['galaxy-body'].innerHTML = html;
    bindGalaxyMap();
    drawGalaxyMap();
    clearInterval(_galaxyTimer);
    _galaxyTimer = setInterval(() => { if (screen === 'galaxy') drawGalaxyMap(); else clearInterval(_galaxyTimer); }, 1000);
  }
  function bindGalaxyMap() {
    const cv = document.getElementById('gx-canvas'); if (!cv) return;
    _gxCv = cv;
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
      drawGalaxyMap();
    });
    cv.addEventListener('pointerup', (e) => {
      if (down && !moved) {
        const r = cv.getBoundingClientRect();
        const wx = (e.clientX - r.left - cv._w / 2) / gxCam.z + gxCam.x;
        const wy = (e.clientY - r.top - cv._h / 2) / gxCam.z + gxCam.y;
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
  function drawGalaxyMap() {
    const cv = _gxCv; if (!cv || !cv._w || screen !== 'galaxy') return;
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
    for (let ring = 0; ring <= maxRing; ring++) {
      const coords = GM.ringCoords(ring);
      for (const c of coords) {
        const p = GM.pixel(c.q, c.r, GX_HEX);
        // viewport cull
        if (Math.abs(p.x - gxCam.x) > half + GX_HEX || Math.abs(p.y - gxCam.y) > half + GX_HEX) continue;
        const id = GM.tileId(c.q, c.r);
        const t = GM.tileAt(id); if (!t) continue;
        const owned = G.isOwned(id), rival = !owned && G.rivalOf(id);
        const locked = !owned && !t.home && t.level > lvl + 10;
        const active = G.state.currentSystem === id;
        const cd = t.home ? 0 : G.tileCooldownLeft(id);
        // fill by state
        let fill, edge;
        if (t.home) { fill = '#2a2438'; edge = '#f2b24b'; }
        else if (owned) { fill = 'rgba(45,120,235,0.82)'; edge = '#9fccff'; }   // YOURS — solid blue, clearly held
        else if (rival) { fill = 'rgba(210,59,78,0.42)'; edge = '#ff5468'; }     // rival — red
        else if (locked) { fill = 'rgba(74,81,96,0.25)'; edge = '#3a4150'; }
        else { fill = 'rgba(120,134,158,0.14)'; edge = '#566884'; }              // unclaimed — neutral slate
        // hex path
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 3 * i + Math.PI / 6;
          const px = p.x + Math.cos(a) * (GX_HEX - 1.5), py = p.y + Math.sin(a) * (GX_HEX - 1.5);
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = fill; ctx.fill();
        // contested lockout — dim the hex so "can't take this yet" reads at a glance
        if (cd > 0 && !owned) { ctx.fillStyle = 'rgba(5,8,14,0.48)'; ctx.fill(); }
        // PLAYER CITADEL — themed fortress: BLUE if it's yours, RED if a rival's
        {
          const myCit = owned && G.hasMyCitadel && G.hasMyCitadel(id);
          const rivCit = !myCit && G.rivalCitadelScore && G.rivalCitadelScore(id) != null;
          if (myCit || rivCit) {
            const cc = myCit ? [70, 150, 255] : [240, 60, 70];
            const tint = myCit ? '#2f7dff' : '#e23b3b';
            const pp = 0.55 + 0.45 * Math.sin(Date.now() / 380 + ring);
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
        if (t.home) { homeDraw = p; continue; }   // the hub is drawn LAST, on top
        if (!showText) {
          // zoomed out: just mark specials
          if (t.citadel) {
            const hue2 = (Date.now() / 25 + ring * 30) % 360;
            ctx.fillStyle = 'hsl(' + hue2 + ',90%,65%)';
            ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, 7); ctx.fill();
          }
          continue;
        }
        // icon + level
        ctx.textAlign = 'center';
        {
          if (t.citadel && gxCitImg.complete && gxCitImg.naturalWidth) {
            // real citadel art seated in the hex
            const dw = GX_HEX * 1.5, dh = dw * (gxCitImg.naturalHeight / gxCitImg.naturalWidth);
            ctx.drawImage(gxCitImg, p.x - dw / 2, p.y - dh / 2 - 3, dw, dh);
          } else {
            const icon = t.citadel ? '⛴' : t.boss ? '☠' : (t.resource ? GM.RES[t.resource].glyph : '');
            if (icon) { ctx.font = '800 10px Rajdhani, sans-serif'; ctx.fillStyle = t.citadel ? '#ffb088' : t.boss ? '#ff6a78' : (t.resource ? GM.RES[t.resource].color : '#9fb2d0'); ctx.fillText(icon, p.x, p.y - 3); }
          }
          ctx.font = '800 8px Rajdhani, sans-serif';
          ctx.fillStyle = locked ? '#5a6270' : '#dfe9ff';
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
    if (lab) lab.textContent = cring <= 0 ? 'CORE · Home Citadel' : 'RING ' + Math.min(GM.RINGS, cring) + ' · Lv ' + GM.ringLevel(Math.min(GM.RINGS, Math.max(1, cring)));
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
    const owner = t.owned ? 'You' : (t.rival || 'Unclaimed');
    const ownerCol = t.owned ? '#5fa8ff' : (t.rival ? '#e8a34a' : '#7fb4ff');
    const ratePerH = t.rate ? t.rate * (t.deep ? GM.DEEP_MULT.resource : 1) : 0;
    const cdTxt = t.cooldown > 0 ? (t.cooldown >= 3600 ? Math.floor(t.cooldown / 3600) + 'h ' + Math.floor((t.cooldown % 3600) / 60) + 'm' : fmtCd(t.cooldown)) : null;
    const blocked = !t.owned && t.cooldown > 0;
    const action = t.owned ? 'Deploy' : t.rival ? (t.citadel ? 'Siege' : 'Attack') : (t.citadel ? 'Siege' : 'Capture');
    const obj = t.owned ? (t.boss || t.citadel ? 'Farm endless boss waves on your tile' : 'Farm your territory')
      : (t.defense && t.rivalCitadelScore != null) ? 'Break the escort, defeat <b style="color:#ffce8a">' + t.defense.name + "'s clone fleet</b>, then <b style='color:#ff8a64'>raze their citadel</b> to take the zone"
      : t.defense ? 'Break the escort, then defeat <b style="color:#ffce8a">' + t.defense.name + "'s clone fleet</b> to take the zone"
      : t.citadel ? 'Fight up through the garrison, raze the Void Citadel, and it becomes YOUR Citadel'
      : t.boss ? 'Clear 10 waves, then defeat the <b style="color:var(--hp)">BOSS</b>' : 'Clear 10 waves to capture';
    const ec = G.entryCostFor ? G.entryCostFor(id) : null;
    // BIG VALUE HERO — what this tile pays per hour, with every multiplier spelled out
    const valChips = [];
    if (t.citadel) valChips.push('⛴ CITADEL ×' + GM.CITADEL_RATE_MULT);
    if (t.deep) valChips.push('☢ DEEP SPACE ×' + GM.DEEP_MULT.resource);
    if (t.rarity) valChips.push(t.rarity === 2 ? '★★ RARE' : '★ UNCOMMON');
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
      citBlock = '<div style="background:rgba(255,140,90,.07);border:1px solid rgba(255,140,90,.35);border-radius:10px;padding:9px 11px;margin-top:8px">' +
        '<div style="font-size:11px;font-weight:800;letter-spacing:.08em;color:#ff9a70">⛨ DEFENDING FLEET — ' + d.name.toUpperCase() + (d.real ? '' : ' <span style="opacity:.6;font-weight:600">(sim)</span>') + '</div>' +
        '<div style="display:flex;align-items:center;gap:10px;margin-top:7px">' + shipImg +
          '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:800;color:#ffce8a">' + (sn.nm || 'Clone Fleet') + '</div>' +
          '<div style="font-size:11px;color:#c9b39a;line-height:1.45">' + statBits.join(' · ') + '</div></div></div>' +
        '<div style="font-size:11px;color:#9fb0c4;margin-top:7px">A <b style="color:#ffce8a">clone of their fleet</b> garrisons this zone — beat it' + (d.citadel ? ', <b style="color:#ff8a64">then raze their citadel (Rank-hardened)</b>,' : '') + ' to take the tile.</div>' +
      '</div>';
    } else if (t.owned && G.citadelBuildCost) {
      const bc = G.citadelBuildCost(id), cn = G.citadelCount ? G.citadelCount() : 0;
      const af = bc && GM.RES_KEYS.every((k2) => (myRes[k2] || 0) >= (bc[k2] || 0));
      const can = G.canBuildCitadel && G.canBuildCitadel(id);
      const chips = GM.RES_KEYS.filter((k2) => bc && bc[k2]).map((k2) => '<span style="color:' + ((myRes[k2] || 0) >= bc[k2] ? GM.RES[k2].color : 'var(--bad)') + '">' + GM.RES[k2].glyph + ' ' + G.formatNum(bc[k2]) + '</span>').join(' &nbsp; ');
      citBlock = '<div style="background:rgba(255,210,77,.06);border:1px solid rgba(255,210,77,.3);border-radius:10px;padding:9px 11px;margin-top:8px">' +
        '<div style="font-size:12px;font-weight:700;color:#ffd24d;display:flex;justify-content:space-between;gap:8px">⛓ Build Citadel <span style="color:#9fb0c4;font-weight:600">10× output · ' + cn + '/50 owned</span></div>' +
        '<div style="font-size:12.5px;font-variant-numeric:tabular-nums;margin:7px 0;font-weight:700">' + chips + '</div>' +
        (cn >= 50 ? '<div style="font-size:10.5px;color:#ffcf7a;margin-bottom:6px">Citadel limit reached (50) — raze one to build elsewhere.</div>' : '') +
        '<button class="btn gold" data-build-cit="' + id + '" ' + (can && af ? '' : 'disabled') + ' style="width:100%">Build Citadel</button>' +
      '</div>';
    }
    const sheet = showSheet(`<div class="sheet-head">${t.rival ? 'Contest' : t.owned ? 'Your Tile' : 'Claim'} · ${t.name}</div><div class="sheet-body">
      ${valueBlock}
      <div class="ip-stat"><span class="ip-sname">Ring · Level</span><span class="v">Ring ${t.ring} · Lv ${t.level}${t.deep ? ' · ☢ DEEP SPACE' : ''}</span></div>
      <div class="ip-stat"><span class="ip-sname">Type</span><span class="v">${typeName}${t.rarity ? ' · ' + (t.rarity === 2 ? '★★ Rare' : '★ Uncommon') : ''}</span></div>
      <div class="ip-stat"><span class="ip-sname">Owner</span><span class="v" style="color:${ownerCol}">${owner}</span></div>
      <div class="ip-stat"><span class="ip-sname">Enemy difficulty</span><span class="v">Zone Lv ${t.diff}</span></div>
      <div class="ip-stat"><span class="ip-sname">Loot quality</span><span class="v">×${t.lootQ}${t.deep ? ' (deep space)' : ''}</span></div>
      ${ecRow}
      ${cdTxt && !t.owned ? `<div class="gx-shield">🛡 <b>ATTACK SHIELD</b> — this tile was attacked recently. Nobody can attack it again for <b>${cdTxt}</b>.</div>` : ''}
      ${cdTxt && t.owned ? `<div class="gx-shield mine">🛡 <b>PROTECTED</b> — your tile can't be attacked for <b>${cdTxt}</b>.</div>` : ''}
      <div class="ip-stat"><span class="ip-sname">Status</span><span class="v">${cdTxt ? '◷ ' + (t.citadel ? 'Siege lockout ' : 'Attack shield ') + cdTxt : (t.locked ? '🔒 Lv ' + Math.max(1, t.level - 10) + ' required' : '⚔ Open to attack')}</span></div>
      <div class="ip-stat"><span class="ip-sname">Objective</span><span class="v">${obj}</span></div>
      ${citBlock}
      ${t.citadel && !t.owned ? '<p style="font-size:12px;margin-top:6px;color:#ffb088">⛴ Citadels pay <b>' + GM.CITADEL_RATE_MULT + '×</b> a normal tile — but warping in costs <b>' + GM.CITADEL_COST_MULT + '×</b> and sieges are limited to <b>once per day</b>.</p>' : ''}
      ${t.deep ? '<p style="color:var(--hp);font-size:11px;margin-top:6px">⚠ Deep space — you lose <b>2 items</b> on death, but loot & resources are vastly richer.</p>' : ''}
      ${!ecAfford ? '<p style="color:var(--bad);font-size:11px;margin-top:6px">Not enough Galaxy Resources to warp this deep — farm or capture closer rings first.</p>' : ''}
      <div class="sheet-actions"><button class="btn" data-x>Close</button><button class="btn ${t.owned ? 'primary' : 'gold'}" data-ok ${(blocked || t.locked || !ecAfford) ? 'disabled' : ''}>${blocked ? '◷ ' + cdTxt : actionLabel}</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    sheet.querySelectorAll('[data-build-cit]').forEach((b) => b.addEventListener('click', () => {
      const r = G.buildCitadel(b.dataset.buildCit);
      if (r.ok) { closeSheet(); toast('⛓ Citadel raised — this tile now pays 10×!', '#ffd24d'); renderGalaxy(); }
      else toast(r.reason === 'max' ? 'Citadel limit reached (50)' : r.reason === 'resources' ? 'Not enough Galaxy Resources' : 'Cannot build here', '#e23b4e');
    }));
    sheet.querySelectorAll('[data-upg-cit]').forEach((b) => b.addEventListener('click', () => {
      const r = G.upgradeCitadel(b.dataset.upgCit);
      if (r.ok) { closeSheet(); toast('⬆ Citadel Rank ' + r.lv + ' — now paying ' + (10 * r.lv) + '×!', '#ffd24d'); renderGalaxy(); }
      else toast(r.reason === 'max' ? 'Already max rank' : r.reason === 'resources' ? 'Not enough Galaxy Resources' : 'Cannot rank up', '#e23b4e');
    }));
    const ok = sheet.querySelector('[data-ok]');
    if (ok) ok.addEventListener('click', () => {
      const r = G.warp(id);
      if (r.ok) { closeSheet(); toast((t.rival ? 'Attacking ' : t.owned ? 'Deploying to ' : 'Claiming ') + t.name, '#5b9cff'); showScreen('battle'); }
      else toast(r.reason === 'cooldown' ? 'Tile on cooldown' : r.reason === 'locked' ? 'Too high level — max +10 above you' : r.reason === 'resources' ? 'Not enough Galaxy Resources to warp here' : 'Cannot deploy', '#e23b4e');
    });
  }

  // ---- classic ZONES list (free-play / farming any unlocked zone) ----------
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
    let html = '<div class="zj">';
    const safe = s.currentDungeon < 1;
    html += `<div class="zone-row safe ${safe?'active':''}" data-d="0">
        <div class="z-num" style="color:var(--hp)">⌂</div>
        <div class="z-meta"><div class="z-name" style="color:var(--hp)">Home Station</div>
          <div class="z-sub">Safe harbor · 0 ly · review &amp; refit your ship</div></div>
        <div class="z-go">${safe?'● DOCKED':'RETURN'}</div></div>`;
    let lastBlock = -1;
    for (let d = 1; d <= top; d++) {
      const gb = Math.floor((d - 1) / 10);
      if (gb !== lastBlock) {
        const gi = galInfo(gb);
        if (gb > 0) {
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
      const bonus = (wave?`<span class="z-bon wave">◎ WAVE ZONE · 25 waves → boss</span>`:'') +
                    (cit?`<span class="z-bon cit">⛴ CITADEL SIEGE · raze the fortress</span>`:'') +
                    (citCd>0?`<span class="z-bon citcd">◷ rebuilds in ${fmtCd(citCd)}</span>`:'') +
                    (bz.density>1?`<span class="z-bon dens">☣ SWARM · ${bz.density}× density · endless waves · ⚠ junk loot</span>`:'') +
                    (bz.quality>1?`<span class="z-bon qual">✦ ${bz.quality}× loot quality</span>`:'');
      html += `<div class="zone-row ${active?'active':''} ${locked||citCd>0?'locked':''} ${d===rec?'rec':''} ${bz.prismatic||wave?'prismatic':''} ${wave?'wavezone':''} ${cit?'citzone':''}" data-d="${d}" data-cit-cd="${citCd>0?1:0}" style="${pvars}">
        <div class="z-orb ${ptype}${d % 5 === 0 ? ' ringed' : ''}${cit ? ' cit' : ''}${wave ? ' wav' : ''}"><span>${d}</span></div>
        <div class="z-meta"><div class="z-name">${zoneName(d)}${wave?' <span class="z-wtag">WAVE</span>':''}${bz.density>1?' <span class="z-wtag" style="background:rgba(226,59,78,.16);color:#ff8090;border-color:rgba(226,59,78,.5)">SWARM</span>':''}${cit?' <span class="z-ctag">CITADEL</span>':''}</div>
          <div class="z-sub">${G.formatNum(lyOf(d))} ly · Enemy Lv ${G.formatNum(C.dungeonEnemyLevel(d))} · ${topType.name}s</div>
          ${bonus?`<div class="z-bons">${bonus}</div>`:''}
          ${d===rec && !active ? '<span class="z-rec">★ RECOMMENDED</span>' : ''}</div>
        <div class="z-go">${locked ? lockLabel : citCd>0 ? '◷ ' + fmtCd(citCd) : active ? '● HERE' : (cit ? '⛴ BREACH' : wave ? '◎ ENTER' : (d===rec ? '★ DEPLOY' : 'DEPLOY'))}</div></div>`;
    }
    html += '</div>';
    el['zones-body'].innerHTML = html;
    el['zones-body'].querySelectorAll('.zone-row:not(.locked)').forEach((row) => row.addEventListener('click', () => {
      const d = +row.dataset.d;
      const deploy = () => { G.selectDungeon(d); showScreen('battle'); };
      // HIGH-RISK WARNING — enemy level more than 5 above the pilot
      const eLv = C.dungeonEnemyLevel(d), pLv = G.state.level, gap = eLv - pLv;
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
    // always land CENTERED on the recommended zone, with a brief landing flash
    if (recRow) {
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
  const MOD_LABEL = { dmgPct:'DMG', hpPct:'HP', critChance:'Crit', critDamage:'Crit Dmg', moveSpeed:'Move', atkSpeedPct:'Rate', multiShot:'Multi-Shot', lifeSteal:'Lifesteal' };
  function storeHead(ico, title, right) { return `<div class="sec-head"><span class="sec-ic">${ico}</span><h3>${title}</h3>${right?`<span class="sec-right">${right}</span>`:''}</div>`; }
  // Unified Hangar segment header — shared by the "My Ship" (hero) view and the
  // store categories, so Ship + Store live under one tab.
  const HANGAR_TABS = [['ship','My Ship'],['ships','Ships'],['market','Market'],['pilot','Pilot'],['board','Leaderboard']];
  function hangarTabsHTML(active) {
    const fleetMode = G && G.fleetShips && G.fleetShips().length > 0;
    return `<div class="store-cats">${HANGAR_TABS.map(([k,l]) => {
      const label = (k === 'ship' && fleetMode) ? 'My Fleet' : l;
      return `<button class="store-cat ${active===k?'active':''}" data-hangtab="${k}">${label}</button>`;
    }).join('')}</div>`;
  }
  function wireHangarTabs(root) {
    root.querySelectorAll('[data-hangtab]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.hangtab;
      if (k === 'ship') { tapMyShip(); showScreen('hero'); }
      else if (k === 'board') { tapBoard(); showScreen('board'); }
      else if (k === 'pilot') showScreen('pilot');
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
  // Format a build/arrival duration (days→hours→minutes).
  function fmtBuildLeft(ms) {
    let s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60);
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    return Math.max(1, m) + 'm';
  }
  const BUILD_RES = [['fuel','⬢','#5bc0ff'],['iron','◆','#d0a060'],['plasma','✦','#c07bff'],['prism','◈','#ff3a3a']];
  function buildCostChips(cost, have) {
    return BUILD_RES.filter(([k]) => cost[k]).map(([k, g, c]) => {
      const ok = (have[k] || 0) >= cost[k];
      return `<span class="bc-chip ${ok ? '' : 'short'}" style="--cc:${c}"><span class="bc-g">${g}</span>${G.formatNum(cost[k])}</span>`;
    }).join('');
  }
  // OBLIVION-class build card — blueprint / kill-gate / resource / 2-week-build flow
  function buildShipCard(key) {
    const ship = C.SHIP_BY_KEY[key], inf = G.buildShipInfo(key);
    const cls = 'sc-' + ship.cls.toLowerCase();
    const layout = `<span class="lo-chip">⚔ ${ship.weapons}</span><span class="lo-chip">⊕ ${ship.ammo}</span><span class="lo-chip">⛨ ${ship.hull}</span><span class="lo-chip drone">◎ ${ship.drones} bays</span>`;
    const mods = modSummary(ship.mods);
    const reqName = (C.SHIP_BY_KEY[inf.reqShip] || {}).name || inf.reqShip;
    const bd = ship.bpDrop || {};
    let action = '', body = '';
    if (inf.status === 'owned') {
      action = G.state.ship === key ? `<span class="ship-badge active">● ACTIVE</span>` : `<button class="ship-btn switch" data-ship-switch="${key}">Switch</button>`;
    } else if (inf.status === 'building') {
      const total = (inf.days || 14) * 86400000, left = inf.arrivesAt - Date.now(), pct = Math.max(0, Math.min(100, (1 - left / total) * 100));
      action = `<span class="ship-badge build">⏳ ${fmtBuildLeft(left)}</span>`;
      body = `<div class="ship-lock building"><span class="lk-ic">⏳</span><span>Under construction — arrives in <b>${fmtBuildLeft(left)}</b></span><div class="lk-bar"><div class="lk-fill prism" style="width:${pct}%"></div></div></div>`;
    } else if (inf.status === 'ready') {
      action = `<span class="ship-badge active">✦ ARRIVED</span>`;
      body = `<div class="ship-lock ready"><span class="lk-ic">✦</span><span>Construction complete — boarding…</span></div>`;
    } else if (inf.status === 'noblueprint') {
      const pctTxt = (bd.chance * 100).toFixed(bd.chance < 0.01 ? 1 : 0);
      action = `<span class="ship-badge locked">🔒</span>`;
      body = `<div class="ship-lock"><span class="lk-ic">◈</span><span>Recover the <b>Blueprint</b> — a <b>${pctTxt}%</b> drop from a <b>Lv${bd.minCitLevel}+ Void Citadel</b> explosion in <b>Zone Grind</b>${bd.reqOwn ? ` · own the <b>${(C.SHIP_BY_KEY[bd.reqOwn] || {}).name}</b> first` : ''}</span></div>`;
    } else if (inf.status === 'needkills') {
      const pct = Math.min(100, inf.killsHave / inf.reqKills * 100);
      action = `<span class="ship-badge bp">✦ BP</span>`;
      body = `<div class="ship-lock ready"><span class="lk-ic">✦</span><span>Blueprint secured · <b>${G.formatNum(inf.killsHave)} / ${G.formatNum(inf.reqKills)}</b> kills in the ${reqName}</span><div class="lk-bar"><div class="lk-fill" style="width:${pct}%"></div></div></div>`;
    } else if (inf.status === 'busy') {
      action = `<span class="ship-badge locked">⏳</span>`;
      body = `<div class="ship-lock"><span class="lk-ic">⏳</span><span>Another hull is already under construction — finish it first</span></div>`;
    } else { // buildable | needres
      const can = inf.status === 'buildable';
      action = can ? `<button class="ship-btn buy res" data-build-start="${key}">⚒ Construct</button>` : `<span class="ship-badge locked">⚒</span>`;
      body = `<div class="ship-lock ${can ? 'ready' : ''}"><span class="lk-ic">⚒</span><span>${can ? 'Ready to build' : 'Need more resources'} · <b>${inf.days}-day</b> build</span><div class="bc-row">${buildCostChips(inf.cost, inf.have)}</div></div>`;
    }
    let upg = '';
    if (inf.owned && G.shipUpInfo) {
      const u = G.shipUpInfo(key); const tcol = (window.shipLvlColor ? window.shipLvlColor(u.level) : '#9aa7b8');
      upg = `<div class="ship-upg" style="display:flex;align-items:center;gap:9px;margin-top:9px;padding:9px 10px;background:#0f1623;border:1px solid ${tcol}55;border-radius:9px">
        <div style="width:24px;height:24px;flex:none;border-radius:6px;background:${tcol}22;border:1px solid ${tcol};display:grid;place-items:center;font-family:Orbitron,sans-serif;font-weight:800;font-size:11px;color:${tcol}">${u.level}</div>
        <div style="flex:1;min-width:0;font-size:10px;color:#46d27a;font-weight:700">+${u.bonus.dmg}% DMG · +${u.bonus.hp}% HP · +${u.bonus.rate}% Rate</div>
        ${u.maxed ? `<span style="font-family:Orbitron,sans-serif;font-weight:800;font-size:10px;color:${tcol}">MAX</span>` : `<button class="ship-btn" data-ship-upg="${key}" ${u.afford ? '' : 'disabled'} style="white-space:nowrap">⬆ <span style="color:#ffd24d">●</span> ${G.formatNum(u.cost.gold)} <span style="color:#c79bff">✦</span> ${G.formatNum(u.cost.plasma)}</button>`}
      </div>`;
    }
    return `<div class="ship-card ${cls} apex ${G.state.ship === key ? 'is-active' : ''}">
      <div class="ship-top">
        <div class="ship-ic ${cls}"><img class="ship-img" src="ships/ship-${key}.png" alt="" loading="lazy"></div>
        <div class="ship-meta"><div class="ship-name">${ship.name} <span class="apex-chip">APEX</span></div>
          <div class="ship-tag">${ship.cls} class · ${ship.tag}</div>
          <div class="ship-layout">${layout}</div></div>
        <div class="ship-act">${action}</div>
      </div>
      <div class="ship-desc">${ship.desc}</div>
      ${mods ? `<div class="ship-mods">${mods}</div>` : ''}
      ${upg}
      ${body}
    </div>`;
  }
  // DREAD-CLASS — multi-currency cost row (glyphs match the wallet chips).
  function megaCostHTML(c, big) {
    const row = [];
    const add = (col, gly, v) => { if (v) row.push('<span class="mega-c"><span style="color:' + col + '">' + gly + '</span> ' + G.formatNum(v) + '</span>'); };
    add('#f2a93c', '$', c.gold); add('#5bc0ff', '⬢', c.fuel); add('#d0a060', '◆', c.iron);
    add('#c07bff', '✦', c.plasma); add('#ff3a3a', '◈', c.prism);
    if (c.credits) row.push('<span class="mega-c"><span style="color:#f2a93c">◉</span> ' + c.credits.toLocaleString() + '</span>');
    add('#ff5a6a', '◇', c.dreadCores);
    return '<span class="mega-cost' + (big ? ' big' : '') + '">' + row.join('') + '</span>';
  }
  function megaShipCard(key) {
    const ship = C.SHIP_BY_KEY[key]; const st = G.shipBuyState(key);
    const cls = 'sc-' + ship.cls.toLowerCase();
    const sina = key === 'titansina';   // FINAL-CLASS showcase card
    const layout = `<span class="lo-chip">⚔ ${ship.weapons}</span><span class="lo-chip">⊕ ${ship.ammo}</span><span class="lo-chip">⛨ ${ship.hull}</span><span class="lo-chip drone">◎ ${ship.drones} bays</span>`;
    const mods = modSummary(ship.mods);
    const lvl = G.state.level || 1;
    let action = '', body = '';
    if (st.active) action = `<span class="ship-badge active">● ACTIVE</span>`;
    else if (st.owned) action = `<button class="ship-btn switch" data-ship-switch="${key}">Switch</button>`;
    else if (lvl < st.reqLevel) { action = `<span class="ship-badge locked">🔒</span>`; body = `<div class="ship-lock"><span class="lk-ic">🔒</span><span>Reach <b>account Level ${st.reqLevel}</b> to acquire — you're Level <b>${lvl}</b></span></div>`; }
    else { action = `<button class="ship-btn buy dreadbuy" data-mega-buy="${key}">Acquire</button>`; body = `<div class="ship-lock ready"><span class="lk-ic">◇</span><span>Cost: ${megaCostHTML(ship.megaCost)}</span></div>`; }
    let upg = '';
    if (st.owned && G.shipUpInfo) {
      const u = G.shipUpInfo(key); const tcol = (window.shipLvlColor ? window.shipLvlColor(u.level) : '#9aa7b8');
      upg = `<div class="ship-upg" style="display:flex;align-items:center;gap:9px;margin-top:9px;padding:9px 10px;background:#0f1623;border:1px solid ${tcol}55;border-radius:9px">
        <div style="width:24px;height:24px;flex:none;border-radius:6px;background:${tcol}22;border:1px solid ${tcol};display:grid;place-items:center;font-family:Orbitron,sans-serif;font-weight:800;font-size:11px;color:${tcol}">${u.level}</div>
        <div style="flex:1;min-width:0;font-size:10px;color:#46d27a;font-weight:700">+${u.bonus.dmg}% DMG · +${u.bonus.hp}% HP · +${u.bonus.rate}% Rate</div>
        ${u.maxed ? `<span style="font-family:Orbitron,sans-serif;font-weight:800;font-size:10px;color:${tcol}">MAX</span>` : `<button class="ship-btn" data-ship-upg="${key}" ${u.afford ? '' : 'disabled'} style="white-space:nowrap">⬆ <span style="color:#f2a93c">$</span> ${G.formatNum(u.cost.gold)} <span style="color:#c07bff">✦</span> ${G.formatNum(u.cost.plasma)}</button>`}
      </div>`;
    }
    return `<div class="ship-card ${cls} apex dread ${sina ? 'sina ' : ''}${st.active ? 'is-active' : ''}">
      ${sina ? `<div class="sina-hero">
        <i class="sina-beam"></i><i class="sina-beam b2"></i><i class="sina-beam b3"></i><i class="sina-beam b4"></i>
        <img src="ships/ship-titansina.png" alt="" decoding="async">
        <span class="sina-callout">2× THE DREAD OMEGA · FULL-ZONE RANGE</span>
      </div>` : ''}
      <div class="ship-top">
        ${sina ? '' : `<div class="ship-ic ${cls}"><img class="ship-img" src="ships/ship-${key}.png" alt="" loading="lazy"></div>`}
        <div class="ship-meta"><div class="ship-name">${ship.name} <span class="apex-chip ${sina ? 'sina' : 'dread'}">${sina ? 'FINAL CLASS' : 'DREAD'}</span></div>
          <div class="ship-tag">${ship.cls} class · ${ship.tag}</div>
          <div class="ship-layout">${layout}</div></div>
        <div class="ship-act">${action}</div>
      </div>
      <div class="ship-desc">${ship.desc}</div>
      ${mods ? `<div class="ship-mods">${mods}</div>` : ''}
      ${upg}
      ${body}
    </div>`;
  }
  // DREAD-class buy confirm — lists every currency with have/cost.
  function openMegaBuy(key) {
    const ship = C.SHIP_BY_KEY[key], c = ship.megaCost;
    const have = { gold: G.state.gold || 0, fuel: (G.state.resources || {}).fuel || 0, iron: (G.state.resources || {}).iron || 0,
      plasma: (G.state.resources || {}).plasma || 0, prism: (G.getResources && G.state.prism ? G.state.prism.ingots : 0) || 0,
      credits: G.getCredits ? G.getCredits() : 0, dreadCores: G.getDreadCores ? G.getDreadCores() : 0 };
    const rows = [
      ['Gold', '$', '#f2a93c', c.gold, have.gold], ['Fuel', '⬢', '#5bc0ff', c.fuel, have.fuel],
      ['Iron', '◆', '#d0a060', c.iron, have.iron], ['Plasma', '✦', '#c07bff', c.plasma, have.plasma],
      ['Prism', '◈', '#ff3a3a', c.prism, have.prism], ['LootCoins', '◉', '#f2a93c', c.credits, have.credits],
      ['Dread Cores', '◇', '#ff5a6a', c.dreadCores, have.dreadCores],
    ].filter((r) => r[3]);
    const afford = rows.every((r) => r[4] >= r[3]);
    const rowsHTML = rows.map((r) => `<div class="ip-stat"><span class="ip-sname"><span style="color:${r[2]}">${r[1]}</span> ${r[0]}</span><span class="v" style="color:${r[4] >= r[3] ? '#7ce0a0' : 'var(--bad)'}">${G.formatNum(r[4])} / ${G.formatNum(r[3])}</span></div>`).join('');
    const sheet = showSheet(`<div class="sheet-head">◇ Acquire ${ship.name}</div><div class="sheet-body">
      <p style="font-size:11.5px;color:var(--muted);line-height:1.5;margin-bottom:9px">${ship.desc}</p>
      ${rowsHTML}
      ${afford ? '' : '<p style="font-size:10.5px;color:#ffcf7a;margin-top:6px">Not enough resources — keep grinding & hunting Dreadnaughts.</p>'}
      <div class="sheet-actions"><button class="btn" data-x>Cancel</button>
        <button class="btn primary" data-ok ${afford ? '' : 'disabled'}>${afford ? 'Acquire ' + ship.name : 'Insufficient currency'}</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    const ok = sheet.querySelector('[data-ok]');
    if (ok && afford) ok.addEventListener('click', () => {
      const r = G.buyShip(key); closeSheet();
      if (r.ok) { toast('★ ' + ship.name + ' acquired!', '#ff5a6a'); renderStore(); }
      else { toast('Cannot acquire — need more ' + (r.reason || 'currency'), '#e23b4e'); }
    });
  }
  // OBLIVION FINAL — purchase-only apex hull (LootCoins, Level-gated).
  function purchaseShipCard(key) {const ship = C.SHIP_BY_KEY[key];
    const cls = 'sc-' + ship.cls.toLowerCase();
    const layout = `<span class="lo-chip">⚔ ${ship.weapons}</span><span class="lo-chip">⊕ ${ship.ammo}</span><span class="lo-chip">⛨ ${ship.hull}</span><span class="lo-chip drone">◎ ${ship.drones} bays</span>`;
    const mods = modSummary(ship.mods);
    const owned = !!(G.state.ownedShips && G.state.ownedShips[key]);
    const active = G.state.ship === key;
    const lvl = G.state.level || 1, reqL = ship.purchase.reqLevel, price = ship.purchase.lc;
    let action = '', body = '';
    if (active) action = `<span class="ship-badge active">● ACTIVE</span>`;
    else if (owned) action = `<button class="ship-btn switch" data-ship-switch="${key}">Switch</button>`;
    else if (lvl < reqL) { action = `<span class="ship-badge locked">🔒</span>`; body = `<div class="ship-lock"><span class="lk-ic">🔒</span><span>Reach <b>account Level ${reqL}</b> to purchase — you're Level <b>${lvl}</b></span></div>`; }
    else { action = `<button class="ship-btn buy lcbuy" data-lc-final="${key}">${LC_ICON} ${price.toLocaleString()}</button>`; body = `<div class="ship-lock ready"><span class="lk-ic">◈</span><span>Available now · <b>${price.toLocaleString()} LootCoins</b></span></div>`; }
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
  function tileBadge(key, ship) {
    const owned = !!(G.state.ownedShips && G.state.ownedShips[key]);
    if (owned) return '';
    if (ship.event) return '❖ Season 1';
    if (ship.purchase) return `${LC_ICON}${(ship.purchase.lc || 0).toLocaleString()}`;
    if (ship.build) return '⚒ Build';
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
    // TITAN SINA — full-row showcase tile in the ships grid
    if (key === 'titansina') {
      return `<button class="ship-tile st-sina ${stateCls}" data-ship-tile="${key}">
        <div class="sts-art">
          <i class="sina-beam"></i><i class="sina-beam b2"></i><i class="sina-beam b3"></i><i class="sina-beam b4"></i>
          <img src="ships/ship-${key}.png" alt="" decoding="async">
          ${active ? '<span class="st-flag">● ACTIVE</span>' : (owned && lvl ? `<span class="st-lvl">Lv ${lvl}</span>` : '')}
        </div>
        <div class="sts-meta">
          <div class="st-name">${ship.name} <span class="apex-chip sina">FINAL CLASS</span></div>
          <div class="sts-callout">2× THE DREAD OMEGA · FULL-ZONE RANGE · RAINBOW TRACERS</div>
          <div class="st-stats"><span>⚔${ship.weapons}</span><span>⊕${ship.ammo}</span><span>⛨${ship.hull}</span><span class="dr">◎${ship.drones}</span></div>
          ${owned ? '' : `<div class="st-badge">${badge}</div>`}
        </div>
      </button>`;
    }
    return `<button class="ship-tile ${stateCls}" data-ship-tile="${key}">
      <div class="st-thumb"><img src="ships/ship-${key}.png" alt="" loading="lazy">
        ${active ? '<span class="st-flag">● ACTIVE</span>' : (owned && lvl ? `<span class="st-lvl">Lv ${lvl}</span>` : '')}</div>
      <div class="st-name">${ship.name}</div>
      <div class="st-cls">${ship.cls}</div>
      <div class="st-stats"><span>⚔${ship.weapons}</span><span>⊕${ship.ammo}</span><span>⛨${ship.hull}</span>${ship.drones ? `<span class="dr">◎${ship.drones}</span>` : ''}</div>
      ${owned ? '' : `<div class="st-badge">${badge}</div>`}
    </button>`;
  }
  function openShipDetail(key) {
    const sheet = showSheet(`<div class="sheet-head">${C.SHIP_BY_KEY[key].name}</div><div class="sheet-body ship-detail-sheet">${shipCard(key)}<div class="sheet-actions" style="margin-top:12px"><button class="btn" data-x>Close</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    sheet.querySelectorAll('[data-ship-switch]').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.shipSwitch; if (G.switchShip(k)) { toast('Now flying the ' + C.SHIP_BY_KEY[k].name, '#5bc06b'); closeSheet(); renderStore(); } }));
    sheet.querySelectorAll('[data-ship-buy]').forEach((b) => b.addEventListener('click', () => { closeSheet(); openShipBuy(b.dataset.shipBuy); }));
    sheet.querySelectorAll('[data-ship-upg]').forEach((b) => b.addEventListener('click', () => confirmHullUpgrade(b.dataset.shipUpg, () => { closeSheet(); renderStore(); })));
    sheet.querySelectorAll('[data-build-start]').forEach((b) => b.addEventListener('click', () => { closeSheet(); openBuildConfirm(b.dataset.buildStart); }));
    sheet.querySelectorAll('[data-lc-final]').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.lcFinal; closeSheet(); openShipLCBuy(k, (C.SHIP_BY_KEY[k].purchase || {}).lc); }));
    sheet.querySelectorAll('[data-mega-buy]').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.megaBuy; closeSheet(); openMegaBuy(k); }));
    sheet.querySelectorAll('[data-bp-hunt]').forEach((b) => b.addEventListener('click', () => { G.selectDungeon(+b.dataset.bpHunt); closeSheet(); showScreen('battle'); }));
    sheet.querySelectorAll('[data-go-sdread]').forEach((b) => b.addEventListener('click', () => { closeSheet(); showScreen('sdread'); }));
  }
  // VOIDMAW — Season 1 event-exclusive hull. No price, no blueprint: assembled
  // from 100 Voidmaw Parts earned only in the Server Dreadnaught event.
  function eventShipCard(key) {
    const ship = C.SHIP_BY_KEY[key];
    const cls = 'sc-' + ship.cls.toLowerCase();
    const owned = !!(G.state.ownedShips && G.state.ownedShips[key]);
    const active = G.state.ship === key;
    const parts = ((G.state.shipParts && G.state.shipParts[key]) | 0);
    const need = 100;
    const layout = `<span class="lo-chip">⚔ ${ship.weapons}</span><span class="lo-chip">⊕ ${ship.ammo}</span><span class="lo-chip">⛨ ${ship.hull}</span><span class="lo-chip drone">◎ ${ship.drones}</span>`;
    let action, body = '';
    if (active) action = `<span class="ship-badge active">FLYING</span>`;
    else if (owned) action = `<button class="ship-btn switch" data-ship-switch="${key}">Switch</button>`;
    else action = `<button class="ship-btn buy vmbuy" data-go-sdread="1">❖ Earn</button>`;
    if (!owned) body =
      `<div class="vm-note"><b>SEASON 1 EXCLUSIVE</b> — cannot be bought. Assemble <b>${need} Voidmaw Parts</b> from the <b>Server Dreadnaught</b> event: stage rewards, daily leaderboard ranks and first-fight bonuses. Gone when the season ends (Aug 31).</div>` +
      `<div class="vm-partbar"><i style="width:${Math.min(100, parts / need * 100)}%"></i><span>❖ ${parts} / ${need} parts</span></div>`;
    else body = `<div class="vm-note owned">❖ Season 1: Voidmaw — event-exclusive hull, assembled from ${need} parts. A trophy few will ever fly.</div>`;
    return `<div class="ship-card vm ${cls}" data-key="${key}">
      <div class="ship-top">
        <div class="ship-ic ${cls}"><img class="ship-img" src="ships/ship-${key}.png" alt="" loading="lazy"></div>
        <div class="ship-meta"><div class="ship-name">${ship.name} <span class="apex-chip vm">SEASON 1</span></div>
          <div class="ship-tag">${ship.cls} class · ${ship.tag}</div>
          <div class="ship-layout">${layout}</div></div>
        <div class="ship-action">${action}</div>
      </div>
      <div class="vm-desc">${ship.desc}</div>
      ${body}
    </div>`;
  }
  function shipCard(key) {
    const ship = C.SHIP_BY_KEY[key];
    if (ship.event) return eventShipCard(key);
    if (ship.build) return buildShipCard(key);
    if (ship.purchase) return purchaseShipCard(key);
    if (ship.megaCost) return megaShipCard(key);
    const st = G.shipBuyState(key);
    const cls = 'sc-' + ship.cls.toLowerCase();
    const layout = `<span class="lo-chip">⚔ ${ship.weapons}</span><span class="lo-chip">⊕ ${ship.ammo}</span><span class="lo-chip">⛨ ${ship.hull}</span>` +
      (ship.drones ? `<span class="lo-chip drone">◎ ${ship.drones} bay${ship.drones>1?'s':''}</span>` : '');
    const mods = modSummary(ship.mods);
    let action = '', lock = '';
    if (st.active) action = `<span class="ship-badge active">● ACTIVE</span>`;
    else if (st.owned) action = `<button class="ship-btn switch" data-ship-switch="${key}">Switch</button>`;
    else if (st.unlocked) action = ship.resPrice
      ? `<button class="ship-btn buy res" data-ship-buy="${key}">${resCostChips(ship.resPrice)}</button>`
      : `<button class="ship-btn buy" data-ship-buy="${key}"><span class="coin">$</span> ${G.formatNum(ship.price)}</button>`;
    else action = `<span class="ship-badge locked">🔒</span>`;
    if (!st.owned && !st.unlocked) {
      if (!st.hasBlueprint) {
        const z = st.bpZone, reach = z <= G.state.highestUnlocked;
        lock = `<div class="ship-lock"><span class="lk-ic">◷</span><span>Recover the <b>Blueprint</b> — defeat the <b>boss</b> in <b>${zoneName(z)}</b> (Zone ${z})</span>` +
          (reach ? `<button class="lk-go" data-bp-hunt="${z}">Hunt ›</button>` : `<span class="lk-soft">reach Z${z}</span>`) + `</div>`;
      } else if (!st.prevOwned) {
        lock = `<div class="ship-lock ready"><span class="lk-ic">✦</span><span>Blueprint ready · own the <b>${C.SHIP_BY_KEY[st.prevKey].name}</b> first</span></div>`;
      } else if (!st.killsMet) {
        const pct = Math.min(100, st.killsHave / st.killsNeed * 100);
        lock = `<div class="ship-lock ready"><span class="lk-ic">✦</span><span>Blueprint ready · <b>${G.formatNum(st.killsHave)}/${G.formatNum(st.killsNeed)}</b> kills in the ${C.SHIP_BY_KEY[st.prevKey].name}</span>
          <div class="lk-bar"><div class="lk-fill" style="width:${pct}%"></div></div></div>`;
      }
    }
    const bpChip = ship.tier > 0 ? (st.hasBlueprint ? `<span class="bp-chip have">✔ BP</span>` : `<span class="bp-chip">◷ Z${ship.bpZone}</span>`) : '';
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
      ${mods?`<div class="ship-mods">${mods}</div>`:''}
      ${upg}
      ${lock}
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
  };
  function wclassIcon(wc) { return WCLASS_ICONS[wc.key] || ('<span class="wci">' + wc.glyph + '</span>'); }
  function itemIcon(it) {
    if (it && it.slot === 'bow' && window.ITEMS && window.ITEMS.weaponClassOf) {
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
  const LC_ICON = '<svg class="lc" viewBox="0 0 24 24"><defs><linearGradient id="lcg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe27a"/><stop offset=".55" stop-color="#f2a93c"/><stop offset="1" stop-color="#b86adf"/></linearGradient></defs><path d="M12 1.5l9 5.25v10.5L12 22.5l-9-5.25V6.75z" fill="url(#lcg)" stroke="#2a1808" stroke-width="1.1"/><path d="M12 5.6l5.6 3.25v6.3L12 18.4l-5.6-3.25v-6.3z" fill="rgba(22,12,32,.88)"/><path d="M12 8.4l3.1 1.85v3.5L12 15.6l-3.1-1.85v-3.5z" fill="url(#lcg)"/><path d="M12 8.4l3.1 1.85-3.1 1.8-3.1-1.8z" fill="#fff3c9" opacity=".75"/></svg>';
  function renderStore() {
    let html = hangarTabsHTML(storeCat);
    // ALWAYS-VISIBLE LootCoins storefront entry (App Review 2.1(b): IAPs must be
    // locatable in-app — Hangar ▸ top banner ▸ pack sheet).
    html += `<button class="lc-store-cta" data-getlc>${LC_ICON}<span><b>Get LootCoins</b><i>Packs: 25,000 · 50,000 · 75,000 · 100,000</i></span><em>SHOP ›</em></button>`;
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
              <button class="ho-buy">${LC_ICON}${offer.lc.toLocaleString()} · Unlock now</button>
            </div>
            <img class="ho-ship" src="ships/ship-${offer.key}.png" alt="">
          </div>`;
        }
      }
      html += `<div class="sec-blurb">Buy hulls with gold. Each unlocks only after you recover its <b>blueprint</b> from a zone boss and prove yourself in the previous hull. <b style="color:#5fa8ff">Tap any hull</b> for full stats.</div>`;
      html += '<div class="ship-grid">' + C.SHIPS.map((s) => shipTile(s.key)).join('') + '</div>';
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
        html += `<div class="sec-blurb">Bought outright with ${LC_ICON} LootCoins — no blueprint, no kill chain, no level gate. Yours instantly.</div>`;
        LC_FLEET.forEach((offer) => {
          const sh = C.SHIP_BY_KEY[offer.key]; if (!sh) return;
          const owned = !!(G.state.ownedShips && G.state.ownedShips[offer.key]);
          const btn = owned ? '<span class="ho-buy owned">✓ OWNED</span>'
            : `<button class="ho-buy">${LC_ICON}${offer.lc.toLocaleString()} · Unlock now</button>`;
          html += `<div class="hero-offer lcf ${owned ? 'lcf-flat' : ''}" ${owned ? '' : `data-lcship="${offer.key}" data-lcprice="${offer.lc}"`}>
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
            <button class="sc-buy lc" data-lcm="prim:0" ${sold?'disabled':''}>${sold?'CLAIMED':LC_ICON+G.formatNum(C2.prim)}</button></div>
          <div class="lcv-hint">Tap the item for full stats</div>
        </div></div>`;
      }
      {
        html += `<div class="store-sec">${storeHead(STORE_ICONS.cosmetics, 'Cosmic Cache · LootCoins', `⟳ <span id="lc-cos-cd">${fmtT(G.lcCosmicTimeLeft())}</span>`)}`;
        html += `<div class="sec-blurb">Guaranteed <b style="color:#ff6ad5">Cosmic</b> gear rolled for your level · new stock every hour.</div>`;
        lm.cosmic.items.forEach((it, i) => {
          if (!it) return;
          const bought = lm.cosmic.bought.includes(i), r = C.RARITY[it.rarity];
          html += `<div class="store-card shop-card lcm-card ${bl(it.rarity)}" data-lcmcard="cosmic:${i}" style="border-left-width:3px;cursor:pointer">
            <div class="sc-ico ${rc(it.rarity)}" style="border-color:${r.color}">${itemIcon(it)}</div>
            <div class="sc-main"><div class="sc-name ${rc(it.rarity)}">${it.name} ${G.shopIsUpgrade(it)?'<span class="ic-tag up" style="vertical-align:2px">▲ UP</span>':''}</div>
              <div class="sc-desc">${r.name} · ${C.SLOTS[it.slot].name}</div></div>
            <button class="sc-buy lc" data-lcm="cosmic:${i}" ${bought?'disabled':''}>${bought?'Sold':LC_ICON+G.formatNum(C2.cosmic)}</button></div>`;
        });
        html += '</div>';
      }
      const sh = G.getShop(); const tl = G.shopTimeLeft(); const mm = Math.floor(tl/60), ss = tl%60;
      const price = sh.price != null ? sh.price : G.shopItemPrice();
      html += `<div class="store-sec">${storeHead(STORE_ICONS.market, 'Black Market · Gold', `${mm}:${ss<10?'0':''}${ss}`)}`;
      html += `<div class="sec-blurb">Gear upgrades · fixed price this rotation.</div>`;
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
      if (it.slot === 'bow' && window.ITEMS.weaponClassOf) {
        const wc = window.ITEMS.weaponClassOf(it);
        let extra = '';
        if (wc.key === 'support' && window.ITEMS.supportAura) {
          const au = window.ITEMS.supportAura(it);
          if (au) extra = `<div class="ip-waura">Fleet aura: <b>+${au.multiShot * 2} Multi-Shot</b> · <b>+${au.regen * 2}%/s</b> hull recovery · <b>−${Math.min(60, au.reduce * 2)}%</b> damage taken · <b>+${au.rangePct * 2}%</b> range <span class="ip-waura-x2">⚠ AEGIS HULLS ONLY</span></div>`;
        }
        wcHTML = `<div class="ip-wclass" style="color:${wc.color}"><span class="wcx">${wclassIcon(wc)}</span> ${wc.name} · <b>${wc.bonus}</b></div><div class="ip-wdesc">${wc.blurb}</div>${extra}`;
      }
      return `<div class="ip-name ${rc(it.rarity)}">${it.name}</div>
        <div class="ip-type">${r.name} · ${C.SLOTS[it.slot].name} · matched to your level</div>
        ${wcHTML}${statHTML}${cmpNote}`;
    };
    el['store-body'].querySelectorAll('[data-lcmcard]').forEach((card) => card.addEventListener('click', () => {
      const [kind, iStr] = card.dataset.lcmcard.split(':'); const idx = +iStr;
      const lm = G.getLCMarket();
      const it = kind === 'cosmic' ? lm.cosmic.items[idx] : lm.prim.item;
      const price = (G.LC_PRICES || { cosmic: 10000, prim: 115000 })[kind];
      if (!it) return;
      const sold = kind === 'cosmic' ? lm.cosmic.bought.includes(idx) : lm.prim.bought;
      const have = G.getCredits(), afford = have >= price;
      const r = C.RARITY[it.rarity];
      const sheet = showSheet(`<div class="sheet-head">${LC_ICON} ${kind === 'cosmic' ? 'Cosmic Cache' : 'Primordial Vault'}</div><div class="sheet-body">
        ${marketDetailHTML(it)}
        <div class="ip-stat" style="margin-top:8px"><span class="ip-sname">Price</span><span class="v">${sold ? '✓ Already claimed this rotation' : LC_ICON + ' ' + G.formatNum(price) + ' LootCoins'}</span></div>
        ${sold ? '' : `<div class="ip-stat"><span class="ip-sname">Your balance</span><span class="v" style="color:${afford ? '#7ce0a0' : 'var(--bad)'}">${LC_ICON} ${(G.formatNumRaw || G.formatNum)(have)}</span></div>`}
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
        const sheet = showSheet(`<div class="sheet-head">${LC_ICON} Cosmic Jackpot</div><div class="sheet-body">
          <div class="jkpt-confirm">
            <div class="jkpt-chest big"><div class="jkpt-chest-glow"></div><span class="jkpt-chest-ic">🎁</span></div>
            <p class="jkpt-cline">One high-roll pull. Value lands <b>between Cosmic and Eternal</b> — with a <b style="color:#ffd24d">0.2%</b> shot at the final two tiers (<b style="color:#c061ff">Relic</b> / <b style="color:#ff2330">Artifact</b>).</p>
          </div>
          <div class="ip-stat" style="margin-top:8px"><span class="ip-sname">Price</span><span class="v">${LC_ICON} ${G.formatNum(price)} LootCoins</span></div>
          <div class="ip-stat"><span class="ip-sname">Your balance</span><span class="v" style="color:${afford ? '#7ce0a0' : 'var(--bad)'}">${LC_ICON} ${(G.formatNumRaw || G.formatNum)(have)}</span></div>
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
    el['store-body'].querySelectorAll('[data-ship-buy]').forEach((b) => b.addEventListener('click', () => openShipBuy(b.dataset.shipBuy)));
    el['store-body'].querySelectorAll('[data-ship-switch]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.shipSwitch; if (G.switchShip(k)) { toast('Now flying the ' + C.SHIP_BY_KEY[k].name, '#5bc06b'); renderStore(); }
    }));
    el['store-body'].querySelectorAll('[data-go-sdread]').forEach((b) => b.addEventListener('click', () => showScreen('sdread')));
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
    // live-refresh the construction countdown while a hull is building
    clearInterval(_buildTick); _buildTick = null;
    if (storeCat === 'ships' && G.getConstruction && G.getConstruction()) {
      _buildTick = setInterval(() => {
        const sc = document.getElementById('screen-store');
        if (sc && sc.classList.contains('active') && storeCat === 'ships' && G.getConstruction && G.getConstruction()) renderStore();
        else { clearInterval(_buildTick); _buildTick = null; }
      }, 20000);
    }
  }
  // CONSTRUCT confirm — warns about the cost + multi-week wait before committing.
  function openBuildConfirm(key) {
    const inf = G.buildShipInfo(key); if (!inf) return;
    const ship = C.SHIP_BY_KEY[key];
    const sheet = showSheet(`<div class="sheet-head">⚒ Construct ${ship.name}</div><div class="sheet-body">
      <p style="margin:0 0 10px;font-size:12.5px;line-height:1.55;color:#cbd6e6">Commit the resources below to begin construction. The hull takes <b style="color:#c9a0ff">${inf.days} days</b> to build and arrives automatically when complete.</p>
      <div class="bc-row" style="margin-bottom:10px">${buildCostChips(inf.cost, inf.have)}</div>
      <div style="background:rgba(255,80,80,.08);border:1px solid rgba(255,120,120,.35);border-radius:9px;padding:9px 11px;color:#ff9a64;font-size:11.5px;line-height:1.45;margin-bottom:6px">⚠ Resources are spent immediately and are <b>non-refundable</b>. Only one hull can be under construction at a time.</div>
      <div class="sheet-actions" style="margin-top:12px"><button class="btn" data-x>Cancel</button><button class="btn gold" data-ok ${inf.affordable ? '' : 'disabled'}>⚒ Begin ${inf.days}-day build</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    const ok = sheet.querySelector('[data-ok]');
    if (ok) ok.addEventListener('click', () => {
      const r = G.startBuildShip(key); closeSheet();
      if (r.ok) { toast('⚒ ' + ship.name + ' — construction begun', '#c9a0ff'); renderStore(); }
      else { toast(r.reason === 'resources' ? 'Not enough resources' : r.reason === 'busy' ? 'Another hull is already building' : 'Cannot build yet', '#e23b4e'); }
    });
  }
  function openCredits() {
    const packs = window.PAYMENTS ? window.PAYMENTS.PACKS : [];
    const conf = window.PAYMENTS && window.PAYMENTS.configured();
    const rows = packs.map((p) => `<div class="fp-pick" data-sku="${p.sku}"><div class="fpp-m"><div class="fpp-n">${LC_ICON}${p.credits.toLocaleString()} LootCoins${p.bonus ? ` <span class="pk-tag">+${p.bonus}% BONUS</span>` : ''}${p.tag ? ` <span class="pk-tag hot">${p.tag}</span>` : ''}</div><div class="fpp-d">one-time purchase · Apple Pay / Google Pay / card</div></div><span class="fpp-go">$${p.usd}</span></div>`).join('');
    const heroCoin = LC_ICON.replace(/lcg/g, 'lcg3').replace('class="lc"', 'class="lc lch-coin"');
    const sheet = showSheet(`<div class="sheet-head">${LC_ICON} Get LootCoins</div><div class="sheet-body">
      <div class="lc-hero">
        <div class="lch-glow"></div>
        <i class="lch-sp s1"></i><i class="lch-sp s2"></i><i class="lch-sp s3"></i><i class="lch-sp s4"></i><i class="lch-sp s5"></i>
        ${heroCoin}
        <div class="lch-title">LOOTCOINS</div>
        <div class="lch-sub">Cosmetics &amp; convenience — never power</div>
        <div class="lch-shine"></div>
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
      <div class="ip-stat"><span class="ip-sname">Hardpoints</span><span class="v">⚔ ${ship.weapons} · ⊕ ${ship.ammo} · ⛨ ${ship.hull}${ship.drones?` · ◎ ${ship.drones}`:''}</span></div>
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
    const data = LB.allTimeBoard(G);
    html += `<div class="lb-info">All-time ranking of every real operator, by fleet power.</div>`;
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
          <div class="lb-topline"><span class="lb-name">${p.isMe?'★ ':''}${p.name}</span>
            <span class="lb-fleet">${(p.isMe ? (p.fleet || [G.state.ship]) : (LB.fleetFor ? LB.fleetFor(p, p.rank, data.board.length) : [])).map((fk) => `<img class="lbf" src="ships/ship-${fk}.png" alt="" title="${C.SHIP_BY_KEY[fk] ? C.SHIP_BY_KEY[fk].name : fk}">`).join('')}</span></div>
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
    const eq = p.isMe ? G.state.equipped : LB.loadoutFor(p, p.rank, total);
    let grid = '';
    C.SLOT_KEYS.forEach((slot) => {
      const it = eq[slot], def = C.SLOTS[slot];
      grid += `<div class="lo-slot ${it?bl(it.rarity):''}"><div class="lo-ic ${it?rc(it.rarity):''}">${it?itemIcon(it):def.icon}</div>
        <div style="min-width:0"><div class="lo-nm ${it?rc(it.rarity):''}">${it?it.name:'—'}</div><div class="lo-r">${it?C.RARITY[it.rarity].name:'empty'}</div></div></div>`;
    });
    const sheet = showSheet(`<div class="sheet-head">${p.isMe?'Your Loadout':p.name}</div><div class="sheet-body">
      <p style="margin-bottom:10px">Rank <b>#${p.rank}</b> · Zone <b>${p.zone}</b> · Level <b>${p.level}</b> · Power <b style="color:var(--gold)">${G.formatNum(p.power)}</b></p>
      <div class="lo-fleet">${fleetHtml}</div>
      <div class="lo-sect">Flagship loadout</div>
      <div class="loadout-grid">${grid}</div>
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
    const canSecond = (item.slot === 'bow' || item.slot === 'arrows') && G.secondUnlocked(item.slot);
    if (mode === 'inventory') {
      actions = `<div class="sheet-actions"><button class="btn primary" data-eq>Equip</button>` +
        (canSecond ? `<button class="btn gold" data-eq2>Equip 2nd</button>` : '') +
        `<button class="btn" data-sell>Sell <span class="coin">$</span> ${G.formatNum(C.sellValue(item))}</button></div>` +
        `<div class="ip-salvage">Scrapping may salvage <span style="color:${GM.RES.fuel.color}">${GM.RES.fuel.glyph}</span> <span style="color:${GM.RES.iron.color}">${GM.RES.iron.glyph}</span> <span style="color:${GM.RES.plasma.color}">${GM.RES.plasma.glyph}</span> for My Galaxy</div>`;
    } else if (mode === 'equipped') actions = `<div class="sheet-actions"><button class="btn" data-x>Close</button><button class="btn gold" data-uneq>⬆ Unequip</button></div>`;
    const sheet = showSheet(`<div id="item-pop"><div class="sheet-body">
      <div class="ip-name ${rc(item.rarity)}">${item.name}</div>
      <div class="ip-type">${r.name} · ${C.SLOTS[item.slot].name} · Zone ${item.dungeon}</div>
      ${(function(){ if (item.slot !== 'bow' || !window.ITEMS.weaponClassOf) return '';
        const wc = window.ITEMS.weaponClassOf(item);
        let extra = '';
        if (wc.key === 'support' && window.ITEMS.supportAura) {
          const au = window.ITEMS.supportAura(item);
          if (au) extra = `<div class="ip-waura">Fleet aura: <b>+${au.multiShot * 2} Multi-Shot</b> · <b>+${au.regen * 2}%/s</b> hull recovery · <b>−${Math.min(60, au.reduce * 2)}%</b> damage taken · <b>+${au.rangePct * 2}%</b> range <span class="ip-waura-x2">⚠ AEGIS HULLS ONLY</span></div>`;
        }
        return `<div class="ip-wclass" style="color:${wc.color}"><span class="wcx">${wclassIcon(wc)}</span> ${wc.name} · <b>${wc.bonus}</b></div><div class="ip-wdesc">${wc.blurb}</div>${extra}`; })()}
      ${statHTML}${cmpNote}${actions||'<div class="sheet-actions"><button class="btn" data-x>Close</button></div>'}</div></div>`);
    const eq = sheet.querySelector('[data-eq]'); if (eq) eq.addEventListener('click', () => { G.equip(item, 'primary'); closeSheet(); });
    const eq2 = sheet.querySelector('[data-eq2]'); if (eq2) eq2.addEventListener('click', () => { G.equip(item, 'secondary'); closeSheet(); });
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
          const rank = G.skillRank(n.id), able = G.canInvest(n), maxed = rank >= n.max;
          let pips = ''; for (let i = 0; i < n.max; i++) pips += `<div class="sn-pip ${i < rank ? 'on' : ''}"></div>`;
          const btn = maxed ? `<button class="sn-buy maxed" disabled>MAX</button>` : `<button class="sn-buy ${able?'able':''}" data-sk="${n.id}" ${able?'':'disabled'}>+</button>`;
          html += `<div class="skill-node ${maxed?'done':''} ${n.cap?'cap':''}" style="border-left-color:${br.color}">
            <div class="sn-main"><div class="sn-name">${n.name}${n.cap?'<span class="capm">CAPSTONE</span>':''}</div>
              <div class="sn-desc">${n.desc}</div>
              <div class="sn-pips">${pips}<span class="sn-rk">${rank}/${n.max}</span></div></div>${btn}</div>`;
        });
        html += '</div>';
      } else if (isNext) {
        html += `<div class="skt-locked">Invest <b>${tier.req - spent}</b> more point${tier.req-spent>1?'s':''} in ${br.name} to unlock ${tier.nodes.length} ${isCap?'capstone ':''}skill${tier.nodes.length>1?'s':''}.</div>`;
      }
      html += '</div>';
    });
    if (hiddenTiers > 0) html += `<div class="sk-more">\u25be ${hiddenTiers} deeper tier${hiddenTiers>1?'s':''} reveal as you invest in ${br.name}</div>`;

    el['skills-body'].innerHTML = html;
    const rb = $('sk-reset'); if (rb) rb.addEventListener('click', openReset);
    el['skills-body'].querySelectorAll('.sk-tab').forEach((b) => b.addEventListener('click', () => { skillBranch = b.dataset.br; renderSkills(); }));
    el['skills-body'].querySelectorAll('[data-acc]').forEach((b) => b.addEventListener('click', () => {
      const tier = b.closest('.sk-tier');
      skillOpen[b.dataset.acc] = !(tier && tier.classList.contains('open'));
      renderSkills();
    }));
    el['skills-body'].querySelectorAll('[data-sk]').forEach((b) => b.addEventListener('click', () => { if (G.investSkill(b.dataset.sk)) renderSkills(); }));
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
  function siegeEvent(kind, s) {
    if (!_inited) return;
    if (kind === 'start') { toast('⚔ Siege begun — clear 10 waves', '#5b9cff'); }
    else if (kind === 'wavezone') { toast('★ Wave Zone cleared — the gauntlet resets', '#5bc06b'); }
    else if (kind === 'citadel') { const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#ff9a50'; t.style.fontSize = '22px'; t.innerHTML = '⛴ THE VOID CITADEL<br><span style="font-size:12px;color:#ffd9c4">Burn it down — 75% · 50% · 25% · boom</span>'; el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 2400); }
    else if (kind === 'citadeldown') { const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#ffd24d'; t.style.fontSize = '24px'; t.innerHTML = '☀ SUPERNOVA<br><span style="font-size:12px;color:#ffe9b0">Citadel razed — grab the loot!</span>'; el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 2600); }
    else if (kind === 'citadelhome') { toast('⌂ Siege complete — towed home. Citadel rebuilds in 15 min.', '#9ec5ff'); }
    else if (kind === 'towhome') { toast('⌂ Territory secured — towed back to your hangar', '#9ec5ff'); showScreen('galaxy'); }
    else if (kind === 'wave') { toast('Wave ' + s.wave + ' / ' + s.total, '#9ec5ff'); }
    else if (kind === 'boss') { const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#e23b4e'; t.style.fontSize = '22px'; t.textContent = '☠ BOSS WAVE'; el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 1700); }
    else if (kind === 'captured') { const sys = s.sys || {}; const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#5bc06b'; t.style.fontSize = '20px'; t.innerHTML = '★ SYSTEM CAPTURED<br><span style="font-size:13px;color:#cfe9ff">' + (sys.name || '') + (sys.resource ? ' · +' + GM.RES[sys.resource].glyph + ' ' + G.formatNum(sys.rate) + '/h' : '') + '</span>'; el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 2600); }
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

  window.UI = { init, syncHUD, refreshAll, syncStatsTab, onLoot, lootScrapped, onCollect, onLevelUp, onDeathReturn, showCatastropheWarning, showOffline, unlockToast, bossEvent, blueprintEvent, shipBuilt, siegeEvent, galaxyChanged, galaxyContestToast, openAccountSheet, purchaseResult };
})();
