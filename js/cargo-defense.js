/* =============================================================================
   cargo-defense.js — SPACE CARGO DEFENSE (Command ▸ Cargo Defense)
   ---------------------------------------------------------------------------
   Buy a shipment, escort it across a hostile sector to the Citadel, and the
   manifest pays out against the odds you saw before you launched.

   GATE: Pilot Ascension ★3 — opens shortly after a pilot's first prestige
   rather than deep into one.

   THE RUN IS THE REAL GAME. cargo-run.js deploys on the live battle engine in
   your own zone: your flagship, your gear, your escorts, your drones, the
   zone's real hostiles, real loot. What is added is a fragile freighter to
   protect and a road to get it down.

   THE RULES, enforced by there being no code for them: no autoplay, no auto
   battle, no speed-up, no skip, no instant complete. And dying on a run costs
   the FLAGSHIP HULL — see the manual card in the lobby.

   Entry price is spent at launch and is NOT refunded on a loss. The tier you
   pick IS the bet.
============================================================================= */
(function () {
  'use strict';
  const G = () => window.GAME, C = () => window.CONFIG, I = () => window.ITEMS;
  const $ = (id) => document.getElementById(id);
  const UNLOCK_STARS = 3;
  const DAILY_RUNS = 2;
  const EXTRA_RUN_LC = 1000;
  // A DAILY CEILING ON BOUGHT RUNS (build 712). The purchase was uncapped, so the
  // event's two-a-day pacing was really "as many as you hold LootCoins for" — and
  // a cargo run deploys deeper than the pilot's own frontier, which made the
  // uncapped run the widest faucet in the game. Three is the ceiling: a Pro
  // subscriber still more than doubles the daily allowance, and the day still ends.
  const MAX_EXTRA_RUNS = 3;

  const stars = () => { try { return window.PASCEND ? PASCEND.stars() | 0 : (G().ascStars() | 0); } catch (e) { return 0; } };
  const hz = () => { try { return Math.max(1, G().state.highestUnlocked || 1); } catch (e) { return 1; } };
  const fmt = (n) => { try { return G().formatNum(Math.floor(n)); } catch (e) { return Math.floor(n || 0) + ''; } };
  const rar = (t) => (C().RARITY[t] || C().RARITY[0]);
  const dayIdx = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);
  const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const toast = (m, c) => { try { window.SOCIAL.toast(m, c || '#8fc4ff'); } catch (e) {} };

  // ===========================================================================
  // THE FIVE SHIPMENTS
  // ---------------------------------------------------------------------------
  // frag = how much of every incoming hit the freighter actually takes. Richer
  // shipments are FRAGILE, not merely expensive — the tension comes from the
  // hull you are protecting, not from padded enemy health.
  // ===========================================================================
  const TIERS = [
    { tier: 1, key: 'c1', name: 'FREIGHT HAULER I',  short: 'Cargo I',   cost: 5e7,    frag: 0.62, accent: '#7ce0a0', risk: 'LOW',       gold: [1.7, 3.0],
      blurb: 'A short-haul crate run. Light resistance, honest pay.' },
    { tier: 2, key: 'c2', name: 'BULK FREIGHTER II', short: 'Cargo II',  cost: 1e9,    frag: 0.80, accent: '#5bc0ff', risk: 'MODERATE',  gold: [1.8, 3.2],
      blurb: 'Real tonnage. Raiders start showing up in numbers.' },
    { tier: 3, key: 'c3', name: 'VAULTSHIP III',     short: 'Cargo III', cost: 2.5e10, frag: 0.92, accent: '#b15cff', risk: 'HIGH',      gold: [1.9, 3.4],
      blurb: 'A sealed vault hull. Bombers and elites join the screen.' },
    { tier: 4, key: 'c4', name: 'SOVEREIGN IV',      short: 'Cargo IV',  cost: 4e11,   frag: 1.05, accent: '#f0972a', risk: 'VERY HIGH', gold: [2.0, 3.6],
      blurb: 'Sovereign-grade freight. Void casters seed the lane ahead of you.' },
    { tier: 5, key: 'c5', name: 'OMEGA CARGO V',     short: 'Cargo V',   cost: 6e12,   frag: 1.15, accent: '#ff3b4e', risk: 'EXTREME',   gold: [2.1, 3.9],
      blurb: 'The deepest manifest in the galaxy. Nothing pays like it, and nothing breaks as easily.' },
  ];

  // manifest rows per tier: [kind, base chance, arg]. Condition scales the odds.
  // THE RARITY LADDER (Aug 2026): Omega Cargo V now tops out at ARTIFACT — the
  // deepest tier a non-ascension roll can reach — and every tier below was
  // re-laddered up from it so the five shipments read as one continuous climb
  // rather than four cheap runs and one jackpot.
  // NO FITTINGS, ANYWHERE IN THIS EVENT. The manifest pays gold, salvage and a
  // little hard currency — nothing else — and the run itself drops nothing from
  // any kill in it: the zone hostiles, the sector bosses and the escort are all
  // covered by lootBlocked() in game-v93.js. Fittings came off the manifest in
  // Aug 2026 because they read as a loot table competing with the zones and
  // buried what the event is actually for. Build 712 finished the job at the
  // other end, where a run deploys ~50% deeper than the pilot's own frontier and
  // the sector bosses were quietly paying full boss showers on that inflated zone.
  const MANIFEST = {
    1: [['res', 0.75], ['lc', 0.08, 120]],
    2: [['res', 0.80], ['lc', 0.12, 260]],
    3: [['res', 0.85], ['lc', 0.18, 500], ['cores', 0.20, 3]],
    4: [['res', 0.90], ['lc', 0.25, 900], ['cores', 0.35, 8]],
    5: [['res', 1.00], ['lc', 0.40, 2000], ['cores', 0.50, 20]],
  };
  const ROWNAME = {
    res: 'Salvage — ⬢ fuel · ◆ iron · ✦ plasma',
    lc: 'LootCoins',
    cores: 'Dread Cores',
  };

  // Arriving intact pays. 100% integrity → ×1.25 on every roll; a limping 10%
  // delivery → ×0.80. Stated on the manifest, so the skill is legible.
  const condMult = (integrity) => 0.75 + 0.5 * (integrity / 100);
  // HULL HITPOINTS. Every freighter carries a 100-point integrity pool, and each
  // hit on it is scaled by the shipment's fragility — so the hull's real
  // hitpoints are 100/frag: 161 HP on a Cargo I down to 65 HP on an Omega V.
  // This was printed as a "% durability", which is the same number wearing a
  // unit nobody fights in.
  const hullHp = (t) => Math.round(100 / t.frag);
  // ---- HOW DEEP THE INSTANCE SITS, IN ONE PLACE ---------------------------
  // THE BASE is the pilot's own frontier: the deepest zone they have unlocked, or
  // their pilot level if that runs ahead of it (a pilot who has not pushed zones
  // still gets a depth matched to their power). startCargoRun uses exactly this,
  // and so does the "+N deeper" figure on the card — they used to disagree,
  // because the gap was measured against the zone while the depth could come
  // from the level, which overstated the gap by the difference.
  const depthBase = () => { try { return Math.max(1, hz(), plvl()); } catch (e) { return 1; } };
  const deployZone = (tier) => Math.max(1, Math.round(depthBase() * (1 + 0.10 * tier)) + tier * 6);
  const zoneGap = (tier) => Math.max(0, deployZone(tier) - depthBase());
  // WHAT LEVEL YOU WILL BE ATTACKING. CONFIG.zoneCombatLevel converts the deploy
  // zone into the level of PILOT it is built for — the same conversion the Grind
  // Zone list and the high-risk warning use — so it can be read straight against
  // your own level. (The old figure was zone²: Zone 264 read "Lv 69,696", which
  // compares to nothing.) THERE IS NO CEILING: deployZone used to clamp at 999,
  // which pinned the mobs — and the pay and loot riding the same zone curve — for
  // every pilot past that frontier. Zones are endless, so this is too.
  const mobLevel = (tier) => { try { return C().zoneCombatLevel(deployZone(tier)); } catch (e) { return deployZone(tier); } };
  // PILOT LEVEL SCALING. Everything the manifest pays in CURRENCY rides the
  // pilot's level, so a Level 400 commander is not hauling Level 100 wages.
  // Nothing here rides the DEPLOY zone: that number is difficulty, and pricing a
  // reward off it is what let a bought run out-earn the ground it was flown over.
  // The same figure drives the run's difficulty (cargo-run.js reads it) — pay and
  // pressure move together, never one without the other.
  const plvl = () => { try { return Math.max(1, G().state.level | 0); } catch (e) { return 1; } };
  const lvlMul = () => 1 + (plvl() - 1) * 0.014;    // Lv 100 → ×2.4 · Lv 500 → ×8.0

  // ---- currency chips: the SAME markup as the wallet in the header ----------
  const CUR_CHIP = {
    gold:    { cls: 'gold-chip', ic: '$', rc: '#f2b24b' },
    fuel:    { cls: 'res-chip',  ic: '⬢', rc: '#5bc0ff' },
    iron:    { cls: 'res-chip',  ic: '◆', rc: '#d0a060' },
    plasma:  { cls: 'res-chip',  ic: '✦', rc: '#c07bff' },
    credits: { cls: 'res-chip lc-chip', ic: '◈', rc: '#f2a93c' },
    cores:   { cls: 'res-chip lc-chip', ic: '◇', rc: '#ff3a4a' },
  };
  function curChip(k, n, dim) {
    const d = CUR_CHIP[k]; if (!d) return '';
    const glyph = d.cls === 'gold-chip' ? '<span class="coin">' + d.ic + '</span>'
      : '<span class="rg" style="color:' + d.rc + '">' + d.ic + '</span>';
    return '<div class="' + d.cls + (dim ? ' cd-dim' : '') + '" style="--rc:' + d.rc + '">' + glyph + '<span>' + fmt(n) + '</span></div>';
  }

  // ===========================================================================
  // STATE — daily attempts + career record
  // ===========================================================================
  function st() {
    const s = G() && G().state; if (!s) return null;
    if (!s.cargo) s.cargo = { v: 2, day: dayIdx(), used: 0, extra: 0, runs: 0, wins: 0, losses: 0, best: 0, hulls: 0, hist: [] };
    if (s.cargo.day !== dayIdx()) { s.cargo.day = dayIdx(); s.cargo.used = 0; s.cargo.extra = 0; }
    if (!Array.isArray(s.cargo.hist)) s.cargo.hist = [];
    return s.cargo;
  }
  function runsLeft() { const c = st(); return c ? Math.max(0, DAILY_RUNS + (c.extra | 0) - (c.used | 0)) : 0; }
  function unlocked() { return stars() >= UNLOCK_STARS; }

  // ===========================================================================
  // ETERNUM — commissioned, never rolled
  // ---------------------------------------------------------------------------
  // The Celestial Class is not loot. It is BUILT, once, by a pilot who holds the
  // licence in the hull's own flyReq (cargo runs secured, Pilot Ascension stars,
  // a Titan Sina in the hangar) and then pays the yard its claimCost. Both live
  // in config-v2 and are READ here — this file used to keep its own copy of every
  // figure, and they had drifted apart from the gate they described.
  // ===========================================================================
  const ETERNUM = 'eternum';
  const claimCost = () => ((C().SHIP_BY_KEY[ETERNUM] || {}).claimCost || {});
  const WALLET = {
    gold:    { ic: '●', col: '#f2b24b', name: 'Gold',      get: () => G().state.gold || 0 },
    fuel:    { ic: '⬢', col: '#5bc0ff', name: 'Fuel',      get: () => (G().state.resources || {}).fuel || 0 },
    iron:    { ic: '◆', col: '#d0a060', name: 'Iron',      get: () => (G().state.resources || {}).iron || 0 },
    plasma:  { ic: '✦', col: '#c07bff', name: 'Plasma',    get: () => (G().state.resources || {}).plasma || 0 },
    credits: { ic: '◈', col: '#ffd66a', name: 'LootCoins', get: () => G().state.credits || 0 },
  };
  const claimShort = () => Object.keys(claimCost()).filter((k) => WALLET[k].get() < claimCost()[k]);
  // What the yard actually takes, spelled out from claimCost. The confirm sheet
  // used to say "10T of every primary and 100,000 LootCoins" for a bill that is
  // 10T gold, 1T each of fuel/iron/plasma and 10,000 LootCoins — wrong on both
  // counts, on the one sheet that authorises an irreversible spend.
  function claimSummary() {
    const c = claimCost();
    return Object.keys(WALLET).filter((k) => c[k])
      .map((k) => WALLET[k].ic + ' ' + fmt(c[k]) + ' ' + WALLET[k].name).join(' · ');
  }
  function payClaim() {
    const s = G().state, c = claimCost();
    s.gold -= (c.gold || 0);
    s.resources = s.resources || { fuel: 0, iron: 0, plasma: 0 };
    s.resources.fuel -= (c.fuel || 0); s.resources.iron -= (c.iron || 0); s.resources.plasma -= (c.plasma || 0);
    s.credits = (s.credits || 0) - (c.credits || 0);
  }
  function eternumReq() {
    const s = G().state;
    const own = !!(s.ownedShips || {})[ETERNUM];
    const fly = G().canFlyShip ? G().canFlyShip(ETERNUM) : { ok: true, need: [] };
    const rq = ((C().SHIP_BY_KEY[ETERNUM] || {}).flyReq) || {};
    return { own, fly,
      // THE LICENCE COUNTS CARGO RUNS SECURED, not missions. This read
      // lifetimeMissions — the general board tally — so a capstone earned inside
      // Space Cargo Defense was being paid off by daily mission boards instead.
      hauls: (s.cargo && s.cargo.wins) | 0, haulsNeed: rq.cargo | 0,
      stars: stars(), starsNeed: rq.stars | 0,
      sina: !!(s.ownedShips || {})[rq.ship || 'titansina'] };
  }
  function commission() {
    const g = G(), r = eternumReq();
    if (r.own) return;
    if (!r.fly.ok) { toast('The licence is not complete yet', '#e23b4e'); return; }
    const short = claimShort();
    if (short.length) { toast('Short on ' + short.map((k) => WALLET[k].name).join(' · '), '#e23b4e'); return; }
    if (!window.SOCIAL || !window.SOCIAL.confirmSheet) return doCommission();
    window.SOCIAL.confirmSheet('Commission the Eternum?',
      'The yard takes ' + claimSummary() + '. It is spent immediately and cannot be refunded.', doCommission);
  }
  function doCommission() {
    const g = G(), c = st();
    payClaim();
    g.grantShip(ETERNUM);
    g.save(); if (window.UI) window.UI.refreshAll();
    showCommissioned();
    render();
  }
  function showCommissioned() {
    const o = overlay(); o.className = 'show';
    o.innerHTML =
      '<div class="cdr" style="--acc:#5b7cff">' +
        '<div class="cdr-kick">COMMISSIONED</div>' +
        '<div class="cdr-t">ETERNUM</div>' +
        '<div class="cdr-sub">CELESTIAL CLASS</div>' +
        '<div class="cdr-et"><img src="ships/ship-eternum.png" alt="" onerror="this.remove()">' +
          '<div class="cdr-et-s">SHE IS IN YOUR HANGAR — CLEARED TO FLY</div>' +
          '<div class="cdr-et-lock">Built not to conquer worlds, but to outlive them.</div>' +
        '</div>' +
        '<button class="cdr-ok">CLOSE</button>' +
      '</div>';
    o.querySelector('.cdr-ok').addEventListener('click', closeOverlay);
  }
  function eternumCard() {
    const r = eternumReq();
    const sh = C().SHIP_BY_KEY[ETERNUM] || {};
    const cost = claimCost(), short = claimShort();
    const row = (ok, have, label) =>
      '<div class="cd-et-req' + (ok ? ' ok' : '') + '"><span class="cd-et-tick">' + (ok ? '✓' : '○') + '</span>' +
      '<span class="cd-et-lab">' + label + '</span><b>' + have + '</b></div>';
    const licOk = r.fly.ok;
    const bill = '<div class="cd-et-bill">' +
      '<div class="cd-et-reqh">COMMISSIONING BILL — charged when you build her</div>' +
      '<div class="cd-et-cost wallet">' + Object.keys(cost).map((k) => curChip(k, cost[k], WALLET[k].get() < cost[k])).join('') + '</div></div>';
    const action = r.own
      ? '<div class="cd-et-built">✓ COMMISSIONED — in your hangar</div>'
      : !licOk
        ? '<div class="cd-et-blocked">Licence incomplete — she cannot be built yet</div>'
        : short.length
          ? '<div class="cd-et-blocked">Licence complete — short on ' + short.map((k) => WALLET[k].name).join(' · ') + '</div>'
          : '<button class="cd-et-go" id="cd-commission">✦ COMMISSION THE ETERNUM</button>';
    return '<div class="cd-eternum' + (r.own ? ' owned' : '') + '">' +
      '<div class="cd-et-art"><img src="ships/ship-eternum.png" alt="" decoding="async" onerror="this.remove()"></div>' +
      '<div class="cd-et-body">' +
        '<div class="cd-et-kick">THE CAPSTONE · CELESTIAL CLASS</div>' +
        '<div class="cd-et-name">ETERNUM</div>' +
        '<div class="cd-et-motto">' + esc(sh.motto || '') + '</div>' +
        '<div class="cd-et-line">1.5× the Titan Sina on every line · five <b>death beams</b> that lock the nearest hostiles and never let go · a standing <b>celestial aura</b> that burns anything near the hull.</div>' +
        '<div class="cd-et-reqs">' +
          '<div class="cd-et-reqh">' + (r.own ? 'LICENCE COMPLETE' : 'LICENCE TO BUILD AND FLY') + '</div>' +
          row(r.hauls >= r.haulsNeed, fmt(r.hauls) + ' / ' + fmt(r.haulsNeed), 'Cargo runs secured') +
          row(r.stars >= r.starsNeed, '★' + r.stars + ' / ' + r.starsNeed, 'Pilot Ascension') +
          row(r.sina, r.sina ? 'IN HANGAR' : 'MISSING', 'Titan Sina') +
        '</div>' +
        bill +
        action +
      '</div></div>';
  }

  // ===========================================================================
  // LOBBY
  // ===========================================================================
  function render() {
    const body = $('cargo-body'); if (!body || !G() || !G().state) return;
    // WARM THE ESCORT while the player reads the shipment list. The freighter
    // sprites and the lane textures used to be fetched and decoded at the moment
    // the run started, which is why the FIRST run of a session crawled and every
    // one after it was smooth. Doing it here costs nothing the player can feel.
    try { if (window.CARGORUN && window.CARGORUN.warm) window.CARGORUN.warm(); } catch (e) {}
    const sub = $('cargo-sub');
    const c = st();
    if (sub) sub.textContent = unlocked() ? runsLeft() + ' / ' + (DAILY_RUNS + (c.extra | 0)) + ' runs today' : 'Locked · Ascension ★' + UNLOCK_STARS;

    if (!unlocked()) {
      body.innerHTML =
        '<div class="cd-locked">' +
          '<div class="cd-lock-ic">🔒</div>' +
          '<div class="cd-lock-t">SPACE CARGO DEFENSE</div>' +
          '<div class="cd-lock-s">This event opens at <b>Pilot Ascension ★' + UNLOCK_STARS + '</b>.<br>You are at <b>★' + stars() + '</b> — ' + (UNLOCK_STARS - stars()) + ' more ascension' + (UNLOCK_STARS - stars() === 1 ? '' : 's') + ' to go.</div>' +
          '<div class="cd-lock-b">Buy a shipment and escort it to the Citadel yourself, in your own zone, in your own ship. Real combat, real stakes — with something fragile in the middle of it that you have to keep alive.</div>' +
        '</div>' + eternumCard();
      wire(body);
      return;
    }

    const left = runsLeft(), total = DAILY_RUNS + (c.extra | 0);
    const extraLeft = Math.max(0, MAX_EXTRA_RUNS - (c.extra | 0));
    const pro = (() => { try { return G().isPro(); } catch (e) { return false; } })();
    body.innerHTML =
      '<div class="cd-top">' +
        '<div class="cd-runs' + (left ? '' : ' out') + '">' +
          '<span class="cd-runs-k">DAILY CARGO RUNS</span>' +
          '<b class="cd-runs-v">' + left + ' / ' + total + '</b>' +
          '<span class="cd-runs-s">' + (left ? 'A run is consumed the moment the cargo launches — abandoning or losing still spends it.' : 'Out of runs. They reset at midnight.') + '</span>' +
          (pro
            ? (extraLeft > 0
                ? '<button class="cd-buyrun" id="cd-buyrun">✦ PRO — BUY ONE MORE RUN · ' + EXTRA_RUN_LC.toLocaleString() + ' LC</button>' +
                  '<span class="cd-runs-fine">' + extraLeft + ' of ' + MAX_EXTRA_RUNS + ' purchases left today · bought runs expire at the daily reset.</span>'
                : '<span class="cd-runs-fine">All ' + MAX_EXTRA_RUNS + ' extra runs bought today — the limit resets at midnight.</span>')
            : '<div class="cd-pro-hint">LootFleet <b>Pro</b> can buy up to ' + MAX_EXTRA_RUNS + ' extra runs a day at ' + EXTRA_RUN_LC.toLocaleString() + ' LC each.</div>') +
        '</div>' +
        manualCard() +
      '</div>' +
      '<div class="cd-sec-t">CHOOSE YOUR SHIPMENT</div>' +
      '<div class="cd-intro">A <b>ten-minute</b> crawl from the southern deployment edge to the Citadel at the north, through five sectors of escalating resistance. Every tier deploys <b>deeper than you normally fly</b>, so hostiles hit harder and drop better. Payout scales with level: <b>×' + lvlMul().toFixed(1) + '</b> at Level ' + plvl() + '.</div>' +
      '<div class="cd-grid">' + TIERS.map(tierCard).join('') + '</div>' +
      eternumCard() +
      recordCard(c);
    wire(body);
  }

  // THE MANUAL — the one place the rules of the mode are spelled out, including
  // the part that costs the most: dying takes the hull you flew in on.
  function manualCard() {
    return '<div class="cd-rules">' +
      '<div class="cd-rules-t">THE MANUAL</div>' +
      '<div class="cd-rules-l"><i>✕</i>No auto play or auto battle — <b>always manual</b></div>' +
      '<div class="cd-rules-l"><i>✕</i>No skip or instant complete</div>' +
      '<div class="cd-rules-l"><i>◷</i>Ten minutes, deployment edge to Citadel</div>' +
      '<div class="cd-rules-l"><i>▶</i>Battle speed <b>allowed</b> — every tier you own</div>' +
      '<div class="cd-rules-n">Speed compresses the whole run — the freighter, the waves and the clock advance together.</div>' +
      '<div class="cd-rules-l"><i>✕</i>No fittings drop — <b>the manifest is the payout</b></div>' +
      '<div class="cd-warn-hull">' +
        '<div class="cd-wh-t">☠ YOU LOSE YOUR HULL UPGRADES IF YOU DIE</div>' +
        '<div class="cd-wh-s"><b>The ship is not taken.</b> Die on an escort run and every <b>hull upgrade level</b> on your flagship is destroyed — back to stock, Lv 1. You keep the hull, its Ship Ascension and every fitted item. <b>Abandoning is not dying</b>: you lose the shipment and the run, the upgrades survive.</div>' +
      '</div>' +
      '<div class="cd-rules-f">Everything else is the normal game: your stats, your escorts, your drones, the zone’s real hostiles.</div>' +
    '</div>';
  }

  // advertised sustained field size per tier — mirrors DENS in cargo-run.js
  const DENSITY = { 1: 6, 2: 9, 3: 12, 4: 17, 5: 25 };
  function tierCard(t) {
    const gold = G().state.gold || 0;
    const afford = gold >= t.cost;
    const gp = payRange('gold', 0, t), rp = payRange('res', 0, t);
    const rowOf = (k) => (MANIFEST[t.tier] || []).find((r) => r[0] === k);
    const lcr = rowOf('lc'), cor = rowOf('cores');
    const lcp = lcr ? payRange('lc', lcr[2], t) : null;
    const cop = cor ? payRange('cores', cor[2], t) : null;
    return '<button class="cd-card' + (afford ? '' : ' poor') + '" data-cd="' + t.key + '" style="--acc:' + t.accent + '">' +
      '<div class="cd-c-art"><img src="ships/cargo-' + t.tier + '.png" alt="" decoding="async" onerror="this.remove()"></div>' +
      '<div class="cd-c-main">' +
      '<div class="cd-c-head"><span class="cd-c-tier">' + t.short.toUpperCase() + '</span><span class="cd-c-risk">' + t.risk + '</span></div>' +
      '<div class="cd-c-name">' + t.name + '</div>' +
      '<div class="cd-c-blurb">' + t.blurb + '</div>' +
      '<div class="cd-strip">' +
        '<div class="cd-s cd-s-cost' + (afford ? '' : ' bad') + '"><i>COST</i><b>● ' + fmt(t.cost) + '</b></div>' +
        '<div class="cd-s cd-s-pay"><i>PAYS ON DELIVERY</i><b>● ' + amtTxt(gp[0], gp[1]) + '</b>' +
          '<em>' + (gp[0] / t.cost).toFixed(1) + '–' + (gp[1] / t.cost).toFixed(1) + '× entry</em></div>' +
        '<div class="cd-s"><i>MOB LEVEL</i><b' + (t.tier >= 4 ? ' class="hot"' : '') + '>Lv ' + fmt(mobLevel(t.tier)) + '</b></div>' +
        '<div class="cd-s"><i>HULL</i><b>' + hullHp(t) + ' HP</b></div>' +
        '<div class="cd-s"><i>SWARM</i><b' + (t.tier >= 4 ? ' class="hot"' : '') + '>~' + DENSITY[t.tier] + '</b></div>' +
      '</div>' +
      '<div class="cd-plus"><i>ALSO PAYS</i>' +
        '<span style="color:' + CUR_CHIP.fuel.rc + '">⬢ ' + amtTxt(rp[0], rp[1]) + '</span>' +
        '<span style="color:' + CUR_CHIP.iron.rc + '">◆ ' + amtTxt(rp[0], rp[1]) + '</span>' +
        '<span style="color:' + CUR_CHIP.plasma.rc + '">✦ ' + amtTxt(rp[0] * 0.7, rp[1] * 0.7) + '</span>' +
        (lcp ? '<span style="color:' + CUR_CHIP.credits.rc + '">◈ ' + amtTxt(lcp[0], lcp[1]) + '</span>' : '') +
        (cop ? '<span style="color:' + CUR_CHIP.cores.rc + '">◇ ' + amtTxt(cop[0], cop[1]) + '</span>' : '') +
      '</div>' +
      '</div></div></button>';
  }
  function recordCard(c) {
    if (!c.runs) return '';
    return '<div class="cd-rec">' +
      '<div class="cd-rec-i"><b>' + (c.wins | 0) + '</b><span>secured</span></div>' +
      '<div class="cd-rec-i"><b>' + (c.losses | 0) + '</b><span>lost</span></div>' +
      '<div class="cd-rec-i"><b>' + (c.best | 0) + '%</b><span>best delivery</span></div>' +
      '<div class="cd-rec-i' + ((c.hulls | 0) ? ' bad' : '') + '"><b>' + (c.hulls | 0) + '</b><span>upgrade lv lost</span></div>' +
      '</div>';
  }

  function wire(body) {
    body.querySelectorAll('[data-cd]').forEach((b) => b.addEventListener('click', () => openManifest(b.dataset.cd)));
    const br = $('cd-buyrun'); if (br) br.addEventListener('click', buyRun);
    const cm = $('cd-commission'); if (cm) cm.addEventListener('click', commission);
  }

  function buyRun() {
    const g = G(), c = st();
    if (!g.isPro()) { toast('Pro subscribers only', '#e23b4e'); return; }
    if ((c.extra | 0) >= MAX_EXTRA_RUNS) { toast('Daily limit — ' + MAX_EXTRA_RUNS + ' extra runs a day', '#e23b4e'); return; }
    if ((g.state.credits || 0) < EXTRA_RUN_LC) { toast('Not enough LootCoins', '#e23b4e'); return; }
    g.state.credits -= EXTRA_RUN_LC;
    c.extra = (c.extra | 0) + 1;
    g.save(); if (window.UI) window.UI.refreshAll();
    toast('✦ One more cargo run added — expires at reset', '#7ce0a0');
    render();
  }

  // ===========================================================================
  // MANIFEST SHEET — everything you are buying, before you commit
  // ===========================================================================
  function openManifest(key) {
    const t = TIERS.find((x) => x.key === key); if (!t || !window.SOCIAL) return;
    // The tier is known now — make sure THIS freighter's art is decoded before
    // the launch button is even available.
    try { if (window.CARGORUN && window.CARGORUN.warm) window.CARGORUN.warm(t.tier); } catch (e) {}
    const g = G(), gold = g.state.gold || 0, afford = gold >= t.cost;
    const left = runsLeft();
    const hull = (C().SHIP_BY_KEY[g.state.ship] || {}).name || 'your flagship';
    const hullLv = Math.max(1, ((g.state.shipLevels || {})[g.state.ship] | 0) || 1);
    const rows = MANIFEST[t.tier].map((r) => payRow(r[0], r[1], r[2], t)).join('');
    const gp = payRange('gold', 0, t);
    const v = window.SOCIAL.sheet('<div class="cdm" style="--acc:' + t.accent + '">' +
      '<div class="cdm-head"><span class="cdm-risk">' + t.risk + ' RISK</span><span class="cdm-t">' + t.name + '</span></div>' +
      '<div class="cdm-hero"><img src="ships/cargo-' + t.tier + '.png" alt="" decoding="async" onerror="this.remove()"></div>' +
      '<div class="cdm-blurb">' + t.blurb + '</div>' +
      '<div class="cdm-cost' + (afford ? '' : ' bad') + '"><span class="cdm-p-k">COST TO ENTER</span>' +
        '<b class="cdm-cost-v">● ' + fmt(t.cost) + '</b>' +
        '<em>Paid at launch. Abandoning or dying does not return it.</em></div>' +
      '<div class="cdm-sec">IF YOU DELIVER — AT 100% INTEGRITY</div>' +
      '<div class="cdm-pay">' +
        '<div class="cdm-p cdm-p-hero" style="--c:#f2b24b"><div class="cdm-p-l"><span class="cdm-p-k">GOLD</span>' +
          '<b class="cdm-p-v">● ' + amtTxt(gp[0], gp[1]) + '</b>' +
          '<em>' + (gp[0] / t.cost).toFixed(1) + '–' + (gp[1] / t.cost).toFixed(1) + '× your entry</em></div>' +
          '<span class="cdm-p-ch" style="color:#7ce0a0">100%</span></div>' + rows +
      '</div>' +
      '<div class="cdm-cond">Delivered condition scales every roll — <b>arrive at 100%</b> integrity and each chance above is multiplied by <b>1.25</b>; limp in at 10% and it is <b>0.80</b>. Currency payouts scale with your level: <b>×' + lvlMul().toFixed(1) + '</b> at Level ' + plvl() + '.</div>' +
      '<div class="cdm-stats">' +
        '<span><i>ENTRY PRICE</i><b class="' + (afford ? '' : 'bad') + '">● ' + fmt(t.cost) + '</b></span>' +
        '<span><i>CARGO HULL</i><b>' + hullHp(t) + ' HP</b></span>' +
        '<span><i>HOSTILES HELD</i><b>~' + DENSITY[t.tier] + ' at once</b></span>' +
        '<span><i>MOB LEVEL</i><b>Lv ' + fmt(mobLevel(t.tier)) + '</b></span>' +
        '<span><i>RUNS LEFT TODAY</i><b>' + left + '</b></span>' +
      '</div>' +
      '<div class="cdm-hull">☠ You are flying the <b>' + esc(hull) + '</b> at hull <b>Lv ' + hullLv + '</b>. Die out there and those upgrade levels are <b>destroyed</b> — the ship comes home at stock.</div>' +
      (afford && left ? '<button class="cdm-go" data-go>LAUNCH CARGO</button>'
        : '<div class="cdm-blocked">' + (!left ? 'No cargo runs left today' : 'Not enough gold — you need ● ' + fmt(t.cost)) + '</div>') +
      '<button class="cdm-x">Close</button></div>');
    v.querySelector('.cdm-x').addEventListener('click', () => v.remove());
    const go = v.querySelector('[data-go]');
    if (go) go.addEventListener('click', () => { v.remove(); launch(t); });
  }
  // A PAYOUT ROW. Currency is the headline — a big Orbitron figure in that
  // currency's own colour, the way the wallet prints it — and the roll chance is
  // demoted to a chip on the right. Components speak the loot screen's language
  // instead: a rarity swatch and the rarity name at full size.
  function payRow(kind, ch, arg, t) {
    const eff = Math.min(0.98, ch * 1.25), pc = Math.round(eff * 100);
    const chip = '<span class="cdm-p-ch">' + (pc < 1 ? (eff * 100).toFixed(1) : pc) + '%</span>';
    const p = payRange(kind, arg, t);
    if (kind === 'res') {
      const lo = p[0], hi = p[1];
      return '<div class="cdm-p" style="--c:#8fc4ff"><div class="cdm-p-l"><span class="cdm-p-k">SALVAGE</span>' +
        '<b class="cdm-p-res">' +
          '<i style="color:' + CUR_CHIP.fuel.rc + '">⬢ ' + amtTxt(lo, hi) + '</i>' +
          '<i style="color:' + CUR_CHIP.iron.rc + '">◆ ' + amtTxt(lo, hi) + '</i>' +
          '<i style="color:' + CUR_CHIP.plasma.rc + '">✦ ' + amtTxt(lo * 0.7, hi * 0.7) + '</i>' +
        '</b></div>' + chip + '</div>';
    }
    const meta = kind === 'lc' ? ['LOOTCOINS', CUR_CHIP.credits.rc, '◈'] : ['DREAD CORES', CUR_CHIP.cores.rc, '◇'];
    return '<div class="cdm-p" style="--c:' + meta[1] + '"><div class="cdm-p-l"><span class="cdm-p-k">' + meta[0] + '</span>' +
      '<b class="cdm-p-v">' + meta[2] + ' ' + amtTxt(p[0], p[1]) + '</b></div>' + chip + '</div>';
  }

  // ===========================================================================
  // LAUNCH → THE REAL RUN → PAYOUT
  // ===========================================================================
  function launch(t) {
    const g = G(), c = st();
    if (!window.CARGORUN) { toast('Escort systems offline', '#e23b4e'); return; }
    if (window.CARGORUN.active()) { toast('A run is already underway', '#e23b4e'); return; }
    if (runsLeft() <= 0) { toast('No cargo runs left today', '#e23b4e'); return; }
    if ((g.state.gold || 0) < t.cost) { toast('Not enough gold', '#e23b4e'); return; }
    g.state.gold -= t.cost;
    c.used = (c.used | 0) + 1;
    c.runs = (c.runs | 0) + 1;
    g.save(); if (window.UI) window.UI.refreshAll();
    render();
    if (!window.CARGORUN.startRun(t, (res) => onRunEnd(t, res))) toast('Could not deploy', '#e23b4e');
  }

  function onRunEnd(t, res) {
    const g = G(), c = st();
    if (res.hullLost && res.hullLost.levels) c.hulls = (c.hulls | 0) + res.hullLost.levels;
    if (res.win) {
      c.wins = (c.wins | 0) + 1;
      // LIFETIME MANIFEST COUNTER. The Tour of Duty weekly "Logistics Run" reads
      // state.lifeStats.cargo, which nothing had ever incremented — the mission
      // could never move off 0/3. Every other Tour metric rides a counter that
      // already existed; this one needed writing here, at the only place a
      // manifest is actually delivered.
      try { const L = (g.state.lifeStats = g.state.lifeStats || {}); L.cargo = (L.cargo | 0) + 1; } catch (e) {}
      c.best = Math.max(c.best | 0, res.integrity);
      // WHICH SHIPMENT WAS DELIVERED. `best` is an integrity percentage, not a
      // tier, so nothing published the class of freighter that made it home —
      // the Discord feed needs the tier to show the right cargo hull.
      c.lastTier = t.tier | 0;
      c.lastWin = Date.now();
      if (res.integrity >= 90) c.clean = (c.clean | 0) + 1;   // "Pristine Manifest" missions read this
      const payout = rollManifest(t, res.integrity);
      grant(payout, t);
    } else {
      c.losses = (c.losses | 0) + 1;
      showLoss(t, res);
    }
    c.hist.unshift({ d: Date.now(), t: t.tier, w: res.win ? 1 : 0, i: res.integrity, r: res.reason });
    c.hist = c.hist.slice(0, 20);
    g.save(); if (window.UI) window.UI.refreshAll();
    render();
  }

  // ◇ DREAD CORE SCARCITY (729). Every core faucet in the game reads the one
  // rate in config-v2 (CONFIG.DREAD_CORE_RATE) so total supply is a single
  // decision rather than six unrelated ones. A manifest line that promised cores
  // can now come back empty; the reveal only prints the row when one landed.
  function coreScale(n) {
    try { return window.CONFIG.coreYield(n); } catch (e) { return Math.max(0, Math.round(Number(n) || 0)); }
  }
  function rollManifest(t, integrity) {
    const m = condMult(integrity), L = lvlMul();
    const out = { gold: 0, res: null, lc: 0, cores: 0, missed: [], lvlMul: L };
    const goldMul = t.gold[0] + Math.random() * (t.gold[1] - t.gold[0]);
    out.gold = Math.round(t.cost * goldMul * (0.6 + 0.4 * (integrity / 100)) * L);
    (MANIFEST[t.tier] || []).forEach((r) => {
      const [kind, ch, arg] = r;
      if (Math.random() >= Math.min(0.98, ch * m)) { out.missed.push(rowLabel(kind, arg)); return; }
      if (kind === 'res') {
        const base = t.cost * 0.000045 * (0.8 + Math.random() * 0.6) * L;   // ÷10 — see NON-GOLD ECONOMY
        out.res = { fuel: Math.round(base), iron: Math.round(base), plasma: Math.round(base * 0.7) };
      // 0.1 → 0.05: LootCoin manifest lines halved in the Aug 2026 payout pass
      // (build 614). Gold, resources and Dread Cores are unchanged.
      } else if (kind === 'lc') out.lc += Math.round(arg * 0.05 * (0.8 + Math.random() * 0.5) * Math.min(4, L));
      else if (kind === 'cores') out.cores += coreScale(Math.max(1, Math.round(arg * 0.1 * (0.7 + Math.random() * 0.7) * Math.min(5, L))));
    });
    return out;
  }
  // ===========================================================================
  // WHAT YOU ACTUALLY WIN — the same arithmetic rollManifest runs, quoted as a
  // range. The manifest used to advertise CHANCES only ("Salvage · 100%"),
  // which says nothing about whether the run is worth its entry price. Every
  // figure below is the payout for a CLEAN delivery (100% integrity, the ×1.25
  // condition band) at the pilot's current level, so the sheet can be read
  // straight against the cost.
  // Any change to rollManifest must be mirrored here or the sheet starts lying.
  function payRange(kind, arg, t) {
    const L = lvlMul();
    if (kind === 'gold') return [t.cost * t.gold[0] * L, t.cost * t.gold[1] * L];
    if (kind === 'res')  { const b = t.cost * 0.000045 * L; return [b * 0.8, b * 1.4]; }
    if (kind === 'lc')   return [arg * 0.1 * 0.8 * Math.min(4, L), arg * 0.1 * 1.3 * Math.min(4, L)];
    if (kind === 'cores')return [Math.max(1, arg * 0.1 * 0.7 * Math.min(5, L)), Math.max(1, arg * 0.1 * 1.4 * Math.min(5, L))];
    return null;
  }
  const amtTxt = (lo, hi) => fmt(lo) + ' – ' + fmt(hi);
  // salvage pays three currencies at once; plasma is 70% of the other two
  const resTxt = (t) => { const [lo, hi] = payRange('res', 0, t);
    return '⬢ ' + amtTxt(lo, hi) + '  ◆ ' + amtTxt(lo, hi) + '  ✦ ' + amtTxt(lo * 0.7, hi * 0.7); };

  function rowLabel(kind, arg) {
    return ROWNAME[kind] || kind;
  }

  function grant(p, t) {
    const g = G(), s = g.state;
    s.gold = (s.gold || 0) + p.gold;
    if (p.res) {
      s.resources = s.resources || { fuel: 0, iron: 0, plasma: 0 };
      s.resources.fuel += p.res.fuel; s.resources.iron += p.res.iron; s.resources.plasma += p.res.plasma;
    }
    if (p.lc) s.credits = (s.credits || 0) + p.lc;
    if (p.cores) s.dreadCores = (s.dreadCores || 0) + p.cores;
    g.save(); if (window.UI) window.UI.refreshAll();
    showReveal(p, t);
  }

  // ===========================================================================
  // REVEAL — the second anticipation beat
  // ===========================================================================
  function overlay() {
    let o = $('cd-overlay');
    if (!o) { o = document.createElement('div'); o.id = 'cd-overlay'; ($('screen-cargo') || document.body).appendChild(o); }
    return o;
  }
  function closeOverlay() { const o = $('cd-overlay'); if (o) { o.classList.remove('show'); o.innerHTML = ''; } }

  function showReveal(p, t) {
    const o = overlay(); o.className = 'show';
    const line = (name, val, col, found) =>
      '<div class="cdr-row' + (found ? '' : ' miss') + '"><span class="cdr-n" style="color:' + (found ? col : '#5d6b84') + '">' + name + '</span>' +
      '<b class="cdr-v" style="color:' + (found ? col : '#5d6b84') + '">' + val + '</b></div>';
    let rows = line('Gold', curChip('gold', p.gold), '#f2b24b', true);
    if (p.res) rows += line('Salvage', '<span class="wallet cdr-chips">' + curChip('fuel', p.res.fuel) + curChip('iron', p.res.iron) + curChip('plasma', p.res.plasma) + '</span>', '#8fc4ff', true);
    if (p.lc) rows += line('LootCoins', curChip('credits', p.lc), '#ffd66a', true);
    if (p.cores) rows += line('Dread Cores', curChip('cores', p.cores), '#ff8a96', true);
    p.missed.forEach((m) => { rows += line(m, 'NOT FOUND', '', false); });

    o.innerHTML =
      '<div class="cdr" style="--acc:' + t.accent + '">' +
        '<div class="cdr-kick">CARGO SECURED</div>' +
        '<div class="cdr-t">MANIFEST RECEIVED</div>' +
        '<div class="cdr-sub">' + t.name + ' · ×' + (p.lvlMul || 1).toFixed(1) + ' LEVEL PAYOUT</div>' +
        '<div class="cdr-rows">' + rows + '</div>' +
        '<button class="cdr-ok">COLLECT</button>' +
      '</div>';
    o.querySelector('.cdr-ok').addEventListener('click', closeOverlay);
  }

  function showLoss(t, res) {
    const o = overlay(); o.className = 'show';
    const why = res.reason === 'death' ? 'YOU WENT DOWN WITH HER'
      : res.reason === 'abort' ? 'CARGO ABANDONED'
      : res.reason === 'left' ? 'ESCORT BROKEN OFF'
      : 'CARGO DESTROYED';
    o.innerHTML =
      '<div class="cdr lost">' +
        '<div class="cdr-kick bad">' + why + '</div>' +
        '<div class="cdr-t">MANIFEST LOST</div>' +
        '<div class="cdr-sub">' + t.name + '</div>' +
        (res.hullLost && res.hullLost.levels
          ? '<div class="cdr-hull">☠ <b>' + esc(res.hullLost.ship) + '</b> hull upgrades destroyed — <b>Lv ' + res.hullLost.wasLevel + ' → Lv 1</b>. The ship, its Ship Ascension and every fitted item came home; the shipyard work did not.</div>'
          : res.reason === 'death'
            ? '<div class="cdr-lostline">You went down with her. Your flagship had no upgrade levels to lose — the shipment and the run are gone.</div>'
            : '<div class="cdr-lostline">The shipment never reached the Citadel. The entry price is gone and the run is spent — but your hull upgrades survive.</div>') +
        '<div class="cdr-rows">' +
          '<div class="cdr-row"><span class="cdr-n">Distance covered</span><b class="cdr-v">' + Math.round((res.prog || 0) * 100) + '%</b></div>' +
          '<div class="cdr-row"><span class="cdr-n">Waves survived</span><b class="cdr-v">' + res.waves + '</b></div>' +
          '<div class="cdr-row"><span class="cdr-n">Cargo integrity</span><b class="cdr-v">' + res.integrity + '%</b></div>' +
        '</div>' +
        '<button class="cdr-ok">CLOSE</button>' +
      '</div>';
    o.querySelector('.cdr-ok').addEventListener('click', closeOverlay);
  }

  // ===========================================================================
  // BOOT + CSS
  // ===========================================================================
  // ONE-TIME BACKFILL. c.wins has been counting deliveries since the mode
  // shipped; lifeStats.cargo starts at 0. Seed it from the career record so a
  // veteran's counter is honest — and raise the Tour's live weekly baseline by
  // the same amount, or the seed would instantly hand out a mission the player
  // did not complete this week.
  function seedCargoLife() {
    const g = G(); if (!g || !g.state) return;
    const s = g.state, c = s.cargo; if (!c || s.cargoLifeSeed) return;
    const n = c.wins | 0;
    s.cargoLifeSeed = 1;
    if (n > 0) {
      const L = (s.lifeStats = s.lifeStats || {});
      L.cargo = Math.max(L.cargo | 0, n);
      const t = s.tour;
      if (t && t.bw) t.bw.cargo = Math.max(t.bw.cargo | 0, n);
      if (t && t.bd) t.bd.cargo = Math.max(t.bd.cargo | 0, n);
    }
    try { g.save(); } catch (e) {}
  }
  function boot() { injectCSS(); try { seedCargoLife(); } catch (e) {} }
  function injectCSS() {
    if ($('cd-css')) return;
    const s = document.createElement('style'); s.id = 'cd-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  // The engine calls window.CARGO for the in-battle hooks; forward them to the
  // run module so load order between the two files never matters.
  window.CARGO = {
    render, runsLeft, unlocked, UNLOCK_STARS, TIERS, eternumReq,
    engineTick: (dt, rt) => { if (window.CARGORUN) window.CARGORUN.engineTick(dt, rt); },
    engineRender: (ctx, t, rt) => { if (window.CARGORUN) window.CARGORUN.engineRender(ctx, t, rt); },
    onDeath: () => { if (window.CARGORUN) window.CARGORUN.onDeath(); },
  };

  const CSS = `
  .mega-card.cmd-cargo .mc-ic{ color:#ffb347; border-color:rgba(255,179,71,.5); background:radial-gradient(120% 120% at 50% 0%,#2a1c10,#141017); box-shadow:0 0 14px -3px rgba(255,179,71,.7); }

  .cd-top{ display:grid; grid-template-columns:1fr 1.15fr; gap:10px; }
  @media (max-width:620px){ .cd-top{ grid-template-columns:1fr; } }
  .cd-runs{ border:1px solid rgba(255,179,71,.35); border-radius:14px; padding:12px 13px; background:linear-gradient(180deg,#1a1409,#0d1119); display:flex; flex-direction:column; gap:5px; }
  .cd-runs.out{ border-color:rgba(226,59,78,.4); }
  .cd-runs-k{ font:800 10px/1 'Rajdhani',sans-serif; letter-spacing:.16em; color:#ffb347; }
  .cd-runs-v{ font-family:'Orbitron',sans-serif; font-size:24px; color:#ffe0a8; line-height:1; }
  .cd-runs-s{ font-size:11px; color:#8ba0b5; line-height:1.45; }
  .cd-runs-fine{ font-size:10px; color:#6d7f95; }
  .cd-buyrun{ margin-top:5px; border:1px solid rgba(255,214,106,.5); border-radius:10px; background:rgba(255,214,106,.1); color:#ffd66a;
    font:800 11.5px/1 'Rajdhani',sans-serif; letter-spacing:.06em; padding:9px 8px; cursor:pointer; }
  .cd-buyrun:active{ transform:scale(.98); }
  .cd-pro-hint{ font-size:10.5px; color:#8ba0b5; margin-top:4px; }
  .cd-rules{ border:1px solid #22304a; border-radius:14px; padding:12px 13px; background:#0c1119; display:flex; flex-direction:column; gap:4px; }
  .cd-rules-t{ font:800 10px/1 'Rajdhani',sans-serif; letter-spacing:.16em; color:#8fb4dd; margin-bottom:3px; }
  .cd-rules-l{ font-size:11.5px; color:#cfe0f5; display:flex; align-items:center; gap:7px; }
  .cd-rules-l i{ font-style:normal; color:#ff5a6a; font-weight:800; font-size:11px; }
  .cd-rules-n{ font-size:10.5px; color:#8ba0b5; line-height:1.45; margin-top:6px; }
  .cd-rules-f{ font-size:10.5px; color:#8ba0b5; line-height:1.45; margin-top:6px; }
  .cd-warn-hull{ margin-top:9px; border:1px solid rgba(226,59,78,.55); border-radius:11px; padding:9px 10px;
    background:linear-gradient(180deg,rgba(226,59,78,.16),rgba(226,59,78,.05)); }
  .cd-wh-t{ font:800 11px/1.2 'Rajdhani',sans-serif; letter-spacing:.1em; color:#ff8a96; }
  .cd-wh-s{ font-size:11px; color:#d9c3c7; line-height:1.5; margin-top:5px; }
  .cd-wh-s b{ color:#ffd7dc; }

  .cd-sec-t{ font:800 11px/1 'Rajdhani',sans-serif; letter-spacing:.18em; color:#8fb4dd; margin:16px 0 6px; }
  .cd-intro{ font-size:11.5px; color:#8ba0b5; line-height:1.5; margin-bottom:9px; }
  .cd-grid{ display:grid; grid-template-columns:minmax(0,1fr); gap:9px; }
  .cd-grid>*{ width:100%; box-sizing:border-box; }
  .cd-card{ width:100%; box-sizing:border-box; text-align:left; border:1px solid color-mix(in srgb,var(--acc) 40%,#1d2942); border-radius:14px; padding:12px 13px; cursor:pointer;
    background:linear-gradient(180deg,color-mix(in srgb,var(--acc) 8%,#0e1725),#0b1220); display:grid; grid-template-columns:78px 1fr; gap:12px; align-items:center; position:relative; overflow:hidden; }
  .cd-c-art{ display:grid; place-items:center; align-self:stretch; }
  .cd-c-art img{ width:100%; max-width:74px; height:auto; max-height:118px; object-fit:contain;
    filter:drop-shadow(0 0 12px color-mix(in srgb,var(--acc) 60%,transparent)) drop-shadow(0 3px 8px rgba(0,0,0,.6)); }
  .cd-c-main{ min-width:0; min-width:0; display:flex; flex-direction:column; gap:5px; }
  .cdm-hero{ display:grid; place-items:center; padding:4px 0 2px; }
  .cdm-hero img{ width:auto; max-width:58%; max-height:190px; object-fit:contain;
    filter:drop-shadow(0 0 20px color-mix(in srgb,var(--acc) 65%,transparent)) drop-shadow(0 6px 14px rgba(0,0,0,.7)); }
  .cd-card::after{ content:''; position:absolute; inset:0 0 auto 0; height:2px; background:linear-gradient(90deg,transparent,var(--acc),transparent); opacity:.65; }
  .cd-card:active{ transform:scale(.995); }
  .cd-card.poor{ opacity:.62; }
  .cd-c-head{ display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .cd-c-tier{ font:800 10px/1 'Rajdhani',sans-serif; letter-spacing:.16em; color:var(--acc); }
  .cd-c-risk{ font:800 9px/1 'Rajdhani',sans-serif; letter-spacing:.12em; color:#0a0f16; background:var(--acc); border-radius:999px; padding:4px 8px; }
  .cd-c-name{ font-family:'Orbitron',sans-serif; font-size:14px; color:#eef4fb; letter-spacing:.02em; }
  .cd-c-blurb{ font-size:11px; color:#8ba0b5; line-height:1.45; }
  /* THE CONTRACT STRIP — one divided row, read left to right in the order the
     decision is made: cost → payout → what is coming at you. Cells flex, so it
     folds to two lines on a narrow phone instead of crushing. */
  /* FIXED COLUMNS, so all five shipments line up as a table the eye can scan
     DOWN. Flexing each strip to its own content made every card a different
     shape — the whole point of the strip is that Cargo I's cost sits directly
     above Cargo V's. Values never wrap; the payout column takes the slack. */
  .cd-strip{ width:100%; box-sizing:border-box; display:grid; grid-template-columns:84px minmax(0,1fr) 78px 70px 54px; margin-top:7px;
    background:#0a1018; border:1px solid #1c2940; border-radius:11px; overflow:hidden; }
  .cd-s{ display:flex; flex-direction:column; justify-content:center; gap:2px; padding:7px 9px; border-left:1px solid #1c2940; min-width:0; }
  .cd-s:first-child{ border-left:0; }
  .cd-s i{ font-style:normal; font:800 8px/1 'Rajdhani',sans-serif; letter-spacing:.14em; color:#6d7f95; white-space:nowrap; }
  .cd-s b{ font-family:'Orbitron',sans-serif; font-size:13.5px; font-weight:800; color:#e7f0fa; line-height:1.1;
    font-variant-numeric:tabular-nums; letter-spacing:-.02em; white-space:nowrap; }
  .cd-s b.hot{ color:#ff8a96; }
  .cd-s em{ font-style:normal; font-size:9px; color:#8ba0b5; white-space:nowrap; }
  .cd-s-cost{ box-shadow:inset 3px 0 0 #f2b24b; padding-left:12px; }
  .cd-s-cost b{ color:#f2b24b; font-size:15px; }
  .cd-s-cost.bad{ box-shadow:inset 3px 0 0 #ff6a78; }
  .cd-s-cost.bad b{ color:#ff6a78; }
  .cd-s-pay{ box-shadow:inset 3px 0 0 #7ce0a0; padding-left:12px; }
  .cd-s-pay b{ color:#7ce0a0; font-size:15px; }
  /* Narrow phones: two tidy rows — the money on top, the threat underneath —
     still on a fixed grid, so the cards go on lining up with each other. */
  @media (max-width:600px){
    .cd-strip{ grid-template-columns:repeat(3,1fr); }
    .cd-s-cost{ grid-column:1 / 2; }
    .cd-s-pay{ grid-column:2 / 4; }
    .cd-s:nth-child(n+3){ border-top:1px solid #1c2940; }
    .cd-s:nth-child(3){ border-left:0; }
    .cd-s b{ font-size:12.5px; }
    .cd-s-cost b,.cd-s-pay b{ font-size:13.5px; }
  }
  .cd-plus{ display:flex; flex-wrap:wrap; align-items:baseline; gap:2px 11px; margin-top:5px; padding:0 2px;
    font-family:'Orbitron',sans-serif; font-size:10.5px; font-weight:800; font-variant-numeric:tabular-nums; }
  .cd-plus i{ font-style:normal; font-family:'Rajdhani',sans-serif; font-size:8px; font-weight:800; letter-spacing:.14em; color:#6d7f95; }
  .cd-c-rows{ display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
  .cd-c-row{ display:flex; flex-direction:column; gap:2px; background:#0a1018; border:1px solid #1c2940; border-radius:9px; padding:6px 9px; }
  .cd-c-row i{ font-style:normal; font:800 8.5px/1 'Rajdhani',sans-serif; letter-spacing:.13em; color:#6d7f95; }
  .cd-c-row b{ font-size:12px; color:#e7f0fa; font-variant-numeric:tabular-nums; }
  .cd-c-row b em{ font-style:normal; font-size:10px; color:#8ba0b5; font-weight:600; }
  .cd-c-row b.bad{ color:#ff8a96; }

  .cd-rec{ display:grid; grid-template-columns:repeat(4,1fr); gap:7px; margin-top:12px; }
  .cd-rec-i{ background:#0b1220; border:1px solid #1c2940; border-radius:11px; padding:9px 6px; text-align:center; }
  .cd-rec-i b{ display:block; font-family:'Orbitron',sans-serif; font-size:15px; color:#ffd88a; }
  .cd-rec-i.bad b{ color:#ff8a96; }
  .cd-rec-i span{ font-size:9.5px; color:#7d8fa5; }

  .cd-locked{ border:1px solid #24314a; border-radius:16px; padding:22px 18px; background:linear-gradient(180deg,#0f1626,#0a0f18); text-align:center; }
  .cd-lock-ic{ font-size:30px; }
  .cd-lock-t{ font-family:'Orbitron',sans-serif; font-size:16px; color:#eef4fb; margin:8px 0 6px; }
  .cd-lock-s{ font-size:12.5px; color:#b9cbe0; line-height:1.6; }
  .cd-lock-b{ font-size:11.5px; color:#8ba0b5; line-height:1.6; margin-top:10px; }

  .cd-eternum{ margin-top:14px; border:1px solid rgba(91,124,255,.45); border-radius:16px; padding:14px; position:relative; overflow:hidden;
    background:radial-gradient(120% 90% at 70% 0%,#16203c,#080c14); display:grid; grid-template-columns:170px 1fr; gap:14px; align-items:center; }
  @media (max-width:620px){ .cd-eternum{ grid-template-columns:1fr; } }
  .cd-eternum.owned{ border-color:rgba(159,208,255,.8); box-shadow:0 0 26px -10px rgba(120,180,255,.8); }
  .cd-et-art{ display:grid; place-items:center; position:relative; }
  .cd-et-art img{ width:100%; max-width:200px; height:auto; filter:drop-shadow(0 0 22px rgba(110,170,255,.65)); }
  .cd-et-kick{ font:800 9.5px/1 'Rajdhani',sans-serif; letter-spacing:.2em; color:#8fb4ff; }
  .cd-et-name{ font-family:'Orbitron',sans-serif; font-size:22px; color:#eaf2ff; letter-spacing:.06em; margin:3px 0; }
  .cd-et-motto{ font-size:11.5px; color:#9fb6d8; font-style:italic; margin-bottom:7px; }
  .cd-et-line{ font-size:11.5px; color:#c3d6ee; line-height:1.55; }
  .cd-et-reqs{ margin-top:9px; border-top:1px solid #1e2b45; padding-top:8px; display:flex; flex-direction:column; gap:4px; }
  .cd-et-reqh{ font:800 9px/1 'Rajdhani',sans-serif; letter-spacing:.16em; color:#7d8fa5; margin-bottom:2px; }
  .cd-et-req{ display:flex; align-items:center; gap:8px; font-size:11.5px; color:#8ba0b5; }
  .cd-et-req.ok{ color:#cfe6ff; }
  .cd-et-tick{ width:15px; text-align:center; color:#5d6b84; font-weight:800; }
  .cd-et-req.ok .cd-et-tick{ color:#7ce0a0; }
  .cd-et-lab{ flex:1; }
  .cd-et-req b{ font-variant-numeric:tabular-nums; color:#e7f0fa; }
  .cd-et-bill{ margin-top:9px; border-top:1px solid #1e2b45; padding-top:8px; }
  .cd-et-cost{ display:flex; flex-wrap:wrap; gap:6px; }
  .cd-et-cost .cd-dim{ opacity:.42; }
  .cd-et-cost .gold-chip,.cd-et-cost .res-chip{ margin:0; }
  .cd-et-go{ margin-top:10px; width:100%; border:none; border-radius:12px; padding:12px; cursor:pointer;
    font:800 13px/1 'Rajdhani',sans-serif; letter-spacing:.08em; color:#061229; background:linear-gradient(180deg,#eaf3ff,#7ea8ff); box-shadow:0 8px 22px -8px rgba(120,170,255,.8); }
  .cd-et-go:active{ transform:scale(.985); }
  .cd-et-built{ margin-top:10px; text-align:center; font:800 12px/1 'Rajdhani',sans-serif; letter-spacing:.08em; color:#9fd0ff;
    border:1px solid rgba(159,208,255,.5); border-radius:11px; padding:11px; }
  .cd-et-blocked{ margin-top:10px; text-align:center; font-size:11.5px; font-weight:700; color:#8ba0b5;
    border:1px dashed #2b3a55; border-radius:11px; padding:11px; }

  .cdm{ display:flex; flex-direction:column; gap:8px; }
  .cdm-head{ display:flex; align-items:center; gap:9px; }
  .cdm-risk{ font:800 9px/1 'Rajdhani',sans-serif; letter-spacing:.12em; color:#0a0f16; background:var(--acc); border-radius:999px; padding:4px 8px; }
  .cdm-t{ font-family:'Orbitron',sans-serif; font-size:15px; color:#eef4fb; }
  .cdm-blurb{ font-size:11.5px; color:#8ba0b5; line-height:1.5; }
  .cdm-sec{ font:800 10px/1 'Rajdhani',sans-serif; letter-spacing:.18em; color:#7d8fa5; margin-top:2px; }
  .cdm-rows{ display:flex; flex-direction:column; gap:1px; background:#111a28; border:1px solid #1e2b45; border-radius:11px; overflow:hidden; }
  .cdm-cost{ display:flex; flex-direction:column; gap:2px; background:#0b1220; border:1px solid #2a3a58; border-radius:12px; padding:10px 13px; }
  .cdm-pay{ display:flex; flex-direction:column; gap:1px; background:#111a28; border:1px solid #1e2b45; border-radius:12px; overflow:hidden; }
  .cdm-p{ display:flex; align-items:center; gap:11px; padding:9px 12px; background:#0b1220; border-left:3px solid var(--c); }
  .cdm-p-hero{ background:#0e1526; padding:11px 12px; }
  .cdm-p-l{ display:flex; flex-direction:column; gap:2px; min-width:0; flex:1; }
  .cdm-p-k{ font:800 9px/1 'Rajdhani',sans-serif; letter-spacing:.18em; color:#7d8fa5; }
  .cdm-p-v{ font-family:'Orbitron',sans-serif; font-size:19px; font-weight:800; color:var(--c); line-height:1.1; font-variant-numeric:tabular-nums; letter-spacing:-.01em; }
  .cdm-p-l em{ font-style:normal; font-size:10.5px; color:#8ba0b5; }
  .cdm-p-res{ display:flex; flex-wrap:wrap; gap:4px 14px; font-family:'Orbitron',sans-serif; font-size:14px; font-weight:800; font-variant-numeric:tabular-nums; }
  .cdm-p-res i{ font-style:normal; }
  .cdm-p-ch{ font-family:'Orbitron',sans-serif; font-size:15px; font-weight:800; color:#e7f0fa; font-variant-numeric:tabular-nums; flex:none; }
  .cdm-p-loot{ padding:8px 12px; }
  .cdm-p-sw{ width:26px; height:26px; flex:none; border-radius:7px; background:color-mix(in srgb,var(--c) 22%,#0b1220); border:1px solid var(--c); box-shadow:0 0 12px -4px var(--c); }
  .cdm-p-nm{ font-family:'Orbitron',sans-serif; font-size:14px; font-weight:800; color:var(--c); line-height:1.15; }
  .cdm-row{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 11px; background:#0b1220; }
  .cdm-r-n{ font-size:11.5px; color:#cfe0f5; }
  /* PAYOUT BLOCK — the numbers are the design. Currency reads at wallet scale
     in its own colour; components borrow the loot screen's rarity swatch. */
  .cdm-cost{ display:flex; flex-direction:column; gap:1px; background:#0b1220; border:1px solid #2a3a58; border-left:3px solid #f2b24b; border-radius:12px; padding:9px 13px; }
  .cdm-cost.bad{ border-left-color:#ff6a78; }
  .cdm-cost-v{ font-family:'Orbitron',sans-serif; font-size:24px; font-weight:800; color:#f2b24b; line-height:1.05; font-variant-numeric:tabular-nums; }
  .cdm-cost.bad .cdm-cost-v{ color:#ff6a78; }
  .cdm-cost em{ font-style:normal; font-size:10.5px; color:#8ba0b5; }
  .cdm-pay{ display:flex; flex-direction:column; gap:1px; background:#111a28; border:1px solid #1e2b45; border-radius:12px; overflow:hidden; }
  .cdm-p{ display:flex; align-items:center; gap:11px; padding:8px 12px; background:#0b1220; border-left:3px solid var(--c); }
  .cdm-p-hero{ background:#0e1526; padding:10px 12px; }
  .cdm-p-l{ display:flex; flex-direction:column; gap:1px; min-width:0; flex:1; }
  .cdm-p-k{ font:800 9px/1 'Rajdhani',sans-serif; letter-spacing:.18em; color:#7d8fa5; }
  .cdm-p-v{ font-family:'Orbitron',sans-serif; font-size:22px; font-weight:800; color:var(--c); line-height:1.05; font-variant-numeric:tabular-nums; letter-spacing:-.015em; }
  .cdm-p-l em{ font-style:normal; font-size:10.5px; color:#8ba0b5; }
  .cdm-p-res{ display:flex; flex-wrap:wrap; gap:1px 16px; font-family:'Orbitron',sans-serif; font-size:15px; font-weight:800; font-variant-numeric:tabular-nums; line-height:1.25; }
  .cdm-p-res i{ font-style:normal; }
  .cdm-p-ch{ font-family:'Orbitron',sans-serif; font-size:15px; font-weight:800; color:#e7f0fa; font-variant-numeric:tabular-nums; flex:none; }
  .cdm-p-loot{ padding:7px 12px; }
  .cdm-p-sw{ width:28px; height:28px; flex:none; border-radius:8px; background:var(--c); opacity:.9; border:1px solid var(--c); box-shadow:0 0 14px -4px var(--c); }
  .cdm-p-nm{ font-family:'Orbitron',sans-serif; font-size:15px; font-weight:800; color:var(--c); line-height:1.15; }
  .cdm-r-c{ font-size:12px; font-weight:800; color:#e7f0fa; font-variant-numeric:tabular-nums; }
  .cdm-cond{ font-size:10.5px; color:#8ba0b5; line-height:1.5; }
  .cdm-stats{ display:flex; gap:7px; flex-wrap:wrap; }
  .cdm-stats span{ flex:1; min-width:96px; display:flex; flex-direction:column; gap:3px; background:#0a1018; border:1px solid #1c2940; border-radius:10px; padding:7px 9px; }
  .cdm-stats i{ font-style:normal; font:800 8.5px/1 'Rajdhani',sans-serif; letter-spacing:.13em; color:#6d7f95; }
  .cdm-stats b{ font-size:12.5px; color:#e7f0fa; font-variant-numeric:tabular-nums; }
  .cdm-stats b.bad{ color:#ff8a96; }
  .cdm-hull{ font-size:11px; color:#ffb9c1; background:rgba(226,59,78,.12); border:1px solid rgba(226,59,78,.4); border-radius:10px; padding:8px 10px; line-height:1.5; }
  .cdm-go{ border:none; border-radius:12px; padding:13px; font:800 14px/1 'Rajdhani',sans-serif; letter-spacing:.08em; cursor:pointer;
    color:#08111a; background:linear-gradient(180deg,#ffe08a,#f2b24b); box-shadow:0 8px 22px -8px rgba(242,178,75,.7); }
  .cdm-go:active{ transform:scale(.98); }
  .cdm-blocked{ text-align:center; font-size:12px; font-weight:700; color:#ff8a96; border:1px dashed rgba(226,59,78,.5); border-radius:11px; padding:11px; }
  .cdm-x{ background:none; border:none; color:#7d8fa5; font-size:12px; cursor:pointer; padding:4px; }

  #cd-overlay{ position:absolute; inset:0; z-index:16; display:none; align-items:center; justify-content:center; padding:16px;
    background:rgba(5,8,14,.86); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); }
  #cd-overlay.show{ display:flex; }
  .cdr{ width:100%; max-width:420px; max-height:100%; overflow:auto; border:1px solid color-mix(in srgb,var(--acc,#5b7cff) 45%,#1d2942); border-radius:18px; padding:18px;
    background:linear-gradient(180deg,#111a2b,#080c14); text-align:center; }
  .cdr-kick{ font:800 10px/1 'Rajdhani',sans-serif; letter-spacing:.2em; color:#7ce0a0; }
  .cdr-kick.bad{ color:#ff5a6a; }
  .cdr-t{ font-family:'Orbitron',sans-serif; font-size:19px; color:#eef4fb; margin:6px 0 2px; }
  .cdr-sub{ font-size:11px; color:#8ba0b5; letter-spacing:.08em; margin-bottom:12px; }
  .cdr-rows{ display:flex; flex-direction:column; gap:1px; background:#111a28; border:1px solid #1e2b45; border-radius:12px; overflow:hidden; text-align:left; }
  .cdr-row{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding:9px 12px; background:#0b1220; }
  .cdr-row.miss{ background:#080d15; }
  .cdr-n{ font-size:11.5px; }
  .cdr-v{ font-size:12px; font-variant-numeric:tabular-nums; text-align:right; }
  .cdr-chips,.cdr-v .gold-chip,.cdr-v .res-chip{ display:inline-flex; }
  .cdr-chips{ gap:5px; }
  .cdr-note{ font-size:10.5px; color:#8ba0b5; margin-top:8px; }
  .cdr-lostline{ font-size:12px; color:#b9cbe0; line-height:1.6; margin-bottom:12px; }
  .cdr-hull{ font-size:12px; color:#ffb9c1; line-height:1.6; margin-bottom:12px; background:rgba(226,59,78,.12); border:1px solid rgba(226,59,78,.45); border-radius:12px; padding:10px 12px; }
  .cdr-ok{ margin-top:14px; width:100%; border:none; border-radius:12px; padding:13px; font:800 14px/1 'Rajdhani',sans-serif; letter-spacing:.08em; cursor:pointer;
    color:#08111a; background:linear-gradient(180deg,#ffe08a,#f2b24b); }
  .cdr-et{ margin:0 0 14px; border:1px solid rgba(159,208,255,.6); border-radius:14px; padding:12px; background:radial-gradient(110% 90% at 50% 0%,#1a2645,#080c14); }
  .cdr-et img{ width:100%; max-width:250px; height:auto; filter:drop-shadow(0 0 24px rgba(120,180,255,.9)); }
  .cdr-et-s{ font:800 9.5px/1 'Rajdhani',sans-serif; letter-spacing:.16em; color:#8fb4ff; margin-top:6px; }
  .cdr-et-lock{ font-size:10.5px; color:#9fb6d8; margin-top:8px; line-height:1.5; font-style:italic; }
  `;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  setTimeout(boot, 1000);
})();
