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
    azure:   { a:'#0d1830', b:'#060a16', neb:'70,130,230',  star:'#dcd9ff', feat:'planet' },
    verdant: { a:'#0a2018', b:'#04100c', neb:'60,200,150',  star:'#dffff0', feat:'planet' },
    ember:   { a:'#241008', b:'#120604', neb:'240,120,50',  star:'#ffe6cf', feat:'blackhole' },
    violet:  { a:'#1a0f2e', b:'#0c0718', neb:'160,90,240',   star:'#f0dcff', feat:'planet' },
    void:    { a:'#160a22', b:'#05030a', neb:'210,70,180',   star:'#ffd6f4', feat:'blackhole' },
  };
  const GAL_PROPS = ['asteroid', 'asteroid', 'debris', 'crystal'];

  // starfield + drifting space debris, cached per zone+size
  let _spaceKey = '', _stars = [], _props = [], _featPos = null;
  function spaceFor(zone, w, h) {
    const key = zone + 'x' + (w|0) + 'x' + (h|0);
    if (key === _spaceKey) return;
    _spaceKey = key;
    const r = rng((zone + 7) * 9301 + 49297);
    // stars
    _stars = [];
    const sc = Math.min(420, Math.round((w * h) / 1700));
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
      // accretion ring
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * 0.25); ctx.scale(1, 0.4);
      ctx.strokeStyle = `rgba(${gal.neb},0.8)`; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,240,220,0.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, R*0.78, 0, 7); ctx.stroke();
      ctx.restore();
      // event horizon
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(x, y, R*0.5, 0, 7); ctx.fill();
    } else if (gal.feat === 'planet') {
      const R = 52 * s;
      const g = ctx.createRadialGradient(x - R*0.3, y - R*0.3, 2, x, y, R);
      g.addColorStop(0, lighten(`rgb(${gal.neb})`, 0.3)); g.addColorStop(1, darken(`rgb(${gal.neb})`, 0.55));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.fill();
      // ring
      ctx.save(); ctx.translate(x, y); ctx.rotate(-0.4); ctx.scale(1, 0.32);
      ctx.strokeStyle = `rgba(${gal.neb},0.6)`; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, R*1.5, 0, 7); ctx.stroke(); ctx.restore();
    } else { // station (dock)
      const R = 30 * s;
      ctx.strokeStyle = 'rgba(150,180,230,0.5)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.stroke();
      ctx.fillStyle = 'rgba(120,150,210,0.4)'; ctx.beginPath(); ctx.arc(x, y, R*0.35, 0, 7); ctx.fill();
    }
  }

  // =========================================================================
  // ARENA (deep space)
  // =========================================================================
  function drawArena(ctx, w, h, t, zone) {
    zone = zone || 0;
    const gal = GALAXY[biomeOf(zone)];
    spaceFor(zone, w, h);
    // deep-space gradient
    const bg = ctx.createRadialGradient(w/2, h/2, 30, w/2, h/2, Math.max(w,h)*0.75);
    bg.addColorStop(0, gal.a); bg.addColorStop(1, gal.b);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    // nebula clouds
    const nr = rng((zone+3)*2654435761 >>> 0);
    for (let i = 0; i < 3; i++) {
      const cx = nr() * w, cy = nr() * h, R = (180 + nr() * 220);
      const ng = ctx.createRadialGradient(cx, cy, 10, cx, cy, R);
      ng.addColorStop(0, `rgba(${gal.neb},0.14)`); ng.addColorStop(1, `rgba(${gal.neb},0)`);
      ctx.fillStyle = ng; ctx.fillRect(cx - R, cy - R, R*2, R*2);
    }
    // starfield (twinkle)
    for (const st of _stars) {
      const a = st.br * (0.55 + 0.45 * Math.sin(t * 2 + st.tw));
      ctx.globalAlpha = a; ctx.fillStyle = gal.star;
      ctx.beginPath(); ctx.arc(st.x, st.y, st.s, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // major feature
    drawFeature(ctx, gal, t);
    // drifting debris/asteroids
    for (const p of _props) drawProp(ctx, p, t);
    // soft vignette
    const v = ctx.createRadialGradient(w/2, h/2, h*0.35, w/2, h/2, h*0.85);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
  }

  // =========================================================================
  // ENEMIES — alien vessels (one parametric drawer, varied by type)
  // =========================================================================
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function fc(color, flash) { return flash > 0 ? mix(color, '#ffffff', flash * 0.85) : color; }

  function drawEnemy(ctx, e) {
    const scale = e.dying ? (1 - e.deathT) : (0.35 + 0.65 * easeOut(e.spawnT));
    const alpha = e.dying ? (1 - e.deathT) : 1;
    const lunge = e.attackLunge > 0 ? Math.sin(e.attackLunge * Math.PI) * 4 : 0;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (e.isBoss && !e.dying) {
      const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 240);
      const ag = ctx.createRadialGradient(e.x, e.y, 4, e.x, e.y, e.size * 2.4);
      ag.addColorStop(0, `rgba(226,59,78,${0.22 * pulse})`); ag.addColorStop(1, 'rgba(226,59,78,0)');
      ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(e.x, e.y, e.size * 2.4, 0, 7); ctx.fill();
    }
    ctx.translate(e.x + (e.dir < 0 ? -lunge : lunge), e.y);
    ctx.scale(e.dir * scale, scale);
    drawAlien(ctx, e, e.hitFlash > 0 ? e.hitFlash : 0);
    ctx.restore();

    if (!e.dying && e.hp < e.maxHp) {
      const bw = Math.max(26, e.size * 2.1), bh = 5;
      const bx = e.x - bw/2, by = e.y - e.size - 16;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; rr(ctx, bx-1.5, by-1.5, bw+3, bh+3, 3); ctx.fill();
      ctx.fillStyle = '#3a0e12'; rr(ctx, bx, by, bw, bh, 2.5); ctx.fill();
      const pct = Math.max(0, e.hp/e.maxHp);
      ctx.fillStyle = pct > 0.5 ? '#e23b4e' : pct > 0.25 ? '#e8a13b' : '#e8d03b';
      rr(ctx, bx, by, bw*pct, bh, 2.5); ctx.fill();
      if (e.isBoss) {
        ctx.fillStyle = '#e23b4e'; ctx.font = '800 12px Rajdhani, sans-serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.strokeText('\u2620 ' + (e.name || 'BOSS'), e.x, by - 6); ctx.fillText('\u2620 ' + (e.name || 'BOSS'), e.x, by - 6);
      }
    }
  }

  // alien vessel: hull tinted by e.tint, glowing core, fins; shape varies by type
  function drawAlien(ctx, e, flash) {
    const s = e.size, k = e.type.key, skin = fc(e.tint, flash);
    const wob = Math.sin(e.walk * 2) * 0.06;
    ctx.rotate(wob);
    const winged = (k === 'dragon' || k === 'alien');
    const long = (k === 'skeleton');
    const bulky = (k === 'mutant' || k === 'dragon');
    // engine glow trail (behind, +y is "back" toward where it came — just glow)
    ctx.fillStyle = rgba(lighten(skin, 0.2), 0.5);
    ctx.beginPath(); ctx.ellipse(0, s*0.85, s*0.3, s*0.5, 0, 0, 7); ctx.fill();
    // wings/fins
    if (winged) {
      ctx.fillStyle = darken(skin, 0.35); ctx.strokeStyle = darken(skin, 0.55); ctx.lineWidth = 1.4;
      [[-1],[1]].forEach(([d]) => { ctx.beginPath(); ctx.moveTo(d*s*0.2,-s*0.1); ctx.lineTo(d*s*1.3,s*0.2); ctx.lineTo(d*s*0.4,s*0.6); ctx.closePath(); ctx.fill(); ctx.stroke(); });
    }
    // hull
    const g = ctx.createLinearGradient(-s*0.6,0,s*0.6,0);
    g.addColorStop(0, darken(skin,0.3)); g.addColorStop(0.5, skin); g.addColorStop(1, lighten(skin,0.16));
    ctx.fillStyle = g; ctx.strokeStyle = darken(skin,0.5); ctx.lineWidth = 1.5;
    const hw = bulky ? 0.7 : long ? 0.42 : 0.56, hl = long ? 1.05 : 0.85;
    ctx.beginPath();
    ctx.moveTo(0, -s*hl);                                    // nose
    ctx.quadraticCurveTo(s*hw, -s*0.2, s*hw*0.8, s*0.7);
    ctx.quadraticCurveTo(0, s*0.95, -s*hw*0.8, s*0.7);
    ctx.quadraticCurveTo(-s*hw, -s*0.2, 0, -s*hl);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // plating ridge
    ctx.strokeStyle = darken(skin, 0.32); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0,-s*hl*0.8); ctx.lineTo(0,s*0.7); ctx.stroke();
    // glowing core / eye
    ctx.shadowColor = '#ffe14d'; ctx.shadowBlur = 7; ctx.fillStyle = bulky ? '#ff6a3a' : '#7fe0ff';
    ctx.beginPath(); ctx.arc(0, -s*0.1, s*0.18, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = '#0a0c10'; ctx.beginPath(); ctx.arc(0, -s*0.1, s*0.08, 0, 7); ctx.fill();
    // spikes for stinger/alien
    if (k === 'alien' || k === 'mutant') {
      ctx.fillStyle = darken(skin, 0.2);
      for (let i = -1; i <= 1; i += 2) { ctx.beginPath(); ctx.moveTo(i*s*0.3,-s*0.5); ctx.lineTo(i*s*0.55,-s*0.85); ctx.lineTo(i*s*0.2,-s*0.55); ctx.closePath(); ctx.fill(); }
    }
  }

  // =========================================================================
  // LASER BOLT
  // =========================================================================
  function drawArrow(ctx, p) {
    const dr = p.drone;
    const trailCol = p.crit ? '255,210,80' : (dr ? '130,255,205' : '120,210,255');
    for (let i = 1; i < p.trail.length; i++) {
      const a = (i / p.trail.length) * (p.crit ? 0.85 : 0.6);
      ctx.strokeStyle = `rgba(${trailCol},${a})`;
      ctx.lineWidth = (p.crit ? 3.6 : (dr ? 1.9 : 2.4)) * (i / p.trail.length) + 0.5;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(p.trail[i-1].x, p.trail[i-1].y); ctx.lineTo(p.trail[i].x, p.trail[i].y); ctx.stroke();
    }
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
    ctx.shadowColor = p.crit ? 'rgba(255,200,60,0.95)' : (dr ? 'rgba(130,255,205,0.9)' : 'rgba(120,200,255,0.9)'); ctx.shadowBlur = p.crit ? 12 : 8;
    ctx.fillStyle = p.crit ? '#fff0b0' : (dr ? '#daffe9' : '#dff4ff');
    ctx.beginPath(); ctx.ellipse(0, 0, p.crit ? 6 : (dr ? 3.6 : 4.5), p.crit ? 2.2 : (dr ? 1.4 : 1.7), 0, 0, 7); ctx.fill();
    ctx.fillStyle = p.crit ? '#ffd24d' : (dr ? '#5bffb0' : '#5bc0ff');
    ctx.beginPath(); ctx.ellipse(2, 0, p.crit ? 2.6 : 2, p.crit ? 1.3 : 1.1, 0, 0, 7); ctx.fill();
    ctx.restore(); ctx.shadowBlur = 0;
  }

  // small autonomous combat drone — orbits the player, fires teal bolts
  function drawDrone(ctx, x, y, t, ang) {
    ctx.save();
    ctx.translate(x, y);
    const spin = t * 3 + (ang || 0);
    // engine glow
    const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 11);
    g.addColorStop(0, 'rgba(130,255,205,0.5)'); g.addColorStop(1, 'rgba(130,255,205,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 11, 0, 7); ctx.fill();
    ctx.rotate(spin * 0.4);
    // body: small dart
    ctx.fillStyle = '#2b3744'; ctx.strokeStyle = '#0d1318'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.2, 4.5); ctx.lineTo(0, 2.4); ctx.lineTo(-4.2, 4.5); ctx.closePath(); ctx.fill(); ctx.stroke();
    // core light
    ctx.fillStyle = '#7fffcb'; ctx.shadowColor = '#7fffcb'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(0, -0.5, 1.7, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
    ctx.restore();
  }

  function drawParticle(ctx, p) {
    const a = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = a;
    if (p.glow) { ctx.shadowColor = p.color; ctx.shadowBlur = 9; }
    ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.4 + a * 0.6), 0, 7); ctx.fill();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }
  function drawFloat(ctx, f) {
    const a = Math.max(0, f.life / f.maxLife);
    ctx.globalAlpha = a;
    ctx.font = `800 ${f.size}px Rajdhani, sans-serif`; ctx.textAlign = 'center'; ctx.lineWidth = 3.5; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
    if (f.crit) { ctx.font = `800 ${f.size*0.5}px Rajdhani, sans-serif`; ctx.fillStyle = '#ffd24d'; ctx.fillText('CRIT!', f.x, f.y - f.size*0.85); }
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
  const HULL_VIS = { frigate:0, interceptor:0, cruiser:1, heavycruiser:1, destroyer:2, battleship:2, dreadnought:3, carrier:4, supercarrier:4, titan:5 };
  function hullTier(level) {
    const key = (window.GAME && window.GAME.state) ? window.GAME.state.ship : 'frigate';
    const ht = HULL_VIS[key];
    return ht != null ? Math.max(ht, shipTier(level) >= 4 ? ht : 0) : shipTier(level);
  }
  const SHIP_NAMES = ['Scout Fighter', 'Strike Bomber', 'Battle Cruiser', 'Heavy Cruiser', 'Dreadnought', 'Super Carrier'];

  // ---- sprite art for the 10 hulls (preloaded) ----
  const SHIP_KEYS = ['frigate','interceptor','cruiser','heavycruiser','destroyer','battleship','dreadnought','carrier','supercarrier','titan'];
  const SHIP_IMG = {};
  SHIP_KEYS.forEach((k) => { const im = new Image(); im.src = 'ships/ship-' + k + '.png'; SHIP_IMG[k] = im; });
  function activeShipKey() { return (window.GAME && window.GAME.state && window.GAME.state.ship) || 'frigate'; }
  function shipImg(key) { const im = SHIP_IMG[key]; return (im && im.complete && im.naturalWidth) ? im : null; }

  function drawArcher(ctx, x, y, scale, archer, equipped, t) {
    const level = (window.GAME && window.GAME.state) ? window.GAME.state.level : 1;
    const tier = hullTier(level);
    ctx.save();
    ctx.translate(x, y); ctx.scale(scale, scale);

    const aura = auraOf(equipped);
    const facing = (archer.facing != null ? archer.facing : -Math.PI/2);
    const muzzle = archer.muzzle || 0, recoil = archer.recoil || 0;
    const bob = Math.sin((archer.bob || t*3)) * 1.0;

    // shield bubble (legendary+ aura)
    if (aura >= 3) {
      const rc = C.RARITY[aura].color, pulse = 0.55 + 0.45 * Math.sin(t * 4);
      const r = 20 + tier * 4;
      const sg = ctx.createRadialGradient(0, 0, r*0.5, 0, 0, r);
      sg.addColorStop(0, rgba(rc, 0)); sg.addColorStop(0.8, rgba(rc, 0.10*pulse)); sg.addColorStop(1, rgba(rc, 0.32*pulse));
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
      ctx.strokeStyle = rgba(rc, 0.5*pulse); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
    }

    // orient: art drawn nose-up (-y); rotate so nose points along facing
    ctx.translate(0, bob);
    const _im = shipImg(activeShipKey());
    if (_im) {
      const ds = 42 + tier * 3;                 // sprite draw size (local units)
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath(); ctx.ellipse(0, ds * 0.44, ds * 0.36, ds * 0.13, 0, 0, 7); ctx.fill();
      const eg = ctx.createRadialGradient(0, ds * 0.36, 1, 0, ds * 0.36, ds * 0.42);
      eg.addColorStop(0, 'rgba(120,200,255,0.45)'); eg.addColorStop(1, 'rgba(120,200,255,0)');
      ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(0, ds * 0.36, ds * 0.42, 0, 7); ctx.fill();
      ctx.drawImage(_im, -ds / 2, -ds / 2 + recoil * 1.4, ds, ds);
      if (muzzle > 0) {
        const mx = Math.cos(facing) * ds * 0.34, my = Math.sin(facing) * ds * 0.34 - ds * 0.12;
        ctx.globalAlpha = Math.min(1, muzzle);
        ctx.fillStyle = '#ffe6a0'; ctx.shadowColor = '#ffb43c'; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(mx, my, 2.6 + muzzle * 3, 0, 7); ctx.fill();
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      }
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
  const SHIP_ACCENT = { Frigate:'#5b9cff', Cruiser:'#46d07a', Battleship:'#f0972a', Carrier:'#b15cff' };
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
      if (_hi) { const ds = 30 + tier * 3; ctx.drawImage(_hi, -ds / 2, -ds / 2, ds, ds); }
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
    drawArena, drawEnemy, drawArrow, drawParticle, drawFloat, drawArcher, drawHangar, drawDrone, drawShipIcon,
    gearColor, auraOf, mix, biomeOf, shipTier, hullTier, shipVisTier, drawHullPortrait, SHIP_NAMES,
  };
})();
