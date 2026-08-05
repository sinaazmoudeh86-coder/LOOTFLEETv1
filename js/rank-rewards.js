/* =============================================================================
   rank-rewards.js — collect yesterday's ladder placings into the inbox
   ---------------------------------------------------------------------------
   daily_ranks_award() runs server-side at 00:05 UTC, snapshots all seven Ranks
   ladders and records an award row for each of the top 100. It cannot deliver
   them: mail lives in the player's SAVE (state.mail), not in a table.

   So this drains the ledger on login. claim_rank_awards() returns everything
   owed and marks it delivered in the same statement, so a second tab or a fast
   double-load can't mail the same prize twice. A player who has been away for a
   week collects seven days at once, newest first.

   The prize itself is paid the normal way — the mail carries the standard
   meta.kind='prize' payload, so CLAIM WINNINGS and READ ALL already work on it
   with no changes.
   ============================================================================= */
(function () {
  'use strict';

  const G = () => window.GAME;
  const cl = () => (window.CLOUD && window.CLOUD.enabled ? window.CLOUD.client : null);

  const BOARD = {
    power:    { ic: '\u26a1', name: 'Fleet Power',  unit: 'power' },
    tiles:    { ic: '\u2691', name: 'Territory',    unit: 'per hour' },
    voidmaw:  { ic: '\u2620', name: 'Voidmaw',      unit: 'stage' },
    ships:    { ic: '\u{1F6F8}', name: 'Hangar',    unit: 'hulls' },
    missions: { ic: '\u2714', name: 'Missions',     unit: 'cleared' },
    badges:   { ic: '\u2b21', name: 'Badges',       unit: 'ranks' },
  };

  const ord = (n) => {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };
  const fmt = (v) => { try { return G().formatNum(v); } catch (e) { return String(Math.round(v || 0)); } };

  function medal(rank) {
    return rank === 1 ? '\u{1F947}' : rank === 2 ? '\u{1F948}' : rank === 3 ? '\u{1F949}' : '\u{1F3C5}';
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

    // Group by day so a week away produces seven letters, not seventy.
    const byDay = new Map();
    for (const a of rows) {
      const k = a.day;
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(a);
    }

    // Oldest first, so the newest day ends up at the top of the inbox.
    const days = [...byDay.keys()].sort();
    for (const day of days) {
      const list = byDay.get(day).sort((x, y) => x.rank - y.rank);
      const lc = list.reduce((t, a) => t + (a.lc | 0), 0);
      if (!lc) continue;

      const best = list[0];
      const lines = list.map((a) => {
        const b = BOARD[a.board] || { ic: '\u2022', name: a.board, unit: '' };
        const val = a.board === 'voidmaw' ? 'stage ' + Math.round(a.value) : fmt(a.value);
        return '<div style="display:flex;align-items:center;gap:8px;margin:5px 0">' +
          '<span style="font-size:14px">' + medal(a.rank) + '</span>' +
          '<b>' + ord(a.rank) + '</b> \u00b7 ' + b.ic + ' ' + b.name +
          ' <span style="opacity:.6">(' + val + ')</span>' +
          '<span style="margin-left:auto;color:#f2a93c;font-weight:700">\u25c8 ' + fmt(a.lc) + '</span></div>';
      }).join('');

      window.MAIL.push({
        ic: medal(best.rank),
        title: 'Daily standings \u2014 ' + ord(best.rank) + ' on ' +
               ((BOARD[best.board] || {}).name || best.board) +
               (list.length > 1 ? ' +' + (list.length - 1) + ' more' : ''),
        body: 'Your placings for <b>' + day + '</b>, ranked against every other operator.' +
              '<div style="margin:10px 0 4px">' + lines + '</div>' +
              '<div style="opacity:.65;font-size:11.5px;margin-top:8px">Ladders are scored across real operators only. ' +
              'Rankings reset daily at 00:05 UTC.</div>',
        meta: { kind: 'prize', prize: { lc }, day, boards: list.length },
      });
    }
  }

  // After the cloud save has landed, so the inbox we push into is the real one
  // rather than a fresh local save about to be replaced.
  function boot() { setTimeout(() => { claim().catch(() => {}); }, 9000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.RANKREWARDS = { claim };
})();
