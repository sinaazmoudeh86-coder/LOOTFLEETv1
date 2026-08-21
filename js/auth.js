/* =============================================================================
   auth.js — Loot Fleet login gate
   Cloud-aware. When Supabase is configured (window.CLOUD.enabled), this does
   REAL email/password + OAuth sign-in and pulls the player's cloud save before
   booting. When it isn't, it falls back to local per-browser accounts. Guest
   play is always local. The chosen account namespaces its own save (account.js).
   ============================================================================= */
(function () {
  'use strict';
  const SESS = 'io-auth', USERS = 'io-users';
  let mode = 'login';
  const $ = (id) => document.getElementById(id);
  const cloudOn = () => !!(window.CLOUD && window.CLOUD.enabled);
  // A cloud call that never settles used to wedge boot forever (__cloudPending
  // stayed true → blank page). Every await on the boot path is now bounded.
  const TIMED_OUT = { __timeout: true };
  function withTimeout(p, ms, fallback) {
    return Promise.race([
      Promise.resolve(p).catch(() => fallback),
      new Promise((res) => setTimeout(() => res(fallback), ms)),
    ]);
  }

  function getUsers() { try { return JSON.parse(localStorage.getItem(USERS)) || {}; } catch (e) { return {}; } }
  function setUsers(u) { try { localStorage.setItem(USERS, JSON.stringify(u)); } catch (e) {} }
  function getSession() { try { return JSON.parse(localStorage.getItem(SESS)); } catch (e) { return null; } }
  // account.js PINS the signed-in identity per tab (so a login elsewhere can't
  // re-point this tab's save slot) — tell it when THIS tab is the one changing.
  function setSession(s) { try { localStorage.setItem(SESS, JSON.stringify(s)); } catch (e) {} try { if (window.ACCOUNT && window.ACCOUNT.repin) window.ACCOUNT.repin(); } catch (e) {} }

  function reveal(animate) {
    const lg = $('login');
    if (!lg) return;
    if (animate) { lg.classList.add('gone'); setTimeout(() => { lg.style.display = 'none'; }, 420); }
    else { lg.classList.add('gone'); lg.style.display = 'none'; }
    if (window.UI && window.UI.refreshAll) try { window.UI.refreshAll(); } catch (e) {}
  }
  function err(msg) { const e = $('lg-err'); if (e) { e.textContent = msg; e.style.display = msg ? 'block' : 'none'; } }
  function setBusy(b) { const btn = $('lg-submit'); if (btn) { btn.disabled = b; btn.textContent = b ? 'Please wait…' : (mode === 'register' ? 'Create Account' : 'Log In'); } }

  function boot() {
    window.__cloudPending = false;
    if (window.__bootGame) window.__bootGame();
    if (window.ACCOUNT) window.ACCOUNT.refreshBar();
  }

  // ---- LOCAL sign-in (guest, and username accounts when cloud is off) -------
  function signInLocal(method, name) {
    setSession({ method, name, at: Date.now() });
    try { if (window.ACCOUNT) window.ACCOUNT.rebind(); } catch (e) {}
    try { if (window.SESSIONLOCK) window.SESSIONLOCK.claim(); } catch (e) {}
    const sso = $('lg-sso-status');
    const go = () => { boot(); reveal(true); };
    if (sso) { sso.style.display = 'block'; sso.textContent = `Signing in…`; setTimeout(go, 450); }
    else go();
  }

  // ---- CALLSIGNS — WE NEVER PUBLISH A REAL NAME ----------------------------
  // A Google sign-in hands us `user_metadata.name` / `full_name`, which is the
  // person's actual first and last name, and the email local part is usually
  // `firstname.lastname` too. Every one of those used to become the pilot name —
  // and the pilot name is PUBLIC: leaderboards, territory claims, battle reports,
  // the Discord feed. Signing in with Google published your legal name to a game
  // channel, which nobody asked for and nobody expects.
  //
  // New accounts now get a generated callsign instead, and are prompted to choose
  // their own on the first screen. The provider's name is never read.
  //
  // DETERMINISTIC from the account id, so the same account gets the same callsign
  // on every device before it is renamed — a random one per device would make the
  // player look like several different pilots mid-sync.
  const CS_A = ['Void', 'Ash', 'Null', 'Ember', 'Iron', 'Frost', 'Storm', 'Rift', 'Dusk', 'Nova',
                'Grim', 'Pale', 'Vex', 'Onyx', 'Halo', 'Umbra', 'Quill', 'Cinder', 'Wraith', 'Zenith'];
  const CS_B = ['hawk', 'drake', 'fang', 'spur', 'crow', 'lance', 'maul', 'reach', 'vane', 'shard',
                'wolf', 'talon', 'rook', 'kite', 'span', 'thorn', 'coil', 'peak', 'gale', 'harrow'];
  function callsign(seed) {
    let h = 2166136261;
    const s = String(seed || Math.random());
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h = h >>> 0;
    const a = CS_A[h % CS_A.length];
    const b = CS_B[(h >>> 8) % CS_B.length];
    const n = 100 + ((h >>> 16) % 900);            // keeps it unique enough to claim
    return (a + b + '-' + n).slice(0, 16);         // e.g. Voidhawk-417
  }

  // ---- CLOUD finalize (after a successful Supabase auth) --------------------
  async function finalizeCloud(user, fresh) {
    const meta = user.user_metadata || {};
    // ONLY `lf_name` — the name the PLAYER chose through setName(). Provider fields
    // (name, full_name, user_name) and the email are deliberately not consulted:
    // see the callsign note above. A pilot with no chosen name gets a callsign.
    const name = meta.lf_name || callsign(user.id || user.email);
    setSession({ method: 'Supabase', name, id: user.id, email: user.email, at: Date.now() });
    // pin THIS tab to the account it just signed into (account.js), then claim
    // the slot — the newest login kicks any other tab/device on the SAME account
    try { if (window.ACCOUNT) window.ACCOUNT.rebind(); } catch (e) {}
    const sso = $('lg-sso-status'); if (sso) { sso.style.display = 'block'; sso.textContent = 'Syncing your fleet…'; }
    try { if (window.ACCOUNT) await withTimeout(window.ACCOUNT.pull(), 15000, null); } catch (e) {}
    // The pulled SAVE is the last word on the pilot's name. Google's profile name
    // is only ever a first-login default; without this, every sign-in reverted a
    // renamed commander to whatever Google calls them.
    try {
      const saved = window.GAME && window.GAME.state && window.GAME.state.pilotName;
      // SCRUB A LEAKED REAL NAME. Builds before this one adopted the Google profile
      // name automatically, so established accounts are already carrying it in the
      // save and on the public leaderboard. If the stored name MATCHES what the
      // provider calls this person and they never chose it themselves (no `lf_name`
      // — the key setName() writes), it was adopted, not picked: replace it with a
      // callsign and ask them to choose. A name they DID set is left alone, even if
      // it happens to be their real one — that was their decision to make.
      const provider = [meta.name, meta.full_name, meta.user_name,
                        (user.email || '').split('@')[0]].filter(Boolean).map((x) => String(x).toLowerCase());
      // THE SAVE'S OWN nameSet FLAG IS PROOF OF CHOICE, AND IT MUST BE HONOURED.
      //
      // The scrub used to trust ONE signal — meta.lf_name — written by a
      // fire-and-forget updateUser() inside setName(). If that single network
      // call ever failed (offline rename, expired token), the player's save
      // still carried their chosen name and nameSet:true, but the metadata
      // proof was gone. On the next sign-in, anyone whose CHOSEN name matched
      // a provider field — picking your own Google display name, or your email's
      // local part, is common — was misread as a leak and force-renamed to a
      // callsign ("why is my name grimthorn?", verbatim, ticket of Aug 2026).
      //
      // nameSet lives in the save, survives merges (one-way latch union, 684)
      // and does not depend on any single request landing. A name the player
      // set is left alone even when it equals the provider's — that was their
      // decision to make, and the scrub exists for names they never chose.
      const chosen = !!(window.GAME && window.GAME.state && window.GAME.state.nameSet);
      const leaked = !meta.lf_name && !chosen && saved && provider.indexOf(String(saved).toLowerCase()) >= 0;
      // SELF-HEAL THE MISSING PROOF: a chosen name with no lf_name is exactly
      // the failed-write case — re-stamp the metadata so the next sign-in does
      // not depend on the save being consulted first.
      if (chosen && !meta.lf_name && saved) {
        try { if (window.CLOUD && window.CLOUD.client) window.CLOUD.client.auth.updateUser({ data: { lf_name: saved } }); } catch (e) {}
      }
      if (leaked) {
        const cs = callsign(user.id || user.email);
        try {
          window.GAME.state.pilotName = cs;
          window.GAME.state.csTemp = 1;      // forces the naming prompt below
          window.GAME.state.nameSet = false;
          window.GAME.save();
        } catch (e) {}
        const s2 = window.ACCOUNT.session() || {};
        s2.name = cs; setSession(s2);
        try { window.ACCOUNT.refreshBar(); } catch (e) {}
        try { if (window.CLOUD && window.CLOUD.client) window.CLOUD.client.auth.updateUser({ data: { lf_name: cs } }); } catch (e) {}
        try { window.ACCOUNT.push(); } catch (e) {}   // overwrite the leaderboard row
      } else if (saved && saved !== name) {
        const s = window.ACCOUNT.session() || {};
        s.name = saved;
        setSession(s);   // SESS ('io-auth') — writing 'lf_session' here wrote a key nothing reads
        window.ACCOUNT.refreshBar();
        if (window.CLOUD && window.CLOUD.client) window.CLOUD.client.auth.updateUser({ data: { lf_name: saved } });
      }
    } catch (e) {}
    try { if (window.SESSIONLOCK) window.SESSIONLOCK.claim(); } catch (e) {}
    if (window.__sessionKicked) return;   // lost the account mid-restore → kick screen is up
    try { boot(); } catch (ex) {
      try { (window.__lfErr = window.__lfErr || []).push({ kind: 'boot', msg: (ex && ex.message) || String(ex), at: 'finalizeCloud' }); } catch (e) {}
      try { if (window.__lfBootFailed) window.__lfBootFailed('The game could not start.'); } catch (e) {}
    }
    reveal(true);
    // publish the public Ranks row IMMEDIATELY — it must not wait on the save
    // pipeline (see the heartbeat note in account.js)
    setTimeout(() => { try { window.ACCOUNT && window.ACCOUNT.publishNow && window.ACCOUNT.publishNow(); } catch (e) {} }, 2500);
    setTimeout(maybePromptName, 600);   // NEW accounts: pick a commander name first
  }

  // ---- FIRST-LOGIN COMMANDER NAME -------------------------------------------
  // A brand-new account's FIRST action is naming their commander. Shown once:
  // skipped for saves with real progress (existing accounts get flagged silently)
  // and never shown again after confirm (state.nameSet persists in the save).
  function maybePromptName() {
    try {
      const g = window.GAME;
      if (!g || !g.state) { if ((maybePromptName._n = (maybePromptName._n || 0) + 1) < 30) setTimeout(maybePromptName, 400); return; }
      const st = g.state;
      // A GENERATED CALLSIGN IS NOT A CHOSEN NAME. `nameSet` is set silently for any
      // save with real progress, so a veteran whose leaked name was just scrubbed
      // would never be asked — `csTemp` overrides that and always prompts.
      if (st.nameSet && !st.csTemp) return;
      if (!st.csTemp && ((st.level || 1) > 1 || (st.playTime || 0) > 120)) {   // veteran save — don't nag
        st.nameSet = true; try { g.save(); } catch (e) {} return;
      }
      if ($('first-name-gate')) return;
      const s = getSession() || {};
      // The field starts EMPTY on purpose. Pre-filling it with the assigned callsign
      // invites a blind Enter; showing the callsign as the temporary name beside an
      // empty field asks the actual question.
      const temp = (s.name || '').replace(/[^\w .-]/g, '').slice(0, 16);
      const suggested = '';
      const wrap = document.createElement('div');
      wrap.id = 'first-name-gate';
      wrap.innerHTML =
        '<style>#first-name-gate{position:fixed;inset:0;z-index:400;display:grid;place-items:center;padding:20px;background:rgba(5,8,16,.82);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}' +
        '#fng-card{width:100%;max-width:330px;background:linear-gradient(180deg,#141b2b,#0d1220);border:1px solid #2c3a58;border-radius:18px;padding:22px 18px;text-align:center;box-shadow:0 24px 70px rgba(0,0,0,.6);animation:fngUp .35s cubic-bezier(.22,1,.36,1)}' +
        '@keyframes fngUp{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}' +
        '#fng-card h2{font-family:Orbitron,sans-serif;font-size:17px;letter-spacing:.06em;color:#eaf0fa;margin:8px 0 4px}' +
        '#fng-card p{font-size:12px;color:#9fb0c4;line-height:1.5;margin:0 0 14px}' +
        '#fng-in{width:100%;box-sizing:border-box;padding:13px;border-radius:11px;border:1px solid #33456b;background:#0a0f1b;color:#eaf0fa;font-family:Rajdhani,sans-serif;font-size:17px;font-weight:700;text-align:center;letter-spacing:.06em}' +
        '#fng-in:focus{outline:none;border-color:#5b9cff;box-shadow:0 0 0 3px rgba(91,156,255,.18)}' +
        '#fng-err{display:none;color:#ff8a96;font-size:11px;margin-top:7px}' +
        '#fng-temp{font-size:11px;font-weight:700;color:#8fa3bd;margin:0 0 9px;letter-spacing:.02em}' +
        '#fng-temp b{color:#9ad4ff;font-family:Orbitron,sans-serif;font-size:12px}' +
        '#fng-ok{width:100%;margin-top:13px;border:none;border-radius:11px;padding:13px;background:linear-gradient(180deg,#4d94ff,#1f61d8);color:#fff;font-family:Rajdhani,sans-serif;font-weight:800;font-size:15px;letter-spacing:.04em;cursor:pointer}' +
        '#fng-ok:active{transform:scale(.98)}' +
        '#fng-note{font-size:10.5px;color:#67758c;margin-top:10px}</style>' +
        '<div id="fng-card">' +
          '<div style="font-size:34px">☄</div>' +
          '<h2>NAME YOUR COMMANDER</h2>' +
          '<p>This is how the galaxy sees you — leaderboards, territory claims and battle reports all carry it. ' +
            'We never use your real name.</p>' +
          (temp ? '<div id="fng-temp">For now you are <b>' + temp.replace(/</g, '&lt;') + '</b></div>' : '') +
          '<input id="fng-in" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Commander name" value="' + suggested.replace(/"/g, '&quot;') + '">' +
          '<div id="fng-err">2–16 characters — letters, numbers, spaces, . _ -</div>' +
          '<button id="fng-ok">⚔ Enter the galaxy</button>' +
          '<div id="fng-note">You can change it later in Account &amp; Settings.</div>' +
        '</div>';
      document.body.appendChild(wrap);
      const input = wrap.querySelector('#fng-in'), ok = wrap.querySelector('#fng-ok'), fe = wrap.querySelector('#fng-err');
      setTimeout(() => { try { input.focus(); input.select(); } catch (e) {} }, 80);
      const submit = () => {
        const v = (input.value || '').trim().replace(/[^\w .-]/g, '').slice(0, 16);
        if (v.length < 2) { fe.style.display = 'block'; input.value = v; try { input.focus(); } catch (e) {} return; }
        try { if (window.ACCOUNT && window.ACCOUNT.setName) window.ACCOUNT.setName(v); } catch (e) {}
        st.nameSet = true; delete st.csTemp; try { g.save(); } catch (e) {}
        try { if (window.ACCOUNT && window.ACCOUNT.push) window.ACCOUNT.push(); } catch (e) {}   // leaderboard row picks the name up
        wrap.remove();
        try { if (window.UI && window.UI.unlockToast) window.UI.unlockToast('☄ Welcome, Commander ' + v); } catch (e) {}
      };
      ok.addEventListener('click', submit);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    } catch (e) {}
  }

  // OAuth (Google / Apple). CLOUD.oauth() flags the redirect as a FRESH login
  // and hands off to the provider; the browser comes back to this same page and
  // restoreCloud() below picks the session up. Only reachable when Supabase is
  // configured — the buttons stay hidden on the local/offline path.
  function ssoStatus(msg, isErr) {
    const el = $('lg-sso-status'); if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('err', !!isErr);
  }
  async function oauth(provider, label) {
    if (!cloudOn() || !window.CLOUD.oauth) return;
    err(''); ssoStatus('Opening ' + label + '…');
    ['lg-google', 'lg-apple'].forEach((id) => { const b = $(id); if (b) b.disabled = true; });
    try {
      await window.CLOUD.oauth(provider);           // navigates away on success
    } catch (ex) {
      ['lg-google', 'lg-apple'].forEach((id) => { const b = $(id); if (b) b.disabled = false; });
      ssoStatus(prettySSOError(ex, label), true);
    }
  }
  function prettySSOError(ex, label) {
    const m = ((ex && ex.message) || '') + '';
    if (/provider is not enabled|unsupported provider/i.test(m)) return label + ' sign-in isn’t switched on yet.';
    if (/redirect|url/i.test(m)) return label + ' rejected the return address — check the redirect URL.';
    return m || ('Could not reach ' + label + '.');
  }

  function prettyAuthError(ex) {
    const m = (ex && ex.message) || 'Something went wrong.';
    if (/invalid login/i.test(m)) return 'Incorrect email or password.';
    if (/already registered/i.test(m)) return 'That email is already registered — log in instead.';
    if (/rate limit/i.test(m)) return 'Too many attempts — give it a moment.';
    return m;
  }

  async function submitFormCloud(e) {
    if (e) e.preventDefault();
    const email = ($('lg-user').value || '').trim();
    const p = $('lg-pass').value || '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err('Enter a valid email address.');
    if (p.length < 6) return err('Password must be at least 6 characters.');
    err(''); setBusy(true);
    try {
      if (mode === 'register') {
        const r = await window.CLOUD.signUp(email, p);
        if (r.needsConfirm) { setBusy(false); return err('Check your inbox to confirm your email, then log in.'); }
        await finalizeCloud(r.user, true);
      } else {
        const r = await window.CLOUD.signIn(email, p);
        await finalizeCloud(r.user, true);
      }
    } catch (ex) { setBusy(false); err(prettyAuthError(ex)); }
  }

  function submitFormLocal(e) {
    if (e) e.preventDefault();
    const u = ($('lg-user').value || '').trim();
    const p = $('lg-pass').value || '';
    if (u.length < 3) return err('Username must be at least 3 characters.');
    if (p.length < 4) return err('Password must be at least 4 characters.');
    const users = getUsers();
    if (mode === 'register') {
      if (users[u.toLowerCase()]) return err('That username is taken.');
      users[u.toLowerCase()] = { name: u, pw: p };
      setUsers(users);
      signInLocal('Account', u);
    } else {
      const rec = users[u.toLowerCase()];
      if (!rec || rec.pw !== p) return err('Incorrect username or password.');
      signInLocal('Account', rec.name);
    }
  }

  function setMode(m) {
    mode = m;
    // social buttons speak the same language as the tab you're on
    { const t = m === 'register' ? 'Sign up with ' : 'Continue with ';
      const g = $('lg-google-t'), a = $('lg-apple-t');
      if (g) g.textContent = t + 'Google';
      if (a) a.textContent = t + 'Apple'; }
    $('lg-submit').textContent = m === 'register' ? 'Create Account' : 'Log In';
    $('lg-switch-txt').textContent = m === 'register' ? 'Already enlisted?' : 'New here?';
    $('lg-toggle').textContent = m === 'register' ? 'Log in' : 'Create account';
    err('');
  }

  function applyCloudCopy() {
    const u = $('lg-user');
    if (u) { u.placeholder = 'Email'; u.type = 'email'; u.setAttribute('autocomplete', 'email'); }
    const note = document.querySelector('.lg-note');
    if (note) note.textContent = 'Real accounts — your fleet syncs across every device you sign in on.';
    showProviders();
  }
  // Only offer a social button the project has actually switched on. A visible
  // button for a disabled provider is worse than no button — it looks broken.
  // Falls back to showing both if the settings probe fails (better a button
  // that reports a clear error than a login screen missing its main entry).
  async function showProviders() {
    const sso = $('auth-sso'), div = $('auth-or-email');
    let p = null;
    try { p = window.CLOUD.providers ? await window.CLOUD.providers() : null; } catch (e) {}
    const on = (k) => !p || p[k] !== false;
    const g = $('lg-google'), a = $('lg-apple');
    if (g) g.hidden = !on('google');
    if (a) a.hidden = !on('apple');
    const any = (g && !g.hidden) || (a && !a.hidden);
    if (sso) sso.hidden = !any;
    if (div) div.hidden = !any;
  }

  // returning cloud session (incl. OAuth redirect callback) → auto-login
  async function restoreCloud() {
    let user = null, offline = false;
    try { user = await withTimeout(window.CLOUD.getUser(), 9000, TIMED_OUT); } catch (e) {}
    if (user === TIMED_OUT) { offline = true; user = null; }
    if (user) {
      // OAuth redirect lands here — cloud.js flagged it as a fresh login
      let fresh = false;
      try { fresh = localStorage.getItem('lf-claim-next') === '1'; localStorage.removeItem('lf-claim-next'); } catch (e) {}
      await finalizeCloud(user, fresh); return;
    }
    const s = getSession();
    if (s && s.method === 'Guest') { boot(); reveal(false); return; }   // local guest world
    // Supabase unreachable — play the local copy of THIS account. Do NOT treat an
    // unanswered check as a stale token: that signed the player out on bad wifi.
    if (s && s.method === 'Supabase' && offline) { boot(); reveal(false); return; }
    if (s && s.method === 'Supabase') { try { localStorage.removeItem(SESS); if (window.ACCOUNT) window.ACCOUNT.rebind(); } catch (e) {} } // stale token
    window.__cloudPending = false;   // unblock boot; gate stays for the user to sign in
  }

  function wire() {
    const lg = $('login');
    if (!lg) return;

    $('lg-form').addEventListener('submit', (e) => (cloudOn() ? submitFormCloud(e) : submitFormLocal(e)));
    $('lg-toggle').addEventListener('click', () => setMode(mode === 'login' ? 'register' : 'login'));
    $('lg-guest').addEventListener('click', () => signInLocal('Guest', 'Guest Operator'));
    { const g = $('lg-google'); if (g) g.addEventListener('click', () => oauth('google', 'Google')); }
    { const a = $('lg-apple'); if (a) a.addEventListener('click', () => oauth('apple', 'Apple')); }
    setMode('login');

    if (cloudOn()) { applyCloudCopy(); restoreCloud(); }
    else if (getSession()) { lg.style.display = 'none'; }   // local: returning session
  }

  async function signOut() {
    try { if (cloudOn()) await window.CLOUD.signOut(); } catch (e) {}
    try { localStorage.removeItem(SESS); } catch (e) {}
    location.reload();
  }
  // ---- ACCOUNT DELETION (App Review 5.1.1(v)) --------------------------------
  // Deletes cloud rows (save, leaderboard, wallet) + auth user (via the
  // delete-account Edge Function when deployed), then wipes the local save,
  // stored credentials and session. Irreversible.
  async function deleteAccount() {
    const s = getSession() || {};
    try { if (cloudOn() && s.id && window.CLOUD.deleteAccountData) await window.CLOUD.deleteAccountData(s.id); } catch (e) {}
    try {
      const uidKey = s.id ? 'u_' + s.id : (s.name || 'guest').toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_.-]/g, '');
      localStorage.removeItem('infinite-operator-save-v2::' + uidKey);
      const users = getUsers();
      [s.name, (s.name || '').toLowerCase()].forEach((k) => { if (k && users[k]) delete users[k]; });
      setUsers(users);
    } catch (e) {}
    try { if (cloudOn()) await window.CLOUD.signOut(); } catch (e) {}
    try { localStorage.removeItem(SESS); } catch (e) {}
    location.reload();
  }
  function name() { const s = getSession(); return s ? s.name : 'Operator'; }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();

  window.AUTH = { signOut, deleteAccount, name, session: getSession };
})();
