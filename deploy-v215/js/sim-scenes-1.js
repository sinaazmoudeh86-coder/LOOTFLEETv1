/* =============================================================================
   sim-scenes-1.js — Feature sims: Infinite Loot · Evolve Your Fleet · Conquer
   Each factory(api) returns { frame(dt, t) }. State is captured in closures.
   ============================================================================= */
(function () {
  'use strict';
  const K = window.SimKit, TAU = K.TAU, rnd = K.rnd, clamp = K.clamp, lerp = K.lerp;

  /* ============================================================ 1 · LOOT ====
     Hero auto-fires the swarm; kills spray rarity loot that arcs out, then is
     magnet-vacuumed into the hull. Big drops fire a rarity callout. */
  window.LF_SCENES.loot = function (api) {
    const ctx = api.ctx;
    const hero = K.img('ships/ship-cruiser.png');
    const enemies = [], bolts = [], loot = [], floats = [];
    const P = K.particles(240);
    const pl = { x: 0, y: 0, fire: 0, sweep: 0 };
    let spawnT = 0, power = 6.4e9, callT = 0, callTxt = '', callCol = '#fff';

    function spawnE() {
      if (enemies.length > 16) return;
      const x = rnd(api.W * 0.12, api.W * 0.88);
      const big = Math.random() < 0.16;
      enemies.push({ x, y: rnd(-30, -6), r: big ? rnd(8, 10) : rnd(4.6, 7), col: K.ECOL[(Math.random() * K.ECOL.length) | 0], hp: big ? 3 : 2, flash: 0, sp: rnd(16, 32), wob: Math.random() * 6.28, big, ship: 'ships/ship-' + K.pickEnemyHull(big) + '.png' });
    }
    function nearest(x, y) { let b = null, bd = 1e9; for (const e of enemies) { if (e.dead) continue; const d = (e.x - x) ** 2 + (e.y - y) ** 2; if (d < bd) { bd = d; b = e; } } return b; }
    function dropLoot(x, y, minTier) {
      if (loot.length > 26) return;
      const r = Math.random();
      let tier = r < 0.34 ? 0 : r < 0.58 ? 1 : r < 0.76 ? 2 : r < 0.89 ? 3 : r < 0.97 ? 4 : 5;
      if (minTier) tier = Math.min(5, Math.max(tier, minTier));
      loot.push({ x, y, vx: rnd(-70, 70), vy: rnd(-150, -50), tier, born: 0, mag: false, bob: Math.random() * 6.28 });
    }
    function kill(e) {
      e.dead = true; power += rnd(3e10, 1.2e11);
      P.burst(e.x, e.y, { n: 8 + (e.r | 0), col: e.col, sp0: 40, sp1: 170, l0: 0.4, l1: 0.8, r0: 1.2, r1: 3 });
      P.ring(e.x, e.y, '#fff', e.r, 0.3);
      if (Math.random() < 0.62 || e.big) dropLoot(e.x, e.y, e.big ? 3 : 0);
      if (e.big) dropLoot(e.x, e.y, 2);
    }

    return {
      frame: function (dt, t) {
        const W = api.W, H = api.H;
        pl.x = W / 2; pl.y = H * 0.8;
        K.bg(api, { tint: 'rgba(190,70,200,0.10)' });

        spawnT -= dt;
        if (spawnT <= 0) { spawnT = rnd(0.18, 0.4); spawnE(); if (Math.random() < 0.5) spawnE(); }

        // enemies home in
        for (const e of enemies) {
          if (e.flash > 0) e.flash -= dt * 5;
          const dx = pl.x - e.x, dy = pl.y - e.y, d = Math.hypot(dx, dy) || 1;
          e.x += (dx / d) * e.sp * dt + Math.cos(t * 2 + e.wob) * 8 * dt;
          e.y += (dy / d) * e.sp * dt;
          K.enemyShip(ctx, e.ship, e.col, e.x, e.y, e.r * 3.2, Math.atan2(dy, dx) + Math.PI / 2, e.flash > 0);
        }

        // hero fire — 3 lanes to nearest + a sweeping shot
        pl.fire -= dt;
        if (pl.fire <= 0) {
          pl.fire = 0.11;
          for (let s = 0; s < 3; s++) {
            const tg = nearest(pl.x + (s - 1) * 30, pl.y);
            if (tg) { const a = Math.atan2(tg.y - pl.y, tg.x - pl.x), crit = Math.random() < 0.3; bolts.push({ x: pl.x + (s - 1) * 8, y: pl.y - 10, vx: Math.cos(a) * 380, vy: Math.sin(a) * 380, crit }); }
          }
          pl.sweep += 0.7;
          bolts.push({ x: pl.x, y: pl.y - 6, vx: Math.cos(pl.sweep) * 200, vy: -150 + Math.sin(pl.sweep) * 80, crit: false });
        }

        // bolts
        for (const b of bolts) {
          b.x += b.vx * dt; b.y += b.vy * dt; b.life = (b.life || 1.4) - dt;
          for (const e of enemies) { if (e.dead) continue; if (Math.abs(e.x - b.x) < e.r + 3 && Math.abs(e.y - b.y) < e.r + 3) { b.dead = true; e.flash = 1; e.hp--; if (e.hp <= 0) kill(e); break; } }
          const col = b.crit ? '#ffd24d' : '#bfe6ff';
          ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 6;
          ctx.beginPath(); ctx.arc(b.x, b.y, b.crit ? 2.6 : 2, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
        }

        // loot: arc then magnet
        for (const L of loot) {
          L.born += dt; L.bob += dt * 3;
          if (!L.mag && L.born > 0.42) L.mag = true;
          if (L.mag) {
            const dx = pl.x - L.x, dy = pl.y - L.y, d = Math.hypot(dx, dy) || 1;
            const pull = 90 + (1 - Math.min(1, d / 200)) * 380;
            L.x += (dx / d) * pull * dt; L.y += (dy / d) * pull * dt;
            ctx.strokeStyle = K.rgba(K.RAR[L.tier][1], 0.22); ctx.lineWidth = 1 + L.tier * 0.25;
            ctx.beginPath(); ctx.moveTo(L.x, L.y); ctx.lineTo(L.x + dx * 0.32, L.y + dy * 0.32); ctx.stroke();
            if (d < 16) {
              L.dead = true; power += (L.tier + 1) * 5e10;
              floats.push({ x: pl.x + rnd(-8, 8), y: pl.y - 14, txt: '+' + K.RAR[L.tier][0], col: K.RAR[L.tier][1], life: 0.8, max: 0.8, sm: true });
              if (L.tier >= 3) { callT = 1.6; callTxt = K.RAR[L.tier][0].toUpperCase() + ' DROP!'; callCol = K.RAR[L.tier][1]; }
            }
          } else { L.x += L.vx * dt; L.y += L.vy * dt; L.vy += 120 * dt; }
          K.gem(ctx, L.x, L.y + Math.sin(L.bob) * 1.5, L.tier, t);
        }

        P.update(dt); P.draw(ctx);
        K.ship(ctx, hero, pl.x, pl.y + Math.sin(t * 1.6) * 2, 50, t, { glow: api.accent, thruster: true });
        // muzzle flicker
        if ((Math.sin(t * 40) + 1) / 2 > 0.45) { ctx.fillStyle = '#ffe6a0'; ctx.shadowColor = '#ffb43c'; ctx.shadowBlur = 10; for (const gx of [-10, 0, 10]) { ctx.beginPath(); ctx.arc(pl.x + gx, pl.y - 18, 2.4, 0, TAU); ctx.fill(); } ctx.shadowBlur = 0; }

        // floats
        for (const f of floats) { f.life -= dt * 1.5; f.y -= 30 * dt; ctx.globalAlpha = Math.max(0, f.life / f.max); K.text(ctx, f.txt, f.x, f.y, { size: 10, col: f.col, sw: 2.4 }); }
        ctx.globalAlpha = 1;

        // big rarity callout
        if (callT > 0) {
          callT -= dt; const k = clamp((1.6 - callT) * 4, 0, 1);
          ctx.globalAlpha = Math.min(1, callT * 1.4);
          K.text(ctx, callTxt, W / 2, H * 0.3 - (1 - k) * 6, { size: 17, col: callCol, sw: 4 });
          ctx.globalAlpha = 1;
        }

        K.vignette(api, 0.46);
        api.setHud('pow', K.num(power));

        // cull
        for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].dead || enemies[i].y > H + 30) enemies.splice(i, 1);
        for (let i = bolts.length - 1; i >= 0; i--) { const b = bolts[i]; if (b.dead || b.life <= 0 || b.x < -20 || b.x > W + 20 || b.y < -30 || b.y > H + 20) bolts.splice(i, 1); }
        for (let i = loot.length - 1; i >= 0; i--) if (loot[i].dead) loot.splice(i, 1);
        for (let i = floats.length - 1; i >= 0; i--) if (floats[i].life <= 0) floats.splice(i, 1);
      },
    };
  };

  /* ========================================================== 2 · EVOLVE ====
     One ship climbs the hull ladder: blueprint shards spiral in + a ring fills,
     a white flash swaps to the next (bigger) hull, upgrade shockwaves fire, a
     banner names it. A vertical tier track on the right shows progress. */
  window.LF_SCENES.evolve = function (api) {
    const ctx = api.ctx;
    const HULLS = [
      ['frigate', 'FRIGATE'], ['interceptor', 'INTERCEPTOR'], ['cruiser', 'CRUISER'], ['heavycruiser', 'HEAVY CRUISER'],
      ['destroyer', 'DESTROYER'], ['battleship', 'BATTLESHIP'], ['dreadnought', 'DREADNOUGHT'], ['carrier', 'CARRIER'],
      ['supercarrier', 'SUPER CARRIER'], ['titan', 'TITAN CARRIER'],
    ];
    const imgs = HULLS.map(h => K.img('ships/ship-' + h[0] + '.png'));
    const P = K.particles(200);
    let idx = 0, phase = 'build', pt = 0, prog = 0, flash = 0, ringT = 0, banner = 0, power = 1.8e9;
    const shards = [];
    function seedShards() { shards.length = 0; for (let i = 0; i < 12; i++) shards.push({ a: rnd(0, TAU), r: rnd(60, 110), in: false, done: false }); }
    seedShards();

    return {
      frame: function (dt, t) {
        const W = api.W, H = api.H, cx = W * 0.46, cy = H * 0.52;
        K.bg(api, { top: '#16142e', mid: '#0d0a1e', tint: K.rgba(api.accent, 0.12) });
        pt += dt;

        const size = 44 + idx * 3.2;

        if (phase === 'build') {
          prog = clamp(pt / 3.4, 0, 1);
          // shards spiral inward to feed the build
          let landed = 0;
          for (const s of shards) {
            const target = (s.idxN = s.idxN || (Math.random() * 0.0 + 0));
            if (!s.done) {
              s.r = lerp(s.r, 6, clamp(dt * (0.7 + prog), 0, 1));
              s.a += dt * 1.4;
              if (s.r < 12) { s.done = true; P.burst(cx, cy, { n: 3, col: api.accent, sp0: 20, sp1: 70, l0: 0.2, l1: 0.5, r0: 1, r1: 2 }); }
            } else landed++;
            const sx = cx + Math.cos(s.a) * s.r, sy = cy + Math.sin(s.a) * s.r;
            if (!s.done) { ctx.fillStyle = api.accent; ctx.shadowColor = api.accent; ctx.shadowBlur = 7; ctx.save(); ctx.translate(sx, sy); ctx.rotate(s.a); ctx.fillRect(-2.4, -2.4, 4.8, 4.8); ctx.restore(); ctx.shadowBlur = 0; }
          }
          if (pt > 3.4) { phase = 'evolve'; pt = 0; flash = 1; ringT = 1; power *= 2.4; idx = (idx + 1) % HULLS.length; banner = 2.4; P.burst(cx, cy, { n: 40, col: '#ffd24d', sp0: 80, sp1: 360, l0: 0.5, l1: 1.2, r0: 1.4, r1: 3.6 }); P.ring(cx, cy, '#fff', 24, 0.6); }
        } else if (phase === 'evolve') {
          if (pt > 2.4) { phase = 'build'; pt = 0; seedShards(); }
        }

        // build progress ring (during build)
        if (phase === 'build') {
          ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, size * 0.86, 0, TAU); ctx.stroke();
          ctx.strokeStyle = api.accent; ctx.lineWidth = 3; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.arc(cx, cy, size * 0.86, -Math.PI / 2, -Math.PI / 2 + prog * TAU); ctx.stroke();
          ctx.lineCap = 'butt';
        }

        P.update(dt); P.draw(ctx);

        // the ship (slow spin-bob + accent glow)
        ctx.save(); ctx.translate(cx, cy + Math.sin(t * 1.4) * 2);
        const breathe = phase === 'evolve' ? 1 + Math.max(0, (0.5 - pt)) * 0.5 : 1;
        ctx.scale(breathe, breathe);
        K.ship(ctx, imgs[idx], 0, 0, size, t, { glow: api.accent });
        ctx.restore();

        // upgrade shockwaves
        if (ringT > 0) {
          ringT -= dt * 0.7;
          for (let i = 0; i < 3; i++) { const k = clamp((1 - ringT) * 1.7 - i * 0.18, 0, 1); if (k <= 0 || k >= 1) continue; ctx.globalAlpha = (1 - k) * 0.85; ctx.strokeStyle = '#ffd24d'; ctx.lineWidth = 2.6 * (1 - k) + 0.6; ctx.beginPath(); ctx.arc(cx, cy, 24 + k * 100, 0, TAU); ctx.stroke(); }
          ctx.globalAlpha = 1;
        }

        // vertical tier track (right edge)
        const tx = W - 22, n = HULLS.length, top = H * 0.16, bot = H * 0.84, step = (bot - top) / (n - 1);
        ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(tx, top); ctx.lineTo(tx, bot); ctx.stroke();
        for (let i = 0; i < n; i++) {
          const y = top + i * step, on = i <= idx;
          ctx.fillStyle = on ? api.accent : 'rgba(255,255,255,0.16)';
          if (i === idx) { ctx.shadowColor = api.accent; ctx.shadowBlur = 10; }
          ctx.beginPath(); ctx.arc(tx, y, i === idx ? 4.2 : 2.6, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
        }

        // flash
        if (flash > 0) { flash -= dt * 1.8; ctx.globalAlpha = Math.min(1, flash) * 0.85; ctx.fillStyle = '#fff4da'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }

        // banner
        if (banner > 0) {
          banner -= dt; const k = clamp((2.4 - banner) * 3, 0, 1);
          ctx.globalAlpha = Math.min(1, banner) * k;
          K.text(ctx, '\u2b06 EVOLVED', cx, H * 0.26, { size: 15, col: '#ffd24d', sw: 4 });
          K.text(ctx, HULLS[idx][1], cx, H * 0.26 + 17, { size: 12, col: '#fff3d0', sw: 3 });
          ctx.globalAlpha = 1;
        } else {
          ctx.globalAlpha = 0.9; K.text(ctx, HULLS[idx][1], cx, H * 0.9, { size: 11, col: '#cfe0ff', sw: 3 }); ctx.globalAlpha = 1;
        }

        K.vignette(api, 0.44);
        api.setHud('pow', K.num(power));
      },
    };
  };

  /* ========================================================= 3 · GALAXY =====
     A hex map seen top-down. A fleet token jumps to a frontier hex, a 10-wave
     siege bar fills, the hex flips to your gold and resources tick. Territory
     spreads outward until it nears full, then resets small. */
  window.LF_SCENES.galaxy = function (api) {
    const ctx = api.ctx;
    const fleetImg = K.img('ships/ship-destroyer.png');
    const P = K.particles(160);
    const RES = [['\u26fd', '#5fd1ff'], ['\u2692', '#cdd9ff'], ['\u269b', '#b87bff']]; // fuel / iron / plasma
    let hexR, cols, rows, cells, owned, fleet, target, phase, pt, waves, res, floats;

    function build() {
      hexR = Math.max(13, api.W * 0.066);
      const hw = Math.sqrt(3) * hexR, vh = hexR * 1.5;
      cols = Math.ceil(api.W / hw) + 2; rows = Math.ceil(api.H / vh) + 2;
      cells = [];
      for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
        const x = q * hw + (r % 2 ? hw / 2 : 0) - hw * 0.5;
        const y = r * vh - vh * 0.4;
        cells.push({ q, r, x, y, owned: false, flip: 0, key: q + ',' + r });
      }
      owned = {};
      // claim the center
      const c0 = cells.reduce((a, b) => (Math.hypot(b.x - api.W / 2, b.y - api.H / 2) < Math.hypot(a.x - api.W / 2, a.y - api.H / 2) ? b : a));
      c0.owned = true; c0.flip = 1; owned[c0.key] = true;
      fleet = { x: c0.x, y: c0.y, tx: c0.x, ty: c0.y };
      target = null; phase = 'pick'; pt = 0; waves = 0;
      res = [0, 0, 0]; floats = [];
    }

    function neighbors(c) {
      const odd = c.r % 2;
      const deltas = odd ? [[1, 0], [-1, 0], [0, -1], [1, -1], [0, 1], [1, 1]] : [[1, 0], [-1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]];
      const out = [];
      for (const d of deltas) { const c2 = cells.find(x => x.q === c.q + d[0] && x.r === c.r + d[1]); if (c2) out.push(c2); }
      return out;
    }
    function frontier() {
      const set = [];
      for (const c of cells) { if (c.owned) continue; if (neighbors(c).some(n => n.owned)) set.push(c); }
      return set;
    }
    function hexPath(x, y, r) { ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 180 * (60 * i - 90); const px = x + r * Math.cos(a), py = y + r * Math.sin(a); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); }

    return {
      frame: function (dt, t) {
        const W = api.W, H = api.H;
        if (!cells || cells._w !== W) { build(); cells._w = W; }
        K.bg(api, { top: '#0e1630', mid: '#080d1e', bot: '#04060f', tint: 'rgba(80,150,255,0.10)', drift: 2 });

        // ---- phase machine ----
        pt += dt;
        if (phase === 'pick') {
          const f = frontier();
          if (!f.length || Object.keys(owned).length > cells.length * 0.6) { // reset when saturated
            cells.forEach(c => { c.owned = false; c.flip = 0; }); owned = {};
            const c0 = cells.reduce((a, b) => (Math.hypot(b.x - W / 2, b.y - H / 2) < Math.hypot(a.x - W / 2, a.y - H / 2) ? b : a));
            c0.owned = true; c0.flip = 1; owned[c0.key] = true; fleet.tx = c0.x; fleet.ty = c0.y;
          } else {
            // prefer a frontier hex near screen center for nicer framing
            f.sort((a, b) => Math.hypot(a.x - W / 2, a.y - H / 2) - Math.hypot(b.x - W / 2, b.y - H / 2));
            target = f[(Math.random() * Math.min(4, f.length)) | 0];
            fleet.tx = target.x; fleet.ty = target.y;
            phase = 'fly'; pt = 0;
          }
        } else if (phase === 'fly') {
          fleet.x = lerp(fleet.x, fleet.tx, clamp(dt * 4, 0, 1));
          fleet.y = lerp(fleet.y, fleet.ty, clamp(dt * 4, 0, 1));
          if (Math.hypot(fleet.x - fleet.tx, fleet.y - fleet.ty) < 2) { phase = 'siege'; pt = 0; waves = 0; }
        } else if (phase === 'siege') {
          waves = clamp(pt / 1.6 * 10, 0, 10);
          if (Math.random() < dt * 12 && target) P.burst(target.x + rnd(-hexR * 0.5, hexR * 0.5), target.y + rnd(-hexR * 0.5, hexR * 0.5), { n: 1, col: '#ffd24d', sp0: 10, sp1: 40, l0: 0.2, l1: 0.5, r0: 1, r1: 2 });
          if (pt > 1.6) {
            target.owned = true; owned[target.key] = true; target.flip = 0.001;
            P.ring(target.x, target.y, api.accent, hexR, 0.5);
            P.burst(target.x, target.y, { n: 14, col: api.accent, sp0: 40, sp1: 150, l0: 0.4, l1: 0.9, r0: 1.2, r1: 3 });
            for (let i = 0; i < 3; i++) { const amt = (i + 1) * (3 + Math.random() * 5); res[i] += amt; floats.push({ x: target.x, y: target.y, txt: RES[i][0] + '+' + (amt | 0), col: RES[i][1], life: 1.1, max: 1.1, off: i }); }
            phase = 'hold'; pt = 0;
          }
        } else if (phase === 'hold') {
          // passive resource trickle from all owned systems
          if (Math.random() < dt * 4) { const i = (Math.random() * 3) | 0; res[i] += Object.keys(owned).length * 0.4; }
          if (pt > 0.5) { phase = 'pick'; pt = 0; }
        }

        // ---- draw hexes ----
        for (const c of cells) {
          if (c.flip > 0 && c.flip < 1) c.flip = clamp(c.flip + dt * 2.2, 0, 1);
          const own = c.owned;
          hexPath(c.x, c.y, hexR - 1.5);
          if (own) {
            const k = c.flip;
            ctx.fillStyle = K.rgba(api.accent, 0.10 + 0.13 * k);
            ctx.fill();
            ctx.strokeStyle = K.rgba(api.accent, 0.45 + 0.35 * k); ctx.lineWidth = 1.4;
          } else {
            ctx.fillStyle = 'rgba(120,150,210,0.04)'; ctx.fill();
            ctx.strokeStyle = 'rgba(120,150,210,0.16)'; ctx.lineWidth = 1;
          }
          ctx.stroke();
          // core dot
          ctx.fillStyle = own ? K.rgba(api.accent, 0.7) : 'rgba(150,175,220,0.28)';
          ctx.beginPath(); ctx.arc(c.x, c.y, own ? 2.2 : 1.4, 0, TAU); ctx.fill();
        }

        // target highlight + siege ring
        if ((phase === 'siege') && target) {
          const pulse = 0.5 + 0.5 * Math.sin(t * 8);
          hexPath(target.x, target.y, hexR - 1.5); ctx.strokeStyle = K.rgba('#ffd24d', 0.5 + 0.4 * pulse); ctx.lineWidth = 2; ctx.stroke();
          // wave arc
          ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(target.x, target.y, hexR + 4, 0, TAU); ctx.stroke();
          ctx.strokeStyle = '#ffd24d'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(target.x, target.y, hexR + 4, -Math.PI / 2, -Math.PI / 2 + (waves / 10) * TAU); ctx.stroke(); ctx.lineCap = 'butt';
          K.text(ctx, 'WAVE ' + (Math.ceil(waves) || 1) + '/10', target.x, target.y - hexR - 9, { size: 8.5, col: '#ffe6a8', sw: 2.4 });
        }

        P.update(dt); P.draw(ctx);

        // fleet token
        const ang = Math.atan2(fleet.ty - fleet.y, fleet.tx - fleet.x) + Math.PI / 2;
        ctx.save(); ctx.translate(fleet.x, fleet.y); ctx.rotate(phase === 'fly' ? ang : Math.sin(t) * 0.15);
        K.ship(ctx, fleetImg, 0, 0, 26, t, { glow: api.accent });
        ctx.restore();

        // resource floats
        for (const f of floats) { f.life -= dt; f.y -= 26 * dt; ctx.globalAlpha = Math.max(0, f.life / f.max); K.text(ctx, f.txt, f.x + (f.off - 1) * 22, f.y, { size: 9.5, col: f.col, sw: 2.4 }); }
        ctx.globalAlpha = 1;
        for (let i = floats.length - 1; i >= 0; i--) if (floats[i].life <= 0) floats.splice(i, 1);

        // top resource readout (row, left-aligned)
        ctx.globalAlpha = 0.94;
        let rx = 14;
        for (let i = 0; i < 3; i++) { const s = RES[i][0] + ' ' + K.num(res[i]); K.text(ctx, s, rx, 18, { size: 10.5, col: RES[i][1], align: 'left', sw: 2.6, baseline: 'middle' }); rx += ctx.measureText(s).width + 14; }
        ctx.globalAlpha = 1;

        K.vignette(api, 0.5);
        api.setHud('pow', Object.keys(owned).length + ' SYS');
      },
    };
  };
})();
