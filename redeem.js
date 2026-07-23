/* =============================================================================
   prism-fleet.js — Prism Fleet  (Command → Prism Fleet)
   ---------------------------------------------------------------------------
   A weekly endgame gauntlet (account Level 100+). Each Sunday the climb resets.
   You deploy into the REAL battle arena and face a single, brutally-tanky
   "Prism Fleet" boss; killing it clears the stage. Entering each next stage
   costs an exponentially rising amount of mined ◈ Prism and requires beating
   the previous one. A boss kill has a (brutal, depth-scaling) chance to drop one
   of 5 Facets; collect all 5 and they auto-forge into a PRISM CORE, which you
   apply permanently to any ship to gain the PRISM AURA — 1% chance to deflect
   incoming damage back at attackers, plus 10% of your damage splashed as AOE.

   Combat runs on the real engine via hooks in game-v93.js:
     update(): window.PRISMFLEET.tick(dt, rt)   — spawns/tracks the gauntlet boss
     onKill(): window.PRISMFLEET.onBossKill(e)   — artifact rolls + stage clear
   The aura itself lives in the engine's damage paths (state.shipAura[ship]).
   ============================================================================= */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const G = () => window.GAME;
  const C = () => window.CONFIG;
  const PR = '#c9a0ff';

  const FACETS = [
    { key: 'crimson', name: 'Crimson Facet', col: '#ff5168' },
    { key: 'azure',   name: 'Azure Facet',   col: '#5fd1ff' },
    { key: 'verdant', name: 'Verdant Facet', col: '#46d27a' },
    { key: 'violet',  name: 'Violet Facet',  col: '#b87bff' },
    { key: 'golden',  name: 'Golden Facet',  col: '#ffd450' },
  ];
  const MIN_LEVEL = 200;
  const RUN_LIMIT = 300;                         // seconds — 5 min to kill the stage boss
  const COST_BASE = 50, COST_GROW = 1.7;        // ◈ Prism entry cost per stage
  const AURA_REFLECT = 1, AURA_SPLASH = 10;     // % (for copy; logic lives in engine)

  // ---- STATE ----------------------------------------------------------------
  function P() {
    const g = G(); if (!g) return null;
    if (!g.state.prismFleet) g.state.prismFleet = { stage: 0, weekKey: 0, facets: {}, cores: 0, entered: false };
    const p = g.state.prismFleet;
    if (p.stage == null) p.stage = 0; if (p.cores == null) p.cores = 0;
    if (!p.facets) p.facets = {};
    return p;
  }
  const lvl = () => { try { return (G().state.level | 0) || 1; } catch (e) { return 1; } };
  const prism = () => { try { return (G().state.prism && G().state.prism.ingots) || 0; } catch (e) { return 0; } };
  const canEnter = () => lvl() >= MIN_LEVEL;
  const costFor = (stage) => Math.round(COST_BASE * Math.pow(COST_GROW, stage - 1));
  const nextStage = () => (P().stage || 0) + 1;
  const dropChance = (stage) => Math.min(0.35, 0.04 + (stage - 1) * 0.018);
  const facetCount = () => FACETS.reduce((n, f) => n + (P().facets[f.key] ? 1 : 0), 0);
  function fmt(n) { try { return G().formatNum(Math.floor(n)); } catch (e) { return Math.floor(n) + ''; } }

  // weekly reset (every Sunday 00:00 local)
  function weekKey() { const d = new Date(); const day = d.getDay(); const s = new Date(d); s.setDate(d.getDate() - day); s.setHours(0, 0, 0, 0); return s.getTime(); }
  function nextSunday() { const d = new Date(); const add = (7 - d.getDay()) % 7 || 7; const s = new Date(d); s.setDate(d.getDate() + add); s.setHours(0, 0, 0, 0); return s.getTime(); }
  function ensureWeek(p) { if (p.weekKey !== weekKey()) { p.weekKey = weekKey(); p.stage = 0; } }  // climb resets; Facets & Cores are kept
  function fmtDur(ms) { let s = Math.max(0, Math.floor(ms / 1000)); const d = Math.floor(s / 86400); s -= d * 86400; const h = Math.floor(s / 3600); s -= h * 3600; const m = Math.floor(s / 60); return (d > 0 ? d + 'd ' : '') + h + 'h ' + m + 'm'; }

  // ---- RUNTIME --------------------------------------------------------------
  const RUN = { active: false, runId: 0, stage: 1, bossSpawned: false, cleared: false, endPending: false, result: null, boss: null, hudT: 0, elapsed: 0 };
  const inRun = () => { try { return !!(G().state.prismFleetRun && G().state.prismFleetRun.active); } catch (e) { return false; } };

  function deploy(stage) {
    const g = G(); if (!g) return;
    if (!canEnter()) { toast('Reach account Level ' + MIN_LEVEL + ' to enter'); return; }
    const cost = costFor(stage);
    if (prism() < cost) { toast('Need ◈ ' + fmt(cost) + ' Prism to deploy'); return; }
    if (g.state.prism) g.state.prism.ingots -= cost;
    const zone = Math.max(1, g.state.highestUnlocked || 1);
    RUN.active = false;
    g.selectDungeon(zone);
    g.state.prismFleetRun = { active: true, stage: stage, started: Date.now() };
    try { g.rt.enemies.length = 0; g.rt.nodes.length = 0; g.rt.bossAlive = false; g.rt.boss = null; } catch (e) {}
    RUN.runId = g.state.prismFleetRun.started; RUN.stage = stage; RUN.bossSpawned = false; RUN.cleared = false; RUN.endPending = false; RUN.boss = null; RUN.elapsed = 0;
    const p = P(); p.entered = true;
    try { g.save(); } catch (e) {}
    const b = document.querySelector('.nav-btn[data-screen="battle"]'); if (b) b.click();
    updateHud();
  }

  function tick(dt, rt) {
    const g = G(); if (!g) return; const run = g.state.prismFleetRun; if (!run || !run.active) { RUN.active = false; return; }
    if (!RUN.active || RUN.runId !== run.started) { RUN.active = true; RUN.runId = run.started; RUN.stage = run.stage; RUN.bossSpawned = false; RUN.cleared = false; RUN.endPending = false; RUN.boss = null; RUN.elapsed = 0; }
    if (RUN.endPending) { RUN.endPending = false; endRun(true, RUN.result); return; }
    if (rt.archer && (rt.archer.dead || rt.awaitingRespawn)) { endRun(false); return; }
    if (!RUN.cleared) { RUN.elapsed += dt; if (RUN.elapsed >= RUN_LIMIT) { endRun(false, { timeout: true }); return; } }
    if (!RUN.bossSpawned && !RUN.cleared) { try { RUN.boss = g.spawnFleetBoss(RUN.stage); } catch (e) {} RUN.bossSpawned = true; banner('◈ PRISM FLEET — Stage ' + RUN.stage + ' · destroy it in 5:00', PR); }
    RUN.hudT -= dt; if (RUN.hudT <= 0) { RUN.hudT = 0.2; updateRunHud(); }
  }

  // boss died — defer the heavy end-of-run work to next tick (safe context)
  function onBossKill(e) {
    const g = G(); if (!g || !g.state.prismFleetRun) return;
    const stage = e.fleetStage || RUN.stage || 1;
    const p = P(); ensureWeek(p);
    if (stage > (p.stage || 0)) p.stage = stage;     // cleared → next stage unlocked
    let gained = null, forged = false;
    if (Math.random() < dropChance(stage)) {
      const missing = FACETS.filter((f) => !p.facets[f.key]);
      const pool = missing.length ? missing : FACETS;
      const f = pool[(Math.random() * pool.length) | 0];
      p.facets[f.key] = true; gained = f;
      if (FACETS.every((ff) => p.facets[ff.key])) { FACETS.forEach((ff) => { p.facets[ff.key] = false; }); p.cores = (p.cores || 0) + 1; forged = true; }
    }
    RUN.cleared = true; RUN.result = { stage, gained, forged }; RUN.endPending = true;
    try { g.save(); } catch (e2) {}
  }

  function endRun(success, info) {
    const g = G();
    try { g.state.prismFleetRun = null; } catch (e) {}
    RUN.active = false;
    if (success) { try { g.selectDungeon(0); } catch (e) {} }   // dock after a win
    try { g.save(); } catch (e) {}
    updateHud(); syncBadge();
    if (success) {
      const f = info && info.gained;
      let body = 'You destroyed the <b>Prism Fleet</b> at <b>Stage ' + info.stage + '</b>.<br><br>';
      if (info.forged) body += '✦ All 5 Facets aligned — a <b style="color:' + PR + '">Prism Core</b> was forged! Apply it to any ship for the <b>Prism Aura</b>.';
      else if (f) body += 'It dropped the <b style="color:' + f.col + '">' + f.name + '</b> &nbsp;·&nbsp; <b>' + facetCount() + '/5</b> Facets collected.';
      else body += 'No Facet this run — push deeper for better odds.';
      showPrompt('◈ Stage ' + info.stage + ' cleared', body, 'Back to Prism Fleet');
    } else if (info && info.timeout) {
      showPrompt('⏱ Out of time', 'The 5-minute deployment window closed before the <b>Prism Fleet</b> fell — your ship was pulled from the arena. Your ◈ Prism entry fee is spent, but you can redeploy and try again.', 'Back to Prism Fleet');
    } else {
      showPrompt('☠ Fleet run ended', 'Your ship was destroyed — the Prism Fleet still stands. Regroup and try again.', 'Back to Prism Fleet');
    }
  }

  function applyCore(shipKey) {
    const g = G(), p = P();
    if ((p.cores || 0) < 1) { toast('No Prism Core to apply'); return; }
    if (!g.state.shipAura) g.state.shipAura = {};
    if (g.state.shipAura[shipKey]) { toast('That ship already has Prism Aura'); return; }
    g.state.shipAura[shipKey] = true; p.cores = (p.cores || 0) - 1;
    try { g.refreshStats && g.refreshStats(); } catch (e) {}
    try { g.save(); } catch (e) {}
    const nm = (C().SHIP_BY_KEY[shipKey] || {}).name || shipKey;
    toast('◈ Prism Aura applied to ' + nm); closeSheet(); renderHub();
    if (window.UI) window.UI.refreshAll();
  }

  // ---- HUB (screen-prismfleet) ----------------------------------------------
  function renderHub() {
    const body = $('pf-body'); if (!body) return; const p = P(); ensureWeek(p);
    const sub = $('pf-sub'); if (sub) sub.textContent = canEnter() ? ('Resets in ' + fmtDur(nextSunday() - Date.now())) : ('Locked · Level ' + MIN_LEVEL + ' required');

    if (!canEnter()) {
      body.innerHTML = '<div class="pf-lock"><div class="pf-lock-ic">🔒</div><h3>Prism Fleet</h3><p>The weekly endgame gauntlet unlocks at <b>account Level ' + MIN_LEVEL + '</b>.</p><div class="pf-lock-lv">You\'re Level <b>' + lvl() + '</b></div></div>';
      return;
    }

    const cleared = p.stage || 0, target = cleared + 1;
    const facetRow = FACETS.map((f) => '<div class="pf-facet ' + (p.facets[f.key] ? 'on' : '') + '" style="--fc:' + f.col + '" title="' + f.name + '"><span>◈</span></div>').join('');
    const cores = p.cores || 0;

    body.innerHTML =
      '<div class="pf-hero"><div class="pf-hero-l"><div class="pf-hero-stage">Stage ' + cleared + '</div><div class="pf-hero-lab">cleared this week</div></div>' +
      '<button class="pf-info" id="pf-info" title="How Prism Fleet works">ⓘ</button></div>' +
      '<div class="pf-resets">⟳ Weekly gauntlet · resets Sunday in <b>' + fmtDur(nextSunday() - Date.now()) + '</b></div>' +

      '<div class="pf-lab">Facets &nbsp;<span class="pf-lab-r">' + facetCount() + '/5 collected</span></div>' +
      '<div class="pf-facets">' + facetRow + '</div>' +
      '<div class="pf-forge' + (facetCount() >= 5 ? ' ready' : '') + '">' +
        '<div class="pf-forge-ic">◈</div>' +
        '<div class="pf-forge-txt"><div class="pf-forge-t">All 5 Facets &rarr; FORGE A PRISM CORE</div>' +
        '<div class="pf-forge-s">Auto-forges a <b>◈ Prism Core</b> — apply it for a permanent <b>Prism Aura</b>: <b>' + AURA_REFLECT + '%</b> damage deflect + <b>' + AURA_SPLASH + '%</b> AOE splash.</div></div>' +
        '<div class="pf-forge-tag">' + facetCount() + '/5</div>' +
      '</div>' +

      '<div class="pf-lab">Prism Cores &nbsp;<span class="pf-lab-r">apply for a permanent Prism Aura</span></div>' +
      '<div class="pf-cores"><div class="pf-cores-n"><span class="pf-core-ic">◈</span> ' + cores + ' Core' + (cores === 1 ? '' : 's') + ' ready</div>' +
      '<button class="pf-apply ' + (cores > 0 ? '' : 'dis') + '" id="pf-apply">Apply to a ship</button></div>' +

      '<div class="pf-lab">Deploy</div>' +
      '<div class="pf-deploy">' +
        '<div class="pf-stage-pick"><button class="pf-step" id="pf-dn">‹</button>' +
        '<div class="pf-stage-mid"><div class="pf-stage-n">Stage <b id="pf-stg">' + target + '</b></div><div class="pf-stage-meta" id="pf-meta"></div></div>' +
        '<button class="pf-step" id="pf-up">›</button></div>' +
        '<button class="pf-go" id="pf-go"></button>' +
        '<div class="pf-hint">A single, brutally-tanky boss — <b>5 minutes</b> to kill it or you\'re removed. Beat Stage N to unlock N+1. Mined ◈ Prism is the entry fee.</div>' +
      '</div>';

    // stage picker state
    let sel = target; const maxSel = target, minSel = 1;
    const refreshPick = () => {
      sel = Math.max(minSel, Math.min(maxSel, sel));
      $('pf-stg').textContent = sel;
      const cost = costFor(sel), odds = Math.round(dropChance(sel) * 100);
      $('pf-meta').textContent = '◈ ' + fmt(cost) + ' entry · ' + odds + '% Facet · ' + (sel === target ? 'NEW' : 'cleared');
      const go = $('pf-go'), afford = prism() >= cost;
      go.className = 'pf-go' + (afford ? '' : ' dis');
      go.textContent = (afford ? '⚔ Deploy — ◈ ' + fmt(cost) : 'Need ◈ ' + fmt(cost) + ' Prism');
      $('pf-dn').disabled = sel <= minSel; $('pf-up').disabled = sel >= maxSel;
    };
    refreshPick();
    $('pf-dn').addEventListener('click', () => { sel--; refreshPick(); });
    $('pf-up').addEventListener('click', () => { sel++; refreshPick(); });
    $('pf-go').addEventListener('click', () => { if (prism() >= costFor(sel)) deploy(sel); else toast('Need ◈ ' + fmt(costFor(sel)) + ' Prism — mine more in Prism Mining'); });
    $('pf-info').addEventListener('click', () => showExplainer());
    const ap = $('pf-apply'); if (ap) ap.addEventListener('click', () => { if ((p.cores || 0) > 0) openApply(); else toast('Forge a Prism Core first (collect all 5 Facets)'); });
  }

  function openApply() {
    const g = G(); const ships = (C().SHIPS || []).filter((s) => g.state.ownedShips && g.state.ownedShips[s.key]);
    const rows = ships.map((s) => {
      const has = g.state.shipAura && g.state.shipAura[s.key];
      return '<div class="pf-ship ' + (has ? 'has' : '') + '" ' + (has ? '' : 'data-apply="' + s.key + '"') + '>' +
        '<img src="ships/ship-' + s.key + '.png" alt=""><div class="pf-ship-m"><div class="pf-ship-n">' + s.name + '</div><div class="pf-ship-s">' + (has ? '◈ Prism Aura active' : 'Tap to apply Prism Aura') + '</div></div>' +
        (has ? '<span class="pf-ship-on">◈</span>' : '<span class="pf-ship-go">Apply ›</span>') + '</div>';
    }).join('');
    sheet('<div class="pf-sh-head"><div><div class="pf-sh-title">Apply Prism Core</div><div class="pf-sh-sub">' + (P().cores || 0) + ' Core(s) · permanent, per ship</div></div><button class="pf-x" data-x>✕</button></div>' +
      '<div class="pf-ships">' + (rows || '<p class="pf-empty">No ships owned yet.</p>') + '</div>');
    const root = $('pf-sheet-root');
    root.querySelectorAll('[data-apply]').forEach((d) => d.addEventListener('click', () => applyCore(d.dataset.apply)));
  }

  // ---- on-enter explainer ---------------------------------------------------
  function showExplainer() {
    showPrompt('◈ Prism Fleet',
      '<div class="pf-ex">' +
      '<p><b>Weekly gauntlet.</b> Opens for everyone at <b>account Level ' + MIN_LEVEL + '</b> and the climb <b>resets every Sunday</b>.</p>' +
      '<p><b>Climb the stages.</b> You start at Stage 1 and must <b>beat each stage to unlock the next</b>. Entering a stage costs an <b>exponentially rising amount of ◈ Prism</b> (the currency you mine in Prism Mining).</p>' +
      '<p><b>One brutal boss.</b> Each stage is a single Prism Fleet ship with <b>enormous HP</b> — you fight it in your real arena with your ship &amp; fleet. The deeper you go, the tankier it gets. You get <b>5 minutes</b> to destroy it — if the timer runs out you\'re pulled from the arena and must redeploy and try again.</p>' +
      '<p><b>5 Facets → a Prism Core.</b> Killing the boss has a chance to drop one of <b>5 Facets</b> (rare — and <b>higher the deeper you fight</b>). Collect all 5 and they auto-forge into a <b style="color:' + PR + '">Prism Core</b>.</p>' +
      '<p><b>Prism Aura.</b> Apply a Prism Core to <b>any ship, permanently</b>, to gain the Prism Aura: a <b>' + AURA_REFLECT + '% chance to deflect incoming damage back</b> at attackers, plus <b>' + AURA_SPLASH + '% of your damage splashed as AOE</b>. Very rare, very strong.</p>' +
      '</div>', 'Got it');
  }

  // ---- in-combat HUD --------------------------------------------------------
  function updateHud() { /* reserved for future wallet hooks */ }
  let _badge;
  function ensureBadge() { if (_badge) return; _badge = document.createElement('div'); _badge.id = 'pf-badge'; ($('app') || document.body).appendChild(_badge); }
  function onBattleNoOverlay() { return !document.querySelector('.screen.overlay.active'); }
  function syncBadge() { ensureBadge(); const show = inRun() && onBattleNoOverlay(); _badge.classList.toggle('show', show); if (show) updateRunHud(); }
  function updateRunHud() {
    ensureBadge(); if (!inRun()) { _badge.classList.remove('show'); return; }
    const b = RUN.boss; const hp = (b && b.maxHp) ? Math.max(0, Math.round(b.hp / b.maxHp * 100)) : 100;
    const rem = Math.max(0, Math.ceil(RUN_LIMIT - RUN.elapsed));
    const mm = Math.floor(rem / 60), ss = rem % 60;
    const tStr = mm + ':' + (ss < 10 ? '0' : '') + ss;
    const low = rem <= 30;
    _badge.innerHTML = '<span class="pf-dot"></span>PRISM FLEET · STAGE ' + RUN.stage + ' · BOSS ' + hp + '%<span class="pf-time' + (low ? ' low' : '') + '">⏱ ' + tStr + '</span>';
    _badge.classList.toggle('show', onBattleNoOverlay());
  }

  // ---- DOM helpers (modal / sheet / toast / banner) -------------------------
  let _modal;
  function showPrompt(title, html, btn, onOk) {
    closePrompt(); _modal = document.createElement('div'); _modal.id = 'pf-modal';
    _modal.innerHTML = '<div class="pfm-back"></div><div class="pfm-card"><div class="pfm-t">' + title + '</div><div class="pfm-b">' + html + '</div><button class="pfm-ok">' + (btn || 'OK') + '</button></div>';
    ($('app') || document.body).appendChild(_modal);
    const go = () => { closePrompt(); if (onOk) onOk(); else open(); };
    _modal.querySelector('.pfm-ok').addEventListener('click', go);
    _modal.querySelector('.pfm-back').addEventListener('click', go);
  }
  function closePrompt() { if (_modal) { _modal.remove(); _modal = null; } }
  function sheet(inner) { const root = $('pf-sheet-root'); if (!root) return; root.innerHTML = '<div class="pf-backdrop"></div><div class="pf-sheet">' + inner + '</div>'; root.classList.add('open'); root.querySelector('.pf-backdrop').addEventListener('click', closeSheet); const x = root.querySelector('[data-x]'); if (x) x.addEventListener('click', closeSheet); }
  function closeSheet() { const root = $('pf-sheet-root'); if (root) { root.classList.remove('open'); root.innerHTML = ''; } }
  let _toastT;
  function toast(t) { let el = $('pf-toast'); if (!el) { el = document.createElement('div'); el.id = 'pf-toast'; ($('app') || document.body).appendChild(el); } el.textContent = t; el.classList.add('show'); clearTimeout(_toastT); _toastT = setTimeout(() => el.classList.remove('show'), 2200); }
  let _bannerT;
  function banner(t, col) { let el = $('pf-banner'); if (!el) { el = document.createElement('div'); el.id = 'pf-banner'; ($('app') || document.body).appendChild(el); } el.textContent = t; el.style.color = col || PR; el.style.borderColor = col || PR; el.classList.add('show'); clearTimeout(_bannerT); _bannerT = setTimeout(() => el.classList.remove('show'), 3200); }
  function open() { const b = document.querySelector('.nav-btn[data-screen="prismfleet"]'); if (b) b.click(); }

  // ---- CSS ------------------------------------------------------------------
  function injectCss() {
    if ($('pf-css')) return; const s = document.createElement('style'); s.id = 'pf-css';
    s.textContent = `
#pf-body{padding:14px;}
.pf-hero{display:flex;align-items:center;justify-content:space-between;gap:12px;background:radial-gradient(120% 130% at 0 0,rgba(201,160,255,.2),transparent),linear-gradient(180deg,#1a1430,#120e22);border:1px solid #322a52;border-radius:16px;padding:16px;}
.pf-hero-stage{font-family:'Orbitron',sans-serif;font-weight:800;font-size:24px;color:#fff;line-height:1;}
.pf-hero-lab{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#9a8fc0;font-weight:700;margin-top:5px;}
.pf-info{flex:none;width:34px;height:34px;border-radius:50%;border:1px solid #4a3d72;background:rgba(201,160,255,.12);color:${PR};font-size:16px;font-weight:800;cursor:pointer;}
.pf-resets{font-size:11.5px;color:#a99fc4;margin:11px 2px 2px;}
.pf-resets b{color:#e6dcff;}
.pf-lab{display:flex;justify-content:space-between;align-items:baseline;font-size:10px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:#7d72a6;margin:18px 2px 9px;}
.pf-lab-r{letter-spacing:.02em;text-transform:none;color:#9a8fc0;font-weight:700;}
.pf-facets{display:flex;gap:9px;}
.pf-facet{flex:1;aspect-ratio:1;border-radius:12px;border:1px solid #2c2548;background:#140f24;display:flex;align-items:center;justify-content:center;font-size:20px;color:#3a3358;opacity:.6;}
.pf-facet.on{border-color:var(--fc);background:radial-gradient(120% 120% at 50% 30%,color-mix(in srgb,var(--fc) 30%,transparent),#140f24);color:var(--fc);opacity:1;box-shadow:0 0 14px -2px var(--fc);}
.pf-forge{position:relative;display:flex;align-items:center;gap:12px;margin-top:10px;padding:13px;border-radius:14px;overflow:hidden;background:linear-gradient(180deg,#1c1533,#130d22);border:1px solid #322a52;}
.pf-forge::before{content:'';position:absolute;inset:0;padding:1px;border-radius:14px;background:linear-gradient(120deg,#5fd1ff,#b87bff,#ff5168,#ffd450,#46d27a,#5fd1ff);background-size:300% 300%;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;opacity:.45;animation:prismShift 5s linear infinite;}
.pf-forge.ready::before{opacity:1;}
.pf-forge.ready{box-shadow:0 0 22px -6px ${PR};}
.pf-forge-ic{flex:none;width:42px;height:42px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:24px;color:${PR};background:radial-gradient(120% 120% at 50% 0,#2a2046,#140e24);border:1px solid rgba(201,160,255,.5);filter:drop-shadow(0 0 7px ${PR});}
.pf-forge.ready .pf-forge-ic{animation:prismPulse 1.6s ease-in-out infinite;}
.pf-forge-txt{flex:1;min-width:0;}
.pf-forge-t{font-family:'Orbitron',sans-serif;font-weight:800;font-size:11.5px;letter-spacing:.04em;line-height:1.25;background:linear-gradient(90deg,#d9c2ff,#ff9ec4,#ffe6a0,#8be0c0,#d9c2ff);background-size:240% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:prismShift 6s linear infinite;}
.pf-forge-s{font-size:11px;line-height:1.5;color:#a99fc4;margin-top:4px;}
.pf-forge-s b{color:#e6dcff;}
.pf-forge-tag{flex:none;align-self:flex-start;font-family:'Rajdhani',sans-serif;font-weight:800;font-size:12px;color:#cdb8ff;background:rgba(201,160,255,.14);border:1px solid rgba(201,160,255,.32);border-radius:8px;padding:3px 8px;}
.pf-forge.ready .pf-forge-tag{color:#180a30;background:linear-gradient(180deg,#d9bcff,#a978ff);border-color:transparent;}
.pf-cores{display:flex;align-items:center;justify-content:space-between;gap:10px;background:radial-gradient(120% 120% at 50% 0,rgba(201,160,255,.12),transparent),linear-gradient(180deg,#1c1533,#130e22);border:1px solid rgba(201,160,255,.32);border-radius:13px;padding:12px 13px;}
.pf-cores-n{font-family:'Rajdhani',sans-serif;font-weight:800;font-size:14px;color:#e6dcff;}
.pf-core-ic{color:${PR};filter:drop-shadow(0 0 6px ${PR});}
.pf-apply{flex:none;border:0;border-radius:10px;padding:10px 14px;font-family:'Rajdhani',sans-serif;font-weight:800;font-size:12.5px;color:#1a1030;background:linear-gradient(180deg,#d9bcff,#a978ff);cursor:pointer;}
.pf-apply.dis{opacity:.45;filter:saturate(.4);}
.pf-deploy{background:linear-gradient(180deg,#171028,#100c1e);border:1px solid #271f44;border-radius:14px;padding:13px;}
.pf-stage-pick{display:flex;align-items:center;gap:10px;}
.pf-step{flex:none;width:40px;height:40px;border-radius:11px;border:1px solid #3a3160;background:rgba(255,255,255,.05);color:#cdb8ff;font-size:20px;font-weight:800;cursor:pointer;}
.pf-step:disabled{opacity:.3;cursor:default;}
.pf-stage-mid{flex:1;text-align:center;}
.pf-stage-n{font-family:'Orbitron',sans-serif;font-weight:800;font-size:16px;color:#eaf0fa;}
.pf-stage-n b{color:${PR};}
.pf-stage-meta{font-size:11px;color:#9a8fc0;margin-top:3px;}
.pf-go{width:100%;margin-top:11px;border:0;border-radius:12px;padding:13px;font-family:'Rajdhani',sans-serif;font-weight:800;font-size:14.5px;color:#180a06;background:linear-gradient(180deg,#ff9a6a,#ff5168);cursor:pointer;box-shadow:0 7px 18px rgba(255,81,104,.3);}
.pf-go.dis{opacity:.5;filter:saturate(.5);box-shadow:none;}
.pf-hint{font-size:10.5px;color:#7d72a6;margin-top:10px;text-align:center;line-height:1.5;}
.pf-lock{text-align:center;padding:38px 18px;}
.pf-lock-ic{font-size:40px;margin-bottom:10px;}
.pf-lock h3{font-family:'Orbitron',sans-serif;color:#eaf0fa;margin:0 0 8px;}
.pf-lock p{color:#9a8fc0;font-size:13px;line-height:1.6;margin:0 0 12px;}
.pf-lock-lv{font-size:12px;color:#cdb8ff;}
.pf-sheet-root{position:absolute;inset:0;z-index:34;display:none;}
.pf-sheet-root.open{display:block;}
.pf-backdrop{position:absolute;inset:0;background:rgba(4,4,10,.62);backdrop-filter:blur(3px);}
.pf-sheet{position:absolute;left:0;right:0;bottom:0;max-height:82%;overflow-y:auto;background:linear-gradient(180deg,#181128,#0d0a18);border-top:1px solid #322a52;border-radius:20px 20px 0 0;padding:10px 14px 20px;}
.pf-sh-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:6px 2px 12px;}
.pf-sh-title{font-family:'Orbitron',sans-serif;font-weight:800;font-size:15px;color:#eaf0fa;}
.pf-sh-sub{font-size:11px;color:#93a2ba;margin-top:3px;}
.pf-x{flex:none;width:30px;height:30px;border-radius:9px;border:1px solid #322a52;background:rgba(255,255,255,.04);color:#cdb8ff;font-size:14px;cursor:pointer;}
.pf-ships{display:flex;flex-direction:column;gap:8px;}
.pf-ship{display:flex;align-items:center;gap:11px;background:rgba(255,255,255,.03);border:1px solid #271f44;border-radius:12px;padding:9px 11px;cursor:pointer;}
.pf-ship.has{opacity:.85;cursor:default;border-color:rgba(201,160,255,.4);}
.pf-ship img{width:40px;height:40px;object-fit:contain;flex:none;}
.pf-ship-m{flex:1;min-width:0;}
.pf-ship-n{font-family:'Rajdhani',sans-serif;font-weight:800;font-size:13.5px;color:#eaf0fa;}
.pf-ship-s{font-size:11px;color:#93a2ba;margin-top:1px;}
.pf-ship-go{flex:none;font-size:12px;font-weight:800;color:${PR};}
.pf-ship-on{flex:none;color:${PR};font-size:16px;filter:drop-shadow(0 0 6px ${PR});}
.pf-empty{color:#93a2ba;font-size:12px;padding:14px;text-align:center;}
.pf-ex p{font-size:12.5px;line-height:1.55;color:#cdc3e0;margin:0 0 10px;text-align:left;}
.pf-ex b{color:#efe8ff;}
#pf-badge{position:absolute;top:118px;left:50%;transform:translateX(-50%) translateY(-6px);z-index:7;display:none;align-items:center;gap:7px;background:rgba(20,14,34,.92);border:1px solid ${PR};border-radius:20px;padding:5px 13px;font-family:'Rajdhani',sans-serif;font-weight:800;font-size:11.5px;letter-spacing:.04em;color:${PR};white-space:nowrap;box-shadow:0 8px 22px rgba(0,0,0,.5);opacity:0;transition:opacity .25s;pointer-events:none;}
#pf-badge.show{display:flex;opacity:1;}
#pf-badge .pf-dot{width:7px;height:7px;border-radius:50%;background:${PR};box-shadow:0 0 8px ${PR};animation:pfDot 1.4s infinite;}
#pf-badge .pf-time{margin-left:9px;padding-left:9px;border-left:1px solid rgba(201,160,255,.4);color:#e6dcff;font-variant-numeric:tabular-nums;}
#pf-badge .pf-time.low{color:#ff6a7d;border-left-color:rgba(255,106,125,.5);animation:pfDot 1s infinite;}
@keyframes pfDot{0%,100%{opacity:1;}50%{opacity:.4;}}
#pf-modal{position:absolute;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;}
.pfm-back{position:absolute;inset:0;background:rgba(4,4,10,.72);backdrop-filter:blur(3px);}
.pfm-card{position:relative;width:86%;max-width:360px;max-height:80%;overflow-y:auto;background:linear-gradient(180deg,#1b1230,#120a18);border:1px solid #3d2c5a;border-radius:18px;padding:20px 18px;box-shadow:0 24px 60px rgba(0,0,0,.65);animation:pfmIn .22s cubic-bezier(.22,1,.36,1);}
@keyframes pfmIn{from{transform:scale(.93);opacity:0;}to{transform:none;opacity:1;}}
.pfm-t{font-family:'Orbitron',sans-serif;font-weight:800;font-size:16px;color:${PR};text-shadow:0 0 16px rgba(201,160,255,.4);margin-bottom:11px;text-align:center;}
.pfm-b{font-family:'Rajdhani',sans-serif;font-size:13.5px;line-height:1.6;color:#e7dcf2;text-align:center;}
.pfm-b b{color:#fff;}
.pfm-ok{margin-top:16px;width:100%;border:0;border-radius:12px;padding:12px;font-family:'Rajdhani',sans-serif;font-weight:800;font-size:14px;color:#180a30;background:linear-gradient(180deg,#d9bcff,#a978ff);cursor:pointer;}
#pf-toast{position:absolute;bottom:120px;left:50%;transform:translateX(-50%) translateY(8px);z-index:62;background:rgba(20,18,34,.96);border:1px solid #3a3360;border-radius:10px;padding:8px 15px;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:12.5px;color:#eaf0fa;white-space:nowrap;max-width:88%;overflow:hidden;text-overflow:ellipsis;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;}
#pf-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
#pf-banner{position:absolute;top:150px;left:50%;transform:translateX(-50%) translateY(-10px);z-index:41;background:rgba(10,8,20,.94);border:1px solid ${PR};border-radius:12px;padding:9px 15px;font-family:'Rajdhani',sans-serif;font-weight:800;font-size:12.5px;color:${PR};white-space:nowrap;max-width:90%;overflow:hidden;text-overflow:ellipsis;opacity:0;pointer-events:none;transition:opacity .3s,transform .3s;box-shadow:0 12px 34px rgba(0,0,0,.6);}
#pf-banner.show{opacity:1;transform:translateX(-50%) translateY(0);}
`;
    document.head.appendChild(s);
  }

  // ---- BOOT -----------------------------------------------------------------
  let _booted = false, _seenExplainer = false;
  function boot() {
    if (_booted) return; const screen = $('screen-prismfleet'); if (!screen) return; _booted = true;
    injectCss(); ensureBadge();
    const mo = new MutationObserver(() => {
      if (screen.classList.contains('active')) { renderHub(); if (!_seenExplainer && canEnter()) { _seenExplainer = true; setTimeout(showExplainer, 220); } }
    });
    mo.observe(screen, { attributes: true, attributeFilter: ['class'] });
    if (screen.classList.contains('active')) renderHub();
    setInterval(() => { try { if (G() && G().state) syncBadge(); } catch (e) {} }, 700);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  setTimeout(boot, 1200);

  window.PRISMFLEET = { tick, onBossKill, deploy, applyCore, open, P };
})();
