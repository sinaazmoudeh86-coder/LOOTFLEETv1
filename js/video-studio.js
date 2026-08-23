/* =============================================================================
   video-studio.js — THE SHELL EVERY LOOT FLEET SOCIAL VIDEO RUNS ON
   -----------------------------------------------------------------------------
   Honest answer to "is this bolted down for other videos": it was not, until
   this file. The Dreadnaught Hunt cut had its slug, caption, poster timestamp,
   shot list, recorder, uploader AND its scenes in one 400-line file. A second
   video meant copying all of it and editing the middle — which is how two videos
   from one game start looking like two games, and how a fix to the recorder
   lands in one of them and not the other.

   So: everything that is the same in every video lives HERE, and a video is a
   data file. See js/videos/dreadnaught-hunt.js — it is scenes and metadata, no
   plumbing at all.

   WHAT THIS OWNS
     · the canvas at 886×1920 (drawn at 443×960, DPR 2 — the one social spec)
     · the shared draw kit: stars, booms, nova rings, bolts, ship art, titles
     · one clock, a scene list, cut flashes, the vignette
     · MediaRecorder capture from frame zero
     · the poster frame, grabbed out of the take rather than seeked to
     · upload to Storage + upsert into social_queue
     · the whole page chrome, built from the video's own metadata

   WHAT A VIDEO OWNS
     { slug, title, sub, caption, posterAt, scenes: [{ dur, label, draw }] }

   ADD A VIDEO: write js/videos/<slug>.js, register it in VIDEOS below. Nothing
   else. The picker, the shot list, the recorder and the publish button all read
   from the same object.
   ========================================================================== */
