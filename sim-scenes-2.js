/* =============================================================================
   sim-map.js — map / strategy feature sims: Turf War · Citadels · Resources
   ============================================================================= */
(function () {
  'use strict';
  const K = window.SimKit, TAU = K.TAU, rnd = K.rnd, clamp = K.clamp, lerp = K.lerp;
  const S = window.LF_SCENES;

  /* 16 · TURF WAR — two factions contest a hex grid; YOUR gold spreads as you
     capture, the rival blue pushes back. Live, tug-of-war territory. */
  S.turf = function (api) {
    const ctx = api.ctx;
    const fleet = K.img('ships/ship-destroyer.png');
    const P = K.particles(140);
    let hexR, cells, mine, foe, tok, phase, pt, target;

    function build() {
      hexR = Math.max(13, api.W * 0.07);
      const hw = Math.sqrt(3) * hexR, vh = hexR * 1.5;
      const cols = Math.ceil(api.W / hw) + 2, rows = Math.ceil(api.H / vh) + 2;
      cells = [];
      for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
        const x = q * hw + (r % 2 ? hw / 2 : 0) - hw * 0.5, y = r * vh - vh * 0.4;
        cells.push({ q, r, x, y, own: 0, flip: 0, key: q + ',' + r });
      }
      // seed: mine bottom-left, foe top-right
      cells.forEach(c => {
        const fx = c.x / api.W, fy = c.y / api.H;
        if (fx + fy < 0.7) { c.own = 1; c.flip = 1; }
        else if (fx + fy > 1.3) { c.own = 2; c.flip = 1; }
      });
      tok = (function () { const c = cells.find(c => c.own === 1); return { x: c.x, y: c.y, tx: c.x, ty: c.y }; })();
      phase = 'pick'; pt = 0; target = null;
    }
    function neighbors(c) { const odd = c.r % 2; const d = odd ? [[1, 0], [-1, 0], [0, -1], [1, -1], [0, 1], [1, 1]] : [[1, 0], [-1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]]; const out = []; for (const dd of d) { const c2 = cells.find(x => x.q === c.q + dd[0] && x.r === c.r + dd[1]); if (c2) out.push(c2); } return out; }
    function hexPath(x, y, r) { ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 180 * (60 * i - 90), px = x + r * Math.cos(a), py = y + r * Math.sin(a); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); }

    return {
      frame: function (dt, t) {
        const W = api.W, H = api.H;
        if (!cells || cells._w !== W) { build(); cells._w = W; }
        K.bg(api, { top: '#0e1228', mid: '#080c1c', tint: 'rgba(120,120,255,0.08)', drift: 2 });

        pt += dt;
        if (phase === 'pick') {
          // pick a frontier hex bordering mine (capturable: neutral or foe)
          const fr = cells.filter(c => c.own !== 1 && neighbors(c).some(n => n.own === 1));
          if (fr.length) { fr.sort((a, b) => Math.hypot(a.x - W / 2, a.y - H / 2) - Math.hypot(b.x - W / 2, b.y - H / 2)); target = fr[(Math.random() * Math.min(4, fr.length)) | 0]; tok.tx = target.x; tok.ty = target.y; phase = 'fly'; pt = 0; }
          else { cells.forEach(c => { if (c.own === 1 && Math.random() < 0.5) c.own = 0; }); }
          // foe also nibbles back occasionally
          const ff = cells.filter(c => c.own === 0 && neighbors(c).some(n => n.own === 2));
          if (ff.length && Math.random() < 0.7) { const fc = ff[(Math.random() * ff.length) | 0]; fc.own = 2; fc.flip = 0.001; }
        } else if (phase === 'fly') {
          tok.x = lerp(tok.x, tok.tx, clamp(dt * 4, 0, 1)); tok.y = lerp(tok.y, tok.ty, clamp(dt * 4, 0, 1));
          if (Math.hypot(tok.x - tok.tx, tok.y - tok.ty) < 2) { phase = 'cap'; pt = 0; }
        } else if (phase === 'cap') {
          if (Math.random() < dt * 14 && target) P.burst(target.x + rnd(-8, 8), target.y + rnd(-8, 8), { n: 1, col: '#ffd24d', sp0: 10, sp1: 40, l0: 0.2, l1: 0.4, r0: 1, r1: 2 });
          if (pt > 0.9) { target.own = 1; target.flip = 0.001; P.ring(target.x, target.y, api.accent, hexR, 0.5); P.burst(target.x, target.y, { n: 12, col: api.accent, sp0: 40, sp1: 150, l0: 0.4, l1: 0.9, r0: 1.2, r1: 3 }); phase = 'pick'; pt = 0; }
        }

        // draw hexes
        let nMine = 0, nFoe = 0;
        for (const c of cells) {
          if (c.flip > 0 && c.flip < 1) c.flip = clamp(c.flip + dt * 2.2, 0, 1);
          hexPath(c.x, c.y, hexR - 1.5);
          if (c.own === 1) { nMine++; ctx.fillStyle = K.rgba(api.accent, 0.10 + 0.13 * c.flip); ctx.fill(); ctx.strokeStyle = K.rgba(api.accent, 0.5 + 0.3 * c.flip); ctx.lineWidth = 1.4; }
          else if (c.own === 2) { nFoe++; ctx.fillStyle = 'rgba(79,140,255,0.14)'; ctx.fill(); ctx.strokeStyle = 'rgba(79,140,255,0.6)'; ctx.lineWidth = 1.4; }
          else { ctx.fillStyle = 'rgba(120,150,210,0.04)'; ctx.fill(); ctx.strokeStyle = 'rgba(120,150,210,0.16)'; ctx.lineWidth = 1; }
          ctx.stroke();
          ctx.fillStyle = c.own === 1 ? K.rgba(api.accent, 0.7) : c.own === 2 ? 'rgba(79,140,255,0.7)' : 'rgba(150,175,220,0.25)';
          ctx.beginPath(); ctx.arc(c.x, c.y, c.own ? 2 : 1.3, 0, TAU); ctx.fill();
        }
        if (phase === 'cap' && target) { const pulse = 0.5 + 0.5 * Math.sin(t * 8); hexPath(target.x, target.y, hexR - 1.5); ctx.strokeStyle = K.rgba('#ffd24d', 0.5 + 0.4 * pulse); ctx.lineWidth = 2; ctx.stroke(); }

        P.update(dt); P.draw(ctx);
        const ang = Math.atan2(tok.ty - tok.y, tok.tx - tok.x) + Math.PI / 2;
        ctx.save(); ctx.translate(tok.x, tok.y); ctx.rotate(phase === 'fly' ? ang : Math.sin(t) * 0.12); K.ship(ctx, fleet, 0, 0, 26, t, { glow: api.accent }); ctx.restore();

        // contest bar (mine vs foe)
        const total = nMine + nFoe || 1, mineF = nMine / total;
        const bw = W - 28, bx = 14, by = 14;
        ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(bx, by, bw, 7);
        ctx.fillStyle = api.accent; ctx.fillRect(bx, by, bw * mineF, 7);
        ctx.fillStyle = 'rgba(79,140,255,0.85)'; ctx.fillRect(bx + bw * mineF, by, bw * (1 - mineF), 7);
        K.text(ctx, 'YOU ' + nMine, bx, by + 18, { size: 9, col: api.accent, align: 'left', sw: 2.2 });
        K.text(ctx, nFoe + ' RIVAL', bx + bw, by + 18, { size: 9, col: '#7fa6ff', align: 'right', sw: 2.2 });

        K.vignette(api, 0.5);
        api.setHud('pow', nMine + ' HEX');
      },
    };
  };

  /* 22 · CITADELS — build a deep-space stronghold: a structure grid lights up
     ring by ring, turrets extend, a shield bubble forms. Empire-building. */
  S.citadel = function (api) {
    const ctx = api.ctx;
    const core = K.img('ships/ship-citadel.png');
    const P = K.particles(140);
    let nodes, built, phase, pt, shield;

    function build() {
      const W = api.W, H = api.H, cx = W / 2, cy = H * 0.52;
      nodes = [];
      // concentric rings of structures
      const rings = [[0, 1], [38, 6], [66, 10], [94, 12]];
      rings.forEach((rg, ri) => { const [rad, count] = rg; for (let i = 0; i < count; i++) { const a = (i / count) * TAU + ri * 0.3; nodes.push({ x: cx + Math.cos(a) * rad * (W / 300), y: cy + Math.sin(a) * rad * (H / 600) * 1.2, ring: ri, on: 0, a }); } });
      built = 0; phase = 'build'; pt = 0; shield = 0;
      nodes[0].on = 1; built = 1;
    }

    return {
      frame: function (dt, t) {
        const W = api.W, H = api.H, cx = W / 2, cy = H * 0.52;
        if (!nodes || nodes._w !== W) { build(); nodes._w = W; }
        K.bg(api, { top: '#0e1330', mid: '#080c1f', tint: K.rgba(api.accent, 0.12), drift: 1.6 });

        pt += dt;
        if (phase === 'build') {
          if (pt > 0.32 && built < nodes.length) { pt = 0; const n = nodes[built++]; n.on = 0.001; P.burst(n.x, n.y, { n: 6, col: api.accent, sp0: 20, sp1: 90, l0: 0.3, l1: 0.6, r0: 1, r1: 2.4 }); P.ring(n.x, n.y, api.accent, 6, 0.4); }
          if (built >= nodes.length) { phase = 'shield'; pt = 0; }
        } else if (phase === 'shield') { shield = clamp(shield + dt * 1.2, 0, 1); if (pt > 2.4) { phase = 'hold'; pt = 0; } }
        else if (phase === 'hold') { if (pt > 1.6) { nodes.forEach((n, i) => { if (i) n.on = 0; }); built = 1; shield = 0; phase = 'build'; pt = 0; } }
        nodes.forEach(n => { if (n.on > 0 && n.on < 1) n.on = clamp(n.on + dt * 3, 0, 1); });

        // connection lines between consecutive rings
        ctx.strokeStyle = K.rgba(api.accent, 0.18); ctx.lineWidth = 1;
        for (const n of nodes) { if (n.ring === 0 || !n.on) continue; ctx.globalAlpha = n.on * 0.5; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(n.x, n.y); ctx.stroke(); }
        ctx.globalAlpha = 1;

        P.update(dt); P.draw(ctx);

        // shield bubble
        if (shield > 0) { const rr = Math.min(W, H) * 0.46 * shield, pulse = 0.5 + 0.5 * Math.sin(t * 2); ctx.strokeStyle = K.rgba(api.accent, 0.25 * shield + 0.15 * pulse); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke(); const sg = ctx.createRadialGradient(cx, cy, rr * 0.7, cx, cy, rr); sg.addColorStop(0, 'rgba(0,0,0,0)'); sg.addColorStop(1, K.rgba(api.accent, 0.06 * shield)); ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.fill(); }

        // structures
        for (const n of nodes) {
          if (n.on <= 0) { ctx.fillStyle = 'rgba(120,150,210,0.12)'; ctx.beginPath(); ctx.arc(n.x, n.y, 2.5, 0, TAU); ctx.fill(); continue; }
          if (n.ring === 0) continue;
          const r = 3 + n.ring * 0.6;
          ctx.globalAlpha = 0.2 * n.on; ctx.fillStyle = api.accent; ctx.beginPath(); ctx.arc(n.x, n.y, r + 4, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
          ctx.fillStyle = api.accent; ctx.shadowColor = api.accent; ctx.shadowBlur = 8 * n.on;
          ctx.save(); ctx.translate(n.x, n.y); ctx.rotate(n.a + t * 0.4);
          ctx.fillRect(-r, -r, r * 2, r * 2);
          ctx.restore(); ctx.shadowBlur = 0;
        }

        // citadel core image
        const cw = Math.min(W * 0.34, 110), ch = cw * (core.naturalHeight ? core.naturalHeight / core.naturalWidth : 1);
        if (core.complete && core.naturalWidth) ctx.drawImage(core, cx - cw / 2, cy - ch / 2 + Math.sin(t * 1.4) * 2, cw, ch);

        K.text(ctx, 'CITADEL \u00b7 ' + Math.min(built, nodes.length) + ' STRUCTURES', W / 2, H * 0.93, { size: 9.5, col: '#cfe0ff', sw: 2.4 });
        K.vignette(api, 0.5);
        api.setHud('pow', Math.min(built, nodes.length) + ' NODES');
      },
    };
  };

  /* 17 · RESOURCE ECONOMY — three faucets (fuel / iron / plasma) tick up from
     held systems & salvage; bars fill, +amounts float, counters climb. */
  S.resources = function (api) {
    const ctx = api.ctx;
    const P = K.particles(120);
    const RES = [['\u26fd', 'FUEL', '#5fd1ff'], ['\u2692', 'IRON', '#cdd9ff'], ['\u269b', 'PLASMA', '#b87bff']];
    let val = [0, 0, 0], rate = [42, 18, 7], floats = [], pulse = [0, 0, 0];

    return {
      frame: function (dt, t) {
        const W = api.W, H = api.H;
        K.bg(api, { top: '#0c1226', mid: '#070b18', tint: 'rgba(95,160,255,0.08)', drift: 1.4 });

        // three vertical faucet columns
        const colW = W / 3;
        for (let i = 0; i < 3; i++) {
          val[i] += rate[i] * dt * (1 + 0.3 * Math.sin(t * 0.7 + i));
          if (Math.random() < dt * (2 + i * 0.5)) { val[i] += rate[i] * 0.4; floats.push({ i, x: colW * i + colW / 2 + rnd(-18, 18), y: H * 0.42, txt: '+' + (rate[i] * (0.3 + Math.random() * 0.5) | 0), life: 1, max: 1 }); pulse[i] = 1; P.burst(colW * i + colW / 2, H * 0.34, { n: 3, col: RES[i][2], sp0: 15, sp1: 50, l0: 0.3, l1: 0.6, r0: 1, r1: 2.2 }); }
          if (pulse[i] > 0) pulse[i] -= dt * 2;
          const cx = colW * i + colW / 2;
          // generator node (a small orbiting system)
          ctx.globalAlpha = 0.25 + pulse[i] * 0.4; ctx.fillStyle = RES[i][2]; ctx.beginPath(); ctx.arc(cx, H * 0.3, 16 + pulse[i] * 5, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
          ctx.fillStyle = RES[i][2]; ctx.shadowColor = RES[i][2]; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(cx, H * 0.3, 7, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
          // orbiting moon
          ctx.fillStyle = 'rgba(255,255,255,0.6)'; const ma = t * 1.5 + i * 2; ctx.beginPath(); ctx.arc(cx + Math.cos(ma) * 18, H * 0.3 + Math.sin(ma) * 18, 2, 0, TAU); ctx.fill();
          // glyph + label
          K.text(ctx, RES[i][0], cx, H * 0.3 + 4, { size: 13, col: '#fff', stroke: false, baseline: 'middle' });
          K.text(ctx, RES[i][1], cx, H * 0.5, { size: 10, col: RES[i][2], sw: 2.4 });
          // counter
          K.text(ctx, K.num(val[i] | 0), cx, H * 0.5 + 20, { size: 18, col: '#fff', sw: 3, font: 'Orbitron, Rajdhani, sans-serif' });
          // rate bar
          const bw = colW * 0.56, bx = cx - bw / 2, by = H * 0.62;
          ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(bx, by, bw, 5);
          const f = 0.4 + 0.5 * (0.5 + 0.5 * Math.sin(t * 1.5 + i)); ctx.fillStyle = RES[i][2]; ctx.fillRect(bx, by, bw * f, 5);
          K.text(ctx, '+' + rate[i] + '/hr', cx, by + 16, { size: 8.5, col: '#9fb0d6', sw: 2 });
        }
        // dividers
        ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1; for (let i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo(colW * i, H * 0.16); ctx.lineTo(colW * i, H * 0.78); ctx.stroke(); }

        P.update(dt); P.draw(ctx);
        for (const f of floats) { f.life -= dt; f.y -= 24 * dt; ctx.globalAlpha = Math.max(0, f.life / f.max); K.text(ctx, f.txt, f.x, f.y, { size: 10, col: RES[f.i][2], sw: 2.4 }); }
        ctx.globalAlpha = 1;
        for (let i = floats.length - 1; i >= 0; i--) if (floats[i].life <= 0) floats.splice(i, 1);

        K.text(ctx, 'HOURLY GALAXY TRIBUTE', W / 2, H * 0.9, { size: 10, col: '#8fb6d6', sw: 2.4 });
        K.vignette(api, 0.5);
        api.setHud('pow', '3 RES');
      },
    };
  };
})();
