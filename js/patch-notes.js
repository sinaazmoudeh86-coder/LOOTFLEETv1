/* =============================================================================
   patch-notes.js — LOOTFLEET · "WHAT'S NEW" ON FIRST LOGIN TO A NEW BUILD
   -----------------------------------------------------------------------------
   Shows one card, once, the first time a player logs in after a build ships.

   WHAT GOES ON THIS CARD — the editorial rule, because it is the whole job:
   ONLY things a PLAYER can see, feel, or must act on. Not everything that
   changed in a build is player information. A migration, a refactor, a renamed
   function, a cache header — those are operator facts, and putting them here
   trains people to close the card without reading it, which costs us the one
   time it really matters.

   The test for each line: **would a player notice if we never told them?**
     · Their 5× speed pill is gone            → YES. Must be here.
     · Cargo runs stopped dropping fittings   → YES. A nerf. Must be here.
     · Their leaderboard row was frozen       → YES. They saw it and complained.
     · lb_upsert dropped an overload          → NO. That is a deploy note.
     · Loot blocking became one predicate     → NO. Same behaviour, better code.
     · A reserved rarity tier exists          → NO. It is not live. Saying so
                                                 just promises something absent.

   TONE: short, punchy, one line each. A player reads this in fifteen seconds
   standing in a queue. Anything longer is a changelog, and the changelog lives
   on the site.

   WHAT A NERF OWES THE PLAYER: it gets said out loud, in plain words, with what
   they keep. Silent removal of something a player is holding reads exactly like
   a bug — see CLAUDE.md. That is why the speed tiers and the cargo loot change
   lead the CHANGED block rather than hiding at the bottom of it.
   ========================================================================== */
