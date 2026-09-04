/* =============================================================================
   update-gate.js — LIVE UPDATE ENFORCEMENT (in session, not just at login)
   -----------------------------------------------------------------------------
   THE PROBLEM THIS SOLVES: the login gate only checked version.json once, at
   page load, and only blocked LOGGING IN. Anyone already playing never learned
   a new build had shipped and kept playing old code indefinitely — the exact
   thing the gate exists to prevent, because stale code on one device is what
   forks a save between iPad and PC.

   WHAT IT DOES
     · Polls version.json (network, never cached) every 90s while the tab is
       visible, and immediately on regaining focus.
     · ANY DISAGREEMENT with window.LF_BUILD triggers a LOCK — not just a newer
       build. version.json is THE build; a client on 741 or 743 is as wrong as a
       client on 739, and an internal device left on a cut that was never pushed
       is exactly the stale-code-forks-the-save case this file exists to stop.
       A BACKWARD move is confirmed by two consecutive polls before it locks, so
       one bad beacon response cannot strand the population on a veil.
     · A LOCK does this:
         1. the fleet is pulled out of combat (goSafeHangar) so nobody dies to
            an overlay, and the run can't keep mutating state we're about to
            discard;
         2. the save is written locally AND pushed to the cloud BEFORE anything
            reloads — no progress is ever lost to an update;
         3. a full-screen blocking veil goes up: nothing behind it is clickable,
            keyboard input is swallowed, and a 60s countdown runs;
         4. at zero (or on the button) the app purges every cache, updates the
            service worker, and reloads onto the new build.
     · The countdown is a courtesy, not an escape hatch — there is no dismiss.
     · IF THREE FORCED RELOADS DO NOT LAND THE NEW BUILD, the auto-reload stops
       and the veil goes manual. That can only happen when something upstream is
       serving a stale document, and a tab that reloads itself forever is worse
       than one that says so. The veil stays up: playing on a build the beacon
       disagrees with is still not allowed.

   Loaded LAST in game.html so window.GAME / ACCOUNT / UI already exist.
   ========================================================================== */
