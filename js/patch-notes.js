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

  const BUILD = 733;
  // 733 CARRIES 730–732'S ROWS TOO, FOR THE REASON STATED BELOW: 729 is still
  // what most accounts are running, and 730, 731 and 732 were each cut without
  // being pushed. Keyed on LF_BUILD in localStorage, a 733-only card would mean
  // nobody who skipped those logins ever sees the Home Citadel nerf, the Dread
  // Core scarcity pass or the contiguity bonus. Drop the older rows once 733 has
  // been live long enough for the population to turn over.
  // 730 CARRIES 729'S ROWS, AND THAT IS DELIBERATE. 729 shipped only hours before
  // 730 was cut, so most accounts had not logged into it yet. The card is keyed on
  // LF_BUILD in localStorage: replacing 729's card with a 730-only card would mean
  // anyone who missed the 729 login never sees any of those 24 rows. Same rule as
  // the 727/728 merge, one build later. When 730 has been live long enough that
  // the population has turned over, the next card may drop these rows.
  // (Historic note on the merge below.) 728 was cut but never pushed, so the live
  // build was 726 and a player jumping 726 to 729 would never have seen 728's card.
  // Same rule as the 727/728 merge: a skipped build owes its rows to the next
  // card. 729's own items are folded into the rows they belong to rather than
  // repeated at the bottom — the Eternum row states both halves of that licence
  // change, and the chat row states the launch gate it actually ships on.
  const NOTES = {
    build: 733,
    title: 'BUILD 733',
    sub: 'A solid block of space now defends itself — plus everything from 730 to 732.',
    groups: [
      { k: 'CHANGED', c: '#ffcf4d', rows: [
        ['⛴', 'Natural citadels are scarce on purpose — five per 100 levels', 'A natural citadel pays a thousand times what a resource field of its depth pays, which makes it the richest thing on the map — and how many existed was pure luck of the map seed. There were <b>73</b>, spread wildly: two in the shallowest level band and thirty in one of the deep ones. Now every 100 levels of the galaxy holds <b>exactly five</b>, so a fortress is worth hunting for at any depth and the shallow rings actually gained some. <b>A citadel you already hold stays yours and keeps paying exactly what it paid.</b> Nothing has been taken off your account: no income lost, no siege refunded, no fortress demoted under you. Retired locations become <b>boss systems</b> — same name, same resource, same rarity, and still well worth taking. Citadels you BUILT yourself are a different thing entirely and are completely untouched, wherever they stand.'],
        ['✦', 'The Eternum licence is actually reachable: ★30 and 300 cargo runs', 'It asked for <b>★100</b> and <b>1,000 secured cargo runs</b> — the better part of two years on either line, so the Celestial Class read as decoration rather than something to aim at. It now asks <b>★30</b> and <b>300 runs</b>, which finish in roughly the same season as each other instead of one hiding behind the other. Nothing else moved: still a Titan Sina in the hangar, still commissioned with a core that only the deepest Omega Cargo V manifest gives up, still the same yard bill. If you are already past either number, that line is simply done. And the hangar tile was printing <b>★50</b> while the licence actually wanted ★100 — so if you hit the number you were shown and were still refused, that was our bug, not your progress. Every figure on that card now comes off the licence itself.'],
        ['\u2699', 'Home Citadel wave pay is capped by the clock, not by waves', 'Every wave you clear still pays 2.2 hours of your base\u2019s production, and clearing waves still raises that production permanently. Your wave, your towers, your structures and every balance are untouched. What is new is a bank: it refills at 8 hours of pay per real hour and holds 24. Arrive after a break and the first dozen waves pay in full, exactly as before \u2014 chain waves for an hour and your works settle to 8\u00d7 what your base mines. Part crates and their cores are never lost; they queue and land as the bank refills. A wave\u2019s bonus is also now priced at the production rate you fought it at, rather than the rate it unlocks.'],
        ['◇', '◇ Dread Cores are rarer everywhere they drop', 'Cores buy Pilot Tree nodes — the only upgrade in the game that improves every ship you will ever fly — and they were arriving from six separate systems that had each been tuned on their own. Added up, the tree was filling faster than it was ever meant to. <b>Every core faucet now pays 30% of what it used to</b>: the Dreadnaught Hunt’s tier odds, Home Citadel wave crates past Wave 50, Cargo Defense manifests, Fleet Exploration payouts and the Voidmaw stage drops. The percentage printed on each hunt card is the real number and it has come down with everything else, so what you are shown is still what you are rolling. <b>Every core you already hold is yours, and every node you have unlocked stays unlocked</b> — nothing has been taken off your account and no node got more expensive. What changes is that rewards which used to guarantee a core are now a chance at one: a hunt or a 3★ expedition can come home empty. Where a Voidmaw stage would have paid a core and does not, it pays bonus gold instead, so no stage pays nothing. Cores from the Social and Alliance stores are unchanged.'],
      ] },
      { k: 'NEW', c: '#7fd1ff', rows: [
        ['⚔', 'Rival empires hold TERRITORY now, not scattered tiles', 'The rival layer decided every system on its own, so a rival’s holdings were confetti — two systems side by side almost always belonged to two different pilots, and no rival ever held a block of anything. The galaxy is cut into <b>spheres of influence</b> now: a neighbourhood belongs to one empire, and deeper in there are <b>strongholds</b> — solid blocs of one empire’s space, with sealed cores of their own that you have to break a border system to reach. <b>The same number of systems are rival-held as before, ring for ring</b> — you have exactly as much open ground to claim; it is the shape that changed. The shallow rings stay open frontier: strongholds only appear from <b>ring 6</b> outward, and the deepest space is where the real empires sit. Every empire is drawn in <b>its own colour</b> with a hard border around its territory, so two of them side by side no longer read as one — and a single stray claim stays plain red, because 1,065 of the claims on the map are lone systems and colouring every one of those would be the confetti again.'],
        ['🛡', 'TERRITORY DEFENDS ITSELF — no exposed border, no siege', 'A system whose <b>every border faces its own owner’s space</b> can no longer be attacked at all. Ring a system with six of your own and its core is sealed: an enemy has to take one of the border systems around it first, and only then does the way in open. It works for everyone, so a rival’s inner systems are shut to you the same way — and <b>allied space counts as one bloc</b>, so an ally’s tile shields yours exactly as your own does. The map shows it: a sealed system breathes inside its hex, and the ring of systems holding it — the shell you would have to break — lights its outer edge. Open any system for the reason in plain words, and on a sealed enemy core the sheet <b>names the border systems to hit</b> and flies you to one. Two things stay open on purpose: the galaxy’s <b>outer rim</b>, where borders face off the map, and your <b>home citadel</b>, which belongs to no one. Your systems list marks which of your holds are <b>⛨ SEALED</b> and which are the wall holding them, the galaxy list says <b>🛡 SEALED</b> instead of offering a target that would refuse, and every empire’s wall is drawn in its own colour — yours always the same ice white — so two rivals side by side never read as one territory. Nothing was taken away — no system changed hands, no shield expired, and a scattered empire plays exactly as it did.'],
        ['⬡', 'CONTIGUITY BONUS — a solid block of space is worth more than a sprawl', 'Systems you hold that <b>touch each other</b> now pay a bonus, on <b>every tile in the block</b>: <b>4 touching pays +100%</b> an hour, <b>10 pays +120%</b>, <b>30 pays +150%</b>, <b>50 pays +200%</b>. A qualifying block is outlined on the galaxy map as one territory with a hard border in its tier’s colour, so you can see the shape you are building. Each block is scored on its own size and you can hold as many as you like. Nothing was taken away to pay for this — every system you already hold earns at least what it earned before, and a scattered empire is untouched. The new pill under <b>◈ Systems</b> in My Galaxy shows your largest block, what it is paying and how many more tiles reach the next rung. Your home citadel is neutral ground and does not join a block.'],
        ['▣', 'THE BRIDGE — your hull, your wing and your formation on one sheet', 'A fifth button on the hangar dock opens the Bridge: the hull you are flying with every hardpoint it has mounted, your formation slots, and every other hull you own as a card you can compare and fly with one tap. The dock itself is unchanged and nothing new sits over the arena.'],
        ['➤', 'FIGHTER ASCENSION — four wing doctrines, at ★10', 'A new Command screen for pilots at <b>Pilot Ascension ★10</b>. Four permanent doctrines, bought a rank at a time, flown by <b>every fighter you launch</b> — out of your flagship’s bays and out of every carrier in your wing, on any hull, forever. <b>Corona Mantle</b> wraps each craft in a burning halo that eats whatever it flies through. <b>Phantom Lattice</b> gives each craft a spectral double that mirrors its strikes. <b>Nova Reclamation</b> turns every kill into a shockwave, and deep enough in, the wreck cooks off twice. <b>Apex Sortie</b> sends the whole wing to afterburner on a clock. Each rank costs gold, one Galaxy Resource and ◈ Prism Ingots — the first rank is affordable the day the gate opens, and rank 10 is a very long haul. Doctrines ride through every future ascension, and nothing is ever taken back. <b>Your wing trains to one doctrine at a time</b> — every rank you buy is kept forever, and switching between the ones you own is free and instant, so the cost of this system is the ranks and never the choice.'],
        ['◉', 'AUTO BEACON — 25,000 LootCoins, once', 'A permanent unlock in <b>Hangar ▸ Market ▸ Operations</b>: your distress beacon fires itself the moment it recharges, in every zone grind, whether you are watching or not. Nothing else changes — same recharge, same swarm, same kill value, and it still never fires during a boss. You can arm and disarm it whenever you like, and it survives ascension.'],
        ['◈', 'Run your empire from My Systems', 'Every hold in the list has its own controls now. Rank up a citadel — or raise one where there is none — at the price printed on the button, jump the galaxy map straight to that hex, or deploy there, all without closing the sheet and hunting for the tile. Sort by revenue, ring, citadel rank or name, and filter down to just your citadels. Your place in the list is kept when you buy, so working down a long empire is one pass.'],
        ['◈', 'Global chat, open from any screen', 'There is a CHAT chip in your top bar now. It opens a panel over whatever you are doing rather than a screen you have to leave the fight for — on a phone it sits above your controls, on a desktop it docks to the right, and the battle keeps running behind it either way. Tap any pilot’s name for their level, zone, power and fleet, and add them as a friend from there. Mute anyone you would rather not read and it follows your account onto every device; the ⚑ on a message reports it to us with the message attached. Two house rules worth knowing before you type: <b>posting unlocks at Level 10</b> (reading is open the moment you have an account), and <b>links are stripped</b> — nobody in this room can send you anywhere, which is the entire point. The room opens on the strict settings while it finds its feet, so there is a short wait between your own messages; we will loosen it once it has settled.'],
        ['▲', 'Every fighter marque flies its own airframe', 'A wing of Mauls and a wing of Talons used to be the same silhouette. Each marque has its own craft now — ten airframes in all, most marques with two variants, so two bays of the same marque can still look different. You can read what is in your bays from the arena instead of the menu. Damage, cadence, reach and the rarity colour are all exactly what they were; only the art changed.'],
      ] },
      { k: 'FIXED', c: '#8fc4ff', rows: [
        ['◱', 'Landscape is playable again', 'Turning a phone sideways handed you the <b>desktop</b> HUD on a screen a third the height: two full-size store buttons stacked above your score, a full-height tab bar, and the arena squeezed to half the window. The compact HUD now follows the <b>height</b> of your screen rather than its width, so it applies rotated as well as on a small phone, and your <b>hull bar is back in landscape</b> — it was being hidden outright to save room. Tabs also clear the notch on a phone held sideways.'],
        ['▲', 'Your fighters are craft again, not arrows', 'On some sessions every fighter in the wing drew as a flat coloured arrowhead. The ten new airframes were being fetched all at once at startup, and if one of those downloads dropped, that marque was written off for the rest of the session and fell back to the placeholder shape. Art now loads when a bay of that marque first launches, a failed download is retried, and a craft whose own frame has not arrived draws the old heavy fighter rather than a triangle.'],
        ['⚔', 'A refused attack tells you why', 'Tapping <b>Capture</b> or <b>Siege Citadel</b> on a system too deep for you did nothing at all — no message, no movement. The reason was being written to the battle feed <i>underneath</i> the sheet you were looking at, so it was invisible. Every refusal now appears in the sheet itself, and a system outside your level band says so before you tap: you can fly up to <b>10 levels</b> above yourself, and the card prints the level it opens at. The button itself also reads as unavailable now rather than staying lit — at capacity, behind an attack shield, out of level band or sealed, it says which and does not invite the tap. This also applies to a system you already hold — after an ascension your own deep holds are out of range for a while, they keep paying the whole time, and the sheet now says that instead of offering a dead button.'],
        ['\u25c7', 'Two devices no longer refund a Pilot Tree', 'If the game was open in two places at once, a node bought in one of them could be kept while the Dread Cores it cost were handed back by the other \u2014 so the same cores bought the same tree over and over. You still never lose a node to a stale login: when the two copies are reconciled every node is kept, and the cores it cost are now taken once. Nothing already unlocked has been touched.'],
        ['\u25ce', 'Ascending no longer resets your expeditions flown', 'The Exploration board ranks a career total, but the count was being cleared every time you ascended \u2014 so a pilot with stars read a handful of runs however many they had flown. Expeditions flown, your strongest wing ever sent, every hull\u2019s survey rank and any mission still in flight all ride through ascension now.'],
        ['\u2727', 'What was already lost stays lost', 'We cannot rebuild a count the reset deleted \u2014 the only record of it was the save it was wiped from. Your board climbs from where you stand today, and it will not drop again. If your standing matters to you, contact support and we will look at your account.'],
        ['\u25c7', 'Aegis field projectors have an icon, and auto-sell again', 'The four projectors and the Warden Array drew no icon at all on devices without those symbols in their fonts. Auto-sell also judged them as if they were cannons, so they could never be cleared out of the hold. They now sell like anything else you cannot use \u2014 and are always kept while you own a hull that can mount one, even if you are not flying it.'],
        ['\u25c8', 'My Systems counts built and natural citadels apart', 'The header printed a single \u201ccitadels\u201d figure that mixed the fortresses you built with the ones that came with the tile, so it never agreed with the rows underneath it. It states both now.'],
        ['\u26a1', 'Menus open straight away on phones', 'Tapping between Battle, Zone Grind and Loot could hang for a moment on a phone while nothing appeared to happen. Three things were in the way: the Loot screen drew a card for every item in your hold, the arena kept painting for a fraction of a second after you left it, and the screen you tapped had to finish building itself before the switch could be drawn at all. A very full hold now shows its top 200 with a button to open the rest, the arena stops the instant a menu opens, and the screen change is drawn first and filled a frame later. The fight itself is untouched \u2014 nothing about the simulation, your progress or your hold changed.'],
        ['\u25c7', 'Auto-sell sells again', 'If you set <b>Sell on pickup</b> and watched your hold fill up regardless, this is why: one empty weapon mount anywhere in your fleet \u2014 an escort you had never fitted, a hull parked in the hangar \u2014 counted <i>every</i> matching drop as something the fleet could use, so nothing was ever sold, at any rarity. An empty mount now holds <b>one</b> piece, the best one for it \u2014 and only mounts on the hull you are flying and the escorts flying with you. Hulls parked in the hangar no longer reserve gear your active fleet can already use, which is what was still filling holds on big accounts: dozens of owned hulls meant hundreds of permanently reserved slots. Anything only a parked hull can mount \u2014 an Aegis projector while you fly something else \u2014 is still kept. Anything that beats gear you actually have fitted is still kept exactly as before, and nothing equipped or bought is touched. If you have been flying with a full hold, expect it to clear on your next run.'],
        ['\u2708', 'Ascending actually disbands your wing', 'After an ascension your old escorts kept flying alongside you \u2014 endgame hulls in formation around a Level 1 starter frigate, still firing, still pulsing repairs. The wing had been disbanded correctly everywhere except on screen: nothing rebuilt the formation, so the ships already in the air simply stayed there. The wing now clears the instant the reset lands. Nothing about what you keep has changed \u2014 <b>every hull is still yours</b>, upgrade levels and Ship Ascension intact, waiting in the Hangar.'],
        ['\u2756', 'The ascension screens name the hull you really start in', 'The confirm screen showed your current flagship and told you that you warp out in it. You do not \u2014 a new run starts in the starter hull, and has for a while. Those screens now show that hull and say so plainly, and the keep/lose ledger lists the flagship change next to the wing. A wording fix: what ascending does to your account is unchanged.'],
        ['\u2709', 'Daily ladder awards arrive without a reload', 'If you left the game open across midnight UTC, your placings from the day before could sit unsent until you next signed in. The game was asking for them in the few minutes before the server had finished working the day out, treating the empty answer as final, and not asking again. It now keeps asking until they land. Nothing was ever lost \u2014 it was waiting.'],
        ['\u26d3', 'Natural fortresses show up under \u26d3 Citadels', 'The Citadels filter in the galaxy list only ever matched citadels a player built, or an enemy one you could go and attack \u2014 so a natural fortress sitting on a system you already hold matched neither and vanished from the list. All three now appear, and they are told apart on sight: \u26d3 in gold is yours, \u26d3 in amber belongs to another pilot, \u26f4 is the natural fortress that came with the ground. Your own citadel prints its rank now too.'],
        ['\u2630', 'The map / list switch is findable', 'Both the galaxy and the Pilot Tree could always be read as a searchable list instead of a map, and almost nobody knew \u2014 the control was a small two-part toggle among a row of identical chips, explained only by a tooltip that a phone never shows. It is now shown as a lit switch with both views on it, glowing until you use it \u2014 and on the Pilot Tree it tells you how many nodes you can afford right now.'],
        ['\u25a4', 'The Pilot Tree list is readable on a phone', 'On a phone the list view spent most of the screen on its own header and left room for about one node \u2014 in a small scroll box, inside a page that also scrolled, so dragging moved the wrong thing. The header is one row now, the list runs down the page like any other list, and the map gets a proper box instead of whatever height was left over.'],
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
