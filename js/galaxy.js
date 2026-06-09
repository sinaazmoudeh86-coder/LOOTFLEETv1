/* =============================================================================
   galaxy.js — GrabAGun Idle Operator · GALAXY HEX MAP
   Pure data + math for the spatial system map that fronts the combat engine.
   A deterministic, effectively-infinite hex galaxy: every axial coordinate
   resolves to a stable system (type, resource, difficulty, name) via a seeded
   RNG, so the map is identical across sessions and reveals as you expand.
   Exposes window.GALAXYMAP.
   ============================================================================= */
(function () {
  'use strict';

  // ---- axial hex helpers (pointy-top) --------------------------------------
  const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  function key(q, r) { return q + ',' + r; }
  function parse(k) { const a = k.split(','); return { q: +a[0], r: +a[1] }; }
  function neighbors(q, r) { return DIRS.map((d) => ({ q: q + d[0], r: r + d[1] })); }
  function ring(q, r) { return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2; }
  // pixel position for a hex of radius `size`
  function pixel(q, r, size) {
    return { x: size * Math.sqrt(3) * (q + r / 2), y: size * 1.5 * r };
  }

  // ---- seeded RNG (mulberry32) ---------------------------------------------
  function hash(q, r) {
    let h = (q * 374761393 + r * 668265263) >>> 0;
    h = (h ^ (h >>> 13)) * 1274126177 >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }
  function rngFor(q, r) {
    let a = hash(q, r);
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // ---- resources -----------------------------------------------------------
  // fuel: needed for every warp. iron: needed from ring 3+. plasma: ring 5+.
  const RES = {
    fuel:   { key: 'fuel',   name: 'Fuel',   color: '#5bc0ff', glyph: '⬢' },
    iron:   { key: 'iron',   name: 'Iron',   color: '#d0a060', glyph: '◆' },
    plasma: { key: 'plasma', name: 'Plasma', color: '#c07bff', glyph: '✦' },
  };
  const RES_KEYS = ['fuel', 'iron', 'plasma'];

  // ---- name generator ------------------------------------------------------
  const PRE = ['Vel', 'Kor', 'Zar', 'Tyr', 'Aql', 'Nyx', 'Pyr', 'Sol', 'Dra', 'Cir', 'Vex', 'Hal', 'Oss', 'Rho', 'Vyn', 'Tau', 'Mor', 'Cyg', 'Lyr', 'Ark'];
  const MID = ['a', 'e', 'i', 'o', 'an', 'or', 'en', 'is', 'ux', 'ar'];
  const SUF = ['Prime', 'Reach', 'Expanse', 'Gate', 'Verge', 'Drift', 'Hollow', 'Spire', 'Nexus', 'Crown', 'Deep', 'Rift', 'Vault', 'Forge', 'Cradle', 'Sprawl'];
  const GREEK = ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ'];
  function genName(rnd, ringN) {
    const a = PRE[(rnd() * PRE.length) | 0];
    const b = MID[(rnd() * MID.length) | 0];
    const c = SUF[(rnd() * SUF.length) | 0];
    const g = GREEK[(rnd() * GREEK.length) | 0];
    const num = 1 + ((rnd() * 9) | 0);
    return rnd() < 0.5 ? `${a}${b} ${c}` : `${a}${b} ${g}-${num}`;
  }

  // ---- difficulty / warp economy -------------------------------------------
  // Under-the-hood combat difficulty (feeds the existing zone scaling).
  function diffFor(ringN, rnd) {
    const base = Math.round(ringN * 4 + (rnd() * 3 - 1));
    return Math.max(1, base);
  }
  // Fuel/iron/plasma cost to warp to a system at the given ring.
  function warpCost(ringN) {
    return {
      fuel: Math.round(15 * Math.pow(1.5, ringN - 1)),
      iron: ringN >= 3 ? Math.round(6 * Math.pow(1.4, ringN - 3)) : 0,
      plasma: ringN >= 5 ? Math.round(5 * Math.pow(1.4, ringN - 5)) : 0,
    };
  }
  // Per-hour yield of an owned resource system.
  function rateFor(ringN, resKey) {
    const base = 8 + ringN * 5;
    const mult = resKey === 'fuel' ? 1 : resKey === 'iron' ? 0.85 : 0.65;
    return Math.max(2, Math.round(base * mult));
  }

  // ---- the system at an axial coordinate (deterministic) -------------------
  const _cache = {};
  function systemAt(q, r) {
    const k = key(q, r);
    if (_cache[k]) return _cache[k];
    const ringN = ring(q, r);
    let sys;
    if (q === 0 && r === 0) {
      sys = { key: k, q, r, ring: 0, type: 'home', resource: 'fuel', rate: 22, diff: 0, name: 'Home System' };
    } else {
      const rnd = rngFor(q, r);
      const typeRoll = rnd();
      let type, resource = null;
      if (ringN >= 3 && typeRoll < 0.05) type = 'boss';
      else if (typeRoll < 0.46) { type = 'resource'; }
      else type = 'combat';
      if (type === 'resource') {
        // resource kind weighted by ring: fuel everywhere, iron 2+, plasma 4+
        const pool = ['fuel'];
        if (ringN >= 2) pool.push('iron');
        if (ringN >= 4) pool.push('plasma', 'plasma');
        if (ringN >= 6) pool.push('iron');
        resource = pool[(rnd() * pool.length) | 0];
      }
      const diff = diffFor(ringN, rnd) + (type === 'boss' ? 4 : 0);
      sys = {
        key: k, q, r, ring: ringN, type, resource,
        rate: resource ? rateFor(ringN, resource) : 0,
        diff, name: genName(rnd, ringN),
      };
    }
    _cache[k] = sys;
    return sys;
  }

  window.GALAXYMAP = {
    DIRS, RES, RES_KEYS, key, parse, neighbors, ring, pixel,
    systemAt, warpCost, HOME: '0,0',
  };
})();
