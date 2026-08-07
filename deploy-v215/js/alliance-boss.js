/* =============================================================================
   alliance-boss.js — THE HOLLOW ARMADA · live alliance raid ON THE REAL ENGINE
   ---------------------------------------------------------------------------
   Exactly the Voidmaw treatment: GAME.startAllianceRaid() drops one huge boss
   into a clean arena; you fly your REAL flagship (manual flight, auto-pilot
   off, 1× speed), and your real weapons chip its hull. The boss hull IS the
   mark's remaining HP — raw combat damage, no cap, no conversion.
   ONE BOSS PER RUN (Jul 2026). The arena hull IS the shared pool: its bar
   mirrors pool-remaining, so what you watch drain is exactly what the server
   subtracts. There is NO client-side mark ladder — burn the pool to 0 and the
   run ENDS as a kill; the mark only advances when the SERVER confirms it, and
   every confirmed kill pays ⬡ 300 to every member. Ladder resets to Mk-1
   every Sunday 12AM CST. 2:30 window. VOID COLLAPSE zones telegraph, blink
   faster, then drop 5s black holes that burn 75% max hull/sec. Monolith hulls
   add their siegeBonus to every transmitted point. Final 20s ENRAGE.
   window.ALBOSS.start({bossN, bossHp, bossMax, onDone(res)}) — res =
   { dmg, frac 0..1, bonus, died, killed, kills }.
   ============================================================================= */
