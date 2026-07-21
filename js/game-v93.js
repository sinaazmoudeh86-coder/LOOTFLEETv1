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
  // ZONE LOOKAHEAD — how far past your level the Grind Zone list unlocks.
  // Tightened 30% (powerleveling was too fast):
  // <100 → +35 · <200 → +28 · <300 → +14 · <400 → +7 · <500 → +4 · 500+ → +0
  function unlockCeil(level) {
    const ahead = level < 100 ? 35 : level < 200 ? 28 : level < 300 ? 14 : level < 400 ? 7 : level < 500 ? 4 : 0;
    return level + ahead;
  }
  // Inverse of unlockCeil: the LOWEST account level that unlocks zone d.
  function zoneReqLevel(d) {
    const bands = [[1, 100, 35], [100, 200, 28], [200, 300, 14], [300, 400, 7], [400, 500, 4], [500, Infinity, 0]];
    for (const [lo, hi, ahead] of bands) {
      const L = Math.max(1, d - ahead);
      if (L >= lo && L < hi) return L;
    }
    return d;
  }
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
  // Every 30th zone (30,60,90…): SWARM ZONE — 20× mob density with relentless
  // near-instant respawns, so it plays as endless waves that never stop.
  // TRADE-OFF: swarm loot is junk — low drop rate, low quality. Swarms are for
  // kills/XP/gold volume, not gearing.
  // Every 25th (25,50,75…): 2× loot quality. Every 100th (100,200…): 5× loot
  // quality. Quality bonuses STACK multiplicatively.
  // SWARM ZONES REMOVED (Jul 2026): every zone now spawns at normal density
  // with normal loot. The helpers stay exported for compatibility but are
  // permanently off.
  function densityMult(zone) { return 1; }
  // SWARM ZONE — removed; always false
  function isSwarmZone(zone) { return false; }
  // swarm loot penalties: 25% of normal drop rate, and drops roll 2 rarity
  // tiers lower (min common)
  const SWARM_DROP_MULT = 0.25, SWARM_RARITY_PENALTY = 2;
  // Every 25th (25,50,75…): bonus loot quality — capped ×2 TOTAL (zones no
  // longer stack past ×2; zone 100 is still ×2).
  function qualityMult(zone) { return Math.min(2, (zone > 0 && zone % 25 === 0 ? 2 : 1) * (zone > 0 && zone % 100 === 0 ? 5 : 1)); }
  function zoneBonuses(zone) { const d = densityMult(zone), q = qualityMult(zone); return { density: d, quality: q, prismatic: d > 1 || q > 1 }; }
  // Loot-quality multiplier = roll the rarity that many times, keep the best.
  function rollRarityBoosted(zone, mult) { let best = I.rollRarity(zone); for (let i = 1; i < mult; i++) { const r = I.rollRarity(zone); if (r > best) best = r; } return best; }
  function nodeCount(zone) { const base = NODE_COUNT + Math.floor(zone * 0.7); return Math.min(densityMult(zone) > 1 ? 100 : 30, Math.round(base * densityMult(zone))); }

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
    shipLevels: {},                       // per-ship hull upgrade level (1..20)
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
    // PILOT TREE — permanent, account-wide bonuses that benefit EVERY ship.
    const pm = (window.DREAD && window.DREAD.combatMods) ? window.DREAD.combatMods() : {};
    ['dmgPct','atkSpeedPct','critChance','critDamage','hpPct','moveSpeed','lifeSteal','multiShot'].forEach((k) => { if (pm[k]) m[k] += pm[k]; });
    // ship passive modifiers
    const ship = C.SHIP_BY_KEY[state.ship] || C.SHIPS[0];
    const sm = ship.mods || {};
    // ASCENSION — per-ship module bonuses (apply while flying that hull)
    const am = (window.ASCEND && window.ASCEND.combatMods) ? window.ASCEND.combatMods(state.ship) : {};
    // FLEET: escorts contribute a share of their hull mods to the fleet score
    const fs = { dmgPct:0, hpPct:0, critChance:0, critDamage:0, atkSpeedPct:0, moveSpeed:0, lifeSteal:0, multiShot:0, rangePct:0 };
    const esc = fleetShips();
    esc.forEach((f) => { const fm = f.mods || {}; for (const k in fs) fs[k] += (fm[k] || 0) * C.FLEET.statShare; });
    // WARDEN ARRAY: fleet-support aura from an equipped support weapon —
    // doubled while flying the Aegis (its whole reason to exist)
    const aura = I.supportAura ? I.supportAura(state.equipped.bow) : null;
    // Warden arrays mount only on the Aegis — inert anywhere else (legacy saves)
    const aMul = ship.cls === 'Aegis' ? 2 : 0;
    s.regen = (aura ? aura.regen * aMul : 0) + (pm.regen || 0);
    s.dmgReduce = Math.min(80, (aura ? Math.min(60, aura.reduce * aMul) : 0) + (pm.dmgReduce || 0) + (am.dmgReduce || 0));
    if (aura) s.multiShot += aura.multiShot * aMul;
    // SHIP HULL UPGRADES — per-ship levels bought with Galaxy Resources (+dmg/+hp/+fire rate)
    const _hl = ((state.shipLevels && state.shipLevels[state.ship]) || 1) - 1;
    const hlDmg = _hl * 10, hlHp = _hl * 12, hlAtk = _hl * 5;
    s.attackDamage *= (1 + (m.dmgPct + (sm.dmgPct||0) + fs.dmgPct + hlDmg) / 100);
    s.health *= (1 + (m.hpPct + (sm.hpPct||0) + fs.hpPct + hlHp + (am.hpPct || 0)) / 100);
    s.critChance += m.critChance + (sm.critChance||0) + fs.critChance;
    s.critDamage += m.critDamage + (sm.critDamage||0) + fs.critDamage;
    s.moveSpeed += m.moveSpeed + (sm.moveSpeed||0) + fs.moveSpeed;
    s.lifeSteal += m.lifeSteal + (sm.lifeSteal||0) + fs.lifeSteal;
    s.multiShot += m.multiShot + (sm.multiShot||0) + fs.multiShot;
    s.attacksPerSec = C.PLAYER_BASE.attackSpeed * (1 + (s.attackSpeed + m.atkSpeedPct + (sm.atkSpeedPct||0) + fs.atkSpeedPct + hlAtk + (am.atkSpeedPct || 0)) / 100);
    s.shipLevel = _hl + 1;
    s.critChance = Math.min(100, s.critChance);
    // MEATY FIRE (Jul 2026): past 2.2 shots/s and 200% multishot, extra rate
    // FOLDS INTO DAMAGE — identical DPS, a fraction of the projectiles. At
    // Lv100+ the screen stops being a hose of rounds; every shell lands huge.
    if (s.attacksPerSec > 2.2) { s.attackDamage *= s.attacksPerSec / 2.2; s.attacksPerSec = 2.2; }
    if (s.multiShot > 200) { s.attackDamage *= (1 + s.multiShot / 100) / 3; s.multiShot = 200; }
    s.lifeSteal = Math.min(95, s.lifeSteal);
    s.multiShot = Math.min(100, s.multiShot);
    s.maxHp = s.health;
    s.moveSpeedPx = 92 * (s.moveSpeed / 100);
    // weapon range — hull mod + fleet share + Warden aura all extend it
    s.fireRange = FIRE_RANGE * (1 + ((sm.rangePct || 0) + fs.rangePct + (aura ? aura.rangePct * aMul : 0) + (pm.rangePct || 0) + (am.rangePct || 0)) / 100);
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
  // Roughly how many on-level kills should equal one level past the early game.
  // Tuned so a deep-zone grind levels you in ~30 min at endgame kill rates.
  const XP_KILLS_PER_LEVEL = 18000;
  // Per-kill XP. Early on this is just the flat zone XP (fast onboarding). Once
  // the level wall dwarfs flat XP, a kill is instead worth a FIXED FRACTION of
  // your current level wall — so a level always costs ~XP_KILLS_PER_LEVEL
  // on-level kills no matter how astronomical the wall has grown. Kills in zones
  // far below your level pay only a sliver, so there's no trivial-farm shortcut.
  function killXpFor(zone) {
    const flat = C.enemyXp(zone);
    const z = zone || state.currentDungeon || 1;
    const appropriate = Math.max(0.05, Math.min(1, z / Math.max(1, state.level)));
    const fraction = C.xpToNext(state.level) / XP_KILLS_PER_LEVEL * appropriate;
    return Math.max(flat, Math.floor(fraction));
  }
  function gainXp(amount) {
    if (isPro()) amount *= 2;   // LootFleet Pro — 2× XP on every source, account-wide
    if (window.VIP) amount *= window.VIP.mult('xp');   // VIP program XP perk
    if (window.DREAD && window.DREAD.mult) amount *= window.DREAD.mult('xpGain');   // PILOT: XP Gain nodes
    if (window.ASCEND && window.ASCEND.xpMult) amount *= window.ASCEND.xpMult();    // ASCENSION: Combat Computer
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
    // One-time warning the moment a pilot crosses into the Lv 100 endgame, where a
    // destroyed ship can cost the entire hold.
    if (state.level >= 100 && !state.lv100Warned) {
      state.lv100Warned = true; save();
      if (window.UI && window.UI.showCatastropheWarning) window.UI.showCatastropheWarning();
    }
  }
  // Jump the pilot to a level (used by the secret easter eggs). Grants the
  // matching skill points and zone unlocks, then recomputes stats.
  function setLevel(n) {
    n = Math.max(1, n | 0);
    if (n <= state.level) return state.level;
    const gained = n - state.level;
    state.level = n; state.xp = 0;
    state.skillPoints = (state.skillPoints || 0) + gained * C.SKILLS.pointsPerLevel;
    onLevelUp(gained);
    return state.level;
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
    const count = Math.min(isSwarmZone(state.currentDungeon) && !state.currentSystem ? 110 : 55, Math.round(nodeCount(state.currentDungeon) * (rt.tileDensity || 1)));
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
  function fireAt(target, s, wpn, foldable) {
    const live = rt.projectiles.length;
    if (foldable && live > 90) {
      const fold = live > 180 ? 6 : 3;
      rt._foldN = (rt._foldN || 0) + 1;
      const r0 = rollDamage(s);
      if (rt._foldN % fold !== 0) {   // bank this bolt's damage into the next spawned one
        rt._bankDmg = (rt._bankDmg || 0) + r0.dmg;
        rt._bankCrit = rt._bankCrit || r0.crit;
        return null;
      }
      const p0 = new E.Projectile(rt.archer.x, rt.archer.y, target, 0, false);
      p0.damage = r0.dmg + (rt._bankDmg || 0); p0.crit = r0.crit || !!rt._bankCrit;
      rt._bankDmg = 0; rt._bankCrit = false;
      if (!wpn) wpn = nextWeapon() || (state.equipped && state.equipped.bow);
      p0.wtype = wpn && I.weaponClassOf ? I.weaponClassOf(wpn).key : 'gatling';
      p0.angle = Math.atan2(target.y - rt.archer.y, target.x - rt.archer.x);
      rt.projectiles.push(p0);
      return p0;
    }
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
      if (!e.raidTarget) rt.ebolts.push({ x: e.x + Math.cos(ang) * e.size * 0.8, y: e.y + Math.sin(ang) * e.size * 0.8,
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
        // PRISM AURA — 1% chance to deflect the hit straight back, scaled to your firepower
        if (state.shipAura && state.shipAura[state.ship] && b.src && !b.src.dead && !b.src.dying && Math.random() < 0.01) {
          const refl = Math.max(b.dmg * 3, (rt.stats.attackDamage || 0) * 4);
          const kk = b.src.takeDamage(refl);
          rt.floats.push(new E.FloatText(b.src.x, b.src.y - b.src.size, '⟲ ' + formatNum(refl), { color: '#c9a0ff', size: 26, crit: true }));
          for (let i = 0; i < 10; i++) { const aa = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 120; rt.particles.push(new E.Particle(b.src.x, b.src.y, { vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp, life: 0.4, size: 2 + Math.random() * 2, color: '#c9a0ff', glow: true, drag: 0.9 })); }
          if (kk) onKill(b.src);
        }
        burst(b.x, b.y, '#ff7a8a', 6, { speed: 140, life: 0.28, glow: true });
      }
    }
    rt.ebolts = rt.ebolts.filter((b) => !b.dead);
    if (rt.ebolts.length > 90) rt.ebolts.splice(0, rt.ebolts.length - 90);
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
      extra.forEach((t) => fireAt(t, s, null, true));   // extras fold under load
    }
  }
  // PRISM AURA splash — 10% of a hit ripples to nearby foes as AOE.
  function prismSplash(src, dmg) {
    const splash = dmg * 0.10; if (splash < 1) return;
    let hits = 0;
    for (const o of rt.enemies) {
      if (o === src || o.dead || o.dying) continue;
      if (Math.hypot(o.x - src.x, o.y - src.y) <= 130) {
        const k = o.takeDamage(splash); rt.dmgWindow.push({ t: rt.time, dmg: splash });
        if (k) onKill(o);
        if (++hits >= 5) break;
      }
    }
    rt.particles.push(new E.Particle(src.x, src.y, { vx: 0, vy: 0, life: 0.2, size: 22, color: 'rgba(201,160,255,0.45)', glow: true, drag: 1 }));
  }
  // ---- ASCENSION: STORM CONDUIT --------------------------------------------
  // Chain-lightning proc rolled PER SECOND of combat (not per attack):
  // P(dt) = 1-(1-p)^dt so any frame rate integrates to the published %/sec.
  // A HUGE bolt drops from the sky onto the nearest ship for mult× your DPS,
  // then bounces through nearly EVERY ship on the map (85% damage per hop).
  // Bolts render as real canvas polylines (white core + cyan glow) in draw().
  function stormTick(dt) {
    if (!window.ASCEND || !window.ASCEND.storm) return;
    const a = rt.archer; if (!a || a.dead || rt.awaitingRespawn) return;
    const sc = window.ASCEND.storm(state.ship);
    if (!sc || sc.chance <= 0) return;
    if (Math.random() < 1 - Math.pow(1 - sc.chance / 100, dt)) rt.stormPending = true;
    // a banked proc NEVER fizzles — if the guns wiped the map this frame, the
    // strike waits and lands on the next ship that spawns
    if (rt.stormPending) {
      const first = nearestEnemy(Infinity);
      if (first) { rt.stormPending = false; fireStorm(sc, first); }
    }
  }
  function fireStorm(sc, first) {
    const a = rt.archer;
    if (!first) first = nearestEnemy(Infinity);   // the strike hunts across the whole map
    if (!first) return;
    rt.bolts = rt.bolts || [];
    let dmg = Math.max(1, (rt.stats.theoryDps || 1) * sc.mult);
    let fx = first.x, fy = first.y - Math.max(340, rt.h * 0.6), cur = first, jumps = 0;
    const hit = new Set();
    rt.shake = Math.min(9, (rt.shake || 0) + 7);
    rt.stormFlash = 0.35;   // lingering full-screen flash
    while (cur && jumps <= sc.chains) {
      hit.add(cur);
      pushBolt(fx, fy, cur.x, cur.y, jumps === 0 ? 1.6 : 1);
      burst(cur.x, cur.y, '#bfe9ff', 22, { speed: 300, life: 0.5, glow: true });
      const k = cur.takeDamage(dmg);
      rt.dmgWindow.push({ t: rt.time, dmg });
      // ⚡ numbers hang on screen much longer than gunfire floats
      rt.floats.push(new E.FloatText(cur.x, cur.y - cur.size, '⚡' + formatNum(dmg), { color: '#8fe0ff', size: 50, crit: true, life: 2.6, vy: -16 }));
      if (k) onKill(cur);
      fx = cur.x; fy = cur.y;
      let nxt = null, bd = Infinity;   // arcs bounce to the nearest un-struck ship ANYWHERE on the map
      for (const o of rt.enemies) {
        if (o.dying || o.dead || hit.has(o)) continue;
        const d = (o.x - fx) ** 2 + (o.y - fy) ** 2;
        if (d < bd) { bd = d; nxt = o; }
      }
      cur = nxt; jumps++; dmg = Math.max(1, dmg * 0.85);
    }
  }
  // jagged polyline with 1-2 branch forks — stored on rt.bolts, drawn in draw()
  function pushBolt(x1, y1, x2, y2, scale) {
    const dx = x2 - x1, dy = y2 - y1, dist = Math.hypot(dx, dy) || 1;
    const n = Math.max(5, Math.floor(dist / 34));
    const pts = [[x1, y1]];
    for (let i = 1; i < n; i++) {
      const t = i / n, jag = (Math.random() - 0.5) * Math.min(64, dist * 0.22);
      pts.push([x1 + dx * t - (dy / dist) * jag, y1 + dy * t + (dx / dist) * jag]);
    }
    pts.push([x2, y2]);
    rt.bolts.push({ pts, life: 1.15, t: 1.15, w: 5.5 * (scale || 1) });
    // forks: short offshoots from mid-points
    for (let f = 0; f < 2; f++) {
      const bi = 1 + Math.floor(Math.random() * (pts.length - 2));
      const [bx, by] = pts[bi], fa = Math.random() * Math.PI * 2, fl = 30 + Math.random() * 70;
      rt.bolts.push({ pts: [[bx, by], [bx + Math.cos(fa) * fl * 0.5 + (Math.random() - 0.5) * 24, by + Math.sin(fa) * fl * 0.5], [bx + Math.cos(fa) * fl, by + Math.sin(fa) * fl]], life: 0.8, t: 0.8, w: 2.2 });
    }
    // lingering ember trail along the bolt path
    for (let i = 0; i < pts.length; i += 2) {
      rt.particles.push(new E.Particle(pts[i][0], pts[i][1], { vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 20, life: 1.1 + Math.random() * 0.5, size: 1.8 + Math.random() * 2, color: '#9fdcff', glow: true, drag: 0.96 }));
    }
    rt.particles.push(new E.Particle(x2, y2, { vx: 0, vy: 0, life: 0.6, size: 26, color: '#eaf9ff', glow: true, drag: 1 }));
  }
  function resolveHit(p) {
    const e = p.target;
    if (!e || e.dead) return;
    // PILOT: bonus damage vs bosses / elites (Dreadnaughts & Super Bosses count as both)
    let _dmg = p.damage;
    if (e.isBoss && window.DREAD && window.DREAD.dmgVs) _dmg *= window.DREAD.dmgVs(e);
    const killed = e.takeDamage(_dmg);
    // FROSTYFROST — cryo tech is FLEET tech: if a FrostyFrost is anywhere in
    // your fleet (flagship OR escort), every player bolt chills the target and
    // sometimes flash-freezes it into an ice cube. Bosses are immune.
    if (frostAboard() && !p.drone && !e.isBoss && !e.dying) {
      e.chillT = Math.max(e.chillT || 0, 2.2);
      if (Math.random() < 0.12 && !(e.frozenT > 0) && (e.frostCd || 0) <= 0) {
        e.frozenT = 1.8;
        e.frostCd = 5;                      // refreeze immunity — no cube strobing under rapid fire
        rt.floats.push(new E.FloatText(e.x, e.y - e.size - 12, 'FROZEN', { color: '#aee6ff', size: 30 }));
        for (let i = 0; i < 10; i++) {
          const a = Math.random() * Math.PI * 2, sp = 90 + Math.random() * 120;
          rt.particles.push(new E.Particle(e.x, e.y, { vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: 0.4 + Math.random()*0.3, size: 1.6 + Math.random()*2, color: i % 2 ? '#aee6ff' : '#e8f8ff', glow: true, drag: 0.86 }));
        }
      } else {
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2, sp = 50 + Math.random() * 70;
          rt.particles.push(new E.Particle(p.x, p.y, { vx: Math.cos(a)*sp, vy: Math.sin(a)*sp - 20, life: 0.3, size: 1.4, color: '#aee6ff', glow: true, drag: 0.9 }));
        }
      }
    }
    // PRISM AURA — 10% of your hit splashes as AOE to nearby foes
    if (state.shipAura && state.shipAura[state.ship]) prismSplash(e, p.damage);
    // AGGREGATED DAMAGE BUBBLES (Jul 2026): at endgame fire rates one bubble
    // per hit melted the frame rate. Damage now SUMS per enemy over a 0.25s
    // window and pops as ONE number — crit styling sticks if any hit in the
    // window crit; the final chunk always flushes on the killing blow.
    e._fbSum = (e._fbSum || 0) + _dmg;
    if (p.crit) e._fbCrit = true;
    if ((killed || rt.time - (e._fbT || 0) >= 0.25) && rt.floats.length < 22) {
      rt.floats.push(new E.FloatText(e.x, e.y - e.size, formatNum(e._fbSum), { color: e._fbCrit ? '#e07c12' : '#f4f8ff', size: e._fbCrit ? 44 : 30, crit: !!e._fbCrit }));
      e._fbT = rt.time; e._fbSum = 0; e._fbCrit = false;
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
      rt.shake = Math.min(3.5, (rt.shake || 0) + (p.crit ? 2.0 : 0.7));
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
    if (p.crit) rt.shake = Math.min(4, (rt.shake || 0) + 2.2);
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
    gainXp(killXpFor(e.dungeon) * (e.isBoss ? 12 : 1));
    state.gold += C.enemyGold(e.dungeon) * (e.isBoss ? 12 : 1) * (window.DREAD ? window.DREAD.mult('goldFind') : 1);   // PILOT: Gold Find
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

    // PRISM MINING — kills inside a Prism Field refine into Prism Ingots.
    if (state.prismRun && state.prismRun.active && window.PRISM && window.PRISM.onKill) {
      const _pn = window.PRISM.onKill(e.dungeon || state.currentDungeon, e.isBoss);
      if (_pn > 0) rt.floats.push(new E.FloatText(e.x, e.y - e.size - 26, '◈ +' + formatNum(_pn), { color: '#ff2a2f', size: 14, vy: -42, life: 0.95 }));
    }
    // PRISM FLEET — the gauntlet boss died: hand off to the event for artifact rolls.
    if (e.isPrismFleet && window.PRISMFLEET && window.PRISMFLEET.onBossKill) { try { window.PRISMFLEET.onBossKill(e); } catch (x) {} }

    if (e.isBoss) {
      const isSuper = !!e.isSuper;
      rt.boss = null; rt.bossAlive = false; rt.superBossAlive = false; rt.lastBoss = rt.time;
      rt.bossTimer = rt.bossInit = 600 + Math.random() * 300; // reset 10–15 min
      state.stats = state.stats || {}; state.stats.bossKills = (state.stats.bossKills || 0) + 1; // missions credit
      bossLoot(e, isSuper);
      // BLUEPRINT: this zone's boss may hold the schematics for a hull.
      grantBlueprintFor(state.currentDungeon);
      if (window.UI) { window.UI.bossEvent(isSuper ? 'superdown' : 'down'); window.UI.syncStatsTab(); }
      return;
    }

    // normal kill: free node + start respawn timer; kills hasten the boss.
    // SWARM ZONES respawn near-instantly — the waves must never stop.
    if (e.node) {
      const swarm = isSwarmZone(state.currentDungeon) && !state.currentSystem;
      e.node.enemy = null; e.node.respawnT = (swarm ? 1.2 : RESPAWN_SEC) / (rt.tileRespawnMult || 1);
    }
    if (!rt.bossAlive) rt.bossTimer = Math.max(0, rt.bossTimer - 4);
    // SWARM ZONES drop junk: 25% of the normal drop rate, rolled 2 tiers lower.
    const _swarmKill = isSwarmZone(state.currentDungeon) && !state.currentSystem;
    if (Math.random() < C.dropChance(state.currentDungeon) * (_swarmKill ? SWARM_DROP_MULT : 1)) {
      const _q = _swarmKill ? 1 : lootQ();
      let item = _q > 1 ? I.generate(state.currentDungeon, rollRarityBoosted(state.currentDungeon, _q)) : I.generate(state.currentDungeon);
      if (_swarmKill && item.rarity > 0) item = I.generate(state.currentDungeon, Math.max(0, item.rarity - SWARM_RARITY_PENALTY));
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

  function spawnFleetBoss(stage) {
    const pool = allowedEnemies();
    const type = pool[pool.length - 1];
    const cx = rt.worldW / 2, cy = rt.worldH * 0.26;
    const b = new E.Enemy(type, state.currentDungeon, cx, cy);
    b.isBoss = true; b.isPrismFleet = true; b.fleetStage = stage;
    const dps = Math.max(1, (rt.stats && rt.stats.theoryDps) || 1);
    const ttk = 12 * Math.pow(1.5, stage - 1);   // seconds-to-kill grows exponentially with stage
    b.maxHp = b.hp = Math.max(5000, Math.round(dps * ttk));
    b.damage = (b.damage || 10) * (1 + stage * 0.3);
    b.speed *= 0.5; b.size = 96; b.ranged = true; b.range = 470; b.fireCd = 2.0; b.fireT = 1.0;
    b.tint = '#c9a0ff'; b.name = 'Prism Fleet · Stage ' + stage;
    rt.enemies.push(b); rt.boss = b; rt.bossAlive = true; rt.superBossAlive = false;
    burst(cx, cy, '#c9a0ff', 70, { speed: 320, life: 1.1, glow: true });
    return b;
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
  // ---- DREADNAUGHT raid boss (Dreadnaught Hunt) ----------------------------
  const _dreadImgCache = {};
  function dreadImg(tier) {
    const n = ((Math.max(1, tier) - 1) % 6) + 1;
    if (!_dreadImgCache[n]) { const im = new Image(); im.src = 'ships/dread-' + n + '.png'; _dreadImgCache[n] = im; }
    return _dreadImgCache[n];
  }
  function dreadLevelFor(tier) { return 5 + tier * 25; }   // tier1→30, tier2→55, tier3→80 …
  function spawnDreadnaught(tier) {
    const pool = allowedEnemies();
    const type = pool[pool.length - 1];
    const cx = rt.worldW / 2, cy = rt.worldH * 0.24;
    const b = new E.Enemy(type, state.currentDungeon, cx, cy);
    b.isBoss = true; b.isSuper = true; b.isDread = true; b.dreadTier = tier;
    // HP is anchored to the player's own DPS so a Dreadnaught is ALWAYS a real
    // raid (a long, multi-phase fight) no matter how over- or under-geared you are.
    const dps = Math.max(1, (rt.stats && rt.stats.theoryDps) || 1);
    const ttk = 26 + tier * 6;
    b.maxHp = b.hp = Math.max(20000, Math.round(dps * ttk));
    b.damage = (b.damage || 10) * (2.2 + tier * 0.1);
    b.speed *= 0.42; b.size = 118 + Math.min(54, tier * 4);
    b.ranged = true; b.range = 560; b.fireCd = 1.3; b.fireT = 1.2;
    b.tint = '#ff2a3a';
    b.spriteImg = dreadImg(tier);
    b.name = 'DREADNAUGHT · Lv ' + dreadLevelFor(tier);
    rt.enemies.push(b); rt.boss = b; rt.bossAlive = true; rt.superBossAlive = true;
    burst(cx, cy, '#ff2a3a', 110, { speed: 380, life: 1.3, glow: true });
    if (window.UI) window.UI.bossEvent('super');
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

  // CATASTROPHIC LOSS (Lv 100+) — a destroyed ship can claim your WHOLE hold. Every
  // item is rolled in turn at HALF the previous chance: 100% · 50% · 25% · 12.5% …
  // Best gear is rolled first, so the guaranteed loss always stings.
  function catastrophicLoss() {
    const pool = [];
    C.SLOT_KEYS.forEach((s) => { if (state.equipped[s]) pool.push({ from: 'eq', slot: s, item: state.equipped[s] }); });
    state.inventory.forEach((it) => pool.push({ from: 'inv', item: it }));
    if (!pool.length) return [];
    pool.sort((a, b) => I.itemPower(b.item) - I.itemPower(a.item));
    const lost = []; let chance = 1;
    for (const p of pool) {
      if (Math.random() < chance) {
        if (p.from === 'eq') state.equipped[p.slot] = null;
        else { const idx = state.inventory.indexOf(p.item); if (idx >= 0) state.inventory.splice(idx, 1); }
        lost.push(p.item); state.itemsLost++;
        rt.ground.push(new E.GroundItem(rt.archer.x + (Math.random() - 0.5) * 32, rt.archer.y + 8 + Math.random() * 14, p.item, true));
      }
      chance *= 0.5;
    }
    if (lost.length) refreshStats();
    burst(rt.archer.x, rt.archer.y, '#888', 22, { speed: 150, life: 0.9 });
    return lost;
  }

  // --------------------------------------------------------------------------
  // PARTICLES
  // --------------------------------------------------------------------------
  function burst(x, y, color, n, opts = {}) {
    const pc = rt.particles.length;
    if (pc > 240) return;                                 // particle budget
    const speed = (opts.speed ?? 140) * 1.25;
    n = Math.ceil(n * 1.7);                               // more debris everywhere
    if (pc > 160) n = Math.max(1, Math.ceil(n * 0.3));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = speed * (0.3 + Math.random() * 0.8);
      rt.particles.push(new E.Particle(x, y, { vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: (opts.life ?? 0.6)*(0.7+Math.random()*0.7), size: (opts.size ?? (2+Math.random()*2.5)) * 1.5, color, gravity: opts.gravity ?? 0, glow: true }));
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
    if (empty || I.itemPower(item) > weakest) return true;
    // FLEET-AWARE (Jul 2026): a drop that upgrades ANY escort's fitting is kept
    // too — auto-sell must never scrap gear the rest of the fleet needs.
    for (const sh of fleetShips()) {
      if (!canMountWeapon(item, sh.cls)) continue;
      const fit = (state.fittings || {})[sh.key] || {};
      const eT = C.shipSlots(sh.key).filter((sk) => C.slotBase(sk) === item.slot);
      for (const t of eT) { const e = fit[t]; if (!e || I.itemPower(item) > I.itemPower(e)) return true; }
    }
    return false;
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
    const qMul = Math.min(2, qualityMult(zone) * (rt.tileLoot || 1) * (isSuper ? 2 : 1));
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
    const loot = rt.ground.filter((g) => !g.lost && !g.dead && Math.hypot(g.x - a.x, g.y - a.y) > MAGNET_RADIUS * (window.DREAD ? window.DREAD.mult('pickupRadius') : 1) * 0.9);
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
    // ADAPTIVE TIME-SCALE — simulate gameSpeed× time in as FEW sub-steps as
    // stability allows (each ≤ 50ms of sim time) instead of gameSpeed FULL
    // update passes per frame. 4×/5×/10× used to run 4/5/10 whole sim passes
    // every frame — the CPU cost cratered the frame rate and made movement
    // choppy. Same wall-clock speed, ~half to a quarter of the work:
    //   1× → 1 step · 4×/5× → 3 steps · 10× → 5 steps (at 60fps) — sub-step
    //   dt stays ≤35ms so motion, trails and homing keep their smooth feel.
    const total = dt * Math.max(1, state.gameSpeed | 0);
    const steps = Math.min(6, Math.max(1, Math.ceil(total / 0.035)));
    const sdt = total / steps;
    for (let i = 0; i < steps; i++) { rt.time += sdt; state.playTime += sdt; update(sdt); }
    // RENDER GATE — the simulation above always runs (so idle farming, boss
    // timers and offline progress are never starved), but we only PAINT when the
    // canvas is actually on-screen: skip drawing while the tab is hidden or while
    // an opaque full-screen overlay (any menu, or the Fleet Rank panel) covers
    // the battle view. This is the single biggest CPU/GPU/battery saver — a
    // backgrounded or menu'd idle session stops doing per-frame additive-bloom
    // canvas work entirely. (querySelector here is a cheap selector match — no
    // layout/reflow — so it is fine to run once per frame.)
    if (document.hidden) return;
    if (document.querySelector('.screen.overlay.active')) {
      // Battle view is hidden behind a menu — skip the expensive canvas paint,
      // but keep the always-visible top HUD (level, XP, HP, gold) live so combat
      // progress still shows on EVERY tab while farming. Cheap throttled DOM
      // writes only, same ~8Hz cadence as the in-draw() call.
      if (window.UI && (!rt._hudT || rt.time - rt._hudT > 0.12)) { rt._hudT = rt.time; window.UI.syncHUD(); }
      return;
    }
    draw();
  }
  function loop(now) { if (!rt.running) return; step(now); requestAnimationFrame(loop); }

  function update(dt) {
    const a = rt.archer;
    // SCREEN SHAKE decay — time-based and done HERE (in the sim step) not in
    // draw(). Hits add shake from inside update(), and at high game speed update
    // runs many times per frame; decaying per-step keeps add vs. decay balanced
    // so sustained fire no longer pins shake at the cap and vibrates the whole
    // scene (that was the "stutter while shooting"). ~0.85/frame equivalent.
    if (rt.shake) { rt.shake *= Math.exp(-9.75 * dt); if (rt.shake < 0.3) rt.shake = 0; }
    // OBLIVION construction clock — grant the hull the moment its 2-week build lands
    if (state.construction) { update._cc = (update._cc || 0) + dt; if (update._cc > 1) { update._cc = 0; checkConstruction(); } }
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
    if (state.prismFleetRun && state.prismFleetRun.active) {
      // PRISM FLEET — no zone spawns; only the gauntlet boss (managed via PRISMFLEET.tick).
    } else if (rt.siege && rt.siege.active) {
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
    // ASCENSION: Storm Conduit — per-second chain-lightning proc
    stormTick(dt);

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
    // VERIDIAN RESONANCE AURA — constant burn to everything near the ship,
    // scaling with the pilot's own DPS (35% of theoretical DPS across the field).
    if (state.ship === 'veridian' && rt.archer && !rt.archer.dead) {
      const R = 260, a = rt.archer;
      const aps = ((rt.stats && rt.stats.theoryDps) || 0) * 0.35;
      if (aps > 0) {
        rt.vaFloatT = (rt.vaFloatT || 0) - dt;
        for (const en of rt.enemies) {
          if (en.dead || en.dying) continue;
          if (Math.hypot(en.x - a.x, en.y - a.y) > R + en.size) continue;
          const dmg = aps * dt;
          const k = en.takeDamage(dmg);
          rt.dmgWindow.push({ t: rt.time, dmg });
          if (rt.vaFloatT <= 0 && rt.floats.length < 24) {
            rt.floats.push(new E.FloatText(en.x, en.y - en.size, formatNum(aps) + '/s', { color: '#7dff9e', size: 22 }));
            rt.vaFloatT = 0.7;
          }
          if (k) onKill(en);
        }
      }
    }
    // FLEET escorts: formation flight, escort fire, Warden support pulses
    updateEscorts(dt);
    // PRISM MINING — defend-the-dig layer (ore field + miners) riding on top of
    // the real combat sim. Only active inside a Prism Field run.
    if (state.prismRun && state.prismRun.active && window.PRISM && window.PRISM.tick) { try { window.PRISM.tick(dt, rt); } catch (e) {} }
    if (state.prismFleetRun && state.prismFleetRun.active && window.PRISMFLEET && window.PRISMFLEET.tick) { try { window.PRISMFLEET.tick(dt, rt); } catch (e) {} }
    // DREADNAUGHT HUNT — raid-boss phase logic (adds, novas, enrage) on the real sim.
    if (state.dreadRun && state.dreadRun.active && window.DREAD && window.DREAD.tick) { try { window.DREAD.tick(dt, rt); } catch (e) {} }
    // SERVER DREADNAUGHT — seasonal world-boss run (timer, stages, boss scaling).
    if (rt.sdrun && rt.sdrun.active && window.SDREAD && window.SDREAD.engineTick) { try { window.SDREAD.engineTick(dt, rt); } catch (e) {} }
    // HOME CITADEL — wave defense on the real engine (fort objective, raider waves).
    if (rt.hcrun && rt.hcrun.active && window.HOMECIT && window.HOMECIT.engineTick) { try { window.HOMECIT.engineTick(dt, rt); } catch (e) {} }

    // death handling — drop a piece of gear, then auto-tow back to the hangar
    if (a.justDied) {
      a.justDied = false;
      // SERVER DREADNAUGHT — the world boss is DESIGNED to kill you eventually:
      // an event death ends the run with NO penalty (no item loss, no hull reset).
      if (rt.sdrun && rt.sdrun.active) {
        rt.sdrun = null;
        burst(a.x, a.y, '#b04dff', 44, { speed: 240, life: 1.0 });
        respawnAt(0);
        if (window.SDREAD && window.SDREAD.onDeath) { try { window.SDREAD.onDeath(); } catch (e) {} }
        if (window.HOMECIT && window.HOMECIT.onDeath) { try { window.HOMECIT.onDeath(); } catch (e) {} }
        return;
      }
      const killer = a.killer;
      const killerName = killer ? (killer.isBoss ? killer.name : killer.type.name) : 'the swarm';
      const diedZone = state.currentDungeon;
      // ITEM LOSS ON DEATH — below Lv 100: the classic single-item drop (two in
      // deep space). At Lv 100+: CATASTROPHIC — your whole hold is at risk, each
      // item rolled at half the previous chance (100% · 50% · 25% …).
      let lost = null, lostList = null;
      if (state.level >= 100) {
        lostList = catastrophicLoss();
        lost = (lostList && lostList[0]) || null;
      } else {
        lost = dropOnDeath();
        if (rt.deepDeath) dropOnDeath(); // deep space: a second item is lost on death
      }
      // HULL RESET ON DEATH — the active hull's upgrade levels are wiped back to
      // Lv 1 and every resource spent leveling it is forfeit. The deeper you push
      // an upgraded hull, the more you risk losing.
      let hullReset = null;
      { const _hk = state.ship, _prev = (state.shipLevels && state.shipLevels[_hk]) || 1;
        if (_prev > 1) { if (!state.shipLevels) state.shipLevels = {}; state.shipLevels[_hk] = 1; refreshStats();
          hullReset = { ship: _hk, name: (C.SHIP_BY_KEY[_hk] || {}).name || 'Hull', from: _prev }; } }
      // a carrier loses one drone when the hull is downed
      if (state.drones > 0) { state.drones--; spawnDrones(); }
      rt.siege = null; rt.waves = null; // abort any in-progress siege / wave gauntlet
      burst(a.x, a.y, '#e23b4e', 30, { speed: 200, life: 0.9 });
      // no respawn menu — redeploy straight to the home hangar
      respawnAt(0);
      if (window.UI) window.UI.onDeathReturn(lost, killerName, diedZone, hullReset, lostList);
    }

    // projectiles
    for (const p of rt.projectiles) { p.update(dt); if (p.hit) resolveHit(p); }
    rt.projectiles = rt.projectiles.filter((p) => !p.dead);

    // ground loot pickups + LOOT MAGNET: drops within range fly toward the
    // player (accelerating as they near) and are collected on contact.
    const _prMul = (window.DREAD ? window.DREAD.mult('pickupRadius') : 1);   // PILOT: Loot Pickup Radius
    const _pickR = PICKUP_RADIUS * _prMul, _magR = MAGNET_RADIUS * _prMul;
    for (const g of rt.ground) {
      g.update(dt);
      if (!g.lost && !g.picked && !g.dead && !a.dead) {
        const dx = a.x - g.x, dy = a.y - g.y, d = Math.hypot(dx, dy) || 1;
        if (d <= _pickR) collect(g);
        else if (d <= _magR) {
          const k = 1 - d / _magR;            // 0 at edge → 1 near player
          const pull = MAGNET_SPEED * _prMul * (0.5 + k * 2.5);   // PILOT: radius buff also speeds the vacuum — felt, not just wider
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
    // storm bolts fade fast; flash decays
    if (rt.bolts && rt.bolts.length) { for (const b of rt.bolts) b.t -= dt; rt.bolts = rt.bolts.filter((b) => b.t > 0); }
    if (rt.stormFlash > 0) rt.stormFlash -= dt;
    if (rt.particles.length > 320) rt.particles.splice(0, rt.particles.length - 320);
    for (const f of rt.floats) f.update(dt); rt.floats = rt.floats.filter((f) => !f.dead);
    if (rt.floats.length > 60) rt.floats.splice(0, rt.floats.length - 60);

    // BATCHED EQUIP + SELL FLUSH (Jul 2026): running full-fleet autoEquip and
    // the sell sweep on EVERY pickup caused visible hitches when the magnet
    // vacuumed a siege's worth of drops — now one pass, ≥2.5/s max, covering
    // every pickup since the last flush.
    if (rt._aeDirty && rt.time - rt._aeDirty >= 0.4) {
      rt._aeDirty = 0;
      if (state.autoEquipAlways) autoEquip(true);
      autoSellSweep(null);
    }
    // dps
    rt.dmgWindow = rt.dmgWindow.filter((d) => rt.time - d.t < 2);
    rt.dps = rt.dmgWindow.reduce((s, d) => s + d.dmg, 0) / 2;
  }

  // BATTLE-END SWEEP — every arena teardown (tile secured tow, event end,
  // redeploy, respawn) COLLECTS all remaining drops instead of deleting them;
  // the magnet never has to race the tow. Lost-marker items stay lost.
  function sweepLoot() {
    for (const gi of rt.ground) { if (!gi.lost && !gi.picked && !gi.dead && gi.item) collect(gi); }
  }
  // AUTO-SELL SWEEP (Jul 2026): the fleet-aware keep filter routes most drops
  // into the bag so escorts can take upgrades — but the gear autoEquip BENCHES
  // must still auto-sell, or the bag floods and auto-sell "stops working".
  // After every pickup's equip pass, benched items at/below the auto-sell tier
  // that no longer upgrade ANY fleet slot convert to gold + salvage.
  function autoSellSweep(g) {
    const tier = autoSellTier(); if (tier < 0) return;
    let gold = 0, n = 0;
    state.inventory = state.inventory.filter((it) => {
      if (it.rarity > tier || isPickupUpgrade(it)) return true;
      gold += C.sellValue(it); addSalvage(it); n++; return false;
    });
    if (n) {
      state.gold += gold;
      const fx = g || rt.archer;
      if (fx) rt.floats.push(new E.FloatText(fx.x, fx.y - 24, '+$' + formatNum(gold) + (n > 1 ? ' (' + n + ' sold)' : ''), { color: '#e6b566', size: 12, vy: -38, life: 0.7 }));
    }
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
    else { addToInventory(item); rt._aeDirty = (rt.time || 0.001); }   // batched — see the equip/sell flush in update()
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
    // SELF-HEAL canvas fit — runs for BOTH the home-bay and combat paths, before
    // any drawing. Re-fit on a 0 backing store, or when the canvas's CSS size has
    // drifted from the cached rt.w/h (e.g. it was measured small while hidden
    // behind an overlay and the container has since grown). The home-bay branch
    // returns early, so this MUST live above it. Drift check throttled to ~4Hz so
    // we don't force a layout reflow at 60fps.
    if ((rt.canvas.height === 0 || rt.canvas.width === 0) && rt.canvas.offsetHeight > 0) resize();
    else if (!rt._fitT || rt.time - rt._fitT > 0.25) {
      rt._fitT = rt.time;
      const _ow = rt.canvas.offsetWidth, _oh = rt.canvas.offsetHeight;
      if (_oh > 0 && (Math.abs(_ow - rt.w) > 2 || Math.abs(_oh - rt.h) > 2)) resize();
    }
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
    // (shake decays in update(dt) — time-based — so it stays smooth at any game speed)
    ctx.scale(z, z);
    ctx.translate(-rt.cam.x + shx, -rt.cam.y + shy);
    R.drawArena(ctx, rt.worldW, rt.worldH, rt.time, state.currentDungeon);
    // PRISM MINING — ore field + miners, drawn in world space just above the
    // arena floor (enemies & player render on top).
    if (state.prismRun && state.prismRun.active && window.PRISM && window.PRISM.render) { try { window.PRISM.render(ctx, rt.time, rt); } catch (e) {} }
    // spawn-node markers (pending respawns)
    for (const n of rt.nodes) {
      if (!n.enemy && n.respawnT > 0) {
        const k = 1 - n.respawnT / RESPAWN_SEC;
        ctx.strokeStyle = `rgba(226,59,78,${0.25 + k*0.4})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(n.x, n.y, 6 + (1-k)*10, 0, 7); ctx.stroke();
      }
    }
    for (const p of rt.particles) R.drawParticle(ctx, p);
    // STORM CONDUIT bolts — cyan glow pass + white-hot core pass
    if (rt.bolts && rt.bolts.length) {
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const b of rt.bolts) {
        const a = Math.pow(Math.max(0, b.t / b.life), 0.6);   // slow perceived fade — bolts linger
        ctx.shadowColor = '#7fd6ff'; ctx.shadowBlur = 22 * a;
        ctx.strokeStyle = 'rgba(110,200,255,' + (0.75 * a) + ')'; ctx.lineWidth = b.w * 2.1;
        ctx.beginPath(); ctx.moveTo(b.pts[0][0], b.pts[0][1]);
        for (let i = 1; i < b.pts.length; i++) ctx.lineTo(b.pts[i][0], b.pts[i][1]);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.95 * a) + ')'; ctx.lineWidth = b.w * 0.75;
        ctx.stroke();
      }
      ctx.restore();
    }
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
    // STORM FLASH — whole-viewport lightning whiteout for a couple frames
    if (rt.stormFlash > 0) {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = 'rgba(200,235,255,' + Math.min(0.5, rt.stormFlash * 2.4) + ')';
      ctx.fillRect(0, 0, rt.w * (window.devicePixelRatio || 1), rt.h * (window.devicePixelRatio || 1));
      ctx.restore();
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
    // DREADNAUGHT raid-boss phase FX (telegraphs, novas) — drawn over the arena.
    if (window.DREAD && window.DREAD.render) { try { window.DREAD.render(ctx, rt.time, rt); } catch (e) {} }
    // SERVER DREADNAUGHT — void aura + weak-point FX over the arena.
    if (rt.sdrun && rt.sdrun.active && window.SDREAD && window.SDREAD.engineRender) { try { window.SDREAD.engineRender(ctx, rt.time, rt); } catch (e) {} }
    // HOME CITADEL — the fort, its shield and turret fire, drawn in-world.
    if (rt.hcrun && rt.hcrun.active && window.HOMECIT && window.HOMECIT.engineRender) { try { window.HOMECIT.engineRender(ctx, rt.time, rt); } catch (e) {} }
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
      // PRIMORDIAL — radiating lightning + static discharge (significantly
      // bigger than any other tier). Bolts crackle outward, rings pulse, the
      // core blooms in the tier palette (Primordial gold / Relic violet / Artifact red).
      if (!g.lost && it && tier >= 11) {
        const cx = g.x, cy = g.y - 2 + yoff, T = rt.time;
        // per-tier palette: [coreMid, coreOuter, bolt0, bolt1, bolt2, ringA, ringB, ringC]
        const PP = tier >= 13
          ? { mid: '255,120,96',  out: '255,31,46',   bolts: ['255,255,255', '255,160,140', '255,45,55'],  rings: ['255,45,55', '255,120,96', '255,200,180'] }
          : tier >= 12
          ? { mid: '200,135,255', out: '138,77,255',  bolts: ['255,255,255', '227,185,255', '170,90,255'],  rings: ['192,97,255', '138,77,255', '227,185,255'] }
          : { mid: '255,230,168', out: '255,154,216', bolts: ['255,255,255', '255,233,176', '154,210,255'], rings: ['255,230,168', '255,154,216', '154,210,255'] };
        const flick = 0.55 + 0.45 * Math.sin(T * 34 + g.bob * 6);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const cgr = ctx.createRadialGradient(cx, cy, 1, cx, cy, (16 + 8 * flick) * sc);
        cgr.addColorStop(0, 'rgba(255,255,255,' + (0.5 * fade) + ')');
        cgr.addColorStop(0.5, 'rgba(' + PP.mid + ',' + (0.3 * fade) + ')');
        cgr.addColorStop(1, 'rgba(' + PP.out + ',0)');
        ctx.fillStyle = cgr; ctx.beginPath(); ctx.arc(cx, cy, (16 + 8 * flick) * sc, 0, 7); ctx.fill();
        const RC = PP.rings;
        for (let r = 0; r < 2; r++) {
          const k = ((T * 0.85 + r * 0.5) % 1);
          ctx.globalAlpha = fade * (1 - k) * 0.55;
          ctx.strokeStyle = 'rgba(' + RC[(r + ((T * 2) | 0)) % 3] + ',1)';
          ctx.lineWidth = (2.2 * (1 - k) + 0.5) * sc;
          ctx.beginPath(); ctx.arc(cx, cy, (10 * sc) + k * 40 * sc, 0, 7); ctx.stroke();
        }
        const N = 7;
        for (let b = 0; b < N; b++) {
          if ((Math.sin(T * 24 + b * 2.3) + 1) < 0.7) continue;   // crackle gate
          const a = (b / N) * 7 + T * 0.7;
          const len = (24 + 14 * flick) * sc;
          ctx.strokeStyle = 'rgba(' + PP.bolts[b % 3] + ',1)';
          ctx.globalAlpha = fade * (0.5 + 0.5 * flick);
          ctx.lineWidth = 1.5 * sc; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(cx, cy);
          let px = cx, py = cy;
          for (let s = 1; s <= 3; s++) {
            const rr = len * s / 3;
            const jit = (s < 3 ? Math.sin(T * 38 + b * 5 + s * 2.1) * 5 * sc : 0);
            px = cx + Math.cos(a) * rr + Math.cos(a + 1.57) * jit;
            py = cy + Math.sin(a) * rr + Math.sin(a + 1.57) * jit;
            ctx.lineTo(px, py);
          }
          ctx.stroke();
          ctx.globalAlpha = fade * flick; ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(px, py, 1.5 * sc, 0, 7); ctx.fill();
        }
        ctx.restore();
        ctx.globalAlpha = 1;
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
    const sscale = (k) => (R.shipScaleOf ? R.shipScaleOf(k) : 1);   // cancel the colossal battle scale in this fit-to-frame preview
    esc.forEach((sh, i) => {
      if (!fx[i] || !R.drawEscort) return;
      ctx.save();
      ctx.translate(cw / 2 + fx[i][0] * cw, cy + fx[i][1] * ch);
      const es = 1.55 / sscale(sh.key);
      ctx.scale(es, es);
      R.drawEscort(ctx, sh.key, 0, 0, rt.time, 0);
      ctx.restore();
    });
    // flagship scales down when escorts fly so everything fits the frame
    const flagScale = esc.length >= 3 ? 2.1 : esc.length ? 2.4 : 2.9;
    R.drawArcher(ctx, cw / 2, cy, flagScale / sscale(state.ship), { facing: -0.35, bob: rt.time * 2.4, hurtFlash: 0, muzzle: 0, recoil: 0 }, state.equipped, rt.time);
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
    const ORD = ['1st ', '2nd ', '3rd ', '4th '];
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
  // UNEQUIP — pull an item off its hardpoint and back into the bag
  function unequip(slotKey) {
    const it = state.equipped[slotKey];
    if (!it) return false;
    state.equipped[slotKey] = null;
    state.inventory.push(it);
    refreshStats(); if (window.UI) window.UI.refreshAll(); save();
    return true;
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
    if (ship.megaCost) return (state.level || 1) >= (ship.reqLevel || 1);   // DREAD-class: level-gated direct buy
    // Jul 2026: no prior-hull requirement — recover the blueprint and hit the
    // TOTAL kill count with ANY ship. Kills are kills.
    return hasBlueprint(key) && (state.totalKills || 0) >= (ship.reqKills || 0);
  }
  // DREAD-class multi-currency cost helpers
  function megaShort(c) {
    if ((state.gold || 0) < (c.gold || 0)) return 'gold';
    if ((state.resources.fuel || 0) < (c.fuel || 0)) return 'fuel';
    if ((state.resources.iron || 0) < (c.iron || 0)) return 'iron';
    if ((state.resources.plasma || 0) < (c.plasma || 0)) return 'plasma';
    if (prismIngots() < (c.prism || 0)) return 'prism';
    if ((state.credits || 0) < (c.credits || 0)) return 'credits';
    if ((state.dreadCores || 0) < (c.dreadCores || 0)) return 'dreadCores';
    return null;
  }
  function megaAfford(c) { return !megaShort(c); }
  function payMega(c) {
    state.gold -= (c.gold || 0);
    state.resources.fuel -= (c.fuel || 0); state.resources.iron -= (c.iron || 0); state.resources.plasma -= (c.plasma || 0);
    if (c.prism && state.prism) state.prism.ingots -= c.prism;
    state.credits = (state.credits || 0) - (c.credits || 0);
    state.dreadCores = (state.dreadCores || 0) - (c.dreadCores || 0);
  }
  // Descriptor the store uses to render each hull's state.
  function shipBuyState(key) {
    const ship = C.SHIP_BY_KEY[key];
    const owned = !!state.ownedShips[key];
    const active = state.ship === key;
    if (ship.megaCost) {
      return { key, owned, active, unlocked: (state.level || 1) >= (ship.reqLevel || 1),
               affordable: megaAfford(ship.megaCost), megaCost: ship.megaCost, reqLevel: ship.reqLevel || 1,
               hasBlueprint: true, prevOwned: true, killsMet: true, killsHave: 0, killsNeed: 0, price: 0 };
    }
    const prev = C.shipPrevKey(key);
    const have = state.totalKills || 0;              // ANY ship — no prior-hull gate
    const need = ship.reqKills || 0;
    const bp = hasBlueprint(key);
    const prevOwned = true;
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
    // DREAD-class hulls: paid in a MIX of every currency.
    if (ship.megaCost) {
      const miss = megaShort(ship.megaCost);
      if (miss) return { ok: false, reason: miss };
      payMega(ship.megaCost);
    } else if (ship.resPrice) {
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
      if (dr.cd > 0) continue;                 // scan only when ready to fire
      let best = null, bd = C.DRONE.range * C.DRONE.range;
      for (const en of rt.enemies) { if (en.dying) continue; const d = (en.x - dr.x) ** 2 + (en.y - dr.y) ** 2; if (d < bd) { bd = d; best = en; } }
      if (best) {
        // under heavy load, drones fire HALF as often for DOUBLE damage — same
        // DPS, half the objects (the sky stays readable too)
        const crowd2 = rt.projectiles.length > 120;
        const p = new E.Projectile(dr.x, dr.y, best, 0, false);
        const crit = Math.random() * 100 < s.critChance;
        let dmg = s.attackDamage * C.DRONE.dmgFrac * (0.9 + Math.random() * 0.2);
        if (crit) dmg *= 1 + s.critDamage / 100;
        if (state.auto) dmg *= 0.8;
        p.damage = Math.max(1, Math.round(dmg * (crowd2 ? 2 : 1))); p.crit = crit; p.drone = true;
        p.angle = Math.atan2(best.y - dr.y, best.x - dr.x);
        rt.projectiles.push(p);
        dr.cd = (crowd2 ? 2 : 1) / C.DRONE.fireRate;
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
  // wide V formation — clear of even the biggest flagship sprites (Jul 2026:
  // old ±36/±66 offsets left escorts hidden UNDER a Titan-class flagship)
  const ESCORT_OFF = [[-95, 58], [95, 58], [-160, 14], [160, 14]];
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
  const LC_PRICES = { cosmic: 10000, prim: 115000, jackpot: 1000000 };
  // COSMIC JACKPOT CACHE — the 100× premium gamble (1,000,000 LootCoins). Value
  // sits BETWEEN Cosmic and Eternal on nearly every pull, with a tiny jackpot at
  // the very top of the loot table: 0.2% for one of the final two tiers (0.1%
  // Relic + 0.1% Artifact).
  function rollJackpotRarity() {
    const r = Math.random();
    if (r < 0.001) return 13;   // 0.1%  — Artifact (the ultimate)
    if (r < 0.002) return 12;   // +0.1% — Relic  → 0.2% for the final two tiers
    const r2 = Math.random();   // 99.8% — between Cosmic and Eternal
    if (r2 < 0.60) return 8;    // Cosmic
    if (r2 < 0.90) return 9;    // Void
    return 10;                  // Eternal
  }
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
    // Cosmic Jackpot Cache — one pull per hourly rotation (rolled at purchase).
    if (!lm.jackpot || lm.jackpot.window !== lcHourWindow()) {
      lm.jackpot = { window: lcHourWindow(), bought: false };
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
    } else if (kind === 'jackpot') {
      price = LC_PRICES.jackpot;
      if (lm.jackpot.bought) return { ok: false, reason: 'sold' };
      if ((state.credits || 0) < price) return { ok: false, reason: 'credits' };
      state.credits -= price;
      lm.jackpot.bought = true;
      it = I.generate(lcZone(), rollJackpotRarity());   // rolled AT purchase — the gamble
      state.inventory.push(it);
      save(); if (window.UI) window.UI.refreshAll();
      return { ok: true, item: it, jackpot: true };
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
    state.dreadRun = null;        // a normal deploy ends any Dreadnaught Hunt
    rt.sdrun = null;              // …and any Server Dreadnaught event run
    rt.siege = null;
    rt.waves = null; rt.tileDensity = rt.tileLoot = rt.tileRespawnMult = 1; rt.deepDeath = false;
    state.highestDungeonReached = Math.max(state.highestDungeonReached, d);
    // pushing into a new 100-block opens the next block (still level-gated)
    const cap = C.zoneCap(state.highestDungeonReached);
    const u = Math.min(cap, unlockCeil(state.level));
    if (u > state.highestUnlocked) state.highestUnlocked = u;
    resetZone();
    if (d >= 1 && isSwarmZone(d) && window.UI && window.UI.unlockToast) window.UI.unlockToast('☣ SWARM ZONE — 20× density · endless waves · ⚠ junk loot');
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
  // DREADNAUGHT HUNT deploy — real combat into the hunt zone, then resetZone
  // builds the 30-wave gauntlet (dread:true). Bypasses the normal unlock gate:
  // the hunt is gated by its own level requirement + weekly lockout instead.
  function startDreadHunt(tier) {
    const lvl = dreadLevelFor(tier);
    const zone = Math.max(1, Math.min(C.zoneCap ? C.zoneCap(9999) : 999, lvl));
    state.currentDungeon = zone;
    state.currentSystem = null;
    state.highestDungeonReached = Math.max(state.highestDungeonReached, zone);
    rt.tileDensity = rt.tileLoot = rt.tileRespawnMult = 1; rt.deepDeath = false;
    state.dreadRun = { active: true, tier: tier, started: Date.now() };
    resetZone();
    rt.awaitingRespawn = false; rt.archer.dead = false; rt.archer.killer = null;
    rt.archer.hp = rt.stats.maxHp; rt.archer.invuln = 4;
    if (window.UI) window.UI.refreshAll(); save();
    return true;
  }
  // SERVER DREADNAUGHT deploy — the seasonal world boss on the REAL battle
  // engine. A clean arena (no wave gauntlet, no zone nodes) with one
  // effectively-unkillable boss; window.SDREAD.engineTick owns the run timer,
  // stage scaling and rewards. Boss stats are (re)applied by the module.
  function startServerDread() {
    const zone = Math.max(1, Math.min(C.zoneCap ? C.zoneCap(9999) : 999, state.level));
    state.currentDungeon = zone;
    state.currentSystem = null;
    state.highestDungeonReached = Math.max(state.highestDungeonReached, zone);
    rt.tileDensity = rt.tileLoot = rt.tileRespawnMult = 1; rt.deepDeath = false;
    state.dreadRun = null; rt.siege = null; rt.waves = null;
    resetZone();
    // strip any siege/wave state resetZone re-armed — boss-only arena
    rt.siege = null; rt.waves = null;
    // boss-only arena — strip zone spawns; the event owns the encounter
    sweepLoot();
    rt.nodes = []; rt.enemies = []; rt.ground = [];
    rt.bossInit = rt.bossTimer = 1e9;
    rt.sdrun = { active: true, started: Date.now() };
    const b = spawnServerDreadBoss();
    rt.awaitingRespawn = false; rt.archer.dead = false; rt.archer.killer = null;
    rt.archer.hp = rt.stats.maxHp; rt.archer.invuln = 3;
    if (window.UI) window.UI.refreshAll(); save();
    return b;
  }
  // ---- SERVER DREADNAUGHT boss art — the Voidmaw (Season 1) ---------------
  let _vmBossImg = null;
  function voidmawImg() { if (!_vmBossImg) { _vmBossImg = new Image(); _vmBossImg.src = 'ships/ship-voidmaw.png'; } return _vmBossImg; }
  function spawnServerDreadBoss() {
    const pool = allowedEnemies();
    const type = pool[pool.length - 1];
    const cx = rt.worldW / 2, cy = rt.worldH * 0.24;
    const b = new E.Enemy(type, state.currentDungeon, cx, cy);
    b.isBoss = true; b.isSuper = true; b.isServerDread = true;
    // effectively unlimited HP — anchored to ~an hour of the player's own DPS so
    // the bar barely moves in a 2:30 run; the module tops it back up besides.
    const dps = Math.max(1, (rt.stats && rt.stats.theoryDps) || 1);
    b.maxHp = b.hp = Math.max(1e9, Math.round(dps * 3600));
    b.speed *= 0.4; b.size = 132;
    b.ranged = true; b.range = 600; b.fireCd = 1.5; b.fireT = 1.6;
    b.tint = '#b04dff';
    b.spriteImg = voidmawImg();
    b.name = 'VOIDMAW';
    rt.enemies.push(b); rt.boss = b; rt.bossAlive = true; rt.superBossAlive = true;
    burst(cx, cy, '#b04dff', 110, { speed: 380, life: 1.3, glow: true });
    if (window.UI) window.UI.bossEvent('super');
    return b;
  }
  // HOME CITADEL deploy — wave defense on the REAL battle engine in the pilot's
  // deepest zone (the Home Zone). Clean arena; window.HOMECIT.engineTick owns
  // spawns, the fort objective, win/lose and rewards.
  function startHomeDefense() {
    const zone = Math.max(1, Math.min(state.highestUnlocked || 1, Math.max(1, state.level)));
    state.currentDungeon = zone;
    state.currentSystem = null;
    state.highestDungeonReached = Math.max(state.highestDungeonReached, zone);
    rt.tileDensity = rt.tileLoot = rt.tileRespawnMult = 1; rt.deepDeath = false;
    state.dreadRun = null; rt.siege = null; rt.waves = null; rt.sdrun = null;
    resetZone();
    // resetZone re-arms siege/wave machinery on citadel-siege zones — the event
    // owns this arena, so strip it AGAIN after the rebuild (wave-7 citadel bug).
    rt.siege = null; rt.waves = null;
    sweepLoot();
    rt.nodes = []; rt.enemies = []; rt.ground = [];
    rt.bossInit = rt.bossTimer = 1e9;
    rt.hcrun = { active: true, zone, started: Date.now() };
    rt.awaitingRespawn = false; rt.archer.dead = false; rt.archer.killer = null;
    rt.archer.hp = rt.stats.maxHp; rt.archer.invuln = 3;
    rt.archer.x = rt.worldW / 2; rt.archer.y = rt.worldH * 0.55;   // between fort and the approach lanes
    if (window.UI) window.UI.refreshAll(); save();
    return { zone, worldW: rt.worldW, worldH: rt.worldH };
  }
  // one zone-native raider for the Home Citadel defense (real art, real AI;
  // the module sets its wave-budget HP and aims it at the fort)
  function spawnHomeRaider(x, y) {
    if (!rt.hcrun) return null;
    const pool = allowedEnemies();
    // raiders only — never the zone's boss-grade top entry
    const type = pool[(Math.random() * Math.max(1, pool.length - 1)) | 0];
    const e = new E.Enemy(type, state.currentDungeon, x, y);
    e.isBoss = false; e.isCitadel = false;
    rt.enemies.push(e);
    return e;
  }
  function endHomeDefense() {
    rt.hcrun = null;
    respawnAt(Math.max(1, state.currentDungeon || 1));
  }
  function respawnAt(d) {
    if (d > state.highestUnlocked) d = state.highestUnlocked;
    state.currentDungeon = d;
    state.highestDungeonReached = Math.max(state.highestDungeonReached, d);
    rt.awaitingRespawn = false;
    rt.archer.dead = false; rt.archer.killer = null;
    rt.waves = null; rt.sdrun = null; rt.hcrun = null; rt.tileDensity = rt.tileLoot = rt.tileRespawnMult = 1; rt.deepDeath = false;
    state.dreadRun = null;
    resetZone();
    // generous safety on redeploy: 4s invulnerability + a spawn grace window so
    // the player is never instantly swarmed after choosing a zone.
    rt.archer.hp = rt.stats.maxHp; rt.archer.invuln = 4;
    { const swarm = isSwarmZone(state.currentDungeon) && !state.currentSystem;
      rt.nodes.forEach((n, i) => { n.respawnT = swarm ? 1.5 + i * 0.07 : 2.2 + i * 0.45; }); }
    if (window.UI) window.UI.refreshAll(); save();
  }
  function resetZone() {
    state.prismRun = null;   // any (re)deploy ends a Prism Field run
    state.prismFleetRun = null;   // ...and a Prism Fleet gauntlet run
    sweepLoot();
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
    } else if (state.dreadRun && state.dreadRun.active) {
      // DREADNAUGHT HUNT — 30 escalating waves on the REAL battle engine, then the
      // Dreadnaught raid boss. Driven by updateWaveZone (dread:true).
      rt.nodes = [];
      rt.bossAlive = false; rt.boss = null; rt.bossInit = rt.bossTimer = 1e9; rt.lastBoss = rt.time;
      rt.waves = { active: true, total: 30, wave: 1, bossSpawned: false, pendingBoss: false, spawnT: 1.4, super: false, dread: true, tier: state.dreadRun.tier };
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
      // stagger initial spawns (swarm zones flood in fast)
      { const swarm = isSwarmZone(state.currentDungeon) && !state.currentSystem;
        rt.nodes.forEach((n, i) => { n.respawnT = swarm ? 0.3 + i * 0.06 : 0.2 + i * 0.25; }); }
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
  const turfOn = () => !!(window.TERRITORY && window.TERRITORY.enabled());
  // GLOBAL NPC layer — when the shared turf war is live, simulated rivals are a
  // PURE FUNCTION of (tile, UTC day): every player sees the exact same NPC
  // holdings, which shift a little each day. Real claims always override.
  function npcOwner(k) {
    if (isOwned(k)) return null;
    if (state.tileCd && (state.tileCd[k] || 0) > Date.now()) return null;   // freshly fought — leave neutral until claims stream in
    const day = Math.floor(Date.now() / 864e5);
    const s = k + '·' + day;
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    const t = sysAt(k); const ring = t ? t.ring : 8;
    const p = 0.10 + Math.min(0.16, (ring / (GX.RINGS || 25)) * 0.14);
    if ((h % 10000) / 10000 >= p) return null;
    return RIVAL_NAMES[(h >>> 8) % RIVAL_NAMES.length];
  }
  function rivalOf(k) {
    const real = rt.realTiles && rt.realTiles[k];
    if (real) {
      const myUid = turfOn() ? window.TERRITORY.myId() : null;
      return (myUid && real.ownerId === myUid) ? null : (real.ownerName || 'Operator');
    }
    if (turfOn()) return npcOwner(k);   // shared world — deterministic NPC layer, identical for everyone
    return (state.rivalTiles && state.rivalTiles[k]) || null;
  }
  // Seconds left on a tile's contest cooldown. ANY attacked/captured tile is
  // shielded for 24 h — merges the local clock with the multiplayer server's
  // cooldown_until so real-player attacks respect it too.
  function tileCooldownLeft(k) {
    let until = (state.tileCd && state.tileCd[k]) || 0;
    const real = rt.realTiles && rt.realTiles[k];
    if (real && real.cooldownUntil) { const t = new Date(real.cooldownUntil).getTime(); if (t > until) until = t; }
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
  // Effective loot-quality roll multiplier for the current tile — hard ×2 cap.
  function lootQ() { return Math.min(2, Math.max(1, Math.round(qualityMult(state.currentDungeon) * (rt.tileLoot || 1) * (window.DREAD ? window.DREAD.mult('lootQuality') : 1)))); }
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
  // ALLIED TILE — owned by a real player in MY alliance (never attackable)
  function isAllyTile(k) {
    const real = rt.realTiles && rt.realTiles[k];
    if (!real || !real.ownerId) return false;
    const my = realMyUid();
    if (my && real.ownerId === my) return false;
    return !!(window.ALLIANCE && window.ALLIANCE.isAlly && window.ALLIANCE.isAlly(real.ownerId));
  }
  function tileInfo(k) {
    const t = sysAt(k); if (!t) return null;
    return Object.assign({}, t, {
      owned: isOwned(k), rival: rivalOf(k), active: state.currentSystem === k,
      ally: isAllyTile(k),
      cooldown: tileCooldownLeft(k),
      myCitadel: hasMyCitadel(k) && isOwned(k), rivalCitadelScore: rivalCitadelScore(k), defense: rivalDefense(k),
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
    // SHARED turf war live → the local random sim must NOT mutate the map:
    // every player sees the same deterministic NPC layer + real claims instead.
    if (turfOn()) return null;
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
      // player-built citadels: higher ranks are hardened vs the rival sim
      if (hasMyCitadel(id) && Math.random() < (0.7 + 0.06 * citadelLevel(id))) return null;
      const name = rndRivalName();
      delete state.ownedSystems[id]; state.rivalTiles[id] = name;
      // a rival takeover RAZES any citadel you built there — and the tile is
      // attack-shielded for 24 h (you can't instantly take it back)
      const hadCit = !!(state.citadels && state.citadels[id]);
      if (hadCit) delete state.citadels[id];
      if (!state.tileCd) state.tileCd = {};
      state.tileCd[id] = Date.now() + 24 * 3600 * 1000;
      try { if (window.MAIL) window.MAIL.tileLost((sysAt(id) || {}).name || id, { ownerName: name, fleetScore: rivalCitadelScore(id) || 0, defense: null }, { razed: hadCit }); } catch (e) {}
      return { kind: 'lost', name, tile: id, razed: hadCit };
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
      else if (state.ownedSystems[id]) {
        delete state.ownedSystems[id];
        // lost while away — file a war report with the conqueror's fleet intel
        try { if (window.MAIL) window.MAIL.tileLost((GX.tileAt(id) || {}).name || id, r, { offline: true, razed: !!(state.citadels && state.citadels[id]) }); } catch (e) {}
        if (state.citadels && state.citadels[id]) delete state.citadels[id];
      }
      if (state.rivalTiles) delete state.rivalTiles[id]; // a real owner overrides any simulated one
    });
  }
  function onRealtimeTile(ev) {
    if (!rt.realTiles) rt.realTiles = {};
    const myUid = realMyUid();
    if (ev.deleted) { delete rt.realTiles[ev.tileId]; }
    else {
      rt.realTiles[ev.tileId] = { ownerId: ev.ownerId, ownerName: ev.ownerName, cooldownUntil: ev.cooldownUntil, citadel: !!ev.citadel, fleetScore: ev.fleetScore || 0, defense: ev.defense || null };
      if (myUid && ev.ownerId === myUid) { state.ownedSystems[ev.tileId] = true; }
      else if (state.ownedSystems[ev.tileId]) {
        delete state.ownedSystems[ev.tileId];
        const tn = (GX.tileAt(ev.tileId) || {}).name || ev.tileId;
        pushFeed(ev.ownerName + ' captured your ' + tn, true);
        try { if (window.MAIL) window.MAIL.tileLost(tn, rt.realTiles[ev.tileId], { razed: !!(state.citadels && state.citadels[ev.tileId]) }); } catch (e) {}
        if (state.citadels && state.citadels[ev.tileId]) delete state.citadels[ev.tileId];
        if (window.UI) window.UI.galaxyContestToast(ev.ownerName, tn);
      }
      if (state.rivalTiles) delete state.rivalTiles[ev.tileId];
    }
    if (window.UI) window.UI.galaxyChanged();
  }
  function initTerritory() {
    if (!(window.TERRITORY && window.TERRITORY.enabled())) return;
    rt._terrSync = Date.now();
    window.TERRITORY.loadAll().then((map) => { syncRealTiles(map); if (window.UI) window.UI.galaxyChanged(); republishOwnedTiles(map); });
    window.TERRITORY.subscribe(onRealtimeTile);
    // CONVERGENCE: realtime alone can miss (publication gaps, device sleep) —
    // re-pull the whole shared map every 60s so all players see the SAME galaxy
    if (!rt._terrIv) rt._terrIv = setInterval(() => {
      try { window.TERRITORY.loadAll().then((m) => { syncRealTiles(m); if (window.UI) window.UI.galaxyChanged(); }); } catch (e) {}
    }, 60000);
  }
  // ONE-TIME REPAIR: conquests that never reached the server (the half-migrated
  // claim_tile rejected every write for months) get republished, spaced out.
  function republishOwnedTiles(map) {
    if (state._turfRepub2) return;
    state._turfRepub2 = 1; save();
    const mine = Object.keys(state.ownedSystems || {}).filter((id) => !(map && map[id]));
    mine.slice(0, 40).forEach((id, i) => {
      setTimeout(() => {
        try { window.TERRITORY.claim(id, window.TERRITORY.myName(), 15, { citadel: !!hasMyCitadel(id), fleetScore: Math.round(score()), defense: defenseSnapshot() }); } catch (e) {}
      }, 800 + i * 400);
    });
  }
  // Tap a tile: own → deploy/farm; neutral → capture siege; rival → contest
  // (starts a 15-min region cooldown). Returns {ok} / {ok:false, reason}.
  // Effective entry cost for a tile (your own territory warps at half price).
  function entryCostFor(k) {
    const t = sysAt(k); if (!t || t.home) return null;
    const c = GX.entryCost(t.ring, t); if (!c) return null;
    const disc = isOwned(k) ? 0.5 : 1;
    const eff = {};
    for (const ck in c) eff[ck] = Math.ceil(c[ck] * disc);
    return eff;
  }
  function warp(k) {
    const tile = sysAt(k); if (!tile) return { ok: false, reason: 'invalid' };
    if (isAllyTile(k)) return { ok: false, reason: 'ally' };   // same alliance — never attackable
    if (tile.home) return { ok: false, reason: 'home' };       // the Home Citadel is neutral
    const owned = isOwned(k);
    if (!owned && tile.level > state.level + 10) return { ok: false, reason: 'locked' };
    // contest cooldown blocks EVERY non-owned warp-in (rival, neutral, citadel)
    if (!owned && tileCooldownLeft(k) > 0) return { ok: false, reason: 'cooldown' };
    // ENTRY COST — every warp burns resources; deeper rings are punishing
    const cost = entryCostFor(k);
    if (cost) {
      if (!canAfford(cost)) return { ok: false, reason: 'resources', cost };
      state.resources.fuel -= cost.fuel || 0;
      state.resources.iron -= cost.iron || 0;
      state.resources.plasma -= cost.plasma || 0;
    }
    if (!owned && (rivalOf(k) || tile.citadel)) {
      if (!state.tileCd) state.tileCd = {};
      // ATTACK SHIELD — attacking an owned tile (or any citadel) seals it for
      // 24 h: nobody can attack it again, win or lose
      state.tileCd[k] = Date.now() + 24 * 3600 * 1000;
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
      // owned Boss/Citadel tile → endless gauntlet; every 10th wave the boss is
      // the EXACT clone of the fleet holding the tile — yours: your flagship
      // model, your escorts, your ship score. (Sparring against your garrison.)
      rt.siege = null;
      const mySnap = defenseSnapshot();
      let myNm = 'YOUR'; try { const s = window.AUTH && AUTH.session && AUTH.session(); if (s && s.name) myNm = s.name; } catch (e) {}
      rt.waves = { active: true, total: 10, wave: 1, bossSpawned: false, pendingBoss: false, spawnT: 1.2, super: false, bossTile: true,
                   clone: true, cloneScore: mySnap.score, cloneDef: { name: myNm, real: true, score: mySnap.score, snap: mySnap } };
    } else if (owned) {
      rt.siege = null; rt.waves = null;
    } else if (rivalCitadelScore(k) != null) {
      // ATTACK a rival player CITADEL — waves → their CLONE FLEET → the CITADEL.
      rt.siege = null;
      rt.waves = { active: true, total: 8, wave: 1, bossSpawned: false, pendingBoss: false, spawnT: 1.2, super: false, clone: true, cloneScore: rivalCitadelScore(k), cloneDef: rivalDefense(k), thenCitadel: true, playerCit: true, claimTile: k };
    } else if (tile.citadel) {
      // CITADEL SIEGE ZONE → the full citadel-siege encounter; raze it to CLAIM it
      rt.siege = null;
      rt.waves = { active: true, total: 8, wave: 1, bossSpawned: false, pendingBoss: false, spawnT: 1.4, super: false, citadel: true, claimTile: k };
    } else if (rivalOf(k)) {
      // RIVAL-HELD tile — their CLONE FLEET garrisons it: clear the escort
      // waves, then defeat the clone to take the zone.
      rt.siege = null;
      rt.waves = { active: true, total: 6, wave: 1, bossSpawned: false, pendingBoss: false, spawnT: 1.1, super: false, clone: true, cloneScore: (rivalDefense(k) || {}).score, cloneDef: rivalDefense(k), plainTake: true, claimTile: k };
    } else {
      // neutral → capture siege (Boss Tiles end on a boss wave)
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
  function spawnCitadel(waves) {
    const pool = allowedEnemies();
    const type = pool[pool.length - 1];
    const c = new E.Enemy(type, state.currentDungeon, rt.worldW / 2, rt.worldH * 0.20);
    c.isCitadel = true; c.isBoss = true;      // boss-grade xp/gold on kill
    c.name = 'Void Citadel';
    c.maxHp *= 800; c.hp = c.maxHp;           // a fortress — a true siege grind
    // endgame clamp: with the DPS-floored base, ×800 would be a 7-minute wall.
    // Cap the siege at ~45s of the pilot's DPS — but never below the zone curve.
    {
      const dps = Math.max(1, (rt.stats && rt.stats.theoryDps) || 1);
      const curve800 = C.enemyHp(state.currentDungeon) * type.hpMod * 800;
      c.maxHp = c.hp = Math.round(Math.max(curve800, Math.min(c.maxHp, dps * 45)));
    }
    c.damage *= 0.5;
    c.size = 118; c.speed = 0;                // dominates the top of the zone
    c.ranged = true; c.range = 430; c.fireCd = 2.6; c.fireT = 1.4;
    // PLAYER-BUILT citadel (retake phase 2): named for its owner, scaled to
    // their published defense so stronger owners hold harder fortresses.
    if (waves && waves.playerCit) {
      const def = waves.cloneDef || {};
      c.name = ((def.name || 'ENEMY').toUpperCase()) + "'S CITADEL";
      const myS = Math.max(1, Math.round(score()));
      const ratio = Math.max(0.6, Math.min(5, (waves.cloneScore || myS) / myS));
      c.maxHp = c.hp = Math.round(c.maxHp * Math.min(2.2, 0.55 + ratio * 0.45));
      c.tint = '#ff6a5e';
    }
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
      const base = rollRarityBoosted(zone, Math.min(2, qualityMult(zone) * 4));
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
      if (rt.waves.playerCit) {
        captureCitadel(rt.waves.claimTile);      // rival's fortress razed → the tile flips to you
      } else {
        razeCitadelTile(rt.waves.claimTile);     // the razed fortress becomes a plain, buildable tile
        rt.razingClaim = true;                   // you razed it — keep the tile even if it was protected
        captureSystem();                         // the razed citadel becomes YOURS
      }
    } else {
      if (!state.citadelCd) state.citadelCd = {};
      state.citadelCd[zone] = Date.now() + 15 * 60 * 1000;
    }
    if (window.UI) window.UI.siegeEvent('citadeldown', {});
    buildBlueprintDropFromCitadel(zone);     // ultra-rare Oblivion-class blueprint
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
        if (s.pendingBoss) { if (s.clone) spawnCloneBoss(s.cloneScore, s.cloneDef); else if (s.citadel) spawnCitadel(s); else if (s.dread) spawnDreadnaught(s.tier); else spawnBoss({ super: s.super }); s.bossSpawned = true; s.pendingBoss = false; }
        else spawnWave(s.wave, s.dread ? (1.3 + Math.min(1.3, s.wave * 0.045)) : 1.8); // dread density ramps each wave
      }
      return;
    }
    if (rt.enemies.filter((e) => !e.dying).length > 0) return;
    if (s.bossSpawned) {
      if (s.dread) {
        // DREADNAUGHT DOWN — hand off to the hunt module (cores + weekly lock), tow home.
        s.active = false; rt.waves = null;
        if (window.DREAD && window.DREAD.onHuntCleared) { try { window.DREAD.onHuntCleared(s.tier); } catch (x) {} }
        state.dreadRun = null;
        respawnAt(0);
        return;
      }
      if (s.clone) {
        if (s.thenCitadel) {
          // CLONE FLEET DOWN — the citadel behind it powers up. Phase 2 begins.
          s.clone = false; s.thenCitadel = false; s.citadel = true;
          s.bossSpawned = false; s.pendingBoss = true; s.spawnT = 2.4; s.graceT = null;
          if (window.UI) { window.UI.siegeEvent('citadel', s); window.UI.unlockToast('⚔ Their fleet is down — now RAZE THE CITADEL'); }
          return;
        }
        // ENEMY CLONE FLEET DOWN — the zone flips to you.
        const ct = s.claimTile; s.active = false; rt.waves = null;
        if (s.plainTake) { rt.razingClaim = true; captureSystem(); }
        else captureCitadel(ct);
        return;
      }
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
    // You just razed a citadel on this tile → the claim is earned; don't let a
    // stale server protection (the old owner's fortress) hand the tile back.
    const razing = !!rt.razingClaim; rt.razingClaim = false;
    const fromRival = rivalOf(k);
    state.ownedSystems[k] = true;
    // your fresh capture is attack-shielded for 24 h
    if (!state.tileCd) state.tileCd = {};
    state.tileCd[k] = Math.max(state.tileCd[k] || 0, Date.now() + 24 * 3600 * 1000);
    if (state.rivalTiles) delete state.rivalTiles[k];
    pushFeed(fromRival ? ('You took ' + tile.name + ' from ' + fromRival) : ('You captured ' + tile.name));
    try { if (window.MAIL) window.MAIL.tileWon(tile.name, fromRival, razing); } catch (e) {}
    // REAL turf war: stake the claim on the shared server (server-authoritative,
    // atomic). If several operators raced for this tile, FIRST claim wins —
    // a rejected claim means we lost the race and must give the tile back.
    if (window.TERRITORY && window.TERRITORY.enabled()) {
      window.TERRITORY.claim(k, window.TERRITORY.myName(), 1440, razing ? { citadel: false, fleetScore: Math.round(score()), force: true, defense: defenseSnapshot() } : { fleetScore: Math.round(score()), defense: defenseSnapshot() }).then((res) => {
        if (!rt.realTiles) rt.realTiles = {};
        if (res.ok && res.row) {
          rt.realTiles[k] = { ownerId: res.row.owner_id, ownerName: res.row.owner_name, cooldownUntil: res.row.cooldown_until, citadel: !!res.row.citadel, fleetScore: res.row.fleet_score || 0, defense: res.row.defense || null };
        } else if (!razing && res.reason && /protected|cooldown/i.test(res.reason)) {
          // RACE LOST — another operator sealed the claim first (never for a
          // citadel you just razed — that tile is yours by conquest)
          delete state.ownedSystems[k];
          pushFeed('Beaten to ' + tile.name + ' — another operator sealed the claim first', true);
          try { if (window.MAIL) window.MAIL.raceLost(tile.name, (rt.realTiles[k] || {}).ownerName); } catch (e) {}
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
  // ===========================================================================
  // PLAYER CITADELS — build a fortress on an owned tile for 10× resources. Cost
  // scales hard with depth; cap of 5. Rival citadels are attackable — you fight a
  // CLONE scaled to the owner's fleet score and take the citadel on victory.
  // ===========================================================================
  const CITADEL_MAX = 50, CITADEL_MULT = 10, CITADEL_LV_MAX = 5;
  // VIP perk: +5 citadel cap per VIP level (VIP 15 = 125 citadels)
  function citadelCap() { return CITADEL_MAX + (window.VIP ? window.VIP.level() * 5 : 0); }
  // ABANDON — walk away from a tile you own: ownership, its citadel and its
  // production all release; the tile goes neutral (server claim released too).
  function abandonTile(id) {
    if (!isOwned(id)) return { ok: false, reason: 'owned' };
    const t = sysAt(id); if (!t || t.home) return { ok: false, reason: 'home' };
    delete state.ownedSystems[id];
    if (state.citadels) delete state.citadels[id];
    if (state.tileCd) delete state.tileCd[id];
    if (state.currentSystem === id) state.currentSystem = null;
    try { if (window.TERRITORY && window.TERRITORY.enabled() && window.TERRITORY.release) window.TERRITORY.release(id); } catch (e) {}
    if (rt.realTiles && rt.realTiles[id]) delete rt.realTiles[id];
    save(); if (window.UI) window.UI.galaxyChanged();
    return { ok: true };
  }
  function citadelCount() { return Object.keys(state.citadels || {}).length; }
  function hasMyCitadel(id) { return !!(state.citadels && state.citadels[id]); }
  // Citadel RANK (1..5). Each rank multiplies output (10× per rank), raises the
  // published defending fleet score (+25%/rank), and hardens it vs the rival sim.
  function citadelLevel(id) { const c = state.citadels && state.citadels[id]; return c ? (c.lv || 1) : 0; }
  function citadelOutputMult(id) { const lv = citadelLevel(id); return lv ? CITADEL_MULT * lv : 1; }
  function citadelDefenseMult(lv) { return 1 + 0.25 * (Math.max(1, lv) - 1); }
  function citadelBuildCost(id) {
    const t = sysAt(id); if (!t) return null;
    // ~10 days of THIS tile's production — proportional, never astronomical.
    const HRS = 10 * 24;
    const rate = Math.max(20, (t.rate || 20) * (t.deep ? GX.DEEP_MULT.resource : 1));
    const base = Math.round(rate * HRS);
    const main = t.resource || 'fuel';
    const cost = { fuel: 0, iron: 0, plasma: 0 };
    cost[main] = base;
    ['fuel', 'iron', 'plasma'].forEach((k) => { if (k !== main) cost[k] = Math.round(base * 0.35); });
    return cost;
  }
  function canBuildCitadel(id) {
    const t = sysAt(id);
    return !!(t && !t.home && isOwned(id) && !hasMyCitadel(id) && citadelCount() < citadelCap());
  }
  // RANK-UP cost: upgrading rank L → L+1 costs the tile's build cost × L,
  // so each rank is a real investment (1×, 2×, 3×, 4× the build price).
  function citadelUpgradeCost(id) {
    const lv = citadelLevel(id);
    if (!lv || lv >= CITADEL_LV_MAX) return null;
    const bc = citadelBuildCost(id); if (!bc) return null;
    const cost = {};
    Object.keys(bc).forEach((k) => { cost[k] = bc[k] * lv; });
    return cost;
  }
  function upgradeCitadel(id) {
    if (!isOwned(id)) return { ok: false, reason: 'owned' };   // only YOUR tiles upgrade
    if (!hasMyCitadel(id)) return { ok: false, reason: 'none' };
    const c = state.citadels[id];
    const lv = c.lv || 1;
    if (lv >= CITADEL_LV_MAX) return { ok: false, reason: 'max' };
    const cost = citadelUpgradeCost(id);
    if (!canAfford(cost)) return { ok: false, reason: 'resources' };
    state.resources.fuel -= cost.fuel || 0; state.resources.iron -= cost.iron || 0; state.resources.plasma -= cost.plasma || 0;
    c.lv = lv + 1;
    // harder to take over: republish a rank-boosted defending fleet score
    c.score = Math.round(score() * citadelDefenseMult(c.lv));
    if (window.TERRITORY && window.TERRITORY.enabled()) { try { window.TERRITORY.claim(id, window.TERRITORY.myName(), 1440, { citadel: true, fleetScore: c.score, defense: defenseSnapshot() }); } catch (e) {} }
    pushFeed('Your Citadel on ' + ((sysAt(id) || {}).name || 'a system') + ' reached Rank ' + c.lv);
    save(); if (window.UI) window.UI.refreshAll();
    return { ok: true, lv: c.lv };
  }
  function buildCitadel(id) {
    if (!isOwned(id)) return { ok: false, reason: 'owned' };
    if (hasMyCitadel(id)) return { ok: false, reason: 'exists' };
    if (citadelCount() >= citadelCap()) return { ok: false, reason: 'max' };
    const cost = citadelBuildCost(id);
    if (!canAfford(cost)) return { ok: false, reason: 'resources' };
    state.resources.fuel -= cost.fuel; state.resources.iron -= cost.iron; state.resources.plasma -= cost.plasma;
    state.citadels[id] = { score: Math.round(score()), builtAt: Date.now(), lv: 1 };
    if (window.TERRITORY && window.TERRITORY.enabled()) { try { window.TERRITORY.claim(id, window.TERRITORY.myName(), 1440, { citadel: true, fleetScore: state.citadels[id].score, defense: defenseSnapshot() }); } catch (e) {} }
    pushFeed('You raised a Citadel on ' + ((sysAt(id) || {}).name || 'a system'));
    save(); if (window.UI) window.UI.refreshAll();
    return { ok: true };
  }
  // The defending fleet score of a RIVAL player-citadel on this tile (or null).
  function rivalCitadelScore(id) {
    const real = rt.realTiles && rt.realTiles[id];
    const myUid = (window.TERRITORY && window.TERRITORY.enabled()) ? window.TERRITORY.myId() : null;
    if (real && real.citadel && !(myUid && real.ownerId === myUid)) return real.fleetScore || 1500;
    if (!isOwned(id) && state.rivalCitadels && state.rivalCitadels[id] != null) return state.rivalCitadels[id];
    return null;
  }
  // Snapshot of MY fleet, published with every claim — rivals render it in the
  // tile sheet and their client spawns the CLONE defender from it.
  function defenseSnapshot() {
    const sh = C.SHIP_BY_KEY[state.ship] || {};
    const s = rt.stats || computeStats();
    return { ship: state.ship, nm: sh.name || 'Fleet', lvl: state.level | 0,
             score: Math.round(score()), hp: Math.round(s.maxHp || 0), dps: Math.round(s.theoryDps || 0),
             esc: (typeof fleetShips === 'function' ? fleetShips().length : 0),
             escKeys: (typeof fleetShips === 'function' ? fleetShips().map((f) => f.key) : []) };
  }
  // The DEFENDING FLEET of any rival-held tile: real players publish a snapshot
  // with their claim; simulated rivals get a deterministic pseudo-fleet seeded
  // by the tile id, so the same tile always shows the same defender.
  function rivalDefense(id) {
    const real = rt.realTiles && rt.realTiles[id];
    const myUid = (window.TERRITORY && window.TERRITORY.enabled()) ? window.TERRITORY.myId() : null;
    if (real && (real.ownerId || real.ownerName) && !(myUid && real.ownerId === myUid)) {
      let d = real.defense || null;
      const sc0 = (d && d.score) || real.fleetScore || 0;
      if (!d || !d.ship) {
        // claim carries no snapshot (pre-defense claim / migration pending) —
        // reconstruct from the owner's PUBLIC leaderboard row so the panel and
        // the clone battle always show the REAL hulls that took the tile.
        let row = null;
        try { row = window.LEADERBOARD && window.LEADERBOARD.byName && window.LEADERBOARD.byName(real.ownerName); } catch (e) {}
        const fleet = (row && row._fleet && row._fleet.length) ? row._fleet.filter((k) => C.SHIP_BY_KEY[k]) : null;
        const sc = sc0 || (row && row.power) || Math.max(800, Math.round(score() * 0.8));
        const TIERS = ['battleship', 'carrier', 'supercarrier', 'titan', 'mothership'];
        const ship = (fleet && fleet[0]) || TIERS[Math.max(0, Math.min(TIERS.length - 1, Math.floor(Math.log10(Math.max(10, sc)) - 3)))];
        d = { ship, nm: (C.SHIP_BY_KEY[ship] || {}).name || ship, lvl: (row && row.level) || 0, score: sc, hp: 0, dps: 0,
              esc: fleet ? Math.min(4, Math.max(0, fleet.length - 1)) : 0, escKeys: fleet ? fleet.slice(1, 5) : [], approx: !fleet };
      }
      return { name: real.ownerName || 'Rival', real: true, citadel: !!real.citadel,
               score: (d && d.score) || sc0 || Math.max(800, Math.round(score() * 0.8)), snap: d };
    }
    const nm = rivalOf(id);
    if (!nm || isOwned(id)) return null;
    let h = 0; for (let i = 0; i < id.length; i++) h = ((h * 31 + id.charCodeAt(i)) >>> 0);
    const rnd = (h % 1000) / 1000;
    const t = sysAt(id);
    const HULLS = ['cruiser', 'battleship', 'dreadnought', 'carrier', 'supercarrier', 'titan', 'mothership'];
    const band = Math.min(HULLS.length - 1, Math.floor(((t ? t.ring : 5) / (GX.RINGS || 25)) * HULLS.length + rnd * 1.6));
    const ship = HULLS[band];
    const cit = !isOwned(id) && state.rivalCitadels && state.rivalCitadels[id] != null;
    const sc = cit ? state.rivalCitadels[id] : Math.max(400, Math.round(score() * (0.55 + rnd * 0.9)));
    const nEsc = (h >> 7) % 5;
    const escKeys = []; for (let i = 0; i < nEsc; i++) escKeys.push(HULLS[Math.max(0, band - 1 - (i % 2))]);
    return { name: nm, real: false, citadel: !!cit, score: sc,
             snap: { ship, nm: (C.SHIP_BY_KEY[ship] || {}).name || ship, lvl: Math.max(3, (t ? t.level : 10) + ((h >> 4) % 21) - 10), score: sc, hp: 0, dps: 0, esc: nEsc, escKeys } };
  }
  // CLONE FLAGSHIP boss — the EXACT visual replica of the fleet holding the
  // tile: THEIR flagship sprite, THEIR name, THEIR published ship score — and
  // their ESCORT hulls spawn alongside as real combatants, each drawn with its
  // own ship art. Beat the whole replica to take the zone.
  function spawnCloneBoss(cloneScore, def) {
    const pool = allowedEnemies(); const type = pool[pool.length - 1];
    const cx = rt.worldW / 2, cy = rt.worldH * 0.24;
    const b = new E.Enemy(type, state.currentDungeon, cx, cy);
    b.isBoss = true; b.isSuper = true; b.isClone = true;
    const dps = Math.max(1, (rt.stats && rt.stats.theoryDps) || 1);
    const myS = Math.max(1, Math.round(score()));
    // EXACT score scaling — the fight is as hard as the defender is strong
    // relative to you (wide sanity clamp only, no soft-capping).
    const ratio = Math.max(0.3, Math.min(25, (cloneScore || myS) / myS));
    const snap = def && def.snap;
    // (guard: snap may be missing entirely — a bare `snap && snap.escKeys || []`
    // chain left .slice() to crash the boss wave when a tile had no snapshot)
    const escKeys = ((snap && Array.isArray(snap.escKeys) && snap.escKeys) || []).filter((k) => k && C.SHIP_BY_KEY[k]).slice(0, 4);
    // the flagship holds ~70% of the replica's total strength; escorts the rest
    const escShare = escKeys.length ? 0.3 : 0;
    b.maxHp = b.hp = Math.max(15000, Math.round(dps * 16 * ratio * (1 - escShare)));
    b.damage = (b.damage || 10) * 2.5;
    b.speed *= 0.5; b.size = 124; b.ranged = true; b.range = 520; b.fireCd = 1.4; b.fireT = 1.1;
    if (snap && snap.ship) {
      const im = new Image(); im.src = 'ships/ship-' + snap.ship + '.png';
      b.spriteImg = im;                                   // render THEIR flagship
    }
    b.tint = '#ffce8a';
    b.name = ((def && def.name) ? def.name.toUpperCase() + "'S FLEET" : 'ENEMY CLONE FLEET') + ' · ⚡' + formatNum(cloneScore || 0);
    rt.enemies.push(b); rt.boss = b; rt.bossAlive = true; rt.superBossAlive = true;
    // ESCORT REPLICAS — their real fleet hulls, flanking the flagship
    escKeys.forEach((key, i) => {
      const ex = cx + (i % 2 === 0 ? -1 : 1) * (150 + Math.floor(i / 2) * 90);
      const ey = cy + 70 + (i % 2) * 50;
      const e2 = new E.Enemy(type, state.currentDungeon, ex, ey);
      e2.isBoss = false; e2.isCloneEscort = true;
      e2.maxHp = e2.hp = Math.max(4000, Math.round(dps * 16 * ratio * (escShare / escKeys.length)));
      e2.damage = (e2.damage || 8) * 1.4;
      e2.speed *= 0.65; e2.size = 62; e2.ranged = true; e2.range = 430; e2.fireCd = 1.9; e2.fireT = 0.7 + i * 0.4;
      const im2 = new Image(); im2.src = 'ships/ship-' + key + '.png';
      e2.spriteImg = im2;
      e2.tint = '#ffce8a';
      e2.name = ((C.SHIP_BY_KEY[key] || {}).name || key) + ' ESCORT';
      rt.enemies.push(e2);
    });
    burst(cx, cy, '#ffce8a', 90, { speed: 360, life: 1.2, glow: true });
    if (window.UI) window.UI.bossEvent('super');
    return b;
  }
  // Won a citadel siege — the enemy citadel is DESTROYED (not taken over). You
  // win the now-plain tile and can build your OWN citadel on it afterward.
  function captureCitadel(id) {
    if (state.rivalCitadels) delete state.rivalCitadels[id];
    razeCitadelTile(id);                              // strip any natural-citadel siege status → plain tile
    rt.razingClaim = true;                            // you razed it — the tile is yours, no take-back
    captureSystem();                                  // claims the (citadel-less) tile + tows home
    // clear the shared citadel flag so everyone sees the fortress is gone
    if (window.TERRITORY && window.TERRITORY.enabled()) { try { window.TERRITORY.claim(id, window.TERRITORY.myName(), 1440, { citadel: false, fleetScore: Math.round(score()), force: true, defense: defenseSnapshot() }); } catch (e) {} }
    save();
  }
  // Permanently demote a NATURAL citadel siege tile to a plain, buildable tile
  // once you've razed it. Mutates the shared tile cache so the map, rates, entry
  // logic and "build your own citadel" gate all immediately see a normal tile.
  // (silent=true when re-applying saved razings on load.)
  function razeCitadelTile(id, silent) {
    if (!id) return;
    if (!state.razedCitadels) state.razedCitadels = {};
    state.razedCitadels[id] = true;
    const t = sysAt(id);
    if (t && t.citadel) {
      t.citadel = false;
      t.type = t.resource ? 'resource' : 'combat';
      const mult = (GX && GX.CITADEL_RATE_MULT) || 100;
      t.rate = Math.max(3, Math.round((t.rate || 0) / mult)); // drop the 100× citadel yield
      if (typeof t.name === 'string') t.name = t.name.replace(/^Citadel\s+/, '');
    }
  }

  function resourceRates() {
    const r = { fuel: 0, iron: 0, plasma: 0 };
    Object.keys(state.ownedSystems).forEach((k) => {
      const t = sysAt(k); if (!t || !t.rate) return;
      // citadel tiles already carry their 100× in t.rate; deep space adds ×25
      let rate = t.rate * (t.deep ? GX.DEEP_MULT.resource : 1);
      if (state.citadels && state.citadels[k]) rate *= CITADEL_MULT * (state.citadels[k].lv || 1);   // PLAYER CITADEL — 10× per rank
      rate *= 25;   // GALAXY YIELD ×25 — holding territory is the resource engine
      r[t.resource || 'fuel'] += rate;
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
  const LC_SHIP_OFFERS = { carrier: 25000, mothership: 100000, oblivionfinal: 300000, chromafang: 500, chromaregent: 75000, frostyfrost: 50000, titansina: 1000000 };
  function buyShipLC(key) {
    const ship = C.SHIP_BY_KEY[key];
    const price = LC_SHIP_OFFERS[key];
    if (!price || !ship) return { ok: false, reason: 'invalid' };
    if (state.ownedShips[key]) return { ok: false, reason: 'owned' };
    const reqLevel = ship.purchase && ship.purchase.reqLevel;
    if (reqLevel && (state.level || 1) < reqLevel) return { ok: false, reason: 'level' };
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
  // FrostyFrost anywhere in the fleet (flagship or escort) — memoized 500ms
  function frostAboard() {
    const n = performance.now();
    if (rt._frostChk == null || n - (rt._frostT || 0) > 500) {
      rt._frostT = n;
      rt._frostChk = state.ship === 'frostyfrost' || (typeof fleetShips === 'function' && fleetShips().some((f) => f.key === 'frostyfrost'));
    }
    return rt._frostChk;
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
    const xp = kills * killXpFor(d), gold = kills * C.enemyGold(d);
    state.totalKills += kills; state.gold += gold;
    // loot: roll drops, auto-collect best-by-slot, sell the rest implicitly kept
    let found = 0, lostCount = 0; const newItems = [];
    const dropP = C.dropChance(d);
    for (let i = 0; i < kills; i++) {
      if (Math.random() < dropP * (isSwarmZone(d) ? SWARM_DROP_MULT : 1)) { found++; const _q = isSwarmZone(d) ? 1 : qualityMult(d); let _it = _q > 1 ? I.generate(d, rollRarityBoosted(d, _q)) : I.generate(d); if (isSwarmZone(d) && _it.rarity > 0) _it = I.generate(d, Math.max(0, _it.rarity - SWARM_RARITY_PENALTY)); if (newItems.length < 40) newItems.push(_it); }
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
    // ---- PILOT PROGRESSION + DREADNAUGHT HUNT ----
    if (state.dreadCores == null) state.dreadCores = 0;          // rare currency: only from Dreadnaughts
    if (!state.pilot) state.pilot = { nodes: { '0,0': 1 } };     // hex skill tree: { 'q,r': 1 } unlocked nodes
    if (!state.pilot.nodes) state.pilot.nodes = {};
    state.pilot.nodes['0,0'] = 1;                                // origin core is always unlocked
    if (!state.dreadLock) state.dreadLock = {};                  // weekly lockout: { tier: ISO-week completed }
    state.dreadRun = null;                                       // a hunt never resumes across a reload
    if (!state.fleet) state.fleet = [];
    if (!state.citadelCd) state.citadelCd = {};
    if (!state.citadels) state.citadels = {};          // YOUR player-built citadels { tileId:{score} } (cap 5)
    if (!state.rivalCitadels) state.rivalCitadels = {}; // rival player citadels we can attack (sim + shared)
    if (!state.razedCitadels) state.razedCitadels = {}; // natural citadel tiles you've razed → now plain tiles { tileId:true }
    // Re-apply razings to the (regenerated) tile cache so a razed citadel stays a
    // plain, buildable tile across reloads — no more permanent siege zone.
    Object.keys(state.razedCitadels).forEach((id) => razeCitadelTile(id, true));
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
    // light offline seeding so player-citadel ATTACKS are playable solo (shared
    // turf war overrides this the moment real citadels stream in via territory).
    if (state.rivalCitadels && Object.keys(state.rivalCitadels).length === 0) {
      let _s = 24611; const _r = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; };
      Object.keys(state.rivalTiles || {}).forEach((id) => { if (_r() < 0.14) { const tt = sysAt(id); if (tt) state.rivalCitadels[id] = Math.round(2500 * Math.pow(1.7, (tt.ring || 1))); } });
    }
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
    // ---- ONE-TIME crit nerf migration: compress item crit onto the new ladder ----
    if (state.critVer !== 4) {
      const capCrit = (it) => { if (it && it.stats && it.stats.critChance != null) it.stats.critChance = Math.min(it.stats.critChance, Math.round((0.005 + (it.rarity || 0) * 0.01) * 1180) / 1000, 1); };
      Object.keys(state.equipped || {}).forEach((k) => capCrit(state.equipped[k]));
      (state.inventory || []).forEach(capCrit);
      Object.keys(state.fittings || {}).forEach((sk) => { const fit = state.fittings[sk]; if (fit) Object.keys(fit).forEach((k) => capCrit(fit[k])); });
      state.critVer = 4;
      if (loaded) save();
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

  // ---- SHIP HULL UPGRADES — exponential resource cost, +dmg/+hp/+rate per level
  function shipLevel(key) { return (state.shipLevels && state.shipLevels[key]) || 1; }
  function shipUpgradeCost(key) {
    const L = shipLevel(key);
    // "later" ships = position in the progression order; each later hull costs
    // exponentially more to upgrade, with steeper per-level growth too.
    let idx = C.SHIPS.findIndex((s) => s.key === key); if (idx < 0) idx = 0;
    const tierMul = Math.pow(1.8, idx);
    const goldGrow = 1.95 + idx * 0.06;
    const plasmaGrow = 1.8 + idx * 0.05;
    const resMul = L >= 3 ? 10 : 1;   // 10× the resources to push a hull past Lv 3
    return { gold: Math.round(1500 * tierMul * Math.pow(goldGrow, L - 1)),
             plasma: Math.round(6 * tierMul * Math.pow(plasmaGrow, L - 1) * resMul),
             prism: 0 };   // hull upgrades cost gold + plasma only (Prism is reserved for Prism systems)
  }
  function prismIngots() { return (state.prism && state.prism.ingots) || 0; }
  function shipUpInfo(key) {
    const L = shipLevel(key);
    const cost = shipUpgradeCost(key);
    return { level: L, maxed: L >= 20, cost,
             owned: !!state.ownedShips[key],
             afford: state.gold >= cost.gold && (state.resources.plasma || 0) >= cost.plasma && prismIngots() >= cost.prism,
             bonus: { dmg: (L - 1) * 10, hp: (L - 1) * 12, rate: (L - 1) * 5 } };
  }
  function upgradeShip(key) {
    if (!state.ownedShips[key]) return { ok: false, reason: 'owned' };
    if (!state.shipLevels) state.shipLevels = {};
    if (shipLevel(key) >= 20) return { ok: false, reason: 'maxed' };
    const c = shipUpgradeCost(key);
    if (state.gold < c.gold) return { ok: false, reason: 'gold' };
    if ((state.resources.plasma || 0) < c.plasma) return { ok: false, reason: 'plasma' };
    if (prismIngots() < c.prism) return { ok: false, reason: 'prism' };
    state.gold -= c.gold; state.resources.plasma -= c.plasma;
    if (c.prism > 0 && state.prism) state.prism.ingots -= c.prism;
    state.shipLevels[key] = shipLevel(key) + 1;
    refreshStats(); save(); if (window.UI) window.UI.refreshAll();
    return { ok: true, level: state.shipLevels[key] };
  }

  // ===========================================================================
  // OBLIVION-class CONSTRUCTION — a hull you can't buy: recover its blueprint
  // (1% / 0.5% drop from a deep Void Citadel), grind the kill gate in the
  // required hull, pay a fortune in resources, then WAIT for the build (2–4 wk).
  // ===========================================================================
  function buildShipInfo(key) {
    const ship = C.SHIP_BY_KEY[key]; const b = ship && ship.build; if (!b) return null;
    const owned = !!(state.ownedShips && state.ownedShips[key]);
    const hasBp = !!(state.blueprints && state.blueprints[key]);
    const reqShip = b.reqShip, reqKills = b.reqShipKills || 0;
    const killsHave = state.totalKills || 0;         // ANY ship — no specific-hull grind
    const killsMet = killsHave >= reqKills;
    const cost = b.cost || {};
    const have = { fuel: (state.resources && state.resources.fuel) || 0, iron: (state.resources && state.resources.iron) || 0, plasma: (state.resources && state.resources.plasma) || 0, prism: prismIngots() };
    let affordable = true; for (const k in cost) { if ((have[k] || 0) < cost[k]) affordable = false; }
    const con = state.construction;
    const building = !!(con && con.ship === key);
    const otherBuilding = !!(con && con.ship !== key);
    let status;
    if (owned) status = 'owned';
    else if (building) status = (Date.now() >= con.arrivesAt) ? 'ready' : 'building';
    else if (!hasBp) status = 'noblueprint';
    else if (!killsMet) status = 'needkills';
    else if (otherBuilding) status = 'busy';
    else status = affordable ? 'buildable' : 'needres';
    return { key, ship, build: b, owned, hasBp, reqShip, reqKills, killsHave, killsMet, cost, have, affordable, building, otherBuilding, status,
             arrivesAt: building ? con.arrivesAt : 0, startedAt: building ? con.startedAt : 0, days: b.days };
  }
  function startBuildShip(key) {
    const inf = buildShipInfo(key); if (!inf) return { ok: false, reason: 'invalid' };
    if (inf.owned) return { ok: false, reason: 'owned' };
    if (inf.building) return { ok: false, reason: 'building' };
    if (state.construction) return { ok: false, reason: 'busy' };
    if (!inf.hasBp) return { ok: false, reason: 'blueprint' };
    if (!inf.killsMet) return { ok: false, reason: 'kills' };
    if (!inf.affordable) return { ok: false, reason: 'resources' };
    const cost = inf.cost;
    if (!state.resources) state.resources = { fuel: 0, iron: 0, plasma: 0 };
    state.resources.fuel -= cost.fuel || 0; state.resources.iron -= cost.iron || 0; state.resources.plasma -= cost.plasma || 0;
    if (cost.prism && state.prism) state.prism.ingots = Math.max(0, (state.prism.ingots || 0) - cost.prism);
    const ms = (inf.days || 14) * 86400000;
    state.construction = { ship: key, startedAt: Date.now(), arrivesAt: Date.now() + ms, days: inf.days || 14 };
    save(); if (window.UI) window.UI.refreshAll();
    return { ok: true };
  }
  function checkConstruction() {
    const con = state.construction; if (!con) return false;
    if (Date.now() >= con.arrivesAt) {
      const key = con.ship; state.construction = null;
      grantShip(key); save();
      if (window.UI) { if (window.UI.shipBuilt) window.UI.shipBuilt(C.SHIP_BY_KEY[key]); else if (window.UI.unlockToast) window.UI.unlockToast('★ ' + ((C.SHIP_BY_KEY[key] || {}).name || 'Hull') + ' construction complete!'); }
      return true;
    }
    return false;
  }
  // Ultra-rare blueprint roll on a Void Citadel explosion (Zone Grind only).
  function buildBlueprintDropFromCitadel(zone) {
    if (state.currentSystem) return;                 // only the open Zone Grind
    const lvl = (C.dungeonEnemyLevel ? C.dungeonEnemyLevel(zone) : zone * zone) || 0;
    for (const s of C.SHIPS) {
      const bd = s.build && s.bpDrop; if (!bd) continue;
      if (state.blueprints && state.blueprints[s.key]) continue;
      if (state.ownedShips && state.ownedShips[s.key]) continue;
      if (lvl < (bd.minCitLevel || 0)) continue;
      if (Math.random() < (bd.chance || 0)) {
        if (!state.blueprints) state.blueprints = {};
        state.blueprints[s.key] = true; save();
        if (window.UI && window.UI.blueprintEvent) window.UI.blueprintEvent(s);
        else if (window.UI && window.UI.unlockToast) window.UI.unlockToast('★ ' + s.name + ' BLUEPRINT recovered!');
      }
    }
  }

  window.LOOTFLEET = Object.assign(window.LOOTFLEET || {}, { VERSION: '1.0.0-beta' });
  const GAME = {
    init, state, rt, save, computeStats, refreshStats,
    shipLevel, shipUpInfo, upgradeShip, spawnFleetBoss,
    equip, sell, sellAllBelow, autoEquip, autoSell, autoSellPreview, selectDungeon,
    setAuto, getAuto: () => state.auto, setJoystick,
    setGameSpeed, hasSpeed, purchase, buySpeed4, buyShipLC, isPro, grantPro, respawnAt,
    buyShip, switchShip, grantShip, shipUnlocked, shipBuyState, hasBlueprint,
    buildShipInfo, startBuildShip, checkConstruction, getConstruction: () => state.construction || null,
    startHomeDefense, spawnHomeRaider, endHomeDefense,
    fleetSlots, fleetShips, setFleetSlot, getFleet: () => state.fleet || [],
    isCitadelZone, citadelCooldownLeft, isSwarmZone, zoneReqLevel,
    getCitadel: () => rt.enemies.find((en) => en.isCitadel && !en.dead) || null,
    shipDroneCount, getDrones: () => state.drones, getShipKills: (k) => (state.shipKills[k] || 0),
    skillRank, branchSpent, skillReqMet, canInvest, investSkill, resetSkills,
    getShop, shopTimeLeft, buyShopItem, getBossInfo, shopItemPrice, shopIsUpgrade,
    getLCMarket, buyLCMarket, lcCosmicTimeLeft, lcPrimTimeLeft, LC_PRICES,
    secondUnlocked: (b) => secondUnlocked(b), equipLayout,
    recommendedZone, zoneAdvice, zoneBonuses, currentWeek,
    // galaxy map
    warp, sysAt, isOwned, rivalOf, tileCooldownLeft, tileInfo, entryCostFor, isAllyTile,
    buildCitadel, canBuildCitadel, citadelBuildCost, citadelCount, citadelCap, abandonTile, hasMyCitadel, rivalCitadelScore, rivalDefense,
    citadelLevel, citadelUpgradeCost, upgradeCitadel, unequip,
    resourceRates, getResources: () => state.resources, getSiege: () => rt.siege, getWaves: () => rt.waves,
    getGalaxyFeed: () => state.galaxyFeed || [],
    formatNum, formatNumRaw, formatTime,
    getStats: () => rt.stats, getDps: () => rt.dps, score,
    getHp: () => ({ cur: rt.archer ? rt.archer.hp : 0, max: rt.stats.maxHp, dead: rt.archer && rt.archer.dead, awaiting: rt.awaitingRespawn }),
    itemPower: I.itemPower, compare: I.compare, rarityChances: I.rarityChances, save,
    buyCosmetic, setCosmetic, addCredits,
    getCredits: () => state.credits || 0, getCosmetics: () => state.cosmetics,
    startDreadHunt, dreadLevelFor, startServerDread,
    setLevel,
    getDreadCores: () => state.dreadCores || 0,
    addDreadCores: (n) => { state.dreadCores = (state.dreadCores || 0) + Math.max(0, n | 0); save(); if (window.UI) window.UI.refreshAll(); },
    invCap, invSlotCost, buyInvSlots,
    setPickupFilter: (t) => { state.pickupFilter = Math.max(0, t | 0); save(); },
    setAutoSellTier: (t) => { state.autoSellTier = (t == null || t < 0) ? -1 : (t | 0); save(); },
    // dev/verify
    fastForward(seconds) { const dt = 1/60, n = Math.floor(seconds/dt); for (let i=0;i<n;i++){ rt.time+=dt; state.playTime+=dt; update(dt); } if (window.UI) window.UI.refreshAll(); },
  };
  window.GAME = GAME;
})();
