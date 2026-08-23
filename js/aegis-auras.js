/* =============================================================================
   aegis-auras.js — LOOTFLEET · AEGIS FIELD PROJECTORS
   -----------------------------------------------------------------------------
   Four large-radius aura arrays that mount ONLY on the Aegis, the fleet-support
   hull. The Aegis already hosts the Warden Array (a fleet heal/buff aura); these
   are the offensive and battlefield-control half of the same idea.

       ☣ VENOM LATTICE    purple haze  · hostiles inside take MORE damage
       ❄ CRYO FIELD       ice          · hostiles inside are SLOWED
       ➤ BANNER ARRAY     amber        · YOUR fleet deals more damage (scores)
       ☠ PLAGUE EMITTER   green        · hostiles slowed AND taking damage/sec

   ---------------------------------------------------------------------------
   FRAME TIME IS THE DESIGN CONSTRAINT, NOT AN AFTERTHOUGHT.
   An always-on area effect is the easiest way to wreck a frame budget: it wants
   a per-enemy distance test every frame and a big translucent gradient painted
   under the ship. Both are avoided outright.

     · THE SCAN IS THROTTLED, NOT PER-FRAME. Debuffs are stamped onto entities at
       AURA_HZ (8/sec) and carry an expiry, so the sim reads a flag rather than
       re-measure distance. Between stamps nothing is computed at all.
     · IT IS A SQUARED-DISTANCE TEST with an early box reject — no Math.hypot,
       no sqrt, in the only loop that touches every hostile.
     · THE VISUAL IS ONE PRE-RENDERED SPRITE PER (type, radius), built once and
       blitted. No createRadialGradient per frame, no shadowBlur — the two things
       that actually cost money on a 2D context. See the ring/void sprites in
       cargo-run.js for the same pattern.
     · IT OBEYS THE GRAPHICS TIER. At LOD 2 (Low, or a device the governor has
       given up on) the ring is drawn as a thin stroke instead of a filled disc,
       and the drifting motes are dropped entirely. THE GAMEPLAY EFFECT NEVER
       CHANGES — shedding paint must never shed the simulation.

   ---------------------------------------------------------------------------
   window.AEGIS
     mods()                    fleet-wide multipliers for stat compute
     tick(dt, rt)              stamp debuffs (throttled internally)
     render(ctx, t, rt)        world-space paint, under everything else
     vulnOf(e) / slowOf(e)     read by the damage and movement paths
   ========================================================================== */
