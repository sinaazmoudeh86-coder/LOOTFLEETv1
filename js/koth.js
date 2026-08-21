/* =============================================================================
   koth.js — KING OF THE HILL · 24-hour PvE kill race (model + engine)
   ---------------------------------------------------------------------------
   Enter → Kill → Climb → Win. One private PvE instance per pilot, one shared
   ladder, 10,000 LootCoins to whoever ends the day on top.

   FIVE DECISIONS THIS FILE MAKES
   ---------------------------------------------------------------------------
   1. THE DIFFICULTY CURVE IS PURE HP, AT A FIXED SPAWN ZONE. The spec's table
      has two columns — enemy level and HP multiplier — and driving BOTH from
      the engine would double-scale catastrophically: dungeonScale() is
      exponential, so moving the spawn zone from 100 to 1000 is worth ~1,750x HP
      on its own, and stacking the table's 10,000x on top gives 1.75e7x. The
      table's INTENT is unambiguous ("HP should scale much faster than damage"),
      so the zone is pinned at 100 and the whole curve is expressed through the
      HP multiplier. The level column is what the pilot is shown, and it feeds a
      deliberately gentle damage scalar.
   2. THE CLIENT NEVER SENDS A TOTAL. Kills accumulate locally and flush as
      DELTAS through koth_bump(), which owns the sum and rate-caps every add.
      A failed flush stays queued and retries; a successful one subtracts
      exactly what was acknowledged, so nothing is lost and nothing double-counts.
   3. THE SERVER'S NUMBER IS THE TRUTH. The HUD shows the acknowledged total plus
      whatever is still in flight, so it moves on every kill without ever
      drifting from the ladder.
   4. NO XP, NO LOOT, NO RESOURCES — AND NO DEATH PENALTY EITHER. The zone gives
      nothing, so it must not take anything: dying here costs no gear and no hull
      level, the same carve-out the Server Dreadnaught run gets.
   5. THE PRIZE IS NEVER GRANTED BY THIS FILE. koth_close() decides the winner
      server-side and writes a ledger row; claim_koth_awards() drains it into
      mail with the standard meta.kind='prize' payload, which the existing CLAIM
      WINNINGS flow already knows how to pay.

   window.KOTH — see the export block at the bottom.
============================================================================= */
(function () {
  'use strict';
  const G = () => window.GAME;
  const C = () => window.CONFIG;
  const $ = (id) => document.getElementById(id);
  const now = () => { try { return window.SERVERTIME ? window.SERVERTIME.now() : Date.now(); } catch (e) { return Date.now(); } };

  const GATE_LV = 80;             // the arena is Level 200 hostiles — below this it is not a race
  const KOTH_ZONE = 150;          // base spawn zone — see decision 1
  const DAY_MS = 86400000;
  const FLUSH_MS = 5000;          // delta submission interval
  const POLL_MS = 9000;           // ladder refresh (spec asks for 5-10s)
  const PRIZE_LC = 10000;

  // ---- THE DIFFICULTY TABLE -------------------------------------------------
  // [minKills, enemyLevel, hpMultiplier] — DISPLAY BANDS, derived from the curve
  // below so the table and the maths can never disagree.
  //
  // RETUNED IN 694: THE MODEL CHANGED, NOT JUST THE NUMBERS.
  //
  // 679 tripled HP every 100 kills. That is EXPONENTIAL, and an exponential ramp
  // makes a throughput race unplayable for a reason worth stating plainly: with
  // HP ×r per band, doubling your DPS buys a FIXED number of extra kills no
  // matter how strong you already are — about 63 kills at ×3. Years of fleet
  // building and one afternoon of it hit the same wall within a few hundred kills
  // of each other. That is not a challenge, it is a stop, and everything past it
  // is the same outcome wearing a bigger number: by kill 1,100 a hostile carried
  // 300,000× base HP, which at Zone 150 is 3×10¹⁴.
  //
  // POLYNOMIAL instead: hp = (1 + kills/300)². Cost per kill still rises without
  // limit, so the race still has a natural ceiling and can still run forever —
  // but the ceiling MOVES with the fleet. Under a square law total kills scale as
  // the cube root of DPS, so a 10× stronger fleet earns about 2.15× the score:
  // strength is properly rewarded and cannot run away with the board, which is
  // exactly what a daily ladder wants.
  //
  //     kills      300    600   1,200   3,000   10,000   35,000
  //     HP mult     ×4     ×9     ×25    ×121   ×1,225  ×13.7k
  //
  // Against 679's table that is a ~12,000× reduction at kill 1,100, and the gap
  // keeps widening. Enemy LEVEL is cosmetic and climbs on its own gentler line.
  const HP_SOFT = 300;            // kills per +1 on the squared term
  const HP_POW = 2;               // square law — see the note above
  const LV_PER_BAND = 40;         // enemy level added per 100 kills
  const LV_BASE = 200;
  const BAND = 100;               // display band width, in kills

  function hpMultFor(kills) {
    const k = Math.max(0, kills | 0);
    return Math.round(Math.pow(1 + k / HP_SOFT, HP_POW) * 100) / 100;
  }
  function lvlFor(kills) {
    return LV_BASE + Math.floor(Math.max(0, kills | 0) / BAND) * LV_PER_BAND;
  }
  // Twelve display bands, BUILT FROM THE CURVE. The ladder card reads these, the
  // engine reads tierFor(); one source, so they cannot drift apart the way a
  // hand-written table and a formula always eventually do.
  const TIERS = Array.from({ length: 12 }, (_, i) => {
    const from = i * BAND;
    return [from, lvlFor(from), hpMultFor(from)];
  });
  // Past 1,200: +200 levels and a TRIPLING of HP per 100 kills.
  //
  // THE TRIPLING IS CAPPED. Taken literally an open-ended curve produces numbers
  // that stop being numbers — sixty-digit multipliers that overflow the card and
  // push enemy HP toward the edge of what a double can hold. It is also long past
  // the point of meaning anything: the strongest build in the game walls out well
  // before this, and every multiplier above that is the same outcome (nothing
  // dies) wearing a bigger number.
  //
  // So HP scales as specified until HP_CAP and then stops. Enemy LEVEL keeps
  // climbing forever, because that is the cosmetic that shows how deep a pilot
  // pushed, and the tier reports `capped` so the UI can say WALL instead of
  // printing a meaningless figure.
  // THE RAMP IS ENDLESS. HP_CAP is not a difficulty ceiling — it is the point
  // where a double stops being a number. Tripling every 100 kills stays finite
  // until roughly 58,000 kills, which no 24-hour race reaches, so in practice the
  // curve never stops climbing; the cap only guarantees the arithmetic can never
  // reach Infinity and print NaN across the HUD. Enemy LEVEL is uncapped outright.
  // THE RAMP IS ENDLESS AND NEEDS NO CAP NOW. A square law reaches 1e300 only at
  // roughly 3×10¹⁵⁹ kills, so the overflow the old cap guarded against cannot
  // happen inside a 24-hour race. HP_CAP survives purely as a NaN backstop and as
  // the flag the UI reads to print WALL.
  const HP_CAP = 1e300;
  function tierFor(kills) {
    const k = Math.max(0, kills | 0);
    const band = Math.floor(k / BAND);
    const raw = hpMultFor(k);
    const hp = Math.min(HP_CAP, isFinite(raw) ? raw : HP_CAP);
    return {
      idx: band,
      level: lvlFor(k),
      hp,
      capped: hp >= HP_CAP,
      from: band * BAND,
      to: (band + 1) * BAND - 1,
      // Past the twelve printed bands the ladder card switches to the formula
      // line rather than inventing rows forever.
      open: band >= TIERS.length,
    };
  }
  // Visual mass ceiling. 2.4x a base hull is large enough to read as a wall and
  // small enough that a full field never occludes the pilot.
  const SIZE_CAP = 2.4;
  // DAMAGE IS THE TAME AXIS — kept for the difficulty readout only. Hostiles in
  // the arena deal zero damage (see scaleEnemy); this is what the HUD shows for
  // "how hard is this tier" and what koth_bump reports as the tier index.
  function dmgMultFor(hpMult) { return 1 + Math.log2(Math.max(1, hpMult)) * 0.12; }

  // ---- clock ----------------------------------------------------------------
  const dayIdx = (t) => Math.floor((t == null ? now() : t) / DAY_MS);
  const dayEnds = (d) => ((d == null ? dayIdx() : d) + 1) * DAY_MS;
  const msLeft = () => Math.max(0, dayEnds() - now());

  // ===========================================================================
  // LOCAL STATE
  // ===========================================================================
  // Small and disposable: the LADDER is the server's. What lives here is the
  // pending delta (so a dropped connection cannot eat kills), the last
  // acknowledged total (so the HUD reads correctly offline), and the
  // notification bookkeeping that stops the same alert firing twice.
  function ks() {
    const st = G() && G().state; if (!st) return null;
    let k = st.koth;
    if (!k || typeof k !== 'object') k = st.koth = {};
    if (k.v !== 1) k.v = 1;
    const d = dayIdx();
    if (k.day !== d) {
      k.day = d; k.ack = 0; k.pend = 0; k.rank = 0; k.seenRank = 0;
      k.wasKing = 0; k.top5 = 0; k.h1 = 0; k.m10 = 0; k.entered = 0; k.best = k.best | 0;
      // THE REPLAY COUNTER IS PER-EVENT AND MUST RESET WITH IT. koth_bump zeroes
      // last_seq on a new day; if the client kept climbing while the server
      // restarted, the two are still consistent — but a client that ever restarts
      // LOWER than the server (a merge, a restored save) would send a seq the
      // server has already seen and have every submission answered as a replay.
      // Resetting both ends on the same boundary keeps that window to one day.
      k.seq = 0; k.inflight = 0;
    }
    if (k.ack == null) k.ack = 0;
    if (k.pend == null) k.pend = 0;
    if (!(k.ack >= 0)) k.ack = 0;
    if (!(k.pend >= 0)) k.pend = 0;
    return k;
  }
  const kills = () => { const k = ks(); return k ? (k.ack | 0) + (k.pend | 0) : 0; };
  const rank = () => { const k = ks(); return k ? (k.rank | 0) : 0; };
  function lvl() { try { return (G().state.level | 0) || 1; } catch (e) { return 1; } }
  function unlocked() { return lvl() >= GATE_LV; }
  function save() { try { G().save(); } catch (e) {} }
  const fmt = (n) => { try { return G().formatNum(Math.floor(n)); } catch (e) { return String(Math.floor(n || 0)); } };
  function toast(m) { try { window.UI && window.UI.unlockToast && window.UI.unlockToast(m); } catch (e) {} }

  // ===========================================================================
  // CLOUD
  // ===========================================================================
  let _board = [], _boardAt = 0, _entrants = 0, _next = null, _flushing = false, _lastErr = '';
  // LIFETIME CROWNS — a separate, much slower board. koth_hall only changes once
  // a day at close, so this is fetched on demand and cached for the session
  // rather than polled alongside the live race.
  let _hall = [], _hallAt = 0, _hallBusy = false;
  const cl = () => { try { return (window.CLOUD && window.CLOUD.enabled && window.CLOUD.client) || null; } catch (e) { return null; } };
  function signedIn() { try { return !!(window.ACCOUNT && window.ACCOUNT.current && window.ACCOUNT.current()); } catch (e) { return false; } }
  function meName() {
    try { return (G().state.pilotName || (window.ACCOUNT && ACCOUNT.current() && ACCOUNT.current().name) || 'Operator'); } catch (e) { return 'Operator'; }
  }
  function myPower() { try { return Number(G().score ? G().score() : 0) || 0; } catch (e) { return 0; } }

  // FLUSH — hand the server the pending delta and adopt its answer.
  // Only the ACKNOWLEDGED amount is subtracted, so a clamp or a partial grant
  // leaves the remainder queued rather than silently vanishing.
  async function flush(force) {
    const k = ks(); if (!k) return;
    if (_flushing) return;
    const c = cl();
    if (!c || !signedIn()) return;
    if (!force && !(k.pend > 0)) return;
    const send = Math.min(600, k.pend | 0);
    if (send <= 0 && !force) return;
    // NO ENTRY, NO FLUSH. pend can only honestly come from this device's own
    // arena session today — onKill() is gated on rt.kothrun. A pending balance
    // on a device that never entered today is a zombie: a merged-in copy of
    // kills another device already flushed, or a restored snapshot. Submitting
    // it double-counts; there is nothing legitimate it could be. Drop it and
    // say nothing — the server total (ack) is untouched and correct.
    if (!k.entered && (k.pend | 0) > 0) { k.pend = 0; save(); return; }
    _flushing = true;
    // REPLAY GUARD. koth_bump is at-least-once: if the transaction commits but
    // the response is lost, the client still holds the delta and retries it, and
    // the server would add it twice. The sequence number is per player and
    // monotonic, persisted in the save so it survives a reload; the server
    // ignores any bump whose seq it has already accepted and returns the stored
    // answer. Advanced BEFORE the call so a retry after a lost response reuses
    // the SAME number — that is the whole point.
    if (!(k.seq > 0)) k.seq = 1; else if (!k.inflight) k.seq = (k.seq | 0) + 1;
    k.inflight = 1;
    save();
    try {
      const t = tierFor(kills());
      const r = await c.rpc('koth_bump', {
        p_delta: send,
        p_name: meName(),
        p_tier: t.idx + 1,
        p_ship: (G().state.ship || null),
        p_power: myPower(),
        p_seq: k.seq | 0,
      });
      if (r.error) { _lastErr = r.error.message || 'rpc'; return; }
      const d = r.data || {};
      if (!d.ok) { _lastErr = d.reason || 'refused'; return; }
      // the call landed — the next flush is a new submission, not a retry
      k.inflight = 0;
      // the server took `granted`; anything it refused stays queued for the
      // next tick, where the elapsed time will have earned more allowance
      // RECONCILE AGAINST THE SERVER TOTAL, NEVER AGAINST OUR OWN GUESS.
      //
      // `replay` means the server recognised this seq and applied nothing. The
      // first cut of this assumed the delta must therefore already be counted
      // and cleared it outright — which is only true when the seq we reused is
      // the seq that carried it. After a save merge or a restored backup the
      // client's counter can land BELOW the server's, and then every honest
      // submission is answered as a replay and silently deleted: the player
      // keeps killing and their score never moves again for the rest of the day.
      //
      // d.kills is authoritative, and k.ack is what we last saw counted, so
      // their difference is exactly what landed — whatever the seq did. Clearing
      // that much can neither double-count nor lose a kill.
      const took = d.replay
        ? Math.max(0, Math.min(send, (d.kills | 0) - (k.ack | 0)))
        : Math.max(0, Math.min(send, d.granted | 0));
      // A replay that reconciled to nothing means our counter is behind the
      // server's. Jump past it so the next flush is accepted as new work rather
      // than bouncing forever.
      if (d.replay && took === 0) k.seq = (k.seq | 0) + 8;
      k.pend = Math.max(0, (k.pend | 0) - took);
      k.ack = Math.max(k.ack | 0, d.kills | 0);
      k.best = Math.max(k.best | 0, k.ack | 0);
      const prev = k.rank | 0;
      k.rank = d.rank | 0;
      _lastErr = '';
      rankMoved(prev, k.rank);
      save();
    } catch (e) { _lastErr = 'throw'; }
    finally { _flushing = false; }
  }

  // LIFETIME CROWNS. Ranked from koth_hall, which only koth_close() writes — a
  // crown cannot be self-reported, so this board needs no publish path and no
  // anti-cheat of its own. Cached for ten minutes; the underlying table moves
  // once per day.
  async function pollHall(force) {
    const c = cl(); if (!c) return _hall;
    if (_hallBusy) return _hall;
    if (!force && _hallAt && Date.now() - _hallAt < 600000) return _hall;
    _hallBusy = true;
    try {
      const r = await c.rpc('koth_hall_top', { p_n: 50 });
      if (!r.error && Array.isArray(r.data)) { _hall = r.data; _hallAt = Date.now(); }
    } catch (e) {} finally { _hallBusy = false; }
    return _hall;
  }

  async function pollBoard() {
    const c = cl(); if (!c) return;
    try {
      const r = await c.rpc('koth_top', { p_n: 25 });
      if (!r.error && Array.isArray(r.data)) { _board = r.data; _boardAt = Date.now(); }
    } catch (e) {}
    if (!signedIn()) return;
    try {
      const r2 = await c.rpc('koth_me');
      if (r2.error) return;
      const d = r2.data || {};
      const k = ks(); if (!k) return;
      _entrants = d.entrants | 0;
      _next = d.next == null ? null : (d.next | 0);
      // The server total can be AHEAD of ours (another device) but never behind
      // what we have already acknowledged.
      k.ack = Math.max(k.ack | 0, d.kills | 0);
      k.best = Math.max(k.best | 0, k.ack | 0);
      const prev = k.rank | 0;
      if (d.rank) k.rank = d.rank | 0;
      rankMoved(prev, k.rank);
    } catch (e) {}
  }

  // ===========================================================================
  // NOTIFICATIONS — the leaderboard is the content, so movement is gameplay
  // ===========================================================================
  function rankMoved(prev, cur) {
    const k = ks(); if (!k || !cur) return;
    if (!prev) { k.seenRank = cur; return; }
    if (cur === prev) return;
    if (cur === 1 && !k.wasKing) {
      k.wasKing = 1;
      banner('👑 YOU ARE THE KING', 'Keep killing. They are coming.');
    } else if (prev === 1 && cur > 1) {
      k.wasKing = 0;
      const lead = _board && _board[0];
      banner('⚠ YOUR CROWN HAS BEEN TAKEN', lead ? (lead.name + ' is ahead by ' + fmt(Math.max(0, (lead.kills | 0) - kills())) + ' kills') : 'You have been passed.');
    } else if (cur <= 5 && prev > 5) {
      k.top5 = 1;
      banner('🔥 TOP 5', 'You have moved into #' + cur + ' with ' + fmt(kills()) + ' kills.');
    } else if (cur < prev) {
      toast('▲ You moved to #' + cur);
    } else if (cur > prev) {
      toast('▼ You dropped to #' + cur);
    }
    k.seenRank = cur;
    try { window.KOTHUI && window.KOTHUI.syncPill(); } catch (e) {}
  }
  function clockAlerts() {
    const k = ks(); if (!k || !k.entered) return;
    const left = msLeft();
    if (left <= 600000 && !k.m10) { k.m10 = 1; banner('🚨 10 MINUTES REMAINING', 'Every kill counts.'); save(); }
    else if (left <= 3600000 && !k.h1) { k.h1 = 1; banner('⏰ 1 HOUR REMAINING', 'The race is entering its final hour.'); save(); }
  }
  let _bb, _bbT;
  function banner(title, sub) {
    try {
      if (!_bb) {
        _bb = document.createElement('div'); _bb.id = 'koth-banner';
        document.body.appendChild(_bb);
      }
      _bb.innerHTML = '<b>' + title + '</b><i>' + (sub || '') + '</i>';
      _bb.classList.add('on');
      clearTimeout(_bbT);
      _bbT = setTimeout(() => { if (_bb) _bb.classList.remove('on'); }, 3800);
    } catch (e) {}
  }

  // ===========================================================================
  // THE RUN
  // ===========================================================================
  let run = null;
  function active() { try { return !!(G().rt && G().rt.kothrun && G().rt.kothrun.active); } catch (e) { return false; } }

  function enter() {
    if (!unlocked()) { toast('King of the Hill unlocks at Level ' + GATE_LV); return false; }
    const k = ks(); if (!k) return false;
    let ok = false;
    try { ok = !!G().startKoth(KOTH_ZONE); } catch (e) {}
    if (!ok) { toast('Deploy failed — try again'); return false; }
    k.entered = 1; save();
    run = { started: now(), spawned: 0 };
    try { window.KOTHUI && window.KOTHUI.ensurePill(); } catch (e) {}
    banner('👑 KING OF THE HILL', 'No XP · No loot · Kills only');
    flush(true);
    pollBoard();
    return true;
  }
  function leave() {
    try { if (G().rt) G().rt.kothrun = null; } catch (e) {}
    run = null;
    try { window.KOTHUI && window.KOTHUI.removePill(); } catch (e) {}
    flush(true);
  }

  // ---- PRESENCE GATE --------------------------------------------------------
  // THE ARENA CANNOT BE FARMED BY AN OPEN TAB.
  //
  // Build 681 made hostiles deal zero damage — the "punching bag" change — which
  // was right for the mode and wrong for its economy. With no damage and no
  // death, a pilot who simply leaves the game open in the arena keeps auto-firing
  // and keeps scoring, all night, against a field that respawns forever. The
  // 24-hour race stops measuring how hard someone played and starts measuring who
  // left a tab open, which is the one outcome a leaderboard must never reward.
  //
  // So kills only count while the pilot is ACTUALLY THERE. Two independent tests,
  // because they catch different absences:
  //   · THE TAB IS HIDDEN — backgrounded, another app, screen locked. Immediate.
  //   · NO INPUT FOR IDLE_MS — the tab is visible but nobody has touched it. This
  //     is the overnight case, and the one the zero-damage change opened up.
  //
  // The run itself is NOT ended — that would be a nasty surprise on a phone that
  // dimmed for a moment. Kills simply stop counting, the pill says so, and the
  // moment the pilot touches the screen they resume with everything they had.
  const IDLE_MS = 4 * 60 * 1000;
  let _lastInput = Date.now();
  let _wasAway = false;
  function noteInput() { _lastInput = Date.now(); }
  try {
    ['pointerdown', 'keydown', 'touchstart', 'wheel', 'mousemove'].forEach((ev) => {
      document.addEventListener(ev, noteInput, { passive: true, capture: true });
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) noteInput();
    });
  } catch (e) {}
  // Why a kill is or is not being counted right now. The UI shows this verbatim,
  // because "my kills stopped" with no explanation is worse than the exploit.
  function presence() {
    try { if (document.hidden) return { on: false, why: 'tab in the background' }; } catch (e) {}
    if (Date.now() - _lastInput > IDLE_MS) return { on: false, why: 'no input for ' + Math.round(IDLE_MS / 60000) + ' minutes' };
    return { on: true, why: '' };
  }

  // Called by game-v93 onKill() for every hostile that dies inside the instance.
  // THE COUNTER IS NEVER CAPPED. An earlier build bounded the unflushed queue to
  // stop an unscored session dragging the difficulty tier into nonsense; that cut
  // the wrong thing — it froze real players dead at 5,000 kills. The tier is
  // endless by design, so the count feeding it has to be endless too. What the
  // cap was actually guarding against is handled where it belongs: the multiplier
  // stays finite (HP_CAP) and the screen says plainly when a run is not scored.
  function onKill() {
    const k = ks(); if (!k) return;
    const p = presence();
    if (!p.on) {
      // Announce the transition once, not every frame. The kill still happens in
      // the world — loot, fx, everything — it just does not reach the ladder.
      if (!_wasAway) {
        _wasAway = true;
        try { banner('⏸ SCORING PAUSED', 'Kills stop counting while you are away (' + p.why + '). Touch the screen to resume.'); } catch (e) {}
        try { window.KOTHUI && window.KOTHUI.syncPill(); } catch (e) {}
      }
      return;
    }
    if (_wasAway) {
      _wasAway = false;
      try { banner('▶ SCORING RESUMED', 'Back in the fight — kills are counting again.'); } catch (e) {}
    }
    k.pend = (k.pend | 0) + 1;
    try { window.KOTHUI && window.KOTHUI.syncPill(); } catch (e) {}
  }
  // Is this session actually being scored? A pilot who is not signed in can play
  // the arena all day and score nothing, and the screen has to say so.
  function scoring() { return !!(cl() && signedIn()); }

  // ---- engine hook ----------------------------------------------------------
  // Runs every frame while rt.kothrun is live. Two jobs: keep the field stocked,
  // and stamp the current tier's HP/damage onto anything that has not been
  // scaled yet. Nothing here touches the engine's own spawn machinery — it only
  // adjusts entities after they exist, which keeps the whole event out of
  // game-v93's hot paths.
  // SCALE ONE ENEMY TO THE CURRENT TIER. Idempotent via `_koth`.
  //
  // THIS MUST RUN AT SPAWN, NOT ON THE NEXT TICK. It used to live only in the
  // engineTick sweep below, which meant an enemy existed unscaled for the rest
  // of the frame it was created in. That is survivable at low power and totally
  // broken at high power: a 2.6T-score pilot puts out ~6 Qi damage per second,
  // so a base Zone-150 hull (~1e9 HP) dies in the SAME frame it spawns — before
  // the sweep ever sees it. Symptom: a pilot 15,000 kills deep, nominally facing
  // a x2.5e71 wall, one-shotting everything and racking up an impossible score.
  // Every spawn path that can fire inside the arena calls this directly now; the
  // sweep stays as a net for anything spawned by a path we do not own.
  function scaleEnemy(e, t) {
    if (!e || e._koth) return e;
    t = t || tierFor(kills());
    e._koth = 1;
    // scale from the entity's OWN base so re-tiering never compounds
    const baseHp = e.maxHp || e.hp || 1;
    e.maxHp = baseHp * t.hp;
    e.hp = e.maxHp;
    // PUNCHING-BAG ZONE. Hostiles in here deal NO damage at all.
    //
    // The race is a time sink measured in throughput, and nothing about dying
    // served that: it interrupted the run, it punished the pilot for standing
    // still in a zone whose whole point is standing still and shooting, and the
    // arena already patched them up on death anyway (game-v93 revives with a 5s
    // invulnerability), so the damage only ever cost tempo. Zeroing it outright
    // is what that revive was pretending to be, done honestly. Enemy fire still
    // renders — it just cannot hurt anyone.
    e.damage = 0; e.contactDamage = 0; e.touchDamage = 0;
    // FATTER AND BIGGER AS THE WALL GROWS, WITH A HARD CEILING. Log-scaled off
    // the HP multiplier so the growth reads across the whole ramp rather than
    // saturating in the first thousand kills, and capped at 2.4x so a late-race
    // hostile is an unmissable slab without ever eating the screen or hiding the
    // pilot underneath it.
    const grow = Math.min(SIZE_CAP, 1 + Math.log10(Math.max(1, t.hp)) * 0.05);
    e.size = (e.size || 24) * grow;
    e.kothGrow = grow;
    // big things lumber — sells the mass, and keeps a wall of slabs from
    // swarming the pilot faster than they can be cleared
    e.speed = (e.speed || 0) / (1 + (grow - 1) * 0.55);
    e.kothLevel = t.level;
    // no boss machinery in here — the race is about throughput
    e.isBoss = false; e.isSuper = false;
    return e;
  }

  function engineTick(dt, rt) {
    if (!rt || !rt.kothrun) return;
    if (!run) run = { started: now(), spawned: 0 };
    const t = tierFor(kills());
    rt.kothrun.tier = t;
    const list = rt.enemies || [];
    for (let i = 0; i < list.length; i++) scaleEnemy(list[i], t);
    // A STRONG BUILD MUST NEVER STAND AROUND WAITING. The engine respawns at
    // nodes on a timer; this tops the field up directly whenever it thins out,
    // which is what keeps kills-per-minute a function of DPS rather than of
    // spawn luck.
    rt.kothrun.t = (rt.kothrun.t || 0) + dt;
    if (rt.kothrun.t >= 0.25) {
      rt.kothrun.t = 0;
      const want = 26;
      const live = list.filter((e) => e && !e.dead && !e.dying).length;
      if (live < want) {
        let add = Math.min(6, want - live);
        while (add-- > 0) { try { G().spawnKothEnemy(); } catch (e) { break; } }
      }
    }
    clockAlerts();
    // the day rolled over under a live run — settle and reset in place
    if (ks().day !== dayIdx()) { flush(true); ks(); banner('👑 NEW RACE', '24 hours. One king. Counters reset.'); }
  }
  function engineRender(ctx, time, rt) {
    if (!rt || !rt.kothrun) return;
    // a thin crown-gold vignette so the instance never looks like free play
    try {
      const w = rt.w, h = rt.h;
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.34, w / 2, h / 2, Math.max(w, h) * 0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(255,196,60,' + (0.07 + 0.02 * Math.sin(time * 1.6)).toFixed(3) + ')');
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.restore();
    } catch (e) {}
  }

  // ===========================================================================
  // PRIZE — drain the server ledger into mail (see rank-rewards.js)
  // ===========================================================================
  async function claimPrize() {
    const c = cl(); if (!c || !window.MAIL || !G() || !G().state) return;
    let rows;
    try {
      const r = await c.rpc('claim_koth_awards');
      if (r.error) return;              // koth.sql not run yet — stay quiet
      rows = r.data || [];
    } catch (e) { return; }
    if (!rows.length) return;
    for (const a of rows) {
      const lc = a.lc | 0; if (!lc) continue;
      const when = new Date((a.day | 0) * DAY_MS).toISOString().slice(0, 10);
      window.MAIL.push({
        ic: '👑',
        title: 'KING OF THE HILL — you took the crown',
        body: 'You finished <b>#1</b> in the ' + when + ' kill race with <b>' + fmt(a.kills) + ' kills</b>.'
          + '<div style="margin:10px 0 4px;font-size:15px;color:#ffd24d;font-weight:800">👑 ' + fmt(lc) + ' LootCoins</div>'
          + '<div style="opacity:.65;font-size:11.5px">The crown is yours until the next race begins.</div>',
        meta: { kind: 'prize', prize: { lc }, koth: a.day },
      });
    }
    save();
  }

  // ===========================================================================
  // HEARTBEAT
  // ===========================================================================
  let _fT = 0, _pT = 0;
  setInterval(() => {
    if (document.hidden) return;
    const k = ks(); if (!k) return;
    const t = Date.now();
    // flush hard while a run is live; still flush lazily afterwards so a queued
    // remainder from a dropped connection always lands
    if (t - _fT >= (active() ? FLUSH_MS : 30000)) { _fT = t; flush(false); }
    if ((active() || _open) && t - _pT >= POLL_MS) { _pT = t; pollBoard(); }
    clockAlerts();
  }, 1000);
  // leaving the tab must not strand kills
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(true); });
  window.addEventListener('pagehide', () => { try { flush(true); } catch (e) {} });

  // the UI tells us when a board is on screen so polling does not run forever
  let _open = false;
  function setOpen(v) { _open = !!v; if (v) pollBoard(); }

  function boot() {
    // after the cloud save has landed, same reasoning as rank-rewards.js
    setTimeout(() => { claimPrize().catch(() => {}); }, 9500);
    setTimeout(() => { try { if (signedIn()) pollBoard(); } catch (e) {} }, 4000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.KOTH = {
    GATE_LV, KOTH_ZONE, PRIZE_LC, TIERS, SIZE_CAP, BAND, HP_SOFT, HP_POW,
    tierFor, hpMultFor, lvlFor, dmgMultFor, dayIdx, dayEnds, msLeft, scaleEnemy,
    ks, kills, rank, unlocked, lvl, fmt, active, signedIn, scoring, presence, HP_CAP, IDLE_MS,
    enter, leave, onKill, engineTick, engineRender,
    flush, pollBoard, pollHall, setOpen, claimPrize, banner,
    board: () => _board, boardAt: () => _boardAt, entrants: () => _entrants,
    hall: () => _hall, hallAt: () => _hallAt,
    nextRankAt: () => _next, lastError: () => _lastErr,
  };
})();
