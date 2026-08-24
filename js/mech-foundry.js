/* =============================================================================
   mech-foundry.js — LOOTFLEET · THE MECH FOUNDRY (Command ▸ Mech Foundry)
   -----------------------------------------------------------------------------
   The Mech faction's home, and the only place Mech hulls can be earned.

   Five tiers, one per Mech class, each a wave gauntlet into a Mech-held zone
   ending on that class's boss. Clearing a tier pays ⚙ Mech Cores; the first
   clear of the top two tiers hands over the blueprint for that hull.

       T1  SPAWN NEST        Lv 120     T4  ARCHON SPIRE   Lv 420  → Archon BP
       T2  GREMLIN WARRENS   Lv 200     T5  TITAN FORGE    Lv 550  → Titan BP
       T3  BEAST PIT         Lv 300

   OPT-IN AND UNLOCKED FOREVER. There is no lockout clock, no daily allowance and
   no entry toll, which is a deliberate simplification: a lockout is a calendar,
   a calendar has to live in ASC_KEEP the day it ships, and every clock this game
   has added has eventually been found missing from that list. The grind is the
   core cost, and cores are earned by playing rather than by waiting.

   ---------------------------------------------------------------------------
   THE RUN IS THE REAL BATTLE ENGINE. `state.mechRun` arms a wave gauntlet in
   game-v93 exactly the way the Dreadnaught Hunt does — same deploy branch, same
   updateWaveZone, same boss handoff. Nothing here simulates combat.

   ---------------------------------------------------------------------------
   SAVE SHAPE (and why each piece is treated the way it is)

     state.mechCores   ⚙ SPENDABLE WALLET. In ASC_KEEP, and deliberately NOT
                       unioned in mergeSaves() — account.js is explicit that
                       max-winning a wallet against a copy that has not spent yet
                       is the `pasc.pts` duplication bug. The base pick decides
                       it, and saveWeight() carries a term so a core-holding save
                       is not judged the lighter one.

     state.mech        THE RECORD — { best, runs, kills }. Monotonic, never
                       spent, so it IS unioned field-by-field: a record cannot be
                       re-earned and the losing copy's version would be gone.

     state.mechRun     Live run only. Never a source of truth after the run ends.

   The HULLS themselves need no new merge code: `blueprints` and `ownedShips` are
   already unioned entitlements, so a hull earned on one device survives any
   merge from another.

   window.MECHF
     render()                  paint the screen
     unlocked() / tiers()      the ladder + gates
     start(t) / onRunCleared(t)  deploy and settle
     onMechKill()              lifetime counter
     cores() / bossFor(t)      wallet + boss spec for the engine
   ========================================================================== */
