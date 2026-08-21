/* =============================================================================
   koth-ui.js — KING OF THE HILL · screens, in-arena pill, overlay
   ---------------------------------------------------------------------------
   Three surfaces:
     SCREEN   Command ▸ King of the Hill — countdown, leader, your standing,
              the difficulty ladder, the full board and the Hall of Kings
     PILL     a persistent 👑 KOTH | #7 | 582 strip in the arena's #top-stack
     OVERLAY  tap the pill for the top 5, your rank and the gap to the next one

   The pill is the whole point of the design: leaderboard movement is supposed to
   be gameplay, not something you leave the zone to check.
============================================================================= */
(function () {
  'use strict';
  const K = () => window.KOTH;
  const G = () => window.GAME;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const fmt = (n) => { try { return G().formatNum(Math.floor(n || 0)); } catch (e) { return String(Math.floor(n || 0)); } };
  const num = (n) => (Math.floor(n || 0)).toLocaleString();
  function hms(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0');
  }
  const medal = (r) => (r === 1 ? '👑' : r === 2 ? '🥈' : r === 3 ? '🥉' : '#' + r);
  function shipImg(k, cls) {
    if (!k) return '<span class="' + cls + ' none"></span>';
    return '<img class="' + cls + '" src="ships/ship-' + esc(k) + '.png" alt="" decoding="async" onerror="this.style.visibility=\'hidden\'">';
  }
  function toast(m) { try { window.UI.unlockToast(m); } catch (e) {} }

  // ===========================================================================
  // SCREEN
  // ===========================================================================
  let _tick = null, _hall = null, _hallAt = 0;
  function render() {
    const body = $('koth-body'); if (!body || !K()) return;
    K().setOpen(true);
    if (!K().unlocked()) { body.innerHTML = locked(); stopTick(); return; }
    body.innerHTML = hero() + ladder() + boardSection() + hallSection();
    head();
    loadHall();
    startTick();
  }
  function locked() {
    return '<div class="koth-empty"><div class="koth-empty-ic">👑</div><h3>King of the Hill</h3>'
      + '<p>Unlocks at <b>Level ' + K().GATE_LV + '</b>. A 24-hour kill race in a private arena of Level 200 hostiles — '
      + 'no XP, no loot, no resources. Most kills at the reset takes <b>10,000 LootCoins</b>.</p></div>';
  }
  function head() {
    const sub = $('koth-sub'); if (!sub) return;
    const b = K().board(), lead = b && b[0];
    sub.innerHTML = '<b class="koth-clock">' + hms(K().msLeft()) + '</b> remaining'
      + (lead ? ' · 👑 ' + esc(lead.name) + ' — ' + num(lead.kills) : ' · no kills yet');
  }

  function hero() {
    const k = K().kills(), r = K().rank(), t = K().tierFor(k);
    const b = K().board(), lead = (b && b[0]) || null;
    const live = K().active();
    const signed = K().signedIn();
    return '<div class="koth-hero">'
      + '<div class="koth-crown">👑</div>'
      + '<div class="koth-t">KING OF THE HILL</div>'
      + '<div class="koth-k">PvE KILL RACE</div>'
      + '<div class="koth-timer" id="koth-timer">' + hms(K().msLeft()) + '</div>'
      + '<div class="koth-line">Destroy as many enemies as possible before time expires.</div>'
      + '<div class="koth-stats">'
        + '<span><i>CURRENT LEADER</i><b>' + (lead ? esc(lead.name) : '—') + '</b><u>' + (lead ? num(lead.kills) + ' kills' : 'no kills yet') + '</u></span>'
        + '<span><i>YOUR RANK</i><b>' + (r ? '#' + r : '—') + '</b><u>' + num(k) + ' kills</u></span>'
        + '<span><i>YOUR TIER</i><b>LV ' + num(t.level) + '</b><u>' + fmtMult(t.hp, t.capped) + ' HP</u></span>'
      + '</div>'
      + '<div class="koth-prize">🪙 PRIZE: <b>10,000 LOOT COINS</b></div>'
      + (signed
        ? '<button class="koth-go' + (live ? ' in' : '') + '" id="koth-enter">' + (live ? 'RETURN TO THE ARENA' : 'ENTER KING OF THE HILL') + '</button>'
        : '<div class="koth-warn signin">⚠ <b>You are not signed in — these kills are not being scored.</b><br>The ladder is server-side. Sign in before you race, or the run does not count.</div>')
      + '<div class="koth-warn">NO XP &nbsp;•&nbsp; NO LOOT &nbsp;•&nbsp; KILLS ONLY</div>'
      + '</div>';
  }
  // BIG NUMBERS MUST STILL READ AS NUMBERS. The HP multiplier climbs by doubling,
  // so past a few million digits-on-the-card is the failure mode: a sixty-digit
  // string is not information. Thousands stay literal, everything above a million
  // goes scientific, and the capped top band says WALL instead of a figure.
  function fmtMult(m, capped) {
    if (capped) return '✖ WALL';
    if (!isFinite(m)) return '✖ WALL';
    if (m < 1000) return '×' + m;
    if (m < 1e6) return '×' + Math.round(m).toLocaleString();
    const e = Math.floor(Math.log10(m));
    return '×' + (m / Math.pow(10, e)).toFixed(1) + 'e' + e;
  }

  function ladder() {
    const k = K().kills(), cur = K().tierFor(k);
    const rows = K().TIERS.map((t, i) => {
      const next = K().TIERS[i + 1];
      const to = next ? next[0] - 1 : (t[0] + K().BAND - 1);
      const on = cur.idx === i;
      return '<div class="koth-tr' + (on ? ' on' : '') + (k > to ? ' past' : '') + '">'
        + '<span class="ktr-k">' + num(t[0]) + '–' + num(to) + '</span>'
        + '<span class="ktr-l">LV ' + num(t[1]) + '</span>'
        + '<span class="ktr-h">' + fmtMult(t[2]) + ' HP</span>'
        + (on ? '<span class="ktr-you">YOU</span>' : '') + '</div>';
    }).join('');
    // PAST THE PRINTED BANDS, STATE THE RULE — not a made-up row. The old line
    // advertised "HP triples / 100", which stopped being true in 694 when the
    // curve went from exponential to a square law. A difficulty card that
    // describes a curve the game no longer runs is worse than no card.
    const openFrom = K().TIERS.length * K().BAND;
    const open = '<div class="koth-tr open' + (cur.open ? ' on' : '') + '">'
      + '<span class="ktr-k">' + num(openFrom) + '+</span><span class="ktr-l">+' + (K().lvlFor(K().BAND) - K().lvlFor(0)) + ' LV / 100 kills</span>'
      + '<span class="ktr-h">HP grows with kills²</span>'
      + (cur.open ? '<span class="ktr-you">LV ' + num(cur.level) + ' · ' + fmtMult(cur.hp, cur.capped) + '</span>' : '') + '</div>';
    return '<div class="koth-sec"><div class="koth-sec-h"><span class="koth-sec-t">☠ DIFFICULTY</span>'
      + '<span class="koth-sec-n">HP scales, damage is zero — the wall is your kills per minute</span></div>'
      + '<div class="koth-ladder">' + rows + open + '</div>'
      + '<div class="koth-sec-f">Every hostile carries ×(1 + kills ÷ ' + K().HP_SOFT + ')² base HP. The cost per kill never stops rising, '
      + 'but it rises gently enough that a stronger fleet always scores higher — there is no fixed wall.</div></div>';
  }

  function boardSection() {
    return '<div class="koth-sec"><div class="koth-sec-h"><span class="koth-sec-t">🏆 LEADERBOARD</span>'
      + '<span class="koth-sec-n" id="koth-board-n">' + num(K().entrants()) + ' racing · updates every 9s</span></div>'
      + '<div class="koth-board" id="koth-board-list">' + boardRows() + '</div></div>';
  }
  function boardRows() {
    const b = K().board() || [];
    const me = K().rank(), mine = K().kills();
    let rows = b.map((r) => row(r.rank, r.name, r.kills, r.ship, r.rank === me)).join('');
    if (!rows) rows = '<div class="koth-none">No kills logged yet today. Be the first name on the board.</div>';
    // the player's own row is always visible, even outside the top 25
    const off = me && me > b.length;
    let ship = null; try { ship = (G().state || {}).ship; } catch (e) {}
    return rows + (off ? '<div class="koth-gap">· · ·</div>' + row(me, 'YOU', mine, ship, true) : '');
  }
  function row(rank, name, kills, ship, isMe) {
    return '<div class="koth-row' + (isMe ? ' me' : '') + (rank === 1 ? ' king' : '') + '">'
      + '<span class="kr-r">' + medal(rank) + '</span>'
      + shipImg(ship, 'kr-s')
      + '<span class="kr-n">' + esc(name) + (isMe ? ' <em>YOU</em>' : '') + '</span>'
      + '<span class="kr-k">' + num(kills) + '</span></div>';
  }

  function hallSection() {
    return '<div class="koth-sec"><div class="koth-sec-h"><span class="koth-sec-t">👑 HALL OF KINGS</span>'
      + '<span class="koth-sec-n">every crown, kept</span></div>'
      + '<div class="koth-hall" id="koth-hall-list">' + hallRows() + '</div></div>';
  }
  function hallRows() {
    const h = _hall || [];
    return h.length
      ? h.map((r) => '<div class="koth-hrow">'
          + '<span class="kh-d">' + esc(dayLabel(r.day)) + '</span>'
          + shipImg(r.ship, 'kh-s')
          + '<span class="kh-n">👑 ' + esc(r.name || '—') + '</span>'
          + '<span class="kh-k">' + num(r.kills) + '</span></div>').join('')
      : '<div class="koth-none">No races have closed yet. Today could be the first entry.</div>';
  }
  function dayLabel(d) {
    try { return new Date((d | 0) * 86400000).toLocaleDateString([], { month: 'short', day: 'numeric' }); }
    catch (e) { return String(d); }
  }
  async function loadHall() {
    if (_hall && Date.now() - _hallAt < 120000) return;
    try {
      const c = window.CLOUD && window.CLOUD.client; if (!c) return;
      const r = await c.rpc('koth_hall_top', { p_n: 14 });
      if (r.error) return;
      _hall = r.data || []; _hallAt = Date.now();
      const host = $('koth-hall-list');
      if (host) host.innerHTML = hallRows();
    } catch (e) {}
  }

  function startTick() {
    stopTick();
    _tick = setInterval(() => {
      const sc = $('screen-koth');
      if (!sc || !sc.classList.contains('active') || document.hidden) { stopTick(); K().setOpen(false); return; }
      const t = $('koth-timer'); if (t) t.textContent = hms(K().msLeft());
      head();
      // repaint the standings in place rather than rebuilding the screen, so a
      // refresh never scrolls the player back to the top
      const list = $('koth-board-list'); if (list) list.innerHTML = boardRows();
      const n = $('koth-board-n'); if (n) n.textContent = num(K().entrants()) + ' racing · updates every 9s';
    }, 1000);
  }
  function stopTick() { if (_tick) { clearInterval(_tick); _tick = null; } }

  // ===========================================================================
  // IN-ARENA PILL + OVERLAY
  // ===========================================================================
  // THE PILL'S CLICK IS DELEGATED, NOT BOUND. It used to carry its own listener,
  // which is why it worked exactly once: the heartbeat below recreates the pill
  // whenever it goes missing from #top-stack (an arena re-render, an event warbar
  // being inserted, a screen change), and the rebuilt node had no handler on it
  // until the next full ensurePill(). Delegating at the document means the pill
  // can be destroyed and rebuilt as often as the arena likes and the tap keeps
  // working. See the WIRING block at the bottom.
  function ensurePill() {
    const host = $('top-stack'); if (!host || !K()) return;
    let p = $('koth-pill');
    if (!p) {
      p = document.createElement('button');
      p.id = 'koth-pill'; p.type = 'button';
      host.appendChild(p);
    } else if (p.parentNode !== host) {
      host.appendChild(p);
    }
    syncPill();
  }
  // Only the RUN ending should close the overlay — rebuilding the pill must not.
  function removePill() { const p = $('koth-pill'); if (p) p.remove(); closeOverlay(); }
  function syncPill() {
    const p = $('koth-pill'); if (!p || !K()) return;
    const r = K().rank(), k = K().kills();
    // PAUSED IS A STATE THE PILL HAS TO SHOW. Kills silently not counting is
    // indistinguishable from a broken feature, so it says PAUSED outright rather
    // than just freezing the number and letting the player guess.
    let away = null;
    try { const pr = K().presence && K().presence(); if (pr && !pr.on) away = pr; } catch (e) {}
    p.className = away ? 'paused' : (r === 1 ? 'king' : '');
    if (away) p.title = 'Scoring paused — ' + away.why + '. Touch the screen to resume.';
    else p.removeAttribute('title');
    p.innerHTML = '<span class="kp-c">' + (away ? '⏸' : '👑') + '</span><span class="kp-t">' + (away ? 'PAUSED' : 'KOTH') + '</span>'
      + '<span class="kp-r">' + (r ? '#' + r : '—') + '</span>'
      + '<span class="kp-k">' + num(k) + '</span>'
      + '<span class="kp-x">' + hms(K().msLeft()) + '</span>';
  }
  let _ovT = null, _polled = false;
  // OPEN AND CLOSE ARE DECIDED BY THE DOM, NOT BY A CACHED VARIABLE. The old
  // version toggled on a module-level `_ov` handle; the moment that handle and
  // the real DOM disagreed — a detached node, a node removed by something else,
  // a close that ran twice — the toggle deadlocked and the pill appeared dead.
  // Asking the document cannot go stale.
  const ovNode = () => $('koth-ov');
  function openOverlay() {
    if (!K()) return;
    if (ovNode()) { closeOverlay(); return; }
    const ov = document.createElement('div'); ov.id = 'koth-ov';
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => {
      if (e.target === ov || (e.target.closest && e.target.closest('[data-close]'))) { closeOverlay(); return; }
      if (e.target.closest && e.target.closest('[data-full]')) {
        closeOverlay();
        try { window.UI.showScreen('koth'); } catch (er) {}
      }
    });
    paintOverlay();
    // FIRST CLICK USED TO SHOW AN EMPTY BOARD. pollBoard() is async, so the first
    // paint ran before any standings existed and the card said "No kills logged
    // yet" — which reads as "the race is empty", not "still loading". Paint a
    // loading state instead, then repaint the moment the answer lands.
    Promise.resolve(K().pollBoard()).catch(() => {}).then(() => { _polled = true; paintOverlay(); });
    clearInterval(_ovT);
    _ovT = setInterval(paintOverlay, 1000);
  }
  function closeOverlay() {
    if (_ovT) { clearInterval(_ovT); _ovT = null; }
    // sweep by selector — a duplicate left behind by any path is cleared too
    document.querySelectorAll('#koth-ov').forEach((n) => n.remove());
  }
  function paintOverlay() {
    const ov = ovNode();
    if (!ov || !K()) { if (_ovT) { clearInterval(_ovT); _ovT = null; } return; }
    const b = (K().board() || []).slice(0, 5);
    const me = K().rank(), mine = K().kills(), next = K().nextRankAt();
    const gap = (next != null && next > mine) ? (next - mine) : 0;
    ov.innerHTML = '<div class="kov-card">'
      + '<button class="kov-x" data-close type="button">✕</button>'
      + '<div class="kov-h">👑 KING OF THE HILL</div>'
      + '<div class="kov-clock">' + hms(K().msLeft()) + ' REMAINING</div>'
      + '<div class="kov-list">' + (b.length
        ? b.map((r) => '<div class="kov-r' + (r.rank === me ? ' me' : '') + '">'
            + '<span class="kv-r">' + medal(r.rank) + '</span>'
            + '<span class="kv-n">' + esc(r.name) + '</span>'
            + '<span class="kv-k">' + num(r.kills) + '</span></div>').join('')
        : '<div class="kov-none">' + (_polled ? 'No kills logged yet.' : 'Loading standings\u2026') + '</div>') + '</div>'
      + '<div class="kov-you"><i>YOU</i><b>' + (me ? '#' + me : 'unranked') + '</b><span>' + num(mine) + ' KILLS</span></div>'
      + (K().scoring() ? '' : '<div class="kov-warn">\u26a0 Not signed in \u2014 these kills are not being scored.</div>')
      + (gap > 0 && me > 1
          ? '<div class="kov-next">▲ <b>' + num(gap) + '</b> kill' + (gap === 1 ? '' : 's') + ' to #' + (me - 1) + '</div>'
          : me === 1 ? '<div class="kov-next king">👑 YOU ARE THE KING</div>' : '')
      + '<button class="kov-full" data-full type="button">VIEW FULL LEADERBOARD</button>'
      + '</div>';
  }

  // ===========================================================================
  // WIRING
  // ===========================================================================
  document.addEventListener('click', (e) => {
    const t = e.target; if (!t || !t.closest || !K()) return;
    // THE PILL. Delegated so a rebuilt node keeps working, and the propagation is
    // stopped so the arena's own input layer underneath never also sees the tap.
    if (t.closest('#koth-pill')) {
      e.preventDefault(); e.stopPropagation();
      openOverlay();
      return;
    }
    if (t.closest('#koth-enter')) {
      if (!K().signedIn()) { toast('Sign in to compete for the crown'); return; }
      if (K().enter()) { try { window.UI.showScreen('battle'); } catch (er) {} }
    }
  });
  // the pill must exist for the whole time the run does, even across screens
  setInterval(() => {
    try {
      if (!K()) return;
      const live = K().active();
      const p = $('koth-pill');
      if (live && !p) ensurePill();
      else if (!live && p) removePill();
      else if (live) syncPill();
    } catch (e) {}
  }, 1000);

  window.KOTHUI = { render, ensurePill, removePill, syncPill, openOverlay, closeOverlay };
})();
