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

  const BUILD = 712;
  const NOTES = {
    build: 712,
    title: 'BUILD 712',
    sub: 'Field projectors, three speed tiers, and the leaderboards are live again.',
    groups: [
      { k: 'NEW', c: '#7ce0a0', rows: [
        ['\u2623', 'Aegis field projectors', 'Four huge auras \u2014 Venom, Cryo, Banner, Plague. Aegis hull only.'],
        ['\u25e7', 'Graphics quality', 'Low / Medium / High in \u2699 Account. Visual only \u2014 never your progress.'],
        ['\u2630', 'List views', 'Pilot Tree and My Galaxy now have searchable, sortable lists.'],
        ['\u2b21', 'Pilot Tree ladder', 'A new Ranks board, scored on your unlocked nodes.'],
      ] },
      { k: 'CHANGED', c: '#ffcf7a', rows: [
        ['\u26a1', 'Battle speed is 1\u00d7 / 2\u00d7 / 3\u00d7', '4\u00d7 and 5\u00d7 are retired. On 5\u00d7 with Pro? You are on 3\u00d7. Bought the old 4\u00d7? You keep it, as 2\u00d7.'],
        ['\u2715', 'Cargo runs drop no fittings', 'They were paying gear from zones above your own frontier. Gold, salvage and cores are untouched \u2014 and anything you already earned is yours.'],
        ['\u2691', 'Bought cargo runs capped at 3 a day', 'Pro purchases only. Resets at midnight.'],
        ['\u2620', 'Ascending no longer resets the Dreadnaught Hunt', 'The weekly lockout is a calendar, not run progress.'],
        ['\u27a4', 'Fighters hit 20% harder', 'And Wing Tactics finally applies to fighters and drones, as its text always said.'],
      ] },
      { k: 'FIXED', c: '#8fc4ff', rows: [
        ['\u25c8', 'Leaderboards were not publishing', 'Nobody\u2019s row had moved in twenty builds. Fixed \u2014 yours updates on your next sync.'],
        ['\u265b', 'King of the Hill crowned the wrong pilot', 'Being in the arena at midnight wiped your own score. Owed crown prizes are being delivered now.'],
        ['\u23f8', 'Why KOTH pauses', 'The rule is on the arena screen and on the pill. The idle window is now 10 minutes, up from 4.'],
        ['\u2637', 'Corner farming', 'Hostiles now spawn across the whole map instead of bunching on one side.'],
        ['\u2756', 'Item names hidden in Loadouts', 'Weapon and fighter chips show their names again.'],
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
