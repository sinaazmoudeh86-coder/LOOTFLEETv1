/* =============================================================================
   servertime.js — LOOTFLEET · TRUSTED CLOCK
   ---------------------------------------------------------------------------
   One job: answer "what time is it, really?" for anything a player could gain by
   lying about it. The Ascension star ceiling rises weekly, so a device clock set
   ten weeks forward would hand out ten weeks of ceiling for free.

   THE ANCHOR IS `server_now()`, A ONE-LINE POSTGRES FUNCTION (supabase/server-now.sql),
   with the `Date` response header as a fallback. `Date` is not a CORS-safelisted
   header, so by the spec a cross-origin fetch cannot read it — but Supabase does
   expose it, so the fallback works today and the migration is an upgrade rather
   than a dependency. The function is still worth running: the header carries only
   whole seconds, while the function is microsecond-precise. Half the round trip is
   added back either way, which puts the anchor within ~100ms.

   THE CLOCK THAT TICKS IS `performance.now()`, NOT `Date.now()`.
   performance.now() is monotonic and measured from page load; it does not move
   when the user changes the system clock, change timezone, or spring forward. So
   once an anchor lands, moving the device clock mid-session does nothing at all:

       now() = anchorServerMs + (performance.now() - anchorPerfMs)

   WITH NO ANCHOR, TIME DOES NOT ADVANCE PAST WHAT THE SERVER LAST CONFIRMED.
   The highest server instant ever seen is persisted as a high-water mark, and an
   unverified session is clamped to it. An offline player's ceiling therefore
   freezes at the last verified week rather than rising on their own clock. That
   is the right trade: the ceiling is a live schedule, and ascending publishes to
   the server anyway, so anyone who can use the ceiling can reach the server.

   The high-water mark is also a floor, so winding the clock BACKWARD cannot undo
   anything either.

   IT MUST NEVER BRICK ASCENSION. If the backend has no time source at all — the
   migration has not been run, the player is offline on a fresh install, the request
   is blocked — the module degrades to the device clock and says so, rather than
   refusing to give an answer. A soft ceiling is a balance problem; a hard block on
   a permanent progression action is a support incident. `mode()` reports which
   clock is in use, and every ascension records whether it was server-verified
   (`pasc.hist[].srv`), so an unverified ladder is auditable after the fact.

   WHAT THIS CANNOT DO. It is client code; a determined attacker with devtools can
   set any value they like in their own memory. What it does do is make the attack
   require code injection rather than the Settings app, and keep honest players
   correct across timezones, DST and stale tabs.
   ========================================================================== */
