/* =============================================================================
   ascension.js — SHIP ASCENSION (Command ▸ Ascension)
   -----------------------------------------------------------------------------
   Per-ship, high-risk enhancement system and the game's largest long-term
   resource sink.

     • Every OWNED hull has four permanent modules:
         Combat Computer   → +0.5% XP per kill / level
         Targeting Matrix  → +1% attack range / level
         Reactor Core      → +1% attack speed / level
         Hull Optimization → +3% hull HP & +0.15 damage reduction / level (DR cap +20)
     • Each module climbs +1…+5. Completing +5 earns a STAR and resets to +1.
       Five stars advance the module's TIER:
       Common → Uncommon → Rare → Epic → Legendary → Mythic → Prismatic.
     • Every attempt costs Gold + a Galaxy Resource and rolls a published
       success chance. FAILURE resets the module to +1 of the CURRENT star —
       stars and tiers are never lost.
     • Bonuses apply while FLYING that hull. Hooks: GAME computeStats reads
       ASCEND.combatMods(shipKey); gainXp reads ASCEND.xpMult().

   State: GAME.state.ascension[shipKey][modId] = { t, s, l } (tier, stars, level)
   ========================================================================== */
(function () {
  'use strict';
  const G = () => window.GAME;
  const C = () => window.CONFIG;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function fmt(n) { try { return G().formatNum(Math.floor(n)); } catch (e) { return Math.floor(n) + ''; } }

  // ---- TIERS ---------------------------------------------------------------
  const TIERS = [
    { name: 'Common',     c: '#c3cfdd' },
    { name: 'Uncommon',   c: '#57d68b' },
    { name: 'Rare',       c: '#4fa8ff' },
    { name: 'Epic',       c: '#b06bff' },
    { name: 'Legendary',  c: '#ff9e3d' },
    { name: 'Mythic',     c: '#ff4d5e' },
    { name: 'Prismatic',  c: '#7df3ff', prism: true },
  ];
  const MAX_TIER = TIERS.length - 1; // 6

  // ---- MODULES ---------------------------------------------------------------
  const MODS = [
    { id: 'cc', name: 'Combat Computer', res: 'plasma',
      tip: 'Boosts every XP source while flying this hull. +0.5% XP per completed level — stacks with Pro and Pilot Tree bonuses.',
      bonus: (st) => '+' + (st * 0.5) + '% XP per kill',
      next:  (st) => '+' + ((st + 1) * 0.5) + '%',
      icon: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 9h6v6H9zM12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.5 2.5M16.5 16.5L19 19M19 5l-2.5 2.5M7.5 16.5L5 19"/>' },
    { id: 'tm', name: 'Targeting Matrix', res: 'iron',
      tip: 'Extends your weapons\u2019 engagement radius — open fire before enemies close in. +1% attack range per level.',
      bonus: (st) => '+' + st + '% attack range',
      next:  (st) => '+' + (st + 1) + '%',
      icon: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.6"/><path d="M12 2v4.5M12 17.5V22M2 12h4.5M17.5 12H22"/>' },
    { id: 'rc', name: 'Reactor Core', res: 'fuel',
      tip: 'Overclocks every hardpoint on the hull. +1% attack speed per level — multiplies your whole DPS.',
      bonus: (st) => '+' + st + '% attack speed',
      next:  (st) => '+' + (st + 1) + '%',
      icon: '<circle cx="12" cy="12" r="2.4"/><ellipse cx="12" cy="12" rx="9" ry="3.8"/><ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(120 12 12)"/>' },
    { id: 'ho', name: 'Storm Conduit', res: 'iron', storm: true,
      tip: 'Charges the hull with void lightning. Every SECOND in combat there\u2019s a chance (not per shot — per second) a massive bolt drops from the sky for several seconds\u2019 worth of your DPS, then CHAINS through nearly every ship on screen, losing 15% power per arc. A rolled strike is never wasted — if the map is empty it waits for the next ship. Minimum 1.5%/sec once charged.',
      bonus: (st) => st <= 0 ? 'dormant — no charge yet'
        : '⚡ ' + Math.max(1.5, st * 0.08).toFixed(2) + '%/sec · ' + (3 + st * 0.06).toFixed(1) + '× DPS bolt · ' + (14 + Math.floor(st / 10)) + ' arcs',
      next:  (st) => '⚡ ' + Math.max(1.5, (st + 1) * 0.08).toFixed(2) + '%/sec',
      icon: '<path d="M13 2L5 13h5l-1 9 8-11h-5z"/>' },
  ];
  const RES = {
    gold:   { glyph: '●', c: '#f2b24b', name: 'Gold' },
    fuel:   { glyph: '⬢', c: '#5bc0ff', name: 'Fuel' },
    iron:   { glyph: '◆', c: '#d0a060', name: 'Iron' },
    plasma: { glyph: '✦', c: '#c07bff', name: 'Plasma' },
  };

  // ---- STATE -----------------------------------------------------------------
  function modState(shipKey, modId) {
    const st = G().state;
    if (!st.ascension) st.ascension = {};
    if (!st.ascension[shipKey]) st.ascension[shipKey] = {};
    if (!st.ascension[shipKey][modId]) st.ascension[shipKey][modId] = { t: 0, s: 0, l: 1 };
    return st.ascension[shipKey][modId];
  }
  // peek without creating (safe for combat hooks)
  function peek(shipKey, modId) {
    const a = G().state.ascension;
    return (a && a[shipKey] && a[shipKey][modId]) || { t: 0, s: 0, l: 1 };
  }
  function steps(m) { return m.t * 25 + m.s * 5 + (m.l - 1); }   // completed levels
  function isMaxed(m) { return m.t >= MAX_TIER && m.s >= 5; }

  // ---- COMBAT HOOKS (read by game-v93.js) ------------------------------------
  function combatMods(shipKey) {
    try {
      const rc = steps(peek(shipKey, 'rc')), tm = steps(peek(shipKey, 'tm'));
      return { atkSpeedPct: rc, rangePct: tm };
    } catch (e) { return {}; }
  }
  // STORM CONDUIT numbers — chance is % PER SECOND of combat (not per attack).
  // Floor of 0.3%/sec once charged so the show is actually witnessed early.
  function storm(shipKey) {
    try {
      const st = steps(peek(shipKey, 'ho'));
      if (st <= 0) return null;
      return { chance: Math.max(1.5, st * 0.08), mult: 3 + st * 0.06, chains: 14 + Math.floor(st / 10) };
    } catch (e) { return null; }
  }
  function xpMult() {
    try { return 1 + steps(peek(G().state.ship, 'cc')) * 0.5 / 100; } catch (e) { return 1; }
  }

  // ---- SUCCESS CHANCE (published) ---------------------------------------------
  // Base by level within the star, softened by star count and tier depth.
  // Generous through the first 3 stars of every tier — the grind starts at ★★4.
  const BASE = [100, 90, 75, 55, 40];
  const BASE_EASY = [100, 100, 95, 90, 85];   // stars 0-2: near-guaranteed climb
  function chance(m) {
    if (m.s < 3) {
      const raw = BASE_EASY[m.l - 1] * (1 - m.t * 0.04);
      return clamp(Math.round(raw), 40, 100);
    }
    const raw = BASE[m.l - 1] * (1 - m.s * 0.05) * (1 - m.t * 0.08);
    return clamp(Math.round(raw), 5, 100);
  }

  // ---- COST -------------------------------------------------------------------
  // Exponential sink (×10 economy pass): ship factor × tier jump × in-tier growth. Resource = gold/100.
  // LATE-STAR WALL (Jul 2026): past the first 3 stars of a tier, cost jumps ×5
  // per additional star — ★★★★ costs 5×, ★★★★★ costs 25× the ★★★ price.
  function shipF(key) { const s = C().SHIP_BY_KEY[key]; return 1 + (((s && s.tier) || 1) - 1) * 0.55; }
  function cost(shipKey, m) {
    const lateStars = Math.max(0, m.s - 3);
    const gold = Math.round(1000000 * shipF(shipKey) * Math.pow(2.6, m.t) * Math.pow(1.045, m.s * 5 + m.l - 1) * Math.pow(5, lateStars));
    return { gold, res: Math.max(10000, Math.round(gold / 100)) };
  }
  function bank(res) {
    const st = G().state;
    return res === 'gold' ? (st.gold || 0) : ((st.resources || {})[res] || 0);
  }
  function canAfford(shipKey, mod, m) { const c = cost(shipKey, m); return bank('gold') >= c.gold && bank(mod.res) >= c.res; }
  function spend(shipKey, mod, m) {
    const c = cost(shipKey, m), st = G().state;
    st.gold -= c.gold;
    st.resources = st.resources || { fuel: 0, iron: 0, plasma: 0 };
    st.resources[mod.res] -= c.res;
  }

  // ---- PRESTIGE ---------------------------------------------------------------
  function modScore(m) { return m.t * 250 + m.s * 50 + (m.l - 1) * 10; }
  function shipScore(key) { return MODS.reduce((a, md) => a + modScore(peek(key, md.id)), 0); }
  function shipTierIdx(key) { return Math.min(...MODS.map((md) => peek(key, md.id).t)); } // weakest module gates the hull's tier
  function shipStars(key) { return MODS.reduce((a, md) => { const m = peek(key, md.id); return a + m.t * 5 + m.s; }, 0); }
  function totalScore() { try { return Object.keys(G().state.ownedShips || {}).reduce((a, k) => a + shipScore(k), 0); } catch (e) { return 0; } }

  // ===========================================================================
  // RENDER
  // ===========================================================================
  let sel = null;
  function ownedList() { return C().SHIPS.filter((s) => G().state.ownedShips[s.key]); }

  function render() {
    const body = $('ascend-body'); if (!body) return;
    const ships = ownedList();
    if (!sel || !G().state.ownedShips[sel]) sel = G().state.ship;
    const sub = $('ascend-sub');
    if (sub) sub.textContent = 'Upgrade Score ' + fmt(totalScore());
    body.innerHTML =
      '<div class="asc-strip">' + ships.map(stripCard).join('') + '</div>' +
      dashboard(sel);
    wire(body);
  }

  function stripCard(s) {
    const t = TIERS[shipTierIdx(s.key)];
    return '<button class="asc-chip' + (s.key === sel ? ' on' : '') + '" data-sel="' + s.key + '" style="--tc:' + t.c + '">' +
      '<img src="ships/ship-' + s.key + '.png" alt="">' +
      '<span class="asc-chip-n">' + s.name + '</span>' +
      '<span class="asc-chip-t">' + t.name + '</span>' +
    '</button>';
  }

  function dashboard(key) {
    const s = C().SHIP_BY_KEY[key]; if (!s) return '';
    const tIdx = shipTierIdx(key), t = TIERS[tIdx];
    const active = G().state.ship === key;
    const stars = shipStars(key), starMax = MODS.length * 35;
    const power = active ? fmt(G().score()) : '—';
    return '<div class="asc-dash' + (t.prism ? ' prism' : '') + '" id="asc-dash" style="--tc:' + t.c + '" data-comment-anchor="asc-dash">' +
      '<div class="asc-hero">' +
        '<div class="asc-hero-img"><img src="ships/ship-' + key + '.png" alt=""></div>' +
        '<div class="asc-hero-info">' +
          '<div class="asc-hero-name">' + s.name + '</div>' +
          '<div class="asc-hero-cls">' + (s.cls || 'Hull') + ' class</div>' +
          '<div class="asc-hero-badges">' +
            '<span class="asc-tierbadge">' + t.name.toUpperCase() + '</span>' +
            '<span class="asc-stat">★ ' + stars + '<i>/' + starMax + '</i></span>' +
            '<span class="asc-stat">SCORE ' + fmt(shipScore(key)) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="asc-power"><span>FLEET POWER</span><b>' + power + '</b></div>' +
      '</div>' +
      (active
        ? '<div class="asc-note on">◉ ACTIVE HULL — ascension bonuses are live</div>'
        : '<div class="asc-note">Bonuses apply while flying this hull <button class="asc-fly" data-fly="' + key + '">FLY IT</button></div>') +
      '<div class="asc-grid">' + MODS.map((md) => modPanel(key, md)).join('') + '</div>' +
    '</div>';
  }

  function modPanel(key, md) {
    const m = peek(key, md.id), t = TIERS[m.t], st = steps(m);
    const maxed = isMaxed(m);
    const c = cost(key, m), ch = chance(m);
    const afford = canAfford(key, md, m);
    const chCls = ch >= 75 ? 'hi' : ch >= 40 ? 'mid' : 'lo';
    const starsHtml = Array.from({ length: 5 }, (_, i) => '<i class="' + (i < m.s ? 'full' : '') + '">★</i>').join('');
    const pips = Array.from({ length: 5 }, (_, i) => '<i class="' + (i < m.l ? 'on' : '') + '"></i>').join('');
    return '<div class="asc-mod' + (t.prism ? ' prism' : '') + '" id="mod-' + md.id + '" style="--tc:' + t.c + '">' +
      '<div class="asc-mod-head">' +
        '<span class="asc-hex"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + md.icon + '</svg></span>' +
        '<div class="asc-mod-t">' +
          '<div class="asc-mod-n">' + md.name + '</div>' +
          '<div class="asc-mod-tier">' + t.name + ' · <b>+' + m.l + '</b></div>' +
        '</div>' +
        '<div class="asc-stars">' + starsHtml + '</div>' +
      '</div>' +
      '<div class="asc-pips">' + pips + '</div>' +
      '<div class="asc-bonus"><span>NOW</span> ' + md.bonus(st) + (maxed ? '' : ' <span class="asc-arrow">→</span> <b>' + md.next(st) + '</b>') + '</div>' +
      '<div class="asc-tip">' + md.tip + '</div>' +
      (maxed
        ? '<div class="asc-maxed">✦ PRISMATIC · FULLY ASCENDED</div>'
        : '<div class="asc-roll">' +
            '<div class="asc-chance ' + chCls + '"><span>SUCCESS</span><b>' + ch + '%</b><div class="asc-chbar"><i style="width:' + ch + '%"></i></div></div>' +
            '<div class="asc-btns col">' +
              ascBtn(key, md, c, 1, 'ASCEND') + ascBtn(key, md, c, 10, '×10') + ascBtn(key, md, c, 100, '×100') +
            '</div>' +
            '<div class="asc-fail-note">×10/×100 show the FULL batch cost (≈ — each roll priced live) · rolls stop at star-up, tier-up or when broke · Fail → resets to +1 of this star</div>' +
          '</div>') +
    '</div>';
  }

  // one ascend button row — the FULL price of the batch sits right on the button
  function ascBtn(key, md, c, n, lbl) {
    const g = c.gold * n, r = c.res * n;
    const okG = bank('gold') >= g, okR = bank(md.res) >= r;
    const afford1 = bank('gold') >= c.gold && bank(md.res) >= c.res;
    return '<button class="asc-btn row' + (n > 1 ? ' alt' : '') + '" data-asc="' + key + ':' + md.id + ':' + n + '"' + (afford1 ? '' : ' disabled') + '>' +
      '<span class="ab-n">' + lbl + '</span>' +
      '<span class="ab-cost">' + (n > 1 ? '<i>≈</i>' : '') +
        '<em style="color:' + RES.gold.c + '"' + (okG ? '' : ' class="short"') + '>● ' + fmt(g) + '</em>' +
        '<em style="color:' + RES[md.res].c + '"' + (okR ? '' : ' class="short"') + '>' + RES[md.res].glyph + ' ' + fmt(r) + '</em></span></button>';
  }

  function wire(body) {
    body.querySelectorAll('[data-sel]').forEach((b) => b.onclick = () => { sel = b.dataset.sel; render(); });
    body.querySelectorAll('[data-fly]').forEach((b) => b.onclick = () => { try { G().switchShip(b.dataset.fly); } catch (e) {} render(); });
    body.querySelectorAll('[data-asc]').forEach((b) => b.onclick = () => {
      const [key, modId, n] = b.dataset.asc.split(':');
      attempt(key, modId, parseInt(n) || 1);
    });
  }

  // ===========================================================================
  // ATTEMPT
  // ===========================================================================
  let busy = false;
  function attempt(key, modId, count) {
    if (busy) return;
    const md = MODS.find((x) => x.id === modId), m = modState(key, modId);
    if (!md || isMaxed(m) || !canAfford(key, md, m)) return;
    busy = true;
    let wins = 0, fails = 0, earnedStar = false, earnedTier = false;
    for (let i = 0; i < count; i++) {
      if (isMaxed(m) || !canAfford(key, md, m)) break;
      spend(key, md, m);
      const ok = Math.random() * 100 < chance(m);
      if (ok) {
        wins++; m.l++;
        if (m.l > 5) {                       // star complete
          m.l = 1; m.s++; earnedStar = true;
          if (m.s >= 5) {                    // five stars → tier up
            if (m.t < MAX_TIER) { m.t++; m.s = 0; earnedTier = true; }
            else { m.s = 5; }                // fully ascended
            break;                           // tier-up (or max) always ends the batch
          }
          if (count > 1) break;              // ×10 stops at a star — a milestone worth seeing
        }
      } else {
        fails++; m.l = 1;                    // failure: back to +1 of the CURRENT star
      }
    }
    try { G().refreshStats(); G().save(); } catch (e) {}
    if (window.UI && window.UI.refreshAll) window.UI.refreshAll();
    // resolve → charge flicker on the module, then inline verdict (no popup);
    // tier-ups still get the full cinematic
    const panel = $('mod-' + modId);
    if (panel) panel.classList.add('charging');
    setTimeout(() => {
      busy = false;
      if (earnedTier) { showTierUp(key, md, m); return; }
      render();
      const total = wins + fails;
      if (total > 1) {
        flashText(modId, wins >= fails,
          (earnedStar ? '★ STAR · ' : '') + wins + ' WIN / ' + fails + ' FAIL' + (earnedStar ? '' : ' · +' + m.l));
      } else {
        flashText(modId, wins > 0, wins > 0 ? (earnedStar ? '★ STAR EARNED' : 'SUCCESS · +' + m.l) : 'FAILED · BACK TO +1');
      }
    }, 420);
  }

  // inline flash on the module panel — green SUCCESS / red FAILED, no click needed
  function flashText(modId, ok, text) {
    const panel = $('mod-' + modId); if (!panel) return;
    panel.classList.add(ok ? 'flash-ok' : 'flash-no');
    const tag = document.createElement('div');
    tag.className = 'asc-flash ' + (ok ? 'ok' : 'no');
    tag.textContent = text;
    panel.appendChild(tag);
    if (!ok) { const d = $('asc-dash'); if (d) { d.classList.add('shake'); setTimeout(() => d.classList.remove('shake'), 500); } }
    setTimeout(() => { tag.remove(); panel.classList.remove('flash-ok', 'flash-no'); }, 1300);
  }

  function overlay() {
    let o = $('asc-overlay');
    if (!o) { o = document.createElement('div'); o.id = 'asc-overlay'; ($('screen-ascend') || document.body).appendChild(o); }
    return o;
  }
  function closeOverlay() { const o = $('asc-overlay'); if (o) { o.classList.remove('show'); o.innerHTML = ''; } render(); }

  // TIER-UP CINEMATIC — ship surges into its new color
  function showTierUp(key, md, m) {
    const s = C().SHIP_BY_KEY[key], t = TIERS[m.t];
    const o = overlay(); o.className = 'show';
    o.innerHTML =
      '<div class="asc-cine" style="--tc:' + t.c + '">' +
        '<div class="asc-cine-rings"><i></i><i></i><i></i></div>' +
        '<div class="asc-cine-ship"><img src="ships/ship-' + key + '.png" alt=""></div>' +
        '<div class="asc-cine-k">MODULE TIER ASCENDED</div>' +
        '<div class="asc-cine-name">' + md.name + '</div>' +
        '<div class="asc-cine-tier' + (t.prism ? ' prism' : '') + '">' + t.name.toUpperCase() + '</div>' +
        '<div class="asc-cine-ship-n">' + s.name + '</div>' +
        '<button class="asc-v-btn">GLORIOUS</button>' +
      '</div>';
    o.querySelector('.asc-v-btn').onclick = closeOverlay;
  }

  // ---- BOOT ------------------------------------------------------------------
  function boot() { injectCSS(); }
  function injectCSS() {
    if ($('asc-css')) return;
    const s = document.createElement('style'); s.id = 'asc-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  window.ASCEND = { render, combatMods, storm, xpMult, totalScore, shipScore };

  const CSS = `
  .mega-card.cmd-ascend .mc-ic{ color:#b06bff; border-color:rgba(176,107,255,.5); background:radial-gradient(120% 120% at 50% 0%,#241238,#0e1420); box-shadow:0 0 14px -3px rgba(176,107,255,.7); }
  .mega-card.cmd-ascend .mc-n{ color:#e6d4ff; }
  .mega-card.cmd-ascend::before{ background:linear-gradient(130deg,#b06bff,#ff4d5e,#7df3ff,#b06bff); background-size:250% 250%; }
  #screen-ascend .scr-title{ color:#b06bff; }
  #ascend-body{ padding:12px; }

  /* ship strip */
  .asc-strip{ display:flex; gap:8px; overflow-x:auto; padding:2px 2px 10px; margin-bottom:4px; scrollbar-width:thin; }
  .asc-chip{ flex:none; width:86px; border:1px solid #223245; border-radius:12px; padding:8px 6px; cursor:pointer; text-align:center;
    background:linear-gradient(180deg,#0e1725,#0b1220); display:flex; flex-direction:column; align-items:center; gap:3px; transition:border-color .15s, box-shadow .15s; }
  .asc-chip img{ width:36px; height:36px; object-fit:contain; }
  .asc-chip-n{ font-family:'Orbitron',sans-serif; font-weight:700; font-size:8.5px; color:#dbe8f5; letter-spacing:.02em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
  .asc-chip-t{ font-size:8px; font-weight:800; letter-spacing:.08em; color:var(--tc); text-transform:uppercase; }
  .asc-chip.on{ border-color:var(--tc); box-shadow:0 0 14px -4px var(--tc); }

  /* dashboard */
  .asc-dash{ border:1px solid color-mix(in srgb,var(--tc) 45%,#223245); border-radius:16px; padding:13px; position:relative; overflow:hidden;
    background:linear-gradient(180deg, color-mix(in srgb,var(--tc) 7%,#0e1725), #0a101c); }
  .asc-dash::after{ content:''; position:absolute; inset:0 0 auto 0; height:2px; background:linear-gradient(90deg,transparent,var(--tc),transparent); opacity:.7; pointer-events:none; }
  .asc-dash.shake{ animation:ascShake .45s; }
  @keyframes ascShake{ 0%,100%{ transform:translateX(0);} 20%{ transform:translateX(-7px);} 40%{ transform:translateX(6px);} 60%{ transform:translateX(-4px);} 80%{ transform:translateX(3px);} }
  .asc-hero{ display:flex; gap:12px; align-items:center; }
  .asc-hero-img{ width:74px; height:74px; flex:none; display:grid; place-items:center; border-radius:14px;
    background:radial-gradient(70% 70% at 50% 40%, color-mix(in srgb,var(--tc) 22%,transparent), transparent); }
  .asc-hero-img img{ width:64px; height:64px; object-fit:contain; filter:drop-shadow(0 0 10px color-mix(in srgb,var(--tc) 60%,transparent)); }
  .asc-hero-info{ flex:1; min-width:0; }
  .asc-hero-name{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:15px; color:#f2f7ff; letter-spacing:.03em; }
  .asc-hero-cls{ font-size:10.5px; font-weight:700; color:#8ba0b5; letter-spacing:.06em; margin-top:2px; }
  .asc-hero-badges{ display:flex; gap:6px; flex-wrap:wrap; margin-top:7px; }
  .asc-tierbadge{ font-family:'Orbitron',sans-serif; font-size:8.5px; font-weight:800; letter-spacing:.12em; color:#08131c;
    background:linear-gradient(180deg, color-mix(in srgb,var(--tc) 80%,#fff), var(--tc)); border-radius:7px; padding:3px 8px; }
  .asc-stat{ font-size:9.5px; font-weight:800; letter-spacing:.05em; color:#c9d8e8; border:1px solid #2b4055; border-radius:7px; padding:3px 7px; font-variant-numeric:tabular-nums; }
  .asc-stat i{ font-style:normal; color:#71859a; }
  .asc-power{ flex:none; text-align:right; }
  .asc-power span{ display:block; font-size:8px; font-weight:800; letter-spacing:.14em; color:#7f92a6; }
  .asc-power b{ font-family:'Orbitron',sans-serif; font-size:16px; color:var(--tc); font-variant-numeric:tabular-nums; }
  .asc-note{ margin-top:11px; font-size:10.5px; font-weight:700; color:#8ba0b5; border:1px dashed #2b4055; border-radius:9px; padding:7px 10px; display:flex; align-items:center; gap:8px; justify-content:center; }
  .asc-note.on{ color:#7ce0a0; border-color:rgba(124,224,160,.45); border-style:solid; }
  .asc-fly{ border:1px solid var(--tc); background:color-mix(in srgb,var(--tc) 14%,transparent); color:var(--tc); border-radius:7px; padding:4px 10px;
    font-family:'Orbitron',sans-serif; font-weight:800; font-size:9px; letter-spacing:.08em; cursor:pointer; }

  /* module grid */
  .asc-grid{ display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:10px; margin-top:12px; }
  .asc-mod{ border:1px solid color-mix(in srgb,var(--tc) 50%,#223245); border-radius:14px; padding:12px; position:relative;
    background:linear-gradient(180deg, color-mix(in srgb,var(--tc) 9%,#0d1420), #0a0f1a); box-shadow:0 0 16px -10px var(--tc); }
  .asc-mod.charging{ animation:ascCharge .42s ease-in-out; }
  @keyframes ascCharge{ 0%,100%{ box-shadow:0 0 16px -10px var(--tc);} 50%{ box-shadow:0 0 26px -2px var(--tc); } }
  .asc-mod{ transition:border-color .2s, box-shadow .2s; }
  .asc-mod.flash-ok{ border-color:#7ce0a0; box-shadow:0 0 22px -4px rgba(124,224,160,.9); animation:ascBlinkOk .5s; }
  .asc-mod.flash-no{ border-color:#ff5a68; box-shadow:0 0 22px -4px rgba(255,90,104,.9); animation:ascBlinkNo .5s; }
  @keyframes ascBlinkOk{ 0%,60%{ background:rgba(124,224,160,.16);} 100%{ background:transparent; } }
  @keyframes ascBlinkNo{ 0%,60%{ background:rgba(255,90,104,.16);} 100%{ background:transparent; } }
  .asc-flash{ position:absolute; left:50%; top:8px; transform:translateX(-50%); pointer-events:none; z-index:3; white-space:nowrap;
    font-family:'Orbitron',sans-serif; font-weight:900; font-size:11px; letter-spacing:.12em; padding:5px 12px; border-radius:9px;
    animation:ascFlashIn .25s cubic-bezier(.18,1.4,.4,1), ascFlashOut .3s 1s forwards; }
  .asc-flash.ok{ color:#08131c; background:linear-gradient(180deg,#9df0bb,#5fd68b); box-shadow:0 4px 16px -4px rgba(124,224,160,.9); }
  .asc-flash.no{ color:#fff; background:linear-gradient(180deg,#ff6b78,#e0374a); box-shadow:0 4px 16px -4px rgba(255,90,104,.9); }
  @keyframes ascFlashIn{ 0%{ transform:translateX(-50%) scale(.5); opacity:0;} 100%{ transform:translateX(-50%) scale(1); opacity:1;} }
  @keyframes ascFlashOut{ to{ opacity:0; transform:translateX(-50%) translateY(-6px); } }
  .asc-mod.prism, .asc-dash.prism{ animation:ascPrism 4s linear infinite; }
  @keyframes ascPrism{ 0%{ filter:hue-rotate(0deg);} 100%{ filter:hue-rotate(360deg);} }
  .asc-mod-head{ display:flex; gap:10px; align-items:center; }
  .asc-hex{ width:44px; height:48px; flex:none; display:grid; place-items:center; color:var(--tc);
    background:color-mix(in srgb,var(--tc) 13%,#0b1119); clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);
    filter:drop-shadow(0 0 6px color-mix(in srgb,var(--tc) 50%,transparent)); }
  .asc-hex svg{ width:24px; height:24px; }
  .asc-mod-t{ flex:1; min-width:0; }
  .asc-mod-n{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:11px; color:#eef4fc; letter-spacing:.03em; }
  .asc-mod-tier{ font-size:10px; font-weight:700; color:var(--tc); margin-top:2px; letter-spacing:.05em; }
  .asc-mod-tier b{ color:#fff; }
  .asc-stars{ flex:none; font-size:12px; letter-spacing:1px; }
  .asc-stars i{ font-style:normal; color:#26364c; }
  .asc-stars i.full{ color:var(--tc); text-shadow:0 0 6px color-mix(in srgb,var(--tc) 70%,transparent); }
  .asc-pips{ display:flex; gap:5px; margin-top:9px; }
  .asc-pips i{ flex:1; height:5px; border-radius:3px; background:#16202e; }
  .asc-pips i.on{ background:var(--tc); box-shadow:0 0 6px color-mix(in srgb,var(--tc) 60%,transparent); }
  .asc-bonus{ margin-top:9px; font-size:11px; font-weight:700; color:#dbe8f5; }
  .asc-bonus span{ font-size:8px; font-weight:800; letter-spacing:.12em; color:#7f92a6; margin-right:4px; }
  .asc-bonus b{ color:var(--tc); }
  .asc-tip{ margin-top:7px; font-size:10px; line-height:1.5; color:#8ba0b5; background:rgba(255,255,255,.03); border:1px dashed #26364c; border-radius:8px; padding:7px 9px; text-align:left; }
  .asc-arrow{ color:#71859a !important; font-size:11px !important; letter-spacing:0 !important; }
  .asc-maxed{ margin-top:10px; text-align:center; font-family:'Orbitron',sans-serif; font-size:10px; font-weight:800; letter-spacing:.1em; color:var(--tc); padding:9px; border:1px solid color-mix(in srgb,var(--tc) 55%,transparent); border-radius:10px; }
  .asc-roll{ margin-top:10px; }
  .asc-chance{ display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
  .asc-chance span{ font-size:8px; font-weight:800; letter-spacing:.12em; color:#7f92a6; }
  .asc-chance b{ font-family:'Orbitron',sans-serif; font-size:13px; font-variant-numeric:tabular-nums; }
  .asc-chance.hi b{ color:#7ce0a0; } .asc-chance.mid b{ color:#ffd24d; } .asc-chance.lo b{ color:#ff6b78; }
  .asc-chbar{ flex-basis:100%; height:5px; border-radius:3px; background:#101a26; overflow:hidden; }
  .asc-chbar i{ display:block; height:100%; border-radius:3px; }
  .asc-chance.hi .asc-chbar i{ background:#7ce0a0; } .asc-chance.mid .asc-chbar i{ background:#ffd24d; } .asc-chance.lo .asc-chbar i{ background:#ff6b78; }
  .asc-cost{ display:flex; gap:10px; margin-top:8px; font-size:11px; font-weight:700; font-variant-numeric:tabular-nums; }
  .asc-btns.col{ display:flex; flex-direction:column; gap:6px; margin-top:9px; }
  .asc-btn.row{ display:flex; justify-content:space-between; align-items:center; gap:10px; width:100%; border:none; border-radius:10px; padding:10px 12px; cursor:pointer;
    font-family:'Orbitron',sans-serif; font-weight:800; letter-spacing:.1em; color:#08131c;
    background:linear-gradient(180deg, color-mix(in srgb,var(--tc) 85%,#fff), var(--tc)); box-shadow:0 6px 18px -8px var(--tc); transition:transform .08s; }
  .asc-btn.row .ab-n{ font-size:11px; white-space:nowrap; }
  .asc-btn.row .ab-cost{ display:flex; align-items:center; gap:9px; font-family:'Rajdhani',sans-serif; font-size:11.5px; font-weight:800; font-variant-numeric:tabular-nums; }
  .asc-btn.row .ab-cost em{ font-style:normal; white-space:nowrap; }
  .asc-btn.row .ab-cost i{ font-style:normal; opacity:.7; }
  .asc-btn.row.alt{ color:#dfe9f5; background:color-mix(in srgb,var(--tc) 12%,#0b1119); border:1px solid color-mix(in srgb,var(--tc) 60%,transparent); box-shadow:none; }
  .asc-btn.row.alt .ab-n{ color:var(--tc); }
  .asc-btn.row .ab-cost em{ text-shadow:0 1px 2px rgba(0,0,0,.45); }
  .asc-btn.row .ab-cost em.short{ color:#ff6b78 !important; font-weight:800; }
  .asc-btn:active{ transform:scale(.97); }
  .asc-btn.row:disabled{ opacity:1; cursor:default; color:#9db0c3; background:color-mix(in srgb,var(--tc) 8%,#0b1119); border:1px solid color-mix(in srgb,var(--tc) 35%,#223245); box-shadow:none; }
  .asc-btn.row:disabled .ab-n{ color:var(--tc); opacity:.75; }
  .asc-fail-note{ margin-top:6px; text-align:center; font-size:8.5px; color:#66798d; letter-spacing:.04em; }

  /* overlay */
  #asc-overlay{ position:absolute; inset:0; z-index:14; display:none; align-items:center; justify-content:center; padding:18px;
    background:rgba(6,10,17,.85); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); }
  #asc-overlay.show{ display:flex; }
  .asc-verdict{ text-align:center; max-width:300px; width:100%; }
  .asc-v-banner{ font-family:'Orbitron',sans-serif; font-weight:900; font-size:30px; letter-spacing:.14em; animation:ascPop .4s cubic-bezier(.18,1.4,.4,1); }
  .asc-verdict.ok .asc-v-banner{ color:#7ce0a0; text-shadow:0 0 26px rgba(124,224,160,.6); }
  .asc-verdict.no .asc-v-banner{ color:#ff5a68; text-shadow:0 0 26px rgba(255,90,104,.6); }
  @keyframes ascPop{ 0%{ transform:scale(.4); opacity:0;} 100%{ transform:scale(1); opacity:1;} }
  .asc-v-star{ margin-top:8px; font-family:'Orbitron',sans-serif; font-weight:800; font-size:13px; color:var(--tc); letter-spacing:.1em; }
  .asc-v-mod{ margin-top:10px; font-size:13px; font-weight:700; color:#dbe8f5; }
  .asc-v-mod b{ color:#fff; }
  .asc-v-bonus{ margin-top:5px; font-size:12px; font-weight:800; color:var(--tc); }
  .asc-v-bonus.dim{ color:#8ba0b5; font-weight:700; }
  .asc-v-btn{ margin-top:18px; border:none; border-radius:11px; padding:12px 28px; cursor:pointer; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:14px; letter-spacing:.06em;
    color:#08111a; background:linear-gradient(180deg,#e8f2fb,#b9cee0); transition:transform .08s; }
  .asc-v-btn:active{ transform:scale(.97); }

  /* tier-up cinematic */
  .asc-cine{ text-align:center; position:relative; max-width:320px; }
  .asc-cine-rings i{ position:absolute; left:50%; top:64px; width:20px; height:20px; border-radius:50%; border:2px solid var(--tc);
    transform:translate(-50%,-50%); opacity:0; animation:ascRing 1.4s ease-out infinite; }
  .asc-cine-rings i:nth-child(2){ animation-delay:.45s; } .asc-cine-rings i:nth-child(3){ animation-delay:.9s; }
  @keyframes ascRing{ 0%{ transform:translate(-50%,-50%) scale(1); opacity:.8;} 100%{ transform:translate(-50%,-50%) scale(9); opacity:0;} }
  .asc-cine-ship{ position:relative; height:130px; display:grid; place-items:center; }
  .asc-cine-ship img{ width:110px; height:110px; object-fit:contain; filter:drop-shadow(0 0 24px var(--tc));
    animation:ascSpin 1.6s cubic-bezier(.3,.7,.3,1); }
  @keyframes ascSpin{ 0%{ transform:rotate(0) scale(.55); opacity:0;} 60%{ opacity:1;} 100%{ transform:rotate(360deg) scale(1); } }
  .asc-cine-k{ font-family:'Orbitron',sans-serif; font-size:9.5px; font-weight:800; letter-spacing:.22em; color:#9db6cb; margin-top:8px; }
  .asc-cine-name{ font-family:'Orbitron',sans-serif; font-size:15px; font-weight:800; color:#fff; margin-top:6px; letter-spacing:.04em; }
  .asc-cine-tier{ font-family:'Orbitron',sans-serif; font-size:24px; font-weight:900; letter-spacing:.16em; color:var(--tc);
    text-shadow:0 0 30px var(--tc); margin-top:4px; animation:ascPop .5s .3s cubic-bezier(.18,1.4,.4,1) backwards; }
  .asc-cine-tier.prism{ background:linear-gradient(90deg,#7df3ff,#b06bff,#ff9e3d,#7df3ff); background-size:300% 100%; -webkit-background-clip:text; background-clip:text; color:transparent; animation:ascPop .5s .3s backwards, ascPrismText 3s linear infinite; }
  @keyframes ascPrismText{ 0%{ background-position:0 0;} 100%{ background-position:300% 0;} }
  .asc-cine-ship-n{ font-size:11px; font-weight:700; color:#8ba0b5; margin-top:6px; letter-spacing:.08em; }

  @media (prefers-reduced-motion: reduce){
    .asc-dash.shake,.asc-mod.charging,.asc-mod.prism,.asc-dash.prism,.asc-v-banner,.asc-cine-rings i,.asc-cine-ship img,.asc-cine-tier,.asc-mod.flash-ok,.asc-mod.flash-no,.asc-flash{ animation:none !important; }
  }
  `;

  // ---- BOOT (must stay LAST) ------------------------------------------------
  // boot() reads the CSS const declared above it; calling it from the module body
  // hit the temporal dead zone and aborted the script before window exports ran,
  // so the screen silently painted nothing on a late parse. Keep this at the end.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
