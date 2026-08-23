/* =============================================================================
   cargo-run.js — SPACE CARGO DEFENSE · the escort run
   ---------------------------------------------------------------------------
   THIS IS THE REAL GAME. There is no separate simulation here: the run deploys
   on the live battle engine in the pilot's own zone, with their flagship, their
   fitted gear, their escorts and drones, their stats, and the zone's real
   hostiles — which drop real loot, pay real gold and real XP. The module owns
   exactly three things the base game doesn't have:

     1. THE CARGO HULL — a fragile freighter crawling from the southern
        deployment edge to the Citadel at the northern edge. It is exposed to
        the engine as a raid target, the same mechanism the Home Citadel fort
        uses, so hostiles aimed at it besiege it with their normal AI.
     2. VOID ANOMALIES — telegraphed fields seeded ahead of the cargo's lane.
     3. THE OBJECTIVE — arrival pays the manifest; the cargo dying, the pilot
        dying, or leaving the zone loses it.

   NO AUTOPLAY, NO SPEED-UP, NO SKIP, and dying costs the FLAGSHIP HULL.
   window.CARGORUN.startRun(cfg, onEnd)
============================================================================= */
(function () {
  'use strict';
  const G = () => window.GAME;
  const $ = (id) => document.getElementById(id);

  // RUN_S: the whole journey — ten minutes, south edge to the Citadel, exactly as
  // scoped. There is no way to shorten it: the speed control and the auto toggle
  // are both taken off the HUD for the duration (see lockControls).
  const RUN_S = 600;
  // ---- WAVE DENSITY, PER SHIPMENT -------------------------------------------
  // Calibrated against the ◉ BEACON, which calls a 50-hostile swarm onto your
  // position. OMEGA CARGO V is tuned to sit at roughly HALF A BEACON permanently:
  // ~25 live hostiles at all times, arriving as a constant stream rather than
  // discrete waves, and CHARGING the convoy instead of holding range. The lower
  // tiers step down from there — Cargo I is a quiet road.
  const DENS = { 1: 0.55, 2: 0.85, 3: 1.2, 4: 1.7, 5: 2.6 };
  const BEACON_SWARM = 50;   // the number this mode is balanced against
  const RUSH_TIER = 4;       // at tier 4+ hostiles rush like a beacon swarm
  const SECTORS = [
    { at: 0.00, t: 'SECTOR 1 — INITIAL CONTACT',   s: 'Light resistance. Get on the cargo\u2019s flank.' },
    { at: 0.18, t: 'SECTOR 2 — ENEMY ESCALATION',  s: 'Raiders are here for the freighter, not for you.' },
    { at: 0.42, t: 'SECTOR 3 — HEAVY RESISTANCE',  s: 'Bombers and elites. Kill the ones closing on the cargo.' },
    { at: 0.66, t: 'SECTOR 4 — VOID ANOMALIES',    s: 'Void casters seed the lane ahead. Break them early.' },
    { at: 0.86, t: 'FINAL ASSAULT',                s: 'The Citadel is in sight. Hold for one more minute.' },
  ];

  // ---- SECTOR BOSSES + COLLAPSE RINGS ---------------------------------------
  // Every sector is presided over by a BOSS that saturates the lane with red
  // collapse rings — the Voidmaw telegraph, borrowed deliberately so the mechanic
  // reads as something the player already knows how to survive. Two differences,
  // both because this is an ESCORT: the rings are shorter-fused and far more
  // numerous, and they burn the FREIGHTER as readily as the pilot, so the lane
  // has to be cleared and not merely dodged.
  //
  // The barrage is the boss's, not the sector's: kill the boss and it stops. That
  // is the whole tension curve — by the Final Assault a living boss is putting 4-5
  // rings down every two seconds on a 1.5s fuse, and ignoring it drowns the road.
  const SBOSS = [
    { gap: 5.0, n: 1, tel: 2.6, secs: 6,  name: 'PICKET LEADER',  sub: 'It is seeding the lane — fly out of the red circles' },
    { gap: 4.2, n: 2, tel: 2.4, secs: 8,  name: 'RAID CAPTAIN',   sub: 'Two rings a volley now. Keep moving' },
    { gap: 3.4, n: 2, tel: 2.1, secs: 11, name: 'SIEGE MASTER',   sub: 'Shorter fuses on top of an already collapsing lane' },
    { gap: 2.6, n: 3, tel: 1.8, secs: 14, name: 'VOID HERALD',    sub: 'Three more at a time, and the fuses are short' },
    { gap: 1.9, n: 4, tel: 1.5, secs: 18, name: 'ASSAULT LEADER', sub: 'The road is saturated. Break the leader to thin it' },
  ];
  const MIN_SPAWN = 900;      // no hostile ever appears closer than this to the cargo
  const LANE_W = 760;         // ...nor further from the lane than this — the fight stays on the road
  // RINGS ARE WHAT KILL THE FREIGHTER, so this is the single most important
  // number in the file. They burn the hull as readily as the pilot, they arrive
  // on a 1.5s fuse by the Final Assault, and unlike hostiles they cannot be
  // shot — only outrun. 26 live rings saturate a 760px lane completely: there is
  // no clean floor left to fly the cargo through, so the damage stops being
  // avoidable and becomes a tax on time.
  //
  // 26 was never actually played. The frame governor held it at 9 on every
  // device slow enough to trip it, which — until the render loop was fixed in
  // 713 — was every device. 12 is the number the mode has really been survived
  // at, promoted from an accident of frame time to a deliberate ceiling.
  const RING_CAP = 12;        // hard ceiling on live rings — SURVIVABILITY first
  // ---- THE FRAME GOVERNOR ---------------------------------------------------
  // A cargo run is the heaviest thing in the game: up to ~42 live hostiles held
  // on the field permanently, 26 collapsing rings, a dozen void anomalies and a
  // freighter to protect, all of it at up to 5x sim speed. Those ceilings were
  // set for fairness — they say nothing about whether the device can draw them —
  // so on a phone the run ran itself into the ground and the whole experience
  // went with it.
  //
  // FRAME RATE IS NOW THE FIRST CONSTRAINT AND THE CONTENT BENDS TO IT. The run
  // measures its own smoothed frame time and holds a load level from 1.0 (full
  // fat) down to 0.35. Slow frames walk it down, recovered frames walk it back
  // up, with a hold between changes so it cannot oscillate. Every ceiling below
  // is multiplied by it, so a struggling device gets a thinner stream, fewer
  // rings and fewer anomalies instead of a slideshow — the run still lasts ten
  // minutes, the boss still arrives, nothing is skipped.
  //
  // The starting level is a guess from the device, so the first ten seconds on a
  // phone are not the worst ten seconds of the run.
  const GOV = { lvl: 1, t: 0, floor: 0.35 };
  function govStart() {
    let g = 1;
    try {
      const cores = navigator.hardwareConcurrency || 4;
      const px = (window.innerWidth || 900) * (window.innerHeight || 700) * Math.min(2, window.devicePixelRatio || 1);
      const touch = (navigator.maxTouchPoints || 0) > 0 && (window.innerWidth || 900) < 900;
      if (touch) g = 0.62;                 // phone / small tablet in portrait
      if (cores <= 4) g = Math.min(g, 0.62);
      if (px > 2.6e6) g = Math.min(g, 0.7); // a lot of pixels to fill per frame
    } catch (e) {}
    GOV.lvl = g; GOV.t = 0;
  }
  // Called once per engine tick with the frame's smoothed dt (seconds).
  function govTick(dt, fdt) {
    GOV.t += dt;
    if (GOV.t < 1.6) return;               // hold: never react to a single frame
    GOV.t = 0;
    const ms = (fdt || 0) * 1000;
    if (ms > 30 && GOV.lvl > GOV.floor) GOV.lvl = Math.max(GOV.floor, GOV.lvl - 0.12);
    else if (ms < 20 && GOV.lvl < 1) GOV.lvl = Math.min(1, GOV.lvl + 0.06);
  }
  const VOID_CAP = 6;         // live void anomalies — a fixed design number, see below
  // GOV GOVERNS PAINT. IT MUST NEVER GOVERN DIFFICULTY.
  //
  // Until 714 this trimmed the HOSTILE, RING and VOID ceilings from measured
  // frame time. That makes the fight itself a function of how fast your device
  // is: a phone that trips the governor plays a third of the content, a desktop
  // plays all of it, and the same run is two different games. It is exactly the
  // rule js/perf-tier.js states out loud for the graphics tiers — every knob is
  // paint only, because the moment performance buys difficulty, the mode lies.
  //
  // It also hid this file's real balance for as long as it has existed. Nobody
  // had actually played the designed numbers, so when the render loop was fixed
  // in 713 the "unchanged" cargo run became unwinnable overnight.
  //
  // The sim ceilings above are fixed design numbers now, identical on every
  // device, so govCap has no call sites left and is gone. GOV itself stays: it
  // still measures frame health and rides in the flight recorder, which is where
  // a performance signal belongs — as an OBSERVATION, never as a lever on the
  // fight. If a cosmetic population ever needs trimming, trim it from GOV.lvl
  // directly and say so at the call site.
  // ---- THE RUN'S OWN FLIGHT RECORDER ----------------------------------------
  // "Cargo Defense is laggy" is not something you can act on, and this module has
  // already had several rounds of speculative optimisation (viewport culling,
  // cached gradients, pre-rendered ring/void sprites, no shadowBlur, a frame
  // governor). Another guess is not worth a release. So the run records itself:
  // one row every two seconds with the frame time, what the governor did about
  // it, and the population of every array that could be the cause.
  //
  // It costs one push per two seconds and nothing per frame. Read it after a run
  // with CARGORUN.trace() in the console — or CARGORUN.worst() for the ten
  // slowest samples, which is the actual question.
  const TRACE_EVERY = 2, TRACE_MAX = 400;
  function traceTick(dt, rt) {
    run.traceT -= dt;
    if (run.traceT > 0) return;
    run.traceT = TRACE_EVERY;
    if (run.trace.length >= TRACE_MAX) run.trace.shift();
    run.trace.push({
      t: Math.round(run.t),
      ms: Math.round((rt._fdt || 0) * 10000) / 10,   // smoothed frame time, ms
      gov: Math.round(GOV.lvl * 100) / 100,
      hostiles: run.refs.length,
      rings: run.rings.length,
      voids: run.voids.length,
      proj: (rt.projectiles || []).length,
      parts: (rt.particles || []).length,
      floats: (rt.floats || []).length,
      ground: (rt.ground || []).length,
      speed: (G().state.gameSpeed || 1),
    });
  }
  const RING_BURN = 1.0;      // seconds the collapse burns after the fuse runs out
  // THE RINGS ARE THE PILOT'S PROBLEM, NOT THE FREIGHTER'S. They never target the
  // cargo and never damage it: the freighter cannot dodge, so a ring that could
  // hit it is not a skill test, it is a tax on a hull already being chewed by
  // raiders. The pilot dodges; the cargo's danger stays the boarders.

  // ---- WHAT ACTUALLY HURTS THE FREIGHTER ------------------------------------
  // Boarders, and only boarders. Tuned Aug 2026 after the shipment proved
  // unkillable-in-reverse: latch damage was 2.4/s PER hostile with no cap, so a
  // 25-hostile Omega V stream put ~30 integrity/s on a 65%-durability hull and
  // killed it in three seconds no matter how fast the pilot deleted things.
  // Damage per boarder is now a third of that and only the closest few count, so
  // the run is a coverage problem — be where the raiders are — rather than a
  // damage race the pilot cannot win.
  const LATCH_DPS = 0.85;     // integrity/sec per boarder, before hull fragility
  const LATCH_MAX = 6;        // boarders that can chew at once
  const GRACE_S = 6;          // launch grace — nothing touches the hull for six seconds
  // LAUNCH SETTLE — REAL milliseconds, not sim seconds. The opening moments of a
  // run are the most expensive frames in the game (texture upload, the first
  // hostiles resolving, the engine's hot paths still being compiled), and the
  // pilot spends them unable to react. GRACE_S covered the FREIGHTER only, so
  // collapse rings and void wells were free to strip half a hull before the
  // player had a playable frame — "especially at the start it's like 2fps and
  // you lose half the health of the ship". For this window the pilot is immune
  // to lane hazards too, and the throughput sampler ignores the spike.
  const SETTLE_MS = 2200;
  const settling = () => !!(run && perf() - run.wall0 < SETTLE_MS);

  let run = null;
  // The flight recorder outlives the run — you read it AFTER the freighter lands.
  let _lastTrace = null;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const perf = () => (window.performance && performance.now ? performance.now() : Date.now());
  const rnd = (a, b) => a + Math.random() * (b - a);
  const toast = (m, c) => { try { window.SOCIAL.toast(m, c || '#8fc4ff'); } catch (e) {} };
  // ART CACHE — MODULE LEVEL, NOT PER RUN.
  // This used to `new Image()` at startRun and hand the browser a cold URL at the
  // exact moment the run began. The download, and then the DECODE of a full-size
  // PNG, both landed on the main thread inside the first seconds of the escort:
  // the first run of a session sat at single-digit fps while the pilot was
  // already being shot at, and every run after it was smooth because the file
  // was in the HTTP cache and decoded. That is precisely the "first run of the
  // day is giga lag, the rest are fine" report, on desktop and iPad alike.
  // Images are cached for the session and decoded BEFORE a run can start.
  const ART = {};
  function artFor(tier) { return ART['cargo-' + tier] || null; }
  const ready = (im) => !!(im && im.complete && im.naturalWidth);
  // Decode to completion. img.decode() moves the decode off the first paint;
  // where it is unsupported, onload alone is still better than nothing.
  function loadImg(key, src) {
    if (ART[key]) return ART[key]._p || Promise.resolve(ART[key]);
    const im = new Image();
    ART[key] = im;
    im._p = new Promise((res) => {
      const done = () => res(im);
      im.onload = () => { if (im.decode) im.decode().then(done, done); else done(); };
      im.onerror = done;                 // a missing file falls back to the vector draw
      im.src = src;
    });
    return im._p;
  }
  // WARM-UP — called when the Cargo screen opens, so the download, the decode and
  // the static texture bake all happen while the player is reading the shipment
  // list instead of while they are flying. Safe to call repeatedly; the second
  // call is free.
  let _warmed = false;
  function warm(tier) {
    const jobs = [];
    if (tier) jobs.push(loadImg('cargo-' + tier, 'ships/cargo-' + tier + '.png'));
    if (!_warmed) {
      _warmed = true;
      for (let t = 1; t <= 5; t++) jobs.push(loadImg('cargo-' + t, 'ships/cargo-' + t + '.png'));
      ringDisc(); voidDisc();            // bake the static discs once per session
    }
    return Promise.all(jobs);
  }
  // GRADIENT CACHE. Canvas gradients are objects: building six of them per frame
  // (plus one per void) allocated and collected garbage for the whole ten
  // minutes. Every gradient here is either fixed in world space or drawn in a
  // translated local space, so each is built once per run and reused.
  function gc(ctx, key, make) {
    if (!run._gc) run._gc = {};
    return run._gc[key] || (run._gc[key] = make());
  }
  // SPRITE CACHE. A translucent disc drawn with ctx.arc()+fill is rasterized
  // from the path EVERY frame — at the citadel approach up to 26 collapse
  // rings (~190px radius) plus the void discs stack in one viewport, and that
  // per-pixel path fill is exactly what melted the frame rate at the end of a
  // run. Baked once to an offscreen canvas, each disc becomes a scaled
  // drawImage — a texture blit the GPU does for free.
  // These two textures are static — a red disc and a purple radial, identical in
  // every run — so the cache lives at MODULE level and is baked once per session.
  // On `run` it was re-rasterized at the start of every single run, which is
  // per-pixel path fill work landing in the same first seconds as the art decode.
  const _sp = {};
  function spr(key, paint) {
    let s = _sp[key];
    if (!s) { s = document.createElement('canvas'); s.width = s.height = 256; paint(s.getContext('2d')); _sp[key] = s; }
    return s;
  }
  const ringDisc = () => spr('ring', (c) => { c.fillStyle = '#ff2a3a'; c.beginPath(); c.arc(128, 128, 127, 0, 7); c.fill(); });
  const voidDisc = () => spr('void', (c) => {
    const q = c.createRadialGradient(128, 128, 5, 128, 128, 127);
    q.addColorStop(0, 'rgba(18,0,38,.92)'); q.addColorStop(0.7, 'rgba(143,91,255,.42)'); q.addColorStop(1, 'rgba(143,91,255,0)');
    c.fillStyle = q; c.beginPath(); c.arc(128, 128, 127, 0, 7); c.fill();
  });

  // ===========================================================================
  // START
  // ===========================================================================
  const CARGO_SIZE = { 1: 46, 2: 56, 3: 68, 4: 80, 5: 96 };
  function startRun(cfg, onEnd) {
    const g = G(); if (!g || run) return false;
    const dep = g.startCargoRun({ tier: cfg.tier });
    if (!dep) return false;
    const rt = g.rt;
    const stars = g.ascStars ? (g.ascStars() | 0) : 0;
    const resist = Math.min(0.25, stars * 0.0015);
    // LEVEL-SCALED DIFFICULTY. The hostiles are already the pilot's own zone, so
    // their raw numbers scale for free. What scales HERE is the pressure: a
    // higher-level commander faces a denser, faster, more layered escort than a
    // fresh ★20 pilot flying the same shipment. Pay scales on the same curve
    // (cargo-defense.js lvlMul) so the two never drift apart.
    const L = Math.max(1, g.state.level | 0);
    const diff = 1 + (L - 1) * 0.0035;              // Lv 100 → 1.35 · Lv 500 → 2.75
    const dens = DENS[cfg.tier] || 1;
    // Sustained live-hostile ceiling, expressed as a share of a beacon swarm.
    //
    // POPULATION IS A DESIGN NUMBER, NOT A LEVEL REWARD. The header of this file
    // states the calibration out loud — Omega V sits at "roughly HALF A BEACON
    // permanently: ~25 live hostiles at all times" — and then the level term
    // multiplied it to 42, so the deepest accounts played a mode 70% past its own
    // stated tuning. That is the reported "impossible for our best players".
    //
    // `diff` still scales what it should: enemy HP, spawn cadence, the hunter
    // mix. It no longer decides how many things can exist at once. A deep pilot
    // gets a HARDER version of the designed fight, not a different fight.
    const cap = Math.max(6, Math.round(BEACON_SWARM * 0.5 * (dens / DENS[5]) * Math.min(1.15, diff)));

    run = {
      cfg, onEnd, zone: dep.zone, diff, L, dens, cap,
      t: 0, prog: 0, sector: -1, wave: 0, over: false,
      integrity: 100, frag: cfg.frag * (1 - resist), resist,
      // the route: south edge → the Citadel at the north edge
      x0: rt.worldW / 2, y0: rt.worldH - 150, y1: 130,
      cargo: { x: rt.worldW / 2, y: rt.worldH - 150, size: CARGO_SIZE[cfg.tier] || 56, dead: false, hitT: 0 },
      voids: [], refs: [], rings: [], sboss: null, ringT: 4, bossRingT: 0, spawnT: 3, uiT: 0, refsT: 0, bossUp: false, warned: {},
      trace: [], traceT: 0,
      wall0: perf(),
      prevSpeed: (g.state.gameSpeed || 1),
      prevAuto: (g.getAuto ? g.getAuto() : null),
      art: null,
    };
    // REAL ART — already downloaded and decoded by warm() when the Cargo screen
    // opened. If the player got here faster than the network, the vector draw
    // covers the gap and the sprite appears the moment it lands.
    run.art = artFor(cfg.tier);
    govStart();
    warm(cfg.tier).then(() => { if (run) run.art = artFor(cfg.tier); });
    // AUTO OFF — the escort is flown by hand. SPEED IS ALLOWED: update() is handed
    // sim time already multiplied by gameSpeed, so the freighter, the waves and the
    // mission clock all advance on the same clock — running 5× makes the fight
    // arrive five times faster too. Nothing is skipped, only compressed.
    lockControls();
    ensureWarbar();
    banner('CARGO LAUNCHED — ' + cfg.name, 'Zone ' + dep.zone + ' resistance · ' + (Math.round((DENS[cfg.tier] || 1) / 2.6 * 50) ) + ' hostiles held on the field · ten minutes to the Citadel.');
    const nav = document.querySelector('.nav-btn[data-screen="battle"]'); if (nav) nav.click();
    return true;
  }

  // ===========================================================================
  // ENGINE TICK — runs inside the real update() while rt.cgrun is live
  // ===========================================================================
  function engineTick(dt, rt) {
    if (!run) { rt.cgrun = null; return; }
    // WATCHDOG: docking, warping or being towed out of the zone abandons the run.
    if (run.zone !== (G().state.currentDungeon | 0)) return settle(false, 'left');

    govTick(dt, rt._fdt);
    traceTick(dt, rt);
    run.t += dt;
    run.prog = clamp(run.t / RUN_S, 0, 1);

    // ---- the cargo crawls its lane -----------------------------------------
    const c = run.cargo;
    c.y = run.y0 + (run.y1 - run.y0) * run.prog;
    c.x = run.x0 + Math.sin(run.t * 0.25) * Math.min(48, rt.worldW * 0.035);
    c.hitT = Math.max(0, c.hitT - dt);

    // ---- sector announcements ----------------------------------------------
    for (let i = SECTORS.length - 1; i >= 0; i--) {
      if (run.prog >= SECTORS[i].at && run.sector < i) {
        run.sector = i;
        banner(SECTORS[i].t, SECTORS[i].s);
        spawnSectorBoss(i, rt);
        break;
      }
    }

    // Sweep the dead out of the reference list once a second. Three separate
    // per-frame loops walk it, so carrying corpses is pure waste.
    run.refsT -= dt;
    if (run.refsT <= 0) { run.refsT = 1; run.refs = run.refs.filter((q) => !(q.dead || q.dying || q.hp <= 0)); }

    spawn(dt, rt);
    aggro(dt, rt);
    latched(dt, rt);
    voidTick(dt, rt);
    bossTick(dt, rt);
    ringTick(dt, rt);

    run.uiT -= dt;
    if (run.uiT <= 0) { run.uiT = 0.12; syncWarbar(rt); }

    if (run.integrity <= 0) { run.integrity = 0; return settle(false, 'cargo'); }
    if (run.prog >= 1) return settle(true);
  }

  // ---- integrity ----------------------------------------------------------
  function hurt(n, rt) {
    if (run.t < GRACE_S) return;                 // launch grace — see GRACE_S
    const before = run.integrity;
    run.integrity = Math.max(0, run.integrity - n * run.frag);
    run.cargo.hitT = 0.35;
    if (Math.random() < 0.25) rt.shake = Math.min(6, (rt.shake || 0) + 1.4);
    const cross = (v, txt, sub) => { if (before > v && run.integrity <= v && !run.warned[v]) { run.warned[v] = 1; banner(txt, sub); } };
    cross(75, 'CARGO UNDER ATTACK', 'Hull breached — 75% integrity');
    cross(50, 'CARGO INTEGRITY CRITICAL', 'Half the hull is gone. Intercept, do not chase.');
    cross(25, 'SEVERE DAMAGE', 'She will not take much more.');
  }

  // ===========================================================================
  // SPAWNS — real zone hostiles, given a target priority (§8)
  // ---------------------------------------------------------------------------
  // Difficulty comes from BATTLEFIELD COMPLEXITY, not inflated HP (§18): more
  // simultaneous roles, more directions, more things that ignore you and go for
  // the freighter. Enemy strength is the zone's own — the same fight you already
  // know how to win, with something to protect in the middle of it.
  // ===========================================================================
  function spawn(dt, rt) {
    run.spawnT -= dt;
    if (run.spawnT > 0) return;
    const p = run.prog;
    const alive = run.refs.reduce((a, e) => a + ((e.dead || e.dying || e.hp <= 0) ? 0 : 1), 0);
    // GOVERNED CEILING — the tier's number is the maximum, not a promise. See GOV.
    if (alive >= run.cap) { run.spawnT = 0.8; return; }
    run.wave++;
    // Denser shipments spawn faster AND in bigger groups — Omega V arrives as a
    // stream, not a wave. Level pressure shortens the gap further.
    // FLOOR RAISED 1.4 → 2.0. At tier 5 a deep pilot divided straight through to
    // the floor, so the stream never let up long enough to clear the lane ahead
    // of the freighter — and clearing the lane is the whole skill of the mode.
    run.spawnT = Math.max(2.0, (7.6 - p * 4.2) / (run.diff * (0.7 + run.dens * 0.5)));

    const mix = [];
    const add = (role, n) => { for (let i = 0; i < n; i++) mix.push(role); };
    if (p < 0.18) { add('fighter', 2); if (Math.random() < 0.5) add('raider', 1); }
    else if (p < 0.42) { add('fighter', 2); add('raider', Math.random() < 0.5 ? 2 : 1); }
    else if (p < 0.66) { add('fighter', 2); add('raider', 2); add('bomber', 1); if (Math.random() < 0.4) add('elite', 1); }
    else if (p < 0.86) { add('fighter', 1); add('raider', 2); add('bomber', 1); add('void', 1); if (Math.random() < 0.6) add('elite', 1); }
    else {
      add('raider', 3); add('bomber', 1); if (Math.random() < 0.7) add('void', 1); if (Math.random() < 0.6) add('elite', 1);
    }
    // tier pressure: the richer the shipment, the busier the sky
    for (let i = 0, n = Math.round((run.cfg.tier - 1) * 0.6); i < n; i++) mix.push(Math.random() < 0.6 ? 'raider' : 'fighter');
    // LEVEL pressure: extra cargo-hunters on top, so a deep account never coasts
    // HALVED (714). `diff` was already multiplying the population ceiling, the
    // spawn cadence AND every hostile's HP; adding four more cargo-hunters per
    // wave on top made the level term compound four ways off one number. A deep
    // pilot should feel pressure on each axis, not the product of all of them.
    for (let i = 0, n = Math.round((run.diff - 1) * 1.2); i < n; i++) mix.push(Math.random() < 0.7 ? 'raider' : 'bomber');
    // DENSITY: the whole group is multiplied by the shipment's density, then
    // trimmed to whatever room is left under the ceiling. This is what turns
    // Omega V from a wave into a swarm.
    const extra = Math.max(0, Math.round(mix.length * (run.dens - 1)));
    for (let i = 0; i < extra; i++) mix.push(mix[(Math.random() * mix.length) | 0] || 'raider');
    const room = Math.max(1, run.cap - alive);
    if (mix.length > room) mix.length = room;

    let raiders = 0;
    mix.forEach((role) => {
      const e = spawnOne(role, rt);
      if (e && (role === 'raider' || role === 'bomber')) raiders++;
    });
    if (raiders >= 2 && run.t - (run.raidBannerT || -99) > 25 && Math.random() < 0.6) {
      run.raidBannerT = run.t;
      banner('RAIDERS INBOUND', raiders + ' hostiles are running straight at the freighter');
    }
  }

  function spawnOne(role, rt, atX, atY) {
    const g = G(), c = run.cargo;
    // ---- WHERE HOSTILES COME FROM -------------------------------------------
    // They used to enter from the WORLD EDGES — x = -40, x = worldW + 40, or a
    // band 620-900px ahead of the convoy. On a wide arena that put them off the
    // side of the screen entirely: a raider would spawn somewhere the pilot
    // could not see, fly straight at the freighter, and start chewing it before
    // it ever entered view. Near the Citadel it was worse, because the forward
    // band collapsed into the top wall.
    //
    // Everything now arrives in a RING AROUND THE FREIGHTER, inside the lane
    // corridor: far enough out that it is never a surprise (MIN_SPAWN), close
    // enough in that it is on screen and reachable. The fight stays in the
    // middle of the road, where the pilot is, for the whole run.
    let x, y;
    if (atX != null) { x = atX; y = atY; }
    else {
      const d = rnd(MIN_SPAWN, MIN_SPAWN + 300);
      // bearing: mostly ahead and to the flanks, some pursuit from behind
      const ang = -Math.PI / 2 + rnd(-2.1, 2.1) + (Math.random() < 0.22 ? Math.PI : 0);
      x = c.x + Math.cos(ang) * d;
      y = c.y + Math.sin(ang) * d;
      // stay in the corridor — never the far edges of the arena
      x = clamp(x, Math.max(40, run.x0 - LANE_W), Math.min(rt.worldW - 40, run.x0 + LANE_W));
      // and inside the world: anything pushed past a wall reflects to the other
      // side of the convoy rather than piling up against it
      if (y < 40) y = Math.min(rt.worldH - 40, c.y + d);
      else if (y > rt.worldH - 40) y = Math.max(40, c.y - d);
      // re-assert the standoff after the clamps (a corner can pull it in close)
      let dx = x - c.x, dy = y - c.y, dd = Math.hypot(dx, dy);
      if (dd < MIN_SPAWN) {
        if (dd < 1) { dx = 0; dy = 1; dd = 1; }
        x = clamp(c.x + (dx / dd) * MIN_SPAWN, 40, rt.worldW - 40);
        y = clamp(c.y + (dy / dd) * MIN_SPAWN, 40, rt.worldH - 40);
      }
    }

    const opts = { role };
    if (role === 'raider') { opts.raidTarget = c; opts.hpMult = 0.7 * run.diff; }
    else if (role === 'bomber') { opts.raidTarget = c; opts.hpMult = 2.2 * run.diff; }
    else if (role === 'elite') { opts.elite = true; opts.hpMult = 3.2 * run.diff; opts.raidTarget = Math.random() < 0.5 ? c : null; }
    else if (role === 'void') { opts.hpMult = 1.6 * run.diff; opts.raidTarget = run.lane || (run.lane = { x: c.x, y: c.y, size: 30, dead: false }); }
    else if (role === 'boss') { opts.boss = true; opts.hpMult = run.diff; }
    else if (role === 'sboss') { opts.boss = true; }   // sized by DPS in spawnSectorBoss

    const e = g.spawnCargoRaider(x, y, opts);
    // BEACON BEHAVIOUR at the top tiers: they charge instead of holding station.
    if (e && run.cfg.tier >= RUSH_TIER && role !== 'void') e.rush = 1;
    if (e) run.refs.push(e);
    return e;
  }

  // void casters hold a station ahead of the cargo — that's where the lane proxy sits
  function aggro(dt, rt) {
    const c = run.cargo;
    if (run.lane) { run.lane.x = c.x; run.lane.y = Math.max(80, c.y - rt.worldH * 0.3); }
    // void casters seed anomalies on the road while they hold station
    for (const e of run.refs) {
      if (e.dead || e.dying || e.hp <= 0 || e.cgRole !== 'void') continue;
      e.cgT = (e.cgT == null ? rnd(2, 5) : e.cgT) - dt;
      if (e.cgT > 0) continue;
      e.cgT = rnd(6, 9);
      run.voids.length < VOID_CAP && run.voids.push({ x: clamp(c.x + rnd(-260, 260), 60, rt.worldW - 60), y: clamp(c.y - rnd(0, rt.worldH * 0.22), 60, rt.worldH - 60), r: rnd(130, 190), tel: 3, on: 0 });
      // ANNOUNCE THE HAZARD ONCE PER RUN. Every caster seeded a new anomaly every
      // 6–9 sim seconds and re-fired this, so the banner's 3.4s hide timer was
      // reset before it could ever fire — a 520px card parked over the middle of
      // the screen for the whole delivery, and at 5× the spawns land faster still.
      // It is a teaching line: after the first purple well the pilot knows.
      if (!run.voidWarned) {
        run.voidWarned = 1;
        banner('VOID ANOMALY DETECTED', 'It burns the pilot, not the freighter — stay out of the purple');
      }
    }
  }

  // anything sitting on the freighter chews the hull
  function latched(dt, rt) {
    const c = run.cargo;
    let n = 0;
    for (const e of run.refs) {
      if (e.dead || e.dying || e.hp <= 0 || e.cgRole === 'void') continue;
      const rr = c.size + (e.size || 14) + 14, dx = e.x - c.x, dy = e.y - c.y;
      if (dx * dx + dy * dy <= rr * rr) n++;
    }
    if (n) hurt(LATCH_DPS * Math.min(LATCH_MAX, n) * dt, rt);
    run.latched = n;
  }

  function voidTick(dt, rt) {
    const a = rt.archer, c = run.cargo;
    for (let i = run.voids.length - 1; i >= 0; i--) {
      const v = run.voids[i];
      if (v.tel > 0) { v.tel -= dt; if (v.tel <= 0) v.on = 6; continue; }
      v.on -= dt;
      if (v.on <= 0) { run.voids.splice(i, 1); continue; }
      // (the freighter is deliberately immune — boarders are the only threat to it)
      if (a && !a.dead && !settling() && (a.x - v.x) * (a.x - v.x) + (a.y - v.y) * (a.y - v.y) < v.r * v.r) {
        // real damage to the real hull, through the real damage path
        try { a.takeHit((rt.stats.maxHp || 1000) * 0.055 * dt * 60 / 60, null); } catch (e) { a.hp -= (rt.stats.maxHp || 1000) * 0.05 * dt; }
      }
      for (const e of run.refs) {
        if (e.dead || e.dying || e.hp <= 0) continue;
        const er = v.r + (e.size || 14), edx = e.x - v.x, edy = e.y - v.y;
        if (edx * edx + edy * edy < er * er) { try { e.takeDamage(e.maxHp * 0.06 * dt); } catch (q) { e.hp -= e.maxHp * 0.06 * dt; } }
      }
    }
  }

  // ===========================================================================
  // SECTOR BOSS — one per sector, and the source of the collapse rings
  // ===========================================================================
  function spawnSectorBoss(sector, rt) {
    const cfg = SBOSS[sector] || SBOSS[0], c = run.cargo;
    // it holds the road AHEAD of the freighter, so the fight is always between
    // the cargo and where the cargo is going
    const x = clamp(c.x + rnd(-260, 260), Math.max(60, run.x0 - LANE_W), Math.min(rt.worldW - 60, run.x0 + LANE_W));
    // ahead of the convoy where there is road left, behind it once there is not
    let y = c.y - Math.min(rt.worldH * 0.34, MIN_SPAWN + 120);
    if (y < 70) y = Math.min(rt.worldH - 70, c.y + MIN_SPAWN * 0.8);
    const e = spawnOne('sboss', rt, x, y);
    if (!e) return;
    // ANCHOR THE BOSS TO THE PILOT'S OWN DPS. Zone-native health means an
    // over-geared commander one-shots everything — fine for trash, and the whole
    // point of flying a good ship — but it deleted the sector boss before its
    // first volley landed, and the boss IS the encounter. Sized in SECONDS OF
    // YOUR OWN DPS instead, it is a real fight at any gear level.
    try {
      const dps = Math.max(1, (rt.stats && rt.stats.theoryDps) || 1);
      const want = dps * cfg.secs * (0.85 + run.dens * 0.25);
      if (isFinite(want) && want > 0) { e.maxHp = Math.max(e.maxHp || 1, want); e.hp = e.maxHp; }
    } catch (q) {}
    e.cgBoss = sector;
    e.name = cfg.name + ' \u00b7 SECTOR ' + (sector + 1);
    run.sboss = e;
    run.bossRingT = cfg.gap * 0.6;   // its first volley lands shortly after it arrives
    banner('\u2620 ' + cfg.name + ' INBOUND', cfg.sub);
  }
  const bossAlive = (e) => !!(e && !e.dead && !e.dying && e.hp > 0);

  // ---- THE BARRAGE IS THE LANE, NOT THE BOSS --------------------------------
  // Collapse rings used to be a boss ability: kill the leader and the sky went
  // quiet for the rest of the sector. That made the hazard an interruption
  // rather than the texture of the run, and on an over-geared pilot the boss
  // died in seconds so most of the escort had no rings in it at all.
  //
  // They are now a property of the CORRIDOR, running the whole ten minutes and
  // tightening on two axes at once:
  //   • SHIPMENT TIER — a bigger manifest is a bigger target (RING_TIER)
  //   • TIME TO DELIVERY — pressure ramps continuously with run.prog, so the
  //     last stretch before the Citadel is the worst of it (RING_RAMP)
  // A living sector boss still adds its own volley on top, so killing it is
  // worth doing — it just no longer switches the mechanic off.
  const RING_TIER = [1, 1.18, 1.4, 1.68, 2.0];    // per shipment tier, Cargo I → Omega V
  const RING_RAMP = 2.4;                           // pressure at the Citadel vs at launch
  // GLOBAL DIALS, so the barrage can be tuned without touching the curve shape.
  // Aug 2026 playtest: it read as relentless — a fifth fewer rings per volley
  // and a third longer between volleys, which together take roughly 40% of the
  // sustained pressure off while keeping the tier-and-progress ramp intact.
  const RING_COUNT_MUL = 0.8;     // 20% fewer rings per volley
  const RING_GAP_MUL   = 1.35;    // and a longer pause between them
  const RING_DPS       = 0.16;    // fraction of max hull per second inside a collapse (was 0.20)

  // Interval, count and fuse, all as one function of tier and progress.
  function ringPlan() {
    const tier = Math.max(1, Math.min(5, run.cfg.tier | 0));
    // 0 at launch → 1 at the Citadel, eased so the middle of the run already bites
    const p = Math.max(0, Math.min(1, run.prog));
    const ramp = 1 + (RING_RAMP - 1) * (p * p * 0.65 + p * 0.35);
    const press = RING_TIER[tier - 1] * ramp;
    return {
      gap: Math.max(0.9, (4.6 / press) * RING_GAP_MUL),                 // seconds between volleys
      n: Math.max(1, Math.round((0.9 + press * 0.75) * RING_COUNT_MUL)), // rings per volley
      tel: Math.max(1.15, 2.9 - press * 0.42),        // fuse length
      r: 118 + tier * 7 + p * 34,                     // radius grows down the lane
    };
  }

  // One volley of rings, laid on the PILOT. Never on the freighter, and one that
  // happens to overlap it does nothing to it (see ringTick).
  function layRings(n, tel, r, rt) {
    const ar = rt.archer; if (!ar || ar.dead) return;
    n = Math.min(n, RING_CAP - run.rings.length);
    for (let i = 0; i < n; i++) {
      const off = i === 0 ? rnd(0, 70) : rnd(95, 250);
      const ang = Math.random() * Math.PI * 2;
      run.rings.push({
        x: clamp(ar.x + Math.cos(ang) * off, 40, rt.worldW - 40),
        y: clamp(ar.y + Math.sin(ang) * off, 40, rt.worldH - 40),
        r: r, t: tel, total: tel, phase: 0, burn: 0,
      });
    }
    if (!run.warned.rings) { run.warned.rings = 1; banner('\u26a0 COLLAPSE RINGS', 'Fly OUT of the red circles \u2014 they burn the pilot, not the freighter'); }
  }

  function bossTick(dt, rt) {
    // the sector boss is now just a threat that happens to be in the lane
    const bs = run.sboss;
    if (bs && !bossAlive(bs)) { run.sboss = null; banner('SECTOR CLEARED', 'The leader is down \u2014 the corridor is still collapsing'); }

    const plan = ringPlan();
    run.ringT -= dt;
    if (run.ringT <= 0) {
      run.ringT = plan.gap;
      if (run.rings.length < RING_CAP) layRings(plan.n, plan.tel, plan.r, rt);
    }
    // A LIVING LEADER STILL COSTS YOU. Its volley rides on top of the lane's own,
    // on the sector's tighter fuse — so clearing it visibly thins the sky.
    if (bossAlive(bs)) {
      const cfg = SBOSS[run.sector] || SBOSS[0];
      run.bossRingT = (run.bossRingT || 0) - dt;
      if (run.bossRingT <= 0) {
        run.bossRingT = cfg.gap * RING_GAP_MUL;
        if (run.rings.length < RING_CAP) layRings(Math.max(1, Math.round(cfg.n * RING_COUNT_MUL)), cfg.tel, plan.r, rt);
      }
    }
  }

  // fuse → collapse. The burn hurts the PILOT only.
  function ringTick(dt, rt) {
    const a = rt.archer;
    for (let i = run.rings.length - 1; i >= 0; i--) {
      const z = run.rings[i];
      if (z.burn > 0) {
        z.burn -= dt; z.phase += dt * 4;
        if (z.burn <= 0) { run.rings.splice(i, 1); continue; }
        const rr = z.r * z.r;
        if (a && !a.dead && (a.invuln || 0) <= 0 && !settling()) {
          const dx = a.x - z.x, dy = a.y - z.y;
          if (dx * dx + dy * dy <= rr) {
            a.hp -= (rt.stats.maxHp || 1000) * RING_DPS * dt; a.hurtFlash = 1;
            if (a.hp <= 0) { a.hp = 0; a.dead = true; a.justDied = true; a.killer = run.sboss || null; }
          }
        }
        continue;   // the freighter is deliberately immune — see the RINGS note
      }
      const frac = Math.max(0, z.t / z.total);
      z.phase += dt * (3 + (1 - frac) * 14);       // blink accelerates toward collapse
      z.t -= dt;
      if (z.t <= 0) { z.burn = RING_BURN; rt.shake = Math.min(6, (rt.shake || 0) + 1.2); }
    }
  }


  // ---------------------------------------------------------------------------
  // The escort is a real object on a real road: a departure gate at point A, the
  // Citadel at point B, and a LIT NAVIGATION CORRIDOR between them with sector
  // waypoints. The travelled length burns bright behind the freighter; the road
  // ahead is dim. Because the cargo is always ON that corridor, the lit path is
  // also how you find it when you have chased something off-screen.
  // ===========================================================================
  function engineRender(ctx, t, rt) {
    if (!run) return;
    // CAMERA TRANSFORM — the engine calls this hook AFTER it has restored to screen
    // space (the same slot the Home Citadel fort uses), so a module drawing in
    // world coordinates MUST re-apply zoom + camera itself. Without these two
    // lines the freighter, its road and the Citadel were all being painted at raw
    // world pixels in screen space, i.e. off the canvas entirely — which is why
    // the escort read as a HUD concept instead of an object in the arena.
    ctx.save();
    ctx.scale(rt.zoom || 1, rt.zoom || 1);
    ctx.translate(-rt.cam.x, -rt.cam.y);
    // VISIBLE WORLD RECT, computed once. The road spans the whole world and the
    // Citadel is a fixed 620px landmark — without this every one of them was
    // submitted every frame from anywhere on the map, and the canvas threw the
    // work away after building the paths and measuring the text.
    const _z = rt.zoom || 1;
    run._vis = { x0: rt.cam.x, y0: rt.cam.y, x1: rt.cam.x + rt.w / _z, y1: rt.cam.y + rt.h / _z };
    drawRoute(ctx, t, rt);
    drawGate(ctx, t);
    drawCitadel(ctx, t, rt);
    drawVoids(ctx, t);
    drawRings(ctx, t);
    drawCargo(ctx, t);
    ctx.restore();
    // second pass, SCREEN space: if the convoy is off the edge of the view, point
    // at it. You can never lose the thing you are being paid to protect.
    drawLocator(ctx, t, rt);
  }

  function drawLocator(ctx, t, rt) {
    const z = rt.zoom || 1, c = run.cargo;
    const sx = (c.x - rt.cam.x) * z, sy = (c.y - rt.cam.y) * z;
    const pad = 54;
    if (sx > pad && sx < rt.w - pad && sy > pad && sy < rt.h - pad) return;
    const cx = rt.w / 2, cy = rt.h / 2;
    const a = Math.atan2(sy - cy, sx - cx);
    const ex = Math.max(pad, Math.min(rt.w - pad, cx + Math.cos(a) * (rt.w / 2 - pad)));
    const ey = Math.max(pad, Math.min(rt.h - pad, cy + Math.sin(a) * (rt.h / 2 - pad)));
    const dist = Math.round(Math.hypot(c.x - (rt.cam.x + rt.w / z / 2), c.y - (rt.cam.y + rt.h / z / 2)));
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(a);
    const puls = 0.7 + 0.3 * Math.sin(t * 6);
    ctx.fillStyle = 'rgba(255,214,106,' + puls.toFixed(2) + ')';
    ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(-12, -13); ctx.lineTo(-6, 0); ctx.lineTo(-12, 13); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.font = '700 14px Rajdhani, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,224,168,.95)';
    ctx.fillText('CARGO \u00b7 ' + dist + 'm', ex, ey + 30);
    ctx.restore();
  }

  // the lit corridor: rails, flowing energy, waypoints, travelled vs remaining
  function drawRoute(ctx, t, rt) {
    const x = run.x0, yA = run.y0, yB = run.y1, W = 150;
    const cy = run.cargo.y;
    const V = run._vis;
    if (x + W < V.x0 || x - W > V.x1) return;             // the whole road is off-screen
    ctx.save();
    // corridor floor
    ctx.fillStyle = gc(ctx, 'road', () => {
      const q = ctx.createLinearGradient(x - W, 0, x + W, 0);
      q.addColorStop(0, 'rgba(60,120,210,0)');
      q.addColorStop(0.5, 'rgba(70,140,230,.13)');
      q.addColorStop(1, 'rgba(60,120,210,0)');
      return q;
    });
    ctx.fillRect(x - W, yB - 40, W * 2, (yA - yB) + 80);
    // VISIBLE SPAN of the corridor. The road runs the full height of the world;
    // the rails and centre lines are clamped to the viewport so a frame never
    // strokes thousands of off-screen pixels.
    const yT = Math.max(yB - 40, V.y0 - 8), yD = Math.min(yA + 40, V.y1 + 8);
    // rails — bright where the convoy has been, dim ahead
    if (yD > yT) [-W, W].forEach((off) => {
      ctx.strokeStyle = 'rgba(120,180,255,.16)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x + off, yT); ctx.lineTo(x + off, yD); ctx.stroke();
      const b0 = Math.max(cy, yT);
      if (yD > b0) {
        ctx.strokeStyle = 'rgba(170,215,255,.5)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(x + off, b0); ctx.lineTo(x + off, yD); ctx.stroke();
      }
    });
    // centre line: travelled = solid gold, ahead = dashed blue
    const g0 = Math.max(cy, yT), g1 = Math.min(yA, yD);
    if (g1 > g0) {
      ctx.strokeStyle = 'rgba(255,214,106,.55)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, g0); ctx.lineTo(x, g1); ctx.stroke();
    }
    const d0 = Math.max(yB, yT), d1 = Math.min(cy, yD);
    if (d1 > d0) {
      // dash phase anchored to the ORIGINAL start (yB) so clamping never makes the dashes jump
      ctx.setLineDash([26, 26]); ctx.lineDashOffset = (-(t * 60) % 52) + (d0 - yB);
      ctx.strokeStyle = 'rgba(150,205,255,.6)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, d0); ctx.lineTo(x, d1); ctx.stroke();
      ctx.setLineDash([]);
    }
    // energy pulses flowing north along the road ahead
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 8; i++) {
      const k = ((t * 0.11 + i / 8) % 1);
      const py = cy - (cy - yB) * k;
      ctx.fillStyle = 'rgba(160,215,255,' + (0.5 * (1 - k)).toFixed(2) + ')';
      ctx.beginPath(); ctx.ellipse(x, py, 8, 20, 0, 0, 7); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    // SECTOR WAYPOINTS — the five gates the convoy passes through
    ctx.font = '700 17px Rajdhani, sans-serif'; ctx.textAlign = 'center';
    SECTORS.forEach((s, i) => {
      if (!i) return;
      const wy = yA + (yB - yA) * s.at;
      if (wy < V.y0 - 40 || wy > V.y1 + 40) return;      // waypoint off-screen
      const past = run.prog >= s.at;
      ctx.strokeStyle = past ? 'rgba(255,214,106,.6)' : 'rgba(120,180,255,.35)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x - W, wy); ctx.lineTo(x - W + 46, wy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + W - 46, wy); ctx.lineTo(x + W, wy); ctx.stroke();
      ctx.fillStyle = past ? 'rgba(255,214,106,.7)' : 'rgba(150,190,240,.55)';
      ctx.fillText('SECTOR ' + (i + 1), x, wy - 9);
    });
    ctx.restore();
  }

  // POINT A — the departure gate the freighter launched from
  function drawGate(ctx, t) {
    const x = run.x0, y = run.y0 + 78, V = run._vis;
    if (y < V.y0 - 120 || y > V.y1 + 120 || x + 150 < V.x0 || x - 150 > V.x1) return;
    ctx.save();
    ctx.globalAlpha = Math.max(0.25, 1 - run.prog * 1.4);
    ctx.strokeStyle = 'rgba(255,214,106,.7)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(x - 150, y + 26); ctx.lineTo(x - 150, y - 26); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 150, y + 26); ctx.lineTo(x + 150, y - 26); ctx.stroke();
    ctx.setLineDash([12, 12]);
    ctx.strokeStyle = 'rgba(255,214,106,.35)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x - 150, y); ctx.lineTo(x + 150, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '700 18px Rajdhani, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,224,168,.75)';
    ctx.fillText('DEPLOYMENT ZONE \u00b7 SOUTH', x, y + 48);
    ctx.restore();
  }

  // POINT B — the destination marker at the north end of the road.
  //
  // THE CITADEL ART IS GONE (build 527). It was a 620px sprite plus a 420px
  // radial halo sitting across the top of the arena: the most expensive thing
  // this module drew, and — because it is painted over the whole approach — it
  // buried the hostiles the pilot was trying to pick out and shoot at exactly
  // the moment the fight matters most. A destination does not need to be a
  // building. It needs to be legible from a distance and cost nothing.
  function drawCitadel(ctx, t, rt) {
    const k = run.prog;
    const y = run.y1 - 90, x = run.x0, V = run._vis, W = 150;
    if (y < V.y0 - 90 || y > V.y1 + 90 || x + W < V.x0 || x - W > V.x1) return;
    ctx.save();
    // an arrival gate that mirrors the departure gate at the south edge, and
    // brightens as the convoy closes on it
    const a = 0.35 + k * 0.55;
    ctx.strokeStyle = 'rgba(150,205,255,' + a.toFixed(2) + ')'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(x - W, y + 26); ctx.lineTo(x - W, y - 26); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + W, y + 26); ctx.lineTo(x + W, y - 26); ctx.stroke();
    ctx.setLineDash([12, 12]);
    ctx.strokeStyle = 'rgba(150,205,255,' + (a * 0.55).toFixed(2) + ')'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x - W, y); ctx.lineTo(x + W, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '700 18px Rajdhani, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(214,236,255,' + (0.5 + k * 0.5).toFixed(2) + ')';
    ctx.fillText('CITADEL \u00b7 NORTH', x, y - 40);
    ctx.restore();
  }

  function drawCargo(ctx, t) {
    const c = run.cargo, hurtN = run.integrity < 50, sev = run.integrity < 25;
    // BEACON COLUMN — a shaft of light standing off the freighter so it can be
    // picked out from across the sector, not only when it is on screen.
    // The beacon column and the hull glow are both drawn in the freighter's LOCAL
    // space now, so their gradients are position-independent and built once for
    // the whole run instead of twice a frame. The column's pulse rides
    // globalAlpha rather than a rebuilt colour stop.
    ctx.save(); ctx.translate(c.x, c.y);
    ctx.globalAlpha = 0.72 + 0.28 * Math.sin(t * 3);
    ctx.fillStyle = gc(ctx, 'beam', () => {
      const q = ctx.createLinearGradient(0, -620, 0, 0);
      q.addColorStop(0, 'rgba(255,214,106,0)');
      q.addColorStop(1, 'rgba(255,214,106,.22)');
      return q;
    });
    ctx.beginPath();
    ctx.moveTo(-10, 0); ctx.lineTo(-54, -620); ctx.lineTo(54, -620); ctx.lineTo(10, 0);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = gc(ctx, 'glow', () => {
      const q = ctx.createRadialGradient(0, 0, 8, 0, 0, 130);
      q.addColorStop(0, 'rgba(255,214,106,.26)'); q.addColorStop(1, 'rgba(255,190,60,0)');
      return q;
    });
    ctx.beginPath(); ctx.arc(0, 0, 130, 0, 7); ctx.fill();
    // THE FREIGHTER — the real sprite, nose north, sized by tier. The vector hull
    // below is the fallback if the art has not loaded (or is missing).
    if (ready(run.art)) {
      const im = run.art, w = c.size * 2.9, h = w * (im.naturalHeight / im.naturalWidth);
      // engine wash under the hull
      const ef = 26 + Math.sin(t * 18) * 9;
      ctx.fillStyle = gc(ctx, 'wash', () => {
        const q = ctx.createLinearGradient(0, h * 0.42, 0, h * 0.42 + 35);
        q.addColorStop(0, 'rgba(120,200,255,.75)'); q.addColorStop(1, 'rgba(90,170,255,0)');
        return q;
      });
      ctx.beginPath(); ctx.moveTo(-w * 0.22, h * 0.42); ctx.lineTo(w * 0.22, h * 0.42); ctx.lineTo(0, h * 0.42 + ef); ctx.closePath(); ctx.fill();
      // HIT FLASH without shadowBlur: a flat red disc behind the hull. The old
      // version blurred the sprite every single frame of the run, hit or not.
      if (c.hitT > 0) {
        ctx.fillStyle = 'rgba(255,106,74,' + (0.42 * Math.min(1, c.hitT / 0.35)).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(0, 0, w * 0.62, 0, 7); ctx.fill();
      }
      ctx.drawImage(im, -w / 2, -h / 2, w, h);
      if (hurtN) {
        ctx.globalAlpha = 0.45 + 0.4 * Math.abs(Math.sin(t * 8));
        ctx.fillStyle = sev ? '#ff5a4a' : '#ffb347';
        for (let i = 0; i < (sev ? 3 : 2); i++) {
          ctx.beginPath(); ctx.arc(rnd(-w * 0.3, w * 0.3), rnd(-h * 0.3, h * 0.35), rnd(6, 16), 0, 7); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    } else {
    // freighter hull — vector fallback
    const s = c.size / 46;
    ctx.scale(s, s);
    ctx.fillStyle = c.hitT > 0 ? '#6b3a2a' : sev ? '#4a2b22' : hurtN ? '#4d3a24' : '#2b3446';
    ctx.strokeStyle = '#f2b24b'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -58); ctx.lineTo(30, -26); ctx.lineTo(30, 44); ctx.lineTo(0, 62); ctx.lineTo(-30, 44); ctx.lineTo(-30, -26); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(242,178,75,.5)';
    ctx.fillRect(-46, -16, 16, 42); ctx.fillRect(30, -16, 16, 42);
    ctx.fillStyle = '#ffd88a'; ctx.fillRect(-9, -40, 18, 13);
    const f = 14 + Math.sin(t * 20) * 5;
    ctx.fillStyle = 'rgba(120,200,255,.8)';
    ctx.beginPath(); ctx.moveTo(-14, 62); ctx.lineTo(14, 62); ctx.lineTo(0, 62 + f); ctx.closePath(); ctx.fill();
    if (hurtN) {
      ctx.globalAlpha = 0.4 + 0.4 * Math.abs(Math.sin(t * 8));
      ctx.fillStyle = sev ? '#ff5a4a' : '#ffb347';
      ctx.beginPath(); ctx.arc(rnd(-22, 22), rnd(-26, 34), rnd(5, 12), 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    }
    // integrity ring + label
    ctx.save(); ctx.translate(c.x, c.y);
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(0, 0, c.size + 26, 0, 7); ctx.stroke();
    ctx.strokeStyle = run.integrity > 50 ? '#7ce0a0' : run.integrity > 25 ? '#ffd24d' : '#ff5a6a';
    ctx.beginPath(); ctx.arc(0, 0, c.size + 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (run.integrity / 100)); ctx.stroke();
    ctx.font = '700 20px Rajdhani, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(232,240,250,.9)';
    ctx.fillText('CARGO ' + Math.round(run.integrity) + '%', 0, -c.size - 38);
    ctx.font = '700 15px Rajdhani, sans-serif';
    ctx.fillStyle = 'rgba(255,224,168,.8)';
    ctx.fillText(run.cfg.name, 0, -c.size - 58);
    ctx.restore();
  }

  function drawRings(ctx, t) {
    const V = run._vis, disc = ringDisc();
    for (const z of run.rings) {
      if (z.x + z.r < V.x0 || z.x - z.r > V.x1 || z.y + z.r < V.y0 || z.y - z.r > V.y1) continue;
      if (z.burn > 0) {
        const fade = Math.min(1, z.burn / RING_BURN);
        ctx.globalAlpha = 0.30 * fade;
        ctx.drawImage(disc, z.x - z.r, z.y - z.r, z.r * 2, z.r * 2);
        ctx.globalAlpha = 1;
        ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(255,150,150,' + (0.85 * fade).toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, 7); ctx.stroke();
        continue;
      }
      const frac = Math.max(0, z.t / z.total);
      const blink = 0.5 + 0.5 * Math.sin(z.phase * Math.PI * 2);
      ctx.globalAlpha = 0.07 + 0.20 * blink * (1.3 - frac * 0.6);
      ctx.drawImage(disc, z.x - z.r, z.y - z.r, z.r * 2, z.r * 2);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2 + 2.5 * blink;
      ctx.strokeStyle = 'rgba(255,90,104,' + (0.45 + 0.55 * blink).toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r * (1 - 0.12 * frac), 0, 7); ctx.stroke();
    }
  }

  function drawVoids(ctx, t) {
    const V = run._vis;
    for (const v of run.voids) {
      if (v.x + v.r < V.x0 || v.x - v.r > V.x1 || v.y + v.r < V.y0 || v.y - v.r > V.y1) continue;
      if (v.tel > 0) {
        const k = 1 - v.tel / 3;
        ctx.strokeStyle = 'rgba(143,91,255,' + (0.4 + 0.5 * Math.abs(Math.sin(t * 9))).toFixed(2) + ')';
        ctx.lineWidth = 4; ctx.setLineDash([14, 12]);
        ctx.beginPath(); ctx.arc(v.x, v.y, v.r * (0.55 + k * 0.45), 0, 7); ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.globalAlpha = 1;
        ctx.drawImage(voidDisc(), v.x - v.r, v.y - v.r, v.r * 2, v.r * 2);
      }
    }
  }

  // ===========================================================================
  // HUD — the arena warbar (same slot the fort defense uses)
  // ===========================================================================
  // AUTO comes off the HUD for the duration — an escort flown by the autopilot is
  // not an escort. SPEED STAYS: the whole simulation (cargo travel, spawn timers,
  // the mission clock) runs on sim time, so a multiplier compresses the run
  // uniformly rather than skipping any part of it.
  function lockControls() {
    const g = G();
    try { if (g.setAuto) g.setAuto(false); } catch (e) {}
    ['auto-btn', 'auto-warn'].forEach((id) => { const el = $(id); if (el) { el.dataset.cgHid = el.style.display || ''; el.style.display = 'none'; } });
  }
  function unlockControls(prevAuto) {
    ['auto-btn', 'auto-warn'].forEach((id) => {
      const el = $(id); if (!el) return;
      el.style.display = el.dataset.cgHid || '';
      delete el.dataset.cgHid;
    });
    try { if (G().setAuto) G().setAuto(true); } catch (e) {}   // escort over — back to the standing default
  }
  const mmss = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  function ensureWarbar() {
    removeWarbar();
    const host = $('top-stack'); if (!host) return;
    const w = document.createElement('div'); w.id = 'cg-warbar';
    w.innerHTML =
      '<div class="cgw-col"><div class="cgw-bar"><i id="cgw-int" style="width:100%"></i></div><span class="cgw-lbl">CARGO INTEGRITY</span></div>' +
      // THE ROUTE: south deployment edge on the left, the Citadel on the right,
      // the freighter travelling between them. The run's real progress read.
      '<div class="cgw-col">' +
        '<div class="cgw-route"><i id="cgw-dist" style="width:0%"></i><b id="cgw-ship" style="left:0%">\u25b2</b><em class="cgw-cit">\u2b21</em></div>' +
        '<span class="cgw-lbl">S \u2192 N \u00b7 <span id="cgw-pct">0%</span> TO CITADEL</span>' +
      '</div>' +
      '<span class="cgw-cd" id="cgw-cd">' + mmss(RUN_S) + '</span>' +
      '<span class="cgw-sp" id="cgw-sp" title="Battle speed \u2014 the cargo, the waves and the clock all run on it">\u00d71</span>' +
      '<span class="cgw-wave" id="cgw-wave">W1</span>' +
      '<button id="cgw-bail" title="Abandon the shipment">\u23cf</button>';
    host.appendChild(w);
    w.querySelector('#cgw-bail').addEventListener('click', confirmAbort);
  }
  function removeWarbar() { const w = $('cg-warbar'); if (w) w.remove(); }
  function syncWarbar(rt) {
    if (!run) return;
    const i = $('cgw-int');
    if (i) {
      const p = Math.max(0, run.integrity);
      i.style.width = p + '%';
      i.className = p > 50 ? '' : p > 25 ? 'warn' : 'crit';
    }
    const pct = run.prog * 100;
    const d = $('cgw-dist'); if (d) d.style.width = pct.toFixed(1) + '%';
    const shp = $('cgw-ship'); if (shp) shp.style.left = Math.min(95, pct) + '%';
    const pc = $('cgw-pct'); if (pc) pc.textContent = Math.round(pct) + '%';
    const cd = $('cgw-cd');
    // THE SHIPMENT'S OWN CLOCK, COUNTING DOWN. run.t is SIM seconds, so this is
    // 10:00 falling to 0:00 exactly as the manual states: at 1× those are real
    // seconds, and a speed multiplier drains it that many times faster — the run
    // is compressed, never shortened. The ×N chip beside it says which.
    //
    // It used to show an ETA in REAL seconds (remaining sim time ÷ measured
    // throughput, damped, rises capped at +0.5s per update). Whenever the measured
    // rate sat under 1× — a loaded first run, exactly when players look at it —
    // the estimate climbed toward a larger number faster than time was passing,
    // so the clock COUNTED UP. An honest estimate that runs backwards is worse
    // than the plain figure.
    let sp = 1; try { sp = Math.max(1, G().state.gameSpeed | 0); } catch (e) {}
    const left = Math.max(0, RUN_S - run.t);
    if (cd) { cd.textContent = mmss(left); cd.classList.toggle('hot', left <= 30); }
    const spc = $('cgw-sp');
    if (spc) { spc.textContent = '\u00d7' + sp; spc.classList.toggle('on', sp > 1); }
    const wv = $('cgw-wave');
    if (wv) { wv.textContent = 'W' + run.wave + (run.latched ? ' \u00b7 \u26a0' + run.latched : ''); wv.classList.toggle('hot', !!run.latched); }
  }
  let _bb, _bbT;
  function banner(title, sub) {
    if (!_bb || !_bb.isConnected) {
      _bb = document.createElement('div'); _bb.id = 'cg-bbanner';
      ($('arena-wrap') || $('app') || document.body).appendChild(_bb);
    }
    _bb.innerHTML = '<div class="cgb-t">' + title + '</div><div class="cgb-s">' + (sub || '') + '</div>';
    _bb.classList.remove('show'); void _bb.offsetWidth; _bb.classList.add('show');
    clearTimeout(_bbT); _bbT = setTimeout(() => _bb && _bb.classList.remove('show'), 3400);
  }

  function confirmAbort() {
    if (!run || run.over) return;
    const go = () => settle(false, 'abort');
    const msg = 'The shipment is lost, the entry price is not refunded, and the run still counts against today\u2019s attempts. Your <b>hull upgrades survive</b> — abandoning is not dying.';
    if (window.SOCIAL && window.SOCIAL.confirmSheet) window.SOCIAL.confirmSheet('Abandon the cargo?', msg, go);
    else if (confirm('Abandon the cargo? The shipment is lost.')) go();
  }

  // ===========================================================================
  // SETTLE
  // ---------------------------------------------------------------------------
  // reason: undefined (won) · 'cargo' · 'abort' · 'left' · 'death'
  // A DEATH also forfeits the flagship — see onDeath.
  // ===========================================================================
  function settle(win, reason, engineHandled) {
    if (!run || run.over) return;
    run.over = true;
    const r = run, cb = r.onEnd;
    const out = {
      win: !!win, integrity: Math.max(0, Math.round(r.integrity)),
      waves: r.wave, secs: Math.round(r.t), prog: r.prog, reason: reason || (win ? 'arrived' : 'lost'),
      aborted: reason === 'abort' || reason === 'left',
      hullLost: r.hullLost || null,
    };
    removeWarbar();
    unlockControls(r.prevAuto);
    _lastTrace = r.trace || null;
    run = null;
    const g = G();
    try { if (r.prevSpeed && r.prevSpeed !== 1) g.setGameSpeed(r.prevSpeed); } catch (e) {}
    try {
      if (!engineHandled) g.endCargoRun();
      else { const grt = g.rt; if (grt) grt.cgrun = null; }
    } catch (e) {}
    if (win) banner('CARGO SECURED', 'She made the Citadel. Opening the manifest…');
    else if (reason === 'cargo') banner('CARGO DESTROYED', 'The shipment is gone.');
    setTimeout(() => {
      const nav = document.querySelector('.nav-btn[data-screen="cargo"]'); if (nav) nav.click();
      if (cb) cb(out);
    }, win ? 900 : 500);
  }

  // real death, real penalties — plus the shipyard work. The engine has already
  // applied its own death handling and is about to tow us home; we strip the
  // flagship's HULL UPGRADES. The ship itself is never taken.
  function onDeath() {
    if (!run || run.over) return;
    let lost = null;
    try { lost = G().stripHullUpgrades(); } catch (e) {}
    run.hullLost = lost;
    if (lost && lost.levels) toast('\u2620 ' + lost.ship + ' hull upgrades destroyed \u2014 ' + lost.levels + ' level' + (lost.levels === 1 ? '' : 's') + ' back to stock', '#e23b4e');
    settle(false, 'death', true);
  }

  function boot() { injectCSS(); }
  function injectCSS() {
    if ($('cg-css')) return;
    const s = document.createElement('style'); s.id = 'cg-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  window.CARGORUN = { startRun, engineTick, engineRender, onDeath, warm, RUN_S, active: () => !!run,
    // Diagnostics for the frame-time review. trace() is the whole run; worst() is
    // the ten slowest frames, which is where the answer lives.
    trace: () => (run ? run.trace.slice() : (_lastTrace || [])),
    worst: (n) => (run ? run.trace : (_lastTrace || [])).slice().sort((a, b) => b.ms - a.ms).slice(0, n || 10),
    sample: () => (run ? { r: run.rings.length, v: run.voids.length, e: run.refs.length } : 0) };

  const CSS = `
  #cg-warbar{ display:flex; align-items:center; gap:8px; margin:4px 6px 0; padding:6px 8px; border-radius:11px;
    background:rgba(8,13,21,.8); border:1px solid #22304a; }
  .cgw-col{ flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
  .cgw-route{ position:relative; height:9px; border-radius:99px; background:#141d2c; border:1px solid #22304a; }
  .cgw-route i{ display:block; height:100%; border-radius:99px; background:linear-gradient(90deg,#2d5f8a,#5bc0ff); transition:width .3s linear; }
  .cgw-route b{ position:absolute; top:-4px; margin-left:-6px; font-size:11px; line-height:1; color:#ffd88a; text-shadow:0 0 7px rgba(255,216,138,.9);
    transform:rotate(90deg); transition:left .3s linear; }
  .cgw-cit{ position:absolute; right:-4px; top:-4px; font-size:12px; line-height:1; color:#9fd8ff; font-style:normal; }
  .cgw-cd{ flex:none; font-family:'Orbitron',sans-serif; font-weight:800; font-size:14px; color:#cfe0f5; font-variant-numeric:tabular-nums; }
  .cgw-cd.hot{ color:#ff8a96; animation:cgCrit .9s ease-in-out infinite; }
  .cgw-sp{ flex:none; font:800 11px/1 'Rajdhani',sans-serif; letter-spacing:.06em; color:#7d8fa5; border:1px solid #22304a; border-radius:7px; padding:4px 6px; }
  .cgw-sp.on{ color:#8fd4ff; border-color:rgba(91,192,255,.55); background:rgba(91,192,255,.12); }
  .cgw-bar{ height:7px; border-radius:99px; background:#16202f; overflow:hidden; }
  .cgw-bar i{ display:block; height:100%; background:linear-gradient(90deg,#7ce0a0,#39d98a); transition:width .2s linear; }
  .cgw-bar i.warn{ background:linear-gradient(90deg,#ffd24d,#f0972a); }
  .cgw-bar i.crit{ background:linear-gradient(90deg,#ff8a96,#e23b4e); animation:cgCrit .9s ease-in-out infinite; }
  @keyframes cgCrit{ 0%,100%{opacity:.6} 50%{opacity:1} }
  .cgw-bar.dist i{ background:linear-gradient(90deg,#5bc0ff,#9fd8ff); }
  .cgw-lbl{ font:800 7.5px/1 'Rajdhani',sans-serif; letter-spacing:.16em; color:#7d8fa5; }
  .cgw-wave{ flex:none; font-family:'Orbitron',sans-serif; font-weight:800; font-size:12px; color:#ffd88a; }
  .cgw-wave.hot{ color:#ff8a96; }
  #cgw-bail{ flex:none; background:rgba(226,59,78,.12); border:1px solid #5a2530; color:#ff9aa6; border-radius:9px;
    padding:6px 9px; font-size:12px; cursor:pointer; }
  #cg-bbanner{ position:absolute; left:50%; top:22%; transform:translate(-50%,-8px); z-index:12; pointer-events:none;
    opacity:0; transition:opacity .25s, transform .25s; text-align:center; width:min(92%,520px);
    background:rgba(6,10,17,.72); border:1px solid rgba(120,180,255,.35); border-radius:13px; padding:10px 14px; }
  #cg-bbanner.show{ opacity:1; transform:translate(-50%,0); }
  .cgb-t{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:15px; letter-spacing:.08em; color:#eaf2ff; }
  .cgb-s{ font-size:11.5px; color:#a9c0da; margin-top:3px; line-height:1.45; }
  @media (prefers-reduced-motion: reduce){ #cg-bbanner{ transition:none; } .cgw-bar i.crit{ animation:none; } }
  `;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  setTimeout(boot, 1000);
})();
