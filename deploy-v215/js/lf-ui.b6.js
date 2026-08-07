/* =============================================================================
   sim-ui.js — UI / panel feature sims for Loot Fleet
   Rarity Ladder · Auto-Equip · Salvage · Gold Shop · Hull Skins · Auras · Cloud
   ============================================================================= */
(function () {
  'use strict';
  const K = window.SimKit, TAU = K.TAU, rnd = K.rnd, clamp = K.clamp, lerp = K.lerp;
  const S = window.LF_SCENES;

  // 12 rarity tiers from the real game config
  const TIERS = [
    ['COMMON', '#9aa0a6'], ['UNCOMMON', '#5bc06b'], ['RARE', '#4a90e2'], ['EPIC', '#b15cff'],
    ['LEGENDARY', '#f0972a'], ['MYTHIC', '#ff3b4e'], ['ANCIENT', '#21d4c4'], ['DIVINE', '#ffe27a'],
    ['COSMIC', '#ff6ad5'], ['VOID', '#9a5bff'], ['ETERNAL', '#eae6ff'], ['PRIMORDIAL', '#ffe6a8'],
  ];
  const ODDS = ['1 in 2', '1 in 5', '1 in 14', '1 in 48', '1 in 200', '1 in 900', '1 in 4.4K', '1 in 22K', '1 in 118K', '1 in 666K', '1 in 4M', '1 in 50M'];

  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  /* 5 · 11 RARITY TIERS — a gear card flips up the rarity chain, glow + odds
     intensifying with each tier, then loops. The dopamine ladder. */
  S.rarity = function (api) {
    const ctx = api.ctx;
    const P = K.particles(120);
    let idx = 0, pt = 0, flip = 0;
    return {
      frame: function (dt, t) {
        const W = api.W, H = api.H, cx = W / 2, cy = H * 0.46;
        const tier = TIERS[idx], col = tier[1];
        K.bg(api, { top: '#0e1020', mid: '#08060f', tint: K.rgba(col, 0.14), drift: 1.4 });

        pt += dt;
        if (pt > 1.5) { pt = 0; idx = (idx + 1) % TIERS.length; flip = 1; P.burst(cx, cy, { n: 10 + idx * 2, col: TIERS[idx][1], sp0: 40, sp1: 160 + idx * 12, l0: 0.4, l1: 1, r0: 1.2, r1: 3 }); P.ring(cx, cy, TIERS[idx][1], 18, 0.5); }
        if (flip > 0) flip -= dt * 2.5;
        const c2 = TIERS[idx][1];

        P.update(dt); P.draw(ctx);

        // the gear card
        const cw = Math.min(W * 0.5, 150), ch = cw * 1.18;
        const sc = 1 + Math.max(0, flip) * 0.12;
        ctx.save(); ctx.translate(cx, cy + Math.sin(t * 1.5) * 3); ctx.scale(sc, sc);
        // glow halo
        const gl = idx;
        const hg = ctx.createRadialGradient(0, 0, cw * 0.2, 0, 0, cw * 0.85);
        hg.addColorStop(0, K.rgba(c2, 0.34)); hg.addColorStop(1, K.rgba(c2, 0));
        ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(0, 0, cw * 0.85, 0, TAU); ctx.fill();
        // card body
        ctx.fillStyle = '#0e1420'; ctx.strokeStyle = c2; ctx.lineWidth = 2.4; ctx.shadowColor = c2; ctx.shadowBlur = 16 + gl * 2;
        roundRect(ctx, -cw / 2, -ch / 2, cw, ch, 12); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
        // top color band
        ctx.fillStyle = K.rgba(c2, 0.18); roundRect(ctx, -cw / 2, -ch / 2, cw, ch * 0.34, 12); ctx.fill();
        // gem icon
        K.gem(ctx, 0, -ch * 0.18, Math.min(5, Math.floor(idx / 2.2)), t, 2.4);
        // sparkle orbits for high tiers
        if (gl >= 6) { for (let i = 0; i < gl - 4; i++) { const a = t * 2 + i * (TAU / (gl - 4)); ctx.fillStyle = c2; ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.arc(Math.cos(a) * cw * 0.42, -ch * 0.18 + Math.sin(a) * cw * 0.42, 1.6, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; } }
        // name + odds
        K.text(ctx, tier[0], 0, ch * 0.12, { size: cw * 0.115, col: c2, sw: 3, font: 'Orbitron, Rajdhani, sans-serif' });
        K.text(ctx, 'TIER ' + (idx + 1) + ' / 12', 0, ch * 0.26, { size: 10, col: '#9fb0c8', sw: 2.2 });
        K.text(ctx, ODDS[idx] + ' drops', 0, ch * 0.4, { size: 10, col: '#cfe0ff', sw: 2.2 });
        ctx.restore();

        // tier pips along the bottom
        const n = TIERS.length, pw = W * 0.84, px = (W - pw) / 2, yy = H * 0.88;
        for (let i = 0; i < n; i++) { const xx = px + (i / (n - 1)) * pw; ctx.fillStyle = i <= idx ? TIERS[i][1] : 'rgba(255,255,255,0.14)'; if (i === idx) { ctx.shadowColor = TIERS[i][1]; ctx.shadowBlur = 8; } ctx.beginPath(); ctx.arc(xx, yy, i === idx ? 3.6 : 2.2, 0, TAU); ctx.fill(); ctx.shadowBlur = 0; }

        K.vignette(api, 0.5);
        api.setHud('pow', 'T' + (idx + 1));
      },
    };
  };

  /* 14 · AUTO-EQUIP & AUTO-SELL — items stream in; upgrades snap into the 6-slot
     loadout (green flash), junk auto-sells into gold (+coins). Zero busywork. */
  S.autoequip = function (api) {
    const ctx = api.ctx;
    const P = K.particles(120);
    const SLOTS = ['CANNON', 'MUNITION', 'HULL', 'THRUSTER', 'TARGET', 'SHIELD'];
    let slots = SLOTS.map(() => ({ tier: 1, flash: 0 })), items = [], spawnT = 0, gold = 10000, floats = [];

    function slotXY(i) { const W = api.W; const cols = 3, gw = W * 0.74, gx = (W - gw) / 2, cw = gw / cols; const r = (i / cols) | 0, c = i % cols; return { x: gx + c * cw + cw / 2, y: api.H * 0.6 + r * (api.H * 0.16), w: cw - 8 }; }

    return {
      frame: function (dt, t) {
        const W = api.W, H = api.H;
        K.bg(api, { top: '#0c1220', mid: '#07060f', tint: 'rgba(95,160,255,0.08)', drift: 1.2 });

        spawnT -= dt;
        if (spawnT <= 0 && items.length < 4) { spawnT = 0.7; const slot = (Math.random() * 6) | 0; const tier = 1 + ((Math.random() * 5) | 0); const upgrade = tier > slots[slot].tier; items.push({ x: rnd(W * 0.2, W * 0.8), y: -20, slot, tier, upgrade, v: rnd(60, 90), settle: 0 }); }

        // slots grid
        for (let i = 0; i < 6; i++) {
          const p = slotXY(i), s = slots[i];
          if (s.flash > 0) s.flash -= dt * 2;
          ctx.fillStyle = s.flash > 0 ? K.rgba('#46d27a', 0.18 * s.flash) : 'rgba(255,255,255,0.03)';
          ctx.strokeStyle = s.flash > 0 ? '#46d27a' : 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1.4;
          roundRect(ctx, p.x - p.w / 2, p.y - 16, p.w, 32, 8); ctx.fill(); ctx.stroke();
          K.gem(ctx, p.x - p.w / 2 + 16, p.y, Math.min(5, s.tier), t, 1.3);
          K.text(ctx, SLOTS[i], p.x + 4, p.y - 2, { size: 8, col: '#cfe0ff', align: 'left', sw: 2, baseline: 'middle' });
          K.text(ctx, 'T' + s.tier, p.x + 4, p.y + 8, { size: 8, col: K.RAR[Math.min(5, s.tier)][1], align: 'left', sw: 2, baseline: 'middle' });
        }

        // items falling → route to slot (upgrade) or sell (gold)
        for (const it of items) {
          it.y += it.v * dt;
          const target = slotXY(it.slot);
          if (it.upgrade) {
            it.x = lerp(it.x, target.x, clamp(dt * 2, 0, 1));
            if (it.y >= target.y - 16) { it.dead = true; slots[it.slot].tier = it.tier; slots[it.slot].flash = 1; P.burst(target.x, target.y, { n: 8, col: '#46d27a', sp0: 30, sp1: 120, l0: 0.3, l1: 0.6, r0: 1, r1: 2.4 }); floats.push({ x: target.x, y: target.y - 16, txt: 'EQUIP \u2191', col: '#46d27a', life: 0.8, max: 0.8 }); }
          } else {
            if (it.y >= H * 0.44) { it.dead = true; const g = (it.tier) * 1400; gold += g; P.burst(it.x, H * 0.44, { n: 6, col: '#ffd24d', sp0: 20, sp1: 90, l0: 0.3, l1: 0.6, r0: 1, r1: 2.2 }); floats.push({ x: it.x, y: H * 0.44, txt: '+' + K.num(g) + ' \u25ce', col: '#ffd24d', life: 0.8, max: 0.8 }); }
          }
          K.gem(ctx, it.x, it.y, Math.min(5, it.tier), t, 1.5);
          ctx.strokeStyle = it.upgrade ? K.rgba('#46d27a', 0.3) : K.rgba('#ffd24d', 0.2); ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(it.x, it.y); if (it.upgrade) { ctx.lineTo(target.x, target.y); } else { ctx.lineTo(it.x, H * 0.44); } ctx.stroke(); ctx.setLineDash([]);
        }

        P.update(dt); P.draw(ctx);
        for (const f of floats) { f.life -= dt * 1.3; f.y -= 26 * dt; ctx.globalAlpha = Math.max(0, f.life / f.max); K.text(ctx, f.txt, f.x, f.y, { size: 10, col: f.col, sw: 2.4 }); }
        ctx.globalAlpha = 1;

        K.text(ctx, '\u25ce ' + K.num(gold), W / 2, 20, { size: 14, col: '#ffd24d', sw: 3, font: 'Orbitron, Rajdhani, sans-serif' });
        K.text(ctx, 'AUTO-EQUIP \u00b7 AUTO-SELL', W / 2, H * 0.93, { size: 9.5, col: '#9fb6d6', sw: 2.2 });

        for (let i = items.length - 1; i >= 0; i--) if (items[i].dead || items[i].y > H + 20) items.splice(i, 1);
        for (let i = floats.length - 1; i >= 0; i--) if (floats[i].life <= 0) floats.splice(i, 1);

        K.vignette(api, 0.5);
        api.setHud('pow', K.num(gold));
      },
    };
  };

  /* 19 · SALVAGE — feed unwanted gear into the scrapper; it bursts into fuel /
     iron / plasma shards that fly into three bins. Nothing is wasted. */
  S.salvage = function (api) {
    const ctx = api.ctx;
    const P = K.particles(160);
    const BINS = [['\u26fd', '#5fd1ff'], ['\u2692', '#cdd9ff'], ['\u269b', '#b87bff']];
    let feed = [], shards = [], binVal = [0, 0, 0], spawnT = 0, scrapPulse = 0;
    function binX(i) { return api.W * (0.25 + i * 0.25); }

    return {
      frame: function (dt, t) {
        const W = api.W, H = api.H, sx = W / 2, sy = H * 0.42;
        K.bg(api, { top: '#0d1122', mid: '#070a14', tint: 'rgba(120,140,200,0.07)', drift: 1.2 });

        spawnT -= dt;
        if (spawnT <= 0 && feed.length < 3) { spawnT = 0.9; feed.push({ x: rnd(W * 0.2, W * 0.8), y: -16, tier: (Math.random() * 6) | 0, v: rnd(70, 100) }); }

        // scrapper core
        if (scrapPulse > 0) scrapPulse -= dt * 2;
        const pr = 0.5 + 0.5 * Math.sin(t * 3);
        ctx.globalAlpha = 0.2 + scrapPulse * 0.4; ctx.fillStyle = api.accent; ctx.beginPath(); ctx.arc(sx, sy, 22 + scrapPulse * 8, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = K.rgba(api.accent, 0.5 + 0.3 * pr); ctx.lineWidth = 2;
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(t * 1.5);
        for (let i = 0; i < 3; i++) { ctx.rotate(TAU / 3); ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(5, -9); ctx.lineTo(-5, -9); ctx.closePath(); ctx.stroke(); }
        ctx.restore();
        K.text(ctx, '\u2692', sx, sy + 5, { size: 16, col: '#fff', stroke: false, baseline: 'middle' });

        // feed items into scrapper
        for (const it of feed) {
          it.y += it.v * dt; it.x = lerp(it.x, sx, clamp(dt * 1.5, 0, 1));
          if (it.y >= sy - 10) {
            it.dead = true; scrapPulse = 1;
            P.burst(sx, sy, { n: 10, col: K.RAR[it.tier][1], sp0: 40, sp1: 130, l0: 0.3, l1: 0.6, r0: 1, r1: 2.4 });
            // emit shards to bins (rarer gear → more iron/plasma)
            const nShards = 2 + it.tier;
            for (let i = 0; i < nShards; i++) { const wTbl = [10, 3 + it.tier, 2 + it.tier]; const total = wTbl[0] + wTbl[1] + wTbl[2]; let r = Math.random() * total, kind = 0; for (let k = 0; k < 3; k++) { if (r < wTbl[k]) { kind = k; break; } r -= wTbl[k]; } shards.push({ x: sx, y: sy, kind, tx: binX(kind), ty: H * 0.8, p: 0, amt: 1 + it.tier }); }
          }
          K.gem(ctx, it.x, it.y, it.tier, t, 1.4);
        }

        // shards fly to bins
        for (const sh of shards) { sh.p = clamp(sh.p + dt * 1.6, 0, 1); const ease = sh.p * sh.p * (3 - 2 * sh.p); sh.x = lerp(sx, sh.tx, ease); sh.y = lerp(sy, sh.ty, ease) - Math.sin(sh.p * Math.PI) * 20; if (sh.p >= 1 && !sh.done) { sh.done = true; binVal[sh.kind] += sh.amt; } if (!sh.done) { ctx.fillStyle = BINS[sh.kind][1]; ctx.shadowColor = BINS[sh.kind][1]; ctx.shadowBlur = 6; ctx.beginPath(); ctx.arc(sh.x, sh.y, 2.6, 0, TAU); ctx.fill(); ctx.shadowBlur = 0; } }

        P.update(dt); P.draw(ctx);

        // bins
        for (let i = 0; i < 3; i++) { const bx = binX(i), by = H * 0.8; ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.strokeStyle = K.rgba(BINS[i][1], 0.5); ctx.lineWidth = 1.4; roundRect(ctx, bx - 28, by - 14, 56, 30, 7); ctx.fill(); ctx.stroke(); K.text(ctx, BINS[i][0], bx - 14, by + 1, { size: 13, col: BINS[i][1], stroke: false, baseline: 'middle' }); K.text(ctx, K.num(binVal[i] | 0), bx + 6, by + 1, { size: 11, col: '#fff', sw: 2.4, baseline: 'middle', font: 'Orbitron, Rajdhani, sans-serif' }); }

        K.text(ctx, 'SALVAGE \u2192 RESOURCES', W / 2, H * 0.95, { size: 9.5, col: '#aeb8d6', sw: 2.2 });
        for (let i = feed.length - 1; i >= 0; i--) if (feed[i].dead) feed.splice(i, 1);
        for (let i = shards.length - 1; i >= 0; i--) if (shards[i].done) shards.splice(i, 1);

        K.vignette(api, 0.5);
        api.setHud('pow', 'SALVAGE');
      },
    };
  };

  /* 20 · GOLD SHOP — three rotating item cards under a refresh ring; periodically
     a buy pulse fires and the shelf refreshes with new gear. */
  S.shop = function (api) {
    const ctx = api.ctx;
    const P = K.particles(100);
    function roll() { return [0, 1, 2].map(() => 4 + ((Math.random() * 6) | 0)); }
    let stock = roll(), buyT = 0, refresh = 1, buyIdx = -1, buyPulse = 0;

    return {
      frame: function (dt, t) {
        const W = api.W, H = api.H;
        K.bg(api, { top: '#0e1120', mid: '#08060f', tint: 'rgba(242,178,75,0.08)', drift: 1.2 });

        buyT += dt; refresh = clamp(1 - (buyT % 5) / 5, 0, 1);
        if (buyT % 5 < dt && buyT > 1) { buyIdx = (Math.random() * 3) | 0; buyPulse = 1; }
        if (buyPulse > 0) { buyPulse -= dt * 1.6; if (buyPulse <= 0 && buyIdx >= 0) { stock[buyIdx] = 4 + ((Math.random() * 6) | 0); buyIdx = -1; } }

        // refresh ring (top)
        const rx = W / 2, ry = 22, rr = 11;
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(rx, ry, rr, 0, TAU); ctx.stroke();
        ctx.strokeStyle = api.accent; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(rx, ry, rr, -Math.PI / 2, -Math.PI / 2 + refresh * TAU); ctx.stroke(); ctx.lineCap = 'butt';
        K.text(ctx, 'RESTOCK', rx + rr + 6, ry, { size: 9, col: '#9fb0c8', align: 'left', sw: 2, baseline: 'middle' });

        // three item cards
        const cw = W * 0.26, gap = W * 0.04, total = cw * 3 + gap * 2, x0 = (W - total) / 2, cy = H * 0.5, ch = cw * 1.5;
        for (let i = 0; i < 3; i++) {
          const tier = stock[i], col = K.RAR[Math.min(5, tier - 4 + 2)] ? K.RAR[Math.min(5, Math.max(0, tier - 4))][1] : '#ffd24d';
          const rc = ['#f0972a', '#ff3b4e', '#21d4c4', '#ffe27a', '#ff6ad5', '#9a5bff'][tier - 4] || '#f0972a';
          const cx = x0 + i * (cw + gap) + cw / 2;
          const lift = (i === buyIdx) ? Math.sin(buyPulse * Math.PI) * 8 : 0;
          ctx.save(); ctx.translate(cx, cy - lift);
          if (i === buyIdx) { ctx.shadowColor = rc; ctx.shadowBlur = 18; }
          ctx.fillStyle = '#0e1420'; ctx.strokeStyle = rc; ctx.lineWidth = 2; roundRect(ctx, -cw / 2, -ch / 2, cw, ch, 10); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
          ctx.fillStyle = K.rgba(rc, 0.16); roundRect(ctx, -cw / 2, -ch / 2, cw, ch * 0.3, 10); ctx.fill();
          K.gem(ctx, 0, -ch * 0.16, Math.min(5, tier - 4), t, 2);
          const RN = ['LEGENDARY', 'MYTHIC', 'ANCIENT', 'DIVINE', 'COSMIC', 'VOID'][tier - 4] || 'RARE';
          K.text(ctx, RN, 0, ch * 0.16, { size: cw * 0.13, col: rc, sw: 2.4 });
          // price tag
          ctx.fillStyle = 'rgba(242,178,75,0.16)'; roundRect(ctx, -cw * 0.32, ch * 0.28, cw * 0.64, 18, 6); ctx.fill();
          K.text(ctx, '\u25ce ' + K.num((tier - 3) * (tier - 3) * 4800), 0, ch * 0.28 + 12, { size: 10, col: '#ffd24d', sw: 2.2, baseline: 'middle' });
          ctx.restore();
          if (i === buyIdx && buyPulse > 0.6) { P.burst(cx, cy, { n: 4, col: '#ffd24d', sp0: 20, sp1: 80, l0: 0.2, l1: 0.5, r0: 1, r1: 2 }); }
        }

        P.update(dt); P.draw(ctx);
        K.text(ctx, '3 ITEMS \u00b7 REFRESH 15 MIN', W / 2, H * 0.9, { size: 9.5, col: '#cdb98a', sw: 2.2 });
        K.vignette(api, 0.5);
        api.setHud('pow', 'SHOP');
      },
    };
  };

  /* 21 · HULL SKINS — the flagship cycles through premium finishes; a color
     wash + name plate sells each cosmetic. Flex, never pay-to-win. */
  S.skins = function (api) {
    const ctx = api.ctx;
    const ship = K.img('ships/ship-titan.png');
    const SK = [['FACTORY', null], ['CRIMSON FANG', '#e84a5f'], ['ARCTIC GHOST', '#bfe0ff'], ['TIGER STRIKE', '#e8801e'], ['VOIDPLATE', '#7b3fd0'], ['GILDED', '#ffd24d'], ['PRISMATIC', 'prism']];
    let idx = 0, pt = 0, fade = 1;
    return {
      frame: function (dt, t) {
        const W = api.W, H = api.H, cx = W / 2, cy = H * 0.46;
        const sk = SK[idx];
        K.bg(api, { top: '#0e1226', mid: '#080a16', tint: sk[1] && sk[1] !== 'prism' ? K.rgba(sk[1], 0.16) : 'rgba(180,120,255,0.12)', drift: 1.4 });
        pt += dt;
        if (pt > 1.8) { pt = 0; idx = (idx + 1) % SK.length; fade = 0; }
        fade = clamp(fade + dt * 2, 0, 1);

        // rotating cosmetic ring
        const prism = sk[1] === 'prism';
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 0.5);
        for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; const c = prism ? 'hsl(' + ((i / 24 * 360 + t * 60) % 360) + ',90%,65%)' : (sk[1] || '#9fb0c8'); ctx.strokeStyle = K.rgba(c[0] === '#' ? c : '#ffffff', 0.4); if (c[0] !== '#') ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 54, Math.sin(a) * 54); ctx.lineTo(Math.cos(a) * 64, Math.sin(a) * 64); ctx.stroke(); }
        ctx.restore();

        // ship with skin wash
        const sz = Math.min(W * 0.42, 120) + Math.sin(t * 1.5) * 2;
        ctx.save(); ctx.translate(cx, cy + Math.sin(t * 1.4) * 3);
        // glow
        const gc = prism ? 'hsl(' + ((t * 90) % 360) + ',90%,65%)' : (sk[1] || '#7fb0e0');
        const hg = ctx.createRadialGradient(0, 0, sz * 0.2, 0, 0, sz * 0.75); hg.addColorStop(0, 'rgba(0,0,0,0)'); hg.addColorStop(1, prism ? gc : K.rgba(gc, 0.3)); ctx.globalAlpha = 0.5; ctx.fillStyle = prism ? gc : K.rgba(gc, 0.3); ctx.beginPath(); ctx.arc(0, 0, sz * 0.7, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
        if (ship.complete && ship.naturalWidth) ctx.drawImage(ship, -sz / 2, -sz / 2, sz, sz);
        // color wash overlay
        if (sk[1]) { ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = fade * (prism ? 0.5 : 0.55); if (prism) { const g = ctx.createLinearGradient(-sz / 2, -sz / 2, sz / 2, sz / 2); for (let i = 0; i <= 5; i++) g.addColorStop(i / 5, 'hsl(' + ((i * 60 + t * 90) % 360) + ',90%,60%)'); ctx.fillStyle = g; } else ctx.fillStyle = sk[1]; ctx.beginPath(); ctx.arc(0, 0, sz * 0.46, 0, TAU); ctx.fill(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
        ctx.restore();

        // name plate
        ctx.globalAlpha = fade;
        K.text(ctx, sk[0], cx, H * 0.74, { size: 16, col: prism ? '#fff' : (sk[1] || '#cfe0ff'), sw: 3.4, font: 'Orbitron, Rajdhani, sans-serif' });
        K.text(ctx, 'HULL SKIN \u00b7 COSMETIC', cx, H * 0.74 + 17, { size: 9, col: '#9fb0c8', sw: 2.2 });
        ctx.globalAlpha = 1;
        // pips
        for (let i = 0; i < SK.length; i++) { const xx = cx + (i - (SK.length - 1) / 2) * 16; ctx.fillStyle = i === idx ? '#ffd24d' : 'rgba(255,255,255,0.16)'; ctx.beginPath(); ctx.arc(xx, H * 0.88, i === idx ? 3.4 : 2, 0, TAU); ctx.fill(); }
        K.vignette(api, 0.48);
        api.setHud('pow', 'SKINS');
      },
    };
  };

  /* 24 · BATTLE AURAS — the ship cycles equippable orbiting auras: sentinel
     rings, cryo field, solar flare, void storm, prismatic halo. */
  S.auras = function (api) {
    const ctx = api.ctx;
    const ship = K.img('ships/ship-dreadnought.png');
    const P = K.particles(160);
    const AU = ['SENTINEL RINGS', 'CRYO FIELD', 'SOLAR FLARE', 'VOID STORM', 'PRISMATIC HALO'];
    const AC = ['#f2b24b', '#9ad4ff', '#ff9a3c', '#9a5bff', 'prism'];
    let idx = 0, pt = 0;
    return {
      frame: function (dt, t) {
        const W = api.W, H = api.H, cx = W / 2, cy = H * 0.46;
        const col = AC[idx], prism = col === 'prism';
        K.bg(api, { top: '#0d1024', mid: '#070611', tint: prism ? 'rgba(180,120,255,0.12)' : K.rgba(col, 0.13), drift: 1.4 });
        pt += dt; if (pt > 2.4) { pt = 0; idx = (idx + 1) % AU.length; }

        const R = Math.min(W, H) * 0.3;
        // aura render per type
        if (idx === 0) { // sentinel: twin counter-rotating rings
          for (let k = 0; k < 2; k++) { ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * (k ? -1 : 1) * 1.2); ctx.strokeStyle = K.rgba('#f2b24b', 0.6); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, R * (0.7 + k * 0.3), 0, TAU * 0.8); ctx.stroke(); for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU; ctx.fillStyle = '#ffd24d'; ctx.beginPath(); ctx.arc(Math.cos(a) * R * (0.7 + k * 0.3), Math.sin(a) * R * (0.7 + k * 0.3), 3, 0, TAU); ctx.fill(); } ctx.restore(); }
        } else if (idx === 1) { // cryo: crystalline lattice
          for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + t * 0.4; const rr = R * (0.8 + 0.1 * Math.sin(t * 2 + i)); ctx.save(); ctx.translate(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); ctx.rotate(a + t); ctx.strokeStyle = K.rgba('#9ad4ff', 0.7); ctx.lineWidth = 1.4; for (let j = 0; j < 3; j++) { ctx.rotate(TAU / 3); ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(0, 5); ctx.stroke(); } ctx.restore(); }
        } else if (idx === 2) { // solar flare: licking fire
          for (let i = 0; i < 5; i++) { if (Math.random() < 0.5) { const a = Math.random() * TAU; P.burst(cx + Math.cos(a) * R * 0.7, cy + Math.sin(a) * R * 0.7, { n: 1, col: Math.random() < 0.5 ? '#ff9a3c' : '#ffd24d', sp0: 10, sp1: 50, a: a, spread: 1, l0: 0.3, l1: 0.6, r0: 1.4, r1: 3 }); } }
          ctx.strokeStyle = K.rgba('#ff9a3c', 0.4 + 0.2 * Math.sin(t * 4)); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, R * 0.7, 0, TAU); ctx.stroke();
        } else if (idx === 3) { // void storm: captive motes
          for (let i = 0; i < 14; i++) { const a = t * 1.5 + i * (TAU / 14); const rr = R * (0.5 + 0.4 * Math.sin(t * 2 + i)); ctx.fillStyle = K.rgba('#9a5bff', 0.8); ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 2.4, 0, TAU); ctx.fill(); }
        } else { // prismatic halo
          ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 0.6); for (let i = 0; i < 36; i++) { const a = (i / 36) * TAU; ctx.strokeStyle = 'hsl(' + ((i / 36 * 360 + t * 60) % 360) + ',90%,62%)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(Math.cos(a) * R * 0.78, Math.sin(a) * R * 0.78); ctx.lineTo(Math.cos(a) * R * 0.92, Math.sin(a) * R * 0.92); ctx.stroke(); } ctx.restore();
        }

        P.update(dt); P.draw(ctx);
        const sz = Math.min(W * 0.34, 96) + Math.sin(t * 1.5) * 2;
        K.ship(ctx, ship, cx, cy + Math.sin(t * 1.4) * 3, sz, t, { glow: prism ? '#b87bff' : col });

        K.text(ctx, AU[idx], cx, H * 0.76, { size: 14, col: prism ? '#fff' : col, sw: 3, font: 'Orbitron, Rajdhani, sans-serif' });
        K.text(ctx, 'BATTLE AURA \u00b7 COSMETIC', cx, H * 0.76 + 16, { size: 9, col: '#9fb0c8', sw: 2.2 });
        for (let i = 0; i < AU.length; i++) { const xx = cx + (i - (AU.length - 1) / 2) * 16; ctx.fillStyle = i === idx ? '#ffd24d' : 'rgba(255,255,255,0.16)'; ctx.beginPath(); ctx.arc(xx, H * 0.88, i === idx ? 3.4 : 2, 0, TAU); ctx.fill(); }
        K.vignette(api, 0.48);
        api.setHud('pow', 'AURAS');
      },
    };
  };

  /* 25 · CLOUD SAVE — progress syncs between a phone and a desktop; a data pulse
     travels the link, both screens tick to the same Hero Power. Play anywhere. */
  S.cloud = function (api) {
    const ctx = api.ctx;
    const P = K.particles(80);
    let pow = 4.2e9, pulses = [], syncT = 0, syncFlash = 0;

    function device(x, y, w, h, label, val, flash) {
      ctx.fillStyle = '#0e1420'; ctx.strokeStyle = flash > 0 ? K.rgba('#46d27a', 0.4 + 0.4 * flash) : 'rgba(255,255,255,0.16)'; ctx.lineWidth = 2;
      roundRect(ctx, x - w / 2, y - h / 2, w, h, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(95,160,255,0.08)'; roundRect(ctx, x - w / 2 + 3, y - h / 2 + 3, w - 6, h - 6, 6); ctx.fill();
      K.text(ctx, label, x, y - h / 2 + 12, { size: 8, col: '#7f9bc0', sw: 2, baseline: 'middle' });
      K.text(ctx, K.num(val), x, y, { size: Math.min(15, w * 0.18), col: '#ffd24d', sw: 2.6, baseline: 'middle', font: 'Orbitron, Rajdhani, sans-serif' });
      K.text(ctx, '\u26a1 HERO POWER', x, y + h / 2 - 12, { size: 7, col: '#f2b24b', sw: 1.8, baseline: 'middle' });
    }

    return {
      frame: function (dt, t) {
        const W = api.W, H = api.H;
        K.bg(api, { top: '#0c1226', mid: '#070b18', tint: 'rgba(70,210,122,0.07)', drift: 1.2 });
        pow += 8e7 * dt;

        const phoneX = W * 0.28, deskX = W * 0.72, midY = H * 0.42;
        // cloud node up top
        const clx = W / 2, cly = H * 0.16;
        const pr = 0.5 + 0.5 * Math.sin(t * 2);
        ctx.globalAlpha = 0.2 + syncFlash * 0.3; ctx.fillStyle = '#46d27a'; ctx.beginPath(); ctx.arc(clx, cly, 20 + syncFlash * 6, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
        // cloud glyph
        ctx.fillStyle = K.rgba('#9fe6bf', 0.9); ctx.beginPath(); ctx.arc(clx - 8, cly + 2, 7, 0, TAU); ctx.arc(clx, cly - 3, 9, 0, TAU); ctx.arc(clx + 9, cly + 2, 7, 0, TAU); ctx.fill(); ctx.fillStyle = K.rgba('#9fe6bf', 0.9); ctx.fillRect(clx - 15, cly + 2, 30, 7);
        K.text(ctx, '\u2601 CLOUD', clx, cly + 26, { size: 9, col: '#9fe6bf', sw: 2.2 });

        // links cloud→phone, cloud→desktop
        ctx.strokeStyle = 'rgba(120,200,160,0.25)'; ctx.lineWidth = 1.4; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(clx, cly + 16); ctx.lineTo(phoneX, midY - 40); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(clx, cly + 16); ctx.lineTo(deskX, midY - 32); ctx.stroke(); ctx.setLineDash([]);

        // emit sync pulses
        syncT += dt;
        if (syncT > 1.6) { syncT = 0; syncFlash = 1; pulses.push({ from: 'p', p: 0 }); pulses.push({ to: 'd', p: 0, delay: 0.25 }); }
        if (syncFlash > 0) syncFlash -= dt * 1.5;
        for (const pu of pulses) {
          pu.p = clamp(pu.p + dt * 1.2, 0, 1);
          let ax, ay, bx, by;
          if (pu.from === 'p') { ax = phoneX; ay = midY - 40; bx = clx; by = cly + 16; } else { ax = clx; ay = cly + 16; bx = deskX; by = midY - 32; }
          const x = lerp(ax, bx, pu.p), y = lerp(ay, by, pu.p);
          ctx.fillStyle = '#7fffcb'; ctx.shadowColor = '#7fffcb'; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(x, y, 3, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
        }
        for (let i = pulses.length - 1; i >= 0; i--) if (pulses[i].p >= 1) pulses.splice(i, 1);

        P.update(dt); P.draw(ctx);

        // devices (phone + desktop) — same value, always in sync
        device(phoneX, midY, W * 0.26, H * 0.3, 'PHONE', pow, syncFlash);
        device(deskX, midY, W * 0.34, H * 0.24, 'DESKTOP', pow, syncFlash);

        K.text(ctx, 'ONE SAVE \u00b7 EVERY DEVICE', W / 2, H * 0.78, { size: 11, col: '#9fe6bf', sw: 2.6, font: 'Orbitron, Rajdhani, sans-serif' });
        K.text(ctx, 'Free account \u00b7 no download \u00b7 plays offline', W / 2, H * 0.78 + 17, { size: 9, col: '#8fa6c0', sw: 2 });
        K.vignette(api, 0.5);
        api.setHud('pow', K.num(pow));
      },
    };
  };
})();
