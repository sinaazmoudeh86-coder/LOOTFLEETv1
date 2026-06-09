/* =============================================================================
   leaderboard.js — GrabAGun Idle Operator
   Client-side SIMULATED leaderboards (no backend). Players are grouped into
   weekly "heats" by the week they started; a new heat begins every Monday.
   Also an all-time board across every heat. Each rival has a viewable loadout.
   ============================================================================= */
(function () {
  'use strict';
  const C = window.CONFIG, ITEMS = window.ITEMS;

  // The game's "launch" Monday. weeksSince(launch)+1 = current heat number.
  const LAUNCH = Date.UTC(2026, 0, 5);              // Mon Jan 5 2026
  const WEEK_MS = 7 * 24 * 3600 * 1000;
  const EPOCH = Date.UTC(2024, 0, 1);               // matches GAME.currentWeek()

  function heatNumber(startWeekIndex) {
    const startMs = EPOCH + startWeekIndex * WEEK_MS;
    return Math.max(1, Math.floor((startMs - LAUNCH) / WEEK_MS) + 1);
  }
  function mondayOfHeat(heatNum) {
    return new Date(LAUNCH + (heatNum - 1) * WEEK_MS);
  }
  function weekLabel(heatNum) {
    const d = mondayOfHeat(heatNum);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // seeded RNG
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  const FIRST = ['Ghost','Reaper','Viper','Hawk','Wolf','Raven','Steel','Ace','Frost','Diesel','Mako','Echo','Razor','Bolt','Talon','Iron','Nyx','Onyx','Saint','Krieg','Havoc','Slate','Comet','Bruja','Zero','Vandal','Cobra','Karma','Lynx','Phantom','Specter','Rogue','Maverick','Tundra','Ember'];
  const LAST = ['77','_TX','Actual','X','99','HD','OG','_Prime','2A','_GG','Mag','FPS','_Six','Tac','_Recon','01','_K','Bravo','Delta','_Nine','Sr','_Vet','420','_Pro','Mk2'];
  function nameFor(r) { return FIRST[(r()*FIRST.length)|0] + (r() < 0.6 ? LAST[(r()*LAST.length)|0] : ''); }

  function rarityForRank(rank, total) {
    const t = 1 - rank / total; // 1 = top
    if (t > 0.97) return 9 + ((Math.random()*2)|0);
    if (t > 0.9) return 7 + ((Math.random()*2)|0);
    if (t > 0.75) return 5 + ((Math.random()*2)|0);
    if (t > 0.5) return 3 + ((Math.random()*2)|0);
    if (t > 0.25) return 2 + ((Math.random()*2)|0);
    return ((Math.random()*3)|0);
  }

  // Build a roster. `strength` scales how deep/high-level the cohort is.
  function buildRoster(seed, count, strength) {
    const r = rng(seed);
    const list = [];
    for (let i = 0; i < count; i++) {
      const zone = Math.max(1, Math.round(strength * (0.4 + r() * 1.1)));
      const level = Math.max(1, Math.round(zone * (1.6 + r()) + r() * 8));
      const power = Math.round(C.dungeonScale(zone) * (40 + r() * 80) + level * 6);
      const kills = Math.round(power * (3 + r() * 9));
      list.push({ name: nameFor(r), zone, level, power, kills, _loadout: null });
    }
    return list;
  }

  function loadoutFor(p, rank, total) {
    if (p._loadout) return p._loadout;
    const eq = { bow: null, arrows: null, armor: null, boots: null, gloves: null, amulet: null };
    let guard = 0, filled = 0;
    while (filled < 6 && guard < 120) {
      guard++;
      const it = ITEMS.generate(p.zone, rarityForRank(rank || total, total || 1));
      if (!eq[it.slot]) { eq[it.slot] = it; filled++; }
    }
    p._loadout = eq;
    return eq;
  }

  function score(p) { return p.zone * 100000 + p.level * 50 + p.power; }
  function rankBoard(list) {
    list.sort((a, b) => score(b) - score(a));
    list.forEach((p, i) => { p.rank = i + 1; });
    return list;
  }

  let _heatCache = {}, _allCache = null;

  function meEntry(GAME) {
    const s = GAME.state, st = GAME.getStats();
    return { name: 'You', isMe: true, zone: s.highestDungeonReached, level: s.level,
      power: Math.round((st ? st.theoryDps : 0) + (st ? st.maxHp : 0) * 0.5), kills: s.totalKills,
      _loadout: s.equipped };
  }

  function heatBoard(GAME) {
    const heat = heatNumber(GAME.state.startWeek || GAME.currentWeek());
    if (!_heatCache[heat]) {
      // cohort strength grows with heat age (older heats had more time)
      const age = Math.max(1, heatNumber(GAME.currentWeek()) - heat + 1);
      _heatCache[heat] = buildRoster(heat * 7919 + 13, 49, 6 + age * 1.5);
    }
    const list = _heatCache[heat].map((p) => ({ ...p }));
    list.push(meEntry(GAME));
    return { heat, label: weekLabel(heat), board: rankBoard(list) };
  }
  function allTimeBoard(GAME) {
    if (!_allCache) _allCache = buildRoster(424242, 99, 60); // veterans, deep zones
    const list = _allCache.map((p) => ({ ...p }));
    list.push(meEntry(GAME));
    return { board: rankBoard(list) };
  }

  window.LEADERBOARD = { heatBoard, allTimeBoard, loadoutFor, heatNumber, weekLabel };
})();
