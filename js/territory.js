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

  // Fetch the whole shared world → { tileId: { ownerId, ownerName, cooldownUntil } }
  async function loadAll() {
    const cl = client(); if (!cl) return {};
    const toMap = (data) => { const map = {}; (data || []).forEach((r) => { map[r.tile_id] = { ownerId: r.owner_id, ownerName: r.owner_name, cooldownUntil: r.cooldown_until, citadel: !!r.citadel, fleetScore: r.fleet_score || 0 }; }); return map; };
    try {
      let { data, error } = await cl.from('territory').select('tile_id,owner_id,owner_name,cooldown_until,citadel,fleet_score');
      if (error) { ({ data, error } = await cl.from('territory').select('tile_id,owner_id,owner_name,cooldown_until')); }
      if (error || !data) return {};
      return toMap(data);
    } catch (e) { return {}; }
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
      let res = await cl.rpc('claim_tile', { p_tile_id: tileId, p_owner_name: ownerName || myName(), p_protect_minutes: protectMinutes || 15, p_citadel: !!meta.citadel, p_fleet_score: Math.round(meta.fleetScore || 0) });
      if (res.error && /p_citadel|p_fleet_score|function|argument/i.test(res.error.message || '')) {
        res = await cl.rpc('claim_tile', { p_tile_id: tileId, p_owner_name: ownerName || myName(), p_protect_minutes: protectMinutes || 15 });
      }
      if (res.error && /p_protect_minutes|function|argument/i.test(res.error.message || '')) {
        res = await cl.rpc('claim_tile', { p_tile_id: tileId, p_owner_name: ownerName || myName() });
      }
      if (res.error) return { ok: false, reason: res.error.message || 'error' };
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
            fleetScore: payload.new ? (payload.new.fleet_score || 0) : 0,
            deleted: !payload.new,
          });
        })
        .subscribe();
    } catch (e) {}
  }

  window.TERRITORY = { enabled, myId, myName, loadAll, claim, subscribe };
})();
