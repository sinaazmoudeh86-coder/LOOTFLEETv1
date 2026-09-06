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

   THIS CARD IS STAMPED 740 BY OPERATOR REQUEST, AND IT CARRIES THREE CUTS.
   740, 741 and 743 were each cut without being pushed; the live population is on
   739 and has seen none of them. The number was set back to 740 deliberately so
   the population's next build is 739 + 1 — see DEPLOY-v268.md. The ROWS are the
   743 set unchanged, because the rows are chosen by what the POPULATION has not
   seen, and that answer does not change when the stamp does.

   WHICH ROWS SURVIVE A TRIM: the ones the POPULATION HAS NOT SEEN. This card kept
   the never-pushed rows from all three cuts and dropped the six that went live in
   739 (the Nanocore price, Dread Core scarcity, the death-beam cut, the Home
   Citadel wave pass, the two-device save protection, the Progenitor, the
   contiguity bonus). Two items are deliberately NOT here — the Bridge's FLY NOW no
   longer pulses or moves, and desktop can double-click a skill node to buy it.
   Both are visible the moment you look at them, which is the test: a row is for
   something a player would otherwise never learn.

   THE CLOCK ROW COST THE COMMANDER-CARD ROW ITS PLACE, and that is the rule doing
   its job: one in at the top of FIXED, one off the bottom, still ten. It earns the
   seat because closing that hole takes something off HONEST accounts too — anyone
   who flies across timezones was getting cargo dailies early without ever knowing
   why, and losing that silently is indistinguishable from a bug.

   THE `NEW` GROUP LEADS THE CARD. Three additions went in at the
   top — the Artery, the Xyn, the two Nanocore tiers — so three came off the bottom
   of FIXED (Omega Cargo V's core range, Delete Account, and the world-boss guard).
   Still exactly ten. Those three were the most self-evident of the fixes: a player
   who opens the cargo manifest, deletes an account or fights the Progenitor sees
   the corrected behaviour directly. A whole region past the rim and a hull class
   that did not exist before are the opposite — nobody finds those by accident.

   TONE: one short sentence per row. A player reads this in fifteen seconds
   standing in a queue. If a row needs a paragraph, it needs a site post instead.

   WHAT A NERF OWES THE PLAYER: it gets said out loud, in plain words, with what
   they keep — and it leads the card rather than hiding at the bottom. Silent
   removal of something a player is holding reads exactly like a bug (CLAUDE.md).
   ========================================================================== */
(function () {
  'use strict';

  const BUILD = 744;
  const NOTES = {
    build: 744,
    title: 'BUILD 744',
    sub: 'The ten latest changes.',
    groups: [
      // A REMOVAL LEADS THE CARD. Taking a system off accounts that were using it is
      // the loudest thing in this build, and the nerf rule is explicit: close it if
      // you must, but never quietly — a mode that vanishes with no row reads to the
      // player as a bug, and they will spend an evening looking for it.
      { k: 'REMOVED', c: '#ff6b78', rows: [
        ['⛏', 'The Home Citadel has been retired', 'The wave-defence base and its hourly production are <b>gone from the game</b>. Everything it paid you and you collected is <b>yours and untouched</b>. What was still <b>uncollected in the silo</b> goes with it, and what you spent on the Citadel and its towers is <b>not refunded</b>. The <b>Home Defense</b> board retires too; your deepest wave is kept on record.'],
      ] },
      // NEW earns its own group and leads the card. Three additions here are things
      // a player cannot discover by looking at a screen they already open — a region
      // past the rim, a hull class that did not exist, and two core tiers above the
      // one that used to be the top. That is exactly the file's editorial test.
      { k: 'NEW', c: '#7cd4ff', rows: [
        ['◈', 'THE ARTERY — a new Lv 500+ region', 'A filament of <b>fourteen systems</b> off the eastern rim, paying <b>×3</b> the best ground in the galaxy and holding <b>five fortresses</b>. <b>One tile wide, one entrance</b>: you can only take a system whose neighbour toward the mouth you already hold, so everyone enters at <b>Lancet</b> and fights inward. Nothing out there can ever be sealed.'],
        ['◈', 'THE XYN — Super Fighter class', 'A new hull class <b>above Celestial</b>. <b>22 fighter bays</b>, double the Celestial Corvus, on the same combat sheet — and the slowest, largest thing that flies. It is the boss of <b>Xyn Prime</b> at the end of the Artery: own that system, beat it, and every defeat rolls a <b>1 in 1,000,000</b> chance at the hull.'],
        ['◈', 'Nanocores: Mythic and Ancient', 'Two tiers above Legendary — <b>6 and 7 buff slots</b>, up to <b>+60% damage and health</b>. Very rare and very expensive: an Ancient is about <b>one crate in 1,700</b>. <b>No existing tier got more expensive</b>, and Legendary duplicates now trade <b>up</b> into Mythic instead of sideways.'],
      ] },
      { k: 'CHANGED', c: '#ffcf4d', rows: [
        ['✧', 'The Event Horizon Lance is one shot again', 'The rift it left behind was <b>burning harder than the beam itself</b> — sitting in the lane did more damage than being hit by it. The rift no longer burns at all, the shot is <b>one bounded hit</b>, and the rift still pays its <b>4× loot</b>.'],
        ['◇', 'Top-tier drop rates corrected', 'Primordial, Relic and Artifact were dropping more often than <b>Eternal</b>, three tiers below them. Back on the curve — <b>nothing you already own changed grade</b>.'],
        ['⚙', 'High-tier hull upgrades cost far less', 'Each level was multiplying by up to <b>3.4×</b> the one before it, which put Level 20 out of reach on 22 hulls. Now a flat <b>×1.8 plasma</b> per level on every hull. <b>Nothing got more expensive.</b>'],
        ['◈', 'Kaevith Sovereign and Godshard are deep-space prizes', 'Once the three common chassis were in your hangar, the apex pair were the <b>only two left in the pool</b> — so they split it evenly on <b>any</b> invaded zone, ring 1 included. The Sovereign now drops only from <b>Lv 250+</b> systems, the Godshard from <b>Lv 300+</b>. <b>A hull you already earned is yours.</b>'],
      ] },
      { k: 'FIXED', c: '#7ce0a0', rows: [
        ['◷', 'Daily resets follow the calendar, not your device', 'Changing your device clock — or just flying across timezones — could roll cargo runs and event attempts over early, and could drop extra runs you’d paid for mid-day. Dailies now only ever move <b>forward</b>. <b>Nothing already earned has been taken back.</b>'],
        ['⚑', 'Your flagship survives a logout', 'Logging back in put you in the <b>Frigate</b> and left your real hull sitting in the hangar. The hull you pick is the hull you keep, on every device.'],
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
    // EQUALITY, NOT ≥. A device that saw a card from a cut that was never pushed
    // (741, 743) has a HIGHER number stored than the build it is now running, and
    // `>=` would swallow this card on exactly the devices most likely to need it.
    // The key records which card was seen, not how far the player has come.
    if (seen() === BUILD) return;
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
