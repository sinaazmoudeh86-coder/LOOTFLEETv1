/* =============================================================================
   showcase.js — Loot Fleet homepage "endgame" attract battle
   ---------------------------------------------------------------------------
   Drives the phone-mockup canvas (#heroCanvas) with an intense, accurate slice
   of ENDGAME play: a Faction Titan Carrier (real sprite) fighting through a
   bullet-hell swarm in Deep Space while battling a massive Super Boss — multi-
   weapon fire, orbiting drones, a loot explosion with rarity glows + magnet
   pull, and big crit damage numbers. Self-contained; no game engine needed.
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

  // Faction carrier sprite (the real in-game hull art)
  const ship = new Image(); ship.src = 'ships/ship-titan.png';

  // rarity tiers: [name, color, glowStrength]
  const RAR = [
    ['Common',   '#9aa7b8', 0],
    ['Uncommon', '#46d27a', 1],
    ['Rare',     '#4fa6ff', 2],
    ['Epic',     '#b87bff', 3],
    ['Legendary','#ffa838', 4],
    ['Mythic',   '#ff5168', 5],
  ];
  // enemy hull tints (alien vessels)
  const ECOL = ['#7fe0ff', '#ff8a5c', '#c89bff', '#74e0a8', '#ff6f9c', '#ffd24d'];

  const rnd = (a, b) => a + Math.random() * (b - a);
  function num(n) { if (n < 1000) return n | 0; const u = ['', 'K', 'M', 'B', 'T']; let i = 0, v = n; while (v >= 1000 && i < 4) { v /= 1000; i++; } return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + u[i]; }

  const enemies = [], bolts = [], parts = [], floats = [], loot = [], picks = [];
  const drones = [];
  const NDRONES = 7;
  for (let i = 0; i < NDRONES; i++) drones.push({ a: (i / NDRONES) * Math.PI * 2, r: 0, fire: rnd(0, 0.3) });

  const pl = { x: 0, y: 0, fire: 0, sweep: 0 };
  const boss = { x: 0, y: 0, hp: 1, max: 1, fire: 0, hitFlash: 0, drift: 0 };
  let t = 0, pow = 8.4e15, started = false;

  const MAXE = 110, MAXB = 150, MAXP = 260, MAXL = 34, MAXF = 30;

  function spawnEnemy() {
    if (enemies.length >= MAXE) return;
    const edge = Math.random();
    let x, y;
    if (edge < 0.5) { x = rnd(0, W); y = rnd(-30, H * 0.34); }           // top field (around boss)
    else if (edge < 0.75) { x = rnd(-26, 8); y = rnd(0, H); }            // left
    else { x = rnd(W - 8, W + 26); y = rnd(0, H); }                       // right
    const big = Math.random() < 0.12;
    enemies.push({ x, y, r: big ? rnd(8, 11) : rnd(4.2, 7), col: ECOL[(Math.random() * ECOL.length) | 0], hp: big ? 3 : 2, flash: 0, sp: rnd(14, 30), wob: rnd(0, 6.28), born: 0 });
  }

  function spawnBoss() { boss.max = 1; boss.hp = 1; }

  function dropLoot(x, y) {
    if (loot.length >= MAXL) return;
    // weighted toward lower rarity, but endgame skews high; mythic is rare & flashy
    const r = Math.random();
    let tier = r < 0.30 ? 0 : r < 0.54 ? 1 : r < 0.73 ? 2 : r < 0.87 ? 3 : r < 0.96 ? 4 : 5;
    loot.push({ x, y, vx: rnd(-26, 26), vy: rnd(-34, -10), tier, born: 0, mag: false, bob: rnd(0, 6.28) });
  }

  function killEnemy(e) {
    e.dead = true;
    pow += rnd(2e13, 9e13);
    // explosion
    const n = 8 + (e.r | 0);
    for (let i = 0; i < n && parts.length < MAXP; i++) { const a = Math.random() * 7, sp = rnd(40, 170); parts.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.4, 0.8), max: 0.8, col: e.col, r: rnd(1.2, 3) }); }
    // flash ring
    parts.push({ ring: true, x: e.x, y: e.y, life: 0.32, max: 0.32, col: '#fff', r: e.r });
    if (Math.random() < 0.62) dropLoot(e.x, e.y);
    if (Math.random() < 0.16) picks.push({ x: e.x, y: e.y, g: ['\u2b22', '\u25c6', '\u2726'][(Math.random() * 3) | 0], c: ['#5bc0ff', '#d0a060', '#c07bff'][(Math.random() * 3) | 0], life: 1.1, max: 1.1 });
  }

  function nearest(x, y, maxd) {
    let b = null, bd = maxd * maxd;
    for (const e of enemies) { if (e.dead) continue; const d = (e.x - x) ** 2 + (e.y - y) ** 2; if (d < bd) { bd = d; b = e; } }
    return b;
  }

  function fireBolt(x, y, tx, ty, opt) {
    if (bolts.length >= MAXB) return;
    const a = Math.atan2(ty - y, tx - x), sp = opt.sp || 360;
    bolts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, crit: !!opt.crit, drone: !!opt.drone, boss: !!opt.boss, life: 1.4 });
  }

  function dmgFloat(x, y, crit) {
    if (floats.length >= MAXF) return;
    if (!crit && Math.random() < 0.45) return; // thin out non-crit spam so big hits read
    const base = crit ? rnd(4e9, 2.2e10) : rnd(6e8, 5e9);
    floats.push({ x, y, txt: num(base), col: crit ? '#ffd24d' : '#fff1c2', crit, life: 1, max: 1, size: crit ? 22 : 14 });
  }

  let last = performance.now();
  function loop(now) {
    if (!W) { size(); requestAnimationFrame(loop); return; }
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    pl.x = W / 2; pl.y = H * 0.72;
    boss.x = W / 2 + Math.sin(t * 0.5) * W * 0.22; boss.y = H * 0.15;

    // ---- background: deep-space void ----
    const g = ctx.createRadialGradient(W / 2, H * 0.42, 10, W / 2, H * 0.5, Math.max(W, H) * 0.9);
    g.addColorStop(0, '#1a0f2e'); g.addColorStop(0.55, '#10081c'); g.addColorStop(1, '#05030a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // nebula wash
    ctx.globalAlpha = 0.5;
    const ng = ctx.createRadialGradient(W * 0.3, H * 0.3, 8, W * 0.3, H * 0.3, W * 0.6);
    ng.addColorStop(0, 'rgba(190,70,200,0.10)'); ng.addColorStop(1, 'rgba(190,70,200,0)');
    ctx.fillStyle = ng; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    // stars
    ctx.fillStyle = '#e7d9ff';
    for (let i = 0; i < 60; i++) { const sx = (i * 53.7 % W), sy = ((i * 97.3 + t * 6 * (1 + (i % 3))) % H); ctx.globalAlpha = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t * 2 + i)); ctx.fillRect(sx, sy, i % 5 ? 1 : 1.6, i % 5 ? 1 : 1.6); }
    ctx.globalAlpha = 1;

    // super-boss zone red pulse
    const bp = 0.12 + 0.08 * Math.sin(t * 4);
    const rg = ctx.createRadialGradient(boss.x, boss.y, 6, boss.x, boss.y, W * 0.55);
    rg.addColorStop(0, `rgba(255,42,74,${bp})`); rg.addColorStop(1, 'rgba(255,42,74,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);

    // ---- spawns ----
    if (enemies.length < MAXE && Math.random() < dt * 26) { spawnEnemy(); spawnEnemy(); }

    // ---- SUPER BOSS ----
    boss.hitFlash = Math.max(0, boss.hitFlash - dt * 3);
    boss.fire -= dt;
    if (boss.fire <= 0) { boss.fire = 0.6; for (let k = -1; k <= 1; k++) fireBolt(boss.x, boss.y + 14, pl.x + k * 50, pl.y, { boss: true, sp: 150 }); }
    drawBoss();

    // ---- enemies ----
    for (const e of enemies) {
      e.born += dt; if (e.flash > 0) e.flash -= dt * 5;
      const dx = pl.x - e.x, dy = pl.y - e.y, d = Math.hypot(dx, dy) || 1;
      e.x += (dx / d) * e.sp * dt + Math.cos(t * 2 + e.wob) * 8 * dt;
      e.y += (dy / d) * e.sp * dt;
      drawEnemy(e);
    }

    // ---- player multi-weapon fire ----
    pl.fire -= dt;
    if (pl.fire <= 0) {
      pl.fire = 0.1;
      // three forward streams + a sweeping beam → bullet-hell of our own
      for (let s = 0; s < 3; s++) {
        const tg = nearest(pl.x + (s - 1) * 30, pl.y, 999);
        if (tg) fireBolt(pl.x + (s - 1) * 8, pl.y - 10, tg.x, tg.y, { crit: Math.random() < 0.3 });
      }
      // always pour onto the boss too
      fireBolt(pl.x, pl.y - 12, boss.x, boss.y, { crit: Math.random() < 0.4 });
      pl.sweep += 0.7;
      fireBolt(pl.x, pl.y - 6, pl.x + Math.cos(pl.sweep) * 200, pl.y - 40 + Math.sin(pl.sweep) * 80, {});
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
      if (b.boss) { drawBolt(b.x, b.y, '#ff5a6e', 3); continue; }
      // hit detection vs enemies / boss
      if (Math.hypot(boss.x - b.x, boss.y - b.y) < 26) { b.dead = true; boss.hitFlash = 1; dmgFloat(b.x, b.y - 8, b.crit); continue; }
      for (const e of enemies) { if (e.dead) continue; if (Math.abs(e.x - b.x) < e.r + 3 && Math.abs(e.y - b.y) < e.r + 3) { b.dead = true; e.flash = 1; e.hp--; dmgFloat(e.x, e.y - e.r - 2, b.crit); if (e.hp <= 0) killEnemy(e); break; } }
      drawBolt(b.x, b.y, b.crit ? '#ffd24d' : (b.drone ? '#7fffcb' : '#bfe6ff'), b.crit ? 2.6 : (b.drone ? 1.5 : 2));
    }

    // ---- loot: spawn, magnet to ship, draw glow ----
    for (const L of loot) {
      L.born += dt; L.bob += dt * 3;
      if (!L.mag && L.born > 0.5) L.mag = true;
      if (L.mag) {
        const dx = pl.x - L.x, dy = pl.y - L.y, d = Math.hypot(dx, dy) || 1;
        const pull = 70 + (1 - Math.min(1, d / 180)) * 320;
        L.x += (dx / d) * pull * dt; L.y += (dy / d) * pull * dt;
        if (d < 16) { L.dead = true; const r = RAR[L.tier]; picks.push({ x: pl.x, y: pl.y - 14, g: '+', c: r[1], life: 0.8, max: 0.8, up: true }); pow += (L.tier + 1) * 4e13; }
      } else { L.x += L.vx * dt; L.y += L.vy * dt; L.vy += 60 * dt; }
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
    for (const p of parts) { if (!p.ring) continue; const k = 1 - p.life / p.max; ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.strokeStyle = p.col; ctx.lineWidth = 2 * (1 - k); ctx.beginPath(); ctx.arc(p.x, p.y, p.r + k * 18, 0, 7); ctx.stroke(); }
    ctx.globalAlpha = 1;

    // ---- the carrier ----
    drawCarrier();

    // ---- damage numbers ----
    for (const f of floats) {
      f.life -= dt * 1.5; f.y -= 40 * dt;
      ctx.globalAlpha = Math.max(0, f.life);
      ctx.font = `800 ${f.size}px Rajdhani, sans-serif`; ctx.textAlign = 'center'; ctx.lineJoin = 'round'; ctx.lineWidth = 3.2; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(f.txt, f.x, f.y); ctx.fillStyle = f.col; ctx.fillText(f.txt, f.x, f.y);
      if (f.crit) { ctx.font = '800 9px Rajdhani, sans-serif'; ctx.fillStyle = '#ffe88a'; ctx.fillText('CRIT!', f.x, f.y - f.size * 0.8); }
    }
    ctx.globalAlpha = 1;

    // ---- pickup pops ----
    for (const p of picks) { p.life -= dt; p.y -= 26 * dt; ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.font = `800 ${p.up ? 13 : 12}px Rajdhani, sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = p.c; ctx.shadowColor = p.c; ctx.shadowBlur = 8; ctx.fillText(p.g + (p.up ? ' LOOT' : ''), p.x, p.y); ctx.shadowBlur = 0; }
    ctx.globalAlpha = 1;

    // vignette
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.8);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);

    // ---- cull ----
    for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].dead) enemies.splice(i, 1);
    for (let i = bolts.length - 1; i >= 0; i--) { const b = bolts[i]; if (b.dead || b.life <= 0 || b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) bolts.splice(i, 1); }
    for (let i = parts.length - 1; i >= 0; i--) if (parts[i].life <= 0) parts.splice(i, 1);
    for (let i = floats.length - 1; i >= 0; i--) if (floats[i].life <= 0) floats.splice(i, 1);
    for (let i = loot.length - 1; i >= 0; i--) if (loot[i].dead) loot.splice(i, 1);
    for (let i = picks.length - 1; i >= 0; i--) if (picks[i].life <= 0) picks.splice(i, 1);

    const pe = document.getElementById('heroPow'); if (pe) pe.textContent = num(pow);
    requestAnimationFrame(loop);
  }

  // ---------- drawers ----------
  function drawEnemy(e) {
    // soft colored halo (cheap, no shadowBlur)
    ctx.globalAlpha = 0.35; ctx.fillStyle = e.col;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 1.7, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    // dart body pointing toward player
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

  function drawLoot(L) {
    const r = RAR[L.tier], col = r[1], gl = r[2], y = L.y + Math.sin(L.bob) * 1.5;
    // magnet trail — a faint streak from the drop toward the carrier
    if (L.mag) {
      ctx.strokeStyle = rgbaCol(col, 0.25); ctx.lineWidth = 1 + gl * 0.3;
      ctx.beginPath(); ctx.moveTo(L.x, y);
      ctx.lineTo(L.x + (pl.x - L.x) * 0.32, y + (pl.y - y) * 0.32); ctx.stroke();
    }
    // light beam for Epic+ (taller & brighter the rarer)
    if (gl >= 3) {
      const bh = 10 + gl * 5;
      ctx.fillStyle = rgbaCol(col, 0.10 + gl * 0.03);
      ctx.fillRect(L.x - (1 + gl * 0.4), y - bh, 2 + gl * 0.8, bh);
    }
    // glow halo (scales with rarity); Mythic pulses + throws rays
    if (gl >= 5) {
      const pr = 1 + 0.35 * Math.sin(t * 7 + L.bob);
      ctx.save(); ctx.translate(L.x, y); ctx.rotate(t * 1.5);
      ctx.strokeStyle = rgbaCol(col, 0.5 * pr); ctx.lineWidth = 1.2;
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 5, Math.sin(a) * 5); ctx.lineTo(Math.cos(a) * (11 * pr), Math.sin(a) * (11 * pr)); ctx.stroke(); }
      ctx.restore();
    }
    if (gl > 0) {
      ctx.globalAlpha = 0.35 + gl * 0.08; ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(L.x, y, 4 + gl * 1.3, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    }
    // the drop itself — a small gem
    ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 3 + gl * 2.5;
    ctx.save(); ctx.translate(L.x, y); ctx.rotate(Math.PI / 4);
    const s = 2.4 + gl * 0.5; ctx.fillRect(-s, -s, s * 2, s * 2);
    ctx.restore(); ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(L.x - 1, y - 1, 1, 0, 7); ctx.fill();
  }

  function rgbaCol(hex, a) {
    const h = hex.replace('#', ''); const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function drawCarrier() {
    ctx.save(); ctx.translate(pl.x, pl.y + Math.sin(t * 1.6) * 2);
    // legendary shield aura
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    const sg = ctx.createRadialGradient(0, 0, 14, 0, 0, 34);
    sg.addColorStop(0, 'rgba(255,168,56,0)'); sg.addColorStop(0.8, `rgba(255,168,56,${0.08 * pulse})`); sg.addColorStop(1, `rgba(255,168,56,${0.28 * pulse})`);
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(0, 0, 34, 0, 7); ctx.fill();
    ctx.strokeStyle = `rgba(255,200,110,${0.5 * pulse})`; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(0, 0, 34, 0, 7); ctx.stroke();
    // engine glow
    const eg = ctx.createRadialGradient(0, 22, 1, 0, 22, 22);
    eg.addColorStop(0, 'rgba(120,200,255,0.5)'); eg.addColorStop(1, 'rgba(120,200,255,0)');
    ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(0, 22, 22, 0, 7); ctx.fill();
    // the real hull sprite
    const ds = 56;
    if (ship.complete && ship.naturalWidth) ctx.drawImage(ship, -ds / 2, -ds / 2, ds, ds);
    else { ctx.fillStyle = '#cdd9ff'; ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(12, 12); ctx.lineTo(-12, 12); ctx.closePath(); ctx.fill(); }
    // muzzle flashes
    const mf = (Math.sin(t * 40) + 1) / 2;
    if (mf > 0.4) { ctx.fillStyle = '#ffe6a0'; ctx.shadowColor = '#ffb43c'; ctx.shadowBlur = 10; for (const gx of [-10, 0, 10]) { ctx.beginPath(); ctx.arc(gx, -18, 2 + mf * 2, 0, 7); ctx.fill(); } ctx.shadowBlur = 0; }
    ctx.restore();
  }

  function drawBoss() {
    const x = boss.x, y = boss.y, pulse = 0.6 + 0.4 * Math.sin(t * 5);
    // aura
    const ag = ctx.createRadialGradient(x, y, 6, x, y, 64);
    ag.addColorStop(0, `rgba(255,42,74,${0.32 * pulse})`); ag.addColorStop(1, 'rgba(255,42,74,0)');
    ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(x, y, 64, 0, 7); ctx.fill();
    // hull (big menacing dreadnought)
    ctx.save(); ctx.translate(x, y);
    const flash = boss.hitFlash > 0;
    const hg = ctx.createLinearGradient(-34, 0, 34, 0);
    hg.addColorStop(0, flash ? '#ffd0d6' : '#3a1020'); hg.addColorStop(0.5, flash ? '#fff' : '#7a1230'); hg.addColorStop(1, flash ? '#ffd0d6' : '#2a0a16');
    ctx.fillStyle = hg; ctx.strokeStyle = '#ff5a6e'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 30); ctx.lineTo(34, 6); ctx.lineTo(26, -20); ctx.lineTo(12, -10); ctx.lineTo(0, -30); ctx.lineTo(-12, -10); ctx.lineTo(-26, -20); ctx.lineTo(-34, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
    // glowing core
    ctx.fillStyle = '#ff2a4a'; ctx.shadowColor = '#ff2a4a'; ctx.shadowBlur = 16 * pulse; ctx.beginPath(); ctx.arc(0, -2, 7, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = '#1a0008'; ctx.beginPath(); ctx.arc(0, -2, 3, 0, 7); ctx.fill();
    ctx.restore();
    // HP bar + label
    const bw = 96, bx = x - bw / 2, by = y - 46;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(bx - 2, by - 2, bw + 4, 9);
    ctx.fillStyle = '#3a0e12'; ctx.fillRect(bx, by, bw, 5);
    const hp = 0.55 + 0.25 * Math.sin(t * 0.7);
    ctx.fillStyle = '#ff2a4a'; ctx.fillRect(bx, by, bw * hp, 5);
    ctx.font = '800 9px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 2.6; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText('\u2620 SUPER DREADNOUGHT', x, by - 5); ctx.fillStyle = '#ff8a96'; ctx.fillText('\u2620 SUPER DREADNOUGHT', x, by - 5);
  }

  spawnBoss();
  requestAnimationFrame(loop);
})();
