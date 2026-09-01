/* =============================================================================
   patch-notes.js — LOOTFLEET · "WHAT'S NEW" ON FIRST LOGIN TO A NEW BUILD
   -----------------------------------------------------------------------------
   Shows one card, once, the first time a player logs in after a build ships.

   TEN ROWS. THAT IS THE RULE.
   The card carries the TEN most recent major items and nothing else. It used to
   carry every row from every unpushed build — sixty-odd entries, several of them
   four hundred words — and a card nobody scrolls to the end of is a card that
   fails the one time it matters. Ten items, one line each.

   WHAT EARNS A ROW — the editorial test, because it is the whole job:
   would a player NOTICE if we never told them?
     · Their 5× speed pill is gone            → YES. Must be here.
     · Cargo runs stopped dropping fittings   → YES. A nerf. Must be here.
     · Their leaderboard row was frozen       → YES. They saw it and complained.
     · lb_upsert dropped an overload          → NO. That is a deploy note.
     · Loot blocking became one predicate     → NO. Same behaviour, better code.
     · A reserved rarity tier exists          → NO. It is not live.

   WHEN A BUILD SHIPS: add its rows at the TOP and drop as many off the BOTTOM as
   you added. Never let it grow past ten. The full changelog lives on the site.

   TONE: one short sentence per row. A player reads this in fifteen seconds
   standing in a queue. If a row needs a paragraph, it needs a site post instead.

   WHAT A NERF OWES THE PLAYER: it gets said out loud, in plain words, with what
   they keep — and it leads the card rather than hiding at the bottom. Silent
   removal of something a player is holding reads exactly like a bug (CLAUDE.md).
   ========================================================================== */
(function () {
  'use strict';

  const BUILD = 740;
  const NOTES = {
    build: 740,
    title: 'BUILD 740',
    sub: 'The ten latest changes.',
    groups: [
      { k: 'CHANGED', c: '#ffcf4d', rows: [
        ['◇', 'Top-tier drop rates corrected', 'Primordial, Relic and Artifact were dropping more often than <b>Eternal</b>, three tiers below them. Back on the curve — <b>nothing you already own changed grade</b>.'],
        ['⬢', 'Aeternum death beams cut to size', 'Five beams were adding nearly <b>seven times</b> your whole fleet’s damage. Now one and a half between them — still the strongest clear in the game.'],
        ['◈', 'Two things cost more, on purpose', '<b>Nanocore Crates cost double</b> and <b>◇ Dread Cores are rarer</b> everywhere they drop. Nothing you already hold is affected.'],
      ] },
      { k: 'FIXED', c: '#7ce0a0', rows: [
        ['☠', 'The world boss can no longer be killed', 'The Progenitor arena is a <b>damage ladder</b> — push stages, bank an unlimited score. Big special effects could end the run early. They can’t now.'],
        ['✦', 'Commander cards say what they’re worth', 'Fleet percentages all add into one pool, so <b>+273% Fire Rate</b> is worth a few percent of real damage. Seated cards now print the live figure.'],
        ['⚔', 'Getting stronger helps in Home Citadel', 'Raider health came from <b>your own damage</b>, so upgrading did nothing. Waves are built for the wave now. <b>No wave got harder.</b>'],
        ['☁', 'Your progress survives two devices', 'Prism Auras, forged Cores, your Cargo record and your mission boards could vanish when a save came in from another phone. All protected.'],
      ] },
      { k: 'NEW', c: '#7fd1ff', rows: [
        ['☄', 'THE PROGENITOR — the mothership', 'The Voidmaw was never alone. Collect <b>1,000 parts</b> and you fly it. No deadline, and every part you’ve ever banked carries over.'],
        ['⬡', 'CONTIGUITY BONUS', 'Systems that <b>touch each other</b> pay more than the same number scattered across the map. Four in a block is <b>+100%</b> an hour; fifty is <b>+200%</b>.'],
        ['▣', 'THE BRIDGE', 'Your hull, your wing and your formation on one screen, straight from the hangar.'],
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
