/* =============================================================================
   casino-citadels.js — THE THREE HOUSE CITADELS (Space Casino)
   ---------------------------------------------------------------------------
   Hold one of three holds above the casino and you take 1% of EVERY player's
   net losses to the house that day — server-wide, all five currencies,
   LootCoins included. Three citadels, so 3% of the day's take leaves the house.

   HOW THE POOL WORKS. The client is authoritative for its own save, so it can
   only ever report its OWN losses; the server (casino-citadels.sql) sums every
   player's report into one day row and pays 1% of that. Nothing here computes
   another player's numbers, and nothing here can pay itself.

   DELIVERY. Mail lives in the player's save, so the server cannot write it.
   The payout job writes a row; this module claims it on load and posts the mail
   locally with a claimable prize, then acks it server-side so it is paid once.

   SHIELDS. 24 hours on capture, identical rule to the Void spires: a held
   citadel is untouchable until its shield expires, and taking one re-arms it.
   ============================================================================= */
(function () {
  'use strict';
  const G = () => window.GAME;
  const S = () => window.SOCIAL;
  const CS = () => window.CASINO;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const fmt = (n) => { try { return G().formatNum(Math.floor(n)); } catch (e) { return Math.floor(n || 0).toLocaleString(); } };

  const CURS = [
    { k: 'gold',    g: '$', c: '#f2b24b', n: 'Gold' },
    { k: 'credits', g: '◈', c: '#ffd66a', n: 'LootCoins' },
    { k: 'fuel',    g: '⬢', c: '#5bc0ff', n: 'Fuel' },
    { k: 'iron',    g: '◆', c: '#d0a060', n: 'Iron' },
    { k: 'plasma',  g: '✦', c: '#c07bff', n: 'Plasma' },
  ];
  const ART = { CC1: 'ships/void-cit-1.png', CC2: 'ships/void-cit-2.png', CC3: 'ships/void-cit-3.png' };
  // Level gates (100 / 300 / 500) and the share ladder (1 / 2 / 3%) live on the
  // TILE definitions in game-v93.js, and warp() enforces the gate for real. Nothing
  // is duplicated here.
  const UNLOCK_LV = 100;             // shallowest hold, for the nav/section hint
  let _st = null, _reportT = 0, _pollT = 0;

  const cdTxt = (s) => {
    s = Math.max(0, s | 0);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h >= 1 ? h + 'h ' + m + 'm' : m >= 1 ? m + 'm' : s + 's';
  };

  // ---- reporting my own losses ----------------------------------------------
  // Debounced: a blackjack shoe settles a hand every few seconds and each one
  // must not become a network round-trip. `sent` tracks what has already been
  // banked so a retry can never double-count.
  function reportSoon() {
    clearTimeout(_reportT);
    _reportT = setTimeout(report, 4000);
  }
  async function report() {
    if (!S() || !S().rpc) return;
    let d;
    try { d = CS().dayBook(); } catch (e) { return; }
    const delta = {}; let any = false;
    CURS.forEach(({ k }) => {
      const lost = Math.floor(d.lost[k] || 0), sent = Math.floor((d.sent || {})[k] || 0);
      const diff = lost - sent;
      if (diff > 0) { delta[k] = diff; any = true; }
    });
    const hands = (d.hands | 0) - ((d.sent || {}).hands | 0);
    if (!any && hands <= 0) return;
    try {
      await S().rpc('casino_report_loss', {
        p_gold: delta.gold || 0, p_credits: delta.credits || 0, p_fuel: delta.fuel || 0,
        p_iron: delta.iron || 0, p_plasma: delta.plasma || 0, p_hands: Math.max(0, hands),
      });
      // only mark as sent once the server has taken it
      d.sent = d.sent || {};
      CURS.forEach(({ k }) => { d.sent[k] = Math.floor(d.lost[k] || 0); });
      d.sent.hands = d.hands | 0;
      G().save();
    } catch (e) { /* offline — the delta stays owed and goes up with the next round */ }
  }

  // ---- payouts → mail -------------------------------------------------------
  // Labelled so the inbox reads unambiguously: which citadel, which day, and
  // that it came from the house rather than from combat.
  async function collectPayouts() {
    if (!S() || !S().rpc || !window.MAIL) return;
    let rows = [];
    try { rows = (await S().rpc('casino_payouts_pending')) || []; } catch (e) { return; }
    if (!rows.length) return;
    for (const r of rows) {
      const prize = {};
      if (+r.gold) prize.gold = Math.floor(+r.gold);
      if (+r.credits) prize.lc = Math.floor(+r.credits);
      if (+r.fuel) prize.fuel = Math.floor(+r.fuel);
      if (+r.iron) prize.iron = Math.floor(+r.iron);
      if (+r.plasma) prize.plasma = Math.floor(+r.plasma);
      const lines = CURS.filter((c) => {
        const key = c.k === 'credits' ? 'credits' : c.k;
        return +r[key];
      }).map((c) => '<b style="color:' + c.c + '">' + c.g + ' ' + fmt(+r[c.k]) + '</b> ' + c.n).join(' · ');
      window.MAIL.push({
        ic: '🎰',
        title: 'House cut — ' + (r.citadel_nm || 'Casino Citadel'),
        body: 'You held <b>' + esc(r.citadel_nm) + '</b> at the close of <b>' + esc(r.day) + '</b>, so <b>' + (r.share_pct || 1) + '%</b> of every '
          + 'pilot\u2019s losses to the house that day is yours.<br><br>' + (lines || 'The house broke even — nothing to pay.')
          + '<br><br><span style="color:#8fa3bd">Pooled from <b>' + fmt(r.pool_hands || 0) + '</b> hands played server-wide.</span>',
        meta: {
          kind: 'prize', label: 'CASINO CITADEL', prize,
          casinoPayout: r.id, citadel: r.citadel_nm, day: r.day,
        },
      });
      try { await S().rpc('casino_payout_ack', { p_id: r.id }); } catch (e) {}
    }
    if (window.SOCIAL) SOCIAL.toast('🎰 House cut delivered — check your mail', '#ffd66a');
  }

  // ---- board ----------------------------------------------------------------
  // OWNERSHIP IS NOT STORED HERE. The three holds are real tiles (CC1/CC2/CC3,
  // defined in game-v93.js), so who holds one, whether it is shielded and whether
  // it is yours all come from the same authority every other tile uses. This module
  // only fetches the POOL — the money side.
  const holds = () => { try { return G().casinoHolds ? G().casinoHolds() : []; } catch (e) { return []; } };
  async function load() {
    if (!S() || !S().rpc) { _st = { pool: {}, offline: true }; return; }
    try {
      const r = await S().rpc('casino_citadel_state');
      _st = r ? { pool: (r.pool || {}), offline: false } : { pool: {}, offline: true };
    } catch (e) { _st = { pool: {}, offline: true }; }
  }
  function poolRow() {
    const p = (_st && _st.pool) || {};
    const chips = CURS.filter((c) => +p[c.k]).map((c) =>
      '<span class="ccc-chip" style="--c:' + c.c + '">' + c.g + ' ' + fmt(+p[c.k]) + '</span>').join('');
    if (_st && _st.offline) return '';
    return '<div class="ccc-pool"><div class="ccc-pool-h">TODAY\u2019S HOUSE TAKE \u00b7 <b>' + fmt(p.hands || 0) + '</b> hands \u00b7 <b>'
      + fmt(p.players || 0) + '</b> pilots</div>'
      + '<div class="ccc-chips">' + (chips || '<span class="ccc-chip dim">nothing lost yet today</span>') + '</div>'
      + '<div class="ccc-pool-f">Paid at midnight UTC \u00b7 <b>1%</b> / <b>2%</b> / <b>3%</b> by hold \u00b7 <b>'
      + (((_st && _st.total_pct) || 6)) + '%</b> total leaves the house</div></div>';
  }
  function tile(c) {
    const lv = G().state.level | 0;
    const need = c.req_lv, gated = lv < need, sh = c.shield_left | 0;
    const status = gated ? '<span class="ccc-s lock">🔒 LV ' + need + '</span>'
      : c.mine ? '<span class="ccc-s own">★ YOURS</span>'
      : sh > 0 ? '<span class="ccc-s shield">🛡 ' + cdTxt(sh) + '</span>'
      : c.rival ? '<span class="ccc-s foe">⚑ ' + esc(c.rival) + '</span>'
      : '<span class="ccc-s free">UNCLAIMED</span>';
    const p = (_st && _st.pool) || {};
    const cut = Math.floor((+p.gold || 0) * c.share / 100);
    return '<button class="ccc-tile' + (c.mine ? ' own' : c.rival ? ' foe' : '') + (gated ? ' gated' : '') + '" data-ccc="' + c.id + '">'
      + '<img class="ccc-art" src="' + ART[c.id] + '" alt="">'
      + '<div class="ccc-n">' + esc(c.name) + '</div>'
      + '<div class="ccc-pct">' + c.share + '%<i> \u00b7 LV ' + need + '</i></div>'
      + status
      + '<div class="ccc-cut">' + (cut ? '$ ' + fmt(cut) + ' so far today' : 'no take yet') + '</div>'
      + '</button>';
  }
  function render(host) {
    if (typeof host === 'string') host = $(host);
    if (!host) return;
    const cits = holds();
    const total = (() => { try { return G().casinoTotalShare ? G().casinoTotalShare() : 6; } catch (e) { return 6; } })();
    host.innerHTML = '<div class="ccc-wrap">'
      + '<div class="ccc-head"><div class="ccc-h-t">🎰 THE HOUSE CITADELS</div>'
      + '<div class="ccc-h-s">Three holds sit above the floor, paying <b>1%</b>, <b>2%</b> and <b>3%</b> of every pilot\u2019s '
      + 'losses to the house \u2014 gold, resources and <b>LootCoins</b> alike, every day you hold one. '
      + 'They are <b>sieged like Void spires</b>: warp in, break the garrison, hold it against everyone else. '
      + 'Unlock at <b>Level 100 / 300 / 500</b>, and capture arms a <b>24-hour shield</b>.</div></div>'
      + ((_st && _st.offline) ? '<div class="ccc-off">\u22ef House ledger unreachable \u2014 holds can still be fought over, but today\u2019s take is unknown until it responds.</div>' : '')
      + poolRow()
      + '<div class="ccc-board">' + cits.map(tile).join('') + '</div>'
      + '<div class="ccc-foot">Paid at midnight UTC \u00b7 <b>' + total + '%</b> of the day\u2019s losses leaves the house</div>'
      + '</div>';
    host.querySelectorAll('[data-ccc]').forEach((b) => b.addEventListener('click', () => open(b.dataset.ccc, host)));
  }
  // The siege sheet. Deliberately the same shape and vocabulary as the Void Zone's
  // tile sheet: defender intel, entry toll, shield timer, then one action. Taking a
  // hold WARPS YOU IN — the tile is won in combat by GAME.warp()/captureSystem(),
  // never by this UI.
  function open(id, host) {
    const c = holds().find((x) => x.id === id);
    if (!c) return;
    const g = G(), lv = g.state.level | 0;
    const need = c.req_lv, gated = lv < need, sh = c.shield_left | 0;
    const inf = g.tileInfo ? g.tileInfo(id) : null;
    const cost = g.entryCostFor ? g.entryCostFor(id) : null;
    const p = (_st && _st.pool) || {};
    const rows = CURS.map((cu) => {
      const pool = +p[cu.k] || 0;
      return '<div class="ccs-row"><span>' + cu.g + ' ' + cu.n + '</span>'
        + '<b style="color:' + cu.c + '">' + (pool ? fmt(Math.floor(pool * c.share / 100)) : '0') + '</b></div>';
    }).join('');
    const toll = cost ? '<div class="ccs-row"><span>\u2694 Entry toll \u00b7 burned on every warp-in</span>'
      + '<b style="color:#8fc4ff">\u2b22 ' + fmt(cost.fuel || 0) + ' \u00b7 \u25c6 ' + fmt(cost.iron || 0) + ' \u00b7 \u2726 ' + fmt(cost.plasma || 0) + '</b></div>' : '';
    // defender intel — the rival's published fleet, or your own garrison
    const def = (inf && inf.defense) || null;
    const defRow = def ? '<div class="ccs-def"><span class="ccs-k">' + (c.mine ? '\u26e8 YOUR GARRISON' : '\u2694 DEFENDING FLEET \u2014 ' + esc(def.name || def.nm || c.rival || 'Fleet')) + '</span>'
      + '<div class="ccs-pow"><i>FLEET POWER</i><b>' + fmt(def.score || 0) + '</b></div></div>' : '';
    let act;
    if (gated) act = '<div class="ccs-block">🔒 Requires Level ' + need + ' \u2014 you are Level ' + lv
      + '<div class="ccs-gatebar"><i style="width:' + Math.max(2, Math.min(100, Math.round(lv / need * 100))) + '%"></i></div></div>';
    else if (!c.mine && sh > 0) act = '<div class="ccs-block shield">🛡 Attack shield \u2014 openable in ' + cdTxt(sh) + '</div>';
    else act = '<button class="ccs-go" data-warp="' + id + '">'
      + (c.mine ? '\u26e8 ENTER YOUR HOLD' : c.rival ? '\u2694 ATTACK \u2014 SIEGE THE HOLD' : '\u2694 CLAIM \u2014 LAUNCH THE SIEGE') + '</button>';
    const abandon = c.mine ? '<button class="ccs-ab" data-ab="' + id + '">\u23cf Abandon the hold \u2014 release the daily cut</button>' : '';
    const v = S().sheet('<div class="ccs-hero"><img src="' + ART[id] + '" alt="">'
      + '<div class="ccs-t">' + esc(c.name) + '</div>'
      + '<div class="ccs-holder">' + (c.mine ? '<b style="color:#ffd24d">\u2605 YOU HOLD THIS</b>'
        : c.rival ? '<b style="color:#ff8a96">\u2691 ' + esc(c.rival) + '</b>'
        : '<b style="color:#8fa3bd">NEUTRAL \u2014 unclaimed</b>') + '</div></div>'
      + '<div class="ccs-share">' + c.share + '% <i>of every pilot\u2019s daily losses \u00b7 unlocks at Level ' + need + '</i></div>'
      + defRow
      + '<div class="ccs-sec">YOUR CUT IF YOU HOLD IT AT MIDNIGHT UTC</div>'
      + '<div class="ccs-rows">' + rows + toll
      + (sh > 0 ? '<div class="ccs-row"><span>🛡 Shield</span><b style="color:#8fe0ff">' + cdTxt(sh) + ' left</b></div>' : '')
      + '</div>'
      + '<div class="ccs-note">Break the garrison to take the hold \u2014 it is won in combat, not on this screen. '
      + 'Whoever holds it at midnight takes the whole day; it is not pro-rated.</div>'
      + act + abandon + '<button class="ccs-x" data-x>Close</button>');
    v.querySelector('[data-x]').addEventListener('click', () => v.remove());
    const go = v.querySelector('[data-warp]');
    if (go) go.addEventListener('click', () => {
      const r = g.warp(id);
      if (r && r.ok) { v.remove(); const nav = document.querySelector('.nav-btn[data-screen="battle"]'); if (nav) nav.click(); return; }
      const why = { locked: '🔒 Level gate', cooldown: '🛡 Attack shield active', resources: '\u2726 Not enough resources for the toll',
                    ally: '\u2b21 Alliance tile \u2014 never attackable', cap: '\u26a0 Empire at capacity \u2014 abandon a system first',
                    home: 'That tile is neutral' }[r && r.reason] || 'Warp failed';
      S().toast(why, '#e23b4e');
      if (r && r.reason === 'resources' && r.cost) S().toast('Toll: \u2b22 ' + fmt(r.cost.fuel || 0) + ' \u00b7 \u25c6 ' + fmt(r.cost.iron || 0) + ' \u00b7 \u2726 ' + fmt(r.cost.plasma || 0), '#8fc4ff');
    });
    const ab = v.querySelector('[data-ab]');
    if (ab) ab.addEventListener('click', () => {
      S().confirmSheet('Abandon ' + c.name + '?', 'You stop earning the daily cut immediately and anyone can siege the hold.', () => {
        try { const r = g.abandonTile(id); if (r && r.ok === false) { S().toast('Cannot abandon', '#e23b4e'); return; } } catch (e) {}
        S().toast('\u23cf ' + c.name + ' abandoned \u2014 the house reclaims it', '#8fc4ff');
        v.remove(); render(host);
      });
    });
  }

  // ---- entry ----------------------------------------------------------------
  async function mount(host) {
    if (!_st) _st = { pool: {}, offline: true };
    render(host);              // tiles paint immediately — ownership is local
    await load();
    render(host);
    clearInterval(_pollT);
    _pollT = setInterval(async () => {
      const el = typeof host === 'string' ? $(host) : host;
      if (!el || !el.isConnected) { clearInterval(_pollT); _pollT = 0; return; }
      await load(); render(el);
    }, 60000);
  }
  function boot() {
    const css = document.createElement('style');
    css.textContent = CSS;
    document.head.appendChild(css);
    // sweep any owed payouts once the session is up
    setTimeout(collectPayouts, 4000);
    setTimeout(report, 6000);
  }

  window.CASCIT = { mount, render, load, reportSoon, report, collectPayouts, UNLOCK_LV };

  const CSS = `
  .ccc-wrap{ margin-bottom:14px; }
  .ccc-head{ border:1px solid #3a2b18; border-radius:14px; padding:13px; margin-bottom:10px;
    background:linear-gradient(130deg,#231a0e,#120d07); }
  .ccc-h-t{ font-family:'Orbitron',sans-serif; font-weight:900; font-size:12px; letter-spacing:.12em; color:#ffd66a; }
  .ccc-h-s{ font-size:12px; line-height:1.55; color:#a89272; margin-top:6px; text-wrap:pretty; }
  .ccc-h-s b{ color:#ffe0ad; }
  .ccc-off{ border:1px dashed #4a3a22; border-radius:11px; padding:9px 11px; margin-bottom:10px;
    font-size:11.5px; line-height:1.5; color:#8d7b62; text-wrap:pretty; }
  .ccc-pool{ border:1px solid rgba(255,214,106,.3); border-radius:12px; padding:10px 12px; margin-bottom:10px;
    background:rgba(255,214,106,.06); }
  .ccc-pool-h{ font-family:'Orbitron',sans-serif; font-size:8.5px; font-weight:900; letter-spacing:.12em; color:#a89272; }
  .ccc-pool-h b{ color:#ffd66a; font-variant-numeric:tabular-nums; }
  .ccc-pool-f{ font-size:10.5px; color:#8d7b62; margin-top:7px; }
  .ccc-pool-f b{ color:#ffd66a; }
  .ccc-chips{ display:flex; flex-wrap:wrap; gap:5px; margin-top:7px; }
  .ccc-chip{ font-family:'Rajdhani',sans-serif; font-weight:800; font-size:11px; color:var(--c);
    border:1px solid color-mix(in srgb, var(--c) 40%, transparent); background:color-mix(in srgb, var(--c) 12%, transparent);
    border-radius:7px; padding:2px 7px; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .ccc-chip.dim{ color:#7a6a55; border-color:#3a3226; background:none; }
  .ccc-board{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
  @media (max-width:420px){ .ccc-board{ grid-template-columns:minmax(0,1fr); } }
  .ccc-tile{ position:relative; display:flex; flex-direction:column; align-items:center; gap:4px; min-width:0;
    padding:12px 8px; border-radius:14px; cursor:pointer; font-family:inherit; text-align:center;
    border:1px solid #3a2b18; background:linear-gradient(180deg,#1b1409,#0d0904); }
  .ccc-tile.own{ border-color:rgba(242,178,75,.6); background:linear-gradient(180deg,#2a1f0c,#120d05); }
  .ccc-tile.foe{ border-color:rgba(255,90,104,.5); }
  .ccc-tile.gated{ opacity:.6; }
  .ccc-tile:active{ transform:scale(.98); }
  .ccc-art{ height:58px; max-width:80%; object-fit:contain; filter:drop-shadow(0 0 14px rgba(255,214,106,.55)); }
  .ccc-n{ font-family:'Orbitron',sans-serif; font-weight:700; font-size:10px; color:#ffe0ad;
    max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .ccc-s{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:8.5px; letter-spacing:.07em;
    border-radius:6px; padding:2px 7px; white-space:nowrap; max-width:100%; overflow:hidden; text-overflow:ellipsis; }
  .ccc-s.own{ color:#ffd24d; border:1px solid rgba(242,178,75,.5); background:rgba(242,178,75,.1); }
  .ccc-s.foe{ color:#ff8a96; border:1px solid rgba(255,90,104,.5); background:rgba(255,90,104,.1); }
  .ccc-s.shield{ color:#8fe0ff; border:1px solid rgba(95,209,255,.45); background:rgba(95,209,255,.1); }
  .ccc-s.free{ color:#a89272; border:1px dashed #4a3a22; }
  .ccc-s.lock{ color:#8d7b62; border:1px dashed #4a3a22; }
  .ccc-pct{ font-family:'Orbitron',sans-serif; font-weight:900; font-size:13px; color:#ffd66a; line-height:1;
    text-shadow:0 0 10px rgba(255,214,106,.5); }
  .ccc-pct i{ font-style:normal; font-family:'Rajdhani',sans-serif; font-weight:700; font-size:8.5px; color:#8d7b62; }
  .ccc-cut{ font-size:9px; color:#8d7b62; font-variant-numeric:tabular-nums; }
  .ccc-empty{ grid-column:1/-1; text-align:center; padding:20px; color:#7a6a55; font-size:12px; }
  .ccs-hero{ position:relative; text-align:center; border-radius:14px; padding:16px 12px 12px; margin-bottom:12px;
    border:1px solid rgba(255,214,106,.3);
    background:radial-gradient(120% 90% at 50% 0%, rgba(255,214,106,.14), transparent 62%), linear-gradient(180deg,#1b1409,#0c0805); }
  .ccs-hero img{ height:150px; max-width:80%; object-fit:contain;
    filter:drop-shadow(0 0 28px rgba(255,214,106,.75)) drop-shadow(0 8px 20px rgba(0,0,0,.7)); }
  .ccs-t{ font-family:'Orbitron',sans-serif; font-weight:900; font-size:18px; color:#fff; margin-top:6px;
    text-shadow:0 0 18px rgba(255,214,106,.7); }
  .ccs-holder{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:12px; letter-spacing:.08em; margin-top:5px; }
  .ccs-share{ text-align:center; font-family:'Orbitron',sans-serif; font-weight:900; font-size:26px; color:#ffd66a;
    text-shadow:0 0 18px rgba(255,214,106,.6); margin:0 0 10px; }
  .ccs-share i{ display:block; font-style:normal; font-family:'Rajdhani',sans-serif; font-weight:700;
    font-size:11px; letter-spacing:.04em; color:#8d7b62; margin-top:2px; }
  .ccs-sec{ font-family:'Orbitron',sans-serif; font-size:8.5px; font-weight:900; letter-spacing:.12em; color:#a89272; margin:0 0 6px; }
  .ccs-rows{ margin-bottom:10px; }
  .ccs-row{ display:flex; justify-content:space-between; align-items:center; gap:10px; padding:8px 2px;
    border-bottom:1px solid rgba(255,255,255,.06); font-size:13px; color:#c9b391; }
  .ccs-row b{ font-family:'Orbitron',sans-serif; font-size:14px; font-variant-numeric:tabular-nums; }
  .ccs-note{ font-size:11.5px; line-height:1.5; color:#8d7b62; margin:10px 0 12px; text-wrap:pretty; }
  .ccs-gatebar{ height:6px; border-radius:4px; margin-top:9px; background:#1a1409; border:1px solid #4a3a22; overflow:hidden; }
  .ccs-gatebar i{ display:block; height:100%; background:linear-gradient(90deg,#e8960f,#ffd98a); box-shadow:0 0 8px rgba(255,214,106,.7); }
  .ccs-block{ text-align:center; border:1px solid #4a3a22; border-radius:11px; padding:12px; color:#a89272;
    font-family:'Orbitron',sans-serif; font-weight:800; font-size:11px; }
  .ccs-block.shield{ color:#8fe0ff; border-color:rgba(95,209,255,.45); }
  .ccs-go{ display:block; width:100%; border:none; border-radius:11px; padding:14px; cursor:pointer;
    font-family:'Orbitron',sans-serif; font-weight:900; font-size:12px; letter-spacing:.1em; color:#1a1108;
    background:linear-gradient(180deg,#ffd98a,#e8960f); }
  .ccs-go:active{ transform:scale(.98); }
  .ccs-ab{ display:block; width:100%; border:1px solid rgba(255,90,104,.5); background:rgba(255,90,104,.08);
    color:#ff8a96; border-radius:11px; padding:12px; cursor:pointer; font-family:'Rajdhani',sans-serif;
    font-weight:800; font-size:12px; }
  .ccs-x{ display:block; width:100%; margin-top:8px; background:none; border:1px solid #4a3a22; color:#a89272;
    border-radius:10px; padding:9px; font-family:'Rajdhani',sans-serif; font-weight:700; font-size:12px; cursor:pointer; }
  `;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
