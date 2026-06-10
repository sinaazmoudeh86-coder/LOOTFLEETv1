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
  let _msTaps = 0;          // SECRET Mothership unlock: CONSECUTIVE "My Ship" click streak

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
    { const lcChip = document.querySelector('.lc-chip'); if (lcChip) lcChip.addEventListener('click', () => { storeCat = 'cosmetics'; showScreen('store'); }); }

    document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => showScreen(b.dataset.screen)));
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
      const onMyShip = e.target.closest && e.target.closest('[data-hangtab="ship"], #hangar-dock .hd-btn[data-screen="hero"]');
      if (!onMyShip && _msTaps > 0) _msTaps = 0;
    }, true);
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
    screen = name;
    document.querySelectorAll('.screen.overlay').forEach((s) => s.classList.remove('active'));
    if (name !== 'battle') $('screen-' + name).classList.add('active');
    const navName = (name === 'hero') ? 'store' : name;
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.screen === navName));
    if (name === 'hero') renderHero();
    else if (name === 'bag') renderBag();
    else if (name === 'zones') renderZones();
    else if (name === 'galaxy') renderGalaxy();
    else if (name === 'store') renderStore();
    else if (name === 'board') renderBoard();
    else if (name === 'skills') renderSkills();
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
    // compress the chips, so nothing ever clips or overlaps the name chip.
    {
      const w = document.querySelector('#statusbar .wallet');
      if (w) {
        const sig = [el['hud-gold'], el['hud-fuel'], el['hud-iron'], el['hud-plasma'], el['hud-lc'], el['hud-fuel-rate'], el['hud-iron-rate'], el['hud-plasma-rate']]
          .map((e2) => (e2 ? e2.textContent : '')).join('|');
        if (syncHUD._wsig !== sig) {
          syncHUD._wsig = sig;
          w.classList.remove('tight', 'tighter', 'tightest');
          if (w.scrollWidth > w.clientWidth + 1) w.classList.add('tight');
          if (w.scrollWidth > w.clientWidth + 1) w.classList.add('tighter');
          if (w.scrollWidth > w.clientWidth + 1) w.classList.add('tightest');
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
    // hero-power pill shows THE ship that power belongs to
    if (el['pb-ship']) {
      const sk = s.ship || 'frigate';
      if (el['pb-ship'].dataset.k !== sk) { el['pb-ship'].src = 'ships/ship-' + sk + '.png'; el['pb-ship'].dataset.k = sk; }
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
      const wv = wz.bossSpawned ? (isSuper ? 'SUPER BOSS' : cit ? '⛴ RAZE THE CITADEL' : 'BOSS') : (cit ? 'ASSAULT ' : 'WAVE ') + Math.min(wz.wave, wz.total) + ' / ' + wz.total;
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
      <div class="acct-row">${pro ? '<button class="btn" id="ac-manage">Manage / cancel subscription</button>' : '<button class="btn gold" id="ac-gopro">★ Go Pro — $20/mo</button>'}</div>
      <div class="lo-sect" style="margin-top:11px">Security</div>
      <div class="acct-row">${cloud && s.email ? '<button class="btn" id="ac-reset">Send password-reset email</button>' : '<span class="acct-hint">Password reset needs a cloud account — sign up with email to enable it.</span>'}</div>
      <div class="lo-sect" style="margin-top:11px">📱 Text alerts</div>
      <p class="acct-hint" style="margin-bottom:6px">Get a text for big updates, heat resets &amp; exclusive drops.</p>
      <div class="acct-row"><input id="ac-phone" class="acct-in" type="tel" placeholder="+1 555 123 4567" value="${G.state.smsPhone || ''}"><button class="btn" id="ac-sms">${G.state.smsOptIn ? 'Update' : 'Sign up'}</button></div>
      ${G.state.smsOptIn ? '<p class="acct-hint" style="color:#7ce0a0">✓ Signed up — you can opt out anytime here.</p>' : ''}
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
  }
  function openProSheet() {
    const pro = G.isPro && G.isPro();
    const conf = window.PAYMENTS && window.PAYMENTS.linkFor && !!window.PAYMENTS.linkFor('pro_monthly');
    const sheet = showSheet(`<div class="sheet-head">★ LootFleet Pro</div><div class="sheet-body">
      <div class="ip-stat"><span class="ip-sname">⚡ Battle speed</span><span class="v">Exclusive 5× tier — Pro only</span></div>
      <div class="ip-stat"><span class="ip-sname">✨ Experience</span><span class="v">2× XP on every kill, account-wide</span></div>
      <div class="ip-stat"><span class="ip-sname">Price</span><span class="v">$20 / month · cancel anytime</span></div>
      ${pro ? `<p style="font-size:11px;color:#7ce0a0;margin-top:8px">✓ Active — renews ${new Date(G.state.proUntil).toLocaleDateString()}</p>` : ''}
      ${conf ? '' : '<p style="font-size:10.5px;color:#ffcf7a;margin-top:8px">⚒ Subscriptions are not live yet — payments are being wired up.</p>'}
      <div class="sheet-actions"><button class="btn" data-x>Close</button>
        ${pro ? '' : '<button class="btn gold" data-ok>★ Go Pro — $20/mo</button>'}</div></div>`);
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
      <div class="ip-stat"><span class="ip-sname">Price</span><span class="v">${LC_ICON} ${(G.formatNumRaw || G.formatNum)(price)} LootCoins</span></div>
      <div class="ip-stat"><span class="ip-sname">Your balance</span><span class="v" style="color:${afford ? '#7ce0a0' : 'var(--bad)'}">${LC_ICON} ${(G.formatNumRaw || G.formatNum)(have)}</span></div>
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
  }

  // ==========================================================================
  // HERO
  // ==========================================================================
  // SECRET: click "My Ship" 20 times IN A ROW in the Hangar to unlock the
  // Mothership. The streak resets on any other click (see the capture-phase
  // document listener in init).
  function tapMyShip() {
    const haveShip = G.state.ownedShips && G.state.ownedShips.mothership;
    if (haveShip && G.state.secretSpeed) return; // every secret already claimed
    _msTaps++;
    const left = 20 - _msTaps;
    if (left <= 0) {
      _msTaps = 0;
      const gotShip = !haveShip && G.grantShip('mothership');
      // the SAME trick is the only road to 10× speed
      const gotSpeed = !G.state.secretSpeed;
      if (gotSpeed) { G.state.secretSpeed = true; G.setGameSpeed(10); buildSpeedRow(); }
      const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#ff6ad5'; t.style.fontSize = '24px';
      t.innerHTML = (gotShip ? '✦ MOTHERSHIP UNLOCKED<br>' : '') +
        (gotSpeed ? '<span style="color:#ffd24d">⚡ 10× SPEED UNLOCKED</span><br>' : '') +
        '<span style="font-size:12px;color:#ffd7f3">' + (gotShip ? 'Fly it from Hangar → Ships · ' : '') + '10× is live on the speed row</span>';
      el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 3200);
      if (screen === 'hero') renderHero();
    } else if (_msTaps >= 8) {
      toast('✦ ' + left + ' more…', '#c77bff'); // whisper only once the streak is well underway
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
          : `<div class="pro-offer" id="pro-offer-cta"><div class="po-tag">PRO</div><div class="po-main"><div class="po-name">LootFleet Pro</div><div class="po-desc">⚡ Exclusive 5× battle speed · ✨ 2× XP on every kill</div><button class="po-buy">$20 / month — Go Pro</button></div></div>`;
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
      d.innerHTML = `<div class="slot-icon ${it ? rc(it.rarity) : ''}" style="${it ? 'border-color:' + C.RARITY[it.rarity].color : ''}">${icon}</div>
        <div class="slot-meta"><div class="slot-label">${label}</div><div class="slot-item ${it ? rc(it.rarity) : ''}">${it ? it.name : 'Empty'}</div></div>`;
      if (it) d.addEventListener('click', () => openItem(it, 'equipped'));
      el['equip-grid'].appendChild(d);
    });
    renderFleet();
    renderHeroStats();
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
          chips += `<div class="flc" data-fli="${key}:${sk}" style="border-color:${col}55"><span class="flc-ic">${slotDef.icon}</span><span class="flc-n" style="color:${col}">${it.name}</span></div>`;
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
        <div class="fr-item"><span class="fr-l">$ Auto-sell</span><select id="autosell-pickup-sel"><option value="-1" ${AST < 0 ? 'selected' : ''}>Off</option>${C.RARITY.slice(0, 7).map((r, i) => `<option value="${i}" ${i === AST ? 'selected' : ''}>≤ ${r.name}</option>`).join('')}</select></div>
      </div>
      <div class="fr-hint">Below pick-up level: scrapped to resources on contact · Auto-sell: sold for gold on pickup — upgrades are always kept</div>`;
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
          <span class="as-lbl">Auto-Sell up to</span>
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
    if (!inv.length) html += '<div class="empty-note">No loot in your bag.<br>Run over drops to collect them.</div>';
    else html += inv.map(itemCard).join('');
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
    el['bag-body'].querySelectorAll('[data-id]').forEach((node) => node.addEventListener('click', () => {
      const it = G.state.inventory.find((x) => x.id === +node.dataset.id); if (it) openItem(it, 'inventory');
    }));
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
    html += `<div class="gx-legend"><span class="gxl"><i style="background:#2e6fe0"></i>Available</span><span class="gxl"><i style="background:#d23b4e"></i>Rival</span><span class="gxl"><i style="background:#f2b24b"></i>Yours</span><span class="gxl"><i style="background:#4a5160"></i>Locked</span><span class="gxl">⛴ Citadel</span><span class="gxl">☠ Boss</span><span class="gxl">◷ Cooldown</span></div>`;
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
        const cd = (t.citadel || rival || owned) ? G.tileCooldownLeft(id) : 0;
        // fill by state
        let fill, edge;
        if (t.home) { fill = '#2a2438'; edge = '#f2b24b'; }
        else if (owned) { fill = 'rgba(242,178,75,0.30)'; edge = '#f2b24b'; }
        else if (rival) { fill = 'rgba(210,59,78,0.30)'; edge = '#d23b4e'; }
        else if (locked) { fill = 'rgba(74,81,96,0.25)'; edge = '#3a4150'; }
        else { fill = 'rgba(46,111,224,0.22)'; edge = '#2e6fe0'; }
        // hex path
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 3 * i + Math.PI / 6;
          const px = p.x + Math.cos(a) * (GX_HEX - 1.5), py = p.y + Math.sin(a) * (GX_HEX - 1.5);
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = fill; ctx.fill();
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
          if (cd > 0) { ctx.font = '800 8px Rajdhani, sans-serif'; ctx.fillStyle = '#ffcf7a'; ctx.fillText('◷', p.x + GX_HEX * 0.45, p.y - GX_HEX * 0.4); }
          if (owned) { ctx.fillStyle = '#7ce0a0'; ctx.font = '800 7px Rajdhani, sans-serif'; ctx.fillText('★', p.x - GX_HEX * 0.45, p.y - GX_HEX * 0.4); }
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
        return `<div class="ip-stat"><span class="ip-sname" style="color:${d.color}">${d.glyph} ${d.name}</span><span class="v">+${G.formatNum(rates[k2] || 0)}/h</span></div>`;
      }).join('');
      const sheet = showSheet(`<div class="sheet-head">⌂ Home Citadel</div><div class="sheet-body">
        <p style="margin-bottom:8px">The neutral heart of the Galaxy — every operator's safe harbor. It cannot be conquered.</p>
        <div class="lo-sect">Your gathering operation</div>
        ${rows}
        <div class="ip-stat"><span class="ip-sname">Territory held</span><span class="v">${owned.length} tile${owned.length === 1 ? '' : 's'}${citN ? ` · ⛴ ${citN} citadel${citN > 1 ? 's' : ''}` : ''}${bossN ? ` · ☠ ${bossN}` : ''}${deepN ? ` · ☢ ${deepN} deep` : ''}</span></div>
        ${owned.length === 0 ? '<p style="font-size:11px;color:var(--muted);margin-top:6px">Claim tiles on the map to start generating Galaxy Resources every hour — citadels pay 100×.</p>' : ''}
        <div class="sheet-actions"><button class="btn" data-x>Close</button><button class="btn primary" data-ok>⌂ Dock</button></div></div>`);
      sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
      sheet.querySelector('[data-ok]').addEventListener('click', () => { closeSheet(); G.selectDungeon(0); showScreen('battle'); });
      return;
    }
    const typeName = t.citadel ? '⛴ CITADEL SIEGE ZONE' : t.boss ? '☠ Boss Tile' : t.resource ? (GM.RES[t.resource].glyph + ' Resource Field') : 'Combat Sector';
    const owner = t.owned ? 'You' : (t.rival || 'Unclaimed');
    const ownerCol = t.owned ? 'var(--gold)' : (t.rival ? '#e8a34a' : '#7fb4ff');
    const ratePerH = t.rate ? t.rate * (t.deep ? GM.DEEP_MULT.resource : 1) : 0;
    const cdTxt = t.cooldown > 0 ? (t.citadel ? Math.floor(t.cooldown / 3600) + 'h ' + Math.floor((t.cooldown % 3600) / 60) + 'm' : fmtCd(t.cooldown)) : null;
    const blocked = t.rival && t.cooldown > 0;
    const action = t.owned ? 'Deploy' : t.rival ? (t.citadel ? 'Siege' : 'Attack') : (t.citadel ? 'Siege' : 'Capture');
    const obj = t.owned ? (t.boss || t.citadel ? 'Farm endless boss waves on your tile' : 'Farm your territory')
      : t.citadel ? 'Fight up through the garrison, raze the Void Citadel, and it becomes YOUR Citadel'
      : t.boss ? 'Clear 10 waves, then defeat the <b style="color:var(--hp)">BOSS</b>' : 'Clear 10 waves to capture';
    const ec = G.entryCostFor ? G.entryCostFor(id) : null;
    const myRes = G.getResources ? G.getResources() : {};
    const ecAfford = !ec || GM.RES_KEYS.every((k2) => (myRes[k2] || 0) >= (ec[k2] || 0));
    const ecRow = ec ? `<div class="ip-stat"><span class="ip-sname">Entry cost</span><span class="v">${GM.RES_KEYS.filter((k2) => ec[k2]).map((k2) => `<span style="color:${(myRes[k2] || 0) >= ec[k2] ? GM.RES[k2].color : 'var(--bad)'}">${GM.RES[k2].glyph} ${G.formatNum(ec[k2])}</span>`).join(' ')}${t.owned ? ' <span style="color:var(--muted-2)">(½ — your territory)</span>' : ''}</span></div>` : '';
    const sheet = showSheet(`<div class="sheet-head">${t.rival ? 'Contest' : t.owned ? 'Your Tile' : 'Claim'} · ${t.name}</div><div class="sheet-body">
      <div class="ip-stat"><span class="ip-sname">Ring · Level</span><span class="v">Ring ${t.ring} · Lv ${t.level}${t.deep ? ' · ☢ DEEP SPACE' : ''}</span></div>
      <div class="ip-stat"><span class="ip-sname">Type</span><span class="v">${typeName}${t.rarity ? ' · ' + (t.rarity === 2 ? '★★ Rare' : '★ Uncommon') : ''}</span></div>
      <div class="ip-stat"><span class="ip-sname">Owner</span><span class="v" style="color:${ownerCol}">${owner}</span></div>
      ${ratePerH ? `<div class="ip-stat"><span class="ip-sname">Output / h</span><span class="v" style="color:${GM.RES[t.resource].color}">${GM.RES[t.resource].glyph} ${G.formatNum(ratePerH)} ${GM.RES[t.resource].name}${t.citadel ? ' · 100× CITADEL' : ''}</span></div>` : ''}
      <div class="ip-stat"><span class="ip-sname">Enemy difficulty</span><span class="v">Zone Lv ${t.diff}</span></div>
      <div class="ip-stat"><span class="ip-sname">Loot quality</span><span class="v">×${t.lootQ}${t.deep ? ' (deep space)' : ''}</span></div>
      ${ecRow}
      <div class="ip-stat"><span class="ip-sname">Status</span><span class="v">${cdTxt ? '◷ ' + (t.citadel ? 'Siege lockout ' : 'Cooldown ') + cdTxt : (t.locked ? '🔒 Lv ' + Math.max(1, t.level - 10) + ' required' : '⚔ Open to attack')}</span></div>
      <div class="ip-stat"><span class="ip-sname">Objective</span><span class="v">${obj}</span></div>
      ${t.citadel && !t.owned ? '<p style="font-size:11px;margin-top:6px;color:#ffb088">⛴ Citadels generate <b>100×</b> resources and can only be sieged <b>once per day</b>.</p>' : ''}
      ${t.deep ? '<p style="color:var(--hp);font-size:11px;margin-top:6px">⚠ Deep space — you lose <b>2 items</b> on death, but loot & resources are vastly richer.</p>' : ''}
      ${!ecAfford ? '<p style="color:var(--bad);font-size:11px;margin-top:6px">Not enough Galaxy Resources to warp this deep — farm or capture closer rings first.</p>' : ''}
      <div class="sheet-actions"><button class="btn" data-x>Close</button><button class="btn ${t.owned ? 'primary' : 'gold'}" data-ok ${(blocked || t.locked || !ecAfford) ? 'disabled' : ''}>${action}</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
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
    let html = '';
    const safe = s.currentDungeon < 1;
    html += `<div class="zone-row safe ${safe?'active':''}" data-d="0">
        <div class="z-num" style="color:var(--hp)">⌂</div>
        <div class="z-meta"><div class="z-name" style="color:var(--hp)">Your Hangar</div>
          <div class="z-sub">Home bay · review &amp; refit your ship</div></div>
        <div class="z-go">${safe?'● DOCKED':'RETURN'}</div></div>`;
    for (let d = 1; d <= top; d++) {
      const locked = d > s.highestUnlocked, active = d === s.currentDungeon;
      const types = C.ENEMIES.filter((e) => d >= e.minDungeon), topType = types[types.length-1];
      const blocked = d > blockCap;
      const reqLv = Math.max(1, d - 10);
      const lockLabel = blocked ? '🔒 Clear Zone ' + (Math.floor((d - 1) / C.ZONE_BLOCK) * C.ZONE_BLOCK) : '🔒 Lv ' + reqLv;
      const bz = G.zoneBonuses(d);
      const wave = d % 11 === 0;
      const cit = G.isCitadelZone && G.isCitadelZone(d);
      const citCd = cit ? G.citadelCooldownLeft(d) : 0;
      const bonus = (wave?`<span class="z-bon wave">◎ WAVE ZONE · 25 waves → boss</span>`:'') +
                    (cit?`<span class="z-bon cit">⛴ CITADEL SIEGE · raze the fortress</span>`:'') +
                    (citCd>0?`<span class="z-bon citcd">◷ rebuilds in ${fmtCd(citCd)}</span>`:'') +
                    (bz.density>1?`<span class="z-bon dens">⚔ ${bz.density}× density</span>`:'') +
                    (bz.quality>1?`<span class="z-bon qual">✦ ${bz.quality}× loot quality</span>`:'');
      html += `<div class="zone-row ${active?'active':''} ${locked||citCd>0?'locked':''} ${d===rec?'rec':''} ${bz.prismatic||wave?'prismatic':''} ${wave?'wavezone':''} ${cit?'citzone':''}" data-d="${d}" data-cit-cd="${citCd>0?1:0}">
        <div class="z-num">${d}</div>
        <div class="z-meta"><div class="z-name">${zoneName(d)}${wave?' <span class="z-wtag">WAVE</span>':''}${cit?' <span class="z-ctag">CITADEL</span>':''}</div>
          <div class="z-sub">Enemy Lv ${G.formatNum(C.dungeonEnemyLevel(d))} · ${topType.name}s</div>
          ${bonus?`<div class="z-bons">${bonus}</div>`:''}
          ${d===rec && !active ? '<span class="z-rec">★ RECOMMENDED</span>' : ''}</div>
        <div class="z-go">${locked ? lockLabel : citCd>0 ? '◷ ' + fmtCd(citCd) : active ? '● HERE' : (cit ? '⛴ BREACH' : wave ? '◎ ENTER' : (d===rec ? '★ DEPLOY' : 'DEPLOY'))}</div></div>`;
    }
    el['zones-body'].innerHTML = html;
    el['zones-body'].querySelectorAll('.zone-row:not(.locked)').forEach((row) => row.addEventListener('click', () => { G.selectDungeon(+row.dataset.d); showScreen('battle'); }));
    const recRow = el['zones-body'].querySelector('.zone-row.rec');
    if (recRow) el['zones-body'].scrollTop = Math.max(0, recRow.offsetTop - 90);
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
  const HANGAR_TABS = [['ship','My Ship'],['ships','Ships'],['market','Market'],['board','Leaderboard'],['cosmetics','Cosmetics']];
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
      else if (k === 'board') showScreen('board');
      else { storeCat = k; showScreen('store'); }
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
  function shipCard(key) {
    const ship = C.SHIP_BY_KEY[key], st = G.shipBuyState(key);
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
      ${lock}
    </div>`;
  }
  // ==========================================================================
  // ITEM ICONOGRAPHY — refreshed slot icons; weapons show their CLASS glyph
  // color-coded with a matching glow (laser/gatling/missile/rail/plasma/warden).
  // ==========================================================================
  const SLOT_ICONS2 = {
    bow:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17L14 6l4 4L7 21H3z"/><path d="M14 6l2-2 4 4-2 2"/><circle cx="19" cy="5" r="1"/></svg>',
    arrows: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 20V9l2-3.5L12 9v11"/><path d="M14 20V6l2-3 2 3v14"/><path d="M5.5 20h13"/></svg>',
    armor:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 3v6c0 5-3.4 9-8 11-4.6-2-8-6-8-11V5z"/><path d="M12 6.5l4 1.5v3.2c0 2.6-1.7 4.7-4 5.8-2.3-1.1-4-3.2-4-5.8V8z"/></svg>',
    boots:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2h6l1.2 10H7.8z"/><path d="M7 12h10l1 4H6z"/><path d="M12 16v4M8.6 16l-1.6 4M15.4 16l1.6 4"/></svg>',
    gloves: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><path d="M12 2v3.4M12 18.6V22M2 12h3.4M18.6 12H22"/></svg>',
    amulet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8.7 5v10L12 22l-8.7-5V7z"/><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="0.8" fill="currentColor"/></svg>',
  };
  function itemIcon(it) {
    if (it && it.slot === 'bow' && window.ITEMS && window.ITEMS.weaponClassOf) {
      const wc = window.ITEMS.weaponClassOf(it);
      return `<span class="wci" style="color:${wc.color};text-shadow:0 0 9px ${wc.color}">${wc.glyph}</span>`;
    }
    return (it && SLOT_ICONS2[it.slot]) || (it && it.icon) || '';
  }
  // —— LOOTCOIN —— the premium micro-transaction currency. One unique mark used
  // everywhere it appears: a hex coin, gold → violet, with a loot-gem facet cut
  // into the center (echoes the loot-drop gems players chase in combat).
  const LC_ICON = '<svg class="lc" viewBox="0 0 24 24"><defs><linearGradient id="lcg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe27a"/><stop offset=".55" stop-color="#f2a93c"/><stop offset="1" stop-color="#b86adf"/></linearGradient></defs><path d="M12 1.5l9 5.25v10.5L12 22.5l-9-5.25V6.75z" fill="url(#lcg)" stroke="#2a1808" stroke-width="1.1"/><path d="M12 5.6l5.6 3.25v6.3L12 18.4l-5.6-3.25v-6.3z" fill="rgba(22,12,32,.88)"/><path d="M12 8.4l3.1 1.85v3.5L12 15.6l-3.1-1.85v-3.5z" fill="url(#lcg)"/><path d="M12 8.4l3.1 1.85-3.1 1.8-3.1-1.8z" fill="#fff3c9" opacity=".75"/></svg>';
  function renderStore() {
    let html = hangarTabsHTML(storeCat);
    const cur = C.SHIP_BY_KEY[G.state.ship];

    if (storeCat === 'ships') {
      html += `<div class="store-sec">${storeHead(STORE_ICONS.ship, 'Hangar · Ships', 'Flying: ' + (cur?cur.name:'—'))}`;
      // FEATURED hero banner — LootCoin fast-track: Carrier first, then Mothership
      {
        const offer = !G.state.ownedShips.carrier ? { key: 'carrier', lc: 25000 }
          : (!G.state.ownedShips.mothership ? { key: 'mothership', lc: 75000 } : null);
        if (offer && G.buyShipLC) {
          const sh = C.SHIP_BY_KEY[offer.key];
          html += `<div class="hero-offer" data-lcship="${offer.key}" data-lcprice="${offer.lc}">
            <div class="ho-tag">★ FEATURED</div>
            <div class="ho-main">
              <div class="ho-name">${sh.name}</div>
              <div class="ho-desc">${offer.key === 'carrier' ? 'Skip the grind — instant drone-bay command.' : 'The ultimate hull. Skip the entire chain.'}</div>
              <button class="ho-buy">${LC_ICON}${(G.formatNumRaw || G.formatNum)(offer.lc)} · Unlock now</button>
            </div>
            <img class="ho-ship" src="ships/ship-${offer.key}.png" alt="">
          </div>`;
        }
      }
      html += `<div class="sec-blurb">Buy hulls with gold. Each unlocks only after you recover its <b>blueprint</b> from a zone boss and prove yourself in the previous hull.</div>`;
      html += C.SHIPS.map((s) => shipCard(s.key)).join('');
      html += '</div>';
    }

    if (storeCat === 'market') {
      const sh = G.getShop(); const tl = G.shopTimeLeft(); const mm = Math.floor(tl/60), ss = tl%60;
      const price = sh.price != null ? sh.price : G.shopItemPrice();
      html += `<div class="store-sec">${storeHead(STORE_ICONS.market, 'Black Market · Gold', `${mm}:${ss<10?'0':''}${ss}`)}`;
      html += `<div class="sec-blurb">Gear upgrades · fixed price this rotation.</div>`;
      sh.items.forEach((it, i) => {
        if (!it) return;
        const bought = sh.bought.includes(i), r = C.RARITY[it.rarity];
        const afford = G.state.gold >= price, up = G.shopIsUpgrade(it);
        html += `<div class="store-card shop-card ${bl(it.rarity)}" style="border-left-width:3px">
          <div class="sc-ico" style="border-color:${r.color}">${itemIcon(it)}</div>
          <div class="sc-main"><div class="sc-name ${rc(it.rarity)}">${it.name} ${up?'<span class="ic-tag up" style="vertical-align:2px">▲ UP</span>':''}</div>
            <div class="sc-desc">${r.name} · ${C.SLOTS[it.slot].name} · Z${it.dungeon}</div></div>
          <button class="sc-buy" data-shop="${i}" ${bought||!afford?'disabled':''}>${bought?'Sold':'<span class="coin">$</span> '+G.formatNum(price)}</button></div>`;
      });
      html += '</div>';
    }

    if (storeCat === 'cosmetics') {
      const cs = G.getCosmetics(), credits = G.getCredits();
      html += `<div class="store-sec">${storeHead(STORE_ICONS.cosmetics, 'Cosmetics')}
        <div class="cred-bar"><span class="cred-have">${LC_ICON}<b>${(G.formatNumRaw || G.formatNum)(credits)}</b> LootCoins</span><button class="cred-get" id="cred-get">+ Get LootCoins</button></div>
        <p class="cos-note">Purely visual — cosmetics never affect power. Skins &amp; auras apply to every hull you fly.</p>`;
      const section = (kind, title, list) => {
        html += `<div class="cos-h">${title}</div><div class="cos-grid">`;
        list.forEach((c) => {
          const owned = !!cs.owned[c.key];
          const equipped = (kind === 'skin' ? cs.skin : cs.aura) === c.key;
          html += `<div class="cos-card ${equipped ? 'on' : ''}" data-ck="${kind}:${c.key}">
            <div class="cos-prev ${(c.key === 'prismatic' || c.key === 'prism') ? 'anim' : ''}" style="background:${c.sw}"></div>
            <div class="cos-name">${c.name}</div>
            <div class="cos-desc">${c.desc}</div>
            <div class="cos-act">${equipped ? '<span class="cos-on">✓ EQUIPPED</span>' : owned ? '<button class="cos-btn eq">Equip</button>' : (c.credits ? `<button class="cos-btn buy ${credits >= c.credits ? '' : 'cant'}">${LC_ICON}${c.credits}</button>` : '<button class="cos-btn eq">Equip</button>')}</div>
          </div>`;
        });
        html += '</div>';
      };
      section('skin', '⬢ Hull Skins', C.COSMETICS.skins);
      section('aura', '◎ Auras', C.COSMETICS.auras);
      html += '</div>';
    }

    el['store-body'].innerHTML = html;
    // featured LootCoin ship offer
    el['store-body'].querySelectorAll('[data-lcship]').forEach((b) => b.addEventListener('click', () => openShipLCBuy(b.dataset.lcship, +b.dataset.lcprice)));
    // cosmetics: buy / equip / get-credits wiring
    el['store-body'].querySelectorAll('[data-ck]').forEach((card) => card.addEventListener('click', () => {
      const parts = card.dataset.ck.split(':'), kind = parts[0], key = parts[1];
      const cs = G.getCosmetics();
      if (cs.owned[key]) {
        const already = (kind === 'skin' ? cs.skin : cs.aura) === key;
        if (!already) { G.setCosmetic(kind, key); toast('✓ Equipped', '#7ce0a0'); renderStore(); }
      } else {
        const r = G.buyCosmetic(kind, key);
        if (r.ok) { G.setCosmetic(kind, key); toast('★ Unlocked & equipped!', '#ffd24d'); renderStore(); }
        else if (r.reason === 'credits') openCredits();
      }
    }));
    { const cg = $('cred-get'); if (cg) cg.addEventListener('click', openCredits); }
    // render each card's icon as the ACTUAL battle hull (same renderer as combat)
    el['store-body'].querySelectorAll('canvas[data-shipic]').forEach((cv) => {
      const key = cv.dataset.shipic; if (!C.SHIP_BY_KEY[key]) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1), W = 50, H = 50;
      cv.width = W * dpr; cv.height = H * dpr;
      const cx = cv.getContext('2d'); cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const gear = key === G.state.ship ? G.state.equipped : (G.state.fittings[key] || {});
      R.drawHullPortrait(cx, key, gear, W, H);
    });
    // black-market gold buys
    el['store-body'].querySelectorAll('[data-shop]').forEach((b) => b.addEventListener('click', () => {
      const i = +b.dataset.shop; const it = G.getShop().items[i];
      if (G.buyShopItem(i)) { toast('Bought ' + it.name, C.RARITY[it.rarity].color); renderStore(); }
    }));
    // ship buy / switch / blueprint-hunt
    el['store-body'].querySelectorAll('[data-ship-buy]').forEach((b) => b.addEventListener('click', () => openShipBuy(b.dataset.shipBuy)));
    el['store-body'].querySelectorAll('[data-ship-switch]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.shipSwitch; if (G.switchShip(k)) { toast('Now flying the ' + C.SHIP_BY_KEY[k].name, '#5bc06b'); renderStore(); }
    }));
    el['store-body'].querySelectorAll('[data-bp-hunt]').forEach((b) => b.addEventListener('click', () => {
      G.selectDungeon(+b.dataset.bpHunt); showScreen('battle');
      toast('Deploying — defeat the boss for the blueprint', '#e6b566');
    }));
    // hangar segment tabs (My Ship / store categories)
    wireHangarTabs(el['store-body']);
  }
  // confirm sheet for a gold ship purchase
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
    const heat = LB.heatBoard(G);
    el['board-sub'].textContent = lbTab === 'heat' ? 'Heat ' + heat.heat : 'All-Time';
    // LIVE feel: rival scores wobble a touch every refresh (pure presentation —
    // zero net growth, just a ±~1% sine jitter seeded per name)
    const jt = Date.now() / 1000;
    const jitter = (v, s2) => { let h = 0; for (let i = 0; i < s2.length; i++) h = (h * 31 + s2.charCodeAt(i)) | 0; return Math.max(1, Math.round(v * (1 + 0.012 * Math.sin(jt * 0.9 + (h % 97))))); };
    let html = hangarTabsHTML('board');
    html += `<div class="lb-tabs">
      <button class="lb-tab ${lbTab==='heat'?'active':''}" data-t="heat">My Heat</button>
      <button class="lb-tab ${lbTab==='all'?'active':''}" data-t="all">All-Time</button></div>`;
    let data;
    if (lbTab === 'heat') {
      data = heat;
      html += `<div class="lb-info">Heat ${heat.heat} · week of ${heat.label}. Everyone who started this week competes together. New heat every Monday.</div>`;
    } else {
      data = LB.allTimeBoard(G);
      html += `<div class="lb-info">All-time ranking across every heat since launch.</div>`;
    }
    html += data.board.slice(0, 60).map((p, i) => `
      <div class="lb-row ${p.isMe?'me':''}" data-rank="${i}">
        <div class="lb-rank ${p.rank<=3?'top':''}">${p.rank}</div>
        <div class="lb-nm"><div class="lb-name ${p.isMe?'':''}">${p.isMe?'★ ':''}${p.name}</div>
          <div class="lb-meta">Zone ${p.zone} · Lv ${p.level} · ${G.formatNum(p.isMe ? p.kills : jitter(p.kills, p.name + 'k'))} kills</div>
          <div class="lb-fleet">${(p.isMe ? (p.fleet || [G.state.ship]) : (LB.fleetFor ? LB.fleetFor(p, p.rank, data.board.length) : [])).map((fk) => `<img class="lbf" src="ships/ship-${fk}.png" alt="" title="${C.SHIP_BY_KEY[fk] ? C.SHIP_BY_KEY[fk].name : fk}">`).join('')}</div></div>
        <div class="lb-pow"><span class="pl">PWR</span>${(G.formatNumRaw || G.formatNum)(p.isMe ? p.power : jitter(p.power, p.name))}</div></div>`).join('');
    const _sc = el['board-body'].scrollTop;
    el['board-body'].innerHTML = html;
    el['board-body'].scrollTop = _sc;
    wireHangarTabs(el['board-body']);
    el['board-body'].querySelectorAll('.lb-tab').forEach((b) => b.addEventListener('click', () => { lbTab = b.dataset.t; renderBoard(); }));
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
      grid += `<div class="lo-slot ${it?bl(it.rarity):''}"><div class="lo-ic ${it?rc(it.rarity):''}">${def.icon}</div>
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
  function openItem(item, mode) {
    const r = C.RARITY[item.rarity];
    const equipped = G.state.equipped[item.slot];
    const cmp = (mode === 'inventory' && equipped) ? G.compare(item, equipped) : null;
    let statHTML = '';
    Object.keys(item.stats).forEach((k) => {
      const d = C.STATS[k]; if (!d) return;
      let cmpStr = '';
      if (cmp && cmp[k]) { const up = cmp[k] > 0; cmpStr = ` <span style="font-size:11px;color:${up?'var(--good)':'var(--bad)'}">(${up?'+':''}${d.fmt==='flat'?G.formatNum(cmp[k]):(Math.round(cmp[k]*10)/10)}${d.fmt==='flat'?'':'%'})</span>`; }
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
    } else if (mode === 'equipped') actions = `<div class="sheet-actions"><button class="btn" data-x>Close</button></div>`;
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
        return `<div class="ip-wclass" style="color:${wc.color}">${wc.glyph} ${wc.name} · <b>${wc.bonus}</b></div><div class="ip-wdesc">${wc.blurb}</div>${extra}`; })()}
      ${statHTML}${cmpNote}${actions||'<div class="sheet-actions"><button class="btn" data-x>Close</button></div>'}</div></div>`);
    const eq = sheet.querySelector('[data-eq]'); if (eq) eq.addEventListener('click', () => { G.equip(item, 'primary'); closeSheet(); });
    const eq2 = sheet.querySelector('[data-eq2]'); if (eq2) eq2.addEventListener('click', () => { G.equip(item, 'secondary'); closeSheet(); });
    const sl = sheet.querySelector('[data-sell]'); if (sl) sl.addEventListener('click', () => {
      const r = G.sell(item); closeSheet();
      if (r) { const sv = salvageStr(r.salvage);
        toast(`Sold for <b style="color:var(--gold)">${G.formatNum(r.gold)}g</b>${sv ? '  ·  ' + sv : ''}`, sv ? '#5bc0ff' : '#e6b566'); }
    });
    const x = sheet.querySelector('[data-x]'); if (x) x.addEventListener('click', closeSheet);
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
    const now = Date.now();
    if (now - _scrapT < 1500) return;
    _scrapT = now;
    const t = document.createElement('div'); t.className = 'loot-toast scrapped';
    t.innerHTML = `<span class="${rc(item.rarity)}">${item.name}</span><span class="lt-scrap">⚒ scrapped · hold full</span>`;
    el['loot-feed'].appendChild(t); setTimeout(() => t.remove(), 3200);
    while (el['loot-feed'].children.length > 5) el['loot-feed'].removeChild(el['loot-feed'].firstChild);
  }
  let _lastLootToast = 0, _bagDirty = false, _bagTimer = 0;
  function onCollect(item) {
    if (!_inited) return;
    const now = performance.now();
    // rate-limit loot toasts (10x pickups would otherwise flood the DOM)
    if (now - _lastLootToast > 220) {
      _lastLootToast = now;
      const t = document.createElement('div');
      t.className = 'loot-toast ' + bl(item.rarity);
      t.innerHTML = `<span class="${rc(item.rarity)}">${item.name}</span>`;
      el['loot-feed'].appendChild(t);
      setTimeout(() => t.remove(), 3200);
      while (el['loot-feed'].children.length > 5) el['loot-feed'].removeChild(el['loot-feed'].firstChild);
    }
    const n = G.state.inventory.length;
    el['bag-badge'].style.display = n > 0 ? 'block' : 'none'; el['bag-badge'].textContent = n;
    // debounce bag re-render to at most ~3/sec while the bag is open
    if (screen === 'bag') {
      _bagDirty = true;
      if (!_bagTimer) _bagTimer = setTimeout(() => { _bagTimer = 0; if (_bagDirty && screen === 'bag') { _bagDirty = false; renderBag(); } }, 350);
    }
  }
  function toast(text, color) {
    if (!_inited) return;
    const t = document.createElement('div'); t.className = 'loot-toast'; t.style.borderLeftColor = color;
    t.innerHTML = `<span style="color:${color}">${text}</span>`;
    el['loot-feed'].appendChild(t); setTimeout(() => t.remove(), 3200);
  }
  function onLevelUp(level) {
    if (!_inited) return;
    const t = document.createElement('div'); t.className = 'lvl-toast'; t.textContent = 'LEVEL ' + level;
    el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 1700);
  }
  function unlockToast(msg) { toast('★ ' + msg, '#e6b566'); }
  function blueprintEvent(ship) {
    if (!_inited || !ship) return;
    const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#7fe0ff'; t.style.fontSize = '20px';
    t.innerHTML = `◷ BLUEPRINT<br><span style="font-size:13px;color:#cfe9ff">${ship.name} unlocked in the Store</span>`;
    el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 2600);
    toast('Blueprint recovered: ' + ship.name, '#7fe0ff');
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
    else if (kind === 'towhome') { toast('⌂ Territory secured — towed back to your hangar', '#9ec5ff'); }
    else if (kind === 'wave') { toast('Wave ' + s.wave + ' / ' + s.total, '#9ec5ff'); }
    else if (kind === 'boss') { const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#e23b4e'; t.style.fontSize = '22px'; t.textContent = '☠ BOSS WAVE'; el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 1700); }
    else if (kind === 'captured') { const sys = s.sys || {}; const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#5bc06b'; t.style.fontSize = '20px'; t.innerHTML = '★ SYSTEM CAPTURED<br><span style="font-size:13px;color:#cfe9ff">' + (sys.name || '') + (sys.resource ? ' · +' + GM.RES[sys.resource].glyph + ' ' + G.formatNum(sys.rate) + '/h' : '') + '</span>'; el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 2600); }
  }
  // Small wreck notice — the ship has already been auto-towed to the hangar.
  function onDeathReturn(lostItem, killerName, zone) {
    if (!_inited) return;
    refreshAll();
    G.state.deathExplained = true; G.save();
    const lostHtml = lostItem
      ? `Lost <b class="${rc(lostItem.rarity)}">${lostItem.name}</b><br><span style="color:var(--muted);font-size:11px">${C.RARITY[lostItem.rarity].name} · ${C.SLOTS[lostItem.slot].name} · gone for good</span>`
      : 'No gear was lost this time.';
    const sheet = showSheet(`<div id="wreck-pop">
      <div class="wreck-skull">☠</div>
      <div class="wreck-title">SHIP WRECKED</div>
      <div class="wreck-by">Downed by a <b>${killerName || 'hostile'}</b>${zone >= 1 ? ' in ' + zoneName(zone) : ''}</div>
      <div class="wreck-loss">${lostHtml}</div>
      <div class="wreck-foot">⌂ Towed back to your hangar.</div>
      <div class="sheet-actions" style="margin-top:14px"><button class="btn primary" data-x>Continue</button></div></div>`);
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

  window.UI = { init, syncHUD, refreshAll, syncStatsTab, onLoot, lootScrapped, onCollect, onLevelUp, onDeathReturn, showOffline, unlockToast, bossEvent, blueprintEvent, siegeEvent, galaxyChanged, galaxyContestToast, openAccountSheet };
})();
