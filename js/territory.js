/* =============================================================================
   territory.js — Loot Fleet · REAL cross-account turf war (hybrid)
   ---------------------------------------------------------------------------
   When a player is signed into a real (cloud) account, galaxy-tile ownership is
   shared through Supabase: every signed-in account fights over the same 60
   tiles, captures stream live to everyone, and a server-authoritative
   claim_tile() RPC enforces identity + the 15-min protected window.

   Run supabase/territory.sql once in your Supabase dashboard to create the
   table + function. Until then (or for guest/local play) TERRITORY.enabled()
   is false and game.js falls back to fully-simulated rivals.

   Load AFTER js/cloud.js + js/account.js and BEFORE js/game.js. Exposes
   window.TERRITORY.
   ============================================================================= */
(function () {
  'use strict';

  function client() { return (window.CLOUD && window.CLOUD.enabled) ? window.CLOUD.client : null; }
  function session() { try { return window.ACCOUNT ? window.ACCOUNT.session() : null; } catch (e) { return null; } }
  function myId() { const s = session(); return s && s.id ? s.id : null; }
  function myName() { const s = session(); return (s && s.name) ? s.name : 'Operator'; }
  // Real turf war is on only when the cloud is configured AND we're signed into
  // a real account (guests have no stable cross-device id to fight under).
  function enabled() { return !!(client() && myId()); }

  // A SUCCESSFUL DEFENCE changes no row, so the Discord feed can never diff it
  // out. The attacker's client reports it; the RPC reads the defender from the
  // server and rate-limits, so nothing here is trusted beyond "I lost".
  async function logRepelled(tileId) {
    const cl = client(); if (!cl || !myId() || !tileId) return;
    try { await cl.rpc('log_repelled', { p_tile_id: tileId }); } catch (e) {}
  }

  // KAEVITH HULL EARNED — the roll is resolved client-side as part of battle
  // resolution, so the client has to be the one that reports it. log_xen_hull()
  // validates the ship key against a fixed list and is idempotent per
  // (pilot, hull), so a replayed or forged call announces nothing.
  async function logXenHull(shipKey, tileId, ring, pity) {
    const cl = client(); if (!cl || !myId() || !shipKey) return;
    try {
      await cl.rpc('log_xen_hull', {
        p_ship: shipKey, p_tile_id: tileId || null,
        p_ring: ring || 0, p_pity: !!pity,
      });
    } catch (e) {}
  }

  // ANY HULL EARNED — same reporting path as the Kaevith one above, widened to
  // every hull in the game (log_hull validates the key shape, refuses xen keys
  // and is idempotent per pilot per hull, so this is safe to call on every
  // acquisition). Fire and forget: a hull is granted whether or not the channel
  // hears about it.
  async function logHull(shipKey) {
    const cl = client(); if (!cl || !myId() || !shipKey) return;
    try { await cl.rpc('log_hull', { p_ship: String(shipKey) }); } catch (e) {}
  }

  // Fetch the whole shared world → { tileId: { ownerId, ownerName, cooldownUntil, citadel, fleetScore, defense } }
  // PAGED. PostgREST caps every select at 1000 rows and says nothing about it.
  // Once `territory` outgrew 1000 rows each client received a DIFFERENT partial
  // map: tiles past the cap read as unowned, so two players could both hold the
  // same system, each seeing themselves as the owner ("I can attack it but it
  // says I'm defending it"). Never select this table without a range walk.
  async function loadAll() {
    const cl = client(); if (!cl) return {};
    const PAGE = 1000;
    const cols = [
      'tile_id,owner_id,owner_name,cooldown_until,citadel,citadel_lv,fleet_score,defense',
      'tile_id,owner_id,owner_name,cooldown_until,citadel,fleet_score,defense',
      'tile_id,owner_id,owner_name,cooldown_until,citadel,fleet_score',
      'tile_id,owner_id,owner_name,cooldown_until',
    ];
    for (const sel of cols) {
      const map = {};
      let ok = true;
      try {
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await cl.from('territory').select(sel)
            .order('tile_id', { ascending: true }).range(from, from + PAGE - 1);
          if (error) { ok = false; break; }
          (data || []).forEach((r) => {
            map[r.tile_id] = { ownerId: r.owner_id, ownerName: r.owner_name, cooldownUntil: r.cooldown_until, citadel: !!r.citadel, citadelLv: r.citadel_lv | 0, fleetScore: r.fleet_score || 0, defense: r.defense || null };
          });
          if (!data || data.length < PAGE) break;
        }
      } catch (e) { ok = false; }
      if (ok) return map;   // this column set worked — older schemas fall through
    }
    return {};
  }

  // Claim/contest a tile through the server-authoritative RPC. Atomic: when
  // several players race for the same tile, the FIRST completed claim wins and
  // later ones reject with 'tile protected'. p_protect_minutes: 15 normal,
  // 1440 (24 h) for citadels. Falls back to the legacy 2-arg RPC if the SQL
  // hasn't been updated yet.
  async function claim(tileId, ownerName, protectMinutes, meta) {
    const cl = client(); if (!cl || !myId()) return { ok: false, reason: 'offline' };
    meta = meta || {};
    try {
      let res = await cl.rpc('claim_tile', { p_tile_id: tileId, p_owner_name: ownerName || myName(), p_protect_minutes: protectMinutes || 15, p_citadel: !!meta.citadel, p_citadel_lv: (meta.citadelLv | 0) || null, p_fleet_score: Math.round(meta.fleetScore || 0), p_defense: meta.defense || null });
      if (res.error && /p_defense|function|argument|column|candidate|does not exist/i.test(res.error.message || '')) {
        res = await cl.rpc('claim_tile', { p_tile_id: tileId, p_owner_name: ownerName || myName(), p_protect_minutes: protectMinutes || 15, p_citadel: !!meta.citadel, p_fleet_score: Math.round(meta.fleetScore || 0) });
      }
      if (res.error && /p_citadel|p_fleet_score|function|argument|column|candidate|does not exist/i.test(res.error.message || '')) {
        res = await cl.rpc('claim_tile', { p_tile_id: tileId, p_owner_name: ownerName || myName(), p_protect_minutes: protectMinutes || 15 });
      }
      if (res.error && /p_protect_minutes|function|argument|column|candidate|does not exist/i.test(res.error.message || '')) {
        res = await cl.rpc('claim_tile', { p_tile_id: tileId, p_owner_name: ownerName || myName() });
      }
      if (res.error) {
        // surface persistent claim failures ONCE per 5 min — a silently broken
        // turf war (half-migrated server) is how nobody saw anyone's conquests
        try {
          if (!window.__turfWarnT || Date.now() - window.__turfWarnT > 300000) {
            window.__turfWarnT = Date.now();
            if (window.UI && window.UI.unlockToast) window.UI.unlockToast('⚠ Turf war sync failed — server migration required (territory-v2.sql)');
          }
        } catch (e) {}
        return { ok: false, reason: res.error.message || 'error' };
      }
      // A claim landed, so this session can definitely reach the server. Publish
      // the Ranks row off the same beat — claiming tiles while absent from the
      // leaderboard was the single most-reported "I'm not on the board" case.
      try { if (window.ACCOUNT && window.ACCOUNT.publishNow) window.ACCOUNT.publishNow(); } catch (e) {}
      return { ok: true, row: res.data };
    } catch (e) { return { ok: false, reason: 'error' }; }
  }

  // Live updates: invokes onChange({ tileId, ownerId, ownerName, cooldownUntil, deleted }).
  let _channel = null;
  function subscribe(onChange) {
    const cl = client(); if (!cl) return;
    try {
      if (_channel) { try { cl.removeChannel(_channel); } catch (e) {} _channel = null; }
      _channel = cl.channel('territory-rt')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'territory' }, (payload) => {
          const row = payload.new || payload.old; if (!row) return;
          onChange({
            tileId: row.tile_id,
            ownerId: payload.new ? payload.new.owner_id : null,
            ownerName: payload.new ? payload.new.owner_name : null,
            cooldownUntil: payload.new ? payload.new.cooldown_until : null,
            citadel: payload.new ? !!payload.new.citadel : false,
            citadelLv: payload.new ? (payload.new.citadel_lv | 0) : 0,
            fleetScore: payload.new ? (payload.new.fleet_score || 0) : 0,
            defense: payload.new ? (payload.new.defense || null) : null,
            deleted: !payload.new,
          });
        })
        .subscribe();
    } catch (e) {}
  }

  // release a tile I own back to neutral. Prefers the release_tile RPC
  // (supabase/territory-v2b.sql); falls back to a direct delete (needs the
  // owner-delete RLS policy from the same migration).
  async function release(tileId) {
    const cl = client(); if (!cl || !myId()) return { ok: false };
    try {
      const { error } = await cl.rpc('release_tile', { p_tile_id: tileId });
      if (!error) return { ok: true };
    } catch (e) {}
    try {
      const { error: e2 } = await cl.from('territory').delete().eq('tile_id', tileId).eq('owner_id', myId());
      return { ok: !e2 };
    } catch (e) { return { ok: false }; }
  }
  window.TERRITORY = { enabled, myId, myName, loadAll, claim, release, subscribe, logRepelled, logXenHull, logHull };
})();
