/* =============================================================================
   sim-arena.js — configurable combat engine for Loot Fleet feature sims
   ---------------------------------------------------------------------------
   makeArena(api, cfg) returns { frame(dt,t), S } where S is live state. One
   battle-tested auto-combat core (lifted from the homepage showcase) is reused
   by nine feature scenes, each toggling behaviour through cfg + small hooks:
     cfg.ships[]     hull image keys (1 = solo, many = fleet formation)
     cfg.drones      orbiting drone count
     cfg.enemyRate   spawns/sec · cfg.enemyMax
     cfg.boss        boss hull key (descends with an integrity bar)
     cfg.fan         multi-shot fan width (special)
     cfg.deco(S)     per-frame overlay hook (HUD text, badges, dials)
     cfg.onKill(S,e) extra kill behaviour
     cfg.pow         starting hero-power readout
   ============================================================================= */
(function () {
  'use strict';
  const K = window.SimKit, TAU = K.TAU, rnd = K.rnd, clamp = K.clamp, lerp = K.lerp;
  const ECOL = K.ECOL;

  function makeArena(api, cfg) {
    cfg = cfg || {};
    const ctx = api.ctx;
    const shipKeys = cfg.ships || ['cruiser'];
    const heroImgs = shipKeys.map(k => K.img('ships/ship-' + k + '.png'));
    const bossImg = cfg.boss ? K.img('ships/ship-' + cfg.boss + '.png') : null;
    const P = K.particles(cfg.maxP || 280);

    const enemies = [], bolts = [], loot = [], floats = [], drones = [];
    const pl = { x: 0, y: 0, fire: 0, sweep: 0, hpFlash: 0, ring: 0 };
    const ND = cfg.drones || 0;
    for (let i = 0; i < ND; i++) drones.push({ a: (i / ND) * TAU, fire: rnd(0, 0.3) });
    // escort formation offsets (fleet) — flagship at index 0
    const escorts = [];
    if (shipKeys.length > 1) {
      const cols = [-1.7, 1.7, -3.1, 3.1];
      for (let i = 1; i < shipKeys.length; i++) escorts.push({ img: heroImgs[i], ox: cols[i - 1] || 0, oy: 1.0 + (i % 2) * 0.5, fire: rnd(0, 0.3) });
    }

    const S = {
      api, pl, enemies, bolts, loot, drones, P,
      pow: cfg.pow || 6e9, kills: 0, t: 0,
      dial: 1, zone: cfg.zone0 || 140, warp: 0, banner: 0, bannerTxt: '', bannerCol: '#ffd24d',
      boss: null, bossInteg: 1, bossT: 0, flash: 0,
      accent: cfg.accent || api.accent,
    };

    function spawnE() {
      if (enemies.length >= (cfg.enemyMax || 16)) return;
      const big = Math.random() < (cfg.bigChance != null ? cfg.bigChance : 0.14);
      const tint = cfg.enemyTint || ECOL[(Math.random() * ECOL.length) | 0];
      enemies.push({ x: rnd(api.W * 0.1, api.W * 0.9), y: rnd(-30, -6), r: big ? rnd(8, 10) : rnd(4.4, 7), col: tint, hp: big ? 3 : 2, flash: 0, sp: rnd(16, 34) * (cfg.enemySpeed || 1), wob: Math.random() * 6.28, big, ship: 'ships/ship-' + K.pickEnemyHull(big) + '.png' });
    }
    function nearest(x, y) { let b = null, bd = 1e9; for (const e of enemies) { if (e.dead) continue; const d = (e.x - x) ** 2 + (e.y - y) ** 2; if (d < bd) { bd = d; b = e; } } return b; }
    function dropLoot(x, y, minTier) {
      if (loot.length > 24) return;
      const r = Math.random();
      let tier = r < 0.34 ? 0 : r < 0.58 ? 1 : r < 0.76 ? 2 : r < 0.89 ? 3 : r < 0.97 ? 4 : 5;
      if (minTier) tier = Math.min(5, Math.max(tier, minTier));
      loot.push({ x, y, vx: rnd(-70, 70), vy: rnd(-150, -50), tier, born: 0, mag: false, bob: Math.random() * 6.28 });
    }
    function kill(e) {
      e.dead = true; S.kills++; S.pow += rnd(3e10, 1.2e11);
      P.burst(e.x, e.y, { n: 7 + (e.r | 0), col: e.col, sp0: 40, sp1: 170, l0: 0.4, l1: 0.8, r0: 1.2, r1: 3 });
      P.ring(e.x, e.y, '#fff', e.r, 0.3);
      if (Math.random() < (cfg.lootChance != null ? cfg.lootChance : 0.5) || e.big) dropLoot(e.x, e.y, e.big ? 2 : 0);
      if (cfg.onKill) cfg.onKill(S, e);
    }
    function fan(x, y, tx, ty, n, col, sp) {
      const base = Math.atan2(ty - y, tx - x);
      for (let i = 0; i < n; i++) { const a = base + (i - (n - 1) / 2) * 0.26; bolts.push({ x, y, vx: Math.cos(a) * (sp || 360), vy: Math.sin(a) * (sp || 360), crit: Math.random() < 0.3, col }); }
    }
    S.spawnE = spawnE; S.nearest = nearest; S.dropLoot = dropLoot; S.kill = kill; S.fan = fan;
    S.banners = function (txt, col) { S.banner = 1.6; S.bannerTxt = txt; S.bannerCol = col || '#ffd24d'; S.flash = Math.max(S.flash, 0.5); };

    let spawnT = 0;
    return {
      S,
      frame: function (dt, t) {
        const W = api.W, H = api.H; S.t = t;
        pl.x = W / 2; pl.y = H * 0.8;
        K.bg(api, cfg.bg || { tint: K.rgba(S.accent, 0.10) });

        // ---- boss lifecycle ----
        if (cfg.boss) {
          if (!S.boss) { S.boss = { y: -H * 0.3, x: W / 2 }; S.bossInteg = 1; S.bossT = 0; }
          S.bossT += dt;
          S.boss.x = W / 2 + Math.sin(t * 0.5) * W * 0.08;
          S.boss.y = lerp(S.boss.y, H * 0.26, clamp(dt * 1.5, 0, 1));
          S.bossInteg = Math.max(0, 1 - S.bossT / 6.5);
          if (S.bossInteg <= 0) {
            S.flash = 1; P.burst(S.boss.x, S.boss.y, { n: 50, col: '#ffd24d', sp0: 80, sp1: 380, l0: 0.5, l1: 1.3, r0: 1.4, r1: 3.6 });
            P.ring(S.boss.x, S.boss.y, '#fff', 26, 0.6);
            for (let i = 0; i < 16; i++) dropLoot(S.boss.x + rnd(-40, 40), S.boss.y + rnd(-10, 30), 3);
            if (cfg.onBoss) cfg.onBoss(S);
            S.boss = null; S.bossT = 0;
          }
        }

        // ---- spawn ----
        spawnT -= dt;
        if (spawnT <= 0) { spawnT = 1 / (cfg.enemyRate || 4); spawnE(); if (Math.random() < 0.4) spawnE(); }

        // ---- enemies ----
        for (const e of enemies) {
          if (e.flash > 0) e.flash -= dt * 5;
          const dx = pl.x - e.x, dy = pl.y - e.y, d = Math.hypot(dx, dy) || 1;
          e.x += (dx / d) * e.sp * dt + Math.cos(t * 2 + e.wob) * 8 * dt; e.y += (dy / d) * e.sp * dt;
          K.enemyShip(ctx, e.ship, e.col, e.x, e.y, e.r * 3.2, Math.atan2(dy, dx) + Math.PI / 2, e.flash > 0);
          if (cfg.reticle) { ctx.strokeStyle = K.rgba(S.accent, 0.4); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 6 + Math.sin(t * 4 + e.wob) * 1.5, 0, TAU); ctx.stroke(); }
        }

        // ---- hero + escorts fire ----
        pl.fire -= dt;
        const fireGap = (cfg.fireGap || 0.11) / (cfg.dial ? S.dial : 1);
        if (pl.fire <= 0) {
          pl.fire = fireGap;
          const lanes = cfg.lanes || 3;
          for (let s = 0; s < lanes; s++) {
            const tg = nearest(pl.x + (s - (lanes - 1) / 2) * 26, pl.y);
            if (tg) {
              if (cfg.fan) fan(pl.x, pl.y - 10, tg.x, tg.y, cfg.fan, '#ffd24d', 380);
              else { const a = Math.atan2(tg.y - pl.y, tg.x - pl.x), crit = Math.random() < 0.3; bolts.push({ x: pl.x + (s - (lanes - 1) / 2) * 8, y: pl.y - 10, vx: Math.cos(a) * 380, vy: Math.sin(a) * 380, crit }); }
            }
            if (cfg.boss && S.boss && Math.random() < 0.5) { const a = Math.atan2(S.boss.y - pl.y, S.boss.x - pl.x); bolts.push({ x: pl.x, y: pl.y - 10, vx: Math.cos(a) * 400, vy: Math.sin(a) * 400, crit: Math.random() < 0.4, atBoss: true }); }
          }
          // escorts shoot too
          for (const es of escorts) { const ex = pl.x + es.ox * 18, ey = pl.y + es.oy * 16; const tg = nearest(ex, ey); if (tg) { const a = Math.atan2(tg.y - ey, tg.x - ex); bolts.push({ x: ex, y: ey, vx: Math.cos(a) * 340, vy: Math.sin(a) * 340, crit: false, esc: true }); } }
        }

        // ---- drones ----
        for (const dr of drones) {
          dr.a += dt * 1.1; const dx = pl.x + Math.cos(dr.a) * 34, dy = pl.y + Math.sin(dr.a) * 30;
          dr.fire -= dt;
          if (dr.fire <= 0) { dr.fire = 0.34; const tg = nearest(dx, dy); if (tg) { const a = Math.atan2(tg.y - dy, tg.x - dx); bolts.push({ x: dx, y: dy, vx: Math.cos(a) * 320, vy: Math.sin(a) * 320, drone: true }); } }
          ctx.globalAlpha = 0.4; ctx.fillStyle = '#7fffcb'; ctx.beginPath(); ctx.arc(dx, dy, 5.5, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
          ctx.save(); ctx.translate(dx, dy); ctx.rotate(dr.a * 0.5); ctx.fillStyle = '#2b3744'; ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(3.2, 3.4); ctx.lineTo(-3.2, 3.4); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#7fffcb'; ctx.beginPath(); ctx.arc(0, -0.5, 1.4, 0, TAU); ctx.fill(); ctx.restore();
        }

        // ---- bolts ----
        for (const b of bolts) {
          b.x += b.vx * dt; b.y += b.vy * dt; b.life = (b.life || 1.5) - dt;
          if (b.atBoss && S.boss) { if (Math.abs(b.x - S.boss.x) < 26 && Math.abs(b.y - S.boss.y) < 26) { b.dead = true; P.burst(b.x, b.y, { n: 3, col: '#ffd9a0', sp0: 20, sp1: 80, l0: 0.2, l1: 0.4, r0: 1, r1: 2 }); continue; } }
          for (const e of enemies) { if (e.dead) continue; if (Math.abs(e.x - b.x) < e.r + 3 && Math.abs(e.y - b.y) < e.r + 3) { b.dead = true; e.flash = 1; e.hp--; if (e.hp <= 0) kill(e); break; } }
          const col = b.col || (b.crit ? '#ffd24d' : b.drone ? '#7fffcb' : b.esc ? '#bfe6ff' : '#bfe6ff');
          ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 6;
          ctx.beginPath(); ctx.arc(b.x, b.y, b.crit ? 2.6 : b.drone || b.esc ? 1.6 : 2, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
        }

        // ---- loot ----
        for (const L of loot) {
          L.born += dt; L.bob += dt * 3;
          if (!L.mag && L.born > 0.42) L.mag = true;
          if (L.mag) {
            const dx = pl.x - L.x, dy = pl.y - L.y, d = Math.hypot(dx, dy) || 1, pull = 90 + (1 - Math.min(1, d / 200)) * 380;
            L.x += (dx / d) * pull * dt; L.y += (dy / d) * pull * dt;
            ctx.strokeStyle = K.rgba(K.RAR[L.tier][1], 0.2); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L.x, L.y); ctx.lineTo(L.x + dx * 0.3, L.y + dy * 0.3); ctx.stroke();
            if (d < 16) { L.dead = true; S.pow += (L.tier + 1) * 5e10; if (L.tier >= 3) { floats.push({ x: pl.x + rnd(-8, 8), y: pl.y - 14, txt: K.RAR[L.tier][0], col: K.RAR[L.tier][1], life: 0.8, max: 0.8 }); } }
          } else { L.x += L.vx * dt; L.y += L.vy * dt; L.vy += 120 * dt; }
          K.gem(ctx, L.x, L.y + Math.sin(L.bob) * 1.5, L.tier, t);
        }

        P.update(dt); P.draw(ctx);

        // ---- boss draw ----
        if (cfg.boss && S.boss && bossImg) {
          const bw = Math.min(W * 0.5, 150), bh = bw * (bossImg.naturalHeight ? bossImg.naturalHeight / bossImg.naturalWidth : 1);
          const integ = S.bossInteg, burning = integ < 0.6, crit = integ < 0.28;
          const jx = crit ? Math.sin(t * 40) * 2 : 0;
          const ag = ctx.createRadialGradient(S.boss.x, S.boss.y, bw * 0.1, S.boss.x, S.boss.y, bw * 0.6);
          const acol = crit ? '255,42,74' : burning ? '255,130,60' : '120,170,255';
          ag.addColorStop(0, 'rgba(' + acol + ',0.3)'); ag.addColorStop(1, 'rgba(' + acol + ',0)');
          ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(S.boss.x, S.boss.y, bw * 0.6, 0, TAU); ctx.fill();
          if (bossImg.complete && bossImg.naturalWidth) ctx.drawImage(bossImg, S.boss.x - bw / 2 + jx, S.boss.y - bh / 2, bw, bh);
          // integrity bar
          const barW = Math.min(bw, 130), bx = S.boss.x - barW / 2, by = S.boss.y - bh / 2 - 12;
          ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bx - 2, by - 2, barW + 4, 9);
          ctx.fillStyle = '#3a0e12'; ctx.fillRect(bx, by, barW, 5);
          ctx.fillStyle = crit ? '#ff2a4a' : burning ? '#ff9a50' : '#5fd1ff'; ctx.fillRect(bx, by, barW * integ, 5);
          K.text(ctx, (cfg.bossName || 'ZONE BOSS') + (crit ? ' · CRITICAL' : burning ? ' · BURNING' : ''), S.boss.x, by - 5, { size: 8.5, col: '#ffd9c4', sw: 2.4 });
        }

        // ---- hero(es) ----
        for (const es of escorts) { const ex = pl.x + es.ox * 18, ey = pl.y + es.oy * 16; K.ship(ctx, es.img, ex, ey, 30, t, { glow: S.accent }); }
        ctx.save();
        if (pl.hpFlash > 0) { pl.hpFlash -= dt * 2; ctx.shadowColor = '#46d27a'; ctx.shadowBlur = 18 * pl.hpFlash; }
        K.ship(ctx, heroImgs[0], pl.x, pl.y + Math.sin(t * 1.6) * 2, cfg.shipSize || 50, t, { glow: S.accent, thruster: true });
        ctx.restore();
        if ((Math.sin(t * 40) + 1) / 2 > 0.45) { ctx.fillStyle = '#ffe6a0'; ctx.shadowColor = '#ffb43c'; ctx.shadowBlur = 10; for (const gx of [-10, 0, 10]) { ctx.beginPath(); ctx.arc(pl.x + gx, pl.y - 18, 2.4, 0, TAU); ctx.fill(); } ctx.shadowBlur = 0; }

        // ---- floats ----
        for (const f of floats) { f.life -= dt * 1.5; f.y -= 30 * dt; ctx.globalAlpha = Math.max(0, f.life / f.max); K.text(ctx, f.txt, f.x, f.y, { size: 10, col: f.col, sw: 2.4 }); }
        ctx.globalAlpha = 1;
        S.floats = floats;

        // ---- deco hook (per-feature overlay) ----
        if (cfg.deco) cfg.deco(S, dt, t);

        // ---- banner ----
        if (S.banner > 0) { S.banner -= dt; const k = clamp((1.6 - S.banner) * 4, 0, 1); ctx.globalAlpha = Math.min(1, S.banner * 1.4); K.text(ctx, S.bannerTxt, W / 2, H * 0.3 - (1 - k) * 6, { size: 16, col: S.bannerCol, sw: 4 }); ctx.globalAlpha = 1; }
        if (S.flash > 0) { S.flash -= dt * 1.8; ctx.globalAlpha = Math.min(1, S.flash) * 0.7; ctx.fillStyle = '#fff4da'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }

        K.vignette(api, 0.48);
        if (cfg.hud) api.setHud('pow', cfg.hud(S)); else api.setHud('pow', K.num(S.pow));

        // ---- cull ----
        for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].dead || enemies[i].y > H + 30) enemies.splice(i, 1);
        for (let i = bolts.length - 1; i >= 0; i--) { const b = bolts[i]; if (b.dead || b.life <= 0 || b.x < -20 || b.x > W + 20 || b.y < -30 || b.y > H + 20) bolts.splice(i, 1); }
        for (let i = loot.length - 1; i >= 0; i--) if (loot[i].dead) loot.splice(i, 1);
        for (let i = floats.length - 1; i >= 0; i--) if (floats[i].life <= 0) floats.splice(i, 1);
      },
    };
  }
  window.LF_makeArena = makeArena;

  const S = window.LF_SCENES;

  // 2 · AUTO-BATTLE — hands-free combat, targeting reticles + AUTO badge
  S.autobattle = function (api) {
    return makeArena(api, {
      ships: ['cruiser'], accent: '#5fd1ff', enemyRate: 5, reticle: true, pow: 4.2e9,
      bg: { tint: 'rgba(95,160,255,0.10)' },
      deco: function (Sx, dt, t) {
        const W = api.W, H = api.H, pulse = 0.5 + 0.5 * Math.sin(t * 3);
        api.ctx.globalAlpha = 0.85;
        K.text(api.ctx, '\u25c9 AUTOPILOT', W / 2, 18, { size: 10, col: K.rgba('#5fd1ff', 0.6 + 0.4 * pulse), sw: 2.4, baseline: 'middle' });
        api.ctx.globalAlpha = 1;
        K.text(api.ctx, 'HANDS-FREE', W / 2, H * 0.93, { size: 9, col: '#8fb6d6', sw: 2.2 });
      },
    });
  };

  // 8 · SPEED CONTROLS — dial ramps 1×→10× with motion streaks
  S.speed = function (api) {
    const a = makeArena(api, {
      ships: ['destroyer'], accent: '#ff5168', enemyRate: 6, dial: true, fireGap: 0.12, pow: 9e9,
      bg: { tint: 'rgba(255,90,120,0.10)' },
      hud: function (Sx) { return Sx.dial.toFixed(0) + '\u00d7'; },
      deco: function (Sx, dt, t) {
        // ramp the dial up then snap-reset
        Sx._rt = (Sx._rt || 0) + dt;
        const cyc = Sx._rt % 9;
        const steps = [1, 2, 3, 5, 10];
        const target = steps[Math.min(4, Math.floor(cyc / 1.7))];
        if (target > Sx.dial) { Sx.dial = target; if (target === 10) Sx.banners('10\u00d7 SECRET SPEED', '#ffd24d'); }
        if (cyc < dt) Sx.dial = 1;
        const W = api.W, H = api.H, ctx = api.ctx;
        // motion streaks intensify with dial
        ctx.globalAlpha = 0.12 + Sx.dial * 0.02; ctx.strokeStyle = '#bfe6ff';
        for (let i = 0; i < Sx.dial * 3; i++) { const x = (i * 47 + t * 400 * Sx.dial) % W, y = (i * 83) % H; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 8 + Sx.dial * 2); ctx.stroke(); }
        ctx.globalAlpha = 1;
        // dial readout
        K.text(ctx, 'SIM SPEED ' + Sx.dial.toFixed(0) + '\u00d7', W / 2, H * 0.93, { size: 11, col: Sx.dial >= 10 ? '#ffd24d' : '#ffd0d8', sw: 2.6, font: 'Orbitron, Rajdhani, sans-serif' });
      },
    });
    return a;
  };

  // 10 · DRONE SWARMS — carrier + orbiting drones
  S.drones = function (api) {
    return makeArena(api, {
      ships: ['carrier'], drones: 6, accent: '#7fffcb', enemyRate: 5, shipSize: 54, pow: 2.1e10,
      bg: { tint: 'rgba(70,210,160,0.10)' },
      deco: function (Sx, dt, t) { const W = api.W, H = api.H; K.text(api.ctx, '\u25c8 DRONE BAY 6 / 6', W / 2, H * 0.93, { size: 10, col: '#7fffcb', sw: 2.4 }); },
    });
  };

  // 11 · INFINITE ZONES — endless warp, zone counter climbs
  S.zones = function (api) {
    return makeArena(api, {
      ships: ['battleship'], accent: '#b87bff', enemyRate: 5, pow: 7e9, zone0: 142,
      bg: { top: '#16142e', mid: '#0c0a1e', tint: 'rgba(150,90,255,0.12)' },
      hud: function (Sx) { return 'Z' + Sx.zone; },
      onKill: function (Sx) { Sx._k = (Sx._k || 0) + 1; },
      deco: function (Sx, dt, t) {
        const W = api.W, H = api.H, ctx = api.ctx;
        Sx._wt = (Sx._wt || 0) + dt;
        if (Sx._wt > 3.4) { Sx._wt = 0; Sx.zone++; Sx.warp = 1; Sx.banners('ZONE ' + Sx.zone + ' \u2192', '#c89bff'); Sx.enemyTint = ['#7fe0ff', '#ff8a5c', '#c89bff', '#74e0a8'][Sx.zone % 4]; }
        if (Sx.warp > 0) { Sx.warp -= dt * 0.8; ctx.save(); ctx.globalAlpha = Sx.warp * 0.5; ctx.strokeStyle = '#cfe8ff'; ctx.lineWidth = 1; for (let i = 0; i < 18; i++) { const a = (i / 18) * TAU, r1 = 30 + (1 - Sx.warp) * 120, r2 = r1 + 40; ctx.beginPath(); ctx.moveTo(W / 2 + Math.cos(a) * r1, H / 2 + Math.sin(a) * r1); ctx.lineTo(W / 2 + Math.cos(a) * r2, H / 2 + Math.sin(a) * r2); ctx.stroke(); } ctx.restore(); }
        K.text(ctx, 'ZONE ' + Sx.zone + '  \u00b7  \u221e', W / 2, H * 0.93, { size: 11, col: '#d6c2ff', sw: 2.6, font: 'Orbitron, Rajdhani, sans-serif' });
      },
    });
  };

  // 13 · SPECIAL DROPS — life-steal heals + multi-shot fans
  S.special = function (api) {
    return makeArena(api, {
      ships: ['heavycruiser'], accent: '#46d27a', enemyRate: 5, pow: 6e9,
      bg: { tint: 'rgba(70,210,122,0.10)' },
      onKill: function (Sx, e) {
        if (Math.random() < 0.16) { Sx.pl.hpFlash = 1; Sx.floats.push({ x: Sx.pl.x + rnd(-10, 10), y: Sx.pl.y - 18, txt: '\u2665 LIFE STEAL', col: '#46d27a', life: 0.9, max: 0.9 }); }
        if (Math.random() < 0.12) { Sx.fan(Sx.pl.x, Sx.pl.y - 10, e.x, e.y - 20, 5, '#ffd24d', 360); Sx.floats.push({ x: Sx.pl.x, y: Sx.pl.y - 30, txt: 'MULTI-SHOT \u00d75', col: '#ffd24d', life: 0.9, max: 0.9 }); }
      },
      deco: function (Sx, dt, t) { const W = api.W, H = api.H; K.text(api.ctx, 'RARE AFFIXES', W / 2, H * 0.93, { size: 10, col: '#9fe6bf', sw: 2.4 }); },
    });
  };

  // 15 · 5-SHIP FLEET — flagship + 4 escorts in formation
  S.fleet = function (api) {
    return makeArena(api, {
      ships: ['titan', 'destroyer', 'cruiser', 'interceptor', 'frigate'], accent: '#5fb0ff', enemyRate: 6, shipSize: 52, pow: 8e10,
      bg: { tint: 'rgba(95,176,255,0.10)' },
      deco: function (Sx, dt, t) { const W = api.W, H = api.H; K.text(api.ctx, '\u25c6 5-SHIP FLEET', W / 2, H * 0.93, { size: 10, col: '#bfe0ff', sw: 2.4 }); },
    });
  };

  // 7 · BOSS BATTLES — boss descends, integrity burns, blueprint drops
  S.boss = function (api) {
    return makeArena(api, {
      ships: ['dreadnought'], accent: '#ffa838', enemyRate: 2.4, enemyMax: 8, boss: 'citadel', bossName: '\u26f4 VOID CITADEL', pow: 1.2e10, shipSize: 52,
      bg: { top: '#1a0f2e', mid: '#10081c', tint: 'rgba(190,70,200,0.12)' },
      onBoss: function (Sx) { Sx.banners('\u2605 BLUEPRINT SECURED', '#ffd24d'); },
      deco: function (Sx, dt, t) { const W = api.W, H = api.H; K.text(api.ctx, 'BOSS \u00b7 DROPS A HULL BLUEPRINT', W / 2, H * 0.94, { size: 9, col: '#ffd9a8', sw: 2.2 }); },
    });
  };

  // 23 · THE MOTHERSHIP — 7 weapons, 12 drones, screen-filling firepower
  S.mothership = function (api) {
    return makeArena(api, {
      ships: ['mothership'], drones: 10, accent: '#ffd24d', enemyRate: 8, enemyMax: 22, lanes: 7, shipSize: 64, fireGap: 0.09, pow: 6.4e13, maxP: 360,
      bg: { top: '#1a1330', mid: '#0d0920', tint: 'rgba(255,210,77,0.12)' },
      deco: function (Sx, dt, t) { const W = api.W, H = api.H, pulse = 0.5 + 0.5 * Math.sin(t * 2.5); api.ctx.globalAlpha = 0.9; K.text(api.ctx, '\u2756 MOTHERSHIP', W / 2, H * 0.93, { size: 11, col: K.rgba('#ffd24d', 0.7 + 0.3 * pulse), sw: 2.6, font: 'Orbitron, Rajdhani, sans-serif' }); api.ctx.globalAlpha = 1; },
    });
  };

  // 18 · HERO POWER — combat with a live stat readout climbing
  S.power = function (api) {
    return makeArena(api, {
      ships: ['battleship'], accent: '#f2b24b', enemyRate: 5, pow: 1.57e3,
      bg: { tint: 'rgba(242,178,75,0.10)' },
      onKill: function (Sx) { Sx.pow = Sx.pow * 1.012 + 40; },
      deco: function (Sx, dt, t) {
        const W = api.W, H = api.H, ctx = api.ctx;
        const stats = [['DMG', '#ff8a5c'], ['RATE', '#7fe0ff'], ['CRIT', '#ffd24d'], ['HP', '#74e0a8']];
        const bx = 12, bw = W - 24, y0 = H * 0.62;
        ctx.globalAlpha = 0.9;
        for (let i = 0; i < stats.length; i++) {
          const yy = y0 + i * 13;
          const frac = 0.4 + 0.5 * (0.5 + 0.5 * Math.sin(t * 1.2 + i));
          K.text(ctx, stats[i][0], bx, yy, { size: 8.5, col: stats[i][1], align: 'left', sw: 2, baseline: 'middle' });
          ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(bx + 34, yy - 3, bw - 70, 5);
          ctx.fillStyle = stats[i][1]; ctx.fillRect(bx + 34, yy - 3, (bw - 70) * frac, 5);
        }
        ctx.globalAlpha = 1;
        K.text(ctx, 'HERO POWER CLIMBING', W / 2, H * 0.93, { size: 9.5, col: '#ffe1ab', sw: 2.2 });
      },
    });
  };
})();
