/* =============================================================================
   fighter-ascension.js — LOOTFLEET · FIGHTER ASCENSION (Command ▸ Fighter Wing)
   -----------------------------------------------------------------------------
   FOUR WING DOCTRINES, BOUGHT ONCE, FLOWN BY EVERY CRAFT YOU EVER LAUNCH.

   Ship Ascension belongs to a HULL. Pilot Ascension belongs to the ACCOUNT and
   resets the run. Fighter Ascension belongs to the WING: it is account-wide,
   hull-independent, and every fighter from every bay on every carrier — flagship
   or escort — flies with it. Swapping hulls, losing a bay, ascending the pilot:
   none of it touches a doctrine rank.

     ◉ CORONA MANTLE     a burning halo on each craft that eats everything inside it
     ◈ PHANTOM LATTICE   a spectral double that mirrors every strike
     ✷ NOVA RECLAMATION  the wreck detonates — a shaped charge on every kill
     ➤ APEX SORTIE       the whole wing periodically goes to afterburner

   GATE: PILOT ASCENSION ★10. Nothing here is buyable before that, and nothing
   here is ever taken away after it.

   NO RNG. Ship Ascension gambles because its rolls are cheap and repeatable;
   these are neither. A rank costs what the card says and is granted, once.

   THE SINK. Rank r of a doctrine costs GOLD ×5 the last rank, its GALAXY
   RESOURCE ×3, and ◈ PRISM INGOTS ×2 — three curves on three faucets, so the
   ladder cannot be walked on one income stream. One doctrine to rank 10 is
   ~2.4e19 gold; all four is ~9.8e19. Rank 1 of anything is payable the day the
   gate opens, which is the point: the first taste is cheap, the tail is a
   months-long spend, and nothing here is ever dead content.

   KING OF THE HILL — CHECKED, NO CHANGE NEEDED (Aug 2026). Corona and Nova are
   AREA damage, so the obvious worry is that a maxed wing blows past the server's
   `koth_max_kps` ceiling and has bumps silently clamped. It cannot: kills are
   bounded by SPAWNS, and the arena spawner tops the field up to 26 live hostiles
   at most 6 per 0.25s (koth.js engineTick) — a hard 24 kills/second however fast
   the wing deletes things. The cap is 60/s sustained + 300 burst with a 600-kill
   max delta (supabase/koth-ratefix.sql), so there is 2.5× headroom and area
   damage adds none of it. Faster killing does not create hostiles. Do not raise
   that knob for this feature; if a future change raises the SPAWN ceiling, that
   is when this arithmetic has to be redone.

   WHERE THE NUMBERS LIVE. This file is the only statement of them. fighters.js
   reads corona()/phantom()/nova()/sortie() and applies them; the screen prints
   the same functions. Nothing restates a doctrine's figures.

   ONE DOCTRINE FLIES AT A TIME (729). Ranks are bought and kept per doctrine
   forever, but only ONE of the four is active — the wing trains to a doctrine,
   it does not run all four at once. Switching is FREE and instant: the
   commitment this system asks for is the SPEND, not a lockout. With ranks at
   gold ×5 apiece nobody maxes two ladders casually, so the choice is already
   paid for by the time it is made, and charging again to flip between two
   things you own would only tax the player for owning them. No cooldown means
   no calendar, which means nothing new to name in ASC_KEEP.

   SAVE: state.fasc = { ranks: { corona, phantom, nova, sortie }, active: 'k' }
     · in ASC_KEEP — permanent account power, survives every pilot ascension
     · max-unioned field-by-field in mergeSaves() — a rank is paid for and can
       never be refunded, so the higher copy is always the true one
     · sanitizeSave() CLAMPS ranks; it never revokes one
     · `active` is a PREFERENCE, not progress: it follows the base pick in a
       merge, exactly as commanders.js `slot` does. Max-unioning a choice is
       meaningless — there is no "higher" doctrine — and the newest save is the
       one that knows what the pilot last chose. It is never REQUIRED to be
       present: an absent or stale value resolves to the highest rank held, so
       no save can arrive flying nothing.
   ========================================================================== */
