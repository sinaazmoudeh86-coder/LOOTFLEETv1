/* =============================================================================
   showcase.js — Loot Fleet homepage attract battle: THE CITADEL SIEGE LOOP
   ---------------------------------------------------------------------------
   A complete story on repeat, driving the phone-mockup canvas (#heroCanvas):
     1. SWARM   — bullet-hell mob clearing, loot + drones + big crits
     2. SIEGE   — the VOID CITADEL (real game art) descends; burn it through
                  its damage states (burning → breaking → critical)
     3. NOVA    — supernova kill: white flash + a fountain of high-tier loot
                  magnet-vacuumed into the ship
     4. UPGRADE — the hero ship visibly upgrades to the next hull, power leaps
   …then the war resumes with the bigger ship. Self-contained; no game engine.
   ============================================================================= */
(function () {
  'use strict';
  const cv = document.getElementById('heroCanvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let W = 0, H = 0;
  function size() { const r = cv.getBoundingClientRect(); if (!r.width) return; W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  size(); window.addEventListener('resize', size);

  // hull upgrade ladder — the ship gets visibly stronger every loop
  const HULLS = [
    ['cruiser', 'CRUISER'], ['battleship', 'BATTLESHIP'], ['dreadnought', 'DREADNOUGHT'],
    ['carrier', 'CARRIER'], ['supercarrier', 'SUPER CARRIER'], ['titan', 'TITAN CARRIER'], ['mothership', 'MOTHERSHIP'],
  ];
  let hullIdx = 0;
  const ship = new Image(); ship.src = 'ships/ship-' + HULLS[0][0] + '.png';
  const citImg = new Image(); citImg.src = 'ships/ship-citadel.png';

  const RAR = [
    ['Common', '#9aa7b8', 0], ['Uncommon', '#46d27a', 1], ['Rare', '#4fa6ff', 2],
    ['Epic', '#b87bff', 3], ['Legendary', '#ffa838', 4], ['Mythic', '#ff5168', 5],
  ];
  const ECOL = ['#7fe0ff', '#ff8a5c', '#c89bff', '#74e0a8', '#ff6f9c', '#ffd24d'];
  const rnd = (a, b) => a + Math.random() * (b - a);
  function num(n) { if (n > 999e12) n = 999e12; if (n < 1000) return n | 0; const u = ['', 'K', 'M', 'B', 'T']; let i = 0, v = n; while (v >= 1000 && i < 4) { v /= 1000; i++; } return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + u[i]; }

  const enemies = [], bolts = [], parts = [], floats = [], loot = [], picks = [];
  const drones = []; const NDRONES = 7;
  for (let i = 0; i < NDRONES; i++) drones.push({ a: (i / NDRONES) * Math.PI * 2, r: 0, fire: rnd(0, 0.3) });
  const pl = { x: 0, y: 0, fire: 0, sweep: 0, ringT: 0 };
  let t = 0, pow = 8.4e12, started = false;
  const MAXE = 90, MAXB = 150, MAXP = 280, MAXL = 44, MAXF = 26;

  // ---- the siege story machine ----
  // swarm 6s → siege (citadel descends + burns) 10s → nova 1.5s → upgrade 3s
  const cit = { phase: 'swarm', pt: 0, hp: 1, y: 0, fire: 0, flash: 0, banner: 0 };
  function phase(name) { cit.phase = name; cit.pt = 0; }

  function spawnEnemy(yBand) {
    if (enemies.length >= MAXE) return;
    const edge = Math.random();
    let x, y;
    if (edge < 0.5) { x = rnd(0, W); y = rnd(-30, H * (yBand || 0.34)); }
    else if (edge < 0.75) { x = rnd(-26, 8); y = rnd(0, H); }
    else { x = rnd(W - 8, W + 26); y = rnd(0, H); }
    const big = Math.random() < 0.12;
    enemies.push({ x, y, r: big ? rnd(8, 11) : rnd(4.2, 7), col: ECOL[(Math.random() * ECOL.length) | 0], hp: big ? 3 : 2, flash: 0, sp: rnd(14, 30), wob: rnd(0, 6.28) });
  }
  function dropLoot(x, y, minTier) {
    if (loot.length >= MAXL) return;
    const r = Math.random();
    let tier = r < 0.30 ? 0 : r < 0.54 ? 1 : r < 0.73 ? 2 : r < 0.87 ? 3 : r < 0.96 ? 4 : 5;
    if (minTier) tier = Math.max(tier, minTier + (Math.random() < 0.4 ? 1 : 0)) % 6;
    loot.push({ x, y, vx: rnd(-60, 60), vy: rnd(-120, -30), tier: Math.min(5, tier), born: 0, mag: false, bob: rnd(0, 6.28) });
  }
  function killEnemy(e) {
    e.dead = true; pow += rnd(2e10, 9e10);
    const n = 8 + (e.r | 0);
    for (let i = 0; i < n && parts.length < MAXP; i++) { const a = Math.random() * 7, sp = rnd(40, 170); parts.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.4, 0.8), max: 0.8, col: e.col, r: rnd(1.2, 3) }); }
    parts.push({ ring: true, x: e.x, y: e.y, life: 0.32, max: 0.32, col: '#fff', r: e.r });
    if (Math.random() < 0.55) dropLoot(e.x, e.y);
    if (Math.random() < 0.14) picks.push({ x: e.x, y: e.y, g: ['\u2b22', '\u25c6', '\u2726'][(Math.random() * 3) | 0], c: ['#5bc0ff', '#d0a060', '#c07bff'][(Math.random() * 3) | 0], life: 1.1, max: 1.1 });
  }
  function nearest(x, y, maxd) {
    let b = null, bd = maxd * maxd;
    for (const e of enemies) { if (e.dead) continue; const d = (e.x - x) ** 2 + (e.y - y) ** 2; if (d < bd) { bd = d; b = e; } }
    return b;
  }
  function fireBolt(x, y, tx, ty, opt) {
    if (bolts.length >= MAXB) return;
    const a = Math.atan2(ty - y, tx - x), sp = opt.sp || 380;
    bolts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, crit: !!opt.crit, drone: !!opt.drone, boss: !!opt.boss, cit: !!opt.cit, life: 1.4 });
  }
  function dmgFloat(x, y, crit) {
    if (floats.length >= MAXF) return;
    if (!crit && Math.random() < 0.5) return;
    const base = crit ? rnd(4e9, 2.2e10) : rnd(6e8, 5e9);
    floats.push({ x, y, txt: num(base), col: crit ? '#ffd24d' : '#fff1c2', crit, life: 1, max: 1, size: crit ? 22 : 14 });
  }

  // citadel geometry for the current frame
  function citRect() {
    const dw = Math.min(W * 0.78, 340), dh = dw * (citImg.naturalHeight ? citImg.naturalHeight / citImg.naturalWidth : 0.86);
    return { dw, dh, x: W / 2 + Math.sin(t * 0.4) * W * 0.05, y: cit.y };
  }

  let last = performance.now();
  function loop(now) {
    if (!W) { size(); queueFrame(); return; }
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    cit.pt += dt;
    pl.x = W / 2; pl.y = H * 0.74;

    // ---- background ----
    const g = ctx.createRadialGradient(W / 2, H * 0.42, 10, W / 2, H * 0.5, Math.max(W, H) * 0.9);
    g.addColorStop(0, '#1a0f2e'); g.addColorStop(0.55, '#10081c'); g.addColorStop(1, '#05030a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.5;
    const ng = ctx.createRadialGradient(W * 0.3, H * 0.3, 8, W * 0.3, H * 0.3, W * 0.6);
    ng.addColorStop(0, 'rgba(190,70,200,0.10)'); ng.addColorStop(1, 'rgba(190,70,200,0)');
    ctx.fillStyle = ng; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    ctx.fillStyle = '#e7d9ff';
    for (let i = 0; i < 60; i++) { const sx = (i * 53.7 % W), sy = ((i * 97.3 + t * 6 * (1 + (i % 3))) % H); ctx.globalAlpha = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t * 2 + i)); ctx.fillRect(sx, sy, i % 5 ? 1 : 1.6, i % 5 ? 1 : 1.6); }
    ctx.globalAlpha = 1;
    // ringed planet vista
    {
      const px2 = W * 0.86, py2 = H * 0.07, R = 26;
      const pg2 = ctx.createRadialGradient(px2 - R * 0.4, py2 - R * 0.4, 2, px2, py2, R * 1.2);
      pg2.addColorStop(0, '#b9a0ff'); pg2.addColorStop(0.55, '#5b3fa0'); pg2.addColorStop(1, '#190a30');
      ctx.fillStyle = pg2; ctx.beginPath(); ctx.arc(px2, py2, R, 0, 7); ctx.fill();
      ctx.save(); ctx.translate(px2, py2); ctx.rotate(-0.4); ctx.scale(1, 0.32);
      ctx.strokeStyle = 'rgba(196,150,255,0.45)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, R * 1.55, 0, 7); ctx.stroke(); ctx.restore();
    }

    // ---- PHASE MACHINE ----
    const R2 = citRect();
    if (cit.phase === 'swarm') {
      cit.y += ((-R2.dh * 0.85) - cit.y) * Math.min(1, dt * 2);          // parked fully above
      if (enemies.length < MAXE && Math.random() < dt * 30) { spawnEnemy(); spawnEnemy(); }
      if (cit.pt > 6) phase('siege');
    } else if (cit.phase === 'siege') {
      cit.y += ((R2.dh * 0.34) - cit.y) * Math.min(1, dt * 1.6);         // descend into view
      cit.hp = Math.max(0, 1 - cit.pt / 10);                             // the burn-down arc
      if (enemies.length < 30 && Math.random() < dt * 10) spawnEnemy(0.5);
      cit.fire -= dt;
      if (cit.fire <= 0 && cit.pt > 1.2) { cit.fire = 0.8; for (let k = -1; k <= 1; k++) fireBolt(R2.x + k * 30, cit.y + R2.dh * 0.3, pl.x + k * 60, pl.y, { cit: true, sp: 140 }); }
      if (cit.hp <= 0) {
        // SUPERNOVA
        cit.flash = 1;
        for (let i = 0; i < 70; i++) { const a = Math.random() * 7, sp = rnd(80, 480); parts.push({ x: R2.x, y: cit.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.5, 1.3), max: 1.3, col: i % 3 ? '#ffd24d' : '#fff3d0', r: rnd(1.5, 4) }); }
        parts.push({ ring: true, x: R2.x, y: cit.y, life: 0.6, max: 0.6, col: '#fff', r: 30 });
        for (let i = 0; i < 26; i++) dropLoot(R2.x + rnd(-R2.dw * 0.3, R2.dw * 0.3), cit.y + rnd(-20, 40), 3);
        for (const e of enemies) killEnemy(e);                           // the blast clears the field
        phase('nova');
      }
    } else if (cit.phase === 'nova') {
      cit.y += ((-R2.dh) - cit.y) * Math.min(1, dt * 0.8);               // wreck drifts away
      if (cit.pt > 1.5) { phase('upgrade'); hullIdx = (hullIdx + 1) % HULLS.length; ship.src = 'ships/ship-' + HULLS[hullIdx][0] + '.png'; pow *= 2.3; pl.ringT = 1; cit.banner = 3; }
    } else { // upgrade
      if (cit.pt > 3) { cit.hp = 1; phase('swarm'); }
    }
    if (cit.flash > 0) cit.flash -= dt * 1.6;
    if (pl.ringT > 0) pl.ringT -= dt * 0.6;
    if (cit.banner > 0) cit.banner -= dt;

    // ---- citadel (visible during siege/nova) ----
    if (cit.y > -R2.dh * 0.9 && citImg.complete && citImg.naturalWidth) drawCitadel(R2);

    // ---- enemies ----
    for (const e of enemies) {
      if (e.flash > 0) e.flash -= dt * 5;
      const dx = pl.x - e.x, dy = pl.y - e.y, d = Math.hypot(dx, dy) || 1;
      e.x += (dx / d) * e.sp * dt + Math.cos(t * 2 + e.wob) * 8 * dt;
      e.y += (dy / d) * e.sp * dt;
      drawEnemy(e);
    }

    // ---- player fire ----
    pl.fire -= dt;
    if (pl.fire <= 0) {
      pl.fire = 0.1;
      for (let s = 0; s < 3; s++) {
        const tg = nearest(pl.x + (s - 1) * 30, pl.y, 999);
        if (tg) fireBolt(pl.x + (s - 1) * 8, pl.y - 10, tg.x, tg.y, { crit: Math.random() < 0.3 });
      }
      if (cit.phase === 'siege' && cit.y > 0) fireBolt(pl.x, pl.y - 12, R2.x + rnd(-40, 40), cit.y + rnd(-10, 30), { crit: Math.random() < 0.4, boss: false });
      pl.sweep += 0.7;
      if (cit.phase !== 'siege') fireBolt(pl.x, pl.y - 6, pl.x + Math.cos(pl.sweep) * 200, pl.y - 40 + Math.sin(pl.sweep) * 80, {});
    }

    // ---- drones ----
    for (const dr of drones) {
      dr.a += dt * 1.1; dr.r = 30 + Math.sin(t * 2 + dr.a) * 4;
      const dxp = pl.x + Math.cos(dr.a) * dr.r, dyp = pl.y + Math.sin(dr.a) * dr.r * 0.8;
      dr.fire -= dt;
      if (dr.fire <= 0) { dr.fire = 0.34; const tg = nearest(dxp, dyp, 160); if (tg) fireBolt(dxp, dyp, tg.x, tg.y, { drone: true, sp: 320 }); }
      drawDrone(dxp, dyp, dr.a);
    }

    // ---- bolts ----
    for (const b of bolts) {
      b.life -= dt; b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.cit) {
        // citadel suppression fire — fizzles on the hero shield
        if (Math.hypot(pl.x - b.x, pl.y - b.y) < 36) { b.dead = true; parts.push({ ring: true, x: b.x, y: b.y, life: 0.25, max: 0.25, col: '#ffd24d', r: 4 }); continue; }
        drawBolt(b.x, b.y, '#ff5a6e', 3); continue;
      }
      // hits on citadel
      if (cit.phase === 'siege' && cit.y > 0 && b.vy < 0 && Math.abs(b.x - R2.x) < R2.dw * 0.34 && Math.abs(b.y - cit.y) < R2.dh * 0.3) {
        b.dead = true; cit.hitF = 1; dmgFloat(b.x, b.y - 6, b.crit);
        parts.push({ x: b.x, y: b.y, vx: rnd(-60, 60), vy: rnd(20, 90), life: 0.3, max: 0.3, col: '#ffd9a0', r: rnd(1, 2.4) });
        continue;
      }
      for (const e of enemies) { if (e.dead) continue; if (Math.abs(e.x - b.x) < e.r + 3 && Math.abs(e.y - b.y) < e.r + 3) { b.dead = true; e.flash = 1; e.hp--; dmgFloat(e.x, e.y - e.r - 2, b.crit); if (e.hp <= 0) killEnemy(e); break; } }
      drawBolt(b.x, b.y, b.crit ? '#ffd24d' : (b.drone ? '#7fffcb' : '#bfe6ff'), b.crit ? 2.6 : (b.drone ? 1.5 : 2));
    }
    if (cit.hitF > 0) cit.hitF -= dt * 4;

    // ---- loot ----
    for (const L of loot) {
      L.born += dt; L.bob += dt * 3;
      if (!L.mag && L.born > 0.45) L.mag = true;
      if (L.mag) {
        const dx = pl.x - L.x, dy = pl.y - L.y, d = Math.hypot(dx, dy) || 1;
        const pull = 80 + (1 - Math.min(1, d / 200)) * 360;
        L.x += (dx / d) * pull * dt; L.y += (dy / d) * pull * dt;
        if (d < 16) { L.dead = true; const r = RAR[L.tier]; picks.push({ x: pl.x, y: pl.y - 14, g: '+', c: r[1], life: 0.8, max: 0.8, up: true }); pow += (L.tier + 1) * 4e10; }
      } else { L.x += L.vx * dt; L.y += L.vy * dt; L.vy += 100 * dt; }
      drawLoot(L);
    }

    // ---- particles ----
    for (const p of parts) {
      p.life -= dt;
      if (p.ring) continue;
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92;
      ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.col;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.4 + p.life / p.max * 0.6), 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const p of parts) { if (!p.ring) continue; const k = 1 - p.life / p.max; ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.strokeStyle = p.col; ctx.lineWidth = 2 * (1 - k) + 0.5; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + k * 60, 0, 7); ctx.stroke(); }
    ctx.globalAlpha = 1;

    drawHero();

    // ---- damage floats ----
    for (const f of floats) {
      f.life -= dt * 1.5; f.y -= 40 * dt;
      ctx.globalAlpha = Math.max(0, f.life);
      ctx.font = `800 ${f.size}px Rajdhani, sans-serif`; ctx.textAlign = 'center'; ctx.lineJoin = 'round'; ctx.lineWidth = 3.2; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(f.txt, f.x, f.y); ctx.fillStyle = f.col; ctx.fillText(f.txt, f.x, f.y);
      if (f.crit) { ctx.font = '800 9px Rajdhani, sans-serif'; ctx.fillStyle = '#ffe88a'; ctx.fillText('CRIT!', f.x, f.y - f.size * 0.8); }
    }
    ctx.globalAlpha = 1;
    for (const p of picks) { p.life -= dt; p.y -= 26 * dt; ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.font = `800 ${p.up ? 13 : 12}px Rajdhani, sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = p.c; ctx.shadowColor = p.c; ctx.shadowBlur = 8; ctx.fillText(p.g + (p.up ? ' LOOT' : ''), p.x, p.y); ctx.shadowBlur = 0; }
    ctx.globalAlpha = 1;

    // UPGRADE banner
    if (cit.banner > 0) {
      const k = Math.min(1, (3 - cit.banner) * 3);
      ctx.globalAlpha = Math.min(1, cit.banner) * k;
      ctx.font = '800 17px Rajdhani, sans-serif'; ctx.textAlign = 'center';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText('\u2b06 SHIP UPGRADED', W / 2, H * 0.42);
      ctx.fillStyle = '#ffd24d'; ctx.fillText('\u2b06 SHIP UPGRADED', W / 2, H * 0.42);
      ctx.font = '800 12px Rajdhani, sans-serif';
      ctx.strokeText(HULLS[hullIdx][1], W / 2, H * 0.42 + 17);
      ctx.fillStyle = '#fff3d0'; ctx.fillText(HULLS[hullIdx][1], W / 2, H * 0.42 + 17);
      ctx.globalAlpha = 1;
    }

    // supernova whiteout
    if (cit.flash > 0) { ctx.globalAlpha = Math.min(1, cit.flash) * 0.9; ctx.fillStyle = '#fff4da'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }

    // vignette + warp-in
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.8);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    if (t < 0.9) {
      const k = 1 - t / 0.9, cx2 = W / 2, cy2 = H / 2, R0 = Math.max(W, H);
      ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = '#cfe8ff';
      for (let i = 0; i < 30; i++) {
        const a = (i / 30) * Math.PI * 2 + (i % 5) * 0.07;
        const r1 = 22 + (1 - k) * R0 * 0.7, r2 = r1 + 30 + 90 * k;
        ctx.globalAlpha = Math.min(1, k * 1.3) * (0.3 + (i % 3) * 0.22);
        ctx.lineWidth = 1 + (i % 3);
        ctx.beginPath(); ctx.moveTo(cx2 + Math.cos(a) * r1, cy2 + Math.sin(a) * r1);
        ctx.lineTo(cx2 + Math.cos(a) * r2, cy2 + Math.sin(a) * r2); ctx.stroke();
      }
      ctx.restore(); ctx.globalAlpha = 1;
    }

    // ---- cull ----
    for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].dead) enemies.splice(i, 1);
    for (let i = bolts.length - 1; i >= 0; i--) { const b = bolts[i]; if (b.dead || b.life <= 0 || b.x < -20 || b.x > W + 20 || b.y < -30 || b.y > H + 20) bolts.splice(i, 1); }
    for (let i = parts.length - 1; i >= 0; i--) if (parts[i].life <= 0) parts.splice(i, 1);
    for (let i = floats.length - 1; i >= 0; i--) if (floats[i].life <= 0) floats.splice(i, 1);
    for (let i = loot.length - 1; i >= 0; i--) if (loot[i].dead) loot.splice(i, 1);
    for (let i = picks.length - 1; i >= 0; i--) if (picks[i].life <= 0) picks.splice(i, 1);

    const pe = document.getElementById('heroPow'); if (pe) pe.textContent = num(pow);
    queueFrame();
  }

  // ---------- drawers ----------
  function drawCitadel(R2) {
    const f = cit.hp, burning = f < 0.75, breaking = f < 0.5, critical = f < 0.25;
    const pulse = 0.5 + 0.5 * Math.sin(t * (critical ? 9 : breaking ? 5 : 2.2));
    const jx = critical ? Math.sin(t * 47) * 2.4 : (breaking ? Math.sin(t * 23) * 1 : 0);
    const x = R2.x + jx, y = cit.y;
    // aura
    const auraCol = critical ? '255,42,74' : burning ? '255,130,60' : '90,190,255';
    const ag = ctx.createRadialGradient(x, y, R2.dw * 0.1, x, y, R2.dw * 0.6);
    ag.addColorStop(0, `rgba(${auraCol},${0.26 + 0.14 * pulse})`); ag.addColorStop(1, `rgba(${auraCol},0)`);
    ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(x, y, R2.dw * 0.6, 0, 7); ctx.fill();
    ctx.drawImage(citImg, x - R2.dw / 2, y - R2.dh / 2, R2.dw, R2.dh);
    if (cit.hitF > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = cit.hitF * 0.5;
      ctx.drawImage(citImg, x - R2.dw / 2, y - R2.dh / 2, R2.dw, R2.dh); ctx.restore();
    }
    // fires ignite as it burns down
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const FIRES = [[-0.5, 0.2], [0.42, 0.28], [-0.16, -0.26], [0.28, -0.16], [0, 0.4], [-0.38, -0.04], [0.52, 0.06]];
    const lit = Math.min(FIRES.length, Math.floor((1 - f) * (FIRES.length + 2)));
    for (let i = 0; i < lit; i++) {
      const fp = FIRES[i], fl = 0.55 + 0.45 * Math.sin(t * (9 + i * 1.7) + i * 9);
      const fx = x + fp[0] * R2.dw * 0.5, fy = y + fp[1] * R2.dh * 0.5;
      const fg = ctx.createRadialGradient(fx, fy, 1, fx, fy, 18 + 8 * fl);
      fg.addColorStop(0, `rgba(255,210,120,${0.7 * fl})`); fg.addColorStop(0.5, `rgba(255,120,40,${0.4 * fl})`); fg.addColorStop(1, 'rgba(255,60,20,0)');
      ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(fx, fy, 18 + 8 * fl, 0, 7); ctx.fill();
      if (Math.random() < 0.25 && parts.length < MAXP) parts.push({ x: fx + rnd(-4, 4), y: fy, vx: rnd(-12, 12), vy: rnd(-50, -25), life: rnd(0.3, 0.7), max: 0.7, col: Math.random() < 0.6 ? '#ff9a50' : 'rgba(150,150,155,0.5)', r: rnd(1.4, 3) });
    }
    // reactor crown
    const coreCol = critical ? '255,60,90' : '110,210,255';
    const cg = ctx.createRadialGradient(x - R2.dw * 0.04, y - R2.dh * 0.14, 2, x - R2.dw * 0.04, y - R2.dh * 0.14, R2.dw * 0.16);
    cg.addColorStop(0, `rgba(${coreCol},${0.45 + 0.35 * pulse})`); cg.addColorStop(1, `rgba(${coreCol},0)`);
    ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(x - R2.dw * 0.04, y - R2.dh * 0.14, R2.dw * 0.16, 0, 7); ctx.fill();
    ctx.restore();
    if (critical) {
      ctx.globalAlpha = 0.25 + 0.45 * pulse; ctx.strokeStyle = '#ff2a4a'; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.arc(x, y, R2.dw * (0.5 + 0.03 * pulse), 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
    }
    // integrity bar
    if (cit.phase === 'siege' && y > 10) {
      const bw = Math.min(R2.dw * 0.8, 220), bx = x - bw / 2, by = Math.max(10, y - R2.dh / 2 - 12);
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(bx - 2, by - 2, bw + 4, 9);
      ctx.fillStyle = '#3a0e12'; ctx.fillRect(bx, by, bw, 5);
      ctx.fillStyle = critical ? '#ff2a4a' : burning ? '#ff9a50' : '#5fd1ff';
      ctx.fillRect(bx, by, bw * f, 5);
      ctx.font = '800 9px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 2.6; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      const lbl = '\u26f4 VOID CITADEL' + (critical ? ' \u00b7 CRITICAL' : breaking ? ' \u00b7 BREAKING UP' : burning ? ' \u00b7 BURNING' : '');
      ctx.strokeText(lbl, x, by - 4); ctx.fillStyle = '#ffd9c4'; ctx.fillText(lbl, x, by - 4);
    }
  }

  function drawEnemy(e) {
    ctx.globalAlpha = 0.35; ctx.fillStyle = e.col;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 1.7, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    const ang = Math.atan2(pl.y - e.y, pl.x - e.x) + Math.PI / 2;
    ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(ang);
    ctx.fillStyle = e.flash > 0 ? '#fff' : e.col;
    ctx.beginPath(); ctx.moveTo(0, -e.r * 1.3); ctx.lineTo(e.r * 0.9, e.r); ctx.lineTo(0, e.r * 0.4); ctx.lineTo(-e.r * 0.9, e.r); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(0, -e.r * 0.1, e.r * 0.28, 0, 7); ctx.fill();
    ctx.restore();
  }
  function drawBolt(x, y, col, r) {
    ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
  }
  function drawDrone(x, y, a) {
    ctx.globalAlpha = 0.4; ctx.fillStyle = '#7fffcb'; ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a * 0.5);
    ctx.fillStyle = '#2b3744'; ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(3.4, 3.6); ctx.lineTo(-3.4, 3.6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#7fffcb'; ctx.beginPath(); ctx.arc(0, -0.5, 1.5, 0, 7); ctx.fill();
    ctx.restore();
  }
  function rgbaCol(hex, a) { const n = parseInt(hex.replace('#', ''), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
  function drawLoot(L) {
    const r = RAR[L.tier], col = r[1], gl = r[2], y = L.y + Math.sin(L.bob) * 1.5;
    if (L.mag) { ctx.strokeStyle = rgbaCol(col, 0.25); ctx.lineWidth = 1 + gl * 0.3; ctx.beginPath(); ctx.moveTo(L.x, y); ctx.lineTo(L.x + (pl.x - L.x) * 0.32, y + (pl.y - y) * 0.32); ctx.stroke(); }
    if (gl >= 3) { const bh = 10 + gl * 5; ctx.fillStyle = rgbaCol(col, 0.10 + gl * 0.03); ctx.fillRect(L.x - (1 + gl * 0.4), y - bh, 2 + gl * 0.8, bh); }
    if (gl >= 5) {
      const pr = 1 + 0.35 * Math.sin(t * 7 + L.bob);
      ctx.save(); ctx.translate(L.x, y); ctx.rotate(t * 1.5);
      ctx.strokeStyle = rgbaCol(col, 0.5 * pr); ctx.lineWidth = 1.2;
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 5, Math.sin(a) * 5); ctx.lineTo(Math.cos(a) * (11 * pr), Math.sin(a) * (11 * pr)); ctx.stroke(); }
      ctx.restore();
    }
    if (gl > 0) { ctx.globalAlpha = 0.35 + gl * 0.08; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(L.x, y, 4 + gl * 1.3, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
    ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 3 + gl * 2.5;
    ctx.save(); ctx.translate(L.x, y); ctx.rotate(Math.PI / 4);
    const s = 2.4 + gl * 0.5; ctx.fillRect(-s, -s, s * 2, s * 2);
    ctx.restore(); ctx.shadowBlur = 0;
  }
  function drawHero() {
    ctx.save(); ctx.translate(pl.x, pl.y + Math.sin(t * 1.6) * 2);
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    const sg = ctx.createRadialGradient(0, 0, 14, 0, 0, 34);
    sg.addColorStop(0, 'rgba(255,168,56,0)'); sg.addColorStop(0.8, `rgba(255,168,56,${0.08 * pulse})`); sg.addColorStop(1, `rgba(255,168,56,${0.28 * pulse})`);
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(0, 0, 34, 0, 7); ctx.fill();
    ctx.strokeStyle = `rgba(255,200,110,${0.5 * pulse})`; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(0, 0, 34, 0, 7); ctx.stroke();
    const eg = ctx.createRadialGradient(0, 22, 1, 0, 22, 22);
    eg.addColorStop(0, 'rgba(120,200,255,0.5)'); eg.addColorStop(1, 'rgba(120,200,255,0)');
    ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(0, 22, 22, 0, 7); ctx.fill();
    const ds = 50 + hullIdx * 3;                                          // each hull reads bigger
    if (ship.complete && ship.naturalWidth) ctx.drawImage(ship, -ds / 2, -ds / 2, ds, ds);
    else { ctx.fillStyle = '#cdd9ff'; ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(12, 12); ctx.lineTo(-12, 12); ctx.closePath(); ctx.fill(); }
    const mf = (Math.sin(t * 40) + 1) / 2;
    if (mf > 0.4) { ctx.fillStyle = '#ffe6a0'; ctx.shadowColor = '#ffb43c'; ctx.shadowBlur = 10; for (const gx of [-10, 0, 10]) { ctx.beginPath(); ctx.arc(gx, -18, 2 + mf * 2, 0, 7); ctx.fill(); } ctx.shadowBlur = 0; }
    // upgrade rings — golden shockwaves when the hull levels up
    if (pl.ringT > 0) {
      for (let i = 0; i < 3; i++) {
        const k = Math.max(0, Math.min(1, (1 - pl.ringT) * 1.6 - i * 0.18));
        if (k <= 0 || k >= 1) continue;
        ctx.globalAlpha = (1 - k) * 0.8;
        ctx.strokeStyle = '#ffd24d'; ctx.lineWidth = 2.4 * (1 - k) + 0.6;
        ctx.beginPath(); ctx.arc(0, 0, 20 + k * 90, 0, 7); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // rAF can be throttled or fully suspended (background tabs, embedded
  // previews). queueFrame de-dupes scheduling; the watchdog steps the loop
  // manually whenever rAF stalls so the siege never freezes.
  let rafPending = false;
  function queueFrame() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function (n) { rafPending = false; loop(n); });
  }
  queueFrame();
  setInterval(function () { if (performance.now() - last > 90) loop(performance.now()); }, 100);
})();
