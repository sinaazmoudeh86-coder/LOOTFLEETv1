/* =============================================================================
   server-dreadnaught.js — LOOTFLEET · SERVER DREADNAUGHT (seasonal world boss)
   ---------------------------------------------------------------------------
   Command ▸ "Voidmaw" — a GLOBAL server event, unlocked at Level 50. PERMANENT:
   Every commander fights the exact same boss independently. The boss never
   dies: players push through endless stages by dealing CUMULATIVE damage
   across the whole season. Separate from the weekly Dreadnaught Hunt.

     • 2 daily attempts (+1 for Pro) · each run is 2:30 of auto-combat with
       the equipped fleet, simulated from the player's real combat stats.
     • Stages scale forever (10M → 25M → 50M → …). Every stage cleared grants
       instant loot: gold, resources, REAL ship parts (state.shipParts — same
       inventory Shipworks builds from), ◇ Dread Cores, ❖ Voidmaw Parts, and
       an aspirational Titan Sina part chance at very high stages.
     • The boss deals a % of the player's MAX HP per hit and evolves visually
       every 10 stages — everyone eventually falls; better fleets fall later.
     • DAILY leaderboard (best single run → ❖ Voidmaw Parts) · SEASON
       leaderboard (total damage → ★ Titan Sina Parts at season end).
     • No end date. It was a limited season once; it is a fixture now, so no
       screen prints a deadline. `SEASON.num` survives only as a wire key.

   Wiring: #screen-sdread / #sdread-body (game.html) · showScreen('sdread')
   routes here (ui-v94.js) · command card .cmd-sdread + LOCKS sdread:50.
   ============================================================================= */
