/* =============================================================================
   mech-corruption.js — LOOTFLEET · ARMOR CORRUPTION
   -----------------------------------------------------------------------------
   The Mech faction's signature mechanic, in both directions:

     HOSTILE → PLAYER   Every Mech hit strips a slice of your effective armor.
                        A lone Spawn is nothing; a swarm left chewing on you is
                        a real problem. The class sets the CEILING, the swarm
                        sets how fast you reach it.

     FLEET → HOSTILE    A Mech Archon or Mech Titan in your fleet turns the same
                        tech outward: the target takes more damage from EVERY
                        ship you own, not just from the Mech. The Mech line is a
                        fleet damage amplifier, not a DPS hull.

   ---------------------------------------------------------------------------
   WHY THIS IS "+% DAMAGE TAKEN" AND NOT "-% DEFENSE"

   The design this came from asked for a Defense-stat reduction so that heavily
   armored targets benefit most. LootFleet has no such stat to reduce:

     · Hostiles have no mitigation at all — takeDamage() subtracts raw HP.
     · The player's entire mitigation budget is `dmgReduce`, hard-capped at 20%
       (DR_CAP_PCT). Most pilots carry little or none, so a "-50% Defense"
       debuff would do NOTHING to the majority of the player base and land
       hardest on the players who invested in defense. Backwards.

   The intent survives anyway, because TIME-TO-KILL does the job the armor math
   was there to do. Corruption is a per-hit ramp with an expiry, so:

     · Trash dies in 2–3 hits, never accrues stacks, and is not disproportionately
       deleted — exactly the outcome the "-% Defense" framing was protecting.
     · A boss soaks hundreds of hits and sits pinned at the ceiling for the whole
       fight, which is where the amplifier is supposed to pay.

   Toughness here IS hull HP, so the stack ramp self-scales toward big targets
   without a second stat existing.

   ---------------------------------------------------------------------------
   STACKS ARE RATE-LIMITED ON THE WALL CLOCK, NOT PER HIT

   Corruption is applied by ANY fleet hit while a Mech is aboard (the same
   fleet-tech rule FrostyFrost's cryo and the Voidmaw singularity use). A fighter
   wing lands enough hits per second to pin any per-hit ramp at its ceiling
   instantly, which would delete the Titan's whole identity — "reaching maximum
   corruption takes time" has to be true of the Titan specifically.

   So each source grants at most `rate` stacks per SECOND, on its own clock. The
   ramp is then a fixed design number, identical on every device and every build:
   it does not get faster because you fitted a better cannon, and it does not get
   slower because the frame rate dipped. Same principle as the perf tiers — a
   number the player is being judged against must not ride on hardware.

   ---------------------------------------------------------------------------
   NOTHING HERE IS PERSISTED. Every field this module writes lives on a runtime
   entity (a hostile in rt.enemies, or rt.archer) and dies with the run. There is
   no save write, no migration, and no new state key anywhere in this file.

   window.MECHCORR
     onFleetHit(e)            stamp a hostile        (called from resolveHit)
     vulnOf(e)                % extra damage it takes
     onMechHit(archer, src)   stamp the player       (called from takeHit)
     playerPct(archer)        % extra damage you take
     stateOf(e) / playerState(archer)   { pct, cap, n } for UI and the badge
     badge(ctx, target, topY, st)       the debuff readout
     cracks(ctx, e, k)        corrupted-hull overlay
     drawPlayer(ctx, rt)      the player's own badge
     aboard()                 is a Mech hull in the fleet (memoized)
   ========================================================================== */
