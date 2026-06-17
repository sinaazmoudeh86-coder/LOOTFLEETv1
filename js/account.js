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
  // Local saves are instant; CLOUD writes are batched to at most ~1 per 30s so
  // the backend isn't hammered. A final flush fires when the tab hides/closes.
  let pending = null, timer = 0, lastSent = '';
  function push(state) {
    saveLocal(state);
    if (!cloudOn()) return;
    const s = session();
    if (!s || !s.id) return;            // only signed-in cloud users sync
    pending = state;
    if (!timer) timer = setTimeout(flush, 30000);
  }
  async function flush() {
    clearTimeout(timer); timer = 0;
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
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  // pull the authoritative cloud save into the local namespaced slot
  async function pull() {
    if (!cloudOn()) return null;
    const s = session();
    if (!s || !s.id) return null;
    const data = await window.CLOUD.pull(s.id);
    if (data) { saveLocal(data); return data; }
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
    b.innerHTML = '<span class="dot"></span><span class="who">' + (s.name || 'Operator') + '</span>';
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
  window.ACCOUNT = { key, current, session, load, save: saveLocal, push, pull, refreshBar, cloudOn, setName };
})();
