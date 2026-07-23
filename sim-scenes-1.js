/* =============================================================================
   sim-core.js — Feature showcase engine for Loot Fleet
   ---------------------------------------------------------------------------
   Drives every phone-mock canvas on features.html. Each feature row carries a
   <canvas data-sim="loot"> inside a device; this core finds them, wires a
   per-canvas API, instantiates the matching scene factory from window.LF_SCENES,
   and steps only the scenes currently scrolled into view (IntersectionObserver).
   A watchdog steps the loop manually whenever rAF stalls (background/preview).
   Shared drawing helpers live on window.SimKit so scenes stay small.
   ============================================================================= */
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  function num(n) {
    if (n < 1000) return n | 0;
    const u = ['', 'K', 'M', 'B', 'T', 'q'];
    let i = 0, v = n;
    while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
    return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + u[i];
  }
  const RAR = [
    ['Common', '#9aa7b8', 0], ['Uncommon', '#46d27a', 1], ['Rare', '#4fa6ff', 2],
    ['Epic', '#b87bff', 3], ['Legendary', '#ffa838', 4], ['Mythic', '#ff5168', 5],
  ];
  const ECOL = ['#7fe0ff', '#ff8a5c', '#c89bff', '#74e0a8', '#ff6f9c', '#ffd24d'];

  // ---- shared image cache (uses inline data-URIs when present so art
  //      survives standalone bundling, where JS-loaded paths don't resolve) ----
  const IMGS = {};
  function img(src) {
    if (!IMGS[src]) {
      const i = new Image();
      const inl = window.LF_IMG_INLINE && window.LF_IMG_INLINE[src];
      i.src = inl || src;
      IMGS[src] = i;
    }
    return IMGS[src];
  }

  // ---- tinted enemy-ship sprites (real hulls, recoloured to read as hostile) ----
  // Real game enemies are monsters, but the only art available is ship hulls —
  // so foes are drawn as actual ships in a menacing tint, rotated to face you.
  const ENEMY_HULLS = ['frigate', 'interceptor', 'cruiser', 'heavycruiser', 'destroyer'];
  const ENEMY_BIG = ['battleship', 'dreadnought', 'carrier'];
  const _tint = {};
  function tintedSprite(src, color) {
    const key = src + '|' + color;
    if (_tint[key] !== undefined) return _tint[key];
    const im = img(src);
    if (!im.complete || !im.naturalWidth) return null; // not decoded yet — retry next frame
    const SZ = 96, c = document.createElement('canvas'); c.width = SZ; c.height = SZ;
    const cx = c.getContext('2d');
    cx.drawImage(im, 0, 0, SZ, SZ);
    cx.globalCompositeOperation = 'source-atop';
    cx.globalAlpha = color === '#ffffff' ? 0.9 : 0.5; cx.fillStyle = color; cx.fillRect(0, 0, SZ, SZ);
    // a touch of darkening at the base for depth
    cx.globalCompositeOperation = 'source-over'; cx.globalAlpha = 1;
    _tint[key] = c; return c;
  }
  function enemyShip(ctx, src, color, x, y, size, ang, flash) {
    // hostile glow
    ctx.globalAlpha = 0.32; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, size * 0.78, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    const spr = tintedSprite(src, flash ? '#ffffff' : color);
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    if (spr) ctx.drawImage(spr, -size / 2, -size / 2, size, size);
    else { // fallback while the sprite decodes
      ctx.fillStyle = flash ? '#fff' : color;
      ctx.beginPath(); ctx.moveTo(0, -size * 0.5); ctx.lineTo(size * 0.36, size * 0.4); ctx.lineTo(0, size * 0.16); ctx.lineTo(-size * 0.36, size * 0.4); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function pickEnemyHull(big) { const a = big ? ENEMY_BIG : ENEMY_HULLS; return a[(Math.random() * a.length) | 0]; }

  // ---- background: deep-space radial + drifting starfield ----
  function bg(api, o) {
    o = o || {};
    const ctx = api.ctx, W = api.W, H = api.H, t = api.t;
    const g = ctx.createRadialGradient(W / 2, H * (o.cy || 0.42), 10, W / 2, H * 0.5, Math.max(W, H) * 0.95);
    g.addColorStop(0, o.top || '#1a0f2e'); g.addColorStop(0.55, o.mid || '#10081c'); g.addColorStop(1, o.bot || '#05030a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (o.tint) {
      const ng = ctx.createRadialGradient(W * 0.32, H * 0.3, 6, W * 0.32, H * 0.3, W * 0.7);
      ng.addColorStop(0, o.tint); ng.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = ng; ctx.fillRect(0, 0, W, H);
    }
    ctx.fillStyle = o.star || '#e7d9ff';
    const drift = o.drift == null ? 5 : o.drift;
    for (let i = 0; i < 46; i++) {
      const sx = (i * 53.7) % W, sy = ((i * 97.3 + t * drift * (1 + (i % 3))) % H);
      ctx.globalAlpha = (0.18 + 0.5 * (0.5 + 0.5 * Math.sin(t * 2 + i))) * (o.starA || 1);
      ctx.fillRect(sx, sy, i % 5 ? 1 : 1.6, i % 5 ? 1 : 1.6);
    }
    ctx.globalAlpha = 1;
  }
  function vignette(api, strength) {
    const ctx = api.ctx, W = api.W, H = api.H;
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.84);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,' + (strength || 0.5) + ')');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  }

  // ---- generic particle pool ----
  function particles(max) {
    const arr = [];
    max = max || 300;
    return {
      arr,
      burst(x, y, o) {
        o = o || {}; const n = o.n || 10;
        for (let i = 0; i < n; i++) {
          if (arr.length >= max) break;
          const a = o.a != null ? (o.a + rnd(-(o.spread || TAU) / 2, (o.spread || TAU) / 2)) : Math.random() * TAU;
          const sp = rnd(o.sp0 || 40, o.sp1 || 180);
          arr.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(o.l0 || 0.4, o.l1 || 0.9), max: o.l1 || 0.9, col: o.col || '#fff', r: rnd(o.r0 || 1.2, o.r1 || 3), g: o.g || 0, fade: o.fade });
        }
      },
      ring(x, y, col, r, life) { arr.push({ ring: true, x, y, life: life || 0.4, max: life || 0.4, col: col || '#fff', r: r || 10 }); },
      spark(x, y, vx, vy, col, life) { if (arr.length < max) arr.push({ x, y, vx, vy, life: life || 0.5, max: life || 0.5, col: col || '#fff', r: 1.6, g: 0 }); },
      update(dt) {
        for (const p of arr) {
          p.life -= dt; if (p.ring) continue;
          p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; p.vy += (p.g || 0) * dt;
        }
        for (let i = arr.length - 1; i >= 0; i--) if (arr[i].life <= 0) arr.splice(i, 1);
      },
      draw(ctx) {
        for (const p of arr) {
          if (p.ring) continue;
          ctx.globalAlpha = Math.max(0, p.life / p.max);
          ctx.fillStyle = p.col;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.4 + p.life / p.max * 0.6), 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = 1;
        for (const p of arr) {
          if (!p.ring) continue;
          const k = 1 - p.life / p.max;
          ctx.globalAlpha = Math.max(0, p.life / p.max);
          ctx.strokeStyle = p.col; ctx.lineWidth = 2 * (1 - k) + 0.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r + k * 54, 0, TAU); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      },
    };
  }

  // ---- loot gem (rarity diamond) ----
  function gem(ctx, x, y, tier, t, scale) {
    scale = scale || 1; const r = RAR[tier] || RAR[0], col = r[1], gl = r[2];
    if (gl >= 5) {
      const pr = 1 + 0.35 * Math.sin((t || 0) * 7 + x);
      ctx.save(); ctx.translate(x, y); ctx.rotate((t || 0) * 1.4);
      ctx.strokeStyle = rgba(col, 0.5 * pr); ctx.lineWidth = 1.1;
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 5 * scale, Math.sin(a) * 5 * scale); ctx.lineTo(Math.cos(a) * 11 * pr * scale, Math.sin(a) * 11 * pr * scale); ctx.stroke(); }
      ctx.restore();
    }
    if (gl > 0) { ctx.globalAlpha = 0.3 + gl * 0.08; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, (4 + gl * 1.3) * scale, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
    ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 3 + gl * 2.5;
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
    const s = (2.4 + gl * 0.5) * scale; ctx.fillRect(-s, -s, s * 2, s * 2);
    ctx.restore(); ctx.shadowBlur = 0;
  }

  // ---- ship image with engine glow + thruster ----
  function ship(ctx, image, x, y, size, t, o) {
    o = o || {};
    ctx.save(); ctx.translate(x, y);
    if (o.glow) {
      const c = o.glow, pulse = 0.5 + 0.5 * Math.sin((t || 0) * 3);
      const sg = ctx.createRadialGradient(0, 0, size * 0.28, 0, 0, size * 0.72);
      sg.addColorStop(0, rgba(c, 0)); sg.addColorStop(0.8, rgba(c, 0.07 * pulse)); sg.addColorStop(1, rgba(c, 0.26 * pulse));
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(0, 0, size * 0.72, 0, TAU); ctx.fill();
    }
    if (o.thruster) {
      const eg = ctx.createRadialGradient(0, size * 0.44, 1, 0, size * 0.44, size * 0.44);
      eg.addColorStop(0, 'rgba(120,200,255,0.5)'); eg.addColorStop(1, 'rgba(120,200,255,0)');
      ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(0, size * 0.44, size * 0.44, 0, TAU); ctx.fill();
    }
    if (image && image.complete && image.naturalWidth) ctx.drawImage(image, -size / 2, -size / 2, size, size);
    else { ctx.fillStyle = '#cdd9ff'; ctx.beginPath(); ctx.moveTo(0, -size * 0.32); ctx.lineTo(size * 0.24, size * 0.24); ctx.lineTo(-size * 0.24, size * 0.24); ctx.closePath(); ctx.fill(); }
    ctx.restore();
  }

  function rgba(hex, a) {
    if (hex[0] !== '#') return hex;
    const n = parseInt(hex.slice(1), 16);
    if (hex.length === 7) return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
    return hex;
  }

  // pointed-up ship glyph for tokens / enemies
  function glyph(ctx, x, y, ang, r, col, flash) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = flash ? '#fff' : col;
    ctx.beginPath(); ctx.moveTo(0, -r * 1.3); ctx.lineTo(r * 0.9, r); ctx.lineTo(0, r * 0.4); ctx.lineTo(-r * 0.9, r); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(0, -r * 0.1, r * 0.28, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function text(ctx, str, x, y, o) {
    o = o || {};
    ctx.font = (o.weight || 800) + ' ' + (o.size || 12) + 'px ' + (o.font || 'Rajdhani, sans-serif');
    ctx.textAlign = o.align || 'center'; ctx.textBaseline = o.baseline || 'alphabetic';
    if (o.stroke !== false) { ctx.lineJoin = 'round'; ctx.lineWidth = o.sw || 3; ctx.strokeStyle = o.strokeCol || 'rgba(0,0,0,0.8)'; ctx.strokeText(str, x, y); }
    ctx.fillStyle = o.col || '#fff'; ctx.fillText(str, x, y);
  }

  const kit = { TAU, rnd, clamp, lerp, num, RAR, ECOL, img, bg, vignette, particles, gem, ship, glyph, rgba, text, enemyShip, pickEnemyHull, ENEMY_HULLS, ENEMY_BIG };
  window.SimKit = kit;
  window.LF_SCENES = window.LF_SCENES || {};
  window.LFTweaks = window.LFTweaks || { speed: 1 };

  // ---- engine (re-entrant: can be called again after new canvases mount) ----
  const sims = [];
  const wired = (typeof WeakSet !== 'undefined') ? new WeakSet() : { has: function () { return false; }, add: function () {} };
  let io = null, started = false, dpr = Math.min(2, window.devicePixelRatio || 1);

  function ensure(rec) {
    if (rec.scene) return;
    if (!rec.size()) return;
    const factory = window.LF_SCENES[rec.name];
    if (!factory) return;
    rec.scene = factory(rec.api);
  }

  function setup() {
    const canvases = [].slice.call(document.querySelectorAll('canvas[data-sim]'));
    canvases.forEach(function (cv) {
      if (wired.has(cv)) return;
      wired.add(cv);
      const ctx = cv.getContext('2d');
      const device = cv.closest('[data-device]') || cv.parentElement;
      const api = {
        ctx, W: 0, H: 0, t: 0, kit,
        accent: cv.getAttribute('data-accent') || '#f2b24b',
        setHud: function (key, val) { const e = device && device.querySelector('[data-hud="' + key + '"]'); if (e && e.textContent !== String(val)) e.textContent = val; },
      };
      function size() { const r = cv.getBoundingClientRect(); if (!r.width || !r.height) return false; api.W = r.width; api.H = r.height; cv.width = r.width * dpr; cv.height = r.height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return true; }
      // default visible: on-screen canvases must draw even if IntersectionObserver
      // never fires (embedded preview frames sometimes suppress it). IO only PAUSES
      // canvases it positively reports as off-screen.
      const rec = { cv, ctx, api, size, name: cv.getAttribute('data-sim'), scene: null, visible: true };
      sims.push(rec);
      if (io) io.observe(cv);
    });

    if (!io && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { const rec = sims.find(s => s.cv === e.target); if (rec) rec.visible = e.isIntersecting; });
      }, { rootMargin: '120px', threshold: 0 });
      sims.forEach(s => io.observe(s.cv));
      window.addEventListener('resize', function () { sims.forEach(s => { if (s.scene) s.size(); }); });
    }

    if (started) return;
    started = true;
    let last = performance.now();
    // cheap on-screen test as an IO fallback (covers frames where IO never fires)
    function onScreen(cv) { const r = cv.getBoundingClientRect(); const vh = window.innerHeight || 800, vw = window.innerWidth || 1200; return r.bottom > -160 && r.top < vh + 160 && r.right > -160 && r.left < vw + 160; }
    function step(now) {
      const gdt = Math.min(0.05, (now - last) / 1000); last = now;
      const sp = (window.LFTweaks && window.LFTweaks.speed) || 1;
      for (const rec of sims) {
        if (!rec.visible && !onScreen(rec.cv)) continue;
        ensure(rec);
        if (!rec.scene) continue;
        if (!rec.api.W && !rec.size()) continue;
        const dt = gdt * sp; rec.api.t += dt;
        try { rec.scene.frame(dt, rec.api.t); } catch (err) { /* keep other sims alive */ }
      }
      queue();
    }
    let pending = false;
    function queue() { if (pending) return; pending = true; requestAnimationFrame(function (n) { pending = false; step(n); }); }
    queue();
    // steady timer floor: drives frames even if rAF is throttled/suspended in an embedded frame
    setInterval(function () { if (performance.now() - last > 60) step(performance.now()); }, 66);
    // self-heal: rescan for late-mounted canvases (rows built after load, etc.)
    // so wiring never depends on script order. Idempotent via the `wired` set.
    let rescans = 0;
    const rescan = setInterval(function () {
      setup();
      if (++rescans > 24) clearInterval(rescan); // ~12s of coverage, then stop
    }, 500);
  }

  window.LF_initSims = setup;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})();
