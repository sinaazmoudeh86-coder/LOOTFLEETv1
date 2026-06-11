/* =============================================================================
   game.js — GrabAGun Idle Operator
   Movement-based combat engine: a walkable combat zone with a camera, fixed
   spawn nodes that repopulate 10s after a kill, ground-loot you run over to
   collect, auto-play autopilot, life-steal / multi-shot combat, a permadeath
   item-drop penalty, purchasable game-speed + offline AFK mode, and save/load.
   Exposes window.GAME for the UI layer.
   ============================================================================= */
(function () {
  'use strict';
  const C = window.CONFIG, E = window.ENTITIES, R = window.RENDER, I = window.ITEMS;
  const GX = window.GALAXYMAP;
  const SAVE_KEY = 'infinite-operator-save-v2';

  // tuning constants ----------------------------------------------------------
  const FEET = 7;                 // pixels per in-game foot
  const RESPAWN_SEC = 10;         // enemy respawn delay after a kill
  const RESPAWN_SPREAD = 5 * FEET;// respawn within 5 ft of the node
  const PICKUP_RADIUS = 26;       // how close to walk to collect loot
  const MAGNET_RADIUS = 230;      // LOOT MAGNET attraction range (~5× the old pull) — drops fly to the player
  const MAGNET_SPEED = 240;       // base px/s a magnetized drop travels (accelerates as it nears you)
  const FIRE_RANGE = 250;         // auto-fire engagement range
  const NODE_COUNT = 9;           // base spawn nodes per zone (scales up — see nodeCount)
  // Zone-scaled feel: deeper zones get a wider world, more spawns, and a more
  // zoomed-out camera (which also makes the player look smaller).
  function worldMul(zone) { return Math.min(3.4, 1.8 + zone * 0.05); }
  function zoomFor(zone) { return Math.max(0.5, 0.92 - zone * 0.012); }
  // Zone unlocking — you can reach at most 10 zones ahead of your pilot level, so
  // you can't skip into wildly over-level zones and farm insane loot. Still also
  // capped to the current 100-block.
  const ZONE_LOOKAHEAD = 10;
  function unlockCeil(level) { return level + ZONE_LOOKAHEAD; }
  // Every 11th Grind Zone (11, 22, 33…) is a WAVE ZONE: 25 escalating waves of
  // extreme density ending in a boss (30% Super Boss). Classic free-play only.
  function isWaveZone(zone) { return zone > 0 && zone % 11 === 0; }
  // CITADEL SIEGE — ~10% of grind zones (every zone ending in 7; wave zones win
  // ties): push UP through waves of heavy garrison hulks, then raze the Void
  // Citadel at the top. Razed citadels rebuild for 15 minutes.
  function isCitadelZone(zone) { return zone > 0 && zone % 10 === 7 && !isWaveZone(zone); }
  function citadelCooldownLeft(zone) {
    const until = state.citadelCd && state.citadelCd[zone];
    return until ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : 0;
  }
  // ---- ZONE BONUSES ----------------------------------------------------------
  // Every 10th zone (10,20,30…): 5× mob density. Every 25th (25,50,75…): 2× loot
  // quality. Every 100th (100,200…): 5× loot quality. Quality bonuses STACK
  // multiplicatively (e.g. Zone 100 = ×10 loot quality AND ×5 density).
  function densityMult(zone) { return (zone > 0 && zone % 10 === 0) ? 5 : 1; }
  function qualityMult(zone) { return (zone > 0 && zone % 25 === 0 ? 2 : 1) * (zone > 0 && zone % 100 === 0 ? 5 : 1); }
  function zoneBonuses(zone) { const d = densityMult(zone), q = qualityMult(zone); return { density: d, quality: q, prismatic: d > 1 || q > 1 }; }
  // Loot-quality multiplier = roll the rarity that many times, keep the best.
  function rollRarityBoosted(zone, mult) { let best = I.rollRarity(zone); for (let i = 1; i < mult; i++) { const r = I.rollRarity(zone); if (r > best) best = r; } return best; }
  function nodeCount(zone) { const base = NODE_COUNT + Math.floor(zone * 0.7); return Math.min(densityMult(zone) > 1 ? 42 : 30, Math.round(base * densityMult(zone))); }

  // --------------------------------------------------------------------------
  // STATE (persisted)
  // --------------------------------------------------------------------------
  const state = {
    level: 1, xp: 0, gold: 0,
    currentDungeon: 1, highestUnlocked: 1,
    // ---- GALAXY MAP ----
    currentSystem: null,                  // tile id you're deployed to (null = hangar)
    ownedSystems: {},                     // tiles you own: { tileId: true }
    rivalTiles: {},                       // simulated rival owners: { tileId: name }
    tileCd: {},                           // per-tile contest cooldowns (15 min · 24 h citadels)
    resources: { fuel: 80, iron: 0, plasma: 0 },
    lastResTick: Date.now(),              // for per-hour resource accrual
    ship: 'frigate',        // active hull
    ownedShips: { frigate: true },
    shipKills: { frigate: 0 }, // kills scored while piloting each hull (unlock gate)
    blueprints: {},         // hull blueprints recovered from zone bosses: { shipKey: true }
    drones: 0,              // drones currently loaded into the active carrier's bays
    fittings: {},           // per-ship saved gear: { shipKey: { slotKey: item } }
    equipped: { bow: null, arrows: null, armor: null, boots: null, gloves: null, amulet: null, bow2: null, arrows2: null },
    inventory: [],
    totalKills: 0, highestDungeonReached: 1, playTime: 0, itemsFound: 0, itemsLost: 0,
    purchases: {},          // { speed2:true, speed4:true, speed10:true, afk:true }
    gameSpeed: 1,
    skillPoints: 0,         // unspent level points
    skills: {},             // { nodeId: ranks }
    shop: null,             // { window, items[], bought[] } rotating gold shop
    sellTier: 1,            // auto-sell: sell items at/below this rarity tier
    keepUpgrades: true,     // auto-sell: never sell a slot upgrade
    autoEquipAlways: true,  // continuously equip best gear as it's collected
    auto: true,             // autopilot on by default (idle game)
    deathExplained: false,
    startWeek: null,        // heat assignment (week index when account created)
    lastSave: Date.now(),
  };

  // runtime (not persisted)
  const rt = {
    canvas: null, ctx: null, w: 0, h: 0,
    worldW: 0, worldH: 0, cam: { x: 0, y: 0 },
    archer: null,
    enemies: [], nodes: [], projectiles: [], ebolts: [], particles: [], floats: [], ground: [], drones: [],
    time: 0, last: 0, running: false,
    siege: null,            // active 10-wave siege state when capturing a system
    realTiles: {},          // shared cross-account tile ownership (Supabase turf war)
    stats: null, dps: 0, dmgWindow: [],
    joy: { x: 0, y: 0, active: false },
    portraitCanvas: null, portraitCtx: null, portW: 0, portH: 0,
  };

  // --------------------------------------------------------------------------
  // DERIVED STATS
  // --------------------------------------------------------------------------
  function computeStats() {
    const s = {
      attackDamage: C.playerBaseStat('attackDamage', state.level),
      health:       C.playerBaseStat('health', state.level),
      attackSpeed: 0, critChance: C.PLAYER_BASE.critChance, critDamage: C.PLAYER_BASE.critDamage,
      moveSpeed: C.PLAYER_BASE.moveSpeed, lifeSteal: 0, multiShot: 0,
    };
    Object.keys(state.equipped).forEach((slot) => {
      const it = state.equipped[slot];
      if (!it) return;
      for (const k in it.stats) s[k] = (s[k] || 0) + it.stats[k];
    });
    // FLEET fittings: escorts' stowed gear feeds the fleet at the same share
    // as their hull mods — auto-improved escort loadouts are real power.
    if (state.fleet && state.fleet.length) {
      fleetShips().forEach((f) => {
        const fit = state.fittings && state.fittings[f.key]; if (!fit) return;
        for (const sk in fit) {
          const it = fit[sk]; if (!it) continue;
          for (const k in it.stats) s[k] = (s[k] || 0) + it.stats[k] * C.FLEET.statShare;
        }
      });
    }
    // skill-tree modifiers
    const m = skillMods();
    // ship passive modifiers
    const ship = C.SHIP_BY_KEY[state.ship] || C.SHIPS[0];
    const sm = ship.mods || {};
    // FLEET: escorts contribute a share of their hull mods to the fleet score
    const fs = { dmgPct:0, hpPct:0, critChance:0, critDamage:0, atkSpeedPct:0, moveSpeed:0, lifeSteal:0, multiShot:0, rangePct:0 };
    const esc = fleetShips();
    esc.forEach((f) => { const fm = f.mods || {}; for (const k in fs) fs[k] += (fm[k] || 0) * C.FLEET.statShare; });
    // WARDEN ARRAY: fleet-support aura from an equipped support weapon —
    // doubled while flying the Aegis (its whole reason to exist)
    const aura = I.supportAura ? I.supportAura(state.equipped.bow) : null;
    // Warden arrays mount only on the Aegis — inert anywhere else (legacy saves)
    const aMul = ship.cls === 'Aegis' ? 2 : 0;
    s.regen = aura ? aura.regen * aMul : 0;
    s.dmgReduce = aura ? Math.min(60, aura.reduce * aMul) : 0;
    if (aura) s.multiShot += aura.multiShot * aMul;
    s.attackDamage *= (1 + (m.dmgPct + (sm.dmgPct||0) + fs.dmgPct) / 100);
    s.health *= (1 + (m.hpPct + (sm.hpPct||0) + fs.hpPct) / 100);
    s.critChance += m.critChance + (sm.critChance||0) + fs.critChance;
    s.critDamage += m.critDamage + (sm.critDamage||0) + fs.critDamage;
    s.moveSpeed += m.moveSpeed + (sm.moveSpeed||0) + fs.moveSpeed;
    s.lifeSteal += m.lifeSteal + (sm.lifeSteal||0) + fs.lifeSteal;
    s.multiShot += m.multiShot + (sm.multiShot||0) + fs.multiShot;
    s.attacksPerSec = C.PLAYER_BASE.attackSpeed * (1 + (s.attackSpeed + m.atkSpeedPct + (sm.atkSpeedPct||0) + fs.atkSpeedPct) / 100);
    s.critChance = Math.min(100, s.critChance);
    s.lifeSteal = Math.min(95, s.lifeSteal);
    s.multiShot = Math.min(100, s.multiShot);
    s.maxHp = s.health;
    s.moveSpeedPx = 92 * (s.moveSpeed / 100);
    // weapon range — hull mod + fleet share + Warden aura all extend it
    s.fireRange = FIRE_RANGE * (1 + ((sm.rangePct || 0) + fs.rangePct + (aura ? aura.rangePct * aMul : 0)) / 100);
    s.fleetSize = esc.length;
    const critMult = 1 + (s.critChance / 100) * (s.critDamage / 100);
    s.theoryDps = s.attackDamage * s.attacksPerSec * critMult * (1 + s.multiShot / 100 * 0.6);
    return s;
  }

  // ---- SKILL TREE helpers --------------------------------------------------
  function skillMods() {
    const m = { dmgPct: 0, atkSpeedPct: 0, critChance: 0, critDamage: 0, hpPct: 0, moveSpeed: 0, lifeSteal: 0, multiShot: 0 };
    C.SKILLS.nodes.forEach((n) => { const r = state.skills[n.id] || 0; if (r) m[n.mod] += n.per * r; });
    return m;
  }
  function skillRank(id) { return state.skills[id] || 0; }
  function branchSpent(br) {
    let p = 0;
    C.SKILLS.nodes.forEach((n) => { if (n.br === br) p += (state.skills[n.id] || 0) * n.cost; });
    return p;
  }
  function skillReqMet(node) {
    if (node.reqBranch != null && branchSpent(node.br) < node.reqBranch) return false;
    if (node.reqNode && (state.skills[node.reqNode.id] || 0) < node.reqNode.rank) return false;
    return true;
  }
  function canInvest(node) {
    return state.skillPoints >= node.cost && (state.skills[node.id] || 0) < node.max && skillReqMet(node);
  }
  function investSkill(id) {
    const node = C.SKILLS.nodes.find((n) => n.id === id);
    if (!node || !canInvest(node)) return false;
    state.skills[id] = (state.skills[id] || 0) + 1;
    state.skillPoints -= node.cost;
    refreshStats(); if (window.UI) window.UI.refreshAll(); save();
    return true;
  }
  function resetSkills() {
    let refund = 0;
    C.SKILLS.nodes.forEach((n) => { refund += (state.skills[n.id] || 0) * n.cost; });
    state.skillPoints += refund; state.skills = {};
    refreshStats(); if (window.UI) window.UI.refreshAll(); save();
    return refund;
  }
  // FLEET / SHIP SCORE — display scale. The raw power value (theoryDps +
  // 0.5·maxHp) keeps growing forever internally; the SCORE shown is identical
  // below 1M, then square-root compressed — so it lives far below 999T at any
  // realistic progression without ever being capped. Display-only.
  function score() {
    const s = rt.stats; if (!s) return 0;
    const raw = s.theoryDps + s.maxHp * 0.5;
    return Math.floor(raw <= 1e6 ? raw : 1e6 * Math.sqrt(raw / 1e6));
  }

  function refreshStats() {
    const prevMax = rt.stats ? rt.stats.maxHp : 0;
    rt.stats = computeStats();
    if (rt.archer) {
      rt.archer.dmgReduce = rt.stats.dmgReduce || 0;
      rt.archer.maxHp = rt.stats.maxHp;
      if (prevMax <= 0) rt.archer.hp = rt.stats.maxHp;
      else rt.archer.hp = Math.min(rt.stats.maxHp, rt.archer.hp * (rt.stats.maxHp / prevMax));
    }
  }

  // --------------------------------------------------------------------------
  // LEVELING
  // --------------------------------------------------------------------------
  function gainXp(amount) {
    if (isPro()) amount *= 2;   // LootFleet Pro — 2× XP on every source, account-wide
    state.xp += amount;
    let gained = 0;
    while (state.xp >= C.xpToNext(state.level)) { state.xp -= C.xpToNext(state.level); state.level++; gained++; }
    if (gained) { state.skillPoints += gained * C.SKILLS.pointsPerLevel; onLevelUp(gained); }
  }
  function onLevelUp(gained) {
    refreshStats();
    rt.archer.hp = rt.stats.maxHp;
    rt.archer.dead = false;
    const cap = C.zoneCap(state.highestDungeonReached);
    const unlock = Math.min(cap, unlockCeil(state.level));
    if (unlock > state.highestUnlocked) state.highestUnlocked = unlock;
    burst(rt.archer.x, rt.archer.y, '#e6b566', 26, { glow: true, speed: 220, life: 0.9 });
    if (window.UI) { window.UI.onLevelUp(state.level); window.UI.refreshAll(); }
  }

  // --------------------------------------------------------------------------
  // SPAWN NODES — fixed points that repopulate after a kill
  // --------------------------------------------------------------------------
  function allowedEnemies() { return C.ENEMIES.filter((e) => state.currentDungeon >= e.minDungeon); }
  function pickType() {
    const pool = allowedEnemies();
    return pool[Math.min(pool.length - 1, Math.floor(Math.pow(Math.random(), 1.4) * pool.length))] || pool[pool.length - 1];
  }
  function buildNodes() {
    rt.nodes = [];
    if (state.currentDungeon < 1) return; // Safe Zone: zero threats, no spawns
    const cx = rt.worldW / 2, cy = rt.worldH / 2;
    const count = Math.min(55, Math.round(nodeCount(state.currentDungeon) * (rt.tileDensity || 1)));
    for (let i = 0; i < count; i++) {
      let x, y, tries = 0;
      do {
        x = 60 + Math.random() * (rt.worldW - 120);
        y = 60 + Math.random() * (rt.worldH - 120);
        tries++;
      } while (Math.hypot(x - cx, y - cy) < 120 && tries < 20);
      rt.nodes.push({ x, y, enemy: null, respawnT: 0 });
    }
  }
  function spawnAtNode(node) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * RESPAWN_SPREAD;
    const x = Math.max(20, Math.min(rt.worldW - 20, node.x + Math.cos(a) * r));
    const y = Math.max(20, Math.min(rt.worldH - 20, node.y + Math.sin(a) * r));
    const e = new E.Enemy(pickType(), state.currentDungeon, x, y);
    e.node = node; node.enemy = e;
    rt.enemies.push(e);
  }
  function updateNodes(dt) {
    for (const node of rt.nodes) {
      if (node.enemy && (node.enemy.dead || node.enemy.dying)) { /* handled on death */ }
      if (!node.enemy) {
        if (node.respawnT > 0) { node.respawnT -= dt; if (node.respawnT <= 0) spawnAtNode(node); }
      }
    }
  }

  // --------------------------------------------------------------------------
  // COMBAT
  // --------------------------------------------------------------------------
  function nearestEnemy(maxDist) {
    let best = null, bd = (maxDist || Infinity) ** 2;
    for (const e of rt.enemies) {
      if (e.dying) continue;
      const d = (e.x - rt.archer.x) ** 2 + (e.y - rt.archer.y) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  function nearbyEnemies(n, exclude) {
    return rt.enemies
      .filter((e) => !e.dying && e !== exclude)
      .sort((a, b) => ((a.x - rt.archer.x) ** 2 + (a.y - rt.archer.y) ** 2) - ((b.x - rt.archer.x) ** 2 + (b.y - rt.archer.y) ** 2))
      .slice(0, n);
  }
  function rollDamage(s) {
    const crit = Math.random() * 100 < s.critChance;
    let dmg = s.attackDamage * (0.92 + Math.random() * 0.16);
    if (crit) dmg *= 1 + s.critDamage / 100;
    if (state.auto) dmg *= 0.8; // auto-mode (hands-off) deals 20% less damage
    return { dmg: Math.max(1, Math.round(dmg)), crit };
  }
  // Cycle the volley through EVERY equipped weapon hardpoint — each shot
  // carries the class (and visual) of the weapon that actually fired it.
  function nextWeapon() {
    const list = [];
    for (const k in state.equipped) {
      if (k !== 'bow' && !/^bow\d+$/.test(k)) continue;
      const it = state.equipped[k]; if (it) list.push(it);
    }
    if (!list.length) return null;
    rt.volleyIdx = ((rt.volleyIdx || 0) + 1) % list.length;
    return list[rt.volleyIdx];
  }
  // muzzle-flash palette per weapon class — the ship visibly fires DIFFERENT guns
  const MUZZLE_COL = {
    laser:   ['#bdeeff', '#5fd1ff'],
    gatling: ['#ffe6a0', '#ffaf40'],
    missile: ['#ffc9a0', '#ff7a3c'],
    rail:    ['#e9d6ff', '#b87bff'],
    plasma:  ['#c8ffdd', '#46d27a'],
    support: ['#dcffe9', '#7ce0a0'],
  };
  function fireAt(target, s, wpn) {
    const p = new E.Projectile(rt.archer.x, rt.archer.y, target, 0, false);
    const r = rollDamage(s); p.damage = r.dmg; p.crit = r.crit;
    p.angle = Math.atan2(target.y - rt.archer.y, target.x - rt.archer.x);
    // weapon-class visuals: each projectile carries the class of ITS hardpoint
    if (!wpn) wpn = nextWeapon() || (state.equipped && state.equipped.bow);
    p.wtype = wpn && I.weaponClassOf ? I.weaponClassOf(wpn).key : 'gatling';
    rt.projectiles.push(p);
    return p;
  }
  // ENEMY STANDOFF FIRE — gunner vessels volley dodgeable bolts from range.
  // Bolts fly straight (no homing), are visible & avoidable, and respect the
  // no-one-shot cap in Archer.takeHit. Bosses fire a 3-bolt spread.
  function enemyFire(e) {
    if (rt.ebolts.length > 48) return;                  // perf + fairness cap
    const a = rt.archer; if (!a || a.dead) return;
    const shots = e.isCitadel ? 4 : e.isBoss ? 3 : 1;
    for (let i = 0; i < shots; i++) {
      const spread = e.isCitadel ? (i - 1.5) * 0.18 : e.isBoss ? (i - 1) * 0.22 : (Math.random() - 0.5) * 0.07;
      const ang = Math.atan2(a.y - e.y, a.x - e.x) + spread;
      const sp = e.isCitadel ? 150 : e.isBoss ? 165 : 200;
      rt.ebolts.push({ x: e.x + Math.cos(ang) * e.size * 0.8, y: e.y + Math.sin(ang) * e.size * 0.8,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, ang,
        dmg: e.damage * (e.isCitadel ? 0.45 : e.isBoss ? 0.55 : 0.7), tint: e.tint, src: e, life: 2.6 });
    }
    burst(e.x + Math.cos(rt.time) * 2, e.y, e.tint, 4, { speed: 90, life: 0.22, glow: true });
  }
  function updateEbolts(dt) {
    const a = rt.archer;
    for (const b of rt.ebolts) {
      b.life -= dt; b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.life <= 0) { b.dead = true; continue; }
      if (a && !a.dead && Math.hypot(a.x - b.x, a.y - b.y) <= a.size + 5) {
        b.dead = true;
        a.takeHit(b.dmg, b.src);
        burst(b.x, b.y, '#ff7a8a', 6, { speed: 140, life: 0.28, glow: true });
      }
    }
    rt.ebolts = rt.ebolts.filter((b) => !b.dead);
  }

  function fire(primary) {
    const s = rt.stats;
    rt.archer.facing = Math.atan2(primary.y - rt.archer.y, primary.x - rt.archer.x);
    rt.archer.muzzle = 1; rt.archer.recoil = 1;
    const shot = fireAt(primary, s);
    // muzzle: flash sparks tinted by the class that fired + smoke + casing
    const mc = MUZZLE_COL[shot.wtype] || MUZZLE_COL.gatling;
    const ang = rt.archer.facing;
    const mx = rt.archer.x + Math.cos(ang) * 26, my = rt.archer.y + Math.sin(ang) * 26;
    for (let i = 0; i < 6; i++) {
      const a = ang + (Math.random() - 0.5) * 0.5, sp = 150 + Math.random() * 160;
      rt.particles.push(new E.Particle(mx, my, { vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: 0.12 + Math.random()*0.12, size: 1.6 + Math.random()*2, color: i % 2 ? mc[0] : mc[1], glow: true, drag: 0.82 }));
    }
    // smoke (kinetic classes only — energy weapons leave a light shimmer instead)
    if (shot.wtype === 'gatling' || shot.wtype === 'missile') {
      rt.particles.push(new E.Particle(mx, my, { vx: Math.cos(ang)*40, vy: Math.sin(ang)*40 - 10, life: 0.4, size: 5, color: 'rgba(180,180,185,0.5)', drag: 0.9 }));
      const ej = ang + Math.PI/2;
      rt.particles.push(new E.Particle(rt.archer.x + 6, rt.archer.y - 4, { vx: Math.cos(ej)*70, vy: -120, gravity: 420, life: 0.5, size: 1.6, color: '#d9b25a' }));
    } else {
      rt.particles.push(new E.Particle(mx, my, { vx: Math.cos(ang)*30, vy: Math.sin(ang)*30, life: 0.25, size: 4, color: hexToRgba(mc[1], 0.35), drag: 0.88 }));
    }
    // MULTI-SHOT: chance to also fire at nearby enemies — each from its own hardpoint
    if (s.multiShot > 0 && Math.random() * 100 < s.multiShot) {
      const extra = nearbyEnemies(C.MULTISHOT_MAX_TARGETS, primary);
      extra.forEach((t) => fireAt(t, s));
    }
  }
  function resolveHit(p) {
    const e = p.target;
    if (!e || e.dead) return;
    const killed = e.takeDamage(p.damage);
    // damage floats are thinned under load — crits ALWAYS show
    if (p.crit || rt.floats.length < 28) {
      rt.floats.push(new E.FloatText(e.x, e.y - e.size, formatNum(p.damage), { color: p.crit ? '#e07c12' : '#f4f8ff', size: p.crit ? 48 : 32, crit: p.crit }));
    }
    // IMPACT: class-specific hit effects — each weapon lands differently
    const back = p.angle;
    const wt = p.wtype || 'gatling';
    if (wt === 'missile') {
      // EXPLOSION — omnidirectional fireball + shockwave flash + punch
      const n = p.crit ? 18 : 12;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = (p.crit ? 260 : 190) * (0.3 + Math.random());
        rt.particles.push(new E.Particle(p.x, p.y, { vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: 0.25 + Math.random()*0.3, size: 1.8 + Math.random()*3, color: i % 3 ? '#ff9a50' : '#ffd9a0', glow: i % 2 === 0, drag: 0.85 }));
      }
      rt.particles.push(new E.Particle(p.x, p.y, { vx: 0, vy: -16, life: 0.5, size: 7, color: 'rgba(150,150,155,0.45)', drag: 0.92 }));
      rt.particles.push(new E.Particle(p.x, p.y, { vx: 0, vy: 0, life: 0.16, size: p.crit ? 13 : 10, color: '#fff0d0', glow: true, drag: 1 }));
      rt.shake = Math.min(6, (rt.shake || 0) + (p.crit ? 3.5 : 1.6));
    } else if (wt === 'rail') {
      // PIERCE — slug punches THROUGH: sparks continue forward + entry flash
      for (let i = 0; i < (p.crit ? 12 : 8); i++) {
        const a = back + (Math.random() - 0.5) * 0.35, sp = (p.crit ? 320 : 240) * (0.5 + Math.random());
        rt.particles.push(new E.Particle(p.x, p.y, { vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: 0.18 + Math.random()*0.16, size: 1.3 + Math.random()*1.8, color: i % 2 ? '#cfa6ff' : '#efe2ff', glow: true, drag: 0.93 }));
      }
      rt.particles.push(new E.Particle(p.x, p.y, { vx: 0, vy: 0, life: 0.12, size: p.crit ? 9 : 6, color: '#e9d6ff', glow: true, drag: 1 }));
    } else if (wt === 'plasma') {
      // SPLASH — molten droplets sputter and hang
      for (let i = 0; i < (p.crit ? 14 : 9); i++) {
        const a = back + (Math.random() - 0.5) * 2.2, sp = 90 * (0.3 + Math.random());
        rt.particles.push(new E.Particle(p.x, p.y, { vx: Math.cos(a)*sp, vy: Math.sin(a)*sp - 20, life: 0.35 + Math.random()*0.3, size: 1.8 + Math.random()*2.6, color: i % 2 ? '#7df0a8' : '#c8ffdd', glow: true, gravity: 60, drag: 0.9 }));
      }
      rt.particles.push(new E.Particle(p.x, p.y, { vx: 0, vy: 0, life: 0.18, size: p.crit ? 11 : 8, color: '#d8ffe8', glow: true, drag: 1 }));
    } else if (wt === 'laser') {
      // FLASH-BURN — instant bright bloom + thin cyan embers
      rt.particles.push(new E.Particle(p.x, p.y, { vx: 0, vy: 0, life: 0.14, size: p.crit ? 11 : 8, color: '#eaf9ff', glow: true, drag: 1 }));
      for (let i = 0; i < (p.crit ? 10 : 6); i++) {
        const a = back + (Math.random() - 0.5) * 1.0, sp = 140 * (0.4 + Math.random());
        rt.particles.push(new E.Particle(p.x, p.y, { vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: 0.16 + Math.random()*0.14, size: 1.2 + Math.random()*1.6, color: i % 2 ? '#8fe0ff' : '#d9f4ff', glow: true, drag: 0.88 }));
      }
    } else {
      // kinetic spray (gatling/support) — directional sparks opposite the round
      const col = p.crit ? '#ffd24d' : (wt === 'support' ? '#a8f0c4' : '#ffcaa0'), n = p.crit ? 16 : 9;
      for (let i = 0; i < n; i++) {
        const a = back + (Math.random() - 0.5) * 1.3, sp = (p.crit ? 230 : 150) * (0.4 + Math.random());
        rt.particles.push(new E.Particle(p.x, p.y, { vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: 0.22 + Math.random()*0.22, size: 1.4 + Math.random()*2.4, color: col, glow: p.crit, drag: 0.86 }));
      }
      rt.particles.push(new E.Particle(p.x, p.y, { vx: 0, vy: 0, life: 0.14, size: p.crit ? 9 : 6, color: p.crit ? '#fff0b0' : '#ffe6c0', glow: true, drag: 1 }));
    }
    // ichor mist in the enemy tint (all classes)
    for (let i = 0; i < 4; i++) {
      const a = Math.random()*Math.PI*2, sp = 60 + Math.random()*90;
      rt.particles.push(new E.Particle(p.x, p.y, { vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: 0.3, size: 1.5 + Math.random()*2, color: e.tint, gravity: 140, drag: 0.9 }));
    }
    // crit: a little screen punch
    if (p.crit) rt.shake = Math.min(6, (rt.shake || 0) + 4);
    rt.dmgWindow.push({ t: rt.time, dmg: p.damage });
    // LIFE STEAL
    if (rt.stats.lifeSteal > 0 && !rt.archer.dead) {
      const heal = p.damage * (rt.stats.lifeSteal / 100);
      if (heal >= 1 && rt.archer.hp < rt.stats.maxHp) {
        rt.archer.hp = Math.min(rt.stats.maxHp, rt.archer.hp + heal);
        if (Math.random() < 0.25) rt.floats.push(new E.FloatText(rt.archer.x, rt.archer.y - 20, '+' + formatNum(heal), { color: '#2f9e4f', size: 13, vy: -40, life: 0.7 }));
      }
    }
    if (killed) onKill(e);
  }
  function onKill(e) {
    state.totalKills++;
    state.shipKills[state.ship] = (state.shipKills[state.ship] || 0) + 1;
    maybeDropDrone(e);
    burst(e.x, e.y, e.tint, e.isBoss ? 60 : 16, { speed: e.isBoss ? 320 : 180, life: 0.9, gravity: 120, glow: e.isBoss });
    gainXp(C.enemyXp(e.dungeon) * (e.isBoss ? 12 : 1));
    state.gold += C.enemyGold(e.dungeon) * (e.isBoss ? 12 : 1);
    // RESOURCE SCAVENGE — kills now leak Galaxy Resources. Fuel is common;
    // iron & plasma are the rare finds (rarer, but a real grind faucet now).
    // Bosses always pay a wreck's worth of all three.
    if (!state.resources) state.resources = { fuel: 80, iron: 0, plasma: 0 };
    if (e.isBoss) {
      const z = e.dungeon || state.currentDungeon;
      state.resources.fuel += 40 + z * 4;
      state.resources.iron += 18 + z * 2;
      state.resources.plasma += 12 + Math.round(z * 1.5);
    } else if (Math.random() < 0.14) {
      const z = e.dungeon || state.currentDungeon;
      const r = Math.random();
      const kind = r < 0.45 ? 'fuel' : r < 0.78 ? 'iron' : 'plasma';
      const base = kind === 'fuel' ? 3 + z * 0.5 : kind === 'iron' ? 2 + z * 0.35 : 1.5 + z * 0.3;
      const amt = Math.max(1, Math.round(base * (0.7 + Math.random() * 0.6)));
      state.resources[kind] += amt;
      const rc = kind === 'fuel' ? '#5bc0ff' : kind === 'iron' ? '#d0a060' : '#c07bff';
      const rg = kind === 'fuel' ? '⬢' : kind === 'iron' ? '◆' : '✦';
      rt.floats.push(new E.FloatText(e.x, e.y - e.size - 14, rg + ' +' + formatNum(amt), { color: rc, size: 13, vy: -34, life: 0.8 }));
    }
    if (e.isCitadel) { citadelDown(e); if (window.UI) window.UI.syncStatsTab(); return; }

    if (e.isBoss) {
      const isSuper = !!e.isSuper;
      rt.boss = null; rt.bossAlive = false; rt.superBossAlive = false; rt.lastBoss = rt.time;
      rt.bossTimer = rt.bossInit = 600 + Math.random() * 300; // reset 10–15 min
      bossLoot(e, isSuper);
      // BLUEPRINT: this zone's boss may hold the schematics for a hull.
      grantBlueprintFor(state.currentDungeon);
      if (window.UI) { window.UI.bossEvent(isSuper ? 'superdown' : 'down'); window.UI.syncStatsTab(); }
      return;
    }

    // normal kill: free node + start respawn timer; kills hasten the boss
    if (e.node) { e.node.enemy = null; e.node.respawnT = RESPAWN_SEC / (rt.tileRespawnMult || 1); }
    if (!rt.bossAlive) rt.bossTimer = Math.max(0, rt.bossTimer - 4);
    if (Math.random() < C.dropChance(state.currentDungeon)) {
      const _q = lootQ();
      const item = _q > 1 ? I.generate(state.currentDungeon, rollRarityBoosted(state.currentDungeon, _q)) : I.generate(state.currentDungeon);
      state.itemsFound++;
      lootBurst(e.x, e.y, item.rarity);
      rt.ground.push(new E.GroundItem(e.x, e.y, item, false));
      if (window.UI) window.UI.onLoot(item, true);
    }
    if (window.UI) window.UI.syncStatsTab();
  }

  // ---- BOSS ----------------------------------------------------------------
  // ---- CARGO HOLD (inventory cap) ------------------------------------------
  // 100 slots to start. Each +100 expansion costs exponentially more gold —
  // deep hoarding is a luxury you grind for. When the hold is full, new loot
  // pickups are auto-scrapped into Galaxy Resources (with a periodic warning).
  const INV_BASE_CAP = 100, INV_STEP = 100, INV_COST_BASE = 10e6, INV_COST_MULT = 25;
  function invCap() { return INV_BASE_CAP + (state.invSlotsBought || 0) * INV_STEP; }
  function invSlotCost() { return Math.floor(INV_COST_BASE * Math.pow(INV_COST_MULT, state.invSlotsBought || 0)); }
  function buyInvSlots() {
    const c = invSlotCost();
    if (state.gold < c) return { ok: false, reason: 'gold' };
    state.gold -= c;
    state.invSlotsBought = (state.invSlotsBought || 0) + 1;
    save(); if (window.UI) window.UI.refreshAll();
    return { ok: true, cap: invCap() };
  }
  function addToInventory(item) {
    if (state.inventory.length >= invCap()) {
      addSalvage(item); // full hold → the item is scrapped for resources
      if (window.UI && window.UI.lootScrapped) window.UI.lootScrapped(item);
      if (window.UI && (!rt.cargoWarnT || rt.time - rt.cargoWarnT > 8)) {
        rt.cargoWarnT = rt.time;
        window.UI.unlockToast('⚠ Cargo full (' + invCap() + ') — loot auto-scrapped. Expand the hold in Loot.');
      }
      return false;
    }
    state.inventory.push(item);
    return true;
  }

  function spawnBoss(opts) {
    opts = opts || {};
    const pool = allowedEnemies();
    const type = pool[pool.length - 1]; // toughest type available
    const m = 40, side = (Math.random() * 4) | 0;
    let x, y;
    if (side === 0) { x = Math.random() * rt.worldW; y = m; }
    else if (side === 1) { x = rt.worldW - m; y = Math.random() * rt.worldH; }
    else if (side === 2) { x = Math.random() * rt.worldW; y = rt.worldH - m; }
    else { x = m; y = Math.random() * rt.worldH; }
    // SUPER BOSS: forced via opts.super, else a zone-scaled chance (harder zones
    // breed Super Bosses more often). A far bigger, red-pulsing premium elite.
    const isSuper = opts.super != null ? opts.super
      : (Math.random() < Math.min(0.45, 0.12 + state.currentDungeon * 0.004));
    const b = new E.Enemy(type, state.currentDungeon, x, y);
    b.isBoss = true; b.isSuper = isSuper;
    // base enemy HP is now grind-tuned (6x), so boss multipliers come DOWN to
    // keep boss fights long-but-fair rather than endless
    b.maxHp *= isSuper ? 16 : 8; b.hp = b.maxHp;
    b.damage *= isSuper ? 3.0 : 2.3;
    b.size *= isSuper ? 3.1 : 2.5;
    b.speed *= 0.72;
    b.name = isSuper ? ('SUPER ' + type.name + ' Prime') : (type.name + ' Alpha');
    rt.enemies.push(b); rt.boss = b; rt.bossAlive = true; rt.superBossAlive = isSuper;
    burst(x, y, isSuper ? '#ff2a4a' : '#e23b4e', isSuper ? 90 : 50, { speed: isSuper ? 360 : 280, life: 1.1, glow: true });
    if (window.UI) window.UI.bossEvent(isSuper ? 'super' : 'spawn');
    return b;
  }
  function getBossInfo() {
    if (rt.bossAlive && rt.boss) return { alive: true, hp: rt.boss.hp, max: rt.boss.maxHp, name: rt.boss.name };
    const prog = rt.bossInit > 0 ? Math.max(0, Math.min(1, 1 - rt.bossTimer / rt.bossInit)) : 0;
    return { alive: false, progress: prog, timeLeft: Math.max(0, Math.ceil(rt.bossTimer)) };
  }

  // --------------------------------------------------------------------------
  // DEATH PENALTY — drop 1 item, lost forever
  // --------------------------------------------------------------------------
  function dropOnDeath() {
    const pool = [];
    C.SLOT_KEYS.forEach((s) => { if (state.equipped[s]) pool.push({ from: 'eq', slot: s, item: state.equipped[s] }); });
    state.inventory.forEach((it) => pool.push({ from: 'inv', item: it }));
    if (!pool.length) return null;
    const pick = pool[(Math.random() * pool.length) | 0];
    if (pick.from === 'eq') { state.equipped[pick.slot] = null; refreshStats(); }
    else { const idx = state.inventory.indexOf(pick.item); if (idx >= 0) state.inventory.splice(idx, 1); }
    state.itemsLost++;
    // visible "lost" marker on the ground that can't be collected
    rt.ground.push(new E.GroundItem(rt.archer.x + (Math.random()-0.5)*20, rt.archer.y + 10, pick.item, true));
    burst(rt.archer.x, rt.archer.y, '#888', 14, { speed: 120, life: 0.8 });
    return pick.item;
  }

  // --------------------------------------------------------------------------
  // PARTICLES
  // --------------------------------------------------------------------------
  function burst(x, y, color, n, opts = {}) {
    const speed = opts.speed ?? 140;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = speed * (0.3 + Math.random() * 0.7);
      rt.particles.push(new E.Particle(x, y, { vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: (opts.life ?? 0.6)*(0.6+Math.random()*0.5), size: opts.size ?? (2+Math.random()*2.5), color, gravity: opts.gravity ?? 0, glow: opts.glow ?? false }));
    }
  }
  // ---- pickup filter / auto-sell helpers ------------------------------------
  function autoSellTier() { return state.autoSellTier == null ? -1 : state.autoSellTier; }
  // Would this drop upgrade ANY of the flagship's slots for its base type?
  function isPickupUpgrade(item) {
    const targets = slotsForBase(item.slot);
    if (!targets.length) return false;
    let weakest = Infinity, empty = false;
    targets.forEach((t) => { const e = state.equipped[t]; if (!e) empty = true; else weakest = Math.min(weakest, I.itemPower(e)); });
    return empty || I.itemPower(item) > weakest;
  }

  function lootBurst(x, y, rarity) {
    const col = C.RARITY[rarity].color;
    burst(x, y, col, 10 + rarity * 3, { speed: 120, life: 0.9, glow: rarity >= 2, gravity: -40 });
  }
  // Boss drop table. A normal boss pays ~5× quality across 5 drops; a SUPER BOSS
  // rolls the rarity ~25× (keep-best), drops 12 items with a couple guaranteed
  // Legendary+, and pays out a Galaxy-Resource bounty.
  function bossLoot(e, isSuper) {
    const zone = state.currentDungeon;
    const drops = isSuper ? 12 : 5;
    const qMul = Math.min(50, qualityMult(zone) * (rt.tileLoot || 1) * (isSuper ? 25 : 1));
    const rcap = Math.min(10, C.rarityCap(zone) + 1); // bosses beat the zone cap by ONE tier, never more
    for (let i = 0; i < drops; i++) {
      const base = rollRarityBoosted(zone, qMul);
      let boosted = Math.min(rcap, base + (isSuper ? 5 : 3) + ((Math.random() * 2) | 0));
      if (isSuper && i < 2) boosted = Math.max(boosted, Math.min(rcap, 4)); // guarantee Legendary+ where the zone allows
      const item = I.generate(zone, boosted);
      state.itemsFound++;
      const a = Math.PI * 2 * (i / drops), r = 26 + Math.random() * 26;
      rt.ground.push(new E.GroundItem(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r, item, false));
      lootBurst(e.x, e.y, item.rarity);
      if (window.UI) window.UI.onLoot(item, true);
    }
    if (isSuper) {
      if (!state.resources) state.resources = { fuel: 80, iron: 0, plasma: 0 };
      const fuel = 200 + zone * 30, iron = 80 + zone * 12, plasma = 50 + zone * 10;
      state.resources.fuel += fuel; state.resources.iron += iron; state.resources.plasma += plasma;
      if (window.UI) window.UI.unlockToast('Super Boss bounty · +' + formatNum(fuel) + ' fuel · +' + formatNum(iron) + ' iron · +' + formatNum(plasma) + ' plasma');
    }
  }

  // --------------------------------------------------------------------------
  // MOVEMENT / AI
  // --------------------------------------------------------------------------
  function moveToward(tx, ty, dt, speed, stopDist) {
    const a = rt.archer;
    const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy) || 1;
    if (stopDist && d <= stopDist) return false;
    a.x += (dx / d) * speed * dt;
    a.y += (dy / d) * speed * dt;
    return true;
  }
  function autopilot(dt) {
    const a = rt.archer, s = rt.stats, sp = s.moveSpeedPx;
    // 1) collect any ground loot first (the "pick everything up" promise)
    // distant drops only — anything inside magnet range flies to the ship on
    // its own, so the operator keeps fighting instead of fetching every pickup.
    const loot = rt.ground.filter((g) => !g.lost && !g.dead && Math.hypot(g.x - a.x, g.y - a.y) > MAGNET_RADIUS * 0.9);
    if (loot.length) {
      loot.sort((g, h) => ((g.x-a.x)**2+(g.y-a.y)**2)-((h.x-a.x)**2+(h.y-a.y)**2));
      moveToward(loot[0].x, loot[0].y, dt, sp);
      return;
    }
    // 2) low health → kite away from the nearest threat
    const threat = nearestEnemy();
    if (threat && a.hp < s.maxHp * 0.3) {
      const dx = a.x - threat.x, dy = a.y - threat.y, d = Math.hypot(dx, dy) || 1;
      a.x = Math.max(20, Math.min(rt.worldW-20, a.x + (dx/d) * sp * dt));
      a.y = Math.max(20, Math.min(rt.worldH-20, a.y + (dy/d) * sp * dt));
      return;
    }
    // 3) approach nearest enemy to a comfortable firing distance, then hold
    if (threat) { moveToward(threat.x, threat.y, dt, sp, FIRE_RANGE * 0.62); return; }
    // 4) nothing around → drift toward the nearest pending spawn node
    let node = null, bd = Infinity;
    for (const n of rt.nodes) { const d = (n.x-a.x)**2+(n.y-a.y)**2; if (d < bd) { bd = d; node = n; } }
    if (node) moveToward(node.x, node.y, dt, sp, 40);
  }
  function manualMove(dt) {
    const a = rt.archer, sp = rt.stats.moveSpeedPx;
    if (rt.joy.active && (rt.joy.x || rt.joy.y)) {
      a.x += rt.joy.x * sp * dt;
      a.y += rt.joy.y * sp * dt;
    }
  }

  // --------------------------------------------------------------------------
  // GAME LOOP
  // --------------------------------------------------------------------------
  function step(now) {
    let dt = (now - rt.last) / 1000; rt.last = now;
    if (dt > 0.05) dt = 0.05; if (dt < 0) dt = 0;
    const steps = Math.max(1, state.gameSpeed | 0);
    for (let i = 0; i < steps; i++) { rt.time += dt; state.playTime += dt; update(dt); }
    draw();
  }
  function loop(now) { if (!rt.running) return; step(now); requestAnimationFrame(loop); }

  function update(dt) {
    const a = rt.archer;
    // when downed, freeze everything until the player picks a respawn zone
    if (rt.awaitingRespawn) { a.update(dt); return; }
    a.update(dt);

    // movement
    if (!a.dead) {
      if (state.auto) autopilot(dt); else manualMove(dt);
      a.x = Math.max(16, Math.min(rt.worldW - 16, a.x));
      a.y = Math.max(16, Math.min(rt.worldH - 16, a.y));
    }

    // hp regen
    if (!a.dead && a.hp < rt.stats.maxHp) a.hp = Math.min(rt.stats.maxHp, a.hp + rt.stats.maxHp * C.ARENA.regenPerSec * dt);

    // camera follows player (account for zoom — lower zoom shows more world)
    const z = rt.zoom || 1, visW = rt.w / z, visH = rt.h / z;
    rt.cam.x = rt.worldW <= visW ? (rt.worldW - visW) / 2 : Math.max(0, Math.min(rt.worldW - visW, a.x - visW / 2));
    rt.cam.y = rt.worldH <= visH ? (rt.worldH - visH) / 2 : Math.max(0, Math.min(rt.worldH - visH, a.y - visH / 2));

    // spawn nodes / siege waves
    if (rt.siege && rt.siege.active) {
      updateSiege(dt);
    } else if (rt.waves && rt.waves.active) {
      updateWaveZone(dt);
    } else {
      updateNodes(dt);
      // boss meter: ticks down; kills hasten it (see onKill). Never more than once
      // per 5 min. When it hits 0 and the cooldown has elapsed, the boss spawns.
      if (state.currentDungeon >= 1 && !rt.bossAlive) {
        rt.bossTimer -= dt;
        if (rt.bossTimer <= 0 && (rt.time - rt.lastBoss) >= 300) spawnBoss();
        else if (rt.bossTimer < 0) rt.bossTimer = 0;
      }
    }
    // SUPER BOSS aura — pulsing red motes around the elite while it lives.
    if (rt.warpT > 0) rt.warpT -= dt;
    if (rt.novaT > 0) rt.novaT -= dt;
    // post-capture tow: count down, then return the player to the hangar
    if (rt.towT > 0) {
      rt.towT -= dt;
      if (rt.towT <= 0) {
        rt.towT = 0;
        if (state.currentDungeon >= 1) { respawnAt(0); if (window.UI) window.UI.siegeEvent('towhome', {}); }
      }
    }
    if (rt.superBossAlive && rt.boss && !rt.boss.dying && Math.random() < 0.6) {
      const b = rt.boss, aa = Math.random() * Math.PI * 2, rr = b.size * (1.1 + Math.random() * 0.5);
      rt.particles.push(new E.Particle(b.x + Math.cos(aa) * rr, b.y + Math.sin(aa) * rr, { vx: Math.cos(aa) * 30, vy: Math.sin(aa) * 30 - 12, life: 0.5, size: 2 + Math.random() * 2.4, color: '#ff2a4a', glow: true, drag: 0.9 }));
    }

    // auto-fire nearest enemy in range
    a.attackTimer -= dt;
    if (!a.dead && a.attackTimer <= 0) {
      const tgt = nearestEnemy(rt.stats.fireRange || FIRE_RANGE);
      if (tgt) { fire(tgt); a.attackTimer = 1 / Math.max(0.1, rt.stats.attacksPerSec); }
    }

    // enemies
    for (const e of rt.enemies) {
      e.update(dt, a);
      if (e.fireReq) { e.fireReq = false; enemyFire(e); }
      // citadel battle damage — embers & smoke pour out as it degrades
      if (e.isCitadel && !e.dying) {
        const f = e.hp / e.maxHp;
        if (f < 0.75 && Math.random() < dt * (f < 0.25 ? 14 : f < 0.5 ? 8 : 4)) {
          const a2 = Math.random() * 7, r2 = e.size * (0.3 + Math.random() * 0.6);
          rt.particles.push(new E.Particle(e.x + Math.cos(a2) * r2, e.y + Math.sin(a2) * r2 * 0.7, { vx: (Math.random() - 0.5) * 30, vy: -40 - Math.random() * 50, life: 0.5 + Math.random() * 0.4, size: 2 + Math.random() * 2.5, color: Math.random() < 0.6 ? '#ff9a50' : 'rgba(120,120,125,0.5)', glow: Math.random() < 0.5, drag: 0.94 }));
        }
      }
    }
    separateEnemies();
    rt.enemies = rt.enemies.filter((e) => !e.dead);
    updateEbolts(dt);

    // carrier drones: orbit the ship and fire on nearby enemies
    updateDrones(dt);
    // FLEET escorts: formation flight, escort fire, Warden support pulses
    updateEscorts(dt);

    // death handling — drop a piece of gear, then auto-tow back to the hangar
    if (a.justDied) {
      a.justDied = false;
      const killer = a.killer;
      const killerName = killer ? (killer.isBoss ? killer.name : killer.type.name) : 'the swarm';
      const diedZone = state.currentDungeon;
      const lost = dropOnDeath();
      if (rt.deepDeath) dropOnDeath(); // deep space: a second item is lost on death
      // a carrier loses one drone when the hull is downed
      if (state.drones > 0) { state.drones--; spawnDrones(); }
      rt.siege = null; rt.waves = null; // abort any in-progress siege / wave gauntlet
      burst(a.x, a.y, '#e23b4e', 30, { speed: 200, life: 0.9 });
      // no respawn menu — redeploy straight to the home hangar
      respawnAt(0);
      if (window.UI) window.UI.onDeathReturn(lost, killerName, diedZone);
    }

    // projectiles
    for (const p of rt.projectiles) { p.update(dt); if (p.hit) resolveHit(p); }
    rt.projectiles = rt.projectiles.filter((p) => !p.dead);

    // ground loot pickups + LOOT MAGNET: drops within range fly toward the
    // player (accelerating as they near) and are collected on contact.
    for (const g of rt.ground) {
      g.update(dt);
      if (!g.lost && !g.picked && !g.dead && !a.dead) {
        const dx = a.x - g.x, dy = a.y - g.y, d = Math.hypot(dx, dy) || 1;
        if (d <= PICKUP_RADIUS) collect(g);
        else if (d <= MAGNET_RADIUS) {
          const k = 1 - d / MAGNET_RADIUS;            // 0 at edge → 1 near player
          const pull = MAGNET_SPEED * (0.5 + k * 2.5);
          g.x += (dx / d) * pull * dt;
          g.y += (dy / d) * pull * dt;
          g.magnet = true;
        }
      }
    }
    rt.ground = rt.ground.filter((g) => !g.dead);
    if (rt.ground.length > 60) rt.ground.splice(0, rt.ground.length - 60);

    // particles + floats (hard caps to bound per-frame draw cost)
    for (const p of rt.particles) p.update(dt); rt.particles = rt.particles.filter((p) => !p.dead);
    if (rt.particles.length > 320) rt.particles.splice(0, rt.particles.length - 320);
    for (const f of rt.floats) f.update(dt); rt.floats = rt.floats.filter((f) => !f.dead);
    if (rt.floats.length > 60) rt.floats.splice(0, rt.floats.length - 60);

    // dps
    rt.dmgWindow = rt.dmgWindow.filter((d) => rt.time - d.t < 2);
    rt.dps = rt.dmgWindow.reduce((s, d) => s + d.dmg, 0) / 2;
  }

  function collect(g) {
    g.picked = true; g.dead = true;
    const item = g.item;
    // PICKUP FILTER: drops below the player's chosen rarity floor never enter
    // the bag — they're instantly scrapped into Galaxy Resources on contact.
    // (An empty slot still equips anything: never scrap gear you NEED.)
    const minR = state.pickupFilter || 0;
    if (!state.equipped[item.slot]) { state.equipped[item.slot] = item; refreshStats(); }
    else if (item.rarity < minR) {
      addSalvage(item);
      rt.floats.push(new E.FloatText(g.x, g.y - 10, '⚒ scrapped', { color: '#8a97ab', size: 11, vy: -36, life: 0.6 }));
      return;
    }
    else if (autoSellTier() >= 0 && item.rarity <= autoSellTier() && !isPickupUpgrade(item)) {
      // AUTO-SELL (default off): low-tier pickups convert straight to gold +
      // salvage. Anything that would upgrade an equipped slot is always kept.
      const gold = C.sellValue(item);
      state.gold += gold; addSalvage(item);
      rt.floats.push(new E.FloatText(g.x, g.y - 10, '+$' + formatNum(gold), { color: '#e6b566', size: 12, vy: -38, life: 0.7 }));
      return;
    }
    else { addToInventory(item); if (state.autoEquipAlways) autoEquip(true); }
    burst(g.x, g.y, C.RARITY[item.rarity].color, 10, { speed: 130, life: 0.6, glow: item.rarity >= 2 });
    rt.floats.push(new E.FloatText(g.x, g.y - 12, '+1', { color: C.RARITY[item.rarity].color, size: 16, vy: -50, life: 0.8 }));
    if (window.UI) window.UI.onCollect(item);
  }

  function separateEnemies() {
    const list = rt.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i]; if (a.dying || a.spawnT < 0.5) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]; if (b.dying || b.spawnT < 0.5) continue;
        const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy) || 0.01, min = a.size + b.size;
        if (dist < min) { const push = (min - dist) * 0.5, ux = dx/dist, uy = dy/dist; a.x -= ux*push; a.y -= uy*push; b.x += ux*push; b.y += uy*push; }
      }
    }
  }

  // --------------------------------------------------------------------------
  // RENDER
  // --------------------------------------------------------------------------
  function draw() {
    const { ctx, w, h } = rt;
    ctx.clearRect(0, 0, w, h);
    // HOME HANGAR (Safe Zone): docked-ship bay scene instead of the space arena
    if (state.currentDungeon < 1) {
      drawHangarScene();
      drawPortrait();
      if (window.UI) window.UI.syncHUD();
      return;
    }
    ctx.save();
    const z = rt.zoom || 1;
    const shx = rt.shake ? (Math.random()-0.5)*rt.shake : 0, shy = rt.shake ? (Math.random()-0.5)*rt.shake : 0;
    if (rt.shake) rt.shake *= 0.85; if (rt.shake < 0.3) rt.shake = 0;
    ctx.scale(z, z);
    ctx.translate(-rt.cam.x + shx, -rt.cam.y + shy);
    R.drawArena(ctx, rt.worldW, rt.worldH, rt.time, state.currentDungeon);
    // spawn-node markers (pending respawns)
    for (const n of rt.nodes) {
      if (!n.enemy && n.respawnT > 0) {
        const k = 1 - n.respawnT / RESPAWN_SEC;
        ctx.strokeStyle = `rgba(226,59,78,${0.25 + k*0.4})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(n.x, n.y, 6 + (1-k)*10, 0, 7); ctx.stroke();
      }
    }
    for (const p of rt.particles) R.drawParticle(ctx, p);
    drawGround(ctx);
    for (const e of rt.enemies) R.drawEnemy(ctx, e);
    for (const es of (rt.escorts || [])) R.drawEscort(ctx, es.key, es.x, es.y, rt.time, es.heal);
    R.drawArcher(ctx, rt.archer.x, rt.archer.y, 1.5, rt.archer, state.equipped, rt.time);
    for (const dr of rt.drones) R.drawDrone(ctx, dr.x, dr.y, rt.time, dr.ang);
    for (const p of rt.projectiles) R.drawArrow(ctx, p);
    for (const b of rt.ebolts) R.drawEnemyBolt(ctx, b);
    for (const f of rt.floats) R.drawFloat(ctx, f);
    ctx.restore();

    if (rt.archer.dead) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0,0,w,h);
      ctx.fillStyle = '#e23b4e'; ctx.font = '700 28px Cinzel, serif'; ctx.textAlign = 'center';
      ctx.fillText('DOWN', w/2, h/2 - 4);
      ctx.font = '600 14px Rajdhani'; ctx.fillStyle = '#ce9b78';
      ctx.fillText('Choose a zone to redeploy', w/2, h/2 + 22);
    }
    // LOW HP: red danger vignette breathes at the edges when hull is critical.
    if (!rt.archer.dead && rt.stats && rt.stats.maxHp > 0) {
      const hpPct = rt.archer.hp / rt.stats.maxHp;
      if (hpPct < 0.3) {
        const sev = (0.3 - hpPct) / 0.3;                       // 0 → 1 as HP falls
        const pa = sev * (0.16 + 0.1 * Math.sin(rt.time * 6));
        const dg = ctx.createRadialGradient(w/2, h/2, Math.min(w,h)*0.34, w/2, h/2, Math.max(w,h)*0.6);
        dg.addColorStop(0, 'rgba(255,30,50,0)');
        dg.addColorStop(1, 'rgba(255,30,50,' + Math.max(0, pa).toFixed(3) + ')');
        ctx.fillStyle = dg; ctx.fillRect(0, 0, w, h);
      }
    }
    // SUPERNOVA flash — the citadel's death blooms white across the zone
    if (rt.novaT > 0) {
      ctx.globalAlpha = Math.min(1, rt.novaT / 0.6) * 0.9;
      ctx.fillStyle = '#fff4da'; ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
    // HYPERSPACE WARP-IN — radial streaks collapse as the zone resolves
    if (rt.warpT > 0) {
      const k = Math.max(0, rt.warpT / 0.85);            // 1 → 0
      const cx2 = w / 2, cy2 = h / 2, R0 = Math.max(w, h);
      ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = '#cfe8ff';
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2 + (i % 5) * 0.07;
        const r1 = 26 + (1 - k) * R0 * 0.72;
        const r2 = r1 + 36 + 110 * k;
        ctx.globalAlpha = Math.min(1, k * 1.3) * (0.3 + (i % 3) * 0.22);
        ctx.lineWidth = 1 + (i % 3);
        ctx.beginPath(); ctx.moveTo(cx2 + Math.cos(a) * r1, cy2 + Math.sin(a) * r1);
        ctx.lineTo(cx2 + Math.cos(a) * r2, cy2 + Math.sin(a) * r2); ctx.stroke();
      }
      ctx.globalAlpha = k * 0.45; ctx.fillStyle = '#eaf6ff';
      ctx.beginPath(); ctx.arc(cx2, cy2, 46 * k, 0, 7); ctx.fill();
      ctx.restore(); ctx.globalAlpha = 1;
    }
    // SUPER BOSS: the whole zone pulses red at the edges while one is loose.
    if (rt.superBossAlive) {
      const pa = 0.12 + 0.10 * Math.sin(rt.time * 5);
      const g = ctx.createRadialGradient(w/2, h/2, Math.min(w,h)*0.28, w/2, h/2, Math.max(w,h)*0.62);
      g.addColorStop(0, 'rgba(255,42,74,0)');
      g.addColorStop(1, 'rgba(255,42,74,' + pa.toFixed(3) + ')');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    drawMinimap(ctx);
    drawPortrait();
    // SELF-HEAL: if the canvas ever measures 0 (e.g. it was sized while hidden
    // behind an overlay), re-fit it — don't wait for a window resize.
    if ((rt.canvas.height === 0 || rt.canvas.width === 0) && rt.canvas.offsetHeight > 0) resize();
    // HUD DOM writes are throttled — canvas runs at 60fps, text at ~8Hz
    if (window.UI && (!rt._hudT || rt.time - rt._hudT > 0.12)) { rt._hudT = rt.time; window.UI.syncHUD(); }
  }

  function drawHangarScene() {
    const { ctx, w, h } = rt;
    const owned = C.SHIPS.filter((s) => state.ownedShips[s.key]);
    let ships = owned.map((s) => ({
      key: s.key, name: s.name, tier: R.shipVisTier(s.key),
      equipped: s.key === state.ship ? state.equipped : (state.fittings[s.key] || {}),
    }));
    if (!ships.length) {
      const s = C.SHIP_BY_KEY[state.ship] || C.SHIPS[0];
      ships = [{ key: s.key, name: s.name, tier: R.shipVisTier(s.key), equipped: state.equipped }];
    }
    rt.hangarHits = R.drawHangar(ctx, w, h, rt.time, ships, state.ship);
  }

  function drawGround(ctx) {
    for (const g of rt.ground) {
      const it = g.item;
      const col = g.lost ? '#777' : (it ? C.RARITY[it.rarity].color : '#999');
      const yoff = Math.sin(g.bob) * 3;
      const sc = 0.5 + 0.5 * (g.spawnT);
      // glow puck
      const fade = g.lost ? Math.min(1, g.life / 1.5) : (g.life < 5 ? g.life / 5 : 1);
      ctx.globalAlpha = fade;
      ctx.fillStyle = `rgba(0,0,0,0.3)`; ctx.beginPath(); ctx.ellipse(g.x, g.y + 8, 11*sc, 4*sc, 0, 0, 7); ctx.fill();
      // GLOW scales with rarity — layered alpha discs (no shadowBlur: this path
      // runs for every ground drop, every frame). Mythic+ pulses with a halo.
      const tier = it ? it.rarity : 0;
      const col2 = g.lost ? 'rgba(140,140,140,0.5)' : col;
      if (!g.lost) {
        const pulse = tier >= 5 ? (0.7 + 0.3 * Math.sin(rt.time * 6 + g.bob * 2)) : 1;
        ctx.globalAlpha = fade * (0.22 + tier * 0.05) * pulse;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(g.x, g.y - 2 + yoff, (9 + tier * 1.6) * sc, 0, 7); ctx.fill();
        ctx.globalAlpha = fade;
        if (tier >= 5) {
          const haloR = (12 + tier * 2) * sc * (0.85 + 0.25 * Math.sin(rt.time * 6 + g.bob * 2));
          ctx.globalAlpha = fade * 0.5;
          ctx.strokeStyle = col; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(g.x, g.y - 2 + yoff, haloR, 0, 7); ctx.stroke();
          ctx.globalAlpha = fade;
        }
      }
      ctx.fillStyle = col2;
      ctx.beginPath(); ctx.arc(g.x, g.y - 2 + yoff, (6 + tier * 0.5) * sc, 0, 7); ctx.fill();
      // light beam — taller & brighter the rarer the drop (Rare and up)
      if (!g.lost && it && tier >= 2) {
        const bh = 30 + tier * 6, bw = (4 + tier * 0.7) * sc;
        ctx.fillStyle = hexToRgba(col, 0.10 + tier * 0.025);
        ctx.fillRect(g.x - bw / 2, g.y - (bh - 8) + yoff, bw, bh);
      }
      if (g.lost) {
        ctx.fillStyle = 'rgba(255,90,90,' + fade + ')'; ctx.font = '700 11px Rajdhani'; ctx.textAlign = 'center';
        ctx.fillText('LOST', g.x, g.y - 16 + yoff);
      }
      ctx.globalAlpha = 1;
    }
  }
  function hexToRgba(c, a) { const m = c[0]==='#'? [parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16)] : c.match(/\d+/g).map(Number); return `rgba(${m[0]},${m[1]},${m[2]},${a})`; }

  function drawMinimap(ctx) {
    if (state.currentDungeon < 1) return; // no map in the safe staging zone
    const mw = 78, mh = 78 * (rt.worldH / rt.worldW), pad = 10;
    const mx = rt.w - mw - pad, my = pad;
    const rad = 8;
    ctx.save();
    // rounded dark panel
    ctx.beginPath();
    ctx.moveTo(mx + rad, my);
    ctx.arcTo(mx + mw, my, mx + mw, my + mh, rad);
    ctx.arcTo(mx + mw, my + mh, mx, my + mh, rad);
    ctx.arcTo(mx, my + mh, mx, my, rad);
    ctx.arcTo(mx, my, mx + mw, my, rad);
    ctx.closePath();
    ctx.fillStyle = 'rgba(16,18,26,0.62)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.clip();
    const sx = mw / rt.worldW, sy = mh / rt.worldH;
    // enemies
    for (const e of rt.enemies) { if (e.dying) continue; ctx.fillStyle = e.isBoss ? '#ffd24d' : '#ff6a78'; ctx.fillRect(mx + e.x*sx - 1, my + e.y*sy - 1, e.isBoss ? 4 : 2.5, e.isBoss ? 4 : 2.5); }
    // loot
    for (const g of rt.ground) { if (g.lost || g.dead) continue; ctx.fillStyle = C.RARITY[g.item.rarity].color; ctx.fillRect(mx + g.x*sx - 1, my + g.y*sy - 1, 2.5, 2.5); }
    // player
    ctx.fillStyle = '#5b9cff'; ctx.shadowColor = '#5b9cff'; ctx.shadowBlur = 5;
    ctx.beginPath(); ctx.arc(mx + rt.archer.x*sx, my + rt.archer.y*sy, 2.8, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
    // viewport rect
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.strokeRect(mx + rt.cam.x*sx, my + rt.cam.y*sy, (rt.w/(rt.zoom||1))*sx, (rt.h/(rt.zoom||1))*sy);
    ctx.restore();
  }

  function drawPortrait() {
    if (!rt.portraitCtx) return;
    const ctx = rt.portraitCtx, cw = rt.portW, ch = rt.portH;
    ctx.clearRect(0, 0, cw, ch);
    const esc = fleetShips();
    const cy = ch * 0.55;
    // escorts flank SYMMETRICALLY for the actual count (odd counts center the
    // extra ship high behind the flagship) — all positions stay within ±0.36·cw
    // so nothing clips the frame edges
    const FORMS = {
      1: [[0.34, 0.10]],
      2: [[-0.34, 0.10], [0.34, 0.10]],
      3: [[-0.36, 0.10], [0.36, 0.10], [0, -0.18]],
      4: [[-0.36, 0.10], [0.36, 0.10], [-0.20, -0.17], [0.20, -0.17]],
    };
    const fx = FORMS[Math.min(4, esc.length)] || [];
    esc.forEach((sh, i) => {
      if (!fx[i] || !R.drawEscort) return;
      ctx.save();
      ctx.translate(cw / 2 + fx[i][0] * cw, cy + fx[i][1] * ch);
      ctx.scale(1.55, 1.55);
      R.drawEscort(ctx, sh.key, 0, 0, rt.time, 0);
      ctx.restore();
    });
    // flagship scales down when escorts fly so everything fits the frame
    const flagScale = esc.length >= 3 ? 2.1 : esc.length ? 2.4 : 2.9;
    R.drawArcher(ctx, cw / 2, cy, flagScale, { facing: -0.35, bob: rt.time * 2.4, hurtFlash: 0, muzzle: 0, recoil: 0 }, state.equipped, rt.time);
  }

  // --------------------------------------------------------------------------
  // ACTIONS
  // --------------------------------------------------------------------------
  // Slots available on the current ship hull.
  function activeSlots() { return C.shipSlots(state.ship); }
  // Extra slots (beyond a single primary) a given base type has on this ship.
  function slotsForBase(base) { return activeSlots().filter((sk) => C.slotBase(sk) === base); }
  // True when the current ship exposes a 2nd+ slot for this base item type.
  function secondUnlocked(base) { return slotsForBase(base).length >= 2; }
  // Ship-based equipment layout for the Hero screen: one descriptor per real
  // slot the current hull exposes, with a human label ("Cannon", "2nd Cannon"…).
  function equipLayout() {
    const ORD = ['', '2nd ', '3rd ', '4th '];
    const seen = {};
    return activeSlots().map((key) => {
      const base = C.slotBase(key);
      const n = (seen[base] = (seen[base] || 0) + 1);
      const def = C.SLOTS[base];
      const multi = slotsForBase(base).length > 1;
      const label = multi ? (ORD[n - 1] || n + 'th ') + def.name : def.name;
      return { key, base, label, icon: def.icon, item: state.equipped[key] };
    });
  }

  // WARDEN ARRAYS mount ONLY on the Aegis support hull — the fleet aura is its
  // entire reason to exist. Everything else refuses the fitting.
  function canMountWeapon(item, cls) {
    if (!item || item.slot !== 'bow' || !I.weaponClassOf) return true;
    return I.weaponClassOf(item).key !== 'support' || cls === 'Aegis';
  }
  function equip(item, targetSlot) {
    const idx = state.inventory.indexOf(item); if (idx === -1) return;
    if (!canMountWeapon(item, (C.SHIP_BY_KEY[state.ship] || {}).cls)) {
      if (window.UI) window.UI.unlockToast('⚠ Warden arrays mount ONLY on the Aegis support hull');
      return false;
    }
    const base = item.slot;
    const slots = slotsForBase(base);
    if (!slots.length) return;
    const firstEmpty = () => slots.find((sk) => !state.equipped[sk]) || slots[0];
    // accept an explicit slot key, the 'primary'/'secondary' aliases, or default
    let slot;
    if (targetSlot && slots.includes(targetSlot)) slot = targetSlot;
    else if (targetSlot === 'secondary') slot = slots[1] || firstEmpty();
    else slot = firstEmpty(); // 'primary' or unspecified
    const prev = state.equipped[slot];
    state.equipped[slot] = item; state.inventory.splice(idx, 1);
    if (prev) state.inventory.push(prev);
    refreshStats(); if (window.UI) window.UI.refreshAll(); save();
  }
  // Add an item's salvage roll into the player's galaxy resources, and (if an
  // accumulator is passed) tally what was gained so the UI can report it.
  // Galaxy Resource rewards from SELLING items are boosted ×5 (spec).
  const SELL_RES_MULT = 5;
  function addSalvage(item, acc) {
    const s = C.salvage(item); if (!s) return;
    if (!state.resources) state.resources = { fuel: 80, iron: 0, plasma: 0 };
    for (const k in s) {
      const amt = s[k] * SELL_RES_MULT;
      state.resources[k] = (state.resources[k] || 0) + amt;
      if (acc) acc[k] = (acc[k] || 0) + amt;
    }
  }
  function sell(item) {
    const idx = state.inventory.indexOf(item); if (idx === -1) return null;
    const gold = C.sellValue(item);
    state.gold += gold; state.inventory.splice(idx, 1);
    const salvage = {}; addSalvage(item, salvage);
    if (window.UI) window.UI.refreshAll(); save();
    return { gold, salvage };
  }
  function sellAllBelow(rarityTier) {
    let earned = 0, n = 0; const salvage = {};
    state.inventory = state.inventory.filter((it) => { if (it.rarity < rarityTier) { earned += C.sellValue(it); addSalvage(it, salvage); n++; return false; } return true; });
    state.gold += earned; if (window.UI) window.UI.refreshAll(); save();
    return { earned, n, salvage };
  }

  // AUTO-EQUIP: maximize total power. For each base type, gather every candidate
  // (all equipped slots of that type + bag) and assign the strongest to the
  // ship's slots for that type; the rest return to the bag.
  function autoEquip(silent) {
    const slots = activeSlots();
    const snap = silent ? null : JSON.stringify(slots.map((s) => state.equipped[s] && state.equipped[s].id));
    C.SLOT_KEYS.forEach((base) => {
      const targets = slotsForBase(base);
      if (!targets.length) return;
      let pool = [];
      targets.forEach((t) => { if (state.equipped[t]) { pool.push(state.equipped[t]); state.equipped[t] = null; } });
      state.inventory = state.inventory.filter((it) => { if (it.slot === base) { pool.push(it); return false; } return true; });
      const flagCls = (C.SHIP_BY_KEY[state.ship] || {}).cls;
      pool = [...new Set(pool)];
      // Aegis-only weapons can't sit on other hulls — send them back to the bag
      const reject = pool.filter((it) => !canMountWeapon(it, flagCls));
      pool = pool.filter((it) => canMountWeapon(it, flagCls)).sort((a, b) => I.itemPower(b) - I.itemPower(a));
      reject.forEach((it) => state.inventory.push(it));
      targets.forEach((t, i) => { state.equipped[t] = pool[i] || null; });
      pool.slice(targets.length).forEach((it) => state.inventory.push(it));
    });
    // FLEET AUTO-IMPROVE: every escort's fitting upgrades from the bag too.
    // The flagship picks first; each escort then takes the next-best gear for
    // its own slot layout, so the whole fleet's loadout improves on its own.
    if (!state.fittings) state.fittings = {};
    fleetShips().forEach((sh) => {
      const fit = state.fittings[sh.key] || (state.fittings[sh.key] = {});
      const eSlots = C.shipSlots(sh.key);
      C.SLOT_KEYS.forEach((base) => {
        const targets = eSlots.filter((sk) => C.slotBase(sk) === base);
        if (!targets.length) return;
        let pool = [];
        targets.forEach((t) => { if (fit[t]) { pool.push(fit[t]); fit[t] = null; } });
        state.inventory = state.inventory.filter((it) => { if (it.slot === base) { pool.push(it); return false; } return true; });
        pool = [...new Set(pool)];
        const eReject = pool.filter((it) => !canMountWeapon(it, sh.cls));
        pool = pool.filter((it) => canMountWeapon(it, sh.cls)).sort((a, b) => I.itemPower(b) - I.itemPower(a));
        eReject.forEach((it) => state.inventory.push(it));
        targets.forEach((t, i) => { fit[t] = pool[i] || null; });
        pool.slice(targets.length).forEach((it) => state.inventory.push(it));
      });
    });
    refreshStats();
    if (silent) return 1;
    const after = JSON.stringify(slots.map((s) => state.equipped[s] && state.equipped[s].id));
    const changed = snap !== after;
    if (changed) { if (window.UI) window.UI.refreshAll(); save(); }
    return changed ? 1 : 0;
  }

  // ---- SHIPS: buy / switch (each hull keeps its own saved fitting) ---------
  // A hull unlocks once the PREVIOUS hull in the chain is owned AND you've
  // scored enough kills while piloting it. Then it can be bought with gold.
  function shipKillsFor(key) { return state.shipKills[key] || 0; }
  function hasBlueprint(key) { const s = C.SHIP_BY_KEY[key]; return !s || s.tier === 0 || !s.bpZone || !!(state.blueprints && state.blueprints[key]); }
  // Award a hull blueprint when its zone's boss is defeated (once).
  function grantBlueprintFor(zone) {
    const key = C.blueprintForZone(zone);
    if (!key) return;
    if (!state.blueprints) state.blueprints = {};
    if (state.blueprints[key]) return;
    state.blueprints[key] = true; save();
    if (window.UI) window.UI.blueprintEvent(C.SHIP_BY_KEY[key]);
  }
  function shipUnlocked(key) {
    const ship = C.SHIP_BY_KEY[key]; if (!ship) return false;
    if (ship.tier === 0) return true;
    const prev = C.shipPrevKey(key);
    return hasBlueprint(key) && !!state.ownedShips[prev] && shipKillsFor(prev) >= ship.reqKills;
  }
  // Descriptor the store uses to render each hull's state.
  function shipBuyState(key) {
    const ship = C.SHIP_BY_KEY[key];
    const owned = !!state.ownedShips[key];
    const active = state.ship === key;
    const prev = C.shipPrevKey(key);
    const have = prev ? shipKillsFor(prev) : 0;
    const need = ship.reqKills || 0;
    const bp = hasBlueprint(key);
    const prevOwned = ship.tier === 0 || !!state.ownedShips[prev];
    const killsMet = have >= need;
    const unlocked = bp && prevOwned && killsMet;
    const resAfford = ship.resPrice ? canAfford(ship.resPrice) : null;
    return { key, owned, active, unlocked,
             affordable: ship.resPrice ? resAfford : state.gold >= ship.price,
             resPrice: ship.resPrice || null, resAfford,
             hasBlueprint: bp, bpZone: ship.bpZone, prevKey: prev, prevOwned,
             killsHave: have, killsNeed: need, killsMet, price: ship.price };
  }
  function buyShip(key) {
    const ship = C.SHIP_BY_KEY[key];
    if (!ship || state.ownedShips[key]) return { ok: false, reason: 'owned' };
    if (!shipUnlocked(key)) return { ok: false, reason: 'locked' };
    // MOTHERSHIP & any resPrice hull: paid in Galaxy Resources, not gold.
    if (ship.resPrice) {
      if (!canAfford(ship.resPrice)) return { ok: false, reason: 'resources' };
      state.resources.fuel -= ship.resPrice.fuel || 0;
      state.resources.iron -= ship.resPrice.iron || 0;
      state.resources.plasma -= ship.resPrice.plasma || 0;
    } else {
      if (state.gold < ship.price) return { ok: false, reason: 'gold' };
      state.gold -= ship.price;
    }
    state.ownedShips[key] = true;
    if (state.shipKills[key] == null) state.shipKills[key] = 0;
    save();
    if (window.UI) window.UI.refreshAll();
    return { ok: true };
  }
  // Directly grant a hull (used by the secret Mothership unlock). Marks it owned,
  // recovers its blueprint, and seeds its kill counter so it shows as a fully
  // unlocked, switchable ship in the hangar.
  function grantShip(key) {
    const ship = C.SHIP_BY_KEY[key];
    if (!ship || state.ownedShips[key]) return false;
    state.ownedShips[key] = true;
    if (state.shipKills[key] == null) state.shipKills[key] = 0;
    if (ship.bpZone != null) { if (!state.blueprints) state.blueprints = {}; state.blueprints[key] = true; }
    save();
    if (window.UI) window.UI.refreshAll();
    return true;
  }
  function switchShip(key) {
    if (!state.ownedShips[key] || key === state.ship) return false;
    // stash current fitting, then load (or init) the target ship's fitting
    state.fittings[state.ship] = state.equipped;
    const next = state.fittings[key] || {};
    const fit = {};
    C.shipSlots(key).forEach((sk) => { fit[sk] = next[sk] || null; });
    // any gear that no longer fits the new hull's slots goes back to the bag
    Object.keys(next).forEach((sk) => { if (next[sk] && !(sk in fit)) state.inventory.push(next[sk]); });
    state.equipped = fit;
    state.ship = key;
    // the new flagship can't also fly as an escort — free its fleet slot
    if (state.fleet) state.fleet = state.fleet.map((k) => (k === key ? null : k));
    if (state.shipKills[key] == null) state.shipKills[key] = 0;
    if (state.autoEquipAlways) autoEquip(true);
    refreshStats(); spawnDrones();
    if (window.UI) window.UI.refreshAll(); save();
    return true;
  }
  function shipDroneCount() { const s = C.SHIP_BY_KEY[state.ship]; return s ? (s.drones || 0) : 0; }

  // ---- DRONES (carrier bays) -----------------------------------------------
  // Clamp the loaded-drone count to the active hull's bay capacity, then
  // (re)build the orbiting drone objects, preserving existing orbit phases.
  function clampDrones() {
    const cap = shipDroneCount();
    if (state.drones == null) state.drones = 0;
    state.drones = Math.max(0, Math.min(cap, state.drones | 0));
  }
  function spawnDrones() {
    clampDrones();
    const n = state.drones, prev = rt.drones || [];
    rt.drones = [];
    const ax = rt.archer ? rt.archer.x : 0, ay = rt.archer ? rt.archer.y : 0;
    for (let i = 0; i < n; i++) {
      const p = prev[i];
      rt.drones.push({ ang: p ? p.ang : (Math.PI * 2 * i / Math.max(1, n)), cd: p ? p.cd : Math.random() * 0.5, x: ax, y: ay });
    }
    rebuildEscorts(); // fleet escorts redeploy alongside the drone screen
  }
  // On a kill, a carrier with an empty bay has a chance to capture a drone.
  function maybeDropDrone(e) {
    const cap = shipDroneCount();
    if (cap <= 0 || state.drones >= cap) return;
    if (Math.random() >= C.DRONE.dropChance) return;
    state.drones++;
    spawnDrones();
    if (e) { burst(e.x, e.y, '#7fe0ff', 14, { speed: 150, life: 0.7, glow: true }); rt.floats.push(new E.FloatText(e.x, e.y - 14, '+ DRONE', { color: '#7fe0ff', size: 13, vy: -46, life: 0.9 })); }
    if (window.UI) window.UI.unlockToast('Drone deployed · bay ' + state.drones + '/' + cap);
  }
  function updateDrones(dt) {
    const list = rt.drones;
    if (!list || !list.length) return;
    const a = rt.archer, s = rt.stats, cap = list.length;
    const orbit = C.DRONE.orbit + cap * 1.6;
    for (let i = 0; i < list.length; i++) {
      const dr = list[i];
      dr.ang += C.DRONE.spin * dt;
      const ta = dr.ang + (Math.PI * 2 * i / cap);
      dr.x = a.x + Math.cos(ta) * orbit;
      dr.y = a.y + Math.sin(ta) * orbit;
      dr.cd -= dt;
      if (a.dead || rt.awaitingRespawn) continue;
      // nearest enemy within range, measured from the drone itself
      let best = null, bd = C.DRONE.range * C.DRONE.range;
      for (const en of rt.enemies) { if (en.dying) continue; const d = (en.x - dr.x) ** 2 + (en.y - dr.y) ** 2; if (d < bd) { bd = d; best = en; } }
      if (best && dr.cd <= 0) {
        const p = new E.Projectile(dr.x, dr.y, best, 0, false);
        const crit = Math.random() * 100 < s.critChance;
        let dmg = s.attackDamage * C.DRONE.dmgFrac * (0.9 + Math.random() * 0.2);
        if (crit) dmg *= 1 + s.critDamage / 100;
        if (state.auto) dmg *= 0.8;
        p.damage = Math.max(1, Math.round(dmg)); p.crit = crit; p.drone = true;
        p.angle = Math.atan2(best.y - dr.y, best.x - dr.x);
        rt.projectiles.push(p);
        dr.cd = 1 / C.DRONE.fireRate;
        rt.particles.push(new E.Particle(dr.x, dr.y, { vx: Math.cos(p.angle) * 70, vy: Math.sin(p.angle) * 70, life: 0.12, size: 1.6, color: '#7fe0ff', glow: true, drag: 0.85 }));
      }
    }
  }

  // ==========================================================================
  // FLEET — escort ships fly with the flagship (Lv 100+, 1 slot / 100 levels)
  // ==========================================================================
  function fleetSlots() {
    let n = 0;
    C.FLEET.slotLevels.forEach((lv) => { if (state.level >= lv) n++; });
    return Math.min(C.FLEET.maxShips - 1, n);
  }
  function fleetShips() {
    if (!state.fleet) return [];
    const seen = {};
    return state.fleet
      .filter((k) => k && state.ownedShips[k] && k !== state.ship && !seen[k] && (seen[k] = 1))
      .slice(0, fleetSlots())
      .map((k) => C.SHIP_BY_KEY[k])
      .filter(Boolean);
  }
  // Assign (or clear with null) escort slot i. Enforces: slot unlocked, hull
  // owned, not the flagship, no duplicates (hulls are unique anyway).
  function setFleetSlot(i, key) {
    if (i < 0 || i >= fleetSlots()) return { ok: false, reason: 'locked' };
    if (!state.fleet) state.fleet = [];
    if (key == null) { state.fleet[i] = null; }
    else {
      if (!state.ownedShips[key]) return { ok: false, reason: 'unowned' };
      if (key === state.ship) return { ok: false, reason: 'flagship' };
      if (state.fleet.some((k, j) => k === key && j !== i)) return { ok: false, reason: 'duplicate' };
      state.fleet[i] = key;
    }
    refreshStats(); rebuildEscorts(); save();
    if (window.UI) window.UI.refreshAll();
    return { ok: true };
  }
  const ESCORT_OFF = [[-36, 30], [36, 30], [-66, 6], [66, 6]];
  const ESCORT_WTYPE = { Frigate: 'laser', Cruiser: 'gatling', Battleship: 'missile', Carrier: 'rail', Aegis: 'support' };
  function rebuildEscorts() {
    const ax = rt.archer ? rt.archer.x : 0, ay = rt.archer ? rt.archer.y : 0;
    rt.escorts = fleetShips().map((sh, i) => ({
      key: sh.key, cls: sh.cls,
      x: ax + ESCORT_OFF[i][0], y: ay + ESCORT_OFF[i][1],
      ox: ESCORT_OFF[i][0], oy: ESCORT_OFF[i][1],
      cd: Math.random(), heal: 0,
    }));
  }
  function updateEscorts(dt) {
    const a = rt.archer, s = rt.stats;
    // WARDEN AURA hull recovery — fleet-wide regen ticks here
    if (s && s.regen > 0 && a && !a.dead && a.hp < s.maxHp) {
      a.hp = Math.min(s.maxHp, a.hp + s.maxHp * (s.regen / 100) * dt);
      if (Math.random() < dt * 0.5) rt.floats.push(new E.FloatText(a.x, a.y - 22, '✚', { color: '#7ce0a0', size: 13, vy: -34, life: 0.7 }));
    }
    const list = rt.escorts;
    if (!list || !list.length || !a) return;
    for (const es of list) {
      // formation flight — ease toward station-keeping point behind the flagship
      const tx = a.x + es.ox, ty = a.y + es.oy;
      const k = Math.min(1, dt * 3.2);
      es.x += (tx - es.x) * k; es.y += (ty - es.y) * k;
      if (es.heal > 0) es.heal -= dt;
      es.cd -= dt;
      if (a.dead || rt.awaitingRespawn || state.currentDungeon < 1) continue;
      if (es.cd > 0) continue;
      if (es.cls === 'Aegis') {
        // support escort: periodic repair pulse instead of weapons fire
        es.cd = 3.2; es.heal = 0.8;
        if (a.hp < s.maxHp) {
          const heal = s.maxHp * 0.02;
          a.hp = Math.min(s.maxHp, a.hp + heal);
          rt.floats.push(new E.FloatText(a.x, a.y - 22, '+' + formatNum(heal), { color: '#7ce0a0', size: 14, vy: -40, life: 0.8 }));
          burst(es.x, es.y, '#7ce0a0', 8, { speed: 90, life: 0.5, glow: true });
        }
        continue;
      }
      // combat escort: fire at the nearest enemy in fleet range
      let best = null, bd = (s.fireRange || 300) * (s.fireRange || 300);
      for (const en of rt.enemies) { if (en.dying) continue; const d = (en.x - es.x) ** 2 + (en.y - es.y) ** 2; if (d < bd) { bd = d; best = en; } }
      if (best) {
        const p = new E.Projectile(es.x, es.y, best, 0, false);
        const crit = Math.random() * 100 < s.critChance;
        let dmg = s.attackDamage * C.FLEET.escortDmgFrac * (0.9 + Math.random() * 0.2);
        if (crit) dmg *= 1 + s.critDamage / 100;
        if (state.auto) dmg *= 0.8;
        p.damage = Math.max(1, Math.round(dmg)); p.crit = crit;
        p.wtype = ESCORT_WTYPE[es.cls] || 'gatling';
        p.angle = Math.atan2(best.y - es.y, best.x - es.x);
        rt.projectiles.push(p);
        es.cd = 1 / C.FLEET.escortFireRate;
      }
    }
  }

  // ---- COSMETICS (skins/auras) + CREDITS wallet -----------------------------
  function cosmeticList(kind) { return C.COSMETICS[kind === 'skin' ? 'skins' : 'auras'] || []; }
  function buyCosmetic(kind, key) {
    const c = cosmeticList(kind).find((x) => x.key === key);
    if (!c) return { ok: false, reason: 'invalid' };
    const cs = state.cosmetics;
    if (cs.owned[key]) return { ok: false, reason: 'owned' };
    if ((state.credits || 0) < c.credits) return { ok: false, reason: 'credits' };
    state.credits -= c.credits;
    cs.owned[key] = 1;
    save();
    return { ok: true };
  }
  function setCosmetic(kind, key) {
    const cs = state.cosmetics;
    if (!cs.owned[key]) return false;
    if (kind === 'skin') cs.skin = key; else cs.aura = key;
    save();
    return true;
  }
  function addCredits(n) { state.credits = (state.credits || 0) + Math.max(0, n | 0); save(); if (window.UI) window.UI.refreshAll(); }

  // ---- GOLD SHOP (rotating, refreshes every 15 min) ------------------------
  function shopWindow() { return Math.floor(Date.now() / (C.SHOP.refreshMin * 60000)); }
  function getShop() {
    const win = shopWindow();
    if (!state.shop || state.shop.window !== win) {
      const zone = Math.max(1, state.highestDungeonReached, state.currentDungeon);
      const items = [];
      // best currently-equipped power per slot (primary or secondary)
      const curBest = (slot) => {
        let p = state.equipped[slot] ? I.itemPower(state.equipped[slot]) : 0;
        const sec = slot === 'bow' ? 'bow2' : slot === 'arrows' ? 'arrows2' : null;
        if (sec && state.equipped[sec]) p = Math.max(p, I.itemPower(state.equipped[sec]));
        return p;
      };
      // average power of currently-equipped gear (reference for empty slots)
      let _eqP = [];
      Object.keys(state.equipped).forEach((sk) => { const it = state.equipped[sk]; if (it) _eqP.push(I.itemPower(it)); });
      const avgPower = _eqP.length ? _eqP.reduce((a, b) => a + b, 0) / _eqP.length : 0;
      // Keep shop items as MODEST upgrades — never a runaway power spike. Cap a
      // chosen item to ~1.35× the player's current gear in that slot.
      const UPGRADE_CAP = 1.35;
      const temper = (it) => {
        const ref = (curBest(it.slot) || avgPower);
        if (ref > 0 && I.itemPower(it) > ref * UPGRADE_CAP) {
          const f = (ref * UPGRADE_CAP) / I.itemPower(it);
          for (const k in it.stats) it.stats[k] = Math.max(1, Math.round(it.stats[k] * f));
        }
        return it;
      };
      for (let i = 0; i < C.SHOP.count; i++) {
        let best = null, bestP = -1;
        // try several rolls and keep the strongest that beats current gear
        for (let t = 0; t < 10; t++) {
          const rar = Math.min(6, C.rollShopRarity()); // cap at Ancient — no Void/Eternal in the market
          const it = I.generate(zone, rar);
          const p = I.itemPower(it);
          if (p > curBest(it.slot) && p > bestP) { best = it; bestP = p; }
          else if (!best && p > bestP) { best = it; bestP = p; }
        }
        items.push(temper(best));
      }
      // FIX the price now, at spawn time — 70% of current gold — so buying one
      // item never changes the price of the others this rotation.
      const fixed = Math.max(50, Math.floor(state.gold * 0.7));
      state.shop = { window: win, items, bought: [], price: fixed };
      save();
    }
    return state.shop;
  }
  function shopTimeLeft() { const ms = C.SHOP.refreshMin * 60000; return Math.ceil(((shopWindow() + 1) * ms - Date.now()) / 1000); }
  // Each Black Market item costs ~70% of the player's current gold (a real
  // sink), with a small floor so it's never free.
  function shopItemPrice() { return Math.max(50, Math.floor(state.gold * 0.7)); }
  // Is a given shop item an upgrade over current gear in its slot?
  function shopIsUpgrade(it) {
    if (!it) return false;
    const cur = state.equipped[it.slot];
    const sec = it.slot === 'bow' ? 'bow2' : it.slot === 'arrows' ? 'arrows2' : null;
    let p = cur ? I.itemPower(cur) : 0;
    if (sec && state.equipped[sec]) p = Math.max(p, I.itemPower(state.equipped[sec]));
    return !cur || I.itemPower(it) > p;
  }
  // ---- LOOTCOIN MARKET (premium gear) --------------------------------------
  // COSMIC CACHE: 3 Cosmic items rolled for your current progression, 10,000
  // LootCoins each, refreshing every hour on the hour.
  // PRIMORDIAL VAULT: ONE Primordial item for your level, 115,000 LootCoins,
  // refreshing daily at midnight CST (America/Chicago — DST-aware).
  const LC_PRICES = { cosmic: 10000, prim: 115000 };
  function lcZone() { return Math.max(1, state.highestDungeonReached || 0, state.currentDungeon || 0); }
  function lcHourWindow() { return Math.floor(Date.now() / 3600000); }
  function nextChicagoMidnight() {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date());
      const get = (t) => +parts.find((p) => p.type === t).value;
      const left = 86400 - ((get('hour') % 24) * 3600 + get('minute') * 60 + get('second'));
      return Date.now() + Math.max(60, left) * 1000;
    } catch (e) { return Date.now() + 86400000; } // no tz data → 24h fallback
  }
  function getLCMarket() {
    if (!state.lcMarket) state.lcMarket = {};
    const lm = state.lcMarket;
    if (!lm.cosmic || lm.cosmic.window !== lcHourWindow()) {
      const items = [];
      for (let i = 0; i < 3; i++) items.push(I.generate(lcZone(), 8));   // Cosmic
      lm.cosmic = { window: lcHourWindow(), items, bought: [] };
      save();
    }
    if (!lm.prim || !lm.prim.expiresAt || Date.now() >= lm.prim.expiresAt) {
      lm.prim = { item: I.generate(lcZone(), 11), expiresAt: nextChicagoMidnight(), bought: false }; // Primordial
      save();
    }
    return lm;
  }
  function lcCosmicTimeLeft() { return Math.max(0, Math.ceil(((lcHourWindow() + 1) * 3600000 - Date.now()) / 1000)); }
  function lcPrimTimeLeft() { return Math.max(0, Math.ceil((getLCMarket().prim.expiresAt - Date.now()) / 1000)); }
  function buyLCMarket(kind, idx) {
    const lm = getLCMarket();
    if (state.inventory.length >= invCap()) return { ok: false, reason: 'full' };
    let it = null, price = 0;
    if (kind === 'cosmic') {
      it = lm.cosmic.items[idx]; price = LC_PRICES.cosmic;
      if (!it || lm.cosmic.bought.includes(idx)) return { ok: false, reason: 'sold' };
    } else {
      it = lm.prim.item; price = LC_PRICES.prim;
      if (!it || lm.prim.bought) return { ok: false, reason: 'sold' };
    }
    if ((state.credits || 0) < price) return { ok: false, reason: 'credits' };
    state.credits -= price;
    if (kind === 'cosmic') lm.cosmic.bought.push(idx); else lm.prim.bought = true;
    state.inventory.push(it);
    save(); if (window.UI) window.UI.refreshAll();
    return { ok: true, item: it };
  }

  function buyShopItem(idx) {
    const sh = getShop(); const it = sh.items[idx];
    if (!it || sh.bought.includes(idx)) return false;
    const price = sh.price != null ? sh.price : shopItemPrice();
    if (state.gold < price) return false;
    state.gold -= price; sh.bought.push(idx);
    // equip straight away if it beats current gear, else stash in the bag
    if (!state.equipped[it.slot] || shopIsUpgrade(it)) {
      const prev = state.equipped[it.slot];
      state.equipped[it.slot] = it; if (prev) state.inventory.push(prev);
      if (state.autoEquipAlways) autoEquip(); else refreshStats();
    } else state.inventory.push(it);
    if (window.UI) window.UI.refreshAll(); save();
    return true;
  }

  // What an auto-sell with the current filter WOULD sell (for the confirm UI).
  function autoSellPreview(maxTier, keepUpgrades) {
    let n = 0, earned = 0;
    state.inventory.forEach((it) => {
      if (it.rarity > maxTier) return;
      if (keepUpgrades) { const cur = state.equipped[it.slot]; if (!cur || I.itemPower(it) > I.itemPower(cur)) return; }
      n++; earned += C.sellValue(it);
    });
    return { n, earned };
  }
  // AUTO-SELL everything matching the user's saved filter (rarity threshold +
  // optional "keep upgrades").
  function autoSell(maxTier, keepUpgrades) {
    state.sellTier = maxTier; state.keepUpgrades = keepUpgrades;
    let n = 0, earned = 0; const salvage = {};
    state.inventory = state.inventory.filter((it) => {
      if (it.rarity > maxTier) return true;
      if (keepUpgrades) { const cur = state.equipped[it.slot]; if (!cur || I.itemPower(it) > I.itemPower(cur)) return true; }
      n++; earned += C.sellValue(it); addSalvage(it, salvage); return false;
    });
    state.gold += earned; if (window.UI) window.UI.refreshAll(); save();
    return { n, earned, salvage };
  }
  function selectDungeon(d) {
    if (d > state.highestUnlocked) return;
    if (isCitadelZone(d) && citadelCooldownLeft(d) > 0) {
      if (window.UI) window.UI.unlockToast('⛴ Citadel rebuilding — ready in ' + Math.ceil(citadelCooldownLeft(d) / 60) + ' min');
      return false;
    }
    state.currentDungeon = d;
    state.currentSystem = null;   // classic free-play deploy (not a galaxy tile)
    rt.siege = null;
    rt.waves = null; rt.tileDensity = rt.tileLoot = rt.tileRespawnMult = 1; rt.deepDeath = false;
    state.highestDungeonReached = Math.max(state.highestDungeonReached, d);
    // pushing into a new 100-block opens the next block (still level-gated)
    const cap = C.zoneCap(state.highestDungeonReached);
    const u = Math.min(cap, unlockCeil(state.level));
    if (u > state.highestUnlocked) state.highestUnlocked = u;
    resetZone();
    // Deploying to the safe Hangar bay (d=0, e.g. the Bail button) always ends
    // combat cleanly: revive the ship and top up health so you're never "downed"
    // while docked.
    if (d < 1) {
      rt.awaitingRespawn = false;
      rt.archer.dead = false; rt.archer.killer = null;
      rt.archer.hp = rt.stats.maxHp; rt.archer.invuln = 2;
    }
    if (window.UI) window.UI.refreshAll(); save();
  }
  function respawnAt(d) {
    if (d > state.highestUnlocked) d = state.highestUnlocked;
    state.currentDungeon = d;
    state.highestDungeonReached = Math.max(state.highestDungeonReached, d);
    rt.awaitingRespawn = false;
    rt.archer.dead = false; rt.archer.killer = null;
    rt.waves = null; rt.tileDensity = rt.tileLoot = rt.tileRespawnMult = 1; rt.deepDeath = false;
    resetZone();
    // generous safety on redeploy: 4s invulnerability + a spawn grace window so
    // the player is never instantly swarmed after choosing a zone.
    rt.archer.hp = rt.stats.maxHp; rt.archer.invuln = 4;
    rt.nodes.forEach((n, i) => { n.respawnT = 2.2 + i * 0.45; });
    if (window.UI) window.UI.refreshAll(); save();
  }
  function resetZone() {
    rt.enemies = []; rt.projectiles = []; rt.ground = []; rt.ebolts = []; rt.towT = 0;
    // CINEMATIC: hyperspace warp-in streaks on every combat deploy
    if (state.currentDungeon >= 1) rt.warpT = 0.85;
    // re-fit world size + zoom for this zone (wider & more zoomed-out deeper in)
    const mul = worldMul(state.currentDungeon);
    rt.worldW = Math.round(rt.w * mul); rt.worldH = Math.round(rt.h * mul);
    rt.zoom = zoomFor(state.currentDungeon);
    rt.archer.x = rt.worldW / 2; rt.archer.y = rt.worldH / 2;
    if (rt.siege && rt.siege.active) {
      // SIEGE: no fixed nodes / no boss meter — waves are spawned by updateSiege
      rt.nodes = [];
      rt.bossAlive = false; rt.boss = null; rt.bossInit = rt.bossTimer = 1e9; rt.lastBoss = rt.time;
      rt.siege.spawnT = 1.0; rt.siege.wave = 1; rt.siege.bossSpawned = false; rt.siege.pendingBoss = false;
      rt.waves = null;
    } else if (rt.waves && rt.waves.active) {
      // pre-configured gauntlet (owned Boss Tile) — keep its config, (re)start it
      rt.nodes = [];
      rt.bossAlive = false; rt.boss = null; rt.bossInit = rt.bossTimer = 1e9; rt.lastBoss = rt.time;
      rt.waves.wave = 1; rt.waves.bossSpawned = false; rt.waves.pendingBoss = false; rt.waves.super = false; rt.waves.spawnT = rt.waves.spawnT || 1.2;
    } else if (!state.currentSystem && isWaveZone(state.currentDungeon)) {
      // WAVE ZONE: 25 escalating waves of extreme density → boss → repeat.
      rt.nodes = [];
      rt.bossAlive = false; rt.boss = null; rt.bossInit = rt.bossTimer = 1e9; rt.lastBoss = rt.time;
      rt.waves = { active: true, total: 25, wave: 1, bossSpawned: false, pendingBoss: false, spawnT: 1.2, super: false };
    } else if (!state.currentSystem && isCitadelZone(state.currentDungeon)) {
      // CITADEL SIEGE: fight from the bottom of the zone UP through 8 garrison
      // waves, then destroy the citadel. One run per 15 min per zone.
      rt.nodes = [];
      rt.bossAlive = false; rt.boss = null; rt.bossInit = rt.bossTimer = 1e9; rt.lastBoss = rt.time;
      rt.waves = { active: true, total: 8, wave: 1, bossSpawned: false, pendingBoss: false, spawnT: 1.4, super: false, citadel: true };
      if (rt.archer) { rt.archer.x = rt.worldW / 2; rt.archer.y = rt.worldH * 0.82; }
    } else {
      rt.waves = null;
      buildNodes();
      // stagger initial spawns
      rt.nodes.forEach((n, i) => { n.respawnT = 0.2 + i * 0.25; });
      // boss meter: 10–15 min to first boss; min 5 min between bosses
      rt.bossInit = rt.bossTimer = 600 + Math.random() * 300;
      rt.bossAlive = false; rt.boss = null; rt.lastBoss = rt.time - 600;
    }
    burst(rt.archer.x, rt.archer.y, '#e6b566', 18, { speed: 200, life: 0.6 });
  }

  // ==========================================================================
  // GALAXY MAP — warp between systems, capture via 10-wave sieges, own systems
  // for per-hour resources. Difficulty scales with ring distance from home.
  // ==========================================================================
  function sysAt(k) { return GX.tileAt(k); }
  function isOwned(k) { return !!state.ownedSystems[k]; }
  function rivalOf(k) {
    const real = rt.realTiles && rt.realTiles[k];
    if (real) {
      const myUid = (window.TERRITORY && window.TERRITORY.enabled()) ? window.TERRITORY.myId() : null;
      return (myUid && real.ownerId === myUid) ? null : (real.ownerName || 'Operator');
    }
    return (state.rivalTiles && state.rivalTiles[k]) || null;
  }
  // Seconds left on a tile's contest cooldown (15 min normal · 24 h citadels).
  function tileCooldownLeft(k) {
    const until = state.tileCd && state.tileCd[k];
    return until ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : 0;
  }
  // Combat multipliers for the tile we're standing in — deep space rings give
  // 20× density, 3× spawn rate, 10× loot, and the lose-2-items death rule.
  function applyTileMults(tile) {
    rt.tileDensity = (tile && tile.deep) ? GX.DEEP_MULT.density : 1;
    rt.tileLoot    = (tile && tile.deep) ? GX.DEEP_MULT.loot : 1;
    rt.tileRespawnMult = (tile && tile.deep) ? GX.DEEP_MULT.rate : 1;
    rt.deepDeath   = !!(tile && tile.deep);
  }
  // Effective loot-quality roll multiplier for the current tile (capped so the
  // keep-best rarity roll never loops absurdly).
  function lootQ() { return Math.min(50, Math.max(1, Math.round(qualityMult(state.currentDungeon) * (rt.tileLoot || 1)))); }
  function canAfford(cost) {
    return state.resources.fuel >= (cost.fuel || 0) && state.resources.iron >= (cost.iron || 0) && state.resources.plasma >= (cost.plasma || 0);
  }
  // Simulated rival owners (no real multiplayer). Seeded once; higher regions are
  // more heavily contested. Never overwrites existing ownership/assignments.
  const RIVAL_NAMES = ['GhostHD','ReaperX','Viper77','HawkOG','WolfPack','RavenTX','SteelRecon','AceMag','FrostByte','DieselK','MakoSix','EchoNine','RazorBravo','BoltActual','TalonVet','IronProto','NyxPrime','OnyxFPS','SaintTac','KriegMk2'];
  function seedRivals() {
    if (!state.rivalTiles) state.rivalTiles = {};
    let seed = 1337;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let ring = 1; ring <= GX.RINGS; ring++) {
      const p = Math.min(0.5, 0.08 + ring * 0.018); // deeper rings more contested
      GX.ringCoords(ring).forEach((c) => {
        const id = GX.tileId(c.q, c.r);
        if (state.ownedSystems[id] || state.rivalTiles[id]) return;
        if (rnd() < p) state.rivalTiles[id] = RIVAL_NAMES[(rnd() * RIVAL_NAMES.length) | 0];
      });
    }
  }
  // Full info card for one tile — everything the detail panel needs.
  function tileInfo(k) {
    const t = sysAt(k); if (!t) return null;
    return Object.assign({}, t, {
      owned: isOwned(k), rival: rivalOf(k), active: state.currentSystem === k,
      cooldown: tileCooldownLeft(k),
      lootQ: (t.deep ? GX.DEEP_MULT.loot : 1),
      resMult: (t.deep ? GX.DEEP_MULT.resource : 1),
      locked: t.level > state.level + 10 && !isOwned(k),
    });
  }
  // ---- LIVING GALAXY: simulated rival turf wars (NOT real PvP) -------------
  // Rivals periodically claim neutral tiles, seize tiles from each other, and
  // contest YOUR territory — so the map is fought over and shifts between (and
  // during) sessions. Catch-up runs on load for the time you were away.
  function rndRivalName() { return RIVAL_NAMES[(Math.random() * RIVAL_NAMES.length) | 0]; }
  function galaxyEvent() {
    // weighted ring pick — deeper space is more contested
    const ring = 1 + Math.min(GX.RINGS - 1, Math.floor(Math.pow(Math.random(), 0.6) * GX.RINGS));
    const ids = GX.ringCoords(ring).map((c) => GX.tileId(c.q, c.r));
    const neutral = ids.filter((id) => !state.ownedSystems[id] && !state.rivalTiles[id] && !(rt.realTiles && rt.realTiles[id]));
    const rivalHeld = ids.filter((id) => state.rivalTiles[id] && !(rt.realTiles && rt.realTiles[id]));
    const mine = ids.filter((id) => state.ownedSystems[id] && id !== state.currentSystem && !(rt.realTiles && rt.realTiles[id]));
    const pick = (arr) => arr[(Math.random() * arr.length) | 0];
    const r = Math.random();
    if (r < 0.5 && neutral.length) {
      const id = pick(neutral), name = rndRivalName();
      state.rivalTiles[id] = name; return { kind: 'expand', name, tile: id };
    }
    if (r < 0.85 && rivalHeld.length) {
      const id = pick(rivalHeld), from = state.rivalTiles[id]; let name = rndRivalName();
      if (name === from) name = rndRivalName();
      state.rivalTiles[id] = name; return { kind: 'war', name, from, tile: id };
    }
    // contest one of YOUR tiles (deliberately rare; citadels are siege-locked)
    if (mine.length && Math.random() < 0.4) {
      const id = pick(mine);
      const t = sysAt(id);
      if (tileCooldownLeft(id) > 0) return null;
      if (t && t.citadel && Math.random() < 0.85) return null; // citadels rarely fall to the sim
      const name = rndRivalName();
      delete state.ownedSystems[id]; state.rivalTiles[id] = name;
      return { kind: 'lost', name, tile: id };
    }
    return null;
  }
  function pushFeed(msg, mine) {
    if (!state.galaxyFeed) state.galaxyFeed = [];
    state.galaxyFeed.unshift({ t: Date.now(), msg: msg, mine: !!mine });
    state.galaxyFeed = state.galaxyFeed.slice(0, 24);
  }
  function galaxyTick() {
    const now = Date.now();
    if (!state.lastGalaxyTick) state.lastGalaxyTick = now;
    let events = Math.min(8, Math.floor((now - state.lastGalaxyTick) / 360000)); // ~1 / 6 min, small catch-up bursts
    if (events <= 0) { if (Math.random() < 0.2) events = 1; else return; }
    state.lastGalaxyTick = now;
    let lost = null;
    for (let i = 0; i < events; i++) {
      const ev = galaxyEvent(); if (!ev) continue;
      const tn = (GX.tileAt(ev.tile) || {}).name || ev.tile;
      if (ev.kind === 'expand') pushFeed(ev.name + ' claimed ' + tn);
      else if (ev.kind === 'war') pushFeed(ev.name + ' seized ' + tn + ' from ' + ev.from);
      else { pushFeed(ev.name + ' captured your ' + tn, true); lost = lost || { name: ev.name, tn: tn }; }
    }
    save();
    if (window.UI) { if (lost) window.UI.galaxyContestToast(lost.name, lost.tn); window.UI.galaxyChanged(); }
  }
  // ---- REAL turf war (Supabase) hybrid layer -------------------------------
  // When signed into a real account, tile ownership is shared across accounts.
  // Real ownership overrides the local simulation; simulated rivals only ever
  // occupy tiles no real player holds, so the map is contested AND never empty.
  function realMyUid() { return (window.TERRITORY && window.TERRITORY.enabled()) ? window.TERRITORY.myId() : null; }
  function syncRealTiles(map) {
    rt.realTiles = map || {};
    const myUid = realMyUid();
    Object.keys(rt.realTiles).forEach((id) => {
      const r = rt.realTiles[id];
      if (myUid && r.ownerId === myUid) state.ownedSystems[id] = true;
      else if (state.ownedSystems[id]) delete state.ownedSystems[id];
      if (state.rivalTiles) delete state.rivalTiles[id]; // a real owner overrides any simulated one
    });
  }
  function onRealtimeTile(ev) {
    if (!rt.realTiles) rt.realTiles = {};
    const myUid = realMyUid();
    if (ev.deleted) { delete rt.realTiles[ev.tileId]; }
    else {
      rt.realTiles[ev.tileId] = { ownerId: ev.ownerId, ownerName: ev.ownerName, cooldownUntil: ev.cooldownUntil };
      if (myUid && ev.ownerId === myUid) { state.ownedSystems[ev.tileId] = true; }
      else if (state.ownedSystems[ev.tileId]) {
        delete state.ownedSystems[ev.tileId];
        const tn = (GX.tileAt(ev.tileId) || {}).name || ev.tileId;
        pushFeed(ev.ownerName + ' captured your ' + tn, true);
        if (window.UI) window.UI.galaxyContestToast(ev.ownerName, tn);
      }
      if (state.rivalTiles) delete state.rivalTiles[ev.tileId];
    }
    if (window.UI) window.UI.galaxyChanged();
  }
  function initTerritory() {
    if (!(window.TERRITORY && window.TERRITORY.enabled())) return;
    rt._terrSync = Date.now();
    window.TERRITORY.loadAll().then((map) => { syncRealTiles(map); if (window.UI) window.UI.galaxyChanged(); });
    window.TERRITORY.subscribe(onRealtimeTile);
  }
  // Tap a tile: own → deploy/farm; neutral → capture siege; rival → contest
  // (starts a 15-min region cooldown). Returns {ok} / {ok:false, reason}.
  // Effective entry cost for a tile (your own territory warps at half price).
  function entryCostFor(k) {
    const t = sysAt(k); if (!t || t.home) return null;
    const c = GX.entryCost(t.ring); if (!c) return null;
    const disc = isOwned(k) ? 0.5 : 1;
    const eff = {};
    for (const ck in c) eff[ck] = Math.ceil(c[ck] * disc);
    return eff;
  }
  function warp(k) {
    const tile = sysAt(k); if (!tile) return { ok: false, reason: 'invalid' };
    if (tile.home) return { ok: false, reason: 'home' };       // the Home Citadel is neutral
    const owned = isOwned(k);
    if (!owned && tile.level > state.level + 10) return { ok: false, reason: 'locked' };
    if (!owned && rivalOf(k) && tileCooldownLeft(k) > 0) return { ok: false, reason: 'cooldown' };
    // ENTRY COST — every warp burns resources; deeper rings are punishing
    const cost = entryCostFor(k);
    if (cost) {
      if (!canAfford(cost)) return { ok: false, reason: 'resources', cost };
      state.resources.fuel -= cost.fuel || 0;
      state.resources.iron -= cost.iron || 0;
      state.resources.plasma -= cost.plasma || 0;
    }
    if (!owned && rivalOf(k)) {
      if (!state.tileCd) state.tileCd = {};
      // attacking locks the tile — citadels can only be sieged once per DAY
      state.tileCd[k] = Date.now() + (tile.citadel ? 24 * 3600 : 15 * 60) * 1000;
    }
    enterTile(k);
    save();
    return { ok: true };
  }
  function enterTile(k) {
    const tile = sysAt(k); if (!tile) return;
    if (tile.home) { respawnAt(0); return; }      // Home Citadel → safe harbor
    state.currentSystem = k;
    state.currentDungeon = tile.diff;
    state.highestDungeonReached = Math.max(state.highestDungeonReached, tile.diff);
    const cap = C.zoneCap(state.highestDungeonReached);
    const u = Math.min(cap, unlockCeil(state.level));
    if (u > state.highestUnlocked) state.highestUnlocked = u;
    applyTileMults(tile);
    const owned = isOwned(k);
    if (owned && (tile.boss || tile.citadel)) {
      // owned Boss/Citadel tile → endless gauntlet, a boss every 10 waves
      rt.siege = null;
      rt.waves = { active: true, total: 10, wave: 1, bossSpawned: false, pendingBoss: false, spawnT: 1.2, super: false, bossTile: true };
    } else if (owned) {
      rt.siege = null; rt.waves = null;
    } else if (tile.citadel) {
      // CITADEL SIEGE ZONE → the full citadel-siege encounter; raze it to CLAIM it
      rt.siege = null;
      rt.waves = { active: true, total: 8, wave: 1, bossSpawned: false, pendingBoss: false, spawnT: 1.4, super: false, citadel: true, claimTile: k };
    } else {
      // neutral or rival-held → capture siege (Boss Tiles end on a boss wave)
      rt.siege = { active: true, total: 10, wave: 1, bossSpawned: false, pendingBoss: false, spawnT: 1.0, boss: tile.boss };
      rt.waves = null;
    }
    rt.awaitingRespawn = false;
    if (rt.archer) { rt.archer.dead = false; rt.archer.killer = null; rt.archer.hp = (rt.stats ? rt.stats.maxHp : 100); rt.archer.invuln = 3; }
    resetZone();
    spawnDrones();
    if (window.UI) { window.UI.refreshAll(); if (rt.siege) window.UI.siegeEvent('start', rt.siege); }
    save();
  }

  // ---- SIEGE wave engine ---------------------------------------------------
  function spawnWaveEnemy() {
    const cit = rt.waves && rt.waves.active && rt.waves.citadel;
    let x, y;
    if (cit) {
      // CITADEL SIEGE: the garrison descends from the top — you push UP
      x = 30 + Math.random() * (rt.worldW - 60);
      y = 30 + Math.random() * rt.worldH * 0.30;
    } else {
      const a = Math.random() * Math.PI * 2, rad = Math.min(rt.worldW, rt.worldH) * (0.28 + Math.random() * 0.18);
      x = Math.max(30, Math.min(rt.worldW - 30, rt.archer.x + Math.cos(a) * rad));
      y = Math.max(30, Math.min(rt.worldH - 30, rt.archer.y + Math.sin(a) * rad));
    }
    const e = new E.Enemy(pickType(), state.currentDungeon, x, y);
    if (cit) {
      // garrison hulks: walls, not bombs — brutal HP, feeble guns
      e.maxHp *= 4.5; e.hp = e.maxHp;
      e.damage *= 0.32; e.speed *= 0.72; e.size *= 1.25;
    }
    rt.enemies.push(e);
  }
  function spawnWave(n, densityMul) {
    densityMul = densityMul || 1;
    const t = state.currentSystem ? sysAt(state.currentSystem) : null;
    const ringN = t ? Math.max(1, t.ring) : Math.max(1, Math.ceil(state.currentDungeon / 10));
    let count = Math.min(16, 4 + Math.floor(ringN * 0.7) + Math.floor(n * 0.7));
    count = Math.min(34, Math.round(count * densityMul * (rt.tileDensity ? Math.min(2.2, 1 + (rt.tileDensity - 1) * 0.06) : 1)));
    for (let i = 0; i < count; i++) spawnWaveEnemy();
  }
  function spawnSiegeBoss() {
    spawnBoss();
  }
  // THE VOID CITADEL — a massive static fortress at the top of the zone.
  // It cannot move; it suppresses with slow 4-bolt spreads while you grind
  // its enormous hull down. Visual damage states live in render.drawCitadel.
  function spawnCitadel() {
    const pool = allowedEnemies();
    const type = pool[pool.length - 1];
    const c = new E.Enemy(type, state.currentDungeon, rt.worldW / 2, rt.worldH * 0.20);
    c.isCitadel = true; c.isBoss = true;      // boss-grade xp/gold on kill
    c.name = 'Void Citadel';
    c.maxHp *= 800; c.hp = c.maxHp;           // a fortress — a true siege grind
    c.damage *= 0.5;
    c.size = 118; c.speed = 0;                // dominates the top of the zone
    c.ranged = true; c.range = 430; c.fireCd = 2.6; c.fireT = 1.4;
    rt.enemies.push(c);
    burst(c.x, c.y, '#ff9a50', 50, { speed: 300, life: 1.0, glow: true });
    return c;
  }
  function citadelDown(e) {
    // SUPERNOVA — triple blast rings + white flash + heavy shake
    burst(e.x, e.y, '#fff3d0', 90, { speed: 430, life: 1.2, glow: true });
    burst(e.x, e.y, '#ffd24d', 60, { speed: 260, life: 1.0, glow: true });
    burst(e.x, e.y, '#ff9a50', 40, { speed: 150, life: 0.9, glow: true });
    rt.shake = 14; rt.novaT = 0.6;
    // loot shower — better than the zone average, nothing absurd: +2 rarity
    // tiers over a 4×-quality roll, dropped in a ring around the PLAYER so the
    // magnet vacuums every piece before the tow home.
    const drops = 8, zone = state.currentDungeon;
    for (let i = 0; i < drops; i++) {
      const base = rollRarityBoosted(zone, Math.min(40, qualityMult(zone) * 4));
      const item = I.generate(zone, Math.min(Math.min(10, C.rarityCap(zone) + 1), base + 2));
      state.itemsFound++;
      const a = Math.PI * 2 * (i / drops), r = 42 + Math.random() * 36;
      rt.ground.push(new E.GroundItem(rt.archer.x + Math.cos(a) * r, rt.archer.y + Math.sin(a) * r, item, false));
      lootBurst(e.x, e.y, item.rarity);
      if (window.UI) window.UI.onLoot(item, true);
    }
    // modest resource bounty + the 15-minute rebuild clock
    if (!state.resources) state.resources = { fuel: 80, iron: 0, plasma: 0 };
    state.resources.fuel += 150 + zone * 20; state.resources.iron += 60 + zone * 8; state.resources.plasma += 40 + zone * 6;
    // the rebuild clock: grind zones lock 15 min · claimed citadel tiles are
    // siege-locked for 24 h (your new fortress can only be sieged once a day)
    if (rt.waves && rt.waves.claimTile) {
      if (!state.tileCd) state.tileCd = {};
      state.tileCd[rt.waves.claimTile] = Date.now() + 24 * 3600 * 1000;
      captureSystem();                         // the razed citadel becomes YOURS
    } else {
      if (!state.citadelCd) state.citadelCd = {};
      state.citadelCd[zone] = Date.now() + 15 * 60 * 1000;
    }
    if (window.UI) window.UI.siegeEvent('citadeldown', {});
    save();
  }
  function updateSiege(dt) {
    const s = rt.siege; if (!s || !s.active) return;
    if (s.spawnT > 0) {
      s.spawnT -= dt;
      if (s.spawnT <= 0) {
        if (s.pendingBoss) { spawnSiegeBoss(); s.bossSpawned = true; s.pendingBoss = false; }
        else spawnWave(s.wave);
      }
      return;
    }
    const living = rt.enemies.filter((e) => !e.dying).length;
    if (living > 0) return;
    // current wave cleared
    if (s.bossSpawned) { captureSystem(); return; }
    if (s.wave < s.total) {
      s.wave++; s.spawnT = 1.2;
      if (window.UI) window.UI.siegeEvent('wave', s);
    } else if (s.boss) {
      s.pendingBoss = true; s.spawnT = 1.6;
      if (window.UI) window.UI.siegeEvent('boss', s);
    } else {
      captureSystem();
    }
  }
  // WAVE ZONE runner — mirrors the siege engine but loops endlessly for farming:
  // 25 extreme-density waves → a boss (30% Super) → restart. The boss pays out via
  // the normal onKill path (Super Boss = premium loot table + resource bounty).
  function updateWaveZone(dt) {
    const s = rt.waves; if (!s || !s.active) return;
    if (s.spawnT > 0) {
      s.spawnT -= dt;
      if (s.spawnT <= 0) {
        if (s.pendingBoss) { if (s.citadel) spawnCitadel(); else spawnBoss({ super: s.super }); s.bossSpawned = true; s.pendingBoss = false; }
        else spawnWave(s.wave, 1.8); // extreme density
      }
      return;
    }
    if (rt.enemies.filter((e) => !e.dying).length > 0) return;
    if (s.bossSpawned) {
      if (s.citadel) {
        // CITADEL RAZED — a short grace to vacuum the loot, then tow home.
        s.graceT = (s.graceT == null) ? 3.4 : s.graceT - dt;
        if (s.graceT <= 0) { s.active = false; respawnAt(0); if (window.UI) window.UI.siegeEvent('citadelhome', {}); }
        return;
      }
      // gauntlet complete — reset and run it again
      s.wave = 1; s.bossSpawned = false; s.pendingBoss = false; s.super = false; s.spawnT = 2.2;
      if (window.UI) window.UI.siegeEvent('wavezone', { kind: 'clear' });
      return;
    }
    if (s.wave < s.total) {
      s.wave++; s.spawnT = 0.9;
      if (window.UI && (s.wave % 5 === 0 || s.wave === s.total)) window.UI.siegeEvent('wave', s);
    } else {
      s.super = !s.citadel && Math.random() < 0.30; // final wave → boss (30% Super)
      s.pendingBoss = true; s.spawnT = 1.6;
      if (window.UI) window.UI.siegeEvent(s.citadel ? 'citadel' : 'boss', s);
    }
  }

  function captureSystem() {
    const k = state.currentSystem, tile = sysAt(k);
    if (!tile) { rt.siege = null; return; }
    const fromRival = rivalOf(k);
    state.ownedSystems[k] = true;
    if (state.rivalTiles) delete state.rivalTiles[k];
    pushFeed(fromRival ? ('You took ' + tile.name + ' from ' + fromRival) : ('You captured ' + tile.name));
    // REAL turf war: stake the claim on the shared server (server-authoritative,
    // atomic). If several operators raced for this tile, FIRST claim wins —
    // a rejected claim means we lost the race and must give the tile back.
    if (window.TERRITORY && window.TERRITORY.enabled()) {
      window.TERRITORY.claim(k, window.TERRITORY.myName(), tile.citadel ? 1440 : 15).then((res) => {
        if (!rt.realTiles) rt.realTiles = {};
        if (res.ok && res.row) {
          rt.realTiles[k] = { ownerId: res.row.owner_id, ownerName: res.row.owner_name, cooldownUntil: res.row.cooldown_until };
        } else if (res.reason && /protected|cooldown/i.test(res.reason)) {
          // RACE LOST — another operator sealed the claim first
          delete state.ownedSystems[k];
          pushFeed('Beaten to ' + tile.name + ' — another operator sealed the claim first', true);
          if (window.UI) window.UI.unlockToast('⚔ Race lost — ' + tile.name + ' was claimed seconds before you');
          save();
        }
        if (window.UI) window.UI.galaxyChanged();
      });
    }
    rt.siege = null;
    // boss tiles pay out the rare void/eternal loot table on capture
    if (tile.boss) bossSystemLoot(tile);
    applyTileMults(tile);
    // TERRITORY SECURED — stop all spawns, give the magnet a moment to vacuum
    // the spoils, then tow the player home to the hangar.
    rt.waves = null;
    rt.nodes = [];
    rt.bossAlive = false; rt.boss = null; rt.bossInit = rt.bossTimer = 1e9;
    rt.towT = 3.0;
    burst(rt.archer.x, rt.archer.y, '#5bc06b', 40, { speed: 240, life: 1.0, glow: true });
    if (window.UI) { window.UI.siegeEvent('captured', { sys: tile, fromRival: fromRival, full: false }); window.UI.refreshAll(); }
    save();
  }
  // Boss-system loot: 50% Void @~90% level, 10% Eternal @~50%, 1% Eternal @level
  function bossSystemLoot(sys) {
    const VOID = 9, ETERNAL = 10;
    const lvl = Math.max(1, sys.diff);
    const rcap = Math.min(10, C.rarityCap(lvl) + 1); // ring-gated — no Void drops from ring-1 boss tiles
    const drops = [];
    if (Math.random() < 0.50) drops.push(I.generate(Math.max(1, Math.round(lvl * 0.9)), Math.min(rcap, VOID)));
    if (Math.random() < 0.10) drops.push(I.generate(Math.max(1, Math.round(lvl * 0.5)), Math.min(rcap, ETERNAL)));
    if (Math.random() < 0.01) drops.push(I.generate(lvl, Math.min(rcap, ETERNAL)));
    drops.forEach((it, i) => {
      state.itemsFound++;
      const a = Math.PI * 2 * (i / Math.max(1, drops.length)), r = 24 + Math.random() * 20;
      rt.ground.push(new E.GroundItem(rt.archer.x + Math.cos(a) * r, rt.archer.y + Math.sin(a) * r, it, false));
      lootBurst(rt.archer.x, rt.archer.y, it.rarity);
      if (window.UI) window.UI.onLoot(it, true);
    });
  }

  // ---- RESOURCES (per-hour, offline-capped) --------------------------------
  function resourceRates() {
    const r = { fuel: 0, iron: 0, plasma: 0 };
    Object.keys(state.ownedSystems).forEach((k) => {
      const t = sysAt(k); if (!t || !t.rate) return;
      // citadel tiles already carry their 100× in t.rate; deep space adds ×25
      r[t.resource || 'fuel'] += t.rate * (t.deep ? GX.DEEP_MULT.resource : 1);
    });
    return r;
  }
  function accrueResources() {
    if (!state.resources) state.resources = { fuel: 80, iron: 0, plasma: 0 };
    const now = Date.now();
    const hrs = Math.min(12, Math.max(0, (now - (state.lastResTick || now)) / 3600000));
    state.lastResTick = now;
    if (hrs <= 0) return null;
    const rates = resourceRates();
    const gained = { fuel: rates.fuel * hrs, iron: rates.iron * hrs, plasma: rates.plasma * hrs };
    state.resources.fuel += gained.fuel; state.resources.iron += gained.iron; state.resources.plasma += gained.plasma;
    return gained;
  }
  function setAuto(v) { state.auto = !!v; rt.joy.x = rt.joy.y = 0; save(); }
  function setJoystick(x, y, active) { rt.joy.x = x; rt.joy.y = y; rt.joy.active = active; }
  function setGameSpeed(mult) {
    // 10× is the SECRET tier — ONLY the Mothership easter egg unlocks it
    if (mult === 10) { if (!state.secretSpeed) return false; state.gameSpeed = 10; save(); return true; }
    // 4× is the PREMIUM tier — ONLY a 500-LootCoin unlock opens it
    if (mult === 4) { if (!state.purchases || !state.purchases.speed4lc) return false; state.gameSpeed = 4; save(); return true; }
    // 5× is PRO-exclusive — active LootFleet Pro subscription required
    if (mult === 5) { if (!isPro()) return false; state.gameSpeed = 5; save(); return true; }
    if (mult === 1 || hasSpeed('speed' + mult)) { state.gameSpeed = mult; save(); return true; }
    return false;
  }
  // Speed tiers + offline play are FREE in this game — except 4× (LootCoins)
  // and 10× (easter egg), which have explicit branches in setGameSpeed.
  function hasSpeed(sku) { return sku !== 'speed4lc'; }
  function purchase(sku) { state.purchases[sku] = true; save(); if (window.UI) window.UI.refreshAll(); }
  // One-time premium unlock: permanent 4× battle speed for 500 LootCoins.
  // —— LOOTFLEET PRO —— $20/mo subscription: exclusive 5× speed + 2× XP while
  // active. proUntil is a timestamp; the Stripe webhook (or manual fulfilment)
  // extends it each billing cycle. grantPro is the fulfilment hook.
  function isPro() { return (state.proUntil || 0) > Date.now(); }
  function grantPro(days) {
    const base = Math.max(Date.now(), state.proUntil || 0);
    state.proUntil = base + (days || 30) * 86400000;
    save(); if (window.UI) window.UI.refreshAll();
    return state.proUntil;
  }
  // LOOTCOIN FAST-TRACK — hero-banner ship offers (Ships tab). Carrier first;
  // once owned, the banner upgrades to the Mothership.
  const LC_SHIP_OFFERS = { carrier: 25000, mothership: 75000 };
  function buyShipLC(key) {
    const price = LC_SHIP_OFFERS[key];
    if (!price || !C.SHIP_BY_KEY[key]) return { ok: false, reason: 'invalid' };
    if (state.ownedShips[key]) return { ok: false, reason: 'owned' };
    if ((state.credits || 0) < price) return { ok: false, reason: 'credits' };
    state.credits -= price;
    grantShip(key);
    save();
    return { ok: true };
  }
  function buySpeed4() {
    if (state.purchases && state.purchases.speed4lc) return { ok: false, reason: 'owned' };
    if ((state.credits || 0) < 500) return { ok: false, reason: 'credits' };
    state.credits -= 500;
    if (!state.purchases) state.purchases = {};
    state.purchases.speed4lc = true;
    save();
    return { ok: true };
  }

  // recommend the deepest zone the player can comfortably clear
  function recommendedZone() {
    const s = rt.stats || computeStats();
    // Find the deepest zone that is comfortably safe, then step DOWN for margin.
    // Conservative: each enemy hit must be a small fraction of HP and kills fast,
    // because swarms stack damage. Recommend two zones below that ceiling.
    let ceiling = 1;
    for (let d = 1; d <= state.highestUnlocked; d++) {
      const hp = C.enemyHp(d), dmg = C.enemyDamage(d);
      const ttk = hp / Math.max(1, s.theoryDps);
      const survivable = dmg < s.maxHp * 0.05;   // a hit ≤5% HP (was 12%)
      if (ttk < 1.1 && survivable) ceiling = d;   // must shred enemies (was 2.2)
    }
    return Math.max(1, ceiling - 2);
  }
  function zoneAdvice() {
    const rec = recommendedZone(), cur = state.currentDungeon, s = rt.stats;
    if (cur < 1) return { kind: 'safe', rec, msg: 'Safe Zone — no threats here. Pick a combat zone to deploy.' };
    const hp = C.enemyHp(cur), dmg = C.enemyDamage(cur), ttk = hp / Math.max(1, s.theoryDps);
    if (cur < rec) return { kind: 'up', rec, msg: `You're over-geared here — push to Zone ${rec} for better loot.` };
    if (dmg > s.maxHp * 0.22 || ttk > 6) return { kind: 'down', rec, msg: `This zone is dangerous — farm Zone ${rec} until you're stronger.` };
    return { kind: 'ok', rec, msg: `Good fit. Recommended: Zone ${rec}.` };
  }

  // --------------------------------------------------------------------------
  // SAVE / LOAD + OFFLINE (AFK) PROGRESS
  // --------------------------------------------------------------------------
  function save() { state.lastSave = Date.now(); try { if (window.ACCOUNT) window.ACCOUNT.push(state); else localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) {} }
  function load() { try { const obj = window.ACCOUNT ? window.ACCOUNT.load() : JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (!obj) return false; Object.assign(state, JSON.parse(JSON.stringify(obj))); return true; } catch (e) { return false; } }

  // Rich offline sim (always on — free). Simulates kills, loot (auto
  // collected), gold, xp, AND deaths (lost items), just like live play.
  function computeOffline() {
    const elapsed = Math.min(12 * 3600, (Date.now() - state.lastSave) / 1000);
    if (elapsed < 60) return null;
    refreshStats();
    const d = state.currentDungeon;
    const hp = C.enemyHp(d), dmg = C.enemyDamage(d);
    const kps = Math.min(5, Math.max(0.05, rt.stats.theoryDps / hp));
    const kills = Math.floor(kps * elapsed * 0.55);
    const xp = kills * C.enemyXp(d), gold = kills * C.enemyGold(d);
    state.totalKills += kills; state.gold += gold;
    // loot: roll drops, auto-collect best-by-slot, sell the rest implicitly kept
    let found = 0, lostCount = 0; const newItems = [];
    const dropP = C.dropChance(d);
    for (let i = 0; i < kills; i++) {
      if (Math.random() < dropP) { found++; const _q = qualityMult(d); if (newItems.length < 40) newItems.push(_q > 1 ? I.generate(d, rollRarityBoosted(d, _q)) : I.generate(d)); }
    }
    newItems.forEach((it) => { if (!state.equipped[it.slot]) state.equipped[it.slot] = it; else if (state.inventory.length < invCap()) state.inventory.push(it); else addSalvage(it); });
    state.itemsFound += found;
    // deaths: estimate from how dangerous the zone is
    const lethal = dmg / (rt.stats.maxHp || 1);
    const deaths = Math.floor(Math.max(0, lethal - 0.06) * elapsed / 60 * 0.8);
    for (let i = 0; i < deaths; i++) { if (dropOnDeath()) lostCount++; }
    refreshStats();
    gainXp(xp);
    return { elapsed, kills, xp, gold, found, lost: lostCount };
  }

  // --------------------------------------------------------------------------
  // INIT
  // --------------------------------------------------------------------------
  function resize() {
    const c = rt.canvas, cw = c.offsetWidth, ch = c.offsetHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr);
    rt.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rt.w = cw; rt.h = ch;
    const mul = worldMul(state.currentDungeon);
    rt.worldW = Math.round(cw * mul); rt.worldH = Math.round(ch * mul);
    rt.zoom = zoomFor(state.currentDungeon);
    if (rt.archer && (rt.archer.x === 0 || rt.archer.x > rt.worldW)) { rt.archer.x = rt.worldW/2; rt.archer.y = rt.worldH/2; }
  }
  function initPortrait() {
    rt.portraitCanvas = document.getElementById('portrait-canvas');
    if (!rt.portraitCanvas) return;
    const pr = rt.portraitCanvas, dpr = Math.min(2, window.devicePixelRatio || 1);
    rt.portW = pr.offsetWidth || 240; rt.portH = pr.offsetHeight || 200;
    pr.width = rt.portW * dpr; pr.height = rt.portH * dpr;
    rt.portraitCtx = pr.getContext('2d'); rt.portraitCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function currentWeek() {
    // ISO-ish week index since a fixed Monday epoch (2024-01-01 was a Monday)
    const epoch = Date.UTC(2024, 0, 1);
    return Math.floor((Date.now() - epoch) / (7 * 24 * 3600 * 1000));
  }

  function init() {
    rt.canvas = document.getElementById('game-canvas');
    rt.ctx = rt.canvas.getContext('2d');
    // tap a parked hull in the hangar bay to switch to it
    rt.canvas.addEventListener('click', (e) => {
      if (state.currentDungeon >= 1 || !rt.hangarHits || !rt.hangarHits.length) return;
      const rect = rt.canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width * rt.w;
      const y = (e.clientY - rect.top) / rect.height * rt.h;
      let best = null, bd = Infinity;
      for (const hreg of rt.hangarHits) {
        if (hreg.active) continue;
        const d = Math.hypot(x - hreg.x, y - hreg.y);
        if (d <= hreg.r && d < bd) { bd = d; best = hreg; }
      }
      if (best && switchShip(best.key) && window.UI) {
        window.UI.unlockToast('Now flying the ' + (C.SHIP_BY_KEY[best.key] || {}).name);
      }
    });
    const loaded = load();
    rt.archer = new E.Archer(0, 0);
    resize();
    initPortrait();
    window.addEventListener('resize', () => { resize(); });

    // assign heat (start week) for new accounts
    if (state.startWeek == null) { state.startWeek = currentWeek(); save(); }

    // migrate older saves to the ship/blueprint/drone fields
    if (!state.shipKills) state.shipKills = {};
    if (state.shipKills[state.ship] == null) state.shipKills[state.ship] = 0;
    if (!state.blueprints) state.blueprints = {};
    if (state.drones == null) state.drones = 0;
    // ---- GALAXY v3 migration: regions → one massive unified hex grid --------
    if (state.galaxyVer !== 3) {
      state.ownedSystems = {};            // the Home Citadel is neutral — no starter tile
      state.rivalTiles = {}; state.tileCd = {}; state.currentSystem = null;
      delete state.regionCd;
      state.galaxyVer = 3;
    }
    if (!state.rivalTiles) state.rivalTiles = {};
    if (!state.tileCd) state.tileCd = {};
    if (!state.galaxyFeed) state.galaxyFeed = [];
    if (state.gameSpeed > 3 && !state.secretSpeed && !(state.gameSpeed === 4 && state.purchases && state.purchases.speed4lc)) { if (state.gameSpeed !== 5) state.gameSpeed = 1; } // 4× needs its LootCoin unlock; 10× the easter egg
    if (state.gameSpeed === 5 && !isPro()) state.gameSpeed = 1; // Pro lapsed → drop the 5× tier
    // ---- COSMETICS + CREDITS (premium currency) ----
    if (!state.cosmetics) state.cosmetics = { owned: { stock: 1, none: 1 }, skin: 'stock', aura: 'none' };
    if (!state.cosmetics.owned) state.cosmetics.owned = { stock: 1, none: 1 };
    if (state.credits == null) state.credits = 500; // one-time founder bonus — try the system before payments go live
    if (!state.fleet) state.fleet = [];
    if (!state.citadelCd) state.citadelCd = {};
    // ---- ZONE-CAP: keep exactly 10 zones unlocked beyond the pilot's level (and
    // within the current 100-block). This both GRANTS the level+10 runway to fresh
    // pilots and CORRECTS saves from the old, looser unlock curve. Since pilot
    // level only ever rises, this never revokes legitimately-earned zones.
    {
      const ceil = Math.max(1, Math.min(C.zoneCap(state.highestDungeonReached || 1), unlockCeil(state.level || 1)));
      state.highestUnlocked = ceil;
      // only clamp classic free-play deploys; galaxy-tile combat is uncapped by design
      if (!state.currentSystem && state.currentDungeon > state.highestUnlocked) {
        state.currentDungeon = state.highestUnlocked;
      }
    }
    seedRivals();
    galaxyTick(); // catch up rival turf wars from time spent away

    // ---- ONE-TIME RESCALE migration (steep 1.55 curve → gentle 1.18 curve) ----
    // Compress stored gear/gold so an existing save lines up with the new,
    // slower number curve. Only the zone-scaled FLAT stats (damage/health) ride
    // the curve, so only those are rescaled; percent stats are left alone.
    if (loaded) {
      if (state.scaleVer !== 2) {
        const ratio = C.SCALE_BASE / C.OLD_SCALE_BASE;
        const fStat = (d) => Math.pow(ratio, Math.max(0, (d || 1) - 1));
        const migItem = (it) => {
          if (!it || !it.stats) return;
          const f = fStat(it.dungeon);
          if (it.stats.attackDamage) it.stats.attackDamage = Math.max(1, Math.round(it.stats.attackDamage * f));
          if (it.stats.health) it.stats.health = Math.max(1, Math.round(it.stats.health * f));
        };
        Object.keys(state.equipped || {}).forEach((k) => migItem(state.equipped[k]));
        (state.inventory || []).forEach(migItem);
        Object.keys(state.fittings || {}).forEach((sk) => { const fit = state.fittings[sk]; if (fit) Object.keys(fit).forEach((k) => migItem(fit[k])); });
        const rep = Math.max(1, state.highestDungeonReached || 1);
        state.gold = Math.floor((state.gold || 0) * Math.pow(ratio, 0.7 * (rep - 1)));
        state.xp = 0;
        state.scaleVer = 2;
        save();
      }
    } else {
      state.scaleVer = 2; // fresh account, already on the new curve
    }

    refreshStats();
    rt.archer.hp = rt.stats.maxHp;
    rt.archer.x = rt.worldW / 2; rt.archer.y = rt.worldH / 2;
    spawnDrones();
    buildNodes();
    rt.nodes.forEach((n, i) => { n.respawnT = 0.2 + i * 0.2; });
    rt.bossInit = rt.bossTimer = 600 + Math.random() * 300; rt.bossAlive = false; rt.boss = null; rt.lastBoss = -600;

    let offline = loaded ? computeOffline() : null;
    // offline resource accrual from owned systems (per-hour, capped 12h)
    accrueResources();

    // Always start docked at the home hangar on (re)login.
    state.currentSystem = null; state.currentDungeon = 0; rt.siege = null; rt.awaitingRespawn = false;
    if (rt.archer) { rt.archer.dead = false; rt.archer.killer = null; }
    resetZone();

    if (window.UI) { window.UI.init(GAME); window.UI.refreshAll(); if (offline) window.UI.showOffline(offline); }
    initTerritory(); // load + subscribe to the shared cross-account turf war

    setInterval(save, 8000);
    setInterval(() => { accrueResources(); }, 60000); // tick resources every minute
    setInterval(galaxyTick, 120000); // tick simulated rival turf wars (gently)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) save();
      else { accrueResources(); const sum = computeOffline(); if (window.UI) { window.UI.refreshAll(); if (sum) window.UI.showOffline(sum); } rt.last = performance.now(); if (window.TERRITORY && window.TERRITORY.enabled() && (!rt._terrSync || Date.now() - rt._terrSync > 60000)) { rt._terrSync = Date.now(); window.TERRITORY.loadAll().then((m) => { syncRealTiles(m); if (window.UI) window.UI.galaxyChanged(); }); } }
    });
    window.addEventListener('beforeunload', save);

    rt.running = true; rt.last = performance.now();
    requestAnimationFrame(loop);
    setInterval(() => { if (rt.running) { const now = performance.now(); if (now - rt.last > 120) step(now); } }, 1000/30);
  }

  // --------------------------------------------------------------------------
  // FORMAT HELPERS
  // --------------------------------------------------------------------------
  // DISPLAY GAUGE — every number the player SEES is compressed above 1T and
  // hard-capped at 999T. Pure presentation: damage dealt, HP pools, XP and
  // score sources keep their true values internally; only the readout shrinks.
  const GAUGE_T = 1e12;
  function gaugeNum(n) {
    if (n <= GAUGE_T) return n;
    return Math.min(999 * GAUGE_T, GAUGE_T * Math.pow(n / GAUGE_T, 0.55));
  }
  // TRUE values — the 999T display gauge is retired: damage numbers, HP, DPS
  // and every other readout now show the real amount, climbing the extended
  // unit ladder (K, M, B, T, Qa, Qi, …) instead of compressing.
  function formatNum(n) { return formatNumRaw(n); }
  function _formatNumGaugeRetired(n) {
    n = gaugeNum(n);
    if (n < 1000) return Math.floor(n).toString();
    const u = ['', 'K', 'M', 'B', 'T']; let i = 0, v = n;
    while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
    return (v >= 100 ? v.toFixed(0) : v.toFixed(2)) + u[i];
  }
  // RAW formatter — no 999T gauge. Used for Ship/Fleet Score and gold, which
  // are allowed to grow without a display ceiling.
  function formatNumRaw(n) {
    if (n < 1000) return Math.floor(n).toString();
    const u = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc']; let i = 0, v = n;
    while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
    return (v >= 100 ? v.toFixed(0) : v.toFixed(2)) + u[i];
  }
  function formatTime(sec) {
    sec = Math.floor(sec); const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
    if (h > 0) return `${h}h ${m}m`; if (m > 0) return `${m}m ${s}s`; return `${s}s`;
  }

  const GAME = {
    init, state, rt, computeStats, refreshStats,
    equip, sell, sellAllBelow, autoEquip, autoSell, autoSellPreview, selectDungeon,
    setAuto, getAuto: () => state.auto, setJoystick,
    setGameSpeed, hasSpeed, purchase, buySpeed4, buyShipLC, isPro, grantPro, respawnAt,
    buyShip, switchShip, grantShip, shipUnlocked, shipBuyState, hasBlueprint,
    fleetSlots, fleetShips, setFleetSlot, getFleet: () => state.fleet || [],
    isCitadelZone, citadelCooldownLeft,
    getCitadel: () => rt.enemies.find((en) => en.isCitadel && !en.dead) || null,
    shipDroneCount, getDrones: () => state.drones, getShipKills: (k) => (state.shipKills[k] || 0),
    skillRank, branchSpent, skillReqMet, canInvest, investSkill, resetSkills,
    getShop, shopTimeLeft, buyShopItem, getBossInfo, shopItemPrice, shopIsUpgrade,
    getLCMarket, buyLCMarket, lcCosmicTimeLeft, lcPrimTimeLeft, LC_PRICES,
    secondUnlocked: (b) => secondUnlocked(b), equipLayout,
    recommendedZone, zoneAdvice, zoneBonuses, currentWeek,
    // galaxy map
    warp, sysAt, isOwned, rivalOf, tileCooldownLeft, tileInfo, entryCostFor,
    resourceRates, getResources: () => state.resources, getSiege: () => rt.siege, getWaves: () => rt.waves,
    getGalaxyFeed: () => state.galaxyFeed || [],
    formatNum, formatNumRaw, formatTime,
    getStats: () => rt.stats, getDps: () => rt.dps, score,
    getHp: () => ({ cur: rt.archer ? rt.archer.hp : 0, max: rt.stats.maxHp, dead: rt.archer && rt.archer.dead, awaiting: rt.awaitingRespawn }),
    itemPower: I.itemPower, compare: I.compare, rarityChances: I.rarityChances, save,
    buyCosmetic, setCosmetic, addCredits,
    getCredits: () => state.credits || 0, getCosmetics: () => state.cosmetics,
    invCap, invSlotCost, buyInvSlots,
    setPickupFilter: (t) => { state.pickupFilter = Math.max(0, t | 0); save(); },
    setAutoSellTier: (t) => { state.autoSellTier = (t == null || t < 0) ? -1 : (t | 0); save(); },
    // dev/verify
    fastForward(seconds) { const dt = 1/60, n = Math.floor(seconds/dt); for (let i=0;i<n;i++){ rt.time+=dt; state.playTime+=dt; update(dt); } if (window.UI) window.UI.refreshAll(); },
  };
  window.GAME = GAME;
})();
