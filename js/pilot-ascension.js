/* =============================================================================
   pilot-ascension.js — LOOTFLEET · PILOT ASCENSION (prestige)
   -----------------------------------------------------------------------------
   The endless loop. At the level cap the pilot may ascend: the account
   resets to Level 1 in exchange for PERMANENT account-wide power.

     • ASCENSION POINTS are earned from the run you're giving up — pilot level is
       the spine (Lv 100 = 1 pt, 250 = 2, 500 = 4, 1000 = 8, exactly per spec),
       with bonus points for fleet score, deepest zone, territory, badge ranks
       and wing size. The full arithmetic is shown BEFORE you commit.
     • THE WHOLE FLEET is carried across — every hull you own, and everything the
       SHIPYARD built into it: upgrade levels AND each hull's SHIP ASCENSION
       (module tiers + stars). What the pilot was CARRYING — fitted equipment,
       cargo, Starforge tempers — is surrendered. Gold and Galaxy Resources are
       NOT: the wallet and the territory income ride across (Aug 2026). You pick
       the flagship you fly out in.
     • ASCENSION STARS (one per ascension) sit next to the pilot name and gate
       the three ASCENSION-EXCLUSIVE loot tiers — Ascendant (★1), Celestial
       (★20), Paragon (★50). Those tiers cannot drop for an un-ascended pilot at
       any zone, from any boss, out of any crate.
     • The PILOT TREE and its ◇ Dread Cores SURVIVE the reset (Aug 2026) — the
       nodes are weekly-raid currency, not pilot level, so they carry across.
     • PERKS spend points on eight permanent multipliers that apply to every
       future run.

   Nothing here is reversible, so the confirm gate is deliberately heavy: an
   itemised keep/lose ledger, the exact point total, the flagship, and a
   typed-intent button. See ascendFlow().
   ========================================================================== */
