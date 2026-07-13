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
  function setSession(s) { try { localStorage.setItem(SESS, JSON.stringify(s)); } catch (e) {} }

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
    const sso = $('lg-sso-status');
    const go = () => { boot(); reveal(true); };
    if (sso) { sso.style.display = 'block'; sso.textContent = `Signing in…`; setTimeout(go, 450); }
    else go();
  }

  // ---- CLOUD finalize (after a successful Supabase auth) --------------------
  async function finalizeCloud(user, fresh) {
    // single-session rule: a fresh login claims the account (kicking any other
    // device); a restored session first verifies it still owns the account.
    try { if (window.SESSIONLOCK) await window.SESSIONLOCK.start(user, !!fresh); } catch (e) {}
    if (window.__sessionKicked) return;   // lost the account mid-restore → kick screen is up
    const meta = user.user_metadata || {};
    const name = meta.name || meta.full_name || meta.user_name || (user.email ? user.email.split('@')[0] : 'Operator');
    setSession({ method: 'Supabase', name, id: user.id, email: user.email, at: Date.now() });
    const sso = $('lg-sso-status'); if (sso) { sso.style.display = 'block'; sso.textContent = 'Syncing your fleet…'; }
    try { if (window.ACCOUNT) await window.ACCOUNT.pull(); } catch (e) {}
    boot(); reveal(true);
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
    if (s && s.method === 'Supabase') { try { localStorage.removeItem(SESS); } catch (e) {} } // stale token
    window.__cloudPending = false;   // unblock boot; gate stays for the user to sign in
  }

  function wire() {
    const lg = $('login');
    if (!lg) return;

    document.querySelectorAll('.sso').forEach((b) => b.addEventListener('click', async () => {
      if (cloudOn()) {
        try { await window.CLOUD.oauth((b.dataset.sso || '').toLowerCase()); }
        catch (ex) { err('Could not start ' + b.dataset.sso + ' sign-in. Enable this provider in Supabase.'); }
      } else { signInLocal(b.dataset.sso, b.dataset.sso + ' Operator'); }
    }));
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