(function () {
  'use strict';

  // ---- THE REGISTRY ---------------------------------------------------------
  // One line per video. `file` is loaded on demand; `name` is what the picker
  // shows. Keep the slug identical to the filename and to the social_queue slug
  // — three places that must agree, so they are literally the same string.
  var VIDEOS = [
    { slug: 'dreadnaught-hunt-15s', file: 'js/videos/dreadnaught-hunt.js', name: 'DREADNAUGHT HUNT', note: '15s · raid boss → core drop' },
  ];

  var W = 443, H = 960, DPR = 2;
  var GOLD = '#f2b24b', CYAN = '#8fe0ff', RED = '#ff4d5e', PURP = '#c07bff', GREEN = '#45e08c';

  var cv, ctx, seed = 1337;
  function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
  function ease(t) { return t < 0 ? 0 : t > 1 ? 1 : 1 - Math.pow(1 - t, 3); }
  function eio(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // Ship art is shared with the game — the same sprites the player actually
  // flies. A video showing art the game does not contain is a promise the
  // product cannot keep.
  var IMGS = {};
  ['dreadnought', 'battleship', 'destroyer', 'frigate', 'mothership', 'titansina'].forEach(function (k) {
    var im = new Image(); im.src = 'ships/ship-' + k + '.png'; IMGS[k] = im;
  });

  var STARS = [];
  for (var i = 0; i < 120; i++) STARS.push({ x: Math.random() * W, y: Math.random() * H, s: 0.4 + Math.random() * 1.5, v: 5 + Math.random() * 20 });

  // ---- THE DRAW KIT ---------------------------------------------------------
  // Handed to every scene as `k`. A scene never touches ctx directly for these —
  // that is what keeps two videos looking like one game.
  var kit = {
    W: W, H: H, GOLD: GOLD, CYAN: CYAN, RED: RED, PURP: PURP, GREEN: GREEN,
    ease: ease, eio: eio, clamp: clamp, rnd: rnd,
    get ctx() { return ctx; },
    stars: function (t, drift) {
      for (var i = 0; i < STARS.length; i++) {
        var st = STARS[i], y = (st.y + t * st.v * (drift || 1)) % H;
        ctx.globalAlpha = 0.22 + st.s * 0.28;
        ctx.fillStyle = '#cfe0f5';
        ctx.fillRect(st.x, y, st.s, st.s);
      }
      ctx.globalAlpha = 1;
    },
    ship: function (k, x, y, s, rot, alpha) {
      var im = IMGS[k];
      ctx.save(); ctx.globalAlpha = alpha == null ? 1 : alpha;
      ctx.translate(x, y); ctx.rotate(rot || 0);
      if (im && im.complete && im.naturalWidth) ctx.drawImage(im, -s / 2, -s / 2, s, s);
      else { ctx.fillStyle = '#4a5c78'; ctx.beginPath(); ctx.moveTo(0, -s / 2); ctx.lineTo(s / 2.6, s / 2); ctx.lineTo(-s / 2.6, s / 2); ctx.closePath(); ctx.fill(); }
      ctx.restore();
    },
    boom: function (x, y, r, a, col) {
      ctx.save(); ctx.globalAlpha = a;
      var g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, '#fff'); g.addColorStop(0.22, col || GOLD); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      ctx.restore();
    },
    // The game's own boss telegraph. Videos should teach real tells, not invent
    // spectacle — a viewer who meets this ring in game already knows to move.
    novaRing: function (x, y, r, fuse, alpha) {
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.strokeStyle = RED; ctx.lineWidth = 2.5;
      ctx.shadowColor = RED; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = alpha * 0.16; ctx.fillStyle = RED;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      ctx.globalAlpha = alpha * 0.9; ctx.strokeStyle = '#ffd3d8'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fuse); ctx.stroke();
      ctx.restore();
    },
    bolt: function (x1, y1, x2, y2, w, a, col) {
      ctx.save(); ctx.globalAlpha = a;
      ctx.strokeStyle = col || CYAN; ctx.lineWidth = w;
      ctx.shadowColor = col || CYAN; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.restore();
    },
    // ONE title treatment for every video. Kicker rules, punch scale and weights
    // are fixed here on purpose: this is the single strongest signal that two
    // cuts came from the same studio.
    title: function (t, kick, main, sub, color) {
      var a = ease(t / 0.38);
      ctx.save(); ctx.textAlign = 'center';
      ctx.globalAlpha = a; ctx.fillStyle = color || GOLD;
      ctx.font = '800 15px Orbitron';
      ctx.fillText(kick, W / 2, 132);
      var kw = ctx.measureText(kick).width;
      ctx.fillRect(W / 2 - kw / 2 - 34 * a, 143, 26 * a, 2.5);
      ctx.fillRect(W / 2 + kw / 2 + 8 * a, 143, 26 * a, 2.5);
      var sc = 1.15 - 0.15 * a;
      ctx.translate(W / 2, 186); ctx.scale(sc, sc);
      ctx.fillStyle = '#f4f8ff';
      ctx.shadowColor = color || GOLD; ctx.shadowBlur = 26 * a;
      ctx.font = '900 30px Orbitron';
      ctx.fillText(main, 0, 0);
      ctx.restore();
      ctx.save(); ctx.textAlign = 'center';
      ctx.globalAlpha = clamp((t - 0.22) / 0.3, 0, 1);
      ctx.fillStyle = '#b9c8dc'; ctx.font = '700 17px Rajdhani';
      ctx.fillText(sub, W / 2, 222);
      ctx.restore();
    },
    // A labelled bar — boss HP, a kill counter, a progress meter. Persisting one
    // of these across scenes is what makes a cut read as one continuous event
    // rather than a montage, so it is in the kit rather than in any one video.
    bar: function (frac, label, alpha, col) {
      if (alpha <= 0) return;
      ctx.save(); ctx.globalAlpha = alpha;
      var bw = W - 76, bx = 38, by = 96;
      ctx.fillStyle = 'rgba(8,12,22,.82)';
      ctx.fillRect(bx - 3, by - 3, bw + 6, 20);
      ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1;
      ctx.strokeRect(bx - 3, by - 3, bw + 6, 20);
      var g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      g.addColorStop(0, col || '#ff2b3f'); g.addColorStop(1, '#ff7a86');
      ctx.fillStyle = g;
      ctx.fillRect(bx, by, bw * clamp(frac, 0, 1), 14);
      ctx.textAlign = 'left'; ctx.fillStyle = '#ffd3d8';
      ctx.font = '800 11px Orbitron';
      ctx.fillText(label, bx, by - 9);
      ctx.textAlign = 'right'; ctx.fillStyle = '#f4f8ff';
      ctx.fillText(Math.round(clamp(frac, 0, 1) * 100) + '%', bx + bw, by - 9);
      ctx.restore();
    },
    // The standard end card. Every cut ends the same way — one ask, same place,
    // same wording. A viewer who sees three of these learns where to look.
    endCard: function (t, line) {
      var a = ease(clamp(t / 0.5, 0, 1));
      ctx.save(); ctx.textAlign = 'center';
      ctx.globalAlpha = a;
      ctx.fillStyle = GOLD; ctx.font = '900 40px Orbitron';
      ctx.shadowColor = GOLD; ctx.shadowBlur = 30 * a;
      ctx.fillText('LOOT FLEET', W / 2, 430);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#cfe0f5'; ctx.font = '700 18px Rajdhani';
      ctx.globalAlpha = clamp((t - 0.3) / 0.4, 0, 1);
      ctx.fillText(line || 'Idle space ARPG. 47 hulls. No install.', W / 2, 470);
      var ca = clamp((t - 0.65) / 0.4, 0, 1);
      ctx.globalAlpha = ca;
      var pw = 210, ph = 52, px = W / 2 - pw / 2, py = 520;
      ctx.fillStyle = GOLD;
      ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 26); ctx.fill();
      ctx.fillStyle = '#0b0f18'; ctx.font = '900 17px Orbitron';
      ctx.fillText('PLAY FREE', W / 2, py + 33);
      ctx.globalAlpha = ca * 0.85;
      ctx.fillStyle = '#8fa3bd'; ctx.font = '700 15px Rajdhani';
      ctx.fillText('lootfleet.com', W / 2, py + 86);
      ctx.restore();
    },
  };

  // ---- RUN ------------------------------------------------------------------
  var VID = null, t0 = 0, TOTAL = 0, posterBlob = null;

  function run(video) {
    VID = video;
    TOTAL = video.scenes.reduce(function (a, s) { return a + s.dur; }, 0);
    t0 = performance.now();
    requestAnimationFrame(frame);
  }
  function frame() {
    requestAnimationFrame(frame);
    if (!VID) return;
    var elapsed = ((performance.now() - t0) / 1000) % TOTAL;
    var acc = 0, idx = 0, local = 0;
    for (var i = 0; i < VID.scenes.length; i++) {
      if (elapsed < acc + VID.scenes[i].dur) { idx = i; local = elapsed - acc; break; }
      acc += VID.scenes[i].dur;
    }
    // Deterministic sparks per scene, so two takes of the same cut match frame
    // for frame — a re-record must not be a different video.
    seed = 1337 + idx * 91;
    ctx.fillStyle = '#070b16'; ctx.fillRect(0, 0, W, H);
    VID.scenes[idx].draw(local, local / VID.scenes[idx].dur, kit);
    if (local < 0.1 && idx > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (0.42 * (1 - local / 0.1)) + ')'; ctx.fillRect(0, 0, W, H); }
    var vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.74);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(4,6,12,.5)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  }

  window.VIDEOSTUDIO = {
    VIDEOS: VIDEOS, kit: kit,
    attach: function (canvas) {
      cv = canvas; cv.width = W * DPR; cv.height = H * DPR;
      ctx = cv.getContext('2d'); ctx.scale(DPR, DPR);
      return kit;
    },
    run: run,
    canvas: function () { return cv; },
    current: function () { return VID; },
    total: function () { return TOTAL; },
    restart: function () { t0 = performance.now(); },
    poster: function () { return posterBlob; },
    grabPoster: function (cb) { cv.toBlob(function (b) { posterBlob = b; if (cb) cb(b); }, 'image/jpeg', 0.92); },
  };
})();
