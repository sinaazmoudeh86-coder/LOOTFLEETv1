/* =============================================================================
   videos/dreadnaught-hunt.js — 15s vertical social cut
   -----------------------------------------------------------------------------
   Scenes and metadata only. Everything else — canvas, clock, recorder, poster
   capture, upload, page chrome — belongs to js/video-studio.js. This is what a
   new video looks like: no plumbing.

   WHY A COLD OPEN. The 24s montage earns a title card because it has seven beats
   to spend. Fifteen seconds on a feed does not get that grace: the first half
   second decides whether anyone watches, so frame zero is already a burning
   capital ship mid-fight and the title does not arrive until 4s, by which point
   the viewer has committed. Nothing is explained before it is shown.

   THE ARC is the one the hunt actually has in game — threat, commitment, payoff,
   reward. A raid boss with telegraphed novas, one fleet that holds through them,
   and a ◇ Dread Core that buys a permanent node on the tree.
   ========================================================================== */
(function () {
  'use strict';
  var BOSS_Y = 340;

  // Four hulls in formation, closing on the boss.
  function wing(k, cx, cy, spread, t, alpha) {
    var set = [['battleship', 0, 0, 62], ['destroyer', -1, 0.55, 44], ['destroyer', 1, 0.55, 44], ['frigate', 0, 1.15, 34]];
    for (var i = 0; i < set.length; i++) {
      var s = set[i];
      k.ship(s[0], cx + s[1] * spread, cy + s[2] * spread * 0.62 + Math.sin(t * 2.2 + i * 1.4) * 4, s[3], 0, alpha);
    }
  }

  window.VIDEOSTUDIO.VIDEOS.find(function (v) { return v.slug === 'dreadnaught-hunt-15s'; }).def = {
    slug: 'dreadnaught-hunt-15s',
    name: 'DREADNAUGHT HUNT',
    // The supernova. NEVER frame zero — a cold open starts on a dark starfield,
    // which is exactly the frame a network picks for you if you do not choose.
    posterAt: 9.6,
    caption:
      'One attempt per tier, per week. That is the whole Dreadnaught Hunt.\n\n'
      + 'Tier 14 hits like a wall — telegraphed novas, a 90-second window, and a fleet that has to hold position through all of it. '
      + 'Clear it and you get one ◇ Dread Core.\n\n'
      + 'Cores buy nodes on the Pilot Tree, and the tree is the one thing in the game that survives ascension. '
      + 'Everything else resets. That is why people show up on Mondays.\n\n'
      + 'Free in your browser — no install, no account needed to start.\nlootfleet.com',

    scenes: [
      { dur: 1.6, label: 'cold open — hull already burning', draw: function (t, p, k) {
        k.stars(t, 1);
        k.ctx.save(); k.ctx.translate(Math.sin(t * 40) * (1 - p) * 3, 0);
        k.ship('dreadnought', k.W / 2, BOSS_Y, 300, 0.02 * Math.sin(t * 1.4));
        for (var i = 0; i < 5; i++) {
          var ft = (t * 1.7 + i * 0.37) % 1;
          k.boom(k.W / 2 + (k.rnd() - 0.5) * 190, BOSS_Y + (k.rnd() - 0.5) * 130, 26 * (1 - ft) + 8, (1 - ft) * 0.75, i % 2 ? k.GOLD : k.RED);
        }
        wing(k, k.W / 2, 720, 96, t, 1);
        for (var b = 0; b < 6; b++) {
          var bt = (t * 2.3 + b * 0.28) % 1;
          k.bolt(k.W / 2 + (b - 2.5) * 34, 700 - bt * 300, k.W / 2 + (b - 2.5) * 20, 660 - bt * 300, 3, (1 - bt) * 0.9);
        }
        k.ctx.restore();
        k.bar(1 - p * 0.06, 'TIER 14 DREADNAUGHT', 1);
      } },

      { dur: 2.4, label: 'nova telegraph — the real tell', draw: function (t, p, k) {
        k.stars(t + 1.6, 1);
        k.ship('dreadnought', k.W / 2, BOSS_Y, 300, 0.03 * Math.sin(t * 1.2));
        var fuse = k.clamp(t / 1.5, 0, 1);
        k.novaRing(k.W / 2, 640, 150 + fuse * 26, fuse, k.clamp(t / 0.3, 0, 1) * (t > 1.5 ? k.clamp(1 - (t - 1.5) / 0.35, 0, 1) : 1));
        if (t > 1.5) { var bt = (t - 1.5) / 0.5; k.boom(k.W / 2, 640, 210 * bt, (1 - bt) * 0.95, k.RED); }
        var esc = t < 1.4 ? 0 : k.ease((t - 1.4) / 0.7);
        wing(k, k.W / 2, 720 + esc * 150, 96 + esc * 60, t, 1);
        k.ctx.save(); k.ctx.textAlign = 'center';
        k.ctx.globalAlpha = k.clamp((t - 0.35) / 0.3, 0, 1) * k.clamp((1.45 - t) / 0.3, 0, 1);
        k.ctx.fillStyle = k.RED; k.ctx.font = '800 14px Orbitron';
        k.ctx.fillText('MOVE', k.W / 2, 700);
        k.ctx.restore();
        k.bar(0.94 - p * 0.04, 'TIER 14 DREADNAUGHT', 1);
      } },

      { dur: 2.2, label: 'title — THE HUNT', draw: function (t, p, k) {
        k.stars(t + 4, 1);
        k.ship('dreadnought', k.W / 2, BOSS_Y + 20, 300, 0.02 * Math.sin(t));
        wing(k, k.W / 2, 760, 120, t, 1);
        k.title(t, '☠ WEEKLY RAID', 'THE HUNT', 'One attempt per tier. Every week.', k.RED);
        k.bar(0.90, 'TIER 14 DREADNAUGHT', k.clamp(1 - t / 0.5, 0, 1));
      } },

      { dur: 3.2, label: 'the wing commits — bar drains', draw: function (t, p, k) {
        k.stars(t + 6.2, 1.4);
        k.ctx.save(); k.ctx.translate(Math.sin(t * 34) * 2.4 * (0.4 + p * 0.6), Math.sin(t * 27) * 1.6);
        k.ship('dreadnought', k.W / 2, BOSS_Y, 300 + p * 14, 0.04 * Math.sin(t * 1.6));
        for (var i = 0; i < 9; i++) {
          var ft = (t * 2.1 + i * 0.21) % 1;
          k.boom(k.W / 2 + (k.rnd() - 0.5) * 230, BOSS_Y + (k.rnd() - 0.5) * 160, 34 * (1 - ft) + 10, (1 - ft) * 0.8, i % 3 ? k.GOLD : k.CYAN);
        }
        wing(k, k.W / 2, 740, 110, t, 1);
        for (var b = 0; b < 10; b++) {
          var bt = (t * 3.1 + b * 0.17) % 1, ox = (b - 4.5) * 26;
          k.bolt(k.W / 2 + ox, 720 - bt * 340, k.W / 2 + ox * 0.6, 676 - bt * 340, 3.4, (1 - bt) * 0.95, b % 3 ? k.CYAN : k.GOLD);
        }
        k.ctx.restore();
        k.bar(0.90 - k.eio(p) * 0.86, 'TIER 14 DREADNAUGHT', 1);
      } },

      { dur: 1.6, label: 'the kill — supernova', draw: function (t, p, k) {
        k.stars(t + 9.4, 1.4);
        var kk = k.ease(k.clamp(t / 0.55, 0, 1));
        if (t < 0.5) k.ship('dreadnought', k.W / 2, BOSS_Y, 300, 0.06 * Math.sin(t * 3));
        k.boom(k.W / 2, BOSS_Y, 60 + kk * 620, k.clamp(1.15 - kk, 0, 1), k.GOLD);
        if (t > 0.42 && t < 0.62) { k.ctx.fillStyle = 'rgba(255,255,255,' + (1 - Math.abs(t - 0.52) / 0.1) * 0.92 + ')'; k.ctx.fillRect(0, 0, k.W, k.H); }
        if (t > 0.45) {
          var sw = (t - 0.45) / 1.0;
          k.ctx.save(); k.ctx.globalAlpha = k.clamp(1 - sw, 0, 1) * 0.8;
          k.ctx.strokeStyle = '#fff2cf'; k.ctx.lineWidth = 6 * (1 - sw);
          k.ctx.beginPath(); k.ctx.arc(k.W / 2, BOSS_Y, 40 + sw * 560, 0, 7); k.ctx.stroke();
          k.ctx.restore();
        }
        wing(k, k.W / 2, 740, 110, t, k.clamp(1 - kk * 0.5, 0, 1));
        k.bar(0, 'TIER 14 DREADNAUGHT', k.clamp(1 - t / 0.4, 0, 1));
        k.ctx.save(); k.ctx.textAlign = 'center';
        k.ctx.globalAlpha = k.clamp((t - 0.6) / 0.35, 0, 1) * k.clamp((1.5 - t) / 0.4, 0, 1);
        k.ctx.fillStyle = '#fff'; k.ctx.font = '900 30px Orbitron';
        k.ctx.shadowColor = k.GOLD; k.ctx.shadowBlur = 24;
        k.ctx.fillText('DREADNAUGHT DOWN', k.W / 2, 470);
        k.ctx.restore();
      } },

      { dur: 1.6, label: '◇ Dread Core drops', draw: function (t, p, k) {
        k.stars(t + 11, 1);
        var drop = k.eio(k.clamp(t / 0.85, 0, 1)), cy = BOSS_Y + drop * 180;
        k.boom(k.W / 2, BOSS_Y, 150, k.clamp(0.35 - t * 0.3, 0, 1), '#5c3a12');
        k.ctx.save();
        k.ctx.translate(k.W / 2, cy); k.ctx.rotate(t * 2.4);
        var pul = 1 + Math.sin(t * 9) * 0.06; k.ctx.scale(pul, pul);
        k.ctx.shadowColor = k.PURP; k.ctx.shadowBlur = 34;
        k.ctx.fillStyle = k.PURP;
        k.ctx.beginPath(); k.ctx.moveTo(0, -26); k.ctx.lineTo(21, 0); k.ctx.lineTo(0, 26); k.ctx.lineTo(-21, 0); k.ctx.closePath(); k.ctx.fill();
        k.ctx.fillStyle = '#f0dcff';
        k.ctx.beginPath(); k.ctx.moveTo(0, -13); k.ctx.lineTo(10, 0); k.ctx.lineTo(0, 13); k.ctx.lineTo(-10, 0); k.ctx.closePath(); k.ctx.fill();
        k.ctx.restore();
        k.ctx.save(); k.ctx.textAlign = 'center';
        k.ctx.globalAlpha = k.clamp((t - 0.55) / 0.35, 0, 1);
        k.ctx.fillStyle = k.PURP; k.ctx.font = '900 21px Orbitron';
        k.ctx.fillText('◇ DREAD CORE', k.W / 2, cy + 84);
        k.ctx.fillStyle = '#b9c8dc'; k.ctx.font = '700 15px Rajdhani';
        k.ctx.fillText('Spend it on the Pilot Tree. It survives ascension.', k.W / 2, cy + 112);
        k.ctx.restore();
      } },

      { dur: 2.4, label: 'end card — PLAY FREE', draw: function (t, p, k) {
        k.stars(t + 12.6, 1);
        k.endCard(t);
      } },
    ],
  };
})();
