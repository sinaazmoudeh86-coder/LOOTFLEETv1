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

  function session() { try { return JSON.parse(localStorage.getItem(SESS)); } catch (e) { return null; } }
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
  // "How much life is in this save?" — playtime + kills + levels. Used to stop
  // fresh-boot states from ever outranking a real account by timestamp alone.
  function saveWeight(s) { if (!s) return 0; return (s.playTime || 0) + (s.totalKills || 0) * 10 + (s.level || 1) * 3600; }
  function push(state) {
    if (window.__sessionKicked) return;   // kicked by a newer login — stop ALL writes (local too: same-browser tabs share this slot)
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
    lastSent = ser;
    await window.CLOUD.push(s.id, data);
    // also publish a public row to the global leaderboard (non-sensitive fields)
    try {
      if (window.CLOUD.lbUpsert) {
        const G = window.GAME;
        window.CLOUD.lbUpsert({
          name: s.name,
          power: (G && G.score) ? G.score() : (data.level || 1),
          level: data.level || 1, zone: data.highestDungeonReached || 1, kills: data.totalKills || 0,
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
  // queue for sleepers) asks the cloud row who owns the account now. Someone
  // newer → kick overlay ("Take back control" reloads into a fresh merge).
  // Still me → re-claim so both channels hear the active session again.
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || window.__sessionKicked) return;
    if (!cloudOn()) return;
    const s = session(); if (!s || !s.id || !window.SESSIONLOCK) return;
    try {
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
    let base = (cloud.lastSave || 0) >= (local.lastSave || 0) ? cloud : local;
    let other = base === cloud ? local : cloud;
    // FRESH-BOOT GUARD: a newer timestamp never outranks real progress — if the
    // "newer" copy holds under 20% of the other's weight, the heavier copy wins.
    if (saveWeight(base) < saveWeight(other) * 0.2) { const t = base; base = other; other = t; }
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
      }
    }
    base.lifetimeMissions = Math.max(base.lifetimeMissions | 0, other.lifetimeMissions | 0);
    base.vipPts = Math.max(base.vipPts | 0, other.vipPts | 0);   // ⚜ VIP points never regress
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
    try {
      res = window.CLOUD.pullMeta ? await window.CLOUD.pullMeta(s.id)
                                  : { ok: true, data: await window.CLOUD.pull(s.id) };
    } catch (e) { res = { ok: false }; }
    if (!res || !res.ok) return null;   // fetch FAILED — cloud writes stay blocked this session
    _pullOk = true;
    // recovery net + clobber baseline: stash the untouched cloud copy, remember its weight
    try { if (res.data) { localStorage.setItem('lf-backup::' + uid(), JSON.stringify(res.data)); _cloudWeight = saveWeight(res.data); } } catch (e) {}
    const merged = mergeSaves(load(), res.data);
    if (merged) { saveLocal(merged); try { window.SESSIONLOCK && window.SESSIONLOCK.claim(); } catch (e) {} return merged; }
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
  window.ACCOUNT = { key, current, session, load, save: saveLocal, push, pull, flushNow, refreshBar, cloudOn, setName };
})();
