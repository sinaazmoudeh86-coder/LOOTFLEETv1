/* ui-polish-747.js — three UI-only changes for build 747
   1. NEXT HULL strip in the battle HUD: the next ship on the ladder up to Dread
      Omega, which step stands between the pilot and it (blueprint / kills /
      level / gold / materials), and how far along that step is. Tap opens the
      hull's own detail sheet.
   2. HANGAR ▸ SHIPS: the sticky class jump bar sat at top:0 in the same scroller
      as the sticky hangar tabs, so it covered them. Their height is measured and
      published as --hcats-h, and the bar docks underneath.
   3. COMMAND: a calmer sheet — flat cards, one accent (the icon), no animated
      borders, no rainbow title, no pulsing badges.

   READ-ONLY BY CONSTRUCTION, same rule as cmd-status.js: reads RAW GAME.state and
   static CONFIG, never calls shipBuyState()/megaAfford() (they reach
   ensureResources(), which WRITES state.resources on a malformed save), never
   save(), no storage. Failure = the strip hides; the game is untouched. */
(function () {
  const G = () => window.GAME;
  const S = () => { try { return G() && G().state; } catch (e) { return null; } };
  const N = (x) => { const n = Math.floor(Number(x) || 0); return n > 0 ? n : 0; };
  const fmt = (n) => { try { return G().formatNum(n); } catch (e) { return String(n); } };

  // THE WHOLE LADDER, Frigate to Eternum. One target at a time: the first hull on
  // this list the pilot does not own. Every entry is a hull with a deterministic
  // route a pilot can work toward; award-only hulls (Tour, events, missions,
  // alliance, Kaevith/Choir drops, the Xyn), LootCoin-shop hulls and side
  // branches (Aegis, Vanguard) are deliberately NOT here — they are not a grind.
  //   gold line ......... interceptor → … → titan, mothership (resources)
  //   dread line ........ dread1 … dread6 (level + mega bill)
  //   oblivion builds ... oblivionspear, oblivionspearalpha (citadel blueprint +
  //                       prerequisite hull + kills + resources)
  //   apex .............. aeternum (★5) · titansina (1M LootCoins) ·
  //                       titanaquila (25 crowns) · corvus (100 crowns) ·
  //                       eternum (cargo licence + yard bill)
  const LADDER = ['interceptor', 'cruiser', 'heavycruiser', 'destroyer', 'battleship', 'dreadnought',
    'carrier', 'supercarrier', 'titan', 'mothership', 'dread1', 'dread2', 'dread3', 'dread4', 'dread5', 'dread6',
    'oblivionspear', 'oblivionspearalpha', 'aeternum', 'titansina', 'titanaquila', 'corvus', 'eternum'];
  const CUR = {
    gold: ['Gold farming', 'Gold'], fuel: ['Material farming', 'Fuel'], iron: ['Material farming', 'Iron'],
    plasma: ['Material farming', 'Plasma'], prism: ['Prism refining', 'Prism ingots'],
    credits: ['LootCoins', 'LootCoins'], dreadCores: ['Dread Core hunt', 'Dread Cores'],
  };
  const HINT = { bp: 'Blueprint farming', cbp: 'Citadel raiding', kills: 'Kill farming', level: 'Level up', cap: 'Ascend to raise cap',
    asc: 'Pilot Ascension', crowns: 'King of the Hill', ship: 'Earn the prerequisite', cargo: 'Cargo Defense' };
  function have(s, k) {
    const r = (s.resources && typeof s.resources === 'object') ? s.resources : {};
    if (k === 'gold') return N(s.gold);
    if (k === 'fuel' || k === 'iron' || k === 'plasma') return N(r[k]);
    if (k === 'prism') return N(s.prism && s.prism.ingots);
    if (k === 'credits') return N(s.credits);
    if (k === 'dreadCores') return N(s.dreadCores);
    return 0;
  }
  const owns = (s, k) => !!(s.ownedShips && typeof s.ownedShips === 'object' && s.ownedShips[k]);
  const shipName = (k) => { try { return window.CONFIG.SHIP_BY_KEY[k].name; } catch (e) { return k; } };

  function nextHull(s) {
    const C = window.CONFIG; if (!C || !C.SHIP_BY_KEY) return null;
    // START AT THE FRONTIER. A Mothership pilot who skipped the Battleship was
    // told "Next ship: Battleship" — a hull behind them. The search now begins
    // after the furthest rung owned on the MAIN line (gold hulls → Mothership →
    // Dreads); the side rungs after dread6 are excluded from that test, so buying
    // a Titan Sina with LootCoin cannot skip the Dreads. A gap behind the
    // frontier is only offered once nothing ahead is left.
    const MAIN_END = LADDER.indexOf('dread6');
    let from = 0;
    for (let i = 0; i <= MAIN_END; i++) if (owns(s, LADDER[i])) from = i + 1;
    const pick = (i) => { const key = LADDER[i], sh = C.SHIP_BY_KEY[key];
      return (!sh || sh.retired || sh.unreleased || owns(s, key)) ? null : { key, sh }; };
    for (let i = from; i < LADDER.length; i++) { const r = pick(i); if (r) return r; }
    for (let i = 0; i < from; i++) { const r = pick(i); if (r) return r; }
    return null;
  }

  // -> { key, name, ready, verb, done, total, hint, steps:[{ id, label, val, h, need, ok, state }] }
  function curSteps(s, cost) {
    const out = [];
    for (const k in cost) {
      const need = N(cost[k]); if (!need || !CUR[k]) continue;
      const h = have(s, k);
      out.push({ id: k, label: 'Collect ' + CUR[k][1], val: fmt(Math.min(h, need)) + ' / ' + fmt(need), h, need, ok: h >= need });
    }
    return out;
  }
  const count = (id, label, h, need, unit) => ({ id, label, val: (unit || '') + fmt(Math.min(h, need)) + ' / ' + fmt(need), h, need, ok: h >= need });
  const flag = (id, label, ok, todo) => ({ id, label, val: ok ? 'Done' : todo, h: ok ? 1 : 0, need: 1, ok });
  function stepsFor(s, key, sh) {
    const steps = [];
    const C = window.CONFIG || {};
    const stars = N(s.pasc && s.pasc.stars), crowns = N(s.kothCrowns), kills = N(s.totalKills);
    if (sh.build) {                                     // forged hulls — buildShipInfo() order
      const b = sh.build;
      if (b.reqAsc) steps.push(count('asc', 'Pilot Ascension \u2605' + b.reqAsc, stars, N(b.reqAsc), '\u2605'));
      if (b.reqCrowns) steps.push(count('crowns', 'Win ' + fmt(b.reqCrowns) + ' King of the Hill crowns', crowns, N(b.reqCrowns)));
      if (!b.noBlueprint && !b.reqCrowns) {             // crown hulls latch their blueprint from crowns
        const bp = !!(s.blueprints && s.blueprints[key]);
        const d = sh.bpDrop || {};
        steps.push(flag('cbp', 'Get the blueprint', bp, d.minCitLevel ? 'Raid Lv ' + fmt(d.minCitLevel) + '+ citadels' : 'Citadel drop'));
      }
      if (b.reqShip) steps.push(flag('ship', 'Own the ' + shipName(b.reqShip), owns(s, b.reqShip), 'Not owned yet'));
      if (b.reqShipKills) steps.push(count('kills', 'Destroy ' + fmt(b.reqShipKills) + ' enemies', kills, N(b.reqShipKills)));
      steps.push(...curSteps(s, b.cost || {}));
      return { steps, verb: 'build' };
    }
    if (sh.flyReq && sh.claimCost) {                    // Eternum — cargo licence then the yard bill
      const r = sh.flyReq;
      if (r.ship) steps.push(flag('ship', 'Own the ' + shipName(r.ship), owns(s, r.ship), 'Not owned yet'));
      if (r.cargo) steps.push(count('cargo', 'Secure ' + fmt(r.cargo) + ' cargo runs', N(s.cargo && s.cargo.wins), N(r.cargo)));
      if (r.stars) steps.push(count('asc', 'Pilot Ascension \u2605' + r.stars, stars, N(r.stars), '\u2605'));
      steps.push(...curSteps(s, sh.claimCost));
      return { steps, verb: 'commission' };
    }
    if (sh.megaCost) {
      const req = N(sh.reqLevel);
      if (req > 1) {
        // The level cap is 150 + 50 per ascension star. A Dread that needs a level
        // above the pilot's cap cannot be reached by grinding — say so, and point
        // at the thing that actually moves it.
        const st = count('level', 'Reach pilot level ' + fmt(req), N(s.level), req, 'Lv ');
        const cap = 150 + 50 * stars;
        if (!st.ok && req > cap) { st.id = 'cap'; st.val += ' \u00b7 cap Lv ' + fmt(cap) + ', ascend to raise'; }
        steps.push(st);
      }
      steps.push(...curSteps(s, sh.megaCost));
      return { steps, verb: 'buy' };
    }
    const bpZ = N(sh.bpZone);
    if (bpZ) {
      const bp = !!(s.blueprints && s.blueprints[key]);
      const deep = Math.max(1, N(s.highestDungeonReached));
      // Only the eased band (747) drops from ANY boss at or past its zone; Titan
      // and up still need that exact zone's boss.
      const any = !!(C.SHIP_EASE_747 && C.SHIP_EASE_747[key]);
      const atZone = any ? 'Beat any boss, Zone ' + bpZ + '+' : 'Beat the Zone ' + bpZ + ' boss';
      steps.push({ id: 'bp', label: 'Get the blueprint', val: bp ? 'Owned' : (deep >= bpZ ? atZone : 'Reach Zone ' + bpZ + ' \u00b7 at ' + deep),
        h: bp ? 1 : Math.min(deep, bpZ) - (deep >= bpZ ? 0.5 : 0), need: bp ? 1 : bpZ, ok: bp });
    }
    if (sh.reqKills) steps.push(count('kills', 'Destroy ' + fmt(sh.reqKills) + ' enemies', kills, N(sh.reqKills)));
    steps.push(...curSteps(s, sh.resPrice || { gold: sh.price }));
    return { steps, verb: 'buy' };
  }
  function plan(s) {
    const nx = nextHull(s); if (!nx) return null;
    const { key, sh } = nx;
    const { steps, verb } = stepsFor(s, key, sh);
    if (!steps.length) return null;                     // a hull with no readable route is not shown
    let cur = -1;
    steps.forEach((x, i) => { x.state = x.ok ? 'done' : (cur < 0 ? (cur = i, 'now') : 'next'); });
    const now = steps[cur];
    return { key, name: sh.name, steps, verb, total: steps.length, done: steps.filter((x) => x.ok).length, ready: cur < 0,
      hint: now ? (HINT[now.id] || (CUR[now.id] && CUR[now.id][0]) || 'Next step') : 'Ready to ' + verb };
  }

  // ---- fold state: a DEVICE fact, never an account fact -----------------------
  // localStorage 'lf-nexthull-open' ('1' open, '0' folded), written only here. No
  // state key, no save(), no merge. Default FOLDED: the panel is large on a phone,
  // so it starts as a one-row strip and the pilot opens it when they want detail.
  const NH_KEY = 'lf-nexthull-open';
  let _open = null;
  function isOpen() { if (_open === null) { try { _open = localStorage.getItem(NH_KEY) === '1'; } catch (e) { _open = false; } } return _open; }
  function setOpen(v) { _open = !!v; try { localStorage.setItem(NH_KEY, _open ? '1' : '0'); } catch (e) {} applyOpen(); }
  function applyOpen() {
    if (!el) return;
    const o = isOpen();
    el.classList.toggle('nh-open', o);
    const b = el.querySelector('.nh-tog');
    if (b) { b.setAttribute('aria-expanded', o ? 'true' : 'false'); b.setAttribute('aria-label', o ? 'Hide steps' : 'Show steps'); }
  }

  // ---- HUD row: a strip of the top HUD, not a floating panel ------------------
  // Lives INSIDE #hud, directly under the HP/kills row. #hud is flex:none above
  // #screens (flex:1), so this row takes its own height and the arena shrinks by
  // exactly that much — it can never cover the playfield, and it is in the same
  // place on every screen (hangar, battle, menus). The .hud-sub class is what
  // web-v89.css already uses to centre HUD rows on wide displays.
  let el = null, lastKey = '', lastSig = '', lastPlan = null;
  function mount() {
    if (el && el.isConnected) return el;
    const hud = document.getElementById('hud'); if (!hud) return null;
    el = document.createElement('div');
    el.id = 'next-hull'; el.className = 'hud-sub'; el.style.display = 'none'; el.setAttribute('role', 'group');
    el.innerHTML = '<div class="nh-row"><button type="button" class="nh-main">' +
      '<span class="nh-art"><img alt="" src=""></span><span class="nh-k">Next ship</span><b class="nh-n"></b>' +
      '<span class="nh-now"></span><span class="nh-v"></span><span class="nh-pb"><i></i></span><span class="nh-c"></span></button>' +
      '<button type="button" class="nh-tog" aria-expanded="false" aria-label="Show steps"><i></i></button></div>' +
      '<div class="nh-steps"></div>';
    el.querySelector('img').addEventListener('error', function () { this.style.visibility = 'hidden'; });
    el.querySelector('.nh-tog').addEventListener('click', (ev) => { ev.stopPropagation(); setOpen(!isOpen()); });
    el.querySelector('.nh-main').addEventListener('click', () => { try { if (el.dataset.key && window.UI && UI.openShipDetail) UI.openShipDetail(el.dataset.key); } catch (e) {} });
    // one delegated listener: the tiles are re-rendered, the listener is not
    el.querySelector('.nh-steps').addEventListener('click', (ev) => {
      const b = ev.target.closest && ev.target.closest('.nh-s'); if (!b) return;
      try { openHow(b.dataset.sid); } catch (er) {}
    });
    applyOpen();
    const bars = hud.querySelector('.hud-bars');
    if (bars && bars.parentNode === hud) hud.insertBefore(el, bars.nextSibling); else hud.appendChild(el);
    return el;
  }
  // WRITE ONLY ON CHANGE: paint() runs every second over tappable buttons, and
  // Safari drops a click whose press target was mutated between down and up.
  const setT = (n, v) => { if (n && n.textContent !== v) n.textContent = v; };
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pctOf = (x) => x.ok ? 100 : Math.max(2, Math.min(100, x.h / Math.max(1, x.need) * 100));
  function paint() {
    const s = S(); const e = mount(); if (!e) return;
    let p = null;
    try {
      // Hidden only while the tutorial is ON SCREEN (isDone() stays false forever on
      // accounts it released by timeout), and during event runs, which are not the
      // ship ladder. Everywhere else it is always there.
      const onboarding = !!document.querySelector('.ob-bar, .fg-wrap');
      const rt = G() && G().rt;
      if (rt && (rt.hcrun || rt.sdrun || rt.cgrun)) { e.style.display = 'none'; return; }
      if (s && N(s.level) > 0 && !onboarding) p = plan(s);
    } catch (er) { p = null; if (!paint._w) { paint._w = 1; try { console.warn('[NEXTHULL]', er); } catch (e2) {} } }
    if (!p) { e.style.display = 'none'; return; }
    e.style.display = '';
    if (lastKey !== p.key) {
      lastKey = p.key; e.dataset.key = p.key;
      const img = e.querySelector('img'); img.style.visibility = ''; img.src = 'ships/ship-' + p.key + '.png';
      e.querySelector('.nh-n').textContent = p.name;
    }
    const now = p.steps.find((x) => x.state === 'now');
    { const m = e.querySelector('.nh-main'), al = 'Next ship: ' + p.name + ', ' + p.done + ' of ' + p.total + ' steps done. ' + p.hint + '. Open ship'; if (m.getAttribute('aria-label') !== al) m.setAttribute('aria-label', al); }
    e.classList.toggle('ready', p.ready);
    setT(e.querySelector('.nh-c'), p.done + '/' + p.total);
    setT(e.querySelector('.nh-now'), p.ready ? 'Ready \u00b7 tap to ' + (p.verb || 'buy') : p.hint);
    setT(e.querySelector('.nh-v'), now ? now.val : '');
    { const pb = e.querySelector('.nh-pb i'), w = (now ? pctOf(now) : 100).toFixed(1) + '%'; if (pb.style.width !== w) pb.style.width = w; }
    const sig = JSON.stringify(p.steps.map((x) => [x.label, x.val, x.state, Math.round(pctOf(x) * 2)]));
    if (sig === lastSig) return; lastSig = sig;
    lastPlan = p;
    e.querySelector('.nh-steps').innerHTML = p.steps.map((x, i) =>
      '<button type="button" class="nh-s ' + x.state + '" data-sid="' + esc(x.id) + '" aria-label="' + esc(x.label + ', ' + (x.ok ? 'done' : x.val) + '. Where to get it') + '">' +
      '<span class="nh-sn">' + (x.ok ? '\u2713' : i + 1) + '</span>' +
      '<span class="nh-sl">' + esc(x.label) + '</span><span class="nh-sv">' + esc(x.ok ? 'Done' : x.val) + '</span>' +
      '<span class="nh-sb"><i style="width:' + pctOf(x).toFixed(1) + '%"></i></span><span class="nh-go" aria-hidden="true"></span></button>').join('');
  }
  setInterval(() => { try { paint(); } catch (e) {} }, 1000);

  // ---- WHERE TO GET IT --------------------------------------------------------
  // Every step tile opens a sheet: what this step needs, every place in the game
  // that pays it (best first), and a Go button that takes you there. Locked
  // places stay listed with their gate, so the pilot knows what is coming.
  // Gates mirror LOCKS / STAR_LOCKS in game.html's Command script (that table is
  // private to its closure); a mismatch can only mis-label a button — the
  // destination screen still enforces its own gate.
  // mirrors isWaveZone / isCitadelZone in game-v93.js (private to its closure)
  const plainZone = (z) => z > 0 && z % 11 !== 0 && z % 10 !== 7;
  const GATE = { galaxy: 25, moon: 30, expo: 20, prism: 40, dread: 30, koth: 80, pasc: 100, cargo: '\u26053' };
  const P = (name, go, how) => ({ name, go, how });
  const ZG = (how) => P('Zone Grind', 'battle', how);
  const SRC = {
    gold: [ZG('Every kill drops gold. Deeper zones pay much more per kill.'),
      P('My Galaxy', 'galaxy', 'Void tiles pay gold every hour, even while you are offline.'),
      P('Fleet Exploration', 'expo', 'Send idle ships out; they come back with gold and materials.'),
      P('Moon Colony', 'moon', 'Colony buildings produce gold over time.')],
    fuel: 'mat', iron: 'mat', plasma: 'mat',
    prism: [P('Prism Mining', 'prism', 'Deploy miners on a Prism ore field and defend them. Ingots bank as they dig, even if you die.'),
      P('Moon Colony', 'moon', 'Prisma, the prism moon, refines ingots over time. Terraform the earlier moons to open it.')],
    credits: [P('King of the Hill', 'koth', 'Daily kill race. First place takes 10,000 LootCoins.'),
      P('Fleet Exploration', 'expo', 'Deep expeditions can return LootCoins.'),
      P('Cargo Defense', 'cargo', 'Escort cargo runs; higher tiers pay LootCoins.'),
      P('Get LootCoins', 'lc', 'Top up from the store.')],
    dreadCores: [P('Dreadnaught Hunt', 'dread', 'Destroy a weekly Dreadnaught for a chance at a Dread Core.'),
      P('Fleet Exploration', 'expo', 'Long expeditions can bring back Dread Cores.'),
      P('Cargo Defense', 'cargo', 'Top-tier cargo runs can pay Dread Cores.')],
    kills: [ZG('Every enemy you destroy counts, on any ship, in any zone. Fly the zone you clear fastest.')],
    bp: null, cbp: [P('Zone Grind', 'zones', 'Blueprints drop from citadel raids. Pick a citadel zone at or above the raid level shown.')],
    level: [ZG('Kills give XP. Push to the deepest zone you can hold for the fastest levels.')],
    cap: [P('Pilot Ascension', 'pasc', 'Each ascension star raises your level cap by 50.')],
    asc: [P('Pilot Ascension', 'pasc', 'Reach the gate level, then ascend to earn a star.')],
    crowns: [P('King of the Hill', 'koth', 'Finish a daily race on top to win a crown.')],
    cargo: [P('Cargo Defense', 'cargo', 'Every run you see through to the end counts.')],
  };
  const MAT = [P('My Galaxy', 'galaxy', 'Each tile you own produces one material every hour, also while you are offline. Claim more tiles to raise the rate.'),
    P('Moon Colony', 'moon', 'Each moon leans toward one material: Ferra iron, Cryos fuel, Ion plasma.'),
    P('Fleet Exploration', 'expo', 'Expeditions return fuel, iron and plasma.'),
    P('Cargo Defense', 'cargo', 'Cargo runs pay out materials.')];
  function gateOf(go) {
    const s = S() || {}, L = N(s.level), g = GATE[go];
    if (!g) return '';
    if (go === 'cargo') { const st = N(s.pasc && s.pasc.stars); return st >= 3 ? '' : '\u2605 3'; }
    if (go === 'koth') { try { if (window.KOTH && KOTH.unlocked) return KOTH.unlocked() ? '' : 'Lv ' + g; } catch (e) {} }
    return L >= g ? '' : 'Lv ' + g;
  }
  function goTo(go, step) {
    try { if (window.UI && UI.closeSheet) UI.closeSheet(); } catch (e) {}
    const g = G();
    if (go === 'ship') { try { UI.openShipDetail(step.ship); } catch (e) {} return; }
    if (go === 'lc') { const c = document.getElementById('hud-lc-chip'); if (c) c.click(); return; }
    if (go === 'zone') {
      // the pilot's own action, same call as tapping a zone in the picker
      try { if (g.state.currentDungeon !== step.zone) g.selectDungeon(step.zone); } catch (e) {}
      go = 'battle';
    }
    const card = document.querySelector('#mega [data-go="' + go + '"]');
    if (card) { card.click(); return; }
    const btn = document.querySelector('.nav-btn[data-screen="' + go + '"]');
    if (btn) { btn.click(); return; }
    try { if (window.UI && UI.showScreen) UI.showScreen(go); } catch (e) {}
  }
  function sourcesFor(x) {
    const s = S() || {};
    if (x.id === 'bp') {
      const sh = window.CONFIG.SHIP_BY_KEY[lastPlan.key] || {}, z = N(sh.bpZone);
      const any = !!(window.CONFIG.SHIP_EASE_747 && window.CONFIG.SHIP_EASE_747[lastPlan.key]);
      const open = N(s.highestUnlocked), cur = N(s.currentDungeon);
      const how = (any ? 'Beat a boss in Zone ' + z + ' or deeper' : 'Beat the boss in Zone ' + z + ' exactly') +
        '. A boss arrives every few minutes \u2014 every kill brings it sooner.';
      if (open < z) return [P('Zone Grind', 'zones', 'Push to Zone ' + z + ' (you have opened ' + Math.max(1, open) + '). ' + how)];
      if (any && cur >= z && plainZone(cur)) return [ZG('You are deep enough already. ' + how)];
      // A citadel zone (…7) or wave zone (every 11th) has no roaming boss, so "Fly
      // to Zone 7" for the Cruiser landed a pilot in a siege. The eased band pays
      // from any boss at or past its zone, so send them to the first PLAIN zone.
      let t = z;
      if (any) for (let q = z; q <= Math.min(open, z + 20); q++) if (plainZone(q)) { t = q; break; }
      return [{ name: 'Fly to Zone ' + t, go: 'zone', zone: t, how }];
    }
    if (x.id === 'ship') return [{ name: 'Open the ship', go: 'ship', ship: x.ship, how: 'See what it takes to get this hull first.' }];
    const r = SRC[x.id];
    return r === 'mat' ? MAT : (r || []);
  }
  function openHow(id) {
    const p = lastPlan; if (!p || !window.UI || !UI.showSheet) return;
    const x = p.steps.find((q) => q.id === id); if (!x) return;
    if (x.id === 'ship') { const m = /Own the (.+)$/.exec(x.label); const C = window.CONFIG;
      x.ship = Object.keys(C.SHIP_BY_KEY).find((k) => C.SHIP_BY_KEY[k].name === (m && m[1])); }
    const src = sourcesFor(x);
    let best = -1;
    const rows = src.map((q, i) => {
      const lock = q.go === 'zone' || q.go === 'ship' || q.go === 'lc' ? '' : gateOf(q.go);
      if (!lock && best < 0) best = i;
      return { q, lock };
    });
    const pct = pctOf(x);
    const html = '<div class="sheet-head">' + esc(x.label) + '</div><div class="sheet-body nhw">' +
      '<div class="nhw-top"><span class="nhw-for">For the <b>' + esc(p.name) + '</b></span><span class="nhw-v">' + esc(x.ok ? 'Done' : x.val) + '</span></div>' +
      '<div class="nhw-pb' + (x.ok ? ' ok' : '') + '"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
      (src.length ? '<div class="nhw-k">' + (x.ok ? 'Done \u2014 more from' : 'Where to get it') + '</div>' : '') +
      '<div class="nhw-list">' + rows.map((r, i) =>
        '<div class="nhw-row' + (r.lock ? ' locked' : '') + '">' +
          '<div class="nhw-txt"><div class="nhw-n">' + esc(r.q.name) + (i === best && src.length > 1 ? '<em>Best</em>' : '') + '</div>' +
          '<div class="nhw-h">' + esc(r.q.how) + '</div></div>' +
          (r.lock ? '<span class="nhw-lock">Unlocks ' + esc(r.lock) + '</span>'
                  : '<button type="button" class="nhw-go" data-i="' + i + '">Go</button>') +
        '</div>').join('') + '</div></div>';
    const sh = UI.showSheet(html);
    const root = (sh && sh.querySelector) ? sh : document;
    root.querySelectorAll('.nhw-go').forEach((b) => b.addEventListener('click', () => goTo(src[+b.dataset.i].go, src[+b.dataset.i])));
  }

  // ---- hangar tabs height for the sticky jump bar -----------------------------
  function measureCats() {
    let h = 0;
    document.querySelectorAll('.store-cats').forEach((c) => { if (c.offsetParent !== null) h = Math.max(h, c.offsetHeight); });
    if (h) document.documentElement.style.setProperty('--hcats-h', h + 'px');
  }
  setInterval(() => { try { measureCats(); } catch (e) {} }, 700);
  window.addEventListener('resize', () => { try { measureCats(); } catch (e) {} });

  // ---- Command layout pass: My Galaxy first, hint last, empty groups hidden ----
  // DOM moves only — a moved node keeps its [data-go] listener. Nothing written.
  function tidyMega() {
    const mega = document.getElementById('mega'); if (!mega) return;
    const grid = mega.querySelector('.mega-grid'); if (!grid) return;
    const gal = grid.querySelector('.mega-card.cmd-galaxy');
    if (gal && grid.firstElementChild !== gal) grid.insertBefore(gal, grid.firstChild);
    const hint = document.getElementById('mega-hint');
    if (hint && hint.parentNode === grid && grid.lastElementChild !== hint) grid.appendChild(hint);
    // An ASCENDED pilot is always below the gate after the reset, but the perk
    // board is theirs to spend in — never hide it from them (pre-747 the dimmed
    // tile was their route in). Read raw state; nothing written.
    const pa = grid.querySelector('#cmd-pasc');
    if (pa) { let st = 0; try { st = Math.floor(Number(window.GAME.state.pasc.stars) || 0); } catch (e) {}
      if (pa.classList.contains('p747-keep') !== (st > 0)) pa.classList.toggle('p747-keep', st > 0); }
    let cur = null, vis = 0;
    const flush = () => { if (cur) cur.classList.toggle('p747-empty', vis === 0); };
    for (const k of grid.children) {
      if (k.classList.contains('mega-sec')) { flush(); cur = k; vis = 0; continue; }
      if (k === gal || k === hint) continue;
      if (k.classList.contains('mega-card') && (!k.classList.contains('locked') || k.classList.contains('p747-keep')) && k.style.display !== 'none') vis++;
    }
    flush();
    if (hint && hint.style.display !== 'none') {
      const m = hint.textContent.match(/Level (\d+)/);
      if (m) { const h = 'More systems unlock as you level \u00b7 next at <b>Level ' + m[1] + '</b>'; if (hint.innerHTML !== h) hint.innerHTML = h; }
    }
  }
  try {
    const mg = document.getElementById('mega');
    if (mg) new MutationObserver(() => { if (mg.classList.contains('open')) requestAnimationFrame(() => { try { tidyMega(); } catch (e) {} }); })
      .observe(mg, { attributes: true, attributeFilter: ['class'] });
  } catch (e) {}
  setInterval(() => { const mg = document.getElementById('mega'); if (mg && mg.classList.contains('open')) { try { tidyMega(); } catch (e) {} } }, 1000);
  try { tidyMega(); } catch (e) {}

  const css = document.createElement('style'); css.id = 'ui-polish-747';
  css.textContent = `
#hud #next-hull{display:flex;flex-direction:column;align-items:stretch;flex-wrap:nowrap;margin-top:5px;font-family:'Rajdhani',sans-serif;color:#eaf0fa}
#hud #next-hull[style*="none"]{display:none}
#hud #next-hull > *{width:100%;box-sizing:border-box}
#next-hull .nh-row{display:flex;align-items:stretch;gap:6px;height:28px}
#next-hull .nh-main{flex:1;min-width:0;display:flex;align-items:center;gap:8px;height:28px;padding:0 10px 0 4px;box-sizing:border-box;cursor:pointer;
  background:#0d1526;border:1px solid #1d2a44;border-radius:10px;color:inherit;font:inherit;text-align:left;-webkit-tap-highlight-color:transparent}
#next-hull .nh-main:hover{border-color:#2e4166}
#next-hull .nh-main:active{transform:scale(.995)}
#next-hull .nh-art{flex:none;width:28px;height:22px;display:grid;place-items:center}
#next-hull .nh-art img{max-width:28px;max-height:22px;object-fit:contain}
#next-hull .nh-k{flex:none;font-family:'Orbitron',sans-serif;font-weight:800;font-size:8.5px;letter-spacing:.14em;text-transform:uppercase;color:#5fd1ff}
#next-hull .nh-n{flex:none;font-family:'Orbitron',sans-serif;font-weight:700;font-size:11px;letter-spacing:.03em;color:#fff;white-space:nowrap}
#next-hull .nh-now{flex:none;font-size:12px;font-weight:700;color:#0a1119;background:#5fd1ff;border-radius:5px;padding:0 6px;line-height:17px;white-space:nowrap}
#next-hull .nh-v{flex:0 0 auto;max-width:45%;min-width:0;font-size:12px;font-weight:700;color:#c9d6e6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
#next-hull .nh-pb{flex:1 1 60px;min-width:30px;max-width:260px;margin-left:auto;height:5px;border-radius:3px;background:rgba(255,255,255,.09);overflow:hidden}
#next-hull .nh-pb i{display:block;height:100%;background:#5fd1ff;border-radius:3px;transition:width .4s}
#next-hull .nh-c{flex:none;font-family:'Orbitron',sans-serif;font-weight:800;font-size:10px;color:#9fb0c4;font-variant-numeric:tabular-nums}
#next-hull .nh-tog{flex:none;width:34px;height:28px;padding:0;display:grid;place-items:center;cursor:pointer;background:#0d1526;border:1px solid #1d2a44;border-radius:10px;color:#9fb0c4;
  position:relative;-webkit-tap-highlight-color:transparent}
#next-hull .nh-tog::after{content:'';position:absolute;inset:-8px -4px}
#next-hull .nh-tog i{width:7px;height:7px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:translateY(-2px) rotate(45deg);transition:transform .2s}
#next-hull.nh-open .nh-tog i{transform:translateY(2px) rotate(-135deg)}
#next-hull button.nh-s{font:inherit;color:inherit;text-align:left;cursor:pointer;position:relative;-webkit-tap-highlight-color:transparent;min-height:44px}
#next-hull button.nh-s:hover{border-color:#2e4166}
#next-hull button.nh-s:active{transform:scale(.99)}
#next-hull button.nh-s:focus-visible{outline:2px solid #5fd1ff;outline-offset:1px}
#next-hull .nh-go{position:absolute;right:11px;top:13px;width:6px;height:6px;border-right:2px solid #5d7192;border-top:2px solid #5d7192;transform:rotate(45deg)}
#next-hull .nh-s.now .nh-go{border-color:#5fd1ff}
.nhw{display:flex;flex-direction:column;gap:10px;font-family:'Rajdhani',sans-serif}
.nhw-top{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:14px;color:#9fb0c4}
.nhw-top b{color:#eaf0fa}
.nhw-v{font-weight:700;color:#eaf0fa;font-variant-numeric:tabular-nums}
.nhw-pb{height:6px;border-radius:3px;background:rgba(255,255,255,.09);overflow:hidden}
.nhw-pb i{display:block;height:100%;background:#5fd1ff;border-radius:3px}
.nhw-pb.ok i{background:#3ecf8e}
.nhw-k{margin-top:4px;font-family:'Orbitron',sans-serif;font-weight:800;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#5fd1ff}
.nhw-list{display:flex;flex-direction:column;gap:6px}
.nhw-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:11px;background:#0e1626;border:1px solid #1f2c45}
.nhw-row.locked{opacity:.6}
.nhw-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.nhw-n{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:700;color:#fff}
.nhw-n em{font-style:normal;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#0a1119;background:#5fd1ff;border-radius:4px;padding:1px 5px}
.nhw-h{font-size:13px;line-height:1.35;color:#9fb0c4;text-wrap:pretty}
.nhw-go{flex:none;min-width:64px;min-height:44px;border-radius:10px;border:none;cursor:pointer;background:linear-gradient(180deg,#ffd24d,#e8960f);color:#0b1220;font-family:'Orbitron',sans-serif;font-weight:800;font-size:12px;letter-spacing:.06em}
.nhw-lock{flex:none;font-size:12px;font-weight:700;color:#8193ad;white-space:nowrap}
#next-hull .nh-tog:hover,#next-hull .nh-tog:focus-visible{border-color:#5fd1ff;color:#eaf0fa;outline:none}
#next-hull .nh-steps{display:none;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px;margin-top:5px}
#next-hull.nh-open .nh-steps{display:grid}
#next-hull .nh-s{display:grid;grid-template-columns:16px minmax(0,1fr);column-gap:7px;row-gap:2px;align-items:center;padding:6px 8px;background:#0d1526;border:1px solid #1d2a44;border-radius:9px;min-width:0}
#next-hull .nh-sn{grid-row:1 / span 3;align-self:start;width:16px;height:16px;border-radius:50%;display:grid;place-items:center;font-size:9.5px;font-weight:800;
  font-family:'Orbitron',sans-serif;border:1px solid #3a4c68;color:#7f91aa;box-sizing:border-box}
#next-hull .nh-sl{font-size:12px;font-weight:700;line-height:1.15;color:#c9d6e6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#next-hull .nh-sv{font-size:11.5px;font-weight:700;line-height:1.15;color:#9fb0c4;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#next-hull .nh-sb{display:block;height:4px;margin-top:2px;border-radius:2px;background:rgba(255,255,255,.09);overflow:hidden}
#next-hull .nh-sb i{display:block;height:100%;border-radius:2px;background:#5fd1ff}
#next-hull .nh-s.now{border-color:rgba(95,209,255,.45)}
#next-hull .nh-s.now .nh-sn{border-color:#5fd1ff;color:#5fd1ff}
#next-hull .nh-s.now .nh-sl{color:#fff}
#next-hull .nh-s.done .nh-sn{background:#3ecf8e;border-color:#3ecf8e;color:#08130d}
#next-hull .nh-s.done .nh-sl,#next-hull .nh-s.done .nh-sv{color:#7f91aa}
#next-hull .nh-s.done .nh-sb i{background:#3ecf8e}
#next-hull .nh-s.next{opacity:.6}
#next-hull .nh-s.next .nh-sb i{background:#5d7190}
#next-hull.ready .nh-main{border-color:rgba(242,178,75,.6)}
#next-hull.ready .nh-now,#next-hull.ready .nh-pb i{background:#f2b24b}
@media (max-width:560px){#next-hull .nh-k{display:none}#next-hull .nh-pb{display:none}#next-hull .nh-main{gap:6px}}
@media (max-width:380px){#next-hull .nh-v{display:none}}
@media (max-height:430px){#next-hull{display:none!important}}

.sc-jump{top:var(--hcats-h,0px);background:#0e1420}

/* ---- COMMAND: one tile, one size. Locked systems are hidden; My Galaxy leads. ---- */
#mega .mega-sheet{background:#0f1521}
#mega .mega-sheet::before{display:none}
#mega .mega-grab{background:#2b3850;animation:none}
#mega .mega-title{background:none;-webkit-background-clip:border-box;background-clip:border-box;-webkit-text-fill-color:currentColor;color:#c3cede;animation:none}
#mega .mega-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px!important;padding-top:6px}
@media (min-width:700px){#mega .mega-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important}}
@media (min-width:1024px){#mega .mega-grid{grid-template-columns:repeat(4,minmax(0,1fr))!important}}
#mega .mega-grid .mega-card.locked{display:none!important}
#mega .mega-grid .mega-card.locked.p747-keep{display:flex!important;opacity:1!important;filter:none!important}
#mega .mega-grid .mega-card{grid-column:auto!important;grid-row:auto!important;order:0!important;box-sizing:border-box;
  height:60px!important;min-height:60px!important;max-height:60px!important;padding:0 10px!important;gap:10px!important;
  display:flex;flex-direction:row!important;align-items:center!important;border-radius:12px!important;
  background:#141c2a!important;border:1px solid #222d42!important;box-shadow:none!important;animation:none!important;overflow:visible!important}
#mega .mega-grid .mega-card::before{display:none!important}
#mega .mega-grid .mega-card:hover{border-color:#34445f!important}
#mega .mega-grid .mega-card:active{transform:scale(.97)}
#mega .mega-grid .mega-card > div:not(.mc-ic){flex:1;min-width:0;padding-right:0!important;overflow:hidden}
#mega .mega-grid .mega-card .mc-ic,#mega .mega-grid .pa-pill .pa-pill-ic{flex:none;width:34px!important;height:34px!important;padding:0!important;border-radius:10px!important;
  display:grid;place-items:center;background:rgba(255,255,255,.04)!important;border:1px solid #26324a!important;box-shadow:none!important;filter:none!important;opacity:1!important}
#mega .mega-grid .mega-card .mc-ic svg{width:18px!important;height:18px!important;filter:none!important}
#mega .mega-grid .mega-card .mc-ic img{width:26px!important;height:26px!important;object-fit:contain;filter:none!important}
#mega .mega-grid .mega-card .mc-n,#mega .mega-grid .pa-pill .pa-pill-n{display:block!important;font-family:'Rajdhani',sans-serif!important;font-weight:700!important;font-size:14px!important;
  line-height:1.2!important;letter-spacing:.01em!important;color:#e6edf7!important;-webkit-text-fill-color:currentColor;background:none!important;animation:none!important;
  white-space:nowrap!important;overflow:hidden;text-overflow:ellipsis;max-width:100%}
#mega .mega-grid .mega-card .mc-n em,#mega .mega-grid .mega-card .sd-live-tag,#mega .mega-grid .mega-card .mc-s,#mega .mega-grid .mega-card .sd-card-cd,
#mega .mega-grid .mega-card .mc-lock,#mega .mega-grid .mega-card .mc-new,
#mega .mega-grid .pa-pill .pa-pill-k,#mega .mega-grid .pa-pill .pa-pill-s,#mega .mega-grid .pa-pill .pa-pill-meta,
#mega .mega-grid .pa-pill .pa-pill-go,#mega .mega-grid .pa-pill .pa-pill-lock,#mega #cmd-pasc-badge{display:none!important}
#mega .mega-grid .pa-pill .pa-pill-ic{font-size:17px;color:#c9a0ff}
#mega .mega-grid .pa-pill .pa-pill-txt{flex:1;min-width:0;display:flex!important;flex-direction:column!important;align-items:stretch!important;gap:0!important;overflow:hidden}
#mega .mega-grid .mega-card .mc-live{font-size:11.5px;margin-top:1px}
#mega .mega-grid .mega-card > .badge,#mega .mega-grid .mega-card .cmd-cardbadge{position:absolute!important;top:-5px!important;right:-5px!important;left:auto!important;
  transform:none!important;margin:0!important;box-shadow:0 0 0 2px #0f1521!important;animation:none!important;z-index:2}
#mega .mega-grid .mega-card.cmd-galaxy,#mega .mega-grid .mega-card.cmd-galaxy.sec-hid{display:flex!important;grid-column:1 / -1!important;height:auto!important;min-height:80px!important;max-height:none!important;
  padding:12px 34px 12px 14px!important;gap:12px!important;background:linear-gradient(135deg,#13324b,#0d1a2b)!important;border:1px solid rgba(95,209,255,.55)!important;margin-bottom:6px}
#mega .mega-grid .mega-card.cmd-galaxy::after{content:'›';position:absolute;right:14px;top:50%;transform:translateY(-50%);font-size:26px;line-height:1;color:#5fd1ff}
#mega .mega-grid .mega-card.cmd-galaxy .mc-ic{width:48px!important;height:48px!important;border-radius:13px!important;color:#7fe0ff;background:rgba(95,209,255,.1)!important;border-color:rgba(95,209,255,.45)!important}
#mega .mega-grid .mega-card.cmd-galaxy .mc-ic svg{width:26px!important;height:26px!important}
#mega .mega-grid .mega-card.cmd-galaxy .mc-n{font-family:'Orbitron',sans-serif!important;font-size:15px!important;letter-spacing:.04em!important;color:#fff!important}
#mega .mega-grid .mega-card.cmd-galaxy .mc-s{display:-webkit-box!important;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:normal!important;overflow:hidden;
  font-size:12px!important;line-height:1.35!important;color:#a9cbe2!important;margin-top:3px}
#mega .mega-sec{background:#0f1521!important;border:none!important;border-radius:0!important;padding:12px 2px 4px!important;margin-top:4px}
#mega .mega-sec .ms-n{color:#8193ad;font-size:10.5px;letter-spacing:.14em}
#mega .mega-sec .ms-lk{display:none}
#mega .mega-sec.p747-empty{display:none!important}
#mega .mega-hint{background:none!important;border:none!important;box-shadow:none!important;color:#8193ad!important;font-size:12px;padding:14px 4px 4px!important;text-align:center}
#mega .mega-hint b{color:#c3cede!important}
`;
  document.head.appendChild(css);

  window.NEXTHULL = { plan, nextHull, LADDER };
})();
