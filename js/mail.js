/* =============================================================================
   mail.js — COMMS (Hangar ▸ Mail) · account notification inbox
   ---------------------------------------------------------------------------
   First wire-in: MY GALAXY war reports. You get a letter when
     • a real operator captures one of your systems (live or while you slept),
       including the attacker's published fleet snapshot (flagship, Lv, score,
       HP, DPS, escorts) — the same snapshot the turf war shares on claims
     • a simulated raider overruns a system (razed citadels called out)
     • you capture / retake a system, or lose a claim race by seconds
   Any system can post mail: window.MAIL.push({ic,title,body,meta}).
   Mail lives in the save (state.mail, cap 60) — syncs across devices.
   ============================================================================= */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const G = () => window.GAME;
  const fmt = (n) => { try { return G().formatNum(Math.floor(Number(n) || 0)); } catch (e) { return String(n); } };
  const esc = (s) => String(s || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  function box() {
    const s = G().state;
    if (!s.mail) s.mail = { list: [], seq: 1 };
    return s.mail;
  }
  function push(m) {
    try {
      const b = box();
      b.list.unshift({ id: b.seq++, t: Date.now(), read: false, ic: m.ic || '✉', title: m.title || 'Message', body: m.body || '', meta: m.meta || null });
      if (b.list.length > 60) b.list.length = 60;
      G().save();
      badge();
      // "new transmission" alert — anywhere in the game
      try { if (window.UI && UI.unlockToast) UI.unlockToast('✉ New transmission — ' + (m.title || 'Message')); } catch (e) {}
      const scr = document.getElementById('screen-mail');
      if (scr && scr.classList.contains('active')) render();
    } catch (e) {}
  }
  const unread = () => { try { return box().list.filter((m) => !m.read).length; } catch (e) { return 0; } };

  // ---- COLLECT ALL -------------------------------------------------------------
  // "Mark all read" used to leave prize mail sitting unclaimed — you had to open
  // and tap every single one. It now banks every unclaimed prize in the inbox and
  // reports the whole haul in one receipt instead of a stack of toasts.
  const CUR = [
    { k: 'coins', g: '✦', c: '#5fd1ff', n: 'Event Coins' },
    { k: 'lc',    g: '◈', c: '#f2a93c', n: 'LootCoins' },
    { k: 'gold',  g: '$', c: '#e6b566', n: 'Gold' },
    { k: 'cores', g: '◇', c: '#ff5a6a', n: 'Dread Cores' },
  ];
  const fmtN = (v) => { try { return G().formatNum(v); } catch (e) { return Number(v).toLocaleString(); } };
  const claimable = () => { try { return box().list.filter((m) => m.meta && m.meta.kind === 'prize' && m.meta.prize && !m.meta.claimed); } catch (e) { return []; } };

  function collectAll() {
    const b = box(), prizes = claimable(), got = {};
    let claimed = 0, failed = 0;
    prizes.forEach((m) => {
      let txt = null;
      try { txt = (window.SDREAD && window.SDREAD.payPrize) ? window.SDREAD.payPrize(m.meta.prize) : null; } catch (e) {}
      if (txt == null) { failed++; return; }               // payout refused — leave it claimable
      m.meta.claimed = true; claimed++;
      CUR.forEach((c) => { const v = m.meta.prize[c.k]; if (v) got[c.k] = (got[c.k] || 0) + v; });
    });
    const readNow = b.list.filter((m) => !m.read).length;
    b.list.forEach((m) => { m.read = true; });
    try { G().save(); } catch (e) {}
    badge(); render();
    if (window.UI) { try { window.UI.refreshAll(); } catch (e) {} }
    if (claimed) haul(got, claimed, readNow, failed);
    else if (failed && window.SOCIAL) SOCIAL.toast('Claim failed — refresh the game', '#e23b4e');
  }

  // the receipt — one screen, everything you just banked
  function haul(got, claimed, readNow, failed) {
    const rows = CUR.filter((c) => got[c.k]).map((c) =>
      '<div class="mlh-row"><span class="mlh-g" style="color:' + c.c + '">' + c.g + '</span>' +
      '<span class="mlh-n">' + c.n + '</span>' +
      '<b class="mlh-v" style="color:' + c.c + '">+' + fmtN(got[c.k]) + '</b></div>').join('');
    const o = document.createElement('div');
    o.className = 'mlh-back';
    o.innerHTML = '<div class="mlh-card">' +
      '<div class="mlh-ic">🏆</div>' +
      '<div class="mlh-h">REWARDS COLLECTED</div>' +
      '<div class="mlh-sub">' + claimed + ' prize' + (claimed === 1 ? '' : 's') + ' banked' +
        (readNow ? ' · ' + readNow + ' message' + (readNow === 1 ? '' : 's') + ' read' : '') + '</div>' +
      '<div class="mlh-rows">' + (rows || '<div class="mlh-row"><span class="mlh-n">Collected</span></div>') + '</div>' +
      (failed ? '<div class="mlh-err">' + failed + ' could not be claimed — try again in a moment.</div>' : '') +
      '<button class="mlh-ok" type="button">Nice</button></div>';
    document.body.appendChild(o);
    const close = () => { try { o.remove(); } catch (e) {} };
    o.querySelector('.mlh-ok').addEventListener('click', close);
    o.addEventListener('click', (e) => { if (e.target === o) close(); });
  }

  // ---- galaxy war reports ------------------------------------------------------
  function tileLost(tileName, info, opts) {
    info = info || {}; opts = opts || {};
    const who = info.ownerName || 'An unknown raider';
    push({
      ic: '⚔',
      title: (opts.offline ? 'While you were away — ' : '') + tileName + ' has fallen',
      body: who + ' captured your system <b>' + esc(tileName) + '</b>' +
        (opts.razed ? ' and <b>razed your Citadel</b>' : '') +
        '. The tile is shielded — plan your counterattack from My Galaxy.',
      meta: { kind: 'loss', from: who, tile: tileName, fleetScore: info.fleetScore || 0, fleet: info.defense || null },
    });
  }
  function tileWon(tileName, fromName, razed) {
    push({
      ic: '✦',
      title: 'System captured — ' + tileName,
      body: (fromName ? 'You took <b>' + esc(tileName) + '</b> from ' + esc(fromName) : 'You captured <b>' + esc(tileName) + '</b>') +
        (razed ? ' — their Citadel is rubble' : '') + '. It produces resources every hour you hold it.',
      meta: { kind: 'win', tile: tileName },
    });
  }
  function raceLost(tileName, who) {
    push({ ic: '⏱', title: 'Claim race lost — ' + tileName,
      body: (who ? esc(who) : 'Another operator') + ' sealed the claim on <b>' + esc(tileName) + '</b> seconds before your flag planted. No losses — the galaxy is fast.',
      meta: { kind: 'race', tile: tileName } });
  }

  // ---- render -------------------------------------------------------------------
  let _openId = null;
  function fleetCard(meta) {
    if (!meta || (!meta.fleet && !meta.fleetScore)) return '';
    const f = meta.fleet || {};
    const flag = f.ship || null;
    const escorts = (f.escKeys || []).slice(0, 4);
    return '<div class="ml-fleet"><div class="ml-f-h">ATTACKER FLEET INTEL</div>' +
      '<div class="ml-f-top">' +
      (flag ? '<img class="ml-f-flag" src="ships/ship-' + flag + '.png" alt="" onerror="this.remove()">' : '') +
      '<div class="ml-f-m"><b>' + esc(meta.from || 'Unknown') + (f.lvl ? ' · Lv ' + f.lvl : '') + '</b>' +
      '<span>' + esc(f.nm || 'Flagship unknown') + (f.esc ? ' + ' + f.esc + ' escort' + (f.esc > 1 ? 's' : '') : '') + '</span></div></div>' +
      '<div class="ml-f-stats">' +
      '<span>⚡ <b>' + fmt(meta.fleetScore || f.score || 0) + '</b> score</span>' +
      (f.hp ? '<span>❤ <b>' + fmt(f.hp) + '</b> HP</span>' : '') +
      (f.dps ? '<span>☄ <b>' + fmt(f.dps) + '</b> DPS</span>' : '') + '</div>' +
      (escorts.length ? '<div class="ml-f-esc">' + escorts.map((k) => '<img src="ships/ship-' + k + '.png" alt="" onerror="this.remove()">').join('') + '</div>' : '') +
      '</div>';
  }
  // 🏆 claimable prize mails — the winnings are collected RIGHT HERE
  function prizeBtn(m) {
    const meta = m.meta;
    if (!meta || meta.kind !== 'prize' || !meta.prize) return '';
    if (meta.claimed) return '<div class="ml-claimed">✓ Winnings collected</div>';
    return '<button class="ml-claim" data-claim-mail="' + m.id + '">🏆 CLAIM WINNINGS</button>';
  }
  function ctaBtn(meta) {
    if (!meta || !meta.cta || meta.prize) return '';
    return '<button class="ml-cta" data-cta-screen="' + esc(meta.cta.screen) + '">' + esc(meta.cta.label) + '</button>';
  }
  const ago = (t) => { const s = (Date.now() - t) / 1000; if (s < 90) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago'; };
  function render() {
    const body = $('mail-body'); if (!body) return;
    const b = box(), n = unread();
    const sub = $('mail-sub'); if (sub) sub.textContent = b.list.length ? (n ? n + ' unread' : 'All read') : '';
    let html = '';
    const cn = claimable().length;
    html += '<div class="ml-bar"><span class="ml-count">' + b.list.length + ' message' + (b.list.length === 1 ? '' : 's') + '</span>' +
      '<button class="sc-btn sm ghost ml-act' + (cn ? ' ml-hot' : '') + '" id="ml-readall" ' + ((n || cn) ? '' : 'disabled') + '>' +
        (cn ? '🏆 Collect all · ' + cn : '✓ Mark all read') + '</button>' +
      '<button class="sc-btn sm ghost ml-act" id="ml-clear" ' + (b.list.length ? '' : 'disabled') + '>✕ Clear read</button></div>';
    if (!b.list.length) {
      html += '<div class="sc-empty">No transmissions yet. War reports from My Galaxy land here — captures, losses, and who hit you (with their fleet intel).</div>';
    } else {
      html += b.list.map((m) => {
        const open = _openId === m.id;
        return '<div class="ml-row ' + (m.read ? '' : 'unread') + (open ? ' open' : '') + '" data-mid="' + m.id + '">' +
          '<div class="ml-r-head"><span class="ml-ic">' + m.ic + '</span>' +
          '<div class="ml-r-m"><b>' + m.title + '</b><span>' + ago(m.t) + '</span></div>' +
          (m.read ? '' : '<i class="ml-dot"></i>') + '<span class="ml-chev">' + (open ? '▾' : '▸') + '</span></div>' +
          (open ? '<div class="ml-r-body"><p>' + m.body + '</p>' + fleetCard(m.meta) + prizeBtn(m) + ctaBtn(m.meta) + '</div>' : '') +
          '</div>';
      }).join('');
    }
    body.innerHTML = html;
    body.querySelectorAll('[data-mid]').forEach((r) => r.querySelector('.ml-r-head').addEventListener('click', () => {
      const id = +r.dataset.mid, m = box().list.find((x) => x.id === id);
      _openId = _openId === id ? null : id;
      if (m && !m.read) { m.read = true; G().save(); badge(); }
      render();
    }));
    body.querySelectorAll('[data-claim-mail]').forEach((btn) => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mm = box().list.find((x) => x.id === +btn.dataset.claimMail);
      if (!mm || !mm.meta || !mm.meta.prize || mm.meta.claimed) return;
      let txt = null;
      try { txt = (window.SDREAD && window.SDREAD.payPrize) ? window.SDREAD.payPrize(mm.meta.prize) : null; } catch (e2) {}
      if (txt == null) { if (window.SOCIAL) SOCIAL.toast('Claim failed — refresh the game', '#e23b4e'); return; }
      mm.meta.claimed = true; mm.read = true; G().save();
      if (window.SOCIAL) SOCIAL.toast('🏆 Claimed: ' + txt, '#ffd24d');
      if (window.UI) { try { window.UI.refreshAll(); } catch (e3) {} }
      render(); badge();
    }));
    body.querySelectorAll('[data-cta-screen]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const scr = b.dataset.ctaScreen;
      if (window.UI && UI.showScreen) UI.showScreen(scr);
    }));
    const ra = $('ml-readall'); if (ra) ra.addEventListener('click', collectAll);
    const cl = $('ml-clear'); if (cl) cl.addEventListener('click', () => { const bb = box(); bb.list = bb.list.filter((m) => !m.read); _openId = null; G().save(); badge(); render(); });
  }

  // hangar-tab unread badge (numeric)
  function badge() {
    const n = unread();
    document.querySelectorAll('[data-hangtab="mail"]').forEach((b) => {
      b.classList.toggle('has-n', n > 0);
      b.setAttribute('data-n', n > 9 ? '9+' : n);
    });
  }
  setInterval(badge, 2500);

  window.MAIL = { push, render, unread, tileLost, tileWon, raceLost };

  const CSS = `
  #screen-mail .scr-title{ color:#8fd4ff; }
  #mail-body{ padding:12px; }
  .ml-bar{ display:flex; align-items:center; gap:8px; margin-bottom:10px; }
  .ml-count{ flex:1; font-size:11px; color:#6f8199; font-family:'Orbitron',sans-serif; letter-spacing:.1em; text-transform:uppercase; }
  .ml-row{ background:#101826; border:1px solid #1e2a3c; border-radius:12px; margin-bottom:6px; overflow:hidden; }
  .ml-row.unread{ border-color:#2c4a6e; background:linear-gradient(180deg,#12203a,#101826); }
  .ml-r-head{ display:flex; align-items:center; gap:10px; padding:11px 12px; cursor:pointer; }
  .ml-ic{ font-size:17px; width:24px; text-align:center; flex:none; }
  .ml-r-m{ flex:1; min-width:0; }
  .ml-r-m b{ display:block; color:#e7f0fb; font-size:13px; font-weight:700; line-height:1.3; }
  .ml-r-m span{ font-size:10.5px; color:#6f8199; }
  .ml-dot{ width:8px; height:8px; border-radius:50%; background:#5db9ff; box-shadow:0 0 7px #5db9ff; flex:none; }
  .ml-chev{ color:#4a5c74; font-size:11px; flex:none; }
  .ml-r-body{ padding:0 12px 12px 46px; }
  .ml-r-body p{ font-size:12.5px; color:#a9bacd; line-height:1.55; }
  .ml-r-body p b{ color:#e7f0fb; }
  .ml-fleet{ margin-top:10px; background:#0c1320; border:1px solid #263850; border-radius:11px; padding:10px 12px; }
  .ml-f-h{ font-family:'Orbitron',sans-serif; font-size:9px; letter-spacing:.14em; color:#ff8f9c; margin-bottom:7px; }
  .ml-f-top{ display:flex; align-items:center; gap:10px; }
  .ml-f-flag{ width:56px; height:38px; object-fit:contain; flex:none; background:#0a0f18; border:1px solid #223048; border-radius:8px; padding:3px; }
  .ml-f-m{ min-width:0; }
  .ml-f-m b{ display:block; color:#e7f0fb; font-size:13px; }
  .ml-f-m span{ font-size:11px; color:#7e91a9; }
  .ml-f-stats{ display:flex; flex-wrap:wrap; gap:6px 14px; margin-top:8px; font-size:11px; color:#8fa3bd; }
  .ml-f-stats b{ color:#ffd24d; }
  .ml-f-esc{ display:flex; gap:5px; margin-top:8px; }
  .ml-f-esc img{ width:38px; height:26px; object-fit:contain; background:#0a0f18; border:1px solid #1d2a40; border-radius:6px; padding:2px; }
  .ml-cta{ display:block; width:100%; margin-top:10px; font-family:'Orbitron',sans-serif; font-weight:800; font-size:12px; letter-spacing:.06em; color:#0b1220; background:linear-gradient(180deg,#ffd24d,#e8960f); border:none; border-radius:10px; padding:11px; cursor:pointer; box-shadow:0 4px 14px -6px rgba(242,178,75,.7); }
  .ml-cta:active{ transform:scale(.97); }
  .store-cat.has-n::after{ content:attr(data-n); position:absolute; top:2px; right:calc(50% - 22px); min-width:14px; height:14px; padding:0 3px; border-radius:8px; background:#ff5a7a; color:#fff; font-size:9px; font-weight:800; line-height:14px; box-shadow:0 0 6px rgba(255,90,122,.6); }
    /* mail action buttons — blue glow, unmistakably tappable */
  .ml-act{ color:#8fc4ff !important; border:1px solid rgba(95,168,255,.65) !important; background:linear-gradient(180deg,rgba(47,109,216,.30),rgba(21,48,94,.34)) !important;
    box-shadow:0 0 12px -2px rgba(95,168,255,.65), inset 0 1px 0 rgba(140,190,255,.25) !important;
    font-weight:800 !important; letter-spacing:.05em; text-shadow:0 0 8px rgba(95,168,255,.55);
    animation:mlActGlow 2.4s ease-in-out infinite; }
  .ml-act:active{ transform:scale(.95); }
  .ml-act:disabled{ animation:none; opacity:.4; box-shadow:none !important; text-shadow:none; }
  @keyframes mlActGlow{ 0%,100%{ box-shadow:0 0 10px -3px rgba(95,168,255,.55), inset 0 1px 0 rgba(140,190,255,.25); } 50%{ box-shadow:0 0 16px -1px rgba(95,168,255,.9), inset 0 1px 0 rgba(140,190,255,.35); } }
  @media (prefers-reduced-motion:reduce){ .ml-act{ animation:none; } }
  .ml-claim{ display:block; width:100%; margin-top:9px; border:none; border-radius:10px; padding:12px; cursor:pointer;
    font-family:'Orbitron',sans-serif; font-weight:800; font-size:11px; letter-spacing:.1em; color:#231302;
    background:linear-gradient(180deg,#ffd24d,#e09a2d); box-shadow:0 0 14px -2px rgba(255,210,77,.8); animation:msnClaimPulse 1.8s ease-in-out infinite; }
  .ml-claim:active{ transform:scale(.97); }
  .ml-claimed{ margin-top:9px; text-align:center; font-family:'Orbitron',sans-serif; font-weight:800; font-size:10px; letter-spacing:.08em;
    color:#7ce0a0; border:1px solid rgba(89,217,140,.5); border-radius:10px; padding:9px; }
  /* Collect all — the button glows while prizes are waiting */
  .ml-act.ml-hot{ color:#231302 !important; border-color:transparent !important;
    background:linear-gradient(180deg,#ffd24d,#e09a2d) !important; box-shadow:0 0 14px -2px rgba(255,210,77,.85); }
  /* the haul receipt: 'safe center' + scroll, so a tall card on a short or
     landscape viewport can never push its CTA past the fold (the #login bug) */
  .mlh-back{ position:fixed; inset:0; z-index:120; display:grid; align-content:safe center; justify-items:center; overflow-y:auto; padding:22px;
    background:rgba(5,8,14,.72); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); animation:mlhIn .18s ease; }
  @keyframes mlhIn{ from{ opacity:0 } to{ opacity:1 } }
  .mlh-card{ width:100%; max-width:330px; border-radius:18px; padding:20px 18px 16px; text-align:center;
    background:linear-gradient(180deg,#1a2333,#111827); border:1px solid #3d4d68;
    box-shadow:0 24px 60px -20px rgba(0,0,0,.85); animation:mlhUp .26s cubic-bezier(.22,1,.36,1); }
  @keyframes mlhUp{ from{ transform:translateY(14px) scale(.97); opacity:0 } to{ transform:none; opacity:1 } }
  .mlh-ic{ font-size:34px; line-height:1; filter:drop-shadow(0 0 14px rgba(255,210,77,.7)); }
  .mlh-h{ font-family:'Orbitron',sans-serif; font-weight:900; font-size:13px; letter-spacing:.14em; color:#ffd9a0; margin-top:8px; }
  .mlh-sub{ font-size:11px; color:#8d9cb2; margin-top:5px; }
  .mlh-rows{ display:flex; flex-direction:column; gap:7px; margin:15px 0 4px; }
  .mlh-row{ display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:11px;
    background:rgba(255,255,255,.04); border:1px solid #2a3650; }
  .mlh-g{ flex:none; width:20px; font-size:15px; font-weight:800; text-align:center; }
  .mlh-n{ flex:1; min-width:0; text-align:left; font-size:12px; color:#c3cfdd; }
  .mlh-v{ font-family:'Rajdhani',sans-serif; font-weight:800; font-size:15px; font-variant-numeric:tabular-nums; }
  .mlh-err{ margin-top:9px; font-size:11px; color:#ff8a98; }
  .mlh-ok{ width:100%; margin-top:13px; border:0; border-radius:12px; padding:14px; cursor:pointer;
    font-family:'Orbitron',sans-serif; font-weight:800; font-size:12px; letter-spacing:.12em; color:#231302;
    background:linear-gradient(180deg,#ffd24d,#e09a2d); box-shadow:0 8px 22px -8px rgba(255,210,77,.9); }
  .mlh-ok:active{ transform:scale(.98); }
`;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
})();
