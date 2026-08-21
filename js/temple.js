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
  let _linkUp = false;      // is the Realtime channel actually joined?
  let _vigil = 0, _topVigil = 0, _holding = false;
  let _seenCount = -1;
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
    _pilots.clear(); _hitAt.clear(); _seenCount = -1; _lastDeathAt = new Date(Date.now() - 5000).toISOString();
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
  // REALTIME — the fast lane, never the only lane
  // ---------------------------------------------------------------------------
  function openChannel() {
    const c = cl(); if (!c) return;
    closeChannel();
    try {
      _chan = c.channel(CHAN, { config: { broadcast: { self: false } } });

      // POSITIONS. Untrusted — a broadcast decides only where a nameplate is
      // drawn. Nothing here can cost anyone anything, which is exactly why
      // positions may ride it and kills may not.
      _chan.on('broadcast', { event: 'p' }, (m) => {
        const d = (m && m.payload) || null; if (!d || !d.id || d.id === _uid) return;
        const prev = _pilots.get(d.id);
        // FRACTION FIRST. A payload from this build carries fx/fy; one from an
        // older client carries raw x,y plus (in 710+) its own world size, which is
        // enough to rescale. Absent both, the raw number is used as-is and will be
        // wrong on a differently-shaped screen — which is the bug this replaces.
        const fx = (d.fx != null) ? +d.fx : (d.ww ? (+d.x || 0) / d.ww : null);
        const fy = (d.fy != null) ? +d.fy : (d.wh ? (+d.y || 0) / d.wh : null);
        const row = { name: String(d.n || 'Operator').slice(0, 24), ship: d.s || '',
                      power: Number(d.pw) || 0,
                      fx: fx != null ? Math.max(0, Math.min(1, fx)) : null,
                      fy: fy != null ? Math.max(0, Math.min(1, fy)) : null,
                      x: +d.x || 0, y: +d.y || 0,
                      hp: Math.max(0, Math.min(1, +d.h || 0)), t: Date.now(), dead: !!d.d };
        place(row);
        _pilots.set(d.id, row);
        if (prev) noteRemoteHp(d.id, row, prev.hp);
      });

      // INCOMING FIRE, fast path. The guaranteed path is temple_take(); both feed
      // the same applyIncoming().
      _chan.on('broadcast', { event: 'h' }, (m) => {
        const d = (m && m.payload) || null;
        if (!d || d.to !== _uid) return;
        applyIncoming(Math.max(1, Math.round(+d.d || 1)), d.fn || 'another pilot', d.from);
      });

      // A PILOT DIED AND NAMED ME. Report it — the server still decides.
      _chan.on('broadcast', { event: 'x' }, (m) => {
        const d = (m && m.payload) || null;
        if (!d || !d.from) return;
        const p = _pilots.get(d.from); if (p) { p.hp = 0; p.dead = true; }
        if (d.by === _uid) { _hitAt.delete(d.from); reportKill(d.from); }
      });

      _chan.subscribe((status) => {
        // WHETHER THE SOCKET ACTUALLY JOINED IS SOMETHING WE HAVE TO KNOW.
        // Sending into an unjoined channel throws nothing and delivers nothing,
        // which is how damage could go missing with no error on either screen.
        // This flag decides whether the fast path is even attempted, and the pill
        // shows it, so a degraded link is visible rather than mysterious.
        _linkUp = (status === 'SUBSCRIBED');
      });
    } catch (e) { _err = 'channel'; _linkUp = false; }
  }

  // ONE PLACE APPLIES INCOMING DAMAGE, whichever path delivered it.
  //
  // Both paths run at once, deliberately. The socket is the same bytes arriving
  // sooner, and the database path is read-and-clear, so the overlap is bounded by
  // a single heartbeat — at worst a fight the victim was already losing ends a
  // fraction of a second earlier. That is a far better failure than the one this
  // replaces, where a quiet socket meant no damage at all and no error anywhere.
  function applyIncoming(dmg, byName, byUid) {
    if (!active() || !(dmg > 0)) return;
    const rt = G().rt, a = rt && rt.archer;
    if (!a || a.dead || (a.invuln || 0) > 0) return;
    a.hp = Math.max(0, a.hp - dmg);
    try { rt.shake = Math.min(6, (rt.shake || 0) + 2); } catch (e) {}
    if (a.hp <= 0 && !a.dead) {
      // Hand the engine a killer it understands and let its OWN death path run —
      // hull levels wiped, item drop rolled, towed home. Identical to dying to a
      // hostile, which is what the brief asked for.
      a.killer = { isBoss: false, type: { name: String(byName || 'another pilot') } };
      // THE DYING PILOT ANNOUNCES IT, BEFORE TEARDOWN.
      //
      // This is what closes the kill loop. The killer detects a kill by watching
      // the victim's HP fall to zero — but the victim's death path tows them home
      // and closes this channel in the same frame, so that broadcast would never
      // be sent. No detection, no temple_kill call, no logged kill, no credit.
      //
      // The victim is only saying "I died, and it was you" — a statement it has
      // no reason to fake in the attacker's favour. The CLAIM is still the
      // killer's, still an RPC, still range- and presence-checked by the server.
      if (byUid) {
        try { if (_chan && _linkUp) _chan.send({ type: 'broadcast', event: 'x', payload: { from: _uid, n: meName(), by: byUid } }); } catch (e) {}
      }
      _selfDeathAt = Date.now();
    }
  }

  function closeChannel() {
    try { if (_chan) { cl().removeChannel(_chan); } } catch (e) {}
    _chan = null;
  }

  // POSITIONS TRAVEL AS FRACTIONS OF THE WORLD, NEVER AS RAW COORDINATES (710).
  //
  // fitWorld() gives every device the same world AREA but lays it out at the
  // SCREEN'S OWN ASPECT RATIO, so worldW/worldH differ from phone to desktop —
  // and the Temple then doubles both. Raw x,y are therefore not comparable
  // between two clients: a pilot standing on their own altar (worldW/2) broadcast
  // a number that, read in a differently-shaped world, lands somewhere else
  // entirely and frequently outside the map. That is why pilots could not see or
  // hit each other while the head-count said they were both here.
  //
  // In fractions the altar is (0.5, 0.5) in every world, so a fraction means the
  // same place on every screen. `w`/`h` ride along so a client that still
  // receives a raw-coordinate payload from an older build can rescale it.
  function cast() {
    if (!_chan || !active()) return;
    const rt = G().rt, a = rt && rt.archer; if (!a) return;
    try {
      _chan.send({ type: 'broadcast', event: 'p', payload: {
        id: _uid, n: meName(), s: st().ship || '', pw: myPower(),
        fx: rt.worldW ? +(a.x / rt.worldW).toFixed(5) : 0.5,
        fy: rt.worldH ? +(a.y / rt.worldH).toFixed(5) : 0.5,
        x: Math.round(a.x), y: Math.round(a.y),
        ww: rt.worldW | 0, wh: rt.worldH | 0,
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
        // ARRIVALS ARE ANNOUNCED. The head-count was only ever a number on a
        // pill; a pilot who never looked at it had no idea the arena had stopped
        // being empty. In a zone whose whole content is other people, "someone
        // just walked in" is the single most useful thing the game can say.
        const n = Number(r.data.pilots) || 0;
        if (_seenCount >= 0 && n > _seenCount && n > 1) {
          banner('\u26a0 CONTACT', n === 2 ? 'Another pilot is in the Temple. Watch your bearings.'
                                          : (n - 1) + ' other pilots are in the Temple.');
        }
        _seenCount = n;
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

  // WHERE A CONTACT IS *ON THIS SCREEN*. Fractions are the wire format; this is
  // the only place they become pixels, and it re-runs every tick so a rotation or
  // a resize (fitWorld reshapes the world) never strands a nameplate.
  function place(p) {
    if (!p || p.fx == null || p.fy == null) return p;
    try {
      const rt = G().rt; if (!rt || !rt.worldW) return p;
      p.x = p.fx * rt.worldW; p.y = p.fy * rt.worldH;
    } catch (e) {}
    return p;
  }

  // Merge server presence over anything the broadcast has not delivered lately.
  // Broadcast wins while it is flowing — it is ten times fresher — but a contact
  // that has gone quiet on the socket is still drawn from the database rather
  // than vanishing.
  async function pollPilots() {
    const c = cl(); if (!c) return;
    try {
      const r = await c.rpc('temple_pilots');
      if (r.error || !Array.isArray(r.data)) return;
      const now = Date.now();
      for (const row of r.data) {
        if (!row.user_id || row.user_id === _uid) continue;
        const cur = _pilots.get(row.user_id);
        // a broadcast inside the last 1.5s is fresher than this row
        if (cur && now - cur.t < 1500) continue;
        // fx/fy are what temple_beat stored; x/y are the sender's own world
        // pixels and are only a fallback for a server that predates the columns
        // being returned (see temple.sql · temple_pilots).
        const hasF = row.fx != null && row.fy != null;
        _pilots.set(row.user_id, place({
          name: String(row.name || 'Operator').slice(0, 24),
          ship: row.ship || '', power: Number(row.power) || 0,
          fx: hasF ? Math.max(0, Math.min(1, Number(row.fx))) : null,
          fy: hasF ? Math.max(0, Math.min(1, Number(row.fy))) : null,
          x: Number(row.x) || 0, y: Number(row.y) || 0,
          hp: Math.max(0, Math.min(1, Number(row.hp) || 0)),
          t: now, dead: !!row.dead, srv: 1,
        }));
      }
    } catch (e) {}
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
  const _owed = new Map();        // uid -> damage dealt but not yet posted
  let _postT = 0;
  function onHit(uid, dmg) {
    if (!uid) return;
    const d = Math.max(1, Math.round(dmg || 1));
    _hitAt.set(uid, Date.now());
    // FAST PATH — instant, and lost silently if the socket is not joined.
    if (_chan && _linkUp) {
      try { _chan.send({ type: 'broadcast', event: 'h', payload: { to: uid, d, from: _uid, fn: meName() } }); } catch (e) {}
    }
    // GUARANTEED PATH — accumulate and post a few times a second. Batched
    // because a fleet at endgame fire rate lands dozens of shots a second and one
    // request per bullet would be a denial of service on our own database.
    _owed.set(uid, (_owed.get(uid) || 0) + d);
    // local feedback so the shot does not look like it passed through them
    try { const p = _pilots.get(uid); if (p) p.hp = Math.max(0, p.hp - 0.001); } catch (e) {}
  }
  async function postOwed() {
    const c = cl(); if (!c || !_owed.size) return;
    const batch = [..._owed.entries()];
    _owed.clear();
    for (const [uid, d] of batch) {
      // A refusal is not retried: it means out of range or already dead, and
      // re-posting stale damage at a pilot who has moved is worse than losing it.
      try { await c.rpc('temple_hit', { p_victim: uid, p_dmg: d }); } catch (e) {}
    }
  }
  // Damage dealt TO me, read and cleared server-side so it can neither double up
  // nor go missing. Applied through my own ship exactly as a broadcast hit is.
  async function takeOwed() {
    const c = cl(); if (!c || !active()) return;
    try {
      const r = await c.rpc('temple_take');
      const d = (r && r.data) || {};
      const dmg = Math.max(0, Number(d.dmg) || 0);
      if (dmg > 0) applyIncoming(dmg, d.by || 'another pilot', 'srv');
    } catch (e) {}
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
    // 6s is comfortably longer than both the 130ms broadcast and the 1.5s server
    // poll, so a contact only disappears when they have genuinely left.
    for (const [k, p] of _pilots) {
      if (now - p.t > 6000) { _pilots.delete(k); continue; }
      place(p);   // fractions -> this device's world, every frame
    }

    if (now - _castT >= CAST_MS) { _castT = now; cast(); }
    if (now - _beatT >= BEAT_MS) { _beatT = now; beat(false); pollPilots(); takeOwed(); }
    // post accumulated damage a few times a second — batched, because at
    // endgame fire rate one request per bullet would be a denial of service on
    // our own database
    if (now - _postT >= 350) { _postT = now; postOwed(); }
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
    // A DARK CIRCLE YOU CAN SEE FROM ANYWHERE, WITH AN OBVIOUS SOCKET IN IT.
    // The previous pass drew near-black plates at 3-4% white over a near-black
    // arena, so from a few hundred units out there was nothing there — the place
    // the whole zone is about read as empty floor, and an empty altar gave no clue
    // that an item was ever going to appear on it. Now: a hard-edged dark well, a
    // bright rim, and a socket at the centre that is visibly WAITING when empty.
    const pulse = 0.5 + 0.5 * Math.sin(time * 2);
    const up = itemUp();
    const hue = up ? '#ffd24d' : _holding ? '#7ce0a0' : '#8f7bff';

    // ground wash, well outside the disk, so the place is findable from range
    ctx.globalAlpha = 0.13 + pulse * 0.09;
    const gw = ctx.createRadialGradient(cx, cy, ALTAR_R * 0.5, cx, cy, ALTAR_R * 2.1);
    gw.addColorStop(0, hue); gw.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gw;
    ctx.beginPath(); ctx.arc(cx, cy, ALTAR_R * 2.1, 0, Math.PI * 2); ctx.fill();

    // THE WELL — a dark disk, darker than any arena background, so the circle is
    // the thing you see rather than the thing you have to look for.
    ctx.globalAlpha = 1;
    const well = ctx.createRadialGradient(cx, cy, 0, cx, cy, ALTAR_R);
    well.addColorStop(0, '#01030a');
    well.addColorStop(0.72, '#05070f');
    well.addColorStop(1, '#0b1020');
    ctx.fillStyle = well;
    ctx.beginPath(); ctx.arc(cx, cy, ALTAR_R, 0, Math.PI * 2); ctx.fill();

    // two concentric plate edges — lit, not filled, so the floor stays dark
    ctx.globalAlpha = 0.55; ctx.strokeStyle = hue; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, ALTAR_R * 0.78, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, ALTAR_R * 0.5, 0, Math.PI * 2); ctx.stroke();

    // radial ribs, turning slowly
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(time * 0.06);
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = 'rgba(180,200,255,.16)'; ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const a2 = (Math.PI * 2 / 12) * i;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a2) * ALTAR_R * 0.5, Math.sin(a2) * ALTAR_R * 0.5);
      ctx.lineTo(Math.cos(a2) * ALTAR_R * 0.97, Math.sin(a2) * ALTAR_R * 0.97);
      ctx.stroke();
    }
    ctx.restore();

    // machined rim
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = hue; ctx.lineWidth = _holding ? 6 : 4;
    ctx.shadowColor = hue; ctx.shadowBlur = up ? 30 : 16;
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

    // THE SOCKET — where the item lands. Drawn whether or not anything is on it,
    // because "something appears HERE" is the one thing the centre has to say.
    // Empty: a dark inset ring with a dashed collar turning slowly. Occupied: the
    // same socket lit, with the item standing in it.
    ctx.globalAlpha = 1;
    const SOCK = 34;
    const sg = ctx.createRadialGradient(cx, cy, 2, cx, cy, SOCK);
    sg.addColorStop(0, up ? 'rgba(255,210,77,.22)' : 'rgba(140,120,255,.10)');
    sg.addColorStop(1, '#01030a');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(cx, cy, SOCK, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = hue; ctx.lineWidth = 2;
    ctx.globalAlpha = up ? 1 : 0.5 + pulse * 0.3;
    ctx.beginPath(); ctx.arc(cx, cy, SOCK, 0, Math.PI * 2); ctx.stroke();
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(time * (up ? 0.5 : 0.22));
    ctx.globalAlpha = up ? 0.9 : 0.45 + pulse * 0.25;
    ctx.strokeStyle = hue; ctx.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      const a3 = (Math.PI * 2 / 8) * i;
      ctx.beginPath();
      ctx.arc(0, 0, SOCK + 9, a3, a3 + 0.24);
      ctx.stroke();
    }
    ctx.restore();

    // ---- IN-WORLD COUNTDOWN ----
    // On the disk itself, and clear of the socket — a pilot holding the centre
    // should never have to look away from the fight to read the clock.
    if (!up) {
      const ms = altarMs();
      const soon = ms > 0 && ms < 600000;
      ctx.textAlign = 'center';
      ctx.globalAlpha = 0.9;
      ctx.font = '800 13px Rajdhani, sans-serif';
      ctx.fillStyle = soon ? '#ff8a3d' : '#8f7bff';
      ctx.fillText(soon ? 'THE ALTAR IS WAKING' : 'NEXT SPAWN', cx, cy - SOCK - 26);
      ctx.font = '900 ' + (soon ? 40 : 34) + 'px Orbitron, sans-serif';
      ctx.fillStyle = soon ? '#ffb37a' : '#cbbcff';
      if (soon) { ctx.shadowColor = '#ff8a3d'; ctx.shadowBlur = 18 + pulse * 14; }
      ctx.fillText(ms > 0 ? hmsWorld(ms) : 'ANY MOMENT', cx, cy + SOCK + 48);
      ctx.shadowBlur = 0;
      if (_vigil > 0) {
        ctx.font = '700 12px Rajdhani, sans-serif';
        ctx.fillStyle = '#7ce0a0';
        ctx.fillText('VIGIL ' + Math.floor(_vigil / 60) + 'm', cx, cy + SOCK + 70);
      }
    }

    if (up) {
      const s = 18 + pulse * 8;
      ctx.textAlign = 'center';
      ctx.globalAlpha = 0.95; ctx.font = '800 13px Rajdhani, sans-serif';
      ctx.fillStyle = '#ffd24d';
      ctx.fillText('TAKE IT', cx, cy - SOCK - 26);
      ctx.save(); ctx.translate(cx, cy - pulse * 4); ctx.rotate(time * 0.8);
      ctx.fillStyle = '#fff6d0';
      ctx.shadowColor = '#ffd24d'; ctx.shadowBlur = 26;
      ctx.beginPath();
      ctx.moveTo(0, -s); ctx.lineTo(s * 0.42, 0); ctx.lineTo(0, s); ctx.lineTo(-s * 0.42, 0);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // ---- CONTACT MARKERS ----
    // Every pilot in the zone gets a bearing marker on a ring around this ship,
    // with a distance, whenever they are far enough away to be off screen. The
    // hunt is a chase, not a search. The marker gives away a bearing and a range
    // and nothing else — no hull, no health, no name — so closing is still work.
    try {
      const a = rt.archer;
      if (a) {
        const NEAR = 520;      // inside this they are on screen anyway
        const RING = 300;      // world-space radius the marker sits on
        for (const [, p] of _pilots) {
          if (p.dead) continue;
          const dx = p.x - a.x, dy = p.y - a.y;
          const dist = Math.hypot(dx, dy);
          if (dist < NEAR) continue;
          const ang = Math.atan2(dy, dx);
          const mx = a.x + Math.cos(ang) * RING, my = a.y + Math.sin(ang) * RING;
          ctx.save(); ctx.translate(mx, my); ctx.rotate(ang);
          ctx.globalAlpha = 0.95; ctx.fillStyle = '#ff5a68';
          ctx.shadowColor = '#ff5a68'; ctx.shadowBlur = 12;
          ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, 9); ctx.lineTo(-10, -9); ctx.closePath(); ctx.fill();
          ctx.restore();
          ctx.globalAlpha = 0.9; ctx.fillStyle = '#ffb0b8';
          ctx.font = '700 12px Rajdhani, sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(dist > 999 ? (dist / 1000).toFixed(1) + 'k' : Math.round(dist),
                       a.x + Math.cos(ang) * (RING + 26), a.y + Math.sin(ang) * (RING + 26));
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
    poll, pollPilots, refreshRecent, claim, linkUp: () => _linkUp,
    altar: () => _altar, altarMs, waitedS, itemUp,
    vigil: () => _vigil, topVigil: () => _topVigil, holding: () => _holding,
    pilots: () => [..._pilots.values()], count: () => _pilots.size,
    recent: () => _recent, lastError: () => _err,
  };
})();
