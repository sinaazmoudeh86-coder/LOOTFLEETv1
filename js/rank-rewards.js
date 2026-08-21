/* =============================================================================
   rank-rewards.js — LADDER WINNINGS, DELIVERED BY MAIL
   ---------------------------------------------------------------------------
   daily_ranks_award() runs server-side at 00:05 UTC, snapshots every Ranks
   ladder and records an award row for each of the top 100. It cannot deliver
   them: mail lives in the player's SAVE (state.mail), not in a table.

   So this drains the ledger on login. claim_rank_awards() returns everything
   owed and marks it delivered in the same statement, so a second tab or a fast
   double-load can't mail the same prize twice. A player who has been away for a
   week collects seven days at once, newest first.

   The prize itself is paid the normal way — the mail carries the standard
   meta.kind='prize' payload, so CLAIM WINNINGS and READ ALL already work on it
   with no changes.

   WHAT CHANGED IN 680 — ONE LETTER PER WIN, IN THAT LADDER'S OWN VOICE.
   ---------------------------------------------------------------------------
   Every placing used to arrive in a single "Daily standings" letter: same
   sentence for a galaxy-first Fleet Power crown as for 74th on Hangar. A win is
   the one moment a ladder gets to explain itself, and that letter explained
   nothing — so nobody could tell what they had actually beaten.

   Now the split follows how much the placing is worth saying out loud:
     • PODIUM (1st–3rd) — its own letter, that ladder's own copy, naming what
       the board measures and what the finish means. #1 gets the crown line.
     • 4th–100th — one compact digest for the day, because seven mid-table
       placings are a scoreboard, not seven pieces of news.
   Every award row's LootCoins are carried by exactly ONE letter either way:
   podium letters carry their own row, the digest carries the sum of the rest.
   Splitting the presentation must never split — or duplicate — the payout.
   ============================================================================= */
