/* =============================================================================
   void-zone.js — VOID ZONE (Command ▸ Void Zone) · 7 apex turf-war tiles
   ---------------------------------------------------------------------------
   Same conquest pipeline as My Galaxy (GAME.sysAt/warp/TERRITORY/clone sieges)
   — see VOID_TILES in game-v93.js. DESIGN (Jul 2026 redesign): the honeycomb
   shows CALM hexes — citadel art, name, holder, one status chip. Tapping a
   hex opens a DETAIL SHEET (galaxy-style) with the full intel: value/hr in
   all four currencies, entry toll, defender fleet + power, shield timer, and
   the action button. FLOWER honeycomb: 7 equal hexes, Lv 500 in the middle;
   one tile each at Lv 25/50/100/200/300/400/500.
============================================================================= */
(function () {
  'use strict';
  const G = () => window.GAME, S = () => window.SOCIAL, $ = (id) => document.getElementById(id);
  const fmt = (n) => { try { return G().formatNum(Math.floor(n)); } catch (e) { return String(Math.floor(n)); } };
  // flower: 2 / 3 / 2 — the crown (Lv 500, VZ7) sits dead center
  const ROWS = [['VZ1', 'VZ2'], ['VZ3', 'VZ7', 'VZ4'], ['VZ5', 'VZ6']];
  const ART = { 25: 'ships/void-cit-1.png', 50: 'ships/void-cit-1.png', 100: 'ships/void-cit-2.png', 200: 'ships/void-cit-2.png', 300: 'ships/void-cit-3.png', 400: 'ships/void-cit-3.png', 500: 'ships/void-cit-4.png' };
  // ART THAT FAILS TO LOAD MUST NOT LEAVE A BROKEN-IMAGE ICON (Aug 2026). Every
  // spire below the crown was rendering the browser's grey "?" placeholder — a
  // 200px box with a border, in the middle of the hex — because a missing or
  // blocked file on a bare <img> has no fallback at all. Two guards now:
  //   1. onerror retries the crown art (void-cit-4.png), which is the one file
  //      every report so far has loaded, then removes itself if that fails too.
  //      A hex with no art still reads correctly: level, name and status remain.
  //   2. no loading="lazy". All seven tiles are on screen at once in the flower,
  //      so deferral bought nothing and added a way for the fetch to be dropped.
  const CROWN_ART = ART[500];
  function artTag(cls, tier) {
    return '<img class="' + cls + '" src="' + (ART[tier] || CROWN_ART) + '" alt="" decoding="async"'
      + ' onerror="if(this.dataset.fb){this.remove();}else{this.dataset.fb=1;this.src=\'' + CROWN_ART + '\';}">';
  }
  const cdTxt = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h > 0 ? h + 'h ' + m + 'm' : m + 'm'; };
  const valChips = (vr) => '<em style="color:#f2a93c">$ ' + fmt(vr * 1000) + '</em><em style="color:#5bc0ff">⬢ ' + fmt(vr) + '</em><em style="color:#d0a060">◆ ' + fmt(vr) + '</em><em style="color:#c07bff">✦ ' + fmt(vr) + '</em>';
  const tollChips = (cost) => ['fuel', 'iron', 'plasma'].map((k) => cost[k]
    ? '<em style="color:' + ({ fuel: '#5bc0ff', iron: '#d0a060', plasma: '#c07bff' })[k] + '">' + ({ fuel: '⬢', iron: '◆', plasma: '✦' })[k] + ' ' + fmt(cost[k]) + '</em>' : '').join('');

  function tileCard(id) {
    const g = G(), inf = g.tileInfo(id); if (!inf) return '';
    const lvl = g.state.level | 0;
    const gated = lvl < inf.vtier;   // holds even for YOUR tiles — ascension resets level, not the gate
    const cls = inf.owned ? 'own' : inf.rival ? 'foe' : 'free';
    const cd = inf.cooldown | 0;
    const status = gated && inf.owned ? '<span class="vzc lock">★ YOURS · 🔒 LV ' + inf.vtier + '</span>'
      : gated ? '<span class="vzc lock">🔒 LOCKED</span>'
      : cd > 0 ? '<span class="vzc shield">🛡 ' + cdTxt(cd) + '</span>'
      : inf.owned ? '<span class="vzc ok">★ YOURS</span>'
      : inf.rival ? '<span class="vzc foe">⚑ ' + esc(inf.rival) + '</span>'
      : '<span class="vzc free">◇ OPEN</span>';
    return '<button class="vz-tile ' + cls + (inf.vtier === 500 ? ' crown' : '') + (gated ? ' gated' : '') + '" data-vzopen="' + id + '">' +
      artTag('vz-art', inf.vtier) +
      '<span class="vz-lv">LV ' + inf.vtier + '</span>' +
      '<span class="vz-name">' + inf.name + '</span>' +
      status + '</button>';
  }
  const esc = (s) => String(s || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  // ---- DETAIL SHEET — the full intel + the action --------------------------
  function openTile(id) {
    const g = G(), inf = g.tileInfo(id); if (!inf || !S()) return;
    const lvl = g.state.level | 0;
    const gated = lvl < inf.vtier;   // holds even for YOUR tiles — ascension resets level, not the gate
    const cd = inf.cooldown | 0;
    const vr = Math.round(inf.rate * 25);
    const cost = g.entryCostFor(id) || {};
    // holder fleet intel — same treatment as My Galaxy: sprites + hull + power
    const def = (!inf.owned && inf.rival && inf.defense) ? inf.defense
      : (inf.owned && g.defenseSnapshot ? g.defenseSnapshot() : null);
    const defName = def ? esc(def.name || def.nm || inf.rival || 'Fleet') : '';
    const holder = inf.owned ? '<b style="color:#ffd24d">★ YOU</b>' : inf.rival ? '<b style="color:#ff8a96">⚑ ' + esc(inf.rival) + '</b>' : '<b style="color:#8f7ab8">NEUTRAL — unclaimed</b>';
    const defRow = def ? '<div class="vzs-def"><span class="vzs-k">' + (inf.owned ? '⛨ YOUR GARRISON' : '⚔ DEFENDING FLEET — ' + defName) + '</span>' +
        '<div class="vzs-fleet">' +
        '<img class="f" src="ships/ship-' + def.ship + '.png" alt="" onerror="this.remove()">' +
        ((def.escKeys || []).slice(0, 4).map((k2) => '<img class="e" src="ships/ship-' + k2 + '.png" alt="" onerror="this.remove()">').join('')) +
        '<span class="vzs-pow"><i>POWER</i><b>⚡ ' + fmt(def.score || 0) + '</b></span></div>' +
        '<div class="vzs-fleethull">' + esc(def.nm || '') + (def.lvl ? ' · Lv ' + def.lvl : '') + (def.esc ? ' · +' + def.esc + ' escort' + (def.esc > 1 ? 's' : '') : '') + '</div>' +
        '<span class="vzs-hint">' + (inf.owned ? 'Published with your claim — attackers must beat this clone at this power' : 'This EXACT fleet holds the final wave at this power') + '</span></div>' : '';
    const vw = Math.max(6, Math.ceil(inf.vtier / 2));
    const objective = inf.owned ? 'Warp in to spar your own garrison — the tile keeps paying either way.'
      : inf.rival ? 'Break <b>' + vw + ' waves</b>, defeat the defender\u2019s clone fleet, then take their hold — the citadel and tile flip to you intact.'
      : 'Clear the <b>' + vw + '-wave siege</b> and the citadel is yours — included with the tile, no builds, no upgrades.';
    let act;
    if (gated) act = '<div class="vzs-blocked">🔒 Requires Level ' + inf.vtier + ' — you are Level ' + lvl
      + (inf.owned ? '<div style="margin-top:5px;font-size:10.5px;color:#8d7b62">Still yours — income keeps flowing. Ascension reset your level, not your claim; re-earn Level ' + inf.vtier + ' to fly here again.</div>' : '') + '</div>';
    else if (!inf.owned && cd > 0) act = '<div class="vzs-blocked" style="color:#8fe0ff;border-color:rgba(95,209,255,.45)">🛡 Attack shield — openable in ' + cdTxt(cd) + '</div>';
    else act = '<button class="vzs-go" data-vzwarp="' + id + '">' + (inf.owned ? '⛨ ENTER YOUR TILE' : inf.rival ? '⚔ ATTACK — SIEGE THE HOLD' : '⚔ CLAIM — LAUNCH THE SIEGE') + '</button>';
    const abandon = inf.owned ? '<button class="vzs-abandon" data-vzab="' + id + '">⏏ Abandon tile — release the citadel & income</button>' : '';
    const v = S().sheet('<div class="vzs">' +
      '<div class="vzs-hero">' + artTag('', inf.vtier) +
        '<div class="vzs-hero-top"><span class="vzs-t2">' + inf.name + '</span><span class="vzs-lv">LV ' + inf.vtier + '+</span></div>' +
        '<div class="vzs-hero-holder">' + holder + '</div>' +
      '</div>' +
      defRow +
      (cd > 0 ? '<div class="vzs-row"><span class="vzs-k">🛡 SHIELD</span><b style="color:#8fe0ff">' + cdTxt(cd) + ' left</b></div>' : '') +
      '<div class="vzs-val"><span class="vzs-k">▸ VALUE / HOUR — paid in all four while you hold it</span><div class="vzs-chips">' + valChips(vr) + '</div></div>' +
      '<div class="vzs-val toll"><span class="vzs-k">⚔ ENTRY TOLL — burned on every warp-in' + (inf.owned ? ' (½ — your tile)' : '') + '</span><div class="vzs-chips">' + tollChips(cost) + '</div></div>' +
      '<div class="vzs-obj">' + objective + '</div>' +
      act + abandon +
      '<button class="vzs-x">Close</button></div>');
    v.querySelector('.vzs-x').addEventListener('click', () => v.remove());
    const ab = v.querySelector('[data-vzab]');
    if (ab) ab.addEventListener('click', () => {
      S().confirmSheet('Abandon ' + inf.name + '?', 'Ownership, its citadel and ALL its hourly income release immediately — the spire goes neutral and anyone can claim it.', () => {
        try { const r = g.abandonTile(id); if (r && r.ok === false) { S().toast('Cannot abandon', '#e23b4e'); return; } } catch (e) {}
        S().toast('⏏ ' + inf.name + ' abandoned — the void reclaims it', '#8fc4ff');
        v.remove(); render();
      });
    });
    const go = v.querySelector('[data-vzwarp]');
    if (go) go.addEventListener('click', () => {
      const r = g.warp(id);
      if (r.ok) { v.remove(); const nav = document.querySelector('.nav-btn[data-screen="battle"]'); if (nav) nav.click(); return; }
      const t = { locked: '🔒 Level gate', cooldown: '🛡 Attack shield active', resources: '✦ Not enough resources for the toll', ally: '⬡ Alliance tile — never attackable' }[r.reason] || 'Warp failed';
      S().toast(t, '#e23b4e');
      if (r.reason === 'resources' && r.cost) S().toast('Toll: ⬢ ' + fmt(r.cost.fuel || 0) + ' · ◆ ' + fmt(r.cost.iron || 0) + ' · ✦ ' + fmt(r.cost.plasma || 0), '#8fc4ff');
    });
  }

  function render() {
    const body = $('voidzone-body'); if (!body || !G() || !G().state) return;
    const lvl = G().state.level | 0;
    const mine = ROWS.flat().filter((id) => G().isOwned && G().isOwned(id)).length;
    const sub = $('voidzone-sub'); if (sub) sub.textContent = mine + '/7 held · ⟳ 24h shields';
    let html = '<div class="vz-head"><div class="vz-h-t">THE VOID ZONE</div>' +
      '<div class="vz-h-s">Seven apex tiles beyond the rim — the same turf war as My Galaxy, a hundred times richer. Every tile pays <b>all four currencies hourly</b> and its citadel comes <b>with the conquest</b> (fixed — no builds). Tap a spire for full intel. Attacked tiles shield for <b>24h</b>.</div>' +
      '<div class="vz-soon"><span class="vz-soon-pill">⚔ COMING SOON · TRUE PVP</span><span class="vz-soon-txt">Contested spires go live-fire: attack rival pilots <b>inside the zone</b> while it\u2019s contested. When the final wave falls, the pilot who dealt the <b>most damage across all waves</b> wins the tile.</span></div></div>';
    // thin income strip — your total hourly take from held void tiles
    let inc = null;
    ROWS.flat().forEach((id) => { if (G().isOwned && G().isOwned(id)) { const t = G().sysAt(id); if (t) { const vr = Math.round(t.rate * 25); inc = inc || { g: 0, r: 0 }; inc.g += vr * 1000; inc.r += vr; } } });
    if (inc) html += '<div class="vz-income"><span>▸ EARNING / HR</span>' +
      '<em style="color:#f2a93c">$ ' + fmt(inc.g) + '</em><em style="color:#5bc0ff">⬢ ' + fmt(inc.r) + '</em><em style="color:#d0a060">◆ ' + fmt(inc.r) + '</em><em style="color:#c07bff">✦ ' + fmt(inc.r) + '</em></div>';
    if (lvl < 25) {
      html += '<div class="vz-gate">' + artTag('', 500) + '<h3>THE VOID AWAITS</h3>' +
        '<p>The first gate opens at <b>Level 25</b> — you are Level <b>' + lvl + '</b>. Deeper spires unlock at 50, 100, 200, 300, 400 and 500.</p>' +
        '<div class="vz-gate-bar"><i style="width:' + Math.min(100, lvl / 25 * 100) + '%"></i></div></div>';
      body.innerHTML = html; return;
    }
    html += '<div class="vz-board">' + ROWS.map((r, i) =>
      '<div class="vz-row">' + r.map(tileCard).join('') + '</div>').join('') + '</div>';
    body.innerHTML = html;
    body.querySelectorAll('[data-vzopen]').forEach((b) => b.addEventListener('click', () => openTile(b.dataset.vzopen)));
  }
  // live refresh while the screen is open (cooldowns tick, claims stream in)
  setInterval(() => { if (document.hidden) return; if (document.querySelector('#screen-voidzone.active')) render(); }, 4000);
  window.VOIDZ = { render };

  const HEX = 'polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)';
  const CSS = `
  /* DEEP SPACE + BLACK HOLE — starfield body, accretion swirl centered under
     the Singularity, event-horizon core + inward vignette */
  #voidzone-body{ padding:13px; overflow-x:hidden; position:relative;
    background:
      radial-gradient(1.4px 1.4px at 18% 12%, rgba(210,220,255,.55), transparent 60%),
      radial-gradient(1.2px 1.2px at 72% 8%, rgba(210,220,255,.4), transparent 60%),
      radial-gradient(1.5px 1.5px at 88% 34%, rgba(190,210,255,.5), transparent 60%),
      radial-gradient(1.1px 1.1px at 8% 52%, rgba(210,220,255,.38), transparent 60%),
      radial-gradient(1.3px 1.3px at 62% 64%, rgba(210,220,255,.42), transparent 60%),
      radial-gradient(1.2px 1.2px at 30% 84%, rgba(190,210,255,.36), transparent 60%),
      radial-gradient(1.4px 1.4px at 84% 88%, rgba(210,220,255,.44), transparent 60%),
      radial-gradient(150% 90% at 50% 0%, #130a22 0%, #070512 55%, #020107 100%); }
  .vz-head{ border:1px solid #3a2a5a; border-radius:15px; padding:13px 15px; margin-bottom:8px;
    background:radial-gradient(140% 180% at 12% -20%, rgba(176,77,255,.18), transparent 55%), linear-gradient(180deg,#171226,#0e0b1a); }
  .vz-h-t{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:14px; letter-spacing:.14em; color:#d9b8ff; text-shadow:0 0 16px rgba(176,77,255,.5); }
  .vz-h-s{ font-size:11px; color:#9b8fc0; margin-top:5px; line-height:1.5; } .vz-h-s b{ color:#e6d4ff; }
  .vz-income{ display:flex; align-items:center; flex-wrap:wrap; gap:5px 14px; margin-bottom:8px; padding:7px 12px; border:1px solid #35275a; border-radius:11px;
    background:linear-gradient(180deg,#141022,#0d0a18); font-size:11.5px; font-weight:800; font-variant-numeric:tabular-nums; }
  .vz-income span{ font-family:'Orbitron',sans-serif; font-size:8.5px; letter-spacing:.12em; color:#8f7ab8; }
  .vz-income em{ font-style:normal; white-space:nowrap; }
  .vz-soon{ display:flex; align-items:flex-start; gap:9px; margin-top:10px; border-top:1px solid #2a1f45; padding-top:9px; }
  .vz-soon-pill{ flex:none; font-family:'Orbitron',sans-serif; font-weight:900; font-size:8.5px; letter-spacing:.12em; color:#0e0716; background:linear-gradient(90deg,#2ee6c9,#8a3cf2); border-radius:99px; padding:4px 9px; box-shadow:0 0 12px -2px rgba(138,60,242,.8); animation:vzSoonPulse 2.2s ease-in-out infinite; white-space:nowrap; }
  @keyframes vzSoonPulse{ 0%,100%{ filter:brightness(1); } 50%{ filter:brightness(1.28); } }
  @media (prefers-reduced-motion:reduce){ .vz-soon-pill{ animation:none; } }
  .vz-soon-txt{ font-size:10.5px; color:#9b8fc0; line-height:1.5; } .vz-soon-txt b{ color:#e6d4ff; }
  /* honeycomb — calm hexes; intel lives in the tap-sheet */
  .vz-board{ position:relative; padding:20px 0 12px; }
  .vz-board::before{ content:''; position:absolute; left:50%; top:50%; width:min(160%, 760px); aspect-ratio:1; transform:translate(-50%,-50%);
    border-radius:50%; pointer-events:none; z-index:0; filter:blur(26px); animation:vzSwirl 30s linear infinite;
    background:conic-gradient(from 0deg,
      transparent 0 26deg, rgba(176,77,255,.22) 66deg, rgba(95,209,255,.15) 118deg, transparent 158deg,
      transparent 198deg, rgba(255,90,160,.13) 248deg, rgba(176,77,255,.2) 300deg, transparent 338deg); }
  .vz-board::after{ content:''; position:absolute; inset:-6%; pointer-events:none; z-index:0;
    background:
      radial-gradient(46% 46% at 50% 50%, rgba(0,0,0,.92) 0 22%, rgba(8,4,18,.5) 40%, transparent 62%),
      radial-gradient(120% 110% at 50% 50%, transparent 58%, rgba(2,1,6,.7) 100%); }
  @keyframes vzSwirl{ to{ transform:translate(-50%,-50%) rotate(360deg); } }
  @media (prefers-reduced-motion:reduce){ .vz-board::before{ animation:none; } }
  .vz-row{ position:relative; z-index:1; }
  .vz-row{ display:flex; justify-content:center; gap:7px; width:fit-content; margin:0 auto; }
  /* flower interlock — pointy-top hexes nest by a quarter of their height */
  .vz-row + .vz-row{ margin-top:calc(clamp(112px, 30vw, 184px) * -0.27); }
  .vz-tile{ position:relative; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; min-width:0; text-align:center;
    width:clamp(112px, 30vw, 184px); aspect-ratio:0.9; flex:none; padding:14px 6px; border:none; cursor:pointer;
    font-family:inherit; clip-path:${HEX}; background:linear-gradient(180deg,#4a3572,#241640); }
  .vz-tile::before{ content:''; position:absolute; inset:2px; clip-path:${HEX};
    background:radial-gradient(120% 90% at 50% 0%, rgba(176,77,255,.16), transparent 60%), linear-gradient(180deg,#151024,#0d0a18); }
  .vz-tile > *{ position:relative; z-index:1; }
  .vz-tile:active{ transform:scale(.97); }
  .vz-tile.own{ background:linear-gradient(180deg,#f2b24b,#8a5c14); }
  .vz-tile.foe{ background:linear-gradient(180deg,#ff5a68,#8a1826); }
  .vz-tile.gated{ opacity:.62; }
  .vz-tile.crown{ background:linear-gradient(160deg,#2ee6c9,#8a3cf2 55%,#ff5a68); }
  .vz-art{ flex:0 0 auto; height:clamp(58px, 12vw, 102px); width:auto; max-width:78%; object-fit:contain; filter:drop-shadow(0 0 16px rgba(176,77,255,.75)); }
  .vz-tile.crown .vz-art{ height:clamp(66px, 13vw, 116px); }
  .vz-lv{ font-family:'Orbitron',sans-serif; font-weight:900; font-size:clamp(13px, 3.4vw, 17px); letter-spacing:.1em; color:#ffd24d; text-shadow:0 0 12px rgba(242,178,75,.55); line-height:1; }
  .vz-name{ font-family:'Orbitron',sans-serif; font-weight:700; font-size:clamp(8px, 2.2vw, 10.5px); color:#efe6ff; max-width:86%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .vz-holder{ font-size:8.5px; font-weight:800; letter-spacing:.06em; max-width:80%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .vz-holder.own{ color:#ffd24d; } .vz-holder.foe{ color:#ff8a96; } .vz-holder.free{ color:#8f7ab8; }
  .vzc{ max-width:88%; overflow:hidden; text-overflow:ellipsis; font-family:'Orbitron',sans-serif; font-weight:800; font-size:9px; letter-spacing:.08em; border-radius:7px; padding:3px 8px; white-space:nowrap; font-variant-numeric:tabular-nums; }
  .vzc.lock{ color:#8f7ab8; border:1px dashed #3a2a5a; }
  .vzc.shield{ color:#8fe0ff; border:1px solid rgba(95,209,255,.45); background:rgba(95,209,255,.1); }
  .vzc.ok{ color:#ffd24d; border:1px solid rgba(242,178,75,.5); background:rgba(242,178,75,.1); }
  .vzc.foe{ color:#ff8a96; border:1px solid rgba(255,90,104,.5); background:rgba(255,90,104,.1); }
  .vzc.free{ color:#c9a8f5; border:1px solid rgba(176,77,255,.45); background:rgba(176,77,255,.1); }
  /* detail sheet */
  .vzs{ text-align:left; }
  /* HERO — the citadel IS the spectacle: full-bleed void stage, floating art */
  .vzs-hero{ position:relative; display:grid; place-items:center; margin:0 0 12px; height:252px; border-radius:16px; border:1px solid #4a3572; overflow:hidden;
    background:
      radial-gradient(90% 80% at 50% 32%, rgba(176,77,255,.32), transparent 65%),
      radial-gradient(1.5px 1.5px at 20% 30%, rgba(220,200,255,.8), transparent 60%),
      radial-gradient(1.5px 1.5px at 76% 22%, rgba(220,200,255,.6), transparent 60%),
      radial-gradient(1.2px 1.2px at 58% 74%, rgba(220,200,255,.5), transparent 60%),
      radial-gradient(1.2px 1.2px at 34% 62%, rgba(220,200,255,.45), transparent 60%),
      linear-gradient(180deg,#181028,#0a0716); }
  .vzs-hero img{ height:216px; max-width:92%; object-fit:contain; filter:drop-shadow(0 0 36px rgba(176,77,255,.9)) drop-shadow(0 10px 24px rgba(0,0,0,.7)); animation:vzsFloat 4.5s ease-in-out infinite; }
  @keyframes vzsFloat{ 0%,100%{ transform:translateY(3px); } 50%{ transform:translateY(-6px); } }
  @media (prefers-reduced-motion:reduce){ .vzs-hero img{ animation:none; } }
  .vzs-hero-top{ position:absolute; top:11px; left:13px; right:13px; display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .vzs-t2{ font-family:'Orbitron',sans-serif; font-weight:900; font-size:21px; letter-spacing:.05em; color:#fff; text-shadow:0 0 18px rgba(176,77,255,.9), 0 2px 6px #000; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .vzs-lv{ flex:none; font-family:'Orbitron',sans-serif; font-weight:900; font-size:13px; color:#1c1004; background:linear-gradient(90deg,#ffd24d,#f2a93c); border-radius:8px; padding:4px 11px; box-shadow:0 0 14px rgba(242,178,75,.7); white-space:nowrap; }
  .vzs-hero-holder{ position:absolute; bottom:11px; left:0; right:0; text-align:center; font-family:'Orbitron',sans-serif; font-weight:800; font-size:13px; letter-spacing:.08em; text-shadow:0 2px 6px #000; }
  .vzs-row{ display:flex; justify-content:space-between; align-items:center; gap:10px; padding:9px 2px; border-bottom:1px solid rgba(255,255,255,.06); font-size:14.5px; }
  .vzs-k{ font-size:11px; font-weight:800; letter-spacing:.1em; color:#a894d4; }
  .vzs-def{ padding:8px 2px; border-bottom:1px solid rgba(255,255,255,.06); }
  .vzs-fleet{ display:flex; align-items:center; gap:5px; margin-top:5px; }
  .vzs-fleet img.f{ width:58px; height:38px; object-fit:contain; filter:drop-shadow(0 0 9px rgba(255,90,104,.65)); }
  .vzs-fleet img.e{ width:34px; height:24px; object-fit:contain; opacity:.92; filter:drop-shadow(0 0 5px rgba(255,90,104,.5)); }
  .vzs-pow{ margin-left:auto; text-align:right; }
  .vzs-pow i{ display:block; font-style:normal; font-size:8.5px; font-weight:800; letter-spacing:.14em; color:#8f7ab8; }
  .vzs-pow b{ font-family:'Orbitron',sans-serif; font-size:17px; color:#ffd24d; font-variant-numeric:tabular-nums; text-shadow:0 0 12px rgba(242,178,75,.5); }
  .vzs-fleethull{ font-size:11.5px; font-weight:700; color:#b3a8d6; margin-top:4px; }
  .vzs-hint{ display:block; font-size:11.5px; color:#9384bd; margin-top:5px; }
  .vzs-val{ margin-top:9px; }
  .vzs-chips{ display:flex; flex-wrap:wrap; gap:7px 16px; margin-top:7px; font-size:17px; font-weight:800; font-variant-numeric:tabular-nums; }
  .vzs-chips em{ font-style:normal; white-space:nowrap; }
  .vzs-obj{ margin-top:12px; font-size:13px; color:#b3a8d6; line-height:1.55; border:1px dashed #35275a; border-radius:10px; padding:10px 12px; }
  .vzs-go{ display:block; width:100%; margin-top:12px; border:none; border-radius:13px; padding:16px; cursor:pointer; animation:msnClaimPulse 1.8s ease-in-out infinite;
    font-family:'Orbitron',sans-serif; font-weight:900; font-size:15px; letter-spacing:.12em; color:#fff;
    background:linear-gradient(180deg,#8a3cf2,#5c1fb0); box-shadow:0 0 16px -4px rgba(176,77,255,.8); }
  .vzs-go:active{ transform:scale(.98); }
  .vzs-blocked{ margin-top:11px; text-align:center; font-family:'Orbitron',sans-serif; font-weight:800; font-size:12px; letter-spacing:.08em; color:#8f7ab8;
    border:1px dashed #3a2a5a; border-radius:11px; padding:11px; }
  .vzs-abandon{ display:block; width:100%; margin-top:8px; background:none; border:1px solid rgba(255,90,104,.4); color:#ff8a96; border-radius:11px; padding:10px; font-family:'Rajdhani',sans-serif; font-weight:700; font-size:12px; cursor:pointer; }
  .vzs-abandon:active{ transform:scale(.98); }
  .vzs-x{ display:block; width:100%; margin-top:8px; background:none; border:1px solid #35275a; color:#9b8fc0; border-radius:10px; padding:9px; font-family:'Rajdhani',sans-serif; font-weight:700; font-size:12px; cursor:pointer; }
  .vz-gate{ text-align:center; border:1px solid #3a2a5a; border-radius:16px; padding:26px 16px; margin-top:8px; background:linear-gradient(180deg,#151024,#0d0a18); }
  .vz-gate img{ width:150px; filter:drop-shadow(0 0 22px rgba(176,77,255,.7)); }
  .vz-gate h3{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:15px; letter-spacing:.14em; color:#d9b8ff; margin:12px 0 6px; }
  .vz-gate p{ font-size:12px; color:#9b8fc0; line-height:1.55; max-width:420px; margin:0 auto 12px; } .vz-gate p b{ color:#e6d4ff; }
  .vz-gate-bar{ height:10px; max-width:300px; margin:0 auto; border-radius:6px; background:#191228; border:1px solid #3a2a5a; overflow:hidden; }
  .vz-gate-bar i{ display:block; height:100%; background:linear-gradient(90deg,#5c1fb0,#b04dff); box-shadow:0 0 10px rgba(176,77,255,.8); }
  .mega-card.cmd-voidz .mc-ic{ border-color:rgba(176,77,255,.5); background:radial-gradient(120% 120% at 50% 0%,#241238,#0e0a1c); box-shadow:0 0 14px -3px rgba(176,77,255,.7); }
  .mega-card.cmd-voidz .mc-ic img{ width:30px; height:30px; object-fit:contain; }
  .mega-card.cmd-voidz .mc-n{ color:#e6d4ff; }
  `;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
})();
