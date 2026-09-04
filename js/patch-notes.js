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

   WHICH ROWS SURVIVE A TRIM: the ones the POPULATION HAS NOT SEEN. 741 kept 740's
   four never-pushed rows and dropped the six that went live in 739 (the Nanocore
   price, Dread Core scarcity, the death-beam cut, the Home Citadel wave pass, the
   two-device save protection, the Progenitor, the contiguity bonus). Two 741 items
   are deliberately NOT here — the Bridge's FLY NOW no longer pulses or moves, and
   desktop can double-click a skill node to buy it. Both are visible the moment you
   look at them, which is the test: a row is for something a player would otherwise
   never learn.

   THE CLOCK ROW COST THE COMMANDER-CARD ROW ITS PLACE, and that is the rule doing
   its job: one in at the top of FIXED, one off the bottom, still ten. It earns the
   seat because closing that hole takes something off HONEST accounts too — anyone
   who flies across timezones was getting cargo dailies early without ever knowing
   why, and losing that silently is indistinguishable from a bug.

   TONE: one short sentence per row. A player reads this in fifteen seconds
   standing in a queue. If a row needs a paragraph, it needs a site post instead.

   WHAT A NERF OWES THE PLAYER: it gets said out loud, in plain words, with what
   they keep — and it leads the card rather than hiding at the bottom. Silent
   removal of something a player is holding reads exactly like a bug (CLAUDE.md).
   ========================================================================== */
(function () {
  'use strict';

  const BUILD = 741;
  const NOTES = {
    build: 741,
    title: 'BUILD 741',
    sub: 'The ten latest changes.',
    groups: [
      { k: 'CHANGED', c: '#ffcf4d', rows: [
        ['✧', 'The Event Horizon Lance is one shot again', 'The rift it left behind was <b>burning harder than the beam itself</b> — sitting in the lane did more damage than being hit by it. The rift no longer burns at all, the shot is <b>one bounded hit</b>, and the rift still pays its <b>4× loot</b>.'],
        ['◇', 'Top-tier drop rates corrected', 'Primordial, Relic and Artifact were dropping more often than <b>Eternal</b>, three tiers below them. Back on the curve — <b>nothing you already own changed grade</b>.'],
        ['⚙', 'High-tier hull upgrades cost far less', 'Each level was multiplying by up to <b>3.4×</b> the one before it, which put Level 20 out of reach on 22 hulls. Now a flat <b>×1.8 plasma</b> per level on every hull. <b>Nothing got more expensive.</b>'],
      ] },
      { k: 'FIXED', c: '#7ce0a0', rows: [
        ['◷', 'Daily resets follow the calendar, not your device', 'Changing your device clock — or just flying across timezones — could roll cargo runs and event attempts over early, and could drop extra runs you’d paid for mid-day. Dailies now only ever move <b>forward</b>. <b>Nothing already earned has been taken back.</b>'],
        ['⚑', 'Your flagship survives a logout', 'Logging back in put you in the <b>Frigate</b> and left your real hull sitting in the hangar. The hull you pick is the hull you keep, on every device.'],
        ['✈', 'Escort carriers launch their fighters', 'A carrier you <b>bought</b> rather than won arrived with <b>empty bays</b>, so parked in an escort slot it flew nothing. Every carrier now arrives with its wing aboard.'],
        ['⛏', 'Home Citadel keeps your night’s production', 'A second device could reset the storage clock on login and wipe everything banked while you slept. The clock is now the one that did the mining.'],
        ['◇', 'Omega Cargo V states its real core range', 'It advertised <b>2–4</b> Dread Cores and could legitimately pay <b>5</b>. The manifest now quotes what the roll can actually return.'],
        ['⊘', 'Delete Account really deletes', 'If the server refused, the app wiped your device, said it was done, and you could sign straight back in. It now only reports success when the account is <b>actually gone</b>.'],
        ['☠', 'The world boss can no longer be killed', 'The Progenitor arena is a <b>damage ladder</b> — push stages, bank an unlimited score. Big special effects could end the run early. They can’t now.'],
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
