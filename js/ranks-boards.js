/* =============================================================================
   ranks-boards.js — NINE LADDERS for Command ▸ Ranks
   ---------------------------------------------------------------------------
   The Ranks screen used to be one board: all-time fleet power. This adds six
   more, each measuring something a pilot actually *did* rather than power they
   currently hold.

     power     fleet power                    leaderboard.power        (as before)
     tiles     hourly revenue from held space leaderboard.tile_rev
     voidmaw   Voidmaw world-boss stage       sdread_scores
     ships     hulls built                    leaderboard.ships
     missions  lifetime missions completed    leaderboard.missions
     badges    lifetime badge ranks claimed   leaderboard.badges

   WHERE THE NUMBERS COME FROM
   Four of the new columns ride on the leaderboard row every account already
   publishes on its heartbeat (see account.js → publishLb). They are therefore
   exactly as fresh as `power` is, and no fresher — a dormant account shows its
   last-known figures, same as everywhere else on this page.

   SIMULATED PILOTS
   Sims carry only power/level/zone/kills/asc_stars server-side. Giving them
   real columns would mean writing sim rows into `leaderboard`, which the
   fairness guards exist to prevent. Instead each sim's figures are DERIVED here
   from its own name and level through a seeded RNG: deterministic (the same
   pilot always shows the same numbers, on every device and every refresh),
   plausible (they track the pilot's level the way a human's would), and never
   written anywhere.

   ============================================================================= */
