/* =============================================================================
   xyn.js — THE XYN · the Super Fighter encounter at the end of the Artery
   -----------------------------------------------------------------------------
   ONE TILE, ONE BOSS, ONE IN A MILLION.

   XYN PRIME is the last hex of the Artery's third stem — the stem that grows off
   THE VALVE, the region's natural fortress. The XYN sits on that tile as its
   BOSS, and beating it is the only way the hull is ever recovered.

   THE FOUR RULES, and they compose into the whole design:

     1 · YOU MUST OWN THE TILE TO FIGHT IT.  Not "be near it", not "have the
         level" — own it. Owning is a stronger gate than entering, so it is
         enforced here on the roll rather than trusted to the map.

     2 · SO ATTACKERS HAVE TO BEAT THE HOLDER FIRST.  There is no second route in.
         Whoever holds XYN PRIME holds the only door, and the only way through it
         is to take the tile off them in the ordinary siege. The event needs no
         PvP code of its own: the tile IS the contest.

     3 · AND THE TILE CANNOT BE DEFENDED.  XYN PRIME is a dead end on a one-wide
         filament — ONE friendly border out of six, ever. tileShield() seals at
         six, so it is the least defensible hex in the game and permanently open.
         Holding the door does not mean keeping it.

     4 · THE BOSS SPAWNS WHETHER YOU OWN THE HULL OR NOT.  Gating the encounter on
         not-owning would delete the fight the moment someone won it, and being
         fought over is the entire point of this tile. Owning the Xyn changes what
         the popup says, never whether the Xyn is there.

   THE ROLL RESOLVES ON THE BOSS, NOT ON TRASH, and the player is told the outcome
   every single time — win or lose. A lottery the player cannot see resolve is
   indistinguishable from one that does not exist, which is why the popup fires on
   every defeat and states the odds in the same breath.

   ⚠ THE ODDS ARE LITERAL AND THEY ARE BRUTAL. 1 in 1,000,000 per DEFEAT, exactly
   as specified — no escalator, no pity timer, no per-day bonus. At one boss every
   ten to fifteen minutes that is on the order of twenty years of continuous play
   for a single hull, so as a route to owning it this is decoration rather than a
   goal. It is ONE constant, `ODDS`, in ONE place: divide it by a thousand for a
   reachable chase, or move `roll()` back onto every kill on the tile, whichever
   the operator wants. Flagged rather than quietly retuned, because the number was
   asked for twice and it is not this file's call to soften it.

   SAVE SHAPE. One key, `state.xyn`, written on the first defeat:
     { v:1, kills, won, wonAt }
   `kills` is a lifetime record of Xyn defeats (a record, not a wallet) and `won`
   is a receipt. Both have a union block in account.js — a merge must never decide
   a lifetime record or a receipt wholesale.
   ============================================================================= */
