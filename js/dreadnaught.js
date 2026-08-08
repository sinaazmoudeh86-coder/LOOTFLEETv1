/* =============================================================================
   dreadnaught.js — LOOTFLEET · Pilot Progression + Dreadnaught Hunt
   ---------------------------------------------------------------------------
   A permanent, account-wide progression system unlocked at Level 30.

     • DREADNAUGHT HUNT (Command) — a weekly raid: 30 escalating waves on the
       REAL battle engine, then a multi-phase Dreadnaught raid boss that drops
       the rare DREAD CORE currency.
     • PILOT TREE (Hangar ▸ Pilot) — an endless hexagonal talent network with
       fog of discovery. Spend Dread Cores to unlock nodes outward from the
       core. Every node permanently buffs EVERY ship you fly.

   Combat runs on the real engine. Tiny hooks in game-v93.js drive this:
     • computeStats(): window.DREAD.combatMods()        — fold pilot stat buffs
     • gainXp / onKill / lootQ / pickup: window.DREAD.mult(key) — utility buffs
     • resolveHit(): window.DREAD.dmgVs(e)              — boss/elite damage
     • update(): window.DREAD.tick(dt, rt)             — raid-boss phases
     • draw():   window.DREAD.render(ctx,t,rt)         — phase telegraphs
     • startDreadHunt(tier) deploys the gauntlet; updateWaveZone calls
       window.DREAD.onHuntCleared(tier) when the Dreadnaught falls.
   ============================================================================= */
