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
    try { await client.from('territory').delete().eq('owner_id', userId); } catch (e) {}   // release EVERY held tile — My Galaxy AND Void Zone
    try { await client.from('saves').delete().eq('user_id', userId); } catch (e) {}
    try { await client.from('save_conflicts').delete().eq('user_id', userId); } catch (e) {}
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
  // like pull, but distinguishes "fetch failed" from "no save row yet" — the
  // sync layer must only unblock cloud writes after a VERIFIED fetch.
  async function pullMeta(userId) {
    try {
      const { data, error } = await client.from('saves').select('data').eq('user_id', userId).maybeSingle();
      if (error) return { ok: false };
      return { ok: true, data: data ? data.data : null };
    } catch (e) { return { ok: false }; }
  }
  async function push(userId, save) {
    try {
      await client.from('saves').upsert(
        { user_id: userId, data: save, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    } catch (e) {}
  }

  // ---- COMPARE-AND-SET saves (supabase/save-cas.sql) -------------------------
  // The blind upsert above is last-write-wins: two live devices silently erase
  // each other. These read/write the row THROUGH its revision instead — a push
  // that isn't based on the current revision is refused and handed the row it
  // missed, so the client can merge and retry. When the migration hasn't been
  // run yet every call reports unsupported and account.js falls back.
  let _casOff = false;
  async function pullSave(userId) {
    if (_casOff) return { ok: false, unsupported: true };
    try {
      const { data, error } = await client.rpc('save_pull');
      if (error) { if (isMissing(error)) _casOff = true; return { ok: false, unsupported: _casOff }; }
      if (!data || data.ok !== true) return { ok: false };
      return { ok: true, data: data.data || null, rev: data.rev | 0 };
    } catch (e) { return { ok: false }; }
  }
  async function pushSave(userId, save, rev, lock) {
    if (_casOff) return { ok: false, unsupported: true };
    try {
      const { data, error } = await client.rpc('save_push', { p_rev: rev == null ? -1 : rev, p_data: save, p_lock: lock || null });
      if (error) { if (isMissing(error)) _casOff = true; return { ok: false, unsupported: _casOff }; }
      if (!data) return { ok: false };
      if (data.ok === true) return { ok: true, rev: data.rev | 0 };
      if (data.conflict) return { ok: false, conflict: true, rev: data.rev | 0, data: data.data || null };
      return { ok: false };
    } catch (e) { return { ok: false }; }
  }
  // quarantine — a timeline that lost a merge is never destroyed
  async function saveConflict(userId, save, reason, weight) {
    try { await client.from('save_conflicts').insert({ user_id: userId, data: save, reason: reason || null, weight: weight || null }); } catch (e) {}
  }

  // ---- session lease (server time is the only clock) -------------------------
  let _leaseOff = false;
  async function claimSession(sessionId, label) {
    if (_leaseOff) return { ok: false, unsupported: true };
    try {
      const { data, error } = await client.rpc('claim_session', { p_session: sessionId, p_device: label || null });
      if (error) { if (isMissing(error)) _leaseOff = true; return { ok: false, unsupported: _leaseOff }; }
      return data && data.ok ? { ok: true, at: data.at, now: data.now, prev: data.prev || null } : { ok: false };
    } catch (e) { return { ok: false }; }
  }
  async function touchSession(sessionId) {
    if (_leaseOff) return { ok: false, unsupported: true };
    try {
      const { data, error } = await client.rpc('touch_session', { p_session: sessionId });
      if (error) { if (isMissing(error)) _leaseOff = true; return { ok: false, unsupported: _leaseOff }; }
      return data && data.ok ? { ok: true, owner: data.owner || sessionId, mine: data.mine !== false && (!data.owner || data.owner === sessionId), at: data.at, now: data.now } : { ok: false };
    } catch (e) { return { ok: false }; }
  }
  // realtime on the LEASE ROW — persisted, so a device that was asleep still
  // learns who owns the account the moment it reconnects
  function onSessionRow(userId, cb) {
    try {
      const ch = client.channel('lf-lease-' + userId)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'active_sessions', filter: 'user_id=eq.' + userId },
            (p) => { try { cb(p && p.new ? p.new : null); } catch (e) {} })
        .subscribe();
      return ch;
    } catch (e) { return null; }
  }
  function isMissing(err) {
    const m = ((err && (err.message || err.details || err.code)) || '') + '';
    return /does not exist|not find|schema cache|PGRST202|42883|42P01/i.test(m);
  }

  // ---- global leaderboard (one public row per user in `leaderboard`) ----------
  // p_asc (Pilot Ascension stars) is sent optimistically — servers that haven't
  // run supabase/pilot-ascension.sql yet reject the extra arg, so we retry
  // without it rather than losing the whole row.
  let _lbNoAsc = false;
  async function lbUpsert(p) {
    try {
      if (!enabled || !p) return;
      const base = {
        p_name: p.name || 'Operator', p_power: Math.round(p.power || 0),
        p_level: p.level || 1, p_zone: p.zone || 1, p_kills: Math.round(p.kills || 0),
        p_fleet: p.fleet || [],
      };
      if (!_lbNoAsc) {
        const { error } = await client.rpc('lb_upsert', Object.assign({ p_asc: (p.asc | 0) }, base));
        if (!error) return;
        _lbNoAsc = true;   // legacy signature — stop trying
      }
      await client.rpc('lb_upsert', base);
    } catch (e) {}
  }
  async function lbTop(n) {
    try {
      if (!enabled) return null;
      let { data, error } = await client.from('leaderboard')
        .select('user_id,name,power,level,zone,kills,fleet,asc_stars')
        .order('power', { ascending: false }).limit(n || 100);
      if (error) {   // column not migrated yet — fall back to the legacy shape
        const r = await client.from('leaderboard')
          .select('user_id,name,power,level,zone,kills,fleet')
          .order('power', { ascending: false }).limit(n || 100);
        data = r.data; error = r.error;
      }
      return error ? null : (data || null);
    } catch (e) { return null; }
  }

  // ---- Server Dreadnaught seasonal boards (one row per user per season) ------
  async function sdUpsert(p) {
    try {
      if (!enabled || !p) return;
      await client.rpc('sdread_upsert', {
        p_name: p.name || 'Operator', p_season: p.season || 1, p_day: p.day || 0,
        p_best: Math.round(p.best || 0), p_total: Math.round(p.total || 0), p_stage: p.stage || 1,
      });
    } catch (e) {}
  }
  async function sdDaily(season, day, n) {
    try {
      if (!enabled) return null;
      const { data, error } = await client.from('sdread_scores')
        .select('user_id,name,best_day,total,stage')
        .eq('season', season || 1).eq('day', day || 0).gt('best_day', 0)
        .order('best_day', { ascending: false }).limit(n || 100);
      return error ? null : (data || null);
    } catch (e) { return null; }
  }
  async function sdSeason(season, n) {
    try {
      if (!enabled) return null;
      const { data, error } = await client.from('sdread_scores')
        .select('user_id,name,best_day,total,stage')
        .eq('season', season || 1).gt('total', 0)
        .order('total', { ascending: false }).limit(n || 100);
      return error ? null : (data || null);
    } catch (e) { return null; }
  }

  window.CLOUD = { enabled, client, signUp, signIn, oauth, signOut, deleteAccountData, getUser, pull, pullMeta, push,
    pullSave, pushSave, saveConflict, claimSession, touchSession, onSessionRow,
    lbUpsert, lbTop, sdUpsert, sdDaily, sdSeason };
})();
