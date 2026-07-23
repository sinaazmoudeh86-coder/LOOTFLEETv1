/* =============================================================================
   casino2.js — SPACE CASINO games II: Craps · Nebula Slots · Hold'em
   Top-down table treatments to match the casino-floor shell. Loads AFTER
   casino.js; registers via CASINO.reg(). LootCoin bets route through
   CASINO.guard (real-money confirm).
   ========================================================================== */
(function () {
  'use strict';
  const CS = () => window.CASINO;
  const $ = (id) => document.getElementById(id);
  const DFACE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

  // ===========================================================================
  // CRAPS — full table from above: FIELD box, PASS LINE & DON'T PASS rails
  // Real Vegas rules: Don't Pass BARS 12 (pushes) on the come-out.
  // ===========================================================================
  let cr = null, crPick = 'pass', crHist = [], crRolling = false;
  function renderCR(host, rolling, d1, d2) {
    const C = CS();
    const inRound = !!cr;
    const fieldNums = [2, 3, 4, 9, 10, 11, 12].map((n) =>
      '<b' + (n === 2 || n === 12 ? ' class="x"' : '') + '>' + n + (n === 2 ? '<u>2×</u>' : n === 12 ? '<u>3×</u>' : '') + '</b>').join('');
    host.innerHTML =
      '<div class="cs-table crT">' +
        '<div class="crT-rail-k">CRAPS · DON\u2019T PASS <b>BAR 12</b> — 12 PUSHES ON THE COME-OUT</div>' +
        '<div class="crT-center">' +
          '<div class="cs-puck ' + (inRound && cr.phase === 'point' ? 'on' : 'off') + '">' + (inRound && cr.phase === 'point' ? 'ON · ' + cr.point : 'OFF') + '</div>' +
          '<div class="cs-dice' + (rolling ? ' roll' : '') + '"><span>' + (d1 ? DFACE[d1 - 1] : '⚄') + '</span><span>' + (d2 ? DFACE[d2 - 1] : '⚂') + '</span>' +
            (d1 ? '<b class="cs-dtot">' + (d1 + d2) + '</b>' : '') + '</div>' +
          (crHist.length ? '<div class="cs-roll-hist">' + crHist.slice(0, 12).map((t) => '<i>' + t + '</i>').join('') + '</div>' : '') +
        '</div>' +
        '<button class="crT-field' + (crPick === 'field' ? ' on' : '') + '"' + (inRound ? ' disabled' : '') + ' data-cb="field">' +
          '<span class="crT-lab">FIELD · ONE ROLL</span><span class="crT-nums">' + fieldNums + '</span>' +
          (crPick === 'field' ? '<span class="crT-chip">' + C.CUR[C.cas().cur].glyph + '</span>' : '') + '</button>' +
        '<button class="crT-line dont' + (crPick === 'dont' ? ' on' : '') + '"' + (inRound ? ' disabled' : '') + ' data-cb="dont">DON\u2019T PASS BAR — <i>wins on 2 · 3, bar 12</i>' +
          (crPick === 'dont' ? '<span class="crT-chip">' + C.CUR[C.cas().cur].glyph + '</span>' : '') + '</button>' +
        '<button class="crT-line pass' + (crPick === 'pass' ? ' on' : '') + '"' + (inRound ? ' disabled' : '') + ' data-cb="pass">P A S S &nbsp; L I N E' +
          (crPick === 'pass' ? '<span class="crT-chip">' + C.CUR[C.cas().cur].glyph + '</span>' : '') + '</button>' +
        '<div id="cs-res"></div>' +
        '<button class="cs-go" data-roll' + ((inRound || C.betOK()) && !rolling ? '' : ' disabled') + '>' +
          (rolling ? 'DICE OUT…' : inRound ? 'ROLL FOR POINT ' + cr.point : 'BET & ROLL — ' + C.CUR[C.cas().cur].glyph + ' ' + C.fmt(C.cas().bet)) + '</button>' +
      '</div>';
    host.querySelectorAll('[data-cb]').forEach((b) => b.onclick = () => { if (!cr) { crPick = b.dataset.cb; renderCR(host); } });
    const rl = host.querySelector('[data-roll]');
    if (rl) rl.onclick = () => {
      if (cr) { doRoll(host); return; }                       // point phase: bet already down
      CS().guard(1, () => doRoll(host));
    };
  }
  function doRoll(host) {
    const C = CS();
    if (!cr) {
      if (!C.betOK()) return;
      cr = { type: crPick, bet: Math.floor(C.cas().bet), cur: C.cas().cur, phase: 'comeout', point: 0 };
      C.stake(cr.bet, cr.cur); window.GAME.save();
    }
    crRolling = true;
    renderCR(host, true);
    CS().syncLock();   // round is live from the first stake — lock the rail NOW
    setTimeout(() => {
      crRolling = false;
      const a = 1 + Math.floor(Math.random() * 6), b = 1 + Math.floor(Math.random() * 6), t = a + b;
      crHist.unshift(t); if (crHist.length > 20) crHist.length = 20;
      let done = false, win = null, ret = 0, text = '';
      const bet = cr.bet;
      if (cr.type === 'field') {
        done = true;
        if ([3, 4, 9, 10, 11].includes(t)) { win = true; ret = bet * 2; text = 'FIELD HIT · ' + t; }
        else if (t === 2) { win = true; ret = bet * 3; text = 'SNAKE EYES · FIELD PAYS 2:1'; }
        else if (t === 12) { win = true; ret = bet * 4; text = 'BOXCARS · FIELD PAYS 3:1'; }
        else { win = false; text = t + ' — OFF THE FIELD'; }
      } else if (cr.phase === 'comeout') {
        if (t === 7 || t === 11) { done = true; win = cr.type === 'pass'; if (win) ret = bet * 2; text = 'NATURAL ' + t; }
        else if (t === 2 || t === 3) { done = true; win = cr.type === 'dont'; if (win) ret = bet * 2; text = 'CRAPS ' + t; }
        else if (t === 12) { done = true; if (cr.type === 'dont') { win = null; ret = bet; text = 'CRAPS 12 — BAR 12 · PUSH'; } else { win = false; text = 'CRAPS 12'; } }
        else { cr.phase = 'point'; cr.point = t; text = 'POINT SET · ' + t; }
      } else {
        if (t === cr.point) { done = true; win = cr.type === 'pass'; if (win) ret = bet * 2; text = 'POINT ' + t + ' MADE'; }
        else if (t === 7) { done = true; win = cr.type === 'dont'; if (win) ret = bet * 2; text = 'SEVEN OUT'; }
        else text = 'ROLLED ' + t + ' · CHASING ' + cr.point;
      }
      if (done) {
        const curK = cr.cur;
        if (ret) C.payout(ret, curK);
        C.bookend(ret - bet);
        cr = null;
        renderCR(host, false, a, b);
        C.syncLock();   // round over → unlock immediately
        C.resultBanner('cs-res', win, text, win === null ? 0 : (win ? ret - bet : bet), curK);
      } else {
        window.GAME.save();
        renderCR(host, false, a, b);
        C.syncLock();   // still ON the point — keep the rail locked
        const rh = $('cs-res');
        if (rh) rh.innerHTML = '<div class="cs-result push"><b>' + text + '</b><span>keep rolling</span></div>';
      }
    }, 950);
  }
  CS().reg('cr', { name: 'Craps', icon: '⚄', edge: '1.4% house', render: (h) => renderCR(h), active: () => !!cr || crRolling });

  // ===========================================================================
  // NEBULA SLOTS — weighted outcome table · 99% RTP published
  // ===========================================================================
  const SYMS = ['●', '⬢', '◆', '✦', '◈', '★'];
  const SLOT_OUT = [
    { p: 250, w: 0.04,  kind: 'trip', s: '★', label: '★★★ MEGA JACKPOT' },
    { p: 50,  w: 0.2,   kind: 'trip', s: '◈', label: '◈◈◈ PRISM JACKPOT' },
    { p: 12,  w: 1,     kind: 'trip', s: '✦', label: '✦✦✦ PLASMA LINE' },
    { p: 6,   w: 2.5,   kind: 'trip', s: '◆', label: '◆◆◆ IRON LINE' },
    { p: 3,   w: 5.5,   kind: 'trip', s: '⬢', label: '⬢⬢⬢ FUEL LINE' },
    { p: 2,   w: 7,     kind: 'trip', s: '●', label: '●●● GOLD LINE' },
    { p: 1,   w: 8.5,   kind: 'twostar', label: '★★ — BET BACK' },
    { p: 0.5, w: 13.5,  kind: 'pair', label: 'PAIR — HALF BACK' },
    { p: 0,   w: 63.26, kind: 'none', label: '' },
  ];
  const SLOT_TW = SLOT_OUT.reduce((a, o) => a + o.w, 0);
  let slotLast = ['★', '◈', '✦'], slotShowPays = false, slSpinning = false;
  function slotSpin() {
    let r = Math.random() * SLOT_TW;
    for (const o of SLOT_OUT) { r -= o.w; if (r <= 0) return o; }
    return SLOT_OUT[SLOT_OUT.length - 1];
  }
  function slotFaces(o) {
    const others = (not) => SYMS.filter((s) => !not.includes(s));
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    if (o.kind === 'trip') return [o.s, o.s, o.s];
    if (o.kind === 'twostar') { const x = pick(others(['★'])), i = Math.floor(Math.random() * 3), f = ['★', '★', '★']; f[i] = x; return f; }
    if (o.kind === 'pair') { const s = pick(others(['★'])), x = pick(others([s, '★'])), i = Math.floor(Math.random() * 3), f = [s, s, s]; f[i] = x; return f; }
    const a = pick(others(['★'])), b = pick(others([a, '★'])), c = pick(others([a, b]));
    return [a, b, c];
  }
  function renderSL(host, spinning) {
    const C = CS();
    host.innerHTML =
      '<div class="cs-table slT">' +
        '<div class="slT-marquee">✦ N E B U L A &nbsp; S L O T S ✦</div>' +
        '<div class="cs-felt-k" style="margin-top:6px">92% RETURN-TO-PLAYER — PUBLISHED · JACKPOT 250×</div>' +
        '<div class="slT-cab">' +
          '<div class="cs-reels">' + slotLast.map((s) => '<div class="cs-reel' + (spinning ? ' spin' : '') + '">' + s + '</div>').join('') + '</div>' +
          '<div class="cs-payline"></div>' +
        '</div>' +
        '<div id="cs-res"></div>' +
        '<button class="cs-go" data-spin' + (C.betOK() && !spinning ? '' : ' disabled') + '>' + (spinning ? 'SPINNING…' : 'PULL — ' + C.CUR[C.cas().cur].glyph + ' ' + C.fmt(C.cas().bet)) + '</button>' +
        '<div><button class="cs-go alt" style="margin-top:9px;min-width:0;padding:8px 14px;font-size:9.5px" data-pays>' + (slotShowPays ? 'HIDE PAYTABLE' : 'PAYTABLE') + '</button></div>' +
        (slotShowPays ? '<div class="cs-paytable">' + SLOT_OUT.filter((o) => o.p > 0).map((o) =>
          '<div class="cs-payrow"><span>' + o.label + '</span><b>×' + o.p + '</b></div>').join('') + '</div>' : '') +
      '</div>';
    const pb = host.querySelector('[data-pays]');
    if (pb) pb.onclick = () => { slotShowPays = !slotShowPays; renderSL(host); };
    const sp = host.querySelector('[data-spin]');
    if (sp) sp.onclick = () => CS().guard(1, () => {
      const C2 = CS();
      if (!C2.betOK()) return;
      const bet = Math.floor(C2.cas().bet), curK = C2.cas().cur;
      C2.stake(bet, curK); window.GAME.save();
      slSpinning = true;
      renderSL(host, true);
      C2.syncLock();
      const reels = host.querySelectorAll('.cs-reel');
      const cyc = setInterval(() => reels.forEach((r) => r.textContent = SYMS[Math.floor(Math.random() * SYMS.length)]), 90);
      setTimeout(() => {
        clearInterval(cyc);
        slSpinning = false;
        const o = slotSpin();
        slotLast = slotFaces(o);
        const ret = Math.floor(bet * o.p);
        if (ret) C2.payout(ret, curK);
        C2.bookend(ret - bet);
        renderSL(host, false);
        C2.syncLock();
        C2.resultBanner('cs-res', o.p > 1 ? true : o.p > 0 ? null : false,
          o.p > 0 ? o.label : 'NO LINE — HOUSE TAKES IT',
          o.p > 1 ? ret - bet : o.p > 0 ? 0 : bet, curK);
        if (o.p >= 50) { const rh = $('cs-res'); if (rh) { const j = document.createElement('div'); j.className = 'cs-jack'; j.textContent = '✷ JACKPOT · ×' + o.p + ' ✷'; rh.prepend(j); } }
      }, 1150);
    });
  }
  CS().reg('sl', { name: 'Slots', icon: '✷', edge: '92% RTP', render: (h) => renderSL(h), active: () => slSpinning });

  // ===========================================================================
  // HOLD'EM — oval poker table from above · ante → play or fold · no qualify
  // ===========================================================================
  let he = null;
  function renderHE(host) {
    const C = CS();
    if (!he) {
      host.innerHTML =
        '<div class="cs-table heT">' +
          '<div class="heT-brand">TEXAS HOLD\u2019EM · HEADS-UP</div>' +
          '<div class="cs-felt-k">ANTE → SEE YOUR CARDS → PLAY (1× ANTE) OR FOLD · BEST 5 OF 7 · EVEN MONEY · TIES PUSH</div>' +
          '<div class="heT-line"></div>' +
          '<div class="heT-spots"><span class="bjT-spot empty">ANTE</span><span class="bjT-spot empty">PLAY</span></div>' +
          '<div id="cs-res"></div>' +
          '<button class="cs-go" data-ante' + (C.betOK(2) ? '' : ' disabled') + '>ANTE — ' + C.CUR[C.cas().cur].glyph + ' ' + C.fmt(C.cas().bet) + '</button>' +
          (C.betOK(2) ? '' : '<div class="cs-felt-k" style="margin-top:8px">needs 2× bet on hand to cover the PLAY raise</div>') +
        '</div>';
      const a = host.querySelector('[data-ante]');
      if (a) a.onclick = () => CS().guard(1, () => {
        const C2 = CS();
        if (!C2.betOK(2)) return;
        const deck = C2.freshDeck();
        he = { deck, p: [deck.pop(), deck.pop()], d: [deck.pop(), deck.pop()], board: [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()], ante: Math.floor(C2.cas().bet), cur: C2.cas().cur, stage: 'decide' };
        C2.stake(he.ante, he.cur); window.GAME.save();
        CS().render();
      });
      return;
    }
    const over = he.stage === 'over';
    host.innerHTML =
      '<div class="cs-table heT">' +
        '<div class="heT-brand">TEXAS HOLD\u2019EM · HEADS-UP</div>' +
        '<div class="cs-hand-l">HOUSE <span class="heT-dbtn">D</span></div>' +
        '<div class="cs-hand">' + he.d.map((c) => C.cardHTML(c, { hole: !over, sm: true })).join('') + '</div>' +
        (over && he.dEval ? '<div class="heT-hname">' + C.handName(he.dEval) + '</div>' : '') +
        '<div class="heT-line"></div>' +
        '<div class="cs-hand-l" style="margin-top:2px">BOARD</div>' +
        '<div class="cs-hand">' + he.board.map((c) => C.cardHTML(c, { hole: !over, sm: true })).join('') + '</div>' +
        '<div class="heT-line"></div>' +
        '<div class="cs-hand">' + he.p.map((c) => C.cardHTML(c)).join('') + '</div>' +
        '<div class="cs-hand-l">YOUR HAND</div>' +
        (over && he.pEval ? '<div class="heT-hname you">' + C.handName(he.pEval) + '</div>' : '') +
        '<div class="heT-spots">' +
          '<span class="bjT-spot"><span class="cs-chipmini">' + C.CUR[he.cur].glyph + '</span>ANTE ' + C.fmt(he.ante) + '</span>' +
          (he.played ? '<span class="bjT-spot"><span class="cs-chipmini">' + C.CUR[he.cur].glyph + '</span>PLAY ' + C.fmt(he.ante) + '</span>' : '<span class="bjT-spot empty">PLAY</span>') +
        '</div>' +
        '<div id="cs-res"></div>' +
        (over
          ? '<button class="cs-go" data-again>NEW HAND</button>'
          : '<div class="cs-acts">' +
              '<button class="cs-go" data-play>PLAY — ' + C.CUR[C.cas().cur].glyph + ' ' + C.fmt(he.ante) + '</button>' +
              '<button class="cs-go danger" data-fold>FOLD</button>' +
            '</div>') +
      '</div>';
    const on = (sel, fn) => { const b = host.querySelector(sel); if (b) b.onclick = fn; };
    on('[data-again]', () => { he = null; CS().render(); });
    on('[data-fold]', () => {
      he.stage = 'over'; he.played = false;
      he.pEval = CS().evalBest(he.p.concat(he.board)); he.dEval = CS().evalBest(he.d.concat(he.board));
      CS().bookend(-he.ante);
      renderHE(host);
      CS().syncLock();
      CS().resultBanner('cs-res', false, 'FOLDED — ante forfeited', he.ante, he.cur);
    });
    on('[data-play]', () => CS().guard(1, () => {
      const C2 = CS();
      C2.stake(he.ante, he.cur); he.played = true; he.stage = 'over';
      he.pEval = C2.evalBest(he.p.concat(he.board)); he.dEval = C2.evalBest(he.d.concat(he.board));
      const total = he.ante * 2;
      const cmp = C2.cmpHands(he.pEval, he.dEval);
      let win = null, ret = 0, text = '';
      if (cmp > 0) { win = true; ret = total * 2; text = C2.handName(he.pEval).toUpperCase() + ' WINS'; }
      else if (cmp < 0) { win = false; text = 'HOUSE TAKES IT — ' + C2.handName(he.dEval).toUpperCase(); }
      else { ret = total; text = 'SPLIT POT — PUSH'; }
      if (ret) C2.payout(ret, he.cur);
      C2.bookend(ret - total);
      renderHE(host);
      C2.syncLock();
      C2.resultBanner('cs-res', win, text, win === null ? 0 : (win ? ret - total : total), he.cur);
    }));
  }
  CS().reg('he', { name: 'Hold\u2019em', icon: '♦', edge: '~2% house', render: (h) => renderHE(h), active: () => !!he && he.stage !== 'over' });

  // ---- CSS for these three tables ---------------------------------------------
  function boot() {
    if ($('cs2-css')) return;
    const s = document.createElement('style'); s.id = 'cs2-css'; s.textContent = CSS2; document.head.appendChild(s);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  const CSS2 = `
  /* craps table — long rails, printed field & lines */
  .cs-table.crT{ border-radius:52px; }
  .crT-rail-k{ font-family:'Orbitron',sans-serif; font-size:8px; font-weight:800; letter-spacing:.16em; color:rgba(255,235,180,.7); margin-bottom:8px; }
  .crT-rail-k b{ color:#ffe9ad; }
  .crT-center{ display:flex; flex-direction:column; align-items:center; gap:4px; }
  .cs-puck{ display:inline-flex; align-items:center; gap:6px; border-radius:99px; padding:5px 13px;
    font-family:'Orbitron',sans-serif; font-weight:900; font-size:10px; letter-spacing:.1em; }
  .cs-puck.off{ color:#8ba0b5; background:#0a1119; border:1px solid #2b4055; }
  .cs-puck.on{ color:#0b1119; background:linear-gradient(180deg,#fff,#cfd8e3); box-shadow:0 0 14px rgba(255,255,255,.4); }
  .cs-dice{ display:flex; gap:12px; justify-content:center; align-items:center; font-size:54px; color:#f2f7ff; margin:2px 0 4px; position:relative; }
  .cs-dice.roll span{ animation:csShakeD .5s ease-in-out infinite; }
  .cs-dice.roll span:nth-child(2){ animation-delay:.12s; }
  @keyframes csShakeD{ 0%,100%{ transform:rotate(-8deg) translateY(0);} 50%{ transform:rotate(8deg) translateY(-6px);} }
  .cs-dtot{ position:absolute; right:10%; top:50%; transform:translateY(-50%); font-family:'Orbitron',sans-serif; font-size:19px; color:#ffd24d; }
  .cs-roll-hist{ display:flex; gap:5px; justify-content:center; flex-wrap:wrap; margin-bottom:4px; }
  .cs-roll-hist i{ font-style:normal; font-size:10.5px; font-weight:800; color:#c9d8e8; background:#0a1119; border:1px solid #22334a; border-radius:6px; padding:2px 6px; }
  .crT-field{ position:relative; width:100%; margin-top:8px; border:1.5px solid rgba(255,235,180,.4); background:rgba(0,0,0,.16); border-radius:12px; padding:8px 6px 9px; cursor:pointer; }
  .crT-lab{ display:block; font-family:'Orbitron',sans-serif; font-size:8px; font-weight:800; letter-spacing:.2em; color:rgba(255,235,180,.7); margin-bottom:5px; }
  .crT-nums{ display:flex; gap:7px; justify-content:center; }
  .crT-nums b{ position:relative; font-family:'Orbitron',sans-serif; font-weight:800; font-size:13px; color:#f0ead2; }
  .crT-nums b.x{ color:#ffd24d; }
  .crT-nums u{ position:absolute; top:-8px; right:-11px; text-decoration:none; font-size:7px; color:#7ce0a0; }
  .crT-line{ position:relative; width:100%; margin-top:7px; border-radius:99px; padding:9px 6px; cursor:pointer;
    font-family:'Orbitron',sans-serif; font-weight:800; letter-spacing:.14em; }
  .crT-line.pass{ font-size:11px; border:1.5px solid rgba(255,235,180,.5); background:rgba(255,255,255,.05); color:#f0ead2; }
  .crT-line.dont{ font-size:9px; border:1.5px dashed rgba(255,128,144,.55); background:rgba(255,77,94,.08); color:#ff9aa6; }
  .crT-line i{ font-style:normal; font-family:'Rajdhani',sans-serif; font-weight:700; letter-spacing:.04em; }
  .crT-field.on,.crT-line.on{ outline:2px solid #ffd24d; outline-offset:-1px; box-shadow:0 0 14px -4px rgba(255,210,77,.9); }
  .crT-field:disabled,.crT-line:disabled{ opacity:.65; cursor:default; }
  .crT-chip{ position:absolute; top:-8px; right:8px; width:19px; height:19px; border-radius:50%; display:grid; place-items:center; font-size:9px; color:#0b1119;
    background:radial-gradient(circle at 40% 35%,#ffe9ad,#f2b24b 65%,#a8781f); border:1.5px dashed rgba(255,255,255,.85); box-shadow:0 2px 5px rgba(0,0,0,.6); }

  /* slots cabinet */
  .slT-marquee{ font-family:'Orbitron',sans-serif; font-weight:900; font-size:13px; letter-spacing:.18em; color:#ffd24d;
    text-shadow:0 0 16px rgba(255,210,77,.85); animation:slGlow 2.2s ease-in-out infinite; }
  @keyframes slGlow{ 0%,100%{ text-shadow:0 0 10px rgba(255,210,77,.5);} 50%{ text-shadow:0 0 22px rgba(255,210,77,1);} }
  .slT-cab{ margin:10px auto 2px; max-width:290px; border-radius:16px; padding:14px 12px 10px;
    background:linear-gradient(180deg,#232c44,#141b2c); border:2px solid rgba(255,210,77,.5); box-shadow:0 10px 24px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.08); }
  .cs-reels{ display:flex; gap:9px; justify-content:center; }
  .cs-reel{ width:72px; height:84px; border-radius:11px; display:grid; place-items:center; font-size:36px;
    background:linear-gradient(180deg,#0d1522 0%,#1a2740 50%,#0d1522 100%); border:1px solid rgba(255,210,77,.35);
    box-shadow:inset 0 8px 14px rgba(0,0,0,.7), inset 0 -8px 14px rgba(0,0,0,.7); }
  .cs-reel.spin{ animation:csReel .12s linear infinite; }
  @keyframes csReel{ 0%{ box-shadow:inset 0 14px 16px rgba(0,0,0,.8), inset 0 -2px 8px rgba(0,0,0,.5);} 100%{ box-shadow:inset 0 2px 8px rgba(0,0,0,.5), inset 0 -14px 16px rgba(0,0,0,.8);} }
  .cs-payline{ height:2px; width:82%; margin:10px auto 2px; background:linear-gradient(90deg,transparent,#ffd24d,transparent); opacity:.85; }
  .cs-paytable{ margin-top:10px; border:1px dashed rgba(143,216,172,.4); border-radius:11px; padding:9px 11px; display:grid; grid-template-columns:1fr 1fr; gap:4px 14px; }
  .cs-payrow{ display:flex; justify-content:space-between; font-size:10.5px; font-weight:700; color:#d9ecdf; }
  .cs-payrow b{ color:#ffd24d; font-variant-numeric:tabular-nums; }
  .cs-jack{ font-family:'Orbitron',sans-serif; font-weight:900; font-size:15px; letter-spacing:.14em; color:#ffd24d; text-shadow:0 0 18px rgba(255,210,77,.8); margin:6px 0 4px; animation:csJack .8s ease-in-out infinite; }
  @keyframes csJack{ 0%,100%{ transform:scale(1);} 50%{ transform:scale(1.08);} }

  /* hold'em oval */
  .cs-table.heT{ border-radius:50% / 12%; border-width:4px; border-color:rgba(107,74,29,.9);
    background:radial-gradient(130% 110% at 50% 0%, #145261 0%, #0d3540 45%, #082228 78%, #061a1f 100%); }
  .heT-brand{ font-family:'Orbitron',sans-serif; font-size:9px; font-weight:800; letter-spacing:.24em; color:rgba(180,230,240,.6); margin-bottom:6px; }
  .heT-line{ height:1.5px; width:70%; margin:8px auto; background:rgba(180,230,240,.22); border-radius:2px; }
  .heT-dbtn{ display:inline-grid; place-items:center; width:16px; height:16px; border-radius:50%; background:#fff; color:#0b1119; font-size:9px; font-weight:900; vertical-align:-3px; margin-left:4px; }
  .heT-hname{ font-size:11px; font-weight:800; color:#bfe4ee; letter-spacing:.03em; margin-top:2px; }
  .heT-hname.you{ color:#ffe9ad; }
  .heT-spots{ display:flex; gap:9px; justify-content:center; margin-top:9px; }

  @media (prefers-reduced-motion: reduce){
    .cs-dice.roll span,.cs-reel.spin,.cs-jack,.slT-marquee{ animation:none !important; }
  }
  `;
})();
