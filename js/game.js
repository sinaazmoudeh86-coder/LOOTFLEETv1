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
  const FIRE_RANGE = 250;         // auto-fire engagement range
  const NODE_COUNT = 9;           // base spawn nodes per zone (scales up — see nodeCount)
  // Zone-scaled feel: deeper zones get a wider world, more spawns, and a more
  // zoomed-out camera (which also makes the player look smaller).
  function worldMul(zone) { return Math.min(3.4, 1.8 + zone * 0.05); }
  function zoomFor(zone) { return Math.max(0.5, 0.92 - zone * 0.012); }
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
    currentSystem: '0,0',                 // axial key of the system you're in
    ownedSystems: { '0,0': true },        // captured systems (home owned at start)
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
    enemies: [], nodes: [], projectiles: [], particles: [], floats: [], ground: [], drones: [],
    time: 0, last: 0, running: false,
    siege: null,            // active 10-wave siege state when capturing a system
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
    // skill-tree modifiers
    const m = skillMods();
    // ship passive modifiers
    const ship = C.SHIP_BY_KEY[state.ship] || C.SHIPS[0];
    const sm = ship.mods || {};
    s.attackDamage *= (1 + (m.dmgPct + (sm.dmgPct||0)) / 100);
    s.health *= (1 + (m.hpPct + (sm.hpPct||0)) / 100);
    s.critChance += m.critChance + (sm.critChance||0);
    s.critDamage += m.critDamage + (sm.critDamage||0);
    s.moveSpeed += m.moveSpeed + (sm.moveSpeed||0);
    s.lifeSteal += m.lifeSteal + (sm.lifeSteal||0);
    s.multiShot += m.multiShot + (sm.multiShot||0);
    s.attacksPerSec = C.PLAYER_BASE.attackSpeed * (1 + (s.attackSpeed + m.atkSpeedPct + (sm.atkSpeedPct||0)) / 100);
    s.critChance = Math.min(100, s.critChance);
    s.lifeSteal = Math.min(95, s.lifeSteal);
    s.multiShot = Math.min(100, s.multiShot);
    s.maxHp = s.health;
    s.moveSpeedPx = 92 * (s.moveSpeed / 100);
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
  function refreshStats() {
    const prevMax = rt.stats ? rt.stats.maxHp : 0;
    rt.stats = computeStats();
    if (rt.archer) {
      rt.archer.maxHp = rt.stats.maxHp;
      if (prevMax <= 0) rt.archer.hp = rt.stats.maxHp;
      else rt.archer.hp = Math.min(rt.stats.maxHp, rt.archer.hp * (rt.stats.maxHp / prevMax));
    }
  }

  // --------------------------------------------------------------------------
  // LEVELING
  // --------------------------------------------------------------------------
  function gainXp(amount) {
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
    const unlock = Math.min(cap, 1 + Math.floor(state.level / 2));
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
    const count = nodeCount(state.currentDungeon);
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
  function fireAt(target, s) {
    const p = new E.Projectile(rt.archer.x, rt.archer.y, target, 0, false);
    const r = rollDamage(s); p.damage = r.dmg; p.crit = r.crit;
    p.angle = Math.atan2(target.y - rt.archer.y, target.x - rt.archer.x);
    rt.projectiles.push(p);
  }
  function fire(primary) {
    const s = rt.stats;
    rt.archer.facing = Math.atan2(primary.y - rt.archer.y, primary.x - rt.archer.x);
    rt.archer.muzzle = 1; rt.archer.recoil = 1;
    fireAt(primary, s);
    // muzzle: bright flash sparks + smoke puff + ejected casing along the aim
    const ang = rt.archer.facing;
    const mx = rt.archer.x + Math.cos(ang) * 26, my = rt.archer.y + Math.sin(ang) * 26;
    for (let i = 0; i < 6; i++) {
      const a = ang + (Math.random() - 0.5) * 0.5, sp = 150 + Math.random() * 160;
      rt.particles.push(new E.Particle(mx, my, { vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: 0.12 + Math.random()*0.12, size: 1.6 + Math.random()*2, color: i % 2 ? '#ffe6a0' : '#ffaf40', glow: true, drag: 0.82 }));
    }
    // smoke
    rt.particles.push(new E.Particle(mx, my, { vx: Math.cos(ang)*40, vy: Math.sin(ang)*40 - 10, life: 0.4, size: 5, color: 'rgba(180,180,185,0.5)', drag: 0.9 }));
    // ejected casing (sideways)
    const ej = ang + Math.PI/2;
    rt.particles.push(new E.Particle(rt.archer.x + 6, rt.archer.y - 4, { vx: Math.cos(ej)*70, vy: -120, gravity: 420, life: 0.5, size: 1.6, color: '#d9b25a' }));
    // MULTI-SHOT: chance to also fire at nearby enemies
    if (s.multiShot > 0 && Math.random() * 100 < s.multiShot) {
      const extra = nearbyEnemies(C.MULTISHOT_MAX_TARGETS, primary);
      extra.forEach((t) => fireAt(t, s));
    }
  }
  function resolveHit(p) {
    const e = p.target;
    if (!e || e.dead) return;
    const killed = e.takeDamage(p.damage);
    rt.floats.push(new E.FloatText(e.x, e.y - e.size, formatNum(p.damage), { color: p.crit ? '#e07c12' : '#15202e', size: p.crit ? 24 : 16, crit: p.crit }));
    // IMPACT: directional spray of sparks/blood opposite the bullet + flash ring
    const back = p.angle;
    const col = p.crit ? '#ffd24d' : '#ffcaa0', n = p.crit ? 16 : 9;
    for (let i = 0; i < n; i++) {
      const a = back + (Math.random() - 0.5) * 1.3, sp = (p.crit ? 230 : 150) * (0.4 + Math.random());
      rt.particles.push(new E.Particle(p.x, p.y, { vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: 0.22 + Math.random()*0.22, size: 1.4 + Math.random()*2.4, color: col, glow: p.crit, drag: 0.86 }));
    }
    // ichor/blood mist in the enemy tint
    for (let i = 0; i < 5; i++) {
      const a = Math.random()*Math.PI*2, sp = 60 + Math.random()*90;
      rt.particles.push(new E.Particle(p.x, p.y, { vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: 0.3, size: 1.5 + Math.random()*2, color: e.tint, gravity: 140, drag: 0.9 }));
    }
    // expanding impact ring (a short-lived particle styled as a ring would need ring support; use a bright flash dot)
    rt.particles.push(new E.Particle(p.x, p.y, { vx: 0, vy: 0, life: 0.14, size: p.crit ? 9 : 6, color: p.crit ? '#fff0b0' : '#ffe6c0', glow: true, drag: 1 }));
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

    if (e.isBoss) {
      // BOSS DOWN: 5x loot quality — several drops with boosted rarity
      rt.boss = null; rt.bossAlive = false; rt.lastBoss = rt.time;
      rt.bossTimer = rt.bossInit = 600 + Math.random() * 300; // reset 10–15 min
      const drops = 5;
      for (let i = 0; i < drops; i++) {
        const base = rollRarityBoosted(state.currentDungeon, qualityMult(state.currentDungeon));
        const boosted = Math.min(10, base + 3 + ((Math.random() * 2) | 0)); // ~5x quality
        const item = I.generate(state.currentDungeon, boosted);
        state.itemsFound++;
        const a = Math.PI * 2 * (i / drops), r = 26 + Math.random() * 22;
        rt.ground.push(new E.GroundItem(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r, item, false));
        lootBurst(e.x, e.y, item.rarity);
        if (window.UI) window.UI.onLoot(item, true);
      }
      // BLUEPRINT: this zone's boss may hold the schematics for a hull.
      grantBlueprintFor(state.currentDungeon);
      if (window.UI) { window.UI.bossEvent('down'); window.UI.syncStatsTab(); }
      return;
    }

    // normal kill: free node + start respawn timer; kills hasten the boss
    if (e.node) { e.node.enemy = null; e.node.respawnT = RESPAWN_SEC; }
    if (!rt.bossAlive) rt.bossTimer = Math.max(0, rt.bossTimer - 4);
    if (Math.random() < C.dropChance(state.currentDungeon)) {
      const _q = qualityMult(state.currentDungeon);
      const item = _q > 1 ? I.generate(state.currentDungeon, rollRarityBoosted(state.currentDungeon, _q)) : I.generate(state.currentDungeon);
      state.itemsFound++;
      lootBurst(e.x, e.y, item.rarity);
      rt.ground.push(new E.GroundItem(e.x, e.y, item, false));
      if (window.UI) window.UI.onLoot(item, true);
    }
    if (window.UI) window.UI.syncStatsTab();
  }

  // ---- BOSS ----------------------------------------------------------------
  function spawnBoss() {
    const pool = allowedEnemies();
    const type = pool[pool.length - 1]; // toughest type available
    const m = 40, side = (Math.random() * 4) | 0;
    let x, y;
    if (side === 0) { x = Math.random() * rt.worldW; y = m; }
    else if (side === 1) { x = rt.worldW - m; y = Math.random() * rt.worldH; }
    else if (side === 2) { x = Math.random() * rt.worldW; y = rt.worldH - m; }
    else { x = m; y = Math.random() * rt.worldH; }
    const b = new E.Enemy(type, state.currentDungeon, x, y);
    b.isBoss = true;
    b.maxHp *= 14; b.hp = b.maxHp;
    b.damage *= 2.3;
    b.size *= 2.5;
    b.speed *= 0.72;
    b.name = type.name + ' Alpha';
    rt.enemies.push(b); rt.boss = b; rt.bossAlive = true;
    burst(x, y, '#e23b4e', 50, { speed: 280, life: 1.0, glow: true });
    if (window.UI) window.UI.bossEvent('spawn');
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
  function lootBurst(x, y, rarity) {
    const col = C.RARITY[rarity].color;
    burst(x, y, col, 10 + rarity * 3, { speed: 120, life: 0.9, glow: rarity >= 2, gravity: -40 });
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
    const loot = rt.ground.filter((g) => !g.lost && !g.dead);
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

    // auto-fire nearest enemy in range
    a.attackTimer -= dt;
    if (!a.dead && a.attackTimer <= 0) {
      const tgt = nearestEnemy(FIRE_RANGE);
      if (tgt) { fire(tgt); a.attackTimer = 1 / Math.max(0.1, rt.stats.attacksPerSec); }
    }

    // enemies
    for (const e of rt.enemies) e.update(dt, a);
    separateEnemies();
    rt.enemies = rt.enemies.filter((e) => !e.dead);

    // carrier drones: orbit the ship and fire on nearby enemies
    updateDrones(dt);

    // death handling — drop a piece of gear, then auto-tow back to the hangar
    if (a.justDied) {
      a.justDied = false;
      const killer = a.killer;
      const killerName = killer ? (killer.isBoss ? killer.name : killer.type.name) : 'the swarm';
      const diedZone = state.currentDungeon;
      const lost = dropOnDeath();
      // a carrier loses one drone when the hull is downed
      if (state.drones > 0) { state.drones--; spawnDrones(); }
      rt.siege = null; // abort any in-progress siege — the system isn't captured
      burst(a.x, a.y, '#e23b4e', 30, { speed: 200, life: 0.9 });
      // no respawn menu — redeploy straight to the home hangar
      respawnAt(0);
      if (window.UI) window.UI.onDeathReturn(lost, killerName, diedZone);
    }

    // projectiles
    for (const p of rt.projectiles) { p.update(dt); if (p.hit) resolveHit(p); }
    rt.projectiles = rt.projectiles.filter((p) => !p.dead);

    // ground loot pickups (capped so heavy 10× drops don't pile up and lag)
    for (const g of rt.ground) {
      g.update(dt);
      if (!g.lost && !g.picked && !g.dead) {
        if (Math.hypot(g.x - a.x, g.y - a.y) <= PICKUP_RADIUS && !a.dead) collect(g);
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
    if (!state.equipped[item.slot]) { state.equipped[item.slot] = item; refreshStats(); }
    else { state.inventory.push(item); if (state.autoEquipAlways) autoEquip(true); }
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
    R.drawArcher(ctx, rt.archer.x, rt.archer.y, 1.5, rt.archer, state.equipped, rt.time);
    for (const dr of rt.drones) R.drawDrone(ctx, dr.x, dr.y, rt.time, dr.ang);
    for (const p of rt.projectiles) R.drawArrow(ctx, p);
    for (const f of rt.floats) R.drawFloat(ctx, f);
    ctx.restore();

    if (rt.archer.dead) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0,0,w,h);
      ctx.fillStyle = '#e23b4e'; ctx.font = '700 28px Cinzel, serif'; ctx.textAlign = 'center';
      ctx.fillText('DOWN', w/2, h/2 - 4);
      ctx.font = '600 14px Rajdhani'; ctx.fillStyle = '#ce9b78';
      ctx.fillText('Choose a zone to redeploy', w/2, h/2 + 22);
    }
    drawMinimap(ctx);
    drawPortrait();
    if (window.UI) window.UI.syncHUD(); // once per frame, not per sim-substep
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
      if (!g.lost) { ctx.shadowColor = col; ctx.shadowBlur = 12; }
      ctx.fillStyle = g.lost ? 'rgba(140,140,140,0.5)' : col;
      ctx.beginPath(); ctx.arc(g.x, g.y - 2 + yoff, 7*sc, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
      // beam for rarer drops
      if (!g.lost && it && it.rarity >= 2) {
        const bg = ctx.createLinearGradient(g.x, g.y - 40, g.x, g.y);
        bg.addColorStop(0, R.mix(col, '#000000', 0).replace('rgb','rgba').replace(')', ',0)'));
        ctx.fillStyle = `${hexToRgba(col, 0.18)}`;
        ctx.fillRect(g.x - 5*sc, g.y - 38 + yoff, 10*sc, 38);
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
    R.drawArcher(ctx, cw/2, ch*0.66, 3.6, { facing: -0.35, bob: rt.time*2.4, hurtFlash: 0, muzzle: 0, recoil: 0 }, state.equipped, rt.time);
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

  function equip(item, targetSlot) {
    const idx = state.inventory.indexOf(item); if (idx === -1) return;
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
  function addSalvage(item, acc) {
    const s = C.salvage(item); if (!s) return;
    if (!state.resources) state.resources = { fuel: 80, iron: 0, plasma: 0 };
    for (const k in s) {
      state.resources[k] = (state.resources[k] || 0) + s[k];
      if (acc) acc[k] = (acc[k] || 0) + s[k];
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
      pool = [...new Set(pool)].sort((a, b) => I.itemPower(b) - I.itemPower(a));
      targets.forEach((t, i) => { state.equipped[t] = pool[i] || null; });
      pool.slice(targets.length).forEach((it) => state.inventory.push(it));
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
    return { key, owned, active, unlocked, affordable: state.gold >= ship.price,
             hasBlueprint: bp, bpZone: ship.bpZone, prevKey: prev, prevOwned,
             killsHave: have, killsNeed: need, killsMet, price: ship.price };
  }
  function buyShip(key) {
    const ship = C.SHIP_BY_KEY[key];
    if (!ship || state.ownedShips[key]) return { ok: false, reason: 'owned' };
    if (!shipUnlocked(key)) return { ok: false, reason: 'locked' };
    if (state.gold < ship.price) return { ok: false, reason: 'gold' };
    state.gold -= ship.price;
    state.ownedShips[key] = true;
    if (state.shipKills[key] == null) state.shipKills[key] = 0;
    save();
    if (window.UI) window.UI.refreshAll();
    return { ok: true };
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
    state.currentDungeon = d;
    state.currentSystem = null;   // classic free-play deploy (not a galaxy system)
    rt.siege = null;
    state.highestDungeonReached = Math.max(state.highestDungeonReached, d);
    // pushing into a new 100-block opens the next block (still level-gated)
    const cap = C.zoneCap(state.highestDungeonReached);
    const u = Math.min(cap, 1 + Math.floor(state.level / 2));
    if (u > state.highestUnlocked) state.highestUnlocked = u;
    resetZone();
    if (window.UI) window.UI.refreshAll(); save();
  }
  // Manual respawn: only way back after death. Picks a fresh zone and redeploys.
  function respawnAt(d) {
    if (d > state.highestUnlocked) d = state.highestUnlocked;
    state.currentDungeon = d;
    state.highestDungeonReached = Math.max(state.highestDungeonReached, d);
    rt.awaitingRespawn = false;
    rt.archer.dead = false; rt.archer.killer = null;
    resetZone();
    // generous safety on redeploy: 4s invulnerability + a spawn grace window so
    // the player is never instantly swarmed after choosing a zone.
    rt.archer.hp = rt.stats.maxHp; rt.archer.invuln = 4;
    rt.nodes.forEach((n, i) => { n.respawnT = 2.2 + i * 0.45; });
    if (window.UI) window.UI.refreshAll(); save();
  }
  function resetZone() {
    rt.enemies = []; rt.projectiles = []; rt.ground = [];
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
    } else {
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
  function sysAt(k) { const p = GX.parse(k); return GX.systemAt(p.q, p.r); }
  function isOwned(k) { return !!state.ownedSystems[k]; }
  // A system is on the frontier (warpable) if it isn't owned but borders an owned one.
  function isFrontier(k) {
    if (isOwned(k)) return false;
    const p = GX.parse(k);
    return GX.neighbors(p.q, p.r).some((n) => isOwned(GX.key(n.q, n.r)));
  }
  // Visible systems = owned ∪ their neighbors (the reveal grows as you capture).
  function galaxyView() {
    const seen = {}, list = [];
    Object.keys(state.ownedSystems).forEach((k) => {
      const p = GX.parse(k);
      [{ q: p.q, r: p.r }].concat(GX.neighbors(p.q, p.r)).forEach((c) => {
        const ck = GX.key(c.q, c.r);
        if (seen[ck]) return; seen[ck] = 1;
        const s = GX.systemAt(c.q, c.r);
        list.push({ key: ck, q: c.q, r: c.r, ring: s.ring, type: s.type, resource: s.resource,
          rate: s.rate, diff: s.diff, name: s.name, owned: isOwned(ck),
          active: state.currentSystem === ck, frontier: isFrontier(ck), cost: GX.warpCost(s.ring) });
      });
    });
    return list;
  }
  function warpCostFor(k) { return GX.warpCost(sysAt(k).ring); }
  function canAfford(cost) {
    return state.resources.fuel >= (cost.fuel || 0) && state.resources.iron >= (cost.iron || 0) && state.resources.plasma >= (cost.plasma || 0);
  }
  // Begin a warp to an unowned frontier system (starts the siege). Returns
  // {ok} or {ok:false, reason}.
  function warp(k) {
    if (isOwned(k)) { enterSystem(k); return { ok: true }; }
    if (!isFrontier(k)) return { ok: false, reason: 'unreachable' };
    const cost = warpCostFor(k);
    if (!canAfford(cost)) return { ok: false, reason: 'resources' };
    state.resources.fuel -= cost.fuel || 0;
    state.resources.iron -= cost.iron || 0;
    state.resources.plasma -= cost.plasma || 0;
    enterSystem(k);
    save();
    return { ok: true };
  }
  function enterSystem(k) {
    const sys = sysAt(k);
    state.currentSystem = k;
    state.currentDungeon = sys.diff;
    if (sys.diff >= 1) {
      state.highestDungeonReached = Math.max(state.highestDungeonReached, sys.diff);
      const cap = C.zoneCap(state.highestDungeonReached);
      const u = Math.min(cap, 1 + Math.floor(state.level / 2));
      if (u > state.highestUnlocked) state.highestUnlocked = u;
    }
    const owned = isOwned(k);
    // home or any owned system = free-roam farm; an unowned system = siege
    if (sys.type === 'home' || sys.diff < 1) rt.siege = null;
    else if (owned) rt.siege = null;
    else rt.siege = { active: true, total: 10, wave: 1, bossSpawned: false, pendingBoss: false, spawnT: 1.0, boss: sys.type === 'boss' };
    rt.awaitingRespawn = false;
    if (rt.archer) { rt.archer.dead = false; rt.archer.killer = null; rt.archer.hp = (rt.stats ? rt.stats.maxHp : 100); rt.archer.invuln = 3; }
    resetZone();
    spawnDrones();
    if (window.UI) { window.UI.refreshAll(); if (rt.siege) window.UI.siegeEvent('start', rt.siege); }
    save();
  }

  // ---- SIEGE wave engine ---------------------------------------------------
  function spawnWaveEnemy() {
    const a = Math.random() * Math.PI * 2, rad = Math.min(rt.worldW, rt.worldH) * (0.28 + Math.random() * 0.18);
    const x = Math.max(30, Math.min(rt.worldW - 30, rt.archer.x + Math.cos(a) * rad));
    const y = Math.max(30, Math.min(rt.worldH - 30, rt.archer.y + Math.sin(a) * rad));
    const e = new E.Enemy(pickType(), state.currentDungeon, x, y);
    rt.enemies.push(e);
  }
  function spawnWave(n) {
    const ringN = sysAt(state.currentSystem).ring || 1;
    const count = Math.min(16, 4 + Math.floor(ringN * 0.7) + Math.floor(n * 0.7));
    for (let i = 0; i < count; i++) spawnWaveEnemy();
  }
  function spawnSiegeBoss() {
    spawnBoss();
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
  function captureSystem() {
    const k = state.currentSystem, sys = sysAt(k);
    const wasBoss = sys.type === 'boss';
    state.ownedSystems[k] = true;
    rt.siege = null;
    // boss systems pay out the rare void/eternal loot table
    if (wasBoss) bossSystemLoot(sys);
    // convert to a free-roam owned farm now that it's captured
    buildNodes();
    rt.nodes.forEach((n, i) => { n.respawnT = 0.4 + i * 0.3; });
    rt.bossInit = rt.bossTimer = 600 + Math.random() * 300; rt.lastBoss = rt.time - 600;
    burst(rt.archer.x, rt.archer.y, '#5bc06b', 40, { speed: 240, life: 1.0, glow: true });
    if (window.UI) { window.UI.siegeEvent('captured', { sys }); window.UI.refreshAll(); }
    save();
  }
  // Boss-system loot: 50% Void @~90% level, 10% Eternal @~50%, 1% Eternal @level
  function bossSystemLoot(sys) {
    const VOID = 9, ETERNAL = 10;
    const lvl = Math.max(1, sys.diff);
    const drops = [];
    if (Math.random() < 0.50) drops.push(I.generate(Math.max(1, Math.round(lvl * 0.9)), VOID));
    if (Math.random() < 0.10) drops.push(I.generate(Math.max(1, Math.round(lvl * 0.5)), ETERNAL));
    if (Math.random() < 0.01) drops.push(I.generate(lvl, ETERNAL));
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
      const s = sysAt(k);
      if (s.resource && s.rate) r[s.resource] += s.rate;
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
    if (mult === 1 || hasSpeed('speed' + mult)) { state.gameSpeed = mult; save(); return true; }
    return false;
  }
  function hasSpeed(sku) { return !!state.purchases[sku]; }
  function purchase(sku) { state.purchases[sku] = true; save(); if (window.UI) window.UI.refreshAll(); }

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

  // Rich offline sim — only if AFK Mode purchased. Simulates kills, loot (auto
  // collected), gold, xp, AND deaths (lost items), just like live play.
  function computeOffline() {
    if (!state.purchases.afk) return null;
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
    newItems.forEach((it) => { if (!state.equipped[it.slot]) state.equipped[it.slot] = it; else state.inventory.push(it); });
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
    state.currentSystem = '0,0'; state.currentDungeon = 0; rt.siege = null; rt.awaitingRespawn = false;
    if (rt.archer) { rt.archer.dead = false; rt.archer.killer = null; }
    resetZone();

    if (window.UI) { window.UI.init(GAME); window.UI.refreshAll(); if (offline) window.UI.showOffline(offline); }

    setInterval(save, 8000);
    setInterval(() => { accrueResources(); }, 60000); // tick resources every minute
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) save();
      else { accrueResources(); const sum = computeOffline(); if (window.UI) { window.UI.refreshAll(); if (sum) window.UI.showOffline(sum); } rt.last = performance.now(); }
    });
    window.addEventListener('beforeunload', save);

    rt.running = true; rt.last = performance.now();
    requestAnimationFrame(loop);
    setInterval(() => { if (rt.running) { const now = performance.now(); if (now - rt.last > 120) step(now); } }, 1000/30);
  }

  // --------------------------------------------------------------------------
  // FORMAT HELPERS
  // --------------------------------------------------------------------------
  function formatNum(n) {
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
    setGameSpeed, hasSpeed, purchase, respawnAt,
    buyShip, switchShip, shipUnlocked, shipBuyState, hasBlueprint,
    shipDroneCount, getDrones: () => state.drones, getShipKills: (k) => (state.shipKills[k] || 0),
    skillRank, branchSpent, skillReqMet, canInvest, investSkill, resetSkills,
    getShop, shopTimeLeft, buyShopItem, getBossInfo, shopItemPrice, shopIsUpgrade,
    secondUnlocked: (b) => secondUnlocked(b), equipLayout,
    recommendedZone, zoneAdvice, zoneBonuses, currentWeek,
    // galaxy map
    galaxyView, warp, warpCostFor, canAfford, sysAt, isOwned, isFrontier,
    resourceRates, getResources: () => state.resources, getSiege: () => rt.siege,
    formatNum, formatTime,
    getStats: () => rt.stats, getDps: () => rt.dps,
    getHp: () => ({ cur: rt.archer ? rt.archer.hp : 0, max: rt.stats.maxHp, dead: rt.archer && rt.archer.dead, awaiting: rt.awaitingRespawn }),
    itemPower: I.itemPower, compare: I.compare, rarityChances: I.rarityChances, save,
    // dev/verify
    fastForward(seconds) { const dt = 1/60, n = Math.floor(seconds/dt); for (let i=0;i<n;i++){ rt.time+=dt; state.playTime+=dt; update(dt); } if (window.UI) window.UI.refreshAll(); },
  };
  window.GAME = GAME;
})();
