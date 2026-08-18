/* =============================================================================
   render.js — GrabAGun Idle Operator (SPACE THEME)
   Canvas drawing: galaxy/starfield arenas (distinct colors + black holes /
   planets per sector), an EVOLVING player STARSHIP (Scout → Bomber → Cruiser →
   Dreadnought → Super Carrier) with engine glow & shield aura, alien-vessel
   enemies, laser bolts, particles and floating combat text.
   ============================================================================= */
(function () {
  'use strict';
  const C = window.CONFIG;

  // ---- color helpers -------------------------------------------------------
  function hx(h) {
    if (h[0] === 'r') { const m = h.match(/[\d.]+/g); return [+m[0], +m[1], +m[2]]; }
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  }
  function mix(a, b, t) {
    const pa = hx(a), pb = hx(b);
    return `rgb(${Math.round(pa[0]+(pb[0]-pa[0])*t)},${Math.round(pa[1]+(pb[1]-pa[1])*t)},${Math.round(pa[2]+(pb[2]-pa[2])*t)})`;
  }
  const lighten = (c, t) => mix(c, '#ffffff', t);
  const darken  = (c, t) => mix(c, '#000000', t);
  function rgba(c, a) { const p = hx(c); return `rgba(${p[0]|0},${p[1]|0},${p[2]|0},${a})`; }
  function gearColor(equipped, slot, base) {
    const it = equipped[slot]; if (!it) return base;
    return mix(base, C.RARITY[it.rarity].color, Math.min(0.92, 0.22 + it.rarity * 0.12));
  }
  function auraOf(equipped) {
    let best = -1; C.SLOT_KEYS.forEach((s) => { if (equipped[s]) best = Math.max(best, equipped[s].rarity); });
    return best;
  }
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // =========================================================================
  // GALAXIES — each zone band is a distinct-looking sector of space
  // =========================================================================
  function biomeOf(zone) {
    if (zone < 1) return 'dock';
    if (zone <= 3) return 'azure';
    if (zone <= 6) return 'verdant';
    if (zone <= 10) return 'ember';
    if (zone <= 16) return 'violet';
    return 'void';
  }
  const GALAXY = {
    dock:    { a:'#10131c', b:'#070910', neb:'120,150,210', star:'#cfe0ff', feat:'station' },
    azure:   { a:'#0e1c40', b:'#060a18', neb:'80,140,255',  star:'#dcd9ff', feat:'planet' },
    verdant: { a:'#082818', b:'#04120c', neb:'52,224,150',  star:'#dffff0', feat:'planet' },
    ember:   { a:'#2e1206', b:'#140704', neb:'255,122,40',  star:'#ffe6cf', feat:'blackhole' },
    violet:  { a:'#22103c', b:'#0d081c', neb:'176,92,255',  star:'#f0dcff', feat:'planet' },
    void:    { a:'#1c0826', b:'#06030c', neb:'235,64,200',  star:'#ffd6f4', feat:'blackhole' },
  };
  const GAL_PROPS = ['asteroid', 'asteroid', 'debris', 'crystal', 'wreck', 'satellite'];

  // starfield + drifting space debris, cached per zone+size
  let _spaceKey = '', _stars = [], _props = [], _featPos = null;
  function spaceFor(zone, w, h) {
    const key = zone + 'x' + (w|0) + 'x' + (h|0);
    if (key === _spaceKey) return;
    _spaceKey = key;
    const r = rng((zone + 7) * 9301 + 49297);
    // stars
    _stars = [];
    const sc = Math.min(280, Math.round((w * h) / 2400));
    for (let i = 0; i < sc; i++) _stars.push({ x: r() * w, y: r() * h, s: 0.4 + r() * 1.6, tw: r() * 6.28, br: 0.3 + r() * 0.7 });
    // asteroids / debris
    _props = [];
    const pc = Math.min(26, Math.round((w * h) / (560 * 560)) + 5);
    let tries = 0;
    while (_props.length < pc && tries < pc * 8) {
      tries++;
      const x = 30 + r() * (w - 60), y = 30 + r() * (h - 60);
      if (Math.hypot(x - w/2, y - h/2) < 90) continue;
      _props.push({ type: GAL_PROPS[(r() * GAL_PROPS.length) | 0], x, y, s: 0.7 + r() * 0.9, seed: r(), rot: r() * 6.28 });
    }
    // major feature (planet / black hole / station) placed off to one side
    _featPos = { x: w * (0.18 + r() * 0.16), y: h * (0.16 + r() * 0.14), s: 0.8 + r() * 0.6 };
  }

  function drawProp(ctx, p, t) {
    const s = p.s * 16;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot + t * 0.05 * (p.seed > 0.5 ? 1 : -1));
    if (p.type === 'crystal') {
      ctx.fillStyle = 'rgba(150,200,255,0.5)'; ctx.strokeStyle = 'rgba(200,230,255,0.7)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0,-s*0.6); ctx.lineTo(s*0.3,0); ctx.lineTo(0,s*0.6); ctx.lineTo(-s*0.3,0); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (p.type === 'debris') {
      ctx.fillStyle = '#3a3f४a'.replace('४','4'); ctx.fillStyle = '#3a3f4a';
      for (let i = 0; i < 4; i++) { const a = p.seed*9 + i*1.7; ctx.beginPath(); ctx.arc(Math.cos(a)*s*0.4, Math.sin(a)*s*0.3, s*0.13, 0, 7); ctx.fill(); }
    } else if (p.type === 'wreck') {
      // derelict ship carcass — snapped fuselage + broken wing
      ctx.fillStyle = '#39404f'; ctx.strokeStyle = '#20242e'; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(-s*0.7, s*0.1); ctx.lineTo(s*0.15, -s*0.28); ctx.lineTo(s*0.55, -s*0.1); ctx.lineTo(s*0.3, s*0.22); ctx.lineTo(-s*0.4, s*0.32); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s*0.05, -s*0.2); ctx.lineTo(s*0.5, -s*0.75); ctx.lineTo(s*0.62, -s*0.5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,150,70,0.5)';
      ctx.beginPath(); ctx.arc(-s*0.15, s*0.05, s*0.08, 0, 7); ctx.fill();   // dying ember
      ctx.fillStyle = '#181b22';
      ctx.beginPath(); ctx.arc(s*0.2, -s*0.05, s*0.1, 0, 7); ctx.fill();     // breach hole
    } else if (p.type === 'satellite') {
      // dead satellite — body + solar panels adrift
      ctx.fillStyle = '#4a5163'; ctx.strokeStyle = '#262b36'; ctx.lineWidth = 1;
      ctx.fillRect(-s*0.16, -s*0.22, s*0.32, s*0.44); ctx.strokeRect(-s*0.16, -s*0.22, s*0.32, s*0.44);
      ctx.fillStyle = 'rgba(90,130,200,0.55)';
      ctx.fillRect(-s*0.85, -s*0.14, s*0.6, s*0.28); ctx.strokeRect(-s*0.85, -s*0.14, s*0.6, s*0.28);
      ctx.fillRect(s*0.25, -s*0.14, s*0.6, s*0.28); ctx.strokeRect(s*0.25, -s*0.14, s*0.6, s*0.28);
      ctx.strokeStyle = '#6b7688';
      ctx.beginPath(); ctx.moveTo(0, -s*0.22); ctx.lineTo(0, -s*0.5); ctx.stroke();
    } else { // asteroid
      const g = ctx.createRadialGradient(-s*0.2,-s*0.2,1,0,0,s*0.7); g.addColorStop(0,'#5b5550'); g.addColorStop(1,'#2b2723');
      ctx.fillStyle = g; ctx.strokeStyle = '#1c1916'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < 7; i++) { const a = i/7*Math.PI*2; const rr2 = s*(0.5 + ((Math.sin(p.seed*20+i*3)+1)/2)*0.3); ctx.lineTo(Math.cos(a)*rr2, Math.sin(a)*rr2); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  function drawFeature(ctx, gal, t) {
    if (!_featPos) return;
    const { x, y } = _featPos, s = _featPos.s;
    if (gal.feat === 'blackhole') {
      const R = 46 * s;
      // accretion glow
      const ag = ctx.createRadialGradient(x, y, 4, x, y, R * 1.6);
      ag.addColorStop(0, rgba('#ffffff', 0)); ag.addColorStop(0.5, `rgba(${gal.neb},0.25)`); ag.addColorStop(1, `rgba(${gal.neb},0)`);
      ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(x, y, R*1.6, 0, 7); ctx.fill();
      // accretion disc — two counter-rotating rings + hot inner edge
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * 0.25); ctx.scale(1, 0.4);
      ctx.strokeStyle = `rgba(${gal.neb},0.8)`; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,240,220,0.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, R*0.78, 0, 7); ctx.stroke();
      ctx.restore();
      ctx.save(); ctx.translate(x, y); ctx.rotate(-t * 0.14); ctx.scale(1, 0.34);
      ctx.strokeStyle = `rgba(${gal.neb},0.35)`; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(0, 0, R*1.22, 0, 7); ctx.stroke();
      ctx.restore();
      // gravitational lensing arc over the top
      ctx.strokeStyle = 'rgba(255,250,240,0.5)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(x, y, R*0.62, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      // event horizon
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(x, y, R*0.5, 0, 7); ctx.fill();
      ctx.strokeStyle = `rgba(${gal.neb},0.9)`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, R*0.5, 0, 7); ctx.stroke();
    } else if (gal.feat === 'planet') {
      const R = 52 * s;
      // body with deep day→night shading
      const g = ctx.createRadialGradient(x - R*0.42, y - R*0.42, 2, x, y, R*1.25);
      g.addColorStop(0, lighten(`rgb(${gal.neb})`, 0.45)); g.addColorStop(0.55, `rgb(${gal.neb})`); g.addColorStop(1, darken(`rgb(${gal.neb})`, 0.78));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.fill();
      // latitude bands
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.clip();
      ctx.globalAlpha = 0.16; ctx.fillStyle = darken(`rgb(${gal.neb})`, 0.3);
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.ellipse(x, y + i * R * 0.34, R, R * 0.11, -0.18, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1; ctx.restore();
      // terminator shadow (night side crescent)
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.clip();
      ctx.fillStyle = 'rgba(2,4,10,0.55)';
      ctx.beginPath(); ctx.arc(x + R*0.5, y + R*0.4, R*1.05, 0, 7); ctx.fill();
      ctx.restore();
      // atmosphere rim light
      ctx.strokeStyle = rgba(lighten(`rgb(${gal.neb})`, 0.5), 0.55); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(x, y, R + 1, 0, 7); ctx.stroke();
      // ring (behind handled cheaply: draw full, body overlap acceptable at distance)
      ctx.save(); ctx.translate(x, y); ctx.rotate(-0.4); ctx.scale(1, 0.32);
      ctx.strokeStyle = `rgba(${gal.neb},0.55)`; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, R*1.5, 0, 7); ctx.stroke();
      ctx.strokeStyle = `rgba(${gal.neb},0.25)`; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(0, 0, R*1.72, 0, 7); ctx.stroke();
      ctx.restore();
      // a small moon in slow orbit
      const ma = t * 0.18, mx = x + Math.cos(ma) * R * 1.9, my = y + Math.sin(ma) * R * 0.55;
      ctx.fillStyle = '#9aa3b5'; ctx.beginPath(); ctx.arc(mx, my, R * 0.12, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(2,4,10,0.45)'; ctx.beginPath(); ctx.arc(mx + R*0.04, my + R*0.03, R * 0.12, 0, 7); ctx.fill();
      ctx.fillStyle = '#c6cdd9'; ctx.beginPath(); ctx.arc(mx - R*0.03, my - R*0.03, R * 0.07, 0, 7); ctx.fill();
    } else { // station (dock)
      const R = 30 * s;
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * 0.1);
      ctx.strokeStyle = 'rgba(150,180,230,0.5)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.stroke();
      ctx.strokeStyle = 'rgba(150,180,230,0.25)'; ctx.lineWidth = 1.4;
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; ctx.beginPath(); ctx.moveTo(Math.cos(a)*R*0.35, Math.sin(a)*R*0.35); ctx.lineTo(Math.cos(a)*R, Math.sin(a)*R); ctx.stroke(); }
      ctx.fillStyle = 'rgba(120,150,210,0.4)'; ctx.beginPath(); ctx.arc(0, 0, R*0.35, 0, 7); ctx.fill();
      // blinking nav lights
      const bl = (Math.sin(t * 3) + 1) / 2;
      ctx.fillStyle = `rgba(255,120,120,${0.4 + bl * 0.6})`; ctx.beginPath(); ctx.arc(R, 0, 2, 0, 7); ctx.fill();
      ctx.fillStyle = `rgba(120,255,180,${1 - bl * 0.6})`; ctx.beginPath(); ctx.arc(-R, 0, 2, 0, 7); ctx.fill();
      ctx.restore();
    }
  }

  // =========================================================================
  // ARENA (deep space) — the static layer (bg gradient, nebula, props,
  // vignette) is rendered ONCE per zone/size into an offscreen canvas; only
  // stars (twinkle/parallax) and the major feature animate per frame.
  // =========================================================================
  let _bgCacheKey = '', _bgCache = null;
  function drawArena(ctx, w, h, t, zone) {
    zone = zone || 0;
    const gal = GALAXY[biomeOf(zone)];
    spaceFor(zone, w, h);
    const key = zone + 'x' + (w | 0) + 'x' + (h | 0);
    if (key !== _bgCacheKey || !_bgCache) {
      _bgCacheKey = key;
      _bgCache = document.createElement('canvas');
      _bgCache.width = Math.max(1, w | 0); _bgCache.height = Math.max(1, h | 0);
      const b = _bgCache.getContext('2d');
      const bg = b.createRadialGradient(w/2, h/2, 30, w/2, h/2, Math.max(w,h)*0.75);
      bg.addColorStop(0, gal.a); bg.addColorStop(1, gal.b);
      b.fillStyle = bg; b.fillRect(0, 0, w, h);
      // nebula clouds
      const nr = rng((zone+3)*2654435761 >>> 0);
      for (let i = 0; i < 3; i++) {
        const cx = nr() * w, cy = nr() * h, R = (180 + nr() * 220);
        const ng = b.createRadialGradient(cx, cy, 10, cx, cy, R);
        ng.addColorStop(0, `rgba(${gal.neb},0.14)`); ng.addColorStop(1, `rgba(${gal.neb},0)`);
        b.fillStyle = ng; b.fillRect(cx - R, cy - R, R*2, R*2);
      }
      // drifting debris/asteroids (baked — their slow spin is imperceptible)
      for (const p of _props) drawProp(b, p, 0);
      // soft vignette
      const v = b.createRadialGradient(w/2, h/2, h*0.35, w/2, h/2, h*0.85);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
      b.fillStyle = v; b.fillRect(0, 0, w, h);
    }
    ctx.drawImage(_bgCache, 0, 0);
    // starfield — 3 parallax depth bands drifting past (cheap rects, batched)
    ctx.fillStyle = gal.star;
    for (let i = 0; i < _stars.length; i++) {
      const st = _stars[i];
      const depth = i % 3;
      const yy = (st.y + t * (3 + depth * 7)) % h;
      ctx.globalAlpha = st.br * (0.45 + 0.45 * Math.sin(t * 2 + st.tw)) * (0.55 + depth * 0.22);
      const s2 = st.s * (0.75 + depth * 0.2);
      ctx.fillRect(st.x, yy, s2, s2);
    }
    ctx.globalAlpha = 1;
    // occasional shooting star (one brief streak every ~8s, deterministic)
    {
      const cycle = 8, ph = (t % cycle) / cycle;
      if (ph < 0.16) {
        const sr2 = rng(((t / cycle) | 0) * 977 + zone * 31 + 5);
        const sx = sr2() * w * 0.8, sy = sr2() * h * 0.5, k = ph / 0.16;
        const px = sx + k * 170, py = sy + k * 64;
        ctx.strokeStyle = `rgba(220,235,255,${0.7 * (1 - k)})`;
        ctx.lineWidth = 1.4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(px - 40, py - 15); ctx.lineTo(px, py); ctx.stroke();
      }
    }
    // major feature (planet / black hole / station) stays live — one per scene
    drawFeature(ctx, gal, t);
  }

  // =========================================================================
  // ENEMIES — alien vessels (one parametric drawer, varied by type)
  // =========================================================================
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function fc(color, flash) { return flash > 0 ? mix(color, '#ffffff', flash * 0.85) : color; }

  function drawEnemy(ctx, e) {
    if (e.isCitadel) return drawCitadel(ctx, e);
    const scale = e.dying ? (1 - e.deathT) : (0.35 + 0.65 * easeOut(e.spawnT));
    const alpha = e.dying ? (1 - e.deathT) : 1;
    const lunge = e.attackLunge > 0 ? Math.sin(e.attackLunge * Math.PI) * 4 : 0;
    const frosted = !e.dying && (e.frozenT > 0 || e.chillT > 0);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (e.isBoss && !e.dying) {
      const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 240);
      // drawn in the boss's own space, so one cached gradient serves them all;
      // the pulse rides globalAlpha instead of a rebuilt colour stop
      const R = e.size * 2.4;
      ctx.save(); ctx.translate(e.x, e.y); ctx.scale(R, R);
      if (!_bossAura) {
        _bossAura = ctx.createRadialGradient(0, 0, 0.04, 0, 0, 1);
        _bossAura.addColorStop(0, 'rgba(226,59,78,0.22)');
        _bossAura.addColorStop(1, 'rgba(226,59,78,0)');
      }
      ctx.globalAlpha = pulse;
      ctx.fillStyle = _bossAura; ctx.beginPath(); ctx.arc(0, 0, 1, 0, 7); ctx.fill();
      ctx.globalAlpha = 1; ctx.restore();
    }
    ctx.translate(e.x + (e.dir < 0 ? -lunge : lunge), e.y);
    if (e.spriteImg && e.spriteImg.complete && e.spriteImg.naturalWidth) {
      // HERO SPRITE (Dreadnaught raid boss) — draw the art instead of the alien mesh.
      const img = e.spriteImg;
      const dw = e.size * 2.7, dh = dw * (img.naturalHeight / img.naturalWidth);
      ctx.scale(scale, scale);                       // no dir-mirror: keep the art crisp
      ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
      if (e.hitFlash > 0) {                           // hit flash: additive white wash
        ctx.globalAlpha = alpha * e.hitFlash * 0.6;
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = alpha;
      }
    } else {
      ctx.scale(e.dir * scale, scale);
      drawAlien(ctx, e, e.hitFlash > 0 ? e.hitFlash : 0);
    }
    ctx.restore();

    // FROSTYFROST cryo overlays — chilled: icy tint + drifting flakes; frozen:
    // a full translucent ICE CUBE encasing the vessel (layered alpha, no blur)
    if (frosted) {
      const t = performance.now() / 1000;
      ctx.save();
      ctx.translate(e.x, e.y);
      if (e.frozenT > 0) {
        const cs = e.size * 1.55;
        const fade = Math.min(1, e.frozenT / 0.3) * Math.min(1, (1.8 - e.frozenT) / 0.15 + 0.2);  // ease in AND melt out
        ctx.globalAlpha = alpha * fade;
        // cube body
        ctx.fillStyle = 'rgba(150,214,255,0.24)';
        rr(ctx, -cs, -cs, cs * 2, cs * 2, cs * 0.22); ctx.fill();
        // inner glow core
        ctx.fillStyle = 'rgba(220,245,255,0.13)';
        rr(ctx, -cs * 0.7, -cs * 0.7, cs * 1.4, cs * 1.4, cs * 0.18); ctx.fill();
        // bevel edges
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(230,250,255,0.7)';
        rr(ctx, -cs, -cs, cs * 2, cs * 2, cs * 0.22); ctx.stroke();
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(160,220,255,0.4)';
        rr(ctx, -cs * 0.82, -cs * 0.82, cs * 1.64, cs * 1.64, cs * 0.16); ctx.stroke();
        // specular sheen streak — STEADY (the old per-frame sin pulse read as flicker)
        ctx.globalAlpha = alpha * fade * 0.55;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-cs * 0.55, -cs * 0.75); ctx.lineTo(-cs * 0.05, -cs * 0.25); ctx.stroke();
      } else {
        // chilled — icy ring. Dash-state + flakes only in SMALL fights: 40 chilled
        // raiders paying per-frame dash churn was a real lag source in defenses.
        const crowd = window.GAME && window.GAME.rt && window.GAME.rt.enemies.length > 18;
        ctx.globalAlpha = alpha * 0.35;
        ctx.strokeStyle = 'rgba(150,214,255,0.6)'; ctx.lineWidth = 1.5;
        if (!crowd) { ctx.setLineDash([5, 6]); ctx.lineDashOffset = -t * 8; }
        ctx.beginPath(); ctx.arc(0, 0, e.size * 1.25, 0, 7); ctx.stroke();
        if (!crowd) {
          ctx.setLineDash([]);
          ctx.fillStyle = '#cdeeff';
          for (let i = 0; i < 3; i++) {
            const sa = e.seed * 3 + i * 2.1 + t * 0.5;
            ctx.globalAlpha = alpha * 0.3;
            ctx.fillRect(Math.cos(sa) * e.size * 1.1 - 1, Math.sin(sa + t * 0.7) * e.size * 1.1 - 1, 2, 2);
          }
        }
      }
      ctx.restore();
    }

    if (!e.dying && e.hp < e.maxHp) {
      // impact shockwave — a quick expanding ring right after a hit lands
      if (e.hitFlash > 0) {
        const k = 1 - e.hitFlash;
        ctx.globalAlpha = e.hitFlash * 0.75;
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.6 * e.hitFlash;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.size * (0.85 + k * 1.1), 0, 7); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const bw = Math.max(26, e.size * 2.1), bh = 5;
      const bx = e.x - bw/2, by = e.y - e.size - 16;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; rr(ctx, bx-1.5, by-1.5, bw+3, bh+3, 3); ctx.fill();
      ctx.fillStyle = '#3a0e12'; rr(ctx, bx, by, bw, bh, 2.5); ctx.fill();
      const pct = Math.max(0, e.hp/e.maxHp);
      ctx.fillStyle = pct > 0.5 ? '#e23b4e' : pct > 0.25 ? '#e8a13b' : '#e8d03b';
      rr(ctx, bx, by, bw*pct, bh, 2.5); ctx.fill();
      if (e.isBoss) {
        ctx.fillStyle = '#e23b4e'; setFont(ctx, '800 12px Rajdhani, sans-serif'); ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.strokeText('\u2620 ' + (e.name || 'BOSS'), e.x, by - 6); ctx.fillText('\u2620 ' + (e.name || 'BOSS'), e.x, by - 6);
      }
    }
  }

  // ---- GRADIENT CACHE ------------------------------------------------------
  // Keyed by colour + size, bounded, and only used while an object is NOT
  // flashing (a hit tints the skin continuously, which would thrash the cache
  // for the fraction of a second it lasts).
  const _gc = new Map();
  let _bossAura = null;
  function hullGrad(ctx, key, x0, y0, x1, y1, c0, c1, c2) {
    let gr = _gc.get(key);
    if (gr) return gr;
    if (_gc.size > 240) _gc.clear();
    gr = ctx.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, c0); gr.addColorStop(0.5, c1); gr.addColorStop(1, c2);
    _gc.set(key, gr);
    return gr;
  }

  // ENEMY VESSELS — each type is a distinct space silhouette, all tinted by
  // e.tint and animated off e.walk (no shadowBlur in this hot path):
  //   zombie   → derelict hulk drone (boxy, corroded, sputtering engine)
  //   skeleton → raider dart fighter (needle fuselage, swept X-fins)
  //   mutant   → asteroid rock-beast (tumbling rock, magma core, rubble moons)
  //   alien    → organic alien vessel (the classic winged bio-ship)
  //   dragon   → capital gunship (broad armored wedge, turrets, triple engines)
  function drawAlien(ctx, e, flash) {
    const k = e.type.key;
    if (k === 'zombie') return drawDerelict(ctx, e, flash);
    if (k === 'skeleton') return drawRaider(ctx, e, flash);
    if (k === 'mutant') return drawRockBeast(ctx, e, flash);
    if (k === 'dragon') return drawCapital(ctx, e, flash);
    return drawOrganic(ctx, e, flash);
  }

  // organic alien bio-ship (the original vessel — alien type + fallback)
  function drawOrganic(ctx, e, flash) {
    const s = e.size, skin = fc(e.tint, flash);
    ctx.rotate(Math.sin(e.walk * 2) * 0.06);
    // engine glow trail
    ctx.fillStyle = rgba(lighten(skin, 0.2), 0.5);
    ctx.beginPath(); ctx.ellipse(0, s*0.85, s*0.3, s*0.5, 0, 0, 7); ctx.fill();
    // wings
    ctx.fillStyle = darken(skin, 0.35); ctx.strokeStyle = darken(skin, 0.55); ctx.lineWidth = 1.4;
    [[-1],[1]].forEach(([d]) => { ctx.beginPath(); ctx.moveTo(d*s*0.2,-s*0.1); ctx.lineTo(d*s*1.3,s*0.2); ctx.lineTo(d*s*0.4,s*0.6); ctx.closePath(); ctx.fill(); ctx.stroke(); });
    // hull
    const g = flash > 0.01 ? (() => { const q = ctx.createLinearGradient(-s*0.6,0,s*0.6,0); q.addColorStop(0, darken(skin,0.3)); q.addColorStop(0.5, skin); q.addColorStop(1, lighten(skin,0.16)); return q; })()
      : hullGrad(ctx, 'h1|' + skin + '|' + (s|0), -s*0.6,0,s*0.6,0, darken(skin,0.3), skin, lighten(skin,0.16));
    ctx.fillStyle = g; ctx.strokeStyle = darken(skin,0.5); ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -s*0.85);
    ctx.quadraticCurveTo(s*0.56, -s*0.2, s*0.45, s*0.7);
    ctx.quadraticCurveTo(0, s*0.95, -s*0.45, s*0.7);
    ctx.quadraticCurveTo(-s*0.56, -s*0.2, 0, -s*0.85);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // plating ridge
    ctx.strokeStyle = darken(skin, 0.32); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0,-s*0.68); ctx.lineTo(0,s*0.7); ctx.stroke();
    // glowing core
    ctx.globalAlpha = 0.45; ctx.fillStyle = '#7fe0ff';
    ctx.beginPath(); ctx.arc(0, -s*0.1, s*0.3, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(0, -s*0.1, s*0.18, 0, 7); ctx.fill();
    ctx.fillStyle = '#0a0c10'; ctx.beginPath(); ctx.arc(0, -s*0.1, s*0.08, 0, 7); ctx.fill();
    // nose spikes
    ctx.fillStyle = darken(skin, 0.2);
    for (let i = -1; i <= 1; i += 2) { ctx.beginPath(); ctx.moveTo(i*s*0.3,-s*0.5); ctx.lineTo(i*s*0.55,-s*0.85); ctx.lineTo(i*s*0.2,-s*0.55); ctx.closePath(); ctx.fill(); }
  }

  // derelict hulk drone — corroded box hull, breach holes, sputtering engine
  function drawDerelict(ctx, e, flash) {
    const s = e.size, skin = fc(e.tint, flash), t = e.walk;
    ctx.rotate(Math.sin(t * 1.3) * 0.09);
    const flick = (Math.sin(t * 9) + Math.sin(t * 23)) > 0.6 ? 1 : 0.25;   // engine sputter
    ctx.fillStyle = rgba('#ffb057', 0.5 * flick);
    ctx.beginPath(); ctx.ellipse(0, s*0.8, s*0.26, s*0.5*flick, 0, 0, 7); ctx.fill();
    // boxy corroded hull
    const g = flash > 0.01 ? (() => { const q = ctx.createLinearGradient(-s*0.6,0,s*0.6,0); q.addColorStop(0, darken(skin,0.4)); q.addColorStop(0.5, darken(skin,0.1)); q.addColorStop(1, lighten(skin,0.08)); return q; })()
      : hullGrad(ctx, 'h2|' + skin + '|' + (s|0), -s*0.6,0,s*0.6,0, darken(skin,0.4), darken(skin,0.1), lighten(skin,0.08));
    ctx.fillStyle = g; ctx.strokeStyle = darken(skin, 0.55); ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-s*0.45, -s*0.75); ctx.lineTo(s*0.3, -s*0.85); ctx.lineTo(s*0.55, -s*0.3);
    ctx.lineTo(s*0.5, s*0.6); ctx.lineTo(-s*0.35, s*0.7); ctx.lineTo(-s*0.6, s*0.1);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // breach holes
    ctx.fillStyle = darken(skin, 0.5);
    ctx.beginPath(); ctx.arc(s*0.18, s*0.25, s*0.16, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(-s*0.25, -s*0.3, s*0.1, 0, 7); ctx.fill();
    // bent antenna
    ctx.strokeStyle = darken(skin, 0.35); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-s*0.1, -s*0.8); ctx.lineTo(-s*0.3, -s*1.15); ctx.lineTo(-s*0.18, -s*1.3); ctx.stroke();
    // dim flickering eye
    ctx.globalAlpha = 0.4 * (0.5 + 0.5 * flick); ctx.fillStyle = '#ffcf6a';
    ctx.beginPath(); ctx.arc(0, -s*0.15, s*0.28, 0, 7); ctx.fill();
    ctx.globalAlpha = 0.5 + 0.5 * flick;
    ctx.beginPath(); ctx.arc(0, -s*0.15, s*0.14, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // raider dart fighter — needle fuselage, swept X-fins, twin blue engines
  function drawRaider(ctx, e, flash) {
    const s = e.size, skin = fc(e.tint, flash);
    ctx.rotate(Math.sin(e.walk * 2) * 0.05);
    ctx.fillStyle = rgba('#7fd1ff', 0.55);
    [[-0.3],[0.3]].forEach(([d]) => { ctx.beginPath(); ctx.ellipse(s*d, s*0.75, s*0.14, s*0.42, 0, 0, 7); ctx.fill(); });
    // swept fins (X silhouette)
    ctx.fillStyle = darken(skin, 0.3); ctx.strokeStyle = darken(skin, 0.5); ctx.lineWidth = 1.2;
    [[-1],[1]].forEach(([d]) => {
      ctx.beginPath(); ctx.moveTo(d*s*0.12, -s*0.2); ctx.lineTo(d*s*1.05, -s*0.55); ctx.lineTo(d*s*0.35, s*0.05); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(d*s*0.15, s*0.15); ctx.lineTo(d*s*0.9, s*0.7); ctx.lineTo(d*s*0.3, s*0.55); ctx.closePath(); ctx.fill(); ctx.stroke();
    });
    // needle fuselage
    const g = flash > 0.01 ? (() => { const q = ctx.createLinearGradient(-s*0.3,0,s*0.3,0); q.addColorStop(0, darken(skin,0.25)); q.addColorStop(0.5, skin); q.addColorStop(1, lighten(skin,0.15)); return q; })()
      : hullGrad(ctx, 'h3|' + skin + '|' + (s|0), -s*0.3,0,s*0.3,0, darken(skin,0.25), skin, lighten(skin,0.15));
    ctx.fillStyle = g; ctx.strokeStyle = darken(skin, 0.45); ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(0, -s*1.15);
    ctx.lineTo(s*0.22, -s*0.1); ctx.lineTo(s*0.28, s*0.65); ctx.lineTo(0, s*0.8);
    ctx.lineTo(-s*0.28, s*0.65); ctx.lineTo(-s*0.22, -s*0.1);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // red cockpit slit
    ctx.fillStyle = '#ff5f6b';
    ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.ellipse(0, -s*0.45, s*0.18, s*0.42, 0, 0, 7); ctx.fill();
    ctx.globalAlpha = 1; ctx.beginPath(); ctx.ellipse(0, -s*0.45, s*0.09, s*0.3, 0, 0, 7); ctx.fill();
  }

  // asteroid rock-beast — tumbling rock body, pulsing magma core, rubble moons
  function drawRockBeast(ctx, e, flash) {
    const s = e.size, t = e.walk;
    const rock = fc('#5a4c42', flash), glow = e.tint;
    ctx.rotate(t * 0.3);
    // irregular rock silhouette (deterministic per size)
    ctx.fillStyle = rock; ctx.strokeStyle = darken(rock, 0.4); ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2;
      const rr2 = s * (0.75 + 0.28 * Math.sin(i * 12.9898 + s));
      const x = Math.cos(a) * rr2, y = Math.sin(a) * rr2;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // craters
    ctx.fillStyle = darken(rock, 0.25);
    ctx.beginPath(); ctx.arc(s*0.3, -s*0.15, s*0.18, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(-s*0.35, s*0.3, s*0.13, 0, 7); ctx.fill();
    // magma cracks + core (pulsing, tinted)
    const pulse = 0.6 + 0.4 * Math.sin(t * 3);
    ctx.strokeStyle = rgba(glow, 0.85 * pulse); ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(s*0.55, s*0.25);
    ctx.moveTo(0, 0); ctx.lineTo(-s*0.5, s*0.1);
    ctx.moveTo(0, 0); ctx.lineTo(s*0.1, -s*0.6);
    ctx.stroke();
    ctx.globalAlpha = 0.5 * pulse; ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, s*0.3, 0, 7); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = lighten(glow, 0.3);
    ctx.beginPath(); ctx.arc(0, 0, s*0.15, 0, 7); ctx.fill();
    // orbiting rubble moons
    ctx.fillStyle = darken(rock, 0.15);
    for (let i = 0; i < 3; i++) {
      const a = t * 1.4 + i * 2.1;
      ctx.beginPath(); ctx.arc(Math.cos(a)*s*1.25, Math.sin(a)*s*0.75, s*0.11, 0, 7); ctx.fill();
    }
  }

  // capital gunship — broad armored wedge, batwing pylons, turrets, 3 engines
  function drawCapital(ctx, e, flash) {
    const s = e.size, skin = fc(e.tint, flash), t = e.walk;
    ctx.rotate(Math.sin(t * 1.1) * 0.04);
    // triple engine wash
    ctx.fillStyle = rgba(lighten(skin, 0.25), 0.5);
    [-0.45, 0, 0.45].forEach((d) => { ctx.beginPath(); ctx.ellipse(s*d, s*0.85, s*0.16, s*(d === 0 ? 0.55 : 0.45), 0, 0, 7); ctx.fill(); });
    // batwing pylons
    ctx.fillStyle = darken(skin, 0.35); ctx.strokeStyle = darken(skin, 0.55); ctx.lineWidth = 1.4;
    [[-1],[1]].forEach(([d]) => {
      ctx.beginPath(); ctx.moveTo(d*s*0.25, -s*0.35);
      ctx.quadraticCurveTo(d*s*1.5, -s*0.15, d*s*1.25, s*0.55);
      ctx.lineTo(d*s*0.45, s*0.5); ctx.closePath(); ctx.fill(); ctx.stroke();
    });
    // broad wedge hull
    const g = flash > 0.01 ? (() => { const q = ctx.createLinearGradient(-s*0.7,0,s*0.7,0); q.addColorStop(0, darken(skin,0.3)); q.addColorStop(0.5, skin); q.addColorStop(1, lighten(skin,0.16)); return q; })()
      : hullGrad(ctx, 'h4|' + skin + '|' + (s|0), -s*0.7,0,s*0.7,0, darken(skin,0.3), skin, lighten(skin,0.16));
    ctx.fillStyle = g; ctx.strokeStyle = darken(skin, 0.5); ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -s*1.0);
    ctx.lineTo(s*0.55, -s*0.3); ctx.lineTo(s*0.7, s*0.55); ctx.lineTo(s*0.3, s*0.8);
    ctx.lineTo(-s*0.3, s*0.8); ctx.lineTo(-s*0.7, s*0.55); ctx.lineTo(-s*0.55, -s*0.3);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // armor ridges
    ctx.strokeStyle = darken(skin, 0.3); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-s*0.35, -s*0.25); ctx.lineTo(-s*0.35, s*0.6); ctx.moveTo(s*0.35, -s*0.25); ctx.lineTo(s*0.35, s*0.6); ctx.stroke();
    // turrets
    ctx.fillStyle = darken(skin, 0.15);
    [[-0.35, 0.1], [0.35, 0.1], [0, 0.45]].forEach(([dx, dy]) => { ctx.beginPath(); ctx.arc(s*dx, s*dy, s*0.13, 0, 7); ctx.fill(); });
    // menacing reactor core
    const pulse = 0.7 + 0.3 * Math.sin(t * 4);
    ctx.globalAlpha = 0.45 * pulse; ctx.fillStyle = '#ff6a3a';
    ctx.beginPath(); ctx.arc(0, -s*0.25, s*0.32, 0, 7); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = '#ffd0a0';
    ctx.beginPath(); ctx.arc(0, -s*0.25, s*0.14, 0, 7); ctx.fill();
  }

  // =========================================================================
  // PROJECTILES — visuals branch on the weapon CLASS that fired them
  // (p.wtype: laser / gatling / missile / rail / plasma; drones override)
  // =========================================================================
  const WSTYLE = {
    laser:   { trail: '95,209,255',  trailW: 1.6 },
    gatling: { trail: '255,210,80',  trailW: 1.6 },
    missile: { trail: '170,170,170', trailW: 2.6 },
    rail:    { trail: '184,123,255', trailW: 2.2 },
    plasma:  { trail: '70,210,122',  trailW: 2.4 },
    support: { trail: '124,224,160', trailW: 2.0 },
    // Drone tracers used to be the thinnest bolt in the game (trailW 1.6, a 5.4
    // dash) fired by ONE sprite on a small bay — "you can barely even see them
    // firing". Widened to near-parity with the gatling tracer; damage untouched.
    drone:   { trail: '150,255,215', trailW: 2.4 },
  };
  // TITAN SINA — full-spectrum tracer palette (r,g,b strings, cheap to slot into rgba())
  const SINA_COLS = ['255,80,80','255,170,60','255,235,90','120,255,130','80,210,255','150,130,255','255,110,235'];
  // hulls whose cannons fire full-rainbow streaks (Titan Sina + the Chroma line)
  const RAINBOW_TRACER = { titansina: 1, chromafang: 1, chromaregent: 1 };
  // ---- RENDER LOD (set per frame by the game loop's governor) --------------
  // 0 full · 1 trimmed · 2 survival. The projectile pass is the hottest loop in
  // the file — up to 240 bolts x (trail segments x 2 strokes + bloom) — so this
  // is where the levels bite hardest.
  let _LOD = 0;
  function setLOD(v) { _LOD = v | 0; }
  // Read side of the governor. Other in-world renderers (home-citadel's fort and
  // city pass) have to shed on the same signal, and had no way to ask for it.
  function getLOD() { return _LOD; }
  function drawArrow(ctx, p) {
    const wt = p.drone ? 'drone' : (WSTYLE[p.wtype] ? p.wtype : 'gatling');
    const st = WSTYLE[wt];
    const tnow = performance.now() / 1000;
    // SPECTRUM TECH + TITAN SINA — every player bolt becomes a rainbow tracer
    const sina = !p.drone && RAINBOW_TRACER[activeShipKey()];
    // trail (missiles leave smoke; energy weapons leave light) — fat additive bloom
    const tCol = sina ? SINA_COLS[Math.abs((p.x * 3 + p.y * 5) | 0) % SINA_COLS.length]
                      : (p.crit ? '255,210,80' : st.trail);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    if (_LOD >= 2) {
      // SURVIVAL — the whole trail is ONE stroke tail→head. Reads as a tracer,
      // costs 1/14th of the full pass.
      const n = p.trail.length;
      if (n > 1) {
        ctx.strokeStyle = `rgba(${tCol},0.45)`;
        ctx.lineWidth = (p.crit ? 3.2 : st.trailW) + 0.6;
        ctx.beginPath(); ctx.moveTo(p.trail[0].x, p.trail[0].y); ctx.lineTo(p.trail[n-1].x, p.trail[n-1].y); ctx.stroke();
      }
    } else for (let i = 1; i < p.trail.length; i++) {
      const k = i / p.trail.length;
      const a = k * (p.crit ? 0.85 : (wt === 'missile' ? 0.5 : 0.7));
      if (!_LOD) {
        // wide soft glow under-pass — the first thing shed under load
        ctx.strokeStyle = `rgba(${tCol},${a * 0.35})`;
        ctx.lineWidth = (p.crit ? 8 : st.trailW * 2.4) * k + 1.5;
        ctx.beginPath(); ctx.moveTo(p.trail[i-1].x, p.trail[i-1].y); ctx.lineTo(p.trail[i].x, p.trail[i].y); ctx.stroke();
      }
      // bright core
      ctx.strokeStyle = `rgba(${tCol},${a})`;
      ctx.lineWidth = (p.crit ? 3.6 : st.trailW) * k + 0.6;
      ctx.beginPath(); ctx.moveTo(p.trail[i-1].x, p.trail[i-1].y); ctx.lineTo(p.trail[i].x, p.trail[i].y); ctx.stroke();
    }
    ctx.restore();
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
    const cs = (p.crit ? 1.45 : 1) * 1.6;            // bigger, beefier shots
    // additive bloom halo around every bolt head
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    if (_LOD < 2) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = 'rgba(' + tCol + ',1)';
      ctx.beginPath(); ctx.arc(0, 0, 6 * cs, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 0.85; ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(0, 0, 2.2 * cs, 0, 7); ctx.fill(); ctx.restore();
    // (all projectile styles below use layered alpha shapes — NO shadowBlur,
    // no per-bolt gradients: these run hundreds of times per frame)
    if (sina) {
      // TITAN SINA tracer — hot rainbow dash, hue shifts as the round flies
      const col = 'rgb(' + tCol + ')';
      ctx.globalAlpha = 0.45; ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(0, 0, 9 * cs, 3 * cs, 0, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(0, 0, 6 * cs, 1.6 * cs, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(2.2 * cs, 0, 2 * cs, 1 * cs, 0, 0, 7); ctx.fill();
    } else if (wt === 'laser') {
      // a searing light lance — dim wide pass + white-hot core
      const L = 26 * cs;
      ctx.lineCap = 'round';
      ctx.strokeStyle = p.crit ? 'rgba(255,210,80,0.35)' : 'rgba(95,209,255,0.35)';
      ctx.lineWidth = 5 * cs;
      ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(4, 0); ctx.stroke();
      ctx.strokeStyle = p.crit ? '#ffe9b0' : '#dff4ff'; ctx.lineWidth = 1.8 * cs;
      ctx.beginPath(); ctx.moveTo(-L * 0.7, 0); ctx.lineTo(4, 0); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(4, 0, 1.6 * cs, 0, 7); ctx.fill();
    } else if (wt === 'missile') {
      // a real rocket — capsule body, tinted nose, fins, flickering exhaust
      const fl = 0.6 + 0.4 * Math.sin(tnow * 40 + p.x);
      ctx.fillStyle = `rgba(255,170,80,${0.7 * fl})`;
      ctx.beginPath(); ctx.moveTo(-5 * cs, 0); ctx.lineTo(-11 * cs * (0.7 + fl * 0.5), 1.7); ctx.lineTo(-11 * cs * (0.7 + fl * 0.5), -1.7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#c8ccd4';
      rr(ctx, -5 * cs, -1.9 * cs, 8.4 * cs, 3.8 * cs, 1.8 * cs); ctx.fill();
      ctx.fillStyle = p.crit ? '#ffd24d' : '#ff6a4a';
      ctx.beginPath(); ctx.moveTo(3.4 * cs, -1.9 * cs); ctx.quadraticCurveTo(7.2 * cs, 0, 3.4 * cs, 1.9 * cs); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#7d828c';
      ctx.beginPath(); ctx.moveTo(-5 * cs, -1.9 * cs); ctx.lineTo(-7.6 * cs, -3.4 * cs); ctx.lineTo(-4 * cs, -1.9 * cs); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-5 * cs, 1.9 * cs); ctx.lineTo(-7.6 * cs, 3.4 * cs); ctx.lineTo(-4 * cs, 1.9 * cs); ctx.closePath(); ctx.fill();
    } else if (wt === 'rail') {
      // hypervelocity slug wrapped in electromagnetic crackle
      ctx.globalAlpha = 0.4; ctx.fillStyle = '#b87bff';
      ctx.beginPath(); ctx.ellipse(0, 0, 9 * cs, 3 * cs, 0, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = p.crit ? '#ffe9b0' : '#efe2ff';
      ctx.beginPath(); ctx.ellipse(0, 0, 6.5 * cs, 1.6 * cs, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(184,123,255,0.85)'; ctx.lineWidth = 1;
      const j = Math.sin(tnow * 60 + p.y) * 2.4;
      ctx.beginPath(); ctx.moveTo(-4, -2 - j); ctx.lineTo(0, 2 + j); ctx.lineTo(4, -2 - j); ctx.stroke();
    } else if (wt === 'support') {
      // Warden bolt — a mending charge: green diamond with a white cross
      ctx.globalAlpha = 0.4; ctx.fillStyle = '#7ce0a0';
      ctx.beginPath(); ctx.arc(0, 0, 6 * cs, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = p.crit ? '#eaffe9' : 'rgba(124,224,160,0.9)';
      ctx.save(); ctx.rotate(Math.PI / 4);
      ctx.fillRect(-3.4 * cs, -3.4 * cs, 6.8 * cs, 6.8 * cs);
      ctx.restore();
      ctx.fillStyle = '#fff';
      ctx.fillRect(-0.8, -3 * cs, 1.6, 6 * cs); ctx.fillRect(-3 * cs, -0.8, 6 * cs, 1.6);
    } else if (wt === 'plasma') {
      // unstable bottled starfire — a pulsing orb
      const pr = (1 + 0.25 * Math.sin(tnow * 26 + p.x)) * cs;
      ctx.globalAlpha = 0.5; ctx.fillStyle = '#46d27a';
      ctx.beginPath(); ctx.arc(0, 0, 5.6 * pr, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = p.crit ? '#fff3c0' : '#d8ffe8';
      ctx.beginPath(); ctx.arc(0, 0, 2.8 * pr, 0, 7); ctx.fill();
    } else {
      // gatling tracer (also drones, in teal) — short hot dash
      const col = wt === 'drone' ? '#7dffc4' : (p.crit ? '#ffd24d' : '#ffe9a8');
      ctx.globalAlpha = 0.4; ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(0, 0, (wt === 'drone' ? 7 : 7.4) * cs, 2.6 * cs, 0, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(0, 0, (wt === 'drone' ? 4.6 : 5) * cs, 1.4 * cs, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(2 * cs, 0, 1.8 * cs, 1 * cs, 0, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  // A COMBAT DRONE FROM THE FLIGHT AROUND THE FLAGSHIP. It points where it is
  // going, snaps to its target when it shoots, and throws a muzzle flare — so
  // the swarm reads as a squadron working rather than decoration spinning.
  // The halo gradient is built once and reused: it is drawn in the drone's own
  // local space, so it is position-independent, and a full bay puts a dozen of
  // these on screen every frame.
  let _drHalo = null;
  function drawDrone(ctx, x, y, t, ang, flash) {
    ctx.save();
    ctx.translate(x, y);
    // THE SCREEN SCALES WITH THE CARRIER. The dart is drawn at a fixed ~11 units,
    // which is invisible flying beside a capital hull three to five times the
    // frigate footprint — a 96-bay Dread Omega looked like it had no drones at all.
    let dk = 1;
    try { dk = Math.min(2.2, 1 + Math.max(0, shipScaleOf(activeShipKey()) - 1) * 0.32); } catch (e) {}
    if (dk !== 1) ctx.scale(dk, dk);
    if (!_drHalo) {
      _drHalo = ctx.createRadialGradient(0, 0, 1, 0, 0, 11);
      _drHalo.addColorStop(0, 'rgba(130,255,205,0.5)');
      _drHalo.addColorStop(1, 'rgba(130,255,205,0)');
    }
    ctx.fillStyle = _drHalo; ctx.beginPath(); ctx.arc(0, 0, 11, 0, 7); ctx.fill();
    ctx.rotate((ang || 0) + Math.PI / 2);
    // muzzle flare, in front of the nose, on the frame it fires
    if (flash > 0) {
      const f = flash > 1 ? 1 : flash;
      ctx.globalAlpha = 0.75 * f;
      ctx.fillStyle = '#bfffe4';
      ctx.beginPath(); ctx.ellipse(0, -9 - 4 * f, 2.2 + 1.6 * f, 5 + 4 * f, 0, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // body: small dart
    ctx.fillStyle = '#2b3744'; ctx.strokeStyle = '#0d1318'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.2, 4.5); ctx.lineTo(0, 2.4); ctx.lineTo(-4.2, 4.5); ctx.closePath(); ctx.fill(); ctx.stroke();
    // core light (cheap glow), brightening as it cycles its guns
    ctx.globalAlpha = 0.5 + 0.35 * (flash > 0 ? flash : 0); ctx.fillStyle = '#7fffcb';
    ctx.beginPath(); ctx.arc(0, -0.5, 3.2, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = '#7fffcb'; ctx.beginPath(); ctx.arc(0, -0.5, 1.7, 0, 7); ctx.fill();
    // engine wash trailing the nose
    ctx.globalAlpha = 0.35; ctx.fillStyle = '#4fe0b0';
    ctx.beginPath(); ctx.ellipse(0, 5.6 + Math.sin(t * 14 + x * 0.1) * 0.9, 1.5, 3.2, 0, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // FLEET ESCORT — an owned hull flying formation with the flagship. Sprite
  // art + engine glow at reduced scale; healPulse shows the Aegis repair ring.
  function drawEscort(ctx, key, x, y, t, healPulse) {
    const tier = HULL_VIS[key] != null ? HULL_VIS[key] : 0;
    const im = shipImg(key);
    const ds = (26 + tier * 2.4) * shipScaleOf(key);
    const bob = Math.sin(t * 2 + x * 0.07) * 1.6;
    ctx.save();
    ctx.translate(x, y + bob);
    // PRISM AURA — escort carrying a Prism Core gets a (scaled-down) prismatic halo
    if (shipHasPrism(key)) drawPrismAura(ctx, t + x * 0.13, ds * 0.7, 0.7);
    if (key === 'oblivionfinal') drawGreenAura(ctx, t + x * 0.13, ds * 0.8, 0.9);
    // (no under-ship engine-glow blob — it read as a "reflection" beside each escort)
    if (im) { const k = fitK(im, ds), dw = srcW(im) * k, dh = srcH(im) * k; ctx.drawImage(im, -dw / 2, -dh / 2, dw, dh); }
    else { ctx.fillStyle = '#9fb4d6'; ctx.beginPath(); ctx.moveTo(0, -ds * 0.4); ctx.lineTo(ds * 0.3, ds * 0.3); ctx.lineTo(-ds * 0.3, ds * 0.3); ctx.closePath(); ctx.fill(); }
    // Aegis repair pulse — expanding green ring
    if (healPulse > 0) {
      const k = 1 - healPulse / 0.8;
      ctx.globalAlpha = Math.max(0, healPulse) * 0.9;
      ctx.strokeStyle = '#7ce0a0'; ctx.lineWidth = 2 * (1 - k) + 0.6;
      ctx.beginPath(); ctx.arc(0, 0, ds * (0.5 + k * 1.6), 0, 7); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // ENEMY BOLT — hostile standoff fire: red-cored dart in the shooter's tint
  // THE VOID CITADEL — massive static fortress with progressive damage states:
  // 100–75% pristine · <75% burning · <50% falling apart · <25% critical (about
  // to blow). Ember/smoke particles are emitted by the game loop; this draws
  // the structure itself. All effects are cheap (one shadowBlur, no per-frame
  // allocations beyond gradients).
  // THE VOID CITADEL — the player-supplied fortress art, dressed with heavy
  // glow work. Damage states: 100–75% pristine (cool blue running lights) ·
  // <75% burning (flame points ignite across the hull) · <50% breaking up
  // (judder, more fires, arc-flash sparks) · <25% critical (red strobe, violent
  // shaking). Ember/smoke particles come from the game loop.
  const citadelImg = new Image(); citadelImg.src = 'ships/ship-citadel.png';
  // flame anchor points as fractions of the sprite half-size
  const CIT_FIRES = [[-0.52, 0.22], [0.44, 0.3], [-0.18, -0.28], [0.3, -0.18], [0, 0.42], [-0.4, -0.05], [0.55, 0.05], [0.1, 0.12]];
  function drawCitadel(ctx, e) {
    if (!citadelImg.complete || !citadelImg.naturalWidth) return drawCitadelProc(ctx, e);
    const t = performance.now() / 1000;
    const f = Math.max(0, e.hp / e.maxHp);
    const dyingK = e.dying ? e.deathT : 0;
    const s = e.size * (0.55 + 0.45 * easeOut(e.spawnT)) * (1 + dyingK * 0.3);
    const burning = f < 0.75, breaking = f < 0.5, critical = f < 0.25;
    const jx = critical ? Math.sin(t * 47) * 3 : (breaking ? Math.sin(t * 23) * 1.4 : 0);
    const jy = critical ? Math.cos(t * 53) * 2.6 : 0;
    const dw = s * 3.05, dh = dw * (citadelImg.naturalHeight / citadelImg.naturalWidth);
    const pulse = 0.5 + 0.5 * Math.sin(t * (critical ? 9 : breaking ? 5 : 2.2));
    ctx.save();
    ctx.translate(e.x + jx, e.y + jy);
    ctx.globalAlpha = 1 - dyingK;
    // threat aura — a huge soft bloom under the whole station, blue → orange → red
    const auraCol = critical ? '255,42,74' : burning ? '255,130,60' : '90,190,255';
    const ag = ctx.createRadialGradient(0, 0, dw * 0.12, 0, 0, dw * 0.72);
    ag.addColorStop(0, `rgba(${auraCol},${0.28 + 0.16 * pulse})`);
    ag.addColorStop(0.6, `rgba(${auraCol},${0.10 + 0.08 * pulse})`);
    ag.addColorStop(1, `rgba(${auraCol},0)`);
    ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(0, 0, dw * 0.72, 0, 7); ctx.fill();
    // the fortress itself
    ctx.drawImage(citadelImg, -dw / 2, -dh / 2, dw, dh);
    // hit flash — additive re-draw brightens the whole hull
    if (e.hitFlash > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - dyingK) * e.hitFlash * 0.55;
      ctx.drawImage(citadelImg, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    }
    // reactor crown glow — additive pulse over the spire and core ring
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const coreCol = critical ? '255,60,90' : '110,210,255';
    const cg = ctx.createRadialGradient(-dw * 0.04, -dh * 0.16, 2, -dw * 0.04, -dh * 0.16, dw * 0.2);
    cg.addColorStop(0, `rgba(${coreCol},${0.5 + 0.4 * pulse})`); cg.addColorStop(1, `rgba(${coreCol},0)`);
    ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(-dw * 0.04, -dh * 0.16, dw * 0.2, 0, 7); ctx.fill();
    // damage fires — ignite point by point as integrity falls
    const lit = Math.min(CIT_FIRES.length, Math.floor((1 - f) * (CIT_FIRES.length + 2)));
    for (let i = 0; i < lit; i++) {
      const fp = CIT_FIRES[i];
      const fl = 0.55 + 0.45 * Math.sin(t * (9 + i * 1.7) + i * 9);
      const fx = fp[0] * dw * 0.5, fy = fp[1] * dh * 0.5;
      const fg = ctx.createRadialGradient(fx, fy, 1, fx, fy, s * (0.26 + 0.1 * fl));
      fg.addColorStop(0, `rgba(255,210,120,${0.75 * fl})`);
      fg.addColorStop(0.45, `rgba(255,120,40,${0.45 * fl})`);
      fg.addColorStop(1, 'rgba(255,60,20,0)');
      ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(fx, fy, s * (0.26 + 0.1 * fl), 0, 7); ctx.fill();
    }
    // breaking up: white arc-flash sparks crawl across the hull
    if (breaking && Math.sin(t * 17) > 0.78) {
      const ax = (Math.sin(t * 31) * 0.4) * dw * 0.5, ay = (Math.cos(t * 27) * 0.35) * dh * 0.5;
      ctx.strokeStyle = 'rgba(220,240,255,0.85)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(ax - 12, ay + 6); ctx.lineTo(ax - 3, ay - 5); ctx.lineTo(ax + 5, ay + 4); ctx.lineTo(ax + 13, ay - 7); ctx.stroke();
    }
    ctx.restore(); // end additive
    // critical: red strobe ring around the whole station
    if (critical) {
      ctx.globalAlpha = (1 - dyingK) * (0.25 + 0.45 * pulse);
      ctx.strokeStyle = '#ff2a4a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, dw * (0.5 + 0.04 * pulse), 0, 7); ctx.stroke();
      ctx.globalAlpha = 1 - dyingK;
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    // nameplate + integrity bar
    const bw = Math.min(dw * 0.85, 260), bx = e.x - bw / 2, by = e.y - dh / 2 - 18;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(bx - 2, by - 2, bw + 4, 10);
    ctx.fillStyle = '#3a0e12'; ctx.fillRect(bx, by, bw, 6);
    ctx.fillStyle = critical ? '#ff2a4a' : burning ? '#ff9a50' : '#5fd1ff';
    ctx.fillRect(bx, by, bw * f, 6);
    ctx.font = '800 11px Rajdhani, sans-serif'; ctx.textAlign = 'center';
    ctx.lineWidth = 2.8; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    const label = '⛴ VOID CITADEL' + (critical ? ' · CRITICAL' : breaking ? ' · BREAKING UP' : burning ? ' · BURNING' : '');
    ctx.strokeText(label, e.x, by - 6); ctx.fillStyle = '#dff2ff'; ctx.fillText(label, e.x, by - 6);
  }
  // procedural fallback (pre-image-load only)
  function drawCitadelProc(ctx, e) {
    const t = performance.now() / 1000;
    const f = Math.max(0, e.hp / e.maxHp);
    const dyingK = e.dying ? e.deathT : 0;
    const s = e.size * (0.55 + 0.45 * easeOut(e.spawnT)) * (1 + dyingK * 0.3);
    const burning = f < 0.75, breaking = f < 0.5, critical = f < 0.25;
    // critical: the whole structure judders
    const jx = critical ? Math.sin(t * 47) * 2.4 : (breaking ? Math.sin(t * 23) * 1 : 0);
    const jy = critical ? Math.cos(t * 53) * 2 : 0;
    ctx.save();
    ctx.translate(e.x + jx, e.y + jy);
    ctx.globalAlpha = 1 - dyingK;
    // threat aura — gold when healthy, deepening red as it burns
    const pulse = 0.5 + 0.5 * Math.sin(t * (critical ? 9 : breaking ? 5 : 2.4));
    const auraCol = critical ? '255,42,74' : burning ? '255,122,60' : '255,180,90';
    const ag = ctx.createRadialGradient(0, 0, s * 0.4, 0, 0, s * 1.7);
    ag.addColorStop(0, `rgba(${auraCol},${0.16 + 0.12 * pulse})`); ag.addColorStop(1, `rgba(${auraCol},0)`);
    ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(0, 0, s * 1.7, 0, 7); ctx.fill();
    // outer defense ring (rotating) with 4 pylons — pylons shear off as it breaks
    ctx.save(); ctx.rotate(t * 0.18);
    ctx.strokeStyle = breaking ? 'rgba(160,150,150,0.5)' : 'rgba(170,190,220,0.65)';
    ctx.lineWidth = 2.4; ctx.setLineDash([s * 0.34, s * 0.14]);
    ctx.beginPath(); ctx.arc(0, 0, s * 1.08, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    for (let i = 0; i < 4; i++) {
      const pa = (i / 4) * Math.PI * 2;
      const gone = (breaking && i === 1) || (critical && i === 3); // sheared pylons
      if (gone) continue;
      const tilt = breaking ? Math.sin(i * 7) * 0.3 : 0;
      ctx.save(); ctx.rotate(pa + tilt); ctx.translate(s * 1.08, 0);
      ctx.fillStyle = e.hitFlash > 0 ? '#fff' : (breaking ? '#6a6f7a' : '#8a97ad');
      ctx.fillRect(-s * 0.09, -s * 0.2, s * 0.18, s * 0.4);
      ctx.fillStyle = critical ? '#ff2a4a' : '#ffd24d';
      ctx.beginPath(); ctx.arc(0, 0, s * 0.05 + pulse * 1.2, 0, 7); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
    // main hull — hexagonal bastion
    const flash = e.hitFlash > 0 ? e.hitFlash : 0;
    const hg = ctx.createLinearGradient(-s, -s, s, s);
    hg.addColorStop(0, mix(breaking ? '#3a3540' : '#4a5468', '#ffffff', flash * 0.8));
    hg.addColorStop(0.5, mix(breaking ? '#252230' : '#2e3548', '#ffffff', flash * 0.8));
    hg.addColorStop(1, mix('#181b26', '#ffffff', flash * 0.8));
    ctx.fillStyle = hg;
    ctx.strokeStyle = critical ? '#ff5a6e' : burning ? '#d08a5a' : '#9fb2d0';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 - Math.PI / 2; const px = Math.cos(a) * s * 0.66, py = Math.sin(a) * s * 0.66; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // structural cracks once it's falling apart
    if (breaking) {
      ctx.strokeStyle = 'rgba(10,8,14,0.85)'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(-s * 0.5, -s * 0.1); ctx.lineTo(-s * 0.16, 0); ctx.lineTo(-s * 0.3, s * 0.3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s * 0.42, -s * 0.3); ctx.lineTo(s * 0.18, -s * 0.05); ctx.lineTo(s * 0.38, s * 0.12); ctx.stroke();
      if (critical) { ctx.beginPath(); ctx.moveTo(0, -s * 0.6); ctx.lineTo(-s * 0.08, -s * 0.2); ctx.lineTo(s * 0.1, s * 0.05); ctx.lineTo(0, s * 0.55); ctx.stroke(); }
    }
    // window lights — banks go dark (or flicker orange) as systems fail
    for (let i = 0; i < 8; i++) {
      const wa = (i / 8) * Math.PI * 2 + 0.4;
      const wx = Math.cos(wa) * s * 0.38, wy = Math.sin(wa) * s * 0.38;
      const dead = (1 - f) * 8 > i + 0.5;
      const flick = dead && Math.sin(t * 13 + i * 5) > 0.55;
      ctx.fillStyle = dead ? (flick ? '#ff9a50' : '#1c1f2a') : 'rgba(190,220,255,0.85)';
      ctx.fillRect(wx - 1.6, wy - 1.6, 3.2, 3.2);
    }
    // reactor eye — gold heart that reddens and races as the end nears
    const eyeCol = critical ? '#ff2a4a' : burning ? '#ff9a50' : '#ffd24d';
    ctx.shadowColor = eyeCol; ctx.shadowBlur = 10 + 10 * pulse;
    ctx.fillStyle = eyeCol;
    ctx.beginPath(); ctx.arc(0, 0, s * (0.13 + 0.03 * pulse), 0, 7); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#10070c';
    ctx.beginPath(); ctx.arc(0, 0, s * 0.055, 0, 7); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
    // nameplate + integrity bar
    const bw = s * 2.1, bx = e.x - bw / 2, by = e.y - s * 1.55;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(bx - 2, by - 2, bw + 4, 9);
    ctx.fillStyle = '#3a0e12'; ctx.fillRect(bx, by, bw, 5);
    ctx.fillStyle = critical ? '#ff2a4a' : burning ? '#ff9a50' : '#ffd24d';
    ctx.fillRect(bx, by, bw * f, 5);
    ctx.font = '800 10px Rajdhani, sans-serif'; ctx.textAlign = 'center';
    ctx.lineWidth = 2.6; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    const label = '⛴ VOID CITADEL' + (critical ? ' · CRITICAL' : breaking ? ' · BREAKING UP' : burning ? ' · BURNING' : '');
    ctx.strokeText(label, e.x, by - 5); ctx.fillStyle = '#ffd9c4'; ctx.fillText(label, e.x, by - 5);
  }

  let _boltGrad = null;
  function drawEnemyBolt(ctx, b) {
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.ang);
    // The trail gradient is identical for every bolt and lives in bolt space —
    // built once for the session instead of ninety times a frame. The per-bolt
    // shadowBlur is gone too: a blurred sprite is the most expensive thing a 2D
    // context can draw, and a bright core reads the same at this size.
    if (!_boltGrad) {
      _boltGrad = ctx.createLinearGradient(-14, 0, 4, 0);
      _boltGrad.addColorStop(0, 'rgba(255,60,90,0)');
      _boltGrad.addColorStop(1, 'rgba(255,90,110,0.8)');
    }
    ctx.strokeStyle = _boltGrad; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(2, 0); ctx.stroke();
    ctx.fillStyle = b.tint || '#ff8a5c';
    ctx.beginPath(); ctx.ellipse(0, 0, 5, 2, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffdade';
    ctx.beginPath(); ctx.arc(1.6, 0, 1.5, 0, 7); ctx.fill();
    ctx.restore();
  }

  // The additive halo. The CALLER sets 'lighter' once around the whole pass —
  // doing it per particle flushed the canvas batch 320 times a frame.
  // ctx.font assignment re-parses a CSS font shorthand every time; a string
  // compare first is far cheaper and the value is almost always unchanged.
  let _lastFont = '';
  function setFont(ctx, f) { if (_lastFont !== f) { ctx.font = f; _lastFont = f; } }
  function drawParticleGlow(ctx, p) {
    const a = Math.max(0, p.life / p.maxLife);
    const r2 = p.size * (0.5 + a * 0.9) * 1.45;
    ctx.globalAlpha = a * (p.glow ? 0.5 : 0.32);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, r2 * (p.glow ? 3.4 : 2.4), 0, 7); ctx.fill();
  }
  function drawParticle(ctx, p) {
    const a = Math.max(0, p.life / p.maxLife);
    const r2 = p.size * (0.5 + a * 0.9) * 1.45;   // beefier core
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, r2, 0, 7); ctx.fill();
    // hot white core
    ctx.globalAlpha = a * 0.8;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(p.x, p.y, r2 * 0.4, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
  }
  function drawFloat(ctx, f) {
    // survival LOD: the small routine numbers go quiet, crits and banners stay
    if (_LOD >= 2 && !f.crit && (f.size || 0) < 20) return;
    const a = Math.max(0, f.life / f.maxLife);
    ctx.globalAlpha = a;
    setFont(ctx, '800 ' + f.size + 'px Rajdhani, sans-serif'); ctx.textAlign = 'center'; ctx.lineWidth = 3.5; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
    if (f.crit) { setFont(ctx, '800 ' + (f.size * 0.5) + 'px Rajdhani, sans-serif'); ctx.fillStyle = '#ffd24d'; ctx.fillText('CRIT!', f.x, f.y - f.size*0.85); }
    ctx.globalAlpha = 1;
  }

  // =========================================================================
  // PLAYER STARSHIP — evolves with level; gear tints hull/weapons/shield
  // =========================================================================
  function shipTier(level) {
    return level >= 1000 ? 5 : level >= 500 ? 4 : level >= 250 ? 3 : level >= 100 ? 2 : level >= 50 ? 1 : 0;
  }
  // Visual tier driven by the owned HULL CLASS (so buying a bigger hull visibly
  // upgrades the ship), falling back to level for the starter frigate.
  const HULL_VIS = { frigate:0, interceptor:0, cruiser:1, heavycruiser:1, destroyer:2, battleship:2, dreadnought:3, carrier:4, aegis:4, supercarrier:4, titan:5, mothership:5, oblivionspear:5, oblivionspearalpha:5, oblivionfinal:5,
    dread1:5, dread2:5, dread3:5, dread4:5, dread5:5, dread6:5, titansina:5, aeternum:5, eternum:5, voidmaw:5, chromafang:1, chromaregent:5, frostyfrost:5, veridian:2,
    xen1:0, xen2:1, xen3:2, xen4:4, xen5:5, vanguard:4, praetorian:5,
    // Ladders that were never added to either table and so drew at tier 0 — a
    // frigate silhouette for a Celestial carrier and for every alliance siege
    // hull. EMBER CHOIR mirrors the Kaevith ladder rung for rung (same five
    // classes); MONOLITH is the four-rung alliance ladder; the two unreleased
    // fighter carriers sit with their class peers.
    emb1:0, emb2:1, emb3:2, emb4:4, emb5:5,
    monolith1:1, monolith2:2, monolith3:4, monolith4:5,
    titanaquila:5, corvus:5 };
  // On-screen sprite size multiplier — the Oblivion hulls are colossal capital ships.
  // THE AETERNUM is not a ship at all but an artificial WORLD, so it draws larger
  // than anything else in the game. It had no entry before, which meant a
  // planetbreaker rendered at frigate scale.
  // THE ETERNUM is the Celestial class ABOVE the Titan Sina — 1.5× the Titan on
  // every stat line — and it was missing here too, so the game's final hull flew
  // at frigate scale. It draws larger than the Titan Sina, as the class implies.
  const SHIP_SCALE = {
    // ---- THE MAIN LADDER'S CAPITAL TAIL -----------------------------------
    // Sprite size is (42 + tier*3) * shipScaleOf(key), and tier tops out at 5 —
    // so every hull from the Dreadnought up to the Mothership drew at 57px while
    // the Dread branch beside them drew at 171–251px. A 4× cliff at the exact
    // point the ladder hands off, which is why a Mothership looked like a
    // gunboat next to the Dread Omega it precedes. The tail now climbs into the
    // Dread branch instead of stepping off it. Frigate through Cruiser stay at
    // ×1: they ARE the reference silhouette.
    heavycruiser:1.08, destroyer:1.15, battleship:1.22, veridian:1.22, dreadnought:1.3,
    carrier:1.5, aegis:1.5, supercarrier:1.8, titan:2.1, mothership:2.4,
    // RELEASED TIER-5 CAPITALS. All three sat at ×1 — the same omission as the
    // Praetorian, on hulls players actually fly today. The Voidmaw is the Season 1
    // event flagship and its own config calls it above Mothership-grade; the
    // Chroma Regent is a premium LootCoin capital; FrostyFrost is Carrier-class
    // event tech. They belong between the Mothership and the Dread ladder.
    voidmaw:2.8, chromaregent:2.8, frostyfrost:2.6,
    oblivionspear:2, oblivionspearalpha:2.2, oblivionfinal:4,
    dread1:3, dread2:3.2, dread3:3.4, dread4:3.6, dread5:3.8, dread6:4, titansina:4.4, eternum:5.2, aeternum:4.8,
    xen1:0.85, xen2:1, xen3:1.3, xen4:1.7, xen5:2.6, vanguard:2.4,
    // DREAD PRAETORIAN — Dread-class, so it flies at Dread-class size. Missing
    // from this table it fell through to ×1 and the apex carrier drew at FRIGATE
    // scale in combat, smaller than the Vanguard it outranks. A shade above the
    // Dread Omega (4), below the Titan Sina (4.4), which is where the class sits.
    praetorian:4.2,
    // ---- THE REST OF THE AUDIT (Aug 2026) ---------------------------------
    // Only hulls that draw LARGER than the base sprite belong in this table: the
    // main ladder (frigate → mothership) is sized by HULL_VIS tier alone and is
    // correct at ×1. These are the ones that are NOT on that ladder and were
    // still falling through to it:
    //   • EMBER CHOIR (emb1-5) — the Kaevith ladder's twin, five classes deep,
    //     and in neither table. Mirrors xen1-5 exactly, as its classes do.
    //   • MONOLITH (1-4) — the alliance siege ladder, Cruiser through Carrier.
    //   • TITAN AQUILA — Titan-class, a rung above the Titan Sina (4.4).
    //   • CELESTIAL CORVUS — Celestial-class, between Aeternum (4.8) and
    //     Eternum (5.2); the largest carrier hull in the game by bay count.
    emb1:0.85, emb2:1, emb3:1.3, emb4:1.7, emb5:2.6,
    monolith1:1.2, monolith2:1.6, monolith3:2.2, monolith4:3,
    titanaquila:4.5, corvus:5 };
  function shipScaleOf(key){ return SHIP_SCALE[key] || 1; }
  function hullTier(level) {
    const key = (window.GAME && window.GAME.state) ? window.GAME.state.ship : 'frigate';
    const ht = HULL_VIS[key];
    return ht != null ? Math.max(ht, shipTier(level) >= 4 ? ht : 0) : shipTier(level);
  }
  const SHIP_NAMES = ['Scout Fighter', 'Strike Bomber', 'Battle Cruiser', 'Heavy Cruiser', 'Dreadnought', 'Super Carrier'];

  // ---- sprite art for the 10 hulls (preloaded) ----
  const SHIP_KEYS = ['frigate','interceptor','cruiser','heavycruiser','destroyer','battleship','dreadnought','carrier','aegis','supercarrier','titan','mothership','oblivionspear','oblivionspearalpha','oblivionfinal','dread1','dread2','dread3','dread4','dread5','dread6','titansina','eternum','aeternum','voidmaw','chromafang','chromaregent','frostyfrost','veridian','monolith1','monolith2','monolith3','monolith4','xen1','xen2','xen3','xen4','xen5'];
  const SHIP_IMG = {};
  SHIP_KEYS.forEach((k) => { const im = new Image(); im.src = 'ships/ship-' + k + '.png'; SHIP_IMG[k] = im; });
  function activeShipKey() { return (window.GAME && window.GAME.state && window.GAME.state.ship) || 'frigate'; }
  // lazy fallback — any hull key not in the preload list loads on first use
  function shipImg(key) { let im = SHIP_IMG[key]; if (!im && key) { im = new Image(); im.src = 'ships/ship-' + key + '.png'; SHIP_IMG[key] = im; } return (im && im.complete && im.naturalWidth) ? im : null; }

  // =========================================================================
  // COSMETICS — premium hull skins + auras (Market → Cosmetics)
  // =========================================================================
  const SKIN_CACHE = {};
  function cosmeticsState() {
    const s = window.GAME && window.GAME.state;
    return (s && s.cosmetics) || { skin: 'stock', aura: 'none' };
  }
  // Hull-level tint — recolors the ship sprite as it gains upgrade levels.
  // Cached per (hull, TINT-COLOR, skin) — NOT raw level. The tint only changes
  // across a handful of level tiers (shipLvlColor buckets level → a few colors),
  // so keying by the resulting color keeps this cache bounded (≈ hulls × tiers ×
  // skins) instead of leaking a fresh canvas on every single hull upgrade over a
  // long idle session.
  // SPRITE ART IS NOT SQUARE. Ship art runs from near-square to 176×512 (the
  // Vanguard), and every draw site here used to force it into a ds×ds box — so
  // every hull was stretched, and the tall ones were unrecognisable. fitW/fitH
  // scale the real dimensions to fit the box on its longer axis.
  function srcW(im) { return (im && (im.naturalWidth || im.width)) || 1; }
  function srcH(im) { return (im && (im.naturalHeight || im.height)) || 1; }
  function fitK(im, box) { const w = srcW(im), h = srcH(im); return box / (w > h ? w : h); }

  const LVL_TINT_CACHE = {};
  function lvlTint(img, key, lv, skin, col) {
    if (!img) return img;
    if (!/^#[0-9a-f]{6}$/i.test(col || '')) return img;
    // NOT YET DECODED — hand back the original and cache NOTHING. srcW/srcH fall
    // back to 1 on an image that has not loaded, which would build (and then
    // permanently cache) a 1×1 canvas: the hull would render as a single pixel for
    // the rest of the session. The old `img.width || 96` hid this by guessing 96.
    if (img instanceof HTMLImageElement && !img.naturalWidth) return img;
    const id = key + ':' + (col || '') + ':' + (skin || 'stock');
    if (LVL_TINT_CACHE[id]) return LVL_TINT_CACHE[id];
    // LETTERBOXED, NOT SQUASHED. The canvas stays square so the skin/stripe
    // geometry below and every ds×ds call site keep working unchanged, but the
    // sprite is centred inside it at its true aspect instead of being stretched
    // to fill — which is what flattened tall hulls into blobs.
    const iw = srcW(img), ih = srcH(img);
    const S = (iw > ih ? iw : ih) || 96;
    const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
    const cx = cv.getContext('2d');
    { const k = S / (iw > ih ? iw : ih), dw = iw * k, dh = ih * k;
      cx.drawImage(img, 0, 0, iw, ih, (S - dw) / 2, (S - dh) / 2, dw, dh); }
    // TINT THE HULL, NOT ITS GLOW. This was a flat 42% fill through `source-atop`,
    // which paints EVERY pixel the sprite owns — including the wide, soft bloom
    // the capital-ship art carries around itself. On a Dread Omega, drawn at 4×
    // scale, that bloom became an orange haze several hundred units across sitting
    // over the escorts and the drone screen. Only near-opaque pixels (actual hull
    // plating) take the colour now, and at a lighter weight.
    try {
      const d = cx.getImageData(0, 0, S, S), px = d.data;
      const tr = parseInt(col.slice(1, 3), 16), tg = parseInt(col.slice(3, 5), 16), tb = parseInt(col.slice(5, 7), 16);
      const K = 0.34;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 200) continue;             // glow / feathered edge keeps its own colour
        px[i] += (tr - px[i]) * K;
        px[i + 1] += (tg - px[i + 1]) * K;
        px[i + 2] += (tb - px[i + 2]) * K;
      }
      cx.putImageData(d, 0, 0);
    } catch (e) { return img; }                    // tainted canvas (file://) — no tint beats a haze
    LVL_TINT_CACHE[id] = cv; return cv;
  }
  // The hull sprite with a skin finish composited over its silhouette.
  // Static skins cache per (hull, skin); Prismatic re-renders (tiny canvas).
  function skinnedShip(key, skin, t) {
    const im = shipImg(key); if (!im) return null;
    if (!skin || skin === 'stock') return im;
    const animated = skin === 'prismatic';
    const ck = key + ':' + skin;
    if (!animated && SKIN_CACHE[ck]) return SKIN_CACHE[ck];
    const S = 96;
    const cv = (!animated ? document.createElement('canvas') : (SKIN_CACHE._anim || (SKIN_CACHE._anim = document.createElement('canvas'))));
    cv.width = S; cv.height = S;
    const cx = cv.getContext('2d');
    // letterboxed for the same reason as lvlTint — `source-atop` below only
    // paints where the sprite actually is, so the skins are unaffected
    { const iw = srcW(im), ih = srcH(im), k = S / (iw > ih ? iw : ih), dw = iw * k, dh = ih * k;
      cx.drawImage(im, 0, 0, iw, ih, (S - dw) / 2, (S - dh) / 2, dw, dh); }
    cx.globalCompositeOperation = 'source-atop';
    if (skin === 'prismatic') {
      const off = (t * 60) % 360;
      const g = cx.createLinearGradient(0, 0, S, S);
      for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsla(${(off + i * 60) % 360},95%,62%,0.55)`);
      cx.fillStyle = g; cx.fillRect(0, 0, S, S);
    } else if (skin === 'tiger') {
      cx.fillStyle = 'rgba(232,128,30,0.52)'; cx.fillRect(0, 0, S, S);
      cx.fillStyle = 'rgba(14,9,4,0.8)';
      for (let i = -1; i < 8; i++) {
        cx.save(); cx.translate(i * 15, 0); cx.rotate(0.45);
        cx.beginPath(); cx.moveTo(0, -24); cx.quadraticCurveTo(8, S * 0.4, 0, S + 24); cx.lineTo(-6, S + 24); cx.quadraticCurveTo(2, S * 0.4, -6, -24); cx.closePath(); cx.fill();
        cx.restore();
      }
    } else if (skin === 'void') {
      cx.fillStyle = 'rgba(56,18,108,0.66)'; cx.fillRect(0, 0, S, S);
      cx.fillStyle = 'rgba(190,130,255,0.4)';
      for (let i = 0; i < 16; i++) cx.fillRect((i * 37 + 11) % S, (i * 53 + 5) % S, 2, 2);
    } else if (skin === 'gilded') {
      const g = cx.createLinearGradient(0, 0, S, S);
      g.addColorStop(0, 'rgba(255,222,120,0.7)'); g.addColorStop(0.5, 'rgba(196,142,36,0.62)'); g.addColorStop(1, 'rgba(255,236,170,0.7)');
      cx.fillStyle = g; cx.fillRect(0, 0, S, S);
    } else if (skin === 'crimson') {
      cx.fillStyle = 'rgba(214,40,62,0.56)'; cx.fillRect(0, 0, S, S);
    } else if (skin === 'arctic') {
      cx.fillStyle = 'rgba(196,232,255,0.58)'; cx.fillRect(0, 0, S, S);
      cx.fillStyle = 'rgba(255,255,255,0.35)'; cx.fillRect(0, 0, S, S * 0.2);
    }
    cx.globalCompositeOperation = 'source-over';
    if (!animated) SKIN_CACHE[ck] = cv;
    return cv;
  }
  // Aura ring effects drawn UNDER the hull (origin at ship center).
  function drawCosmeticAura(ctx, aura, t, r) {
    if (!aura || aura === 'none') return;
    if (aura === 'prism') {
      const off = (t * 50) % 360;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + t * 0.8;
        ctx.strokeStyle = `hsla(${(off + i * 30) % 360},95%,62%,0.8)`;
        ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.arc(0, 0, r, a, a + 0.34); ctx.stroke();
      }
    } else if (aura === 'flame') {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + Math.sin(t * 3 + i) * 0.2;
        const fl = 0.6 + 0.4 * Math.sin(t * 9 + i * 2.4);
        const x1 = Math.cos(a) * r, y1 = Math.sin(a) * r;
        const g = ctx.createRadialGradient(x1, y1, 0, x1, y1, 6 + fl * 5);
        g.addColorStop(0, `rgba(255,200,90,${0.55 * fl})`); g.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x1, y1, 6 + fl * 5, 0, 7); ctx.fill();
      }
    } else if (aura === 'frost') {
      ctx.strokeStyle = `rgba(150,220,255,${0.4 + 0.25 * Math.sin(t * 2.4)})`;
      ctx.lineWidth = 1.6; ctx.setLineDash([5, 7]); ctx.lineDashOffset = -t * 14;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
      ctx.lineDashOffset = t * 9;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.78, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - t * 0.6;
        ctx.fillStyle = 'rgba(210,240,255,0.85)';
        ctx.beginPath(); ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 1.6, 0, 7); ctx.fill();
      }
    } else if (aura === 'voidstorm') {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + t * (i % 2 ? 1.1 : -0.8);
        const rr2 = r * (0.85 + 0.2 * Math.sin(t * 2 + i * 3));
        ctx.fillStyle = `rgba(${i % 2 ? '154,91,255' : '110,60,180'},${0.5 + 0.3 * Math.sin(t * 4 + i)})`;
        ctx.shadowColor = '#9a5bff'; ctx.shadowBlur = 7;
        ctx.beginPath(); ctx.arc(Math.cos(a) * rr2, Math.sin(a) * rr2, 2.2, 0, 7); ctx.fill();
      }
      ctx.shadowBlur = 0;
    } else if (aura === 'sentinel') {
      for (let k = 0; k < 2; k++) {
        ctx.save(); ctx.rotate(t * (k ? -0.9 : 0.6));
        ctx.strokeStyle = `rgba(242,178,75,${k ? 0.5 : 0.75})`;
        ctx.lineWidth = k ? 1.4 : 2;
        ctx.setLineDash([r * (k ? 0.5 : 0.9), r * 0.5]);
        ctx.beginPath(); ctx.arc(0, 0, r * (k ? 0.82 : 1), 0, 7); ctx.stroke();
        ctx.restore();
      }
      ctx.setLineDash([]);
    }
  }

  // PRISM AURA — a bold, unmistakable prismatic halo around a hull carrying a
  // Prism Core: layered multi-colour glow, a counter-rotating prismatic ring,
  // and orbiting facet sparkles. `mag` scales the whole effect (1 = flagship).
  const PRISM_COLS = ['#ff5168', '#ffd450', '#46d27a', '#5fd1ff', '#b87bff'];
  function shipHasPrism(key) {
    return !!(window.GAME && GAME.state && GAME.state.shipAura && GAME.state.shipAura[key]);
  }
  // GREEN REACTOR AURA — the Oblivion Final's signature: a deep pulsing green
  // halo, a rotating ring, and rising reactor embers. `mag` scales the effect.
  function drawGreenAura(ctx, t, baseR, mag) {
    mag = mag || 1;
    const pulse = 0.6 + 0.4 * Math.sin(t * 2.6);
    const R = baseR * (1.18 + 0.08 * Math.sin(t * 2.0));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // layered green halo
    const g1 = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R);
    g1.addColorStop(0, rgba('#7dff9a', 0.30 * pulse * mag));
    g1.addColorStop(0.55, rgba('#2bd24a', 0.16 * pulse * mag));
    g1.addColorStop(1, rgba('#0e7a2a', 0));
    ctx.fillStyle = g1; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill();
    // rotating reactor ring
    ctx.lineWidth = 2.6 * mag; ctx.strokeStyle = rgba('#5dff84', 0.7 * pulse);
    ctx.beginPath(); ctx.arc(0, 0, R * 0.86, t * 1.3, t * 1.3 + Math.PI * 1.4); ctx.stroke();
    ctx.lineWidth = 1.6 * mag; ctx.strokeStyle = rgba('#aaffc0', 0.6 * pulse);
    ctx.beginPath(); ctx.arc(0, 0, R * 0.72, -t * 1.7, -t * 1.7 + Math.PI * 1.1); ctx.stroke();
    // rising reactor embers
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + t * 0.6;
      const rr = R * (0.5 + 0.5 * ((t * 0.6 + i * 0.37) % 1));
      const ox = Math.cos(a) * rr, oy = Math.sin(a) * rr;
      ctx.fillStyle = rgba('#9dffb0', 0.85 * (1 - rr / R));
      ctx.shadowColor = '#46ff70'; ctx.shadowBlur = 7 * mag;
      ctx.beginPath(); ctx.arc(ox, oy, (1.3 + 0.7 * Math.sin(t * 5 + i)) * mag, 0, 7); ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.restore();
  }
  function drawPrismAura(ctx, t, baseR, mag) {
    mag = mag || 1;
    const pulse = 0.6 + 0.4 * Math.sin(t * 3);
    const R = baseR * (1.12 + 0.07 * Math.sin(t * 2.4));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // layered colour halo — each facet colour orbits the hull centre
    for (let i = 0; i < PRISM_COLS.length; i++) {
      const ang = t * 0.9 + i * (Math.PI * 2 / PRISM_COLS.length);
      const gx = Math.cos(ang) * R * 0.26, gy = Math.sin(ang) * R * 0.26;
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, R);
      g.addColorStop(0, rgba(PRISM_COLS[i], 0.34 * pulse * mag));
      g.addColorStop(1, rgba(PRISM_COLS[i], 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill();
    }
    // counter-rotating prismatic ring (arc segments)
    ctx.lineWidth = 2.2 * mag;
    const segs = PRISM_COLS.length;
    for (let i = 0; i < segs; i++) {
      const a0 = t * 1.6 + i * (Math.PI * 2 / segs);
      ctx.strokeStyle = rgba(PRISM_COLS[i], 0.85 * pulse);
      ctx.beginPath(); ctx.arc(0, 0, R * 0.9, a0, a0 + (Math.PI * 2 / segs) * 0.8); ctx.stroke();
    }
    // orbiting facet sparkles
    for (let i = 0; i < segs; i++) {
      const a = -t * 1.25 + i * (Math.PI * 2 / segs);
      const ox = Math.cos(a) * R * 0.9, oy = Math.sin(a) * R * 0.9;
      ctx.fillStyle = rgba(PRISM_COLS[i], 0.95);
      ctx.shadowColor = PRISM_COLS[i]; ctx.shadowBlur = 8 * mag;
      ctx.beginPath(); ctx.arc(ox, oy, (1.7 + 0.8 * Math.sin(t * 6 + i)) * mag, 0, 7); ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function drawArcher(ctx, x, y, scale, archer, equipped, t) {
    const level = (window.GAME && window.GAME.state) ? window.GAME.state.level : 1;
    const tier = hullTier(level);
    ctx.save();
    ctx.translate(x, y); ctx.scale(scale, scale);

    const aura = auraOf(equipped);
    // HULL FOOTPRINT — the drawn sprite size, computed BEFORE the aura passes.
    // Every halo below used to size itself off hull tier alone (30 + tier*4), so on
    // a Dreadnaught-class sprite — drawn 2-3x larger by shipScaleOf — the ring sat
    // INSIDE the artwork and the aura simply vanished. Radii now take the larger of
    // the tier figure and the hull's real footprint.
    // Bounded at 96px of local radius: past that the halo is no longer reading
    // "this ship is buffed", it is hiding the arena. Capital hulls keep a halo
    // clear of their art without glaring over the hazards around them.
    const _hullR = Math.min(96, ((42 + tier * 3) * shipScaleOf(activeShipKey())) * 0.5);
    const facing = (archer.facing != null ? archer.facing : -Math.PI/2);
    const muzzle = archer.muzzle || 0, recoil = archer.recoil || 0;
    const bob = Math.sin((archer.bob || t*3)) * 1.0;

    // shield bubble (legendary+ aura)
    if (aura >= 3) {
      const rc = C.RARITY[aura].color, pulse = 0.55 + 0.45 * Math.sin(t * 4);
      const r = Math.max(20 + tier * 4, _hullR * 1.08);
      const sg = ctx.createRadialGradient(0, 0, r*0.5, 0, 0, r);
      sg.addColorStop(0, rgba(rc, 0)); sg.addColorStop(0.8, rgba(rc, 0.10*pulse)); sg.addColorStop(1, rgba(rc, 0.32*pulse));
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
      ctx.strokeStyle = rgba(rc, 0.5*pulse); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
    }

    // cosmetic aura (premium) — rendered beneath the hull
    drawCosmeticAura(ctx, cosmeticsState().aura, t, Math.max(24 + tier * 4, _hullR * 1.15));

    // PRISM AURA — significant prismatic halo when this hull carries a Prism Core
    if (shipHasPrism(activeShipKey())) {
      const pr = Math.max(30 + tier * 4, _hullR * 1.22);
      drawPrismAura(ctx, t, pr, Math.min(1.6, Math.max(1, pr / 78)));
    }
    // VERIDIAN RESONANCE AURA — the damage field made visible: a breathing
    // verdant ring at the aura's true radius (world-space, so drawn unscaled
    // relative to the ship's local frame: radius / scale keeps it accurate).
    if (activeShipKey() === 'veridian') {
      const R = 260 / Math.max(0.0001, scale);
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.6);
      const g2 = ctx.createRadialGradient(0, 0, R * 0.55, 0, 0, R);
      g2.addColorStop(0, 'rgba(90,230,140,0)');
      g2.addColorStop(0.82, 'rgba(90,230,140,' + (0.05 + 0.04 * pulse) + ')');
      g2.addColorStop(1, 'rgba(90,230,140,' + (0.16 + 0.10 * pulse) + ')');
      ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(120,255,170,' + (0.30 + 0.22 * pulse) + ')'; ctx.lineWidth = 1.6;
      ctx.setLineDash([10, 14]); ctx.lineDashOffset = -t * 26;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    }
    // GREEN REACTOR AURA — the Oblivion Final's signature glow
    if (activeShipKey() === 'oblivionfinal') drawGreenAura(ctx, t, Math.max(46 + tier * 5, _hullR * 1.3), 1.4);

    // orient: art drawn nose-up (-y); rotate so nose points along facing
    ctx.translate(0, bob);
    const _im = shipImg(activeShipKey());
    if (_im) {
      const ds = (42 + tier * 3) * shipScaleOf(activeShipKey());                 // sprite draw size (local units)
      // (no under-ship shadow/glow blob — it read as a weird "reflection" next to the hull)
      // animated engine plume — flickering twin thruster flames behind the hull
      {
        const flick = 0.62 + 0.38 * Math.sin(t * 17) + 0.12 * Math.sin(t * 41);
        for (let pi = 0; pi < 2; pi++) {
          const ex = (pi === 0 ? -1 : 1) * ds * 0.13;
          const fl = ds * (0.18 + flick * 0.16);
          const fg = ctx.createLinearGradient(0, ds * 0.34, 0, ds * 0.34 + fl);
          fg.addColorStop(0, 'rgba(170,225,255,0.85)'); fg.addColorStop(0.5, 'rgba(110,190,255,0.4)'); fg.addColorStop(1, 'rgba(110,190,255,0)');
          ctx.fillStyle = fg;
          ctx.beginPath(); ctx.moveTo(ex - ds * 0.045, ds * 0.34); ctx.lineTo(ex + ds * 0.045, ds * 0.34); ctx.lineTo(ex, ds * 0.34 + fl); ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgba(225,245,255,0.95)';
          ctx.beginPath(); ctx.arc(ex, ds * 0.355, ds * 0.028 + flick * 0.7, 0, 7); ctx.fill();
        }
      }
      const _skinned = skinnedShip(activeShipKey(), cosmeticsState().skin, t) || _im;
      const _lv = (window.GAME && GAME.state && GAME.state.shipLevels && GAME.state.shipLevels[activeShipKey()]) || 1;
      const _tcol = (window.shipLvlColor && _lv >= 3) ? window.shipLvlColor(_lv) : null;
      const _drawn = _tcol ? lvlTint(_skinned, activeShipKey(), _lv, cosmeticsState().skin, _tcol) : _skinned;
      { const k = fitK(_drawn, ds), dw = srcW(_drawn) * k, dh = srcH(_drawn) * k;
        ctx.drawImage(_drawn, -dw / 2, -dh / 2 + recoil * 1.4, dw, dh); }
      // (no floating muzzle-flash dot — fire feedback comes from the spark particles)
    } else {
      ctx.rotate(facing + Math.PI / 2);
      ctx.translate(0, recoil * 2);
      drawShip(ctx, tier, equipped, t, muzzle);
    }

    ctx.restore();
  }

  function drawShip(ctx, tier, equipped, t, muzzle) {
    const hull = gearColor(equipped, 'armor', '#2c3540');
    const accent = '#3a7bd5', gold = '#e0a020';
    const wRar = equipped.bow ? C.RARITY[equipped.bow.rarity] : null;
    const gunGlow = wRar ? wRar.color : accent;
    const len = 15 + tier * 3.2, wid = 6 + tier * 1.7;
    const OUT = darken(hull, 0.55);
    const flick = 0.6 + 0.4 * Math.sin(t * 16);

    // ----- engine plume (rear, +y) -----
    const eg = ctx.createLinearGradient(0, len*0.4, 0, len*1.5);
    eg.addColorStop(0, rgba(accent, 0.9)); eg.addColorStop(1, rgba(accent, 0));
    const nEng = 1 + Math.min(4, tier);
    for (let i = 0; i < nEng; i++) {
      const ex = (i - (nEng-1)/2) * (wid*0.5);
      ctx.fillStyle = eg;
      ctx.beginPath(); ctx.moveTo(ex - 2.4, len*0.55); ctx.lineTo(ex + 2.4, len*0.55); ctx.lineTo(ex, len*(1.1 + flick*0.5)); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#bfe6ff'; ctx.beginPath(); ctx.arc(ex, len*0.6, 1.6, 0, 7); ctx.fill();
    }

    ctx.lineJoin = 'round'; ctx.strokeStyle = OUT; ctx.lineWidth = 1.6;

    // ----- wings (tier>=1) -----
    if (tier >= 1) {
      ctx.fillStyle = darken(hull, 0.18);
      [[-1],[1]].forEach(([d]) => {
        ctx.beginPath();
        ctx.moveTo(d*wid*0.5, -len*0.1);
        ctx.lineTo(d*(wid + len*0.5), len*0.25);
        ctx.lineTo(d*(wid + len*0.3), len*0.5);
        ctx.lineTo(d*wid*0.5, len*0.35);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // wingtip light
        ctx.fillStyle = gold; ctx.beginPath(); ctx.arc(d*(wid + len*0.45), len*0.27, 1.4, 0, 7); ctx.fill();
        ctx.fillStyle = darken(hull, 0.18);
      });
    }

    // ----- side pods / hardpoints (tier>=2) -----
    if (tier >= 2) {
      ctx.fillStyle = darken(hull, 0.25);
      [[-1],[1]].forEach(([d]) => { rr(ctx, d*wid*0.7 - wid*0.18, -len*0.1, wid*0.36, len*0.7, 2); ctx.fill(); ctx.stroke(); });
    }

    // ----- main hull -----
    const hg = ctx.createLinearGradient(-wid, 0, wid, 0);
    hg.addColorStop(0, darken(hull, 0.28)); hg.addColorStop(0.5, hull); hg.addColorStop(1, lighten(hull, 0.2));
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.moveTo(0, -len);                                  // nose
    ctx.quadraticCurveTo(wid, -len*0.3, wid*0.85, len*0.55);
    ctx.quadraticCurveTo(wid*0.5, len*0.8, 0, len*0.72);
    ctx.quadraticCurveTo(-wid*0.5, len*0.8, -wid*0.85, len*0.55);
    ctx.quadraticCurveTo(-wid, -len*0.3, 0, -len);
    ctx.closePath(); ctx.fill(); ctx.stroke();

    // hull plating lines + accent stripe
    ctx.strokeStyle = lighten(hull, 0.22); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, -len*0.85); ctx.lineTo(0, len*0.6); ctx.stroke();
    ctx.strokeStyle = rgba(accent, 0.8); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(-wid*0.4, -len*0.2); ctx.lineTo(-wid*0.3, len*0.3); ctx.moveTo(wid*0.4, -len*0.2); ctx.lineTo(wid*0.3, len*0.3); ctx.stroke();

    // ----- cockpit -----
    const cg = ctx.createLinearGradient(0, -len*0.7, 0, -len*0.2);
    cg.addColorStop(0, '#bfe6ff'); cg.addColorStop(1, rgba(accent, 0.9));
    ctx.fillStyle = cg; ctx.strokeStyle = OUT; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(0, -len*0.42, wid*0.34, len*0.26, 0, 0, 7); ctx.fill(); ctx.stroke();

    // ----- forward cannons + muzzle flash (weapon-tinted) -----
    const guns = 1 + Math.min(3, Math.floor(tier/1.5));
    for (let i = 0; i < guns; i++) {
      const gx = guns === 1 ? 0 : (i - (guns-1)/2) * (wid*0.5);
      ctx.strokeStyle = mix('#2a2f36', gunGlow, 0.5); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(gx, -len*0.7); ctx.lineTo(gx, -len*1.05); ctx.stroke();
      if (muzzle > 0.05) {
        ctx.save(); ctx.translate(gx, -len*1.05);
        ctx.fillStyle = rgba(lighten(gunGlow, 0.4), muzzle); ctx.shadowColor = gunGlow; ctx.shadowBlur = 10*muzzle;
        const ml = (5 + tier) * muzzle;
        ctx.beginPath();
        for (let j = 0; j < 8; j++) { const a = j/8*Math.PI*2; const rr3 = (j%2? ml*0.4 : ml); ctx.lineTo(Math.cos(a)*rr3*0.6, Math.sin(a)*rr3); }
        ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0; ctx.restore();
      }
    }

    // (carrier drones are drawn separately as real, firing units)
  }

  // visual tier for an arbitrary hull key (used to render parked hangar ships)
  function shipVisTier(key) { return HULL_VIS[key] != null ? HULL_VIS[key] : 0; }

  // Portrait of the ACTUAL battle hull (same drawShip renderer as combat),
  // nose-up and scaled to fit a small canvas. `equipped` tints it exactly like
  // the ship you fly. Used for the store ship icons so they match battle 1:1.
  function drawHullPortrait(ctx, shipKey, equipped, cw, ch, t) {
    equipped = equipped || {};
    if (t == null) t = (window.GAME && window.GAME.rt) ? window.GAME.rt.time : 0;
    const tier = shipVisTier(shipKey);
    const len = 15 + tier * 3.2, wid = 6 + tier * 1.7;
    const halfH = len * 1.12 + 2, halfW = wid + len * 0.5 + 2;
    const span = Math.max(halfH, halfW) * 2;
    const s = Math.min(cw, ch) / span * 0.96;
    ctx.clearRect(0, 0, cw, ch);
    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    ctx.scale(s, s);
    drawShip(ctx, tier, equipped, t, 0);
    ctx.restore();
  }

  // =========================================================================
  // SHIP ICON — detailed, shaded top-down hull portrait for the store. Hull
  // silhouette varies by CLASS; cannon count, plating pods, engine nozzles and
  // drone bays are driven by the ship's real loadout. Rendered to a canvas so
  // it reads as artwork, not a flat glyph.
  // =========================================================================
  const SHIP_ACCENT = { Frigate:'#5b9cff', Cruiser:'#46d07a', Battleship:'#f0972a', Carrier:'#b15cff', Aegis:'#7ce0a0' };
  function drawShipIcon(ctx, ship, cw, ch) {
    const cls = ship.cls;
    const accent = SHIP_ACCENT[cls] || '#5b9cff';
    const hull = '#3b4655';
    const OUT = darken(hull, 0.55);
    const t = (window.GAME && window.GAME.rt) ? window.GAME.rt.time : 0;
    const flick = 0.62 + 0.38 * Math.sin(t * 12 + (ship.tier || 0));
    ctx.clearRect(0, 0, cw, ch);
    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    const s = Math.min(cw, ch) / 50;
    ctx.scale(s, s);

    // class silhouette dimensions
    let len, wid, blocky = false, broad = false, twin = false;
    if (cls === 'Frigate') { len = 20; wid = 6.2; }
    else if (cls === 'Cruiser') { len = 19; wid = 8.6; twin = true; }
    else if (cls === 'Battleship') { len = 20; wid = 10.6; blocky = true; }
    else { len = 17.5; wid = 12.8; broad = true; }

    const guns = Math.max(1, ship.weapons);
    const pods = Math.max(0, ship.hull - 1);
    const nEng = Math.max(1, Math.min(4, Math.round((ship.weapons + ship.hull) / 1.6)));

    // ---- engine plume (rear, +y) ----
    const eg = ctx.createLinearGradient(0, len * 0.4, 0, len * 1.5);
    eg.addColorStop(0, rgba(accent, 0.9)); eg.addColorStop(1, rgba(accent, 0));
    for (let i = 0; i < nEng; i++) {
      const ex = nEng === 1 ? 0 : (i - (nEng - 1) / 2) * (wid * 0.55);
      ctx.fillStyle = eg;
      ctx.beginPath(); ctx.moveTo(ex - 2.4, len * 0.5); ctx.lineTo(ex + 2.4, len * 0.5); ctx.lineTo(ex, len * (1.05 + flick * 0.45)); ctx.closePath(); ctx.fill();
      ctx.fillStyle = lighten(accent, 0.5); ctx.beginPath(); ctx.arc(ex, len * 0.56, 1.5, 0, 7); ctx.fill();
    }

    // soft ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(0, len * 0.2, wid * 1.25, len * 0.62, 0, 0, 7); ctx.fill();

    ctx.lineJoin = 'round'; ctx.strokeStyle = OUT; ctx.lineWidth = 1.4;

    // ---- wings ----
    ctx.fillStyle = darken(hull, 0.16);
    const wingSpan = broad ? wid + len * 0.75 : twin ? wid + len * 0.5 : wid + len * 0.42;
    const wingY = broad ? 0.18 : 0.28;
    [[-1], [1]].forEach(([d]) => {
      ctx.beginPath();
      ctx.moveTo(d * wid * 0.5, -len * 0.06);
      ctx.lineTo(d * wingSpan, len * wingY);
      ctx.lineTo(d * (wingSpan - len * 0.12), len * (wingY + 0.2));
      ctx.lineTo(d * wid * 0.5, len * 0.34);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // wingtip light
      ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(d * (wingSpan - len * 0.04), len * (wingY + 0.02), 1.3, 0, 7); ctx.fill();
      ctx.fillStyle = darken(hull, 0.16);
    });

    // ---- side hardpoint pods (extra plating) ----
    if (pods > 0) {
      ctx.fillStyle = darken(hull, 0.26);
      for (let i = 0; i < pods; i++) {
        const off = wid * 0.74 + i * 1.7;
        [[-1], [1]].forEach(([d]) => { rr(ctx, d * off - wid * 0.16, -len * 0.12, wid * 0.32, len * 0.66, 1.8); ctx.fill(); ctx.stroke(); });
      }
    }

    // ---- main hull (metallic gradient) ----
    const hg = ctx.createLinearGradient(-wid, 0, wid, 0);
    hg.addColorStop(0, darken(hull, 0.3)); hg.addColorStop(0.48, lighten(hull, 0.16)); hg.addColorStop(1, darken(hull, 0.12));
    ctx.fillStyle = hg; ctx.strokeStyle = OUT; ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (blocky) {
      ctx.moveTo(0, -len);
      ctx.lineTo(wid * 0.62, -len * 0.55);
      ctx.lineTo(wid, len * 0.5);
      ctx.lineTo(wid * 0.55, len * 0.75);
      ctx.lineTo(-wid * 0.55, len * 0.75);
      ctx.lineTo(-wid, len * 0.5);
      ctx.lineTo(-wid * 0.62, -len * 0.55);
    } else {
      ctx.moveTo(0, -len);
      ctx.quadraticCurveTo(wid, -len * 0.28, wid * (broad ? 0.92 : 0.85), len * 0.55);
      ctx.quadraticCurveTo(wid * 0.5, len * 0.82, 0, len * 0.72);
      ctx.quadraticCurveTo(-wid * 0.5, len * 0.82, -wid * (broad ? 0.92 : 0.85), len * 0.55);
      ctx.quadraticCurveTo(-wid, -len * 0.28, 0, -len);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();

    // plating panel lines + accent stripe
    ctx.strokeStyle = lighten(hull, 0.24); ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(0, -len * 0.86); ctx.lineTo(0, len * 0.6); ctx.stroke();
    ctx.strokeStyle = rgba(accent, 0.85); ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(-wid * 0.42, -len * 0.16); ctx.lineTo(-wid * 0.32, len * 0.32); ctx.moveTo(wid * 0.42, -len * 0.16); ctx.lineTo(wid * 0.32, len * 0.32); ctx.stroke();

    // ---- cockpit canopy ----
    const cg = ctx.createLinearGradient(0, -len * 0.72, 0, -len * 0.18);
    cg.addColorStop(0, '#dff1ff'); cg.addColorStop(1, rgba(accent, 0.92));
    ctx.fillStyle = cg; ctx.strokeStyle = OUT; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.ellipse(0, -len * 0.44, wid * 0.32, len * 0.24, 0, 0, 7); ctx.fill(); ctx.stroke();

    // ---- forward cannons (count = weapons) ----
    for (let i = 0; i < guns; i++) {
      const gx = guns === 1 ? 0 : (i - (guns - 1) / 2) * (wid * 0.46);
      ctx.strokeStyle = mix('#222831', accent, 0.45); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(gx, -len * 0.66); ctx.lineTo(gx, -len * 1.04); ctx.stroke();
      ctx.fillStyle = lighten(accent, 0.3); ctx.beginPath(); ctx.arc(gx, -len * 1.04, 1.1, 0, 7); ctx.fill();
    }

    // ---- drone bays (carriers): small docked drones flanking the hull ----
    if (ship.drones > 0) {
      const show = Math.min(6, ship.drones);
      for (let i = 0; i < show; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const row = Math.floor(i / 2);
        const dx = side * (wingSpan * 0.62);
        const dy = -len * 0.1 + row * (len * 0.42);
        ctx.fillStyle = '#7fffcb'; ctx.shadowColor = '#7fffcb'; ctx.shadowBlur = 4;
        ctx.save(); ctx.translate(dx, dy); ctx.rotate(0.2 * side);
        ctx.beginPath(); ctx.moveTo(0, -2.1); ctx.lineTo(1.7, 1.6); ctx.lineTo(-1.7, 1.6); ctx.closePath(); ctx.fill();
        ctx.restore(); ctx.shadowBlur = 0;
      }
    }

    ctx.restore();
  }

  // =========================================================================
  // HANGAR BAY — the home "Safe Zone": player ship docked on a lit deck, with
  // any other owned hulls parked alongside. Drawn in SCREEN space (no camera).
  // =========================================================================
  function drawHangar(ctx, w, h, t, ships, activeKey) {
    ctx.save();
    // ---- deep-space view through the open bay door (top band) ----
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.46);
    sky.addColorStop(0, '#0a0e1c'); sky.addColorStop(1, '#10162a');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h * 0.46);
    // stars beyond the door
    const sr = rng(99);
    for (let i = 0; i < 70; i++) {
      const x = sr() * w, y = sr() * h * 0.42, a = 0.2 + sr() * 0.7;
      const tw = 0.6 + 0.4 * Math.sin(t * 2 + i);
      ctx.fillStyle = `rgba(200,220,255,${a * tw})`;
      ctx.fillRect(x, y, sr() > 0.85 ? 2 : 1, sr() > 0.85 ? 2 : 1);
    }
    // a distant planet through the door
    const pg = ctx.createRadialGradient(w * 0.78, h * 0.12, 4, w * 0.78, h * 0.12, 60);
    pg.addColorStop(0, 'rgba(120,150,220,0.55)'); pg.addColorStop(1, 'rgba(60,80,140,0)');
    ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(w * 0.78, h * 0.12, 60, 0, 7); ctx.fill();

    // ---- bay door frame (top) ----
    ctx.fillStyle = '#1b2233'; ctx.fillRect(0, h * 0.44, w, 14);
    ctx.fillStyle = '#2a3346';
    for (let x = 0; x < w; x += 34) ctx.fillRect(x + 4, h * 0.44 + 2, 22, 10);

    // ---- deck (lower 56%) with perspective grid ----
    const deckTop = h * 0.46;
    const dg = ctx.createLinearGradient(0, deckTop, 0, h);
    dg.addColorStop(0, '#161b27'); dg.addColorStop(1, '#0c0f17');
    ctx.fillStyle = dg; ctx.fillRect(0, deckTop, w, h - deckTop);
    const vpx = w / 2, vpy = deckTop - h * 0.5; // vanishing point above
    ctx.strokeStyle = 'rgba(90,140,210,0.16)'; ctx.lineWidth = 1;
    // converging longitudinal lines
    for (let i = -6; i <= 6; i++) {
      const fx = w / 2 + i * (w / 6);
      ctx.beginPath(); ctx.moveTo(fx, h); ctx.lineTo(vpx + (fx - vpx) * 0.12, deckTop); ctx.stroke();
    }
    // horizontal deck bands (closer = farther apart)
    for (let i = 1; i <= 7; i++) {
      const yy = deckTop + Math.pow(i / 7, 1.8) * (h - deckTop);
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w, yy); ctx.stroke();
    }
    // side hull walls
    ctx.fillStyle = 'rgba(18,22,33,0.92)';
    ctx.beginPath(); ctx.moveTo(0, deckTop); ctx.lineTo(w * 0.1, deckTop); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(w, deckTop); ctx.lineTo(w * 0.9, deckTop); ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
    // overhead light strips
    for (let i = 0; i < 3; i++) {
      const lx = w * (0.28 + i * 0.22), gl = 0.5 + 0.3 * Math.sin(t * 1.5 + i);
      ctx.fillStyle = `rgba(150,200,255,${0.5 * gl})`; ctx.fillRect(lx, h * 0.46 + 16, w * 0.16, 3);
      const lg = ctx.createRadialGradient(lx + w * 0.08, h * 0.46 + 18, 2, lx + w * 0.08, h * 0.46 + 18, 60);
      lg.addColorStop(0, `rgba(150,200,255,${0.16 * gl})`); lg.addColorStop(1, 'rgba(150,200,255,0)');
      ctx.fillStyle = lg; ctx.fillRect(lx - 30, h * 0.46 + 18, w * 0.16 + 60, 90);
    }

    // ---- parking layout: active hull centered & large, others flanking ----
    const others = ships.filter((s) => s.key !== activeKey);
    const active = ships.find((s) => s.key === activeKey) || ships[0];
    const slots = [];
    // flanking pads (behind, smaller)
    const flank = [ [0.20, 0.60, 0.72], [0.80, 0.60, 0.72], [0.32, 0.52, 0.56], [0.68, 0.52, 0.56],
                    [0.13, 0.74, 0.84], [0.87, 0.74, 0.84], [0.42, 0.49, 0.46], [0.58, 0.49, 0.46], [0.5, 0.47, 0.42] ];
    others.slice(0, flank.length).forEach((s, i) => slots.push({ ship: s, x: w * flank[i][0], y: h * flank[i][1], sc: flank[i][2], active: false }));
    if (active) slots.push({ ship: active, x: w * 0.5, y: h * 0.72, sc: 1, active: true });

    // sort far→near so nearer ships overlap correctly
    slots.sort((a, b) => a.y - b.y);
    const hits = [];
    for (const slot of slots) {
      const base = slot.active ? 1.0 : 0.66;
      const tier = slot.ship.tier;
      const shipScale = (1.5 + tier * 0.25) * base * slot.sc;
      const bob = Math.sin(t * 1.6 + slot.x) * 3;
      hits.push({ key: slot.ship.key, x: slot.x, y: slot.y, r: Math.max(30 * slot.sc * base, 24 * shipScale), active: slot.active });
      // landing pad glow
      const pc = slot.active ? '#e6b566' : '#3a7bd5';
      const padR = 30 * slot.sc * base;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath(); ctx.ellipse(slot.x, slot.y + 18 * slot.sc, padR, padR * 0.34, 0, 0, 7); ctx.fill();
      const ring = ctx.createRadialGradient(slot.x, slot.y + 18 * slot.sc, padR * 0.3, slot.x, slot.y + 18 * slot.sc, padR);
      ring.addColorStop(0, rgba(pc, slot.active ? 0.38 : 0.22)); ring.addColorStop(1, rgba(pc, 0));
      ctx.fillStyle = ring; ctx.beginPath(); ctx.ellipse(slot.x, slot.y + 18 * slot.sc, padR, padR * 0.4, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = rgba(pc, slot.active ? 0.7 : 0.4); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(slot.x, slot.y + 18 * slot.sc, padR, padR * 0.34, 0, 0, 7); ctx.stroke();
      ctx.restore();
      // the ship, hovering, nose up
      ctx.save();
      ctx.translate(slot.x, slot.y - 6 + bob);
      ctx.scale(shipScale, shipScale);
      const _hi = shipImg(slot.ship.key);
      if (_hi) { const ds = 30 + tier * 3, k = fitK(_hi, ds), dw = srcW(_hi) * k, dh = srcH(_hi) * k; ctx.drawImage(_hi, -dw / 2, -dh / 2, dw, dh); }
      else drawShip(ctx, tier, slot.ship.equipped || {}, t, 0);
      ctx.restore();
      // name plate
      ctx.font = `700 ${slot.active ? 12 : 10}px Rajdhani, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = slot.active ? '#e6b566' : 'rgba(170,190,220,0.7)';
      ctx.fillText(slot.ship.name.toUpperCase(), slot.x, slot.y + 34 * slot.sc + (slot.active ? 6 : 0));
      if (slot.active) {
        ctx.font = '700 9px Rajdhani, sans-serif'; ctx.fillStyle = 'rgba(120,200,140,0.9)';
        ctx.fillText('● ACTIVE HULL', slot.x, slot.y + 34 * slot.sc + 18);
      } else {
        ctx.font = '700 8.5px Rajdhani, sans-serif'; ctx.fillStyle = 'rgba(130,200,255,0.85)';
        ctx.fillText('▸ TAP TO FLY', slot.x, slot.y + 30 * slot.sc + 12);
      }
    }
    ctx.restore();
    return hits;
  }

  window.RENDER = {
    setLOD, getLOD,
    drawArena, drawEnemy, drawArrow, drawEnemyBolt, drawParticle, drawParticleGlow, drawFloat, drawArcher, drawHangar, drawDrone, drawEscort, drawShipIcon, skinnedShip, drawCosmeticAura,
    gearColor, auraOf, mix, biomeOf, shipTier, hullTier, shipVisTier, drawHullPortrait, SHIP_NAMES, shipScaleOf,
  };
})();
