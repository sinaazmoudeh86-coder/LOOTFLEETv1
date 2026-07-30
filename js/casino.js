/* =============================================================================
   casino.js — SPACE CASINO shell (Command ▸ Space Casino)
   -----------------------------------------------------------------------------
   OVERHEAD-VIEW casino: the lobby is a top-down CASINO FLOOR — walk up to a
   table to play, and every game renders as its real table seen from above
   (blackjack arc, printed roulette layout, craps rails, poker oval).

   Shell owns: wallet, chip bet-builder, floor plan, LootCoin real-money
   confirm guard, card engine + 7-card evaluator, result banners, core CSS.
   Blackjack & Roulette live here; Craps / Slots / Hold'em in casino2.js via
   CASINO.reg(). Every game runs REAL standard casino odds — no player edge.
   ========================================================================== */
(function () {
  'use strict';
  const G = () => window.GAME;
  const $ = (id) => document.getElementById(id);
  function fmt(n) { try { return G().formatNum(Math.floor(n)); } catch (e) { return Math.floor(n) + ''; } }

  // ---- currencies ------------------------------------------------------------
  const CUR = {
    gold:    { glyph: '●', c: '#f2b24b', name: 'Gold',      get: () => G().state.gold || 0,                     add: (n) => G().state.gold = (G().state.gold || 0) + n },
    credits: { glyph: '◈', c: '#ffd66a', name: 'LootCoins', get: () => G().state.credits || 0,                  add: (n) => G().state.credits = (G().state.credits || 0) + n },
    fuel:    { glyph: '⬢', c: '#5bc0ff', name: 'Fuel',      get: () => (G().state.resources || {}).fuel || 0,   add: (n) => { const r = G().state.resources = G().state.resources || { fuel: 0, iron: 0, plasma: 0 }; r.fuel += n; } },
    iron:    { glyph: '◆', c: '#d0a060', name: 'Iron',      get: () => (G().state.resources || {}).iron || 0,   add: (n) => { const r = G().state.resources = G().state.resources || { fuel: 0, iron: 0, plasma: 0 }; r.iron += n; } },
    plasma:  { glyph: '✦', c: '#c07bff', name: 'Plasma',    get: () => (G().state.resources || {}).plasma || 0, add: (n) => { const r = G().state.resources = G().state.resources || { fuel: 0, iron: 0, plasma: 0 }; r.plasma += n; } },
  };
  function cas() {
    const st = G().state;
    if (!st.casino) st.casino = { cur: 'gold', bet: 10000, hands: 0, won: 0, lost: 0 };
    return st.casino;
  }
  const bal = () => CUR[cas().cur].get();
  function glyphOf(k) { return CUR[k || cas().cur].glyph; }
  // stake/payout accept an explicit currency so a round ALWAYS settles in the
  // currency it was staked in — switching wallets mid-hand can't cross wires.
  function stake(n, k) { CUR[k || cas().cur].add(-n); }
  function payout(n, k) { CUR[k || cas().cur].add(n); }
  function bookend(net) { const c = cas(); c.hands++; if (net > 0) c.won += net; else c.lost += -net; G().save(); if (window.UI && window.UI.refreshAll) window.UI.refreshAll(); }
  function betOK(mult) { return cas().bet >= 100 && bal() >= Math.floor(cas().bet * (mult || 1)); }

  // ---- LOOTCOIN SAFETY GUARD ---------------------------------------------------
  // Every bet staked in LootCoins must be explicitly confirmed — LC can be a
  // real-money purchase. Other currencies pass straight through.
  function guard(mult, fn) {
    if (cas().cur !== 'credits') { fn(); return; }
    const amt = Math.floor(cas().bet * (mult || 1));
    let o = $('cs-lc-veil');
    if (o) o.remove();
    o = document.createElement('div'); o.id = 'cs-lc-veil';
    o.innerHTML =
      '<div class="cs-lc-box">' +
        '<div class="cs-lc-warn">⚠ REAL-MONEY CURRENCY</div>' +
        '<div class="cs-lc-amt">◈ ' + fmt(amt) + ' LootCoins</div>' +
        '<div class="cs-lc-t">You\u2019re about to gamble <b>LootCoins</b> — a currency that can be purchased with real money. Losses cannot be undone. Play responsibly.</div>' +
        '<button class="cs-go" data-ok>CONFIRM BET — ◈ ' + fmt(amt) + '</button>' +
        '<button class="cs-lc-x" data-x>Cancel</button>' +
      '</div>';
    ($('screen-casino') || document.body).appendChild(o);
    o.querySelector('[data-x]').onclick = () => o.remove();
    o.onclick = (e) => { if (e.target === o) o.remove(); };
    o.querySelector('[data-ok]').onclick = () => { o.remove(); fn(); };
  }

  // ---- shared card engine ------------------------------------------------------
  const SUITS = ['♠', '♥', '♦', '♣'];
  function freshDeck() {
    const d = [];
    SUITS.forEach((s) => 'A23456789TJQK'.split('').forEach((r) => d.push({ r, s })));
    for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
    return d;
  }
  function handVal(h) {
    let v = 0, aces = 0;
    h.forEach((c) => { if (c.r === 'A') { v += 11; aces++; } else if ('TJQK'.includes(c.r)) v += 10; else v += +c.r; });
    while (v > 21 && aces--) v -= 10;
    return v;
  }
  function cardHTML(c, opts) {
    opts = opts || {};
    if (opts.hole) return '<span class="cs-card hole' + (opts.sm ? ' sm' : '') + '">◈</span>';
    const red = c.s === '♥' || c.s === '♦';
    return '<span class="cs-card' + (red ? ' red' : '') + (opts.sm ? ' sm' : '') + '"><i>' + (c.r === 'T' ? '10' : c.r) + '</i>' + c.s + '</span>';
  }

  // ---- 7-card poker evaluator ----------------------------------------------------
  function rnum(c) { return { A: 14, K: 13, Q: 12, J: 11, T: 10 }[c.r] || +c.r; }
  function straightHigh(ranks) {
    const s = new Set(ranks); if (s.has(14)) s.add(1);
    for (let h = 14; h >= 5; h--) { let ok = true; for (let k = 0; k < 5; k++) if (!s.has(h - k)) { ok = false; break; } if (ok) return h; }
    return 0;
  }
  function evalBest(cs) {
    const rs = cs.map(rnum).sort((a, b) => b - a);
    const bySuit = {}; cs.forEach((c) => { (bySuit[c.s] = bySuit[c.s] || []).push(rnum(c)); });
    const cnt = {}; rs.forEach((r) => cnt[r] = (cnt[r] || 0) + 1);
    const flushRanks = Object.values(bySuit).find((a) => a.length >= 5);
    if (flushRanks) {
      flushRanks.sort((a, b) => b - a);
      const sf = straightHigh(flushRanks);
      if (sf) return [8, sf];
    }
    const byCount = (n) => Object.keys(cnt).map(Number).filter((r) => cnt[r] === n).sort((a, b) => b - a);
    const quads = byCount(4), trips = byCount(3), pairs = byCount(2);
    const uniq = [...new Set(rs)];
    if (quads.length) { const k = uniq.find((r) => r !== quads[0]); return [7, quads[0], k]; }
    if (trips.length && (trips.length > 1 || pairs.length)) { const p = trips.length > 1 ? trips[1] : pairs[0]; return [6, trips[0], p]; }
    if (flushRanks) return [5].concat(flushRanks.slice(0, 5));
    const st = straightHigh(uniq);
    if (st) return [4, st];
    if (trips.length) { const ks = uniq.filter((r) => r !== trips[0]).slice(0, 2); return [3, trips[0]].concat(ks); }
    if (pairs.length >= 2) { const k = uniq.find((r) => r !== pairs[0] && r !== pairs[1]); return [2, pairs[0], pairs[1], k]; }
    if (pairs.length) { const ks = uniq.filter((r) => r !== pairs[0]).slice(0, 3); return [1, pairs[0]].concat(ks); }
    return [0].concat(rs.slice(0, 5));
  }
  function cmpHands(a, b) { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; }
  const RNAME = { 14: 'Ace', 13: 'King', 12: 'Queen', 11: 'Jack', 10: 'Ten', 9: 'Nine', 8: 'Eight', 7: 'Seven', 6: 'Six', 5: 'Five', 4: 'Four', 3: 'Three', 2: 'Deuce', 1: 'Ace' };
  function handName(h) {
    return ['High Card ' + RNAME[h[1]], 'Pair of ' + RNAME[h[1]] + 's', 'Two Pair — ' + RNAME[h[1]] + 's & ' + RNAME[h[2]] + 's',
      'Three ' + RNAME[h[1]] + 's', RNAME[h[1]] + '-High Straight', RNAME[h[1]] + '-High Flush',
      RNAME[h[1]] + 's Full of ' + RNAME[h[2]] + 's', 'Four ' + RNAME[h[1]] + 's', RNAME[h[1]] + '-High Straight Flush'][h[0]];
  }

  // ---- result banner ------------------------------------------------------------
  function resultBanner(host, win, text, amt, curKey) {
    if (typeof host === 'string') host = $(host);
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'cs-result ' + (win === null ? 'push' : win ? 'win' : 'lose');
    el.innerHTML = '<b>' + text + '</b>' + (amt ? '<span>' + (win ? '+' : '−') + glyphOf(curKey) + ' ' + fmt(Math.abs(amt)) + '</span>' : '<span>bet returned</span>');
    host.innerHTML = ''; host.appendChild(el);
    const felt = host.closest('.cs-table');
    if (felt && win !== null) { felt.classList.remove('flash-w', 'flash-l'); void felt.offsetWidth; felt.classList.add(win ? 'flash-w' : 'flash-l'); }
  }

  // ===========================================================================
  // SHELL — wallet · chip builder · FLOOR PLAN lobby
  // ===========================================================================
  const GAMES = {}, ORDER = [];
  function reg(id, def) { GAMES[id] = def; ORDER.push(id); }
  let game = null;   // null → looking down at the casino floor
  // a live round LOCKS currency & stake controls — no mid-hand switching
  function roundActive() { const gm = GAMES[game]; return !!(gm && gm.active && gm.active()); }
  const CHIPS = [
    { v: 1000,     l: '1K',   c: '#5bc0ff' },
    { v: 10000,    l: '10K',  c: '#45e08c' },
    { v: 100000,   l: '100K', c: '#ff4d5e' },
    { v: 1000000,  l: '1M',   c: '#c07bff' },
    { v: 10000000, l: '10M',  c: '#ffd24d' },
  ];
  function render() {
    const body = $('casino-body'); if (!body) return;
    const c = cas();
    const sub = $('casino-sub');
    if (sub) { const net = c.won - c.lost; sub.textContent = c.hands + ' hands · lifetime ' + (net >= 0 ? '+' : '−') + fmt(Math.abs(net)); }
    body.innerHTML =
      '<div class="cs-wallet">' + Object.keys(CUR).map((k) =>
        '<button class="cs-cur' + (c.cur === k ? ' on' : '') + '" data-cur="' + k + '" style="--cc:' + CUR[k].c + '">' +
        '<span class="cs-cur-g">' + CUR[k].glyph + '</span><span class="cs-cur-v">' + fmt(CUR[k].get()) + '</span>' +
        '<span class="cs-cur-n">' + CUR[k].name + (k === 'credits' ? ' ⚠' : '') + '</span></button>').join('') + '</div>' +
      '<div class="cs-betbar">' +
        '<div class="cs-bet-disp"><span>YOUR BET</span><b style="color:' + CUR[c.cur].c + '">' + CUR[c.cur].glyph + ' ' + fmt(c.bet) + '</b>' +
          '<span class="cs-lockhint">🔒 finish the hand to change stake</span>' +
          '<div class="cs-bet-tools"><button data-tool="clear">CLEAR</button><button data-tool="half">½</button><button data-tool="dbl">×2</button><button data-tool="max">MAX</button></div></div>' +
        '<div class="cs-chiprow">' + CHIPS.map((ch) =>
          '<button class="cs-chip" data-add="' + ch.v + '" style="--ch:' + ch.c + '"><i>' + ch.l + '</i></button>').join('') + '</div>' +
      '</div>' +
      (game && GAMES[game]
        ? '<button class="cs-back" data-back>◂ CASINO FLOOR <i>· ' + GAMES[game].name.toUpperCase() + ' TABLE</i></button><div id="cs-game"></div>'
        : floorHTML()) ;
    body.querySelectorAll('[data-cur]').forEach((b) => b.onclick = () => { if (roundActive()) return; cas().cur = b.dataset.cur; G().save(); render(); });
    body.querySelectorAll('[data-add]').forEach((b) => b.onclick = () => { if (roundActive()) return; const c2 = cas(); c2.bet = Math.min(Math.max(100, bal()), c2.bet + parseInt(b.dataset.add)); G().save(); renderBet(); });
    body.querySelectorAll('[data-tool]').forEach((b) => b.onclick = () => {
      if (roundActive()) return;
      const c2 = cas(), t = b.dataset.tool;
      if (t === 'clear') c2.bet = 100;
      else if (t === 'half') c2.bet = Math.max(100, Math.floor(c2.bet / 2));
      else if (t === 'dbl') c2.bet = Math.max(100, c2.bet * 2);
      else c2.bet = Math.max(100, Math.floor(bal()));
      G().save(); renderBet();
    });
    body.querySelectorAll('[data-game]').forEach((b) => b.onclick = () => { game = b.dataset.game; render(); });
    const back = body.querySelector('[data-back]');
    if (back) back.onclick = () => { game = null; render(); };
    if (game && GAMES[game]) GAMES[game].render($('cs-game'));
    syncLock();
  }
  // SYNC LOCK — toggles the stake bar / wallet lock WITHOUT re-rendering the
  // table, so spin/roll animations survive. Called at every round start & end.
  function syncLock() {
    const locked = !!(game && roundActive());
    const w = document.querySelector('#casino-body .cs-wallet');
    if (w) { w.classList.toggle('lock', locked); w.querySelectorAll('[data-cur]').forEach((b) => b.disabled = locked); }
    const bb = document.querySelector('#casino-body .cs-betbar');
    if (bb) {
      bb.classList.toggle('lock', locked);
      bb.querySelectorAll('[data-tool],[data-add]').forEach((b) => b.disabled = locked);
    }
  }
  function renderBet() {
    const c = cas();
    const d = document.querySelector('.cs-bet-disp b');
    if (d) { d.style.color = CUR[c.cur].c; d.textContent = CUR[c.cur].glyph + ' ' + fmt(c.bet); d.classList.remove('pop'); void d.offsetWidth; d.classList.add('pop'); }
    const gm = GAMES[game]; if (gm && gm.onBet) gm.onBet();
    // refresh the primary action button's price without nuking the table
    const go = document.querySelector('#cs-game .cs-go[data-deal],#cs-game .cs-go[data-spin],#cs-game .cs-go[data-roll],#cs-game .cs-go[data-ante]');
    if (go && !roundActive()) {
      const label = go.textContent.split('—')[0].trim();
      go.textContent = label + ' — ' + CUR[c.cur].glyph + ' ' + fmt(c.bet);
      go.disabled = !betOK(go.hasAttribute('data-ante') ? 2 : 1);
    }
  }

  // ---- THE FLOOR — top-down casino floor plan --------------------------------
  function floorHTML() {
    const t = (id) => GAMES[id] || { name: id, edge: '' };
    return '<div class="cs-floor">' +
      '<div class="cs-floor-k">✦ ORBITAL DECK 7 — THE FLOOR ✦<br><i>tap a table to sit down</i></div>' +
      '<div class="cs-map">' +
        '<button class="flr flr-ru" data-game="ru"><span class="flr-wheel"><span></span></span><i>ROULETTE</i><em>' + t('ru').edge + '</em></button>' +
        '<button class="flr flr-bj" data-game="bj"><span class="flr-bjfelt"><b></b><b></b><b></b><b></b><b></b></span><i>BLACKJACK</i><em>' + t('bj').edge + '</em></button>' +
        '<button class="flr flr-cr" data-game="cr"><span class="flr-crfelt"><b class="l"></b><b class="r"></b><u>⚄ ⚂</u></span><i>CRAPS</i><em>' + t('cr').edge + '</em></button>' +
        '<button class="flr flr-he" data-game="he"><span class="flr-hefelt"><b></b><b></b><b></b><b></b><b></b></span><i>HOLD\u2019EM</i><em>' + t('he').edge + '</em></button>' +
        '<button class="flr flr-sl" data-game="sl"><span class="flr-slbank"><b>7</b><b>★</b><b>◈</b></span><i>SLOTS</i><em>' + t('sl').edge + '</em></button>' +
      '</div>' +
    '</div>';
  }

  // ===========================================================================
  // BLACKJACK — top-down arc table · dealer stands on 16 · BJ pays 3:2
  // ===========================================================================
  let bj = null;
  function renderBJ(host) {
    const trayHTML = '<div class="bjT-rim"><span class="bjT-tray"><i></i><i></i><i></i><i></i><i></i></span><span class="bjT-shoe">SHOE</span></div>';
    if (!bj) {
      host.innerHTML =
        '<div class="cs-table bjT">' + trayHTML +
          '<div class="bjT-arc-txt">BLACKJACK PAYS 3 TO 2 · DEALER HITS TO <b>17</b></div>' +
          '<div class="bjT-spot empty">BET</div>' +
          '<div id="cs-res"></div>' +
          '<button class="cs-go" data-deal' + (betOK() ? '' : ' disabled') + '>DEAL — ' + CUR[cas().cur].glyph + ' ' + fmt(cas().bet) + '</button>' +
        '</div>';
      const d = host.querySelector('[data-deal]');
      if (d) d.onclick = () => guard(1, () => {
        if (!betOK()) return;
        const deck = freshDeck();
        bj = { deck, p: [deck.pop(), deck.pop()], d: [deck.pop(), deck.pop()], bet: Math.floor(cas().bet), cur: cas().cur, over: false, doubled: false };
        stake(bj.bet, bj.cur); G().save();
        if (handVal(bj.p) === 21) settleBJ(host, true);
        else { render(); }
      });
      return;
    }
    const pv = handVal(bj.p), over = bj.over, dv = handVal(bj.d);
    host.innerHTML =
      '<div class="cs-table bjT">' + trayHTML +
        '<div class="cs-hand-l">DEALER' + (over ? ' · <b>' + dv + '</b>' : '') + '</div>' +
        '<div class="cs-hand">' + bj.d.map((c, i) => cardHTML(c, { hole: !over && i === 1 })).join('') + '</div>' +
        '<div class="bjT-arc-txt">BLACKJACK PAYS 3 TO 2 · DEALER HITS TO <b>17</b></div>' +
        '<div class="cs-hand">' + bj.p.map((c) => cardHTML(c)).join('') + '</div>' +
        '<div class="cs-hand-l">YOU · <b>' + pv + '</b>' + (bj.doubled ? ' · DOUBLED' : '') + '</div>' +
        '<div class="bjT-spot"><span class="cs-chipmini">' + CUR[bj.cur].glyph + '</span>' + fmt(bj.bet) + '</div>' +
        '<div id="cs-res"></div>' +
        (over
          ? '<button class="cs-go" data-again>NEW HAND</button>'
          : '<div class="cs-acts">' +
              '<button class="cs-go" data-hit>HIT</button>' +
              '<button class="cs-go alt" data-stand>STAND</button>' +
              (bj.p.length === 2 && bal() >= bj.bet ? '<button class="cs-go dbl" data-double>DOUBLE</button>' : '') +
            '</div>') +
      '</div>';
    const on = (sel, fn) => { const b = host.querySelector(sel); if (b) b.onclick = fn; };
    on('[data-hit]', () => { bj.p.push(bj.deck.pop()); if (handVal(bj.p) > 21) settleBJ(host); else renderBJ(host); });
    on('[data-stand]', () => settleBJ(host));
    on('[data-double]', () => guard(1, () => { stake(bj.bet, bj.cur); bj.bet *= 2; bj.doubled = true; bj.p.push(bj.deck.pop()); settleBJ(host); }));
    on('[data-again]', () => { bj = null; render(); });
  }
  function settleBJ(host, natural) {
    const pv = handVal(bj.p);
    if (pv <= 21 && !natural) while (handVal(bj.d) < 17) bj.d.push(bj.deck.pop());
    const dv = handVal(bj.d);
    let win = null, ret = 0, text = '';
    if (natural) {
      const dNat = dv === 21 && bj.d.length === 2;
      if (dNat) { ret = bj.bet; text = 'BOTH BLACKJACK — PUSH'; }
      else { win = true; ret = Math.floor(bj.bet * 2.5); text = '★ BLACKJACK — PAYS 3:2'; }
    }
    else if (pv > 21) { win = false; text = 'BUST · ' + pv; }
    else if (dv > 21) { win = true; ret = bj.bet * 2; text = 'DEALER BUSTS · ' + dv; }
    else if (pv > dv) { win = true; ret = bj.bet * 2; text = pv + ' BEATS ' + dv; }
    else if (pv < dv) { win = false; text = dv + ' BEATS ' + pv; }
    else { ret = bj.bet; text = 'PUSH · ' + pv; }
    if (ret) payout(ret, bj.cur);
    bookend(ret - bj.bet);
    bj.over = true;
    renderBJ(host);
    syncLock();   // hand settled → wallet unlocks immediately
    resultBanner('cs-res', win, text, win === null ? 0 : (win ? ret - bj.bet : bj.bet), bj.cur);
  }
  reg('bj', { name: 'Blackjack', icon: '♠', edge: '0.5% house', render: renderBJ, active: () => !!bj && !bj.over });

  // ===========================================================================
  // ROULETTE — printed table layout from above · European single zero (2.7%)
  // ===========================================================================
  const RED = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
  const RU_OUT = [
    { id: 'low',   n: '1–18',  pays: 2, hit: (x) => x >= 1 && x <= 18 },
    { id: 'even',  n: 'EVEN',  pays: 2, hit: (x) => x > 0 && x % 2 === 0 },
    { id: 'red',   n: '◆',     pays: 2, hit: (x) => RED.includes(x), cls: 'r' },
    { id: 'black', n: '◆',     pays: 2, hit: (x) => x > 0 && !RED.includes(x), cls: 'k' },
    { id: 'odd',   n: 'ODD',   pays: 2, hit: (x) => x > 0 && x % 2 === 1 },
    { id: 'high',  n: '19–36', pays: 2, hit: (x) => x >= 19 },
  ];
  const RU_DOZ = [
    { id: 'dz1', n: '1st 12', pays: 3, hit: (x) => x >= 1 && x <= 12 },
    { id: 'dz2', n: '2nd 12', pays: 3, hit: (x) => x >= 13 && x <= 24 },
    { id: 'dz3', n: '3rd 12', pays: 3, hit: (x) => x >= 25 },
  ];
  let ru = { pick: 'red', num: 7, history: [] }, ruSpin = false;
  const numCol = (x) => x === 0 ? '#45e08c' : RED.includes(x) ? '#ff4d5e' : '#e8eef6';
  function ruChip() { return '<span class="ruL-chip">' + CUR[cas().cur].glyph + '</span>'; }
  function renderRU(host, spinning, landed) {
    const pickedLabel = ru.pick === 'num' ? 'STRAIGHT #' + ru.num + ' · pays ×36'
      : (RU_OUT.concat(RU_DOZ).find((o) => o.id === ru.pick) || {}).id
        ? (ru.pick.startsWith('dz') ? RU_DOZ.find((o) => o.id === ru.pick).n + ' · pays ×3' : ru.pick.toUpperCase() + ' · pays ×2')
        : '';
    host.innerHTML =
      '<div class="cs-table ruT">' +
        '<div class="ruT-head">' +
          '<div class="cs-wheel sm' + (spinning ? ' spin' : '') + '"><span class="cs-wheel-n" style="color:' + (landed != null ? numCol(landed) : '#eaf2fb') + '">' + (landed != null ? landed : '·') + '</span></div>' +
          '<div class="ruT-head-r">' +
            '<div class="cs-felt-k" style="margin:0 0 6px;text-align:left">EUROPEAN · SINGLE 0<br>STRAIGHT-UP PAYS 36×</div>' +
            (ru.history.length ? '<div class="cs-hist" style="justify-content:flex-start;margin:0">' + ru.history.slice(0, 8).map((x) => '<i style="color:' + numCol(x) + '">' + x + '</i>').join('') + '</div>' : '') +
          '</div>' +
        '</div>' +
        '<div class="ruL">' +
          '<button class="ruL-zero' + (ru.pick === 'num' && ru.num === 0 ? ' on' : '') + '" data-rnum="0">0' + (ru.pick === 'num' && ru.num === 0 ? ruChip() : '') + '</button>' +
          '<div class="ruL-grid">' + Array.from({ length: 36 }, (_, i) => {
            const n = i + 1, on = ru.pick === 'num' && ru.num === n;
            return '<button class="ruL-n ' + (RED.includes(n) ? 'r' : 'k') + (on ? ' on' : '') + '" data-rnum="' + n + '">' + n + (on ? ruChip() : '') + '</button>';
          }).join('') + '</div>' +
          '<div class="ruL-doz">' + RU_DOZ.map((o) => '<button class="ruL-o' + (ru.pick === o.id ? ' on' : '') + '" data-rout="' + o.id + '">' + o.n + (ru.pick === o.id ? ruChip() : '') + '</button>').join('') + '</div>' +
          '<div class="ruL-out">' + RU_OUT.map((o) => '<button class="ruL-o ' + (o.cls || '') + (ru.pick === o.id ? ' on' : '') + '" data-rout="' + o.id + '">' + o.n + (ru.pick === o.id ? ruChip() : '') + '</button>').join('') + '</div>' +
        '</div>' +
        '<div class="ruT-pick">YOUR BET → <b>' + pickedLabel + '</b></div>' +
        '<div id="cs-res"></div>' +
        '<button class="cs-go" data-spin' + (betOK() && !spinning ? '' : ' disabled') + '>' + (spinning ? 'NO MORE BETS…' : 'SPIN — ' + CUR[cas().cur].glyph + ' ' + fmt(cas().bet)) + '</button>' +
      '</div>';
    host.querySelectorAll('[data-rnum]').forEach((b) => b.onclick = () => { ru.pick = 'num'; ru.num = +b.dataset.rnum; renderRU(host); });
    host.querySelectorAll('[data-rout]').forEach((b) => b.onclick = () => { ru.pick = b.dataset.rout; renderRU(host); });
    const sp = host.querySelector('[data-spin]');
    if (sp) sp.onclick = () => guard(1, () => {
      if (!betOK()) return;
      const bet = Math.floor(cas().bet), curK = cas().cur;
      stake(bet, curK); G().save();
      ruSpin = true;
      renderRU(host, true);
      syncLock();
      setTimeout(() => {
        ruSpin = false;
        const x = Math.floor(Math.random() * 37);
        ru.history.unshift(x); if (ru.history.length > 20) ru.history.length = 20;
        let ret = 0, win = false;
        if (ru.pick === 'num') { if (x === ru.num) { ret = bet * 36; win = true; } }
        else {
          const b = RU_OUT.concat(RU_DOZ).find((o) => o.id === ru.pick);
          if (b.hit(x)) { ret = bet * b.pays; win = true; }
        }
        if (ret) payout(ret, curK);
        bookend(ret - bet);
        renderRU(host, false, x);
        syncLock();
        resultBanner('cs-res', win,
          (x === 0 ? '🟢 ZERO' : (RED.includes(x) ? '🔴 ' : '⚫ ') + x) + (win ? ' — WINNER' : ' — house takes it'),
          win ? ret - bet : bet, curK);
      }, 1100);
    });
  }
  reg('ru', { name: 'Roulette', icon: '◉', edge: '2.7% house', render: (h) => renderRU(h), active: () => ruSpin });

  // ---- BOOT -------------------------------------------------------------------
  function boot() { injectCSS(); }
  function injectCSS() {
    if ($('cs-css')) return;
    const s = document.createElement('style'); s.id = 'cs-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  window.CASINO = { render, reg, guard, syncLock, fmt, CUR, cas, bal, stake, payout, bookend, betOK, resultBanner, freshDeck, cardHTML, handVal, evalBest, cmpHands, handName, glyphOf };

  const CSS = `
  .mega-grid .mega-card.cmd-casino{ background:linear-gradient(180deg,#0c2417,#081409); }
  .mega-grid .mega-card.cmd-casino .mc-ic{ color:#ffd24d; border-color:rgba(255,210,77,.5); background:radial-gradient(120% 120% at 50% 0%,#173a24,#081409); box-shadow:0 0 14px -3px rgba(255,210,77,.7); }
  .mega-grid .mega-card.cmd-casino .mc-n{ color:#ffe9ad; }
  .mega-grid .mega-card.cmd-casino::before{ background:linear-gradient(130deg,#ffd24d,#ff3b6b,#45e08c,#ffd24d); background-size:250% 250%; }
  #screen-casino .scr-title{ color:#ffd24d; }
  #casino-body{ padding:12px; }

  /* wallet pills */
  .cs-wallet{ display:flex; gap:6px; overflow-x:auto; padding-bottom:9px; scrollbar-width:thin; }
  .cs-cur{ flex:none; display:flex; flex-direction:column; align-items:center; gap:1px; min-width:74px; border:1px solid #223245; border-radius:11px; padding:7px 10px 6px; cursor:pointer;
    background:linear-gradient(180deg,#0e1725,#0b1220); transition:border-color .15s, box-shadow .15s; }
  .cs-cur.on{ border-color:var(--cc); box-shadow:0 0 14px -5px var(--cc); background:linear-gradient(180deg, color-mix(in srgb,var(--cc) 10%,#0e1725), #0b1220); }
  .cs-cur-g{ color:var(--cc); font-size:13px; line-height:1; }
  .cs-cur-v{ font-size:11.5px; font-weight:800; color:#e7f0fb; font-variant-numeric:tabular-nums; }
  .cs-cur-n{ font-size:7.5px; font-weight:800; letter-spacing:.1em; color:#71859a; text-transform:uppercase; }

  .cs-wallet.lock .cs-cur{ opacity:.45; cursor:default; }
  .cs-betbar.lock{ opacity:.92; }
  .cs-lockhint{ display:none; margin-left:auto; font-size:9px; font-weight:800; letter-spacing:.05em; color:#b9a86f; }
  .cs-betbar.lock .cs-lockhint{ display:inline; }
  .cs-betbar.lock .cs-bet-tools,.cs-betbar.lock .cs-chiprow{ display:none; }
  .cs-bet-disp b.pop{ animation:csBetPop .22s cubic-bezier(.2,1.4,.4,1); }
  @keyframes csBetPop{ 0%{ transform:scale(1.28); } 100%{ transform:scale(1); } }

  /* bet builder */
  .cs-betbar{ border:1px solid #26324a; border-radius:14px; background:rgba(8,12,20,.72); padding:10px 11px; margin-bottom:10px; }
  .cs-bet-disp{ display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
  .cs-bet-disp>span{ font-size:8px; font-weight:800; letter-spacing:.16em; color:#7f92a6; }
  .cs-bet-disp b{ font-family:'Orbitron',sans-serif; font-size:16px; font-variant-numeric:tabular-nums; }
  .cs-bet-tools{ margin-left:auto; display:flex; gap:5px; }
  .cs-bet-tools button{ border:1px solid #2b4055; background:rgba(255,255,255,.04); color:#c9d8e8; border-radius:7px; padding:5px 9px;
    font-family:'Rajdhani',sans-serif; font-weight:800; font-size:10px; cursor:pointer; }
  .cs-chiprow{ display:flex; gap:9px; margin-top:10px; justify-content:center; }
  .cs-chip{ width:46px; height:46px; border-radius:50%; cursor:pointer; position:relative; flex:none;
    background:radial-gradient(circle at 50% 38%, color-mix(in srgb,var(--ch) 80%,#fff) 0%, var(--ch) 55%, color-mix(in srgb,var(--ch) 55%,#000) 100%);
    border:3px dashed rgba(255,255,255,.75); box-shadow:0 4px 10px rgba(0,0,0,.5), inset 0 0 0 5px color-mix(in srgb,var(--ch) 70%,#000); transition:transform .09s; }
  .cs-chip:active{ transform:translateY(2px) scale(.94); }
  .cs-chip i{ font-style:normal; font-family:'Orbitron',sans-serif; font-weight:900; font-size:10px; color:#0b1119; text-shadow:0 1px 0 rgba(255,255,255,.4); }
  .cs-chipmini{ display:inline-grid; place-items:center; width:18px; height:18px; border-radius:50%; margin-right:5px; font-size:9px; color:#0b1119;
    background:radial-gradient(circle at 50% 35%,#ffe9ad,#f2b24b 60%,#a8781f); border:1.5px dashed rgba(255,255,255,.8); vertical-align:-4px; }

  /* LootCoin real-money confirm */
  #cs-lc-veil{ position:absolute; inset:0; z-index:16; display:flex; align-items:center; justify-content:center; padding:20px;
    background:rgba(6,10,17,.86); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); }
  .cs-lc-box{ width:100%; max-width:320px; text-align:center; border:1px solid rgba(255,210,77,.55); border-radius:16px; padding:18px 16px;
    background:linear-gradient(180deg,#1c1608,#120e06); box-shadow:0 0 30px -8px rgba(255,210,77,.5); }
  .cs-lc-warn{ font-family:'Orbitron',sans-serif; font-weight:900; font-size:11px; letter-spacing:.14em; color:#ffd24d; }
  .cs-lc-amt{ font-family:'Orbitron',sans-serif; font-weight:900; font-size:22px; color:#fff; margin:10px 0 8px; }
  .cs-lc-t{ font-size:11.5px; line-height:1.6; color:#d8cba0; }
  .cs-lc-t b{ color:#ffe9ad; }
  .cs-lc-box .cs-go{ width:100%; margin-top:14px; }
  .cs-lc-x{ margin-top:10px; background:none; border:1px solid #4a3f22; color:#b9a86f; border-radius:9px; padding:8px 18px;
    font-family:'Rajdhani',sans-serif; font-weight:700; font-size:12px; cursor:pointer; }

  /* back bar */
  .cs-back{ width:100%; text-align:left; margin-bottom:10px; border:1px solid #2b4055; border-radius:11px; padding:10px 13px; cursor:pointer;
    background:linear-gradient(180deg,#101826,#0c1220); color:#9fc2dd; font-family:'Orbitron',sans-serif; font-weight:800; font-size:10px; letter-spacing:.1em; }
  .cs-back i{ font-style:normal; color:#ffd24d; }

  /* ---- THE FLOOR (top-down floor plan) ---- */
  .cs-floor{ border:1px solid rgba(255,210,77,.25); border-radius:18px; overflow:hidden;
    background:
      repeating-linear-gradient(45deg, rgba(255,255,255,.014) 0 9px, transparent 9px 18px),
      repeating-linear-gradient(-45deg, rgba(120,40,80,.05) 0 14px, transparent 14px 28px),
      radial-gradient(140% 100% at 50% 0%, #241028 0%, #180b1e 50%, #10071a 100%); }
  .cs-floor-k{ text-align:center; font-family:'Orbitron',sans-serif; font-weight:800; font-size:10px; letter-spacing:.22em; color:#ffd24d; padding:13px 8px 4px; text-shadow:0 0 14px rgba(255,210,77,.6); animation:csNeon 3.4s ease-in-out infinite; }
  @keyframes csNeon{ 0%,100%{ text-shadow:0 0 8px rgba(255,210,77,.4);} 8%{ text-shadow:0 0 2px rgba(255,210,77,.2);} 12%,60%{ text-shadow:0 0 18px rgba(255,210,77,.9);} }
  .cs-floor-k i{ display:block; font-style:normal; font-family:'Rajdhani',sans-serif; font-size:10px; font-weight:700; letter-spacing:.12em; color:#a98cc4; margin-top:3px; }
  .cs-map{ position:relative; height:420px; }
  .flr{ position:absolute; display:flex; flex-direction:column; align-items:center; gap:4px; background:none; border:none; cursor:pointer; transition:transform .12s; }
  .flr:active{ transform:scale(.94); }
  .flr i{ font-style:normal; font-family:'Orbitron',sans-serif; font-weight:800; font-size:9px; letter-spacing:.12em; color:#f2e7c8; text-shadow:0 1px 4px #000; }
  .flr em{ font-style:normal; font-size:7.5px; font-weight:800; letter-spacing:.08em; color:#45e08c; text-transform:uppercase; }
  /* roulette station: wheel + half layout */
  .flr-ru{ left:6%; top:7%; }
  .flr-wheel{ position:relative; width:84px; height:84px; border-radius:50%; border:3px solid #d8a12f; box-shadow:0 8px 18px rgba(0,0,0,.6), 0 0 18px -6px rgba(255,210,77,.8);
    background:conic-gradient(#ff4d5e 0 24deg,#141b28 24deg 48deg,#ff4d5e 48deg 72deg,#141b28 72deg 96deg,#ff4d5e 96deg 120deg,#141b28 120deg 144deg,#ff4d5e 144deg 168deg,#141b28 168deg 192deg,#ff4d5e 192deg 216deg,#141b28 216deg 240deg,#ff4d5e 240deg 264deg,#141b28 264deg 288deg,#ff4d5e 288deg 312deg,#141b28 312deg 336deg,#45e08c 336deg 360deg); animation:flrSpin 22s linear infinite; }
  .flr-wheel span{ position:absolute; inset:24px; border-radius:50%; background:radial-gradient(circle at 40% 35%,#2a3550,#0d1522); border:2px solid #d8a12f; }
  @keyframes flrSpin{ to{ transform:rotate(360deg); } }
  /* blackjack: arc table */
  .flr-bj{ right:5%; top:9%; }
  .flr-bjfelt{ width:120px; height:74px; border-radius:10px 10px 90px 90px / 10px 10px 64px 64px; position:relative;
    background:radial-gradient(120% 130% at 50% 0%,#1a6a3e,#0d3a22 70%); border:3px solid #6b4a1d; box-shadow:0 8px 18px rgba(0,0,0,.6);
    display:flex; justify-content:center; align-items:flex-end; gap:5px; padding-bottom:9px; }
  .flr-bjfelt::before{ content:''; position:absolute; top:6px; left:20%; right:20%; height:8px; border-radius:5px; background:#5a3d15; }
  .flr-bjfelt b{ width:11px; height:11px; border-radius:50%; border:1.5px dashed rgba(255,255,255,.6); background:radial-gradient(circle at 40% 35%,#ffd24d,#8a6210); }
  /* craps: long rail table */
  .flr-cr{ left:50%; top:41%; transform:translateX(-50%); }
  .flr:active.flr-cr{ transform:translateX(-50%) scale(.94); }
  .flr-crfelt{ width:210px; height:86px; border-radius:44px; position:relative; overflow:hidden;
    background:radial-gradient(140% 150% at 50% 50%,#17643b,#0c3a20 75%); border:4px solid #6b4a1d; box-shadow:0 10px 20px rgba(0,0,0,.65); display:grid; place-items:center; }
  .flr-crfelt b{ position:absolute; top:10px; bottom:10px; width:34px; border:1.5px solid rgba(255,255,255,.25); border-radius:20px; }
  .flr-crfelt b.l{ left:10px; } .flr-crfelt b.r{ right:10px; }
  .flr-crfelt u{ text-decoration:none; font-size:15px; color:#eaf2fb; text-shadow:0 0 8px rgba(255,255,255,.5); }
  /* hold'em: oval */
  .flr-he{ left:7%; bottom:6%; }
  .flr-hefelt{ width:130px; height:80px; border-radius:50% / 46%; position:relative;
    background:radial-gradient(130% 140% at 50% 40%,#1a5a68,#0c2f38 75%); border:4px solid #6b4a1d; box-shadow:0 9px 18px rgba(0,0,0,.6);
    display:flex; justify-content:center; align-items:center; gap:4px; }
  .flr-hefelt b{ width:12px; height:17px; border-radius:2.5px; background:linear-gradient(180deg,#f4f8fc,#ccd8e4); box-shadow:0 2px 4px rgba(0,0,0,.5); }
  /* slots: bank of cabinets */
  .flr-sl{ right:6%; bottom:7%; }
  .flr-slbank{ display:flex; gap:6px; }
  .flr-slbank b{ width:34px; height:56px; border-radius:7px 7px 4px 4px; display:grid; place-items:center; font-size:15px; color:#ffd24d;
    background:linear-gradient(180deg,#2a3550,#141b2a); border:2px solid #d8a12f; box-shadow:0 7px 14px rgba(0,0,0,.6), 0 0 12px -4px rgba(255,210,77,.9); text-shadow:0 0 8px rgba(255,210,77,.8); }

  /* ---- shared felt table ---- */
  .cs-table{ border:4px solid #6b4a1d; border-radius:18px; padding:18px 14px 16px; text-align:center; position:relative; overflow:hidden;
    background:radial-gradient(130% 110% at 50% 0%, #155232 0%, #0d3520 45%, #082414 78%, #061c0f 100%);
    box-shadow:inset 0 0 46px rgba(0,0,0,.55), inset 0 0 0 2px rgba(255,210,77,.22), 0 10px 26px -10px rgba(0,0,0,.8), 0 0 24px -12px rgba(69,224,140,.6); }
  .cs-table::after{ content:''; position:absolute; inset:8px; border:1.5px dashed rgba(255,235,180,.13); border-radius:inherit; pointer-events:none; }
  .cs-hand .cs-card:nth-child(2){ animation-delay:.07s; } .cs-hand .cs-card:nth-child(3){ animation-delay:.14s; }
  .cs-hand .cs-card:nth-child(4){ animation-delay:.21s; } .cs-hand .cs-card:nth-child(5){ animation-delay:.28s; }
  .cs-table.flash-w{ animation:csFlashW .7s; } .cs-table.flash-l{ animation:csFlashL .7s; }
  @keyframes csFlashW{ 0%{ box-shadow:inset 0 0 60px rgba(124,224,160,.55); } 100%{ box-shadow:inset 0 0 46px rgba(0,0,0,.55); } }
  @keyframes csFlashL{ 0%{ box-shadow:inset 0 0 60px rgba(255,77,94,.5); } 100%{ box-shadow:inset 0 0 46px rgba(0,0,0,.55); } }
  .cs-felt-k{ font-size:8.5px; font-weight:800; letter-spacing:.1em; color:#8fd8ac; margin:2px 0 10px; line-height:1.6; }
  .cs-go{ border:none; border-radius:12px; padding:13px 22px; cursor:pointer; margin-top:12px; min-width:150px;
    font-family:'Orbitron',sans-serif; font-weight:800; font-size:12.5px; letter-spacing:.08em; color:#08131c;
    background:linear-gradient(180deg,#ffe08a,#f2b24b); box-shadow:0 8px 20px -8px rgba(242,178,75,.8), inset 0 1px 0 rgba(255,255,255,.5); transition:transform .08s; }
  .cs-go:active{ transform:scale(.96); }
  .cs-go:disabled{ opacity:.4; cursor:default; }
  .cs-go.alt{ color:#e7f0fb; background:linear-gradient(180deg,#22344c,#16243a); border:1px solid #35507a; box-shadow:none; }
  .cs-go.dbl{ color:#08131c; background:linear-gradient(180deg,#9df0bb,#5fd68b); }
  .cs-go.danger{ color:#fff; background:linear-gradient(180deg,#ff6b78,#d92b3f); box-shadow:none; }
  .cs-acts{ display:flex; gap:9px; justify-content:center; flex-wrap:wrap; }

  /* cards */
  .cs-hand-l{ font-family:'Orbitron',sans-serif; font-size:9px; font-weight:800; letter-spacing:.18em; color:#8fd8ac; margin:8px 0 7px; }
  .cs-hand-l b{ color:#fff; font-size:11px; }
  .cs-hand{ display:flex; gap:7px; justify-content:center; flex-wrap:wrap; min-height:56px; }
  .cs-card{ position:relative; width:44px; height:60px; border-radius:7px; background:linear-gradient(180deg,#f7fafc,#dde6ee); color:#1a2433;
    display:grid; place-items:center; font-size:18px; font-weight:800; box-shadow:0 4px 10px rgba(0,0,0,.45); animation:csDeal .3s cubic-bezier(.2,1,.4,1); }
  .cs-card i{ position:absolute; top:3px; left:5px; font-style:normal; font-size:10.5px; }
  .cs-card.red{ color:#d22b3f; }
  .cs-card.sm{ width:37px; height:50px; font-size:15px; border-radius:6px; }
  .cs-card.sm i{ font-size:9px; top:2px; left:4px; }
  .cs-card.hole{ background:linear-gradient(135deg,#25406b,#152540); color:#7fb2ff; font-size:19px; }
  @keyframes csDeal{ 0%{ transform:translateY(-14px) rotate(-6deg); opacity:0; } 100%{ transform:none; opacity:1; } }

  /* blackjack table shape (top-down arc) */
  .cs-table.bjT{ border-radius:16px 16px 46% 46% / 16px 16px 26% 26%; padding-bottom:26px; }
  .bjT-rim{ display:flex; align-items:center; justify-content:space-between; margin:-6px 4px 6px; }
  .bjT-tray{ display:flex; gap:4px; background:rgba(0,0,0,.35); border:1px solid rgba(107,74,29,.8); border-radius:7px; padding:4px 7px; }
  .bjT-tray i{ width:9px; height:16px; border-radius:3px; background:repeating-linear-gradient(0deg,#ffd24d 0 2px,#8a6210 2px 4px); }
  .bjT-shoe{ font-family:'Orbitron',sans-serif; font-size:7px; font-weight:800; letter-spacing:.14em; color:#d8c08a; background:rgba(0,0,0,.35); border:1px solid rgba(107,74,29,.8); border-radius:7px; padding:6px 9px; }
  .bjT-arc-txt{ font-family:'Orbitron',sans-serif; font-size:8px; font-weight:800; letter-spacing:.18em; color:rgba(255,235,180,.65); margin:9px 0;
    border-top:1.5px solid rgba(255,235,180,.28); border-bottom:1.5px solid rgba(255,235,180,.28); padding:5px 0; }
  .bjT-arc-txt b{ color:#ffe9ad; }
  .bjT-spot{ display:inline-flex; align-items:center; margin:8px auto 2px; border:1.5px dashed rgba(255,235,180,.5); border-radius:99px; padding:6px 14px;
    font-family:'Orbitron',sans-serif; font-weight:800; font-size:10px; color:#ffe9ad; letter-spacing:.08em; }
  .bjT-spot.empty{ opacity:.55; padding:10px 22px; }

  /* roulette table (printed layout) */
  .ruT-head{ display:flex; gap:11px; align-items:center; margin-bottom:10px; }
  .ruT-head-r{ flex:1; min-width:0; }
  .cs-wheel{ width:104px; height:104px; margin:0 auto 10px; border-radius:50%; display:grid; place-items:center; position:relative;
    background:conic-gradient(#ff4d5e 0 20deg,#1a2433 20deg 40deg,#ff4d5e 40deg 60deg,#1a2433 60deg 80deg,#ff4d5e 80deg 100deg,#1a2433 100deg 120deg,#ff4d5e 120deg 140deg,#1a2433 140deg 160deg,#ff4d5e 160deg 180deg,#1a2433 180deg 200deg,#ff4d5e 200deg 220deg,#1a2433 220deg 240deg,#ff4d5e 240deg 260deg,#1a2433 260deg 280deg,#ff4d5e 280deg 300deg,#1a2433 300deg 320deg,#ff4d5e 320deg 340deg,#45e08c 340deg 360deg);
    border:3px solid rgba(255,210,77,.55); box-shadow:0 0 22px -6px rgba(255,210,77,.7), inset 0 0 14px rgba(0,0,0,.6); }
  .cs-wheel.sm{ width:88px; height:88px; margin:0; flex:none; }
  .cs-wheel.spin{ animation:csSpin 1.05s cubic-bezier(.3,.7,.4,1); }
  @keyframes csSpin{ 0%{ transform:rotate(0);} 100%{ transform:rotate(1080deg);} }
  .cs-wheel-n{ width:50px; height:50px; border-radius:50%; background:#0a1119; display:grid; place-items:center;
    font-family:'Orbitron',sans-serif; font-weight:900; font-size:20px; box-shadow:inset 0 0 12px rgba(0,0,0,.8); }
  .cs-hist{ display:flex; gap:6px; justify-content:center; flex-wrap:wrap; margin-bottom:10px; }
  .cs-hist i{ font-style:normal; font-size:11px; font-weight:800; background:#0a1119; border:1px solid #22334a; border-radius:6px; padding:2px 6px; font-variant-numeric:tabular-nums; }
  .ruL{ border:1.5px solid rgba(255,235,180,.4); border-radius:11px; padding:7px; background:rgba(0,0,0,.14); }
  .ruL-zero{ width:100%; border:1px solid rgba(255,235,180,.35); background:rgba(69,224,140,.14); color:#7ce0a0; border-radius:7px 7px 0 0; padding:7px 0;
    font-family:'Orbitron',sans-serif; font-weight:900; font-size:12px; cursor:pointer; position:relative; }
  .ruL-grid{ display:grid; grid-template-columns:repeat(6,1fr); gap:2.5px; margin-top:2.5px; }
  .ruL-n{ position:relative; border-radius:5px; padding:7.5px 0; cursor:pointer; font-weight:800; font-size:11.5px; color:#fff; font-variant-numeric:tabular-nums; border:1px solid rgba(255,255,255,.12); }
  .ruL-n.r{ background:rgba(255,77,94,.32); } .ruL-n.k{ background:rgba(10,16,24,.72); }
  .ruL-doz{ display:grid; grid-template-columns:repeat(3,1fr); gap:2.5px; margin-top:2.5px; }
  .ruL-out{ display:grid; grid-template-columns:repeat(6,1fr); gap:2.5px; margin-top:2.5px; }
  .ruL-o{ position:relative; border:1px solid rgba(255,235,180,.3); background:rgba(255,255,255,.05); color:#f0ead2; border-radius:5px; padding:8px 0;
    font-family:'Rajdhani',sans-serif; font-weight:800; font-size:10px; cursor:pointer; letter-spacing:.03em; }
  .ruL-o.r{ color:#ff8090; } .ruL-o.k{ color:#aebdd2; }
  .ruL-zero.on,.ruL-n.on,.ruL-o.on{ outline:2px solid #ffd24d; outline-offset:-1px; box-shadow:0 0 12px -3px rgba(255,210,77,.9); }
  .ruL-chip{ position:absolute; top:-7px; right:-5px; width:17px; height:17px; border-radius:50%; display:grid; place-items:center; font-size:8.5px; color:#0b1119; z-index:2;
    background:radial-gradient(circle at 40% 35%,#ffe9ad,#f2b24b 65%,#a8781f); border:1.5px dashed rgba(255,255,255,.85); box-shadow:0 2px 5px rgba(0,0,0,.6); }
  .ruT-pick{ margin-top:9px; font-size:10px; font-weight:800; letter-spacing:.06em; color:#8fd8ac; }
  .ruT-pick b{ color:#ffe9ad; }

  /* result banner */
  .cs-result{ margin:12px auto 2px; max-width:340px; border-radius:11px; padding:10px 14px; display:flex; align-items:center; justify-content:space-between; gap:10px;
    font-family:'Orbitron',sans-serif; font-weight:800; font-size:11px; letter-spacing:.04em; animation:csPop .35s cubic-bezier(.18,1.4,.4,1); text-align:left; }
  .cs-result span{ font-variant-numeric:tabular-nums; white-space:nowrap; }
  .cs-result.win{ color:#0a1f12; background:linear-gradient(180deg,#9df0bb,#5fd68b); box-shadow:0 0 20px -6px rgba(124,224,160,.9); }
  .cs-result.lose{ color:#fff; background:linear-gradient(180deg,#ff6b78,#d92b3f); box-shadow:0 0 20px -6px rgba(255,90,104,.8); }
  .cs-result.push{ color:#e7f0fb; background:linear-gradient(180deg,#2a3c56,#1c2a40); border:1px solid #3c5578; }
  @keyframes csPop{ 0%{ transform:scale(.6); opacity:0; } 100%{ transform:scale(1); opacity:1; } }

  @media (prefers-reduced-motion: reduce){
    .cs-wheel.spin,.cs-card,.cs-result,.cs-table.flash-w,.cs-table.flash-l,.flr-wheel,.cs-floor-k,.cs-bet-disp b.pop{ animation:none !important; }
  }
  `;

  // ---- BOOT (must stay LAST) ------------------------------------------------
  // boot() reads the CSS const declared above it; calling it from the module body
  // hit the temporal dead zone and aborted the script before window exports ran,
  // so the screen silently painted nothing on a late parse. Keep this at the end.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
