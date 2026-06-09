/* =============================================================================
   galaxy.js — Loot Fleet · GALAXY (6 regions × 10 tiles = 60 conquerable tiles)
   A fixed, hand-structured galaxy. Six named regions each hold ten tiles; every
   region has a level range and you may enter ANY region regardless of level
   (deeper regions are deadlier but far richer). Tile type/resource/name are
   deterministic per (region,tile) via a seeded RNG so the map is identical
   across sessions. Ownership, cooldowns and bonuses are tracked in game state;
   this module is pure data + math. Exposes window.GALAXYMAP.
   ============================================================================= */
(function () {
  'use strict';

  // ---- resources -----------------------------------------------------------
  const RES = {
    fuel:   { key: 'fuel',   name: 'Fuel',   color: '#5bc0ff', glyph: '⬢' },
    iron:   { key: 'iron',   name: 'Iron',   color: '#d0a060', glyph: '◆' },
    plasma: { key: 'plasma', name: 'Plasma', color: '#c07bff', glyph: '✦' },
  };
  const RES_KEYS = ['fuel', 'iron', 'plasma'];

  // ---- the six regions -----------------------------------------------------
  // deepMult applies to deep-space regions: 20× density, 3× spawn rate,
  // 10× loot quality, 25× resource yield (spec).
  const DEEP_MULT = { density: 20, rate: 3, loot: 10, resource: 25 };
  const REGIONS = [
    { idx: 0, key: 'frontier',  name: 'Frontier Space',   levelMin: 1,  levelMax: 15,  deep: false, color: '#5bc06b', blurb: 'Starter region · low-risk · basic loot & resources' },
    { idx: 1, key: 'outerrim',  name: 'Outer Rim',        levelMin: 15, levelMax: 30,  deep: false, color: '#4a90e2', blurb: 'Denser enemies · better loot tables · early conflicts' },
    { idx: 2, key: 'midcore',   name: 'Mid Core',         levelMin: 30, levelMax: 50,  deep: false, color: '#b15cff', blurb: 'Advanced farming · rare loot common · stronger bosses' },
    { idx: 3, key: 'core',      name: 'Core Systems',     levelMin: 50, levelMax: 70,  deep: false, color: '#f0972a', blurb: 'High-value territory · elite enemies · more resources' },
    { idx: 4, key: 'deepalpha', name: 'Deep Space Alpha', levelMin: 70, levelMax: 85,  deep: true,  color: '#ff3b4e', blurb: 'Deep space · lose 2 items on death · 10× loot · 25× resources' },
    { idx: 5, key: 'deepomega', name: 'Deep Space Omega', levelMin: 85, levelMax: 100, deep: true,  color: '#ff6ad5', blurb: 'The deepest, richest space · the endgame · best loot in the game' },
  ];
  const TILES_PER_REGION = 10;
  const BOSS_TILES = [4, 9]; // two dedicated Boss Tiles per region

  // ---- seeded RNG (mulberry32) ---------------------------------------------
  function rngFor(seed) {
    let a = seed >>> 0;
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // ---- name generator ------------------------------------------------------
  const PRE = ['Vel', 'Kor', 'Zar', 'Tyr', 'Aql', 'Nyx', 'Pyr', 'Sol', 'Dra', 'Cir', 'Vex', 'Hal', 'Oss', 'Rho', 'Vyn', 'Tau', 'Mor', 'Cyg', 'Lyr', 'Ark'];
  const MID = ['a', 'e', 'i', 'o', 'an', 'or', 'en', 'is', 'ux', 'ar'];
  const SUF = ['Prime', 'Reach', 'Expanse', 'Gate', 'Verge', 'Drift', 'Hollow', 'Spire', 'Nexus', 'Crown', 'Deep', 'Rift', 'Vault', 'Forge', 'Cradle', 'Sprawl'];
  const GREEK = ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ'];
  function genName(rnd) {
    const a = PRE[(rnd() * PRE.length) | 0];
    const b = MID[(rnd() * MID.length) | 0];
    const c = SUF[(rnd() * SUF.length) | 0];
    const g = GREEK[(rnd() * GREEK.length) | 0];
    const num = 1 + ((rnd() * 9) | 0);
    return rnd() < 0.5 ? `${a}${b} ${c}` : `${a}${b} ${g}-${num}`;
  }

  // ---- tile id helpers -----------------------------------------------------
  function tileId(region, index) { return 'r' + region + '-t' + index; }
  function parseId(id) { const m = /^r(\d+)-t(\d+)$/.exec(id); return m ? { region: +m[1], index: +m[2] } : null; }
  const HOME = tileId(0, 0); // starter foothold

  // Per-tile resource yield (per hour), before deep-space / full-region bonuses.
  function tileRate(region, resKey) {
    const base = 10 + region * 7;
    const mult = resKey === 'fuel' ? 1 : resKey === 'iron' ? 0.85 : 0.7;
    return Math.max(3, Math.round(base * mult));
  }

  // ---- deterministic tile ---------------------------------------------------
  const _cache = {};
  function tileAt(id) {
    if (_cache[id]) return _cache[id];
    const p = parseId(id);
    if (!p || p.region < 0 || p.region >= REGIONS.length || p.index < 0 || p.index >= TILES_PER_REGION) return null;
    const R = REGIONS[p.region];
    const rnd = rngFor((p.region + 1) * 92821 + (p.index + 1) * 53 + 7);
    const boss = BOSS_TILES.indexOf(p.index) >= 0;
    let type, resource = null;
    if (boss) { type = 'boss'; }
    else if (rnd() < 0.45) {
      type = 'resource';
      const pool = ['fuel'];
      if (p.region >= 1) pool.push('iron');
      if (p.region >= 3) pool.push('plasma', 'plasma');
      if (p.region >= 5) pool.push('iron');
      resource = pool[(rnd() * pool.length) | 0];
    } else { type = 'combat'; }
    // difficulty (combat zone level) scales across the region's level range
    const diff = Math.max(1, Math.round(R.levelMin + (R.levelMax - R.levelMin) * (p.index / (TILES_PER_REGION - 1))));
    const sys = {
      id, region: p.region, index: p.index, type, boss, resource,
      diff, name: genName(rnd),
      rate: resource ? tileRate(p.region, resource) : (boss ? tileRate(p.region, 'fuel') : 0),
    };
    _cache[id] = sys;
    return sys;
  }

  function regionTiles(region) {
    const out = [];
    for (let i = 0; i < TILES_PER_REGION; i++) out.push(tileAt(tileId(region, i)));
    return out;
  }
  function allTiles() {
    const out = [];
    for (let r = 0; r < REGIONS.length; r++) out.push.apply(out, regionTiles(r));
    return out;
  }

  window.GALAXYMAP = {
    RES, RES_KEYS, REGIONS, TILES_PER_REGION, BOSS_TILES, DEEP_MULT, HOME,
    tileId, parseId, tileAt, regionTiles, allTiles,
  };
})();
