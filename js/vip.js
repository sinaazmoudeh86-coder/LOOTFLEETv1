/* =============================================================================
   vip.js — LOOTFLEET VIP PROGRAM
   ---------------------------------------------------------------------------
   VIP score = ⚜ VIP POINTS: 50 per $1 purchased (LC packs, Pro), event medals
   (Voidmaw daily 🥇100 · 🥈50 · 🥉25 · ranked 10), and ✦ Event Store exchange.
   Levels 1–5 are reachable through steady play; the top is a whale ladder.
   Levels scale like mobile-game VIP: exponential thresholds, permanent account
   perks. Badge lives INSIDE the ship-score pill (+ PRO chip when subscribed);
   tapping it opens the VIP sheet: current level, progress bar, per-level perks.
   Perk hooks exposed as window.VIP.mult(kind): 'gold' | 'xp' | 'afk'.
   ============================================================================= */
(function () {
  'use strict';
  const G = () => window.GAME;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => { try { return G().formatNum(Math.floor(n)); } catch (e) { return Math.floor(n).toLocaleString(); } };

  // ---- levels: threshold = cumulative VIP score needed --------------------
  // ⚜ points ladder: a week of medals ≈ VIP 1-2; a season of daily play ≈ 3-5;
  // beyond that it's purchases (50/$) or elite placements. VIP 15 ≈ $20k spend.
  const LV = [
    { n: 0,  need: 0 },
    { n: 1,  need: 100 },
    { n: 2,  need: 300 },
    { n: 3,  need: 750 },
    { n: 4,  need: 1500 },
    { n: 5,  need: 3000 },
    { n: 6,  need: 6000 },
    { n: 7,  need: 12000 },
    { n: 8,  need: 25000 },
    { n: 9,  need: 50000 },
    { n: 10, need: 100000 },
    { n: 11, need: 175000 },
    { n: 12, need: 300000 },
    { n: 13, need: 500000 },
    { n: 14, need: 750000 },
    { n: 15, need: 1000000 },
  ];
  // cumulative perks per level (each row = what THIS level adds)
  const PERKS = {
    1:  ['+2% gold from your empire (AFK, waves, events)', '+5 Galaxy citadel cap (every VIP level adds +5)'],
    2:  ['+2% XP from kills'],
    3:  ['+3% gold', '+5% AFK production (Moon + Home Citadel)'],
    4:  ['+3% XP', '+5% AFK production'],
    5:  ['+5% gold', '+5% AFK production'],
    6:  ['+5% XP', 'Offline earnings cap +2h'],
    7:  ['+5% gold (empire & waves)', '+5% AFK production'],
    8:  ['+5% XP', '+10% AFK production', '+2% ◈ Prism yield'],
    9:  ['+8% gold', 'Offline earnings cap +2h', '+2% ◈ Prism yield (4% total)'],
    10: ['+8% XP', '+10% AFK production', '+2% ◈ Prism yield (6% total)', '⚜ Gold VIP badge'],
    11: ['+10% gold', '+2% ◈ Prism yield (8% total)'],
    12: ['+10% XP', '+15% AFK production', '+2% ◈ Prism yield (10% total)'],
    13: ['+12% gold', 'Offline earnings cap +4h', '+2% ◈ Prism yield (12% total)'],
    14: ['+12% XP', '+15% AFK production', '+2% ◈ Prism yield (14% total)'],
    15: ['+15% gold & XP', '+20% AFK production', '+2% ◈ Prism yield (16% total)', '⚜ Prismatic badge'],
  };
  // rolled-up multipliers by level (precomputed from PERKS wording)
  const GOLD = [0, 2, 2, 5, 5, 10, 10, 15, 15, 23, 31, 41, 41, 53, 53, 68];
  const XP   = [0, 0, 2, 2, 5, 5, 10, 10, 15, 15, 23, 23, 33, 33, 45, 60];
  const AFK  = [0, 0, 0, 5, 10, 15, 15, 20, 30, 30, 40, 40, 55, 55, 70, 90];

  function score() {
    const g = G(); if (!g || !g.state) return 0;
    return g.state.vipPts | 0;
  }
  // grant ⚜ points from anywhere (purchases, event medals, store exchange)
  function grant(n, why) {
    const g = G(); if (!g || !g.state || !(n > 0)) return 0;
    const before = level();
    g.state.vipPts = (g.state.vipPts | 0) + Math.round(n);
    try { g.save(); } catch (e) {}
    try { if (window.UI && window.UI.unlockToast) window.UI.unlockToast('⚜ +' + Math.round(n) + ' VIP points' + (why ? ' — ' + why : '')); } catch (e) {}
    const after = level();
    if (after > before) setTimeout(() => { try { window.UI.unlockToast('⚜ VIP LEVEL ' + after + ' REACHED — new perks active'); } catch (e) {} }, 900);
    ensureBadge();
    try { if (window.UI && window.UI.refreshAll) window.UI.refreshAll(); } catch (e) {}   // live-update cap readouts (citadel cap etc.)
    return after - before;
  }
  function track() {}   // (legacy hook — points are granted explicitly now)
  function level() {
    const s = score();
    let lv = 0;
    for (const r of LV) if (s >= r.need) lv = r.n;
    return lv;
  }
  function mult(kind) {
    const lv = level();
    const t = kind === 'gold' ? GOLD : kind === 'xp' ? XP : kind === 'afk' ? AFK : null;
    return t ? 1 + (t[Math.min(lv, 15)] || 0) / 100 : 1;
  }

  // ---- badge in the ship-score pill ----------------------------------------
  function ensureBadge() {
    const pbl = document.querySelector('.pb-label');
    if (!pbl || !pbl.parentElement) return;
    let b = $('vip-badge');
    if (!b) {
      b = document.createElement('span');
      b.id = 'vip-badge';
      b.addEventListener('click', (e) => { e.stopPropagation(); openSheet(); });
      pbl.parentElement.insertBefore(b, pbl.nextSibling);
    }
    const lv = level();
    const pro = (() => { try { return G().state.proUntil > Date.now(); } catch (e) { return false; } })();
    const cls = 'vip-b' + (lv >= 15 ? ' prism' : lv >= 10 ? ' gold' : '') + (pro ? ' haspro' : '');
    const html = '<i>VIP ' + lv + '</i>' + (pro ? '<em>PRO</em>' : '');
    if (b.className !== cls) b.className = cls;
    if (b._h !== html) { b.innerHTML = html; b._h = html; }
  }

  // ---- VIP sheet ------------------------------------------------------------
  let _m;
  function close() { if (_m) { _m.remove(); _m = null; } }
  function openSheet() {
    close();
    const lv = level(), s = score();
    const cur = LV[lv], next = LV[lv + 1] || null;
    const pct = next ? Math.min(100, (s - cur.need) / (next.need - cur.need) * 100) : 100;
    const rows = LV.slice(1).map((r) => {
      const got = lv >= r.n;
      return '<div class="vipm-row' + (got ? ' got' : '') + (r.n === lv + 1 ? ' next' : '') + '">' +
        '<span class="vipm-lv">' + (got ? '✓' : '') + ' VIP ' + r.n + '</span>' +
        '<span class="vipm-need">' + fmt(r.need) + '</span>' +
        '<span class="vipm-perks">' + (PERKS[r.n] || []).join(' · ') + '</span></div>';
    }).join('');
    _m = document.createElement('div');
    _m.className = 'vip-modal';
    _m.innerHTML = '<div class="vipm-back"></div><div class="vipm-card">' +
      '<div class="vipm-kicker">LOOTFLEET VIP</div>' +
      '<div class="vipm-title">VIP ' + lv + '</div>' +
      '<div class="vipm-sub"><b>⚜ VIP points</b>: <b>50 per $1</b> on any purchase · <b>event medals</b> (daily 🥇100 · 🥈50 · 🥉25 · ranked 10) · <b>✦ Event Store</b> exchange. Points never decrease; perks are permanent.</div>' +
      '<div class="vipm-score">⚜ ' + fmt(s) + ' VIP points</div>' +
      (next ? '<div class="vipm-bar"><i style="width:' + pct + '%"></i><span>' + fmt(next.need - s) + ' to VIP ' + (lv + 1) + '</span></div>'
            : '<div class="vipm-bar"><i style="width:100%"></i><span>MAX LEVEL</span></div>') +
      '<div class="vipm-now">Active now: <b>+' + (GOLD[Math.min(lv, 15)] || 0) + '% gold · +' + (XP[Math.min(lv, 15)] || 0) + '% XP · +' + (AFK[Math.min(lv, 15)] || 0) + '% AFK' + (lv > 7 ? ' · +' + (lv - 7) * 2 + '% ◈ Prism' : '') + ' · ⛓ citadel cap ' + (window.GAME && window.GAME.citadelCap ? window.GAME.citadelCap() : 50 + lv * 5) + (lv > 0 ? ' (+' + lv * 5 + ')' : '') + '</b></div>' +
      '<div class="vipm-list">' + rows + '</div>' +
      '<button class="vipm-ok" id="vipm-ok">Keep earning</button></div>';
    ($('app') || document.body).appendChild(_m);
    _m.querySelector('.vipm-back').addEventListener('click', close);
    _m.querySelector('#vipm-ok').addEventListener('click', close);
  }

  function boot() {
    injectCSS();
    setInterval(() => { try { track(); ensureBadge(); } catch (e) {} }, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 900));
  else setTimeout(boot, 900);
  window.VIP = { level, score, mult, grant, openSheet };

  function injectCSS() {
    if ($('vip-css')) return;
    const el = document.createElement('style'); el.id = 'vip-css';
    el.textContent = `
#vip-badge{ display:inline-flex; align-items:center; gap:4px; margin-left:6px; cursor:pointer; vertical-align:middle; pointer-events:auto; }
#vip-badge i{ font-style:normal; font-family:'Orbitron',sans-serif; font-weight:800; font-size:8.5px; letter-spacing:.06em; color:#0a1020;
  background:linear-gradient(180deg,#9fd0ff,#4a86d8); border-radius:7px; padding:2px 6px; box-shadow:0 0 8px -2px #5b9cff; }
#vip-badge.gold i{ background:linear-gradient(180deg,#ffe1a6,#e8960f); box-shadow:0 0 10px -2px #ffd24d; }
#vip-badge.prism i{ background:linear-gradient(115deg,#ff9ae8,#9ae8ff,#c6ff9a); box-shadow:0 0 12px -2px #d8b4ff; }
#vip-badge em{ font-style:normal; font-family:'Orbitron',sans-serif; font-weight:800; font-size:8.5px; letter-spacing:.06em; color:#1c1206;
  background:linear-gradient(180deg,#ffd24d,#e8960f); border-radius:7px; padding:2px 6px; box-shadow:0 0 8px -2px #ffd24d; }
.vip-modal{ position:absolute; inset:0; z-index:64; display:grid; place-items:center; padding:18px; }
.vipm-back{ position:absolute; inset:0; background:rgba(5,8,14,.82); backdrop-filter:blur(7px); -webkit-backdrop-filter:blur(7px); }
.vipm-card{ position:relative; max-width:360px; width:100%; max-height:calc(100% - 28px); overflow-y:auto; background:linear-gradient(180deg,#141b28,#0c111c);
  border:1px solid #2c3a52; border-radius:18px; padding:20px 18px; box-shadow:0 24px 60px rgba(0,0,0,.7), 0 0 40px -14px #5b9cff; }
.vipm-kicker{ font-family:'Rajdhani',sans-serif; font-weight:800; font-size:10px; letter-spacing:.16em; color:#7fb1ff; text-align:center; }
.vipm-title{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:24px; color:#fff; text-align:center; margin:4px 0 4px; text-shadow:0 0 18px #5b9cff; }
.vipm-sub{ font-family:'Rajdhani',sans-serif; font-weight:600; font-size:12.5px; color:#b8c4d8; text-align:center; line-height:1.5; }
.vipm-sub b{ color:#e8f0ff; }
.vipm-score{ font-family:'Rajdhani',sans-serif; font-weight:800; font-size:14px; color:#ffd24d; text-align:center; margin:8px 0 6px; }
.vipm-bar{ position:relative; height:16px; border-radius:9px; background:#0b1322; border:1px solid #2c3a52; overflow:hidden; margin-bottom:8px; }
.vipm-bar i{ display:block; height:100%; background:linear-gradient(90deg,#2f6dd8,#7fb1ff); }
.vipm-bar span{ position:absolute; inset:0; display:grid; place-items:center; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:10px; color:#eaf2ff; text-shadow:0 1px 3px #000; }
.vipm-now{ font-family:'Rajdhani',sans-serif; font-weight:700; font-size:12px; color:#a5f2c4; text-align:center; margin-bottom:10px; }
.vipm-now b{ color:#d9ffe8; }
.vipm-list{ display:flex; flex-direction:column; gap:4px; }
.vipm-row{ display:grid; grid-template-columns:64px 74px 1fr; gap:8px; align-items:baseline; padding:6px 8px; border-radius:9px; background:#0d1526; border:1px solid #1d2a44; }
.vipm-row.got{ opacity:.55; }
.vipm-row.next{ border-color:#5b9cff88; box-shadow:0 0 10px -4px #5b9cff; }
.vipm-lv{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:9.5px; color:#9fc4ff; }
.vipm-need{ font-family:'Rajdhani',sans-serif; font-weight:800; font-size:11px; color:#ffd24d; }
.vipm-perks{ font-family:'Rajdhani',sans-serif; font-weight:600; font-size:11.5px; color:#c4d2ea; line-height:1.35; }
.vipm-ok{ width:100%; margin-top:12px; background:linear-gradient(180deg,#7fb1ff,#2f6dd8); color:#081020; border:none; border-radius:12px; padding:12px;
  font-family:'Rajdhani',sans-serif; font-weight:800; font-size:14px; cursor:pointer; box-shadow:0 8px 22px -8px #5b9cff; }
`;
    document.head.appendChild(el);
  }
})();
