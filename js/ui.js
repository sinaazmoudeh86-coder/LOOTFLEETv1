/* =============================================================================
   ui.js — GrabAGun Idle Operator (mobile)
   Top HUD, bottom-nav screens (Battle / Zones / Bag / Hero / Store / Rank),
   joystick + auto toggle + speed pills, store purchases, leaderboard with
   viewable loadouts, rarity legend, item detail sheets, death/offline modals.
   ============================================================================= */
(function () {
  'use strict';
  const C = window.CONFIG, LB = window.LEADERBOARD, R = window.RENDER, GM = window.GALAXYMAP;
  let G = null;
  let _inited = false; // true once init() has populated `el`; UI feedback before
                       // then (e.g. offline-sim level-ups) safely no-ops.
  const $ = (id) => document.getElementById(id);
  const el = {};
  let screen = 'battle', sortMode = 'power', lbTab = 'heat', storeCat = 'ships';

  const ZONE_NAMES = ['The Backyard','Main Street','Riverside Mall','Gas Station','Highway Pileup','Quarantine Zone','Subway Tunnels','Research Lab','Military Depot','Containment Site'];
  function zoneName(d) { return d <= ZONE_NAMES.length ? ZONE_NAMES[d-1] : (d <= 16 ? 'Outer Sector ' + d : 'Hive Sector ' + d); }
  const rc = (i) => 'r-' + C.RARITY[i].key;
  const bl = (i) => 'bl-' + C.RARITY[i].key;
  // Format a drop probability (0..1) for the rarity legend: readable percentages
  // down to 0.1%, then switches to "1 in N" odds for the ultra-rare tiers.
  function fmtChance(p) {
    if (!p || p <= 0) return '—';
    const pct = p * 100;
    if (pct >= 10) return Math.round(pct) + '%';
    if (pct >= 1) return pct.toFixed(1) + '%';
    if (pct >= 0.1) return pct.toFixed(2) + '%';
    return '1 in ' + G.formatNum(Math.round(1 / p));
  }

  function fmtStat(key, val) {
    const d = C.STATS[key]; if (!d) return val;
    if (d.fmt === 'flat') return '+' + G.formatNum(val);
    if (d.fmt === 'pctint') return '+' + Math.round(val) + '%';
    return '+' + (Math.round(val * 10) / 10) + '%';
  }

  // ==========================================================================
  function init(game) {
    G = game;
    ['hud-level','xp-fill','xp-label','hp-fill','hp-label','hud-gold','hud-dps','hud-kills',
     'zb-name','zb-sub','advice','loot-feed','toast-layer','joystick','speed-row','auto-btn','auto-lbl',
     'hero-sub','char-power','equip-grid','stat-list','bag-sub','bag-body','zones-sub','zones-body','galaxy-sub','galaxy-body',
     'store-body','board-sub','board-body','modal-root','bag-badge',
     'boss-bar','bb-fill','bb-label','hero-badge','skills-sub','skills-body','hud-power',
     'siege-bar','sg-fill','sg-label'].forEach((id) => el[id] = $(id));

    document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => showScreen(b.dataset.screen)));
    buildSpeedRow();
    el['auto-btn'].addEventListener('click', () => { G.setAuto(!G.getAuto()); syncAuto(); });
    const zbBtn = $('zone-banner'); if (zbBtn) zbBtn.addEventListener('click', () => showScreen('zones'));
    document.querySelectorAll('#hangar-dock .hd-btn').forEach((b) => b.addEventListener('click', () => showScreen(b.dataset.screen)));
    initJoystick();
    syncAuto();
    _inited = true;
  }

  // ==========================================================================
  // SCREENS
  // ==========================================================================
  function showScreen(name) {
    screen = name;
    document.querySelectorAll('.screen.overlay').forEach((s) => s.classList.remove('active'));
    if (name !== 'battle') $('screen-' + name).classList.add('active');
    const navName = (name === 'hero') ? 'store' : name;
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.screen === navName));
    if (name === 'hero') renderHero();
    else if (name === 'bag') renderBag();
    else if (name === 'zones') renderZones();
    else if (name === 'galaxy') renderGalaxy();
    else if (name === 'store') renderStore();
    else if (name === 'board') renderBoard();
    else if (name === 'skills') renderSkills();
    syncJoystickVisible();
  }

  // ==========================================================================
  // HUD (every frame)
  // ==========================================================================
  function syncHUD() {
    if (!_inited) return;
    const s = G.state;
    el['hud-level'].textContent = s.level;
    const need = C.xpToNext(s.level);
    el['xp-fill'].style.width = Math.max(0, Math.min(100, s.xp / need * 100)) + '%';
    el['xp-label'].textContent = `${G.formatNum(s.xp)} / ${G.formatNum(need)} XP`;
    const hp = G.getHp();
    el['hp-fill'].style.width = (hp.max > 0 ? Math.max(0, hp.cur / hp.max * 100) : 0) + '%';
    el['hp-label'].textContent = hp.dead ? 'DOWN' : `${G.formatNum(hp.cur)} / ${G.formatNum(hp.max)}`;
    el['hud-gold'].textContent = G.formatNum(s.gold);
    el['hud-dps'].textContent = G.formatNum(G.getDps());
    const st0 = G.getStats(); if (st0) el['hud-power'].textContent = G.formatNum(Math.floor(st0.theoryDps + st0.maxHp * 0.5));
    el['hud-kills'].textContent = G.formatNum(s.totalKills) + ' kills';
    const safe = s.currentDungeon < 1;
    const aw = el['arena-wrap'] || (el['arena-wrap'] = document.getElementById('arena-wrap'));
    if (aw) aw.classList.toggle('in-hangar', safe);
    const sys = (G.sysAt && s.currentSystem) ? G.sysAt(s.currentSystem) : null;
    const sysName = sys ? sys.name : ('Zone ' + s.currentDungeon);
    el['zb-name'].textContent = safe ? '⌂ Hangar' : sysName;
    el['zb-sub'].textContent = safe ? 'Home bay' : ('Lv ' + s.currentDungeon + (sys && G.isOwned && G.isOwned(s.currentSystem) ? ' · owned' : ''));
    const adv = G.zoneAdvice();
    // advice shows only when it adds info: deploy prompt in safe zone, or a
    // push-up / back-off recommendation. Hidden when the current zone is fine.
    const a2 = el['advice'];
    const msg = safe ? 'Tap above to open the Galaxy Map →' : adv.msg;
    const show = safe || adv.kind === 'up' || adv.kind === 'down';
    if (a2.textContent !== msg) a2.textContent = msg;
    a2.className = (safe ? 'safe' : adv.kind) + (show ? ' show' : '');
    // siege wave bar takes priority over the boss meter while a siege is active
    const siege = G.getSiege ? G.getSiege() : null;
    const sgb = el['siege-bar'], bb = el['boss-bar'];
    if (siege && siege.active && !safe) {
      sgb.classList.add('show');
      const wv = siege.bossSpawned ? 'BOSS' : 'WAVE ' + Math.min(siege.wave, siege.total) + ' / ' + siege.total;
      el['sg-fill'].style.width = Math.min(100, ((siege.bossSpawned ? siege.total : siege.wave - 1) / siege.total) * 100) + '%';
      el['sg-label'].textContent = '⚔ ' + wv;
      bb.classList.remove('show', 'active');
    } else {
      sgb.classList.remove('show');
      if (safe) { bb.classList.remove('show', 'active'); }
      else {
        const bi = G.getBossInfo();
        bb.classList.add('show');
        if (bi.alive) { bb.classList.add('active'); el['bb-fill'].style.width = Math.max(0, bi.hp / bi.max * 100) + '%'; el['bb-label'].textContent = '☠ ' + (bi.name || 'BOSS'); }
        else { bb.classList.remove('active'); el['bb-fill'].style.width = (bi.progress * 100) + '%'; const m = Math.floor(bi.timeLeft/60), sec = bi.timeLeft%60; el['bb-label'].textContent = bi.progress > 0.985 ? 'BOSS INCOMING' : `Boss in ~${m}:${sec<10?'0':''}${sec}`; }
      }
    }
  }

  function refreshAll() {
    if (!_inited) return;
    if (screen === 'hero') renderHero();
    else if (screen === 'bag') renderBag();
    else if (screen === 'zones') renderZones();
    else if (screen === 'galaxy') renderGalaxy();
    else if (screen === 'store') renderStore();
    else if (screen === 'board') renderBoard();
    syncSpeed(); syncAuto();
    const n = G.state.inventory.length;
    el['bag-badge'].style.display = n > 0 ? 'block' : 'none';
    el['bag-badge'].textContent = n;
    const sp = G.state.skillPoints || 0;
    el['hero-badge'].style.display = sp > 0 ? 'block' : 'none';
    el['hero-badge'].textContent = sp;
  }
  function syncStatsTab() { if (_inited && screen === 'hero') renderHeroStats(); }

  // ==========================================================================
  // BATTLE controls
  // ==========================================================================
  function buildSpeedRow() {
    el['speed-row'].innerHTML = '';
    C.SPEED_TIERS.forEach((tier) => {
      const b = document.createElement('button');
      b.className = 'spd';
      const owned = tier.mult === 1 || G.hasSpeed(tier.sku);
      b.innerHTML = `<span>${tier.label}</span>` + (owned ? '' : `<span class="pl">${tier.priceLabel}</span>`);
      b.addEventListener('click', () => {
        if (tier.mult === 1 || G.hasSpeed(tier.sku)) { G.setGameSpeed(tier.mult); syncSpeed(); }
        else openPurchase('speed', tier);
      });
      el['speed-row'].appendChild(b);
    });
    syncSpeed();
  }
  function syncSpeed() {
    const pills = el['speed-row'].querySelectorAll('.spd');
    C.SPEED_TIERS.forEach((tier, i) => {
      const owned = tier.mult === 1 || G.hasSpeed(tier.sku);
      pills[i].classList.toggle('active', G.state.gameSpeed === tier.mult);
      pills[i].classList.toggle('locked', !owned);
      pills[i].innerHTML = `<span>${tier.label}</span>` + (owned ? '' : `<span class="pl">${tier.priceLabel}</span>`);
    });
  }
  function syncAuto() {
    const on = G.getAuto();
    el['auto-btn'].classList.toggle('on', on);
    el['auto-lbl'].textContent = on ? 'Auto' : 'Manual';
    const w = $('auto-warn'); if (w) w.classList.toggle('show', on);
    syncJoystickVisible();
  }
  function syncJoystickVisible() {
    el['joystick'].classList.toggle('show', !G.getAuto() && screen === 'battle');
  }

  // joystick (manual movement)
  function initJoystick() {
    const j = el['joystick'], knob = j.querySelector('.knob');
    let active = false, cx = 0, cy = 0; const R = 36;
    function start(e) { active = true; const r = j.getBoundingClientRect(); cx = r.left + r.width/2; cy = r.top + r.height/2; move(e); }
    function move(e) {
      if (!active) return;
      const p = e.touches ? e.touches[0] : e;
      let dx = p.clientX - cx, dy = p.clientY - cy;
      const d = Math.hypot(dx, dy) || 1; const cl = Math.min(d, R);
      const nx = dx/d, ny = dy/d;
      knob.style.transform = `translate(${nx*cl}px,${ny*cl}px)`;
      G.setJoystick(nx * (cl/R), ny * (cl/R), true);
      if (e.cancelable) e.preventDefault();
    }
    function end() { active = false; knob.style.transform = ''; G.setJoystick(0,0,false); }
    j.addEventListener('mousedown', start); window.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
    j.addEventListener('touchstart', start, {passive:false}); j.addEventListener('touchmove', move, {passive:false}); j.addEventListener('touchend', end);
  }

  // ==========================================================================
  // HERO
  // ==========================================================================
  function renderHero() {
    const st = G.getStats();
    // unified Hangar segment header (My Ship active) so Ship + Store share a tab
    const heroBody = document.getElementById('char-portrait').parentNode;
    const oldTabs = heroBody.querySelector('.store-cats'); if (oldTabs) oldTabs.remove();
    heroBody.insertAdjacentHTML('afterbegin', hangarTabsHTML('ship'));
    wireHangarTabs(heroBody);
    el['hero-sub'].textContent = (window.AUTH ? window.AUTH.name() : 'Operator') + ' · Lv ' + G.state.level;
    el['char-power'].innerHTML = 'Power <b>' + G.formatNum(Math.floor(st.theoryDps + st.maxHp * 0.5)) + '</b>';
    // equipment — driven by the current ship's actual slot layout
    el['equip-grid'].innerHTML = '';
    G.equipLayout().forEach(({ key, label, icon, item: it }) => {
      const d = document.createElement('div');
      d.className = 'equip-slot' + (it ? '' : ' empty');
      d.innerHTML = `<div class="slot-icon ${it ? rc(it.rarity) : ''}" style="${it ? 'border-color:' + C.RARITY[it.rarity].color : ''}">${icon}</div>
        <div class="slot-meta"><div class="slot-label">${label}</div><div class="slot-item ${it ? rc(it.rarity) : ''}">${it ? it.name : 'Empty'}</div></div>`;
      if (it) d.addEventListener('click', () => openItem(it, 'equipped'));
      el['equip-grid'].appendChild(d);
    });
    renderHeroStats();
  }
  function renderHeroStats() {
    const st = G.getStats();
    const rows = [
      ['Damage', G.formatNum(st.attackDamage)],
      ['Fire Rate', st.attacksPerSec.toFixed(2) + '/s'],
      ['Crit Chance', st.critChance.toFixed(1) + '%'],
      ['Crit Damage', '+' + st.critDamage.toFixed(0) + '%'],
      ['Max Health', G.formatNum(st.maxHp)],
      ['Move Speed', st.moveSpeed.toFixed(0) + '%'],
    ];
    let html = rows.map(([n, v]) => `<div class="stat-row"><span class="s-name">${n}</span><span class="s-val">${v}</span></div>`).join('');
    if (st.lifeSteal > 0) html += `<div class="stat-row special"><span class="s-name">Life Steal</span><span class="s-val">${Math.round(st.lifeSteal)}%</span></div>`;
    if (st.multiShot > 0) html += `<div class="stat-row special"><span class="s-name">Multi-Shot</span><span class="s-val">${Math.round(st.multiShot)}% · 10 tgt</span></div>`;
    html += `<button class="signout-btn" id="signout-btn">Sign Out</button>`;
    el['stat-list'].innerHTML = html;
    const so = $('signout-btn'); if (so) so.addEventListener('click', () => { if (window.AUTH) window.AUTH.signOut(); });
  }

  // ==========================================================================
  // BAG
  // ==========================================================================
  function renderBag() {
    const inv = G.state.inventory.slice();
    sortInv(inv);
    el['bag-sub'].textContent = inv.length + ' items';
    const recZone = Math.max(1, G.recommendedZone());
    const chances = G.rarityChances(recZone);
    let html = `<div class="legend"><div class="legend-title">Rarity <span class="legend-note">· drop odds at Zone ${recZone}</span></div><div class="legend-grid">`;
    C.RARITY.forEach((r) => {
      html += `<div class="legend-chip ${rc(r.tier)}"><span class="legend-dot" style="background:${r.color};color:${r.color}"></span><span class="legend-nm">${r.name}</span><span class="legend-pct">${fmtChance(chances[r.tier])}</span></div>`;
    });
    html += '</div></div>';
    // optimize row: auto-equip + auto-sell filter
    const tierOpts = C.RARITY.map((r) => `<option value="${r.tier}" ${r.tier === G.state.sellTier ? 'selected' : ''}>${r.name}</option>`).join('');
    html += `<div class="bag-actions">
        <div class="equip-row">
          <button class="opt-btn equip" id="auto-equip">⚙ Auto-Equip Best</button>
          <button class="auto-toggle ${G.state.autoEquipAlways?'on':''}" id="auto-always"><span class="at-led"></span>Always</button>
        </div>
        <div class="autosell">
          <span class="as-lbl">Auto-Sell up to</span>
          <select id="sell-tier">${tierOpts}</select>
          <label class="as-keep"><input type="checkbox" id="keep-up" ${G.state.keepUpgrades ? 'checked' : ''}><span>Keep upgrades</span></label>
          <button class="opt-btn sell" id="auto-sell">Sell</button>
        </div>
      </div>`;
    html += `<div class="inv-controls">
      <select id="sort-sel">
        <option value="power">Sort: Power</option><option value="rarity">Sort: Rarity</option>
        <option value="slot">Sort: Slot</option><option value="ilvl">Sort: Zone</option>
      </select></div>`;
    if (!inv.length) html += '<div class="empty-note">No loot in your bag.<br>Run over drops to collect them.</div>';
    else html += inv.map(itemCard).join('');
    el['bag-body'].innerHTML = html;
    const sel = $('sort-sel'); sel.value = sortMode; sel.addEventListener('change', () => { sortMode = sel.value; renderBag(); });
    $('auto-equip').addEventListener('click', () => { const n = G.autoEquip(); toast(n ? 'Equipped best gear' : 'Already optimal', n ? '#2f9e4f' : '#9c8d78'); });
    $('auto-always').addEventListener('click', () => { G.state.autoEquipAlways = !G.state.autoEquipAlways; if (G.state.autoEquipAlways) G.autoEquip(); G.save(); renderBag(); });
    const tierSel = $('sell-tier'), keep = $('keep-up');
    tierSel.addEventListener('change', () => { G.state.sellTier = +tierSel.value; G.save(); });
    keep.addEventListener('change', () => { G.state.keepUpgrades = keep.checked; G.save(); });
    $('auto-sell').addEventListener('click', () => openAutoSell(+tierSel.value, keep.checked));
    el['bag-body'].querySelectorAll('[data-id]').forEach((node) => node.addEventListener('click', () => {
      const it = G.state.inventory.find((x) => x.id === +node.dataset.id); if (it) openItem(it, 'inventory');
    }));
  }
  function sortInv(inv) {
    if (sortMode === 'power') inv.sort((a,b) => G.itemPower(b) - G.itemPower(a));
    else if (sortMode === 'rarity') inv.sort((a,b) => b.rarity - a.rarity || G.itemPower(b) - G.itemPower(a));
    else if (sortMode === 'slot') inv.sort((a,b) => a.slot.localeCompare(b.slot) || b.rarity - a.rarity);
    else inv.sort((a,b) => b.ilvl - a.ilvl);
  }
  function specialTags(it) {
    let t = '';
    if (it.stats.lifeSteal) t += '<span class="ic-tag" style="color:var(--c-uncommon);border-color:var(--c-uncommon)">LS</span>';
    if (it.stats.multiShot) t += '<span class="ic-tag" style="color:var(--c-rare);border-color:var(--c-rare)">MULTI</span>';
    return t;
  }
  function itemCard(it) {
    const r = C.RARITY[it.rarity];
    const up = isUpgrade(it);
    return `<div class="item-card ${bl(it.rarity)}" data-id="${it.id}">
      <div class="ic-icon ${rc(it.rarity)}" style="box-shadow:0 0 10px ${r.glow}">${it.icon}</div>
      <div class="ic-main"><div class="ic-name ${rc(it.rarity)}">${it.name}</div>
      <div class="ic-sub">${r.name} · ${C.SLOTS[it.slot].name} · Z${it.dungeon}</div></div>
      <div style="display:flex;gap:4px;align-items:center">${specialTags(it)}${up ? '<span class="ic-tag up">▲</span>' : ''}</div></div>`;
  }
  function isUpgrade(it) { const cur = G.state.equipped[it.slot]; return !cur || G.itemPower(it) > G.itemPower(cur); }

  // confirm auto-sell with the chosen filter
  function openAutoSell(maxTier, keepUpgrades) {
    const prev = G.autoSellPreview(maxTier, keepUpgrades);
    const rname = C.RARITY[maxTier].name;
    if (!prev.n) { toast('Nothing matches that filter', '#9c8d78'); return; }
    const sheet = showSheet(`<div class="sheet-head">Auto-Sell</div><div class="sheet-body">
      <p>Sell every <b class="${rc(maxTier)}">${rname}</b> and lower item${keepUpgrades ? ' <b>except slot upgrades</b>' : ''}?</p>
      <div class="stat-block"><span class="sb-name">Items</span><span class="sb-val">${prev.n}</span></div>
      <div class="stat-block"><span class="sb-name">You receive</span><span class="sb-val" style="color:var(--gold)"><span class="coin">$</span> ${G.formatNum(prev.earned)}</span></div>
      <p class="as-salvage">Plus a chance to salvage <span style="color:${GM.RES.fuel.color}">${GM.RES.fuel.glyph} Fuel</span>, <span style="color:${GM.RES.iron.color}">${GM.RES.iron.glyph} Iron</span> &amp; <span style="color:${GM.RES.plasma.color}">${GM.RES.plasma.glyph} Plasma</span> for My Galaxy — rarer gear yields more.</p>
      <div class="sheet-actions"><button class="btn" data-x>Cancel</button><button class="btn gold" data-ok>Sell ${prev.n}</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    sheet.querySelector('[data-ok]').addEventListener('click', () => { const r = G.autoSell(maxTier, keepUpgrades); closeSheet(); const sv = salvageStr(r.salvage); toast(`Sold ${r.n} for ${G.formatNum(r.earned)}g${sv ? '  ·  ' + sv : ''}`, '#e6b566'); });
  }

  // ==========================================================================
  // ZONES
  // ==========================================================================
  // ==========================================================================
  // GALAXY MAP (replaces the old zone list)
  // ==========================================================================
  function hexPts(cx, cy, r) {
    let p = [];
    for (let i = 0; i < 6; i++) { const a = (60 * i - 90) * Math.PI / 180; p.push((cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1)); }
    return p.join(' ');
  }
  function renderGalaxy() {
    const res = G.getResources(), rates = G.resourceRates();
    el['galaxy-sub'].textContent = 'Warp outward · claim systems';
    let html = '<div class="res-hud">';
    GM.RES_KEYS.forEach((k) => {
      const d = GM.RES[k];
      html += `<div class="res-pill" style="--rc:${d.color}"><span class="res-g">${d.glyph}</span><b>${G.formatNum(res[k] || 0)}</b><span class="res-rate">+${G.formatNum(rates[k] || 0)}/h</span></div>`;
    });
    html += '</div>';

    const view = G.galaxyView();
    const size = 36;
    const nodes = view.map((s) => { const p = GM.pixel(s.q, s.r, size); return Object.assign({}, s, { x: p.x, y: p.y }); });
    const byKey = {}; nodes.forEach((n) => byKey[n.key] = n);
    const pad = size * 1.8;
    const minX = Math.min.apply(null, nodes.map((n) => n.x)) - pad, maxX = Math.max.apply(null, nodes.map((n) => n.x)) + pad;
    const minY = Math.min.apply(null, nodes.map((n) => n.y)) - pad, maxY = Math.max.apply(null, nodes.map((n) => n.y)) + pad;
    const W = Math.max(1, maxX - minX), Hh = Math.max(1, maxY - minY);
    let svg = `<svg class="galaxy-svg" width="${W.toFixed(0)}" height="${Hh.toFixed(0)}" viewBox="0 0 ${W.toFixed(0)} ${Hh.toFixed(0)}">`;
    // faint links owned→neighbor
    nodes.forEach((n) => {
      if (!n.owned) return;
      GM.neighbors(n.q, n.r).forEach((c) => {
        const m = byKey[GM.key(c.q, c.r)]; if (!m) return;
        svg += `<line class="gx-link" x1="${(n.x-minX).toFixed(1)}" y1="${(n.y-minY).toFixed(1)}" x2="${(m.x-minX).toFixed(1)}" y2="${(m.y-minY).toFixed(1)}"/>`;
      });
    });
    nodes.forEach((n) => {
      const cx = n.x - minX, cy = n.y - minY;
      const cls = n.type === 'home' ? 'home' : n.owned ? 'owned' : n.frontier ? 'frontier' : 'far';
      const afford = n.frontier ? G.canAfford(n.cost) : true;
      const accent = n.type === 'boss' ? '#e23b4e' : (n.resource ? GM.RES[n.resource].color : (n.owned ? '#5bc06b' : n.frontier ? '#5b9cff' : '#566'));
      const center = n.type === 'home' ? '⌂' : (n.type === 'boss' ? '☠' : 'L' + n.diff);
      const tag = n.active ? 'HERE' : n.owned ? 'OWNED' : n.frontier ? (afford ? 'WARP' : 'LOCK') : '';
      svg += `<g class="gx ${cls} ${n.active ? 'active' : ''} ${afford ? '' : 'poor'}" data-key="${n.key}" style="--ac:${accent}">`;
      svg += `<polygon points="${hexPts(cx, cy, size - 3)}"/>`;
      svg += `<text class="gx-c" x="${cx}" y="${(cy + (n.resource ? -3 : 3)).toFixed(1)}">${center}</text>`;
      if (n.resource) svg += `<text class="gx-r" x="${cx}" y="${(cy + 13).toFixed(1)}" fill="${GM.RES[n.resource].color}">${GM.RES[n.resource].glyph}</text>`;
      if (tag) svg += `<text class="gx-tag" x="${cx}" y="${(cy + size * 0.74).toFixed(1)}">${tag}</text>`;
      svg += `</g>`;
    });
    svg += '</svg>';
    html += `<div class="galaxy-wrap">${svg}</div>`;
    html += '<div class="galaxy-help">Tap an adjacent system to <b>warp</b> &amp; lay siege (10 waves). Captured systems generate resources every hour.</div>';
    el['galaxy-body'].innerHTML = html;

    const wrap = el['galaxy-body'].querySelector('.galaxy-wrap');
    const me = nodes.find((n) => n.active) || nodes.find((n) => n.type === 'home');
    if (wrap && me) { wrap.scrollLeft = (me.x - minX) - wrap.clientWidth / 2; wrap.scrollTop = (me.y - minY) - wrap.clientHeight / 2; }
    el['galaxy-body'].querySelectorAll('.gx').forEach((g) => g.addEventListener('click', () => {
      const n = byKey[g.dataset.key]; if (!n) return;
      if (n.owned) { G.warp(n.key); showScreen('battle'); }
      else if (n.frontier) openWarp(n);
    }));
  }
  function openWarp(n) {
    const cost = n.cost, afford = G.canAfford(cost);
    const costHtml = GM.RES_KEYS.filter((k) => cost[k]).map((k) => `<span style="color:${GM.RES[k].color}">${GM.RES[k].glyph} ${G.formatNum(cost[k])}</span>`).join(' · ') || 'Free';
    const obj = n.type === 'boss' ? 'Clear 10 waves, then defeat the <b style="color:var(--hp)">BOSS</b>' : 'Clear 10 waves to capture';
    const reward = n.resource ? `Yields <b style="color:${GM.RES[n.resource].color}">${GM.RES[n.resource].glyph} ${G.formatNum(n.rate)}/h ${GM.RES[n.resource].name}</b> once owned` : 'Strategic territory · opens new systems';
    const sheet = showSheet(`<div class="sheet-head">Warp · ${n.name}</div><div class="sheet-body">
      <div class="ip-stat"><span class="ip-sname">Difficulty</span><span class="v">Lv ${n.diff} · ring ${n.ring}</span></div>
      <div class="ip-stat"><span class="ip-sname">Objective</span><span class="v">${obj}</span></div>
      <div class="ip-stat"><span class="ip-sname">Reward</span><span class="v">${reward}</span></div>
      <div class="ip-stat"><span class="ip-sname">Warp cost</span><span class="v">${costHtml}</span></div>
      ${afford ? '' : '<p style="color:var(--bad);font-size:11px;margin-top:6px">Not enough resources — capture a generator first.</p>'}
      <div class="sheet-actions"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok ${afford ? '' : 'disabled'}>Warp</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    const ok = sheet.querySelector('[data-ok]');
    if (ok) ok.addEventListener('click', () => {
      const r = G.warp(n.key);
      if (r.ok) { closeSheet(); toast('Warping to ' + n.name, '#5b9cff'); showScreen('battle'); }
      else toast(r.reason === 'resources' ? 'Not enough resources' : 'Unreachable', '#e23b4e');
    });
  }

  // ---- classic ZONES list (free-play / farming any unlocked zone) ----------
  function renderZones() {
    const s = G.state, rec = G.recommendedZone();
    el['zones-sub'].textContent = 'Recommended: Zone ' + rec;
    const blockCap = C.zoneCap(s.highestDungeonReached);
    const top = Math.max(12, s.highestUnlocked + 3);
    let html = '';
    const safe = s.currentDungeon < 1;
    html += `<div class="zone-row safe ${safe?'active':''}" data-d="0">
        <div class="z-num" style="color:var(--hp)">⌂</div>
        <div class="z-meta"><div class="z-name" style="color:var(--hp)">Your Hangar</div>
          <div class="z-sub">Home bay · review &amp; refit your ship</div></div>
        <div class="z-go">${safe?'● DOCKED':'RETURN'}</div></div>`;
    for (let d = 1; d <= top; d++) {
      const locked = d > s.highestUnlocked, active = d === s.currentDungeon;
      const types = C.ENEMIES.filter((e) => d >= e.minDungeon), topType = types[types.length-1];
      const blocked = d > blockCap;
      const lockLabel = blocked ? '🔒 Clear Zone ' + (Math.floor((d - 1) / C.ZONE_BLOCK) * C.ZONE_BLOCK) : '🔒 Lv ' + (d * 2);
      const bz = G.zoneBonuses(d);
      const bonus = (bz.density>1?`<span class="z-bon dens">⚔ ${bz.density}× density</span>`:'') +
                    (bz.quality>1?`<span class="z-bon qual">✦ ${bz.quality}× loot quality</span>`:'');
      html += `<div class="zone-row ${active?'active':''} ${locked?'locked':''} ${d===rec?'rec':''} ${bz.prismatic?'prismatic':''}" data-d="${d}">
        <div class="z-num">${d}</div>
        <div class="z-meta"><div class="z-name">${zoneName(d)}</div>
          <div class="z-sub">Enemy Lv ${G.formatNum(C.dungeonEnemyLevel(d))} · ${topType.name}s</div>
          ${bonus?`<div class="z-bons">${bonus}</div>`:''}
          ${d===rec && !active ? '<span class="z-rec">★ RECOMMENDED</span>' : ''}</div>
        <div class="z-go">${locked ? lockLabel : active ? '● HERE' : (d===rec ? '★ DEPLOY' : 'DEPLOY')}</div></div>`;
    }
    el['zones-body'].innerHTML = html;
    el['zones-body'].querySelectorAll('.zone-row:not(.locked)').forEach((row) => row.addEventListener('click', () => { G.selectDungeon(+row.dataset.d); showScreen('battle'); }));
    const recRow = el['zones-body'].querySelector('.zone-row.rec');
    if (recRow) el['zones-body'].scrollTop = Math.max(0, recRow.offsetTop - 90);
  }

  // ==========================================================================
  // STORE
  // ==========================================================================
  const STORE_ICONS = {
    ship:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l5 6v7l-5 4-5-4V9z"/><path d="M12 3v18M7 9l-3 2 3 2M17 9l3 2-3 2"/></svg>',
    market:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-6 9 6-9 6z"/><path d="M3 9v7l9 5 9-5V9"/></svg>',
    speed:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></svg>',
    offline:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14a8 8 0 1 1-9.5-9.8A6.5 6.5 0 0 0 20 14z"/></svg>',
    cosmetics:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/></svg>',
  };
  // distinct top-down silhouettes per hull class (nose-up)
  const SHIP_ICONS = {
    Frigate:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c1.7 2.2 2.6 5.2 2.6 9.2l-.5 8.8h-4.2l-.5-8.8c0-4 .9-7 2.6-9.2z"/><path d="M9.5 12.5l-4.2 3 .7 2.6 3.6-2.1"/><path d="M14.5 12.5l4.2 3-.7 2.6-3.6-2.1"/></svg>',
    Cruiser:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5c1.9 1.6 2.9 4 2.9 7.6V19l-2.9-1.4L9.1 19v-6.4C9.1 9 10.1 6.6 12 5z"/><path d="M9.4 8.5V3.4"/><path d="M14.6 8.5V3.4"/><path d="M9.1 13.2l-4 2 .9 2.2 3.1-1.6"/><path d="M14.9 13.2l4 2-.9 2.2-3.1-1.6"/></svg>',
    Battleship:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l3.6 3.2v11.6L12 21l-3.6-3.2V6.2z"/><path d="M8.4 7.4H5.6v4.2h2.8"/><path d="M15.6 7.4h2.8v4.2h-2.8"/><path d="M10 4.4V2.2M12 4V2M14 4.4V2.2"/></svg>',
    Carrier:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c2.6 2 4.1 5.2 4.1 9.2V18l-4.1 2-4.1-2v-5.8C7.9 8.2 9.4 5 12 3z"/><path d="M12 8.5v8"/><circle cx="6.2" cy="13" r="1.1"/><circle cx="17.8" cy="13" r="1.1"/><circle cx="7.6" cy="18.2" r="1"/><circle cx="16.4" cy="18.2" r="1"/></svg>',
  };
  const MOD_LABEL = { dmgPct:'DMG', hpPct:'HP', critChance:'Crit', critDamage:'Crit Dmg', moveSpeed:'Move', atkSpeedPct:'Rate', multiShot:'Multi-Shot', lifeSteal:'Lifesteal' };
  function storeHead(ico, title, right) { return `<div class="sec-head"><span class="sec-ic">${ico}</span><h3>${title}</h3>${right?`<span class="sec-right">${right}</span>`:''}</div>`; }
  // Unified Hangar segment header — shared by the "My Ship" (hero) view and the
  // store categories, so Ship + Store live under one tab.
  const HANGAR_TABS = [['ship','My Ship'],['ships','Ships'],['market','Market'],['upgrades','Upgrades'],['cosmetics','Cosmetics']];
  function hangarTabsHTML(active) {
    return `<div class="store-cats">${HANGAR_TABS.map(([k,l]) => `<button class="store-cat ${active===k?'active':''}" data-hangtab="${k}">${l}</button>`).join('')}</div>`;
  }
  function wireHangarTabs(root) {
    root.querySelectorAll('[data-hangtab]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.hangtab;
      if (k === 'ship') showScreen('hero');
      else { storeCat = k; showScreen('store'); }
    }));
  }
  function modSummary(m) {
    if (!m) return '';
    return Object.keys(m).map((k) => `<span class="mod-chip">+${m[k]}% ${MOD_LABEL[k] || k}</span>`).join('');
  }
  function shipCard(key) {
    const ship = C.SHIP_BY_KEY[key], st = G.shipBuyState(key);
    const cls = 'sc-' + ship.cls.toLowerCase();
    const layout = `<span class="lo-chip">⚔ ${ship.weapons}</span><span class="lo-chip">⊕ ${ship.ammo}</span><span class="lo-chip">⛨ ${ship.hull}</span>` +
      (ship.drones ? `<span class="lo-chip drone">◎ ${ship.drones} bay${ship.drones>1?'s':''}</span>` : '');
    const mods = modSummary(ship.mods);
    let action = '', lock = '';
    if (st.active) action = `<span class="ship-badge active">● ACTIVE</span>`;
    else if (st.owned) action = `<button class="ship-btn switch" data-ship-switch="${key}">Switch</button>`;
    else if (st.unlocked) action = `<button class="ship-btn buy" data-ship-buy="${key}"><span class="coin">$</span> ${G.formatNum(ship.price)}</button>`;
    else action = `<span class="ship-badge locked">🔒</span>`;
    const SHIP_USD = { interceptor:5, cruiser:10, heavycruiser:20, destroyer:40, battleship:75, dreadnought:150, carrier:300, supercarrier:600, titan:1000 };
    const money = (!st.owned && SHIP_USD[key]) ? `<button class="ship-btn money" data-ship-money="${key}">$${SHIP_USD[key]}</button>` : '';
    if (!st.owned && !st.unlocked) {
      if (!st.hasBlueprint) {
        const z = st.bpZone, reach = z <= G.state.highestUnlocked;
        lock = `<div class="ship-lock"><span class="lk-ic">◷</span><span>Recover the <b>Blueprint</b> — defeat the <b>boss</b> in <b>${zoneName(z)}</b> (Zone ${z})</span>` +
          (reach ? `<button class="lk-go" data-bp-hunt="${z}">Hunt ›</button>` : `<span class="lk-soft">reach Z${z}</span>`) + `</div>`;
      } else if (!st.prevOwned) {
        lock = `<div class="ship-lock ready"><span class="lk-ic">✦</span><span>Blueprint ready · own the <b>${C.SHIP_BY_KEY[st.prevKey].name}</b> first</span></div>`;
      } else if (!st.killsMet) {
        const pct = Math.min(100, st.killsHave / st.killsNeed * 100);
        lock = `<div class="ship-lock ready"><span class="lk-ic">✦</span><span>Blueprint ready · <b>${G.formatNum(st.killsHave)}/${G.formatNum(st.killsNeed)}</b> kills in the ${C.SHIP_BY_KEY[st.prevKey].name}</span>
          <div class="lk-bar"><div class="lk-fill" style="width:${pct}%"></div></div></div>`;
      }
    }
    const bpChip = ship.tier > 0 ? (st.hasBlueprint ? `<span class="bp-chip have">✔ BP</span>` : `<span class="bp-chip">◷ Z${ship.bpZone}</span>`) : '';
    return `<div class="ship-card ${cls} ${st.active?'is-active':''}">
      <div class="ship-top">
        <div class="ship-ic ${cls}"><img class="ship-img" src="ships/ship-${key}.png" alt="" loading="lazy"></div>
        <div class="ship-meta"><div class="ship-name">${ship.name} ${bpChip}</div>
          <div class="ship-tag">${ship.cls} class · ${ship.tag}</div>
          <div class="ship-layout">${layout}</div></div>
        <div class="ship-act">${action}${money}</div>
      </div>
      <div class="ship-desc">${ship.desc}</div>
      ${mods?`<div class="ship-mods">${mods}</div>`:''}
      ${lock}
    </div>`;
  }
  function renderStore() {
    let html = hangarTabsHTML(storeCat);
    const cur = C.SHIP_BY_KEY[G.state.ship];

    if (storeCat === 'ships') {
      html += `<div class="store-sec">${storeHead(STORE_ICONS.ship, 'Hangar · Ships', 'Flying: ' + (cur?cur.name:'—'))}`;
      html += `<div class="sec-blurb">Buy hulls with gold. Each unlocks only after you recover its <b>blueprint</b> from a zone boss and prove yourself in the previous hull.</div>`;
      html += C.SHIPS.map((s) => shipCard(s.key)).join('');
      html += '</div>';
    }

    if (storeCat === 'market') {
      const sh = G.getShop(); const tl = G.shopTimeLeft(); const mm = Math.floor(tl/60), ss = tl%60;
      const price = sh.price != null ? sh.price : G.shopItemPrice();
      html += `<div class="store-sec">${storeHead(STORE_ICONS.market, 'Black Market · Gold', `${mm}:${ss<10?'0':''}${ss}`)}`;
      html += `<div class="sec-blurb">Gear upgrades · fixed price this rotation.</div>`;
      sh.items.forEach((it, i) => {
        if (!it) return;
        const bought = sh.bought.includes(i), r = C.RARITY[it.rarity];
        const afford = G.state.gold >= price, up = G.shopIsUpgrade(it);
        html += `<div class="store-card shop-card ${bl(it.rarity)}" style="border-left-width:3px">
          <div class="sc-ico" style="border-color:${r.color}">${it.icon}</div>
          <div class="sc-main"><div class="sc-name ${rc(it.rarity)}">${it.name} ${up?'<span class="ic-tag up" style="vertical-align:2px">▲ UP</span>':''}</div>
            <div class="sc-desc">${r.name} · ${C.SLOTS[it.slot].name} · Z${it.dungeon}</div></div>
          <button class="sc-buy" data-shop="${i}" ${bought||!afford?'disabled':''}>${bought?'Sold':'<span class="coin">$</span> '+G.formatNum(price)}</button></div>`;
      });
      html += '</div>';
    }

    if (storeCat === 'upgrades') {
      html += `<div class="store-sec">${storeHead(STORE_ICONS.speed, 'Dungeon Speed')}<div class="sec-blurb">Fast-forward all combat, forever. One-time unlock.</div>`;
      C.SPEED_TIERS.filter((t) => t.sku).forEach((t) => {
        const owned = G.hasSpeed(t.sku);
        html += storeCard(t.label, `${t.label} Game Speed`, `Run combat ${t.mult}× faster — kills, loot & XP all scale up.`, owned ? null : t.priceLabel, owned);
      });
      html += '</div>';
      const afk = C.STORE.afk, afkOwned = G.hasSpeed('afk');
      html += `<div class="store-sec">${storeHead(STORE_ICONS.offline, 'Offline Play')}<div class="sec-blurb">${afk.blurb}</div>`;
      html += storeCard('AFK', afk.name, 'Keep earning while the app is closed.', afkOwned ? null : afk.priceLabel, afkOwned, 'afk');
      html += '</div>';
      html += '<div class="store-note">Demo build — dollar purchases are simulated and you are never charged. Ships are bought with in-game gold.</div>';
    }

    if (storeCat === 'cosmetics') {
      html += `<div class="store-sec">${storeHead(STORE_ICONS.cosmetics, 'Cosmetics')}<div class="store-empty">Skins, hull finishes &amp; emotes — coming soon.</div></div>`;
    }

    el['store-body'].innerHTML = html;
    // render each card's icon as the ACTUAL battle hull (same renderer as combat)
    el['store-body'].querySelectorAll('canvas[data-shipic]').forEach((cv) => {
      const key = cv.dataset.shipic; if (!C.SHIP_BY_KEY[key]) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1), W = 50, H = 50;
      cv.width = W * dpr; cv.height = H * dpr;
      const cx = cv.getContext('2d'); cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const gear = key === G.state.ship ? G.state.equipped : (G.state.fittings[key] || {});
      R.drawHullPortrait(cx, key, gear, W, H);
    });
    // dollar (simulated) purchases
    el['store-body'].querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => {
      const sku = b.dataset.buy;
      if (sku === 'afk') openPurchase('afk', { sku: 'afk', priceLabel: C.STORE.afk.priceLabel, name: C.STORE.afk.name });
      else { const t = C.SPEED_TIERS.find((x) => x.sku === sku); openPurchase('speed', t); }
    }));
    // black-market gold buys
    el['store-body'].querySelectorAll('[data-shop]').forEach((b) => b.addEventListener('click', () => {
      const i = +b.dataset.shop; const it = G.getShop().items[i];
      if (G.buyShopItem(i)) { toast('Bought ' + it.name, C.RARITY[it.rarity].color); renderStore(); }
    }));
    // ship buy / switch / blueprint-hunt
    el['store-body'].querySelectorAll('[data-ship-buy]').forEach((b) => b.addEventListener('click', () => openShipBuy(b.dataset.shipBuy)));
    el['store-body'].querySelectorAll('[data-ship-money]').forEach((b) => b.addEventListener('click', () => openShipMoney(b.dataset.shipMoney)));
    el['store-body'].querySelectorAll('[data-ship-switch]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.shipSwitch; if (G.switchShip(k)) { toast('Now flying the ' + C.SHIP_BY_KEY[k].name, '#5bc06b'); renderStore(); }
    }));
    el['store-body'].querySelectorAll('[data-bp-hunt]').forEach((b) => b.addEventListener('click', () => {
      G.selectDungeon(+b.dataset.bpHunt); showScreen('battle');
      toast('Deploying — defeat the boss for the blueprint', '#e6b566');
    }));
    // hangar segment tabs (My Ship / store categories)
    wireHangarTabs(el['store-body']);
  }
  // confirm sheet for a REAL-MONEY ship unlock (alternate to the gold/blueprint path)
  function openShipMoney(key) {
    const ship = C.SHIP_BY_KEY[key];
    const USD = { interceptor:5, cruiser:10, heavycruiser:20, destroyer:40, battleship:75, dreadnought:150, carrier:300, supercarrier:600, titan:1000 };
    const price = USD[key] || 0;
    const sheet = showSheet(`<div class="sheet-head">Unlock ${ship.name}</div><div class="sheet-body">
      <p>Add the <b>${ship.name}</b> straight to your fleet — no blueprint hunt, no kill grind. Skip the grind and fly it now.</p>
      <div class="buy-price">$${price}.00</div>
      <div class="ip-stat"><span class="ip-sname">Hardpoints</span><span class="v">⚔ ${ship.weapons} · ⊕ ${ship.ammo} · ⛨ ${ship.hull}${ship.drones?` · ◎ ${ship.drones}`:''}</span></div>
      <p class="buy-fine">Prototype build — payment is simulated. No real charge is made.</p>
      <div class="sheet-actions"><button class="btn" data-x>Cancel</button>
        <button class="btn money" data-ok>Buy $${price}</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    const ok = sheet.querySelector('[data-ok]');
    if (ok) ok.addEventListener('click', () => {
      G.state.ownedShips[key] = true;
      G.state.purchases['ship_' + key] = true;
      if (G.state.shipKills[key] == null) G.state.shipKills[key] = 0;
      G.save();
      closeSheet(); toast('Unlocked ' + ship.name + '!', '#caa033'); renderStore();
    });
  }
  // confirm sheet for a gold ship purchase
  function openShipBuy(key) {
    const ship = C.SHIP_BY_KEY[key], st = G.shipBuyState(key);
    const afford = st.affordable;
    const sheet = showSheet(`<div class="sheet-head">Acquire ${ship.name}</div><div class="sheet-body">
      <p style="margin-bottom:8px">${ship.desc}</p>
      <div class="ip-stat"><span class="ip-sname">Hardpoints</span><span class="v">⚔ ${ship.weapons} · ⊕ ${ship.ammo} · ⛨ ${ship.hull}${ship.drones?` · ◎ ${ship.drones}`:''}</span></div>
      <div class="ip-stat"><span class="ip-sname">Price</span><span class="v" style="color:${afford?'var(--gold)':'var(--bad)'}"><span class="coin">$</span> ${G.formatNum(ship.price)}</span></div>
      <div class="ip-stat"><span class="ip-sname">Your gold</span><span class="v">${G.formatNum(G.state.gold)}</span></div>
      ${afford?'':'<p style="font-size:11px;color:var(--bad);margin-top:6px">Not enough gold yet.</p>'}
      <div class="sheet-actions"><button class="btn" data-x>Cancel</button>
        <button class="btn gold" data-ok ${afford?'':'disabled'}>Buy</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    const ok = sheet.querySelector('[data-ok]');
    if (ok) ok.addEventListener('click', () => {
      const res = G.buyShip(key);
      if (res.ok) { closeSheet(); toast('Acquired ' + ship.name + '!', '#5bc06b'); renderStore(); }
      else { toast(res.reason === 'gold' ? 'Not enough gold' : 'Locked', '#e23b4e'); }
    });
  }
  function storeCard(ico, name, desc, price, owned, sku) {
    sku = sku || ('speed' + (name.match(/(\d+)/) ? name.match(/(\d+)/)[1] : ''));
    return `<div class="store-card"><div class="sc-ico">${ico}</div>
      <div class="sc-main"><div class="sc-name">${name}</div><div class="sc-desc">${desc}</div></div>
      ${owned ? '<button class="buy-btn owned">Owned</button>' : `<button class="buy-btn" data-buy="${sku}">${price}</button>`}</div>`;
  }

  // purchase confirm sheet
  function openPurchase(kind, tier) {
    const price = tier.priceLabel, name = kind === 'speed' ? `${tier.label} Game Speed` : tier.name;
    const sheet = showSheet(`<div class="sheet-head">Confirm Purchase</div><div class="sheet-body">
      <p>Unlock <b>${name}</b> for <b style="color:var(--gold)">${price}</b>?</p>
      <p style="font-size:11px;color:var(--muted-2)">Demo build — this is simulated and your card will not be charged.</p>
      <div class="sheet-actions"><button class="btn" data-x>Cancel</button><button class="btn gold" data-ok>Buy ${price}</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    sheet.querySelector('[data-ok]').addEventListener('click', () => {
      G.purchase(tier.sku);
      if (kind === 'speed') { G.setGameSpeed(tier.mult); buildSpeedRow(); }
      closeSheet(); toast(`Unlocked ${name}!`, '#5bc06b'); refreshAll();
    });
  }

  // ==========================================================================
  // LEADERBOARD
  // ==========================================================================
  function renderBoard() {
    const heat = LB.heatBoard(G);
    el['board-sub'].textContent = lbTab === 'heat' ? 'Heat ' + heat.heat : 'All-Time';
    let html = `<div class="lb-tabs">
      <button class="lb-tab ${lbTab==='heat'?'active':''}" data-t="heat">My Heat</button>
      <button class="lb-tab ${lbTab==='all'?'active':''}" data-t="all">All-Time</button></div>`;
    let data;
    if (lbTab === 'heat') {
      data = heat;
      html += `<div class="lb-info">Heat ${heat.heat} · week of ${heat.label}. Everyone who started this week competes together. New heat every Monday.</div>`;
    } else {
      data = LB.allTimeBoard(G);
      html += `<div class="lb-info">All-time ranking across every heat since launch.</div>`;
    }
    html += data.board.slice(0, 60).map((p, i) => `
      <div class="lb-row ${p.isMe?'me':''}" data-rank="${i}">
        <div class="lb-rank ${p.rank<=3?'top':''}">${p.rank}</div>
        <div class="lb-nm"><div class="lb-name ${p.isMe?'':''}">${p.isMe?'★ ':''}${p.name}</div>
          <div class="lb-meta">Zone ${p.zone} · Lv ${p.level} · ${G.formatNum(p.kills)} kills</div></div>
        <div class="lb-pow"><span class="pl">PWR</span>${G.formatNum(p.power)}</div></div>`).join('');
    el['board-body'].innerHTML = html;
    el['board-body'].querySelectorAll('.lb-tab').forEach((b) => b.addEventListener('click', () => { lbTab = b.dataset.t; renderBoard(); }));
    el['board-body'].querySelectorAll('.lb-row').forEach((row) => row.addEventListener('click', () => openLoadout(data.board[+row.dataset.rank], data.board.length)));
  }
  function openLoadout(p, total) {
    const eq = p.isMe ? G.state.equipped : LB.loadoutFor(p, p.rank, total);
    let grid = '';
    C.SLOT_KEYS.forEach((slot) => {
      const it = eq[slot], def = C.SLOTS[slot];
      grid += `<div class="lo-slot ${it?bl(it.rarity):''}"><div class="lo-ic ${it?rc(it.rarity):''}">${def.icon}</div>
        <div style="min-width:0"><div class="lo-nm ${it?rc(it.rarity):''}">${it?it.name:'—'}</div><div class="lo-r">${it?C.RARITY[it.rarity].name:'empty'}</div></div></div>`;
    });
    const sheet = showSheet(`<div class="sheet-head">${p.isMe?'Your Loadout':p.name}</div><div class="sheet-body">
      <p style="margin-bottom:10px">Rank <b>#${p.rank}</b> · Zone <b>${p.zone}</b> · Level <b>${p.level}</b> · Power <b style="color:var(--gold)">${G.formatNum(p.power)}</b></p>
      <div class="loadout-grid">${grid}</div>
      <div class="sheet-actions" style="margin-top:14px"><button class="btn" data-x>Close</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
  }

  // ==========================================================================
  // ITEM DETAIL SHEET
  // ==========================================================================
  // Render a salvage result ({fuel|iron|plasma: n}) as colored glyph chips.
  function salvageStr(salv) {
    if (!salv) return '';
    return GM.RES_KEYS.filter((k) => salv[k]).map((k) =>
      `<span style="color:${GM.RES[k].color}">${GM.RES[k].glyph}\u202F${G.formatNum(salv[k])}</span>`).join('  ');
  }
  function openItem(item, mode) {
    const r = C.RARITY[item.rarity];
    const equipped = G.state.equipped[item.slot];
    const cmp = (mode === 'inventory' && equipped) ? G.compare(item, equipped) : null;
    let statHTML = '';
    Object.keys(item.stats).forEach((k) => {
      const d = C.STATS[k]; if (!d) return;
      let cmpStr = '';
      if (cmp && cmp[k]) { const up = cmp[k] > 0; cmpStr = ` <span style="font-size:11px;color:${up?'var(--good)':'var(--bad)'}">(${up?'+':''}${d.fmt==='flat'?G.formatNum(cmp[k]):(Math.round(cmp[k]*10)/10)}${d.fmt==='flat'?'':'%'})</span>`; }
      statHTML += `<div class="ip-stat ${d.special?'special':''}"><span class="ip-sname">${d.name}</span><span class="v">${fmtStat(k, item.stats[k])}${cmpStr}</span></div>`;
    });
    let cmpNote = '';
    if (cmp && equipped) { const better = G.itemPower(item) > G.itemPower(equipped); cmpNote = `<div class="ip-cmp">vs equipped: <span style="color:${better?'var(--good)':'var(--bad)'}">${better?'Upgrade ▲':'Not an upgrade ▼'}</span></div>`; }
    let actions = '';
    const canSecond = (item.slot === 'bow' || item.slot === 'arrows') && G.secondUnlocked(item.slot);
    if (mode === 'inventory') {
      actions = `<div class="sheet-actions"><button class="btn primary" data-eq>Equip</button>` +
        (canSecond ? `<button class="btn gold" data-eq2>Equip 2nd</button>` : '') +
        `<button class="btn" data-sell>Sell <span class="coin">$</span> ${G.formatNum(C.sellValue(item))}</button></div>` +
        `<div class="ip-salvage">Scrapping may salvage <span style="color:${GM.RES.fuel.color}">${GM.RES.fuel.glyph}</span> <span style="color:${GM.RES.iron.color}">${GM.RES.iron.glyph}</span> <span style="color:${GM.RES.plasma.color}">${GM.RES.plasma.glyph}</span> for My Galaxy</div>`;
    } else if (mode === 'equipped') actions = `<div class="sheet-actions"><button class="btn" data-x>Close</button></div>`;
    const sheet = showSheet(`<div id="item-pop"><div class="sheet-body">
      <div class="ip-name ${rc(item.rarity)}">${item.name}</div>
      <div class="ip-type">${r.name} · ${C.SLOTS[item.slot].name} · Zone ${item.dungeon}</div>
      ${statHTML}${cmpNote}${actions||'<div class="sheet-actions"><button class="btn" data-x>Close</button></div>'}</div></div>`);
    const eq = sheet.querySelector('[data-eq]'); if (eq) eq.addEventListener('click', () => { G.equip(item, 'primary'); closeSheet(); });
    const eq2 = sheet.querySelector('[data-eq2]'); if (eq2) eq2.addEventListener('click', () => { G.equip(item, 'secondary'); closeSheet(); });
    const sl = sheet.querySelector('[data-sell]'); if (sl) sl.addEventListener('click', () => {
      const r = G.sell(item); closeSheet();
      if (r) { const sv = salvageStr(r.salvage);
        toast(`Sold for <b style="color:var(--gold)">${G.formatNum(r.gold)}g</b>${sv ? '  ·  ' + sv : ''}`, sv ? '#5bc0ff' : '#e6b566'); }
    });
    const x = sheet.querySelector('[data-x]'); if (x) x.addEventListener('click', closeSheet);
  }

  // ==========================================================================
  // SKILL TREE
  // ==========================================================================
  function renderSkills() {
    const sp = G.state.skillPoints || 0;
    el['skills-sub'].textContent = sp + ' pts';
    let html = `<div class="skill-top"><span class="pts">Skill Points: <b>${sp}</b></span><button class="reset" id="sk-reset">Reset</button></div>`;
    C.SKILLS.branches.forEach((br) => {
      const spent = G.branchSpent(br.key);
      html += `<div class="branch"><div class="branch-h"><span class="bdot" style="background:${br.color}"></span>${br.name}<span class="bspent">${spent} pts spent</span></div>`;
      C.SKILLS.nodes.filter((n) => n.br === br.key).forEach((n) => {
        const rank = G.skillRank(n.id), met = G.skillReqMet(n), able = G.canInvest(n), maxed = rank >= n.max;
        let pips = ''; for (let i = 0; i < n.max; i++) pips += `<div class="sn-pip ${i < rank ? 'on' : ''}"></div>`;
        let reqTxt = '';
        if (!met) { if (n.reqBranch != null && spent < n.reqBranch) reqTxt = `Requires ${n.reqBranch} pts in ${br.name}`; else if (n.reqNode) reqTxt = `Requires ${C.SKILLS.nodes.find(x=>x.id===n.reqNode.id).name} ${n.reqNode.rank}`; }
        const btn = maxed ? `<button class="sn-buy maxed" disabled>MAX</button>` : `<button class="sn-buy ${able?'able':''}" data-sk="${n.id}" ${able?'':'disabled'}>+</button>`;
        html += `<div class="skill-node ${met?'':'locked'} ${n.cap?'cap':''}" style="border-left-color:${br.color}">
          <div class="sn-main"><div class="sn-name">${n.name}${n.cap?'<span class="capm">CAPSTONE</span>':''}</div>
            <div class="sn-desc">${n.desc} · ${rank}/${n.max}${n.cost>1?' · '+n.cost+' pts':''}</div>
            ${reqTxt?`<div class="sn-req">${reqTxt}</div>`:''}
            <div class="sn-pips">${pips}</div></div>${btn}</div>`;
      });
      html += '</div>';
    });
    el['skills-body'].innerHTML = html;
    const rb = $('sk-reset'); if (rb) rb.addEventListener('click', openReset);
    el['skills-body'].querySelectorAll('[data-sk]').forEach((b) => b.addEventListener('click', () => { if (G.investSkill(b.dataset.sk)) renderSkills(); }));
  }
  function openReset() {
    const sheet = showSheet(`<div class="sheet-head">Reset Skills</div><div class="sheet-body">
      <p>Refund <b>all</b> spent skill points so you can rebuild from scratch?</p>
      <div class="sheet-actions"><button class="btn" data-x>Cancel</button><button class="btn danger" data-ok>Reset All</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
    sheet.querySelector('[data-ok]').addEventListener('click', () => { const r = G.resetSkills(); closeSheet(); toast(`Refunded ${r} points`, '#2f6fed'); renderSkills(); });
  }

  // ==========================================================================
  // MODAL PRIMITIVES
  // ==========================================================================
  function showSheet(inner) {
    closeSheet();
    const back = document.createElement('div'); back.className = 'backdrop';
    const sheet = document.createElement('div'); sheet.className = 'sheet'; sheet.innerHTML = inner;
    back.appendChild(sheet); el['modal-root'].appendChild(back);
    back.addEventListener('click', (e) => { if (e.target === back) closeSheet(); });
    return sheet;
  }
  function closeSheet() { el['modal-root'].innerHTML = ''; }

  // ==========================================================================
  // FEEDBACK
  // ==========================================================================
  function onLoot(item) { /* dropped on ground — pickup toast happens on collect */ }
  let _lastLootToast = 0, _bagDirty = false, _bagTimer = 0;
  function onCollect(item) {
    if (!_inited) return;
    const now = performance.now();
    // rate-limit loot toasts (10x pickups would otherwise flood the DOM)
    if (now - _lastLootToast > 220) {
      _lastLootToast = now;
      const t = document.createElement('div');
      t.className = 'loot-toast ' + bl(item.rarity);
      t.innerHTML = `<span class="${rc(item.rarity)}">${item.name}</span>`;
      el['loot-feed'].appendChild(t);
      setTimeout(() => t.remove(), 3200);
      while (el['loot-feed'].children.length > 5) el['loot-feed'].removeChild(el['loot-feed'].firstChild);
    }
    const n = G.state.inventory.length;
    el['bag-badge'].style.display = n > 0 ? 'block' : 'none'; el['bag-badge'].textContent = n;
    // debounce bag re-render to at most ~3/sec while the bag is open
    if (screen === 'bag') {
      _bagDirty = true;
      if (!_bagTimer) _bagTimer = setTimeout(() => { _bagTimer = 0; if (_bagDirty && screen === 'bag') { _bagDirty = false; renderBag(); } }, 350);
    }
  }
  function toast(text, color) {
    if (!_inited) return;
    const t = document.createElement('div'); t.className = 'loot-toast'; t.style.borderLeftColor = color;
    t.innerHTML = `<span style="color:${color}">${text}</span>`;
    el['loot-feed'].appendChild(t); setTimeout(() => t.remove(), 3200);
  }
  function onLevelUp(level) {
    if (!_inited) return;
    const t = document.createElement('div'); t.className = 'lvl-toast'; t.textContent = 'LEVEL ' + level;
    el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 1700);
  }
  function unlockToast(msg) { toast('★ ' + msg, '#e6b566'); }
  function blueprintEvent(ship) {
    if (!_inited || !ship) return;
    const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#7fe0ff'; t.style.fontSize = '20px';
    t.innerHTML = `◷ BLUEPRINT<br><span style="font-size:13px;color:#cfe9ff">${ship.name} unlocked in the Store</span>`;
    el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 2600);
    toast('Blueprint recovered: ' + ship.name, '#7fe0ff');
  }
  function bossEvent(kind) {
    if (!_inited) return;
    if (kind === 'spawn') {
      const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#e23b4e'; t.style.fontSize = '24px';
      t.textContent = '☠ BOSS INCOMING'; el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 1700);
    } else { toast('☠ Boss down — elite loot dropped!', '#e07c12'); }
  }
  function siegeEvent(kind, s) {
    if (!_inited) return;
    if (kind === 'start') { toast('⚔ Siege begun — clear 10 waves', '#5b9cff'); }
    else if (kind === 'wave') { toast('Wave ' + s.wave + ' / ' + s.total, '#9ec5ff'); }
    else if (kind === 'boss') { const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#e23b4e'; t.style.fontSize = '22px'; t.textContent = '☠ BOSS WAVE'; el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 1700); }
    else if (kind === 'captured') { const sys = s.sys || {}; const t = document.createElement('div'); t.className = 'lvl-toast'; t.style.color = '#5bc06b'; t.style.fontSize = '20px'; t.innerHTML = '★ SYSTEM CAPTURED<br><span style="font-size:13px;color:#cfe9ff">' + (sys.name || '') + (sys.resource ? ' · +' + GM.RES[sys.resource].glyph + ' ' + G.formatNum(sys.rate) + '/h' : '') + '</span>'; el['toast-layer'].appendChild(t); setTimeout(() => t.remove(), 2600); }
  }
  // Small wreck notice — the ship has already been auto-towed to the hangar.
  function onDeathReturn(lostItem, killerName, zone) {
    if (!_inited) return;
    refreshAll();
    G.state.deathExplained = true; G.save();
    const lostHtml = lostItem
      ? `Lost <b class="${rc(lostItem.rarity)}">${lostItem.name}</b><br><span style="color:var(--muted);font-size:11px">${C.RARITY[lostItem.rarity].name} · ${C.SLOTS[lostItem.slot].name} · gone for good</span>`
      : 'No gear was lost this time.';
    const sheet = showSheet(`<div id="wreck-pop">
      <div class="wreck-skull">☠</div>
      <div class="wreck-title">SHIP WRECKED</div>
      <div class="wreck-by">Downed by a <b>${killerName || 'hostile'}</b>${zone >= 1 ? ' in ' + zoneName(zone) : ''}</div>
      <div class="wreck-loss">${lostHtml}</div>
      <div class="wreck-foot">⌂ Towed back to your hangar.</div>
      <div class="sheet-actions" style="margin-top:14px"><button class="btn primary" data-x>Continue</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', closeSheet);
  }
  function showOffline(sum) {
    const sheet = showSheet(`<div class="sheet-head">Welcome Back, Operator</div><div class="sheet-body">
      <p>Your operator held the line for <b style="color:var(--gold)">${G.formatTime(sum.elapsed)}</b> while you were away.</p>
      <div class="stat-block"><span class="sb-name">⚔ Enemies Down</span><span class="sb-val">${G.formatNum(sum.kills)}</span></div>
      <div class="stat-block"><span class="sb-name">★ XP</span><span class="sb-val">${G.formatNum(sum.xp)}</span></div>
      <div class="stat-block"><span class="sb-name"><span class="coin">$</span> Gold</span><span class="sb-val">${G.formatNum(sum.gold)}</span></div>
      <div class="stat-block"><span class="sb-name">▼ Loot Found</span><span class="sb-val">${G.formatNum(sum.found)}</span></div>
      ${sum.lost ? `<div class="stat-block"><span class="sb-name" style="color:var(--hp)">✖ Items Lost</span><span class="sb-val" style="color:var(--hp)">${sum.lost}</span></div>` : ''}
      <div class="sheet-actions" style="margin-top:14px"><button class="btn primary" data-x>Claim</button></div></div>`);
    sheet.querySelector('[data-x]').addEventListener('click', () => { closeSheet(); refreshAll(); });
  }

  window.UI = { init, syncHUD, refreshAll, syncStatsTab, onLoot, onCollect, onLevelUp, onDeathReturn, showOffline, unlockToast, bossEvent, blueprintEvent, siegeEvent };
})();
