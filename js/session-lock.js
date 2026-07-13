/* =============================================================================
   session-lock.js — single active session per account
   ---------------------------------------------------------------------------
   A FRESH login claims the account (upserts this device's id into
   `active_sessions`). Every other signed-in device sees the claim — via
   Supabase realtime when available, and a 20s poll as the guaranteed
   fallback — and is kicked to the login gate with a "signed in elsewhere"
   screen. A kicked device stops pushing cloud saves immediately so it can
   never clobber the new device's progress.

   Requires supabase/session-lock.sql. Load AFTER cloud.js, BEFORE auth.js.
   auth.js calls SESSIONLOCK.start(user, fresh):
     fresh=true  → new sign-in: claim unconditionally (kicks the old device)
     fresh=false → restored session: verify we still own the account first
   ============================================================================= */
(function () {
  'use strict';
  const DEV_KEY = 'lf-device-id';
  let deviceId = null, uid = null, pollT = 0, chan = null, kicked = false;

  function devId() {
    if (deviceId) return deviceId;
    try { deviceId = localStorage.getItem(DEV_KEY); } catch (e) {}
    if (!deviceId) {
      deviceId = (crypto && crypto.randomUUID) ? crypto.randomUUID()
        : 'd-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      try { localStorage.setItem(DEV_KEY, deviceId); } catch (e) {}
    }
    return deviceId;
  }
  function client() { return (window.CLOUD && window.CLOUD.enabled) ? window.CLOUD.client : null; }
  function deviceLabel() {
    const ua = navigator.userAgent || '';
    const os = /iPhone|iPad/.test(ua) ? 'an iPhone / iPad'
      : /Android/.test(ua) ? 'an Android device'
      : /Mac/.test(ua) ? 'a Mac' : /Win/.test(ua) ? 'a Windows PC' : 'another device';
    return os;
  }

  async function claim(userId) {
    const c = client(); if (!c) return;
    try {
      await c.from('active_sessions').upsert(
        { user_id: userId, session_id: devId(), device: deviceLabel(), updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    } catch (e) {}
  }

  async function check() {
    const c = client(); if (!c || !uid || kicked) return;
    try {
      const { data, error } = await c.from('active_sessions')
        .select('session_id,device').eq('user_id', uid).maybeSingle();
      if (error || !data) return;
      if (data.session_id && data.session_id !== devId()) kick(data.device);
    } catch (e) {}
  }

  function watch() {
    const c = client(); if (!c) return;
    clearInterval(pollT);
    pollT = setInterval(check, 20000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    // realtime — instant kick when the row changes hands (best-effort)
    try {
      chan = c.channel('lf-session-' + uid)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'active_sessions', filter: 'user_id=eq.' + uid },
          (p) => { const row = p.new || {}; if (row.session_id && row.session_id !== devId()) kick(row.device); })
        .subscribe();
    } catch (e) {}
  }

  function stop() {
    clearInterval(pollT); pollT = 0;
    try { if (chan && client()) client().removeChannel(chan); } catch (e) {}
    chan = null;
  }

  async function kick(device) {
    if (kicked) return;
    kicked = true;
    window.__sessionKicked = true;   // account.js: blocks all further cloud pushes
    stop();
    // sign THIS device out only — 'local' scope must not revoke the new device
    try { const c = client(); if (c) await c.auth.signOut({ scope: 'local' }); } catch (e) {}
    try { localStorage.removeItem('io-auth'); } catch (e) {}
    showKickScreen(device);
  }

  function showKickScreen(device) {
    if (document.getElementById('session-kicked')) return;
    const d = document.createElement('div');
    d.id = 'session-kicked';
    d.innerHTML = '<div class="sk-card">' +
      '<div class="sk-ic">⚠</div>' +
      '<h2>Signed in elsewhere</h2>' +
      '<p>Your account was just signed in on <b>' + (device || 'another device') + '</b>. ' +
      'Loot Fleet allows one active session at a time, so this one has been disconnected.</p>' +
      '<p class="sk-sub">Your progress is safe in the cloud.</p>' +
      '<button type="button" id="sk-back">Sign back in here</button></div>';
    const st = document.createElement('style');
    st.textContent =
      '#session-kicked{position:fixed;inset:0;z-index:99999;display:grid;place-items:center;padding:20px;' +
      'background:radial-gradient(120% 90% at 50% 0%,#0d1524,#05080f 70%);}' +
      '#session-kicked .sk-card{max-width:340px;text-align:center;border:1px solid rgba(120,150,200,.25);' +
      'border-radius:16px;padding:28px 22px;background:rgba(13,19,30,.92);box-shadow:0 12px 40px rgba(0,0,0,.5);}' +
      '#session-kicked .sk-ic{font-size:34px;margin-bottom:8px;}' +
      '#session-kicked h2{font-family:var(--font-display,inherit);font-size:17px;letter-spacing:.08em;' +
      'text-transform:uppercase;color:var(--gold,#e8c05a);margin:0 0 10px;}' +
      '#session-kicked p{font-size:12.5px;line-height:1.65;color:#c7d2e4;margin:0 0 8px;}' +
      '#session-kicked .sk-sub{color:#8b96a8;font-size:11px;}' +
      '#session-kicked b{color:#fff;}' +
      '#session-kicked button{margin-top:12px;width:100%;padding:12px;border-radius:11px;border:0;cursor:pointer;' +
      'font-weight:800;font-size:13px;letter-spacing:.04em;color:#0b0f18;' +
      'background:linear-gradient(180deg,#ffd97a,#e8b23f);}';
    d.appendChild(st);
    document.body.appendChild(d);
    document.getElementById('sk-back').addEventListener('click', () => location.reload());
  }

  // fresh=true → claim (kick everyone else). fresh=false → verify first.
  async function start(user, fresh) {
    const c = client(); if (!c || !user || !user.id || kicked) return;
    uid = user.id;
    if (fresh) {
      await claim(uid);
    } else {
      try {
        const { data, error } = await c.from('active_sessions')
          .select('session_id,device').eq('user_id', uid).maybeSingle();
        if (!error && data && data.session_id && data.session_id !== devId()) { kick(data.device); return; }
      } catch (e) {}
      await claim(uid);   // adopt (first run) / refresh heartbeat
    }
    watch();
  }

  window.SESSIONLOCK = { start, stop, kicked: () => kicked };
})();
