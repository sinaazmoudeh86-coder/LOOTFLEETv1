/* =============================================================================
   temple.js — THE TEMPLE · true PvP zone
   ---------------------------------------------------------------------------
   One shared arena. Pilots fly in, hunt each other, and hold the centre waiting
   for the altar. Every three hours it spawns one item between Relic and Paragon
   at item level 300-500; the item drops physically and the first pilot to touch
   it keeps it.

   FIVE DECISIONS, AND WHY
   ---------------------------------------------------------------------------
   1. THE ARENA IS THE REAL ENGINE, NOT A MINIGAME. Temple deploys into the
      ordinary battle screen with a huge world and no hostiles. Your ship, your
      fittings, your drones and your DPS are exactly what they are everywhere
      else — that is what "bring your best fleet" has to mean to be worth
      anything.

   2. POSITION SYNC IS BROADCAST, STATE IS THE DATABASE. Positions move ten
      times a second and are worthless one tick later, so they ride a Realtime
      broadcast channel and are never stored. Anything with consequences — who
      is present, who died, who took the item — goes through an RPC, because a
      broadcast can be forged by any client that opens a socket.

   3. KILLS ARE KILLER-REPORTED AND SERVER-CHECKED. The brief chose
      killer-authoritative for responsiveness. Taken literally that lets anyone
      claim a kill on anyone, so the report fires instantly with no handshake and
      the server refuses it unless both pilots are present, adjacent and off
      cooldown. See temple.sql for what that does and does not buy.

   4. THE VICTIM APPLIES THEIR OWN PENALTY. There is no other option: hull
      levels and the item pool live in the victim's save. The server decides the
      death happened; this file then puts the local ship to zero HP with a
      synthetic killer and lets the ENGINE'S OWN death path run — so the penalty
      is byte-identical to dying to a hostile, which is what was asked for.

   5. NO PROTECTIONS, AS SPECIFIED — no spawn shield, no re-entry cooldown, no
      damage normalisation. The one guard that survives is the server's 8-second
      post-death grace, and that is not a fairness rule: without it a single
      report loop empties a pilot's entire hold in one second, which is a
      database problem rather than a PvP one.
   ============================================================================= */
