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
  // WHICH PROVIDERS ARE ACTUALLY ON. /auth/v1/settings is public and lists every
  // external provider the project has enabled. Without this the login screen
  // offers buttons that dead-end in "that provider isn't switched on yet" — the
  // player can't tell a misconfigured button from a broken one.
  let _prov = null, _provAt = 0;
  async function providers() {
    if (_prov && Date.now() - _provAt < 300000) return _prov;
    try {
      const r = await fetch(cfg.supabaseUrl + '/auth/v1/settings', { headers: { apikey: cfg.supabaseAnonKey } });
      if (!r.ok) return null;
      const j = await r.json();
      _prov = (j && j.external) || null; _provAt = Date.now();
      return _prov;
    } catch (e) { return null; }
  }
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
  //
  // JUL 2026 — why this got careful: a SINGLE failed p_asc call used to latch the
  // fallback on for the rest of the session. And while both lb_upsert overloads
  // existed server-side (6-arg from leaderboard.sql, 7-arg from
  // pilot-ascension.sql), the 6-arg call is AMBIGUOUS — PostgREST can't choose a
  // candidate and rejects it — so a latched client stopped publishing its row at
  // all: no stars for anyone else to see, and a board that looked empty.
  // See supabase/lb-upsert-canonical.sql for the server half.
  let _lbNoAsc = false, _lbAscRetryAt = 0, _lbFails = 0, _lbWarned = false;
  // Ladder columns degrade on their own flag so a server with stars but without
  // ranks-ladders.sql keeps publishing stars.
  let _lbNoLadder = false, _lbLadderRetryAt = 0;
  let _lbNoCargo = false, _lbCargoRetryAt = 0;
  let _lbNoNano = false, _lbNanoRetryAt = 0;
  let _lbNoArt = false, _lbArtRetryAt = 0, _lbArtWarned = false;
  let _lbNoNew = false, _lbNewRetryAt = 0, _lbNewWarned = false;
  let _lbNoPilot = false, _lbPilotRetryAt = 0, _lbPilotWarned = false;
  let _lbNoMech = false, _lbMechRetryAt = 0, _lbMechWarned = false;
  // WHICH COLUMN SET THE LAST SUCCESSFUL BOARD READ ACTUALLY RETURNED.
  // The ladders need to know whether a migration has run, and inspecting the
  // returned ROWS cannot tell them: the caller merges the player's own live save
  // over their row, so the new fields are always present on that one, and every
  // other row is skipped precisely because it might be simulated. On a board with
  // few published humans there is no row left to probe and the ladder stays
  // 'waiting on a migration' forever, even after the SQL has run. The SELECT that
  // succeeded is the authoritative answer, so record it here.
  let _lbShape = '';
  function lbFail(where, err) {
    _lbFails++;
    // A row that never publishes makes the player INVISIBLE on Ranks while they
    // play normally — alliances and territory work fine without one, so nothing
    // else complains. That went unnoticed for a long time; say it out loud.
    if (_lbFails >= 3 && !_lbWarned) {
      _lbWarned = true;
      try { console.warn('[LOOTFLEET] leaderboard row is not publishing (' + _lbFails + ' failures). You will not appear on Ranks.', where, err); } catch (e) {}
    }
  }
  // A genuinely MISSING function/signature means the server predates a
  // migration. Ambiguity, network blips and RLS errors must not be mistaken for
  // it — those are transient and should retry, not permanently downgrade.
  function isLegacy(error) {
    const msg = ((error.message || '') + ' ' + (error.code || '') + ' ' + (error.hint || '')).toLowerCase();
    return msg.indexOf('pgrst202') !== -1 || msg.indexOf('42883') !== -1 ||
           msg.indexOf('does not exist') !== -1 || msg.indexOf('could not find') !== -1;
  }
  // A CASCADE DOWN EVERY RUNG IS NOT AN OLD SERVER — IT IS A BAD PAYLOAD.
  //
  // isLegacy() answers "is this ONE signature missing", which is the right
  // question for a single rung: the server predates that migration, mark it off,
  // try the next. It is the wrong question when EVERY rung 202s in the same
  // publish, because the only thing all the rungs share is `base` — so a stale
  // key there (see the p_fleet note below) degrades the client all the way to a
  // shape that has not existed for years, and the console then blames a
  // migration that ran correctly. That misdiagnosis cost two days.
  //
  // Counting the fall is enough to tell them apart: one or two rungs off is a
  // server behind on migrations, all of them is our own payload. Say so once,
  // plainly, instead of printing a different "run this .sql" warning per rung.
  let _lbCascade = 0, _lbCascadeSaid = false;
  function noteRungMissing(rung) {
    _lbCascade++;
    if (_lbCascade >= 4 && !_lbCascadeSaid) {
      _lbCascadeSaid = true;
      try {
        console.error('[LOOTFLEET] EVERY lb_upsert rung reports "function not found" (last: ' + rung + '). '
          + 'That is not a missing migration — a signature the server really lacks would stop at ONE rung. '
          + 'It means the shared `base` payload contains a parameter lb_upsert does not declare, so PostgREST '
          + 'cannot match any overload. Compare the keys in base/ladder/art/fresh/tree against the CREATE '
          + 'FUNCTION in supabase/pilot-ladder.sql. Do NOT re-run migrations first.');
      } catch (e) {}
    }
  }
  function noteRungOk() { _lbCascade = 0; }
  // BIG NUMBERS ON THE WIRE. Late-game fleet power reaches ~1e29, and two things
  // then go wrong on the way to Postgres:
  //   · JS serialises anything past ~1e21 in exponential notation ("2.3e+29"),
  //     which an integer column will not parse — hundreds of 22P02 errors an hour,
  //     and the player's row silently stops updating on every ladder.
  //   · Infinity/NaN out of a broken stat calc serialise as null or "Infinity"
  //     and fail the same way.
  // BigInt — NOT toFixed(0), which itself switches to exponential notation at 1e21
  // and up and so fails on exactly the magnitudes that caused the problem. BigInt
  // stringifies plain decimal digits at any size, in a form numeric always accepts.
  // (Columns and parameters are numeric as of bignum-power-fix.sql; this keeps the
  // payload clean regardless of which server version is live.)
  function bignum(v) {
    const n = Number(v);
    if (!isFinite(n) || n <= 0) return 0;
    if (n < 1e15) return Math.round(n);
    try { return BigInt(Math.trunc(n)).toString(); } catch (e) { return Math.round(n); }
  }

  async function lbUpsert(p) {
    try {
      if (!enabled || !p) return;
      // LAST-DITCH SORT-KEY GUARD. The row is a full overwrite and `power` orders
      // the whole board, so a zero here does not mean "weak pilot", it means
      // "invisible pilot" — the row sorts below every sim and falls out of the
      // top 100 the UI asks for. publishLb already keeps a last-good value; this
      // catches any other caller that hands us an unusable reading.
      const pw = Number(p.power);
      if ((!isFinite(pw) || pw <= 0) && ((p.level || 1) > 1 || (p.kills || 0) > 0)) return;
      const base = {
        p_name: p.name || 'Operator', p_power: bignum(p.power),
        p_level: p.level || 1, p_zone: p.zone || 1, p_kills: bignum(p.kills),
      };
      // NO p_fleet. It was removed from lb_upsert's signature by new-ladders.sql
      // and is absent from pilot-ladder.sql, but this object kept sending it —
      // and `base` is merged into EVERY rung, so one obsolete parameter made
      // PostgREST fail to match ANY overload. Every rung 404'd with PGRST202,
      // isLegacy() read that as "older server" and walked the ladder to the
      // bottom, and the last error printed `base` alone (p_fleet, p_level,
      // p_name, p_power, p_zone) — which reads like a legacy 6-arg call and sent
      // the diagnosis the wrong way for two days.
      //
      // Live from the day new-ladders.sql shipped. Nobody's row published in that
      // window; the boards were frozen, not slow.
      //
      // THE RULE: `base` is the ONE payload every rung inherits, so a stale key
      // here breaks all of them at once. Anything removed from the SQL signature
      // must be removed here in the same change.
      if (_lbNoAsc && Date.now() > _lbAscRetryAt) _lbNoAsc = false;   // re-arm
      if (_lbNoLadder && Date.now() > _lbLadderRetryAt) _lbNoLadder = false;
      if (_lbNoCargo && Date.now() > _lbCargoRetryAt) _lbNoCargo = false;
      if (_lbNoNano && Date.now() > _lbNanoRetryAt) _lbNoNano = false;
      if (_lbNoArt && Date.now() > _lbArtRetryAt) _lbNoArt = false;
      if (_lbNoNew && Date.now() > _lbNewRetryAt) _lbNoNew = false;
      if (_lbNoPilot && Date.now() > _lbPilotRetryAt) _lbNoPilot = false;

      // LADDER COLUMNS (Aug 2026) — tried FIRST and degraded independently of
      // p_asc. Folding them into the p_asc attempt would mean a server with
      // stars but without ranks-ladders.sql reads as "legacy" and silently stops
      // publishing ascension stars — the exact bug the p_asc cascade was written
      // to prevent.
      const ladder = (p.tiles !== undefined || p.missions !== undefined) ? {
        p_tiles: p.tiles | 0, p_citadels: p.citadels | 0,
        p_tile_rev: bignum(p.tile_rev),
        p_ships: p.ships | 0, p_missions: p.missions | 0, p_badges: p.badges | 0,
      } : null;
      // ART FIELDS (discord-art-publish.sql). DECLARED HERE, ABOVE EVERY RUNG
      // THAT READS IT.
      //
      // This block used to sit BELOW the hcwave/expo rung that tests `art` in its
      // condition. `const` is in the temporal dead zone until its declaration
      // runs, so that test threw `ReferenceError: Cannot access 'art' before
      // initialization` on EVERY publish — and the whole function is wrapped in
      // `catch (e) { lbFail('throw', e) }`, which turned a coding error into a
      // silent, permanent publish failure. Not a degraded rung: no rung ran at
      // all, so nothing was ever marked off and CLOUD.lbState() showed a clean
      // ladder while the row had not moved since the rung was added.
      //
      // Same shape as the `_lbShape = shape` ReferenceError that killed all three
      // Voidmaw reads, in this same file: a bare catch around a whole function
      // body hides a coding error exactly as well as it hides a network one.
      //
      // WHY THIS RUNG EXISTS AT ALL: the columns were added, the client computed
      // hull_last / nano_last / cargo_tier, and the feed selected them by name —
      // but lb_upsert enumerates its params, so the widest overload silently
      // discarded all three. Every row kept an empty hull_last, and the NEW HULL
      // card posted with no sprite and the title "the a new hull". A card firing
      // with no art is the symptom of a dropped WRITE, not a dropped read.
      const art = (p.hull_last !== undefined || p.nano_last !== undefined || p.cargo_tier !== undefined) ? {
        p_hull_last: String(p.hull_last || '').slice(0, 32),
        p_nano_last: String(p.nano_last || '').slice(0, 32),
        p_cargo_tier: Math.max(0, Math.min(5, p.cargo_tier | 0)),
      } : null;
      // NEW LADDERS (new-ladders.sql) — Home Defense wave and Exploration runs.
      // The topmost rung, tried before ART. Same five-minute back-off as ART and
      // for the same reason: this is the rung currently rolling out, so a refusal
      // usually means "the SQL has not run yet" or "PostgREST has not reloaded",
      // both measured in minutes, not the standing six-hour fact the lower rungs
      // are describing.
      const fresh = (p.hcwave !== undefined || p.expo !== undefined) ? {
        p_hcwave: Math.max(0, Math.min(100000, p.hcwave | 0)),
        p_expo: Math.max(0, p.expo | 0),
        p_expo_best: Math.max(0, p.expo_best | 0),
      } : null;
      // PILOT TREE (pilot-ladder.sql) — now the topmost rung, tried before the
      // new-ladders rung for the same reason that one sits above ART: it is the
      // one currently rolling out, so a refusal means minutes, not the standing
      // six-hour fact the lower rungs describe. Math.floor(Number(x) || 0) and
      // NOT `| 0` — the score is bounded well under 2^31 today, but this is a
      // published progression figure and the bitwise habit is what wraps them.
      const tree = (p.pilot_score !== undefined) ? {
        p_pilot_score: Math.max(0, Math.min(1e9, Math.floor(Number(p.pilot_score) || 0))),
        p_pilot_nodes: Math.max(0, Math.min(1e6, Math.floor(Number(p.pilot_nodes) || 0))),
      } : null;
      // Lifetime Mech Cores EARNED. Declared HERE, above the first rung that reads
      // it — the 'art' bug that froze every publish for twenty-four builds was a
      // const declared below its own condition, hitting the temporal dead zone.
      const mech = (p.mech_cores !== undefined) ? {
        p_mech_cores: Math.max(0, Math.min(1e12, Math.floor(Number(p.mech_cores) || 0))),
      } : null;
      // NEWEST RUNG FIRST. mech-ladder.sql is a strict superset of pilot-ladder,
      // so this rung carries everything the one below it does plus p_mech_cores;
      // if the server has not run it, we fall through and the Foundry board simply
      // reports as not-yet-live rather than the whole publish failing.
      if (mech && tree && fresh && art && ladder && !_lbNoLadder && !_lbNoCargo && !_lbNoNano && !_lbNoArt && p.nano_legend !== undefined && !_lbNoNew && !_lbNoPilot && !_lbNoMech) {
        const { error } = await client.rpc('lb_upsert',
          Object.assign({ p_asc: (p.asc | 0), p_cargo: p.cargo | 0, p_cargo_best: p.cargo_best | 0,
            p_nano_legend: p.nano_legend | 0, p_nano_slots: p.nano_slots | 0, p_nano_god: p.nano_god | 0 },
            base, ladder, art, fresh, tree, mech));
        if (!error) { _lbFails = 0; noteRungOk(); return; }
        if (!isLegacy(error)) { lbFail('mech', error); return; }
        noteRungMissing('mech');
        _lbNoMech = true; _lbMechRetryAt = Date.now() + 5 * 60 * 1000;
        if (!_lbMechWarned) {
          _lbMechWarned = true;
          try {
            console.warn('[LOOTFLEET] leaderboard mech_cores rejected \u2014 the Mech Foundry ladder will rank every human at zero. '
              + 'Run supabase/mech-ladder.sql, then "notify pgrst, \'reload schema\';". Retrying automatically every 5 minutes. '
              + 'Inspect with CLOUD.lbState().');
          } catch (e) {}
        }
      }
      if (tree && fresh && art && ladder && !_lbNoLadder && !_lbNoCargo && !_lbNoNano && !_lbNoArt && p.nano_legend !== undefined && !_lbNoNew && !_lbNoPilot) {
        const { error } = await client.rpc('lb_upsert',
          Object.assign({ p_asc: (p.asc | 0), p_cargo: p.cargo | 0, p_cargo_best: p.cargo_best | 0,
            p_nano_legend: p.nano_legend | 0, p_nano_slots: p.nano_slots | 0, p_nano_god: p.nano_god | 0 },
            base, ladder, art, fresh, tree));
        if (!error) { _lbFails = 0; noteRungOk(); return; }
        if (!isLegacy(error)) { lbFail('pilot', error); return; }
        noteRungMissing('pilot');
        _lbNoPilot = true; _lbPilotRetryAt = Date.now() + 5 * 60 * 1000;
        if (!_lbPilotWarned) {
          _lbPilotWarned = true;
          try {
            console.warn('[LOOTFLEET] leaderboard pilot_score / pilot_nodes rejected — the Pilot Tree ladder will rank every human at zero. '
              + 'Run supabase/pilot-ladder.sql, then "notify pgrst, \'reload schema\';". Retrying automatically every 5 minutes. '
              + 'Inspect with CLOUD.lbState().');
          } catch (e) {}
        }
      }
      if (fresh && art && ladder && !_lbNoLadder && !_lbNoCargo && !_lbNoNano && !_lbNoArt && p.nano_legend !== undefined && !_lbNoNew) {
        const { error } = await client.rpc('lb_upsert',
          Object.assign({ p_asc: (p.asc | 0), p_cargo: p.cargo | 0, p_cargo_best: p.cargo_best | 0,
            p_nano_legend: p.nano_legend | 0, p_nano_slots: p.nano_slots | 0, p_nano_god: p.nano_god | 0 },
            base, ladder, art, fresh));
        if (!error) { _lbFails = 0; noteRungOk(); return; }
        if (!isLegacy(error)) { lbFail('new', error); return; }
        noteRungMissing('new');
        _lbNoNew = true; _lbNewRetryAt = Date.now() + 5 * 60 * 1000;
        if (!_lbNewWarned) {
          _lbNewWarned = true;
          try {
            console.warn('[LOOTFLEET] leaderboard hcwave / expo rejected — the Home Defense and Exploration ladders will rank every human at zero. '
              + 'Run supabase/new-ladders.sql, then "notify pgrst, \'reload schema\';". Retrying automatically every 5 minutes. '
              + 'Inspect with CLOUD.lbState().');
          } catch (e) {}
        }
      }
      // ART FIELDS — the rung itself. The declaration is above, with the rest of
      // the payload builders, so every rung that tests it can see it.
      if (art && ladder && !_lbNoLadder && !_lbNoCargo && !_lbNoNano && p.nano_legend !== undefined && !_lbNoArt) {
        const { error } = await client.rpc('lb_upsert',
          Object.assign({ p_asc: (p.asc | 0), p_cargo: p.cargo | 0, p_cargo_best: p.cargo_best | 0,
            p_nano_legend: p.nano_legend | 0, p_nano_slots: p.nano_slots | 0, p_nano_god: p.nano_god | 0 },
            base, ladder, art));
        if (!error) { _lbFails = 0; noteRungOk(); return; }
        if (!isLegacy(error)) { lbFail('art', error); return; }
        noteRungMissing('art');
        // FIVE MINUTES, NOT SIX HOURS. Every other rung backs off for six hours
        // because a missing migration is a standing fact about that server. This
        // rung is different: it is the one being rolled out, so its failure is
        // usually "the SQL has not run YET" or "PostgREST has not reloaded its
        // schema cache yet" — both measured in minutes. A six-hour back-off meant
        // the client kept publishing without art long after the server was fixed,
        // and only a page reload could clear it. That turned a two-step deploy
        // into an ordering puzzle: reload the schema BEFORE the browser, or the
        // flag simply set itself again.
        _lbNoArt = true; _lbArtRetryAt = Date.now() + 5 * 60 * 1000;
        if (!_lbArtWarned) {
          _lbArtWarned = true;
          try {
            console.warn('[LOOTFLEET] leaderboard art fields rejected — hull_last / nano_last / cargo_tier are NOT being published, so Discord cards post without art. '
              + 'Run supabase/discord-art-publish.sql, then "notify pgrst, \'reload schema\';". Retrying automatically every 5 minutes. '
              + 'Inspect with CLOUD.lbState().');
          } catch (e) {}
        }
      }
      // NANOCORE COLUMNS — the rung below ART, degrading on their own flag: a
      // server with cargo-ladder.sql but not nanocore-ladder.sql keeps publishing
      // haulage and every other ladder untouched.
      if (ladder && !_lbNoLadder && !_lbNoCargo && p.nano_legend !== undefined && !_lbNoNano) {
        const { error } = await client.rpc('lb_upsert',
          Object.assign({ p_asc: (p.asc | 0), p_cargo: p.cargo | 0, p_cargo_best: p.cargo_best | 0,
            p_nano_legend: p.nano_legend | 0, p_nano_slots: p.nano_slots | 0, p_nano_god: p.nano_god | 0 }, base, ladder));
        if (!error) { _lbFails = 0; noteRungOk(); return; }
        if (!isLegacy(error)) { lbFail('nano', error); return; }
        noteRungMissing('nano');
        _lbNoNano = true; _lbNanoRetryAt = Date.now() + 6 * 3600 * 1000;
      }
      // HAULAGE COLUMNS degrade on their own flag, exactly like the tiers below:
      // a server that has ranks-ladders.sql but not cargo-ladder.sql keeps
      // publishing every other ladder untouched.
      if (ladder && !_lbNoLadder && p.cargo !== undefined && !_lbNoCargo) {
        const { error } = await client.rpc('lb_upsert',
          Object.assign({ p_asc: (p.asc | 0), p_cargo: p.cargo | 0, p_cargo_best: p.cargo_best | 0 }, base, ladder));
        if (!error) { _lbFails = 0; noteRungOk(); return; }
        if (!isLegacy(error)) { lbFail('cargo', error); return; }
        noteRungMissing('cargo');
        _lbNoCargo = true; _lbCargoRetryAt = Date.now() + 6 * 3600 * 1000;
      }
      if (ladder && !_lbNoLadder) {
        const { error } = await client.rpc('lb_upsert',
          Object.assign({ p_asc: (p.asc | 0) }, base, ladder));
        if (!error) { _lbFails = 0; noteRungOk(); return; }
        if (!isLegacy(error)) { lbFail('ladder', error); return; }
        noteRungMissing('ladder');
        _lbNoLadder = true; _lbLadderRetryAt = Date.now() + 6 * 3600 * 1000;
      }
      if (!_lbNoAsc) {
        const { error } = await client.rpc('lb_upsert', Object.assign({ p_asc: (p.asc | 0) }, base));
        if (!error) { _lbFails = 0; noteRungOk(); return; }
        // Only a genuinely missing function means "legacy server". Ambiguity,
        // network blips and RLS errors must NOT disable stars.
        if (!isLegacy(error)) { lbFail('p_asc', error); return; }  // keep p_asc; retry next save
        _lbNoAsc = true; _lbAscRetryAt = Date.now() + 6 * 3600 * 1000;
      }
      const { error: e2 } = await client.rpc('lb_upsert', base);
      if (e2) { _lbNoAsc = false; _lbAscRetryAt = 0; lbFail('6-arg', e2); }   // 6-arg failed too — go back to p_asc
      else _lbFails = 0;
    } catch (e) {
      // A THROW HERE IS A CODING ERROR, NOT A NETWORK ONE — network failures come
      // back as `error` on the response and are handled per rung above. Say which
      // it was rather than folding it into the generic counter silently; the last
      // one to reach this line went unnoticed for twenty-odd builds.
      try { console.warn('[LOOTFLEET] leaderboard publish threw (this is a bug, not a connection problem):', e); } catch (x) {}
      lbFail('throw', e);
    }
  }
  async function lbTop(n) {
    try {
      if (!enabled) return null;
      // HAULAGE + NANOCORE COLUMNS come from cargo-ladder.sql and
      // nanocore-ladder.sql. They were being PUBLISHED by lbUpsert and never
      // READ BACK here, so the Haulage ladder ranked every human at zero and a
      // Nanocore ladder was impossible to build. Each migration gets its own
      // rung on the ladder below, so a server missing one still serves the rest.
      // NEWEST RUNG FIRST. mech-ladder.sql supersedes pilot-ladder.sql, so 'mech'
      // sits above 'pilot' and every consumer that accepts 'pilot' must accept
      // 'mech' too — the shapes are a LADDER, and testing for one exact value is
      // what silently switched Home Defense and Exploration off the day
      // pilot-ladder landed.
      let shape = 'mech';
      let { data, error } = await client.from('leaderboard')
        .select('user_id,name,power,level,zone,kills,fleet,asc_stars,tiles,citadels,tile_rev,ships,missions,badges,cargo,cargo_best,nano_legend,nano_slots,nano_god,hcwave,expo,expo_best,pilot_score,pilot_nodes,mech_cores')
        .order('power', { ascending: false }).limit(n || 100);
      if (error) {   // mech-ladder.sql not run yet
        shape = 'pilot';
        const rM = await client.from('leaderboard')
          .select('user_id,name,power,level,zone,kills,fleet,asc_stars,tiles,citadels,tile_rev,ships,missions,badges,cargo,cargo_best,nano_legend,nano_slots,nano_god,hcwave,expo,expo_best,pilot_score,pilot_nodes')
          .order('power', { ascending: false }).limit(n || 100);
        data = rM.data; error = rM.error;
      }
      if (error) {   // pilot-ladder.sql not run yet
        shape = 'new';
        const rP = await client.from('leaderboard')
          .select('user_id,name,power,level,zone,kills,fleet,asc_stars,tiles,citadels,tile_rev,ships,missions,badges,cargo,cargo_best,nano_legend,nano_slots,nano_god,hcwave,expo,expo_best')
          .order('power', { ascending: false }).limit(n || 100);
        data = rP.data; error = rP.error;
      }
      if (error) {   // new-ladders.sql not run yet
        shape = 'nano';
        const rW = await client.from('leaderboard')
          .select('user_id,name,power,level,zone,kills,fleet,asc_stars,tiles,citadels,tile_rev,ships,missions,badges,cargo,cargo_best,nano_legend,nano_slots,nano_god')
          .order('power', { ascending: false }).limit(n || 100);
        data = rW.data; error = rW.error;
      }
      if (error) {   // nanocore-ladder.sql not run yet
        shape = 'cargo';
        const rN = await client.from('leaderboard')
          .select('user_id,name,power,level,zone,kills,fleet,asc_stars,tiles,citadels,tile_rev,ships,missions,badges,cargo,cargo_best')
          .order('power', { ascending: false }).limit(n || 100);
        data = rN.data; error = rN.error;
      }
      if (error) {   // cargo-ladder.sql not run yet
        shape = 'ladder';
        const rC = await client.from('leaderboard')
          .select('user_id,name,power,level,zone,kills,fleet,asc_stars,tiles,citadels,tile_rev,ships,missions,badges')
          .order('power', { ascending: false }).limit(n || 100);
        data = rC.data; error = rC.error;
      }
      if (error) {   // ranks-ladders.sql not run yet
        shape = 'base';
        const r0 = await client.from('leaderboard')
          .select('user_id,name,power,level,zone,kills,fleet,asc_stars')
          .order('power', { ascending: false }).limit(n || 100);
        data = r0.data; error = r0.error;
      }
      if (error) {   // column not migrated yet — fall back to the legacy shape
        shape = 'legacy';
        const r = await client.from('leaderboard')
          .select('user_id,name,power,level,zone,kills,fleet')
          .order('power', { ascending: false }).limit(n || 100);
        data = r.data; error = r.error;
      }
      if (!error) _lbShape = shape;
      return error ? null : (data || null);
    } catch (e) { return null; }
  }

  // ---- Server Dreadnaught seasonal boards (one row per user per season) ------
  // Returns {ok} so the caller can RETRY. Supabase rpc() resolves with {data,
  // error} rather than throwing, and this function used to ignore `error` and sit
  // behind an empty catch — so an RLS denial, an expired JWT or a missing function
  // all looked exactly like a successful publish. A player finished the event, the
  // row was never written, and nothing ever tried again: "I completed Voidmaw and
  // the leaderboard didn't update."
  async function sdUpsert(p) {
    if (!enabled || !p) return { ok: false, reason: 'disabled' };
    try {
      const { error } = await client.rpc('sdread_upsert', {
        p_name: p.name || 'Operator', p_season: p.season || 1, p_day: p.day || 0,
        p_best: Math.round(p.best || 0), p_total: Math.round(p.total || 0), p_stage: p.stage || 1,
      });
      if (error) return { ok: false, reason: error.message || 'rpc error' };
      return { ok: true };
    } catch (e) { return { ok: false, reason: (e && e.message) || 'network' }; }
  }
  // NO `_lbShape` WRITE IN ANY OF THE THREE READS BELOW (fixed Aug 2026).
  //
  // Each one carried `if (!error) _lbShape = shape;` copied from lbTop — but
  // `shape` is lbTop's own local, declared inside lbTop and nowhere else. So the
  // line threw ReferenceError on EVERY successful read, the surrounding catch
  // turned that into `return null`, and all three Voidmaw reads failed 100% of
  // the time while looking exactly like an empty board:
  //   • the sheet sat on "Connecting to live standings…" forever (_cl.ok never set)
  //   • both boards read "No operators published yet" with rows in the table
  //   • sdMine never landed, so the server row could not act as the floor for a
  //     lost local run — the reported "my run vanishes when I reload".
  // sdread_scores has ONE column shape (there is no migration ladder here), so
  // there is nothing for these to report. The line is simply gone.
  //
  // MY OWN ROW, FETCHED DIRECTLY BY user_id — not scanned out of a board slice.
  // The boards are `limit(100)`, and the season board spans the whole season, so
  // a mid-table pilot simply is not in the array: "no row of mine" and "my row is
  // rank 101" look identical to a caller filtering _cl.season. Anything that needs
  // the player's own server figures — the local-record floor, the missing-row
  // republish — has to ask for the row by id or it silently no-ops for exactly the
  // players it was written for.
  async function sdMine(season) {
    try {
      if (!enabled) return null;
      const u = await getUser(); const id = u && u.id; if (!id) return null;
      const { data, error } = await client.from('sdread_scores')
        .select('user_id,name,season,day,best_day,total,stage')
        .eq('user_id', id).eq('season', season || 1).maybeSingle();
      return error ? null : (data || null);
    } catch (e) { return null; }
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

  window.CLOUD = { enabled, client, signUp, signIn, oauth, signOut, providers, deleteAccountData, getUser, pull, pullMeta, push,
    pullSave, pushSave, saveConflict, claimSession, touchSession, onSessionRow,
    lbUpsert, lbTop, sdUpsert, sdDaily, sdSeason, sdMine,
    // Which column set the last successful board read returned — 'new' means
    // new-ladders.sql has run. This is how the ladders decide whether a
    // migration is live; see the note on _lbShape.
    lbShape: () => _lbShape,
    // Which rungs of the publish ladder are currently degraded, and when each
    // re-arms. One line in the console instead of reading source to find out why
    // a column is not moving.
    lbState: () => ({
      pilot:  { off: _lbNoPilot,  retryIn: Math.max(0, Math.round((_lbPilotRetryAt  - Date.now()) / 1000)) },
      new:    { off: _lbNoNew,    retryIn: Math.max(0, Math.round((_lbNewRetryAt    - Date.now()) / 1000)) },
      art:    { off: _lbNoArt,    retryIn: Math.max(0, Math.round((_lbArtRetryAt    - Date.now()) / 1000)) },
      nano:   { off: _lbNoNano,   retryIn: Math.max(0, Math.round((_lbNanoRetryAt   - Date.now()) / 1000)) },
      cargo:  { off: _lbNoCargo,  retryIn: Math.max(0, Math.round((_lbCargoRetryAt  - Date.now()) / 1000)) },
      ladder: { off: _lbNoLadder, retryIn: Math.max(0, Math.round((_lbLadderRetryAt - Date.now()) / 1000)) },
      asc:    { off: _lbNoAsc,    retryIn: Math.max(0, Math.round((_lbAscRetryAt    - Date.now()) / 1000)) },
      fails: _lbFails,
    }) };
})();
