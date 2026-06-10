/* =============================================================================
   coach.js — LOOT FLEET first-time-experience coaching
   ---------------------------------------------------------------------------
   Milestone-driven coach marks for new pilots. Each "moment" fires ONCE per
   account, at the player's first encounter with a system:

     welcome  · first login            → deploy to Zone 1
     loot     · first item collected   → equip upgrades from the hold
     bagfull  · hold hits capacity     → auto-sell / expand cargo
     skills   · first skill points     → spend them in Pilot Skills
     ships    · level 8                → hangar, blueprints & escorts
     galaxy   · level 20               → The Galaxy turf war

   SAFETY LOGIC: a moment never interrupts combat directly — when one triggers
   mid-fight we wait a beat, dock the player at the safe home hangar, then run
   the coaching steps. Steps highlight the real UI (spotlight ring + card) and
   advance when the player taps the highlighted control, so the tutorial IS the
   game, not a slideshow. Veteran saves are grandfathered: anything their level
   proves they've already done is marked seen on first load.
   ============================================================================= */
(function () {
  'use strict';
  let G = null, layer = null, ring = null, card = null;
  let active = null, stepIdx = 0, posTimer = 0, findTimer = 0, lastEnd = 0;
  let pendingAt = 0, pendingKey = null;

  const NAV = (s) => '#nav .nav-btn[data-screen="' + s + '"]';

  const MOMENTS = {
    welcome: {
      when: (s) => (s.totalKills || 0) === 0 && s.level < 3,
      dock: false,
      steps: [
        { title: 'Welcome to the fleet, pilot', body: 'The loop is simple: <b>kill → loot → upgrade → push deeper</b>. Your ship aims and fires on its own — you steer, it shoots. Let\'s get you into your first fight.' },
        { target: NAV('zones'), tap: true, title: 'Open Zone Grind', body: 'All combat zones live here. Tap the highlighted button.' },
        { target: '#zones-body .zone-row[data-d="1"]', tap: true, title: 'Deploy to Zone 1', body: 'A low-risk starter field. Drops magnet toward your ship — just fly near them. Tap to deploy. Good hunting. 🫡' },
      ],
    },
    loot: {
      when: (s) => (s.inventory || []).length >= 1,
      dock: true,
      steps: [
        { title: 'First loot secured ✦', body: 'Gear is your power curve — every drop can be an upgrade. We docked you at the safe hangar to take a look.' },
        { target: NAV('bag'), tap: true, title: 'Open your Loot hold', body: 'Everything you pick up lands here. Tap it.' },
        { target: '#auto-equip', tap: true, title: 'Tap ⚙ Auto-Equip Best', body: 'Instantly fits your strongest gear into every slot. Items tagged <span style="color:#5bc06b">▲</span> are upgrades over what you\'re wearing.' },
        { title: 'You\'re stronger already', body: 'Turn <b>Always</b> on to auto-equip while you farm. Redeploy any time via <b>Zone Grind</b> — deeper zones drop better loot.' },
      ],
    },
    bagfull: {
      when: (s) => (s.inventory || []).length >= 100,
      dock: true,
      steps: [
        { title: 'Your hold is FULL', body: 'New drops are now <b>auto-scrapped</b> into resources instead of collected. Let\'s clear space — docked you safe first.' },
        { target: NAV('bag'), tap: true, title: 'Open your Loot hold', body: 'Tap the highlighted button.' },
        { target: '.autosell', title: 'Auto-Sell the junk', body: 'Pick a rarity and <b>Sell</b> everything at or below it — <b>Keep upgrades</b> protects anything better than your gear. You can also expand the cargo hold with gold.' },
      ],
    },
    skills: {
      when: (s) => (s.skillPoints || 0) >= 1,
      dock: true,
      steps: [
        { title: 'Skill points earned ◈', body: 'Every level grants Pilot Skill points — permanent, account-wide power. Let\'s spend your first.' },
        { target: NAV('skills'), tap: true, title: 'Open Pilot Skills', body: 'Tap the highlighted button.' },
        { target: '#skills-body', title: 'Pick your edge', body: 'Expand a branch and tap a skill to learn it. Damage, defense, loot luck — specialize for how you like to fly. Respec is always available.' },
      ],
    },
    ships: {
      when: (s) => s.level >= 8,
      dock: true,
      steps: [
        { title: 'Time to grow the fleet ⛴', body: 'One hull won\'t carry you forever. New ships bring more slots, more guns — and owned hulls fly <b>beside you as escorts</b>.' },
        { target: NAV('hero'), tap: true, title: 'Open the Hangar', body: 'Tap the highlighted button.' },
        { target: '[data-hangtab="ships"]', tap: true, title: 'The Ships tab', body: 'Zone bosses drop <b>blueprints</b>. Recover one, prove yourself in your current hull, then buy the new ship with gold.' },
      ],
    },
    galaxy: {
      when: (s) => s.level >= 20,
      dock: true,
      steps: [
        { title: 'Level 20 — THE GALAXY is open', body: 'Beyond zone grinding lies the turf war: a shared galaxy of tiles to <b>conquer, farm and defend</b> against rival fleets.' },
        { target: NAV('galaxy'), tap: true, title: 'Open The Galaxy', body: 'Tap the highlighted button.' },
        { target: '#galaxy-body', title: 'Claim your turf', body: 'Capture tiles spreading out from your citadel — each one generates <b>⬢ fuel · ◆ iron · ✦ plasma every hour, even offline</b>. Richer rings pay more… and attract raiders. Hold your ground.' },
      ],
    },
  };
  const ORDER = ['welcome', 'loot', 'bagfull', 'skills', 'ships', 'galaxy'];

  // ---------------------------------------------------------------------------
  function init(game) {
    G = game;
    const s = G.state;
    if (!s.coach) {
      s.coach = { seen: {} };
      // grandfather veteran saves — don't coach what their level proves they know
      if (s.level >= 5 || (s.totalKills || 0) > 150) { s.coach.seen.welcome = s.coach.seen.loot = s.coach.seen.skills = true; }
      if (s.level >= 10) s.coach.seen.bagfull = true;
      if (s.level >= 12) s.coach.seen.ships = true;
      if (s.level >= 25) s.coach.seen.galaxy = true;
      G.save();
    }
    buildLayer();
    setInterval(tick, 1000);
  }

  function tick() {
    if (active || !G || !G.state) return;
    const s = G.state;
    if (!s.coach) s.coach = { seen: {} };        // guard: cloud pull replaced state
    if (G.getHp && G.getHp().dead) return;          // never over a death
    if (document.hidden) return;
    // grace delay: condition met → arm; fire 2.5s later if still met
    if (pendingKey) {
      if (Date.now() >= pendingAt) {
        const k = pendingKey; pendingKey = null;
        if (!s.coach.seen[k] && MOMENTS[k].when(s)) start(k);
      }
      return;
    }
    if (Date.now() - lastEnd < 15000 && lastEnd > 0) return; // breathing room
    for (const k of ORDER) {
      if (!s.coach.seen[k] && MOMENTS[k].when(s)) {
        pendingKey = k;
        pendingAt = Date.now() + (k === 'welcome' ? 400 : 2500);
        return;
      }
    }
  }
  // external nudge (e.g. lootScrapped fires the bagfull moment immediately)
  function notify(key) {
    if (!G || active || !MOMENTS[key] || G.state.coach.seen[key]) return;
    if (!pendingKey) { pendingKey = key; pendingAt = Date.now() + 1500; }
  }

  // ---------------------------------------------------------------------------
  function start(key) {
    const m = MOMENTS[key];
    G.state.coach.seen[key] = true; G.save();       // one-shot, even if skipped
    if (m.dock && G.state.currentDungeon >= 1) {
      G.selectDungeon(0);                            // safe home hangar
      if (window.UI && window.UI.showScreen) window.UI.showScreen('battle');
    }
    active = { key, m }; stepIdx = 0;
    layer.style.display = 'block';
    renderStep();
    posTimer = setInterval(position, 350);
  }
  function finish() {
    active = null; lastEnd = Date.now();
    layer.style.display = 'none';
    clearInterval(posTimer); clearTimeout(findTimer);
  }
  function advance() {
    stepIdx++;
    if (!active || stepIdx >= active.m.steps.length) { finish(); return; }
    renderStep();
  }

  function step() { return active ? active.m.steps[stepIdx] : null; }

  function renderStep() {
    const st = step(); if (!st) { finish(); return; }
    card.querySelector('.co-step').textContent = (stepIdx + 1) + ' / ' + active.m.steps.length;
    card.querySelector('.co-title').innerHTML = st.title;
    card.querySelector('.co-body').innerHTML = st.body;
    const next = card.querySelector('.co-next');
    next.style.display = st.tap ? 'none' : '';
    card.querySelector('.co-actions').style.display = st.tap ? 'none' : 'flex';
    next.textContent = stepIdx === active.m.steps.length - 1 ? 'Done ✓' : 'Next →';
    ring.classList.toggle('pulse', !!st.tap);
    // target may not exist yet (screen still rendering) — retry briefly
    let tries = 0;
    clearTimeout(findTimer);
    const seek = () => {
      if (!active) return;
      const t = st.target ? document.querySelector(st.target) : null;
      if (st.target && !t && tries++ < 14) { findTimer = setTimeout(seek, 280); return; }
      position();
    };
    seek();
  }

  function position() {
    const st = step(); if (!st) return;
    const t = st.target ? document.querySelector(st.target) : null;
    if (t) {
      const r = t.getBoundingClientRect();
      if (r.width > 1) {
        ring.style.opacity = '1';
        const pad = 6;
        ring.style.left = (r.left - pad) + 'px';
        ring.style.top = (r.top - pad) + 'px';
        ring.style.width = (r.width + pad * 2) + 'px';
        ring.style.height = (r.height + pad * 2) + 'px';
        // card: opposite half of the screen from the target
        card.classList.toggle('low', r.top < window.innerHeight * 0.45);
        return;
      }
    }
    // no target — dim everything, card centered low
    ring.style.opacity = '0';
    ring.style.left = '50vw'; ring.style.top = '40vh'; ring.style.width = '0px'; ring.style.height = '0px';
    card.classList.remove('low');
  }

  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Self-contained styles — injected from JS so the coach NEVER depends on a
  // (possibly service-worker-stale) stylesheet. Identical rules also live in
  // web.css; duplicates are harmless.
  const CSS = `
#coach-layer{position:fixed;inset:0;z-index:320;display:none;pointer-events:none}
#coach-layer .co-ring{position:fixed;left:0;top:0;border:2px solid #ffd24d;border-radius:13px;pointer-events:none;box-shadow:0 0 0 9999px rgba(4,8,14,.66),0 0 18px rgba(255,210,77,.55);transition:opacity .25s ease}
#coach-layer .co-ring.pulse{animation:coPulse 1.4s ease-in-out infinite}
@keyframes coPulse{0%,100%{border-color:#ffd24d;box-shadow:0 0 0 9999px rgba(4,8,14,.66),0 0 14px rgba(255,210,77,.45)}50%{border-color:#ffe9b0;box-shadow:0 0 0 9999px rgba(4,8,14,.66),0 0 26px rgba(255,210,77,.85)}}
#coach-layer .co-card{position:fixed;left:50%;transform:translateX(-50%);bottom:96px;width:min(92vw,350px);pointer-events:auto;background:linear-gradient(165deg,#141c2b,#0d1320);border:1px solid rgba(255,210,77,.4);border-radius:15px;padding:13px 15px 12px;box-shadow:0 12px 40px rgba(0,0,0,.6),0 0 24px -8px rgba(255,210,77,.35);font-family:'Rajdhani',system-ui,sans-serif}
#coach-layer .co-card.low{bottom:auto;top:88px}
#coach-layer .co-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
#coach-layer .co-step{font-size:9.5px;font-weight:800;letter-spacing:.12em;color:#ffd24d;white-space:nowrap}
#coach-layer .co-skip{background:none;border:none;color:#8a97ab;font-size:10px;font-weight:700;cursor:pointer;padding:2px 4px}
#coach-layer .co-skip:hover{color:#e8eef7}
#coach-layer .co-title{font-family:'Orbitron','Rajdhani',sans-serif;font-size:15.5px;font-weight:800;color:#ffe9c4;letter-spacing:.02em}
#coach-layer .co-body{font-size:11.5px;color:#b9c4d6;line-height:1.55;margin-top:4px}
#coach-layer .co-body b{color:#e8eef7}
#coach-layer .co-actions{display:flex;justify-content:flex-end;margin-top:9px}
#coach-layer .co-next{border:1px solid rgba(255,210,77,.55);background:rgba(255,210,77,.14);color:#ffe9c4;font-size:11.5px;font-weight:800;border-radius:99px;padding:7px 16px;cursor:pointer}
#coach-layer .co-next:active{transform:translateY(1px)}
@media (prefers-reduced-motion:reduce){#coach-layer .co-ring,#coach-layer .co-ring.pulse{animation:none;transition:none}}`;

  function buildLayer() {
    const st = document.createElement('style');
    st.id = 'coach-style';
    st.textContent = CSS;
    document.head.appendChild(st);
    layer = document.createElement('div');
    layer.id = 'coach-layer';
    layer.innerHTML = `
      <div class="co-ring"></div>
      <div class="co-card">
        <div class="co-head"><span class="co-step"></span><button class="co-skip">Skip tips</button></div>
        <div class="co-title"></div>
        <div class="co-body"></div>
        <div class="co-actions"><button class="co-next">Next →</button></div>
      </div>`;
    document.body.appendChild(layer);
    ring = layer.querySelector('.co-ring');
    card = layer.querySelector('.co-card');
    card.querySelector('.co-next').addEventListener('click', advance);
    card.querySelector('.co-skip').addEventListener('click', () => {
      // skip = silence the whole tutorial
      ORDER.forEach((k) => { G.state.coach.seen[k] = true; });
      G.save(); finish();
    });
    // tap-step: advance when the player clicks the highlighted control
    document.addEventListener('click', (e) => {
      const st = step();
      if (!st || !st.tap || !st.target) return;
      const hit = e.target.closest && e.target.closest(st.target);
      if (hit) setTimeout(advance, 380);              // let the real handler render first
    }, true);
    window.addEventListener('resize', position);
  }

  window.COACH = { init, notify };
})();
