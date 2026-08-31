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
  let _tick = null, _hall = null, _hallAt = 0, _hallErr = null;
  function render() {
    const body = $('koth-body'); if (!body || !K()) return;
    K().setOpen(true);
    if (!K().unlocked()) { body.innerHTML = locked(); stopTick(); return; }
    body.innerHTML = hero() + presenceSection() + ladder() + boardSection() + hallSection();
    head();
    loadHall();
    startTick();
  }
  function locked() {
    return '<div class="koth-empty"><div class="koth-empty-ic">👑</div><h3>King of the Hill</h3>'
      + '<p>Unlocks at <b>Level ' + K().GATE_LV + '</b>. A 24-hour kill race in a private arena of Level 200 hostiles — '
      + 'no XP, no loot, no resources. Most kills at the reset takes <b>' + num(K().PRIZE_LC) + ' LootCoins</b>.</p></div>';
  }
  function head() {
    const sub = $('koth-sub'); if (!sub) return;
    const b = K().board(), lead = b && b[0];
    sub.innerHTML = '<b class="koth-clock">' + hms(K().msLeft()) + '</b> remaining'
      + (lead ? ' · 👑 ' + esc(lead.name) + ' — ' + num(lead.kills) : ' · no kills yet');
  }

  function hero() {
    const k = K().myKills(), r = K().rank(), t = K().tierFor(k);
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
      + '<div class="koth-prize">🪙 PRIZE: <b>' + num(K().PRIZE_LC) + ' LOOT COINS</b></div>'
      + (signed
        ? '<button class="koth-go' + (live ? ' in' : '') + '" id="koth-enter">' + (live ? 'RETURN TO THE ARENA' : 'ENTER KING OF THE HILL') + '</button>'
        : '<div class="koth-warn signin">⚠ <b>You are not signed in — these kills are not being scored.</b><br>The ladder is server-side. Sign in before you race, or the run does not count.</div>')
      + '<div class="koth-warn">NO XP &nbsp;•&nbsp; NO LOOT &nbsp;•&nbsp; KILLS ONLY</div>'
      + '</div>';
  }
  // A multiplier is information up to a point. Thousands stay literal, and the
  // ceiling reads MAX rather than a bare figure — it is the top of the ramp, not
  // a number that keeps climbing.
  function fmtMult(m, capped) {
    if (!isFinite(m)) return '✖ WALL';
    const n = m < 1000 ? '×' + m : '×' + Math.round(m).toLocaleString();
    return capped ? n + ' MAX' : n;
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
    const ceil = K().hpCeil();
    const open = '<div class="koth-tr open' + (cur.open ? ' on' : '') + '">'
      + '<span class="ktr-k">' + num(openFrom) + '+</span><span class="ktr-l">+' + (K().lvlFor(K().BAND) - K().lvlFor(0)) + ' LV / 100 kills</span>'
      + '<span class="ktr-h">HP climbs to ×' + Math.round(ceil) + ', then holds</span>'
      + (cur.open ? '<span class="ktr-you">LV ' + num(cur.level) + ' · ' + fmtMult(cur.hp, cur.capped) + '</span>' : '') + '</div>';
    return '<div class="koth-sec"><div class="koth-sec-h"><span class="koth-sec-t">☠ DIFFICULTY</span>'
      + '<span class="koth-sec-n">HP scales, damage is zero — the wall is your kills per minute</span></div>'
      + '<div class="koth-ladder">' + rows + open + '</div>'
      + '<div class="koth-sec-f">HP tops out at <b>×' + Math.round(ceil) + '</b> base — the same hostile a <b>Level '
      + K().CAP_PILOT_LV + '</b> pilot fights on-level. Enemy level keeps climbing past it.</div></div>';
  }

  // THE PRESENCE RULE, STATED BEFORE IT FIRES.
  // It used to live in exactly two places — a one-time banner the first time it
  // tripped, and the pill's `title` attribute, which is invisible on touch and
  // needs a deliberate hover on desktop. So the first a pilot knew of it was the
  // word PAUSED with no reason attached, which reads as a broken feature. A rule
  // that decides whether your kills count belongs on the screen you read before
  // you enter, next to NO XP and NO LOOT.
  function presenceSection() {
    const mins = Math.round(K().IDLE_MS / 60000);
    return '<div class="koth-sec"><div class="koth-sec-h"><span class="koth-sec-t">⏸ WHEN KILLS COUNT</span>'
      + '<span class="koth-sec-n">the arena cannot be farmed by an open tab</span></div>'
      + '<div class="koth-pres">'
        + '<div class="koth-pres-r"><i>✓</i><span>Kills count while <b>this tab is in front</b> and you have touched the controls in the last <b>' + mins + ' minutes</b>.</span></div>'
        + '<div class="koth-pres-r"><i>⏸</i><span>Outside that, scoring <b>pauses</b> — the pill says so and gives the reason. <b>Your run is not ended and your kills are not lost.</b></span></div>'
        + '<div class="koth-pres-r"><i>▶</i><span>Any tap, key or scroll resumes it instantly, exactly where you left off.</span></div>'
      + '</div>'
      + '<div class="koth-sec-f">Hostiles here deal no damage, so a tab left open would otherwise score all night. This is the only thing keeping the race about how hard you played.</div></div>';
  }

  function boardSection() {
    return '<div class="koth-sec"><div class="koth-sec-h"><span class="koth-sec-t">🏆 LEADERBOARD</span>'
      + '<span class="koth-sec-n" id="koth-board-n">' + num(K().entrants()) + ' racing · updates every 9s</span></div>'
      + '<div class="koth-board" id="koth-board-list">' + boardRows() + '</div></div>';
  }
  function boardRows() {
    const b = K().board() || [];
    const me = K().rank(), mine = K().myKills();
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
    // LOADING, EMPTY AND BROKEN ARE THREE DIFFERENT ANSWERS. This used to print
    // "No races have closed yet" for all three, so a failed read looked exactly
    // like a fresh season.
    if (_hallErr) return '<div class="koth-none">' + (_hallErr === 'pending'
      ? 'The crown log isn’t live on this server yet. Today’s race still counts — it will appear here once it closes.'
      : 'Couldn’t reach the crown log just now. It will retry on its own.') + '</div>';
    if (!_hall) return '<div class="koth-none">Loading past crowns…</div>';
    const h = _hall.filter((r) => isFinite(Number(r && r.day)));
    return h.length
      ? h.map((r) => '<div class="koth-hrow">'
          + '<span class="kh-d">' + esc(dayLabel(r.day)) + '</span>'
          + shipImg(r.ship, 'kh-s')
          + '<span class="kh-n">👑 ' + esc(r.name || '—') + '</span>'
          + '<span class="kh-k">' + num(r.kills) + '</span></div>').join('')
      : '<div class="koth-none">No races have closed yet. Today could be the first entry.</div>';
  }
  // THE DAY INDEX IS A UTC DAY NUMBER (koth.js: Math.floor(now() / DAY_MS)), so
  // it has to be FORMATTED in UTC. Rendered through local time it lands at
  // midnight UTC and reads as the PREVIOUS day for every pilot west of Greenwich
  // — a crown won on the 22nd printing as the 21st for most of the player base.
  // Number()/isFinite rather than `| 0`: a missing or non-numeric day must show
  // as unknown, not silently become 0 and print a real-looking date from 1970.
  function dayLabel(d) {
    const n = Number(d);
    if (!isFinite(n)) return '—';
    try { return new Date(n * 86400000).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' }); }
    catch (e) { return String(d); }
  }
  async function loadHall() {
    if (_hall && Date.now() - _hallAt < 120000) return;
    try {
      const c = window.CLOUD && window.CLOUD.client; if (!c) return;
      // koth_hall_days, NOT koth_hall_top. koth_hall_top was redefined by
      // new-ladders.sql as a LIFETIME standings board (one row per player, no
      // `day`, no `ship`), while this screen is the per-day crown record.
      const r = await c.rpc('koth_hall_days', { p_n: 14 });
      if (r.error) {
        // PGRST202 — the function is not on this server yet. That is a deploy
        // fact, not a player fact: the screen says the log isn't live, and the
        // filename goes to the console where the operator will see it.
        _hallErr = (r.error.code === 'PGRST202' || /not find the function/i.test(r.error.message || '')) ? 'pending' : 'error';
        try { console.warn('[koth] hall log unavailable — run supabase/koth-archive.sql (section 8)', r.error); } catch (e) {}
        const host0 = $('koth-hall-list'); if (host0) host0.innerHTML = hallRows();
        return;
      }
      _hallErr = null;
      _hall = r.data || []; _hallAt = Date.now();
      const host = $('koth-hall-list');
      if (host) host.innerHTML = hallRows();
    } catch (e) {
      _hallErr = 'error';
      try { console.warn('[koth] hall log read threw', e); } catch (x) {}
      const host = $('koth-hall-list'); if (host) host.innerHTML = hallRows();
    }
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
    const r = K().rank(), k = K().myKills();
    // PAUSED IS A STATE THE PILL HAS TO SHOW. Kills silently not counting is
    // indistinguishable from a broken feature, so it says PAUSED outright rather
    // than just freezing the number and letting the player guess.
    let away = null;
    try { const pr = K().presence && K().presence(); if (pr && !pr.on) away = pr; } catch (e) {}
    p.className = away ? 'paused' : (r === 1 ? 'king' : '');
    if (away) p.title = 'Scoring paused — ' + away.why + '. Touch the screen to resume.';
    else p.removeAttribute('title');
    // THE REASON IS PRINTED, NOT HOVERED. `title` never reaches a touch device and
    // barely reaches a desktop one; the pill carries the sentence itself instead.
    p.innerHTML = '<span class="kp-c">' + (away ? '⏸' : '👑') + '</span><span class="kp-t">' + (away ? 'PAUSED' : 'KOTH') + '</span>'
      + '<span class="kp-r">' + (r ? '#' + r : '—') + '</span>'
      + '<span class="kp-k">' + num(k) + '</span>'
      + '<span class="kp-x">' + hms(K().msLeft()) + '</span>'
      + (away ? '<span class="kp-why">' + esc(away.why) + ' · tap to resume</span>' : '');
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
    const me = K().rank(), mine = K().myKills(), next = K().nextRankAt();
    const gap = (next != null && next > mine) ? (next - mine) : 0;
    let away = null;
    try { const pr = K().presence && K().presence(); if (pr && !pr.on) away = pr; } catch (e) {}
    ov.innerHTML = '<div class="kov-card">'
      + '<button class="kov-x" data-close type="button">✕</button>'
      + '<div class="kov-h">👑 KING OF THE HILL</div>'
      + (away ? '<div class="kov-paused">⏸ <b>SCORING PAUSED</b><span>' + esc(away.why) + ' — kills are still happening, they are not reaching the ladder. Tap anywhere in the arena to resume.</span></div>' : '')
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
