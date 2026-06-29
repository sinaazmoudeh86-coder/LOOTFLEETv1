/* =============================================================================
   fx-cinematic.js — LootFleet AAA CINEMATIC POST-FX + CAMERA JUICE
   -----------------------------------------------------------------------------
   A 100% NON-INVASIVE visual layer. It does NOT touch gameplay, mechanics,
   balancing, controls or state. It reads the live battle canvas (#game-canvas)
   and the game runtime (window.GAME.rt) and composites a premium post stack
   ON TOP:

     · BLOOM      — bright-pass glow bleed off lasers / explosions / cores
     · GRADE      — per-biome color grade (cool azure → ember → violet → void)
     · VIGNETTE   — soft cinematic edge darkening that breathes
     · ABERRATION — subtle chromatic split that SPIKES on impacts
     · GRAIN      — faint film grain so flat darks read as "film", not "flat"
     · FLASH      — additive screen flash on boss / citadel death
     · CAMERA     — directional kick fed into the engine's own rt.shake
                    (purely visual — draw() already offsets by rt.shake)

   The only writes back to the game are to rt.shake (already a visual-only
   camera offset in draw()) — never to positions, HP, timers or RNG. The main
   #game-canvas is never transformed, so input hit-testing is unaffected.

   Boot:  auto-attaches to #game-canvas in game.html. Also exposes
          window.FXCINE.attach({canvas, getRT}) for the lab harness.
   Toggle: window.FXCINE.setEnabled(bool) · settings persist in localStorage.
   ============================================================================= */