(function () {
  'use strict';
  const G = () => window.GAME, C = () => window.CONFIG, $ = (id) => document.getElementById(id);
  const fmt = (n) => { try { return G().formatNum(Math.floor(n)); } catch (e) { return String(Math.floor(n)); } };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const T = 150;
  // NO PER-RUN DAMAGE CAP (Aug 2026). The Armada has a FIXED hull per mark:
  //   hull(mark) = 1e6 × 4 ^ (mark - 1)
  // Mk-1 is small enough for one pilot to one-shot; every mark is ×4 harder, so
  // the ladder outgrows any single fleet within ~20 marks and the rest of the
  // week belongs to the whole alliance. Your RAW combat damage is the damage —
  // no normalization, no power-unit conversion, no ceiling. The ×4 step is
  // deliberately steep: real burst output spans ~20 orders of magnitude across
  // the playerbase (theoryDps badly understates it — multishot, drones, escorts,
  // chain lightning and singularity all land damage it never counted), so a
  // gentler ladder is one-shot spam for a deep pilot at every mark.
  // See supabase/alliance-boss-setladder.sql for the server half.
  let run = null;

  function banner(t, s) {
    const old = $('al-banner'); if (old) old.remove();
    const d = document.createElement('div'); d.id = 'al-banner';
    d.innerHTML = '<b>' + t + '</b>' + (s ? '<span>' + s + '</span>' : '');
    document.body.appendChild(d);
    setTimeout(() => d.classList.add('off'), 2600);
    setTimeout(() => d.remove(), 3300);
  }

  function start(opts) {
    if (run) return;
    if (!G() || !G().startAllianceRaid) { if (window.SOCIAL) SOCIAL.toast('Combat systems offline — update required', '#e23b4e'); return; }
    // one event at a time — don't stomp a live Voidmaw run or fort defense
    try { const grt = G().rt; if (grt && ((grt.sdrun && grt.sdrun.active) || (grt.hcrun && grt.hcrun.active))) { if (window.SOCIAL) SOCIAL.toast('Finish your current event first', '#e23b4e'); return; } } catch (e) {}
    let prevSpeed = 1; try { prevSpeed = G().state.gameSpeed || 1; G().setGameSpeed(1); } catch (e) {}
    let prevAuto = false; try { prevAuto = !!G().getAuto(); G().setAuto(false); } catch (e) {}
    const n = Math.max(1, opts.bossN | 0);
    const pool = Math.max(1, Number(opts.bossHp) || 1);   // the mark's remaining hull, from the server
    // NAVIGATE FIRST. Switching to the battle screen resets the zone, which used
    // to wipe the Armada we had just spawned — and because the boss hull is now
    // the damage source, the next tick read the vanished hull as 0 and scored an
    // instant full-pool kill. Build the arena only once we are already there.
    const nav = document.querySelector('.nav-btn[data-screen="battle"]'); if (nav) nav.click();
    let b = null;
    try { b = G().startAllianceRaid(n, pool); } catch (e) {}
    if (!b) {
      try { G().setAuto(prevAuto); G().setGameSpeed(prevSpeed); } catch (e) {}
      if (window.SOCIAL) SOCIAL.toast('Deploy failed — try again', '#e23b4e');
      return;
    }
    const sh = (C().SHIP_BY_KEY || {})[(G().state || {}).ship] || {};
    const bonus = sh.siegeBonus || 0;
    run = { left: T, dealt: 0, kills: 0, boss: b, lastHp: 0, uiT: 0, zones: [], zoneT: 4.5, warned: false, enraged: false,
            n, bonus, poolHp: pool, died: false, submitted: false,
            prevAuto, prevSpeed, onDone: opts.onDone };
    const app = $('app'); if (app) app.classList.add('sd-noauto');
    warbar();
    banner('⬡ HOLLOW ARMADA Mk-' + n + ' ENGAGED',
      'MANUAL FLIGHT — dodge the collapse zones · 2:30 · ' + fmt(pool) + ' hull left — burn it to 0 and every member is paid ⬡ 300' + (bonus ? ' · ⬡ MONOLITH +' + Math.round(bonus * 100) + '%' : ''));
  }

  // driven by the engine's update() every frame while rt.alrun is active
  function engineTick(dt, rt) {
    if (!run) { rt.alrun = null; return; }
    const b = run.boss;
    if (!b) return end('time');
    // another event took the arena (Voidmaw / fort defense) — settle as abandoned
    if ((rt.sdrun && rt.sdrun.active) || (rt.hcrun && rt.hcrun.active) || (rt.boss && rt.boss !== b)) return end('abandoned', true);
    // the arena was torn down under us (zone reset / screen change). The hull IS
    // the damage source now, so a vanished boss must NEVER read as a full kill.
    if (rt.enemies.indexOf(b) === -1) return end('abandoned', true);
    // The engine resolved the real hits and the boss hull IS the mark's hull,
    // so damage dealt is simply how much of it is gone. Monolith siegeBonus
    // multiplies what transmits, and it eats hull at the same rate.
    const eaten = Math.max(0, run.poolHp - b.hp) * (1 + run.bonus);
    run.dealt = Math.max(run.dealt, eaten);
    if (run.bonus && b.hp > 1) b.hp = Math.max(1, run.poolHp - eaten);   // the bonus visibly burns extra hull
    b.dying = false;
    // ONE BOSS AT A TIME — hull to 0 ends the run NOW as a kill. No local mark
    // ladder: the server advances the mark and pays ⬡ 300 on confirm.
    if (run.dealt >= run.poolHp) {
      run.dealt = run.poolHp;
      run.kills = 1;
      rt.shake = Math.min(8, (rt.shake || 0) + 5);
      banner('☠ HOLLOW ARMADA Mk-' + run.n + ' DESTROYED', 'Hull burned to zero — ⬡ 300 paid to every member · the Armada rebuilds at Mk-' + (run.n + 1) + ', ×4 harder');
      return end('killed');
    }
    run.left -= dt;
    // ENRAGE — final 20s: faster zones + faster boss fire
    if (!run.enraged && run.left <= 20) {
      run.enraged = true; b.fireCd = Math.max(0.6, (b.fireCd || 1.4) * 0.7);
      banner('⚠ ENRAGE', 'The Armada overloads — collapse zones accelerate');
      rt.shake = Math.min(7, (rt.shake || 0) + 3);
    }
    // MANUAL FLIGHT ONLY + extended engagement range (same as the Voidmaw)
    try { if (G().getAuto()) G().setAuto(false); } catch (e) {}
    if (rt.stats && !rt.stats._alRange) { rt.stats.fireRange = (rt.stats.fireRange || 250) * 3; rt.stats._alRange = 1; }
    // VOID COLLAPSE ZONES — telegraph blinks faster, then a 5s black hole
    const a = rt.archer, mul = run.enraged ? 0.6 : 1;
    run.zoneT -= dt;
    if (run.zoneT <= 0 && a && !a.dead) {
      const k = 1 + (run.n >= 6 ? 1 : 0) + (run.n >= 12 ? 1 : 0);
      for (let i = 0; i < k; i++) {
        const ang = Math.random() * Math.PI * 2, off = i === 0 ? 0 : 110 + Math.random() * 150;
        run.zones.push({ x: a.x + Math.cos(ang) * off, y: a.y + Math.sin(ang) * off,
                         r: 150 + Math.min(70, run.n * 4), t: 6.0, total: 6.0, phase: 0, hole: 0 });
      }
      run.zoneT = Math.max(4.5, 9 - 0.25 * run.n) * mul;
      if (!run.warned) { run.warned = true; banner('⚠ VOID COLLAPSE', 'Fly OUT of the red blinking area — it becomes a black hole: 75% hull per second inside'); }
    }
    for (const z of run.zones) {
      if (z.hole > 0) {
        z.hole -= dt; z.phase += dt * 3;
        if (a && !a.dead && (a.invuln || 0) <= 0 && Math.hypot(a.x - z.x, a.y - z.y) <= z.r) {
          a.hp -= (rt.stats.maxHp || 100) * 0.75 * dt; a.hurtFlash = 1;
          if (!z.warned) { z.warned = true; rt.shake = Math.min(6, (rt.shake || 0) + 2); }
          if (a.hp <= 0) { a.hp = 0; a.dead = true; a.justDied = true; a.killer = b; }
        }
        continue;
      }
      const frac = Math.max(0, z.t / z.total);
      z.phase += dt * (2 + (1 - frac) * 12);
      z.t -= dt;
      if (z.t <= 0) { z.hole = 5.0; rt.shake = Math.min(7, (rt.shake || 0) + 3); }
    }
    run.zones = run.zones.filter((z) => z.t > 0 || z.hole > 0);
    run.uiT -= dt;
    if (run.uiT <= 0) { run.uiT = 0.2; syncWarbar(); }
    if (run.left <= 0) end('time');
  }

  // engine draw hook — zones + teal siege aura (camera re-applied: hits test in world space)
  function engineRender(ctx, t, rt) {
    const b = rt.boss; if (!b || !b.isAlArmada || !run) return;
    ctx.save();
    ctx.scale(rt.zoom || 1, rt.zoom || 1);
    ctx.translate(-rt.cam.x, -rt.cam.y);
    (run.zones || []).forEach((z) => {
      ctx.save();
      if (z.hole > 0) {
        const fade = Math.min(1, z.hole / 0.6);
        const g = ctx.createRadialGradient(z.x, z.y, 2, z.x, z.y, z.r);
        g.addColorStop(0, 'rgba(0,0,0,' + (0.96 * fade).toFixed(2) + ')');
        g.addColorStop(0.62, 'rgba(4,16,16,' + (0.85 * fade).toFixed(2) + ')');
        g.addColorStop(0.86, 'rgba(30,160,140,' + (0.35 * fade).toFixed(2) + ')');
        g.addColorStop(1, 'rgba(46,230,201,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, 7); ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(140,255,235,' + (0.8 * fade).toFixed(2) + ')';
        ctx.shadowColor = '#2ee6c9'; ctx.shadowBlur = 18;
        for (let i = 0; i < 3; i++) {
          const a0 = z.phase * 2 + i * 2.1;
          ctx.beginPath(); ctx.arc(z.x, z.y, z.r * (0.55 + i * 0.16), a0, a0 + 1.5); ctx.stroke();
        }
        ctx.restore(); return;
      }
      const frac = Math.max(0, z.t / z.total);
      const blink = 0.5 + 0.5 * Math.sin(z.phase * Math.PI * 2);
      ctx.fillStyle = 'rgba(255,42,58,' + (0.08 + 0.24 * blink * (1.3 - frac * 0.6)).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, 7); ctx.fill();
      ctx.lineWidth = 2 + 2.5 * blink;
      ctx.strokeStyle = 'rgba(255,90,104,' + (0.45 + 0.55 * blink).toFixed(2) + ')';
      ctx.setLineDash([12, 9]); ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,225,225,' + (0.55 + 0.45 * blink).toFixed(2) + ')';
      ctx.font = '800 ' + Math.round(z.r * 0.3) + 'px Orbitron, Rajdhani, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('⚠', z.x, z.y);
      ctx.restore();
    });
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const R = b.size * 2.2;
    const g = ctx.createRadialGradient(b.x, b.y, b.size * 0.55, b.x, b.y, R);
    g.addColorStop(0, 'rgba(46,230,201,0)');
    g.addColorStop(0.7, 'rgba(46,230,201,' + (0.05 + 0.09 * pulse).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(46,230,201,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, R, 0, 7); ctx.fill();
    const wn = Math.min(4, 1 + Math.floor(run.n / 5));
    for (let i = 0; i < wn; i++) {
      const a = t * 0.7 + (i / wn) * Math.PI * 2;
      const wx = b.x + Math.cos(a) * b.size * 0.52, wy = b.y + Math.sin(a) * b.size * 0.38;
      ctx.fillStyle = 'rgba(127,242,224,' + (0.55 + 0.35 * pulse).toFixed(2) + ')';
      ctx.shadowColor = '#2ee6c9'; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(wx, wy, Math.max(2.5, 4.5 + 2 * Math.sin(t * 4 + i)), 0, 7); ctx.fill();
    }
    ctx.restore();
    ctx.restore();
  }

  // engine death path — the engine already towed us home; partial damage still transmits
  function onDeath() { if (run) { run.died = true; end('destroyed', true); } }

  function end(reason, engineHandled) {
    if (!run) return;
    const r = run; run = null;
    const killed = r.kills > 0;
    const dmg = Math.max(1, Math.floor(r.dealt));
    // a KILL is a full-credit run for the pocket reward no matter how fast it
    // landed — one-shotting an early mark must not pay zero
    const frac = killed ? 1 : clamp((T - Math.max(0, r.left)) / T, 0, 1);
    const app = $('app'); if (app) app.classList.remove('sd-noauto');
    try { G().setAuto(!!r.prevAuto); } catch (e) {}
    try { if (r.prevSpeed && r.prevSpeed !== 1) G().setGameSpeed(r.prevSpeed); } catch (e) {}
    try { G().refreshStats(); } catch (e) {}       // drop the 3× event fire range
    try { if (window.UI) window.UI.refreshAll(); } catch (e) {}
    if (!engineHandled) {
      try {
        const rt = G().rt;
        rt.alrun = null;
        if (r.boss) { rt.enemies = rt.enemies.filter((e) => e !== r.boss); if (rt.boss === r.boss) { rt.boss = null; rt.bossAlive = false; rt.superBossAlive = false; } }
      } catch (e) {}
      try { G().selectDungeon(0); } catch (e) {}
    }
    removeWarbar();
    // tow to the safe hangar — unless another event now owns the arena
    let foreign = false;
    try { const grt = G().rt; foreign = !!(grt && ((grt.sdrun && grt.sdrun.active) || (grt.hcrun && grt.hcrun.active))); } catch (e) {}
    if (!foreign) { try { if (G().goSafeHangar) G().goSafeHangar(); } catch (e) {} }
    banner(killed ? '☠ ARMADA Mk-' + r.n + ' DESTROYED' : r.died ? '✝ FLEET LOST — partial damage logged' : '⌛ RAID WINDOW CLOSED',
      '⚔ ' + fmt(dmg) + ' damage transmitting to the alliance' +
      (killed ? ' — <b>Mk-' + r.n + ' is down</b>. Next mark is ×4 harder.' : ' · ' + fmt(Math.max(0, r.poolHp - r.dealt)) + ' hull still standing') +
      (r.bonus ? ' · ⬡ +' + Math.round(r.bonus * 100) + '% Monolith siege bonus' : ''));
    if (r.onDone && !r.submitted) { r.submitted = true; setTimeout(() => { try { r.onDone({ dmg, frac, bonus: r.bonus, died: r.died, killed, kills: r.kills }); } catch (e) {} }, 600); }
  }

  // watchdog — run cancelled externally (warp / redeploy) → settle as abandoned
  setInterval(() => {
    try {
      if (run && G() && G().rt && !(G().rt.alrun && G().rt.alrun.active) && !G().rt.archer.dead) end('abandoned', true);
    } catch (e) {}
  }, 1000);

  // ---- in-battle HUD strip (lives in the arena's #top-stack) --------------
  function warbar() {
    removeWarbar();
    const host = $('top-stack'); if (!host) return;
    const w = document.createElement('div'); w.id = 'al-warbar';
    w.innerHTML = '<span class="awb-tag" id="awb-tag">⬡ Mk-' + run.n + '</span>' +
      '<span class="awb-timer" id="awb-timer">2:30</span>' +
      '<span class="awb-dmg" id="awb-dmg">⚔ <b>0</b></span>' +
      '<span class="awb-bar"><i id="awb-fill" style="width:100%"></i></span>' +
      '<button id="awb-flee">✕</button>';
    host.appendChild(w);
    const f = $('awb-flee'); if (f) f.addEventListener('click', () => end('abandoned'));
  }
  function removeWarbar() { const w = $('al-warbar'); if (w) w.remove(); }
  function syncWarbar() {
    if (!run) return;
    const t = Math.max(0, run.left), m = Math.floor(t / 60), s = Math.floor(t % 60);
    const tg = $('awb-tag'); if (tg) tg.textContent = '⬡ Mk-' + run.n;
    const tm = $('awb-timer'); if (tm) { tm.textContent = m + ':' + String(s).padStart(2, '0'); tm.classList.toggle('enr', run.enraged); }
    const d = $('awb-dmg'); if (d) d.innerHTML = '⚔ <b>' + fmt(run.dealt) + '</b><i>/' + fmt(run.poolHp) + '</i>' + (run.bonus ? ' <em>+' + Math.round(run.bonus * 100) + '%</em>' : '');
    const f = $('awb-fill'); if (f) f.style.width = clamp((1 - run.dealt / run.poolHp) * 100, 0, 100) + '%';
  }

  const CSS = `
  #al-warbar{ display:flex; align-items:center; gap:8px; margin-top:6px; padding:6px 10px; border-radius:11px;
    background:rgba(8,26,24,.88); border:1px solid #1e5a50; box-shadow:0 0 18px -6px #2ee6c9; backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px); }
  #al-warbar .awb-tag{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:8.5px; letter-spacing:.1em; color:#04110e; background:linear-gradient(90deg,#2ee6c9,#1a9e8a); border-radius:4px; padding:2px 6px; white-space:nowrap; }
  #al-warbar .awb-timer{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:14px; color:#fff; text-shadow:0 0 10px #2ee6c9; font-variant-numeric:tabular-nums; }
  #al-warbar .awb-timer.enr{ color:#ff5a68; text-shadow:0 0 10px #ff5a68; animation:awbPulse .5s infinite alternate; }
  @keyframes awbPulse{ from{ opacity:1 } to{ opacity:.5 } }
  #al-warbar .awb-dmg{ font-family:'Rajdhani',sans-serif; font-weight:700; font-size:11px; color:#8fc4ba; white-space:nowrap; }
  #al-warbar .awb-dmg b{ color:#d8fff6; font-variant-numeric:tabular-nums; }
  #al-warbar .awb-dmg em{ font-style:normal; color:#7ff2e0; }
  #al-warbar .awb-dmg i{ font-style:normal; color:#6d9a92; font-variant-numeric:tabular-nums; }
  #al-warbar .awb-bar{ flex:1; height:6px; border-radius:4px; background:#0e211e; overflow:hidden; min-width:40px; }
  #al-warbar .awb-bar i{ display:block; height:100%; background:linear-gradient(90deg,#ff5a68,#b02040); box-shadow:0 0 8px #ff5a68; transition:width .2s linear; }
  #al-warbar #awb-flee{ pointer-events:auto; background:none; border:1px solid #2a4a44; color:#8fc4ba; border-radius:7px; font-family:'Rajdhani',sans-serif; font-weight:700; font-size:11px; padding:2px 8px; cursor:pointer; }
  #al-banner{ position:fixed; left:50%; top:16%; transform:translateX(-50%); z-index:95; text-align:center; pointer-events:none;
    background:rgba(6,16,14,.9); border:1px solid #1e5a50; border-radius:12px; padding:10px 16px; max-width:min(480px,92vw); transition:opacity .6s; }
  #al-banner b{ display:block; font-family:'Orbitron',sans-serif; font-size:13px; font-weight:800; letter-spacing:.1em; color:#7ff2e0; text-shadow:0 0 12px rgba(46,230,201,.5); }
  #al-banner span{ display:block; font-family:'Rajdhani',sans-serif; font-size:12px; font-weight:700; color:#9fb1c4; margin-top:3px; line-height:1.45; }
  #al-banner.off{ opacity:0; }
  `;
  const stl = document.createElement('style'); stl.textContent = CSS; document.head.appendChild(stl);
  window.ALBOSS = { start, engineTick, engineRender, onDeath };
})();