(function () {
  'use strict';
  const G = () => window.GAME;
  const C = () => window.CONFIG;
  const $ = (id) => document.getElementById(id);
  // LEVEL CAP — mirrors CONFIG.levelCap(): 150, +50 per star. Read from config
  // when it's there so the two can never drift.
  const CAP_BASE = (() => { try { return C().LEVEL_CAP_BASE || 150; } catch (e) { return 150; } })();
  const CAP_STEP = (() => { try { return C().LEVEL_CAP_PER_STAR || 50; } catch (e) { return 50; } })();
  // THE GATE IS THE LEVEL CAP (Aug 2026). The cap is 150 +50 per star, so the gate
  // walks up with it: 150 · 200 · 250 · 300… Half the cap shipped before this and
  // is reverted here. Ascending mid-run meant the last half of every ceiling was
  // dead ground — XP you could still earn but had no reason to, because the payout
  // for banking it was smaller than the payout for starting over. The cap states
  // one rule with no dead ground in it: finish the run, then choose. It also lines
  // the gate up with the wall the loop exists to break — at the cap XP stops
  // accruing, and that is exactly the moment ascension opens. Kept as a function
  // so the whole game reads the gate from one place.
  function capLv() { try { return C().levelCap(); } catch (e) { return CAP_BASE + CAP_STEP * stars(); } }
  function gateLv() { return Math.max(1, capLv() | 0); }
  const PT_MULT = 10;   // ascension point payout multiplier (see preview())
  const MAX_RANK = 25;

  // ===========================================================================
  // THE ASCENSION STAR CAP — a weekly ceiling, driven purely by the clock.
  //
  //     cap = 10 + 1 × (whole weeks since Mon 10 Aug 2026, 00:00 UTC)
  //
  // NO SERVER, NO CONFIG PUSH, NO DEV ACTION, EVER. It is arithmetic on
  // Date.now(), so it raises itself every Monday for as long as the game exists
  // and keeps raising if nobody ever touches this file again. There is nothing to
  // schedule and nothing that can be forgotten — which is the whole point: a cap
  // that needs a human to lift it is a cap that eventually strands players.
  //
  // WHY A CAP AT ALL. Ascension is the deepest progression in the game: each star
  // raises the level ceiling +50 and is the dominant term in save-merge weight.
  // A pilot who can chain ascensions in one sitting burns through content that is
  // meant to unfold over months, and lands in an endgame with nothing left. The
  // weekly ladder paces it — you can always ascend, right up to the cap, and the
  // cap moves every week whether you were online or not.
  //
  // The epoch is deliberately IN THE PAST (the Monday before this shipped) so
  // week 0 is the launch week and the first raise is the following Monday. UTC
  // throughout, so the raise is the same instant for every player on earth.
  const STAR_CAP_BASE = 10;                        // ceiling in the launch week
  const STAR_CAP_STEP = 1;                         // added every week, forever
  const STAR_CAP_EPOCH = Date.UTC(2026, 7, 10);    // Mon 10 Aug 2026 00:00 UTC
  const WEEK_MS = 604800000;
  // THE SERVER'S CLOCK, NOT THE DEVICE'S. A weekly ceiling read off Date.now() is
  // raised by ten weeks by setting the phone forward ten weeks — the ceiling would
  // be decoration. SERVERTIME anchors on the backend's own Date header, ticks on
  // monotonic performance.now() so an in-session clock change does nothing, and
  // holds at the last server-verified instant when it cannot reach the backend
  // (so the ceiling freezes rather than inflating). See js/servertime.js.
  const ST = () => window.SERVERTIME;
  function tnow() { const s = ST(); return s ? s.now() : Date.now(); }
  function clockTrusted() { const s = ST(); return !!(s && s.trusted()); }
  function clockUsable() { const s = ST(); return s ? !!s.usable() : true; }
  function clockMode() { const s = ST(); return s ? s.mode() : 'device'; }
  function capWeeks() { return Math.max(0, Math.floor((tnow() - STAR_CAP_EPOCH) / WEEK_MS)); }
  function starCap() { return STAR_CAP_BASE + STAR_CAP_STEP * capWeeks(); }
  function nextRaiseAt() { return STAR_CAP_EPOCH + (capWeeks() + 1) * WEEK_MS; }
  function nextCap() { return starCap() + STAR_CAP_STEP; }
  function starsLeft() { return Math.max(0, starCap() - stars()); }
  function atStarCap() { return stars() >= starCap(); }
  // "3d 04h" — the wait, never a bare timestamp: a countdown reads the same in
  // every timezone and needs no explaining.
  function untilRaise() {
    const ms = Math.max(0, nextRaiseAt() - tnow());
    const d = Math.floor(ms / 86400000), h = Math.floor(ms % 86400000 / 3600000),
          m = Math.floor(ms % 3600000 / 60000), s = Math.floor(ms % 60000 / 1000);
    const p = (n) => (n < 10 ? '0' : '') + n;
    // Seconds appear inside the last hour, where they are the difference between
    // "soon" and "watch it happen"; a multi-day wait does not need them ticking.
    return d > 0 ? d + 'd ' + p(h) + 'h ' + p(m) + 'm'
         : h > 0 ? p(h) + 'h ' + p(m) + 'm ' + p(s) + 's'
         : p(m) + 'm ' + p(s) + 's';
  }
  // FORMATTED IN UTC, NOT LOCAL TIME. The boundary IS a UTC instant, and the copy
  // beside this says "every Monday" — formatted locally, Mon 00:00 UTC renders as
  // "Sunday" for every player west of Greenwich, so the card contradicted itself
  // across all of the Americas. The countdown is timezone-proof either way; this
  // label has to name the same day the mechanic does.
  // How far through the current UTC week we are — drives the countdown bar.
  function weekPct() {
    const start = STAR_CAP_EPOCH + capWeeks() * WEEK_MS;
    return Math.max(0, Math.min(100, (tnow() - start) / WEEK_MS * 100));
  }
  // The live block: big countdown, target, and an honest word on the clock itself.
  // Rendered as one node so a 1s tick can replace it without touching the card.
  function countdownHTML() {
    const m = clockMode(), st = ST() ? ST().state() : null;
    const note = m === 'server'
      ? '● server time · synced'
      : m === 'held'
        ? '○ can’t reach the server — held at the last confirmed week. Reconnect to advance.'
        : (st && st.syncing) ? '○ syncing with the server…'
        : '○ device clock — not yet verified against the server';
    return '<div class="pa-cd' + (m === 'server' ? '' : ' cold') + '">' +
        '<div class="pa-cd-l">★' + nextCap() + ' unlocks in</div>' +
        '<div class="pa-cd-t">' + untilRaise() + '</div>' +
        '<div class="pa-cd-w">' + raiseDateText() + '</div>' +
        '<div class="pa-cd-s">' + note + '</div>' +
      '</div>';
  }
  function raiseDateText() {
    try {
      return new Date(nextRaiseAt()).toLocaleDateString(undefined,
        { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }) + ' UTC';
    } catch (e) { return 'next Monday UTC'; }
  }

  function st() {
    const s = G() && G().state; if (!s) return null;
    if (!s.pasc) s.pasc = { stars: 0, pts: 0, spent: 0, perks: {}, legacy: null, hist: [] };
    if (!s.pasc.perks) s.pasc.perks = {};
    if (!Array.isArray(s.pasc.hist)) s.pasc.hist = [];
    return s.pasc;
  }
  const stars = () => { const p = st(); return p ? (p.stars | 0) : 0; };
  const points = () => { const p = st(); return p ? (p.pts | 0) : 0; };
  function fmt(n) { try { return G().formatNum(Math.floor(n)); } catch (e) { return Math.floor(n || 0) + ''; } }

  // ---- THE 5-STAR RANK MODEL -------------------------------------------------
  // Same shape as Ship Ascension — five stars fill a tier, then the tier steps
  // up — but the TIER LADDER IS THE LOOT RARITY LADDER, so a pilot's stars are
  // coloured by the rarity they've climbed to. "Sina ★★★" in Epic purple reads
  // instantly as ascension 13. 5 stars × 17 rarities = 85 ascensions deep.
  const PT = () => C().RARITY || [];
  const tierOf = (n) => Math.max(0, Math.min(PT().length - 1, Math.floor(((n | 0) - 1) / 5)));
  const starOf = (n) => (n | 0) <= 0 ? 0 : ((((n | 0) - 1) % 5) + 1);
  function tierDef(n) { return PT()[tierOf(n)] || { name: 'Common', color: '#c3cfdd' }; }

  // The one badge every other screen renders. `name` optional — omit for a bare
  // rank chip. Used by the leaderboard, galaxy tooltips, profiles and the HUD.
  function badge(name, n, opts) {
    const s = n == null ? stars() : n | 0;
    const o = opts || {};
    if (!s) return name ? '<span class="pa-id">' + esc(name) + '</span>' : '';
    const t = tierDef(s), full = starOf(s);
    const st = Array.from({ length: 5 }, (_, i) => '<i' + (i < full ? ' class="f"' : '') + '>★</i>').join('');
    return '<span class="pa-id" style="--tc:' + t.color + '"' + (o.title === false ? '' : ' title="Ascension ' + s + ' · ' + t.name + ' ★' + full + '"') + '>' +
      (name ? '<b class="pa-id-n">' + esc(name) + '</b>' : '') +
      '<span class="pa-id-st' + (t.prismatic ? ' prism' : '') + '">' + st + '</span>' +
      (o.tier ? '<em class="pa-id-t">' + t.name + '</em>' : '') +
    '</span>';
  }
  // plain-text form for canvas labels, titles and anywhere HTML can't go
  function plain(n) {
    const s = n == null ? stars() : n | 0;
    if (!s) return '';
    return '★'.repeat(starOf(s)) + (tierOf(s) ? ' ' + tierDef(s).name : '');
  }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ---- PERKS -----------------------------------------------------------------
  // Eight permanent multipliers. Rank cost = rank number (1,2,3…), so rank 25
  // costs 25 points and a fully-maxed perk is 325 points — many ascensions deep.
  const PERKS = [
    // PROGRESSION NOTE (Aug 2026) — 8 → 5 per rank. XP bonuses were cut across the
    // whole game so the summed bonus lands near +400 for a maxed account instead
    // of +600; see the FLEET XP RATE block in game-v93.js. At rank 25 this is
    // +125% rather than +200%, and it is still the single largest XP source a
    // pilot can buy.
    { k: 'xp',    ic: '◈', name: 'Neural Uplink',    sub: 'EXP Gain',        per: 5,  col: '#7ce0ff', desc: 'Every source of experience pays more — kills, missions, bosses, offline.' },
    { k: 'loot',  ic: '❖', name: 'Salvage Doctrine', sub: 'Loot Find',       per: 6,  col: '#7ce0a0', desc: 'Raises the chance a wreck drops anything at all.' },
    { k: 'gold',  ic: '●', name: 'Prize Courts',     sub: 'Gold Gain',       per: 10, col: '#f2b24b', desc: 'More gold from every kill, sale and salvage.' },
    { k: 'boss',  ic: '☠', name: 'Siege Protocols',  sub: 'Boss Damage',     per: 12, col: '#ff6b78', desc: 'Bonus damage to bosses, dreadnaughts, citadels and clone fleets.' },
    { k: 'mine',  ic: '⛏', name: 'Deep Core Drills', sub: 'Mining Speed',    per: 10, col: '#ff2a2f', desc: 'Prism rigs refine faster in every field.' },
    { k: 'rare',  ic: '✦', name: 'Fortune Lattice',  sub: 'Rare Drop Chance',per: 5,  col: '#c07bff', desc: 'Shifts the whole rarity table upward — the only way to make the ascension tiers realistic.' },
    { k: 'tower', ic: '⚡', name: 'Bastion Command',  sub: 'Tower Damage',    per: 12, col: '#9fd6ff', desc: 'Home Citadel defence towers hit harder on every pad.' },
    { k: 'fleet', ic: '➤', name: 'Wing Tactics',     sub: 'Fleet Damage',    per: 10, col: '#ffab4a', desc: 'Escort hulls and drones in your wing deal more damage.' },
    // ---- ◉ BEACON PERKS — deliberately the strongest thing points can buy ----
    // The beacon is the one system a player triggers by hand, so making it the
    // headline reward for ascending gives points an immediate, visible payoff
    // instead of another quiet percentage. At full rank the swarm becomes how an
    // ascended pilot farms: near-permanent, quadruple size, and worth far more
    // per kill than anything else in the game.
    { k: 'bcCd',   ic: '◉', name: 'Distress Relay',    sub: 'Beacon Recharge',   per: 2.4, col: '#ff8a3d', beacon: true, desc: 'Cuts the beacon’s recharge — −2.4% a rank, capped at −60%. Rank 25 takes the 300s wait down to about 2 minutes; stacking Defense ranks and Choir hulls on top is what pushes it under a minute.' },
    { k: 'bcLife', ic: '◎', name: 'Sustained Signal',  sub: 'Beacon Duration',   per: 8,   col: '#ff6b78', beacon: true, desc: 'The beacon keeps calling for far longer — stacks on top of your Defense ranks. Capped so a third of the cycle stays quiet.' },
    { k: 'bcSize', ic: '✹', name: 'Wideband Broadcast', sub: 'Beacon Swarm Size', per: 8, col: '#ffd24d', beacon: true, desc: 'More hostiles answer every call, up to what the sector can hold.' },
    { k: 'bcLoot', ic: '◈', name: 'Wreckfield Tithe',  sub: 'Beacon Kill Value', per: 10,  col: '#7ce0a0', beacon: true, desc: 'Beacon-summoned kills pay extra gold, XP and loot — the swarm becomes your best farm.' },
  ];
  const PERK_BY_K = {}; PERKS.forEach((p) => PERK_BY_K[p.k] = p);
  const rank = (k) => { const p = st(); return p ? (p.perks[k] | 0) : 0; };
  const rankCost = (r) => r + 1;                       // next rank costs (current+1)
  // ---- RESPEC ----------------------------------------------------------------
  // WHAT A RANK ACTUALLY COST, derived from the rank itself: ranks are bought at
  // 1, 2, 3 … n, so a perk sitting at rank n consumed n(n+1)/2 points.
  //
  // THE REFUND IS COMPUTED FROM THE PERKS, NEVER FROM `p.spent`. `spent` is a
  // running tally that a save merge, an old build or a hand-edited save can put
  // out of step with the ranks actually held — and paying a refund off a number
  // that disagrees with the board either robs the player or mints points from
  // nothing. The ranks ARE the receipt.
  //
  // Every rank is clamped to MAX_RANK before it is priced, so a corrupted rank of
  // 9,999 refunds what rank 25 is worth and not 50 million points.
  const triangle = (n) => (n * (n + 1)) / 2;
  function spentFromRanks() {
    const p = st(); if (!p || !p.perks) return 0;
    let total = 0;
    for (const k in p.perks) {
      const r = Math.max(0, Math.min(MAX_RANK, Math.floor(Number(p.perks[k]) || 0)));
      total += triangle(r);
    }
    return total;
  }
  const RESPEC_LC = 10000;
  const perkPct = (k) => { const d = PERK_BY_K[k]; return d ? Math.round(rank(k) * d.per * 10) / 10 : 0; };
  // the one function the rest of the game calls
  function mult(k) { return 1 + perkPct(k) / 100; }
  // BEACON hooks read by game-v93's beaconStats(): recharge is a reduction, the
  // other three are multipliers.
  function beaconMods() {
    return {
      cdCut: Math.min(0.6, perkPct('bcCd') / 100),      // up to −60% recharge
      life:  mult('bcLife'),                            // up to ×4.5 duration
      size:  mult('bcSize'),                            // up to ×4 swarm
      loot:  mult('bcLoot'),                            // up to ×3.5 kill value
    };
  }

  // ---- ASCENSION POINT CALCULATOR -------------------------------------------
  // Every line is shown to the player before they commit. Level is deliberately
  // the dominant term: the spec's ladder (100→1, 250→2, 500→4, 1000→8) is the
  // floor:125 term, and the rest are capped bonuses so a long run is rewarded
  // without letting one stat run away with the total.
  function preview(s) {
    const S = s || (G() && G().state) || {};
    const lvl = Math.max(1, S.level | 0);
    let score = 0; try { score = G().score() || 0; } catch (e) {}
    const zone = Math.max(S.highestDungeonReached | 0, S.highestUnlocked | 0, 1);
    const tiles = Object.keys(S.ownedSystems || {}).length;
    const badges = (S.badgeRanks | 0) || (S.achClaimed | 0) || 0;
    let wing = 1; try { wing = 1 + (G().fleetShips ? G().fleetShips().length : 0); } catch (e) {}

    const rows = [
      { label: 'Pilot Level',   detail: 'Lv ' + fmt(lvl),                   pts: Math.max(1, Math.floor(lvl / 125)),                        note: 'Lv 125 per point · the spine of your payout' },
      { label: 'Fleet Score',   detail: fmt(score) + ' power',              pts: Math.min(6, Math.max(0, Math.floor(Math.log10(Math.max(1, score)) / 3))), note: 'every 1000× power' , cap: 6 },
      { label: 'Deepest Zone',  detail: 'Zone ' + fmt(zone),                pts: Math.min(4, Math.floor(zone / 125)),                       note: 'every 125 zones', cap: 4 },
      { label: 'Systems Held',  detail: fmt(tiles) + ' claimed',            pts: Math.min(4, Math.floor(tiles / 10)),                       note: 'every 10 systems', cap: 4 },
      { label: 'Badge Ranks',   detail: fmt(badges) + ' claimed',           pts: Math.min(5, Math.floor(badges / 200)),                     note: 'every 200 ranks', cap: 5 },
      { label: 'Wing Size',     detail: fmt(wing) + ' hulls flying',        pts: Math.min(2, Math.floor(wing / 4)),                          note: 'every 4 hulls', cap: 2 },
    ];
    // ×10 PAYOUT PASS (Jul 2026) — every line pays ten times what it used to, so
    // an ascension funds real perk buying instead of a single rank. Caps scale with
    // it, and the note text is rewritten from the same multiplier.
    rows.forEach((r) => { r.pts *= PT_MULT; if (r.cap) r.cap *= PT_MULT; });
    const total = rows.reduce((a, r) => a + r.pts, 0);
    // THREE GATES: the level gate, the weekly star ceiling, and a verified clock.
    // The clock is a gate because a star is permanent and the ceiling is the only
    // thing pacing it — granting one against an unverified clock is exactly the
    // hole the ceiling exists to close. It is not a punishment for being offline:
    // ascending publishes to the server regardless, so anyone who can bank the
    // star can reach the backend.
    const atCapNow = atStarCap();
    // USABLE, not TRUSTED. Requiring a verified anchor would lock every player out
    // of a permanent progression action the moment the time endpoint is unreachable
    // — or before the migration is run at all. `usable` is true once a sync has been
    // ATTEMPTED, so the only thing this blocks is the half-second before the first
    // reply, and the ceiling still applies on whatever clock we ended up with.
    // clockMode() says which, and the card tells the player plainly.
    const clockOk = clockUsable();
    return { rows, total, lvl, score, zone, tiles, badges, wing,
             eligible: lvl >= gateLv() && !atCapNow && clockOk,
             levelMet: lvl >= gateLv(), atCap: atCapNow, clockOk,
             starCap: starCap(), starsLeft: starsLeft() };
  }

  // ---- RARITY UNLOCKS --------------------------------------------------------
  // DORMANT TIERS ARE NOT ADVERTISED. A reserved entry carries ascReq: 9999 to
  // keep it out of the roll, which also made it satisfy `ascReq > 0` — so it
  // rendered as a real row on Loot Tiers AND became "the next tier" for every
  // ascended pilot, printing "unlocks at ★9999 — 9968 more after this one".
  // A tier the player cannot reach must not appear on a screen that promises it.
  function ascTiers() { return (C().RARITY || []).filter((r) => r.ascReq > 0 && !r.dormant); }
  function nextTierAt(s) { const n = s == null ? stars() : s; return ascTiers().find((r) => r.ascReq > n) || null; }

  // ===========================================================================
  // RENDER
  // ===========================================================================
  let tab = 'ascend';
  function render() {
    const body = $('pasc-body'); if (!body) return;
    const S = G().state, p = st();
    const sub = $('pasc-sub');
    if (sub) sub.innerHTML = p.stars ? badge(null, p.stars, { tier: true }) + ' · ' + fmt(points()) + ' pts' : 'Level ' + fmt(S.level) + ' / ' + fmt(gateLv());
    body.innerHTML =
      '<div class="pa-tabs">' +
        '<button class="pa-tab' + (tab === 'ascend' ? ' on' : '') + '" data-patab="ascend">✦ Ascend</button>' +
        '<button class="pa-tab' + (tab === 'perks' ? ' on' : '') + '" data-patab="perks">Perks' + (points() ? '<span class="pa-tab-b">' + fmt(points()) + '</span>' : '') + '</button>' +
        '<button class="pa-tab' + (tab === 'tiers' ? ' on' : '') + '" data-patab="tiers">Loot Tiers</button>' +
      '</div>' +
      (tab === 'ascend' ? ascendTab() : tab === 'perks' ? perksTab() : tiersTab());
    wire(body);
  }
  function starRow(n) { return badge(null, n, { tier: true }); }

  // ---- TAB 1 · ASCEND --------------------------------------------------------
  function ascendTab() {
    const S = G().state, p = st(), pv = preview();
    const locked = !pv.eligible;
    const cap = capLv(), gate = gateLv();
    const atCap = (S.level | 0) >= cap;
    const toCap = Math.max(0, cap - (S.level | 0));
    const nt = nextTierAt();
    const calcRows = pv.rows.map((r) =>
      '<div class="pa-calc-row' + (r.pts ? '' : ' zero') + '">' +
        '<span class="pa-calc-l"><b>' + r.label + '</b><em>' + r.detail + '</em></span>' +
        '<span class="pa-calc-n">' + (r.pts ? '+' + r.pts : '0') + '</span>' +
        '<span class="pa-calc-h">' + r.note + (r.cap ? ' · max ' + r.cap : '') + '</span>' +
      '</div>').join('');

    const ctaTop = pv.atCap
      ? '<div class="pa-locked">You are at this week’s ceiling of <b>★' + pv.starCap + '</b>. It rises to <b>★' + nextCap() + '</b> on <b>' + raiseDateText() + '</b> — <b>' + untilRaise() + '</b> from now. Nothing is lost by waiting: keep climbing and the payout you bank grows the whole time.</div>'
      : locked
      ? '<div class="pa-locked">Ascension opens at <b>Level ' + fmt(gate) + '</b> — your Lv ' + fmt(cap) + ' ceiling. You are <b>' + fmt(Math.max(0, gate - (S.level | 0))) + '</b> level' + (gate - (S.level | 0) === 1 ? '' : 's') + ' short. Every level you climb on the way also makes the payout bigger.</div>'
      : '<div class="pa-cta">' +
          // THE CHOICE, stated before the button. Reaching the cap is not an
          // instruction to ascend — it is the point at which both roads open, and
          // the pilot should be able to read the trade in one glance.
          '<div class="pa-fork">' +
            '<div class="pa-fork-h">You are at the ceiling — both roads are open</div>' +
            '<div class="pa-fork-2">' +
              '<div class="pa-fork-o"><span class="pa-fork-k">✦ ASCEND NOW</span>' +
                '<b>+' + pv.total + ' pt' + (pv.total === 1 ? '' : 's') + ' · +1 ★</b>' +
                '<em>Ceiling rises to Lv ' + fmt(cap + CAP_STEP) + '. The run restarts at Level 1; the fleet comes with you.</em></div>' +
              '<div class="pa-fork-o"><span class="pa-fork-k">△ KEEP PLAYING</span>' +
                '<b>' + (atCap ? 'Lv ' + fmt(cap) + ' · XP stopped' : toCap + ' level' + (toCap === 1 ? '' : 's') + ' to Lv ' + fmt(cap)) + '</b>' +
                '<em>' + (atCap
                  ? 'Kills still pay gold, resources, loot and events — but your level will not move again until you ascend.'
                  : 'Every level adds to the payout, so the points you bank grow with the climb.') + '</em></div>' +
            '</div>' +
          '</div>' +
          '<div class="pa-cta-row">' +
            '<div class="pa-cta-n"><b>+' + pv.total + '</b><em>ascension point' + (pv.total === 1 ? '' : 's') + '<br>+ 1 ★</em></div>' +
            '<div class="pa-cta-sum">' +
              '<div class="pa-cta-k">✓ <b>Your whole fleet comes with you</b> — every hull, every hull upgrade level, and every Ship Ascension</div>' +
              '<div class="pa-cta-l">✕ <b>The pilot run resets</b> — level and items (gold, resources and the Pilot Tree stay)</div>' +
            '</div>' +
          '</div>' +
          '<button class="pa-go" id="pa-begin">✦ BEGIN ASCENSION</button>' +
          '<div class="pa-go-note">You pick the hull you fly out in and confirm before anything is reset. Full breakdown below.</div>' +
        '</div>';

    return '<div class="pa-hero' + (locked ? ' locked' : '') + '" style="--tc:' + tierDef(Math.max(1, p.stars)).color + '">' +
        '<div class="pa-hero-rings"><i></i><i></i><i></i></div>' +
        '<div class="pa-hero-star">✦</div>' +
        (p.stars ? '<div class="pa-hero-cur">' + badge(null, p.stars, { tier: true }) + '<span class="pa-hero-n">Ascension ' + p.stars + '</span></div>' : '') +
        '<div class="pa-hero-t">PILOT ASCENSION</div>' +
        '<div class="pa-hero-s">' + (pv.atCap
          ? 'At this week’s ceiling — <b>★' + pv.starCap + '</b>. Rises to <b>★' + nextCap() + '</b> in <b>' + untilRaise() + '</b>.'
          : locked
          ? 'Reach the <b>Lv ' + fmt(gate) + ' cap</b> to unlock — you are Level ' + fmt(S.level)
          : 'Trade the <b>pilot’s</b> run for permanent power. Your <b>fleet keeps everything the shipyard built</b>.') + '</div>' +
        (locked && !pv.atCap ? '<div class="pa-lvbar"><i style="width:' + Math.min(100, S.level / gate * 100).toFixed(1) + '%"></i></div>' +
          '<div class="pa-lvbar-l"><span>Lv ' + fmt(S.level) + '</span><span>' + fmt(Math.max(0, gate - (S.level | 0))) + ' to go</span><span>Lv ' + fmt(gate) + '</span></div>' : '') +
      '</div>' +

      ctaTop +

      // ---- THE WEEKLY STAR CEILING ------------------------------------------
      // Stated in full every time, because a ceiling nobody can see reads as a
      // bug the moment it stops you.
      '<div class="pa-card pa-starcap' + (pv.atCap ? ' hot' : '') + '">' +
        '<div class="pa-card-h">✦ THIS WEEK’S STAR CEILING<em>' + (pv.atCap ? 'reached' : pv.starsLeft + ' left') + '</em></div>' +
        '<div class="pa-sc-row">' +
          '<div class="pa-sc-now"><b>★' + stars() + '</b><em>you are here</em></div>' +
          '<div class="pa-sc-arrow">→</div>' +
          '<div class="pa-sc-cap"><b>★' + pv.starCap + '</b><em>this week’s cap</em></div>' +
          '<div class="pa-sc-arrow">→</div>' +
          '<div class="pa-sc-next"><b>★' + nextCap() + '</b><em>' + raiseDateText() + '</em></div>' +
        '</div>' +
        // The bar fills across the CURRENT WEEK, not the whole ladder — it is a
        // countdown bar, so it has to answer "how much of this week is gone".
        '<div class="pa-sc-bar"><i style="width:' + weekPct().toFixed(2) + '%"></i></div>' +
        '<div class="pa-sc-clock" id="pa-sc-clock" data-live="1">' + countdownHTML() + '</div>' +
        '<p class="pa-note">Ascension has a ceiling that <b>rises on its own every week</b>. It started at <b>★' + STAR_CAP_BASE + '</b> and goes up <b>+' + STAR_CAP_STEP + ' star every Monday (00:00 UTC)</b>, forever — no update needed, and it climbs whether you play that week or not. ' +
          (pv.atCap
            ? 'You have used the last star available this week. The next one unlocks in <b>' + untilRaise() + '</b>.'
            : 'You can ascend <b>' + pv.starsLeft + ' more time' + (pv.starsLeft === 1 ? '' : 's') + '</b> before you meet it. The next star arrives in <b>' + untilRaise() + '</b> regardless.') +
        '</p>' +
      '</div>' +

      // THE CALCULATOR — always visible, always live
      // THE WALL — the single clearest reason to ascend, stated before the maths
      '<div class="pa-card">' +
        '<div class="pa-card-h">▲ YOUR LEVEL CEILING<em>' + (atCap ? 'reached' : 'raised by ascending') + '</em></div>' +
        '<p class="pa-note">The pilot record has a hard cap. It is <b>' + fmt(CAP_BASE) + '</b> with no stars and rises <b>+' + CAP_STEP + ' per Ascension Star</b> — ' +
          'this is the wall the prestige loop exists to break. <b>At the cap XP stops accruing entirely</b>: kills still pay gold, resources and loot, but your level will not move again until you ascend. ' +
          '<b>The cap is also the gate</b> — ascension opens the moment you reach it.</p>' +
        '<div class="pa-caps">' +
          [0, 1, 2, 3].map((k) => {
            const st = stars() + k, cp = CAP_BASE + CAP_STEP * st;
            const now = k === 0;
            return '<div class="pa-cap' + (now ? ' now' : '') + '">' +
              '<span class="pa-cap-s">' + (st ? '★' + st : 'NO ★') + '</span>' +
              '<b>Lv ' + fmt(cp) + '</b>' +
              '<em>' + (now ? (atCap ? 'you are AT this cap' : 'your cap now · Lv ' + fmt(S.level)) : '+' + (CAP_STEP * k)) + '</em>' +
            '</div>';
          }).join('') +
        '</div>' +
        (atCap
          ? '<div class="pa-hint hot">✦ <b>You are at Level ' + fmt(S.level) + ' — the ceiling for ★' + stars() + '.</b> Ascending now raises it to <b>Lv ' + fmt(CAP_BASE + CAP_STEP * (stars() + 1)) + '</b> and your XP starts counting again.</div>'
          : '<div class="pa-hint">Ascending once takes your ceiling to <b>Lv ' + fmt(CAP_BASE + CAP_STEP * (stars() + 1)) + '</b>.</div>') +
      '</div>' +

      '<div class="pa-card">' +
        '<div class="pa-card-h">◈ ASCENSION POINT CALCULATOR<em>live</em></div>' +
        '<p class="pa-note">Points are earned from the run you give up. Every line below is counted the moment you ascend — <b>your level is settled at the cap, but zones, systems and badges keep adding to it</b> for as long as you keep flying.</p>' +
        '<div class="pa-calc">' + calcRows + '</div>' +
        '<div class="pa-calc-tot"><span>YOU WILL RECEIVE</span><b>' + pv.total + '</b><em>ascension point' + (pv.total === 1 ? '' : 's') + ' + 1 ★</em></div>' +
        ((Math.floor(pv.lvl / 125) + 1) * 125 <= cap ? '<div class="pa-hint">Every <b>125</b> pilot levels is another <b>' + PT_MULT + '</b> points. At Lv ' + fmt((Math.floor(pv.lvl / 125) + 1) * 125) + ' this becomes <b>' + (pv.total + PT_MULT) + '</b>.</div>' : '') +
      '</div>' +

      // WHAT HAPPENS — the warning, itemised
      '<div class="pa-card warn">' +
        '<div class="pa-card-h">⚠ WHAT ASCENDING DOES<em>permanent</em></div>' +
        '<p class="pa-note">The line is simple: <b>the ships keep what the shipyard gave them, the pilot gives up everything they were carrying.</b></p>' +
        '<div class="pa-ledger">' +
          '<div class="pa-led lose"><div class="pa-led-h">✕ RESET TO ZERO</div><ul>' +
            '<li>Pilot Level → <b>1</b> (and all skill points)</li>' +
            '<li><b>Every item you own</b> — equipped, in the bag, and stowed on escorts</li>' +
            '<li>All Starforge hardpoint tempers &amp; purity</li>' +
            '<li>Your wing — escorts disband (the hulls stay in the hangar, fully upgraded)</li>' +
          '</ul></div>' +
          '<div class="pa-led keep"><div class="pa-led-h">✓ CARRIED OVER</div><ul>' +
            '<li><b>The whole Pilot Tree</b> — every node you unlocked, and every ◇ Dread Core you hold</li>' +
            '<li><b>Every hull in your hangar</b> — nothing is taken from the fleet</li>' +
            '<li><b>Every hull upgrade level</b> — your ships stay exactly as strong as you built them</li>' +
            '<li><b>Every Ship Ascension</b> — module tiers &amp; stars, on <b>every</b> hull</li>' +
            // TERRITORY, HOME CITADEL, PRISM AND THE MOON COLONY SURVIVE. This
            // ledger still listed all four under RESET TO ZERO long after
            // ASC_KEEP started preserving them (ownedSystems / citadels /
            // rivalCitadels / tileCd / razedCitadels / homecit / prism /
            // prismFleet / moon) — the confirm gate had been corrected but this
            // screen had not, so it warned players off a cost that no longer
            // exists. Anything claimed here must be checked against ASC_KEEP.
            // GOLD AND GALAXY RESOURCES SURVIVE (Aug 2026) — see the ASC_KEEP
            // block in game-v93.js. They were listed under RESET TO ZERO here.
            '<li><b>Your gold and every Galaxy Resource</b> — the wallet rides across intact</li>' +
            '<li><b>Your whole galaxy</b> — every claimed system, citadel and Void spire stays yours</li>' +
            '<li><b>Home Citadel</b> — pads, towers and defences, still earning</li>' +
            '<li><b>Moon Colony</b> — every building keeps producing</li>' +
            '<li><b>Prism</b> — rigs, ingots and forged Prism Cores</li>' +
            '<li><b>Nanocores</b> — every core, slot and rolled buff</li>' +
            '<li><b>Tour of Duty</b> — season level, XP and anything you bought</li>' +
            '<li><b>Space Cargo Defense</b> — lifetime record and today’s runs</li>' +
            '<li><b>Voidmaw</b> — Event Coins, ❖ Voidmaw Parts, best stage and board rank</li>' +
            '<li>Ascension Stars &amp; every perk you buy</li>' +
            '<li><b>A higher level ceiling</b> — +' + CAP_STEP + ' max pilot level, every time</li>' +
            '<li>Your <b>mission boards</b> — daily, weekly and monthly carry on mid-cycle</li>' +
            '<li>Lifetime badges &amp; achievements</li>' +
            '<li>Every badge already claimed — <em>chains never reset</em></li>' +
            '<li>Career totals — kills, hours, loot, missions (badges keep counting)</li>' +
            '<li>Premium purchases, Pro, VIP, Loot Coins</li>' +
            '<li>Cosmetics &amp; hangar skins</li>' +
            '<li>Friends, alliance &amp; mail</li>' +
            '<li>Event hulls (Voidmaw, Titan Sina) — <em>they come with you</em></li>' +
          '</ul></div>' +
        '</div>' +
        '<div class="pa-gain">' +
          '<b>+' + pv.total + ' ascension point' + (pv.total === 1 ? '' : 's') + '</b> to spend on permanent account-wide perks' +
          '<br>Your level ceiling rises <b>Lv ' + fmt(CAP_BASE + CAP_STEP * stars()) + ' → Lv ' + fmt(CAP_BASE + CAP_STEP * (stars() + 1)) + '</b>' +
          '<br>Your rank badge becomes <b style="color:' + tierDef(stars() + 1).color + '">' + tierDef(stars() + 1).name + ' ★' + starOf(stars() + 1) + '</b>' +
          (nt ? '<br><b style="color:' + nt.color + '">' + nt.name.toUpperCase() + '</b> loot tier unlocks at ★' + nt.ascReq +
                (stars() + 1 >= nt.ascReq ? ' — <b style="color:#7ce0a0">that is this ascension</b>' : ' — ' + (nt.ascReq - stars() - 1) + ' more after this one') : '') +
          '<br>Top-end odds (Primordial → Artifact) rise to <b>×' + (C().ascTopBoost ? C().ascTopBoost(stars() + 1).toFixed(2) : '1.00') + '</b>' +
        '</div>' +
      '</div>' +

      (locked ? ''
        : '<button class="pa-go alt" id="pa-begin2">✦ BEGIN ASCENSION</button><div class="pa-go-note">Nothing is reset until you confirm on the next screen.</div>') +

      (p.hist.length ? '<div class="pa-card"><div class="pa-card-h">PREVIOUS ASCENSIONS</div>' +
        p.hist.slice(-6).reverse().map((h, i) => '<div class="pa-hist"><span>★ ' + (p.hist.length - i) + '</span><b>Lv ' + fmt(h.lvl) + '</b><em>+' + h.pts + ' pts · ' + (h.ship || '—') + '</em></div>').join('') +
        '</div>' : '');
  }

  // ---- TAB 2 · PERKS ---------------------------------------------------------
  function perksTab() {
    const p = st(), avail = points();
    const cards = PERKS.map((d) => {
      const r = rank(d.k), maxed = r >= MAX_RANK, cost = rankCost(r);
      const can = !maxed && avail >= cost;
      return '<div class="pa-perk' + (r ? ' owned' : '') + '" style="--pc:' + d.col + '">' +
        '<div class="pa-perk-top">' +
          '<span class="pa-perk-ic">' + d.ic + '</span>' +
          '<span class="pa-perk-n"><b>' + d.name + '</b><em>' + d.sub + '</em></span>' +
          '<span class="pa-perk-r">' + r + '<i>/' + MAX_RANK + '</i></span>' +
        '</div>' +
        '<div class="pa-perk-bar"><i style="width:' + (r / MAX_RANK * 100) + '%"></i></div>' +
        '<div class="pa-perk-val">' + (r ? '<b>+' + perkPct(d.k) + '%</b> now' : '<span>not invested</span>') +
          (maxed ? '' : ' <em>→ +' + ((r + 1) * d.per) + '% next</em>') + '</div>' +
        '<div class="pa-perk-d">' + d.desc + '</div>' +
        (maxed
          ? '<div class="pa-perk-max">★ MAXED</div>'
          : '<button class="pa-perk-buy" data-perk="' + d.k + '"' + (can ? '' : ' disabled') + '>' +
              (can ? 'BUY RANK ' + (r + 1) + ' · ' + cost + ' pt' + (cost === 1 ? '' : 's') : 'NEEDS ' + cost + ' pt' + (cost === 1 ? '' : 's')) + '</button>') +
      '</div>';
    }).join('');
    return '<div class="pa-bank"><span>UNSPENT</span><b>' + fmt(avail) + '</b><em>ascension point' + (avail === 1 ? '' : 's') + ' · ' + fmt(spentFromRanks()) + ' invested</em></div>' +
      '<p class="pa-note">Perks are <b>permanent</b>. They survive every future ascension and apply to every run from here on. Rank <i>n</i> costs <i>n</i> points.</p>' +
      '<div class="pa-perks">' + cards + '</div>' + respecCardHTML();
  }

  // ---- TAB 3 · LOOT TIERS ----------------------------------------------------
  // TWO promises, stated plainly — that's the whole system:
  //   1. new rarities that only exist for ascended pilots
  //   2. better odds on the rarities you already farm
  function tiersTab() {
    const n = stars();
    const boost = C().ascTopBoost ? C().ascTopBoost(n) : 1;
    const next = C().ascTopBoost ? C().ascTopBoost(n + 1) : 1;
    const gated = ascTiers();
    const rows = gated.map((r) => {
      const open = n >= r.ascReq;
      return '<div class="pa-tier' + (open ? '' : ' shut') + (r.prismatic ? ' prism' : '') + '" style="--tc:' + r.color + '">' +
        '<span class="pa-tier-dot"></span>' +
        '<span class="pa-tier-n"><b>' + r.name + '</b><em>' + r.minStats + '–' + r.maxStats + ' stats · ×' + r.mult + ' stat rolls</em></span>' +
        '<span class="pa-tier-req">' + (open ? '<b class="ok">UNLOCKED</b>' : '<b>★' + r.ascReq + '</b><i>' + (r.ascReq - n) + ' to go</i>') + '</span>' +
      '</div>';
    }).join('');
    const nt = nextTierAt();
    return '<div class="pa-two">' +
        '<div class="pa-card"><div class="pa-card-h">1 · NEW RARITIES</div>' +
          '<p class="pa-note">Three rarities exist <b>above Artifact</b>. They only drop for ascended pilots — no zone, boss or crate can produce them otherwise. The deep two are a <b>long haul</b>: they are the reason to keep ascending for years.</p>' +
          '<div class="pa-tiers">' + rows + '</div>' +
          (nt ? '<div class="pa-hint">Next: <b style="color:' + nt.color + '">' + nt.name + '</b> at <b>★' + nt.ascReq + '</b> — <b>' + (nt.ascReq - n) + '</b> more ascension' + (nt.ascReq - n === 1 ? '' : 's') + '.</div>'
              : '<div class="pa-hint">All three unlocked — you are among the very few.</div>') +
        '</div>' +
        '<div class="pa-card"><div class="pa-card-h">2 · BETTER TOP-END ODDS</div>' +
          '<p class="pa-note">Every star also raises your chance at <b style="color:#ffe6a8">Primordial</b>, <b style="color:#c061ff">Relic</b> and <b style="color:#ff2330">Artifact</b> — <b>+25% per star</b>, up to <b>5×</b>.</p>' +
          '<div class="pa-odds">' +
            '<div class="pa-odds-now"><span>NOW</span><b>×' + boost.toFixed(2) + '</b><em>' + (n ? '★' + n : 'not ascended') + '</em></div>' +
            '<div class="pa-odds-arr">→</div>' +
            '<div class="pa-odds-next"><span>NEXT ASCENSION</span><b>×' + next.toFixed(2) + '</b><em>★' + (n + 1) + '</em></div>' +
          '</div>' +
          '<div class="pa-odds-bar"><i style="width:' + ((boost - 1) / 4 * 100).toFixed(1) + '%"></i></div>' +
          '<div class="pa-hint">Caps at <b>×5</b> (★16). The <b>Fortune Lattice</b> perk lifts the whole table on top of this.</div>' +
        '</div>' +
      '</div>';
  }

  // ONE INTERVAL FOR THE WHOLE MODULE, and it only touches the countdown node.
  // Re-rendering the tab every second would fight the player's scroll position and
  // rebuild the calculator for nothing; replacing one element's innerHTML does not.
  // It also self-stops when the node leaves the DOM, so switching tabs or closing
  // the screen cannot leave a timer running against a detached tree.
  let _cdTimer = null;
  function startCountdown() {
    if (_cdTimer) return;
    _cdTimer = setInterval(() => {
      const el = $('pa-sc-clock');
      if (!el || !el.isConnected) { clearInterval(_cdTimer); _cdTimer = null; return; }
      const before = capWeeks();
      el.innerHTML = countdownHTML();
      const bar = el.parentNode && el.parentNode.querySelector('.pa-sc-bar i');
      if (bar) bar.style.width = weekPct().toFixed(2) + '%';
      // THE BOUNDARY CROSSED WHILE THEY WATCHED — re-render the whole tab so the
      // new ceiling, the star count and the ascend button all update together.
      if (capWeeks() !== before) render();
    }, 1000);
  }
  function wire(body) {
    if (body.querySelector('#pa-sc-clock')) startCountdown();
    body.querySelectorAll('[data-patab]').forEach((b) => b.onclick = () => { tab = b.dataset.patab; render(); });
    body.querySelectorAll('[data-perk]').forEach((b) => b.onclick = () => buyPerk(b.dataset.perk));
    const rs = $('pa-respec'); if (rs) rs.onclick = respecFlow;
    const go = $('pa-begin'); if (go) go.onclick = ascendFlow;
    const go2 = $('pa-begin2'); if (go2) go2.onclick = ascendFlow;
  }

  // ---- PERK RESPEC — 10,000 LootCoins ----------------------------------------
  // Refunds every point invested in perks so it can be spent again. Deliberately
  // heavy: perks are permanent and ride every future ascension, so re-picking
  // them is a real decision and the price says so.
  //
  // BUG-PROOFING, in the order the failures would actually happen:
  //   · ONE AT A TIME. `_respecBusy` stops a double-tap (or a second tab) from
  //     charging twice — the confirm sheet is async, so the window is real.
  //   · NOTHING TO REFUND, NOTHING TO CHARGE. A player with no ranks cannot be
  //     sold a reset that does nothing.
  //   · CHARGE ONLY AFTER THE BALANCE IS RE-CHECKED. The sheet can sit open while
  //     LootCoins are spent elsewhere, so affordability is tested again at the
  //     moment of the write, not when the button was drawn.
  //   · Math.floor(Number(x) || 0) on the balance, never `| 0` — a wallet past
  //     2.1 billion wraps NEGATIVE through a bitwise coercion and the check would
  //     pass for someone who is rich rather than poor.
  //   · THE WRITE IS ORDERED: take payment, zero the perks, then bank the refund.
  //     If anything threw between steps the player would be left with fewer perks
  //     and no points, so the whole mutation is synchronous with no awaits in it.
  //   · `spent` is reset to 0 because the ranks it described are gone — leaving a
  //     stale figure there is what would make a SECOND respec refund phantom
  //     points.
  let _respecBusy = false;
  function respecCost() { return RESPEC_LC; }
  function canRespec() {
    const p = st(); if (!p) return { ok: false, why: 'none' };
    if (spentFromRanks() <= 0) return { ok: false, why: 'nothing' };
    const bal = Math.floor(Number(G().state.credits) || 0);
    if (bal < RESPEC_LC) return { ok: false, why: 'credits', short: RESPEC_LC - bal };
    return { ok: true };
  }
  function doRespec() {
    if (_respecBusy) return false;
    const p = st(); if (!p) return false;
    const refund = spentFromRanks();
    if (refund <= 0) { toast('No perk points to reset'); return false; }
    const g = G();
    const bal = Math.floor(Number(g.state.credits) || 0);
    if (bal < RESPEC_LC) { toast('Need ◈ ' + lc(RESPEC_LC - bal) + ' more LootCoins'); return false; }
    _respecBusy = true;
    try {
      g.state.credits = bal - RESPEC_LC;      // paid
      p.perks = {};                            // ranks cleared
      p.pts = Math.max(0, Math.floor(Number(p.pts) || 0)) + refund;   // banked
      p.spent = 0;                             // the tally the ranks described is gone
      try { g.refreshStats(); } catch (e) {}
      try { g.save(); } catch (e) {}
      try { if (window.ACCOUNT && window.ACCOUNT.flushNow) window.ACCOUNT.flushNow(); } catch (e) {}
      if (window.UI && window.UI.refreshAll) window.UI.refreshAll();
      render();
      toast('✦ ' + fmt(refund) + ' ascension point' + (refund === 1 ? '' : 's') + ' returned — respend them freely');
      return true;
    } finally { _respecBusy = false; }
  }
  function respecFlow() {
    const c = canRespec();
    if (!c.ok) {
      if (c.why === 'nothing') toast('You have no perk ranks to reset');
      else if (c.why === 'credits') toast('Need ◈ ' + lc(c.short) + ' more LootCoins');
      return;
    }
    const refund = spentFromRanks();
    const ranks = (() => { const p = st(); let n = 0; for (const k in p.perks) n += Math.max(0, Math.floor(Number(p.perks[k]) || 0)); return n; })();
    const body = 'Every perk drops to <b>rank 0</b> and <b>' + fmt(refund) + '</b> ascension point'
      + (refund === 1 ? '' : 's') + ' return to your bank, ready to spend again.'
      + '<br><br>You are clearing <b>' + fmt(ranks) + '</b> rank' + (ranks === 1 ? '' : 's')
      + ' across your perks. Your <b>stars, loot tiers and Pilot Tree are untouched</b> — this resets perks only.'
      + '<br><br>Cost: <b style="color:#ffd66a">◈ ' + lc(RESPEC_LC) + ' LootCoins</b>. Not refundable.';
    if (window.SOCIAL && window.SOCIAL.confirmSheet) window.SOCIAL.confirmSheet('Reset every perk?', body, doRespec);
    else if (window.confirm('Reset every perk for ' + RESPEC_LC + ' LootCoins? ' + refund + ' points are returned.')) doRespec();
  }

  // The respec offer sits at the FOOT of the perks tab, not the top: it is the
  // thing you want after you have read your build, not before.
  // MONEY IS PRINTED EXACTLY, NEVER ABBREVIATED. fmt() is formatNum(), which
  // renders 9,999 · 10,000 · 10,001 all as "10K" — so a player one coin short read
  // "you hold 10K — 10K · 1 short" on the same card, and someone who COULD afford
  // it could not tell from the button. Every other purchase surface in the game
  // prints the true figure; this one now does too.
  const lc = (n) => Math.floor(Number(n) || 0).toLocaleString();
  function respecCardHTML() {
    const refund = spentFromRanks();
    if (refund <= 0) return '';
    const bal = Math.floor(Number(G().state.credits) || 0);
    const afford = bal >= RESPEC_LC;
    return '<div class="pa-respec">' +
      '<div class="pa-rs-h">⟳ RESET PERKS</div>' +
      '<p class="pa-rs-s">Return all <b>' + fmt(refund) + '</b> invested point' + (refund === 1 ? '' : 's') +
        ' to your bank and pick a different build. Stars, loot tiers and the Pilot Tree are untouched.</p>' +
      '<button class="pa-rs-go' + (afford ? '' : ' cant') + '" id="pa-respec">◈ ' + lc(RESPEC_LC) + ' LootCoins</button>' +
      (afford ? '' : '<div class="pa-rs-need">You hold ◈ ' + lc(bal) + ' — ' + lc(RESPEC_LC - bal) + ' short</div>') +
    '</div>';
  }

  function buyPerk(k) {
    const p = st(), d = PERK_BY_K[k]; if (!p || !d) return;
    const r = rank(k); if (r >= MAX_RANK) return;
    const cost = rankCost(r);
    if (p.pts < cost) return;
    p.pts -= cost; p.spent = (p.spent | 0) + cost; p.perks[k] = r + 1;
    try { G().refreshStats(); G().save(); } catch (e) {}
    if (window.UI && window.UI.refreshAll) window.UI.refreshAll();
    // REPAINT THIS SCREEN. refreshAll() rebuilds the shell, not the perk board,
    // so without this the bank and every "rank n costs n" line keep showing the
    // pre-purchase figures until the tab is left and re-entered.
    render();
    toast(d.ic + ' ' + d.name + ' → rank ' + (r + 1) + ' (+' + perkPct(k) + '%)', d.col);
    render();
  }
  function toast(m, c) { try { window.UI.toast ? window.UI.toast(m, c) : window.UI.unlockToast(m); } catch (e) {} }

  // ===========================================================================
  // THE ASCEND FLOW — flagship pick → confirm ledger → cinematic
  // ===========================================================================
  function overlay() {
    let o = $('pa-overlay');
    if (!o) { o = document.createElement('div'); o.id = 'pa-overlay'; ($('screen-pasc') || document.body).appendChild(o); }
    return o;
  }
  function closeOverlay() { const o = $('pa-overlay'); if (o) { o.className = ''; o.innerHTML = ''; } }


  // ===========================================================================
  // THE CONFIRM — ONE screen.
  // ---------------------------------------------------------------------------
  // This used to be two steps. Step 1 asked you to pick a flagship, which stopped
  // being a decision the moment every hull started coming with you: the picker
  // chose which ship you happen to be sitting in afterwards, and dressed it up as
  // a choice. It's gone. You fly out in whatever you're flying now, and you can
  // switch in the Hangar a second later like any other day.
  //
  // The copy was also out of date and telling players the opposite of the truth.
  // It read "you lose N claimed systems · all citadels & Void spires". Territory
  // now survives, and so do the Moon Colony, the Home Citadel and Prism. Anyone
  // reading that screen was being warned off a cost that no longer exists.
  //
  // One rule for what goes in each column: KEPT is anything you BUILT — hulls,
  // ground, infrastructure, career record. LOST is anything you were CARRYING —
  // level, currency, items, the tree those items feed.
  // ===========================================================================
  function ascendFlow() {
    const pv = preview();
    // The cap is enforced HERE as well as in the button state — the flow is also
    // reachable from the gate toast, and a ceiling that only exists in the UI is
    // not a ceiling.
    if (pv.atCap) {
      try { G().toast ? G().toast('✦ ★' + pv.starCap + ' is this week’s ceiling — ★' + nextCap() + ' in ' + untilRaise()) : 0; } catch (e) {}
      return;
    }
    if (!pv.clockOk) {
      // Try once more before refusing — a dropped first sync is the common case.
      try { if (ST()) ST().sync(true); } catch (e) {}
      try { G().toast ? G().toast('○ Checking the clock — one moment, then try again.') : 0; } catch (e) {}
      return;
    }
    if (!pv.eligible) return;
    const S = G().state, o = overlay(); o.className = 'show';
    const key = S.ship, sh = C().SHIP_BY_KEY[key] || {};
    const nt = nextTierAt();
    const willUnlock = nt && stars() + 1 >= nt.ascReq ? nt : null;
    const zone = Math.max(S.highestDungeonReached | 0, S.highestUnlocked | 0, 1);
    const hulls = Object.keys(S.ownedShips || {}).length;
    const tiles = Object.keys(S.ownedSystems || {}).length;

    const hasAxiom = !!(window.AXIOM && window.AXIOM.owned());
    const keep = [
      ['\u2b22', '<b>All ' + hulls + ' hull' + (hulls === 1 ? '' : 's') + '</b> \u2014 upgrade levels and Ship Ascensions intact'],
      ['\u25c7', '<b>Your Pilot Tree</b> \u2014 every node and every Dread Core'],
      ['\u2691', tiles ? '<b>All ' + tiles + ' system' + (tiles === 1 ? '' : 's') + '</b> \u2014 citadels and Void spires stay yours' : 'Any territory you hold'],
      ['$', '<b>Your gold and every Galaxy Resource</b> \u2014 the wallet is untouched'],
      ['\u25d0', 'Moon Colony, Home Citadel and Prism \u2014 still producing'],
      ['\u2756', 'Voidmaw \u2014 Event Coins, parts and best stage'],
      ['\u2b21', 'Badges, career totals and mission boards'],
      ['\u25c8', 'Everything you paid for'],
    ];
    // the one exception to "every item is surrendered"
    if (hasAxiom) keep.splice(1, 0, ['\u229b', '<b>Evolving Paragon Cannon</b> \u2014 the only item you keep, rescaled to Level 1']);
    const lose = [
      ['\u25b2', '<b>Level ' + fmt(S.level) + ' \u2192 1</b> and Zone ' + fmt(zone) + ' progress'],
      ['\u2756', (hasAxiom ? 'Every other item' : 'Every item') + ' \u2014 equipped, in the bag, and Starforge tempers'],
      ['\u27a4', 'Your wing disbands \u2014 escort slots re-earn with level'],
    ];
    const row = (a) => a.map((x) => '<li><i>' + x[0] + '</i><span>' + x[1] + '</span></li>').join('');

    o.innerHTML = '<div class="pa-modal danger">' +
      '<div class="pa-mh"><b>\u2726 ASCEND</b><em>this cannot be undone</em></div>' +
      '<div class="pa-gain">' +
        '<div class="pa-gain-i"><b>+' + pv.total + '</b><span>point' + (pv.total === 1 ? '' : 's') + '</span></div>' +
        '<div class="pa-gain-i"><b>' + tierDef(stars() + 1).name + ' \u2605' + starOf(stars() + 1) + '</b><span>new rank</span></div>' +
        '<div class="pa-gain-i"><b>' + (150 + 50 * (stars() + 1)) + '</b><span>level cap</span></div>' +
      '</div>' +
      (willUnlock ? '<div class="pa-unlock-pre" style="--tc:' + willUnlock.color + '">\u2726 Unlocks the <b>' + willUnlock.name.toUpperCase() + '</b> loot tier</div>' : '') +
      '<div class="pa-conf">' +
        '<div class="pa-conf-side keep"><span>YOU KEEP</span><ul>' + row(keep) + '</ul></div>' +
        '<div class="pa-conf-side lose"><span>YOU LOSE</span><ul>' + row(lose) + '</ul></div>' +
      '</div>' +
      '<div class="pa-flag"><img src="ships/ship-' + key + '.png" alt="">' +
        '<div><b>' + (sh.name || 'Your flagship') + '</b><em>You warp out in the hull you\u2019re flying \u2014 swap any time in the Hangar</em></div></div>' +
      '<label class="pa-ack"><input type="checkbox" id="pa-ack">' +
        '<span class="pa-ack-t">I understand \u2014 back to <b>Level 1</b>, and I lose <b>every item I am carrying</b>.</span></label>' +
      '<div class="pa-mb"><button class="pa-btn ghost" data-x>Cancel</button>' +
      '<button class="pa-btn danger" id="pa-do" disabled>\u2726 ASCEND</button></div>' +
    '</div>';
    o.querySelector('[data-x]').onclick = closeOverlay;
    // Scope the lookups to the overlay, and read the LIVE checkbox on click —
    // a stale/duplicate #pa-ack elsewhere in the document would otherwise gate
    // the button on the wrong node.
    const ack = o.querySelector('#pa-ack'), doBtn = o.querySelector('#pa-do');
    ack.onchange = () => { doBtn.disabled = !ack.checked; };
    doBtn.onclick = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      if (!ack.checked) { doBtn.disabled = true; return; }
      cinematic(key, pv);
    };
  }

  // ===========================================================================
  // THE CINEMATIC — charge → collapse → flash → star → unlock → arrive
  // Runs the real reset at the flash, so the level counter genuinely lands on 1.
  // ===========================================================================
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function cinematic(key, pv) {
    const o = overlay(), sh = C().SHIP_BY_KEY[key] || {};
    const fromLvl = G().state.level | 0;
    const newStars = stars() + 1;
    // Server-stamped, so the ladder can be audited later (one star per UTC week
    // since the epoch) without a schema change now. tnow() is the trusted clock.
    const ascAt = Math.floor(tnow());
    const unlocked = ascTiers().find((r) => r.ascReq === newStars) || null;
    o.className = 'show cine';
    o.innerHTML =
      '<div class="pa-cine" id="pa-cine">' +
        '<div class="pa-cine-warp" id="pa-warp"></div>' +
        '<div class="pa-cine-core"><i></i><i></i><i></i><i></i></div>' +
        '<img class="pa-cine-ship" id="pa-cship" src="ships/ship-' + key + '.png" alt="">' +
        '<div class="pa-cine-lvl" id="pa-lvl">' + fromLvl + '</div>' +
        '<div class="pa-cine-cap" id="pa-cap">DISCHARGING PILOT RECORD</div>' +
        '<div class="pa-cine-star" id="pa-cstar">★</div>' +
        '<div class="pa-cine-out" id="pa-out"></div>' +
      '</div>' +
      '<button class="pa-skip" id="pa-skip">Skip</button>';

    const cine = $('pa-cine'), lvlEl = $('pa-lvl'), cap = $('pa-cap');
    cine.style.setProperty('--tc', tierDef(newStars).color);
    let done = false, timers = [];
    const at = (ms, fn) => timers.push(setTimeout(fn, reduced() ? Math.min(ms, 300) : ms));

    // build the warp streaks
    if (!reduced()) {
      const warp = $('pa-warp');
      for (let i = 0; i < 46; i++) {
        const s = document.createElement('i');
        s.style.cssText = 'left:' + (Math.random() * 100).toFixed(1) + '%;top:' + (Math.random() * 100).toFixed(1) +
          '%;animation-delay:' + (Math.random() * 1.4).toFixed(2) + 's;--l:' + (30 + Math.random() * 90).toFixed(0) + 'px';
        warp.appendChild(s);
      }
    }

    const finish = () => {
      if (done) return; done = true;
      timers.forEach(clearTimeout);
      // the actual reset — idempotent, guarded inside GAME
      const res = G().pilotAscend(key, pv.total);
      // publish the new star immediately — otherwise the pilot's public row keeps
      // the old rank (and their badge stays invisible to everyone else) until the
      // next queued cloud flush
      try { if (window.ACCOUNT && window.ACCOUNT.flushNow) window.ACCOUNT.flushNow(); } catch (x) {}
      cine.classList.add('arrived');
      lvlEl.textContent = '1';
      cap.textContent = 'ASCENSION COMPLETE';
      $('pa-cstar').classList.add('in');
      $('pa-out').innerHTML =
        '<div class="pa-out-star">' + badge(null, newStars, { tier: true }) + '</div>' +
        '<div class="pa-out-t">ASCENSION ' + newStars + '</div>' +
        '<div class="pa-out-rows">' +
          '<div><b>+' + pv.total + '</b><em>ascension point' + (pv.total === 1 ? '' : 's') + '</em></div>' +
          '<div><b>Lv 1</b><em>a clean record</em></div>' +
          '<div><b>' + (sh.name || '—') + '</b><em>flagship · fleet fully upgraded</em></div>' +
        '</div>' +
        (unlocked ? '<div class="pa-out-unlock" style="--tc:' + unlocked.color + '">' +
          '<span>NEW LOOT TIER UNLOCKED</span><b>' + unlocked.name.toUpperCase() + '</b>' +
          '<em>' + unlocked.minStats + '–' + unlocked.maxStats + ' stats · ×' + unlocked.mult + ' rolls · drops from now on</em></div>' : '') +
        '<button class="pa-btn go" id="pa-out-go">SPEND YOUR POINTS →</button>';
      $('pa-out-go').onclick = () => { closeOverlay(); tab = 'perks'; render(); };
      const sk = $('pa-skip'); if (sk) sk.remove();
      if (window.UI && window.UI.refreshAll) window.UI.refreshAll();
    };

    $('pa-skip').onclick = finish;

    // phase 1 — charge
    at(60, () => cine.classList.add('charge'));
    // phase 2 — the level counter unwinds
    at(1100, () => {
      cap.textContent = 'COLLAPSING ' + fromLvl + ' LEVELS';
      cine.classList.add('collapse');
      if (reduced()) { lvlEl.textContent = '1'; return; }
      const t0 = performance.now(), dur = 2100;
      const step = () => {
        if (done) return;
        const k = Math.min(1, (performance.now() - t0) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        lvlEl.textContent = Math.max(1, Math.round(fromLvl - (fromLvl - 1) * e));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    // phase 3 — white-out
    at(3300, () => { cine.classList.add('flash'); cap.textContent = 'REWRITING THE RECORD'; });
    // phase 4 — arrive
    at(4100, finish);
  }

  // ---- BOOT ------------------------------------------------------------------
  // A late first sync must repaint: the card renders before the anchor lands, so
  // without this it would sit on "syncing…" until the next tab switch.
  try { if (window.SERVERTIME) window.SERVERTIME.onSync(() => { if ($('pa-sc-clock')) render(); }); } catch (e) {}

  window.PASCEND = {
    starCap, starsLeft, atStarCap, nextCap, nextRaiseAt, untilRaise, capWeeks,
    clockTrusted, clockUsable, clockMode, serverNow: tnow, weekPct,
    render, stars, points, mult, preview, PERKS, rank, perkPct,
    beaconMods,
    badge, plain, tierOf, starOf, tierDef, gateLv, capLv,
    unlockedTiers: () => ascTiers().filter((r) => stars() >= r.ascReq).map((r) => r.key),
    nameSuffix: () => plain(),
  };
})();