(function () {
  'use strict';

  const BUILD = 728;
  const NOTES = {
    build: 728,
    title: 'BUILD 728',
    sub: 'Global chat, a reachable Eternum, and ten fighter airframes.',
    groups: [
      { k: 'CHANGED', c: '#ffcf4d', rows: [
        ['✦', 'The Eternum licence drops to Pilot Ascension ★30', 'It asked for <b>★100</b>, which is the better part of two years of play — far enough away that the Celestial Class read as decoration rather than something to aim at. It now asks <b>★30</b>. Nothing else about it moved: still 1,000 cargo runs secured, still a Titan Sina in the hangar, still commissioned with a core that only the deepest Omega Cargo V manifest gives up. If you are already past ★30, the star line is simply done. And the hangar tile was printing <b>★50</b> while the licence actually wanted ★100 — so if you hit the number you were shown and were still refused, that was our bug, not your progress. Every figure on that card now comes off the licence itself.'],
        ['\u2699', 'Home Citadel wave pay is capped by the clock, not by waves', 'Every wave you clear still pays 2.2 hours of your base\u2019s production, and clearing waves still raises that production permanently. Your wave, your towers, your structures and every balance are untouched. What is new is a bank: it refills at 8 hours of pay per real hour and holds 24. Arrive after a break and the first dozen waves pay in full, exactly as before \u2014 chain waves for an hour and your works settle to 8\u00d7 what your base mines. Part crates and their cores are never lost; they queue and land as the bank refills. A wave\u2019s bonus is also now priced at the production rate you fought it at, rather than the rate it unlocks.'],
      ] },
      { k: 'NEW', c: '#7fd1ff', rows: [
        ['◈', 'Global chat, open from any screen', 'There is a CHAT chip in your top bar now. It opens a panel over whatever you are doing rather than a screen you have to leave the fight for — on a phone it sits above your controls, on a desktop it docks to the right, and the battle keeps running behind it either way. Tap any pilot’s name for their level, zone, power and fleet, and add them as a friend from there. Mute anyone you would rather not read and it follows your account onto every device; the ⚑ on a message reports it to us with the message attached. Two house rules worth knowing before you type: <b>posting unlocks at Level 5</b> (reading is open the moment you have an account), and <b>links are stripped</b> — nobody in this room can send you anywhere, which is the entire point.'],
        ['\u25c8', 'Run your empire from My Systems', 'Every hold in the list has its own controls now. Rank up a citadel \u2014 or raise one where there is none \u2014 at the price printed on the button, jump the galaxy map straight to that hex, or deploy there, all without closing the sheet and hunting for the tile. Sort by revenue, ring, citadel rank or name, and filter down to just your citadels. Your place in the list is kept when you buy, so working down a long empire is one pass.'],
        ['\u25b2', 'Every fighter marque flies its own airframe', 'A wing of Mauls and a wing of Talons used to be the same silhouette. Each marque has its own craft now \u2014 ten airframes in all, most marques with two variants, so two bays of the same marque can still look different. You can read what is in your bays from the arena instead of the menu. Damage, cadence, reach and the rarity colour are all exactly what they were; only the art changed.'],
      ] },
      { k: 'FIXED', c: '#8fc4ff', rows: [
        ['\u25c7', 'Two devices no longer refund a Pilot Tree', 'If the game was open in two places at once, a node bought in one of them could be kept while the Dread Cores it cost were handed back by the other \u2014 so the same cores bought the same tree over and over. You still never lose a node to a stale login: when the two copies are reconciled every node is kept, and the cores it cost are now taken once. Nothing already unlocked has been touched.'],
        ['\u25ce', 'Ascending no longer resets your expeditions flown', 'The Exploration board ranks a career total, but the count was being cleared every time you ascended \u2014 so a pilot with stars read a handful of runs however many they had flown. Expeditions flown, your strongest wing ever sent, every hull\u2019s survey rank and any mission still in flight all ride through ascension now.'],
        ['\u2727', 'What was already lost stays lost', 'We cannot rebuild a count the reset deleted \u2014 the only record of it was the save it was wiped from. Your board climbs from where you stand today, and it will not drop again. If your standing matters to you, contact support and we will look at your account.'],
        ['\u25c7', 'Aegis field projectors have an icon, and auto-sell again', 'The four projectors and the Warden Array drew no icon at all on devices without those symbols in their fonts. Auto-sell also judged them as if they were cannons, so they could never be cleared out of the hold. They now sell like anything else you cannot use \u2014 and are always kept while you own a hull that can mount one, even if you are not flying it.'],
        ['\u25c8', 'My Systems counts built and natural citadels apart', 'The header printed a single \u201ccitadels\u201d figure that mixed the fortresses you built with the ones that came with the tile, so it never agreed with the rows underneath it. It states both now.'],
        ['\u26a1', 'Menus open straight away on phones', 'Tapping between Battle, Zone Grind and Loot could hang for a moment on a phone while nothing appeared to happen. The Loot screen was drawing a card for every single item in your hold \u2014 and redrawing all of them several times a second while you were farming \u2014 so a big hold meant every tap queued behind it. A very full hold now shows its top 200 with a button to open the rest, and the arena stops drawing the instant you open a menu rather than a fraction of a second later. Nothing about your hold or the fight itself changed.'],
        ['\u2709', 'Daily ladder awards arrive without a reload', 'If you left the game open across midnight UTC, your placings from the day before could sit unsent until you next signed in. The game was asking for them in the few minutes before the server had finished working the day out, treating the empty answer as final, and not asking again. It now keeps asking until they land. Nothing was ever lost \u2014 it was waiting.'],
        ['\u26d3', 'Natural fortresses show up under \u26d3 Citadels', 'The Citadels filter in the galaxy list only ever matched citadels a player built, or an enemy one you could go and attack \u2014 so a natural fortress sitting on a system you already hold matched neither and vanished from the list. All three now appear, and they are told apart on sight: \u26d3 in gold is yours, \u26d3 in amber belongs to another pilot, \u26f4 is the natural fortress that came with the ground. Your own citadel prints its rank now too.'],
        ['\u2630', 'The map / list switch is findable', 'Both the galaxy and the Pilot Tree could always be read as a searchable list instead of a map, and almost nobody knew \u2014 the control was a small two-part toggle among a row of identical chips, explained only by a tooltip that a phone never shows. It is now shown as a lit switch with both views on it, glowing until you use it \u2014 and on the Pilot Tree it tells you how many nodes you can afford right now.'],
        ['\u25b6', 'Autopilot is on every time you deploy', 'If you had ever switched autopilot off by hand \u2014 even once, even by accident \u2014 that choice was saved permanently, and every deployment afterwards dropped you into a zone with your fleet sitting still and nothing explaining why. Switching it off now lasts only for the fight you are in; deploying again brings it back. A stray tap on the pill while you were leaving another screen could also flip it off unnoticed, and that no longer counts.'],
      ] },
    ],
  };

  const KEY = 'lf_patch_seen';   // localStorage, NOT the save — a device fact.
  function seen() { try { return (localStorage.getItem(KEY) | 0); } catch (e) { return 0; } }
  function mark(b) { try { localStorage.setItem(KEY, String(b | 0)); } catch (e) {} }

  // A BRAND NEW PLAYER MUST NOT SEE PATCH NOTES. They were not here for the old
  // build, so "battle speed is now three tiers" is meaningless — it is simply
  // how the game works. First run records the build as seen and shows nothing.
  function isNewPlayer() {
    try {
      const s = window.GAME && window.GAME.state;
      if (!s) return true;
      return (s.level | 0) <= 1 && !(s.ascTotal | 0) && !(s.pasc && (s.pasc.stars | 0));
    } catch (e) { return true; }
  }

  function rowHTML(r) {
    return '<div class="pn-r"><i>' + r[0] + '</i><span><b>' + r[1] + '</b>' + r[2] + '</span></div>';
  }
  function show(force) {
    if (document.getElementById('pn-wrap')) return;
    const n = NOTES;
    const body = n.groups.map((g) =>
      '<div class="pn-g" style="--c:' + g.c + '"><div class="pn-k">' + g.k + '</div>' +
      g.rows.map(rowHTML).join('') + '</div>').join('');
    const w = document.createElement('div');
    w.id = 'pn-wrap';
    w.innerHTML =
      '<div class="pn-card" role="dialog" aria-label="What\u2019s new">' +
        '<div class="pn-head"><span class="pn-b">' + n.title + '</span>' +
          '<span class="pn-t">WHAT\u2019S NEW</span></div>' +
        '<div class="pn-sub">' + n.sub + '</div>' +
        '<div class="pn-body">' + body + '</div>' +
        '<button class="pn-ok" id="pn-ok">GOT IT</button>' +
      '</div>';
    document.body.appendChild(w);
    const close = () => { mark(BUILD); w.remove(); };
    w.querySelector('#pn-ok').addEventListener('click', close);
    // Tapping the backdrop closes too, and STILL marks it seen — a player who
    // dismisses it has made a choice; re-showing next session is nagging.
    w.addEventListener('click', (e) => { if (e.target === w) close(); });
    if (!force) mark(BUILD);   // marked on show, so a refresh cannot re-trigger it
  }

  function maybeShow() {
    if (seen() >= BUILD) return;
    if (isNewPlayer()) { mark(BUILD); return; }
    show(false);
  }

  // Wait for the game to be up (so isNewPlayer reads a real save) and for the
  // player to be past the login screen — a patch card over a login form is just
  // an obstacle. The update gate outranks it: if a newer build is being forced,
  // that message is the one that matters.
  function boot() {
    let tries = 0;
    const t = setInterval(() => {
      if (++tries > 40) { clearInterval(t); return; }     // ~20s, then give up quietly
      try {
        if (!window.GAME || !window.GAME.state) return;
        const login = document.getElementById('screen-login');
        if (login && login.classList.contains('active')) return;
        if (document.querySelector('.uv-wrap')) return;
        clearInterval(t);
        maybeShow();
      } catch (e) { clearInterval(t); }
    }, 500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.PATCHNOTES = {
    show: () => show(true),
    NOTES,
    _reset: () => { try { localStorage.removeItem(KEY); } catch (e) {} },
  };
})();
