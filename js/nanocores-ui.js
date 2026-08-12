/* =============================================================================
   nanocores-ui.js — NANOCORES screens
   ---------------------------------------------------------------------------
   Three surfaces, one renderer each:
     • HOME (Command ▸ Nanocores) — every hull's four core slots, ownership at a
       glance, duplicate exchange, and the way in to management.
     • MANAGEMENT — a detail view inside the same screen (no second screen to
       register, no sheet to fight the fit contract): base bonuses, slot
       unlocking, buff rolls and locks.
     • CRATE TAB — the Nanocore Crate, rendered into the unified Crates screen.
   Every number shown is quoted from NANO.CFG, so a balance change is a UI
   change with no edits here.
   -------------------------------------------------------------------------- */
(function () {
  'use strict';
  const N = () => window.NANO;
  const G = () => window.GAME;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const toast = (m, c) => { try { window.SOCIAL.toast(m, c || '#c9a0ff'); } catch (e) {} };

  let view = null;          // null = roster · {ship, r} = management
  let filter = 'mine';      // mine | owned | all
  let crateRes = null;      // last crate result, shown under the crate card

  const money = (v) => N().fmt(v);
  // A core pays IN FULL on the hull you fly and at the fleet share on a hull
  // flying as an escort. Everything the UI says about a core being live reads
  // from here.
  const sharePct = () => Math.round(N().share() * 100);
  function where(key) {
    try {
      const g = window.GAME;
      if (g.state.ship === key) return 'flying';
      if (N().fleetKeys().indexOf(key) >= 0) return 'fleet';
      return N().ownsHull(key) ? 'hangar' : 'none';
    } catch (e) { return 'none'; }
  }
  const pct = (v) => (Math.round(v * 10) / 10) + '%';
  const buffLine = (b) => { const d = N().BY_B[b.k]; return d ? d.name + ' +' + pct(b.v) : ''; };
  // A rolled buff, painted on the loot scale: the VALUE takes its grade colour and
  // carries the grade name, so how good the roll was is readable at a glance
  // rather than something you work out against the pool ranges.
  function buffHtml(b) {
    const n = N(), d = n.BY_B[b.k]; if (!d) return '';
    const g = n.grade(b), p = Math.round(n.rollPos(b) * 100);
    return '<span class="nc-bn">' + d.name + '</span>' +
      '<b class="nc-bv" style="--g:' + g.col + '">+' + pct(b.v) + '</b>' +
      '<span class="nc-bg" style="--g:' + g.col + '" title="' + p + '% of the ' + d.min + '\u2013' + d.max + '% range">' + g.name.toUpperCase() + '</span>';
  }

  // ===========================================================================
  // HOME
  // ===========================================================================
  function render() {
    const body = $('nano-body'); if (!body) return;
    const n = N(); if (!n) return;
    const sub = $('nano-sub');
    const t = n.tally();
    if (sub) sub.textContent = t.owned + ' / ' + t.total + ' cores · ◈ ' + money(n.prism());
    if (!n.unlocked()) { body.innerHTML = lockHtml(); return; }
    body.innerHTML = view ? manageHtml(view.ship, view.r) : rosterHtml(t);
    wire(body);
  }

  function lockHtml() {
    const n = N(), lv = n.CFG.gate.level;
    return '<div class="nc-lock"><div class="nc-lock-ic">◈</div>' +
      '<h3>NANOCORES</h3>' +
      '<p>Opens at <b>Level ' + lv + '</b>. Cores are bought and upgraded with <b>◈ Prism Ingots</b>.</p>' +
      '<p class="nc-dim">Every hull in the fleet has five cores, one per loot rarity — Common through Legendary. Rarity pays a guaranteed damage, health and speed bonus; everything above Common also carries extra buff slots you unlock and reroll.</p></div>';
  }

  function rosterHtml(t) {
    const n = N();
    const list = n.ships();
    const rows = list.filter((s) => {
      if (filter === 'all') return true;
      if (filter === 'owned') return n.ownsHull(s.key);
      return n.RKEYS.some((r) => n.has(s.key, r));
    });
    const chips = (id, on, label, badge) =>
      '<button class="nc-fchip' + (on ? ' on' : '') + '" data-nfilter="' + id + '">' + label + (badge ? '<span class="nc-fb">' + badge + '</span>' : '') + '</button>';
    const mine = list.filter((s) => n.RKEYS.some((r) => n.has(s.key, r))).length;
    return '<div class="nc-hero">' +
        '<div class="nc-hero-ic">◈</div>' +
        '<div class="nc-hero-txt"><div class="nc-hero-n">' + t.owned + ' <span>/ ' + t.total + ' CORES</span></div>' +
          '<div class="nc-hero-s">◈ ' + money(n.prism()) + ' Prism Ingots banked</div></div>' +
        '<button class="nc-cta" data-ngo="crates">GET CORES</button>' +
      '</div>' +
      '<p class="nc-intro">One core is equipped per hull. It pays <b>in full</b> on the hull you fly and at <b>' + sharePct() + '%</b> on a hull flying as an escort in your fleet — the same share an escort\u2019s own hull mods pay. Cores drop for <b>any ship in the game</b>, so one for a hull you have not built yet is banked progress waiting for it.</p>' +
      exchangeHtml() +
      '<div class="nc-filters">' + chips('mine', filter === 'mine', 'MY CORES', mine || '') +
        chips('owned', filter === 'owned', 'MY HULLS') + chips('all', filter === 'all', 'EVERY SHIP') + '</div>' +
      (rows.length ? rows.map(shipRow).join('')
        : '<div class="nc-empty">No cores yet. Open a <b>Nanocore Crate</b> and the first one lands here.</div>');
  }

  function rowStatus(s, w) {
    if (w === 'flying') return '\u25b8 FLAGSHIP · core pays in full';
    if (w === 'fleet') return '\u25b8 FLYING ESCORT · core pays at ' + sharePct() + '%';
    if (w === 'hangar') return esc(s.cls) + ' class · docked in your hangar';
    return 'hull not built — cores bank until it is';
  }
  function shipRow(s) {
    const n = N(), own = n.ownsHull(s.key), w = where(s.key);
    return '<div class="nc-row' + (own ? '' : ' nohull') + '">' +
      '<div class="nc-row-h"><img class="nc-thumb" src="ships/ship-' + s.key + '.png" alt="" loading="lazy">' +
        '<div class="nc-row-t"><div class="nc-row-n">' + esc(s.name) + '</div>' +
          '<div class="nc-row-s ' + w + '">' + rowStatus(s, w) + '</div></div></div>' +
      '<div class="nc-chips">' + n.RAR.map((r) => chipHtml(s.key, r)).join('') + '</div></div>';
  }

  function chipHtml(ship, r) {
    const n = N(), c = n.coreAt(ship, r.k), eq = n.equipped(ship) === r.k;
    if (!c) {
      return '<div class="nc-chip off" title="' + esc(r.name) + ' — not owned"><span class="nc-chip-r">' + r.name.toUpperCase() + '</span>' +
        '<span class="nc-chip-v">+' + r.dmg + '% / +' + r.hp + '% / +' + r.spd + '%</span></div>';
    }
    const max = r.slots;
    return '<button class="nc-chip' + (eq ? ' eq' : '') + '" style="--c:' + r.col + '" data-ncore="' + ship + '|' + r.k + '">' +
      '<span class="nc-chip-r">' + r.name.toUpperCase() + (eq ? ' ✓' : '') + '</span>' +
      '<span class="nc-chip-v">+' + r.dmg + '% DMG · +' + r.hp + '% HP · +' + r.spd + '% SPD</span>' +
      (max ? '<span class="nc-chip-sl">' + c.slots + ' / ' + max + ' buff slots' + (c.slots < max ? ' · ' + c.stage + '/' + n.CFG.upgrade.perSlot : '') + '</span>' : '<span class="nc-chip-sl">no buff slots</span>') +
      '</button>';
  }

  function exchangeHtml() {
    const n = N(), s = n.ensure(); if (!s) return '';
    const rows = n.RAR.filter((r) => n.nextRarity(r.k)).map((r) => {
      const have = s.dupes[r.k] || 0, need = n.CFG.exchange.ratio, up = n.BY_R[n.nextRarity(r.k)];
      const ok = have >= need;
      return '<div class="nc-ex-row' + (ok ? ' ok' : '') + '">' +
        '<span class="nc-dot" style="background:' + r.col + '"></span>' +
        '<span class="nc-ex-t">' + need + ' ' + r.name.toUpperCase() + ' dupes → 1 ' + up.name.toUpperCase() + '</span>' +
        '<span class="nc-ex-n" style="color:' + (ok ? r.col : '#6f7f99') + '">' + have + ' / ' + need + '</span>' +
        '<button class="nc-ex-b" data-nex="' + r.k + '"' + (ok ? '' : ' disabled') + '>TRADE</button></div>';
    }).join('');
    return '<div class="nc-panel"><div class="nc-panel-h">⇄ DUPLICATE EXCHANGE</div>' +
      '<p class="nc-dim">A core you already own arrives as a duplicate. Trade ' + n.CFG.exchange.ratio + ' of a rarity for one random core of the rarity above — eligible dupes are counted for you.</p>' +
      rows + '</div>';
  }

  // ===========================================================================
  // MANAGEMENT
  // ===========================================================================
  function manageHtml(ship, rk) {
    const n = N(), r = n.BY_R[rk], c = n.coreAt(ship, rk);
    if (!c) { view = null; return rosterHtml(n.tally()); }
    const eq = n.equipped(ship) === rk, own = n.ownsHull(ship), w = where(ship);
    const head = '<button class="nc-back" data-nback="1">‹ ALL CORES</button>' +
      '<div class="nc-mh" style="--c:' + r.col + '">' +
        '<img class="nc-mh-img" src="ships/ship-' + ship + '.png" alt="">' +
        '<div><div class="nc-mh-n">' + esc(n.coreName(ship, rk)) + '</div>' +
          '<div class="nc-mh-r">' + r.name.toUpperCase() + ' · ' + esc(n.shipName(ship)) + '</div></div>' +
        (eq ? '<span class="nc-mh-eq">EQUIPPED</span>'
            : '<button class="nc-mh-b" data-nequip="' + ship + '|' + rk + '">EQUIP</button>') +
      '</div>' +
      (eq ? '<div class="nc-live ' + w + '">' + liveLine(w) + '</div>' : '') +
      (own ? '' : '<div class="nc-warn">You do not own this hull yet — the bonuses start paying the moment you fly it or slot it into your fleet.</div>') +
      '<div class="nc-panel"><div class="nc-panel-h">BASE BONUSES · guaranteed</div>' +
        '<div class="nc-base">' + [['DAMAGE', r.dmg], ['HEALTH', r.hp], ['SHIP SPEED', r.spd]].map((b) =>
          '<div class="nc-base-i"><div class="nc-base-v" style="color:' + r.col + '">+' + b[1] + '%</div><div class="nc-base-l">' + b[0] + '</div></div>').join('') +
        '</div></div>';
    if (!r.slots) {
      return head + '<div class="nc-panel"><div class="nc-panel-h">EXTRA BUFFS</div>' +
        '<p class="nc-dim">' + r.name.toUpperCase() + ' cores have no extra buff slots and cannot be upgraded. Trade ' +
        n.CFG.exchange.ratio + ' duplicates for the rarity above to start rolling buffs.</p></div>';
    }
    return head + upgradeHtml(ship, rk, c, r) + buffsHtml(ship, rk, c, r);
  }

  function liveLine(w) {
    if (w === 'flying') return '\u25c9 LIVE · paying in full on your flagship';
    if (w === 'fleet') return '\u25c9 LIVE · paying at ' + sharePct() + '% as a fleet escort';
    if (w === 'hangar') return '\u25cb DOCKED · pays as soon as this hull flies or joins your fleet';
    return '\u25cb NOT BUILT · pays once you own the hull';
  }
  function upgradeHtml(ship, rk, c, r) {
    const n = N(), slot = n.workSlot(c), per = n.CFG.upgrade.perSlot;
    if (!slot) {
      return '<div class="nc-panel"><div class="nc-panel-h">UPGRADES</div>' +
        '<p class="nc-dim">All <b>' + r.slots + '</b> extra buff slots are unlocked. Nothing left to upgrade — everything now rides on the rolls.</p></div>';
    }
    const stage = c.stage + 1, cost = n.upCost(slot, stage), chance = n.upChance(c, slot, stage);
    const afford = n.prism() >= cost;
    const fails = (c.fail && c.fail[slot + ':' + stage]) || 0;
    const dots = [];
    for (let i = 1; i <= per; i++) dots.push('<span class="nc-dot-s' + (i <= c.stage ? ' on' : i === stage ? ' now' : '') + '" style="--c:' + r.col + '"></span>');
    return '<div class="nc-panel"><div class="nc-panel-h">EXTRA BUFF SLOT ' + slot + ' <span class="nc-h-r">' + c.stage + ' / ' + per + '</span></div>' +
      '<div class="nc-dots">' + dots.join('') + '</div>' +
      '<div class="nc-ug">' +
        '<div class="nc-ug-i"><div class="nc-ug-v">' + Math.round(chance) + '%</div><div class="nc-ug-l">SUCCESS CHANCE' + (fails ? ' · +' + (fails * n.CFG.upgrade.failBonus) + ' from ' + fails + ' fail' + (fails > 1 ? 's' : '') : '') + '</div></div>' +
        '<div class="nc-ug-i"><div class="nc-ug-v' + (afford ? '' : ' short') + '">◈ ' + money(cost) + '</div><div class="nc-ug-l">UPGRADE ' + stage + ' OF ' + per + '</div></div>' +
      '</div>' +
      '<button class="nc-btn big" data-nup="' + ship + '|' + rk + '"' + (afford ? '' : ' disabled') + '>UPGRADE</button>' +
      '<p class="nc-dim sm">Ingots are spent whether the upgrade lands or not. A failure raises <b>this</b> attempt\u2019s chance by ' + n.CFG.upgrade.failBonus + ' points until it succeeds.</p></div>';
  }

  function buffsHtml(ship, rk, c, r) {
    const n = N();
    if (!c.slots) {
      return '<div class="nc-panel"><div class="nc-panel-h">EXTRA BUFFS</div>' +
        '<p class="nc-dim">No slots unlocked yet. Five successful upgrades open the first one.</p>' + poolHtml() + '</div>';
    }
    const cost = n.rollCost(c), locked = n.lockedCount(c), afford = n.prism() >= cost;
    const rows = [];
    for (let i = 0; i < r.slots; i++) {
      const open = i < c.slots, b = c.buffs[i];
      if (!open) { rows.push('<div class="nc-slot off"><span class="nc-slot-i">SLOT ' + (i + 1) + '</span><span class="nc-slot-t">not unlocked</span></div>'); continue; }
      if (!b) { rows.push('<div class="nc-slot"><span class="nc-slot-i">SLOT ' + (i + 1) + '</span><span class="nc-slot-t">empty — reroll to fill</span></div>'); continue; }
      rows.push('<div class="nc-slot' + (b.lock ? ' lk' : '') + '" style="--c:' + r.col + '">' +
        '<span class="nc-slot-i">SLOT ' + (i + 1) + '</span>' +
        '<span class="nc-slot-t on">' + buffHtml(b) + '</span>' +
        '<button class="nc-lockb' + (b.lock ? ' on' : '') + '" data-nlock="' + ship + '|' + rk + '|' + i + '">' + (b.lock ? '🔒 LOCKED' : 'LOCK') + '</button></div>');
    }
    return '<div class="nc-panel"><div class="nc-panel-h">EXTRA BUFFS <span class="nc-h-r">' + c.slots + ' / ' + r.slots + ' unlocked</span></div>' +
      rows.join('') +
      '<div class="nc-roll"><div><div class="nc-roll-c' + (afford ? '' : ' short') + '">◈ ' + money(cost) + '</div>' +
        '<div class="nc-roll-l">REROLL COST' + (locked ? ' · ' + locked + ' locked ×' + Math.pow(n.CFG.roll.lockMult, locked) : '') + '</div></div>' +
        '<button class="nc-btn" data-nroll="' + ship + '|' + rk + '"' + (afford ? '' : ' disabled') + '>REROLL</button></div>' +
      '<p class="nc-dim sm">Every unlocked slot that is not locked rerolls at once. Each locked slot doubles the cost.</p>' +
      poolHtml() + '</div>';
  }

  function poolHtml() {
    const n = N();
    return '<details class="nc-pool"><summary>Buff pool, ranges &amp; roll grades</summary><div class="nc-pool-g">' +
      n.BUF.map((b) => '<div class="nc-pool-i"><span>' + b.name + '</span><b>+' + b.min + '% – ' + b.max + '%</b></div>').join('') +
      '</div><div class="nc-gkey">' + n.RAR.map((r, i) => '<span class="nc-gk" style="--g:' + r.col + '">' + r.name.toUpperCase() + '</span>').join('') + '</div>' +
      '<p class="nc-dim sm">Values step in ' + n.CFG.step + '% and are weighted toward the floor, so most rolls land Common and a roll in the top 5% of its range grades <b>Legendary</b> — the same bar the Perfect Resonance badge counts.</p></details>';
  }

  // ===========================================================================
  // CRATE TAB (rendered inside the unified Crates screen)
  // ===========================================================================
  function crateTab() {
    const n = N();
    if (!n.unlocked()) return lockHtml();
    const cfg = n.CFG.crate, bal = n.prism();
    const odds = cfg.drops.map((d) => { const r = n.BY_R[d[0]]; return '<div class="nc-odd"><span class="nc-dot" style="background:' + r.col + '"></span>' + r.name + '<b style="color:' + r.col + '">' + d[1] + '%</b></div>'; }).join('');
    const t = n.tally();
    // WHY THE BUTTONS ARE OFF. A disabled button with a price on it and no
    // explanation is a dead end — Nanocores opens on LEVEL alone, so a pilot can
    // reach this screen having never mined an ingot and find two dark buttons and
    // no reason. Say the balance, the shortfall, and where ingots come from.
    const short = bal < cfg.single;
    const why = short
      ? '<div class="nc-short"><div class="nc-short-h">◈ NOT ENOUGH PRISM INGOTS</div>' +
          '<div class="nc-short-b">You hold <b>◈ ' + money(bal) + '</b> · a crate costs <b>◈ ' + money(cfg.single) + '</b>.</div>' +
          '<div class="nc-short-b">Ingots are mined in <b>Prism Mining</b> — deploy into a Prism Field and every kill there refines into ingots. The <b>Moon Colony</b> and the <b>Alliance store</b> pay them out too.</div>' +
          '<button class="nc-btn wide" data-ngo="prism">OPEN PRISM MINING</button></div>'
      : '';
    return '<div class="nc-crate">' +
      '<div class="nc-crate-h"><div class="nc-crate-ic">◈</div>' +
        '<div><div class="nc-crate-n">NANOCORE CRATE</div>' +
        '<div class="nc-crate-s">One core per crate, any hull in the game · ' + t.owned + ' / ' + t.total + ' collected</div></div></div>' +
      '<div class="nc-odds">' + odds + '</div>' +
      '<div class="nc-buy">' +
        '<button class="nc-btn big" data-nbuy="1"' + (bal >= cfg.single ? '' : ' disabled') + '>OPEN 1<span>◈ ' + money(cfg.single) + '</span></button>' +
        '<button class="nc-btn big alt" data-nbuy="10"' + (bal >= cfg.ten ? '' : ' disabled') + '>OPEN 10<span>◈ ' + money(cfg.ten) + ' <s>' + money(cfg.tenList) + '</s></span></button>' +
      '</div>' +
      '<div class="nc-bal">◈ ' + money(bal) + ' banked</div>' +
      why +
      (crateRes ? resultsHtml() : '') +
      '<p class="nc-dim">Duplicates are kept: ' + n.CFG.exchange.ratio + ' of a rarity trade up in <b>Command ▸ Nanocores</b>.</p>' +
      '<button class="nc-btn wide" data-ngo="nano">MANAGE CORES</button>' +
      '</div>';
  }

  function resultsHtml() {
    const n = N();
    return '<div class="nc-res"><div class="nc-res-h">' + crateRes.length + ' CORE' + (crateRes.length > 1 ? 'S' : '') + ' RECOVERED</div>' +
      '<div class="nc-res-g">' + crateRes.map((x) => {
        const r = n.BY_R[x.r];
        return '<div class="nc-res-i' + (x.dupe ? ' dupe' : '') + '" style="--c:' + r.col + '">' +
          '<img src="ships/ship-' + x.ship + '.png" alt="" loading="lazy">' +
          '<div class="nc-res-n">' + esc(n.shipName(x.ship)) + '</div>' +
          '<div class="nc-res-r">' + r.name.toUpperCase() + (x.dupe ? ' · DUPE' : '') + '</div></div>';
      }).join('') + '</div></div>';
  }

  // ---- the rarity strip on a hull's detail card -----------------------------
  function shipStrip(key) {
    const n = N(); if (!n || !n.unlocked()) return '';
    const any = n.RKEYS.some((r) => n.has(key, r));
    return '<div class="nc-strip"><div class="nc-strip-h">◈ NANOCORES' +
      (any ? '' : '<span class="nc-strip-x">none owned</span>') + '</div>' +
      '<div class="nc-chips sm">' + n.RAR.map((r) => chipHtml(key, r)).join('') + '</div></div>';
  }

  // ===========================================================================
  // WIRING
  // ===========================================================================
  function goHome(ship, r) { view = { ship, r }; render(); }
  function wire(root) {
    const n = N();
    root.querySelectorAll('[data-nfilter]').forEach((b) => b.onclick = () => { filter = b.dataset.nfilter; render(); });
    root.querySelectorAll('[data-ncore]').forEach((b) => b.onclick = () => {
      const [ship, r] = b.dataset.ncore.split('|');
      goHome(ship, r);
    });
    root.querySelectorAll('[data-nback]').forEach((b) => b.onclick = () => { view = null; render(); });
    root.querySelectorAll('[data-nequip]').forEach((b) => b.onclick = () => {
      const [ship, r] = b.dataset.nequip.split('|');
      if (n.equip(ship, r)) { toast(n.BY_R[r].name.toUpperCase() + ' core equipped on the ' + n.shipName(ship), n.BY_R[r].col); render(); }
    });
    root.querySelectorAll('[data-nup]').forEach((b) => b.onclick = () => {
      const [ship, r] = b.dataset.nup.split('|');
      const res = n.upgrade(ship, r);
      if (!res) return;
      if (res.slotUnlocked) toast('EXTRA BUFF SLOT ' + res.slot + ' UNLOCKED', n.BY_R[r].col);
      else if (res.win) toast('Upgrade ' + res.stage + ' landed · ' + Math.round(res.chance) + '%', '#46d27a');
      else toast('Upgrade failed at ' + Math.round(res.chance) + '% — next try +' + n.CFG.upgrade.failBonus + '%', '#ff7a8a');
      render();
    });
    root.querySelectorAll('[data-nroll]').forEach((b) => b.onclick = () => {
      const [ship, r] = b.dataset.nroll.split('|');
      const res = n.roll(ship, r);
      // Name the BEST grade in the batch — the one thing worth knowing before you
      // read the slots, and it pops in that grade's colour.
      if (res) {
        let best = null;
        res.slots.forEach((i) => { const b = n.coreAt(ship, r).buffs[i]; if (b && (!best || n.rollPos(b) > n.rollPos(best))) best = b; });
        const g = best ? n.grade(best) : null;
        toast(res.slots.length + ' slot' + (res.slots.length > 1 ? 's' : '') + ' rerolled' + (g ? ' · best ' + g.name.toUpperCase() : ''), g ? g.col : n.BY_R[r].col);
      }
      render();
    });
    root.querySelectorAll('[data-nlock]').forEach((b) => b.onclick = () => {
      const p = b.dataset.nlock.split('|');
      n.toggleLock(p[0], p[1], +p[2]);
      render();
    });
    root.querySelectorAll('[data-nex]').forEach((b) => b.onclick = () => {
      const r = b.dataset.nex, res = n.exchange(r);
      if (res) toast((res.dupe ? 'Duplicate ' : '') + n.BY_R[res.r].name.toUpperCase() + ' core — ' + n.shipName(res.ship), n.BY_R[res.r].col);
      render();
    });
    root.querySelectorAll('[data-ngo]').forEach((b) => b.onclick = () => {
      const to = b.dataset.ngo;
      if (to === 'crates') { if (window.CRATES) window.CRATES.open('nano'); }
      else if (to === 'prism') { if (window.UI && window.UI.showScreen) window.UI.showScreen('prism'); }
      else { view = null; if (window.UI && window.UI.showScreen) window.UI.showScreen('nano'); }
    });
  }
  // The crate tab lives in another screen's body, so it wires separately.
  function wireCrate(root) {
    const n = N();
    root.querySelectorAll('[data-nbuy]').forEach((b) => b.onclick = () => {
      const qty = +b.dataset.nbuy;
      const res = n.openCrates(qty);
      if (!res) return;
      crateRes = res.results;
      const best = res.results.reduce((a, x) => (n.BY_R[x.r].i > n.BY_R[a.r].i ? x : a), res.results[0]);
      toast('Best pull: ' + n.BY_R[best.r].name.toUpperCase() + ' · ' + n.shipName(best.ship), n.BY_R[best.r].col);
      if (window.CRATES) window.CRATES.render();
    });
    wire(root);
  }
  function clearResults() { crateRes = null; }
  function reset() { view = null; crateRes = null; }

  // ===========================================================================
  // STYLE
  // ===========================================================================
  const css = `
  .nc-hero{display:flex;align-items:center;gap:12px;padding:13px;border-radius:14px;margin-bottom:10px;
    background:linear-gradient(180deg,#1d1733,#121a28);border:1px solid #3a2f5c}
  .nc-hero-ic{width:44px;height:44px;flex:none;border-radius:12px;display:grid;place-items:center;font-size:22px;color:#c9a0ff;
    background:radial-gradient(120% 120% at 50% 0%,#2a2046,#140e24);border:1px solid rgba(201,160,255,.5);box-shadow:0 0 16px -3px rgba(201,160,255,.7)}
  .nc-hero-txt{flex:1;min-width:0}
  .nc-hero-n{font-family:'Orbitron',sans-serif;font-weight:800;font-size:19px;color:#eaf2fb;letter-spacing:.02em}
  .nc-hero-n span{font-size:11px;color:#93a2ba;letter-spacing:.08em}
  .nc-hero-s{font-size:11.5px;color:#c9a0ff;font-weight:700;margin-top:2px}
  .nc-cta{flex:none;min-height:44px;padding:0 14px;border-radius:10px;border:1px solid #c9a0ff;background:rgba(201,160,255,.14);
    color:#e9d9ff;font-family:'Orbitron',sans-serif;font-weight:800;font-size:10.5px;letter-spacing:.1em;cursor:pointer}
  .nc-intro,.nc-dim{font-size:11.5px;line-height:1.55;color:#93a2ba;margin:0 0 10px}
  .nc-dim.sm{font-size:10.5px;margin:8px 0 0}
  .nc-empty{padding:22px 16px;text-align:center;border:1px dashed #37475f;border-radius:12px;color:#93a2ba;font-size:12px}
  .nc-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:6px;margin:0 0 10px}
  .nc-fchip{min-height:40px;border-radius:9px;border:1px solid #2a3650;background:#131a28;color:#93a2ba;
    font-family:'Rajdhani',sans-serif;font-weight:700;font-size:10.5px;letter-spacing:.08em;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px}
  .nc-fchip.on{border-color:#c9a0ff;color:#eaf2fb;background:rgba(201,160,255,.12)}
  .nc-fb{background:#c9a0ff;color:#150c26;border-radius:7px;padding:0 5px;font-size:9.5px;font-weight:800}
  .nc-row{border:1px solid #223245;border-radius:14px;padding:11px;margin-bottom:9px;background:linear-gradient(180deg,#111a27,#0c1320)}
  .nc-row.nohull{opacity:.9}
  .nc-row-h{display:flex;align-items:center;gap:10px;margin-bottom:9px}
  .nc-thumb{width:46px;height:34px;object-fit:contain;flex:none;filter:drop-shadow(0 0 6px rgba(120,160,255,.35))}
  .nc-row.nohull .nc-thumb{filter:grayscale(1);opacity:.5}
  .nc-row-t{min-width:0}
  .nc-row-n{font-family:'Orbitron',sans-serif;font-weight:700;font-size:12.5px;color:#eaf2fb;letter-spacing:.02em}
  .nc-row-s{font-size:10px;color:#6f7f99;letter-spacing:.03em;margin-top:2px}
  .nc-chips{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:6px}
  .nc-chips.sm{grid-template-columns:repeat(auto-fit,minmax(118px,1fr))}
  .nc-chip{min-height:56px;padding:7px 9px;border-radius:10px;text-align:left;cursor:pointer;
    border:1px solid color-mix(in srgb,var(--c) 55%,#223245);background:linear-gradient(180deg,color-mix(in srgb,var(--c) 12%,#0f1725),#0b1220)}
  .nc-chip.eq{box-shadow:0 0 0 1px var(--c),0 0 14px -6px var(--c)}
  .nc-chip.off{min-height:56px;padding:7px 9px;border-radius:10px;border:1px dashed #2e3c52;background:#0b1018;cursor:default}
  .nc-chip-r{display:block;font-family:'Orbitron',sans-serif;font-weight:800;font-size:9.5px;letter-spacing:.1em;color:var(--c,#5b6a80)}
  .nc-chip.off .nc-chip-r{color:#5b6a80}
  .nc-chip-v{display:block;font-size:9.5px;color:#b8c6d8;margin-top:3px;line-height:1.35}
  .nc-chip.off .nc-chip-v{color:#57657c}
  .nc-chip-sl{display:block;font-size:9px;color:#8fa0b8;margin-top:3px;letter-spacing:.04em}
  .nc-panel{border:1px solid #223245;border-radius:14px;padding:12px;margin-bottom:10px;background:#0d1420}
  .nc-panel-h{display:flex;align-items:center;justify-content:space-between;gap:8px;font-family:'Orbitron',sans-serif;font-weight:800;
    font-size:10.5px;letter-spacing:.12em;color:#c3d2e6;margin-bottom:8px}
  .nc-h-r{font-family:'Rajdhani',sans-serif;font-weight:700;font-size:10.5px;letter-spacing:.06em;color:#8fa0b8}
  .nc-ex-row{display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid #1b2434}
  .nc-dot{width:9px;height:9px;border-radius:50%;flex:none}
  .nc-ex-t{flex:1;min-width:0;font-size:11px;color:#b8c6d8;letter-spacing:.02em}
  .nc-ex-n{font-family:'Rajdhani',sans-serif;font-weight:800;font-size:12px;font-variant-numeric:tabular-nums}
  .nc-ex-b{min-height:36px;padding:0 11px;border-radius:8px;border:1px solid #2a3650;background:#141d2c;color:#cfe0f2;
    font-family:'Orbitron',sans-serif;font-weight:800;font-size:9.5px;letter-spacing:.08em;cursor:pointer}
  .nc-ex-row.ok .nc-ex-b{border-color:#46d27a;color:#bff2d2;background:rgba(70,210,122,.14)}
  .nc-ex-b:disabled{opacity:.4;cursor:default}
  .nc-back{min-height:40px;padding:0 12px;margin-bottom:10px;border-radius:9px;border:1px solid #2a3650;background:#131a28;
    color:#9db6cb;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:11px;letter-spacing:.08em;cursor:pointer}
  .nc-mh{display:flex;align-items:center;gap:11px;padding:12px;border-radius:14px;margin-bottom:10px;
    border:1px solid color-mix(in srgb,var(--c) 45%,#223245);background:linear-gradient(180deg,color-mix(in srgb,var(--c) 12%,#101826),#0b1220)}
  .nc-mh-img{width:58px;height:42px;object-fit:contain;flex:none;filter:drop-shadow(0 0 8px color-mix(in srgb,var(--c) 60%,transparent))}
  .nc-mh-n{font-family:'Orbitron',sans-serif;font-weight:800;font-size:13.5px;color:#eaf2fb;letter-spacing:.02em}
  .nc-mh-r{font-size:10.5px;font-weight:700;letter-spacing:.1em;color:var(--c);margin-top:3px}
  .nc-mh-eq,.nc-mh-b{margin-left:auto;flex:none;font-family:'Orbitron',sans-serif;font-weight:800;font-size:9.5px;letter-spacing:.09em}
  .nc-mh-eq{color:var(--c)}
  .nc-mh-b{min-height:40px;padding:0 13px;border-radius:9px;border:1px solid var(--c);background:color-mix(in srgb,var(--c) 16%,transparent);color:#eaf2fb;cursor:pointer}
  .nc-live{padding:8px 11px;border-radius:10px;margin-bottom:10px;font-family:'Orbitron',sans-serif;font-weight:800;font-size:9.5px;
    letter-spacing:.09em;border:1px solid #223245;background:#0d1420;color:#8fa0b8}
  .nc-live.flying{border-color:rgba(70,210,122,.5);background:rgba(70,210,122,.09);color:#bff2d2}
  .nc-live.fleet{border-color:rgba(95,209,255,.5);background:rgba(95,209,255,.09);color:#bfe6ff}
  .nc-row-s.flying{color:#7ce0a0}
  .nc-row-s.fleet{color:#5fd1ff}
  .nc-warn{padding:9px 11px;border-radius:10px;margin-bottom:10px;border:1px solid rgba(242,178,75,.4);background:rgba(242,178,75,.08);
    font-size:11px;color:#ffd9a0}
  .nc-base{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
  .nc-base-i{padding:9px 6px;border-radius:10px;background:#0f1725;border:1px solid #1e2a3c;text-align:center}
  .nc-base-v{font-family:'Orbitron',sans-serif;font-weight:800;font-size:15px}
  .nc-base-l{font-size:8.5px;letter-spacing:.1em;color:#7f8ea6;margin-top:3px}
  .nc-dots{display:flex;gap:6px;margin-bottom:10px}
  .nc-dot-s{flex:1;height:6px;border-radius:3px;background:#1c2636}
  .nc-dot-s.on{background:var(--c)}
  .nc-dot-s.now{background:#3b4a63;box-shadow:0 0 0 1px var(--c) inset}
  .nc-ug{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-bottom:9px}
  .nc-ug-i{padding:9px;border-radius:10px;background:#0f1725;border:1px solid #1e2a3c}
  .nc-ug-v{font-family:'Orbitron',sans-serif;font-weight:800;font-size:16px;color:#eaf2fb}
  .nc-ug-v.short{color:#ff8a96}
  .nc-ug-l{font-size:8.5px;letter-spacing:.08em;color:#7f8ea6;margin-top:3px;line-height:1.4}
  .nc-btn{min-height:44px;padding:0 16px;border-radius:10px;border:1px solid #c9a0ff;background:rgba(201,160,255,.14);color:#e9d9ff;
    font-family:'Orbitron',sans-serif;font-weight:800;font-size:11px;letter-spacing:.1em;cursor:pointer}
  .nc-btn.big{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:100%;padding:9px 14px;min-height:52px}
  .nc-btn.big span{font-family:'Rajdhani',sans-serif;font-weight:700;font-size:11px;letter-spacing:.04em;color:#c9a0ff}
  .nc-btn.big span s{color:#6f7f99}
  .nc-btn.alt{border-color:#ffd450;background:rgba(255,212,80,.12);color:#ffeab0}
  .nc-btn.alt span{color:#ffd450}
  .nc-btn.wide{width:100%;margin-top:10px}
  .nc-btn:disabled{opacity:.4;cursor:default}
  .nc-slot{display:flex;align-items:center;gap:9px;padding:9px;border-radius:10px;margin-bottom:6px;background:#0f1725;border:1px solid #1e2a3c}
  .nc-slot.lk{border-color:var(--c);background:color-mix(in srgb,var(--c) 10%,#0f1725)}
  .nc-slot.off{opacity:.55;border-style:dashed}
  .nc-slot-i{flex:none;font-family:'Orbitron',sans-serif;font-weight:800;font-size:9px;letter-spacing:.09em;color:#7f8ea6;width:52px}
  .nc-slot-t{flex:1;min-width:0;font-size:11.5px;color:#8fa0b8}
  .nc-slot-t.on{color:#eaf2fb;font-weight:700;display:flex;align-items:baseline;gap:7px;flex-wrap:wrap}
  .nc-bn{color:#b8c6d8;font-weight:700}
  .nc-bv{color:var(--g);font-family:'Orbitron',sans-serif;font-weight:800;font-size:12.5px;font-variant-numeric:tabular-nums}
  .nc-bg{font-family:'Orbitron',sans-serif;font-weight:800;font-size:8px;letter-spacing:.1em;color:var(--g);
    border:1px solid color-mix(in srgb,var(--g) 55%,transparent);background:color-mix(in srgb,var(--g) 13%,transparent);
    border-radius:5px;padding:2px 5px;white-space:nowrap}
  .nc-lockb{flex:none;min-height:36px;padding:0 10px;border-radius:8px;border:1px solid #2a3650;background:#141d2c;color:#9db6cb;
    font-family:'Rajdhani',sans-serif;font-weight:700;font-size:10px;letter-spacing:.08em;cursor:pointer}
  .nc-lockb.on{border-color:var(--c);color:#eaf2fb;background:color-mix(in srgb,var(--c) 18%,transparent)}
  .nc-roll{display:flex;align-items:center;gap:10px;margin-top:10px;padding-top:10px;border-top:1px solid #1b2434}
  .nc-roll-c{font-family:'Orbitron',sans-serif;font-weight:800;font-size:15px;color:#eaf2fb}
  .nc-roll-c.short{color:#ff8a96}
  .nc-roll-l{font-size:8.5px;letter-spacing:.08em;color:#7f8ea6;margin-top:2px}
  .nc-roll .nc-btn{margin-left:auto}
  .nc-pool{margin-top:10px;border-top:1px solid #1b2434;padding-top:9px}
  .nc-pool summary{cursor:pointer;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:11px;letter-spacing:.06em;color:#8fa0b8}
  .nc-pool-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:5px;margin-top:8px}
  .nc-pool-i{display:flex;justify-content:space-between;gap:8px;font-size:10.5px;color:#93a2ba;padding:5px 7px;background:#0f1725;border-radius:7px}
  .nc-pool-i b{color:#c9a0ff;font-variant-numeric:tabular-nums}
  .nc-gkey{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
  .nc-gk{font-family:'Orbitron',sans-serif;font-weight:800;font-size:8px;letter-spacing:.09em;color:var(--g);
    border:1px solid color-mix(in srgb,var(--g) 50%,transparent);background:color-mix(in srgb,var(--g) 12%,transparent);border-radius:5px;padding:3px 6px}
  .nc-lock{padding:26px 18px;text-align:center;border:1px dashed #3a2f5c;border-radius:14px;background:rgba(201,160,255,.05)}
  .nc-lock-ic{font-size:32px;color:#c9a0ff;margin-bottom:8px}
  .nc-lock h3{font-family:'Orbitron',sans-serif;font-weight:800;font-size:15px;color:#eaf2fb;letter-spacing:.06em;margin:0 0 8px}
  .nc-lock p{font-size:12px;line-height:1.6;color:#b8c6d8;margin:0 auto 8px;max-width:44ch}
  .nc-crate-h{display:flex;align-items:center;gap:11px;margin-bottom:10px}
  .nc-crate-ic{width:52px;height:52px;flex:none;border-radius:14px;display:grid;place-items:center;font-size:26px;color:#c9a0ff;
    background:radial-gradient(120% 120% at 50% 0%,#2a2046,#140e24);border:1px solid rgba(201,160,255,.5);box-shadow:0 0 18px -4px rgba(201,160,255,.8)}
  .nc-crate-n{font-family:'Orbitron',sans-serif;font-weight:800;font-size:14px;color:#eaf2fb;letter-spacing:.05em}
  .nc-crate-s{font-size:10.5px;color:#93a2ba;margin-top:3px}
  .nc-odds{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:6px;margin-bottom:11px}
  .nc-odd{display:flex;align-items:center;gap:6px;padding:8px 9px;border-radius:9px;background:#0f1725;border:1px solid #1e2a3c;
    font-size:10.5px;color:#b8c6d8}
  .nc-odd b{margin-left:auto;font-family:'Rajdhani',sans-serif;font-size:12px;font-variant-numeric:tabular-nums}
  .nc-buy{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}
  .nc-bal{text-align:center;font-size:11px;color:#c9a0ff;font-weight:700;margin:9px 0 4px}
  .nc-res{margin:10px 0;padding:11px;border-radius:12px;background:#0d1420;border:1px solid #223245}
  .nc-res-h{font-family:'Orbitron',sans-serif;font-weight:800;font-size:10.5px;letter-spacing:.12em;color:#c3d2e6;margin-bottom:9px}
  .nc-res-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:6px}
  .nc-res-i{padding:8px 6px;border-radius:10px;text-align:center;border:1px solid color-mix(in srgb,var(--c) 55%,#223245);
    background:linear-gradient(180deg,color-mix(in srgb,var(--c) 14%,#0f1725),#0b1220)}
  .nc-res-i.dupe{opacity:.72}
  .nc-res-i img{width:44px;height:32px;object-fit:contain}
  .nc-res-n{font-size:9.5px;color:#dbe8f5;font-weight:700;margin-top:3px;line-height:1.3}
  .nc-res-r{font-family:'Orbitron',sans-serif;font-weight:800;font-size:8px;letter-spacing:.09em;color:var(--c);margin-top:2px}
  .nc-short{margin:10px 0;padding:11px;border-radius:12px;border:1px solid rgba(242,178,75,.45);background:rgba(242,178,75,.07)}
  .nc-short-h{font-family:'Orbitron',sans-serif;font-weight:800;font-size:10px;letter-spacing:.11em;color:#ffcf7a;margin-bottom:7px}
  .nc-short-b{font-size:11.5px;line-height:1.55;color:#e6d3b4;margin-bottom:6px}
  .nc-short-b b{color:#fff}
  .nc-short .nc-btn{margin-top:4px;border-color:#f2b24b;background:rgba(242,178,75,.14);color:#ffe3b0}
  .nc-strip{margin-top:9px;padding:9px;border-radius:11px;background:#0d1420;border:1px solid #223245}
  .nc-strip-h{display:flex;align-items:center;gap:8px;font-family:'Orbitron',sans-serif;font-weight:800;font-size:9px;
    letter-spacing:.12em;color:#c9a0ff;margin-bottom:7px}
  .nc-strip-x{margin-left:auto;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:9.5px;letter-spacing:.06em;color:#6f7f99}
  `;
  (function inject() {
    const s = document.createElement('style'); s.id = 'nc-css'; s.textContent = css;
    document.head.appendChild(s);
  })();

  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('[data-ncore]') : null;
    if (!b) return;
    const body = $('nano-body');
    if (body && body.contains(b)) return;            // in-screen chips are wired directly
    const p = b.dataset.ncore.split('|');
    view = { ship: p[0], r: p[1] };
    const mr = $('modal-root'); if (mr) mr.innerHTML = '';   // close the hull sheet behind us
    if (window.UI && window.UI.showScreen) window.UI.showScreen('nano');
  });

  window.NANOUI = { render, crateTab, wireCrate, shipStrip, clearResults, reset };
})();
