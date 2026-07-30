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
  function saveWeight(s) {
    if (!s) return 0;
    let hull = 0; try { const sl = s.shipLevels || {}; for (const k in sl) hull += sl[k] || 0; } catch (e) {}
    let asc = 0; try { const a = s.ascension || {}; for (const sh in a) { const mods = a[sh]; for (const m in mods) { const md = mods[m] || {}; asc += (md.t | 0) * 250 + (md.s | 0) * 50 + Math.max(0, (md.l | 0) - 1) * 10; } } } catch (e) {}
    return (s.playTime || 0) + (s.totalKills || 0) * 10 + (s.level || 1) * 3600
      + Math.log10(1 + Math.max(0, s.gold || 0)) * 7200
      + Math.max(s.highestDungeonReached | 0, s.highestUnlocked | 0) * 1800
      + hull * 900 + asc * 60;
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
  // public leaderboard row (non-sensitive fields)
  // ASCENSION STARS (fixed Jul 2026): this publisher never sent `asc`, so every
  // row in the leaderboard table was written with p_asc = 0. Your own badge came
  // from local state, which is why only YOUR stars ever showed on the Ranks page
  // \u2014 every other pilot, ascended or not, published a zero. Read it from the save
  // blob, with the live module as a fallback.
  function publishLb(s, data) {
    try {
      if (window.CLOUD.lbUpsert) {
        const G = window.GAME;
        let asc = (data && data.pasc && data.pasc.stars) | 0;
        if (!asc) { try { asc = window.PASCEND ? (window.PASCEND.stars() | 0) : 0; } catch (e) {} }
        window.CLOUD.lbUpsert({
          name: s.name,
          power: (G && G.score) ? G.score() : (data.level || 1),
          level: data.level || 1, zone: data.highestDungeonReached || 1, kills: data.totalKills || 0,
          asc,
          fleet: [data.ship].concat((G && G.fleetShips) ? G.fleetShips().map((x) => x.key) : []).filter(Boolean),
        });
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
    if (wl > wc * 1.3) { base = local; other = cloud; }
    else if (wc > wl * 1.3) { base = cloud; other = local; }
    else { base = (cloud.lastSave || 0) >= (local.lastSave || 0) ? cloud : local; other = base === cloud ? local : cloud; }
    base.proUntil = Math.max(base.proUntil || 0, other.proUntil || 0);
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
    // lifetime tallies exist on both timelines — keep the larger of each
    base.totalKills = Math.max(base.totalKills || 0, other.totalKills || 0);
    base.playTime = Math.max(base.playTime || 0, other.playTime || 0);
    base.itemsFound = Math.max(base.itemsFound || 0, other.itemsFound || 0);
    base.highestDungeonReached = Math.max(base.highestDungeonReached || 1, other.highestDungeonReached || 1);
    base.highestUnlocked = Math.max(base.highestUnlocked || 1, other.highestUnlocked || 1);
    if (other.sdread && base.sdread) {
      base.sdread.total = Math.max(base.sdread.total || 0, other.sdread.total || 0);
      base.sdread.bestEver = Math.max(base.sdread.bestEver || 0, other.sdread.bestEver || 0);
    } else if (other.sdread && !base.sdread) base.sdread = other.sdread;
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
    b.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg><span class="acct-dot"></span>';
  }
  window.addEventListener('load', () => setTimeout(refreshBar, 200));

  // Rename the pilot — updates the live session (and cloud user metadata when
  // signed in) so the leaderboard + top bar pick it up.
  function setName(n) {
    const s = session(); if (!s || !n) return false;
    s.name = n;
    try { localStorage.setItem(SESS, JSON.stringify(s)); } catch (e) {}
    if (cloudOn() && window.CLOUD.client) { try { window.CLOUD.client.auth.updateUser({ data: { name: n } }); } catch (e) {} }
    refreshBar();
    return true;
  }
  window.ACCOUNT = { key, current, session, repin, uid, load, save: saveLocal, push, pull, flushNow, refreshBar, cloudOn, setName, saveWeight, mergeSaves, casOn: () => _casOn };
})();