(function () {
  'use strict';

  const G = () => window.GAME;
  const cl = () => (window.CLOUD && window.CLOUD.enabled ? window.CLOUD.client : null);

  // Per-ladder voice. `what` is what the board measures; `win` is what topping
  // it actually says about the operator. Both are written to be true of a #1 —
  // podium copy is the only place they are used.
  const BOARD = {
    power: {
      ic: '\u26a1', name: 'Fleet Power', unit: 'power', col: '#f2b24b',
      what: 'Total combat rating — your hull, every fitting on it, your drones, fighters and cores, resolved into one number.',
      win: 'Nobody in the galaxy is flying a stronger fleet today.',
    },
    asc: {
      ic: '\u2726', name: 'Ascension', unit: 'stars', col: '#ffd24d',
      what: 'Ascension stars — full runs finished and given up for permanent account-wide power.',
      win: 'More completed lifetimes than any other pilot on record.',
    },
    tiles: {
      ic: '\u2691', name: 'Territory', unit: 'per hour', col: '#5fa8ff',
      what: 'Hourly revenue from the systems you hold — not how many tiles, but how much they earn.',
      win: 'The richest holdings in the galaxy, and you kept them through the night.',
    },
    voidmaw: {
      ic: '\u2620', name: 'Voidmaw', unit: 'stage', col: '#ff4d6d',
      what: 'Deepest Voidmaw stage cleared this season.',
      win: 'No fleet has cut deeper into the Voidmaw.',
    },
    ships: {
      ic: '\u27a4', name: 'Hangar', unit: 'hulls', col: '#7ce0a0',
      what: 'Every hull built, bought or granted — the size of the collection, not the fleet flying.',
      win: 'The largest hangar in the galaxy.',
    },
    missions: {
      ic: '\u2714', name: 'Missions', unit: 'cleared', col: '#5fd1ff',
      what: 'Missions completed across every board — daily, weekly and monthly, carried through ascension.',
      win: 'More contracts closed than anyone else flying.',
    },
    cargo: {
      ic: '\u26df', name: 'Haulage', unit: 'delivered', col: '#ffb84d',
      what: 'Cargo Defense shipments escorted to the Citadel intact.',
      win: 'The safest pair of hands in the galaxy — nobody has landed more.',
    },
    nano: {
      ic: '\u25c8', name: 'Nanocore', unit: 'cores', col: '#f0972a',
      what: 'Legendary Nanocores recovered, at 1.5% a crate.',
      win: 'The luckiest — and most patient — core hunter on the board.',
    },
    badges: {
      ic: '\u2b21', name: 'Badges', unit: 'ranks', col: '#b57bff',
      what: 'Commendations claimed, out of 1,000. Claim them all and the Titan Sina is granted.',
      win: 'Further along the commendation track than any other operator.',
    },
    // ---- the three ladders added in 680 --------------------------------------
    hcwave: {
      ic: '\u26e8', name: 'Home Defense', unit: 'wave', col: '#6fe0a0',
      what: 'The deepest Home Citadel wave you are holding — defence that keeps earning while you are offline.',
      win: 'No citadel in the galaxy is holding a deeper wave than yours.',
    },
    expo: {
      ic: '\u25ce', name: 'Exploration', unit: 'expeditions', col: '#7fe0ff',
      what: 'Expeditions completed and debriefed — hours of hull time spent surveying the rim.',
      win: 'More of the rim has been charted by your fleet than by anyone else\u2019s.',
    },
    koth: {
      ic: '\u{1F451}', name: 'King of the Hill', unit: 'kills', col: '#ffd24d',
      what: 'Kills logged in the 24-hour race, against enemies that get harder with every hundred you drop.',
      win: 'You out-killed the entire galaxy inside one day.',
    },
  };
  const FALLBACK = { ic: '\u2022', name: '', unit: '', col: '#93a2ba', what: '', win: '' };

  const ord = (n) => {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };
  const fmt = (v) => { try { return G().formatNum(v); } catch (e) { return String(Math.round(v || 0)); } };
  const medal = (r) => (r === 1 ? '\u{1F947}' : r === 2 ? '\u{1F948}' : r === 3 ? '\u{1F949}' : '\u{1F3C5}');
  // Voidmaw and Home Defense are ordinal ladders — "stage 41" reads, "41" does not.
  function valueOf(a) {
    if (a.board === 'voidmaw') return 'stage ' + Math.round(a.value);
    if (a.board === 'hcwave') return 'wave ' + Math.round(a.value);
    return fmt(a.value);
  }

  // ---------------------------------------------------------------------------
  // PODIUM LETTER — one board, one finish, that board's own words
  // ---------------------------------------------------------------------------
  function podiumMail(a, day) {
    const b = BOARD[a.board] || FALLBACK;
    const first = a.rank === 1;
    const head = first
      ? 'You finished <b>first</b> in the galaxy.'
      : 'You finished <b>' + ord(a.rank) + '</b> in the galaxy.';
    return {
      ic: medal(a.rank),
      title: (first ? '\u{1F451} ' : '') + ord(a.rank) + ' \u00b7 ' + b.name +
             (first ? ' \u2014 galaxy first' : ''),
      body:
        '<div style="font:800 11px/1 \'Rajdhani\',sans-serif;letter-spacing:.2em;color:' + b.col + ';margin-bottom:6px">' +
          b.ic + ' ' + b.name.toUpperCase() + ' \u00b7 ' + day + '</div>' +
        '<div style="font-size:13px;line-height:1.6">' + head + '</div>' +
        '<div style="display:flex;align-items:baseline;gap:8px;margin:10px 0;padding:10px 12px;border-radius:9px;' +
          'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08)">' +
          '<span style="font:900 24px/1 \'Orbitron\',sans-serif;color:' + b.col + '">' + valueOf(a) + '</span>' +
          '<span style="opacity:.6;font-size:11.5px">' + b.unit + '</span>' +
          '<span style="margin-left:auto;color:#f2a93c;font-weight:800">\u25c8 ' + fmt(a.lc) + '</span>' +
        '</div>' +
        (first && b.win ? '<div style="font-size:12.5px;line-height:1.6;color:' + b.col + '">' + b.win + '</div>' : '') +
        (b.what ? '<div style="opacity:.65;font-size:11.5px;line-height:1.55;margin-top:8px">' + b.what + '</div>' : '') +
        '<div style="opacity:.5;font-size:11px;margin-top:8px">Scored against real operators only. Ladders reset daily at 00:05 UTC.</div>',
      meta: (a.lc | 0) > 0
        // A PODIUM FINISH WORTH NO LOOTCOINS IS NEWS, NOT A PRIZE. Tagging it
        // kind:'prize' with lc:0 puts a CLAIM WINNINGS button on a letter that
        // pays nothing — the player taps it, nothing happens, and they reasonably
        // conclude the prize was eaten. Send it as an ordinary letter instead.
        ? { kind: 'prize', prize: { lc: a.lc | 0 }, day, board: a.board, rank: a.rank }
        : { day, board: a.board, rank: a.rank },
    };
  }

  // ---------------------------------------------------------------------------
  // DIGEST — everything from 4th down, one letter for the day
  // ---------------------------------------------------------------------------
  function digestMail(list, day) {
    const lc = list.reduce((t, a) => t + (a.lc | 0), 0);
    const lines = list.map((a) => {
      const b = BOARD[a.board] || FALLBACK;
      return '<div style="display:flex;align-items:center;gap:8px;margin:5px 0">' +
        '<span style="font-size:13px;width:16px;text-align:center;color:' + b.col + '">' + b.ic + '</span>' +
        '<b>' + ord(a.rank) + '</b> \u00b7 ' + (b.name || a.board) +
        ' <span style="opacity:.6">(' + valueOf(a) + ')</span>' +
        '<span style="margin-left:auto;color:#f2a93c;font-weight:700">\u25c8 ' + fmt(a.lc) + '</span></div>';
    }).join('');
    return {
      ic: '\u{1F3C5}',
      title: 'Daily standings \u2014 ' + list.length + ' ladder' + (list.length === 1 ? '' : 's') + ' placed',
      body: 'Where you finished on <b>' + day + '</b>, outside the podium.' +
            '<div style="margin:10px 0 4px">' + lines + '</div>' +
            '<div style="opacity:.6;font-size:11.5px;margin-top:8px">Top 100 on a ladder pays out. ' +
            'Finish in the top three and the board writes you its own letter.</div>',
      meta: { kind: 'prize', prize: { lc }, day, boards: list.length },
    };
  }

  async function claim() {
    const c = cl();
    if (!c || !window.MAIL || !G() || !G().state) return;
    let rows;
    try {
      const r = await c.rpc('claim_rank_awards');
      // The RPC arrives with rank-rewards.sql. Until that runs, do nothing at
      // all — quietly, since this fires on every login.
      if (r.error) return;
      rows = r.data || [];
    } catch (e) { return; }
    if (!rows.length) return;

    // Group by day so a week away produces seven days of letters, not seventy.
    const byDay = new Map();
    for (const a of rows) {
      if (!byDay.has(a.day)) byDay.set(a.day, []);
      byDay.get(a.day).push(a);
    }

    // Oldest first, so the newest day ends up at the top of the inbox.
    for (const day of [...byDay.keys()].sort()) {
      const list = byDay.get(day).sort((x, y) => x.rank - y.rank);
      // A row worth no LootCoins is a placing, not a prize — it still deserves
      // its letter on the podium, but it must never open an empty digest.
      const podium = list.filter((a) => a.rank <= 3);
      const rest = list.filter((a) => a.rank > 3 && (a.lc | 0) > 0);
      for (const a of podium) window.MAIL.push(podiumMail(a, day));
      if (rest.length) window.MAIL.push(digestMail(rest, day));
    }
  }

  // After the cloud save has landed, so the inbox we push into is the real one
  // rather than a fresh local save about to be replaced.
  function boot() { setTimeout(() => { claim().catch(() => {}); }, 9000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.RANKREWARDS = { claim, BOARD };
})();