(function () {
  'use strict';
  const G = () => window.GAME;
  const $ = (id) => document.getElementById(id);

  // ---- SEASON CONFIG --------------------------------------------------------
  // PERMANENT EVENT. The Voidmaw is not a limited season any more, so there is no
  // end date and no countdown to one — a deadline printed on screen is a promise,
  // and the one thing worse than removing an event is telling players it is going
  // away and then keeping it.
  //
  // `num` STAYS 1 FOREVER. It is not a label, it is a WIRE KEY: every row already
  // written to the boards carries season=1, and sdUpsert/sdDaily/sdSeason all
  // query on it. Renaming it to read better would orphan every score on the
  // server. A stored identifier is a receipt.
  const SEASON = { num: 1, boss: 'VOIDMAW', label: 'Voidmaw', end: Infinity };
  const UNLOCK = 50;                 // minimum level to join
  const BASE_ATTEMPTS = 2;           // daily attempts
  const PRO_ATTEMPTS = 1;            // +1 for LootFleet Pro
  const RUN_SECS = 150;              // 2:30 per attempt
  const ACCENT = '#b04dff';          // void violet
  const SHARD = '❖';                 // Voidmaw glyph

  // ---- utils ----------------------------------------------------------------
  function fmt(n) { try { return G().formatNum(Math.floor(n)); } catch (e) { return Math.floor(n) + ''; } }
  function lvl() { try { return (G().state.level | 0) || 1; } catch (e) { return 1; } }
  function isPro() { try { return !!G().isPro(); } catch (e) { return false; } }
  function toast(m) { try { if (window.UI && window.UI.unlockToast) window.UI.unlockToast(m); } catch (e) {} }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dayIdx() { return Math.floor(Date.now() / 864e5); }
  function ended() { return false; }   // permanent event — nothing closes it
  function fmtDur(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm ' + (s % 60) + 's';
  }
  function shipName(k) { try { return window.CONFIG.SHIP_BY_KEY[k].name; } catch (e) { return k; } }

  // ---- persistent state -------------------------------------------------
  // Event Coins are a BALANCE, so they are read through Math.floor, never `| 0`
  // (bitwise OR wraps negative past 2,147,483,647 — see the currency rule).
  const coinsOf = (s) => Math.floor(Number(s && s.coins) || 0);
  function sd() {
    const g = G(); if (!g || !g.state) return null;
    const st = g.state;
    if (!st.sdread) st.sdread = { v: 1, shards: 0, seen: 0, day: dayIdx(), att: 0, bestDay: 0, bestEver: 0, total: 0, hist: [], runs: 0 };
    const s = st.sdread;
    // SEASON RESET WITH THE 456 REBALANCE. The client keeps its own season record,
    // and the server board was zeroed (voidmaw-season-reset.sql) because pre-scale
    // totals are unbeatable on the new numbers. Wipe PROGRESS, keep everything
    // already PAID: coins, parts, claims, prize history, the assembled-Voidmaw flag.
    if (!s.rebal4) {
      s.rebal4 = 1;
      s.total = 0; s.bestDay = 0; s.bestEver = 0; s.att = 0; s.buys = 0;
      s.lbRank = null; s.lbSeasonRank = null;
      if (!s.hist) s.hist = [];
      s.hist.unshift({ d: Date.now(), s: 0, txt: '⚖ SEASON REBALANCED — damage and HP were scaled down galaxy-wide, so the season board restarted for everyone on the new numbers. Coins, parts and prizes already paid are untouched.' });
      try { g.save(); } catch (e) {}
    }
    if (s.day !== dayIdx()) {                                    // daily reset
      settleLeaderboard(s);                                       // grant yesterday's placement first
      s.day = dayIdx(); s.att = 0; s.bestDay = 0; s.buys = 0;
      try { g.save(); } catch (e) {}
    }
    settleSeason(s);                                              // end-of-season final standings
    return s;
  }
  function attemptsMax() { const s = sd(); return BASE_ATTEMPTS + (isPro() ? PRO_ATTEMPTS : 0) + ((s && s.buys) | 0); }
  function attemptsLeft() { const s = sd(); return s ? Math.max(0, attemptsMax() - (s.att | 0)) : 0; }
  function msToDailyReset() { return (dayIdx() + 1) * 864e5 - Date.now(); }

  // ---- stage math -------------------------------------------------------
  // Cumulative damage needed to COMPLETE stage n: 10M · 25M · 50M · 100M · 250M
  // · 500M · 1B … (×2.5, ×2, ×2 forever). No stage cap.
  const _th = [10e6];
  const CYCLE = [2.5, 2, 2];
  function threshold(n) {                                        // 1-based
    while (_th.length < n) _th.push(_th[_th.length - 1] * CYCLE[(_th.length - 1) % 3]);
    return _th[n - 1];
  }
  function stageInfo(total) {
    // GUARD — total must be finite. threshold() overflows to Infinity near stage
    // 906, and 'Infinity >= Infinity' is true, so an Infinity total makes this
    // loop spin forever while the memo array grows one entry per iteration: a
    // frozen tab that swells until the browser kills it. That is a login crash
    // when the panel renders a poisoned save total.
    if (!isFinite(total) || total < 0) total = 0;
    let s = 1; while (total >= threshold(s)) s++;
    const floor = s > 1 ? threshold(s - 1) : 0;
    return { stage: s, floor, need: threshold(s), into: total - floor, span: threshold(s) - floor };
  }
  // Boss hits a % of the player's MAX HP — it can never one-shot (hard cap 9%),
  // but everyone eventually falls. HP, regen and shields buy higher stages.
  function bossPct(stage) {
    let p;
    if (stage <= 10) p = 0.5 + (stage - 1) * (0.5 / 9);
    else if (stage <= 20) p = 1 + (stage - 10) * (1 / 10);
    else if (stage <= 50) p = 2 + (stage - 20) * (2 / 30);
    else p = 4 + (stage - 50) / 25;
    return Math.min(9, p);
  }
  function bossInterval(stage) { return Math.max(0.75, 1.5 - stage * 0.006); }
  function bossEra(stage) { return Math.floor((stage - 1) / 10); }           // visual evolution step
  function bossSprite() { return 'ships/ship-voidmaw.png'; }                 // the Voidmaw itself

  // ---- THE VOIDMAW — the event's grand-prize hull -------------------------
  const VM_KEY = 'voidmaw', VM_NEED = 150;   // Jul 2026: 100 → 150 — the Voidmaw is the apex hull now (Singularity proc), so the season grind matches
  function vmParts() { try { return (G().state.shipParts && G().state.shipParts[VM_KEY]) | 0; } catch (e) { return 0; } }
  // PERMANENT GRANT GUARD — the flag lives on the season record, not on hangar
  // ownership. Ascension keeps every hull now, but a sold or salvaged Voidmaw must
  // not be re-assembled for free either, so the record stays the gate.
  function vmGranted() { try { const s = sd(); return !!(s && s.vmGranted); } catch (e) { return false; } }
  function vmOwned() { try { return vmGranted() || !!G().state.ownedShips[VM_KEY]; } catch (e) { return false; } }
  function vmAssemble() {
    if (vmOwned() || vmParts() < VM_NEED) return;
    const g = G();
    g.state.shipParts[VM_KEY] -= VM_NEED;
    try { sd().vmGranted = true; } catch (e) {}
    if (!g.grantShip || !g.grantShip(VM_KEY)) { g.state.ownedShips[VM_KEY] = true; }
    sd().hist.unshift({ d: Date.now(), s: -1, txt: '❖ VOIDMAW ASSEMBLED — the apex hull is yours. Switch to it in the Hangar.' });
    try { g.save(); } catch (e) {}
    if (window.UI) window.UI.refreshAll();
    sheet(
      '<div class="sdm-kicker">VOIDMAW · GRAND PRIZE</div>' +
      '<div class="sdm-title">VOIDMAW ASSEMBLED</div>' +
      '<div class="sdm-art"><img src="ships/ship-voidmaw.png" alt=""></div>' +
      '<div class="sdm-cd">' + VM_NEED + ' parts forged into the apex hull.<br>Its cannons open <b>singularities</b> — switch to it in the <b>Hangar ▸ Ships</b>.</div>' +
      '<button class="sdm-ok" id="sdm-ok">Magnificent</button>'
    );
    _modal.querySelector('#sdm-ok').addEventListener('click', () => { closeModal(); render(); });
  }

  // ---- stage rewards ------------------------------------------------------
  const PART_BANDS = [
    { min: 1,  tier: 'Ship Part',           cls: 'c',  keys: ['cruiser', 'heavycruiser', 'destroyer', 'battleship'] },
    { min: 8,  tier: 'Rare Ship Part',      cls: 'r',  keys: ['dreadnought', 'carrier', 'aegis'] },
    { min: 16, tier: 'Epic Ship Part',      cls: 'e',  keys: ['supercarrier', 'titan', 'mothership'] },
    { min: 30, tier: 'Legendary Ship Part', cls: 'l',  keys: ['oblivionspear', 'oblivionspearalpha', 'oblivionfinal'] },
    { min: 50, tier: 'Titan Ship Part',     cls: 't',  keys: ['dread1', 'dread2', 'dread3', 'dread4', 'dread5', 'dread6'] },
  ];
  function partBand(stage) { let b = PART_BANDS[0]; PART_BANDS.forEach((x) => { if (stage >= x.min) b = x; }); return b; }
  function addPart(key, n) { const st = G().state; if (!st.shipParts) st.shipParts = {}; st.shipParts[key] = (st.shipParts[key] | 0) + n; }
  function goldFor(stage) { return 100e3 * Math.pow(1.32, stage - 1); }

  // roll + GRANT the reward for clearing `stage`. Returns display strings.
  function grantStageReward(stage) {
    const g = G(), st = g.state, s = sd(), out = [];
    const gold = Math.floor(goldFor(stage) * (1 + Math.random() * 2));       // 100k–1M at stage 1, 20M–50M+ by 20
    st.gold = (st.gold || 0) + gold; out.push({ t: '$' + fmt(gold) + ' Gold', c: '#e6b566' });
    const r = Math.random();
    if (r < 0.32) {                                                          // resources
      const kind = ['fuel', 'iron', 'plasma'][(Math.random() * 3) | 0];
      const amt = Math.floor((500 + stage * 420) * (1 + Math.random()));
      if (!st.resources) st.resources = {}; st.resources[kind] = (st.resources[kind] || 0) + amt;
      out.push({ t: '+' + fmt(amt) + ' ' + kind[0].toUpperCase() + kind.slice(1), c: '#5bc0ff' });
    } else if (r < 0.62) {                                                   // REAL ship parts (Shipworks inventory)
      const band = partBand(stage);
      const key = band.keys[(Math.random() * band.keys.length) | 0];
      const n = 1 + (Math.random() < 0.25 ? 1 : 0);
      addPart(key, n);
      out.push({ t: '⬡ ' + n + '× ' + band.tier + ' — ' + shipName(key), c: band.cls === 't' ? '#ff5a68' : band.cls === 'l' ? '#ffcf4d' : band.cls === 'e' ? '#c07bff' : '#7db8e8' });
    } else if (r < 0.80 && stage >= 20) {                                    // Dread Core (Pilot Tree)
      st.dreadCores = (st.dreadCores || 0) + 1;
      out.push({ t: '◇ 1 Dread Core', c: '#ff3a4a' });
    } else {                                                                 // bonus gold
      const bg = Math.floor(goldFor(stage) * 0.8);
      st.gold += bg; out.push({ t: '$' + fmt(bg) + ' Bonus Gold', c: '#e6b566' });
    }
    // VOIDMAW PART — the season's grand-prize hull, dripped from stage 5 up.
    // ≈0.025–0.09 per stage cleared (halved Jul 2026), plus daily leaderboard
    // tiers and the first-fight bonus.
    if (!vmOwned() && stage >= 5 && Math.random() < Math.min(0.09, 0.025 + stage * 0.002)) {
      addPart(VM_KEY, 1);
      out.push({ t: '❖ 1× VOIDMAW PART (' + vmParts() + '/' + VM_NEED + ')', c: '#d9a0ff', jackpot: true });
    }
    // aspirational: TITAN SINA part — exceptionally rare, very high stages only
    if (stage >= 40 && Math.random() < 0.005) {
      addPart('titansina', 1);
      out.push({ t: '★ TITAN SINA PART', c: '#ff5a68', jackpot: true });
    }
    s.hist.unshift({ d: Date.now(), s: stage, txt: out.map((o) => o.t).join(' · ') });
    if (s.hist.length > 40) s.hist.length = 40;
    try { g.save(); } catch (e) {}
    return out;
  }
  // preview line for a stage (ranges — for the rewards-preview panel)
  function previewFor(stage) {
    const lo = fmt(goldFor(stage)), hi = fmt(goldFor(stage) * 3);
    const band = partBand(stage);
    const bits = ['$' + lo + '–' + hi + ' Gold', band.tier + 's'];
    if (stage >= 5) bits.push('❖ Voidmaw Part chance');
    if (stage >= 20) bits.push('◇ Core chance');
    if (stage >= 40) bits.push('★ Titan Sina Part (very rare)');
    return bits;
  }

  // ---- DAILY LEADERBOARD (best single run) --------------------------------
  // NO BOT FIELD (build 710, by request). Both boards used to be padded with 99
  // generated names apiece — a deterministic fake field that ALSO decided the
  // pilot's rank whenever the live board was unavailable. It is gone: every row on
  // both boards is a real published operator, and a rank is only ever the one the
  // SERVER reports (liveDailyRank / liveSeasonRank, remembered in s.lbRank /
  // s.lbSeasonRank). When nothing has landed, the honest answer is "not placed" —
  // never an invented placing.
  //
  // Rewards no longer read a fabricated number either: with no known rank a
  // settlement pays the participation tier (the last LB_TIERS/SEASON_TIERS row)
  // and says so, rather than crediting a #1 nobody earned.
  function knownDailyRank(s) { return (s && s.lbRank && s.lbRank.day === s.day) ? (s.lbRank.rank | 0) : (liveDailyRank() || null); }
  function knownSeasonRank(s) { return (s && s.lbSeasonRank) ? (s.lbSeasonRank | 0) : (liveSeasonRank() || null); }
  // DAILY leaderboard prizes — ✦ EVENT COINS + ◈ LootCoins (spend in the Event Store)
  // LootCoin column halved in the Aug 2026 payout pass (build 614); Event Coins are
  // event-store currency, not LootCoins, and were deliberately left alone.
  const LB_TIERS = [
    { max: 1,   name: '#1',      coins: 2500, lc: 13 },
    { max: 10,  name: 'Top 10',  coins: 1500, lc: 8 },
    { max: 100, name: 'Top 100', coins: 1000, lc: 5 },
    { max: 1e9, name: 'Ranked',  coins: 500,  lc: 3 },
  ];
  function tierFor(rank) { for (const t of LB_TIERS) if (rank <= t.max) return t; return LB_TIERS[3]; }
  // SEASON final rewards — the big Event Coin payout (LootCoins halved, build 614)
  const SEASON_TIERS = [
    { max: 1,   name: '#1',      coins: 25000, lc: 125 },
    { max: 10,  name: 'Top 10',  coins: 10000, lc: 50 },
    { max: 100, name: 'Top 100', coins: 5000,  lc: 25 },
    { max: 1e9, name: 'Ranked',  coins: 2500,  lc: 13 },
  ];
  const tierTxt = (t) => '✦ ' + t.coins.toLocaleString() + ' Event Coins · ◈ ' + t.lc + ' LootCoins';
  // one-time end-of-season settlement — stages a CLAIM (collected by the player)
  function settleSeason(s) {
    if (!ended() || s.seasonDone || !s.total) return;
    s.seasonDone = 1;
    const rank = knownSeasonRank(s);
    const idx = rank ? SEASON_TIERS.findIndex((x) => rank <= x.max) : SEASON_TIERS.length - 1;
    if (!s.claims) s.claims = [];
    s.claims.push({ t: 's', rank: rank || 0, idx: idx < 0 ? 3 : idx, made: Date.now() });
    s.pendingToast = rank
      ? '🏆 ' + SEASON.boss + ' final standings — you placed #' + rank + '. Collect your rewards in the event.'
      : '🏆 ' + SEASON.boss + ' standings settled — your prize is waiting in the event.';
    try {
      const st2 = SEASON_TIERS[idx < 0 ? 3 : idx];
      if (window.MAIL) window.MAIL.push({ ic: '🏆', title: rank ? SEASON.boss + ' final standings — #' + rank : SEASON.boss + ' final standings',
        body: 'The <b>' + SEASON.label + '</b> standings are settled. '
          + (rank ? 'Your total damage placed you <b>#' + rank + '</b> (' + st2.name + ')' : 'Your final placing never reached this device, so you are paid as <b>' + st2.name + '</b>')
          + ' — your prize is waiting: <b>' + tierTxt(st2) + '</b>.',
        meta: { kind: 'prize', cta: { label: '🏆 Collect season prize', screen: 'sdread' } } });
    } catch (e) {}
    try { G().save(); } catch (e) {}
  }
  // called on day rollover, BEFORE resetting bestDay — stages yesterday's placement as a CLAIM
  function settleLeaderboard(s) {
    if (!s.bestDay || s.day >= dayIdx()) { return; }
    const rank = knownDailyRank(s), t = rank ? tierFor(rank) : LB_TIERS[LB_TIERS.length - 1];
    // WINNINGS GO TO MAIL (Jul 2026): the settlement letter carries the prize —
    // you claim it right in the inbox. Falls back to the in-event claim stage
    // only if the mail system is unavailable.
    let mailed = false;
    try {
      if (window.MAIL) {
        window.MAIL.push({ ic: '🏆', title: rank ? 'Daily event results — you ranked #' + rank : 'Daily event results — ' + t.name,
          body: 'Yesterday\u2019s <b>' + SEASON.label + '</b> daily board is settled: '
            + (rank ? 'your best run ranked <b>#' + rank + '</b> (' + t.name + ').' : 'your placing never reached this device, so you are paid as <b>' + t.name + '</b>.')
            + '<br>Your winnings — claim them right here: <b>' + tierTxt(t) + '</b>',
          meta: { kind: 'prize', prize: { t: 'd', rank: rank || 0, coins: t.coins, lc: t.lc } } });
        mailed = true;
      }
    } catch (e) {}
    if (!mailed) { if (!s.claims) s.claims = []; s.claims.push({ t: 'd', rank: rank || 0, name: t.name, coins: t.coins, lc: t.lc, made: Date.now() }); }
    s.pendingToast = rank
      ? '🏆 Server Dreadnaught — yesterday you placed #' + rank + '. Your winnings are waiting in your MAIL.'
      : '🏆 Server Dreadnaught — yesterday\u2019s board is settled. Your winnings are waiting in your MAIL.';
  }
  // collect EVERYTHING staged — the one button that pays out daily + season prizes
  function claimAll() {
    const s = sd(); if (!s || !s.claims || !s.claims.length) return;
    const g = G(), lines = [];
    s.claims.forEach((c) => {
      let txt;
      if (c.t === 'd' && c.coins != null) {
        s.coins = coinsOf(s) + c.coins;
        g.state.credits = (g.state.credits || 0) + (c.lc || 0);
        txt = '🏆 Daily ' + (c.rank ? 'rank #' + c.rank + ' (' + c.name + ')' : c.name) + ' — ✦ ' + c.coins.toLocaleString() + ' Event Coins · ◈ ' + (c.lc || 0) + ' LootCoins';
      } else if (c.t === 'd') {
        // legacy claim shape (pre–Event Coin): gold / cores / parts
        g.state.gold = (g.state.gold || 0) + (c.gold || 0);
        if (c.cores) g.state.dreadCores = (g.state.dreadCores || 0) + c.cores;
        let ptxt = '';
        if (c.parts && !vmOwned()) { addPart(VM_KEY, c.parts); ptxt = '❖ ' + c.parts + ' Voidmaw Parts · '; }
        const vpd = c.rank === 1 ? 100 : c.rank === 2 ? 50 : c.rank === 3 ? 25 : 10;
        try { if (window.VIP) window.VIP.grant(vpd, c.rank ? 'Daily rank #' + c.rank : 'Daily placement'); } catch (e) {}
        txt = '🏆 Daily ' + (c.rank ? 'rank #' + c.rank : 'placement') + ' (' + c.name + ') — ⚜' + vpd + ' · ' + ptxt + '$' + fmt(c.gold || 0) + (c.cores ? ' · ◇' + c.cores : '');
      } else {
        const t = SEASON_TIERS[c.idx] || SEASON_TIERS[3];
        s.coins = coinsOf(s) + t.coins;
        g.state.credits = (g.state.credits || 0) + t.lc;
        const vps = c.rank === 1 ? 500 : c.rank === 2 ? 250 : c.rank === 3 ? 125 : 50;
        try { if (window.VIP) window.VIP.grant(vps, c.rank ? SEASON.boss + ' rank #' + c.rank : SEASON.boss + ' placement'); } catch (e) {}
        txt = '🏆 ' + SEASON.boss + ' FINAL — ' + (c.rank ? 'rank #' + c.rank + ' (' + t.name + ')' : t.name) + ': ⚜' + vps + ' · ' + tierTxt(t);
      }
      s.hist.unshift({ d: Date.now(), s: 0, txt }); lines.push(txt);
    });
    s.claims = [];
    if (s.hist.length > 40) s.hist.length = 40;
    try { g.save(); } catch (e) {}
    if (window.UI) window.UI.refreshAll();
    sheet(
      '<div class="sdm-kicker">SERVER DREADNAUGHT</div>' +
      '<div class="sdm-title small">🎁 REWARDS COLLECTED</div>' +
      '<div class="sdh-list">' + lines.map((l) => '<div class="sdh-row"><span class="sdh-txt">' + l + '</span></div>').join('') + '</div>' +
      '<button class="sdm-ok" id="sdm-ok">Excellent</button>'
    );
    _modal.querySelector('#sdm-ok').addEventListener('click', () => { closeModal(); render(); });
    updateHud();
  }

  // =========================================================================
  // ✦ EVENT STORE — spend Event Coins on high-end ship shards
  // =========================================================================
  const COIN = '✦';
  function storeItems() {
    return [
      { id: 'vmpart', ic: '❖', name: 'Voidmaw Shard',       sub: 'grand prize · ' + VM_NEED + ' assemble the ship', cost: 1500, key: VM_KEY,        hide: () => vmOwned() },
      { id: 'sina',   ic: '★', name: 'Titan Sina Shard',    sub: 'the apex hull · rainbow tracers',               cost: 2500, key: 'titansina' },
      { id: 'dread',  ic: '◈', name: 'Dread-class Shard',   sub: 'random recovered Dreadnaught hull',              cost: 2000, key: () => 'dread' + (1 + (Math.random() * 6 | 0)) },
      { id: 'obfin',  ic: '⬡', name: 'Oblivion Final Shard', sub: 'the final Oblivion hull',                       cost: 1800, key: 'oblivionfinal' },
      { id: 'obalpha',ic: '⬡', name: 'Oblivion Alpha Shard', sub: 'Oblivion Spear Alpha',                          cost: 1400, key: 'oblivionspearalpha' },
      { id: 'obspear',ic: '⬡', name: 'Oblivion Spear Shard', sub: 'the first Oblivion hull',                       cost: 1200, key: 'oblivionspear' },
      { id: 'mother', ic: '⬢', name: 'Mothership Shard',     sub: 'endgame faction carrier',                       cost: 800,  key: 'mothership' },
      { id: 'vip25',  ic: '⚜', name: '25 VIP Points',        sub: 'account prestige — permanent',                  cost: 1500, vip: 25 },
      { id: 'titan',  ic: '⬢', name: 'Titan Carrier Shard',  sub: 'flagship drone carrier',                        cost: 600,  key: 'titan' },
    ];
  }
  function buyStoreItem(id) {
    const s = sd(); if (!s) return;
    const it = storeItems().find((x) => x.id === id); if (!it) return;
    if (coinsOf(s) < it.cost) { toast('Need ' + COIN + ' ' + (it.cost - coinsOf(s)).toLocaleString() + ' more Event Coins'); return; }
    s.coins = coinsOf(s) - it.cost;
    let got;
    if (it.vip) {
      try { if (window.VIP) window.VIP.grant(it.vip, 'Event Store exchange'); } catch (e) {}
      got = '⚜ ' + it.vip + ' VIP points';
    } else {
      const key = typeof it.key === 'function' ? it.key() : it.key;
      addPart(key, 1);
      got = '1× ' + shipName(key) + ' shard';
    }
    s.hist.unshift({ d: Date.now(), s: -1, txt: '✦ Event Store — ' + it.name + ': ' + got + ' (' + COIN + ' ' + it.cost.toLocaleString() + ')' });
    if (s.hist.length > 40) s.hist.length = 40;
    try { G().save(); } catch (e) {}
    if (window.UI) window.UI.refreshAll();
    toast(COIN + ' ' + got);
    openStore();
  }
  function openStore() {
    const s = sd();
    const items = storeItems().filter((it) => !(it.hide && it.hide()));
    sheet(
      '<div class="sdm-kicker">' + SEASON.boss + ' · EVENT STORE</div>' +
      '<div class="sdm-title small">' + COIN + ' EVENT STORE</div>' +
      '<div class="sdm-cd">Balance <b>' + COIN + ' ' + coinsOf(s).toLocaleString() + '</b> Event Coins · earned from daily + season ranks</div>' +
      '<div class="sds-list">' + items.map((it) =>
        '<div class="sds-row' + (coinsOf(s) >= it.cost ? '' : ' cant') + '"><span class="sds-ic">' + it.ic + '</span>' +
        '<div class="sds-t"><b>' + it.name + '</b><span>' + it.sub + '</span></div>' +
        '<button class="sds-buy" data-buy="' + it.id + '"' + (coinsOf(s) >= it.cost ? '' : ' disabled') + '>' + COIN + ' ' + it.cost.toLocaleString() + '</button></div>').join('') +
      '</div>' +
      '<div class="sdm-locknote soft">Shards land in your <b>ship parts</b> inventory — what Shipworks assembles hulls from.</div>' +
      '<button class="sdm-ok" id="sdm-ok">Close</button>'
    );
    _modal.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => buyStoreItem(b.dataset.buy)));
    _modal.querySelector('#sdm-ok').addEventListener('click', () => { closeModal(); render(); });
  }

  // =========================================================================
  // BATTLE SIM — 2:30 auto-combat vs the season boss, on real player stats
  // =========================================================================
  let run = null;
  const ERA_TINTS = ['#b04dff', '#ff4adf', '#6a5bff', '#ff5a68', '#4dd8c8', '#ffd24d'];
  let _vmImg = null;
  function bossImg() {   // the boss is ALWAYS the Voidmaw — eras only shift tint/glow
    if (!_vmImg) { _vmImg = new Image(); _vmImg.src = 'ships/ship-voidmaw.png'; }
    return _vmImg;
  }
  function eraTint(stage) { return ERA_TINTS[bossEra(stage) % ERA_TINTS.length]; }
  // (re)apply the boss's stage-scaled stats — called at deploy and on every
  // stage-up mid-fight, so the Voidmaw visibly evolves and hits harder.
  function applyBossStage(b, stage) {
    let mhp = 500; try { mhp = G().getStats().maxHp || 500; } catch (e) {}
    b.damage = Math.max(1, mhp * bossPct(stage) / 100);      // % of the PLAYER's max HP per hit
    b.fireCd = bossInterval(stage);
    b.size = Math.min(190, 132 + bossEra(stage) * 7);
    b.tint = eraTint(stage);
    b.spriteImg = bossImg(stage);
    b.name = 'VOIDMAW · STAGE ' + stage;
  }
  // ---- purchasable extra attempts — ◈ LootCoins, 3× exponential, daily reset
  function attCost() { const s = sd(); return 100 * Math.pow(3, (s && s.buys) | 0); }
  function buyAttempt() {
    const s = sd(); if (!s) return;
    if (ended()) { return; }
    if (lvl() < UNLOCK) { toast('Server Dreadnaught unlocks at Level ' + UNLOCK); return; }
    const cost = attCost(), g = G();
    if ((g.state.credits || 0) < cost) { toast('Need ◈ ' + fmt(cost) + ' LootCoins for an extra attempt'); return; }
    g.state.credits -= cost;
    s.buys = (s.buys | 0) + 1;
    s.hist.unshift({ d: Date.now(), s: -1, txt: '⚡ Bought +1 attempt for ◈ ' + fmt(cost) + ' — next costs ◈ ' + fmt(attCost()) });
    try { g.save(); } catch (e) {}
    if (window.UI) window.UI.refreshAll();
    toast('⚡ +1 Voidmaw attempt · next costs ◈ ' + fmt(attCost()));
    render(); updateHud();
  }

  function startRun() {
    const s = sd(); if (!s) return;
    if (ended()) { return; }
    if (lvl() < UNLOCK) { toast('Server Dreadnaught unlocks at Level ' + UNLOCK); return; }
    if (attemptsLeft() <= 0) { toast('No attempts left — resets in ' + fmtDur(msToDailyReset())); return; }
    if (run) return;
    let prevSpeed = 1;
    try { prevSpeed = G().state.gameSpeed || 1; G().setGameSpeed(1); } catch (e) {}   // world boss always engages at 1× — restored at run end
    let prevAuto = false;
    try { prevAuto = !!G().getAuto(); G().setAuto(false); } catch (e) {}   // MANUAL FLIGHT ONLY
    let b = null;
    try { b = G().startServerDread(); } catch (e) {}
    if (!b) { toast('Deploy failed — try again'); return; }
    s.att = (s.att | 0) + 1; s.runs = (s.runs | 0) + 1;
    try { G().save(); } catch (e) {}
    applyBossStage(b, 1);                       // every attempt starts back at STAGE 1
    run = { left: RUN_SECS, dealt: 0, drops: [], boss: b, lastHp: b.hp, uiT: 0, zones: [], zoneT: 7, zoneWarned: false, prevAuto, prevSpeed };
    const app = $('app'); if (app) app.classList.add('sd-noauto');
    const nav = document.querySelector('.nav-btn[data-screen="battle"]'); if (nav) nav.click();
    ensureWarbar();
    bbanner('VOIDMAW ENGAGED', 'MANUAL FLIGHT — auto-pilot disabled · survive 2:30 · every stage pays out instantly');
    updateHud();
  }
  // driven by the engine's update() every frame while rt.sdrun is active
  function engineTick(dt, rt) {
    if (!run) { rt.sdrun = null; return; }
    const s = sd(), b = run.boss;
    if (!b) return endRun('time');
    // STAGES ARE PER-RUN: every attempt starts at stage 1 and climbs on THIS
    // run's damage alone. Season total still accumulates for the season board.
    const before = stageInfo(run.dealt).stage;
    // damage dealt = boss HP delta (the engine resolved the real hits)
    const delta = Math.max(0, run.lastHp - b.hp);
    if (delta > 0) { run.dealt += delta; s.total += delta; }
    if (b.hp < b.maxHp * 0.5) b.hp = b.maxHp * 0.96;         // unlimited HP — it never dies
    if (b.hp <= 0 || b.dying) { b.hp = b.maxHp * 0.96; b.dying = false; }
    run.lastHp = b.hp;
    // stage crossings → instant loot; the boss evolves & hits harder
    const info = stageInfo(run.dealt);
    if (info.stage > before) {
      let last = null;
      for (let st = before; st < info.stage; st++) { last = grantStageReward(st); run.drops.push({ stage: st, drops: last }); }
      applyBossStage(b, info.stage);
      if (info.stage > (s.bestStage | 0)) s.bestStage = info.stage;   // record the deepest push
      rt.shake = Math.min(6, (rt.shake || 0) + 3);
      bbanner('STAGE ' + (info.stage - 1) + ' CLEARED', last.map((x) => x.t).join(' · '), true);
    }
    run.left -= dt;
    // LIVE PUBLISH — push my in-progress score every 15s so other players'
    // open leaderboards see this run climbing in near-real-time.
    run.pubT = (run.pubT || 0) + dt;
    if (run.pubT >= 15 && cloudOn()) {
      run.pubT = 0;
      try { window.CLOUD.sdUpsert({ name: myName(), season: SEASON.num, day: s.day, best: Math.max(+s.bestDay || 0, Math.floor(run.dealt)), total: Math.floor(s.total), stage: Math.max(s.bestStage | 0, stageInfo(run.dealt).stage) }); } catch (e) {}
    }
    // MANUAL FLIGHT ONLY — the event disables auto-pilot for its whole duration
    try { if (G().getAuto()) G().setAuto(false); } catch (e) {}
    // EXTENDED ENGAGEMENT RANGE — 3× weapon range vs the world boss so the fight
    // is about dodging zones, not hugging the hull. Re-applied after any stat
    // refresh (the marker dies with the rebuilt stats object); reset at run end.
    if (rt.stats && !rt.stats._sdRange) { rt.stats.fireRange = (rt.stats.fireRange || 250) * 3; rt.stats._sdRange = 1; }
    // VOID COLLAPSE ZONES — red telegraphs blink faster and faster, then drop a
    // BLACK HOLE that lasts 5s and burns 25% of max hull PER SECOND inside.
    const a = rt.archer;
    run.zoneT -= dt;
    if (run.zoneT <= 0 && a && !a.dead) {
      const n = 1 + (info.stage >= 20 ? 1 : 0) + (info.stage >= 45 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2, off = i === 0 ? 0 : 110 + Math.random() * 150;
        run.zones.push({ x: a.x + Math.cos(ang) * off, y: a.y + Math.sin(ang) * off, r: 150 + Math.min(70, info.stage), t: 6.0, total: 6.0, phase: 0, hole: 0 });
      }
      run.zoneT = Math.max(6, 11 - info.stage * 0.05);
      if (!run.zoneWarned) { run.zoneWarned = true; bbanner('⚠ VOID COLLAPSE', 'Fly OUT of the red blinking area — it becomes a black hole: 75% hull per second inside'); }
    }
    for (const z of run.zones) {
      if (z.hole > 0) {
        // BLACK HOLE phase — sustained burn while inside (bypasses the 22% hit cap)
        z.hole -= dt;
        z.phase += dt * 3;
        if (a && !a.dead && (a.invuln || 0) <= 0 && Math.hypot(a.x - z.x, a.y - z.y) <= z.r) {
          const burn = (rt.stats.maxHp || 100) * 0.75 * dt;   // 75% of max hull per second
          a.hp -= burn; a.hurtFlash = 1;
          if (!z.warned) { z.warned = true; rt.shake = Math.min(6, (rt.shake || 0) + 2); }
          if (a.hp <= 0) { a.hp = 0; a.dead = true; a.justDied = true; a.killer = run.boss || null; }
        }
        continue;
      }
      const frac = Math.max(0, z.t / z.total);
      z.phase += dt * (2 + (1 - frac) * 12);           // blink accelerates toward collapse
      z.t -= dt;
      if (z.t <= 0) {
        z.hole = 5.0;                                   // collapse → 5s black hole
        rt.shake = Math.min(7, (rt.shake || 0) + 3);
      }
    }
    run.zones = run.zones.filter((z) => z.t > 0 || z.hole > 0);
    run.uiT -= dt;
    if (run.uiT <= 0) { run.uiT = 0.2; syncWarbar(info); }
    if (run.left <= 0) endRun('time');
  }
  // engine draw hook — void aura + orbiting weak points over the arena canvas
  function engineRender(ctx, t, rt) {
    const b = rt.boss; if (!b || !b.isServerDread || !run) return;
    // This hook fires AFTER the world camera transform is restored, so re-apply
    // it — otherwise zones DRAW in screen space while hits test in world space
    // (the "died outside the circle" bug).
    ctx.save();
    ctx.scale(rt.zoom || 1, rt.zoom || 1);
    ctx.translate(-rt.cam.x, -rt.cam.y);
    // danger zones — under everything else we draw
    (run.zones || []).forEach((z) => {
      ctx.save();
      if (z.hole > 0) {
        // BLACK HOLE — dark core, glowing accretion rim, rotating arcs
        const fade = Math.min(1, z.hole / 0.6);
        const g = ctx.createRadialGradient(z.x, z.y, 2, z.x, z.y, z.r);
        g.addColorStop(0, 'rgba(0,0,0,' + (0.96 * fade).toFixed(2) + ')');
        g.addColorStop(0.62, 'rgba(10,4,20,' + (0.85 * fade).toFixed(2) + ')');
        g.addColorStop(0.86, 'rgba(120,40,200,' + (0.35 * fade).toFixed(2) + ')');
        g.addColorStop(1, 'rgba(176,77,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, 7); ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(216,160,255,' + (0.8 * fade).toFixed(2) + ')';
        ctx.shadowColor = '#b04dff'; ctx.shadowBlur = 18;
        for (let i = 0; i < 3; i++) {
          const a0 = z.phase * 2 + i * 2.1;
          ctx.beginPath(); ctx.arc(z.x, z.y, z.r * (0.55 + i * 0.16), a0, a0 + 1.5); ctx.stroke();
        }
        ctx.restore(); return;
      }
      const frac = Math.max(0, z.t / z.total);
      const blink = 0.5 + 0.5 * Math.sin(z.phase * Math.PI * 2);
      ctx.fillStyle = 'rgba(255,42,58,' + (0.08 + 0.24 * blink * (1.3 - frac * 0.6)).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, 7); ctx.fill();
      ctx.lineWidth = 2 + 2.5 * blink;
      ctx.strokeStyle = 'rgba(255,90,104,' + (0.45 + 0.55 * blink).toFixed(2) + ')';
      ctx.setLineDash([12, 9]); ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,225,225,' + (0.55 + 0.45 * blink).toFixed(2) + ')';
      ctx.font = '800 ' + Math.round(z.r * 0.3) + 'px Orbitron, Rajdhani, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('⚠', z.x, z.y);
      ctx.restore();
    });
    const s = sd(), stage = run ? stageInfo(run.dealt).stage : Math.max(1, s.bestStage | 0);
    const tint = eraTint(stage);
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const R = b.size * (2.0 + Math.min(1, stage / 60));
    const g = ctx.createRadialGradient(b.x, b.y, b.size * 0.55, b.x, b.y, R);
    g.addColorStop(0, 'rgba(176,77,255,0)');
    g.addColorStop(0.7, 'rgba(176,77,255,' + (0.05 + 0.09 * pulse).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(176,77,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, R, 0, 7); ctx.fill();
    // glowing weak points — more appear as stages climb
    const n = Math.min(4, 1 + Math.floor(stage / 15));
    for (let i = 0; i < n; i++) {
      const a = t * 0.7 + (i / n) * Math.PI * 2;
      const wx = b.x + Math.cos(a) * b.size * 0.52, wy = b.y + Math.sin(a) * b.size * 0.38;
      const wr = 4.5 + 2 * Math.sin(t * 4 + i);
      ctx.fillStyle = 'rgba(255,74,223,' + (0.55 + 0.35 * pulse).toFixed(2) + ')';
      ctx.shadowColor = tint; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(wx, wy, Math.max(2.5, wr), 0, 7); ctx.fill();
    }
    ctx.restore();
    ctx.restore();   // pop the re-applied camera transform (matches the outer save)
  }
  // engine death path (no penalty) — the engine already towed us home
  function onDeath() { endRun('destroyed', true); }
  function endRun(reason, engineHandled) {
    if (!run) return;
    const s = sd(), dealt = Math.floor(run.dealt);
    const drops = run.drops, b = run.boss, prevAuto = run.prevAuto, prevSpeed = run.prevSpeed;
    run = null;
    const app = $('app'); if (app) app.classList.remove('sd-noauto');
    try { G().setAuto(true); } catch (e) {}   // events end INTO autopilot — the standing default
    try { if (prevSpeed && prevSpeed !== 1) G().setGameSpeed(prevSpeed); } catch (e) {}   // restore battle speed (the 1× was event-only)
    try { G().refreshStats(); } catch (e) {}         // drop the 3× event fire range
    try { if (window.UI) window.UI.refreshAll(); } catch (e) {}   // speed pills reflect the restore
    if (!engineHandled) {
      try {
        const rt = G().rt;
        rt.sdrun = null;
        if (b) { rt.enemies = rt.enemies.filter((e) => e !== b); if (rt.boss === b) { rt.boss = null; rt.bossAlive = false; rt.superBossAlive = false; } }
      } catch (e) {}
      try { G().selectDungeon(0); } catch (e) {}
    }
    removeWarbar();
    // FIRST FIGHT OF THE DAY — guaranteed Voidmaw Part (the daily pacing pillar:
    // ~2 from rank + 1 here + drops + store ≈ six weeks of consistent play)
    if (!vmOwned() && s.partDay !== dayIdx()) {
      s.partDay = dayIdx();
      addPart(VM_KEY, 1);
      drops.push({ stage: 0, drops: [{ t: '❖ 1× VOIDMAW PART — first fight of the day (' + vmParts() + '/' + VM_NEED + ')', c: '#d9a0ff' }] });
      s.hist.unshift({ d: Date.now(), s: -1, txt: '❖ Daily first-fight bonus — 1× Voidmaw Part (' + vmParts() + '/' + VM_NEED + ')' });
    }
    // PITY FLOOR (Jul 2026): there is NO cap on parts/cores per day — but RNG
    // could zero a whole run. Any attempt clearing 2+ stages now banks at least
    // 1 ❖ part (and 1 ◇ core past stage 20) if the rolls paid nothing.
    {
      const clearedN = drops.filter((d) => d.stage > 0).length;
      const maxStage = drops.reduce((a, d) => Math.max(a, d.stage | 0), 0);
      const has = (needle) => drops.some((d) => (d.drops || []).some((x) => ((x.t || '') + '').indexOf(needle) >= 0));
      if (!vmOwned() && clearedN >= 2 && !has('VOIDMAW PART')) {
        addPart(VM_KEY, 1);
        drops.push({ stage: 0, drops: [{ t: '❖ 1× VOIDMAW PART — persistence bonus (' + vmParts() + '/' + VM_NEED + ')', c: '#d9a0ff' }] });
      }
      if (clearedN >= 2 && maxStage >= 20 && !has('Dread Core')) {
        const st2 = G().state; st2.dreadCores = (st2.dreadCores || 0) + 1;
        drops.push({ stage: 0, drops: [{ t: '◇ 1 Dread Core — persistence bonus', c: '#ff3a4a' }] });
      }
    }
    const wasBestDay = dealt > (s.bestDay || 0), wasBestEver = dealt > (s.bestEver || 0);
    if (wasBestDay) s.bestDay = dealt;
    if (wasBestEver) s.bestEver = dealt;
    try { G().save(); } catch (e) {}
    publishScore();                                  // push to the LIVE server board
    const summary = { dealt, stages: drops.length, drops, reason, wasBestDay, wasBestEver };
    setTimeout(() => {
      const nav = document.querySelector('.nav-btn[data-screen="sdread"]'); if (nav) nav.click(); else render();
      openSummary(summary);
      updateHud();
    }, 60);
  }

  // ---- in-battle HUD strip (lives in the arena's #top-stack) --------------
  function ensureWarbar() {
    removeWarbar();
    const host = $('top-stack'); if (!host) return;
    const w = document.createElement('div'); w.id = 'sd-warbar';
    w.innerHTML = '<span class="swb-tag">❖</span>' +
      '<span class="swb-timer" id="swb-timer">2:30</span>' +
      '<span class="swb-dmg">RUN <b id="swb-dmg">0</b></span>' +
      '<span class="swb-stage" id="swb-stage">STAGE 1</span>' +
      '<div class="swb-bar"><i id="swb-fill" style="width:0%"></i></div>';
    host.appendChild(w);
  }
  function removeWarbar() { const w = $('sd-warbar'); if (w) w.remove(); }
  function syncWarbar(info) {
    if (!run) return;
    const t = Math.max(0, run.left);
    const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
    set('swb-timer', Math.floor(t / 60) + ':' + ('0' + Math.floor(t % 60)).slice(-2));
    set('swb-dmg', fmt(run.dealt));
    set('swb-stage', 'STAGE ' + info.stage);
    const f = $('swb-fill'); if (f) f.style.width = clamp(info.into / info.span * 100, 0, 100) + '%';
  }

  // ---- big in-world banner (stage clears, engage callout) -----------------
  let _bb, _bbT;
  function bbanner(title, sub, gold) {
    if (!_bb) {
      _bb = document.createElement('div'); _bb.id = 'sd-bbanner';
      _bb.innerHTML = '<div class="sbb-t"></div><div class="sbb-s"></div>';
      ($('app') || document.body).appendChild(_bb);
    }
    _bb.querySelector('.sbb-t').textContent = title;
    _bb.querySelector('.sbb-t').classList.toggle('gold', !!gold);
    _bb.querySelector('.sbb-s').textContent = sub || '';
    _bb.classList.remove('show'); void _bb.offsetWidth; _bb.classList.add('show');
    clearTimeout(_bbT); _bbT = setTimeout(() => _bb.classList.remove('show'), 2600);
  }

  // ---- idle-screen boss preview ----
  function syncBossArt(stage) {
    const img = $('sd-boss-img'); if (!img) return;
    const era = bossEra(stage);
    img.src = bossSprite(stage);
    img.style.filter = 'hue-rotate(' + ((era * 28) % 360) + 'deg) saturate(' + (1 + Math.min(1, era * 0.12)) + ') drop-shadow(0 0 ' + Math.min(38, 14 + stage * 0.4) + 'px ' + ACCENT + ')';
    const badge = $('sd-stage-badge'); if (badge) badge.textContent = 'STAGE ' + stage;
    const wrap = $('sd-bosswrap'); if (wrap) wrap.dataset.era = era;
    const wp = $('sd-weakpoints'); if (wp) {
      const n = Math.min(4, 1 + Math.floor(stage / 15));
      wp.innerHTML = ''; for (let i = 0; i < n; i++) { const w = document.createElement('i'); w.style.left = (24 + (i * 53) % 56) + '%'; w.style.top = (30 + (i * 31) % 40) + '%'; w.style.animationDelay = (i * 0.4) + 's'; wp.appendChild(w); }
    }
  }

  // =========================================================================
  // SCREEN RENDER
  // =========================================================================
  function render() {
    const body = $('sdread-body'); if (!body) return;
    const sub = $('sdread-sub');
    if (sub) sub.textContent = lvl() >= UNLOCK ? '' : ('Unlocks at Lv ' + UNLOCK);
    if (lvl() < UNLOCK) { body.innerHTML = lockedView(); wireLocked(body); return; }
    const s = sd();
    flushPublish();                  // a run the server never confirmed gets another try
    if (s && s.pendingToast) { toast(s.pendingToast); delete s.pendingToast; }
    if (s && !s.seen) { s.seen = 1; try { G().save(); } catch (e) {} setTimeout(() => openHowTo(true), 350); }
    body.innerHTML = run ? runView() : idleView();
    wire(body);
    syncBossArt(run ? stageInfo(run.dealt).stage : Math.max(1, s.bestStage | 0));
  }

  function seasonBar() {
    return '<div class="sd-season"><span class="sd-season-tag">WORLD BOSS</span>' +
      '<span class="sd-season-boss">' + SEASON.boss + '</span>' +
      '<span class="sd-season-cd">Daily board resets in <b data-sdreset>' + fmtDur(msToDailyReset()) + '</b></span></div>';
  }
  function arenaBlock(idle) {
    const s = sd();
    const stage = run ? stageInfo(run.dealt).stage : Math.max(1, s.bestStage | 0);
    const rinfo = run ? stageInfo(run.dealt) : null;
    return '<div class="sd-arena' + (idle ? ' idle' : '') + '">' +
      '<div class="sd-arena-sky"></div>' +
      '<div class="sd-stage-badge" id="sd-stage-badge">' + (run ? 'STAGE ' + stage : (s.bestStage ? 'BEST STAGE ' + s.bestStage : 'STAGE 1')) + '</div>' +
      '<div class="sd-bosswrap" id="sd-bosswrap"><div class="sd-aura"></div><img class="sd-boss-img" id="sd-boss-img" src="' + bossSprite(stage) + '" alt="Voidmaw">' +
        '<div class="sd-weakpoints" id="sd-weakpoints"></div></div>' +
      (idle && !run
        ? '<div class="sd-arena-foot"><span>EVERY RUN STARTS AT STAGE 1 · ' + fmt(threshold(1)) + ' TO CLEAR</span><span class="sub">' + (s.bestStage ? 'best: stage ' + s.bestStage : 'no record yet') + '</span></div>'
        : (rinfo ? '<div class="sd-arena-foot"><span>NEXT STAGE · ' + fmt(rinfo.need) + '</span><div class="sd-prog"><i style="width:' + clamp(rinfo.into / rinfo.span * 100, 0, 100) + '%"></i></div><span class="sub">' + fmt(Math.max(0, rinfo.need - run.dealt)) + ' to go</span></div>' : '')) +
      '</div>';
  }

  function idleView() {
    const s = sd(), info = stageInfo(s.total);
    const att = attemptsLeft(), max = attemptsMax();
    let pips = ''; for (let i = 0; i < max; i++) pips += '<i class="' + (i < att ? 'on' : '') + '"></i>';
    const over = ended();
    const fightBtn = over
      ? '<button class="sd-fight" disabled>SEASON ENDED</button>'
      : att > 0
        ? '<button class="sd-fight has-ship" id="sd-fight"><img class="sd-fight-ship" src="ships/ship-voidmaw.png" alt=""><span class="sd-fight-txt"><b>⚔ FIGHT VOIDMAW</b><span>2:30 auto-run</span></span></button>'
        : '<button class="sd-fight" disabled>NO ATTEMPTS LEFT <span>resets in <b data-sdreset>' + fmtDur(msToDailyReset()) + '</b></span></button>';
    const claims = (s.claims && s.claims.length)
      ? '<button class="sd-claims" id="sd-claims">🎁 COLLECT REWARDS<span>' + s.claims.length + ' prize' + (s.claims.length > 1 ? 's' : '') + ' waiting — daily rank' + (s.claims.some((c) => c.t === 's') ? ' + season finals' : '') + '</span></button>'
      : '';
    return seasonBar() + arenaBlock(true) +
      claims +
      fightBtn +
      '<div class="sd-attrow"><span class="sd-att-l">Attempts</span><span class="sd-pips">' + pips + '</span>' +
        (isPro() ? '<b class="pro">PRO +1</b>' : '') +
        (over ? '' : '<button class="sd-buyatt" id="sd-buyatt" title="Price triples with each purchase · resets daily">⚡ +1 attempt · <b>◈ ' + fmt(attCost()) + '</b></button>') +
      '</div>' +
      '<div class="sd-stats three">' +
        statCard('Season Damage', fmt(s.total), 'all runs added up') +
        statCard('Best Run Today', s.bestDay ? fmt(s.bestDay) : '—', 'sets your daily rank') +
        statCard('Best Run Ever', s.bestEver ? fmt(s.bestEver) : '—', 'your record') +
      '</div>' +
      vmStrip() +
      '<div class="sd-btnrow">' +
        '<button class="sd-btn" id="sd-lb">🏆 Leaderboards</button>' +
        '<button class="sd-btn" id="sd-store">✦ Event Store <b>' + coinsOf(s).toLocaleString() + '</b></button>' +
        '<button class="sd-btn" id="sd-hist">📜 History</button>' +
        '<button class="sd-btn ghost" id="sd-how">❔ How it works</button>' +
      '</div>' +
      coaching();
  }
  function statCard(l, v, sub) { return '<div class="sd-stat"><div class="sd-stat-l">' + l + '</div><div class="sd-stat-v">' + v + '</div><div class="sd-stat-s">' + sub + '</div></div>'; }
  // grand-prize progress strip on the event screen
  function vmStrip() {
    const parts = vmParts(), owned = vmOwned();
    return '<div class="sd-vm" id="sd-vmstrip">' +
      '<img src="ships/ship-voidmaw.png" alt="">' +
      '<div class="sd-vm-t"><b>GRAND PRIZE — THE VOIDMAW</b>' +
        '<span>Collect <b>' + VM_NEED + ' parts</b> to fly the boss yourself. Its cannons stun and open black holes.</span>' +
        '<em>Parts drop from stage 5+, your first fight each day, and the ✦ Event Store.</em>' +
        (owned
          ? '<div class="vm-partbar done"><i style="width:100%"></i><span>✓ ASSEMBLED — in your Hangar</span></div>'
          : '<div class="vm-partbar"><i style="width:' + Math.min(100, parts / VM_NEED * 100) + '%"></i><span>❖ ' + parts + ' / ' + VM_NEED + ' parts</span></div>') +
      '</div></div>';
  }

  function runView() {
    const s = sd(), info = stageInfo(s.total);
    return seasonBar() + arenaBlock(true) +
      '<div class="sd-runhud">' +
        '<div class="sd-runrow"><span class="sd-run-t">⚔</span><span class="sd-run-lbl">RUN IN PROGRESS — YOUR FLEET IS ENGAGING VOIDMAW</span></div>' +
        '<div class="sd-runrow small"><span>Season total <b>' + fmt(s.total) + '</b></span><span>Stage <b>' + info.stage + '</b></span></div>' +
        '<button class="sd-fight" id="sd-return">▶ RETURN TO BATTLE</button>' +
      '</div>';
  }

  // ---- locked (< Lv 50) — clear coaching on how to get there + what it is
  function lockedView() {
    const L = lvl();
    return seasonBar() +
      '<div class="sd-lock"><div class="sd-lock-ic">🔒</div>' +
      '<h3>Server Dreadnaught</h3>' +
      '<p><b>' + SEASON.label + '</b> — one world boss for the whole server. Everyone fights the same Voidmaw and pushes it through damage stages for loot. Collect enough parts and you fly the <b>Voidmaw itself</b> — a hull you can only get this season.</p>' +
      '<div class="sd-lock-lv">Minimum level to join: <b>' + UNLOCK + '</b> · you are Level <b>' + L + '</b></div>' +
      '<div class="sd-prog big"><i style="width:' + clamp(L / UNLOCK * 100, 0, 100) + '%"></i></div>' +
      '<div class="sd-lock-coach"><div class="sd-coach-h">💡 Get to Level 50 faster</div><ul>' +
        '<li>Grind the deepest <b>Zone</b> you can safely clear — XP scales with zone.</li>' +
        '<li>Keep <b>equipment</b> upgraded and auto-equip better drops.</li>' +
        '<li>Spend <b>Pilot Skill</b> points — XP Gain nodes compound.</li>' +
        '<li>Run your 10 daily <b>Missions</b> for a steady XP stream.</li>' +
      '</ul></div>' +
      '<button class="sd-btn ghost" id="sd-how" style="width:100%">❔ How the event works</button>' +
      '</div>';
  }
  function wireLocked(body) { const h = body.querySelector('#sd-how'); if (h) h.addEventListener('click', () => openHowTo(false)); }

  // ---- coaching (Lv 50+) ----
  let _coachOpen = false;
  function coaching() {
    return '<div class="sd-coach"><button class="sd-coach-h" id="sd-coach-t">💡 Commander Coaching <span>' + (_coachOpen ? '▾' : '▸') + '</span></button>' +
      (_coachOpen ? '<ul>' +
        '<li><b>Survive longer, climb higher.</b> Voidmaw hits a % of your max HP — Hull, Shield Regen and Life Steal extend runs more than raw damage alone.</li>' +
        '<li><b>Dodge the red zones — manually.</b> They collapse into black holes that burn <b>75% of your hull per second</b>. Auto-pilot is disabled in the event; the joystick is your life.</li>' +
        '<li><b>Every point of DPS counts.</b> Damage is cumulative for the whole season — upgrades today pay on every future run.</li>' +
        '<li><b>Never bank attempts.</b> They reset daily. Even a weak run clears stages and pays loot.</li>' +
        '<li><b>Leaderboard = best single run.</b> One great run beats three average ones.</li>' +
        '<li><b>Fight every day.</b> Your first fight of the day always drops a ❖ Voidmaw Part, and every daily rank pays ✦ Event Coins — the store converts them into more parts and shards.</li>' +
        '<li><b>Spend ✦ in the Event Store.</b> Voidmaw Parts, ★ Titan Sina shards (2,500 ✦) and other high-end ship shards — daily placements bankroll the grind.</li>' +
        '<li><b>Stage 40+.</b> A tiny chance at ★ Titan Sina parts begins. The grind is real — so is the ship.</li>' +
      '</ul>' : '') + '</div>';
  }

  // =========================================================================
  // SHEETS / MODALS
  // =========================================================================
  let _modal;
  function closeModal() { if (_modal) { _modal.remove(); _modal = null; } }
  function sheet(html, wide) {
    closeModal();
    _modal = document.createElement('div'); _modal.className = 'sd-modal';
    _modal.innerHTML = '<div class="sd-modal-back"></div><div class="sd-modal-card' + (wide ? ' wide' : '') + '">' + html + '</div>';
    ($('app') || document.body).appendChild(_modal);
    _modal.querySelector('.sd-modal-back').addEventListener('click', closeModal);
    return _modal;
  }

  // ---- HOW IT WORKS / intro popup (shown on first entry from Command) ----
  function openHowTo(first) {
    const locked = lvl() < UNLOCK;
    const m = sheet(
      '<div class="sdm-kicker">SERVER DREADNAUGHT · LIVE EVENT</div>' +
      '<div class="sdm-title">' + SEASON.label.toUpperCase() + '</div>' +
      '<div class="sdm-cd">One world boss for the whole server · daily board resets in <b>' + fmtDur(msToDailyReset()) + '</b></div>' +
      '<div class="sdm-art small"><img src="' + bossSprite(1) + '" alt=""></div>' +
      '<div class="sdm-intro">One server-wide boss with unlimited HP. Everyone falls eventually — better fleets fall later.</div>' +
      '<div class="sdm-rules">' +
        rule('❖', 'Grand prize: the VOIDMAW', 'Collect <b>' + VM_NEED + ' parts</b> to assemble the boss itself — about a month of daily play.') +
        rule('⚔', String(BASE_ATTEMPTS) + ' attempts a day', '2:30 auto-combat runs. Damage is <b>cumulative all season</b>, and every stage crossed drops loot.') +
        rule('🔴', 'Dodge the red zones', 'They collapse into a <b>black hole</b> for 5 seconds — <b>75% of your hull per second</b> inside. Fly out with the joystick.') +
        rule('🏆', 'Two boards, one store', 'Daily = best single run · Season = total damage. Both pay <b>✦ Event Coins</b> to spend in the store.') +
      '</div>' +
      (locked ? '<div class="sdm-locknote">🔒 Opens at <b>Level ' + UNLOCK + '</b> — you are Level ' + lvl() + '.</div>' : '') +
      '<button class="sdm-ok" id="sdm-ok">' + (locked ? 'Got it' : first ? '⚔ Enter the fight' : 'Close') + '</button>'
    );
    m.querySelector('#sdm-ok').addEventListener('click', closeModal);
  }
  function rule(ic, t, p) { return '<div class="sdm-rule"><span class="sdm-ric">' + ic + '</span><div><b>' + t + '</b><p>' + p + '</p></div></div>'; }

  // ---- run summary ----
  function openSummary(sum) {
    const s = sd();
    const rank = knownDailyRank(s);
    const seaRank = knownSeasonRank(s);
    const m = sheet(
      '<div class="sdm-kicker">' + (sum.reason === 'destroyed' ? 'FLEET DESTROYED' : sum.reason === 'abandoned' ? 'RUN ABANDONED' : 'TIME EXPIRED') + '</div>' +
      '<div class="sdm-title">' + fmt(sum.dealt) + ' DMG</div>' +
      (sum.wasBestEver ? '<div class="sdm-best">★ NEW ALL-TIME BEST</div>' : sum.wasBestDay ? '<div class="sdm-best">★ NEW DAILY BEST</div>' : '') +
      '<div class="sdm-sumrow"><span>Stages cleared this run</span><b>' + sum.stages + '</b></div>' +
      '<div class="sdm-sumrow"><span>Daily rank (best run)</span><b>' + (rank ? '#' + rank : '—') + '</b></div>' +
      '<div class="sdm-sumrow"><span>Season rank (total damage)</span><b>' + (seaRank ? '#' + seaRank : '—') + '</b></div>' +
      '<div class="sdm-sumrow"><span>Attempts left today</span><b>' + attemptsLeft() + '</b></div>' +
      (sum.drops.length
        ? '<div class="sdm-drops">' + sum.drops.map((d) => '<div class="sdm-drop"><span class="sdm-drop-st">' + (d.stage > 0 ? 'STAGE ' + d.stage : '❖ DAILY BONUS') + '</span>' + d.drops.map((x) => '<span style="color:' + x.c + '">' + x.t + '</span>').join('') + '</div>').join('') + '</div>'
        : '<div class="sdm-nodrop">No stages cleared — the next threshold is close. Upgrade and go again.</div>') +
      '<button class="sdm-ok" id="sdm-ok">Collect</button>'
    );
    m.querySelector('#sdm-ok').addEventListener('click', () => { closeModal(); render(); });
  }

  // =========================================================================
  // LIVE CLOUD BOARDS — real cross-account standings via supabase (sdread_scores)
  // =========================================================================
  let _cl = { t: 0, inflight: false, day: null, season: null, mine: null };
  function cloudOn() { return !!(window.CLOUD && window.CLOUD.enabled && window.CLOUD.sdDaily); }
  function myUid() { try { return (window.AUTH && AUTH.session && AUTH.session()) ? AUTH.session().id : null; } catch (e) { return null; } }
  function myName() { try { const s = window.AUTH && AUTH.session && AUTH.session(); return (s && (s.name || s.email)) || 'Operator'; } catch (e) { return 'Operator'; } }
  function cloudOthers(rows) { const id = myUid(); return (rows || []).filter((r) => !id || r.user_id !== id); }
  // MY OWN SERVER ROW IS A FLOOR FOR THE LOCAL RECORD (Aug 2026 — "I did my run,
  // relogged, and my Voidmaw score went back to an older one").
  //
  // The YOU row on both boards is drawn from LOCAL state — meDay = s.bestDay,
  // meSea = s.total — while every rival row comes from the server. So the instant
  // a finished run fails to reach localStorage, the player's own figure rolls back
  // to the last copy that did persist and every other row on the board stays
  // exactly where it was. That asymmetry is the whole reported picture.
  //
  // A run can fail to persist for reasons the event never sees: push() returns
  // before saveLocal() for a kicked tab or a tab that never claimed the session
  // lock, saveLocal() swallows a quota failure, and the cloud flush is debounced
  // 8 seconds — so a relog inside that window leaves neither copy holding the run.
  //
  // The server row is the better copy in every one of those cases and always was:
  // sdread_upsert is ratcheted (greatest() inside a season and day) and a live run
  // publishes every 15 seconds, so it holds figures this account really earned even
  // when the save that produced them is gone. Adopt it.
  //
  // STRICTLY A FLOOR. It only ever raises, so a fresh local run that has not
  // published yet is untouched, and the row can only ever contain values this same
  // account sent under its own uid.
  // ASKED FOR BY user_id, NOT SCANNED OUT OF THE BOARD. Both boards are
  // limit(100) and the season board spans the whole season, so a mid-table pilot
  // is simply not in _cl.season — and reading the floor out of that array would
  // have made this whole repair inert for everyone outside the top 100, which is
  // most of the players it exists for. _cl.mine is refreshed by ensureCloud().
  function reconcileFromServer() {
    if (!myUid()) return;
    const s = sd(); if (!s) return;
    const m = _cl.mine; if (!m) return;
    let hit = 0;
    // DAILY ONLY IF THE ROW'S OWN `day` IS TODAY. The row carries the day its
    // best_day belongs to, so it answers this directly — and at the UTC rollover
    // sd() has already zeroed bestDay, where adopting yesterday's figure would
    // re-place the pilot on a board he has not fought on yet.
    if ((m.day | 0) === (s.day | 0) && (+m.best_day || 0) > (+s.bestDay || 0)) { s.bestDay = +m.best_day; hit = 1; }
    if ((+m.total || 0) > (+s.total || 0)) { s.total = +m.total; hit = 1; }
    if ((m.stage | 0) > (s.bestStage | 0)) { s.bestStage = m.stage | 0; hit = 1; }
    if ((+s.bestDay || 0) > (+s.bestEver || 0)) { s.bestEver = +s.bestDay; hit = 1; }
    if (hit) { try { G().save(); } catch (e) {} }
  }
  function ensureCloud(cb, force) {
    if (!cloudOn()) return;
    const s = sd(); if (!s) return;
    // inflight guard with a 10s TIMEOUT — a hung fetch used to wedge the boards
    // in "syncing" forever (no retries). Stale inflight now unblocks itself.
    if (_cl.inflight && Date.now() - (_cl.inflightAt || 0) < 10000) return;
    if (!force && Date.now() - _cl.t < 8000) return;
    _cl.inflight = true; _cl.inflightAt = Date.now(); _cl.t = Date.now();
    Promise.all([window.CLOUD.sdDaily(SEASON.num, s.day, 100), window.CLOUD.sdSeason(SEASON.num, 100),
      window.CLOUD.sdMine ? window.CLOUD.sdMine(SEASON.num) : Promise.resolve(null)]).then(([d, se, mine]) => {
      _cl.inflight = false; _cl.ok = !!(d || se); _cl.tries = (_cl.tries | 0) + 1;
      if (!_cl.ok) console.warn('[voidmaw] board read returned nothing — pass ' + _cl.tries);
      if (d) { _cl.day = d; _cl.dayIdx = s.day; }
      if (se) _cl.season = se;
      if (mine) _cl.mine = mine;
      // BEFORE syncRanks — the settlements read s.bestDay, so the record has to be
      // whole before a rank is computed off it.
      try { reconcileFromServer(); } catch (e) {}
      syncRanks();
      if (cb) cb();
    }).catch((e) => {
      // A FAILED PASS IS A STATE, NOT A NO-OP. This used to only release the
      // inflight latch, so a board that could never load stayed on "Connecting…"
      // for the whole session with nothing on screen or in the console to say so.
      _cl.inflight = false; _cl.ok = false; _cl.tries = (_cl.tries | 0) + 1;
      console.warn('[voidmaw] board read failed', e);
    });
  }
  function liveDailyRank() {
    const s = sd(); if (!s || !s.bestDay || !_cl.day) return null;
    // A RANK NEEDS A KNOWN IDENTITY. cloudOthers() cannot exclude my own row when
    // myUid() is null (AUTH not ready yet), so it keeps everything — and my own
    // published row then counts as a rival ahead of me. That is the reported
    // "#2 when I'm the only one on the board": one row, mine, counted twice.
    if (!myUid()) return null;
    return 1 + cloudOthers(_cl.day).filter((r) => (r.best_day || 0) > s.bestDay).length;
  }
  function liveSeasonRank() {
    const s = sd(); if (!s || !s.total || !_cl.season) return null;
    if (!myUid()) return null;
    return 1 + cloudOthers(_cl.season).filter((r) => (r.total || 0) > Math.floor(s.total)).length;
  }
  // remember the latest observed live ranks — the daily/season settlements use
  // them so rewards match the REAL board, not the offline fallback.
  //
  // A SAVED RANK IS ALSO CLEARED, not only written (fixed Aug 2026). This only
  // ever wrote, so a rank observed once outlived the board that produced it: a
  // placing from the era when the board padded itself with generated rivals sat
  // in the save and kept printing "#2" against a board that now has one real row
  // on it. A board that loaded is authoritative in BOTH directions — if it does
  // not place me, I am not placed. Each board only speaks for its own rank, so a
  // daily read that landed says nothing about the season rank.
  function syncRanks() {
    const s = sd(); if (!s) return;
    let hit = 0;
    if (_cl.day && myUid()) {
      const d = liveDailyRank();
      const next = d ? { day: s.day, rank: d } : null;
      const prev = s.lbRank;
      if (!next !== !prev || (next && prev && (prev.rank !== next.rank || prev.day !== next.day))) { s.lbRank = next; hit = 1; }
    }
    if (_cl.season && myUid()) {
      const sr = liveSeasonRank() || null;
      if ((s.lbSeasonRank || null) !== sr) { s.lbSeasonRank = sr; hit = 1; }
    }
    if (hit) { try { G().save(); } catch (e) {} }
  }
  // publish my row after every run (identity = auth.uid(); server keeps maxes)
  //
  // A PUBLISH IS NOT DONE UNTIL THE SERVER CONFIRMS IT (Aug 2026). This was a
  // fire-and-forget call into a function that swallowed its own errors, with no
  // retry and no record that the write had failed — so one refused RPC (expired
  // JWT, RLS, a network blip on a phone leaving the arena) dropped the run off the
  // board permanently while the local record kept climbing. That is the
  // "completed the event, leaderboard never updated" report.
  //
  // The row is now marked dirty until a write is CONFIRMED, retried with backoff,
  // and re-flushed by flushPublish() whenever the event screen opens — so a run
  // that failed to publish mid-flight still lands on the board later. The server
  // RPC keeps maxes, so republishing the same figures is idempotent.
  function publishScore(attempt) {
    const s = sd(); if (!s) return;
    // GUESTS can read the live board but can never WRITE it (the RPC requires a
    // signed-in account) — tell them once a day why their run isn't showing up.
    if (cloudOn() && !myUid()) {
      if (s.pubWarnDay !== dayIdx()) { s.pubWarnDay = dayIdx(); try { G().save(); } catch (e) {} toast('👤 Guest run — sign in with an account to appear on the LIVE event leaderboard'); }
      return;
    }
    if (!cloudOn()) return;
    const n = (attempt | 0) || 1;
    s.pubDirty = 1;
    const payload = { name: myName(), season: SEASON.num, day: s.day, best: s.bestDay, total: Math.floor(s.total), stage: Math.max(1, s.bestStage | 0) };
    let call = null;
    try { call = window.CLOUD.sdUpsert(payload); } catch (e) {}
    Promise.resolve(call).then((r) => {
      // an older cloud.js resolves undefined — treat that as success, not a loop
      if (!r || r.ok) {
        s.pubDirty = 0; s.pubAt = Date.now();
        try { G().save(); } catch (e) {}
        setTimeout(() => ensureCloud(null, true), 1500);
        return;
      }
      if (n < 5) { setTimeout(() => publishScore(n + 1), Math.min(30000, 2000 * Math.pow(2, n - 1))); return; }
      // five refusals is a real problem, not a blip: say so rather than leaving the
      // player to discover the gap on the board themselves
      try { G().save(); } catch (e) {}
      toast('⚠ Score not on the board yet — it will publish itself later');
    }).catch(() => {
      if (n < 5) setTimeout(() => publishScore(n + 1), Math.min(30000, 2000 * Math.pow(2, n - 1)));
    });
  }
  // Re-send a run the server never confirmed. Cheap and idempotent, so it runs on
  // every event-screen open — including the first one after a guest signs in.
  // Re-send a run the server never confirmed — and also a row that is simply NOT
  // THERE. `pubDirty` only catches a write we KNOW failed; a row missing for any
  // other reason left the pilot silently off the board with nothing to retry, and
  // no daily reward to settle. So compare the fetched daily board against the
  // local record: no row of mine, or a lower figure than my own best, and it
  // publishes again. The RPC keeps maxes, so re-sending is free and idempotent.
  function flushPublish() {
    const s = sd(); if (!s) return;
    if (!cloudOn() || !myUid()) return;
    if (s.pubDirty) { publishScore(); return; }
    if (!s.bestDay) return;
    // PREFER THE ROW FETCHED BY ID. Scanning the top-100 daily slice cannot tell
    // "no row of mine" from "my row is rank 101", so a mid-table pilot republished
    // on every single event-screen open. Fall back to the slice only when the
    // direct fetch has not landed yet.
    const m = _cl.mine;
    if (m) { if ((m.day | 0) !== (s.day | 0) || (+m.best_day || 0) < (+s.bestDay || 0)) publishScore(); return; }
    if (!_cl.day) return;
    const id = myUid();
    const row = _cl.day.filter((r) => r.user_id === id)[0];
    if (!row || (row.best_day || 0) < s.bestDay) publishScore();
  }

  // ---- leaderboards (daily · season, side by side) ----
  function lbRows(list, me, myRank, top) {
    const rows = [];
    const merged = list.slice(0, 100);
    if (me) { merged.push({ name: 'YOU', dmg: me, me: true }); merged.sort((a, b) => b.dmg - a.dmg); }
    let inserted = false;
    merged.slice(0, 100).forEach((b, i) => {
      const r = i + 1;
      if (r <= top || b.me) {
        if (r > top && !inserted) rows.push('<div class="sdl-gap">···</div>');
        if (b.me) inserted = true;
        rows.push('<div class="sdl-row' + (b.me ? ' me' : '') + (r === 1 ? ' first' : '') + '"><span class="sdl-r">' + r + '</span><span class="sdl-n">' + b.name + '</span><span class="sdl-d">' + fmt(b.dmg) + '</span></div>');
      }
    });
    if (me && !inserted && myRank > 100) rows.push('<div class="sdl-gap">···</div><div class="sdl-row me"><span class="sdl-r">' + myRank + '</span><span class="sdl-n">YOU</span><span class="sdl-d">' + fmt(me) + '</span></div>');
    return rows.join('');
  }
  // ---- leaderboard sheet content (rebuilt on every live refresh) ----
  function lbSheetBody() {
    const s = sd();
    const live = cloudOn();
    const signedIn = live && !!myUid();
    const meDay = s.bestDay || 0, meSea = Math.floor(s.total) || 0;
    const myDayRank = meDay ? knownDailyRank(s) : null;
    const mySeaRank = meSea ? knownSeasonRank(s) : null;
    // REAL ROWS ONLY. No bot field stands in while a fetch is in flight — an
    // empty board says it is empty (see the NO BOT FIELD note above).
    const dayList = (live && _cl.day) ? cloudOthers(_cl.day).map((r) => ({ name: r.name || 'Operator', dmg: r.best_day || 0 })) : [];
    const seaList = (live && _cl.season) ? cloudOthers(_cl.season).map((r) => ({ name: r.name || 'Operator', dmg: r.total || 0 })) : [];
    const aloneNote = (live && _cl.ok && signedIn && _cl.season && cloudOthers(_cl.season).length === 0)
      ? '<div class="sdm-locknote soft" style="margin-top:6px">You\u2019re the only operator published so far — pilots appear as they fight while <b>signed in</b>.</div>' : '';
    const liveNote = live
      ? (_cl.ok
          ? (signedIn
              ? '<div class="sdl-live">🌐 LIVE — real server standings · auto-updates<span class="sdl-pulse"></span></div>'
              : '<div class="sdl-live off">🌐 LIVE board (read-only) — <b style="color:#ffcf7a">you\u2019re a guest: your runs don\u2019t publish.</b> Sign in to place.</div>')
          : ((_cl.tries | 0) >= 2
              ? '<div class="sdl-live off">🌐 Live standings aren’t reachable right now — retrying</div>'
              : '<div class="sdl-live off">🌐 Connecting to live standings…</div>'))
      : '<div class="sdl-live off">Offline — sign in to see the live standings</div>';
    const emptyRow = '<div class="sdm-nodrop" style="margin:0">No operators published yet.</div>';
    return liveNote + aloneNote +
      (meDay || meSea ? '' : '<div class="sdm-locknote">Fight at least once to place. Daily ranks your <b>best single run</b> — season ranks your <b>total damage</b>.</div>') +
      '<div class="sdl-cols">' +
        '<div class="sdl-col">' +
          '<div class="sdl-col-h">⚔ DAILY<span>best single run</span></div>' +
          (myDayRank ? '<div class="sdl-mychip">Your rank <b>#' + myDayRank + '</b></div>' : '<div class="sdl-mychip none">' + (meDay ? 'Rank pending' : 'Not placed today') + '</div>') +
          '<div class="sdl-list">' + (dayList.length || meDay ? lbRows(dayList, meDay, myDayRank, 8) : emptyRow) + '</div>' +
        '</div>' +
        '<div class="sdl-col">' +
          '<div class="sdl-col-h season">∑ SEASON<span>total damage</span></div>' +
          (mySeaRank ? '<div class="sdl-mychip">Your rank <b>#' + mySeaRank + '</b></div>' : '<div class="sdl-mychip none">' + (meSea ? 'Rank pending' : 'Not placed yet') + '</div>') +
          '<div class="sdl-list">' + (seaList.length || meSea ? lbRows(seaList, meSea, mySeaRank, 8) : emptyRow) + '</div>' +
        '</div>' +
      '</div>';
  }
  let _lbTimer = 0;
  function refreshLB() {
    if (!_modal) return;
    const b = _modal.querySelector('#sdl-body'); if (!b) return;
    b.innerHTML = lbSheetBody();
  }
  function openLB() {
    ensureCloud(refreshLB, true);
    sheet(
      '<div class="sdm-kicker">LEADERBOARDS</div>' +
      '<div class="sdm-title small">' + SEASON.boss + ' — STANDINGS</div>' +
      '<div class="sdm-cd">Daily resets in <b data-sdreset>' + fmtDur(msToDailyReset()) + '</b> · prizes are collected on the event screen</div>' +
      '<div id="sdl-body">' + lbSheetBody() + '</div>' +
      '<div class="sdl-tierwrap">' +
        '<div class="sdl-tcol"><div class="sdl-tcol-h">DAILY REWARDS · ✦ EVENT COINS</div>' +
          LB_TIERS.map((t) => lbTier(t.name, tierTxt(t))).join('') +
        '</div>' +
        '<div class="sdl-tcol"><div class="sdl-tcol-h">OVERALL STANDINGS</div>' +
          SEASON_TIERS.map((t) => lbTier(t.name, tierTxt(t))).join('') +
        '</div>' +
      '</div>' +
      '<button class="sdm-ok" id="sdm-ok">Close</button>', true
    );
    _modal.querySelector('#sdm-ok').addEventListener('click', closeModal);
    // LIVE AUTO-REFRESH — poll the boards every 5s while the sheet stays open,
    // swapping the standings in place (new scores appear as people play).
    clearInterval(_lbTimer);
    _lbTimer = setInterval(() => {
      if (!_modal || !_modal.querySelector('#sdl-body')) { clearInterval(_lbTimer); _lbTimer = 0; return; }
      ensureCloud(refreshLB, true);
      refreshLB();                                      // keep countdown + offline boards fresh too
    }, 5000);
  }
  function lbTier(n, r) { return '<div class="sdl-tier"><b>' + n + '</b><span>' + r + '</span></div>'; }

  // ---- reward history ----
  function openHistory() {
    const s = sd();
    sheet(
      '<div class="sdm-kicker">LAST ' + Math.min(40, s.hist.length) + ' REWARDS</div>' +
      '<div class="sdm-title small">📜 REWARD HISTORY</div>' +
      (s.hist.length
        ? '<div class="sdh-list">' + s.hist.map((h) => '<div class="sdh-row"><span class="sdh-st">' + (h.s > 0 ? 'STAGE ' + h.s : h.s === 0 ? '🏆 DAILY' : '❖ EVENT') + '</span><span class="sdh-txt">' + h.txt + '</span></div>').join('') + '</div>'
        : '<div class="sdm-nodrop">Nothing yet — clear your first stage and it lands here.</div>') +
      '<button class="sdm-ok" id="sdm-ok">Close</button>'
    );
    _modal.querySelector('#sdm-ok').addEventListener('click', closeModal);
  }

  // ---- wire ----
  function wire(body) {
    const on = (id, fn) => { const e = body.querySelector('#' + id); if (e) e.addEventListener('click', fn); };
    on('sd-fight', startRun);
    on('sd-claims', claimAll);
    on('sd-buyatt', buyAttempt);
    on('sd-return', () => { const b = document.querySelector('.nav-btn[data-screen="battle"]'); if (b) b.click(); });
    on('sd-lb', openLB);
    on('sd-store', openStore);
    on('sd-hist', openHistory);
    on('sd-how', () => openHowTo(false));
    on('sd-coach-t', () => { _coachOpen = !_coachOpen; render(); });
  }

  // =========================================================================
  // HUD / COMMAND-CARD sync + countdowns
  // =========================================================================
  function updateHud() {
    const g = G(); if (!g || !g.state) return;
    const s = sd(); if (!s) return;
    if (s.pendingToast && lvl() >= UNLOCK) { toast(s.pendingToast); delete s.pendingToast; try { g.save(); } catch (e) {} }
    // keep the live board ranks fresh (throttled internally) so settlements
    // and the run summary use REAL standings
    if (lvl() >= UNLOCK && !ended()) ensureCloud();
    // GRAND PRIZE — auto-assemble the moment the final part lands (never mid-run)
    if (!run && lvl() >= UNLOCK && !vmOwned() && vmParts() >= VM_NEED) vmAssemble();
    // command-card badge = attempts remaining (only once unlocked & live)
    const b = $('cmd-sdread-badge');
    if (b) {
      const claimsN = (s.claims && s.claims.length) | 0;
      const n = (!ended() && lvl() >= UNLOCK) ? attemptsLeft() : 0;
      b.style.display = (claimsN || n) > 0 ? 'flex' : 'none';
      b.textContent = claimsN ? '🎁' : n;
    }
    // command-card countdown
    const cd = $('cmd-sdread-cd');
    if (cd) cd.textContent = fmtDur(msToDailyReset()) + ' to reset';
    // on-screen countdowns
    const scr = $('screen-sdread');
    if (scr && scr.classList.contains('active')) {
      document.querySelectorAll('[data-sdcd]').forEach((e) => { e.textContent = fmtDur(msToDailyReset()); });
      document.querySelectorAll('[data-sdreset]').forEach((e) => { e.textContent = fmtDur(msToDailyReset()); });
    }
  }

  // =========================================================================
  // BOOT
  // =========================================================================
  function boot() {
    injectCSS();
    setInterval(() => {
      try {
        updateHud();
        // watchdog: the engine run was cancelled externally (bail / redeploy /
        // warp) → settle the run as abandoned so the attempt still pays out.
        if (run && G() && G().rt && !(G().rt.sdrun && G().rt.sdrun.active) && !G().rt.archer.dead) endRun('abandoned', true);
      } catch (e) {}
    }, 1000);
    setTimeout(() => { try { updateHud(); } catch (e) {} }, 800);
  }

  function injectCSS() {
    if ($('sdread-css')) return;
    const s = document.createElement('style'); s.id = 'sdread-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  // pay a mailed prize (coins/lc/gold/cores) — returns the receipt text
  function payPrize(p) {
    const s = sd(), g = G(); if (!p || !g || !g.state) return null;
    if (p.coins && s) s.coins = coinsOf(s) + p.coins;
    if (p.lc) { if (g.addCredits) g.addCredits(p.lc); else g.state.credits = (g.state.credits || 0) + p.lc; }
    if (p.gold) g.state.gold = (g.state.gold || 0) + p.gold;
    if (p.cores) g.state.dreadCores = (g.state.dreadCores || 0) + p.cores;
    // RESOURCES. Every mailed prize is paid through here, and casino citadel
    // payouts are denominated in all five casino currencies — without these three
    // the fuel/iron/plasma half of a payout was accepted and then dropped.
    if (p.fuel || p.iron || p.plasma) {
      const r = g.state.resources = g.state.resources || { fuel: 0, iron: 0, plasma: 0 };
      if (p.fuel) r.fuel = (r.fuel || 0) + p.fuel;
      if (p.iron) r.iron = (r.iron || 0) + p.iron;
      if (p.plasma) r.plasma = (r.plasma || 0) + p.plasma;
    }
    try { g.save(); } catch (e) {}
    try { updateHud(); } catch (e) {}
    const bits = [];
    if (p.coins) bits.push('✦ ' + p.coins.toLocaleString() + ' Event Coins');
    if (p.lc) bits.push('◈ ' + p.lc + ' LootCoins');
    if (p.gold) bits.push('$ ' + p.gold.toLocaleString());
    if (p.cores) bits.push('◇ ' + p.cores + ' Cores');
    if (p.fuel) bits.push('⬢ ' + p.fuel.toLocaleString() + ' Fuel');
    if (p.iron) bits.push('◆ ' + p.iron.toLocaleString() + ' Iron');
    if (p.plasma) bits.push('✦ ' + p.plasma.toLocaleString() + ' Plasma');
    return bits.join(' · ') || 'collected';
  }
  // partsNeed is exported so the SHIP CARD can print the real requirement instead
  // of a hardcoded copy of it — that card said 100 while this said 150.
  window.SDREAD = { render, updateHud, openHowTo, engineTick, engineRender, onDeath, payPrize, partsNeed: VM_NEED, _dbg: { sd, stageInfo, threshold, bossPct, grantStageReward, startRun, endRun } };

  // =========================================================================
  // CSS
  // =========================================================================
  const CSS = `
  /* ---- Command mega-card: featured live event ---- */
  .mega-card.cmd-sdread{ background:linear-gradient(180deg,#1c1030,#120a1e);
    border-color:rgba(176,77,255,.55); box-shadow:0 0 26px -5px rgba(176,77,255,.55), 0 0 0 1px rgba(176,77,255,.22) inset; animation:sdCardAura 3s ease-in-out infinite; }
  @keyframes sdCardAura{ 0%,100%{ box-shadow:0 0 20px -6px rgba(176,77,255,.45), 0 0 0 1px rgba(176,77,255,.2) inset; } 50%{ box-shadow:0 0 36px -2px rgba(176,77,255,.8), 0 0 0 1px rgba(176,77,255,.4) inset; } }
  @media (prefers-reduced-motion:reduce){ .mega-card.cmd-sdread{ animation:none; } }
  .mega-card.cmd-sdread .mc-ic{ width:46px; height:46px; color:#d9a0ff; border-color:rgba(176,77,255,.6); background:radial-gradient(120% 120% at 50% 0%,#2a1444,#120a1e); box-shadow:0 0 18px -2px rgba(176,77,255,.8); }
  .mega-card.cmd-sdread .mc-n{ color:#f0dcff; font-size:13.5px; }
  .mega-card.cmd-sdread .mc-s{ color:#b79ad6; }
  .mega-card.cmd-sdread::before{ background:linear-gradient(130deg,#b04dff,#ff4adf,#6a5bff,#b04dff); background-size:260% 260%; opacity:.5; }
  .sd-live-tag{ font-style:normal; font-family:'Rajdhani',sans-serif; font-size:8.5px; font-weight:800; letter-spacing:.12em; color:#0e0716;
    background:linear-gradient(90deg,#ff4adf,#b04dff); border-radius:5px; padding:2px 5px; margin-left:6px; vertical-align:2px; animation:sdLivePulse 1.6s ease-in-out infinite; }
  @keyframes sdLivePulse{ 0%,100%{ opacity:1; } 50%{ opacity:.6; } }
  .sd-card-cd{ font-family:'Rajdhani',sans-serif; font-size:10px; font-weight:700; color:#8d7aab; margin-top:2px; }
  .sd-card-cd b{ color:#ffd24d; }
  #cmd-sdread-badge{ position:absolute; top:6px; right:8px; min-width:16px; height:16px; padding:0 4px; border-radius:8px; background:${ACCENT}; color:#fff;
    font-family:'Rajdhani',sans-serif; font-weight:800; font-size:10px; line-height:16px; text-align:center; box-shadow:0 0 8px ${ACCENT}; z-index:2; }

  /* ---- screen ---- */
  #sdread-body{ padding:12px 12px calc(130px + env(safe-area-inset-bottom,0px)); display:flex; flex-direction:column; gap:10px; max-width:820px; width:100%; margin:0 auto; }
  .sd-season{ display:flex; align-items:center; gap:8px; background:linear-gradient(90deg,#1c1030,#140b22); border:1px solid #3c2560; border-radius:12px; padding:8px 11px; }
  .sd-season-tag{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:9px; letter-spacing:.12em; color:#0e0716; background:linear-gradient(90deg,#ff4adf,#b04dff); border-radius:5px; padding:2px 6px; white-space:nowrap; }
  .sd-season-boss{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:14px; letter-spacing:.1em; color:#f0dcff; text-shadow:0 0 12px rgba(176,77,255,.7); }
  .sd-season-cd{ margin-left:auto; font-family:'Rajdhani',sans-serif; font-size:11px; font-weight:700; color:#b79ad6; text-align:right; }
  .sd-season-cd b{ color:#ffd24d; }

  /* arena */
  .sd-arena{ position:relative; height:210px; border:1px solid #3c2560; border-radius:16px; overflow:hidden;
    background:radial-gradient(140% 120% at 50% 0%, #221238 0%, #120a1e 55%, #0a0612 100%); }
  .sd-arena-sky{ position:absolute; inset:0; background:
    radial-gradient(1.5px 1.5px at 20% 30%, rgba(255,255,255,.5), transparent 60%),
    radial-gradient(1px 1px at 70% 20%, rgba(255,255,255,.4), transparent 60%),
    radial-gradient(1.5px 1.5px at 85% 60%, rgba(255,255,255,.35), transparent 60%),
    radial-gradient(1px 1px at 40% 75%, rgba(255,255,255,.3), transparent 60%),
    radial-gradient(60% 45% at 50% 108%, rgba(176,77,255,.28), transparent 70%); }
  .sd-stage-badge{ position:absolute; top:9px; left:10px; z-index:5; font-family:'Orbitron',sans-serif; font-weight:800; font-size:11px; letter-spacing:.1em;
    color:#f0dcff; background:rgba(20,11,34,.85); border:1px solid #4a2f78; border-radius:8px; padding:4px 9px; box-shadow:0 0 12px -4px ${ACCENT}; }
  .sd-bosswrap{ position:absolute; left:0; right:0; top:4px; bottom:34px; display:grid; place-items:center; z-index:2; }
  .sd-boss-img{ width:180px; height:108px; object-fit:contain; filter:drop-shadow(0 0 16px ${ACCENT}); animation:sdBossFloat 4.5s ease-in-out infinite; position:relative; z-index:2; }
  @keyframes sdBossFloat{ 0%,100%{ transform:translateY(2px); } 50%{ transform:translateY(-7px); } }
  .sd-aura{ position:absolute; width:210px; height:210px; border-radius:50%; z-index:1;
    background:radial-gradient(circle, rgba(176,77,255,.34) 0%, rgba(255,74,223,.12) 45%, transparent 66%); animation:sdAura 2.6s ease-in-out infinite; }
  @keyframes sdAura{ 0%,100%{ transform:scale(.94); opacity:.75; } 50%{ transform:scale(1.06); opacity:1; } }
  .sd-weakpoints{ position:absolute; inset:0; z-index:3; pointer-events:none; }
  .sd-weakpoints i{ position:absolute; width:9px; height:9px; border-radius:50%; background:#ff4adf; box-shadow:0 0 10px #ff4adf, 0 0 20px rgba(255,74,223,.6); animation:sdWeak 1.4s ease-in-out infinite; }
  @keyframes sdWeak{ 0%,100%{ transform:scale(.7); opacity:.65; } 50%{ transform:scale(1.15); opacity:1; } }
  @media (prefers-reduced-motion:reduce){ .sd-boss-img,.sd-aura,.sd-weakpoints i{ animation:none; } }
  .sd-floats{ position:absolute; inset:0; z-index:6; pointer-events:none; }
  .sd-float{ position:absolute; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:16px; color:#eef3ff; text-shadow:0 1px 4px #000; animation:sdFloatUp 1.05s ease-out forwards; display:none; }
  .sd-float.crit{ font-size:22px; color:#ffb14d; text-shadow:0 0 10px rgba(255,177,77,.7), 0 1px 4px #000; }
  .sd-float.hit{ font-size:15px; color:#ff5a68; }
  @keyframes sdFloatUp{ 0%{ opacity:0; transform:translateY(6px) scale(.9); } 12%{ opacity:1; transform:none; } 100%{ opacity:0; transform:translateY(-34px); } }
  .sd-abanner{ position:absolute; left:0; right:0; top:14%; z-index:7; text-align:center; pointer-events:none; opacity:0; }
  .sd-abanner.show{ animation:sdAb 2.4s ease forwards; }
  @keyframes sdAb{ 0%{ opacity:0; transform:translateY(-6px); } 10%{ opacity:1; transform:none; } 80%{ opacity:1; } 100%{ opacity:0; } }
  .sab-t{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:16px; letter-spacing:.12em; color:#fff; text-shadow:0 0 16px ${ACCENT}, 0 2px 8px #000; }
  .sab-t.gold{ color:#ffd24d; text-shadow:0 0 16px rgba(255,210,77,.8), 0 2px 8px #000; }
  .sab-s{ font-family:'Rajdhani',sans-serif; font-weight:700; font-size:11px; color:#d9c2f2; margin-top:3px; padding:0 20px; text-shadow:0 1px 6px #000; }

  /* attempts + fight */
  .sd-attrow{ display:flex; align-items:center; gap:9px; font-family:'Rajdhani',sans-serif; font-size:12px; color:#9fb0c4; }
  .sd-attrow .pro{ color:#ffd24d; font-weight:800; }
  .sd-stats.three{ grid-template-columns:repeat(3,1fr); }
  .sd-btnrow.three{ grid-template-columns:repeat(3,1fr); }
  .sd-arena-foot{ position:absolute; left:0; right:0; bottom:0; z-index:5; display:flex; align-items:center; gap:8px; padding:7px 11px;
    background:linear-gradient(180deg, rgba(10,6,18,0), rgba(10,6,18,.88) 40%); font-family:'Rajdhani',sans-serif; font-weight:800; font-size:10px; letter-spacing:.06em; color:#d9c2f2; }
  .sd-arena-foot .sd-prog{ flex:1; margin:0; }
  .sd-arena-foot .sub{ color:#8d7aab; font-weight:700; letter-spacing:.02em; }
  .sd-pips{ display:flex; gap:5px; }
  .sd-pips i{ width:11px; height:11px; border-radius:50%; background:#241733; border:1px solid #4a2f78; }
  .sd-pips i.on{ background:${ACCENT}; box-shadow:0 0 8px ${ACCENT}; border-color:#d9a0ff; }
  .sd-att-r{ margin-left:auto; } .sd-att-r .pro{ color:#ffd24d; font-weight:800; }
  .sd-pro-hint{ color:#8d7aab; cursor:pointer; text-decoration:underline dotted; }
  /* claims banner — the collect button (pulsing gold, impossible to miss) */
  .sd-claims{ width:100%; border:none; border-radius:14px; padding:13px; cursor:pointer; font-family:'Orbitron',sans-serif; font-weight:800; font-size:15px; letter-spacing:.08em; color:#1c1206;
    background:linear-gradient(180deg,#ffd24d,#e8960f); box-shadow:0 10px 28px -8px rgba(255,210,77,.65), 0 0 0 1px rgba(255,255,255,.25) inset; display:flex; flex-direction:column; align-items:center; gap:3px;
    animation:sdClaimPulse 1.8s ease-in-out infinite; }
  .sd-claims span{ font-family:'Rajdhani',sans-serif; font-weight:800; font-size:11px; letter-spacing:.04em; color:#4a3208; }
  .sd-claims:active{ transform:scale(.98); }
  @keyframes sdClaimPulse{ 0%,100%{ box-shadow:0 10px 24px -10px rgba(255,210,77,.5), 0 0 0 1px rgba(255,255,255,.25) inset; } 50%{ box-shadow:0 10px 34px -4px rgba(255,210,77,.9), 0 0 0 1px rgba(255,255,255,.4) inset; } }
  @media (prefers-reduced-motion:reduce){ .sd-claims{ animation:none; } }
  .sd-fight{ width:100%; border:none; border-radius:14px; padding:14px; cursor:pointer; font-family:'Orbitron',sans-serif; font-weight:800; font-size:16px; letter-spacing:.08em; color:#fff;
    background:linear-gradient(180deg,#c95bff,#8422d8); box-shadow:0 10px 28px -8px ${ACCENT}, 0 0 0 1px rgba(255,255,255,.12) inset; display:flex; flex-direction:column; align-items:center; gap:3px; }
  .sd-fight span{ font-family:'Rajdhani',sans-serif; font-weight:700; font-size:11px; letter-spacing:.04em; color:#ecd6ff; text-transform:none; }
  .sd-fight span b{ color:#ffd24d; }
  .sd-fight:active{ transform:scale(.98); }
  .sd-fight:disabled{ background:#241733; color:#8d7aab; box-shadow:none; cursor:default; }

  /* stats */
  .sd-stats{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .sd-stat{ background:linear-gradient(180deg,#151022,#100b1a); border:1px solid #2c1e48; border-radius:12px; padding:9px 11px; }
  .sd-stat-l{ font-size:9.5px; font-weight:700; letter-spacing:.08em; color:#8d7aab; text-transform:uppercase; font-family:'Rajdhani',sans-serif; }
  .sd-stat-v{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:16px; color:#f0dcff; margin-top:3px; }
  .sd-stat-s{ font-size:10px; color:#7e6f96; margin-top:3px; font-family:'Rajdhani',sans-serif; font-weight:600; }
  .sd-prog{ height:6px; border-radius:4px; background:#241733; overflow:hidden; margin:4px 0; }
  .sd-prog.big{ height:9px; border-radius:5px; }
  .sd-prog i{ display:block; height:100%; background:linear-gradient(90deg,#b04dff,#ff4adf); box-shadow:0 0 8px ${ACCENT}; transition:width .25s linear; }

  /* button row */
  .sd-btnrow{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .sd-btn{ border:1px solid #3c2560; border-radius:11px; background:linear-gradient(180deg,#1c1030,#140b22); color:#e3d2f7; padding:10px 8px;
    font-family:'Rajdhani',sans-serif; font-weight:700; font-size:12.5px; cursor:pointer; }
  .sd-btn b{ color:#ffd24d; margin-left:3px; }
  .sd-btn:active{ transform:scale(.97); }
  .sd-btn.ghost{ background:none; border-style:dashed; color:#a08fc0; }

  /* rewards preview */
  .sd-preview{ background:linear-gradient(180deg,#151022,#100b1a); border:1px solid #2c1e48; border-radius:12px; padding:10px 12px; }
  .sd-preview-h{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:9.5px; letter-spacing:.12em; color:#b79ad6; margin-bottom:7px; }
  .sd-prev-row{ display:flex; flex-wrap:wrap; gap:3px 8px; align-items:baseline; padding:6px 0; border-top:1px solid #221636; }
  .sd-prev-row:first-of-type{ border-top:none; }
  .sd-prev-st{ font-family:'Orbitron',sans-serif; font-weight:700; font-size:10.5px; color:#f0dcff; }
  .sd-prev-need{ font-size:10px; color:#8d7aab; font-family:'Rajdhani',sans-serif; font-weight:700; }
  .sd-prev-loot{ flex-basis:100%; font-size:11px; color:#c5b3de; font-family:'Rajdhani',sans-serif; font-weight:600; }

  /* coaching */
  .sd-coach{ background:#12101d; border:1px solid #2c1e48; border-radius:12px; overflow:hidden; }
  .sd-coach-h{ width:100%; text-align:left; background:none; border:none; color:#e3d2f7; font-family:'Rajdhani',sans-serif; font-weight:700; font-size:13px; padding:11px 13px; cursor:pointer; display:flex; justify-content:space-between; }
  .sd-coach ul{ margin:0; padding:0 15px 12px 28px; display:flex; flex-direction:column; gap:7px; }
  .sd-coach li{ font-size:12px; color:#b3a4cb; line-height:1.45; font-family:'Rajdhani',sans-serif; }
  .sd-coach li b, .sd-lock-coach li b{ color:#f0dcff; }
  .sd-foot{ font-size:11px; color:#8d7aab; text-align:center; line-height:1.5; font-family:'Rajdhani',sans-serif; font-weight:600; padding:0 6px 8px; }
  .sd-foot b{ color:#e3d2f7; }

  /* battle hud (SD screen while a run is live) */
  .sd-runhud{ display:flex; flex-direction:column; gap:8px; background:linear-gradient(180deg,#151022,#100b1a); border:1px solid #3c2560; border-radius:14px; padding:12px; }
  .sd-runrow{ display:flex; align-items:baseline; gap:10px; }
  .sd-runrow.small{ font-family:'Rajdhani',sans-serif; font-size:11.5px; color:#8d7aab; justify-content:space-between; }
  .sd-runrow.small b{ color:#f0dcff; font-variant-numeric:tabular-nums; }
  .sd-run-t{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:18px; color:#fff; text-shadow:0 0 14px ${ACCENT}; }
  .sd-run-lbl{ font-family:'Rajdhani',sans-serif; font-size:10.5px; font-weight:800; letter-spacing:.08em; color:#d9c2f2; }

  /* in-arena war bar (#top-stack) */
  #sd-warbar{ display:flex; align-items:center; gap:8px; margin-top:6px; padding:6px 10px; border-radius:11px; pointer-events:none;
    background:rgba(22,12,38,.88); border:1px solid #4a2f78; box-shadow:0 0 18px -6px ${ACCENT}; backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px); }
  #sd-warbar .swb-tag{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:8.5px; letter-spacing:.1em; color:#0e0716; background:linear-gradient(90deg,#ff4adf,#b04dff); border-radius:4px; padding:2px 4px; }
  #sd-warbar .swb-timer{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:14px; color:#fff; text-shadow:0 0 10px ${ACCENT}; font-variant-numeric:tabular-nums; }
  #sd-warbar .swb-dmg{ font-family:'Rajdhani',sans-serif; font-weight:700; font-size:11px; color:#b79ad6; white-space:nowrap; }
  #sd-warbar .swb-dmg b{ color:#f0dcff; font-variant-numeric:tabular-nums; }
  #sd-warbar .swb-stage{ font-family:'Rajdhani',sans-serif; font-weight:800; font-size:11px; color:#ffd24d; white-space:nowrap; }
  #sd-warbar .swb-bar{ flex:1; height:6px; border-radius:4px; background:#241733; overflow:hidden; min-width:40px; }
  #sd-warbar .swb-bar i{ display:block; height:100%; background:linear-gradient(90deg,#b04dff,#ff4adf); box-shadow:0 0 8px ${ACCENT}; transition:width .2s linear; }

  /* in-world battle banner */
  #sd-bbanner{ position:absolute; left:0; right:0; top:46%; z-index:14; display:flex; flex-direction:column; align-items:center; pointer-events:none; opacity:0; transform:translateY(-8px); }
  #sd-bbanner.show{ animation:sdBbIn 2.6s ease forwards; }
  @keyframes sdBbIn{ 0%{opacity:0;transform:translateY(-8px) scale(.96);} 10%{opacity:1;transform:none;} 80%{opacity:1;} 100%{opacity:0;} }
  #sd-bbanner .sbb-t{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:21px; letter-spacing:.13em; color:#fff; text-shadow:0 0 18px ${ACCENT}, 0 2px 10px #000; }
  #sd-bbanner .sbb-t.gold{ color:#ffd24d; text-shadow:0 0 18px rgba(255,210,77,.8), 0 2px 10px #000; }
  #sd-bbanner .sbb-s{ font-family:'Rajdhani',sans-serif; font-weight:700; font-size:12px; letter-spacing:.04em; color:#d9c2f2; margin-top:4px; text-shadow:0 1px 6px #000; padding:0 24px; text-align:center; }

  /* locked view */
  .sd-lock{ background:linear-gradient(180deg,#151022,#100b1a); border:1px solid #2c1e48; border-radius:16px; padding:20px 16px; text-align:center; }
  .sd-lock-ic{ font-size:36px; filter:drop-shadow(0 0 14px ${ACCENT}); }
  .sd-lock h3{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:17px; color:#f0dcff; margin:10px 0 6px; letter-spacing:.04em; }
  .sd-lock p{ font-size:12.5px; color:#b3a4cb; line-height:1.55; margin:0 0 12px; font-family:'Rajdhani',sans-serif; font-weight:600; }
  .sd-lock p b{ color:#f0dcff; }
  .sd-lock-lv{ font-family:'Rajdhani',sans-serif; font-size:12px; font-weight:700; color:#e3d2f7; background:#191227; border:1px solid #3c2560; border-radius:10px; padding:8px 12px; margin-bottom:8px; }
  .sd-lock-lv b{ color:#ffd24d; }
  .sd-lock-coach{ text-align:left; background:#12101d; border:1px solid #2c1e48; border-radius:12px; padding:11px 13px 12px; margin:12px 0; }
  .sd-lock-coach .sd-coach-h{ padding:0 0 7px; font-size:13px; color:#e3d2f7; font-weight:700; font-family:'Rajdhani',sans-serif; }
  .sd-lock-coach ul{ margin:0; padding-left:16px; display:flex; flex-direction:column; gap:6px; }
  .sd-lock-coach li{ font-size:11.5px; color:#b3a4cb; line-height:1.45; font-family:'Rajdhani',sans-serif; }

  /* ---- modal ---- */
  .sd-modal{ position:absolute; inset:0; z-index:62; display:grid; place-items:center; padding:18px; }
  .sd-modal-back{ position:absolute; inset:0; background:rgba(6,5,12,.76); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); }
  .sd-modal-card{ position:relative; max-width:340px; width:100%; max-height:calc(100% - 30px); overflow-y:auto; background:linear-gradient(180deg,#1c1030,#110a1c);
    border:1px solid #4a2f78; border-radius:18px; padding:20px 18px; box-shadow:0 24px 60px rgba(0,0,0,.65), 0 0 44px -14px ${ACCENT}; animation:sdmUp .3s cubic-bezier(.22,1,.36,1); }
  @keyframes sdmUp{ from{ transform:translateY(18px); opacity:0; } to{ transform:none; opacity:1; } }
  .sd-modal-card.wide{ max-width:430px; }
  .sdm-kicker{ font-family:'Rajdhani',sans-serif; font-weight:800; font-size:9.5px; letter-spacing:.16em; color:#ff4adf; text-align:center; }
  .sdm-title{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:21px; letter-spacing:.06em; color:#fff; text-align:center; margin:5px 0 2px; text-shadow:0 0 18px ${ACCENT}; }
  .sdm-title.small{ font-size:16px; }
  .sdm-cd{ font-family:'Rajdhani',sans-serif; font-size:11.5px; font-weight:700; color:#b79ad6; text-align:center; margin-bottom:10px; }
  .sdm-cd b{ color:#ffd24d; }
  .sdm-art{ display:grid; place-items:center; margin:4px 0 10px; }
  .sdm-art img{ width:150px; height:100px; object-fit:contain; filter:drop-shadow(0 0 18px ${ACCENT}); animation:sdBossFloat 4.5s ease-in-out infinite; }
  .sdm-art.small{ margin:2px 0 6px; }
  .sdm-art.small img{ width:104px; height:68px; }
  .sdm-intro{ font-family:'Rajdhani',sans-serif; font-weight:700; font-size:11.5px; color:#b79ad6; text-align:center; line-height:1.4; margin-bottom:10px; padding:0 8px; }
  .sdm-rules{ display:flex; flex-direction:column; gap:9px; text-align:left; }
  .sdm-rule{ display:flex; gap:10px; align-items:flex-start; }
  .sdm-ric{ flex:none; width:26px; height:26px; display:grid; place-items:center; border-radius:8px; background:#241733; border:1px solid #3c2560; font-size:13px; color:#d9a0ff; }
  .sdm-rule b{ font-family:'Rajdhani',sans-serif; font-weight:800; font-size:12.5px; color:#f0dcff; display:block; }
  .sdm-rule p{ font-family:'Rajdhani',sans-serif; font-weight:600; font-size:11.5px; color:#a695c2; line-height:1.45; margin:2px 0 0; }
  .sdm-rule p b{ display:inline; color:#e3d2f7; }
  .sdm-locknote{ font-family:'Rajdhani',sans-serif; font-weight:700; font-size:11.5px; color:#ffb1c0; background:rgba(255,73,95,.08); border:1px solid rgba(255,73,95,.3); border-radius:10px; padding:8px 11px; margin:12px 0 0; text-align:center; line-height:1.45; }
  .sdm-locknote.soft{ color:#b3a4cb; background:#12101d; border-color:#2c1e48; }
  .sdm-locknote b{ color:#ffd24d; }
  .sdm-ok{ width:100%; margin-top:14px; background:linear-gradient(180deg,#c95bff,#8422d8); color:#fff; border:none; border-radius:12px; padding:12px;
    font-family:'Rajdhani',sans-serif; font-weight:800; font-size:14px; letter-spacing:.04em; cursor:pointer; box-shadow:0 8px 22px -8px ${ACCENT}; }
  .sdm-ok:active{ transform:scale(.97); }
  .sdm-best{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:11px; letter-spacing:.12em; color:#ffd24d; text-align:center; margin:2px 0 8px; text-shadow:0 0 12px rgba(255,210,77,.6); }
  .sdm-sumrow{ display:flex; justify-content:space-between; font-family:'Rajdhani',sans-serif; font-weight:700; font-size:12.5px; color:#a695c2; padding:6px 2px; border-bottom:1px solid #221636; }
  .sdm-sumrow b{ color:#f0dcff; }
  .sdm-drops{ margin-top:10px; display:flex; flex-direction:column; gap:6px; max-height:180px; overflow-y:auto; }
  .sdm-drop{ display:flex; flex-wrap:wrap; gap:3px 8px; background:#12101d; border:1px solid #2c1e48; border-radius:9px; padding:6px 9px; font-family:'Rajdhani',sans-serif; font-weight:700; font-size:11px; }
  .sdm-drop-st{ color:#ffd24d; font-family:'Orbitron',sans-serif; font-size:9px; font-weight:800; letter-spacing:.08em; flex-basis:100%; }
  .sdm-nodrop{ font-family:'Rajdhani',sans-serif; font-size:12px; color:#a695c2; text-align:center; padding:14px 6px; line-height:1.5; }

  /* leaderboard */
  .sdl-cols{ display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:6px; }
  .sdl-col{ min-width:0; background:#0f0c19; border:1px solid #221636; border-radius:11px; padding:7px; }
  .sdl-col-h{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:10px; letter-spacing:.08em; color:#f0dcff; display:flex; flex-direction:column; gap:1px; padding:2px 2px 6px; }
  .sdl-col-h span{ font-family:'Rajdhani',sans-serif; font-weight:700; font-size:9px; letter-spacing:.05em; color:#8d7aab; text-transform:none; }
  .sdl-col-h.season{ color:#ffd24d; }
  .sdl-mychip{ font-family:'Rajdhani',sans-serif; font-weight:700; font-size:10.5px; color:#d9c2f2; background:#191227; border:1px solid #3c2560; border-radius:7px; padding:4px 7px; margin-bottom:6px; text-align:center; }
  .sdl-mychip b{ color:#ffd24d; }
  .sdl-mychip.none{ color:#6e5f8a; border-style:dashed; }
  .sdl-list{ display:flex; flex-direction:column; gap:3px; margin-top:0; }
  .sdl-row{ display:flex; gap:5px; align-items:center; background:#12101d; border:1px solid #221636; border-radius:8px; padding:5px 6px; font-family:'Rajdhani',sans-serif; font-weight:700; font-size:10.5px; color:#c5b3de; }
  .sdl-row.first{ border-color:#ffd24d66; background:linear-gradient(90deg,#241c10,#12101d); }
  .sdl-row.me{ border-color:${ACCENT}; background:linear-gradient(90deg,#241733,#161022); color:#fff; box-shadow:0 0 12px -6px ${ACCENT}; }
  .sdl-r{ flex:none; min-width:18px; text-align:right; color:#8d7aab; font-variant-numeric:tabular-nums; }
  .sdl-row.first .sdl-r{ color:#ffd24d; }
  .sdl-n{ flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .sdl-d{ font-variant-numeric:tabular-nums; color:#f0dcff; white-space:nowrap; }
  .sdl-gap{ text-align:center; color:#4e3f68; font-size:11px; padding:1px 0; }
  .sdl-live{ font-family:'Rajdhani',sans-serif; font-weight:800; font-size:10px; letter-spacing:.08em; color:#7ce0a0; text-align:center; margin-top:6px; }
  .sdl-live.off{ color:#8d7aab; }
  .sdl-pulse{ display:inline-block; width:6px; height:6px; border-radius:50%; background:#7ce0a0; margin-left:5px; vertical-align:1px; box-shadow:0 0 6px #7ce0a0; animation:sdLivePulse 1.2s ease-in-out infinite; }
  /* manual-flight lockout — hide the auto toggle while an event run is live */
  .sd-noauto #auto-btn, .sd-noauto #auto-warn{ display:none !important; }
  .sdl-tierwrap{ display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:12px; }
  .sdl-tcol{ min-width:0; display:flex; flex-direction:column; gap:5px; }
  .sdl-tcol-h{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:8.5px; letter-spacing:.1em; color:#b79ad6; padding:0 2px; }
  .sdl-tiers{ margin-top:12px; display:flex; flex-direction:column; gap:5px; }
  .sdl-tier{ display:flex; flex-direction:column; gap:1px; font-family:'Rajdhani',sans-serif; font-size:10.5px; font-weight:700; color:#a695c2; background:#12101d; border:1px solid #2c1e48; border-radius:8px; padding:5px 8px; }
  .sdl-tier b{ flex:none; color:#ffd24d; }

  /* store */
  .sds-list{ display:flex; flex-direction:column; gap:6px; margin-top:6px; }
  .sds-row{ display:flex; gap:10px; align-items:center; background:#12101d; border:1px solid #2c1e48; border-radius:10px; padding:8px 10px; }
  .sds-row.cant{ opacity:.6; }
  .sds-ic{ flex:none; width:30px; height:30px; display:grid; place-items:center; border-radius:8px; background:#241733; border:1px solid #3c2560; color:#d9a0ff; font-size:14px; font-weight:800; }
  .sds-t{ flex:1; min-width:0; }
  .sds-t b{ display:block; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:12.5px; color:#f0dcff; }
  .sds-t span{ font-family:'Rajdhani',sans-serif; font-weight:600; font-size:10.5px; color:#8d7aab; }
  .sds-buy{ flex:none; border:none; border-radius:9px; padding:8px 11px; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:11.5px; color:#fff;
    background:linear-gradient(180deg,#c95bff,#8422d8); cursor:pointer; box-shadow:0 4px 12px -5px ${ACCENT}; white-space:nowrap; }
  .sds-buy:disabled{ background:#241733; color:#8d7aab; box-shadow:none; cursor:default; }
  .sds-buy:active:not(:disabled){ transform:scale(.95); }

  /* history */
  .sdh-list{ display:flex; flex-direction:column; gap:5px; margin-top:8px; max-height:300px; overflow-y:auto; }
  .sdh-row{ background:#12101d; border:1px solid #221636; border-radius:9px; padding:7px 10px; }
  .sdh-st{ display:block; font-family:'Orbitron',sans-serif; font-size:8.5px; font-weight:800; letter-spacing:.1em; color:#b79ad6; margin-bottom:2px; }
  .sdh-txt{ font-family:'Rajdhani',sans-serif; font-weight:700; font-size:11.5px; color:#c5b3de; line-height:1.4; }

  /* ===== VOIDMAW grand prize ===== */
  .sd-fight.has-ship{ flex-direction:row; gap:14px; align-items:center; justify-content:center; padding:10px 14px; }
  .sd-fight-ship{ width:74px; height:50px; object-fit:contain; flex:none; filter:drop-shadow(0 0 12px rgba(255,255,255,.55)); animation:sdBossFloat 4.5s ease-in-out infinite; }
  .sd-fight-txt{ display:flex; flex-direction:column; gap:3px; align-items:center; }
  .sd-fight-txt b{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:16px; letter-spacing:.08em; }
  .sd-buyatt{ margin-left:auto; flex:none; border:1px dashed #4a2f78; border-radius:9px; background:rgba(176,77,255,.07); color:#d9c2f2; padding:5px 10px;
    font-family:'Rajdhani',sans-serif; font-weight:800; font-size:11px; cursor:pointer; white-space:nowrap; }
  .sd-buyatt b{ color:#ffd24d; }
  .sd-buyatt:active{ transform:scale(.96); }
  .sd-vm{ display:flex; gap:12px; align-items:center; background:linear-gradient(90deg,#1c1030,#140b22); border:1px solid #4a2f78; border-radius:14px; padding:11px 12px; box-shadow:0 0 20px -8px ${ACCENT}; }
  .sd-vm img{ width:84px; height:60px; object-fit:contain; flex:none; filter:drop-shadow(0 0 12px ${ACCENT}); animation:sdBossFloat 4.5s ease-in-out infinite; }
  .sd-vm-t{ flex:1; min-width:0; }
  .sd-vm-t>b{ display:block; font-family:'Orbitron',sans-serif; font-weight:800; font-size:13px; letter-spacing:.08em; color:#f0dcff; }
  .sd-vm-t span{ display:block; font-family:'Rajdhani',sans-serif; font-weight:600; font-size:13px; color:#c4b2de; line-height:1.45; margin-top:4px; }
  .sd-vm-t span b{ display:inline; font-family:inherit; font-size:inherit; letter-spacing:0; color:#ffd24d; }
  .sd-vm-t em{ display:block; font-style:normal; font-family:'Rajdhani',sans-serif; font-weight:700; font-size:11px; color:#8d7aab; margin-top:3px; }
  .vm-partbar{ position:relative; height:17px; border-radius:9px; background:#241733; border:1px solid #3c2560; overflow:hidden; margin-top:7px; }
  .vm-partbar i{ display:block; height:100%; background:linear-gradient(90deg,#b04dff,#ff4adf); box-shadow:0 0 10px ${ACCENT}; }
  .vm-partbar.done i{ background:linear-gradient(90deg,#2f9e4f,#46d27a); box-shadow:0 0 10px #46d27a; }
  .vm-partbar span{ position:absolute; inset:0; display:grid; place-items:center; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:10px; letter-spacing:.04em; color:#fff; text-shadow:0 1px 3px #000; }
  /* Voidmaw Store featured card */
  .sds-vm{ display:flex; gap:11px; align-items:center; background:linear-gradient(90deg,#241733,#161022); border:1px solid ${ACCENT}; border-radius:13px; padding:10px 11px; margin-top:8px; box-shadow:0 0 22px -8px ${ACCENT}; }
  .sds-vm img{ width:88px; height:62px; object-fit:contain; flex:none; filter:drop-shadow(0 0 14px ${ACCENT}); animation:sdBossFloat 4.5s ease-in-out infinite; }
  .sds-vm-t{ flex:1; min-width:0; }
  .sds-vm-t b{ display:block; font-family:'Orbitron',sans-serif; font-weight:800; font-size:12px; letter-spacing:.08em; color:#f0dcff; }
  .sds-vm-t > span{ display:block; font-family:'Rajdhani',sans-serif; font-weight:600; font-size:10px; color:#a695c2; margin-top:2px; line-height:1.35; }
  .sds-assemble{ flex:none; border:none; border-radius:10px; padding:12px 13px; font-family:'Orbitron',sans-serif; font-weight:800; font-size:11px; letter-spacing:.06em; color:#08131c;
    background:linear-gradient(180deg,#7ce0a0,#2f9e4f); cursor:pointer; box-shadow:0 6px 16px -6px #46d27a; animation:sdLivePulse 1.6s ease-in-out infinite; }
  .sds-assemble:active{ transform:scale(.96); }
  /* Hangar ship card (event exclusive) */
  .ship-card.vm{ border-color:rgba(176,77,255,.55)!important; box-shadow:0 0 22px -10px ${ACCENT}; }
  .apex-chip.vm{ background:linear-gradient(90deg,#b04dff,#ff4adf); color:#fff; }
  .ship-btn.vmbuy{ background:linear-gradient(180deg,#c95bff,#8422d8)!important; color:#fff!important; border:none!important; box-shadow:0 5px 14px -6px ${ACCENT}; }
  .ship-btn.vmbuy:active{ transform:scale(.95); }
  .vm-desc{ font-family:'Rajdhani',sans-serif; font-size:11.5px; font-weight:600; color:#b3a4cb; line-height:1.45; margin-top:8px; }
  .vm-note{ font-family:'Rajdhani',sans-serif; font-size:11px; font-weight:700; color:#d9c2f2; background:rgba(176,77,255,.08); border:1px solid rgba(176,77,255,.35); border-radius:10px; padding:8px 10px; margin-top:8px; line-height:1.45; }
  .vm-note b{ color:#ffd24d; }
  .vm-note.owned{ color:#7ce0a0; background:rgba(70,210,122,.07); border-color:rgba(70,210,122,.3); }
  /* Command-card boss art */
  .mega-card.cmd-sdread .mc-ic.mc-vm{ padding:3px; }
  .mega-card.cmd-sdread .mc-ic.mc-vm img{ width:100%; height:100%; object-fit:contain; filter:drop-shadow(0 0 7px rgba(176,77,255,.9)); }
  `;

  // ---- BOOT (must stay LAST) ------------------------------------------------
  // boot() reads the CSS const declared above it; calling it from the module body
  // hit the temporal dead zone and aborted the script before window exports ran,
  // so the screen silently painted nothing on a late parse. Keep this at the end.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  setTimeout(boot, 1200);
})();