(function () {
  'use strict';

  const G = () => window.GAME;
  const cl = () => (window.CLOUD && window.CLOUD.enabled ? window.CLOUD.client : null);

  // ---- ladder definitions ---------------------------------------------------
  // metric  → the number the board sorts by, descending
  // unit    → short label above that number in the row
  // meta    → the dim second line under the pilot's name
  // Real rows map stars to `asc` (leaderboard.js mapReal); sim rows carry the
  // raw `asc_stars`. Read both so the ladder can't silently rank one pool at 0.
  const ascOf = (p) => (((p && p.asc != null ? p.asc : (p && p.asc_stars)) || 0) | 0);
  // Reuse the game's own 5-star-per-tier model rather than restating it here —
  // the tier ladder IS the rarity ladder, and it must not drift from the badge
  // every other screen renders.
  function rankLabel(n) {
    if (n <= 0) return 'Unascended';
    try {
      const P = window.PASCEND;
      if (P && P.tierDef && P.starOf) return P.tierDef(n).name + ' \u2605' + P.starOf(n);
    } catch (e) {}
    return '\u2605' + n;
  }

  const TABS = [
    {
      id: 'power', ic: '\u26a1', col: '#f2b24b', label: 'POWER', sub: 'Fleet Power',
      info: 'Every operator ranked by total fleet power.',
      unit: 'PWR',
      metric: (p) => p.power || 0,
      fmt: (v) => fmtRaw(v),
      meta: (p) => 'Zone ' + (p.zone | 0) + ' · Lv ' + (p.level | 0) + ' · ' + fmt(p.kills || 0) + ' kills',
      empty: 'No operators have published a fleet yet.',
    },
    {
      // Needs no migration: asc_stars has always been on the leaderboard row and
      // publishes through its own p_asc cascade, so this ladder is live today
      // while tiles/ships/missions/badges still wait on lb-onefunction.sql.
      id: 'asc', ic: '\u2726', col: '#ffd24d', label: 'ASCENSION', sub: 'Pilot Rank',
      info: 'Ranked by ascension stars — pilots who reset a finished run for permanent account-wide perks. Ties break on fleet power.',
      unit: 'STARS',
      // stars dominate; power only separates pilots on the same star count
      metric: (p) => ascOf(p) * 1e15 + Math.min(1e15 - 1, p.power || 0),
      fmt: (v, p) => String(ascOf(p)),
      meta: (p) => rankLabel(ascOf(p)) + ' · Lv ' + (p.level | 0) + ' · ' + fmtRaw(p.power || 0) + ' power',
      empty: 'Nobody has ascended yet. The first pilot to reset a run takes this board outright.',
    },
    {
      // THE BOARD IS ABOUT MY GALAXY, AND NOW IT SAYS SO (737). It was called
      // TERRITORY while ranking on galaxy ground only — Void spires and House
      // Citadels are territory in every ordinary sense of the word and are
      // deliberately excluded, so the old name promised something the board does
      // not measure. `id: 'tiles'` and the `tile_rev` column are UNCHANGED: they
      // are stored identifiers, and renaming one to make a label read better
      // revokes what it proved.
      //
      // `sub` was 'Galaxy Tiles', which named the wrong quantity — the board has
      // ranked on hourly revenue, not tile count, since it shipped.
      id: 'tiles', ic: '\u2691', col: '#5fa8ff', label: 'MY GALAXY', sub: 'Hourly Revenue',
      // WHAT DRIVES THIS BOARD IS TILE QUALITY, AND THE ROW HAS TO SAY SO.
      // Four multipliers stack on a tile's base yield: deep space ×25, a NATURAL
      // fortress ×1000, a built citadel ×10 per rank, and contiguity. Best against
      // worst is ~1,875,000× on the SAME base rate, so two pilots holding the same
      // number of systems and citadels can differ by a factor of thirty — and the
      // old meta line printed only the counts, which explain none of it. A #1 at
      // 1.38T beside a #3 at 48B with MORE citadels reads as broken arithmetic; it
      // is not, and the row now shows the figure that makes it legible.
      info: 'Ranked by hourly revenue from the galaxy ground you hold — not tile count. Void spires and House Citadels are income, but they are not My Galaxy and do not count here. What a system pays depends far more on WHERE it is than on how many you hold: deep space pays ×25, a natural fortress ×1000, and each citadel rank another ×10. A few deep fortresses will out-earn a wide, shallow sprawl many times over.',
      unit: '/HR',
      metric: (p) => p.tile_rev || 0,
      fmt: (v) => fmt(v),
      meta: (p) => {
        const cits = p.citadels | 0, rev = p.tile_rev || 0;
        return (p.tiles | 0) + ' system' + ((p.tiles | 0) === 1 ? '' : 's') +
          (cits ? ' · ' + cits + ' citadel' + (cits === 1 ? '' : 's') : '') +
          // The per-citadel average is the number that explains the ranking, and it
          // is DERIVED from two fields already published — no new column, no SQL.
          (cits && rev ? ' · ' + fmt(Math.round(rev / cits)) + '/ea' : '') +
          ' · Lv ' + (p.level | 0);
      },
      empty: 'No systems claimed yet. Take one in My Galaxy and it starts paying immediately.',
    },
    {
      id: 'voidmaw', ic: '\u2620', col: '#ff4d6d', label: 'VOIDMAW', sub: 'World boss',
      info: 'The Voidmaw world boss. Ranked by deepest stage cleared, then by total damage.',
      unit: 'STAGE',
      metric: (p) => (p.stage || 0) * 1e12 + Math.min(1e12, Math.log10(Math.max(1, p.total || 0)) * 1e10),
      fmt: (v, p) => String(p.stage | 0),
      meta: (p) => 'Stage ' + (p.stage | 0) + ' · ' + fmt(p.total || 0) + ' total damage',
      // NOT "this season". server-dreadnaught.js made the Voidmaw a PERMANENT
      // fixture and states the rule out loud: no screen prints a deadline, because
      // `SEASON.num` survives only as a wire key. Saying "this season" on an empty
      // board implies a reset that will never come.
      empty: 'Nobody has fought the Voidmaw yet.',
      async: true,
    },
    {
      id: 'ships', ic: '\u27a4', col: '#7ce0a0', label: 'HANGAR', sub: 'Hulls Owned',
      info: 'Every hull built, bought, or granted — the size of the collection, not the fleet flying.',
      unit: 'HULLS',
      metric: (p) => p.ships || 0,
      fmt: (v) => String(v | 0),
      meta: (p) => 'Lv ' + (p.level | 0) + ' · ' + fmt(p.power || 0) + ' power',
      empty: 'No hangars on record yet.',
    },
    {
      id: 'missions', ic: '\u2714', col: '#5fd1ff', label: 'MISSIONS', sub: 'Lifetime Cleared',
      info: 'Missions completed across every board — daily, weekly and monthly. Carries through ascension.',
      unit: 'DONE',
      metric: (p) => p.missions || 0,
      fmt: (v) => fmt(v),
      meta: (p) => {
        const n = p.missions | 0;
        return n >= 1000 ? 'Lv ' + (p.level | 0) + ' · ⌘ Veridian earned'
                         : 'Lv ' + (p.level | 0) + ' · ' + fmt(Math.max(0, 1000 - n)) + ' to the Veridian';
      },
      empty: 'No missions cleared yet.',
    },
    {
      id: 'cargo', ic: '\u26df', col: '#ffb84d', label: 'HAULAGE', sub: 'Cargo Delivered',
      sql: 'cargo-ladder.sql',
      info: 'Space Cargo Defense — lifetime shipments escorted to the Citadel. Ties break on best delivered condition.',
      empty: 'No shipments have been escorted yet. Run one Cargo Defense contract and you take this board.',
      unit: 'HAULS',
      metric: (p) => (p.cargo || 0) * 1e3 + Math.min(999, (p.cargo_best | 0) * 9),
      fmt: (v, p) => fmt(p.cargo | 0),
      meta: (p) => ((p.cargo | 0) ? 'best delivery ' + Math.min(100, p.cargo_best | 0) + '% · ' : '') + rankLabel(ascOf(p)) + ' · Lv ' + (p.level | 0),
    },
    {
      // NANOCORES — the top of the scale only. Common through Epic cores drop
      // for everyone; ranking them would rank crate volume. This board measures
      // the 1.5% pull, then what the pilot did with it: how deep they built ONE
      // core, and how many rolls landed in the top 5% of their range.
      id: 'nano', ic: '\u25c8', col: '#f0972a', label: 'NANOCORE', sub: 'Legendary Cores',
      sql: 'nanocore-ladder.sql',
      info: 'Legendary Nanocores recovered — 1.5% a crate. Ties break on the deepest single core built, then on top-5% buff rolls.',
      unit: 'CORES',
      metric: (p) => (p.nano_legend | 0) * 1e9 + Math.min(5, p.nano_slots | 0) * 1e6 + Math.min(999999, p.nano_god | 0),
      fmt: (v, p) => String(p.nano_legend | 0),
      meta: (p) => {
        const s = Math.min(5, p.nano_slots | 0), g = p.nano_god | 0;
        if (!(p.nano_legend | 0)) return 'No Legendary core yet · Lv ' + (p.level | 0);
        return (s >= 5 ? '★ 5/5 slots — core finished' : s + '/5 slots on one core') +
               (g ? ' · ' + fmt(g) + ' god roll' + (g === 1 ? '' : 's') : '') +
               ' · Lv ' + (p.level | 0);
      },
      empty: 'No Legendary Nanocores recovered yet. They drop at 1.5% a crate — the first pilot to pull one takes this board outright.',
    },
    {
      id: 'badges', ic: '\u2b21', col: '#b57bff', label: 'BADGES', sub: 'Ranks Claimed',
      get info() { return 'Lifetime commendations claimed, out of ' + badgeTotal().toLocaleString() + '. Claim them all and the Titan Sina is granted.'; },
      get unit() { return '/' + badgeTotal(); },
      metric: (p) => p.badges || 0,
      fmt: (v) => String(v | 0),
      meta: (p) => {
        const n = p.badges | 0, T = badgeTotal();
        return n >= T ? 'Lv ' + (p.level | 0) + ' · ★ Titan Sina granted'
                      : 'Lv ' + (p.level | 0) + ' · ' + fmt(T - n) + ' badges to the Titan Sina';
      },
      empty: 'No badges claimed yet.',
    },
    {
      // HOME DEFENSE — the deepest wave the pilot is HOLDING. The Home Citadel
      // never rolls a wave back on a breach (a breach damages the base and halts
      // mining; the wave stands), so "holding" and "best" are the same number
      // and the board can say the stronger of the two honestly.
      id: 'hcwave', ic: '\u26e8', col: '#6fe0a0', label: 'HOME DEFENSE', sub: 'Deepest Wave',
      sql: 'new-ladders.sql',
      info: 'Ranked by the deepest Home Citadel wave you are holding. Every wave cleared raises passive production forever — this is the one board that shows whose base earns hardest. Ties break on fleet power.',
      unit: 'WAVE',
      metric: (p) => (p.hcwave | 0) * 1e15 + Math.min(1e15 - 1, p.power || 0),
      fmt: (v, p) => String(p.hcwave | 0),
      meta: (p) => {
        const w = p.hcwave | 0;
        const era = w >= 250 ? 'MYTHIC era' : w >= 100 ? 'LEGENDARY era · ×2 production' : w >= 50 ? 'EPIC era' : w >= 20 ? 'RARE raiders' : 'building up';
        return (w ? era : 'No waves cleared') + ' · Lv ' + (p.level | 0);
      },
      empty: 'Nobody is holding a wave yet. Clear Wave 1 in the Home Citadel and you take this board outright.',
    },
    {
      // EXPLORATION — counts DEBRIEFED expeditions only, so a fleet still in
      // flight is not yet worth anything here and a recalled one never counts.
      id: 'expo', ic: '\u25ce', col: '#7fe0ff', label: 'EXPLORATION', sub: 'Expeditions Flown',
      sql: 'new-ladders.sql',
      info: 'Fleet Exploration — expeditions completed and debriefed. Recalled runs do not count. Ties break on the strongest wing ever sent out.',
      unit: 'FLOWN',
      metric: (p) => (p.expo | 0) * 1e9 + Math.min(1e9 - 1, p.expo_best | 0),
      fmt: (v, p) => fmt(p.expo | 0),
      meta: (p) => ((p.expo_best | 0) ? 'best wing rating ' + (p.expo_best | 0) + ' · ' : '') + 'Lv ' + (p.level | 0),
      empty: 'No expeditions flown yet. Launch one from Command ▸ Fleet Exploration.',
    },
    {
      // PILOT TREE — the one progression no amount of grinding shortens. Nodes
      // are bought with ◇ Dread Cores from a WEEKLY raid (one attempt per tier
      // per week) and the whole tree rides through ascension, so a deep score is
      // months of real calendar time and nothing else. Fleet power can be
      // rebuilt in a weekend; this cannot, which is why it deserves its own
      // board rather than being folded into power.
      id: 'pilot', ic: '\u2b21', col: '#ff5a68', label: 'PILOT TREE', sub: 'Pilot Score',
      sql: 'pilot-ladder.sql',
      info: 'The hex talent tree, scored. Every unlocked node adds its own value — deeper and rarer nodes are worth more. Cores come from the weekly Dreadnaught Hunt, so this board moves on a calendar, not on a grind. Ties break on nodes unlocked.',
      unit: 'SCORE',
      // REAL PILOTS ONLY — see the filter in board(). A fabricated tree score is
      // meaningless on a ladder that measures weeks of raid attendance.
      realOnly: true,
      metric: (p) => (Number(p.pilot_score) || 0) * 1e7 + Math.min(1e7 - 1, p.pilot_nodes | 0),
      fmt: (v, p) => fmt(Number(p.pilot_score) || 0),
      meta: (p) => {
        const n = p.pilot_nodes | 0;
        if (!n) return 'No nodes unlocked \u00b7 Lv ' + (p.level | 0);
        return n + ' node' + (n === 1 ? '' : 's') + ' \u00b7 ' + pilotRank(Number(p.pilot_score) || 0) + ' \u00b7 Lv ' + (p.level | 0);
      },
      empty: 'No other pilot has published a tree yet. This board lists real published trees only — never stand-ins, and never a pilot we have not heard from. Rows appear as pilots log in.',
    },
    {
      // COMMAND RANK. The Commander roster ranked the way fleet power ranks
      // hulls — and like that board, it DRAWS THE LINE-UP: the actual officers
      // seated, at the rarity they are held, not a count.
      //
      // The score is live rather than a lifetime best. Standing an officer down
      // or switching flagship so a specialist stops paying both lower it, and
      // the board should say so — a Command Rank is a statement about the fleet
      // you are fielding right now, not the best roster you ever had.
      id: 'command', ic: '\u2726', col: '#c07bff', label: 'COMMAND', sub: 'Commander roster',
      sql: 'cmdr-ladder.sql',
      info: 'Every Commander you hold scores on its BEST rarity, weighted the way the pull odds are — so the board tracks how improbable a roster is, not how big. Officers SEATED and actually paying count double; a specialist benched in the wrong hull scores as collection only. Completing the roster adds up to 25%.',
      unit: 'CMD',
      realOnly: true,
      metric: (p) => Number(p.cmdr_score) || 0,
      fmt: (v, p) => fmt(Number(p.cmdr_score) || 0),
      // The line-up is DRAWN, the way the power board draws hulls — tab.meta() is
      // inserted as markup by the renderer, and there is no separate art hook.
      // Portrait where one exists, rarity-tinted monogram where it does not.
      meta: (p) => {
        const line = Array.isArray(p.cmdr_line) ? p.cmdr_line : [];
        if (!line.length) return 'No Commanders seated \u00b7 Lv ' + (p.level | 0);
        const CO = window.COMMANDERS || {};
        const strip = line.slice(0, 5).map((c) => {
          const id = String(c.id || '').replace(/[^a-z0-9_-]/gi, '');
          const w = CO.BY_ID ? CO.BY_ID[id] : null;
          const R = CO.rarityOf ? CO.rarityOf(c.r | 0) : { color: '#888', name: '' };
          // AN OFFICER ID IS NOT AN OFFICER NAME. A roster published by a NEWER
          // build can name a card this client has never heard of, and the strip
          // then printed the raw save key as the officer's name — the same leak
          // the KOTH board had with `dread6`. Title-case the unknown id instead.
          const nm = w ? w.name : (id ? id.charAt(0).toUpperCase() + id.slice(1) : '?');
          // ONLY EMIT AN <img> FOR A KNOWN OFFICER. Every card in ROSTER has a
          // portrait, so a known id is a portrait that loads. An unknown id used
          // to emit a tag that 404'd and deleted itself via onerror — and this
          // board repaints every 4 seconds, so that was a request and a DOM churn
          // per unknown card per repaint. The Commanders screen abandoned exactly
          // this pattern for exactly this reason; the monogram is the fallback.
          return '<span class="rb-cc" style="--c:' + R.color + '" title="' + esc(nm) + ' \u2014 ' + esc(R.name) + '">'
            + (w ? '<img src="commanders/' + id + '.png" alt="" loading="lazy">' : '')
            + '<i>' + esc(nm.slice(0, 2).toUpperCase()) + '</i></span>';
        }).join('');
        return '<span class="rb-cline">' + strip + '</span>'
          + line.length + ' seated \u00b7 Lv ' + (p.level | 0);
      },
      empty: 'No other pilot has published a roster yet. This board lists real published Commanders only \u2014 never stand-ins.',
    },
    {
      // THE MECH FOUNDRY. Measures lifetime Mech Cores EARNED, never the wallet:
      // a wallet falls the moment a pilot assembles a hull, and a ladder whose
      // rows drop when you play it punishes playing. `earned` only climbs, and
      // lb_upsert writes it with greatest(), so a stale client cannot knock a row
      // backwards either.
      //
      // Its worlds open for one hour in six on staggered windows, so this board
      // moves on a schedule as much as on a grind — like the Pilot Tree, and
      // unlike power.
      id: 'mech', ic: '\u2699', col: '#ff4d5e', label: 'MECH FOUNDRY', sub: 'Cores earned',
      sql: 'mech-ladder.sql',
      info: 'Lifetime \u2699 Mech Cores earned in the Mech Foundry \u2014 what you have WON, not what you are holding, so assembling a hull never costs you a place. Five corrupted worlds, each assaultable one hour in six. Ties break on worlds cleared.',
      unit: 'CORES',
      // REAL PILOTS ONLY. A fabricated core total is meaningless on a ladder
      // measuring an opt-in event, and inventing rows would rank stand-ins above
      // the humans who have actually run it \u2014 the failure the Voidmaw boards had.
      realOnly: true,
      metric: (p) => Number(p.mech_cores) || 0,
      fmt: (v, p) => fmt(Number(p.mech_cores) || 0),
      meta: (p) => {
        const c = Number(p.mech_cores) || 0;
        if (!c) return 'No worlds cleared \u00b7 Lv ' + (p.level | 0);
        return fmt(c) + ' \u2699 earned \u00b7 Lv ' + (p.level | 0);
      },
      empty: 'No other pilot has published a Foundry run yet. This board lists real published totals only \u2014 never stand-ins. Rows appear as pilots log in.',
    },
    {
      // KING OF THE HILL — the only board with two views, because the event has
      // two honest answers to "who is winning". TODAY is the live race from
      // koth_top(); CROWNS is the career record from koth_hall. Neither is
      // published by the client — both are server-owned, so nothing here can be
      // self-reported and no migration probe is needed.
      id: 'koth', ic: '\u{1F451}', col: '#ffd24d', label: 'KING OF THE HILL', sub: 'Daily · Crowns',
      sql: 'koth.sql',
      info: 'The 24-hour kill race. TODAY is the live board and resets at 00:05 UTC; CROWNS counts days won for good. Ties on crowns break on total kills across winning days.',
      unit: 'KILLS',
      views: [
        { id: 'day', label: 'TODAY', unit: 'KILLS' },
        { id: 'hall', label: 'CROWNS', unit: 'WINS' },
      ],
      metric: (p) => (p.view === 'hall'
        ? (p.wins | 0) * 1e12 + Math.min(1e12 - 1, Number(p.kills) || 0)
        : (Number(p.kills) || 0)),
      fmt: (v, p) => (p.view === 'hall' ? String(p.wins | 0) : fmt(Number(p.kills) || 0)),
      meta: (p) => (p.view === 'hall'
        ? fmt(Number(p.kills) || 0) + ' kills across ' + (p.wins | 0) + ' winning day' + ((p.wins | 0) === 1 ? '' : 's')
        : 'Tier ' + Math.max(1, p.tier | 0) + (p.ship ? ' · ' + hullName(p.ship) : '')),
      empty: 'The race has not started. Enter from Command ▸ King of the Hill.',
      emptyHall: 'No crowns awarded yet. The first event closes at 00:05 UTC.',
      async: true,
    },
  ];
  const BY_ID = {};
  TABS.forEach((t) => { BY_ID[t.id] = t; });

  function fmt(n) { try { return G().formatNum(n); } catch (e) { return String(Math.floor(n || 0)); } }
  function fmtRaw(n) { try { return (G().formatNumRaw || G().formatNum)(n); } catch (e) { return String(Math.floor(n || 0)); } }

  // A HULL KEY IS NOT A HULL NAME. The KOTH rows carry the raw save key, so the
  // board printed lowercase internals — 'dread6' for the Dread Omega, 'titansina'
  // for the Titan Sina. Resolve through CONFIG; if a key ever outlives its ship
  // entry, title-case it rather than leaking the identifier.
  // THE PILOT RANK LADDER LIVES IN dreadnaught.js. Read it, never restate it —
  // the Pilot screen prints the same word from the same table, and a second copy
  // here is how the board and the screen start disagreeing about what a score
  // means. The fallback is only for a load order where DREAD is not up yet.
  function pilotRank(score) {
    try { if (window.DREAD && DREAD.rankFor) return DREAD.rankFor(score); } catch (e) {}
    return 'Pilot';
  }
  // ---- ANY VALUE THAT CAME OFF THE WIRE IS UNTRUSTED -------------------------
  // Names, hull keys and officer ids on this screen belong to OTHER accounts. The
  // client's own name gate strips angle brackets, but lb_upsert's `p_name` is a
  // bare text parameter with no server-side scrub, so a crafted row reaches every
  // other player's board verbatim. `tab.meta()` is inserted as markup by the
  // renderer, so anything it interpolates has to be escaped here.
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function hullName(k) {
    const key = String(k || '');
    try { const s = (window.CONFIG && window.CONFIG.SHIP_BY_KEY) ? window.CONFIG.SHIP_BY_KEY[key] : null; if (s && s.name) return esc(s.name); } catch (e) {}
    return key ? esc(key.charAt(0).toUpperCase() + key.slice(1)) : '';
  }
  // The badge ladder's size is ACHIEVE's to state, not this board's to remember:
  // the total moved from 1,000 to 1,110 when the nanocore chains joined the count
  // and every readout that hardcoded it drifted. Read it live, every render.
  function badgeTotal() {
    try { if (window.ACHIEVE && ACHIEVE.TOTAL) return ACHIEVE.TOTAL | 0; } catch (e) {}
    return 1110;
  }

  // ---- deterministic sim figures --------------------------------------------
  // How many hulls a simulated pilot can plausibly own. Derived from the live
  // roster so it can never drift out of range again, and it EXCLUDES the Kaevith
  // event hulls (alienTech): those are earned only by clearing an alien-held zone
  // in My Galaxy, at 1–10% per clear, so crediting bots with them would both
  // overstate the ceiling and imply they play an event they do not participate in.
  const SIM_HULL_CAP = (() => {
    try {
      const all = (window.CONFIG && window.CONFIG.SHIPS) || [];
      const n = all.filter((s) => !s.alienTech).length;
      return n > 0 ? n : 32;
    } catch (e) { return 32; }
  })();

  // Seeded on the pilot's NAME, so a given sim shows identical numbers forever,
  // on every device, without a byte of storage. Values track level and ascension
  // the way a human account's would — a Lv 400 ★12 pilot reads like one.
  function seed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return () => { h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
  }
  function derive(p) {
    if (p._derived) return p;
    // ---- KNOWN DEFECT, DELIBERATELY NOT FIXED HERE \u2014 OPERATOR'S CALL ----------
    // `p.asc_stars` IS ALWAYS UNDEFINED ON A SIM ROW. sim-pilots.js reads the
    // server's asc_stars column and maps it onto the property `asc` (see its
    // row builder), so this line resolves to 0 for every simulated pilot and
    // `career` below is level-only. The stated intent of this function is the
    // opposite \u2014 "a Lv 400 \u260512 pilot reads like one" \u2014 so the ascension term has
    // never once been exercised.
    //
    // The visible symptom is mild: a sim shows \u260512 on the Ascension board and
    // rookie-grade career figures on every other board. Reading it correctly is a
    // one-word change (`ascOf(p)`), and it is NOT being made in this pass because
    // it is a BALANCE change wearing a bug's clothes. A 12-star sim's career term
    // goes 500 \u2192 6,500, which puts simulated pilots at the badge cap and around
    // 3,500\u20138,500 lifetime missions \u2014 above every human on both boards. That is
    // precisely the outcome the migration gates and the realOnly filters exist to
    // prevent, and the numbers below were tuned while the term read zero, so no
    // one has ever seen the intended curve.
    //
    // To turn it on: swap in ascOf(p) AND retune the per-star weight (500) and the
    // missions/badges exponents together, then check the top 20 of every board
    // against the real roster before shipping.
    const r = seed(String(p.name || '?')), lv = Math.max(1, p.level | 0), st = Math.max(0, p.asc_stars | 0);
    const career = lv + 500 * st;                        // total levels ever walked

    // TERRITORY — held space grows with career but plateaus; the galaxy is finite
    // and contested, so nobody holds hundreds of systems.
    const tiles = Math.min(60, Math.floor((career / 42) * (0.45 + r() * 1.1)));
    const citadels = tiles > 2 ? Math.floor(tiles * (0.1 + r() * 0.28)) : 0;
    // hourly revenue on the same scale as the real metric (tileRevenue →
    // resourceRates units): ~150-400 units per plain tile, citadels 10×, with a
    // mild depth factor for long careers — NOT the old ×1.028^level exponential,
    // which put veteran sims at 1e12/hr while real players sat at 1e4.
    const rev = tiles ? Math.round((tiles * 9 + citadels * 80) * 25 * (1 + career / 350) * (0.7 + r() * 0.8)) : 0;

    // HANGAR — hulls unlock roughly every 12 levels, capped at the roster size.
    // SIM_HULL_CAP is derived from CONFIG.SHIPS rather than hardcoded: the literal
    // 48 here predated several roster changes and outran the real count, so top
    // sim pilots were credited with more hulls than exist in the game.
    const ships = Math.max(1, Math.min(SIM_HULL_CAP, Math.floor(lv / 12) + Math.floor(st * 1.4) + Math.floor(r() * 3)));

    // HAULAGE — Cargo Defense opens at Pilot Ascension ★3 and rations two runs a
    // day, so even a veteran sim's count stays believable (and ★2 hauls zero).
    p.cargo = st >= 3 ? Math.max(1, Math.floor(career * 0.6 * (0.4 + r() * 0.8))) : 0;
    p.cargo_best = p.cargo ? Math.min(100, 58 + Math.floor(r() * 43)) : 0;
    // MISSIONS — a board a day, give or take, across the whole career
    const missions = Math.floor(career * (0.55 + r() * 0.75));

    // BADGES — the full ladder is a multi-year climb; even veterans are low
    const badges = Math.min(badgeTotal(), Math.floor(Math.pow(career, 0.92) * (0.22 + r() * 0.4)));

    // NANOCORES — gated at Lv 50 and paid for in Prism Ingots, so a sim's
    // Legendary count tracks career rather than luck, and stays low enough that
    // one real 1.5% pull is worth something on the board. Slot depth is weighted
    // hard toward the shallow end: 25 successful upgrades on ONE core is the rare
    // thing, and no derived pilot is ever handed a finished 5/5 — that row has to
    // be earned by a human.
    const legend = lv >= 50 ? Math.max(0, Math.floor((career / 900) * (0.25 + r() * 1.35))) : 0;
    p.nano_legend = Math.min(14, legend);
    p.nano_slots = legend ? Math.min(4, Math.floor(Math.pow(r(), 1.7) * 5.4)) : 0;
    p.nano_god = legend ? Math.floor(legend * r() * 1.4) : 0;

    p.tiles = tiles; p.citadels = citadels; p.tile_rev = rev;
    p.ships = ships; p.missions = missions; p.badges = badges;

    // HOME DEFENSE — a wave is cleared roughly every two levels early and slows
    // sharply once raiders outscale a casual fleet, so this tracks career with a
    // hard taper rather than growing linearly forever.
    p.hcwave = Math.max(0, Math.floor(Math.pow(career, 0.78) * (0.5 + r() * 0.7)));
    // EXPLORATION — real-time gated: even a permanent resident cannot run more
    // than a handful of expeditions a day, so the count is bounded by how long
    // the account has plausibly existed rather than by how strong it is.
    p.expo = Math.max(0, Math.floor(Math.pow(career, 0.62) * (0.35 + r() * 0.9)));
    p.expo_best = p.expo ? Math.min(420, 40 + Math.floor(Math.pow(career, 0.55) * (1.2 + r() * 2.4))) : 0;

    // PILOT TREE — the hardest thing on this list to fake, because the real one
    // is bought with a WEEKLY raid currency. A node costs 1–3 cores and a tier
    // pays one hunt a week, so a sim's node count is bounded by how many weeks
    // the account has plausibly existed, NOT by how strong it is. Career is the
    // only proxy we have for age, taken to a hard root so a Lv 1000 ★5 pilot
    // lands in the low hundreds of nodes rather than thousands. Gated at the
    // tree's own unlock level so nobody below it ranks at all.
    const treeGate = (() => { try { return (window.DREAD && DREAD.unlockLevel) | 0 || 30; } catch (e) { return 30; } })();
    p.pilot_nodes = (lv >= treeGate || st > 0)
      ? Math.max(0, Math.floor(Math.pow(career, 0.58) * (0.4 + r() * 0.85)))
      : 0;
    // Score per node rises with depth (deeper rings roll stronger, legendaries
    // are worth ~60+), so the average climbs as the tree grows instead of being
    // a flat multiplier.
    p.pilot_score = p.pilot_nodes
      ? Math.floor(p.pilot_nodes * (11 + Math.pow(p.pilot_nodes, 0.42) * (1.1 + r() * 1.3)))
      : 0;

    p._derived = true;
    return p;
  }

  // ---- async sources ---------------------------------------------------------
  const _cache = {};                                     // id → { at, rows }
  const _inflight = {};                                  // id → 1 while a fetch is open
  const TTL = 30000;

  async function fetchVoidmaw() {
    const c = cl(); if (!c) return [];
    const r = await c.from('sdread_scores')
      .select('user_id,name,season,stage,total')
      .order('stage', { ascending: false })
      .limit(200);
    if (r.error) throw r.error;
    // one row per pilot — the deepest stage they reached this season
    const best = new Map();
    for (const row of r.data || []) {
      const k = row.user_id || row.name;
      const cur = best.get(k);
      if (!cur || (row.stage | 0) > (cur.stage | 0)) best.set(k, row);
    }
    return [...best.values()];
  }

  // KING OF THE HILL — both views come straight from the KOTH module, which owns
  // the RPCs and their caching. Nothing is derived and nothing is published: a
  // daily standing and a crown are both decided server-side.
  async function fetchKoth(view) {
    const K = window.KOTH;
    if (!K) return [];
    if (view === 'hall') {
      const rows = await K.pollHall(true);
      return (rows || []).map((r) => Object.assign({}, r, { view: 'hall' }));
    }
    await K.pollBoard();
    return (K.board() || []).map((r) => Object.assign({}, r, { view: 'day' }));
  }

  function loadAsync(id, cb) {
    const hit = _cache[id];
    if (hit && Date.now() - hit.at < TTL) { cb(hit.rows, hit.err); return; }
    // ONE FETCH AT A TIME PER BOARD. The Ranks screen re-renders every 4 seconds
    // and board() calls this on every render once the cache is stale, so a fetch
    // slower than 4s stacked a fresh request on every repaint until one landed —
    // unbounded, and worst exactly when the connection is worst. KOTH's own polls
    // are guarded inside the module; the Voidmaw read was not guarded anywhere.
    if (_inflight[id]) return;
    _inflight[id] = 1;
    const done = () => { delete _inflight[id]; };
    const job = id === 'voidmaw' ? fetchVoidmaw()
      : id === 'koth' ? fetchKoth('day')
      : id === 'koth:hall' ? fetchKoth('hall')
      : Promise.resolve([]);
    job.then((rows) => { done(); _cache[id] = { at: Date.now(), rows, err: null }; cb(rows, null); })
       .catch((err) => { done(); _cache[id] = { at: Date.now(), rows: [], err }; cb([], err); });
  }

  // ---- has lb-onefunction.sql run? --------------------------------------------
  // Until it has, `leaderboard` has no tiles/ships/missions/badges columns, so
  // every REAL pilot reads 0 on four of the six boards and only derived sim
  // figures rank. That is not a thin board — it is a WRONG one, and it would
  // quietly credit simulated pilots with records no human could be shown to
  // beat. Detected by absence of the property (not a zero value), and those
  // boards refuse to render until the columns exist.
  // THE MECH AND COMMAND BOARDS BELONG IN THIS LIST TOO.
  // Both have a SQL_PROBE entry and a NEED rank below, and migrated() has a
  // dedicated branch for each — but board() only consults migrated() when
  // NEEDS_SQL[id] is set, and neither id was here. So all of that was dead code:
  // on a server without cmdr-ladder.sql or mech-ladder.sql the boards did not say
  // "not live yet", they ranked every human at zero, the realOnly filter then
  // dropped every one of them, and the player was left alone at #1 on a board
  // with no explanation for why nobody else was on it.
  const NEEDS_SQL = { tiles: 1, ships: 1, missions: 1, badges: 1, cargo: 1, nano: 1, hcwave: 1, expo: 1, pilot: 1, mech: 1, command: 1 };
  // Which property proves the migration for THIS board ran. Haulage and Nanocore
  // ship in their OWN migrations (cargo-ladder.sql, nanocore-ladder.sql), so the
  // shared lb-onefunction probe would pass on a server that had run neither and
  // both boards would quietly rank every human at zero. Home Defense and
  // Exploration are the same story again, in new-ladders.sql.
  const SQL_PROBE = {
    cargo: ['cargo', 'cargo_best'],
    nano: ['nano_legend', 'nano_slots'],
    hcwave: ['hcwave'],
    expo: ['expo', 'expo_best'],
    pilot: ['pilot_score'],
    mech: ['mech_cores'],
    command: ['cmdr_score'],
  };
  function migrated(rows, id) {
    // THE NEW LADDERS ASK THE SERVER, NOT THE ROWS.
    //
    // The row probe below cannot answer for hcwave/expo. It deliberately skips
    // the player's own row (mineInto writes those fields from the live save, so
    // they are always present whether or not the column exists) and every
    // simulated row (derive() fills them too). On a board where few humans have
    // published, nothing is left to inspect — and the ladder reported "waiting on
    // a database migration" permanently, even with the SQL run and the columns
    // there. The failing state looked identical to the real one, which is the
    // worst property a diagnostic can have.
    //
    // CLOUD.lbShape() reports which SELECT actually succeeded, which is a direct
    // statement about the schema and cannot be faked by a merged local row.
    if (id === 'hcwave' || id === 'expo' || id === 'pilot' || id === 'mech' || id === 'command') {
      try {
        const s = window.CLOUD && window.CLOUD.lbShape && window.CLOUD.lbShape();
        // The shapes are a LADDER, newest first: 'pilot' implies 'new'. So the
        // two older boards accept either, and only the Pilot Tree board needs
        // the newest one. Testing `s === 'new'` alone would have turned Home
        // Defense and Exploration off the moment pilot-ladder.sql landed.
        // THE SHAPES ARE A LADDER, newest first: 'mech' implies 'pilot' implies
        // 'new'. Each board names the OLDEST shape that carries its column and
        // accepts anything newer, so landing a migration can never switch an
        // older board off.
        const RANK = { legacy: 0, base: 1, ladder: 2, cargo: 3, nano: 4, new: 5, pilot: 6, mech: 7, cmdr: 8 };
        const NEED = { hcwave: 5, expo: 5, pilot: 6, mech: 7, command: 8 };
        if (s) return (RANK[s] || 0) >= (NEED[id] || 0);
      } catch (e) {}
      // No board read has landed yet (offline, signed out, first paint). We do
      // not know, and the two wrong answers are both bad: claim the migration is
      // missing and we accuse a healthy database, or claim it is present and we
      // rank a board of simulated pilots. Say so instead — board() turns this
      // into a loading state.
      return 'unknown';
    }
    const keys = SQL_PROBE[id] || ['missions', 'tile_rev'];
    for (const p of rows) {
      if (p.isMe || p._sim || p.is_simulated || p._filler) continue;
      for (const k of keys) if (p[k] !== undefined) return true;
    }
    return false;                       // no human row carries the columns
  }

  // ---- board assembly --------------------------------------------------------
  // Returns { rows, real, tab, pending, err }. `pending` means an async board is
  // still loading and the caller should re-render when `onReady` fires.
  function board(id, onReady, view) {
    const tab = BY_ID[id] || TABS[0];
    const LB = window.LEADERBOARD;
    const g = G();
    if (!LB || !g) return { rows: [], real: 0, tab, pending: false };

    // ASYNC LADDERS — their own tables, not the leaderboard row
    if (tab.async) {
      // A tab with VIEWS caches each view under its own key: they are different
      // questions against different tables and must never share a slot.
      const vId = (tab.views && view && view !== tab.views[0].id
        && tab.views.some((v) => v.id === view)) ? id + ':' + view : id;
      const hit = _cache[vId];
      if (!hit || Date.now() - hit.at >= TTL) {
        loadAsync(vId, () => { if (onReady) onReady(); });
        if (!hit) return { rows: [], real: 0, tab, view, pending: true };
      }
      const mine = myName(), myId = myUid();
      // MATCH ON THE ACCOUNT ID WHEN THE ROW CARRIES ONE. Both koth_top and
      // koth_hall_top return user_id, and sdread_scores does too — matching on the
      // display NAME instead meant a pilot who renamed lost their highlight, and
      // two pilots sharing a name both lit up as "you". Name stays as the fallback
      // for a signed-out read, where there is no id to compare.
      const rows = (hit ? hit.rows : []).map((p) => Object.assign({}, p, {
        isMe: (myId && p.user_id) ? (p.user_id === myId) : (!!mine && p.name === mine),
      }));
      rows.sort((a, b) => tab.metric(b) - tab.metric(a));
      rows.forEach((p, i) => { p.rank = i + 1; });
      return { rows, real: rows.length, tab, view, pending: false, err: hit && hit.err };
    }

    // LEADERBOARD LADDERS — the same pool the power board uses, re-sorted
    const data = LB.allTimeBoard(g);
    if (NEEDS_SQL[id]) {
      const m = migrated(data.board, id);
      // 'unknown' means no server read has landed yet — render as loading, not as
      // a missing migration, and re-render when the answer arrives.
      if (m === 'unknown') {
        try { if (window.CLOUD && window.CLOUD.lbTop) Promise.resolve(window.CLOUD.lbTop(100)).catch(() => {}).then(() => { if (onReady) onReady(); }); } catch (e) {}
        return { rows: [], real: 0, tab, pending: true };
      }
      if (!m) return { rows: [], real: 0, tab, pending: false, needsSql: true };
    }
    const rows = data.board.map((p) => {
      const q = Object.assign({}, p);
      if (q.isMe) mineInto(q);
      else if (q._sim || q.is_simulated || q._filler) derive(q);
      else fill(q);
      return q;
    })
    // A SIMULATED PILOT HAS NO PILOT TREE. `realOnly` boards drop them entirely
    // rather than deriving a number for them.
    //
    // The tree is bought with ◇ Dread Cores from a WEEKLY raid and rides through
    // ascension — a deep score is months of real calendar time. There is no
    // honest way to invent that, and inventing it does active harm: every real
    // pilot whose row has not published a pilot_score yet reads 0 and sorts
    // BELOW the fabricated ones, so the board showed a handful of AI names and
    // hid the actual humans. Same rule the Voidmaw boards learned in 710 — real
    // published rows only, and if a board is thin, let it be thin.
    .filter((q) => {
      if (!tab.realOnly || q.isMe) return true;
      // No stand-ins (above), and no UNPUBLISHED rows either.
      //
      // A pilot whose row has never carried a pilot_score reads 0, and the board
      // rendered that as "No nodes unlocked · Lv 700" — which is a statement of
      // fact we do not have. FrostSkull at Lv 700 certainly has a tree; what we
      // have is silence from a client that has not published one yet, and
      // silence must not be printed as zero. Same rule as the Voidmaw rank fix:
      // an empty result and a missing one must not look the same.
      //
      // A leaderboard of tree scores lists pilots who have a tree score. If that
      // is a short list today, the board says so rather than padding itself with
      // rows asserting something false about real people.
      if (q._sim || q.is_simulated || q._filler) return false;
      return tab.metric(q) > 0;
    });
    rows.sort((a, b) => tab.metric(b) - tab.metric(a));
    rows.forEach((p, i) => { p.rank = i + 1; });
    return { rows, real: data.real || 0, tab, pending: false };
  }

  // YOUR row, read live from the save so it never lags the heartbeat.
  function mineInto(q) {
    const s = G().state || {};
    const own = s.ownedSystems || {}, cits = s.citadels || {};
    q.tiles = Object.keys(own).length;
    q.citadels = Object.keys(cits).length;
    q.tile_rev = tileRevenue();
    q.ships = Object.keys(s.ownedShips || {}).length || 1;
    q.missions = s.lifetimeMissions | 0;
    q.cargo = (s.cargo && s.cargo.wins) | 0;
    q.cargo_best = Math.min(100, (s.cargo && s.cargo.best) | 0);
    // ART FIELDS — which hull, which core, which freighter. The Discord feed can
    // see COUNTS change but not what changed, so it could never show real game
    // art for the thing that just happened. These three name it.
    q.cargo_tier = Math.min(5, Math.max(0, (s.cargo && s.cargo.lastTier) | 0));
    q.hull_last = String((s.lastHull && s.lastHull.key) || '').slice(0, 32);
    // HOME DEFENSE + EXPLORATION — read live from the save, same as every other
    // figure on this row, so your own rank never lags the publish heartbeat.
    q.hcwave = (s.homecit && s.homecit.wave) | 0;
    q.expo = (s.expo && s.expo.log && s.expo.log.done) | 0;
    q.expo_best = (s.expo && s.expo.log && s.expo.log.best) | 0;
    // PILOT TREE — read live from the save, for the same reason as every other
    // figure here. Without it your own row fell through to the SERVER's value,
    // which is 0 until pilot-ladder.sql has run and a publish has landed — so the
    // one board a player checks to see their own tree showed them at zero while
    // the Pilot screen showed the real score. Same source as publishFields(), so
    // the row and the publish can never disagree.
    try {
      const D = window.DREAD;
      q.pilot_score = Math.max(0, Math.floor(Number(D && D.pilotScore ? D.pilotScore() : 0) || 0));
      q.pilot_nodes = Math.max(0, Math.floor(Number(D && D.nodeCount ? D.nodeCount() : 0) || 0));
    } catch (e) {}
    // Read through MECHF so the board and the Foundry can never disagree about
    // what a pilot has earned. Never `| 0` — a career total is a published figure
    // and the bitwise habit is what wraps them negative.
    try { q.mech_cores = Math.max(0, Math.floor(Number(window.MECHF && MECHF.earned ? MECHF.earned() : 0) || 0)); } catch (e) {}
    // Command Score reads through COMMANDERS so the board and the roster screen
    // can never disagree about what a line-up is worth.
    try { q.cmdr_score = Math.max(0, Math.floor(Number(window.COMMANDERS && COMMANDERS.score ? COMMANDERS.score() : 0) || 0)); } catch (e) {}
    // THE SEATED LINE-UP, read live from the roster for the same reason as every
    // other figure on this row. Without it YOUR OWN row on the Command board fell
    // through to `meEntry`, which carries no cmdr_line at all — so the board drew
    // a real Command Score on a row captioned "No Commanders seated", and the one
    // row a player checks to see their own officers was the only row that never
    // showed them. Same source as publishFields(), so the row and the publish can
    // never disagree.
    try { q.cmdr_line = (window.COMMANDERS && COMMANDERS.lineup) ? COMMANDERS.lineup().slice(0, 5) : []; } catch (e) { q.cmdr_line = []; }
    // Nanocores read through the module so this row, the badge chains and the
    // Discord feed all quote one number.
    try {
      const f = (window.NANO && window.NANO.feedFields) ? window.NANO.feedFields() : null;
      q.nano_legend = f ? f.nano_legend | 0 : 0;
      q.nano_slots = f ? f.nano_slots | 0 : 0;
      q.nano_god = f ? f.nano_god | 0 : 0;
    } catch (e) { q.nano_legend = q.nano_slots = q.nano_god = 0; }
    q.badges = (() => {
      // Badges live in state.achieve.claimed (per-chain counts) — the old
      // badgeRanks/achClaimed fields never existed, so every real player
      // published 0 on this board. ACHIEVE.totalClaimed() is the same figure the
      // Missions screen shows; the inline sum is the no-module fallback.
      try { if (window.ACHIEVE && ACHIEVE.totalClaimed) return ACHIEVE.totalClaimed() | 0; } catch (e) {}
      try { const c = (s.achieve && s.achieve.claimed) || {}; let n = 0; for (const k in c) n += c[k] | 0; return Math.min(badgeTotal(), n); } catch (e) { return 0; }
    })();
    return q;
  }

  // A human row that has published the new columns uses them; one that hasn't
  // published since the migration reads 0 rather than a fabricated number.
  function fill(q) {
    q.tiles = q.tiles | 0; q.citadels = q.citadels | 0;
    q.tile_rev = Number(q.tile_rev) || 0;
    q.ships = q.ships | 0; q.missions = q.missions | 0; q.badges = q.badges | 0;
    q.cargo = q.cargo | 0; q.cargo_best = q.cargo_best | 0;
    q.cargo_tier = Math.min(5, Math.max(0, q.cargo_tier | 0));
    q.hull_last = String(q.hull_last || '').slice(0, 32);
    q.nano_last = String(q.nano_last || '').slice(0, 32);
    q.nano_legend = q.nano_legend | 0; q.nano_slots = Math.min(5, q.nano_slots | 0); q.nano_god = q.nano_god | 0;
    return q;
  }

  // Total hourly output of the GALAXY GROUND you hold — the thing this board
  // ranks. Per-tile figures come from GAME.tileRateOf, the same function the
  // Galaxy screen and Empire Income use, so the board can never disagree with
  // them about what a tile is worth.
  //
  // GALAXY ONLY, BECAUSE THE COUNTS BESIDE IT ARE. `tiles` and `citadels` were
  // fixed in 735/736 to exclude the neutral Home Citadel, the seven Void spires
  // and the three casino House Citadels — but this figure still summed
  // resourceRates(), which walks EVERY entry in ownedSystems. So a row read
  // "84 systems · 49 citadels" while its revenue also counted up to eleven
  // holdings those two numbers deliberately leave out, and a Void spire pays on
  // a different scale entirely (all four currencies, gold at ×1000). The row
  // could not explain its own number, and a spire-heavy account outranked a
  // larger empire on territory it did not hold.
  //
  // Empire Income is UNCHANGED and still counts everything — a spire really is
  // your income. It just is not territory.
  //
  // The old inline copy multiplied citadels by 1000×lv (real: 10×lv) and skipped
  // the ×25 galaxy yield, deep-space and Void handling — fortress players ranked
  // on numbers ~100× their real income. Gold is still normalised back to resource
  // units so a tile that ever pays it cannot swamp the figure.
  function tileRevenue() {
    try {
      const g = G();
      const own = (g.state && g.state.ownedSystems) || null;
      if (!own || !g.tileRateOf || !g.isGalaxyTile) {
        // Older client / helpers absent — fall back to the previous behaviour
        // rather than publishing a 0 that would drop the pilot off the board.
        const r = g.resourceRates ? g.resourceRates() : null;
        if (!r) return 0;
        return Math.round((r.fuel || 0) + (r.iron || 0) + (r.plasma || 0) + (r.gold || 0) / 1000);
      }
      let sum = 0;
      for (const id in own) {
        if (!own[id]) continue;
        if (!g.isGalaxyTile(id)) continue;          // no Void spires, no House Citadels, no Home
        const q = g.tileRateOf(id); if (!q) continue;
        sum += (q.perHour || 0) + (q.gold || 0) / 1000;
      }
      return Math.round(sum);
    } catch (e) { return 0; }
  }

  function myName() {
    try { return (G().state && G().state.name) || null; } catch (e) { return null; }
  }
  function myUid() {
    try { return (window.AUTH && AUTH.session && AUTH.session()) ? AUTH.session().id : null; } catch (e) { return null; }
  }

  // What THIS account publishes on its heartbeat — read by account.js.
  function publishFields() {
    try {
      const s = G().state || {};
      const out = {
        // GALAXY SYSTEMS ONLY, AND READ THROUGH THE GAME — same reasoning as
        // `citadels` below, which was fixed for this and left its neighbour
        // wrong. The raw key count included the neutral Home Citadel that EVERY
        // account holds, plus the Void spires and the casino House Citadels
        // (off-map ids living in the same map). So the Territory board ranked
        // pilots on up to eleven systems nobody had to take, it rewarded holding
        // the Void on the board about galaxy ground, and it disagreed with the
        // tile cap, My Galaxy and the tile pill — all of which read tileCount().
        tiles: (G().tileCount ? G().tileCount() : Object.keys(s.ownedSystems || {}).length),
        // CITADELS WAS MISSING FROM THIS OBJECT AND NOWHERE ELSE.
        // `mineInto()` set it, cloud.js sent `p_citadels`, lb_upsert declared it
        // and the column existed — but the value originates HERE, and it was never
        // added, so every real account published a hard 0. Simulated pilots get a
        // citadel count from derive(), so the Territory board showed fortresses for
        // bots and none for humans, on the one board where a citadel is the whole
        // point. Your own row looked right because mineInto reads the live save.
        // …and it is READ THROUGH THE GAME, never recounted here. `state.citadels`
        // also holds Void spires and the casino House Citadels, which are not
        // galaxy fortresses — G.citadelCount() is the single statement of what
        // counts, so this board and the build sheet cannot disagree about a total.
        citadels: (G().citadelCount ? G().citadelCount() : Object.keys(s.citadels || {}).length),
        tile_rev: tileRevenue(),
        ships: Object.keys(s.ownedShips || {}).length || 1,
        missions: s.lifetimeMissions | 0,
        hcwave: (s.homecit && s.homecit.wave) | 0,
        // PILOT TREE. Read through the module so the board and the tree screen
        // can never disagree about what a pilot's score is.
        pilot_score: (() => { try { return Math.max(0, Math.floor(Number(window.DREAD && DREAD.pilotScore ? DREAD.pilotScore() : 0) || 0)); } catch (e) { return 0; } })(),
        pilot_nodes: (() => { try { return Math.max(0, Math.floor(Number(window.DREAD && DREAD.nodeCount ? DREAD.nodeCount() : 0) || 0)); } catch (e) { return 0; } })(),
        // MECH FOUNDRY — lifetime cores EARNED, never the spendable wallet. A
        // wallet falls when a hull is assembled, and a ladder whose rows drop when
        // you play it punishes playing.
        mech_cores: (() => { try { return Math.max(0, Math.floor(Number(window.MECHF && MECHF.earned ? MECHF.earned() : 0) || 0)); } catch (e) { return 0; } })(),
        // COMMAND RANK — the score, plus the seated line-up so the board can draw
        // the officers the way the power board draws hulls.
        cmdr_score: (() => { try { return Math.max(0, Math.floor(Number(window.COMMANDERS && COMMANDERS.score ? COMMANDERS.score() : 0) || 0)); } catch (e) { return 0; } })(),
        cmdr_line: (() => { try { return (window.COMMANDERS && COMMANDERS.lineup) ? COMMANDERS.lineup().slice(0, 5) : []; } catch (e) { return []; } })(),
        expo: (s.expo && s.expo.log && s.expo.log.done) | 0,
        expo_best: (s.expo && s.expo.log && s.expo.log.best) | 0,
        cargo: (s.cargo && s.cargo.wins) | 0,
        cargo_best: Math.min(100, (s.cargo && s.cargo.best) | 0),
        cargo_tier: Math.min(5, Math.max(0, (s.cargo && s.cargo.lastTier) | 0)),
        hull_last: String((s.lastHull && s.lastHull.key) || '').slice(0, 32),
        badges: (() => {
      // Badges live in state.achieve.claimed (per-chain counts) — the old
      // badgeRanks/achClaimed fields never existed, so every real player
      // published 0 on this board. ACHIEVE.totalClaimed() is the same figure the
      // Missions screen shows; the inline sum is the no-module fallback.
      try { if (window.ACHIEVE && ACHIEVE.totalClaimed) return ACHIEVE.totalClaimed() | 0; } catch (e) {}
      try { const c = (s.achieve && s.achieve.claimed) || {}; let n = 0; for (const k in c) n += c[k] | 0; return Math.min(badgeTotal(), n); } catch (e) { return 0; }
    })(),
      };
      // NANOCORES — legendary-only figures (Legendary cores recovered, deepest
      // slot count on one of them, top-5% rolls), read through the module so the
      // Discord feed and the game can never disagree about what a pilot did.
      try { if (window.NANO && window.NANO.feedFields) Object.assign(out, window.NANO.feedFields()); } catch (e) {}
      return out;
    } catch (e) { return null; }
  }

  window.RANKBOARDS = { TABS, BY_ID, board, publishFields, tileRevenue };
})();

(function rbCmdrCss(){
  if (document.getElementById('rb-cmdr-css')) return;
  const s = document.createElement('style'); s.id = 'rb-cmdr-css';
  s.textContent = "\n/* ---- COMMAND RANK line-up -------------------------------------------------\n   The seated officers, drawn in the row the way fleetThumbs draws hulls. The\n   monogram sits UNDER the portrait rather than beside it, so a card with no art\n   yet still reads as an officer instead of a broken image. */\n.rb-cline{display:inline-flex;gap:4px;vertical-align:middle;margin-right:7px}\n.rb-cc{position:relative;width:22px;height:22px;flex:0 0 22px;border-radius:50%;overflow:hidden;\n  border:1px solid color-mix(in srgb,var(--c) 65%,transparent);\n  background:radial-gradient(circle at 35% 30%,color-mix(in srgb,var(--c) 55%,transparent),#0b0f16 78%);\n  box-shadow:0 0 6px -2px var(--c)}\n.rb-cc img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 18%;display:block}\n.rb-cc i{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;\n  font:800 9px/1 Rajdhani,sans-serif;font-style:normal;color:color-mix(in srgb,var(--c) 80%,#fff);letter-spacing:.02em}\n";
  document.head.appendChild(s);
})();
