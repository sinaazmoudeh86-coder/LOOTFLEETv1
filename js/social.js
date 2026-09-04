/* =============================================================================
   social.js — SOCIAL (Hangar ▸ Social) · Friends, Hearts & the Friendship Store
   ---------------------------------------------------------------------------
   • FRIENDS: search real operators, request/accept, 20-friend cap, live
     online dots (leaderboard heartbeat), profile sheets.
   • DAILY HEARTS: one tap sends a ♥ to every friend — BOTH sides earn
     +10 Friendship Points per heart. More active friends = more FP/day.
   • FRIENDSHIP STORE: FP → LootCoins, gold, Dread Cores, prism. FP balance
     lives server-side (social_wallets); goods land in the local save like
     every other store. Weekly purchase caps tracked in the save.
   Alliance sub-tab renders via window.ALLIANCE (js/alliance.js).
   Backend: supabase/social.sql. Requires a signed-in cloud account.
   ============================================================================= */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const G = () => window.GAME;
  const C = () => window.CLOUD;
  const fmt = (n) => (G() && G().formatNum) ? G().formatNum(n) : String(n);
  const weekKey = () => { const d = new Date(); const t = new Date(d.getFullYear(), 0, 1); return d.getFullYear() + '-' + Math.ceil(((d - t) / 864e5 + t.getDay() + 1) / 7); };

  function toast(t, c) { if (window.UI && window.UI.toast) return window.UI.toast(t, c); const d = document.createElement('div'); d.className = 'sc-toast'; d.textContent = t; d.style.color = c || '#e7f0fb'; document.body.appendChild(d); setTimeout(() => d.remove(), 2600); }
  function signedIn() { try { const s = window.ACCOUNT && ACCOUNT.session && ACCOUNT.session(); return !!(s && s.id && C() && C().enabled); } catch (e) { return false; } }
  const rpc = async (name, args) => { const { data, error } = await C().client.rpc(name, args || {}); if (error) throw error; return data; };

  // ---- local state (weekly shop caps, cached wallet) --------------------------
  function ensure() {
    const s = G().state;
    if (!s.social) s.social = {};
    const so = s.social;
    if (!so.fpShop || so.fpShop.wk !== weekKey()) so.fpShop = { wk: weekKey(), n: {} };
    if (!so.acShop || so.acShop.wk !== weekKey()) so.acShop = { wk: weekKey(), n: {} };
    return so;
  }
  let _wallet = { fp: 0, ac: 0 };
  // NEVER `| 0` A BALANCE \u2014 these two are the last in the game that were. Fleet
  // Points and Alliance Coins cannot realistically reach 2.1 billion at current
  // earn rates, but the value arrives from the SERVER, where a future grant or
  // migration decides its magnitude rather than this file.
  async function refreshWallet() { try { const w = await rpc('social_wallet'); if (w) _wallet = { fp: Math.floor(Number(w.fp) || 0), ac: Math.floor(Number(w.ac) || 0) }; } catch (e) {} }
  function wallet() { return _wallet; }

  // ---- FRIENDSHIP STORE — server debits FP, goods land in the save -----------
  const FP_ITEMS = [
    { id: 'lc',    ic: '◈', name: '100 LootCoins',  cost: 250, wk: 3, col: '#ffd66a', grant: (s) => { s.credits = (s.credits || 0) + 100; return '+100 ◈ LootCoins'; } },
    { id: 'gold',  ic: '$', name: 'Gold Cache',     cost: 150, wk: 5, col: '#f2a93c', amt: (s) => Math.max(10000, Math.round((s.gold || 0) * 0.05)), grant: function (s) { const g = this.amt(s); s.gold = (s.gold || 0) + g; return '+' + fmt(g) + ' gold'; } },
    { id: 'core',  ic: '◇', name: 'Dread Core',     cost: 200, wk: 2, col: '#ff5a68', grant: (s) => { s.dreadCores = (s.dreadCores || 0) + 1; return '+1 ◇ Dread Core'; } },
    { id: 'prism', ic: '◭', name: '3 Prism Ingots', cost: 500, wk: 1, col: '#1fe3b2', need: (s) => !!s.prism, grant: (s) => { s.prism.ingots = (s.prism.ingots || 0) + 3; return '+3 ◭ Prism Ingots'; } },
  ];
  async function buyFP(item) {
    const so = ensure(), s = G().state;
    if ((so.fpShop.n[item.id] | 0) >= item.wk) return toast('Weekly limit reached', '#ffcf7a');
    if (_wallet.fp < item.cost) return toast('Not enough ♥ Friendship Points', '#e23b4e');
    try {
      _wallet.fp = Number(await rpc('social_spend', { p_kind: 'fp', p_amount: item.cost }));
      so.fpShop.n[item.id] = (so.fpShop.n[item.id] | 0) + 1;
      const msg = item.grant(s);
      G().save(); toast('♥ ' + msg, '#7ce0a0');
      if (window.UI && UI.refreshAll) UI.refreshAll();
      render();
    } catch (e) { toast('Purchase failed — ' + (e.message || 'try again'), '#e23b4e'); refreshWallet().then(render); }
  }
  // Alliance store shares the pattern (called from alliance.js)
  async function buyAC(item) {
    const so = ensure(), s = G().state;
    if ((so.acShop.n[item.id] | 0) >= item.wk) { toast('Weekly limit reached', '#ffcf7a'); return false; }
    if (_wallet.ac < item.cost) { toast('Not enough ⬡ Alliance Coins', '#e23b4e'); return false; }
    try {
      _wallet.ac = Number(await rpc('social_spend', { p_kind: 'ac', p_amount: item.cost }));
      so.acShop.n[item.id] = (so.acShop.n[item.id] | 0) + 1;
      const msg = item.grant(s);
      G().save(); toast('⬡ ' + msg, '#7ce0a0');
      if (window.UI && UI.refreshAll) UI.refreshAll();
      return true;
    } catch (e) { toast('Purchase failed — ' + (e.message || 'try again'), '#e23b4e'); return false; }
  }

  // ---- friends data -----------------------------------------------------------
  let _friends = [], _tab = 'friends', _busy = false, _searchRows = null, _hearted = false;
  const online = (t) => t && (Date.now() - new Date(t).getTime()) < 10 * 60e3;
  async function loadFriends() { try { _friends = (await rpc('friend_list')) || []; } catch (e) { _friends = []; } }
  function heartsSentToday() {
    const so = ensure();
    return so.heartsDay === new Date().toDateString();
  }

  // ---- render -----------------------------------------------------------------
  function setTab(t) { _tab = (t === 'alliance') ? 'alliance' : 'friends'; }
  function render() {
    const body = $('social-body'); if (!body) return;
    const sub = $('social-sub');
    if (sub) sub.textContent = signedIn() ? ('♥ ' + fmt(_wallet.fp) + ' · ⬡ ' + fmt(_wallet.ac)) : 'Squad up';
    if (!signedIn()) {
      body.innerHTML = '<div class="sc-veil"><div class="sc-veil-ic">⛅</div><h3>Friends & Alliances live in the cloud</h3>' +
        '<p>Create a free account (or log in) to add friends, send daily hearts, and found an alliance that fights one shared boss.</p>' +
        '<button class="sc-btn gold" id="sc-signin">Create account / Log in</button></div>';
      const b = $('sc-signin'); if (b) b.addEventListener('click', () => { if (window.UI && UI.openAccountSheet) UI.openAccountSheet(); else location.reload(); });
      return;
    }
    const tt = document.querySelector('#screen-social .scr-title');
    if (tt) tt.textContent = _tab === 'alliance' ? '⬡ Alliance' : '♥ Friends';
    body.innerHTML = '<div id="sc-pane"></div>';
    if (_tab === 'alliance') { if (window.ALLIANCE) window.ALLIANCE.renderInto($('sc-pane')); return; }
    renderFriends($('sc-pane'));
  }

  function renderFriends(host) {
    const acc = _friends.filter((f) => f.status === 'accepted');
    const inReq = _friends.filter((f) => f.status === 'pending' && !f.requested_by_me);
    const outReq = _friends.filter((f) => f.status === 'pending' && f.requested_by_me);
    const sent = heartsSentToday();
    let html =
      '<div class="sc-hearts ' + (sent || !acc.length ? 'done' : '') + '">' +
        '<div class="sc-h-l"><div class="sc-h-t">DAILY HEARTS</div>' +
        '<div class="sc-h-s">' + (acc.length ? ('Send ♥ to all ' + acc.length + ' friends — you BOTH earn +10 ♥ points each') : 'Add friends below — every daily heart pays you both') + '</div></div>' +
        '<button class="sc-btn heart" id="sc-heart-all" ' + (sent || !acc.length ? 'disabled' : '') + '>' + (sent ? '✓ Sent today' : '♥ Send to all') + '</button>' +
      '</div>' +
      '<div class="sc-search"><input id="sc-q" placeholder="Search pilots by name…" maxlength="24"><button class="sc-btn" id="sc-go">Search</button></div>';
    if (_searchRows) {
      html += '<div class="sc-sec">SEARCH RESULTS</div>' + (_searchRows.length ? _searchRows.map((r) =>
        '<div class="sc-row"><div class="sc-r-m"><b>' + esc(r.name) + '</b><span>Lv ' + r.level + ' · ⚡ ' + fmt(r.power) + '</span></div>' +
        '<button class="sc-btn sm" data-add="' + r.user_id + '">+ Add</button></div>').join('') :
        '<div class="sc-empty">No pilots match — names come from the leaderboard.</div>');
    }
    if (inReq.length) html += '<div class="sc-sec">REQUESTS · ' + inReq.length + '</div>' + inReq.map((f) =>
      '<div class="sc-row req"><div class="sc-r-m"><b>' + esc(f.name) + '</b><span>Lv ' + f.level + ' · ⚡ ' + fmt(f.power) + '</span></div>' +
      '<button class="sc-btn sm gold" data-acc="' + f.user_id + '">Accept</button><button class="sc-btn sm ghost" data-dec="' + f.user_id + '">✕</button></div>').join('');
    html += '<div class="sc-sec">FRIENDS · ' + acc.length + ' / 20</div>';
    html += acc.length ? acc.map((f) => {
      const ship = (f.fleet && f.fleet[0]) || 'frigate';
      return '<div class="sc-row"><i class="sc-dot ' + (online(f.last_seen) ? 'on' : '') + '"></i>' +
        '<img class="sc-ship" src="ships/ship-' + ship + '.png" alt="" onerror="this.style.display=\'none\'">' +
        '<div class="sc-r-m" data-prof="' + f.user_id + '"><b>' + esc(f.name) + '</b><span>Lv ' + f.level + ' · Zone ' + f.zone + ' · ⚡ ' + fmt(f.power) + (online(f.last_seen) ? ' · <em class="sc-on">online</em>' : '') + '</span></div>' +
        '<button class="sc-btn sm ghost" data-rm="' + f.user_id + '" title="Remove">✕</button></div>';
    }).join('') : '<div class="sc-empty">No friends yet — search a pilot\u2019s name above. Hearts only flow between friends.</div>';
    if (outReq.length) html += '<div class="sc-sec">SENT · pending</div>' + outReq.map((f) =>
      '<div class="sc-row dim"><div class="sc-r-m"><b>' + esc(f.name) + '</b><span>awaiting reply</span></div>' +
      '<button class="sc-btn sm ghost" data-dec="' + f.user_id + '">Cancel</button></div>').join('');
    // friendship store
    const so = ensure();
    html += '<div class="sc-sec">FRIENDSHIP STORE <b class="sc-fp">♥ ' + fmt(_wallet.fp) + '</b></div><div class="sc-store">' +
      FP_ITEMS.filter((it) => !it.need || it.need(G().state)).map((it) => {
        const used = so.fpShop.n[it.id] | 0, cap = used >= it.wk, afford = _wallet.fp >= it.cost;
        return '<div class="sc-item"><span class="sc-i-ic" style="color:' + it.col + '">' + it.ic + '</span>' +
          '<div class="sc-i-m"><b>' + it.name + (it.amt ? ' — <span style="color:' + it.col + '">' + fmt(it.amt(G().state)) + '</span>' : '') + '</b><span>' + used + '/' + it.wk + ' this week' + (it.amt ? ' · 5% of your gold' : '') + '</span></div>' +
          '<button class="sc-btn sm ' + (cap ? 'ghost' : 'gold') + '" data-buy="' + it.id + '" ' + (cap || !afford ? 'disabled' : '') + '>' + (cap ? 'MAX' : '♥ ' + it.cost) + '</button></div>';
      }).join('') + '</div>' +
      '<div class="sc-note">♥ Friendship Points arrive when hearts are sent — in either direction. Store resets weekly.</div>';
    host.innerHTML = html;
    // wire
    const hb = $('sc-heart-all');
    if (hb) hb.addEventListener('click', async () => {
      if (_busy) return; _busy = true; hb.disabled = true; hb.textContent = '…';
      try {
        const n = Number(await rpc('hearts_send_all'));
        ensure().heartsDay = new Date().toDateString(); G().save();
        await refreshWallet();
        toast('♥ Hearts sent to ' + n + ' friend' + (n === 1 ? '' : 's') + ' — +' + (n * 10) + ' ♥', '#ff8fb0');
      } catch (e) { toast('Could not send hearts', '#e23b4e'); }
      _busy = false; render();
    });
    const q = $('sc-q'), go = $('sc-go');
    const doSearch = async () => {
      const v = (q.value || '').trim(); if (v.length < 2) return toast('Type at least 2 letters', '#ffcf7a');
      go.textContent = '…';
      try { _searchRows = (await rpc('pilot_search', { p_q: v })) || []; } catch (e) { _searchRows = []; }
      render();
    };
    if (go) go.addEventListener('click', doSearch);
    if (q) q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
    host.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await rpc('friend_request', { p_target: b.dataset.add }); toast('Request sent', '#7ce0a0'); _searchRows = null; await loadFriends(); }
      catch (e) { toast(e.message || 'Failed', '#e23b4e'); }
      render();
    }));
    host.querySelectorAll('[data-acc]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await rpc('friend_respond', { p_other: b.dataset.acc, p_accept: true }); toast('♥ Friend added', '#7ce0a0'); await loadFriends(); }
      catch (e) { toast(e.message || 'Failed', '#e23b4e'); }
      render();
    }));
    host.querySelectorAll('[data-dec]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await rpc('friend_respond', { p_other: b.dataset.dec, p_accept: false }); await loadFriends(); } catch (e) {}
      render();
    }));
    host.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => confirmSheet(
      'Remove friend?', 'Hearts stop flowing both ways. You can always re-add them later.', async () => {
        try { await rpc('friend_remove', { p_other: b.dataset.rm }); await loadFriends(); } catch (e) {}
        render();
      })));
    host.querySelectorAll('[data-prof]').forEach((d) => d.addEventListener('click', () => {
      const f = _friends.find((x) => x.user_id === d.dataset.prof); if (f) profileSheet(f);
    }));
    host.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => {
      const it = FP_ITEMS.find((x) => x.id === b.dataset.buy); if (it) buyFP(it);
    }));
  }

  // ---- sheets -----------------------------------------------------------------
  function sheet(html) {
    const old = $('sc-sheet'); if (old) old.remove();
    const v = document.createElement('div'); v.id = 'sc-sheet'; v.className = 'sc-sheet-veil';
    v.innerHTML = '<div class="sc-sheet">' + html + '</div>';
    v.addEventListener('click', (e) => { if (e.target === v) v.remove(); });
    document.body.appendChild(v);
    return v;
  }
  function confirmSheet(title, body, onOk) {
    const v = sheet('<h3>' + title + '</h3><p>' + body + '</p><div class="sc-sheet-btns"><button class="sc-btn gold" data-ok>Confirm</button><button class="sc-btn ghost" data-x>Cancel</button></div>');
    v.querySelector('[data-ok]').addEventListener('click', () => { v.remove(); onOk(); });
    v.querySelector('[data-x]').addEventListener('click', () => v.remove());
  }
  function profileSheet(f) {
    const ships = (f.fleet || []).slice(0, 5).map((k) => '<img src="ships/ship-' + k + '.png" alt="" onerror="this.remove()">').join('');
    sheet('<h3>' + esc(f.name) + (online(f.last_seen) ? ' <em class="sc-on">● online</em>' : '') + '</h3>' +
      '<div class="sc-prof-ships">' + ships + '</div>' +
      '<div class="sc-prof-stats"><span>Level <b>' + f.level + '</b></span><span>Zone <b>' + f.zone + '</b></span><span>Power <b>' + fmt(f.power) + '</b></span></div>' +
      '<div class="sc-sheet-btns"><button class="sc-btn ghost" data-x>Close</button></div>')
      .querySelector('[data-x]').addEventListener('click', (e) => e.target.closest('.sc-sheet-veil').remove());
  }
  const esc = (s) => String(s || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  // ---- entry ------------------------------------------------------------------
  let _loadedOnce = false;
  async function open() {
    render();                                     // instant shell
    if (!signedIn()) return;
    await Promise.all([refreshWallet(), loadFriends()]);
    _loadedOnce = true;
    render();
  }

  // Social tab dot: hearts unsent (with friends) — cheap, save-local only
  function updateDot() {
    document.querySelectorAll('[data-hangtab="social"]').forEach((b) => {
      const need = signedIn() && _loadedOnce && _friends.some((f) => f.status === 'accepted') && !heartsSentToday();
      const pend = _loadedOnce && _friends.some((f) => f.status === 'pending' && !f.requested_by_me);
      b.classList.toggle('has-dot', !!(need || pend));
    });
  }
  setInterval(() => { if (document.hidden) return; updateDot(); }, 2500);

  window.SOCIAL = { render, open, setTab, wallet, buyAC, refreshWallet, sheet, confirmSheet, toast, esc, rpc, signedIn, ensure, online };

  const CSS = `
  /* ---- hangar tab bar: icon segments, full-width, comfortable targets ---- */
  /* ---- hangar tab bar: equal grid — all 7 tabs always on screen, no scroll.
     Wide: one row of 7 · phones: balanced 4+3 grid (two rows). ---- */
  .store-cats{ display:grid; grid-template-columns:repeat(8,1fr); gap:4px; padding:5px!important; overflow:visible; border-radius:14px!important; }
  .store-cat{ min-width:0!important; white-space:nowrap; position:relative; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; min-height:50px; padding:6px 2px!important; border-radius:10px; }
  .store-cat .ht-lbl{ max-width:100%; overflow:hidden; text-overflow:ellipsis; }
  .store-cat .ht-ic{ display:block; width:18px; height:18px; opacity:.75; }
  .store-cat .ht-ic svg{ display:block; width:100%; height:100%; }
  .store-cat .ht-lbl{ font-size:10px; font-weight:700; letter-spacing:.05em; line-height:1; }
  .store-cat.active .ht-ic{ opacity:1; filter:drop-shadow(0 0 6px rgba(242,178,75,.55)); }
  .store-cat.active::before{ content:''; position:absolute; left:18%; right:18%; bottom:3px; height:2px; border-radius:2px; background:linear-gradient(90deg,transparent,#f2b24b,transparent); }
  .store-cat.has-dot::after{ content:''; position:absolute; top:5px; right:calc(50% - 16px); width:7px; height:7px; border-radius:50%; background:#ff5a7a; box-shadow:0 0 6px #ff5a7a; }
  @media (max-width:560px){ .store-cats{ grid-template-columns:repeat(4,1fr); } .store-cat{ min-height:46px; } }
  @media (max-width:360px){ .store-cat .ht-lbl{ font-size:9px; } }
  /* ---- social screen ---- */
  #screen-social .scr-title{ color:#ff9fb8; }
  #social-body{ padding:12px; display:flex; flex-direction:column; }
  .sc-tabs{ display:flex; gap:6px; margin-bottom:12px; }
  .sc-tab{ flex:1; font-family:'Orbitron',sans-serif; font-weight:700; font-size:11.5px; letter-spacing:.06em; color:#9fb0c4; background:#121a26; border:1px solid #25303f; border-radius:11px; padding:10px 4px; cursor:pointer; }
  .sc-tab.on{ color:#fff; background:linear-gradient(180deg,#1d2838,#141d2b); border-color:#3d4f68; }
  .sc-veil{ text-align:center; padding:44px 22px; color:#9fb1c4; }
  .sc-veil-ic{ font-size:40px; margin-bottom:10px; }
  .sc-veil h3{ font-family:'Orbitron',sans-serif; color:#e7f0fb; font-size:15px; margin-bottom:8px; }
  .sc-veil p{ font-size:12.5px; line-height:1.6; max-width:340px; margin:0 auto 16px; }
  .sc-btn{ font-family:'Rajdhani',sans-serif; font-weight:800; font-size:13px; letter-spacing:.03em; color:#dfe9f6; background:linear-gradient(180deg,#1c2635,#131c29); border:1px solid #33445c; border-radius:10px; padding:9px 14px; cursor:pointer; }
  .sc-btn.gold{ color:#0b1220; background:linear-gradient(180deg,#ffd24d,#e8960f); border:none; }
  .sc-btn.heart{ color:#fff; background:linear-gradient(180deg,#ff5a7a,#d12a4e); border:none; }
  .sc-btn.ghost{ background:transparent; border:1px solid #2a3648; color:#8fa3bd; }
  .sc-btn.sm{ padding:6px 10px; font-size:12px; flex:none; }
  .sc-btn:disabled{ opacity:.45; pointer-events:none; }
  .sc-btn:active{ transform:scale(.96); }
  .sc-hearts{ display:flex; align-items:center; gap:12px; background:linear-gradient(130deg,#2a1220,#170b14); border:1px solid #52243a; border-radius:14px; padding:13px 14px; margin-bottom:12px; }
  .sc-hearts.done{ opacity:.75; }
  .sc-h-l{ flex:1; min-width:0; }
  .sc-h-t{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:11px; letter-spacing:.12em; color:#ff9fb8; }
  .sc-h-s{ font-size:11.5px; color:#c7a3b2; line-height:1.45; margin-top:3px; }
  .sc-search{ display:flex; gap:6px; margin-bottom:6px; }
  .sc-search input{ flex:1; min-width:0; background:#0e141f; border:1px solid #26324a; border-radius:10px; color:#e7f0fb; font-family:'Rajdhani',sans-serif; font-size:14px; padding:9px 12px; outline:none; }
  .sc-search input:focus{ border-color:#4a5f80; }
  .sc-sec{ font-family:'Orbitron',sans-serif; font-weight:700; font-size:10px; letter-spacing:.14em; color:#6f8199; margin:14px 2px 7px; display:flex; align-items:center; gap:8px; }
  .sc-sec .sc-fp{ margin-left:auto; color:#ff9fb8; font-size:11px; }
  .sc-row{ display:flex; align-items:center; gap:10px; background:#101826; border:1px solid #1e2a3c; border-radius:12px; padding:9px 11px; margin-bottom:6px; }
  .sc-row.req{ border-color:#8a5a2a; }
  .sc-row.dim{ opacity:.6; }
  .sc-dot{ width:8px; height:8px; border-radius:50%; background:#3a4a60; flex:none; }
  .sc-dot.on{ background:#46d27a; box-shadow:0 0 7px #46d27a; }
  .sc-ship{ width:40px; height:28px; object-fit:contain; flex:none; }
  .sc-r-m{ flex:1; min-width:0; cursor:pointer; }
  .sc-r-m b{ display:block; color:#e7f0fb; font-size:13.5px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .sc-r-m span{ font-size:11px; color:#7e91a9; }
  .sc-on{ color:#46d27a; font-style:normal; }
  .sc-empty{ font-size:12px; color:#63748c; background:#0d1420; border:1px dashed #24314a; border-radius:12px; padding:14px; text-align:center; line-height:1.5; }
  .sc-store{ display:grid; gap:6px; }
  .sc-item{ display:flex; align-items:center; gap:10px; background:#101826; border:1px solid #1e2a3c; border-radius:12px; padding:9px 11px; }
  .sc-i-ic{ font-size:19px; width:26px; text-align:center; flex:none; }
  .sc-i-m{ flex:1; min-width:0; }
  .sc-i-m b{ display:block; color:#e7f0fb; font-size:13px; }
  .sc-i-m span{ font-size:10.5px; color:#6f8199; }
  .sc-note{ font-size:10.5px; color:#5f7089; margin-top:8px; line-height:1.5; }
  .sc-sheet-veil{ position:fixed; inset:0; z-index:80; background:rgba(4,7,12,.72); backdrop-filter:blur(3px); display:flex; align-items:flex-end; justify-content:center; }
  .sc-sheet{ width:min(440px,100%); background:linear-gradient(180deg,#141d2b,#0e1520); border:1px solid #2a3850; border-radius:18px 18px 0 0; padding:18px 16px 22px; animation:scUp .22s ease; }
  @keyframes scUp{ from{ transform:translateY(30px); opacity:0; } }
  .sc-sheet h3{ font-family:'Orbitron',sans-serif; font-size:14px; color:#fff; margin-bottom:8px; }
  .sc-sheet p{ font-size:12.5px; color:#9fb1c4; line-height:1.55; }
  .sc-sheet-btns{ display:flex; gap:8px; margin-top:14px; }
  .sc-sheet-btns .sc-btn{ flex:1; }
  .sc-prof-ships{ display:flex; gap:6px; margin:8px 0; }
  .sc-prof-ships img{ width:52px; height:36px; object-fit:contain; background:#0d1420; border:1px solid #223048; border-radius:8px; padding:3px; }
  .sc-prof-stats{ display:flex; gap:14px; font-size:12px; color:#8fa3bd; }
  .sc-prof-stats b{ color:#ffd24d; }
  .sc-toast{ position:fixed; left:50%; bottom:90px; transform:translateX(-50%); z-index:90; background:#0e1520ee; border:1px solid #2a3850; border-radius:12px; padding:10px 16px; font-family:'Rajdhani',sans-serif; font-weight:700; font-size:13px; }
  `;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
})();
