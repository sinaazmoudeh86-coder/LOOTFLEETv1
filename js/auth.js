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

  // ---- CLOUD finalize (after a successful Supabase auth) --------------------
  async function finalizeCloud(user, fresh) {
    const meta = user.user_metadata || {};
    const name = meta.name || meta.full_name || meta.user_name || (user.email ? user.email.split('@')[0] : 'Operator');
    setSession({ method: 'Supabase', name, id: user.id, email: user.email, at: Date.now() });
    // pin THIS tab to the account it just signed into (account.js), then claim
    // the slot — the newest login kicks any other tab/device on the SAME account
    try { if (window.ACCOUNT) window.ACCOUNT.rebind(); } catch (e) {}
    const sso = $('lg-sso-status'); if (sso) { sso.style.display = 'block'; sso.textContent = 'Syncing your fleet…'; }
    try { if (window.ACCOUNT) await window.ACCOUNT.pull(); } catch (e) {}
    try { if (window.SESSIONLOCK) window.SESSIONLOCK.claim(); } catch (e) {}
    if (window.__sessionKicked) return;   // lost the account mid-restore → kick screen is up
    boot(); reveal(true);
    setTimeout(maybePromptName, 600);   // NEW accounts: pick a commander name first
  }

  // ---- FIRST-LOGIN COMMANDER NAME -------------------------------------------
  // A brand-new account's FIRST action is naming their commander. Shown once:
  // skipped for saves with real progress (existing accounts get flagged silently)
  // and never shown again after confirm (state.nameSet persists in the save).
  function maybePromptName() {
    try {
      const g = window.GAME;
      if (!g || !g.state) { setTimeout(maybePromptName, 400); return; }
      const st = g.state;
      if (st.nameSet) return;
      if ((st.level || 1) > 1 || (st.playTime || 0) > 120) {   // veteran save — don't nag
        st.nameSet = true; try { g.save(); } catch (e) {} return;
      }
      if ($('first-name-gate')) return;
      const s = getSession() || {};
      const suggested = (s.name || '').replace(/[^\w .-]/g, '').slice(0, 16);
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
        '#fng-ok{width:100%;margin-top:13px;border:none;border-radius:11px;padding:13px;background:linear-gradient(180deg,#4d94ff,#1f61d8);color:#fff;font-family:Rajdhani,sans-serif;font-weight:800;font-size:15px;letter-spacing:.04em;cursor:pointer}' +
        '#fng-ok:active{transform:scale(.98)}' +
        '#fng-note{font-size:10.5px;color:#67758c;margin-top:10px}</style>' +
        '<div id="fng-card">' +
          '<div style="font-size:34px">☄</div>' +
          '<h2>NAME YOUR COMMANDER</h2>' +
          '<p>This is how the galaxy sees you — leaderboards, territory claims and battle reports all carry it.</p>' +
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
        st.nameSet = true; try { g.save(); } catch (e) {}
        try { if (window.ACCOUNT && window.ACCOUNT.push) window.ACCOUNT.push(); } catch (e) {}   // leaderboard row picks the name up
        wrap.remove();
        try { if (window.UI && window.UI.unlockToast) window.UI.unlockToast('☄ Welcome, Commander ' + v); } catch (e) {}
      };
      ok.addEventListener('click', submit);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    } catch (e) {}
  }

  // OAuth failures— social sign-in was removed from the login screen (no
  // provider is configured), so nothing calls this. Kept out deliberately:
  // see OAUTH-SETUP.md if it ever comes back.
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
  }

  // returning cloud session (incl. OAuth redirect callback) → auto-login
  async function restoreCloud() {
    let user = null;
    try { user = await window.CLOUD.getUser(); } catch (e) {}
    if (user) {
      // OAuth redirect lands here — cloud.js flagged it as a fresh login
      let fresh = false;
      try { fresh = localStorage.getItem('lf-claim-next') === '1'; localStorage.removeItem('lf-claim-next'); } catch (e) {}
      await finalizeCloud(user, fresh); return;
    }
    const s = getSession();
    if (s && s.method === 'Guest') { boot(); reveal(false); return; }   // local guest world
    if (s && s.method === 'Supabase') { try { localStorage.removeItem(SESS); if (window.ACCOUNT) window.ACCOUNT.rebind(); } catch (e) {} } // stale token
    window.__cloudPending = false;   // unblock boot; gate stays for the user to sign in
  }

  function wire() {
    const lg = $('login');
    if (!lg) return;

    $('lg-form').addEventListener('submit', (e) => (cloudOn() ? submitFormCloud(e) : submitFormLocal(e)));
    $('lg-toggle').addEventListener('click', () => setMode(mode === 'login' ? 'register' : 'login'));
    $('lg-guest').addEventListener('click', () => signInLocal('Guest', 'Guest Operator'));
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
