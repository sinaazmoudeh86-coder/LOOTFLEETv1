/* =============================================================================
   achievements.js — LIFETIME COMMENDATIONS (Command ▸ Missions ▸ Badges tab)
   ---------------------------------------------------------------------------
   EXACTLY 1,000 badges: 15 career chains, each a geometric ladder of rank
   targets (counts sum to 1000). Every chain climbs 10 GRADES — Bronze → Steel
   → Silver → Gold → Platinum → Diamond → Master → Grandmaster → Celestial →
   Titan — each grade = 10% of the chain's ranks. Early ranks are quick wins;
   the ladder tops out at multi-year scale. Claiming pays LootCoins per grade
   and CLAIM sweeps every earned rank in one tap.
   THE PRIZE: claim ALL 1,000 badges → the TITAN SINA is granted on the spot.
   Renders inside the Missions screen via window.ACHIEVE.html()/bind().
============================================================================= */
(function () {
  'use strict';
  const Gm = () => window.GAME;
  const S = () => Gm().state;
  const fmt = (n) => { try { return Gm().formatNum(Math.floor(n)); } catch (e) { return Math.floor(n) + ''; } };

  // ---- 10 GRADES (each = 10% of a chain's ranks) + LC paid per rank ---------
  const GRADES = [
    { name: 'BRONZE',      col: '#cd8a4a', lc: 1 },
    { name: 'STEEL',       col: '#8fa2b8', lc: 3 },
    { name: 'SILVER',      col: '#dbe4ef', lc: 6 },
    { name: 'GOLD',        col: '#ffd24d', lc: 12 },
    { name: 'PLATINUM',    col: '#a8ecff', lc: 25 },
    { name: 'DIAMOND',     col: '#6fd2ff', lc: 50 },
    { name: 'MASTER',      col: '#b08cff', lc: 100 },
    { name: 'GRANDMASTER', col: '#ff8ad0', lc: 200 },
    { name: 'CELESTIAL',   col: '#c77bff', lc: 400 },
    { name: 'TITAN',       col: '#ff5a68', lc: 800 },
  ];

  // ---- lifetime stat readers ------------------------------------------------
  const life = (k) => (S().lifeStats && S().lifeStats[k]) || 0;
  function hullLevelSum() { const sl = S().shipLevels || {}; let t = 0; for (const k in sl) t += sl[k] || 0; return t; }
  function moonLifetimeSum() { const lt = (S().moon && S().moon.lifetime) || {}; let t = 0; for (const k in lt) t += lt[k] || 0; return t; }
  function colonyLevelSum() { const root = S().moon; if (!root || !root.moons) return 0; let t = 0; root.moons.forEach((mm) => { const b = mm.b || {}; for (const k in b) t += (b[k] && b[k].lv) || 0; }); return t; }

  // ---- CHAINS — rank counts SUM TO EXACTLY 1000 ------------------------------
  // t targets are geometric ladders: start × growth^i (strictly increasing).
  const genT = (start, g, n) => { const t = []; let prev = 0; for (let i = 0; i < n; i++) { let v = Math.round(start * Math.pow(g, i)); if (v <= prev) v = prev + 1; t.push(v); prev = v; } return t; };
  const CHAINS = [
    { id: 'kills',  ic: '⌖', name: 'Shipbreaker',        unit: 'ships destroyed',          n: 100, t: genT(50, 1.35, 100),   v: () => S().totalKills || 0 },
    { id: 'gold',   ic: '$', name: 'Golden Armada',      unit: 'gold earned',              n: 120, t: genT(1e4, 1.45, 120),  v: () => life('gold') },
    { id: 'fuel',   ic: '⬢', name: 'Fuel Magnate',       unit: 'fuel scavenged',           n: 80,  t: genT(200, 1.42, 80),   v: () => life('fuel') },
    { id: 'iron',   ic: '◆', name: 'Ironclad',           unit: 'iron scavenged',           n: 80,  t: genT(150, 1.42, 80),   v: () => life('iron') },
    { id: 'plasma', ic: '✦', name: 'Plasma Sovereign',   unit: 'plasma scavenged',         n: 80,  t: genT(100, 1.42, 80),   v: () => life('plasma') },
    { id: 'moon',   ic: '☾', name: 'Lunar Baron',        unit: 'colony resources shipped', n: 90,  t: genT(5e3, 1.5, 90),    v: moonLifetimeSum },
    { id: 'loot',   ic: '⬡', name: 'Scavenger King',     unit: 'loot collected',           n: 80,  t: genT(25, 1.2, 80),     v: () => (S().lifetimeLooted || 0) + (S().inventory || []).length },
    { id: 'boss',   ic: '♛', name: "Warlord's Bane",     unit: 'bosses destroyed',         n: 70,  t: genT(3, 1.18, 70),     v: () => Math.max((S().stats && S().stats.bossKills) || 0, life('boss')) },
    { id: 'mins',   ic: '◷', name: 'Iron Endurance',     unit: 'minutes in combat',        n: 60,  t: genT(30, 1.18, 60),    v: () => (S().playTime || 0) / 60 },
    { id: 'msn',    ic: '⌘', name: 'Order of the Crest', unit: 'missions completed',       n: 60,  t: genT(5, 1.15, 60),     v: () => S().lifetimeMissions | 0 },
    { id: 'tiles',  ic: '⚑', name: 'Galactic Conqueror', unit: 'galaxy tiles captured',    n: 60,  t: genT(1, 1.16, 60),     v: () => life('tiles') },
    { id: 'hulls',  ic: '⚙', name: 'Fleet Admiral',      unit: 'hull levels bought',       n: 50,  t: genT(3, 1.15, 50),     v: hullLevelSum },
    { id: 'colony', ic: '⛏', name: 'Master Builder',     unit: 'structure levels built',   n: 40,  t: genT(2, 1.17, 40),     v: colonyLevelSum },
    { id: 'level',  ic: '▲', name: 'Ascendant',          unit: 'account level',            n: 20,  t: genT(5, 1.32, 20),     v: () => S().level || 1 },
    { id: 'zone',   ic: '⌬', name: 'Frontier Legend',    unit: 'zones unlocked',           n: 10,  t: genT(3, 1.45, 10),     v: () => S().highestUnlocked || 1 },
  ];
  const TOTAL = CHAINS.reduce((a, c) => a + c.n, 0); // = 1000
  const gradeIdx = (ch, rank) => Math.min(9, Math.floor((rank - 1) / (ch.n / 10))); // rank is 1-based
  const gradeOf = (ch, rank) => GRADES[gradeIdx(ch, rank)];

  function ensure() {
    const s = S();
    if (!s.achieve) s.achieve = { claimed: {}, seen: {} };
    if (!s.achieve.claimed) s.achieve.claimed = {};
    if (!s.achieve.seen) s.achieve.seen = {};
    return s.achieve;
  }
  function rankEarned(ch) { const v = ch.v(); let e = 0; while (e < ch.n && v >= ch.t[e]) e++; return e; }
  function claimable() {
    if (!window.GAME || !GAME.state) return 0;
    const a = ensure(); let n = 0;
    CHAINS.forEach((ch) => { n += Math.max(0, rankEarned(ch) - (a.claimed[ch.id] || 0)); });
    return n;
  }
  const totalClaimed = () => { const a = ensure(); let n = 0; CHAINS.forEach((ch) => { n += Math.min(ch.n, a.claimed[ch.id] || 0); }); return n; };
  // 1s poll (driven by missions.js tick) — one toast per chain when new ranks land
  function tick() {
    const a = ensure(); let hit = false;
    CHAINS.forEach((ch) => {
      const e = rankEarned(ch), seen = a.seen[ch.id] || 0;
      if (e > seen) {
        const gained = e - seen;
        a.seen[ch.id] = e; hit = true;
        const g = gradeOf(ch, e);
        const tl = document.getElementById('toast-layer');
        if (tl) {
          const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = g.col;
          t.innerHTML = '⬡ ' + (gained > 1 ? gained + ' BADGES' : 'BADGE') + ' EARNED — ' + ch.name.toUpperCase() +
            '<br><span style="font-size:13px">' + g.name + ' · rank ' + e + '/' + ch.n + ' · claim on the Badges board</span>';
          tl.appendChild(t); setTimeout(() => t.remove(), 3800);
        }
      }
    });
    if (hit) { Gm().save(); if (window.MISSIONS) window.MISSIONS.syncBadge(); }
  }

  const badge = (ch, rank, earned, cls) => {
    const gi = gradeIdx(ch, rank), g = GRADES[gi];
    return '<div class="ach-medal ' + (cls || '') + (earned ? ' earned' : ' dim') + ' grd' + gi + '" style="--c:' + g.col + '">' +
      '<div class="ach-hex"><i>' + ch.ic + '</i><em>' + rank + '</em></div></div>';
  };

  // ---- ★ TITAN SINA — the 1,000-badge capstone ------------------------------
  function sinaBanner() {
    const owned = !!(S().ownedShips && S().ownedShips.titansina);
    const have = totalClaimed();
    const left = TOTAL - have;
    const ready = !owned && left <= 0;
    let right;
    if (owned) right = '<div class="vrd-owned" style="color:#ff8a96;border-color:rgba(255,90,104,.5)">✓ IN YOUR HANGAR</div>';
    else if (ready) right = '<button class="msn-claim gold" data-sina-accept="1" style="font-size:11px;padding:11px 14px">★ ACCEPT SHIP</button>';
    else right = '<div class="vrd-count" style="color:#ffb4bb"><b>' + left.toLocaleString() + '</b><span>badges to go</span></div>';
    return '<div class="ach-sina' + (ready ? ' ready' : '') + (owned ? ' owned' : '') + '">' +
      '<div class="vrd-art"><img src="ships/ship-titansina.png" alt="Titan Sina" decoding="async"></div>' +
      '<div class="vrd-mid">' +
        '<div class="vrd-t" style="color:#ffdfe2">THE TITAN SINA <em style="background:linear-gradient(90deg,#ff8a96,#ff5a68);color:#2a060a">1,000-BADGE PRIZE</em></div>' +
        '<div class="vrd-s" style="color:#c4a6ab">Claim <b style="color:#ffdfe2">all 1,000 lifetime badges</b> to be granted the FINAL-CLASS hull — full-spectrum gatling tracers, 128 drones, range across the entire zone.</div>' +
        '<div class="vrd-bar" style="border-color:rgba(255,90,104,.35);background:#1a0d10"><i style="width:' + (have / TOTAL * 100) + '%;background:linear-gradient(90deg,#8a2f3a,#ff5a68);box-shadow:0 0 10px rgba(255,90,104,.6)"></i><span>★ ' + have.toLocaleString() + ' / ' + TOTAL.toLocaleString() + ' badges claimed</span></div>' +
      '</div>' + right + '</div>';
  }
  function acceptSina() {
    if (S().ownedShips && S().ownedShips.titansina) return;
    if (totalClaimed() < TOTAL) return;
    if (Gm().grantShip) Gm().grantShip('titansina');
    Gm().save();
    const tl = document.getElementById('toast-layer');
    if (tl) {
      const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#ff8a96'; t.style.fontSize = '24px';
      t.innerHTML = '★ TITAN SINA GRANTED<br><span style="font-size:12px;color:#ffd9dd">1,000 badges — the final-class hull is yours. Equip it in the Hangar.</span>';
      tl.appendChild(t); setTimeout(() => t.remove(), 4600);
    }
    if (window.UI) window.UI.refreshAll();
    if (window.MISSIONS) window.MISSIONS.render();
  }

  function html() {
    const a = ensure();
    const claimedN = totalClaimed();
    let out = '<div class="msn-head-card"><div class="mh-l"><div class="mh-t">LIFETIME COMMENDATIONS <span class="mh-tier">' + claimedN.toLocaleString() + ' / 1,000</span></div>' +
      '<div class="mh-s"><b>1,000 badges</b> across 15 career chains · 10 grades: <b>Bronze → Titan</b></div>' +
      '<div class="mh-s">The full ladder is a multi-year voyage — the Titan Sina waits at the end.</div>' +
      '</div><div class="mh-ring" style="--p:' + (claimedN / TOTAL * 360) + 'deg"><span>' + claimedN + '<i>/1000</i></span></div></div>';
    out += sinaBanner();
    // badge shelf — the highest claimed badge of each chain
    const shelf = [];
    CHAINS.forEach((ch) => { const c = a.claimed[ch.id] || 0; if (c > 0) shelf.push(badge(ch, c, true, 'mini')); });
    out += '<div class="ach-shelf">' + (shelf.length ? shelf.join('') : '<span class="ach-shelf-hint">Your badge case is empty — claim your first commendation below.</span>') + '</div>';
    CHAINS.forEach((ch) => {
      const e = rankEarned(ch), c = Math.min(ch.n, a.claimed[ch.id] || 0), v = ch.v();
      const mastered = c >= ch.n;
      const readyN = Math.max(0, e - c);
      const show = mastered ? ch.n : Math.min(ch.n, (readyN ? c + 1 : c + 1)); // next claimable / next target
      const g = gradeOf(ch, show);
      const prev = show > 1 ? ch.t[show - 2] : 0, tgt = ch.t[show - 1];
      const pct = mastered ? 100 : Math.min(100, Math.max(0, (v - prev) / Math.max(1, tgt - prev) * 100));
      // 10 grade pips — lit when every rank in that grade is claimed
      const per = ch.n / 10;
      const pips = GRADES.map((gr, i) => '<i class="ach-pip' + (c >= (i + 1) * per ? ' on' : '') + '" style="--c:' + gr.col + '"></i>').join('');
      let lcSum = 0; for (let r = c + 1; r <= e; r++) lcSum += GRADES[gradeIdx(ch, r)].lc;
      out += '<div class="msn-card ach-card' + (readyN ? ' ready' : '') + (mastered ? ' mastered' : '') + '">' +
        badge(ch, show, readyN > 0 || mastered) +
        '<div class="msn-mid"><div class="msn-n">' + ch.name + ' <span class="ach-rk" style="--c:' + g.col + '">' + g.name + ' · ' + Math.min(show, ch.n) + '/' + ch.n + '</span></div>' +
        '<div class="msn-b">' + (mastered ? '<b style="color:#ff5a68">CHAIN MASTERED</b> — all ' + ch.n + ' badges claimed' : fmt(Math.min(v, tgt)) + ' / ' + fmt(tgt) + ' ' + ch.unit) + '</div>' +
        '<div class="msn-bar"><i style="width:' + pct + '%;background:linear-gradient(90deg,#3f8cff,' + g.col + ')"></i></div>' +
        '<div class="ach-pips">' + pips + '</div></div>' +
        (readyN ? '<button class="msn-claim" data-ach="' + ch.id + '">CLAIM ×' + readyN + '<br>+' + fmt(lcSum) + ' ◉</button>' : mastered ? '<div class="msn-done" style="color:#ff5a68;border-color:#ff5a6888">★</div>' : '') +
        '</div>';
    });
    return out;
  }
  function bind(body) {
    body.querySelectorAll('[data-ach]').forEach((b) => b.addEventListener('click', () => {
      const ch = CHAINS.find((c) => c.id === b.dataset.ach); if (!ch) return;
      const a = ensure(); const c = Math.min(ch.n, a.claimed[ch.id] || 0);
      const e = rankEarned(ch); if (e <= c) return;
      let lcSum = 0; for (let r = c + 1; r <= e; r++) lcSum += GRADES[gradeIdx(ch, r)].lc;
      a.claimed[ch.id] = e;
      const G = Gm();
      if (G.addCredits) G.addCredits(lcSum); else G.state.credits = (G.state.credits || 0) + lcSum;
      G.save();
      const g = gradeOf(ch, e);
      const tl = document.getElementById('toast-layer');
      if (tl) {
        const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = g.col;
        t.innerHTML = '⬡ ' + ch.name.toUpperCase() + ' · ' + (e - c) + ' BADGE' + (e - c > 1 ? 'S' : '') + ' CLAIMED<br><span style="font-size:13px">' + g.name + ' · rank ' + e + '/' + ch.n + ' · +' + fmt(lcSum) + ' ◉ LootCoins</span>';
        tl.appendChild(t); setTimeout(() => t.remove(), 3400);
      }
      if (window.UI) window.UI.refreshAll();
      if (window.MISSIONS) { window.MISSIONS.render(); window.MISSIONS.syncBadge(); }
    }));
    const sb = body.querySelector('[data-sina-accept]');
    if (sb) sb.addEventListener('click', acceptSina);
  }
  window.ACHIEVE = { tick, html, bind, claimable };

  const CSS = `
  .ach-shelf{ display:flex; flex-wrap:wrap; gap:7px; align-items:center; background:linear-gradient(180deg,#10182a,#0b1120);
    border:1px solid #263650; border-radius:13px; padding:10px 12px; margin-bottom:12px; min-height:44px; }
  .ach-shelf-hint{ font-size:10.5px; color:#6c8098; }
  .ach-medal{ flex:none; filter:drop-shadow(0 0 7px color-mix(in srgb, var(--c) 55%, transparent)); }
  .ach-medal.dim{ filter:grayscale(.85) brightness(.6); opacity:.6; }
  .ach-hex{ width:52px; height:58px; clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);
    background:radial-gradient(130% 130% at 50% 0%, color-mix(in srgb, var(--c) 62%, #0d1420), #0d1220 78%);
    display:grid; place-items:center; align-content:center; gap:0; position:relative; }
  .ach-hex::before{ content:''; position:absolute; inset:2.5px; clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);
    background:linear-gradient(165deg, rgba(255,255,255,.16), transparent 45%); pointer-events:none; }
  .ach-hex i{ font-style:normal; font-size:19px; line-height:1; color:#fff; text-shadow:0 0 8px var(--c), 0 1px 2px #000; }
  .ach-hex em{ font-style:normal; font-family:'Orbitron',sans-serif; font-weight:800; font-size:8px; letter-spacing:.08em; color:color-mix(in srgb, var(--c) 75%, #fff); margin-top:2px; }
  .ach-medal.mini .ach-hex{ width:30px; height:34px; }
  .ach-medal.mini .ach-hex i{ font-size:12px; }
  .ach-medal.mini .ach-hex em{ font-size:5.5px; margin-top:1px; }
  .ach-medal.grd8.earned .ach-hex{ background:linear-gradient(135deg,#5a2d8f,#c77bff 45%,#7bd4ff 80%); background-size:220% 220%; animation:achShimmer 3.2s ease-in-out infinite; }
  .ach-medal.grd9.earned .ach-hex{ background:linear-gradient(135deg,#7a1420,#ff5a68 40%,#ffb45a 70%,#ff5a68 100%); background-size:220% 220%; animation:achShimmer 2.6s ease-in-out infinite; }
  @keyframes achShimmer{ 0%,100%{ background-position:0% 0%; } 50%{ background-position:100% 100%; } }
  .ach-card.ready{ border-color:rgba(255,210,77,.55); }
  .ach-card.mastered{ border-color:rgba(255,90,104,.5); box-shadow:0 0 14px -5px rgba(255,90,104,.5); }
  .ach-rk{ display:inline-block; margin-left:6px; padding:1.5px 7px; border-radius:7px; font-size:8.5px; letter-spacing:.1em; font-family:'Orbitron',sans-serif;
    color:var(--c); background:color-mix(in srgb, var(--c) 12%, transparent); border:1px solid color-mix(in srgb, var(--c) 40%, transparent); vertical-align:1px; }
  .ach-pips{ display:flex; gap:5px; margin-top:6px; }
  .ach-pip{ width:9px; height:9px; border-radius:50%; background:rgba(120,150,200,.15); border:1px solid rgba(120,150,200,.3); }
  .ach-pip.on{ background:var(--c); border-color:var(--c); box-shadow:0 0 6px color-mix(in srgb, var(--c) 70%, transparent); }
  .ach-card .msn-claim{ line-height:1.35; text-align:center; }
  .ach-sina{ display:flex; align-items:center; gap:12px; background:linear-gradient(115deg,#1f0d12,#160b10 60%,#10121f); border:1.5px solid rgba(255,90,104,.45);
    border-radius:14px; padding:12px; margin:0 0 12px; position:relative; overflow:hidden; }
  .ach-sina.ready{ border-color:rgba(255,180,190,.9); box-shadow:0 0 22px -5px rgba(255,90,104,.65); }
  .ach-sina.owned{ opacity:.78; }
  .ach-sina .vrd-art img{ position:static; width:100%; height:100%; max-width:none; object-fit:contain; transform:none; filter:drop-shadow(0 0 12px rgba(255,90,104,.75)); }
  @media (prefers-reduced-motion: reduce){ .ach-medal.grd8.earned .ach-hex,.ach-medal.grd9.earned .ach-hex{ animation:none; } }
  `;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
})();