(function () {
  'use strict';
  const G = () => window.GAME;
  const C = () => window.CONFIG;
  const MAXR = 10;
  const GATE = 10;                       // pilot ascension stars required
  const RES_KEYS = ['fuel', 'iron', 'plasma'];
  const RES = {
    gold:   { glyph: '●', c: '#f2b24b', name: 'Gold' },
    fuel:   { glyph: '⬢', c: '#5bc0ff', name: 'Fuel' },
    iron:   { glyph: '◆', c: '#d0a060', name: 'Iron' },
    plasma: { glyph: '✦', c: '#c07bff', name: 'Plasma' },
    ing:    { glyph: '◈', c: '#c9a0ff', name: 'Prism Ingots' },
  };

  // ---- THE FOUR DOCTRINES ---------------------------------------------------
  // `at(R)` is the whole mechanical statement of a doctrine at rank R. Every
  // other line in this file — the card, the combat hook, the Ship Score term —
  // reads it. Rank 0 returns null: not bought is not "zero of it", it is absent.
  const DOCS = [
    {
      k: 'corona', name: 'Corona Mantle', ic: '◉', col: '#ff8a3d',
      sub: 'Burning halo · area damage',
      res: { plasma: 1 },
      blurb: 'Each fighter runs its reactor past the redline and wears the overflow: a plasma corona that burns everything inside it, continuously, whether the craft is shooting that hostile or not. It is the wing\u2019s answer to a swarm — the craft never stops firing, and the halo eats whatever it flies through.',
      // A pulse is AREA damage: it does not crit, does not proc cryo or life
      // steal, and hits at most `n` hostiles — see the area-damage note in
      // game-v93.js. `frac` is a share of that craft's own strike, so a better
      // bay burns hotter and the whole thing rides the wing's anchor.
      at: (R) => R <= 0 ? null : {
        r: 70 + 12 * R,                    // 82 → 190 px
        frac: 0.06 + 0.036 * R,            // 9.6% → 42% of a strike, per pulse
        n: 3 + Math.ceil(R * 0.6),         // 4 → 9 hostiles a pulse
        hz: 2,                             // pulses a second (fixed)
      },
      line: (a) => a ? ('◉ ' + Math.round(a.r) + 'px halo · ' + Math.round(a.frac * a.hz * 100) + '% of a strike per second · up to ' + a.n + ' hostiles') : 'no halo',
    },
    {
      k: 'phantom', name: 'Phantom Lattice', ic: '◈', col: '#7fd1ff',
      sub: 'Spectral double · strike weight',
      res: { fuel: 1 },
      blurb: 'A lattice of stored light flies half a second behind each fighter and fires when it fires. The echo is not a second craft — it cannot be shot and it holds no bay — but its lance lands as real weapon fire, with your crit, your life steal and every fleet effect the wing already honours.',
      // A phantom strike IS weapon fire: it goes through resolveHit exactly like
      // the craft's own shot, at the craft's own cadence. No new hit rate, so no
      // new proc rate — just weight.
      at: (R) => R <= 0 ? null : {
        frac: 0.12 + 0.06 * R,             // 18% → 72% of the strike, per echo
        echoes: R >= 6 ? 2 : 1,            // a second lattice at rank 6
      },
      line: (a) => a ? ('◈ ' + a.echoes + ' echo' + (a.echoes === 1 ? '' : 'es') + ' × ' + Math.round(a.frac * 100) + '% of every strike (+' + Math.round(a.frac * a.echoes * 100) + '% wing damage)') : 'no echo',
    },
    {
      k: 'nova', name: 'Nova Reclamation', ic: '✷', col: '#ffe27a',
      sub: 'Kill blast · wreck cook-off',
      res: { iron: 1 },
      blurb: 'Instead of leaving a wreck, the craft drops a shaped charge into it and pulls out. The hull goes up as a white shockwave that guts everything standing beside it — and deep enough into the doctrine, the wreck cooks off a second time: wider, weaker, free.',
      at: (R) => R <= 0 ? null : {
        r: 80 + 16 * R,                    // 96 → 240 px
        frac: 0.30 + 0.20 * R,             // 50% → 230% of the killing strike
        n: 3 + Math.ceil(R * 0.7),         // 4 → 10 hostiles in the blast
        chain: R >= 5 ? Math.min(0.4, 0.05 * (R - 4)) : 0,   // rank 5+: 5% → 30% cook-off
      },
      line: (a) => a ? ('✷ ' + Math.round(a.r) + 'px blast · ' + Math.round(a.frac * 100) + '% of the strike · up to ' + a.n + ' caught' + (a.chain ? ' · ' + Math.round(a.chain * 100) + '% cook-off' : '')) : 'no blast',
    },
    {
      k: 'sortie', name: 'Apex Sortie', ic: '➤', col: '#c98cff',
      sub: 'Timed burst · whole wing',
      // THE CAPSTONE PAYS IN ALL THREE. Every other doctrine drains one galaxy
      // resource; this one is the wing-wide doctrine and takes 40% of the rank
      // price out of each, so no single stockpile can carry the whole ladder.
      res: { fuel: 0.4, iron: 0.4, plasma: 0.4 },
      blurb: 'A launch order the carrier sends on a clock. Every craft in the fleet lights its afterburner at once, closes to knife range and empties its racks — harder and faster for the length of the window, then falls back to station to cool.',
      at: (R) => R <= 0 ? null : {
        dur: 4 + 0.6 * R,                  // 4.6s → 10s of burst
        cd: 46 - 2.6 * R,                  // 43.4s → 20s between windows
        dmg: 1 + 0.12 * R,                 // ×1.12 → ×2.2 damage
        rate: 1 + 0.06 * R,                // ×1.06 → ×1.6 cadence
      },
      line: (a) => a ? ('➤ ×' + a.dmg.toFixed(2) + ' damage · ×' + a.rate.toFixed(2) + ' cadence · ' + a.dur.toFixed(1) + 's every ' + Math.round(a.cd) + 's') : 'no sortie',
    },
  ];
  const BY_K = {}; DOCS.forEach((d) => BY_K[d.k] = d);

  // ---- COST ----------------------------------------------------------------
  // Three curves on three faucets. Gold is the steep axis, the galaxy resource
  // the gentle one (it accrues slowest), prism ingots the flat-ish gate. Stated
  // once here and printed straight onto the button.
  //
  // COSTS DOUBLED PRE-LAUNCH (729). The bases below are 2× their first draft and
  // the multipliers are untouched, so every rank of every doctrine is exactly
  // twice what it was and the SHAPE of the curve is unchanged. Safe to do here
  // and only here: Fighter Ascension ships IN 729, which has never been pushed,
  // so no account holds a rank and nothing is being clawed back. Once a build
  // carrying this feature is live, raising these is a nerf and owes a patch card.
  const GOLD0 = 1e13, GOLD_K = 5;
  const RES0  = 4e9,  RES_K  = 3;
  const ING0  = 10000, ING_K  = 2;
  function cost(k, r) {
    const d = BY_K[k]; if (!d || r < 1 || r > MAXR) return null;
    const g = GOLD0 * Math.pow(GOLD_K, r - 1);
    const base = RES0 * Math.pow(RES_K, r - 1);
    const res = {};
    RES_KEYS.forEach((rk) => { if (d.res[rk]) res[rk] = Math.round(base * d.res[rk]); });
    return { gold: Math.round(g), res, ing: Math.round(ING0 * Math.pow(ING_K, r - 1)) };
  }
  // What the whole ladder costs, for the card that has to be honest about it.
  function ladderGold(k) { let t = 0; for (let r = 1; r <= MAXR; r++) t += cost(k, r).gold; return t; }

  // ---- STATE ---------------------------------------------------------------
  function st() {
    const s = G() && G().state; if (!s) return null;
    if (!s.fasc) s.fasc = { ranks: {} };
    if (!s.fasc.ranks) s.fasc.ranks = {};
    return s.fasc;
  }
  // PEEK, never create — the combat hooks run every frame and must not write to
  // the save just by being read.
  function rank(k) {
    try {
      const f = G().state.fasc;
      const v = f && f.ranks ? f.ranks[k] : 0;
      const n = Math.floor(Number(v) || 0);
      return n < 0 ? 0 : n > MAXR ? MAXR : n;
    } catch (e) { return 0; }
  }
  function stars() { try { return (window.PASCEND && window.PASCEND.stars()) | 0; } catch (e) { return 0; } }
  function unlocked() { return stars() >= GATE; }
  function totalRanks() { let n = 0; DOCS.forEach((d) => n += rank(d.k)); return n; }

  // ---- WHICH DOCTRINE IS FLYING -------------------------------------------
  // ONE ANSWER, DERIVED, NEVER WRITTEN ON READ. The combat hooks resolve this
  // every frame through derived(), so it must not touch the save just by being
  // asked — the same rule rank() follows.
  //
  // AN UNSET OR STALE VALUE IS NOT "NOTHING ACTIVE". It resolves to the highest
  // rank held, so: a save written before this system existed flies its best
  // doctrine on the first load, a value naming a doctrine at rank 0 (possible
  // only via a hand-edited save) repairs itself, and there is no state in which
  // a pilot who owns ranks is silently flying none of them. Standing down to
  // zero doctrines is deliberately not offered: it is strictly worse than every
  // alternative and exists only as a way to lose power by accident.
  function activeKey() {
    try {
      const f = G().state.fasc;
      const want = f && typeof f.active === 'string' ? f.active : '';
      if (want && BY_K[want] && rank(want) > 0) return want;
      let best = null, bestR = 0;
      for (let i = 0; i < DOCS.length; i++) {
        const r = rank(DOCS[i].k);
        if (r > bestR) { bestR = r; best = DOCS[i].k; }
      }
      return best;
    } catch (e) { return null; }
  }
  function isActive(k) { return activeKey() === k; }
  // The doctrine's own record, for a screen that wants to name what is flying.
  function activeDoc() { const k = activeKey(); return k ? BY_K[k] : null; }
  // SWITCHING. Free, instant, and refused rather than defaulted when it cannot
  // be honoured — setGameSpeed()'s discipline: name every legal value, never
  // fall through to a permissive default.
  function setActive(k) {
    if (!BY_K[k]) return { ok: false, reason: 'unknown' };
    if (!unlocked()) return { ok: false, reason: 'locked' };
    if (rank(k) <= 0) return { ok: false, reason: 'norank' };
    const f = st(); if (!f) return { ok: false, reason: 'nostate' };
    if (f.active === k) return { ok: true, k, already: true };
    f.active = k;
    _v++; _fp = '';
    try { G().refreshStats(); } catch (e) {}
    try { G().save(); } catch (e) {}
    try { if (window.UI && window.UI.refreshAll) window.UI.refreshAll(); } catch (e) {}
    return { ok: true, k };
  }

  // ---- DERIVED, CACHED ----------------------------------------------------
  // corona()/phantom()/nova() are read per craft, per frame, inside the wing
  // loop. They resolve to the SAME object until a rank changes, so the hot path
  // is a property read rather than four object allocations a frame.
  //
  // THIS IS ALSO THE ONE PLACE THE "ONE AT A TIME" RULE IS ENFORCED. An inactive
  // doctrine resolves to null — the exact shape rank 0 already produced — so
  // every consumer downstream (fighters.js, the sortie clock, strikeMult, the
  // corona's Ship Score term, the FX layer) honours the rule without knowing it
  // exists. Gating at each call site instead would be five chances to miss one.
  // rank() deliberately still reports what is OWNED: the screen must print the
  // ranks a player paid for whether they are flying them today or not.
  let _v = 0, _cv = -1, _c = null;
  function derived() {
    if (_cv === _v && _c) return _c;
    _cv = _v;
    const live = unlocked() ? activeKey() : null;
    const of = (k) => (live === k) ? BY_K[k].at(rank(k)) : null;
    _c = { corona: of('corona'), phantom: of('phantom'), nova: of('nova'), sortie: of('sortie') };
    return _c;
  }
  // A rank can also arrive from a cloud merge or a redeem, not just from buy(),
  // so the cache is invalidated on a cheap fingerprint rather than trusting that
  // every writer remembered to bump it. The ACTIVE doctrine is part of that
  // fingerprint: a switch changes every derived value and must not be cached past.
  let _fp = '';
  function sync() {
    const fp = rank('corona') + ',' + rank('phantom') + ',' + rank('nova') + ',' + rank('sortie')
      + ',' + (unlocked() ? 1 : 0) + ',' + (activeKey() || '-');
    if (fp !== _fp) { _fp = fp; _v++; }
  }

  const corona  = () => derived().corona;
  const phantom = () => derived().phantom;
  const nova    = () => derived().nova;

  // ---- THE SORTIE CLOCK ---------------------------------------------------
  // RUNTIME ONLY, never saved: a burst window is not progress, and a saved timer
  // would hand a fresh window out on every reload. It only advances while the
  // wing has something to shoot, so the cooldown cannot tick down in the hangar
  // and fire into an empty zone the moment the pilot deploys.
  const _s = { on: 0, cd: 0, live: false, fired: 0 };
  function tick(dt, hasTargets) {
    sync();
    const a = derived().sortie;
    if (!a) { _s.on = 0; _s.cd = 0; _s.live = false; return; }
    if (_s.on > 0) {
      _s.on -= dt;
      if (_s.on <= 0) { _s.on = 0; _s.live = false; _s.cd = a.cd; }
      return;
    }
    if (!hasTargets) return;               // no fight, no clock
    _s.cd -= dt;
    if (_s.cd <= 0) { _s.on = a.dur; _s.live = true; _s.fired++; }
  }
  // What the wing is flying RIGHT NOW: ×1 when no window is open, so the caller
  // multiplies unconditionally and never branches per craft.
  function sortie() {
    const a = derived().sortie;
    if (!a) return null;
    return { live: _s.live, left: Math.max(0, _s.on), cd: Math.max(0, _s.cd),
             dmg: _s.live ? a.dmg : 1, rate: _s.live ? a.rate : 1,
             dur: a.dur, cdFull: a.cd, fired: _s.fired, k: a.dur / (a.dur + a.cd) };
  }

  // ---- SHIP SCORE ---------------------------------------------------------
  // The published fleet score, the clone matchup and the offline sim all read
  // theoryDps, and fighters.js folds the wing in through dpsRatio(). A doctrine
  // that adds real damage and is NOT in that figure would under-score every
  // carrier — the exact fault dpsRatio was written to fix, one level down.
  //
  // PHANTOM is exact: every strike lands (1 + frac × echoes) times.
  // APEX SORTIE is averaged over its duty cycle — it is a real burst, so scoring
  // its peak would over-state a carrier permanently.
  // CORONA is counted as its SINGLE-TARGET worth only (frac × hz relative to the
  // craft's own cadence), because that is the honest floor: against one boss the
  // halo bites once a pulse. Its value against a swarm is deliberately not
  // banked into a score that decides duels against other pilots' fleets.
  function strikeMult() {
    const d = derived(), p = d.phantom, s = d.sortie;
    let m = 1;
    if (p) m *= 1 + p.frac * p.echoes;
    if (s) m *= 1 + (s.dur / (s.dur + s.cd)) * (s.dmg * s.rate - 1);
    return m;
  }
  function coronaDpsPerCraft(strikeDps, strikeRate) {
    const a = derived().corona;
    if (!a || !(strikeRate > 0)) return 0;
    return strikeDps * (a.frac * a.hz) / strikeRate;
  }

  // ---- EFFECTS TOGGLE (device fact, not an account fact) ------------------
  // A DEVICE decision, so it lives in localStorage exactly like the chat dock's
  // read marker: what a phone can afford to draw is not something that should
  // roam to the player's desktop or ride through a save merge.
  const FXK = 'lf_fasc_fx';
  function fxOn() { try { return localStorage.getItem(FXK) !== '0'; } catch (e) { return true; } }
  function setFx(v) { try { localStorage.setItem(FXK, v ? '1' : '0'); } catch (e) {} }

  // ---- BUY ----------------------------------------------------------------
  // A rank is permanent and the price is enormous, so this follows the same
  // discipline as the perk respec:
  //   · ONE AT A TIME. `_busy` stops a double-tap or a second tab paying twice.
  //   · AFFORDABILITY IS RE-CHECKED AT THE MOMENT OF THE WRITE, not when the
  //     button was drawn — the screen can sit open while gold is spent elsewhere.
  //   · NEVER `| 0` A BALANCE. These costs run to 1e19; a bitwise coercion wraps
  //     signed 32-bit and would hand a rich player a negative wallet.
  //   · PAYMENT FIRST, THEN THE GRANT, SYNCHRONOUSLY, with nothing between them
  //     that can throw.
  let _busy = false;
  function bank() {
    const S = G().state;
    const r = S.resources || {};
    const p = S.prism || {};
    return { gold: Math.floor(Number(S.gold) || 0),
             fuel: Math.floor(Number(r.fuel) || 0),
             iron: Math.floor(Number(r.iron) || 0),
             plasma: Math.floor(Number(r.plasma) || 0),
             ing: Math.floor(Number(p.ingots) || 0) };
  }
  function short(c) {
    const b = bank(), out = [];
    if (b.gold < c.gold) out.push('gold');
    RES_KEYS.forEach((rk) => { if (c.res[rk] && b[rk] < c.res[rk]) out.push(rk); });
    if (c.ing && b.ing < c.ing) out.push('ing');
    return out;
  }
  function afford(c) { return short(c).length === 0; }
  function buy(k) {
    if (_busy) return { ok: false, reason: 'busy' };
    const d = BY_K[k]; if (!d) return { ok: false, reason: 'unknown' };
    if (!unlocked()) return { ok: false, reason: 'locked' };
    const r = rank(k);
    if (r >= MAXR) return { ok: false, reason: 'max' };
    const c = cost(k, r + 1);
    if (!afford(c)) return { ok: false, reason: 'cost', short: short(c) };
    _busy = true;
    try {
      const S = G().state;
      // paid…
      S.gold = Math.floor(Number(S.gold) || 0) - c.gold;
      S.resources = S.resources || { fuel: 0, iron: 0, plasma: 0 };
      RES_KEYS.forEach((rk) => {
        if (!c.res[rk]) return;
        S.resources[rk] = Math.floor(Number(S.resources[rk]) || 0) - c.res[rk];
      });
      if (c.ing) {
        if (!S.prism) S.prism = { ingots: 0, best: 0, core: 0, refinery: 0, _frac: 0, miners: [], entered: false };
        S.prism.ingots = Math.floor(Number(S.prism.ingots) || 0) - c.ing;
      }
      // …then delivered, in the same synchronous block
      st().ranks[k] = r + 1;
      // THE FIRST RANK AN ACCOUNT EVER BUYS ARMS ITSELF. Otherwise a pilot pays
      // ten trillion gold and nothing happens until they find the switch. It
      // never STEALS focus afterwards: buying into a second doctrine leaves the
      // one you are flying alone, because that is a choice, not a side effect.
      const F = st();
      if (!F.active || !BY_K[F.active] || rank(F.active) <= 0) F.active = k;
      _v++; _fp = '';
      try { G().refreshStats(); } catch (e) {}
      try { G().save(); } catch (e) {}
      try { if (window.ACCOUNT && window.ACCOUNT.flushNow) window.ACCOUNT.flushNow(); } catch (e) {}
    } finally { _busy = false; }
    return { ok: true, rank: r + 1 };
  }

  window.FASCEND = {
    // gate + record
    GATE, MAXR, DOCS, BY_K, unlocked, stars, rank, totalRanks, cost, ladderGold,
    bank, afford, short, buy, fxOn, setFx, sync,
    // which doctrine is flying
    activeKey, isActive, activeDoc, setActive,
    // combat hooks (fighters.js)
    corona, phantom, nova, sortie, tick,
    // ship score
    strikeMult, coronaDpsPerCraft,
    // display helpers the screen and the Command card share
    lineOf: (k) => { const d = BY_K[k]; return d ? d.line(d.at(rank(k))) : ''; },
    nextLineOf: (k) => { const d = BY_K[k]; if (!d) return ''; const r = rank(k); return r >= MAXR ? '' : d.line(d.at(r + 1)); },
    RES,
  };
})();
