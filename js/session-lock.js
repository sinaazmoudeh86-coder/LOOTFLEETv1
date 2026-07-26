/* =============================================================================
   session-lock.js — ONE ACTIVE SESSION PER SAVE SLOT
   ---------------------------------------------------------------------------
   Multi-accounting on one device is NORMAL: different accounts in different
   tabs/browsers coexist freely — locks are scoped to the SAVE SLOT (account),
   never the device. Only two contexts on the SAME slot conflict; the newest
   claim wins and every older one is kicked live:
     · same browser  → BroadcastChannel('lf-session') — instant, no network
     · other devices → Supabase Realtime broadcast on channel lf-session-<uid>
       (cloud accounts only; guests/local accounts exist per-browser anyway)
   A kicked page sets window.__sessionKicked (ACCOUNT.push/flush refuse ALL
   local + cloud writes under that flag) and shows a takeover notice.
   Tabs opened in the BACKGROUND stay inert (canWrite() = false) until first
   focus, then claim — so a ctrl+click never silently co-writes a slot.
   Loads after account.js, before auth.js.
   ============================================================================= */
(function () {
  'use strict';
  const DEV_KEY = 'lf-device';
  // Embedded contexts (editor previews) never lock, never get locked.
  const EMBED = (function () { try { return window !== window.top; } catch (e) { return true; } })();
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
  // this tab's PINNED account (account.js holds it for the tab's lifetime)
  function sess() { try { return window.ACCOUNT ? window.ACCOUNT.session() : JSON.parse(localStorage.getItem('io-auth')); } catch (e) { return null; } }
  function slot() { try { if (window.ACCOUNT && window.ACCOUNT.uid) return window.ACCOUNT.uid(); } catch (e) {} const s = sess(); if (s && s.id) return 'u_' + s.id; return s && s.name ? s.name.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_.-]/g, '') : 'guest'; }
  function cloudId() { const s = sess(); return (s && s.id) || null; }

  let claimedAt = 0, claimedSlot = null, armed = false, chan = null, bc = null;
  // SERVER-TIME LEASE (supabase/save-cas.sql). Client clocks are not
  // trustworthy — a device hours fast could never be kicked and always won
  // every contest. When the lease RPCs exist, ownership is decided purely by
  // Postgres now(): _leaseAt is the server stamp of MY claim, and any row
  // naming another session with a LATER server stamp beats me, full stop.
  let _leaseAt = 0, _leaseCh = null, _leaseOn = false;
  const devLabel = (function () {
    try {
      const ua = navigator.userAgent || '';
      const os = /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Android/i.test(ua) ? 'Android' : /Mac/i.test(ua) ? 'Mac' : /Windows/i.test(ua) ? 'Windows' : 'Device';
      const br = /CriOS|Chrome/i.test(ua) ? 'Chrome' : /FxiOS|Firefox/i.test(ua) ? 'Firefox' : /Edg/i.test(ua) ? 'Edge' : /Safari/i.test(ua) ? 'Safari' : 'Browser';
      return os + ' · ' + br;
    } catch (e) { return 'Device'; }
  })();

  function beats(m) {   // does this foreign claim outrank mine?
    if (!m || m.dev === deviceId()) return false;
    return (m.at > claimedAt) || (m.at === claimedAt && String(m.dev) > deviceId());
  }
  function kick(byName) {
    if (window.__sessionKicked) return;
    window.__sessionKicked = true;   // account.js: blocks every local + cloud write
    try { if (window.GAME && window.GAME.freeze) window.GAME.freeze(); } catch (e) {}   // stop simulating: no phantom progress behind the notice
    let ov = document.getElementById('lf-kicked');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'lf-kicked';
      ov.innerHTML = '<div class="lfk-card"><div class="lfk-ic">⚠</div><h3>' + (byName === 'account' ? 'ANOTHER ACCOUNT SIGNED IN' : 'SIGNED IN ELSEWHERE') + '</h3>' +
        '<p>' + (byName === 'account'
          ? 'A different account just signed in on this browser. To protect both saves, <b>this screen has stopped playing and saving</b>.'
          : 'This account just became active on another ' + (byName === 'tab' ? 'tab' : 'device or tab') + '. ' +
            'To protect your save, <b>this screen has stopped playing and saving</b>.') + '</p>' +
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

  // ALWAYS-ON LISTENER — created at load (even hidden, even signed-out) so a
  // tab can never miss a takeover for ITS slot. Claims for OTHER slots are
  // ignored: that's just another account playing on this device.
  function ensureBC() {
    if (bc || !window.BroadcastChannel || EMBED) return;
    try {
      bc = new BroadcastChannel('lf-session');
      bc.onmessage = (ev) => {
        const m = ev.data || {};
        if (m.t !== 'claim' || !m.slot) return;
        if (m.slot !== slot()) return;                    // different account — coexist
        if (!claimedAt && !armed) return;                 // idle page (login gate / inert bg tab) — nothing to protect
        if (beats(m)) kick('tab');
      };
    } catch (e) {}
  }
  ensureBC();

  // Can this tab write its save slot right now?
  //  · embedded previews: always (they never join the lock)
  //  · kicked: never
  //  · visible: yes — and that marks the tab as an ACTIVE session (armed)
  //  · hidden and never claimed: no — a background-opened tab stays inert
  function canWrite() {
    if (EMBED) return true;
    if (window.__sessionKicked) return false;
    if (claimedAt) return true;
    if (document.hidden) return false;   // deferred: claims (and starts writing) on first focus
    armed = true;                        // visible pre-claim boot window — active session
    return true;
  }

  function claim() {
    if (EMBED) return;   // editor previews / verifier frames never steal the lock
    if (document.hidden) { document.addEventListener('visibilitychange', function once() { if (!document.hidden) { document.removeEventListener('visibilitychange', once); claim(); } }); return; }
    ensureBC();
    claimedAt = Date.now();
    claimedSlot = slot();
    armed = true;
    window.__sessionKicked = false;
    startHeartbeat();
    // same-browser tabs — instant, offline-safe; scoped to MY slot
    try { if (bc) bc.postMessage({ t: 'claim', slot: claimedSlot, dev: deviceId(), at: claimedAt }); } catch (e) {}
    // cross-device — Supabase Realtime broadcast, cloud accounts only
    try {
      const id = cloudId();
      if (id && window.CLOUD && window.CLOUD.enabled && window.CLOUD.client) {
        if (chan) { try { window.CLOUD.client.removeChannel(chan); } catch (e) {} chan = null; }
        chan = window.CLOUD.client.channel('lf-session-' + id);
        chan.on('broadcast', { event: 'claim' }, (p) => { const m = (p && p.payload) || {}; if (beats(m)) kick('device'); })
            .subscribe((st) => { if (st === 'SUBSCRIBED') { try { chan.send({ type: 'broadcast', event: 'claim', payload: { dev: deviceId(), at: claimedAt } }); } catch (e) {} } });
        claimLease(id);
      }
    } catch (e) {}
  }

  // ---- SERVER LEASE ---------------------------------------------------------
  // Take the account in the DB (persisted — unlike a broadcast, a device that
  // was asleep still sees it) and watch the row for anyone taking it from me.
  async function claimLease(id) {
    if (!window.CLOUD || !window.CLOUD.claimSession) return;
    const r = await window.CLOUD.claimSession(deviceId(), devLabel);
    if (!r || !r.ok) return;                       // migration not installed — broadcast path stands alone
    _leaseOn = true;
    _leaseAt = Date.parse(r.at) || 0;
    if (_leaseCh) { try { window.CLOUD.client.removeChannel(_leaseCh); } catch (e) {} _leaseCh = null; }
    _leaseCh = window.CLOUD.onSessionRow ? window.CLOUD.onSessionRow(id, onLeaseRow) : null;
  }
  function onLeaseRow(row) {
    if (!row || window.__sessionKicked || !_leaseAt) return;
    if (row.session_id === deviceId()) return;
    const at = Date.parse(row.updated_at) || 0;
    if (at > _leaseAt) kick('device');            // server time decided it, not our clock
  }

  // HEARTBEAT — re-announce my ORIGINAL claim every 20s. A tab that slept
  // through the live kick hears the newer claim on wake and stands down; an
  // older claim can never outrank a newer one (beats() compares timestamps).
  // The same tick renews the SERVER lease: touch_session answers with the row's
  // real owner, so a missed realtime event costs at most 20s — this doubles as
  // the polling fallback when Realtime never connects.
  let _hb = 0;
  function startHeartbeat() {
    if (_hb) return;
    _hb = setInterval(async () => {
      try {
        if (window.__sessionKicked || !claimedAt) return;
        if (bc) bc.postMessage({ t: 'claim', slot: claimedSlot, dev: deviceId(), at: claimedAt });
        if (chan) chan.send({ type: 'broadcast', event: 'claim', payload: { dev: deviceId(), at: claimedAt } });
        if (_leaseOn && window.CLOUD && window.CLOUD.touchSession) {
          const r = await window.CLOUD.touchSession(deviceId());
          // belt & braces: only a DIFFERENT owner with a LATER server stamp
          // can kick us — a missing/own owner is always me (a lease row that
          // was cleaned up gets re-taken, never treated as a takeover)
          if (r && r.ok) {
            const owner = r.owner || deviceId();
            if (r.mine || owner === deviceId()) _leaseAt = Date.parse(r.at) || _leaseAt;
            else if ((Date.parse(r.at) || 0) > _leaseAt) kick('device');
          }
        }
      } catch (e) {}
    }, 20000);
  }
  window.SESSIONLOCK = { claim, kick, deviceId, browserId, canWrite, lockInfo: () => ({ dev: deviceId(), at: claimedAt }), isKicked: () => !!window.__sessionKicked, leaseOn: () => _leaseOn };
  // this page load IS the newest session for its slot — claim once a session
  // is readable (never from the signed-out login gate: no slot to protect)
  const boot = () => { try { if (sess() && !window.__sessionKicked) claim(); } catch (e) {} };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 700));
  else setTimeout(boot, 700);
})();