(function () {
  'use strict';
  const G = () => window.GAME;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => { try { return G().formatNum(n); } catch (e) { return String(Math.floor(n || 0)); } };
  // Never `| 0` a balance or a payout — signed 32-bit wrap turns a deep wallet
  // negative, and cores are earned in the thousands over a career.
  const num = (x) => Math.floor(Number(x) || 0);

  // ---- THE LADDER -----------------------------------------------------------
  // `zone` is what the run deploys into, and it is priced off the TIER rather
  // than off the pilot — which is exactly why the run is in the XP carve-out in
  // game-v93. The Foundry pays cores, loot and gold; it does not pay levels.
  // `asc` is the PILOT ASCENSION STARS required to make the landing, on top of the
  // level gate. Verath takes none — the Foundry has to be reachable by a pilot who
  // has never ascended, or its own unlock level is a lie. Everything past it is
  // prestige-gated, which is why the level requirements stay modest: a ★5 pilot
  // has a cap of 400, so Korrus at 200 is comfortably inside their run rather than
  // a second wall behind the first.
  const TIERS = [
    { t: 1, key: 'mspawn',   lv: 120, asc: 0,  zone: 150, waves: 12, cores: 12,  col: '#c2323f', bp: 'mechspawn' },
    { t: 2, key: 'mgremlin', lv: 200, asc: 5,  zone: 220, waves: 14, cores: 30,  col: '#d13645', bp: 'mechgremlin' },
    { t: 3, key: 'mbeast',   lv: 300, asc: 10, zone: 320, waves: 16, cores: 70,  col: '#e03a4c', bp: 'mechbeast' },
    { t: 4, key: 'marchon',  lv: 420, asc: 15, zone: 430, waves: 18, cores: 160, col: '#f04455', bp: 'mecharchon' },
    { t: 5, key: 'mtitan',   lv: 550, asc: 20, zone: 560, waves: 20, cores: 380, col: '#ff4d5e', bp: 'mechtitan' },
  ];
  const TIER_BY_N = {};
  TIERS.forEach((x) => { TIER_BY_N[x.t] = x; });
  // The planet a tier lands on, read off C.MECHS — name, corruption stage and the
  // palette the battlefield is painted from. Never restated here.
  const worldOf = (x) => (((CFG().MECH_BY_KEY || {})[x.key] || {}).world) || null;
  const planetName = (x) => (worldOf(x) || {}).name || 'Unknown World';

  // ---- THE ATTACK WINDOWS ---------------------------------------------------
  // Each planet can be assaulted for ONE HOUR out of every SIX. The five windows
  // are STAGGERED across the cycle rather than opening together: 6h / 5 planets is
  // 72 minutes apart, so each world still follows the stated rule exactly while
  // the Foundry as a whole is live for five hours out of every six. Opening them
  // simultaneously would satisfy the same rule and leave the event dark 20 hours
  // a day, which is a worse game for an identical sentence.
  //
  // THIS IS A PURE FUNCTION OF THE CLOCK. Nothing about the schedule is stored,
  // so there is no new save key, nothing to migrate, and nothing that has to be
  // named in ASC_KEEP — the standing trap for every lockout this game has added.
  // It is also identical on every device and for every player, which is what makes
  // "Korrus opens in 41m" a fact rather than one client's opinion.
  //
  // Anchored to the UTC epoch and read off SERVER time where we have it, so a
  // device with a wrong clock cannot open a window early or miss one.
  const CYCLE_MS = 6 * 3600 * 1000;
  const WINDOW_MS = 1 * 3600 * 1000;
  const STAGGER_MS = CYCLE_MS / 5;
  function nowMs() {
    try { if (window.SERVERTIME && window.SERVERTIME.now) return window.SERVERTIME.now(); } catch (e) {}
    return Date.now();
  }
  function windowOf(x, now) {
    now = now || nowMs();
    const since = (((now - (x.t - 1) * STAGGER_MS) % CYCLE_MS) + CYCLE_MS) % CYCLE_MS;
    const open = since < WINDOW_MS;
    return { open, ms: open ? WINDOW_MS - since : CYCLE_MS - since };
  }
  // hh:mm:ss for anything under an hour, else Xh Ym — a countdown the player reads
  // at a glance, not a duration they have to parse.
  function dur(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm';
    return String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  }
  // The soonest thing that happens on a world THIS PILOT CAN ACTUALLY ENTER.
  //
  // This used to loop all five tiers with no level filter, so a Level 150 pilot —
  // who has unlocked exactly one world — was told Sethyr was "IN RANGE NOW" and
  // handed a countdown for a world 270 levels away, while the only number they
  // needed (when Verath opens) appeared nowhere in the strip that exists to answer
  // "when can I play?". tierOpen() was already right there.
  function nextEvent() {
    const now = nowMs();
    const mine = TIERS.filter(tierOpen);
    let best = null;
    for (const x of mine) {
      const w = windowOf(x, now);
      if (!best || w.ms < best.w.ms) best = { x, w };
    }
    return { best, anyOpen: mine.filter((x) => windowOf(x, now).open), mine };
  }

  // ---- BUILD COSTS ----------------------------------------------------------
  // Blueprint gates the hull; Galaxy Resources and cores build it. The blueprint
  // is not consumed (it never is anywhere in this game) — it is the licence.
  // ---- THE FOUNDRY STORE ----------------------------------------------------
  // The store IS the hulls — all five of them, one per tier. Cores have exactly
  // one sink and it is the thing the whole event exists to hand over: no resource
  // caches, no cross-currency exchange. A rate between two currencies is a
  // permanent balance commitment and the cheapest way to devalue whichever side
  // turns out to be easier to farm, and a store that sells POWER would make the
  // Foundry a second economy to balance against every other one.
  //
  // The blueprint is the LICENCE, not the price: it gates the shelf, is recovered
  // on that hull's own tier, and is never consumed.
  //
  // Cores were multiplied ×10 across every rung at once (Aug 2026) — see the note
  // below on why the ladder moves as a whole and never one tier at a time.
  //
  // Prices hold the same SHAPE at every rung — each hull is a fixed number of
  // clears of its own tier — so no hull is skippable by grinding an easier one.
  // The whole ladder was multiplied by 10 in one step so those ratios survived:
  // moving a single rung is what turns a ladder into a wall in one place.
  const BUILD = {
    mechspawn:   { cores: 15000,  res: { fuel: 20000000,  iron: 8000000,  plasma: 4000000 } },
    mechgremlin: { cores: 32000,  res: { fuel: 48000000,  iron: 20000000, plasma: 11000000 } },
    mechbeast:   { cores: 64000,  res: { fuel: 110000000, iron: 45000000, plasma: 26000000 } },
    // THE TWO APEX HULLS carry double the ladder's cores and resources AND a
    // LootCoin price. That makes them the only Mech hulls with a paid component,
    // which is a deliberate line: the first three are earnable start to finish by
    // playing, and nothing about the corruption mechanic is gated behind money —
    // a Beast still feeds the same pool. What LootCoins buy here is the top of the
    // ladder, not access to the faction.
    mecharchon:  { cores: 240000, res: { fuel: 440000000,  iron: 180000000, plasma: 110000000 }, lc: 50000 },
    mechtitan:   { cores: 800000, res: { fuel: 1200000000, iron: 520000000, plasma: 320000000 }, lc: 50000 },
    // THE CAPSTONE — 5× the Titan on every line. `req` replaces the blueprint gate:
    // there is no sixth world, so what unlocks it is owning the whole line. That
    // makes it the one hull in the game whose price is the other five.
    mechsovereign: { cores: 4000000, res: { fuel: 6000000000, iron: 2600000000, plasma: 1600000000 }, lc: 250000,
      req: ['mechspawn', 'mechgremlin', 'mechbeast', 'mecharchon', 'mechtitan'] },
  };
  const BUILD_ORDER = ['mechspawn', 'mechgremlin', 'mechbeast', 'mecharchon', 'mechtitan', 'mechsovereign'];

  const st = () => G().state;
  // CONFIG IS A GLOBAL, NOT A MEMBER OF GAME. Every lookup in this file used to
  // read `G().C.SHIP_BY_KEY` — GAME has no `C`, so each one threw, each one was
  // swallowed by its own catch, and the failure showed up as an EMPTY STORE and
  // every tier card reading "Mech boss" from its fallback. A bare catch around a
  // lookup hides a coding error exactly as well as it hides a missing key, which
  // is why this is now one accessor that either works everywhere or nowhere.
  const CFG = () => window.CONFIG || {};
  const shipOf = (k) => (CFG().SHIP_BY_KEY || {})[k] || null;

  // ---- STYLES ---------------------------------------------------------------
  // Module-injected so the Foundry ships as one file. Every card uses min-height
  // rather than a fixed height with overflow:hidden — the fit contract's standing
  // rule, and the reason a long hull name cannot clip its own title on a phone.
  (function injectCss() {
    if (document.getElementById('mf-css')) return;
    const s = document.createElement('style');
    s.id = 'mf-css';
    s.textContent = [
      '#mech-body{display:flex;flex-direction:column;gap:15px}',
      // COMMAND CARD THUMBNAIL. `.mc-ic` is a 38px BORDER-BOX square and
      // `.mega-card` forces its own padding/flex with !important, so the art is
      // sized to fill its tile rather than left to an intrinsic size — an <img>
      // with no dimensions would claim whatever it liked and shove the text
      // column, the same way a viewBox-only <svg> falls back to 300×150.
      '.mega-card .mc-ic.mc-art{padding:0;overflow:hidden}',
      '.mega-card .mc-ic.mc-art img{width:100%;height:100%;object-fit:contain;display:block;filter:drop-shadow(0 0 4px #ff4d5e88)}',
      '.mf-hero{display:flex;gap:14px;align-items:center;background:radial-gradient(120% 140% at 12% 0%,#3a1218 0%,#1a0d12 60%,#140a0e 100%);border:1px solid #ff4d5e55;border-radius:14px;padding:14px 16px;min-height:0}',
      '.mf-hero-art{width:88px;flex:0 0 88px;height:auto;object-fit:contain;filter:drop-shadow(0 0 14px #ff4d5e55)}',
      '.mf-hero-tx{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:5px}',
      '.mf-hero-k{font:800 13px/1 Rajdhani,sans-serif;letter-spacing:.18em;color:#ff4d5e}',
      '.mf-hero-q{font:700 21px/1.3 Rajdhani,sans-serif;color:#fff;text-wrap:pretty}',
      '.mf-hero-b{font-size:15px;line-height:1.55;color:#c4cfe0;text-wrap:pretty}',
      '.mf-hero-b b{color:#ffb0ba}',
      '@media (max-width:520px){.mf-hero{flex-direction:column;text-align:center}.mf-hero-art{width:64px;flex:0 0 auto}.mf-hero-tx{align-items:center}}',
      '.mf-wallet{display:flex;align-items:center;gap:11px;background:linear-gradient(180deg,#2a1216,#1a0d10);border:1px solid #ff4d5e44;border-radius:12px;padding:15px 17px;min-height:64px;flex-wrap:wrap}',
      '.mf-w-ic{font-size:26px;color:#ff4d5e;line-height:1}',
      '.mf-w-n{font:800 30px/1 Rajdhani,sans-serif;color:#fff}',
      '.mf-w-l{font:700 13px/1 Rajdhani,sans-serif;letter-spacing:.14em;color:#ff8a9a;align-self:flex-end;padding-bottom:2px}',
      '.mf-w-r{margin-left:auto;font:600 14px/1.35 Rajdhani,sans-serif;color:#9fb0c4;text-align:right;min-width:0}',
      '.mf-note{font-size:14.5px;line-height:1.55;color:#b8c4d8;text-wrap:pretty}',
      '.mf-sec{font:800 14px/1 Rajdhani,sans-serif;letter-spacing:.16em;color:#7d8ba0;margin-top:4px}',
      '.mf-winbar{display:flex;flex-direction:column;gap:12px;background:radial-gradient(120% 90% at 50% 0%,#1c1220 0%,#121821 55%,#0f141c 100%);border:1px solid #2a3546;border-left:4px solid #ff8a3d;border-radius:14px;padding:16px 18px}',
      '.mf-wb-head{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.mf-orbit{width:100%;max-width:620px;align-self:center;height:auto;display:block;aspect-ratio:1000/640}',
      '.mf-wb-foot{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;border-top:1px solid #2a3546;padding-top:12px}',
      '.mf-wb-cell{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1 1 140px}',
      '.mf-wb-cell.right{text-align:right;align-items:flex-end}',
      '.mf-wb-l{flex:1 1 260px;min-width:0;display:flex;flex-direction:column;gap:3px}',
      '.mf-wb-k{font:800 13px/1 Rajdhani,sans-serif;letter-spacing:.16em;color:#ff8a3d}',
      '.mf-wb-s{font-size:14.5px;line-height:1.5;color:#9fb0c4;text-wrap:pretty}',
      '.mf-wb-s b{color:#e6edf7}',
      '.mf-wb-r{flex:0 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px;text-align:right;margin-left:auto}',
      '.mf-wb-live{font:800 11px/1 Rajdhani,sans-serif;letter-spacing:.14em;color:#59d98c}',
      '.mf-wb-live.off{color:#7d8ba0}',
      '.mf-wb-n{font:700 16px/1.3 Rajdhani,sans-serif;color:#fff}',
      '.mf-wb-next{font-size:14px;line-height:1.45;color:#9fb0c4}',
      '.mf-wb-next b{color:#ffb0ba}',
      '.mf-planet{width:44px;height:44px;flex:0 0 44px;border-radius:50%;position:relative;overflow:hidden;background:radial-gradient(circle at 32% 28%,var(--pg) 0%,var(--ps) 82%);box-shadow:0 0 11px -2px var(--pv),inset -6px -6px 13px rgba(0,0,0,.62)}',
      '.mf-planet::after{content:"";position:absolute;inset:0;border-radius:50%;opacity:.9;background:radial-gradient(circle at 61% 69%,var(--pv) 0 2px,transparent 3px),radial-gradient(circle at 36% 63%,var(--pv) 0 1.5px,transparent 2.5px),radial-gradient(circle at 49% 41%,var(--pv) 0 1.5px,transparent 2.5px),radial-gradient(circle at 70% 45%,var(--pv) 0 1px,transparent 2px)}',
      '.mf-c-w{display:flex;align-items:center;gap:6px}',
      '.mf-c-asc{font:800 11px/1 Rajdhani,sans-serif;letter-spacing:.08em;color:#ffd24d;border:1px solid #ffd24d55;border-radius:4px;padding:4px 6px}',
      '.mf-c-asc.ok{color:#8fe0ac;border-color:#59d98c55}',
      '.mf-c-stage{font:800 11px/1 Rajdhani,sans-serif;letter-spacing:.12em;color:var(--mfc,#ff4d5e);border:1px solid currentColor;border-radius:4px;padding:3px 5px;opacity:.9}',
      '.mf-win{font:700 14px/1.4 Rajdhani,sans-serif;color:#9fb0c4;border:1px solid #2a3546;border-radius:6px;padding:9px 11px}',
      '.mf-win b{color:#e6edf7}',
      '.mf-win.live{color:#8fe0ac;border-color:#59d98c55;background:#59d98c14}',
      '.mf-win.live b{color:#c8ffdd}',
      '.mf-world.live{border-color:#59d98c55}',
      '.mf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(272px,1fr));gap:12px}',
      '.mf-card{display:flex;flex-direction:column;gap:10px;background:#141a24;border:1px solid #2a3546;border-left:4px solid var(--mfc,#ff4d5e);border-radius:12px;padding:16px;min-height:0}',
      '.mf-card.locked{opacity:.55}',
      '.mf-card.owned{border-color:#59d98c66}',
      '.mf-c-h{display:flex;align-items:center;gap:7px;min-width:0}',
      '.mf-c-art{width:30px;height:30px;flex:0 0 30px;object-fit:contain;filter:drop-shadow(0 0 5px #ff4d5e66)}',
      '.mf-s-ic{font-size:17px;line-height:1;flex:0 0 auto}',
      '.mf-shop{grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}',
      '.mf-hull{border-left-color:#ff4d5e;background:linear-gradient(180deg,#1b1016,#141a24)}',
      '.mf-h-art{display:flex;align-items:center;justify-content:center;height:132px;min-height:132px;background:radial-gradient(60% 70% at 50% 45%,#ff4d5e22,transparent 70%);border-radius:8px;border:0;padding:0;width:100%;position:relative;cursor:pointer}',
      '.mf-h-mag{position:absolute;right:6px;bottom:6px;font-size:15px;color:#ff8a9a;opacity:.7;line-height:1}',
      '.mf-h-art:hover .mf-h-mag{opacity:1}',
      '.mf-info{margin-top:2px;min-height:46px;border:1px solid #2a3546;border-radius:8px;background:#1a2230;color:#9fb0c4;font:700 13.5px/1 Rajdhani,sans-serif;letter-spacing:.1em;cursor:pointer}',
      '.mf-info:hover{color:#fff;border-color:#ff4d5e55}',
      '.mf-h-art img{max-width:82%;max-height:124px;object-fit:contain;filter:drop-shadow(0 4px 14px #ff4d5e66)}',
      '.mf-h-perk{font:700 14px/1.45 Rajdhani,sans-serif;color:#ffb0ba;background:#ff4d5e14;border:1px solid #ff4d5e33;border-radius:6px;padding:9px 11px}',
      '.mf-c-best{font:800 11px/1 Rajdhani,sans-serif;letter-spacing:.1em;color:#ffd24d;border:1px solid #ffd24d55;border-radius:4px;padding:3px 5px;flex:0 0 auto}',
      '.mf-shop-c{border-left-color:var(--mfc,#ff8a3d)}',
      '.mf-go.mf-sm{min-height:40px;font-size:12px;background:linear-gradient(180deg,#2f3a4c,#222b39);border:1px solid #3a4658}',
      '.mf-go.mf-sm:not(:disabled):hover{background:linear-gradient(180deg,#3a4658,#2a3444)}',
      '.mf-c-t{font:800 13px/1 Rajdhani,sans-serif;color:var(--mfc,#ff4d5e);flex:0 0 auto}',
      '.mf-c-n{font:800 19px/1.2 Rajdhani,sans-serif;color:#fff;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mf-c-done{font:800 11px/1 Rajdhani,sans-serif;letter-spacing:.1em;color:#59d98c;border:1px solid #59d98c55;border-radius:4px;padding:3px 5px;flex:0 0 auto}',
      '.mf-c-s{font-size:14px;line-height:1.5;color:#9fb0c4}',
      '.mf-c-r{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.mf-c-rew{font:800 18px/1 Rajdhani,sans-serif;color:#ff8a3d}',
      '.mf-c-xp{font:700 11px/1 Rajdhani,sans-serif;letter-spacing:.1em;color:#7d8ba0;border:1px solid #2a3546;border-radius:4px;padding:3px 5px}',
      '.mf-bp{font-size:13.5px;line-height:1.45;color:#c9a2ff}',
      '.mf-bp.got{color:#59d98c}',
      '.mf-cost{display:flex;flex-wrap:wrap;gap:6px}',
      '.mf-cost span{font:700 14px/1 Rajdhani,sans-serif;border:1px solid #2a3546;border-radius:5px;padding:7px 9px}',
      '.mf-cost .ok{color:#a5f2c4;border-color:#59d98c44}',
      '.mf-cost .no{color:#ff8a9a;border-color:#ff4d5e44}',
      '.mf-cost .lc{border-color:#f2a93c66;color:#ffd9a0}',
      '.mf-cost .lc.no{border-color:#ff4d5e66;color:#ff8a9a}',
      '.mf-go{margin-top:2px;min-height:52px;border:0;border-radius:8px;background:linear-gradient(180deg,#ff5a6a,#c2323f);color:#fff;font:800 16px/1 Rajdhani,sans-serif;letter-spacing:.09em;cursor:pointer}',
      '.mf-go:disabled{background:#232c3a;color:#6d7b90;cursor:not-allowed}',
      '.mf-c-lock{font:700 13.5px/1.45 Rajdhani,sans-serif;color:#7d8ba0;min-height:22px;display:flex;align-items:center}',
      '.mf-c-lock.ok{color:#8fe0ac}',
      '.mf-c-lock b{color:#c9a2ff}',
      '.mf-lock{text-align:center;padding:34px 18px;display:flex;flex-direction:column;align-items:center;gap:9px}',
      '.mf-lock-ic{font-size:42px;color:#ff4d5e}',
      '.mf-lock-t{font:800 23px/1 Rajdhani,sans-serif;letter-spacing:.1em;color:#fff}',
      '.mf-lock-s{font-size:15px;line-height:1.55;color:#b8c4d8}',
      '.mf-bar{width:100%;max-width:260px;height:6px;background:#1a2230;border-radius:3px;overflow:hidden}',
      '.mf-bar i{display:block;height:100%;background:linear-gradient(90deg,#ff8a3d,#ff4d5e)}',
    ].join('');
    document.head.appendChild(s);
  })();

  function rec() {
    const s = st();
    if (!s.mech || typeof s.mech !== 'object') s.mech = { best: 0, runs: 0, kills: 0, earned: 0 };
    if (s.mech.earned == null) s.mech.earned = 0;
    return s.mech;
  }
  function cores() { return num(st().mechCores); }
  // LootCoins are `state.credits`. addCredits() is a GRANT helper — it clamps to
  // Math.max(0, n) and can only ever add — so a spend is a direct debit, the same
  // way buyShipLC() and buySpeed4() do it. Never `| 0`: a LootCoin balance passes
  // the signed-32-bit ceiling and would wrap negative.
  function credits() { return num(st().credits); }
  function addCores(n) { const s = st(); s.mechCores = num(s.mechCores) + Math.max(0, num(n)); }
  function earned() { return num(rec().earned); }
  function lv() { return num(st().level) || 1; }
  function unlocked() { return lv() >= TIERS[0].lv; }
  // Ascension stars live on `pasc`, which rides through every ascension in
  // ASC_KEEP — so a star gate is permanent progress, never something a reset
  // can take back.
  function stars() { try { const p = st().pasc; return Math.max(0, (p && p.stars) | 0); } catch (e) { return 0; } }
  function tierOpen(x) { return lv() >= x.lv && stars() >= (x.asc | 0); }
  // WHICH gate is missing, so the card can say the useful half rather than
  // printing both and letting the player work out which one they failed.
  function gateMsg(x) {
    if (stars() < (x.asc | 0)) return '\u2605' + x.asc + ' Ascension' + (lv() < x.lv ? ' \u00b7 Level ' + x.lv : '');
    if (lv() < x.lv) return 'Level ' + x.lv;
    return '';
  }
  function hasBp(k) { try { return !!(st().blueprints && st().blueprints[k]); } catch (e) { return false; } }
  // THE CAPSTONE BLUEPRINT IS LATCHED, not recomputed. Completing the Mech line
  // writes it into state.blueprints exactly like a schematic recovered from a
  // world, which is what makes it behave like one everywhere else: blueprints are
  // a UNIONED entitlement in mergeSaves(), so finishing the line on one device
  // cannot be undone by a merge from another, and it rides through ascension with
  // the rest of them. Recomputing it from ownership would work on screen and be
  // absent from every one of those systems.
  //
  // Idempotent and safe to call on every render — an owned blueprint is never
  // re-granted, and it never revokes one (a hull sold or reset must not take the
  // capstone licence back).
  function syncCapstone() {
    const b = BUILD.mechsovereign; if (!b || !b.req) return false;
    if (hasBp('mechsovereign')) return false;
    if (!b.req.every(owns)) return false;
    const s = st();
    if (!s.blueprints) s.blueprints = {};
    s.blueprints.mechsovereign = true;
    return true;
  }
  function owns(k) { try { return !!(st().ownedShips && st().ownedShips[k]); } catch (e) { return false; } }

  function toast(msg) {
    try { if (window.UI && window.UI.unlockToast) return window.UI.unlockToast(msg); } catch (e) {}
    try { if (window.UI && window.UI.toast) return window.UI.toast(msg); } catch (e) {}
  }
  function save() { try { G().save(); } catch (e) {} }

  // ---- THE CHANNEL ----------------------------------------------------------
  // Fire and forget, always. A world is cleared and cores are paid whether or not
  // Discord hears about it — nothing in the settlement path may wait on, or fail
  // because of, a network call.
  function announce(kind, meta) {
    try {
      const cl = window.CLOUD && window.CLOUD.client && window.CLOUD.client();
      if (!cl) return;
      cl.rpc('log_mech', { p_kind: String(kind), p_meta: meta || {} }).then(() => {}, () => {});
    } catch (e) {}
  }
  // A CORE MILESTONE IS A ROUND NUMBER CROSSED, not every payout. Announcing each
  // clear's cores would be twenty ambient lines a day per pilot; the thresholds
  // are spaced so a card means something.
  const CORE_MARKS = [1000, 5000, 25000, 100000, 400000];

  // ---- THE ASSAULT WINDOW WATCHER ------------------------------------------
  // A window opening is not an action any player takes, so nothing in the game
  // was ever going to notice it — the other Foundry announcements all fire off a
  // player's own kill. This watches the clock instead and posts on the transition.
  //
  // EVERY CLIENT SEES THE SAME CLOCK, so every client would post the same card.
  // That is why these three kinds dedupe GLOBALLY on the server (world + cycle
  // number, no actor scoping) rather than per pilot like every other mech kind:
  // the first client to notice wins and the rest are refused. Follows kothOpen,
  // which had the same shape.
  //
  // THEY ARE AMBIENT ON PURPOSE. Five worlds × four cycles a day is twenty
  // openings, and twenty cards a day is a channel people mute. Ambient rolls into
  // one digest line per kind per drain, which turns the same information into a
  // live status feed instead of a flood.
  const WARN_MS = 15 * 60 * 1000;      // "closing soon" while a window is live
  const SOON_MS = 30 * 60 * 1000;      // "opens shortly" heads-up before one
  const _fired = {};                   // kind|tier|cycle -> 1, this session only
  // The cycle number a world's window belongs to, so a card can be deduped against
  // the exact window it describes rather than against a time range.
  function cycleOf(x, now) {
    return Math.floor((now - (x.t - 1) * STAGGER_MS) / CYCLE_MS);
  }
  // What a pilot needs to actually enter — sent with every window card, because a
  // ping that does not say who may join is an advert for a locked door.
  function reqMeta(x) {
    const wd = worldOf(x) || {};
    return {
      world: planetName(x), tier: x.t, stage: wd.stage || '',
      lv: x.lv, asc: x.asc | 0, cores: x.cores, waves: x.waves,
      req: 'Level ' + x.lv + (x.asc ? ' \u00b7 Ascension \u2605' + x.asc : ' \u00b7 no ascension needed'),
      hull: x.bp ? ((shipOf(x.bp) || {}).name || '') : '',
    };
  }
  function tickWindows() {
    // Nothing to say if the player cannot reach the event themselves — and nothing
    // to post through, since log_mech needs a signed-in caller.
    if (!unlocked()) return;
    try { if (!(window.CLOUD && window.CLOUD.client && window.CLOUD.client())) return; } catch (e) { return; }
    const now = nowMs();
    for (const x of TIERS) {
      const w = windowOf(x, now), cyc = cycleOf(x, now);
      const key = (k) => k + '|' + x.t + '|' + cyc;
      if (w.open) {
        // OPEN. Only within the first two minutes of the window, so a client that
        // loads mid-window does not announce something already half over.
        if (WINDOW_MS - w.ms < 120000 && !_fired[key('mechOpen')]) {
          _fired[key('mechOpen')] = 1;
          announce('mechOpen', Object.assign(reqMeta(x), { mins: Math.round(w.ms / 60000) }));
        }
        if (w.ms <= WARN_MS && !_fired[key('mechWarn')]) {
          _fired[key('mechWarn')] = 1;
          announce('mechWarn', Object.assign(reqMeta(x), { mins: Math.max(1, Math.round(w.ms / 60000)) }));
        }
      } else if (w.ms <= SOON_MS && !_fired[key('mechSoon')]) {
        _fired[key('mechSoon')] = 1;
        announce('mechSoon', Object.assign(reqMeta(x), { mins: Math.max(1, Math.round(w.ms / 60000)) }));
      }
    }
  }
  // Runs on its own clock, not the Foundry screen's: a window opens whether or not
  // the player is looking at the event. 60s is well inside the 15-minute warning
  // band and the 2-minute open band, so nothing can be missed between ticks.
  let _wt = null;
  function startWatcher() {
    if (_wt) return;
    _wt = setInterval(() => { try { tickWindows(); } catch (e) {} }, 60000);
    setTimeout(() => { try { tickWindows(); } catch (e) {} }, 8000);
  }
  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startWatcher);
    else startWatcher();
  } catch (e) {}
  function announceWorld(x, bpMsg) {
    const deep = x.t >= 4;                       // the two star-gated worlds
    announce(deep ? 'mechDeep' : 'mechWorld', {
      world: planetName(x), tier: x.t, stage: (worldOf(x) || {}).stage || '',
      cores: x.cores, blueprint: !!bpMsg,
    });
    const e = earned(), before = e - x.cores;
    for (const m of CORE_MARKS) {
      if (before < m && e >= m) { announce('mechCore', { mark: m, total: e }); break; }
    }
  }

  // ===========================================================================
  // THE RUN
  // ===========================================================================
  // Arms the gauntlet and hands off to the engine's own deploy path. Guarded
  // against firing twice: the card is a button and a second tap mid-deploy would
  // otherwise re-enter selectDungeon with a half-built run.
  let _starting = false;
  function start(tn) {
    const x = TIER_BY_N[tn]; if (!x) return;
    // The lock reason is checked BEFORE the debounce: refusing a tier is not a
    // deploy, and a player tapping a locked card right after launching one should
    // still be told why rather than getting the same silence the broken deploy gave.
    if (!tierOpen(x)) { toast('🔒 ' + planetName(x) + ' requires ' + gateMsg(x)); return; }
    // THE WINDOW GATES ENTRY, AND ONLY ENTRY. A run already under way is never
    // cut short when its hour lapses — killing a live assault to enforce a
    // schedule destroys progress the player already earned, which is a far worse
    // sin than letting one run finish a few minutes late.
    {
      const w = windowOf(x);
      if (!w.open) { toast('\u2609 ' + planetName(x) + ' is out of range \u2014 the assault window opens in ' + dur(w.ms)); return; }
    }
    if (_starting) return;
    _starting = true;
    try {
      const g = G();
      // startMechRun() owns the deploy, and it is deliberately NOT selectDungeon():
      // that refuses any zone past highestUnlocked, which is EVERY Foundry zone
      // (the Spawn Nest is Zone 150 and opens at Level 120). Routing through it
      // made DEPLOY silently do nothing at all.
      if (typeof g.startMechRun !== 'function' || !g.startMechRun(x.t)) {
        // And never fail silently again. A button that does nothing is
        // indistinguishable from a broken game; the player gets the fact, the
        // detail goes to the console where a developer can act on it.
        try { g.state.mechRun = null; } catch (e2) {}
        toast('⚠ The Foundry could not deploy — reload and try again');
        try { console.warn('[MECHF] startMechRun unavailable or refused tier', x.t); } catch (e3) {}
        return;
      }
      if (window.UI && window.UI.showScreen) window.UI.showScreen('battle');
      toast('⚙ ' + planetName(x).toUpperCase() + ' — ' + x.waves + ' waves, then the ' + mechName(x.key));
    } catch (e) {
      try { G().state.mechRun = null; } catch (e2) {}
      toast('⚠ The Foundry could not deploy — reload and try again');
      try { console.warn('[MECHF] deploy threw', e); } catch (e3) {}
    } finally {
      setTimeout(() => { _starting = false; }, 800);
    }
  }
  function mechName(k) {
    const m = (CFG().MECH_BY_KEY || {})[k];
    return m ? m.name : 'Mech';
  }

  // Settlement. Called by updateWaveZone the moment the tier boss dies, BEFORE
  // the tow home, so nothing about the payout depends on the player reloading.
  // The whole mutation is synchronous — there is no await between deciding the
  // reward and writing it.
  function onRunCleared(tn) {
    const x = TIER_BY_N[tn]; if (!x) return;
    const r = rec();
    r.runs = num(r.runs) + 1;
    if (x.t > num(r.best)) r.best = x.t;
    // Cores scale with the tier and nothing else — no streak bonus, no daily
    // multiplier. One number the player can predict from the card they tapped.
    const paid = x.cores;
    addCores(paid);
    // LIFETIME EARNED, kept separately from the wallet. Missions and the ladder
    // measure what you have WON, and `mechCores` is spendable — assembling a hull
    // would run a mission's progress backwards and drop a leaderboard row.
    r.earned = num(r.earned) + paid;
    let bpMsg = '';
    // FIRST CLEAR HANDS OVER THE BLUEPRINT — no roll. A hull behind a percentage
    // turns a 20-minute gauntlet into a slot machine, and the cores are already
    // the grind. Latched like any other recovered schematic, so it merges and
    // survives ascension with the rest of them.
    if (x.bp && !hasBp(x.bp)) {
      const s = st();
      if (!s.blueprints) s.blueprints = {};
      s.blueprints[x.bp] = true;
      const shipNm = (shipOf(x.bp) || {}).name || 'hull';
      bpMsg = ' · ✦ ' + shipNm.toUpperCase() + ' BLUEPRINT RECOVERED';
    }
    save();
    announceWorld(x, bpMsg);
    toast('⚙ ' + planetName(x).toUpperCase() + ' CLEARED — +' + fmt(paid) + ' Mech Cores' + bpMsg);
    try { render(); } catch (e) {}
  }
  // Lifetime counter, called from the kill path for anything wearing a Mech type.
  function onMechKill() { const r = rec(); r.kills = num(r.kills) + 1; }

  // ===========================================================================
  // BUILDING A HULL
  // ===========================================================================
  // Order the write so a throw cannot strand the pilot: everything is validated
  // first, then the debits and the grant happen in one synchronous block with no
  // awaits between taking payment and delivering the hull.
  let _building = false;
  function canBuild(key) {
    const b = BUILD[key]; if (!b) return { ok: false, why: 'no such hull' };
    if (owns(key)) return { ok: false, why: 'owned' };
    // The capstone is gated on the LINE, not on a blueprint — there is no sixth
    // world to drop one.
    if (b.req) { if (b.req.some((k) => !owns(k))) return { ok: false, why: 'line' }; }
    else if (!hasBp(key)) return { ok: false, why: 'blueprint' };
    const res = st().resources || {};
    const need = [];
    if (cores() < b.cores) need.push('⚙ ' + fmt(b.cores - cores()) + ' Mech Cores');
    for (const k in b.res) { const have = num(res[k]); if (have < b.res[k]) need.push(fmt(b.res[k] - have) + ' ' + k); }
    if (b.lc && credits() < b.lc) need.push(fmt(b.lc - credits()) + ' LootCoins');
    return need.length ? { ok: false, why: 'short', need } : { ok: true };
  }
  function build(key) {
    if (_building) return;
    _building = true;
    try {
      // RE-CHECK AT THE MOMENT OF THE WRITE, not when the button was drawn — a
      // confirm sheet can sit open while the wallet moves.
      const c = canBuild(key);
      if (!c.ok) {
        toast(c.why === 'short' ? 'Not enough: ' + c.need.join(' · ')
          : c.why === 'line' ? 'Assemble every other Mech hull first'
          : 'Cannot build that hull');
        return;
      }
      const b = BUILD[key], s = st();
      if (!s.resources) s.resources = { fuel: 0, iron: 0, plasma: 0 };
      for (const k in b.res) s.resources[k] = Math.max(0, num(s.resources[k]) - b.res[k]);
      s.mechCores = Math.max(0, cores() - b.cores);
      if (b.lc) s.credits = Math.max(0, credits() - b.lc);
      if (!s.ownedShips) s.ownedShips = {};
      s.ownedShips[key] = true;                       // the goods, same synchronous block
      const capstone = syncCapstone();                // did that complete the line?
      save();
      const nm = (shipOf(key) || {}).name || 'Hull';
      // EVERY hull announces through log_hull(), the path every acquisition in the
      // game already uses — it validates the key, refuses duplicates and is
      // idempotent per pilot per hull, so this is safe to call on every assembly.
      // Fire and forget: the hull is granted whether or not the channel hears.
      try { if (window.TERRITORY && window.TERRITORY.logHull) window.TERRITORY.logHull(key); } catch (e) {}
      if (key === 'mechsovereign') announce('mechSov', { ship: key, name: nm });
      toast('⚙ ' + nm.toUpperCase() + ' ASSEMBLED — it is in your hangar');
      if (capstone) {
        const sv = (shipOf('mechsovereign') || {}).name || 'Mech Sovereign';
        toast('✦ THE MECH LINE IS COMPLETE — ' + sv.toUpperCase() + ' BLUEPRINT RECOVERED');
      }
      try { render(); } catch (e) {}
      try { if (window.UI && window.UI.refreshAll) window.UI.refreshAll(); } catch (e) {}
    } finally { _building = false; }
  }

  // ===========================================================================
  // THE SCREEN
  // ===========================================================================
  function render() {
    const body = $('mech-body'); if (!body) return;
    const sub = $('mech-sub');
    if (sub) sub.textContent = unlocked() ? '⚙ ' + fmt(cores()) + ' Mech Cores' : 'Locked';
    if (!unlocked()) {
      // Every other lock veil in the game is one line, the level and a bar.
      // A screen the player cannot open yet does not teach mechanics.
      const pct = Math.min(100, lv() / TIERS[0].lv * 100);
      body.innerHTML = '<div class="mf-lock"><div class="mf-lock-ic">⚙</div>'
        + '<div class="mf-lock-t">THE MECH FOUNDRY</div>'
        + '<div class="mf-lock-s">Opens at <b>Level ' + TIERS[0].lv + '</b> — you are Level <b>' + fmt(lv()) + '</b>.</div>'
        + '<div class="mf-bar"><i style="width:' + pct + '%"></i></div></div>';
      return;
    }
    const r = rec();
    // A save that already holds every Mech hull — from before this shipped, or from
    // a merge — gets the licence it has plainly earned rather than having to
    // rebuild something to trigger it.
    if (syncCapstone()) save();
    body.innerHTML =
      heroPill()
      + '<div class="mf-wallet"><span class="mf-w-ic">⚙</span><span class="mf-w-n">' + fmt(cores()) + '</span>'
      + '<span class="mf-w-l">MECH CORES</span>'
      + '<span class="mf-w-r">' + fmt(num(r.runs)) + ' runs · deepest ' + (num(r.best) ? 'T' + num(r.best) : '—') + '</span></div>'
      + '<div class="mf-sec">CORRUPTED WORLDS</div>'
      + windowStrip()
      + '<div class="mf-grid">' + TIERS.map(tierCard).join('') + '</div>'
      + '<div class="mf-sec">FOUNDRY STORE</div>'
      + '<div class="mf-note">Every Mech hull is assembled here. Clear a hull’s tier to recover its blueprint, then pay in ⚙ Mech Cores and Galaxy Resources.</div>'
      + '<div class="mf-grid mf-shop">' + BUILD_ORDER.map(hullCard).join('') + '</div>';
    body.querySelectorAll('[data-mf-go]').forEach((b) => b.addEventListener('click', () => start(+b.dataset.mfGo)));
    body.querySelectorAll('[data-mf-build]').forEach((b) => b.addEventListener('click', () => build(b.dataset.mfBuild)));
    body.querySelectorAll('[data-mf-info]').forEach((b) => b.addEventListener('click', () => {
      try { if (window.UI && window.UI.openShipDetail) window.UI.openShipDetail(b.dataset.mfInfo); } catch (e) {}
    }));
    startTick();
    stopOrbit(); orbitLoop();
  }

  // ---- THE LIVE CLOCK -------------------------------------------------------
  // Ticks the countdowns in place. It only ever writes textContent — a full
  // re-render every second would rebuild the shelf under the player's thumb and
  // throw away their scroll position. The one case that DOES re-render is a
  // window actually opening or closing, because that changes buttons, not numbers.
  //
  // It stops itself the moment the screen is not on top, so a player who walks
  // away from the Foundry is not paying for a timer in the background.
  let _tick = null, _sig = '';
  const winSig = () => TIERS.filter(tierOpen).map((x) => (windowOf(x).open ? '1' : '0')).join('');
  function stopTick() { if (_tick) { clearInterval(_tick); _tick = null; } stopOrbit(); }
  function startTick() {
    stopTick();
    _sig = winSig();
    _tick = setInterval(() => {
      const body = $('mech-body'), scr = $('screen-mech');
      if (!body || !scr || !scr.classList.contains('active')) { stopTick(); return; }
      const sig = winSig();
      if (sig !== _sig) { _sig = sig; render(); return; }
      const now = nowMs();
      body.querySelectorAll('[data-mf-clock]').forEach((el) => {
        const x = TIER_BY_N[+el.dataset.mfClock]; if (!x) return;
        const b = el.querySelector('b'); if (b) b.textContent = dur(windowOf(x, now).ms);
      });
      const nx = nextEvent().best, h = body.querySelector('[data-mf-head]');
      if (h && nx) h.textContent = dur(nx.w.ms);
    }, 1000);
  }

  // ---- THE HERO PILL --------------------------------------------------------
  // Why a pilot should care, above everything they could tap. Every figure is READ
  // OFF MECHCORR.FLEET rather than written here — that table is the single
  // statement of the mechanic, and a sell screen that restates numbers is the one
  // screen where being stale costs the most.
  function heroPill() {
    const M = window.MECHCORR || {};
    const cap = M.FLEET_CAP || 0;
    // NEVER COUNT THE HULLS IN COPY. "Both" and "all five" are the kind of line
    // that rots the day a sixth ships — the same way "all seven ladders" survived
    // to thirteen boards. Name the ends of the ladder, not its length.
    const nums = cap
      ? 'From the <b>Spawn</b> to the <b>Titan</b>, every Mech hull feeds <b>one</b> corruption pool on the target, to a ceiling of <b>−' + cap + '%</b>.'
      : '';
    return '<div class="mf-hero">'
      + '<img class="mf-hero-art" src="ships/mech-mtitan.png" alt="">'
      + '<div class="mf-hero-tx">'
      + '<div class="mf-hero-k">⚙ MECH CORRUPTION</div>'
      + '<div class="mf-hero-q">“We don’t hit the hardest. We make everything else hit harder.”</div>'
      + '<div class="mf-hero-b">' + nums + ' That extra damage applies to <b>every ship in your fleet</b>, not just the Mech — which is why a Mech hull is worth a slot even when it is not your biggest gun.</div>'
      + '</div></div>';
  }

  function tierCard(x) {
    const open = tierOpen(x), done = num(rec().best) >= x.t;
    const w = windowOf(x), wd = worldOf(x) || {};
    const bpShip = x.bp && shipOf(x.bp);
    const bpLine = x.bp
      ? '<div class="mf-bp' + (hasBp(x.bp) ? ' got' : '') + '">✦ ' + (hasBp(x.bp) ? 'Blueprint recovered' : 'First clear: ' + esc(bpShip ? bpShip.name : '') + ' blueprint') + '</div>'
      : '';
    return '<div class="mf-card mf-world' + (open ? '' : ' locked') + (open && w.open ? ' live' : '') + '" style="--mfc:' + x.col + '">'
      + '<div class="mf-c-h">'
      + '<span class="mf-planet" style="--pg:' + (wd.ground || x.col) + ';--pv:' + (wd.vein || x.col) + ';--ps:' + (wd.sky || '#1a0d12') + '"></span>'
      + '<span class="mf-c-n">' + esc(planetName(x)) + '</span>'
      + (done ? '<span class="mf-c-done">CLEARED</span>' : '') + '</div>'
      + '<div class="mf-c-w"><span class="mf-c-t">T' + x.t + '</span>'
      + '<span class="mf-c-stage">' + esc(wd.stage || 'CORRUPTED') + '</span>'
      + (x.asc ? '<span class="mf-c-asc' + (stars() >= x.asc ? ' ok' : '') + '">\u2605' + x.asc + '</span>' : '')
      + '</div>'
      + '<div class="mf-c-s">' + x.waves + ' waves · ' + esc(mechName(x.key)) + ' boss · Zone ' + x.zone + '</div>'
      + '<div class="mf-c-r"><span class="mf-c-rew">⚙ ' + fmt(x.cores) + '</span>'
      + '<span class="mf-c-xp">no XP</span></div>'
      + bpLine
      + (open
        ? (w.open
          ? '<div class="mf-win live" data-mf-clock="' + x.t + '">\u25c9 WINDOW OPEN \u00b7 closes in <b>' + dur(w.ms) + '</b></div>'
            + '<button class="mf-go" data-mf-go="' + x.t + '">ASSAULT ' + esc(planetName(x).toUpperCase()) + '</button>'
          : '<div class="mf-win" data-mf-clock="' + x.t + '">\u2609 OUT OF RANGE \u00b7 opens in <b>' + dur(w.ms) + '</b></div>'
            + '<button class="mf-go" disabled>WINDOW CLOSED</button>')
        : '<div class="mf-c-lock">\ud83d\udd12 ' + gateMsg(x) + '</div>')
      + '</div>';
  }

  // ---- THE HEADLINE ---------------------------------------------------------
  // The schedule is stated BEFORE it can refuse anyone, not as an error after the
  // fact — the same lesson the KOTH presence rule had to learn. A player who taps
  // a closed world should already know why it is closed.
  function windowStrip() {
    const { best, anyOpen, mine } = nextEvent();
    if (!mine.length) return '';
    // NEVER COUNT THE WORLDS. "The five windows are staggered, so something is
    // nearly always in range" was true only for a pilot holding all five — and
    // flatly false for everyone arriving at the Foundry's own unlock level, who
    // has ONE world and finds it dark five hours in six. Copy that counts features
    // rots; copy that describes the pilot's own situation does not.
    const sub = mine.length > 1
      ? 'Every world you have unlocked can be assaulted for <b>1 hour</b> out of every <b>6</b>, and their windows are staggered — so one is usually in range.'
      : '<b>' + esc(planetName(mine[0])) + '</b> can be assaulted for <b>1 hour</b> out of every <b>6</b>. The deeper worlds open with <b>Ascension stars</b> — each runs its own staggered window.';
    const liveTxt = anyOpen.length ? anyOpen.map((x) => esc(planetName(x))).join(' \u00b7 ') : 'none right now';
    const nx = best ? (best.w.open
      ? '<b>' + esc(planetName(best.x)) + '</b> closes in <b data-mf-head>' + dur(best.w.ms) + '</b>'
      : '<b>' + esc(planetName(best.x)) + '</b> opens in <b data-mf-head>' + dur(best.w.ms) + '</b>') : '';
    return '<div class="mf-winbar">'
      + '<div class="mf-wb-head"><span class="mf-wb-k">ASSAULT WINDOWS</span>'
      + '<span class="mf-wb-s">' + sub + '</span></div>'
      + '<canvas class="mf-orbit" width="1000" height="640" aria-hidden="true"></canvas>'
      + '<div class="mf-wb-foot">'
      + '<div class="mf-wb-cell"><span class="mf-wb-live' + (anyOpen.length ? '' : ' off') + '">IN RANGE NOW</span><span class="mf-wb-n">' + liveTxt + '</span></div>'
      + '<div class="mf-wb-cell right"><span class="mf-wb-live off">NEXT</span><span class="mf-wb-next">' + nx + '</span></div>'
      + '</div></div>';
  }

  // ---- THE ORBIT ------------------------------------------------------------
  // Not decoration — a literal drawing of the schedule. The ring IS the 6-hour
  // cycle, each world's coloured arc IS its 1-hour window (60° of 360°), and the
  // marker is your fleet at the current point of the cycle. A world is in range
  // exactly when the marker is inside its arc, which is the same arithmetic
  // windowOf() does:
  //
  //     marker angle   = (now mod CYCLE) / CYCLE
  //     arc start      = (t-1) * STAGGER / CYCLE
  //     inside the arc ⇔ (now - offset) mod CYCLE < WINDOW
  //
  // So the picture cannot drift from the countdown beside it — they are the same
  // expression drawn two ways. The staggered offsets become visible as five arcs
  // spaced evenly round the ring, which is the whole point: you can SEE that
  // something is nearly always coming up.
  function drawOrbit(cv) {
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height, cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.335;
    const TAU = Math.PI * 2, arcLen = (WINDOW_MS / CYCLE_MS) * TAU;
    const now = nowMs();
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = 'butt';

    // ---- the cycle track, with an hour scale ------------------------------
    // Six major ticks = the six hours of the cycle, so the ring is readable as a
    // CLOCK rather than an abstract circle: an arc covering one segment is
    // visibly one hour.
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 26;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU - Math.PI / 2, major = i % 4 === 0;
      const r0 = R + (major ? 15 : 15), r1 = R + (major ? 26 : 21);
      ctx.strokeStyle = major ? 'rgba(255,255,255,0.34)' : 'rgba(255,255,255,0.13)';
      ctx.lineWidth = major ? 2.6 : 1.4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = 'rgba(255,255,255,0.34)';
        ctx.font = '700 17px Rajdhani, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText((i / 4) + 'h', cx + Math.cos(a) * (R + 42), cy + Math.sin(a) * (R + 42));
      }
    }

    // ---- each world's window ----------------------------------------------
    for (const x of TIERS) {
      const wd = worldOf(x) || {}, col = wd.vein || x.col;
      const a0 = ((x.t - 1) * STAGGER_MS / CYCLE_MS) * TAU - Math.PI / 2;
      const live = windowOf(x, now).open, has = tierOpen(x);
      ctx.strokeStyle = col;
      ctx.globalAlpha = !has ? 0.14 : live ? 1 : 0.30;
      ctx.lineWidth = live ? 26 : 16;
      ctx.beginPath(); ctx.arc(cx, cy, R, a0, a0 + arcLen); ctx.stroke();

      // the world, at the middle of its own window
      const am = a0 + arcLen / 2, px = cx + Math.cos(am) * R, py = cy + Math.sin(am) * R;
      const rad = live ? 27 : 20;
      if (live) {
        const gl = ctx.createRadialGradient(px, py, rad * 0.5, px, py, rad * 3.1);
        gl.addColorStop(0, col); gl.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.30 + 0.16 * Math.sin(now / 300);
        ctx.fillStyle = gl;
        ctx.beginPath(); ctx.arc(px, py, rad * 3.1, 0, TAU); ctx.fill();
      }
      // a real little planet: lit limb, dark terminator, corruption specks
      ctx.globalAlpha = has ? 1 : 0.34;
      const pg = ctx.createRadialGradient(px - rad * 0.35, py - rad * 0.38, rad * 0.12, px, py, rad);
      pg.addColorStop(0, wd.ground || '#4a3a33');
      pg.addColorStop(1, wd.sky || '#1a0d12');
      ctx.fillStyle = pg;
      ctx.beginPath(); ctx.arc(px, py, rad, 0, TAU); ctx.fill();
      ctx.fillStyle = col; ctx.globalAlpha = has ? (live ? 0.95 : 0.6) : 0.25;
      for (let k = 0; k < 4; k++) {
        const sa2 = x.t * 1.7 + k * 1.9, sr = rad * (0.28 + (k % 3) * 0.22);
        ctx.beginPath();
        ctx.arc(px + Math.cos(sa2) * sr, py + Math.sin(sa2) * sr * 0.9, rad * 0.11, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = has ? 1 : 0.34;
      ctx.strokeStyle = col; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.arc(px, py, rad, 0, TAU); ctx.stroke();

      // NAME AND STATE, outside the ring, aligned by side so nothing overlaps it
      const lx = cx + Math.cos(am) * (R + 74), ly = cy + Math.sin(am) * (R + 74);
      const rightHalf = Math.cos(am) >= -0.05;
      ctx.textAlign = Math.abs(Math.cos(am)) < 0.25 ? 'center' : (rightHalf ? 'left' : 'right');
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = has ? 1 : 0.4;
      ctx.fillStyle = live ? '#ffffff' : has ? '#c4cfe0' : '#7d8ba0';
      ctx.font = '800 21px Rajdhani, sans-serif';
      ctx.fillText((wd.name || '').toUpperCase(), lx, ly - 11);
      ctx.font = '700 17px Rajdhani, sans-serif';
      ctx.fillStyle = !has ? '#7d8ba0' : live ? col : '#8a99ad';
      ctx.fillText(!has ? (x.asc ? '\u2605' + x.asc + ' LOCKED' : 'LOCKED')
        : live ? 'IN RANGE \u00b7 ' + dur(windowOf(x, now).ms)
        : 'in ' + dur(windowOf(x, now).ms), lx, ly + 12);
    }

    // ---- your fleet --------------------------------------------------------
    const sa = ((now % CYCLE_MS) / CYCLE_MS) * TAU - Math.PI / 2;
    ctx.globalAlpha = 1;
    for (let i = 0; i < 16; i++) {          // fading wake behind the marker
      const a = sa - (i / 16) * 0.62;
      ctx.globalAlpha = 0.42 * (1 - i / 16);
      ctx.strokeStyle = '#ffd8a0'; ctx.lineWidth = 5 * (1 - i / 16) + 1;
      ctx.beginPath(); ctx.arc(cx, cy, R, a - 0.045, a); ctx.stroke();
    }
    const sx2 = cx + Math.cos(sa) * R, sy2 = cy + Math.sin(sa) * R;
    ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(sx2, sy2); ctx.rotate(sa + Math.PI / 2);
    ctx.fillStyle = '#fff3d0';
    ctx.beginPath(); ctx.moveTo(0, -19); ctx.lineTo(12, 14); ctx.lineTo(0, 7); ctx.lineTo(-12, 14); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#ff8a3d'; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();

    // ---- the answer, in the middle ----------------------------------------
    // "When can I play?" belongs at the centre of the thing that answers it.
    const nx2 = nextEvent().best;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (nx2) {
      const openNow = nx2.w.open;
      ctx.fillStyle = openNow ? '#8fe0ac' : '#7d8ba0';
      ctx.font = '800 18px Rajdhani, sans-serif';
      ctx.fillText(openNow ? 'IN RANGE' : 'NEXT WINDOW', cx, cy - 38);
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 54px Rajdhani, sans-serif';
      ctx.fillText(dur(nx2.w.ms), cx, cy + 2);
      ctx.fillStyle = openNow ? '#8fe0ac' : '#ffb0ba';
      ctx.font = '700 20px Rajdhani, sans-serif';
      ctx.fillText(planetName(nx2.x).toUpperCase() + (openNow ? ' \u00b7 CLOSING' : ''), cx, cy + 40);
    }
    ctx.globalAlpha = 1;
  }
  // ~9fps. The marker crosses 1/21,600th of the ring per second, so nothing here
  // needs a real animation budget — the frames buy the in-range pulse and nothing
  // else. It stops dead when the screen is not on top.
  let _orb = null;
  function stopOrbit() { if (_orb) { clearTimeout(_orb); _orb = null; } }
  function orbitLoop() {
    _orb = null;
    const cv = document.querySelector('#mech-body .mf-orbit'), scr = $('screen-mech');
    if (!cv || !scr || !scr.classList.contains('active')) return;
    try { drawOrbit(cv); } catch (e) { return; }
    _orb = setTimeout(() => requestAnimationFrame(orbitLoop), 110);
  }

  // A STORE CARD, not a list row — the hull is the product, so the art leads and
  // what it DOES comes before what it costs. The corruption figures are read off
  // MECHCORR.FLEET rather than written here; that table is the mechanic's single
  // statement and a shelf is the worst place to hold a stale copy of it.
  function hullCard(key) {
    const ship = shipOf(key);
    if (!ship) return '';
    const b = BUILD[key], c = canBuild(key), have = owns(key);
    const bp = b.req ? b.req.every(owns) : hasBp(key);
    const reqLeft = b.req ? b.req.filter((k) => !owns(k)).length : 0;
    const res = st().resources || {};
    const f = ((window.MECHCORR && window.MECHCORR.FLEET) || {})[key];
    const perk = f ? '<div class="mf-h-perk">⚙ −' + f.per + '% armor a stack · to −' + f.max + '% · ' + f.dur + 's</div>' : '';
    const src = TIERS.find((t) => t.bp === key);
    const cost = '<div class="mf-cost">'
      + '<span class="' + (cores() >= b.cores ? 'ok' : 'no') + '">⚙ ' + fmt(b.cores) + '</span>'
      + Object.keys(b.res).map((k) => '<span class="' + (num(res[k]) >= b.res[k] ? 'ok' : 'no') + '">' + fmt(b.res[k]) + ' ' + k + '</span>').join('')
      + (b.lc ? '<span class="lc ' + (credits() >= b.lc ? 'ok' : 'no') + '">◈ ' + fmt(b.lc) + ' LootCoins</span>' : '')
      + '</div>';
    return '<div class="mf-card mf-hull' + (have ? ' owned' : '') + '">'
      + '<button class="mf-h-art" data-mf-info="' + key + '"><img src="ships/ship-' + key + '.png" alt=""><span class="mf-h-mag">ⓘ</span></button>'
      + '<div class="mf-c-h"><span class="mf-c-n">' + esc(ship.name) + '</span>'
      + (have ? '<span class="mf-c-done">IN HANGAR</span>' : '') + '</div>'
      + '<div class="mf-c-s">' + esc(ship.tag || ship.cls) + '</div>'
      + perk
      // THE PRICE IS ALWAYS ON THE SHELF, blueprint or not. Hiding it behind the
      // unlock left the two best hulls in the game as a pair of grey rectangles
      // saying "locked" — nothing to want, nothing to save for, and no way to know
      // whether 1,200 cores was a week away or a month. A locked item still has to
      // sell itself; the lock belongs on the BUTTON, not on the information.
      + (have ? '<div class="mf-c-lock ok">✓ Assembled — fit it from the Hangar</div>'
        : cost
          + '<div class="mf-c-lock' + (bp ? ' ok' : '') + '">'
          + (b.req
            ? (bp ? '✓ The line is complete'
                  : '✦ Capstone — assemble the other <b>' + reqLeft + '</b> Mech hull' + (reqLeft === 1 ? '' : 's') + ' first')
            : bp ? '✓ Blueprint recovered'
                 : '✦ Blueprint — first clear of <b>' + esc(src ? planetName(src) : 'its world') + '</b>' + (src ? ' (T' + src.t + ')' : ''))
          + '</div>'
          + '<button class="mf-go" data-mf-build="' + key + '"' + (c.ok ? '' : ' disabled') + '>'
          + (c.ok ? 'ASSEMBLE' : !bp ? (b.req ? 'LINE INCOMPLETE' : 'BLUEPRINT NEEDED') : 'NOT ENOUGH') + '</button>')
      // THE SAME DETAIL SHEET THE SHIPS PAGE OPENS — openShipDetail(), not a
      // lookalike. Hardpoints, drone bays, every stat mod, the perk text and the
      // acquisition strip are already written there once; a second copy on this
      // shelf would be a second thing to keep in step, and the first to go stale.
      + '<button class="mf-info" data-mf-info="' + key + '">ⓘ FULL SHIP DETAILS</button>'
      + '</div>';
  }

  window.MECHF = {
    TIERS, BUILD, render, unlocked, tiers: () => TIERS, tierOf: (n) => TIER_BY_N[n],
    start, onRunCleared, onMechKill, cores, earned, build, canBuild,
    tickWindows, windowOf, nextEvent, dur,
  };
})();
