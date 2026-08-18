/* =============================================================================
   season-pass.js — LOOTFLEET · TOUR OF DUTY
   ---------------------------------------------------------------------------
   An 8-week, 100-level seasonal track in three columns:

       ENLISTED       free, always on
       COMMISSIONED   5,000 ◈    unlocks its column for the whole season
       ADMIRALTY     25,000 ◈    unlocks its column for the whole season

   Columns STACK. A pilot holding both paid tracks claims all three cells on
   every level, which is what makes the higher tracks read as an upgrade to the
   same ladder rather than three separate ladders. Level 5 gives 1 + 3 + 5 = 9
   item crates; level 3 gives 1% + 5% + 10% = 16% of held gold.

   ---------------------------------------------------------------------------
   THE XP BUDGET IS THE WHOLE DESIGN. Everything else is decoration.

     level cost      100 XP, flat            (100 levels = 10,000 XP)
     season length   8 weeks = 56 days
     daily board     160 XP  ×56  =  8,960
     weekly board    300 XP  × 8  =  2,400
     challenges      1,140 total
     TOTAL                        = 12,500 XP = exactly 125 levels

   Which produces the three pacing promises the brief asked for:

     ~3 weeks of daily play   21×160 + 3×300      = 4,260 → level 42
       \u2192 the VANGUARD sits at level 40, so three weeks earns the hull.
     90% daily for the season  50×160 + 7×300 + \u00bd challenges = 10,670 → level 106
       \u2192 clears 100, so the DREAD PRAETORIAN in Admiralty is secured by
         near-daily play rather than by perfect play.
     100% of everything                          = 12,500 → level 125
       \u2192 the 25 levels past 100 pay 1 item crate each, on every track.

   A player who does dailies ONLY tops out near level 90 \u2014 weeklies are what
   close the last stretch. That is deliberate: the ladder should ask for both.

   ---------------------------------------------------------------------------
   TWO ECONOMY NOTES, FLAGGED RATHER THAN SILENTLY "FIXED" (see DEPLOY.md):

   1. RESOURCE REWARDS ARE A PERCENTAGE OF WHAT THE PILOT HOLDS. As specified.
      Taken literally that rewards hoarding, pays a pilot who just spent nothing
      at all, and scales without limit at endgame. So each payout is FLOORED
      against a level-scaled baseline (a broke pilot still gets a real reward)
      and CAPPED at a multiple of it (banking for eight weeks cannot turn one
      cell into a fortune). The headline is still "% of what you have".

   2. THE THREE TRACKS PAY 18,500 ◈ IN TOTAL. That is a lot of LootCoins next to
      a game whose every other payout was halved in build 614, and 15,000 of it
      comes back from a 25,000 purchase \u2014 a 60% rebate that competes with pack
      sales. Numbers are as briefed; the constants are all in one place here if
      they want tuning.
   ========================================================================== */