(function () {
  'use strict';

  const G = () => window.GAME;
  const GX = () => window.GALAXYMAP;

  const ODDS = 1000000;          // one in a million, per DEFEAT — see the header
  const SHIP_KEY = 'xyn';

  function tileId() { try { return GX().ARTERY.xyn; } catch (e) { return null; } }
  function onXynTile() {
    try {
      const id = G().state.currentSystem;
      return !!(id && GX().isXyn && GX().isXyn(id));
    } catch (e) { return false; }
  }
  function ownsTile() { try { return !!G().isOwned(tileId()); } catch (e) { return false; } }
  function owned() {
    try { return !!(G().state.ownedShips && G().state.ownedShips[SHIP_KEY]); } catch (e) { return false; }
  }

  // ---- STATE ----------------------------------------------------------------
  // Created lazily on the first defeat, so a pilot who never goes there never
  // grows the key. Nothing here is a currency, so nothing needs a spend guard.
  function st(create) {
    const g = G(); if (!g || !g.state) return null;
    if (!g.state.xyn) {
      if (!create) return null;
      g.state.xyn = { v: 1, kills: 0, won: false, wonAt: 0 };
    }
    return g.state.xyn;
  }

  // ---- THE DEFEAT -----------------------------------------------------------
  // Called from onKill() in game-v93 for every kill. Gated on the entity being the
  // XYN itself, so trash on the tile does nothing — the boss IS the event.
  //
  // THE ENCOUNTER ENDS ON A RESULT, WHATEVER THE RESULT IS. All four outcomes mean
  // the same thing about the fight — the Xyn is dead — so the run is over in every
  // branch, not just the winning one. The engine's endXynEvent() undeploys the
  // pilot to the safe hangar bay and returns the screen to My Galaxy; the popup is
  // raised AFTER that, so the player reads their result sitting on the map with the
  // tile they were fighting for in front of them.
  function onKill(e) {
    if (!e || !e.isXyn) return false;
    const s = st(true); if (!s) return false;
    s.kills = (s.kills | 0) + 1;

    // ALREADY FLYING IT — the fight happened and is still counted, and the popup
    // still fires. It just cannot pay a second hull.
    if (owned()) return finish(s, 'have', false);

    // RULE 1 — the system. Re-checked HERE, at the moment of the roll, not when the
    // boss spawned: a siege can land while the fight is running, and a pilot who no
    // longer holds the tile must not be paid off it.
    if (!ownsTile()) return finish(s, 'no-tile', false);

    if (Math.random() >= 1 / ODDS) return finish(s, 'miss', false);
    const ok = grant(s);
    return finish(s, ok ? 'win' : 'miss', ok);
  }
  // ONE EXIT for every outcome: bank the save, end the encounter, then report.
  function finish(s, result, ok) {
    try { G().save(); } catch (e) {}
    try { G().endXynEvent(); } catch (e) {}
    report({ result: result });
    return !!ok;
  }

  // ---- THE GRANT ------------------------------------------------------------
  // ORDER: DELIVER, CONFIRM, THEN STAMP. The Progenitor shipped the other way
  // round once — receipt first, hull second — and a lost write between the two
  // left pilots charged, hull-less and locked out with no route back. Nothing is
  // charged here, but the rule holds: the stamp claims the hull arrived, so it
  // must not be written until the hull has.
  function grant(s) {
    const g = G();
    try {
      if (g.grantShip) g.grantShip(SHIP_KEY);
      else { g.state.ownedShips = g.state.ownedShips || {}; g.state.ownedShips[SHIP_KEY] = true; }
    } catch (e) { return false; }
    if (!owned()) return false;                // delivery unconfirmed — do not stamp
    s.won = true; s.wonAt = Date.now();
    try { g.save(); } catch (e) {}
    try {
      if (window.MAIL && window.MAIL.push) window.MAIL.push({
        ic: '\u25c8', from: 'Fleet Admiralty', title: 'THE XYN \u2014 recovered',
        body: '<p>You brought the Xyn down on <b>Xyn Prime</b> and it gave up the hull itself.</p>'
          + '<p><b>The Xyn</b> is the first <b>Super Fighter</b> \u2014 a class above Celestial. '
          + '<b>Twenty-two fighter bays</b>, double the Celestial Corvus, over the same five cannon '
          + 'hardpoints and the same combat sheet. It is the largest vessel that flies and very nearly '
          + 'the slowest: the arena pulls back to fit it.</p>'
          + '<p>It is in your hangar now. Nothing was spent.</p>',
      });
    } catch (e) {}
    return true;
  }

  // ---- THE POPUP ------------------------------------------------------------
  // Fires on EVERY defeat, and says which of the four things just happened. The
  // odds line is always present: a player who has just been told "no" is exactly
  // the player who needs to know what they were rolling against.
  //
  // The UI owns the rendering; this owns the facts. If the sheet is unavailable
  // for any reason it degrades to a toast rather than swallowing the outcome —
  // an awarded prize the player was never told about is the worst case here.
  function report(info) {
    const s = st(false);
    const payload = {
      result: info.result,                 // 'win' | 'miss' | 'have' | 'no-tile'
      odds: ODDS,
      kills: s ? (s.kills | 0) : 0,
      shipKey: SHIP_KEY,
      shipName: 'The Xyn',
    };
    try {
      if (window.UI && window.UI.xynResult) { window.UI.xynResult(payload); return; }
    } catch (e) {}
    const line = payload.result === 'win' ? '\u25c8 THE XYN \u2014 one in a million. The Super Fighter is yours.'
      : payload.result === 'have' ? '\u25c8 The Xyn is down. You already fly it \u2014 no second hull.'
      : payload.result === 'no-tile' ? '\u25c8 The Xyn is down \u2014 but you do not hold this system, so it paid nothing.'
      : '\u25c8 The Xyn is down. No hull this time \u2014 1 in ' + ODDS.toLocaleString() + '.';
    try { if (window.UI && window.UI.unlockToast) window.UI.unlockToast(line); } catch (e) {}
    try { G().pushFeed(line); } catch (e) {}
  }

  // ---- WHAT THE UI ASKS -----------------------------------------------------
  // One function, so the tile sheet cannot restate a gate or an odds figure and
  // drift from what onKill() actually enforces.
  function status() {
    const s = st(false);
    return {
      id: tileId(), odds: ODDS, shipKey: SHIP_KEY,
      onTile: onXynTile(), ownsTile: ownsTile(), hasShip: owned(),
      kills: s ? (s.kills | 0) : 0, won: !!(s && s.won),
      // The one sentence that decides whether the player can act right now.
      gate: !ownsTile() ? 'need-tile' : owned() ? 'owned' : 'ready',
    };
  }

  window.XYN = { onKill, status, report, ODDS, SHIP_KEY, tileId, ownsTile, owned };
})();
