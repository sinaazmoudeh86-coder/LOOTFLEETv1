/* =============================================================================
   perf-tier.js — LOOTFLEET · GRAPHICS QUALITY (Low / Medium / High)
   -----------------------------------------------------------------------------
   One setting, three values, for players whose device cannot hold 60fps on the
   full render.

   THE RULE THIS WHOLE FILE OBEYS: **IT ONLY EVER CHANGES THE PAINT.**
   Not one knob here touches the simulation. The sim keeps real wall-clock time
   by design (see the step() comment block in game-v93) — event clocks, offline
   progress, boss timers and kill rates must read the same on a phone as on a
   desktop, or Low becomes a difficulty setting and every timed event lies. What
   Low buys is frames, and nothing else.

   HOW IT RELATES TO THE AUTO-GOVERNOR. game-v93 already runs an LOD governor
   (0 full · 1 trimmed · 2 survival) off smoothed frame time. That governor only
   ever reacts AFTER the frames have already been bad, which is no help to a
   player whose device is never going to be fast — they spend the first ten
   seconds of every session in the mud before it notices.

   So a tier sets a FLOOR, and the governor keeps running above it:

       effective LOD = max(tier floor, governor's own reading)

   High floors at 0 (today's behaviour exactly — the governor decides).
   Medium floors at 1. Low floors at 2. The governor can still push HIGHER
   under load; it can never come back below the floor the player chose. One
   rule, no fight between the two systems.

   WHERE IT LIVES. localStorage, NOT the save. A device preference must not ride
   a cloud save from someone's old phone onto their desktop and quietly halve the
   render there. Same reasoning as any other per-device setting.

   API — window.PERF
     tier()              'low' | 'med' | 'high'
     setTier(v)          persist + apply immediately
     lodFloor()          0 | 1 | 2   — read by the game loop's governor
     dprCap()            canvas backing-store ceiling
     partScale()         multiplier on particle / debris ceilings
     allow(feature)      'cine' | 'dust' | 'aura' | 'portrait' | 'minimap'
     autoPick()          first-run guess from the device itself
   ========================================================================== */
(function () {
  'use strict';
  var KEY = 'lf_gfx_tier';

  // ---- THE TABLE -----------------------------------------------------------
  // Everything each tier does, in one place, so the settings copy and the engine
  // can never describe different things. `note` is the line the player reads.
  var TIERS = {
    high: {
      id: 'high', label: 'High', order: 3,
      note: 'Everything on. Full trails, bloom, colour grade and ambient drift.',
      lodFloor: 0, dpr: 2, part: 1,
      cine: true, dust: true, aura: true, portrait: true, minimap: true,
    },
    med: {
      id: 'med', label: 'Medium', order: 2,
      note: 'Drops the screen-wide colour grade, the cinematic pass and half the debris. Keeps bloom and ship auras.',
      lodFloor: 1, dpr: 1.25, part: 0.6,
      cine: false, dust: true, aura: true, portrait: true, minimap: true,
    },
    low: {
      id: 'low', label: 'Low', order: 1,
      note: 'Single-stroke tracers, no bloom, no ambient drift, minimal debris and a lower-resolution canvas. The arena still shows every ship, every shot and every hit.',
      lodFloor: 2, dpr: 1, part: 0.3,
      cine: false, dust: false, aura: false, portrait: false, minimap: false,
    },
  };
  var ORDER = ['low', 'med', 'high'];

  // ---- FIRST RUN: GUESS FROM THE DEVICE ------------------------------------
  // A player on a weak phone should not have to find this menu to get a playable
  // frame rate — they should already be on Low the first time the arena paints.
  // Cheap, synchronous signals only; nothing here is a benchmark and nothing
  // here blocks boot. It is a STARTING POINT, not a verdict: the moment the
  // player picks a tier by hand, that choice is what persists.
  function autoPick() {
    var cores = 0, mem = 0, dpr = 1;
    try { cores = navigator.hardwareConcurrency | 0; } catch (e) {}
    try { mem = navigator.deviceMemory || 0; } catch (e) {}
    try { dpr = window.devicePixelRatio || 1; } catch (e) {}
    var mobile = false;
    try { mobile = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent || ''); } catch (e) {}
    // A high-DPR phone with few cores is the hard case: it is filling four times
    // the pixels of a desktop with a fraction of the budget.
    if ((mem && mem <= 2) || (cores && cores <= 4 && mobile && dpr >= 2)) return 'low';
    if (mobile || (cores && cores <= 4) || (mem && mem <= 4)) return 'med';
    return 'high';
  }

  var _tier = null;
  function read() {
    if (_tier) return _tier;
    var v = null;
    try { v = localStorage.getItem(KEY); } catch (e) {}
    if (v && TIERS[v]) { _tier = v; return _tier; }
    _tier = autoPick();
    // Recorded on first read so the tier cannot drift between sessions as the
    // device reports different numbers (background tabs change hardwareConcurrency).
    try { localStorage.setItem(KEY, _tier); } catch (e) {}
    return _tier;
  }
  function def() { return TIERS[read()] || TIERS.high; }

  function apply() {
    var t = def();
    // The cinematic composite is a full-canvas colour grade + vignette rebuilt
    // every frame — the single most expensive fixed cost on the battle screen.
    try { if (window.FXCINE && window.FXCINE.setEnabled) window.FXCINE.setEnabled(!!t.cine); } catch (e) {}
    // Ambient dust / warp streaks: a second full-size canvas over the arena.
    try { if (window.FXAAA && window.FXAAA.setEnabled) window.FXAAA.setEnabled(!!t.dust); } catch (e) {}
    // The canvas backing store. Re-fitting is the game's own job; ask for it.
    try { if (window.GAME && window.GAME.resizeCanvas) window.GAME.resizeCanvas(); } catch (e) {}
    // Body class so pure-CSS decoration (the deep-space vignette, aura glows)
    // can shed without a JS branch in the render path.
    try {
      var b = document.body;
      if (b) { b.classList.toggle('gfx-med', t.id === 'med'); b.classList.toggle('gfx-low', t.id === 'low'); }
    } catch (e) {}
    try { if (window.UI && window.UI.refreshAll) window.UI.refreshAll(); } catch (e) {}
  }

  function setTier(v) {
    if (!TIERS[v]) return false;
    _tier = v;
    try { localStorage.setItem(KEY, v); } catch (e) {}
    apply();
    return true;
  }

  window.PERF = {
    TIERS: TIERS, ORDER: ORDER,
    tier: read,
    def: def,
    setTier: setTier,
    autoPick: autoPick,
    apply: apply,
    lodFloor: function () { return def().lodFloor; },
    dprCap: function () { return def().dpr; },
    partScale: function () { return def().part; },
    allow: function (k) { return !!def()[k]; },
    label: function (v) { return (TIERS[v || read()] || TIERS.high).label; },
  };

  // Apply once the FX modules have had a chance to boot. They attach on their
  // own timers, so a single early call would set a flag on nothing.
  function boot() { apply(); setTimeout(apply, 1200); setTimeout(apply, 3000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
