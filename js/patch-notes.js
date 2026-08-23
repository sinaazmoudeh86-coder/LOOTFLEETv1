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

  const BUILD = 719;
  const NOTES = {
    build: 719,
    title: 'BUILD 719',
    sub: 'The Mech faction is here — and it fights differently.',
    groups: [
      { k: 'NEW', c: '#ff8a9a', rows: [
        ['\u2699', 'The Mech Foundry', 'Five tiers in Command, from the Spawn Nest at Level 120 to the Titan Forge at 550. Clear one for \u2699 Mech Cores.'],
        ['\u26a0', 'Mech attacks strip your armor', 'Every Mech hit stacks ARMOR CORRUPTION and you take more damage while it holds. The class sets the ceiling, the swarm sets how fast they get there \u2014 a Spawn is nothing, a Titan is +25%. It shows over your ship, and it fades in 5s once they stop hitting you.'],
        ['\u2699', 'Mech Archon &amp; Mech Titan', 'Two new hulls, earned only in the Foundry \u2014 first clear of the top two tiers hands over the blueprint. Neither is your biggest gun: they CORRUPT the target so every other ship in your fleet hits it harder.'],
      ] },
      { k: 'CHANGED', c: '#ffcf7a', rows: [
        ['\u2726', 'Fusing a Commander costs more at high rarity', 'It was 4 spare copies a tier at every rarity, which let the cheapest crate in the game build a Primordial. A step is now priced by the tier it leaves \u2014 3 spares at Common, 39 at Legendary, 141 at Ancient. <b>Every card and every duplicate you already hold is untouched</b>, and climbing the lower tiers is barely changed.'],
      ] },
      { k: 'ALSO', c: '#7ce0a0', rows: [
        ['\u2726', 'You ascend in the Frigate now', 'Every hull stays in your hangar at full strength \u2014 switch back the moment you meet its licence again. Commanders tied to a class or hull go quiet until you do, and tell you why.'],
        ['\u2699', 'Mech Foundry board in Ranks', 'Ranked on \u2699 cores EARNED, not what you are holding \u2014 assembling a hull never costs you a place.'],
        ['\u2726', 'Commanders', 'Collect officers at \u26055. One per active hull, and the one you seat lends its bonus to the whole fleet.'],
        ['\u2699', 'Corrupted targets are marked', 'A meter and a stack count over anything your fleet has stripped \u2014 and over you, when they are doing it to you.'],
        ['\u2726', 'The Foundry pays cores and loot, not levels', 'Its zones are priced off the tier, not off you, so it is not a levelling shortcut. Cores, gold, drops and blueprints are all yours.'],
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
