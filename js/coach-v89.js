/* =============================================================================
   coach.js — LOOT FLEET first-time-experience coaching
   ---------------------------------------------------------------------------
   Milestone-driven coach marks. Each "moment" fires ONCE per account at the
   player's first encounter with a system, tracking the CURRENT layout where
   most progression screens now live inside the bottom-nav COMMAND menu:

     BOTTOM NAV (always visible): Battle · Zone Grind · Loot · Hangar · Command
     COMMAND MENU cards [data-go]: My Galaxy · Dreadnaught Hunt ·
       Pilot Tree · Pilot Skills · Prism Mining · Prism Fleet

   Moments + their unlock gates (kept in lock-step with game.html LOCKS and the
   feature modules):

     welcome    · first login            → deploy to Zone 1
     loot       · first item collected   → equip upgrades from the hold
     skills     · first skill points     → Command ▸ Pilot Skills
     bagfull    · hold hits capacity     → auto-sell / expand cargo
     ships      · level 8                → Hangar ▸ Ships (blueprints & escorts)
     prism      · level 15               → Command ▸ Prism Mining (idle ◈)
     galaxy     · level 25               → Command ▸ My Galaxy (turf war)
     citadel    · own a 2nd system       → Command ▸ My Galaxy (build a Citadel)
     pilot      · level 30               → Command ▸ Pilot Tree (◇ Dread Cores)
     dread      · level 30               → Command ▸ Dreadnaught Hunt (weekly raid)
     prismfleet · level 200              → Command ▸ Prism Fleet (boss gauntlet)

   Anything reached through Command is taught in two hops: spotlight the COMMAND
   button, then the specific card inside the menu — so the tutorial follows the
   real navigation instead of pointing at the now-hidden grouped nav buttons.

   SAFETY LOGIC: a moment never interrupts combat directly — when one triggers
   mid-fight we wait a beat, dock the player at the safe home hangar, then run
   the coaching steps. Steps highlight the real UI (spotlight ring + card) and
   advance when the player taps the highlighted control, so the tutorial IS the
   game, not a slideshow. Veteran saves are grandfathered: basics their level
   proves they know are marked seen, while newly-relocated features re-arm once
   (coach.ver migration) so existing pilots still get caught up on what moved.
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
      when: (s) => s.level >= 25,
      dock: true,
      steps: [
        { title: 'Level 25 — THE GALAXY is open', body: 'Beyond zone grinding lies the turf war: a shared galaxy of tiles to <b>conquer, farm and defend</b> against rival fleets.' },
        { target: NAV('galaxy'), tap: true, title: 'Open The Galaxy', body: 'Tap the highlighted button.' },
        { target: '#galaxy-body', title: 'Claim your turf', body: 'Capture tiles spreading out from your citadel — each one generates <b>⬢ fuel · ◆ iron · ✦ plasma every hour, even offline</b>. Richer rings pay more… and attract raiders. Hold your ground.' },
      ],
    },
    supply: {
      when: (s) => s.level >= 30,
      dock: true,
      steps: [
        { title: 'Level 30 — GALAXY SUPPLY is open', body: 'Skip the RNG: supply crates let you <b>buy the exact gear tier you want</b> with the resources you farm — every tier crate is a 100% guaranteed drop.' },
        { target: '#nav-command', tap: true, title: 'Open Command', body: 'Galaxy Supply lives in your Command console. Tap the highlighted button.' },
        { target: '#mega .mega-card[data-go="crates"]', tap: true, title: 'Open Crates', body: 'Tap the crate card, then the SUPPLY tab.' },
        { target: '#boxes-body', title: 'Requisition your gear', body: 'Pick a rarity and buy it outright — crates roll <b>at your current zone</b>, so deeper pushes mean stronger requisitions. The <b>Cosmic Cache</b> is the only source of Artifact-tier relics.' },
      ],
    },
    missions: {
      when: (s) => s.level >= 3,
      dock: true,
      steps: [
        { title: 'Daily orders are in 📋', body: 'Fleet Command issues <b>10 missions every day</b> — kills, bosses, scavenging, patrols. Each pays gold, resources, even LootCoins. Clear all 10 for the <b>Commander&#39;s Crate: 100 ◉ LootCoins</b>.' },
        { target: '#nav-command', tap: true, title: 'Open Command', body: 'The mission board lives in your Command console. Tap it.' },
        { target: '#mega .mega-card[data-go="missions"]', tap: true, title: 'Open Missions', body: 'Tap the Missions card.' },
        { target: '#missions-body', title: 'Claim as you go', body: 'Progress counts automatically while you fight. When a bar fills, come back and hit <b>CLAIM</b>. The board resets at midnight — don&#39;t let a day&#39;s crate slip.' },
      ],
    },
    push: {
      when: (s) => s.level >= 5 && (s.highestUnlocked || 1) >= 2,
      dock: false,
      steps: [
        { title: 'Don&#39;t farm one zone forever', body: 'Loot quality scales with <b>zone depth</b>, not time spent. If you&#39;re clearing easily, you&#39;re under-farming — push.' },
        { target: NAV('zones'), tap: true, title: 'Open Zone Grind', body: 'Tap the highlighted button.' },
        { target: '#zones-body .zone-row.rec', title: 'Follow the ★', body: 'The ★ RECOMMENDED row is tuned to your power. Wave zones (every 11th) and ⛴ citadel zones pay bonus loot — the journey chart shows how far you&#39;ve flown.' },
      ],
    },
    prism: {
      when: (s) => s.level >= 15,
      dock: true,
      steps: [
        { title: 'Level 15 — PRISM MINING ◈', body: 'A new idle income: deploy into a Prism Field and your kills there refine into <b>◈ Prism Ingots</b> — the currency behind the strongest late-game gear.' },
        { target: '#nav-command', tap: true, title: 'Open Command', body: 'Tap the highlighted button.' },
        { target: '#mega .mega-card[data-go="prism"]', tap: true, title: 'Open Prism Mining', body: 'Tap the card.' },
        { target: '#prism-body', title: 'Deploy and fight', body: 'Start a run, then battle inside the field — every kill refines ingots. Deeper zones refine faster.' },
      ],
    },
    pilot: {
      when: (s) => s.level >= 30,
      dock: true,
      steps: [
        { title: 'Level 30 — PILOT TREE ◇', body: 'The Dreadnaught Hunt drops <b>◇ Dread Cores</b> — spend them here on <b>permanent ship-wide bonuses</b> that survive every refit.' },
        { target: '#nav-command', tap: true, title: 'Open Command', body: 'Tap the highlighted button.' },
        { target: '#mega .mega-card[data-go="pilot"]', tap: true, title: 'Open the Pilot Tree', body: 'Tap the card.' },
      ],
    },
    dread: {
      when: (s) => s.level >= 30,
      dock: true,
      steps: [
        { title: 'THE DREADNAUGHT HUNT ⚔', body: 'A weekly raid boss stalks the deep zones. Hunt it down for <b>◇ Dread Cores</b> — the only fuel for your Pilot Tree.' },
        { target: '#nav-command', tap: true, title: 'Open Command', body: 'Tap the highlighted button.' },
        { target: '#mega .mega-card[data-go="dread"]', tap: true, title: 'Open Dreadnaught Hunt', body: 'Tap the card and read the week&#39;s intel — the hunt pays best on the first kill.' },
      ],
    },
    moon: {
      when: (s) => s.level >= 30,
      dock: true,
      steps: [
        { title: 'Level 30 — MOON COLONY 🌙', body: 'You&#39;ve earned a moon. Build mines, refineries and defenses — it produces resources <b>24/7, even offline</b>. Terraform it fully and you can claim <b>more moons</b>.' },
        { target: '#nav-command', tap: true, title: 'Open Command', body: 'Tap the highlighted button.' },
        { target: '#mega .mega-card[data-go="moon"]', tap: true, title: 'Open Moon Colony', body: 'Tap the card.' },
        { target: '#moon-body', title: 'Build — and DEFEND', body: 'Tap a <b>+ BUILD</b> slot to place your first mine. Warning: pirates raid every few hours — without enough 🛡 defense they knock your systems <b>offline</b> and you pay for repairs. Towers first, profits second.' },
      ],
    },
  };
  const ORDER = ['welcome', 'loot', 'bagfull', 'skills', 'missions', 'push', 'ships', 'prism', 'galaxy', 'pilot', 'dread', 'moon', 'supply'];

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
      if (s.level >= 35) s.coach.seen.supply = true;
      G.save();
    }
    // v3 migration — grandfather the NEW moments on veteran saves so they
    // aren't spammed, while players approaching each gate still get coached
    if (!s.coach.v3) {
      s.coach.v3 = true;
      if (s.level >= 10) { s.coach.seen.missions = true; s.coach.seen.push = true; }
      if (s.level >= 22) s.coach.seen.prism = true;
      if (s.level >= 38) { s.coach.seen.pilot = true; s.coach.seen.dread = true; s.coach.seen.moon = true; }
      G.save();
    }
    buildLayer();
    setInterval(tick, 1000);
  }

  function tick() {
    if (active || !G || !G.state) return;
    const s = G.state;
    if (!s.coach) s.coach = { seen: {} };        // guard: cloud pull replaced state
    // ASCENDED PILOTS ARE DONE BEING TAUGHT. Set once at ascension and honoured
    // for moments added in later builds too, so the tutorial never comes back.
    if (s.coach.allSeen || ((s.pasc && s.pasc.stars) | 0) > 0) return;
    // ONE TUTORIAL AT A TIME. onboard.js runs an authored five-step opening for
    // brand-new pilots and hides most of the interface while it does. Coach
    // moments firing into that would be a second teacher talking over the first,
    // pointing at chrome that isn't on screen yet. Wait until it has released.
    try { if (window.ONBOARD && !window.ONBOARD.isDone()) return; } catch (e) {}
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
    if (!G || active || !MOMENTS[key] || !G.state.coach || G.state.coach.seen[key]) return;
    if (G.state.coach.allSeen || ((G.state.pasc && G.state.pasc.stars) | 0) > 0) return;
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
      // skip = silence the whole tutorial, permanently and across future builds
      silence();
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

  // Silence every moment, now and in future builds. Called by the coach's own
  // Skip button and by onboard.js's, so opting out of one opts out of both.
  function silence() {
    try {
      if (!G || !G.state) return;
      G.state.coach = G.state.coach || { seen: {} };
      G.state.coach.allSeen = true;
      ORDER.forEach((k) => { G.state.coach.seen[k] = true; });
      G.save();
      if (active) finish();
    } catch (e) {}
  }

  window.COACH = { init, notify, silence, keys: () => ORDER.slice() };
})();
