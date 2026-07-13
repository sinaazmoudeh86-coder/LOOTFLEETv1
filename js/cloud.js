/* =============================================================================
   cloud.js — Supabase backend adapter (real accounts + cloud saves)
   ---------------------------------------------------------------------------
   Activates automatically when js/config.public.js has supabaseUrl + anonKey
   AND the supabase-js library is loaded. Otherwise CLOUD.enabled = false and
   the game falls back to local per-browser accounts.

   Exposes window.CLOUD. Load AFTER the supabase-js CDN + config.public.js and
   BEFORE js/account.js.
   ============================================================================= */
(function () {
  'use strict';
  const cfg = window.LOOTFLEET || {};
  let client = null, enabled = false;
  try {
    if (cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase && window.supabase.createClient) {
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      enabled = true;
    }
  } catch (e) { enabled = false; }

  // Block the optimistic local boot until we've checked for a cloud session.
  if (enabled) window.__cloudPending = true;

  // ---- auth -----------------------------------------------------------------
  async function signUp(email, password) {
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw error;
    // If email-confirmation is ON, there's no session yet.
    return { user: data.user, session: data.session, needsConfirm: !data.session };
  }
  async function signIn(email, password) {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return { user: data.user, session: data.session };
  }
  async function oauth(provider) {
    // flag the post-redirect load as a FRESH login so session-lock claims the account
    try { localStorage.setItem('lf-claim-next', '1'); } catch (e) {}
    const { error } = await client.auth.signInWithOAuth({
      provider, options: { redirectTo: location.origin + location.pathname },
    });
    if (error) throw error;
  }
  async function signOut() { try { await client.auth.signOut(); } catch (e) {} }
  // ---- account deletion (App Review 5.1.1(v)) --------------------------------
  // Removes every row keyed to the user, then asks the delete-account Edge
  // Function (service-role) to erase the auth user itself. Each step is
  // best-effort so a missing table/function never blocks the wipe.
  async function deleteAccountData(userId) {
    try { await client.from('saves').delete().eq('user_id', userId); } catch (e) {}
    try { await client.from('leaderboard').delete().eq('user_id', userId); } catch (e) {}
    try { await client.from('wallets').delete().eq('user_id', userId); } catch (e) {}
    try { await client.functions.invoke('delete-account'); } catch (e) {}
    return true;
  }
  async function getUser() {
    try { const { data } = await client.auth.getSession(); return data.session ? data.session.user : null; }
    catch (e) { return null; }
  }

  // ---- cloud save (one row per user in `saves`) -----------------------------
  async function pull(userId) {
    try {
      const { data, error } = await client.from('saves').select('data').eq('user_id', userId).maybeSingle();
      if (error) return null;
      return data ? data.data : null;
    } catch (e) { return null; }
  }
  async function push(userId, save) {
    try {
      await client.from('saves').upsert(
        { user_id: userId, data: save, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    } catch (e) {}
  }

  // ---- global leaderboard (one public row per user in `leaderboard`) ----------
  async function lbUpsert(p) {
    try {
      if (!enabled || !p) return;
      await client.rpc('lb_upsert', {
        p_name: p.name || 'Operator', p_power: Math.round(p.power || 0),
        p_level: p.level || 1, p_zone: p.zone || 1, p_kills: Math.round(p.kills || 0),
        p_fleet: p.fleet || [],
      });
    } catch (e) {}
  }
  async function lbTop(n) {
    try {
      if (!enabled) return null;
      const { data, error } = await client.from('leaderboard')
        .select('user_id,name,power,level,zone,kills,fleet')
        .order('power', { ascending: false }).limit(n || 100);
      return error ? null : (data || null);
    } catch (e) { return null; }
  }

  window.CLOUD = { enabled, client, signUp, signIn, oauth, signOut, deleteAccountData, getUser, pull, push, lbUpsert, lbTop };
})();