(function () {
  'use strict';

  const G = () => window.GAME;
  const cl = () => { try { return (window.CLOUD && window.CLOUD.enabled && window.CLOUD.client) || null; } catch (e) { return null; } };
  const signedIn = () => { try { return !!(window.ACCOUNT && window.ACCOUNT.current && window.ACCOUNT.current()); } catch (e) { return false; } };

  const GATE_LV = 60;             // Temple opens well after the game is understood
  const ZONE = 200;               // arena depth — cosmetic; there are no hostiles
  const BEAT_MS = 1200;           // presence heartbeat (the DB write)
  const CAST_MS = 130;            // position broadcast (ephemeral)
  const POLL_MS = 4000;           // altar + death check
  const ALTAR_R = 260;            // pickup radius around the altar, world units
  const CHAN = 'temple-arena';

  let _pilots = new Map();        // uid -> { name, ship, power, x, y, hp, t, dead }
  let _chan = null, _beatT = 0, _castT = 0, _pollT = 0;
  let _altar = null;              // { seq, item, next_at, spawned_at, taken_name }
  let _lastDeathAt = null;        // cursor into temple_my_deaths
  let _selfDeathAt = 0;           // when this client last applied its own death
  let _recent = [];
  let _err = '';
  let _vigil = 0, _topVigil = 0, _holding = false;
  let _uid = null;

  function st() { const g = G(); return g && g.state; }
  function meName() { try { return (st().pilotName || st().name || 'Operator').slice(0, 24); } catch (e) { return 'Operator'; } }
  function myPower() { try { return Number(G().score ? G().score() : 0) || 0; } catch (e) { return 0; } }
  function lvl() { try { return st().level | 0; } catch (e) { return 0; } }
  function unlocked() { return lvl() >= GATE_LV; }
  // CLOSED BETA. The zone ships dark and opens per-account via a coupon code
  // (redeem.js 'templebeta' -> state.templeBeta, a one-way latch that survives
  // merges). Gated HERE as well as in the UI: hiding the card is presentation,
  // this is the rule — a data-go tap or a console call still gets refused.
  function betaOn() { try { return !!st().templeBeta; } catch (e) { return false; } }
  function active() { try { return !!(G().rt && G().rt.temrun && G().rt.temrun.active); } catch (e) { return false; } }
  function hmsWorld(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0')
             : m + ':' + String(x).padStart(2, '0');
  }
  function fmt(n) { try { return G().formatNum(n); } catch (e) { return String(Math.round(n || 0)); } }

  async function myUid() {
    if (_uid) return _uid;
    try { const u = await window.CLOUD.getUser(); _uid = u && u.id; } catch (e) {}
    return _uid;
  }

  // ---------------------------------------------------------------------------
  // ENTER / LEAVE
  // ---------------------------------------------------------------------------
  async function enter() {
    if (!betaOn()) { toast('The Temple is sealed.'); return false; }
    if (!unlocked()) { toast('The Temple opens at Level ' + GATE_LV); return false; }
    if (!signedIn() || !cl()) { toast('Sign in to enter the Temple — it is a live PvP zone'); return false; }
    // THE UID IS RESOLVED BEFORE THE SOCKET OPENS.
    // Every inbound message is filtered on it: a position payload with no id is
    // dropped, and an incoming hit is ignored unless d.to matches. Resolving it
    // lazily inside the first heartbeat left a window of a few hundred
    // milliseconds in which this pilot was invisible AND unhittable — which is
    // exactly the window an entering pilot is most vulnerable in, handed to them
    // as a free shield by an ordering accident.
    await myUid();
    if (!_uid) { toast('Could not verify your account'); return false; }
    let ok = false;
    try { ok = !!G().startTemple(); } catch (e) { ok = false; }
    if (!ok) { toast('Could not deploy to the Temple'); return false; }
    _pilots.clear(); _hitAt.clear(); _lastDeathAt = new Date(Date.now() - 5000).toISOString();
    openChannel();
    beat(true); poll(true);
    try { window.TEMPLEUI && window.TEMPLEUI.ensurePill(); } catch (e) {}
    banner('\u26e9 THE TEMPLE', 'True PvP. Every pilot here can kill you, and dying costs what dying always costs.');
    return true;
  }

  function leave() {
    try { if (G().rt) G().rt.temrun = null; } catch (e) {}
    closeChannel();
    _pilots.clear();
    try { const c = cl(); if (c) c.rpc('temple_leave'); } catch (e) {}
    try { window.TEMPLEUI && window.TEMPLEUI.removePill(); } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // REALTIME — positions only
  // ---------------------------------------------------------------------------
  function openChannel() {
    const c = cl(); if (!c) return;
    closeChannel();
    try {
      _chan = c.channel(CHAN, { config: { broadcast: { self: false } } });
      _chan.on('broadcast', { event: 'p' }, (m) => {
        const d = (m && m.payload) || null; if (!d || !d.id) return;
        // A broadcast is UNTRUSTED — it decides only where a nameplate is drawn.
        // Nothing here can cost anyone anything, which is exactly why positions
        // are allowed to ride it and kills are not.
        const prev = _pilots.get(d.id);
        const row = { name: String(d.n || 'Operator').slice(0, 24), ship: d.s || '',
                      power: Number(d.pw) || 0, x: +d.x || 0, y: +d.y || 0,
                      hp: Math.max(0, Math.min(1, +d.h || 0)), t: Date.now(), dead: !!d.d };
        _pilots.set(d.id, row);
        if (prev) noteRemoteHp(d.id, row, prev.hp);
      });
      // INCOMING FIRE. Applied to MY ship, by MY client, through the same damage
      // path a hostile uses — so shields, invulnerability frames and the death
      // handler all behave exactly as they do everywhere else in the game.
      _chan.on('broadcast', { event: 'h' }, (m) => {
        const d = (m && m.payload) || null;
        if (!d || d.to !== _uid || !active()) return;
        const rt = G().rt, a = rt && rt.archer;
        if (!a || a.dead || (a.invuln || 0) > 0) return;
        const dmg = Math.max(1, Math.round(+d.d || 1));
        a.hp = Math.max(0, a.hp - dmg);
        try { rt.shake = Math.min(6, (rt.shake || 0) + 2); } catch (e) {}
        if (a.hp <= 0 && !a.dead) {
          // Hand the engine a killer it understands and let its OWN death path
          // run — hull levels wiped, item drop rolled, towed home. Identical to
          // dying to a hostile, which is what the brief asked for.
          a.killer = { isBoss: false, type: { name: String(d.fn || 'another pilot') } };
          // THE DYING PILOT ANNOUNCES IT, IMMEDIATELY, BEFORE TEARDOWN.
          //
          // This is what closed the loop. The killer used to detect a kill by
          // watching the victim's broadcast HP fall to zero — but the victim's
          // death path tows them home and closes this channel in the same frame,
          // so that broadcast was never sent. No detection, no temple_kill call,
          // no logged kill, no credit: the entire PvP loop silently did nothing.
          //
          // The victim is only saying "I died, and it was you" — a statement it
          // has no reason to fake in the attacker's favour. The CLAIM is still
          // the killer's, still an RPC, still range- and presence-checked by the
          // server. Killer-authoritative survives; it just gets told.
          try { _chan.send({ type: 'broadcast', event: 'x', payload: { from: _uid, n: meName(), by: d.from } }); } catch (e) {}
          // and record that this death is already accounted for, so the poll
          // backstop does not apply it a second time
          _selfDeathAt = Date.now();
        }
      });
      // A PILOT DIED AND NAMED ME. Report it — the server still decides.
      _chan.on('broadcast', { event: 'x' }, (m) => {
        const d = (m && m.payload) || null;
        if (!d || !d.from) return;
        const p = _pilots.get(d.from); if (p) { p.hp = 0; p.dead = true; }
        if (d.by === _uid) { _hitAt.delete(d.from); reportKill(d.from); }
      });
      _chan.subscribe();
    } catch (e) { _err = 'channel'; }
  }
  function closeChannel() {
    try { if (_chan) { cl().removeChannel(_chan); } } catch (e) {}
    _chan = null;
  }

  function cast() {
    if (!_chan || !active()) return;
    const rt = G().rt, a = rt && rt.archer; if (!a) return;
    try {
      _chan.send({ type: 'broadcast', event: 'p', payload: {
        id: _uid, n: meName(), s: st().ship || '', pw: myPower(),
        x: Math.round(a.x), y: Math.round(a.y),
        h: Math.max(0, Math.min(1, (a.hp || 0) / (rt.stats.maxHp || 1))),
        d: !!a.dead,
      } });
    } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // HEARTBEAT — the authoritative presence row the kill validator reads
  // ---------------------------------------------------------------------------
  async function beat(force) {
    const c = cl(); if (!c || (!active() && !force)) return;
    const rt = G().rt, a = rt && rt.archer;
    await myUid();
    try {
      // POSITION AS A FRACTION OF THE WORLD. Raw coordinates tell the server
      // nothing about who is standing on the altar, because the world size varies.
      // In fractions the centre is exactly (0.5, 0.5) everywhere, so the SERVER
      // decides ring membership rather than trusting a client to assert it.
      const fx = a && rt.worldW ? a.x / rt.worldW : 0.5;
      const fy = a && rt.worldH ? a.y / rt.worldH : 0.5;
      const r = await c.rpc('temple_beat', {
        p_name: meName(), p_ship: st().ship || null, p_power: myPower(),
        p_x: a ? Math.round(a.x) : 0, p_y: a ? Math.round(a.y) : 0,
        p_hp: a && rt.stats ? Math.max(0, Math.min(1, a.hp / (rt.stats.maxHp || 1))) : 1,
        p_fx: Math.max(0, Math.min(1, fx)), p_fy: Math.max(0, Math.min(1, fy)),
      });
      if (!r.error && r.data) {
        const wasHold = _holding;
        _vigil = Number(r.data.vigil) || 0;
        _topVigil = Number(r.data.top_vigil) || 0;
        _holding = !!r.data.in_ring;
        if (_holding && !wasHold) banner('\u25ce THE VIGIL', 'You hold the altar. Every second alone here sharpens what it spawns.');
        else if (!_holding && wasHold && active()) banner('\u25ce VIGIL BROKEN', 'You are off the altar. It banks nothing while the ring is empty or contested.');
      }
      _err = '';
    } catch (e) { _err = 'beat'; }
  }

  // ---------------------------------------------------------------------------
  // THE ALTAR
  // ---------------------------------------------------------------------------
  async function poll(force) {
    const c = cl(); if (!c) return;
    try {
      const r = await c.rpc('temple_tick');
      if (!r.error && r.data && r.data.ok) {
        const was = _altar && _altar.seq;
        _altar = r.data;
        const sNow = Date.parse(_altar.now || ''); if (sNow) _skew = sNow - Date.now();
        if (_altar.item && was !== undefined && _altar.seq !== was) {
          banner('\u2726 THE ALTAR HAS SPAWNED', 'An item is on the floor at the centre. Take it before someone else does.');
        }
      }
    } catch (e) {}
    // deaths dealt to me while I was not looking
    try {
      const d = await c.rpc('temple_my_deaths', { p_since: _lastDeathAt });
      if (!d.error && Array.isArray(d.data) && d.data.length) {
        _lastDeathAt = d.data[d.data.length - 1].at;
        applyDeath(d.data[d.data.length - 1].killer || 'another pilot');
      }
    } catch (e) {}
    if (force) refreshRecent();
  }

  async function refreshRecent() {
    const c = cl(); if (!c) return;
    try { const r = await c.rpc('temple_recent', { p_n: 12 }); if (!r.error) _recent = r.data || []; } catch (e) {}
  }

  // TIME LEFT ON THE ALTAR, measured against the SERVER's clock rather than the
  // device's. A phone running eight minutes fast would otherwise show its owner a
  // different deadline from everyone else standing in the same room, and the one
  // thing a shared deadline has to be is shared. _skew is the offset measured on
  // the last poll and applied to every read in between.
  let _skew = 0;                  // serverNow - deviceNow, ms
  function altarMs() {
    if (!_altar || !_altar.next_at) return 0;
    const at = Date.parse(_altar.next_at); if (!at) return 0;
    return Math.max(0, at - (Date.now() + _skew));
  }
  function waitedS() { return (_altar && _altar.waiting_s | 0) || 0; }
  function itemUp() { return !!(_altar && _altar.item); }

  // Take it. The RPC is the race resolution — two pilots touching in the same
  // frame produce one winner and one 'gone', decided by a row lock.
  let _claiming = false;
  async function claim() {
    if (_claiming || !itemUp()) return;
    const c = cl(); if (!c) return;
    _claiming = true;
    try {
      const r = await c.rpc('temple_claim', { p_name: meName() });
      if (r.error) { toast('The altar did not answer'); return; }
      const d = r.data || {};
      if (!d.ok) {
        toast(d.reason === 'gone' ? 'Someone beat you to it' :
              d.reason === 'dead' ? 'You are down — you cannot take it' : 'Could not take the item');
        poll(true); return;
      }
      grantItem(d.item);
      _altar = Object.assign({}, _altar, { item: null, next_at: d.next_at });
      poll(true);
    } catch (e) { toast('The altar did not answer'); }
    finally { _claiming = false; }
  }

  // The item is MINTED LOCALLY from the server's roll. The server decides the
  // rarity, the item level and the seed; the client only runs the same generator
  // every other drop uses, so a Temple item is indistinguishable from a found one
  // and obeys every rule the item system already has.
  function grantItem(spec) {
    if (!spec) return;
    try {
      const I = window.ITEMS || window.Items;
      const rarity = Math.max(0, Math.min(16, spec.rarity | 0));
      const ilvl = Math.max(1, spec.ilvl | 0);
      const it = I && I.generate ? I.generate(ilvl, rarity) : null;
      if (!it) { toast('Item could not be minted — report this'); return; }
      const s = st();
      s.inventory = s.inventory || [];
      s.inventory.push(it);
      s.itemsFound = (s.itemsFound | 0) + 1;
      try { if (G().countRareFind) G().countRareFind(it); } catch (e) {}
      G().save();
      const rn = (window.CONFIG && window.CONFIG.RARITY[rarity] && window.CONFIG.RARITY[rarity].name) || 'Relic';
      banner('\u2726 ALTAR CLAIMED', rn + ' \u00b7 item level ' + ilvl + ' \u2014 it is in your hold.');
      try { window.UI && window.UI.refreshAll(); } catch (e) {}
    } catch (e) { toast('Item could not be minted — report this'); }
  }

  // ---------------------------------------------------------------------------
  // DAMAGE EXCHANGE
  // ---------------------------------------------------------------------------
  // A shot that reaches a remote pilot is broadcast to THEM and applied by THEIR
  // client to their own ship. That is the only way the damage can be real: their
  // HP, their shields, their death — all of it lives on their machine, and a
  // number this client invents for them would only ever be a nameplate.
  //
  // It also puts the honest limit of this design in plain sight. A client can
  // refuse to apply an incoming hit and become unkillable. Nothing here can stop
  // that, and pretending otherwise would be worse than saying so: the server-side
  // guard in temple.sql bounds what a FORGED KILL can do, not what a client can
  // decline to feel.
  const _hitAt = new Map();       // uid -> when I last damaged them
  function onHit(uid, dmg) {
    if (!_chan || !uid) return;
    _hitAt.set(uid, Date.now());
    try { _chan.send({ type: 'broadcast', event: 'h', payload: { to: uid, d: Math.max(1, Math.round(dmg || 1)), from: _uid, fn: meName() } }); } catch (e) {}
    // local feedback so the shot does not look like it passed through them
    try { const p = _pilots.get(uid); if (p) p.hp = Math.max(0, p.hp - 0.001); } catch (e) {}
  }

  // A pilot I was shooting has just reported zero HP. Claim it. The server
  // decides whether the claim stands — this is a report, not a verdict.
  function noteRemoteHp(uid, p, wasHp) {
    if (p.hp > 0 || wasHp <= 0) return;
    const at = _hitAt.get(uid) || 0;
    if (Date.now() - at > 3500) return;   // somebody else finished them
    _hitAt.delete(uid);
    reportKill(uid);
  }

  // ---------------------------------------------------------------------------
  // KILLS
  // ---------------------------------------------------------------------------
  // Reported by the killer the instant their shot lands. The server is what
  // decides whether it counts; this call is fire-and-forget so a slow round trip
  // never stutters the fight.
  async function reportKill(uid) {
    const c = cl(); if (!c || !uid) return;
    try {
      const r = await c.rpc('temple_kill', { p_victim: uid });
      const d = (r && r.data) || {};
      if (d.ok) {
        banner('\u2694 KILL', 'You downed ' + (d.victim || 'a pilot') + '.');
        refreshRecent();
      } else if (d.reason === 'out-of-range') {
        toast('Too far away for the kill to register');
      }
    } catch (e) {}
  }

  // I WAS KILLED. Run the engine's own death path so the penalty is exactly what
  // it is anywhere else — hull levels wiped, item drop rolled, towed home. A
  // synthetic killer object is all the engine needs; it reads `.type.name` for
  // the death card.
  let _dying = false;
  function applyDeath(killerName) {
    if (_dying) return;
    // ONLY INSIDE THE ZONE, AND ONLY ONCE.
    //
    // Two ways this used to fire twice. The poll backstop did not check active(),
    // so a kill row read from the hangar four seconds after being towed home
    // killed the pilot AGAIN, out of the zone, for a death they had already paid
    // for. And a death taken through the broadcast never advanced the poll
    // cursor, so the next poll found the same row and charged the penalty a
    // second time. A death is one death.
    if (!active()) return;
    if (Date.now() - _selfDeathAt < 15000) return;
    const rt = G().rt, a = rt && rt.archer;
    if (!a || a.dead) return;
    _dying = true;
    _selfDeathAt = Date.now();
    try {
      a.killer = { isBoss: false, type: { name: String(killerName || 'another pilot') } };
      a.invuln = 0;
      a.hp = 0;
      banner('\u2620 YOU WERE KILLED', String(killerName || 'A pilot') + ' downed you in the Temple.');
    } catch (e) {}
    setTimeout(() => { _dying = false; }, 4000);
  }

  // ---------------------------------------------------------------------------
  // ENGINE HOOKS
  // ---------------------------------------------------------------------------
  // Called every frame while rt.temrun is live. Prunes stale nameplates, drives
  // the heartbeat and the broadcast, and resolves the altar pickup.
  function engineTick(dt, rt) {
    if (!rt || !rt.temrun) return;
    const now = Date.now();
    for (const [k, p] of _pilots) if (now - p.t > 6000) _pilots.delete(k);

    if (now - _castT >= CAST_MS) { _castT = now; cast(); }
    if (now - _beatT >= BEAT_MS) { _beatT = now; beat(false); }
    // THE ALTAR POLL SPEEDS UP WHEN SOMEONE IS STANDING ON IT.
    // At a flat 4s the item was invisible for up to four seconds after it
    // spawned, and the winner was whoever's timer happened to fire first — a
    // lottery between two pilots who had both done the work of being there. A
    // pilot inside the ring polls every 700ms, so the contest is settled by who
    // is present, which is the whole point of the zone.
    const inRing = rt.archer && !rt.archer.dead
      && Math.hypot(rt.archer.x - rt.worldW / 2, rt.archer.y - rt.worldH / 2) <= ALTAR_R;
    if (now - _pollT >= (inRing ? 700 : POLL_MS)) { _pollT = now; poll(false); }

    // ALTAR PICKUP — proximity, checked locally and settled by the server.
    if (itemUp() && rt.archer && !rt.archer.dead) {
      const cx = rt.worldW / 2, cy = rt.worldH / 2;
      const dx = rt.archer.x - cx, dy = rt.archer.y - cy;
      if (dx * dx + dy * dy <= ALTAR_R * ALTAR_R) claim();
    }
    try { window.TEMPLEUI && window.TEMPLEUI.syncPill(); } catch (e) {}
  }

  // Remote pilots and the altar, drawn in world space.
  function engineRender(ctx, time, rt) {
    if (!rt || !rt.temrun) return;
    const cx = rt.worldW / 2, cy = rt.worldH / 2;
    ctx.save();

    // ---- THE DISK ----
    // A solid platform, not a glow. The altar was a soft radial wash with a thin
    // ring, which read as an area effect rather than a PLACE — and the item it
    // spawns has to look like it is sitting ON something or the whole "hold the
    // centre" idea has nowhere to stand. Concentric plates, a machined rim, and
    // a slow rotation so it reads as built rather than painted.
    const pulse = 0.5 + 0.5 * Math.sin(time * 2);
    const up = itemUp();
    const hue = up ? '#ffd24d' : _holding ? '#7ce0a0' : '#8f7bff';

    // ground wash, well outside the disk, so the place is findable from range
    ctx.globalAlpha = 0.13 + pulse * 0.09;
    const gw = ctx.createRadialGradient(cx, cy, ALTAR_R * 0.5, cx, cy, ALTAR_R * 2.1);
    gw.addColorStop(0, hue); gw.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gw;
    ctx.beginPath(); ctx.arc(cx, cy, ALTAR_R * 2.1, 0, Math.PI * 2); ctx.fill();

    // the deck
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#141024';
    ctx.beginPath(); ctx.arc(cx, cy, ALTAR_R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.03)';
    ctx.beginPath(); ctx.arc(cx, cy, ALTAR_R * 0.78, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.04)';
    ctx.beginPath(); ctx.arc(cx, cy, ALTAR_R * 0.44, 0, Math.PI * 2); ctx.fill();

    // radial ribs, turning slowly
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(time * 0.06);
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const a2 = (Math.PI * 2 / 12) * i;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a2) * ALTAR_R * 0.44, Math.sin(a2) * ALTAR_R * 0.44);
      ctx.lineTo(Math.cos(a2) * ALTAR_R * 0.97, Math.sin(a2) * ALTAR_R * 0.97);
      ctx.stroke();
    }
    ctx.restore();

    // inner plate edges
    ctx.globalAlpha = 0.5; ctx.strokeStyle = hue; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, ALTAR_R * 0.78, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, ALTAR_R * 0.44, 0, Math.PI * 2); ctx.stroke();

    // machined rim
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = hue; ctx.lineWidth = _holding ? 6 : 4;
    ctx.shadowColor = hue; ctx.shadowBlur = up ? 30 : 14;
    ctx.beginPath(); ctx.arc(cx, cy, ALTAR_R, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    // VIGIL ARC — how much of an hour has been banked, drawn on the ring itself
    // so the thing you are fighting over is visible from across the arena.
    if (_vigil > 0) {
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = '#7ce0a0'; ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(cx, cy, ALTAR_R + 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, _vigil / 3600));
      ctx.stroke();
    }

    // the plinth the item stands on
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#1c1636';
    ctx.strokeStyle = hue; ctx.lineWidth = 2.5;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI / 4);
    ctx.beginPath(); ctx.rect(-28, -28, 56, 56); ctx.fill(); ctx.stroke();
    ctx.restore();

    // ---- IN-WORLD COUNTDOWN ----
    // On the disk itself. A pilot holding the centre should never have to look
    // away from the fight to find out how long they have to hold it.
    if (!up) {
      const ms = altarMs();
      const soon = ms > 0 && ms < 600000;
      ctx.textAlign = 'center';
      ctx.globalAlpha = 0.9;
      ctx.font = '800 13px Rajdhani, sans-serif';
      ctx.fillStyle = soon ? '#ff8a3d' : '#8f7bff';
      ctx.fillText(soon ? 'THE ALTAR IS WAKING' : 'NEXT SPAWN', cx, cy - ALTAR_R * 0.52);
      ctx.font = '900 ' + (soon ? 40 : 34) + 'px Orbitron, sans-serif';
      ctx.fillStyle = soon ? '#ffb37a' : '#cbbcff';
      if (soon) { ctx.shadowColor = '#ff8a3d'; ctx.shadowBlur = 18 + pulse * 14; }
      ctx.fillText(ms > 0 ? hmsWorld(ms) : 'ANY MOMENT', cx, cy + ALTAR_R * 0.06);
      ctx.shadowBlur = 0;
      if (_vigil > 0) {
        ctx.font = '700 12px Rajdhani, sans-serif';
        ctx.fillStyle = '#7ce0a0';
        ctx.fillText('VIGIL ' + Math.floor(_vigil / 60) + 'm', cx, cy + ALTAR_R * 0.42);
      }
    }

    if (up) {
      const s = 18 + pulse * 8;
      ctx.textAlign = 'center';
      ctx.globalAlpha = 0.95; ctx.font = '800 13px Rajdhani, sans-serif';
      ctx.fillStyle = '#ffd24d';
      ctx.fillText('TAKE IT', cx, cy - ALTAR_R * 0.55);
      ctx.save(); ctx.translate(cx, cy - 6 - pulse * 5); ctx.rotate(time * 0.8);
      ctx.fillStyle = '#fff6d0';
      ctx.shadowColor = '#ffd24d'; ctx.shadowBlur = 26;
      ctx.beginPath();
      ctx.moveTo(0, -s); ctx.lineTo(s * 0.42, 0); ctx.lineTo(0, s); ctx.lineTo(-s * 0.42, 0);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // ---- OFF-SCREEN CONTACTS ----
    // A doubled world with no radar meant two pilots could hunt for an hour and
    // never meet, which is not tension, it is an empty room. Every contact off
    // the edge of the view gets an arrow on the rim of the screen with its
    // distance, so the hunt is a chase rather than a search. The arrow gives away
    // a bearing, never a hull or a health bar — you still have to close.
    try {
      const vw = rt.viewW || (ctx.canvas && ctx.canvas.width) || 0;
      const vh = rt.viewH || (ctx.canvas && ctx.canvas.height) || 0;
      const camX = (rt.camX != null) ? rt.camX : (rt.archer ? rt.archer.x - vw / 2 : 0);
      const camY = (rt.camY != null) ? rt.camY : (rt.archer ? rt.archer.y - vh / 2 : 0);
      if (vw && vh && rt.archer) {
        const ax = rt.archer.x, ay = rt.archer.y;
        for (const [, p] of _pilots) {
          if (p.dead) continue;
          const onX = p.x > camX + 40 && p.x < camX + vw - 40;
          const onY = p.y > camY + 40 && p.y < camY + vh - 40;
          if (onX && onY) continue;
          const ang = Math.atan2(p.y - ay, p.x - ax);
          const rr = Math.min(vw, vh) * 0.40;
          const mx = ax + Math.cos(ang) * rr, my = ay + Math.sin(ang) * rr;
          const dist = Math.round(Math.hypot(p.x - ax, p.y - ay));
          ctx.save(); ctx.translate(mx, my); ctx.rotate(ang);
          ctx.globalAlpha = 0.9; ctx.fillStyle = '#ff5a68';
          ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(-9, 8); ctx.lineTo(-9, -8); ctx.closePath(); ctx.fill();
          ctx.restore();
          ctx.globalAlpha = 0.8; ctx.fillStyle = '#ffb0b8';
          ctx.font = '700 11px Rajdhani, sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(dist > 999 ? (dist / 1000).toFixed(1) + 'k' : dist, mx, my + 22);
        }
      }
    } catch (e) {}

    // ---- REMOTE PILOTS ----
    ctx.textAlign = 'center';
    for (const [, p] of _pilots) {
      ctx.globalAlpha = p.dead ? 0.28 : 1;
      ctx.fillStyle = p.dead ? '#5a6472' : '#ff5a68';
      ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 15); ctx.lineTo(p.x + 11, p.y + 12); ctx.lineTo(p.x, p.y + 6); ctx.lineTo(p.x - 11, p.y + 12);
      ctx.closePath(); ctx.fill(); ctx.stroke();

      // nameplate + hp
      ctx.globalAlpha = p.dead ? 0.4 : 0.95;
      ctx.fillStyle = '#0b0f18'; ctx.fillRect(p.x - 34, p.y - 40, 68, 6);
      ctx.fillStyle = p.hp > 0.5 ? '#7ce0a0' : p.hp > 0.2 ? '#ffd24d' : '#ff5a68';
      ctx.fillRect(p.x - 33, p.y - 39, 66 * Math.max(0, Math.min(1, p.hp)), 4);
      ctx.font = '700 12px Rajdhani, sans-serif';
      ctx.fillStyle = p.dead ? '#7b8698' : '#ffd9dc';
      ctx.fillText(p.name, p.x, p.y - 46);
    }
    ctx.restore();
  }

  // Which remote pilot is nearest to a world point, within `r`. The engine calls
  // this when a player projectile expires so a hit can be attributed.
  // SWEPT, NOT A POINT TEST. A projectile is checked once a frame, and a fast
  // one covers far more than a hull's width between frames — so a point test at
  // its current position let shots pass clean through a pilot at high fire rates
  // and high move speed, which reads as "my guns do nothing in here". This tests
  // the SEGMENT the projectile travelled, so a hit lands wherever along that line
  // it should have.
  function pilotNear(x, y, r, px, py) {
    const hasSeg = (px !== undefined && py !== undefined);
    let best = null, bd = r * r;
    for (const [uid, p] of _pilots) {
      if (p.dead) continue;
      let d;
      if (hasSeg) {
        const vx = x - px, vy = y - py;
        const len2 = vx * vx + vy * vy;
        const s = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - px) * vx + (p.y - py) * vy) / len2)) : 0;
        const cx = px + vx * s, cy = py + vy * s;
        d = (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy);
      } else {
        d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
      }
      if (d <= bd) { bd = d; best = uid; }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // UI.toast IS NOT EXPORTED. Every message this module sent went nowhere —
  // "someone beat you to it", "too far away", "sign in" — all of it silently
  // dropped, which is why the zone felt unresponsive. unlockToast is the
  // exported one.
  function toast(m) {
    try {
      const U = window.UI;
      if (U && U.unlockToast) return U.unlockToast(String(m));
      if (U && U.toast) return U.toast(String(m), '#c9a0ff');
    } catch (e) {}
    try { banner('\u26e9 TEMPLE', String(m)); } catch (e) {}
  }
  function banner(t, s) { try { window.KOTH && window.KOTH.banner ? window.KOTH.banner(t, s) : toast(t); } catch (e) { toast(t); } }

  window.addEventListener('beforeunload', () => { try { if (active()) navigator.sendBeacon && cl() && cl().rpc('temple_leave'); } catch (e) {} });

  window.TEMPLE = {
    GATE_LV, ZONE, ALTAR_R,
    enter, leave, unlocked, betaOn, active, lvl, fmt,
    engineTick, engineRender, pilotNear, reportKill, applyDeath, onHit,
    poll, refreshRecent, claim,
    altar: () => _altar, altarMs, waitedS, itemUp,
    vigil: () => _vigil, topVigil: () => _topVigil, holding: () => _holding,
    pilots: () => [..._pilots.values()], count: () => _pilots.size,
    recent: () => _recent, lastError: () => _err,
  };
})();
