/* =============================================================================
   features-data.js — the 25 ranked Loot Fleet features + row renderer
   ---------------------------------------------------------------------------
   FEATURES is ordered MOST → LEAST important for a brand-new player's interest.
   Each entry renders one alternating text|device row whose phone runs the live
   sim named by `sim` (defined across sim-core / sim-scenes-* / sim-arena /
   sim-map / sim-ui). Rows + the ranked index are injected before sim-core's
   setup runs, so the engine finds every canvas[data-sim]. Grounded entirely in
   the real game config (config.js): 12 rarities, 6 slots, 10 hulls, 3 skill
   branches, the galaxy turf war, idle combat, resources, cosmetics, cloud save.
   ============================================================================= */
(function () {
  'use strict';

  function glow(hex, a) { const n = parseInt(hex.slice(1), 16); return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + (a || 0.42) + ')'; }
  const NAV = ['Battle', 'Galaxy', 'Loot', 'Hangar', 'Rank'];

  const FEATURES = [
    {
      id: 'loot', sim: 'loot', acc: '#f2b24b', cat: 'Endgame chase', nav: 2, hudL: '\u26a1 HERO POWER', hudV: '6.4B', cap: 'loot magnet + rarity drops',
      title: 'Loot that never stops dropping',
      lead: 'Every kill can cough up an upgrade. Gear rolls across twelve glowing rarities and six slots, with rare affixes like life-steal and multi-shot — and a loot magnet that vacuums the whole haul straight into your hull.',
      mech: [['Twelve rarities', 'Common climbs all the way to Primordial — each tier brighter, rarer, and meaner than the last.'], ['Six gear slots', 'Cannon, munitions, hull, thrusters, targeting and shield core — every one hot-swappable mid-run.'], ['Auto-magnet pickup', 'Drops arc out, then snap to your ship. Nothing on the field is ever left behind.']],
      stat: [['12', 'Rarities'], ['6', 'Gear slots'], ['\u221e', 'Scaling']],
    },
    {
      id: 'autobattle', sim: 'autobattle', acc: '#5fd1ff', cat: 'The core hook', nav: 0, hudL: '\u25c9 AUTO-COMBAT', hudV: '4.2B', cap: 'hands-free auto-targeting',
      title: 'It plays itself — beautifully',
      lead: 'Deploy to a zone and your fleet fights on its own: auto-targeting the swarm, dodging, and dropping loot without a single tap. Watch it, or set it and walk away.',
      mech: [['Zero busywork', 'Targeting, firing and movement are fully automated — combat is a spectacle, not a chore.'], ['Always-on reticles', 'Your guns lock the nearest threats and prioritise big targets automatically.'], ['Tap only when you want', 'Jump in to retarget or tune the build — or just let the kills roll in.']],
      stat: [['100%', 'Automated'], ['0', 'Taps needed']],
    },
    {
      id: 'idle', sim: 'idle', acc: '#46d27a', cat: 'Idle engine', nav: 0, hudL: '\u23f1 OFFLINE HAUL', hudV: '0', cap: 'auto-farm while away',
      title: 'Your fleet farms while you sleep',
      lead: "Close the tab and the autopilot keeps fighting. Kills, loot, and XP bank the entire time you're away — then a single tap collects the whole offline haul the moment you return.",
      mech: [['True offline progress', 'Earnings accrue with the game closed — generously capped, never gated behind ads.'], ['Autopilot combat', 'The operator targets, fires, and dodges on its own at up to 10\u00d7 speed.'], ['Welcome-back chest', 'Every return drops a fat lump sum of loot and currency, ready to claim.']],
      stat: [['24/7', 'Farming'], ['10\u00d7', 'Sim speed']],
    },
    {
      id: 'evolve', sim: 'evolve', acc: '#b87bff', cat: 'Progression', nav: 3, hudL: '\u2699 HULL POWER', hudV: '1.8B', cap: 'blueprint \u2192 hull evolution',
      title: 'From scrappy frigate to titan carrier',
      lead: 'Beat zone bosses for blueprints, bank the shards, and watch a single hull evolve through ten classes — each one bigger, with new weapons, heavier plating, and more drone bays bolted on.',
      mech: [['Ten hull classes', 'A clean upgrade ladder from nimble Frigate to galaxy-dominating Titan Carrier.'], ['Blueprint crafting', 'Bosses drop the schematics; complete a set and the evolution fires instantly.'], ['Every hull plays different', 'More mounts, more drones, more raw power at every single tier you reach.']],
      stat: [['10', 'Hull classes'], ['1', 'Evolving fleet']],
    },
    {
      id: 'rarity', sim: 'rarity', acc: '#ff6ad5', cat: 'The dopamine ladder', nav: 2, hudL: '\u25c6 RARITY TIER', hudV: 'T1', cap: 'Common \u2192 Primordial',
      title: 'Twelve rarities, each one a bigger rush',
      lead: 'Loot quality is gated by how deep you push. The brightest tiers — Cosmic, Void, Eternal, Primordial — drop one in millions, and the moment a card flips to a new colour is the whole reason to keep going.',
      mech: [['Geometric rarity', 'Drop odds fall off a cliff each tier — a Primordial is roughly one in fifty million.'], ['Zone-gated quality', 'No Divine raining on Zone 1; the best colours only appear in the deepest space.'], ['More rolls, more power', 'Higher tiers roll more stat lines and fatter multipliers — up to 28.5\u00d7.']],
      stat: [['12', 'Tiers'], ['1 in 50M', 'Top drop'], ['28.5\u00d7', 'Max mult']],
    },
    {
      id: 'galaxy', sim: 'galaxy', acc: '#5fd1ff', cat: 'Conquest', nav: 1, hudL: '\u25c8 SYSTEMS HELD', hudV: '1 SYS', cap: 'siege & territory capture',
      title: 'Take the map, hold the map',
      lead: 'Warp an infinite hex galaxy, siege enemy systems in ten-wave battles, and plant your flag. Every system you hold pumps out fuel, iron, and plasma on the hour — even while you sleep.',
      mech: [['Infinite hex map', 'Thousands of systems spiralling outward with no edge to the frontier.'], ['Ten-wave sieges', 'Clear the defenders, flip the system, and lock it into your growing territory.'], ['Hourly tribute', 'Held systems generate fuel, iron, and plasma around the clock, automatically.']],
      stat: [['1,950', 'Tiles'], ['3', 'Resources']],
    },
    {
      id: 'boss', sim: 'boss', acc: '#ffa838', cat: 'Set-piece fights', nav: 0, hudL: '\u26f4 ZONE BOSS', hudV: '12B', cap: 'siege the citadel, take the blueprint',
      title: 'Bosses that drop the next ship',
      lead: 'Every milestone zone ends in a hulking citadel boss. Burn it through its damage states — burning, breaking, critical — for the blueprint that unlocks your next hull class.',
      mech: [['Multi-state bosses', 'Watch the integrity bar melt as the citadel catches fire and breaks apart.'], ['Blueprint rewards', 'Each boss guards the schematic for a specific hull — ten expeditions in all.'], ['Loot supernova', 'The kill blast clears the field and fountains high-tier gear in every direction.']],
      stat: [['10', 'Hull blueprints'], ['100+', 'Boss zones']],
    },
    {
      id: 'speed', sim: 'speed', acc: '#ff5168', cat: 'Tempo control', nav: 0, hudL: '\u23e9 SIM SPEED', hudV: '1\u00d7', cap: 'dial it 1\u00d7 \u2192 10\u00d7',
      title: 'Run the whole game at 10\u00d7',
      lead: 'One dial controls the pace. Crank it from 1\u00d7 up through the free 3\u00d7, and chase the secret 10\u00d7 unlock that turns grinding into a firehose of kills and loot.',
      mech: [['Free up to 3\u00d7', 'No paywall on tempo — triple speed is free for everyone, forever.'], ['Premium 4\u00d7 & 5\u00d7', 'Push faster with LootCoins or Pro for the serious grinders.'], ['The secret 10\u00d7', 'A hidden Mothership easter-egg unlocks the fastest speed in the galaxy.']],
      stat: [['10\u00d7', 'Top speed'], ['3\u00d7', 'Free for all']],
    },
    {
      id: 'skills', sim: 'skills', acc: '#f2b24b', cat: 'Build crafting', nav: 3, hudL: '\u2726 SKILL POINTS', hudV: '0 PTS', cap: 'branches lighting up',
      title: 'Three branches, one signature build',
      lead: 'Spend every level across Offense, Defense, and Tactics — a deep tree that stays meaningful to Level 1000. Mix branches freely, chase capstones that bend the rules, and respec any time.',
      mech: [['Three deep trees', 'Offense, Defense, and Tactics, each a long chain with escalating point costs.'], ['Build-defining capstones', 'Endgame nodes like Annihilation, Immortal and Singularity reshape how you fight.'], ['Free respec', 'Repaint your whole build whenever you want to try a fresh direction.']],
      stat: [['3', 'Branches'], ['48', 'Nodes'], ['1,000', 'Levels deep']],
    },
    {
      id: 'drones', sim: 'drones', acc: '#7fffcb', cat: 'Carrier warfare', nav: 3, hudL: '\u25c8 DRONE BAY', hudV: '6/6', cap: 'drones swarm & fire',
      title: 'Carriers launch a drone swarm',
      lead: 'Fly a carrier-class hull and kills drop drones into your empty bays. They orbit your ship, target independently, and lay down their own fire — up to twelve escorting a Titan.',
      mech: [['Self-filling bays', 'Each kill has a chance to spawn a fresh drone into an open bay.'], ['Independent guns', 'Drones pick their own targets and add a constant second layer of damage.'], ['Up to twelve', 'Stack bays from two on a Carrier to twelve on the endgame Mothership.']],
      stat: [['12', 'Max drones'], ['45%', 'Drone damage']],
    },
    {
      id: 'zones', sim: 'zones', acc: '#b87bff', cat: 'Endless push', nav: 0, hudL: '\u25b6 ZONE', hudV: 'Z142', cap: 'warp deeper, forever',
      title: 'There is no final zone',
      lead: 'Zones reveal in blocks of a hundred and never stop. Clear 100 to open 200, clear 200 for 300 — difficulty and rewards ride the same curve, so the frontier is always just within reach.',
      mech: [['Geometric scaling', 'Enemy power and your gear climb together, so every zone feels winnable.'], ['Blocks of 100', 'Each clear unlocks the next hundred — the map literally has no ceiling.'], ['Deeper = rarer', 'Higher rarity caps and luck multipliers live only at the bleeding edge.']],
      stat: [['\u221e', 'Zones'], ['\u00d71.18', 'Per-zone curve']],
    },
    {
      id: 'heats', sim: 'heats', acc: '#ffa838', cat: 'Competition', nav: 4, hudL: '\u265b HEAT RANK', hudV: '#14', cap: 'climbing to #1',
      title: 'A leaderboard that is actually fair',
      lead: "Every account is sorted into a weekly heat against operators who started the same week you did. No whales, no veterans with a year's head start — just a level race to the top, reset every seven days.",
      mech: [['Fair brackets', 'You only ever race players on the exact same timeline as you.'], ['Live re-ranking', 'Your position shifts in real time as your Hero Power climbs.'], ['Weekly reset', 'Fresh heat, fresh shot at the number-one spot every single week.']],
      stat: [['#1', 'The target'], ['7-Day', 'Reset']],
    },
    {
      id: 'special', sim: 'special', acc: '#46d27a', cat: 'Rare affixes', nav: 2, hudL: '\u2665 AFFIX PROC', hudV: '6B', cap: 'life-steal + multi-shot',
      title: 'The drops that change everything',
      lead: 'Beyond normal stats, any item can roll a rare special line. Life Steal heals you as you deal damage; Multi-Shot fires at a fan of extra targets. Finding a high roll genuinely reshapes your run.',
      mech: [['Life Steal', 'Heal a slice of all damage dealt — 1% to a very rare 5%.'], ['Multi-Shot', 'A chance every attack to also hit up to ten nearby enemies.'], ['Roll the perfect piece', 'Specials stack across gear, so chasing the god-roll never really ends.']],
      stat: [['2', 'Special types'], ['\u00d710', 'Multi-shot targets']],
    },
    {
      id: 'autoequip', sim: 'autoequip', acc: '#4fa6ff', cat: 'Quality of life', nav: 2, hudL: '\u25ce GOLD', hudV: '10K', cap: 'upgrades equip, junk sells',
      title: 'It manages the loot for you',
      lead: "Drowning in drops is the point — sorting them isn't. Upgrades snap into the right slot automatically, and everything else auto-sells to gold. Your loadout stays optimal without a single menu visit.",
      mech: [['Auto-equip upgrades', 'A better roll routes straight into its slot the instant it drops.'], ['Auto-sell the rest', 'Junk converts to gold on pickup — your inventory never clogs.'], ['Always optimal', 'Your Hero Power climbs on its own while you watch the fight.']],
      stat: [['0', 'Menus needed'], ['Auto', 'Loadout']],
    },
    {
      id: 'fleet', sim: 'fleet', acc: '#5fb0ff', cat: 'Late-game scale', nav: 3, hudL: '\u25c6 FLEET', hudV: '80B', cap: 'flagship + 4 escorts',
      title: 'Command a five-ship fleet',
      lead: 'From Level 100 you unlock an escort slot every hundred levels. Your flagship leads four wingmen in formation — each firing real shots and lending a share of its hull stats to your fleet score.',
      mech: [['Flagship + four escorts', 'Field five unique hulls at once, flying in tight formation.'], ['Escorts that fight', 'Wingmen fire their own weapons and chip in a quarter of your damage each.'], ['Shared power', 'Every escort contributes 30% of its hull mods to your total Hero Power.']],
      stat: [['5', 'Ships at once'], ['Lv 100+', 'Unlocks']],
    },
    {
      id: 'turf', sim: 'turf', acc: '#f2b24b', cat: 'Living galaxy', nav: 1, hudL: '\u2691 YOUR HEXES', hudV: '0', cap: 'tug-of-war vs real rivals',
      title: 'Turf War over real territory',
      lead: 'The galaxy map is a contested board of 1,950 tiles. Push your gold frontier into neutral and rival space, capture systems, and defend them — the borders shift live as rival fleets push back.',
      mech: [['Real opponents', 'You contest hexes against other operators, not just AI.'], ['Push and defend', 'Every captured system widens your border and your hourly income.'], ['Borders move live', 'Lose ground if you stop pushing — the front is never static.']],
      stat: [['1,950', 'Contested tiles'], ['PvP', 'Territory']],
    },
    {
      id: 'resources', sim: 'resources', acc: '#5fd1ff', cat: 'Economy', nav: 1, hudL: '\u26fd RESOURCES', hudV: '3 RES', cap: 'fuel \u00b7 iron \u00b7 plasma',
      title: 'Three resources fund the empire',
      lead: 'Held systems and salvaged gear pour fuel, iron, and plasma into your stockpile every hour. They warp fleets, build citadels, and ultimately buy the faction Mothership — the deepest economy in the game.',
      mech: [['Fuel, iron, plasma', 'The workhorse, the structural metal, and the rare endgame catalyst.'], ['Always trickling', 'Income accrues hourly from every system you hold, online or off.'], ['Powers everything', 'Spend it on conquest, citadels, and the resource-only Mothership.']],
      stat: [['3', 'Resource types'], ['Hourly', 'Income']],
    },
    {
      id: 'power', sim: 'power', acc: '#f2b24b', cat: 'The number', nav: 3, hudL: '\u26a1 HERO POWER', hudV: '1.57K', cap: 'every stat, climbing',
      title: 'One number that always goes up',
      lead: 'Hero Power folds six core stats — damage, fire rate, crit, crit damage, health, move speed — plus gear, skills, hull, drones and fleet into a single score. Watching it climb is the heartbeat of the game.',
      mech: [['Six core stats', 'Every source of power resolves into one honest, comparable number.'], ['Instant feedback', 'Equip, level, or evolve and the meter jumps — progress you can feel.'], ['Gates the deep zones', 'Your power decides how far into the infinite frontier you can safely push.']],
      stat: [['6', 'Core stats'], ['\u2191', 'Always']],
    },
    {
      id: 'salvage', sim: 'salvage', acc: '#5fd1ff', cat: 'Nothing wasted', nav: 2, hudL: '\u2692 SALVAGE', hudV: 'SCRAP', cap: 'gear \u2192 resource shards',
      title: 'Scrap loot into raw materials',
      lead: "Not every drop is an upgrade — and that's fine. Salvage unwanted gear and it bursts into fuel, iron, and plasma shards, with rarer pieces yielding the scarcer materials your empire actually needs.",
      mech: [['Rarity-scaled yield', 'The better the gear, the more — and rarer — the resources it returns.'], ['Feeds the galaxy', 'Salvage is a steady faucet for iron and plasma between captures.'], ['One-tap scrapping', 'Bulk-salvage everything below your threshold automatically.']],
      stat: [['3', 'Materials out'], ['90%', 'Recovery odds']],
    },
    {
      id: 'shop', sim: 'shop', acc: '#f2b24b', cat: 'Spend the gold', nav: 2, hudL: '\u25ce GOLD SHOP', hudV: 'SHOP', cap: 'three rotating items',
      title: 'A shop that refreshes every 15 minutes',
      lead: 'All that auto-sold gold has a home. Three hand-rolled items — Legendary up to Void — sit on the shelf and rotate every quarter hour, a reliable way to fill a stubborn empty slot.',
      mech: [['Three rolled items', 'Always Legendary or better, never the same shelf twice.'], ['Refreshes on a timer', 'A new rotation every 15 minutes keeps the gold loop alive.'], ['Targeted upgrades', 'Buy the exact slot the RNG has been denying you.']],
      stat: [['3', 'Items'], ['15 min', 'Refresh']],
    },
    {
      id: 'skins', sim: 'skins', acc: '#b87bff', cat: 'Flex, fair', nav: 3, hudL: '\u2728 HULL SKIN', hudV: 'SKINS', cap: 'seven premium finishes',
      title: 'Wear your status on your hull',
      lead: 'Seven cosmetic finishes — from Crimson Fang to solid-gold Gilded and the animated Prismatic chrome — let the top of the leaderboard look the part. Pure cosmetic, never a stat. Flex without pay-to-win.',
      mech: [['Seven finishes', 'Stealth whites, predator stripes, void-forged plate, rainbow chrome.'], ['Zero power', 'Skins change how you look, never how hard you hit.'], ['Earned or bought', 'Priced in premium Credits — a badge of a serious operator.']],
      stat: [['7', 'Hull skins'], ['0', 'Stat effect']],
    },
    {
      id: 'citadel', sim: 'citadel', acc: '#5fd1ff', cat: 'Deep-space empire', nav: 1, hudL: '\u25c8 CITADEL', hudV: '0 NODES', cap: 'build the stronghold',
      title: 'Raise citadels in deep space',
      lead: 'Anchor your conquest with citadels — layered strongholds that extend turret rings and project a shield over the systems around them. Your territory stops being lines on a map and becomes a fortress.',
      mech: [['Ring-by-ring builds', 'Structures light up in concentric tiers around a fortified core.'], ['Projected defense', 'A citadel shields the systems in its radius from rival pushes.'], ['Anchor your empire', 'Turn captured frontier into permanent, defensible ground.']],
      stat: [['Multi-ring', 'Structures'], ['Shielded', 'Territory']],
    },
    {
      id: 'mothership', sim: 'mothership', acc: '#ffd24d', cat: 'The endgame', nav: 3, hudL: '\u2756 MOTHERSHIP', hudV: '64T', cap: 'seven guns, twelve drones',
      title: 'The Mothership ends the grind',
      lead: 'The apex vessel is bought with Galaxy Resources alone — a weeks-long goal. Seven weapon hardpoints, twelve drone bays, extended range and top-tier built-in mods make it a screen-filling wall of firepower.',
      mech: [['Seven weapons', 'Three more hardpoints than any other hull, firing in unison.'], ['Twelve drone bays', 'The largest swarm in the galaxy escorts you everywhere.'], ['Resources only', 'No gold can buy it — only fuel, iron, and plasma earned in conquest.']],
      stat: [['7', 'Weapons'], ['12', 'Drone bays']],
    },
    {
      id: 'auras', sim: 'auras', acc: '#b87bff', cat: 'Signature style', nav: 3, hudL: '\u25ce BATTLE AURA', hudV: 'AURAS', cap: 'five orbiting effects',
      title: 'Orbit a battle aura all your own',
      lead: 'Pair your skin with an aura — sentinel guardian rings, a crystalline cryo field, licks of solar flare, a captive void storm, or the rotating prismatic halo. Cosmetic theatre that makes your ship unmistakable.',
      mech: [['Five auras', 'Each a distinct animated field orbiting your hull.'], ['Mix with skins', 'Prismatic halo pairs with the Prismatic skin for the rarest look in space.'], ['Always cosmetic', 'Looks legendary, changes nothing about your stats.']],
      stat: [['5', 'Auras'], ['0', 'Stat effect']],
    },
    {
      id: 'cloud', sim: 'cloud', acc: '#46d27a', cat: 'Play anywhere', nav: 0, hudL: '\u2601 HERO POWER', hudV: '4.2B', cap: 'one save, every device',
      title: 'Free, no download, saved forever',
      lead: 'Loot Fleet runs in any browser — no install, no store. Make a free account and your fleet follows you from phone to desktop and back, perfectly in sync. Or jump in as a guest in one click.',
      mech: [['Cloud save', 'Your progress lives on your account and syncs across every device.'], ['No download', 'Plays instantly in the browser, and keeps running offline.'], ['Guest or account', 'Start in one click; sign up whenever you want to save the run.']],
      stat: [['0', 'Downloads'], ['\u221e', 'Devices']],
    },
  ];

  function rowHTML(f, i) {
    const rev = i % 2 === 1;
    const mech = f.mech.map(function (m) { return '<li><span class="mi">\u25c6</span><div><div class="mt">' + m[0] + '</div><div class="md">' + m[1] + '</div></div></li>'; }).join('');
    const stat = f.stat.map(function (s) { return '<div class="f-stat"><div class="v">' + s[0] + '</div><div class="l">' + s[1] + '</div></div>'; }).join('');
    const nav = NAV.map(function (n, k) { return '<span' + (k === f.nav ? ' class="on"' : '') + '>' + n + '</span>'; }).join('');
    const rank = (i + 1 < 10 ? '0' : '') + (i + 1);
    const copy =
      '<div class="f-copy reveal">' +
        '<div class="f-cat"><span class="n">' + rank + '</span><span class="ln"></span>' + f.cat + '</div>' +
        '<h2>' + f.title + '</h2>' +
        '<p class="f-lead">' + f.lead + '</p>' +
        '<ul class="f-mech">' + mech + '</ul>' +
        '<div class="f-stats">' + stat + '</div>' +
        '<a class="f-cta" href="game.html">Play free <span class="ar">\u2192</span></a>' +
      '</div>';
    const media =
      '<div class="f-media reveal">' +
        '<div class="device" data-device>' +
          '<div class="screen">' +
            '<div class="scr-hud">' +
              '<div class="hud-row"><div class="hud-badge">28</div><div class="hud-pow"><div class="l">' + f.hudL + '</div><div class="v" data-hud="pow">' + f.hudV + '</div></div><div class="hud-coin">\u25ce 10K</div></div>' +
              '<div class="hud-bars"><div class="bar"><i class="xp"></i></div><div class="bar"><i class="hp"></i></div></div>' +
            '</div>' +
            '<div class="scr-arena"><canvas data-sim="' + f.sim + '" data-accent="' + f.acc + '"></canvas></div>' +
            '<div class="scr-nav">' + nav + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="f-cap"><span class="lv"></span>Live \u00b7 ' + f.cap + '</div>' +
      '</div>';
    const inner = rev ? media + copy : copy + media;
    return '<section class="f-row' + (rev ? ' rev' : '') + '" id="' + f.id + '" data-screen-label="' + rank + '" style="--acc:' + f.acc + ';--accGlow:' + glow(f.acc) + '">' + inner + '</section>';
  }

  function indexHTML() {
    return FEATURES.map(function (f, i) {
      const rank = (i + 1 < 10 ? '0' : '') + (i + 1);
      return '<a href="#' + f.id + '" style="--acc:' + f.acc + '"><span class="ri-n">' + rank + '</span><span class="ri-t">' + f.title.replace(/^[a-z]/, c => c.toUpperCase()) + '</span><span class="ri-d" style="background:' + f.acc + '"></span></a>';
    }).join('');
  }

  function render() {
    const rows = document.getElementById('f-rows');
    if (rows) rows.innerHTML = FEATURES.map(rowHTML).join('');
    const idx = document.getElementById('f-index');
    if (idx) idx.innerHTML = indexHTML();
    // scroll reveal
    const els = [].slice.call(document.querySelectorAll('.reveal'));
    if (!('IntersectionObserver' in window)) { els.forEach(function (e) { e.classList.add('in'); }); return; }
    const io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { threshold: 0.16, rootMargin: '0px 0px -6% 0px' });
    els.forEach(function (e) { io.observe(e); });
    // rows now exist — let the sim engine scan & wire every canvas
    if (window.LF_initSims) window.LF_initSims();
  }

  window.LF_FEATURES = FEATURES;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
