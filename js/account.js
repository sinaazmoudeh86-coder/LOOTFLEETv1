/* =============================================================================
   account.js — accounts, per-user saves, and cloud-sync hook
   ---------------------------------------------------------------------------
   Each signed-in account gets its OWN save (namespaced by username), so two
   logins on the same browser are fully separate worlds. Saves are written to
   localStorage immediately; if a cloud BACKEND is configured they are also
   pushed to your server so the same account roams across devices.

   To enable real cross-device accounts, deploy the companion API and set
   BACKEND.url below (see the server scaffold / README). Until then the game
   runs fully client-side with per-account local saves.

   Exposes window.ACCOUNT. Must load BEFORE js/game.js.
   ============================================================================= */
(function () {
  'use strict';
  const SESS = 'io-auth';
  const BASE = 'infinite-operator-save-v2';

  // Cloud sync runs through window.CLOUD (Supabase) when configured; otherwise
  // everything stays local & per-browser.
  function cloudOn() { return !!(window.CLOUD && window.CLOUD.enabled); }

  // SESSION PINNING — a tab serves ONE account for its whole life. io-auth is
  // shared by every tab of the browser, so re-reading it live meant a second
  // login in another tab silently re-pointed this tab's save key: account A's
  // in-flight state then wrote into account B's slot. The pin freezes the
  // identity at first read; if the stored session later names someone else,
  // this tab stops writing and shows the takeover screen instead of following.
  let _pin = null, _pinChecked = 0;
  function readSess() { try { return JSON.parse(localStorage.getItem(SESS)); } catch (e) { return null; } }
  function sameAcct(a, b) {
    if (!a || !b) return !a === !b;
    if (a.id || b.id) return a.id === b.id;
    return (a.name || '') === (b.name || '');
  }
  function session() {
    if (_pin) {
      const now = Date.now();
      if (now - _pinChecked > 1000) {   // cheap drift check: another account signed in on this browser
        _pinChecked = now;
        const live = readSess();
        if (live && !sameAcct(live, _pin)) {
          try { if (window.SESSIONLOCK && !window.__sessionKicked) window.SESSIONLOCK.kick('account'); } catch (e) {}
        }
      }
      return _pin;
    }
    _pin = readSess(); _pinChecked = Date.now();
    return _pin;
  }
  function repin() { _pin = readSess(); _pinChecked = Date.now(); return _pin; }
  function uid() {
    const s = session();
    if (s && s.id) return 'u_' + s.id;   // stable Supabase user id
    return s && s.name ? s.name.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_.-]/g, '') : 'guest';
  }
  function key() { return BASE + '::' + uid(); }
  function current() { return session(); }

  // ---- local persistence ----------------------------------------------------
  function load() { try { return JSON.parse(localStorage.getItem(key())); } catch (e) { return null; } }
  function saveLocal(state) { try { localStorage.setItem(key(), JSON.stringify(state)); } catch (e) {} }

  // ---- cloud push (debounced; inert unless a cloud user is signed in) --------
  // Local saves are instant; CLOUD writes are batched to ~1 per 8s. A final
  // flush fires when the tab hides/closes. Writes are BLOCKED until the cloud
  // copy has been successfully fetched this session — a device that never
  // managed to pull must never clobber the server save with stale state.
  let pending = null, timer = 0, lastSent = '', _pullOk = false, _cloudWeight = 0;
  let _rev = null;          // revision of the cloud row this device last saw (CAS)
  let _casOn = false;       // save-cas.sql present — concurrent writes are safe
  let _retry = 0;
  // "How much life is in this save?" — playtime + kills + levels. Used to stop
  // fresh-boot states from ever outranking a real account by timestamp alone.
  // v2 (SinaNoCheats incident): playtime alone could outweigh real power — a
  // low-level phone idling with the tab open beat a billions-strong browser
  // save. Weight now reads the POWER signals too: log-gold (economy is
  // exponential), deepest zone, hull upgrade levels, ascension investment.
  // The pilot-ascension RESET EPOCH carried by a save. Bumped by the one-time
  // migration in game-v93.js; compared here above every other progression signal.
  function pascEpoch(s) { try { return (s && s.pasc && (s.pasc.epoch | 0)) || 0; } catch (e) { return 0; } }
  function saveWeight(s) {
    if (!s) return 0;
    let hull = 0; try { const sl = s.shipLevels || {}; for (const k in sl) hull += sl[k] || 0; } catch (e) {}
    let asc = 0; try { const a = s.ascension || {}; for (const sh in a) { const mods = a[sh]; for (const m in mods) { const md = mods[m] || {}; asc += (md.t | 0) * 250 + (md.s | 0) * 50 + Math.max(0, (md.l | 0) - 1) * 10; } } } catch (e) {}
    // PILOT ASCENSION STARS DOMINATE EVERYTHING ELSE (Aug 2026 — the "105 DDc
    // gold came back after I ascended and relogged" bug). An ascension resets
    // level to 1 and gold to 0, so a freshly-ascended save WEIGHS LESS than the
    // pre-ascension copy on every other signal — and mergeSaves' progression
    // -first rule then restored the old copy wholesale on the next login,
    // handing back the gold and undoing the ascension. Stars are strictly
    // monotonic (only ascending changes them), so one star must outrank any
    // amount of gold, level or zone. Same term fixes the best-ever vault, which
    // otherwise kept offering the pre-ascension save as the "heaviest" copy.
    const stars = (s.pasc && (s.pasc.stars | 0)) || 0;
    // NANOCORES — a real progression axis bought with Prism Ingots, so a save
    // that holds cores and unlocked buff slots must not lose to one that does
    // not. Weighted like hull levels (below stars, above gold): a core is cheap,
    // an unlocked slot is five successful upgrades and costs real ingots.
    let nano = 0;
    try { const cs = (s.nano && s.nano.cores) || {}; for (const k in cs) { const c = cs[k] || {}; nano += 40 + (c.slots | 0) * 300 + (c.stage | 0) * 40; } } catch (e) {}
    // RESET EPOCH OUTRANKS EVERYTHING, INCLUDING STARS (Aug 2026, the global
    // pilot-ascension reset). Every rule below and in mergeSaves() exists to stop
    // ascension progress from regressing, which is correct for a normal timeline
    // and fatal for a deliberate wipe: a 0-star reset save loses to the pre-reset
    // cloud copy on the star tiebreak and the reset is undone at the next login.
    // The epoch only ever increases, so a save that has been through the reset is
    // unambiguously the later timeline. 1e12 dwarfs the star term (20 stars = 1e8)
    // by four orders, so it also re-bases the best-ever vault for free — otherwise
    // Save Recovery would keep offering the pre-reset copy as the heaviest ever.
    return pascEpoch(s) * 1e12
      + stars * 5e6
      + (s.playTime || 0) + (s.totalKills || 0) * 10 + (s.level || 1) * 3600
      + Math.log10(1 + Math.max(0, s.gold || 0)) * 7200
      + Math.max(s.highestDungeonReached | 0, s.highestUnlocked | 0) * 1800
      + hull * 900 + asc * 60 + nano;
  }
  // BEST-EVER VAULT — every ~45s the heaviest save this account has ever had on
  // this device is copied to lf-best::<uid>. Max-only: weaker data never touches
  // it, and kicked tabs still write it (it's the rescue copy). Save Recovery
  // (Account sheet) lists it for one-tap restore.
  let _vaultAt = 0;
  function vault(state, force) {
    try {
      if (!state) return;
      if (!force && Date.now() - _vaultAt < 45000) return;
      const w = saveWeight(state), kw = 'lf-bestw::' + uid();
      if (w < (parseFloat(localStorage.getItem(kw)) || 0)) return;
      _vaultAt = Date.now();
      localStorage.setItem('lf-best::' + uid(), JSON.stringify(state));
      localStorage.setItem(kw, String(w));
    } catch (e) {}
  }
  function push(state) {
    vault(state);                         // rescue copy FIRST — even a kicked tab keeps its strongest save reachable
    if (window.__sessionKicked) return;   // kicked by a newer login — stop ALL writes (local too: same-browser tabs share this slot)
    if (window.SESSIONLOCK && window.SESSIONLOCK.canWrite && !window.SESSIONLOCK.canWrite()) return;   // background-opened tab that never claimed: stay inert until visible
    // stamp the save with MY session lock — the cloud row always names the
    // device that last owned the account (offline-takeover detection reads it)
    try { const li = window.SESSIONLOCK && window.SESSIONLOCK.lockInfo && window.SESSIONLOCK.lockInfo(); if (li && li.at) state._lock = { dev: li.dev, at: li.at }; } catch (e) {}
    saveLocal(state);
    if (!cloudOn()) return;
    const s = session();
    if (!s || !s.id) return;            // only signed-in cloud users sync
    if (!_pullOk) return;               // cloud copy unverified — keep writes local
    if (_cloudWeight > 0 && saveWeight(state) < _cloudWeight * 0.2) return;   // CLOBBER GUARD: never overwrite a heavy cloud save with a near-fresh state
    pending = state;
    if (!timer) timer = setTimeout(flush, 8000);
  }
  function flushNow() { try { if (pending) flush(); } catch (e) {} }
  async function flush() {
    clearTimeout(timer); timer = 0;
    if (window.__sessionKicked) return;
    if (!cloudOn() || !pending) return;
    const s = session(); const data = pending; pending = null;
    if (!s || !s.id) return;
    // DIRTY CHECK — idle players (tab open, nothing changing) write NOTHING.
    let ser = '';
    try { ser = JSON.stringify(data); } catch (e) {}
    if (ser && ser === lastSent) return;

    // ---- COMPARE-AND-SET WRITE ---------------------------------------------
    // The row can only be replaced from the revision this device last read. If
    // another device moved it on, the write is REFUSED and we get their row
    // back: merge it with ours, quarantine whichever timeline loses, retry.
    if (_casOn && window.CLOUD.pushSave) {
      let payload = data, rev = _rev;
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await window.CLOUD.pushSave(s.id, payload, rev);
        if (r && r.ok) {
          _rev = r.rev; _cloudWeight = saveWeight(payload);
          try { lastSent = JSON.stringify(payload); } catch (e) {}
          saveLocal(payload);
          publishLb(s, payload);
          _retry = 0;
          return;
        }
        if (r && r.unsupported) { _casOn = false; break; }          // migration not run — legacy path
        if (!r || !r.conflict) {                                     // network/RPC failure — keep the data, try later
          pending = payload;
          if (!timer) timer = setTimeout(flush, Math.min(60000, 8000 * Math.pow(2, Math.min(3, _retry++))));
          return;
        }
        // CONFLICT — another device advanced the row while we played
        const theirs = r.data, mineW = saveWeight(payload), theirW = saveWeight(theirs);
        const merged = mergeSaves(payload, theirs) || payload;
        // the timeline that did NOT become the merge base is preserved, never dropped
        try {
          const loser = theirW < mineW ? theirs : payload;
          if (loser && Math.min(mineW, theirW) > 0 && window.CLOUD.saveConflict) {
            window.CLOUD.saveConflict(s.id, loser, 'concurrent-session', Math.min(mineW, theirW));
          }
          localStorage.setItem('lf-conflict::' + uid(), JSON.stringify({ at: Date.now(), mine: mineW, theirs: theirW, data: loser }));
        } catch (e) {}
        saveLocal(merged);
        payload = merged; rev = r.rev;
        if (window.GAME && window.GAME.adoptSave) { try { window.GAME.adoptSave(merged); } catch (e) {} }
      }
      if (_casOn) { pending = payload; if (!timer) timer = setTimeout(flush, 12000); return; }
    }

    // ---- legacy path (save-cas.sql not installed) ---------------------------
    lastSent = ser;
    await window.CLOUD.push(s.id, data);
    publishLb(s, data);
  }
  // ---- LEADERBOARD HEARTBEAT --------------------------------------------------
  // The public row used to be published ONLY from a successful save write, so
  // any guard that blocked the save pipeline also made the player invisible on
  // the Ranks board — permanently, and silently. All of these do it:
  //   • !_pullOk (one failed pull at login blocks cloud writes for the session)
  //   • the CLOBBER GUARD — weight < 20% of the cloud copy. An ascension craters
  //     weight (level→1, gold→0, zone→1), so ascending could mute a pilot.
  //   • SESSIONLOCK.canWrite() false, or an unresolved CAS conflict
  // Alliance membership and territory claims go through their own RPCs and need
  // no leaderboard row, so a player could be fully active — in an alliance,
  // holding tiles — and still absent from the board. (Reported: "Falcor is in
  // the game but not on the leaderboard.")
  //
  // The row is a PUBLIC SUMMARY: no merge semantics, no clobber risk, and the
  // upsert is idempotent. It has no business riding on the save pipeline, so it
  // now publishes on its own heartbeat as well.
  // KICKED TABS STILL PUBLISH (Aug 2026 — "Falcor is in the game taking tiles and
  // still isn't on the board"). The session lock exists to stop a stale tab
  // CLOBBERING a save. The public row is not a save: no merge semantics, no
  // clobber risk, idempotent, and the live session overwrites it within 90s.
  // Meanwhile TERRITORY.claim() has never had a lock guard, so a kicked or
  // never-claimed tab could conquer the map all day and stay invisible on Ranks
  // — exactly the asymmetry reported. A kicked tab now publishes ONCE (enough to
  // seed a missing row) and then stops, so it can never flap the board.
  let _kickedPub = false;
  function publishNow() {
    try {
      if (!cloudOn()) return false;
      if (window.__sessionKicked) { if (_kickedPub) return false; _kickedPub = true; }
      const s = session(); if (!s || !s.id) return false;
      const g = window.GAME; if (!g || !g.state || !g.state.level) return false;
      publishLb(s, g.state);
      return true;
    } catch (e) { return false; }
  }
  // Visible within seconds of arriving — but `rt.stats` may not exist yet at 6s,
  // and publishLb now declines to publish an unusable power rather than writing a
  // zero that would sort the pilot off the board. Two cheap retries cover the
  // gap so a slow boot costs seconds of absence instead of a full 90s heartbeat.
  setTimeout(publishNow, 6000);
  setTimeout(publishNow, 16000);
  setTimeout(publishNow, 35000);
  setInterval(publishNow, 90000);          // and kept current regardless of saves

  // public leaderboard row (non-sensitive fields)
  // ASCENSION STARS (fixed Jul 2026): this publisher never sent `asc`, so every
  // row in the leaderboard table was written with p_asc = 0. Your own badge came
  // from local state, which is why only YOUR stars ever showed on the Ranks page
  // \u2014 every other pilot, ascended or not, published a zero. Read it from the save
  // blob, with the live module as a fallback.
  // PUBLISHED POWER IS THE SORT KEY for the whole leaderboard, and the row is a
  // full overwrite — so ONE bad reading makes the pilot vanish.
  // G.score() returns 0 whenever `rt.stats` has not been computed yet (the 6s
  // post-arrival publish, a fresh zone load, the moments after an ascension or a
  // respawn rebuilds stats). The guard below was `(G && G.score) ? G.score() : …`
  // — which tests whether the FUNCTION EXISTS, not whether its RESULT is usable.
  // It does exist, so a 0 went straight to the server, the row sorted last on
  // `order('power', desc).limit(100)`, and the pilot dropped off Ranks until the
  // next heartbeat 90 seconds later. That is the "randomly disappears" report.
  // Last good value wins; if there has never been one, the row is not published
  // at all rather than published as a zero.
  let _lastPower = 0;
  function publishLb(s, data) {
    try {
      if (window.CLOUD.lbUpsert) {
        const G = window.GAME;
        let power = 0;
        try { power = (G && G.score) ? Number(G.score()) : 0; } catch (e) { power = 0; }
        if (!isFinite(power) || power <= 0) power = 0;
        if (power > 0) _lastPower = power;
        else power = _lastPower;
        // Still nothing usable. A pilot with a level or kills behind them HAS a
        // power; publishing 0 for them is strictly worse than publishing nothing,
        // because it overwrites a good row with one that sorts last.
        if (power <= 0 && ((data.level || 1) > 1 || (data.totalKills || 0) > 0)) return;
        let asc = (data && data.pasc && data.pasc.stars) | 0;
        if (!asc) { try { asc = window.PASCEND ? (window.PASCEND.stars() | 0) : 0; } catch (e) {} }
        // LADDER COLUMNS (Aug 2026) — territory revenue, hangar size, lifetime
        // missions and badges, for the six new Ranks boards. Read through
        // RANKBOARDS so the published figures and the ones your own row renders
        // come from one place and can never disagree. Omitted entirely if the
        // module hasn't loaded: lb_upsert treats null as "leave alone", so a
        // missing field never zeroes a veteran's career counters.
        let extra = null;
        try { extra = window.RANKBOARDS ? window.RANKBOARDS.publishFields() : null; } catch (e) {}
        window.CLOUD.lbUpsert(Object.assign({
          name: s.name,
          power: power || (data.level || 1),
          level: data.level || 1, zone: data.highestDungeonReached || 1, kills: data.totalKills || 0,
          asc,
          fleet: [data.ship].concat((G && G.fleetShips) ? G.fleetShips().map((x) => x.key) : []).filter(Boolean),
        }, extra || {}));
      }
    } catch (e) {}
  }
  // don't lose the last batch when the player leaves
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  // WAKE CHECK — a device that slept through the live kick (Realtime doesn't
  // queue for sleepers) asks the server who owns the account now.
  // With the lease installed the SERVER decides (touch_session compares its own
  // now()); the legacy _lock comparison below is client-clock based and only
  // runs when the lease RPCs aren't available.
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || window.__sessionKicked) return;
    if (!cloudOn()) return;
    const s = session(); if (!s || !s.id || !window.SESSIONLOCK) return;
    try {
      if (window.SESSIONLOCK.leaseOn && window.SESSIONLOCK.leaseOn() && window.CLOUD.touchSession) {
        const me = window.SESSIONLOCK.deviceId();
        const r = await window.CLOUD.touchSession(me);
        if (r && r.ok && !r.mine && r.owner && r.owner !== me) window.SESSIONLOCK.kick('device');
        return;   // the lease is authoritative — never second-guess it with local clocks
      }
      const res = window.CLOUD.pullMeta ? await window.CLOUD.pullMeta(s.id) : null;
      const rl = res && res.ok && res.data && res.data._lock;
      const li = window.SESSIONLOCK.lockInfo();
      if (rl && li.at && rl.dev !== li.dev && rl.at > li.at) { window.SESSIONLOCK.kick('device'); return; }
      window.SESSIONLOCK.claim();
    } catch (e) {}
  });
  // pull the authoritative cloud save — MERGED, never a blind overwrite.
  // Base = whichever copy is newer (lastSave stamp); entitlements that must
  // never regress (Pro time, purchases, owned ships, blueprints, cosmetics)
  // are UNIONED in from the older copy. Fixes "Pro/credits gone the next day"
  // — a stale cloud copy can no longer erase a newer local save, and vice versa.
  function mergeSaves(local, cloud) {
    if (!cloud) return local || null;
    if (!local) return cloud;
    // BASE PICK — PROGRESSION FIRST (Jul 2026, the SinaNoCheats incident): the
    // clearly-more-progressed copy wins no matter whose timestamp is newer — a
    // low-level phone can no longer clobber a billions-strong browser save just
    // by having played last. Timestamps only break ties between copies of
    // comparable weight (within ×1.3), i.e. devices genuinely taking turns.
    const wl = saveWeight(local), wc = saveWeight(cloud);
    let base, other;
    // RESET EPOCH IS THE FIRST TIEBREAK, ABOVE STARS. See saveWeight(). A global
    // ascension reset makes progress legitimately go DOWN, which every rule here
    // is built to prevent; the epoch is the one signal that says "this regression
    // was intentional, and it is the newer timeline".
    const el = pascEpoch(local), ec = pascEpoch(cloud);
    const sl = (local.pasc && (local.pasc.stars | 0)) || 0;
    const sc = (cloud.pasc && (cloud.pasc.stars | 0)) || 0;
    if (el !== ec) { base = el > ec ? local : cloud; other = base === local ? cloud : local; }
    else if (sl !== sc) { base = sl > sc ? local : cloud; other = base === local ? cloud : local; }
    else if (wl > wc * 1.3) { base = local; other = cloud; }
    else if (wc > wl * 1.3) { base = cloud; other = local; }
    else { base = (cloud.lastSave || 0) >= (local.lastSave || 0) ? cloud : local; other = base === cloud ? local : cloud; }
    base.proUntil = Math.max(base.proUntil || 0, other.proUntil || 0);
    // 10× BATTLE SPEED IS AN ENTITLEMENT, NOT A SETTING. `secretSpeed` is a bare
    // boolean rather than a key inside `purchases`, so it was missed by the union
    // below and a stale cloud copy from before the Mothership easter egg would
    // erase it — the same class of bug as "Pro/credits gone the next day". Once
    // it is false, sanitizeSave() demotes gameSpeed off 10× and the tier pill
    // disappears from the HUD, which is what players report as "it stopped
    // working and dropped me to 5×". Union it: earned once, earned for good.
    base.secretSpeed = !!(base.secretSpeed || other.secretSpeed);
    ['purchases', 'ownedShips', 'blueprints'].forEach((k) => {
      if (!other[k]) return;
      base[k] = base[k] || {};
      for (const id in other[k]) if (other[k][id] && !base[k][id]) base[k][id] = other[k][id];
    });
    // PERMANENT PROGRESSION — monotonic counters can never regress through a
    // stale copy: Home Citadel wave + buildings, lifetime missions, season damage.
    if (other.homecit) {
      if (!base.homecit) base.homecit = other.homecit;
      else {
        base.homecit.wave = Math.max(base.homecit.wave | 0, other.homecit.wave | 0);
        base.homecit.cit = Math.max(base.homecit.cit | 0, other.homecit.cit | 0);
        const bb = base.homecit.b || {}, ob = other.homecit.b || {};
        ['mine', 'silo', 'turret', 'repair'].forEach((k) => { bb[k] = Math.max(bb[k] | 0, ob[k] | 0); });
        base.homecit.b = bb;
        // defense towers — per-pad: keep the stronger build (never lose a tower)
        const bt = base.homecit.tw || [], ot = other.homecit.tw || [];
        for (let i = 0; i < 8; i++) { const a = bt[i], o = ot[i]; if (!a) bt[i] = o || null; else if (o && (o.lv | 0) > (a.lv | 0)) bt[i] = o; }
        base.homecit.tw = bt;
      }
    }
    base.lifetimeMissions = Math.max(base.lifetimeMissions | 0, other.lifetimeMissions | 0);
    base.vipPts = Math.max(base.vipPts | 0, other.vipPts | 0);   // ⚜ VIP points never regress
    // ASCENSION RECORD never regresses either — but ONLY the record, never the
    // run it reset (gold, level, inventory stay with whichever copy is base).
    //
    // ASCENSION POINTS ARE A BALANCE, NOT A RECORD (Aug 2026 — "ascend, spend the
    // 90 points, log in on another device and the 90 points come back, and the
    // perks I bought with them stay"). This line used to read
    //     base.pasc.pts = Math.max(base.pasc.pts, other.pasc.pts)
    // and `pts` is the UNSPENT WALLET: buyPerk() does `pts -= cost; spent += cost;
    // perks[k]++`. Maxing a wallet against a copy that had not spent yet refunds
    // every point while the perks bought with them ride along in `perks` — free
    // money, repeatable on every relog. `spent` and `perks` were not unioned at
    // all, so the mirror case silently DELETED purchased perks instead.
    //
    // The only monotonic quantity here is LIFETIME EARNED, and the ledger already
    // defines it (achievements reads "points earned" as pts + spent). So union the
    // earned total and the perk ranks, then DERIVE the wallet from the perks the
    // pilot actually owns. Idempotent by construction — merging the result again
    // produces the same numbers, which is what kills the repeat.
    if (other.pasc && base.pasc && el === ec) {
      const bp = base.pasc, op = other.pasc;
      bp.stars = Math.max(bp.stars | 0, op.stars | 0);
      // 1 — lifetime earned: only an ascension ever adds to it
      let earned = Math.max((bp.pts | 0) + (bp.spent | 0), (op.pts | 0) + (op.spent | 0));
      // 2 — perk ranks: never lose a rank a pilot paid for, from either timeline
      const perks = Object.assign({}, op.perks || {});
      for (const k in (bp.perks || {})) perks[k] = Math.max(perks[k] | 0, bp.perks[k] | 0);
      bp.perks = perks;
      // 3 — spend recomputed from those ranks. Rank r→r+1 costs r+1 (pilot-
      //     ascension.js rankCost), so reaching rank R costs R(R+1)/2.
      let spent = 0;
      for (const k in perks) { const R = Math.max(0, perks[k] | 0); spent += R * (R + 1) / 2; }
      // 4 — two devices spending the same points offline into DIFFERENT perks can
      //     make the union cost more than was ever earned. Keep the perks and
      //     record the debt as earned rather than leaving the ledger negative:
      //     bounded, one-time, and it cannot recur once written.
      earned = Math.max(earned, spent);
      bp.spent = spent;
      bp.pts = Math.max(0, earned - spent);
      // event/premium hulls kept through a reset — an entitlement list, so union it
      if (op.entitled) bp.entitled = Array.from(new Set((bp.entitled || []).concat(op.entitled)));
      // keep the longer ascension log (display only)
      if ((op.hist || []).length > (bp.hist || []).length) bp.hist = op.hist;
    } else if (other.pasc && base.pasc && el !== ec) {
      // EPOCHS DIFFER — the reset already ran on `base`. Union NOTHING from the
      // pre-reset copy except the entitlement list: stars, points and perk ranks
      // are exactly what the reset removed, and every max/union rule above would
      // hand them straight back. Entitlements are event and premium hulls, some
      // bought with real money, and are kept by design.
      if (other.pasc.entitled) {
        base.pasc.entitled = Array.from(new Set((base.pasc.entitled || []).concat(other.pasc.entitled)));
      }
    } else if (other.pasc && !base.pasc) base.pasc = other.pasc;
    // PILOT LEVEL NEVER REGRESSES (Aug 2026 — "logged out and came back ~70 levels
    // lower"). Level, xp and the points they buy were the only progression signals
    // missing from this union, and they are near-invisible to the base pick as
    // well: on an ascended account one star is worth 5e6 weight, so a 70-level gap
    // (252K) sits deep inside the ×1.3 band, the tie falls to `lastSave`, and a
    // stale copy legitimately wins the merge and silently rolls the levels back.
    // Level only drops for ONE legitimate reason — a pilot ascension — and that is
    // already caught by the star tiebreak above, so when the stars match the
    // higher level is always the true one. Restored levels re-credit their skill
    // points (levelUp() grants pointsPerLevel each); points are NOT maxed on their
    // own, or a copy that had already spent them into `skills` would double-dip.
    // A RESET EPOCH ALSO CLAMPS THE LEVEL, so this must not run across epochs
    // either — the pre-reset copy is hundreds of levels higher by definition and
    // would restore every one of them, and their skill points with them.
    if (el === ec && sl === sc && (other.level | 0) > (base.level | 0)) {
      let ppl = 1;
      try { ppl = (window.CONFIG && window.CONFIG.SKILLS && window.CONFIG.SKILLS.pointsPerLevel) || 1; } catch (e) {}
      const regained = (other.level | 0) - (base.level | 0);
      base.level = other.level | 0;
      base.xp = Math.max(base.xp || 0, other.xp || 0);
      base.skillPoints = (base.skillPoints | 0) + regained * ppl;
    }
    // lifetime tallies exist on both timelines — keep the larger of each
    base.totalKills = Math.max(base.totalKills || 0, other.totalKills || 0);
    base.playTime = Math.max(base.playTime || 0, other.playTime || 0);
    base.itemsFound = Math.max(base.itemsFound || 0, other.itemsFound || 0);
    base.lifetimeLooted = Math.max(base.lifetimeLooted || 0, other.lifetimeLooted || 0);
    base.highestDungeonReached = Math.max(base.highestDungeonReached || 1, other.highestDungeonReached || 1);
    base.highestUnlocked = Math.max(base.highestUnlocked || 1, other.highestUnlocked || 1);
    // SEASON 1: VOIDMAW — merged FIELD BY FIELD. Taking one copy whole and maxing
    // only total/bestEver let a stale copy win the pick and carry a `bestDay` of 0
    // and a fresh `att` for a day the pilot had already spent: he burned every
    // attempt, then vanished from the daily board and settled for no reward
    // (settleLeaderboard returns early on a zero bestDay). bestDay/att/buys belong
    // to ONE DAY, so they only combine when both copies are on the same day —
    // otherwise the LATER day owns them outright. `claims` is deliberately left to
    // the base copy: it holds unspent prizes, and unioning it can pay twice.
    if (other.sdread && base.sdread) {
      const b = base.sdread, o = other.sdread;
      b.total = Math.max(b.total || 0, o.total || 0);
      b.bestEver = Math.max(b.bestEver || 0, o.bestEver || 0);
      b.bestStage = Math.max(b.bestStage || 0, o.bestStage || 0);
      b.shards = Math.max(b.shards || 0, o.shards || 0);
      b.runs = Math.max(b.runs || 0, o.runs || 0);
      b.partDay = Math.max(b.partDay | 0, o.partDay | 0);   // first-fight bonus never pays twice
      if (o.vmGranted) b.vmGranted = true;
      const bd = b.day | 0, od = o.day | 0;
      if (od > bd) {
        b.day = od; b.bestDay = o.bestDay || 0;
        b.att = o.att | 0; b.buys = o.buys | 0;
        b.lbRank = o.lbRank || null;
      } else if (od === bd) {
        b.bestDay = Math.max(b.bestDay || 0, o.bestDay || 0);
        b.att = Math.max(b.att | 0, o.att | 0);              // an attempt spent stays spent
        b.buys = Math.max(b.buys | 0, o.buys | 0);
        if (!b.lbRank && o.lbRank) b.lbRank = o.lbRank;
      }
      if ((o.hist || []).length > (b.hist || []).length) b.hist = o.hist;
    } else if (other.sdread && !base.sdread) base.sdread = other.sdread;
    // NANOCORES — MERGED FIELD BY FIELD (Aug 2026 — "all my nanocores are gone,
    // complete wipe"). Everything ELSE about the account looked right, which is
    // the signature of a system that lives entirely inside the base copy: the bag
    // rode along with whichever timeline won the pick, and the losing timeline's
    // cores went into the conflict quarantine with it. Not one of the union rules
    // above ever mentioned `nano`, so it was the last real progression axis being
    // decided wholesale.
    //
    // saveWeight() does count cores, but a 30-core bag is worth ~5K against
    // log-gold's 7.2K per decade and 5e6 per star — it cannot flip the pick, so
    // the pick had to stop being able to lose them.
    //
    // Reported "after ascension" because that is exactly when a save legitimately
    // gets LIGHTER (level 1, gold 0, zone 1) and when players relog and change
    // device — the two conditions that hand the pick to the star tiebreak instead
    // of to weight. The ascension itself never took the bag: `nano` is in
    // ASC_KEEP and pilotAscend() restores it.
    if (other.nano && other.nano.cores) {
      base.nano = base.nano || {};
      const bn = base.nano, on = other.nano;
      bn.cores = bn.cores || {}; bn.dupes = bn.dupes || {}; bn.equip = bn.equip || {};
      // DEPTH DECIDES AND A CORE IS TAKEN WHOLE. slots, then stage — the exact
      // order ingots were spent in. Buff arrays are never blended: rerolls and
      // locks are choices, and mixing two timelines' rolls would hand back a core
      // neither timeline ever actually had.
      const depth = (c) => (c ? (c.slots | 0) * 100 + (c.stage | 0) : -1);
      for (const id in on.cores) {
        const oc = on.cores[id]; if (!oc) continue;
        if (depth(oc) > depth(bn.cores[id])) bn.cores[id] = oc;
      }
      // Dupes are a 10:1 exchange BALANCE, so maxing them can in principle let
      // two offline devices spend the same ten twice — bounded and minor. Eating
      // dupes a player earned is neither.
      for (const r in (on.dupes || {})) bn.dupes[r] = Math.max(bn.dupes[r] | 0, on.dupes[r] | 0);
      bn.opened = Math.max(bn.opened | 0, on.opened | 0);
      // An equipped rarity is only meaningful if that core survived the union, and
      // a core adopted from `other` for a hull with nothing equipped pays nothing
      // until it is switched on. Fill from other first, drop anything now dangling,
      // then equip the STRONGEST surviving core on any hull still empty.
      for (const sh in (on.equip || {})) if (!bn.equip[sh]) bn.equip[sh] = on.equip[sh];
      for (const sh in bn.equip) if (!bn.cores[sh + '|' + bn.equip[sh]]) delete bn.equip[sh];
      let order = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
      try { if (window.NANO && window.NANO.RKEYS && window.NANO.RKEYS.length) order = window.NANO.RKEYS; } catch (e) {}
      // ONLY hulls left with nothing equipped. `filled` marks the ones THIS pass
      // seeded, so the rarity preference can improve its own choice and can never
      // reach a selection the player made: an Epic with four unlocked slots and
      // good rolls legitimately beats a fresh 0-slot Legendary, and equipping it
      // is a decision, not a mistake to be corrected on every login.
      const filled = {};
      for (const id in bn.cores) {
        const c = bn.cores[id] || {};
        const sh = c.ship || id.split('|')[0], r = c.r || id.split('|')[1];
        if (!sh || !r) continue;
        if (bn.equip[sh] && !filled[sh]) continue;
        if (!bn.equip[sh] || order.indexOf(r) > order.indexOf(bn.equip[sh])) { bn.equip[sh] = r; filled[sh] = 1; }
      }
    } else if (other.nano && !base.nano) base.nano = other.nano;
    // LIFETIME COUNTERS — strictly monotonic by construction (bumpLife only ever
    // adds), and they are what badges, missions and the Discord feed read. Same
    // wholesale-loss problem as the bag above: nanoLegend, nanoGod and nanoOpened
    // all regressed with a lost pick, un-earning badges that had been posted.
    if (other.lifeStats) {
      base.lifeStats = base.lifeStats || {};
      for (const k in other.lifeStats) base.lifeStats[k] = Math.max(base.lifeStats[k] || 0, other.lifeStats[k] || 0);
    }
    // =========================================================================
    // BUILT INFRASTRUCTURE — the other half of the rule this function states.
    //
    // The union list above covers ENTITLEMENTS (hulls, blueprints, purchases,
    // cosmetics, nanocores, lifetime counters, the ascension record). It did NOT
    // cover anything the pilot BUILT: hull upgrade levels, Ship Ascension modules,
    // the Pilot Tree, Starforge tempers, the Moon Colony, Prism, badge claims and
    // territory. Every one of those was decided WHOLESALE by the base pick, so the
    // losing copy's version was simply gone.
    //
    // That contradicts two things the game states in writing: this function's own
    // rule ("KEPT is anything you BUILT"), and the Pilot Ascension screen, which
    // promises "every hull, every hull upgrade level, and every Ship Ascension"
    // survives. And the base pick cannot be relied on to protect them: one
    // ascension star is 5e6 of weight, so a fleet-wide difference of dozens of hull
    // levels sits deep inside the ×1.3 tie band and loses to a stale `lastSave`.
    //
    // EVERYTHING BELOW IS MONOTONIC BY CONSTRUCTION — these values only ever go up
    // through play, and nothing in the game refunds them — so `Math.max` is exact,
    // not a guess, and merging twice produces the same numbers.
    //
    // NONE OF IT IS CLEARED BY A PILOT ASCENSION OR THE EPOCH RESET, which is why
    // these unions run unguarded — checked against ASC_KEEP and the PASC_EPOCH
    // migration one by one. TERRITORY IS THE EXCEPTION and carries an `el === ec`
    // guard; see the note on it below. Anything added here later must be checked the
    // same way: if a reset destroys it, unioning it undoes the reset.
    //
    // DELIBERATELY NOT UNIONED: gold, credits, resources, dreadCores and Prism
    // ingots. Those are SPENDABLE WALLETS, and maxing a wallet against a copy that
    // has not spent yet is the duplication bug the `pasc.pts` block above exists to
    // undo. They stay with the base copy.

    // ---- hull upgrade levels: one number per hull, bought with gold, never refunded
    if (other.shipLevels) {
      base.shipLevels = base.shipLevels || {};
      for (const k in other.shipLevels) base.shipLevels[k] = Math.max(base.shipLevels[k] | 0, other.shipLevels[k] | 0);
    }
    // ---- SHIP ASCENSION: per hull, per module { t: tier, s: stars, l: level }.
    // Depth decides and the module is taken WHOLE — tier, then stars, then level —
    // the same rule the nanocore merge above uses, so a half-merged module can never
    // exist (a high tier paired with another copy's star count is not a state the
    // game can produce).
    if (other.ascension) {
      base.ascension = base.ascension || {};
      for (const sh in other.ascension) {
        const om = other.ascension[sh] || {};
        const bm = base.ascension[sh] = base.ascension[sh] || {};
        for (const id in om) {
          const o = om[id], b = bm[id];
          if (!o) continue;
          if (!b) { bm[id] = o; continue; }
          const deeper = (o.t | 0) !== (b.t | 0) ? (o.t | 0) > (b.t | 0)
            : (o.s | 0) !== (b.s | 0) ? (o.s | 0) > (b.s | 0)
            : (o.l | 0) > (b.l | 0);
          if (deeper) bm[id] = o;
        }
      }
    }
    // ---- kills per hull: strictly monotonic counters, and hull unlocks are gated
    // on them (`reqKills`), so a regression can RE-LOCK a hull the pilot has earned.
    if (other.shipKills) {
      base.shipKills = base.shipKills || {};
      for (const k in other.shipKills) base.shipKills[k] = Math.max(base.shipKills[k] | 0, other.shipKills[k] | 0);
    }
    // ---- SHIP SHARDS (`shipParts`). Earned from Shipworks crates, Tour of Duty,
    // Home Citadel part crates and the Server Dreadnaught event \u2014 six weeks of
    // daily play for one Voidmaw \u2014 and named here because a system absent from this
    // union is decided wholesale by the base pick. Kept through ascension by
    // ASC_KEEP, so unioning it cannot undo a reset.
    //
    // ONLY FOR HULLS NOT OWNED. Assembling a hull SPENDS its shards, so maxing an
    // owned hull's balance against a copy that had not assembled yet hands back the
    // whole price of a ship that is already in the hangar \u2014 the same duplication
    // trap the `pasc.pts` wallet block above exists to avoid.
    if (other.shipParts) {
      base.shipParts = base.shipParts || {};
      const own = base.ownedShips || {};
      for (const k in other.shipParts) {
        if (own[k]) continue;
        base.shipParts[k] = Math.max(base.shipParts[k] | 0, other.shipParts[k] | 0);
      }
    }
    // ---- STARFORGE tempers: `lv` per slot is the paid, permanent part. `heat`,
    // `pur` and `rr` are live forge state for the CURRENT attempt and belong to one
    // timeline — unioning those would invent a forge session that never happened.
    if (other.forge) {
      base.forge = base.forge || { v: other.forge.v };
      for (const k in other.forge) {
        const o = other.forge[k];
        if (!o || typeof o !== 'object') continue;
        const b = base.forge[k];
        if (!b) { base.forge[k] = o; continue; }
        if ((o.lv | 0) > (b.lv | 0)) { b.lv = o.lv | 0; }
      }
    }
    // ---- PILOT TREE node ranks. Bought with Dread Cores, and cores are a wallet we
    // do not touch — so in the rare case two devices spent offline into different
    // nodes, the union can leave a pilot with slightly more tree than they paid for.
    // That is the same bounded, one-time, non-repeating trade the `pasc` block makes
    // ("keep the perks and record the debt"), and it is the right way round: losing
    // an entire Pilot Tree to a stale login is unrecoverable, an extra node is not.
    if (other.pilot && other.pilot.nodes) {
      base.pilot = base.pilot || {};
      base.pilot.nodes = base.pilot.nodes || {};
      for (const n in other.pilot.nodes) base.pilot.nodes[n] = Math.max(base.pilot.nodes[n] | 0, other.pilot.nodes[n] | 0);
    }
    // ---- PRISM: refinery level and career bests only. `ingots` is a wallet.
    if (other.prism) {
      base.prism = base.prism || {};
      base.prism.refinery = Math.max(base.prism.refinery | 0, other.prism.refinery | 0);
      base.prism.best = Math.max(base.prism.best | 0, other.prism.best | 0);
      base.prism.core = Math.max(base.prism.core | 0, other.prism.core | 0);
    }
    // ---- MOON COLONY: structure levels and sector count per moon, plus the
    // lifetime ledger. `stored` is uncollected output (a wallet) and the raid timer
    // belongs to one timeline, so both stay with base.
    if (other.moon && Array.isArray(other.moon.moons)) {
      base.moon = base.moon || { moons: [] };
      base.moon.moons = base.moon.moons || [];
      other.moon.moons.forEach((om, i) => {
        const bm = base.moon.moons[i];
        if (!bm) { base.moon.moons[i] = om; return; }
        bm.sectors = Math.max(bm.sectors | 0, om.sectors | 0);
        // A BUILDING IS AN OBJECT — { kind, lv, dmg? } — NOT A LEVEL NUMBER.
        // This line used to read `Math.max(bb[k] | 0, ob[k] | 0)`, and `{...} | 0`
        // is 0, so EVERY building in EVERY colony became the number 0 on any
        // conflicted login. That is both Moon Colony bug reports from one line:
        // before build 653 a numeric entry threw inside render() (B[undefined].ic)
        // and the screen went blank; after 653 the shape-repair pass correctly
        // deleted the junk, which turned the blank screen into a wiped colony.
        // Merge the OBJECTS: keep the higher level, never lose `kind`, and treat
        // repaired-in-either-copy as repaired.
        const bb = bm.b = bm.b || {}, ob = om.b || {};
        for (const k in ob) {
          const o = ob[k]; if (!o || typeof o !== 'object' || !o.kind) continue;
          const b = bb[k];
          if (!b || typeof b !== 'object' || !b.kind) { bb[k] = o; continue; }
          if ((o.lv | 0) > (b.lv | 0)) b.lv = o.lv | 0;
          if (!o.dmg) delete b.dmg;                 // fixed on either device = fixed
        }
      });
      if (other.moon.lifetime) {
        base.moon.lifetime = base.moon.lifetime || {};
        for (const k in other.moon.lifetime) base.moon.lifetime[k] = Math.max(base.moon.lifetime[k] || 0, other.moon.lifetime[k] || 0);
      }
      base.moon.perm = Math.max(base.moon.perm | 0, other.moon.perm | 0);
    }
    // ---- TOUR OF DUTY (season pass). Named here because a system NOT in this
    // union is decided wholesale by the base pick — and the pass is bought with
    // real money. XP and the settled counter take the HIGHER value; `own` (the
    // paid tracks) and `claim` (what has already been paid out) are unioned, so a
    // stale copy can neither un-buy Admiralty nor re-arm a claimed reward.
    if (other.tour && (!base.tour || (other.tour.s | 0) === (base.tour.s | 0))) {
      base.tour = base.tour || { s: other.tour.s | 0, xp: 0, own: {}, claim: {}, dq: -1, wq: -1, settled: 0 };
      // XP CORRECTION EPOCH (`xf`). "XP takes the higher value" makes a DOWNWARD
      // repair impossible: TOUR.setXp() lowers one copy and the next conflicted
      // login merges the old higher figure straight back. A repair stamps `xf`
      // (ms clock); the copy with the NEWER stamp owns xp, the overtime counter
      // and the claim map OUTRIGHT — that is the entire point of the repair —
      // and equal stamps (the normal case: both 0) keep the old max/union rules.
      const bf = base.tour.xf || 0, of = other.tour.xf || 0;
      if (of > bf) {
        // the other copy carries a newer repair: adopt its xp/ov/claims outright
        base.tour.xp = other.tour.xp | 0; base.tour.ov = other.tour.ov | 0;
        base.tour.claim = Object.assign({}, other.tour.claim || {}); base.tour.xf = of;
      } else if (bf === of) {
        base.tour.xp = Math.max(base.tour.xp | 0, other.tour.xp | 0);
        base.tour.ov = Math.max(base.tour.ov | 0, other.tour.ov | 0);
      }
      // bf > of: base holds the repair — other's stale xp/ov/claims are ignored
      base.tour.settled = Math.max(base.tour.settled | 0, other.tour.settled | 0);
      base.tour.dq = Math.max(base.tour.dq | 0, other.tour.dq | 0);
      base.tour.wq = Math.max(base.tour.wq | 0, other.tour.wq | 0);
      // own (paid tracks) always unions; claim only merges between EQUAL repair
      // epochs — across epochs the newer repair owns the claim map (see above)
      (bf === of ? ['own', 'claim'] : ['own']).forEach((f) => {
        if (!other.tour[f]) return;
        base.tour[f] = base.tour[f] || {};
        for (const k in other.tour[f]) if (!base.tour[f][k]) base.tour[f][k] = other.tour[f][k];
      });
    }
    // BETA ACCESS is sticky and one-way: if EITHER copy of the save has been let
    // in, the merged one is. A tester who redeems on their phone must not lose
    // access because the desktop copy won the merge.
    if (other.tourBeta) base.tourBeta = 1;
    // ---- REDEEMED COUPON CODES. A redemption mark is monotonic: once a one-time
    // code (discord1k's 1,000 ◈, lvl100) is used on ANY device it is used, period.
    // Not naming this here meant the base pick decided it wholesale — redeem on
    // the phone, let the stale desktop copy win a merge, and the mark is gone: the
    // "one per account" giveaway becomes farmable on every conflicted login. Same
    // union as badge claims, and for the same reason: a lost claim mark is not
    // lost progress, it is a repeatable reward.
    if (other.redeemedCodes) {
      base.redeemedCodes = base.redeemedCodes || {};
      for (const k in other.redeemedCodes) base.redeemedCodes[k] = base.redeemedCodes[k] || other.redeemedCodes[k];
    }
    // ---- BADGE CLAIMS. Unioning `claimed` is what PREVENTS a double payout: the
    // claim map is the only thing stopping a rank paying its LootCoins twice, so a
    // lost claim is not just a lost badge, it is a repeatable reward.
    if (other.achieve) {
      base.achieve = base.achieve || {};
      ['seen', 'claimed'].forEach((f) => {
        if (!other.achieve[f]) return;
        base.achieve[f] = base.achieve[f] || {};
        for (const k in other.achieve[f]) base.achieve[f][k] = Math.max(base.achieve[f][k] | 0, other.achieve[f][k] | 0);
      });
    }
    // ---- TERRITORY — THE ONE UNION HERE THAT MUST BE EPOCH-GUARDED.
    // Tiles are unioned and a citadel is kept at its HIGHER rank, because a lost
    // merge could otherwise demolish a Rank 5 fortress — five build-and-rank-up
    // cycles of fuel, iron and plasma, and worth more since a sieged citadel now
    // changes hands intact at full rank.
    //
    // BUT ONLY WITHIN ONE TIMELINE. Unlike every other union above, territory is
    // state the epoch-1 reset DELIBERATELY DESTROYS: the PASC_EPOCH migration in
    // game-v93.js clears ownedSystems, citadels, rivalCitadels, tileCd and
    // razedCitadels outright, and the reset toast tells players the galaxy is wiped
    // for every pilot. Unioning across epochs restores every tile and citadel from
    // the wiped timeline — which is precisely the failure the epoch was introduced
    // to stop ("without an epoch the 0-star save loses to the pre-reset cloud copy
    // and the reset is undone at the next login, on every device, forever"). It
    // would also fight supabase/reset-territory.sql and the `_turfRepub2` latch,
    // whose job is keeping old holdings out of the truncated `territory` table.
    //
    // Same guard the pasc and pilot-level unions already use. When the epochs
    // differ, the reset has run on `base` and its empty galaxy is the correct answer.
    if (el === ec) {
      if (other.ownedSystems) {
        base.ownedSystems = base.ownedSystems || {};
        for (const id in other.ownedSystems) if (!base.ownedSystems[id]) base.ownedSystems[id] = other.ownedSystems[id];
      }
      if (other.citadels) {
        base.citadels = base.citadels || {};
        for (const id in other.citadels) {
          const o = other.citadels[id], b = base.citadels[id];
          if (!o) continue;
          if (!b || (o.lv | 0) > (b.lv | 0)) base.citadels[id] = o;
        }
      }
      // ---- PER-HULL DRONE BAYS. Named here for the reason stated above: a system
      // absent from this union is decided wholesale by the base pick, and bays are
      // now stored per hull rather than as one global counter, so a stale copy
      // could empty every carrier the pilot is not currently flying. Higher count
      // per hull wins; the live `drones` view is re-derived from the active hull's
      // record on the next spawnDrones().
      //
      // INSIDE the epoch guard: both ascension resets clear droneBays, so
      // unioning across epochs would hand back a wing the reset disbanded.
      if (other.droneBays) {
        base.droneBays = base.droneBays || {};
        for (const k in other.droneBays) base.droneBays[k] = Math.max(base.droneBays[k] | 0, other.droneBays[k] | 0);
      }
    }
    // =========================================================================
    if (other.cosmetics && other.cosmetics.owned) {
      base.cosmetics = base.cosmetics || { owned: { stock: 1, none: 1 }, skin: 'stock', aura: 'none' };
      base.cosmetics.owned = base.cosmetics.owned || {};
      for (const id in other.cosmetics.owned) if (!base.cosmetics.owned[id]) base.cosmetics.owned[id] = 1;
    }
    return base;
  }
  async function pull() {
    if (!cloudOn()) return null;
    const s = session();
    if (!s || !s.id) return null;
    let res;
    // revision-aware read first (save-cas.sql) — it's what makes writes safe
    if (window.CLOUD.pullSave) {
      const r = await window.CLOUD.pullSave(s.id);
      if (r && r.ok) { _casOn = true; _rev = r.rev; res = { ok: true, data: r.data }; }
      else if (r && r.unsupported) _casOn = false;
    }
    if (!res) {
      try {
        res = window.CLOUD.pullMeta ? await window.CLOUD.pullMeta(s.id)
                                    : { ok: true, data: await window.CLOUD.pull(s.id) };
      } catch (e) { res = { ok: false }; }
    }
    if (!res || !res.ok) return null;   // fetch FAILED — cloud writes stay blocked this session
    _pullOk = true;
    // recovery net + clobber baseline: stash the untouched cloud copy, remember its weight
    try { if (res.data) { localStorage.setItem('lf-backup::' + uid(), JSON.stringify(res.data)); _cloudWeight = saveWeight(res.data); } } catch (e) {}
    const merged = mergeSaves(load(), res.data);
    if (merged) {
      saveLocal(merged); vault(merged, true);
      // REPAIR PUSH — when local progress beat the cloud copy, publish the strong
      // save NOW so other devices pull it instead of re-pushing weak state.
      if (saveWeight(merged) > _cloudWeight * 1.02) { pending = merged; flush(); }
      try { window.SESSIONLOCK && window.SESSIONLOCK.claim(); } catch (e) {}
      return merged;
    }
    try { window.SESSIONLOCK && window.SESSIONLOCK.claim(); } catch (e) {}   // this login takes over — kick every older tab/device
    return null;
  }

  // ⚙ COG PING — ONE unread dot, cleared for good the first time the sheet is
  // opened. Persisted outside the save so it survives a reset and never re-arms.
  const COG_SEEN = 'lf_cog_seen';
  function cogSeen() { try { return localStorage.getItem(COG_SEEN) === '1'; } catch (e) { return true; } }
  function clearCogDot() {
    try { localStorage.setItem(COG_SEEN, '1'); } catch (e) {}
    try { document.querySelectorAll('.acct-btn .acct-dot').forEach((d) => d.remove()); } catch (e) {}
  }
  // ---- top-bar account control (name + sign out) ----------------------------
  function refreshBar() {
    const sb = document.getElementById('statusbar');
    if (!sb) return;
    const s = session();
    let b = sb.querySelector('.acct-btn');
    if (!s) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement('button');
      b.className = 'acct-btn';
      sb.appendChild(b);
      b.addEventListener('click', () => {
        clearCogDot();
        if (window.UI && window.UI.openAccountSheet) { window.UI.openAccountSheet(); return; }
        const nm = (session() || {}).name || 'this account';
        if (confirm('Sign out of ' + nm + '?')) {
          if (window.AUTH && window.AUTH.signOut) window.AUTH.signOut();
          else { try { localStorage.removeItem(SESS); } catch (e) {} location.reload(); }
        }
      });
    }
    b.classList.add('cog');
    b.title = (s.name || 'Operator') + ' · account & settings';
    b.setAttribute('aria-label', 'Account & settings');
    b.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' + (cogSeen() ? '' : '<span class="acct-dot"></span>');
  }
  window.addEventListener('load', () => setTimeout(refreshBar, 200));

  // Rename the pilot — updates the live session (and cloud user metadata when
  // signed in) so the leaderboard + top bar pick it up.
  function setName(n) {
    const s = session(); if (!s || !n) return false;
    s.name = n;
    try { localStorage.setItem(SESS, JSON.stringify(s)); } catch (e) {}
    // Written to the SAVE as well: user_metadata.name is provider territory —
    // Google overwrites it from the Google profile on every OAuth sign-in — so the
    // save and the app-owned lf_name key are what actually persist a rename.
    try { if (window.GAME && window.GAME.state) { window.GAME.state.pilotName = n; window.GAME.save(); } } catch (e) {}
    if (cloudOn() && window.CLOUD.client) { try { window.CLOUD.client.auth.updateUser({ data: { name: n, lf_name: n } }); } catch (e) {} }
    try { publishNow(); } catch (e) {}   // the board shows the new name at once, not in 90s
    refreshBar();
    return true;
  }
  window.ACCOUNT = { key, current, session, repin, uid, load, save: saveLocal, push, pull, flushNow, publishNow, refreshBar, cloudOn, setName, saveWeight, mergeSaves, clearCogDot, casOn: () => _casOn };
})();
