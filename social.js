/* =============================================================================
   sim-scenes-2.js — Feature sims: Idle & AFK · Skill Trees · Weekly Heats
   ============================================================================= */
(function () {
  'use strict';
  const K = window.SimKit, TAU = K.TAU, rnd = K.rnd, clamp = K.clamp, lerp = K.lerp;

  /* ========================================================== 4 · IDLE ======
     "Tab closed." A dimmed arena; the autopilot drone keeps farming faint mobs
     on its own while a big OFFLINE EARNINGS counter banks up with a +stream and
     an offline clock. Periodically: WELCOME BACK — a chest bursts the haul. */
  window.LF_SCENES.idle = function (api) {
    const ctx = api.ctx;
    const drone = K.img('ships/ship-interceptor.png');
    const P = K.particles(220);
    const motes = [], streams = [];
    let banked = 0, rate = 0, offMin = 0, phase = 'farm', pt = 0, claim = 0, chestPop = 0;
    function spawnMote() { motes.push({ x: rnd(api.W * 0.15, api.W * 0.85), y: rnd(api.H * 0.18, api.H * 0.62), r: rnd(3.5, 6), col: K.ECOL[(Math.random() * K.ECOL.length) | 0], hp: 1, born: 0, ship: 'ships/ship-' + K.pickEnemyHull(false) + '.png', wob: Math.random() * 6.28 }); }

    return {
      frame: function (dt, t) {
        const W = api.W, H = api.H;
        K.bg(api, { top: '#0c1226', mid: '#070b18', bot: '#04060e', star: '#9fb0d6', drift: 1.4, starA: 0.7 });
        // moon / "AFK" crescent, top-right
        const mx = W - 30, my = 28, mr = 13;
        ctx.fillStyle = 'rgba(180,195,235,0.9)'; ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill();
        ctx.fillStyle = '#070b18'; ctx.beginPath(); ctx.arc(mx + 5, my - 3, mr, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t * 1.2);
        K.text(ctx, 'z', mx + 14, my - 8, { size: 9, col: '#8fa0c8', stroke: false });
        K.text(ctx, 'z', mx + 20, my - 15, { size: 7, col: '#8fa0c8', stroke: false }); ctx.globalAlpha = 1;

        pt += dt;
        if (phase === 'farm') {
          offMin += dt * 36; // accelerated clock
          rate = lerp(rate, 5.2e7, clamp(dt, 0, 1));
          banked += rate * dt * 60;
          if (motes.length < 5 && Math.random() < dt * 2.4) spawnMote();
          if (pt > 7.5) { phase = 'return'; pt = 0; }
        } else if (phase === 'return') {
          // WELCOME BACK + chest burst
          if (chestPop === 0) { chestPop = 1; claim = banked; P.burst(W / 2, H * 0.5, { n: 46, col: '#ffd24d', sp0: 80, sp1: 360, l0: 0.6, l1: 1.4, r0: 1.4, r1: 3.6, g: 120 }); P.ring(W / 2, H * 0.5, '#fff', 26, 0.6);
            for (let i = 0; i < 16; i++) { const tier = Math.random() < 0.5 ? 3 : Math.random() < 0.7 ? 4 : 5; streams.push({ x: W / 2, y: H * 0.5, vx: rnd(-90, 90), vy: rnd(-200, -70), tier, life: 1.3, bob: Math.random() * 6.28 }); } }
          banked = lerp(banked, 0, clamp(dt * 1.4, 0, 1));
          if (pt > 2.6) { phase = 'farm'; pt = 0; chestPop = 0; banked = 0; offMin = 0; motes.length = 0; }
        }
        if (chestPop > 0) chestPop = Math.max(0, chestPop - dt * 0.5);

        // autopilot drone circles & zaps motes
        const dcx = W / 2, dcy = H * 0.46, dr = Math.min(W, H) * 0.26;
        const da = t * 1.1;
        const dx = dcx + Math.cos(da) * dr, dy = dcy + Math.sin(da) * dr * 0.7;
        // drone fire
        for (const m of motes) {
          m.born += dt;
          K.enemyShip(ctx, m.ship, m.col, m.x, m.y, m.r * 3.2, Math.sin(t * 0.6 + m.wob) * 0.5 + Math.PI, false);
        }
        if (phase === 'farm' && Math.sin(t * 8) > 0.9 && motes.length) {
          const m = motes[0];
          ctx.strokeStyle = 'rgba(127,255,203,0.7)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(dx, dy); ctx.lineTo(m.x, m.y); ctx.stroke();
          if (Math.random() < 0.4) { P.burst(m.x, m.y, { n: 6, col: m.col, sp0: 30, sp1: 110, l0: 0.3, l1: 0.6, r0: 1, r1: 2.4 }); motes.shift(); banked += 2e7; }
        }

        // streamed loot from the chest
        for (const s of streams) { s.life -= dt; s.bob += dt * 3; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 240 * dt; K.gem(ctx, s.x, s.y + Math.sin(s.bob) * 1.2, s.tier, t); }
        for (let i = streams.length - 1; i >= 0; i--) if (streams[i].life <= 0) streams.splice(i, 1);

        P.update(dt); P.draw(ctx);

        // the drone itself (dim, auto)
        ctx.globalAlpha = 0.95;
        K.ship(ctx, drone, dx, dy, 30, t, { glow: '#7fffcb' });
        ctx.globalAlpha = 1;

        // central readout
        if (phase === 'farm') {
          K.text(ctx, 'OFFLINE EARNINGS', W / 2, H * 0.74, { size: 9, col: '#7f8db0', sw: 2, font: 'Rajdhani' });
          K.text(ctx, K.num(banked), W / 2, H * 0.74 + 22, { size: 27, col: '#ffd24d', sw: 4, font: 'Orbitron, Rajdhani, sans-serif' });
          K.text(ctx, '+' + K.num(rate) + '/min  \u00b7  ' + fmtClock(offMin), W / 2, H * 0.74 + 38, { size: 9.5, col: '#9fb0d6', sw: 2.2 });
        } else {
          const k = clamp(pt * 2, 0, 1);
          ctx.globalAlpha = Math.min(1, (2.6 - pt) * 1.6);
          K.text(ctx, 'WELCOME BACK', W / 2, H * 0.28 - (1 - k) * 6, { size: 16, col: '#fff3d0', sw: 4 });
          K.text(ctx, 'COLLECTED ' + K.num(claim), W / 2, H * 0.28 + 17, { size: 12, col: '#ffd24d', sw: 3 });
          ctx.globalAlpha = 1;
        }

        K.vignette(api, 0.55);
        api.setHud('pow', K.num(banked));
      },
    };
    function fmtClock(min) { const h = (min / 60) | 0, m = (min % 60) | 0; return (h ? h + 'h ' : '') + m + 'm away'; }
  };

  /* ========================================================= 5 · SKILLS =====
     Three branches (Offense / Defense / Tactics) fan up from a root. A pulse of
     skill points lights nodes one-by-one; edges glow as they fill; each branch
     capstone bursts on completion. Fills, holds, resets, repeats. */
  window.LF_SCENES.skills = function (api) {
    const ctx = api.ctx;
    const P = K.particles(160);
    const BRANCH = [
      { name: 'DEFENSE', col: '#4fa6ff', dir: -1 },
      { name: 'TACTICS', col: '#f2b24b', dir: 0 },
      { name: 'OFFENSE', col: '#ff5168', dir: 1 },
    ];
    let nodes, order, lit, fillT, phase, pt;

    function build() {
      const W = api.W, H = api.H, rx = W / 2, ry = H * 0.9;
      nodes = []; const root = { x: rx, y: ry, br: -1, i: -1, on: 0, cap: false, glow: 0 };
      nodes.push(root);
      const perBranch = 5;
      BRANCH.forEach((b, bi) => {
        let prev = root;
        for (let i = 0; i < perBranch; i++) {
          const tnorm = (i + 1) / perBranch;
          const spread = b.dir * (0.10 + tnorm * 0.34);
          const x = rx + spread * W;
          const y = ry - tnorm * H * 0.74 - (b.dir === 0 ? 0 : Math.abs(b.dir) * 0);
          const n = { x, y, br: bi, i, on: 0, cap: i === perBranch - 1, glow: 0, parent: prev, col: b.col };
          nodes.push(n); prev = n;
        }
      });
      // light order: interleave branches so all three grow together
      order = [];
      for (let i = 0; i < perBranch; i++) for (let bi = 0; bi < 3; bi++) order.push(nodes.find(n => n.br === bi && n.i === i));
      lit = 0; fillT = 0; phase = 'fill'; pt = 0; root.on = 1;
    }

    return {
      frame: function (dt, t) {
        const W = api.W, H = api.H;
        if (!nodes || nodes._w !== W) { build(); nodes._w = W; }
        K.bg(api, { top: '#141328', mid: '#0b0a1c', bot: '#050409', tint: 'rgba(120,120,255,0.07)', drift: 1.6 });

        pt += dt;
        if (phase === 'fill') {
          fillT += dt;
          if (fillT > 0.42 && lit < order.length) {
            fillT = 0; const n = order[lit++]; n.on = 0.001; n.glow = 1;
            P.burst(n.x, n.y, { n: 8, col: n.col, sp0: 30, sp1: 120, l0: 0.3, l1: 0.7, r0: 1, r1: 2.6 });
            if (n.cap) { P.ring(n.x, n.y, n.col, 12, 0.6); P.burst(n.x, n.y, { n: 16, col: n.col, sp0: 60, sp1: 220, l0: 0.5, l1: 1, r0: 1.4, r1: 3 }); }
          }
          if (lit >= order.length) { phase = 'hold'; pt = 0; }
        } else if (phase === 'hold') {
          if (pt > 1.8) { phase = 'reset'; pt = 0; }
        } else if (phase === 'reset') {
          nodes.forEach(n => { if (n.i >= 0) n.on = lerp(n.on, 0, clamp(dt * 3, 0, 1)); });
          if (pt > 0.7) { nodes.forEach(n => { if (n.i >= 0) { n.on = 0; n.glow = 0; } }); lit = 0; phase = 'fill'; pt = 0; }
        }
        nodes.forEach(n => { if (n.on > 0 && n.on < 1) n.on = clamp(n.on + dt * 3.2, 0, 1); if (n.glow > 0) n.glow -= dt * 1.5; });

        // ---- edges ----
        nodes.forEach(n => {
          if (!n.parent) return;
          const k = Math.min(n.on, n.parent.on);
          ctx.strokeStyle = k > 0 ? K.rgba(n.col, 0.3 + 0.5 * k) : 'rgba(150,165,210,0.12)';
          ctx.lineWidth = k > 0 ? 2.2 : 1.2;
          ctx.beginPath(); ctx.moveTo(n.parent.x, n.parent.y); ctx.lineTo(n.x, n.y); ctx.stroke();
          if (k > 0) { // travelling spark
            const sp = (t * 0.6 + n.br * 0.3 + n.i * 0.12) % 1; const px = lerp(n.parent.x, n.x, sp), py = lerp(n.parent.y, n.y, sp);
            ctx.globalAlpha = 0.6 * k; ctx.fillStyle = n.col; ctx.beginPath(); ctx.arc(px, py, 1.8, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
          }
        });

        P.update(dt); P.draw(ctx);

        // ---- nodes ----
        nodes.forEach(n => {
          const r = n.i < 0 ? 8 : (n.cap ? 9 : 5.5);
          const col = n.i < 0 ? api.accent : n.col;
          if (n.on > 0) { ctx.globalAlpha = 0.25 * n.on + n.glow * 0.4; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(n.x, n.y, r + 6 + n.glow * 6, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
          ctx.fillStyle = n.on > 0.5 ? col : '#11151f';
          ctx.strokeStyle = n.on > 0 ? col : 'rgba(150,165,210,0.3)'; ctx.lineWidth = 2;
          if (n.on > 0.5) { ctx.shadowColor = col; ctx.shadowBlur = 10; }
          if (n.cap) { // capstone diamond
            ctx.save(); ctx.translate(n.x, n.y); ctx.rotate(Math.PI / 4); ctx.beginPath(); ctx.rect(-r, -r, r * 2, r * 2); ctx.fill(); ctx.stroke(); ctx.restore();
          } else { ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, TAU); ctx.fill(); ctx.stroke(); }
          ctx.shadowBlur = 0;
        });

        // branch labels at the capstones
        BRANCH.forEach((b, bi) => { const cap = nodes.find(n => n.br === bi && n.cap); if (cap) { ctx.globalAlpha = 0.5 + 0.5 * clamp(cap.on, 0, 1); K.text(ctx, b.name, cap.x, cap.y - 15, { size: 8.5, col: b.col, sw: 2.4 }); ctx.globalAlpha = 1; } });

        // points readout
        const spent = nodes.filter(n => n.i >= 0 && n.on > 0.5).length;
        K.text(ctx, spent + ' / 15 SKILLS', W / 2, H * 0.97, { size: 10, col: '#cfe0ff', sw: 2.6 });

        K.vignette(api, 0.48);
        api.setHud('pow', spent + ' PTS');
      },
    };
  };

  /* ========================================================== 6 · HEATS =====
     A weekly leaderboard. YOU climb from the bottom as power grows: rows tween
     to their new ranked slots, your rank counts down to #1, a crown flashes,
     then the heat resets and the climb begins again. */
  window.LF_SCENES.heats = function (api) {
    const ctx = api.ctx;
    const P = K.particles(120);
    const NAMES = ['VoidReaper', 'Nova_K', 'IronWolf', 'Zephyr', 'Cmdr.Ace', 'Starfall', 'GhostFleet', 'Mecha9', 'Orion', 'Hex', 'Pulsar', 'Drift', 'Korr', 'Vantablack'];
    let racers, rows, weekT, phase, pt, crown;

    function build() {
      racers = NAMES.map((n, i) => ({ name: n, val: rnd(2e9, 9e9) * (1 + (NAMES.length - i) * 0.4), you: false, y: 0, ty: 0 }));
      const you = { name: 'YOU', val: 1.4e9, you: true, y: 0, ty: 0 };
      racers.push(you);
      racers.sort((a, b) => b.val - a.val);
      rows = Math.min(7, racers.length);
      weekT = rnd(0.2, 0.6); phase = 'climb'; pt = 0; crown = 0;
      racers.forEach((r, i) => { r.y = r.ty = i; });
    }
    function rankOf(r) { return racers.indexOf(r); }

    return {
      frame: function (dt, t) {
        const W = api.W, H = api.H;
        if (!racers || racers._w !== W) { build(); racers._w = W; }
        K.bg(api, { top: '#101630', mid: '#0a0e1f', bot: '#05070f', tint: K.rgba(api.accent, 0.08), drift: 1.4 });

        pt += dt;
        const you = racers.find(r => r.you);
        if (phase === 'climb') {
          you.val += 7.5e9 * dt;
          racers.forEach(r => { if (!r.you) r.val += rnd(0.2, 1.0) * 1e9 * dt; });
          // re-sort & assign target slots
          racers.sort((a, b) => b.val - a.val);
          racers.forEach((r, i) => { r.ty = i; });
          if (rankOf(you) === 0 && crown === 0) { crown = 1; phase = 'win'; pt = 0; P.burst(W * 0.18, slotY(0, H) , { n: 30, col: '#ffd24d', sp0: 60, sp1: 240, l0: 0.6, l1: 1.2, r0: 1.4, r1: 3.4, g: 80 }); }
        } else if (phase === 'win') {
          if (pt > 2.4) { phase = 'reset'; pt = 0; }
        } else if (phase === 'reset') {
          if (pt > 0.4) { build(); you2reset(); }
        }
        if (crown > 0 && phase !== 'win') crown = 0;

        // animate row positions
        racers.forEach(r => { r.y = lerp(r.y, r.ty, clamp(dt * 6, 0, 1)); });

        // header
        K.text(ctx, '\u2691 WEEKLY HEAT', 14, 18, { size: 11, col: api.accent, align: 'left', sw: 2.6, baseline: 'middle', font: 'Orbitron, Rajdhani, sans-serif' });
        K.text(ctx, weekClock(weekT), W - 14, 18, { size: 9.5, col: '#9fb0d6', align: 'right', sw: 2.2, baseline: 'middle' });
        weekT = (weekT + dt * 0.0006);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(12, 30); ctx.lineTo(W - 12, 30); ctx.stroke();

        // rows (draw only the visible window, sorted by slot)
        const maxVal = racers[0].val;
        racers.forEach(r => {
          if (r.y > rows + 0.2 && !r.you) return;
          const slot = r.y; if (slot > rows + 0.5) return;
          const y = slotY(slot, H); const rank = Math.round(r.ty) + 1;
          const me = r.you;
          // row bg
          ctx.fillStyle = me ? K.rgba(api.accent, 0.14) : 'rgba(255,255,255,0.025)';
          roundRect(ctx, 12, y - 13, W - 24, 26, 7); ctx.fill();
          if (me) { ctx.strokeStyle = K.rgba(api.accent, 0.6); ctx.lineWidth = 1.4; roundRect(ctx, 12, y - 13, W - 24, 26, 7); ctx.stroke(); }
          // rank
          K.text(ctx, (rank < 10 ? '0' : '') + rank, 28, y, { size: 12, col: rank === 1 ? '#ffd24d' : (me ? api.accent : '#8fa0c8'), sw: 2.6, baseline: 'middle', font: 'Orbitron, Rajdhani, sans-serif' });
          // crown for #1
          if (rank === 1) K.text(ctx, '\u265b', 44, y, { size: 11, col: '#ffd24d', baseline: 'middle', sw: 2.2 });
          // name
          K.text(ctx, r.name, 58, y, { size: 11, col: me ? '#fff' : '#cfe0ff', align: 'left', sw: 2.4, baseline: 'middle' });
          // power bar
          const bx = W * 0.52, bw = W * 0.3, frac = clamp(r.val / maxVal, 0.06, 1);
          ctx.fillStyle = 'rgba(0,0,0,0.35)'; roundRect(ctx, bx, y - 4, bw, 8, 4); ctx.fill();
          ctx.fillStyle = me ? api.accent : K.rgba('#5fd1ff', 0.7); roundRect(ctx, bx, y - 4, bw * frac, 8, 4); ctx.fill();
          // value
          K.text(ctx, K.num(r.val), W - 16, y, { size: 10, col: me ? '#ffd24d' : '#9fb0d6', align: 'right', sw: 2.2, baseline: 'middle' });
        });

        P.update(dt); P.draw(ctx);

        if (phase === 'win') {
          ctx.globalAlpha = Math.min(1, (2.4 - pt) * 1.6) * (0.6 + 0.4 * Math.sin(t * 6));
          K.text(ctx, '\u2605 RANK #1 \u2605', W / 2, H * 0.92, { size: 15, col: '#ffd24d', sw: 4 });
          ctx.globalAlpha = 1;
        }

        K.vignette(api, 0.5);
        api.setHud('pow', '#' + (rankOf(you) + 1));
      },
    };
    function slotY(slot, H) { return H * 0.13 + slot * ((H * 0.83) / 7) + ((H * 0.83) / 7) / 2; }
    function weekClock() { return '2d 14h left'; }
    function you2reset() { /* noop hook */ }
    function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  };
})();
