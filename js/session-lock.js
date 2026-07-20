/* =============================================================================
   session-lock.js — ONE ACTIVE LOGIN PER ACCOUNT
   ---------------------------------------------------------------------------
   The NEWEST login always takes over; every older tab/device is kicked live:
     · same browser  → BroadcastChannel('lf-session') — instant, no network
     · other devices → Supabase Realtime broadcast on channel lf-session-<uid>
   A kicked page sets window.__sessionKicked (ACCOUNT.push/flush already refuse
   ALL local + cloud writes under that flag) and shows a full-screen takeover
   notice; "Take back control" reloads, which re-claims the lock. Guests
   (no cloud id) are never locked. Loads after account.js, before auth.js.
   ============================================================================= */
(function () {
  'use strict';
  const DEV_KEY = 'lf-device';
  // PER-WINDOW claim identity — localStorage is shared by every tab of the same
  // browser, so a persisted id could never distinguish (= never kick) sibling
  // tabs. Each window gets its own id; lf-device stays only as a stable
  // browser marker for diagnostics.
  const INST = 'w_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  function deviceId() { return INST; }
  function browserId() {
    let d = null;
    try { d = localStorage.getItem(DEV_KEY); } catch (e) {}
    if (!d) { d = 'd_' + Math.random().toString(36).slice(2) + Date.now().toString(36); try { localStorage.setItem(DEV_KEY, d); } catch (e) {} }
    return d;
  }
  function uid() { try { const s = JSON.parse(localStorage.getItem('io-auth')); return (s && s.id) || null; } catch (e) { return null; } }

  let claimedAt = 0, chan = null, bc = null, claimedUid = null;

  function beats(m) {   // does this foreign claim outrank mine?
    if (!m || m.dev === deviceId()) return false;
    return (m.at > claimedAt) || (m.at === claimedAt && String(m.dev) > deviceId());
  }
  function kick(byName) {
    if (window.__sessionKicked) return;
    window.__sessionKicked = true;   // account.js: blocks every local + cloud write
    let ov = document.getElementById('lf-kicked');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'lf-kicked';
      ov.innerHTML = '<div class="lfk-card"><div class="lfk-ic">⚠</div><h3>SIGNED IN ELSEWHERE</h3>' +
        '<p>Your account just became active on another ' + (byName === 'tab' ? 'tab' : 'device or tab') + '. ' +
        'To protect your save, <b>this screen has stopped playing and saving</b>.</p>' +
        '<button id="lfk-take">⚡ TAKE BACK CONTROL</button></div>';
      const st = document.createElement('style');
      st.textContent = '#lf-kicked{position:fixed;inset:0;z-index:99999;display:grid;place-items:center;background:rgba(5,8,14,.93);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);padding:20px}' +
        '.lfk-card{max-width:340px;text-align:center;background:linear-gradient(180deg,#141b28,#0c111c);border:1px solid #2c3a52;border-radius:18px;padding:26px 22px;box-shadow:0 24px 60px rgba(0,0,0,.7)}' +
        '.lfk-ic{font-size:34px;filter:drop-shadow(0 0 14px #ffcf7a)}' +
        '.lfk-card h3{font-family:Orbitron,sans-serif;font-weight:800;font-size:16px;letter-spacing:.06em;color:#ffe1a6;margin:10px 0 8px}' +
        '.lfk-card p{font-family:Rajdhani,sans-serif;font-weight:600;font-size:13.5px;line-height:1.55;color:#b8c4d8;margin:0 0 16px}' +
        '.lfk-card p b{color:#fff}' +
        '#lfk-take{width:100%;border:none;border-radius:12px;padding:13px;font-family:Orbitron,sans-serif;font-weight:800;font-size:13px;color:#1c1206;background:linear-gradient(180deg,#ffd24d,#e8960f);cursor:pointer;box-shadow:0 8px 22px -8px rgba(255,210,77,.7)}';
      document.head.appendChild(st);
      document.body.appendChild(ov);
      ov.querySelector('#lfk-take').addEventListener('click', () => location.reload());
    }
    ov.style.display = 'grid';
  }

  function claim() {
    const id = uid(); if (!id) return;                 // guests: never locked
    // EMBEDDED contexts (editor previews, verifier frames) must never steal the
    // lock from the player's real session; background tabs shouldn't either —
    // they claim when they become visible.
    if (window !== window.top) return;
    if (document.hidden) { document.addEventListener('visibilitychange', function once() { if (!document.hidden) { document.removeEventListener('visibilitychange', once); claim(); } }); return; }
    claimedAt = Date.now();
    claimedUid = id;
    window.__sessionKicked = false;
    startHeartbeat();
    // same-browser tabs — instant, offline-safe
    try {
      if (!bc && window.BroadcastChannel) {
        bc = new BroadcastChannel('lf-session');
        bc.onmessage = (ev) => { const m = ev.data || {}; if (m.t === 'claim' && m.uid === claimedUid && beats(m)) kick('tab'); };
      }
      if (bc) bc.postMessage({ t: 'claim', uid: id, dev: deviceId(), at: claimedAt });
    } catch (e) {}
    // cross-device — Supabase Realtime broadcast (no SQL, no polling)
    try {
      if (window.CLOUD && window.CLOUD.enabled && window.CLOUD.client) {
        if (chan) { try { window.CLOUD.client.removeChannel(chan); } catch (e) {} chan = null; }
        chan = window.CLOUD.client.channel('lf-session-' + id);
        chan.on('broadcast', { event: 'claim' }, (p) => { const m = (p && p.payload) || {}; if (beats(m)) kick('device'); })
            .subscribe((st) => { if (st === 'SUBSCRIBED') { try { chan.send({ type: 'broadcast', event: 'claim', payload: { dev: deviceId(), at: claimedAt } }); } catch (e) {} } });
      }
    } catch (e) {}
  }

  // HEARTBEAT — re-announce my ORIGINAL claim every 20s. A device that slept
  // through the live kick hears the newer claim on wake and stands down; an
  // older claim can never outrank a newer one (beats() compares timestamps).
  let _hb = 0;
  function startHeartbeat() {
    if (_hb) return;
    _hb = setInterval(() => {
      try {
        if (window.__sessionKicked || !claimedAt) return;
        if (bc) bc.postMessage({ t: 'claim', uid: claimedUid, dev: deviceId(), at: claimedAt });
        if (chan) chan.send({ type: 'broadcast', event: 'claim', payload: { dev: deviceId(), at: claimedAt } });
      } catch (e) {}
    }, 20000);
  }
  window.SESSIONLOCK = { claim, kick, deviceId, browserId, lockInfo: () => ({ dev: deviceId(), at: claimedAt }), isKicked: () => !!window.__sessionKicked };
  // this page load IS the newest login — claim once the session is readable
  const boot = () => { try { if (uid() && !window.__sessionKicked) claim(); } catch (e) {} };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 700));
  else setTimeout(boot, 700);
})();
