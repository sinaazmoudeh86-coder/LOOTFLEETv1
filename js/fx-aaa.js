/* =============================================================================
   fx-aaa.js — "AAA POLISH PASS" ambient + feedback layer
   100% NON-INVASIVE: never touches gameplay, state, controls or balance.
   It only injects pointer-events:none decoration and reads the DOM the game
   already renders (#hp-fill width, #hud-level text, #boss-bar class).

   Adds:
     · cinematic arena framing (corner brackets + drifting nebula sheet)
     · ambient dust-mote particle canvas with auto-throttle (mobile-safe)
     · low-HP red vignette + HP bar panic pulse
     · level-up gold shockwave ring
     · "WARNING — BOSS" sweep when a boss bar activates

   Perf: DPR capped at 1.5, ≤42 particles (auto-reduced if frames run slow),
   loop fully paused when an overlay screen / login / hidden tab is up.
   Honors prefers-reduced-motion (particles disabled entirely).
   ============================================================================= */
(function () {
  'use strict';
  var reduceMotion = false;
  try { reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  function $(id) { return document.getElementById(id); }

  // -- boot: wait until the arena exists ------------------------------------
  function boot() {
    var arena = $('arena-wrap');
    if (!arena || !arena.offsetWidth) { setTimeout(boot, 400); return; }
    if (arena.querySelector('.aaa-frame')) return; // already attached

    // ---- decorative layers ------------------------------------------------
    var nebula = document.createElement('div');
    nebula.className = 'aaa-nebula';
    arena.insertBefore(nebula, arena.firstChild ? arena.firstChild.nextSibling : null);

    var frame = document.createElement('div');
    frame.className = 'aaa-frame';
    frame.innerHTML = '<i></i><i></i><i></i><i></i>';
    arena.appendChild(frame);

    var vig = document.createElement('div');
    vig.className = 'aaa-hp-vignette';
    arena.appendChild(vig);

    var warn = document.createElement('div');
    warn.className = 'aaa-warn';
    warn.innerHTML = '<span>\u26A0 WARNING</span>';
    arena.appendChild(warn);

    // ---- ambient dust canvas ----------------------------------------------
    var dust = null, dctx = null, parts = [], W = 0, H = 0, budget = 42;
    if (!reduceMotion) {
      dust = document.createElement('canvas');
      dust.className = 'aaa-dust';
      arena.appendChild(dust);
      dctx = dust.getContext('2d');
    }
    function layout() {
      if (!dust) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      var r = arena.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width));
      H = Math.max(1, Math.round(r.height));
      dust.width = Math.round(W * dpr);
      dust.height = Math.round(H * dpr);
      dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }
    function seed() {
      var n = Math.min(budget, Math.round((W * H) / 9000));
      parts = [];
      for (var i = 0; i < n; i++) parts.push(mote(true));
    }
    function mote(anywhere) {
      return {
        x: Math.random() * W,
        y: anywhere ? Math.random() * H : H + 4,
        vx: -2 - Math.random() * 5,       // px/s — slow lateral drift
        vy: -3 - Math.random() * 7,       // px/s — slow rise
        s: 0.5 + Math.random() * 1.3,
        a: 0.08 + Math.random() * 0.22,
        tw: Math.random() * 6.28,
        hue: Math.random() < 0.82 ? '190,215,255' : '255,214,150'
      };
    }
    try { new ResizeObserver(layout).observe(arena); } catch (e) { window.addEventListener('resize', layout); }
    layout();

    function overlayUp() {
      try {
        if (document.hidden) return true;
        if (document.querySelector('.screen.overlay.active')) return true;
        var lg = $('login');
        if (lg && !lg.classList.contains('gone') && getComputedStyle(lg).display !== 'none') return true;
        var mg = $('mega');
        if (mg && mg.classList.contains('open')) return true;
      } catch (e) {}
      return false;
    }

    // ---- particle loop with auto-throttle ----------------------------------
    var last = 0, slowFrames = 0;
    function tick(now) {
      requestAnimationFrame(tick);
      if (!dust) return;
      if (overlayUp()) { if (last) { dctx.clearRect(0, 0, W, H); last = 0; } return; }
      if (!last) { last = now; return; }
      var dt = Math.min(0.05, (now - last) / 1000);
      // auto-throttle: if the frame budget is blown repeatedly, shed particles
      if (now - last > 40) { if (++slowFrames > 60 && budget > 14) { budget = Math.max(14, budget - 8); seed(); slowFrames = 0; } }
      else if (slowFrames > 0) slowFrames--;
      last = now;

      dctx.clearRect(0, 0, W, H);
      var t = now / 1000;
      // WARP STREAKS — brief hyperspace burst when the zone changes (travel beat)
      if (warpT > 0) {
        warpT -= dt;
        var wa = Math.max(0, warpT / 0.7), cx = W / 2, cy = H / 2;
        for (var j = 0; j < 26; j++) {
          var ang = (j / 26) * 6.2832 + 0.35;
          var r0 = 30 + ((j * 53) % 90), r1 = r0 + 90 + ((j * 31) % 130) * wa;
          dctx.strokeStyle = 'rgba(170,205,255,' + (0.42 * wa).toFixed(3) + ')';
          dctx.lineWidth = 1 + (j % 3) * 0.5;
          dctx.beginPath();
          dctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
          dctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
          dctx.stroke();
        }
      }
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.y < -6 || p.x < -6) parts[i] = p = mote(false);
        var a = p.a * (0.65 + 0.35 * Math.sin(t * 1.7 + p.tw));
        dctx.fillStyle = 'rgba(' + p.hue + ',' + a.toFixed(3) + ')';
        dctx.beginPath(); dctx.arc(p.x, p.y, p.s, 0, 6.2832); dctx.fill();
      }
    }
    if (dust) requestAnimationFrame(tick);

    // ---- feedback watchers (poll the DOM the game already writes) ----------
    var app = $('app'), hpFill = $('hp-fill'), lvlEl = $('hud-level'),
        bossBar = $('boss-bar'), toastLayer = $('toast-layer'), zbName = $('zb-name');
    var lastLvl = lvlEl ? parseInt(lvlEl.textContent, 10) || 0 : 0;
    var bossWas = false, warnT = 0;
    var lastZone = zbName ? zbName.textContent : '', warpT = 0;

    function shockwave() {
      if (!toastLayer || reduceMotion) return;
      var s = document.createElement('div');
      s.className = 'aaa-shock';
      toastLayer.appendChild(s);
      setTimeout(function () { s.remove(); }, 950);
    }
    setInterval(function () {
      // low-HP state
      if (app && hpFill) {
        var w = parseFloat(hpFill.style.width) || 100;
        app.classList.toggle('aaa-hp-low', w > 0 && w < 30);
      }
      // level-up beat
      if (lvlEl) {
        var lv = parseInt(lvlEl.textContent, 10) || 0;
        if (lv > lastLvl && lastLvl > 0) shockwave();
        lastLvl = lv;
      }
      // travel beat — warp streaks whenever the zone banner changes
      if (zbName) {
        var zn = zbName.textContent;
        if (zn !== lastZone) { if (lastZone && !reduceMotion) warpT = 0.7; lastZone = zn; }
      }
      // boss warning sweep (fires once per activation)
      if (bossBar) {
        var on = bossBar.classList.contains('active');
        if (on && !bossWas && Date.now() - warnT > 8000) {
          warnT = Date.now();
          warn.classList.remove('show'); void warn.offsetWidth; warn.classList.add('show');
          setTimeout(function () { warn.classList.remove('show'); }, 2500);
        }
        bossWas = on;
      }
    }, 300);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 300); });
  else setTimeout(boot, 300);
})();