(function () {
  'use strict';
  const G = () => window.GAME;
  const C = () => window.CONFIG;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => { try { return G().formatNum(Math.floor(n)); } catch (e) { return String(Math.floor(n || 0)); } };

  // ---- SEASON SHAPE ---------------------------------------------------------
  const SEASON = 1;
  const SEASON_NAME = 'THE LONG WATCH';
  const WEEKS = 8;
  const DAY_MS = 86400000, WEEK_MS = 7 * DAY_MS;
  // Starts the same Monday the ascension ceiling is anchored to, so every weekly
  // schedule in the game turns over on one boundary. UTC, like all of them.
  const START = Date.UTC(2026, 7, 10);
  const END = START + WEEKS * WEEK_MS;

  const XP_PER_LEVEL = 100;
  const MAX_LEVEL = 100;          // the reward ladder ends here
  const OVER_LEVELS = 25;         // what the season's own XP funds past it
  const HARD_LEVEL = MAX_LEVEL + OVER_LEVELS;
  // ---- PAST 100 ------------------------------------------------------------
  // There is no ceiling any more. Levels 101-125 used to be 25 ladder rows and
  // then a hard stop at 125, which capped a pilot who bought levels at 25 crates
  // no matter how much they spent. Past 100 the ladder is ONE repeating step
  // instead: every 100 XP is another fittings crate, they STACK, and the screen
  // reads "100+" rather than a level number. The season's own XP still funds
  // exactly 25 of them (12,560 earned vs 12,400 for level 125) — buying levels is
  // the only way past that, and now it keeps paying.
  //
  // BUYING A LEVEL: 3,000 ◈ for a full 100 XP, PRORATED against progress already
  // made — 40/100 into a level costs 1,800 ◈, not 3,000.
  const LC_PER_XP = 30;

  // THE TWO BOARDS ARE THE ONLY XP IN THE SEASON (636). Seasonal challenges are gone:
  // they were a third earning system with its own rules, they credited retroactively so
  // a veteran account banked eleven free levels on first open, and they made the answer
  // to "how do I level up" three answers instead of one.
  //
  //   4 daily missions  × 40 XP = 160/day  × 56 = 8,960
  //   3 weekly missions × 150 XP = 450/week ×  8 = 3,600
  //                                      TOTAL = 12,560 XP
  //
  // Level 125 costs 12,400, so the season funds it with a little slack. The split is
  // deliberate: dailies ALONE reach about level 90, so the weeklies are what close the
  // last stretch and both boards matter.
  const XP_DAILY = 160;           // a full daily board  (4 × 40)
  const XP_WEEKLY = 450;          // a full weekly board (3 × 150)

  // Admiralty 25,000 → 50,000 (639). It is the track that carries the Dread Praetorian
  // and 15,000 ◈ of payout, and at 25k the rebate alone covered 60% of the price.
  const PRICE = { commissioned: 5000, admiralty: 50000 };

  // Track ids are used as object keys in the save, so they never change.
  const TRACKS = [
    { k: 'enlisted',     name: 'ENLISTED',     sub: 'free',          col: '#8fa3bd', mul: 1 },
    { k: 'commissioned', name: 'COMMISSIONED', sub: '5,000 \u25c8',   col: '#5b9cff', mul: 3 },
    { k: 'admiralty',    name: 'ADMIRALTY',    sub: '50,000 \u25c8',  col: '#ffd24d', mul: 5 },
  ];
  const TRACK_BY_K = {}; TRACKS.forEach((t) => TRACK_BY_K[t.k] = t);

  // ---- CLOCK ---------------------------------------------------------------
  // The SAME trusted clock the ascension ceiling uses. A season that ends on the
  // device clock ends whenever the player wants it to.
  const ST = () => window.SERVERTIME;
  function now() { const s = ST(); return s ? s.now() : Date.now(); }
  function live() { const t = now(); return t >= START && t < END; }
  function ended() { return now() >= END; }
  function dayIndex() { return Math.max(0, Math.floor((now() - START) / DAY_MS)); }
  function weekIndex() { return Math.max(0, Math.floor((now() - START) / WEEK_MS)); }
  function msLeft() { return Math.max(0, END - now()); }
  function leftText() {
    const ms = msLeft();
    const d = Math.floor(ms / DAY_MS), h = Math.floor(ms % DAY_MS / 3600000), m = Math.floor(ms % 3600000 / 60000);
    return d > 0 ? d + 'd ' + h + 'h' : h > 0 ? h + 'h ' + m + 'm' : m + 'm';
  }

  // ---- STATE --------------------------------------------------------------
  // { s: season, xp, own: {track:1}, claim: {'lvl:track':1}, dq: dayIdx, wq: weekIdx,
  //   ch: {id:1}, settled: 0|1 }
  function s() {
    const st = G() && G().state; if (!st) return null;
    if (!st.tour || (st.tour.s | 0) !== SEASON) {
      st.tour = { s: SEASON, xp: 0, own: {}, claim: {}, dq: -1, wq: -1, settled: 0 };
    }
    const t = st.tour;
    if (!t.own) t.own = {}; if (!t.claim) t.claim = {};
    // OVERTIME MIGRATION — 101-125 used to be claimed cell by cell. Fold any keys
    // a pilot already holds into the single overtime counter so nothing is paid
    // twice and nothing is lost.
    if (t.ov == null) {
      let n = 0;
      Object.keys(t.claim).forEach((k) => { if ((parseInt(k, 10) || 0) > MAX_LEVEL) n++; });
      t.ov = n;
    }
    return t;
  }
  const xp = () => { const t = s(); return t ? (t.xp | 0) : 0; };
  const level = () => 1 + Math.floor(xp() / XP_PER_LEVEL);
  const intoLevel = () => xp() % XP_PER_LEVEL;
  const owns = (k) => k === 'enlisted' || !!(s() && s().own[k]);
  // ---- THE OVERTIME STACK (101+) -------------------------------------------
  // One crate per level past 100, held as a count rather than a row per level.
  const overReached = () => Math.max(0, level() - MAX_LEVEL);
  const overClaimed = () => { const t = s(); return t ? (t.ov | 0) : 0; };
  const overPending = () => Math.max(0, overReached() - overClaimed());
  function claimOver() {
    const t = s(); const n = overPending(); if (!t || n <= 0) return [];
    t.ov = overClaimed() + n;
    const lines = openItemCrates(n);
    lines.forEach((l) => { l.lv = MAX_LEVEL + '+'; });
    try { G().save(); } catch (e) {}
    return lines;
  }

  // =========================================================================
  // THE LADDER
  // -------------------------------------------------------------------------
  // ONE REWARD KIND PER LEVEL, and never the same kind twice in a row, so no
  // level ever offers two currencies at once and the track reads as variety
  // rather than a wall of gold. The three columns are the SAME reward at
  // different weights, which is the brief's central rule.
  //
  // LootCoin cells are the tightest constraint: the totals must land on exactly
  // 1,000 / 2,500 / 15,000. Ten cells of 100 does it, with the paid columns at
  // \u00d72.5 and \u00d715 \u2014 which reproduces the brief's own worked example (level 10 =
  // 100 / 250 / 1500).
  const LC_LEVELS = [10, 18, 26, 34, 46, 54, 62, 72, 84, 96];
  const LC_FREE = 100;            // \u00d710 cells = 1,000 \u00b7 \u00d72.5 = 2,500 \u00b7 \u00d715 = 15,000
  const LC_MUL = { enlisted: 1, commissioned: 2.5, admiralty: 15 };
  const RES_ORDER = ['gold', 'fuel', 'iron', 'plasma'];

  // Fixed landmarks. Everything else is filled by the rotation below.
  const LANDMARKS = {
    40:  { kind: 'hull', hull: 'vanguard' },       // three weeks of play
    50:  { kind: 'xpbuff' },                       // 1% / 2.5% / 5%, all stacking
    100: { kind: 'finale' },                       // shards / shards / the Praetorian
  };
  const XP_BUFF_PCT = { enlisted: 1, commissioned: 2.5, admiralty: 5 };

  // Deterministic rotation for every non-landmark, non-LootCoin level. Crates are
  // seeded through it so a resource run never goes more than two levels.
  const ROTATION = ['gold', 'item', 'fuel', 'shard', 'iron', 'item', 'plasma', 'shard'];

  function rewardAt(lv) {
    if (lv > MAX_LEVEL) return { kind: 'item', n: 1, flat: true };   // the 100+ stack
    if (LANDMARKS[lv]) return LANDMARKS[lv];
    if (LC_LEVELS.indexOf(lv) >= 0) return { kind: 'lc' };
    const r = ROTATION[(lv - 1) % ROTATION.length];
    return r === 'item' ? { kind: 'item' } : r === 'shard' ? { kind: 'shard' } : { kind: 'res', res: r };
  }

  // ---- what one CELL is worth -------------------------------------------
  // ---- FIXED PRIZES ------------------------------------------------------
  // Resource cells pay a FIXED, PUBLISHED amount. They used to pay a percentage of
  // whatever the pilot happened to be holding, which failed on every count that
  // matters: the cell could not state what it would give until you claimed it, the
  // reward rose for hoarding and vanished for spending, and it was unknowable in
  // advance — the reward table could not be printed, screenshotted or compared.
  //
  // A fixed amount is the opposite of all of that: the ladder is a published table,
  // identical for every pilot, and the cell says exactly what it pays before you
  // touch it. It also stops rewarding the wrong behaviour.
  //
  // THE AMOUNT RISES WITH THE LEVEL, not with the player. Level 90 should feel better
  // than level 3, so the base steps up across the ladder — but two pilots on level 90
  // get precisely the same prize, which is the whole point of doing it this way.
  //
  // Tracks pay ×1 / ×5 / ×10, keeping the shape the brief asked for (the old
  // 1% / 5% / 10%). Claiming all three on a gold level pays 16× the base.
  //
  // Tune HERE. These are the only numbers behind every resource cell in the season.
  const PRIZE_BASE = { gold: 50e6, fuel: 20000, iron: 20000, plasma: 20000 };
  const PRIZE_TRACK = { enlisted: 1, commissioned: 5, admiralty: 10 };
  // Level curve: 1× the base at level 1 rising to 100× at level 100, so the last
  // stretch of the ladder is worth pushing for.
  function prizeCurve(lv) { return Math.max(1, lv); }
  function fixedPrize(res, lv, track) {
    return Math.round((PRIZE_BASE[res] || 0) * prizeCurve(lv) * (PRIZE_TRACK[track] || 1));
  }
  // Crates still need the pilot's real depth — an item crate rolls at the zone you
  // have actually reached. `currentDungeon` is 0 whenever the screen is opened outside
  // a run, so progression is read from the recorded highs instead.
  function progZone() {
    const st = G().state;
    return Math.max(1, st.highestUnlocked | 0, st.currentDungeon | 0, st.highestDungeonReached | 0);
  }
  function cellValue(lv, track) {
    const r = rewardAt(lv), t = TRACK_BY_K[track] || TRACKS[0];
    if (r.kind === 'lc') return { kind: 'lc', n: Math.round(LC_FREE * LC_MUL[track]) };
    if (r.kind === 'item') return { kind: 'item', n: r.flat ? 1 : t.mul };
    if (r.kind === 'shard') return { kind: 'shard', n: t.mul };
    if (r.kind === 'xpbuff') return { kind: 'xpbuff', n: XP_BUFF_PCT[track] };
    if (r.kind === 'hull') return track === 'enlisted' ? { kind: 'hull', hull: r.hull } : { kind: 'shard', n: t.mul };
    if (r.kind === 'finale') {
      return track === 'admiralty' ? { kind: 'hull', hull: 'praetorian' }
        : { kind: 'shard', n: track === 'commissioned' ? 5 : 3 };
    }
    // resource cell — a fixed, published amount
    return { kind: 'res', res: r.res, mul: PRIZE_TRACK[track], n: fixedPrize(r.res, lv, track) };
  }

  // =========================================================================
  // XP AWARDS — one funnel, so a source can never pay twice in a period.
  // `dq`/`wq` latch the day and week a board has already paid for.
  // =========================================================================
  // ---- LAUNCHED (build 659) ---------------------------------------------------
  // Every door that ever read the beta flag is open for everyone from Level 1.
  // betaOn() stays exported so old callers can't break. NOTE ON ASCENSION: the
  // Tour NEVER resets — 'tour' (xp, levels, claims, paid tracks) and 'tourBeta'
  // are both in ASC_KEEP (game-v93.js), and the account merge unions them — so
  // ascending, relogging or switching devices cannot touch season progress.
  function betaOn() { return true; }
  function award(n, why) {
    const t = s(); if (!t || !live() || n <= 0) return 0;
    const before = level();
    // NO CEILING. This used to clamp at HARD_LEVEL * XP_PER_LEVEL (12,500), which
    // silently capped the overtime stack at 25 crates however many levels were
    // bought — the exact thing the 100+ stack exists to remove. The season's own
    // missions still only fund ~12,560 XP; buying is what goes past it.
    t.xp = Math.max(0, (t.xp | 0) + Math.round(n));
    try { G().save(); } catch (e) {}
    const after = level();
    // A HIDDEN FEATURE MUST NOT ANNOUNCE ITSELF. XP still accrues for everyone —
    // deliberately, so nobody who plays through the beta window arrives at launch
    // behind — but the level-up toast only fires for accounts that can actually
    // open the screen it is talking about.
    if (after > before && betaOn() && window.UI && window.UI.unlockToast) {
      window.UI.unlockToast('\u2726 TOUR OF DUTY \u2014 Level ' + after + (why ? ' \u00b7 ' + why : ''));
    }
    if ($('tour-body')) render();
    return after - before;
  }
  // RETIRED (634). The Tour used to take its XP from the GAME's mission boards via
  // these. It has its own boards now, so paying from both would double the budget.
  // Kept as no-ops on purpose: missions.js still calls them, and a browser serving a
  // cached copy of either file must not be able to pay twice.
  function dailyDone() {}
  function weeklyDone() {}

  // ---- TOUR MISSIONS — THE SEASON'S OWN BOARDS ---------------------------
  // These are NOT the game's daily/weekly mission boards. The Tour previously earned
  // its XP by piggybacking on those (the Commander's Crate), which meant the season
  // had no visible objectives of its own: a player could not see what to do today,
  // only that a number had gone up somewhere else.
  //
  // Four Tour dailies and three Tour weeklies, on their own reset clocks, with their
  // own progress. The XP BUDGET IS UNCHANGED — 4×40 is the same 160/day and 3×100 the
  // same 300/week the budget was always built on, now split into objectives a player
  // can read and tick off.
  //
  // EVERY METRIC IS A CUMULATIVE LIFETIME COUNTER, measured as a DELTA against a
  // baseline snapshotted at each reset. That is the only way a "today" target can work
  // on save data that only ever counts upward — and it survives a reload, unlike a
  // per-session tally.
  const TOUR_DAILY = [
    { id: 'd_kill', ic: '\u2316', name: 'Combat Patrol',   txt: 'Destroy {N} enemies',        m: 'kills',  n: 1500 },
    { id: 'd_boss', ic: '\u265b', name: 'Decapitation',    txt: 'Destroy {N} bosses',         m: 'bosses', n: 5 },
    { id: 'd_loot', ic: '\u25a1', name: 'Salvage Sweep',   txt: 'Recover {N} pieces of loot', m: 'loot',   n: 30 },
    { id: 'd_time', ic: '\u25f7', name: 'Time on Station', txt: 'Fly {N} minutes of combat',  m: 'mins',   n: 20 },
  ];
  const TOUR_WEEKLY = [
    { id: 'w_kill',  ic: '\u2604', name: 'Sustained Operations', txt: 'Destroy {N} enemies',    m: 'kills', n: 15000 },
    { id: 'w_msn',   ic: '\u2318', name: 'Standing Orders',      txt: 'Complete {N} missions',  m: 'msn',   n: 15 },
    { id: 'w_cargo', ic: '\u26df', name: 'Logistics Run',        txt: 'Deliver {N} manifests',  m: 'cargo', n: 3 },
  ];
  const XP_TOUR_DAILY = Math.round(XP_DAILY / TOUR_DAILY.length);    // 40
  const XP_TOUR_WEEKLY = Math.round(XP_WEEKLY / TOUR_WEEKLY.length); // 100

  // The raw lifetime counters the deltas are taken from.
  function counters() {
    const st = G().state, L = st.lifeStats || {};
    return {
      kills: st.totalKills | 0,
      bosses: L.boss | 0,
      loot: st.itemsFound | 0,
      mins: Math.floor((st.playTime || 0) / 60),
      msn: st.lifetimeMissions | 0,
      cargo: L.cargo | 0,
    };
  }
  // Snapshot on each reset. `dn`/`wn` record which period a baseline belongs to, so a
  // rollover is detected without a timer and the boards reset even if the game was shut.
  function syncBoards() {
    const t = s(); if (!t) return;
    const d = dayIndex(), w = weekIndex();
    if (t.dn !== d) { t.dn = d; t.bd = counters(); t.dd = {}; }
    if (t.wn !== w) { t.wn = w; t.bw = counters(); t.wd = {}; }
    if (!t.bd) t.bd = counters(); if (!t.bw) t.bw = counters();
    if (!t.dd) t.dd = {}; if (!t.wd) t.wd = {};
  }
  function missionProgress(def, kind) {
    const t = s(); if (!t) return 0;
    syncBoards();
    const base = kind === 'd' ? t.bd : t.bw;
    return Math.max(0, (counters()[def.m] | 0) - ((base || {})[def.m] | 0));
  }
  // Auto-credited, like the challenges: the moment the number is passed, the XP lands.
  // A season board that also needed claiming would be a second chore for no decision.
  function sweepMissions() {
    const t = s(); if (!t || !live()) return 0;
    syncBoards();
    let paid = 0;
    TOUR_DAILY.forEach((m) => { if (!t.dd[m.id] && missionProgress(m, 'd') >= m.n) { t.dd[m.id] = 1; paid += XP_TOUR_DAILY; } });
    TOUR_WEEKLY.forEach((m) => { if (!t.wd[m.id] && missionProgress(m, 'w') >= m.n) { t.wd[m.id] = 1; paid += XP_TOUR_WEEKLY; } });
    if (paid) award(paid, 'tour mission');
    return paid;
  }
  const boardDone = (kind) => {
    const t = s(); if (!t) return 0;
    const list = kind === 'd' ? TOUR_DAILY : TOUR_WEEKLY, map = kind === 'd' ? t.dd : t.wd;
    return list.filter((m) => (map || {})[m.id]).length;
  };
  function untilReset(kind) {
    const span = kind === 'd' ? DAY_MS : WEEK_MS;
    const idx = kind === 'd' ? dayIndex() : weekIndex();
    const ms = Math.max(0, START + (idx + 1) * span - now());
    const h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000);
    return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
  }

  // ==========================================================================
  // CLAIMING
  // =========================================================================
  const claimKey = (lv, k) => lv + ':' + k;
  function claimable(lv, k) {
    const t = s(); if (!t) return false;
    if (lv > level()) return false;
    if (!owns(k)) return false;
    if (t.claim[claimKey(lv, k)]) return false;
    // past 100 there are no per-level cells at all — the overtime crates stack and
    // are claimed together (claimOver)
    if (lv > MAX_LEVEL) return false;
    return true;
  }
  function pendingCount() {
    let n = 0;
    const top = Math.min(level(), MAX_LEVEL);
    for (let lv = 1; lv <= top; lv++) TRACKS.forEach((t) => { if (claimable(lv, t.k)) n++; });
    return n + overPending();
  }

  // Grants one cell. Returns a display line, or null.
  // Returns an ARRAY OF LINE OBJECTS — { ic | img, col, text, sub } — not strings, so
  // the receipt can draw a ship's actual art for a shard and a currency's own colour
  // for a resource. A string could only ever carry a glyph.
  function grant(v) {
    const g = G(), st = g.state;
    if (v.kind === 'lc') {
      if (g.addCredits) g.addCredits(v.n); else st.credits = (st.credits || 0) + v.n;
      return [{ ic: lcIcon(16), col: LC_COL, text: fmt(v.n) + ' LootCoins', raw: true }];
    }
    if (v.kind === 'res') {
      const d = RES[v.res] || RES.gold;
      if (v.res === 'gold') st.gold = (st.gold || 0) + v.n;
      else { st.resources = st.resources || {}; st.resources[v.res] = (st.resources[v.res] || 0) + v.n; }
      return [{ ic: d.ic, col: d.col, text: fmt(v.n) + ' ' + d.name }];
    }
    if (v.kind === 'item') return openItemCrates(v.n);
    if (v.kind === 'shard') return openShardCrates(v.n);
    if (v.kind === 'xpbuff') return [{ ic: '\u2726', col: '#7ce0ff', text: '+' + v.n + '% XP gain', sub: 'permanent' }];
    if (v.kind === 'hull') {
      const sh = (C().SHIP_BY_KEY || {})[v.hull] || {};
      const owned = !!(st.ownedShips && st.ownedShips[v.hull]);
      if (!owned) { try { g.grantShip(v.hull); } catch (e) {} }
      return [{ img: 'ships/ship-' + v.hull + '.png', col: '#ffd24d', text: sh.name || v.hull,
                sub: owned ? 'already owned' : (sh.tag || 'hull') }];
    }
    return [];
  }
  // THE SAME GLYPH AND COLOUR EVERY OTHER SCREEN USES for these currencies (the
  // build-cost chips in ui-v94, the wallet row in cargo-defense). A reward that is
  // gold should be gold-coloured wherever it appears, or the player has to read the
  // word to know what they got.
  const RES = {
    gold:   { ic: '\u25cf', col: '#f2b24b', name: 'gold' },
    fuel:   { ic: '\u2b22', col: '#5bc0ff', name: 'fuel' },
    iron:   { ic: '\u25c6', col: '#d0a060', name: 'iron' },
    plasma: { ic: '\u2726', col: '#c07bff', name: 'plasma' },
  };
  const LC_COL = '#ffd66a', ITEM_COL = '#7ce0a0';
  // The real top-bar coin, at whatever size the surface needs. `◈` was standing in for
  // it everywhere in this module, which made LootCoins the only currency in the game not
  // showing its own icon.
  const lcIcon = (px) => (window.lootCoinSVG ? window.lootCoinSVG(px) : '\u25c8');
  const RES_ICON = { gold: RES.gold.ic, fuel: RES.fuel.ic, iron: RES.iron.ic, plasma: RES.plasma.ic };

  // ITEM CRATE — one fitting, rolled at the deepest zone the pilot has unlocked,
  // any rarity from Common to Artifact. Same generator every drop uses, so a crate
  // item is indistinguishable from a floor drop and needs no separate balance.
  function openItemCrates(n) {
    const g = G(), out = [];
    const zone = progZone();
    for (let i = 0; i < n; i++) {
      try {
        const it = window.ITEMS.generate(zone);
        if (g.state.inventory.length < (g.invCap ? g.invCap() : 200)) g.state.inventory.push(it);
        else if (g.addSalvage) g.addSalvage(it);
        const r = (C().RARITY || [])[it.rarity] || {};
        // the rarity's own colour, so a Legendary drop reads as one at a glance
        out.push({ ic: '\u2756', col: r.color || ITEM_COL, text: it.name,
                   sub: (r.name || '') + ' \u00b7 ' + (C().SLOTS[it.slot] || {}).name });
      } catch (e) {}
    }
    return out.length ? out : [{ ic: '\u2756', col: ITEM_COL, text: n + ' item crate' + (n === 1 ? '' : 's') }];
  }
  // SHIP SHARD CRATE — one shard toward a random hull between Frigate and Titan
  // Sina. Shards ride `state.shipParts`, the same field the Season 1 event hull
  // uses, so 100 shards assembles a hull through machinery that already exists.
  //
  // THE POOL IS THE SHIPWORKS ROSTER, NOT A GUESS. This used to be a hand-kept
  // exclusion list over every hull in the config, which let shards drop toward
  // ships that have no part requirement — no Inventory row, no Exchange row, no
  // ASSEMBLE. Those shards were unspendable. The pool is now exactly the set of
  // hulls the Shipworks can build, so every shard the Tour pays is redeemable
  // and can climb the Exchange. The old filter stays only as a fallback for the
  // window where shipworks.js has not parsed yet.
  const SHARD_POOL = () => {
    const ships = C().SHIPS || [];
    try {
      const keys = window.SHIPWORKS && window.SHIPWORKS.buildableKeys && window.SHIPWORKS.buildableKeys();
      if (keys && keys.length) { const set = {}; keys.forEach((k) => { set[k] = 1; }); return ships.filter((sh) => set[sh.key]); }
    } catch (e) {}
    return ships.filter((sh) =>
      !sh.unreleased && !sh.celestial && !sh.alienTech && !sh.emberTech && !sh.event
      && sh.key !== 'aeternum' && (sh.tier == null || sh.tier >= 0));
  };
  // WEIGHTED BY LADDER POSITION — the pick used to be uniform, which made a
  // Titan Sina shard exactly as common as a Frigate shard (players were pulling
  // 3 Sina shards in ~15 crates). Weight now decays 18% per rung of the pool
  // (config order = progression order), floored at 1.5: the first hulls carry
  // ~100x the weight of the apex tail, so crates mostly finish early hulls and
  // an apex shard is a real event (~0.3% a crate), not a fifth of every haul.
  function shardWeights(pool) {
    const w = pool.map((_, i) => Math.max(1.5, 100 * Math.pow(0.82, i)));
    return { w, sum: w.reduce((a, b) => a + b, 0) };
  }
  function openShardCrates(n) {
    const g = G(), pool = SHARD_POOL(), out = [];
    const { w, sum } = shardWeights(pool);
    if (!pool.length) return [{ ic: '\u25c8', col: '#8fa3bd', text: n + ' shard' + (n === 1 ? '' : 's') }];
    g.state.shipParts = g.state.shipParts || {};
    for (let i = 0; i < n; i++) {
      let r = Math.random() * sum, pi = 0;
      while (pi < w.length - 1 && (r -= w[pi]) > 0) pi++;
      const sh = pool[pi];
      const have = g.state.shipParts[sh.key] = (g.state.shipParts[sh.key] | 0) + 1;
      // THE SHIP'S OWN ART, not a diamond. A shard is meaningless without knowing
      // which hull it is toward, and the name alone makes 5 shards a wall of text.
      out.push({ img: 'ships/ship-' + sh.key + '.png', col: '#9ad4ff',
                 text: sh.name + ' shard', sub: have + ' / 100 collected', pct: have });
    }
    return out;
  }

  function claim(lv, k) {
    if (!claimable(lv, k)) return null;
    const t = s();
    const lines = (grant(cellValue(lv, k)) || []).map((l) => Object.assign({ lv }, l));
    t.claim[claimKey(lv, k)] = 1;
    try { G().save(); } catch (e) {}
    return lines;
  }

  function claimAll() {
    const lines = [];
    const top = Math.min(level(), MAX_LEVEL);
    for (let lv = 1; lv <= top; lv++) {
      TRACKS.forEach((tr) => { const l = claim(lv, tr.k); if (l) l.forEach((x) => lines.push(x)); });
    }
    claimOver().forEach((x) => lines.push(x));
    if (lines.length) { try { G().save(); } catch (e) {} render(); }
    return lines;
  }

  // ---- PACE ---------------------------------------------------------------
  // DAYS, NOT BOARDS. The first version divided the shortfall by the DAILY value alone,
  // ignoring the weekly board and the challenges — so it reported "58 more daily
  // boards" with only 51 days left, an impossibility printed beside "you are on pace".
  // A pilot clearing both boards earns the daily value plus a seventh of the weekly
  // every day, so that is the rate the estimate uses.
  //
  // It lives here, with the maths, because it was defined inside the render block and
  // vanished when that block was rewritten.
  function pace() {
    const t = s();
    const totalDays = WEEKS * 7;
    const dayNow = Math.min(totalDays, dayIndex() + 1);
    const daysLeft = Math.max(0, totalDays - dayIndex());
    const weeksLeft = Math.max(0, WEEKS - weekIndex());
    syncBoards();
    const dDone = boardDone('d'), wDone = boardDone('w');
    const dailyDoneToday = dDone >= TOUR_DAILY.length;
    const weeklyDoneThisWeek = wDone >= TOUR_WEEKLY.length;
    // today's and this week's boards count only what is still OPEN on them
    const ahead = (daysLeft - 1) * XP_DAILY + (TOUR_DAILY.length - dDone) * XP_TOUR_DAILY
      + (weeksLeft - 1) * XP_WEEKLY + (TOUR_WEEKLY.length - wDone) * XP_TOUR_WEEKLY;
    const projected = Math.min(HARD_LEVEL, 1 + Math.floor((xp() + Math.max(0, ahead)) / XP_PER_LEVEL));
    const need100 = Math.max(0, MAX_LEVEL * XP_PER_LEVEL - xp() - XP_PER_LEVEL);
    const perDay = XP_DAILY + XP_WEEKLY / 7;
    const daysNeeded = perDay > 0 ? Math.ceil(need100 / perDay) : 0;
    return { totalDays, dayNow, daysLeft, weeksLeft, dailyDoneToday, weeklyDoneThisWeek,
             ahead: Math.max(0, ahead), projected, need100, perDay: Math.round(perDay),
             daysNeeded, spare: daysLeft - daysNeeded, dDone, wDone };
  }

  // ---- XP BUFF HOOK -------------------------------------------------------
  // Read by game-v93's xpSources(). Sums whichever level-50 cells were CLAIMED,
  // so the buff is something you collected, not something you were owed.
  function xpBuffPct() {
    const t = s(); if (!t) return 0;
    let p = 0;
    TRACKS.forEach((tr) => { if (t.claim[claimKey(50, tr.k)]) p += XP_BUFF_PCT[tr.k]; });
    return p;
  }
  function mult() { return 1 + xpBuffPct() / 100; }

  // ---- BUYING THE NEXT LEVEL ----------------------------------------------
  // Priced off the XP actually MISSING, so progress already earned is never
  // charged for twice: 3,000 ◈ buys a whole level, 1,800 ◈ finishes one sitting
  // at 40/100. Buying is exactly the same as earning it — the XP goes through
  // award(), so it can push you through several claim levels and into the
  // overtime stack like any other XP.
  function buyLevelCost() { return (XP_PER_LEVEL - intoLevel()) * LC_PER_XP; }
  // ---- ADMIN REPAIR (console: TOUR.setXp(n)) --------------------------------
  // Hard-sets season XP and stamps the correction epoch `xf` — without the stamp
  // a DOWNWARD repair cannot survive: the merge rule takes the higher xp, so the
  // old figure returns on the next conflicted login (account.js honours xf).
  // Drops claim marks above the new level and clamps the overtime counter so
  // nothing stays claimed or pre-opened for levels no longer reached, then saves
  // and pushes so the cloud copy is corrected immediately.
  function setXp(n) {
    const t = s(); if (!t) return false;
    t.xp = Math.max(0, Math.round(+n || 0));
    t.xf = Date.now();
    const lv = level();
    if ((t.ov | 0) > Math.max(0, lv - MAX_LEVEL)) t.ov = Math.max(0, lv - MAX_LEVEL);
    Object.keys(t.claim || {}).forEach((k) => { if ((parseInt(k, 10) || 0) > lv) delete t.claim[k]; });
    try { G().save(); } catch (e) {}
    try { if (window.ACCOUNT && window.ACCOUNT.publishNow) window.ACCOUNT.publishNow(); } catch (e) {}
    try { render(); } catch (e) {}
    return { xp: t.xp, level: lv, over: overReached() };
  }
  function buyLevel() {
    const t = s(), g = G(); if (!t) return { ok: false };
    if (!live()) return { ok: false, reason: 'ended' };
    const need = XP_PER_LEVEL - intoLevel(), cost = need * LC_PER_XP;
    if ((g.state.credits || 0) < cost) return { ok: false, reason: 'credits', cost };
    g.state.credits -= cost;
    const before = level(), xpBefore = xp();
    award(need, 'bought');
    // MONEY MOVED, SO CONFIRM THE GOODS. award() can refuse (a season that ended
    // between the sheet opening and the tap); never take credits for nothing.
    if (xp() <= xpBefore) { g.state.credits += cost; try { g.save(); } catch (e) {} return { ok: false, reason: 'ended' }; }
    try { g.save(); } catch (e) {}
    render();
    return { ok: true, cost, level: level(), gained: level() - before };
  }

  // ---- BUYING A TRACK -----------------------------------------------------
  function buy(k) {
    const t = s(), g = G(); if (!t || !PRICE[k]) return { ok: false };
    if (t.own[k]) return { ok: false, reason: 'owned' };
    if (!live()) return { ok: false, reason: 'ended' };
    const price = PRICE[k];
    if ((g.state.credits || 0) < price) return { ok: false, reason: 'credits' };
    g.state.credits -= price;
    t.own[k] = 1;
    try { g.save(); } catch (e) {}
    render();
    return { ok: true };
  }

  // ---- END OF SEASON ------------------------------------------------------
  // Everything unclaimed is granted automatically and itemised into the mailbox.
  // Runs once (`settled`), and only after the season has actually closed on the
  // trusted clock \u2014 a device clock cannot trigger an early payout.
  function settle() {
    const t = s(); if (!t || t.settled || !ended()) return;
    if (ST() && !ST().trusted() && !ST().usable()) return;   // wait for a real clock
    t.settled = 1;
    const lines = claimAll();
    try { G().save(); } catch (e) {}
    try {
      if (window.MAIL && window.MAIL.push) {
        window.MAIL.push({
          from: 'Fleet Admiralty',
          subj: '\u2726 Tour of Duty \u2014 Season ' + SEASON + ' closed',
          body: '<p>Your tour is complete at <b>Level ' + (level() > MAX_LEVEL ? MAX_LEVEL + '+ (' + overReached() + ' fittings past the ladder)' : level()) + '</b>.</p>' +
            (lines.length
              ? '<p>Everything still outstanding has been issued to you:</p><ul>' +
                lines.map((l) => '<li>Lv ' + (l.lv || '?') + ' \u2014 ' + esc(l.text || '') +
                  (l.sub ? ' <i>(' + esc(l.sub) + ')</i>' : '') + '</li>').join('') + '</ul>'
              : '<p>Every reward had already been claimed \u2014 nothing was left outstanding.</p>') +
            '<p>The next tour begins shortly. Stand by.</p>',
        });
      }
    } catch (e) {}
  }

  window.TOUR = {
    render, s, level, xp, intoLevel, owns, buy, claim, claimAll, pendingCount, pace, betaOn, setXp,
    buyLevel, buyLevelCost, claimOver, overPending, overReached,
    dailyDone, weeklyDone, sweepMissions, award, settle,
    TOUR_DAILY, TOUR_WEEKLY, XP_TOUR_DAILY, XP_TOUR_WEEKLY, missionProgress, boardDone, untilReset,
    xpBuffPct, mult, live, ended, leftText, msLeft,
    SEASON, SEASON_NAME, WEEKS, MAX_LEVEL, HARD_LEVEL, XP_PER_LEVEL, PRICE, TRACKS,
    START, END, XP_DAILY, XP_WEEKLY,
    rewardAt, cellValue,
  };
  // Late-season housekeeping: settle as soon as the clock says the tour is over,
  // and sweep challenges on boot so nothing sits earned-but-unpaid.
  setTimeout(() => { try { sweepMissions(); settle(); } catch (e) {} }, 4000);
  setInterval(() => { try { sweepMissions(); settle(); } catch (e) {} }, 30000);

  /* ===========================================================================
     RENDER
     ---------------------------------------------------------------------------
     REBUILT (630). The first cut put the ladder FIFTH, behind four explainer cards:
     634 words and 2,256px of reading before a player saw a single reward, on a 779px
     viewport. Everything was on screen at once and nothing was prioritised, so the
     feature read as homework.
     
     Rebuilt around the three questions a player actually has, in that order:
     
       1. What do I get NEXT?      → one large card, with art
       2. What am I working toward? → three milestones, with art
       3. Show me the rest          → the ladder, windowed to ±6 levels
     
     Every word of explanation moved into a single "?" sheet that opens on demand.
     Nothing is deleted — it is just no longer in the way of the thing it explains.
     ======================================================================== */
  function render() {
    const body = $('tour-body'); if (!body) return;
    const t = s(); if (!t) return;
    sweepMissions();
    const sub = $('tour-sub');
    if (sub) sub.textContent = live() ? 'Level ' + level() + ' · ' + leftText() + ' left' : (ended() ? 'Season closed' : 'Not yet open');
    body.innerHTML = heroHTML() + nextUpHTML() + boardsHTML() + milestonesHTML() + tracksHTML() + ladderHTML();
    wire(body);
  }

  // ---- 1 · HERO: level, progress, time, and ONE line of pace ---------------
  function heroHTML() {
    const lv = level(), pend = pendingCount(), p = pace();
    const pct = intoLevel() / XP_PER_LEVEL * 100;
    const onPace = p.projected >= MAX_LEVEL || lv >= MAX_LEVEL;
    const over = lv > MAX_LEVEL;
    const cost = buyLevelCost(), afford = (G().state.credits || 0) >= cost;
    return '<div class="tp-hero">' +
      '<div class="tp-hero-rings"><i></i><i></i></div>' +
      '<button class="tp-help" id="tp-help" title="How it works">?</button>' +
      '<div class="tp-hero-tag">TOUR OF DUTY · SEASON ' + SEASON + '</div>' +
      '<div class="tp-hero-t">' + SEASON_NAME + '</div>' +
      '<div class="tp-lv"><b>' + (over ? MAX_LEVEL + '+' : lv) + '</b><em>' +
        (over ? overReached() + ' fitting' + (overReached() === 1 ? '' : 's') + ' earned' : 'level') + '</em></div>' +
      '<div class="tp-bar"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
      '<div class="tp-bar-l"><span>' + intoLevel() + '/' + XP_PER_LEVEL + ' XP</span>' +
        '<span>' + (live() ? leftText() + ' left' : ended() ? 'closed' : 'soon') + '</span></div>' +
      (live() ? '<button class="tp-buylv' + (afford ? '' : ' poor') + '" id="tp-buylv">' +
        '<span>BUY ' + (over ? 'THE NEXT FITTING' : 'LEVEL ' + (lv + 1)) + '</span>' +
        '<em>' + fmt(cost) + ' ◈</em></button>' : '') +
      '<div class="tp-pace1' + (onPace ? ' good' : '') + '">' +
        (lv >= MAX_LEVEL ? 'Level ' + MAX_LEVEL + ' cleared · every level now pays a fitting'
          : onPace ? p.dDone + '/' + TOUR_DAILY.length + ' today · ' + p.daysNeeded + ' more days needed of ' + p.daysLeft + ' left'
          : 'Behind pace · everything left reaches level ' + p.projected) + '</div>' +
      (pend ? '<button class="tp-claimall" id="tp-claimall">CLAIM ' + pend + '</button>' : '') +
      '</div>';
  }

  // ---- 2 · NEXT UP: the single reward the player is about to get ------------
  // The one thing that was missing entirely. A ladder answers "what is the shape of
  // this season"; it does not answer "what do I get for playing tonight".
  function nextUpHTML() {
    const lv = level();
    const target = lv + 1;
    const cells = target > MAX_LEVEL
      ? [{ tr: TRACKS[0], v: { kind: 'item', n: 1 } }]
      : TRACKS.filter((tr) => owns(tr.k)).map((tr) => ({ tr, v: cellValue(target, tr.k) })).filter((x) => x.v);
    const hull = cells.filter((x) => x.v.kind === 'hull')[0];
    const need = XP_PER_LEVEL - intoLevel();
    return '<div class="tp-next' + (hull ? ' big' : '') + '">' +
      '<div class="tp-next-h">NEXT · ' + (target > MAX_LEVEL ? 'FITTING #' + (target - MAX_LEVEL) : 'LEVEL ' + target) +
        '<em>' + need + ' XP away</em></div>' +
      (hull
        ? '<div class="tp-next-hull"><img src="ships/ship-' + hull.v.hull + '.png" alt="" decoding="async" onerror="this.remove()">' +
          '<div><div class="tp-next-hn">' + esc(((C().SHIP_BY_KEY || {})[hull.v.hull] || {}).name || hull.v.hull) + '</div>' +
          '<div class="tp-next-hs">' + hull.tr.name + ' · the whole hull</div></div></div>'
        : '') +
      '<div class="tp-next-row">' + (cells.length
        ? cells.map((x) => {
            const l = cellLine(x.v);
            return '<div class="tp-next-c" style="--tc:' + x.tr.col + '"><span class="tp-next-ic' + (l.raw ? ' svg' : '') + '" style="color:' + l.col + '">' + l.ic + '</span>' +
              '<b>' + esc(l.big) + '</b><em>' + esc(l.small) + '</em></div>';
          }).join('')
        : '<div class="tp-next-none">Unlock a track to claim rewards</div>') + '</div>' +
      '</div>';
  }

  // ONE place that turns a reward into display strings. Every surface — the next-up
  // card, a ladder cell, a milestone — reads from this, so they cannot drift apart.
  function cellLine(v) {
    if (v.kind === 'lc') return { ic: '◈', col: LC_COL, big: fmt(v.n), small: 'LootCoins' };
    if (v.kind === 'res') { const d = RES[v.res] || RES.gold; return { ic: d.ic, col: d.col, big: fmt(v.n), small: d.name }; }
    if (v.kind === 'item') return { ic: '❖', col: ITEM_COL, big: v.n + '×', small: v.n === 1 ? 'fitting' : 'fittings' };
    if (v.kind === 'shard') return { ic: '◈', col: '#9ad4ff', big: v.n + '×', small: 'shards' };
    if (v.kind === 'xpbuff') return { ic: '✦', col: '#7ce0ff', big: '+' + v.n + '%', small: 'XP forever' };
    if (v.kind === 'hull') { const sh = (C().SHIP_BY_KEY || {})[v.hull] || {}; return { ic: '⬢', col: '#ffd24d', big: 'HULL', small: sh.name || v.hull, hull: v.hull }; }
    return { ic: '—', col: '#5b6480', big: '—', small: '' };
  }

  // ---- 3 · MILESTONES: the three things worth playing for ------------------
  // TOUR MISSIONS — titled so it can never be confused with the game's own boards,
  // which live on a different screen and pay different rewards. Both boards on one card,
  // each with its own reset countdown and a done/total tally.
  function boardsHTML() {
    const t = s();
    const board = (kind, list, xpEach, label) => {
      const map = (kind === 'd' ? t.dd : t.wd) || {};
      const done = boardDone(kind);
      return '<div class="tp-bd">' +
        '<div class="tp-bd-h"><b>' + label + '</b>' +
          '<span>' + done + '/' + list.length + ' · resets in ' + untilReset(kind) + '</span></div>' +
        list.map((m) => {
          const have = missionProgress(m, kind), got = !!map[m.id];
          const pc = Math.min(100, have / m.n * 100);
          return '<div class="tp-msn' + (got ? ' done' : '') + '">' +
            '<span class="tp-msn-ic">' + m.ic + '</span>' +
            '<div class="tp-msn-m"><div class="tp-msn-n">' + esc(m.name) + '</div>' +
              '<div class="tp-msn-t">' + m.txt.replace('{N}', '<b>' + fmt(m.n) + '</b>') + '</div>' +
              '<div class="tp-msn-bar"><i style="width:' + pc.toFixed(1) + '%"></i></div></div>' +
            '<div class="tp-msn-r">' + (got ? '<span class="tp-msn-tick">✓</span>' : '<b>' + fmt(Math.min(have, m.n)) + '/' + fmt(m.n) + '</b>') +
              '<em>+' + xpEach + ' XP</em></div>' +
            '</div>';
        }).join('') + '</div>';
    };
    return '<div class="tp-card"><div class="tp-card-h">⌘ TOUR MISSIONS<em>season pass only · auto-credited</em></div>' +
      board('d', TOUR_DAILY, XP_TOUR_DAILY, 'DAILY') +
      board('w', TOUR_WEEKLY, XP_TOUR_WEEKLY, 'WEEKLY') +
      '</div>';
  }

  function milestonesHTML() {
    const lv = level();
    const M = [
      { lv: 40,  k: 'enlisted',  label: 'FREE' },
      { lv: 50,  k: 'admiralty', label: 'XP BUFF' },
      { lv: 100, k: 'admiralty', label: 'ADMIRALTY' },
    ];
    return '<div class="tp-miles">' + M.map((m) => {
      const v = cellValue(m.lv, m.k), l = cellLine(v);
      const done = lv >= m.lv;
      return '<div class="tp-mile' + (done ? ' done' : '') + (l.hull ? ' hull' : '') + '">' +
        (l.hull
          ? '<img class="tp-mile-art" src="ships/ship-' + l.hull + '.png" alt="" decoding="async" onerror="this.remove()">'
          : '<span class="tp-mile-ic' + (l.raw ? ' svg' : '') + '" style="color:' + l.col + '">' + l.ic + '</span>') +
        '<div class="tp-mile-lv">LV ' + m.lv + '</div>' +
        '<div class="tp-mile-n">' + esc(l.hull ? l.small : l.big + ' ' + l.small) + '</div>' +
        '<div class="tp-mile-t">' + m.label + '</div>' +
        (done ? '<span class="tp-mile-tick">✓</span>' : '') +
        '</div>';
    }).join('') + '</div>';
  }

  // ---- 4 · TRACKS: what you get, what it costs, and one button ------------
  // These were three inert chips reading "COMMISSIONED ◈ 5K" — a name and a number,
  // with no statement of what the money buys and nothing that looked like a button. A
  // paid track is the only purchase on this screen, so it gets a real card: the value
  // as pills, the price as a pill, and a full-width CTA.
  //
  // The value line is COMPUTED from the ladder, not written by hand, so it can never
  // drift from what the columns actually pay.
  function trackValue(k) {
    let lc = 0, crates = 0, shards = 0, hull = null, xpb = 0;
    for (let lv = 1; lv <= MAX_LEVEL; lv++) {
      const v = cellValue(lv, k);
      if (v.kind === 'lc') lc += v.n;
      else if (v.kind === 'item') crates += v.n;
      else if (v.kind === 'shard') shards += v.n;
      else if (v.kind === 'xpbuff') xpb = v.n;
      else if (v.kind === 'hull') hull = v.hull;
    }
    return { lc, crates, shards, hull, xpb, resMul: PRIZE_TRACK[k] };
  }

  function tracksHTML() {
    return '<div class="tp-card"><div class="tp-card-h">◉ TRACKS<em>columns stack · unlocks levels already passed</em></div>' +
      '<div class="tp-trk">' + TRACKS.map((tr) => {
        const have = owns(tr.k), price = PRICE[tr.k], val = trackValue(tr.k);
        const shipName = val.hull ? (((C().SHIP_BY_KEY || {})[val.hull] || {}).name || val.hull) : null;
        const pills = [
          ['❖', val.crates + ' fittings'],
          ['◈', val.shards + ' shards'],
          [lcIcon(11), fmt(val.lc), true],
          ['●', '×' + val.resMul + ' resources'],
          ['✦', '+' + val.xpb + '% XP'],
        ].concat(shipName ? [['⬢', shipName, false, true]] : []);
        return '<div class="tp-trkc' + (have ? ' have' : '') + '" style="--tc:' + tr.col + '">' +
          '<div class="tp-trkc-h"><b>' + tr.name + '</b>' +
            (have ? '<span class="tp-trkc-on">✓ ACTIVE</span>'
                  : price ? '<span class="tp-trkc-p">' + lcIcon(12) + ' ' + fmt(price) + '</span>'
                  : '<span class="tp-trkc-free">FREE</span>') + '</div>' +
          '<div class="tp-vp">' + pills.map((p) =>
            '<span class="tp-vpill' + (p[3] ? ' hull' : '') + '"><i' + (p[2] ? ' class="svg"' : '') + '>' + p[0] + '</i>' + esc(p[1]) + '</span>').join('') + '</div>' +
          (have
            ? '<div class="tp-cta on">✓ UNLOCKED FOR THE SEASON</div>'
            : price
              ? '<button class="tp-cta" data-buy="' + tr.k + '">UNLOCK · ' + lcIcon(13) + ' ' + fmt(price) + '</button>'
              : '<div class="tp-cta on">✓ ALWAYS YOURS</div>') +
          '</div>';
      }).join('') + '</div></div>';
  }

  // ---- 5 · THE LADDER, windowed ------------------------------------------
  // 125 rows was a wall. It opens on a window around the current level — what is
  // claimable and what is next — with the full table one tap away.
  let _showAll = false;

  // The pill for one level: state, and the cost to reach it when it is still ahead.
  // XP-away is measured from the pilot's live total, so it counts down as they play.
  function rowPill(lv) {
    const t = s(), cur = level();
    // 1 · still ahead — what it costs to reach
    if (lv > cur) {
      const away = Math.max(0, (lv - 1) * XP_PER_LEVEL - xp());
      return { cls: 'cost', txt: fmt(away) + ' XP', title: fmt(away) + ' XP to reach level ' + lv };
    }
    // the cells that exist on THIS level for tracks the pilot actually holds
    const mine = TRACKS.filter((tr) => owns(tr.k));
    const ready = mine.filter((tr) => claimable(lv, tr.k)).length;
    // 2 · something of mine is waiting
    if (ready) return { cls: 'ready', txt: 'CLAIM ' + ready, title: ready + ' reward' + (ready === 1 ? '' : 's') + ' waiting' };
    // 3 · EVERYTHING I OWN IS COLLECTED. This has to come before the locked-track hint:
    // checking for unowned tracks first meant a free-track pilot never saw this state at
    // all, so a collected level still advertised CLAIM.
    const allMine = mine.length && mine.every((tr) => t.claim[claimKey(lv, tr.k)]);
    if (allMine) {
      const locked = TRACKS.filter((tr) => !owns(tr.k)).length;
      return locked
        ? { cls: 'done', txt: '✓ CLAIMED', title: 'Collected · ' + locked + ' more behind a paid track' }
        : { cls: 'done', txt: '✓ CLAIMED', title: 'Everything on this level collected' };
    }
    // 4 · reached, but nothing here belongs to me yet
    return { cls: 'part', txt: 'LOCKED', title: 'Reached — unlock a track to claim this level' };
  }

  function ladderHTML() {
    const lv = level();
    // Start at the lowest level that still has something waiting, not simply lv-2:
    // a pilot with unclaimed rewards on level 1 could otherwise not see them in the
    // ladder at all. Falls back to lv-2 when nothing is outstanding.
    let firstPending = 0;
    for (let j = 1; j <= lv && !firstPending; j++) {
      if (TRACKS.some((tr) => claimable(j, tr.k))) firstPending = j;
    }
    const from = _showAll ? 1 : Math.max(1, Math.min(firstPending || (lv - 2), lv - 2) || 1);
    const to = _showAll ? MAX_LEVEL : Math.min(MAX_LEVEL, lv + 6);
    let rows = '';
    for (let i2 = from; i2 <= to; i2++) {
      const reached = i2 <= lv;
      const hullRow = TRACKS.some((tr) => cellValue(i2, tr.k).kind === 'hull');
      const pill = rowPill(i2);
      rows += '<div class="tp-row' + (reached ? ' reached' : '') + (i2 === lv ? ' now' : '') +
          (hullRow ? ' hullrow' : '') + '">' +
        '<div class="tp-lvcol">' +
          '<div class="tp-lvn">' + i2 + '</div>' +
          '<div class="tp-pill ' + pill.cls + '" title="' + esc(pill.title) + '">' + pill.txt + '</div>' +
        '</div>' +
        TRACKS.map((tr) => cellHTML(i2, tr)).join('') + '</div>';
    }
    return '<div class="tp-card"><div class="tp-card-h">◈ REWARDS' +
        '<em>' + (_showAll ? 'all ' + MAX_LEVEL + ' levels' : 'levels ' + from + '–' + to) + '</em></div>' +
      '<div class="tp-head"><div class="tp-lvcol"><span class="tp-hlv">LV</span></div>' +
        TRACKS.map((tr) => '<div class="tp-hcell" style="--tc:' + tr.col + '">' + tr.name.slice(0, 4) + '</div>').join('') + '</div>' +
      '<div class="tp-ladder' + (_showAll ? ' all' : '') + '">' + rows + '</div>' +
      '<button class="tp-toggle" id="tp-toggle">' + (_showAll ? 'Show less' : 'See all ' + MAX_LEVEL + ' levels') + '</button>' +
      overtimeHTML() +
      '</div>';
  }

  // ---- THE 100+ STACK ------------------------------------------------------
  // One card instead of 25 rows, and it never runs out: every level past 100 adds
  // a fittings crate to the same pile, and the pile is claimed in one tap.
  function overtimeHTML() {
    const reached = overReached(), pend = overPending(), taken = overClaimed();
    const lv = level();
    return '<div class="tp-over' + (pend ? ' ready' : '') + '">' +
      '<div class="tp-over-h"><b>LEVEL ' + MAX_LEVEL + '+</b>' +
        '<em>every ' + XP_PER_LEVEL + ' XP past ' + MAX_LEVEL + ' · one fitting crate, stacking, no ceiling</em></div>' +
      '<div class="tp-over-row">' +
        '<div class="tp-over-n"><span class="tp-over-ic">❖</span><b>' + fmt(pend) + '×</b><em>ready to open</em></div>' +
        '<div class="tp-over-n"><b>' + fmt(taken) + '×</b><em>already opened</em></div>' +
        '<div class="tp-over-n"><b>' + (lv > MAX_LEVEL ? intoLevel() + '/' + XP_PER_LEVEL : fmt(Math.max(0, MAX_LEVEL * XP_PER_LEVEL - xp())) ) + '</b>' +
          '<em>' + (lv > MAX_LEVEL ? 'XP into the next' : 'XP to reach ' + MAX_LEVEL) + '</em></div>' +
      '</div>' +
      (pend ? '<button class="tp-over-btn" id="tp-over">OPEN ' + fmt(pend) + ' FITTING CRATE' + (pend === 1 ? '' : 'S') + '</button>'
            : '<div class="tp-over-none">' + (reached ? 'All caught up — the next fitting lands at level ' + (lv + 1) : 'Unlocks at level ' + MAX_LEVEL) + '</div>') +
      '</div>';
  }

  function cellHTML(lv, tr) {
    const v = cellValue(lv, tr.k), t = s(), key = claimKey(lv, tr.k);
    const claimed = !!t.claim[key];
    const canClaim = claimable(lv, tr.k);
    const locked = !owns(tr.k);
    const l = cellLine(v);
    return '<div class="tp-cell' + (claimed ? ' claimed' : '') + (canClaim ? ' ready' : '') +
        (locked ? ' locked' : '') + (l.hull ? ' hull' : '') + '"' +
        (canClaim ? ' data-claim="' + lv + ':' + tr.k + '"' : '') + ' style="--tc:' + tr.col + '">' +
      (l.hull
          ? '<img class="tp-cell-art" src="ships/ship-' + l.hull + '.png" alt="" decoding="async" onerror="this.remove()">' +
            '<span class="tp-cell-s">' + esc(l.small) + '</span>'
          : '<span class="tp-cell-ic' + (l.raw ? ' svg' : '') + '" style="color:' + l.col + '">' + l.ic + '</span>' +
            '<span class="tp-cell-l">' + esc(l.big) + '</span>' +
            '<span class="tp-cell-s">' + esc(l.small) + '</span>') +
      (claimed ? '<span class="tp-cell-tick">✓</span>' : '') +
      '</div>';
  }

  // ---- WIRING ------------------------------------------------------------
  function wire(body) {
    body.querySelectorAll('[data-buy]').forEach((b) => b.onclick = () => confirmBuy(b.dataset.buy));
    body.querySelectorAll('[data-claim]').forEach((b) => b.onclick = () => {
      const [lv, k] = b.dataset.claim.split(':');
      const lines = claim(+lv, k);
      render();
      if (lines && lines.length) receipt('LEVEL ' + lv, lines);
    });
    const all = $('tp-claimall');
    if (all) all.onclick = () => {
      const lines = claimAll();
      if (lines.length) receipt('CLAIMED ' + lines.length, lines);
    };
    const tg = $('tp-toggle');
    if (tg) tg.onclick = () => { _showAll = !_showAll; render(); };
    const ov = $('tp-over');
    if (ov) ov.onclick = () => {
      const lines = claimOver();
      render();
      if (lines.length) receipt('LEVEL ' + MAX_LEVEL + '+', lines);
    };
    const bl = $('tp-buylv');
    if (bl) bl.onclick = confirmBuyLevel;
    const hp = $('tp-help');
    if (hp) hp.onclick = helpSheet;
  }

  // ---- THE ONE PLACE THE RULES LIVE -------------------------------------
  // Four explainer cards became one sheet. Same information, none of it standing
  // between the player and the rewards.
  function helpSheet() {
    const p = pace(), zone = progZone();
    const rows = [
      ['Levels', 'A level costs <b>' + XP_PER_LEVEL + ' XP</b>. The reward ladder runs to <b>' + MAX_LEVEL +
        '</b>; past that every level is one <b>fitting crate</b> and there is <b>no ceiling</b>.'],
      ['Where XP comes from', '<b>Only the Tour missions below.</b> Nothing else in the game gives season XP — not the game\u2019s own mission boards, not kills, not levels.'],
      ['Tour dailies', '<b>' + TOUR_DAILY.length + ' missions</b>, <b>+' + XP_TOUR_DAILY + ' XP each</b> (<b>' + XP_DAILY +
        '</b> for all of them). Reset every day at <b>00:00 UTC</b>. Auto-credited — no claiming.'],
      ['Tour weeklies', '<b>' + TOUR_WEEKLY.length + ' missions</b>, <b>+' + XP_TOUR_WEEKLY + ' XP each</b> (<b>' + XP_WEEKLY +
        '</b> for all). Reset every <b>Monday</b>. Dailies alone reach about level <b>' +
        (1 + Math.floor(XP_DAILY * WEEKS * 7 / XP_PER_LEVEL)) + '</b> — the weeklies close the rest.'],
      ['The whole season', '<b>' + fmt(XP_DAILY * WEEKS * 7 + XP_WEEKLY * WEEKS) + ' XP</b> over <b>' + WEEKS +
        ' weeks</b> if you clear everything, against <b>' + fmt((HARD_LEVEL - 1) * XP_PER_LEVEL) +
        '</b> needed for level ' + HARD_LEVEL + '. There is room to miss days.'],
      ['Past ' + MAX_LEVEL, 'The ladder ends at <b>' + MAX_LEVEL + '</b>. After that every <b>' + XP_PER_LEVEL +
        ' XP</b> is one more <b>fitting crate</b> — they <b>stack</b>, you open them in one tap, and there is <b>no ceiling</b>. The season’s own XP funds about <b>' +
        OVER_LEVELS + '</b> of them; buying levels goes further.'],
      ['Buying a level', '<b>' + fmt(XP_PER_LEVEL * LC_PER_XP) + ' ◈</b> for a full level, and it is <b>prorated</b>: at <b>40/' +
        XP_PER_LEVEL + ' XP</b> the rest of the level costs <b>' + fmt(60 * LC_PER_XP) + ' ◈</b>. Bought XP is ordinary XP.'],
      ['Your pace', 'Clearing both boards earns about <b>' + p.perDay + ' XP a day</b>. Level ' + MAX_LEVEL +
        ' needs <b>' + fmt(p.need100) + '</b> more — roughly <b>' + p.daysNeeded + ' days</b>, and there are <b>' +
        p.daysLeft + '</b> left' + (p.spare >= 0 ? ', so you have ' + p.spare + ' days of slack.' : '.')],
      ['Tracks stack', 'Holding more than one track claims <b>every</b> cell on a level. A level worth 1 fitting free is <b>1 + 3 + 5 = 9</b> to a pilot holding all three, and a paid track unlocks <b>every level you have already passed</b>.'],
      ['Prizes are fixed', 'Printed on the cell, identical for every pilot, and <b>not a percentage of anything</b>. Paid tracks pay <b>×5</b> and <b>×10</b> the free one.'],
      [lcIcon(12) + ' LootCoins', 'Ten levels pay them: <b>100</b> free, <b>250</b> Commissioned, <b>1,500</b> Admiralty — <b>1,000 / 2,500 / 15,000</b> across the season.'],
      ['Item crate', 'One fitting, rolled at <b>Zone ' + fmt(zone) + '</b> (your deepest), any rarity up to Artifact.'],
      ['Hull shard', 'One shard toward a random hull, Frigate to Titan Sina. <b>100 shards assembles it.</b>'],
      ['XP buff', 'Level 50 only, and <b>permanent</b>: <b>+1% / +2.5% / +5%</b> to the XP you earn everywhere in the game, stacking to <b>+8.5%</b>.'],
      ['Hulls', '<b>Vanguard</b> at level 40 on the free track. <b>Dread Praetorian</b> at level 100 on Admiralty.'],
      ['Season end', 'Anything unclaimed is <b>granted automatically</b> and itemised into your mailbox.'],
    ];
    const v = document.createElement('div');
    v.className = 'tp-veil show';
    v.innerHTML = '<div class="tp-modal" style="--tc:#ffd24d">' +
      '<div class="tp-modal-h">HOW IT WORKS</div>' +
      '<div class="tp-help-l">' + rows.map((r) =>
        '<div class="tp-help-r"><b>' + r[0] + '</b><span>' + r[1] + '</span></div>').join('') + '</div>' +

      '<div class="tp-modal-a"><button class="tp-mbtn" data-boards>Game missions</button>' +
      '<button class="tp-mbtn go" data-x>Got it</button></div></div>';
    document.body.appendChild(v);
    const close = () => v.remove();
    v.addEventListener('click', (e) => { if (e.target === v) close(); });
    v.querySelector('[data-x]').onclick = close;
    v.querySelector('[data-boards]').onclick = () => { close(); try { window.UI.showScreen('missions'); } catch (e) {} };
  }

  function receipt(title, lines) {
    if (!lines.length) return;
    const v = document.createElement('div');
    v.className = 'tp-veil show';
    v.innerHTML = '<div class="tp-modal" style="--tc:#ffd24d">' +
      '<div class="tp-modal-h">' + esc(title) + '</div>' +
      '<div class="tp-rcpt">' + lines.map((l) =>
        '<div class="tp-rcpt-r" style="--rc:' + (l.col || '#8fa3bd') + '">' +
          (l.img
            ? '<img class="tp-rcpt-art" src="' + l.img + '" alt="" onerror="this.remove()">'
            : '<span class="tp-rcpt-ic">' + (l.ic || '❖') + '</span>') +
          '<div class="tp-rcpt-m"><div class="tp-rcpt-n">' + esc(l.text || '') + '</div>' +
            (l.sub ? '<div class="tp-rcpt-s">' + esc(l.sub) + '</div>' : '') +
            (l.pct != null ? '<div class="tp-rcpt-bar"><i style="width:' + Math.min(100, l.pct) + '%"></i></div>' : '') +
          '</div></div>').join('') + '</div>' +
      '<div class="tp-modal-a"><button class="tp-mbtn go" data-x>Good</button></div></div>';
    document.body.appendChild(v);
    const close = () => v.remove();
    v.addEventListener('click', (e) => { if (e.target === v) close(); });
    v.querySelector('[data-x]').onclick = close;
  }

  function confirmBuy(k) {
    const tr = TRACK_BY_K[k]; if (!tr) return;
    const price = PRICE[k], have = G().state.credits || 0, afford = have >= price;
    const v = document.createElement('div');
    v.className = 'tp-veil show';
    v.innerHTML = '<div class="tp-modal" style="--tc:' + tr.col + '">' +
      '<div class="tp-modal-h">' + tr.name + '</div>' +
      '<p>Unlocks this column for the whole season — including every level you have <b>already passed</b>.</p>' +
      '<div class="tp-modal-r"><span>Price</span><b>◈ ' + fmt(price) + '</b></div>' +
      '<div class="tp-modal-r"><span>Balance</span><b style="color:' + (afford ? '#7ce0a0' : '#ff6b78') + '">◈ ' + fmt(have) + '</b></div>' +
      '<div class="tp-modal-a"><button class="tp-mbtn" data-x>Cancel</button>' +
      (afford ? '<button class="tp-mbtn go" data-ok>Unlock</button>' : '') + '</div></div>';
    document.body.appendChild(v);
    const close = () => v.remove();
    v.addEventListener('click', (e) => { if (e.target === v) close(); });
    v.querySelector('[data-x]').onclick = close;
    const ok = v.querySelector('[data-ok]');
    if (ok) ok.onclick = () => { close(); const r = buy(k); if (r.ok && window.UI && window.UI.unlockToast) window.UI.unlockToast('✓ ' + tr.name + ' unlocked'); };
  }
  // Buying the level the pilot is standing in. The price is quoted as the XP still
  // missing x 10, so the sheet always shows exactly what is being paid for.
  function confirmBuyLevel() {
    const need = XP_PER_LEVEL - intoLevel(), cost = need * LC_PER_XP;
    const have = G().state.credits || 0, afford = have >= cost;
    const lv = level(), over = lv >= MAX_LEVEL;
    const v = document.createElement('div');
    v.className = 'tp-veil show';
    v.innerHTML = '<div class="tp-modal" style="--tc:#ffd24d">' +
      '<div class="tp-modal-h">' + (over ? 'BUY THE NEXT FITTING' : 'BUY LEVEL ' + (lv + 1)) + '</div>' +
      '<p>' + (over
        ? 'Past level ' + MAX_LEVEL + ' each level is one <b>fitting crate</b>, and they stack — there is no ceiling.'
        : 'Credits the <b>' + need + ' XP</b> you are still missing and claims the level immediately.') + '</p>' +
      '<div class="tp-modal-r"><span>Missing</span><b>' + need + ' / ' + XP_PER_LEVEL + ' XP</b></div>' +
      '<div class="tp-modal-r"><span>Price</span><b>◈ ' + fmt(cost) + '</b><em>' + fmt(XP_PER_LEVEL * LC_PER_XP) + ' ◈ a full level</em></div>' +
      '<div class="tp-modal-r"><span>Balance</span><b style="color:' + (afford ? '#7ce0a0' : '#ff6b78') + '">◈ ' + fmt(have) + '</b></div>' +
      '<div class="tp-modal-a"><button class="tp-mbtn" data-x>Cancel</button>' +
      (afford ? '<button class="tp-mbtn go" data-ok>Buy</button>' : '') + '</div></div>';
    document.body.appendChild(v);
    const close = () => v.remove();
    v.addEventListener('click', (e) => { if (e.target === v) close(); });
    v.querySelector('[data-x]').onclick = close;
    const ok = v.querySelector('[data-ok]');
    if (ok) ok.onclick = () => {
      close();
      const r = buyLevel();
      if (r.ok && window.UI && window.UI.unlockToast) {
        window.UI.unlockToast(level() > MAX_LEVEL
          ? '✓ Level ' + MAX_LEVEL + '+ · a fitting crate is waiting'
          : '✓ Tour level ' + level() + ' — rewards ready to claim');
      }
    };
  }
})();