(function () {
  'use strict';
  const G = () => window.GAME;

  // ---- THE FOUR ARRAYS ------------------------------------------------------
  // `r` is the rarity index of the equipped item; every magnitude scales off it
  // so a Paragon projector is worth chasing. Radii are deliberately LARGE — this
  // is a support hull's whole contribution, and a field you have to nose onto a
  // target is not a field.
  const AURAS = {
    venom: {
      key: 'venom', name: 'Venom Lattice', glyph: '☣', color: '#b45cff', ring: '#d79aff',
      blurb: 'A hanging violet haze. Everything hostile inside it takes more damage from every source.',
      radius: (r) => 560 + r * 26,                       // 560 → ~1000 at Paragon
      vuln:   (r) => Math.min(60, 10 + r * 2.4),         // +% damage taken
    },
    cryo: {
      key: 'cryo', name: 'Cryo Field', glyph: '❄', color: '#5fd1ff', ring: '#bfe9ff',
      blurb: 'A lattice of supercooled particles. Hostile drives seize inside it.',
      radius: (r) => 520 + r * 24,
      slow:   (r) => Math.min(65, 14 + r * 2.6),         // -% move speed
    },
    banner: {
      key: 'banner', name: 'Banner Array', glyph: '➤', color: '#ffb03a', ring: '#ffd894',
      blurb: 'A command resonance your wing fights inside. Every hull you own hits harder — and it counts toward Fleet Score.',
      radius: (r) => 600 + r * 28,
      fleet:  (r) => Math.min(70, 8 + r * 2.2),          // +% fleet damage
    },
    plague: {
      key: 'plague', name: 'Plague Emitter', glyph: '☠', color: '#7ce06a', ring: '#c8ff9a',
      blurb: 'A creeping bio-corrosive bloom. Hostiles inside slow down and rot where they float.',
      radius: (r) => 500 + r * 22,
      slow:   (r) => Math.min(40, 8 + r * 1.6),
      dps:    (r) => 0.012 + r * 0.004,                  // fraction of YOUR attackDamage, per second
    },
  };
  const KEYS = Object.keys(AURAS);

  // ---- WHAT IS EQUIPPED -----------------------------------------------------
  // Aegis only, and only from a hardpoint. Cached per stat-refresh rather than
  // rebuilt per frame; refresh() is called by the same paths that recompute stats.
  let _live = [];       // [{ def, r, radius, radius2 }]
  let _sig = '';
  function aegisFlying() {
    try { return (G().state.ship || '') === 'aegis'; } catch (e) { return false; }
  }
  function refresh() {
    _live = [];
    try {
      const s = G().state, eq = s.equipped || {};
      if (!aegisFlying()) { _sig = 'none'; return; }
      for (const slot in eq) {
        const it = eq[slot]; if (!it) continue;
        const k = it.auraClass || (it.wclass && AURAS[it.wclass] ? it.wclass : null);
        const def = k && AURAS[k]; if (!def) continue;
        const r = Math.max(0, Math.min(16, Math.floor(Number(it.rarity) || 0)));
        const radius = def.radius(r);
        _live.push({ def, r, radius, radius2: radius * radius });
      }
    } catch (e) { _live = []; }
    _sig = _live.map((a) => a.def.key + a.r).join('|');
  }

  // ---- FLEET-WIDE MULTIPLIERS ----------------------------------------------
  // Read by refreshStats(). The Banner Array is the only one that touches the
  // PLAYER's numbers, which is why it is the one that shows up in Fleet Score:
  // score is computed from the stat block, so anything folded in here is counted
  // exactly once, by the same arithmetic every other bonus goes through.
  function mods() {
    let fleet = 0;
    for (const a of _live) if (a.def.fleet) fleet += a.def.fleet(a.r);
    return { fleetDmgPct: Math.min(70, fleet) };
  }

  // ---- THE DEBUFF STAMP -----------------------------------------------------
  // Runs at AURA_HZ, not per frame. Each pass writes `_auraVuln` / `_auraSlow`
  // and an expiry onto hostiles in range; the damage and movement paths read
  // those flags and never measure a distance themselves.
  const AURA_HZ = 8;
  const STAMP_MS = 1000 / AURA_HZ * 2.2;   // outlives the next stamp, so no flicker
  let _acc = 0;
  function tick(dt, rt) {
    if (!_live.length || !rt || !rt.archer) return;
    _acc += dt;
    const step = 1 / AURA_HZ;
    if (_acc < step) return;
    const elapsed = _acc; _acc = 0;
    const a = rt.archer, ax = a.x, ay = a.y;
    // widest radius first — one box reject covers every aura
    let maxR = 0;
    for (const au of _live) if (au.radius > maxR) maxR = au.radius;
    const now = (rt.time || 0) * 1000;
    const list = rt.enemies || [];
    let dmgPool = 0;
    for (const au of _live) if (au.def.dps) dmgPool += au.def.dps(au.r);
    const tickDmg = dmgPool > 0 ? (rt.stats ? rt.stats.attackDamage || 0 : 0) * dmgPool * elapsed : 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e || e.dead || e.dying) continue;
      const dx = e.x - ax, dy = e.y - ay;
      if (dx > maxR || dx < -maxR || dy > maxR || dy < -maxR) continue;   // box reject, no sqrt
      const d2 = dx * dx + dy * dy;
      if (d2 > maxR * maxR) continue;
      let vuln = 0, slow = 0, rot = 0;
      for (const au of _live) {
        if (d2 > au.radius2) continue;
        if (au.def.vuln) vuln += au.def.vuln(au.r);
        if (au.def.slow) slow += au.def.slow(au.r);
        if (au.def.dps) rot = 1;
      }
      if (vuln) { e._auraVuln = vuln; e._auraVulnT = now + STAMP_MS; }
      if (slow) { e._auraSlow = Math.min(80, slow); e._auraSlowT = now + STAMP_MS; }
      if (rot && tickDmg > 0) {
        // Damage is applied HERE, on the throttled pass, not per frame — the
        // amount already accounts for the elapsed time so the DPS is honest at
        // any frame rate or battle speed.
        try {
          if (e.takeDamage) { const k = e.takeDamage(tickDmg); if (k && G().onAuraKill) G().onAuraKill(e); }
          else { e.hp -= tickDmg; if (e.hp <= 0) { e.hp = 0; e.dead = true; e.justDied = true; } }
        } catch (x) {}
      }
    }
  }
  // Read side. Both check the expiry so a hostile that left the field stops
  // being debuffed without anything having to clear the flag.
  function vulnOf(e) {
    if (!e || !e._auraVuln) return 0;
    const now = (G().rt.time || 0) * 1000;
    return e._auraVulnT > now ? e._auraVuln : 0;
  }
  function slowOf(e) {
    if (!e || !e._auraSlow) return 0;
    const now = (G().rt.time || 0) * 1000;
    return e._auraSlowT > now ? e._auraSlow : 0;
  }

  // ---- THE PAINT ------------------------------------------------------------
  // One offscreen disc per (type, radius bucket), built once. Blitting a cached
  // bitmap is the whole point: createRadialGradient on a 1,000px field, every
  // frame, is what an aura normally costs and it is not affordable.
  const _sprites = {};
  function discFor(def, radius) {
    const bucket = Math.round(radius / 40) * 40;
    const key = def.key + ':' + bucket;
    if (_sprites[key] !== undefined) return _sprites[key];
    try {
      const s = bucket * 2;
      const cv = document.createElement('canvas');
      cv.width = s; cv.height = s;
      const c = cv.getContext('2d');
      const g = c.createRadialGradient(bucket, bucket, bucket * 0.12, bucket, bucket, bucket);
      const col = def.color;
      g.addColorStop(0, hexA(col, 0.20));
      g.addColorStop(0.55, hexA(col, 0.10));
      g.addColorStop(0.86, hexA(col, 0.05));
      g.addColorStop(1, hexA(col, 0));
      c.fillStyle = g;
      c.beginPath(); c.arc(bucket, bucket, bucket, 0, 7); c.fill();
      // a soft rim so the edge of the field is legible without a stroke per frame
      c.strokeStyle = hexA(def.ring, 0.30); c.lineWidth = 2;
      c.beginPath(); c.arc(bucket, bucket, bucket - 2, 0, 7); c.stroke();
      return (_sprites[key] = cv);
    } catch (e) { return (_sprites[key] = null); }
  }
  function hexA(hex, a) {
    const h = String(hex).replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function render(ctx, t, rt) {
    if (!_live.length || !rt || !rt.archer) return;
    const lod = rt.lod | 0;
    const a = rt.archer;
    ctx.save();
    for (let i = 0; i < _live.length; i++) {
      const au = _live[i], def = au.def;
      // Breathing is a CHEAP animation: one sin per aura per frame driving alpha,
      // rather than anything that rebuilds geometry.
      const pulse = 0.86 + 0.14 * Math.sin(t * 1.1 + i * 1.7);
      if (lod >= 2) {
        // SURVIVAL TIER — a single stroked ring. The field still reads; it just
        // costs one path instead of a full-screen translucent blit.
        ctx.globalAlpha = 0.5 * pulse;
        ctx.strokeStyle = def.ring; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(a.x, a.y, au.radius, 0, 7); ctx.stroke();
        continue;
      }
      const disc = discFor(def, au.radius);
      if (!disc) continue;
      const s = disc.width;
      ctx.globalAlpha = pulse;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(disc, a.x - s / 2, a.y - s / 2, s, s);
      ctx.globalCompositeOperation = 'source-over';
      // A few drifting motes on the rim, full detail only. Count is fixed and
      // tiny — they are drawn as 1px arcs, never particles pushed into rt.
      if (lod === 0) {
        ctx.globalAlpha = 0.5 * pulse;
        ctx.fillStyle = def.ring;
        for (let m = 0; m < 6; m++) {
          const ang = t * (0.18 + i * 0.05) + m * 1.047;
          const rr = au.radius * (0.72 + 0.22 * Math.sin(t * 0.7 + m * 2.1));
          ctx.beginPath();
          ctx.arc(a.x + Math.cos(ang) * rr, a.y + Math.sin(ang) * rr, 2.2, 0, 7);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  window.AEGIS = {
    AURAS, KEYS, refresh, mods, tick, render, vulnOf, slowOf,
    live: () => _live.slice(),
    active: () => _live.length > 0,
    // The list the Aegis panel prints. One statement of what each array does, so
    // the item tooltip and the hull screen cannot describe them differently.
    describe: (k, r) => {
      const d = AURAS[k]; if (!d) return null;
      const rr = Math.max(0, Math.min(16, r | 0));
      const parts = [];
      if (d.vuln) parts.push('+' + Math.round(d.vuln(rr)) + '% damage taken by hostiles');
      if (d.slow) parts.push('\u2212' + Math.round(d.slow(rr)) + '% hostile speed');
      if (d.dps) parts.push(Math.round(d.dps(rr) * 1000) / 10 + '% of your damage per second');
      if (d.fleet) parts.push('+' + Math.round(d.fleet(rr)) + '% fleet damage');
      return { name: d.name, glyph: d.glyph, color: d.color, blurb: d.blurb,
               radius: Math.round(d.radius(rr)), effects: parts };
    },
  };
})();
