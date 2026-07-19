/* =============================================================================
   fx-primordial.js — PROCEDURAL lightning for PRIMORDIAL items (JS-driven)
   -----------------------------------------------------------------------------
   CSS keyframes get neutralized whenever a device has "Reduce Motion" on, so
   Primordial drops looked static. This drives the effect from JavaScript
   (requestAnimationFrame) instead — real, frame-by-frame procedural lightning
   that ALWAYS animates regardless of the reduce-motion setting or SW cache.

   It finds every Primordial element in the loadout / inventory DOM:
       .flc.flc-prim            (fleet "Loadouts" chips / pills)
       .slot-icon.r-primordial  (equip slot icons)
       .ic-icon.r-primordial    (bag item icons)
   …overlays a transparent canvas sized to the element (bolts allowed to spill
   outside), and redraws jagged bolts radiating from the centre + an electric
   core glow + an expanding discharge ring, crackling each frame.

   Re-scans on a MutationObserver + light interval so it picks up freshly
   rendered chips when you open the Hangar / Loadouts / Bag. Self-cleans canvases
   whose host left the DOM. Pure presentation — touches no game state.
   ============================================================================= */
(function () {
  'use strict';

  var SELECTOR = [
    '.flc.flc-arc',
    '.slot-icon.r-primordial', '.slot-icon.r-relic', '.slot-icon.r-artifact',
    '.ic-icon.r-primordial', '.ic-icon.r-relic', '.ic-icon.r-artifact',
    '.sc-ico.r-primordial', '.sc-ico.r-relic', '.sc-ico.r-artifact',
    '.legend-chip.r-primordial .legend-dot',
    '.legend-chip.r-relic .legend-dot',
    '.legend-chip.r-artifact .legend-dot'
  ].join(', ');
  // per-tier colour identity: primordial = gold/electric, relic = violet,
  // artifact = red. bolts[] cycle per bolt; glowMid/glowOuter feed the core
  // radial; ring is the discharge colour.
  var PALETTES = {
    primordial: { bolts: ['#ffffff', '#ffe9b0', '#ff9ad8', '#9ad2ff'], glowMid: '255,230,168', glowOuter: '255,154,216', ring: '#ffe6a8' },
    relic:      { bolts: ['#ffffff', '#e3b9ff', '#c061ff', '#8a4dff'], glowMid: '200,135,255', glowOuter: '138,77,255',  ring: '#c061ff' },
    artifact:   { bolts: ['#ffffff', '#ffc2b0', '#ff5a4d', '#ff1f2e'], glowMid: '255,120,96',  glowOuter: '255,31,46',   ring: '#ff2d2d' },
  };
  function paletteFor(el) {
    var p = el;
    if (!(el.classList.contains('r-primordial') || el.classList.contains('r-relic') || el.classList.contains('r-artifact'))) {
      p = (el.closest && el.closest('.r-artifact, .r-relic, .r-primordial')) || el;
    }
    if (p.classList && p.classList.contains('r-artifact')) return PALETTES.artifact;
    if (p.classList && p.classList.contains('r-relic')) return PALETTES.relic;
    return PALETTES.primordial;
  }
  var attached = []; // {host, canvas, ctx, seed}
  var running = false;

  function makeCanvas(host) {
    var cv = document.createElement('canvas');
    cv.className = 'prim-bolt-canvas';
    cv.style.position = 'absolute';
    cv.style.pointerEvents = 'none';
    cv.style.zIndex = '0';
    cv.style.left = '0'; cv.style.top = '0';
    cv.style.width = '100%'; cv.style.height = '100%';
    cv.style.overflow = 'visible';
    // host must contain the canvas; make sure it can position + show overflow
    var cs = getComputedStyle(host);
    if (cs.position === 'static') host.style.position = 'relative';
    host.style.overflow = 'visible';
    // keep the chip's own text/icon above the bolts
    [].forEach.call(host.children, function (ch) {
      if (ch !== cv && getComputedStyle(ch).position === 'static') {
        ch.style.position = 'relative'; ch.style.zIndex = '1';
      }
    });
    host.insertBefore(cv, host.firstChild);
    return cv;
  }

  function scan() {
    var els = document.querySelectorAll(SELECTOR);
    // attach to new ones
    [].forEach.call(els, function (el) {
      if (el.__primFx) return;
      el.__primFx = true;
      var cv = makeCanvas(el);
      attached.push({ host: el, canvas: cv, ctx: cv.getContext('2d'), seed: Math.random() * 1000, pal: paletteFor(el) });
    });
    // drop dead ones
    for (var i = attached.length - 1; i >= 0; i--) {
      if (!document.body.contains(attached[i].host)) {
        if (attached[i].canvas && attached[i].canvas.parentNode) attached[i].canvas.remove();
        if (attached[i].host) attached[i].host.__primFx = false;
        attached.splice(i, 1);
      }
    }
    if (attached.length && !running) { running = true; requestAnimationFrame(loop); }
  }

  function sizeCanvas(a) {
    var r = a.host.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    // COMPACT halo (Jul 2026): the old canvas spilled ~±115px over NEIGHBORING
    // pills — bolts + the white core glow sat on other items' 9.5px labels and
    // washed them out (the "can't read some pills" bug). Now the FX hugs the
    // item's own icon: pills get a tiny 8px halo at the icon, icons cap at 20px.
    a._pill = a.host.classList.contains('flc');
    a._r = a._pill ? 8 : Math.max(10, Math.min(Math.min(r.width, r.height), 20));
    var pad = a._r * 2.2;
    var padX = pad, padY = pad;
    var W = r.width + padX * 2, H = r.height + padY * 2;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var pw = Math.round(W * dpr), ph = Math.round(H * dpr);
    if (a.canvas.width !== pw || a.canvas.height !== ph) {
      a.canvas.width = pw; a.canvas.height = ph;
    }
    // position the oversized canvas centered over the host
    a.canvas.style.left = (-padX) + 'px';
    a.canvas.style.top = (-padY) + 'px';
    a.canvas.style.width = W + 'px';
    a.canvas.style.height = H + 'px';
    a.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    a._W = W; a._H = H;
    a._cx = a._pill ? padX + 13 : W / 2;   // pills: halo sits on the icon, not the label
    a._cy = H / 2;
    return true;
  }

  function drawBolt(ctx, x0, y0, x1, y1, segs, jitter, width, color, alpha) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    var dx = x1 - x0, dy = y1 - y0;
    var nx = -dy, ny = dx; // perpendicular
    var nlen = Math.hypot(nx, ny) || 1; nx /= nlen; ny /= nlen;
    for (var s = 1; s < segs; s++) {
      var t = s / segs;
      var off = (Math.random() - 0.5) * jitter * (1 - Math.abs(t - 0.5) * 1.2);
      ctx.lineTo(x0 + dx * t + nx * off, y0 + dy * t + ny * off);
    }
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
  }

  var last = 0;
  function loop(now) {
    if (!attached.length) { running = false; return; }
    requestAnimationFrame(loop);
    // ~30fps redraw is plenty for crackle + cheaper on mobile
    if (now - last < 33) return;
    last = now;
    var T = now / 1000;
    for (var i = 0; i < attached.length; i++) {
      var a = attached[i];
      if (!sizeCanvas(a)) continue;
      var ctx = a.ctx, cx = a._cx, cy = a._cy, base = a._r;
      var pal = a.pal || PALETTES.primordial;
      ctx.clearRect(0, 0, a._W, a._H);

      var pulse = 0.5 + 0.5 * Math.sin(T * 5 + a.seed);

      // --- core energy glow ---
      var glowR = base * (0.55 + 0.25 * pulse);
      var gr = ctx.createRadialGradient(cx, cy, 1, cx, cy, glowR);
      gr.addColorStop(0, 'rgba(255,255,255,' + (0.22 + 0.12 * pulse) + ')');
      gr.addColorStop(0.4, 'rgba(' + pal.glowMid + ',' + (0.12 + 0.08 * pulse) + ')');
      gr.addColorStop(1, 'rgba(' + pal.glowOuter + ',0)');
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(cx, cy, glowR, 0, 7); ctx.fill();
      ctx.restore();

      // --- radiating bolts ---
      var N = a._pill ? 3 : 5;
      var rot = T * 0.8 + a.seed;
      for (var b = 0; b < N; b++) {
        // crackle gate: each bolt flickers in/out on its own phase
        var crk = Math.sin(T * 22 + b * 2.4 + a.seed * 3);
        if (crk < 0.1) continue;
        var ang = (b / N) * Math.PI * 2 + rot;
        var reach = base * (0.7 + 0.45 * Math.abs(Math.sin(T * 7 + b)));
        var ex = cx + Math.cos(ang) * reach;
        var ey = cy + Math.sin(ang) * reach;
        var col = pal.bolts[b % pal.bolts.length];
        var al = 0.5 + 0.5 * crk;
        // glow underlayer (thick, soft) + hot core (thin, bright)
        drawBolt(ctx, cx, cy, ex, ey, 5, base * 0.45, 2.4, col, al * 0.25);
        drawBolt(ctx, cx, cy, ex, ey, 6, base * 0.4, 1.1, '#ffffff', al * 0.7);
        // tip spark (no shadowBlur — hot path)
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = '#fff'; ctx.globalAlpha = al * 0.7;
        ctx.beginPath(); ctx.arc(ex, ey, 1.3, 0, 7); ctx.fill();
        ctx.restore();
      }

      // --- expanding discharge ring (icon hosts only — pills stay clean) ---
      if (a._pill) continue;
      var k = (T * 0.85 + a.seed) % 1;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (1 - k) * 0.3;
      ctx.strokeStyle = pal.ring;
      ctx.lineWidth = (1 - k) * 2 + 0.5;
      ctx.beginPath();
      ctx.arc(cx, cy, base * 0.5 + k * base * 1.1, 0, 7);
      ctx.stroke();
      ctx.restore();
    }
  }

  function boot() {
    scan();
    // re-scan when the DOM changes (loadout / bag re-renders) — debounced
    var pend = null;
    try {
      var mo = new MutationObserver(function () {
        if (pend) return;
        pend = setTimeout(function () { pend = null; scan(); }, 120);
      });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
    // safety net for any renders the observer misses
    setInterval(scan, 1200);
    window.addEventListener('resize', function () { attached.forEach(sizeCanvas); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.FXPRIM = { rescan: scan, count: function () { return attached.length; } };
})();