(function () {
  'use strict';
  const G = () => window.GAME;
  const $ = (id) => document.getElementById(id);
  const UNLOCK_LEVEL = 30;
  const ACCENT = '#ff3a4a';

  // ---- small utils ----------------------------------------------------------
  function fmt(n) { try { return G().formatNum(Math.floor(n)); } catch (e) { return Math.floor(n) + ''; } }
  function lvl() { try { return (G().state.level | 0) || 1; } catch (e) { return 1; } }
  function cores() { try { return G().state.dreadCores | 0; } catch (e) { return 0; } }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function toast(m, c) { try { if (window.UI && window.UI.unlockToast) window.UI.unlockToast(m); } catch (e) {} }

  // =========================================================================
  // HEX SKILL TREE — deterministic, infinite, fog-of-discovery
  // =========================================================================
  const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  function axialDist(q, r) { return (Math.abs(q) + Math.abs(q + r) + Math.abs(r)) / 2; }
  function key(q, r) { return q + ',' + r; }
  function parseKey(k) { const p = k.split(','); return [parseInt(p[0], 10), parseInt(p[1], 10)]; }

  // hash (q,r) → uint32, then a seeded RNG for stable per-node properties
  function hash(q, r) {
    let h = ((q * 73856093) ^ (r * 19349663) ^ 0x9e3779b9) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }
  function rngFor(q, r) { let s = hash(q, r) || 1; return () => { s = Math.imul(s ^ (s >>> 15), 2246822519) >>> 0; s = (s + 0x6d2b79f5) >>> 0; return ((s >>> 8) & 0xffffff) / 0x1000000; }; }

  // bonus catalogs by category. key → which engine mod it feeds.
  const OFFENSE = [
    { key: 'dmgPct', label: 'Weapon Damage', unit: '%', lo: 3, hi: 6 },
    { key: 'atkSpeedPct', label: 'Fire Rate', unit: '%', lo: 2, hi: 4 },
    { key: 'critChance', label: 'Critical Chance', unit: '%', lo: 1.5, hi: 3 },
    { key: 'critDamage', label: 'Critical Damage', unit: '%', lo: 6, hi: 12 },
    { key: 'multiShot', label: 'Multi-Fire', unit: '%', lo: 1.5, hi: 3 },
    { key: 'bossDamage', label: 'Boss Damage', unit: '%', lo: 4, hi: 8 },
    { key: 'eliteDamage', label: 'Elite Damage', unit: '%', lo: 4, hi: 8 },
    { key: 'rangePct', label: 'Projectile Speed', unit: '%', lo: 4, hi: 8 },
  ];
  const DEFENSE = [
    { key: 'hpPct', label: 'Hull Strength', unit: '%', lo: 4, hi: 7 },
    { key: 'hpPct', label: 'Shield Capacity', unit: '%', lo: 4, hi: 7 },
    { key: 'regen', label: 'Shield Regen', unit: '%/s', lo: 0.4, hi: 1.0 },
    { key: 'dmgReduce', label: 'Armor', unit: '%', lo: 1.5, hi: 3 },
    { key: 'dmgReduce', label: 'Damage Reduction', unit: '%', lo: 1.5, hi: 3 },
    { key: 'lifeSteal', label: 'Life Steal', unit: '%', lo: 0.12, hi: 0.28 },
  ];
  const UTILITY = [
    { key: 'lootQuality', label: 'Loot Quality', unit: '%', lo: 4, hi: 8, util: true },
    { key: 'goldFind', label: 'Gold Find', unit: '%', lo: 5, hi: 10, util: true },
    { key: 'xpGain', label: 'XP Gain', unit: '%', lo: 4, hi: 8, util: true },
    { key: 'pickupRadius', label: 'Loot Pickup Radius', unit: '%', lo: 6, hi: 12, util: true },
  ];
  // rare / legendary nodes — strong combat combos + flavour; some carry a flag.
  const RARES = [
    { label: 'Twin-Link Array', bonus: { multiShot: 6, dmgPct: 6 }, special: null },
    { label: 'Apex Predator', bonus: { bossDamage: 16, eliteDamage: 16 }, special: null },
    { label: 'Core Resonance', bonus: { dmgPct: 8, critDamage: 18 }, special: 'coreLuck' },
    { label: 'Aegis Lattice', bonus: { hpPct: 14, dmgReduce: 6 }, special: null },
    { label: 'Vampiric Engine', bonus: { lifeSteal: 0.8, dmgPct: 6 }, special: null },
    { label: 'Treasure Sense', bonus: { lootQuality: 14 }, util: true, special: null },
    { label: 'Overclocked Reactor', bonus: { atkSpeedPct: 10, moveSpeed: 8 }, special: null },
    { label: 'Dread Harvester', bonus: { bossDamage: 12 }, special: 'coreLuck' },
  ];

  // ring-1 opening: a curated, balanced first choice in every direction
  const RING1 = [
    { cat: 'offense', i: 0 }, // dmg
    { cat: 'defense', i: 0 }, // hull
    { cat: 'offense', i: 2 }, // crit chance
    { cat: 'utility', i: 1 }, // gold
    { cat: 'defense', i: 5 }, // lifesteal
    { cat: 'offense', i: 1 }, // fire rate
  ];

  function nodeDef(q, r) {
    if (q === 0 && r === 0) {
      return { q, r, core: true, cat: 'core', label: 'Pilot Core', desc: 'The seat of your command. Expand outward.', cost: 0, score: 0, bonus: {} };
    }
    const ring = axialDist(q, r);
    const rnd = rngFor(q, r);
    let cat, pick, special = null, util = false;

    // legendary nodes appear only ring 3+, ~7%
    if (ring >= 3 && rnd() < 0.07) {
      cat = 'rare';
      const ra = RARES[(rnd() * RARES.length) | 0];
      const bonus = {}; for (const k in ra.bonus) bonus[k] = ra.bonus[k];
      special = ra.special; util = !!ra.util;
      const score = 60 + Math.round(ring * 6);
      return { q, r, cat, label: ra.label, bonus, util, special, cost: 3, score, rare: true, ring };
    }

    if (ring === 1) {
      const o = RING1[((q * 2 + r * 5) % 6 + 6) % 6];
      cat = o.cat; pick = (cat === 'offense' ? OFFENSE : cat === 'defense' ? DEFENSE : UTILITY)[o.i];
    } else {
      const roll = rnd();
      cat = roll < 0.40 ? 'offense' : roll < 0.70 ? 'defense' : 'utility';
      const pool = cat === 'offense' ? OFFENSE : cat === 'defense' ? DEFENSE : UTILITY;
      pick = pool[(rnd() * pool.length) | 0];
    }
    util = !!pick.util;
    // magnitude: rolled in range, gently scaled by ring depth (deeper = stronger)
    const depth = 1 + Math.min(0.8, (ring - 1) * 0.06);
    let mag = (pick.lo + rnd() * (pick.hi - pick.lo)) * depth;
    mag = pick.unit === '%/s' ? Math.round(mag * 10) / 10 : Math.round(mag * 10) / 10;
    const bonus = {}; bonus[pick.key] = mag;
    const score = Math.round(mag * (pick.unit === '%/s' ? 14 : pick.key === 'critDamage' ? 1.1 : pick.key === 'pickupRadius' ? 1.2 : 2.2)) + 4;
    return { q, r, cat, label: pick.label, unit: pick.unit, bonus, util, special, cost: 1, score, ring };
  }

  // ---- tree state ----------------------------------------------------------
  function nodes() {
    const s = G() && G().state; if (!s) return {};
    // SELF-HEAL — pilot ascension (or a stale save) can leave state.pilot null;
    // without the origin seed the tree canvas drew ZERO tiles until a relog.
    if (!s.pilot) s.pilot = { nodes: { '0,0': 1 } };
    if (!s.pilot.nodes) s.pilot.nodes = { '0,0': 1 };
    if (!s.pilot.nodes['0,0']) s.pilot.nodes['0,0'] = 1;
    return s.pilot.nodes;
  }
  function isUnlocked(k) { return !!nodes()[k]; }
  function unlockedKeys() { return Object.keys(nodes()); }
  function neighbors(q, r) { return DIRS.map((d) => [q + d[0], r + d[1]]); }
  function isUnlockable(q, r) {
    if (isUnlocked(key(q, r))) return false;
    return neighbors(q, r).some(([nq, nr]) => isUnlocked(key(nq, nr)));
  }
  // fog: unlocked nodes + their direct neighbors are visible (discovered).
  function visibleSet() {
    const vis = {};
    unlockedKeys().forEach((k) => {
      const [q, r] = parseKey(k); vis[k] = true;
      neighbors(q, r).forEach(([nq, nr]) => { vis[key(nq, nr)] = true; });
    });
    return vis;
  }
  function canUnlock(q, r) { return lvl() >= UNLOCK_LEVEL && isUnlockable(q, r) && cores() >= nodeDef(q, r).cost; }
  function unlock(q, r) {
    if (!canUnlock(q, r)) return false;
    const def = nodeDef(q, r);
    G().state.dreadCores -= def.cost;
    nodes()[key(q, r)] = 1;
    _aggDirty = true;
    // Fold the new node's bonuses into live combat stats immediately — otherwise
    // the pilot buffs (and the Ship/Fleet Score) don't update until some other
    // event happens to recompute stats.
    try { G().refreshStats && G().refreshStats(); } catch (e) {}
    try { G().save(); } catch (e) {}
    if (window.UI) window.UI.refreshAll();
    return true;
  }

  // ---- bonus aggregation (cached; recomputed only when nodes change) -------
  let _aggDirty = true, _agg = null;
  function ensureAgg() {
    if (!_aggDirty && _agg) return _agg;
    const combat = {}; const util = {}; const special = {};
    unlockedKeys().forEach((k) => {
      const [q, r] = parseKey(k); const d = nodeDef(q, r);
      if (d.special) special[d.special] = (special[d.special] || 0) + 1;
      if (!d.bonus) return;
      const bucket = d.util ? util : combat;
      for (const bk in d.bonus) {
        // util rares may carry combat keys too; route by node-level util flag
        const u = d.util && (bk === 'lootQuality' || bk === 'goldFind' || bk === 'xpGain' || bk === 'pickupRadius');
        (u ? util : combat)[bk] = ((u ? util : combat)[bk] || 0) + d.bonus[bk];
      }
    });
    _agg = { combat, util, special }; _aggDirty = false; return _agg;
  }
  function combatMods() { return ensureAgg().combat; }
  function mult(k) { const v = ensureAgg().util[k] || 0; return 1 + v / 100; }
  function dmgVs(e) { const c = ensureAgg().combat; if (!e) return 1; let b = (c.bossDamage || 0); const elite = e.isSuper || e.isDread || e.isCitadel || e.isClone; if (elite) b += (c.eliteDamage || 0); return 1 + b / 100; }
  function hasSpecial(name) { return !!ensureAgg().special[name]; }

  // pilot score + rank
  function pilotScore() {
    let s = 0; unlockedKeys().forEach((k) => { const [q, r] = parseKey(k); s += nodeDef(q, r).score || 0; });
    return s;
  }
  const RANKS = [[4000, 'Legendary Pilot'], [1800, 'Master Pilot'], [750, 'Elite Pilot'], [250, 'Veteran Pilot'], [0, 'Pilot Recruit']];
  function rankFor(score) { for (const [t, n] of RANKS) if (score >= t) return n; return 'Pilot Recruit'; }

  // =========================================================================
  // DREADNAUGHT HUNT — tiers, weekly lockout, drop chance, rewards
  // =========================================================================
  function levelForTier(t) { try { return G().dreadLevelFor(t); } catch (e) { return 5 + t * 25; } }
  function maxTier() { return Math.max(0, Math.floor((lvl() - 5) / 25)); }            // tiers unlocked by level
  function dropChance(t) { return Math.min(0.95, 0.40 + (t - 1) * 0.02); }   // 2× drop rate (40% base, +2%/tier)
  // ISO-ish week index (weeks since a fixed Monday epoch, UTC)
  const WEEK_MS = 7 * 864e5;
  const EPOCH = Date.UTC(2024, 0, 1);                                                 // a Monday
  function weekIndex() { return Math.floor((Date.now() - EPOCH) / WEEK_MS); }
  function weekResetMs() { return EPOCH + (weekIndex() + 1) * WEEK_MS - Date.now(); }
  function lockOf(t) { try { return G().state.dreadLock || {}; } catch (e) { return {}; } }
  // ---- LOOTFLEET PRO: one extra hunt per tier, per week ---------------------
  // PRO_PERKS.dreadAttempts was declared and SOLD on the purchase sheet but
  // never implemented — subscribers were paying for an attempt that did not
  // exist. It is a real second run at each tier now, refreshed weekly with the
  // rest of the hunt, consumed only when the tier was genuinely locked.
  function proFree() {
    const st = G().state;
    if (!st.dreadProFree || st.dreadProFree.week !== weekIndex()) st.dreadProFree = { week: weekIndex(), used: {} };
    return st.dreadProFree;
  }
  function isPro() { try { return !!(G().isPro && G().isPro()); } catch (e) { return false; } }
  function proAttempt(t) { return isPro() && !proFree().used[t]; }
  function isLocked(t) { return lockOf(t)[t] === weekIndex() && !proAttempt(t); }
  function canHunt(t) { return lvl() >= levelForTier(t) && !isLocked(t); }

  // ---- PURCHASED RESPAWNS -------------------------------------------------
  // Buy back a locked tier's attempt at a brutally escalating gold price:
  // 1st respawn 100M → 2nd 100B → 3rd 100T → ×1000 each, PER TIER, resets weekly.
  function respawnState() {
    const st = G().state;
    if (!st.dreadRespawn || st.dreadRespawn.week !== weekIndex()) st.dreadRespawn = { week: weekIndex(), n: {} };
    return st.dreadRespawn;
  }
  function respawnCost(t) { return 100e6 * Math.pow(1000, (respawnState().n[t] || 0)); }
  function buyRespawn(t) {
    if (!isLocked(t)) return;
    const cost = respawnCost(t), g = G();
    if ((g.state.gold || 0) < cost) { toast('Need ' + fmt(cost) + ' gold to respawn this Dreadnaught'); return; }
    g.state.gold -= cost;
    const rs = respawnState(); rs.n[t] = (rs.n[t] || 0) + 1;
    delete g.state.dreadLock[t];
    g.save(); if (window.UI) window.UI.refreshAll();
    toast('⟳ Dreadnaught T' + t + ' respawned — deploy when ready');
    renderHunt();
  }
  function fmt(n) { try { return G().formatNum(Math.floor(n)); } catch (e) { return Math.floor(n) + ''; } }

  function deploy(t) {
    if (lvl() < UNLOCK_LEVEL) { toast('Dreadnaught Hunt unlocks at Level ' + UNLOCK_LEVEL); return; }
    if (lvl() < levelForTier(t)) { toast('Reach Level ' + levelForTier(t) + ' to challenge this Dreadnaught'); return; }
    if (isLocked(t)) { toast('This Dreadnaught is on weekly cooldown'); try { window.PROOFFER && PROOFFER.maybe('dreadlock'); } catch (e) {} return; }
    closeAllSheets();
    // Burn the Pro extra BEFORE the lock is re-stamped, so it is spent only on a
    // tier that was actually used up this week.
    const _wasLocked = lockOf(t)[t] === weekIndex();
    if (_wasLocked && proAttempt(t)) proFree().used[t] = 1;
    try { G().startDreadHunt(t); } catch (e) { return; }
    // ONE HUNT PER TIER PER WEEK — the attempt is CONSUMED ON LAUNCH, win or
    // lose. Bailing mid-hunt no longer refunds it (that loophole let players
    // farm the 30-wave gauntlet endlessly). Gold respawns still buy it back.
    const st = G().state;
    if (!st.dreadLock) st.dreadLock = {};
    st.dreadLock[t] = weekIndex();
    try { G().save(); } catch (e) {}
    updateHud();
    // jump to the live battle view
    const b = document.querySelector('.nav-btn[data-screen="battle"]'); if (b) b.click();
    banner('DREADNAUGHT HUNT · TIER ' + t, 'Survive 30 waves — then break the Dreadnaught · your weekly attempt is live', ACCENT);
  }

  // called by the engine the instant the Dreadnaught is destroyed
  function onHuntCleared(t) {
    const st = G().state;
    if (!st.dreadLock) st.dreadLock = {};
    st.dreadLock[t] = weekIndex();   // (already consumed at launch — kept for safety)
    const firstEver = !st.dreadFirstKill;
    st.dreadFirstKill = true;
    let got = Math.random() < dropChance(t) ? 1 : 0;
    if (firstEver) got = Math.max(1, got);                       // guarantee the very first core (onboarding)
    if (got > 0 && hasSpecial('coreLuck') && Math.random() < 0.5) got += 1;  // legendary: double-core
    st.dreadCores = (st.dreadCores || 0) + got;
    try { G().save(); } catch (e) {}
    if (window.UI) window.UI.refreshAll();
    updateHud();
    victory(t, got, firstEver);
  }

  // =========================================================================
  // RAID-BOSS PHASES (engine tick) + telegraphs (engine render)
  // =========================================================================
  let _lastBoss = null, _phase = 0, _novaT = 0;
  function tick(dt, rt) {
    const b = rt.boss;
    if (!b || !b.isDread) { _lastBoss = null; _phase = 0; return; }
    if (b !== _lastBoss) { _lastBoss = b; _phase = 1; _novaT = 3.0; banner('DREADNAUGHT INBOUND', 'Raid boss — multiple combat phases', ACCENT); }
    const frac = b.maxHp > 0 ? b.hp / b.maxHp : 1;
    const ph = frac > 0.66 ? 1 : frac > 0.33 ? 2 : 3;
    if (ph > _phase) {
      _phase = ph;
      b.fireCd = Math.max(0.5, b.fireCd * 0.78);                 // enrage: fire faster
      b.damage *= 1.12;
      rt.shake = Math.min(5, (rt.shake || 0) + 2);
      nova(b, rt, ph);
      banner(ph === 2 ? 'PHASE II · ENRAGED' : 'PHASE III · OVERLOAD', ph === 3 ? 'Maximum aggression — stay mobile' : 'Heavier fire incoming', ACCENT);
    }
    if (ph >= 2) { _novaT -= dt; if (_novaT <= 0) { _novaT = ph >= 3 ? 2.0 : 3.4; nova(b, rt, ph); } }
  }
  function nova(b, rt, ph) {
    if (!rt.ebolts || rt.ebolts.length > 110) return;
    const n = ph >= 3 ? 22 : 14, sp = 168, off = rt.time * 0.7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + off;
      rt.ebolts.push({ x: b.x, y: b.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ang: a, dmg: b.damage * 0.42, tint: '#ff4a5a', src: b, life: 3.0 });
    }
  }
  function render(ctx, t, rt) {
    const b = rt.boss; if (!b || !b.isDread || b.dying) return;
    // danger aura that tightens as the fight escalates
    const frac = b.maxHp > 0 ? b.hp / b.maxHp : 1;
    const sev = 1 - frac;
    const pulse = 0.5 + 0.5 * Math.sin(t * (3 + sev * 4));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const R = b.size * (2.2 + sev * 0.8);
    const g = ctx.createRadialGradient(b.x, b.y, b.size * 0.6, b.x, b.y, R);
    g.addColorStop(0, 'rgba(255,42,58,0)');
    g.addColorStop(0.7, 'rgba(255,42,58,' + (0.05 + 0.10 * pulse * (0.4 + sev)).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,42,58,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, R, 0, 7); ctx.fill();
    ctx.restore();
  }

  // =========================================================================
  // IN-WORLD BANNER (spawn / phase / deploy callouts)
  // =========================================================================
  let _banner, _bannerT;
  function banner(title, sub, col) {
    if (!_banner) {
      _banner = document.createElement('div'); _banner.id = 'dread-banner';
      _banner.innerHTML = '<div class="db-t"></div><div class="db-s"></div>';
      ($('app') || document.body).appendChild(_banner);
    }
    _banner.querySelector('.db-t').textContent = title;
    _banner.querySelector('.db-s').textContent = sub || '';
    _banner.style.setProperty('--dbc', col || ACCENT);
    _banner.classList.remove('show'); void _banner.offsetWidth; _banner.classList.add('show');
    clearTimeout(_bannerT); _bannerT = setTimeout(() => _banner.classList.remove('show'), 2600);
  }

  // =========================================================================
  // WALLET CHIP
  // =========================================================================
  function updateHud() {
    const chip = $('hud-dread'); const val = $('hud-dread-v');
    if (val) val.textContent = fmt(cores());
    if (chip) chip.style.display = (cores() > 0 || lvl() >= UNLOCK_LEVEL) ? '' : 'none';
    const cb = $('cmd-dread-badge');
    const dreadReady = huntsReady();
    if (cb) { cb.style.display = dreadReady > 0 ? 'flex' : 'none'; cb.textContent = dreadReady; }
    // ---- COMMAND-menu notifications: light up cards with pending actions ----
    const setBadge = (id, n) => {
      const e = $(id); if (!e) return;
      e.style.display = n > 0 ? 'flex' : 'none';
      e.textContent = n > 99 ? '99+' : n;
    };
    // Pilot Skills — unspent skill points to allocate
    let skillPts = 0; try { skillPts = (G().state.skillPoints | 0) || 0; } catch (e) {}
    setBadge('cmd-skills-badge', skillPts);
    // Pilot Tree — Dread Cores ready to spend on an unlockable node
    const pilotReady = (lvl() >= UNLOCK_LEVEL && cores() >= 1) ? cores() : 0;
    setBadge('cmd-pilot-badge', pilotReady);
    // Command nav button — aggregate count of sections that need attention
    const sections = (skillPts > 0 ? 1 : 0) + (pilotReady > 0 ? 1 : 0) + (dreadReady > 0 ? 1 : 0);
    const navB = $('cmd-badge');
    if (navB) { navB.style.display = sections > 0 ? 'block' : 'none'; navB.textContent = sections; }
  }
  // number of tiers available to run right now (unlocked + off cooldown)
  function huntsReady() { let n = 0; for (let t = 1; t <= maxTier(); t++) if (canHunt(t)) n++; return n; }

  // =========================================================================
  // UI — PILOT SCREEN (hex tree) + DREADNAUGHT HUNT SCREEN
  // =========================================================================
  // (rendered into #pilot-body / #dread-body — see ui.js wiring)
  let _filter = null;                       // category highlight filter
  let _selected = null;                     // selected node key on the tree
  let pan = { x: 0, y: 0 };                  // tree pan offset (px)
  let zoom = 1;                              // tree zoom (0.35–1.8)
  const HEX = 26;                            // hex radius (px) in tree space (zoomed out a touch)
  let _treeCanvas, _treeCtx, _hitNodes = [], _panActive = false, _panMoved = false, _panStart = null;

  function hexCenter(q, r) { return { x: HEX * 1.5 * q, y: HEX * Math.sqrt(3) * (r + q / 2) }; }
  const CAT_COL = { offense: '#ff5a4d', defense: '#4db4ff', utility: '#4dd886', rare: '#ffcf4d', core: '#c9a0ff' };

  function lockedVeil(title, body) {
    return '<div class="dr-veil"><div class="dr-veil-card"><div class="dr-veil-ic">🔒</div><h3>' + title + '</h3><p>' + body + '</p>' +
      '<div class="dr-veil-lv">Level ' + lvl() + ' / ' + UNLOCK_LEVEL + '</div>' +
      '<div class="dr-veil-bar"><i style="width:' + clamp(lvl() / UNLOCK_LEVEL * 100, 0, 100) + '%"></i></div></div></div>';
  }

  // ---------- PILOT SCREEN ----------
  function renderPilot() {
    const body = $('pilot-body'); if (!body) return;
    const sub = $('pilot-sub'); if (sub) sub.textContent = lvl() >= UNLOCK_LEVEL ? ('◇ ' + fmt(cores()) + ' Dread Cores') : ('Unlocks at Lv ' + UNLOCK_LEVEL);
    if (lvl() < UNLOCK_LEVEL) {
      body.innerHTML = lockedVeil('Pilot Progression', 'Reach <b>Level ' + UNLOCK_LEVEL + '</b> to attain elite status. Dreadnaughts will begin appearing across the galaxy, and the Pilot Tree will open.');
      return;
    }
    maybeTutorial();
    const score = pilotScore(), rank = rankFor(score);
    const ag = ensureAgg();

    body.innerHTML =
      '<div class="pl-hero">' +
        '<span class="pl-hero-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11a7 7 0 0 1 14 0v1.5a3.5 3.5 0 0 1-3.5 3.5h-7A3.5 3.5 0 0 1 5 12.5z"/><rect x="8" y="8.5" width="8" height="5.5" rx="2.75" fill="currentColor" fill-opacity="0.18"/><path d="M19 10.5h1.4a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H19"/><path d="M9.5 17.2 9 21h6l-.5-3.8"/></svg></span>' +
        '<span class="pl-hero-rank">' + rank + '</span>' +
        '<span class="pl-hero-score"><b>' + fmt(score) + '</b> Score</span>' +
        '<button class="pl-hunt-mini" id="pl-hunt-btn">☄ Hunt</button>' +
      '</div>' +
      bonusStrip(ag.combat, ag.util) +
      '<div class="pl-treewrap">' +
        '<div class="pl-treebar">' +
          '<span class="pl-treetitle">⬡ Pilot Tree</span>' +
          '<div class="pl-filters">' + ['offense', 'defense', 'utility', 'rare'].map((c) =>
            '<button class="pl-fchip ' + c + (_filter === c ? ' on' : '') + '" data-filter="' + c + '"><i style="background:' + CAT_COL[c] + '"></i>' + c[0].toUpperCase() + c.slice(1) + '</button>').join('') +
          '</div>' +
          '<button class="pl-recenter" id="pl-zout" title="Zoom out">−</button>' +
          '<button class="pl-recenter" id="pl-zin" title="Zoom in">+</button>' +
          '<button class="pl-recenter" id="pl-recenter" title="Recenter">⊙</button>' +
        '</div>' +
        '<canvas id="pl-tree" class="pl-tree"></canvas>' +
        '<div class="pl-hint">Drag to explore · pinch or scroll to zoom · tap a node to inspect</div>' +
      '</div>' +
      '<div class="pl-detail" id="pl-detail"></div>' +
      coachBlock();

    // wire
    $('pl-hunt-btn').addEventListener('click', openHuntScreen);
    $('pl-recenter').addEventListener('click', () => { pan = { x: 0, y: 0 }; zoom = 1; fitTree(); drawTree(); });
    const zBtn = (f) => { const nz = Math.max(0.35, Math.min(1.8, zoom * f)); pan.x *= nz / zoom; pan.y *= nz / zoom; zoom = nz; drawTree(); };
    $('pl-zout').addEventListener('click', () => zBtn(1 / 1.3));
    $('pl-zin').addEventListener('click', () => zBtn(1.3));
    body.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { _filter = _filter === b.dataset.filter ? null : b.dataset.filter; renderPilot(); }));
    body.querySelectorAll('[data-coach]').forEach((b) => b.addEventListener('click', () => { _coachOpen = !_coachOpen; renderPilot(); }));
    setupTree();
    renderDetail();
  }

  function bonusStrip(combat, util) {
    const LABELS = {
      dmgPct: 'DMG', atkSpeedPct: 'Fire Rate', critChance: 'Crit', critDamage: 'Crit DMG', multiShot: 'Multi-Fire',
      bossDamage: 'Boss DMG', eliteDamage: 'Elite DMG', rangePct: 'Proj Speed', hpPct: 'Hull', regen: 'Regen',
      dmgReduce: 'Armor', lifeSteal: 'Life Steal', moveSpeed: 'Move',
      lootQuality: 'Loot', goldFind: 'Gold', xpGain: 'XP', pickupRadius: 'Pickup',
    };
    const chips = [];
    for (const k in combat) if (combat[k]) chips.push({ k, v: combat[k], u: k === 'regen' ? '%/s' : '%' });
    for (const k in util) if (util[k]) chips.push({ k, v: util[k], u: '%' });
    if (!chips.length) return '<div class="pl-bonuses empty">No bonuses yet — unlock your first node below.</div>';
    chips.sort((a, b) => b.v - a.v);
    return '<div class="pl-bonuses">' + chips.map((c) =>
      '<span class="pl-bchip"><b>+' + (Math.round(c.v * 10) / 10) + c.u + '</b> ' + (LABELS[c.k] || c.k) + '</span>').join('') + '</div>';
  }

  // ---- tree canvas ----
  function setupTree() {
    _treeCanvas = $('pl-tree'); if (!_treeCanvas) return;
    _treeCtx = _treeCanvas.getContext('2d');
    fitTree();
    // pointer pan + tap
    const dn = (x, y) => { _panActive = true; _panMoved = false; _panStart = { x, y, px: pan.x, py: pan.y }; };
    const mv = (x, y) => { if (!_panActive) return; const dx = x - _panStart.x, dy = y - _panStart.y; if (Math.abs(dx) + Math.abs(dy) > 5) _panMoved = true; pan.x = _panStart.px + dx; pan.y = _panStart.py + dy; drawTree(); };
    const up = (x, y) => { if (!_panActive) return; _panActive = false; if (!_panMoved) tapTree(x, y); };
    _treeCanvas.addEventListener('mousedown', (e) => dn(e.offsetX, e.offsetY));
    window.addEventListener('mousemove', (e) => { if (_panActive) { const r = _treeCanvas.getBoundingClientRect(); mv(e.clientX - r.left, e.clientY - r.top); } });
    window.addEventListener('mouseup', (e) => { if (_panActive) { const r = _treeCanvas.getBoundingClientRect(); up(e.clientX - r.left, e.clientY - r.top); } });
    _treeCanvas.addEventListener('touchstart', (e) => { const t = e.touches[0], r = _treeCanvas.getBoundingClientRect(); dn(t.clientX - r.left, t.clientY - r.top); }, { passive: true });
    _treeCanvas.addEventListener('touchmove', (e) => { const t = e.touches[0], r = _treeCanvas.getBoundingClientRect(); mv(t.clientX - r.left, t.clientY - r.top); e.preventDefault(); }, { passive: false });
    _treeCanvas.addEventListener('touchend', (e) => { const t = (e.changedTouches && e.changedTouches[0]) || {}, r = _treeCanvas.getBoundingClientRect(); up((t.clientX || 0) - r.left, (t.clientY || 0) - r.top); });
    // ZOOM — wheel (desktop) + pinch (touch), anchored on the cursor / pinch midpoint
    const applyZoom = (nz, cx, cy) => {
      nz = Math.max(0.35, Math.min(1.8, nz));
      const W = _treeCanvas._w, H = _treeCanvas._h;
      const wx = (cx - W / 2 - pan.x) / zoom, wy = (cy - H / 2 - pan.y) / zoom;
      zoom = nz; pan.x = cx - W / 2 - wx * zoom; pan.y = cy - H / 2 - wy * zoom;
      drawTree();
    };
    _treeCanvas.addEventListener('wheel', (e) => { e.preventDefault(); const r = _treeCanvas.getBoundingClientRect(); applyZoom(zoom * (e.deltaY < 0 ? 1.12 : 0.89), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    let _pinch = null;
    const pinchInfo = (e, r) => { const a = e.touches[0], b = e.touches[1]; return { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), x: (a.clientX + b.clientX) / 2 - r.left, y: (a.clientY + b.clientY) / 2 - r.top }; };
    _treeCanvas.addEventListener('touchstart', (e) => { if (e.touches.length === 2) { _panActive = false; const r = _treeCanvas.getBoundingClientRect(); _pinch = pinchInfo(e, r); _pinch.z0 = zoom; } }, { passive: true });
    _treeCanvas.addEventListener('touchmove', (e) => { if (_pinch && e.touches.length === 2) { const r = _treeCanvas.getBoundingClientRect(); const p = pinchInfo(e, r); applyZoom(_pinch.z0 * (p.d / _pinch.d), p.x, p.y); e.preventDefault(); } }, { passive: false });
    _treeCanvas.addEventListener('touchend', (e) => { if (e.touches.length < 2) _pinch = null; });
    // re-fit once flex layout settles, and on viewport resize, so the canvas
    // always fills the space left by the pinned hero/detail rows (no scroll).
    requestAnimationFrame(() => { fitTree(); drawTree(); });
    if (!setupTree._resizeBound) { setupTree._resizeBound = true; window.addEventListener('resize', () => { if (_treeCanvas && document.getElementById('pl-tree') === _treeCanvas) { fitTree(); drawTree(); } }); }
    drawTree();
  }
  function fitTree() {
    if (!_treeCanvas) return;
    const w = _treeCanvas.clientWidth || 320;
    let h = _treeCanvas.clientHeight;
    if (!h || h < 120) h = 260;                 // fallback before flex layout settles
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    _treeCanvas.width = Math.round(w * dpr); _treeCanvas.height = Math.round(h * dpr);
    _treeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    _treeCanvas._w = w; _treeCanvas._h = h;
  }
  function hexPath(ctx, cx, cy, rad) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 180 * (60 * i); const x = cx + rad * Math.cos(a), y = cy + rad * Math.sin(a); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.closePath();
  }
  function drawTree() {
    if (!_treeCtx) return;
    const ctx = _treeCtx, W = _treeCanvas._w, H = _treeCanvas._h;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b0f18'; ctx.fillRect(0, 0, W, H);
    const ox = W / 2 + pan.x, oy = H / 2 + pan.y, z = zoom;
    const vis = visibleSet();
    _hitNodes = [];
    // first pass: connection lines between unlocked & their visible neighbors
    ctx.lineWidth = 2;
    Object.keys(vis).forEach((k) => {
      const [q, r] = parseKey(k); const c = hexCenter(q, r);
      const sx = ox + c.x * z, sy = oy + c.y * z;
      if (sx < -40 || sx > W + 40 || sy < -40 || sy > H + 40) return;
      neighbors(q, r).forEach(([nq, nr]) => {
        const nk = key(nq, nr); if (!vis[nk]) return;
        if (k > nk) return; // draw each edge once
        const nc = hexCenter(nq, nr); const ex = ox + nc.x * z, ey = oy + nc.y * z;
        const bothU = isUnlocked(k) && isUnlocked(nk);
        ctx.strokeStyle = bothU ? 'rgba(255,160,90,0.5)' : 'rgba(120,140,170,0.14)';
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      });
    });
    // second pass: nodes
    Object.keys(vis).forEach((k) => {
      const [q, r] = parseKey(k); const c = hexCenter(q, r);
      const x = ox + c.x * z, y = oy + c.y * z;
      if (x < -36 || x > W + 36 || y < -36 || y > H + 36) return;
      const d = nodeDef(q, r);
      const unlocked = isUnlocked(k);
      const avail = !unlocked && isUnlockable(q, r);
      const col = CAT_COL[d.cat] || '#8aa';
      const dim = _filter && d.cat !== _filter;
      _hitNodes.push({ k, x, y });

      ctx.save();
      const rad = HEX * 0.82 * z;
      // AURA — unlocked (filled) nodes glow in their category colour so they read
      // instantly as "owned", just like a lit galaxy tile. Empty nodes stay dark.
      if (unlocked && !dim) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const pul = 0.82 + 0.18 * Math.sin(Date.now() / 600 + (q * 1.7 + r));
        const ag = ctx.createRadialGradient(x, y, rad * 0.2, x, y, rad * 2.0);
        ag.addColorStop(0, rgba(col, (d.rare ? 0.55 : 0.36) * pul));
        ag.addColorStop(0.6, rgba(col, (d.rare ? 0.22 : 0.13) * pul));
        ag.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(x, y, rad * 2.0, 0, 7); ctx.fill();
        ctx.restore();
      }
      if (_selected === k) { hexPath(ctx, x, y, HEX * 0.98 * z); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.shadowColor = '#fff'; ctx.shadowBlur = 8; ctx.stroke(); ctx.shadowBlur = 0; }
      hexPath(ctx, x, y, rad);
      if (unlocked) {
        const g = ctx.createLinearGradient(x - rad, y - rad, x + rad, y + rad);
        g.addColorStop(0, shade(col, 1.25)); g.addColorStop(1, shade(col, 0.55));
        ctx.fillStyle = g; ctx.globalAlpha = dim ? 0.35 : 1; ctx.fill();
        ctx.globalAlpha = dim ? 0.35 : 1; ctx.lineWidth = 2; ctx.strokeStyle = shade(col, 1.5);
        ctx.shadowColor = dim ? 'transparent' : col; ctx.shadowBlur = dim ? 0 : (d.rare ? 16 : 9);
        ctx.stroke(); ctx.shadowBlur = 0;
      } else if (avail) {
        // empty but ready to unlock: hollow dark fill + pulsing coloured rim
        ctx.fillStyle = 'rgba(14,19,28,0.96)'; ctx.globalAlpha = dim ? 0.3 : 1; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = col;
        ctx.globalAlpha = dim ? 0.3 : (0.55 + 0.45 * (0.5 + 0.5 * Math.sin(Date.now() / 340)));
        ctx.stroke();
      } else {
        // undiscovered: barely-there dashed outline
        ctx.fillStyle = 'rgba(14,18,26,0.6)'; ctx.globalAlpha = 0.5; ctx.fill();
        ctx.setLineDash([3, 4]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(150,165,190,0.28)'; ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
      // glyph
      const glyph = d.core ? '★' : avail || unlocked ? catGlyph(d) : '?';
      ctx.fillStyle = unlocked ? '#0b0f18' : avail ? col : 'rgba(180,195,215,0.5)';
      ctx.font = '800 ' + Math.max(7, Math.round((d.core ? 18 : 14) * z)) + 'px Orbitron, Rajdhani, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(glyph, x, y + 0.5);
      ctx.restore();
    });
    // re-draw on availability pulse
    _pulse();
  }
  let _pulseRAF = 0, _pulseT = 0;
  // Idle "available node" pulse. Self-sustaining rAF loop, but it (a) STOPS when
  // the Pilot screen isn't the active overlay — so it never burns frames redrawing
  // an off-screen canvas — and (b) caps the redraw at ~15fps.
  function _pulse() {
    if (_pulseRAF) return;
    _pulseRAF = requestAnimationFrame((now) => {
      _pulseRAF = 0;
      const sp = document.getElementById('screen-pilot');
      const live = _treeCanvas && document.getElementById('pl-tree') === _treeCanvas && sp && sp.classList.contains('active');
      if (!live) return;                              // leave the loop until the screen re-opens
      if (now - _pulseT < 66) { _pulse(); return; }   // ~15fps cap
      _pulseT = now; drawTree();
    });
  }
  function catGlyph(d) {
    if (d.rare) return '✦';
    const k = Object.keys(d.bonus || {})[0] || '';
    const M = { dmgPct: '⚔', atkSpeedPct: '⟫', critChance: '✸', critDamage: '✸', multiShot: '≡', bossDamage: '☠', eliteDamage: '★', rangePct: '➤', hpPct: '❤', regen: '✚', dmgReduce: '⛊', lifeSteal: '⚕', lootQuality: '◈', goldFind: '$', xpGain: '▲', pickupRadius: '◎' };
    return M[k] || '◆';
  }
  function tapTree(x, y) {
    let best = null, bd = HEX * zoom * HEX * zoom;
    _hitNodes.forEach((n) => { const dx = n.x - x, dy = n.y - y, d2 = dx * dx + dy * dy; if (d2 < bd) { bd = d2; best = n; } });
    if (best) {
      _selected = best.k; renderDetail();
      // the detail card resizes the flex layout → re-measure the canvas so the
      // hexes never get squished by a stale backing-store size.
      requestAnimationFrame(() => { fitTree(); drawTree(); });
    }
  }
  function renderDetail() {
    const el = $('pl-detail'); if (!el) return;
    if (!_selected) { el.innerHTML = '<div class="pl-detail-empty">Tap a node to inspect it.</div>'; return; }
    const [q, r] = parseKey(_selected); const d = nodeDef(q, r);
    const unlocked = isUnlocked(_selected), avail = !unlocked && isUnlockable(q, r);
    const col = CAT_COL[d.cat];
    let effects = '';
    if (d.bonus) for (const k in d.bonus) effects += '<div class="pl-eff">+' + (Math.round(d.bonus[k] * 10) / 10) + (k === 'regen' ? '%/s' : '%') + ' <span>' + effLabel(k) + '</span></div>';
    if (d.special === 'coreLuck') effects += '<div class="pl-eff legendary">✦ <span>Chance for a bonus Dread Core on every hunt</span></div>';
    let action;
    if (d.core) action = '<div class="pl-act done">★ Pilot Core — always active</div>';
    else if (unlocked) action = '<div class="pl-act done">✓ Unlocked</div>';
    else if (avail) {
      const afford = cores() >= d.cost;
      action = '<button class="pl-act unlock' + (afford ? '' : ' cant') + '" id="pl-unlock">Unlock · ◇ ' + d.cost + ' Core' + (d.cost > 1 ? 's' : '') + '</button>' +
        (afford ? '' : '<div class="pl-need">Need ◇ ' + (d.cost - cores()) + ' more — clear Dreadnaughts to earn cores</div>');
    } else action = '<div class="pl-act locked">🔒 Unlock an adjacent node first</div>';
    el.innerHTML =
      '<div class="pl-detail-card" style="--nc:' + col + '">' +
        '<div class="pl-detail-h"><span class="pl-cat-dot" style="background:' + col + '"></span>' +
          '<span class="pl-detail-name">' + d.label + (d.rare ? ' <em class="pl-leg">LEGENDARY</em>' : '') + '</span>' +
          '<span class="pl-detail-cat">' + d.cat + '</span></div>' +
        '<div class="pl-effs">' + (effects || '<div class="pl-eff">—</div>') + '</div>' +
        '<div class="pl-detail-foot"><span class="pl-detail-score">+' + (d.score || 0) + ' Pilot Score</span>' + action + '</div>' +
      '</div>';
    const ub = $('pl-unlock');
    if (ub) ub.addEventListener('click', () => {
      if (unlock(q, r)) { _aggDirty = true; banner('NODE UNLOCKED', d.label, col); renderPilot(); }
      else toast('Not enough Dread Cores');
    });
  }
  function effLabel(k) {
    const M = { dmgPct: 'Weapon Damage', atkSpeedPct: 'Fire Rate', critChance: 'Critical Chance', critDamage: 'Critical Damage', multiShot: 'Multi-Fire', bossDamage: 'Boss Damage', eliteDamage: 'Elite Damage', rangePct: 'Projectile Speed', hpPct: 'Hull / Shield', regen: 'Shield Regen', dmgReduce: 'Damage Reduction', lifeSteal: 'Life Steal', moveSpeed: 'Move Speed', lootQuality: 'Loot Quality', goldFind: 'Gold Find', xpGain: 'XP Gain', pickupRadius: 'Pickup Radius' };
    return M[k] || k;
  }

  // ---- coaching ----
  const TIPS = [
    'Focus Weapon Damage and Critical Chance early to lift overall combat power.',
    'Life Steal and Shield Regen greatly boost survivability in boss fights.',
    'Utility nodes seem weak at first but compound your long-term economy.',
    'Higher-tier Dreadnaughts have better Dread Core odds — push when ready.',
    'You can plan any route — aim toward the legendary ✦ nodes that fit your build.',
    'Every Dread Core counts. Spend them to shape an elite commander.',
  ];
  let _coachOpen = false;
  function coachBlock() {
    return '<div class="pl-coach"><button class="pl-coach-h" data-coach>💡 Pilot Tips <span>' + (_coachOpen ? '▾' : '▸') + '</span></button>' +
      (_coachOpen ? '<ul class="pl-coach-l">' + TIPS.map((t) => '<li>' + t + '</li>').join('') + '</ul>' : '') + '</div>';
  }

  // ---------- DREADNAUGHT HUNT SCREEN ----------
  function openHuntScreen() { const b = document.querySelector('.nav-btn[data-screen="dread"]'); if (b) b.click(); else renderHunt(); }
  function renderHunt() {
    const body = $('dread-body'); if (!body) return;
    const sub = $('dread-sub'); if (sub) sub.textContent = lvl() >= UNLOCK_LEVEL ? ('◇ ' + fmt(cores()) + ' Dread Cores') : ('Unlocks at Lv ' + UNLOCK_LEVEL);
    if (lvl() < UNLOCK_LEVEL) {
      body.innerHTML = lockedVeil('Dreadnaught Hunt', 'Reach <b>Level ' + UNLOCK_LEVEL + '</b>. Ancient Dreadnaughts will surface across the galaxy, each holding a <b>Dread Core</b> — the only resource that upgrades your Pilot.');
      return;
    }
    const reset = weekResetMs();
    let cards = '';
    const top = Math.max(1, maxTier()) + 2;
    for (let t = 1; t <= top; t++) {
      const need = levelForTier(t);
      const open = lvl() >= need;
      const locked = isLocked(t);
      const chance = Math.round(dropChance(t) * 100);
      const spr = ((t - 1) % 6) + 1;
      let action, statusCls = '';
      if (!open) { action = '<span class="dh-lock">🔒 Lv ' + need + '</span>'; statusCls = 'soon'; }
      else if (locked) {
        const rc = respawnCost(t), afford = (G().state.gold || 0) >= rc;
        action = '<span class="dh-cd">⏱ <b data-reset="1">' + fmtDur(reset) + '</b></span>' +
          '<button class="dh-respawn" data-respawn="' + t + '"' + (afford ? '' : ' disabled') + '>⟳ Respawn · <b>$' + fmt(rc) + '</b></button>';
        statusCls = 'cooldown';
      }
      else { action = '<button class="dh-go" data-tier="' + t + '">Deploy</button>'; statusCls = 'ready'; }
      cards +=
        '<div class="dh-card ' + statusCls + '">' +
          '<div class="dh-art"><img src="ships/dread-' + spr + '.png" alt=""></div>' +
          '<div class="dh-info">' +
            '<div class="dh-name">Dreadnaught <span class="dh-tier">T' + t + '</span></div>' +
            '<div class="dh-meta">Level ' + need + ' · 30 waves → raid boss</div>' +
            '<div class="dh-drop"><i></i>◇ ' + chance + '% Dread Core drop</div>' +
          '</div>' +
          '<div class="dh-action">' + action + '</div>' +
        '</div>';
    }
    body.innerHTML =
      '<div class="dh-banner">' +
        '<div class="dh-banner-t">☄ DREADNAUGHT HUNT</div>' +
        '<div class="dh-banner-s">Weekly raids · 30 waves then a multi-phase raid boss · ONE attempt per tier per week, consumed on launch — win or lose</div>' +
        '<div class="dh-week">Weekly reset in <b data-reset="1">' + fmtDur(reset) + '</b></div>' +
      '</div>' +
      '<div class="dh-list">' + cards + '</div>' +
      '<div class="dh-foot">Dread Cores forge your <b>Pilot Tree</b> — permanent bonuses for every ship. Higher tiers drop cores more often.</div>';
    body.querySelectorAll('[data-tier]').forEach((b) => b.addEventListener('click', () => deploy(+b.dataset.tier)));
    body.querySelectorAll('[data-respawn]').forEach((b) => b.addEventListener('click', () => buyRespawn(+b.dataset.respawn)));
  }

  function fmtDur(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm';
  }

  // ---------- victory / tutorial modals ----------
  let _modal;
  function closeAllSheets() { if (_modal) { _modal.remove(); _modal = null; } }
  function showModal(html) {
    closeAllSheets();
    _modal = document.createElement('div'); _modal.className = 'dr-modal';
    _modal.innerHTML = '<div class="dr-modal-back"></div><div class="dr-modal-card">' + html + '</div>';
    ($('app') || document.body).appendChild(_modal);
    _modal.querySelector('.dr-modal-back').addEventListener('click', closeAllSheets);
    return _modal;
  }
  function maybeTutorial() {
    if (lvl() < UNLOCK_LEVEL) return;
    const st = G().state; if (st.pilotSeen) return; st.pilotSeen = true; try { G().save(); } catch (e) {}
    showModal(
      '<div class="drm-ic">☄</div>' +
      '<h2 class="drm-h">Your Pilot has reached elite status</h2>' +
      '<p class="drm-p">Dreadnaughts have begun appearing throughout the galaxy. These ancient warships hold powerful <b>Dread Cores</b> — the only resource that permanently improves your Pilot.</p>' +
      '<p class="drm-p">Defeat Dreadnaughts, collect Dread Cores, and forge your own path through the <b>Pilot Tree</b>.</p>' +
      '<p class="drm-note">Pilot upgrades apply to <b>every ship you own</b> — past, present and future.</p>' +
      '<button class="drm-ok" id="drm-ok">Begin</button>'
    );
    const ok = $('drm-ok'); if (ok) ok.addEventListener('click', closeAllSheets);
  }
  function victory(t, got, firstEver) {
    const spr = ((t - 1) % 6) + 1;
    showModal(
      '<div class="drm-victory">' +
      '<div class="drm-vart"><img src="ships/dread-' + spr + '.png" alt=""></div>' +
      '<div class="drm-vkill">DREADNAUGHT DESTROYED</div>' +
      '<div class="drm-vtier">Tier ' + t + ' · Level ' + levelForTier(t) + '</div>' +
      (got > 0
        ? '<div class="drm-core ' + (got > 1 ? 'dbl' : '') + '">◇ +' + got + ' Dread Core' + (got > 1 ? 's' : '') + (firstEver ? ' <em>· first kill bonus</em>' : '') + '</div>'
        : '<div class="drm-nocore">No Dread Core this run — better odds at higher tiers</div>') +
      '<div class="drm-vsub">This tier is now on weekly cooldown. Spend cores in the <b>Pilot Tree</b>.</div>' +
      '<div class="drm-vbtns"><button class="drm-ok" id="drm-tree">Open Pilot Tree</button><button class="drm-ghost" id="drm-close">Close</button></div>' +
      '</div>'
    );
    const tb = $('drm-tree'); if (tb) tb.addEventListener('click', () => { closeAllSheets(); const b = document.querySelector('.nav-btn[data-screen="pilot"]'); if (b) b.click(); else { const h = document.querySelector('.nav-btn[data-screen="hero"]'); if (h) h.click(); } });
    const cb = $('drm-close'); if (cb) cb.addEventListener('click', () => { closeAllSheets(); const b = document.querySelector('.nav-btn[data-screen="dread"]'); if (b) b.click(); });
  }

  // =========================================================================
  // STYLES
  // =========================================================================
  function injectCSS() {
    if ($('dread-css')) return;
    const s = document.createElement('style'); s.id = 'dread-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  // =========================================================================
  // BOOT
  // =========================================================================
  function boot() {
    injectCSS();
    // live timers + hud refresh
    setInterval(() => {
      try {
        updateHud();
        const onDread = $('screen-dread') && $('screen-dread').classList.contains('active');
        if (onDread) document.querySelectorAll('[data-reset]').forEach((e) => { e.textContent = fmtDur(weekResetMs()); });
      } catch (e) {}
    }, 1000);
    // recompute aggregate if a save loaded fresh nodes
    _aggDirty = true;
    // Fold saved pilot nodes into combat stats once the engine is ready — the
    // DREAD module boots after GAME.init(), so the first score render otherwise
    // omits the pilot bonuses until the next stat recompute.
    setTimeout(() => { try { if (window.GAME && window.GAME.refreshStats && Object.keys(nodes()).length) { window.GAME.refreshStats(); if (window.UI) window.UI.refreshAll(); } } catch (e) {} }, 700);
    setTimeout(updateHud, 600);
  }

  // shade helper (hex → lighter/darker)
  function rgba(hex, a) {
    if (hex[0] !== '#' || hex.length < 7) return hex;
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function shade(hex, f) {
    if (hex[0] !== '#' || hex.length < 7) return hex;
    let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    r = clamp(Math.round(r * f), 0, 255); g = clamp(Math.round(g * f), 0, 255); b = clamp(Math.round(b * f), 0, 255);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  window.DREAD = {
    // engine hooks
    combatMods, mult, dmgVs, tick, render, onHuntCleared, proAttempt,
    // ui
    renderPilot, renderHunt, updateHud, deploy,
    // cache control — game-v93 calls this after an ascension wipes the tree
    refresh: () => { _aggDirty = true; },
    // helpers / debug
    pilotScore, canHunt, levelForTier, _dbg: { nodeDef, ensureAgg, unlock },
  };

  // ---- CSS string ----------------------------------------------------------
  const CSS = `
  /* Dread Core wallet chip */
  #hud-dread .rg{ color:${ACCENT}; }
  /* Command cards */
  .mega-card.cmd-dread{ background:linear-gradient(180deg,#1d0e13,#140a0e); }
  .mega-card.cmd-dread .mc-ic{ color:#ff5a68; border-color:rgba(255,58,74,.45); background:radial-gradient(120% 120% at 50% 0%,#2a1218,#140a0e); box-shadow:0 0 14px -3px rgba(255,58,74,.7); }
  .mega-card.cmd-dread .mc-n{ color:#ffd0d4; }
  .mega-card.cmd-dread::before{ background:linear-gradient(130deg,#ff5168,#ff8a3c,#ffd450,#ff5168); background-size:250% 250%; }
  .mega-card.cmd-pilot .mc-ic{ color:#ff8a94; border-color:rgba(255,58,74,.35); }
  /* My Galaxy — the flagship Command card: always top, larger, with a live aura */
  .mega-card.cmd-galaxy{ grid-column:1 / -1; background:linear-gradient(180deg,#13263a,#0c1726); padding:16px 16px; min-height:84px; border-color:rgba(95,209,255,.6); box-shadow:0 0 26px -4px rgba(95,209,255,.5), 0 0 0 1px rgba(95,209,255,.25) inset; animation:galaxyAura 3.2s ease-in-out infinite; }
  @keyframes galaxyAura{ 0%,100%{ box-shadow:0 0 22px -6px rgba(95,209,255,.42), 0 0 0 1px rgba(95,209,255,.22) inset; } 50%{ box-shadow:0 0 38px 0 rgba(95,209,255,.78), 0 0 0 1px rgba(95,209,255,.4) inset; } }
  .mega-card.cmd-galaxy .mc-ic{ width:50px; height:50px; color:#7fe0ff; border-color:rgba(95,209,255,.6); background:radial-gradient(120% 120% at 50% 0%,#1a3450,#0c1726); box-shadow:0 0 22px -2px rgba(95,209,255,.85); }
  .mega-card.cmd-galaxy .mc-ic svg{ width:26px; height:26px; }
  .mega-card.cmd-galaxy .mc-n{ color:#dff3ff; font-size:17px; }
  .mega-card.cmd-galaxy .mc-s{ color:#9fcbe6; }
  .mega-card.cmd-galaxy::before{ background:linear-gradient(130deg,#5fd1ff,#7b9bff,#46d27a,#5fd1ff); background-size:260% 260%; opacity:.5; }
  @media (prefers-reduced-motion:reduce){ .mega-card.cmd-galaxy{ animation:none; } }
  /* DREAD-class ship cards (Hangar ▸ Ships) */
  .apex-chip.dread{ background:linear-gradient(90deg,#ff3a4a,#ff8a3c); color:#fff; }
  .ship-card.dread{ border-color:rgba(255,58,74,.4)!important; box-shadow:0 0 22px -10px rgba(255,58,74,.6); }
  .ship-btn.dreadbuy{ background:linear-gradient(180deg,#ff4a5a,#d8202f)!important; color:#fff!important; border:none!important; box-shadow:0 5px 14px -6px ${ACCENT}; }
  .ship-btn.dreadbuy:active{ transform:scale(.95); }
  .mega-cost{ display:inline-flex; flex-wrap:wrap; gap:5px 8px; align-items:center; }
  .mega-cost.big{ font-size:13px; }
  .mega-c{ font-variant-numeric:tabular-nums; font-weight:800; color:#dbe5f2; white-space:nowrap; }
  #cmd-dread-badge{ position:absolute; top:6px; right:8px; min-width:16px; height:16px; padding:0 4px; border-radius:8px; background:${ACCENT}; color:#fff; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:10px; line-height:16px; text-align:center; box-shadow:0 0 8px ${ACCENT}; z-index:2; }
  /* in-world banner */
  #dread-banner{ position:absolute; left:0; right:0; top:30%; z-index:14; display:flex; flex-direction:column; align-items:center; pointer-events:none; opacity:0; transform:translateY(-8px); }
  #dread-banner.show{ animation:dbIn 2.6s ease forwards; }
  @keyframes dbIn{ 0%{opacity:0;transform:translateY(-8px) scale(.96);} 10%{opacity:1;transform:none;} 80%{opacity:1;} 100%{opacity:0;} }
  #dread-banner .db-t{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:22px; letter-spacing:.14em; color:#fff; text-shadow:0 0 18px var(--dbc), 0 2px 10px #000; }
  #dread-banner .db-s{ font-family:'Rajdhani',sans-serif; font-weight:600; font-size:12.5px; letter-spacing:.05em; color:var(--dbc); margin-top:4px; text-shadow:0 1px 6px #000; }

  /* ===== PILOT SCREEN ===== */
  #pilot-body{ padding:10px 12px; display:flex; flex-direction:column; gap:9px; height:100%; min-height:0; overflow:hidden; }
  #dread-body{ padding:12px; }
  /* thin pilot bar */
  .pl-hero{ display:flex; align-items:center; gap:10px; flex:none; background:linear-gradient(90deg,#1a1016,#140b12);
    border:1px solid #3a2030; border-radius:11px; padding:6px 10px; box-shadow:0 0 18px -10px rgba(255,58,74,.6); }
  .pl-hero-ic{ width:28px; height:28px; flex:none; border-radius:8px; color:#ff9aa2;
    background:radial-gradient(120% 120% at 50% 0%,#241626,#120b14); border:1px solid #ff3a4a55; display:grid; place-items:center; }
  .pl-hero-ic svg{ width:19px; height:19px; }
  .pl-hero-rank{ font-family:'Orbitron',sans-serif; font-weight:700; font-size:11.5px; letter-spacing:.06em; color:#ffd0d4; text-transform:uppercase; white-space:nowrap; }
  .pl-hero-score{ font-size:12px; color:#9fb0c4; white-space:nowrap; }
  .pl-hero-score b{ color:#fff; font-family:'Orbitron',sans-serif; font-weight:800; font-size:14px; margin-right:2px; }
  .pl-hunt-mini{ margin-left:auto; flex:none; display:inline-flex; align-items:center; gap:6px; white-space:nowrap;
    border:1px solid #ff3a4a66; border-radius:9px; background:linear-gradient(180deg,#2a0f16,#1a0a10); color:#ff8a94;
    font-family:'Rajdhani',sans-serif; font-weight:700; font-size:12px; padding:6px 11px; cursor:pointer; }
  .pl-hunt-mini:active{ transform:scale(.96); }

  .pl-bonuses{ display:flex; flex-wrap:nowrap; gap:5px; margin:0; flex:none; overflow-x:auto; overflow-y:hidden; padding-bottom:2px; scrollbar-width:none; -webkit-overflow-scrolling:touch; }
  .pl-bonuses::-webkit-scrollbar{ display:none; }
  .pl-bchip{ flex:none; }
  .pl-bonuses.empty{ font-size:12px; color:#8a93a6; padding:8px 2px; }
  .pl-bchip{ font-size:11px; color:#cdd7e6; background:#141b27; border:1px solid #25303f; border-radius:8px; padding:3px 8px; }
  .pl-bchip b{ color:#ffd24d; font-weight:800; }

  .pl-treewrap{ background:#0b0f18; border:1px solid #222c3a; border-radius:14px; overflow:hidden; flex:1 1 auto; min-height:150px; display:flex; flex-direction:column; }
  .pl-treebar{ display:flex; align-items:center; gap:8px; padding:9px 10px; border-bottom:1px solid #1c2530; background:linear-gradient(180deg,#131a26,#0e131d); flex-wrap:wrap; }
  .pl-treetitle{ font-family:'Orbitron',sans-serif; font-weight:700; font-size:11px; letter-spacing:.1em; color:#ffd0d4; text-transform:uppercase; }
  .pl-filters{ display:flex; gap:4px; flex:1; flex-wrap:wrap; }
  .pl-fchip{ display:inline-flex; align-items:center; gap:4px; font-size:10px; font-weight:700; color:#9fb0c4; background:#121a26; border:1px solid #25303f; border-radius:20px; padding:3px 8px; cursor:pointer; text-transform:capitalize; }
  .pl-fchip i{ width:7px; height:7px; border-radius:50%; display:block; }
  .pl-fchip.on{ color:#fff; border-color:#4a5a70; box-shadow:0 0 0 1px rgba(255,255,255,.1) inset; }
  .pl-recenter{ width:28px; height:28px; flex:none; border-radius:8px; border:1px solid #2a3545; background:#121a26; color:#bcd; font-size:15px; cursor:pointer; }
  .pl-recenter:active{ transform:scale(.92); }
  .pl-tree{ display:block; width:100%; flex:1 1 auto; min-height:0; touch-action:none; cursor:grab; }
  .pl-tree:active{ cursor:grabbing; }
  .pl-hint{ font-size:10.5px; color:#7e8aa0; text-align:center; padding:7px 8px; border-top:1px solid #1c2530; }

  .pl-detail{ margin-top:0; flex:none; }
  .pl-detail-empty{ font-size:12px; color:#8a93a6; text-align:center; padding:14px; background:#101725; border:1px dashed #26303f; border-radius:12px; }
  .pl-detail-card{ background:linear-gradient(180deg,#121a27,#0e1320); border:1px solid var(--nc); border-radius:13px; padding:12px; box-shadow:0 0 22px -10px var(--nc); }
  .pl-detail-h{ display:flex; align-items:center; gap:8px; }
  .pl-cat-dot{ width:9px; height:9px; border-radius:50%; flex:none; }
  .pl-detail-name{ font-family:'Orbitron',sans-serif; font-weight:700; font-size:14px; color:#eef3fb; flex:1; }
  .pl-leg{ font-style:normal; font-size:8.5px; letter-spacing:.1em; color:#ffcf4d; border:1px solid #ffcf4d66; border-radius:5px; padding:1px 4px; vertical-align:middle; }
  .pl-detail-cat{ font-size:10px; color:#9fb0c4; text-transform:uppercase; letter-spacing:.06em; }
  .pl-effs{ margin:9px 0; display:flex; flex-direction:column; gap:5px; }
  .pl-eff{ font-family:'Rajdhani',sans-serif; font-weight:700; font-size:15px; color:#46d27a; }
  .pl-eff span{ font-weight:600; font-size:12px; color:#aeb9c9; }
  .pl-eff.legendary{ color:#ffcf4d; }
  .pl-detail-foot{ display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:4px; }
  .pl-detail-score{ font-size:11px; color:#ffd24d; font-weight:700; }
  .pl-act{ font-size:12px; font-weight:700; }
  .pl-act.done{ color:#46d27a; } .pl-act.locked{ color:#8a93a6; }
  button.pl-act.unlock{ background:linear-gradient(180deg,#ff4a5a,#d8202f); color:#fff; border:none; border-radius:10px; padding:9px 14px; font-family:'Rajdhani',sans-serif; font-weight:800; letter-spacing:.03em; cursor:pointer; box-shadow:0 6px 18px -6px ${ACCENT}; }
  button.pl-act.unlock:active{ transform:scale(.96); }
  button.pl-act.unlock.cant{ background:#2a2030; color:#8a7a82; box-shadow:none; }
  .pl-need{ font-size:10.5px; color:#e08a92; margin-top:5px; text-align:right; }

  .pl-coach{ margin-top:0; flex:none; background:#101725; border:1px solid #26303f; border-radius:12px; overflow:hidden; }
  .pl-coach-h{ width:100%; text-align:left; background:none; border:none; color:#cdd7e6; font-family:'Rajdhani',sans-serif; font-weight:700; font-size:13px; padding:11px 13px; cursor:pointer; display:flex; justify-content:space-between; }
  .pl-coach-l{ margin:0; padding:2px 16px 13px 26px; display:flex; flex-direction:column; gap:7px; }
  .pl-coach-l li{ font-size:12px; color:#aeb9c9; line-height:1.4; }

  /* ===== DREADNAUGHT HUNT SCREEN ===== */
  .dh-banner{ background:linear-gradient(180deg,#1d0c12,#140a0e); border:1px solid #4a1e28; border-radius:16px; padding:14px; text-align:center; box-shadow:0 0 28px -10px ${ACCENT}; }
  .dh-banner-t{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:17px; letter-spacing:.12em; color:#fff; text-shadow:0 0 16px rgba(255,58,74,.6); }
  .dh-banner-s{ font-size:11.5px; color:#e0a7ae; margin-top:5px; line-height:1.4; }
  .dh-week{ font-size:11px; color:#9fb0c4; margin-top:8px; } .dh-week b{ color:#ffd24d; }
  .dh-list{ display:flex; flex-direction:column; gap:9px; margin-top:12px; }
  .dh-card{ display:flex; align-items:center; gap:11px; background:linear-gradient(180deg,#141b27,#0f141e); border:1px solid #25303f; border-radius:14px; padding:10px 11px; position:relative; overflow:hidden; }
  .dh-card.ready{ border-color:#ff3a4a66; box-shadow:0 0 18px -10px ${ACCENT}; }
  .dh-card.cooldown{ opacity:.72; } .dh-card.soon{ opacity:.6; }
  .dh-action{ display:flex; flex-direction:column; align-items:flex-end; gap:5px; }
  .dh-respawn{ border:1px solid rgba(255,58,74,.55); background:rgba(255,58,74,.1); color:#ff98a2; border-radius:8px; padding:5px 9px;
    font-family:'Rajdhani',sans-serif; font-weight:800; font-size:10px; letter-spacing:.03em; cursor:pointer; white-space:nowrap; }
  .dh-respawn b{ color:#ffd24d; font-variant-numeric:tabular-nums; }
  .dh-respawn:active{ transform:scale(.95); }
  .dh-respawn:disabled{ opacity:.45; cursor:default; }
  .dh-art{ width:64px; height:48px; flex:none; display:grid; place-items:center; background:radial-gradient(120% 120% at 50% 30%,#241016,#0e0a0e); border:1px solid #3a1a22; border-radius:10px; }
  .dh-art img{ width:62px; height:46px; object-fit:contain; filter:drop-shadow(0 2px 4px rgba(0,0,0,.6)); }
  .dh-info{ flex:1; min-width:0; }
  .dh-name{ font-family:'Orbitron',sans-serif; font-weight:700; font-size:13px; color:#eef3fb; }
  .dh-tier{ font-size:10px; color:#ff8a94; margin-left:3px; }
  .dh-meta{ font-size:10.5px; color:#9fb0c4; margin-top:2px; }
  .dh-drop{ font-size:10.5px; color:#ffd0d4; margin-top:4px; display:flex; align-items:center; gap:5px; }
  .dh-drop i{ width:6px; height:6px; border-radius:50%; background:${ACCENT}; box-shadow:0 0 6px ${ACCENT}; }
  .dh-action{ flex:none; }
  .dh-go{ background:linear-gradient(180deg,#ff4a5a,#d8202f); color:#fff; border:none; border-radius:10px; padding:9px 15px; font-family:'Rajdhani',sans-serif; font-weight:800; letter-spacing:.04em; cursor:pointer; box-shadow:0 6px 16px -6px ${ACCENT}; }
  .dh-go:active{ transform:scale(.95); }
  .dh-lock, .dh-cd{ font-size:11px; font-weight:700; color:#8a93a6; white-space:nowrap; } .dh-cd{ color:#e8a13b; } .dh-cd b{ color:#ffd24d; }
  .dh-foot{ font-size:11px; color:#8a93a6; text-align:center; margin-top:12px; line-height:1.45; } .dh-foot b{ color:#ffd0d4; }

  /* ===== veil + modals ===== */
  .dr-veil{ padding:30px 18px; display:grid; place-items:center; }
  .dr-veil-card{ max-width:300px; text-align:center; background:linear-gradient(180deg,#161019,#100b14); border:1px solid #3a2030; border-radius:16px; padding:22px; }
  .dr-veil-ic{ font-size:34px; } .dr-veil-card h3{ font-family:'Orbitron',sans-serif; color:#ffd0d4; margin:8px 0 6px; font-size:16px; }
  .dr-veil-card p{ font-size:12.5px; color:#b9c2d2; line-height:1.5; } .dr-veil-card p b{ color:#fff; }
  .dr-veil-lv{ margin-top:12px; font-size:11px; color:#9fb0c4; }
  .dr-veil-bar{ height:6px; border-radius:4px; background:#221820; overflow:hidden; margin-top:6px; }
  .dr-veil-bar i{ display:block; height:100%; background:linear-gradient(90deg,#ff4a5a,#ffcf4d); }

  .dr-modal{ position:absolute; inset:0; z-index:60; display:grid; place-items:center; padding:22px; }
  .dr-modal-back{ position:absolute; inset:0; background:rgba(6,7,12,.72); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); }
  .dr-modal-card{ position:relative; max-width:320px; width:100%; background:linear-gradient(180deg,#1a1018,#120b12); border:1px solid #4a2030; border-radius:18px; padding:22px; text-align:center; box-shadow:0 24px 60px rgba(0,0,0,.6), 0 0 40px -16px ${ACCENT}; animation:drmUp .3s cubic-bezier(.22,1,.36,1); }
  @keyframes drmUp{ from{ transform:translateY(18px); opacity:0; } to{ transform:none; opacity:1; } }
  .drm-ic{ font-size:40px; filter:drop-shadow(0 0 14px ${ACCENT}); }
  .drm-h{ font-family:'Orbitron',sans-serif; font-size:16px; color:#fff; margin:8px 0 10px; line-height:1.3; }
  .drm-p{ font-size:12.5px; color:#c5cad6; line-height:1.5; margin:0 0 9px; } .drm-p b{ color:#ffd0d4; }
  .drm-note{ font-size:11.5px; color:#ff9aa2; background:rgba(255,58,74,.08); border:1px solid rgba(255,58,74,.3); border-radius:10px; padding:8px 10px; margin:4px 0 14px; }
  .drm-ok{ background:linear-gradient(180deg,#ff4a5a,#d8202f); color:#fff; border:none; border-radius:11px; padding:11px 20px; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:14px; letter-spacing:.04em; cursor:pointer; width:100%; box-shadow:0 8px 22px -8px ${ACCENT}; }
  .drm-ok:active{ transform:scale(.97); }
  .drm-ghost{ background:none; border:1px solid #3a2632; color:#c5b0b6; border-radius:11px; padding:10px 16px; font-family:'Rajdhani',sans-serif; font-weight:700; font-size:13px; cursor:pointer; margin-top:8px; width:100%; }
  .drm-victory .drm-vart{ width:140px; height:96px; margin:0 auto 6px; display:grid; place-items:center; }
  .drm-victory .drm-vart img{ width:140px; height:96px; object-fit:contain; filter:drop-shadow(0 0 18px rgba(255,58,74,.5)); animation:drFloat 3s ease-in-out infinite; }
  @keyframes drFloat{ 0%,100%{ transform:translateY(0); } 50%{ transform:translateY(-6px); } }
  .drm-vkill{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:16px; letter-spacing:.08em; color:#fff; text-shadow:0 0 16px rgba(255,58,74,.6); }
  .drm-vtier{ font-size:11.5px; color:#9fb0c4; margin:3px 0 12px; }
  .drm-core{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:20px; color:#ffcf4d; text-shadow:0 0 16px rgba(255,207,77,.5); margin-bottom:6px; }
  .drm-core em{ font-style:normal; font-size:10px; color:#9fb0c4; letter-spacing:.04em; }
  .drm-core.dbl{ animation:drmPulse 1.2s ease-in-out infinite; }
  @keyframes drmPulse{ 0%,100%{ filter:brightness(1); } 50%{ filter:brightness(1.4); } }
  .drm-nocore{ font-size:12px; color:#c5b0b6; margin-bottom:8px; }
  .drm-vsub{ font-size:11.5px; color:#a8b2c2; line-height:1.45; margin-bottom:14px; } .drm-vsub b{ color:#ffd0d4; }
  .drm-vbtns{ display:flex; flex-direction:column; gap:0; }
  `;

  // ---- BOOT (must stay LAST) ------------------------------------------------
  // boot() reads the CSS const declared above it; calling it from the module body
  // hit the temporal dead zone and aborted the script before window exports ran,
  // so the screen silently painted nothing on a late parse. Keep this at the end.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  setTimeout(boot, 1200);
})();