(function () {
  'use strict';
  const G = () => window.GAME;

  // ---- THE ONE TUNING TABLE -------------------------------------------------
  // Every number the mechanic has, stated once. The UI, the badge and the ship
  // descriptions all read this — nothing restates a figure from it.
  //
  // HOSTILE ceilings hold the source design's 1:2:4:6:10 class ratio and land the
  // Titan swarm on +25% incoming damage. Read against the one-shot clamp that is
  // the real ceiling on burst: a single hit is capped at 22% of max hull, so a
  // maxed Titan swarm moves that to 27.5%. Four hits from full instead of five.
  const HOSTILE = {
    mspawn:   { per: 0.25, max: 2.5 },
    mgremlin: { per: 0.5,  max: 5 },
    mbeast:   { per: 1,    max: 10 },
    marchon:  { per: 1.5,  max: 15 },
    mtitan:   { per: 2.5,  max: 25 },
  };
  const HOSTILE_DUR = 5;     // seconds; any Mech hit refreshes it
  const HOSTILE_RATE = 8;    // max stacks/sec on the player, however big the swarm

  // FLEET ships. All five Mech hulls contribute to ONE shared pool on the target —
  // a Mech fleet reads as a single ARMOR CORRUPTION number, never five competing
  // debuffs. Per-hit values and caps add; each hull keeps its own rate clock, so
  // the Titan still ramps at Titan speed inside the shared pool.
  const FLEET = {
    mechspawn:   { per: 0.25, max: 5,  dur: 4, rate: 10 },
    mechgremlin: { per: 0.5,  max: 9,  dur: 4, rate: 10 },
    mechbeast:   { per: 0.75, max: 14, dur: 5, rate: 9 },
    mecharchon:  { per: 1,    max: 20, dur: 5, rate: 8 },
    mechtitan:   { per: 2,    max: 40, dur: 7, rate: 4 },
    // The capstone. Alone it very nearly reaches FLEET_CAP, which is the point of
    // a capstone — and the cap still holds, so pairing it with a Titan buys a
    // faster, steadier ramp rather than a bigger ceiling.
    mechsovereign: { per: 3,  max: 55, dur: 8, rate: 3 },
  };
  // AND THE POOL IS CEILINGED, which is the whole reason five buyable Mech hulls
  // is a safe thing to ship. A fleet is a flagship plus four escorts, so without
  // this an all-Mech fleet would sum to −88% and the correct play would be to fly
  // nothing else — a faction that MANDATES itself, rather than one you choose.
  //
  // At 60 the two apex hulls (20 + 40) reach the ceiling exactly, so a third Mech
  // buys reliability — reaching the cap sooner and holding it through a lull —
  // never a bigger number. The lower hulls are the ladder you climb on the way to
  // that pair, not a stacking exploit at the top of it.
  const FLEET_CAP = 60;

  const COMPROMISED = 0.75;  // fraction of the cap where the readout turns critical

  // ---- WHAT IS ABOARD -------------------------------------------------------
  // Memoised on the SIM clock for the same reason frostAboard() is: this is
  // called once per landed hit, and a fighter wing multiplies that count by bays
  // × rate × multi-shot fan × sub-steps. rt.time is a field read; performance.now()
  // is a real call and would be the one unavoidable cost on the hottest path.
  let _prof = null, _profT = -1;
  function profile() {
    const g = G(); if (!g) return null;
    const rt = g.rt, st = g.state;
    if (!rt || !st) return null;
    const n = rt.time || 0;
    if (_profT >= 0 && n - _profT <= 0.5 && n >= _profT) return _prof;
    _profT = n;
    const keys = [st.ship];
    try { if (typeof g.fleetShips === 'function') g.fleetShips().forEach((f) => keys.push(f.key)); } catch (e) {}
    let per = 0, cap = 0, dur = 0, seen = null;
    const src = [];
    for (const k of keys) {
      const d = k && FLEET[k]; if (!d) continue;
      if (seen && seen[k]) continue;
      (seen = seen || {})[k] = 1;
      per += d.per; cap += d.max; if (d.dur > dur) dur = d.dur;
      src.push({ key: k, per: d.per, gap: 1 / d.rate });
    }
    _prof = cap > 0 ? { per, cap: Math.min(FLEET_CAP, cap), dur, src } : null;
    return _prof;
  }
  function aboard() { return !!profile(); }

  // ---- FLEET → HOSTILE ------------------------------------------------------
  // Called from resolveHit, at the one point every damage path in the game
  // converges — bolts, fighters, drones, escorts and Prism splash all reach it
  // without a second implementation, exactly as the Aegis vuln stamp does.
  //
  // The stamp is a pair of primitives plus an expiry. Nothing sweeps or clears
  // it: a target that stops being hit simply reads as uncorrupted once its
  // expiry passes, so there is no bookkeeping pass over the enemy list.
  function onFleetHit(e) {
    if (!e || e.dead) return;
    const p = profile(); if (!p) return;
    const rt = G().rt, t = rt.time || 0;
    // expired since the last hit — the ramp restarts rather than resuming
    if ((e._mcExp || 0) <= t) { e._mcPct = 0; e._mcN = 0; e._mcClk = null; }
    const clk = e._mcClk || (e._mcClk = {});
    let add = 0, n = 0;
    for (const s of p.src) {
      const last = clk[s.key];
      if (last != null && t - last < s.gap) continue;   // rate limit, per source
      clk[s.key] = t; add += s.per; n++;
    }
    e._mcExp = t + p.dur;                                // any hit refreshes duration
    if (!add) return;
    e._mcCap = p.cap;
    e._mcPct = Math.min(p.cap, (e._mcPct || 0) + add);
    e._mcN = (e._mcN || 0) + n;
  }
  // Read side — checks the expiry, so a target that broke off stops being
  // debuffed without anything having to clear the flag.
  function vulnOf(e) {
    if (!e || !e._mcPct) return 0;
    return (e._mcExp || 0) > ((G().rt.time) || 0) ? e._mcPct : 0;
  }
  function stateOf(e) {
    const pct = vulnOf(e);
    return pct > 0 ? { pct, cap: e._mcCap || pct, n: e._mcN || 0 } : null;
  }

  // ---- HOSTILE → PLAYER -----------------------------------------------------
  // Stamped from Archer.takeHit, the convergence point for every source of
  // damage to the player — contact hits and enemy bolts both land there.
  //
  // The CLASS sets the ceiling, the SWARM sets how fast you reach it: a wall of
  // Spawns ramps quickly but tops out at +2.5%, a single Titan ramps slowly to
  // +25%. That is the whole dynamic — letting Mechs chew on you is what costs,
  // not any one of them hitting hard.
  function onMechHit(archer, src) {
    if (!archer || !src) return;
    const key = src.mechKey || (src.type && src.type.mech);
    const d = key && HOSTILE[key]; if (!d) return;
    const rt = G().rt, t = rt.time || 0;
    if ((archer._mcExp || 0) <= t) { archer._mcPct = 0; archer._mcN = 0; archer._mcLast = null; archer._mcSeen = null; }
    archer._mcExp = t + HOSTILE_DUR;
    // THE CEILING IS PER CLASS, ON ITS OWN CLOCK — it does not latch.
    //
    // A single shared cap that only ever rose was the first version of this, and it
    // quietly deleted the whole class ladder: any Mech hit of any class refreshes
    // the damage window, so one Titan touch opened the 25% ceiling and the weakest
    // Spawn in the swarm then held it open indefinitely, at ten times its own
    // ceiling, with the Titan already dead. Since the per-stack values only set
    // ramp speed — and ramp speed is rate-limited swarm-wide anyway — the CEILING
    // is the only thing that actually distinguishes the five classes, and a mixed
    // swarm is the normal encounter for a five-tier faction.
    //
    // So each class carries its own last-seen stamp and the cap is re-derived from
    // whoever is still genuinely working on you. Kill the Titan and the ceiling
    // falls back to the Beasts still latched on, taking the current corruption down
    // with it. At most five keys — this loop is cheaper than the property write
    // that follows it.
    const seen = archer._mcSeen || (archer._mcSeen = {});
    seen[key] = t;
    let cap = 0;
    for (const k in seen) {
      if (t - seen[k] > HOSTILE_DUR) { delete seen[k]; continue; }
      const m = HOSTILE[k]; if (m && m.max > cap) cap = m.max;
    }
    archer._mcCap = cap;
    if (archer._mcPct > cap) archer._mcPct = cap;   // the pool falls with the ceiling
    const last = archer._mcLast;
    if (last != null && t - last < 1 / HOSTILE_RATE) return;   // swarm-wide rate limit
    archer._mcLast = t;
    archer._mcPct = Math.min(cap, (archer._mcPct || 0) + d.per);
    archer._mcN = (archer._mcN || 0) + 1;
  }
  function playerPct(archer) {
    const a = archer || (G().rt && G().rt.archer);
    if (!a || !a._mcPct) return 0;
    if ((a._mcExp || 0) <= ((G().rt.time) || 0)) return 0;
    return a._mcPct;
  }
  function playerState(archer) {
    const a = archer || (G().rt && G().rt.archer);
    const pct = playerPct(a);
    return pct > 0 ? { pct, cap: a._mcCap || pct, n: a._mcN || 0 } : null;
  }

  // ===========================================================================
  // THE READOUT
  // ---------------------------------------------------------------------------
  // A debuff the player cannot see is a difficulty change they experience as a
  // bug — the same failure the KOTH presence rule had when it lived in a title
  // tooltip. So the state is PAINTED on the target, never hovered, and it says
  // what it is doing in a number.
  //
  // LOD sheds COST, never the signal. At every tier the corruption bar is drawn
  // (that is the information); the text is what gets dropped, because it is the
  // expensive part — a font set and two fillText calls per corrupted hostile,
  // on a field that can hold forty of them.
  const LOW = '#ff8a3d', HIGH = '#ff3b52';
  // NO FONT CACHE HERE ON PURPOSE. render.js keeps its own `_lastFont` memo of
  // ctx.font, and badge() runs inside a save()/restore() pair — which reverts the
  // font without that memo knowing. A second cache in this file would go stale
  // against the same context and start skipping the set, so the text would render
  // in whatever font the last caller happened to leave behind. Setting it every
  // time costs nothing: this path only runs for a corrupted hostile below LOD 2.
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function lod() {
    try { return (window.RENDER && RENDER.getLOD) ? RENDER.getLOD() : 0; } catch (e) { return 0; }
  }

  // `topY` is the baseline the caller has already cleared of health bars and
  // boss names — this routine never guesses where it is safe to draw.
  function badge(ctx, x, size, topY, st) {
    if (!st) return;
    const k = st.cap > 0 ? Math.min(1, st.pct / st.cap) : 0;
    const crit = k >= COMPROMISED;
    const col = crit ? HIGH : LOW;
    const bw = Math.max(26, size * 2.1), bx = x - bw / 2, bh = 3;
    const L = lod();
    ctx.save();
    // the meter — always drawn, at every LOD. This is the information.
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; rr(ctx, bx - 1.5, topY - 1.5, bw + 3, bh + 3, 2.5); ctx.fill();
    ctx.fillStyle = 'rgba(255,138,61,0.16)'; rr(ctx, bx, topY, bw, bh, 1.5); ctx.fill();
    ctx.fillStyle = col; rr(ctx, bx, topY, bw * k, bh, 1.5); ctx.fill();
    if (L < 2) {
      ctx.textAlign = 'center';
      ctx.font = '800 11px Rajdhani, sans-serif';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      const txt = (crit && L === 0) ? '\u26a0 ARMOR COMPROMISED'
        : L === 0 ? '\u2699 CORRUPTED \u00d7' + st.n + '   \u2212' + (Math.round(st.pct * 10) / 10) + '%'
        : '\u2699 \u00d7' + st.n;
      ctx.strokeText(txt, x, topY - 5);
      ctx.fillStyle = col; ctx.fillText(txt, x, topY - 5);
    }
    ctx.restore();
  }

  // CORRUPTED HULL — short crimson arcs crawling over the plating as the stacks
  // build. Pure decoration, so unlike the badge this IS dropped the moment the
  // governor asks for frames. Seeded off the entity so the arcs sit still
  // instead of strobing to a new position every frame.
  function cracks(ctx, e, k) {
    if (lod() > 0 || k < 0.35) return;
    const n = Math.min(5, 1 + Math.floor(k * 5));
    const s = e.size, seed = e.seed || 1;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.lineCap = 'round';
    ctx.strokeStyle = k >= COMPROMISED ? HIGH : LOW;
    ctx.globalAlpha = 0.45 + k * 0.4;
    ctx.lineWidth = 1.3;
    for (let i = 0; i < n; i++) {
      const a = seed * 7.3 + i * 2.399;
      const r0 = s * 0.28, r1 = s * (0.62 + (i % 3) * 0.12);
      const bend = ((i % 2) ? 1 : -1) * 0.5;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.quadraticCurveTo(Math.cos(a + bend) * r1 * 0.7, Math.sin(a + bend) * r1 * 0.7, Math.cos(a + bend * 0.4) * r1, Math.sin(a + bend * 0.4) * r1);
      ctx.stroke();
    }
    ctx.restore();
  }

  // The player wears the debuff too — the swarm dynamic is unreadable if the
  // only place it shows is the hostiles.
  function drawPlayer(ctx, rt) {
    const a = rt && rt.archer; if (!a) return;
    const st = playerState(a); if (!st) return;
    badge(ctx, a.x, a.size || 18, a.y - (a.size || 18) - 30, st);
  }

  // ---- THE POISONED LOOK ----------------------------------------------------
  // A badge above the hull says a target is corrupted; this makes the target
  // itself LOOK it. Returns the tint a renderer should lay over the hull, or null
  // — the strength tracks how far toward the ceiling the stacks are, and the
  // pulse is a plain sin on the sim clock so every corrupted hull on the field
  // breathes in time rather than each keeping its own phase.
  function tintOf(e) {
    const st = stateOf(e); if (!st) return null;
    const k = st.cap > 0 ? Math.min(1, st.pct / st.cap) : 0;
    if (k < 0.06) return null;                       // a single stack is not a costume
    const t = (G().rt && G().rt.time) || 0;
    const pulse = 0.5 + 0.5 * Math.sin(t * 5.0);
    const crit = k >= COMPROMISED;
    return {
      k, crit,
      col: crit ? '#ff1f3a' : '#c8102e',
      alpha: (0.18 + k * 0.42) * (0.55 + 0.45 * pulse),   // body wash
      halo: (0.10 + k * 0.30) * (0.4 + 0.6 * pulse),      // outer bloom
    };
  }

  window.MECHCORR = {
    HOSTILE, FLEET, FLEET_CAP, HOSTILE_DUR, COMPROMISED,
    onFleetHit, vulnOf, stateOf,
    onMechHit, playerPct, playerState,
    badge, cracks, drawPlayer, aboard, tintOf,
  };
})();
