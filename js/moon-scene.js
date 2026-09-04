/* =============================================================================
   moon-scene.js — MOON COLONY live diorama (canvas)
   ---------------------------------------------------------------------------
   A side-view animated scene of YOUR colony, derived from G.state.moon:
   • every structure you build appears on the lunar surface (per-type sprite)
   • mining ships hover over each extractor, tractor-beaming ore chunks up,
     then ferry cargo to the Command Hub and return
   • cargo drones (count scales with Cargo Drone levels) fly arcs between
     buildings and the hub with light trails
   • a shuttle periodically launches from the landing pad (your shipments)
   • Earth hangs in the sky; stars twinkle; craters, terrain parallax
   Perf: DPR-capped, rAF pauses whenever the Moon screen is not active.
============================================================================= */
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  let cv = null, ctx = null, W = 0, H = 0, raf = 0, t0 = performance.now();
  let stars = [], ships = [], drones = [], oreParts = [], puffs = [];
  let sites = [];            // placed buildings {x,y,kind,lv,col,out}
  let hub = null, pad = null;
  let shuttle = null, nextLaunch = 8;
  let lastBuildSig = '';

  const OUT_COL = { gold: '#f2b94c', fuel: '#5bc0ff', iron: '#d0a060', plasma: '#c07bff', prism: '#1fe3b2' };
  const rand = (a, b) => a + Math.random() * (b - a);

  // ---------------------------------------------------------------------------
  function moonState() {
    const g = window.GAME; const m = g && g.state && g.state.moon;
    if (!m) return null;
    return m.moons ? m.moons[m.cur] || m.moons[0] : m; // multi-moon aware
  }
  function curHue() {
    const g = window.GAME; const m = g && g.state && g.state.moon;
    const cat = window.MOONCAT || [];
    if (m && m.moons && cat[m.cur]) return cat[m.cur].hue;
    return 215;
  }
  const view = { z: 1, pad: 0 };  // zoom-out grows the visible expanse
  function surfaceY(x) { return H * 0.76 + Math.sin(x * 0.012 + 1.2) * 6 + Math.sin(x * 0.004) * 9; }

  function layout() {
    const m = moonState(); if (!m) return;
    const g2 = window.GAME.state.moon;
    const sig = JSON.stringify(m.b) + '|' + W + '|' + (g2.cur || 0);
    if (sig === lastBuildSig) return;
    lastBuildSig = sig;
    sites = []; ships = []; drones = [];
    hub = { x: W * 0.5, y: surfaceY(W * 0.5) };
    pad = { x: W * 0.5 + 52, y: surfaceY(W * 0.5 + 52) };
    const entries = Object.entries(m.b);
    entries.forEach(([key, bd], i) => {
      const side = i % 2 ? -1 : 1;
      const dist = 78 + Math.floor(i / 2) * 62 + (i % 3) * 9;
      const x = hub.x + side * dist;   // UNCLAMPED — the camera zooms out instead
      const B = (window.MOONDEFS || {})[bd.kind] || {};
      const site = { x, y: surfaceY(x), kind: bd.kind, lv: bd.lv, cat: B.cat || 'mine', out: B.out, col: OUT_COL[B.out] || '#9ecfff', dmg: !!bd.dmg };
      sites.push(site);
      if (site.cat === 'mine' && !site.dmg) {
        ships.push({ site, x, y: site.y - 52 - rand(0, 10), ph: rand(0, TAU), state: 'mine', t: rand(6, 16), cargo: 0 });
      }
    });
    // camera pulls back as the colony sprawls — the view keeps growing wider
    let span = W * 0.42;
    sites.forEach((s) => { span = Math.max(span, Math.abs(s.x - W * 0.5) + 46); });
    view.z = Math.max(0.52, Math.min(1, (W * 0.5 - 8) / span));
    view.pad = (W / view.z - W) / 2 + 20;
    // drone count scales with Cargo Drone levels (1 minimum once you own any)
    const droneLv = entries.filter(([, b]) => b.kind === 'drones').reduce((a, [, b]) => a + b.lv, 0);
    const nDrones = droneLv > 0 ? Math.min(6, 1 + Math.floor(droneLv / 4)) : (entries.length > 1 ? 1 : 0);
    for (let i = 0; i < nDrones; i++) {
      const from = sites[Math.floor(Math.random() * sites.length)] || hub;
      drones.push({ a: from, b: hub, t: Math.random(), dir: 1, spd: rand(0.10, 0.16), h: rand(34, 58), trail: [] });
    }
  }

  // ---------------------------------------------------------------------------
  // DRAW HELPERS
  // ---------------------------------------------------------------------------
  function glow(x, y, r, col, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, col + Math.round(Math.min(1, a) * 255).toString(16).padStart(2, '0'));
    g.addColorStop(1, col + '00');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  function blinker(x, y, col, t, ph) {
    const on = (Math.sin(t * 2.4 + ph) + 1) / 2;
    ctx.fillStyle = col; ctx.globalAlpha = 0.25 + on * 0.75;
    ctx.beginPath(); ctx.arc(x, y, 1.4, 0, TAU); ctx.fill();
    if (on > 0.7) glow(x, y, 5, col, 0.5);
    ctx.globalAlpha = 1;
  }

  // ---- background -----------------------------------------------------------
  function drawSky(t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#04070f'); g.addColorStop(0.6, '#0a1020'); g.addColorStop(1, '#0d1526');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (const s of stars) {
      ctx.globalAlpha = 0.35 + 0.65 * ((Math.sin(t * s.tw + s.ph) + 1) / 2);
      ctx.fillStyle = s.c; ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
    // EARTH — top right, cloud bands + terminator
    const ex = W * 0.84, ey = H * 0.20, er = 17;
    glow(ex, ey, er * 2.4, '#5b9fe0', 0.35);
    ctx.save(); ctx.beginPath(); ctx.arc(ex, ey, er, 0, TAU); ctx.clip();
    const eg = ctx.createRadialGradient(ex - 6, ey - 6, 2, ex, ey, er);
    eg.addColorStop(0, '#9ed4ff'); eg.addColorStop(0.55, '#3c7fd0'); eg.addColorStop(1, '#123a75');
    ctx.fillStyle = eg; ctx.fillRect(ex - er, ey - er, er * 2, er * 2);
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.beginPath(); ctx.ellipse(ex - 4, ey - 5, 9, 3, -0.4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(ex + 5, ey + 4, 7, 2.4, -0.3, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(2,6,18,.55)';
    ctx.beginPath(); ctx.arc(ex + er * 0.55, ey, er * 1.05, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function drawTerrain() {
    const hue = curHue();
    const x0 = -view.pad, x1 = W + view.pad;
    // far ridge
    ctx.fillStyle = 'hsl(' + hue + ' 32% 13%)';
    ctx.beginPath(); ctx.moveTo(x0, H + 300);
    for (let x = x0; x <= x1; x += 8) ctx.lineTo(x, H * 0.70 + Math.sin(x * 0.008 + 4) * 10 + Math.sin(x * 0.02) * 4);
    ctx.lineTo(x1, H + 300); ctx.closePath(); ctx.fill();
    // main surface — tinted by the moon's mineral hue
    const g = ctx.createLinearGradient(0, H * 0.7, 0, H);
    g.addColorStop(0, 'hsl(' + hue + ' 26% 24%)'); g.addColorStop(0.25, 'hsl(' + hue + ' 25% 19%)'); g.addColorStop(1, 'hsl(' + hue + ' 28% 12%)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(x0, H + 300);
    for (let x = x0; x <= x1; x += 6) ctx.lineTo(x, surfaceY(x));
    ctx.lineTo(x1, H + 300); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(158,207,255,.20)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += 6) { const y = surfaceY(x); x === x0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.stroke();
    // craters
    for (let i = -3; i < 9; i++) {
      const cx2 = (W * 0.13) + i * W * 0.19, cy2 = surfaceY(cx2) + 14 + (Math.abs(i) % 3) * 8, cr = 7 + (Math.abs(i) % 3) * 5;
      if (cx2 < x0 || cx2 > x1) continue;
      ctx.strokeStyle = 'rgba(10,14,24,.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(cx2, cy2, cr, cr * 0.36, 0, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(170,195,230,.10)';
      ctx.beginPath(); ctx.ellipse(cx2, cy2 - 1.5, cr, cr * 0.36, 0, Math.PI, TAU); ctx.stroke();
    }
  }

  // ---- structures -----------------------------------------------------------
  function drawHub(t) {
    const { x, y } = hub;
    glow(x, y - 10, 40, '#9ecfff', 0.16);
    // main dome
    ctx.fillStyle = '#39465f';
    ctx.beginPath(); ctx.arc(x, y, 22, Math.PI, TAU); ctx.fill();
    const dg = ctx.createLinearGradient(x - 22, y - 22, x + 22, y);
    dg.addColorStop(0, 'rgba(158,207,255,.35)'); dg.addColorStop(0.5, 'rgba(158,207,255,.08)'); dg.addColorStop(1, 'rgba(0,0,0,.25)');
    ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(x, y, 22, Math.PI, TAU); ctx.fill();
    // side domes
    for (const dx of [-26, 24]) {
      ctx.fillStyle = '#2e3a51'; ctx.beginPath(); ctx.arc(x + dx, surfaceY(x + dx), 10, Math.PI, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(158,207,255,.12)'; ctx.beginPath(); ctx.arc(x + dx, surfaceY(x + dx), 10, Math.PI, TAU); ctx.fill();
    }
    // windows
    ctx.fillStyle = '#ffe9a8';
    for (let i = -2; i <= 2; i++) { ctx.globalAlpha = 0.55 + 0.45 * ((Math.sin(t * 1.7 + i * 2.1) + 1) / 2); ctx.fillRect(x + i * 6 - 1.4, y - 9, 2.8, 3.6); }
    ctx.globalAlpha = 1;
    // antenna + beacon
    ctx.strokeStyle = '#5a6c8c'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x, y - 22); ctx.lineTo(x, y - 34); ctx.stroke();
    blinker(x, y - 35, '#ff6a7a', t, 0);
    // landing pad
    ctx.fillStyle = '#232c40';
    ctx.beginPath(); ctx.ellipse(pad.x, pad.y + 2, 20, 5.5, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,210,77,.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(pad.x, pad.y + 2, 14, 3.6, 0, 0, TAU); ctx.stroke();
    for (let i = 0; i < 4; i++) blinker(pad.x + Math.cos(i / 4 * TAU + t * 0.8) * 17, pad.y + 2 + Math.sin(i / 4 * TAU + t * 0.8) * 4.4, '#ffd24d', t, i * 1.6);
  }
  function drawSite(s, t) {
    const { x, y, cat, col, lv } = s;
    const tier = lv >= 25 ? 4 : lv >= 15 ? 3 : lv >= 8 ? 2 : 1;
    const sc = 0.85 + tier * 0.15;
    if (s.dmg) {
      // OFFLINE — dark, sparking, smoking wreck
      ctx.save(); ctx.globalAlpha = 0.75; ctx.filter = 'grayscale(0.8) brightness(0.6)';
    }
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
    if (cat === 'mine') {
      // derrick + drill with pulsing output-colored core
      ctx.strokeStyle = '#4a5a78'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(0, -20); ctx.lineTo(8, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-4.5, -9); ctx.lineTo(4.5, -9); ctx.stroke();
      const pulse = (Math.sin(t * 3 + x) + 1) / 2;
      ctx.fillStyle = col; ctx.globalAlpha = 0.5 + pulse * 0.5;
      ctx.fillRect(-2, -6, 4, 6); ctx.globalAlpha = 1;
      glow(0, -3, 9 + pulse * 5, col, 0.35);
      ctx.fillStyle = '#333f58'; ctx.fillRect(-10, -2, 20, 3.5);
    } else if (cat === 'boost') {
      // refinery tanks + chimney lights
      ctx.fillStyle = '#3a4763';
      ctx.beginPath(); ctx.arc(-6, -6, 6, Math.PI, TAU); ctx.fill(); ctx.fillRect(-12, -6, 12, 7);
      ctx.beginPath(); ctx.arc(7, -4.5, 4.5, Math.PI, TAU); ctx.fill(); ctx.fillRect(2.5, -4.5, 9, 5.5);
      ctx.fillStyle = '#2c3750'; ctx.fillRect(-2, -16, 3.5, 11);
      blinker(-0.2, -17, '#7ce0a0', t, x);
    } else if (cat === 'storage') {
      ctx.fillStyle = '#3a4763'; ctx.fillRect(-9, -12, 18, 13);
      ctx.fillStyle = 'rgba(158,207,255,.15)'; ctx.fillRect(-9, -12, 18, 4);
      ctx.strokeStyle = '#2c3750'; ctx.strokeRect(-9, -12, 18, 13);
      blinker(0, -14, '#9ecfff', t, x * 2);
    } else { // defense — tower with sweeping dish
      ctx.fillStyle = '#3a4763'; ctx.fillRect(-3, -16, 6, 17);
      ctx.save(); ctx.translate(0, -17); ctx.rotate(Math.sin(t * 0.9 + x) * 0.7);
      ctx.strokeStyle = '#8fb5e8'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(0, 0, 5.5, -1.1, 1.1); ctx.stroke();
      ctx.fillStyle = '#ff6a7a'; ctx.beginPath(); ctx.arc(0, 0, 1.5, 0, TAU); ctx.fill();
      ctx.restore();
      glow(0, -17, 8, '#ff6a7a', 0.16);
    }
    ctx.restore();
    if (s.dmg) {
      ctx.restore(); // undo grayscale wrapper
      // red hazard blink + rising smoke
      const on = (Math.sin(t * 5 + x) + 1) / 2;
      if (on > 0.5) { ctx.fillStyle = '#ff4757'; ctx.beginPath(); ctx.arc(x, y - 24, 2.2, 0, TAU); ctx.fill(); glow(x, y - 24, 9, '#ff4757', 0.6); }
      ctx.font = '800 8px Orbitron, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,120,130,.9)'; ctx.fillText('OFFLINE', x, y - 32);
      if (Math.random() < 0.06) puffs.push({ x: x + rand(-6, 6), y: y - 10, r: rand(2, 4), col: '#3a3f4a', a: 0.8, vy: -18 });
      return; // no tier lights on a dead building
    }
    // tier lights along the base
    for (let i = 0; i < tier; i++) blinker(x - 8 + i * 5.5, y + 3.5, '#ffd24d', t, i * 2 + x);
  }

  // ---- mining ships + tractor beams ------------------------------------------
  function stepShip(sp, dt, t) {
    const hover = sp.site.y - 52;
    if (sp.state === 'mine') {
      sp.x += (sp.site.x - sp.x) * Math.min(1, dt * 2);
      sp.y = hover + Math.sin(t * 1.4 + sp.ph) * 4;
      sp.t -= dt;
      // spawn ore chunks up the beam
      if (Math.random() < dt * 3.2) oreParts.push({ x: sp.site.x + rand(-4, 4), y: sp.site.y - 2, ty: sp.y + 7, col: sp.site.col, v: rand(26, 40), a: 1 });
      if (sp.t <= 0) { sp.state = 'haul'; }
    } else if (sp.state === 'haul') {
      const tx = hub.x + rand(-1, 1), ty2 = hub.y - 42;
      sp.x += (tx - sp.x) * Math.min(1, dt * 1.1);
      sp.y += (ty2 - sp.y) * Math.min(1, dt * 1.1);
      if (Math.abs(sp.x - tx) < 6 && Math.abs(sp.y - ty2) < 6) { sp.state = 'drop'; sp.t = 0.8; }
    } else if (sp.state === 'drop') {
      sp.t -= dt;
      if (Math.random() < dt * 8) puffs.push({ x: sp.x + rand(-3, 3), y: sp.y + 8, r: 1.5, col: '#ffd24d', a: 0.9, vy: 26 });
      if (sp.t <= 0) { sp.state = 'return'; }
    } else { // return
      sp.x += (sp.site.x - sp.x) * Math.min(1, dt * 1.2);
      sp.y += (hover - sp.y) * Math.min(1, dt * 1.2);
      if (Math.abs(sp.x - sp.site.x) < 5) { sp.state = 'mine'; sp.t = rand(7, 15); }
    }
  }
  function drawShip(sp, t) {
    const { x, y } = sp;
    const moving = sp.state === 'haul' || sp.state === 'return';
    const dir = sp.state === 'haul' ? (hub.x < sp.site.x ? -1 : 1) : (sp.site.x < x ? -1 : 1);
    // tractor beam while mining — wobbling cone + bright core + rising rings
    if (sp.state === 'mine') {
      const gy = sp.site.y;
      const g = ctx.createLinearGradient(0, y, 0, gy);
      g.addColorStop(0, sp.site.col + '66'); g.addColorStop(1, sp.site.col + '08');
      ctx.fillStyle = g;
      const wob = 1 + Math.sin(t * 5 + sp.ph) * 0.6;
      ctx.beginPath();
      ctx.moveTo(x - 3 * wob, y + 7); ctx.lineTo(x + 3 * wob, y + 7);
      ctx.lineTo(x + 10, gy); ctx.lineTo(x - 10, gy); ctx.closePath(); ctx.fill();
      // bright core line
      ctx.strokeStyle = sp.site.col + 'aa'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x, y + 7); ctx.lineTo(x, gy); ctx.stroke();
      // rising energy rings
      for (let i = 0; i < 3; i++) {
        const ph = ((t * 0.7 + i / 3 + sp.ph) % 1);
        const ry = gy - (gy - y - 8) * ph;
        const rw = 3 + 6 * (1 - ph);
        ctx.strokeStyle = sp.site.col + Math.round((0.5 - ph * 0.4) * 255).toString(16).padStart(2, '0');
        ctx.beginPath(); ctx.ellipse(x, ry, rw, rw * 0.32, 0, 0, TAU); ctx.stroke();
      }
    }
    ctx.save(); ctx.translate(x, y);
    if (moving) ctx.transform(dir, 0, 0, 1, 0, 0);   // face travel direction
    // ambient under-glow
    glow(0, 6, 9, '#7fb8ff', 0.28);
    // —— HULL: industrial mining vessel ——
    // engine nacelles (rear-low, paired)
    ctx.fillStyle = '#2e3a51';
    ctx.beginPath(); ctx.roundRect(-13, 0.5, 6, 4, 2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(-11.5, -3.5, 5, 3.4, 1.6); ctx.fill();
    // thruster flame
    const fl = moving ? 1 : 0.35;
    const flick = 0.7 + Math.sin(t * 22 + sp.ph) * 0.3;
    ctx.fillStyle = 'rgba(127,190,255,' + (0.85 * fl * flick) + ')';
    ctx.beginPath(); ctx.moveTo(-13, 2.5); ctx.lineTo(-13 - 8 * fl * flick, 2.5 + rand(-0.6, 0.6)); ctx.lineTo(-13, 4.2); ctx.closePath(); ctx.fill();
    glow(-14, 2.8, 5 + 4 * fl, '#7fb8ff', 0.5 * fl);
    // main hull — angular freighter body with metallic shading
    const hg = ctx.createLinearGradient(0, -6, 0, 6);
    hg.addColorStop(0, '#8fa4c4'); hg.addColorStop(0.45, '#5a6c8c'); hg.addColorStop(0.55, '#46536e'); hg.addColorStop(1, '#2b3448');
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.moveTo(13.5, 0.5);            // nose tip
    ctx.lineTo(9, -3.6); ctx.lineTo(-2, -4.6); ctx.lineTo(-9, -3);
    ctx.lineTo(-10.5, 1.5); ctx.lineTo(-6, 4.6); ctx.lineTo(7, 4.4);
    ctx.closePath(); ctx.fill();
    // hull plating seams
    ctx.strokeStyle = 'rgba(10,16,28,.35)'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(-6, -3.8); ctx.lineTo(-4.6, 4.2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(2, -4.4); ctx.lineTo(3.4, 4.3); ctx.stroke();
    // hazard stripe (mining livery)
    ctx.fillStyle = 'rgba(255,190,70,.85)';
    ctx.fillRect(-2.6, 2.4, 7.6, 1.5);
    ctx.fillStyle = 'rgba(20,26,40,.8)';
    for (let i = 0; i < 3; i++) ctx.fillRect(-1.4 + i * 2.6, 2.4, 1.1, 1.5);
    // cockpit canopy — glass with sky reflection
    const cg = ctx.createLinearGradient(4, -6, 9, -1);
    cg.addColorStop(0, '#d9efff'); cg.addColorStop(0.5, '#7fc4ef'); cg.addColorStop(1, '#2c5f8a');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.moveTo(4, -3.9); ctx.quadraticCurveTo(8.5, -6.4, 10.6, -1.6); ctx.quadraticCurveTo(7, -2.8, 4, -1.8); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(230,245,255,.5)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(5, -4); ctx.quadraticCurveTo(8, -5.6, 10, -2.2); ctx.stroke();
    // dorsal sensor fin
    ctx.fillStyle = '#6b7d9e';
    ctx.beginPath(); ctx.moveTo(-3, -4.5); ctx.lineTo(-1.6, -7.6); ctx.lineTo(-0.4, -4.6); ctx.closePath(); ctx.fill();
    blinker(-1.6, -8.2, '#ff6a7a', t, sp.ph);
    // belly tractor emitter
    ctx.fillStyle = sp.state === 'mine' ? sp.site.col : '#3a4763';
    ctx.beginPath(); ctx.roundRect(-2.4, 4.4, 4.8, 2.4, 1.2); ctx.fill();
    if (sp.state === 'mine') glow(0, 6, 5, sp.site.col, 0.7);
    // cargo pods glow amber when hauling
    if (sp.state === 'haul') {
      ctx.fillStyle = sp.site.col;
      ctx.beginPath(); ctx.roundRect(-8.4, -2.4, 3.4, 4.6, 1.4); ctx.fill();
      glow(-6.7, 0, 6, sp.site.col, 0.55);
    }
    // running lights
    blinker(12, 0.4, '#7ce0a0', t, sp.ph + 2);
    ctx.restore();
  }

  // ---- drones -----------------------------------------------------------------
  function stepDrone(d, dt) {
    d.t += dt * d.spd * d.dir;
    if (d.t >= 1) { d.t = 1; d.dir = -1; if (sites.length) d.a = sites[Math.floor(Math.random() * sites.length)]; }
    if (d.t <= 0) { d.t = 0; d.dir = 1; }
    const mx = (d.a.x + d.b.x) / 2, my = Math.min(d.a.y, d.b.y) - d.h;
    const u = d.t, v = 1 - u;
    d.x = v * v * d.a.x + 2 * v * u * mx + u * u * d.b.x;
    d.y = v * v * (d.a.y - 14) + 2 * v * u * my + u * u * (d.b.y - 26);
    d.trail.unshift({ x: d.x, y: d.y }); if (d.trail.length > 7) d.trail.length = 7;
  }
  function drawDrone(d, t) {
    for (let i = 1; i < d.trail.length; i++) {
      ctx.globalAlpha = 0.28 * (1 - i / d.trail.length);
      ctx.fillStyle = '#7ce0a0'; ctx.fillRect(d.trail[i].x - 0.8, d.trail[i].y - 0.8, 1.6, 1.6);
    }
    ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(d.x, d.y);
    const tilt = Math.max(-0.35, Math.min(0.35, (d.dir > 0 ? 1 : -1) * 0.22));
    ctx.rotate(tilt);
    // rotor arms + spinning blade shimmer
    ctx.strokeStyle = '#4a5a78'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-4.6, -1.8); ctx.lineTo(4.6, -1.8); ctx.stroke();
    const spin = (t * 30) % 1;
    for (const rx of [-4.6, 4.6]) {
      ctx.fillStyle = 'rgba(180,220,255,' + (0.25 + spin * 0.3) + ')';
      ctx.beginPath(); ctx.ellipse(rx, -2.6, 3.4, 0.9, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#6b7d9e'; ctx.beginPath(); ctx.arc(rx, -2.2, 0.9, 0, TAU); ctx.fill();
    }
    // body — capsule with visor + belly light
    const bg = ctx.createLinearGradient(0, -3, 0, 3);
    bg.addColorStop(0, '#9fd8b4'); bg.addColorStop(0.5, '#5ba57a'); bg.addColorStop(1, '#2e5a44');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.roundRect(-3.4, -2.2, 6.8, 4.6, 2.2); ctx.fill();
    ctx.fillStyle = '#dffbe9';
    ctx.beginPath(); ctx.roundRect(-1.9, -1.2, 3.8, 1.6, 0.8); ctx.fill();
    // cargo hook / crate when heading home
    if (d.dir === -1) {
      ctx.strokeStyle = '#4a5a78'; ctx.beginPath(); ctx.moveTo(0, 2.4); ctx.lineTo(0, 4.2); ctx.stroke();
      ctx.fillStyle = '#c9a45a'; ctx.fillRect(-1.8, 4.2, 3.6, 3); 
      ctx.strokeStyle = 'rgba(20,26,40,.6)'; ctx.strokeRect(-1.8, 4.2, 3.6, 3);
    }
    ctx.restore();
    glow(d.x, d.y + 2, 5, '#7ce0a0', 0.3);
  }

  // ---- shuttle launch -----------------------------------------------------------
  function stepShuttle(dt) {
    if (!shuttle) {
      nextLaunch -= dt;
      if (nextLaunch <= 0) shuttle = { x: pad.x, y: pad.y - 6, vy: 0, t: 0 };
      return;
    }
    shuttle.t += dt;
    if (shuttle.t > 0.8) { shuttle.vy += dt * 90; shuttle.y -= shuttle.vy * dt; }
    if (Math.random() < (shuttle.t > 0.8 ? 0.9 : 0.3))
      puffs.push({ x: shuttle.x + rand(-2.5, 2.5), y: shuttle.y + 8, r: rand(1.5, 3), col: shuttle.t > 0.8 ? '#ffb45a' : '#8a97ad', a: 0.85, vy: -14 });
    if (shuttle.y < -30) { shuttle = null; nextLaunch = rand(14, 26); }
  }
  function drawShuttle() {
    if (!shuttle) return;
    const { x, y } = shuttle;
    ctx.fillStyle = '#c9d6ea';
    ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x + 3.4, y - 2); ctx.lineTo(x + 3.4, y + 6); ctx.lineTo(x - 3.4, y + 6); ctx.lineTo(x - 3.4, y - 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#8fb5e8'; ctx.beginPath(); ctx.arc(x, y - 3, 1.6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#7a2f3a';
    ctx.beginPath(); ctx.moveTo(x - 3.4, y + 6); ctx.lineTo(x - 6, y + 9); ctx.lineTo(x - 3.4, y + 2); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 3.4, y + 6); ctx.lineTo(x + 6, y + 9); ctx.lineTo(x + 3.4, y + 2); ctx.closePath(); ctx.fill();
    if (shuttle.t > 0.8) glow(x, y + 9, 10, '#ffb45a', 0.7);
  }

  // ---------------------------------------------------------------------------
  // MAIN LOOP
  // ---------------------------------------------------------------------------
  let last = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!cv || !cv.isConnected) { stop(); return; }
    const scr = document.getElementById('screen-moon');
    if (!scr || !scr.classList.contains('active')) return; // paused, keep rAF cheap
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    const t = (now - t0) / 1000;
    layout();
    drawSky(t);
    // —— WORLD SPACE: camera zooms out as the colony sprawls ——
    ctx.save();
    const ax = W * 0.5, ay = H * 0.96;
    ctx.translate(ax, ay); ctx.scale(view.z, view.z); ctx.translate(-ax, -ay);
    drawTerrain();
    for (const s of sites) drawSite(s, t);
    if (hub) drawHub(t);
    // ore particles
    for (let i = oreParts.length - 1; i >= 0; i--) {
      const p = oreParts[i];
      p.y -= p.v * dt; p.a -= dt * 0.5;
      if (p.y <= p.ty || p.a <= 0) { oreParts.splice(i, 1); continue; }
      ctx.globalAlpha = Math.max(0, p.a);
      ctx.fillStyle = p.col;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.y * 0.1); ctx.fillRect(-1.6, -1.6, 3.2, 3.2); ctx.restore();
      ctx.globalAlpha = 1;
    }
    // puffs (smoke / engine)
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];
      p.y += p.vy * dt; p.r += dt * 6; p.a -= dt * 1.4;
      if (p.a <= 0) { puffs.splice(i, 1); continue; }
      ctx.globalAlpha = Math.max(0, p.a) * 0.5; ctx.fillStyle = p.col;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    }
    for (const sp of ships) { stepShip(sp, dt, t); }
    for (const sp of ships) drawShip(sp, t);
    for (const d of drones) { stepDrone(d, dt); drawDrone(d, t); }
    stepShuttle(dt); drawShuttle();
    ctx.restore();
    // fill the sliver below the zoomed world with the deepest terrain tone
    const bottomY = ay + (H - ay) * view.z;
    if (bottomY < H) { ctx.fillStyle = 'hsl(' + curHue() + ' 28% 12%)'; ctx.fillRect(0, bottomY - 1, W, H - bottomY + 2); }
  }

  // ---------------------------------------------------------------------------
  function mount(canvas) {
    stop();
    cv = canvas; if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = cv.getBoundingClientRect();
    W = Math.max(300, rect.width); H = Math.max(160, rect.height);
    cv.width = W * dpr; cv.height = H * dpr;
    ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    stars = [];
    for (let i = 0; i < 60; i++) stars.push({ x: Math.random() * W, y: Math.random() * H * 0.62, r: Math.random() < 0.2 ? 1.6 : 1, c: Math.random() < 0.15 ? '#bcd7ff' : '#e8f0ff', tw: rand(0.6, 2.2), ph: rand(0, TAU) });
    lastBuildSig = ''; oreParts = []; puffs = []; shuttle = null; nextLaunch = 5;
    layout();
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function refresh() { lastBuildSig = ''; }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  window.MOONSCENE = { mount, stop, refresh, panTo: function () {} };
})();