(function () {
  'use strict';
  const POLL_MS = 90000;      // how often we ask, while visible
  const GRACE_S = 60;         // seconds the player gets before the forced reload
  const RKEY = 'lf_update_retry';   // sessionStorage, per tab — a device fact, never the save
  const MAX_FORCED = 3;       // forced reloads for one target before we go manual
  let locked = false, timer = null, tick = null, backSeen = 0;

  const skip = () => location.pathname.indexOf('/serve/') !== -1;   // preview sandbox

  // How many times THIS tab has already force-reloaded toward this build.
  function forced(build) {
    try { const v = JSON.parse(sessionStorage.getItem(RKEY) || '{}'); return (v.b | 0) === build ? (v.n | 0) : 0; }
    catch (e) { return 0; }
  }
  function noteForced(build) {
    try { sessionStorage.setItem(RKEY, JSON.stringify({ b: build, n: forced(build) + 1 })); } catch (e) {}
  }

  async function check() {
    if (locked || skip() || document.hidden) return;
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      const live = j && (j.build | 0), cur = window.LF_BUILD | 0;
      if (!live) return;                       // a malformed beacon is not a build
      if (live === cur) { backSeen = 0; return; }
      if (live > cur) { lock(live); return; }
      // BACKWARD. Legitimate when a number is deliberately re-set, which is why
      // it locks at all — but a single stale or truncated response must never do
      // it, so it takes two consecutive polls that agree.
      if (++backSeen >= 2) lock(live);
    } catch (e) { /* offline — never lock someone out over a failed fetch */ }
  }

  // Everything that must survive the reload happens here, before the veil.
  function secureSave() {
    try { if (window.GAME && window.GAME.goSafeHangar) window.GAME.goSafeHangar(); } catch (e) {}
    try { if (window.GAME && window.GAME.save) window.GAME.save(); } catch (e) {}
    try {
      const st = window.GAME && window.GAME.state;
      if (st && window.ACCOUNT) {
        if (window.ACCOUNT.push) window.ACCOUNT.push(st);
        if (window.ACCOUNT.flushNow) window.ACCOUNT.flushNow();
      }
    } catch (e) {}
  }

  function hardReload(build) {
    const n = forced(build | 0);
    noteForced(build | 0);
    const done = () => {
      // First attempt is a plain reload after the cache purge — the proven path.
      // If we come BACK still on the wrong build, something upstream is handing
      // out a stale document, so escalate to a URL that no cache has ever seen.
      if (n >= 1) {
        try {
          const u = new URL(location.href);
          u.searchParams.set('b', (build | 0) + '.' + n);
          location.replace(u.toString());
          return;
        } catch (e) { /* fall through to a plain reload */ }
      }
      location.reload();
    };
    try {
      Promise.resolve()
        .then(() => ('caches' in window) ? caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))) : null)
        .then(() => (navigator.serviceWorker && navigator.serviceWorker.getRegistration)
          ? navigator.serviceWorker.getRegistration().then((reg) => reg && reg.update()) : null)
        .then(done, done);
      setTimeout(done, 4000);   // never hang on a wedged SW
    } catch (e) { done(); }
  }

  function lock(build) {
    if (locked) return;
    locked = true;
    secureSave();
    injectCss();

    // Three forced reloads toward this build have already failed in this tab, so
    // a fourth fails the same way. Stop the countdown; the veil stays.
    const stuck = forced(build | 0) >= MAX_FORCED;

    const veil = document.createElement('div');
    veil.id = 'lf-update-veil';
    veil.innerHTML =
      '<div class="uv-card" role="alertdialog" aria-live="assertive">' +
        '<div class="uv-ic">\u21bb</div>' +
        '<div class="uv-k">' + (stuck ? 'UPDATE DID NOT LAND' : 'BUILD MISMATCH') + '</div>' +
        '<div class="uv-t">UPDATE REQUIRED</div>' +
        '<p class="uv-s">The live build is <b>' + build + '</b> \u2014 you are on <b>' + (window.LF_BUILD | 0) + '</b>. ' +
          'Playing on a build that is not live can <b>desync your save</b> across devices, so the game is paused here.</p>' +
        '<div class="uv-saved">\u2714 Your progress has been saved and synced.</div>' +
        (stuck
          ? '<div class="uv-cd">Automatic updating did not work on this device. Use the button, or fully close and reopen the app.</div>'
          : '<div class="uv-cd">Updating automatically in <b id="uv-n">' + GRACE_S + '</b>s</div>' +
            '<div class="uv-bar"><i id="uv-bar"></i></div>') +
        '<button class="uv-btn" id="uv-go">\u21bb UPDATE NOW</button>' +
      '</div>';
    document.body.appendChild(veil);
    document.getElementById('uv-go').addEventListener('click', () => hardReload(build));

    // Swallow every input that isn't the update button — no playing on past this.
    const eat = (e) => {
      if (e.target && e.target.closest && e.target.closest('#lf-update-veil')) return;
      e.stopPropagation(); e.preventDefault();
    };
    ['pointerdown', 'pointerup', 'click', 'touchstart', 'keydown', 'wheel'].forEach((t) =>
      window.addEventListener(t, eat, { capture: true, passive: false }));

    if (stuck) return;   // no countdown, no auto-reload — the button is the only route
    let left = GRACE_S;
    const n = document.getElementById('uv-n'), bar = document.getElementById('uv-bar');
    tick = setInterval(() => {
      left--;
      if (n) n.textContent = Math.max(0, left);
      if (bar) bar.style.width = Math.max(0, left / GRACE_S * 100) + '%';
      if (left <= 0) { clearInterval(tick); hardReload(build); }
    }, 1000);
  }

  function injectCss() {
    if (document.getElementById('lf-update-css')) return;
    const s = document.createElement('style');
    s.id = 'lf-update-css';
    s.textContent = `
#lf-update-veil{position:fixed;inset:0;z-index:99999;display:grid;place-items:center;padding:22px;
  background:rgba(4,8,14,.93);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);animation:uvIn .25s ease}
@keyframes uvIn{from{opacity:0}to{opacity:1}}
.uv-card{width:min(360px,100%);text-align:center;border-radius:18px;padding:24px 20px;
  background:linear-gradient(180deg,#16202f,#0e1622);border:1px solid rgba(95,168,255,.5);
  box-shadow:0 24px 60px -20px rgba(0,0,0,.9),0 0 40px -18px rgba(95,168,255,.9)}
.uv-ic{font-size:34px;color:#5fa8ff;line-height:1;animation:uvSpin 2.4s linear infinite}
@keyframes uvSpin{to{transform:rotate(360deg)}}
.uv-k{font-family:'Orbitron',sans-serif;font-weight:900;font-size:9.5px;letter-spacing:.2em;color:#7fb4ff;margin-top:10px}
.uv-t{font-family:'Orbitron',sans-serif;font-weight:900;font-size:22px;letter-spacing:.06em;color:#eaf2ff;margin-top:4px}
.uv-s{font-family:'Rajdhani',sans-serif;font-size:13.5px;line-height:1.5;color:#9fb4cc;margin:10px 0 0;text-wrap:pretty}
.uv-s b{color:#dbe8fa}
.uv-saved{margin-top:12px;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:12.5px;color:#7ce0a0;
  background:rgba(124,224,160,.08);border:1px solid rgba(124,224,160,.34);border-radius:9px;padding:8px 10px}
.uv-cd{margin-top:14px;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:13px;color:#9fb4cc}
.uv-cd b{font-family:'Orbitron',sans-serif;font-size:17px;color:#ffd24d}
.uv-bar{height:5px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden;margin-top:8px}
.uv-bar i{display:block;height:100%;width:100%;border-radius:3px;background:linear-gradient(90deg,#5fa8ff,#ffd24d);transition:width 1s linear}
.uv-btn{width:100%;margin-top:16px;padding:14px;border:none;border-radius:12px;cursor:pointer;
  font-family:'Orbitron',sans-serif;font-weight:900;font-size:13px;letter-spacing:.08em;color:#08131c;
  background:linear-gradient(180deg,#bcdcff,#5fa8ff);box-shadow:0 8px 24px -10px rgba(95,168,255,1)}
.uv-btn:active{transform:scale(.97)}
@media (prefers-reduced-motion:reduce){.uv-ic{animation:none}#lf-update-veil{animation:none}}`;
    document.head.appendChild(s);
  }

  function start() {
    if (skip()) return;
    timer = setInterval(check, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    setTimeout(check, 15000);   // first in-session check shortly after boot
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.UPDATEGATE = { check, lock, _test: () => lock((window.LF_BUILD | 0) + 1) };
})();