(function () {
  'use strict';

  // Game boots from a stable, versioned key so lab/dev experimentation can
  // never leak volatile values into a player's session. The lab overrides this
  // via window.__FXCINE_STOREKEY to run in its own isolated sandbox.
  var LS_KEY = (typeof window !== 'undefined' && window.__FXCINE_STOREKEY) || 'lf_fx_cine_v2';
  var reduceMotion = false;
  try { reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  // -- tunables (persisted) --------------------------------------------------
  var DEFAULTS = {
    enabled: true,
    bloom: 0.62,        // glow intensity
    bloomRadius: 7,     // blur px at quarter-res
    grade: 0.45,        // color-grade strength (game already has a mild base grade)
    vignette: 0.40,     // edge darkening (stacks with game's existing soft vignette)
    aberration: 0.5,    // chromatic split (base + impact spike)
    grain: 0.5,         // film grain
    shake: 1.0,         // camera-kick multiplier
    flash: 0.85,        // event flash strength
  };
  var S = loadSettings();
  function loadSettings() {
    var o = {}; for (var k in DEFAULTS) o[k] = DEFAULTS[k];
    try { var j = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); for (var k2 in j) if (k2 in o) o[k2] = j[k2]; } catch (e) {}
    return o;
  }
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) {} }

  // -- per-biome color grade (matches render.js GALAXY bands) ----------------
  // tint = additive screen color · mul ≈ multiply shadow tone
  function biome(zone) {
    zone = zone || 0;
    if (zone < 1)  return { tint: '120,150,210', shadow: '6,9,16',   warm: 0.10 };
    if (zone <= 3) return { tint: '70,150,255',  shadow: '6,10,24',  warm: 0.04 };
    if (zone <= 6) return { tint: '52,224,150',  shadow: '4,18,12',  warm: 0.06 };
    if (zone <= 10)return { tint: '255,150,70',  shadow: '20,7,4',   warm: 0.22 };
    if (zone <= 16)return { tint: '176,92,255',  shadow: '13,8,28',  warm: 0.08 };
    return { tint: '235,64,200', shadow: '6,3,12', warm: 0.10 };
  }

  // ==========================================================================
  //  FX instance — one per attached canvas
  // ==========================================================================
  function makeFX(opts) {
    var src = opts.canvas;
    var getRT = opts.getRT || function () { return (window.GAME && window.GAME.rt) || null; };
    var getZone = opts.getZone || function () {
      try { return (window.GAME && GAME.state && GAME.state.currentDungeon) | 0; } catch (e) { return 0; }
    };
    // when this returns false (overlay open, login gate up, tab hidden) we skip
    // the per-frame composite to save battery — purely a perf gate.
    var shouldRun = opts.shouldRun || null;

    // overlay layers, stacked over the source canvas in its parent
    var host = src.parentElement || document.body;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    // bloom canvas (additive, blurred bright-pass copy of the scene)
    var bloom = document.createElement('canvas');
    bloom.className = 'fx-bloom-layer';
    // grade / vignette / aberration painted on a second 2d overlay
    var grade = document.createElement('canvas');
    grade.className = 'fx-grade-layer';
    // grain + flash are cheap DOM (no per-frame paint cost for grain)
    var flashEl = document.createElement('div'); flashEl.className = 'fx-flash-layer';
    var grainEl = document.createElement('div'); grainEl.className = 'fx-grain-layer';

    [bloom, grade, grainEl, flashEl].forEach(function (el) {
      el.style.position = 'absolute';
      el.style.pointerEvents = 'none';
      host.appendChild(el);
    });
    // additive glow — prefer plus-lighter, fall back to screen on older browsers
    bloom.style.mixBlendMode = 'plus-lighter';
    if ((getComputedStyle(bloom).mixBlendMode || '') !== 'plus-lighter') bloom.style.mixBlendMode = 'screen';
    grade.style.mixBlendMode = 'normal';

    // small offscreen for the downscaled bright-pass
    var small = document.createElement('canvas');
    var sctx = small.getContext('2d');
    var bctx = bloom.getContext('2d');
    var gctx = grade.getContext('2d');

    var W = 0, H = 0, DSCALE = 0.26;
    function layout() {
      var r = src.getBoundingClientRect();
      var pr = host.getBoundingClientRect();
      var left = r.left - pr.left, top = r.top - pr.top;
      [bloom, grade, grainEl, flashEl].forEach(function (el) {
        el.style.left = left + 'px'; el.style.top = top + 'px';
        el.style.width = r.width + 'px'; el.style.height = r.height + 'px';
      });
      W = Math.max(1, Math.round(r.width));
      H = Math.max(1, Math.round(r.height));
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      [bloom, grade].forEach(function (cv) {
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      });
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      small.width = Math.max(1, Math.round(W * DSCALE));
      small.height = Math.max(1, Math.round(H * DSCALE));
    }
    layout();
    gradeZone = -99999; // force grade repaint after any (re)layout
    var ro = null;
    try { ro = new ResizeObserver(layout); ro.observe(src); ro.observe(host); } catch (e) {}
    window.addEventListener('resize', layout);

    // -- event detection (read-only on rt) -----------------------------------
    var prev = { boss: false, superBoss: false, nova: 0, hp: 1, kills: 0 };
    var impact = 0;        // 0..1 decaying — drives aberration spike
    var flash = 0;         // 0..1 decaying — drives white flash
    var flashCol = '255,244,218';
    var enabled = S.enabled && !!src;

    function pulse(strength, col, kick) {
      flash = Math.min(1, flash + strength);
      if (col) flashCol = col;
      impact = Math.min(1, impact + strength * 0.9);
      var rt = getRT();
      if (rt && kick) rt.shake = Math.min(22, (rt.shake || 0) + kick * S.shake);
    }
    // public: let the game/harness fire named beats
    function event(name) {
      switch (name) {
        case 'bossSpawn':   pulse(0.45, '255,80,90', 9); break;
        case 'superSpawn':  pulse(0.7,  '255,42,74', 14); break;
        case 'bossDown':    pulse(0.85, '255,228,170', 13); break;
        case 'citadelDown': pulse(1.0,  '255,244,218', 20); break;
        case 'levelUp':     pulse(0.5,  '255,226,122', 4); break;
        case 'crit':        impact = Math.min(1, impact + 0.4); break;
        default: break;
      }
    }

    function sniff() {
      var rt = getRT(); if (!rt) return;
      // boss / super-boss spawn transitions
      var bAlive = !!rt.bossAlive, sAlive = !!rt.superBossAlive;
      if (bAlive && !prev.boss) event(sAlive ? 'superSpawn' : 'bossSpawn');
      if (!bAlive && prev.boss) { /* boss died */ }
      prev.boss = bAlive; prev.superBoss = sAlive;
      // supernova spike (citadel death) — novaT jumps up
      var nova = rt.novaT || 0;
      if (nova > prev.nova + 0.05) event('citadelDown');
      prev.nova = nova;
    }

    // -- the per-frame composite ---------------------------------------------
    var last = 0, acc = 0, _paused = false;
    var gradeZone = -99999, gradePaintT = 0;
    // Paint the (cached) colour-grade + vignette for a zone into the grade
    // canvas. Called only on zone change or ~2.5fps — not every frame.
    function paintGrade(z) {
      gctx.clearRect(0, 0, W, H);
      if (S.grade > 0.01) {
        var bi = biome(z);
        gctx.save();
        gctx.globalCompositeOperation = 'soft-light';
        gctx.globalAlpha = S.grade * 0.6;
        var gg = gctx.createLinearGradient(0, 0, 0, H);
        gg.addColorStop(0, 'rgba(' + bi.tint + ',0.9)');
        gg.addColorStop(1, 'rgba(' + bi.shadow + ',0.95)');
        gctx.fillStyle = gg; gctx.fillRect(0, 0, W, H);
        gctx.restore();
        gctx.save();
        gctx.globalCompositeOperation = 'overlay';
        gctx.globalAlpha = S.grade * (0.18 + bi.warm);
        var to = gctx.createRadialGradient(W * 0.5, H * 0.42, H * 0.1, W * 0.5, H * 0.5, Math.max(W, H) * 0.7);
        to.addColorStop(0, 'rgba(255,180,120,0.5)');
        to.addColorStop(1, 'rgba(40,90,160,0.6)');
        gctx.fillStyle = to; gctx.fillRect(0, 0, W, H);
        gctx.restore();
      }
      if (S.vignette > 0.01) {
        gctx.save();
        var vg = gctx.createRadialGradient(W / 2, H * 0.46, Math.min(W, H) * 0.30, W / 2, H / 2, Math.max(W, H) * 0.72);
        vg.addColorStop(0, 'rgba(0,0,0,0)');
        vg.addColorStop(0.7, 'rgba(2,4,9,' + (S.vignette * 0.30).toFixed(3) + ')');
        vg.addColorStop(1, 'rgba(1,2,6,' + (S.vignette * 0.82).toFixed(3) + ')');
        gctx.fillStyle = vg; gctx.fillRect(0, 0, W, H);
        gctx.restore();
      }
    }
    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (!enabled) { clear(); return; }
      // perf gate: don't composite when the battle isn't visible
      if (document.hidden || (shouldRun && !shouldRun())) { if (!_paused) { clear(); _paused = true; } return; }
      _paused = false;
      try {
      var dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
      sniff();
      impact = Math.max(0, impact - dt * 2.6);
      flash = Math.max(0, flash - dt * 2.2);

      // throttle bloom to ~30fps; this is the only per-frame pixel work left.
      acc += dt;
      var doBloom = acc > 0.032; if (doBloom) acc = 0;

      var z = getZone();

      // ---- GRADE + VIGNETTE: cached. These are static between zone changes, so
      // repaint at most ~2.5fps (or when zone/size changes) instead of 3 full-
      // screen gradient fills EVERY frame — that steady cost stacked on combat
      // and helped cause the shooting stutter. ----
      if (z !== gradeZone || now - gradePaintT > 400) { paintGrade(z); gradeZone = z; gradePaintT = now; }

      // ---- BLOOM: downscale scene → cheap bilinear-upscale glow (NO blur
      // filter). The old blur()'s radius ballooned on every hit, so combat
      // re-blurred a full-screen canvas constantly = stutter. A 1/4-res image
      // upscaled with smoothing is already soft; two additive upscales give the
      // glow at a fraction of the cost and a FLAT per-frame budget. ----
      if (S.bloom > 0.01) {
        if (doBloom || small._dirty == null) {
          try {
            sctx.globalCompositeOperation = 'source-over';
            sctx.globalAlpha = 1;
            sctx.clearRect(0, 0, small.width, small.height);
            sctx.drawImage(src, 0, 0, small.width, small.height);
            // bright-pass: multiply the copy by itself so only hot pixels survive
            sctx.globalCompositeOperation = 'multiply';
            sctx.globalAlpha = 0.85;
            sctx.drawImage(small, 0, 0);
            sctx.globalCompositeOperation = 'source-over';
            sctx.globalAlpha = 1;
          } catch (e) {}
          small._dirty = false;
          // composite the glow ONLY when the capture refreshed — the bloom
          // canvas holds its last frame between updates (cheaper still).
          bctx.clearRect(0, 0, W, H);
          bctx.save();
          bctx.imageSmoothingEnabled = true;
          bctx.globalCompositeOperation = 'lighter';
          var amt = Math.min(1, S.bloom * (1 + impact * 0.35));
          bctx.globalAlpha = amt * 0.7;
          bctx.drawImage(small, 0, 0, W, H);                       // soft base
          var spd = 0.04 * W;
          bctx.globalAlpha = amt * 0.4;
          bctx.drawImage(small, -spd, -spd, W + spd * 2, H + spd * 2); // halo
          var ab = S.aberration * (1 + impact * 4) * (W / 900);     // chromatic
          if (ab > 0.4) {
            bctx.globalAlpha = amt * 0.28;
            bctx.drawImage(small, -ab, 0, W, H);
            bctx.drawImage(small, ab, 0, W, H);
          }
          bctx.restore();
        }
      } else { bctx.clearRect(0, 0, W, H); }

      // ---- FLASH (DOM, cheap) ----
      if (flash > 0.001) {
        flashEl.style.opacity = (flash * S.flash).toFixed(3);
        flashEl.style.background = 'radial-gradient(120% 90% at 50% 45%, rgba(' + flashCol + ',0.95), rgba(' + flashCol + ',0.25) 55%, transparent 78%)';
      } else { flashEl.style.opacity = '0'; }

      // ---- GRAIN opacity (texture set in CSS) ----
      grainEl.style.opacity = (S.grain * 0.5).toFixed(3);
      } catch (e) { /* never let a post-FX hiccup interrupt the game */ }
    }
    function clear() {
      bctx && bctx.clearRect(0, 0, W, H);
      gctx && gctx.clearRect(0, 0, W, H);
      flashEl.style.opacity = '0'; grainEl.style.opacity = '0';
    }

    var raf = requestAnimationFrame(frame);

    return {
      event: event,
      setEnabled: function (v) { enabled = !!v; S.enabled = !!v; save(); if (!v) clear(); },
      isEnabled: function () { return enabled; },
      set: function (k, v) { if (k in S) { S[k] = v; save(); } },
      get: function (k) { return k in S ? S[k] : undefined; },
      settings: function () { var o = {}; for (var k in S) o[k] = S[k]; return o; },
      destroy: function () {
        cancelAnimationFrame(raf);
        try { ro && ro.disconnect(); } catch (e) {}
        [bloom, grade, grainEl, flashEl].forEach(function (el) { el.remove(); });
      },
      _layout: layout,
    };
  }

  // ==========================================================================
  //  public API + auto-boot for game.html
  // ==========================================================================
  var instances = [];
  window.FXCINE = {
    attach: function (opts) { var fx = makeFX(opts); instances.push(fx); return fx; },
    event: function (n) { instances.forEach(function (fx) { fx.event(n); }); },
    setEnabled: function (v) { instances.forEach(function (fx) { fx.setEnabled(v); }); },
    isEnabled: function () { return instances.length ? instances[0].isEnabled() : S.enabled; },
    set: function (k, v) { instances.forEach(function (fx) { fx.set(k, v); }); },
    get: function (k) { return instances.length ? instances[0].get(k) : (k in S ? S[k] : undefined); },
    settings: function () { return instances.length ? instances[0].settings() : S; },
    relayout: function () { instances.forEach(function (fx) { fx._layout(); }); },
  };

  // auto-boot: wait for the real battle canvas, attach once.
  function autoboot() {
    if (instances.length) return;
    var cv = document.getElementById('game-canvas');
    if (!cv || !cv.offsetWidth) { setTimeout(autoboot, 350); return; }
    window.FXCINE.attach({
      canvas: cv,
      // only composite while the battle is the visible screen — skip when an
      // overlay screen, the command sheet or the login gate is up.
      shouldRun: function () {
        try {
          if (document.querySelector('.screen.overlay.active')) return false;
          if (document.querySelector('.mega.open')) return false;
          var lg = document.getElementById('login');
          if (lg && !lg.classList.contains('gone') && getComputedStyle(lg).display !== 'none') return false;
          var arena = document.getElementById('arena-wrap');
          if (arena && arena.classList.contains('in-hangar')) return true; // hangar bay still benefits
          return true;
        } catch (e) { return true; }
      },
    });
    // expose a level-up hook that the game/UI can call without coupling
    try {
      if (window.GAME && !window.GAME.__fxHooked) {
        window.GAME.__fxHooked = true;
      }
    } catch (e) {}
  }
  if (!window.__FXCINE_NOBOOT) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(autoboot, 400); });
    else setTimeout(autoboot, 400);
  }
})();