(function () {
  'use strict';
  // Same global cloud.js reads (window.LOOTFLEET, set by config.live.js). Accepts
  // the alternate name too so this file cannot silently no-op if that is renamed.
  const cfg = window.LOOTFLEET || window.LF_CONFIG || {};
  const HW_KEY = 'lf_stime_hw';      // highest server ms ever seen on this device
  const FIRST_KEY = 'lf_stime_first'; // first server ms ever seen (account age floor)
  const RESYNC_MS = 15 * 60 * 1000;  // re-anchor every 15 min while the tab lives
  const MAX_RTT = 8000;              // a reply slower than this is too vague to trust

  let anchorServer = 0;   // server ms at the moment of the anchor
  let anchorPerf = 0;     // performance.now() at that same moment
  let trusted = false;    // anchored on the SERVER this session
  let syncing = false;
  let tried = false;      // at least one attempt has completed (success or not)
  let lastTry = 0;
  let lastErr = '';
  const listeners = [];

  const perf = () => (window.performance && performance.now) ? performance.now() : (Date.now() - _bootWall);
  const _bootWall = Date.now();

  function readHW() { try { return +localStorage.getItem(HW_KEY) || 0; } catch (e) { return 0; } }
  function writeHW(ms) {
    try {
      if (ms > readHW()) localStorage.setItem(HW_KEY, String(Math.floor(ms)));
      if (!+localStorage.getItem(FIRST_KEY)) localStorage.setItem(FIRST_KEY, String(Math.floor(ms)));
    } catch (e) {}
  }

  // WHICH CLOCK IS ANSWERING:
  //   'server' — anchored on the backend this session, ticking monotonically
  //   'held'   — no anchor, but this device has seen the server before: frozen at
  //              that instant, so a forward-set clock buys nothing
  //   'device' — never seen a server on this device: the local clock, untrusted
  function mode() { return trusted ? 'server' : (readHW() ? 'held' : 'device'); }

  // THE ONE FUNCTION EVERYTHING ELSE CALLS.
  function now() {
    if (trusted) {
      const t = anchorServer + (perf() - anchorPerf);
      // the anchor can only ever be corrected forward within a session
      return t > anchorServer ? t : anchorServer;
    }
    const hw = readHW();
    if (hw) {
      // NOT VERIFIED THIS SESSION — hold at the last instant the server confirmed,
      // but never report EARLIER than it either, so winding the clock back is inert.
      // Deliberately does not add local elapsed time: that is the whole exploit.
      const dev = Date.now();
      return dev > hw ? hw : hw;
    }
    // Never seen a server on this device. Nothing to check against, so the local
    // clock is all there is — reported as 'device' so callers can label it.
    return Date.now();
  }

  // Skew is reported for diagnostics only. A large value is not an accusation:
  // phones drift, and a stale tab can be minutes off.
  function skew() { return trusted ? Math.round(now() - Date.now()) : 0; }

  async function sync(force) {
    if (syncing) return trusted;
    if (!force && trusted && perf() - anchorPerf < RESYNC_MS) return true;
    if (!force && Date.now() - lastTry < 20000) return trusted;   // don't hammer on failure
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) { lastErr = 'no backend configured'; tried = true; return false; }
    syncing = true; lastTry = Date.now();
    try {
      const t0 = perf();
      // `server_now()` — supabase/server-now.sql. A body, not a header, because the
      // browser will not let us read `Date` cross-origin. `cache: 'no-store'` and
      // POST both matter: a cached answer would anchor us in the past.
      const r = await fetch(cfg.supabaseUrl + '/rest/v1/rpc/server_now', {
        method: 'POST', cache: 'no-store',
        headers: { apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + cfg.supabaseAnonKey,
                   'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{}',
      });
      const t1 = perf();
      let ms = NaN;
      if (r.ok) {
        const body = await r.text();
        // returns either a bare JSON string or {"server_now": "..."} depending on
        // how PostgREST frames a scalar; accept both, and a bare epoch number too.
        let v = null;
        try { const j = JSON.parse(body); v = (j && typeof j === 'object') ? (j.server_now || j.now || null) : j; }
        catch (e) { v = body.replace(/^"|"$/g, ''); }
        ms = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v);
      }
      // FALLBACK: the Date header. Normally unreadable cross-origin, but Supabase
      // does expose it, so this path works even before server-now.sql is run — which
      // is why the migration is not a hard dependency. It is only WHOLE SECONDS, so
      // the true instant is somewhere inside that second: +500ms centres it instead
      // of biasing every anchor up to a second early.
      if (!isFinite(ms)) {
        const hdr = r.headers.get('date');
        if (hdr) { const p = Date.parse(hdr); if (isFinite(p)) ms = p + 500; }
      }
      if (!isFinite(ms)) throw new Error(r.ok ? 'no usable time in reply' : ('server_now unavailable (' + r.status + ') — run supabase/server-now.sql'));
      const rtt = t1 - t0;
      if (rtt > MAX_RTT) throw new Error('round trip too slow (' + Math.round(rtt) + 'ms)');
      anchorServer = ms + rtt / 2;   // half the round trip covers the flight home
      anchorPerf = t1;
      trusted = true; lastErr = '';
      writeHW(anchorServer);
      listeners.forEach((fn) => { try { fn(); } catch (e) {} });
      return true;
    } catch (e) {
      lastErr = (e && e.message) || 'sync failed';
      return false;
    } finally { syncing = false; tried = true; listeners.forEach((fn) => { try { fn(); } catch (e) {} }); }
  }

  function onSync(fn) { if (typeof fn === 'function') listeners.push(fn); }

  // ---- UTC WEEK HELPERS ------------------------------------------------------
  // Shared so the ceiling and anything else scheduled weekly cannot drift apart.
  const WEEK_MS = 604800000;
  function weeksSince(epochMs) { return Math.max(0, Math.floor((now() - epochMs) / WEEK_MS)); }
  function nextBoundary(epochMs) { return epochMs + (weeksSince(epochMs) + 1) * WEEK_MS; }
  function msUntil(ms) { const d = ms - now(); return d > 0 ? d : 0; }

  window.SERVERTIME = {
    now, sync, onSync, skew, weeksSince, nextBoundary, msUntil, WEEK_MS, mode,
    trusted: () => trusted,
    // USABLE means "we have an answer we are willing to act on". True once a sync
    // has been attempted, whatever the outcome — a backend without the migration,
    // or a player with no signal, must not be locked out of a permanent
    // progression action. Callers gate on this and label with mode().
    usable: () => trusted || tried || !!readHW(),
    state: () => ({ mode: mode(), trusted, syncing, tried, skew: skew(), hw: readHW(),
      first: (() => { try { return +localStorage.getItem(FIRST_KEY) || 0; } catch (e) { return 0; } })(), err: lastErr }),
  };

  // Anchor as early as possible, then keep it fresh. Re-anchor when the tab comes
  // back: a backgrounded tab can be frozen for hours, and it is also the moment a
  // clock change is most likely to have happened.
  sync(true);
  setInterval(() => sync(false), RESYNC_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(true); });
  window.addEventListener('online', () => sync(true));
})();
